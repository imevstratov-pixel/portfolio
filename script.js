// Бесконечная лента с нативным управлением: крутится сама, но колесо,
// тачпад, драг и свайп всегда берут контроль; автоплей возвращается после паузы.
const track = document.getElementById('reelsTrack');
const reelsBox = track.closest('.reels');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const set = track.querySelector('.reels__set');
track.appendChild(set.cloneNode(true)); // дубль набора для бесконечной прокрутки

let autoPause = 0;        // сек до возврата автоплея после ручного управления
let dragging = false, dragX = 0, dragScroll = 0, dragMoved = false;

function loopScroll() {
  const half = track.scrollWidth / 2;
  if (reelsBox.scrollLeft >= half) reelsBox.scrollLeft -= half;
  else if (reelsBox.scrollLeft <= 0) reelsBox.scrollLeft += half;
}

// автодвижение
let prevT = 0;
function autoTick(t) {
  const dt = Math.min(0.05, (t - prevT) / 1000 || 0.016);
  prevT = t;
  if (autoPause > 0) autoPause -= dt;
  else if (!reducedMotion && !dragging && !reelsBox.matches(':hover')) {
    reelsBox.scrollLeft += 30 * dt;
    loopScroll();
  }
  requestAnimationFrame(autoTick);
}
requestAnimationFrame(autoTick);

// колесо и тачпад: вертикальное движение тоже листает ленту
reelsBox.addEventListener('wheel', (e) => {
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  reelsBox.scrollLeft += delta;
  loopScroll();
  autoPause = 2.5;
  e.preventDefault();
}, { passive: false });

// драг мышью
reelsBox.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') { autoPause = 2.5; return; } // тач скроллит нативно
  dragging = true; dragMoved = false;
  dragX = e.clientX; dragScroll = reelsBox.scrollLeft;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragX;
  if (Math.abs(dx) > 4) dragMoved = true;
  reelsBox.scrollLeft = dragScroll - dx;
  loopScroll();
});
window.addEventListener('pointerup', () => {
  if (dragging) { dragging = false; autoPause = 2.5; }
});
reelsBox.addEventListener('scroll', () => { if (!dragging) loopScroll(); }, { passive: true });

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
  if (dragMoved) { dragMoved = false; return; } // драг — не клик
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
