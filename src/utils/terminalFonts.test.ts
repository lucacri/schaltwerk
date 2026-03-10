import { describe, it, expect } from 'vitest'
import { buildTerminalFontFamily } from './terminalFonts'

describe('buildTerminalFontFamily', () => {
  describe('platform-specific chains', () => {
    it('uses Menlo on macOS', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).toBe('Menlo, monospace')
    })

    it('uses Consolas on Windows', () => {
      const result = buildTerminalFontFamily(null, 'win32')
      expect(result).toBe('Consolas, monospace')
    })

    it('uses broad chain on Linux', () => {
      const result = buildTerminalFontFamily(null, 'linux')
      expect(result).toBe('"DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", "Ubuntu Mono", monospace')
    })
  })

  describe('custom font handling', () => {
    it('prepends custom font to platform chain', () => {
      const result = buildTerminalFontFamily('Fira Code', 'darwin')
      expect(result).toBe('"Fira Code", Menlo, monospace')
    })

    it('quotes custom font with spaces', () => {
      const result = buildTerminalFontFamily('My Custom Mono', 'darwin')
      expect(result).toBe('"My Custom Mono", Menlo, monospace')
    })

    it('does not quote single-word custom font', () => {
      const result = buildTerminalFontFamily('Menlo', 'darwin')
      expect(result).toBe('Menlo, Menlo, monospace')
    })

    it('ignores empty custom font', () => {
      const result = buildTerminalFontFamily('', 'darwin')
      expect(result).toBe('Menlo, monospace')
    })

    it('ignores whitespace-only custom font', () => {
      const result = buildTerminalFontFamily('   ', 'darwin')
      expect(result).toBe('Menlo, monospace')
    })

    it('treats null custom font same as no custom font', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).toBe('Menlo, monospace')
    })

    it('treats undefined custom font same as no custom font', () => {
      const result = buildTerminalFontFamily(undefined, 'darwin')
      expect(result).toBe('Menlo, monospace')
    })
  })

  describe('excluded fonts', () => {
    it('does not contain emoji fonts', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).not.toContain('Emoji')
    })

    it('does not contain Nerd Fonts', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).not.toContain('Nerd Font')
      expect(result).not.toContain('MesloLGS')
    })

    it('does not contain cross-platform fonts on macOS', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).not.toContain('Ubuntu')
      expect(result).not.toContain('Liberation')
      expect(result).not.toContain('DejaVu')
    })

    it('does not contain cross-platform fonts on Windows', () => {
      const result = buildTerminalFontFamily(null, 'win32')
      expect(result).not.toContain('Ubuntu')
      expect(result).not.toContain('Menlo')
      expect(result).not.toContain('DejaVu')
    })

    it('does not contain ui-monospace', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).not.toContain('ui-monospace')
    })
  })

  describe('chain always ends with monospace', () => {
    it('ends with monospace on macOS', () => {
      const result = buildTerminalFontFamily(null, 'darwin')
      expect(result).toMatch(/monospace$/)
    })

    it('ends with monospace on Windows', () => {
      const result = buildTerminalFontFamily(null, 'win32')
      expect(result).toMatch(/monospace$/)
    })

    it('ends with monospace on Linux', () => {
      const result = buildTerminalFontFamily(null, 'linux')
      expect(result).toMatch(/monospace$/)
    })

    it('ends with monospace with custom font', () => {
      const result = buildTerminalFontFamily('Custom', 'darwin')
      expect(result).toMatch(/monospace$/)
    })
  })

  describe('unknown platform defaults to Linux chain', () => {
    it('uses Linux chain for unknown platform', () => {
      const result = buildTerminalFontFamily(null, 'freebsd')
      expect(result).toBe('"DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", "Ubuntu Mono", monospace')
    })
  })
})
