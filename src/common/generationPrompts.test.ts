import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from './tauriCommands'
import {
  findMissingGenerationPromptVariables,
  loadGenerationPrompts,
  renderGenerationPrompt,
  resolveGenerationPrompts,
  type DefaultGenerationPrompts,
  type GenerationSettingsPrompts,
} from './generationPrompts'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)

const defaults: DefaultGenerationPrompts = {
  name_prompt: 'default name {task}',
  commit_prompt: 'default commit {commits} {files}',
  consolidation_prompt: 'default consolidation {sessionList}',
  review_pr_prompt: 'default review {{pr.title}} {{pr.url}}',
  plan_issue_prompt: 'default issue {{issue.title}} {{issue.description}}',
  issue_prompt: 'default issue prompt {title} {body} {comments}',
  pr_prompt: 'default pr prompt {title} {branch} {body} {comments}',
  autonomy_prompt_template: '## Agent Instructions\n\nDefault autonomy template',
  force_restart_prompt_template: 'default force restart {BASE_SPEC_CONTENT}',
  plan_candidate_prompt_template: 'default plan candidate {BASE_SPEC_CONTENT} {SPEC_ID}',
  plan_judge_prompt_template: 'default plan judge {CANDIDATES_BLOCK}',
  judge_prompt_template: 'default synthesis judge {CANDIDATE_COUNT} {CANDIDATES_BLOCK}',
}

describe('generationPrompts', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('falls back to defaults for unset prompt settings', () => {
    const settings: GenerationSettingsPrompts = {
      name_prompt: null,
      commit_prompt: null,
      consolidation_prompt: null,
      review_pr_prompt: null,
      plan_issue_prompt: null,
      issue_prompt: null,
      pr_prompt: null,
      autonomy_prompt_template: null,
    }

    expect(resolveGenerationPrompts(settings, defaults)).toEqual(defaults)
  })

  it('prefers saved prompt settings when present', () => {
    const settings: GenerationSettingsPrompts = {
      name_prompt: 'custom name {task}',
      commit_prompt: null,
      consolidation_prompt: 'custom consolidation {sessionList}',
      review_pr_prompt: null,
      plan_issue_prompt: null,
      issue_prompt: 'custom issue {title}',
      pr_prompt: 'custom pr {title}',
      autonomy_prompt_template: 'custom autonomy instructions',
    }

    expect(resolveGenerationPrompts(settings, defaults)).toMatchObject({
      name_prompt: 'custom name {task}',
      commit_prompt: defaults.commit_prompt,
      consolidation_prompt: 'custom consolidation {sessionList}',
      issue_prompt: 'custom issue {title}',
      pr_prompt: 'custom pr {title}',
      autonomy_prompt_template: 'custom autonomy instructions',
    })
  })

  it('resolves action prompt templates with saved overrides', () => {
    const settings: GenerationSettingsPrompts = {
      force_restart_prompt_template: 'custom restart {BASE_SPEC_CONTENT}',
      plan_candidate_prompt_template: null,
      plan_judge_prompt_template: 'custom plan judge {CANDIDATES_BLOCK}',
      judge_prompt_template: 'custom synthesis judge {CANDIDATE_COUNT}',
    }

    expect(resolveGenerationPrompts(settings, defaults)).toMatchObject({
      force_restart_prompt_template: 'custom restart {BASE_SPEC_CONTENT}',
      plan_candidate_prompt_template: defaults.plan_candidate_prompt_template,
      plan_judge_prompt_template: 'custom plan judge {CANDIDATES_BLOCK}',
      judge_prompt_template: 'custom synthesis judge {CANDIDATE_COUNT}',
    })
  })

  it('renders single-brace template placeholders', () => {
    const prompt = renderGenerationPrompt('Issue {title} on {branch}', {
      title: 'Fix login',
      branch: 'feature/login',
    })

    expect(prompt).toBe('Issue Fix login on feature/login')
  })

  it('reports required variables missing from a prompt template', () => {
    expect(findMissingGenerationPromptVariables('Review {title}', ['{title}', '{body}', '{comments}'])).toEqual([
      '{body}',
      '{comments}',
    ])
  })

  it('loads and resolves prompts from saved settings plus defaults', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === TauriCommands.GetGenerationSettings) {
        return {
          name_prompt: null,
          commit_prompt: 'saved commit {commits}',
          consolidation_prompt: 'saved consolidation {sessionList}',
          review_pr_prompt: null,
          plan_issue_prompt: null,
          issue_prompt: null,
          pr_prompt: null,
          autonomy_prompt_template: null,
        }
      }
      if (command === TauriCommands.GetDefaultGenerationPrompts) {
        return defaults
      }
      throw new Error(`Unexpected command: ${command}`)
    })

    await expect(loadGenerationPrompts()).resolves.toMatchObject({
      name_prompt: defaults.name_prompt,
      commit_prompt: 'saved commit {commits}',
      consolidation_prompt: 'saved consolidation {sessionList}',
      autonomy_prompt_template: defaults.autonomy_prompt_template,
    })
  })

  it('falls back to frontend defaults when prompt loading fails', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))

    const prompts = await loadGenerationPrompts()

    expect(prompts.consolidation_prompt).toContain('{sessionList}')
    expect(prompts.consolidation_prompt).toContain('lucode_consolidation_report')
    expect(prompts.consolidation_prompt).toContain('Do not call lucode_promote directly')
    expect(prompts.consolidation_prompt).toContain('starts a synthesis judge')
    expect(prompts.review_pr_prompt).toContain('{{pr.title}}')
    expect(prompts.review_pr_prompt).toContain('{{pr.number}}')
    expect(prompts.review_pr_prompt).toContain('gh pr diff {{pr.number}}')
    expect(prompts.review_pr_prompt).not.toContain('{{pr.diff}}')
  })
})
