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

// Scheme check shared by the regex fallback and the link renderer: strips
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

function isDangerousUrl(rawVal: string): boolean {
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
function isDangerousSrcset(rawVal: string): boolean {
  const candidates = decodeEntities(rawVal).split(",");
  for (const cand of candidates) {
    const urlToken = cand.trim().split(/\s+/)[0] ?? "";
    if (!urlToken) continue;
    if (isDangerousUrl(urlToken)) return true;
  }
  return false;
}

// DOMPurify config mirrors the fallback: dangerous tags/style/handlers gone,
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
    const p = DOMPurify as unknown as {
      isSupported: boolean;
      addHook(
        name: "uponSanitizeAttribute",
        cb: (
          node: Element,
          data: { attrName: string; attrValue: string; keepAttr: boolean },
        ) => void,
      ): void;
      sanitize(dirty: string, config: typeof PURIFY_CONFIG): string;
    };
    if (!p?.isSupported) return null;
    // Same URL policy as the regex fallback (same functions), enforced as
    // a hook so DOMPurify defaults can't silently allow e.g. data:text/html.
    if (!purifyHooked) {
      p.addHook("uponSanitizeAttribute", (_node, data) => {
        const name = String(data.attrName || "").toLowerCase();
        const value = String(data.attrValue ?? "");
        if (name === "srcset") {
          if (isDangerousSrcset(value)) data.keepAttr = false;
        } else if (URI_ATTRS.has(name)) {
          if (isDangerousUrl(value)) data.keepAttr = false;
        }
      });
      purifyHooked = true;
    }
    return p.sanitize(dirty, PURIFY_CONFIG);
  } catch {
    return null;
  }
}

export function sanitizeOutputHtml(htmlStr: string): string {
  // Real browsers: DOMPurify (fuzzed, bounty-backed). Workers/Bun: regex
  // fallback with the same policy (no DOM available there).
  return purifyBrowser(htmlStr) ?? regexSanitize(htmlStr);
}

function regexSanitize(htmlStr: string): string {
  return (
    htmlStr
      // Dangerous tags.
      .replace(
        /<\s*(script|iframe|object|embed|style|form|link|meta|base|frame|frameset|applet)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
        "",
      )
      .replace(
        /<\s*(script|iframe|object|embed|style|form|link|meta|base|frame|frameset|applet)\b[^>]*\/?>/gi,
        "",
      )
      // Event handlers + inline style.
      .replace(/[\s/]+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
      .replace(/[\s/]+style\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
      // Dangerous URI schemes.
      .replace(
        /(href|src|xlink:href|formaction|srcset|poster|background|srcdoc|lowsrc)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/gi,
        (match, attrName, valSingle, valDouble, valBare) => {
          const rawVal = valSingle ?? valDouble ?? valBare ?? "";
          const attrLower = String(attrName).toLowerCase();
          const dangerous =
            attrLower === "srcset"
              ? isDangerousSrcset(rawVal)
              : isDangerousUrl(rawVal);
          if (dangerous) {
            return `${attrName}="#"`;
          }
          return match;
        },
      )
  );
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

export function renderMarkdown(md: string): string {
  if (!md?.trim()) return "";

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

  return sanitizeOutputHtml(highlighted);
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
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const success = document.execCommand("copy");
    document.body.removeChild(ta);
    return Boolean(success);
  } catch {
    return false;
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
