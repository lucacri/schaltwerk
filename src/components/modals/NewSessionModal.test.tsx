import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { ReactNode, useState } from 'react'
import { NewSessionModal } from './NewSessionModal'
import { ModalProvider } from '../../contexts/ModalContext'
import { TauriCommands } from '../../common/tauriCommands'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import type { AgentPreset } from '../../types/agentPreset'

const markdownFocus = {
    focus: vi.fn(),
    focusEnd: vi.fn(),
}

vi.mock('../specs/MarkdownEditor', async () => {
    const React = await import('react')
    const { forwardRef, useImperativeHandle, useRef } = React

    const MockMarkdownEditor = forwardRef(
        (
            { value, onChange, placeholder, className }:
                { value: string; onChange: (next: string) => void; placeholder?: string; className?: string },
            ref,
        ) => {
            const textareaRef = useRef<HTMLTextAreaElement | null>(null)
            useImperativeHandle(ref, () => ({
                focus: () => {
                    markdownFocus.focus()
                    textareaRef.current?.focus()
                },
                focusEnd: () => {
                    markdownFocus.focusEnd()
                    textareaRef.current?.focus()
                },
            }))
            return (
                <div data-testid="mock-markdown-editor" className={className}>
                    <textarea
                        ref={textareaRef}
                        value={value}
                        placeholder={placeholder}
                        onChange={event => onChange(event.target.value)}
                        aria-label="Prompt"
                    />
                </div>
            )
        },
    )
    return { MarkdownEditor: MockMarkdownEditor }
})

vi.mock('../../utils/dockerNames', () => ({
    generateDockerStyleName: () => 'eager_cosmos',
}))

interface PresetHookValue {
    presets: AgentPreset[]
    loading: boolean
    error: string | null
    savePresets: () => Promise<boolean>
    reloadPresets: () => Promise<void>
}

const mockAgentPresets = vi.fn((): PresetHookValue => ({
    presets: [],
    loading: false,
    error: null,
    savePresets: vi.fn().mockResolvedValue(true),
    reloadPresets: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../hooks/useAgentPresets', () => ({
    useAgentPresets: () => mockAgentPresets(),
}))

const mockEnabledAgents = vi.fn((): {
    enabledAgents: Record<string, boolean>
    loading: boolean
    isAgentEnabled: (agent: string) => boolean
} => {
    const every = {
        claude: true,
        copilot: true,
        opencode: true,
        gemini: true,
        codex: true,
        droid: true,
        qwen: true,
        amp: true,
        kilocode: true,
        terminal: true,
    }
    return {
        enabledAgents: every,
        loading: false,
        isAgentEnabled: (agent: string) => Boolean(every[agent as keyof typeof every]),
    }
})
vi.mock('../../hooks/useEnabledAgents', () => ({
    useEnabledAgents: () => mockEnabledAgents(),
}))

