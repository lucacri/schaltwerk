# Fix Promotion Crash Design

**Context**

Promoting a consolidation session with `winner_session_id` transplants the consolidation branch onto the chosen winner branch, then cancels siblings. The current implementation also cancels the consolidation session itself. In the real MCP path that means the caller can delete the worktree it is still running inside, which is the crash.

**Approaches**

1. **Minimal backend fix only**
   Remove the consolidation session from the cancellation list and adjust the Rust promotion tests.
   Trade-off: fixes the crash, but leaves workflow docs, MCP tool descriptions, and generated prompts lying about what happens after promote.

2. **Backend fix plus surface synchronization** (recommended)
   Apply the backend fix, strengthen promotion regression coverage, and update every shipped workflow/prompt source that describes consolidation promotion.
   Trade-off: touches more files, but keeps behavior, prompts, and wrapper resources aligned.

3. **Caller-side workaround**
   Special-case the HTTP/MCP promote caller so it skips cancelling the consolidation session there while leaving the core promotion helper unchanged.
   Trade-off: avoids one crash path but leaves the central promotion logic inconsistent and vulnerable from other callers.

**Decision**

Take approach 2. The bug lives in `execute_consolidation_winner_promotion()`, so the fix belongs there. The change should keep the winner transplant semantics intact, cancel only losing source sessions, and leave the consolidation session alive for review and manual cleanup. Every workflow and prompt surface that instructs agents about consolidation promotion must be updated in the same change so future consolidations do not reintroduce the wrong assumption.

**Implementation Shape**

- Add/adjust Rust tests in `src-tauri/src/mcp_api.rs` first so they prove:
  - the winner branch is transplanted,
  - losing source sessions are cancelled,
  - the consolidation session is not cancelled,
  - the production-style cancellation path still leaves the consolidation session active with its worktree present.
- Apply the minimal code fix by removing the consolidation session from the `to_cancel` list.
- Update the consolidate workflow source in `mcp-server/src/lucode-workflows.ts` and regenerate the wrapper copies checked into the repo.
- Update prompt defaults and MCP tool descriptions so generated consolidation sessions receive the correct instruction text.
- Add narrow tests for the prompt/tool text surfaces that would otherwise regress silently.

**Testing**

- Rust: targeted promotion tests first, then full `just test`.
- TypeScript: targeted workflow/prompt/tool-registry tests as part of the red-green cycle, then full `just test`.

