import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { defaultShortcutConfig, KeyboardShortcutAction, KeyboardShortcutConfig } from '../keyboardShortcuts/config'

function pressKey(key: string, { metaKey = false, ctrlKey = false, shiftKey = false, altKey = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey, altKey, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}

function mockMacPlatform() {
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', configurable: true })
}

function mockWindowsPlatform() {
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true })
}

function mockLinuxPlatform() {
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64)', configurable: true })
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    mockMacPlatform()
  })
  it('invokes orchestrator selection on mod+1', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))


    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator).toHaveBeenCalled()
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('invokes session selection for keys 2..9 within bounds', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 3 }))

    pressKey('2', { metaKey: true })
    pressKey('4', { metaKey: true })
    // 2 -> index 0, 4 -> index 2
    expect(onSelectSession).toHaveBeenCalledWith(0)
    expect(onSelectSession).toHaveBeenCalledWith(2)
  })

  it('does not invoke session selection when index out of bounds', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 1 }))

    pressKey('3', { metaKey: true })
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('opens diff on mod+g and cancels on mod+d', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onCancelSelectedSession = vi.fn()
    const onOpenDiffViewer = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onOpenDiffViewer, sessionCount: 5 }))

    pressKey('g', { metaKey: true })
    pressKey('d', { metaKey: true })

    expect(onOpenDiffViewer).toHaveBeenCalled()
    expect(onCancelSelectedSession).toHaveBeenCalledWith(false)
  })

  it('respects custom keybindings when provided in config', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onCancelSelectedSession = vi.fn()

    const customConfig: KeyboardShortcutConfig = {
      ...defaultShortcutConfig,
      [KeyboardShortcutAction.CancelSession]: ['Mod+X'],
    }

    renderHook(() => useKeyboardShortcuts(
      { onSelectOrchestrator, onSelectSession, onCancelSelectedSession, sessionCount: 2 },
      { shortcutConfig: customConfig },
    ))

    pressKey('d', { metaKey: true })
    expect(onCancelSelectedSession).not.toHaveBeenCalled()

    pressKey('x', { metaKey: true })
    expect(onCancelSelectedSession).toHaveBeenCalledWith(false)
  })

  it('invokes reset selection callback on mod+alt+r', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onResetSelection = vi.fn()

    renderHook(() => useKeyboardShortcuts({
      onSelectOrchestrator,
      onSelectSession,
      onResetSelection,
      sessionCount: 1,
    }))

    const event = pressKey('y', { metaKey: true })

    expect(onResetSelection).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('invokes switch model callback on mod+alt+m', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onOpenSwitchModel = vi.fn()

    renderHook(() => useKeyboardShortcuts({
      onSelectOrchestrator,
      onSelectSession,
      onOpenSwitchModel,
      sessionCount: 1,
    }))

    const event = pressKey('p', { metaKey: true })

    expect(onOpenSwitchModel).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('invokes update session from parent callback on mod+shift+u', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onUpdateSessionFromParent = vi.fn()

    renderHook(() => useKeyboardShortcuts({
      onSelectOrchestrator,
      onSelectSession,
      onUpdateSessionFromParent,
      sessionCount: 1,
    }))

    const event = pressKey('u', { metaKey: true, shiftKey: true })

    expect(onUpdateSessionFromParent).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not invoke update session from parent when callback not provided', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({
      onSelectOrchestrator,
      onSelectSession,
      sessionCount: 1,
    }))

    const event = pressKey('u', { metaKey: true, shiftKey: true })

    expect(event.defaultPrevented).toBe(false)
  })

  it('does not navigate sessions with arrow keys when diff viewer is open', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectNextSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession, 
      onSelectNextSession,
      sessionCount: 3,
      isDiffViewerOpen: true
    }))

    pressKey('ArrowUp', { metaKey: true })
    pressKey('ArrowDown', { metaKey: true })

    expect(onSelectPrevSession).not.toHaveBeenCalled()
    expect(onSelectNextSession).not.toHaveBeenCalled()
  })

  it('navigates sessions with arrow keys when diff viewer is closed', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectNextSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession, 
      onSelectNextSession,
      sessionCount: 3,
      isDiffViewerOpen: false
    }))

    pressKey('ArrowUp', { metaKey: true })
    pressKey('ArrowDown', { metaKey: true })

    expect(onSelectPrevSession).toHaveBeenCalled()
    expect(onSelectNextSession).toHaveBeenCalled()
  })

  it('uses ctrl on non-mac platforms and meta on mac', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    // Non-mac: meta should NOT trigger, ctrl SHOULD
    mockWindowsPlatform()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))
    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator).not.toHaveBeenCalled()
    pressKey('1', { ctrlKey: true })
    expect(onSelectOrchestrator).toHaveBeenCalled()

    // Mac: meta SHOULD trigger
    mockMacPlatform()
    const onSelectOrchestrator2 = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator: onSelectOrchestrator2, onSelectSession, sessionCount: 0 }))
    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator2).toHaveBeenCalled()
  })

  it('preventDefault is called for handled shortcuts and not for ignored ones', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onSelectPrevSession = vi.fn()
    const onOpenDiffViewer = vi.fn()
    const onFocusTerminal = vi.fn()

    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession,
      onOpenDiffViewer,
      onFocusTerminal,
      sessionCount: 3,
      isDiffViewerOpen: false,
    }))

    const captureDefault = (key: string, opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      pressKey(key, opts)
      window.removeEventListener('keydown', listener)
      return prevented
    }

    expect(captureDefault('1', { metaKey: true })).toBe(true)
    expect(captureDefault('2', { metaKey: true })).toBe(true)
    expect(captureDefault('g', { metaKey: true })).toBe(true)
    expect(captureDefault('/', { metaKey: true })).toBe(true)

    // Not handled: missing modifier
    expect(captureDefault('1', { metaKey: false })).toBe(false)
  })

  it('shift modifies cancel behavior (immediate=true)', () => {
    const onCancelSelectedSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, sessionCount: 2 }))

    pressKey('d', { metaKey: true, shiftKey: true })
    expect(onCancelSelectedSession).toHaveBeenCalledWith(true)
  })

  it('context-specific: arrows do not preventDefault when diff viewer open', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onSelectPrevSession, sessionCount: 2, isDiffViewerOpen: true }))
    let prevented = false
    const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', listener)
    pressKey('ArrowUp', { metaKey: true })
    window.removeEventListener('keydown', listener)
    expect(prevented).toBe(false)
    expect(onSelectPrevSession).not.toHaveBeenCalled()
  })

  it('context-specific: \'/\' only prevents when callback provided', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    // Without callback
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 1 }))
    let prevented = false
    const l1 = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', l1)
    pressKey('/', { metaKey: true })
    window.removeEventListener('keydown', l1)
    expect(prevented).toBe(false)

    // With callback
    const onFocusTerminal = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onFocusTerminal, sessionCount: 1 }))
    prevented = false
    const l2 = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', l2)
    pressKey('/', { metaKey: true })
    window.removeEventListener('keydown', l2)
    expect(prevented).toBe(true)
    expect(onFocusTerminal).toHaveBeenCalled()
  })

  describe('Arrow key navigation', () => {
    it('navigates to previous session with Cmd+ArrowUp', () => {
      const onSelectPrevSession = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onSelectPrevSession,
        sessionCount: 3
      }))

      pressKey('ArrowUp', { metaKey: true })
      expect(onSelectPrevSession).toHaveBeenCalledTimes(1)
    })

    it('does not navigate sessions with Cmd+ArrowUp when a modal is open', () => {
      const onSelectPrevSession = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onSelectOrchestrator,
          onSelectSession,
          onSelectPrevSession,
          sessionCount: 3,
          isModalOpen: true,
        })
      )

      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      pressKey('ArrowUp', { metaKey: true })
      window.removeEventListener('keydown', listener)

      expect(onSelectPrevSession).not.toHaveBeenCalled()
      expect(prevented).toBe(false)
    })

    it('navigates to next session with Cmd+ArrowDown', () => {
      const onSelectNextSession = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onSelectNextSession,
        sessionCount: 3
      }))

      pressKey('ArrowDown', { metaKey: true })
      expect(onSelectNextSession).toHaveBeenCalledTimes(1)
    })

    it('does not navigate sessions with Cmd+ArrowDown when a modal is open', () => {
      const onSelectNextSession = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onSelectOrchestrator,
          onSelectSession,
          onSelectNextSession,
          sessionCount: 3,
          isModalOpen: true,
        })
      )

      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      pressKey('ArrowDown', { metaKey: true })
      window.removeEventListener('keydown', listener)

      expect(onSelectNextSession).not.toHaveBeenCalled()
      expect(prevented).toBe(false)
    })

    it('switches to previous project with Cmd+Shift+ArrowLeft', () => {
      const onSelectPrevProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onSelectPrevProject,
        sessionCount: 3
      }))

      pressKey('ArrowLeft', { metaKey: true, shiftKey: true })
      expect(onSelectPrevProject).toHaveBeenCalledTimes(1)
    })

    it('switches to next project with Cmd+Shift+ArrowRight', () => {
      const onSelectNextProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onSelectNextProject,
        sessionCount: 3
      }))

      pressKey('ArrowRight', { metaKey: true, shiftKey: true })
      expect(onSelectNextProject).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when callbacks are undefined', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 3
      }))

      // Should not throw or cause issues
      pressKey('ArrowUp', { metaKey: true })
      pressKey('ArrowDown', { metaKey: true })
      pressKey('ArrowLeft', { metaKey: true })
      pressKey('ArrowRight', { metaKey: true })
    })

    it('does not prevent default when callbacks are undefined', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 3
      }))

      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      
      pressKey('ArrowUp', { metaKey: true })
      expect(prevented).toBe(false)
      
      pressKey('ArrowLeft', { metaKey: true })
      expect(prevented).toBe(false)
      
      window.removeEventListener('keydown', listener)
    })
  })

  describe('Focus management shortcuts', () => {
    it('focuses Claude terminal with Cmd+T', () => {
      const onFocusClaude = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onFocusClaude,
        sessionCount: 1
      }))

      pressKey('t', { metaKey: true })
      expect(onFocusClaude).toHaveBeenCalledTimes(1)
    })

    it('focuses Claude terminal with Cmd+T (uppercase)', () => {
      const onFocusClaude = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onFocusClaude,
        sessionCount: 1
      }))

      pressKey('T', { metaKey: true })
      expect(onFocusClaude).toHaveBeenCalledTimes(1)
    })

    it('focuses terminal with Cmd+/', () => {
      const onFocusTerminal = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onFocusTerminal,
        sessionCount: 1
      }))

      pressKey('/', { metaKey: true })
      expect(onFocusTerminal).toHaveBeenCalledTimes(1)
    })

    it('does not prevent default when focus callbacks are undefined', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 1
      }))

      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      
      pressKey('t', { metaKey: true })
      expect(prevented).toBe(false)
      
      window.removeEventListener('keydown', listener)
    })
  })

  describe('Platform and modifier handling', () => {
    it('uses Cmd key on Mac platform', () => {
      mockMacPlatform()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))

      pressKey('1', { metaKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1)

      pressKey('1', { ctrlKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1) // Still 1, ctrl doesn't work on Mac
    })

    it('uses Ctrl key on Windows platform', () => {
      mockWindowsPlatform()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))

      pressKey('1', { ctrlKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1)

      pressKey('1', { metaKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1) // Still 1, meta doesn't work on Windows
    })

    it('uses Ctrl key on Linux platform', () => {
      mockLinuxPlatform()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))

      pressKey('1', { ctrlKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1)

      pressKey('1', { metaKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1) // Still 1, meta doesn't work on Linux
    })

    it('handles Shift modifier for immediate cancel', () => {
      const onCancelSelectedSession = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onCancelSelectedSession,
        sessionCount: 1
      }))

      pressKey('d', { metaKey: true, shiftKey: true })
      expect(onCancelSelectedSession).toHaveBeenCalledWith(true)

      pressKey('D', { metaKey: true, shiftKey: true })
      expect(onCancelSelectedSession).toHaveBeenCalledWith(true)
    })

    it('ignores shortcuts without modifier key', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()
      const onCancelSelectedSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onCancelSelectedSession,
        sessionCount: 5
      }))

      // Try all shortcuts without modifier
      pressKey('1')
      pressKey('2')
      pressKey('d')
      pressKey('r')
      pressKey('g')
      pressKey('t')
      pressKey('/')
      pressKey('ArrowUp')
      pressKey('ArrowDown')
      pressKey('ArrowLeft')
      pressKey('ArrowRight')

      expect(onSelectOrchestrator).not.toHaveBeenCalled()
      expect(onSelectSession).not.toHaveBeenCalled()
      expect(onCancelSelectedSession).not.toHaveBeenCalled()
    })

    it('handles mixed modifier keys correctly', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()
      const onCancelSelectedSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onCancelSelectedSession,
        sessionCount: 1
      }))

      // Both meta and ctrl (should work since we check metaKey on Mac)
      pressKey('1', { metaKey: true, ctrlKey: true })
      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1)

      // Meta, ctrl and shift together
      pressKey('d', { metaKey: true, ctrlKey: true, shiftKey: true })
      expect(onCancelSelectedSession).toHaveBeenCalledWith(true)
    })
  })

  describe('Session management shortcuts', () => {
   it('converts session to spec with Cmd+S', () => {
       const onSpecSession = vi.fn()
       const onSelectOrchestrator = vi.fn()
       const onSelectSession = vi.fn()

       renderHook(() => useKeyboardShortcuts({
           onSelectOrchestrator,
           onSelectSession,
           onSpecSession,
           sessionCount: 1
       }))

       pressKey('s', { metaKey: true })
       expect(onSpecSession).toHaveBeenCalledTimes(1)

       pressKey('S', { metaKey: true })
       expect(onSpecSession).toHaveBeenCalledTimes(2)
   })

   it('does not trigger spec shortcut with Cmd+Shift+S', () => {
       const onSpecSession = vi.fn()
       const onSelectOrchestrator = vi.fn()
       const onSelectSession = vi.fn()

       renderHook(() => useKeyboardShortcuts({
           onSelectOrchestrator,
           onSelectSession,
           onSpecSession,
           sessionCount: 1
       }))

       pressKey('s', { metaKey: true, shiftKey: true })
       expect(onSpecSession).not.toHaveBeenCalled()

       pressKey('S', { metaKey: true, shiftKey: true })
       expect(onSpecSession).not.toHaveBeenCalled()
   })

    it('does not mark session ready when callback is undefined', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 1
      }))

      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      
      pressKey('r', { metaKey: true })
      expect(prevented).toBe(false)
      
      window.removeEventListener('keydown', listener)
    })

    it('handles session selection boundary conditions', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      // Test with 0 sessions
      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 0
      }))

      pressKey('2', { metaKey: true })
      expect(onSelectSession).not.toHaveBeenCalled()

      // Test with 1 session (index 0 maps to key '2')
      const { unmount } = renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 1
      }))

      pressKey('2', { metaKey: true }) // Should work, index 0
      expect(onSelectSession).toHaveBeenCalledWith(0)

      pressKey('3', { metaKey: true }) // Should not work, index 1 doesn't exist
      expect(onSelectSession).toHaveBeenCalledTimes(1)

      unmount()
    })

    it('handles all session keys 2-9 correctly', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 8 // Max sessions for keys 2-9
      }))

      // Test all keys 2-9
      for (let i = 2; i <= 9; i++) {
        pressKey(i.toString(), { metaKey: true })
        expect(onSelectSession).toHaveBeenCalledWith(i - 2) // 2->0, 3->1, ..., 9->7
      }

      expect(onSelectSession).toHaveBeenCalledTimes(8)
    })
  })

  describe('Project switching shortcuts', () => {
    it('switches to project by index with Mod+Shift+1-9', () => {
      const onSwitchToProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onSwitchToProject,
        sessionCount: 0,
      }))

      pressKey('1', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(0)

      pressKey('5', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(4)

      pressKey('9', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(8)

      expect(onSwitchToProject).toHaveBeenCalledTimes(3)
    })

    it('does not invoke project switch when callback not provided', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        sessionCount: 0,
      }))

      const event = pressKey('1', { metaKey: true, shiftKey: true })
      expect(event.defaultPrevented).toBe(false)
    })

    it('cycles to next project with Mod+Backtick', () => {
      const onCycleNextProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onCycleNextProject,
        sessionCount: 0,
      }))

      pressKey('`', { metaKey: true })
      expect(onCycleNextProject).toHaveBeenCalledTimes(1)
    })

    it('does not cycle project when callback not provided', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        sessionCount: 0,
      }))

      const event = pressKey('`', { metaKey: true })
      expect(event.defaultPrevented).toBe(false)
    })

    it('cycles to previous project with Mod+Shift+Backtick', () => {
      const onCyclePrevProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onCyclePrevProject,
        sessionCount: 0,
      }))

      pressKey('`', { metaKey: true, shiftKey: true })
      expect(onCyclePrevProject).toHaveBeenCalledTimes(1)
    })

    it('does not cycle prev project when callback not provided', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        sessionCount: 0,
      }))

      const event = pressKey('`', { metaKey: true, shiftKey: true })
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not switch project when modal is open', () => {
      const onSwitchToProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onSwitchToProject,
        sessionCount: 0,
        isModalOpen: true,
      }))

      const event = pressKey('1', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not cycle next project when modal is open', () => {
      const onCycleNextProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onCycleNextProject,
        sessionCount: 0,
        isModalOpen: true,
      }))

      const event = pressKey('`', { metaKey: true })
      expect(onCycleNextProject).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not cycle prev project when modal is open', () => {
      const onCyclePrevProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onCyclePrevProject,
        sessionCount: 0,
        isModalOpen: true,
      }))

      const event = pressKey('`', { metaKey: true, shiftKey: true })
      expect(onCyclePrevProject).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not switch to project index beyond projectCount', () => {
      const onSwitchToProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onSwitchToProject,
        sessionCount: 0,
        projectCount: 2,
      }))

      pressKey('1', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(0)

      pressKey('2', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(1)

      pressKey('3', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledTimes(2)
    })

    it('Mod+Shift+1 triggers project switch, not session switch', () => {
      const onSwitchToProject = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onSwitchToProject,
        sessionCount: 8,
      }))

      pressKey('1', { metaKey: true, shiftKey: true })
      expect(onSwitchToProject).toHaveBeenCalledWith(0)
      expect(onSelectOrchestrator).not.toHaveBeenCalled()
      expect(onSelectSession).not.toHaveBeenCalled()
    })
  })

  describe('Open settings shortcut', () => {
    it('opens settings with Cmd+, on Mac', () => {
      const onOpenSettings = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onOpenSettings,
        sessionCount: 1,
      }))

      const event = pressKey(',', { metaKey: true })
      expect(onOpenSettings).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it('opens settings with Ctrl+, on Windows', () => {
      mockWindowsPlatform()
      const onOpenSettings = vi.fn()
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        onOpenSettings,
        sessionCount: 1,
      }))

      const event = pressKey(',', { ctrlKey: true })
      expect(onOpenSettings).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it('does not open settings when callback is not provided', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({
        onSelectOrchestrator,
        onSelectSession,
        sessionCount: 1,
      }))

      const event = pressKey(',', { metaKey: true })
      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('Edge cases and integration', () => {
    it('handles rapid key sequences', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()
      const onSelectPrevSession = vi.fn()
      const onSelectNextSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession, 
        onSelectPrevSession,
        onSelectNextSession,
        sessionCount: 3
      }))

      // Rapid sequence
      pressKey('1', { metaKey: true })
      pressKey('ArrowDown', { metaKey: true })
      pressKey('ArrowUp', { metaKey: true })
      pressKey('2', { metaKey: true })

      expect(onSelectOrchestrator).toHaveBeenCalledTimes(1)
      expect(onSelectNextSession).toHaveBeenCalledTimes(1)
      expect(onSelectPrevSession).toHaveBeenCalledTimes(1)
      expect(onSelectSession).toHaveBeenCalledWith(0)
    })

    it('cleans up event listener on unmount', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 1
      }))

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

      addEventListenerSpy.mockRestore()
      removeEventListenerSpy.mockRestore()
    })

    it('updates listeners when props change', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      const { rerender } = renderHook(
        (props) => useKeyboardShortcuts(props),
        { initialProps: { onSelectOrchestrator, onSelectSession, sessionCount: 1 } }
      )

      pressKey('2', { metaKey: true })
      expect(onSelectSession).toHaveBeenCalledWith(0)

      // Update sessionCount
      rerender({ onSelectOrchestrator, onSelectSession, sessionCount: 0 })

      pressKey('2', { metaKey: true })
      expect(onSelectSession).toHaveBeenCalledTimes(1) // Should not increase
    })

    it('handles undefined callbacks gracefully', () => {
      const onSelectOrchestrator = vi.fn()
      const onSelectSession = vi.fn()

      renderHook(() => useKeyboardShortcuts({ 
        onSelectOrchestrator, 
        onSelectSession,
        sessionCount: 1,
        // All optional callbacks are undefined
      }))

      // Should not throw
      pressKey('d', { metaKey: true })
      pressKey('g', { metaKey: true })
      pressKey('t', { metaKey: true })
      pressKey('/', { metaKey: true })
      pressKey('ArrowUp', { metaKey: true })
      pressKey('ArrowDown', { metaKey: true })
      pressKey('ArrowLeft', { metaKey: true })
      pressKey('ArrowRight', { metaKey: true })
    })

    it('prevents default for all handled shortcuts', () => {
      const callbacks = {
        onSelectOrchestrator: vi.fn(),
        onSelectSession: vi.fn(),
        onCancelSelectedSession: vi.fn(),
        onSelectPrevSession: vi.fn(),
        onSelectNextSession: vi.fn(),
        onFocusSidebar: vi.fn(),
        onFocusClaude: vi.fn(),
        onOpenDiffViewer: vi.fn(),
        onFocusTerminal: vi.fn(),
        onSelectPrevProject: vi.fn(),
        onSelectNextProject: vi.fn(),
      }

      renderHook(() => useKeyboardShortcuts({
        ...callbacks,
        sessionCount: 3,
        isDiffViewerOpen: false
      }))

      const testPreventDefault = (key: string, modifiers = { metaKey: true }) => {
        let prevented = false
        const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
        window.addEventListener('keydown', listener)
        pressKey(key, modifiers)
        window.removeEventListener('keydown', listener)
        return prevented
      }

      expect(testPreventDefault('1')).toBe(true)
      expect(testPreventDefault('2')).toBe(true)
      expect(testPreventDefault('d')).toBe(true)
      expect(testPreventDefault('D')).toBe(true)
      expect(testPreventDefault('r')).toBe(false)
      expect(testPreventDefault('R')).toBe(false)
      expect(testPreventDefault('g')).toBe(true)
      expect(testPreventDefault('G')).toBe(true)
      expect(testPreventDefault('t')).toBe(true)
      expect(testPreventDefault('T')).toBe(true)
      expect(testPreventDefault('/')).toBe(true)
      expect(testPreventDefault('ArrowUp')).toBe(true)
      expect(testPreventDefault('ArrowDown')).toBe(true)
    })

    it('all shortcuts work together without conflicts', () => {
      const callbacks = {
        onSelectOrchestrator: vi.fn(),
        onSelectSession: vi.fn(),
        onCancelSelectedSession: vi.fn(),
        onSelectPrevSession: vi.fn(),
        onSelectNextSession: vi.fn(),
        onFocusSidebar: vi.fn(),
        onFocusClaude: vi.fn(),
        onOpenDiffViewer: vi.fn(),
        onFocusTerminal: vi.fn(),
        onSelectPrevProject: vi.fn(),
        onSelectNextProject: vi.fn(),
      }

      renderHook(() => useKeyboardShortcuts({
        ...callbacks,
        sessionCount: 5,
        isDiffViewerOpen: false
      }))

      // Test all shortcuts work
      pressKey('1', { metaKey: true })
      expect(callbacks.onSelectOrchestrator).toHaveBeenCalled()

      pressKey('3', { metaKey: true })
      expect(callbacks.onSelectSession).toHaveBeenCalledWith(1)

      pressKey('d', { metaKey: true })
      expect(callbacks.onCancelSelectedSession).toHaveBeenCalledWith(false)

      pressKey('ArrowUp', { metaKey: true })
      expect(callbacks.onSelectPrevSession).toHaveBeenCalled()

      pressKey('ArrowDown', { metaKey: true })
      expect(callbacks.onSelectNextSession).toHaveBeenCalled()

      pressKey('ArrowLeft', { metaKey: true, shiftKey: true })
      expect(callbacks.onSelectPrevProject).toHaveBeenCalled()

      pressKey('ArrowRight', { metaKey: true, shiftKey: true })
      expect(callbacks.onSelectNextProject).toHaveBeenCalled()

      pressKey('g', { metaKey: true })
      expect(callbacks.onOpenDiffViewer).toHaveBeenCalled()

      pressKey('t', { metaKey: true })
      expect(callbacks.onFocusClaude).toHaveBeenCalledTimes(1) // Called only from t

      pressKey('/', { metaKey: true })
      expect(callbacks.onFocusTerminal).toHaveBeenCalledTimes(1) // Called only from /
    })
  })

  describe('isModalOpen gating', () => {
    function renderAllCallbacks(overrides: Record<string, unknown> = {}) {
      const callbacks = {
        onSelectOrchestrator: vi.fn(),
        onSelectSession: vi.fn(),
        onCancelSelectedSession: vi.fn(),
        onRefineSpec: vi.fn(),
        onSpecSession: vi.fn(),
        onPromoteSelectedVersion: vi.fn(),
        onSelectPrevSession: vi.fn(),
        onSelectNextSession: vi.fn(),
        onFocusClaude: vi.fn(),
        onOpenDiffViewer: vi.fn(),
        onFocusTerminal: vi.fn(),
        onSelectPrevProject: vi.fn(),
        onSelectNextProject: vi.fn(),
        onResetSelection: vi.fn(),
        onOpenSwitchModel: vi.fn(),
        onOpenMergeModal: vi.fn(),
        onUpdateSessionFromParent: vi.fn(),
        onCreatePullRequest: vi.fn(),
        onOpenInApp: vi.fn(),
        onOpenSettings: vi.fn(),
        onSwitchToProject: vi.fn(),
        onCycleNextProject: vi.fn(),
        onCyclePrevProject: vi.fn(),
      }
      renderHook(() => useKeyboardShortcuts({
        ...callbacks,
        sessionCount: 5,
        projectCount: 3,
        isModalOpen: true,
        ...overrides,
      }))
      return callbacks
    }

    it('does not fire SwitchToOrchestrator (Cmd+1) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('1', { metaKey: true })
      expect(callbacks.onSelectOrchestrator).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire SwitchToSession (Cmd+2..9) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('2', { metaKey: true })
      expect(callbacks.onSelectSession).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire ResetSessionOrOrchestrator (Cmd+Y) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('y', { metaKey: true })
      expect(callbacks.onResetSelection).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire OpenSwitchModelModal (Cmd+P) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('p', { metaKey: true })
      expect(callbacks.onOpenSwitchModel).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire OpenDiffViewer (Cmd+G) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('g', { metaKey: true })
      expect(callbacks.onOpenDiffViewer).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire CancelSession (Cmd+D) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('d', { metaKey: true })
      expect(callbacks.onCancelSelectedSession).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire ForceCancelSession (Cmd+Shift+D) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('d', { metaKey: true, shiftKey: true })
      expect(callbacks.onCancelSelectedSession).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire UpdateSessionFromParent (Cmd+Shift+U) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('u', { metaKey: true, shiftKey: true })
      expect(callbacks.onUpdateSessionFromParent).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire CreatePullRequest (Cmd+Shift+P) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('p', { metaKey: true, shiftKey: true })
      expect(callbacks.onCreatePullRequest).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire OpenSettings (Cmd+,) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey(',', { metaKey: true })
      expect(callbacks.onOpenSettings).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire FocusClaude (Cmd+T) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('t', { metaKey: true })
      expect(callbacks.onFocusClaude).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire FocusTerminal (Cmd+/) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('/', { metaKey: true })
      expect(callbacks.onFocusTerminal).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire RefineSpec when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('r', { metaKey: true, shiftKey: true })
      expect(callbacks.onRefineSpec).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire ConvertSessionToSpec (Cmd+S) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('s', { metaKey: true })
      expect(callbacks.onSpecSession).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire PromoteSessionVersion (Cmd+B) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('b', { metaKey: true })
      expect(callbacks.onPromoteSelectedVersion).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire OpenMergeModal when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('m', { metaKey: true, shiftKey: true })
      expect(callbacks.onOpenMergeModal).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not fire SelectPrevProject / SelectNextProject when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const prev = pressKey('ArrowLeft', { metaKey: true, shiftKey: true })
      const next = pressKey('ArrowRight', { metaKey: true, shiftKey: true })
      expect(callbacks.onSelectPrevProject).not.toHaveBeenCalled()
      expect(callbacks.onSelectNextProject).not.toHaveBeenCalled()
      expect(prev.defaultPrevented).toBe(false)
      expect(next.defaultPrevented).toBe(false)
    })

    it('does not fire SelectPrevSession / SelectNextSession (Cmd+ArrowUp/Down) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const prev = pressKey('ArrowUp', { metaKey: true })
      const next = pressKey('ArrowDown', { metaKey: true })
      expect(callbacks.onSelectPrevSession).not.toHaveBeenCalled()
      expect(callbacks.onSelectNextSession).not.toHaveBeenCalled()
      expect(prev.defaultPrevented).toBe(false)
      expect(next.defaultPrevented).toBe(false)
    })

    it('does not fire CyclePrevProject / CycleNextProject (Cmd+` / Cmd+Shift+`) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const next = pressKey('`', { metaKey: true })
      const prev = pressKey('`', { metaKey: true, shiftKey: true })
      expect(callbacks.onCycleNextProject).not.toHaveBeenCalled()
      expect(callbacks.onCyclePrevProject).not.toHaveBeenCalled()
      expect(next.defaultPrevented).toBe(false)
      expect(prev.defaultPrevented).toBe(false)
    })

    it('does not fire OpenInApp (Cmd+Shift+O) when modal is open', () => {
      const callbacks = renderAllCallbacks()
      const event = pressKey('o', { metaKey: true, shiftKey: true })
      expect(callbacks.onOpenInApp).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  })
})
