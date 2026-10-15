// AsciiPortrait (src/components/lab/AsciiPortrait.astro): the photo as a
// field of glyphs. The <img> is the pixel source and the fallback without
// JS; the canvas is aria-hidden, the box carries role="img" and the alt.
//
// Root data attributes (read again when they change):
//   data-mode    "ink" (black on white, default) | "inverse" (white on black)
//   data-cols    glyphs per row (default 80); the glyph size follows the width
//   data-crop    "x y w h", fractions of the photo (default the whole photo)
//   data-edges   Sobel threshold for the stroke glyphs (default 1.3, 0 = off)
//   data-gamma   tone gamma (default 1.5: light mid-tones, dense glyphs in the darks)
//   data-shimmer "on" turns the idle shimmer on (default off)
//   data-src     another picture (same origin): the <img> loads it and the
//                box takes its ratio (the lab's «Фото» buttons)

import { AsciiField, edges } from '../glyphs/ascii-field';
import { luminance, ready, toneMap, unlessForced, watchSize, whenNear } from '../glyphs/core';

const FONT_PROBE = '16px "IBM Plex Mono"';

function setup(root: HTMLElement): void {
  const img = root.querySelector<HTMLImageElement>('img');
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  if (!img || !canvas || !canvas.getContext?.('2d')) {
    root.dataset.state = 'failed'; // shows the photo
    return;
  }
  let field: AsciiField | null = null;

  const build = async () => {
    const ds = root.dataset;
    const inverse = ds.mode === 'inverse';
    const crop = ds.crop ? ds.crop.split(/[\s,]+/).map(Number) : null;
    if (ds.src && img.getAttribute('src') !== ds.src) img.src = ds.src;
    await ready(img);
    await document.fonts.load(FONT_PROBE).catch(() => undefined);
    {
      // a crop or a picture set after the build (the lab's buttons) also sets the box ratio
      const [, , cw, ch] = crop ?? [0, 0, 1, 1];
      const ratio = `${Math.round(img.naturalWidth * cw)} / ${Math.round(img.naturalHeight * ch)}`;
      if (root.style.getPropertyValue('--ascii-ratio') !== ratio) root.style.setProperty('--ascii-ratio', ratio);
      if (crop) root.style.setProperty('--ascii-pos', `${(crop[0] + cw / 2) * 100}% ${(crop[1] + ch / 2) * 100}%`);
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cols = Math.max(16, Math.round(Number(ds.cols) || 80));
    const cw = w / cols;
    const fs = cw / 0.6; // IBM Plex Mono advance is 0.6 em
    const ch = fs * 1.12;
    const rows = Math.max(1, Math.floor(h / ch));
    // tone: stretch levels, local contrast over ~1/14 of the width
    const L = toneMap(luminance(img, cols, rows, crop), cols, rows, {
      contrast: 0.9,
      radius: Math.max(2, Math.round(cols / 14)),
    });
    // a gamma above 1 keeps the mid-tones light: dense glyphs only in the darks
    const gamma = Number(ds.gamma) || 1.5;
    const v = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const t = inverse ? L[i] : 1 - L[i];
      // the lightest tones (for ink: walls, highlights) stay paper
      v[i] = Math.max(0, (t - 0.14) / 0.86) ** gamma;
    }
    const thr = ds.edges === undefined ? 1.3 : Number(ds.edges);
    const e = edges(L, cols, rows, thr);
    // strokes only where the cell is neither empty nor solid
    for (let i = 0; i < e.length; i++) if (v[i] < 0.08 || v[i] > 0.82) e[i] = 0;
    const opts = { inverse, shimmer: ds.shimmer === 'on', radius: 0, magnify: 0.9 };
    if (!field) field = new AsciiField(root, canvas, opts);
    else field.setOptions(opts);
    if (await field.set({ cols, rows, cw, ch, ox: 0, oy: (h - rows * ch) / 2, fs, v, e })) root.dataset.state = 'ready';
  };

  const run = () =>
    build().catch(() => {
      root.dataset.state = 'failed';
    });
  // forced colours: the photo shows as it is (CSS), no canvas
  unlessForced(() =>
    whenNear(root, () => {
      run();
      watchSize(root, run);
      new MutationObserver(run).observe(root, {
        attributes: true,
        attributeFilter: ['data-mode', 'data-cols', 'data-crop', 'data-edges', 'data-shimmer', 'data-gamma', 'data-src'],
      });
    }),
  );
}

document.querySelectorAll<HTMLElement>('[data-ascii-portrait]').forEach(setup);
