import type { ResolvedTheme } from '../src/common/themes/types'

const THEMES: { id: ResolvedTheme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'tokyonight', label: 'Tokyo Night' },
  { id: 'catppuccin', label: 'Catppuccin Mocha' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
  { id: 'everforest', label: 'Everforest' },
  { id: 'ayu', label: 'Ayu Dark' },
  { id: 'gruvbox', label: 'Gruvbox' },
  { id: 'darcula', label: 'Darcula' },
  { id: 'kanagawa', label: 'Kanagawa' },
]

interface ControlsProps {
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  isCollapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function Controls({ sidebarWidth, onSidebarWidthChange, isCollapsed, onCollapsedChange }: ControlsProps) {
  const currentTheme = document.documentElement.getAttribute('data-theme') ?? 'dark'

  function setTheme(themeId: string) {
    document.documentElement.setAttribute('data-theme', themeId)
    document.documentElement.style.colorScheme = themeId === 'light' ? 'light' : 'dark'
  }

  return (
    <div className="max-w-md space-y-6 font-[var(--font-family-sans)]" style={{ fontFamily: 'var(--font-family-sans)' }}>
      <h1 className="text-xl font-semibold text-primary">Sidebar Playground</h1>
      <p className="text-sm text-secondary">
        Visual sandbox for the Lucode sidebar. Changes here affect only this preview.
      </p>

      <Section title="Theme">
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTheme(id)}
              className={`rounded px-3 py-1.5 text-left text-sm transition-colors ${
                currentTheme === id
                  ? 'bg-accent-blue text-white'
                  : 'bg-elevated text-secondary hover:text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sidebar Width">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={200}
            max={500}
            value={sidebarWidth}
            onChange={(e) => onSidebarWidthChange(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right text-sm text-tertiary tabular-nums">{sidebarWidth}px</span>
        </div>
      </Section>

      <Section title="Layout">
        <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={isCollapsed}
            onChange={(e) => onCollapsedChange(e.target.checked)}
          />
          Collapsed rail mode
        </label>
      </Section>

      <Section title="Info">
        <p className="text-xs text-tertiary">
          This playground renders the real Sidebar component with mocked Tauri APIs.
          Sessions come from static mock data. Backend commands are no-ops.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-primary">{title}</h2>
      {children}
    </div>
  )
}
