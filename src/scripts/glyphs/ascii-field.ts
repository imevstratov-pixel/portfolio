// A field of glyphs on a canvas (AsciiPortrait and AsciiHeadline): one glyph
// per cell, chosen by the cell's density, crisp at any devicePixelRatio.
//
// - Glyphs come from atlases drawn once per size (IBM Plex Mono, ink or
//   paper), so a frame is a few hundred drawImage calls, never fillText.
// - The still picture lives on an offscreen base canvas, drawn in slices of
//   rows with a yield between them (no long task on a slow phone; the canvas
//   keeps the previous picture until the new one is complete). A lens frame
//   copies back only the rectangle the lens left and redraws the cells under it.
// - Lens: a soft fisheye. The glyphs near the cursor move apart and grow (up
//   to 1 + magnify at the centre), the ring around shrinks a little, the
//   glyphs switch to a denser ramp with letters, and a faint radial shade
//   appears under them.
// - Optional clip (AsciiHeadline): cells of layer 1 are cut to the letter
//   shapes, cells of layer 2 (the faint halo) to the space around them, so
//   the letters keep crisp edges while their inside is glyphs.
// - Shimmer (opt-in, `shimmer`): every 140 ms a few glyphs swap for another
//   glyph of the same density for about a second. Off by default (nothing on
//   a page moves by itself, decision 2 of 15.10), and always off with reduced
//   motion, off screen and in a background tab.
// - The lens atlases (every glyph size the lens uses) are drawn ahead, one
//   per idle moment after the picture is set, so the first touch does not
//   stall on them.

import { colours, isForced, isReduced, Lens, pageVisible, rgb, watchInView, watchReduced, yieldTask } from './core';

/** How long the idle shimmer runs each time the field comes into view (WCAG 2.2.2). */
const SHIMMER_MS = 5000;

export interface Grid {
  cols: number;
  rows: number;
  /** Cell size and grid origin in CSS px (origin within the canvas). */
  cw: number;
  ch: number;
  ox: number;
  oy: number;
  /** Glyph font size in CSS px. */
  fs: number;
  /** Density 0..1 per cell (0 is an empty cell). */
  v: Float32Array;
  /** Edge stroke per cell: 0 none, 1 «-», 2 «/», 3 «|», 4 «\». */
  e: Uint8Array;
  /** 1: the cell is drawn faint. */
  faint?: Uint8Array;
  /** Per cell: 0 drawn as is, 1 cut to `clip`, 2 cut to the outside of `clip`. */
  layer?: Uint8Array;
  /** Opaque shapes at device resolution (the canvas size): the letters. */
  clip?: HTMLCanvasElement;
  /** Opacity of a flat fill of the clip shapes under the glyphs (0 = none). */
  tint?: number;
}

export interface FieldOptions {
  inverse: boolean;
  shimmer: boolean;
  /** Lens radius in CSS px; 0 picks one from the size. */
  radius: number;
  /** Magnification at the lens centre minus one. */
  magnify: number;
  /** Faux bold: outline width of the glyphs in em (0 = the regular weight). */
  bold?: number;
  /** Highest device pixel ratio of the canvas (default 2). */
  maxDpr?: number;
}

// Base ramp: dots, quotes, dashes, slashes, brackets, stars, a few round
// letters (the ansenjeo look). Lens ramp: denser, with letters. Glyphs of a
// similar coverage share a level and alternate per cell, so a tone is a
// texture, not one repeated glyph.
const BASE = ".'`,-_~:;=+/\\|()<>*ox%#@";
const DENSE = ".:-=+*coaexkhbdpqXOQBWM#%&@8";
const EDGES = ['-', '/', '|', '\\'];
const LEVELS = 12;
// atlas sizes: 0.625 to 2.25 in eighths; ONE is the index of scale 1
const SCALES = Array.from({ length: 14 }, (_, i) => 0.625 + i * 0.125);
const ONE = 3;
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
const FAINT = 0.38;
// the still picture is drawn in slices of about SLICE glyphs; after BUDGET ms
// of drawing the build yields to the page
const SLICE = 400;
const BUDGET = 12;

