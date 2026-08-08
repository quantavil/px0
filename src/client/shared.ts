import { marked } from "marked";
import { highlight } from "sugar-high";
import { decodeBase64Url, sanitizeHtml } from "../utils";

export { bytesToBase64, bytesToBase64Url, decodeBase64Url } from "../utils";

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

// Post-parsing HTML sanitizer: strips inline event handlers and dangerous URIs
// from rendered output. Defence in depth alongside the CSP.
export function sanitizeOutputHtml(htmlStr: string): string {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, "text/html");
    const elements = doc.body.querySelectorAll("*");
    for (const el of Array.from(elements)) {
      const tag = el.tagName.toLowerCase();
      if (
        ["script", "iframe", "object", "embed", "style", "form"].includes(tag)
      ) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim().toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          (name === "href" || name === "src") &&
          (val.startsWith("javascript:") ||
            val.startsWith("vbscript:") ||
            val.startsWith("data:"))
        ) {
          el.setAttribute(attr.name, "#");
        }
      }
    }
    return doc.body.innerHTML;
  }

  return (
    htmlStr
      // `[\s/]` not `\s`: HTML lets `/` separate attributes, so `<img/onerror=…>`
      // slipped past a whitespace-only match.
      .replace(/[\s/]+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
      .replace(
        /(href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data):[^"'>\s]*/gi,
        '$1="#"',
      )
  );
}

// Single markdown configuration shared by the server renderer and the browser
// (live preview + decrypted E2EE/password pastes), so every surface produces
// byte-identical HTML.
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const cleanHref = href ? href.trim() : "";
      const lower = cleanHref.toLowerCase();
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("vbscript:") ||
        lower.startsWith("data:")
      ) {
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

  // Re-highlight fenced code blocks with sugar-high. marked has already
  // entity-escaped the source, so undo that before lexing or the highlighter
  // sees `&quot;` instead of `"` and double-escapes it.
  const highlighted = parsed.replace(
    /<pre><code(?: class="language-[a-zA-Z0-9_-]+")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, rawCode: string) => {
      const unescaped = rawCode
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(?:39|039);/g, "'")
        .replace(/&amp;/g, "&");
      return `<pre><code>${highlight(unescaped)}</code></pre>`;
    },
  );

  return sanitizeOutputHtml(highlighted);
}

export function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

// Flashes a button into its `copied` state for visual confirmation.
export function flashCopied(el: Element | null, ms = 2000) {
  if (!el) return;
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), ms);
}

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const masterKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 600000,
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Base64url string -> bytes. Mirrors bytesToBase64Url on the encode side.
// Returns Uint8Array<ArrayBuffer> (not ArrayBufferLike) so the result is
// directly usable as a WebCrypto BufferSource.
export function base64UrlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const bin = decodeBase64Url(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const getUniformRandomChar = (charset: string): string =>
  charset[uniformIndex(charset.length)];

export function generate8CharPassword(): string {
  // Ambiguous glyphs (I/l/1, O/0) are excluded so passwords survive being
  // read off a screen and retyped.
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%^&*";
  const all = uppers + lowers + numbers + symbols;

  const password = [
    getUniformRandomChar(uppers),
    getUniformRandomChar(lowers),
    getUniformRandomChar(numbers),
    getUniformRandomChar(symbols),
    getUniformRandomChar(all),
    getUniformRandomChar(all),
    getUniformRandomChar(all),
    getUniformRandomChar(all),
  ];

  // Fisher-Yates with a rejection-sampled index so the guaranteed-class
  // characters don't stay pinned to the first four positions.
  for (let i = password.length - 1; i > 0; i--) {
    const j = uniformIndex(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

// Rejection sampling: a plain `byte % range` biases the low indices whenever
// range doesn't divide 256.
function uniformIndex(range: number): number {
  const maxValid = 256 - (256 % range);
  const buf = new Uint8Array(1);
  let val: number;
  do {
    crypto.getRandomValues(buf);
    val = buf[0];
  } while (val >= maxValid);
  return val % range;
}
