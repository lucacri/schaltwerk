# Codex Auto-Approve Commands Design

## Goal

Ensure every Codex session that Lucode launches defaults to non-interactive command approval, for both fresh starts and resume flows, without changing sandbox selection behavior or other agent integrations.

## Context

Current Lucode-managed Codex launches explicitly set `--sandbox` but do not explicitly set an approval policy. The installed Codex CLI currently exposes `--ask-for-approval <policy>`, and `never` is the policy that disables interactive approval prompts while leaving command failures to the model.

Lucode has two relevant layers:

1. `src-tauri/src/domains/agents/codex.rs`
   Builds the base Codex shell command used by fresh and resumed session launches.
2. `src-tauri/src/commands/schaltwerk_core/agent_ctx.rs`
   Merges Lucode-managed launch args with user-configured Codex CLI args and preferences before spawning the terminal process.

The session manager and orchestrator paths both route through the shared Codex adapter/registry, so a fix in these layers covers:

- regular session first launch
- regular session resume
- spec-to-session first launch and later resume
- orchestrator Codex launch and resume

## Options Considered

### Option 1: Add `--ask-for-approval never` only in the Codex command builder

Pros:
- Smallest code change
- Covers fresh and resume commands emitted by the base builder

Cons:
- User-configured extra Codex CLI args merged later could still append another approval flag and override the default
- Does not enforce the "hard default" requirement

### Option 2: Add the flag in the builder and strip Lucode-side approval overrides during arg merge

Pros:
- Covers all Lucode-controlled Codex launches
- Preserves current sandbox selection while preventing user-configured CLI args from re-enabling prompts
- Keeps the implementation local to Codex-specific launch plumbing

Cons:
- Slightly broader change than builder-only

### Option 3: Push approval policy into generic agent registry/preferences layers

Pros:
- Centralized execution-policy concept

Cons:
- Over-scoped for a Codex-only requirement
- Higher regression risk for other agents

## Chosen Design

Use Option 2.

1. Update the shared Codex command builder to always include `--ask-for-approval never` immediately after the existing sandbox flag.
2. Update Codex-specific final-arg merging in `agent_ctx.rs` so Lucode strips approval-policy overrides from user-configured extra CLI args when running under the Lucode harness, similar to existing sandbox override stripping.
3. Keep sandbox handling unchanged: Lucode still chooses the same sandbox mode and still ignores user attempts to replace it from extra Codex CLI args.
4. Do not touch other agent adapters or UI settings.

## Behavioral Notes

- Fresh launch example:
  - before: `codex --sandbox workspace-write "prompt"`
  - after: `codex --sandbox workspace-write --ask-for-approval never "prompt"`
- Resume example:
  - before: `codex --sandbox workspace-write resume --last`
  - after: `codex --sandbox workspace-write --ask-for-approval never resume --last`
- Orchestrator launches inherit the same behavior because they use the shared Codex adapter/registry path.

## Testing Strategy

Add and update Rust unit tests to prove:

1. Base Codex command strings include `--ask-for-approval never` for:
   - fresh prompt launch
   - fresh no-prompt launch
   - explicit resume
   - continue-most-recent resume
   - danger-full-access mode
2. Codex final arg merging strips user-supplied approval overrides in Lucode-managed runs while preserving the Lucode default.
3. Existing sandbox override behavior remains intact.

## Risks

- Codex CLI surface could change in the future. The implementation uses the currently installed CLI surface verified from local help output in this workspace: `--ask-for-approval never`.
- If Codex later changes precedence semantics for duplicate flags, the strip-on-merge guard still keeps Lucode’s default authoritative for Lucode-managed launches.
