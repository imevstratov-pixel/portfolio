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
//   reader, so the summary's own place ends up above the screen. Only then
//   (the summary's top is above the header's bottom after closing) the same
//   jump brings it back. Closing it where it opened, with the summary in its
//   place on screen, moves nothing: the button stays under the finger.
//
// bringBack aims at the top of the card under the header, but never further
// up than keeps the summary on screen: on a phone a card is taller than the
// screen, so there the summary lands at the bottom edge with the price and
// the Telegram button above it, and the focus stays visible.

const GAP = 16;

function rootOf(details: HTMLElement): HTMLElement {
  return details.closest<HTMLElement>('[data-disclose-root]') ?? details;
}

function headerBottom(): number {
  const header = document.querySelector('.site-header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

function bringBack(details: HTMLElement, summary: HTMLElement | null): void {
  // the card's top under the header...
  let dy = rootOf(details).getBoundingClientRect().top - headerBottom() - GAP;
  // ...unless that pushes the summary below the screen
  if (summary) dy = Math.max(dy, summary.getBoundingClientRect().bottom - window.innerHeight + GAP);
  if (Math.abs(dy) >= 1) window.scrollBy({ top: dy, behavior: 'instant' });
}

for (const details of document.querySelectorAll<HTMLDetailsElement>('details[data-disclose]')) {
  details.dataset.ready = '';
  const summary = details.querySelector<HTMLElement>(':scope > summary');
  details.querySelector('[data-disclose-close]')?.addEventListener('click', () => {
    details.open = false;
    summary?.focus({ preventScroll: true });
    bringBack(details, summary);
  });
  details.addEventListener('toggle', () => {
    if (details.open || !summary) return;
    // after the end button's jump the summary is on screen: nothing happens here
    if (summary.getBoundingClientRect().top < headerBottom()) bringBack(details, summary);
  });
}
