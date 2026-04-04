import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from './tauriCommands'
import { logger } from '../utils/logger'
import { DEFAULT_AUTONOMY_PROMPT_TEMPLATE } from './autonomyPrompt'

export interface GenerationSettingsPrompts {
  name_prompt?: string | null
  commit_prompt?: string | null
  consolidation_prompt?: string | null
  review_pr_prompt?: string | null
  plan_issue_prompt?: string | null
  issue_prompt?: string | null
  pr_prompt?: string | null
  autonomy_prompt_template?: string | null
}

export interface DefaultGenerationPrompts {
  name_prompt: string
  commit_prompt: string
  consolidation_prompt: string
  review_pr_prompt: string
  plan_issue_prompt: string
  issue_prompt: string
  pr_prompt: string
  autonomy_prompt_template?: string
}

const FALLBACK_DEFAULT_GENERATION_PROMPTS: DefaultGenerationPrompts = {
  name_prompt: `IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this coding task.

Rules:
- 2-4 words, prefer verb-noun format (e.g., fix-login, add-dark-mode)
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Capture WHAT is being done, not HOW
- Return ONLY the name, nothing else
- Do NOT use tools or commands

Good examples:
- "fix-pr-links" (for fixing pull request link behavior)
- "add-dark-mode" (for implementing dark mode theme)
- "refactor-auth" (for refactoring authentication)
- "update-nav-bar" (for changing navigation layout)

Bad examples:
- "implement-the-new-user-authentication-system" (too long)
- "session-1" (too generic)
- "claude-task" (describes the agent, not the task)

Task: {task}

Name:`,
  commit_prompt: `IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a concise squash commit message for the following changes being merged.

Commits:
{commits}

Changed files:
{files}

Rules:
- Write a single-line summary (max 72 chars), optionally followed by a blank line and bullet points
- Use conventional commit format: type(scope): description
- Common types: feat, fix, refactor, chore, docs, style, test, perf
- Focus on WHAT changed and WHY, not HOW
- Do NOT include any markdown formatting, code blocks, or explanation
- Return ONLY the commit message text, nothing else
- Do NOT use tools or commands`,
  consolidation_prompt: `You are consolidating the results of multiple parallel agent sessions.

Review each branch's changes, compare approaches, and produce a single
reconciled version that takes the best from each:

Sessions to review:
{sessionList}

Instructions:
1. Read the code in each worktree path listed above
2. Compare the approaches taken by each agent
3. Choose the best base implementation
4. Incorporate any valuable improvements from the other versions
5. Produce a clean, unified result in this worktree
6. Run the project's test suite to verify everything passes`,
  review_pr_prompt: 'Review the following pull request:\n\nTitle: {{pr.title}}\nAuthor: {{pr.author}}\nSource: {{pr.sourceBranch}} -> {{pr.targetBranch}}\nURL: {{pr.url}}\n\nDescription:\n{{pr.description}}\n\nLabels: {{pr.labels}}\n\nFetch and review the diff using the CLI (e.g., `gh pr diff {{pr.number}}` or `git diff {{pr.targetBranch}}...{{pr.sourceBranch}}`).',
  plan_issue_prompt: 'Create an implementation plan for the following issue:\n\nTitle: {{issue.title}}\n\nDescription:\n{{issue.description}}\n\nLabels: {{issue.labels}}',
  issue_prompt: [
    'GitHub Issue Context: {title} (#{number})',
    'Link: {url}',
    '{labelsSection}',
    '',
    'Issue Description:',
    '{body}',
    '{commentsSection}',
  ].join('\n'),
  pr_prompt: [
    'GitHub Pull Request Context: {title} (#{number})',
    'Link: {url}',
    'Branch: {branch}',
    '{labelsSection}',
    '',
    'PR Description:',
    '{body}',
    '{commentsSection}',
  ].join('\n'),
  autonomy_prompt_template: DEFAULT_AUTONOMY_PROMPT_TEMPLATE,
}

export function resolveGenerationPrompts(
  settings: GenerationSettingsPrompts,
  defaults: DefaultGenerationPrompts,
): DefaultGenerationPrompts {
  return {
    name_prompt: settings.name_prompt ?? defaults.name_prompt,
    commit_prompt: settings.commit_prompt ?? defaults.commit_prompt,
    consolidation_prompt: settings.consolidation_prompt ?? defaults.consolidation_prompt,
    review_pr_prompt: settings.review_pr_prompt ?? defaults.review_pr_prompt,
    plan_issue_prompt: settings.plan_issue_prompt ?? defaults.plan_issue_prompt,
    issue_prompt: settings.issue_prompt ?? defaults.issue_prompt,
    pr_prompt: settings.pr_prompt ?? defaults.pr_prompt,
    autonomy_prompt_template: settings.autonomy_prompt_template ?? defaults.autonomy_prompt_template,
  }
}

export function renderGenerationPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match
  })
}

export function findMissingGenerationPromptVariables(template: string, requiredVariables: string[]): string[] {
  return requiredVariables.filter(variable => !template.includes(variable))
}

export async function loadGenerationPrompts(): Promise<DefaultGenerationPrompts> {
  try {
    const [settings, defaults] = await Promise.all([
      invoke<GenerationSettingsPrompts>(TauriCommands.GetGenerationSettings),
      invoke<DefaultGenerationPrompts>(TauriCommands.GetDefaultGenerationPrompts),
    ])

    return resolveGenerationPrompts(settings, defaults)
  } catch (error) {
    logger.warn('Failed to load generation prompts, using fallback defaults', error)
    return FALLBACK_DEFAULT_GENERATION_PROMPTS
  }
}
