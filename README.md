# px0 - Minimalist Markdown Pastebin with Zero-Knowledge E2EE & Password Protection

`px0` is a high-performance, minimalist Markdown pastebin built for Cloudflare Workers & Bun. It features Zero-Knowledge End-to-End Encryption (E2EE), PBKDF2 + AES-256-GCM Password Protection, an editorial Paper & Ink dual-theme (Warm Parchment Light & Obsidian Dark), GitHub Flavored Markdown rendering with `sugar-high` syntax highlighting, draft autosave, markdown editor shortcuts, customizable expiration, and Burn-After-Read self-destructing pastes.

---

## Key Features

- **Zero-Knowledge Password Protection**: Protect any paste with a custom password. Key derivation runs client-side using `PBKDF2` (SHA-256, 600,000 iterations following OWASP recommendations) and `AES-256-GCM`. The server **never sees or stores** your password.
- **Zero-Knowledge E2EE**: Submissions are encrypted client-side using Web Crypto API (`AES-256-GCM`) before reaching the server. The secret decryption key stays in the URL hash fragment (`/#key`) and is **never sent to the server**.
- **Paper & Ink Dual-Theme (Light & Dark)**:
  - **Parchment Light**: Warm ivory paper (`#f8f6f0`), deep charcoal ink (`#1a1917`), terracotta accents, and linen code cards.
  - **Obsidian Dark**: Deep inkstone (`#0f0e13`), slate surfaces (`#18161d`), parchment text (`#ede9e1`), and luminous amber accents.
  - **Editorial Typography**: High-legibility serif reading body (`Charter / Georgia`) paired with clean monospace code/editor and system sans chrome.
  - **Zero-FOUC Switcher**: Instant Sun/Moon toggle in the header with `localStorage` persistence and zero flash on reload.
- **Draft Autosave & Recovery**: Unsaved text automatically debounces to `localStorage`. Reopening or refreshing restores your draft with a one-click `[Discard]` badge; cleared on successful paste creation.
- **Markdown Textarea Ergonomics**: Native keyboard helpers without heavy dependencies:
  - `Enter`: Auto-continues bulleted (`- `, `* `) and numbered (`1. `) lists; empty Enter exits list mode.
  - `Ctrl/Cmd+B`: Wraps selected text in `**bold**`.
  - `Ctrl/Cmd+I`: Wraps selected text in `*italic*`.
  - `Ctrl/Cmd+K`: Wraps selected text in `[link](url)`.
- **Live Encoded Byte Counter**: Footer counter tracks lines and live UTF-8 byte payload weight against the 5MB ceiling: `›_ 12 lines (3.4 KB / 5MB)`.
- **Bundled TypeScript Client**: Client-side logic ([src/client/](src/client/)) is written in 100% typed TypeScript and minified via Bun into static JS assets served at `/static/*.js`. Eliminates raw inline script template strings and prevents script-breakout XSS by design.
- **Burn-After-Read Self-Destruct**: Pastes configured with `Burn once` delete automatically from memory/KV immediately upon the first view, with bot-prefetch protection and an interstitial confirmation before consuming.
- **Download as Markdown**: Every paste view offers a Download button that saves the content as `<id>.md`. Works on password and E2EE pastes by writing the text decrypted in the browser.
- **CLI-Friendly Creation**: `POST /api/paste` accepts raw binary/text payloads as well as JSON, so a file can be piped straight from a terminal without escaping:
  ```bash
  curl -sX POST --data-binary @notes.md "https://px0.iyzi.workers.dev/api/paste?ttl=1d"
  ```
- **Flexible Expiration Options**: Choose custom TTLs from a native SVG-styled dropdown in the UI header:
  - `Burn once`
  - `15 Minutes` | `30 Minutes`
  - `1 Hour` | `3 Hours` | `6 Hours` | `12 Hours`
  - `1 Day` | `3 Days` | `7 Days` | `15 Days` | `30 Days` (Default)
- **Expiry Countdown**: Every paste view shows a live `Xd Xh left` countdown badge tracking time until the paste expires.
- **Instant Delete**: Creators receive a client-side delete token stored in `localStorage` allowing permanent deletion via `DELETE /api/paste/:id` using the secure `X-Delete-Token` header.
- **Hardened Security**: Strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store` on paste responses, and rate limiting (30 requests / minute per IP).

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) & [Cloudflare Workers](https://workers.cloudflare.com)
- **Web Framework**: [Hono](https://hono.dev)
- **Client Scripting**: Native TypeScript (`src/client/`) bundled via `bun build`
- **Linter & Formatter**: [Biome](https://biomejs.dev)
- **Markdown Engine**: [marked](https://marked.js.org)
- **Syntax Highlighter**: [sugar-high](https://github.com/huozhi/sugar-high)
- **Encryption**: Web Crypto API (`PBKDF2` 600,000 iterations + `AES-GCM` 256-bit)
- **Testing**: [Playwright](https://playwright.dev) (16 E2E browser tests) & Bun Test (48 Unit/Integration tests)

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

# Run Bun unit & integration test suite (48 tests)
bun run test

# Run Playwright E2E browser test suite (Headless - 16 tests)
bun run test:e2e

# Run Playwright E2E browser test suite (Headed - 16 tests)
bun run test:e2e --headed
```

---

## Deployment (Cloudflare Workers)

`px0` runs as a Cloudflare Worker (Hono) with a KV binding (`PASTES_KV`) for persistence.

### One-time setup

1. **Authenticate Wrangler**:
   ```bash
   bunx wrangler login
   ```

2. **Create KV namespace**:
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
bun run deploy
```

---

## License

MIT License.
