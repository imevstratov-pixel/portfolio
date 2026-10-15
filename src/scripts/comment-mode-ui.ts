// Staging comment mode (decision 4 of 15.10), the mode itself. Loaded by
// src/scripts/comment-mode.ts at the first press of «Комментировать»,
// «Список» or Alt+Shift+C; preview builds only (tools/comment-mode.mjs).
//
// While the mode is on:
// - the element under the pointer (or the keyboard focus) gets an outline;
//   a click, a tap or Enter selects it; nothing on the page reacts (links do
//   not open, buttons do not press, details do not toggle); with the
//   keyboard Tab moves between links and buttons, the arrows up and down
//   widen and narrow the choice, left and right go to the neighbours;
// - a small form asks for the comment; «Шире» and «Уже» change the element
//   (on a phone a tap lands on the innermost one); «Отправить» opens a
//   prefilled GitHub issue (label «правка») in a new tab; «В список» keeps
//   it, and «Отправить всё» sends the whole list as one issue;
// - comments in the list are numbered pins on their elements;
// - Esc closes the form (the text stays for the same element), then the
//   list, then leaves the mode.
// The issue carries the page address, the viewport, a CSS selector, the
// element's text, the nearest heading, the anchor, the link, data-* hints,
// the source files the element's classes come from (the map of
// tools/comment-mode.mjs) and the page's file. The list lives in
// localStorage (per browser, survives page loads; in memory when storage
// is blocked).
import type { CodeMap, Conf, Ui } from './comment-mode';

type Full = Conf & CodeMap;

interface Item {
  id: string;
  path: string;
  url: string;
  viewport: string;
  element: string;
  selector: string;
  text: string;
  heading: string;
  anchor: string;
  link: string;
  media: string;
  data: string[];
  code: string[];
  page: string;
  comment: string;
}

const MAX_URL = 7500; // GitHub refuses much longer new-issue addresses

const STYLE = `
.btn--small { font-weight: 400; font-size: 13px; min-height: 32px; padding: 4px 10px; }
.btn:disabled { cursor: default; color: var(--muted, #5e5e5e); border-color: var(--rule, #c4c4c4); background: var(--paper, #fff); }
textarea:focus-visible, a:focus-visible { outline: 2px solid var(--ink, #000); outline-offset: 3px; }
.panel .row { justify-content: flex-start; margin-top: 12px; }
.card { background: var(--paper, #fff); border: 1px solid var(--ink, #000); }
.hint, .status { margin: 0; padding: 8px 10px; font: 13px/1.45 var(--font-mono, ui-monospace, monospace); width: 100%; }
.panel { width: 100%; padding: 14px; max-height: min(62vh, 36rem); overflow: auto; }
h2 { font-size: 15px; font-weight: 700; margin: 0 0 8px; }
p { margin: 0; }
.el { margin: 0 0 4px; overflow-wrap: anywhere; }
.meta { font: 12px/1.45 var(--font-mono, ui-monospace, monospace); color: var(--muted, #5e5e5e); overflow-wrap: anywhere; }
label { display: block; font: 13px/1.4 var(--font-mono, ui-monospace, monospace); color: var(--muted, #5e5e5e); margin: 12px 0 4px; }
textarea { display: block; width: 100%; min-height: 6.5em; resize: vertical; margin: 0; padding: 8px; border: 1px solid var(--ink, #000); border-radius: 0;
  font: 16px/1.4 var(--font-sans, system-ui, sans-serif); color: var(--ink, #000); background: var(--paper, #fff); }
.note { margin-top: 10px; font: 12px/1.45 var(--font-mono, ui-monospace, monospace); color: var(--muted, #5e5e5e); }
.status a { color: inherit; }
ol { list-style: none; margin: 0; padding: 0; }
li { border-top: 1px solid var(--rule, #c4c4c4); padding: 8px 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: start; }
li:last-child { border-bottom: 1px solid var(--rule, #c4c4c4); }
li .meta, li .text { grid-column: 1; overflow-wrap: anywhere; }
li .text { white-space: pre-wrap; }
li .btn { grid-column: 2; grid-row: 1 / span 2; }
.box { position: fixed; z-index: 2147482999; pointer-events: none; border: 2px solid var(--ink, #000); outline: 2px solid var(--paper, #fff); display: none; }
.box[data-on="true"] { display: block; }
.box--picked { border-style: dashed; }
.tag { position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px; max-width: min(28rem, 80vw); white-space: nowrap; overflow: clip; text-overflow: ellipsis;
  background: var(--ink, #000); color: var(--paper, #fff); font: 11px/1.4 var(--font-mono, ui-monospace, monospace); padding: 1px 5px; }
.tag[data-below="true"] { bottom: auto; top: 100%; margin: 2px 0 0; }
.pin { position: fixed; z-index: 2147482998; pointer-events: none; min-width: 22px; height: 22px; padding: 0 4px; text-align: center;
  background: var(--ink, #000); color: var(--paper, #fff); outline: 2px solid var(--paper, #fff); font: 12px/22px var(--font-mono, ui-monospace, monospace); }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: clip; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 719px) { .panel { max-height: 52vh; } }
@media (forced-colors: active) { .box, .pin { border-color: Highlight; outline-color: Canvas; } }
`;

