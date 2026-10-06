# AGENT.md - px0 Project Architecture & Memory

## Structure
- `src/index.ts`: Hono Cloudflare Worker app (SSR HTML, REST API, security headers, KV store ops).
- `src/client/`: TypeScript client sources (`landing.ts`, `viewer.ts`, `preview.ts`, `shared.ts`) minified into `public/`.
- `src/client/shared.ts`: Lightweight client utilities (clipboard, base64url, time formatting, URL validation).
- `src/client/preview.ts`: Dedicated lazy-loaded preview module with marked parser, sugar-high syntax highlighting, and DOMPurify sanitization.
- `src/utils.ts`: Short ID generator, base64url codecs, TTL maps, `__PX0_*` sentinel prefixes.
- `src/client/image-compress.ts`: Client-side native WebP image compression helper.
- `src/icons.ts`: Zero-dependency SVG stroke icons.
- `src/styles.ts`: Obsidian theme CSS tokens (`CSS_VARIABLES`) and component stylesheets; minified during build via Bun into `public/*.min.css`.
- `test/index.test.ts`: Bun unit test suite (47 tests).
- `test/image.test.ts`: Bun unit test suite for strict CSP, /api/image removal, and markdown reference-style WebP rendering.
- `test/client-image-compress.test.ts`: Bun unit test suite for client-side WebP image compression logic.
- `e2e/pastebin.spec.ts`: Playwright real-browser integration suite (16 tests).
- `e2e/image-upload.spec.ts`: Playwright browser suite for image compression, reference links, drag-and-drop, paste, and accessibility (16 tests).
- `.github/workflows/ci.yml`: CI workflow validating lint, types, client build drift, and tests.

## Critical Blunders & Learnings
- **Hono HTML JSON Escaping:** `html` template escapes quotes in JSON. Fix: Wrap embedded script data in `${raw(safeJsonData)}`.
- **Base64URL Padding:** Web Crypto raw key output lacks `=` padding, breaking `atob()`. Fix: Restore padding via `decodeBase64Url()`.
- **Uint8Array Buffer Offset Slicing:** Passing `salt.buffer` from `.slice()` passes parent ArrayBuffer. Fix: Pass `salt` (`Uint8Array<ArrayBuffer>`) directly.
- **Sanitize HTML Order:** Escaping `<>` before `marked.parse()` breaks blockquotes. Fix: Parse markdown first, then sanitize HTML via `DOMParser`/regex.
- **Unified Markdown Renderer:** Server SSR and client browser must share identical marked config in `preview.ts` to prevent divergence.
- **Delete Token Header:** Sending delete tokens in query params leaks write credentials in access logs. Fix: Send via `X-Delete-Token` header.
- **Burn Interstitial Bot Protection:** Automated prefetchers consume burn-once links. Fix: Interstitial confirmation before consuming burn pastes.
- **Burn-After-Read Hash Loss:** Navigation to `?confirm=1` drops URL hash. Fix: Append `window.location.hash` to `#revealBtn`.
- **Ad-Block Filter Collisions:** Generic `#shareUrl` IDs get hidden by ad-block filters. Fix: Use `#pxModalOverlay` and `#pxPasteUrl`.
- **Submit Double-Firing:** Rapid Ctrl+S during encrypt/network created duplicate pastes. Fix: Guard submission with `isSubmitting` flag.
- **New Paste Reloading View:** Modal "New Paste" called `location.reload()` on `/:id`. Fix: Navigate to `/` (`window.location.href = "/"`) instead.
- **SSR Delete Button Hygiene:** Plaintext pastes rendered `#deleteBtn` in SSR for strangers. Fix: Default `#deleteBtn` to `display: none` in SSR.
- **Obsidian Pinned:** Single theme set statically on `<html data-theme="obsidian">` — no toggle, no bootstrap script, no CSP hash.
- **Viewer Natural Scroll:** Avoid pinning sticky footer over article content. Use natural document flow with footer resting at article bottom (`margin-top: auto`).
- **CSS Minification Build Cycle:** Statically importing generated `public/*.min.css` in `src/styles.ts` breaks `build:css` on fresh clones. Fix: Keep `src/styles.ts` as pure source styles and import minified assets directly in `src/index.ts`.
- **Decryption vs Preview Script Isolation:** Load `/static/preview.js` only after successful decryption. Network failures must never report "Decryption Failed" or hide actions. Display at most `MAX_RENDER_CHARS` as safe preformatted text; preserve full copy/download content.
- **Generated Asset Drift:** CI runs `bun run build` before checking `public/`, covering both client JavaScript and minified CSS.
- **Client-Side WebP Compression & Strict CSP:** Images are compressed entirely on the client via native Canvas WebP bounded to 1280px and quality 0.65, inserted as clean Markdown reference links (`![name][fig-N]`) with data URIs appended to the bottom. Content-Security-Policy `img-src` is strictly locked to `'self' data:`. Third-party proxying (Catbox) and backend image endpoints are eliminated for end-to-end privacy and zero external dependencies.
