# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## Consolidation Sessions

Adds a "consolidation" session type for reviewing and reconciling code from multiple parallel agent sessions in a version group.

- `is_consolidation` boolean flag on sessions (DB column, Rust entity, frontend types)
- "Consolidate" button on version group headers (visible when 2+ sessions are running/reviewed)
- Purple MERGE badge on consolidation session cards
- Auto-generated consolidation prompt listing each session's ID, branch, worktree path, and diff stats
- Pre-filled NewSessionModal via `ConsolidateVersionGroup` UI event
- `lucode_promote` accepts an optional `winner_session_id`: when promoting a consolidation session, the consolidated commits are atomically transplanted onto the chosen winner's branch (via a single `reset --hard` in the winner's worktree) so the winner survives with the merged work. The consolidation session and losing source versions are cancelled automatically. Without `winner_session_id`, promotion falls back to the legacy behavior (consolidation session survives).