const BOXES = `
<div class="box" data-box="hover" aria-hidden="true"><span class="tag"></span></div>
<div class="box box--picked" data-box="picked" aria-hidden="true"><span class="tag"></span></div>
<div data-pins aria-hidden="true"></div>`;

const PANELS = `
<section class="card panel" data-panel="form" data-open="false" role="dialog" aria-labelledby="cm-form-title">
  <h2 id="cm-form-title">Правка</h2>
  <p class="el" data-f="element"></p>
  <p class="meta" data-f="where"></p>
  <div class="row">
    <button type="button" class="btn btn--small" data-act="wider">Шире</button>
    <button type="button" class="btn btn--small" data-act="narrower">Уже</button>
  </div>
  <label for="cm-text">Что поправить</label>
  <textarea id="cm-text" rows="4" aria-describedby="cm-form-note"></textarea>
  <div class="row">
    <button type="button" class="btn btn--primary" data-act="send">Отправить</button>
    <button type="button" class="btn" data-act="queue">В список</button>
    <button type="button" class="btn" data-act="cancel">Отмена</button>
  </div>
  <p class="note" id="cm-form-note">«Отправить» откроет задачу на GitHub в новой вкладке. «В список» копит правки, чтобы отправить их одной задачей. Ctrl+Enter: в список.</p>
</section>
<section class="card panel" data-panel="list" data-open="false" id="cm-list" aria-labelledby="cm-list-title">
  <h2 id="cm-list-title">Список правок</h2>
  <ol data-f="items"></ol>
  <p class="meta" data-f="empty">Список пуст.</p>
  <div class="row">
    <button type="button" class="btn btn--primary" data-act="send-all">Отправить всё</button>
    <button type="button" class="btn" data-act="copy">Скопировать</button>
    <button type="button" class="btn" data-act="clear">Очистить</button>
  </div>
  <textarea data-f="copytext" readonly data-open="false" aria-label="Текст правок"></textarea>
</section>
<p class="card status" data-f="status" data-open="false"></p>
<p class="card hint" data-f="hint" data-open="false"></p>`;

// ------------------------------------------------------------- storage

let memory: Item[] = [];
function load(key: string): Item[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return (memory = v);
    }
  } catch {
    /* private mode, blocked storage: keep the list in memory */
  }
  return memory;
}
function save(key: string, items: Item[]) {
  memory = items;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* in memory only */
  }
}

// ------------------------------------------------------------- describing an element

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const classesOf = (el: Element) =>
  (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => c && !/^(astro-|is-|has-|js-)/.test(c));

