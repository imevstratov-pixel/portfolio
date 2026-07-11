// Бесконечная лента: на устройствах с ховером дублируем набор карточек,
// CSS-анимация крутит трек на -50%. На тачах — нативный свайп без клона.
const track = document.getElementById('reelsTrack');
const canHover = window.matchMedia('(hover: hover)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canHover && !reducedMotion) {
  const set = track.querySelector('.reels__set');
  track.appendChild(set.cloneNode(true));
}

// Клик по рилсу — скроллим к соответствующему кейсу.
// Когда появятся видео, здесь будет открытие плеера со звуком.
track.addEventListener('click', (e) => {
  const reel = e.target.closest('.reel');
  if (!reel) return;
  const target = document.getElementById(reel.dataset.case);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Анимированные лупы: играем только при наведении, чтобы не грузить страницу
track.addEventListener('mouseover', (e) => {
  const video = e.target.closest('.reel')?.querySelector('.reel__loop');
  if (video && video.paused) video.play().catch(() => {});
});
track.addEventListener('mouseout', (e) => {
  const video = e.target.closest('.reel')?.querySelector('.reel__loop');
  if (video && !video.paused) video.pause();
});

// Год в футере
document.getElementById('year').textContent = new Date().getFullYear();
