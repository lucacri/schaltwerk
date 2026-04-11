import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, type Mock } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { ModalProvider } from '../../contexts/ModalContext'
import { defaultShortcutConfig } from '../../keyboardShortcuts/config'
import { TauriCommands } from '../../common/tauriCommands'
import { renderWithProviders } from '../../tests/test-utils'

// Mock MarkdownEditor to avoid CodeMirror coordinate calculation issues in happy-dom
vi.mock('../specs/MarkdownEditor', async () => {
  const React = await import('react')
  const { forwardRef, useImperativeHandle, useRef } = React

  const MockMarkdownEditor = forwardRef(({ value, onChange, placeholder, className }: { value: string; onChange: (next: string) => void; placeholder?: string; className?: string }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus()
      },
      focusEnd: () => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          const len = el.value.length
          el.selectionStart = len
          el.selectionEnd = len
        }
      },
    }))

    return (
      <div data-testid="mock-markdown-editor" className={className}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={event => onChange(event.target.value)}
          style={{ width: '100%', minHeight: '100px' }}
          data-testid="setup-script-textarea"
        />
        <div className="cm-editor">
          <div className="cm-scroller">
            <div className="cm-content">
              {value ? (
                value.split('\n').map((line, index) => (
                  <div key={index} className="cm-line">
                    {line}
                  </div>
                ))
              ) : (
                <div className="cm-placeholder">{placeholder ?? ''}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  })

  return { MarkdownEditor: MockMarkdownEditor }
})

vi.mock('../inputs/ModelSelector', () => ({
  ModelSelector: ({
    value,
    onChange,
    allowedAgents,
  }: {
    value: string
    onChange: (value: string) => void
    allowedAgents?: readonly string[]
  }) => (
    <select
      aria-label="Spec clarification agent"
      data-testid="spec-clarification-agent-selector"
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      {(allowedAgents ?? []).map((agent) => (
        <option key={agent} value={agent}>{agent}</option>
      ))}
    </select>
  )
}))

const baseInvokeImplementation = async (command: string, _args?: unknown) => {
  switch (command) {
    case TauriCommands.GetAllAgentBinaryConfigs:
      return []
    case TauriCommands.GetProjectRunScript:
      return null
    case TauriCommands.GetActiveProjectPath:
      return null
    case TauriCommands.GetProjectActionButtons:
      return []
    case TauriCommands.GetAgentBinaryConfig:
    case TauriCommands.RefreshAgentBinaryDetection:
      return {
        agent_name: 'claude',
        custom_path: null,
        auto_detect: true,
        detected_binaries: [],
      }
    case TauriCommands.GetAppVersion:
      return '0.2.2'
    case TauriCommands.GetDevErrorToastsEnabled:
      return false
    case TauriCommands.SetDevErrorToastsEnabled:
      return null
    default:
      return null
  }
}

const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(baseInvokeImplementation)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('../SpecContentModal', () => ({
  SpecContentModal: () => null,
}))

vi.mock('../settings/MCPConfigPanel', () => ({
  MCPConfigPanel: () => null,
}))

vi.mock('../settings/GithubProjectIntegrationCard', () => ({
  GithubProjectIntegrationCard: () => null,
}))

vi.mock('../settings/SettingsArchivesSection', () => ({
  SettingsArchivesSection: () => null,
}))

vi.mock('../../utils/attentionBridge', () => ({
  requestDockBounce: vi.fn(),
}))

const requestDockBounceMock = vi.mocked((await import('../../utils/attentionBridge')).requestDockBounce)

const pushToastMock = vi.fn()

