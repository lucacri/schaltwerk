import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { ReactNode } from 'react'
import { NewSessionModal } from './NewSessionModal'
import { ModalProvider } from '../../contexts/ModalContext'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('../specs/MarkdownEditor', async () => {
    const React = await import('react')
    const { forwardRef } = React
    const MockMarkdownEditor = forwardRef(
        ({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder?: string }, _ref) => (
            <textarea
                aria-label="Prompt"
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
            />
        ),
    )
    return { MarkdownEditor: MockMarkdownEditor }
})

vi.mock('../../utils/dockerNames', () => ({
    generateDockerStyleName: () => 'brave_spark',
}))

vi.mock('../../hooks/useAgentPresets', () => ({
    useAgentPresets: () => ({
        presets: [],
        loading: false,
        error: null,
        savePresets: vi.fn().mockResolvedValue(true),
        reloadPresets: vi.fn().mockResolvedValue(undefined),
    }),
}))

vi.mock('../../hooks/useEnabledAgents', () => {
    const enabled = {
        claude: true, copilot: true, opencode: true, gemini: true, codex: true,
        droid: true, qwen: true, amp: true, kilocode: true, terminal: true,
    }
    return {
        useEnabledAgents: () => ({
            enabledAgents: enabled,
            loading: false,
            isAgentEnabled: (agent: string) => Boolean(enabled[agent as keyof typeof enabled]),
        }),
    }
})

vi.mock('../../hooks/useAgentAvailability', () => ({
    useAgentAvailability: () => ({
        availability: {},
        isAvailable: () => true,
        loading: false,
        getRecommendedPath: () => null,
        getInstallationMethod: () => null,
        refreshAvailability: vi.fn(),
        refreshSingleAgent: vi.fn(),
        clearCache: vi.fn(),
        forceRefresh: vi.fn(),
    }),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockImplementation((cmd: string) => {
        switch (cmd) {
            case TauriCommands.GetProjectDefaultBaseBranch:
                return Promise.resolve('main')
            case TauriCommands.GetProjectDefaultBranch:
                return Promise.resolve('main')
            case TauriCommands.SchaltwerkCoreGetAgentType:
                return Promise.resolve('claude')
            case TauriCommands.GetFavoriteOrder:
                return Promise.resolve([])
            default:
                return Promise.resolve(null)
        }
    }),
}))

function renderWithProviders(ui: ReactNode) {
    const store = createStore()
    return render(
        <JotaiProvider store={store}>
            <ModalProvider>{ui}</ModalProvider>
        </JotaiProvider>
    )
}

function getFavoriteButton(name: RegExp | string): HTMLButtonElement {
    const buttons = screen.getAllByRole('button', { name })
    const card = buttons.find(b => b.hasAttribute('aria-pressed'))
    if (!card) throw new Error(`Favorite card not found for ${String(name)}`)
    return card as HTMLButtonElement
}

describe('NewSessionModal — integration', () => {
    afterEach(() => cleanup())
    beforeEach(() => vi.clearAllMocks())

    it('end-to-end: spec card + prompt → payload with isSpec and draftContent', async () => {
        const onClose = vi.fn()
        const onCreate = vi.fn()
        renderWithProviders(
            <NewSessionModal open={true} onClose={onClose} onCreate={onCreate} />
        )
        fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '# Plan' } })
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            isSpec: true,
            draftContent: '# Plan',
            baseBranch: '',
        })
    })

    it('end-to-end: raw-agent card with version 3 → payload versionCount=3', async () => {
        const onCreate = vi.fn()
        renderWithProviders(
            <NewSessionModal open={true} onClose={vi.fn()} onCreate={onCreate} />
        )
        fireEvent.click(getFavoriteButton(/Claude/))
        fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Do' } })
        fireEvent.click(screen.getByTestId('version-selector-button'))
        fireEvent.click(await screen.findByText(/3x versions/))
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            agentType: 'claude',
            versionCount: 3,
            baseBranch: 'main',
        })
    })

    it('end-to-end: Custom settings reveals advanced panel and autonomy flows into payload', async () => {
        const onCreate = vi.fn()
        renderWithProviders(
            <NewSessionModal open={true} onClose={vi.fn()} onCreate={onCreate} />
        )
        fireEvent.click(getFavoriteButton(/Claude/))
        fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Do' } })
        fireEvent.click(screen.getByRole('button', { name: /Custom settings/ }))
        const toggle = await screen.findByTestId('advanced-autonomy-toggle')
        const input = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
        fireEvent.click(input)
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            agentType: 'claude',
            autonomyEnabled: true,
        })
    })
})
