import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'fs'

const serverState: { instance: FakeServer | null } = { instance: null }

class FakeServer {
  handlers = new Map<unknown, (request?: any) => Promise<any>>()

  constructor() {
    serverState.instance = this
  }

  setRequestHandler(schema: unknown, handler: (request: any) => Promise<any>) {
    this.handlers.set(schema, handler)
  }

  async connect() {}
}

mock.module('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: FakeServer,
  __serverState: serverState,
}))

mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))

const listToolsSchema = Symbol('ListTools')
const callToolSchema = Symbol('CallTool')
const listResourcesSchema = Symbol('ListResources')
const readResourceSchema = Symbol('ReadResource')

class FakeMcpError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

mock.module('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: listToolsSchema,
  CallToolRequestSchema: callToolSchema,
  ListResourcesRequestSchema: listResourcesSchema,
  ReadResourceRequestSchema: readResourceSchema,
  ErrorCode: {
    InternalError: 'INTERNAL_ERROR',
    MethodNotFound: 'METHOD_NOT_FOUND',
    InvalidParams: 'INVALID_PARAMS',
    InvalidRequest: 'INVALID_REQUEST',
  },
  McpError: FakeMcpError,
}))

const getServer = () => {
  const server = serverState.instance
  if (!server) {
    throw new Error('Server not initialized')
  }
  return server
}

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
  const server = getServer()
  const handler = server.handlers.get(CallToolRequestSchema)!
  return handler({ params: { name, arguments: args } })
}