vi.mock('../../common/toast/ToastProvider', () => ({
  useOptionalToast: () => ({ pushToast: pushToastMock }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./FontPicker', () => ({
  FontPicker: () => null,
}))

const useFontSizeValue = {
  terminalFontSize: 13,
  uiFontSize: 12,
  setTerminalFontSize: vi.fn(),
  setUiFontSize: vi.fn(),
  increaseFontSizes: vi.fn(),
  decreaseFontSizes: vi.fn(),
  resetFontSizes: vi.fn(),
}

vi.mock('../../contexts/FontSizeContext', () => ({
  useFontSize: () => useFontSizeValue,
}))

const applyOverridesMock = vi.fn()

vi.mock('../../contexts/KeyboardShortcutsContext', () => ({
  useKeyboardShortcutsConfig: () => ({
    config: defaultShortcutConfig,
    loading: false,
    setConfig: vi.fn(),
    applyOverrides: applyOverridesMock,
    resetToDefaults: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const actionButtonsValue = {
  actionButtons: [],
  loading: false,
  error: null,
  saveActionButtons: vi.fn().mockResolvedValue(true),
  resetToDefaults: vi.fn().mockResolvedValue(true),
  reloadActionButtons: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../hooks/useActionButtons', () => ({
  useActionButtons: () => actionButtonsValue,
}))

const createEmptyEnvVars = () => ({
  claude: [],
  copilot: [],
  opencode: [],
  gemini: [],
  codex: [],
  droid: [],
  qwen: [],
  amp: [],
  kilocode: [],
  terminal: [],
})

const createEmptyCliArgs = () => ({
  claude: '',
  copilot: '',
  opencode: '',
  gemini: '',
  codex: '',
  droid: '',
  qwen: '',
  amp: '',
  kilocode: '',
  terminal: '',
})

const createEmptyPreferences = () => ({
  claude: { model: '', reasoningEffort: '' },
  copilot: { model: '', reasoningEffort: '' },
  opencode: { model: '', reasoningEffort: '' },
  gemini: { model: '', reasoningEffort: '' },
  codex: { model: '', reasoningEffort: '' },
  droid: { model: '', reasoningEffort: '' },
  qwen: { model: '', reasoningEffort: '' },
  amp: { model: '', reasoningEffort: '' },
  kilocode: { model: '', reasoningEffort: '' },
  terminal: { model: '', reasoningEffort: '' },
})

const createDefaultEnabledAgents = () => ({
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
})

const createDefaultUseSettingsValue = () => ({
  loading: false,
  saving: false,
  saveAllSettings: vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] }),
  loadEnvVars: vi.fn().mockResolvedValue(createEmptyEnvVars()),
  loadCliArgs: vi.fn().mockResolvedValue(createEmptyCliArgs()),
  loadAgentPreferences: vi.fn().mockResolvedValue(createEmptyPreferences()),
  loadEnabledAgents: vi.fn().mockResolvedValue(createDefaultEnabledAgents()),
  loadProjectSettings: vi.fn().mockResolvedValue({ setupScript: '', branchPrefix: 'schaltwerk', worktreeBaseDirectory: '', environmentVariables: [] }),
  loadTerminalSettings: vi.fn().mockResolvedValue({ shell: null, shellArgs: [], fontFamily: null }),
  loadSessionPreferences: vi.fn().mockResolvedValue({
    skip_confirmation_modals: false,
    always_show_large_diffs: false,
    attention_notification_mode: 'dock',
    remember_idle_baseline: true
  }),
  loadMergePreferences: vi.fn().mockResolvedValue({ autoCancelAfterMerge: true }),
  loadKeyboardShortcuts: vi.fn().mockResolvedValue(defaultShortcutConfig),
  saveKeyboardShortcuts: vi.fn().mockResolvedValue(undefined),
  saveEnabledAgents: vi.fn().mockResolvedValue(undefined),
  loadInstalledFonts: vi.fn().mockResolvedValue([]),
})

const useSettingsMock = vi.fn(createDefaultUseSettingsValue)

const createDefaultUseSessionsValue = () => ({
  autoCancelAfterMerge: true,
  updateAutoCancelAfterMerge: vi.fn().mockResolvedValue(undefined),
})

const useSessionsMock = vi.fn(createDefaultUseSessionsValue)

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => useSettingsMock(),
  AgentType: undefined,
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => useSessionsMock(),
}))

