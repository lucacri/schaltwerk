# Improve AI Generation Settings UX

## Problem
The AI Generation settings section is bare, has bad UX, and the model override is inflexible (hardcoded `--model` injection). Users need more control over CLI arguments and prompts.

## Design

### Backend: Expand `GenerationSettings`
Replace `model: Option<String>` with:
- `cli_args: Option<String>` — arbitrary CLI args passed to the agent (user adds `--model X` if desired)
- `name_prompt: Option<String>` — custom prompt for session name generation
- `commit_prompt: Option<String>` — custom prompt for commit message generation

Migration: Convert existing `model` → `cli_args` with `--model <value>`.

### Backend: Simplify `resolve_generation_agent_and_args()`
Remove hardcoded `--model` injection. Instead, merge `generation.cli_args` with the agent's own CLI args.

### Frontend: Redesign Settings Panel
- Provider dropdown (same agents)
- CLI Arguments text input (mono font, placeholder matching agent config page)
- Collapsible "Prompts" section with textareas for name/commit prompts
- Show defaults as placeholders so users know what they're replacing

### Prompt Template Variables
- Name prompt: `{task}` placeholder for the truncated prompt
- Commit prompt: `{commits}` and `{files}` placeholders for commit subjects and file summary
