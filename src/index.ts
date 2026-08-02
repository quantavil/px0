import { Hono } from "hono";
import { html, raw } from "hono/html";
import landingJs from "../public/landing.js" with { type: "text" };
import viewerJs from "../public/viewer.js" with { type: "text" };
import { formatTimeLeft, renderMarkdown } from "./client/shared";
import {
  brandIcon,
  checkIcon,
  chevronDownIcon,
  clockSvg,
  copyIcon,
  faviconSvg,
  flameSvg,
  globeSvg,
  linkIcon,
  lockIcon,
  plusIcon,
  rawIcon,
  saveIcon,
  splitIcon,
  trashIcon,
} from "./icons";
import {
  BASE_CSS,
  CSS_VARIABLES,
  LANDING_CSS,
  MARKDOWN_CSS,
  NOT_FOUND_CSS,
  VIEWER_CSS,
} from "./styles";
import {
  BURN_PREFIX,
  ENC_PREFIX,
  generateShortId,
  getTtlSeconds,
  MAX_PASTE_BYTES,
  PASS_PREFIX,
  TTL_MAP,
} from "./utils";

type Bindings = {
  PASTES_KV: KVNamespace;
};

export const inMemoryPastes = new Map<
  string,
  { payload: string; expiresAt?: number }
>();

export function setInMemoryPaste(
  id: string,
  payload: string,
  ttlSeconds?: number,
) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
  inMemoryPastes.set(id, { payload, expiresAt });
}

export function getAndConsumeInMemoryPaste(id: string): string | null {
  const entry = inMemoryPastes.get(id);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    inMemoryPastes.delete(id);
    return null;
  }
  inMemoryPastes.delete(id);
  return entry.payload;
}

type PasteRecord = {
  value: string;
  expiresAtMs?: number;
};

// Read a paste from KV (with metadata) or the in-memory fallback,
// returning the payload plus its absolute expiry timestamp (ms) when known.
async function readPaste(
  id: string,
  env?: Bindings,
): Promise<PasteRecord | null> {
  if (env?.PASTES_KV) {
    const res = await env.PASTES_KV.getWithMetadata(id, { type: "text" });
    if (!res || res.value === null) return null;
    const meta = res.metadata as {
      createdAt?: number;
      ttlSeconds?: number;
    } | null;
    let expiresAtMs: number | undefined;
    if (meta?.createdAt && meta.ttlSeconds) {
      expiresAtMs = meta.createdAt + meta.ttlSeconds * 1000;
    } else {
      // Fallback for pastes stored before expiry metadata existed:
      // recover the absolute expiration (Unix seconds) via list().
      const listed = await env.PASTES_KV.list({ prefix: id, limit: 1 });
      const key = listed.keys[0];
      if (key?.expiration) {
        expiresAtMs = key.expiration * 1000;
      }
    }
    return { value: res.value, expiresAtMs };
  }

  const entry = inMemoryPastes.get(id);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    inMemoryPastes.delete(id);
    return null;
  }
  return { value: entry.payload, expiresAtMs: entry.expiresAt };
}

// In-memory rate limiting map (30 pastes / minute per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function pruneRateLimitMap(now: number) {
  if (rateLimitMap.size > 500) {
    for (const [ip, record] of rateLimitMap.entries()) {
      if (now > record.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  }
}

function isRateLimited(ip: string, limit = 30, windowMs = 60000): boolean {
  const now = Date.now();
  pruneRateLimitMap(now);
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  record.count++;
  return record.count > limit;
}

const app = new Hono<{ Bindings: Bindings }>();

// Global Security Middleware
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none';",
  );
});

// Favicon Route (SVG Bolt Icon)
app.get("/favicon.ico", (c) => {
  return c.body(faviconSvg, 200, { "Content-Type": "image/svg+xml" });
});

