# Lucode MCP Server - Prompting Guide

This guide helps AI assistants effectively use the Lucode MCP server for managing development sessions.

## System Prompt for AI Assistants

When the Lucode MCP server is available, you can manage development sessions directly. Here's how to use it effectively:

### 🔒 Critical Security Guidelines

**SESSION PROTECTION IS PARAMOUNT:**
- **Never cancel or delete sessions without explicit user consent** - especially sessions marked as 'reviewed'
- **Only cancel reviewed sessions after successful merge to main branch and passing tests**
- **Preserve Git state for all failed operations** - never delete sessions that fail to merge
- **Always validate before operations** - check git status, ensure clean working tree, verify on correct branch
- **Test after merge operations** - run tests and only proceed if they pass
- **Send follow-up messages for issues** - don't force merge problematic sessions
- **Git recovery awareness** - commits can be recovered from Git history, but uncommitted changes are permanently lost
- **If MCP server is not accessible, ask user for help immediately** - do not attempt manual operations

### Merge Workflow Security

**CRITICAL MERGE PROCESS:**
- **First merge main into session branch** to resolve conflicts before merging back
- **Understand Git diffs after merging main**: Files appearing as "removed" are actually files added to main after session creation - these are NORMAL and should not be considered session deletions
- **Focus on what the session ADDS** (new files, modifications) - ignore apparent "deletions" of files that existed in main but not in session branch point
- **Run tests after merge attempts** - only proceed with cancellation if tests pass
- **Send follow-up messages for merge issues** - don't force merge when conflicts or issues arise

**Validation Criteria for Merges:**
- ✅ **PROCEED**: Small mechanical conflicts, clean diffs (ignoring false deletions), tests pass
- ❌ **SEND FOLLOW-UP**: Compilation failures, test failures, complex conflicts, unclear changes, obvious regressions
- ❓ **ASK USER**: Content duplication, unclear session purpose, strategic decisions

**Follow-up Message Strategy:**
- **Technical issues agents can fix**: Send descriptive messages explaining specific problems (compilation errors, integration issues, merge conflicts)
- **Strategic issues**: Ask user for guidance on duplication, purpose clarification, or complex decisions
- **When in doubt**: Send follow-up for technical issues, ask user for strategic issues

**Decision Making Philosophy:**
- **Automation handles**: Simple conflicts, mechanical merges, integration coordination
- **Agents handle**: Complex conflicts, code logic issues, feature-specific problems
- **User handles**: Content duplication decisions, strategic choices, session purpose clarification
- **Git State Protection**: NEVER delete/cancel sessions unless successfully merged - all failed merges preserve Git state

**Git Recovery (if commits exist):**
```
# Check if commits still exist in git database
git cat-file -t <commit-hash> 2>/dev/null && echo "Recoverable!"

# Recover from commit hash
git checkout -b recover-session <commit-hash>

# Merge to main
git checkout main && git merge --squash recover-session
git commit -m "Recover lost session: <description>"
```

**⚠️ Remember**: Uncommitted changes in worktrees are permanently lost when cancelled - commits in git database can be recovered.

**Reviewed Sessions Protection:**
- Sessions marked as 'reviewed' represent validated, approved work ready for integration
- These sessions should only be cancelled after successful merge validation
- Never delete reviewed sessions due to perceived invalidity - seek user guidance instead
- Preserve all Git commits and history even after session operations

### Session Management Capabilities

You have access to tools for managing Lucode sessions:

1. **lucode_create** - Create new isolated development sessions
2. **lucode_list** - View all sessions with their review status
3. **lucode_cancel** - Remove abandoned sessions

### Creating Effective Sessions

When creating sessions with `lucode_create`, follow these guidelines:

#### Good Session Names
- Use descriptive, hyphenated names: `user-auth`, `api-endpoints`, `fix-login-bug`
- Keep names under 30 characters
- Use only alphanumeric, hyphens, and underscores

#### Good Initial Prompts
Be specific and detailed in your prompts:

✅ **GOOD PROMPTS:**
- "Implement user authentication with JWT tokens, including login, logout, and password reset functionality"
- "Fix the bug where users cannot log in with email addresses containing special characters"
- "Add REST API endpoints for CRUD operations on the Product model with proper validation"
- "Refactor the payment processing module to use the Strategy pattern for different payment providers"

❌ **BAD PROMPTS:**
- "Fix bug"
- "Add feature"
- "Make it work"
- "Update code"

#### Agent Type Selection
- Use `"claude"` for general development agents (default)
- Use `"terminal"` for manual work without AI agents - opens only a usable terminal
- Supported agents automatically start with permission bypass enabled; terminal mode remains manual.

### Monitoring Sessions

Use `lucode_list` to monitor session status:

```javascript
// Get human-readable list
lucode_list()

// Get JSON for parsing
lucode_list({ json: true })
```

Look for:
- **[NEW]** - Sessions needing review
- **[REVIEWED]** - Sessions ready to merge
- Agent type used for each session
- Last modification time

### Best Practices

