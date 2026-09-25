// Centralized CSS custom properties — Obsidian is the only theme.
export const CSS_VARIABLES = `
  :root, [data-theme="obsidian"] {
    color-scheme: dark;

    --bg: #050505;
    --bg-radial: #0c0b10;
    --surface: #0c0b10;
    --surface-hi: #14141b;
    --header-bg: rgba(10, 10, 14, 0.82);

    --border: rgba(255, 255, 255, 0.1);
    --border-hover: rgba(255, 255, 255, 0.22);

    --text: #f5f3ee;
    --text-muted: #a8a49a;
    --text-dim: #7d7a72;
    --text-accent: #d29922;
    --text-sub-accent: #d29922;

    /* Semantic accents for Obsidian */
    --amber: #d29922;
    --amber-fill: rgba(210, 153, 34, 0.12);
    --amber-line: rgba(210, 153, 34, 0.35);
    --amber-glow: rgba(210, 153, 34, 0.25);

    --green: #3fb950;
    --green-fill: rgba(63, 185, 80, 0.12);
    --green-line: rgba(63, 185, 80, 0.3);

    --blue: #58a6ff;
    --blue-fill: rgba(88, 166, 255, 0.12);
    --blue-line: rgba(88, 166, 255, 0.35);

    --red: #f85149;
    --red-fill: rgba(248, 81, 73, 0.12);
    --red-line: rgba(248, 81, 73, 0.35);

    --code-bg: #141219;
    --modal-bg: #0c0b10;
    --modal-input-bg: #14141b;
    --modal-shadow: rgba(0, 0, 0, 0.65);
    --brand-text: #f5f3ee;

    /* Syntax highlighting tokens */
    --sh-keyword: #ff79c6;
    --sh-string: #e6db74;
    --sh-comment: #6272a4;
    --sh-number: #bd93f9;
    --sh-identifier: #50fa7b;
    --sh-sign: #8be9fd;

    --radius: 8px;
    --radius-sm: 6px;
    --radius-lg: 28px;

    --serif: "Charter", "Bitstream Charter", "Sitka Text", "Cambria", Georgia, serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --sans: "Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --control-h: 32px;
  }
`;

