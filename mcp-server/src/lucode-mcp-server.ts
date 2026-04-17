#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js"
import { LucodeBridge, Session, MergeModeOption, PrFeedbackPayload, PresetDraftStartResult, PresetLaunchResult, SpecAttentionUpdateResult, SpecStage, SpecStageUpdateResult } from "./lucode-bridge.js"
import { listLucodeWorkflows, readLucodeWorkflowMarkdown } from "./lucode-workflows.js"
import { toolOutputSchemas } from "./schemas.js"

const DEFAULT_AGENT = 'claude'

interface LucodeStartArgs {
  name?: string
  prompt?: string
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex' | 'qwen' | 'droid' | 'amp' | 'kilocode'
  base_branch?: string
  use_existing_branch?: boolean
  is_draft?: boolean
  draft_content?: string
  epic_id?: string
  preset?: string
}

interface LucodeCancelArgs {
  session_name: string
  force?: boolean
}

interface LucodeListArgs {
  json?: boolean
  filter?: 'all' | 'active' | 'spec' | 'ready'
}

interface LucodeSendMessageArgs {
  session_name: string
  message: string
}

interface LucodeSpecCreateArgs {
  name?: string
  content?: string
  base_branch?: string
  epic_id?: string
  preset?: string
}

interface LucodeCreateEpicArgs {
  name: string
  color?: string
}

interface LucodeDraftUpdateArgs {
  session_name: string
  content: string
  append?: boolean
}

interface LucodeDraftStartArgs {
  session_name: string
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex' | 'qwen' | 'droid' | 'amp' | 'kilocode'
  base_branch?: string
  preset?: string
}

interface LucodeImprovePlanArgs {
  session_name: string
  candidate_count?: number
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex' | 'qwen' | 'droid' | 'amp' | 'kilocode'
  base_branch?: string
}

interface LucodeDraftListArgs {
  json?: boolean
}

interface LucodeDraftDeleteArgs {
  session_name: string
}

interface LucodeConvertToSpecArgs {
  session_name: string
}

interface LucodeMergeArgs {
  session_name: string
  commit_message?: string | null
  mode?: 'squash' | 'reapply'
  cancel_after_merge?: boolean
}

interface LucodePromoteArgs {
  session_name: string
  reason: string
  winner_session_id?: string | null
}

interface LucodeConsolidationReportArgs {
  session_name: string
  report: string
  base_session_id?: string | null
  recommended_session_id?: string | null
}

interface LucodeTriggerConsolidationJudgeArgs {
  round_id: string
  early?: boolean
}

interface LucodeConfirmConsolidationWinnerArgs {
  round_id: string
  winner_session_id: string
  override_reason?: string | null
}

interface LucodeCreatePrArgs {
  session_name: string
  pr_title: string
  pr_body?: string | null
  base_branch?: string | null
  pr_branch_name?: string | null
  mode?: 'squash' | 'reapply'
  commit_message?: string | null
  repository?: string | null
  cancel_after_pr?: boolean
}

interface LucodeLinkPrArgs {
  session_name: string
  pr_number?: number
  pr_url?: string
}

interface LucodePrepareMergeArgs {
  session_name: string
  commit_message?: string | null
  mode?: 'squash' | 'reapply'
}

interface LucodeSetSetupScriptArgs {
  setup_script: string
}

interface LucodeSetWorktreeBaseDirectoryArgs {
  worktree_base_directory: string
}

const bridge = new LucodeBridge()

 const server = new Server({
   name: "lucode-mcp-server",
   version: "1.0.0",
 }, {
   capabilities: {
     tools: {},
     resources: {},
   }
 })

  // 🔒 SECURITY NOTICE: This MCP server manages Git worktrees and sessions
  // - All session operations preserve Git history and commits
  // - Ready-to-merge sessions represent validated work that should be protected
  // - Never delete sessions without user consent or successful merge validation
  // - If MCP server is not accessible, ask user for help immediately
  // - Session cancellation requires explicit force parameter for safety
  // - First merge main into session branch before merging back
  // - Understand Git diffs: false "deletions" are normal after merging main
  // - Send follow-up messages for merge issues, don't force problematic merges
  // - Git recovery: commits can be recovered from git cat-file, uncommitted changes are lost

type TextContent = { type: "text"; text: string; mimeType?: string }
const JSON_MIME = "application/json"

const structuredContentEnabled = () => {
  const flag = process.env.LUCODE_STRUCTURED_CONTENT
  return flag === undefined || flag.toLowerCase() === 'true' || flag === '1'
}

const jsonArrayCompatEnabled = () => {
  const flag = process.env.LUCODE_JSON_ARRAY_COMPAT
  return flag !== undefined && (flag.toLowerCase() === 'true' || flag === '1')
}

type StructuredResponse = { structuredContent?: unknown; content: TextContent[] }

function buildStructuredResponse(
  structured: unknown,
  options?: { summaryText?: string; jsonFirst?: boolean; mimeType?: string; includeStructured?: boolean }
): StructuredResponse {
  const includeStructured = options?.includeStructured ?? structuredContentEnabled()
  const mimeType = options?.mimeType ?? JSON_MIME
  const contentEntries: TextContent[] = []
  const jsonEntry: TextContent = { type: "text", text: JSON.stringify(structured, null, 2), mimeType }

  if (options?.jsonFirst) {
    contentEntries.push(jsonEntry)
  }

  if (options?.summaryText) {
    contentEntries.push({ type: "text", text: options.summaryText })
  }

  if (!options?.jsonFirst) {
    contentEntries.push(jsonEntry)
  }

  return includeStructured
    ? { structuredContent: structured, content: contentEntries }
    : { content: contentEntries }
}

const isPresetLaunchResult = (value: unknown): value is PresetLaunchResult => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PresetLaunchResult>
  return candidate.mode === 'preset' && Array.isArray(candidate.sessions)
}

type SpecDocumentPayload = {
  session_id: string
  display_name?: string | null
  stage: SpecStage
  content: string
  content_length: number
  updated_at: string
}

type SpecSummaryPayload = {
  session_id: string
  display_name?: string | null
  stage: SpecStage
  content_length: number
  updated_at: string
}

type SpecStagePayload = SpecStageUpdateResult
type SpecAttentionPayload = SpecAttentionUpdateResult

type SessionSpecPayload = {
  session_id: string
  content: string
  updated_at: string
}

type DiffBranchInfo = {
  current_branch: string
  parent_branch: string
  merge_base_short: string
  head_short: string
}

type DiffFile = {
  path: string
  change_type: string
}

type DiffLine = {
  content: string
  line_type: string
  old_line_number?: number
  new_line_number?: number
  is_collapsible?: boolean
  collapsed_count?: number
}

type DiffPaging = {
  cursor?: string | null
  next_cursor?: string | null
  returned: number
  total_files?: number
}

type DiffSummaryPayload = {
  scope: string
  session_id?: string | null
  branch_info: DiffBranchInfo
  has_spec: boolean
  files: DiffFile[]
  paging: DiffPaging
}

type DiffChunkPayload = {
  file: DiffFile
  branch_info: DiffBranchInfo
  stats: { additions: number; deletions: number }
  is_binary: boolean
  lines: DiffLine[]
  paging: DiffPaging
}

const sanitizeSpecDocument = (payload: SpecDocumentPayload) => ({
  session_id: payload.session_id,
  display_name: payload.display_name ?? undefined,
  stage: payload.stage,
  content: payload.content,
  content_length: payload.content_length,
  updated_at: payload.updated_at
})

const sanitizeSpecSummary = (payload: SpecSummaryPayload) => ({
  session_id: payload.session_id,
  display_name: payload.display_name ?? undefined,
  stage: payload.stage,
  content_length: payload.content_length,
  updated_at: payload.updated_at
})

const sanitizeSpecStage = (payload: SpecStagePayload) => ({
  session_id: payload.session_id,
  stage: payload.stage,
  updated_at: payload.updated_at,
})

const sanitizeSpecAttention = (payload: SpecAttentionPayload) => ({
  session_id: payload.session_id,
  attention_required: payload.attention_required,
  updated_at: payload.updated_at,
})

const sanitizeSessionSpec = (payload: SessionSpecPayload) => ({
  session_id: payload.session_id,
  content: payload.content,
  updated_at: payload.updated_at
})

const sanitizeDiffSummary = (payload: DiffSummaryPayload) => ({
  scope: payload.scope,
  session_id: payload.session_id ?? null,
  branch_info: payload.branch_info,
  has_spec: payload.has_spec,
  files: payload.files,
  paging: payload.paging
})

const sanitizeDiffChunk = (payload: DiffChunkPayload) => ({
  file: payload.file,
  branch_info: payload.branch_info,
  stats: payload.stats,
  is_binary: payload.is_binary,
  lines: payload.lines,
  paging: payload.paging
})

