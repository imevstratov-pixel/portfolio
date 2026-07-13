// «Смена методолога» — canvas-раннер по конвейеру производства курсов.
// Пробел/тап — прыжок. Demo-полоска под шапкой ведёт в полную игру.
(function () {
  const PAPER = '#FAF8F4', INK = '#111110', RED = '#E63311', SOFT = '#4a4844';
  const MILESTONES = [
    [10,  'Первый урок ушёл в прод'],
    [26,  'Пилотная группа дошла до конца'],
    [60,  'Эксперт ответил с первого раза'],
    [120, 'Retention пополз вверх'],
    [250, 'Курс стал бестселлером'],
    [500, 'У курса появились фанаты'],
  ];

  // ---------- спрайты (Higgsfield) → листы с настоящей альфой ----------
  const BASE = document.documentElement.dataset.base || '';
  const SHEETS = {};
  function loadSheet(key, src, whiteCut) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const mn = Math.min(p[i], p[i + 1], p[i + 2]);
        if (mn > whiteCut) p[i + 3] = Math.max(0, 255 - (mn - whiteCut) * (255 / (255 - whiteCut)) * 1.6);
      }
      g.putImageData(d, 0, 0);
      SHEETS[key] = c;
    };
    img.src = src;
  }
  loadSheet('char',   BASE + 'assets/game/sprites-char.jpg', 218);
  loadSheet('items',  BASE + 'assets/game/sprites-items.jpg', 218);
  loadSheet('clouds', BASE + 'assets/game/clouds.jpg', 215);

  const CHAR_GRID  = { x0: 22, y0: 208, cw: (1352 - 22) / 6, ch: 314, inset: 12 };
  const ITEM_GRID  = { x0: 57, y0: 257, cw: (1319 - 57) / 5, ch: 255, inset: 12 };
  const CLOUD_GRID = { x0: 40, y0: 230, cw: (1336 - 40) / 3, ch: 320, inset: 6 };
  const ITEM_IDX = { book: 0, deadline: 1, edit: 2, slide: 3, bolt: 4 };

  // ---------- фабрика раннера: полный режим и demo ----------
  function createRunner(canvas, opts) {
    const demo = !!opts.demo;
    const ctx = canvas.getContext('2d');
    const R = {
      running: false, dead: false, raf: 0, tPrev: 0,
      speed: 0, score: 0, grace: 0, beltShift: 0, cloudShift: 0, time: 0, mult: 1,
      W: 0, H: 0, GROUND: 0,
      player: null, obstacles: [], books: [], bolts: [], toasts: [], fans: [],
      boostT: 0, spawnT: 0, bookT: 0, boltT: 0, shownMs: null,
      onScore: opts.onScore || (() => {}),
      onDeath: opts.onDeath || (() => {}),
    };

    function sprite(key, grid, idx, dx, dy, dw, dh, alpha) {
      const sh = SHEETS[key];
      if (!sh) return false;
      const sx = grid.x0 + grid.cw * idx + grid.inset, sy = grid.y0 + grid.inset;
      ctx.save();
      if (alpha != null) ctx.globalAlpha = alpha;
      ctx.drawImage(sh, sx, sy, grid.cw - grid.inset * 2, grid.ch - grid.inset * 2, dx, dy, dw, dh);
      ctx.restore();
      return true;
    }

    R.resize = function () {
      R.W = canvas.clientWidth; R.H = canvas.clientHeight;
      canvas.width = R.W * devicePixelRatio; canvas.height = R.H * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      R.GROUND = demo ? R.H - 20 : R.H * 0.72;
    };

    R.reset = function () {
      R.speed = demo ? 170 : 320; R.score = 0; R.boostT = 0; R.grace = demo ? 0 : 3;
      R.time = 0; R.mult = 1;
      R.spawnT = 0.6; R.bookT = 1.6; R.boltT = 7;
      R.obstacles = []; R.books = []; R.bolts = []; R.toasts = []; R.fans = [];
      R.shownMs = new Set(); R.dead = false;
      R.player = { x: Math.min(90, R.W * 0.14), y: 0, vy: 0, onGround: true, w: 34, h: 52, coyote: 0, jumpBuf: 0, autoT: 1.6 };
      R.onScore(0);
    };

    R.jump = function () {
      if (R.dead) { R.reset(); return; }
      const p = R.player;
      if (p.onGround || p.coyote > 0) { p.vy = demo ? -320 : -640; p.onGround = false; p.coyote = 0; }
      else p.jumpBuf = 0.14;
    };

    function spawnObstacle() {
      const kinds = ['edit', 'deadline', 'slide'];
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      const size = k === 'slide' ? { w: 52, h: 38 } : k === 'deadline' ? { w: 34, h: 40 } : { w: 40, h: 28 };
      R.obstacles.push({ kind: k, x: R.W + 60, y: R.GROUND - size.h, ...size });
    }
    // книги — строго в зоне досягаемости: нижние собираются бегом, верхние — прыжком
    function spawnBook() { R.books.push({ x: R.W + 60, y: R.GROUND - 65 - Math.random() * 95 }); }
    function spawnBolt() { R.bolts.push({ x: R.W + 60, y: R.GROUND - 110 - Math.random() * 50 }); }

    function update(dt) {
      const p = R.player;
      const boost = R.boostT > 0 ? 1.7 : 1;
      if (R.boostT > 0) R.boostT -= dt;
      if (R.grace > 0) R.grace -= dt;
      if (!demo) {
        R.speed += dt * 3;
        R.time += dt;
        const m = 1 + Math.floor(R.time / 30); // стаж смены: каждые 30 сек множитель +1
        if (m > R.mult) { R.mult = m; R.toasts.push({ text: 'Стаж вырос — очки ×' + m, t: 2.4 }); R.onScore(R.score); }
      }
      const move = R.speed * boost * dt;
      R.beltShift = (R.beltShift + move) % 64;
      R.cloudShift += move * 0.12;

      // demo: автопрыжки, чтобы полоска жила сама
      if (demo) { p.autoT -= dt; if (p.autoT <= 0 && p.onGround) { R.jump(); p.autoT = 2.2 + Math.random() * 2; } }

      p.vy += 1700 * dt;
      p.y += p.vy * dt;
      if (p.y >= 0) {
        p.y = 0; p.vy = 0; p.onGround = true;
        if (p.jumpBuf > 0) { p.jumpBuf = 0; R.jump(); }
      } else if (p.onGround) { p.onGround = false; p.coyote = 0.09; }
      if (!p.onGround && p.coyote > 0) p.coyote -= dt;
      if (p.jumpBuf > 0) p.jumpBuf -= dt;

      R.bookT -= dt;
      if (R.bookT <= 0) { spawnBook(); R.bookT = 1.4 + Math.random() * 1.4; }
      if (!demo && R.grace <= 0) {
        R.spawnT -= dt; R.boltT -= dt;
        if (R.spawnT <= 0) { spawnObstacle(); R.spawnT = 1.4 + Math.random() * 1.4 - Math.min(0.5, R.time / 240); }
        if (R.boltT <= 0) { spawnBolt(); R.boltT = 9 + Math.random() * 6; }
      }

      const px = p.x, py = R.GROUND + p.y - p.h;
      R.obstacles.forEach(o => o.x -= move);
      R.books.forEach(b => b.x -= move);
      R.bolts.forEach(b => b.x -= move);
      R.obstacles = R.obstacles.filter(o => o.x > -80);
      R.books = R.books.filter(b => b.x > -40);
      R.bolts = R.bolts.filter(b => b.x > -40);

      for (const o of R.obstacles) {
        if (R.boostT > 0) break;
        if (px < o.x + o.w - 8 && px + p.w > o.x + 8 && py + p.h > o.y + 6) { die(); return; }
      }
      R.books = R.books.filter(b => {
        if (Math.abs(b.x - (px + p.w / 2)) < 30 && Math.abs(b.y - (py + p.h / 2)) < 46) {
          R.score += R.mult * (R.boostT > 0 ? 5 : 1); // AI-буст печёт уроки пачками
          R.onScore(R.score);
          if (!demo) for (const [n, text] of MILESTONES) if (R.score === n && !R.shownMs.has(n)) {
            R.shownMs.add(n); R.toasts.push({ text, t: 2.6 });
            if (n === 500) R.fans = [{ off: 60 }, { off: 105 }, { off: 150 }];
          }
          return false;
        }
        return true;
      });
      R.bolts = R.bolts.filter(b => {
        if (Math.abs(b.x - (px + p.w / 2)) < 32 && Math.abs(b.y - (py + p.h / 2)) < 48) {
          R.boostT = 2.5; R.toasts.push({ text: 'AI-конвейер запущен', t: 2.2 }); return false;
        }
        return true;
      });
      R.toasts.forEach(t => t.t -= dt);
      R.toasts = R.toasts.filter(t => t.t > 0);
    }

    function die() { R.dead = true; R.onDeath(R.score); }

    function drawChar(x, yOff, scale, ghost) {
      const s = scale || 1;
      let frame;
      if (R.dead) frame = 5;
      else if (!R.player.onGround && Math.abs(R.player.vy) > 40) frame = 4;
      else frame = Math.floor(performance.now() / 90) % 4;
      const h = (demo ? 62 : 78) * s, w = h * 0.68;
      if (!sprite('char', CHAR_GRID, frame, x - w * 0.18, R.GROUND + yOff - h + 2, w, h, ghost ? 0.5 : 1)) {
        // фолбэк, пока лист не загрузился
        ctx.fillStyle = INK; ctx.fillRect(x, R.GROUND + yOff - 40, 20, 40);
      }
    }

    function draw() {
      ctx.clearRect(0, 0, R.W, R.H);
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, R.W, R.H);

      // облака-спрайты, медленный параллакс
      if (SHEETS.clouds) {
        const positions = demo ? [[0.15, 0.16], [0.6, 0.3]] : [[0.12, 0.14], [0.5, 0.08], [0.82, 0.2]];
        positions.forEach(([fx, fy], i) => {
          const w = demo ? 70 : 120, h = w * 0.62;
          const span = R.W + w * 2;
          const x = ((fx * R.W - R.cloudShift * (0.5 + i * 0.25)) % span + span) % span - w;
          sprite('clouds', CLOUD_GRID, i % 3, x, R.H * fy, w, h, 0.9);
        });
      }

      // конвейер: полотно, звенья с заклёпками, ролики, тень
      const gy = R.GROUND, beltH = demo ? 18 : 26;
      ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, gy, R.W, beltH);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.strokeRect(-4, gy, R.W + 8, beltH);
      ctx.lineWidth = 1.5;
      for (let x = -R.beltShift; x < R.W + 64; x += 64) {
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + beltH); ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(x + 32, gy + beltH / 2, 2.2, 0, 7); ctx.fill();
      }
      // тень под персонажем
      const shScale = 1 + R.player.y / 400;
      ctx.fillStyle = 'rgba(17,17,16,0.12)';
      ctx.beginPath();
      ctx.ellipse(R.player.x + 18, gy + 4, 22 * Math.max(0.4, shScale), 4, 0, 0, 7);
      ctx.fill();

      // объекты
      R.obstacles.forEach(o => {
        const pad = o.kind === 'slide' ? 6 : 10;
        sprite('items', ITEM_GRID, ITEM_IDX[o.kind], o.x - pad, o.y - pad, o.w + pad * 2, o.h + pad * 2);
      });
      R.books.forEach(b => sprite('items', ITEM_GRID, ITEM_IDX.book, b.x - 19, b.y - 15, 38, 30));
      R.bolts.forEach(b => sprite('items', ITEM_GRID, ITEM_IDX.bolt, b.x - 15, b.y - 19, 30, 38));

      // фанаты (после 500)
      R.fans.forEach(f => drawChar(R.player.x - f.off, 0, 0.8, true));

      // игрок
      if (R.boostT > 0) { ctx.save(); ctx.shadowColor = RED; ctx.shadowBlur = 18; }
      drawChar(R.player.x, R.player.y, 1, false);
      if (R.boostT > 0) ctx.restore();

      // тосты
      R.toasts.forEach((t, i) => {
        ctx.font = '700 22px "Inter Tight", sans-serif';
        const w = ctx.measureText(t.text).width + 36;
        const x = (R.W - w) / 2, y = R.H * 0.2 + i * 52;
        ctx.globalAlpha = Math.min(1, t.t);
        ctx.fillStyle = INK; ctx.fillRect(x, y, w, 40);
        ctx.fillStyle = PAPER; ctx.fillText(t.text, x + 18, y + 27);
        ctx.globalAlpha = 1;
      });

      // грейс-подсказка на старте полной игры
      if (!demo && R.grace > 0.2 && !R.dead) {
        ctx.font = '400 14px "IBM Plex Mono", monospace';
        ctx.fillStyle = SOFT; ctx.textAlign = 'center';
        ctx.fillText('смена начинается — разомнитесь прыжком', R.W / 2, R.H * 0.3);
        ctx.textAlign = 'left';
      }

      if (R.dead) {
        ctx.fillStyle = 'rgba(250,248,244,0.88)'; ctx.fillRect(0, 0, R.W, R.H);
        ctx.fillStyle = INK; ctx.textAlign = 'center';
        ctx.font = '900 34px "Inter Tight", sans-serif';
        ctx.fillText('CSI упал ниже 80%', R.W / 2, R.H * 0.4);
        ctx.font = '400 15px "IBM Plex Mono", monospace';
        ctx.fillStyle = SOFT;
        ctx.fillText('уроков за смену: ' + R.score + '   ·   рекорд: ' + best, R.W / 2, R.H * 0.4 + 34);
        ctx.fillStyle = RED;
        ctx.fillText('ПРОБЕЛ / ТАП — ПЕРЕСОБРАТЬ КУРС', R.W / 2, R.H * 0.4 + 72);
        ctx.textAlign = 'left';
      }
    }

    function frame(t) {
      if (!R.running) return;
      const dt = Math.min(0.033, (t - R.tPrev) / 1000 || 0.016);
      R.tPrev = t;
      if (!R.dead) update(dt);
      draw();
      R.raf = requestAnimationFrame(frame);
    }

    R.start = function () { R.resize(); R.reset(); R.running = true; R.tPrev = 0; R.raf = requestAnimationFrame(frame); };
    R.stop = function () { R.running = false; cancelAnimationFrame(R.raf); };
    return R;
  }

  // ---------- рекорд ----------
  let best = +(localStorage.getItem('shift-best') || 0);

  // ---------- полноэкранная игра ----------
  const overlay = document.createElement('div');
  overlay.className = 'game';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="game__bar mono"><span>СМЕНА МЕТОДОЛОГА</span>' +
    '<span class="game__score">уроков: 0</span>' +
    '<button class="game__close mono" type="button">выйти со смены ✕</button></div>' +
    '<canvas class="game__canvas"></canvas>' +
    '<div class="game__hint mono">пробел / тап — прыжок</div>';
  document.body.appendChild(overlay);
  const scoreEl = overlay.querySelector('.game__score');
  const hintEl = overlay.querySelector('.game__hint');

  const game = createRunner(overlay.querySelector('canvas'), {
    onScore: s => { scoreEl.textContent = 'уроков: ' + s + (game && game.mult > 1 ? ' · очки ×' + game.mult : ''); },
    onDeath: s => { if (s > best) { best = s; localStorage.setItem('shift-best', best); } },
  });

  function openGame() {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('game--open'));
    document.body.style.overflow = 'hidden';
    hintEl.style.opacity = 1;
    game.start();
    if (demoRunner) demoRunner.stop();
  }
  function closeGame() {
    overlay.classList.remove('game--open');
    game.stop();
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (demoRunner) demoRunner.start();
  }

  overlay.querySelector('.game__close').addEventListener('click', closeGame);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.game__close')) return;
    hintEl.style.opacity = 0;
    game.jump();
  });

  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) {
      const lb = document.getElementById('lightbox');
      if (e.code === 'Space' && (!lb || lb.hidden) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); openGame();
      }
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); hintEl.style.opacity = 0; game.jump(); }
    if (e.code === 'Escape') closeGame();
  });
  window.addEventListener('resize', () => { if (!overlay.hidden) game.resize(); });

  // ---------- demo-полоска под шапкой ----------
  let demoRunner = null;
  const strip = document.getElementById('demoStrip');
  if (strip) {
    demoRunner = createRunner(strip.querySelector('canvas'), { demo: true });
    demoRunner.start();
    strip.addEventListener('click', openGame);
    window.addEventListener('resize', () => demoRunner.resize());
    // не жечь батарею: демо стоит, пока полоска вне экрана
    new IntersectionObserver(([en]) => {
      if (en.isIntersecting && overlay.hidden) demoRunner.start(); else demoRunner.stop();
    }).observe(strip);
  }
})();
