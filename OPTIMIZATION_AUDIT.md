# px0 code, performance and UX audit — 2026-10-05

Status: the confirmed findings below have now been addressed in the implementation described at the end. The numbered findings preserve the pre-fix evidence.

Scope: audited main, source inspection, local Chromium desktop and iPhone-device emulation, focused API probes with controlled KV doubles, current upstream interface guidelines and Cloudflare KV documentation. This is an audit, not an implementation or deployment. No production pastes were created or consumed.

## Assessment

Keep the simple writing surface, full-height editor, system fonts and four runtime libraries. The product does not need a framework rewrite or visual overhaul. Its real weaknesses are large-document rendering, storage guarantees, native editing behavior and discoverability. “Blazing fast” is not supported across the advertised 5MiB range. No field Core Web Vitals or physical-device measurements were available.

## Confirmed findings, ordered by impact

1. **High — burn-after-read is not atomic.** `src/index.ts:461`, `src/index.ts:557`, `src/index.ts:672`, `src/index.ts:695`: each request reads before deleting. Two overlapping reads using a KV double that returned the same existing value both returned 200 with the secret. This proves the handler race, not a measured frequency on production. KV has no atomic read/delete transaction and is eventually consistent. Use a Durable Object as the authority for the consume operation; a local mutex or HTTP no-store cannot solve cross-isolate reads. Immediate global deletion wording also exceeds KV guarantees.

2. **High — large preview blocks the main thread.** `src/client/landing.ts:172`, `src/client/shared.ts:209`: debounce reduces frequency but parsing, highlighting, sanitizing and replacing the entire DOM still run synchronously. Desktop Chromium, unthrottled, repeated heading/paragraph/fenced-code sample: 10KB ~132ms, 100KB ~573ms, 1MB ~4,889ms. The 1MB sample produced 241,936 descendant elements. These are one-run local operation timings, not network benchmarks. Use an explicit large-document preview mode, bounded highlighting/rendering, and move parsing/highlighting to a Web Worker if needed. DOM insertion must also be bounded; a worker alone does not solve the node count. Cancel pending preview timers when the preview closes.

3. **Medium — a valid paste can fail the transport-size check.** `src/index.ts:345`: JSON escaping expands newlines, quotes and backslashes. A 5,241,880-byte newline-rich paste below the 5MiB content limit generated a 7,862,845-byte JSON body and received 413. Give JSON framing a separate bounded wire limit and enforce the decoded content limit; do not simply remove request-body protection.

4. **Medium — literal content changes storage mode.** `src/index.ts:396`, `src/index.ts:502`, `src/index.ts:574`: plaintext beginning `__PX0_BURN__:` shows a burn interstitial even when saved with normal TTL; plaintext beginning `__PX0_ENC__:` becomes an encrypted viewer. Both were reproduced. Store versioned mode/burn metadata separately from content, with a legacy migration path. This is content corruption, not evidence of an encryption bypass.

5. **Medium — formatting/list helpers bypass native Undo.** `src/client/landing.ts:291`, `src/client/landing.ts:324`: replacing textarea.value skips the browser edit history. Ctrl+B followed by Ctrl+Z left `typed original**bold text**` unchanged in Chromium. Introduce an editing transaction that preserves undo, or remove helpers that cannot be undone. Test typed text, selection replacement and list continuation together. Do not add a full editor library solely for these shortcuts.

6. **Medium — mobile CSS defeats intended touch sizing.** `src/styles.ts:229`, `src/styles.ts:652`, `src/styles.ts:705`: later equally/more specific declarations override the coarse-pointer rules. In iPhone-device emulation Preview remained 30×30px and mode labels 72×34px; expiry was 40px high. Put the pointer overrides after the component rules and use ~44px hit areas while retaining small icons. At <=640px, `src/styles.ts:1201` also overrides the balanced split: editor ~231px versus preview ~447px at 390×844. Remove the conflicting !important block; prefer balanced panes or an explicit Write/Preview choice on phones.

