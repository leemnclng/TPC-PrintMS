# Agent Instructions

Keep responses short and concise.

## Project Context Workflow

Use `docs/context` as the shared memory for this app.

Before starting development:

1. Read `docs/context/README.md`.
2. Check `docs/context/functionality-map.md` for existing app behavior.
3. Check `docs/context/issues-log.md` for known problems or blockers.
4. Check `docs/context/decisions.md` for prior technical or product decisions.
5. For user-facing work, read `docs/context/ux-development-standard.md` and apply its interaction, state, validation, accessibility, and verification checklist.

During development:

- Prefer existing documented behavior unless the user asks to change it.
- Choose the interaction pattern before coding. Keep lightweight creation in context with a modal; use a dedicated workspace for complex or long-running editing.
- Implement the complete user flow, not only the happy-path control: cancellation, validation, loading, failure recovery, success behavior, keyboard use, and responsive layout are required.
- If implementation reveals a new issue, add it to `docs/context/issues-log.md`.
- If a meaningful decision is made, add it to `docs/context/decisions.md`.
- Keep docs updates focused and factual.

After each meaningful change:

1. Add a brief entry to `docs/context/progress-log.md`.
2. Add user-facing changes to `docs/context/change-log.md`.
3. Update `docs/context/functionality-map.md` when app behavior changes.
4. Update or resolve related rows in `docs/context/issues-log.md`.

Do not let context docs replace tests or code comments. Use them to preserve project history, current functionality, open issues, and development rationale.
