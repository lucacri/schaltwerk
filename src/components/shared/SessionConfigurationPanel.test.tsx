import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { SessionConfigurationPanel, useSessionConfiguration } from './SessionConfigurationPanel'
import { invoke } from '@tauri-apps/api/core'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { useState } from 'react'
import { FALLBACK_CODEX_MODELS } from '../../common/codexModels'
import { logger } from '../../utils/logger'

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))
vi.mock('../../utils/logger', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
    }
}))

// Mock useClaudeSession hook
vi.mock('../../hooks/useClaudeSession', () => ({
    useClaudeSession: () => ({
        getAgentType: vi.fn().mockResolvedValue('claude'),
        setAgentType: vi.fn().mockResolvedValue(true),
        getOrchestratorAgentType: vi.fn().mockResolvedValue('claude'),
        setOrchestratorAgentType: vi.fn().mockResolvedValue(true)
    })
}))

// Mock child components
vi.mock('../inputs/BranchAutocomplete', () => ({
    BranchAutocomplete: ({
        value,
        onChange,
        branches,
        onValidationChange,
        disabled,
        placeholder
    }: {
        value?: string
        onChange?: (value: string) => void
        branches?: string[]
        onValidationChange?: (valid: boolean) => void
        disabled?: boolean
        placeholder?: string
    }) => (
        <div data-testid="branch-autocomplete">
            <input
                data-testid="branch-autocomplete-input"
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
                placeholder={placeholder}
            />
            <div data-testid="branch-count">{branches?.length ?? 0}</div>
            <button
                onClick={() => onValidationChange?.(true)}
                data-testid="validate-branch"
                disabled={!onValidationChange}
            >
                Validate
            </button>
        </div>
    )
}))

vi.mock('../inputs/ModelSelector', () => ({
    ModelSelector: ({
        value,
        onChange,
        disabled,
        autonomyEnabled,
        onAutonomyChange
    }: {
        value?: string
        onChange?: (value: string) => void
        disabled?: boolean
        autonomyEnabled?: boolean
        onAutonomyChange?: (enabled: boolean) => void
    }) => {
        const supportsAutonomy = value !== 'terminal'
        return (
            <div data-testid="model-selector">
                <select
                    value={value ?? ''}
                    onChange={(e) => onChange?.(e.target.value)}
                    disabled={disabled}
                >
                    <option value="claude">Claude</option>
                    <option value="opencode">OpenCode</option>
                    <option value="gemini">Gemini</option>
                    <option value="codex">Codex</option>
                    <option value="terminal">Terminal</option>
                </select>
                {supportsAutonomy && onAutonomyChange ? (
                    <button
                        type="button"
                        data-testid="toggle-autonomy"
                        aria-pressed={!!autonomyEnabled}
                        onClick={() => onAutonomyChange(!autonomyEnabled)}
                        disabled={disabled}
                    >
                        Toggle Autonomy
                    </button>
                ) : null}
            </div>
        )
    }
}))

const mockInvoke = invoke as MockedFunction<typeof invoke>

