'use strict';
// 아스테로이드 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (seed = 3, wave = 1) => L.newGame(L.rng(seed), wave);
// 소행성도 UFO 도 없는 판 (판 끝 처리가 끼어들지 않게 멀리 있는 소행성 하나를 둔다)
function blank(seed = 3) {
  const st = fresh(seed);
  st.rocks = []; st.saucerT = 1e9; st.ship.invuln = 0;
  st.rocks.push({ x: 5, y: 5, vx: 0, vy: 0, size: 3, r: 16, rot: 0, spin: 0, seed: 1 });
  return st;
}
const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const evs = (st, t) => st.events.filter((e) => e.t === t);
const allEv = (st, secs, input = {}) => { const o = []; for (let i = 0; i < Math.round(secs / 0.01); i++) { L.step(st, 0.01, input); o.push(...st.events); } return o; };
const rock = (st, size, x, y, vx = 0, vy = 0) => { const r = { x, y, vx, vy, size, r: L.SIZES[size].r, rot: 0, spin: 0, seed: 1 }; st.rocks.push(r); return r; };

test('the first wave has 4 large asteroids, away from the ship; waves grow to a cap of 11', () => {
  const st = fresh();
  assert.strictEqual(st.rocks.length, 4);
  assert.ok(st.rocks.every((r) => r.size === 3));
  assert.ok(st.rocks.every((r) => Math.hypot(r.x - 120, r.y - 120) >= 69), 'none next to the ship');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 20].map(L.waveCount), [4, 6, 8, 10, 11, 11, 11]);
  assert.strictEqual(L.newGame(L.rng(1), 4).rocks.length, 10);
  assert.strictEqual(st.lives, 3);
});

test('the ship starts in the middle pointing up and does not move by itself', () => {
  const st = blank(); run(st, 1);
  assert.deepStrictEqual([Math.round(st.ship.x), Math.round(st.ship.y)], [120, 120]);
  assert.ok(Math.abs(st.ship.a + Math.PI / 2) < 1e-9);
});

test('rotation speed: a full turn takes about 1.5 seconds', () => {
  const st = blank(); const a0 = st.ship.a;
  run(st, 1, { right: true });
  assert.ok(Math.abs((st.ship.a - a0) - L.TURN) < 0.05);
  run(st, 1, { left: true });
  assert.ok(Math.abs(st.ship.a - a0) < 0.05);
  const full = L.TAU / L.TURN; assert.ok(full > 1.2 && full < 1.8);
});

test('thrust accelerates in the facing direction, drifts, slowly slows down, and has a top speed', () => {
  const st = blank();
  run(st, 0.5, { thrust: true });
  assert.ok(st.ship.vy < -30 && Math.abs(st.ship.vx) < 1, 'moving up');
  const v1 = Math.hypot(st.ship.vx, st.ship.vy);
  run(st, 1, {});
  const v2 = Math.hypot(st.ship.vx, st.ship.vy);
  assert.ok(v2 < v1 && v2 > v1 * 0.6, 'drifts and only slowly slows');
  run(st, 6, { thrust: true });
  assert.ok(Math.hypot(st.ship.vx, st.ship.vy) <= L.MAX_SPEED + 1e-6);
});

test('the screen wraps around on all sides', () => {
  const st = blank(); st.ship.x = 1; st.ship.vx = -100; st.ship.vy = 0;
  run(st, 0.1, {});
  assert.ok(st.ship.x > 200, 'left edge to right edge');
  st.ship.x = 100; st.ship.y = 238; st.ship.vx = 0; st.ship.vy = 100;
  run(st, 0.1, {});
  assert.ok(st.ship.y < 20, 'bottom to top');
});

test('bullets: at most 4 at a time, they fly where the ship points and expire after a while', () => {
  const st = blank();
  run(st, 1, { fire: true });
  assert.ok(st.bullets.length <= L.MAX_BULLETS);
  const s2 = blank(); L.step(s2, 0.01, { fire: true });
  const b = s2.bullets[0];
  assert.ok(b.vy < -150 && Math.abs(b.vx) < 1);
  run(s2, L.BULLET_LIFE + 0.1, {});
  assert.strictEqual(s2.bullets.length, 0);
  const s3 = blank(); run(s3, 0.5, { fire: true });
  assert.ok(s3.bullets.length >= 2, 'rapid fire possible up to the limit');
});

test('shooting a large asteroid gives 20 and makes 2 medium ones; medium 50 -> 2 small; small 100 -> gone', () => {
  const st = blank(); st.rocks = [];
  const r = rock(st, 3, 120, 60);
  L.step(st, 0.01, { fire: true });
  const ev = allEv(st, 0.3, {});
  assert.ok(ev.some((e) => e.t === 'hit' && e.size === 3 && e.pts === 20));
  assert.strictEqual(st.rocks.filter((x) => x.size === 2).length, 2);
  assert.ok(!st.rocks.includes(r)); assert.strictEqual(st.score, 20);
  const s2 = blank(); s2.rocks = []; rock(s2, 2, 120, 70); run(s2, 0.3, { fire: true });
  assert.strictEqual(s2.rocks.filter((x) => x.size === 1).length, 2); assert.strictEqual(s2.score, 50);
  const s3 = blank(); s3.rocks = []; rock(s3, 1, 120, 70); rock(s3, 3, 5, 5); run(s3, 0.3, { fire: true });
  assert.strictEqual(s3.score, 100); assert.strictEqual(s3.rocks.length, 1);
});