function textOf(el: Element): string {
  const own = el instanceof HTMLElement && !(el instanceof HTMLTextAreaElement) ? el.innerText : (el.textContent ?? '');
  const t = squash(own || '');
  if (t) return t;
  const a = (n: string) => squash(el.getAttribute(n) || '');
  return a('aria-label') || a('alt') || a('title') || a('placeholder') || a('value') || '';
}
const tagOf = (el: Element) => {
  const c = classesOf(el)[0];
  return el.localName + (c ? '.' + c : '');
};
function describe(el: Element, n = 60): string {
  const t = short(textOf(el), n);
  return t ? `${tagOf(el)} «${t}»` : tagOf(el);
}

// a pointer lands on the innermost element: the word inside a button, the
// icon inside a link. Comments are about the button or the link, so the
// choice starts there («Уже» and the arrow down still reach the inner one).
const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="link"]';
const INNER = /^(span|strong|b|em|i|small|abbr|mark|sup|sub|s|u|code|kbd|br|svg|path|use|g|circle|rect|line|polyline|polygon|text|tspan)$/;
function promote(el: Element): Element {
  if (el.localName === 'tspan') el = el.closest('text') ?? el;
  const ia = el.parentElement?.closest(INTERACTIVE);
  return ia && INNER.test(el.localName) ? ia : el;
}

