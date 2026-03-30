import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import path from 'path'

const fetchMock = mock(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '{}',
    json: async () => ({})
  })
)

mock.module('node-fetch', () => ({
  default: fetchMock
}))

const execSyncMock = mock(() => '')

mock.module('child_process', () => ({
  execSync: execSyncMock
}))

const { LucodeBridge } = await import('../src/lucode-bridge')

const createResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => JSON.stringify(payload),
  json: async () => payload
})

const createErrorResponse = (status: number, statusText: string, body?: string) => ({
  ok: false,
  status,
  statusText,
  text: async () => body ?? JSON.stringify({ error: statusText }),
  json: async () => ({ error: statusText })
})

describe('LucodeBridge untested methods', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>
  let consoleWarnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    execSyncMock.mockReset()
    process.env.LUCODE_PROJECT_PATH = path.resolve(__dirname, '..', '..')
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    delete process.env.LUCODE_PROJECT_PATH
  })

  describe('getSession', () => {
    it('fetches a session by name', async () => {
      const session = {
        id: 'my-session',
        name: 'my-session',
        branch: 'lucode/my-session',
        parent_branch: 'main',
        worktree_path: '/tmp/wt',
        status: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
        ready_to_merge: false,
        pending_name_generation: false,
        was_auto_generated: false
      }
      fetchMock.mockResolvedValue(createResponse(session))

      const bridge = new LucodeBridge()
      const result = await bridge.getSession('my-session')

      expect(result).toEqual(session)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions/my-session')
      expect(init?.method).toBe('GET')
    })

    it('returns undefined for 404', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
        json: async () => ({})
      })

      const bridge = new LucodeBridge()
      const result = await bridge.getSession('nonexistent')

      expect(result).toBeUndefined()
    })

    it('returns undefined on error', async () => {
      fetchMock.mockRejectedValue(new Error('network error'))

      const bridge = new LucodeBridge()
      const result = await bridge.getSession('broken')

      expect(result).toBeUndefined()
    })

    it('encodes session name in URL', async () => {
      fetchMock.mockResolvedValue(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.getSession('session with spaces')

      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions/session%20with%20spaces')
    })
  })

  describe('getPrFeedback', () => {
    it('fetches PR feedback for a session', async () => {
      const payload = {
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'CHANGES_REQUESTED',
        latestReviews: [],
        statusChecks: [
          { name: 'ci / unit', status: 'COMPLETED', conclusion: 'FAILURE', url: 'https://example.com/check/1' }
        ],
        unresolvedThreads: [
          {
            id: 'thread-1',
            path: 'src/lib.rs',
            line: 10,
            comments: [{ id: 'comment-1', body: 'Fix this', authorLogin: 'reviewer', createdAt: '2026-03-30T10:00:00Z', url: 'https://example.com/comment/1' }]
          }
        ],
        resolvedThreadCount: 1
      }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.getPrFeedback('my-session')

      expect(result.state).toBe('OPEN')
      expect(result.unresolvedThreads).toHaveLength(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions/my-session/pr-feedback')
      expect(init?.method).toBe('GET')
    })

    it('propagates backend errors', async () => {
      fetchMock.mockResolvedValue(
        createErrorResponse(400, 'Bad Request', JSON.stringify({ error: 'Session has no linked pull request' }))
      )

      const bridge = new LucodeBridge()
      await expect(bridge.getPrFeedback('missing-pr')).rejects.toThrow('Session has no linked pull request')
    })
  })

  describe('listEpics', () => {
    it('returns list of epics', async () => {
      const epics = [
        { id: 'e1', name: 'Epic One', color: '#FF0000' },
        { id: 'e2', name: 'Epic Two', color: null }
      ]
      fetchMock.mockResolvedValue(createResponse(epics))

      const bridge = new LucodeBridge()
      const result = await bridge.listEpics()

      expect(result).toEqual(epics)
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/epics')
    })

    it('returns empty array when response is null', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      const result = await bridge.listEpics()

      expect(result).toEqual([])
    })
  })

  describe('createEpic', () => {
    it('creates an epic with name and color', async () => {
      const epic = { id: 'e1', name: 'My Epic', color: '#00FF00' }
      fetchMock.mockResolvedValue(createResponse(epic))

      const bridge = new LucodeBridge()
      const result = await bridge.createEpic('My Epic', '#00FF00')

      expect(result).toEqual(epic)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/epics')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'My Epic', color: '#00FF00' })
    })

    it('creates an epic without color', async () => {
      const epic = { id: 'e2', name: 'No Color Epic', color: null }
      fetchMock.mockResolvedValue(createResponse(epic))

      const bridge = new LucodeBridge()
      const result = await bridge.createEpic('No Color Epic')

      const [, init] = fetchMock.mock.calls[0]
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'No Color Epic', color: undefined })
      expect(result.name).toBe('No Color Epic')
    })

    it('throws when response is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      await expect(bridge.createEpic('test')).rejects.toThrow('Create epic response payload missing')
    })
  })

  describe('getWorktreeBaseDirectory', () => {
    it('fetches worktree base directory', async () => {
      const payload = { worktree_base_directory: '/custom/path', has_custom_directory: true }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.getWorktreeBaseDirectory()

      expect(result.worktree_base_directory).toBe('/custom/path')
      expect(result.has_custom_directory).toBe(true)
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/project/worktree-base-directory')
    })

    it('throws when payload is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      await expect(bridge.getWorktreeBaseDirectory()).rejects.toThrow('Worktree base directory payload missing')
    })

    it('derives has_custom_directory from worktree_base_directory when not provided', async () => {
      const payload = { worktree_base_directory: '/some/path' }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.getWorktreeBaseDirectory()

      expect(result.has_custom_directory).toBe(true)
    })
  })

  describe('setWorktreeBaseDirectory', () => {
    it('sets worktree base directory', async () => {
      const payload = { worktree_base_directory: '/new/path', has_custom_directory: true }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.setWorktreeBaseDirectory('/new/path')

      expect(result.worktree_base_directory).toBe('/new/path')
      expect(result.has_custom_directory).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/project/worktree-base-directory')
      expect(init?.method).toBe('PUT')
      expect(JSON.parse(String(init?.body))).toEqual({ worktree_base_directory: '/new/path' })
    })

    it('clears directory with empty string', async () => {
      const payload = { worktree_base_directory: '', has_custom_directory: false }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.setWorktreeBaseDirectory('')

      expect(result.worktree_base_directory).toBe('')
      expect(result.has_custom_directory).toBe(false)
    })

    it('throws when response payload is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      await expect(bridge.setWorktreeBaseDirectory('/x')).rejects.toThrow('Set worktree base directory payload missing')
    })
  })

  describe('getProjectRunScript', () => {
    it('fetches project run script', async () => {
      const payload = { has_run_script: true, command: 'npm test', working_directory: '/project' }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.getProjectRunScript()

      expect(result.has_run_script).toBe(true)
      expect(result.command).toBe('npm test')
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/project/run-script')
    })

    it('throws when payload is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      await expect(bridge.getProjectRunScript()).rejects.toThrow('Project run script payload missing')
    })
  })

  describe('executeProjectRunScript', () => {
    it('executes run script and returns result', async () => {
      const payload = {
        success: true,
        command: 'npm test',
        exit_code: 0,
        stdout: 'All tests passed',
        stderr: ''
      }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.executeProjectRunScript()

      expect(result.success).toBe(true)
      expect(result.exit_code).toBe(0)
      expect(result.stdout).toBe('All tests passed')
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/project/run-script/execute')
      expect(init?.method).toBe('POST')
    })

    it('returns failure result', async () => {
      const payload = {
        success: false,
        command: 'npm test',
        exit_code: 1,
        stdout: '',
        stderr: 'Test failed'
      }
      fetchMock.mockResolvedValue(createResponse(payload))

      const bridge = new LucodeBridge()
      const result = await bridge.executeProjectRunScript()

      expect(result.success).toBe(false)
      expect(result.exit_code).toBe(1)
    })

    it('throws when payload is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        json: async () => null
      })

      const bridge = new LucodeBridge()
      await expect(bridge.executeProjectRunScript()).rejects.toThrow('Run script execution result missing')
    })
  })

  describe('sendFollowUpMessage', () => {
    it('sends follow-up message to existing session', async () => {
      const session = { id: 'sess', name: 'sess', branch: 'b', parent_branch: 'main', worktree_path: '/w', status: 'active', created_at: 0, updated_at: 0, ready_to_merge: false, pending_name_generation: false, was_auto_generated: false }
      fetchMock
        .mockResolvedValueOnce(createResponse(session))
        .mockResolvedValueOnce(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.sendFollowUpMessage('sess', 'hello')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [webhookUrl, webhookInit] = fetchMock.mock.calls[1]
      expect(String(webhookUrl)).toContain('/webhook/follow-up-message')
      expect(webhookInit?.method).toBe('POST')
      const body = JSON.parse(String(webhookInit?.body))
      expect(body.session_name).toBe('sess')
      expect(body.message).toBe('hello')
    })

    it('throws when session does not exist', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
        json: async () => ({})
      })

      const bridge = new LucodeBridge()
      await expect(bridge.sendFollowUpMessage('missing', 'hi')).rejects.toThrow("Session 'missing' not found")
    })
  })

  describe('cancelSession', () => {
    it('cancels session via API when no uncommitted changes', async () => {
      const session = { id: 'sess', name: 'sess', branch: 'lucode/sess', parent_branch: 'main', worktree_path: '/tmp/wt', repository_path: '/repo', status: 'active', created_at: 0, updated_at: 0, ready_to_merge: false, pending_name_generation: false, was_auto_generated: false }

      fetchMock
        .mockResolvedValueOnce(createResponse(session))
        .mockResolvedValueOnce(createResponse({}))

      execSyncMock
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')

      const bridge = new LucodeBridge()
      await bridge.cancelSession('sess')

      const deleteCall = fetchMock.mock.calls.find(call => {
        const [url] = call
        return String(url).includes('/api/sessions/sess') && (call[1] as Record<string, unknown>)?.method === 'DELETE'
      })
      expect(deleteCall).toBeDefined()
    })

    it('throws safety check when uncommitted changes exist and force is false', async () => {
      const session = { id: 'sess', name: 'sess', branch: 'lucode/sess', parent_branch: 'main', worktree_path: '/tmp/wt', repository_path: '/repo', status: 'active', created_at: 0, updated_at: 0, ready_to_merge: false, pending_name_generation: false, was_auto_generated: false }

      fetchMock.mockResolvedValue(createResponse(session))

      execSyncMock.mockReturnValue(' M file.txt\n?? new.txt\n')

      const bridge = new LucodeBridge()
      await expect(bridge.cancelSession('sess', false)).rejects.toThrow('SAFETY CHECK FAILED')
    })

    it('proceeds when force is true despite uncommitted changes', async () => {
      const session = { id: 'sess', name: 'sess', branch: 'lucode/sess', parent_branch: 'main', worktree_path: '/tmp/wt', repository_path: '/repo', status: 'active', created_at: 0, updated_at: 0, ready_to_merge: false, pending_name_generation: false, was_auto_generated: false }

      fetchMock
        .mockResolvedValueOnce(createResponse(session))
        .mockResolvedValueOnce(createResponse({}))

      execSyncMock.mockReturnValue(' M file.txt\n?? new.txt\n')

      const bridge = new LucodeBridge()
      await bridge.cancelSession('sess', true)

      const deleteCall = fetchMock.mock.calls.find(call => {
        return (call[1] as Record<string, unknown>)?.method === 'DELETE'
      })
      expect(deleteCall).toBeDefined()
    })

    it('throws when session not found', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
        json: async () => ({})
      })

      const bridge = new LucodeBridge()
      await expect(bridge.cancelSession('nonexistent')).rejects.toThrow("Session 'nonexistent' not found")
    })
  })

  describe('convertToSpec', () => {
    it('converts session to spec via API', async () => {
      fetchMock.mockResolvedValue(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.convertToSpec('my-session')

      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions/my-session/convert-to-spec')
      expect(init?.method).toBe('POST')
    })

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue(createErrorResponse(500, 'Internal Server Error'))

      const bridge = new LucodeBridge()
      await expect(bridge.convertToSpec('bad-session')).rejects.toThrow('Failed to convert session to spec')
    })

    it('passes project path headers', async () => {
      fetchMock.mockResolvedValue(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.convertToSpec('sess', '/custom/project')

      const [, init] = fetchMock.mock.calls[0]
      const headers = init?.headers as Record<string, string>
      expect(headers['X-Project-Path']).toBeDefined()
    })
  })

  describe('deleteDraftSession', () => {
    it('deletes draft session and notifies', async () => {
      fetchMock
        .mockResolvedValueOnce(createResponse({}))
        .mockResolvedValueOnce(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.deleteDraftSession('my-draft')

      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/specs/my-draft')
      expect(init?.method).toBe('DELETE')

      const [webhookUrl] = fetchMock.mock.calls[1]
      expect(String(webhookUrl)).toContain('/webhook/session-removed')
    })

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue(createErrorResponse(404, 'Not Found'))

      const bridge = new LucodeBridge()
      await expect(bridge.deleteDraftSession('missing')).rejects.toThrow('Failed to delete spec')
    })
  })

  describe('listDraftSessions', () => {
    it('returns draft sessions', async () => {
      const drafts = [
        { id: 'd1', name: 'draft-1', status: 'spec' },
        { id: 'd2', name: 'draft-2', status: 'spec' }
      ]
      fetchMock.mockResolvedValue(createResponse(drafts))

      const bridge = new LucodeBridge()
      const result = await bridge.listDraftSessions()

      expect(result).toHaveLength(2)
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/specs')
    })

    it('returns empty array on error', async () => {
      fetchMock.mockRejectedValue(new Error('network'))

      const bridge = new LucodeBridge()
      const result = await bridge.listDraftSessions()

      expect(result).toEqual([])
    })
  })

  describe('listSessionsByState', () => {
    it('delegates to listDraftSessions for spec filter', async () => {
      const drafts = [{ id: 'd1', name: 'draft-1' }]
      fetchMock.mockResolvedValue(createResponse(drafts))

      const bridge = new LucodeBridge()
      const result = await bridge.listSessionsByState('spec')

      expect(result).toHaveLength(1)
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/specs')
    })

    it('appends state=reviewed query for reviewed filter', async () => {
      fetchMock.mockResolvedValue(createResponse([]))

      const bridge = new LucodeBridge()
      await bridge.listSessionsByState('reviewed')

      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions?state=reviewed')
    })

    it('appends state=running query for active filter', async () => {
      fetchMock.mockResolvedValue(createResponse([]))

      const bridge = new LucodeBridge()
      await bridge.listSessionsByState('active')

      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions?state=running')
    })

    it('uses /api/sessions without filter for all', async () => {
      fetchMock.mockResolvedValue(createResponse([]))

      const bridge = new LucodeBridge()
      await bridge.listSessionsByState('all')

      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions')
      expect(String(url)).not.toContain('?state=')
    })

    it('returns empty array on error', async () => {
      fetchMock.mockRejectedValue(new Error('fail'))

      const bridge = new LucodeBridge()
      const result = await bridge.listSessionsByState('all')

      expect(result).toEqual([])
    })
  })

  describe('markSessionReviewed', () => {
    it('marks session as reviewed via API', async () => {
      fetchMock.mockResolvedValue(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.markSessionReviewed('my-session')

      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/sessions/my-session/mark-reviewed')
      expect(init?.method).toBe('POST')
    })

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue(createErrorResponse(500, 'Internal Server Error'))

      const bridge = new LucodeBridge()
      await expect(bridge.markSessionReviewed('bad')).rejects.toThrow('Failed to mark session as reviewed')
    })

    it('passes project headers', async () => {
      fetchMock.mockResolvedValue(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.markSessionReviewed('sess', '/other/project')

      const [, init] = fetchMock.mock.calls[0]
      const headers = init?.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Project-Path']).toBeDefined()
    })
  })

  describe('getCurrentTasks', () => {
    it('combines active and draft sessions', async () => {
      const activeSessions = [
        { info: { session_id: 'active1', display_name: 'Active 1', branch: 'lucode/active1', base_branch: 'main', worktree_path: '/wt1', session_state: 'Running' } }
      ]
      const draftSessions = [
        { id: 'draft1', name: 'draft1', status: 'spec' }
      ]

      fetchMock
        .mockResolvedValueOnce(createResponse(activeSessions))
        .mockResolvedValueOnce(createResponse(draftSessions))

      const bridge = new LucodeBridge()
      const result = await bridge.getCurrentTasks()

      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('returns empty array on error', async () => {
      fetchMock.mockRejectedValue(new Error('fail'))

      const bridge = new LucodeBridge()
      const result = await bridge.getCurrentTasks()

      expect(result).toEqual([])
    })
  })
})