test('smaller asteroids are faster', () => {
  const st = fresh(); st.rocks = [];
  for (let i = 0; i < 40; i++) { L.addRock(st, 3, 0, 0); L.addRock(st, 2, 0, 0); L.addRock(st, 1, 0, 0); }
  const avg = (s) => { const a = st.rocks.filter((r) => r.size === s).map((r) => Math.hypot(r.vx, r.vy)); return a.reduce((x, y) => x + y, 0) / a.length; };
  assert.ok(avg(1) > avg(2) && avg(2) > avg(3));
});

test('hitting an asteroid destroys the ship and costs a life', () => {
  const st = blank(); st.rocks = []; rock(st, 3, 120, 120, 0, 0); rock(st, 3, 5, 5);
  L.step(st, 0.01, {});
  assert.strictEqual(st.ship.alive, false); assert.strictEqual(st.lives, 2);
  assert.strictEqual(evs(st, 'dead')[0].why, 'rock');
});

test('the new ship waits for a clear middle and gets a short shield', () => {
  const st = blank(); st.rocks = []; rock(st, 3, 5, 5); rock(st, 3, 150, 120, 0, 0);
  L.killShip(st, 'rock');
  run(st, L.DYING + 1);
  assert.strictEqual(st.ship.alive, false, 'waits while a rock is near the center');
  st.rocks[1].x = 220; st.rocks[1].y = 220;
  run(st, 0.1);
  assert.strictEqual(st.ship.alive, true);
  assert.ok(st.ship.invuln > 0.5);
  assert.deepStrictEqual([Math.round(st.ship.x), Math.round(st.ship.y)], [120, 120]);
});

test('during the shield nothing hurts the ship', () => {
  const st = blank(); st.ship.invuln = 1; st.rocks = []; rock(st, 3, 120, 120); rock(st, 3, 5, 5);
  L.step(st, 0.01, {});
  assert.strictEqual(st.ship.alive, true);
});

test('game over after the last ship', () => {
  const st = blank(); st.lives = 1; st.rocks = []; rock(st, 3, 120, 120); rock(st, 3, 5, 5);
  L.step(st, 0.01, {});
  run(st, L.DYING + 0.5);
  assert.strictEqual(st.phase, 'over');
});

test('an extra ship for every 10000 points', () => {
  const st = blank(); st.rocks = []; st.score = 9990; rock(st, 3, 120, 60); rock(st, 3, 5, 5);
  const ev = allEv(st, 0.3, { fire: true });
  assert.ok(ev.some((e) => e.t === 'extra')); assert.strictEqual(st.lives, 4);
  st.score = 29990; st.rocks = []; rock(st, 3, 120, 60); rock(st, 3, 5, 5); st.bullets = [];
  run(st, 0.3, { fire: true });
  assert.strictEqual(st.lives, 6, 'two more (20000 and 30000) are caught up');
});

test('saucers: large 200 points, small 1000 points', () => {
  for (const [kind, pts] of [['large', 200], ['small', 1000]]) {
    const st = blank(); st.rocks = []; rock(st, 3, 5, 5);
    const d = L.SAUCER[kind];
    st.saucer = { kind, x: 120, y: 60, vx: 0, vy: 0, r: d.r, turnT: 99, fireT: 99, dir: 1 };
    const ev = allEv(st, 0.4, { fire: true });
    const hit = ev.find((e) => e.t === 'saucerhit');
    assert.ok(hit && hit.pts === pts, kind);
    assert.strictEqual(st.saucer, null); assert.strictEqual(st.score, pts);
  }
});

test('saucers appear after a while, cross the screen and leave; only small ones after 40000 points', () => {
  const st = fresh(8); st.rocks = []; rock(st, 3, 5, 5); st.rocks[0].vx = 0; st.saucerT = 0.5; st.ship.invuln = 99;
  const ev = allEv(st, 1, {});
  assert.ok(ev.some((e) => e.t === 'saucer'));
  assert.ok(st.saucer && Math.abs(st.saucer.vx) > 0);
  run(st, 12, {}); assert.strictEqual(st.saucer, null, 'left the screen');
  for (let i = 0; i < 20; i++) {
    const s = fresh(100 + i); s.rocks = []; rock(s, 3, 120, 230); s.rocks[0].vx = 0; s.rocks[0].vy = 0; s.score = L.SMALL_ONLY_AT + 5; s.saucerT = 0.01; s.ship.invuln = 99;
    L.step(s, 0.05, {}); assert.strictEqual(s.saucer.kind, 'small');
  }
});