7. **Medium — New Paste restores the current unsaved draft.** `src/index.ts:270`, `src/client/landing.ts:253`: the header link reloads / and draft restoration repopulates the same text. Reproduced after waiting for draft autosave. After a successful save, New Paste correctly starts empty. Give the unsaved case an explicit discard/keep choice or a recoverable separate draft so New Paste actually starts a new document.

8. **Medium — upload has no timeout/cancel recovery.** `src/client/landing.ts:502`: a fetch that remains pending keeps Save disabled indefinitely. Network rejection is handled correctly, but a pending connection never reaches that handler. Use AbortController with an explained timeout and preserve the draft. Do not automatically retry creation: the server may have already saved the paste.

9. **Low/medium — unnecessary KV read on every creation.** `src/index.ts:382`, `src/index.ts:386`: the normal no-collision path reads the same candidate twice; the controlled KV probe recorded two reads for one save. Validate TTL first and avoid the duplicate read. Collision checks still do not guarantee atomic uniqueness under concurrency; do not describe this optimization as fixing that separate race.

10. **Low — scripts cannot reuse the browser cache.** `src/index.ts:227`, `src/index.ts:234`: both stable client script routes send no-cache, no-store, must-revalidate. Local bundle sizes: landing 126,467 bytes / 42,694 gzip; viewer 121,751 / 40,907 gzip. Use content-hashed script URLs with immutable caching, or validators with revalidation for stable URLs. Keep private paste responses no-store. Do not add immutable caching to the current unversioned URLs.

## Optional UX direction, not proven bugs

- Keep the quiet editor and avoid reinstating the rejected brown focus stripe. A small keyboard-focus cue in the status strip could improve orientation without decorating the writing surface.
- Explain E2EE as “Encrypted” with short help; the abbreviation and hover-only title are difficult to discover on touch devices.
- Show “Draft saved on this device” versus a localStorage failure. E2EE drafts currently remain plaintext in localStorage; describe that local persistence and offer a per-session opt-out. This does not mean the encryption key is sent to the server.
- Preview and new-document icons would benefit from visible labels where space permits.
- On phones the textarea computes to 15.68px. Consider 16px; actual Safari focus zoom needs physical/WebKit testing before calling it a reproduced defect.
- Copy failures should produce an instruction to select/copy the link manually. Success modal auto-copy is opportunistic and must not imply successful copying when clipboard access fails.

## Dependencies and maintainability

`bun outdated` reported no outdated direct dependencies; `bun audit` reported no vulnerabilities among 135 packages. Keep Hono, marked, DOMPurify and sugar-high. No extra runtime library is required for the first fixes: native Worker, AbortController, CSS and Cloudflare Durable Objects cover them. A richer editor library is justified only if robust undo, code editing, search or document structure becomes core scope.

The worker imports the shared rendering module but cannot run DOMPurify without a DOM; it uses a bespoke regex sanitizer (`src/client/shared.ts:153`). Browser and server policies are therefore not structurally equivalent. This audit did not establish an executable XSS bypass; do not report one. A deliberate raw-HTML policy and parser-based server sanitization deserve a separate security review before selecting a replacement library.

Refactor the duplicated missing-key/retry UI and handlers in `src/client/viewer.ts:258` and `src/client/viewer.ts:343` when touching that flow. Consolidate contradictory mobile split rules. Neither refactor alone is a user-facing performance fix.

The native rate limiter is supported in code but is absent from wrangler.json; production falls back to a per-isolate Map. Treat 30/min/IP as best-effort, not a global quota. Provision the Cloudflare binding if stronger local edge enforcement is desired; even that is not an exact global transactional limit.

## False positives removed / limits

