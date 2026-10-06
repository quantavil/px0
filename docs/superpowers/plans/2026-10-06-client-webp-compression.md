# Client-Side Inline WebP Image Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the third-party Catbox image upload proxy with a zero-dependency, client-side native Canvas WebP compression engine that embeds compressed images as E2EE data URIs in markdown, eliminating external backend dependencies and WAF blocks.

**Architecture:** The client compresses dropped, pasted, or picked images locally using native `createImageBitmap` and `HTMLCanvasElement.toDataURL("image/webp", 0.65)` (bounded to max 1280px). Compressed images are inserted as reference-style markdown links (`![alt][fig-N]`) with data URIs appended to the bottom. The backend `/api/image` endpoint is removed and CSP `img-src` is restricted strictly to `'self' data:`.

**Tech Stack:** TypeScript, Browser Native Canvas WebP API, Bun, Hono, Playwright.

---

## Global Constraints
- Zero external NPM dependencies added to `package.json`.
- Strict Content Security Policy: `img-src 'self' data:;` (no third-party domains).
- Max dimension bounded to 1280px with proportional aspect-ratio scaling.
- Default compression quality: 0.65 (tight lossy compression).
- Reference-style markdown insertion to keep editor typing lightweight and responsive.

## Review Focus
1. Safari / Firefox `createImageBitmap` orientation handling without memory leaks (`bmp.close()`).
2. Very large files (>10MB) failing gracefully with a helpful UI error message.
3. Rapid multiple file drops/pastes sequentially formatting unique reference keys (`[fig-1]`, `[fig-2]`).
4. Plaintext paste operations continuing to paste raw text without triggering image compression.
5. All 97 existing tests and new image tests passing cleanly.

---

### Task 1: Implement Native Client-Side WebP Compression Helper

**Files:**
- Create: `src/client/image-compress.ts`
- Test: `test/client-image-compress.test.ts`

**Interfaces:**
- Produces: `compressImageToWebP(file: File, maxDim?: number, quality?: number): Promise<string>` returning `data:image/webp;base64,...`

- [x] **Step 1: Write unit test for image compression logic**
- [x] **Step 2: Implement `compressImageToWebP` in `src/client/image-compress.ts`**
  - Use `createImageBitmap(file, { imageOrientation: "from-image" })`.
  - Calculate proportional dimensions scaled to `maxDim = 1280`.
  - Draw to temporary canvas and export via `canvas.toDataURL("image/webp", quality)`.
  - Fall back to `"image/jpeg"` if browser lacks WebP encoding support.
  - Call `bmp.close()` to release off-screen bitmap memory.
- [x] **Step 3: Run test to verify it passes**
- [x] **Step 4: Commit**

---

### Task 2: Integrate Inline WebP Compression into Landing Editor

**Files:**
- Modify: `src/client/landing.ts`
- Modify: `public/landing.js` (rebuild via `bun run build:client`)

**Interfaces:**
- Consumes: `compressImageToWebP` from `src/client/image-compress.ts`
- Formats markdown reference links `![cleanName][fig-N]` and appends `[fig-N]: data:image/webp;base64,...` at end of document.

- [x] **Step 1: Replace `fetch("/api/image")` in `handleFilesUpload` with `compressImageToWebP`**
  - Update status message to `"Compressing image…"` and `"Image added"`.
  - Remove network error handling for Catbox timeouts and 502/504 status codes.
- [x] **Step 2: Format reference-style markdown links**
  - Check existing content for highest `fig-N` index to avoid collision.
  - Insert `![cleanName][fig-N]` at selection/cursor.
  - Append `[fig-N]: <data-uri>` at the bottom of the textarea.
- [x] **Step 3: Clean up bottom toolbar info popover and upload note**
  - Removed `#btnUploadInfo`, `#imagePopover`, and corresponding CSS per user request.
- [x] **Step 4: Rebuild client bundle (`bun run build:client`)**
- [x] **Step 5: Commit**

---

### Task 3: Clean Up Backend Server & Tighten CSP

**Files:**
- Modify: `src/index.ts`
- Remove / Refactor: `src/image.ts`
- Modify: `test/image.test.ts`

**Interfaces:**
- Strict CSP: `img-src 'self' data:;`
- Remove `/api/image` endpoint and upstream proxying.

- [x] **Step 1: Remove `/api/image` route and bodyLimit from `src/index.ts`**
- [x] **Step 2: Update CSP header in `src/index.ts` to remove `https://files.catbox.moe`**
- [x] **Step 3: Update `test/image.test.ts` to test client-side compression and sanitized markdown**
- [x] **Step 4: Run `bun test` and `bun run check`**
- [x] **Step 5: Commit**

---

### Task 4: Full Verification, Documentation, and Deployment

**Files:**
- Modify: `README.md`
- Modify: `AGENT.md`

- [x] **Step 1: Run full verification suite (`bun run check`, `bun run lint`, `bun test`, `bun run test:worker`, `bun run test:e2e`)**
- [x] **Step 2: Update `README.md` and `AGENT.md` to document the client-side WebP E2EE compression**
- [ ] **Step 3: Commit and deploy to Cloudflare Workers (`bun run deploy`)**
- [ ] **Step 4: Verify deployed URL `https://px0.iyzi.workers.dev` live in browser**