// Common resets, background gradient, header/footer chrome, buttons and badges
export const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  html {
    min-height: 100%;
    background-color: var(--bg);
    background-image:
      radial-gradient(600px 400px at 15% 10%, rgba(139, 92, 246, 0.14), transparent),
      radial-gradient(700px 500px at 85% 20%, rgba(16, 185, 129, 0.1), transparent),
      radial-gradient(800px 600px at 50% 100%, rgba(217, 153, 34, 0.08), transparent);
    color: var(--text);
    font-family: var(--sans);
    -webkit-font-smoothing: antialiased;
  }

  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background-color: transparent;
    color: inherit;
  }

  /* Film grain — fixed, non-scrolling, pointer-transparent. */
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
    opacity: 0.05;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.85'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
  }

  /* One visible focus treatment for every interactive element. */
  :focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 2px;
  }

  /* Visually-hidden headings for screen-reader landmarks. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Kills the 300ms double-tap-zoom delay on every control. */
  button, a, input, label, .ttl-option { touch-action: manipulation; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* Floating glass pills — the only header/footer chrome. */
  header, .footer-bar {
    background: var(--header-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.55rem 0.5rem 1.2rem;
    gap: 0.6rem;
    flex-shrink: 0;
    z-index: 10;
    width: calc(100% - 2rem);
    max-width: 76rem;
    margin-left: auto;
    margin-right: auto;
    border: 1px solid var(--border);
    border-radius: 999px;
  }

  header {
    position: sticky;
    top: 0.9rem;
    min-height: 52px;
    flex-wrap: nowrap;
  }

  .footer-bar {
    position: sticky;
    bottom: 0.9rem;
    min-height: 52px;
    margin-top: auto;
    margin-bottom: 0.9rem;
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }

  .left-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    min-width: 0;
    flex: 1;
  }

  .header-right, .footer-right, .nav-links {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: nowrap;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    header, .footer-bar {
      padding: 0.45rem 0.55rem 0.45rem 0.9rem;
      gap: 0.4rem;
      min-height: 48px;
      width: calc(100% - 1rem);
      border-radius: 1.4rem;
    }
    .left-group, .footer-left {
      gap: 0.4rem;
    }

    .header-right, .footer-right, .nav-links {
      gap: 0.35rem;
    }

    .btn-action {
      width: 30px;
      height: 30px;
    }

    .btn-action svg {
      width: 14px;
      height: 14px;
    }

    .badge {
      padding: 0.2rem 0.45rem;
      font-size: 0.7rem;
      gap: 0.25rem;
    }

    .badge svg {
      width: 12px;
      height: 12px;
    }
  }

  /* Coarse pointers: 30px icon buttons pass WCAG AA (24px) but sit below the
     40px+ comfort zone for thumbs — bump the hit area without changing the
     visual glyph size. Header min-height (48px) still fits. */
  @media (pointer: coarse) {
    .btn-action { width: 40px; height: 40px; }
    .seg-option .badge { min-height: 40px; }
    .px-modal-close { width: 40px; height: 40px; }
  }

  .brand {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    border-radius: var(--radius-sm);
    transition: opacity 0.15s ease;
    flex-shrink: 0;
  }

  .brand:hover { opacity: 0.85; }

  /* Icon button — circular ghost, one behaviour everywhere. Round because it
     lives inside pill bars; square buttons clashed with the round chrome. */
  .btn-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-h);
    height: var(--control-h);
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: 50%;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    flex-shrink: 0;
  }

  .btn-action:hover {
    color: var(--amber);
    background: var(--amber-fill);
    border-color: transparent;
  }

  .btn-action:active { transform: scale(0.94); }

  .btn-action svg {
    width: 15px;
    height: 15px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.2;
    pointer-events: none;
  }

  .btn-action.active {
    background: var(--amber-fill);
    border-color: var(--amber-line);
    color: var(--amber);
  }

  .btn-action.copied,
  .code-copy-btn.copied {
    color: var(--green);
    background: var(--green-fill);
    border-color: var(--green-line);
  }

  /* Primary action — flat amber pill. No gradient or glow: the bar is glass,
     the button is the single solid object in it. */
  .btn-save {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 44px;
    background: var(--amber);
    color: #14100a;
    font-weight: 700;
    font-size: 0.85rem;
    padding: 0 1.25rem;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition: filter 0.15s ease, transform 0.15s ease;
  }

  .btn-save:hover:not(:disabled) { filter: brightness(1.1); }

  .btn-save:active:not(:disabled) { transform: scale(0.97); }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: progress;
    box-shadow: none;
  }

  .btn-save svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.4;
    flex-shrink: 0;
  }

  /* Status badges — colour, fill and border always come from the same token. */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-radius: 7px;
    font-size: 0.74rem;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    border: 1px solid transparent;
    white-space: nowrap;
    transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, filter 0.2s ease;
  }

  /* One size for every badge glyph. The icons carry their own width/height
     attributes and disagreed — flameSvg is authored at 24px and rendered
     nearly twice the height of its own badge text. */
  .badge svg { width: 13px; height: 13px; flex-shrink: 0; }

  /* Semantic badge variants. Text, fill and border are always drawn from the
     same colour token — .badge-public previously mixed amber text with blue
     chrome. */
  .badge-encrypted { color: var(--green); background: var(--green-fill); border-color: var(--green-line); }
  .badge-public    { color: var(--blue);  background: var(--blue-fill);  border-color: var(--blue-line); }
  .badge-ttl       { color: var(--amber); background: var(--amber-fill); border-color: var(--amber-line); }
  .badge-burn-once,
  .badge-expired   { color: var(--red);   background: var(--red-fill);   border-color: var(--red-line); }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.22); }

  /* Truncation guards so a 320px-wide footer ellipsizes instead of pushing
     Save off-screen. NOTE: .footer-left must stay overflow:visible — the
     TTL menu opens upward out of it and overflow:hidden would clip it. */
  #charCount {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .save-error {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 420px) {
    .ttl-trigger-label {
      max-width: 64px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
`;

// Shared Markdown typography and syntax highlighting styles
export const MARKDOWN_CSS = `
  ::selection {
    background-color: rgba(210, 153, 34, 0.35);
    color: var(--text);
  }

  .markdown-body, .preview-pane {
    font-family: var(--serif);
    line-height: 1.75;
    font-size: 1.1rem;
    color: var(--text);
  }

  .markdown-body > :first-child, .preview-pane > :first-child { margin-top: 0; }

  /* Solid ink headings with a fading underline — one treatment, every level. */
  .markdown-body :is(h1, h2, h3, h4, h5, h6),
  .preview-pane :is(h1, h2, h3, h4, h5, h6) {
    color: var(--text);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .markdown-body h1, .preview-pane h1 { font-size: 2.1rem; font-weight: 700; margin: 1.75rem 0 1rem; }
  .markdown-body h2, .preview-pane h2 { font-size: 1.6rem; font-weight: 600; margin: 1.5rem 0 0.85rem; }
  .markdown-body h3, .preview-pane h3 { font-size: 1.3rem; font-weight: 600; margin: 1.25rem 0 0.75rem; }
  .markdown-body h4, .preview-pane h4 { font-size: 1.1rem; font-weight: 600; margin: 1.1rem 0 0.6rem; }
  .markdown-body h5, .preview-pane h5 { font-size: 0.95rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .markdown-body h6, .preview-pane h6 { font-size: 0.95rem; font-weight: 600; margin: 1rem 0 0.5rem; }

  .markdown-body strong, .preview-pane strong { font-weight: 700; }
  .markdown-body em, .preview-pane em { font-style: italic; }

  .markdown-body p, .preview-pane p { margin-bottom: 1.1rem; word-break: break-word; }
  .markdown-body ul, .markdown-body ol, .preview-pane ul, .preview-pane ol { margin: 0.75rem 0 1.1rem 1.75rem; }
  .markdown-body li, .preview-pane li { margin-bottom: 0.35rem; }
  /* Nested lists shouldn't inherit the outer list's bottom margin. */
  .markdown-body li > ul, .markdown-body li > ol,
  .preview-pane li > ul, .preview-pane li > ol { margin: 0.35rem 0 0.35rem 1.25rem; }

  /* Paper & Ink Blockquotes & Nested Levels */
  .markdown-body blockquote, .preview-pane blockquote {
    border-left: 3px solid var(--amber);
    background: var(--amber-fill);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: 0.6rem 1rem;
    color: var(--text);
    margin: 1rem 0;
  }

  .markdown-body blockquote blockquote, .preview-pane blockquote blockquote {
    border-left-color: var(--text-sub-accent);
    background: var(--red-fill);
  }

  .markdown-body blockquote blockquote blockquote, .preview-pane blockquote blockquote blockquote {
    border-left-color: var(--amber);
    background: var(--amber-fill);
  }

  /* Quiet hairline rule. */
  .markdown-body hr, .preview-pane hr {
    height: 1px;
    border: none;
    margin: 2rem 0;
    background: var(--border-hover);
  }

  .markdown-body a, .preview-pane a { color: var(--amber); text-decoration: none; text-underline-offset: 3px; word-break: break-word; transition: color 0.2s ease; }
  .markdown-body a:hover, .preview-pane a:hover { color: var(--amber); text-decoration: underline; filter: brightness(1.25); }
  .markdown-body del, .preview-pane del { color: var(--text-muted); }

  /* GFM tables — token borders, amber-tinted headers. */
  .markdown-body table, .preview-pane table {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 0.94rem;
  }

  .markdown-body th, .markdown-body td,
  .preview-pane th, .preview-pane td {
    border: 1px solid var(--border-hover);
    padding: 0.5rem 0.85rem;
    text-align: left;
  }

  .markdown-body th, .preview-pane th {
    background: var(--amber-fill);
    color: var(--amber);
    font-weight: 600;
  }

  .markdown-body tbody tr:nth-child(even),
  .preview-pane tbody tr:nth-child(even) {
    background: rgba(255, 255, 255, 0.02);
  }

  .markdown-body img, .preview-pane img {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius);
    display: block;
    margin: 1rem 0;
  }

  /* GFM task lists with bounce animation */
  .markdown-body li:has(> input[type="checkbox"]),
  .preview-pane li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.25rem; }

  .markdown-body input[type="checkbox"], .preview-pane input[type="checkbox"] {
    appearance: none;
    width: 15px;
    height: 15px;
    margin-right: 0.5rem;
    vertical-align: -2px;
    border: 1px solid var(--border-hover);
    border-radius: 4px;
    background: var(--bg);
    position: relative;
  }

  .markdown-body input[type="checkbox"]:checked, .preview-pane input[type="checkbox"]:checked {
    background: var(--amber);
    border-color: var(--amber);
    animation: px-check-bounce 0.25s ease;
  }

  @keyframes px-check-bounce {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(0.88); }
  }

  .markdown-body input[type="checkbox"]:checked::after,
  .preview-pane input[type="checkbox"]:checked::after {
    content: "";
    position: absolute;
    left: 4px;
    top: 1px;
    width: 4px;
    height: 8px;
    border: solid var(--bg);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .markdown-body pre, .preview-pane pre {
    position: relative;
    background: var(--code-bg);
    border: 1px solid var(--border);
    padding: 1.25rem 1.5rem;
    border-radius: 10px;
    overflow-x: auto;
    margin: 1.25rem 0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }

  .code-copy-btn {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
  }

  .markdown-body pre:hover .code-copy-btn,
  .code-copy-btn:focus-visible { opacity: 1; }

  /* A phone has no hover, so revealing this on :hover meant it was drawn at
     opacity 0 forever — present and tappable, but invisible. Coarse pointers
     get it permanently, at a size a thumb can actually hit. */
  @media (hover: none) {
    .code-copy-btn { opacity: 0.7; width: 34px; height: 34px; }
  }

  .code-copy-btn:hover {
    color: var(--amber);
    border-color: var(--amber-line);
    background: var(--amber-fill);
  }

  .code-copy-btn.copied { opacity: 1; }

  .code-copy-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  .markdown-body code, .preview-pane code {
    font-family: var(--mono);
    font-size: 0.92rem;
  }

  .markdown-body :not(pre) > code, .preview-pane :not(pre) > code {
    background: var(--amber-fill);
    border: 1px solid var(--amber-line);
    padding: 0.15rem 0.4rem;
    border-radius: 5px;
    color: var(--amber);
    word-break: break-word;
  }

  .sh__token--keyword { color: var(--sh-keyword); font-weight: 600; }
  .sh__token--string { color: var(--sh-string); }
  .sh__token--comment { color: var(--sh-comment); font-style: italic; }
  .sh__token--number { color: var(--sh-number); }
  .sh__token--identifier { color: var(--sh-identifier); }
  .sh__token--sign { color: var(--sh-sign); }
`;

// Landing page editor, live split preview, footer bar and share banner
export const LANDING_CSS = `
  body { overflow: hidden; }

  /* Plaintext/E2EE segmented control with a sliding thumb. Two radios, one
     name — the browser keeps them mutually exclusive, and the :checked
     styles show the choice, so no JS label sync is needed. Unselected side
     stays a dim ghost; only the thumb side lights up. Monochrome until
     E2EE is chosen, which earns the amber. */
  .mode-seg {
    position: relative;
    display: flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    flex-shrink: 0;
  }

  .mode-seg::before {
    content: "";
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.09);
    border: 1px solid var(--border-hover);
    transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .mode-seg:has(#e2eeToggle:checked)::before { transform: translateX(100%); }

  .seg-option {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    cursor: pointer;
  }

  /* 1px rather than 0 — a zero-sized control drops out of the accessibility
     tree in Chrome, hiding the mode switch from screen readers. */
  .seg-option input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .seg-option .badge {
    background: transparent;
    border: 0;
    border-radius: 0;
    width: 100%;
    justify-content: center;
    min-height: 40px;
    opacity: 0.45;
    transition: opacity 0.2s ease, color 0.2s ease;
  }

  .mode-seg:has(#modePlaintext:checked) .seg-option:first-child .badge {
    opacity: 1;
    color: var(--text);
  }

  .mode-seg:has(#e2eeToggle:checked) .seg-option:last-child .badge {
    opacity: 1;
    color: var(--amber);
  }

  .seg-option input:focus-visible + .badge { outline: 2px solid var(--amber); outline-offset: -2px; }

  .ttl-dropdown { position: relative; }

  .ttl-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: var(--control-h);
    min-height: 40px;
    background-color: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 0.75rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  }

  .ttl-trigger svg { transition: transform 0.2s ease; }
  .ttl-trigger.open svg { transform: rotate(180deg); }

  .ttl-trigger:hover, .ttl-trigger.open {
    background-color: var(--amber-fill);
    border-color: var(--amber-line);
    color: var(--amber);
  }

  .ttl-menu {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    z-index: 50;
    min-width: 11rem;
    padding: 0.3rem;
    list-style: none;
    background: var(--surface);
    border: 1px solid rgba(210, 153, 34, 0.3);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    overscroll-behavior: contain;
  }

  .ttl-menu[hidden] { display: none; }

  /* The TTL control lives in the bottom pill now, so the menu opens upward. */
  .ttl-menu-up {
    top: auto;
    bottom: calc(100% + 0.4rem);
  }
  .ttl-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem;
    min-height: 40px;
    border-radius: 5px;
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .ttl-option:hover { background: rgba(255, 255, 255, 0.06); color: var(--text); }
  .ttl-option.selected { color: var(--amber); }

  /* Every other row is a duration; this one is a one-shot destructive mode.
     Rendered identically, it read as "some very short expiry". */
  .ttl-option[data-ttl="burn"] {
    color: var(--red);
    margin-bottom: 0.3rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid var(--border);
    border-radius: 5px 5px 0 0;
  }

  .ttl-option[data-ttl="burn"]:hover { color: var(--red); background: var(--red-fill); }
  .ttl-option[data-ttl="burn"] .ttl-check { color: var(--red); }

  .ttl-check { display: inline-flex; width: 14px; visibility: hidden; color: var(--amber); }
  .ttl-option.selected .ttl-check { visibility: visible; }

  #pasteForm {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .editor-container {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }

  textarea {
    width: 100%;
    height: 100%;
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--mono);
    font-size: 0.98rem;
    line-height: 1.7;
    padding: 1.75rem 2rem;
    resize: none;
  }

  textarea::placeholder { color: var(--text-dim); }

  /* The editor is the primary surface and is auto-focused on load. The
     global :focus-visible outline drew a stray amber box around its
     content-height box (only the bottom edge visible, full-width). The
     blinking caret is the focus indicator here, as in any code editor. */
  textarea:focus { outline: none; }

  .preview-pane {
    display: none;
    height: 100%;
    padding: 1.75rem 2.5rem;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    border-left: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.2);
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .editor-container.split-active textarea,
  .editor-container.split-active .preview-pane {
    display: block;
    flex: 1 1 50%;
    width: 50%;
    max-width: 50%;
    min-width: 0;
  }

  .stats-label {
    font-size: 0.78rem;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }

  /* Inline save error, replaces the old blocking alert(). */
  .save-error {
    font-size: 0.78rem;
    font-family: var(--mono);
    color: var(--red);
  }

  .save-error:empty { display: none; }

  /* Centered Modal Dialog for Post-Save Flow */
  .px-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background: rgba(10, 12, 16, 0.78);
    backdrop-filter: blur(12px);
    overscroll-behavior: contain;
    -webkit-backdrop-filter: blur(12px);
    animation: px-fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .px-modal-overlay.closing {
    animation: px-fade-out 0.15s ease forwards;
  }

  @keyframes px-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes px-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  .px-modal-card {
    position: relative;
    width: 100%;
    max-width: 520px;
    background: var(--modal-bg);
    border: 1px solid var(--border-hover);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    box-shadow: 0 20px 50px var(--modal-shadow), 0 0 0 1px var(--border);
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    animation: px-card-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .px-modal-overlay.closing .px-modal-card {
    animation: px-card-shrink 0.15s ease forwards;
  }

  @keyframes px-card-pop {
    from { opacity: 0; transform: scale(0.94) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  @keyframes px-card-shrink {
    from { opacity: 1; transform: scale(1); }
    to { opacity: 0; transform: scale(0.95); }
  }

  .px-modal-card.is-burn {
    border-color: rgba(248, 81, 73, 0.45);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 25px rgba(248, 81, 73, 0.15);
  }

  .px-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .px-modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .px-modal-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--amber-fill);
    border: 1px solid var(--amber-line);
    color: var(--amber);
    flex-shrink: 0;
  }

  .px-modal-card.is-burn .px-modal-icon {
    background: var(--red-fill);
    border-color: var(--red-line);
    color: var(--red);
  }

  .px-modal-icon svg {
    width: 17px;
    height: 17px;
  }

  .px-modal-title {
    font-size: 1.12rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0;
  }

  .px-modal-close {
    width: 30px;
    height: 30px;
  }

  .px-modal-badges {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .badge-ttl {
    background: var(--blue-fill);
    border-color: var(--blue-line);
    color: var(--blue);
  }

  .px-modal-link-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--modal-input-bg);
    border: 1px solid var(--border-hover);
    border-radius: var(--radius);
    padding: 0.35rem 0.35rem 0.35rem 0.85rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .px-modal-link-box:focus-within {
    border-color: var(--amber);
    box-shadow: 0 0 0 2px var(--amber-glow);
  }

  .px-modal-card.is-burn .px-modal-link-box:focus-within {
    border-color: var(--red);
    box-shadow: 0 0 0 2px rgba(248, 81, 73, 0.25);
  }

  .px-modal-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--mono);
    font-size: 0.88rem;
    text-overflow: ellipsis;
  }

  .px-modal-copy-btn {
    height: 34px;
    padding: 0 1rem;
    font-weight: 600;
    font-size: 0.84rem;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .px-modal-burn-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: var(--red-fill);
    border: 1px solid var(--red-line);
    border-radius: var(--radius);
    color: var(--red);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .px-burn-warn-icon {
    flex-shrink: 0;
    color: var(--red);
    margin-top: 1px;
  }

  .px-burn-warn-icon svg {
    width: 18px;
    height: 18px;
  }

  .px-burn-warn-text {
    flex: 1;
    color: var(--text);
  }

  .px-burn-warn-text strong {
    color: var(--red);
    display: block;
    margin-bottom: 2px;
  }

  .px-modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.25rem;
  }

  .px-modal-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    height: 34px;
    padding: 0 0.95rem;
    font-size: 0.82rem;
    font-weight: 500;
    width: auto;
  }

  .px-modal-done {
    background: var(--surface-hi);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .px-modal-done:hover {
    background: var(--border-hover);
    color: var(--text);
  }

  /* Success flash animation when copied */
  .btn-save.copied,
  .btn-action.copied {
    background: var(--green-fill) !important;
    color: var(--green) !important;
    border-color: var(--green-line) !important;
    box-shadow: none !important;
  }

  .draft-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    font-family: var(--mono);
    color: var(--amber);
    background: var(--amber-fill);
    border: 1px solid var(--amber-line);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    animation: px-fade-in 0.2s ease;
  }

  .draft-discard {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    font-size: inherit;
    padding: 0.5rem 0.35rem;
    margin: -0.5rem -0.35rem -0.5rem 0.2rem;
    min-height: 40px;
    transition: color 0.15s ease;
  }

  .draft-discard:hover { color: var(--red); }

  @media (max-width: 767px) {
    textarea, .preview-pane { padding: 1.25rem 1rem; }

    .editor-container.split-active { flex-direction: column; }
    .editor-container.split-active textarea,
    .editor-container.split-active .preview-pane {
      width: 100%;
      max-width: 100%;
      height: 50%;
      flex: 1 1 50%;
    }
    .editor-container.split-active .preview-pane {
      border-left: none;
      border-top: 1px solid var(--border);
    }
  }

  @media (max-width: 640px) {
    .editor-container.split-active textarea {
      display: none !important;
    }
    .editor-container.split-active .preview-pane {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: 100% !important;
      flex: 1 1 100% !important;
      border-left: none !important;
      border-top: none !important;
    }
  }

  @media (max-width: 520px) {
    .px-modal-card {
      padding: 1.2rem;
      gap: 0.95rem;
    }

    .px-modal-link-box {
      flex-direction: column;
      align-items: stretch;
      padding: 0.5rem;
      gap: 0.5rem;
    }

    .px-modal-input {
      padding: 0.35rem 0.5rem;
      font-size: 0.82rem;
    }

    .px-modal-copy-btn {
      width: 100%;
    }

    .px-modal-actions {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .px-modal-btn {
      justify-content: center;
      width: 100%;
    }

    .footer-bar { row-gap: 0.6rem; }

    /* Two-row footer: seg + Save on row one, TTL + split + inline counter
       on row two. display:contents dissolves the two wrapper divs so each
       control orders individually; the counter never gets its own row. */
    .footer-left, .footer-right { display: contents; }
    .mode-seg { order: 1; flex: 1 1 auto; }
    #saveBtn { order: 2; flex: 0 0 auto; }
    .ttl-dropdown { order: 3; }
    #btnSplit { order: 4; }
    #charCount {
      order: 5;
      flex: 1 1 auto;
      text-align: right;
      font-size: 0.7rem;
    }
    #draftContainer, #saveError { order: 6; flex-basis: 100%; }
    #draftContainer:empty { display: none; }
  }