describe('SettingsModal loading indicators', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
    // jsdom doesn't provide confirm by default; provide a stub for tests
    window.confirm = vi.fn() as unknown as typeof window.confirm
  })

  it('renders textual loader when settings are loading', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loading = true
    useSettingsMock.mockReturnValue(settingsValue)

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    expect(await screen.findByText('Loading settings...')).toBeInTheDocument()
  })

  it('shows saving text in footer button when saving', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.saving = true
    useSettingsMock.mockReturnValue(settingsValue)

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeInTheDocument()
  })

  it('triggers attention notification test button', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadSessionPreferences = vi.fn().mockResolvedValue({
      skip_confirmation_modals: false,
      always_show_large_diffs: false,
      attention_notification_mode: 'dock',
      remember_idle_baseline: true
    })
    useSettingsMock.mockReturnValue(settingsValue)

    const user = userEvent.setup()

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Sessions' }))

    const testButton = await screen.findByText('Test notification')
    await user.click(testButton)

    await waitFor(() => expect(requestDockBounceMock).toHaveBeenCalled())
  })

  it('disables remember idle baseline toggle when notifications are off', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadSessionPreferences = vi.fn().mockResolvedValue({
      skip_confirmation_modals: false,
      always_show_large_diffs: false,
      attention_notification_mode: 'off',
      remember_idle_baseline: true
    })
    useSettingsMock.mockReturnValue(settingsValue)

    const user = userEvent.setup()

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Sessions' }))

    const baselineToggle = await screen.findByLabelText('Remember idle sessions when I switch away')
    expect(baselineToggle).toBeDisabled()
  })
})

describe('SettingsModal initial tab handling', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSessionsMock.mockReset()
    invokeMock.mockClear()
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) {
        return '/Users/test/project'
      }
      return baseInvokeImplementation(command, args)
    })
    requestDockBounceMock.mockReset()
  })

  it('opens the specified initial tab when provided', async () => {
    renderWithProviders(
      <SettingsModal
        open={true}
        initialTab="projectRun"
        onClose={() => {}}
      />
    )

    const runButton = await screen.findByRole('button', { name: 'Run & Environment' })
    await waitFor(() => {
      expect(runButton).toHaveStyle({ fontWeight: 500 })
    })
  })

  it('defaults to the project settings tab when no initial tab is provided', async () => {
    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    const projectSettingsButton = await screen.findByRole('button', { name: 'Project Settings' })
    await waitFor(() => {
      expect(projectSettingsButton).toHaveStyle({ fontWeight: 500 })
    })
  })

  it('responds to changes in the initialTab prop', async () => {
    const { rerender } = renderWithProviders(
      <SettingsModal
        open={true}
        initialTab="appearance"
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      const appearanceButton = screen.getByRole('button', { name: 'Appearance' })
      expect(appearanceButton).toHaveStyle({ fontWeight: 500 })
    })

    rerender(
      <ModalProvider>
        <SettingsModal
          open={true}
          initialTab="projectRun"
          onClose={() => {}}
        />
      </ModalProvider>
    )

    await waitFor(() => {
      const runButton = screen.getByRole('button', { name: 'Run & Environment' })
      const appearanceButtonAfter = screen.getByRole('button', { name: 'Appearance' })
      expect(runButton).toHaveStyle({ fontWeight: 500 })
      expect(appearanceButtonAfter).not.toHaveStyle({ fontWeight: 500 })
    })
  })

}) 

describe('SettingsModal version settings', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

})

describe('SettingsModal appearance settings', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('loads dev error toast preference on mount', async () => {
    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetDevErrorToastsEnabled)
    })
  })

  it('persists dev error toast preference changes', async () => {
    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetDevErrorToastsEnabled)
    })

    await screen.findByRole('switch', { name: /Show error toasts automatically during dev runs/i })
    await userEvent.click(screen.getByRole('switch', { name: /Show error toasts automatically during dev runs/i }))

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const didInvoke = invokeMock.mock.calls.some(([command, args]) => {
        if (command !== TauriCommands.SetDevErrorToastsEnabled) return false
        const payload = args as { enabled?: boolean } | undefined
        return payload?.enabled === true
      })
      expect(didInvoke).toBe(true)
    })
  })
})

