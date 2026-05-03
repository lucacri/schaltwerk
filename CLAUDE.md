# CLAUDE.md - Lucode Development Guidelines

## Project Overview
Tauri-based desktop app for managing AI coding tasks using git worktrees. Each task owns a base worktree, and stage runs spawn slot sub-sessions in their own worktrees so AI agents (Claude, GitHub Copilot CLI, Kilo Code, Gemini, OpenCode, Codex, Factory Droid, etc.) can work without affecting the main codebase.

## Platform Support
- macOS 11+ supported; Linux builds are supported from source.
- Windows 10 version 1903+ supported (ConPTY required); WSL not yet supported.

> **Tooling Note:** Examples in this guide default to `bun`. Replace them with the equivalent `npm` commands (`npm install`, `npm run …`, etc.) if you prefer npm.

## Working Directory (CRITICAL)

**Your starting working directory is where you work. Do not navigate away from it.**

- Check `<env>` for your working directory and current branch
- If in a worktree (branch: `lucode/*`): All files are here. Make changes here.
- If in main repo (branch: `main`): Work here directly.
- Do NOT infer parent paths from directory structure
- Do NOT `cd` to other locations unless explicitly required

❌ WRONG: `cd /inferred/path && command`
✅ RIGHT: `command` (in current directory)

## Lucode Workflows

- Lucode-owned reusable workflows live in `.agents/skills/<name>/SKILL.md`.
- When a task matches one of those workflows, load the shared skill first instead of reinventing the steps.
- The MCP fallback registry is `lucode://skills`, and individual workflow bodies are available at `lucode://skills/<name>`.
- The currently published Lucode workflow is `consolidate`.
- Claude also ships wrapper files under `claude-plugin/`, and OpenCode exposes an optional slash command wrapper under `.opencode/commands/`, but the shared skill plus MCP resources are the cross-agent source of truth.

## System Architecture

### Core Concepts
- **Tasks**: The only top-level entity. Live in the `tasks` table. Each task owns a base worktree and a `task_branch`. Tasks group into stage sections (Draft / Ready / Brainstormed / Planned / Implemented / Pushed / Done). `Cancelled` is a separate axis carried by `cancelled_at`, not a stage.
- **Stage runs**: A task progresses through stages by spawning a `task_run` (e.g., a Brainstorm run with 3 candidates). Each run creates N slot sessions, one per candidate.
- **Sessions (slot sessions)**: Children of a `task_run`. Carry `task_id`, `task_run_id`, `slot_key`, `run_role` lineage. Each slot session has its own worktree under the task's directory. Sessions are NOT top-level — the v2 sidebar reads `tasksAtom` exclusively and never iterates `allSessionsAtom`.
- **Orchestrator**: Singleton non-task surface that runs in the main repo worktree with its own agent terminals. Pinned in the sidebar between the header and the stage sections. It is not a task.
- **Artifacts**: Specs, plans, and summaries are artifacts of a task. They live in `task_artifacts` keyed by `(task_id, artifact_kind, is_current)`. The task's initial prompt is its `request_body`; later artifact versions are written via `lucode_task_update_content`. There is no standalone "Spec" entity.
- **Terminals**: Slot sessions and the orchestrator each get 2 PTY terminals (top agent / bottom shell). Task-level and task-run-level selections render a placeholder for the top pane (no agent yet).
- **Domains**: Business logic is organized in `src-tauri/src/domains/` — all new features should create appropriate domain modules. Where legacy domains duplicate the new structure, merge via scout rule.

### Key Data Flows

**Task Creation → Stage Run → Agent Startup:**
1. Task is created (UI or MCP). The backend writes to `tasks`, allocates `task_branch`, and creates the base worktree.
2. User invokes a stage run (e.g., Brainstorm with N candidates). The orchestrator creates a `task_run` with N slot sessions; each slot gets its own worktree under the task's directory.
3. Frontend selection switches to a slot via `SelectionContext` → lazy terminal creation.
4. Agent starts in the slot's top terminal with the slot worktree as cwd.

**MCP API → Task Management:**
- External tools call the REST API (port 8547+hash) → create/update tasks and artifacts.
- Backend emits `SessionsRefreshed` (and task-related events) → UI updates automatically.
- Optional `Selection` event → UI switches to a specific task / slot.

**Task Stage Transitions:**
- Stage advancement is recorded on the task; runs and slot sessions are the work surface for each stage. Cancellation is an orthogonal axis (`cancelled_at`), not a stage.

### Critical Files to Know