1. **Parallel Development**: Create multiple sessions for different features
2. **Clear Naming**: Use descriptive session names that reflect the work
3. **Detailed Prompts**: Provide comprehensive context in initial prompts
4. **Regular Monitoring**: Check session status periodically
5. **Safe Session Management**:
   - Use `lucode_pause` instead of `lucode_cancel` when uncertain about session state
   - Never cancel reviewed sessions without successful merge validation
   - Preserve Git state for all session operations
   - Ask user for help if MCP server operations fail or are unclear
6. **Merge Validation**: Always validate merges with tests before considering sessions complete

### Example Workflows

#### Starting a New Feature
```
"I'll create a new Lucode session for the authentication feature."
Use: lucode_create(
  name: "user-authentication",
  prompt: "Implement complete user authentication system with registration, login, JWT tokens, password reset via email, and session management",
  agent_type: "claude"
)
```

#### Managing Multiple Sessions
```
"Let me check the status of all development sessions."
Use: lucode_list()

"I see there are 3 new sessions and 2 reviewed ones. Let me get details."
Use: lucode_list({ json: true })
```

#### Cleaning Up (SAFE OPERATIONS ONLY)
```
"For experimental sessions that are fully committed and merged, I can safely remove them."
Use: lucode_cancel(session_name: "experiment-feature", force: true)  // ONLY after merge validation

"For uncertain sessions, use pause instead:"
Use: lucode_pause(session_name: "uncertain-session")  // SAFE - preserves all work
```

## Prompt Templates for Common Agents

### Feature Development
```
Create a session for [FEATURE]:
- Break down the feature into components
- Implement with test coverage
- Follow existing code patterns
- Document as needed

lucode_create(
  name: "[feature-name]",
  prompt: "Implement [FEATURE] including [SPECIFIC REQUIREMENTS]. Ensure proper error handling, validation, and test coverage."
)
```

### Bug Fixes
```
Create a session to fix [BUG]:
- Identify root cause
- Implement fix
- Add regression tests
- Verify no side effects

lucode_create(
  name: "fix-[bug-identifier]",
  prompt: "Fix the bug where [SPECIFIC BUG DESCRIPTION]. Add tests to prevent regression."
)
```

### Refactoring
```
Create a session for refactoring [MODULE]:
- Maintain functionality
- Improve code quality
- Ensure tests pass
- Document changes

lucode_create(
  name: "refactor-[module]",
  prompt: "Refactor [MODULE] to [IMPROVEMENT GOAL] while maintaining all existing functionality and tests."
)
```

## Integration with Orchestrator Pattern

When acting as an orchestrator managing multiple AI agents:

1. **Create Sessions for Each Agent**
   ```
   lucode_create(name: "agent1-agent", prompt: "...")
   lucode_create(name: "agent2-agent", prompt: "...")
   ```

2. **Monitor Progress**
   ```
   lucode_list({ json: true }) // Parse and track status
   ```

3. **Coordinate Work**
   - Check for reviewed sessions ready to merge
   - Identify blocked or failed sessions
   - Clean up completed work

4. **Cleanup**
   ```
   lucode_cancel(session_name: "completed-agent")
   ```

### Worktree Setup Script (bootstrap new worktrees)
- Always fetch the current script first with `lucode_get_setup_script` before making any changes.
- Inspect the repo for untracked config/secrets that need to be present in worktrees (e.g., `.env`, `.env.local`, `.npmrc`, tool auth files), then confirm with the user which ones to copy.
- Edit locally, then replace it via `lucode_set_setup_script` (include the shebang). It runs once per worktree with `WORKTREE_PATH`, `REPO_PATH`, `SESSION_NAME`, `BRANCH_NAME` env vars.
- Keep it short and idempotent: copy `.env` files, install local deps, create needed folders—avoid global installs or interactive prompts.
- **Safety:** The Lucode UI will prompt the user to confirm before saving changes to the setup script.

## Error Handling

Common errors and solutions:

- **"Session already exists"**: Use a different name or cancel the existing session first
- **"Repository not found"**: Ensure you're in a Git repository
- **"Database connection failed"**: Check that Lucode app has been run at least once
- **"Branch creation failed"**: Verify the base branch exists and you have permissions

## Resources

Access session data programmatically:

- `lucode://sessions` - Full session list with metadata
- `lucode://sessions/reviewed` - Only reviewed sessions
- `lucode://sessions/new` - Only unreviewed sessions
- `lucode://skills` - Workflow registry with native agent entrypoints
- `lucode://skills/consolidate` - Canonical consolidation workflow instructions

Use these resources to build custom workflows and monitoring.

## Cross-Agent Workflow Discovery

- Prefer the shared Lucode skill files under `.agents/skills/` when your agent supports repo-scoped skills.
- For Claude-specific UX, the repo also publishes wrapper files under `claude-plugin/`.
- For OpenCode slash-command UX, the repo also publishes wrappers under `.opencode/commands/`.
- If your agent has no native Lucode wrapper support, read `lucode://skills` first and then load the specific workflow resource you need.