describe('SettingsModal project settings navigation', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('nests run script and action buttons under Project Settings sub-navigation', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    useSettingsMock.mockReturnValue(settingsValue)

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) {
        return Promise.resolve('/Users/example/project')
      }
      return baseInvokeImplementation(command, args)
    })

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    const user = userEvent.setup()

    const projectNavButton = await screen.findByRole('button', { name: 'Project Settings' })
    await user.click(projectNavButton)
    expect(await screen.findByText('Branch Prefix')).toBeInTheDocument()

    const actionNavButton = await screen.findByRole('button', { name: 'Action Buttons' })
    await user.click(actionNavButton)
    expect(await screen.findByRole('button', { name: 'Reset to Defaults' })).toBeInTheDocument()

    const runNavButton = await screen.findByRole('button', { name: 'Run & Environment' })
    await user.click(runNavButton)

    expect(await screen.findByText('Run Script')).toBeInTheDocument()

    invokeMock.mockImplementation(baseInvokeImplementation)
  })

  it('hides project settings navigation when no project is active', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    useSettingsMock.mockReturnValue(settingsValue)

    renderWithProviders(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await screen.findByRole('button', { name: 'Appearance' })
    expect(screen.queryByRole('button', { name: 'Project Settings' })).not.toBeInTheDocument()
    expect(screen.queryByText('Project')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archives' })).not.toBeInTheDocument()
  })

  it('prompts before saving a changed setup script and blocks on cancel', async () => {
    const saveAllSettings = vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] })
    useSettingsMock.mockReturnValue({
      ...createDefaultUseSettingsValue(),
      saveAllSettings,
      loadProjectSettings: vi.fn().mockResolvedValue({
        setupScript: '#!/bin/bash\necho original',
        branchPrefix: 'schaltwerk',
        worktreeBaseDirectory: '',
        environmentVariables: [],
      }),
    })

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) return Promise.resolve('/tmp/project')
      return baseInvokeImplementation(command, args)
    })

    const confirmSpy = (window.confirm as unknown as Mock).mockReturnValue(false)

    renderWithProviders(<SettingsModal open={true} onClose={() => {}} />)
    const user = userEvent.setup()

    const projectNavButton = await screen.findByRole('button', { name: 'Project Settings' })
    await user.click(projectNavButton)
    await user.click(await screen.findByRole('button', { name: 'Run & Environment' }))

    // Use the mocked textarea instead of CodeMirror's .cm-content
    const setupScriptTextarea = await screen.findByTestId('setup-script-textarea')
    await user.clear(setupScriptTextarea)
    await user.type(setupScriptTextarea, '#!/bin/bash\necho changed')

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(saveAllSettings).not.toHaveBeenCalled()
    })

    confirmSpy.mockRestore()
  })

  it('saves when setup script changes and user confirms', async () => {
    const saveAllSettings = vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] })
    useSettingsMock.mockReturnValue({
      ...createDefaultUseSettingsValue(),
      saveAllSettings,
      loadProjectSettings: vi.fn().mockResolvedValue({
        setupScript: '#!/bin/bash\necho original',
        branchPrefix: 'schaltwerk',
        worktreeBaseDirectory: '',
        environmentVariables: [],
      }),
    })

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) return Promise.resolve('/tmp/project')
      return baseInvokeImplementation(command, args)
    })

    const confirmSpy = (window.confirm as unknown as Mock).mockReturnValue(true)

    renderWithProviders(<SettingsModal open={true} onClose={() => {}} />)
    const user = userEvent.setup()

    const projectNavButton = await screen.findByRole('button', { name: 'Project Settings' })
    await user.click(projectNavButton)
    await user.click(await screen.findByRole('button', { name: 'Run & Environment' }))

    // Use the mocked textarea instead of CodeMirror's .cm-content
    const setupScriptTextarea = await screen.findByTestId('setup-script-textarea')
    await user.clear(setupScriptTextarea)
    await user.type(setupScriptTextarea, '#!/bin/bash\necho changed')

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(saveAllSettings).toHaveBeenCalledTimes(1)
    })

    confirmSpy.mockRestore()
  })

  it('loads and saves the project spec clarification agent preference', async () => {
    const saveAllSettings = vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] })
    useSettingsMock.mockReturnValue({
      ...createDefaultUseSettingsValue(),
      saveAllSettings,
    })

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) return Promise.resolve('/tmp/project')
      if (command === TauriCommands.SchaltwerkCoreGetSpecClarificationAgentType) return Promise.resolve('codex')
      if (command === TauriCommands.SchaltwerkCoreSetSpecClarificationAgentType) return Promise.resolve(undefined)
      return baseInvokeImplementation(command, args)
    })

    renderWithProviders(<SettingsModal open={true} onClose={() => {}} />)
    const user = userEvent.setup()

    const projectNavButton = await screen.findByRole('button', { name: 'Project Settings' })
    await user.click(projectNavButton)

    const selector = await screen.findByTestId('spec-clarification-agent-selector')
    expect(selector).toHaveValue('codex')

    await user.selectOptions(selector, 'gemini')
    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveAllSettings).toHaveBeenCalledTimes(1)
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSpecClarificationAgentType, { agentType: 'gemini' })
    })
  })
})

