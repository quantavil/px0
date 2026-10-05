import { devices, expect, test } from '@playwright/test';

test('landing has one named main landmark containing the editor', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main', { name: 'Write a paste' });
  await expect(main).toHaveCount(1);
  await expect(main.getByRole('textbox', { name: 'Paste content' })).toBeVisible();
});

for (const action of ['ControlOrMeta+b', 'Enter']) {
  test(`native Undo restores content after ${action}`, async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('#content');
    await editor.pressSequentially('- first');
    await editor.press(action);
    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveValue('- first');
  });
}

test('New Paste starts empty and leaves the previous draft recoverable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#content').fill('keep this draft');
  await page.locator('header .btn-action').click();
  await expect(page.locator('#content')).toHaveValue('');
  await page.getByRole('button', { name: 'Restore previous draft' }).click();
  await expect(page.locator('#content')).toHaveValue('keep this draft');
});

test('large preview has a bounded excerpt while retaining the full editor text', async ({ page }) => {
  await page.goto('/');
  const text = '## Heading\n\n```js\nconst x = 42;\n```\n\n'.repeat(30000);
  await page.locator('#content').evaluate((el: HTMLTextAreaElement, text) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  await page.locator('#btnSplit').click();
  await expect(page.locator('#previewPane')).toContainText('Large paste');
  expect(await page.locator('#previewPane').locator('*').count()).toBeLessThan(100);
  await expect(page.locator('#content')).toHaveValue(text);
});

test('pending save times out and leaves the draft available', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.route('**/api/paste', () => {});
  await page.locator('#content').fill('unsaved on timeout');
  await page.locator('#saveBtn').click();
  await page.clock.fastForward(31000);
  await expect(page.locator('#saveBtn')).toBeEnabled();
  await expect(page.locator('#saveError')).toContainText('timed out');
  await expect(page.locator('#content')).toHaveValue('unsaved on timeout');
});

test('phone controls have comfortable touch areas and balanced preview panes', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3005/');
  for (const selector of ['#btnSplit', '.seg-option', '#ttlTrigger']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#btnSplit').click();
  const editor = await page.locator('#content').boundingBox();
  const preview = await page.locator('#previewPane').boundingBox();
  expect(Math.abs(editor!.height - preview!.height)).toBeLessThan(4);
  await context.close();
});

test('landing meets automated WCAG accessibility checks', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});

test('a literal encryption prefix still downloads as ordinary text', async ({ page }) => {
  await page.goto('/');
  const text = '__PX0_ENC__:ordinary literal text';
  await page.locator('#content').fill(text);
  await page.locator('#saveBtn').click();
  const url = await page.locator('#pxPasteUrl').inputValue();
  await page.goto(url);
  await expect(page.locator('#output')).toContainText('ordinary literal text');
  const pending = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(Buffer.from(part));
  expect(Buffer.concat(parts).toString('utf8')).toBe(text);
});

test('local draft opt-out survives reload and removes saved drafts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#content').fill('local private draft');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('px0_draft'))).toBe('local private draft');
  await page.locator('.privacy-help summary').click();
  await page.getByRole('checkbox', { name: 'Save drafts on this device' }).uncheck();
  await page.locator('#content').fill('no persistence');
  await page.reload();
  await expect(page.locator('#content')).toHaveValue('');
  await page.locator('.privacy-help summary').click();
  await expect(page.getByRole('checkbox', { name: 'Save drafts on this device' })).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('px0_draft'))).toBeNull();
});

test('viewer, unlock, burn warning, missing paste and success dialog pass accessibility checks', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.goto('/');
  for (const data of [
    { content: '# Accessible paste\n\nRead this text.', ttl: '1d' },
    { content: '__PX0_ENC__:abc', encrypted: true, ttl: '1d' },
    { content: 'one-time accessible text', ttl: 'burn' },
  ]) {
    const response = await page.request.post('/api/paste', { data });
    const { id } = await response.json();
    await page.goto(`/${id}`);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  }
  await page.goto('/missingAccessibilityFixture');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/');
  await page.locator('#content').fill('accessible success');
  await page.locator('#saveBtn').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});
