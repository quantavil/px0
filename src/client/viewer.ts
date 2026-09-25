import { clockSvg, copyIcon, lockIcon } from "../icons";
import { ENC_PREFIX } from "../utils";
import {
  base64UrlToBytes,
  copyToClipboard,
  flashCopied,
  formatTimeLeft,
  renderMarkdown,
} from "./shared";

declare global {
  interface Window {
    __PX0_DATA__?: {
      rawContent: string;
      isEncrypted: boolean;
      expiresAtMs?: number;
    };
    __PX0_DECRYPTED_TEXT__?: string;
  }
}

function initPx0Data() {
  if (window.__PX0_DATA__) return;
  const el = document.getElementById("px0-data");
  if (el) {
    const expiresAtAttr = el.getAttribute("data-expires-at");
    let rawContent = "";
    try {
      rawContent = JSON.parse(el.textContent?.trim() ?? '""');
    } catch {
      rawContent = el.textContent?.trim() ?? "";
    }
    window.__PX0_DATA__ = {
      rawContent,
      isEncrypted: el.getAttribute("data-encrypted") === "true",
      expiresAtMs:
        expiresAtAttr && expiresAtAttr.trim() !== ""
          ? Number(expiresAtAttr)
          : undefined,
    };
  }
}

function startExpiryCountdown() {
  const expiresAtMs = window.__PX0_DATA__?.expiresAtMs;
  const badge = document.getElementById("expiryBadge");
  // Guarded because initPageViewer re-runs on hashchange, which otherwise
  // started a second interval against the same badge each time.
  if (expiresAtMs === undefined || !badge || badge.dataset.ticking) return;
  badge.dataset.ticking = "1";

  const update = () => {
    const remaining = expiresAtMs - Date.now();
    // formatTimeLeft can return "<1m left" — setting it via innerHTML would
    // parse the "<" as markup. Set text first, then prepend the static icon.
    badge.textContent = formatTimeLeft(remaining);
    badge.insertAdjacentHTML("afterbegin", `${clockSvg} `);
    if (remaining > 0) return;
    // The countdown used to just stop, leaving an amber "expired" badge over
    // content that a reload would 404. The text stays on screen — it is already
    // in this reader's browser and yanking it away helps nobody — but the badge
    // says plainly that the link is dead now.
    badge.className = "badge badge-expired";
    badge.title = "This paste has expired — reloading will no longer find it";
    clearInterval(interval);
  };

  // formatTimeLeft only resolves to minutes, so a 1s tick repainted the badge
  // 59 times for no visible change.
  const interval = setInterval(update, 15000);
  update();
}

function getStoredDeleteToken(id: string): string | null {
  try {
    return localStorage.getItem(`px0_del_${id}`);
  } catch {
    return null;
  }
}

function revealPasteActions() {
  const pasteActions = document.getElementById("pasteActions");
  if (pasteActions) {
    pasteActions.style.display = "flex";
  }
  // Reveal the delete button only if this browser is the creator holding the deleteToken.
  const deleteBtn = document.getElementById("deleteBtn");
  const id = window.location.pathname.slice(1);
  if (deleteBtn && getStoredDeleteToken(id)) {
    deleteBtn.style.display = "flex";
  }
}

// The readable text of this paste: whatever was decrypted in-browser, or the
// stored value when it was never encrypted. Never the ciphertext.
function pasteText(): string {
  if (window.__PX0_DECRYPTED_TEXT__) return window.__PX0_DECRYPTED_TEXT__;
  const rawVal = window.__PX0_DATA__?.rawContent || "";
  return rawVal.startsWith(ENC_PREFIX) ? "" : rawVal;
}

async function copyContent() {
  const ok = await copyToClipboard(pasteText());
  if (ok) flashCopied(document.getElementById("copyContentBtn"));
}

