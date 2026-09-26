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
  downloadIcon,
  faviconSvg,
  flameSvg,
  globeSvg,
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
  TTL_MAP,
} from "./utils";

// Obsidian is the only theme; <html> carries it statically (no bootstrap, no CSP hash).

type Bindings = {
  PASTES_KV: KVNamespace;
  PASTE_RATE_LIMITER?: RateLimit;
};

export const inMemoryPastes = new Map<
  string,
  { payload: string; expiresAt?: number; deleteToken?: string }
>();

export function setInMemoryPaste(
  id: string,
  payload: string,
  ttlSeconds?: number,
  deleteToken?: string,
) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
  // Dev fallback has no KV sweep; cap it so unread keys can't grow unbounded.
  if (inMemoryPastes.size > 2000) {
    const now = Date.now();
    for (const [key, entry] of inMemoryPastes.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) inMemoryPastes.delete(key);
      if (inMemoryPastes.size <= 1500) break;
    }
    if (inMemoryPastes.size > 2000) {
      const oldest = inMemoryPastes.keys().next();
      if (!oldest.done) inMemoryPastes.delete(oldest.value);
    }
  }
  inMemoryPastes.set(id, { payload, expiresAt, deleteToken });
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
  deleteToken?: string;
};

// Read a paste from KV or the in-memory fallback, with absolute expiry when known.
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
      deleteToken?: string;
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
    return { value: res.value, expiresAtMs, deleteToken: meta?.deleteToken };
  }

  const entry = inMemoryPastes.get(id);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    inMemoryPastes.delete(id);
    return null;
  }
  return {
    value: entry.payload,
    expiresAtMs: entry.expiresAt,
    deleteToken: entry.deleteToken,
  };
}

// Single source of truth for paste IDs (was copy-pasted in three handlers).
export const PASTE_ID_RE = /^[A-Za-z0-9-_]{1,64}$/;

// In-memory limiter (30/min/IP); fallback when the native binding is absent.
export const rateLimitMap = new Map<
  string,
  { count: number; resetAt: number }
>();
const MAX_RATE_LIMIT_ENTRIES = 2000;

export function pruneRateLimitMap(now: number) {
  if (rateLimitMap.size > 200) {
    for (const [ip, record] of rateLimitMap.entries()) {
      if (now > record.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  }
  // Hard cap to prevent unbounded memory growth under high IP churn
  if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
    const excess = rateLimitMap.size - MAX_RATE_LIMIT_ENTRIES;
    let count = 0;
    for (const ip of rateLimitMap.keys()) {
      rateLimitMap.delete(ip);
      if (++count >= excess) break;
    }
  }
}

export function isRateLimited(
  ip: string,
  limit = 30,
  windowMs = 60000,
): boolean {
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

// Prefers the native binding when provisioned, else in-memory (see above).
export async function checkRateLimit(
  env: Bindings | undefined,
  ip: string,
): Promise<boolean> {
  const limiter = env?.PASTE_RATE_LIMITER;
  if (limiter) {
    try {
      const { success } = await limiter.limit({ key: ip });
      return !success;
    } catch {
      // Fall through to in-memory on binding errors.
    }
  }
  return isRateLimited(ip);
}

const app = new Hono<{ Bindings: Bindings }>();

// Global Security Middleware
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Unlisted pastes still get crawled once linked publicly; only / should be findable.
  if (c.req.path !== "/") c.header("X-Robots-Tag", "noindex, nofollow");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none';",
  );
});

// Graceful 500s on KV/network blips.
app.onError((err, c) => {
  console.error("px0 unhandled error:", err);
  const accept = c.req.header("accept") || "";
  if (accept.includes("application/json") || c.req.path.startsWith("/api/")) {
    return c.json({ error: "Internal server error" }, 500);
  }
  return c.text("Internal server error", 500);
});

// Favicon Route (SVG Bolt Icon)
app.get("/favicon.ico", (c) => {
  return c.body(faviconSvg, 200, { "Content-Type": "image/svg+xml" });
});