**Frontend Entry Points:**
- `App.tsx`: Main orchestration, task/session wiring, agent startup
- `SelectionContext.tsx`: Controls which selection (task / task-run / slot session / orchestrator) and terminals are active
- `src/components/sidebar/Sidebar.tsx`: Reads `tasksAtom` exclusively to render the orchestrator entry plus stage sections

**Backend Core:**
- `main.rs`: Tauri commands entry point
- `lucode_core/mod.rs`: Gateway + database access
- `domains/tasks/`: Tasks, runs, artifacts
- `domains/sessions/`: Slot session lifecycle
- `domains/terminal/manager.rs`: PTY lifecycle management
- `domains/git/worktrees.rs`: Git worktree operations

**Communication Layer:**
- `eventSystem.ts`: Type-safe frontend event handling
- `events.rs`: Backend event emission
- `mcp_api.rs`: REST API for external MCP clients

### State Management (MANDATORY)
- Shared UI/application state lives in Jotai atoms under `src/store/atoms`; expose read-only atoms plus action atoms when updates require side effects.
- Example: `src/store/atoms/fontSize.ts` stores terminal/UI font sizes, updates CSS variables, emits `UiEvent.FontSizeChanged`, and persists via `LucodeCoreSetFontSizes`.
- Reach for Jotai when state crosses components, needs persistence, or must be accessed from tests using the Jotai `Provider`/`createStore`; keep purely local state in React `useState`.
- Access atoms with `useAtomValue`, `useSetAtom`, or `useAtom` instead of creating new context providers for the same data.

## Essential Commands

### Before Completing ANY Task
```bash
just test          # Run ALL validations: TypeScript, Rust lints, and tests
# Or: bun run test  # Same as 'just test'
```
**Why:** Ensures code quality and prevents broken commits. The script runs TypeScript lint + type-checking, MCP lint/tests, frontend vitest, Rust clippy, dependency hygiene (`cargo shear`), `knip`, and Rust tests (`cargo nextest`).

### Test scope discipline (MANDATORY)

`just test` takes ~90s. Running it after every edit is wasteful. Use scoped tests for inner-loop work; reserve `just test` for integration boundaries and pre-commit.

**Inner loop (after each edit):**
- Rust edit: `cargo check` + `cargo nextest run -p lucode <module::path>` matching the touched surface.
  - Edited `domains/tasks/runs.rs` → `cargo nextest run -p lucode domains::tasks::runs`
  - Edited `commands/forge.rs` → `cargo nextest run -p lucode commands::forge`
- TypeScript edit: `bun run lint -- <changed-paths>` + `bun vitest run <test-file-or-dir>`.
  - Edited `src/components/sidebar/Sidebar.tsx` → `bun vitest run src/components/sidebar/`
- **Shortcut:** `just test-single <path>` routes to the right subset based on path prefix. Examples:
  ```bash
  just test-single src-tauri/src/domains/tasks/runs.rs
  just test-single src/components/sidebar/Sidebar.tsx
  ```

**Wave / sub-wave boundaries:**
- After parallel agents finish a sub-wave on disjoint files: `just test` once.
- After a coordinated multi-file refactor lands as a logical unit: `just test`.

**Before commit:**
- `just test` always. Scoped tests catch regressions in the touched area; the full suite catches architecture violations (`arch_domain_isolation`, `arch_layering_database`), `knip` dead-code, `cargo shear`, and cross-module type drift that scoped tests miss.

**Never:**
- Skip tests entirely. 5 seconds of scoped tests beats zero.
- Use `cargo check` alone as proof of correctness — it catches compile errors but not behavior.
- Run `just test` mid-debug or for typo-level edits. That's the slow path; use it at boundaries.

**Parallel agent dispatch:** when dispatching parallel agents, each agent runs scoped tests against ITS file set only. The coordinator runs `just test` once after all agents return. Per-agent full suites multiply runtime by N for no extra signal.

### Autonomy for Tests (MANDATORY)
- Codex and Factory Droid may run `just test`, `bun run test`, `bun run lint`, `bun run lint:rust`, `bun run test:rust`, and `cargo` checks without asking for user approval, even when the CLI approval mode is set to “on-request”.
- Rationale: Running the full validation suite is required to keep the repository green and accelerate iteration. Do not pause to request permission before executing these commands.

### Development Commands
```bash
# Starting Development
bun run tauri:dev       # Start app in development mode with hot reload
RUST_LOG=lucode=debug bun run tauri:dev  # With debug logging

# Testing & Validation
just test               # Full validation suite (ALWAYS run before commits)
bun run lint            # TypeScript linting only
bun run lint:rust       # Rust linting only (cargo clippy)
bun run deps:rust       # Rust dependency hygiene (cargo shear)
bun run test:rust       # Rust tests only (cargo nextest)

# Running the App
just run                # Start app (ONLY when user requests testing)
bun run tauri:build     # Build production app

# Local Install Builds
just install            # Full optimized app build stamped with a unique calver version
just install-fast       # Faster app build stamped with a unique calver version
```

