import { useState } from 'react'
import { ConfirmModal } from '../../components/modals/ConfirmModal'
import { LinkPrModal } from '../../components/modals/LinkPrModal'
import { Button, SectionHeader } from '../../components/ui'

function InlineModalPreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[340px] overflow-hidden rounded-lg border border-border-subtle bg-bg-primary p-4 [&>div]:!static [&>div]:!inset-auto [&>div]:!z-auto [&>div]:!bg-transparent [&>div]:!items-start [&>div]:!justify-start [&>div>div]:!mx-0 [&>div>div]:!max-w-none">
      {children}
    </div>
  )
}

export function DialogsSection() {
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [linkPrModalOpen, setLinkPrModalOpen] = useState(false)

  return (
    <section className="space-y-4" aria-labelledby="style-guide-dialogs-and-modals">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-dialogs-and-modals">Dialogs And Modals</span>}
          description="Representative inline modal content for components that normally render through fullscreen overlays or integration-heavy contexts."
        />

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <InlineModalPreview>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-caption text-text-muted">Open the live confirm modal preview only when you want to inspect its keyboard and focus treatment.</p>
              <Button size="sm" onClick={() => setConfirmModalOpen((current) => !current)}>
                {confirmModalOpen ? 'Hide ConfirmModal Preview' : 'Show ConfirmModal Preview'}
              </Button>
            </div>
            {confirmModalOpen ? (
              <ConfirmModal
                open
                title="Confirm action"
                body={<p className="text-sm text-slate-300">Confirm modal bodies can carry destructive or neutral actions while keeping the same hardcoded slate shell.</p>}
                confirmText="Continue"
                onConfirm={() => setConfirmModalOpen(false)}
                onCancel={() => setConfirmModalOpen(false)}
              />
            ) : null}
          </InlineModalPreview>

          <InlineModalPreview>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-caption text-text-muted">Open the live pull request picker preview when you want to inspect the real search and list states.</p>
              <Button size="sm" onClick={() => setLinkPrModalOpen((current) => !current)}>
                {linkPrModalOpen ? 'Hide Link PR Preview' : 'Show Link PR Preview'}
              </Button>
            </div>
            {linkPrModalOpen ? <LinkPrModal open onConfirm={() => setLinkPrModalOpen(false)} onCancel={() => setLinkPrModalOpen(false)} /> : null}
          </InlineModalPreview>
        </div>
      </div>
    </section>
  )
}
