import { describe, expect, test } from "bun:test";
import app from "../src/index";
import { renderMarkdown } from "../src/server-renderer";
import { LANDING_CSS } from "../src/styles";

describe("Strict Image CSP & UI Privacy Sanitation", () => {
  test("CSP header restricts img-src strictly to 'self' data: without third-party domains", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("img-src 'self' data:;");
    expect(csp).not.toContain("catbox");
    expect(csp).not.toContain("files.catbox.moe");
  });

  test("POST /api/image returns 404 as server image proxy is removed", async () => {
    const res = await app.request("/api/image", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/image returns 404", async () => {
    const res = await app.request("/api/image");
    expect(res.status).toBe(404);
  });

  test("GET /i/:file returns 404 as px0 does not host images directly", async () => {
    const res = await app.request("/i/photo.png");
    expect(res.status).toBe(404);
  });

  test("landing HTML markup has removed Catbox disclosures, popover, and upload info button", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain("btnUploadInfo");
    expect(html).not.toContain("imagePopover");
    expect(html).not.toContain("catbox");
    expect(html).not.toContain("Catbox");
    expect(html).toContain('id="btnUpload"');
    expect(html).toContain('id="imageInput"');
    expect(html).toContain("<summary>Encryption &amp; local drafts</summary>");
  });

  test("landing CSS has removed upload-control-group, btn-upload-info, and image-popover", () => {
    expect(LANDING_CSS).not.toContain("upload-control-group");
    expect(LANDING_CSS).not.toContain("btn-upload-info");
    expect(LANDING_CSS).not.toContain("image-popover");
  });
});

describe("Client-Side WebP Reference Link Markdown Rendering", () => {
  test("renders valid WebP reference-style image link to img tag", () => {
    const md = `
![sample diagram][fig-1]

[fig-1]: data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsSSc8KQAP7/AAA=
`.trim();

    const rendered = renderMarkdown(md);
    expect(rendered).toContain("<img");
    expect(rendered).toContain('alt="sample diagram"');
    expect(rendered).toContain(
      'src="data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsSSc8KQAP7/AAA="',
    );
  });

  test("renders multiple sequential reference-style images", () => {
    const md = `
First image:
![diagram 1][fig-1]

Second image:
![diagram 2][fig-2]

[fig-1]: data:image/webp;base64,AAA
[fig-2]: data:image/webp;base64,BBB
`.trim();

    const rendered = renderMarkdown(md);
    expect(rendered).toContain('alt="diagram 1"');
    expect(rendered).toContain('src="data:image/webp;base64,AAA"');
    expect(rendered).toContain('alt="diagram 2"');
    expect(rendered).toContain('src="data:image/webp;base64,BBB"');
  });

  test("neutralizes SVG and text/html data URIs in reference links", () => {
    const svgMd = `
![evil svg][fig-1]

[fig-1]: data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+
`.trim();

    const htmlMd = `
![evil html][fig-2]

[fig-2]: data:text/html,<script>alert(1)</script>
`.trim();

    expect(renderMarkdown(svgMd)).not.toContain("data:image/svg");
    expect(renderMarkdown(htmlMd)).not.toContain("data:text/html");
  });

  test("neutralizes javascript: URIs disguised in reference image links", () => {
    const jsMd = `
![xss][fig-1]

[fig-1]: javascript:alert(1)
`.trim();

    const out = renderMarkdown(jsMd);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("alert(1)");
  });
});
