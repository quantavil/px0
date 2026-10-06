export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB

export const ALLOWED_IMAGE_TYPES = ["png", "jpeg", "webp", "gif"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const imageRateLimitMap = new Map<
  string,
  { count: number; resetAt: number }
>();

/**
 * Upstream Catbox request timeout in milliseconds.
 * Default is 15,000ms (15s) to allow multi-megabyte image uploads to succeed reliably.
 */
export const CATBOX_TIMEOUT_MS = 15000;

/**
 * Detect image type by inspecting file magic numbers (byte signatures).
 * Rejects SVG, HTML, scripts, PDFs, and any unsupported format.
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // GIF: GIF87a (47 49 46 38 37 61) or GIF89a (47 49 46 38 39 61)
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }

  // WebP: RIFF (52 49 46 46) at 0..3 and WEBP (57 45 42 50) at 8..11
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

/**
 * Validate that a URL returned from upstream Catbox is strictly an HTTPS URL
 * pointing to files.catbox.moe with a safe image filename and expected extension.
 * Rejects arbitrary URLs, non-HTTPS protocols, query params, hashes, and nested paths.
 */
export function validateCatboxUrl(urlStr: string): string | null {
  try {
    const trimmed = urlStr.trim();
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname.toLowerCase() !== "files.catbox.moe") return null;
    if (parsed.port !== "") return null;
    if (parsed.search !== "" || parsed.hash !== "") return null;
    // Strict filename check: single segment alphanumeric with - or _, ending in valid image extension
    if (!/^\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(parsed.pathname)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}
