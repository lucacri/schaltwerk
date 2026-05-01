import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionVersionGroup } from './SessionVersionGroup'
import type { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import type { EnrichedSession } from '../../types/session'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'

vi.mock('./SessionCard', () => ({
  SessionCard: ({ session }: { session: EnrichedSession }) => (
    <div data-testid="session-card">{session.info.session_id}</div>
  )
}))

vi.mock('./CompactVersionRow', async () => {
  const { useSessionCardActions } = await import('../../contexts/SessionCardActionsContext')
  return {
    CompactVersionRow: ({ session }: { session: EnrichedSession }) => {
      const { onSelect } = useSessionCardActions()
      return (
        <button
          type="button"
          data-testid="compact-version-row"
          data-session-id={session.info.session_id}
          onClick={() => onSelect(session.info.session_id)}
        >
          {session.info.session_id}
        </button>
      )
    },
  }
})

const mockActions: SessionCardActions = {
  onSelect: vi.fn(),
  onCancel: vi.fn(),
  onConvertToSpec: vi.fn(),
  onRunDraft: vi.fn(),
  onRefineSpec: vi.fn(),
  onDeleteSpec: vi.fn(),
  onImprovePlanSpec: vi.fn(),
  onReset: vi.fn(),
  onSwitchModel: vi.fn(),
  onCreatePullRequest: vi.fn(),
  onCreateGitlabMr: vi.fn(),
  onMerge: vi.fn(),
  onQuickMerge: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onLinkPr: vi.fn(),
  onPostToForge: vi.fn(),
}

const callbacks = {
  hasFollowUpMessage: () => false,
  onConsolidate: vi.fn(),
  onTriggerConsolidationJudge: vi.fn(),
  onConfirmConsolidationWinner: vi.fn(),
  onTerminateAll: vi.fn(),
}

function makeSource(id: string, versionNumber: number, opts: { idle?: boolean } = {}): SessionVersionGroupType['versions'][number] {
  const info: EnrichedSession['info'] = {
    session_id: id,
    display_name: id,
    version_number: versionNumber,
    branch: `${id}-branch`,
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    session_state: 'running',
    is_current: false,
    session_type: 'worktree',
    original_agent_type: 'claude',
    current_task: 'Shared task',
    attention_required: opts.idle ?? false,
    attention_kind: opts.idle ? 'idle' : undefined,
    ready_to_merge: false,
    is_blocked: false,
  }
  return { versionNumber, session: { info, status: undefined, terminals: [] } }
}

function makeCandidate(id: string, versionNumber: number, opts: {
  idle?: boolean
  report?: boolean
  recommendedSessionId?: string
  baseSessionId?: string
} = {}): SessionVersionGroupType['versions'][number] {
  const v = makeSource(id, versionNumber, { idle: opts.idle })
  return {
    ...v,
    session: {
      ...v.session,
      info: {
        ...v.session.info,
        is_consolidation: true,
        consolidation_role: 'candidate',
        consolidation_round_id: 'round-7b43',
        consolidation_sources: ['src_v1', 'src_v2'],
        consolidation_report: opts.report ? '# report' : undefined,
        consolidation_base_session_id: opts.baseSessionId,
        consolidation_recommended_session_id: opts.recommendedSessionId,
      },
    },
  }
}

function makeJudge(id: string, opts: { recommendedSessionId?: string; baseSessionId?: string } = {}): SessionVersionGroupType['versions'][number] {
  const v = makeSource(id, 1, { idle: false })
  return {
    ...v,
    session: {
      ...v.session,
      info: {
        ...v.session.info,
        is_consolidation: true,
        consolidation_role: 'judge',
        consolidation_round_id: 'round-7b43',
        consolidation_sources: ['src_v1', 'src_v2'],
        consolidation_recommended_session_id: opts.recommendedSessionId,
        consolidation_base_session_id: opts.baseSessionId,
      },
    },
  }
}

const baseGroup = (versions: SessionVersionGroupType['versions']): SessionVersionGroupType => ({
  id: 'src-group',
  baseName: 'src',
  isVersionGroup: true,
  versions,
})

const ALL_AFFORDANCES = [
  'consolidate-versions-button',
  'trigger-consolidation-judge-button',
  'confirm-consolidation-winner-button',
  'confirm-consolidation-winner-banner-button',
  'terminate-group-button',
  'version-group-judge-recommendation',
  'version-group-consolidation-lane',
] as const

type Affordance = typeof ALL_AFFORDANCES[number]

interface StateRow {
  name: string
  versions: SessionVersionGroupType['versions']
  expectVisible: Affordance[]
}

// State table — every row pins which affordances must render.
// Affordances NOT in expectVisible must be absent (or, for consolidate, rendered-but-disabled).
const STATE_TABLE: StateRow[] = [
  {
    name: 'pre-candidates: only sources, all running',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
    ],
    expectVisible: [
      'consolidate-versions-button',
      'terminate-group-button',
    ],
  },
  {
    name: 'candidates-running: candidates active, no reports, no judge',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
      makeCandidate('src-merge_v1', 1),
      makeCandidate('src-merge_v2', 2),
    ],
    expectVisible: [
      'consolidate-versions-button', // disabled but rendered
      'trigger-consolidation-judge-button',
      'terminate-group-button',
    ],
  },
  {
    name: 'candidates-idle-no-judge: 3 candidates idle, no reports, no judge (USER STUCK STATE)',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
      makeCandidate('src-merge_v1', 1, { idle: true }),
      makeCandidate('src-merge_v2', 2, { idle: true }),
      makeCandidate('src-merge_v3', 3, { idle: true }),
    ],
    expectVisible: [
      'consolidate-versions-button',
      'trigger-consolidation-judge-button',
      'terminate-group-button',
    ],
  },
  {
    // Mirrors the live state from round 7b43c616: two candidates filed reports
    // (consolidation_report + consolidation_base_session_id) but no judge has run, so
    // consolidation_recommended_session_id is NULL on every candidate. After 603f5cf0
    // tightened latestReportedCandidate to require recommended_session_id, the round-level
    // recommendation banner intentionally suppresses — but the trigger-judge affordance
    // MUST remain so the user can start the judge.
    name: 'candidates-idle-mixed-reports-no-judge (live round 7b43 mirror)',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
      makeCandidate('src-merge_v1', 1, {
        idle: true,
        report: true,
        baseSessionId: 'src_v2',
      }),
      makeCandidate('src-merge_v2', 2, {
        idle: true,
        report: true,
        baseSessionId: 'src_v2',
      }),
      makeCandidate('src-merge_v3', 3, { idle: true }),
    ],
    expectVisible: [
      'consolidate-versions-button',
      'trigger-consolidation-judge-button',
      'terminate-group-button',
    ],
  },
  {
    name: 'judge-running: judge spawned, no recommendation yet',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
      makeCandidate('src-merge_v1', 1, { idle: true }),
      makeCandidate('src-merge_v2', 2, { idle: true }),
      makeJudge('src-judge'),
    ],
    expectVisible: [
      'consolidate-versions-button',
      'trigger-consolidation-judge-button',
      'terminate-group-button',
      'version-group-consolidation-lane',
    ],
  },
  {
    name: 'judge-completed: judge filed recommendation',
    versions: [
      makeSource('src_v1', 1),
      makeSource('src_v2', 2),
      makeCandidate('src-merge_v1', 1, { idle: true }),
      makeCandidate('src-merge_v2', 2, { idle: true }),
      makeJudge('src-judge', { recommendedSessionId: 'src-merge_v1', baseSessionId: 'src_v1' }),
    ],
    expectVisible: [
      'consolidate-versions-button',
      'trigger-consolidation-judge-button',
      'confirm-consolidation-winner-button',
      'confirm-consolidation-winner-banner-button',
      'terminate-group-button',
      'version-group-judge-recommendation',
      'version-group-consolidation-lane',
    ],
  },
]

