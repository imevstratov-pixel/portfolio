// Native <details> that open and close on a spring (decision 2 of 15.10):
// the FAQ and the services «Подробнее» (Disclosure).
//
// The details stays a native element: without JS, and with
// prefers-reduced-motion other than «no-preference», the summary toggles it
// at once as before; find-in-page and keyboard work as the browser does
// them. With motion allowed, a click on the summary (mouse, Enter, Space)
// is taken over:
// - opening: the details opens at once (the content is in the page and in
//   the accessibility tree from the first frame) and its height grows from
//   the summary to the content on a critically damped spring (Motion
//   spring, bounce 0), the content fading in over the first part;
// - closing: the summary shows its closed state at once (data-closing, CSS
//   in motion.css), the height shrinks to the summary on the same spring
//   and only then the details closes;
// - a click during the animation turns it around from where it is;
// - only the part on screen animates: a long text grows to the bottom of
//   the screen and the rest is added in one step below the fold, so a
//   4000px text opens as fast as a short one and nothing moves off screen.
//
// Motion's WAAPI animate (motion/mini) with its spring generator, about
// 6 KB gzip together (src/scripts/motion-lite.ts, shared with the
// lightbox); height is not composited, but it is one element at a time and
// only for the part on screen. Motion is loaded right after the page, and
// only when motion is allowed (never under prefers-reduced-motion; it loads
// if the setting changes); until it has arrived a click toggles at once.

import type * as MotionLite from './motion-lite';

type Running = { stop: () => void };

const MOTION = '(prefers-reduced-motion: no-preference)';
let lite: typeof MotionLite | null = null;
let loading = false;
function loadMotion(): void {
  if (lite || loading || !window.matchMedia(MOTION).matches) return;
  loading = true;
  import('./motion-lite')
    .then((m) => (lite = m), () => undefined)
    .finally(() => (loading = false));
}
loadMotion();
window.matchMedia(MOTION).addEventListener('change', loadMotion);

const height = (m: typeof MotionLite) => ({ type: m.spring, visualDuration: 0.38, bounce: 0 }) as const;
const FADE_IN = { duration: 0.24, delay: 0.04, ease: [0.2, 0, 0, 1] } as const;
const FADE_OUT = { duration: 0.14, ease: [0.4, 0, 1, 1] } as const;

const running = new WeakMap<HTMLDetailsElement, Running>();

/** Motion is allowed (the visitor's system says «no preference») and Motion has loaded. */
export function motionAllowed(): boolean {
  return !!lite && window.matchMedia(MOTION).matches;
}

/** The details is open and not on its way closed. */
export function isOpen(details: HTMLDetailsElement): boolean {
  return details.open && !details.hasAttribute('data-closing');
}

function summaryOf(details: HTMLDetailsElement): HTMLElement | null {
  return details.querySelector<HTMLElement>(':scope > summary');
}

function panels(details: HTMLDetailsElement): HTMLElement[] {
  return Array.from(details.children).filter((c): c is HTMLElement => c.tagName !== 'SUMMARY');
}

function clear(details: HTMLDetailsElement): void {
  details.style.height = '';
  for (const p of panels(details)) p.style.opacity = '';
  details.removeAttribute('data-animating');
  details.removeAttribute('data-closing');
  running.delete(details);
}

/** Height of the details with only its summary showing (in its closed look). */
function closedHeight(details: HTMLDetailsElement, summary: HTMLElement): number {
  const cs = getComputedStyle(details);
  const box = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const;
  return summary.getBoundingClientRect().height + box.reduce((a, k) => a + (parseFloat(cs[k]) || 0), 0);
}

/**
 * Opens or closes a details. animate=false (or motion not allowed) does it
 * at once, stopping an animation that runs. Resolves when the details has
 * its final state.
 */
export function setOpen(details: HTMLDetailsElement, open: boolean, opts: { animate?: boolean } = {}): Promise<void> {
  const summary = summaryOf(details);
  const wasRunning = running.has(details);
  // stopping commits the values reached so far, so a reversal starts there
  running.get(details)?.stop();

  const m = lite;
  if (opts.animate === false || !motionAllowed() || !summary || !m) {
    clear(details);
    details.open = open;
    return Promise.resolve();
  }

  const rect = details.getBoundingClientRect();
  const from = rect.height;
  // what lies below the bottom of the screen is not animated
  const screenRoom = Math.max(0, window.innerHeight - rect.top);
  details.setAttribute('data-animating', '');

  let start: number;
  let to: number;
  if (open) {
    details.removeAttribute('data-closing');
    details.open = true;
    details.style.height = '';
    const full = details.getBoundingClientRect().height;
    // never less than the summary in its open look (the sticky bar is taller)
    start = Math.max(from, closedHeight(details, summary));
    to = Math.min(full, Math.max(start, screenRoom));
  } else {
    details.setAttribute('data-closing', '');
    to = closedHeight(details, summary);
    start = Math.max(to, Math.min(from, screenRoom));
  }

  const anims = [
    m.animate(details, { height: [`${start}px`, `${to}px`] }, height(m)),
    ...panels(details).map((p) => {
      const now = wasRunning ? Number(getComputedStyle(p).opacity) : open ? 0 : 1;
      return m.animate(p, { opacity: [now, open ? 1 : 0] }, open ? FADE_IN : FADE_OUT);
    }),
  ];
  let stopped = false;
  running.set(details, {
    stop: () => {
      stopped = true;
      anims.forEach((a) => a.stop());
    },
  });

  return Promise.all(anims.map((a) => a.finished)).then(
    () => {
      if (stopped) return;
      // the rest of a long text (below the screen) is added here, in one step
      if (!open) details.open = false;
      clear(details);
    },
    () => undefined,
  );
}

/**
 * Takes over the summary's click while motion is allowed. canAnimate decides
 * per click whether to animate (the Disclosure keeps its own jumps for a
 * stuck summary); when it returns false the click is left to the browser.
 */
export function enhance(
  details: HTMLDetailsElement,
  opts: { onToggle?: (details: HTMLDetailsElement, opening: boolean, event: MouseEvent) => boolean } = {},
): void {
  const summary = summaryOf(details);
  if (!summary) return;
  summary.addEventListener('click', (event) => {
    if (!motionAllowed()) {
      // an animation started before the preference changed: finish it now
      if (running.has(details)) {
        event.preventDefault();
        setOpen(details, !isOpen(details), { animate: false });
      }
      return;
    }
    const opening = !isOpen(details);
    if (opts.onToggle && opts.onToggle(details, opening, event)) return; // handled there
    event.preventDefault();
    void setOpen(details, opening);
  });
}