describe('SessionConfigurationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main', 'develop', 'feature/test'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve('main')
                case TauriCommands.GetProjectDefaultBranch:
                    return Promise.resolve('main')
                case TauriCommands.GetProjectSettings:
                    return Promise.resolve({ setup_script: '', branch_prefix: 'schaltwerk' })
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.SetProjectDefaultBaseBranch:
                    return Promise.resolve()
                default:
                    return Promise.resolve()
            }
        })
    })

    test('renders in modal variant', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                codexModels={FALLBACK_CODEX_MODELS}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.getByText('Base branch')).toBeInTheDocument()
        expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    test('associates the branch name label with its input and uses shared checkbox chrome', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                codexModels={FALLBACK_CODEX_MODELS}
            />
        )

        expect(await screen.findByLabelText('Branch name (optional)')).toBeInTheDocument()
        expect(screen.getByRole('checkbox', { name: 'Use existing branch' })).toHaveClass('peer', 'sr-only')
    })

    test('renders Codex model and reasoning selectors when provided with options', async () => {
        const onCodexModelChange = vi.fn()
        const onCodexReasoningChange = vi.fn()

        render(
            <SessionConfigurationPanel
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                initialAgentType="codex"
                codexModel="gpt-5.3-codex"
                codexModelOptions={['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4']}
                codexModels={FALLBACK_CODEX_MODELS}
                onCodexModelChange={onCodexModelChange}
                codexReasoningEffort="medium"
                onCodexReasoningChange={onCodexReasoningChange}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-selector')).toBeInTheDocument()
            expect(screen.getByTestId('codex-reasoning-selector')).toBeInTheDocument()
        })

        expect(screen.getByText('⌘← · ⌘→')).toBeInTheDocument()

        fireEvent.click(screen.getByTestId('codex-model-selector'))
        const option = await screen.findByText('GPT-5.4')
        fireEvent.click(option)

        expect(onCodexModelChange).toHaveBeenCalledWith('gpt-5.4')

        fireEvent.click(screen.getByTestId('codex-reasoning-selector'))
        const reasoningOption = await screen.findByText('High')
        fireEvent.click(reasoningOption)
        expect(onCodexReasoningChange).toHaveBeenCalledWith('high')
    })

    test('renders in compact variant', async () => {
        render(
            <SessionConfigurationPanel 
                variant="compact"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                codexModels={FALLBACK_CODEX_MODELS}
                hideLabels={false}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.getByText('Branch:')).toBeInTheDocument()
        expect(screen.getByText('Agent:')).toBeInTheDocument()
    })

    test('hides labels when hideLabels is true', async () => {
        render(
            <SessionConfigurationPanel 
                variant="compact"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                hideLabels={true}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        expect(screen.queryByText('Branch:')).not.toBeInTheDocument()
        expect(screen.queryByText('Agent:')).not.toBeInTheDocument()
    })

    test('calls onBaseBranchChange when branch changes', async () => {
        const onBaseBranchChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={onBaseBranchChange}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = await screen.findByDisplayValue('main')
        fireEvent.change(input, { target: { value: 'develop' } })

        expect(onBaseBranchChange).toHaveBeenCalledWith('develop')
    })

    test('calls onAgentTypeChange when agent changes', async () => {
        const onAgentTypeChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={onAgentTypeChange}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        const select = screen.getByTestId('model-selector').querySelector('select')
        expect(select).toBeTruthy()
        fireEvent.change(select!, { target: { value: 'opencode' } })

        expect(onAgentTypeChange).toHaveBeenCalledWith('opencode')
    })

    test('does not refetch branches on every base branch change', async () => {
        const Harness = () => {
            const [baseBranch, setBaseBranch] = useState('')
            return (
                <SessionConfigurationPanel
                    variant="modal"
                    initialBaseBranch={baseBranch}
                    onBaseBranchChange={setBaseBranch}
                    onAgentTypeChange={vi.fn()}
    
                />
            )
        }

        render(<Harness />)

        await waitFor(() => {
            expect(screen.getByTestId('branch-count')).toHaveTextContent('3')
        })

        const listBranchCalls = () =>
            mockInvoke.mock.calls.filter(([command]) => command === TauriCommands.ListProjectBranches).length

        expect(listBranchCalls()).toBe(1)

        const input = screen.getByTestId('branch-autocomplete-input') as HTMLInputElement
        fireEvent.change(input, { target: { value: 'patch/fix' } })

        await waitFor(() => {
            expect(input).toHaveValue('patch/fix')
        })

        expect(listBranchCalls()).toBe(1)
    })

    test('disables components when disabled prop is true', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                disabled={true}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = await screen.findByDisplayValue('main')

        expect(input).toBeDisabled()
    })

    test('shows autonomy toggle for supported agents', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                onAutonomyChange={vi.fn()}
                initialAgentType="claude"
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.getByTestId('toggle-autonomy')).toBeInTheDocument()
    })

    test('hides autonomy toggle for terminal agent', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

                onAutonomyChange={vi.fn()}
                initialAgentType="terminal"
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.queryByTestId('toggle-autonomy')).not.toBeInTheDocument()
    })

    test('loads branches and sets default branch on mount', async () => {
        const onBaseBranchChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={onBaseBranchChange}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.ListProjectBranches)
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetProjectDefaultBaseBranch)
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetProjectDefaultBranch)
        })

        await waitFor(() => {
            expect(screen.getByTestId('branch-count')).toHaveTextContent('3')
        })

        expect(onBaseBranchChange).toHaveBeenCalledWith('main')
    })

    test('saves branch as project default when changed', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = await screen.findByDisplayValue('main')
        fireEvent.change(input, { target: { value: 'develop' } })

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectDefaultBaseBranch, { branch: 'develop' })
        })
    })

    test('handles branch loading errors gracefully', async () => {
        mockInvoke.mockImplementation((command: string) => {
            if (command === TauriCommands.ListProjectBranches) {
                return Promise.reject(new Error('Failed to load branches'))
            }
            return Promise.resolve()
        })

        const consoleSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load configuration:', expect.any(Error))
        })

        expect(screen.getByTestId('branch-count')).toHaveTextContent('0')
        
        consoleSpy.mockRestore()
    })
})

