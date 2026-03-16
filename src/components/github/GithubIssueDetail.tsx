import { invoke } from '@tauri-apps/api/core'
import { VscArrowLeft, VscLinkExternal } from 'react-icons/vsc'
import type { GithubIssueDetails } from '../../types/githubIssues'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import { GithubLabelChip } from './GithubLabelChip'
import { ContextualActionButton } from '../gitlab/ContextualActionButton'

interface GithubIssueDetailProps {
  details: GithubIssueDetails
  onBack: () => void
}

function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation()
  const isOpen = state === 'OPEN'
  const label = isOpen ? t.githubIssueTab.opened : t.githubIssueTab.closed
  const color = isOpen ? 'var(--color-accent-green)' : 'var(--color-accent-red)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color,
        backgroundColor: isOpen ? 'var(--color-accent-green-bg)' : 'var(--color-accent-red-bg)',
        borderRadius: 9999,
        padding: '2px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}

export function GithubIssueDetail({ details, onBack }: GithubIssueDetailProps) {
  const { t } = useTranslation()

  const handleOpenInGithub = () => {
    invoke<void>(TauriCommands.OpenExternalUrl, { url: details.url }).catch((err: unknown) => {
      logger.warn('[GithubIssueDetail] Failed to open URL via Tauri, falling back to window.open', err)
      window.open(details.url, '_blank', 'noopener,noreferrer')
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
          title={t.githubIssueTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.githubIssueTab.back}</span>
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleOpenInGithub}
          className="flex items-center gap-1 px-2 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-blue)',
            backgroundColor: 'transparent',
          }}
          title={t.githubIssueTab.openInGithub}
        >
          <VscLinkExternal className="w-3 h-3" />
          <span>{t.githubIssueTab.openInGithub}</span>
        </button>

        <ContextualActionButton
          context="issue"
          variables={{
            'issue.title': details.title ?? '',
            'issue.description': details.body ?? '',
            'issue.author': '',
            'issue.labels': (details.labels ?? []).map(l => l.name).join(', '),
            'issue.url': details.url ?? '',
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3">
          <StateBadge state={details.state ?? 'OPEN'} />
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
          #{details.number} {details.title}
        </h3>

        {details.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {details.labels.map(label => (
              <GithubLabelChip key={label.name} label={label} />
            ))}
          </div>
        )}

        {details.body && (
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
              {t.githubIssueTab.description}
            </div>
            <div
              style={{
                fontSize: theme.fontSize.body,
                color: 'var(--color-text-secondary)',
                lineHeight: theme.lineHeight.body,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: theme.fontFamily.sans,
                backgroundColor: 'var(--color-bg-tertiary)',
                borderRadius: 6,
                padding: '8px 10px',
                border: '1px solid var(--color-border-default)',
              }}
            >
              {details.body}
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
            {t.githubIssueTab.comments} ({details.comments.length})
          </div>

          {details.comments.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.githubIssueTab.noComments}
            </div>
          ) : (
            <div className="space-y-2">
              {details.comments.map((comment, idx) => (
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
                    <span>{formatRelativeDate(comment.createdAt)}</span>
                  </div>
                  <div
                    style={{
                      fontSize: theme.fontSize.body,
                      color: 'var(--color-text-secondary)',
                      lineHeight: theme.lineHeight.body,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: theme.fontFamily.sans,
                    }}
                  >
                    {comment.body}
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
