import DOMPurify from "dompurify";
import { marked } from "marked";
import { highlight } from "sugar-high";
import { lang } from "sugar-high/lang";
import { MAX_RENDER_CHARS, sanitizeHtml } from "../utils";
import {
  isDangerousSrcset,
  isDangerousUrl,
  stripRasterDataUrls,
} from "./shared";

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
    "loading",
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
    image({ href, title, text }) {
      const cleanHref = href ? href.trim() : "";
      if (!cleanHref || isDangerousUrl(cleanHref)) {
        return sanitizeHtml(text || "");
      }
      const titleAttr = title ? ` title="${sanitizeHtml(title)}"` : "";
      return `<img src="${sanitizeHtml(cleanHref)}" alt="${sanitizeHtml(text || "")}"${titleAttr} loading="lazy">`;
    },
  },
});

export function renderMarkdown(
  md: string,
  sanitize: (html: string) => string = sanitizeOutputHtml,
): string {
  if (!md) return "";
  if (stripRasterDataUrls(md).length > MAX_RENDER_CHARS) {
    return `<p class="large-paste-note">Large paste — showing the first 20,000 characters as text. Copy or download to get the complete paste.</p><pre class="large-paste-excerpt"><code>${sanitizeHtml(md.slice(0, MAX_RENDER_CHARS))}</code></pre>`;
  }
  if (!md.trim()) return "";

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

if (typeof window !== "undefined") {
  (
    window as unknown as { __px0_renderMarkdown__?: typeof renderMarkdown }
  ).__px0_renderMarkdown__ = renderMarkdown;
}
