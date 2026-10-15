// Image lightbox for screenshots and proof images (decision 2 of 15.10),
// loaded by src/scripts/lightbox.ts when a thumbnail is about to be used.
// The browser's own modal <dialog> (showModal: the page behind is inert for
// the mouse, the keyboard and screen readers, Esc closes, focus stays inside,
// the dialog is modal for assistive technology) and Motion's WAAPI animate
// with its spring (src/scripts/motion-lite.ts, the chunk the accordions use).
//
// - open: the image grows from its thumbnail (which steps aside) to the
//   largest size that fits the screen, never above its own pixels, on a
//   spring with a little bounce; the page fades to paper; the caption (the
//   figure's figcaption) and the bar («Открыть файл», «Закрыть») fade in;
// - close: Esc, «Закрыть», a click or tap anywhere, or a swipe up or down on
//   the image (the paper thins as it goes): the image goes back into the
//   thumbnail, then focus returns to it;
// - phones: pinch-zoom works on the image (touch-action: pinch-zoom; a
//   second finger ends a swipe at once, a multi-touch never closes); zoomed
//   in, one finger pans and a tap does not close; «Открыть файл» opens the
//   full file in a new tab, as the plain link did;
// - prefers-reduced-motion: it opens and closes at once, no swipe, and
//   Motion is never loaded.
// Accessible name: the thumbnail's alt; description: the caption. The image
// inside has alt="", so the description is read once.
// Black and white: paper, the hairline frame of the thumbnails; colour only
// inside the image. Styles: src/components/motion/Lightbox.css.

import type * as MotionLite from './motion-lite';

type Motion = typeof MotionLite;
type Running = { stop: () => void; finished: Promise<unknown> };
type Shot = {
  trigger: HTMLAnchorElement;
  thumb: HTMLImageElement;
  src: string;
  alt: string;
  caption: string;
  w: number;
  h: number;
};
type Box = { x: number; y: number; width: number; height: number };

