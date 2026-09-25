(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('nextPiece');
  const nextCtx = nextCanvas.getContext('2d');
  const W = 560, H = 610, FLOOR = 584, LEFT = 20, RIGHT = 540, WATER = 400, DANGER = 126;
  const G = 1150, DENSITY = 1.3, TICK = 1 / 60, SUBSTEPS = 4, DT = TICK / SUBSTEPS;
  // Contacts are soft: a stiffening spring lets slimes sink into each other before a hard cap applies.
  const CONTACT_K1 = 15000, CONTACT_K2 = 160000, CONTACT_DAMP = 20, FAST = 80, MAX_OVERLAP = .32;
  const JELLY_K = 260, JELLY_D = 9, MAX_SQUISH = .3;
  const COLS = 57, COL_W = W / (COLS - 1);
  const radii = [22, 27, 33, 39, 46, 53, 60, 68, 76, 85];
  const colors = ['#ffc12d','#145fe7','#fa274c','#f174b1','#813cce','#7bd82c','#31cee7','#343638','#f2f4f1','#a76037'];
  const names = ['SUNNY','BLUEY','BERRY','BUBBLE','VIOLET','LIME','SPLASH','SHADOW','CLOUD','COCOA'];
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const mergesEl = document.getElementById('merges');
  const nextNameEl = document.getElementById('nextName');
  const energyFill = document.getElementById('energyFill');
  const energyTrack = document.getElementById('energyTrack');
  const gameOver = document.getElementById('gameOver');
  const announcement = document.getElementById('announcement');
  const buttons = [document.getElementById('waveLeft'), document.getElementById('waveRight')];
  const sheet = new Image();
  const sprites = [];
  sheet.src = 'assets/dlicom-characters.png';

  // Only the white background connected to each crop's edge is removed; white details stay intact.
  sheet.onload = () => {
    for (let i = 0; i < 10; i++) {
      const sprite = document.createElement('canvas');
      sprite.width = 307; sprite.height = 311;
      const c = sprite.getContext('2d', { willReadFrequently: true });
      c.drawImage(sheet, (i % 5) * 307, i < 5 ? 163 : 529, 307, 311, 0, 0, 307, 311);
      const image = c.getImageData(0, 0, 307, 311);
      const d = image.data, seen = new Uint8Array(307 * 311), queue = new Int32Array(307 * 311);
      let head = 0, tail = 0;
      const add = (x, y) => {
        if (x < 0 || y < 0 || x >= 307 || y >= 311) return;
        const n = y * 307 + x, p = n * 4;
        if (seen[n] || d[p] < 230 || d[p + 1] < 230 || d[p + 2] < 230) return;
        seen[n] = 1; queue[tail++] = n;
      };
      for (let x = 0; x < 307; x++) { add(x, 0); add(x, 310); }
      for (let y = 0; y < 311; y++) { add(0, y); add(306, y); }
      while (head < tail) {
        const n = queue[head++], x = n % 307, y = (n / 307) | 0;
        d[n * 4 + 3] = 0;
        add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
      }
      c.putImageData(image, 0, 0);
      sprites.push(sprite);
    }
    drawNext();
  };

  const surfaceH = new Float32Array(COLS), surfaceV = new Float32Array(COLS);
  let pieces, merges, particles, bubbles, score, best, mergeCount, next, aimX, energy, current, waveTime, waveCooldown, dangerTime, ended, unlocked, lastMerge, combo, dropCooldown, time;
  try { best = Number(localStorage.getItem('drift-drop-best')) || 0; } catch { best = 0; }

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const format = n => String(n).padStart(4, '0');
  const randomNext = () => Math.floor(Math.random() * 3);
  const announce = text => { announcement.textContent = text; };
  // Deformation is a headless axis vector (p, q) = s * (cos 2θ, sin 2θ): s > 0 squashes along θ.
  const makePiece = (x, y, level) => ({ x, y, vx: 0, vy: 0, a: 0, w: 0, level, age: 0, p: 0, q: 0, pv: 0, qv: 0, tp: 0, tq: 0, t0: 0, t1: 0, t2: 0, fx: 0, fy: 0, ox: 0, oy: 0, f: 0, wet: false, merging: null, phase: Math.random() * 6.283 });
  const makeBubble = temp => ({ x: LEFT + 10 + Math.random() * (RIGHT - LEFT - 20), y: temp ? 0 : WATER + 20 + Math.random() * 160, r: .8 + Math.random() * 2.2, s: 14 + Math.random() * 22, temp });

  function updateUI() {
    scoreEl.textContent = format(score);
    bestEl.textContent = format(best);
    mergesEl.textContent = String(mergeCount).padStart(2, '0');
    nextNameEl.textContent = names[next];
    document.querySelectorAll('.tier-dot').forEach((dot, i) => dot.classList.toggle('unlocked', i <= unlocked));
    drawNext();
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, 94, 94);
    if (sprites[next]) nextCtx.drawImage(sprites[next], 4, 4, 86, 87);
    else { nextCtx.fillStyle = colors[next]; nextCtx.beginPath(); nextCtx.arc(47, 47, 40, 0, Math.PI * 2); nextCtx.fill(); }
  }

  function reset() {
    pieces = [makePiece(147, FLOOR - 20, 0), makePiece(208, FLOOR - 25, 1), makePiece(299, FLOOR - 20, 0), makePiece(373, FLOOR - 31, 2)];
    pieces.forEach(p => { p.age = 5; p.wet = true; });
    merges = []; particles = []; bubbles = Array.from({ length: 14 }, () => makeBubble(false));
    surfaceH.fill(0); surfaceV.fill(0);
    score = 0; mergeCount = 0; next = randomNext(); aimX = W / 2;
    energy = 100; current = 0; waveTime = 0; waveCooldown = 0; dangerTime = 0;
    ended = false; unlocked = 2; lastMerge = -20; combo = 0; dropCooldown = 0; time = 0;
    gameOver.hidden = true;
    updateUI();
    announce('New game. Click the board to drop a piece.');
  }

  function surfaceAt(x) {
    const i = clamp(x / COL_W, 0, COLS - 1.001), k = Math.floor(i), f = i - k;
    return WATER + surfaceH[k] * (1 - f) + surfaceH[k + 1] * f;
  }

  // Area fraction of a circle lying below the local waterline (circular segment).
  function submerged(y, r, sy) {
    const d = sy - y;
    if (d >= r) return 0;
    if (d <= -r) return 1;
    return (r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d)) / (Math.PI * r * r);
  }

  function disturb(x, radius, dv) {
    const from = Math.max(0, Math.floor((x - radius) / COL_W)), to = Math.min(COLS - 1, Math.ceil((x + radius) / COL_W));
    for (let i = from; i <= to; i++) { const d = (i * COL_W - x) / radius; surfaceV[i] += dv * Math.max(0, 1 - d * d); }
  }

  function updateSurface(dt) {
    for (let i = 0; i < COLS; i++) {
      const l = surfaceH[i > 0 ? i - 1 : 1], r = surfaceH[i < COLS - 1 ? i + 1 : COLS - 2];
      surfaceV[i] += ((l + r - 2 * surfaceH[i]) * 625 - 60 * surfaceH[i] - 2.2 * surfaceV[i]) * dt;
      surfaceV[i] = clamp(surfaceV[i], -700, 700);
    }
    for (let i = 0; i < COLS; i++) surfaceH[i] = clamp(surfaceH[i] + surfaceV[i] * dt, -42, 42);
  }

  function splash(x, y, count, color, power, spread) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 1.7, v = power * (.35 + Math.random() * .75);
      particles.push({ x: x + (Math.random() - .5) * spread * 2, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .6 + Math.random() * .5, color, size: 1.5 + Math.random() * 3 });
    }
  }

  function press(p, nx, ny, impulse) {
    p.t0 += impulse * nx * nx; p.t1 += impulse * nx * ny; p.t2 += impulse * ny * ny;
    p.fx += impulse * nx; p.fy += impulse * ny;
  }

  function kick(p, nx, ny, dv) {
    const k = Math.min(6, dv * .014), th = Math.atan2(ny, nx);
    p.pv += k * Math.cos(2 * th); p.qv += k * Math.sin(2 * th);
  }

  function fluid(p, dt) {
    const r = radii[p.level], sy = surfaceAt(p.x), f = submerged(p.y, r, sy);
    p.f = f;
    p.vy += G * dt;
    // Bottom-heavy blobs: a weak righting torque keeps faces mostly upright, stronger when afloat.
    p.w -= Math.sin(p.a) * (2.5 + 5 * f) * dt;
    if (f > 0) {
      p.vy -= G * f / DENSITY * dt;
      const rvx = p.vx - current, rvy = p.vy, k = Math.min(.8, f * (.9 + .35 * Math.hypot(rvx, rvy) / r) * dt);
      p.vx -= rvx * k; p.vy -= rvy * k;
      p.w *= 1 - Math.min(.8, 3 * f * dt);
      if (Math.abs(p.y - sy) < r) {
        const wt = (1 - Math.abs(p.y - sy) / r) * Math.min(1, 5 * dt) * Math.min(1, r / 45);
        const from = Math.max(0, Math.floor((p.x - r) / COL_W)), to = Math.min(COLS - 1, Math.ceil((p.x + r) / COL_W));
        for (let i = from; i <= to; i++) { const d = (i * COL_W - p.x) / r; surfaceV[i] += (p.vy * .9 - surfaceV[i]) * Math.max(0, 1 - d * d) * wt; }
      }
      if (!p.wet) {
        p.wet = true;
        if (p.vy > 140) splash(p.x, sy, Math.min(26, Math.round(3 + p.vy * .018 + r * .15)), '#a9f7f1', 180 + p.vy * .55, r * .8);
      }
    } else {
      const k = Math.min(.5, (.04 + .012 * Math.hypot(p.vx, p.vy) / r) * dt);
      p.vx -= p.vx * k; p.vy -= p.vy * k; p.w *= 1 - .4 * dt; p.wet = false;
    }
  }

  function contactPair(a, b, dt) {
    const ra = radii[a.level], rb = radii[b.level];
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || .001, overlap = ra + rb - dist;
    if (overlap <= 0) return;
    if (a.level === b.level && !a.merging && !b.merging && a.age > .15 && b.age > .15) { startMerge(a, b); return; }
    const ia = a.merging ? 0 : 1 / (ra * ra), ib = b.merging ? 0 : 1 / (rb * rb);
    if (!ia && !ib) return;
    const nx = dx / dist, ny = dy / dist, tx = -ny, ty = nx, mr = 1 / (ia + ib);
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny, c = overlap / Math.min(ra, rb);
    let impulse = Math.max(0, mr * (CONTACT_K1 * c + CONTACT_K2 * c * c - CONTACT_DAMP * vn)) * dt;
    if (vn < -FAST) { const j = -(vn + FAST) * mr; impulse += j; kick(a, nx, ny, j * ia); kick(b, nx, ny, j * ib); }
    a.vx -= nx * impulse * ia; a.vy -= ny * impulse * ia; b.vx += nx * impulse * ib; b.vy += ny * impulse * ib;
    press(a, -nx, -ny, impulse); press(b, nx, ny, impulse);
    const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - b.w * rb - a.w * ra;
    const jt = clamp(-vt / (3 * ia + 3 * ib), -.5 * impulse, .5 * impulse);
    a.vx -= tx * jt * ia; a.vy -= ty * jt * ia; b.vx += tx * jt * ib; b.vy += ty * jt * ib;
    a.w -= 2 * jt * ia / ra; b.w -= 2 * jt * ib / rb;
    if (c > MAX_OVERLAP) {
      const excess = overlap - MAX_OVERLAP * Math.min(ra, rb), share = 1 / (ia + ib);
      a.x -= nx * excess * ia * share; a.y -= ny * excess * ia * share; b.x += nx * excess * ib * share; b.y += ny * excess * ib * share;
    }
  }

  function contactWall(p, nx, ny, overlap, dt, mu) {
    if (overlap <= 0) return;
    const r = radii[p.level], m = r * r;
    if (p.merging) { p.x += nx * overlap; p.y += ny * overlap; return; }
    const vn = p.vx * nx + p.vy * ny, c = overlap / r;
    let impulse = Math.max(0, m * (CONTACT_K1 * c + CONTACT_K2 * c * c - CONTACT_DAMP * vn)) * dt;
    if (vn < -FAST) { const j = -(vn + FAST) * m; impulse += j; kick(p, nx, ny, j / m); }
    p.vx += nx * impulse / m; p.vy += ny * impulse / m;
    press(p, nx, ny, impulse);
    const tx = -ny, ty = nx, vt = p.vx * tx + p.vy * ty - p.w * r;
    const jt = clamp(-vt * m / 3, -mu * impulse, mu * impulse);
    p.vx += tx * jt / m; p.vy += ty * jt / m; p.w -= 2 * jt / (m * r);
    if (c > MAX_OVERLAP) { const excess = overlap - MAX_OVERLAP * r; p.x += nx * excess; p.y += ny * excess; }
  }

  function startMerge(a, b) { a.merging = b; b.merging = a; merges.push({ a, b, t: 0 }); }

  function updateMerges(dt) {
    for (let i = merges.length - 1; i >= 0; i--) {
      const m = merges[i], { a, b } = m;
      m.t += dt;
      const vx = (a.vx + b.vx) / 2 * (1 - 4 * dt), vy = (a.vy + b.vy) / 2 * (1 - 4 * dt), k = Math.min(1, 10 * dt);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      a.vx = b.vx = vx; a.vy = b.vy = vy;
      a.x += (mx - a.x) * k + vx * dt; a.y += (my - a.y) * k + vy * dt;
      b.x += (mx - b.x) * k + vx * dt; b.y += (my - b.y) * k + vy * dt;
      if (m.t >= .26) { merges.splice(i, 1); finishMerge(a, b); }
    }
  }

  function finishMerge(a, b) {
    const level = a.level + 1, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, th = Math.atan2(b.y - a.y, b.x - a.x);
    pieces.splice(pieces.indexOf(a), 1);
    pieces.splice(pieces.indexOf(b), 1);
    if (level < 10) {
      const p = makePiece(x, y, level);
      p.vx = a.vx; p.vy = a.vy - 40; p.w = (a.w + b.w) / 2; p.age = .2; p.wet = a.wet;
      kick(p, Math.cos(th), Math.sin(th), 380);
      pieces.push(p);
    }
    const sy = surfaceAt(x);
    if (y < sy + 10) splash(x, Math.min(y, sy), 16, colors[Math.min(level, 9)], 420, radii[Math.min(level, 9)] * .6);
    else for (let i = 0; i < 7; i++) { const bubble = makeBubble(true); bubble.x = x + (Math.random() - .5) * 40; bubble.y = y; bubble.r += 1; bubbles.push(bubble); }
    combo = time - lastMerge < 2.5 ? combo + 1 : 1;
    lastMerge = time;
    score += 20 * (2 ** (level - 1)) * Math.min(combo, 5);
    mergeCount++;
    unlocked = Math.max(unlocked, Math.min(level, 9));
    if (score > best) {
      best = score;
      try { localStorage.setItem('drift-drop-best', String(best)); } catch { /* Storage may be unavailable. */ }
    }
    updateUI();
    announce(level === 10 ? `Ultimate merge! ${score} points.` : `${names[level]} unlocked! ${score} points${combo > 1 ? `, ${combo} merge combo` : ''}.`);
  }

  function substep(dt) {
    time += dt;
    current *= Math.exp(-dt / .75);
    updateSurface(dt);
    updateMerges(dt);
    for (const p of pieces) { p.age += dt; if (!p.merging) fluid(p, dt); }
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) contactPair(pieces[i], pieces[j], dt);
    for (const p of pieces) {
      const r = radii[p.level];
      contactWall(p, 1, 0, LEFT - (p.x - r), dt, .4);
      contactWall(p, -1, 0, p.x + r - RIGHT, dt, .4);
      contactWall(p, 0, -1, p.y + r - FLOOR, dt, .7);
    }
    for (const p of pieces) {
      if (!p.merging) { p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.w * dt; }
      p.pv += (-JELLY_K * (p.p - p.tp) - JELLY_D * p.pv) * dt; p.p += p.pv * dt;
      p.qv += (-JELLY_K * (p.q - p.tq) - JELLY_D * p.qv) * dt; p.q += p.qv * dt;
    }
    for (const d of particles) {
      d.vy += G * .85 * dt; d.vx *= 1 - .6 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.vy > 0 && d.y > surfaceAt(d.x) - 2) { d.life = 0; disturb(d.x, 9, 30 + d.size * 12); }
      else if (d.y > FLOOR || d.x < 0 || d.x > W) d.life = 0;
    }
  }

  // Averages the tick's contact forces into a squash target and shifts the body toward its support.
  function finalizeTick(p) {
    const r = radii[p.level];
    if (p.merging) {
      const th = Math.atan2(p.merging.y - p.y, p.merging.x - p.x);
      p.tp = -.3 * Math.cos(2 * th); p.tq = -.3 * Math.sin(2 * th); p.ox *= .7; p.oy *= .7;
      return;
    }
    const scale = 1 / (r * r * G * TICK), a = p.t0 * scale, b = p.t1 * scale, c = p.t2 * scale;
    const lam = (a + c) / 2 + Math.hypot((a - c) / 2, b), th = .5 * Math.atan2(2 * b, a - c);
    const s = Math.min(MAX_SQUISH, lam * .1);
    let tp = s * Math.cos(2 * th), tq = s * Math.sin(2 * th);
    const speed = Math.hypot(p.vx, p.vy);
    if (lam < .2 && speed > 140 && p.f < .4) {
      const st = Math.min(.12, (speed - 140) * .00022), tv = Math.atan2(p.vy, p.vx);
      tp -= st * Math.cos(2 * tv); tq -= st * Math.sin(2 * tv);
    }
    p.tp = tp; p.tq = tq;
    const fm = Math.hypot(p.fx, p.fy), shift = fm ? -s * r * .5 * Math.min(1, fm * scale) : 0;
    const ox = fm ? p.fx / fm * shift : 0, oy = fm ? p.fy / fm * shift : 0;
    p.ox += (ox - p.ox) * .3; p.oy += (oy - p.oy) * .3;
    p.t0 = p.t1 = p.t2 = p.fx = p.fy = 0;
  }

  function tick() {
    for (let s = 0; s < SUBSTEPS; s++) substep(DT);
    for (const p of pieces) finalizeTick(p);
    particles = particles.filter(d => d.life > 0);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.s * TICK; b.x += (current * .5 + Math.sin(time * 2 + b.r * 7) * 8) * TICK;
      b.x = clamp(b.x, LEFT + 4, RIGHT - 4);
      if (b.y - b.r < surfaceAt(b.x)) {
        disturb(b.x, 6, 18);
        if (b.temp) bubbles.splice(i, 1);
        else { bubbles[i] = makeBubble(false); bubbles[i].y = FLOOR - 4 - Math.random() * 40; }
      }
    }
    if (Math.random() < .012) disturb(LEFT + Math.random() * (RIGHT - LEFT), 25, (Math.random() - .5) * 70);
    dropCooldown = Math.max(0, dropCooldown - TICK);
    waveCooldown = Math.max(0, waveCooldown - TICK);
    waveTime = Math.max(0, waveTime - TICK);
    energy = Math.min(100, energy + TICK * 11);
    energyFill.style.width = `${energy}%`;
    energyTrack.setAttribute('aria-valuenow', String(Math.round(energy)));
    buttons.forEach(button => button.disabled = ended || energy < 42 || waveCooldown > 0);
    const danger = pieces.some(p => !p.merging && p.age > 1 && p.y - radii[p.level] < DANGER && Math.hypot(p.vx, p.vy) < 70);
    dangerTime = danger ? dangerTime + TICK : Math.max(0, dangerTime - TICK * 2);
    if (dangerTime > 2.5) {
      ended = true; gameOver.hidden = false;
      document.getElementById('finalScore').textContent = score;
      announce(`Game over. You scored ${score} points.`);
      if (window.__driftLeaderboard && score > 0) window.__driftLeaderboard.submit(score);
    }
  }

  function drop() {
    if (ended || dropCooldown > 0) return;
    const level = next, r = radii[level], p = makePiece(clamp(aimX, LEFT + r, RIGHT - r), 70, level);
    p.vy = 20; p.w = (Math.random() - .5) * .6;
    pieces.push(p);
    next = randomNext(); dropCooldown = .48;
    updateUI();
    announce(`${names[level]} dropped. ${names[next]} is next.`);
  }

  function sendWave(direction) {
    if (ended || energy < 42 || waveCooldown > 0) return;
    energy -= 42; current = direction * 430; waveTime = 1.2; waveCooldown = .45;
    const x = direction > 0 ? LEFT + 40 : RIGHT - 40;
    disturb(x, 80, -320);
    splash(x, surfaceAt(x), 14, '#a9f7f1', 380, 30);
    announce(`Wave sent ${direction < 0 ? 'left' : 'right'}.`);
  }

  function drawPiece(p, opacity = 1) {
    const r = radii[p.level], s = Math.min(.45, Math.hypot(p.p, p.q)), th = .5 * Math.atan2(p.q, p.p);
    const idle = .012 * Math.sin(time * 4 + p.phase);
    ctx.save();
    ctx.translate(p.x + p.ox, p.y + p.oy); ctx.globalAlpha = opacity;
    ctx.rotate(th); ctx.scale(1 - s, 1 + s * .9); ctx.rotate(-th); ctx.rotate(p.a); ctx.scale(1 - idle, 1 + idle);
    ctx.shadowColor = '#020c20'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 8;
    if (sprites[p.level]) ctx.drawImage(sprites[p.level], -r, -r, 2 * r, 2.03 * r);
    else { ctx.fillStyle = colors[p.level]; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function tracePath(offset) {
    ctx.beginPath(); ctx.moveTo(0, WATER + surfaceH[0] + offset);
    for (let i = 1; i < COLS; i++) ctx.lineTo(i * COL_W, WATER + surfaceH[i] + offset);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#152744'); bg.addColorStop(.65, '#173b59'); bg.addColorStop(1, '#17465a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c0f2f21a';
    for (let x = 39; x < W; x += 35) for (let y = 24; y < H; y += 35) { ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#7ae8df17'; ctx.lineWidth = 1;
    for (let x = 25; x < W; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    const glow = ctx.createRadialGradient(W / 2, 440, 15, W / 2, 440, 330);
    glow.addColorStop(0, '#2ba6bf38'); glow.addColorStop(1, '#2ba6bf00');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    ctx.save(); ctx.setLineDash([5, 7]); ctx.strokeStyle = dangerTime ? '#ff8199' : '#b7d5d547'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(25, DANGER); ctx.lineTo(535, DANGER); ctx.stroke(); ctx.restore();
    ctx.font = '800 9px Arial, sans-serif'; ctx.letterSpacing = '1.2px'; ctx.fillStyle = dangerTime ? '#ffa6b5' : '#a8b9c47f';
    ctx.fillText('HIGH TIDE LINE', 34, DANGER - 11);

    ctx.strokeStyle = '#8bdde43e'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(19, FLOOR); ctx.quadraticCurveTo(19, FLOOR + 13, 32, FLOOR + 13); ctx.lineTo(528, FLOOR + 13); ctx.quadraticCurveTo(541, FLOOR + 13, 541, FLOOR); ctx.lineTo(541, 0); ctx.stroke();
    ctx.strokeStyle = '#d9ffff21'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(25, FLOOR); ctx.moveTo(535, 0); ctx.lineTo(535, FLOOR); ctx.stroke();

    for (const p of pieces) {
      const r = radii[p.level], gap = FLOOR - (p.y + r), alpha = .35 * clamp(1 - gap / 220, 0, 1);
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(3,21,35,${alpha})`; ctx.beginPath(); ctx.ellipse(p.x, FLOOR + 2, r * (.75 + gap / 600), 5, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of pieces) drawPiece(p);

    ctx.strokeStyle = '#d6fffb55'; ctx.lineWidth = 1;
    for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }
    if (Math.abs(current) > 25) {
      ctx.strokeStyle = `rgba(190,255,250,${Math.min(.35, Math.abs(current) / 900)})`; ctx.lineWidth = 1.5;
      const span = RIGHT - LEFT;
      for (let k = 0; k < 7; k++) {
        const y = WATER + 28 + k * 24, len = Math.abs(current) * .22, x = LEFT + (((k * 83 + time * current * .8) % span) + span) % span;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(clamp(x - Math.sign(current) * len, LEFT, RIGHT), y); ctx.stroke();
      }
    }

    tracePath(0); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    const water = ctx.createLinearGradient(0, WATER - 40, 0, H);
    water.addColorStop(0, '#6fe6ec3a'); water.addColorStop(.4, '#2fb8cf3e'); water.addColorStop(1, '#0f6f8f66');
    ctx.fillStyle = water; ctx.fill();
    tracePath(0); ctx.strokeStyle = waveTime ? '#c6fff7dd' : '#8df8e1aa'; ctx.lineWidth = 2; ctx.stroke();
    tracePath(4); ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1; ctx.stroke();

    for (const d of particles) { ctx.globalAlpha = Math.min(1, d.life * 1.7); ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    if (!ended && dropCooldown <= 0) {
      const r = radii[next], x = clamp(aimX, LEFT + r, RIGHT - r);
      ctx.save(); ctx.setLineDash([3, 7]); ctx.strokeStyle = '#9fe9e870'; ctx.beginPath(); ctx.moveTo(x, 91 + r); ctx.lineTo(x, Math.min(WATER - 15, 245)); ctx.stroke(); ctx.restore();
      drawPiece({ x, y: 67, level: next, p: 0, q: 0, a: 0, ox: 0, oy: 0, phase: 0 }, .8);
      ctx.fillStyle = '#c5fff2'; ctx.beginPath(); ctx.arc(x, 10, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (dangerTime) { ctx.fillStyle = '#ff627733'; ctx.fillRect(0, 0, W, 7 * Math.min(1, dangerTime / 2.5)); }
  }

  let previous = performance.now(), accumulator = 0;
  function frame(now) {
    const elapsed = Math.min((now - previous) / 1000, .05); previous = now;
    if (!ended) { accumulator += elapsed; while (accumulator >= TICK) { tick(); accumulator -= TICK; } }
    render(); requestAnimationFrame(frame);
  }

  function pointX(event) { const box = canvas.getBoundingClientRect(); return (event.clientX - box.left) * W / box.width; }
  canvas.addEventListener('pointermove', event => { aimX = pointX(event); });
  canvas.addEventListener('pointerdown', event => { aimX = pointX(event); drop(); });
  buttons[0].addEventListener('click', () => sendWave(-1));
  buttons[1].addEventListener('click', () => sendWave(1));
  document.getElementById('restart').addEventListener('click', reset);
  document.getElementById('playAgain').addEventListener('click', reset);
  window.addEventListener('keydown', event => {
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'Space') {
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (event.code === 'Space') drop(); else sendWave(event.code === 'ArrowLeft' ? -1 : 1);
    }
  });
  const dots = document.getElementById('tierDots');
  colors.forEach((color, i) => {
    const dot = document.createElement('span'); dot.className = 'tier-dot'; dot.textContent = String(i + 1);
    dot.style.background = color; dot.style.setProperty('--dot-glow', color + '55'); dot.title = names[i]; dots.appendChild(dot);
  });
  if (location.hash === '#debug') window.driftDrop = { get pieces() { return pieces; }, get surfaceH() { return surfaceH; }, get current() { return current; } };
  reset(); requestAnimationFrame(frame);
})();