function unique(sel: string, el: Element): boolean {
  try {
    const all = document.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}
function step(el: Element): string {
  let s = el.localName + classesOf(el).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
    if (same.length > 1 && same.filter((c) => c.matches(s)).length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return s;
}
/** A short CSS selector that matches only this element: its id, else a path up to the nearest id. */
function selectorFor(el: Element): string {
  if (el.id && unique('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    const parent: Element | null = cur.parentElement;
    parts.unshift(step(cur));
    const idAnc = parent?.closest('[id]');
    if (idAnc && idAnc !== document.documentElement) {
      // shortest form first: "#audit a.btn", then the full path under the id
      const loose = `#${CSS.escape(idAnc.id)} ${parts.join(' > ')}`;
      if (unique(loose, el)) return loose;
    }
    const sel = parts.join(' > ');
    if (unique(sel, el)) return sel;
    cur = parent;
  }
  return parts.join(' > ');
}

function headingOf(el: Element, host: Element): string {
  let best: Element | null = null;
  if (/^h[1-6]$/.test(el.localName)) best = el;
  else
    for (const h of Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
      if (host.contains(h)) continue;
      if (h.contains(el) || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      else break;
    }
  return best ? `${best.localName} «${short(textOf(best), 90)}»` : '';
}

function dataHints(el: Element): string[] {
  const out: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 4 && out.length < 6; depth++, cur = cur.parentElement) {
    for (const a of Array.from(cur.attributes)) {
      if (!a.name.startsWith('data-') || a.name.startsWith('data-astro') || out.length >= 6) continue;
      const v = a.value ? `="${short(squash(a.value), 40)}"` : '';
      out.push(`${a.name}${v}${depth ? ` (у ${tagOf(cur)})` : ''}`);
    }
  }
  return out;
}

// ------------------------------------------------------------- the mode

export function mount(root: ShadowRoot, host: HTMLElement, conf: Full): Ui {
  const KEY = conf.marker;
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style); // after the bar's styles, so these win (disabled buttons)
  const cm = root.querySelector('.cm') as HTMLElement;
  const dock = root.querySelector('.dock') as HTMLElement;
  cm.insertAdjacentHTML('afterbegin', BOXES);
  dock.insertAdjacentHTML('afterbegin', PANELS);
  cm.insertAdjacentHTML('beforeend', '<p class="sr" role="status" data-f="live"></p>');

  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const f = (name: string) => $(`[data-f="${name}"]`);
  const act = (name: string) => $<HTMLButtonElement>(`[data-act="${name}"]`);
  const hoverBox = $('[data-box="hover"]');
  const pickedBox = $('[data-box="picked"]');
  const pins = $('[data-pins]');
  const form = $('[data-panel="form"]');
  const list = $('[data-panel="list"]');
  const text = $<HTMLTextAreaElement>('#cm-text');
  const toggle = act('toggle');
  const listBtn = act('list');
  const copyText = f('copytext') as HTMLTextAreaElement;
  const touch = matchMedia('(hover: none)').matches;

  const show = (el: Element, open: boolean) => el.setAttribute('data-open', String(open));
  const isOpen = (el: Element) => el.getAttribute('data-open') === 'true';
  const ours = (e: Event) => e.composedPath().includes(host);
  const say = (msg: string) => {
    const live = f('live');
    live.textContent = '';
    window.setTimeout(() => (live.textContent = msg), 30);
  };

  let on = false;
  let candidate: Element | null = null;
  let picked: Element | null = null;
  let narrower: Element[] = [];
  let returnTo: HTMLElement | null = null;
  let draft = { selector: '', text: '' };
  let down: { x: number; y: number } | null = null;

  const basePath = conf.base.replace(/\/$/, '');
  const sitePath = () => {
    const p = location.pathname;
    return (p.startsWith(basePath) ? p.slice(basePath.length) : p) || '/';
  };
  const pageFile = () => {
    const p = sitePath();
    for (const [re, i] of conf.routes) if (new RegExp(re).test(p)) return conf.files[i];
    return '';
  };
  const filesOfClass = (c: string) => conf.classes[c] ?? conf.classes[c.split(/__|--/)[0]] ?? [];
  /**
   * The source files behind the element, innermost first: the component of each
   * data-astro-cid-* on it and its ancestors (with the class that file styles),
   * then the global stylesheet classes of the element. Without scopes, the
   * files whose styles define the classes on the way up.
   */
  function codeOf(el: Element): string[] {
    const out = new Map<string, string>();
    for (let cur: Element | null = el; cur && cur !== document.documentElement && out.size < 6; cur = cur.parentElement) {
      for (const a of Array.from(cur.attributes)) {
        const id = /^data-astro-cid-(\w+)$/.exec(a.name)?.[1];
        const i = id === undefined ? undefined : conf.scopes[id];
        if (i === undefined || out.has(conf.files[i])) continue;
        const cls = classesOf(cur).find((c) => filesOfClass(c).includes(i));
        out.set(conf.files[i], cls ? '.' + cls : '');
      }
    }
    if (!out.size)
      for (let cur: Element | null = el; cur && cur !== document.body && out.size < 6; cur = cur.parentElement)
        for (const c of classesOf(cur)) for (const i of filesOfClass(c)) if (!out.has(conf.files[i])) out.set(conf.files[i], '.' + c);
    for (const c of classesOf(el))
      for (const i of filesOfClass(c)) if (conf.files[i].endsWith('.css') && !out.has(conf.files[i])) out.set(conf.files[i], '.' + c);
    return [...out].map(([file, hint]) => (hint ? `${file} (${hint})` : file)).slice(0, 6);
  }
  const viewport = () => {
    const parts = [`${innerWidth}×${innerHeight}`, `DPR ${Math.round(devicePixelRatio * 100) / 100}`, touch ? 'касание' : 'мышь'];
    if (scrollY) parts.push(`прокрутка ${Math.round(scrollY)}`);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) parts.push('без анимаций (reduced motion)');
    return parts.join(', ');
  };

  function collect(el: Element, comment: string): Item {
    const a = el.closest('a[href]') as HTMLAnchorElement | null;
    let media = '';
    if (el instanceof HTMLImageElement) media = el.currentSrc || el.src;
    else if (el instanceof HTMLVideoElement) media = el.currentSrc || el.poster;
    const idAnc = el.closest('[id]');
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      path: sitePath(),
      url: location.href,
      viewport: viewport(),
      element: describe(el, 80),
      selector: selectorFor(el),
      text: short(textOf(el), 300),
      heading: headingOf(el, host),
      anchor: idAnc ? '#' + idAnc.id : '',
      link: a ? a.href : '',
      media,
      data: dataHints(el),
      code: codeOf(el),
      page: pageFile(),
      comment: comment.trim(),
    };
  }

  // ------------------------------------------------------- issue text

  function lines(it: Item, level: number): string[] {
    const L = [`- Страница: ${it.url}`, `- Экран: ${it.viewport}`, `- Элемент: ${it.element}`, '- Селектор: `' + it.selector + '`'];
    if (it.text) L.push(`- Текст: «${level ? short(it.text, 120) : it.text}»`);
    if (it.heading) L.push(`- Ближайший заголовок: ${it.heading}`);
    if (it.anchor) L.push(`- Якорь: ${it.anchor}`);
    if (it.link) L.push(`- Ссылка: ${it.link}`);
    if (it.media) L.push(`- Файл: ${it.media}`);
    if (it.data.length && level < 1) L.push('- data-*: ' + it.data.map((d) => '`' + d + '`').join(', '));
    if (it.code.length && level < 2) L.push('- Код: ' + it.code.map((c) => '`' + c + '`').join(', '));
    if (it.page) L.push('- Файл страницы: `' + it.page + '`');
    return L;
  }
  const quote = (s: string) =>
    s
      .split('\n')
      .map((l) => '> ' + l)
      .join('\n');
  const build = conf.build ? `, сборка ${conf.build}` : '';
  function body(items: Item[], level: number): string {
    const end = `\n\n<!-- ${conf.marker} -->`;
    if (items.length === 1) {
      const it = items[0];
      return `${quote(it.comment)}\n\n${lines(it, level).join('\n')}\n\nРежим комментариев стейджинга${build}.${end}`;
    }
    const parts = items.map(
      (it, i) => `### ${i + 1}. ${it.path}: ${short(it.element, 70)}\n\n${quote(it.comment)}\n\n${lines(it, level).join('\n')}`,
    );
    return `Правок: ${items.length}. Режим комментариев стейджинга${build}.\n\n${parts.join('\n\n')}${end}`;
  }
  function title(items: Item[]): string {
    if (items.length === 1) {
      const it = items[0];
      const t = short(it.text, 50);
      return `Правка: ${it.path} — ${t ? `«${t}»` : it.element}`;
    }
    const paths = [...new Set(items.map((it) => it.path))];
    const more = paths.length > 3 ? ` и ещё ${paths.length - 3}` : '';
    return `Правки (${items.length}): ${paths.slice(0, 3).join(', ')}${more}`;
  }
  const issueUrl = (t: string, b: string) =>
    `https://github.com/${conf.repo}/issues/new?title=${encodeURIComponent(t)}&labels=${encodeURIComponent(conf.label)}&body=${encodeURIComponent(b)}`;

  function status(msg: string, href?: string) {
    const s = f('status');
    s.textContent = msg;
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Открыть задачу на GitHub';
      s.append(' ', a);
    }
    show(s, true);
    say(msg);
  }

  async function copy(textToCopy: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(textToCopy);
      return true;
    } catch {
      return false;
    }
  }
  function showCopyText(all: string) {
    copyText.value = all;
    show(copyText, true);
    show(list, true);
    listBtn.setAttribute('aria-expanded', 'true');
    copyText.focus();
    copyText.select();
  }

  /** Opens the new-issue page in a new tab; a list too long for the address goes through the clipboard. */
  function send(items: Item[], done: string, after = '') {
    const t = title(items);
    let url = '';
    for (let level = 0; level < 3 && !url; level++) {
      const u = issueUrl(t, body(items, level));
      if (u.length <= MAX_URL) url = u;
    }
    let how = '';
    if (!url) {
      const full = body(items, 0);
      how = ' Текст длинный, поэтому он в буфере обмена: вставьте его в поле задачи.';
      url = issueUrl(t, `Текст правок длинный: он в буфере обмена, вставьте его сюда вместо этой строки.\n\n<!-- ${conf.marker} -->`);
      void copy(full).then((ok) => ok || showCopyText(full));
    }
    const w = window.open(url, '_blank');
    if (w) w.opener = null;
    if (w) status(`${done}: нажмите там кнопку создания задачи (Create).${how}${after}`);
    else status(`Браузер не открыл новую вкладку.${how}${after}`, url);
  }

  // ------------------------------------------------------- drawing

  function place(box: HTMLElement, el: Element | null, label: string) {
    if (!el || !el.isConnected) {
      box.setAttribute('data-on', 'false');
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.left = `${r.left - 2}px`;
    box.style.top = `${r.top - 2}px`;
    box.style.width = `${Math.max(r.width, 2) + 4}px`;
    box.style.height = `${Math.max(r.height, 2) + 4}px`;
    const tag = box.firstElementChild as HTMLElement;
    tag.textContent = label;
    tag.setAttribute('data-below', String(r.top < 22));
    box.setAttribute('data-on', 'true');
  }
  function drawPins() {
    pins.replaceChildren();
    if (!on) return;
    const here = sitePath();
    load(KEY).forEach((it, i) => {
      if (it.path !== here) return;
      let el: Element | null = null;
      try {
        el = document.querySelector(it.selector);
      } catch {
        /* a selector from an older build */
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const p = document.createElement('span');
      p.className = 'pin';
      p.textContent = String(i + 1);
      p.style.left = `${Math.max(0, r.right - 24)}px`;
      p.style.top = `${Math.max(0, r.top)}px`;
      pins.append(p);
    });
  }
  let frame = 0;
  function redraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place(hoverBox, on && candidate !== picked ? candidate : null, candidate ? describe(candidate, 40) : '');
      place(pickedBox, picked, picked ? 'выбрано: ' + tagOf(picked) : '');
      drawPins();
    });
  }

  function renderList() {
    const items = load(KEY);
    f('count').textContent = String(items.length);
    show(listBtn, items.length > 0 || isOpen(list));
    f('items').replaceChildren(
      ...items.map((it, i) => {
        const li = document.createElement('li');
        const meta = document.createElement('p');
        meta.className = 'meta';
        meta.textContent = `${i + 1}. ${it.path}: ${short(it.element, 70)}`;
        const c = document.createElement('p');
        c.className = 'text';
        c.textContent = it.comment;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn--small';
        del.textContent = 'Удалить';
        del.setAttribute('aria-label', `Удалить правку ${i + 1}`);
        del.dataset.del = it.id;
        li.append(meta, c, del);
        return li;
      }),
    );
    show(f('empty'), items.length === 0);
    for (const n of ['send-all', 'copy', 'clear']) act(n).disabled = items.length === 0;
    redraw();
  }

  // ------------------------------------------------------- form

  function where(el: Element): string {
    const h = headingOf(el, host);
    return selectorFor(el) + (h ? '; раздел ' + h : '');
  }
  /** The instructions show while choosing; the form and the list replace them. */
  const syncHint = () => show(f('hint'), on && !isOpen(form) && !isOpen(list));
  function openForm(el: Element) {
    picked = el;
    show(f('status'), false);
    f('element').textContent = describe(el, 120);
    f('where').textContent = where(el);
    act('narrower').disabled = narrower.length === 0 && !el.firstElementChild;
    act('wider').disabled = !el.parentElement || el.parentElement === document.documentElement;
    const sel = selectorFor(el);
    if (!isOpen(form) && draft.text && draft.selector === sel) text.value = draft.text;
    show(list, false);
    listBtn.setAttribute('aria-expanded', 'false');
    show(form, true);
    syncHint();
    redraw();
  }
  function pick(el: Element, byKeyboard: boolean) {
    if (el === document.documentElement) el = document.body;
    if (!byKeyboard) narrower = []; // the arrows keep their way back for «Уже»
    returnTo =
      byKeyboard && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    openForm(el);
    text.focus({ preventScroll: true });
    // keep the element in view: not under the form, not under the sticky header
    const r = el.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const covered = r.right > d.left && r.left < d.right && r.bottom > d.top - 8;
    if (r.top < 72 || r.top > innerHeight || covered) window.scrollBy({ top: r.top - 72, behavior: 'instant' as ScrollBehavior });
    say(`Выбрано: ${describe(el)}. Напишите, что поправить.`);
  }
  function closeForm(keepDraft: boolean) {
    if (picked && keepDraft && text.value.trim()) draft = { selector: selectorFor(picked), text: text.value };
    else if (!keepDraft) draft = { selector: '', text: '' };
    const hadFocus = form.contains(root.activeElement);
    text.value = '';
    picked = null;
    show(form, false);
    syncHint();
    redraw();
    const back = returnTo;
    returnTo = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    else if (hadFocus) toggle.focus({ preventScroll: true });
  }
  function resize(to: Element | null | undefined, push: boolean) {
    if (!picked || !to) return;
    if (push) narrower.push(picked);
    openForm(to);
    say(`Выбрано: ${describe(to)}`);
  }

  // ------------------------------------------------------- page listeners (comment mode only)

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const setCandidate = (el: Element | null, announce = false) => {
    if (el === host || (el && host.contains(el))) el = null;
    if (el === document.documentElement) el = document.body;
    candidate = el;
    redraw();
    if (announce && el) say(describe(el));
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (ours(e)) return setCandidate(null);
    if (e.target instanceof Element) setCandidate(promote(e.target));
  };
  const onPointerDown = (e: PointerEvent) => {
    down = ours(e) ? null : { x: e.clientX, y: e.clientY };
  };
  const onMouseDown = (e: MouseEvent) => {
    if (!ours(e)) e.preventDefault(); // no focus move, no text selection, no drag
  };
  const onClick = (e: MouseEvent) => {
    if (ours(e)) return;
    stop(e);
    // a swipe of a carousel or a drag is not a choice
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    if (e.target instanceof Element) pick(e.detail === 0 ? e.target : promote(e.target), e.detail === 0);
  };
  const onFocus = (e: FocusEvent) => {
    if (!ours(e) && e.target instanceof Element) {
      narrower = [];
      setCandidate(e.target);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      stop(e);
      if (isOpen(form)) closeForm(true);
      else if (isOpen(list)) {
        show(list, false);
        listBtn.setAttribute('aria-expanded', 'false');
        syncHint();
        if (ours(e)) listBtn.focus();
      } else exit();
      return;
    }
    if (ours(e)) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && isOpen(form)) {
        stop(e);
        act('queue').click();
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.key === 'Tab') return;
    const cur =
      candidate ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    if (!cur) return;
    let next: Element | null | undefined;
    if (e.key === 'Enter' || e.key === ' ') {
      stop(e);
      pick(cur, true);
      return;
    }
    if (e.key === 'ArrowUp') {
      next = cur.parentElement !== document.documentElement ? cur.parentElement : null;
      if (next) narrower.push(cur);
    } else if (e.key === 'ArrowDown') next = narrower.pop() ?? cur.firstElementChild;
    else if (e.key === 'ArrowLeft') next = cur.previousElementSibling;
    else if (e.key === 'ArrowRight') next = cur.nextElementSibling;
    else return;
    stop(e);
    if (next && next !== host) setCandidate(next, true);
  };
  const block = (e: Event) => {
    if (!ours(e)) stop(e);
  };

  const listeners: [string, EventListener][] = [
    ['pointermove', onMove as EventListener],
    ['pointerdown', onPointerDown as EventListener],
    ['mousedown', onMouseDown as EventListener],
    ['click', onClick as EventListener],
    ['auxclick', block],
    ['dblclick', block],
    ['submit', block],
    ['focusin', onFocus as EventListener],
    ['keydown', onKey as EventListener],
  ];
  const onScroll = () => redraw();

  function enter() {
    if (on) return;
    on = true;
    for (const [type, fn] of listeners) document.addEventListener(type, fn, true);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onScroll);
    document.documentElement.setAttribute('data-commenting', '');
    toggle.setAttribute('aria-pressed', 'true');
    f('hint').textContent = touch
      ? 'Коснитесь элемента, о котором правка. Пока режим включён, ссылки и кнопки сайта не срабатывают.'
      : 'Кликните элемент, о котором правка. Клавиатура: Tab, стрелки вверх и вниз (шире, уже), Enter. Esc: выйти.';
    show(f('status'), false);
    syncHint();
    redraw();
    say('Режим комментариев включён. ' + f('hint').textContent);
  }
  function exit() {
    if (!on) return;
    if (isOpen(form)) closeForm(true);
    on = false;
    for (const [type, fn] of listeners) document.removeEventListener(type, fn, true);
    document.removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', onScroll);
    document.documentElement.removeAttribute('data-commenting');
    toggle.setAttribute('aria-pressed', 'false');
    syncHint();
    show(f('status'), false);
    candidate = null;
    redraw();
    say('Режим комментариев выключен.');
  }
  function toggleList() {
    const open = !isOpen(list);
    if (open && isOpen(form)) closeForm(true);
    show(list, open);
    show(copyText, false);
    listBtn.setAttribute('aria-expanded', String(open));
    syncHint();
    renderList();
  }

  // ------------------------------------------------------- widget buttons («Комментировать» and «Список»: comment-mode.ts)

  root.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('button');
    if (!t) return;
    const items = load(KEY);
    const del = t.getAttribute('data-del');
    if (del) {
      save(KEY, items.filter((it) => it.id !== del));
      renderList();
      (f('items').querySelector('button') ?? (isOpen(listBtn) ? listBtn : toggle)).focus();
      say('Правка удалена из списка.');
      return;
    }
    switch (t.getAttribute('data-act')) {
      case 'wider':
        return resize(picked?.parentElement !== document.documentElement ? picked?.parentElement : null, true);
      case 'narrower':
        return resize(narrower.pop() ?? picked?.firstElementChild, false);
      case 'cancel':
        return closeForm(false);
      case 'send':
      case 'queue': {
        if (!picked) return;
        if (!text.value.trim()) {
          text.focus();
          say('Сначала напишите, что поправить.');
          return;
        }
        const it = collect(picked, text.value);
        const isSend = t.getAttribute('data-act') === 'send';
        closeForm(false);
        if (isSend) send([it], 'Задача открыта в новой вкладке');
        else {
          save(KEY, [...items, it]);
          renderList();
          status(`В списке правок: ${items.length + 1}. Выберите следующий элемент или откройте «Список».`);
        }
        return;
      }
      case 'send-all':
        if (items.length)
          send(items, `Задача со всеми правками (${items.length}) открыта в новой вкладке`, ' Когда она создана, очистите список.');
        return;
      case 'copy': {
        const all = body(items, 0);
        void copy(all).then((ok) => {
          if (ok) status('Список правок скопирован в буфер обмена.');
          else {
            showCopyText(all);
            status('Не получилось скопировать: текст выделен в поле под списком.');
          }
        });
        return;
      }
      case 'clear':
        if (items.length && confirm(`Удалить из списка все правки (${items.length})?`)) {
          save(KEY, []);
          renderList();
          show(copyText, false);
          toggle.focus();
          status('Список правок очищен.');
        }
        return;
    }
  });

  // the list may change in another tab
  addEventListener('storage', (e) => {
    if (e.key === KEY) renderList();
  });

  renderList();
  return { toggle: () => (on ? exit() : enter()), list: toggleList };
}