describe('useSessionConfiguration', () => {
    test('returns initial configuration and update function', () => {
        const TestComponent = () => {
            const [config, updateConfig] = useSessionConfiguration()

            return (
                <div>
                    <div data-testid="base-branch">{config.baseBranch}</div>
                    <div data-testid="agent-type">{config.agentType}</div>
                    <div data-testid="is-valid">{config.isValid.toString()}</div>
                    <button
                        onClick={() => updateConfig({ baseBranch: 'develop', isValid: true })}
                        data-testid="update-config"
                    >
                        Update
                    </button>
                </div>
            )
        }

        render(<TestComponent />)

        expect(screen.getByTestId('base-branch')).toHaveTextContent('')
        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude')
        expect(screen.getByTestId('is-valid')).toHaveTextContent('false')

        fireEvent.click(screen.getByTestId('update-config'))

        expect(screen.getByTestId('base-branch')).toHaveTextContent('develop')
        expect(screen.getByTestId('is-valid')).toHaveTextContent('true')
    })

    test('preserves existing config when updating partial values', () => {
        const TestComponent = () => {
            const [config, updateConfig] = useSessionConfiguration()

            return (
                <div>
                    <div data-testid="agent-type">{config.agentType}</div>
                    <div data-testid="autonomy">{config.autonomyEnabled.toString()}</div>
                    <button
                        onClick={() => updateConfig({ autonomyEnabled: true })}
                        data-testid="update-autonomy"
                    >
                        Update Autonomy
                    </button>
                </div>
            )
        }

        render(<TestComponent />)

        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude')
        expect(screen.getByTestId('autonomy')).toHaveTextContent('false')

        fireEvent.click(screen.getByTestId('update-autonomy'))

        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude')
        expect(screen.getByTestId('autonomy')).toHaveTextContent('true')
    })
})

describe('SessionConfigurationPanel with empty branch prefix', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main', 'develop'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve('main')
                case TauriCommands.GetProjectDefaultBranch:
                    return Promise.resolve('main')
                case TauriCommands.GetProjectSettings:
                    return Promise.resolve({ setup_script: '', branch_prefix: '' })
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.SetProjectDefaultBaseBranch:
                    return Promise.resolve()
                default:
                    return Promise.resolve()
            }
        })
    })

    test('shows session name only in placeholder when branch prefix is empty', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                sessionName="my-feature"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const branchInput = screen.getByPlaceholderText('my-feature')
        expect(branchInput).toBeInTheDocument()
    })

    test('renders branch-row layout with both branch controls side by side', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                layout="branch-row"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })
    })

    test('renders default layout when layout prop is omitted', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })
    })

    test('hides agent section when hideAgentType is true in branch-row layout', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                layout="branch-row"
                hideAgentType={true}
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    test('shows placeholder without leading slash when branch prefix is empty', async () => {
        render(
            <SessionConfigurationPanel
                variant="modal"
                sessionName="test-session"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}

            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const helpText = screen.getByText(/New branch name for this session/)
        expect(helpText).toHaveTextContent('test-session')
        expect(helpText.textContent).not.toContain('/test-session')
    })
})