const OPEN = 'translate(0px, 0px) scale(1)';
const FADE = { duration: 0.2, ease: [0.2, 0, 0, 1] } as const;
const QUICK = { duration: 0.1, ease: [0.4, 0, 1, 1] } as const;
// back into the thumbnail: short and without bounce, so the page is free again at once
const BACK = { duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const;
const SWIPE_CLOSE = 90; // px
const SWIPE_SPEED = 600; // px/s

const motionAllowed = () => window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
// pinch-zoomed in (phones): taps and drags belong to the zoom
const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

let motion: Motion | null = null;
let motionLoad: Promise<Motion | null> | null = null;

/** Loads Motion when motion is allowed (never under reduced motion). */
export function warm(): Promise<Motion | null> {
  if (!motionAllowed()) return Promise.resolve(null);
  motionLoad ??= import('./motion-lite').then(
    (m) => (motion = m),
    () => {
      motionLoad = null;
      return null;
    },
  );
  return motionLoad;
}

const spring = (m: Motion) => ({ type: m.spring, visualDuration: 0.42, bounce: 0.12 });

/** The largest box for the image that fits the screen under the bar and above the caption. */
function fit(s: Shot): Box {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const side = vw < 720 ? 16 : 48;
  const top = 64;
  const bottom = s.caption ? (vw < 720 ? 96 : 80) : 32;
  const maxW = vw - 2 * side;
  const maxH = Math.max(80, vh - top - bottom);
  const k = Math.min(maxW / s.w, maxH / s.h, 1);
  const width = s.w * k;
  const height = s.h * k;
  return { x: (vw - width) / 2, y: top + (maxH - height) / 2, width, height };
}

/** Transform that puts the box onto the thumbnail (origin top left). */
function onto(thumb: HTMLElement, box: Box): string {
  const r = thumb.getBoundingClientRect();
  return `translate(${r.left - box.x}px, ${r.top - box.y}px) scale(${r.width / box.width})`;
}

function shotOf(trigger: HTMLAnchorElement): Shot | null {
  const thumb = trigger.querySelector('img');
  if (!thumb) return null;
  const w = thumb.naturalWidth || Number(thumb.getAttribute('width')) || 1;
  const h = thumb.naturalHeight || Number(thumb.getAttribute('height')) || 1;
  const caption = (trigger.closest('figure')?.querySelector('figcaption')?.textContent ?? '').trim();
  return { trigger, thumb, src: trigger.href, alt: thumb.alt, caption, w, h };
}

// ------------------------------------------------------------------ state

type Ui = {
  dialog: HTMLDialogElement;
  veil: HTMLElement;
  img: HTMLImageElement;
  caption: HTMLElement;
  bar: HTMLElement;
  file: HTMLAnchorElement;
};

let ui: Ui | null = null;
let shot: Shot | null = null;
let box: Box | null = null;
let opening = false;
let closing = false;
let imgAnim: Running | null = null;
let fades: Running[] = [];
let dragged = false;
let press: { id: number; y0: number; base: string; moved: boolean; trail: [number, number][] } | null = null;
const pointers = new Set<number>();
let locked: { overflow: string; gutter: string } | null = null;

function stopImg(): void {
  imgAnim?.stop();
  imgAnim = null;
}

function stopAll(): void {
  stopImg();
  fades.forEach((a) => a.stop());
  fades = [];
}

const opacity = (el: HTMLElement) => Number(getComputedStyle(el).opacity);
const transformOf = (el: HTMLElement) => {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? t : OPEN;
};

/** No page scrolling behind the dialog; a classic scrollbar keeps its room. */
function lock(): void {
  const html = document.documentElement;
  const bar = window.innerWidth - html.clientWidth;
  locked = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
  if (bar > 0) html.style.scrollbarGutter = 'stable';
  html.style.overflow = 'clip';
}

function unlock(): void {
  if (!locked) return;
  const html = document.documentElement;
  html.style.overflow = locked.overflow;
  html.style.scrollbarGutter = locked.gutter;
  locked = null;
}

function place(): void {
  if (!ui || !box) return;
  const { img, caption } = ui;
  img.style.left = `${box.x}px`;
  img.style.top = `${box.y}px`;
  img.style.width = `${box.width}px`;
  img.style.height = `${box.height}px`;
  caption.style.top = `${box.y + box.height + 12}px`;
}

function refit(): void {
  if (!shot || closing || zoomed()) return;
  box = fit(shot);
  place();
}

// ------------------------------------------------------------------ swipe

/** The image springs back to its place and the paper fills in again. */
function settle(): void {
  if (!ui || !motion || closing) return;
  const { img, veil } = ui;
  stopImg();
  imgAnim = motion.animate(img, { transform: [transformOf(img), OPEN] }, spring(motion));
  fades.push(motion.animate(veil, { opacity: [opacity(veil), 1] }, FADE));
}

function onPointerDown(event: PointerEvent): void {
  pointers.add(event.pointerId);
  if (pointers.size > 1) {
    // a second finger: a pinch, never a swipe
    const p = press;
    press = null;
    if (p?.moved) settle();
    return;
  }
  if (!ui || event.target !== ui.img || !shot || closing || !motion || !motionAllowed()) return;
  if (event.button !== 0 || zoomed()) return;
  stopImg(); // a grab during the zoom takes the image where it is
  ui.img.setPointerCapture?.(event.pointerId);
  press = { id: event.pointerId, y0: event.clientY, base: transformOf(ui.img), moved: false, trail: [[event.timeStamp, event.clientY]] };
}

function onPointerMove(event: PointerEvent): void {
  const p = press;
  if (!ui || !p || p.id !== event.pointerId) return;
  const dy = event.clientY - p.y0;
  if (!p.moved && Math.abs(dy) < 4) return;
  p.moved = true;
  dragged = true;
  ui.img.style.transform = `translateY(${dy}px) ${p.base}`;
  ui.veil.style.opacity = String(1 - 0.6 * Math.min(1, Math.abs(dy) / 300));
  p.trail.push([event.timeStamp, event.clientY]);
  if (p.trail.length > 8) p.trail.shift();
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  const p = press;
  if (!p || p.id !== event.pointerId) return;
  press = null;
  if (!p.moved) return;
  const dy = event.clientY - p.y0;
  const [t0, y0] = p.trail.find(([t]) => event.timeStamp - t <= 100) ?? p.trail[0];
  const speed = (Math.abs(event.clientY - y0) / Math.max(1, event.timeStamp - t0)) * 1000;
  if (Math.abs(dy) > SWIPE_CLOSE || speed > SWIPE_SPEED) close();
  else settle();
  // the click that ends a swipe is not a tap
  window.setTimeout(() => (dragged = false), 0);
}

function onPointerCancel(event: PointerEvent): void {
  // the browser took the gesture over (a pinch, a scroll)
  pointers.delete(event.pointerId);
  const p = press;
  if (!p || p.id !== event.pointerId) return;
  press = null;
  if (p.moved) settle();
  window.setTimeout(() => (dragged = false), 0);
}

// ------------------------------------------------------------- the dialog

function build(): Ui {
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.innerHTML =
    '<div class="lightbox__veil"></div>' +
    '<img class="lightbox__img" alt="" draggable="false">' +
    '<p class="lightbox__caption" id="lightbox-caption"></p>' +
    '<div class="lightbox__bar">' +
    '<a class="btn btn--small lightbox__file" target="_blank" rel="noopener">Открыть файл</a>' +
    '<button type="button" class="lightbox__close" autofocus>Закрыть</button>' +
    '</div>';
  document.body.append(dialog);
  const q = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
  const parts: Ui = {
    dialog,
    veil: q('.lightbox__veil'),
    img: q('.lightbox__img'),
    caption: q('.lightbox__caption'),
    bar: q('.lightbox__bar'),
    file: q('.lightbox__file'),
  };

  // Esc: close on the way back into the thumbnail
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // closed by any other way (a second Esc the browser does not let us delay)
  dialog.addEventListener('close', () => {
    if (!dialog.open) finish();
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('.lightbox__file')) return; // opens the file in a new tab
    if (target.closest('.lightbox__close')) return close();
    // a tap anywhere else, but not the end of a swipe or a tap while zoomed in
    if (dragged || zoomed()) return;
    close();
  });
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointermove', onPointerMove);
  dialog.addEventListener('pointerup', onPointerUp);
  dialog.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('resize', refit);
  window.visualViewport?.addEventListener('resize', () => dialog.toggleAttribute('data-zoomed', zoomed()));
  return parts;
}

