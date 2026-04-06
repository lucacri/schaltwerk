import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTONOMY_PROMPT_TEMPLATE } from './autonomyPrompt'

describe('DEFAULT_AUTONOMY_PROMPT_TEMPLATE', () => {
  it('keeps the autonomy workflow agent-neutral', () => {
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).toContain('brainstorming')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).toContain('writing-plans')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).toContain('test-driven-development')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).toContain('verification-before-completion')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).toContain('requesting-code-review')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).not.toContain('/superpowers:')
    expect(DEFAULT_AUTONOMY_PROMPT_TEMPLATE).not.toContain('/mart-panda:')
  })
})