// Download, not /raw: this works for decrypted E2EE pastes, which
// /raw structurally cannot — it only ever sees the ciphertext.
function downloadContent() {
  const text = pasteText();
  if (!text) return;
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${window.location.pathname.slice(1) || "paste"}.md`;
  // Firefox requires the anchor to be in the DOM; revoking synchronously can
  // race the download start, so defer it.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flashCopied(document.getElementById("downloadBtn"));
}

function attachCodeBlockCopyButtons() {
  const outputEl = document.getElementById("output");
  if (!outputEl) return;
  outputEl.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-btn";
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = copyIcon;
    btn.addEventListener("click", () => {
      copyToClipboard(pre.querySelector("code")?.textContent || "");
      flashCopied(btn);
    });
    pre.appendChild(btn);
  });
}

function bindDeleteButton() {
  const btn = document.getElementById("deleteBtn") as HTMLButtonElement | null;
  const label = document.getElementById(
    "deleteLabel",
  ) as HTMLSpanElement | null;
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  const id = window.location.pathname.slice(1);
  const deleteToken = getStoredDeleteToken(id);

  if (!deleteToken) {
    btn.style.display = "none";
    return;
  }

  const reset = () => {
    delete btn.dataset.armed;
    btn.classList.remove("armed");
    if (label) label.textContent = "Delete";
    btn.title = "Delete this paste instantly";
  };

  btn.addEventListener("click", async () => {
    if (btn.dataset.armed === "1") {
      try {
        const res = await fetch(`/api/paste/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "X-Delete-Token": deleteToken },
        });
        if (res.ok) {
          try {
            localStorage.removeItem(`px0_del_${id}`);
          } catch {}
          window.location.href = "/";
          return;
        }
        if (label) label.textContent = "Failed";
        setTimeout(reset, 2000);
        return;
      } catch {
        if (label) label.textContent = "Error";
        setTimeout(reset, 2000);
        return;
      }
    }
    btn.dataset.armed = "1";
    btn.classList.add("armed");
    if (label) label.textContent = "Confirm?";
    btn.title = "Click again to permanently delete";
    setTimeout(reset, 2500);
  });
}

function preserveHashOnBurnReveal() {
  const revealBtn = document.getElementById(
    "revealBtn",
  ) as HTMLAnchorElement | null;
  if (!revealBtn) return;

  const updateHref = () => {
    if (window.location.hash) {
      const baseHref =
        revealBtn.getAttribute("data-base-href") ||
        revealBtn.getAttribute("href") ||
        "";
      const cleanBase = baseHref.split("#")[0];
      revealBtn.setAttribute("data-base-href", cleanBase);
      revealBtn.href = `${cleanBase}${window.location.hash}`;
    }
  };

  updateHref();
  if (!revealBtn.dataset.bound) {
    revealBtn.dataset.bound = "1";
    revealBtn.addEventListener("click", updateHref);
  }
}

