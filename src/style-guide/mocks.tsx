import { TauriCommands } from '../common/tauriCommands'
import type { ThemeId, ResolvedTheme } from '../common/themes/types'
import type { GithubIntegrationValue } from '../hooks/useGithubIntegration'
import type { AgentVariant } from '../types/agentVariant'
import type { AgentPreset } from '../types/agentPreset'
import type { ContextualAction } from '../types/contextualAction'
import type { GithubPrDetails, GithubPrSummary } from '../types/githubIssues'

const STYLE_GUIDE_THEME_STORAGE_KEY = 'lucode-style-guide-theme'

type StyleGuideWindow = typeof window & {
  __LUCODE_STYLE_GUIDE_GITHUB__?: GithubIntegrationValue
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
    transformCallback: () => number
  }
}

export const STYLE_GUIDE_THEMES: Array<{ value: ResolvedTheme; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'tokyonight', label: 'Tokyo Night' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'catppuccin', label: 'Catppuccin' },
  { value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
  { value: 'everforest', label: 'Everforest' },
  { value: 'ayu', label: 'Ayu' },
  { value: 'kanagawa', label: 'Kanagawa' },
  { value: 'darcula', label: 'Darcula' },
]

export const STYLE_GUIDE_AGENT_VARIANTS: AgentVariant[] = [
  {
    id: 'variant-claude-opus',
    name: 'Claude Opus Review',
    agentType: 'claude',
    model: 'opus',
    reasoningEffort: 'high',
    cliArgs: ['--model', 'opus', '--append-system-prompt'],
    envVars: {
      ANTHROPIC_BETA: 'tools-2025-01-17',
      LUCODE_REVIEW_MODE: 'strict',
    },
    isBuiltIn: false,
  },
  {
    id: 'variant-codex-fast',
    name: 'Codex Fast Fixes',
    agentType: 'codex',
    model: 'o3-mini',
    reasoningEffort: 'medium',
    cliArgs: ['--dangerously-skip-permissions'],
    envVars: {
      OPENAI_DEFAULT_MODEL: 'o3-mini',
    },
    isBuiltIn: false,
  },
]

export const STYLE_GUIDE_AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'preset-review-squad',
    name: 'Review Squad',
    slots: [
      { agentType: 'claude', variantId: 'variant-claude-opus' },
      { agentType: 'codex', variantId: 'variant-codex-fast', skipPermissions: true },
      { agentType: 'gemini', autonomyEnabled: true },
    ],
    isBuiltIn: false,
  },
  {
    id: 'preset-ui-pass',
    name: 'UI Pass',
    slots: [
      { agentType: 'claude' },
      { agentType: 'copilot', skipPermissions: true },
    ],
    isBuiltIn: false,
  },
  {
    id: 'preset-triage',
    name: 'Bug Triage',
    slots: [
      { agentType: 'codex' },
      { agentType: 'droid', autonomyEnabled: true },
    ],
    isBuiltIn: false,
  },
]

export const STYLE_GUIDE_CONTEXTUAL_ACTIONS: ContextualAction[] = [
  {
    id: 'action-pr-review',
    name: 'Review This PR',
    context: 'pr',
    promptTemplate: 'Review this PR focusing on regressions, missing tests, and risky edge cases.\n\nTitle: {{pr.title}}\nDescription: {{pr.description}}',
    mode: 'session',
    variantId: 'variant-claude-opus',
    isBuiltIn: false,
  },
  {
    id: 'action-issue-plan',
    name: 'Plan Implementation',
    context: 'issue',
    promptTemplate: 'Write an implementation plan for this issue and call out dependencies.\n\nTitle: {{issue.title}}\nDescription: {{issue.description}}',
    mode: 'spec',
    agentType: 'codex',
    isBuiltIn: false,
  },
  {
    id: 'action-follow-up',
    name: 'Open Follow-up Session',
    context: 'both',
    promptTemplate: 'Create a follow-up session for the remaining work and summarize the current state.',
    mode: 'session',
    presetId: 'preset-review-squad',
    isBuiltIn: false,
  },
]

const MOCK_PULL_REQUESTS: GithubPrSummary[] = [
  {
    number: 248,
    title: 'Refine style guide spacing across settings cards',
    state: 'open',
    updatedAt: '2026-04-05T09:00:00.000Z',
    author: 'lucacri',
    labels: [{ name: 'ui' }],
    url: 'https://github.com/lucacri/lucode/pull/248',
    headRefName: 'lucode/style-guide-spacing',
  },
  {
    number: 241,
    title: 'Unify review toolbar focus styles',
    state: 'merged',
    updatedAt: '2026-04-04T11:30:00.000Z',
    author: 'opencode-bot',
    labels: [{ name: 'ux' }],
    url: 'https://github.com/lucacri/lucode/pull/241',
    headRefName: 'lucode/review-toolbar-focus',
  },
  {
    number: 236,
    title: 'Fix modal overflow clipping on light theme',
    state: 'closed',
    updatedAt: '2026-04-02T15:15:00.000Z',
    author: 'codex',
    labels: [{ name: 'bug' }],
    url: 'https://github.com/lucacri/lucode/pull/236',
    headRefName: 'lucode/fix-modal-overflow',
  },
] 

