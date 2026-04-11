import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createHash } from 'crypto'

const fetchMock = mock<
  Parameters<typeof fetch>,
  Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string>; json: () => Promise<any> }>
>(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ sample: true }),
    json: async () => ({ sample: true }),
  })
)

mock.module('node-fetch', () => ({
  default: fetchMock,
}))

const { LucodeBridge } = await import('../src/lucode-bridge')

function expectedHeaders(projectPath: string) {
  const canonical = fs.realpathSync(projectPath)
  const hash = createHash('sha256').update(canonical).digest('hex').substring(0, 16)
  const name = path.basename(canonical) || 'unknown'
  const safeName = name.replace(/[^a-zA-Z0-9\-_]/g, '_')
  return {
    'X-Project-Path': canonical,
    'X-Project-Hash': hash,
    'X-Project-Name': name,
    'X-Project-Identifier': `${safeName}_${hash}`
  }
}

function headersFromCall(callIndex: number): Record<string, string> {
  const init = fetchMock.mock.calls[callIndex][1] as { headers?: Record<string, string> }
  return init?.headers ?? {}
}

const createResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => JSON.stringify(payload),
  json: async () => payload
})

describe('LucodeBridge project routing', () => {
  let tempDir: string
  let consoleErrorSpy: ReturnType<typeof spyOn>
  let consoleWarnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucode-routing-test-'))
    process.env.LUCODE_PROJECT_PATH = tempDir
    delete process.env.LUCODE_MCP_PORT
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    delete process.env.LUCODE_PROJECT_PATH
    delete process.env.LUCODE_MCP_PORT
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('sends project path headers in listSessions', async () => {
    fetchMock.mockResolvedValueOnce(createResponse([]))
    const bridge = new LucodeBridge()
    await bridge.listSessions()

    const headers = headersFromCall(0)
    const expected = expectedHeaders(tempDir)
    expect(headers['X-Project-Path']).toBe(expected['X-Project-Path'])
    expect(headers['X-Project-Hash']).toBe(expected['X-Project-Hash'])
  })

  it('overrides project path when projectPath parameter is provided', async () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucode-override-test-'))
    try {
      fetchMock.mockResolvedValueOnce(createResponse([]))
      const bridge = new LucodeBridge()
      await bridge.listSessions(overrideDir)

      const headers = headersFromCall(0)
      const expected = expectedHeaders(overrideDir)
      expect(headers['X-Project-Path']).toBe(expected['X-Project-Path'])
      expect(headers['X-Project-Hash']).toBe(expected['X-Project-Hash'])
    } finally {
      if (fs.existsSync(overrideDir)) {
        fs.rmSync(overrideDir, { recursive: true, force: true })
      }
    }
  })

  it('sends project headers in webhook notifications', async () => {
    fetchMock.mockResolvedValue(createResponse({}))

    const bridge = new LucodeBridge()
    // @ts-ignore - access private method for testing
    await bridge.notifySessionAdded({ name: 'test' })

    const headers = headersFromCall(0)
    const expected = expectedHeaders(tempDir)
    expect(headers['X-Project-Path']).toBe(expected['X-Project-Path'])
  })

  it('includes version metadata in session-added webhook notifications', async () => {
    fetchMock.mockResolvedValue(createResponse({}))

    const bridge = new LucodeBridge()
    // @ts-ignore - access private method for testing
    await bridge.notifySessionAdded({
      name: 'test_v2',
      branch: 'lucode/test_v2',
      worktree_path: '/tmp/test_v2',
      parent_branch: 'main',
      version_group_id: 'group-1',
      version_number: 2,
    })

    const init = fetchMock.mock.calls[0][1] as { body?: string }
    expect(JSON.parse(String(init?.body))).toEqual({
      session_name: 'test_v2',
      branch: 'lucode/test_v2',
      worktree_path: '/tmp/test_v2',
      parent_branch: 'main',
      version_group_id: 'group-1',
      version_number: 2,
    })
  })

  it('sends project headers in updateDraftContent', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({}))
    const bridge = new LucodeBridge()
    await bridge.updateDraftContent('test-session', 'content')

    const headers = headersFromCall(0)
    const expected = expectedHeaders(tempDir)
    expect(headers['X-Project-Path']).toBe(expected['X-Project-Path'])
  })

  it('sends project headers in startDraftSession', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({}))
    fetchMock.mockResolvedValueOnce(createResponse({ status: 404 }))
    const bridge = new LucodeBridge()
    await bridge.startDraftSession('test-session')

    const headers = headersFromCall(0)
    const expected = expectedHeaders(tempDir)
    expect(headers['X-Project-Path']).toBe(expected['X-Project-Path'])
  })

  it('passes override through createSession to notifySessionAdded', async () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucode-override-test-'))
    try {
      const session = {
        id: 'test',
        name: 'test',
        branch: 'lucode/test',
        parent_branch: 'main',
        worktree_path: '/tmp/wt',
        status: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
        ready_to_merge: false,
        pending_name_generation: false,
        was_auto_generated: false
      }
      fetchMock.mockResolvedValueOnce(createResponse(session))
      fetchMock.mockResolvedValueOnce(createResponse({}))

      const bridge = new LucodeBridge()
      await bridge.createSession('test', 'prompt', undefined, undefined, undefined, undefined, overrideDir)

      const createHeaders = headersFromCall(0)
      const webhookHeaders = headersFromCall(1)
      const expected = expectedHeaders(overrideDir)
      expect(createHeaders['X-Project-Path']).toBe(expected['X-Project-Path'])
      expect(webhookHeaders['X-Project-Path']).toBe(expected['X-Project-Path'])
    } finally {
      if (fs.existsSync(overrideDir)) {
        fs.rmSync(overrideDir, { recursive: true, force: true })
      }
    }
  })

  it('all webhook methods include project headers', async () => {
    fetchMock.mockResolvedValue(createResponse({}))

    const bridge = new LucodeBridge()
    const expected = expectedHeaders(tempDir)

    // @ts-ignore
    await bridge.notifyDraftCreated({ name: 'test' })
    expect(headersFromCall(fetchMock.mock.calls.length - 1)['X-Project-Path']).toBe(expected['X-Project-Path'])

    // @ts-ignore
    await bridge.notifySessionRemoved('test')
    expect(headersFromCall(fetchMock.mock.calls.length - 1)['X-Project-Path']).toBe(expected['X-Project-Path'])

    // @ts-ignore
    await bridge.notifyFollowUpMessage('test', 'msg')
    expect(headersFromCall(fetchMock.mock.calls.length - 1)['X-Project-Path']).toBe(expected['X-Project-Path'])
  })

  it('reverts to default headers when no override is provided', async () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucode-override-test-'))
    try {
      fetchMock.mockResolvedValue(createResponse({}))
      const bridge = new LucodeBridge()

      await bridge.updateDraftContent('test', 'content', false, overrideDir)
      const overrideHeaders = headersFromCall(0)
      expect(overrideHeaders['X-Project-Path']).toBe(expectedHeaders(overrideDir)['X-Project-Path'])

      await bridge.updateDraftContent('test', 'content2')
      const defaultHeaders = headersFromCall(1)
      expect(defaultHeaders['X-Project-Path']).toBe(expectedHeaders(tempDir)['X-Project-Path'])
    } finally {
      if (fs.existsSync(overrideDir)) {
        fs.rmSync(overrideDir, { recursive: true, force: true })
      }
    }
  })
})
