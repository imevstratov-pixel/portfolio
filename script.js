// Бесконечная лента с нативным управлением: крутится сама, но горизонтальный
// жест тачпада, драг и свайп берут контроль; автоплей возвращается после паузы.
// Вертикальное колесо ленту не трогает — оно прокручивает страницу.
const track = document.getElementById('reelsTrack');
const reelsBox = track.closest('.reels');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const set = track.querySelector('.reels__set');
// три копии набора: всегда полный буфер слева и справа, докрутить до пустоты нельзя
track.appendChild(set.cloneNode(true));
track.appendChild(set.cloneNode(true));

let autoPause = 0;        // сек до возврата автоплея после ручного управления
let dragging = false, dragX = 0, dragScroll = 0, dragMoved = false;

function oneSet() { return track.scrollWidth / 3; }

// держим скролл в средней трети; при заходе в крайние — телепорт на ширину набора
// (буфер с обеих сторон гарантирует, что виден контент, а не пустой край)
function loopScroll() {
  const w = oneSet();
  if (!w) return;
  if (reelsBox.scrollLeft < w * 0.5) reelsBox.scrollLeft += w;
  else if (reelsBox.scrollLeft > w * 1.5) reelsBox.scrollLeft -= w;
}

// стартуем из середины, чтобы можно было листать в обе стороны без пустоты
requestAnimationFrame(() => { reelsBox.scrollLeft = oneSet(); });

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

// колесо и тачпад: ленту листает только горизонтальный жест (или shift+колесо),
// его прокрутку делает сам браузер; вертикальный уходит странице
reelsBox.addEventListener('wheel', (e) => {
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) autoPause = 2.5;
}, { passive: true });

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
const BASE = document.documentElement.dataset.base || ''; // '../' на /en/
const lightbox = document.getElementById('lightbox');
const lbVideo = lightbox.querySelector('.lightbox__video');
const lbCase = lightbox.querySelector('.lightbox__case');

function openLightbox(reel) {
  const caseId = reel.dataset.case;
  lightbox.classList.remove('no-case');
  lbVideo.poster = BASE + 'assets/posters/' + caseId + '.jpg';
  lbVideo.src = reel.dataset.video;
  lbCase.href = '#' + caseId;
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  lbVideo.play().catch(() => {});
}

// Отзывы: карточка → тот же лайтбокс, но без кнопки кейса
const testiRow = document.getElementById('testiRow');
if (testiRow) {
  testiRow.addEventListener('click', (e) => {
    const card = e.target.closest('.testi');
    if (!card) return;
    lightbox.classList.add('no-case');
    lbVideo.removeAttribute('poster');
    lbVideo.src = card.dataset.video;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    lbVideo.play().catch(() => {});
  });
  // лупы играют, только пока карточка на экране
  const loops = testiRow.querySelectorAll('.testi__loop');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) en.target.play().catch(() => {});
      else en.target.pause();
    }), { threshold: 0.35 });
    loops.forEach((v) => io.observe(v));
  }
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