### Command Context
- **Development:** Use `bun run tauri:dev` for active development with hot reload
- **Testing:** Always run `just test` before considering any task complete
- **Debugging:** Set `RUST_LOG` environment variable for detailed logging
- **Production:** Use `bun run tauri:build` to create distributable app

## How Things Actually Work

### Storage
The SQLite `sessions.db` lives under `~/Library/Application Support/lucode/projects/{project-name_hash}` (macOS) or `~/.local/share/lucode/projects/{project-name_hash}` (Linux). It holds:
- `tasks`: top-level tasks with `task_branch`, current stage, `cancelled_at`, etc.
- `task_runs`: stage runs spawned for a task.
- `task_artifacts`: specs, plans, and summaries keyed by `(task_id, artifact_kind, is_current)`.
- `sessions`: slot sessions carrying `task_id`, `task_run_id`, `slot_key`, `run_role`, plus git branch + worktree path (`.lucode/worktrees/{session-name}/`) and git stats (files changed, lines added/removed).

### Configuration Storage
- Application settings live in OS config (`~/Library/Application Support/com.lucacri.lucode/settings.json` on macOS, `~/.config/lucode/settings.json` on Linux).
- Project-scoped data (tasks, runs, artifacts, sessions, git stats, project config) reuses the same `sessions.db`.

### Terminal Management
- **Creation**: Lazy — only when a selection is mounted in UI.
- **Persistence**: Terminals stay alive until explicitly closed.
- **PTY Backend**: `LocalPtyAdapter` spawns shell with the selection's worktree as cwd.
- **Terminal ID rules (critical)**: Terminal IDs are derived **only** from the session name (sanitized) and never include `projectPath`. Tracking caches must use the same ID scope; changing projects should **rebind**, not recreate, existing IDs. Avoid project-scoped cache keys for terminals to prevent resets/remounts.

#### Terminal Roles
The behavior depends on the selection `kind`:
- **`kind: 'session'` or `'task-slot'`**: Top terminal is the agent terminal (xterm bound to the slot session). Bottom terminal is the user shell in the slot's worktree.
- **`kind: 'orchestrator'`**: Both terminals bind to the orchestrator's main-repo worktree (top = orchestrator agent, bottom = user shell).
- **`kind: 'task'` or `'task-run'`** (no slot drilled in): Top pane renders the placeholder `data-testid="task-empty-agent-placeholder"` (no agent). Bottom-pane binding to the task's base worktree is currently deferred.

`TerminalGrid` mounts `terminals.top` from `SelectionContext`; `TerminalTabs` manage `terminals.bottomBase`. Switching selections swaps both panes together; per-tab switches affect only the bottom user terminals.

### Agent Integration
Agents start via terminal commands built in `App.tsx`:
- Each agent runs in the slot session's isolated worktree (or the main-repo worktree for the orchestrator).

### MCP Server Webhook
- Runs on project-specific port (8547 + project hash)
- Receives notifications from external MCP clients
- Updates task/session state and emits UI refresh events


## UI Systems

### Theme System (MANDATORY)

**NEVER use hardcoded colors.** The app supports 10 themes—all colors must come from the theme system so they adapt when users switch themes.

**How to apply colors** (see `src/common/theme.ts` for available color names):
- Tailwind: `className="bg-primary text-primary border-subtle accent-blue"`
- CSS vars: `style={{ backgroundColor: 'var(--color-bg-elevated)' }}`
- TypeScript: `import { theme } from '../common/theme'` → `theme.colors.text.primary`

**Key files:**
- `src/styles/themes/*.css` - CSS variable definitions per theme (`[data-theme="x"]` selectors)
- `src/common/theme.ts` - TypeScript theme object
- `src/common/themes/` - Theme switching logic and presets

**Adding a new theme:** Create CSS file in `src/styles/themes/`, import in `theme.css`, add preset in `presets.ts`, register type in `types.ts`, add to `ThemeSettings.tsx`. Each color needs both hex and RGB values for Tailwind opacity support.

### Font Sizes (MANDATORY)
**NEVER use hardcoded font sizes.** Use theme system:
- Semantic: caption, body, bodyLarge, heading, headingLarge, headingXLarge, display
- UI-specific: button, input, label, code, terminal
- Import: `theme.fontSize.body` or `var(--font-body)`

