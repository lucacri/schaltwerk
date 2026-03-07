import { useGithubIntegrationContext } from '../contexts/GithubIntegrationContext'
import { useGitlabIntegrationContext } from '../contexts/GitlabIntegrationContext'

export type ForgeType = 'github' | 'gitlab' | 'unknown'

export function useForgeType(): ForgeType {
  const github = useGithubIntegrationContext()
  const gitlab = useGitlabIntegrationContext()

  if (github.hasRepository && !gitlab.hasSources) return 'github'
  if (gitlab.hasSources && !github.hasRepository) return 'gitlab'
  return 'unknown'
}
