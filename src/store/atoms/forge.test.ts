import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

import { forgeBaseAtom, projectForgeAtom, refreshForgeAtom } from './forge'

describe('forge atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
  })

  it('defaults to unknown', () => {
    expect(store.get(forgeBaseAtom)).toBe('unknown')
    expect(store.get(projectForgeAtom)).toBe('unknown')
  })

  it('updates forge type on successful detection', async () => {
    mockInvoke.mockResolvedValueOnce('github')
    await store.set(refreshForgeAtom)

    expect(store.get(projectForgeAtom)).toBe('github')
    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.DetectProjectForge)
  })

  it('sets forge to gitlab', async () => {
    mockInvoke.mockResolvedValueOnce('gitlab')
    await store.set(refreshForgeAtom)

    expect(store.get(projectForgeAtom)).toBe('gitlab')
  })

  it('falls back to unknown on error', async () => {
    store.set(forgeBaseAtom, 'github')
    mockInvoke.mockRejectedValueOnce(new Error('detection failed'))

    await store.set(refreshForgeAtom)

    expect(store.get(projectForgeAtom)).toBe('unknown')
  })

  it('projectForgeAtom derives from forgeBaseAtom', () => {
    store.set(forgeBaseAtom, 'gitlab')
    expect(store.get(projectForgeAtom)).toBe('gitlab')
  })
})
