// DitherPortrait (src/components/glyphs/DitherPortrait.astro): the photo in
// one bit, ink or paper per pixel (the glagstone look), with chunky pixels of
// `data-pixel` CSS px snapped to whole device pixels. Under the cursor or
// finger the pattern changes inside a soft lens whose edge is itself
// dithered (an ordered 4×4 dissolve), so the picture stays 1-bit there too.
//
// Root data attributes:
//   data-mode   "ink" (default) | "inverse" (a negative: paper lines on ink)
//   data-pixel  dither pixel size in CSS px (default 2)
//   data-algo   "atkinson" (default) | "bayer"
//   data-lens   "fine" (default: the same dither, 3× finer) | "coarse" (2× coarser)
//               | "swap" (the other algorithm) | "grey" (the greyscale photo) | "off"
//   data-gamma  tone gamma (default 1.15: a little darker, like the reference)
//   data-crop   "x y w h", fractions of the photo
//   data-src    another picture (same origin): the <img> loads it and the box
//               takes its ratio (the lab's «Фото» buttons)

import { colours, falloff, isForced, isReduced, Lens, luminance, ready, rgb, toneMap, unlessForced, watchInView, watchSize, whenNear } from './core';

type Algo = 'atkinson' | 'bayer';

// Bayer index matrices, built recursively (n = 2, 4, 8), as thresholds in (0, 1)
function bayer(n: number): number[] {
  if (n === 1) return [0];
  const h = n / 2;
  const m = bayer(h);
  const q = [0, 2, 3, 1];
  const out: number[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out.push(4 * m[(y % h) * h + (x % h)] + q[((y / h) | 0) * 2 + ((x / h) | 0)]);
  }
  return out;
}
const BAYER8 = bayer(8).map((v) => (v + 0.5) / 64);
const BAYER4 = bayer(4).map((v) => (v + 0.5) / 16);

/** 1-bit version of a w×h luminance field: 1 = light, 0 = dark. */
function dither(lum: Float32Array, w: number, h: number, algo: Algo): Uint8Array {
  const out = new Uint8Array(w * h);
  if (algo === 'bayer') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = lum[y * w + x] > BAYER8[(y & 7) * 8 + (x & 7)] ? 1 : 0;
    }
    return out;
  }
  // Atkinson: 6/8 of the error to six neighbours (the classic Mac look)
  const e = Float32Array.from(lum);
  const add = (x: number, y: number, v: number) => {
    if (x >= 0 && x < w && y < h) e[y * w + x] += v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bit = e[i] > 0.5 ? 1 : 0;
      out[i] = bit;
      const err = (e[i] - bit) / 8;
      add(x + 1, y, err);
      add(x + 2, y, err);
      add(x - 1, y + 1, err);
      add(x, y + 1, err);
      add(x + 1, y + 1, err);
      add(x, y + 2, err);
    }
  }
  return out;
}

interface Layer {
  /** Values per cell: bits (0/1) or grey (0..255). */
  data: Uint8Array;
  grey: boolean;
  /** Cell size in device px and grid width. */
  b: number;
  gw: number;
}