const listResources = async () => {
  const { ListResourcesRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
  const server = getServer()
  const handler = server.handlers.get(ListResourcesRequestSchema)!
  return handler()
}

const readResource = async (uri: string) => {
  const { ReadResourceRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
  const server = getServer()
  const handler = server.handlers.get(ReadResourceRequestSchema)!
  return handler({ params: { uri } })
}

const mockProjectPath = '/tmp/mock-project-tool-handlers'

const cancelSessionMock = mock(() => Promise.resolve())
const convertToSpecMock = mock(() => Promise.resolve())
const createEpicMock = mock(() => Promise.resolve({ id: 'epic-1', name: 'Test Epic', color: '#FF0000' }))
const deleteDraftSessionMock = mock(() => Promise.resolve())
const executeProjectRunScriptMock = mock(() =>
  Promise.resolve({ success: true, command: 'npm test', exit_code: 0, stdout: 'ok', stderr: '' })
)
const getCurrentTasksMock = mock(() =>
  Promise.resolve([
    { name: 'task1', display_name: 'Task 1', status: 'active', session_state: 'Running', branch: 'lucode/task1', ready_to_merge: false, original_agent_type: 'claude' },
    { name: 'task2', display_name: 'Task 2', status: 'spec', session_state: 'Spec', branch: 'lucode/task2', ready_to_merge: false, draft_content: 'plan content' }
  ])
)
const getProjectRunScriptMock = mock(() =>
  Promise.resolve({ has_run_script: true, command: 'npm test', working_directory: '/project' })
)
const getSessionMock = mock(() =>
  Promise.resolve({ id: 'sess', name: 'sess', branch: 'lucode/sess', status: 'active' })
)
const getWorktreeBaseDirectoryMock = mock(() =>
  Promise.resolve({ worktree_base_directory: '/custom/wt', has_custom_directory: true })
)
const listDraftSessionsMock = mock(() =>
  Promise.resolve([
    { name: 'draft1', display_name: 'Draft 1', draft_content: 'some content', created_at: Date.now(), updated_at: Date.now(), parent_branch: 'main' }
  ])
)
const listEpicsMock = mock(() =>
  Promise.resolve([{ id: 'e1', name: 'Epic A', color: '#00FF00' }])
)
const listSessionsByStateMock = mock(() => Promise.resolve([]))
const markSessionReviewedMock = mock(() => Promise.resolve())
const promoteSessionMock = mock(() =>
  Promise.resolve({
    sessionName: 'feature_v3',
    siblingsCancelled: ['feature_v1', 'feature_v2'],
    reason: 'Best coverage',
    failures: [],
  })
)
const linkSessionToPrMock = mock(() =>
  Promise.resolve({ session: 'my-sess', pr_number: 42, pr_url: 'https://github.com/owner/repo/pull/42', linked: true })
)
const unlinkSessionFromPrMock = mock(() =>
  Promise.resolve({ session: 'my-sess', pr_number: null, pr_url: null, linked: false })
)
const sendFollowUpMessageMock = mock(() => Promise.resolve())
const setWorktreeBaseDirectoryMock = mock(() =>
  Promise.resolve({ worktree_base_directory: '/new/path', has_custom_directory: true })
)
const getPrFeedbackMock = mock(() =>
  Promise.resolve({
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'CHANGES_REQUESTED',
    latestReviews: [
      { author: 'reviewer', state: 'CHANGES_REQUESTED', submittedAt: '2026-03-30T10:00:00Z' }
    ],
    statusChecks: [
      { name: 'ci / unit', status: 'COMPLETED', conclusion: 'FAILURE', url: 'https://example.com/check/1' },
      { name: 'buildkite', status: 'PENDING', conclusion: null, url: 'https://example.com/check/2' }
    ],
    unresolvedThreads: [
      {
        id: 'thread-1',
        path: 'src/lib.rs',
        line: 42,
        comments: [
          {
            id: 'comment-1',
            body: 'Please rename this.',
            authorLogin: 'reviewer',
            createdAt: '2026-03-30T10:00:00Z',
            url: 'https://example.com/comment/1'
          }
        ]
      }
    ],
    resolvedThreadCount: 3,
  })
)

let bridgeModule: typeof import('../src/lucode-bridge')
const originalMethods: Record<string, Function> = {}
let createdProjectDir = false

describe('MCP tool handler logic', () => {
  beforeAll(async () => {
    if (!fs.existsSync(mockProjectPath)) {
      fs.mkdirSync(mockProjectPath, { recursive: true })
      createdProjectDir = true
    }
    process.env.LUCODE_PROJECT_PATH = mockProjectPath
    bridgeModule = await import('../src/lucode-bridge')

    const proto = bridgeModule.LucodeBridge.prototype

    const methodMocks: Record<string, Function> = {
      cancelSession: cancelSessionMock,
      convertToSpec: convertToSpecMock,
      createEpic: createEpicMock,
      deleteDraftSession: deleteDraftSessionMock,
      executeProjectRunScript: executeProjectRunScriptMock,
      getCurrentTasks: getCurrentTasksMock,
      getProjectRunScript: getProjectRunScriptMock,
      getSession: getSessionMock,
      getWorktreeBaseDirectory: getWorktreeBaseDirectoryMock,
      linkSessionToPr: linkSessionToPrMock,
      listDraftSessions: listDraftSessionsMock,
      listEpics: listEpicsMock,
      listSessionsByState: listSessionsByStateMock,
      markSessionReviewed: markSessionReviewedMock,
      promoteSession: promoteSessionMock,
      sendFollowUpMessage: sendFollowUpMessageMock,
      setWorktreeBaseDirectory: setWorktreeBaseDirectoryMock,
      unlinkSessionFromPr: unlinkSessionFromPrMock,
      getPrFeedback: getPrFeedbackMock,
    }

    for (const [name, mockFn] of Object.entries(methodMocks)) {
      originalMethods[name] = (proto as any)[name]
      ;(proto as any)[name] = (...args: any[]) => (mockFn as Function)(...args)
    }

    await import(`../src/lucode-mcp-server?tool-handlers=${Date.now()}`)
  })

  beforeEach(() => {
    cancelSessionMock.mockClear()
    convertToSpecMock.mockClear()
    createEpicMock.mockClear()
    deleteDraftSessionMock.mockClear()
    executeProjectRunScriptMock.mockClear()
    getCurrentTasksMock.mockClear()
    getProjectRunScriptMock.mockClear()
    getSessionMock.mockClear()
    getWorktreeBaseDirectoryMock.mockClear()
    linkSessionToPrMock.mockClear()
    listDraftSessionsMock.mockClear()
    listEpicsMock.mockClear()
    listSessionsByStateMock.mockClear()
    markSessionReviewedMock.mockClear()
    promoteSessionMock.mockClear()
    sendFollowUpMessageMock.mockClear()
    setWorktreeBaseDirectoryMock.mockClear()
    unlinkSessionFromPrMock.mockClear()
    getPrFeedbackMock.mockClear()
  })

  afterAll(() => {
    delete process.env.LUCODE_PROJECT_PATH
    if (bridgeModule) {
      const proto = bridgeModule.LucodeBridge.prototype
      for (const [name, original] of Object.entries(originalMethods)) {
        ;(proto as any)[name] = original
      }
    }
    if (createdProjectDir && fs.existsSync(mockProjectPath)) {
      fs.rmSync(mockProjectPath, { recursive: true, force: true })
    }
  })

  describe('lucode_cancel', () => {
    it('calls cancelSession with session_name and force', async () => {
      const result = await callTool('lucode_cancel', { session_name: 'my-sess', force: true })

      expect(cancelSessionMock).toHaveBeenCalledTimes(1)
      expect(result.content).toBeDefined()
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('my-sess')
      expect(text?.text).toContain('cancelled')
    })

    it('propagates error from bridge', async () => {
      cancelSessionMock.mockRejectedValueOnce(new Error('SAFETY CHECK FAILED'))

      await expect(callTool('lucode_cancel', { session_name: 'dirty' })).rejects.toThrow('SAFETY CHECK FAILED')
    })
  })

  describe('lucode_convert_to_spec', () => {
    it('calls convertToSpec and returns structured response', async () => {
      const result = await callTool('lucode_convert_to_spec', { session_name: 'running-sess' })

      expect(convertToSpecMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('running-sess')
      expect(parsed.converted).toBe(true)
    })
  })

  describe('lucode_create_epic', () => {
    it('creates epic and returns structured response', async () => {
      const result = await callTool('lucode_create_epic', { name: 'Test Epic', color: '#FF0000' })

      expect(createEpicMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.epic.name).toBe('Test Epic')
      expect(parsed.epic.id).toBe('epic-1')
    })

    it('rejects empty name', async () => {
      await expect(callTool('lucode_create_epic', { name: '  ' })).rejects.toThrow("'name' is required")
    })

    it('rejects missing name', async () => {
      await expect(callTool('lucode_create_epic', {})).rejects.toThrow("'name' is required")
    })
  })

  describe('lucode_draft_delete', () => {
    it('deletes draft and returns structured response', async () => {
      const result = await callTool('lucode_draft_delete', { session_name: 'old-draft' })

      expect(deleteDraftSessionMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('old-draft')
      expect(parsed.deleted).toBe(true)
    })
  })

  describe('lucode_run_script', () => {
    it('executes run script and returns result', async () => {
      const result = await callTool('lucode_run_script', {})

      expect(executeProjectRunScriptMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.success).toBe(true)
      expect(parsed.exit_code).toBe(0)
    })

    it('reports failure in summary', async () => {
      executeProjectRunScriptMock.mockResolvedValueOnce({
        success: false,
        command: 'npm test',
        exit_code: 1,
        stdout: '',
        stderr: 'Error occurred'
      })

      const result = await callTool('lucode_run_script', {})
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('failed')
    })
  })

  describe('lucode_get_current_tasks', () => {
    it('returns tasks with default fields', async () => {
      const result = await callTool('lucode_get_current_tasks', {})

      expect(getCurrentTasksMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.tasks).toBeDefined()
      expect(parsed.tasks.length).toBe(2)
    })

    it('filters by status_filter=spec', async () => {
      const result = await callTool('lucode_get_current_tasks', { status_filter: 'spec' })

      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      const specTasks = parsed.tasks.filter((t: any) => t.status === 'spec')
      expect(specTasks.length).toBe(1)
    })

    it('respects content_preview_length', async () => {
      getCurrentTasksMock.mockResolvedValueOnce([
        { name: 'long', status: 'spec', session_state: 'Spec', branch: 'b', ready_to_merge: false, initial_prompt: 'A'.repeat(200), draft_content: 'B'.repeat(200) }
      ])

      const result = await callTool('lucode_get_current_tasks', {
        fields: ['all'],
        content_preview_length: 10
      })

      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.tasks[0].initial_prompt.length).toBeLessThanOrEqual(14)
      expect(parsed.tasks[0].draft_content.length).toBeLessThanOrEqual(14)
    })
  })

  describe('lucode_list_epics', () => {
    it('returns epic list', async () => {
      const result = await callTool('lucode_list_epics', {})

      expect(listEpicsMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.epics).toHaveLength(1)
      expect(parsed.epics[0].name).toBe('Epic A')
    })

    it('returns summary for empty epics', async () => {
      listEpicsMock.mockResolvedValueOnce([])

      const result = await callTool('lucode_list_epics', {})
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('No epics found')
    })
  })

  describe('lucode_draft_list', () => {
    it('returns draft sessions', async () => {
      const result = await callTool('lucode_draft_list', {})

      expect(listDraftSessionsMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.specs).toHaveLength(1)
      expect(parsed.specs[0].name).toBe('draft1')
    })

    it('returns no specs message when empty', async () => {
      listDraftSessionsMock.mockResolvedValueOnce([])

      const result = await callTool('lucode_draft_list', {})
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('No spec sessions found')
    })
  })

  describe('lucode_list with filters', () => {
    it('passes filter to listSessionsByState', async () => {
      listSessionsByStateMock.mockResolvedValueOnce([])

      await callTool('lucode_list', { filter: 'reviewed' })

      expect(listSessionsByStateMock).toHaveBeenCalledTimes(1)
    })

    it('shows no sessions message when empty', async () => {
      listSessionsByStateMock.mockResolvedValueOnce([])

      const result = await callTool('lucode_list', { filter: 'all' })
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('No sessions found')
    })
  })

  describe('lucode_send_message', () => {
    it('sends message and returns confirmation', async () => {
      const result = await callTool('lucode_send_message', {
        session_name: 'my-sess',
        message: 'hello agent'
      })

      expect(sendFollowUpMessageMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('my-sess')
      expect(parsed.status).toBe('sent')
      expect(parsed.message).toBe('hello agent')
    })
  })

  describe('lucode_mark_session_reviewed', () => {
    it('marks session reviewed and returns structured response', async () => {
      const result = await callTool('lucode_mark_session_reviewed', { session_name: 'my-sess' })

      expect(markSessionReviewedMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('my-sess')
      expect(parsed.reviewed).toBe(true)
    })
  })

  describe('lucode_promote', () => {
    it('promotes a session and returns structured response', async () => {
      const result = await callTool('lucode_promote', {
        session_name: 'feature_v3',
        reason: 'Best coverage',
      })

      expect(promoteSessionMock).toHaveBeenCalledTimes(1)
      expect(promoteSessionMock).toHaveBeenCalledWith('feature_v3', 'Best coverage', undefined)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('feature_v3')
      expect(parsed.siblings_cancelled).toEqual(['feature_v1', 'feature_v2'])
      expect(parsed.reason).toBe('Best coverage')
      expect(parsed.failures).toEqual([])
    })

    it('rejects missing reason', async () => {
      await expect(callTool('lucode_promote', { session_name: 'feature_v3' })).rejects.toThrow('reason is required')
    })
  })

  describe('lucode_link_pr', () => {
    it('links a PR when both PR fields are provided', async () => {
      const result = await callTool('lucode_link_pr', {
        session_name: 'my-sess',
        pr_number: 42,
        pr_url: 'https://github.com/owner/repo/pull/42'
      })

      expect(linkSessionToPrMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('my-sess')
      expect(parsed.pr_number).toBe(42)
      expect(parsed.linked).toBe(true)
    })

    it('unlinks a PR when both PR fields are omitted', async () => {
      const result = await callTool('lucode_link_pr', { session_name: 'my-sess' })

      expect(unlinkSessionFromPrMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.session).toBe('my-sess')
      expect(parsed.pr_number).toBeNull()
      expect(parsed.linked).toBe(false)
    })

    it('rejects partial PR payloads', async () => {
      await expect(
        callTool('lucode_link_pr', { session_name: 'my-sess', pr_number: 42 })
      ).rejects.toThrow('Provide both pr_number and pr_url to link a PR, or omit both to unlink.')
    })
  })

  describe('lucode_get_worktree_base_directory', () => {
    it('returns worktree directory info', async () => {
      const result = await callTool('lucode_get_worktree_base_directory', {})

      expect(getWorktreeBaseDirectoryMock).toHaveBeenCalledTimes(1)
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('/custom/wt')
    })
  })

  describe('lucode_set_worktree_base_directory', () => {
    it('sets directory and returns response', async () => {
      const result = await callTool('lucode_set_worktree_base_directory', {
        worktree_base_directory: '/new/path'
      })

      expect(setWorktreeBaseDirectoryMock).toHaveBeenCalledTimes(1)
      const text = result.content.find((c: any) => c.type === 'text' && !c.mimeType)
      expect(text?.text).toContain('/new/path')
    })

    it('rejects null worktree_base_directory', async () => {
      await expect(
        callTool('lucode_set_worktree_base_directory', {})
      ).rejects.toThrow("'worktree_base_directory' is required")
    })
  })

  describe('lucode_merge_session parameter validation', () => {
    it('rejects missing session_name', async () => {
      await expect(callTool('lucode_merge_session', {})).rejects.toThrow('session_name is required')
    })

    it('rejects squash merge without commit_message', async () => {
      await expect(
        callTool('lucode_merge_session', { session_name: 'sess', mode: 'squash' })
      ).rejects.toThrow('commit_message is required')
    })
  })

  describe('lucode_create_pr parameter validation', () => {
    it('rejects missing session_name', async () => {
      await expect(
        callTool('lucode_create_pr', { pr_title: 'title' })
      ).rejects.toThrow('session_name is required')
    })

    it('rejects missing pr_title', async () => {
      await expect(
        callTool('lucode_create_pr', { session_name: 'sess' })
      ).rejects.toThrow('pr_title is required')
    })
  })

  describe('lucode_prepare_merge parameter validation', () => {
    it('rejects missing session_name', async () => {
      await expect(callTool('lucode_prepare_merge', {})).rejects.toThrow('session_name is required')
    })
  })

  describe('lucode_get_pr_feedback', () => {
    it('returns structured PR feedback', async () => {
      const result = await callTool('lucode_get_pr_feedback', { session_name: 'my-sess' })

      expect(getPrFeedbackMock).toHaveBeenCalledTimes(1)
      const json = result.content.find((c: any) => c.mimeType === 'application/json')
      const parsed = JSON.parse(json.text)
      expect(parsed.state).toBe('OPEN')
      expect(parsed.unresolved_threads).toHaveLength(1)
      expect(parsed.status_checks).toHaveLength(2)
      expect(parsed.resolved_thread_count).toBe(3)
    })

    it('rejects missing session_name', async () => {
      await expect(callTool('lucode_get_pr_feedback', {})).rejects.toThrow("'session_name' is required")
    })
  })

  describe('skill resources', () => {
    it('lists Lucode skill resources for workflow discovery', async () => {
      const result = await listResources()

      expect(result.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ uri: 'lucode://skills' }),
        expect.objectContaining({ uri: 'lucode://skills/consolidate' }),
      ]))
    })

    it('reads the Lucode skill registry resource', async () => {
      const result = await readResource('lucode://skills')
      const json = result.contents.find((content: any) => content.mimeType === 'application/json')

      expect(json).toBeDefined()
      expect(JSON.parse(json.text)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'consolidate',
          native_entrypoints: expect.objectContaining({
            shared: '.agents/skills/consolidate/SKILL.md',
            codex: '.codex/skills/consolidate/SKILL.md',
            opencode: '.opencode/commands/consolidate.md',
          }),
        }),
      ]))
    })

    it('reads the consolidate skill markdown resource', async () => {
      const result = await readResource('lucode://skills/consolidate')
      const markdown = result.contents.find((content: any) => content.mimeType === 'text/markdown')

      expect(markdown).toBeDefined()
      expect(markdown.text).toContain('lucode_promote')
      expect(markdown.text).not.toContain('/lucode:consolidate')
    })

    it('rejects unknown Lucode workflow resources as invalid requests', async () => {
      await expect(readResource('lucode://skills/missing-workflow')).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      })
    })
  })

  describe('unknown tool', () => {
    it('throws MethodNotFound for unknown tool', async () => {
      await expect(callTool('lucode_nonexistent', {})).rejects.toThrow('Unknown tool')
    })
  })
})
