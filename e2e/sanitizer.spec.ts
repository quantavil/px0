import { test, expect } from '@playwright/test';

// Real-Chromium coverage for the DOMPurify browser path
// (unit tests can only run the regex fallback — no window in Bun).
test.describe('sanitizer browser path', () => {
  test('tab-in-scheme, event handlers, and data: policy in live preview', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#btnSplit').click();
    const preview = page.locator('#previewPane');
    await expect(preview).toBeVisible();

    await page.locator('#content').fill(
      '<a href="java\tscript:alert(1)">click</a>\n\n<img src="x" onerror="alert(1)">',
    );
    await expect
      .poll(async () => preview.innerHTML())
      .toContain('<a>click</a>');
    let html = await preview.innerHTML();
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('java\tscript:');

    await page.locator('#content').fill('![ok](data:image/png;base64,AAA)');
    await expect
      .poll(async () => preview.innerHTML())
      .toContain('data:image/png');

    await page.locator('#content').fill('![bad](data:text/html,x)');
    await expect
      .poll(async () => preview.innerHTML())
      .not.toContain('data:text/html');
  });
});
