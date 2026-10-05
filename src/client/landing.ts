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
import { bytesToBase64Url, copyToClipboard, flashCopied } from "./shared";

function initLanding() {
  const textarea = document.getElementById(
    "content",
  ) as HTMLTextAreaElement | null;
  const previewPane = document.getElementById(
    "previewPane",
  ) as HTMLDivElement | null;
  const editorContainer = document.getElementById(
    "editorContainer",
  ) as HTMLElement | null;
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

  // Radios share one name, so the browser keeps them exclusive with no JS sync.

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Plaintext is the default; the user opts into E2EE per paste.
  function isE2eeMode() {
    return e2eeToggle?.checked ?? false;
  }

  type RenderFn = (md: string) => string;
  let previewRendererPromise: Promise<RenderFn> | null = null;

  function loadPreviewRenderer(): Promise<RenderFn> {
    if (!previewRendererPromise) {
      previewRendererPromise = import("/static/preview.js")
        .then((mod) => mod.renderMarkdown)
        .catch((err) => {
          previewRendererPromise = null;
          throw err;
        });
    }
    return previewRendererPromise;
  }

  let renderGeneration = 0;
  async function renderLivePreview() {
    if (
      !previewPane ||
      !textarea ||
      !editorContainer?.classList.contains("split-active")
    )
      return;
    const currentGen = ++renderGeneration;
    const text = textarea.value;
    try {
      const render = await loadPreviewRenderer();
      if (
        currentGen !== renderGeneration ||
        !editorContainer?.classList.contains("split-active")
      ) {
        return;
      }
      previewPane.innerHTML = render(text);
    } catch (err) {
      console.error("Failed to render preview:", err);
      if (
        currentGen === renderGeneration &&
        editorContainer?.classList.contains("split-active") &&
        !previewPane.innerHTML.trim()
      ) {
        previewPane.innerHTML =
          '<p class="large-paste-note">Preview could not be loaded. Check your connection.</p>';
      }
    }
  }

  // A full marked re-parse per keystroke gets expensive fast on a large paste;
  // one frame of latency after the user stops typing is imperceptible.
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleLivePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderLivePreview, 120);
  }

  if (btnSplit && editorContainer) {
    const prefetchPreview = () => {
      loadPreviewRenderer().catch(() => {});
    };
    btnSplit.addEventListener("mouseenter", prefetchPreview, { once: true });
    btnSplit.addEventListener("focus", prefetchPreview, { once: true });
    btnSplit.addEventListener("touchstart", prefetchPreview, {
      passive: true,
      once: true,
    });

    btnSplit.addEventListener("click", () => {
      clearTimeout(previewTimer);
      const isSplit = editorContainer.classList.toggle("split-active");
      btnSplit.classList.toggle("active", isSplit);
      btnSplit.setAttribute("aria-pressed", String(isSplit));
      if (isSplit) {
        renderLivePreview();
      }
    });
  }

  const encoder = new TextEncoder();
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(updateStats, 120);
  }

  function updateStats() {
    if (!textarea || !charCount) return;
    const val = textarea.value || "";
    const lines = val ? val.split("\n").length : 0;
    const byteCount = encoder.encode(val).byteLength;
    // Compact by design: the footer has no room for a full sentence on a
    // 390px phone. Full accounting lives in the tooltip.
    charCount.textContent = `${lines} lines · ${formatBytes(byteCount)}`;
    charCount.title = `${lines} lines (${formatBytes(byteCount)} / 5MB)`;

    if (editorContainer?.classList.contains("split-active")) {
      scheduleLivePreview();
    }
  }

  const draftContainer = document.getElementById("draftContainer");
  const draftStatus = document.getElementById("draftStatus");
  let previousDraft = "";
  const draftPreference = document.getElementById(
    "draftPreference",
  ) as HTMLInputElement | null;
  const showDraftStatus = (text: string) => {
    if (draftStatus) draftStatus.textContent = text;
  };
  try {
    if (draftPreference)
      draftPreference.checked =
        sessionStorage.getItem("px0_drafts_disabled") !== "true";
  } catch {}
  draftPreference?.addEventListener("change", () => {
    try {
      sessionStorage.setItem(
        "px0_drafts_disabled",
        String(!draftPreference.checked),
      );
    } catch {}
    if (!draftPreference.checked) {
      clearTimeout(draftTimer);
      draftDirty = false;
      try {
        localStorage.removeItem("px0_draft");
        localStorage.removeItem("px0_previous_draft");
      } catch {}
      showDraftStatus("Local draft saving off");
    } else scheduleDraftSave();
  });
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  let draftDirty = false;

  function saveDraft() {
    clearTimeout(draftTimer);
    if (!textarea || !draftDirty || draftPreference?.checked === false) return;
    try {
      const val = textarea.value;
      const trimmed = val.trim();
      if (trimmed) {
        localStorage.setItem("px0_draft", val);
      } else {
        localStorage.removeItem("px0_draft");
      }
      draftDirty = false;
      showDraftStatus(trimmed ? "Draft saved on this device" : "");
    } catch {
      showDraftStatus("Draft could not be saved on this device");
    }
  }

  function scheduleDraftSave() {
    if (draftPreference?.checked === false) return;
    draftDirty = true;
    showDraftStatus("Saving local draft…");
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  window.addEventListener("pagehide", saveDraft);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveDraft();
  });

  function newPaste(e: Event) {
    if (!textarea) return;
    e.preventDefault();
    clearTimeout(draftTimer);
    const previous = textarea.value;
    try {
      previousDraft = previous;
      if (previous.trim() && draftPreference?.checked !== false)
        localStorage.setItem("px0_previous_draft", previous);
      localStorage.removeItem("px0_draft");
    } catch {
      showDraftStatus("Cannot keep a recovery copy on this device");
      return;
    }
    draftDirty = false;
    textarea.value = "";
    updateStats();
    showDraftStatus("");
    showPreviousDraft();
    textarea.focus();
  }

  function showPreviousDraft() {
    if (!draftContainer || !textarea) return;
    draftContainer.innerHTML = "";
    try {
      const previous =
        previousDraft ||
        (draftPreference?.checked !== false
          ? localStorage.getItem("px0_previous_draft")
          : null);
      if (!previous) return;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "draft-discard";
      restore.textContent = "Restore previous draft";
      restore.addEventListener("click", () => {
        const current = textarea.value;
        textarea.value = previous;
        previousDraft = current;
        try {
          if (current.trim() && draftPreference?.checked !== false)
            localStorage.setItem("px0_previous_draft", current);
          else localStorage.removeItem("px0_previous_draft");
        } catch {}
        draftContainer.innerHTML = "";
        updateStats();
        scheduleDraftSave();
        textarea.focus();
      });
      draftContainer.appendChild(restore);
    } catch {}
  }
  document
    .querySelector("header .btn-action")
    ?.addEventListener("click", newPaste);
  window.addEventListener("px0:new-paste", newPaste);

  function checkAndRestoreDraft() {
    if (!textarea) return;
    showPreviousDraft();
    try {
      const savedDraft =
        draftPreference?.checked !== false
          ? localStorage.getItem("px0_draft")
          : null;
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
              clearTimeout(draftTimer);
              draftDirty = false;
              try {
                localStorage.removeItem("px0_draft");
              } catch {}
              if (textarea) textarea.value = "";
              updateStats();
              showDraftStatus("");
              if (draftContainer) draftContainer.innerHTML = "";
            });
        }
      }
    } catch {}
  }

  function replaceText(start: number, end: number, replacement: string) {
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(start, end);
    // insertText preserves textarea's native undo stack; setRangeText/value do not.
    if (!document.execCommand("insertText", false, replacement)) {
      textarea.setRangeText(replacement, start, end, "end");
    }
  }

  function wrapSelection(before: string, after: string, defaultText = "") {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || defaultText;
    const replacement = `${before}${selected}${after}`;
    replaceText(start, end, replacement);
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + selected.length;
    updateStats();
    scheduleDraftSave();
  }

  function handleListContinuation(e: KeyboardEvent) {
    if (
      !textarea ||
      e.isComposing ||
      e.key !== "Enter" ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey
    )
      return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const currentLine = text.substring(lineStart, start);

    const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s+(.*)$/);
    if (unorderedMatch) {
      e.preventDefault();
      const [, indent, bullet, content] = unorderedMatch;
      if (!content.trim()) {
        replaceText(lineStart, end, "");
        textarea.selectionStart = textarea.selectionEnd = lineStart;
      } else {
        const continuation = `\n${indent}${bullet} `;
        replaceText(start, end, continuation);
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
        replaceText(lineStart, end, "");
        textarea.selectionStart = textarea.selectionEnd = lineStart;
      } else {
        const nextNum = parseInt(numStr, 10) + 1;
        const continuation = `\n${indent}${nextNum}. `;
        replaceText(start, end, continuation);
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
      scheduleStats();
      scheduleDraftSave();
      if (draftContainer && !textarea.value.trim()) {
        draftContainer.innerHTML = "";
      }
    });

    textarea.addEventListener("keydown", (e) => {
      if (
        !e.isComposing &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
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
        // Focus needs layout. Let the browser paint the initialized page first
        // instead of forcing layout during script evaluation.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!textarea.value && document.activeElement === document.body) {
              textarea.focus({ preventScroll: true });
            }
          });
        });
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
      if (isSubmitting || form.inert || !textarea || !e2eeToggle) return;

      const saveBtn = document.getElementById(
        "saveBtn",
      ) as HTMLButtonElement | null;
      const saveBtnLabel = saveBtn?.querySelector("span");

      // Keygen + encryption take a moment; label the button honestly.
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
      const ttlLabel = ttlValue?.textContent?.trim() || "1 Day";

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

      // Check the final payload: base64 inflates E2EE pastes ~35%.
      if (new TextEncoder().encode(payload).byteLength > MAX_PASTE_BYTES) {
        fail(
          isE2ee
            ? "Too large — the 5MB limit applies after encryption, which adds about 35%."
            : "Too large — pastes are capped at 5MB.",
        );
        return;
      }

      setSaveBusy("Saving…");
      const controller = new AbortController();
      const uploadTimeout = setTimeout(() => controller.abort(), 30000);
      let res: Response;
      let responseBody = "";
      try {
        res = await fetch("/api/paste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: payload,
            ttl: selectedTtl,
            encrypted: isE2ee,
          }),
          signal: controller.signal,
        });
        responseBody = await res.text();
      } catch {
        // Network failure previously threw past the handler, leaving the Save
        // button stuck disabled with no explanation.
        fail(
          controller.signal.aborted
            ? "Save timed out. Your text is still here; the server may have saved it. Check your connection before trying again."
            : "Network error — paste not saved. Check your connection.",
        );
        return;
      } finally {
        clearTimeout(uploadTimeout);
      }

      if (!res.ok) {
        let message = "Failed to save paste.";
        try {
          const error = JSON.parse(responseBody);
          if (typeof error?.error === "string") message = error.error;
        } catch {}
        fail(message);
        return;
      }

      let data: { id?: string; deleteToken?: string };
      try {
        data = JSON.parse(responseBody);
        if (
          !data ||
          typeof data.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(data.id)
        ) {
          fail("Invalid server response: missing paste ID. Try saving again.");
          return;
        }
      } catch {
        fail("Invalid server response. Try saving again.");
        return;
      }
      if (data.id) {
        if (data.deleteToken) {
          try {
            localStorage.setItem(`px0_del_${data.id}`, data.deleteToken);
          } catch {}
        }
        // Preserve edits made while the request was in flight.
        if (textarea.value === text) {
          clearTimeout(draftTimer);
          draftDirty = false;
          try {
            localStorage.removeItem("px0_draft");
          } catch {}
          if (draftContainer) draftContainer.innerHTML = "";
          showDraftStatus("Paste saved");
        }
        setSaveBusy(null);

        const pasteUrl = `/${data.id}${
          secretKeyBase64 ? `#${secretKeyBase64}` : ""
        }`;

        const modeType = isE2ee ? "e2ee" : "plaintext";

        showSuccessModal(pasteUrl, selectedTtl === "burn", modeType, ttlLabel);
      } else {
        fail("Invalid server response: missing paste ID.");
      }
    });
  }
}

// Displays the paste result as a focused, high-contrast, centered modal card
import { sanitizeHtml } from "../utils";

function escapeHtmlAttr(s: string): string {
  return sanitizeHtml(s);
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
    mode === "e2ee" ? `${lockIcon} Encrypted` : `${globeSvg} Plaintext`;

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
          <strong>One-time view only:</strong> Revealing this paste permanently deletes it. Send the link to your recipient before revealing it yourself.
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
  const form = document.getElementById("pasteForm");
  if (form) form.inert = true;

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
    if (form) form.inert = false;
    document.removeEventListener("keydown", handleKeydown);
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      if (
        previousActiveElement &&
        typeof previousActiveElement.focus === "function" &&
        (document.activeElement === document.body ||
          overlay.contains(document.activeElement))
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
    } else {
      if (copyText) copyText.textContent = "Select & copy";
      copyBtn?.setAttribute(
        "title",
        "Copy failed. Select the link and copy it manually.",
      );
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
    closeModal();
    window.dispatchEvent(new Event("px0:new-paste"));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanding);
} else {
  initLanding();
}