**Typography helpers**
- All non-code UI text must use the shared system sans stack (`var(--font-family-sans)`, i.e., `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, etc.) and code/terminal text must use the mono stack (`var(--font-family-mono)`, i.e., `SFMono-Regular`, Menlo, Consolas, etc.). These stacks are wired through `theme.fontFamily`.
- Prefer the helpers in `src/common/typography.ts` to pair semantic sizes with the correct line heights. Session cards, spec headings, and terminal labels are guarded by `local/no-tailwind-font-sizes` so Tailwind `text-*` utilities are rejected—reuse those helpers when touching those files.

## Testing Requirements

### TDD (MANDATORY)
Always write tests first, before implementing features:
1. **Red**: Write a failing test that describes the desired behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Improve the implementation while keeping tests green

This applies to both TypeScript and Rust code. The test defines the contract before the implementation exists.

## Specification Writing Guidelines

### Technical Specs (MANDATORY)
When creating specs for implementation agents:
- **Focus**: Technical implementation details, architecture, code examples
- **Requirements**: Clear dependencies, APIs, integration points
- **Structure**: Components → Implementation → Configuration → Phases
- **Omit**: Resource constraints, obvious details, verbose explanations
- **Include**: Platform-specific APIs, code snippets, data flows, dependencies
- When a user asks for a “spec” use the Lucode MCP spec commands instead of creating local plan files. Only create Markdown plan files when the request explicitly mentions a plan file/`.md` output.

### Before ANY Commit
Run `bun run test` - ALL must pass:
- TypeScript linting
- Rust clippy
- Rust dependency hygiene (`cargo shear`)
- **Dead code detection** (`knip` - finds unused files, exports, and dependencies)
- Rust tests

**CRITICAL Rules:**
- Test failures are NEVER unrelated - fix immediately
- NEVER skip tests (no `.skip()`, `xit()`)
- Fix performance test failures (they indicate real issues)
- After every code change, the responsible agent must rerun the full validation suite and report "tests green" before handing the work back. Only proceed with known failing tests when the user explicitly permits leaving the suite red for that task.

**Dead Code Detection:**
- `knip` runs automatically as part of `bun run test`
- Reports unused files, exports, types, and dependencies
- Configured in `knip.json` to ignore test utilities and type declarations
- Use `--no-exit-code` flag to prevent blocking CI on warnings
- Review knip output regularly and clean up reported issues

## Event System

### Type-Safe Events (MANDATORY)
**NEVER use string literals for events.**

Frontend:
```typescript
import { listenEvent, SchaltEvent, listenTerminalOutput } from '../common/eventSystem'
await listenEvent(SchaltEvent.SessionsRefreshed, handler)
await listenTerminalOutput(terminalId, handler)
```

Backend:
```rust
use crate::events::{emit_event, SchaltEvent};
emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions)?;
```

### Tauri Commands (MANDATORY)
- NEVER call `invoke('some_command')` with raw strings in TS/TSX.
- ALWAYS use the centralized enum in `src/common/tauriCommands.ts`.
- Example: `invoke(TauriCommands.LucodeCoreCreateSession, { name, prompt })`.
- When adding a new backend command/event:
  - Add the entry to `src/common/tauriCommands.ts` (PascalCase key → exact command string).
  - Use that enum entry everywhere (including tests) instead of string literals.
  - If renaming backend commands, update the enum key/value and fix imports.
- The one-time migration script used during the enum rollout has been REMOVED; keep the enum current manually.

## Critical Implementation Rules

### Session Lifecycle
- NEVER cancel sessions automatically
- NEVER cancel on project close/switch/restart
- ALWAYS require explicit confirmation for bulk operations
- ALWAYS log cancellations with context

### Terminal Lifecycle
1. Creation: PTY spawned on first access
2. Switching: Frontend switches IDs, backend persists
3. Cleanup: All processes killed on exit

### Single Source of Truth (CRITICAL)
When multiple components need to track shared state (e.g., "has this resource been initialized?"), use ONE centralized module. Never duplicate tracking across files.

- Example: Terminal start state lives in `src/common/terminalStartState.ts` - both `agentSpawn.ts` and `Terminal.tsx` use it
- Before adding a new Set/Map for tracking, check if one already exists and consolidate

### useEffect Dependencies (CRITICAL)
Unstable useEffect dependencies cause component remounts and double-execution:

- **Problem:** Values that start as `null` and update async (like fetched settings) trigger effect re-runs
- **Solution:** Initialize with synchronous defaults, or use refs for values that shouldn't trigger re-renders
- **Pattern:** For terminal config, we use Jotai atoms with synchronous defaults (`buildTerminalFontFamily(null)`) so the initial render has stable values

**Example of what NOT to do:**
```typescript
const [fontFamily, setFontFamily] = useState<string | null>(null) // Starts null!
useEffect(() => { loadSettings().then(s => setFontFamily(s.font)) }, [])
useEffect(() => { /* This runs TWICE - once with null, once with loaded value */ }, [fontFamily])
```

### Code Quality

**Dead Code Policy (CRITICAL)**
- `#![deny(dead_code)]` in main.rs must NEVER be removed
- NEVER use `#[allow(dead_code)]`
- Either use the code or delete it

