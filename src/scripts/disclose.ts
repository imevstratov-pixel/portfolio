// Long disclosures (components/Disclosure.astro, the services «Подробнее»).
//
// Without this script the native <details> works as is: the summary opens and
// closes it and, while open, sticks under the site header (CSS).
// With it:
// - each details gets data-ready, which shows the second «Свернуть» button at
//   the end of the content;
// - that button closes the details, moves the focus to the summary and jumps
//   back to the closest [data-disclose-root] (the service card) at once, with
//   no smooth scrolling (bringBack);
// - closing from the stuck summary deep in the text folds the text above the
//   reader, so the summary's own place ends up above the screen: the same
//   jump brings it back. Closing it where it opened, with the summary in its
//   place on screen, moves nothing: the button stays under the finger.
//
// Motion (decision 2 of 15.10, src/scripts/accordion.ts): when the system
// allows motion, opening and closing in place run on a spring; for the end
// button and the stuck summary the jump comes first, while the text is
// still open (the card's top, the summary in its own place), and then the
// text folds up under the summary on the same spring, so the reader sees
// where it went. With prefers-reduced-motion the order is the old one: the
// details closes at once and the jump follows.
//
// bringBack aims at the top of the card under the header, but never further
// up than keeps the summary on screen: on a phone a card is taller than the
// screen, so there the summary lands at the bottom edge with the price and
// the Telegram button above it, and the focus stays visible.

import { enhance, motionAllowed, setOpen } from './accordion';

const GAP = 16;

function rootOf(details: HTMLElement): HTMLElement {
  return details.closest<HTMLElement>('[data-disclose-root]') ?? details;
}

function headerBottom(): number {
  const header = document.querySelector('.site-header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

/** The summary is stuck under the header, away from its own place. */
function isStuck(details: HTMLElement, summary: HTMLElement): boolean {
  return summary.getBoundingClientRect().top - details.getBoundingClientRect().top > 1;
}

/**
 * Scrolls the card's top under the header, keeping the summary on screen.
 * The summary's bottom is taken at its own place (the top of the details),
 * so this works while it is still stuck.
 */
function bringBack(details: HTMLElement, summary: HTMLElement | null): void {
  let dy = rootOf(details).getBoundingClientRect().top - headerBottom() - GAP;
  if (summary) {
    const ownBottom = details.getBoundingClientRect().top + summary.offsetHeight;
    dy = Math.max(dy, ownBottom - window.innerHeight + GAP);
  }
  if (Math.abs(dy) >= 1) window.scrollBy({ top: dy, behavior: 'instant' });
}

for (const details of document.querySelectorAll<HTMLDetailsElement>('details[data-disclose]')) {
  details.dataset.ready = '';
  const summary = details.querySelector<HTMLElement>(':scope > summary');

  // the jump first, then the spring (motion allowed)
  // (the summary takes its closed look first, so the jump measures it as
  // it will stay)
  const foldBack = () => {
    details.setAttribute('data-closing', '');
    summary?.focus({ preventScroll: true });
    bringBack(details, summary);
    void setOpen(details, false);
  };

  details.querySelector('[data-disclose-close]')?.addEventListener('click', () => {
    if (motionAllowed()) return foldBack();
    details.open = false;
    summary?.focus({ preventScroll: true });
    bringBack(details, summary);
  });

  enhance(details, {
    onToggle: (d, opening, event) => {
      if (opening || !summary || !isStuck(d, summary)) return false; // the spring in place
      event.preventDefault();
      foldBack();
      return true;
    },
  });

  // reduced motion (native toggle): the old jump after closing from the stuck summary
  details.addEventListener('toggle', () => {
    if (details.open || !summary || motionAllowed()) return;
    if (summary.getBoundingClientRect().top < headerBottom()) bringBack(details, summary);
  });
}

