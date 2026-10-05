import DOMPurify from "dompurify";
import { marked } from "marked";
import { highlight } from "sugar-high";
import { lang } from "sugar-high/lang";
import { decodeBase64Url, sanitizeHtml } from "../utils";

export { bytesToBase64Url } from "../utils";

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m left`;
  return "<1m left";
}

// Scheme check shared by both sanitizers and the Markdown link renderer: strips
// all C0/space (browsers ignore embedded tab/newline in URLs).
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_: string, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);?/g, (_: string, dec: string) =>
      String.fromCharCode(parseInt(dec, 10)),
    );
}

function normalizeForSchemeCheck(s: string): string {
  const decoded = decodeEntities(s);
  let out = "";
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code > 32 && code !== 127) out += decoded[i];
  }
  return out.toLowerCase();
}

// CSP allows data: images; raster ones are safe, svg/html are not.
function isAllowedDataUrl(normalized: string): boolean {
  return /^data:image\/(png|jpeg|gif|webp|avif);/.test(normalized);
}

export function isDangerousUrl(rawVal: string): boolean {
  const normalized = normalizeForSchemeCheck(rawVal);
  if (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:")
  ) {
    return true;
  }
  if (normalized.startsWith("data:")) {
    return !isAllowedDataUrl(normalized);
  }
  return false;
}

// srcset holds comma-separated candidates; check each URL separately.
export function isDangerousSrcset(rawVal: string): boolean {
  const candidates = decodeEntities(rawVal).split(",");
  for (const cand of candidates) {
    const urlToken = cand.trim().split(/\s+/)[0] ?? "";
    if (!urlToken) continue;
    if (isDangerousUrl(urlToken)) return true;
  }
  return false;
}

// Browser DOMPurify policy: dangerous tags/style/handlers gone,
// URIs enforced by hook below (raster data: images only).
const PURIFY_CONFIG = {
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "style",
    "form",
    "link",
    "meta",
    "base",
    "frame",
    "frameset",
    "applet",
    "noscript",
    "template",
    "svg",
    "math",
  ],
  FORBID_ATTR: ["style"],
  ADD_ATTR: [
    "target",
    "rel",
    "class",
    "type",
    "checked",
    "disabled",
    "alt",
    "title",
  ],
};

const URI_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "formaction",
  "poster",
  "background",
  "srcdoc",
  "lowsrc",
]);

let purifyHooked = false;

function purifyBrowser(dirty: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    if (!DOMPurify.isSupported) return null;
    // Same URL policy as the server sanitizer (same functions), enforced as
    // a hook so DOMPurify defaults can't silently allow e.g. data:text/html.
    if (!purifyHooked) {
      DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
        const name = String(data.attrName || "").toLowerCase();
        const value = String(data.attrValue ?? "");
        if (name === "class") {
          data.attrValue = value
            .split(/\s+/)
            .filter((name) => /^(?:sh__[-\w]+|language-[-\w]+)$/.test(name))
            .join(" ");
        } else if (name === "srcset") {
          if (isDangerousSrcset(value)) data.keepAttr = false;
        } else if (URI_ATTRS.has(name)) {
          if (isDangerousUrl(value)) data.keepAttr = false;
        }
      });
      purifyHooked = true;
    }
    return DOMPurify.sanitize(dirty, PURIFY_CONFIG);
  } catch {
    return null;
  }
}

export function sanitizeOutputHtml(htmlStr: string): string {
  // Fail closed if the browser sanitizer is unavailable. The Worker uses its
  // own parser-based sanitizer, never a regex approximation of browser HTML.
  return purifyBrowser(htmlStr) ?? sanitizeHtml(htmlStr);
}

// One marked config for server, live preview, and decrypted pastes.
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const cleanHref = href ? href.trim() : "";
      if (!cleanHref || isDangerousUrl(cleanHref)) {
        return text;
      }
      const titleAttr = title ? ` title="${sanitizeHtml(title)}"` : "";
      return `<a href="${sanitizeHtml(cleanHref)}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
    },
  },
});

export const MAX_RENDER_CHARS = 20000;

export function renderMarkdown(
  md: string,
  sanitize = sanitizeOutputHtml,
): string {
  if (!md?.trim()) return "";
  if (md.length > MAX_RENDER_CHARS) {
    return `<p class="large-paste-note">Large paste — showing the first 20,000 characters as text. Copy or download to get the complete paste.</p><pre class="large-paste-excerpt"><code>${sanitizeHtml(md.slice(0, MAX_RENDER_CHARS))}</code></pre>`;
  }

  const parsed = marked.parse(md, { async: false }) as string;

  // marked escapes code; unescape before highlighting to avoid double-escapes.
  const highlighted = parsed.replace(
    /<pre><code(?: class="(language-[a-zA-Z0-9_-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, langClass: string | undefined, rawCode: string) => {
      const unescaped = rawCode
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(?:39|039);/g, "'")
        .replace(/&amp;/g, "&");
      const classAttr = langClass ? ` class="${langClass}"` : "";
      const canonical = langClass
        ? lang(langClass.replace(/^language-/, ""))
        : undefined;
      return `<pre><code${classAttr}>${highlight(unescaped, canonical ? { lang: canonical } : undefined)}</code></pre>`;
    },
  );

  return sanitize(highlighted);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyToClipboard(text);
    }
  }
  return fallbackCopyToClipboard(text);
}

function fallbackCopyToClipboard(text: string): boolean {
  const previous = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.tabIndex = -1;
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  try {
    document.body.appendChild(ta);
    ta.select();
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    ta.remove();
    previous?.focus();
  }
}

export function flashCopied(el: Element | null, ms = 2000) {
  if (!el) return;
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), ms);
}

// Base64url -> bytes, typed for direct WebCrypto use.
export function base64UrlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const bin = decodeBase64Url(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
