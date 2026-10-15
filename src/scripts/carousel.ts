// Carousel rows (src/components/Carousel.astro).
//
// Two modes on the same markup (track > rail > slides):
//
// native (no motion: prefers-reduced-motion other than «no-preference»,
// and before Embla is loaded): the track scrolls with scroll snap.
// «Назад» and «Дальше» move the row by one slide at once: no smooth
// scrolling, no autoplay. The arrow keys do the same while the row has
// focus.
//
// embla (motion allowed, decision 2 of 15.10): Embla Carousel, the engine of
// the shadcn/ui carousel, takes the row over once it comes near the screen
// (loaded then, not with the page): drag and swipe with momentum, snap to a
// slide (cards: one per swipe; media: a flick may pass several), trackpad
// and wheel through the wheel-gestures plugin, buttons and arrow keys glide
// to the next slide, Tab into a slide scrolls it into view. A drag never
// starts on a video that has been played (its controls and timeline keep
// the pointer).
//
// Both: the counter names the slides fully in view, «2 из 5» or «1–2 из 5»,
// updated once the row has come to rest. The bar shows once the root has
// data-ready (set here), so without JS there is no bar and the row still
// scrolls by swipe or trackpad. The counter becomes a polite live region
// after its first update (aria-live is added only then, so the page load
// announces nothing). When every slide fits, the root gets data-static and
// the CSS removes the bar. Moving to another slide pauses the row's videos.
// The mode follows the reduced-motion setting when it changes.

import type { EmblaCarouselType } from 'embla-carousel';

const EPS = 2;
const MOTION = '(prefers-reduced-motion: no-preference)';

type Parts = {
  root: HTMLElement;
  track: HTMLElement;
  rail: HTMLElement;
  items: HTMLElement[];
  prev: HTMLButtonElement | null;
  next: HTMLButtonElement | null;
  pos: HTMLElement | null;
  count: HTMLElement | null;
};

type Teardown = () => void;

function partsOf(root: HTMLElement): Parts | null {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  const rail = root.querySelector<HTMLElement>('[data-carousel-rail]');
  if (!track || !rail) return null;
  return {
    root,
    track,
    rail,
    items: Array.from(rail.children) as HTMLElement[],
    prev: root.querySelector<HTMLButtonElement>('[data-carousel-prev]'),
    next: root.querySelector<HTMLButtonElement>('[data-carousel-next]'),
    pos: root.querySelector<HTMLElement>('[data-carousel-pos]'),
    count: root.querySelector<HTMLElement>('[data-carousel-count]'),
  };
}

const setDisabled = (btn: HTMLButtonElement | null, off: boolean) => {
  if (btn) btn.setAttribute('aria-disabled', String(off));
};

const pauseVideos = (p: Parts) =>
  p.rail.querySelectorAll('video').forEach((v) => {
    if (!v.paused) v.pause();
  });

/**
 * «2» or «1–2»: the slides fully inside the track's box (bleed included).
 * delta: how far the slides will still move, in px (Embla: from where the
 * rail is now to its target, so the counter names where the row is going).
 */
function counterText(p: Parts, delta = 0): string {
  const box = p.track.getBoundingClientRect();
  const rects = p.items.map((it) => it.getBoundingClientRect());
  const seen = rects
    .map((r, i) => (r.left + delta >= box.left - EPS && r.right + delta <= box.right + EPS ? i : -1))
    .filter((i) => i >= 0);
  if (!seen.length) {
    // a slide wider than the row: the one nearest to the start edge
    const start = box.left + (parseFloat(getComputedStyle(p.track).paddingLeft) || 0);
    let best = 0;
    rects.forEach((r, i) => {
      if (Math.abs(r.left + delta - start) < Math.abs(rects[best].left + delta - start)) best = i;
    });
    return String(best + 1);
  }
  const first = seen[0];
  const last = seen[seen.length - 1];
  return first === last ? String(first + 1) : `${first + 1}–${last + 1}`;
}

function render(p: Parts, canPrev: boolean, canNext: boolean, delta = 0): void {
  p.root.toggleAttribute('data-static', !canPrev && !canNext);
  setDisabled(p.prev, !canPrev);
  setDisabled(p.next, !canNext);
  if (p.pos) {
    const text = counterText(p, delta);
    if (p.pos.textContent !== text) p.pos.textContent = text;
  }
}

function onButtons(p: Parts, go: (dir: -1 | 1) => void): Teardown {
  const off: Teardown[] = [];
  for (const [btn, dir] of [
    [p.prev, -1],
    [p.next, 1],
  ] as const) {
    if (!btn) continue;
    btn.disabled = false;
    const click = () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      pauseVideos(p);
      go(dir);
    };
    btn.addEventListener('click', click);
    off.push(() => btn.removeEventListener('click', click));
  }
  const key = (event: KeyboardEvent) => {
    if (event.target !== p.track) return; // keys inside a video or a link stay theirs
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      pauseVideos(p);
      go(event.key === 'ArrowRight' ? 1 : -1);
    }
  };
  p.track.addEventListener('keydown', key);
  off.push(() => p.track.removeEventListener('keydown', key));
  return () => off.forEach((f) => f());
}

// ------------------------------------------------------------- native

