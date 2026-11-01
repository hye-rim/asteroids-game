'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 아스테로이드: 화면·입력·소리. 규칙은 logic.js (LOGIC_ASTEROIDS). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_ASTEROIDS;
const { W, H } = L;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('asteroidsMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  fire: () => tone(900, 0.08, 'square', 0.03, -600),
  boom: (size) => noise(size === 3 ? 0.35 : size === 2 ? 0.25 : 0.15, 0.09, size === 3 ? 500 : size === 2 ? 900 : 1600),
  dead: () => { noise(0.8, 0.12, 700); tone(180, 0.7, 'sawtooth', 0.05, -140); },
  thrust: () => noise(0.08, 0.05, 400),
  saucer: (kind) => tone(kind === 'small' ? 900 : 500, 0.16, 'square', 0.035, kind === 'small' ? 200 : 120),
  saucerfire: () => tone(500, 0.08, 'square', 0.03, -250),
  hyper: () => tone(300, 0.3, 'sine', 0.05, 900),
  extra: () => melody([659, 784, 1047, 1319], 90, 'sine', 0.07),
  start: () => melody([392, 523, 659], 100),
  clear: () => melody([523, 659, 784, 1047], 90),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
};
// 두 음 박동: 소행성이 줄수록 빨라진다
let beatT = 0, beatHi = false;
function beat(dt) {
  if (state !== 'play' || !G.ship || !G.ship.alive) return;
  const total = L.waveCount(G.wave) * 7, left = Math.min(total, G.rocks.reduce((n, r) => n + (r.size === 3 ? 1 : r.size === 2 ? 0.5 : 0.25) * 1, 0) * 3);
  const iv = 1.0 - 0.75 * (1 - Math.min(1, left / total));
  beatT -= dt;
  if (beatT <= 0) { beatT = Math.max(0.28, iv); beatHi = !beatHi; tone(beatHi ? 60 : 50, 0.1, 'square', 0.05); }
}

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('asteroidsBest')) || 0;
let fxs = [];
let banner = { text: '', sub: '', t: 0 };
let clock = 0, turned = 0, thrustSignalled = false, thrustSnd = 0;
const held = new Set();
let bLeft = false, bRight = false, bThrust = false, bFire = false, bHyper = false;

/* @test-hooks:start */
window.__as = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === ' ' || k === 'Enter') {
    if (state === 'title' || state === 'over') { if (!e.repeat) onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
  }
  held.add(k);
  if (k === 'p' || k === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (k === 'm' || k === 'M') toggleMute();
});
addEventListener('keyup', (e) => { held.delete(e.key); });
addEventListener('blur', () => held.clear());
function hold(btn, on, off) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (_) {} btn.classList.add('on'); on(); });
  const up = () => { btn.classList.remove('on'); off(); };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
}
hold($('leftBtn'), () => { bLeft = true; }, () => { bLeft = false; });
hold($('rightBtn'), () => { bRight = true; }, () => { bRight = false; });
hold($('thrustBtn'), () => { bThrust = true; }, () => { bThrust = false; });
hold($('fireBtn'), () => { bFire = true; }, () => { bFire = false; });
hold($('hyperBtn'), () => { bHyper = true; }, () => { bHyper = false; });
const has = (...ks) => ks.some((k) => held.has(k));
function readInput() {
  return {
    left: has('ArrowLeft', 'a', 'A') || bLeft, right: has('ArrowRight', 'd', 'D') || bRight,
    thrust: has('ArrowUp', 'w', 'W') || bThrust, fire: has(' ', 'z', 'Z', 'j', 'J') || bFire,
    hyper: has('ArrowDown', 's', 'S', 'h', 'H') || bHyper,
  };
}

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', t = 2) { banner = { text, sub, t }; }
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) G.lives = 9;          // 튜토리얼에서는 부딪혀도 계속 해 볼 수 있게
  fxs = []; held.clear(); turned = 0; thrustSignalled = false;
  state = 'play';
  setBanner('WAVE 1');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