**Non-Deterministic Solutions PROHIBITED**
- NO timeouts, delays, sleep (e.g., `setTimeout`, `sleep`) in application logic or test code.
  - This restriction does not apply to operational safeguards like wrapping long-running terminal commands
    with a timeout to prevent the CLI from hanging during manual workflows.
- NO retry loops, polling (especially `setInterval` for state sync!)
- NO timing-based solutions
- These approaches are unreliable, hard to maintain, and behave inconsistently across different environments

**Preferred Deterministic Solutions**
- Use event-driven patterns (event listeners, callbacks)
- Leverage React lifecycle hooks properly (useEffect, useLayoutEffect)
- Use requestAnimationFrame for DOM timing (but limit to visual updates)
- Implement proper state management with React hooks
- Use Promise/async-await for sequential operations
- Rely on component lifecycle events (onReady, onMount)
- ALWAYS prefer event callbacks over polling for UI state management

Example: Instead of `setTimeout(() => checkIfReady(), 100)`, use proper event listeners or React effects that respond to state changes.

**Error Handling (MANDATORY)**
- NEVER use empty catch blocks
- Always log with context
- Provide actionable information

### Comment Style (MANDATORY)
- Do not use comments to narrate what changed or what is new.
- Prefer self-documenting code; only add comments when strictly necessary to explain WHY (intent/rationale), not WHAT.
- Keep any necessary comments concise and local to the logic they justify.

## Logging

### Configuration
```bash
RUST_LOG=lucode=debug bun run tauri:dev  # Debug our code
RUST_LOG=trace bun run tauri:dev             # Maximum verbosity
```

### Location
macOS: `~/Library/Application Support/lucode/logs/lucode-{timestamp}.log`

### Quick Access
- Each backend launch prints the log path; grab the latest file with:
  ```bash
  LOG_FILE=$(ls -t ~/Library/Application\ Support/lucode/logs/lucode-*.log | head -1)
  tail -n 200 "$LOG_FILE"
  ```
- Works from main or any session worktree—no repo navigation required.
- Frontend calls log through `src/utils/logger.ts`; entries show up with a `[Frontend]` prefix in the same file.

### Best Practices
- Include context (IDs, sizes, durations)
- Log at boundaries and slow operations
- Never log sensitive data

## MCP Server Integration

- Use REST API only (never direct database access)
- Stateless design
- All operations through `src-tauri/src/mcp_api.rs`
- Rebuild after changes: `cd mcp-server && bun run build`

## Local Build Versioning

- `just install` and `just install-fast` stamp a unique semver-safe calver into the app build before bundling.
- The running macOS app compares its own version with `/Applications/Lucode.app` and emits a restart toast when a newer local build is installed.
- `just run` stays in development mode and does not stamp versions.

## Development Workflow

1. Make changes
2. Run `bun run lint` (TypeScript)
3. Run `bun run lint:rust` (Rust)
4. Run `bun run test` (full validation)
5. Test: `bun run tauri:dev`
6. Only commit when all checks pass

## Important Notes

- Terminal cleanup is critical
- Each session creates 3 OS processes
- Document keyboard shortcuts in SettingsModal
- Performance matters - log slow operations
- No comments in code - self-documenting only
- Fix problems directly, no fallbacks/alternatives
- All code must be used now (no YAGNI)
- Always use the project 'logger' with the appropriate log level instead of using console logs when introducing logging
- Session database runs with WAL + `synchronous=NORMAL` and a pooled connection manager (default pool size `4`, override with `LUCODE_DB_POOL_SIZE`). Keep this tuned rather than reverting to a single shared connection.

## Plan Files

- Store all plan MD files in the `plans/` directory, not at the repository root
- This keeps the root clean and organizes planning documents
- If you create plans research the codebase or requested details first before making a plan for the implementation
- Don't make plans for making plans, rather do the planning ahead and then implement

## Documentation

- Project documentation is maintained in `docs-site/` using Mintlify
- MDX files in `docs-site/` cover core concepts, guides, MCP integration, and installation