test('the small saucer aims at the ship; the large one shoots anywhere', () => {
  let aimed = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const st = blank(i + 1); st.score = 50000; st.ship.invuln = 99;
    st.saucer = { kind: 'small', x: 30, y: 30, vx: 0, vy: 0, r: 5, turnT: 99, fireT: 0, dir: 1 };
    L.step(st, 0.01, {});
    const b = st.sbullets[0]; if (!b) continue;
    const want = Math.atan2(120 - 30, 120 - 30), got = Math.atan2(b.vy, b.vx);
    n++; if (Math.abs(got - want) < 0.3) aimed++;
  }
  assert.ok(n >= 25 && aimed >= n - 1, 'aimed ' + aimed + '/' + n);
});

test('a saucer bullet or a saucer ramming kills the ship', () => {
  const st = blank(); st.sbullets.push({ x: 120, y: 120, vx: 0, vy: 0, life: 1 });
  L.step(st, 0.01, {});
  assert.strictEqual(st.ship.alive, false); assert.strictEqual(evs(st, 'dead')[0].why, 'bullet');
  const s2 = blank(); s2.saucer = { kind: 'large', x: 120, y: 120, vx: 0, vy: 0, r: 9, turnT: 99, fireT: 99, dir: 1 };
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.ship.alive, false);
});

test('an asteroid hitting a saucer destroys it without points', () => {
  const st = blank(); st.rocks = []; rock(st, 3, 5, 5); rock(st, 1, 200, 40);
  st.saucer = { kind: 'large', x: 200, y: 40, vx: 0, vy: 0, r: 9, turnT: 99, fireT: 99, dir: 1 };
  const ev = allEv(st, 0.1, {});
  assert.strictEqual(st.saucer, null); assert.strictEqual(st.score, 0);
  assert.ok(ev.some((e) => e.t === 'saucerhit' && e.pts === 0));
});

test('saucer bullets break asteroids but give no points', () => {
  const st = blank(); st.rocks = []; rock(st, 2, 5, 5); rock(st, 1, 200, 40);
  st.sbullets.push({ x: 200, y: 40, vx: 0, vy: 0, life: 1 });
  run(st, 0.05);
  assert.strictEqual(st.score, 0); assert.strictEqual(st.sbullets.length, 0);
});

test('hyperspace jumps to a random place and sometimes destroys the ship', () => {
  let died = 0, moved = 0, n = 200;
  for (let i = 0; i < n; i++) {
    const st = blank(i + 1); st.rocks = []; rock(st, 3, 5, 5);
    for (let k = 0; k < 6; k++) rock(st, 3, 100 + k, 100);          // 소행성이 7개: 실패 확률이 높다
    st.rocks.forEach((r) => { r.vx = 0; r.vy = 0; });
    L.step(st, 0.01, { hyper: true });
    if (!st.ship.alive) died++; else if (Math.hypot(st.ship.x - 120, st.ship.y - 120) > 1) moved++;
  }
  assert.ok(died > 5 && died < 80, 'risky but not hopeless: ' + died + '/' + n);
  assert.ok(moved > 100);
  const few = (() => { let d = 0; for (let i = 0; i < n; i++) { const st = blank(i + 1); L.step(st, 0.01, { hyper: true }); if (!st.ship.alive) d++; } return d; })();
  assert.ok(few < died, 'fewer asteroids is safer');
});

test('hyperspace needs a new press each time', () => {
  const st = blank(); let jumps = 0;
  for (let i = 0; i < 50; i++) { L.step(st, 0.01, { hyper: true }); jumps += evs(st, 'hyper').length; if (!st.ship.alive) break; }
  assert.strictEqual(jumps, 1);
});

test('clearing all asteroids starts the next, bigger wave', () => {
  const st = blank(); st.rocks = []; rock(st, 1, 120, 60);
  const ev = allEv(st, 0.3, { fire: true });
  assert.ok(ev.some((e) => e.t === 'clear'));
  run(st, L.WAVE_DELAY + 0.2);
  assert.strictEqual(st.wave, 2); assert.strictEqual(st.rocks.length, 6);
});

test('a wave does not end while a saucer is still around', () => {
  const st = blank(); st.rocks = [];
  st.saucer = { kind: 'large', x: 100, y: 40, vx: 0, vy: 0, r: 9, turnT: 99, fireT: 99, dir: 1 };
  run(st, 3);
  assert.strictEqual(st.wave, 1);
});

test('random play never breaks the rules (fuzz)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 7), 1 + (seed % 4));
    for (let i = 0; i < 6000 && st.phase !== 'over'; i++) {
      L.step(st, 0.02, { left: r() < 0.2, right: r() < 0.2, thrust: r() < 0.4, fire: r() < 0.4, hyper: r() < 0.01 });
      assert.ok(Number.isFinite(st.ship.x) && Number.isFinite(st.ship.vx));
      assert.ok(st.ship.x >= 0 && st.ship.x < 240 && st.ship.y >= 0 && st.ship.y < 240);
      assert.ok(st.bullets.length <= L.MAX_BULLETS && st.lives >= 0 && st.score >= 0);
      for (const k of st.rocks) assert.ok(k.x >= 0 && k.x < 240 && k.y >= 0 && k.y < 240);
    }
  }
});
