import { describe, expect, it } from 'vitest'
import { resolveEditorForFile, extractExtension, SYSTEM_OPEN_APP_ID } from './useOpenInEditor'

describe('extractExtension', () => {
  it('extracts .rs from a Rust file', () => {
    expect(extractExtension('src/main.rs')).toBe('.rs')
  })

  it('extracts .ts from a nested path', () => {
    expect(extractExtension('src/hooks/useOpenInEditor.ts')).toBe('.ts')
  })

  it('extracts .test.tsx as .tsx (last dot)', () => {
    expect(extractExtension('Component.test.tsx')).toBe('.tsx')
  })

  it('returns null for dotfiles with no extension', () => {
    expect(extractExtension('.gitignore')).toBe(null)
  })

  it('returns null for files with no extension', () => {
    expect(extractExtension('Makefile')).toBe(null)
  })

  it('handles bare filename', () => {
    expect(extractExtension('file.py')).toBe('.py')
  })

  it('handles Windows backslash paths', () => {
    expect(extractExtension('src\\main.rs')).toBe('.rs')
  })
})

describe('resolveEditorForFile', () => {
  it('returns configured editor for matching extension', () => {
    const overrides = { '.rs': 'cursor', '.ts': 'code' }
    expect(resolveEditorForFile('src/main.rs', overrides)).toBe('cursor')
  })

  it('returns system-open when no override matches', () => {
    const overrides = { '.rs': 'cursor' }
    expect(resolveEditorForFile('src/index.ts', overrides)).toBe(SYSTEM_OPEN_APP_ID)
  })

  it('returns system-open for empty overrides', () => {
    expect(resolveEditorForFile('src/main.rs', {})).toBe(SYSTEM_OPEN_APP_ID)
  })

  it('returns system-open for files with no extension', () => {
    const overrides = { '.rs': 'cursor' }
    expect(resolveEditorForFile('Makefile', overrides)).toBe(SYSTEM_OPEN_APP_ID)
  })

  it('matches by last extension segment', () => {
    const overrides = { '.tsx': 'code' }
    expect(resolveEditorForFile('Component.test.tsx', overrides)).toBe('code')
  })
})
