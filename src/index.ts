import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { legacyRecord, type PasteRecord } from "./paste-store";

export { PasteStore } from "./paste-store";

import { html, raw } from "hono/html";
import landingJs from "../public/landing.js" with { type: "text" };
import landingCss from "../public/landing.min.css" with { type: "text" };
import notFoundCss from "../public/not-found.min.css" with { type: "text" };
import previewJs from "../public/preview.js" with { type: "text" };
import viewerJs from "../public/viewer.js" with { type: "text" };
import viewerCss from "../public/viewer.min.css" with { type: "text" };
import { formatTimeLeft } from "./client/shared";
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
  imageIcon,
  infoIcon,
  lockIcon,
  plusIcon,
  rawIcon,
  saveIcon,
  splitIcon,
  trashIcon,
} from "./icons";
import {
  detectImageType,
  imageRateLimitMap,
  MAX_IMAGE_BYTES,
  validateCatboxUrl,
} from "./image";
import { renderMarkdown } from "./server-renderer";
import {
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
  PASTE_STORE?: DurableObjectNamespace;
};

export const inMemoryPastes = new Map<
  string,
  {
    payload: string;
    expiresAt?: number;
    deleteToken?: string;
    burn?: boolean;
    encrypted?: boolean;
  }
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

function storeStub(id: string, env: Bindings) {
  const store = env.PASTE_STORE;
  if (!store) throw new Error("Paste storage binding unavailable");
  return store.get(store.idFromName(id));
}

