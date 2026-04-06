import type { ITheme } from '@xterm/xterm'
import { ResolvedTheme } from './types'
import { ayuTheme, darkTheme, lightTheme, tokyonightTheme, gruvboxTheme, catppuccinTheme, catppuccinMacchiatoTheme, everforestTheme, kanagawaTheme, darculaTheme, islandsDarkTheme } from './presets'

function getCssVariable(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || undefined
}

function css(varName: string, fallback: string): string {
  return getCssVariable(varName) ?? fallback
}

function getTerminalColors(themeId: ResolvedTheme) {
  switch (themeId) {
    case 'tokyonight':
      return tokyonightTheme.colors.terminal
    case 'gruvbox':
      return gruvboxTheme.colors.terminal
    case 'catppuccin':
      return catppuccinTheme.colors.terminal
    case 'catppuccin-macchiato':
      return catppuccinMacchiatoTheme.colors.terminal
    case 'everforest':
      return everforestTheme.colors.terminal
    case 'ayu':
      return ayuTheme.colors.terminal
    case 'kanagawa':
      return kanagawaTheme.colors.terminal
    case 'darcula':
      return darculaTheme.colors.terminal
    case 'islands-dark':
      return islandsDarkTheme.colors.terminal
    case 'light':
      return lightTheme.colors.terminal
    default:
      return darkTheme.colors.terminal
  }
}

export function buildTerminalTheme(themeId: ResolvedTheme): ITheme {
  const fallback = getTerminalColors(themeId)
  return {
    background: css('--color-terminal-bg', fallback.background),
    foreground: css('--color-terminal-fg', fallback.foreground),
    cursor: css('--color-terminal-cursor', fallback.cursor),
    cursorAccent: css('--color-terminal-bg', fallback.background),
    selectionBackground: css('--color-terminal-selection', fallback.selection),
    black: css('--color-terminal-black', fallback.black),
    red: css('--color-terminal-red', fallback.red),
    green: css('--color-terminal-green', fallback.green),
    yellow: css('--color-terminal-yellow', fallback.yellow),
    blue: css('--color-terminal-blue', fallback.blue),
    magenta: css('--color-terminal-magenta', fallback.magenta),
    cyan: css('--color-terminal-cyan', fallback.cyan),
    white: css('--color-terminal-white', fallback.white),
    brightBlack: css('--color-terminal-bright-black', fallback.brightBlack),
    brightRed: css('--color-terminal-bright-red', fallback.brightRed),
    brightGreen: css('--color-terminal-bright-green', fallback.brightGreen),
    brightYellow: css('--color-terminal-bright-yellow', fallback.brightYellow),
    brightBlue: css('--color-terminal-bright-blue', fallback.brightBlue),
    brightMagenta: css('--color-terminal-bright-magenta', fallback.brightMagenta),
    brightCyan: css('--color-terminal-bright-cyan', fallback.brightCyan),
    brightWhite: css('--color-terminal-bright-white', fallback.brightWhite),
  }
}