- The large empty writing area is intentional editor space, not a layout defect.
- The earlier premature scrollbar is fixed; ordinary internal scrolling remains appropriate.
- Modal short-screen reachability and Tab navigation pass existing tests.
- New Paste after a successful save works, including the modal action.
- Browser DOMPurify sanitizer cases pass; no new XSS vulnerability is claimed.
- Updating libraries or introducing React does not inherently make this product faster.
- KV-double results demonstrate handler assumptions/races; they do not simulate all Cloudflare caching behavior.
- A stale-value double returned expired content because readPaste does not independently enforce expiresAtMs. This is defense-in-depth advice only: this audit did not establish that KV expiration serves expired values in production, so it is excluded from confirmed defects.

## Verification

Fresh checks: TypeScript passes; Biome passes; 55 Bun tests and 29 Chromium tests pass (84 total). Focused probes identified gaps beyond that suite. Browser measurements are local, unthrottled and sample-specific. No Firefox, Safari, real mobile keyboard, geographic latency or production concurrency benchmark was performed.

References: https://developers.cloudflare.com/kv/concepts/how-kv-works/ and https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md


## Implemented corrections

- A named main landmark now contains the status strip, editor, preview and privacy help. Automated axe checks cover the landing page, viewer, missing-key screen, burn warning, 404 and success dialog.
- New pastes use SQLite-backed Durable Objects. Creation, consumption and token deletion share one authority; legacy KV records migrate on access. Tombstones prevent stale KV values from resurrecting a burned or deleted paste. Expiry alarms clear storage safely. Payload chunks accommodate the complete 5MiB range. New IDs carry 72 bits of randomness.
- Hono body-limit middleware bounds streaming wire bytes separately from decoded content, so JSON escaping does not reject otherwise valid pastes. Mode and burn flags are stored separately from literal content.
- Above 20,000 characters the preview/viewer show a labeled plain-text excerpt. Copy, raw access and download retain complete content. This is an intentional rendering boundary, not full-document Markdown virtualization. Stats and preview updates are debounced; closing preview cancels queued work.
- Native editing transactions preserve Undo for formatting and list continuation. The textarea retains its native UI; the insertText compatibility command remains because direct textarea APIs do not preserve the native undo buffer. A maintained full editor is unnecessary for this scope.
- Mobile controls use 44px hit areas. Conflicting split CSS was removed; writing and preview panes are balanced. The editor uses a 16px font. Keyboard focus brightens the stats label without restoring the rejected brown stripe.
- New Paste clears the editor and offers recovery of the previous draft. Draft saving reports success/failure, can be disabled for the session and explicitly explains plaintext local persistence. Upload timeout covers both response headers and the response body, preserves text and warns that a timed-out request may already have saved.
- Encryption labels/help and burn warning wording were clarified. Clipboard failure offers manual-copy instructions. Background form controls are inert while the success dialog is open. Missing-key and retry UI now share one handler, and stale decryption attempts cannot overwrite newer results.
- Public scripts use SHA-256 ETags and 304 revalidation; private paste responses stay no-store. Duplicate collision reads were removed. Cloudflare's native rate-limit binding is configured (still a per-location approximation, not a strict global quota).
- The bespoke Worker regex sanitizer was removed in favor of sanitize-html 2.18.0. Browser DOMPurify remains in use. Untrusted application CSS classes, SVG/MathML and dangerous URI attributes are restricted. Browser sanitizer failure escapes output instead of attempting regex sanitization.
- CI now runs the Cloudflare integration suite and Chromium/accessibility suite, pins Node 24, and uses current checkout/setup-node action majors.

Verification before deployment: 60 Bun tests, 40 Chromium tests and 9 real local Cloudflare Worker integration checks pass (109 total). Typecheck, Biome, frozen-lockfile install and dependency audit pass. Runtime checks include concurrent HTML/raw burn readers, restart-persistent deletion, legacy KV migration, expiry alarms, 5MiB round-trip and oversized streams without Content-Length. Browser timings remain local measurements rather than field Core Web Vitals.

References for the implementation: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ ; https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html ; https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
