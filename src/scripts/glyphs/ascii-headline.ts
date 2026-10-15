// AsciiHeadline (src/components/glyphs/AsciiHeadline.astro): a phrase drawn as
// a field of glyphs that fill the letter shapes. The real text stays in the
// DOM (read by search engines and screen readers, selectable); once the
// canvas is drawn the text turns transparent and the canvas (aria-hidden)
// shows over it. The letters are taken from the DOM layout itself: every
// character's box from a Range, so the line breaks, tracking and size match
// the text exactly at every width.
//
// Root data attributes:
//   data-mode     "ink" (default) | "inverse"
//   data-letters  "clip" (default): crisp letter edges, glyphs inside |
//                 "grid": pure ASCII, one glyph per cell, strokes on the contours
//   data-density  font size in glyph rows (default 11); a glyph row is never
//                 shorter than MIN_ROW CSS px, so on a phone 11 and 15 draw
//                 as about 8 (shorter rows turn the phrase into noise)
//   data-tint     opacity of the flat letter fill under the glyphs (clip only).
//                 Default: by the letter size, 0.13 at FILL_BIG CSS px (9rem)
//                 and up, 0.4 at FILL_SMALL and below (phones), linear
//                 between (about 0.29 at 88 px, the hero at 1280): the
//                 smaller the letters, the more the glyphs break their
//                 strokes up, so the fill keeps the shapes readable. A
//                 number fixes it
//   data-halo     "auto" (default): the faint dots around the letters only
//                 where the glyph rows are at least HALO_ROW CSS px (not on
//                 phones, where they merge with the letters) and on screens
//                 of at least HALO_DPR device px per CSS px (on a 1× or
//                 1.25× desktop monitor the dots are a pixel or two and smear
//                 the lines into noise) | "on" | "off"
//   data-shimmer  "on" turns the idle shimmer on (default off)
//
// Cost: the clipped letters make B the heaviest of the three prototypes per
// lens frame (docs/lab.md, «Frame cost»), so its canvas is capped at 1.5
// device pixels per CSS pixel.

import { AsciiField, edges } from './ascii-field';
import { blur, unlessForced, watchInView, watchSize, whenNear, yieldTask } from './core';

const K = 3; // mask samples per cell side
const MIN_ROW = 5.5; // CSS px, letters="clip"
const HALO_ROW = 6.5; // CSS px
const HALO_DPR = 1.5; // device px per CSS px
const MAX_DPR = 1.5;
const TINT = 0.13; // flat letter fill of big letters
const TINT_SMALL = 0.4; // and of small ones (phones)
const FILL_BIG = 144; // CSS px of font size (9rem): TINT from here up
const FILL_SMALL = 48; // TINT_SMALL from here down, linear between

function charBoxes(el: Element): { ch: string; r: DOMRect }[] {
  const out: { ch: string; r: DOMRect }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue ?? '';
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) continue;
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getClientRects()[0];
      if (r && r.width) out.push({ ch: s[i], r });
    }
  }
  return out;
}

