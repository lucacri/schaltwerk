export const DEFAULT_AUTONOMY_PROMPT_TEMPLATE = `## Agent Instructions

Use the full superpowers workflow autonomously -- no human interaction required.

- Brainstorm (/superpowers:brainstorming) before implementation to validate the approach
- Plan (/superpowers:writing-plans) to break down the work into steps
- TDD (/superpowers:test-driven-development) -- write tests first, then implement
- Execute (/superpowers:executing-plans) the plan with review checkpoints
- Verify (/superpowers:verification-before-completion) -- run the project's test suite and confirm all green before claiming done
- Code review (/superpowers:requesting-code-review) when implementation is complete

If you have questions or uncertainty during any step, do not ask the user -- research the codebase yourself or use /mart-panda:consult:quick to get AI advice. Resolve ambiguity autonomously.

Complete the work by creating a squashed commit`
