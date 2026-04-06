import { useRef, useState } from 'react'
import { ConfirmDiscardDialog } from '../../components/common/ConfirmDiscardDialog'
import { ConfirmResetDialog } from '../../components/common/ConfirmResetDialog'
import { IconButton } from '../../components/common/IconButton'
import { InlineEditableText } from '../../components/common/InlineEditableText'
import { LoadingSpinner } from '../../components/common/LoadingSpinner'
import { SearchBox } from '../../components/common/SearchBox'
import { Button, SectionHeader, TextInput } from '../../components/ui'

function ComponentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
      <h3 className="text-body-large font-semibold text-text-primary">{title}</h3>
      <div className="mt-4 flex flex-wrap items-start gap-4">{children}</div>
    </div>
  )
}

function ExampleSurface({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[240px] flex-1 space-y-2 rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="text-caption uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  )
}

function InlineEditablePreview() {
  return (
    <div className="space-y-3">
      <InlineEditableText value="Review Squad" onSave={async () => {}} />
      <div className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5">
        <TextInput aria-label="Inline editable edit state" defaultValue="Review Squad" className="min-w-[180px]" />
      </div>
    </div>
  )
}

function SearchBoxPreview() {
  const targetRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative min-h-[220px] rounded-lg border border-border-subtle bg-bg-primary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-caption text-text-muted">Launch the real floating search box when you want to inspect highlight and focus treatment.</div>
        <Button size="sm" onClick={() => setVisible((current) => !current)}>
          {visible ? 'Hide Search Preview' : 'Show Search Preview'}
        </Button>
      </div>
      <SearchBox targetRef={targetRef} isVisible={visible} onClose={() => setVisible(false)} />
      <div ref={targetRef} className="max-w-xl space-y-3 pr-44 text-body text-text-secondary">
        <p>
          The style guide highlights <mark className="bg-yellow-400 text-black">theme</mark> matches in yellow and the active hit in
          <mark className="ml-1 bg-orange-400 text-black">orange</mark>.
        </p>
        <p>
          Search across mock settings content, dialog copy, and button labels to quickly evaluate contrast issues.
        </p>
        <p>
          Type a term like <span className="font-medium text-text-primary">theme</span> into the floating search box to preview the treatment.
        </p>
      </div>
    </div>
  )
}

function InlineOverlayPreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[220px] w-full min-w-[280px] overflow-hidden rounded-lg border border-border-subtle bg-bg-primary p-4 [&>div]:!static [&>div]:!inset-auto [&>div]:!z-auto [&>div]:!items-start [&>div]:!justify-start [&>div>div:first-child]:!hidden [&>div>div:last-child]:!mx-0 [&>div>div:last-child]:!w-full [&>div>div:last-child]:!max-w-none">
      {children}
    </div>
  )
}

export function CommonSection() {
  const [resetPreviewVisible, setResetPreviewVisible] = useState(false)
  const [discardPreviewVisible, setDiscardPreviewVisible] = useState(false)

  return (
    <section className="space-y-4" aria-labelledby="style-guide-common-components">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-common-components">Common Components</span>}
          description="Higher-level shared components, plus inline previews for fixed-position confirm dialogs."
        />

        <div className="mt-6 space-y-4">
          <ComponentCard title="InlineEditableText">
            <ExampleSurface label="Display + Edit Modes">
              <InlineEditablePreview />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="IconButton">
            <ExampleSurface label="Variants">
              <div className="flex flex-wrap gap-2">
                <IconButton ariaLabel="Default action" tooltip="Default action" icon={<span>+</span>} onClick={() => {}} />
                <IconButton ariaLabel="Danger action" tooltip="Danger action" icon={<span>!</span>} variant="danger" onClick={() => {}} />
                <IconButton ariaLabel="Success action" tooltip="Success action" icon={<span>✓</span>} variant="success" onClick={() => {}} />
                <IconButton ariaLabel="Warning action" tooltip="Warning action" icon={<span>?</span>} variant="warning" onClick={() => {}} />
                <IconButton ariaLabel="Disabled action" icon={<span>x</span>} disabled onClick={() => {}} />
              </div>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="LoadingSpinner">
            <ExampleSurface label="Default">
              <LoadingSpinner />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="SearchBox">
            <ExampleSurface label="Mock Results + Highlight Colors">
              <SearchBoxPreview />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="ConfirmResetDialog">
            <ExampleSurface label="Inline Slate Preview">
              <InlineOverlayPreview>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-caption text-text-muted">Open the reset dialog preview only when you want to inspect the live modal treatment.</div>
                  <Button size="sm" onClick={() => setResetPreviewVisible((current) => !current)}>
                    {resetPreviewVisible ? 'Hide Reset Dialog Preview' : 'Show Reset Dialog Preview'}
                  </Button>
                </div>
                {resetPreviewVisible ? <ConfirmResetDialog open onConfirm={() => setResetPreviewVisible(false)} onCancel={() => setResetPreviewVisible(false)} /> : null}
              </InlineOverlayPreview>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="ConfirmDiscardDialog">
            <ExampleSurface label="Inline Slate Preview">
              <InlineOverlayPreview>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-caption text-text-muted">Open the discard dialog preview only when you want to inspect the live modal treatment.</div>
                  <Button size="sm" onClick={() => setDiscardPreviewVisible((current) => !current)}>
                    {discardPreviewVisible ? 'Hide Discard Dialog Preview' : 'Show Discard Dialog Preview'}
                  </Button>
                </div>
                {discardPreviewVisible ? (
                  <ConfirmDiscardDialog
                    open
                    filePath="src/style-guide/StyleGuide.tsx"
                    onConfirm={() => setDiscardPreviewVisible(false)}
                    onCancel={() => setDiscardPreviewVisible(false)}
                  />
                ) : null}
              </InlineOverlayPreview>
            </ExampleSurface>
          </ComponentCard>
        </div>
      </div>
    </section>
  )
}