async function initPageViewer() {
  preserveHashOnBurnReveal();
  initPx0Data();
  startExpiryCountdown();
  bindDeleteButton();
  const data = window.__PX0_DATA__;
  if (!data) return;

  const { isEncrypted, rawContent } = data;
  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  // Bind click event listeners (moved from inline onclick attributes for CSP compliance)
  const copyContentBtn = document.getElementById("copyContentBtn");
  if (copyContentBtn && !copyContentBtn.dataset.bound) {
    copyContentBtn.addEventListener("click", copyContent);
    copyContentBtn.dataset.bound = "1";
  }
  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn && !downloadBtn.dataset.bound) {
    downloadBtn.addEventListener("click", downloadContent);
    downloadBtn.dataset.bound = "1";
  }

  if (!isEncrypted) {
    revealPasteActions();
    attachCodeBlockCopyButtons();
    return;
  }

  const secretKeyBase64 = window.location.hash.substring(1);

  if (!secretKeyBase64) {
    outputEl.innerHTML = `
      <div class="unlock-card-wrapper">
        <div class="unlock-card">
          <div class="unlock-icon-container">${lockIcon}</div>
          <h1 class="unlock-title">Decryption Key Required</h1>
          <p class="unlock-subtitle">This paste is end-to-end encrypted. The key is normally part of the URL (#...), but was missing from your link.</p>
          <div class="unlock-form-row">
            <input type="text" id="manualKeyInput" class="unlock-input" placeholder="Paste decryption key…" aria-label="Decryption key" aria-describedby="keyErr" autocomplete="off" spellcheck="false">
            <button type="button" id="btnDecryptAction" class="btn-unlock-submit">Decrypt</button>
          </div>
          <p id="keyErr" class="unlock-err-msg" role="alert"></p>
        </div>
      </div>
    `;

    const keyInput = document.getElementById(
      "manualKeyInput",
    ) as HTMLInputElement | null;
    const btnDecrypt = document.getElementById(
      "btnDecryptAction",
    ) as HTMLButtonElement | null;
    const keyErr = document.getElementById(
      "keyErr",
    ) as HTMLParagraphElement | null;

    const tryManualKey = () => {
      const val = keyInput?.value.trim() ?? "";
      if (!val) return;
      const cleanKey = val.startsWith("#") ? val.slice(1) : val;
      if (window.location.hash === `#${cleanKey}`) {
        initPageViewer();
      } else {
        window.location.hash = cleanKey;
      }
    };

    if (btnDecrypt) {
      btnDecrypt.addEventListener("click", tryManualKey);
    }
    if (keyInput) {
      keyInput.focus();
      keyInput.addEventListener("input", () => {
        if (keyErr) keyErr.textContent = "";
      });
      keyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") tryManualKey();
      });
    }

    return;
  }

  try {
    const keyBytes = base64UrlToBytes(secretKeyBase64);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const combinedBytes = base64UrlToBytes(rawContent.slice(ENC_PREFIX.length));
    const iv = combinedBytes.slice(0, 12);
    const ciphertext = combinedBytes.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );
    const plaintext = new TextDecoder().decode(decrypted);

    window.__PX0_DECRYPTED_TEXT__ = plaintext;

    outputEl.innerHTML = renderMarkdown(plaintext);
    revealPasteActions();
    attachCodeBlockCopyButtons();
  } catch (err) {
    console.error("Decryption error:", err);
    outputEl.innerHTML = `
      <div class="unlock-card-wrapper">
        <div class="unlock-card">
          <div class="unlock-icon-container" style="border-color: var(--red-line); color: var(--red); background: var(--red-fill);">${lockIcon}</div>
          <h1 class="unlock-title">Decryption Failed</h1>
          <p class="unlock-subtitle">Invalid decryption key or corrupted payload.</p>
          <div class="unlock-form-row">
            <input type="text" id="manualKeyInput" class="unlock-input" placeholder="Enter correct key…" aria-label="Decryption key" autocomplete="off" spellcheck="false">
            <button type="button" id="btnDecryptAction" class="btn-unlock-submit">Try Again</button>
          </div>
          <p id="keyErr" class="unlock-err-msg" role="alert">Error: Decryption key is invalid or corrupted.</p>
        </div>
      </div>
    `;

    const keyInput = document.getElementById(
      "manualKeyInput",
    ) as HTMLInputElement | null;
    const btnDecrypt = document.getElementById(
      "btnDecryptAction",
    ) as HTMLButtonElement | null;
    const keyErr = document.getElementById(
      "keyErr",
    ) as HTMLParagraphElement | null;

    const retryManualKey = () => {
      const val = keyInput?.value.trim() ?? "";
      if (!val) return;
      const cleanKey = val.startsWith("#") ? val.slice(1) : val;
      if (window.location.hash === `#${cleanKey}`) {
        initPageViewer();
      } else {
        window.location.hash = cleanKey;
      }
    };

    if (btnDecrypt) btnDecrypt.addEventListener("click", retryManualKey);
    if (keyInput) {
      keyInput.focus();
      keyInput.addEventListener("input", () => {
        if (keyErr) keyErr.textContent = "";
      });
      keyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") retryManualKey();
      });
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initPageViewer();
  });
} else {
  initPageViewer();
}
// The hash fragment only ever carries the E2EE key, so it is the only thing
// worth re-initialising for. Re-running the whole init on any hash change
// destroyed already-rendered content: following an in-page `#heading` link
// re-rendered the unlock card and forced the reader to retry.
window.addEventListener("hashchange", () => {
  if (window.__PX0_DATA__?.isEncrypted && !window.__PX0_DECRYPTED_TEXT__) {
    initPageViewer();
  }
});