async function readPaste(
  id: string,
  env?: Bindings,
): Promise<PasteRecord | null> {
  if (env?.PASTE_STORE) {
    const res = await storeStub(id, env).fetch(`https://store/get?id=${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Paste storage read failed");
    return res.json();
  }
  if (env?.PASTES_KV) {
    const res = await env.PASTES_KV.getWithMetadata<{
      createdAt?: number;
      ttlSeconds?: number;
      deleteToken?: string;
    }>(id, { type: "text" });
    if (res.value === null) return null;
    const record = legacyRecord(res.value, res.metadata);
    return record.expiresAtMs && record.expiresAtMs <= Date.now()
      ? null
      : record;
  }
  const entry = inMemoryPastes.get(id);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() >= entry.expiresAt) {
    inMemoryPastes.delete(id);
    return null;
  }
  const record =
    entry.burn === undefined
      ? legacyRecord(entry.payload)
      : {
          value: entry.payload,
          burn: entry.burn,
          encrypted: entry.encrypted ?? false,
        };
  return {
    ...record,
    expiresAtMs: entry.expiresAt,
    deleteToken: entry.deleteToken,
  };
}

async function consumePaste(
  id: string,
  env?: Bindings,
): Promise<PasteRecord | null> {
  if (env?.PASTE_STORE) {
    const res = await storeStub(id, env).fetch(
      `https://store/consume?id=${id}`,
      { method: "POST" },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Paste consumption failed");
    return res.json();
  }
  // Production always uses the atomic object; local storage consumes synchronously.
  const entry = inMemoryPastes.get(id);
  if (!entry) return null;
  const value = getAndConsumeInMemoryPaste(id);
  if (value === null) return null;
  const record =
    entry.burn === undefined
      ? legacyRecord(value)
      : {
          value,
          burn: entry.burn,
          encrypted: entry.encrypted ?? false,
        };
  return { ...record, deleteToken: entry.deleteToken };
}

// Single source of truth for paste IDs (was copy-pasted in three handlers).
export const PASTE_ID_RE = /^[A-Za-z0-9-_]{1,64}$/;

// In-memory limiter (30/min/IP); fallback when the native binding is absent.
export const rateLimitMap = new Map<
  string,
  { count: number; resetAt: number }
>();
const MAX_RATE_LIMIT_ENTRIES = 2000;

export function pruneRateLimitMap(
  now: number,
  map: Map<string, { count: number; resetAt: number }> = rateLimitMap,
) {
  if (map.size > 200) {
    for (const [ip, record] of map.entries()) {
      if (now > record.resetAt) {
        map.delete(ip);
      }
    }
  }
  // Hard cap to prevent unbounded memory growth under high IP churn
  if (map.size > MAX_RATE_LIMIT_ENTRIES) {
    const excess = map.size - MAX_RATE_LIMIT_ENTRIES;
    let count = 0;
    for (const ip of map.keys()) {
      map.delete(ip);
      if (++count >= excess) break;
    }
  }
}

export function isRateLimited(
  ip: string,
  limit = 30,
  windowMs = 60000,
  map: Map<string, { count: number; resetAt: number }> = rateLimitMap,
): boolean {
  const now = Date.now();
  pruneRateLimitMap(now, map);
  const record = map.get(ip);
  if (!record || now > record.resetAt) {
    map.set(ip, { count: 1, resetAt: now + windowMs });
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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://files.catbox.moe; frame-ancestors 'none';",
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

// Public scripts may revalidate; private paste responses remain no-store.
for (const [path, script] of [
  ["landing", landingJs],
  ["viewer", viewerJs],
  ["preview", previewJs],
]) {
  let etagPromise: Promise<string> | undefined;
  app.get(`/static/${path}.js`, async (c) => {
    etagPromise ??= crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(script))
      .then(
        (bytes) =>
          `"${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`,
      );
    const etag = await etagPromise;
    const headers = {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, no-cache",
      ETag: etag,
    };
    const matches = c.req
      .header("if-none-match")
      ?.split(",")
      .some(
        (value) =>
          value.trim().replace(/^W\//, "") === etag || value.trim() === "*",
      );
    if (matches) return c.body(null, 304, headers);
    return c.body(script, 200, headers);
  });
}

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
        <style>${raw(landingCss)}</style>
      </head>
      <body>
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

          <main class="writing-main" aria-label="Write a paste">
          <h1 class="sr-only">px0 — minimalist markdown pastebin</h1>
          <div class="util-strip">
            <div class="util-left">
              <span id="charCount" class="stats-label" title="0 lines (0 B / 5MB)">0 lines · 0 B</span>
              <span id="draftContainer" role="status"></span>
              <span id="draftStatus" role="status"></span>
              <span id="uploadStatus" class="upload-status" role="status"></span>
              <span id="saveError" class="save-error" role="alert"></span>
            </div>
            <div class="util-right">
              <div class="upload-control-group">
                <button type="button" id="btnUpload" class="btn-action" title="Upload image — Public on Catbox (not encrypted)" aria-label="Upload image" aria-description="Images are public on Catbox.moe, including images linked inside encrypted pastes. Paste expiry, deletion and burn-after-read do not delete Catbox images. Images are not end-to-end encrypted.">
                  ${raw(imageIcon)}
                </button>
                <input type="file" id="imageInput" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="sr-only" tabindex="-1" aria-hidden="true">
                <button type="button" id="btnUploadInfo" class="btn-action btn-upload-info" title="Image upload privacy note" aria-label="Image upload privacy note" aria-expanded="false" aria-controls="imagePopover">
                  ${raw(infoIcon)}
                </button>
                <div id="imagePopover" class="image-popover" role="note" hidden>
                  <p><strong>Images are public on Catbox.moe:</strong> Uploaded images are hosted publicly, including images linked inside encrypted pastes.</p>
                  <p>Paste expiry, deletion, and burn-after-read do not delete Catbox images. Images are not end-to-end encrypted.</p>
                </div>
              </div>
              <button type="button" id="btnSplit" class="btn-action" title="Toggle preview" aria-label="Toggle preview" aria-controls="previewPane" aria-pressed="false">
                ${raw(splitIcon)}
              </button>
            </div>
          </div>

          <div id="editorContainer" class="editor-container">
            <textarea id="content" name="content" autocomplete="off" spellcheck="false" aria-label="Paste content" placeholder="Go ahead, type something…&#10;(you can paste markdown or code here)"></textarea>
            <div id="previewPane" class="preview-pane" role="region" aria-label="Preview"></div>
          </div>

          <details class="privacy-help">
            <summary>Encryption, images &amp; local drafts</summary>
            <p>Encrypted pastes need the complete link to read. Drafts are saved unencrypted on this device.</p>
            <p><strong>Images:</strong> Uploaded images are hosted publicly on Catbox.moe, including images linked inside encrypted pastes. Paste expiry, deletion, and burn-after-read do not delete Catbox images. Images are not end-to-end encrypted.</p>
            <label><input type="checkbox" id="draftPreference" checked> Save drafts on this device</label>
          </details>

          </main>
          <footer class="footer-bar">
            <div class="footer-left">
              <div class="mode-seg" role="group" aria-label="Paste mode">
                <label class="seg-option" title="Store as-is — anyone with the link can read it">
                  <input type="radio" name="mode" id="modePlaintext" aria-label="Plaintext" checked>
                  <span class="badge badge-public" id="modePlaintextLabel">${raw(globeSvg)}<span class="seg-full">Plaintext</span><span class="seg-short" aria-hidden="true">Plain</span></span>
                </label>
                <label class="seg-option" title="Encrypted: only people with the complete link can read it">
                  <input type="radio" name="mode" id="e2eeToggle" aria-label="Encrypted">
                  <span class="badge badge-encrypted" id="toggleLabel">${raw(lockIcon)}<span class="seg-full">Encrypted</span><span class="seg-short" aria-hidden="true">Encrypt</span></span>
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

// Bound image uploads strictly to 5MB + 64KB for multipart boundary overhead.
app.use(
  "/api/image",
  bodyLimit({
    maxSize: MAX_IMAGE_BYTES + 64 * 1024,
    onError: (c) => c.json({ error: "Image exceeds 5MB limit" }, 413),
  }),
);

// Image Upload API (proxies to Catbox anonymously with strict validation)
app.post("/api/image", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  if (isRateLimited(clientIp, 20, 60000, imageRateLimitMap)) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }

  const contentLength = Number(c.req.header("content-length"));
  if (contentLength && contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return c.json({ error: "Image exceeds 5MB limit" }, 413);
  }

  const rawContentType =
    c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

  let bytes: Uint8Array;

  if (rawContentType === "multipart/form-data") {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Invalid form data" }, 400);
    }
    const file =
      formData.get("file") ??
      formData.get("image") ??
      formData.get("fileToUpload");
    if (!file || typeof file === "string") {
      return c.json({ error: "No image file provided" }, 400);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (
    rawContentType.startsWith("image/") ||
    rawContentType === "application/octet-stream"
  ) {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  } else {
    return c.json(
      { error: "Content-Type must be multipart/form-data or image/*" },
      415,
    );
  }

  if (bytes.byteLength === 0) {
    return c.json({ error: "Image file is empty" }, 400);
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return c.json({ error: "Image exceeds 5MB limit" }, 413);
  }

  const format = detectImageType(bytes);
  if (!format) {
    return c.json(
      {
        error: "Invalid image format. Supported formats: PNG, JPEG, WebP, GIF.",
      },
      400,
    );
  }

  const ext = format === "jpeg" ? "jpg" : format;
  const mimeType =
    format === "png"
      ? "image/png"
      : format === "jpeg"
        ? "image/jpeg"
        : format === "webp"
          ? "image/webp"
          : "image/gif";

  const catboxFormData = new FormData();
  catboxFormData.append("reqtype", "fileupload");
  catboxFormData.append(
    "fileToUpload",
    new Blob([bytes as unknown as BlobPart], { type: mimeType }),
    `image.${ext}`,
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const onClientAbort = () => controller.abort();
  if (c.req.raw.signal?.aborted) {
    controller.abort();
  } else {
    c.req.raw.signal?.addEventListener("abort", onClientAbort);
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: catboxFormData,
      signal: controller.signal,
      headers: {
        "User-Agent": "px0/1.0",
      },
    });
  } catch {
    if (c.req.raw.signal?.aborted) {
      return c.json({ error: "Client aborted upload" }, 400);
    }
    if (controller.signal.aborted) {
      return c.json({ error: "Image upload timed out" }, 504);
    }
    return c.json({ error: "Failed to connect to image host" }, 502);
  } finally {
    clearTimeout(timeoutId);
    c.req.raw.signal?.removeEventListener("abort", onClientAbort);
  }

  if (!upstreamRes.ok) {
    return c.json({ error: "Upstream image host returned an error" }, 502);
  }

  const text = (await upstreamRes.text()).trim();
  const validUrl = validateCatboxUrl(text);
  if (!validUrl) {
    return c.json(
      { error: "Invalid image URL received from upstream host" },
      502,
    );
  }

  return c.json({ url: validUrl }, 200);
});

// Bound wire bytes separately: JSON escaping can expand each content byte sixfold.
app.use(
  "/api/paste",
  bodyLimit({
    maxSize: MAX_PASTE_BYTES * 6 + 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
);

// 2. Submit Paste API
app.post("/api/paste", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  if (await checkRateLimit(c.env, clientIp)) {
    return c.json(
      { error: "Rate limit exceeded. Please try again later." },
      429,
    );
  }

  // Accept raw bodies too so `curl` users skip JSON escaping; match the
  // media type exactly so lookalikes (e.g. json-patch+json) miss the JSON path.
  const rawContentType =
    c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const isJson = rawContentType === "application/json";

  let content: unknown;
  let ttl: unknown;
  let encrypted = false;

  if (isJson) {
    let body: { content?: unknown; ttl?: unknown; encrypted?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    ({ content, ttl } = body || {});
    encrypted = body?.encrypted === true;
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

  const selectedTtl = typeof ttl === "string" ? ttl : "30d";
  if (selectedTtl !== "burn" && !Object.hasOwn(TTL_MAP, selectedTtl)) {
    return c.json({ error: "Invalid TTL option" }, 400);
  }
  if (encrypted && !content.startsWith(ENC_PREFIX)) {
    return c.json({ error: "Invalid encrypted payload" }, 400);
  }
  const burn = selectedTtl === "burn";
  const ttlSeconds = burn ? 86400 : getTtlSeconds(selectedTtl);
  const deleteToken = generateShortId(16);
  const record: PasteRecord = {
    value: content,
    burn,
    encrypted,
    deleteToken,
    expiresAtMs: Date.now() + ttlSeconds * 1000,
  };
  let id = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = generateShortId(12);
    if (c.env?.PASTE_STORE) {
      const response = await storeStub(candidate, c.env).fetch(
        `https://store/create?id=${candidate}`,
        {
          method: "POST",
          body: JSON.stringify(record),
        },
      );
      if (response.status === 409) continue;
      if (!response.ok) throw new Error("Paste storage write failed");
    } else {
      if (c.env?.PASTES_KV)
        throw new Error("Durable Object storage is not configured");
      if (inMemoryPastes.has(candidate)) continue;
      setInMemoryPaste(candidate, content, ttlSeconds, deleteToken);
      const entry = inMemoryPastes.get(candidate);
      if (entry) Object.assign(entry, { burn, encrypted });
    }
    id = candidate;
    break;
  }
  if (!id) return c.json({ error: "ID collision, please retry" }, 503);

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

  if (c.env?.PASTE_STORE) {
    const result = await storeStub(id, c.env).fetch(
      `https://store/delete?id=${id}`,
      { method: "POST", headers: { "X-Delete-Token": providedToken } },
    );
    if (result.status === 404) return c.json({ error: "Paste not found" }, 404);
    if (result.status === 401)
      return c.json({ error: "Unauthorized: Invalid delete token" }, 401);
    if (!result.ok) throw new Error("Paste deletion failed");
    return c.json({ ok: true });
  }
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
          <style>${raw(notFoundCss)}</style>
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
  const isBurnAfterRead = record?.burn ?? false;
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
          <style>${raw(notFoundCss)}</style>
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
    const consumed = await consumePaste(id, c.env);
    if (!consumed)
      return c.text("Paste Expired or Not Found", 404, {
        "Cache-Control": "no-store",
      });
    rawContent = consumed.value;
    expiresAtMs = undefined;
  }

  const ttlLabel =
    expiresAtMs !== undefined ? formatTimeLeft(expiresAtMs - Date.now()) : "";

  // Legacy password pastes are retired, not rendered.
  if (record?.retired) {
    return c.text(
      "Paste Unavailable — password pastes are no longer supported",
      410,
    );
  }
  const isEncrypted = record?.encrypted ?? false;
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
        <style>${raw(viewerCss)}</style>
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

        <main class="viewer-container" aria-label="Paste">
          <h1 class="sr-only">Paste ${id}</h1>
          <div class="viewer-body">
            <div id="output" class="markdown-body">
              ${isEncrypted ? html`<p class="viewer-msg">Decrypting end-to-end encrypted payload in browser...</p>` : raw(renderedHtml)}
            </div>
          </div>
        </main>

        <footer class="footer-bar">
          <div class="footer-left">
            ${isEncrypted ? html`<span class="badge badge-encrypted" title="Zero-Knowledge Encrypted">${raw(lockIcon)} Encrypted</span>` : html`<span class="badge badge-public" title="Stored unencrypted">${raw(globeSvg)} Plaintext</span>`}
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

  if (record?.burn) {
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
    const consumed = await consumePaste(id, c.env);
    if (!consumed)
      return c.text("Paste Expired or Not Found", 404, {
        "Cache-Control": "no-store",
      });
    rawContent = consumed.value;
  }

  return c.text(rawContent, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
});

export default app;