// Bundled client scripts (separate files = no template-string XSS risk).
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
      <html lang="en" data-theme="obsidian">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="theme-color" content="#050505">
        <meta name="description" content="Minimalist markdown pastebin with zero-knowledge encryption and burn-after-read.">
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
        <h1 class="sr-only">px0 — minimalist markdown pastebin</h1>
        <form id="pasteForm">
          <header>
            <a href="/" class="brand" title="px0">
              ${raw(brandIcon)}
            </a>

            <div class="header-right">
              <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">
                ${raw(plusIcon)}
              </a>
            </div>
          </header>

          <div class="util-strip">
            <div class="util-left">
              <span id="charCount" class="stats-label" title="0 lines (0 B / 5MB)">0 lines · 0 B</span>
              <span id="draftContainer"></span>
              <span id="saveError" class="save-error" role="alert"></span>
            </div>
            <button type="button" id="btnSplit" class="btn-action" title="Toggle preview" aria-label="Toggle preview" aria-pressed="false">
              ${raw(splitIcon)}
            </button>
          </div>

          <div id="editorContainer" class="editor-container">
            <textarea id="content" aria-label="Paste content" placeholder="Go ahead, type something…&#10;(you can paste markdown or code here)"></textarea>
            <div id="previewPane" class="preview-pane"></div>
          </div>

          <footer class="footer-bar">
            <div class="footer-left">
              <div class="mode-seg" role="group" aria-label="Paste mode">
                <label class="seg-option" title="Store as-is — anyone with the link can read it">
                  <input type="radio" name="mode" id="modePlaintext" checked>
                  <span class="badge badge-public" id="modePlaintextLabel">${raw(globeSvg)}<span class="seg-full">Plaintext</span><span class="seg-short" aria-hidden="true">Plain</span></span>
                </label>
                <label class="seg-option" title="Zero-knowledge encrypted: the key never leaves your browser">
                  <input type="radio" name="mode" id="e2eeToggle">
                  <span class="badge badge-encrypted" id="toggleLabel">${raw(lockIcon)} E2EE</span>
                </label>
              </div>
              <div class="ttl-dropdown" id="ttlDropdown">
                <button type="button" class="ttl-trigger" id="ttlTrigger" title="Paste Expiration Mode" aria-haspopup="listbox" aria-expanded="false">
                  <span class="ttl-trigger-label" id="ttlValue">1 Day</span>
                  ${raw(chevronDownIcon)}
                </button>
                <ul class="ttl-menu ttl-menu-up" id="ttlMenu" role="listbox" aria-label="Paste Expiration Mode" hidden>
                  <li class="ttl-option" role="option" data-ttl="burn" aria-selected="false" title="Deletes itself on the first view. If nobody opens it, it expires after 24 hours."><span class="ttl-check">${raw(checkIcon)}</span>Burn once</li>
                  <li class="ttl-option" role="option" data-ttl="1h" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>1 Hour</li>
                  <li class="ttl-option" role="option" data-ttl="1d" aria-selected="true"><span class="ttl-check">${raw(checkIcon)}</span>1 Day</li>
                  <li class="ttl-option" role="option" data-ttl="7d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>7 Days</li>
                  <li class="ttl-option" role="option" data-ttl="30d" aria-selected="false"><span class="ttl-check">${raw(checkIcon)}</span>30 Days</li>
                </ul>
              </div>
              <input type="hidden" id="ttlInput" value="1d">
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
  if (await checkRateLimit(c.env, clientIp)) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }

  const contentLength = Number(c.req.header("content-length"));
  if (contentLength && contentLength > MAX_PASTE_BYTES + 1024) {
    return c.json({ error: "Payload exceeds 5MB limit" }, 413);
  }

  // Accept raw bodies too so `curl` users skip JSON escaping; match the
  // media type exactly so lookalikes (e.g. json-patch+json) miss the JSON path.
  const rawContentType =
    c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const isJson = rawContentType === "application/json";

  let content: unknown;
  let ttl: unknown;

  if (isJson) {
    let body: { content?: unknown; ttl?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    ({ content, ttl } = body || {});
  } else {
    content = await c.req.text();
    ttl = c.req.query("ttl");
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return c.json({ error: "Content required" }, 400);
  }

  if (new TextEncoder().encode(content).byteLength > MAX_PASTE_BYTES) {
    return c.json({ error: "Paste size exceeds 5MB limit" }, 413);
  }

  // Never silently overwrite a key (would orphan its deleteToken); retry on collision.
  let id = generateShortId(8);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await readPaste(id, c.env))) break;
    id = generateShortId(8);
  }
  if (await readPaste(id, c.env)) {
    return c.json({ error: "ID collision, please retry" }, 503);
  }
  const deleteToken = generateShortId(16);
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
      metadata: { createdAt: Date.now(), ttlSeconds, deleteToken },
    });
  } else {
    setInMemoryPaste(id, storedPayload, ttlSeconds, deleteToken);
  }

  // Raw-body callers get a pipeable URL; the header states the plaintext
  // posture (all crypto lives in landing.ts, curl has none).
  return isJson
    ? c.json({ id, deleteToken })
    : c.text(`${new URL(c.req.url).origin}/${id}\n`, 200, {
        "X-Px0-Storage": "plaintext",
        "X-Px0-Delete-Token": deleteToken,
      });
});

