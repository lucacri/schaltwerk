import { theme } from '../../common/theme'

interface LoadingSkeletonProps {
  lines?: number
  className?: string
}

export function LoadingSkeleton({ lines = 3, className = '' }: LoadingSkeletonProps) {
  const widths = [100, 85, 70, 90, 60, 75, 95, 80]

  return (
    <div className={`flex flex-col gap-2 p-3 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="rounded animate-pulse"
          style={{
            height: theme.fontSize.body,
            width: `${widths[i % widths.length]}%`,
            backgroundColor: 'var(--color-bg-elevated)',
          }}
        />
      ))}
    </div>
  )
}
