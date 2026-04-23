import { memo, useEffect, useId, useMemo, useState, useRef } from 'react'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

interface MermaidDiagramProps {
  source: string
}

type RenderState =
  | { status: 'pending' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string }

function readThemeVariable(
  styles: CSSStyleDeclaration,
  element: HTMLDivElement | null,
  name: string,
  fallback: string
) {
  const computedValue = styles.getPropertyValue(name).trim()
  if (computedValue) return computedValue

  let current: HTMLElement | null = element
  while (current) {
    const inlineValue = current.style.getPropertyValue(name).trim()
    if (inlineValue) return inlineValue
    current = current.parentElement
  }

  return document.documentElement.style.getPropertyValue(name).trim() || fallback
}

function buildMermaidThemeVariables(element: HTMLDivElement | null) {
  const styles = window.getComputedStyle(element || document.documentElement)
  const getVar = (name: string, fallback: string) => readThemeVariable(styles, element, name, fallback)

  const isLight = getVar('--color-scheme', 'dark') === 'light'
  const background = getVar('--color-bg-primary', theme.colors.background.primary)
  const elevated = getVar('--color-bg-elevated', theme.colors.background.elevated)
  const secondary = getVar('--color-bg-secondary', theme.colors.background.secondary)
  const text = getVar('--color-text-primary', theme.colors.text.primary)
  const secondaryText = getVar('--color-text-secondary', theme.colors.text.secondary)
  const border = getVar('--color-border-subtle', theme.colors.border.subtle)
  const accent = getVar('--color-accent-blue', theme.colors.accent.blue.DEFAULT)
  const nodeFill = isLight ? secondary : elevated

  return {
    background,
    mainBkg: nodeFill,
    primaryColor: nodeFill,
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
    edgeLabelBackground: isLight ? background : secondary,
    noteBkgColor: isLight ? theme.colors.palette.yellow[100] : secondary,
    noteTextColor: isLight ? theme.colors.palette.blue[950] : secondaryText,
    noteBorderColor: isLight ? theme.colors.palette.yellow[600] : border,
    clusterBkg: secondary,
    clusterBorder: border,
    titleColor: text,
    sectionBkgColor: secondary,
    sectionBkgColor2: background,
  }
}

export const MermaidDiagram = memo(function MermaidDiagram({ source }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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
        if (cancelled) return

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: buildMermaidThemeVariables(containerRef.current),
        })
        return mermaid.render(diagramId, source)
      })
      .then(result => {
        if (result && !cancelled) {
          setState({ status: 'rendered', svg: result.svg })
        }
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
        ref={containerRef}
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
        ref={containerRef}
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
      ref={containerRef}
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
