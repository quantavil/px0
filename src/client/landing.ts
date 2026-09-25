import {
  clockSvg,
  closeIcon,
  copyIcon,
  externalLinkIcon,
  flameSvg,
  globeSvg,
  lockIcon,
  plusIcon,
} from "../icons";
import { ENC_PREFIX, MAX_PASTE_BYTES } from "../utils";
import {
  bytesToBase64Url,
  copyToClipboard,
  flashCopied,
  renderMarkdown,
} from "./shared";

function initLanding() {
  const textarea = document.getElementById(
    "content",
  ) as HTMLTextAreaElement | null;
  const previewPane = document.getElementById(
    "previewPane",
  ) as HTMLDivElement | null;
  const editorContainer = document.getElementById(
    "editorContainer",
  ) as HTMLDivElement | null;
  const btnSplit = document.getElementById(
    "btnSplit",
  ) as HTMLButtonElement | null;
  const charCount = document.getElementById(
    "charCount",
  ) as HTMLSpanElement | null;
  const e2eeToggle = document.getElementById(
    "e2eeToggle",
  ) as HTMLInputElement | null;
  const ttlDropdown = document.getElementById(
    "ttlDropdown",
  ) as HTMLDivElement | null;
  const ttlTrigger = document.getElementById(
    "ttlTrigger",
  ) as HTMLButtonElement | null;
  const ttlMenu = document.getElementById("ttlMenu") as HTMLUListElement | null;
  const ttlValue = document.getElementById(
    "ttlValue",
  ) as HTMLSpanElement | null;
  const ttlInput = document.getElementById(
    "ttlInput",
  ) as HTMLInputElement | null;

  function closeTtlMenu() {
    if (!ttlMenu || !ttlTrigger) return;
    ttlMenu.hidden = true;
    ttlTrigger.classList.remove("open");
    ttlTrigger.setAttribute("aria-expanded", "false");
  }

  // The trigger label is read off the chosen option rather than passed in, so
  // the label, the hidden input and the checkmark can't disagree.
  function setTtlOption(key: string) {
    if (ttlInput) ttlInput.value = key;
    ttlMenu?.querySelectorAll<HTMLElement>(".ttl-option").forEach((opt) => {
      const selected = opt.dataset.ttl === key;
      opt.classList.toggle("selected", selected);
      opt.setAttribute("aria-selected", String(selected));
      if (selected && ttlValue) {
        ttlValue.textContent = opt.textContent?.trim() ?? "";
      }
    });
  }

  if (ttlTrigger && ttlMenu) {
    const options = () => [
      ...ttlMenu.querySelectorAll<HTMLElement>(".ttl-option"),
    ];

    // The listbox is built from <li>s, which aren't focusable by default —
    // the whole expiry control was mouse-only. Roving tabindex fixes that.
    for (const opt of options()) opt.tabIndex = -1;

    // The default TTL only carried aria-selected in the server markup, so
    // opening the menu for the first time showed no checkmark against it.
    setTtlOption(ttlInput?.value ?? "30d");

    function openTtlMenu(focusSelected = false) {
      if (!ttlMenu || !ttlTrigger) return;
      ttlMenu.hidden = false;
      ttlTrigger.classList.add("open");
      ttlTrigger.setAttribute("aria-expanded", "true");
      if (!focusSelected) return;
      const opts = options();
      (opts.find((o) => o.classList.contains("selected")) ?? opts[0])?.focus();
    }

    function moveFocus(from: HTMLElement, delta: number) {
      const opts = options();
      const next = opts[opts.indexOf(from) + delta];
      next?.focus();
    }

    function chooseOption(opt: HTMLElement) {
      if (!opt.dataset.ttl) return;
      setTtlOption(opt.dataset.ttl);
      closeTtlMenu();
      ttlTrigger?.focus();
    }

    ttlTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ttlMenu.hidden) openTtlMenu();
      else closeTtlMenu();
    });

    ttlTrigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openTtlMenu(true);
      }
    });

    ttlMenu.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>(".ttl-option");
      if (opt) chooseOption(opt);
    });

    ttlMenu.addEventListener("keydown", (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>(".ttl-option");
      if (!opt) return;
      const opts = options();
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(opt, 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(opt, -1);
          break;
        case "Home":
          e.preventDefault();
          opts[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          opts[opts.length - 1]?.focus();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          chooseOption(opt);
          break;
        case "Tab":
          closeTtlMenu();
          break;
      }
    });

    document.addEventListener("click", (e) => {
      if (ttlDropdown && !ttlDropdown.contains(e.target as Node)) {
        closeTtlMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || ttlMenu.hidden) return;
      closeTtlMenu();
      ttlTrigger.focus();
    });
  }

  // Plaintext is the default; the user opts into E2EE per paste. The two
  // radios share one name, so the browser keeps them mutually exclusive and
  // the :checked badge styles show the choice — no JS label sync needed.

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Plaintext is the default; the user opts into E2EE per paste.
  function isE2eeMode() {
    return e2eeToggle?.checked ?? false;
  }

  function renderLivePreview() {
    if (!previewPane || !textarea) return;
    previewPane.innerHTML = renderMarkdown(textarea.value);
  }

  // A full marked re-parse per keystroke gets expensive fast on a large paste;
  // one frame of latency after the user stops typing is imperceptible.
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleLivePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderLivePreview, 120);
  }

  if (btnSplit && editorContainer) {
    btnSplit.addEventListener("click", () => {
      const isSplit = editorContainer.classList.toggle("split-active");
      btnSplit.classList.toggle("active", isSplit);
      btnSplit.setAttribute("aria-pressed", String(isSplit));
      if (isSplit) {
        renderLivePreview();
      }
    });
  }

  function updateStats() {
    if (!textarea || !charCount) return;
    const val = textarea.value || "";
    const lines = val ? val.split("\n").length : 0;
    const byteCount = new TextEncoder().encode(val).byteLength;
    // Compact by design: the footer has no room for a full sentence on a
    // 390px phone. Full accounting lives in the tooltip.
    charCount.textContent = `${lines} lines · ${formatBytes(byteCount)}`;
    charCount.title = `${lines} lines (${formatBytes(byteCount)} / 5MB)`;

    if (editorContainer?.classList.contains("split-active")) {
      scheduleLivePreview();
    }
  }

  const draftContainer = document.getElementById("draftContainer");
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      if (!textarea) return;
      try {
        if (textarea.value.trim()) {
          localStorage.setItem("px0_draft", textarea.value);
        } else {
          localStorage.removeItem("px0_draft");
        }
      } catch {}
    }, 400);
  }

  function checkAndRestoreDraft() {
    if (!textarea) return;
    try {
      const savedDraft = localStorage.getItem("px0_draft");
      if (savedDraft && !textarea.value) {
        textarea.value = savedDraft;
        updateStats();
        if (draftContainer) {
          draftContainer.innerHTML = `
            <span class="draft-badge">
              Draft restored
              <button type="button" id="discardDraftBtn" class="draft-discard" title="Discard saved draft">Discard</button>
            </span>
          `;
          document
            .getElementById("discardDraftBtn")
            ?.addEventListener("click", () => {
              try {
                localStorage.removeItem("px0_draft");
              } catch {}
              if (textarea) textarea.value = "";
              updateStats();
              if (draftContainer) draftContainer.innerHTML = "";
            });
        }
      }
    } catch {}
  }

  function wrapSelection(before: string, after: string, defaultText = "") {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end) || defaultText;
    const replacement = `${before}${selected}${after}`;
    textarea.value =
      text.substring(0, start) + replacement + text.substring(end);
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + selected.length;
    updateStats();
    scheduleDraftSave();
  }

  function handleListContinuation(e: KeyboardEvent) {
    if (!textarea || e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey)
      return;
    const start = textarea.selectionStart;
    const text = textarea.value;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const currentLine = text.substring(lineStart, start);

    const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s+(.*)$/);
    if (unorderedMatch) {
      e.preventDefault();
      const [, indent, bullet, content] = unorderedMatch;
      if (!content.trim()) {
        textarea.value = text.substring(0, lineStart) + text.substring(start);
        textarea.selectionStart = textarea.selectionEnd = lineStart;
      } else {
        const continuation = `\n${indent}${bullet} `;
        textarea.value =
          text.substring(0, start) + continuation + text.substring(start);
        textarea.selectionStart = textarea.selectionEnd =
          start + continuation.length;
      }
      updateStats();
      scheduleDraftSave();
      return;
    }

    const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      e.preventDefault();
      const [, indent, numStr, content] = orderedMatch;
      if (!content.trim()) {
        textarea.value = text.substring(0, lineStart) + text.substring(start);
        textarea.selectionStart = textarea.selectionEnd = lineStart;
      } else {
        const nextNum = parseInt(numStr, 10) + 1;
        const continuation = `\n${indent}${nextNum}. `;
        textarea.value =
          text.substring(0, start) + continuation + text.substring(start);
        textarea.selectionStart = textarea.selectionEnd =
          start + continuation.length;
      }
      updateStats();
      scheduleDraftSave();
      return;
    }
  }

  if (textarea) {
    textarea.addEventListener("input", () => {
      updateStats();
      scheduleDraftSave();
      if (draftContainer && !textarea.value.trim()) {
        draftContainer.innerHTML = "";
      }
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value =
          textarea.value.substring(0, start) +
          "  " +
          textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        updateStats();
        scheduleDraftSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "b") {
          e.preventDefault();
          wrapSelection("**", "**", "bold text");
          return;
        }
        if (k === "i") {
          e.preventDefault();
          wrapSelection("*", "*", "italic text");
          return;
        }
        if (k === "k") {
          e.preventDefault();
          wrapSelection("[", "](url)", "link text");
          return;
        }
      }

      handleListContinuation(e);
    });

    checkAndRestoreDraft();

    // Desktop-only autofocus: the SSR `autofocus` attribute popped the mobile
    // keyboard on page load. Focus only on fine-pointer devices with hover.
    try {
      if (
        !textarea.value &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        textarea.focus();
      }
    } catch {}
  }

  const form = document.getElementById("pasteForm") as HTMLFormElement | null;
  const saveError = document.getElementById(
    "saveError",
  ) as HTMLSpanElement | null;
  let isSubmitting = false;

  if (form) {
    // The Save button advertises Ctrl+S; actually wire it up.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!isSubmitting) {
          form.requestSubmit();
        }
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmitting || !textarea || !e2eeToggle) return;

      const saveBtn = document.getElementById(
        "saveBtn",
      ) as HTMLButtonElement | null;
      const saveBtnLabel = saveBtn?.querySelector("span");

      // Generating the E2EE key + encrypting takes a noticeable moment, during
      // which Save only dimmed. The unlock button already says "Unlocking…";
      // the create side needs the same honesty.
      const setSaveBusy = (label: string | null) => {
        isSubmitting = label !== null;
        if (saveBtn) saveBtn.disabled = label !== null;
        if (saveBtnLabel) saveBtnLabel.textContent = label ?? "Save";
      };

      const fail = (msg: string) => {
        isSubmitting = false;
        if (saveError) saveError.textContent = msg;
        setSaveBusy(null);
      };

      if (saveError) saveError.textContent = "";
      if (!textarea.value.trim()) {
        fail("Nothing to save — the editor is empty.");
        textarea.focus();
        return;
      }

      const text = textarea.value;
      const isE2ee = isE2eeMode();
      const selectedTtl = ttlInput ? ttlInput.value : "1d";

      setSaveBusy(isE2ee ? "Encrypting…" : "Saving…");

      let payload = text;
      let secretKeyBase64 = "";

      // crypto.subtle throws off HTTP / when WebCrypto is unavailable — without
      // this the handler escapes past `fail()` and Save stays stuck disabled.
      try {
        if (isE2ee) {
          const cryptoKey = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
          );

          const iv = crypto.getRandomValues(new Uint8Array(12));
          const encodedText = new TextEncoder().encode(text);
          const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            cryptoKey,
            encodedText,
          );

          const exportedKey = await crypto.subtle.exportKey("raw", cryptoKey);
          secretKeyBase64 = bytesToBase64Url(new Uint8Array(exportedKey));

          const combined = new Uint8Array(iv.length + ciphertext.byteLength);
          combined.set(iv, 0);
          combined.set(new Uint8Array(ciphertext), iv.length);
          payload = `${ENC_PREFIX}${bytesToBase64Url(combined)}`;
        }
      } catch {
        fail(
          "Encryption failed — WebCrypto is unavailable (needs HTTPS or localhost).",
        );
        return;
      }

      // Measured on the final payload, not the typed text: base64 makes an
      // encrypted paste ~35% larger, so the server's limit bites at a size the
      // editor never showed. Checking here costs one encode and saves uploading
      // several megabytes just to be told 413.
      if (new TextEncoder().encode(payload).byteLength > MAX_PASTE_BYTES) {
        fail(
          isE2ee
            ? "Too large — the 5MB limit applies after encryption, which adds about 35%."
            : "Too large — pastes are capped at 5MB.",
        );
        return;
      }

      let res: Response;
      try {
        res = await fetch("/api/paste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: payload, ttl: selectedTtl }),
        });
      } catch {
        // Network failure previously threw past the handler, leaving the Save
        // button stuck disabled with no explanation.
        fail("Network error — paste not saved. Check your connection.");
        return;
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        fail(errData.error || "Failed to save paste.");
        return;
      }

      const data = (await res.json()) as { id: string; deleteToken?: string };
      if (data.id) {
        if (data.deleteToken) {
          try {
            localStorage.setItem(`px0_del_${data.id}`, data.deleteToken);
          } catch {}
        }
        try {
          localStorage.removeItem("px0_draft");
        } catch {}
        setSaveBusy(null);

        const pasteUrl = `/${data.id}${
          secretKeyBase64 ? `#${secretKeyBase64}` : ""
        }`;

        const modeType = isE2ee ? "e2ee" : "plaintext";
        const ttlLabel = ttlValue?.textContent?.trim() || "1 Day";

        showSuccessModal(pasteUrl, selectedTtl === "burn", modeType, ttlLabel);
      } else {
        fail("Invalid server response: missing paste ID.");
      }
    });
  }
}

// Displays the paste result as a focused, high-contrast, centered modal card
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let activeModalClose: (() => void) | null = null;

function showSuccessModal(
  url: string,
  isBurn: boolean,
  mode: "e2ee" | "plaintext",
  ttlLabel: string,
) {
  if (activeModalClose) {
    activeModalClose();
  }
  const previousActiveElement = document.activeElement as HTMLElement | null;

  const fullUrl = window.location.origin + url;
  const escUrl = escapeHtmlAttr(fullUrl);
  const escTtl = escapeHtmlAttr(ttlLabel);

  document.getElementById("pxModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "pxModalOverlay";
  overlay.className = "px-modal-overlay";

  const securityBadgeHtml =
    mode === "e2ee"
      ? `${lockIcon} Zero-Knowledge E2EE`
      : `${globeSvg} Plaintext`;

  const expiryBadgeHtml = isBurn
    ? `${flameSvg} Burn After Read (1 View)`
    : `${clockSvg} ${escTtl}`;

  overlay.innerHTML = `
    <div id="pxModalCard" class="px-modal-card${isBurn ? " is-burn" : ""}" role="dialog" aria-modal="true" aria-labelledby="pxModalTitle">
      <div class="px-modal-header">
        <div class="px-modal-title-wrap">
          <span class="px-modal-icon">${isBurn ? flameSvg : lockIcon}</span>
          <h2 id="pxModalTitle" class="px-modal-title">${isBurn ? "Burn-After-Read Ready" : "Paste Link Ready"}</h2>
        </div>
        <button type="button" id="pxModalCloseBtn" class="btn-action px-modal-close" title="Close modal (Esc)" aria-label="Close modal">
          ${closeIcon}
        </button>
      </div>

      <div class="px-modal-badges">
        <span class="badge ${mode === "plaintext" ? "badge-public" : "badge-encrypted"}">${securityBadgeHtml}</span>
        <span class="badge ${isBurn ? "badge-burn-once" : "badge-ttl"}">${expiryBadgeHtml}</span>
      </div>

      <div class="px-modal-link-box">
        <input type="text" id="pxPasteUrl" class="px-modal-input" readonly value="${escUrl}" aria-label="Paste URL" spellcheck="false" autocomplete="off">
        <button type="button" id="pxModalCopyBtn" class="btn-save px-modal-copy-btn" title="Copy link to clipboard (Enter / Ctrl+C)" aria-label="Copy link to clipboard">
          ${copyIcon}
          <span class="px-modal-copy-text">Copy</span>
        </button>
      </div>

      ${
        isBurn
          ? `
      <div class="px-modal-burn-warning">
        <div class="px-burn-warn-icon">${flameSvg}</div>
        <div class="px-burn-warn-text">
          <strong>One-time view only:</strong> Opening this link will immediately delete the paste. Do not open it if you intend to send it to someone else!
        </div>
      </div>
      `
          : ""
      }

      <div class="px-modal-actions">
        ${
          !isBurn
            ? `
        <a href="${escUrl}" target="_blank" rel="noopener noreferrer" id="pxModalOpenBtn" class="btn-action px-modal-btn" title="Open paste in new tab">
          ${externalLinkIcon}
          <span>Open</span>
        </a>
        `
            : ""
        }
        <button type="button" id="pxModalNewBtn" class="btn-action px-modal-btn" title="Create another paste">
          ${plusIcon}
          <span>New Paste</span>
        </button>
        <button type="button" id="pxModalDoneBtn" class="btn-action px-modal-btn px-modal-done" title="Close and continue editing">
          Done
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const urlInput = document.getElementById(
    "pxPasteUrl",
  ) as HTMLInputElement | null;
  const copyBtn = document.getElementById(
    "pxModalCopyBtn",
  ) as HTMLButtonElement | null;
  const copyText = copyBtn?.querySelector(".px-modal-copy-text");
  const closeBtn = document.getElementById(
    "pxModalCloseBtn",
  ) as HTMLButtonElement | null;
  const doneBtn = document.getElementById(
    "pxModalDoneBtn",
  ) as HTMLButtonElement | null;

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  };

  const closeModal = () => {
    activeModalClose = null;
    document.removeEventListener("keydown", handleKeydown);
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      if (
        previousActiveElement &&
        typeof previousActiveElement.focus === "function"
      ) {
        previousActiveElement.focus();
      }
    }, 160);
  };
  activeModalClose = closeModal;

  const performCopy = async () => {
    urlInput?.focus();
    urlInput?.select();
    const copied = await copyToClipboard(fullUrl);
    if (copied) {
      flashCopied(copyBtn);
      if (copyText) {
        copyText.textContent = "Copied!";
        setTimeout(() => {
          if (copyText) copyText.textContent = "Copy";
        }, 2000);
      }
    }
  };

  // Immediate focus & auto-copy
  performCopy();

  copyBtn?.addEventListener("click", performCopy);

  urlInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performCopy();
    }
  });

  closeBtn?.addEventListener("click", closeModal);
  doneBtn?.addEventListener("click", closeModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  document.addEventListener("keydown", handleKeydown);

  // Focus trap for accessibility
  const focusableElements = () =>
    Array.from(
      overlay.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

  overlay.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = focusableElements();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  document.getElementById("pxModalNewBtn")?.addEventListener("click", () => {
    window.location.href = "/";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanding);
} else {
  initLanding();
}
