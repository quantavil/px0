# px0 - Minimalist Markdown Pastebin with Zero-Knowledge E2EE & Password Protection

`px0` is a high-performance, minimalist Markdown pastebin built for Cloudflare Workers & Bun. It features Zero-Knowledge End-to-End Encryption (E2EE), PBKDF2 + AES-256-GCM Password Protection, GitHub Flavored Markdown rendering, `sugar-high` lexical code syntax highlighting, customizable expiration options, bundled TypeScript static assets, and Burn-After-Read self-destructing pastes.

---

## Key Features

- **Zero-Knowledge Password Protection**: Protect any paste with a custom password. Key derivation runs client-side using `PBKDF2` (SHA-256, 600,000 iterations following OWASP recommendations) and `AES-256-GCM`. The server **never sees or stores** your password.
- **Zero-Knowledge E2EE**: Submissions are encrypted client-side using Web Crypto API (`AES-256-GCM`) before reaching the server. The secret decryption key stays in the URL hash fragment (`/#key`) and is **never sent to the server**.
- **Bundled TypeScript Client**: Client-side logic ([src/client/](file:///home/quantavil/Documents/Project/px0/src/client/)) is written in 100% typed TypeScript and minified via Bun into static JS assets served at `/static/*.js`. Eliminates raw inline script template strings and prevents script-breakout XSS by design.
- **Burn-After-Read Self-Destruct**: Pastes configured with `Burn After Read` delete automatically from memory/KV immediately upon the first view. Because the paste is already gone by the time the page renders, the viewer omits Copy Link, View Raw and Delete rather than offering three controls that would all fail.
- **Flexible Expiration Options**: Choose custom TTLs from a native-feeling, SVG-styled dropdown in the UI header:
  - `Burn After Read`
  - `15 Minutes` | `30 Minutes`
  - `1 Hour` | `3 Hours` | `6 Hours` | `12 Hours`
  - `1 Day` | `3 Days` | `7 Days` | `15 Days` | `30 Days` (Default)
- **Expiry Countdown**: Every paste view shows a live `Xd Xh left` countdown badge tracking time until the paste expires. The absolute expiry is stored as KV metadata; legacy pastes are recovered via a KV `list()` fallback.
- **Instant Delete**: The paste view footer has a **Delete** button that permanently removes the paste via `DELETE /api/paste/:id`, regardless of its TTL.
- **Plaintext Markdown Mode & Post-Sanitization**: Full GFM rendering via `marked` combined with post-parsing HTML sanitization (`sanitizeOutputHtml`) stripping dangerous inline event handlers and `javascript:`, `vbscript:`, and `data:` URIs.
- **Lexical Syntax Highlighting**: Powered by **`sugar-high`** (`~1KB`), featuring custom lexical analysis for JavaScript, TypeScript, Python, Rust, HTML, CSS, Go, and C-style code snippets.
- **SVG Icon System**: All UI icons (lock, globe, flame, clock, trash, chevron, check) are inline SVGs in `src/icons.ts` — no emoji or icon-font dependencies. Each icon is defined once and sized by its container, so the same glyph can't render at three different sizes.
- **Keyboard & Screen-Reader Support**: Every control is operable without a mouse — the TTL listbox has full arrow-key/Home/End/Enter/Escape navigation with focus return, icon-only buttons carry `aria-label`, toggles report `aria-pressed`, and there's one global `:focus-visible` treatment. Honors `prefers-reduced-motion`.
- **Lightweight & Fast**: Sub-10ms response times running on Cloudflare Workers edge nodes.
- **Hardened Security**: Strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and rate limiting on both the submit and delete endpoints (30 requests / minute per IP).

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) & [Cloudflare Workers](https://workers.cloudflare.com)
- **Web Framework**: [Hono](https://hono.dev)
- **Client Scripting**: Native TypeScript (`src/client/`) bundled via `bun build`
- **Linter & Formatter**: [Biome](https://biomejs.dev)
- **Markdown Engine**: [marked](https://marked.js.org)
- **Syntax Highlighter**: [sugar-high](https://github.com/huozhi/sugar-high)
- **Encryption**: Web Crypto API (`PBKDF2` 600,000 iterations + `AES-GCM` 256-bit)
- **Testing**: [Playwright](https://playwright.dev) (13 E2E browser tests) & Bun Test (35 Unit/Integration tests)

---

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/quantavil/px0.git
cd px0

# Install dependencies
bun install
```

### Local Development

```bash
# Build minified client assets
bun run build:client

# Start local development server
bun run dev
```

Visit `http://localhost:3000` to create and view pastes locally.

---

## Testing & Quality Assurance

`px0` includes a 100% passing test suite with unit, integration, linting, and Playwright real-browser E2E tests:

```bash
# Compile client TypeScript assets
bun run build:client

# Type check TypeScript without emitting code
bun run check

# Lint & format code using Biome
bun run lint

# Run Bun unit & integration test suite (35 tests)
bun run test

# Run Playwright E2E browser test suite (Headless - 13 tests)
bun run test:e2e

# Run Playwright E2E browser test suite (Headed - 13 tests)
bun run test:e2e --headed
```

---

## Deployment (Cloudflare Workers)

`px0` runs as a Cloudflare Worker (Hono) with a KV binding for persistence. Deploys are manual via Wrangler.

> Note: do **not** connect this repo to Cloudflare **Pages** via Git integration — it will build fine but
> the deployed site is blank. Why:
>
> - Cloudflare Pages only serves **static files** from the build output. It never runs `src/index.ts`,
>   so all server-side logic — the `/api/paste` endpoint, KV reads/writes for paste persistence,
>   server-side Markdown rendering, burn-after-read, rate limiting, and the `/raw/:id` route — is
>   completely absent.
> - `bun run build:client` only emits the client bundles `public/landing.js` and `public/viewer.js`.
>   There is no `index.html` in the build output, so Pages has nothing to serve at `/` (returns 404).
>   The real homepage is rendered by the Worker's `GET /` handler.
> - Even if an `index.html` existed, pastes couldn't be created or stored: the Worker's KV binding
>   (`PASTES_KV`) exists only inside a Worker runtime, and Pages never provisions it.
>
> Use Cloudflare **Workers** (as documented below) — the Worker bundles `src/index.ts` and executes all
> of the above.

### One-time setup

1. **Authenticate Wrangler**:
   ```bash
   bunx wrangler login
   ```

2. **Create KV namespace** (if not already created):
   ```bash
   bunx wrangler kv namespace create PASTES_KV
   ```

3. **Update `wrangler.json`** with the KV namespace ID from the output:
   ```json
   {
     "kv_namespaces": [
       {
         "binding": "PASTES_KV",
         "id": "YOUR_KV_NAMESPACE_ID"
       }
     ]
   }
   ```

### Deploy

```bash
bun run build:client
bun run deploy
```

The Worker is served at `https://px0.<account-subdomain>.workers.dev` (e.g. `https://px0.iyzi.workers.dev`).

---

## HTTP API

- `POST /api/paste` — `{ "content": string, "ttl": "burn"|"15m"|...|"30d" }` → `{ "id": string }`. Stores the paste in KV (or memory fallback) with an expiration TTL.
- `DELETE /api/paste/:id` — permanently deletes a paste, regardless of its TTL. → `{ "ok": true }`.
- `GET /raw/:id` — returns the plaintext payload (`text/plain`); burns-after-read pastes are consumed.
- `GET /:id` — renders the HTML viewer page with live expiry countdown, status badge, and delete footer.

---

## Security Model

1. **Password Protection Flow**:
   - `PBKDF2(password, salt, 600000, 'SHA-256')` derives a 256-bit AES-GCM encryption key following OWASP standards.
   - Payload is stored as `__PX0_PASS__:<salt>:<iv>:<ciphertext>` using unambiguous sentinel prefixes to prevent user content collision.
   - On the view page, entering the password derives the key in the browser and decrypts the content client-side. Invalid passwords return `Incorrect password — check it and try again.`
2. **Zero-Knowledge Key Storage**:
   - For hash-based E2EE (`/#key`), the 256-bit raw key is Base64URL-encoded and attached strictly to the URL fragment (`/#key`), which HTTP GET requests never transmit.
3. **Burn-After-Read Execution**:
   - Pastes marked with `burn` delete immediately upon the first view request (`/:id` or `/raw/:id`).
4. **Post-Parse Output Sanitization**:
   - On the server, raw Markdown is parsed by `marked` first, then the rendered HTML output is sanitized via `sanitizeOutputHtml` to strip inline event attributes (`on*`) and malicious URI schemes (`javascript:`, `vbscript:`, `data:`).
5. **CSP Hardening**:
   - `Content-Security-Policy` uses `script-src 'self'` with no `'unsafe-inline'`. All script logic runs from bundled `/static/*.js` assets.

---

## License

MIT License.
