# task-flow v2 — status

**Branch:** `task-flow-v2`
**Design:** [2026-04-29-task-flow-v2-design.md](./2026-04-29-task-flow-v2-design.md)

| Phase | Title | Status | PR / Commit |
|---|---|---|---|
| 0 | Backup + branch + reference snapshot | `[ ]` | — |
| 1 | Collapse `TaskRunStatus` to derived state | `[ ]` | — |
| 2 | Per-task mutex; remove global RwLock | `[ ]` | — |
| 3 | Drop `RunRole`, `SessionState`, `SessionStatus` | `[ ]` | — |
| 4 | `TaskFlowError` sweep + derived current_* getters | `[ ]` | — |
| 5 | Explicit `lucode_task_run_done` MCP tool | `[ ]` | — |
| 6 | `Sidebar.tsx` split | `[ ]` | — |

Updated when each phase merges to `task-flow-v2`.
