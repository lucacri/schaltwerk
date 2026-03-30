import * as fs from 'fs'
import * as path from 'path'

describe('MCP tool registry', () => {
  it('exposes spec-first create command name', () => {
    const serverPath = path.join(__dirname, '../src/lucode-mcp-server.ts')
    const content = fs.readFileSync(serverPath, 'utf8')

    expect(content).toContain('name: "lucode_spec_create"')
    expect(content).toContain('name: "lucode_merge_session"')
    expect(content).toContain('name: "lucode_create_pr"')
    expect(content).toContain('name: "lucode_spec_list"')
    expect(content).toContain('name: "lucode_spec_read"')
    expect(content).toContain('name: "lucode_diff_summary"')
    expect(content).toContain('name: "lucode_diff_chunk"')
    expect(content).toContain('name: "lucode_session_spec"')
    expect(content).toContain('name: "lucode_get_pr_feedback"')
    expect(content).toContain('name: "lucode_get_setup_script"')
    expect(content).toContain('name: "lucode_set_setup_script"')
    expect(content).toContain('inspect the repo for untracked config (e.g., .env*, .npmrc) that should be copied into worktrees; (3) confirm the exact files to copy with the user')
  })
})
