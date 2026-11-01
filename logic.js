'use strict';
// 아스테로이드 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
const LOGIC_ASTEROIDS = (() => {
  const W = 240, H = 240;
  const TAU = Math.PI * 2;
  const START_LIVES = 3;
  const TURN = 4.2;                                   // 회전 속도(라디안/초)
  const THRUST = 95, DRAG = 0.32, MAX_SPEED = 150;    // 가속(픽셀/초²), 감속 비율(초당), 최고 속도
  const SHIP_R = 5;
  const BULLET_SPEED = 200, BULLET_LIFE = 1.15, MAX_BULLETS = 4, FIRE_COOL = 0.2;
  const SIZES = { 3: { r: 16, min: 18, max: 34, pts: 20 }, 2: { r: 9, min: 34, max: 58, pts: 50 }, 1: { r: 5, min: 55, max: 90, pts: 100 } };
  const SAUCER = { large: { r: 9, pts: 200, speed: 55 }, small: { r: 5, pts: 1000, speed: 70 } };
  const SAUCER_BULLET = 115, SAUCER_BULLET_LIFE = 1.7;
  const EXTRA_SHIP_EVERY = 10000;
  const SAFE_RADIUS = 50, RESPAWN_WAIT = 1.6, INVULN = 1.2, WAVE_DELAY = 2.2, DYING = 1.4;
  const SMALL_ONLY_AT = 40000;
  const waveCount = (wave) => Math.min(11, 4 + 2 * (wave - 1));      // 큰 소행성 수: 4, 6, 8, 10, 11, 11 ...

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const wrap = (o) => { o.x = (o.x % W + W) % W; o.y = (o.y % H + H) % H; };
  // 화면이 이어져 있으므로 가장 가까운 거리를 잰다
  const dist = (a, b) => { let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); if (dx > W / 2) dx = W - dx; if (dy > H / 2) dy = H - dy; return Math.hypot(dx, dy); };

  function newGame(rand = Math.random, wave = 1) {
    const st = { rand, score: 0, lives: START_LIVES, wave, t: 0, events: [], extra: 0, phase: 'play' };
    st.ship = null; st.bullets = []; st.sbullets = []; st.rocks = []; st.saucer = null; st.debris = [];
    startWave(st, wave);
    spawnShip(st, true);
    return st;
  }
  function spawnShip(st, first) {
    st.ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: first ? 2 : INVULN, cool: 0 };
    st.shipWait = 0;
  }
  function startWave(st, wave) {
    st.wave = wave; st.rocks = []; st.saucerT = 14 + st.rand() * 8; st.clearT = 0;
    const n = waveCount(wave);
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = st.rand() * W; y = st.rand() * H; tries++; } while (Math.hypot(x - W / 2, y - H / 2) < 70 && tries < 30);   // 가운데(내 우주선) 근처는 피한다
      addRock(st, 3, x, y);
    }
    emit(st, { t: 'wave', wave, n });
  }
  function addRock(st, size, x, y) {
    const s = SIZES[size], a = st.rand() * TAU, v = s.min + st.rand() * (s.max - s.min) + (st.wave - 1) * 1.5;
    st.rocks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size, r: s.r, rot: st.rand() * TAU, spin: (st.rand() - 0.5) * 2, seed: Math.floor(st.rand() * 1000) });
  }
  function addScore(st, n) {
    st.score += n;
    while (st.score >= (st.extra + 1) * EXTRA_SHIP_EVERY) { st.extra++; st.lives++; emit(st, { t: 'extra' }); }
  }

  function killShip(st, why) {
    const s = st.ship;
    if (!s || !s.alive || s.invuln > 0) return false;
    s.alive = false; st.lives--; st.shipWait = DYING;
    emit(st, { t: 'dead', why, x: s.x, y: s.y });
    return true;
  }

  function hitRock(st, rock, byPlayer) {
    st.rocks.splice(st.rocks.indexOf(rock), 1);
    const pts = SIZES[rock.size].pts;
    if (byPlayer) addScore(st, pts);
    emit(st, { t: 'hit', size: rock.size, pts: byPlayer ? pts : 0, x: rock.x, y: rock.y });
    if (rock.size > 1) for (let i = 0; i < 2; i++) addRock(st, rock.size - 1, rock.x, rock.y);
  }

  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'over') return;
    st.t += h;
    const s = st.ship;
    // 우주선
    if (s && s.alive) {
      const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (turn) { s.a += turn * TURN * h; emit(st, { t: 'turn', dir: turn }); }
      s.thrusting = !!input.thrust;
      if (input.thrust) { s.vx += Math.cos(s.a) * THRUST * h; s.vy += Math.sin(s.a) * THRUST * h; }
      const k = Math.exp(-DRAG * h); s.vx *= k; s.vy *= k;
      const sp = Math.hypot(s.vx, s.vy); if (sp > MAX_SPEED) { s.vx *= MAX_SPEED / sp; s.vy *= MAX_SPEED / sp; }
      s.x += s.vx * h; s.y += s.vy * h; wrap(s);
      s.invuln = Math.max(0, s.invuln - h); s.cool = Math.max(0, s.cool - h);
      if (input.fire && s.cool <= 0 && st.bullets.length < MAX_BULLETS) {
        st.bullets.push({ x: s.x + Math.cos(s.a) * 7, y: s.y + Math.sin(s.a) * 7, vx: s.vx * 0.3 + Math.cos(s.a) * BULLET_SPEED, vy: s.vy * 0.3 + Math.sin(s.a) * BULLET_SPEED, life: BULLET_LIFE });
        s.cool = FIRE_COOL; emit(st, { t: 'fire' });
      }
      if (input.hyper && !st.hyperHeld) { hyperspace(st); }
      st.hyperHeld = !!input.hyper;
    } else if (st.phase === 'play') {
      // 폭발 뒤, 주변이 비어 있으면 새 우주선
      st.shipWait -= h;
      if (st.shipWait <= 0) {
        if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); return; }
        const c = { x: W / 2, y: H / 2 };
        const clear = !st.rocks.some((r) => dist(r, c) < SAFE_RADIUS + r.r) && !(st.saucer && dist(st.saucer, c) < SAFE_RADIUS + 20);
        if (clear) { spawnShip(st, false); emit(st, { t: 'respawn' }); } else st.shipWait = 0;
      }
    }
    // 총알
    for (const b of st.bullets) { b.x += b.vx * h; b.y += b.vy * h; wrap(b); b.life -= h; }
    st.bullets = st.bullets.filter((b) => b.life > 0);
    for (const b of st.sbullets) { b.x += b.vx * h; b.y += b.vy * h; wrap(b); b.life -= h; }
    st.sbullets = st.sbullets.filter((b) => b.life > 0);
    // 소행성
    for (const r of st.rocks) { r.x += r.vx * h; r.y += r.vy * h; r.rot += r.spin * h; wrap(r); }
    updateSaucer(st, h);
    collisions(st);
    // 판 끝
    if (st.phase === 'play' && st.rocks.length === 0 && !st.saucer) {
      if (st.clearT === 0) { st.clearT = WAVE_DELAY; emit(st, { t: 'clear', wave: st.wave }); }
      st.clearT -= h;
      if (st.clearT <= 0) { st.bullets = []; st.sbullets = []; startWave(st, st.wave + 1); }
    }
  }

  function hyperspace(st) {
    const s = st.ship;
    s.x = st.rand() * W; s.y = st.rand() * H; s.vx = 0; s.vy = 0;
    emit(st, { t: 'hyper' });
    // 위험: 소행성이 많을수록 실패하기 쉽다
    const fail = Math.min(0.5, 0.06 + 0.012 * st.rocks.length);
    if (st.rand() < fail) { s.invuln = 0; killShip(st, 'hyper'); }
  }

  function updateSaucer(st, h) {
    if (!st.saucer) {
      st.saucerT -= h;
      if (st.saucerT <= 0 && st.phase === 'play') {
        const pSmall = st.score >= SMALL_ONLY_AT ? 1 : Math.min(0.75, st.score / 30000);
        const small = st.rand() < pSmall;
        const kind = small ? 'small' : 'large', d = SAUCER[kind];
        const dir = st.rand() < 0.5 ? 1 : -1;
        st.saucer = { kind, x: dir > 0 ? -d.r : W + d.r, y: 24 + st.rand() * (H - 48), vx: dir * d.speed, vy: 0, r: d.r, turnT: 1 + st.rand(), fireT: 1 + st.rand(), dir };
        emit(st, { t: 'saucer', kind });
      }
      return;
    }
    const u = st.saucer;
    u.x += u.vx * h; u.y += u.vy * h;
    u.turnT -= h;
    if (u.turnT <= 0) { u.vy = [-1, 0, 1][Math.floor(st.rand() * 3)] * u.vx * 0.5 * (u.vx > 0 ? 1 : -1); u.turnT = 0.8 + st.rand() * 1.2; }
    u.y = (u.y % H + H) % H;
    if (u.x < -u.r - 4 || u.x > W + u.r + 4) { st.saucer = null; st.saucerT = 12 + st.rand() * 10; return; }
    u.fireT -= h;
    if (u.fireT <= 0) {
      u.fireT = u.kind === 'small' ? 1.0 : 1.6;
      let a = st.rand() * TAU;
      const s = st.ship;
      if (u.kind === 'small' && s && s.alive) {                                  // 작은 UFO 는 조준한다. 점수가 높을수록 정확하다
        const err = Math.max(0.04, 0.5 - st.score / 80000);
        a = Math.atan2(s.y - u.y, s.x - u.x) + (st.rand() - 0.5) * 2 * err;
      }
      st.sbullets.push({ x: u.x, y: u.y, vx: Math.cos(a) * SAUCER_BULLET, vy: Math.sin(a) * SAUCER_BULLET, life: SAUCER_BULLET_LIFE });
      emit(st, { t: 'saucerfire' });
    }
  }

  function collisions(st) {
    // 내 총알 vs 소행성 / UFO
    for (const b of st.bullets.slice()) {
      let used = false;
      for (const r of st.rocks) if (dist(b, r) < r.r + 1) { hitRock(st, r, true); used = true; break; }
      if (!used && st.saucer && dist(b, st.saucer) < st.saucer.r + 1) {
        const u = st.saucer; addScore(st, SAUCER[u.kind].pts); emit(st, { t: 'saucerhit', kind: u.kind, pts: SAUCER[u.kind].pts, x: u.x, y: u.y });
        st.saucer = null; st.saucerT = 12 + st.rand() * 10; used = true;
      }
      if (used) st.bullets.splice(st.bullets.indexOf(b), 1);
    }
    // UFO 총알 vs 소행성 (소행성은 부서지지만 점수 없음)
    for (const b of st.sbullets.slice()) for (const r of st.rocks) if (dist(b, r) < r.r) { hitRock(st, r, false); st.sbullets.splice(st.sbullets.indexOf(b), 1); break; }
    // 소행성 vs UFO
    if (st.saucer) for (const r of st.rocks) if (dist(r, st.saucer) < r.r + st.saucer.r) { emit(st, { t: 'saucerhit', kind: st.saucer.kind, pts: 0, x: st.saucer.x, y: st.saucer.y }); st.saucer = null; st.saucerT = 12 + st.rand() * 10; hitRock(st, r, false); break; }
    // 내 우주선
    const s = st.ship;
    if (s && s.alive && s.invuln <= 0) {
      for (const r of st.rocks) if (dist(s, r) < r.r + SHIP_R - 1) { if (killShip(st, 'rock')) hitRock(st, r, false); return; }
      if (st.saucer && dist(s, st.saucer) < st.saucer.r + SHIP_R) { killShip(st, 'saucer'); return; }
      for (const b of st.sbullets) if (dist(s, b) < SHIP_R + 1) { killShip(st, 'bullet'); st.sbullets.splice(st.sbullets.indexOf(b), 1); return; }
    }
  }

  return {
    W, H, TAU, START_LIVES, TURN, THRUST, DRAG, MAX_SPEED, SHIP_R, BULLET_SPEED, BULLET_LIFE, MAX_BULLETS, FIRE_COOL, SIZES, SAUCER, EXTRA_SHIP_EVERY, SAFE_RADIUS, INVULN, WAVE_DELAY, DYING, SMALL_ONLY_AT,
    rng, waveCount, dist, newGame, startWave, step, hyperspace, killShip, addRock, spawnShip,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_ASTEROIDS;
