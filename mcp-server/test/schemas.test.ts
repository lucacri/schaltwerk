import { describe, expect, it } from 'bun:test'
import Ajv from 'ajv'
let addFormats: ((ajv: Ajv) => void)
let outputSchemaValidator:
  | { safeParse: (value: unknown) => { success: boolean; error?: unknown } }
  | null = null
try {
  // Prefer installed package; fall back to no-op when unavailable (CI cache miss)
  addFormats = (await import('ajv-formats')).default
} catch {
  addFormats = () => {}
}
try {
  const { ToolSchema } = await import('@modelcontextprotocol/sdk/types.js')
  outputSchemaValidator = ToolSchema.shape.outputSchema
} catch {
  outputSchemaValidator = null
}
import { toolOutputSchemas } from '../src/schemas'

const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: false })
addFormats(ajv)

const sampleStructuredOutputs: Record<string, any> = {
  lucode_create: {
    type: 'session',
    status: 'created',
    session: {
      name: 'alpha',
      branch: 'lucode/alpha',
      worktree_path: '/tmp/project/.lucode/worktrees/alpha',
      parent_branch: 'main',
      agent_type: 'claude',
      ready_to_merge: false,
    },
  },
  lucode_list: {
    sessions: [
      {
        name: 'alpha',
        display_name: 'Alpha',
        status: 'spec',
        session_state: 'Spec',
        ready_to_merge: false,
        created_at: '2024-05-01T00:00:00Z',
        last_activity: null,
        agent_type: 'claude',
        branch: 'lucode/alpha',
        worktree_path: null,
        initial_prompt: 'Initial work',
        draft_content: '# Plan',
      },
    ],
  },
  lucode_send_message: {
    session: 'alpha',
    status: 'sent',
    message: 'ping',
  },
  lucode_cancel: {
    session: 'alpha',
    cancelled: true,
    force: false,
  },
  lucode_get_setup_script: {
    setup_script: '#!/bin/bash\necho boot',
    has_setup_script: true,
  },
  lucode_set_setup_script: {
    setup_script: '#!/bin/bash\necho updated',
    has_setup_script: true,
  },
  lucode_get_worktree_base_directory: {
    worktree_base_directory: '/tmp/worktrees',
    has_custom_directory: true,
  },
  lucode_set_worktree_base_directory: {
    worktree_base_directory: '/tmp/worktrees',
    has_custom_directory: true,
  },
  lucode_spec_create: {
    type: 'spec',
    status: 'created',
    session: {
      name: 'alpha_spec',
      branch: 'lucode/alpha_spec',
      parent_branch: 'main',
      content_length: 128,
    },
  },
  lucode_draft_update: {
    session: 'alpha_spec',
    updated: true,
    append: false,
    content_length: 256,
    content_preview: '# Updated plan',
  },
  lucode_spec_list: {
    specs: [
      {
        session_id: 'alpha_spec',
        display_name: 'Alpha Spec',
        stage: 'draft',
        content_length: 256,
        updated_at: '2024-05-01T12:00:00Z',
      },
    ],
  },
  lucode_spec_read: {
    session_id: 'alpha_spec',
    display_name: 'Alpha Spec',
    stage: 'clarified',
    content: '# Alpha',
    content_length: 7,
    updated_at: '2024-05-01T12:00:00Z',
  },
  lucode_spec_set_stage: {
    session_id: 'alpha_spec',
    stage: 'clarified',
    updated_at: '2024-05-01T12:00:00Z',
  },
  lucode_spec_set_attention: {
    session_id: 'alpha_spec',
    attention_required: true,
    updated_at: '2024-05-01T12:00:00Z',
  },
  lucode_diff_summary: {
    scope: 'session',
    session_id: 'fiery_maxwell',
    branch_info: {
      current_branch: 'lucode/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    has_spec: true,
    files: [{ path: 'src/app.ts', change_type: 'modified' }],
    paging: { next_cursor: null, total_files: 1, returned: 1 },
  },
  lucode_diff_chunk: {
    file: { path: 'src/app.ts', change_type: 'modified' },
    branch_info: {
      current_branch: 'lucode/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    stats: { additions: 10, deletions: 2 },
    is_binary: false,
    lines: [{ content: 'const a = 1;', line_type: 'added', new_line_number: 3 }],
    paging: { cursor: null, next_cursor: null, returned: 1 },
  },
  lucode_session_spec: {
    session_id: 'fiery_maxwell',
    content: '# Spec',
    updated_at: '2024-05-01T12:34:56Z',
  },
  lucode_get_pr_feedback: {
    state: 'OPEN',
    is_draft: false,
    review_decision: 'CHANGES_REQUESTED',
    latest_reviews: [
      {
        author: 'reviewer-1',
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-03-30T10:00:00Z',
      },
    ],
    status_checks: [
      {
        name: 'ci / unit',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        url: 'https://example.com/check/1',
      },
      {
        name: 'buildkite',
        status: 'PENDING',
        conclusion: null,
        url: null,
      },
    ],
    unresolved_threads: [
      {
        id: 'thread-1',
        path: 'src/lib.rs',
        line: 42,
        comments: [
          {
            id: 'comment-1',
            body: 'Please rename this.',
            author: 'reviewer-1',
            created_at: '2026-03-30T10:05:00Z',
            url: 'https://example.com/comment/1',
          },
        ],
      },
    ],
    resolved_thread_count: 2,
  },
  lucode_draft_start: {
    session: 'alpha_spec',
    started: true,
    agent_type: 'claude',
    base_branch: 'main',
  },
  lucode_draft_list: {
    specs: [
      {
        name: 'alpha_spec',
        display_name: 'Alpha Spec',
        created_at: '2024-05-01T00:00:00Z',
        updated_at: '2024-05-02T00:00:00Z',
        base_branch: 'main',
        content_length: 5,
        content_preview: '# plan',
      },
    ],
  },
  lucode_draft_delete: {
    session: 'alpha_spec',
    deleted: true,
  },
  lucode_get_current_tasks: {
    tasks: [
      {
        name: 'alpha',
        display_name: 'Alpha',
        status: 'spec',
        session_state: 'Spec',
        branch: 'lucode/alpha',
        ready_to_merge: false,
        agent_type: 'claude',
        initial_prompt: 'prompt',
        draft_content: 'content',
      },
    ],
  },
  lucode_promote: {
    session: 'alpha_v3',
    siblings_cancelled: ['alpha_v1', 'alpha_v2'],
    reason: 'Best coverage',
    failures: [],
  },
  lucode_convert_to_spec: {
    session: 'alpha',
    converted: true,
  },
  lucode_merge_session: {
    session: 'alpha',
    merged: true,
    mode: 'squash',
    parent_branch: 'main',
    session_branch: 'lucode/alpha',
    commit: 'abc123',
    cancel_requested: false,
    cancel_queued: false,
    cancel_error: null,
  },
  lucode_create_pr: {
    session: 'alpha',
    branch: 'lucode/alpha',
    pr_url: 'https://example.com/pr/1',
    cancel_requested: false,
    cancel_queued: false,
    cancel_error: null,
  },
  lucode_link_pr: {
    session: 'alpha',
    pr_number: 42,
    pr_url: 'https://example.com/pr/42',
    linked: true,
  },
  lucode_create_epic: {
    epic: {
      id: 'abc-123',
      name: 'auth-rewrite',
      color: '#FF5733',
    },
  },
  lucode_list_epics: {
    epics: [
      {
        id: 'abc-123',
        name: 'auth-rewrite',
        color: '#FF5733',
      },
      {
        id: 'def-456',
        name: 'perf-improvements',
        color: null,
      },
    ],
  },
  lucode_run_script: {
    success: true,
    command: 'bun run dev',
    exit_code: 0,
    stdout: 'Server started on port 3000',
    stderr: '',
  },
  lucode_prepare_merge: {
    session: 'alpha',
    modal_triggered: true,
  },
  lucode_consolidation_report: {
    session: 'candidate-1',
    round_id: 'round-abc',
    role: 'candidate',
    auto_judge_triggered: false,
    auto_promoted: false,
  },
  lucode_trigger_consolidation_judge: {
    round_id: 'round-abc',
    judge_session: 'judge-1',
  },
  lucode_confirm_consolidation_winner: {
    round_id: 'round-abc',
    winner_session: 'candidate-1',
    promoted_session: 'feature_v2',
    candidate_sessions_cancelled: ['candidate-2'],
    source_sessions_cancelled: ['feature_v1'],
  },
}

describe('MCP output schemas', () => {
  it('has schema coverage for every structured tool', () => {
    const schemaNames = Object.keys(toolOutputSchemas)
    const sampleNames = Object.keys(sampleStructuredOutputs)
    expect(schemaNames.sort()).toEqual(sampleNames.sort())
  })

  it('does not expose a schema for lucode_current_spec_update', () => {
    expect(toolOutputSchemas).not.toHaveProperty('lucode_current_spec_update')
  })

  for (const [toolName, schema] of Object.entries(toolOutputSchemas)) {
    const sample = sampleStructuredOutputs[toolName]

    it(`accepts representative structured output for ${toolName}`, () => {
      const validate = ajv.compile(schema as any)
      const valid = validate(sample)
      expect({ valid, errors: validate.errors ?? [] }).toEqual({ valid: true, errors: [] })
    })
  }

  it('rejects an invalid diff chunk payload', () => {
    const schema = toolOutputSchemas.lucode_diff_chunk as any
    const validate = ajv.compile(schema)
    const invalid = {
      stats: { additions: 1, deletions: 0 },
      is_binary: false,
      lines: [],
      paging: { cursor: null, next_cursor: null, returned: 0 },
    }

    expect(validate(invalid)).toBeFalse()
  })

  it('accepts preset launch output for lucode_create', () => {
    const schema = toolOutputSchemas.lucode_create as any
    const validate = ajv.compile(schema)
    const payload = {
      mode: 'preset',
      preset: { id: 'preset-smarts', name: 'Smarts' },
      version_group_id: 'group-1',
      sessions: [
        { name: 'feature_v1', branch: 'lucode/feature_v1', agent_type: 'claude', version_number: 1 },
        { name: 'feature_v2', branch: 'lucode/feature_v2', agent_type: 'codex', version_number: 2 },
      ],
    }

    expect(validate(payload)).toBeTrue()
  })

  it('accepts preset launch output for lucode_draft_start', () => {
    const schema = toolOutputSchemas.lucode_draft_start as any
    const validate = ajv.compile(schema)
    const payload = {
      mode: 'preset',
      source_spec: 'mcp-preset-support',
      archived_spec: true,
      preset: { id: 'preset-smarts', name: 'Smarts' },
      version_group_id: 'group-9',
      sessions: [
        { name: 'mcp-preset-support_v1', branch: 'lucode/mcp-preset-support_v1', agent_type: 'claude', version_number: 1 },
      ],
    }

    expect(validate(payload)).toBeTrue()
  })

  const sdkDescribe = outputSchemaValidator ? describe : describe.skip

  sdkDescribe('MCP SDK Tool.outputSchema acceptance', () => {
    // Guard against regressions like https://… where a schema that Ajv accepts
    // (root-level `oneOf` without a top-level `type`) is still rejected by the
    // MCP SDK's Zod validator, causing Claude Code to discard the entire
    // `tools/list` response and surface zero lucode tools even though the
    // server reports "connected".
    if (!outputSchemaValidator) {
      return
    }

    for (const [toolName, schema] of Object.entries(toolOutputSchemas)) {
      it(`${toolName} is accepted by the MCP SDK Tool.outputSchema validator`, () => {
        const result = outputSchemaValidator.safeParse(schema)
        if (!result.success) {
          throw new Error(
            `${toolName} outputSchema rejected by MCP SDK:\n` +
              JSON.stringify(result.error.issues, null, 2),
          )
        }
        expect(result.success).toBe(true)
      })
    }
  })
})