function nativeMode(p: Parts): Teardown {
  const { track, items } = p;
  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
  const padStart = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
  // scroll position that puts each slide at the start edge, within range
  const targets = () => {
    const pad = padStart();
    const max = maxScroll();
    return items.map((it) => Math.min(Math.max(it.offsetLeft - pad, 0), max));
  };
  const update = () => {
    const x = track.scrollLeft;
    const max = maxScroll();
    render(p, x > EPS, x < max - EPS);
  };
  const go = (dir: -1 | 1) => {
    const x = track.scrollLeft;
    const t = targets();
    if (dir > 0) {
      const ahead = t.filter((v) => v > x + EPS);
      track.scrollLeft = ahead.length ? Math.min(...ahead) : maxScroll();
    } else {
      const behind = t.filter((v) => v < x - EPS);
      track.scrollLeft = behind.length ? Math.max(...behind) : 0;
    }
    update();
  };

  const offButtons = onButtons(p, go);
  let frame = 0;
  const scroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  track.addEventListener('scroll', scroll, { passive: true });
  const ro = 'ResizeObserver' in window ? new ResizeObserver(update) : null;
  ro?.observe(track);
  update();
  return () => {
    offButtons();
    track.removeEventListener('scroll', scroll);
    ro?.disconnect();
    cancelAnimationFrame(frame);
  };
}

// -------------------------------------------------------------- embla

async function emblaMode(p: Parts): Promise<Teardown> {
  const [{ default: EmblaCarousel }, { WheelGesturesPlugin }] = await Promise.all([
    import('embla-carousel'),
    import('embla-carousel-wheel-gestures'),
  ]);
  const { root, track, rail, items } = p;

  // start where the native row was scrolled to
  const padStart = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
  const x = track.scrollLeft;
  let startIndex = 0;
  items.forEach((it, i) => {
    if (Math.abs(it.offsetLeft - padStart - x) < Math.abs(items[startIndex].offsetLeft - padStart - x)) startIndex = i;
  });
  // the native track shows a scrollbar where scrollbars are classic (not
  // overlay); Embla's clipping track has none, so its height is kept with
  // the same room at the bottom (no layout shift when Embla takes over)
  const sb = Math.max(0, track.offsetHeight - track.clientHeight);
  if (sb) root.style.setProperty('--carousel-sb', `${sb}px`);
  root.setAttribute('data-embla', '');
  track.scrollLeft = 0;

  const media = root.dataset.carousel === 'media';
  let api: EmblaCarouselType | null = null;
  const canMove = () => !!api && (api.canScrollPrev() || api.canScrollNext());

  api = EmblaCarousel(
    track,
    {
      container: rail,
      align: 'start',
      containScroll: 'trimSnaps',
      startIndex,
      skipSnaps: media,
      duration: 28,
      watchDrag: (_api, event) => {
        if (!canMove()) return false;
        const video = (event.target as Element | null)?.closest?.('video');
        return !(video && (!video.paused || video.currentTime > 0));
      },
    },
    [WheelGesturesPlugin()],
  );

  // the counter and the buttons follow the target: they change as soon as
  // a slide is chosen (button, key, or a swipe that crosses a snap)
  const update = () => {
    if (!api) return;
    const now = new DOMMatrixReadOnly(getComputedStyle(rail).transform).m41;
    render(p, api.canScrollPrev(), api.canScrollNext(), api.internalEngine().target.get() - now);
  };
  const offButtons = onButtons(p, (dir) => (dir > 0 ? api?.scrollNext() : api?.scrollPrev()));

  api.on('select', () => {
    update();
    pauseVideos(p);
  });
  api.on('settle', update);
  api.on('reInit', update);
  api.on('resize', update);
  api.on('pointerDown', () => root.setAttribute('data-dragging', ''));
  api.on('pointerUp', () => root.removeAttribute('data-dragging'));
  update();

  return () => {
    offButtons();
    // the native row goes on from the slide Embla was at (not from slide 1)
    // (snap i starts at slide i; with trimSnaps the last snap is the end of
    // the row, which the clamp below gives back)
    const index = Math.min(items.length - 1, api ? api.selectedScrollSnap() : 0);
    api?.destroy();
    api = null;
    root.removeAttribute('data-embla');
    root.removeAttribute('data-dragging');
    root.style.removeProperty('--carousel-sb');
    rail.style.transform = '';
    const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    track.scrollLeft = Math.min(Math.max(items[index].offsetLeft - pad, 0), max);
  };
}

// --------------------------------------------------------------- setup

function setup(root: HTMLElement): void {
  const p = partsOf(root);
  if (!p) return;
  const mq = window.matchMedia(MOTION);
  let teardown: Teardown | null = null;
  let mode: 'native' | 'embla' | null = null;
  let near = false;
  let busy = false;
  let failed = false; // Embla could not load (offline): the native row stays

  const wanted = () => (mq.matches && near && !failed ? 'embla' : 'native');
  const apply = async () => {
    const want = wanted();
    if (want === mode || busy) return;
    busy = true;
    try {
      if (want === 'embla') {
        // set up first (the module loads meanwhile), then drop the native mode
        const next = await emblaMode(p).catch(() => null);
        if (next) {
          teardown?.();
          teardown = next;
          mode = want;
        } else {
          failed = true;
          root.removeAttribute('data-embla');
        }
      } else {
        teardown?.();
        teardown = nativeMode(p);
        mode = want;
      }
    } finally {
      busy = false;
    }
    // the setting may have changed while Embla was loading
    if (wanted() !== mode) void apply();
  };

  // native at once (buttons work from the first moment), Embla near the screen
  teardown = nativeMode(p);
  mode = 'native';
  p.count?.setAttribute('aria-live', 'polite');
  root.setAttribute('data-ready', '');

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        near = true;
        void apply();
      },
      { rootMargin: '50% 0px' },
    );
    io.observe(root);
  }
  mq.addEventListener('change', () => void apply());
}

document.querySelectorAll<HTMLElement>('[data-carousel]').forEach(setup);
