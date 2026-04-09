export type PipelineStatusTier = 1 | 2 | 3

export interface PipelineStatusVisual {
  tier: PipelineStatusTier
  labelKey: string
  fallbackLabel: string
  pillBg: string | null
  pillBorder: string | null
  pillText: string
  rowTintVar: string | null
  showLeadingDot: boolean
}

const STATUS_VISUALS: Record<string, Omit<PipelineStatusVisual, 'fallbackLabel'>> = {
  failed: {
    tier: 1,
    labelKey: 'pipelineFailed',
    pillBg: 'var(--color-accent-red-bg)',
    pillBorder: 'var(--color-accent-red-border)',
    pillText: 'var(--color-accent-red)',
    rowTintVar: 'var(--color-row-tint-red)',
    showLeadingDot: false,
  },
  running: {
    tier: 1,
    labelKey: 'pipelineRunning',
    pillBg: 'var(--color-accent-blue-bg)',
    pillBorder: 'var(--color-accent-blue-border)',
    pillText: 'var(--color-accent-blue)',
    rowTintVar: 'var(--color-row-tint-blue)',
    showLeadingDot: false,
  },
  manual: {
    tier: 1,
    labelKey: 'pipelineManual',
    pillBg: 'var(--color-accent-amber-bg)',
    pillBorder: 'var(--color-accent-amber-border)',
    pillText: 'var(--color-accent-amber)',
    rowTintVar: 'var(--color-row-tint-amber)',
    showLeadingDot: false,
  },
  pending: {
    tier: 2,
    labelKey: 'pipelinePending',
    pillBg: null,
    pillBorder: 'var(--color-accent-amber-border)',
    pillText: 'var(--color-accent-amber)',
    rowTintVar: null,
    showLeadingDot: true,
  },
  created: {
    tier: 2,
    labelKey: 'pipelinePending',
    pillBg: null,
    pillBorder: 'var(--color-accent-amber-border)',
    pillText: 'var(--color-accent-amber)',
    rowTintVar: null,
    showLeadingDot: true,
  },
  waiting_for_resource: {
    tier: 2,
    labelKey: 'pipelinePending',
    pillBg: null,
    pillBorder: 'var(--color-accent-amber-border)',
    pillText: 'var(--color-accent-amber)',
    rowTintVar: null,
    showLeadingDot: true,
  },
  preparing: {
    tier: 2,
    labelKey: 'pipelinePending',
    pillBg: null,
    pillBorder: 'var(--color-accent-amber-border)',
    pillText: 'var(--color-accent-amber)',
    rowTintVar: null,
    showLeadingDot: true,
  },
  success: {
    tier: 3,
    labelKey: 'pipelineSuccess',
    pillBg: null,
    pillBorder: null,
    pillText: 'var(--color-accent-green)',
    rowTintVar: null,
    showLeadingDot: true,
  },
  canceled: {
    tier: 3,
    labelKey: 'pipelineCanceled',
    pillBg: null,
    pillBorder: null,
    pillText: 'var(--color-text-muted)',
    rowTintVar: null,
    showLeadingDot: true,
  },
}

export function getPipelineStatusVisual(status: string): PipelineStatusVisual {
  const visual = STATUS_VISUALS[status]
  if (visual) {
    return { ...visual, fallbackLabel: '' }
  }

  return {
    tier: 3,
    labelKey: '',
    fallbackLabel: status,
    pillBg: null,
    pillBorder: null,
    pillText: 'var(--color-text-muted)',
    rowTintVar: null,
    showLeadingDot: true,
  }
}
