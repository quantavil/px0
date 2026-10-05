import { expect, test } from '@playwright/test';

test('landing loads preview code only when the preview control is used', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/static/preview.js')) requests.push(request.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(requests).toHaveLength(0);
  await page.locator('#content').fill('# Lazy preview');
  await page.locator('#btnSplit').click();
  await expect(page.locator('#previewPane h1')).toHaveText('Lazy preview');
  expect(requests).toHaveLength(1);
});

test('missing and invalid keys do not load the preview module', async ({ page }) => {
  const response = await page.request.post('/api/paste', {
    data: { content: '__PX0_ENC__:abc', encrypted: true, ttl: '1d' },
  });
  const { id } = await response.json();
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/static/preview.js')) requests.push(request.url());
  });
  await page.goto(`/${id}`);
  await expect(page.locator('.unlock-title')).toHaveText('Decryption Key Required');
  await page.waitForLoadState('networkidle');
  expect(requests).toHaveLength(0);
  await page.locator('#manualKeyInput').fill('invalid');
  await page.locator('#btnDecryptAction').click();
  await expect(page.locator('.unlock-title')).toHaveText('Decryption Failed');
  await page.waitForLoadState('networkidle');
  expect(requests).toHaveLength(0);
});

test('a failed preview download displays a bounded excerpt and retains full download', async ({ page }) => {
  const text = '<script>unsafe()</script>\n' + 'x'.repeat(100000);
  await page.goto('/');
  await page.locator('#content').fill(text);
  await page.locator('label:has(#e2eeToggle)').click();
  await expect(page.locator('#e2eeToggle')).toBeChecked();
  await page.locator('#saveBtn').click();
  await expect(page.locator('#pxPasteUrl')).toHaveValue(/#/);
  const url = await page.locator('#pxPasteUrl').inputValue();
  await page.route('**/static/preview.js', route => route.abort());
  await page.goto(url);
  await expect(page.locator('#output .large-paste-note')).toContainText('Large paste');
  await expect(page.locator('#output pre code')).toHaveText(text.slice(0, 20000));
  await expect(page.locator('#output script')).toHaveCount(0);
  await expect(page.locator('#copyContentBtn')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(Buffer.from(part));
  expect(Buffer.concat(parts).toString('utf8')).toBe(text);
});
