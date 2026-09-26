import { describe, expect, test } from "bun:test";
import { sanitizeOutputHtml } from "../src/client/shared";

// Bun has no window/DOM, so this always exercises the regex fallback
// (the Worker path). The DOMPurify browser path is covered by
// e2e/sanitizer.spec.ts in real Chromium.
describe("sanitizer fallback policy", () => {
  test("neutralizes scheme tricks", () => {
    for (const payload of [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="java\nscript:alert(1)">x</a>',
      '<a href="jav\tascript:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<img src="x" onerror="alert(1)">',
      "<script>alert(1)</script><p>ok</p>",
    ]) {
      const out = sanitizeOutputHtml(payload);
      expect(out).not.toContain("javascript:");
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("<script");
    }
    expect(sanitizeOutputHtml("<p>ok</p>")).toContain("<p>ok</p>");
  });

  test("raster data: allowed, html/svg blocked", () => {
    expect(
      sanitizeOutputHtml('<img src="data:image/png;base64,AAA">'),
    ).toContain("data:image/png");
    expect(sanitizeOutputHtml('<img src="data:text/html,x">')).toContain(
      'src="#"',
    );
    expect(
      sanitizeOutputHtml('<img src="data:image/svg+xml;base64,AAA">'),
    ).toContain('src="#"');
  });

  test("srcset second candidate blocked", () => {
    expect(
      sanitizeOutputHtml('<img srcset="a.jpg 1x, javascript:alert(1) 2x">'),
    ).toContain('srcset="#"');
  });
});
