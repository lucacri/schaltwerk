import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeThemeActionAtom, setThemeActionAtom } from '../store/atoms/theme'
import { installStyleGuideTauriMock, STYLE_GUIDE_GITHUB_INTEGRATION } from './mocks'
import { StyleGuide } from './StyleGuide'

let prefersDark = false
let mediaQueryChangeListeners: Array<(event: MediaQueryListEvent) => void> = []

describe('StyleGuide', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('color-scheme')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: prefersDark,
        addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
          mediaQueryChangeListeners.push(listener)
        }),
        removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
          mediaQueryChangeListeners = mediaQueryChangeListeners.filter((entry) => entry !== listener)
        }),
        addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
          mediaQueryChangeListeners.push(listener)
        }),
        removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
          mediaQueryChangeListeners = mediaQueryChangeListeners.filter((entry) => entry !== listener)
        }),
      })),
    })
    prefersDark = false
    mediaQueryChangeListeners = []
    ;(window as typeof window & {
      __LUCODE_STYLE_GUIDE_GITHUB__?: typeof STYLE_GUIDE_GITHUB_INTEGRATION
    }).__LUCODE_STYLE_GUIDE_GITHUB__ = STYLE_GUIDE_GITHUB_INTEGRATION

    installStyleGuideTauriMock('dark')
  })

  it('renders the gallery sections and exposes all supported themes', async () => {
    const store = createStore()
    const user = userEvent.setup()

    render(
      <Provider store={store}>
        <StyleGuide />
      </Provider>,
    )

    expect(screen.getByRole('heading', { name: 'Standalone Style Guide' })).toBeInTheDocument()
    expect(screen.getByText(/bun run style-guide/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Primitives' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session Primitives' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Common Components' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Settings Panels' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dialogs And Modals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Color And Border Reference' })).toBeInTheDocument()
    expect(screen.getAllByText('FavoriteCard').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SectionHeader').length).toBeGreaterThan(0)
    expect(screen.getAllByText('EpicGroupHeader').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SessionCard').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CompactVersionRow').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Open Overlay Menu Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show ConfirmModal Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Link PR Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Reset Dialog Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Discard Dialog Preview' })).toBeInTheDocument()
    expect(screen.queryByText('Reset Session Worktree')).not.toBeInTheDocument()
    expect(screen.queryByText('Discard File Changes')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show ConfirmModal Preview' }))
    await user.click(screen.getByRole('button', { name: 'Show Link PR Preview' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(2)

    await user.click(screen.getByRole('combobox', { name: 'Theme' }))

    expect(screen.getByRole('option', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tokyo Night' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Catppuccin Macchiato' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Darcula' })).toBeInTheDocument()
  })

  it('persists a system theme selection from ThemeSettings and resolves it against matchMedia', async () => {
    const store = createStore()
    const user = userEvent.setup()

    await store.set(initializeThemeActionAtom)

    render(
      <Provider store={store}>
        <StyleGuide />
      </Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'System Beta' }))

    await waitFor(() => {
      expect(localStorage.getItem('lucode-style-guide-theme')).toBe('system')
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light')
    })
  })

  it('recomputes style guide theme-dependent copy when the OS theme changes under system mode', async () => {
    prefersDark = true
    const store = createStore()

    await store.set(initializeThemeActionAtom)

    render(
      <Provider store={store}>
        <StyleGuide />
      </Provider>,
    )

    await act(async () => {
      await store.set(setThemeActionAtom, 'system')
    })

    await waitFor(() => {
      expect(localStorage.getItem('lucode-style-guide-theme')).toBe('system')
    })

    expect(screen.getByText('Resolved token values for the active dark theme.')).toBeInTheDocument()

    prefersDark = false
    act(() => {
      for (const listener of mediaQueryChangeListeners) {
        listener({ matches: false } as MediaQueryListEvent)
      }
    })

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(screen.getByText('Resolved token values for the active light theme.')).toBeInTheDocument()
    })
  })

  it('switches to Darcula from the style guide header selector', async () => {
    const store = createStore()
    const user = userEvent.setup()

    await store.set(initializeThemeActionAtom)

    render(
      <Provider store={store}>
        <StyleGuide />
      </Provider>,
    )

    await user.click(screen.getByRole('combobox', { name: 'Theme' }))
    await user.click(screen.getByRole('option', { name: 'Darcula' }))

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('darcula')
      expect(localStorage.getItem('lucode-style-guide-theme')).toBe('darcula')
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent('Darcula')
    })
  })

  it('renders session primitives from live shared component anatomy', async () => {
    const store = createStore()
    const user = userEvent.setup()

    render(
      <Provider store={store}>
        <StyleGuide />
      </Provider>,
    )

    const sessionPrimitivesSection = screen
      .getByRole('heading', { name: 'Session Primitives' })
      .closest('section')

    expect(sessionPrimitivesSection).not.toBeNull()

    const section = within(sessionPrimitivesSection as HTMLElement)

    expect(section.getByRole('button', { name: /Codex Fast/i })).toHaveAttribute('aria-pressed', 'true')
    expect(section.getByText('⌘2')).toBeInTheDocument()
    expect(section.getByText('modified')).toBeInTheDocument()
    expect(section.getByText('Running Sessions')).toBeInTheDocument()
    expect(section.getByTestId('epic-header-style-guide-contract')).toBeInTheDocument()

    const sessionCard = (sessionPrimitivesSection as HTMLElement).querySelector('[data-session-id="sidebar_refine"]')
    expect(sessionCard).not.toBeNull()
    expect(within(sessionCard as HTMLElement).getByText('Stabilize session primitives before composed sidebar work.')).toBeInTheDocument()
    expect(within(sessionCard as HTMLElement).getByText('1 dirty')).toBeInTheDocument()
    expect(within(sessionCard as HTMLElement).getByTestId('session-card-stat-ahead')).toHaveTextContent('2 ahead')
    expect(within(sessionCard as HTMLElement).getByTestId('session-card-stat-diff')).toHaveTextContent('4 files+28-6')

    const compactVersionRow = section.getByTestId('compact-version-row')
    expect(within(compactVersionRow).getByTestId('compact-row-version-index')).toHaveTextContent('v2')
    expect(within(compactVersionRow).getByTestId('compact-row-agent-chip')).toHaveTextContent('claude')
    expect(within(compactVersionRow).getByText('2 ahead')).toBeInTheDocument()
    expect(within(compactVersionRow).getByTestId('compact-row-status-ready')).toBeInTheDocument()

    await user.click(section.getByRole('button', { name: 'Open Overlay Menu Preview' }))

    const menu = await screen.findByTestId('style-guide-overlay-menu')
    expect(menu.parentElement).toBe(document.body)

    const backdrop = menu.previousElementSibling
    expect(backdrop).toBeInstanceOf(HTMLDivElement)

    await user.click(backdrop as HTMLElement)

    await waitFor(() => {
      expect(screen.queryByTestId('style-guide-overlay-menu')).not.toBeInTheDocument()
    })
  })
})