// 3. Delete Paste API (instant, regardless of TTL)
app.delete("/api/paste/:id", async (c) => {
  // Same budget as creation (id knowledge is the only credential here).
  if (
    await checkRateLimit(c.env, c.req.header("cf-connecting-ip") || "127.0.0.1")
  ) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }
  const id = c.req.param("id");
  if (!PASTE_ID_RE.test(id)) {
    return c.json({ error: "Paste not found" }, 404);
  }
  // Header preferred (query strings linger in history/logs); query kept for compat.
  const providedToken =
    c.req.header("x-delete-token") || c.req.query("token") || "";

  const record = await readPaste(id, c.env);
  if (!record) {
    return c.json({ error: "Paste not found" }, 404);
  }

  // Fail closed: token-less records can never be deleted by token.
  if (!record.deleteToken || record.deleteToken !== providedToken) {
    return c.json({ error: "Unauthorized: Invalid delete token" }, 401);
  }

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
  if (!PASTE_ID_RE.test(id)) {
    return c.text("Paste Expired or Not Found", 404);
  }
  const record = await readPaste(id, c.env);
  let rawContent: string | null = record?.value ?? null;
  let expiresAtMs = record?.expiresAtMs;

  if (!rawContent) {
    return c.html(
      html`
        <!DOCTYPE html>
        <html lang="en" data-theme="obsidian">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="theme-color" content="#050505">
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
            <div class="nav-links">
              <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">${raw(plusIcon)}</a>
            </div>
          </header>
          <main class="not-found-wrapper">
            <div class="status-code">404</div>
            <h1 class="not-found-title">Paste Unavailable</h1>
            <p class="not-found-subtitle">This paste has expired, self-destructed after reading, or never existed.</p>
          </main>
        </body>
        </html>
      `,
      404,
    );
  }

  // Burn-after-read: never burn on prefetch (values can combine, so substring-match).
  const isBurnAfterRead = rawContent.startsWith(BURN_PREFIX);
  const isConfirmed = c.req.query("confirm") === "1";
  const purpose = c.req.header("purpose") || "";
  const secPurpose = c.req.header("sec-purpose") || "";
  const isPrefetch =
    purpose.toLowerCase().includes("prefetch") ||
    secPurpose.toLowerCase().includes("prefetch") ||
    secPurpose.toLowerCase().includes("prerender");

  if (isBurnAfterRead && (!isConfirmed || isPrefetch)) {
    return c.html(
      html`
        <!DOCTYPE html>
        <html lang="en" data-theme="obsidian">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="theme-color" content="#050505">
          <title>Burn-After-Read Paste | px0</title>
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
            <div class="nav-links">
              <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">${raw(plusIcon)}</a>
            </div>
          </header>
          <main class="not-found-wrapper">
            <div class="status-code" style="color: var(--red); font-size: 3rem; margin-bottom: 1rem;">${raw(flameSvg)}</div>
            <h1 class="not-found-title">Burn-After-Read Paste</h1>
            <p class="not-found-subtitle">This paste will self-destruct permanently after being viewed once.</p>
            <a href="/${id}?confirm=1" id="revealBtn" class="btn-save" style="margin-top: 1.5rem; text-decoration: none; display: inline-flex;">
              ${raw(flameSvg)}
              <span>Reveal & Self-Destruct</span>
            </a>
          </main>
          <script src="/static/viewer.js" defer></script>
        </body>
        </html>
      `,
      200,
      { "Cache-Control": "no-store" },
    );
  }

  if (isBurnAfterRead) {
    rawContent = rawContent.slice(BURN_PREFIX.length);
    expiresAtMs = undefined; // burn-after-read pastes self-destruct on view; no countdown
    // Fail closed: if the delete throws, 500 without rendering (never show unburned content).
    if (c.env?.PASTES_KV) {
      await c.env.PASTES_KV.delete(id);
    } else {
      getAndConsumeInMemoryPaste(id);
    }
  }

  const ttlLabel =
    expiresAtMs !== undefined ? formatTimeLeft(expiresAtMs - Date.now()) : "";

  // Legacy password pastes are retired, not rendered.
  if (rawContent.startsWith("__PX0_PASS__:")) {
    return c.text(
      "Paste Unavailable — password pastes are no longer supported",
      410,
    );
  }
  const isEncrypted = rawContent.startsWith(ENC_PREFIX);
  let renderedHtml = "";

  if (!isEncrypted) {
    // Same renderer as live preview / decrypted pastes: identical HTML everywhere.
    renderedHtml = renderMarkdown(rawContent);
  }

  const safeJsonData = JSON.stringify(rawContent)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\//g, "\\u002f");

  return c.html(
    html`
      <!DOCTYPE html>
      <html lang="en" data-theme="obsidian">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="theme-color" content="#050505">
        <meta name="description" content="Minimalist markdown pastebin with zero-knowledge encryption and burn-after-read.">
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
            ${isBurnAfterRead ? html`<span class="badge badge-burn-once" title="This paste self-destructed on view!">${raw(flameSvg)} Burned</span>` : ""}
          </div>

          <div class="nav-links">
            <a href="/" class="btn-action" title="New Paste" aria-label="New Paste">${raw(plusIcon)}</a>
            <div id="pasteActions" class="paste-actions" style="display: ${isEncrypted ? "none" : "flex"}; gap: 0.45rem; align-items: center;">
              <button type="button" class="btn-action" id="copyContentBtn" title="Copy Content" aria-label="Copy Content">${raw(copyIcon)}</button>
              <button type="button" class="btn-action" id="downloadBtn" title="Download as .md" aria-label="Download as Markdown">${raw(downloadIcon)}</button>
              ${
                // /raw serves stored bytes (ciphertext for E2EE); Download covers that case instead.
                isBurnAfterRead || isEncrypted
                  ? ""
                  : html`<a href="/raw/${id}" target="_blank" rel="noopener" class="btn-action" id="rawBtn" title="View Raw" aria-label="View Raw">${raw(rawIcon)}</a>`
              }
            </div>
          </div>
        </header>

        <main class="viewer-container">
          <div class="viewer-body">
            <div id="output" class="markdown-body">
              ${isEncrypted ? html`<p class="viewer-msg">Decrypting end-to-end encrypted payload in browser...</p>` : raw(renderedHtml)}
            </div>
          </div>
        </main>

        <footer class="footer-bar">
          <div class="footer-left">
            ${isEncrypted ? html`<span class="badge badge-encrypted" title="Zero-Knowledge Encrypted">${raw(lockIcon)} E2EE</span>` : html`<span class="badge badge-public" title="Stored unencrypted">${raw(globeSvg)} Plaintext</span>`}
          </div>
          <div class="footer-right">
            ${
              // Nothing left to delete once it has burned.
              isBurnAfterRead
                ? ""
                : html`<button type="button" id="deleteBtn" class="btn-delete" style="display: none;" title="Delete this paste instantly">
              ${raw(trashIcon)}
              <span id="deleteLabel">Delete</span>
            </button>`
            }
          </div>
        </footer>

        <script id="px0-data" type="application/json" data-encrypted="${isEncrypted ? "true" : "false"}" data-expires-at="${expiresAtMs ?? ""}">${raw(safeJsonData)}</script>
        <script src="/static/viewer.js" defer></script>
      </body>
      </html>
    `,
    200,
    // Private + unlisted: never let an edge cache re-serve (load-bearing for burn pastes).
    { "Cache-Control": "no-store" },
  );
});

// 4. View Raw Route
app.get("/raw/:id", async (c) => {
  const id = c.req.param("id");
  if (!PASTE_ID_RE.test(id)) {
    return c.text("Paste Expired or Not Found", 404);
  }
  const record = await readPaste(id, c.env);
  let rawContent: string | null = record?.value ?? null;

  if (!rawContent) {
    return c.text("Paste Expired or Not Found", 404);
  }

  if (rawContent.startsWith(BURN_PREFIX)) {
    const isConfirmed = c.req.query("confirm") === "1";
    const purpose = (c.req.header("purpose") || "").toLowerCase();
    const secPurpose = (c.req.header("sec-purpose") || "").toLowerCase();
    const isPrefetch =
      purpose.includes("prefetch") ||
      secPurpose.includes("prefetch") ||
      secPurpose.includes("prerender");
    if (!isConfirmed || isPrefetch) {
      return c.text(
        "This is a Burn-After-Read paste. Accessing it will permanently destroy it.\nTo view and self-destruct, append ?confirm=1 to this URL.\n",
        200,
        { "Cache-Control": "no-store" },
      );
    }
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
    "Cache-Control": "no-store",
  });
});

export default app;
