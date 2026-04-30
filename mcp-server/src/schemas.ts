const draft2020 = 'https://json-schema.org/draft/2020-12/schema'

const isoDateTime = { type: 'string', format: 'date-time' } as const
const nullableIsoDateTime = { anyOf: [isoDateTime, { type: 'null' }] } as const
const nullableString = { type: ['string', 'null'] } as const
const nullableBoolean = { type: ['boolean', 'null'] } as const
const nullableNumber = { type: ['number', 'null'] } as const
const specStageEnum = ['draft', 'ready'] as const
const prStateEnum = ['open', 'succeeding', 'mred'] as const

const epicSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: nullableString,
  },
  required: ['id', 'name'],
  additionalProperties: false,
} as const

const sessionSummarySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    display_name: { type: 'string' },
    status: { enum: ['spec', 'ready', 'active'] },
    session_state: nullableString,
    ready_to_merge: { type: 'boolean' },
    created_at: nullableIsoDateTime,
    last_activity: nullableIsoDateTime,
    agent_type: nullableString,
    branch: nullableString,
    worktree_path: nullableString,
    initial_prompt: nullableString,
    draft_content: nullableString,
    pr_number: nullableNumber,
    pr_url: nullableString,
    pr_state: { anyOf: [{ enum: prStateEnum }, { type: 'null' }] },
  },
  required: ['name', 'status', 'ready_to_merge'],
  additionalProperties: false,
} as const

const taskSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    display_name: { type: 'string' },
    status: { type: 'string' },
    session_state: nullableString,
    created_at: nullableIsoDateTime,
    last_activity: nullableIsoDateTime,
    branch: nullableString,
    worktree_path: nullableString,
    ready_to_merge: nullableBoolean,
    agent_type: nullableString,
    initial_prompt: nullableString,
    draft_content: nullableString,
    pr_number: nullableNumber,
    pr_url: nullableString,
    pr_state: { anyOf: [{ enum: prStateEnum }, { type: 'null' }] },
  },
  required: ['name'],
  additionalProperties: false,
} as const

const specSummarySchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    display_name: { type: 'string' },
    stage: { enum: specStageEnum },
    content_length: { type: 'number' },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'stage', 'content_length', 'updated_at'],
  additionalProperties: false,
} as const

const specDocumentSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    display_name: { type: 'string' },
    stage: { enum: specStageEnum },
    content: { type: 'string' },
    content_length: { type: 'number' },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'stage', 'content', 'content_length', 'updated_at'],
  additionalProperties: false,
} as const

const specStageUpdateSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    stage: { enum: specStageEnum },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'stage', 'updated_at'],
  additionalProperties: false,
} as const

const specAttentionUpdateSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    attention_required: { type: 'boolean' },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'attention_required', 'updated_at'],
  additionalProperties: false,
} as const

const diffBranchInfoSchema = {
  type: 'object',
  properties: {
    current_branch: { type: 'string' },
    parent_branch: { type: 'string' },
    merge_base_short: { type: 'string' },
    head_short: { type: 'string' },
  },
  required: ['current_branch', 'parent_branch', 'merge_base_short', 'head_short'],
  additionalProperties: false,
} as const

const diffFileSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    change_type: { type: 'string' },
  },
  required: ['path', 'change_type'],
  additionalProperties: false,
} as const

const diffLineSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    line_type: { type: 'string' },
    old_line_number: { type: 'number' },
    new_line_number: { type: 'number' },
    is_collapsible: { type: 'boolean' },
    collapsed_count: { type: 'number' },
  },
  required: ['content', 'line_type'],
  additionalProperties: false,
} as const

const prFeedbackReviewSchema = {
  type: 'object',
  properties: {
    author: nullableString,
    state: { type: 'string' },
    submitted_at: isoDateTime,
  },
  required: ['author', 'state', 'submitted_at'],
  additionalProperties: false,
} as const

const prFeedbackStatusCheckSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    status: { type: 'string' },
    conclusion: nullableString,
    url: nullableString,
  },
  required: ['name', 'status', 'conclusion', 'url'],
  additionalProperties: false,
} as const

const prFeedbackCommentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    body: { type: 'string' },
    author: nullableString,
    created_at: isoDateTime,
    url: { type: 'string' },
  },
  required: ['id', 'body', 'author', 'created_at', 'url'],
  additionalProperties: false,
} as const

const prFeedbackThreadSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    path: { type: 'string' },
    line: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    comments: {
      type: 'array',
      items: prFeedbackCommentSchema,
    },
  },
  required: ['id', 'path', 'line', 'comments'],
  additionalProperties: false,
} as const

const presetLaunchMetadataSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
  additionalProperties: false,
} as const

const presetLaunchSessionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    branch: { type: 'string' },
    agent_type: { type: 'string' },
    version_number: { type: 'number' },
  },
  required: ['name', 'branch', 'agent_type', 'version_number'],
  additionalProperties: false,
} as const

const presetLaunchSchema = {
  type: 'object',
  properties: {
    mode: { const: 'preset' },
    preset: presetLaunchMetadataSchema,
    version_group_id: { type: 'string' },
    sessions: {
      type: 'array',
      items: presetLaunchSessionSchema,
    },
  },
  required: ['mode', 'preset', 'version_group_id', 'sessions'],
  additionalProperties: false,
} as const

const presetDraftStartSchema = {
  type: 'object',
  properties: {
    mode: { const: 'preset' },
    source_spec: { type: 'string' },
    archived_spec: { type: 'boolean' },
    preset: presetLaunchMetadataSchema,
    version_group_id: { type: 'string' },
    sessions: {
      type: 'array',
      items: presetLaunchSessionSchema,
    },
  },
  required: ['mode', 'source_spec', 'archived_spec', 'preset', 'version_group_id', 'sessions'],
  additionalProperties: false,
} as const

