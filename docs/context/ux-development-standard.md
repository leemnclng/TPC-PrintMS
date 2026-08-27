# UX Development Standard

Use this checklist for every user-facing feature. Define the complete interaction before writing the control that starts it.

## Choose the Interaction Pattern

- Use a modal for a focused create action launched from a list or detail view when the user should remain in that context.
- Close a create modal only after a successful response, then insert or reload the created record where the user can see it.
- Keep the modal open on failure and preserve entered values.
- Use a dedicated workspace for complex editing, multi-step work, large previews, or tasks that need their own URL.
- Use inline editing only for small, reversible changes with an obvious saved state.
- Confirm only irreversible or high-impact actions. Prefer visible rollback or Undo for reversible actions.

## Required States

Every data view must handle loading, ready, empty, error, and retry states. Every action must handle idle, validation error, submitting, success, and request failure states.

- Prevent duplicate submissions while a request is active.
- Keep success silent when the result is already visible.
- Show actionable errors near the affected control and retain the user’s input.
- Never display fabricated placeholder records or metrics.

## Forms

- Use visible labels; placeholders provide examples only.
- Validate after a field is touched, then revalidate while it changes.
- Explain what is invalid and what the user should do next.
- Keep input geometry stable across default, hover, focus, error, and disabled states.
- Match adjacent control heights and preserve helper/error message space.
- Put the primary action last in the visual and keyboard flow; use specific verbs such as `Create product` or `Save changes`.

## Modals and Overlays

- Prefer native `<dialog>` for focus trapping and background isolation.
- Focus the first useful field on open and restore focus to the trigger on close.
- Support Escape, backdrop click, and an explicit Cancel or Close action unless submission is in progress.
- Keep the header and actions visible while long form content scrolls.
- Fit within the viewport at 320, 375, 414, and 768 CSS pixels.
- Respect reduced-motion preferences.

## Accessibility and Responsiveness

- All actions must work with keyboard, pointer, and touch.
- Preserve visible `:focus-visible` rings and 44 × 44 CSS-pixel touch targets.
- Associate errors and helper text with their fields using ARIA attributes.
- Never rely on color alone for state.
- Avoid horizontal page scrolling and two-line button labels.

## Definition of Done

Before handing off a user-facing feature:

1. Walk the happy path from trigger to visible result.
2. Test cancellation, invalid input, duplicate submission prevention, and API failure recovery.
3. Check loading, empty, error, and populated states around the changed view.
4. Verify keyboard focus, Escape behavior, and focus restoration.
5. Check responsive layout and reduced motion.
6. Run the relevant build, lint, and automated tests.
7. Update the context functionality, decisions, progress, change, and issues documents as applicable.