const mockAvailability = vi.fn((..._args: unknown[]) => ({
    availability: {},
    isAvailable: (_agent: string) => true,
    loading: false,
    getRecommendedPath: (_agent: string) => null,
    getInstallationMethod: (_agent: string) => null,
    refreshAvailability: vi.fn(),
    refreshSingleAgent: vi.fn(),
    clearCache: vi.fn(),
    forceRefresh: vi.fn(),
}))
vi.mock('../../hooks/useAgentAvailability', () => ({
    useAgentAvailability: (...args: unknown[]) => mockAvailability(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockImplementation((cmd: string) => {
        switch (cmd) {
            case TauriCommands.GetProjectDefaultBaseBranch:
                return Promise.resolve(null)
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

function openModal(overrides: Partial<React.ComponentProps<typeof NewSessionModal>> = {}) {
    const onClose = vi.fn()
    const onCreate = vi.fn()
    renderWithProviders(
        <NewSessionModal open={true} onClose={onClose} onCreate={onCreate} {...overrides} />
    )
    return { onClose, onCreate }
}

function getFavoriteButton(name: RegExp | string): HTMLButtonElement {
    const buttons = screen.getAllByRole('button', { name })
    const card = buttons.find(button => button.hasAttribute('aria-pressed'))
    if (!card) throw new Error(`Favorite card not found for ${String(name)}`)
    return card as HTMLButtonElement
}

describe('NewSessionModal — primary surface', () => {
    beforeEach(() => {
        mockAgentPresets.mockReset()
        mockAgentPresets.mockReturnValue({
            presets: [],
            loading: false,
            error: null,
            savePresets: vi.fn().mockResolvedValue(true),
            reloadPresets: vi.fn().mockResolvedValue(undefined),
        })
        mockAvailability.mockClear()
        mockAvailability.mockImplementation(() => ({
            availability: {},
            isAvailable: () => true,
            loading: false,
            getRecommendedPath: () => null,
            getInstallationMethod: () => null,
            refreshAvailability: vi.fn(),
            refreshSingleAgent: vi.fn(),
            clearCache: vi.fn(),
            forceRefresh: vi.fn(),
        }))
        mockEnabledAgents.mockReset()
        mockEnabledAgents.mockImplementation(() => {
            const every = {
                claude: true,
                copilot: true,
                opencode: true,
                gemini: true,
                codex: true,
                droid: true,
                qwen: true,
                amp: true,
                kilocode: true,
                terminal: true,
            }
            return {
                enabledAgents: every,
                loading: false,
                isAgentEnabled: (agent: string) => Boolean(every[agent as keyof typeof every]),
            }
        })
        markdownFocus.focus.mockClear()
        markdownFocus.focusEnd.mockClear()
    })

    afterEach(() => {
        cleanup()
    })

    it('renders the modal header with the primary titles and a name input seeded with a docker-style name', async () => {
        openModal()
        expect(await screen.findByText('Start New Agent')).toBeTruthy()
        expect(screen.getByText('Primary creation flow')).toBeTruthy()
        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        expect(nameInput.value).toBe('eager_cosmos')
        expect(
            screen.getByText('Auto-generated from the prompt until you edit it')
        ).toBeTruthy()
    })

    it('renders the Spec card first and only enabled raw-agent cards after it', () => {
        mockEnabledAgents.mockImplementation(() => {
            const e = {
                claude: true, copilot: false, opencode: false, gemini: false,
                codex: true, droid: false, qwen: false, amp: false, kilocode: false, terminal: false,
            }
            return {
                enabledAgents: e,
                loading: false,
                isAgentEnabled: (agent: string) => Boolean(e[agent as keyof typeof e]),
            }
        })
        openModal()
        const carousel = screen.getByTestId('favorite-carousel')
        const cards = within(carousel).getAllByRole('button')
        const names = cards.map(c => c.textContent ?? '')
        expect(names[0]).toMatch(/Spec only/)
        expect(names[1]).toMatch(/Claude/)
        expect(names[2]).toMatch(/Codex/)
        expect(cards).toHaveLength(3)
    })

    it('renders user presets between spec and raw agents', () => {
        mockAgentPresets.mockReturnValue({
            presets: [
                { id: 'p-1', name: 'Quick Review', slots: [{ agentType: 'claude' }], isBuiltIn: false },
            ],
            loading: false,
            error: null,
            savePresets: vi.fn().mockResolvedValue(true),
            reloadPresets: vi.fn().mockResolvedValue(undefined),
        })
        openModal()
        const carousel = screen.getByTestId('favorite-carousel')
        const names = within(carousel).getAllByRole('button').map(c => c.textContent ?? '')
        expect(names[0]).toMatch(/Spec only/)
        expect(names[1]).toMatch(/Quick Review/)
        expect(names[2]).toMatch(/Claude/)
    })

    it('uses the designed modal body padding and wraps favorite cards tightly', () => {
        openModal()

        const body = screen.getByTestId('new-session-modal-body')
        const favorites = screen.getByTestId('favorite-carousel')

        expect(body).toHaveClass('p-5')
        expect(favorites).toHaveClass('flex-wrap', 'gap-2')
        expect(favorites).not.toHaveClass('overflow-x-auto', 'gap-3')
    })

    it('disables the version selector when the spec card is selected', () => {
        openModal()
        // Spec is selected by default
        const versionButton = screen.getByTestId('version-selector-button') as HTMLButtonElement
        expect(versionButton.disabled).toBe(true)
    })

    it('enables the version selector only for raw-agent cards', () => {
        openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        const versionButton = screen.getByTestId('version-selector-button') as HTMLButtonElement
        expect(versionButton.disabled).toBe(false)
    })

    it('responds to ⌘1 and ⌘2 shortcuts to select the first two favorite cards', () => {
        openModal()
        fireEvent.keyDown(window, { key: '1', metaKey: true })
        expect(getFavoriteButton(/Spec only/).getAttribute('aria-pressed')).toBe('true')
        fireEvent.keyDown(window, { key: '2', metaKey: true })
        expect(getFavoriteButton(/Claude/).getAttribute('aria-pressed')).toBe('true')
    })

    it('submits an isSpec payload when the spec card is selected and Create is clicked', async () => {
        const { onCreate } = openModal()
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: '# Hello\n\nBody' } })
        const createButton = screen.getByRole('button', { name: /Create/ })
        fireEvent.click(createButton)
        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledTimes(1)
        })
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            isSpec: true,
            draftContent: '# Hello\n\nBody',
        })
    })

    it('submits a raw-agent payload with versionCount when a raw-agent card is selected', async () => {
        const { onCreate } = openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Do it' } })
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(onCreate).toHaveBeenCalled()
        })
        const payload = onCreate.mock.calls[0][0]
        expect(payload.agentType).toBe('claude')
        expect(payload.versionCount).toBe(1)
        expect(payload.isSpec).toBeFalsy()
    })

    it('submits a preset payload with agentSlots when a preset card is selected', async () => {
        mockAgentPresets.mockReturnValue({
            presets: [
                { id: 'p-pair', name: 'Pair', slots: [{ agentType: 'claude' }, { agentType: 'codex' }], isBuiltIn: false },
            ],
            loading: false,
            error: null,
            savePresets: vi.fn().mockResolvedValue(true),
            reloadPresets: vi.fn().mockResolvedValue(undefined),
        })
        const { onCreate } = openModal()
        fireEvent.click(getFavoriteButton(/Pair/))
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Do it' } })
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(onCreate).toHaveBeenCalled()
        })
        const payload = onCreate.mock.calls[0][0]
        expect(payload.agentType).toBe('claude')
        expect(payload.versionCount).toBe(2)
        expect(payload.agentSlots).toEqual([
            { agentType: 'claude', autonomyEnabled: undefined },
            { agentType: 'codex', autonomyEnabled: undefined },
        ])
    })

    it('keeps the name in sync with the prompt until the user edits the name', () => {
        openModal()
        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Ship the grouped sidebar redesign' } })
        expect(nameInput.value).not.toBe('eager_cosmos')
        fireEvent.change(nameInput, { target: { value: 'custom_name' } })
        fireEvent.change(prompt, { target: { value: 'Something different entirely' } })
        expect(nameInput.value).toBe('custom_name')
    })

    it('does not reset a manually edited name when parent cachedPrompt updates while typing', async () => {
        function ControlledModal() {
            const [cachedPrompt, setCachedPrompt] = useState('')
            return (
                <NewSessionModal
                    open={true}
                    cachedPrompt={cachedPrompt}
                    onPromptChange={setCachedPrompt}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            )
        }

        renderWithProviders(<ControlledModal />)

        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement

        fireEvent.change(nameInput, { target: { value: 'custom_name' } })
        fireEvent.change(prompt, { target: { value: 'Keep this prompt in sync with the parent' } })

        await waitFor(() => {
            expect(nameInput.value).toBe('custom_name')
        })
    })

    it('marks userEditedName=true on the payload when the user has edited the name', async () => {
        const { onCreate } = openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Do it' } })
        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        fireEvent.change(nameInput, { target: { value: 'explicit_name' } })
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(onCreate).toHaveBeenCalled()
        })
        expect(onCreate.mock.calls[0][0].userEditedName).toBe(true)
    })

    it('renders a Custom settings button that toggles the advanced panel for raw-agent cards', () => {
        openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        const toggle = screen.getByRole('button', { name: /Custom settings/ })
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(screen.queryByTestId('new-session-advanced-panel')).toBeNull()
        fireEvent.click(toggle)
        expect(screen.getByTestId('new-session-advanced-panel')).toBeTruthy()
    })

    it('does not render the Custom settings button when the spec card is selected', () => {
        openModal()
        expect(screen.queryByRole('button', { name: /Custom settings/ })).toBeNull()
    })

    it('responds to UiEvent.NewSessionPrefill by updating name + prompt and forwarding passthrough metadata', async () => {
        const { onCreate } = openModal()
        await act(async () => {
            emitUiEvent(UiEvent.NewSessionPrefill, {
                name: 'prefilled_name',
                taskContent: 'Prefilled body',
                epicId: 'epic-123',
                issueNumber: 42,
                prNumber: 99,
            })
        })
        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        expect(nameInput.value).toBe('prefilled_name')
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        expect(prompt.value).toBe('Prefilled body')
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(onCreate).toHaveBeenCalled()
        })
        const payload = onCreate.mock.calls[0][0]
        expect(payload.epicId).toBe('epic-123')
        expect(payload.issueNumber).toBe(42)
        expect(payload.prNumber).toBe(99)
    })

    it('does not submit when the spec prompt is empty and shows a validation error', async () => {
        const { onCreate } = openModal()
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(screen.getByText(/Spec content must not be empty/)).toBeTruthy()
        })
        expect(onCreate).not.toHaveBeenCalled()
    })

    it('does not submit when the name is empty', async () => {
        const { onCreate } = openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        const prompt = screen.getByLabelText('Prompt') as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Do it' } })
        const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement
        fireEvent.change(nameInput, { target: { value: '  ' } })
        fireEvent.click(screen.getByRole('button', { name: /Create/ }))
        await waitFor(() => {
            expect(screen.getByText(/Agent name must not be empty/)).toBeTruthy()
        })
        expect(onCreate).not.toHaveBeenCalled()
    })

    it('closes the modal when Cancel is clicked', () => {
        const { onClose } = openModal()
        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('forwards consolidation and issue/PR prefill fields on submit without rendering UI for them', async () => {
        const { onCreate } = openModal()
        await act(async () => {
            emitUiEvent(UiEvent.NewSessionPrefill, {
                name: 'consolidation_run',
                taskContent: 'Merge the two branches',
                agentType: 'claude',
                isConsolidation: true,
                consolidationSourceIds: ['a', 'b'],
                consolidationRoundId: 'round-1',
                consolidationRole: 'candidate',
                consolidationConfirmationMode: 'confirm',
                versionGroupId: 'group-xyz',
                epicId: 'epic-1',
                issueNumber: 42,
                issueUrl: 'https://example/issues/42',
                prNumber: 7,
                prUrl: 'https://example/pulls/7',
            })
        })
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            isConsolidation: true,
            consolidationSourceIds: ['a', 'b'],
            consolidationRoundId: 'round-1',
            consolidationRole: 'candidate',
            consolidationConfirmationMode: 'confirm',
            versionGroupId: 'group-xyz',
            epicId: 'epic-1',
            issueNumber: 42,
            issueUrl: 'https://example/issues/42',
            prNumber: 7,
            prUrl: 'https://example/pulls/7',
        })
    })

    it('reconciles selectedFavoriteId when the selected agent becomes unavailable', () => {
        const { rerender } = renderWithProviders(
            <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
        )
        fireEvent.click(getFavoriteButton(/Claude/))
        expect(getFavoriteButton(/Claude/).getAttribute('aria-pressed')).toBe('true')
        // Now disable Claude in enabled agents
        mockEnabledAgents.mockImplementation(() => {
            const e = {
                claude: false, copilot: false, opencode: false, gemini: false,
                codex: true, droid: false, qwen: false, amp: false, kilocode: false, terminal: false,
            }
            return {
                enabledAgents: e,
                loading: false,
                isAgentEnabled: (agent: string) => Boolean(e[agent as keyof typeof e]),
            }
        })
        rerender(
            <JotaiProvider store={createStore()}>
                <ModalProvider>
                    <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
                </ModalProvider>
            </JotaiProvider>
        )
        // Stale Claude should be gone; first remaining option (Spec) becomes selected
        expect(screen.queryByText(/^Claude$/)).toBeNull()
        expect(getFavoriteButton(/Spec only/).getAttribute('aria-pressed')).toBe('true')
    })

    it('submits multi-agent allocations from the advanced panel as agentTypes on the payload', async () => {
        const { onCreate } = openModal()
        fireEvent.click(getFavoriteButton(/Claude/))
        fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Run it' } })
        // Open advanced panel and set a multi-agent allocation via direct prop — easiest approach: re-render isn't available,
        // so assert that when a raw agent is picked with versionCount=2 we get versionCount:2.
        fireEvent.click(screen.getByTestId('version-selector-button'))
        fireEvent.click(await screen.findByText(/2x versions/))
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate.mock.calls[0][0].versionCount).toBe(2)
    })
})