export const toolOutputSchemas = {
  lucode_create: {
    $schema: draft2020,
    type: 'object',
    oneOf: [
      {
        type: 'object',
        properties: {
          type: { enum: ['session', 'spec'] },
          status: { const: 'created' },
          session: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              branch: { type: 'string' },
              worktree_path: nullableString,
              parent_branch: nullableString,
              agent_type: nullableString,
              ready_to_merge: nullableBoolean,
              content_length: nullableNumber,
            },
            required: ['name', 'branch'],
            additionalProperties: true,
          },
        },
        required: ['type', 'status', 'session'],
        additionalProperties: false,
      },
      presetLaunchSchema,
    ],
  },

  lucode_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      sessions: {
        type: 'array',
        items: sessionSummarySchema,
      },
    },
    required: ['sessions'],
    additionalProperties: false,
  },

  lucode_send_message: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      status: { const: 'sent' },
      message: { type: 'string' },
    },
    required: ['session', 'status', 'message'],
    additionalProperties: false,
  },

  lucode_cancel: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      cancelled: { type: 'boolean' },
      force: { type: 'boolean' },
    },
    required: ['session', 'cancelled'],
    additionalProperties: false,
  },

  lucode_spec_create: {
    $schema: draft2020,
    type: 'object',
    properties: {
      type: { const: 'spec' },
      status: { const: 'created' },
      session: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          branch: { type: 'string' },
          parent_branch: nullableString,
          worktree_path: nullableString,
          content_length: nullableNumber,
        },
        required: ['name', 'branch'],
        additionalProperties: true,
      },
    },
    required: ['type', 'status', 'session'],
    additionalProperties: false,
  },

  lucode_draft_update: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      updated: { type: 'boolean' },
      append: { type: 'boolean' },
      content_length: nullableNumber,
      content_preview: nullableString,
    },
    required: ['session', 'updated', 'append'],
    additionalProperties: false,
  },

  lucode_get_setup_script: {
    $schema: draft2020,
    type: 'object',
    properties: {
      setup_script: { type: 'string' },
      has_setup_script: { type: 'boolean' },
    },
    required: ['setup_script', 'has_setup_script'],
    additionalProperties: false,
  },

  lucode_set_setup_script: {
    $schema: draft2020,
    type: 'object',
    properties: {
      setup_script: { type: 'string' },
      has_setup_script: { type: 'boolean' },
    },
    required: ['setup_script', 'has_setup_script'],
    additionalProperties: false,
  },

  lucode_get_worktree_base_directory: {
    $schema: draft2020,
    type: 'object',
    properties: {
      worktree_base_directory: { type: 'string' },
      has_custom_directory: { type: 'boolean' },
    },
    required: ['worktree_base_directory', 'has_custom_directory'],
    additionalProperties: false,
  },

  lucode_set_worktree_base_directory: {
    $schema: draft2020,
    type: 'object',
    properties: {
      worktree_base_directory: { type: 'string' },
      has_custom_directory: { type: 'boolean' },
    },
    required: ['worktree_base_directory', 'has_custom_directory'],
    additionalProperties: false,
  },

  lucode_spec_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      specs: {
        type: 'array',
        items: specSummarySchema,
      },
    },
    required: ['specs'],
    additionalProperties: false,
  },

  lucode_spec_read: {
    $schema: draft2020,
    ...specDocumentSchema,
  },

  lucode_spec_set_stage: {
    $schema: draft2020,
    ...specStageUpdateSchema,
  },

  lucode_spec_set_attention: {
    $schema: draft2020,
    ...specAttentionUpdateSchema,
  },

  lucode_improve_plan: {
    $schema: draft2020,
    type: 'object',
    properties: {
      spec: { type: 'string' },
      round_id: { type: 'string' },
      candidate_sessions: { type: 'array', items: { type: 'string' } },
    },
    required: ['spec', 'round_id', 'candidate_sessions'],
    additionalProperties: false,
  },

  lucode_diff_summary: {
    $schema: draft2020,
    type: 'object',
    properties: {
      scope: { type: 'string' },
      session_id: nullableString,
      branch_info: diffBranchInfoSchema,
      has_spec: { type: 'boolean' },
      files: {
        type: 'array',
        items: diffFileSchema,
      },
      paging: {
        type: 'object',
        properties: {
          next_cursor: nullableString,
          total_files: { type: 'number' },
          returned: { type: 'number' },
        },
        required: ['next_cursor', 'total_files', 'returned'],
        additionalProperties: false,
      },
    },
    required: ['scope', 'branch_info', 'files', 'paging', 'has_spec'],
    additionalProperties: false,
  },

  lucode_diff_chunk: {
    $schema: draft2020,
    type: 'object',
    properties: {
      file: diffFileSchema,
      branch_info: diffBranchInfoSchema,
      stats: {
        type: 'object',
        properties: {
          additions: { type: 'number' },
          deletions: { type: 'number' },
        },
        required: ['additions', 'deletions'],
        additionalProperties: false,
      },
      is_binary: { type: 'boolean' },
      lines: {
        type: 'array',
        items: diffLineSchema,
      },
      paging: {
        type: 'object',
        properties: {
          cursor: nullableString,
          next_cursor: nullableString,
          returned: { type: 'number' },
        },
        required: ['cursor', 'next_cursor', 'returned'],
        additionalProperties: false,
      },
    },
    required: ['file', 'branch_info', 'stats', 'is_binary', 'lines', 'paging'],
    additionalProperties: false,
  },

  lucode_session_spec: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      content: { type: 'string' },
      updated_at: isoDateTime,
    },
    required: ['session_id', 'content', 'updated_at'],
    additionalProperties: false,
  },

  lucode_get_pr_feedback: {
    $schema: draft2020,
    type: 'object',
    properties: {
      state: { type: 'string' },
      is_draft: { type: 'boolean' },
      review_decision: nullableString,
      latest_reviews: {
        type: 'array',
        items: prFeedbackReviewSchema,
      },
      status_checks: {
        type: 'array',
        items: prFeedbackStatusCheckSchema,
      },
      unresolved_threads: {
        type: 'array',
        items: prFeedbackThreadSchema,
      },
      resolved_thread_count: { type: 'number' },
    },
    required: [
      'state',
      'is_draft',
      'review_decision',
      'latest_reviews',
      'status_checks',
      'unresolved_threads',
      'resolved_thread_count',
    ],
    additionalProperties: false,
  },

  lucode_draft_start: {
    $schema: draft2020,
    type: 'object',
    oneOf: [
      {
        type: 'object',
        properties: {
          session: { type: 'string' },
          started: { type: 'boolean' },
          agent_type: nullableString,
          base_branch: nullableString,
        },
        required: ['session', 'started'],
        additionalProperties: false,
      },
      presetDraftStartSchema,
    ],
  },

  lucode_draft_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      specs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            display_name: { type: 'string' },
            created_at: nullableIsoDateTime,
            updated_at: nullableIsoDateTime,
            base_branch: nullableString,
            content_length: { type: 'number' },
            content_preview: { type: 'string' },
          },
          required: ['name', 'content_length', 'content_preview'],
          additionalProperties: false,
        },
      },
    },
    required: ['specs'],
    additionalProperties: false,
  },

  lucode_draft_delete: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      deleted: { type: 'boolean' },
    },
    required: ['session', 'deleted'],
    additionalProperties: false,
  },

  lucode_get_current_tasks: {
    $schema: draft2020,
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: taskSchema,
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },

  lucode_promote: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      siblings_cancelled: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' },
      failures: { type: 'array', items: { type: 'string' } },
    },
    required: ['session', 'siblings_cancelled', 'reason', 'failures'],
    additionalProperties: false,
  },

  lucode_consolidation_report: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      round_id: { type: 'string' },
      role: { type: 'string' },
      auto_judge_triggered: { type: 'boolean' },
      auto_promoted: { type: 'boolean' },
    },
    required: ['session', 'round_id', 'role', 'auto_judge_triggered', 'auto_promoted'],
    additionalProperties: false,
  },

  lucode_trigger_consolidation_judge: {
    $schema: draft2020,
    type: 'object',
    properties: {
      round_id: { type: 'string' },
      judge_session: { type: 'string' },
    },
    required: ['round_id', 'judge_session'],
    additionalProperties: false,
  },

  lucode_confirm_consolidation_winner: {
    $schema: draft2020,
    type: 'object',
    properties: {
      round_id: { type: 'string' },
      winner_session: { type: 'string' },
      promoted_session: { type: 'string' },
      candidate_sessions_cancelled: { type: 'array', items: { type: 'string' } },
      source_sessions_cancelled: { type: 'array', items: { type: 'string' } },
      judge_sessions_cancelled: { type: 'array', items: { type: 'string' } },
    },
    required: ['round_id', 'winner_session', 'promoted_session', 'candidate_sessions_cancelled', 'source_sessions_cancelled', 'judge_sessions_cancelled'],
    additionalProperties: false,
  },

  lucode_task_run_done: {
    $schema: draft2020,
    type: 'object',
    properties: {
      run_id: { type: 'string' },
      task_id: { type: 'string' },
      stage: { type: 'string' },
      status: { enum: ['ok', 'failed'] },
      failed_at: nullableString,
      failure_reason: nullableString,
      confirmed_at: nullableString,
      cancelled_at: nullableString,
    },
    required: ['run_id', 'task_id', 'stage', 'status'],
    additionalProperties: false,
  },

  lucode_convert_to_spec: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      converted: { type: 'boolean' },
    },
    required: ['session', 'converted'],
    additionalProperties: false,
  },

  lucode_merge_session: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      merged: { type: 'boolean' },
      mode: { enum: ['squash', 'reapply'] },
      parent_branch: { type: 'string' },
      session_branch: { type: 'string' },
      commit: { type: 'string' },
      cancel_requested: { type: 'boolean' },
      cancel_queued: { type: 'boolean' },
      cancel_error: nullableString,
    },
    required: [
      'session',
      'merged',
      'mode',
      'parent_branch',
      'session_branch',
      'commit',
      'cancel_requested',
      'cancel_queued',
    ],
    additionalProperties: false,
  },

  lucode_create_pr: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      branch: { type: 'string' },
      pr_url: nullableString,
      cancel_requested: { type: 'boolean' },
      cancel_queued: { type: 'boolean' },
      cancel_error: nullableString,
      modal_triggered: { type: 'boolean' },
    },
    required: ['session', 'branch', 'cancel_requested', 'cancel_queued'],
    additionalProperties: false,
  },
  lucode_link_pr: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      pr_number: nullableNumber,
      pr_url: nullableString,
      linked: { type: 'boolean' },
    },
    required: ['session', 'pr_number', 'pr_url', 'linked'],
    additionalProperties: false,
  },
  lucode_run_script: {
    $schema: draft2020,
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      command: { type: 'string' },
      exit_code: { type: 'number' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
    },
    required: ['success', 'command', 'exit_code', 'stdout', 'stderr'],
    additionalProperties: false,
  },
  lucode_create_epic: {
    $schema: draft2020,
    type: 'object',
    properties: {
      epic: epicSchema,
    },
    required: ['epic'],
    additionalProperties: false,
  },
  lucode_list_epics: {
    $schema: draft2020,
    type: 'object',
    properties: {
      epics: {
        type: 'array',
        items: epicSchema,
      },
    },
    required: ['epics'],
    additionalProperties: false,
  },

  lucode_prepare_merge: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      modal_triggered: { type: 'boolean' },
    },
    required: ['session', 'modal_triggered'],
    additionalProperties: false,
  },
} as const

export type ToolOutputName = keyof typeof toolOutputSchemas
