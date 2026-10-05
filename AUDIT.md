# Editor and UX audit — 2026-10-05

Scope: screenshot scrolling issue, editor layout, keyboard navigation, draft lifecycle, submission state, mode accessibility, and existing paste-viewer flows. Findings were checked against code and Chromium behavior before fixing. This is not a comprehensive security assessment.

## Confirmed and fixed

| Location | Issue | Resolution |
| --- | --- | --- |
| `src/styles.ts` | Textarea was only 109px tall at a 1650×990 viewport, leaving most of the page unusable and scrolling after a few lines. | Constrain landing layout to the dynamic viewport; stretch textarea within the remaining flex space. It now measures 818px at that viewport. |
| `src/client/landing.ts` | Tab and Shift+Tab inserted spaces and trapped keyboard users inside the editor. | Restore native keyboard navigation to controls. |
| `src/client/landing.ts` | Enter in a list inserted a new item without replacing selected text. | Use both selection boundaries; leave IME composition alone. |
| `src/client/landing.ts` | Reloading within the 400ms debounce lost the latest draft. | Flush dirty drafts on pagehide and when the page becomes hidden. |
| `src/client/landing.ts` | Pending draft writes recreated a saved draft; discard also left a pending timer. | Cancel writes on successful save of unchanged content and on discard; preserve edits made during the request. Clear stale restored-draft badge after saving. |
| `src/client/landing.ts` | Malformed successful JSON escaped the handler and left Save disabled. | Validate response parsing and paste ID, show an error, restore the button. |
| `src/index.ts` | On phones, hidden full label plus aria-hidden short label removed the Plaintext radio's accessible name. | Give the radio an explicit name. |
| `src/client/landing.ts` | Changing expiration during a pending save made the success dialog claim the new duration rather than the submitted duration. | Capture the label alongside the submitted expiration. |

## Rejected findings / existing behavior verified

- Short-screen success modal controls: reachable at 844×320 without a fix; retained as regression coverage.
- Long content requires a scrollbar once it exceeds the available editor height. That is expected; premature scrolling was the bug.
- Split preview: both panes fill the available height and scroll independently; existing equal-width test passes.
- Expiry listbox already supports keyboard selection, Escape, and default highlighting.
- Existing encryption/decryption, burn confirmation, plaintext rendering, sanitizer, raw view, download, and draft restore tests pass.
- No broad refactor was justified by this audit. Removed the keyboard trap handler and consolidated draft persistence into one function.

## Verification

- Build, TypeScript check, Biome lint, and whitespace checks pass.
- 55 Bun unit/integration tests pass.
- 29 Chromium browser tests pass (12 new regression cases).
- Desktop and phone screenshots inspected; landscape layout tested.
- Physical mobile keyboard behavior and other browser engines were not tested.

Follow-up: removed the inset amber focus stripe at the user’s request; the editor remains undecorated while focused.
