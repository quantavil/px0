import { decodeBase64Url } from "../utils";

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
