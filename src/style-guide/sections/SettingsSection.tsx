import { AgentPresetsSettings } from '../../components/settings/AgentPresetsSettings'
import { AgentVariantsSettings } from '../../components/settings/AgentVariantsSettings'
import { ContextualActionsSettings } from '../../components/settings/ContextualActionsSettings'
import { ThemeSettings } from '../../components/settings/ThemeSettings'
import { SectionHeader } from '../../components/ui'

function PanelSurface({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5">{children}</div>
}

export function SettingsSection() {
  return (
    <section className="space-y-4" aria-labelledby="style-guide-settings-panels">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-settings-panels">Settings Panels</span>}
          description="Real settings components backed by browser-side mock command responses instead of the Tauri backend."
        />

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <PanelSurface>
            <AgentVariantsSettings />
          </PanelSurface>
          <PanelSurface>
            <AgentPresetsSettings />
          </PanelSurface>
          <PanelSurface>
            <ContextualActionsSettings />
          </PanelSurface>
          <PanelSurface>
            <ThemeSettings />
          </PanelSurface>
        </div>
      </div>
    </section>
  )
}
