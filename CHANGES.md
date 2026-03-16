# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## Consolidation Sessions

Adds a "consolidation" session type for reviewing and reconciling code from multiple parallel agent sessions in a version group.

- `is_consolidation` boolean flag on sessions (DB column, Rust entity, frontend types)
- "Consolidate" button on version group headers (visible when 2+ sessions are running/reviewed)
- Purple MERGE badge on consolidation session cards
- Auto-generated consolidation prompt listing each session's branch, worktree path, and diff stats
- Pre-filled NewSessionModal via `ConsolidateVersionGroup` UI event
