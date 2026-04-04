import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { ForgePrDetail } from './ForgePrDetail'
import { renderWithProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import { UiEvent } from '../../common/uiEvents'
import type { ForgePrDetails, ForgeProviderData } from '../../types/forgeTypes'
import type { ContextualAction } from '../../types/contextualAction'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { mockUseContextualActions, mockEmitUiEvent } = vi.hoisted(() => ({
  mockUseContextualActions: vi.fn(),
  mockEmitUiEvent: vi.fn(),
}))

vi.mock('../../hooks/useContextualActions', () => ({
  useContextualActions: () => mockUseContextualActions(),
}))

vi.mock('../../common/uiEvents', async () => {
  const actual = await vi.importActual<typeof import('../../common/uiEvents')>('../../common/uiEvents')
  return {
    ...actual,
    emitUiEvent: mockEmitUiEvent,
  }
})

const { invoke } = await import('@tauri-apps/api/core')
const mockedInvoke = vi.mocked(invoke)

function githubProvider(overrides: Partial<Extract<ForgeProviderData, { type: 'GitHub' }>> = {}): ForgeProviderData {
  return { type: 'GitHub', statusChecks: [], isFork: false, ...overrides }
}

function gitlabProvider(overrides: Partial<Extract<ForgeProviderData, { type: 'GitLab' }>> = {}): ForgeProviderData {
  return { type: 'GitLab', reviewers: [], ...overrides }
}

function makeDetails(overrides: Partial<ForgePrDetails> = {}): ForgePrDetails {
  return {
    summary: {
      id: '99',
      title: 'Add dark mode support',
      state: 'OPEN',
      author: 'alice',
      labels: [
        { name: 'enhancement', color: '0075ca' },
        { name: 'ui' },
      ],
      sourceBranch: 'feature/dark-mode',
      targetBranch: 'main',
      url: 'https://github.com/owner/repo/pull/99',
    },
    body: 'This PR adds dark mode to the app.',
    reviews: [],
    reviewComments: [
      { author: 'alice', body: 'Looks good!', path: 'src/app.ts', line: 10 },
      { author: 'bob', body: 'Nice work.' },
    ],
    providerData: githubProvider(),
    ...overrides,
  }
}

describe('ForgePrDetail', () => {
  const onBack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseContextualActions.mockReturnValue({
      actions: [],
      loading: false,
      error: null,
      saveActions: vi.fn(),
      resetToDefaults: vi.fn(),
      reloadActions: vi.fn(),
    })
  })

  it('renders PR title with #id format', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('#99 Add dark mode support')).toBeTruthy()
  })

  it('shows open state badge with green styling', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Open')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-green)')
  })

  it('shows closed state badge with red styling', () => {
    const details = makeDetails({
      summary: { ...makeDetails().summary, state: 'CLOSED' },
    })

    renderWithProviders(
      <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Closed')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-red)')
  })

  it('shows merged state badge with violet styling for GitHub MERGED', () => {
    const details = makeDetails({
      summary: { ...makeDetails().summary, state: 'MERGED' },
    })

    renderWithProviders(
      <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Merged')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-violet)')
  })

  it('shows merged state badge with violet styling for GitLab merged', () => {
    const details = makeDetails({
      summary: { ...makeDetails().summary, state: 'merged' },
      providerData: gitlabProvider(),
    })

    renderWithProviders(
      <ForgePrDetail details={details} onBack={onBack} forgeType="gitlab" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Merged')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-violet)')
  })

  it('shows branch pill for sourceBranch', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('feature/dark-mode')).toBeTruthy()
  })

  it('shows labels via ForgeLabelChip', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('enhancement')).toBeTruthy()
    expect(screen.getByText('ui')).toBeTruthy()
  })

  it('shows body/description in styled container', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('This PR adds dark mode to the app.')).toBeTruthy()
    expect(screen.getByText('Description')).toBeTruthy()
  })

  it('renders markdown in the description and review comments', () => {
    const details = makeDetails({
      body: '## Rollout\n\n- enable theme',
      reviewComments: [{ author: 'alice', body: 'Please check `src/app.ts`.' }],
    })

    renderWithProviders(
      <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByRole('heading', { name: 'Rollout' })).toBeTruthy()
    expect(screen.getByText('enable theme')).toBeTruthy()
    expect(screen.getByText('src/app.ts')).toBeTruthy()
  })

  it('shows review comments with author', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('Looks good!')).toBeTruthy()
    expect(screen.getByText('Nice work.')).toBeTruthy()
  })

  it('shows "No comments yet" when reviewComments is empty', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails({ reviewComments: [] })} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('No comments yet')).toBeTruthy()
  })

  it('filters out comments with empty bodies', () => {
    const details = makeDetails({
      reviewComments: [
        { author: 'alice', body: 'Valid comment' },
        { author: 'bob', body: '' },
        { author: 'carol', body: '   ' },
      ],
    })

    renderWithProviders(
      <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('Valid comment')).toBeTruthy()
    expect(screen.getByText('Comments (1)')).toBeTruthy()
  })

  it('calls onBack when back button is clicked', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Back to list'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls OpenExternalUrl when "Open in browser" is clicked', () => {
    mockedInvoke.mockResolvedValue(undefined)

    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Open in browser'))
    expect(mockedInvoke).toHaveBeenCalledWith(
      TauriCommands.OpenExternalUrl,
      { url: 'https://github.com/owner/repo/pull/99' }
    )
  })

  it('renders ContextualActionButton with pr context', () => {
    const { container } = renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const header = container.querySelector('[style*="border-bottom"]')
    expect(header).toBeTruthy()
    expect(header!.childNodes.length).toBeGreaterThanOrEqual(3)
  })

  it('uses unified pr variables for GitHub contextual actions', () => {
    const actions: ContextualAction[] = [
      {
        id: 'review-pr',
        name: 'Review PR',
        context: 'pr',
        promptTemplate: 'Author {{pr.author}} from {{pr.sourceBranch}} to {{pr.targetBranch}}. URL: {{pr.url}}',
        mode: 'session',
        isBuiltIn: false,
      },
    ]
    mockUseContextualActions.mockReturnValue({
      actions,
      loading: false,
      error: null,
      saveActions: vi.fn(),
      resetToDefaults: vi.fn(),
      reloadActions: vi.fn(),
    })

    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Actions'))
    fireEvent.click(screen.getByText('Review PR'))

    expect(mockEmitUiEvent).toHaveBeenCalledWith(UiEvent.ContextualActionCreateSession, {
      prompt: 'Author alice from feature/dark-mode to main. URL: https://github.com/owner/repo/pull/99',
      actionName: 'Review PR',
      agentType: undefined,
      variantId: undefined,
      presetId: undefined,
      contextType: 'pr',
      contextNumber: '99',
      contextTitle: 'Add dark mode support',
      contextUrl: 'https://github.com/owner/repo/pull/99',
    })
  })

  it('uses unified pr variables for GitLab contextual actions', () => {
    const actions: ContextualAction[] = [
      {
        id: 'review-mr',
        name: 'Review MR',
        context: 'pr',
        promptTemplate: '{{pr.title}} by {{pr.author}} from {{pr.sourceBranch}} to {{pr.targetBranch}} ({{pr.labels}})',
        mode: 'spec',
        isBuiltIn: false,
      },
    ]
    mockUseContextualActions.mockReturnValue({
      actions,
      loading: false,
      error: null,
      saveActions: vi.fn(),
      resetToDefaults: vi.fn(),
      reloadActions: vi.fn(),
    })

    renderWithProviders(
      <ForgePrDetail details={makeDetails({ providerData: gitlabProvider() })} onBack={onBack} forgeType="gitlab" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Actions'))
    fireEvent.click(screen.getByText('Review MR'))

    expect(mockEmitUiEvent).toHaveBeenCalledWith(UiEvent.ContextualActionCreateSpec, {
      prompt: 'Add dark mode support by alice from feature/dark-mode to main (enhancement, ui)',
      name: 'Review MR',
      contextType: 'pr',
      contextNumber: '99',
      contextTitle: 'Add dark mode support',
      contextUrl: 'https://github.com/owner/repo/pull/99',
    })
  })

  it('interpolates pr.number in contextual action templates', () => {
    const actions: ContextualAction[] = [
      {
        id: 'review-pr-number',
        name: 'Review PR Number',
        context: 'pr',
        promptTemplate: 'Review PR #{{pr.number}}: {{pr.title}}',
        mode: 'session',
        isBuiltIn: false,
      },
    ]
    mockUseContextualActions.mockReturnValue({
      actions,
      loading: false,
      error: null,
      saveActions: vi.fn(),
      resetToDefaults: vi.fn(),
      reloadActions: vi.fn(),
    })

    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Actions'))
    fireEvent.click(screen.getByText('Review PR Number'))

    expect(mockEmitUiEvent).toHaveBeenCalledWith(UiEvent.ContextualActionCreateSession, {
      prompt: 'Review PR #99: Add dark mode support',
      actionName: 'Review PR Number',
      agentType: undefined,
      variantId: undefined,
      presetId: undefined,
      contextType: 'pr',
      contextNumber: '99',
      contextTitle: 'Add dark mode support',
      contextUrl: 'https://github.com/owner/repo/pull/99',
    })
  })

  describe('GitHub-specific sections', () => {
    it('shows review decision APPROVED with green styling', () => {
      const details = makeDetails({
        providerData: githubProvider({ reviewDecision: 'APPROVED' }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      const decision = screen.getByText('APPROVED')
      expect(decision).toBeTruthy()
      expect(decision.style.color).toBe('var(--color-accent-green)')
    })

    it('shows review decision CHANGES_REQUESTED with red styling', () => {
      const details = makeDetails({
        providerData: githubProvider({ reviewDecision: 'CHANGES_REQUESTED' }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      const decision = screen.getByText('CHANGES_REQUESTED')
      expect(decision).toBeTruthy()
      expect(decision.style.color).toBe('var(--color-accent-red)')
    })

    it('shows review decision REVIEW_REQUIRED with amber styling', () => {
      const details = makeDetails({
        providerData: githubProvider({ reviewDecision: 'REVIEW_REQUIRED' }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      const decision = screen.getByText('REVIEW_REQUIRED')
      expect(decision).toBeTruthy()
      expect(decision.style.color).toBe('var(--color-accent-amber)')
    })

    it('hides review decision section when reviewDecision is undefined', () => {
      const details = makeDetails({
        providerData: githubProvider({ reviewDecision: undefined }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.queryByText('Review Decision')).toBeNull()
    })

    it('shows status checks with SUCCESS green styling', () => {
      const details = makeDetails({
        providerData: githubProvider({
          statusChecks: [{ name: 'CI Build', status: 'completed', conclusion: 'SUCCESS' }],
        }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('CI Build')).toBeTruthy()
      const statusText = screen.getByText('SUCCESS')
      expect(statusText.style.color).toBe('var(--color-accent-green)')
    })

    it('shows status checks with FAILURE red styling', () => {
      const details = makeDetails({
        providerData: githubProvider({
          statusChecks: [{ name: 'Tests', status: 'completed', conclusion: 'FAILURE' }],
        }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      const statusText = screen.getByText('FAILURE')
      expect(statusText.style.color).toBe('var(--color-accent-red)')
    })

    it('shows status checks with PENDING amber styling', () => {
      const details = makeDetails({
        providerData: githubProvider({
          statusChecks: [{ name: 'Deploy', status: 'in_progress', conclusion: 'PENDING' }],
        }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      const statusText = screen.getByText('PENDING')
      expect(statusText.style.color).toBe('var(--color-accent-amber)')
    })

    it('hides status checks section when statusChecks is empty', () => {
      const details = makeDetails({
        providerData: githubProvider({ statusChecks: [] }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.queryByText('Status Checks')).toBeNull()
    })
  })

  describe('GitLab-specific sections', () => {
    it('shows pipeline status when present', () => {
      const details = makeDetails({
        summary: { ...makeDetails().summary, state: 'opened' },
        providerData: gitlabProvider({ pipelineStatus: 'success' }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="gitlab" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('Pipeline')).toBeTruthy()
      expect(screen.getByText('Passed')).toBeTruthy()
    })

    it('shows reviewers list when present', () => {
      const details = makeDetails({
        providerData: gitlabProvider({ reviewers: ['reviewer1', 'reviewer2'] }),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="gitlab" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('Reviewers')).toBeTruthy()
      expect(screen.getByText('reviewer1')).toBeTruthy()
      expect(screen.getByText('reviewer2')).toBeTruthy()
    })

    it('shows action buttons when state is open', () => {
      const details = makeDetails({
        summary: { ...makeDetails().summary, state: 'opened' },
        providerData: gitlabProvider(),
      })

      renderWithProviders(
        <ForgePrDetail
          details={details}
          onBack={onBack}
          forgeType="gitlab"
          onApprove={vi.fn()}
          onMerge={vi.fn()}
          onComment={vi.fn()}
        />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('Approve')).toBeTruthy()
      expect(screen.getByText('Merge')).toBeTruthy()
      expect(screen.getByText('Comment')).toBeTruthy()
    })

    it('hides action buttons when state is merged', () => {
      const details = makeDetails({
        summary: { ...makeDetails().summary, state: 'merged' },
        providerData: gitlabProvider(),
      })

      renderWithProviders(
        <ForgePrDetail
          details={details}
          onBack={onBack}
          forgeType="gitlab"
          onApprove={vi.fn()}
          onMerge={vi.fn()}
          onComment={vi.fn()}
        />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.queryByText('Approve')).toBeNull()
      expect(screen.queryByText('Merge')).toBeNull()
    })

    it('shows sourceLabel badge when provided', () => {
      const details = makeDetails({
        providerData: gitlabProvider(),
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="gitlab" sourceLabel="my-project" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('my-project')).toBeTruthy()
    })
  })

  describe('reviews section', () => {
    it('shows reviews list with author and state', () => {
      const details = makeDetails({
        reviews: [
          { author: 'reviewer1', state: 'APPROVED' },
          { author: 'reviewer2', state: 'CHANGES_REQUESTED' },
        ],
      })

      renderWithProviders(
        <ForgePrDetail details={details} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('reviewer1')).toBeTruthy()
      expect(screen.getByText('reviewer2')).toBeTruthy()
    })

    it('shows "No reviews yet" when reviews is empty', () => {
      renderWithProviders(
        <ForgePrDetail details={makeDetails({ reviews: [] })} onBack={onBack} forgeType="github" />,
        { forgeOverrides: { hasRepository: true } }
      )

      expect(screen.getByText('No reviews yet')).toBeTruthy()
    })
  })
})
