// Staging comment mode (decision 4 of 15.10), the part every preview page
// loads: the floating «Комментировать» button, bottom right, and «Список N»
// beside it when comments wait in the list. Preview builds only: the
// integration tools/comment-mode.mjs injects `start(conf, loadUi)` into every
// page; production builds contain neither this file nor
// comment-mode-ui.ts (tools/prodcheck.mjs).
//
// The mode itself (outline, form, list, GitHub issue) is
// src/scripts/comment-mode-ui.ts with the class-to-source map; it loads only
// at the first press of a button or of Alt+Shift+C, so a page that nobody
// comments on pays for this file only.
//
// Outside the mode the page has the buttons and one keydown listener
// (Alt+Shift+C): nothing on the page itself changes. No animation anywhere,
// so prefers-reduced-motion has nothing to stop. Under automation
// (navigator.webdriver, e.g. npm run shots) the buttons stay out of the
// screenshots unless the address has ?comment.

export interface Conf {
  marker: string;
  repo: string;
  label: string;
  build: string;
  base: string;
}
export interface CodeMap {
  files: string[];
  /** class -> files whose styles define it (BEM elements fall back to their block) */
  classes: Record<string, number[]>;
  /** scoped-style id (data-astro-cid-<id>) -> the .astro file that rendered the element */
  scopes: Record<string, number>;
  routes: [string, number][];
}
export interface Ui {
  toggle(): void;
  list(): void;
}
type UiModule = { mount(root: ShadowRoot, host: HTMLElement, conf: Conf & CodeMap): Ui };
type LoadUi = () => Promise<[UiModule, { default: CodeMap }]>;

const STYLE = `
:host { all: initial; -webkit-tap-highlight-color: transparent; }
* { box-sizing: border-box; }
.cm { font-family: var(--font-sans, system-ui, sans-serif); font-size: 15px; line-height: 1.35; color: var(--ink, #000); }
.dock { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 24rem; max-width: calc(100vw - 32px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }
.dock > * { pointer-events: auto; }
.row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.btn { font: inherit; font-weight: 700; color: var(--ink, #000); background: var(--paper, #fff); border: 1px solid var(--ink, #000);
  border-radius: 0; margin: 0; padding: 9px 14px; min-height: 44px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.btn[aria-pressed="true"], .btn--primary { background: var(--ink, #000); color: var(--paper, #fff); }
@media (hover: hover) { .btn:hover { background: var(--ink, #000); color: var(--paper, #fff); } .btn--primary:hover { background: var(--paper, #fff); color: var(--ink, #000); } }
.btn:focus-visible { outline: 2px solid var(--ink, #000); outline-offset: 3px; }
.count { font: 13px/1.4 var(--font-mono, ui-monospace, monospace); font-weight: 400; border: 1px solid currentColor; padding: 0 5px; }
[data-open="false"] { display: none !important; }
@media (max-width: 719px) { .dock { left: 16px; right: 16px; width: auto; max-width: none; } }
`;

// outside the shadow root: room under the footer for the buttons
const PAGE_CSS = `
html { scroll-padding-bottom: 84px; }
body::after { content: ""; display: block; height: 84px; }
html[data-commenting], html[data-commenting] * { cursor: crosshair !important; }
`;

const BAR = `
<div class="cm"><div class="dock"><div class="row" data-bar>
  <button type="button" class="btn" data-act="list" aria-expanded="false" aria-controls="cm-list" data-open="false">Список <span class="count" data-f="count">0</span></button>
  <button type="button" class="btn" data-act="toggle" aria-pressed="false" aria-keyshortcuts="Alt+Shift+C" title="Alt+Shift+C">Комментировать</button>
</div></div></div>`;

function waiting(key: string): number {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export function start(conf: Conf, loadUi: LoadUi) {
  if (window.top !== window || document.querySelector('[data-comment-mode]')) return;
  if (navigator.webdriver && !new URLSearchParams(location.search).has('comment')) return;

  const host = document.createElement('div');
  host.setAttribute('data-comment-mode', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>${BAR}`;
  const pageStyle = document.createElement('style');
  pageStyle.textContent = PAGE_CSS;
  document.head.append(pageStyle);
  document.body.append(host);

  const n = waiting(conf.marker);
  const listBtn = root.querySelector('[data-act="list"]') as HTMLButtonElement;
  (root.querySelector('[data-f="count"]') as HTMLElement).textContent = String(n);
  listBtn.setAttribute('data-open', String(n > 0));

  let ui: Promise<Ui> | null = null;
  const ready = () =>
    (ui ??= loadUi().then(([m, map]) => m.mount(root, host, { ...conf, ...map.default })).catch((e) => {
      ui = null;
      throw e;
    }));

  root.querySelector('[data-bar]')!.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('button')?.getAttribute('data-act');
    if (a === 'toggle') void ready().then((u) => u.toggle());
    else if (a === 'list') void ready().then((u) => u.list());
  });
  // the one listener on the page outside the mode: Alt+Shift+C toggles it
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      e.preventDefault();
      void ready().then((u) => {
        u.toggle();
        (root.querySelector('[data-act="toggle"]') as HTMLElement).focus({ preventScroll: true });
      });
    }
  });
}
