// Бесконечная лента: на устройствах с ховером дублируем набор карточек,
// CSS-анимация крутит трек на -50%. На тачах — нативный свайп без клона.
const track = document.getElementById('reelsTrack');
const canHover = window.matchMedia('(hover: hover)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canHover && !reducedMotion) {
  const set = track.querySelector('.reels__set');
  track.appendChild(set.cloneNode(true));
}

// Клик по рилсу — лайтбокс с видео со звуком; из него ссылка на текстовый кейс
const lightbox = document.getElementById('lightbox');
const lbVideo = lightbox.querySelector('.lightbox__video');
const lbCase = lightbox.querySelector('.lightbox__case');

function openLightbox(reel) {
  const caseId = reel.dataset.case;
  lbVideo.poster = 'assets/posters/' + caseId + '.jpg';
  lbVideo.src = reel.dataset.video;
  lbCase.href = '#' + caseId;
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  lbVideo.play().catch(() => {});
}

// спиннер на буферизации (медленная сеть)
['waiting', 'stalled', 'loadstart'].forEach(ev =>
  lbVideo.addEventListener(ev, () => lightbox.classList.add('is-buffering')));
['canplay', 'playing', 'error'].forEach(ev =>
  lbVideo.addEventListener(ev, () => lightbox.classList.remove('is-buffering')));
function closeLightbox() {
  lbVideo.pause();
  lbVideo.removeAttribute('src');
  lbVideo.load();
  lightbox.hidden = true;
  document.body.style.overflow = '';
}

track.addEventListener('click', (e) => {
  const reel = e.target.closest('.reel');
  if (reel) openLightbox(reel);
});
lightbox.querySelector('.lightbox__backdrop').addEventListener('click', closeLightbox);
lightbox.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
lbCase.addEventListener('click', (e) => {
  e.preventDefault();
  const target = document.getElementById(lbCase.hash.slice(1));
  closeLightbox();
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
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
