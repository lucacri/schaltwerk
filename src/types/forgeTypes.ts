export type ForgeType = 'github' | 'gitlab' | 'unknown'

export interface ForgeSourceConfig {
  projectIdentifier: string
  hostname?: string
  label: string
  forgeType: ForgeType
  issuesEnabled?: boolean
  mrsEnabled?: boolean
}

export interface ForgeAuthStatus {
  authenticated: boolean
  userLogin?: string
  hostname?: string
}

export interface ForgeRepositoryInfo {
  name: string
  defaultBranch: string
  url: string
}

export interface ForgeLabel {
  name: string
  color?: string
}

export interface ForgeIssueSummary {
  id: string
  title: string
  state: string
  updatedAt?: string
  author?: string
  labels: ForgeLabel[]
  url?: string
}

export interface ForgeComment {
  author?: string
  body: string
  createdAt?: string
}

export interface ForgeIssueDetails {
  summary: ForgeIssueSummary
  body?: string
  comments: ForgeComment[]
}

export interface ForgePrSummary {
  id: string
  title: string
  state: string
  author?: string
  labels: ForgeLabel[]
  sourceBranch: string
  targetBranch: string
  url?: string
}

export interface ForgeReview {
  author?: string
  state: string
  body?: string
}

export interface ForgeReviewComment {
  author?: string
  body: string
  path?: string
  line?: number
}

export interface ForgeStatusCheck {
  name: string
  status: string
  conclusion?: string
  url?: string
}

export interface ForgeCiStatus {
  state: string
  checks: ForgeStatusCheck[]
}

export interface ForgePipelineStatus {
  id: number
  status: string
  url?: string
}

export interface ForgePipelineJob {
  id: number
  name: string
  stage?: string
  status: string
  url?: string
  duration?: number
}

export type ForgeProviderData =
  | {
      type: 'GitHub'
      reviewDecision?: string
      statusChecks: ForgeStatusCheck[]
      isFork: boolean
    }
  | {
      type: 'GitLab'
      mergeStatus?: string
      pipelineStatus?: string
      pipelineUrl?: string
      reviewers: string[]
    }
  | { type: 'None' }

export interface ForgePrDetails {
  summary: ForgePrSummary
  body?: string
  ciStatus?: ForgeCiStatus
  reviews: ForgeReview[]
  reviewComments: ForgeReviewComment[]
  providerData: ForgeProviderData
}

export interface ForgePrResult {
  branch: string
  url: string
}

export type ForgeCommitMode = 'squash' | 'reapply'

export interface ForgeStatusPayload {
  forgeType: ForgeType
  installed: boolean
  authenticated: boolean
  userLogin?: string
  hostname?: string
}
