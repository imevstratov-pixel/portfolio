// Shared pieces of the canvas islands (AsciiHeadline and DitherPortrait on
// the home page, AsciiPortrait on /lab/): reduced motion, colours from the
// tokens, lazy start, visibility, resize, yielding, the cursor/finger lens
// and image luminance.
//
// No word "hid" + "den" anywhere in this code: leakcheck greps the built
// bundles for it (so page visibility is read as visibilityState !== 'visible').

const reducedQuery: MediaQueryList | null =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** True when the visitor asked for reduced motion: no lens, no shimmer. */
export const isReduced = (): boolean => !!reducedQuery?.matches;

/** Calls `cb` when the reduced-motion preference changes. */
export function watchReduced(cb: () => void): void {
  reducedQuery?.addEventListener('change', cb);
}

const forcedQuery: MediaQueryList | null =
  typeof matchMedia === 'function' ? matchMedia('(forced-colors: active)') : null;

/**
 * Forced colours (Windows contrast themes): the canvases would keep the
 * tokens' ink and paper, which the theme does not change, so the islands
 * draw nothing and the CSS shows the real text or the photo instead.
 */
export const isForced = (): boolean => !!forcedQuery?.matches;

/** Runs `cb` now, or once forced colours are turned off. */
export function unlessForced(cb: () => void): void {
  if (!forcedQuery || !forcedQuery.matches) return cb();
  const on = () => {
    if (forcedQuery.matches) return;
    forcedQuery.removeEventListener('change', on);
    cb();
  };
  forcedQuery.addEventListener('change', on);
}

export const pageVisible = (): boolean => document.visibilityState === 'visible';

/** Ink and paper from the tokens (--ink, --paper), swapped for mode "inverse". */
export function colours(el: Element, inverse: boolean): { fg: string; bg: string } {
  const cs = getComputedStyle(el);
  const ink = cs.getPropertyValue('--ink').trim() || '#000';
  const paper = cs.getPropertyValue('--paper').trim() || '#fff';
  return inverse ? { fg: paper, bg: ink } : { fg: ink, bg: paper };
}

/** [r, g, b] of a CSS colour (any syntax the canvas understands). */
export function rgb(colour: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d')!;
  x.fillStyle = colour;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Resolves in a new task: long work yields to the page in between (no long task). */
export const yieldTask = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

/** Runs `cb` once, when the element comes within 400px of the viewport. */
export function whenNear(el: Element, cb: () => void): void {
  if (!('IntersectionObserver' in window)) return cb();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        cb();
      }
    },
    { rootMargin: '400px 0px' },
  );
  io.observe(el);
}

/** Calls `cb(inView)` whenever the element enters or leaves the viewport. */
export function watchInView(el: Element, cb: (inView: boolean) => void): void {
  if (!('IntersectionObserver' in window)) return cb(true);
  new IntersectionObserver((entries) => cb(entries[entries.length - 1].isIntersecting)).observe(el);
}

/**
 * Calls `cb()` after the element's width or the device pixel ratio changed
 * (debounced: one rebuild after a window drag, not one per frame).
 */
