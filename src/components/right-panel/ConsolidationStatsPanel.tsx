import { useEffect, useMemo } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  consolidationStatsAtom,
  consolidationStatsErrorAtom,
  consolidationStatsFiltersAtom,
  consolidationStatsLoadingAtom,
  loadConsolidationStatsAtom,
} from '../../store/atoms/consolidationStats'
import { theme } from '../../common/theme'
import type { ConsolidationModelWinRate } from '../../types/consolidationStats'

const textStyle = {
  fontSize: theme.fontSize.body,
  lineHeight: theme.lineHeight.body,
}

const formatWinRate = (value: number) => `${Math.round(value * 100)}%`

function StatsTable({ title, rows }: { title: string; rows: ConsolidationModelWinRate[] }) {
  return (
    <section className="min-h-0">
      <h3
        className="mb-2 font-semibold text-primary"
        style={{ fontSize: theme.fontSize.heading, lineHeight: theme.lineHeight.heading }}
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-secondary" style={textStyle}>
          No confirmed rounds yet.
        </p>
      ) : (
        <div className="overflow-auto border border-subtle rounded">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-subtle bg-elevated">
                <th className="px-3 py-2 text-left font-medium text-secondary" style={textStyle}>Model</th>
                <th className="px-3 py-2 text-left font-medium text-secondary" style={textStyle}>Agent</th>
                <th className="px-3 py-2 text-right font-medium text-secondary" style={textStyle}>Win rate</th>
                <th className="px-3 py-2 text-right font-medium text-secondary" style={textStyle}>Wins</th>
                <th className="px-3 py-2 text-right font-medium text-secondary" style={textStyle}>Losses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.model} className="border-b border-subtle last:border-b-0">
                  <td className="px-3 py-2 text-primary" style={textStyle}>{row.model}</td>
                  <td className="px-3 py-2 text-secondary" style={textStyle}>
                    {row.agent_types.length > 0 ? row.agent_types.join(', ') : 'unknown'}
                  </td>
                  <td className="px-3 py-2 text-right text-primary" style={textStyle}>{formatWinRate(row.win_rate)}</td>
                  <td className="px-3 py-2 text-right text-secondary" style={textStyle}>{row.wins}</td>
                  <td className="px-3 py-2 text-right text-secondary" style={textStyle}>{row.losses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function ConsolidationStatsPanel() {
  const stats = useAtomValue(consolidationStatsAtom)
  const loading = useAtomValue(consolidationStatsLoadingAtom)
  const error = useAtomValue(consolidationStatsErrorAtom)
  const [filters, setFilters] = useAtom(consolidationStatsFiltersAtom)
  const loadStats = useSetAtom(loadConsolidationStatsAtom)

  useEffect(() => {
    void loadStats()
  }, [loadStats, filters.repositoryPath, filters.vertical])

  const projects = stats?.projects ?? []
  const verticals = useMemo(() => stats?.verticals ?? [], [stats?.verticals])

  return (
    <div className="h-full overflow-auto bg-panel p-4 text-primary" data-testid="consolidation-stats-panel">
      <div className="mb-4 flex flex-col gap-3">
        <h2
          className="font-semibold"
          style={{ fontSize: theme.fontSize.headingLarge, lineHeight: theme.lineHeight.heading }}
        >
          Consolidation stats
        </h2>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <label className="flex flex-col gap-1 text-secondary" style={textStyle}>
            Project
            <select
              className="rounded border border-subtle bg-elevated px-2 py-1 text-primary"
              style={textStyle}
              value={filters.repositoryPath ?? ''}
              onChange={event => {
                const value = event.currentTarget.value
                setFilters(prev => ({ ...prev, repositoryPath: value || undefined }))
              }}
            >
              <option value="">All projects</option>
              {projects.map(project => (
                <option key={project.repository_path} value={project.repository_path}>
                  {project.repository_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-secondary" style={textStyle}>
            Vertical
            <select
              className="rounded border border-subtle bg-elevated px-2 py-1 text-primary"
              style={textStyle}
              value={filters.vertical ?? ''}
              onChange={event => {
                const value = event.currentTarget.value
                setFilters(prev => ({ ...prev, vertical: value || undefined }))
              }}
            >
              <option value="">All verticals</option>
              {verticals.map(vertical => (
                <option key={vertical} value={vertical}>
                  {vertical}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && !stats ? (
        <p className="text-secondary" style={textStyle}>Loading consolidation stats...</p>
      ) : error ? (
        <p className="text-error" style={textStyle}>{error}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <StatsTable title="Last 7 days" rows={stats?.last_week ?? []} />
          <StatsTable title="All time" rows={stats?.all_time ?? []} />
        </div>
      )}
    </div>
  )
}
