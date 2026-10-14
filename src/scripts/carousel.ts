// Carousel rows (src/components/Carousel.astro).
//
// «Назад» and «Дальше» move the row by one slide at once: no smooth
// scrolling, no autoplay. The arrow keys do the same while the row has
// focus. The counter names the slides fully in view: «2 из 5» or «1–2 из 5».
// The bar shows once the root has data-ready (set here), so without JS there
// is no bar and the row still scrolls by swipe or trackpad. The counter
// becomes a polite live region after its first update (aria-live is added
// only then, so the page load announces nothing).
// When every slide fits, the root gets data-static and the CSS removes the bar.
// A click on a button pauses the videos of that row.

const EPS = 2;

function setup(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  if (!track) return;
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-next]');
  const pos = root.querySelector<HTMLElement>('[data-carousel-pos]');
  const count = root.querySelector<HTMLElement>('[data-carousel-count]');
  const items = Array.from(track.children) as HTMLElement[];

  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
  const padStart = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
  // scroll position that puts each slide at the start edge, within range
  const targets = () => {
    const pad = padStart();
    const max = maxScroll();
    return items.map((it) => Math.min(Math.max(it.offsetLeft - pad, 0), max));
  };

  const go = (x: number) => {
    track.scrollLeft = x;
  };

  const step = (dir: -1 | 1) => {
    const x = track.scrollLeft;
    const t = targets();
    if (dir > 0) {
      const ahead = t.filter((v) => v > x + EPS);
      go(ahead.length ? Math.min(...ahead) : maxScroll());
    } else {
      const behind = t.filter((v) => v < x - EPS);
      go(behind.length ? Math.max(...behind) : 0);
    }
    track.querySelectorAll('video').forEach((v) => {
      if (!v.paused) v.pause();
    });
    update();
  };

  const setDisabled = (btn: HTMLButtonElement | null, off: boolean) => {
    if (btn) btn.setAttribute('aria-disabled', String(off));
  };

  const update = () => {
    const x = track.scrollLeft;
    const max = maxScroll();
    const overflow = max > EPS;
    root.toggleAttribute('data-static', !overflow);
    setDisabled(prev, x <= EPS);
    setDisabled(next, x >= max - EPS);
    if (pos) {
      // the slides that are fully in view: «2 из 5» or «1–2 из 5»
      const from = x - EPS;
      const to = x + track.clientWidth + EPS;
      const seen = items
        .map((it, i) => (it.offsetLeft >= from && it.offsetLeft + it.offsetWidth <= to ? i : -1))
        .filter((i) => i >= 0);
      let first = seen.length ? seen[0] : 0;
      let last = seen.length ? seen[seen.length - 1] : 0;
      if (!seen.length) {
        // a slide wider than the row: the one nearest to the start edge
        const t = targets();
        first = last = t.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(t[best] - x) ? i : best), 0);
      }
      const text = first === last ? String(first + 1) : `${first + 1}–${last + 1}`;
      if (pos.textContent !== text) pos.textContent = text;
    }
  };

  for (const [btn, dir] of [
    [prev, -1],
    [next, 1],
  ] as const) {
    if (!btn) continue;
    btn.disabled = false;
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      step(dir);
    });
  }

  track.addEventListener('keydown', (event) => {
    if (event.target !== track) return; // keys inside a video or a link stay theirs
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
  });

  let frame = 0;
  track.addEventListener(
    'scroll',
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    },
    { passive: true },
  );
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(track);
  update();
  count?.setAttribute('aria-live', 'polite');
  root.setAttribute('data-ready', '');
}

document.querySelectorAll<HTMLElement>('[data-carousel]').forEach(setup);
