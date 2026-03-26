import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { createElement } from 'react'
import { useTranslation } from './index'
import type { Translations } from './types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

vi.mock('../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: { LanguageChanged: 'language-changed' },
}))

describe('i18n index', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
  })

  function wrapper({ children }: { children: React.ReactNode }) {
    return createElement(Provider, { store }, children)
  }

  it('exports useTranslation hook', () => {
    expect(typeof useTranslation).toBe('function')
  })

  it('returns translations object and current language', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })

    expect(result.current.t).toBeDefined()
    expect(result.current.currentLanguage).toBe('en')
  })

  it('returns English translations by default', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })
    const t = result.current.t as Translations

    expect(t.dialogs).toBeDefined()
    expect(typeof t.dialogs.cancelSession.title).toBe('string')
  })
})