describe('SessionVersionGroup affordance state table', () => {
  for (const row of STATE_TABLE) {
    describe(`state: ${row.name}`, () => {
      for (const affordance of ALL_AFFORDANCES) {
        const shouldShow = row.expectVisible.includes(affordance)
        it(`${shouldShow ? 'renders' : 'does not render'} ${affordance}`, () => {
          render(
            <SessionCardActionsProvider actions={mockActions}>
              <SessionVersionGroup
                group={baseGroup(row.versions)}
                selection={{ kind: 'session', payload: 'unrelated' }}
                startIndex={0}
                {...callbacks}
              />
            </SessionCardActionsProvider>
          )
          const found = screen.queryByTestId(affordance)
          if (shouldShow) {
            expect(found, `expected ${affordance} to render in state "${row.name}"`).not.toBeNull()
          } else {
            expect(found, `expected ${affordance} to NOT render in state "${row.name}"`).toBeNull()
          }
        })
      }
    })
  }
})

// Wave A: header action buttons must render their label text inline, not just
// as a tooltip. The user couldn't find the trigger-judge button in the smoke
// test because it was icon-only.
describe('SessionVersionGroup header action labels are visible', () => {
  it('renders "Run synthesis judge" label text inline when candidates are running', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeCandidate('src-merge_v2', 2, { idle: true }),
            makeCandidate('src-merge_v3', 3, { idle: true }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const button = screen.getByTestId('trigger-consolidation-judge-button')
    expect(button.textContent).toContain('Run synthesis judge')
  })

  it('renders "Re-run synthesis judge" label text once a judge has filed', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeJudge('src-judge', { recommendedSessionId: 'src-merge_v1', baseSessionId: 'src_v1' }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const button = screen.getByTestId('trigger-consolidation-judge-button')
    expect(button.textContent).toContain('Re-run synthesis judge')
  })

  it('renders "Consolidate versions" label text inline on the consolidate button', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const button = screen.getByTestId('consolidate-versions-button')
    expect(button.textContent).toContain('Consolidate versions')
  })

  it('renders "Terminate" label text inline on the terminate-all button', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const button = screen.getByTestId('terminate-group-button')
    expect(button.textContent).toContain('Terminate')
  })

  it('renders confirm-winner button label text once judge has filed', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeJudge('src-judge', { recommendedSessionId: 'src-merge_v1', baseSessionId: 'src_v1' }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const button = screen.getByTestId('confirm-consolidation-winner-button')
    expect(button.textContent).toMatch(/Promote|Confirm/)
  })
})