/** Opens the thumbnail's image in the lightbox. */
export async function open(trigger: HTMLAnchorElement): Promise<void> {
  if (shot || opening) return;
  const next = shotOf(trigger);
  if (!next) {
    window.open(trigger.href, '_blank', 'noopener');
    return;
  }
  opening = true;
  const m = await warm();
  opening = false;
  if (shot) return;
  ui ??= build();
  const { dialog, veil, img, caption, bar, file } = ui;
  shot = next;
  closing = false;
  dragged = false;
  press = null;
  pointers.clear();
  stopAll();

  box = fit(next);
  if (img.getAttribute('src') !== next.src) img.src = next.src;
  img.width = next.w;
  img.height = next.h;
  place();
  dialog.setAttribute('aria-label', next.alt || next.caption);
  caption.textContent = next.caption;
  caption.style.display = next.caption ? '' : 'none';
  if (next.caption) dialog.setAttribute('aria-describedby', caption.id);
  else dialog.removeAttribute('aria-describedby');
  file.href = next.src;
  dialog.removeAttribute('data-closing');
  dialog.toggleAttribute('data-zoomed', zoomed());

  const animated = !!m && motionAllowed();
  const from = onto(next.thumb, box);
  img.style.transform = animated ? from : OPEN;
  for (const el of [veil, bar, caption]) el.style.opacity = animated ? '0' : '1';
  lock();
  dialog.showModal();
  next.thumb.style.opacity = '0';
  if (!animated || !m) return;
  imgAnim = m.animate(img, { transform: [from, OPEN] }, spring(m));
  fades = [
    m.animate(veil, { opacity: [0, 1] }, FADE),
    m.animate(bar, { opacity: [0, 1] }, FADE),
    m.animate(caption, { opacity: [0, 1] }, { ...FADE, delay: 0.12 }),
  ];
}

/** Closes the lightbox: back into the thumbnail with motion, at once without. */
export function close(): void {
  if (!ui || !shot || !box || closing) return;
  closing = true;
  const { dialog, veil, img, caption, bar } = ui;
  dialog.setAttribute('data-closing', '');
  press = null;
  stopAll(); // the values reached so far stay: the way back starts there
  const m = motionAllowed() ? motion : null;
  if (!m) return finish();
  imgAnim = m.animate(img, { transform: [transformOf(img), onto(shot.thumb, box)] }, BACK);
  fades = [
    m.animate(veil, { opacity: [opacity(veil), 0] }, FADE),
    m.animate(bar, { opacity: [opacity(bar), 0] }, QUICK),
    m.animate(caption, { opacity: [opacity(caption), 0] }, QUICK),
  ];
  const these = [imgAnim, ...fades];
  Promise.all(these.map((a) => a.finished)).then(
    () => {
      if (closing && imgAnim === these[0]) finish();
    },
    () => undefined,
  );
}

/** The end of a close: the dialog goes, the thumbnail comes back, focus returns to it. */
function finish(): void {
  if (!ui || !shot) return;
  const s = shot;
  shot = null;
  closing = false;
  press = null;
  pointers.clear();
  stopAll();
  const { dialog, img, veil, bar, caption } = ui;
  if (dialog.open) dialog.close();
  dialog.removeAttribute('data-closing');
  img.style.transform = '';
  for (const el of [veil, bar, caption]) el.style.opacity = '';
  s.thumb.style.opacity = '';
  unlock();
  s.trigger.focus({ preventScroll: true });
}
