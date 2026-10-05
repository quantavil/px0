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
    // Expired: keep the text on screen, flip the badge to say the link is dead.
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
  return window.__PX0_DATA__?.isEncrypted ? "" : rawVal;
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
    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(
        pre.querySelector("code")?.textContent || "",
      );
      if (ok) {
        flashCopied(btn);
      }
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

function showUnlockCard(outputEl: HTMLElement, failed = false) {
  outputEl.innerHTML = `
    <div class="unlock-card-wrapper"><div class="unlock-card">
      <div class="unlock-icon-container">${lockIcon}</div>
      <h1 class="unlock-title">${failed ? "Decryption Failed" : "Decryption Key Required"}</h1>
      <p class="unlock-subtitle">${failed ? "Invalid decryption key or corrupted payload." : "This paste is encrypted. Open the complete link, including the key after #, or enter the key below."}</p>
      <div class="unlock-form-row">
        <input type="text" id="manualKeyInput" class="unlock-input" placeholder="Paste decryption key…" aria-label="Decryption key" aria-describedby="keyErr" autocomplete="off" spellcheck="false">
        <button type="button" id="btnDecryptAction" class="btn-unlock-submit">${failed ? "Try Again" : "Decrypt"}</button>
      </div>
      <p id="keyErr" class="unlock-err-msg" role="alert">${failed ? "Check the complete link or ask the sender for the correct key." : ""}</p>
    </div></div>`;
  const input = outputEl.querySelector<HTMLInputElement>("#manualKeyInput");
  const button = outputEl.querySelector<HTMLButtonElement>("#btnDecryptAction");
  const error = outputEl.querySelector<HTMLElement>("#keyErr");
  const submit = () => {
    const value = input?.value.trim().replace(/^#/, "") ?? "";
    if (!value) {
      if (error) error.textContent = "Enter the decryption key.";
      return;
    }
    if (button) button.disabled = true;
    if (location.hash === `#${value}`) initPageViewer();
    else location.hash = value;
  };
  button?.addEventListener("click", submit);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) submit();
  });
  input?.addEventListener("input", () => {
    if (error) error.textContent = "";
  });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) input?.focus();
}

let decryptGeneration = 0;

async function initPageViewer() {
  const generation = ++decryptGeneration;
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
    showUnlockCard(outputEl);
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
    if (generation !== decryptGeneration) return;
    const plaintext = new TextDecoder().decode(decrypted);

    window.__PX0_DECRYPTED_TEXT__ = plaintext;

    outputEl.innerHTML = renderMarkdown(plaintext);
    revealPasteActions();
    attachCodeBlockCopyButtons();
  } catch {
    if (generation !== decryptGeneration) return;
    showUnlockCard(outputEl, true);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initPageViewer();
  });
} else {
  initPageViewer();
}
// Hash only ever carries the E2EE key; ignore hash changes once decrypted
// (in-page #heading links must not re-render the unlock card).
window.addEventListener("hashchange", () => {
  if (window.__PX0_DATA__?.isEncrypted && !window.__PX0_DECRYPTED_TEXT__) {
    initPageViewer();
  }
});
