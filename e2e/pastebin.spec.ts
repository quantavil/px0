import { test, expect } from '@playwright/test';

test.describe('px0 E2E Browser Test Suite', () => {

  test('1. Landing Page UI elements and line/character counter', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/px0 - Minimalist Markdown Pastebin/);
    await expect(page.locator('.brand')).toContainText('px0');
    await expect(page.locator('#toggleLabel')).toContainText('E2EE');
    await expect(page.locator('#charCount')).toContainText('›_ 0 lines (0 chars)');

    const textarea = page.locator('#content');
    await textarea.fill('Line 1\nLine 2\nLine 3');

    await expect(page.locator('#charCount')).toContainText('›_ 3 lines');

    // Test Tab key handling in textarea
    await textarea.focus();
    await page.keyboard.press('Tab');
    const value = await textarea.inputValue();
    expect(value).toContain('  ');
  });

  test('2. Plaintext Paste submission, sugar-high lexical code highlighting and client/server rendering', async ({ page }) => {
    await page.goto('/');

    // Toggle off E2EE -> Plaintext mode by clicking label
    await page.locator('.toggle-e2ee').click();
    await expect(page.locator('#toggleLabel')).toContainText('Plaintext');

    const markdownInput = '# E2E Test Title\n\nThis is **bold** text, `inline code`, and:\n\n```js\nconst greeting = "hello";\n```';
    await page.locator('#content').fill(markdownInput);

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#headerShareBanner')).toBeVisible();
    const urlStr = await page.locator('#shareUrl').inputValue();
    await page.goto(urlStr);
    expect(urlStr).not.toContain('#');

    // Check rendered content
    await expect(page.locator('.badge-public')).toContainText('Plaintext');
    await expect(page.locator('#output h1')).toHaveText('E2E Test Title');
    await expect(page.locator('#output strong')).toHaveText('bold');

    // Verify sugar-high lexical token elements
    await expect(page.locator('#output .sh__token--keyword').first()).toHaveText('const');

    // Test Copy Link button
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#copyBtn').click();
    await expect(page.locator('#copyBtn')).toHaveClass(/copied/);

    // Test Copy Content button
    await page.locator('#copyContentBtn').click();
    await expect(page.locator('#copyContentBtn')).toHaveClass(/copied/);

    // Test Raw route directly via API request
    const pasteId = urlStr.split('/').pop();
    const rawResponse = await page.request.get(`/raw/${pasteId}`);
    expect(rawResponse.status()).toBe(200);
    const rawText = await rawResponse.text();
    expect(rawText).toBe(markdownInput);
  });

  test('3. Zero-Knowledge E2EE Encrypted Paste creation, browser decryption & key missing error', async ({ page, context }) => {
    await page.goto('/');

    // Ensure E2EE is checked
    await expect(page.locator('#toggleLabel')).toContainText('E2EE');

    const secretText = '# Top Secret E2EE Note\n\nPassword: `super-secret-123`';
    await page.locator('#content').fill(secretText);

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#headerShareBanner')).toBeVisible();
    const fullUrlWithHash = await page.locator('#shareUrl').inputValue();
    await page.goto(fullUrlWithHash);
    expect(fullUrlWithHash).toContain('#');

    // Wait for client Web Crypto decryption to complete and inject h1 element
    await page.waitForSelector('#output h1');

    // Verify browser decrypted payload and rendered formatted markdown
    await expect(page.locator('.badge-encrypted')).toContainText('E2EE');
    await expect(page.locator('#output h1')).toHaveText('Top Secret E2EE Note');
    await expect(page.locator('#output code')).toHaveText('super-secret-123');

    // /raw only ever sees ciphertext, so the button must not be offered here —
    // it used to appear the moment decryption revealed the action bar, handing
    // the reader `__PX0_ENC__:…`. Download replaces it and works on the
    // decrypted text.
    await expect(page.locator('#rawBtn')).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^[A-Za-z0-9\-_]{8}\.md$/);

    // Open URL without hash fragment -> verify decryption missing key error message
    const urlWithoutHash = fullUrlWithHash.split('#')[0];
    const page2 = await context.newPage();
    await page2.goto(urlWithoutHash);
    await expect(page2.locator('#output')).toContainText('Error: Decryption key missing from URL hash fragment!');

    // Open URL with invalid hash fragment -> verify invalid key error message
    await page2.goto(urlWithoutHash + '#invalidKey123');
    await expect(page2.locator('#output')).toContainText('Error: Invalid decryption key or corrupted payload.');
  });

  test('4. 404 Expired or missing paste page', async ({ page }) => {
    const response = await page.goto('/invalid_paste_id_999');
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Paste Unavailable');
  });

  test('5. Security headers verification', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() || {};
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  test('6. Multi-language syntax highlighting (JS, Python, Rust, HTML, CSS, Go)', async ({ page }) => {
    await page.goto('/');

    // Toggle off E2EE -> Plaintext mode
    await page.locator('.toggle-e2ee').click();

    const multiLangInput = `
# Multi-Language Syntax Highlight Test

\`\`\`js
const total = 100;
import { useState } from 'react';
\`\`\`

\`\`\`python
def calculate_sum(a, b):
    # Calculate sum
    return a + b
\`\`\`

\`\`\`rust
fn main() {
    let msg = "Hello Rust";
    println!("{}", msg);
}
\`\`\`

\`\`\`html
<div class="card">
  <h1>Title</h1>
</div>
\`\`\`

\`\`\`css
body {
  background-color: #090b10;
  color: #e6edf3;
}
\`\`\`

\`\`\`go
package main

import "fmt"

func main() {
    fmt.Println("Hello Go")
}
\`\`\`
`.trim();

    await page.locator('#content').fill(multiLangInput);

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#headerShareBanner')).toBeVisible();
    const shareUrl = await page.locator('#shareUrl').inputValue();
    await page.goto(shareUrl);

    await expect(page.locator('#output h1')).toHaveText('Multi-Language Syntax Highlight Test');

    // Verify code block count = 6
    const codeBlocks = page.locator('#output pre code');
    await expect(codeBlocks).toHaveCount(6);

    // Verify sugar-high token highlighted keywords
    const keywords = page.locator('#output .sh__token--keyword');
    const keywordTexts = await keywords.allTextContents();
    expect(keywordTexts).toContain('const');
    expect(keywordTexts).toContain('import');
    expect(keywordTexts).toContain('from');
    expect(keywordTexts).toContain('return');
    expect(keywordTexts).toContain('let');

    // Verify sugar-high string tokens
    const strings = page.locator('#output .sh__token--string');
    const stringTexts = await strings.allTextContents();
    expect(stringTexts.some(s => s.includes('react') || s.includes('Hello Rust') || s.includes('Hello Go'))).toBe(true);

    // Verify sugar-high sign tokens (=, ;, {})
    const signs = page.locator('#output .sh__token--sign');
    expect(await signs.count()).toBeGreaterThan(0);
  });

  test('7. Burn-After-Read paste creation and self-destruction in browser', async ({ page }) => {
    await page.goto('/');

    // Select "Burn After Read" from custom dropdown
    await page.locator('#ttlTrigger').click();
    await page.locator('.ttl-option[data-ttl="burn"]').click();
    await page.locator('.toggle-e2ee').click(); // Plaintext mode

    const sensitiveNote = '# Top Secret Burn Note\n\nSelf destructing after 1 view!';
    await page.locator('#content').fill(sensitiveNote);

    // Creator is NOT redirected (that would burn it). A share-link overlay appears instead.
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#headerShareBanner')).toBeVisible();
    await expect(page.locator('.share-banner-badge')).toContainText('Burn paste ready');
    // The banner is a document-flow row, never a fixed full-screen overlay.
    await expect(page.locator('#headerShareBanner')).toHaveCSS('position', 'static');
    await expect(page.locator('#content')).toBeVisible();

    const pasteUrl = await page.locator('#shareUrl').inputValue();

    // First actual view -> Displays paste content and Burned After Read badge
    await page.goto(pasteUrl);
    await expect(page.locator('.badge-burn-once')).toContainText('Burned');
    await expect(page.locator('#output h1')).toHaveText('Top Secret Burn Note');

    // The paste is already deleted, so Copy Link, View Raw and Delete would all
    // be dead controls. Only the content still in the page is real.
    await expect(page.locator('#copyBtn')).toHaveCount(0);
    await expect(page.locator('#rawBtn')).toHaveCount(0);
    await expect(page.locator('#deleteBtn')).toHaveCount(0);
    await expect(page.locator('#copyContentBtn')).toBeVisible();
    await expect(page.locator('#downloadBtn')).toBeVisible();

    // Second view -> Paste should be destroyed and return 404!
    const secondResponse = await page.goto(pasteUrl);
    expect(secondResponse?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Paste Unavailable');
  });

  test('8. Password Protected paste creation via Inline Lock Bar, 8-digit auto password & unlocking', async ({ page }) => {
    await page.goto('/');

    const secretVaultText = '# Secret Vault\n\nThis note is protected by PBKDF2 + AES-GCM!';
    await page.locator('#content').fill(secretVaultText);

    // Toggle Inline Password Bar via Lock Icon Button
    await page.locator('#btnPassModal').click();
    await expect(page.locator('#inlinePassBar')).toHaveClass(/visible/);

    // Verify auto-generated 8-character password
    const autoPass = await page.locator('#inlinePassInput').inputValue();
    expect(autoPass).toHaveLength(8);

    // Edit password to custom value
    await page.locator('#inlinePassInput').fill('my-vault-pass-123');

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#headerShareBanner')).toBeVisible();
    // Only this string can decrypt the paste — if the banner shows just the URL,
    // copying it and closing the tab loses the paste for good.
    await expect(page.locator('#sharePass')).toHaveValue('my-vault-pass-123');
    const passUrl = await page.locator('#shareUrl').inputValue();
    await page.goto(passUrl);

    await expect(page.locator('.badge-public')).toHaveCount(0);
    // Password badge is icon-only (no long "Password Protected" text)
    await expect(page.locator('.footer-bar .badge-encrypted')).toBeVisible();
    await expect(page.locator('.footer-bar .badge-encrypted')).not.toContainText('Password Protected');
    await expect(page.locator('#output')).toContainText('Password Protected Paste');

    // Verify paste actions (Copy Link, Copy, Raw) are hidden while locked
    await expect(page.locator('#pasteActions')).toBeHidden();

    // Test incorrect password error
    await page.locator('#unlockPass').fill('wrongpassword');
    await page.locator('#btnUnlockAction').click();
    await expect(page.locator('#passErr')).toContainText('Incorrect password');

    // Test correct password unlock
    await page.locator('#unlockPass').fill('my-vault-pass-123');
    await page.locator('#btnUnlockAction').click();

    await expect(page.locator('#output h1')).toHaveText('Secret Vault');
    await expect(page.locator('#output p')).toContainText('This note is protected by PBKDF2 + AES-GCM!');

    // Verify paste actions (Copy Link, Copy, Raw) reveal after successful unlock
    await expect(page.locator('#pasteActions')).toBeVisible();
  });

  test('9. Top-right SVG split view icon toggles live side-by-side preview', async ({ page }) => {
    await page.goto('/');

    const markdownInput = '# Live Split Preview Title\n\nThis is **bold** text live preview.';
    await page.locator('#content').fill(markdownInput);

    // Click single SVG split view icon button
    await page.locator('#btnSplit').click();

    // Verify split mode is active: both textarea and preview pane are visible
    await expect(page.locator('#editorContainer')).toHaveClass(/split-active/);
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#previewPane')).toBeVisible();
    await expect(page.locator('#previewPane h1')).toHaveText('Live Split Preview Title');
    await expect(page.locator('#previewPane strong')).toHaveText('bold');

    // Test live typing update in split mode with long unbroken string (50/50 split locking)
    await page.locator('#content').fill('dasdasdkaskdkaskdkasdnaskddddddddddddddddddddddddddddddddddddddddddddddddddddddsmaksdaksaddddddddddddddddkmdaskdkaskdaksdkaskdaskdmkasdk');
    const textareaBox = await page.locator('#content').boundingBox();
    const previewBox = await page.locator('#previewPane').boundingBox();
    expect(textareaBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    if (textareaBox && previewBox) {
      // Both columns must take equal 50% width (within 5px threshold)
      expect(Math.abs(textareaBox.width - previewBox.width)).toBeLessThan(5);
    }

    // Toggle split mode off
    await page.locator('#btnSplit').click();
    await expect(page.locator('#editorContainer')).not.toHaveClass(/split-active/);
    await expect(page.locator('#previewPane')).toBeHidden();
  });

  test('10. Comprehensive Visual & Aesthetic Consistency Audit across landing, view, password modal, and 404', async ({ page }) => {
    // A. Landing Page Visual Tokens
    await page.goto('/');
    await expect(page.locator('header')).toHaveCSS('height', '52px');
    await expect(page.locator('.brand tspan').first()).toHaveCSS('font-family', /monospace/);

    // B. View Page Visual Tokens
    const pasteRes = await page.request.post('/api/paste', {
      data: { content: '# Visual Consistency Paste\n\nTesting typography & header.' },
    });
    const { id } = (await pasteRes.json()) as { id: string };
    await page.goto(`/${id}`);
    await expect(page.locator('header')).toHaveCSS('height', '52px');
    await expect(page.locator('.badge-public')).toContainText('Plaintext');
    // A badge's text, fill and border must all come from one colour token.
    // This previously rendered amber text on blue chrome.
    await expect(page.locator('.badge-public')).toHaveCSS('color', 'rgb(88, 166, 255)');
    await expect(page.locator('.badge-public')).toHaveCSS('border-color', 'rgba(88, 166, 255, 0.3)');
    await expect(page.locator('.markdown-body h1')).toHaveText('Visual Consistency Paste');

    // Tables must actually render as tables — GFM tables had no styling at all,
    // and the client-side parser could not produce them for E2EE pastes.
    const tableRes = await page.request.post('/api/paste', {
      data: { content: '| a | b |\n|---|---|\n| 1 | 2 |' },
    });
    const { id: tableId } = (await tableRes.json()) as { id: string };
    await page.goto(`/${tableId}`);
    await expect(page.locator('.markdown-body th').first()).toHaveText('a');
    await expect(page.locator('.markdown-body td').first()).toHaveCSS(
      'border-top-style',
      'solid',
    );

    // C. Password Protection View Modal Visual Tokens
    const passRes = await page.request.post('/api/paste', {
      data: { content: '__PX0_PASS__:c2FsdDEyMzQ1Njc4OTAxMg==:aXZiYXNlNjR1cmwxMg==:Y2lwaGVydGV4dGJhc2U2NHVybA==' },
    });
    const { id: passId } = (await passRes.json()) as { id: string };
    await page.goto(`/${passId}`);
    await expect(page.locator('.unlock-title')).toHaveText('Password Protected Paste');
    await expect(page.locator('.btn-unlock-submit')).toBeVisible();

    // D. 404 Minimal Page Visual Tokens
    const notFoundRes = await page.goto('/invalid_page_9999');
    expect(notFoundRes?.status()).toBe(404);
    await expect(page.locator('.status-code')).toHaveText('404');
    await expect(page.locator('.badge-ttl')).toContainText('›_ paste_expired_or_absent');
    await expect(page.locator('header .btn-action')).toBeVisible();
  });

  test('11. TTL listbox is keyboard operable and marks the default option', async ({ page }) => {
    await page.goto('/');

    // The default TTL only carried aria-selected server-side, so the checkmark
    // and amber highlight were missing until the user picked something.
    await page.locator('#ttlTrigger').click();
    await expect(page.locator('.ttl-option[data-ttl="30d"]')).toHaveClass(/selected/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ttlMenu')).toBeHidden();

    // Options are <li>s: without a roving tabindex the whole control was mouse-only.
    await page.locator('#ttlTrigger').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#ttlMenu')).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');

    await expect(page.locator('#ttlInput')).toHaveValue('15d');
    await expect(page.locator('#ttlValue')).toHaveText('15 Days');
    await expect(page.locator('#ttlTrigger')).toBeFocused();
  });

  test('12. Empty save shows the inline error, not the native validation bubble', async ({ page }) => {
    await page.goto('/');

    // `required` on the textarea pre-empted the submit handler entirely, so
    // #saveError was unreachable dead code.
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#saveError')).toContainText('editor is empty');
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('13. Plaintext choice survives a password on/off cycle', async ({ page }) => {
    await page.goto('/');

    await page.locator('.toggle-e2ee').click();
    await expect(page.locator('#toggleLabel')).toContainText('Plaintext');

    await page.locator('#btnPassModal').click();
    await expect(page.locator('#toggleLabel')).toContainText('Password');

    // Clearing the password used to silently force E2EE back on.
    await page.locator('#btnPassModal').click();
    await expect(page.locator('#toggleLabel')).toContainText('Plaintext');
  });

});