const MOCK_PULL_REQUEST_DETAILS: Record<number, GithubPrDetails> = Object.fromEntries(
  MOCK_PULL_REQUESTS.map((pullRequest) => [
    pullRequest.number,
    {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      body: 'Mock PR details for style-guide previews.',
      state: pullRequest.state,
      labels: pullRequest.labels,
      comments: [],
      headRefName: pullRequest.headRefName,
      latestReviews: [],
      isFork: false,
    },
  ]),
)

export const STYLE_GUIDE_GITHUB_INTEGRATION: GithubIntegrationValue = {
  status: {
    installed: true,
    authenticated: true,
    userLogin: 'lucacri',
    repository: {
      nameWithOwner: 'lucacri/lucode',
      defaultBranch: 'main',
    },
  },
  loading: false,
  isAuthenticating: false,
  isConnecting: false,
  isCreatingPr: () => false,
  authenticate: async () => {
    throw new Error('Style guide preview does not authenticate GitHub.')
  },
  connectProject: async () => {
    throw new Error('Style guide preview does not connect projects.')
  },
  createReviewedPr: async () => {
    throw new Error('Style guide preview does not create pull requests.')
  },
  getCachedPrUrl: () => undefined,
  canCreatePr: true,
  isGhMissing: false,
  hasRepository: true,
  refreshStatus: async () => {},
}

function cloneItems<T>(items: T[]): T[] {
  return items.map((item) => ({ ...(item as Record<string, unknown>) } as T))
}

function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return STYLE_GUIDE_THEMES.some((theme) => theme.value === value)
}

function isThemeId(value: unknown): value is ThemeId {
  return value === 'system' || isResolvedTheme(value)
}

export function resolveStyleGuideThemeId(value: ThemeId | ResolvedTheme): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  if (value === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  return value
}

export function resolveInitialStyleGuideTheme(): ThemeId {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('theme')
  if (isThemeId(fromUrl)) {
    return fromUrl
  }

  const fromStorage = window.localStorage.getItem(STYLE_GUIDE_THEME_STORAGE_KEY)
  if (isThemeId(fromStorage)) {
    return fromStorage
  }

  return 'dark'
}

export function applyStyleGuideTheme(theme: ResolvedTheme) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.style.setProperty('color-scheme', theme === 'light' ? 'light' : 'dark')
}

export function persistStyleGuideTheme(theme: ThemeId) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STYLE_GUIDE_THEME_STORAGE_KEY, theme)
}

export function installStyleGuideTauriMock(initialTheme: ThemeId) {
  if (typeof window === 'undefined') {
    return
  }

  let currentTheme: ThemeId = initialTheme
  let currentLanguage = 'en'
  let currentVariants = cloneItems(STYLE_GUIDE_AGENT_VARIANTS)
  let currentPresets = cloneItems(STYLE_GUIDE_AGENT_PRESETS)
  let currentActions = cloneItems(STYLE_GUIDE_CONTEXTUAL_ACTIONS)

  persistStyleGuideTheme(initialTheme)

  const invoke = async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case TauriCommands.SchaltwerkCoreGetTheme:
        return currentTheme
      case TauriCommands.SchaltwerkCoreSetTheme:
        if (isThemeId(args.theme)) {
          currentTheme = args.theme
          persistStyleGuideTheme(currentTheme)
        }
        return null
      case TauriCommands.SchaltwerkCoreGetLanguage:
        return currentLanguage
      case TauriCommands.SchaltwerkCoreSetLanguage:
        if (typeof args.language === 'string') {
          currentLanguage = args.language
        }
        return null
      case TauriCommands.GetAgentVariants:
        return cloneItems(currentVariants)
      case TauriCommands.SetAgentVariants:
        currentVariants = cloneItems((args.variants as AgentVariant[]) ?? [])
        return null
      case TauriCommands.GetAgentPresets:
        return cloneItems(currentPresets)
      case TauriCommands.SetAgentPresets:
        currentPresets = cloneItems((args.presets as AgentPreset[]) ?? [])
        return null
      case TauriCommands.GetContextualActions:
        return cloneItems(currentActions)
      case TauriCommands.SetContextualActions:
        currentActions = cloneItems((args.actions as ContextualAction[]) ?? [])
        return null
      case TauriCommands.ResetContextualActionsToDefaults:
        currentActions = cloneItems(STYLE_GUIDE_CONTEXTUAL_ACTIONS)
        return cloneItems(currentActions)
      case TauriCommands.GitHubSearchPrs:
        return cloneItems(MOCK_PULL_REQUESTS)
      case TauriCommands.GitHubGetPrDetails:
        return MOCK_PULL_REQUEST_DETAILS[Number(args.number)] ?? null
      case TauriCommands.SchaltwerkCoreLogFrontendMessage:
        return null
      default:
        return {}
    }
  }

  ;(window as StyleGuideWindow).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: () => 0,
  }
  ;(window as StyleGuideWindow).__LUCODE_STYLE_GUIDE_GITHUB__ = STYLE_GUIDE_GITHUB_INTEGRATION
}
