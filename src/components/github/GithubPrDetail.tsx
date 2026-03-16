import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscArrowLeft, VscLinkExternal } from 'react-icons/vsc'
import type { GithubPrDetails } from '../../types/githubIssues'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import { GithubLabelChip } from './GithubLabelChip'
import { ContextualActionButton } from '../gitlab/ContextualActionButton'

interface GithubPrDetailProps {
  details: GithubPrDetails
  onBack: () => void
}

function PrStateBadge({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string
  let bgColor: string

  switch (state) {
    case 'MERGED':
      label = t.githubPrTab.merged
      color = 'var(--color-accent-violet)'
      bgColor = 'var(--color-accent-violet-bg)'
      break
    case 'CLOSED':
      label = t.githubPrTab.closed
      color = 'var(--color-accent-red)'
      bgColor = 'var(--color-accent-red-bg)'
      break
    default:
      label = t.githubPrTab.opened
      color = 'var(--color-accent-green)'
      bgColor = 'var(--color-accent-green-bg)'
      break
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color,
        backgroundColor: bgColor,
        borderRadius: 9999,
        padding: '2px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}

function BranchPill({ branch }: { branch: string }) {
  return (
    <span
      style={{
        fontSize: theme.fontSize.caption,
        fontFamily: theme.fontFamily.mono,
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 4,
        padding: '1px 6px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {branch}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  )
}

export function GithubPrDetail({ details, onBack }: GithubPrDetailProps) {
  const { t } = useTranslation()

  const handleOpenInGithub = () => {
    invoke<void>(TauriCommands.OpenExternalUrl, { url: details.url }).catch((err: unknown) => {
      logger.warn('[GithubPrDetail] Failed to open URL via Tauri, falling back to window.open', err)
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
          title={t.githubPrTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.githubPrTab.back}</span>
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
          title={t.githubPrTab.openInGithub}
        >
          <VscLinkExternal className="w-3 h-3" />
          <span>{t.githubPrTab.openInGithub}</span>
        </button>

        <ContextualActionButton
          context="pr"
          variables={{
            'pr.title': details.title ?? '',
            'pr.description': details.body ?? '',
            'pr.headRefName': details.headRefName ?? '',
            'pr.url': details.url ?? '',
            'pr.labels': (details.labels ?? []).map(l => l.name).join(', '),
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-start gap-2 mb-3 flex-wrap">
          <PrStateBadge state={details.state ?? 'OPEN'} />
          {details.reviewDecision && (
             <span
             style={{
               display: 'inline-flex',
               alignItems: 'center',
               gap: 4,
               fontSize: theme.fontSize.caption,
               fontWeight: 600,
               color: details.reviewDecision === 'APPROVED' ? 'var(--color-accent-green)' : 'var(--color-accent-red)',
               backgroundColor: details.reviewDecision === 'APPROVED' ? 'var(--color-accent-green-bg)' : 'var(--color-accent-red-bg)',
               borderRadius: 9999,
               padding: '2px 8px',
               lineHeight: theme.lineHeight.badge,
             }}
           >
             {details.reviewDecision}
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
          #{details.number} {details.title}
        </h3>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SectionLabel>{t.githubPrTab.headBranch}:</SectionLabel>
          <BranchPill branch={details.headRefName} />
        </div>

        {details.statusCheckState && (
          <div className="mb-3">
            <SectionLabel>{t.githubPrTab.statusChecks}</SectionLabel>
            <span style={{ 
              fontSize: theme.fontSize.caption, 
              color: details.statusCheckState === 'SUCCESS' ? 'var(--color-accent-green)' : 
                     details.statusCheckState === 'FAILURE' ? 'var(--color-accent-red)' : 'var(--color-accent-amber)'
            }}>
              {details.statusCheckState}
            </span>
          </div>
        )}

        {details.latestReviews.length > 0 && (
          <div className="mb-3">
            <SectionLabel>{t.githubPrTab.reviews}</SectionLabel>
            <div className="space-y-1">
              {details.latestReviews.map((review, idx) => (
                <div key={idx} className="flex items-center gap-2" style={{ fontSize: theme.fontSize.caption }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{review.author}</span>
                  <span style={{ 
                    color: review.state === 'APPROVED' ? 'var(--color-accent-green)' : 
                           review.state === 'CHANGES_REQUESTED' ? 'var(--color-accent-red)' : 'var(--color-text-muted)'
                  }}>{review.state}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{formatRelativeDate(review.submittedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {details.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {details.labels.map(label => (
              <GithubLabelChip key={label.name} label={label} />
            ))}
          </div>
        )}

        {details.body && (
          <div className="mb-4">
            <SectionLabel>{t.githubPrTab.description}</SectionLabel>
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
          <SectionLabel>
            {t.githubPrTab.comments} ({details.comments.length})
          </SectionLabel>

          {details.comments.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.githubPrTab.noComments}
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
