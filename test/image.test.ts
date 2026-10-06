import { afterEach, describe, expect, test } from "bun:test";
import {
  CATBOX_TIMEOUT_MS,
  detectImageType,
  imageRateLimitMap,
  MAX_IMAGE_BYTES,
  validateCatboxUrl,
} from "../src/image";
import app from "../src/index";

// Mock fixtures
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const gif87Bytes = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
]);
const gif89Bytes = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
]);
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const svgBytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
);
const htmlBytes = new TextEncoder().encode(
  "<!DOCTYPE html><html><body>Test</body></html>",
);

describe("Image Format Signature Detection", () => {
  test("correctly identifies PNG magic bytes", () => {
    expect(detectImageType(pngBytes)).toBe("png");
  });

  test("correctly identifies JPEG SOI marker", () => {
    expect(detectImageType(jpegBytes)).toBe("jpeg");
  });

  test("correctly identifies GIF87a and GIF89a signatures", () => {
    expect(detectImageType(gif87Bytes)).toBe("gif");
    expect(detectImageType(gif89Bytes)).toBe("gif");
  });

  test("correctly identifies WebP RIFF/WEBP chunks", () => {
    expect(detectImageType(webpBytes)).toBe("webp");
  });

  test("rejects SVG files with XML/HTML headers", () => {
    expect(detectImageType(svgBytes)).toBeNull();
  });

  test("rejects HTML files", () => {
    expect(detectImageType(htmlBytes)).toBeNull();
  });

  test("rejects truncated/empty byte arrays", () => {
    expect(detectImageType(new Uint8Array([]))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(detectImageType(new Uint8Array(11))).toBeNull();
  });
});

describe("Catbox URL Validation", () => {
  test("accepts valid https files.catbox.moe URLs with supported image extensions", () => {
    expect(validateCatboxUrl("https://files.catbox.moe/abc123.png")).toBe(
      "https://files.catbox.moe/abc123.png",
    );
    expect(validateCatboxUrl("https://files.catbox.moe/xyz_789.jpg")).toBe(
      "https://files.catbox.moe/xyz_789.jpg",
    );
    expect(validateCatboxUrl("https://files.catbox.moe/photo.jpeg")).toBe(
      "https://files.catbox.moe/photo.jpeg",
    );
    expect(validateCatboxUrl("https://files.catbox.moe/card.webp")).toBe(
      "https://files.catbox.moe/card.webp",
    );
    expect(validateCatboxUrl("https://files.catbox.moe/anim.gif")).toBe(
      "https://files.catbox.moe/anim.gif",
    );
  });

  test("rejects non-HTTPS URLs", () => {
    expect(validateCatboxUrl("http://files.catbox.moe/abc123.png")).toBeNull();
  });

  test("rejects different domains or hostname spoofing", () => {
    expect(validateCatboxUrl("https://catbox.moe/abc123.png")).toBeNull();
    expect(
      validateCatboxUrl("https://files.catbox.moe.attacker.com/abc123.png"),
    ).toBeNull();
    expect(validateCatboxUrl("https://evil.com/abc123.png")).toBeNull();
  });

  test("rejects custom ports", () => {
    expect(
      validateCatboxUrl("https://files.catbox.moe:8443/abc123.png"),
    ).toBeNull();
  });

  test("rejects query strings and URL fragments", () => {
    expect(
      validateCatboxUrl("https://files.catbox.moe/abc123.png?token=secret"),
    ).toBeNull();
    expect(
      validateCatboxUrl("https://files.catbox.moe/abc123.png#fragment"),
    ).toBeNull();
  });

  test("rejects path traversal and nested directories", () => {
    expect(
      validateCatboxUrl("https://files.catbox.moe/../etc/passwd.png"),
    ).toBeNull();
    expect(
      validateCatboxUrl("https://files.catbox.moe/nested/dir/abc.png"),
    ).toBeNull();
  });

  test("rejects unsupported extensions and SVG", () => {
    expect(validateCatboxUrl("https://files.catbox.moe/vector.svg")).toBeNull();
    expect(validateCatboxUrl("https://files.catbox.moe/app.exe")).toBeNull();
    expect(validateCatboxUrl("https://files.catbox.moe/doc.pdf")).toBeNull();
    expect(validateCatboxUrl("https://files.catbox.moe/text.txt")).toBeNull();
  });
});

describe("POST /api/image Endpoint", () => {
  const originalFetch = globalThis.fetch;

  function mockFetch(
    fn: (input?: unknown, init?: RequestInit) => Promise<Response>,
  ) {
    globalThis.fetch = fn as unknown as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    imageRateLimitMap.clear();
  });

  test("uploads valid PNG via multipart/form-data and returns verified Catbox URL", async () => {
    mockFetch(async (input, init) => {
      expect(String(input)).toBe("https://catbox.moe/user/api.php");
      expect(init?.method).toBe("POST");
      const body = init?.body as FormData;
      expect(body.get("reqtype")).toBe("fileupload");
      const file = body.get("fileToUpload") as File;
      expect(file).toBeDefined();
      return new Response("https://files.catbox.moe/6k4v9x.png", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toBe("https://files.catbox.moe/6k4v9x.png");
  });

  test("accepts fileToUpload multipart form field name", async () => {
    mockFetch(async () => {
      return new Response("https://files.catbox.moe/field1.png", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    const formData = new FormData();
    formData.append(
      "fileToUpload",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toBe("https://files.catbox.moe/field1.png");
  });

  test("rejects empty 0-byte image with 400 Bad Request", async () => {
    const formData = new FormData();
    formData.append("file", new Blob([], { type: "image/png" }), "empty.png");

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("empty");
  });

  test("handles client abort by terminating upstream fetch", async () => {
    let upstreamAborted = false;
    mockFetch(async (_input, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          upstreamAborted = true;
          reject(new Error("aborted"));
        } else {
          init?.signal?.addEventListener("abort", () => {
            upstreamAborted = true;
            reject(new Error("aborted"));
          });
        }
      });
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const abortController = new AbortController();
    const reqPromise = app.request("/api/image", {
      method: "POST",
      body: formData,
      signal: abortController.signal,
    });

    // Abort client request while in-flight
    abortController.abort();
    try {
      await reqPromise;
    } catch {
      // In fetch runtimes, client abort rejects the request promise
    }

    expect(upstreamAborted).toBe(true);
  });

  test("uploads valid JPEG via binary raw body and returns verified Catbox URL", async () => {
    mockFetch(async () => {
      return new Response("https://files.catbox.moe/998877.jpg", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    const res = await app.request("/api/image", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: jpegBytes,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toBe("https://files.catbox.moe/998877.jpg");
  });

  test("rejects SVG files with 400 Bad Request", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([svgBytes as unknown as BlobPart], { type: "image/svg+xml" }),
      "icon.svg",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Invalid image format");
  });

  test("rejects files exceeding 5MB with 413 Payload Too Large", async () => {
    const oversizedBytes = new Uint8Array(MAX_IMAGE_BYTES + 10);
    oversizedBytes.set(pngBytes); // Valid PNG signature at start

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([oversizedBytes as unknown as BlobPart], { type: "image/png" }),
      "big.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("5MB");
  });

  test("rejects oversized Content-Length header with 413", async () => {
    const res = await app.request("/api/image", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(MAX_IMAGE_BYTES + 100000),
      },
      body: pngBytes,
    });

    expect(res.status).toBe(413);
  });

  test("rejects unsupported media type with 415", async () => {
    const res = await app.request("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(415);
  });

  test("handles upstream 500 error safely with 502 Bad Gateway", async () => {
    mockFetch(async () => {
      return new Response("Internal Catbox Error", { status: 500 });
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(
      "Catbox image host is currently unreachable. Please try again later.",
    );
  });

  test("handles upstream malformed/arbitrary URL response with 502", async () => {
    mockFetch(async () => {
      return new Response("https://attacker.com/evil.png", { status: 200 });
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Invalid image URL");
  });

  test("handles upstream network error with 502", async () => {
    mockFetch(async () => {
      const err = new Error("Connection refused");
      throw err;
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(
      "Catbox image host is currently unreachable. Please try again later.",
    );
  });

  test("handles upstream timeout with 504 Gateway Timeout", async () => {
    mockFetch(async (_input, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        } else {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request(
      "/api/image",
      {
        method: "POST",
        body: formData,
      },
      { CATBOX_TIMEOUT_MS: 50 },
    );
    expect(res.status).toBe(504);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Image upload timed out. Catbox may be down.");
  });

  test("rate limiter returns 429 after 20 image uploads per minute", async () => {
    mockFetch(async () => {
      return new Response("https://files.catbox.moe/abc123.png", {
        status: 200,
      });
    });

    for (let i = 0; i < 20; i++) {
      const res = await app.request("/api/image", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "cf-connecting-ip": "198.51.100.42",
        },
        body: pngBytes,
      });
      expect(res.status).toBe(200);
    }

    const blockedRes = await app.request("/api/image", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "cf-connecting-ip": "198.51.100.42",
      },
      body: pngBytes,
    });
    expect(blockedRes.status).toBe(429);
  });

  test("CSP header includes https://files.catbox.moe in img-src", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("img-src 'self' data: https://files.catbox.moe");
  });

  test("accepts arbitrary multipart form field name via fallback", async () => {
    mockFetch(async () => {
      return new Response("https://files.catbox.moe/fallback_field.png", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    const formData = new FormData();
    formData.append(
      "custom_photo",
      new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
      "test.png",
    );

    const res = await app.request("/api/image", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toBe("https://files.catbox.moe/fallback_field.png");
  });

  test("CATBOX_TIMEOUT_MS is positive number", () => {
    expect(CATBOX_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("GET /i/:file returns 404 since self-hosted image serving is disabled", async () => {
    const res = await app.request("/i/testimage123.png");
    expect(res.status).toBe(404);
  });
});