export function watchSize(el: Element, cb: () => void): void {
  let w = 0;
  let dpr = devicePixelRatio;
  let t = 0;
  const fire = () => {
    clearTimeout(t);
    t = window.setTimeout(cb, 120);
  };
  new ResizeObserver((entries) => {
    const nw = entries[0].contentRect.width;
    if (w && Math.abs(nw - w) > 0.5) fire();
    w = nw;
  }).observe(el);
  // a window moved to a screen with another pixel density
  const watchDpr = () => {
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener(
      'change',
      () => {
        dpr = devicePixelRatio;
        fire();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();
}

/** Resolves when the image has loaded and decoded (rejects on error). */
export async function ready(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (img.loading === 'lazy') img.loading = 'eager';
  if (!img.complete) {
    await new Promise<void>((res, rej) => {
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => rej(new Error('image failed')), { once: true });
    });
  }
  if (!img.naturalWidth) throw new Error('image failed');
  await img.decode().catch(() => undefined);
  return img;
}

/**
 * Luminance 0..1 of an image (or a crop of it, fractions x, y, w, h) sampled
 * into a w×h grid. The browser's resampler averages the source pixels.
 */
export function luminance(
  img: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  w: number,
  h: number,
  crop: number[] | null,
): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  const [cx, cy, cw, chh] = crop ?? [0, 0, 1, 1];
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  x.drawImage(img, cx * nw, cy * nh, cw * nw, chh * nh, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  }
  return out;
}

/** In-place box blur of a w×h field (radius in cells), two passes. */
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (a: Float32Array, b: Float32Array, horiz: boolean) => {
    const n = horiz ? w : h;
    const m = horiz ? h : w;
    for (let k = 0; k < m; k++) {
      let acc = 0;
      const at = (i: number) => a[horiz ? k * w + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * w + k];
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < n; i++) {
        b[horiz ? k * w + i : i * w + k] = acc / (2 * r + 1);
        acc += at(i + r + 1) - at(i - r);
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  pass(out, tmp, true);
  pass(tmp, out, false);
  return out;
}

/**
 * Tone mapping for a dull photo: stretch the 2nd..98th percentile to 0..1,
 * add local contrast (unsharp mask over `radius` cells), then a gamma.
 */
export function toneMap(
  lum: Float32Array,
  w: number,
  h: number,
  { contrast = 0.6, radius = 0, gamma = 1 }: { contrast?: number; radius?: number; gamma?: number } = {},
): Float32Array {
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const span = Math.max(1e-3, hi - lo);
  let out = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = Math.min(1, Math.max(0, (lum[i] - lo) / span));
  if (radius > 0 && contrast > 0) {
    const b = blur(out, w, h, radius);
    for (let i = 0; i < out.length; i++) out[i] = out[i] + contrast * (out[i] - b[i]);
  }
  for (let i = 0; i < out.length; i++) {
    const v = Math.min(1, Math.max(0, out[i]));
    out[i] = gamma === 1 ? v : Math.pow(v, gamma);
  }
  return out;
}

/** Soft lens falloff: 1 at the centre, 0 at the rim, smooth at both ends. */
export const falloff = (d2: number, r2: number): number => {
  if (d2 >= r2) return 0;
  const q = 1 - d2 / r2;
  return q * q;
};

export interface LensState {
  /** Centre in CSS px within the element. */
  x: number;
  y: number;
  /** Strength 0..1 (fades in on enter, out on leave). */
  s: number;
}

/**
 * The cursor or finger lens. Mouse and pen: pointer events. Touch: passive
 * touch events, so the lens follows the finger and the page still scrolls.
 * Owns the animation-frame loop of its island: `draw` runs in a frame while
 * the lens moves or fades, or after `request()` (shimmer, rebuild).
 * Reduced motion: no input, `draw` only runs on request (static picture).
 */
export class Lens implements LensState {
  x = 0;
  y = 0;
  s = 0;
  private tx = 0;
  private ty = 0;
  private ts = 0;
  private raf = 0;
  private last = 0;

  constructor(
    el: HTMLElement,
    private draw: (now: number) => void,
  ) {
    const set = (cx: number, cy: number) => {
      if (isReduced() || isForced()) return;
      const r = el.getBoundingClientRect();
      this.tx = cx - r.left;
      this.ty = cy - r.top;
      if (this.s < 0.02) {
        this.x = this.tx;
        this.y = this.ty;
      }
      this.ts = 1;
      this.request();
    };
    const release = () => {
      this.ts = 0;
      this.request();
    };
    const opt = { passive: true } as const;
    el.addEventListener('pointermove', (e) => e.pointerType !== 'touch' && set(e.clientX, e.clientY), opt);
    el.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && release(), opt);
    el.addEventListener('touchstart', (e) => set(e.touches[0].clientX, e.touches[0].clientY), opt);
    el.addEventListener('touchmove', (e) => set(e.touches[0].clientX, e.touches[0].clientY), opt);
    el.addEventListener('touchend', (e) => e.touches.length === 0 && release(), opt);
    el.addEventListener('touchcancel', release, opt);
    watchReduced(() => {
      this.ts = this.s = 0;
      this.request();
    });
  }

  /** Schedules one frame (more follow while the lens is moving). */
  request(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.raf = 0;
    const dt = Math.min(64, this.last ? now - this.last : 16);
    // time-based easing: position settles in ~0.1 s, strength in ~0.3 s
    const kp = 1 - Math.exp(-dt / 45);
    const ks = 1 - Math.exp(-dt / 110);
    this.x += (this.tx - this.x) * kp;
    this.y += (this.ty - this.y) * kp;
    this.s += (this.ts - this.s) * ks;
    if (Math.abs(this.ts - this.s) < 0.004) this.s = this.ts;
    const moving = Math.abs(this.tx - this.x) > 0.3 || Math.abs(this.ty - this.y) > 0.3 || this.s !== this.ts;
    this.draw(now);
    if (moving) {
      this.last = now;
      this.request();
    } else this.last = 0;
  }
}
