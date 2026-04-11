# Promote On Finalize Design

**Context**

`confirm_consolidation_winner_inner()` already promotes the chosen source session and cancels losing source siblings. The remaining gap is round finalization: the winning candidate session and any judge session can stay active after confirmation, even though the round is already promoted.

The MCP-facing response also stops short of the actual outcome because it does not report judge-session cleanup.

**Approaches**

1. **Backend-only cleanup in `confirm_consolidation_winner_inner()`**
   Cancel active candidate and judge sessions after the winner transplant completes.
   Trade-off: small change, but weak testability if the confirmation flow stays coupled to `AppHandle`.

2. **Extract confirmation logic behind injectable refresh/cancel callbacks**
   Keep the public API entrypoint thin, move the confirmation flow into a helper, and test that helper directly with real session records.
   Trade-off: slightly more structure, but it gives focused regression coverage for cleanup semantics and failure handling.

3. **Push round cleanup into `execute_session_promotion()`**
   Rejected. That helper is intentionally generic for session promotion and should not learn consolidation-round lifecycle policy.

**Decision**

Take approach 2. Use `promote-on-finalize_v3` as the conceptual base for the backend structure and tests, then carry forward `promote-on-finalize_v1`'s MCP response/schema updates so the bridge reports judge cleanup explicitly.

**Implementation Shape**

- Add Rust regression coverage for confirmation cleanup:
  - successful confirmation leaves only the promoted source session active,
  - the winning candidate and judge are cancelled,
  - the round is still marked promoted if cleanup fails after the winner transplant.
- Refactor the confirmation flow into an internal helper that accepts refresh/cancel callbacks.
- Return `judge_sessions_cancelled` from the Rust API response and propagate it through the MCP bridge, structured response builder, and schema tests.

**Verification**

- Focused Rust regression tests for confirmation cleanup.
- Focused MCP bridge/schema tests for the new response field.
- Full repository verification with `just test`.
