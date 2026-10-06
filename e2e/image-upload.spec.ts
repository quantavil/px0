import { devices, expect, test } from "@playwright/test";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Catbox Image Upload & Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://files.catbox.moe/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: ONE_BY_ONE_PNG,
      });
    });
  });

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

    // uploadStatus must NOT be stuck on "Uploading image…"
    await expect(page.locator("#uploadStatus")).toHaveText("");

    // Existing text must be 100% intact
    await expect(editor).toHaveValue("Preserve this precious text");
  });

  test("late upload responses do not modify a new/different draft and clear uploadStatus", async ({
    page,
  }) => {
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
    await expect(page.locator("#uploadStatus")).toHaveText("");

    // Now resolve the late upload
    if (fulfillUpload) (fulfillUpload as () => void)();

    await page.waitForTimeout(400);

    // Editor should still be empty! Late response must not inject into the new draft
    await expect(editor).toHaveValue("");
    await expect(page.locator("#uploadStatus")).toHaveText("");
  });

  test("saving paste is blocked with warning while image upload is in progress", async ({
    page,
  }) => {
    await page.goto("/");

    let fulfillUpload: (() => void) | null = null;
    await page.route("**/api/image", async (route) => {
      await new Promise<void>((resolve) => {
        fulfillUpload = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/slow.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.fill("Draft awaiting image upload");

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "slow.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    // Try to save before image upload completes
    await page.locator("#saveBtn").click();

    // Verify understandable warning is shown and paste was NOT submitted (no success modal)
    await expect(page.locator("#saveError")).toContainText("Please wait for image upload to complete");
    await expect(page.locator("#pxModalOverlay")).toBeHidden();

    // Now resolve the upload
    if (fulfillUpload) (fulfillUpload as () => void)();
    await expect(editor).toHaveValue(/!\[slow\]\(https:\/\/files\.catbox\.moe\/slow\.png\)/);
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

  test("pasting clipboard image with auxiliary filename text in text/plain still uploads", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/fromfilemanager.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot.png", {
        type: "image/png",
      });
      dt.items.add(file);
      dt.setData("text/plain", "screenshot.png");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });

    await expect(editor).toHaveValue(/!\[screenshot\]\(https:\/\/files\.catbox\.moe\/fromfilemanager\.png\)/);
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

  test("selecting the same file consecutively triggers change and uploads both times", async ({
    page,
  }) => {
    await page.goto("/");

    let uploadCount = 0;
    await page.route("**/api/image", async (route) => {
      uploadCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: `https://files.catbox.moe/samefile${uploadCount}.png` }),
      });
    });

    const fileInput = page.locator("#imageInput");
    const editor = page.locator("#content");

    // 1st selection
    await fileInput.setInputFiles({
      name: "repeat.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(editor).toHaveValue(/samefile1\.png/);
    expect(uploadCount).toBe(1);

    // 2nd selection of identical file (simulates retry or repeat upload)
    await fileInput.setInputFiles({
      name: "repeat.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(editor).toHaveValue(/samefile2\.png/);
    expect(uploadCount).toBe(2);
  });

  test("pasting clipboard image with arbitrary non-matching text in text/plain still uploads", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/arbitrarytext.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", {
        type: "image/png",
      });
      dt.items.add(file);
      // Arbitrary description / localized name / Gboard caption
      dt.setData("text/plain", "Screenshot_2026-10-06_084315.png (1 item copied)");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });

    await expect(editor).toHaveValue(/!\[image\]\(https:\/\/files\.catbox\.moe\/arbitrarytext\.png\)/);
  });

  test("clicking saveError dismisses the error banner immediately", async ({ page }) => {
    await page.goto("/");

    // Trigger an error by rejecting upload
    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({ error: "Image upload timed out" }),
      });
    });

    const fileInput = page.locator("#imageInput");
    await fileInput.setInputFiles({
      name: "fail.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    const saveError = page.locator("#saveError");
    await expect(saveError).toHaveText("Image upload timed out");

    // Click to dismiss
    await saveError.click();
    await expect(saveError).toHaveText("");
  });

  test("beforeinput event with image dataTransfer triggers upload and inserts markdown", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/gboard_chip.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sticker.png", {
        type: "image/png",
      });
      dt.items.add(file);

      // Simulate Gboard inserting image via beforeinput
      const inputEvent = new CustomEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
      }) as unknown as { inputType: string; dataTransfer: DataTransfer };
      Object.defineProperty(inputEvent, "inputType", { value: "insertFromPaste" });
      Object.defineProperty(inputEvent, "dataTransfer", { value: dt });
      ta.dispatchEvent(inputEvent as unknown as Event);
    });

    await expect(editor).toHaveValue(/!\[sticker\]\(https:\/\/files\.catbox\.moe\/gboard_chip\.png\)/);
  });

  test("rapid duplicate paste and beforeinput events do not trigger 'Upload already in progress' error", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://files.catbox.moe/rapid_paste.png" }),
      });
    });

    const editor = page.locator("#content");
    await editor.focus();

    await page.evaluate(() => {
      const ta = document.getElementById("content") as HTMLTextAreaElement;
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
        type: "image/png",
      });
      dt.items.add(file);

      // Fire paste then beforeinput immediately
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));

      const inputEvent = new CustomEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
      }) as unknown as { inputType: string; dataTransfer: DataTransfer };
      Object.defineProperty(inputEvent, "inputType", { value: "insertFromPaste" });
      Object.defineProperty(inputEvent, "dataTransfer", { value: dt });
      ta.dispatchEvent(inputEvent as unknown as Event);
    });

    // Editor receives markdown link
    await expect(editor).toHaveValue(/!\[shot\]\(https:\/\/files\.catbox\.moe\/rapid_paste\.png\)/);

    // saveError should NOT contain "Upload already in progress."
    const saveError = page.locator("#saveError");
    await expect(saveError).toHaveText("");
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