// Bundled Static Client Script Routes (No template string escaping XSS!)
app.get("/static/landing.js", (c) => {
  return c.body(landingJs, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
});

app.get("/static/viewer.js", (c) => {
  return c.body(viewerJs, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
});

// 1. Landing Page Route
app.get("/", (c) => {
  return c.html(
    html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="theme-color" content="#161b22">
        <meta name="description" content="Minimalist markdown pastebin with zero-knowledge encryption, password protection and burn-after-read.">
        <title>px0 - Minimalist Markdown Pastebin</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.ico">
        <style>
          ${raw(CSS_VARIABLES)}
          ${raw(BASE_CSS)}
          ${raw(MARKDOWN_CSS)}
          ${raw(LANDING_CSS)}
        </style>
      </head>
      <body>
        <form id="pasteForm">
          <header>
            <a href="/" class="brand" title="px0">
              ${raw(brandIcon)}
            </a>

            <div class="header-right">
              <button type="button" id="btnPassModal" class="btn-action" title="Toggle Password Protection" aria-label="Toggle Password Protection" aria-pressed="false">
                ${raw(lockIcon)}
              </button>
              <div id="inlinePassBar" class="inline-pass-bar">
                <input type="text" id="inlinePassInput" class="inline-pass-input" placeholder="Password…" aria-label="Paste password" autocomplete="off" spellcheck="false">
                <button type="button" id="copyPassBtn" class="inline-pass-copy" title="Copy password" aria-label="Copy password">${raw(copyIcon)}</button>
              </div>
              <button type="button" id="btnSplit" class="btn-action" title="Toggle Split Live Preview" aria-label="Toggle Split Live Preview" aria-pressed="false">
                ${raw(splitIcon)}
              </button>
              <div class="ttl-dropdown" id="ttlDropdown">
                <button type="button" class="ttl-trigger" id="ttlTrigger" title="Paste Expiration Mode" aria-haspopup="listbox" aria-expanded="false">
                  <span class="ttl-trigger-label" id="ttlValue">30 Days</span>
                  ${raw(chevronDownIcon)}
                </button>
                <ul class="ttl-menu" id="ttlMenu" role="listbox" aria-label="Paste Expiration Mode" hidden>
                  <li class="ttl-option" role="option" data-ttl="burn" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>Burn After Read</li>
                  <li class="ttl-option" role="option" data-ttl="15m" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>15 Minutes</li>
                  <li class="ttl-option" role="option" data-ttl="30m" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>30 Minutes</li>
                  <li class="ttl-option" role="option" data-ttl="1h" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>1 Hour</li>
                  <li class="ttl-option" role="option" data-ttl="3h" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>3 Hours</li>
                  <li class="ttl-option" role="option" data-ttl="6h" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>6 Hours</li>
                  <li class="ttl-option" role="option" data-ttl="12h" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>12 Hours</li>
                  <li class="ttl-option" role="option" data-ttl="1d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>1 Day</li>
                  <li class="ttl-option" role="option" data-ttl="3d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>3 Days</li>
                  <li class="ttl-option" role="option" data-ttl="7d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>7 Days</li>
                  <li class="ttl-option" role="option" data-ttl="15d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>15 Days</li>
                  <li class="ttl-option" role="option" data-ttl="30d" aria-selected="true"><span class="ttl-check">${raw(checkIcon)}</span>30 Days</li>
                </ul>
              </div>
              <input type="hidden" id="ttlInput" value="30d">
            </div>
          </header>

          <div id="editorContainer" class="editor-container">
            <textarea id="content" aria-label="Paste content" placeholder="Go ahead, type something…&#10;(you can paste markdown or code here)" autofocus></textarea>
            <div id="previewPane" class="preview-pane"></div>
          </div>

          <footer class="footer-bar">
            <div class="footer-left">
              <span id="charCount" class="stats-label">›_ 0 lines (0 chars)</span>
              <label class="toggle-e2ee" title="Click to toggle Zero-Knowledge Encryption">
                <input type="checkbox" id="e2eeToggle" checked>
                <span class="badge badge-encrypted" id="toggleLabel">${raw(lockIcon)} E2EE</span>
              </label>
              <span id="saveError" class="save-error" role="alert"></span>
            </div>

            <div class="footer-right">
              <button type="submit" id="saveBtn" class="btn-save" title="Save Paste (Ctrl+S)">
                ${raw(saveIcon)}
                <span>Save</span>
              </button>
            </div>
          </footer>
        </form>
        <script src="/static/landing.js" defer></script>
      </body>
      </html>
    `,
  );
});

// 2. Submit Paste API
app.post("/api/paste", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  if (isRateLimited(clientIp)) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }

  const contentLength = Number(c.req.header("content-length"));
  if (contentLength && contentLength > MAX_PASTE_BYTES + 1024) {
    return c.json({ error: "Payload exceeds 5MB limit" }, 413);
  }

  let body: { content?: unknown; ttl?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { content, ttl } = body || {};

  if (typeof content !== "string" || content.trim().length === 0) {
    return c.json({ error: "Content required" }, 400);
  }

  if (new TextEncoder().encode(content).byteLength > MAX_PASTE_BYTES) {
    return c.json({ error: "Paste size exceeds 5MB limit" }, 413);
  }

  const id = generateShortId(8);
  const selectedTtl = typeof ttl === "string" ? ttl : "30d";
  if (selectedTtl !== "burn" && !TTL_MAP[selectedTtl]) {
    return c.json({ error: "Invalid TTL option" }, 400);
  }
  const isBurnAfterRead = selectedTtl === "burn";

  const storedPayload = isBurnAfterRead ? `${BURN_PREFIX}${content}` : content;
  const ttlSeconds = isBurnAfterRead ? 86400 : getTtlSeconds(selectedTtl);

  if (c.env?.PASTES_KV) {
    await c.env.PASTES_KV.put(id, storedPayload, {
      expirationTtl: ttlSeconds,
      metadata: { createdAt: Date.now(), ttlSeconds },
    });
  } else {
    setInMemoryPaste(id, storedPayload, ttlSeconds);
  }

  return c.json({ id });
});

// 3. Delete Paste API (instant, regardless of TTL)
app.delete("/api/paste/:id", async (c) => {
  // Same budget as creation: knowing an id is the only credential here, so an
  // unthrottled delete endpoint is a free id-guessing loop.
  if (isRateLimited(c.req.header("cf-connecting-ip") || "127.0.0.1")) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }
  const id = c.req.param("id");
  if (c.env?.PASTES_KV) {
    await c.env.PASTES_KV.delete(id);
  } else {
    inMemoryPastes.delete(id);
  }
  return c.json({ ok: true });
});

// 4. Render View Route
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const record = await readPaste(id, c.env);
  let rawContent: string | null = record?.value ?? null;
  let expiresAtMs = record?.expiresAtMs;

  if (!rawContent) {
    return c.html(
      html`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="theme-color" content="#161b22">
          <title>404 - Paste Unavailable | px0</title>
          <link rel="icon" type="image/svg+xml" href="/favicon.ico">
          <style>
          ${raw(CSS_VARIABLES)}
          ${raw(BASE_CSS)}
          ${raw(NOT_FOUND_CSS)}
        </style>
        </head>
        <body>
          <header>
            <a href="/" class="brand" title="px0 homepage">${raw(brandIcon)}</a>
            <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">${raw(plusIcon)}</a>
          </header>
          <main class="not-found-wrapper">
            <div class="status-code">404</div>
            <div class="badge badge-ttl">›_ paste_expired_or_absent</div>
            <h1 class="not-found-title">Paste Unavailable</h1>
            <p class="not-found-subtitle">This paste has expired, self-destructed after reading, or never existed.</p>
          </main>
        </body>
        </html>
      `,
      404,
    );
  }

  // Check and handle Burn After Read self-destruction
  const isBurnAfterRead = rawContent.startsWith(BURN_PREFIX);
  if (isBurnAfterRead) {
    rawContent = rawContent.slice(BURN_PREFIX.length);
    expiresAtMs = undefined; // burn-after-read pastes self-destruct on view; no countdown
    if (c.env?.PASTES_KV) {
      await c.env.PASTES_KV.delete(id);
    } else {
      getAndConsumeInMemoryPaste(id);
    }
  }

  const ttlLabel =
    expiresAtMs !== undefined ? formatTimeLeft(expiresAtMs - Date.now()) : "";

  const isPasswordProtected = rawContent.startsWith(PASS_PREFIX);
  const isEncrypted = rawContent.startsWith(ENC_PREFIX);
  let renderedHtml = "";

  if (!isEncrypted && !isPasswordProtected) {
    // Same renderer the browser uses for the live preview and for decrypted
    // E2EE/password pastes, so every surface produces identical HTML.
    renderedHtml = renderMarkdown(rawContent);
  }

  const safeJsonData = JSON.stringify(rawContent)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\//g, "\\u002f");

  return c.html(
    html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Paste ${id} - px0</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.ico">
        <style>
          ${raw(CSS_VARIABLES)}
          ${raw(BASE_CSS)}
          ${raw(MARKDOWN_CSS)}
          ${raw(VIEWER_CSS)}
        </style>
      </head>
      <body>
        <header>
          <div class="left-group">
            <a href="/" class="brand" title="px0">
              ${raw(brandIcon)}
            </a>
            ${expiresAtMs !== undefined ? html`<span class="badge badge-ttl" id="expiryBadge" title="Time remaining until this paste expires">${raw(clockSvg)} ${ttlLabel}</span>` : ""}
            ${isBurnAfterRead ? html`<span class="badge badge-burn-once" title="This paste self-destructed on view!">${raw(flameSvg)} Burned After Read</span>` : ""}
          </div>

          <div class="nav-links">
            <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">${raw(plusIcon)}</a>
            <div id="pasteActions" class="paste-actions" style="display: ${isPasswordProtected || isEncrypted ? "none" : "flex"}; gap: 0.5rem; align-items: center;">
              ${
                // A burned paste is already gone from storage: its link 404s and
                // /raw 404s, so offering Copy Link and View Raw hands the reader
                // two dead controls. Only the in-page content is still real.
                isBurnAfterRead
                  ? ""
                  : html`<button type="button" class="btn-action" id="copyBtn" title="Copy Link" aria-label="Copy Link">${raw(linkIcon)}</button>`
              }
              <button type="button" class="btn-action" id="copyContentBtn" title="Copy Content" aria-label="Copy Content">${raw(copyIcon)}</button>
              ${isBurnAfterRead ? "" : html`<a href="/raw/${id}" target="_blank" rel="noopener" class="btn-action" id="rawBtn" title="View Raw" aria-label="View Raw">${raw(rawIcon)}</a>`}
            </div>
          </div>
        </header>

        <main class="viewer-container">
          <div class="viewer-body">
            <div id="output" class="markdown-body">
              ${isPasswordProtected ? "" : isEncrypted ? html`<p class="viewer-msg">Decrypting end-to-end encrypted payload in browser...</p>` : raw(renderedHtml)}
            </div>
          </div>
        </main>

        <footer class="footer-bar">
          <div class="footer-left">
            ${isPasswordProtected ? html`<span class="badge badge-encrypted" title="Encrypted with a password (PBKDF2 + AES-GCM)">${raw(lockIcon)} Password</span>` : isEncrypted ? html`<span class="badge badge-encrypted" title="Zero-Knowledge Encrypted">${raw(lockIcon)} E2EE</span>` : html`<span class="badge badge-public" title="Stored unencrypted">${raw(globeSvg)} Plaintext</span>`}
          </div>
          <div class="footer-right">
            ${
              // Nothing left to delete once it has burned.
              isBurnAfterRead
                ? ""
                : html`<button type="button" id="deleteBtn" class="btn-delete" style="display: ${isPasswordProtected || isEncrypted ? "none" : "flex"};" title="Delete this paste instantly">
              ${raw(trashIcon)}
              <span id="deleteLabel">Delete</span>
            </button>`
            }
          </div>
        </footer>

        <script id="px0-data" type="application/json" data-encrypted="${isEncrypted ? "true" : "false"}" data-password="${isPasswordProtected ? "true" : "false"}" data-expires-at="${expiresAtMs ?? ""}">${raw(safeJsonData)}</script>
        <script src="/static/viewer.js" defer></script>
      </body>
      </html>
    `,
  );
});

// 4. View Raw Route
app.get("/raw/:id", async (c) => {
  const id = c.req.param("id");
  const record = await readPaste(id, c.env);
  let rawContent: string | null = record?.value ?? null;

  if (!rawContent) {
    return c.text("Paste Expired or Not Found", 404);
  }

  if (rawContent.startsWith(BURN_PREFIX)) {
    rawContent = rawContent.slice(BURN_PREFIX.length);
    if (c.env?.PASTES_KV) {
      await c.env.PASTES_KV.delete(id);
    } else {
      getAndConsumeInMemoryPaste(id);
    }
  }

  return c.text(rawContent, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
});

export default app;
