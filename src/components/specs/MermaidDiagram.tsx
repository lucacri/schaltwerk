import { memo, useEffect, useId, useMemo, useState } from 'react'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

interface MermaidDiagramProps {
  source: string
}

type RenderState =
  | { status: 'pending' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string }

function cssColor(variableName: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback
}

function buildMermaidThemeVariables() {
  const background = cssColor('--color-bg-primary', theme.colors.background.primary)
  const elevated = cssColor('--color-bg-elevated', theme.colors.background.elevated)
  const secondary = cssColor('--color-bg-secondary', theme.colors.background.secondary)
  const text = cssColor('--color-text-primary', theme.colors.text.primary)
  const secondaryText = cssColor('--color-text-secondary', theme.colors.text.secondary)
  const border = cssColor('--color-border-subtle', theme.colors.border.subtle)
  const accent = cssColor('--color-accent-blue', theme.colors.accent.blue.DEFAULT)

  return {
    background,
    mainBkg: elevated,
    primaryColor: elevated,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: secondary,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: text,
    tertiaryBorderColor: border,
    lineColor: accent,
    textColor: text,
    edgeLabelBackground: secondary,
    noteBkgColor: secondary,
    noteTextColor: secondaryText,
    noteBorderColor: border,
    clusterBkg: secondary,
    clusterBorder: border,
  }
}

export const MermaidDiagram = memo(function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId()
  const diagramId = useMemo(
    () => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId]
  )
  const [state, setState] = useState<RenderState>({ status: 'pending' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'pending' })

    import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: buildMermaidThemeVariables(),
        })
        return mermaid.render(diagramId, source)
      })
      .then(({ svg }) => {
        if (!cancelled) setState({ status: 'rendered', svg })
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[MermaidDiagram] Failed to render diagram', { error: message })
        if (!cancelled) setState({ status: 'error', message })
      })

    return () => { cancelled = true }
  }, [diagramId, source])

  if (state.status === 'error') {
    return (
      <div
        data-testid="mermaid-diagram-error"
        role="note"
        style={{
          marginTop: '1em',
          marginBottom: '1em',
          padding: '12px',
          borderRadius: 4,
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-primary)',
        }}
      >
        <div style={{
          color: 'var(--color-text-secondary)',
          fontSize: theme.fontSize.caption,
          marginBottom: '8px',
          fontWeight: 'bold',
        }}>
          Unable to render Mermaid diagram.
        </div>
        <pre style={{
          margin: 0,
          color: 'var(--color-text-primary)',
          fontSize: theme.fontSize.code,
          fontFamily: 'var(--font-family-mono)',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
{source}
        </pre>
      </div>
    )
  }

  if (state.status === 'pending') {
    return (
      <div
        data-testid="mermaid-diagram"
        data-state="pending"
        role="status"
        aria-label="Rendering Mermaid diagram"
        style={{
          marginTop: '1em',
          marginBottom: '1em',
          minHeight: 120,
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 4,
          backgroundColor: 'var(--color-bg-elevated)',
        }}
      />
    )
  }

  return (
    <div
      data-testid="mermaid-diagram"
      data-state="rendered"
      className="mermaid-diagram"
      style={{
        marginTop: '1em',
        marginBottom: '1em',
        maxWidth: '100%',
        overflowX: 'auto',
        color: 'var(--color-text-primary)',
        display: 'flex',
        justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
})
