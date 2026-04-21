import { describe, expect, it } from 'vitest'
import { defaultShortcutConfig, KeyboardShortcutAction } from './config'

describe('keyboard shortcut config defaults', () => {
  it('keeps arrow keys and option-backtick as sidebar item cycle defaults', () => {
    expect(defaultShortcutConfig[KeyboardShortcutAction.SelectPrevSession]).toEqual([
      'Mod+ArrowUp',
      'Alt+Shift+`',
    ])
    expect(defaultShortcutConfig[KeyboardShortcutAction.SelectNextSession]).toEqual([
      'Mod+ArrowDown',
      'Alt+`',
    ])
  })

  it('does not keep duplicate project arrow bindings', () => {
    const configWithLooseKeys = defaultShortcutConfig as Record<string, string[] | undefined>

    expect(configWithLooseKeys.selectPrevProject).toBeUndefined()
    expect(configWithLooseKeys.selectNextProject).toBeUndefined()
  })
})