type Item = [number, number, number, number, number, number];

const hash = (i: number): number => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

interface Atlas {
  canvas: HTMLCanvasElement;
  sw: number;
  sh: number;
}

/** Glyph coverage (share of the cell that is ink) in IBM Plex Mono, measured once. */
let coverage: Map<string, number> | null = null;
function measure(glyphs: string[]): Map<string, number> {
  if (coverage) return coverage;
  const fs = 40;
  const w = Math.ceil(fs * 0.6);
  const h = Math.ceil(fs * 1.1);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.font = `${fs}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  coverage = new Map();
  for (const g of glyphs) {
    x.clearRect(0, 0, w, h);
    x.fillText(g, w / 2, h / 2);
    const d = x.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    coverage.set(g, sum / (255 * w * h));
  }
  return coverage;
}

/** Glyphs of a ramp grouped into LEVELS levels of equal coverage steps. */
function levels(ramp: string[], cov: Map<string, number>, ids: Map<string, number>): number[][] {
  const max = Math.max(...ramp.map((g) => cov.get(g) ?? 0));
  const out: number[][] = Array.from({ length: LEVELS }, () => []);
  for (const g of ramp) {
    const k = Math.min(LEVELS - 1, Math.max(1, Math.round(((cov.get(g) ?? 0) / max) * (LEVELS - 1))));
    out[k].push(ids.get(g)!);
  }
  // an empty level borrows its nearest neighbour (level 0 stays empty: blank)
  const filled = out.map((a) => a.length > 0);
  for (let k = 1; k < LEVELS; k++) {
    for (let d = 1; !out[k].length && d < LEVELS; d++) {
      if (k - d > 0 && filled[k - d]) out[k] = out[k - d];
      else if (k + d < LEVELS && filled[k + d]) out[k] = out[k + d];
    }
  }
  return out;
}

type Box = [number, number, number, number];

export class AsciiField {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private bctx = this.base.getContext('2d')!;
  // scratch canvases for clipped glyphs, one per use and layer ("lens1",
  // "cell2", …), each as large as its largest box so far. A canvas that was
  // just drawn from and is then changed gets copied by the browser, so they
  // are never shared between uses; only the build's "band" ones are as wide
  // as the whole picture, and they go once it is drawn.
  private scratch = new Map<string, CanvasRenderingContext2D>();
  // paper plus the flat letter fill (Grid.tint): what an empty cell looks like
  private back: HTMLCanvasElement | null = null;
  private glyphs: string[] = [];
  private ids = new Map<string, number>();
  private baseLv: number[][] = [];
  private denseLv: number[][] = [];
  private atlases: (Atlas | null)[] = [];
  private atlasKey = '';
  private grid: Grid | null = null;
  private lv = new Uint8Array(0); // ramp level per cell
  private alt = new Uint8Array(0); // shimmer offset per cell
  private until = new Float64Array(0); // shimmer end time per cell
  private live: number[] = []; // cells shimmering now
  private dpr = 1;
  private bg = '#fff';
  private fgRgb: [number, number, number] = [0, 0, 0];
  private prevBox: Box | null = null;
  private full = true;
  private inView = true;
  // the shimmer runs for SHIMMER_MS after the field comes into view or the tab
  // comes back, then rests (WCAG 2.2.2: no motion longer than 5 s without a pause control)
  private shimmerUntil = 0;
  private nextTick = 0;
  private timer = 0;
  private warm = 0;
  // generation of the latest set() and of the build still drawing (0: none)
  private gen = 0;
  private building = 0;
  readonly lens: Lens;

  constructor(
    private root: HTMLElement,
    private canvas: HTMLCanvasElement,
    public opts: FieldOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    for (const g of new Set([...BASE, ...DENSE, ...EDGES])) {
      this.ids.set(g, this.glyphs.length);
      this.glyphs.push(g);
    }
    const cov = measure(this.glyphs);
    this.baseLv = levels([...BASE], cov, this.ids);
    this.denseLv = levels([...DENSE], cov, this.ids);
    this.lens = new Lens(root, (now) => this.frame(now));
    this.shimmerUntil = performance.now() + SHIMMER_MS;
    watchInView(root, (v) => {
      if (v && !this.inView) this.shimmerUntil = performance.now() + SHIMMER_MS;
      this.inView = v;
      this.schedule();
    });
    document.addEventListener('visibilitychange', () => {
      if (pageVisible()) this.shimmerUntil = performance.now() + SHIMMER_MS;
      this.schedule();
    });
    watchReduced(() => {
      this.resetShimmer();
      this.schedule();
      this.prewarm();
    });
  }

  /** Device pixel ratio of the canvas: 1..max (a 3× phone gets 2×: crisp, and 2.25× fewer pixels per frame). */
  static ratio(max = 2): number {
    return Math.min(max, Math.max(1, devicePixelRatio || 1));
  }

  /**
   * Sets a new grid (after a resize, a mode change or new data) and draws it.
   * The still picture is drawn in slices with a yield between them; until it
   * is complete the canvas keeps the previous picture and the lens and the
   * shimmer wait. Resolves true once the new picture is on the canvas (in the
   * next animation frame, before it is painted), false when a later set()
   * replaced this one.
   */
  async set(grid: Grid): Promise<boolean> {
    if (this.opts.shimmer) this.shimmerUntil = performance.now() + SHIMMER_MS;
    const gen = ++this.gen;
    this.building = gen;
    this.grid = grid;
    const n = grid.cols * grid.rows;
    this.dpr = AsciiField.ratio(this.opts.maxDpr);
    const W = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const H = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    this.base.width = W;
    this.base.height = H;
    const { fg, bg } = colours(this.root, this.opts.inverse);
    this.bg = bg;
    this.fgRgb = rgb(fg);
    const key = `${grid.fs}|${this.dpr}|${fg}|${this.opts.bold ?? 0}`;
    if (key !== this.atlasKey) {
      this.atlasKey = key;
      this.atlases = [...SCALES, ...SCALES].map(() => null);
    }
    this.lv = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.lv[i] = Math.round(Math.min(1, Math.max(0, grid.v[i])) * (LEVELS - 1));
    this.alt = new Uint8Array(n);
    this.until = new Float64Array(n);
    this.live = [];
    this.back = null;
    if (grid.clip && grid.tint) {
      // the letters in the glyph colour, laid faintly over paper
      const t = document.createElement('canvas');
      t.width = W;
      t.height = H;
      const x = t.getContext('2d')!;
      x.fillStyle = fg;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(grid.clip, 0, 0, W, H);
      const b = (this.back = document.createElement('canvas'));
      b.width = W;
      b.height = H;
      const y = b.getContext('2d')!;
      y.fillStyle = bg;
      y.fillRect(0, 0, W, H);
      y.globalAlpha = grid.tint;
      y.drawImage(t, 0, 0);
    }
    await yieldTask();
    if (gen !== this.gen || !(await this.drawBase(gen))) return false;
    // the new picture is complete: the screen canvas takes its size (which
    // clears it) and gets it in the next frame, before the page is painted
    this.canvas.width = W;
    this.canvas.height = H;
    this.building = 0;
    this.full = true;
    this.prevBox = null;
    this.lens.request();
    this.schedule();
    this.prewarm();
    return true;
  }

  /** Draws the lens atlases ahead, one per idle moment (no lens: none needed). */
  private prewarm(): void {
    // Safari has no requestIdleCallback: a short timeout per atlas instead
    const ric = typeof requestIdleCallback === 'function';
    const idle = (cb: () => void): number => (ric ? requestIdleCallback(cb, { timeout: 1500 }) : window.setTimeout(cb, 60));
    if (ric) cancelIdleCallback(this.warm);
    else clearTimeout(this.warm);
    if (isReduced() || isForced() || !this.grid) return;
    const key = this.atlasKey;
    const todo: [number, number][] = [];
    const faints = this.grid.faint?.some((f) => f) ? [0, 1] : [0];
    for (let level = SCALES.length - 1; level >= 0; level--) for (const f of faints) todo.push([level, f]);
    const step = () => {
      if (this.atlasKey !== key) return;
      const next = todo.shift();
      if (!next) return;
      this.atlas(next[0], next[1]);
      this.warm = idle(step);
    };
    this.warm = idle(step);
  }

  setOptions(opts: Partial<FieldOptions>): void {
    Object.assign(this.opts, opts);
  }

  // ---------------------------------------------------------------- glyphs

  /** Glyph strip of one size; `faint` bakes the halo's opacity in (no globalAlpha per glyph). */
  private atlas(level: number, faint = 0): Atlas {
    const key = level + faint * SCALES.length;
    let a = this.atlases[key];
    if (a) return a;
    const px = this.grid!.fs * SCALES[level] * this.dpr;
    const sw = Math.ceil(px * 0.72) + 2;
    const sh = Math.ceil(px * 1.3) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = sw * this.glyphs.length;
    canvas.height = sh;
    const x = canvas.getContext('2d')!;
    x.font = `${px}px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = x.strokeStyle = `rgb(${this.fgRgb.join(',')})`;
    x.lineWidth = (this.opts.bold ?? 0) * px;
    x.lineJoin = 'round';
    x.globalAlpha = faint ? FAINT : 1;
    this.glyphs.forEach((ch, i) => {
      x.fillText(ch, i * sw + sw / 2, sh / 2);
      if (x.lineWidth) x.strokeText(ch, i * sw + sw / 2, sh / 2);
    });
    a = { canvas, sw, sh };
    this.atlases[key] = a;
    return a;
  }

  private put(ctx: CanvasRenderingContext2D, id: number, level: number, cx: number, cy: number, faint = 0): void {
    const a = this.atlas(level, faint);
    ctx.drawImage(a.canvas, id * a.sw, 0, a.sw, a.sh, Math.round(cx - a.sw / 2), Math.round(cy - a.sh / 2), a.sw, a.sh);
  }

  /** Glyph id of cell i at ramp level k (shimmer offset `alt`), or -1 for blank. */
  private glyph(i: number, k: number, dense: boolean, alt: number): number {
    const g = this.grid!;
    const e = g.e[i];
    // letters (layer 1) always take the dense ramp
    dense ||= g.layer?.[i] === 1;
    if (e && !dense) return this.ids.get(EDGES[e - 1])!;
    if (k <= 0) return -1;
    let set = (dense ? this.denseLv : this.baseLv)[Math.min(LEVELS - 1, k)];
    if (alt && set.length < 2) set = this.baseLv[Math.max(1, Math.min(LEVELS - 1, k + (alt & 1 ? 1 : -1)))];
    return set[(hash(i) + alt) % set.length];
  }

  private cellRect(i: number): Box {
    const g = this.grid!;
    const d = this.dpr;
    const c = i % g.cols;
    const r = (i / g.cols) | 0;
    const x0 = Math.floor((g.ox + c * g.cw) * d);
    const y0 = Math.floor((g.oy + r * g.ch) * d);
    return [x0, y0, Math.ceil((g.ox + (c + 1) * g.cw) * d) - x0, Math.ceil((g.oy + (r + 1) * g.ch) * d) - y0];
  }

  private center(i: number): [number, number] {
    const g = this.grid!;
    return [(g.ox + ((i % g.cols) + 0.5) * g.cw) * this.dpr, (g.oy + (((i / g.cols) | 0) + 0.5) * g.ch) * this.dpr];
  }

  /**
   * Draws glyphs onto `ctx` within `box`. Cells of layer 0 go straight on;
   * layers 1 and 2 are drawn on the scratch canvas, cut by the clip (or its
   * outside) and copied over. Items: [cell, glyph, size level, x, y, faint 0|1].
   */
  private paint(
    ctx: CanvasRenderingContext2D,
    box: Box,
    items: Item[],
    use: string,
  ): void {
    const g = this.grid!;
    const [bx, by, bw, bh] = box;
    if (bw <= 0 || bh <= 0) return;
    for (const layer of [0, 1, 2]) {
      const these = items.filter(([i]) => (g.layer?.[i] ?? 0) === layer);
      if (!these.length) continue;
      const clip = layer ? g.clip : undefined;
      let target = ctx;
      if (clip) {
        const key = use + layer;
        let t = this.scratch.get(key);
        if (!t) {
          t = document.createElement('canvas').getContext('2d')!;
          this.scratch.set(key, t);
        }
        const c = t.canvas;
        if (c.width < bw || c.height < bh) {
          c.width = Math.max(c.width, bw);
          c.height = Math.max(c.height, bh);
        }
        target = t;
        target.setTransform(1, 0, 0, 1, -bx, -by);
        target.clearRect(bx, by, bw, bh);
      }
      for (const [, id, level, x, y, faint] of these) this.put(target, id, level, x, y, faint);
      if (clip) {
        target.globalCompositeOperation = layer === 1 ? 'destination-in' : 'destination-out';
        target.drawImage(clip, bx, by, bw, bh, bx, by, bw, bh);
        target.globalCompositeOperation = 'source-over';
        target.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(target.canvas, 0, 0, bw, bh, bx, by, bw, bh);
      }
    }
  }

  /** Empties a box: paper, plus the flat letter fill when there is one. */
  private blank(ctx: CanvasRenderingContext2D, box: Box): void {
    if (box[2] <= 0 || box[3] <= 0) return;
    if (this.back) ctx.drawImage(this.back, ...box, ...box);
    else {
      ctx.fillStyle = this.bg;
      ctx.fillRect(...box);
    }
  }

  private baseItem(i: number): Item | null {
    const id = this.glyph(i, this.lv[i], false, this.alt[i]);
    if (id < 0) return null;
    const [x, y] = this.center(i);
    return [i, id, ONE, x, y, this.grid!.faint?.[i] ? 1 : 0];
  }

  /** Draws the still picture in slices of rows; false when a later set() took over. */
  private async drawBase(gen: number): Promise<boolean> {
    const g = this.grid!;
    const b = this.bctx;
    const W = this.base.width;
    this.blank(b, [0, 0, W, this.base.height]);
    // a glyph reaches this far beyond its row (the atlas cell is taller)
    const pad = Math.ceil(this.atlas(ONE).sh / 2) + 1;
    let items: Item[] = [];
    let top = 0;
    let t0 = performance.now();
    for (let r = 0; r < g.rows; r++) {
      for (let i = r * g.cols, end = i + g.cols; i < end; i++) {
        const it = this.baseItem(i);
        if (it) items.push(it);
      }
      const last = r === g.rows - 1;
      if (items.length < SLICE && !last) continue;
      const y0 = this.cellRect(top * g.cols)[1];
      const [, y1, , h1] = this.cellRect(r * g.cols);
      this.paint(b, this.clamp([0, y0 - pad, W, y1 + h1 - y0 + 2 * pad]), items, 'band');
      items = [];
      top = r + 1;
      if (!last && performance.now() - t0 > BUDGET) {
        await yieldTask();
        if (gen !== this.gen) return false;
        t0 = performance.now();
      }
    }
    // the band canvases are as wide as the picture: not kept
    this.scratch.delete('band1');
    this.scratch.delete('band2');
    return true;
  }

  private redrawBaseCell(i: number): void {
    if (this.building) return;
    const box = this.clamp(this.cellRect(i));
    this.blank(this.bctx, box);
    const it = this.baseItem(i);
    if (!it) return;
    this.bctx.save();
    this.bctx.beginPath();
    this.bctx.rect(...box);
    this.bctx.clip();
    this.paint(this.bctx, box, [it], 'cell');
    this.bctx.restore();
  }

  // --------------------------------------------------------------- shimmer

  private shimmerOn(): boolean {
    return (
      this.opts.shimmer && !isReduced() && !isForced() && this.inView && pageVisible() && !!this.grid &&
      performance.now() < this.shimmerUntil
    );
  }

  private resetShimmer(): void {
    if (!this.grid) return;
    for (const i of this.live) {
      this.alt[i] = 0;
      this.redrawBaseCell(i);
    }
    this.live = [];
    this.full = true;
  }

  /** Keeps a slow timer going while the shimmer should run. */
  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.shimmerOn()) {
      // time is up or the field left the screen: one more frame puts every glyph back
      if (this.live.length) this.lens.request();
      return;
    }
    this.timer = window.setTimeout(() => {
      this.lens.request();
      this.schedule();
    }, 140);
  }

  private shimmer(now: number): number[] {
    const g = this.grid!;
    const changed: number[] = [];
    if (now < this.nextTick) return changed;
    this.nextTick = now + 130;
    this.live = this.live.filter((i) => {
      if (this.until[i] > now) return true;
      this.alt[i] = 0;
      changed.push(i);
      return false;
    });
    const n = g.cols * g.rows;
    const count = Math.max(1, Math.round(n * 0.003));
    for (let k = 0, added = 0; k < count * 4 && added < count; k++) {
      const i = (Math.random() * n) | 0;
      if (this.lv[i] < 1 || g.e[i] || this.alt[i]) continue;
      this.alt[i] = 1 + ((Math.random() * 5) | 0);
      this.until[i] = now + 600 + Math.random() * 900;
      this.live.push(i);
      changed.push(i);
      added++;
    }
    for (const i of changed) this.redrawBaseCell(i);
    return changed;
  }

  // ----------------------------------------------------------------- frame

  /** A box in whole device pixels, within the picture (width or height may be 0). */
  private clamp(box: Box): Box {
    const x = Math.max(0, Math.floor(box[0]));
    const y = Math.max(0, Math.floor(box[1]));
    const w = Math.max(0, Math.min(this.base.width, Math.ceil(box[0] + box[2])) - x);
    const h = Math.max(0, Math.min(this.base.height, Math.ceil(box[1] + box[3])) - y);
    return [x, y, w, h];
  }

  /** Copies a box of the still picture onto the screen canvas. */
  private copy(box: Box): void {
    const b = this.clamp(box);
    if (b[2] > 0 && b[3] > 0) this.ctx.drawImage(this.base, ...b, ...b);
  }

  private frame(now: number): void {
    const g = this.grid;
    // a new picture is being drawn: the canvas keeps the previous one
    if (!g || this.building) return;
    const ctx = this.ctx;
    if (this.shimmerOn()) {
      for (const i of this.shimmer(now)) {
        const [x, y, w, h] = this.cellRect(i);
        this.copy([x - 1, y - 1, w + 2, h + 2]);
      }
    } else if (this.live.length) this.resetShimmer();
    if (this.full) {
      ctx.drawImage(this.base, 0, 0);
      this.full = false;
    } else if (this.prevBox) this.copy(this.prevBox);
    this.prevBox = null;
    const L = this.lens;
    if (L.s < 0.01 || isReduced() || isForced()) return;

    const d = this.dpr;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const R = this.opts.radius || Math.min(140, Math.max(72, 0.25 * Math.min(cssW, cssH)));
    const R2 = R * R;
    const sig2 = (R / 2.2) ** 2; // Gaussian profile, ~0 at R
    const m = this.opts.magnify * L.s;
    const big = this.atlas(SCALES.length - 1);
    const pad = Math.max(big.sw, big.sh) / 2 + 2;
    const box: Box = [(L.x - R) * d - pad, (L.y - R) * d - pad, 2 * R * d + 2 * pad, 2 * R * d + 2 * pad];
    this.copy(box);
    this.prevBox = box;
    const ibox = this.clamp(box);
    if (ibox[2] <= 0 || ibox[3] <= 0) return;

    // cells under the lens: clear them, then draw them displaced
    const c0 = Math.max(0, Math.floor((L.x - R - g.ox) / g.cw));
    const c1 = Math.min(g.cols - 1, Math.ceil((L.x + R - g.ox) / g.cw));
    const r0 = Math.max(0, Math.floor((L.y - R - g.oy) / g.ch));
    const r1 = Math.min(g.rows - 1, Math.ceil((L.y + R - g.oy) / g.ch));
    const under: { i: number; dx: number; dy: number; d2: number }[] = [];
    for (let r = r0; r <= r1; r++) {
      // the cells of a row inside the circle are one run: blank it at once
      let first = -1;
      let last = -1;
      for (let c = c0; c <= c1; c++) {
        const dx = g.ox + (c + 0.5) * g.cw - L.x;
        const dy = g.oy + (r + 0.5) * g.ch - L.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2) continue;
        const i = r * g.cols + c;
        if (first < 0) first = i;
        last = i;
        under.push({ i, dx, dy, d2 });
      }
      if (first >= 0) {
        const a = this.cellRect(first);
        const z = this.cellRect(last);
        this.blank(ctx, this.clamp([a[0], a[1], z[0] + z[2] - a[0], a[3]]));
      }
    }
    // a faint radial shade under the glyphs
    const [cr, cg, cb] = this.fgRgb;
    const shade = ctx.createRadialGradient(L.x * d, L.y * d, 0, L.x * d, L.y * d, R * d);
    shade.addColorStop(0, `rgba(${cr},${cg},${cb},${0.08 * L.s})`);
    shade.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.035 * L.s})`);
    shade.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(L.x * d, L.y * d, R * d, 0, Math.PI * 2);
    ctx.fill();

    // far cells first, so the big glyphs at the centre sit on top
    under.sort((a, b) => b.d2 - a.d2);
    const items: Item[] = [];
    for (const u of under) {
      const w = Math.exp(-u.d2 / sig2); // 1 at the centre
      const mag = 1 + m * w; // spacing (radial position factor)
      const slope = 1 + m * w * (1 - (2 * u.d2) / sig2); // radial derivative
      const scale = Math.sqrt(Math.max(0.3, slope) * mag); // area-true glyph size
      const k = this.lv[u.i] > 0 ? Math.min(LEVELS - 1, this.lv[u.i] + Math.round(w * L.s * 2)) : 0;
      const dense = (hash(u.i * 7 + 1) & 1023) / 1024 < w * L.s * 1.5;
      const id = this.glyph(u.i, k, dense, this.alt[u.i]);
      if (id < 0) continue;
      const level = Math.min(SCALES.length - 1, Math.max(0, Math.round((scale - SCALES[0]) / 0.125)));
      // halo glyphs turn full ink near the centre
      const faint = g.faint?.[u.i] && w * L.s < 0.5 ? 1 : 0;
      items.push([u.i, id, level, (L.x + u.dx * mag) * d, (L.y + u.dy * mag) * d, faint]);
    }
    this.paint(ctx, ibox, items, 'lens');
  }
}

/** Sobel edge direction (1 «-», 2 «/», 3 «|», 4 «\») where the gradient is strong. */
export function edges(v: Float32Array, cols: number, rows: number, threshold: number): Uint8Array {
  const e = new Uint8Array(cols * rows);
  if (threshold <= 0) return e;
  const at = (c: number, r: number) => v[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gx = at(c + 1, r - 1) + 2 * at(c + 1, r) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c - 1, r) - at(c - 1, r + 1);
      const gy = at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c, r - 1) - at(c + 1, r - 1);
      if (Math.hypot(gx, gy) < threshold) continue;
      // gradient angle in [0, π): 0 → vertical stroke, π/2 → horizontal.
      // Screen y points down: a gradient towards the lower right means a
      // stroke rising to the right, «/».
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      e[r * cols + c] = [3, 2, 1, 4][Math.round(a / (Math.PI / 4)) % 4];
    }
  }
  return e;
}