describe('SettingsModal AI Generation custom prompts', () => {
  const defaultPrompts = {
    name_prompt: 'Default name prompt with {task} placeholder',
    commit_prompt: 'Default commit prompt with {commits} and {files}',
    consolidation_prompt: 'Default consolidation prompt with {sessionList}',
    review_pr_prompt: 'Default review prompt with {{pr.title}} and {{pr.url}}',
    plan_issue_prompt: 'Default issue plan prompt with {{issue.title}} and {{issue.description}}',
    issue_prompt: 'Default issue session prompt with {title} and {comments}',
    pr_prompt: 'Default PR session prompt with {title}, {branch}, and {comments}',
    autonomy_prompt_template: '## Agent Instructions\n\nDefault autonomy template',
  }

  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetDefaultGenerationPrompts) {
        return defaultPrompts
      }
      if (command === TauriCommands.GetGenerationSettings) {
        return {
          agent: null,
          cli_args: null,
          name_prompt: null,
          commit_prompt: null,
          consolidation_prompt: null,
          review_pr_prompt: null,
          plan_issue_prompt: null,
          issue_prompt: null,
          pr_prompt: null,
          autonomy_prompt_template: null,
        }
      }
      return baseInvokeImplementation(command, args)
    })
    requestDockBounceMock.mockReset()
  })

  it('pre-fills textareas with default prompts when no custom values are saved', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const customPromptsButton = await screen.findByText('Custom Prompts')
    await user.click(customPromptsButton)

    const textareas = await screen.findAllByRole('textbox')
    const promptValues = new Set(Object.values(defaultPrompts))
    const promptTextareas = textareas.filter(el => promptValues.has((el as HTMLTextAreaElement).value))

    expect(promptTextareas).toHaveLength(7)
  })

  it('shows "Using default" indicator when prompts match defaults', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const customPromptsButton = await screen.findByText('Custom Prompts')
    await user.click(customPromptsButton)

    const indicators = await screen.findAllByText('Using default')
    expect(indicators.length).toBe(7)
  })

  it('shows "Customized" and reset button when custom prompt is saved', async () => {
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetDefaultGenerationPrompts) {
        return defaultPrompts
      }
      if (command === TauriCommands.GetGenerationSettings) {
        return {
          agent: null,
          cli_args: null,
          name_prompt: 'My custom name prompt',
          commit_prompt: null,
          consolidation_prompt: null,
          review_pr_prompt: null,
          plan_issue_prompt: null,
          issue_prompt: null,
          pr_prompt: null,
          autonomy_prompt_template: null,
        }
      }
      return baseInvokeImplementation(command, args)
    })

    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )

    await waitFor(() => {
      expect(screen.getByText('Customized')).toBeInTheDocument()
    })

    expect(screen.getByText('Reset to default')).toBeInTheDocument()
  })

  it('saves null when textarea content matches default prompt', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const customPromptsButton = await screen.findByText('Custom Prompts')
    await user.click(customPromptsButton)

    const textareas = await screen.findAllByRole('textbox')
    const nameTextarea = textareas.find(el => (el as HTMLTextAreaElement).value === defaultPrompts.name_prompt) as HTMLTextAreaElement

    await user.click(nameTextarea)
    await user.tab()

    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === TauriCommands.SetGenerationSettings
      )
      if (saveCall) {
        const settings = (saveCall[1] as { settings: { name_prompt: string | null } }).settings
        expect(settings.name_prompt).toBeNull()
      }
    })
  })

  it('resets prompt to default when reset button is clicked', async () => {
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetDefaultGenerationPrompts) {
        return defaultPrompts
      }
      if (command === TauriCommands.GetGenerationSettings) {
        return {
          agent: null,
          cli_args: null,
          name_prompt: 'Custom prompt',
          commit_prompt: null,
          consolidation_prompt: null,
          review_pr_prompt: null,
          plan_issue_prompt: null,
          issue_prompt: null,
          pr_prompt: null,
          autonomy_prompt_template: null,
        }
      }
      return baseInvokeImplementation(command, args)
    })

    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const resetButton = await screen.findByText('Reset to default')
    await user.click(resetButton)

    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === TauriCommands.SetGenerationSettings
      )
      if (saveCall) {
        const settings = (saveCall[1] as { settings: { name_prompt: string | null } }).settings
        expect(settings.name_prompt).toBeNull()
      }
    })
  })

  it('shows a warning when a required template variable is removed', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const customPromptsButton = await screen.findByText('Custom Prompts')
    await user.click(customPromptsButton)

    const textareas = await screen.findAllByRole('textbox')
    const consolidationTextarea = textareas.find(
      el => (el as HTMLTextAreaElement).value === defaultPrompts.consolidation_prompt
    ) as HTMLTextAreaElement

    await user.clear(consolidationTextarea)
    await user.type(consolidationTextarea, 'Custom consolidation prompt')

    const warnings = await screen.findAllByText(/Missing required variable/i)
    expect(warnings.some(node => node.textContent?.includes('{sessionList}'))).toBe(true)
  })

  it('resets the autonomy template to the default value', async () => {
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetDefaultGenerationPrompts) {
        return defaultPrompts
      }
      if (command === TauriCommands.GetGenerationSettings) {
        return {
          agent: null,
          cli_args: null,
          name_prompt: null,
          commit_prompt: null,
          consolidation_prompt: null,
          review_pr_prompt: null,
          plan_issue_prompt: null,
          issue_prompt: null,
          pr_prompt: null,
          autonomy_prompt_template: 'Custom autonomy template',
        }
      }
      return baseInvokeImplementation(command, args)
    })

    renderWithProviders(
      <SettingsModal open={true} initialTab="agentConfiguration" onClose={() => {}} />
    )
    const user = userEvent.setup()

    expect(await screen.findByDisplayValue('Custom autonomy template')).toBeInTheDocument()

    const resetButton = await screen.findByText('Reset to default')
    await user.click(resetButton)

    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === TauriCommands.SetGenerationSettings
      )
      if (saveCall) {
        const settings = (saveCall[1] as { settings: { autonomy_prompt_template: string | null } }).settings
        expect(settings.autonomy_prompt_template).toBeNull()
      }
    })
  })

  it('associates custom prompt labels with their editors', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="generation" onClose={() => {}} />
    )
    const user = userEvent.setup()

    const customPromptsButton = await screen.findByText('Custom Prompts')
    await user.click(customPromptsButton)

    expect(await screen.findByLabelText('Name Generation Prompt')).toBeInTheDocument()
    expect(screen.getByLabelText('Session Consolidation Prompt')).toBeInTheDocument()
    expect(screen.getByLabelText('Commit Message Prompt')).toBeInTheDocument()
  })
})

