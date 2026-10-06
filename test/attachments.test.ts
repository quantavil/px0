import { describe, expect, test } from "bun:test";
import {
  estimateDataUrlBytes,
  formatBytes,
  formatMarkdownWithAttachments,
  getNextFigId,
  parseAttachments,
} from "../src/client/attachments";

describe("Attachments Manager (Option B)", () => {
  test("parseAttachments extracts trailing reference definitions and returns clean markdown", () => {
    const rawMd = `
# Meeting Notes

Here is our chart:
![Quarterly Chart][fig-1]

And the architecture:
![Arch Diagram][fig-2]

[fig-1]: data:image/webp;base64,UklGRm...
[fig-2]: data:image/png;base64,iVBORw...
`.trim();

    const { cleanContent, attachments } = parseAttachments(rawMd);

    expect(cleanContent).toBe(
      `# Meeting Notes\n\nHere is our chart:\n![Quarterly Chart][fig-1]\n\nAnd the architecture:\n![Arch Diagram][fig-2]`,
    );
    expect(attachments.length).toBe(2);
    expect(attachments[0].id).toBe("fig-1");
    expect(attachments[0].name).toBe("Quarterly Chart");
    expect(attachments[0].dataUrl).toBe("data:image/webp;base64,UklGRm...");
    expect(attachments[1].id).toBe("fig-2");
    expect(attachments[1].name).toBe("Arch Diagram");
    expect(attachments[1].dataUrl).toBe("data:image/png;base64,iVBORw...");
  });

  test("parseAttachments returns untouched text when no image references exist", () => {
    const rawMd = "# Hello World\nJust some plain text.";
    const { cleanContent, attachments } = parseAttachments(rawMd);
    expect(cleanContent).toBe(rawMd);
    expect(attachments).toEqual([]);
  });

  test("parseAttachments ignores standard non-image references (like web links)", () => {
    const rawMd = `
Check out [Google][ref-1] and [Docs][ref-2].

[ref-1]: https://google.com
[ref-2]: https://docs.example.com
`.trim();

    const { cleanContent, attachments } = parseAttachments(rawMd);
    expect(cleanContent).toBe(rawMd);
    expect(attachments).toEqual([]);
  });

  test("formatMarkdownWithAttachments appends references to content", () => {
    const cleanContent = "![My Shot][fig-1]";
    const attachments = [
      {
        id: "fig-1",
        name: "My Shot",
        dataUrl: "data:image/webp;base64,1234",
        byteSize: 3,
      },
    ];

    const result = formatMarkdownWithAttachments(cleanContent, attachments);
    expect(result).toBe(
      "![My Shot][fig-1]\n\n[fig-1]: data:image/webp;base64,1234\n",
    );
  });

  test("formatMarkdownWithAttachments returns plain content if attachments list is empty", () => {
    const cleanContent = "No images here.";
    const result = formatMarkdownWithAttachments(cleanContent, []);
    expect(result).toBe("No images here.");
  });

  test("getNextFigId returns highest id + 1 based on text and attachments", () => {
    const attachments = [
      {
        id: "fig-1",
        name: "img",
        dataUrl: "data:image/webp;base64,abc",
        byteSize: 2,
      },
      {
        id: "fig-3",
        name: "img",
        dataUrl: "data:image/webp;base64,def",
        byteSize: 2,
      },
    ];
    // Text also has an old reference [fig-5]
    const nextId = getNextFigId(attachments, "Old ref ![pic][fig-5]");
    expect(nextId).toBe("fig-6");
  });

  test("estimateDataUrlBytes and formatBytes accurately formats sizes", () => {
    // 4 base64 chars = 3 bytes
    const dataUrl = "data:image/webp;base64,AAAA";
    const bytes = estimateDataUrlBytes(dataUrl);
    expect(bytes).toBe(3);

    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  test("handles empty or malformed dataUrls gracefully", () => {
    expect(estimateDataUrlBytes("")).toBe(0);
    expect(estimateDataUrlBytes("data:image/png")).toBe(0);
  });

  test("multiple trailing newlines are cleaned up properly in parseAttachments", () => {
    const rawMd = "Hello\n\n\n[fig-1]: data:image/png;base64,1234\n\n";
    const { cleanContent, attachments } = parseAttachments(rawMd);
    expect(cleanContent).toBe("Hello");
    expect(attachments.length).toBe(1);
  });
});
