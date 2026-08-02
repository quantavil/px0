import { clockSvg, copyIcon, lockIcon } from "../icons";
import { ENC_PREFIX, PASS_PREFIX } from "../utils";
import {
  base64UrlToBytes,
  copyToClipboard,
  deriveKeyFromPassword,
  flashCopied,
  formatTimeLeft,
  renderMarkdown,
} from "./shared";

declare global {
  interface Window {
    __PX0_DATA__?: {
      rawContent: string;
      isEncrypted: boolean;
      isPasswordProtected: boolean;
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
    window.__PX0_DATA__ = {
      rawContent: JSON.parse(el.textContent?.trim() ?? ""),
      isEncrypted: el.getAttribute("data-encrypted") === "true",
      isPasswordProtected: el.getAttribute("data-password") === "true",
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
    badge.innerHTML = `${clockSvg} ${formatTimeLeft(remaining)}`;
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

function revealPasteActions() {
  const pasteActions = document.getElementById("pasteActions");
  if (pasteActions) {
    pasteActions.style.display = "flex";
  }
  // Reveal the delete button too so it can't be triggered before a password/E2EE paste is unlocked.
  const deleteBtn = document.getElementById("deleteBtn");
  if (deleteBtn) {
    deleteBtn.style.display = "flex";
  }
}

function copyLink() {
  copyToClipboard(window.location.href);
  flashCopied(document.getElementById("copyBtn"));
}

// The readable text of this paste: whatever was decrypted in-browser, or the
// stored value when it was never encrypted. Never the ciphertext.
function pasteText(): string {
  if (window.__PX0_DECRYPTED_TEXT__) return window.__PX0_DECRYPTED_TEXT__;
  const rawVal = window.__PX0_DATA__?.rawContent || "";
  const encrypted =
    rawVal.startsWith(PASS_PREFIX) || rawVal.startsWith(ENC_PREFIX);
  return encrypted ? "" : rawVal;
}

function copyContent() {
  copyToClipboard(pasteText());
  flashCopied(document.getElementById("copyContentBtn"));
}

// Download, not /raw: this works for decrypted E2EE and password pastes, which
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
  a.click();
  URL.revokeObjectURL(url);
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

async function unlockPasswordPaste() {
  const passInput = document.getElementById(
    "unlockPass",
  ) as HTMLInputElement | null;
  const passErr = document.getElementById(
    "passErr",
  ) as HTMLParagraphElement | null;
  const passVal = passInput ? passInput.value : "";
  const rawContent = window.__PX0_DATA__?.rawContent || "";

  if (!passVal) return;

  // 600k PBKDF2 iterations take about a second on a phone, during which the
  // page looked frozen and a second click queued another derivation.
  const btn = document.getElementById(
    "btnUnlockAction",
  ) as HTMLButtonElement | null;
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Unlocking…";
  }
  const restoreBtn = () => {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = "Unlock";
  };

  try {
    // __PX0_PASS__:salt:iv:ciphertext
    const parts = rawContent.slice(PASS_PREFIX.length).split(":");
    if (parts.length < 3) {
      if (passErr) passErr.textContent = "Malformed or corrupted payload!";
      restoreBtn();
      return;
    }
    const salt = base64UrlToBytes(parts[0]);
    const iv = base64UrlToBytes(parts[1]);
    const ciphertext = base64UrlToBytes(parts[2]);

    const cryptoKey = await deriveKeyFromPassword(passVal, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );
    const plaintext = new TextDecoder().decode(decrypted);

    window.__PX0_DECRYPTED_TEXT__ = plaintext;

    const outputEl = document.getElementById("output");
    if (outputEl) {
      outputEl.innerHTML = renderMarkdown(plaintext);
    }
    revealPasteActions();
    attachCodeBlockCopyButtons();
  } catch (_err) {
    if (passErr)
      passErr.textContent = "Incorrect password — check it and try again.";
    restoreBtn();
  }
}

function bindDeleteButton() {
  const btn = document.getElementById("deleteBtn") as HTMLButtonElement | null;
  const label = document.getElementById(
    "deleteLabel",
  ) as HTMLSpanElement | null;
  // initPageViewer re-runs on every hashchange; without this guard each run
  // stacked another click listener, so the second click fired N delete
  // requests and the arm/confirm step could be skipped entirely.
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  const id = window.location.pathname.slice(1);

  const reset = () => {
    delete btn.dataset.armed;
    btn.classList.remove("armed");
    if (label) label.textContent = "Delete";
    btn.title = "Delete this paste instantly";
  };

  btn.addEventListener("click", async () => {
    if (btn.dataset.armed === "1") {
      try {
        await fetch(`/api/paste/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
        reset();
        return;
      }
      window.location.href = "/";
      return;
    }
    btn.dataset.armed = "1";
    btn.classList.add("armed");
    if (label) label.textContent = "Confirm?";
    btn.title = "Click again to permanently delete";
    setTimeout(reset, 2500);
  });
}

async function initPageViewer() {
  initPx0Data();
  startExpiryCountdown();
  bindDeleteButton();
  const data = window.__PX0_DATA__;
  if (!data) return;

  const { isEncrypted, isPasswordProtected, rawContent } = data;
  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  // Bind click event listeners (moved from inline onclick attributes for CSP compliance)
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.addEventListener("click", copyLink);
    copyBtn.dataset.bound = "1";
  }
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

  if (isPasswordProtected) {
    if (document.getElementById("unlockPass")) {
      return;
    }

    outputEl.innerHTML = `
      <div class="unlock-card-wrapper">
        <div class="unlock-card">
          <div class="unlock-icon-container">${lockIcon}</div>
          <h2 class="unlock-title">Password Protected Paste</h2>
          <p class="unlock-subtitle">Enter password to decrypt & view contents.</p>
          <div class="unlock-form-row">
            <input type="password" id="unlockPass" class="unlock-input" placeholder="Enter password…" aria-label="Paste password" aria-describedby="passErr" autocomplete="off">
            <button type="button" id="btnUnlockAction" class="btn-unlock-submit">Unlock</button>
          </div>
          <p id="passErr" class="unlock-err-msg" role="alert"></p>
        </div>
      </div>
    `;

    const input = document.getElementById(
      "unlockPass",
    ) as HTMLInputElement | null;
    const btnUnlock = document.getElementById(
      "btnUnlockAction",
    ) as HTMLButtonElement | null;
    const passErr = document.getElementById(
      "passErr",
    ) as HTMLParagraphElement | null;

    if (btnUnlock) {
      btnUnlock.addEventListener("click", () => {
        unlockPasswordPaste();
      });
    }
    if (input) {
      input.focus();
      input.addEventListener("input", () => {
        if (passErr) passErr.textContent = "";
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          unlockPasswordPaste();
        }
      });
    }

    return;
  }

  if (!isEncrypted) {
    attachCodeBlockCopyButtons();
    return;
  }

  const secretKeyBase64 = window.location.hash.substring(1);

  if (!secretKeyBase64) {
    outputEl.innerHTML =
      '<p class="viewer-msg is-error">Error: Decryption key missing from URL hash fragment!</p>';
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
    outputEl.innerHTML =
      '<p class="viewer-msg is-error">Error: Invalid decryption key or corrupted payload.</p>';
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
// destroyed already-rendered content: following an in-page `#heading` link on
// an unlocked password paste re-rendered the unlock card and made the reader
// type the password again.
window.addEventListener("hashchange", () => {
  if (window.__PX0_DATA__?.isEncrypted && !window.__PX0_DECRYPTED_TEXT__) {
    initPageViewer();
  }
});
