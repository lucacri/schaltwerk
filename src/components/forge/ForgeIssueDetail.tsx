import { invoke } from '@tauri-apps/api/core'
import { VscArrowLeft, VscLinkExternal } from 'react-icons/vsc'
import type { ForgeIssueDetails, ForgeType, ForgeSourceConfig } from '../../types/forgeTypes'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import { MarkdownRenderer, type ForgeContext } from '../specs/MarkdownRenderer'
import { ForgeLabelChip } from './ForgeLabelChip'
import { ContextualActionButton } from './ContextualActionButton'

function isOpen(state: string): boolean {
  return state.toUpperCase() === 'OPEN' || state === 'opened'
}

interface ForgeIssueDetailProps {
  details: ForgeIssueDetails
  onBack: () => void
  sourceLabel?: string
  forgeType: ForgeType
  source?: ForgeSourceConfig
}

function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation()
  const open = isOpen(state)
  const label = open ? t.forgeIssueTab.opened : t.forgeIssueTab.closed
  const color = open ? 'var(--color-accent-green)' : 'var(--color-accent-red)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color,
        backgroundColor: open ? 'var(--color-accent-green-bg)' : 'var(--color-accent-red-bg)',
        borderRadius: 9999,
        padding: '2px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}

const markdownContainerStyle = {
  backgroundColor: 'var(--color-bg-tertiary)',
  borderRadius: 6,
  border: '1px solid var(--color-border-default)',
  overflow: 'hidden',
  wordBreak: 'break-word' as const,
}

export function ForgeIssueDetail({ details, onBack, sourceLabel, forgeType, source }: ForgeIssueDetailProps) {
  const { t } = useTranslation()
  const { summary, body, comments } = details

  const forgeContext: ForgeContext | undefined = source ? {
    forgeType,
    hostname: source.hostname,
    projectIdentifier: source.projectIdentifier,
  } : undefined
  const validComments = comments.filter(c => c.body && c.body.trim().length > 0)

  const handleOpenInBrowser = () => {
    if (!summary.url) return
    invoke<void>(TauriCommands.OpenExternalUrl, { url: summary.url }).catch((err: unknown) => {
      logger.warn(`[ForgeIssueDetail] Failed to open URL via Tauri (${forgeType}), falling back to window.open`, err)
      window.open(summary.url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-default)' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-secondary)',
            backgroundColor: 'transparent',
          }}
          title={t.forgeIssueTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.forgeIssueTab.back}</span>
        </button>

        <div className="flex-1" />

        {summary.url && (
          <button
            type="button"
            onClick={handleOpenInBrowser}
            className="flex items-center gap-1 px-2 py-1 rounded"
            style={{
              fontSize: theme.fontSize.caption,
              color: 'var(--color-accent-blue)',
              backgroundColor: 'transparent',
            }}
            title={t.forgeIssueTab.openInForge}
          >
            <VscLinkExternal className="w-3 h-3" />
            <span>{t.forgeIssueTab.openInForge}</span>
          </button>
        )}

        <ContextualActionButton
          context="issue"
          variables={{
            'issue.number': summary.id,
            'issue.title': summary.title ?? '',
            'issue.description': body ?? '',
            'issue.author': summary.author ?? '',
            'issue.assignees': summary.assignees?.join(', ') ?? '',
            'issue.labels': summary.labels.map(l => l.name).join(', '),
            'issue.url': summary.url ?? '',
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-start gap-2 mb-3">
          <StateBadge state={summary.state} />
          {sourceLabel && (
            <span
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                backgroundColor: 'var(--color-bg-elevated)',
                borderRadius: 9999,
                padding: '2px 8px',
                lineHeight: theme.lineHeight.badge,
              }}
            >
              {sourceLabel}
            </span>
          )}
        </div>

        <h3
          style={{
            fontSize: theme.fontSize.body,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 8,
            fontFamily: theme.fontFamily.sans,
            lineHeight: theme.lineHeight.body,
          }}
        >
          #{summary.id} {summary.title}
        </h3>

        {(summary.author || (summary.assignees && summary.assignees.length > 0) || summary.updatedAt) && (
          <div
            className="flex flex-wrap items-center gap-1 mb-2"
            style={{
              fontSize: theme.fontSize.caption,
              color: 'var(--color-text-muted)',
            }}
          >
            {summary.author && (
              <span>
                {t.forgeIssueTab.openedBy.replace('{author}', `@${summary.author}`)}
              </span>
            )}
            {summary.assignees && summary.assignees.length > 0 && (
              <>
                {summary.author && <span>·</span>}
                <span>
                  {t.forgeIssueTab.assignedTo.replace('{assignees}', `@${summary.assignees.join(', @')}`)}
                </span>
              </>
            )}
            {summary.updatedAt && (
              <>
                {(summary.author || (summary.assignees && summary.assignees.length > 0)) && <span>·</span>}
                <span>{t.forgeIssueTab.updated.replace('{time}', formatRelativeDate(summary.updatedAt))}</span>
              </>
            )}
          </div>
        )}

        {summary.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {summary.labels.map(label => (
              <ForgeLabelChip key={label.name} label={label} />
            ))}
          </div>
        )}

        {body && (
          <div className="mb-4">
            <div
              style={{
                fontSize: theme.fontSize.caption,
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t.forgeIssueTab.description}
            </div>
            <div style={markdownContainerStyle}>
              <MarkdownRenderer content={body} forgeContext={forgeContext} />
            </div>
          </div>
        )}

        <div>
          <div
            style={{
              fontSize: theme.fontSize.caption,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {t.forgeIssueTab.comments} ({validComments.length})
          </div>

          {validComments.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.forgeIssueTab.noComments}
            </div>
          ) : (
            <div className="space-y-2">
              {validComments.map((comment, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    border: '1px solid var(--color-border-default)',
                  }}
                >
                  <div
                    className="flex items-center gap-2 mb-1"
                    style={{
                      fontSize: theme.fontSize.caption,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {comment.author && (
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                        {comment.author}
                      </span>
                    )}
                    {comment.createdAt && (
                      <span>{formatRelativeDate(comment.createdAt)}</span>
                    )}
                  </div>
                  <div style={{ overflow: 'hidden', wordBreak: 'break-word' }}>
                    <MarkdownRenderer content={comment.body} forgeContext={forgeContext} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
