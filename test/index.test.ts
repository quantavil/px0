import { describe, expect, test } from "bun:test";
import {
  formatTimeLeft,
  generate8CharPassword,
  renderMarkdown,
  sanitizeOutputHtml,
} from "../src/client/shared";
import app from "../src/index";
import {
  bytesToBase64,
  bytesToBase64Url,
  decodeBase64Url,
  generateShortId,
  getTtlSeconds,
  MAX_PASTE_BYTES,
  sanitizeHtml,
  THIRTY_DAYS_IN_SECONDS,
} from "../src/utils";

describe("Pastebin Core Utilities & Security", () => {
  test("generateShortId produces 8-character URL-safe string", () => {
    const id = generateShortId(8);
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  test("sanitizeHtml escapes raw HTML tags to prevent XSS", () => {
    const maliciousInput =
      '<script>alert("XSS")</script><iframe src="evil.com"></iframe>';
    const sanitized = sanitizeHtml(maliciousInput);

    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("<iframe>");
    expect(sanitized).toContain("&lt;script&gt;");
    expect(sanitized).toContain("&lt;iframe");
  });

  test("decodeBase64Url correctly restores padding for unpadded 43-character base64url keys", () => {
    const unpaddedKey = "UaZD6h08SrC744sIl_dxgGbTsXaNkSQ8u1PMqRlMB54";
    expect(() => decodeBase64Url(unpaddedKey)).not.toThrow();
    const decoded = decodeBase64Url(unpaddedKey);
    expect(decoded.length).toBe(32);
  });

  test("bytesToBase64 and bytesToBase64Url encode Uint8Array without stack overflow", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(bytesToBase64(data)).toBe("SGVsbG8=");
    expect(bytesToBase64Url(data)).toBe("SGVsbG8");

    // Test large byte array chunk safety
    const largeData = new Uint8Array(100000);
    expect(() => bytesToBase64(largeData)).not.toThrow();
  });

  test("THIRTY_DAYS_IN_SECONDS matches exactly 30 days", () => {
    expect(THIRTY_DAYS_IN_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(THIRTY_DAYS_IN_SECONDS).toBe(2592000);
  });

  test("MAX_PASTE_BYTES is 5MB", () => {
    expect(MAX_PASTE_BYTES).toBe(5 * 1024 * 1024);
  });

  test("getTtlSeconds correctly converts expiration keys to seconds", () => {
    expect(getTtlSeconds("15m")).toBe(900);
    expect(getTtlSeconds("1h")).toBe(3600);
    expect(getTtlSeconds("1d")).toBe(86400);
    expect(getTtlSeconds("30d")).toBe(2592000);
    expect(getTtlSeconds("invalid")).toBe(2592000); // defaults to 30d
  });
});

describe("Client Shared Utilities & Post-Sanitizer", () => {
  test("sanitizeOutputHtml strips inline event handlers and dangerous URIs", () => {
    const maliciousHtml =
      '<a href="javascript:alert(1)" onclick="alert(2)">Click</a><img src="x" onerror="alert(3)">';
    const cleaned = sanitizeOutputHtml(maliciousHtml);
    expect(cleaned).not.toContain('href="javascript:alert(1)"');
    expect(cleaned).not.toContain("onclick=");
    expect(cleaned).not.toContain("onerror=");
  });

  test("sanitizeOutputHtml strips handlers separated by / instead of whitespace", () => {
    // HTML accepts `/` as an attribute separator, so `<img/onerror=…>` used to
    // survive a whitespace-only match.
    const cleaned = sanitizeOutputHtml('<img/src="x"/onerror="alert(1)">');
    expect(cleaned).not.toContain("onerror");
  });

  test("renderMarkdown converts headings, lists, task lists, and strikethroughs", () => {
    const md =
      "# Title\n\n- [ ] Todo item\n- [x] Done item\n- Normal bullet\n\n1. Numbered item\n\n~~strikethrough~~";
    const parsed = renderMarkdown(md);
    expect(parsed).toContain("<h1>Title</h1>");
    expect(parsed).toContain('type="checkbox"');
    expect(parsed).toContain("checked");
    expect(parsed).toContain("Normal bullet");
    expect(parsed).toContain("<ol>");
    expect(parsed).toContain("<del>strikethrough</del>");
  });

  test("renderMarkdown does not double-escape quotes in code block highlighting", () => {
    const md = '```js\nconst str = "hello";\n```';
    const parsed = renderMarkdown(md);
    expect(parsed).toContain('class="sh__token--string"');
    expect(parsed).not.toContain("&amp;quot;");
  });

  // The live preview, the server render and the decrypted-paste render must
  // all come from one renderer; previously E2EE pastes went through a
  // hand-rolled parser that could not render tables at all.
  test("renderMarkdown renders GFM tables (regression: E2EE pastes lost them)", () => {
    const parsed = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(parsed).toContain("<table>");
    expect(parsed).toContain("<th>a</th>");
    expect(parsed).toContain("<td>2</td>");
  });

  test("renderMarkdown neutralizes javascript: links and inline handlers", () => {
    const parsed = renderMarkdown(
      '[x](javascript:alert(1))\n\n<img src="y" onerror="alert(2)">',
    );
    expect(parsed).not.toContain("javascript:alert(1)");
    expect(parsed).not.toContain("onerror=");
  });

  test("generate8CharPassword produces an 8-character string with upper, lower, number, and symbol", () => {
    const pass = generate8CharPassword();
    expect(pass).toHaveLength(8);
    expect(pass).toMatch(/[A-Z]/);
    expect(pass).toMatch(/[a-z]/);
    expect(pass).toMatch(/[0-9]/);
    expect(pass).toMatch(/[!@#$%^&*]/);
  });

  test("formatTimeLeft renders remaining paste lifetime in days/hours/minutes", () => {
    const MIN = 60000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    expect(formatTimeLeft(2 * DAY + 5 * HOUR + 30 * MIN)).toBe("2d 5h left");
    expect(formatTimeLeft(12 * HOUR + 7 * MIN)).toBe("12h 7m left");
    expect(formatTimeLeft(45 * MIN)).toBe("45m left");
    expect(formatTimeLeft(30 * 1000)).toBe("<1m left");
    expect(formatTimeLeft(0)).toBe("expired");
    expect(formatTimeLeft(-5000)).toBe("expired");
  });
});

describe("Hono Security & Route Handlers", () => {
  test("Global middleware sets security headers on all routes", async () => {
    const res = await app.request("/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  test("GET /favicon.ico returns SVG icon with 200 OK", async () => {
    const res = await app.request("/favicon.ico");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const text = await res.text();
    expect(text).toContain("<svg");
  });

  test("GET /static/landing.js returns minified client landing script with 200 OK", async () => {
    const res = await app.request("/static/landing.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    const jsText = await res.text();
    expect(jsText.length).toBeGreaterThan(100);
  });

  test("GET /static/viewer.js returns minified client viewer script with 200 OK", async () => {
    const res = await app.request("/static/viewer.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    const jsText = await res.text();
    expect(jsText.length).toBeGreaterThan(100);
  });

  test("Server marked parser neutralizes javascript: URIs in markdown links", async () => {
    const maliciousMd = "[Click me](javascript:alert(1))";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: maliciousMd }),
    });
    const data = (await res.json()) as { id: string };
    const viewRes = await app.request(`/${data.id}`);
    const htmlText = await viewRes.text();
    expect(htmlText).not.toContain('href="javascript:alert(1)"');
  });

  test("View route safely escapes </script> tags inside embedded rawContent script variable", async () => {
    const payload = "</script><img src=x onerror=alert(1)>";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: payload }),
    });
    const data = (await res.json()) as { id: string };
    const viewRes = await app.request(`/${data.id}`);
    const htmlText = await viewRes.text();
    expect(htmlText).not.toContain('var rawContent = "</script>');
    expect(htmlText).toContain("\\u003c\\u002fscript\\u003e");
  });

  test("POST /api/paste rejects empty content", async () => {
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("Content required");
  });

  test("POST /api/paste rejects invalid JSON body", async () => {
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json{",
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("Invalid JSON body");
  });

  test("POST /api/paste rejects non-string content", async () => {
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 12345 }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("Content required");
  });

  test("POST /api/paste rejects payloads exceeding 5MB limit", async () => {
    const hugeContent = "x".repeat(5 * 1024 * 1024 + 1);
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: hugeContent }),
    });

    expect(res.status).toBe(413);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("5MB limit");
  });

  test("POST /api/paste creates a valid paste ID and stores content", async () => {
    const markdownContent = "# Test Paste\n\nThis is a **test** paste.";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: markdownContent, ttl: "1d" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string };
    expect(data.id).toBeDefined();
    expect(data.id).toHaveLength(8);

    // Verify retrieval via GET /:id
    const viewRes = await app.request(`/${data.id}`);
    expect(viewRes.status).toBe(200);
    const htmlText = await viewRes.text();
    expect(htmlText).toContain("<h1>Test Paste</h1>");
    expect(htmlText).toContain("<strong>test</strong>");

    // Verify retrieval via GET /raw/:id
    const rawRes = await app.request(`/raw/${data.id}`);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("Content-Type")).toContain("text/plain");
    const rawText = await rawRes.text();
    expect(rawText).toBe(markdownContent);
  });

  test("Server renders blockquotes correctly for plaintext pastes (F1 fix)", async () => {
    const blockquoteMd = "> This is a blockquote";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blockquoteMd }),
    });
    const data = (await res.json()) as { id: string };
    const viewRes = await app.request(`/${data.id}`);
    const htmlText = await viewRes.text();
    expect(htmlText).toContain("<blockquote>");
  });

  test("POST /api/paste with burn TTL creates Burn-After-Read self-destructing paste", async () => {
    const sensitiveContent = "# Burn Secret\n\nThis message self-destructs!";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: sensitiveContent, ttl: "burn" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string };

    // First view -> Returns 200 OK with Burned After Read badge
    const firstView = await app.request(`/${data.id}`);
    expect(firstView.status).toBe(200);
    const firstHtml = await firstView.text();
    expect(firstHtml).toContain("Burned After Read");
    expect(firstHtml).toContain("Burn Secret");

    // Second view -> Paste has self-destructed! Returns 404
    const secondView = await app.request(`/${data.id}`);
    expect(secondView.status).toBe(404);
  });

  test("POST /api/paste handles Password Protected PASS: payload format correctly", async () => {
    const passwordPayload = "__PX0_PASS__:salt123:iv123:ciphertext123";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: passwordPayload }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string };

    const viewRes = await app.request(`/${data.id}`);
    expect(viewRes.status).toBe(200);
    const htmlText = await viewRes.text();
    expect(htmlText).toContain('data-password="true"');
  });

  test("POST /api/paste handles E2EE encrypted payload format correctly", async () => {
    const encryptedPayload = "__PX0_ENC__:SGVsbG8gV29ybGQ=";
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: encryptedPayload }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string };

    const viewRes = await app.request(`/${data.id}`);
    expect(viewRes.status).toBe(200);
    const htmlText = await viewRes.text();
    expect(htmlText).toContain('data-encrypted="true"');
    expect(htmlText).toContain("Decrypting end-to-end encrypted payload");
  });

  test("GET /nonexistent returns 404 expired paste page", async () => {
    const res = await app.request("/nonexistent_paste_id");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("Paste Unavailable");
    expect(text).toContain("paste_expired_or_absent");
  });

  test("GET /raw/nonexistent returns 404 plaintext response", async () => {
    const res = await app.request("/raw/nonexistent_paste_id");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Paste Expired or Not Found");
  });

  test("POST /api/paste rejects invalid ttl parameter with 400 Bad Request", async () => {
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test", ttl: "invalid_ttl_999" }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Invalid TTL option");
  });

  test("POST /api/paste rejects oversized Content-Length header with 413", async () => {
    const res = await app.request("/api/paste", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "6000000",
      },
      body: JSON.stringify({ content: "test" }),
    });

    expect(res.status).toBe(413);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Payload exceeds 5MB limit");
  });

  test("Global middleware sets Strict-Transport-Security and CSP frame-ancestors headers", async () => {
    const res = await app.request("/");
    expect(res.headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
