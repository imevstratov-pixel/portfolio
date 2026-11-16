import type * as MotionLite from './motion-lite';

type Motion = typeof MotionLite;
type Playback = { stop: () => void; then: (resolve: () => void) => unknown };
type CardState = {
  button: HTMLButtonElement;
  deal: HTMLElement;
  lift: HTMLElement;
  flip: HTMLElement;
  state: 'back' | 'flipping' | 'face';
  hover: Playback | null;
  turning: Playback | null;
};

const MOTION = '(prefers-reduced-motion: no-preference)';
const POINTER = '(hover: hover) and (pointer: fine)';
const REST_LIFT = 'translateY(0px)';
const FLAT_FLIP = 'perspective(750px) rotateY(0deg)';

document.querySelectorAll<HTMLElement>('[data-tarot]').forEach((root) => {
  const hint = root.querySelector<HTMLElement>('[data-tarot-hint]')!;
  const message = root.querySelector<HTMLElement>('[data-tarot-message]')!;
  const hints: string[] = JSON.parse(root.dataset.hints!);
  const preference = matchMedia(MOTION);
  const pointer = matchMedia(POINTER);
  let motion: Motion | null = null;
  let announced = false;
  let entrance: Playback[] = [];
  let reading: Playback | null = null;

  const cards: CardState[] = [...root.querySelectorAll<HTMLButtonElement>('[data-tarot-card]')].map((button) => ({
    button,
    deal: button.closest<HTMLElement>('[data-tarot-deal]')!,
    lift: button.querySelector<HTMLElement>('[data-tarot-lift]')!,
    flip: button.querySelector<HTMLElement>('[data-tarot-flip]')!,
    state: 'back', hover: null, turning: null,
  }));

  const allowed = () => preference.matches && motion !== null;

  function settleCard(card: CardState) {
    card.turning?.stop();
    card.turning = null;
    card.flip.style.transform = FLAT_FLIP;
    card.button.dataset.face = '';
    card.button.setAttribute('aria-pressed', 'true');
    card.button.setAttribute('aria-disabled', 'true');
    card.button.setAttribute('aria-label', card.button.dataset.openedLabel!);
    card.state = 'face';
  }

  function updateReading() {
    const revealed = cards.filter((card) => card.state === 'face').length;
    if (revealed < cards.length) {
      hint.textContent = hints[revealed];
      return;
    }
    if (announced) return;
    announced = true;
    hint.textContent = root.dataset.completeHint!;
    message.textContent = root.dataset.message!;
    root.dataset.complete = '';
    if (allowed()) {
      reading = motion!.animate(message, {
        opacity: [0, 1], transform: ['translateY(14px) scale(0.97)', 'translateY(0px) scale(1)'],
      }, { type: motion!.spring, visualDuration: 0.4, bounce: 0.15 });
    }
  }

  async function reveal(card: CardState) {
    if (card.state !== 'back') return;
    card.state = 'flipping';
    card.button.setAttribute('aria-disabled', 'true');
    if (allowed()) {
      card.turning = motion!.animate(card.flip, { transform: [FLAT_FLIP, 'perspective(750px) rotateY(90deg)'] }, {
        duration: 0.16, ease: [0.4, 0, 1, 1],
      });
      await card.turning;
      if (card.state !== 'flipping') return;
      card.button.dataset.face = '';
      if (allowed()) {
        card.turning = motion!.animate(card.flip, { transform: ['perspective(750px) rotateY(-90deg)', FLAT_FLIP] }, {
          type: motion!.spring, visualDuration: 0.3, bounce: 0.12,
        });
        await card.turning;
      }
      if (card.state !== 'flipping') return;
    }
    settleCard(card);
    updateReading();
  }

  function rest(card: CardState, instant = false) {
    card.hover?.stop();
    card.hover = null;
    card.button.classList.remove('is-hovered');
    if (!instant && allowed()) {
      card.hover = motion!.animate(card.lift, { transform: REST_LIFT }, { type: motion!.spring, visualDuration: 0.2, bounce: 0.2 });
    } else card.lift.style.transform = REST_LIFT;
  }

  cards.forEach((card) => {
    card.button.addEventListener('click', () => { void reveal(card); });
    card.button.addEventListener('pointerenter', (event) => {
      if (!allowed() || !pointer.matches || event.pointerType === 'touch') return;
      card.hover?.stop();
      card.button.classList.add('is-hovered');
      card.hover = motion!.animate(card.lift, { transform: 'translateY(-6px)' }, { type: motion!.spring, visualDuration: 0.2, bounce: 0.2 });
    });
    card.button.addEventListener('pointerleave', () => rest(card));
    card.button.addEventListener('pointercancel', () => rest(card));
    card.button.addEventListener('blur', () => rest(card));
    card.button.disabled = false;
  });
  updateReading();

  async function deal() {
    if (!preference.matches) return;
    try { motion = await import('./motion-lite'); } catch { return; }
    if (!preference.matches || cards.some((card) => card.state !== 'back')) return;
    const middle = cards[1].deal.getBoundingClientRect();
    entrance = cards.map((card, i) => {
      const rect = card.deal.getBoundingClientRect();
      const x = middle.left + middle.width / 2 - rect.left - rect.width / 2;
      return motion!.animate(card.deal, {
        opacity: [0, 1],
        transform: [`translate(${x}px, 24px) scale(0.9)`, 'translate(0px, 0px) scale(1)'],
      }, { type: motion!.spring, visualDuration: 0.48, bounce: 0.24, delay: i * 0.12 });
    });
  }

  preference.addEventListener('change', () => {
    if (!preference.matches) {
      entrance.forEach((animation) => animation.stop());
      entrance = [];
      reading?.stop();
      message.style.opacity = '1';
      message.style.transform = 'none';
      cards.forEach((card) => {
        card.deal.style.transform = 'none';
        card.deal.style.opacity = '1';
        rest(card, true);
        if (card.state === 'flipping') settleCard(card);
      });
      updateReading();
    } else if (!motion) {
      import('./motion-lite').then((m) => { motion = m; }, () => undefined);
    }
  });
  pointer.addEventListener('change', () => cards.forEach((card) => rest(card, true)));
  window.addEventListener('resize', () => cards.forEach((card) => rest(card, true)), { passive: true });
  void deal();
});