let pausedFrom = null;
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused'; held.clear(); bLeft = bRight = bThrust = bFire = bHyper = false;
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('asteroidsBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>웨이브 ${G.wave}${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function burst(x, y, n, speed, life, color = '#fff') {
  for (let i = 0; i < n; i++) { const a = Math.random() * L.TAU, v = speed * (0.4 + Math.random() * 0.8); fxs.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * (0.6 + Math.random() * 0.6), color }); }
}
function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'fire') { sfx.fire(); tutorialSignal('fire'); }
    else if (e.t === 'hit') { sfx.boom(e.size); burst(e.x, e.y, e.size === 3 ? 10 : e.size === 2 ? 7 : 5, 40, 0.7); if (e.pts) tutorialSignal('hit'); }
    else if (e.t === 'saucer') sfx.saucer(e.kind);
    else if (e.t === 'saucerfire') sfx.saucerfire();
    else if (e.t === 'saucerhit') { sfx.boom(2); burst(e.x, e.y, 12, 55, 0.8, '#ffe14a'); if (e.pts) fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1, text: String(e.pts) }); tutorialSignal('saucerhit'); }
    else if (e.t === 'dead') { sfx.dead(); burst(e.x, e.y, 18, 70, 1.4); fxs.push({ kind: 'ring', x: e.x, y: e.y, t: 0, life: 0.6 }); }
    else if (e.t === 'hyper') { sfx.hyper(); tutorialSignal('hyper'); }
    else if (e.t === 'extra') { sfx.extra(); setBanner('EXTRA SHIP', '', 1.6); }
    else if (e.t === 'clear') sfx.clear();
    else if (e.t === 'wave') { if (e.wave > 1) { setBanner(`WAVE ${e.wave}`, '', 1.8); sfx.start(); } }
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  const input = readInput();
  const a0 = G.ship ? G.ship.a : 0;
  L.step(G, dt, input);
  if (G.ship && G.ship.alive) {
    if (input.left !== input.right) { turned += Math.abs(G.ship.a - a0); if (turned > 0.8) tutorialSignal('turn'); } else turned = 0;
    if (input.thrust && Math.hypot(G.ship.vx, G.ship.vy) > 25) tutorialSignal('thrust');
    if (input.thrust) { thrustSnd -= dt; if (thrustSnd <= 0) { thrustSnd = 0.09; sfx.thrust(); } }
  }
  handleEvents();
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) { f.t += dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; } }
  fxs = fxs.filter((f) => f.t < f.life);
  beat(dt);
}

// ---------- 그리기 (선으로 그린 벡터 화면) ----------
const ROCK_SHAPES = Array.from({ length: 8 }, (_, k) => Array.from({ length: 11 }, (_, i) => 0.72 + 0.28 * (Math.abs(Math.sin(k * 12.9898 + i * 78.233) * 43758.5453) % 1)));
function line(pts, close = true) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (close) ctx.closePath(); ctx.stroke(); }
// 화면 끝에 걸친 물체는 반대쪽에도 그린다
function wrapDraw(x, y, r, fn) {
  const xs = [0], ys = [0];
  if (x < r) xs.push(W); else if (x > W - r) xs.push(-W);
  if (y < r) ys.push(H); else if (y > H - r) ys.push(-H);
  for (const ox of xs) for (const oy of ys) { ctx.save(); ctx.translate(x + ox, y + oy); fn(); ctx.restore(); }
}
function drawRock(r) {
  const shape = ROCK_SHAPES[r.seed % 8];
  wrapDraw(r.x, r.y, r.r, () => {
    ctx.rotate(r.rot); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath(); shape.forEach((k, i) => { const a = (i / shape.length) * L.TAU; const px = Math.cos(a) * r.r * k, py = Math.sin(a) * r.r * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.stroke();
  });
}
function shipPath(flame) {
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  line([[8, 0], [-6, -5], [-3.5, 0], [-6, 5]]);
  if (flame) { ctx.strokeStyle = Math.floor(clock * 30) % 2 ? '#ffb04a' : '#fff'; line([[-4.5, -2], [-10 - Math.random() * 3, 0], [-4.5, 2]], false); }
}
function drawShipShape(x, y, a, flame) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); shipPath(flame); ctx.restore(); }
function drawSaucer(u) {
  wrapDraw(u.x, u.y, u.r, () => {
    const k = u.r / 9; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    line([[-9 * k, 1 * k], [-4 * k, 4 * k], [4 * k, 4 * k], [9 * k, 1 * k], [4 * k, -2 * k], [-4 * k, -2 * k]]);
    line([[-9 * k, 1 * k], [9 * k, 1 * k]], false); line([[-3.5 * k, -2 * k], [-2 * k, -6 * k], [2 * k, -6 * k], [3.5 * k, -2 * k]], false);
  });
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  for (const r of G.rocks) drawRock(r);
  if (G.saucer) drawSaucer(G.saucer);
  ctx.fillStyle = '#fff';
  for (const b of G.bullets) ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
  for (const b of G.sbullets) { ctx.fillStyle = '#ffd0a0'; ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3); }
  const s = G.ship;
  if (s && s.alive && !(s.invuln > 0 && Math.floor(clock * 12) % 2)) wrapDraw(s.x, s.y, 10, () => { ctx.rotate(s.a); shipPath(s.thrusting); });
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'dot') { ctx.fillStyle = f.color === '#fff' ? `rgba(255,255,255,${1 - k})` : f.color; ctx.fillRect(f.x - 1, f.y - 1, 2, 2); }
    else if (f.kind === 'ring') { ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.beginPath(); ctx.arc(f.x, f.y, 4 + k * 22, 0, L.TAU); ctx.stroke(); }
    else if (f.kind === 'text') { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,225,74,${1 - k})`; ctx.fillText(f.text, f.x, f.y - k * 12); }
  }
  // HUD
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.fillText(String(G.score).padStart(2, '0'), 8, 6);
  ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#aaa'; ctx.fillText(`HI ${Math.max(best, G.score)}`, W / 2, 8);
  for (let i = 0; i < Math.max(0, G.lives - (G.ship && G.ship.alive ? 1 : 0)); i++) { if (i >= 8) break; drawShipShape(12 + i * 11, 30, -Math.PI / 2, false); }
  if (banner.t > 0) { ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(banner.text, W / 2, 80); if (banner.sub) { ctx.font = '9px monospace'; ctx.fillText(banner.sub, W / 2, 96); } }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('asteroidsMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
