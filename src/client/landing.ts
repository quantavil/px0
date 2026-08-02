import {
  copyIcon,
  flameSvg,
  globeSvg,
  linkIcon,
  lockIcon,
  plusIcon,
} from "../icons";
import {
  bytesToBase64Url,
  copyToClipboard,
  deriveKeyFromPassword,
  flashCopied,
  generate8CharPassword,
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
  const toggleLabel = document.getElementById(
    "toggleLabel",
  ) as HTMLSpanElement | null;
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

  const btnPassModal = document.getElementById(
    "btnPassModal",
  ) as HTMLButtonElement | null;
  const inlinePassBar = document.getElementById(
    "inlinePassBar",
  ) as HTMLDivElement | null;
  const inlinePassInput = document.getElementById(
    "inlinePassInput",
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

  // The footer badge must state what actually happens to the payload. A
  // password-protected paste is encrypted (PBKDF2 + AES-GCM), so labelling it
  // "Plaintext" — as this did — misrepresents the security of the paste.
  const MODES = {
    e2ee: {
      html: `${lockIcon} E2EE`,
      cls: "badge badge-encrypted",
      title: "Zero-knowledge encrypted: the key never leaves your browser",
    },
    password: {
      html: `${lockIcon} Password`,
      cls: "badge badge-encrypted",
      title: "Encrypted with your password (PBKDF2 + AES-GCM)",
    },
    plaintext: {
      html: `${globeSvg} Plaintext`,
      cls: "badge badge-public",
      title: "Stored unencrypted — anyone with the link can read it",
    },
  } as const;

  function setToggleLabel(mode: keyof typeof MODES) {
    if (!toggleLabel) return;
    const m = MODES[mode];
    toggleLabel.innerHTML = m.html;
    toggleLabel.className = m.cls;
    toggleLabel.title = m.title;
  }

  const currentPassword = () => inlinePassInput?.value.trim() ?? "";

  // Remembered across a password on/off cycle: forcing the toggle back to E2EE
  // when the password is cleared silently overrode a deliberate Plaintext pick.
  let wantsE2ee = true;

  function syncPasswordState() {
    if (!e2eeToggle) return;

    if (currentPassword().length > 0) {
      // Password mode supersedes the E2EE/plaintext choice.
      e2eeToggle.checked = false;
      e2eeToggle.disabled = true;
      setToggleLabel("password");
    } else {
      e2eeToggle.disabled = false;
      e2eeToggle.checked = wantsE2ee;
      setToggleLabel(wantsE2ee ? "e2ee" : "plaintext");
    }
  }

  if (btnPassModal && inlinePassBar) {
    const copyPassBtn = document.getElementById(
      "copyPassBtn",
    ) as HTMLButtonElement | null;

    btnPassModal.addEventListener("click", () => {
      const isVisible = inlinePassBar.classList.contains("visible");

      btnPassModal.setAttribute("aria-pressed", String(!isVisible));

      if (isVisible) {
        // Toggle OFF: Disable password protection, collapse bar, clear password, remove active highlight
        btnPassModal.classList.remove("active");
        inlinePassBar.classList.remove("visible");
        if (inlinePassInput) inlinePassInput.value = "";
        syncPasswordState();
      } else {
        // Toggle ON: Enable password protection, expand bar, add active highlight
        btnPassModal.classList.add("active");
        inlinePassBar.classList.add("visible");
        if (inlinePassInput && !inlinePassInput.value.trim()) {
          inlinePassInput.value = generate8CharPassword();
          copyToClipboard(inlinePassInput.value);
          flashCopied(copyPassBtn);
        }
        syncPasswordState();
        if (inlinePassInput) {
          inlinePassInput.focus();
          inlinePassInput.select();
        }
      }
    });

    // Manually copy the password via the copy button
    copyPassBtn?.addEventListener("click", () => {
      if (inlinePassInput?.value) {
        copyToClipboard(inlinePassInput.value);
        flashCopied(copyPassBtn);
      }
    });
  }

  if (inlinePassInput) {
    inlinePassInput.addEventListener("input", syncPasswordState);
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

  if (e2eeToggle) {
    e2eeToggle.addEventListener("change", () => {
      wantsE2ee = e2eeToggle.checked;
      setToggleLabel(wantsE2ee ? "e2ee" : "plaintext");
    });
  }

  function updateStats() {
    if (!textarea || !charCount) return;
    const val = textarea.value || "";
    const lines = val ? val.split("\n").length : 0;
    const chars = val.length;
    charCount.textContent = `›_ ${lines} lines (${chars} chars)`;

    if (editorContainer?.classList.contains("split-active")) {
      scheduleLivePreview();
    }
  }

  if (textarea) {
    textarea.addEventListener("input", updateStats);
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
      }
    });
  }

  const form = document.getElementById("pasteForm") as HTMLFormElement | null;
  const saveError = document.getElementById(
    "saveError",
  ) as HTMLSpanElement | null;

  if (form) {
    // The Save button advertises Ctrl+S; actually wire it up.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!textarea || !e2eeToggle) return;

      const saveBtn = document.getElementById(
        "saveBtn",
      ) as HTMLButtonElement | null;

      const fail = (msg: string) => {
        if (saveError) saveError.textContent = msg;
        if (saveBtn) saveBtn.disabled = false;
      };

      if (saveError) saveError.textContent = "";
      if (!textarea.value.trim()) {
        fail("Nothing to save — the editor is empty.");
        textarea.focus();
        return;
      }
      if (saveBtn) saveBtn.disabled = true;

      const text = textarea.value;
      const isE2ee = e2eeToggle.checked;
      const selectedTtl = ttlInput ? ttlInput.value : "30d";
      const passwordVal = currentPassword();

      let payload = text;
      let secretKeyBase64 = "";

      if (passwordVal.length > 0) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cryptoKey = await deriveKeyFromPassword(passwordVal, salt);
        const encodedText = new TextEncoder().encode(text);
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          cryptoKey,
          encodedText,
        );

        payload = `__PX0_PASS__:${bytesToBase64Url(salt)}:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`;
      } else if (isE2ee) {
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
        payload = `__PX0_ENC__:${bytesToBase64Url(combined)}`;
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

      const data = (await res.json()) as { id: string };
      if (data.id) {
        if (saveBtn) saveBtn.disabled = false;

        const shareUrl = `/${data.id}${
          secretKeyBase64 && passwordVal.length === 0
            ? `#${secretKeyBase64}`
            : ""
        }`;

        // Every creation flow (burn, password, E2EE, TTL) shows the same share
        // overlay instead of redirecting. Keeps the UX consistent, and a burn
        // paste is never consumed by the creator's own redirect.
        showShareLink(shareUrl, selectedTtl === "burn");
      }
    });
  }
}

// Shows the share link as a banner row inserted directly under the header.
// It deliberately carries no overlay/modal class: an earlier version also
// applied `.share-overlay` (position: fixed; inset: 0; backdrop-filter: blur),
// which turned this into a full-screen sheet that blurred and blocked the
// entire editor behind it.
function showShareLink(url: string, isBurn: boolean) {
  const fullUrl = window.location.origin + url;
  const icon = isBurn ? flameSvg : linkIcon;
  const title = isBurn ? "Burn paste ready" : "Paste created";

  document.getElementById("headerShareBanner")?.remove();

  const banner = document.createElement("div");
  banner.id = "headerShareBanner";
  banner.className = `header-share-banner${isBurn ? " is-burn" : ""}`;
  banner.innerHTML = `
    <span class="share-banner-badge">${icon} ${title}</span>
    <input type="text" id="shareUrl" readonly value="${fullUrl}" aria-label="Share link">
    <button type="button" id="copyShareBtn" class="btn-save" title="Copy link to clipboard">
      ${copyIcon}
      <span id="copyShareLabel">Copy Link</span>
    </button>
    <button type="button" id="createNewBtn" class="btn-action" title="Create another paste">
      ${plusIcon}
    </button>
  `;

  const header = document.querySelector("header");
  header?.parentNode
    ? header.parentNode.insertBefore(banner, header.nextSibling)
    : document.body.insertBefore(banner, document.body.firstChild);

  const urlInput = document.getElementById(
    "shareUrl",
  ) as HTMLInputElement | null;
  urlInput?.select();

  const copyBtn = document.getElementById(
    "copyShareBtn",
  ) as HTMLButtonElement | null;
  const copyLabel = document.getElementById("copyShareLabel");

  copyBtn?.addEventListener("click", () => {
    urlInput?.select();
    copyToClipboard(fullUrl);
    if (copyLabel) copyLabel.textContent = "Copied!";
    setTimeout(() => {
      if (copyLabel) copyLabel.textContent = "Copy Link";
    }, 2000);
  });

  document.getElementById("createNewBtn")?.addEventListener("click", () => {
    window.location.reload();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanding);
} else {
  initLanding();
}