`;

// Viewer page layout and the E2EE unlock card
export const VIEWER_CSS = `
  .btn-delete {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 40px;
    background: transparent;
    color: var(--red);
    font-weight: 600;
    font-size: 0.82rem;
    padding: 0 1rem;
    border: 1px solid var(--red-line);
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .btn-delete:hover {
    background: var(--red-fill);
  }

  .btn-delete:active { transform: scale(0.97); }

  .btn-delete.armed {
    background: var(--red);
    color: #0d1117;
    border-color: var(--red);
  }

  .btn-delete svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.4;
  }

  main.viewer-container {
    flex: 1;
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .viewer-body {
    flex: 1;
    padding: 2.25rem 2.75rem;
    max-width: 1120px;
    width: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  #output {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .viewer-msg {
    color: var(--text-muted);
    font-style: italic;
  }

  .viewer-msg.is-error {
    color: var(--red);
    font-style: normal;
    font-weight: 600;
  }

  .unlock-card-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1;
    width: 100%;
    padding: 2rem 1rem;
  }

  .unlock-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 22px;
    max-width: 440px;
    width: 100%;
    padding: 2.25rem 2rem;
    text-align: center;
    box-shadow: 0 20px 50px var(--modal-shadow);
  }

  .unlock-icon-container {
    width: 52px;
    height: 52px;
    background: radial-gradient(circle, rgba(210, 153, 34, 0.25) 0%, rgba(210, 153, 34, 0.08) 100%);
    border: 1px solid var(--amber-line);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1.25rem;
    color: var(--amber);
  }

  .unlock-icon-container svg { width: 22px; height: 22px; }

  .unlock-title {
    font-size: 1.35rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
    letter-spacing: -0.02em;
  }

  .unlock-subtitle {
    color: var(--text-muted);
    font-size: 0.88rem;
    margin-bottom: 1.75rem;
    line-height: 1.5;
  }

  .unlock-form-row { display: flex; gap: 0.5rem; }

  .unlock-input {
    flex: 1;
    min-width: 0;
    background: var(--modal-input-bg);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--mono);
    font-size: 0.9rem;
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius);
    outline: none;
    transition: border-color 0.2s ease;
  }

  .unlock-input:focus { border-color: var(--amber); }

  .btn-unlock-submit {
    background: var(--amber);
    border: none;
    color: #14100a;
    font-weight: 700;
    font-size: 0.88rem;
    padding: 0.7rem 1.2rem;
    border-radius: 999px;
    cursor: pointer;
    transition: filter 0.2s ease, transform 0.2s ease;
  }

  .btn-unlock-submit:hover { filter: brightness(1.1); }
  .btn-unlock-submit:active { transform: scale(0.97); }
  .btn-unlock-submit:disabled { opacity: 0.5; cursor: progress; filter: none; transform: none; }

  .unlock-err-msg {
    color: var(--red);
    font-size: 0.84rem;
    margin-top: 1rem;
    font-family: var(--mono);
    min-height: 1.2rem;
  }

  @media (max-width: 767px) {
    .viewer-body { padding: 1.5rem 1.25rem; }
  }
`;

// Borderless, ultra-minimal 404 page styles
export const NOT_FOUND_CSS = `
  body {
    background-image: radial-gradient(circle at 50% 30%, #101014 0%, #050505 80%);
  }

  .not-found-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.25rem;
    text-align: center;
  }

  .status-code {
    font-family: var(--mono);
    font-size: 5rem;
    font-weight: 800;
    line-height: 1;
    color: var(--amber);
    letter-spacing: -0.06em;
    text-shadow: 0 0 32px var(--amber-glow);
    margin-bottom: 0.75rem;
  }

  .not-found-title {
    font-size: 1.35rem;
    font-weight: 600;
    margin: 1.25rem 0 0.5rem;
  }

  .not-found-subtitle {
    font-size: 0.9rem;
    color: var(--text-muted);
    max-width: 380px;
    line-height: 1.5;
  }
`;
