export interface ConsolidationStatsProject {
  repository_path: string
  repository_name: string
}

export interface ConsolidationModelWinRate {
  model: string
  agent_types: string[]
  wins: number
  losses: number
  total: number
  win_rate: number
}

export interface ConsolidationStats {
  selected_project?: string | null
  selected_vertical?: string | null
  projects: ConsolidationStatsProject[]
  verticals: string[]
  last_week: ConsolidationModelWinRate[]
  all_time: ConsolidationModelWinRate[]
}

export interface ConsolidationStatsFilters {
  repositoryPath?: string
  vertical?: string
}
