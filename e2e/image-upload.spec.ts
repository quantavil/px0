import { devices, expect, test } from "@playwright/test";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Client-Side WebP Image Compression & Reference Link Insertion", () => {
  test("selecting an image through the upload button compresses and inserts reference link and definition", async ({
    page,
  }) => {
    await page.goto("/");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[diagram\]\[fig-1\]/);
    await expect(editor).toHaveValue(/\[fig-1\]: data:image\/(webp|jpeg);base64,/);

    // Verify it renders in live preview
    await page.locator("#btnSplit").click();
    const previewImg = page.locator('#previewPane img[src^="data:image/"]');
    await expect(previewImg).toBeVisible();

    // Save and verify on saved viewer page
    await page.locator("#saveBtn").click();
    const pasteUrl = await page.locator("#pxPasteUrl").inputValue();
    await page.goto(pasteUrl);
    const viewerImg = page.locator('#output img[src^="data:image/"]');
    await expect(viewerImg).toBeVisible();
  });

  test("pasting clipboard image compresses and inserts reference link; normal text paste is unaffected", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.focus();

    // 1. Normal text paste should paste text and NOT trigger image compression
    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", "ordinary text snippet");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    await expect(editor).not.toHaveValue(/!\[/);

    // 2. Image clipboard paste triggers local compression
    await page.evaluate((pngBase64) => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "clip.png", { type: "image/png" });
      dt.items.add(file);
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, ONE_BY_ONE_PNG.toString("base64"));

    await expect(editor).toHaveValue(/!\[clip\]\[fig-1\]/);
    await expect(editor).toHaveValue(/\[fig-1\]: data:image\/(webp|jpeg);base64,/);
  });

  test("dragging and dropping an image onto the editor compresses and inserts reference link", async ({
    page,
  }) => {
    await page.goto("/");

    await page.evaluate((pngBase64) => {
      const container = document.getElementById("editorContainer")!;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "artwork.png", { type: "image/png" });
      dt.items.add(file);
      container.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    }, ONE_BY_ONE_PNG.toString("base64"));

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[artwork\]\[fig-1\]/);
    await expect(editor).toHaveValue(/\[fig-1\]: data:image\/(webp|jpeg);base64,/);
  });

  test("uploading multiple files sequentially inserts reference links for all images with unique fig keys", async ({
    page,
  }) => {
    await page.goto("/");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles([
      {
        name: "pic1.png",
        mimeType: "image/png",
        buffer: ONE_BY_ONE_PNG,
      },
      {
        name: "pic2.png",
        mimeType: "image/png",
        buffer: ONE_BY_ONE_PNG,
      },
    ]);

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[pic1\]\[fig-1\]/);
    await expect(editor).toHaveValue(/!\[pic2\]\[fig-2\]/);
    await expect(editor).toHaveValue(/\[fig-1\]: data:image\/(webp|jpeg);base64,/);
    await expect(editor).toHaveValue(/\[fig-2\]: data:image\/(webp|jpeg);base64,/);
  });

  test("native Undo restores content after image insertion", async ({ page }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.pressSequentially("Note before image");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });

    await expect(editor).toHaveValue(/!\[shot\]\[fig-1\]/);

    // Press Undo inside textarea (first undo removes reference definition, second removes link)
    await editor.press("ControlOrMeta+z");
    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveValue("Note before image");
  });

  test("oversized file exceeding 10MB shows understandable error and preserves editor text", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.fill("Preserve this precious text");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(11 * 1024 * 1024),
    });

    // Error should be shown
    const saveError = page.locator("#saveError");
    await expect(saveError).toContainText("exceeds 10MB limit");

    // uploadStatus must not be stuck on "Compressing image…"
    await expect(page.locator("#uploadStatus")).toHaveText("");

    // Existing text must be intact
    await expect(editor).toHaveValue("Preserve this precious text");
  });

  test("dragging and dropping an unsupported file shows understandable error", async ({
    page,
  }) => {
    await page.goto("/");

    await page.evaluate(() => {
      const container = document.getElementById("editorContainer")!;
      const dt = new DataTransfer();
      const file = new File(["not an image"], "document.pdf", {
        type: "application/pdf",
      });
      dt.items.add(file);
      container.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    });

    const saveError = page.locator("#saveError");
    await expect(saveError).toContainText("not a supported format");
  });

  test("pasting clipboard image with auxiliary filename text in text/plain still processes", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate((pngBase64) => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "screenshot.png", { type: "image/png" });
      dt.items.add(file);
      dt.setData("text/plain", "screenshot.png");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, ONE_BY_ONE_PNG.toString("base64"));

    await expect(editor).toHaveValue(/!\[screenshot\]\[fig-1\]/);
  });

  test("mobile touch target for image upload button is at least 44x44px", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3005/");

    const box = await page.locator("#btnUpload").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);

    await context.close();
  });

  test("mobile preview toggles live markdown preview pane", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3005/");

    const editor = page.locator("#content");
    await editor.fill("# Mobile Heading\n\nSome body text.");

    const btnSplit = page.locator("#btnSplit");
    await btnSplit.click();

    const previewPane = page.locator("#previewPane");
    await expect(previewPane).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(page.locator("#previewPane h1")).toHaveText("Mobile Heading");

    // Tapping again closes preview
    await btnSplit.click();
    await expect(previewPane).toBeHidden();

    await context.close();
  });

  test("selecting the same file consecutively triggers change and compresses both times", async ({
    page,
  }) => {
    await page.goto("/");

    const fileInput = page.locator("#imageInput");
    const editor = page.locator("#content");

    // 1st selection
    await fileInput.setInputFiles({
      name: "repeat.png",
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });
    await expect(editor).toHaveValue(/!\[repeat\]\[fig-1\]/);

    // 2nd selection of identical file (retry or second insert)
    await fileInput.setInputFiles({
      name: "repeat.png",
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });
    await expect(editor).toHaveValue(/!\[repeat\]\[fig-2\]/);
  });

  test("pasting clipboard image with arbitrary non-matching text in text/plain still processes", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate((pngBase64) => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "image.png", { type: "image/png" });
      dt.items.add(file);
      dt.setData("text/plain", "Screenshot_2026-10-06_084315.png (1 item copied)");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, ONE_BY_ONE_PNG.toString("base64"));

    await expect(editor).toHaveValue(/!\[image\]\[fig-1\]/);
  });

  test("clicking saveError dismisses the error banner immediately", async ({ page }) => {
    await page.goto("/");

    // Trigger an error by dropping unsupported file
    await page.evaluate(() => {
      const container = document.getElementById("editorContainer")!;
      const dt = new DataTransfer();
      const file = new File(["not an image"], "bad.pdf", { type: "application/pdf" });
      dt.items.add(file);
      container.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    });

    const saveError = page.locator("#saveError");
    await expect(saveError).toContainText("not a supported format");

    // Click to dismiss
    await saveError.click();
    await expect(saveError).toHaveText("");
  });

  test("beforeinput event with image dataTransfer triggers compression and inserts markdown", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate((pngBase64) => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "sticker.png", { type: "image/png" });
      dt.items.add(file);

      const inputEvent = new CustomEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
      }) as unknown as { inputType: string; dataTransfer: DataTransfer };
      Object.defineProperty(inputEvent, "inputType", { value: "insertFromPaste" });
      Object.defineProperty(inputEvent, "dataTransfer", { value: dt });
      ta.dispatchEvent(inputEvent as unknown as Event);
    }, ONE_BY_ONE_PNG.toString("base64"));

    await expect(editor).toHaveValue(/!\[sticker\]\[fig-1\]/);
  });

  test("rapid duplicate paste and beforeinput events do not trigger error", async ({
    page,
  }) => {
    await page.goto("/");

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate((pngBase64) => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "shot.png", { type: "image/png" });
      dt.items.add(file);

      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));

      const inputEvent = new CustomEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
      }) as unknown as { inputType: string; dataTransfer: DataTransfer };
      Object.defineProperty(inputEvent, "inputType", { value: "insertFromPaste" });
      Object.defineProperty(inputEvent, "dataTransfer", { value: dt });
      ta.dispatchEvent(inputEvent as unknown as Event);
    }, ONE_BY_ONE_PNG.toString("base64"));

    await expect(editor).toHaveValue(/!\[shot\]\[fig-1\]/);
    const saveError = page.locator("#saveError");
    await expect(saveError).toHaveText("");
  });

  test("landing page with image controls passes automated WCAG accessibility checks", async ({
    page,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
});
