import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { KeyboardShortcutsProvider, useKeyboardShortcutsConfig } from './KeyboardShortcutsContext'
import { defaultShortcutConfig, KeyboardShortcutAction } from '../keyboardShortcuts/config'
import { TauriCommands } from '../common/tauriCommands'

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
}

describe('KeyboardShortcutsContext', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns safe defaults when used outside provider', () => {
    const { result } = renderHook(() => useKeyboardShortcutsConfig())
    expect(result.current.config).toEqual(defaultShortcutConfig)
    expect(result.current.loading).toBe(false)
  })

  it('loads stored shortcuts on mount', async () => {
    const stored = { [KeyboardShortcutAction.CancelSession]: ['Mod+X'] }
    mockInvoke.mockResolvedValueOnce(stored)

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetKeyboardShortcuts)
    expect(result.current.config[KeyboardShortcutAction.CancelSession]).not.toEqual(
      defaultShortcutConfig[KeyboardShortcutAction.CancelSession]
    )
  })

  it('falls back to defaults when invoke fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('storage error'))

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.config).toEqual(defaultShortcutConfig)
  })

  it('falls back to defaults when invoke returns null', async () => {
    mockInvoke.mockResolvedValueOnce(null)

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.config).toEqual(defaultShortcutConfig)
  })

  it('resets to defaults', async () => {
    const stored = { [KeyboardShortcutAction.CancelSession]: ['Mod+X'] }
    mockInvoke.mockResolvedValueOnce(stored)

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => result.current.resetToDefaults())

    expect(result.current.config).toEqual(defaultShortcutConfig)
  })

  it('applies partial overrides', async () => {
    mockInvoke.mockResolvedValueOnce(null)

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.applyOverrides({
        [KeyboardShortcutAction.FocusClaude]: ['Mod+Shift+T'],
      })
    })

    expect(result.current.config[KeyboardShortcutAction.SwitchToOrchestrator]).toEqual(
      defaultShortcutConfig[KeyboardShortcutAction.SwitchToOrchestrator]
    )
  })

  it('refreshes config from backend', async () => {
    mockInvoke.mockResolvedValueOnce(null)

    const { result } = renderHook(() => useKeyboardShortcutsConfig(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const updated = { [KeyboardShortcutAction.OpenDiffViewer]: ['Mod+Shift+G'] }
    mockInvoke.mockResolvedValueOnce(updated)

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })
})
