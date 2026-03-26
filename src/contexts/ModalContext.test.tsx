import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ModalProvider, useModal } from './ModalContext'

function wrapper({ children }: { children: React.ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>
}

describe('ModalContext', () => {
  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useModal())
    }).toThrow('useModal must be used within a ModalProvider')
  })

  it('starts with no open modals', () => {
    const { result } = renderHook(() => useModal(), { wrapper })
    expect(result.current.openModals.size).toBe(0)
    expect(result.current.isAnyModalOpen()).toBe(false)
  })

  it('registers and unregisters modals', () => {
    const { result } = renderHook(() => useModal(), { wrapper })

    act(() => result.current.registerModal('settings'))
    expect(result.current.openModals.size).toBe(1)
    expect(result.current.isAnyModalOpen()).toBe(true)

    act(() => result.current.registerModal('confirm'))
    expect(result.current.openModals.size).toBe(2)

    act(() => result.current.unregisterModal('settings'))
    expect(result.current.openModals.size).toBe(1)
    expect(result.current.isAnyModalOpen()).toBe(true)

    act(() => result.current.unregisterModal('confirm'))
    expect(result.current.openModals.size).toBe(0)
    expect(result.current.isAnyModalOpen()).toBe(false)
  })

  it('adds modal-open class to body when modals are open', () => {
    const { result } = renderHook(() => useModal(), { wrapper })

    act(() => result.current.registerModal('test-modal'))
    expect(document.body.classList.contains('modal-open')).toBe(true)

    act(() => result.current.unregisterModal('test-modal'))
    expect(document.body.classList.contains('modal-open')).toBe(false)
  })

  it('handles unregistering a modal that was never registered', () => {
    const { result } = renderHook(() => useModal(), { wrapper })

    act(() => result.current.unregisterModal('nonexistent'))
    expect(result.current.openModals.size).toBe(0)
  })

  it('does not duplicate when registering the same modal twice', () => {
    const { result } = renderHook(() => useModal(), { wrapper })

    act(() => result.current.registerModal('modal-a'))
    act(() => result.current.registerModal('modal-a'))
    expect(result.current.openModals.size).toBe(1)
  })
})
