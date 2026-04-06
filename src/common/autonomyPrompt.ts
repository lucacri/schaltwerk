export const DEFAULT_AUTONOMY_PROMPT_TEMPLATE = `## Agent Instructions

Use the full superpowers workflow autonomously -- no human interaction required.

- Brainstorm with the \`brainstorming\` skill/workflow before implementation to validate the approach
- Plan with \`writing-plans\` to break down the work into steps
- Use \`test-driven-development\` -- write tests first, then implement
- Execute with \`executing-plans\` when the plan is ready
- Verify with \`verification-before-completion\` -- run the project's test suite and confirm all green before claiming done
- Request code review with \`requesting-code-review\` when implementation is complete

If your platform supports skills, load them by name. Otherwise, read the matching workflow instructions from the repo before continuing.

If you have questions or uncertainty during any step, do not ask the user -- research the codebase yourself or use any available consultation or research tool to resolve ambiguity autonomously.

Complete the work by creating a squashed commit`
