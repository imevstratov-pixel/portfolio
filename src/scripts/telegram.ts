// The only client script on the site.
//
// 1. Telegram buttons (<a data-tg-template="…">): copy the start of the message
//    to the clipboard, show the "copied" label for a few seconds and let the
//    link open the chat as usual. Without JS the link simply opens the chat.
// 2. Analytics goals: in production BaseLayout sets <html data-metrika="ID">;
//    a click on an element with data-goal="…" then reports that goal.
//    A click on any link to a demo app (<base>demo/<name>/…) reports the goal
//    "demo" with the parameter { demo: "<name>" }: the demo pages are legacy
//    files without the counter, and trackLinks counts only external links.
//    In preview there is no counter and nothing is sent.

type Ym = (id: number, action: string, goal: string, params?: Record<string, string>) => void;

const live = document.createElement('span');
live.className = 'sr-only';
live.setAttribute('aria-live', 'polite');
document.body.append(live);

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function copy(text: string): void {
  // Called synchronously inside the click, while the page still has the user gesture.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
}

const timers = new WeakMap<HTMLElement, number>();
const originals = new WeakMap<HTMLElement, string>();

function showCopied(el: HTMLElement): void {
  const label = el.dataset.tgCopied;
  if (!label) return;
  const ms = Number(el.dataset.tgMs) || 3000;
  if (!originals.has(el)) originals.set(el, el.innerHTML);
  // keep the button's size while the shorter label is shown
  el.style.minWidth = `${el.offsetWidth}px`;
  el.style.minHeight = `${el.offsetHeight}px`;
  el.textContent = label;
  el.classList.add('is-copied');
  live.textContent = label;
  window.clearTimeout(timers.get(el));
  timers.set(
    el,
    window.setTimeout(() => {
      el.innerHTML = originals.get(el) ?? el.innerHTML;
      el.classList.remove('is-copied');
      el.style.minWidth = '';
      el.style.minHeight = '';
      live.textContent = '';
    }, ms),
  );
}

function reachGoal(goal: string, params?: Record<string, string>): void {
  const id = Number(document.documentElement.dataset.metrika);
  const ym = (window as unknown as { ym?: Ym }).ym;
  if (id && typeof ym === 'function') {
    try {
      if (params) ym(id, 'reachGoal', goal, params);
      else ym(id, 'reachGoal', goal);
    } catch {
      /* analytics must never break a click */
    }
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const goalEl = target.closest<HTMLElement>('[data-goal]');
  if (goalEl?.dataset.goal) reachGoal(goalEl.dataset.goal);

  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (link && link.origin === location.origin) {
    const demo = /\/demo\/([^/]+)/.exec(link.pathname);
    if (demo) reachGoal('demo', { demo: demo[1] });
  }

  const tg = target.closest<HTMLElement>('[data-tg-template]');
  if (tg?.dataset.tgTemplate) {
    copy(tg.dataset.tgTemplate);
    showCopied(tg);
    // no preventDefault: the link opens the chat in a new tab
  }
});