describe('SettingsModal shared control wiring', () => {
  it('renders enabled-agent checkboxes from persisted settings', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadEnabledAgents.mockResolvedValue({
      ...createDefaultEnabledAgents(),
      gemini: false,
    })
    useSettingsMock.mockReturnValue(settingsValue)

    renderWithProviders(
      <SettingsModal open={true} initialTab="agentConfiguration" onClose={() => {}} />
    )

    expect(await screen.findByText('Enabled Agents')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Claude' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Gemini' })).not.toBeChecked()
  })

  it('shows only enabled agent tabs in environment settings', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadEnabledAgents.mockResolvedValue({
      claude: true,
      copilot: false,
      opencode: false,
      gemini: false,
      codex: true,
      droid: false,
      qwen: false,
      amp: false,
      kilocode: false,
      terminal: true,
    })
    useSettingsMock.mockReturnValue(settingsValue)

    renderWithProviders(
      <SettingsModal open={true} initialTab="environment" onClose={() => {}} />
    )

    expect(await screen.findByRole('button', { name: 'Claude' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Qwen' })).not.toBeInTheDocument()
  })

  it('associates environment labels with their inputs', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="environment" onClose={() => {}} />
    )

    expect(await screen.findByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByLabelText('Reasoning Effort')).toBeInTheDocument()
    expect(screen.getByLabelText('CLI Arguments')).toBeInTheDocument()
  })

  it('associates terminal labels with their inputs', async () => {
    renderWithProviders(
      <SettingsModal open={true} initialTab="terminal" onClose={() => {}} />
    )

    expect(await screen.findByLabelText('Shell Path')).toBeInTheDocument()
    expect(screen.getByLabelText('Shell Arguments')).toBeInTheDocument()
    expect(screen.getByLabelText('Command Prefix')).toBeInTheDocument()
  })
})
