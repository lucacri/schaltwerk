import { Children, isValidElement, memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { useOptionalToast } from '../../common/toast/ToastProvider'
import { useTranslation } from '../../common/i18n'
import type { ForgeType } from '../../types/forgeTypes'
import { MermaidDiagram } from './MermaidDiagram'

function isMermaidLanguage(className?: string): boolean {
  return className?.split(/\s+/).includes('language-mermaid') ?? false
}

function codeText(children: React.ReactNode): string {
  return String(children).replace(/\n$/, '')
}

export interface ForgeContext {
  forgeType: ForgeType
  hostname?: string
  projectIdentifier?: string
}

interface MarkdownRendererProps {
  content: string
  className?: string
  forgeContext?: ForgeContext
  fillHeight?: boolean
}

const LinkComponent = memo(function LinkComponent({ href, children }: { href?: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const toast = useOptionalToast()

  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (!href) return

    invoke<void>(TauriCommands.OpenExternalUrl, { url: href }).catch(error => {
      logger.warn('[MarkdownRenderer] Failed to open external link', { url: href, error })
      toast?.pushToast({
        tone: 'error',
        title: t.toasts.failedToOpenLink,
        description: typeof error === 'string' ? error : t.toasts.failedToOpenLinkDesc,
      })
    })
  }, [href, toast, t])

  return (
    <a
      href={href}
      onClick={handleLinkClick}
      style={{
        color: 'var(--color-accent-blue)',
        textDecoration: 'underline',
        cursor: 'pointer'
      }}
    >
      {children}
    </a>
  )
})

const imageCache = new Map<string, string>()

function GitLabImage({ src, alt, forgeContext }: { src?: string; alt?: string; forgeContext: ForgeContext }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!src || !src.startsWith('http')) {
      setImageSrc(src ?? null)
      setLoading(false)
      return
    }

    const cached = imageCache.get(src)
    if (cached) {
      setImageSrc(cached)
      setLoading(false)
      return
    }

    let disposed = false
    invoke<string>(TauriCommands.ForgeProxyImage, {
      imageUrl: src,
      forgeType: forgeContext.forgeType,
      hostname: forgeContext.hostname ?? null,
    })
      .then(dataUrl => {
        imageCache.set(src, dataUrl)
        if (!disposed) {
          setImageSrc(dataUrl)
          setLoading(false)
        }
      })
      .catch(err => {
        logger.warn('[MarkdownRenderer] Failed to proxy GitLab image', { src, error: err })
        if (!disposed) {
          setImageSrc(src)
          setLoading(false)
          setError(true)
        }
      })

    return () => { disposed = true }
  }, [src, forgeContext])

  if (loading) {
    return (
      <span style={{
        display: 'inline-block',
        width: 200,
        height: 100,
        backgroundColor: 'var(--color-bg-elevated)',
        borderRadius: 4,
        border: '1px solid var(--color-border-subtle)',
      }} />
    )
  }

  return (
    <img
      src={imageSrc ?? src}
      alt={alt ?? ''}
      style={{
        maxWidth: '100%',
        borderRadius: 4,
      }}
      data-proxy-error={error || undefined}
    />
  )
}

const customComponents: Partial<Components> = {
  h1: ({ children }) => (
    <h1 style={{
      fontSize: theme.fontSize.display,
      fontWeight: 'bold',
      marginTop: '0.67em',
      marginBottom: '0.67em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{
      fontSize: theme.fontSize.headingXLarge,
      fontWeight: 'bold',
      marginTop: '0.83em',
      marginBottom: '0.83em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{
      fontSize: theme.fontSize.headingLarge,
      fontWeight: 'bold',
      marginTop: '1em',
      marginBottom: '1em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{
      fontSize: theme.fontSize.heading,
      fontWeight: 'bold',
      marginTop: '1.33em',
      marginBottom: '1.33em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{
      fontSize: theme.fontSize.bodyLarge,
      fontWeight: 'bold',
      marginTop: '1.67em',
      marginBottom: '1.67em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{
      fontSize: theme.fontSize.body,
      fontWeight: 'bold',
      marginTop: '2.33em',
      marginBottom: '2.33em',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p style={{
      marginTop: '1em',
      marginBottom: '1em',
      lineHeight: '1.6',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <LinkComponent href={href}>
      {children}
    </LinkComponent>
  ),
  code: ({ children, className }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code style={{
          backgroundColor: 'var(--color-bg-elevated)',
          color: 'var(--color-accent-cyan)',
          padding: '2px 4px',
          borderRadius: '3px',
          fontSize: theme.fontSize.code,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}>
          {children}
        </code>
      )
    }
    if (isMermaidLanguage(className)) {
      return <MermaidDiagram source={codeText(children).trim()} />
    }
    return (
      <code
        className={className}
        style={{
          display: 'block',
          backgroundColor: 'var(--color-bg-elevated)',
          color: 'var(--color-text-primary)',
          padding: '12px',
          borderRadius: '4px',
          overflowX: 'auto',
          fontSize: theme.fontSize.code,
          lineHeight: '1.5',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => {
    const child = Children.toArray(children)[0]
    if (isValidElement(child)) {
      const props = child.props as { className?: string }
      if (isMermaidLanguage(props.className) || child.type === MermaidDiagram) {
        return <>{children}</>
      }
    }

    return (
      <pre style={{
        marginTop: '1em',
        marginBottom: '1em',
        overflow: 'auto'
      }}>
        {children}
      </pre>
    )
  },
  ul: ({ children }) => (
    <ul style={{
      marginTop: '1em',
      marginBottom: '1em',
      paddingLeft: '2em',
      listStyleType: 'disc',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{
      marginTop: '1em',
      marginBottom: '1em',
      paddingLeft: '2em',
      listStyleType: 'decimal',
      color: 'var(--color-text-primary)'
    }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{
      marginTop: '0.25em',
      marginBottom: '0.25em',
      lineHeight: '1.6'
    }}>
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: '3px solid var(--color-border-default)',
      paddingLeft: '1em',
      marginLeft: '0',
      marginTop: '1em',
      marginBottom: '1em',
      fontStyle: 'italic',
      color: 'var(--color-text-secondary)'
    }}>
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--color-border-subtle)',
      marginTop: '2em',
      marginBottom: '2em'
    }} />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginTop: '1em', marginBottom: '1em' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        color: 'var(--color-text-primary)'
      }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{
      borderBottom: '2px solid var(--color-border-default)'
    }}>
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr style={{
      borderBottom: '1px solid var(--color-border-subtle)'
    }}>
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th style={{
      padding: '8px 12px',
      textAlign: 'left',
      fontWeight: 'bold',
      backgroundColor: 'var(--color-bg-secondary)'
    }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{
      padding: '8px 12px'
    }}>
      {children}
    </td>
  ),
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  forgeContext,
  fillHeight = true,
}: MarkdownRendererProps) {
  const components = useMemo(() => {
    if (!forgeContext || forgeContext.forgeType !== 'gitlab') {
      return customComponents
    }
    return {
      ...customComponents,
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <GitLabImage src={src} alt={alt} forgeContext={forgeContext} />
      ),
    }
  }, [forgeContext])

  return (
    <div
      className={`markdown-renderer markdown-github-light ${className}`}
      style={{
        padding: '16px',
        ...(fillHeight
          ? { overflowY: 'auto' as const, height: '100%' }
          : {}),
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontSize: theme.fontSize.body,
        lineHeight: '1.6'
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
