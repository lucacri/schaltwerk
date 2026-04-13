import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'

export const SESSION_SWITCH_SHORTCUT_ACTIONS = [
  KeyboardShortcutAction.SwitchToSession1,
  KeyboardShortcutAction.SwitchToSession2,
  KeyboardShortcutAction.SwitchToSession3,
  KeyboardShortcutAction.SwitchToSession4,
  KeyboardShortcutAction.SwitchToSession5,
  KeyboardShortcutAction.SwitchToSession6,
  KeyboardShortcutAction.SwitchToSession7,
] as const

export function resolveSwitchSessionShortcut(
  index: number,
  shortcuts: Partial<Record<KeyboardShortcutAction, string>>,
  modKey: string,
): string {
  const action = SESSION_SWITCH_SHORTCUT_ACTIONS[index]
  if (action && shortcuts[action]) {
    return shortcuts[action] as string
  }
  return `${modKey}${index + 2}`
}
