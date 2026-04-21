# Task Lifecycle Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Lucode's split spec/session lifecycle with task-first stages, per-stage workflow bindings, and stage execution branches rooted at the task's ready worktree.

**Architecture:** Promote `tasks` to the durable unit of work, store stage/workflow state on the task row plus per-stage workflow rows, and keep `sessions` as task-owned execution worktrees. Preserve external MCP/Tauri compatibility by treating old spec APIs as aliases over task rows while rewriting internal stage logic around the new task stages.

**Tech Stack:** Rust, SQLite/rusqlite, Tauri commands, MCP HTTP API, React, TypeScript, Jotai, Vitest, cargo nextest.

---

### Task 1: Add failing backend coverage for the new task model

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/domains/sessions/service.rs`
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `src/common/sessionStage.test.ts`

**Step 1: Write failing Rust tests for task tables and task stages**

Add tests that assert:
- schema initialization creates `tasks` and `task_stage_workflows`
- task stages round-trip `draft`, `ready`, `brainstormed`, `planned`, `implemented`, `pushed`, `done`, `cancelled`
- a task compatibility projection still serves `/api/specs`-style reads from the new task table

**Step 2: Run targeted Rust tests to verify red**

Run: `cargo test task_stage --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because the task schema and enums do not exist yet.

**Step 3: Write failing TypeScript tests for new task-stage projection**

Update the stage tests to expect the new stage set and task-stage precedence instead of the old `idea/clarified/working_on/...` values.

**Step 4: Run targeted TypeScript tests to verify red**

Run: `bun vitest run src/common/sessionStage.test.ts`

Expected: FAIL because the frontend still derives the old stage taxonomy.

### Task 2: Replace the persisted draft/spec model with tasks

**Files:**
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Create: `src-tauri/src/infrastructure/database/db_tasks.rs`
- Modify: `src-tauri/src/infrastructure/database/mod.rs`
- Modify: `src-tauri/src/domains/sessions/repository.rs`

**Step 1: Add task entities and enums**

Define:
- `Task`
- `TaskVariant`
- `TaskStage`
- `TaskStageWorkflow`

Keep serde names in snake_case to match MCP payloads.

**Step 2: Add task persistence**

Create repository methods for:
- create/get/list/update/delete task
- create/list/update stage workflow rows
- set task stage, ready root session, issue/PR metadata, and attention flags

**Step 3: Replace schema objects**

Update schema initialization so:
- `tasks` replaces `specs`
- `task_stage_workflows` is created
- `sessions` gets `task_id`, `task_stage`, and `task_role`

Use a destructive migration path appropriate for the prototype posture.

**Step 4: Run targeted Rust tests**

Run: `cargo test task_ --manifest-path src-tauri/Cargo.toml`

Expected: PASS for the new repository/schema tests.

### Task 3: Rework session creation and lineage around tasks

**Files:**
- Modify: `src-tauri/src/domains/sessions/service.rs`
- Modify: `src-tauri/src/domains/sessions/lifecycle/bootstrapper.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`

**Step 1: Write failing service tests for ready-root lineage**

Add tests for:
- promoting a draft task to `ready` creates one root worktree session
- later stage candidates branch from the root session branch, not `main`
- confirming a stage winner updates the task stage and keeps merge target on the root branch

**Step 2: Run targeted Rust tests to verify red**

Run: `cargo test ready_root --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because creation still resolves only `base_branch`.

**Step 3: Implement task-aware session creation**

Add task/session creation params so the service can:
- create a root ready session
- create stage candidate sessions from a parent session branch
- tag execution sessions with task metadata

**Step 4: Make the tests pass**

Run: `cargo test ready_root --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

### Task 4: Generalize per-stage multi-agent rounds and workflow bindings

**Files:**
- Modify: `src-tauri/src/domains/sessions/repository.rs`
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `src/types/agentPreset.ts`
- Modify: `src/components/modals/newSession/buildCreatePayload.ts`

**Step 1: Write failing tests for workflow bindings**

Cover:
- task creation seeds stage workflow rows
- workflow overrides can be written per stage
- stage launch resolves preset, judge preset, and `auto_chain`

**Step 2: Run targeted tests to verify red**

Run: `cargo test workflow_binding --manifest-path src-tauri/Cargo.toml`
Run: `bun vitest run src/components/modals/newSession/buildCreatePayload.test.ts`

Expected: FAIL because workflows are not modeled today.

**Step 3: Implement stage workflow persistence and resolution**

Add preset/judge binding support and map create payloads to those stage rows.

**Step 4: Generalize consolidation rounds**

Use task stages as round types for brainstorm/planned/implemented stages.

**Step 5: Re-run targeted tests**

Expected: PASS.

### Task 5: Preserve MCP/Tauri compatibility while switching to task-backed data

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `src/common/tauriCommands.ts`

**Step 1: Write failing MCP tests**

Cover:
- `/api/specs` list/read/update/start routes operate on tasks
- task routes (if added) return the same underlying records
- stage updates use the new task stage names

**Step 2: Run targeted tests to verify red**

Run: `cargo test api_specs_task --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because MCP still reads `specs`.

**Step 3: Implement compatibility handlers**

Keep old route/command names where required, but back them with task storage and task-stage transitions.

**Step 4: Re-run targeted tests**

Expected: PASS.

### Task 6: Reproject frontend state and UI around task stages

**Files:**
- Modify: `src/types/session.ts`
- Modify: `src/common/sessionStage.ts`
- Modify: `src/store/atoms/sessions.ts`
- Modify: `src/components/sidebar/KanbanView.tsx`
- Modify: `src/components/specs/SpecEditor.tsx`
- Modify: `src/components/modals/NewSessionModal.tsx`

**Step 1: Write failing frontend tests**

Cover:
- new task stages and labels
- draft/ready task projection in sidebar and Kanban
- editor controls reflecting `draft`, `ready`, `brainstormed`, `planned`, `implemented`, `pushed`, `done`

**Step 2: Run targeted frontend tests to verify red**

Run: `bun vitest run src/common/sessionStage.test.ts src/components/sidebar/KanbanView.test.tsx src/components/specs/SpecEditor.test.tsx`

Expected: FAIL because UI still uses spec/ready-to-merge semantics.

**Step 3: Implement frontend task-stage support**

Update types, labels, and task editor controls while preserving existing selection and terminal behavior.

**Step 4: Re-run targeted frontend tests**

Expected: PASS.

### Task 7: Verify, review, and finish

**Files:**
- Modify only if review or verification finds issues

**Step 1: Run focused regression suites**

Run:
- `bun vitest run src/common/sessionStage.test.ts src/components/sidebar/KanbanView.test.tsx src/components/specs/SpecEditor.test.tsx src/components/modals/newSession/buildCreatePayload.test.ts`
- `cargo nextest run --manifest-path src-tauri/Cargo.toml task_stage workflow_binding ready_root api_specs_task`

**Step 2: Run full project verification**

Run: `just test`

Expected: PASS with zero known failures.

**Step 3: Request code review**

Review the final diff against this plan and fix any real issues before commit.

**Step 4: Create a squashed commit**

Run:
```bash
git add plans/2026-04-21-task-lifecycle-overhaul-design.md plans/2026-04-21-task-lifecycle-overhaul-plan.md src src-tauri
git commit -m "feat: replace sessions and specs with task stages"
```
