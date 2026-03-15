import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { VscRefresh } from 'react-icons/vsc'
import { usageAtom, usageLoadingAtom, fetchUsageActionAtom } from '../store/atoms/usage'
import { useOutsideDismiss } from '../hooks/useOutsideDismiss'
import { theme } from '../common/theme'

function percentColor(pct: number): string {
  if (pct > 95) return 'var(--color-accent-red)'
  if (pct > 70) return 'var(--color-accent-amber)'
  return 'var(--color-accent-green)'
}

const popoverStyle: CSSProperties = {
  backgroundColor: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-subtle)',
  boxShadow: '0 12px 24px rgba(var(--color-bg-primary-rgb), 0.45)',
}

export function UsageIndicator() {
  const usage = useAtomValue(usageAtom)
  const loading = useAtomValue(usageLoadingAtom)
  const fetchUsage = useSetAtom(fetchUsageActionAtom)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useOutsideDismiss(menuRef, () => setOpen(false))

  const handleRefresh = useCallback(() => {
    void fetchUsage()
  }, [fetchUsage])

  const badgeColor = useMemo(() => {
    if (!usage || usage.error) return 'var(--color-text-muted)'
    const maxPct = Math.max(usage.session_percent, usage.weekly_percent)
    return percentColor(maxPct)
  }, [usage])

  if (!usage) return null

  if (usage.error) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 px-2 h-[22px] border rounded-md"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-muted)',
          fontSize: theme.fontSize.caption,
        }}
        onClick={handleRefresh}
        disabled={loading}
        title="Usage unavailable — click to retry"
      >
        <span>Usage N/A</span>
        <VscRefresh className={`w-[11px] h-[11px] ${loading ? 'animate-spin' : ''}`} />
      </button>
    )
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="flex items-center gap-1.5 px-2 h-[22px] border rounded-md"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
          color: badgeColor,
          fontSize: theme.fontSize.caption,
          fontFamily: theme.fontFamily.mono,
        }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Claude usage"
      >
        <span>S:{usage.session_percent}%</span>
        <span>W:{usage.weekly_percent}%</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[220px] z-30 rounded-lg overflow-hidden"
          style={popoverStyle}
        >
          <div className="px-3 py-2" style={{ fontSize: theme.fontSize.caption }}>
            <div className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
              Claude Usage
            </div>

            <div className="space-y-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              <div className="flex justify-between items-center">
                <span>Session (5h)</span>
                <span style={{ color: percentColor(usage.session_percent), fontFamily: theme.fontFamily.mono }}>
                  {usage.session_percent}%
                </span>
              </div>
              {usage.session_reset_time && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}>
                  Resets: {usage.session_reset_time}
                </div>
              )}

              <div className="flex justify-between items-center">
                <span>Weekly</span>
                <span style={{ color: percentColor(usage.weekly_percent), fontFamily: theme.fontFamily.mono }}>
                  {usage.weekly_percent}%
                </span>
              </div>
              {usage.weekly_reset_time && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}>
                  Resets: {usage.weekly_reset_time}
                </div>
              )}
            </div>

            <div
              className="mt-2 pt-2 border-t"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <button
                type="button"
                className="flex items-center gap-1.5 hover:underline"
                style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.caption }}
                onClick={handleRefresh}
                disabled={loading}
              >
                <VscRefresh className={`w-[11px] h-[11px] ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