const sanitizePrFeedback = (payload: PrFeedbackPayload) => ({
  state: payload.state,
  is_draft: payload.isDraft,
  review_decision: payload.reviewDecision ?? null,
  latest_reviews: payload.latestReviews.map(review => ({
    author: review.author ?? null,
    state: review.state,
    submitted_at: review.submittedAt,
  })),
  status_checks: payload.statusChecks.map(check => ({
    name: check.name,
    status: check.status,
    conclusion: check.conclusion ?? null,
    url: check.url ?? null,
  })),
  unresolved_threads: payload.unresolvedThreads.map(thread => ({
    id: thread.id,
    path: thread.path,
    line: thread.line ?? null,
    comments: thread.comments.map(comment => ({
      id: comment.id,
      body: comment.body,
      author: comment.author ?? null,
      created_at: comment.createdAt,
      url: comment.url,
    })),
  })),
  resolved_thread_count: payload.resolvedThreadCount,
})

const isFailingConclusion = (conclusion: string | null) => {
  if (!conclusion) {
    return false
  }
  const value = conclusion.toUpperCase()
  return value === 'FAILURE' || value === 'TIMED_OUT' || value === 'ACTION_REQUIRED' || value === 'CANCELLED' || value === 'ERROR'
}

const isPendingCheck = (status: string | null, conclusion: string | null) => {
  if (conclusion) {
    return false
  }
  if (!status) {
    return true
  }

  const normalized = status.toUpperCase()
  return normalized !== 'COMPLETED' && normalized !== 'SUCCESS'
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
      {
        name: "lucode_create",
        description: `Create a new Lucode session and matching git worktree for an AI agent. Provide a unique session name plus a specific, implementation-focused prompt; that prompt seeds the agent. Optional fields let you select agent_type (claude, opencode, gemini, codex, qwen, droid, kilocode), choose a base_branch, or bypass manual permission prompts when you understand the risk. Use this whenever you need a fresh, isolated development branch.`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Session name (alphanumeric, hyphens, underscores). Will be used in branch name: lucode/{name}"
            },
            prompt: {
              type: "string",
              description: "Initial agent description or context for AI agent. Be specific and detailed."
            },
            agent_type: {
            type: "string",
            enum: ["claude", "opencode", "gemini", "codex", "qwen", "droid", "amp", "kilocode"],
            description: "AI agent type to use (default: claude)"
            },
            base_branch: {
              type: "string",
              description: "Base branch to create session from (default: main/master)"
            },
            use_existing_branch: {
              type: "boolean",
              description: "When true, use the base_branch directly instead of creating a new branch from it. The branch must exist and not be checked out in another worktree. Useful for continuing work on an existing PR branch."
            },
            epic_id: {
              type: "string",
              description: "Optional epic ID to assign the session to"
            },
            preset: {
              type: "string",
              description: "Preset id or name to expand into one or more launch slots. Mutually exclusive with agent_type."
            }
          },
          required: ["name", "prompt"]
        },
        outputSchema: toolOutputSchemas.lucode_create
      },
      {
        name: "lucode_get_setup_script",
        description: `Fetch the project worktree setup script that runs once per new worktree before any agent starts. Always call this before modifying the script so you merge with the current contents (env copies, installs, etc.).`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_get_setup_script
      },
      {
        name: "lucode_set_setup_script",
        description: `Replace the project worktree setup script. Workflow: (1) call lucode_get_setup_script; (2) inspect the repo for untracked config (e.g., .env*, .npmrc) that should be copied into worktrees; (3) confirm the exact files to copy with the user; (4) send back the full updated script (include shebang). The script runs once in the worktree root with env vars WORKTREE_PATH, REPO_PATH, SESSION_NAME, BRANCH_NAME—ideal for copying env files or installing local deps.`,
        inputSchema: {
          type: "object",
          properties: {
            setup_script: {
              type: "string",
              description: "Full setup script content (include shebang). Runs once per worktree before the agent launches."
            }
          },
          required: ["setup_script"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_set_setup_script
      },
      {
        name: "lucode_get_worktree_base_directory",
        description: `Get the custom worktree base directory for the project. Returns the configured directory path (if any) where new session worktrees are created instead of the default .lucode/worktrees/ location.`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_get_worktree_base_directory
      },
      {
        name: "lucode_set_worktree_base_directory",
        description: `Set or clear the custom worktree base directory for the project. Accepts absolute paths (e.g., /Volumes/fast-ssd/worktrees) or paths relative to the repository root (e.g., ../../worktrees). An empty string clears the setting, reverting to the default .lucode/worktrees/ location. Only affects new sessions; existing worktrees are not moved.`,
        inputSchema: {
          type: "object",
          properties: {
            worktree_base_directory: {
              type: "string",
              description: "Directory path for new worktrees. Absolute or relative to repo root. Empty string clears the setting."
            }
          },
          required: ["worktree_base_directory"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_set_worktree_base_directory
      },
      {
        name: "lucode_list",
        description: `List Lucode sessions for quick status checks. Default output is a readable summary; set json: true for structured fields (name, status, timestamps, agent_type, branch, prompts). Use filter to focus on all, active, spec, or ready sessions. Ready sessions are those with ready_to_merge=true.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return structured JSON data instead of formatted text",
              default: false
            },
            filter: {
              type: "string",
              enum: ["all", "active", "spec", "ready"],
              description: "Limit results to a subset of sessions",
              default: "all"
            }
          },
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_list
      },
      {
        name: "lucode_send_message",
        description: `Push a follow-up message into an existing session's agent terminal. The session must exist and be running; the server validates this before sending. Messages queue until the terminal is ready, so you can safely issue reminders or extra instructions.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the existing session to send the message to"
            },
            message: {
              type: "string",
              description: "The message content to send to the session"
            }
          },
          required: ["session_name", "message"]
        },
        outputSchema: toolOutputSchemas.lucode_send_message
      },
      {
        name: "lucode_cancel",
        description: `Cancel a session by deleting its worktree and branch. The server blocks the operation if uncommitted changes are present; pass force: true to override (irreversible and drops unstaged work). Only use after the session has been merged and validated. Ready sessions should almost always stay until merge is complete; if uncertain, use lucode_convert_to_spec to preserve the work.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the session to cancel and delete permanently"
            },
            force: {
              type: "boolean",
              description: "Force deletion even if uncommitted changes exist. DANGEROUS - only use if you're certain you want to lose uncommitted work.",
              default: false
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_cancel
      },
      {
        name: "lucode_spec_create",
        description: `Create a spec session for planning (no worktree yet). Provide optional name, Markdown content, and base_branch. Refine the draft with lucode_draft_update and start it with lucode_draft_start when the plan is ready.`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Spec session name (alphanumeric, hyphens, underscores). Auto-generated if not provided."
            },
            content: {
              type: "string",
              description: "Initial spec content in Markdown format. Can be updated later."
            },
            base_branch: {
              type: "string",
              description: "Base branch for future worktree (default: main/master)"
            },
            epic_id: {
              type: "string",
              description: "Optional epic ID to assign the spec to"
            }
          },
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_spec_create
      },
      {
        name: "lucode_draft_update",
        description: `Replace or append Markdown content on an existing spec session. Leave append false to overwrite the draft or set it true to add on. Use this for iterative refinement before starting the agent.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to update"
            },
            content: {
              type: "string",
              description: "New or additional content in Markdown format"
            },
            append: {
              type: "boolean",
              description: "Append to existing content instead of replacing (default: false)",
              default: false
            }
          },
          required: ["session_name", "content"]
        },
        outputSchema: toolOutputSchemas.lucode_draft_update
      },
      {
        name: "lucode_spec_list",
        description: `List available specs with content length and last update time. Useful for spotting stale or empty drafts before starting them.`,
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_spec_list
      },
      {
        name: "lucode_spec_read",
        description: `Fetch the full markdown content for a spec session by id or name.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Spec session id or name to read"
            }
          },
          required: ["session"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_spec_read
      },
      {
        name: "lucode_spec_set_stage",
        description: `Set a spec's clarification stage to either draft or clarified. Use this to mark a problem statement as ready for implementation handoff or move it back into clarification.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to update"
            },
            stage: {
              type: "string",
              enum: ["draft", "clarified"],
              description: "Target clarification stage"
            }
          },
          required: ["session_name", "stage"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_spec_set_stage
      },
      {
        name: "lucode_spec_set_attention",
        description: `Mark whether a spec needs user attention. Set true when you are blocked waiting for user input; set false after the user has responded.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to update"
            },
            attention_required: {
              type: "boolean",
              description: "Whether the spec currently needs user attention"
            }
          },
          required: ["session_name", "attention_required"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_spec_set_attention
      },
      {
        name: "lucode_improve_plan",
        description: `Start an optional multi-agent plan improvement round for a clarified spec. Candidate sessions inspect the codebase and file markdown plans as consolidation reports; the judge winner is later confirmed with lucode_confirm_consolidation_winner, which writes the accepted plan back to the spec.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the clarified spec session to improve."
            },
            candidate_count: {
              type: "number",
              description: "Number of plan candidates to start (default 2, maximum 6)."
            },
            agent_type: {
              type: "string",
              enum: ["claude", "opencode", "gemini", "codex", "qwen", "droid", "amp", "kilocode"],
              description: "Agent type for candidate sessions when no preset is used."
            },
            base_branch: {
              type: "string",
              description: "Base branch for candidate worktrees."
            }
          },
          required: ["session_name"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_improve_plan
      },
      {
        name: "lucode_diff_summary",
        description: `List changed files for a session (or orchestrator when session is omitted) using merge-base(HEAD, parent_branch) semantics. Supports pagination through cursor and page_size and mirrors the desktop diff summary.` ,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Optional session id or name to target"
            },
            cursor: {
              type: "string",
              description: "Opaque cursor returned from a previous call"
            },
            page_size: {
              type: "number",
              description: "Maximum number of files to return (default 100)",
              minimum: 1
            }
          },
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_diff_summary
      },
      {
        name: "lucode_diff_chunk",
        description: `Fetch unified diff lines for a file. Large diffs paginate via cursor, follow the same merge-base rules as the desktop app, and binaries return an empty list automatically.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Optional session id or name to target"
            },
            path: {
              type: "string",
              description: "Repository-relative path to the file",
            },
            cursor: {
              type: "string",
              description: "Cursor returned from a previous chunk request"
            },
            line_limit: {
              type: "number",
              description: "Maximum number of diff lines to return (default 400, max 1000)",
              minimum: 1
            }
          },
          required: ["path"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_diff_chunk
      },
      {
        name: "lucode_session_spec",
        description: `Fetch spec markdown (and the last updated timestamp) for a running session by id or name.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Session id or name"
            }
          },
          required: ["session"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_session_spec
      },
      {
        name: "lucode_get_pr_feedback",
        description: `Fetch actionable pull request feedback for a session linked to a GitHub PR. Returns: PR state and draft status, review decision (APPROVED, CHANGES_REQUESTED, etc.), latest reviewer verdicts, CI/CD status checks with pass/fail/pending status, and full comment threads that are still unresolved (outdated and resolved threads are excluded to save context). Use this to understand what reviewers are asking for before addressing PR feedback.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Session name with a linked pull request."
            }
          },
          required: ["session_name"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_get_pr_feedback
      },
      {
        name: "lucode_draft_start",
        description: `Start an AI agent from an existing spec. This creates the session's worktree from the chosen base_branch, launches the selected agent with the spec content as its prompt, and moves the session to running state. Once started, you must use lucode_convert_to_spec if you later need to re-draft.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to start"
            },
            agent_type: {
            type: "string",
            enum: ["claude", "opencode", "gemini", "codex", "qwen", "droid", "amp", "kilocode"],
            description: "AI agent type to use (default: claude)"
            },
            base_branch: {
              type: "string",
              description: "Override base branch if needed"
            },
            preset: {
              type: "string",
              description: "Preset id or name to expand into one or more launch slots. Mutually exclusive with agent_type."
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_draft_start
      },
      {
        name: "lucode_draft_list",
        description: `List all spec sessions in chronological order. Default output is human readable; set json: true for machine parsing with content length and timestamps so you can pick the right draft to start next.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return as JSON for programmatic access (default: false)",
              default: false
            }
          },
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_draft_list
      },
      {
        name: "lucode_draft_delete",
        description: `Delete a spec record permanently (specs have no worktree, but the draft content is lost). Use only for obsolete plans and confirm with the user when unsure.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to delete"
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_draft_delete
      },
      {
        name: "lucode_promote",
        description: `Promote a winning session version and automatically clean up its siblings. Use this after consolidating the best changes into one session and provide a concise reason describing why it won. When promoting a consolidation session, pass winner_session_id so the consolidated result is transplanted onto the winning source version's branch — the winner survives, the losing source versions are cancelled, and the consolidation session remains open for manual review and cleanup after promote returns.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the session being promoted. When promoting a consolidation session, pass that session's name here."
            },
            reason: {
              type: "string",
              description: "Required justification for why this session was promoted."
            },
            winner_session_id: {
              type: "string",
              description: "Optional. When session_name is a consolidation session, pass the session ID of the source version chosen as the strongest base. The consolidation commits will be transplanted onto that winner's branch, the winner session survives, the losing source versions are cancelled, and the consolidation session remains open for manual review and cleanup."
            }
          },
          required: ["session_name", "reason"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_promote
      },
      {
        name: "lucode_consolidation_report",
        description: `Persist the durable consolidation report for a candidate or judge session. Candidate sessions must file a report and base_session_id when they finish. Judge sessions must file a report and recommended_session_id instead of calling lucode_promote directly. Filing the final candidate report may auto-trigger the judge; filing a judge report may auto-promote when the round is configured for auto-promote mode.`,
        inputSchema: {
          type: 'object',
          properties: {
            session_name: { type: 'string', description: 'Consolidation candidate or judge session name.' },
            report: { type: 'string', description: 'Structured consolidation report to persist.' },
            base_session_id: { type: 'string', description: 'Candidate only. Source session ID or name chosen as the conceptual base.' },
            recommended_session_id: { type: 'string', description: 'Judge only. Candidate session ID or name recommended as the round winner.' },
          },
          required: ['session_name', 'report'],
          additionalProperties: false,
        },
        outputSchema: toolOutputSchemas.lucode_consolidation_report,
      },
      {
        name: "lucode_trigger_consolidation_judge",
        description: `Launch a judge session for an existing consolidation round. By default the judge waits until all candidates have filed reports; set early: true to force an early or repeat judging pass before confirmation.`,
        inputSchema: {
          type: 'object',
          properties: {
            round_id: { type: 'string', description: 'Consolidation round ID.' },
            early: { type: 'boolean', description: 'Allow judge launch before every candidate has reported.' },
          },
          required: ['round_id'],
          additionalProperties: false,
        },
        outputSchema: toolOutputSchemas.lucode_trigger_consolidation_judge,
      },
      {
        name: "lucode_confirm_consolidation_winner",
        description: `Confirm or override the winner for a consolidation round. This promotes the chosen candidate through Lucode's existing promotion pipeline and cancels the losing candidate sessions afterward.`,
        inputSchema: {
          type: 'object',
          properties: {
            round_id: { type: 'string', description: 'Consolidation round ID.' },
            winner_session_id: { type: 'string', description: 'Candidate session ID or name to confirm as the winner.' },
            override_reason: { type: 'string', description: 'Optional user override reason to store as the promotion reason.' },
          },
          required: ['round_id', 'winner_session_id'],
          additionalProperties: false,
        },
        outputSchema: toolOutputSchemas.lucode_confirm_consolidation_winner,
      },
      {
        name: "lucode_convert_to_spec",
        description: `Convert a running session back into a spec for rework. The worktree is removed but the branch and commits remain, so you can refine the plan and restart it with lucode_draft_start.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the running session to convert back to spec"
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_convert_to_spec
      },
      {
        name: "lucode_merge_session",
        description: `Merge a running session back onto its parent branch using the same pipeline as the desktop app. Run this after the session is clean and tests are green. ready_to_merge highlights clean sessions, but merge still rechecks Git state. Optional parameters select the merge mode (squash or reapply), supply the squash commit_message, and request cancel_after_merge to queue worktree cleanup. The tool rejects spec sessions, unresolved conflicts, and empty merges, and it never runs tests for you.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Running session to merge back into its parent branch."
            },
            commit_message: {
              type: "string",
              description: "Commit message for the squash merge commit; include the session slug and a concise summary. Required when mode is 'squash'."
            },
            mode: {
              type: "string",
              enum: ["squash", "reapply"],
              description: "Merge strategy. Defaults to 'squash' for a single review commit."
            },
            cancel_after_merge: {
              type: "boolean",
              description: "Queue session cancellation after a successful merge (default false)."
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_merge_session
      },
      {
        name: "lucode_create_pr",
        description: `Open a pull request modal in the Lucode UI for user review and confirmation. The modal is pre-filled with the provided title, body, and branch options. The user can review, edit, and confirm to create the PR. This tool does NOT create the PR directly - it requires user confirmation via the UI. Works for running sessions. Spec sessions are not eligible for PR creation.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Running session to open the PR modal for."
            },
            pr_title: {
              type: "string",
              description: "Suggested pull request title (user can edit before confirming)."
            },
            pr_body: {
              type: "string",
              description: "Suggested pull request description/body (user can edit before confirming)."
            },
            base_branch: {
              type: "string",
              description: "Suggested base branch to open the PR against (defaults to the session parent branch)."
            },
            pr_branch_name: {
              type: "string",
              description: "Suggested remote branch name to push and use as PR head (defaults to the session's branch name)."
            },
            mode: {
              type: "string",
              enum: ["squash", "reapply"],
              description: "Suggested preparation strategy: 'squash' creates a single commit for the PR; 'reapply' preserves commits. Defaults to 'reapply'."
            },
            commit_message: {
              type: "string",
              description: "Suggested commit message used for squash mode. Defaults to pr_title when omitted."
            },
            repository: {
              type: "string",
              description: "Target GitHub repository in owner/name form if it differs from the connected repo."
            },
            cancel_after_pr: {
              type: "boolean",
              description: "Queue session cancellation after the PR is created (default false). Applied when user confirms."
            }
          },
          required: ["session_name", "pr_title"]
        },
        outputSchema: toolOutputSchemas.lucode_create_pr
      },
      {
        name: "lucode_link_pr",
        description: "Link an existing GitHub pull request to a running session",
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Running session whose PR metadata should be updated."
            },
            pr_number: {
              type: "number",
              description: "GitHub pull request number. Provide together with pr_url to link a PR."
            },
            pr_url: {
              type: "string",
              description: "GitHub pull request URL. Provide together with pr_number to link a PR. Omit both fields to unlink."
            }
          },
          required: ["session_name"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_link_pr
      },
      {
        name: "lucode_create_epic",
        description: `Create a named epic to group related sessions and specs. Provide a unique name and optional color. Epics help organize work into logical units.`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Epic name (alphanumeric, hyphens, underscores)"
            },
            color: {
              type: "string",
              description: "Optional color for the epic (e.g. '#FF5733')"
            }
          },
          required: ["name"],
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_create_epic
      },
      {
        name: "lucode_list_epics",
        description: `List all epics in the current project. Returns each epic's id, name, and optional color.`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_list_epics
      },
      {
        name: "lucode_prepare_merge",
        description: `Open a merge modal in the Lucode UI for user review and confirmation. The modal is pre-filled with the provided commit message and merge mode. The user can review, edit, and confirm to merge. This tool does NOT merge directly - it requires user confirmation via the UI. Works for running sessions. Spec sessions are not eligible for merging.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Running session to open the merge modal for."
            },
            commit_message: {
              type: "string",
              description: "Suggested commit message for squash merge mode (user can edit before confirming)."
            },
            mode: {
              type: "string",
              enum: ["squash", "reapply"],
              description: "Suggested merge strategy: 'squash' creates a single commit; 'reapply' preserves individual commits. Defaults to 'squash'."
            }
          },
          required: ["session_name"]
        },
        outputSchema: toolOutputSchemas.lucode_prepare_merge
      },
      {
        name: "lucode_get_current_tasks",
        description: `Return the active Lucode agents with controllable verbosity. Use fields to request only the properties you need (defaults to a minimal set), status_filter to limit by session state, and content_preview_length to trim large text when including draft_content or initial_prompt. Helpful for keeping responses lightweight while still exposing full session metadata on demand.`,
        inputSchema: {
          type: "object",
          properties: {
            fields: {
              type: "array",
              items: {
                type: "string",
                enum: ["name", "display_name", "status", "session_state", "created_at", "last_activity", "branch", "worktree_path", "ready_to_merge", "initial_prompt", "draft_content", "all"]
              },
              description: "Fields to include in response. Defaults to ['name', 'status', 'session_state', 'branch']. Use 'all' for complete data.",
              default: ["name", "status", "session_state", "branch"]
            },
            status_filter: {
              type: "string",
              enum: ["spec", "active", "ready", "all"],
              description: "Filter agents by status. 'ready' shows ready_to_merge sessions.",
              default: "all"
            },
            content_preview_length: {
              type: "number",
              description: "When including draft_content or initial_prompt, limit to this many characters (default: no limit)",
              minimum: 0
            }
          },
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_get_current_tasks
      },
      {
        name: "lucode_run_script",
        description: `Execute the project's configured run script (the command triggered by Cmd+E in the UI). Returns the command output. Fails if no run script is configured for the project.`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: toolOutputSchemas.lucode_run_script
      }
  ]

  const projectPathProperty = {
    project_path: {
      type: "string",
      description: "Optional absolute path to the project root. Use this to target a specific project when multiple projects are open."
    }
  }

  // Emit a flat tool definition that works with legacy Codex and modern MCP,
  // keeping both camelCase and snake_case schema keys.
  // Auto-enrich every tool schema with project_path for multi-project routing.
  const normalizedTools = tools.map(tool => {
    const enrichedSchema = {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema.properties ?? {}),
        ...projectPathProperty
      }
    }
    return {
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      inputSchema: enrichedSchema,
      outputSchema: tool.outputSchema,
      input_schema: enrichedSchema,
      output_schema: tool.outputSchema,
    }
  })

  return { tools: normalizedTools }
})

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params
  const projectPath = (args as Record<string, unknown> | undefined)?.project_path as string | undefined

  try {
    let response: StructuredResponse

    switch (name) {
      case "lucode_spec_list": {
        const payload = await bridge.listSpecSummaries(projectPath)
        const structured = { specs: payload.map(sanitizeSpecSummary) }
        response = buildStructuredResponse(structured, {
          summaryText: `Spec summaries returned (${payload.length})`,
          jsonFirst: true
        })
        break
      }

      case "lucode_spec_read": {
        const specArgs = args as { session?: string }
        if (!specArgs.session || specArgs.session.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session' is required when invoking lucode_spec_read.")
        }
        const specDoc = await bridge.getSpecDocument(specArgs.session, projectPath)
        if (!specDoc) {
          throw new McpError(ErrorCode.InternalError, `Spec document not found for session '${specArgs.session}'.`)
        }
        const payload = sanitizeSpecDocument(specDoc)
        response = buildStructuredResponse(payload, {
          summaryText: `Spec '${specArgs.session}' loaded`,
          jsonFirst: true
        })
        break
      }

      case "lucode_spec_set_stage": {
        const specArgs = args as { session_name?: string; stage?: SpecStage }
        if (!specArgs.session_name || specArgs.session_name.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session_name' is required when invoking lucode_spec_set_stage.")
        }
        if (!specArgs.stage) {
          throw new McpError(ErrorCode.InvalidParams, "'stage' is required when invoking lucode_spec_set_stage.")
        }

        const updated = await bridge.setSpecStage(specArgs.session_name, specArgs.stage, projectPath)
        const payload = sanitizeSpecStage(updated)
        response = buildStructuredResponse(payload, {
          summaryText: `Spec '${specArgs.session_name}' moved to ${specArgs.stage}`,
          jsonFirst: true
        })
        break
      }

      case "lucode_spec_set_attention": {
        const attentionArgs = args as { session_name?: string; attention_required?: boolean }
        if (!attentionArgs.session_name || attentionArgs.session_name.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session_name' is required when invoking lucode_spec_set_attention.")
        }
        if (typeof attentionArgs.attention_required !== 'boolean') {
          throw new McpError(ErrorCode.InvalidParams, "'attention_required' is required when invoking lucode_spec_set_attention.")
        }

        const updated = await bridge.setSpecAttention(
          attentionArgs.session_name,
          attentionArgs.attention_required,
          projectPath,
        )
        const payload = sanitizeSpecAttention(updated)
        response = buildStructuredResponse(payload, {
          summaryText: `Spec '${attentionArgs.session_name}' attention_required set to ${attentionArgs.attention_required}`,
          jsonFirst: true
        })
        break
      }

      case "lucode_improve_plan": {
        const improveArgs = args as Partial<LucodeImprovePlanArgs>
        if (!improveArgs.session_name || improveArgs.session_name.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session_name' is required when invoking lucode_improve_plan.")
        }

        const result = await bridge.startImprovePlanRound(
          improveArgs.session_name,
          {
            candidateCount: improveArgs.candidate_count,
            agentType: improveArgs.agent_type,
            baseBranch: improveArgs.base_branch,
          },
          projectPath,
        )
        response = buildStructuredResponse(result, {
          summaryText: `Started improve-plan round '${result.round_id}' for spec '${result.spec}' with ${result.candidate_sessions.length} candidate session(s).`,
          jsonFirst: true
        })
        break
      }

      case "lucode_diff_summary": {
        const diffArgs = args as { session?: string; cursor?: string; page_size?: number }
        const diffSummary = await bridge.getDiffSummary({
          session: diffArgs.session,
          cursor: diffArgs.cursor,
          pageSize: diffArgs.page_size,
          projectPath,
        })
        if (!diffSummary) {
          throw new McpError(ErrorCode.InternalError, "Diff summary payload missing from bridge.")
        }
        const payload = sanitizeDiffSummary(diffSummary)
        response = buildStructuredResponse(payload, {
          summaryText: `Diff summary ready for ${diffArgs.session ?? 'orchestrator'}`,
          jsonFirst: true
        })
        break
      }

      case "lucode_diff_chunk": {
        const diffArgs = args as { session?: string; path?: string; cursor?: string; line_limit?: number }
        if (!diffArgs.path || diffArgs.path.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'path' is required when invoking lucode_diff_chunk.")
        }

        const cappedLineLimit = diffArgs.line_limit !== undefined
          ? Math.min(diffArgs.line_limit, 1000)
          : undefined

        const diffChunk = await bridge.getDiffChunk({
          session: diffArgs.session,
          path: diffArgs.path,
          cursor: diffArgs.cursor,
          lineLimit: cappedLineLimit,
          projectPath,
        })
        if (!diffChunk) {
          throw new McpError(ErrorCode.InternalError, "Diff chunk payload missing from bridge.")
        }
        const payload = sanitizeDiffChunk(diffChunk)
        response = buildStructuredResponse(payload, {
          summaryText: `Diff chunk for ${diffArgs.path}`,
          jsonFirst: true
        })
        break
      }

      case "lucode_session_spec": {
        const specArgs = args as { session: string }
        if (!specArgs.session || specArgs.session.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session' is required when invoking lucode_session_spec.")
        }
        const specPayload = await bridge.getSessionSpec(specArgs.session, projectPath)
        if (!specPayload) {
          throw new McpError(ErrorCode.InternalError, `Session spec not found for '${specArgs.session}'.`)
        }
        const payload = sanitizeSessionSpec(specPayload)
        response = buildStructuredResponse(payload, {
          summaryText: `Session spec '${specArgs.session}' fetched`,
          jsonFirst: true
        })
        break
      }

      case "lucode_get_pr_feedback": {
        const feedbackArgs = args as { session_name?: string }
        if (!feedbackArgs.session_name || feedbackArgs.session_name.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session_name' is required when invoking lucode_get_pr_feedback.")
        }

        const feedback = await bridge.getPrFeedback(feedbackArgs.session_name, projectPath)
        const payload = sanitizePrFeedback(feedback)
        const failingChecks = payload.status_checks.filter(check => isFailingConclusion(check.conclusion)).length
        const pendingChecks = payload.status_checks.filter(check => isPendingCheck(check.status, check.conclusion)).length
        const draftLabel = payload.is_draft ? ' (draft)' : ''
        const decision = payload.review_decision
          ? payload.review_decision.toLowerCase().replace(/_/g, ' ')
          : 'none'
        const summaryLines = [
          `PR state: ${payload.state}${draftLabel}`,
          `Review decision: ${decision}`,
          `Unresolved threads: ${payload.unresolved_threads.length}`,
          `Resolved threads: ${payload.resolved_thread_count}`,
          `Failing checks: ${failingChecks}`,
          `Pending checks: ${pendingChecks}`,
        ]
        const summary = summaryLines.join('\n')

        response = buildStructuredResponse(payload, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_create": {
        const createArgs = args as LucodeStartArgs

        if (createArgs.preset && createArgs.is_draft) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'preset' is not supported when invoking lucode_create with is_draft=true."
          )
        }

        if (createArgs.preset && createArgs.agent_type) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'preset' is mutually exclusive with 'agent_type'."
          )
        }

        if (createArgs.is_draft) {
          const session = await bridge.createSpecSession(
            createArgs.name || `draft_${Date.now()}`,
            createArgs.draft_content || createArgs.prompt,
            createArgs.base_branch,
            createArgs.epic_id,
            projectPath
          )

          const contentLength = session.draft_content?.length || session.spec_content?.length || 0
          const structured = {
            type: "spec",
            status: "created",
            session: {
              name: session.name,
              branch: session.branch,
              parent_branch: session.parent_branch,
              worktree_path: session.worktree_path || null,
              content_length: contentLength
            }
          }

          const summary = `Spec session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${contentLength} characters
- Status: Spec (ready for refinement)`

          response = buildStructuredResponse(structured, { summaryText: summary })
        } else {
          const session = await bridge.createSession(
            createArgs.name || `mcp_session_${Date.now()}`,
            createArgs.prompt,
            createArgs.base_branch,
            createArgs.use_existing_branch,
            createArgs.agent_type,
            createArgs.epic_id,
            projectPath,
            createArgs.preset
          )

          if (isPresetLaunchResult(session)) {
            const summary = `Preset '${session.preset.name}' launched ${session.sessions.length} session(s) (version_group_id: ${session.version_group_id}):
${session.sessions
  .map(
    (created) =>
      `- ${created.name} (agent: ${created.agent_type}, branch: ${created.branch}, version: ${created.version_number})`
  )
  .join('\n')}`
            response = buildStructuredResponse(session, { summaryText: summary })
            break
          }

          const structured = {
            type: "session",
            status: "created",
            session: {
              name: session.name,
              branch: session.branch,
              worktree_path: session.worktree_path,
              parent_branch: session.parent_branch,
              agent_type: createArgs.agent_type || DEFAULT_AGENT,
              ready_to_merge: session.ready_to_merge ?? false
            }
          }

          const summary = `Session created successfully:
- Name: ${session.name}
- Branch: ${session.branch}
- Worktree: ${session.worktree_path}
- Agent: ${createArgs.agent_type || DEFAULT_AGENT}
- Base Branch: ${session.parent_branch}
${session.initial_prompt ? `- Initial Prompt: ${session.initial_prompt}` : ''}`

          response = buildStructuredResponse(structured, { summaryText: summary })
        }
        break
      }

      case "lucode_get_setup_script": {
        const payload = await bridge.getProjectSetupScript(projectPath)
        const summary = payload.has_setup_script
          ? `Setup script present (${payload.setup_script.length} chars)`
          : 'No setup script configured'

        response = buildStructuredResponse(payload, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_set_setup_script": {
        const setupArgs = args as LucodeSetSetupScriptArgs | undefined
        const script = setupArgs?.setup_script
        if (script === undefined || script === null) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'setup_script' is required when invoking lucode_set_setup_script (empty string clears it)."
          )
        }

        const payload = await bridge.setProjectSetupScript(script, projectPath)
        const summary = `Setup script updated (${payload.setup_script.length} chars)`
        response = buildStructuredResponse(payload, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_get_worktree_base_directory": {
        const payload = await bridge.getWorktreeBaseDirectory(projectPath)
        const summary = payload.has_custom_directory
          ? `Custom worktree directory: ${payload.worktree_base_directory}`
          : 'Using default worktree directory (.lucode/worktrees/)'

        response = buildStructuredResponse(payload, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_set_worktree_base_directory": {
        const wbdArgs = args as LucodeSetWorktreeBaseDirectoryArgs | undefined
        const dir = wbdArgs?.worktree_base_directory
        if (dir === undefined || dir === null) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'worktree_base_directory' is required when invoking lucode_set_worktree_base_directory (empty string clears it)."
          )
        }

        const payload = await bridge.setWorktreeBaseDirectory(dir, projectPath)
        const summary = payload.has_custom_directory
          ? `Worktree base directory set to: ${payload.worktree_base_directory}`
          : 'Worktree base directory cleared (using default)'
        response = buildStructuredResponse(payload, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_list": {
        const listArgs = args as LucodeListArgs

        const sessions = await bridge.listSessionsByState(listArgs.filter, projectPath)

        const structuredSessions = sessions.map(s => ({
          name: s.name,
          display_name: s.display_name || s.name,
          status: s.status === 'spec' ? 'spec' : (s.ready_to_merge ? 'ready' : 'active'),
          session_state: s.session_state || null,
          ready_to_merge: s.ready_to_merge || false,
          created_at: s.created_at && !isNaN(new Date(s.created_at).getTime()) ? new Date(s.created_at).toISOString() : null,
          last_activity: s.last_activity && !isNaN(new Date(s.last_activity).getTime()) ? new Date(s.last_activity).toISOString() : null,
          agent_type: s.original_agent_type || DEFAULT_AGENT,
          branch: s.branch || null,
          worktree_path: s.worktree_path || null,
          initial_prompt: s.initial_prompt || null,
          draft_content: s.draft_content || null
        }))

        const jsonPayload = jsonArrayCompatEnabled() ? structuredSessions : { sessions: structuredSessions }

        let summary: string
        if (sessions.length === 0) {
          summary = 'No sessions found'
        } else if (listArgs.json) {
          summary = `Sessions (${sessions.length}) returned`
        } else {
          const lines = sessions.map((s: Session) => {
            if (s.status === 'spec') {
              const created = s.created_at && !isNaN(new Date(s.created_at).getTime()) ? new Date(s.created_at).toLocaleDateString() : 'unknown'
              const contentLength = s.draft_content?.length || 0
              const nameLabel = s.display_name || s.name
              return `[PLAN] ${nameLabel} - Created: ${created}, Content: ${contentLength} chars`
            } else {
              const stateLabel = s.ready_to_merge ? '[READY]' : '[ACTIVE]'
              const agent = s.original_agent_type || 'unknown'
              const modified = s.last_activity && !isNaN(new Date(s.last_activity).getTime()) ? new Date(s.last_activity).toLocaleString() : 'never'
              const nameLabel = s.display_name || s.name
              return `${stateLabel} ${nameLabel} - Agent: ${agent}, Modified: ${modified}`
            }
          })

          const filterLabel = listArgs.filter ? ` (${listArgs.filter})` : ''
          summary = `Sessions${filterLabel} (${sessions.length}):\n${lines.join('\n')}`
        }

        response = buildStructuredResponse(jsonPayload, {
          summaryText: summary,
          jsonFirst: listArgs.json ?? false
        })
        break
      }

      case "lucode_send_message": {
        const sendMessageArgs = args as unknown as LucodeSendMessageArgs

        await bridge.sendFollowUpMessage(
          sendMessageArgs.session_name,
          sendMessageArgs.message,
          projectPath
        )

        const structured = {
          session: sendMessageArgs.session_name,
          status: "sent",
          message: sendMessageArgs.message
        }

        const summary = `Message sent to session '${sendMessageArgs.session_name}': ${sendMessageArgs.message}`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_cancel": {
        const cancelArgs = args as unknown as LucodeCancelArgs

        await bridge.cancelSession(cancelArgs.session_name, cancelArgs.force, projectPath)

        const structured = {
          session: cancelArgs.session_name,
          cancelled: true,
          force: cancelArgs.force ?? false
        }

        const summary = `Session '${cancelArgs.session_name}' has been cancelled and removed`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_spec_create": {
        const specCreateArgs = args as LucodeSpecCreateArgs

        if (specCreateArgs.preset) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'preset' is not supported for spec creation; apply a preset via lucode_draft_start when the spec is ready to launch."
          )
        }

        const session = await bridge.createSpecSession(
          specCreateArgs.name || `spec_${Date.now()}`,
          specCreateArgs.content,
          specCreateArgs.base_branch,
          specCreateArgs.epic_id,
          projectPath
        )

        const contentLength = session.spec_content?.length || session.draft_content?.length || 0
        const structured = {
          type: "spec",
          status: "created",
          session: {
            name: session.name,
            branch: session.branch,
            parent_branch: session.parent_branch,
            content_length: contentLength
          }
        }

        const summary = `Spec session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${contentLength} characters
- Status: Spec (ready for refinement)`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_draft_update": {
        const draftUpdateArgs = args as unknown as LucodeDraftUpdateArgs

        await bridge.updateDraftContent(
          draftUpdateArgs.session_name,
          draftUpdateArgs.content,
          draftUpdateArgs.append,
          projectPath
        )

        const contentPreview = draftUpdateArgs.content.length > 100
          ? draftUpdateArgs.content.substring(0, 100) + '...'
          : draftUpdateArgs.content

        const structured = {
          session: draftUpdateArgs.session_name,
          updated: true,
          append: draftUpdateArgs.append ?? false,
          content_length: draftUpdateArgs.content.length,
          content_preview: contentPreview
        }

        const summary = `Spec '${draftUpdateArgs.session_name}' updated successfully.
- Update Mode: ${draftUpdateArgs.append ? 'Append' : 'Replace'}
- Content Preview: ${contentPreview}`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_draft_start": {
        const draftStartArgs = args as unknown as LucodeDraftStartArgs

        if (draftStartArgs.preset && draftStartArgs.agent_type) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "'preset' is mutually exclusive with 'agent_type'."
          )
        }

        const startResult = await bridge.startDraftSession(
          draftStartArgs.session_name,
          draftStartArgs.agent_type,
          draftStartArgs.base_branch,
          projectPath,
          draftStartArgs.preset
        )

        if (startResult && isPresetLaunchResult(startResult)) {
          const presetStart = startResult as PresetDraftStartResult
          const archiveStatus = presetStart.archived_spec
            ? ' (source spec archived)'
            : ' (⚠ source spec archival failed — spec still active)'
          const summary = `Preset '${presetStart.preset.name}' started ${presetStart.sessions.length} session(s) from spec '${presetStart.source_spec}'${archiveStatus} (version_group_id: ${presetStart.version_group_id}):
${presetStart.sessions
  .map(
    (created) =>
      `- ${created.name} (agent: ${created.agent_type}, branch: ${created.branch}, version: ${created.version_number})`
  )
  .join('\n')}`
          response = buildStructuredResponse(presetStart, { summaryText: summary })
          break
        }

        const structured = {
          session: draftStartArgs.session_name,
          started: true,
          agent_type: draftStartArgs.agent_type || DEFAULT_AGENT,
          base_branch: draftStartArgs.base_branch || null
        }

        const summary = `Spec '${draftStartArgs.session_name}' started successfully:
- Agent Type: ${draftStartArgs.agent_type || DEFAULT_AGENT}
- Status: Active (worktree created, agent ready)`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_draft_list": {
        const draftListArgs = args as LucodeDraftListArgs

        const specs = await bridge.listDraftSessions(projectPath)

        const essentialDrafts = specs.map(d => ({
          name: d.name,
          display_name: d.display_name || d.name,
          created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
          updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
          base_branch: d.parent_branch || null,
          content_length: d.draft_content?.length || 0,
          content_preview: d.draft_content?.substring(0, 200) || ''
        }))

        let summary: string
        if (specs.length === 0) {
          summary = 'No spec sessions found'
        } else if (draftListArgs.json) {
          summary = `Spec sessions returned (${specs.length})`
        } else {
          const lines = specs.map((d: Session) => {
            const nameLabel = d.display_name || d.name
            const created = d.created_at ? new Date(d.created_at).toLocaleDateString() : 'unknown'
            const updated = d.updated_at ? new Date(d.updated_at).toLocaleDateString() : 'unknown'
            const contentLength = d.draft_content?.length || 0
            const preview = d.draft_content?.substring(0, 50)?.replace(/\n/g, ' ') || '(empty)'

            return `${nameLabel}:
  - Created: ${created}, Updated: ${updated}
  - Content: ${contentLength} chars
  - Preview: ${preview}${contentLength > 50 ? '...' : ''}`
          })

          summary = `Spec Sessions (${specs.length}):\n\n${lines.join('\n\n')}`
        }

        response = buildStructuredResponse({ specs: essentialDrafts }, {
          summaryText: summary,
          jsonFirst: draftListArgs.json ?? false
        })
        break
      }

      case "lucode_draft_delete": {
        const draftDeleteArgs = args as unknown as LucodeDraftDeleteArgs

        await bridge.deleteDraftSession(draftDeleteArgs.session_name, projectPath)

        const structured = { session: draftDeleteArgs.session_name, deleted: true }
        const summary = `Spec session '${draftDeleteArgs.session_name}' has been deleted permanently`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_get_current_tasks": {
        const taskArgs = args as {
          fields?: string[],
          status_filter?: 'spec' | 'active' | 'ready' | 'all',
          content_preview_length?: number
        }

        const requestedFields = taskArgs.fields || ['name', 'status', 'session_state', 'branch']
        const includeAll = requestedFields.includes('all')

        let agents = await bridge.getCurrentTasks(projectPath)

        if (taskArgs.status_filter && taskArgs.status_filter !== 'all') {
          agents = agents.filter(t => {
            switch (taskArgs.status_filter) {
              case 'spec':
                return t.status === 'spec'
              case 'active':
                return t.status !== 'spec' && !t.ready_to_merge
              case 'ready':
                return t.ready_to_merge === true
              default:
                return true
            }
          })
        }

        const formattedTasks = agents.map(t => {
          const agent: Record<string, unknown> = {
            name: t.name
          }

          if (includeAll || requestedFields.includes('display_name')) {
            agent.display_name = t.display_name || t.name
          }
          if (includeAll || requestedFields.includes('status')) {
            agent.status = t.status
          }
          if (includeAll || requestedFields.includes('session_state')) {
            agent.session_state = t.session_state
          }
          if (includeAll || requestedFields.includes('created_at')) {
            agent.created_at = t.created_at ? new Date(t.created_at).toISOString() : null
          }
          if (includeAll || requestedFields.includes('last_activity')) {
            agent.last_activity = t.last_activity ? new Date(t.last_activity).toISOString() : null
          }
          if (includeAll || requestedFields.includes('branch')) {
            agent.branch = t.branch
          }
          if (includeAll || requestedFields.includes('worktree_path')) {
            agent.worktree_path = t.worktree_path
          }
          if (includeAll || requestedFields.includes('ready_to_merge')) {
            agent.ready_to_merge = t.ready_to_merge || false
          }
          if (includeAll || requestedFields.includes('agent_type')) {
            agent.agent_type = t.original_agent_type || DEFAULT_AGENT
          }
          if (includeAll || requestedFields.includes('epic_id')) {
            agent.epic_id = t.epic_id ?? null
          }

          if (includeAll || requestedFields.includes('initial_prompt')) {
            let prompt = t.initial_prompt || null
            if (prompt && taskArgs.content_preview_length && prompt.length > taskArgs.content_preview_length) {
              prompt = prompt.substring(0, taskArgs.content_preview_length) + '...'
            }
            agent.initial_prompt = prompt
          }

          if (includeAll || requestedFields.includes('draft_content')) {
            let content = t.draft_content || null
            if (content && taskArgs.content_preview_length && content.length > taskArgs.content_preview_length) {
              content = content.substring(0, taskArgs.content_preview_length) + '...'
            }
            agent.draft_content = content
          }

          return agent
        })

        const jsonPayload = jsonArrayCompatEnabled() ? formattedTasks : { tasks: formattedTasks }

        response = buildStructuredResponse(jsonPayload, {
          summaryText: `Current tasks returned (${formattedTasks.length})`,
          jsonFirst: true
        })
        break
       }

      case "lucode_promote": {
        const promoteArgs = args as unknown as LucodePromoteArgs

        if (!promoteArgs.session_name || typeof promoteArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_promote.')
        }
        if (!promoteArgs.reason || typeof promoteArgs.reason !== 'string' || promoteArgs.reason.trim().length === 0) {
          throw new Error('reason is required when invoking lucode_promote.')
        }
        if (promoteArgs.winner_session_id !== undefined && promoteArgs.winner_session_id !== null) {
          if (typeof promoteArgs.winner_session_id !== 'string' || promoteArgs.winner_session_id.trim().length === 0) {
            throw new Error('winner_session_id must be a non-empty string when provided.')
          }
        }

        const promoteResult = await bridge.promoteSession(
          promoteArgs.session_name,
          promoteArgs.reason,
          {
            winnerSessionId: promoteArgs.winner_session_id ?? undefined,
            projectPath,
          }
        )

        const structured = {
          session: promoteResult.sessionName,
          siblings_cancelled: promoteResult.siblingsCancelled,
          reason: promoteResult.reason,
          failures: promoteResult.failures,
        }
        const cancelledList = promoteResult.siblingsCancelled.length > 0
          ? promoteResult.siblingsCancelled.join(', ')
          : 'none'
        const failureNote = promoteResult.failures.length > 0
          ? `\n- Failures: ${promoteResult.failures.join(', ')}`
          : ''
        const summary = `Session '${promoteResult.sessionName}' promoted. Reason: ${promoteResult.reason}\n- Siblings cancelled: ${cancelledList}${failureNote}`
        response = buildStructuredResponse(structured, { summaryText: summary, jsonFirst: true })
        break
      }

      case "lucode_consolidation_report": {
        const reportArgs = args as unknown as LucodeConsolidationReportArgs
        if (!reportArgs.session_name || typeof reportArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_consolidation_report.')
        }
        if (!reportArgs.report || typeof reportArgs.report !== 'string' || reportArgs.report.trim().length === 0) {
          throw new Error('report is required when invoking lucode_consolidation_report.')
        }

        const result = await bridge.updateConsolidationReport(reportArgs.session_name, reportArgs.report, {
          baseSessionId: reportArgs.base_session_id ?? undefined,
          recommendedSessionId: reportArgs.recommended_session_id ?? undefined,
          projectPath,
        })

        const structured = {
          session: result.sessionName,
          round_id: result.roundId,
          role: result.role,
          auto_judge_triggered: result.autoJudgeTriggered,
          auto_promoted: result.autoPromoted,
        }
        response = buildStructuredResponse(structured, {
          summaryText: `Stored consolidation report for '${result.sessionName}' (${result.role}). Auto judge: ${result.autoJudgeTriggered ? 'yes' : 'no'}. Auto promote: ${result.autoPromoted ? 'yes' : 'no'}.`,
          jsonFirst: true,
        })
        break
      }

      case "lucode_trigger_consolidation_judge": {
        const judgeArgs = args as unknown as LucodeTriggerConsolidationJudgeArgs
        if (!judgeArgs.round_id || typeof judgeArgs.round_id !== 'string') {
          throw new Error('round_id is required when invoking lucode_trigger_consolidation_judge.')
        }

        const result = await bridge.triggerConsolidationJudge(judgeArgs.round_id, {
          early: judgeArgs.early,
          projectPath,
        })

        const structured = {
          round_id: result.roundId,
          judge_session: result.judgeSessionName,
        }
        response = buildStructuredResponse(structured, {
          summaryText: `Started consolidation judge '${result.judgeSessionName}' for round '${result.roundId}'.`,
          jsonFirst: true,
        })
        break
      }

      case "lucode_confirm_consolidation_winner": {
        const confirmArgs = args as unknown as LucodeConfirmConsolidationWinnerArgs
        if (!confirmArgs.round_id || typeof confirmArgs.round_id !== 'string') {
          throw new Error('round_id is required when invoking lucode_confirm_consolidation_winner.')
        }
        if (!confirmArgs.winner_session_id || typeof confirmArgs.winner_session_id !== 'string') {
          throw new Error('winner_session_id is required when invoking lucode_confirm_consolidation_winner.')
        }

        const result = await bridge.confirmConsolidationWinner(confirmArgs.round_id, confirmArgs.winner_session_id, {
          overrideReason: confirmArgs.override_reason ?? undefined,
          projectPath,
        })

        const structured = {
          round_id: result.roundId,
          winner_session: result.winnerSessionName,
          promoted_session: result.promotedSessionName,
          candidate_sessions_cancelled: result.candidateSessionsCancelled,
          source_sessions_cancelled: result.sourceSessionsCancelled,
          judge_sessions_cancelled: result.judgeSessionsCancelled,
        }
        response = buildStructuredResponse(structured, {
          summaryText: `Confirmed consolidation winner '${result.winnerSessionName}' for round '${result.roundId}'. Promoted session: '${result.promotedSessionName}'.`,
          jsonFirst: true,
        })
        break
      }

      case "lucode_convert_to_spec": {
        const convertToSpecArgs = args as unknown as LucodeConvertToSpecArgs

        await bridge.convertToSpec(convertToSpecArgs.session_name, projectPath)

        const structured = { session: convertToSpecArgs.session_name, converted: true }
        const summary = `Session '${convertToSpecArgs.session_name}' has been converted back to spec state for rework`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_merge_session": {
        const mergeArgs = args as unknown as LucodeMergeArgs

        if (!mergeArgs.session_name || typeof mergeArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_merge_session.')
        }

        const requestedMode: MergeModeOption = mergeArgs.mode === 'reapply' ? 'reapply' : 'squash'
        const trimmedCommit = mergeArgs.commit_message?.trim() ?? ''

        if (requestedMode === 'squash' && trimmedCommit.length === 0) {
          throw new Error('commit_message is required and cannot be empty when performing a squash merge via lucode_merge_session.')
        }

        const mergeResult = await bridge.mergeSession(mergeArgs.session_name, {
          commitMessage: trimmedCommit.length > 0 ? trimmedCommit : undefined,
          mode: requestedMode,
          cancelAfterMerge: mergeArgs.cancel_after_merge,
          projectPath
        })

        const structured = {
          session: mergeArgs.session_name,
          merged: true,
          mode: mergeResult.mode,
          parent_branch: mergeResult.parentBranch,
          session_branch: mergeResult.sessionBranch,
          commit: mergeResult.commit,
          cancel_requested: mergeResult.cancelRequested,
          cancel_queued: mergeResult.cancelQueued,
          cancel_error: mergeResult.cancelError ?? null
        }

        const cancelLine = mergeResult.cancelRequested
          ? (mergeResult.cancelQueued
              ? '- Session cancellation queued (cleanup runs asynchronously).'
              : `- Cancellation requested but failed: ${mergeResult.cancelError ?? 'unknown error'}`)
          : '- Session retained (cancel_after_merge=false).'

        const summary = `Merge completed for '${mergeArgs.session_name}':
- Merge mode: ${mergeResult.mode}
- Parent branch: ${mergeResult.parentBranch}
- Session branch: ${mergeResult.sessionBranch}
- Merge commit: ${mergeResult.commit}
${cancelLine}`

        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_create_pr": {
        const prArgs = args as unknown as LucodeCreatePrArgs

        if (!prArgs.session_name || typeof prArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_create_pr.')
        }
        if (!prArgs.pr_title || typeof prArgs.pr_title !== 'string') {
          throw new Error('pr_title is required when invoking lucode_create_pr.')
        }

        const prResult = await bridge.createPullRequest(prArgs.session_name, {
          prTitle: prArgs.pr_title,
          prBody: prArgs.pr_body ?? undefined,
          baseBranch: prArgs.base_branch ?? undefined,
          prBranchName: prArgs.pr_branch_name ?? undefined,
          mode: prArgs.mode,
          commitMessage: prArgs.commit_message ?? undefined,
          repository: prArgs.repository ?? undefined,
          cancelAfterPr: Boolean(prArgs.cancel_after_pr),
          projectPath,
        })

        const structured = {
          session: prArgs.session_name,
          branch: '',
          pr_url: null,
          cancel_requested: false,
          cancel_queued: false,
          cancel_error: null,
          modal_triggered: prResult.modalTriggered ?? false,
        }

        const summary = prResult.modalTriggered
          ? `Pull request modal opened for '${prArgs.session_name}'. The user will review and confirm the PR details in the Lucode UI.`
          : `Failed to open pull request modal for '${prArgs.session_name}'.`

        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_link_pr": {
        const linkArgs = args as unknown as LucodeLinkPrArgs

        if (!linkArgs.session_name || typeof linkArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_link_pr.')
        }

        const hasPrNumber = typeof linkArgs.pr_number === 'number'
        const hasPrUrl = typeof linkArgs.pr_url === 'string' && linkArgs.pr_url.trim().length > 0

        if (hasPrNumber !== hasPrUrl) {
          throw new Error('Provide both pr_number and pr_url to link a PR, or omit both to unlink.')
        }

        const structured = hasPrNumber && hasPrUrl
          ? await bridge.linkSessionToPr(
              linkArgs.session_name,
              linkArgs.pr_number as number,
              linkArgs.pr_url as string,
              projectPath
            )
          : await bridge.unlinkSessionFromPr(linkArgs.session_name, projectPath)

        const summary = structured.linked
          ? `Linked PR #${structured.pr_number} to '${linkArgs.session_name}'.`
          : `Removed linked PR from '${linkArgs.session_name}'.`

        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_create_epic": {
        const epicArgs = args as unknown as LucodeCreateEpicArgs
        if (!epicArgs.name || epicArgs.name.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'name' is required when invoking lucode_create_epic.")
        }

        const epic = await bridge.createEpic(epicArgs.name, epicArgs.color, projectPath)
        const structured = { epic: { id: epic.id, name: epic.name, color: epic.color ?? null } }
        const summary = `Epic '${epic.name}' created (id: ${epic.id})`
        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      case "lucode_list_epics": {
        const epics = await bridge.listEpics(projectPath)
        const structured = { epics: epics.map(e => ({ id: e.id, name: e.name, color: e.color ?? null })) }
        const summary = epics.length === 0
          ? 'No epics found'
          : `Epics (${epics.length}): ${epics.map(e => e.name).join(', ')}`
        response = buildStructuredResponse(structured, { summaryText: summary, jsonFirst: true })
        break
      }

      case "lucode_run_script": {
        const result = await bridge.executeProjectRunScript(projectPath)
        const summary = result.success
          ? `Run script completed successfully (exit code ${result.exit_code}):\n${result.stdout}`
          : `Run script failed (exit code ${result.exit_code}):\n${result.stderr}`
        response = buildStructuredResponse(result, {
          summaryText: summary,
          jsonFirst: true
        })
        break
      }

      case "lucode_prepare_merge": {
        const mergeArgs = args as unknown as LucodePrepareMergeArgs

        if (!mergeArgs.session_name || typeof mergeArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking lucode_prepare_merge.')
        }

        const mergeResult = await bridge.prepareMerge(mergeArgs.session_name, {
          mode: mergeArgs.mode,
          commitMessage: mergeArgs.commit_message ?? undefined,
          projectPath,
        })

        const structured = {
          session: mergeArgs.session_name,
          modal_triggered: mergeResult.modalTriggered,
        }

        const summary = mergeResult.modalTriggered
          ? `Merge modal opened for '${mergeArgs.session_name}'. The user will review and confirm the merge in the Lucode UI.`
          : `Failed to open merge modal for '${mergeArgs.session_name}'.`

        response = buildStructuredResponse(structured, { summaryText: summary })
        break
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }

    return response
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`)
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const workflowResources = listLucodeWorkflows().map(workflow => ({
    uri: workflow.resource_uri,
    name: workflow.title,
    description: workflow.description,
    mimeType: 'text/markdown',
  }))

  return {
    resources: [
      {
        uri: "lucode://skills",
        name: "Lucode Workflows",
        description: "Registry of Lucode workflow resources and native agent entrypoints",
        mimeType: "application/json"
      },
      {
        uri: "lucode://sessions",
        name: "Lucode Sessions",
        description: "List of all active Lucode sessions with full metadata",
        mimeType: "application/json"
      },
      {
        uri: "lucode://sessions/ready",
        name: "Ready Sessions",
        description: "Sessions marked as ready to merge",
        mimeType: "application/json"
      },
      {
        uri: "lucode://sessions/active",
        name: "Active Sessions",
        description: "Running sessions that are not yet ready to merge",
        mimeType: "application/json"
      },
      {
        uri: "lucode://specs",
        name: "Spec Sessions",
        description: "All spec sessions awaiting refinement and start",
        mimeType: "application/json"
      },
      {
        uri: "lucode://specs/{name}",
        name: "Spec Content",
        description: "Content of a specific spec session",
        mimeType: "text/markdown"
      },
      {
        uri: "lucode://diff/summary",
        name: "Diff Summary",
        description: "Diff summary; add query ?session=<name>&cursor=<c>&page_size=<n>",
        mimeType: "application/json"
      },
      {
        uri: "lucode://diff/file",
        name: "Diff Chunk",
        description: "Diff chunk; add query ?path=<file>&session=<name>&cursor=<c>&line_limit=<n>",
        mimeType: "application/json"
      },
      ...workflowResources,
    ]
  }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
  const { uri } = request.params

  try {
    let content: string
    const parseQuery = (raw: string) => {
      const url = new URL(raw.replace(/^lucode:\/\//, 'https://dummy/'))
      const get = (key: string) => {
        const val = url.searchParams.get(key)
        return val === null ? undefined : val
      }
      return { get }
    }

    switch (uri) {
      case "lucode://skills": {
        content = JSON.stringify(listLucodeWorkflows(), null, 2)
        break
      }

      case "lucode://sessions": {
        const sessions = await bridge.listSessions()
        content = JSON.stringify(sessions, null, 2)
        break
      }

      case "lucode://sessions/ready": {
        const sessions = await bridge.listSessions()
        const readySessions = sessions.filter(s => s.ready_to_merge)
        content = JSON.stringify(readySessions, null, 2)
        break
      }

      case "lucode://sessions/active": {
        const sessions = await bridge.listSessions()
        const activeSessions = sessions.filter(s => !s.ready_to_merge)
        content = JSON.stringify(activeSessions, null, 2)
        break
      }

      case "lucode://specs": {
        const specs = await bridge.listDraftSessions()
        content = JSON.stringify(specs, null, 2)
        break
      }

      case "lucode://diff/summary":
      case uri.match(/^lucode:\/\/diff\/summary\?.*/)?.input: {
        const { get } = parseQuery(uri)
        const session = get('session')
        const cursor = get('cursor')
        const pageSize = get('page_size') ? Number(get('page_size')) : undefined
        const summary = await bridge.getDiffSummary({ session, cursor, pageSize })
        if (!summary) {
          throw new McpError(ErrorCode.InternalError, 'Diff summary payload missing')
        }
        const payload = sanitizeDiffSummary(summary)
        content = JSON.stringify(payload, null, 2)
        break
      }

      case "lucode://diff/file":
      case uri.match(/^lucode:\/\/diff\/file\?.*/)?.input: {
        const { get } = parseQuery(uri)
        const path = get('path')
        if (!path) {
          throw new McpError(ErrorCode.InvalidRequest, "Query parameter 'path' is required for diff/file")
        }
        const session = get('session')
        const cursor = get('cursor')
        const lineLimit = get('line_limit') ? Number(get('line_limit')) : undefined
        const chunk = await bridge.getDiffChunk({ session, path, cursor, lineLimit })
        if (!chunk) {
          throw new McpError(ErrorCode.InternalError, 'Diff chunk payload missing')
        }
        const payload = sanitizeDiffChunk(chunk)
        content = JSON.stringify(payload, null, 2)
        break
      }

      default: {
        const workflowMatch = uri.match(/^lucode:\/\/skills\/(.+)$/)
        if (workflowMatch) {
          const workflowName = workflowMatch[1]

          let workflowMarkdown: string
          try {
            workflowMarkdown = readLucodeWorkflowMarkdown(workflowName)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new McpError(ErrorCode.InvalidRequest, errorMessage)
          }

          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: workflowMarkdown
              }
            ]
          }
        }

        // Check if it's a specific spec content request
        const draftMatch = uri.match(/^lucode:\/\/specs\/(.+)$/)
        if (draftMatch) {
          const draftName = draftMatch[1]
          const specs = await bridge.listDraftSessions()
          const spec = specs.find(d => d.name === draftName)
          
          if (!spec) {
            throw new McpError(ErrorCode.InvalidRequest, `Spec '${draftName}' not found`)
          }
          
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: spec.draft_content || ''
              }
            ]
          }
        }
        
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`)
      }
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content
        }
      ]
    }
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Resource read failed: ${errorMessage}`)
  }
})

async function main(): Promise<void> {
  // Connect to database on startup
  // Bridge no longer needs connection - it's stateless
  
  const transport = new StdioServerTransport()
  await server.connect(transport)
  
  console.error("Lucode MCP server running")
  console.error(`Project path: ${process.env.LUCODE_PROJECT_PATH || 'auto-detected from git root'}`)
  console.error("Connected to database, ready to manage sessions")
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    // Bridge no longer needs disconnection - it's stateless
    process.exit(0)
  })
  
  process.on('SIGTERM', async () => {
    // Bridge no longer needs disconnection - it's stateless
    process.exit(0)
  })
}

main().catch(console.error)
