import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscArrowLeft, VscLinkExternal, VscCheck, VscGitMerge, VscComment, VscChevronDown, VscChevronRight } from 'react-icons/vsc'
import type { ForgePrDetails, ForgePipelineJob, ForgeType } from '../../types/forgeTypes'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { ForgeLabelChip } from './ForgeLabelChip'
import { PipelineStatusBadge } from './PipelineStatusBadge'
import { ContextualActionButton } from './ContextualActionButton'

interface ForgePrDetailProps {
  details: ForgePrDetails
  onBack: () => void
  sourceLabel?: string
  forgeType: ForgeType
  onRefreshPipeline?: () => Promise<void>
  onApprove?: () => Promise<void>
  onMerge?: (squash: boolean, deleteBranch: boolean) => Promise<void>
  onComment?: (message: string) => Promise<void>
  getPipelineJobs?: (sourceBranch: string) => Promise<ForgePipelineJob[]>
}

function isOpen(state: string): boolean {
  const upper = state.toUpperCase()
  return upper === 'OPEN' || upper === 'OPENED'
}

function isMerged(state: string): boolean {
  return state.toUpperCase() === 'MERGED' || state === 'merged'
}

function PrStateBadge({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string
  let bgColor: string

  if (isMerged(state)) {
    label = t.forgePrTab.merged
    color = 'var(--color-accent-violet)'
    bgColor = 'var(--color-accent-violet-bg)'
  } else if (isOpen(state)) {
    label = t.forgePrTab.opened
    color = 'var(--color-accent-green)'
    bgColor = 'var(--color-accent-green-bg)'
  } else {
    label = t.forgePrTab.closed
    color = 'var(--color-accent-red)'
    bgColor = 'var(--color-accent-red-bg)'
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

function ReviewDecisionBadge({ decision }: { decision: string }) {
  let color: string

  switch (decision) {
    case 'APPROVED':
      color = 'var(--color-accent-green)'
      break
    case 'CHANGES_REQUESTED':
      color = 'var(--color-accent-red)'
      break
    case 'REVIEW_REQUIRED':
      color = 'var(--color-accent-amber)'
      break
    default:
      color = 'var(--color-text-muted)'
      break
  }

  return (
    <span style={{ color, fontSize: theme.fontSize.caption, fontWeight: 500 }}>
      {decision}
    </span>
  )
}

function StatusCheckIndicator({ status }: { status: string }) {
  let color: string

  switch (status) {
    case 'SUCCESS':
      color = 'var(--color-accent-green)'
      break
    case 'FAILURE':
      color = 'var(--color-accent-red)'
      break
    case 'PENDING':
      color = 'var(--color-accent-amber)'
      break
    default:
      color = 'var(--color-text-muted)'
      break
  }

  return (
    <span className="flex items-center gap-1.5">
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 9999,
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span style={{ color, fontSize: theme.fontSize.caption, fontWeight: 500 }}>
        {status}
      </span>
    </span>
  )
}

function ReviewStateBadge({ state }: { state: string }) {
  let color: string

  switch (state) {
    case 'APPROVED':
      color = 'var(--color-accent-green)'
      break
    case 'CHANGES_REQUESTED':
      color = 'var(--color-accent-red)'
      break
    case 'DISMISSED':
      color = 'var(--color-text-muted)'
      break
    default:
      color = 'var(--color-accent-amber)'
      break
  }

  return (
    <span
      style={{
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        color,
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 4,
        padding: '1px 6px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {state}
    </span>
  )
}

const PIPELINE_REFRESH_INTERVAL_MS = 15_000
const PIPELINE_RUNNING_STATUSES = new Set(['running', 'pending', 'created', 'waiting_for_resource', 'preparing'])

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function groupJobsByStage(jobs: ForgePipelineJob[]): Map<string, ForgePipelineJob[]> {
  const groups = new Map<string, ForgePipelineJob[]>()
  for (const job of jobs) {
    const existing = groups.get(job.stage)
    if (existing) {
      existing.push(job)
    } else {
      groups.set(job.stage, [job])
    }
  }
  return groups
}

export function ForgePrDetail({
  details,
  onBack,
  sourceLabel,
  forgeType,
  onApprove,
  onMerge,
  onComment,
  getPipelineJobs,
}: ForgePrDetailProps) {
  const { t } = useTranslation()
  const { summary, providerData } = details
  const filteredComments = details.reviewComments.filter(c => c.body && c.body.trim().length > 0)

  const [showCommentInput, setShowCommentInput] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [squash, setSquash] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [approvePending, setApprovePending] = useState(false)
  const [mergePending, setMergePending] = useState(false)
  const [commentPending, setCommentPending] = useState(false)

  const [pipelineJobs, setPipelineJobs] = useState<ForgePipelineJob[]>([])
  const [jobsExpanded, setJobsExpanded] = useState(false)
  const jobsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const prIsOpen = isOpen(summary.state)

  const fetchJobs = useCallback(async () => {
    if (!getPipelineJobs) return
    try {
      const jobs = await getPipelineJobs(summary.sourceBranch)
      setPipelineJobs(jobs)
    } catch (err) {
      logger.warn('[ForgePrDetail] Failed to fetch pipeline jobs', err)
    }
  }, [getPipelineJobs, summary.sourceBranch])

  useEffect(() => {
    if (forgeType !== 'gitlab' || !getPipelineJobs) return
    if (!(providerData.type === 'GitLab' && providerData.pipelineStatus)) return

    void fetchJobs()

    const hasPipelineRunning = providerData.type === 'GitLab' && providerData.pipelineStatus && PIPELINE_RUNNING_STATUSES.has(providerData.pipelineStatus)
    if (hasPipelineRunning) {
      jobsIntervalRef.current = setInterval(() => {
        void fetchJobs()
      }, PIPELINE_REFRESH_INTERVAL_MS)
    }

    return () => {
      if (jobsIntervalRef.current) {
        clearInterval(jobsIntervalRef.current)
        jobsIntervalRef.current = null
      }
    }
  }, [forgeType, getPipelineJobs, providerData, fetchJobs])

  const handleOpenInBrowser = () => {
    if (!summary.url) return
    invoke<void>(TauriCommands.OpenExternalUrl, { url: summary.url }).catch((err: unknown) => {
      logger.warn('[ForgePrDetail] Failed to open URL via Tauri, falling back to window.open', err)
      window.open(summary.url, '_blank', 'noopener,noreferrer')
    })
  }

  const handleApprove = async () => {
    if (!onApprove) return
    setApprovePending(true)
    try {
      await onApprove()
    } catch (err) {
      logger.warn('[ForgePrDetail] Approve failed', err)
    } finally {
      setApprovePending(false)
    }
  }

  const handleMerge = async () => {
    if (!onMerge) return
    setMergePending(true)
    try {
      await onMerge(squash, deleteBranch)
    } catch (err) {
      logger.warn('[ForgePrDetail] Merge failed', err)
    } finally {
      setMergePending(false)
    }
  }

  const handleComment = async () => {
    if (!onComment || !commentText.trim()) return
    setCommentPending(true)
    try {
      await onComment(commentText)
      setCommentText('')
      setShowCommentInput(false)
    } catch (err) {
      logger.warn('[ForgePrDetail] Comment failed', err)
    } finally {
      setCommentPending(false)
    }
  }

  const contextVariables: Record<string, string> = {
    'pr.title': summary.title ?? '',
    'pr.description': details.body ?? '',
    'pr.headRefName': summary.sourceBranch ?? '',
    'pr.url': summary.url ?? '',
    'pr.labels': summary.labels.map(l => l.name).join(', '),
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
          title={t.forgePrTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.forgePrTab.back}</span>
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
            title={t.forgePrTab.openInForge}
          >
            <VscLinkExternal className="w-3 h-3" />
            <span>{t.forgePrTab.openInForge}</span>
          </button>
        )}

        <ContextualActionButton
          context="pr"
          variables={contextVariables}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-start gap-2 mb-3 flex-wrap">
          <PrStateBadge state={summary.state} />
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

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
            {forgeType === 'gitlab' ? t.forgePrTab.sourceBranch : t.forgePrTab.headBranch}:
          </span>
          <BranchPill branch={summary.sourceBranch} />
          {forgeType === 'gitlab' && (
            <>
              <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
                &rarr;
              </span>
              <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
                {t.forgePrTab.targetBranch}:
              </span>
              <BranchPill branch={summary.targetBranch} />
            </>
          )}
        </div>

        {providerData.type === 'GitHub' && providerData.reviewDecision && (
          <div className="mb-3">
            <SectionLabel>{t.forgePrTab.reviewDecision}</SectionLabel>
            <ReviewDecisionBadge decision={providerData.reviewDecision} />
          </div>
        )}

        {providerData.type === 'GitHub' && providerData.statusChecks.length > 0 && (
          <div className="mb-3">
            <SectionLabel>{t.forgePrTab.statusChecks}</SectionLabel>
            <div className="space-y-1">
              {providerData.statusChecks.map((check, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <StatusCheckIndicator status={check.conclusion ?? check.status} />
                  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-secondary)' }}>
                    {check.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {providerData.type === 'GitLab' && providerData.pipelineStatus && (
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <SectionLabel>{t.forgePrTab.pipeline}</SectionLabel>
              <PipelineStatusBadge
                status={providerData.pipelineStatus}
                url={providerData.pipelineUrl}
              />
            </div>

            {pipelineJobs.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => setJobsExpanded((prev) => !prev)}
                  style={{
                    fontSize: theme.fontSize.caption,
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {jobsExpanded ? <VscChevronDown className="w-3 h-3" /> : <VscChevronRight className="w-3 h-3" />}
                  <span>{t.forgePrTab.pipelineJobs} ({pipelineJobs.length})</span>
                </button>

                {jobsExpanded && (
                  <div className="mt-1 space-y-2">
                    {Array.from(groupJobsByStage(pipelineJobs)).map(([stage, jobs]) => (
                      <div key={stage}>
                        <div
                          style={{
                            fontSize: theme.fontSize.caption,
                            fontWeight: 600,
                            color: 'var(--color-text-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: 2,
                          }}
                        >
                          {stage}
                        </div>
                        <div className="space-y-1">
                          {jobs.map((job) => (
                            <div
                              key={job.id}
                              className="flex items-center gap-2"
                              style={{
                                fontSize: theme.fontSize.caption,
                                color: 'var(--color-text-secondary)',
                                paddingLeft: 8,
                              }}
                            >
                              <PipelineStatusBadge status={job.status} url={job.url} />
                              <span className="truncate" title={job.name}>{job.name}</span>
                              {job.duration != null && job.duration > 0 && (
                                <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                  {formatDuration(job.duration)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {providerData.type === 'GitLab' && providerData.reviewers.length > 0 && (
          <div className="mb-3">
            <SectionLabel>{t.forgePrTab.reviewers}</SectionLabel>
            <div className="flex flex-wrap gap-1">
              {providerData.reviewers.map(reviewer => (
                <span
                  key={reviewer}
                  style={{
                    fontSize: theme.fontSize.caption,
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    lineHeight: theme.lineHeight.badge,
                  }}
                >
                  {reviewer}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3">
          <SectionLabel>
            {t.forgePrTab.reviews} ({details.reviews.length})
          </SectionLabel>
          {details.reviews.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.forgePrTab.noReviews}
            </div>
          ) : (
            <div className="space-y-2">
              {details.reviews.map((review, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2"
                  style={{
                    fontSize: theme.fontSize.caption,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {review.author && (
                    <span style={{ fontWeight: 600 }}>{review.author}</span>
                  )}
                  <ReviewStateBadge state={review.state} />
                </div>
              ))}
            </div>
          )}
        </div>

        {summary.labels.length > 0 && (
          <div className="mb-3">
            <SectionLabel>{t.forgePrTab.labels}</SectionLabel>
            <div className="flex flex-wrap gap-1">
              {summary.labels.map(label => (
                <ForgeLabelChip key={label.name} label={label} />
              ))}
            </div>
          </div>
        )}

        {details.body && (
          <div className="mb-4">
            <SectionLabel>{t.forgePrTab.description}</SectionLabel>
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
            {t.forgePrTab.comments} ({filteredComments.length})
          </SectionLabel>

          {filteredComments.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.forgePrTab.noComments}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredComments.map((comment, idx) => (
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
                    {comment.path && (
                      <span style={{ fontFamily: theme.fontFamily.mono }}>
                        {comment.path}{comment.line ? `:${comment.line}` : ''}
                      </span>
                    )}
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

        {providerData.type === 'GitLab' && prIsOpen && (onApprove ?? onMerge ?? onComment) && (
          <div
            className="mt-4 pt-3 flex flex-col gap-2"
            style={{ borderTop: '1px solid var(--color-border-default)' }}
          >
            <div className="flex items-center gap-2">
              {onApprove && (
                <button
                  type="button"
                  onClick={() => { void handleApprove() }}
                  disabled={approvePending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: approvePending ? 'var(--color-text-muted)' : 'var(--color-accent-green)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    cursor: approvePending ? 'default' : 'pointer',
                    opacity: approvePending ? 0.6 : 1,
                  }}
                >
                  <VscCheck className="w-3.5 h-3.5" />
                  <span>{t.forgePrTab.approve}</span>
                </button>
              )}

              {onMerge && (
                <button
                  type="button"
                  onClick={() => { void handleMerge() }}
                  disabled={mergePending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: mergePending ? 'var(--color-text-muted)' : 'var(--color-accent-violet)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    cursor: mergePending ? 'default' : 'pointer',
                    opacity: mergePending ? 0.6 : 1,
                  }}
                >
                  <VscGitMerge className="w-3.5 h-3.5" />
                  <span>{t.forgePrTab.merge}</span>
                </button>
              )}

              {onComment && (
                <button
                  type="button"
                  onClick={() => setShowCommentInput(prev => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: showCommentInput ? 'var(--color-accent-blue)' : 'var(--color-text-secondary)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <VscComment className="w-3.5 h-3.5" />
                  <span>{t.forgePrTab.comment}</span>
                </button>
              )}
            </div>

            {onMerge && (
              <div className="flex items-center gap-3">
                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={squash}
                    onChange={(e) => setSquash(e.target.checked)}
                    style={{ accentColor: 'var(--color-accent-blue)' }}
                  />
                  {t.forgePrTab.squash}
                </label>

                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteBranch}
                    onChange={(e) => setDeleteBranch(e.target.checked)}
                    style={{ accentColor: 'var(--color-accent-blue)' }}
                  />
                  {t.forgePrTab.deleteSourceBranch}
                </label>
              </div>
            )}

            {showCommentInput && onComment && (
              <div className="flex flex-col gap-2 mt-1">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                  style={{
                    fontSize: theme.fontSize.body,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-primary)',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    resize: 'vertical',
                    lineHeight: theme.lineHeight.body,
                    outline: 'none',
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleComment() }}
                    disabled={commentPending || !commentText.trim()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                    style={{
                      fontSize: theme.fontSize.caption,
                      fontFamily: theme.fontFamily.sans,
                      color: commentPending || !commentText.trim() ? 'var(--color-text-muted)' : 'var(--color-accent-blue)',
                      backgroundColor: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      cursor: commentPending || !commentText.trim() ? 'default' : 'pointer',
                      opacity: commentPending || !commentText.trim() ? 0.6 : 1,
                    }}
                  >
                    <span>{t.forgePrTab.comment}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
