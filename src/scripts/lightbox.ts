// Image lightbox, the part that ships with the page (decision 2 of 15.10;
// component src/components/motion/Lightbox.astro): a few hundred bytes that
// load the lightbox itself (src/scripts/lightbox-ui.ts) only when someone
// is about to use it.
//
// Static HTML first: every thumbnail is a plain link to the full file
// (<a data-lightbox href=…><img></a>, new tab). The lightbox code is fetched
// when the pointer comes over a thumbnail, a finger touches one or the
// keyboard focus reaches one; a click (no modifier key, left button) then
// opens the image in place. A click before the code has arrived waits for
// it; if it cannot load (offline), the file opens in a new tab as without
// JS. A click with a modifier key or the middle button opens the tab.

type Ui = typeof import('./lightbox-ui');

const SEL = 'a[data-lightbox]';
let ui: Promise<Ui> | null = null;

const load = (): Promise<Ui> => {
  ui ??= import('./lightbox-ui').then(
    (m) => {
      m.warm(); // Motion, when motion is allowed
      return m;
    },
    (err) => {
      ui = null;
      throw err;
    },
  );
  return ui;
};

const thumb = (event: Event): HTMLAnchorElement | null =>
  (event.target as Element | null)?.closest?.<HTMLAnchorElement>(SEL) ?? null;

const intent = (event: Event) => {
  if (thumb(event)) void load().catch(() => undefined);
};
document.addEventListener('pointerover', intent, { passive: true });
document.addEventListener('touchstart', intent, { passive: true });
document.addEventListener('focusin', intent);

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const trigger = thumb(event);
  if (!trigger || !trigger.querySelector('img')) return;
  event.preventDefault();
  load().then(
    (m) => m.open(trigger),
    () => window.open(trigger.href, '_blank', 'noopener'),
  );
});
