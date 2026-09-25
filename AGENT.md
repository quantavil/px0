# AGENT.md - px0 Project Architecture & Memory

## Structure
- `src/index.ts`: Hono Cloudflare Worker app (SSR HTML, REST API, security headers, KV store ops).
- `src/client/`: TypeScript client sources (`landing.ts`, `viewer.ts`, `shared.ts`) minified into `public/`.
- `src/client/shared.ts`: Shared `renderMarkdown()` parser, WebCrypto AES-256-GCM helpers, sanitization.
- `src/utils.ts`: Short ID generator, base64url codecs, TTL maps, `__PX0_*` sentinel prefixes.
- `src/icons.ts`: Zero-dependency SVG stroke icons.
- `src/styles.ts`: Obsidian theme CSS tokens (`CSS_VARIABLES`) and component stylesheets.
- `test/index.test.ts`: Bun unit test suite (47 tests).
- `e2e/pastebin.spec.ts`: Playwright real-browser integration suite (16 tests).
- `.github/workflows/ci.yml`: CI workflow validating lint, types, client build drift, and tests.

## Critical Blunders & Learnings
- **Hono HTML JSON Escaping:** `html` template escapes quotes in JSON. Fix: Wrap embedded script data in `${raw(safeJsonData)}`.
- **Base64URL Padding:** Web Crypto raw key output lacks `=` padding, breaking `atob()`. Fix: Restore padding via `decodeBase64Url()`.
- **Uint8Array Buffer Offset Slicing:** Passing `salt.buffer` from `.slice()` passes parent ArrayBuffer. Fix: Pass `salt` (`Uint8Array<ArrayBuffer>`) directly.
- **Sanitize HTML Order:** Escaping `<>` before `marked.parse()` breaks blockquotes. Fix: Parse markdown first, then sanitize HTML via `DOMParser`/regex.
- **Unified Markdown Renderer:** Server SSR and client browser must share identical marked config in `shared.ts` to prevent divergence.
- **Delete Token Header:** Sending delete tokens in query params leaks write credentials in access logs. Fix: Send via `X-Delete-Token` header.
- **Burn Interstitial Bot Protection:** Automated prefetchers consume burn-once links. Fix: Interstitial confirmation before consuming burn pastes.
- **Burn-After-Read Hash Loss:** Navigation to `?confirm=1` drops URL hash. Fix: Append `window.location.hash` to `#revealBtn`.
- **Ad-Block Filter Collisions:** Generic `#shareUrl` IDs get hidden by ad-block filters. Fix: Use `#pxModalOverlay` and `#pxPasteUrl`.
- **Submit Double-Firing:** Rapid Ctrl+S during encrypt/network created duplicate pastes. Fix: Guard submission with `isSubmitting` flag.
- **New Paste Reloading View:** Modal "New Paste" called `location.reload()` on `/:id`. Fix: Navigate to `/` (`window.location.href = "/"`) instead.
- **SSR Delete Button Hygiene:** Plaintext pastes rendered `#deleteBtn` in SSR for strangers. Fix: Default `#deleteBtn` to `display: none` in SSR.
- **Obsidian Pinned:** Single theme set statically on `<html data-theme="obsidian">` — no toggle, no bootstrap script, no CSP hash.
- **Viewer Natural Scroll:** Avoid pinning sticky footer over article content. Use natural document flow with footer resting at article bottom (`margin-top: auto`).
