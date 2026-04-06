import { Button, Checkbox, FormGroup, Label, SectionHeader, Select, TextInput, Textarea, Toggle } from '../../components/ui'

const selectOptions = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'copilot', label: 'Copilot' },
]

const manySelectOptions = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'droid', label: 'Factory Droid' },
  { value: 'amp', label: 'Amp' },
  { value: 'kilocode', label: 'Kilo Code' },
]

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
    <div className="min-w-[180px] space-y-2 rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="text-caption uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  )
}

function SimpleIcon({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-4 w-4 items-center justify-center text-caption">{children}</span>
}

export function PrimitivesSection() {
  return (
    <section className="space-y-4" aria-labelledby="style-guide-primitives">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-primitives">Primitives</span>}
          description="Core controls from src/components/ui rendered with representative states and variants."
        />

        <div className="mt-6 space-y-4">
          <ComponentCard title="Button">
            <ExampleSurface label="Variants · Small">
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Default</Button>
                <Button size="sm" variant="primary">Primary</Button>
                <Button size="sm" variant="danger">Danger</Button>
                <Button size="sm" variant="ghost">Ghost</Button>
                <Button size="sm" variant="dashed">Dashed</Button>
              </div>
            </ExampleSurface>
            <ExampleSurface label="Variants · Medium">
              <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="primary">Primary</Button>
                <Button variant="danger">Danger</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="dashed">Dashed</Button>
              </div>
            </ExampleSurface>
            <ExampleSurface label="Disabled + Loading">
              <div className="flex flex-wrap gap-2">
                <Button disabled>Disabled</Button>
                <Button variant="primary" loading>Loading</Button>
                <Button variant="ghost" leftIcon={<SimpleIcon>*</SimpleIcon>}>With Icon</Button>
              </div>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="TextInput">
            <ExampleSurface label="Default">
              <TextInput aria-label="Default text input" />
            </ExampleSurface>
            <ExampleSurface label="Placeholder">
              <TextInput aria-label="Placeholder text input" placeholder="Search sessions..." />
            </ExampleSurface>
            <ExampleSurface label="Value">
              <TextInput aria-label="Value text input" defaultValue="lucode/style-guide" />
            </ExampleSurface>
            <ExampleSurface label="Left Icon">
              <TextInput aria-label="Icon text input" placeholder="Project path" leftIcon={<SimpleIcon>/</SimpleIcon>} />
            </ExampleSurface>
            <ExampleSurface label="Error">
              <TextInput aria-label="Error text input" defaultValue="bad branch name" error="Branch names cannot contain spaces" />
            </ExampleSurface>
            <ExampleSurface label="Disabled">
              <TextInput aria-label="Disabled text input" defaultValue="Read only value" disabled />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Textarea">
            <ExampleSurface label="Default">
              <Textarea aria-label="Default textarea" rows={4} placeholder="Describe the current issue..." />
            </ExampleSurface>
            <ExampleSurface label="Monospace">
              <Textarea aria-label="Monospace textarea" rows={4} monospace defaultValue={'bun run dev\njust test'} />
            </ExampleSurface>
            <ExampleSurface label="With Value">
              <Textarea aria-label="Value textarea" rows={4} defaultValue={'Follow the repo workflow:\n1. run tests\n2. verify visuals\n3. commit once'} />
            </ExampleSurface>
            <ExampleSurface label="Disabled">
              <Textarea aria-label="Disabled textarea" rows={4} disabled defaultValue={'Readonly command preview'} />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Select">
            <ExampleSurface label="Default">
              <Select aria-label="Default select" value="" onChange={() => {}} options={selectOptions} placeholder="Choose agent" />
            </ExampleSurface>
            <ExampleSurface label="Selected">
              <Select aria-label="Selected select" value="codex" onChange={() => {}} options={selectOptions} />
            </ExampleSurface>
            <ExampleSurface label="Disabled">
              <Select aria-label="Disabled select" value="claude" onChange={() => {}} options={selectOptions} disabled />
            </ExampleSurface>
            <ExampleSurface label="Many Options">
              <Select aria-label="Many options select" value="opencode" onChange={() => {}} options={manySelectOptions} />
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Checkbox">
            <ExampleSurface label="States">
              <div className="space-y-3">
                <Checkbox checked={false} onChange={() => {}} label="Unchecked" />
                <Checkbox checked onChange={() => {}} label="Checked" />
                <Checkbox checked={false} indeterminate onChange={() => {}} label="Indeterminate" />
                <Checkbox checked onChange={() => {}} disabled label="Disabled" />
              </div>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Toggle">
            <ExampleSurface label="States">
              <div className="space-y-3">
                <Toggle checked onChange={() => {}} label="On with label" />
                <Toggle checked={false} onChange={() => {}} label="Off with label" />
                <div className="flex items-center gap-3">
                  <Toggle checked onChange={() => {}} />
                  <Toggle checked={false} onChange={() => {}} disabled />
                </div>
              </div>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="FormGroup">
            <ExampleSurface label="Label">
              <FormGroup label="Branch Name">
                <TextInput aria-label="Branch name" placeholder="feature/style-guide" />
              </FormGroup>
            </ExampleSurface>
            <ExampleSurface label="Description">
              <FormGroup label="Prompt" help="This text is shown to the selected coding agent.">
                <Textarea aria-label="Prompt" rows={4} placeholder="Investigate the failing build..." />
              </FormGroup>
            </ExampleSurface>
            <ExampleSurface label="Error">
              <FormGroup label="Session Name" error="Session names must be unique.">
                <TextInput aria-label="Session name" defaultValue="review squad" />
              </FormGroup>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="Label">
            <ExampleSurface label="Default">
              <Label>Default Label</Label>
            </ExampleSurface>
          </ComponentCard>

          <ComponentCard title="SectionHeader">
            <ExampleSurface label="Title + Description">
              <SectionHeader title="Agent Configuration" description="Saved presets and variants for common launch setups." />
            </ExampleSurface>
          </ComponentCard>
        </div>
      </div>
    </section>
  )
}
