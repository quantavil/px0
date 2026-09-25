import { test, expect } from '@playwright/test';

test.describe('px0 E2E Browser Test Suite', () => {

  test('1. Landing Page UI elements and line/character counter', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/px0 - Minimalist Markdown Pastebin/);
    await expect(page.locator('.brand')).toContainText('px0');
    // Plaintext is the default mode; E2EE is opt-in via the footer seg.
    await expect(page.locator('#modePlaintext')).toBeChecked();
    await expect(page.locator('#toggleLabel')).toContainText('E2EE');
    await expect(page.locator('#charCount')).toContainText('0 lines · 0 B');

    const textarea = page.locator('#content');
    await textarea.fill('Line 1\nLine 2\nLine 3');

    await expect(page.locator('#charCount')).toContainText('3 lines');

    // Test Tab key handling in textarea
    await textarea.focus();
    await page.keyboard.press('Tab');
    const value = await textarea.inputValue();
    expect(value).toContain('  ');
  });

  test('2. Plaintext Paste submission, sugar-high lexical code highlighting and client/server rendering', async ({ page }) => {
    await page.goto('/');

    // Plaintext is the default — no toggle needed.
    await expect(page.locator('#modePlaintext')).toBeChecked();

    const markdownInput = '# E2E Test Title\n\nThis is **bold** text, `inline code`, and:\n\n```js\nconst greeting = "hello";\n```';
    await page.locator('#content').fill(markdownInput);

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    const urlStr = await page.locator('#pxPasteUrl').inputValue();
    await page.goto(urlStr);
    expect(urlStr).not.toContain('#');

    // Check rendered content
    await expect(page.locator('.badge-public')).toContainText('Plaintext');
    await expect(page.locator('#output h1')).toHaveText('E2E Test Title');
    await expect(page.locator('#output strong')).toHaveText('bold');

    // Verify sugar-high lexical token elements
    await expect(page.locator('#output .sh__token--keyword').first()).toHaveText('const');

    // Test Copy Content button
    await page.waitForLoadState('domcontentloaded');
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

    // Opt into E2EE via the footer segmented control
    await page.locator('label:has(#e2eeToggle)').click();
    await expect(page.locator('#e2eeToggle')).toBeChecked();

    const secretText = '# Top Secret E2EE Note\n\nPassword: `super-secret-123`';
    await page.locator('#content').fill(secretText);

    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    const fullUrlWithHash = await page.locator('#pxPasteUrl').inputValue();
    
    // Open in a new page to test viewer lifecycle
    const viewPage = await context.newPage();
    await viewPage.goto(fullUrlWithHash);
    expect(fullUrlWithHash).toContain('#');

    // Wait for client Web Crypto decryption to complete and inject h1 element
    await viewPage.waitForSelector('#output h1');

    // Verify browser decrypted payload and rendered formatted markdown
    await expect(viewPage.locator('.badge-encrypted')).toContainText('E2EE');
    await expect(viewPage.locator('#output h1')).toHaveText('Top Secret E2EE Note');
    await expect(viewPage.locator('#output code')).toHaveText('super-secret-123');

    // /raw only ever sees ciphertext, so the button must not be offered here —
    // it used to appear the moment decryption revealed the action bar, handing
    // the reader `__PX0_ENC__:…`. Download replaces it and works on the
    // decrypted text.
    await expect(viewPage.locator('#rawBtn')).toHaveCount(0);
    const downloadPromise = viewPage.waitForEvent('download');
    await viewPage.locator('#downloadBtn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^[A-Za-z0-9\-_]{8}\.md$/);

    // Open URL without hash fragment -> verify interactive decryption key missing card
    const urlWithoutHash = fullUrlWithHash.split('#')[0];
    const page2 = await context.newPage();
    await page2.goto(urlWithoutHash);
    await expect(page2.locator('.unlock-title')).toHaveText('Decryption Key Required');
    await expect(page2.locator('#manualKeyInput')).toBeVisible();

    // Open URL with invalid hash fragment -> verify invalid key error message
    await page2.goto(urlWithoutHash + '#invalidKey123');
    await expect(page2.locator('.unlock-title')).toHaveText('Decryption Failed');
    await expect(page2.locator('#keyErr')).toContainText('Error: Decryption key is invalid or corrupted.');
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

    // Plaintext is the default mode — nothing to toggle.

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
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    const shareUrl = await page.locator('#pxPasteUrl').inputValue();
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

    // Select "Burn After Read" from custom dropdown (plaintext is default)
    await page.locator('#ttlTrigger').click();
    await page.locator('.ttl-option[data-ttl="burn"]').click();

    const sensitiveNote = '# Top Secret Burn Note\n\nSelf destructing after 1 view!';
    await page.locator('#content').fill(sensitiveNote);

    // Creator is NOT redirected (that would burn it). A centered modal card appears instead.
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    // Modal card displays burn styling and warning
    await expect(page.locator('#pxModalCard')).toHaveClass(/is-burn/);
    await expect(page.locator('.px-modal-burn-warning')).toBeVisible();

    const pasteUrl = await page.locator('#pxPasteUrl').inputValue();

    // First actual view -> Displays interstitial, click Reveal to view & burn
    await page.goto(pasteUrl);
    await expect(page.locator('.not-found-title')).toHaveText('Burn-After-Read Paste');
    await page.locator('text=Reveal & Self-Destruct').click();

    await expect(page.locator('.badge-burn-once')).toContainText('Burned');
    await expect(page.locator('#output h1')).toHaveText('Top Secret Burn Note');

    // The paste is already deleted, so View Raw and Delete would all
    // be dead controls. Only the content still in the page is real.
    await expect(page.locator('#rawBtn')).toHaveCount(0);
    await expect(page.locator('#deleteBtn')).toHaveCount(0);
    await expect(page.locator('#copyContentBtn')).toBeVisible();
    await expect(page.locator('#downloadBtn')).toBeVisible();

    // Second view -> Paste should be destroyed and return 404!
    const secondResponse = await page.goto(pasteUrl);
    expect(secondResponse?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Paste Unavailable');
  });

  test('8. Mode seg switches between Plaintext and E2EE, E2EE save carries a key', async ({ page }) => {
    await page.goto('/');

    // Default is plaintext
    await expect(page.locator('#modePlaintext')).toBeChecked();

    // Switch to E2EE
    await page.locator('label:has(#e2eeToggle)').click();
    await expect(page.locator('#e2eeToggle')).toBeChecked();

    await page.locator('#content').fill('# Sealed Note\n\nEncrypted in the browser.');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    const e2eeUrl = await page.locator('#pxPasteUrl').inputValue();
    expect(e2eeUrl).toContain('#');
    await expect(page.locator('.px-modal-badges .badge-encrypted')).toContainText('E2EE');

    // Switch back to plaintext — next save carries no key
    await page.locator('#pxModalDoneBtn').click();
    await page.locator('label:has(#modePlaintext)').click();
    await expect(page.locator('#modePlaintext')).toBeChecked();
    await page.locator('#content').fill('# Open Note\n\nStored as-is.');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#pxModalOverlay')).toBeVisible();
    const plainUrl = await page.locator('#pxPasteUrl').inputValue();
    expect(plainUrl).not.toContain('#');
    await expect(page.locator('.px-modal-badges .badge-public')).toContainText('Plaintext');
  });

  test('9. Footer split-view button toggles live side-by-side preview', async ({ page }) => {
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

  test('10. Comprehensive Visual & Aesthetic Consistency Audit across landing, view, unlock card, and 404', async ({ page }) => {
    // A. Landing Page Visual Tokens — floating glass pill header
    await page.goto('/');
    await expect(page.locator('header')).toHaveCSS('border-radius', '999px');
    await expect(page.locator('.brand tspan').first()).toHaveCSS('font-family', /monospace/);

    // B. View Page Visual Tokens
    const pasteRes = await page.request.post('/api/paste', {
      data: { content: '# Visual Consistency Paste\n\nTesting typography & header.' },
    });
    const { id } = (await pasteRes.json()) as { id: string };
    await page.goto(`/${id}`);
    await expect(page.locator('.badge-public')).toContainText('Plaintext');
    // A badge's text, fill and border must all come from one colour token.
    await expect(page.locator('.badge-public')).toHaveCSS('color', 'rgb(88, 166, 255)');
    await expect(page.locator('.badge-public')).toHaveCSS('border-color', 'rgba(88, 166, 255, 0.35)');
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

    // C. E2EE Unlock Card Visual Tokens
    const encRes = await page.request.post('/api/paste', {
      data: { content: '__PX0_ENC__:SGVsbG8gV29ybGQ=' },
    });
    const { id: encId } = (await encRes.json()) as { id: string };
    await page.goto(`/${encId}`);
    await expect(page.locator('.unlock-title')).toHaveText('Decryption Key Required');
    await expect(page.locator('.btn-unlock-submit')).toBeVisible();

    // D. 404 Minimal Page Visual Tokens
    const notFoundRes = await page.goto('/invalid_page_9999');
    expect(notFoundRes?.status()).toBe(404);
    await expect(page.locator('.status-code')).toHaveText('404');
    // The pseudo-badge is gone — the title and subtitle already say this.
    await expect(page.locator('.badge-ttl')).toHaveCount(0);
    await expect(page.locator('.not-found-title')).toHaveText('Paste Unavailable');
    await expect(page.locator('header .btn-action').first()).toBeVisible();
  });

  test('11. TTL listbox is keyboard operable and marks the default option', async ({ page }) => {
    await page.goto('/');

    // The default TTL (1d) only carried aria-selected server-side, so the
    // checkmark and amber highlight were missing until the user picked something.
    await page.locator('#ttlTrigger').click();
    await expect(page.locator('.ttl-option[data-ttl="1d"]')).toHaveClass(/selected/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ttlMenu')).toBeHidden();

    // Options are <li>s: without a roving tabindex the whole control was mouse-only.
    await page.locator('#ttlTrigger').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#ttlMenu')).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');

    await expect(page.locator('#ttlInput')).toHaveValue('1h');
    await expect(page.locator('#ttlValue')).toHaveText('1 Hour');
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

  test('13. Mode seg reflects the saved paste in the success modal', async ({ page }) => {
    await page.goto('/');

    // Plaintext default save → plaintext badge in modal
    await page.locator('#content').fill('# Open memo');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.px-modal-badges .badge-public')).toContainText('Plaintext');
    await page.locator('#pxModalDoneBtn').click();

    // E2EE save → encrypted badge in modal
    await page.locator('label:has(#e2eeToggle)').click();
    await page.locator('#content').fill('# Sealed memo');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.px-modal-badges .badge-encrypted')).toContainText('E2EE');
  });

  test('14. Draft autosave restores un-submitted text and allows discarding', async ({ page }) => {
    await page.goto('/');

    const textarea = page.locator('#content');
    await textarea.fill('My important unsaved draft note');
    // Wait for debounced draft save
    await page.waitForTimeout(500);

    // Reload page -> Draft should be restored with badge
    await page.reload();
    await expect(textarea).toHaveValue('My important unsaved draft note');
    await expect(page.locator('.draft-badge')).toContainText('Draft restored');

    // Click discard button -> Draft cleared
    await page.locator('#discardDraftBtn').click();
    await expect(textarea).toHaveValue('');
    await expect(page.locator('.draft-badge')).toHaveCount(0);

    // Reload again -> Should be empty
    await page.reload();
    await expect(textarea).toHaveValue('');
  });

  test('15. Textarea markdown keyboard ergonomics (Ctrl+B bold wrap, Enter list continuation)', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('#content');

    // 1. Test Ctrl+B wrap
    await textarea.fill('hello world');
    await textarea.focus();
    // Select "world"
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(6, 11);
    });
    await page.keyboard.press('ControlOrMeta+b');
    expect(await textarea.inputValue()).toBe('hello **world**');

    // 2. Test unordered list continuation on Enter
    await textarea.fill('- First item');
    await textarea.focus();
    await page.keyboard.press('Enter');
    expect(await textarea.inputValue()).toBe('- First item\n- ');

    // 3. Test exiting list on empty Enter
    await page.keyboard.press('Enter');
    expect(await textarea.inputValue()).toBe('- First item\n');
  });

  test('16. Obsidian is the pinned theme with no toggle', async ({ page }) => {
    await page.goto('/');

    // Single-theme build: no toggle control, obsidian pinned statically.
    await expect(page.locator('#btnThemeToggle')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'obsidian');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'obsidian');
  });

});
