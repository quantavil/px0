import { devices, expect, test } from "@playwright/test";

test.describe("Catbox Image Upload & Integration", () => {
  test("selecting an image through the upload button uploads and inserts markdown link", async ({
    page,
  }) => {
    await page.goto("/");

    // Mock /api/image so real Catbox service is never spammed
    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/cat123.png" }),
      });
    });

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]),
    });

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[diagram\]\(https:\/\/files\.catbox\.moe\/cat123\.png\)/);

    // Verify it renders in live preview
    await page.locator("#btnSplit").click();
    const previewImg = page.locator('#previewPane img[src="https://files.catbox.moe/cat123.png"]');
    await expect(previewImg).toBeVisible();

    // Save and verify on saved viewer page
    await page.locator("#saveBtn").click();
    const pasteUrl = await page.locator("#pxPasteUrl").inputValue();
    await page.goto(pasteUrl);
    const viewerImg = page.locator('#output img[src="https://files.catbox.moe/cat123.png"]');
    await expect(viewerImg).toBeVisible();
  });

  test("pasting clipboard image uploads and inserts markdown link; normal text paste is unaffected", async ({
    page,
  }) => {
    await page.goto("/");

    let uploadCount = 0;
    await page.route("**/api/image", async (route) => {
      uploadCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/clip456.jpg" }),
      });
    });

    const editor = page.locator("#content");
    await editor.focus();

    // 1. Normal text paste should paste text and NOT trigger image upload
    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", "ordinary text snippet");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    // In automated browser without native OS paste, simulate value or verify uploadCount is 0
    expect(uploadCount).toBe(0);

    // 2. Image clipboard paste triggers upload
    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "clip.jpg", {
        type: "image/jpeg",
      });
      dt.items.add(file);
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });

    await expect(editor).toHaveValue(/!\[clip\]\(https:\/\/files\.catbox\.moe\/clip456\.jpg\)/);
    expect(uploadCount).toBe(1);
  });

  test("dragging and dropping an image onto the editor uploads and inserts markdown link", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/drop789.webp" }),
      });
    });

    await page.evaluate(() => {
      const container = document.getElementById("editorContainer")!;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "artwork.webp", {
        type: "image/webp",
      });
      dt.items.add(file);
      container.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    });

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[artwork\]\(https:\/\/files\.catbox\.moe\/drop789\.webp\)/);
  });

  test("uploading multiple files sequentially inserts links for all images", async ({ page }) => {
    await page.goto("/");

    const uploadedUrls = [
      "https://files.catbox.moe/img1.png",
      "https://files.catbox.moe/img2.gif",
    ];
    let requestIndex = 0;

    await page.route("**/api/image", async (route) => {
      const url = uploadedUrls[requestIndex++] || "https://files.catbox.moe/fallback.png";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url }),
      });
    });

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles([
      {
        name: "pic1.png",
        mimeType: "image/png",
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
      {
        name: "pic2.gif",
        mimeType: "image/gif",
        buffer: Buffer.from([0x47, 0x49, 0x46, 0x38]),
      },
    ]);

    const editor = page.locator("#content");
    await expect(editor).toHaveValue(/!\[pic1\]\(https:\/\/files\.catbox\.moe\/img1\.png\)/);
    await expect(editor).toHaveValue(/!\[pic2\]\(https:\/\/files\.catbox\.moe\/img2\.gif\)/);
  });

  test("native Undo restores content after image insertion", async ({ page }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/undo.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.pressSequentially("Note before image");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    await expect(editor).toHaveValue(/https:\/\/files\.catbox\.moe\/undo\.png/);

    // Press Undo (ControlOrMeta+z) inside textarea
    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveValue("Note before image");
  });

  test("upload failure preserves existing editor text and shows understandable error", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to connect to image host" }),
      });
    });

    const editor = page.locator("#content");
    await editor.fill("Preserve this precious text");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "failed.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    // Error should be shown
    const saveError = page.locator("#saveError");
    await expect(saveError).toContainText("Failed to connect to image host");

    // Existing text must be 100% intact
    await expect(editor).toHaveValue("Preserve this precious text");
  });

  test("late upload responses do not modify a new/different draft", async ({ page }) => {
    await page.goto("/");

    let fulfillUpload: (() => void) | null = null;
    await page.route("**/api/image", async (route) => {
      await new Promise<void>((resolve) => {
        fulfillUpload = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/late.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.fill("First draft text");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "late.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    // User starts a New Paste while upload is in flight
    await page.locator('header a[title="New Paste"]').click();
    await expect(editor).toHaveValue("");

    // Now resolve the late upload
    if (fulfillUpload) (fulfillUpload as () => void)();

    await page.waitForTimeout(400);

    // Editor should still be empty! Late response must not inject into the new draft
    await expect(editor).toHaveValue("");
  });

  test("privacy popover opens near upload control and explains Catbox public hosting", async ({
    page,
  }) => {
    await page.goto("/");

    const infoBtn = page.locator("#btnUploadInfo");
    const popover = page.locator("#imagePopover");

    await expect(popover).toBeHidden();
    await infoBtn.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("publicly");
    await expect(popover).toContainText("not end-to-end encrypted");
    await expect(popover).toContainText("burn-after-read do not delete Catbox images");

    // Pressing Escape closes it
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
  });

  test("mobile touch targets for image upload and info buttons are at least 44x44px", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3005/");

    for (const selector of ["#btnUpload", "#btnUploadInfo"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    await context.close();
  });

  test("landing page with image controls passes automated WCAG accessibility checks", async ({
    page,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });
});
