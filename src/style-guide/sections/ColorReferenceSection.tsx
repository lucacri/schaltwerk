import { useEffect, useState } from 'react'
import type { ResolvedTheme } from '../../common/themes/types'
import { SectionHeader } from '../../components/ui'

type SwatchKind = 'background' | 'text' | 'border'

interface SwatchDefinition {
  name: string
  cssVariable: string
  kind: SwatchKind
}

const SWATCH_GROUPS: Array<{ title: string; items: SwatchDefinition[] }> = [
  {
    title: 'Background Scale',
    items: [
      { name: 'bg-primary', cssVariable: '--color-bg-primary', kind: 'background' },
      { name: 'bg-secondary', cssVariable: '--color-bg-secondary', kind: 'background' },
      { name: 'bg-tertiary', cssVariable: '--color-bg-tertiary', kind: 'background' },
      { name: 'bg-elevated', cssVariable: '--color-bg-elevated', kind: 'background' },
      { name: 'bg-hover', cssVariable: '--color-bg-hover', kind: 'background' },
      { name: 'bg-active', cssVariable: '--color-bg-active', kind: 'background' },
    ],
  },
  {
    title: 'Text Scale',
    items: [
      { name: 'text-primary', cssVariable: '--color-text-primary', kind: 'text' },
      { name: 'text-secondary', cssVariable: '--color-text-secondary', kind: 'text' },
      { name: 'text-tertiary', cssVariable: '--color-text-tertiary', kind: 'text' },
      { name: 'text-muted', cssVariable: '--color-text-muted', kind: 'text' },
      { name: 'text-inverse', cssVariable: '--color-text-inverse', kind: 'text' },
    ],
  },
  {
    title: 'Border Scale',
    items: [
      { name: 'border-default', cssVariable: '--color-border-default', kind: 'border' },
      { name: 'border-subtle', cssVariable: '--color-border-subtle', kind: 'border' },
      { name: 'border-strong', cssVariable: '--color-border-strong', kind: 'border' },
      { name: 'border-focus', cssVariable: '--color-border-focus', kind: 'border' },
    ],
  },
  {
    title: 'Status',
    items: [
      { name: 'status-info', cssVariable: '--color-status-info', kind: 'background' },
      { name: 'status-success', cssVariable: '--color-status-success', kind: 'background' },
      { name: 'status-warning', cssVariable: '--color-status-warning', kind: 'background' },
      { name: 'status-error', cssVariable: '--color-status-error', kind: 'background' },
    ],
  },
  {
    title: 'Accents',
    items: [
      { name: 'accent-blue', cssVariable: '--color-accent-blue', kind: 'background' },
      { name: 'accent-green', cssVariable: '--color-accent-green', kind: 'background' },
      { name: 'accent-amber', cssVariable: '--color-accent-amber', kind: 'background' },
      { name: 'accent-red', cssVariable: '--color-accent-red', kind: 'background' },
      { name: 'accent-violet', cssVariable: '--color-accent-violet', kind: 'background' },
      { name: 'accent-cyan', cssVariable: '--color-accent-cyan', kind: 'background' },
    ],
  },
  {
    title: 'Control Variables',
    items: [
      { name: 'control-bg', cssVariable: '--control-bg', kind: 'background' },
      { name: 'control-border', cssVariable: '--control-border', kind: 'border' },
      { name: 'control-border-focus', cssVariable: '--control-border-focus', kind: 'border' },
    ],
  },
]

function rgbToHex(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) {
    return value.trim() || 'n/a'
  }

  return `#${[match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

function resolveCssVariableValue(cssVariable: string) {
  if (typeof document === 'undefined') {
    return 'n/a'
  }

  const probe = document.createElement('div')
  probe.style.color = `var(${cssVariable})`
  probe.style.position = 'fixed'
  probe.style.pointerEvents = 'none'
  probe.style.opacity = '0'
  document.body.appendChild(probe)
  const value = rgbToHex(window.getComputedStyle(probe).color)
  probe.remove()
  return value
}

function SwatchPreview({ swatch }: { swatch: SwatchDefinition }) {
  if (swatch.kind === 'text') {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-4" style={{ color: `var(${swatch.cssVariable})` }}>
        Sample text
      </div>
    )
  }

  if (swatch.kind === 'border') {
    return (
      <div className="rounded-lg bg-bg-primary px-3 py-4 text-text-secondary" style={{ border: `2px solid var(${swatch.cssVariable})` }}>
        Border preview
      </div>
    )
  }

  return <div className="h-14 rounded-lg border border-border-subtle" style={{ backgroundColor: `var(${swatch.cssVariable})` }} />
}

export function ColorReferenceSection({ resolvedTheme }: { resolvedTheme: ResolvedTheme }) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const nextValues: Record<string, string> = {}
    for (const group of SWATCH_GROUPS) {
      for (const swatch of group.items) {
        nextValues[swatch.cssVariable] = resolveCssVariableValue(swatch.cssVariable)
      }
    }
    setValues(nextValues)
  }, [resolvedTheme])

  return (
    <section className="space-y-4" aria-labelledby="style-guide-color-reference">
      <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-5">
        <SectionHeader
          title={<span id="style-guide-color-reference">Color And Border Reference</span>}
          description={`Resolved token values for the active ${resolvedTheme} theme.`}
        />

        <div className="mt-6 space-y-6">
          {SWATCH_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h3 className="text-body-large font-semibold text-text-primary">{group.title}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((swatch) => (
                  <div key={swatch.cssVariable} className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
                    <div className="space-y-1">
                      <div className="text-body font-medium text-text-primary">{swatch.name}</div>
                      <div className="font-mono text-caption text-text-muted">{swatch.cssVariable}</div>
                      <div className="font-mono text-caption text-text-secondary">{values[swatch.cssVariable] ?? 'n/a'}</div>
                    </div>
                    <div className="mt-4">
                      <SwatchPreview swatch={swatch} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