// Wave C: when all candidates are idle and no judge has run yet, the user is
// stuck — render an explicit banner pointing at the next action.
describe('SessionVersionGroup all-candidates-idle-no-judge nudge banner', () => {
  it('renders the nudge banner with prominent judge-trigger button', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeCandidate('src-merge_v2', 2, { idle: true }),
            makeCandidate('src-merge_v3', 3, { idle: true }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    const banner = screen.getByTestId('candidates-idle-no-judge-banner')
    expect(banner.textContent).toContain('All candidates idle')
    expect(banner.textContent).toContain('Run the synthesis judge')

    const bannerButton = screen.getByTestId('candidates-idle-no-judge-banner-button')
    expect(bannerButton.textContent).toContain('Run synthesis judge')
  })

  it('does NOT render the banner when at least one candidate is still running', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeCandidate('src-merge_v2', 2, { idle: false }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    expect(screen.queryByTestId('candidates-idle-no-judge-banner')).toBeNull()
  })

  it('does NOT render the banner once a judge has been spawned', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeCandidate('src-merge_v2', 2, { idle: true }),
            makeJudge('src-judge'),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
        />
      </SessionCardActionsProvider>
    )
    expect(screen.queryByTestId('candidates-idle-no-judge-banner')).toBeNull()
  })

  it('clicking the banner button invokes onTriggerConsolidationJudge with the active round id', () => {
    const onTriggerConsolidationJudge = vi.fn()
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup([
            makeSource('src_v1', 1),
            makeSource('src_v2', 2),
            makeCandidate('src-merge_v1', 1, { idle: true }),
            makeCandidate('src-merge_v2', 2, { idle: true }),
          ])}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...callbacks}
          onTriggerConsolidationJudge={onTriggerConsolidationJudge}
        />
      </SessionCardActionsProvider>
    )
    const bannerButton = screen.getByTestId('candidates-idle-no-judge-banner-button')
    act(() => {
      bannerButton.click()
    })
    expect(onTriggerConsolidationJudge).toHaveBeenCalledWith('round-7b43', expect.any(Boolean))
  })
})

// Property-level invariant: any non-terminal round (activeRoundId truthy and round not confirmed)
// MUST render at least one consolidation action button. Catches future "all affordances vanish" bugs.
describe('SessionVersionGroup non-empty-affordance invariant', () => {
  const NON_TERMINAL_STATES: StateRow[] = STATE_TABLE.filter(r =>
    r.versions.some(v => v.session.info.is_consolidation),
  )
  const ACTION_BUTTONS: Affordance[] = [
    'trigger-consolidation-judge-button',
    'confirm-consolidation-winner-button',
    'confirm-consolidation-winner-banner-button',
    'terminate-group-button',
  ]

  for (const row of NON_TERMINAL_STATES) {
    it(`renders at least one consolidation action button in state: ${row.name}`, () => {
      render(
        <SessionCardActionsProvider actions={mockActions}>
          <SessionVersionGroup
            group={baseGroup(row.versions)}
            selection={{ kind: 'session', payload: 'unrelated' }}
            startIndex={0}
            {...callbacks}
          />
        </SessionCardActionsProvider>
      )
      const visibleAction = ACTION_BUTTONS.find(a => screen.queryByTestId(a) !== null)
      expect(
        visibleAction,
        `expected at least one of ${ACTION_BUTTONS.join(', ')} to render in non-terminal state "${row.name}"`,
      ).toBeDefined()
    })
  }
})
