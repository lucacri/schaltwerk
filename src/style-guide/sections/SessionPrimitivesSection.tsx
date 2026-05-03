import { useState } from 'react'
import { Button, SectionHeader } from '../../components/ui'
import { Dropdown } from '../../components/inputs/Dropdown'
import { FavoriteCard } from '../../components/shared/FavoriteCard'
import { SessionCard } from '../../components/sidebar/SessionCard'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'
import type { EnrichedSession, Epic, SessionInfo } from '../../types/session'

function ComponentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
      <h3 className="text-body-large font-semibold text-text-primary">{title}</h3>
      <div className="mt-4 flex flex-wrap items-start gap-4">{children}</div>
    </div>
  )
}

function ExampleSurface({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`min-w-[220px] space-y-2 rounded-lg border border-border-subtle bg-bg-elevated p-3 ${className}`.trim()}>
      <div className="text-caption uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  )
}

const sampleEpic: Epic = {
  id: 'style-guide-contract',
  name: 'Primitive contract',
  color: 'blue',
}

const baseSessionInfo: SessionInfo = {
  session_id: 'sidebar_refine_v2',
  display_name: 'sidebar_refine_v2',
  version_number: 2,
  branch: 'lucode/sidebar-refine-v2',
  worktree_path: '/tmp/sidebar-refine-v2',
  base_branch: 'main',
  status: 'active',
  last_modified: new Date('2026-04-12T12:00:00Z').toISOString(),
  has_uncommitted_changes: false,
  is_current: false,
  session_type: 'worktree',
  session_state: 'running',
  current_task: 'Stabilize session primitives before composed sidebar work.',
  is_blocked: false,
  diff_stats: { files_changed: 4, additions: 28, deletions: 6, insertions: 28 },
  dirty_files_count: 0,
  commits_ahead_count: 2,
  ready_to_merge: true,
  original_agent_type: 'claude',
  issue_number: 17,
  issue_url: 'https://example.com/issues/17',
  pr_number: 41,
  pr_url: 'https://example.com/pull/41',
  epic: sampleEpic,
}

const sessionCardSample: EnrichedSession = {
  info: {
    ...baseSessionInfo,
    display_name: 'sidebar_refine',
    session_id: 'sidebar_refine',
    branch: 'lucode/sidebar-refine',
    ready_to_merge: false,
    dirty_files_count: 1,
    has_uncommitted_changes: true,
    top_uncommitted_paths: ['src/components/sidebar/SessionCard.tsx'],
  },
  terminals: [],
}

const noopSessionCardActions: SessionCardActions = {
  onSelect: () => {},
  onCancel: () => {},
  onConvertToSpec: () => {},
  onRunDraft: () => {},
  onRefineSpec: () => {},
  onDeleteSpec: () => {},
  onImprovePlanSpec: () => {},
  onReset: () => {},
  onSwitchModel: () => {},
  onCreatePullRequest: () => {},
  onCreateGitlabMr: () => {},
  onMerge: () => {},
  onQuickMerge: () => {},
  onRename: async () => {},
  onLinkPr: () => {},
  onPostToForge: () => {},
}

function OverlayMenuPreview() {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        items={[
          { key: 'open', label: 'Open session details' },
          { key: 'group', label: 'Move to epic' },
          { key: 'archive', label: 'Archive selection' },
        ]}
        onSelect={() => setOpen(false)}
        menuTestId="style-guide-overlay-menu"
      >
        {({ toggle }) => (
          <Button size="sm" onClick={toggle}>
            Open Overlay Menu Preview
          </Button>
        )}
      </Dropdown>
      <p className="text-caption text-text-secondary">
        Dropdowns and popup menus stay anchored overlays rendered out of layout flow.
      </p>
    </div>
  )
}

function SessionCardPreview() {
  return (
    <div className="w-full max-w-xl">
      <SessionCardActionsProvider actions={noopSessionCardActions}>
        <SessionCard
          session={sessionCardSample}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={false}
          onHover={() => {}}
        />
      </SessionCardActionsProvider>
    </div>
  )
}

export function SessionPrimitivesSection() {
  return (
    <section className="space-y-4" aria-labelledby="style-guide-session-primitives">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-session-primitives">Session Primitives</span>}
          description="Shared sidebar and new-session building blocks. These are the stable anatomy contracts that composed surfaces should consume."
        />

        <div className="mt-6 space-y-4">
          <ComponentCard title="FavoriteCard">
            <ExampleSurface label="Selected">
              <FavoriteCard
                title="Codex Fast"
                shortcut="⌘2"
                summary="GPT-5.4 · high"
                accentColor="var(--color-accent-red)"
                selected
                onClick={() => {}}
              />
            </ExampleSurface>
            <ExampleSurface label="Modified">
              <FavoriteCard
                title="Review Squad"
                shortcut="⌘3"
                summary="2 agents · skip"
                accentColor="var(--color-accent-blue)"
                modified
                onClick={() => {}}
              />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="SectionHeader">
            <ExampleSurface label="Sidebar Grouping" className="min-w-[320px]">
              <SectionHeader
                title="Running Sessions"
                description="Counts, filter state, and shared header spacing should stay stable across composed views."
              />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="SessionCard">
            <ExampleSurface label="Running Session" className="min-w-[420px] flex-1">
              <SessionCardPreview />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Overlay Menus">
            <ExampleSurface label="Anchored Overlay">
              <OverlayMenuPreview />
            </ExampleSurface>
          </ComponentCard>
        </div>
      </div>
    </section>
  )
}
