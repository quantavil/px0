# AGENT.md - px0 Project Architecture & Memory

## Structure
- `src/index.ts`: Hono worker app (routes `/`, `/api/paste`, `/raw/:id`, `/:id`, `/static/*`, security headers, KV store ops).
- `src/client/`: Browser TypeScript source (`landing.ts`, `viewer.ts`, `shared.ts`) compiled via Bun into `public/`.
- `src/client/shared.ts`: Single `renderMarkdown()` renderer, Web Crypto AES-256-GCM / PBKDF2 crypto, clipboard & base64 helpers.
- `src/utils.ts`: Short ID generation, HTML sanitization, base64url utils, TTL maps, sentinel prefixes (`__PX0_*`).
- `src/icons.ts`: Reusable inline SVG icons sized by CSS containers.
- `src/styles.ts`: CSS design tokens (`CSS_VARIABLES`) and component styles (`BASE_CSS`, `LANDING_CSS`, `VIEWER_CSS`, etc.).
- `biome.json`: Biome linter and formatter configuration.
- `test/index.test.ts`: Bun unit test suite.
- `e2e/pastebin.spec.ts`: Playwright E2E integration test suite.
- `wrangler.json`: Cloudflare Workers config binding `PASTES_KV`.

## Critical Blunders & Technical Learnings
- **Hono HTML JSON Escaping:** `html` template escapes quotes in JSON. Fix: Wrap script data in `${raw(safeJsonData)}` or use external static JS.
- **Base64URL Padding:** Web Crypto raw key output lacks `=` padding, causing `atob()` to throw. Fix: Restore padding via `decodeBase64Url()`.
- **Uint8Array Spread Stack Overflow:** `String.fromCharCode(...bytes)` throws `RangeError` on large payloads. Fix: Chunked loop in `bytesToBase64()`.
- **Uint8Array Buffer Offset Slicing:** Passing `iv.buffer` from `.slice()` passes the parent ArrayBuffer to Web Crypto. Fix: Pass Uint8Array view `iv` directly.
- **DOM ReadyState Script Execution:** Deferred scripts execute when `readyState` is already `'interactive'`. Fix: Check `readyState` before binding `DOMContentLoaded`.
- **Sanitize HTML Order:** Escaping `>` before `marked.parse()` breaks blockquotes. Fix: Parse markdown first, post-sanitize rendered HTML via `sanitizeOutputHtml()`.
- **Sentinel Prefix Collision:** Plaintext starting with generic tags triggers incorrect control flow. Fix: Use unambiguous prefixes `__PX0_BURN__:`, `__PX0_PASS__:`, `__PX0_ENC__:`.
- **KV Expiry Metadata:** KV `get()` doesn't expose key expiration. Fix: Store `{ createdAt, ttlSeconds }` in KV metadata on write and compute expiry.
- **KV TypeScript Typing:** `@cloudflare/workers-types` requires `getWithMetadata()` over `get(..., { metadata: true })` for correct type resolution.
- **Unified Markdown Renderer:** Server and client must share one `renderMarkdown()` (`src/client/shared.ts`) to avoid parsing/table rendering divergence.
- **Fragment Listener Duplication:** `hashchange` events re-ran viewer initialization. Fix: Only re-initialize if paste is encrypted and un-decrypted.
- **Burn-After-Read Flow:** Redirecting creator to `/{id}` immediately burns the paste. Fix: Display share link banner and only consume burn on recipient view.
- **Raw Route vs E2EE:** `/raw/:id` returns raw KV ciphertext for encrypted pastes. Fix: Omit Raw button on encrypted pastes and use client-side Download for decrypted text.
- **Payload Size Accounting:** Base64/E2EE adds ~35% overhead. Fix: Measure final payload with `TextEncoder` before upload to enforce `MAX_PASTE_BYTES`.
- **Cache & Security Directives:** `/:id` and `/raw/:id` require `Cache-Control: no-store`; non-root routes use `X-Robots-Tag: noindex, nofollow`.
