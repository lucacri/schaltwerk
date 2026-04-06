import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflowModulePath = resolve(process.cwd(), 'src/common/lucodeWorkflows.ts')
const sharedSkillPath = resolve(process.cwd(), '.agents/skills/consolidate/SKILL.md')
const codexSkillPath = resolve(process.cwd(), '.codex/skills/consolidate/SKILL.md')
const opencodeCommandPath = resolve(process.cwd(), '.opencode/commands/consolidate.md')
const claudeSkillPath = resolve(process.cwd(), 'claude-plugin/skills/consolidate/SKILL.md')
const claudeCommandPath = resolve(process.cwd(), 'claude-plugin/commands/consolidate.md')
const agentsInstructionsPath = resolve(process.cwd(), 'AGENTS.md')

describe('Lucode workflow publishing', () => {
  it('publishes consolidate wrappers for shared skills plus native commands', () => {
    expect(existsSync(workflowModulePath)).toBe(true)
    expect(existsSync(sharedSkillPath)).toBe(true)
    expect(existsSync(codexSkillPath)).toBe(true)
    expect(existsSync(opencodeCommandPath)).toBe(true)
  })

  it('keeps all agent wrappers aligned to the shared consolidate workflow', async () => {
    expect(existsSync(workflowModulePath)).toBe(true)
    expect(existsSync(sharedSkillPath)).toBe(true)
    expect(existsSync(codexSkillPath)).toBe(true)
    expect(existsSync(opencodeCommandPath)).toBe(true)
    if (!existsSync(workflowModulePath) || !existsSync(sharedSkillPath) || !existsSync(codexSkillPath) || !existsSync(opencodeCommandPath)) {
      return
    }

    const workflowModule = await import(pathToFileURL(workflowModulePath).href)

    expect(readFileSync(claudeSkillPath, 'utf8')).toBe(workflowModule.renderClaudeSkillFile('consolidate'))
    expect(readFileSync(claudeCommandPath, 'utf8')).toBe(workflowModule.renderClaudeCommandFile('consolidate'))
    expect(readFileSync(sharedSkillPath, 'utf8')).toBe(workflowModule.renderSharedAgentSkillFile('consolidate'))
    expect(readFileSync(codexSkillPath, 'utf8')).toBe(workflowModule.renderCodexSkillFile('consolidate'))
    expect(readFileSync(opencodeCommandPath, 'utf8')).toBe(workflowModule.renderOpenCodeCommandFile('consolidate'))
  })

  it('documents shared skill discovery in AGENTS instructions', () => {
    expect(existsSync(agentsInstructionsPath)).toBe(true)
    if (!existsSync(agentsInstructionsPath)) {
      return
    }

    const content = readFileSync(agentsInstructionsPath, 'utf8')

    expect(content).toContain('.agents/skills')
    expect(content).toContain('lucode://skills')
    expect(content).toContain('consolidate')
  })

  it('describes the dedicated consolidation-session promote workflow', () => {
    const workflowFiles = [sharedSkillPath, claudeSkillPath, claudeCommandPath, codexSkillPath, opencodeCommandPath]

    for (const workflowFile of workflowFiles) {
      expect(existsSync(workflowFile)).toBe(true)
      if (!existsSync(workflowFile)) {
        continue
      }

      const content = readFileSync(workflowFile, 'utf8')
      expect(content).toContain('lucode_promote')
      expect(content).toContain('current consolidation session branch')
      expect(content).not.toContain('one of the existing versioned session worktrees')
      expect(content).not.toContain('Call `mcp__lucode__lucode_create`')
    }
  })
})
