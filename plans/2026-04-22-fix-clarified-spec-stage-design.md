# Clarified Spec Stage Compatibility Design

## Context

The recent task lifecycle overhaul made `ready` the canonical spec/task stage in the Rust backend, but older persisted `specs.stage` rows and MCP-facing contracts still use `clarified`. That leaves three incompatible paths:

1. Loading legacy spec rows fails with `Invalid spec stage: clarified`.
2. Stage update entry points that still receive `clarified` reject it.
3. MCP bridge schemas/types no longer match the backend's canonical `ready` response.

The user-visible symptom is a backend error when listing specs during session creation.

## Approaches

### 1. Data migration only

Run a DB migration that rewrites `clarified` to `ready` and leave code untouched.

- Pros: Minimal code churn.
- Cons: Unsafe for external clients still sending `clarified`; brittle if any old row bypasses migration.

### 2. Parser alias only

Teach the backend to parse `clarified` as `Ready` and leave the DB/API contracts unchanged.

- Pros: Fixes the crash quickly.
- Cons: Leaves stale persisted values around and keeps the contract drift alive.

### 3. Compatibility layer with canonical normalization

Treat `clarified` as a legacy alias for `ready`, normalize stored rows during migration, and update MCP typings/schemas so `ready` is the canonical stage while still accepting `clarified` input.

- Pros: Fixes the crash, preserves backward compatibility, and aligns contracts on the new stage model.
- Cons: Slightly broader change surface.

## Decision

Use approach 3.

## Design

### Backend

- Add legacy alias support so `SpecStage::from_str("clarified")` resolves to `SpecStage::Ready`.
- Normalize existing DB rows with `UPDATE specs SET stage = 'ready' WHERE stage = 'clarified'` during schema migration.
- Update command/API stage parsing to rely on shared parsing instead of hand-maintained string matches where practical.

### MCP bridge

- Expand bridge/schema stage types to tolerate legacy `clarified` inputs.
- Document `ready` as the canonical stage in tool schemas and descriptions.
- Keep response handling compatible with canonical `ready` payloads.

### Testing

- Add a Rust regression test that inserts a legacy `clarified` row and proves it can be read/listed as `Ready`.
- Add a Rust regression test that proves stage parsing accepts `clarified`.
- Add MCP schema/bridge tests so `ready` is accepted and legacy `clarified` does not break parsing.
