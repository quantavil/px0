import { marked } from "marked";
import { highlight } from "sugar-high";
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

// Post-parsing HTML sanitizer: strips inline event handlers and dangerous URIs
// from rendered output. Defence in depth alongside the CSP.
// WHATWG URL parsing strips leading C0 controls + space before scheme checks,
// so `javascript:` with a control-char prefix would otherwise bypass the
// startsWith tests below. No regex literal can express that range under the
// linter, so compare char codes instead.
function stripLeadingC0(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 32) i++;
  return s.slice(i);
}

export function sanitizeOutputHtml(htmlStr: string): string {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, "text/html");
    const elements = doc.body.querySelectorAll("*");
    for (const el of Array.from(elements)) {
      const tag = el.tagName.toLowerCase();
      if (
        [
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
        ].includes(tag)
      ) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = stripLeadingC0(attr.value).trim().toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (name === "style") {
          // Inline CSS enables exfiltration via url() and legacy expression().
          el.removeAttribute(attr.name);
        } else if (
          (name === "href" ||
            name === "src" ||
            name === "xlink:href" ||
            name === "formaction" ||
            name === "srcset" ||
            name === "poster" ||
            name === "background" ||
            name === "srcdoc" ||
            name === "lowsrc") &&
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
      // Strip dangerous tags completely
      .replace(
        /<\s*(script|iframe|object|embed|style|form|link|meta|base|frame|frameset|applet)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
        "",
      )
      .replace(
        /<\s*(script|iframe|object|embed|style|form|link|meta|base|frame|frameset|applet)\b[^>]*\/?>/gi,
        "",
      )
      // Strip event handlers and inline style (regex fallback mirrors the DOM branch)
      .replace(/[\s/]+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
      .replace(/[\s/]+style\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
      // Strip dangerous URIs by decoding entity representations and inspecting scheme
      .replace(
        /(href|src|xlink:href|formaction|srcset|poster|background|srcdoc|lowsrc)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/gi,
        (match, attrName, valSingle, valDouble, valBare) => {
          const rawVal = valSingle ?? valDouble ?? valBare ?? "";
          const decoded = stripLeadingC0(
            rawVal
              .replace(/&#x([0-9a-f]+);?/gi, (_: string, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              )
              .replace(/&#([0-9]+);?/g, (_: string, dec: string) =>
                String.fromCharCode(parseInt(dec, 10)),
              )
              .replace(/\s+/g, ""),
          ).toLowerCase();
          if (
            decoded.startsWith("javascript:") ||
            decoded.startsWith("vbscript:") ||
            decoded.startsWith("data:")
          ) {
            return `${attrName}="#"`;
          }
          return match;
        },
      )
  );
}

// Single markdown configuration shared by the server renderer and the browser
// (live preview + decrypted E2EE pastes), so every surface produces
// byte-identical HTML.
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const cleanHref = href ? href.trim() : "";
      const lower = stripLeadingC0(cleanHref).toLowerCase();
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

  // Re-highlight fenced code blocks with sugar-high while preserving language class.
  // marked has already entity-escaped the source, so undo that before lexing or
  // the highlighter sees `&quot;` instead of `"` and double-escapes it.
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
      return `<pre><code${classAttr}>${highlight(unescaped)}</code></pre>`;
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

// Flashes a button into its `copied` state for visual confirmation.
export function flashCopied(el: Element | null, ms = 2000) {
  if (!el) return;
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), ms);
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
