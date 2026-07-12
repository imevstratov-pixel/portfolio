// «Смена методолога» — canvas-раннер по конвейеру производства курсов.
// Пробел/тап — прыжок. Собирай уроки, перепрыгивай правки и дедлайны.
(function () {
  const PAPER = '#FAF8F4', INK = '#111110', RED = '#E63311', SOFT = '#4a4844';

  // ---------- спрайты (Higgsfield paper-collage) ----------
  // белый фон листов растворяется multiply-наложением на бумагу
  const charImg = new Image(); charImg.src = 'assets/game/sprites-char.jpg';
  const itemsImg = new Image(); itemsImg.src = 'assets/game/sprites-items.jpg';
  // сетки листов: [x0, y0, cellW, cellH, inset]
  const CHAR_GRID = { x0: 22, y0: 208, cw: (1352 - 22) / 6, ch: 314, inset: 12 };
  const ITEM_GRID = { x0: 57, y0: 257, cw: (1319 - 57) / 5, ch: 255, inset: 12 };
  const ITEM_IDX = { book: 0, deadline: 1, edit: 2, slide: 3, bolt: 4 };

  function drawSprite(img, grid, idx, dx, dy, dw, dh, alpha) {
    const sx = grid.x0 + grid.cw * idx + grid.inset;
    const sy = grid.y0 + grid.inset;
    const sw = grid.cw - grid.inset * 2, sh = grid.ch - grid.inset * 2;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }
  const MILESTONES = [
    [10,  'Первый урок ушёл в прод'],
    [26,  'Пилотная группа дошла до конца'],
    [60,  'Эксперт ответил с первого раза'],
    [120, 'Retention пополз вверх'],
    [250, 'Курс стал бестселлером'],
    [500, 'У курса появились фанаты'],
  ];

  // ---------- overlay ----------
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

  const canvas = overlay.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = overlay.querySelector('.game__score');
  const hintEl = overlay.querySelector('.game__hint');

  // ---------- state ----------
  let running = false, dead = false, raf = 0, tPrev = 0;
  let speed, score, best = +(localStorage.getItem('shift-best') || 0);
  let player, obstacles, books, bolts, toasts, cosplayers, boostT, spawnT, bookT, boltT, shownMs;
  let W = 0, H = 0, GROUND = 0, beltShift = 0;

  function reset() {
    speed = 320; score = 0; boostT = 0; spawnT = 2.2; bookT = 2; boltT = 14;
    obstacles = []; books = []; bolts = []; toasts = []; cosplayers = [];
    shownMs = new Set();
    player = { x: Math.min(90, W * 0.14), y: 0, vy: 0, onGround: true, w: 34, h: 52, coyote: 0, jumpBuf: 0 };
    dead = false;
    scoreEl.textContent = 'уроков: 0';
  }

  function resize() {
    W = overlay.clientWidth; H = overlay.clientHeight - 52;
    canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    GROUND = H * 0.72;
    if (player) { player.x = Math.min(90, W * 0.14); }
  }

  // ---------- input ----------
  function jump() {
    if (dead) { start(); return; }
    if (player.onGround || player.coyote > 0) {
      player.vy = -640; player.onGround = false; player.coyote = 0;
      hintEl.style.opacity = 0;
    } else {
      player.jumpBuf = 0.14; // нажатие в воздухе — прыжок сразу при приземлении
    }
  }
  function onKey(e) {
    if (overlay.hidden) {
      // глобальный запуск пробелом — только если фокус не в поле ввода и лайтбокс закрыт
      const lb = document.getElementById('lightbox');
      if (e.code === 'Space' && (!lb || lb.hidden) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); open();
      }
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
    if (e.code === 'Escape') close();
  }

  // ---------- game objects ----------
  function spawnObstacle() {
    const kinds = ['edit', 'deadline', 'slide'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    const size = k === 'slide' ? { w: 52, h: 38 } : k === 'deadline' ? { w: 34, h: 40 } : { w: 40, h: 28 };
    obstacles.push({ kind: k, x: W + 60, y: GROUND - size.h, ...size });
  }
  function spawnBook() { books.push({ x: W + 60, y: GROUND - 90 - Math.random() * 110, r: 14 }); }
  function spawnBolt() { bolts.push({ x: W + 60, y: GROUND - 130 - Math.random() * 80, r: 13 }); }
  function toast(text) { toasts.push({ text, t: 2.6 }); }

  // ---------- update ----------
  function update(dt) {
    const boost = boostT > 0 ? 1.7 : 1;
    if (boostT > 0) boostT -= dt;
    speed += dt * 4;
    beltShift = (beltShift + speed * boost * dt) % 46;

    // player physics
    player.vy += 1700 * dt;
    player.y += player.vy * dt;
    if (player.y >= 0) {
      player.y = 0; player.vy = 0; player.onGround = true;
      if (player.jumpBuf > 0) { player.jumpBuf = 0; jump(); }
    }
    else if (player.onGround) { player.onGround = false; player.coyote = 0.09; }
    if (!player.onGround && player.coyote > 0) player.coyote -= dt;
    if (player.jumpBuf > 0) player.jumpBuf -= dt;

    // spawns
    spawnT -= dt; bookT -= dt; boltT -= dt;
    if (spawnT <= 0) { spawnObstacle(); spawnT = 0.9 + Math.random() * 1.1 - Math.min(0.5, score / 400); }
    if (bookT <= 0) { spawnBook(); bookT = 1.4 + Math.random() * 1.4; }
    if (boltT <= 0) { spawnBolt(); boltT = 16 + Math.random() * 8; }

    const px = player.x, py = GROUND + player.y - player.h;
    const move = speed * boost * dt;

    obstacles.forEach(o => o.x -= move);
    books.forEach(b => b.x -= move);
    bolts.forEach(b => b.x -= move);
    obstacles = obstacles.filter(o => o.x > -80);
    books = books.filter(b => b.x > -40);
    bolts = bolts.filter(b => b.x > -40);

    // collisions
    for (const o of obstacles) {
      if (boostT > 0) break;
      if (px < o.x + o.w - 8 && px + player.w > o.x + 8 && py + player.h > o.y + 6) { gameOver(); return; }
    }
    books = books.filter(b => {
      if (Math.abs(b.x - (px + player.w / 2)) < 30 && Math.abs(b.y - (py + player.h / 2)) < 44) {
        score++; scoreEl.textContent = 'уроков: ' + score;
        for (const [n, text] of MILESTONES) if (score === n && !shownMs.has(n)) {
          shownMs.add(n); toast(text);
          if (n === 500) cosplayers = [{ off: 60 }, { off: 105 }, { off: 150 }];
        }
        return false;
      }
      return true;
    });
    bolts = bolts.filter(b => {
      if (Math.abs(b.x - (px + player.w / 2)) < 32 && Math.abs(b.y - (py + player.h / 2)) < 46) {
        boostT = 2.5; toast('AI-конвейер запущен'); return false;
      }
      return true;
    });

    toasts.forEach(t => t.t -= dt);
    toasts = toasts.filter(t => t.t > 0);
  }

  // ---------- draw ----------
  function drawChar(x, groundY, yOff, scale, ghost) {
    if (!charImg.naturalWidth) { stickman(x, groundY, yOff, scale, ghost); return; }
    const s = scale || 1;
    let frame;
    if (dead) frame = 5;
    else if (!player.onGround && Math.abs(player.vy) > 40) frame = 4;
    else frame = Math.floor(performance.now() / 90) % 4;
    const h = 78 * s, w = h * 0.68;
    drawSprite(charImg, CHAR_GRID, frame, x - w * 0.18, groundY + yOff - h + 2, w, h, ghost ? 0.5 : 1);
  }

  function stickman(x, groundY, yOff, scale, ghost) {
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, groundY + yOff);
    ctx.scale(s, s);
    ctx.globalAlpha = ghost ? 0.55 : 1;
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round';
    // тело
    ctx.beginPath(); ctx.moveTo(17, -34); ctx.lineTo(17, -14); ctx.stroke();
    // ноги (бег)
    const ph = Math.sin(performance.now() / 70) * 8;
    ctx.beginPath(); ctx.moveTo(17, -14); ctx.lineTo(8 + ph / 2, 0); ctx.moveTo(17, -14); ctx.lineTo(26 - ph / 2, 0); ctx.stroke();
    // руки
    ctx.beginPath(); ctx.moveTo(17, -28); ctx.lineTo(6, -20 - ph / 3); ctx.moveTo(17, -28); ctx.lineTo(28, -22 + ph / 3); ctx.stroke();
    // голова
    ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(17, -43, 9, 0, 7); ctx.fill(); ctx.stroke();
    // красный шарф методолога
    ctx.strokeStyle = RED; ctx.beginPath(); ctx.moveTo(11, -33); ctx.lineTo(23, -33); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);

    // облака
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.fillStyle = '#fff';
    [[W * 0.2, H * 0.16], [W * 0.62, H * 0.1], [W * 0.85, H * 0.22]].forEach(([cx, cy]) => {
      ctx.beginPath(); ctx.ellipse(cx, cy, 34, 13, 0, 0, 7); ctx.fill(); ctx.stroke();
    });

    // конвейер
    ctx.fillStyle = '#efeae0'; ctx.fillRect(0, GROUND, W, 26);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.strokeRect(-4, GROUND, W + 8, 26);
    for (let x = -beltShift; x < W; x += 46) {
      ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x - 12, GROUND + 26); ctx.stroke();
    }

    // объекты
    obstacles.forEach(o => {
      if (itemsImg.naturalWidth) {
        const pad = o.kind === 'slide' ? 6 : 10;
        drawSprite(itemsImg, ITEM_GRID, ITEM_IDX[o.kind], o.x - pad, o.y - pad, o.w + pad * 2, o.h + pad * 2);
        return;
      }
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
      if (o.kind === 'edit') { // красная каракуля-правка
        ctx.strokeStyle = RED; ctx.beginPath();
        for (let i = 0; i <= 8; i++) ctx.lineTo(o.x + (o.w / 8) * i, o.y + o.h - (i % 2) * o.h);
        ctx.stroke();
      } else if (o.kind === 'deadline') { // будильник
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2 + 4, o.w / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = RED;
        ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y + o.h / 2 + 4); ctx.lineTo(o.x + o.w / 2, o.y + 10); ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.beginPath(); ctx.moveTo(o.x + 6, o.y + 4); ctx.lineTo(o.x + 12, o.y); ctx.moveTo(o.x + o.w - 6, o.y + 4); ctx.lineTo(o.x + o.w - 12, o.y); ctx.stroke();
      } else { // скучный слайд
        ctx.fillStyle = '#d9d4c9'; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = SOFT; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(o.x + 8, o.y + 12); ctx.lineTo(o.x + o.w - 8, o.y + 12);
        ctx.moveTo(o.x + 8, o.y + 20); ctx.lineTo(o.x + o.w - 8, o.y + 20); ctx.stroke();
      }
    });

    // книги
    books.forEach(b => {
      if (itemsImg.naturalWidth) {
        drawSprite(itemsImg, ITEM_GRID, ITEM_IDX.book, b.x - 19, b.y - 15, 38, 30);
        return;
      }
      ctx.save(); ctx.translate(b.x, b.y);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-7, -8, 0, 0); ctx.quadraticCurveTo(7, -8, 14, 0);
      ctx.lineTo(14, 6); ctx.quadraticCurveTo(7, -2, 0, 6); ctx.quadraticCurveTo(-7, -2, -14, 6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = RED; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6); ctx.stroke();
      ctx.restore();
    });

    // молнии
    bolts.forEach(b => {
      if (itemsImg.naturalWidth) {
        drawSprite(itemsImg, ITEM_GRID, ITEM_IDX.bolt, b.x - 15, b.y - 19, 30, 38);
        return;
      }
      ctx.save(); ctx.translate(b.x, b.y);
      ctx.fillStyle = RED; ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(2, -14); ctx.lineTo(-6, 2); ctx.lineTo(0, 2); ctx.lineTo(-2, 14); ctx.lineTo(7, -2); ctx.lineTo(1, -2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    });

    // косплееры (после 500)
    cosplayers.forEach(c => drawChar(player.x - c.off, GROUND, 0, 0.8, true));

    // игрок
    if (boostT > 0) { ctx.save(); ctx.shadowColor = RED; ctx.shadowBlur = 18; }
    drawChar(player.x, GROUND, player.y, 1, false);
    if (boostT > 0) ctx.restore();

    // тосты
    toasts.forEach((t, i) => {
      ctx.font = '700 22px "Inter Tight", sans-serif';
      const w = ctx.measureText(t.text).width + 36;
      const x = (W - w) / 2, y = H * 0.2 + i * 52;
      ctx.globalAlpha = Math.min(1, t.t);
      ctx.fillStyle = INK; ctx.fillRect(x, y, w, 40);
      ctx.fillStyle = PAPER; ctx.fillText(t.text, x + 18, y + 27);
      ctx.globalAlpha = 1;
    });

    // экран смерти
    if (dead) {
      ctx.fillStyle = 'rgba(250,248,244,0.88)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.font = '900 34px "Inter Tight", sans-serif';
      ctx.fillText('CSI упал ниже 80%', W / 2, H * 0.4);
      ctx.font = '400 15px "IBM Plex Mono", monospace';
      ctx.fillStyle = SOFT;
      ctx.fillText('уроков за смену: ' + score + '   ·   рекорд: ' + best, W / 2, H * 0.4 + 34);
      ctx.fillStyle = RED;
      ctx.fillText('ПРОБЕЛ / ТАП — ПЕРЕСОБРАТЬ КУРС', W / 2, H * 0.4 + 72);
      ctx.textAlign = 'left';
    }
  }

  // ---------- loop ----------
  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.033, (t - tPrev) / 1000 || 0.016);
    tPrev = t;
    if (!dead) update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function gameOver() {
    dead = true;
    if (score > best) { best = score; localStorage.setItem('shift-best', best); }
  }
  function start() { reset(); }

  // ---------- open/close ----------
  function open() {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    hintEl.style.opacity = 1;
    resize(); reset();
    running = true; tPrev = 0;
    raf = requestAnimationFrame(frame);
  }
  function close() {
    running = false;
    cancelAnimationFrame(raf);
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  overlay.querySelector('.game__close').addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.game__close')) return;
    jump();
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (!overlay.hidden) resize(); });

  // триггер в hero
  const trigger = document.getElementById('gameTrigger');
  if (trigger) trigger.addEventListener('click', open);
})();