function setup(root: HTMLElement): void {
  const img = root.querySelector<HTMLImageElement>('img');
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!img || !canvas || !ctx) {
    root.dataset.state = 'failed'; // shows the photo
    return;
  }
  // the still picture and the lens picture, one packed RGBA word per device pixel
  let baseImg: ImageData | null = null;
  let base32: Uint32Array | null = null;
  let alt32: Uint32Array | null = null;
  let colQ = new Uint8Array(0); // Bayer column of each x (in dither pixels)
  let block = 1;
  let dpr = 1;
  let prev: [number, number, number, number] | null = null;
  let scratch: ImageData | null = null;
  let s32: Uint32Array | null = null;

  const layer = (crop: number[] | null, W: number, H: number, b: number, algo: Algo | 'grey', gamma: number): Layer => {
    const gw = Math.ceil(W / b);
    const gh = Math.ceil(H / b);
    const L = toneMap(luminance(img, gw, gh, crop), gw, gh, {
      contrast: 0.7,
      radius: Math.max(2, Math.round(gw / 24)),
      gamma,
    });
    if (algo === 'grey') {
      const data = new Uint8Array(L.length);
      for (let i = 0; i < L.length; i++) data[i] = Math.round(L[i] * 255);
      return { data, grey: true, b, gw };
    }
    return { data: dither(L, gw, gh, algo), grey: false, b, gw };
  };

  // a layer blown up to device pixels, colours packed (little-endian RGBA)
  const expand = (l: Layer, out: Uint32Array, W: number, H: number, ink: number[], paper: number[]) => {
    const pack = (t: number) =>
      ((255 << 24) |
        (Math.round(ink[2] + (paper[2] - ink[2]) * t) << 16) |
        (Math.round(ink[1] + (paper[1] - ink[1]) * t) << 8) |
        Math.round(ink[0] + (paper[0] - ink[0]) * t)) >>>
      0;
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = pack(l.grey ? v / 255 : v ? 1 : 0);
    for (let y = 0, p = 0; y < H; y++) {
      const row = ((y / l.b) | 0) * l.gw;
      for (let x = 0; x < W; x++, p++) out[p] = lut[l.data[row + ((x / l.b) | 0)]];
    }
  };

  const build = async () => {
    const ds = root.dataset;
    if (ds.src && img.getAttribute('src') !== ds.src) img.src = ds.src;
    await ready(img);
    const crop = ds.crop ? ds.crop.split(/[\s,]+/).map(Number) : null;
    {
      // a crop or a picture set after the build (the lab's buttons) also sets the box ratio
      const [, , cw, ch] = crop ?? [0, 0, 1, 1];
      const ratio = `${Math.round(img.naturalWidth * cw)} / ${Math.round(img.naturalHeight * ch)}`;
      if (root.style.getPropertyValue('--dither-ratio') !== ratio) root.style.setProperty('--dither-ratio', ratio);
      if (crop) root.style.setProperty('--dither-pos', `${(crop[0] + cw / 2) * 100}% ${(crop[1] + ch / 2) * 100}%`);
    }
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const W = (canvas.width = Math.round(cssW * dpr));
    const H = (canvas.height = Math.round(cssH * dpr));
    const algo: Algo = ds.algo === 'bayer' ? 'bayer' : 'atkinson';
    const gamma = Number(ds.gamma) || 1.15;
    const c = colours(root, false);
    let ink = rgb(c.fg);
    let paper = rgb(c.bg);
    if (ds.mode === 'inverse') [ink, paper] = [paper, ink];
    const b = (block = Math.max(1, Math.round((Number(ds.pixel) || 2) * dpr)));
    colQ = new Uint8Array(W);
    for (let x = 0; x < W; x++) colQ[x] = ((x / b) | 0) & 3;
    baseImg = ctx.createImageData(W, H);
    base32 = new Uint32Array(baseImg.data.buffer);
    expand(layer(crop, W, H, b, algo, gamma), base32, W, H, ink, paper);
    const lens = ds.lens ?? 'fine';
    const alt =
      lens === 'off'
        ? null
        : lens === 'grey'
          ? layer(crop, W, H, Math.max(1, Math.round(dpr)), 'grey', gamma)
          : lens === 'coarse'
            ? layer(crop, W, H, b * 2, algo, gamma)
            : lens === 'swap'
              ? layer(crop, W, H, b, algo === 'bayer' ? 'atkinson' : 'bayer', gamma)
              : layer(crop, W, H, Math.max(1, Math.round(b / 3)), algo, gamma);
    alt32 = alt ? new Uint32Array(W * H) : null;
    if (alt && alt32) expand(alt, alt32, W, H, ink, paper);
    ctx.putImageData(baseImg, 0, 0);
    prev = null;
    root.dataset.state = 'ready';
    lensCtl.request();
  };

  const frame = () => {
    if (!baseImg || !base32) return;
    const W = canvas.width;
    const H = canvas.height;
    if (prev) ctx.putImageData(baseImg, 0, 0, ...prev);
    prev = null;
    if (!alt32 || lensCtl.s < 0.01 || isReduced() || isForced()) return;
    const R = Math.min(140, Math.max(64, 0.24 * Math.min(canvas.clientWidth, canvas.clientHeight))) * dpr;
    const R2 = R * R;
    const cx = lensCtl.x * dpr;
    const cy = lensCtl.y * dpr;
    const x0 = Math.max(0, Math.floor(cx - R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W, Math.ceil(cx + R));
    const y1 = Math.min(H, Math.ceil(cy + R));
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    if (!scratch || scratch.width !== bw || scratch.height !== bh) {
      scratch = ctx.createImageData(bw, bh);
      s32 = new Uint32Array(scratch.data.buffer);
    }
    const out = s32!;
    const s = lensCtl.s;
    // per pixel: the lens picture where the soft falloff beats an ordered
    // 4×4 threshold (in dither pixels), so the lens edge dissolves in 1 bit
    for (let y = y0, row = 0; y < y1; y++, row += bw) {
      const src = y * W;
      out.set(base32.subarray(src + x0, src + x1), row);
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      if (dy2 >= R2) continue;
      const half = Math.sqrt(R2 - dy2);
      const xa = Math.max(x0, Math.floor(cx - half));
      const xb = Math.min(x1, Math.ceil(cx + half));
      const t = (((y / block) | 0) & 3) * 4;
      for (let x = xa; x < xb; x++) {
        const dx = x + 0.5 - cx;
        const f = falloff(dx * dx + dy2, R2) * s;
        if (f > BAYER4[t + colQ[x]]) out[row + x - x0] = alt32[src + x];
      }
    }
    ctx.putImageData(scratch, x0, y0);
    prev = [x0, y0, bw, bh];
  };

  const lensCtl = new Lens(root, frame);
  const run = () =>
    build().catch(() => {
      root.dataset.state = 'failed';
    });
  // a resize or a new option off screen waits until the portrait is back in
  // view (nothing is drawn for a page part nobody sees)
  let inView = true;
  let stale = false;
  const later = () => {
    if (inView) run();
    else stale = true;
  };
  // forced colours: the photo shows as it is (CSS), no canvas
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
        attributeFilter: ['data-mode', 'data-pixel', 'data-algo', 'data-lens', 'data-gamma', 'data-crop', 'data-src'],
      });
    }),
  );
}

document.querySelectorAll<HTMLElement>('[data-dither-portrait]').forEach(setup);
