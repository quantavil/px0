// Storage sentinels. Unambiguous enough that user content can't accidentally
// start with one, and defined once so `.substring(13)` magic numbers and
// copies of the literal can't drift apart across the worker and the client.
export const BURN_PREFIX = "__PX0_BURN__:";
export const PASS_PREFIX = "__PX0_PASS__:";
export const ENC_PREFIX = "__PX0_ENC__:";

export const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60; // 2,592,000 seconds
export const MAX_PASTE_BYTES = 5 * 1024 * 1024; // 5MB limit

export const TTL_MAP: Record<string, number> = {
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1h": 3600,
  "3h": 3 * 3600,
  "6h": 6 * 3600,
  "12h": 12 * 3600,
  "1d": 86400,
  "3d": 3 * 86400,
  "7d": 7 * 86400,
  "15d": 15 * 86400,
  "30d": 30 * 86400,
};

export function getTtlSeconds(ttlKey?: string): number {
  if (ttlKey && TTL_MAP[ttlKey]) {
    return TTL_MAP[ttlKey];
  }
  return THIRTY_DAYS_IN_SECONDS;
}

// High-entropy 8-character URL-safe random ID generator (64-character alphabet)
export function generateShortId(length = 8): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

// XSS Prevention: Escape raw HTML entities
export function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Robust Base64URL decoder. Strips stray whitespace and any existing padding
// before restoring it, so keys pasted out of a URL bar still decode instead of
// throwing a DOMException from atob().
export function decodeBase64Url(str: string): string {
  let base64 = str
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=/g, "");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

// Chunk-safe Uint8Array to Base64 (uses 8KB chunks to prevent call stack overflow and excessive string allocation)
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// Chunk-safe Uint8Array to Base64URL
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
