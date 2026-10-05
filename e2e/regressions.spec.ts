import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1650, height: 990 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`editor fills available space and scrolls internally at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const editor = page.locator('#content');
    const box = await editor.boundingBox();
    const footer = await page.locator('footer').boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(footer!.y - 30);
    await editor.fill('line\n'.repeat(100));
    const sizes = await editor.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, page: document.documentElement.scrollHeight, viewport: innerHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
    await editor.press('ControlOrMeta+End');
    expect(await editor.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  });
}

test('Tab and Shift+Tab leave the editor without modifying content', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('#content');
  await editor.fill('note');
  await editor.press('Tab');
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue('note');
  await editor.focus();
  await editor.press('Shift+Tab');
  await expect(page.locator('#btnSplit')).toBeFocused();
});

test('list continuation replaces the selected text', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('#content');
  await editor.fill('- first remove');
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(7, 14));
  await editor.press('Enter');
  await expect(editor).toHaveValue('- first\n- ');
});

test('malformed successful response recovers the Save button', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/paste', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'broken' }));
  await page.locator('#content').fill('note');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveError')).toContainText('Invalid server response');
  await expect(page.locator('#saveBtn')).toBeEnabled();
});

test('successful save cancels pending draft writes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#content').fill('saved note');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#pxModalOverlay')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => localStorage.getItem('px0_draft'))).toBeNull();
});

test('reload immediately after typing preserves the draft', async ({ page }) => {
  await page.goto('/');
  await page.locator('#content').fill('last moment edit');
  await page.reload();
  await expect(page.locator('#content')).toHaveValue('last moment edit');
});

test('success modal controls stay reachable on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 320 });
  await page.goto('/');
  await page.locator('#content').fill('note');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#pxModalOverlay')).toBeVisible();
  await page.locator('#pxModalDoneBtn').scrollIntoViewIfNeeded();
  const box = await page.locator('#pxModalDoneBtn').boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(320);
});

test('plaintext mode keeps its accessible name on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('radio', { name: 'Plaintext', exact: true })).toBeChecked();
});

test('success expiry describes the submitted setting, preserving later edits', async ({ page }) => {
  await page.goto('/');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/paste', async route => {
    await gate;
    await route.continue();
  });
  await page.locator('#content').fill('submitted note');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await page.locator('#content').fill('new unsaved edit');
  await page.locator('#ttlTrigger').click();
  await page.locator('[data-ttl="7d"]').click();
  release();
  await expect(page.locator('.px-modal-badges .badge-ttl')).toContainText('1 Day');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('px0_draft'))).toBe('new unsaved edit');
});

test('discard cancels a pending write of restored draft edits', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('px0_draft', 'restored'));
  await page.reload();
  await page.locator('#content').fill('edited restored draft');
  await page.locator('#discardDraftBtn').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => localStorage.getItem('px0_draft'))).toBeNull();
});