function setup(root: HTMLElement): void {
  const text = root.querySelector<HTMLElement>('[data-ascii-text]');
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  // no canvas support: the plain text stays
  if (!text || !canvas || !canvas.getContext?.('2d')) return;
  let field: AsciiField | null = null;
  // the latest build: an older one stops at its next yield
  let builds = 0;

  const build = async () => {
    const my = ++builds;
    const ds = root.dataset;
    const cs = getComputedStyle(text);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    await Promise.all([
      document.fonts.load(font, text.textContent ?? ''),
      document.fonts.load('16px "IBM Plex Mono"'),
    ]).catch(() => undefined);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || my !== builds) return;
    const size = parseFloat(cs.fontSize);
    const density = Math.max(4, Number(ds.density) || 11);
    // cell height from the letter size, never below MIN_ROW (clip) or 5 CSS px
    const clipMode = ds.letters !== 'grid';
    const ch = Math.max(clipMode ? MIN_ROW : 5, size / density);
    // inside clipped letters the rows sit tighter, so the letters read solid
    const fs = ch / (clipMode ? 1.0 : 1.12);
    const cw = fs * 0.6;
    const cols = Math.ceil(w / cw);
    const rows = Math.ceil(h / ch);

    const origin = canvas.getBoundingClientRect();
    const boxes = charBoxes(text);
    // draws the letters at their DOM positions, scaled by sx, sy
    const letters = (x: CanvasRenderingContext2D, sx: number, sy: number, bolder: number) => {
      x.setTransform(sx, 0, 0, sy, 0, 0);
      x.font = font;
      x.textBaseline = 'alphabetic';
      const metrics = x.measureText('ОЖ');
      const asc = metrics.fontBoundingBoxAscent || size * 0.97;
      const desc = metrics.fontBoundingBoxDescent || size * 0.24;
      x.fillStyle = x.strokeStyle = '#000';
      x.lineWidth = bolder;
      x.lineJoin = 'round';
      for (const { ch: c, r } of boxes) {
        const px = r.left - origin.left;
        const py = r.top - origin.top + (r.height - (asc + desc)) / 2 + asc;
        x.fillText(c, px, py);
        if (bolder) x.strokeText(c, px, py);
      }
    };

    // coverage per cell from a K×K-sampled mask; the grid style draws the
    // letters a touch bolder so thin strokes keep a glyph or two
    const mask = document.createElement('canvas');
    mask.width = cols * K;
    mask.height = rows * K;
    const mx = mask.getContext('2d', { willReadFrequently: true })!;
    letters(mx, K / cw, K / ch, clipMode ? 0 : size * 0.035);
    const a = mx.getImageData(0, 0, mask.width, mask.height).data;
    const cov = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let y = 0; y < K; y++) {
          const row = ((r * K + y) * mask.width + c * K) * 4 + 3;
          for (let x = 0; x < K; x++) sum += a[row + x * 4];
        }
        cov[r * cols + c] = sum / (255 * K * K);
      }
    }
    // the rest in later tasks (no long task on a slow phone)
    await yieldTask();
    if (my !== builds) return;
    const n = cols * rows;
    const v = new Float32Array(n);
    const faint = new Uint8Array(n);
    const haloOn = ds.halo === 'on' || (ds.halo !== 'off' && ch >= HALO_ROW && devicePixelRatio >= HALO_DPR);
    const halo = haloOn ? blur(cov, cols, rows, 2) : null;
    let e: Uint8Array;
    let layer: Uint8Array | undefined;
    let clip: HTMLCanvasElement | undefined;
    if (clipMode) {
      // letters with crisp edges, filled with dense glyphs in a slow wave of
      // densities; the halo around them is cut away from the letters
      const dpr = AsciiField.ratio(MAX_DPR);
      clip = document.createElement('canvas');
      clip.width = Math.max(1, Math.round(w * dpr));
      clip.height = Math.max(1, Math.round(h * dpr));
      letters(clip.getContext('2d')!, dpr, dpr, 0);
      layer = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = (i / cols) | 0;
        if (cov[i] > 0.02) {
          const wave = 0.5 + 0.25 * Math.sin(c * 0.19 + r * 0.11) + 0.25 * Math.sin(c * 0.053 - r * 0.31 + 1.3);
          v[i] = 0.72 + 0.28 * wave;
          layer[i] = 1;
        } else if (halo && halo[i] > 0.05) {
          v[i] = Math.min(0.2, 0.06 + halo[i] * 0.4);
          // the halo cells lie fully outside the letters: no cutting needed
          // (one compositing pass less per lens frame)
          faint[i] = 1;
        }
      }
      e = new Uint8Array(n);
    } else {
      // every cell a glyph: density from coverage, strokes on the contours
      for (let i = 0; i < n; i++) {
        if (cov[i] > 0.12) v[i] = 0.45 + 0.55 * cov[i];
        else if (halo && halo[i] > 0.04) {
          v[i] = Math.min(0.32, 0.1 + halo[i] * 0.7);
          faint[i] = 1;
        }
      }
      e = edges(cov, cols, rows, 1.4);
      for (let i = 0; i < n; i++) if (cov[i] < 0.12 || cov[i] > 0.8) e[i] = 0;
    }

    const opts = {
      inverse: ds.mode === 'inverse',
      shimmer: ds.shimmer === 'on',
      radius: 0,
      magnify: 0.85,
      bold: clipMode ? 0.07 : 0,
      maxDpr: MAX_DPR,
    };
    await yieldTask();
    if (my !== builds) return;
    if (!field) field = new AsciiField(root, canvas, opts);
    else field.setOptions(opts);
    // a flat fill under the glyphs, stronger for smaller letters
    const small = Math.min(1, Math.max(0, (FILL_BIG - size) / (FILL_BIG - FILL_SMALL)));
    const tint = clipMode ? (ds.tint ? Number(ds.tint) : TINT + (TINT_SMALL - TINT) * small) : 0;
    // the text turns transparent once the glyphs are on the canvas (the frame
    // that draws them comes before the next paint)
    if (await field.set({ cols, rows, cw, ch, ox: 0, oy: 0, fs, v, e, faint, layer, clip, tint })) root.dataset.state = 'ready';
  };

  const run = () =>
    build().catch(() => {
      root.dataset.state = 'failed';
    });
  // a resize or a new option off screen waits until the headline is back in
  // view (nothing is drawn for a page part nobody sees)
  let inView = true;
  let stale = false;
  const later = () => {
    if (inView) run();
    else stale = true;
  };
  // forced colours: the real text shows in the system colours (CSS), no canvas
  unlessForced(() =>
    whenNear(root, () => {
      run();
      watchInView(root, (v) => {
        inView = v;
        if (v && stale) {
          stale = false;
          run();
        }
      });
      watchSize(root, later);
      new MutationObserver(later).observe(root, {
        attributes: true,
        attributeFilter: ['data-mode', 'data-density', 'data-halo', 'data-shimmer', 'data-letters', 'data-tint'],
      });
    }),
  );
}

document.querySelectorAll<HTMLElement>('[data-ascii-headline]').forEach(setup);
