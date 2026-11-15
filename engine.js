/* ═══════════════════════════════════════════════════════════
   Being Trained — Engine
   Handles: phase flow, audio, cursor, ink background,
            hand tracking, particles, drag, trace
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG (tweakable) ────────────────────────────────────
window.BT_CONFIG = /*EDITMODE-BEGIN*/{
  "handMirror": true,
  "handSmoothing": 0.35,
  "gestureSensitivity": 0.55,
  "showSkeleton": true,
  "particleDensity": 0.7,
  "sound": true,
  "soundVolume": 0.5,
  "bilingual": true,
  "accent": "#A63D2A",
  "inkBreath": true,
  "phaseDuration": 1200
}/*EDITMODE-END*/;

const C = window.BT_CONFIG;

// ── STATE ────────────────────────────────────────────────
const STATE = {
  phase: 0,              // 0..5
  adaptation: 0,
  wash: 0,
  transitioning: false,
  cameraActive: false,
  particles: [],
  hearts: [],
  ripples: [],
  inkTrail: [],
  desktopIcons: [],
  handPaths: [],
};

const HAND = [
  { x: -9999, y: -9999, sx: -9999, sy: -9999, z: 0, vx: 0, vy: 0,
    lastX: 0, lastY: 0, isOk: false, lastOk: false, isPinch: false,
    grab: null, grabOffX: 0, grabOffY: 0, path: [],
    hoverIcon: null, hoverStart: 0 },
  { x: -9999, y: -9999, sx: -9999, sy: -9999, z: 0, vx: 0, vy: 0,
    lastX: 0, lastY: 0, isOk: false, lastOk: false, isPinch: false,
    grab: null, grabOffX: 0, grabOffY: 0, path: [],
    hoverIcon: null, hoverStart: 0 },
];

// ── PHASE COPY ───────────────────────────────────────────
const PHASE_META = [
  { idx: '零', en: 'NULL',    zh: '未始',   label: '起',
    hint: '', hintEn: '' },
  { idx: '一', en: '01 · DRIFT',  zh: '一 · 漂流', label: '习',
    hint: '向上轻拨', hintEn: 'drift upward' },
  { idx: '二', en: '02 · TOUCH',  zh: '二 · 触碰', label: '触',
    hint: '指尖相近如捻物', hintEn: 'pinch and press' },
  { idx: '三', en: '03 · ERASURE',zh: '三 · 抹除', label: '弃',
    hint: '捏取 · 投入线下', hintEn: 'pinch · drop below' },
  { idx: '四', en: '04 · RESIDUE',zh: '四 · 残留', label: '迹',
    hint: '身体留下的东西', hintEn: 'what the body leaves' },
  { idx: '五', en: 'CLOSED',  zh: '循环已合',  label: '合',
    hint: '', hintEn: '' },
];

// Multi-lingual word pool — CN / JP / KR / EN / FR
const WORD_POOL = [
  // 中文
  '规训','习得','反射','肌肉','记忆','痕迹','身体','屈从','界面','算法','驯化','重复','意识','沉默',
  // 日本語
  '規律','習慣','反射','筋肉','記憶','痕跡','身体','服従','従順','沈黙','訓練','反復',
  // 한국어
  '규율','습관','반사','근육','기억','흔적','몸짓','복종','침묵','훈련','반복',
  // English
  'HABIT','REFLEX','MUSCLE','TRACE','INTERFACE','SUBMIT','MIND','LEARN','REPEAT','SILENCE','DRILL',
  // Français
  'habitude','réflexe','muscle','mémoire','trace','corps','soumission','silence','dressage','répétition'
];
const GLYPH_SYMBOLS = ['口', '心', '目', '手', '身', '言', '行', '念', '欲', '我', '人', '見'];

// ═════════════════════════════════════════════════════════
// AUDIO — bell, breath, ink drop
// ═════════════════════════════════════════════════════════
let audio = { ctx: null, master: null, noise: null, bpm: 60, beat: 0, breathTimer: null };

function initAudio() {
  if (audio.ctx || !C.sound) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = C.soundVolume;
  audio.master.connect(audio.ctx.destination);

  // breathing pink noise
  const bufSize = 2 * audio.ctx.sampleRate;
  const buf = audio.ctx.createBuffer(1, bufSize, audio.ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0=0,b1=0,b2=0;
  for (let i = 0; i < bufSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.05;
  }
  const src = audio.ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const ng = audio.ctx.createGain();
  ng.gain.value = 0;
  src.connect(ng); ng.connect(audio.master);
  src.start();
  audio.noise = ng;

  // breathing envelope (4s in + 4s out)
  const now = audio.ctx.currentTime;
  const breathe = () => {
    const t = audio.ctx.currentTime;
    ng.gain.cancelScheduledValues(t);
    ng.gain.setValueAtTime(ng.gain.value, t);
    ng.gain.linearRampToValueAtTime(0.6, t + 3.6);
    ng.gain.linearRampToValueAtTime(0.05, t + 7.2);
  };
  breathe();
  audio.breathTimer = setInterval(breathe, 7200);
}

function setVolume(v) {
  C.soundVolume = v;
  if (audio.master) audio.master.gain.value = v;
}

function playBell() {
  if (!audio.ctx || !C.sound) return;
  const now = audio.ctx.currentTime;
  const carrier = audio.ctx.createOscillator();
  const mod = audio.ctx.createOscillator();
  const modGain = audio.ctx.createGain();
  const g = audio.ctx.createGain();
  carrier.type = 'sine';
  mod.type = 'sine';
  carrier.frequency.value = 320;
  mod.frequency.value = 503;
  modGain.gain.value = 420;
  mod.connect(modGain); modGain.connect(carrier.frequency);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);
  carrier.connect(g); g.connect(audio.master);
  mod.start(now); carrier.start(now);
  mod.stop(now + 4); carrier.stop(now + 4);
}

function playDrop() {
  if (!audio.ctx || !C.sound) return;
  const now = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(1200, now);
  o.frequency.exponentialRampToValueAtTime(180, now + 0.25);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.14, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  o.connect(g); g.connect(audio.master);
  o.start(now); o.stop(now + 0.3);
}

function playPing() {
  if (!audio.ctx || !C.sound) return;
  const now = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 740 + Math.random()*80;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.05, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  o.connect(g); g.connect(audio.master);
  o.start(now); o.stop(now + 0.2);
}

// ═════════════════════════════════════════════════════════
// CURSOR — ink eye + trail
// ═════════════════════════════════════════════════════════
let mx = 0, my = 0, cx = 0, cy = 0;
window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

function animCursor() {
  cx += (mx - cx) * 0.18;
  cy += (my - cy) * 0.18;
  const el = document.getElementById('cursor');
  if (el) { el.style.left = cx + 'px'; el.style.top = cy + 'px'; }
  // record trail
  STATE.inkTrail.push({ x: cx, y: cy, life: 1 });
  if (STATE.inkTrail.length > 80) STATE.inkTrail.shift();
  requestAnimationFrame(animCursor);
}
animCursor();

function drawCursorTrail() {
  const cv = document.getElementById('cursor-trail');
  if (!cv) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const isDark = document.body.classList.contains('dark');
  ctx.strokeStyle = isDark ? 'rgba(242,237,224,0.12)' : 'rgba(28,26,24,0.12)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  STATE.inkTrail.forEach((p, i) => {
    p.life -= 0.02;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  STATE.inkTrail = STATE.inkTrail.filter(p => p.life > 0);
}

function triggerBlink() {
  const el = document.getElementById('cursor');
  if (!el) return;
  el.classList.add('blink');
  setTimeout(() => el.classList.remove('blink'), 140);
}

function spawnRipple(x, y) {
  STATE.ripples.push({ x, y, r: 4, alpha: 0.7, life: 1 });
}

window.triggerClickFeedback = (e) => {
  triggerBlink();
  spawnRipple(e.clientX, e.clientY);
  if (!audio.ctx) initAudio();
};

// ═════════════════════════════════════════════════════════
// INK BACKGROUND — painterly blobs, breathing
// ═════════════════════════════════════════════════════════
const inkCanvas = document.getElementById('ink-canvas');
const inkCtx = inkCanvas.getContext('2d');
let inkT = 0;

function renderInk() {
  const w = inkCanvas.width = window.innerWidth;
  const h = inkCanvas.height = window.innerHeight;
  inkCtx.clearRect(0, 0, w, h);

  const breath = C.inkBreath ? (Math.sin(inkT * 0.0008) * 0.5 + 0.5) : 0.5;
  const isDark = document.body.classList.contains('dark');

  // Three soft ink blobs
  const blobs = isDark ? [
    { x: 0.3, y: 0.35, r: 0.45, c: 'rgba(184,181,232,0.35)' },
    { x: 0.72, y: 0.62, r: 0.4, c: 'rgba(123,120,184,0.25)' },
    { x: 0.5, y: 0.48, r: 0.32, c: 'rgba(166,61,42,0.18)' },
  ] : [
    { x: 0.28, y: 0.35, r: 0.42, c: 'rgba(166,61,42,0.06)' },
    { x: 0.72, y: 0.65, r: 0.38, c: 'rgba(138,131,119,0.10)' },
    { x: 0.55, y: 0.5, r: 0.3, c: 'rgba(184,181,232,0.10)' },
  ];
  blobs.forEach((b, i) => {
    const ox = Math.sin(inkT * 0.0005 + i * 1.8) * 80 * (0.5 + breath);
    const oy = Math.cos(inkT * 0.0004 + i * 2.3) * 60 * (0.5 + breath);
    const grad = inkCtx.createRadialGradient(
      b.x * w + ox, b.y * h + oy, 0,
      b.x * w + ox, b.y * h + oy, b.r * w * (0.9 + breath * 0.2)
    );
    grad.addColorStop(0, b.c);
    grad.addColorStop(1, 'transparent');
    inkCtx.fillStyle = grad;
    inkCtx.fillRect(0, 0, w, h);
  });
  inkT += 16;
  requestAnimationFrame(renderInk);
}
renderInk();

// ═════════════════════════════════════════════════════════
// GRAIN texture
// ═════════════════════════════════════════════════════════
function renderGrain() {
  const host = document.getElementById('grain');
  if (!host) return;
  const w = 160, h = 160;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 60 + Math.random() * 160;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  host.style.backgroundImage = `url(${tmp.toDataURL()})`;
  host.style.backgroundRepeat = 'repeat';
}
renderGrain();

// ═════════════════════════════════════════════════════════
// PARTICLES — ink jellies
// ═════════════════════════════════════════════════════════
class InkParticle {
  constructor(type, content, x, y) {
    this.type = type;
    this.content = content;
    this.x = x; this.y = y;
    const s = 6 + Math.random() * 4;
    this.vx = (Math.random() - 0.5) * s;
    this.vy = -Math.random() * 8 - 2;
    this.friction = 0.96;
    this.gravity = 0.08;
    this.life = 1;
    this.fadeSpeed = type === 'word' ? 0.004 : 0.012;
    this.size = type === 'word' ? (28 + Math.random() * 14) : (18 + Math.random() * 8);
    this.rot = (Math.random() - 0.5) * 0.3;
    this.radius = this.size;
    this.color = type === 'heart' ? 'rgba(166,61,42,0.85)' : 'rgba(242,237,224,0.75)';
  }
  update(w, h) {
    this.vx *= this.friction;
    this.vy = this.vy * this.friction + this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    HAND.forEach(hand => {
      if (hand.x < -1000) return;
      const d = Math.hypot(this.x - hand.sx, this.y - hand.sy);
      if (d < 140) {
        this.vx += (this.x - hand.sx) * 0.012;
        this.vy += (this.y - hand.sy) * 0.012;
      }
    });
    const m = this.radius;
    if (this.x < m) { this.x = m; this.vx *= -0.4; }
    if (this.x > w - m) { this.x = w - m; this.vx *= -0.4; }
    if (this.y < m) { this.y = m; this.vy *= -0.4; }
    if (this.y > h - m) { this.y = h - m; this.vy *= -0.4; }
    this.life -= this.fadeSpeed;
  }
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = Math.max(0, this.life);
    if (this.type === 'heart') {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const s = this.size / 24;
      ctx.moveTo(0, 8*s);
      ctx.bezierCurveTo(-12*s, -10*s, -22*s, 6*s, 0, 22*s);
      ctx.bezierCurveTo(22*s, 6*s, 12*s, -10*s, 0, 8*s);
      ctx.stroke();
      // seal dot
      ctx.fillStyle = 'rgba(166,61,42,0.4)';
      ctx.beginPath(); ctx.arc(0, 12*s, 2, 0, Math.PI*2); ctx.fill();
    } else {
      const isCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(this.content);
      ctx.font = `300 ${this.size}px ${isCJK ? "'Noto Serif SC', 'Noto Serif JP', 'Noto Serif KR', serif" : "'Cormorant Garamond', serif"}`;
      ctx.fillStyle = this.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.content, 0, 0);
    }
    ctx.restore();
  }
}

function drawParticles() {
  const cv = document.getElementById('particle-canvas');
  if (!cv) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (STATE.phase === 1) {
    STATE.particles = STATE.particles.filter(p => p.life > 0);
    STATE.particles.forEach(p => { p.update(w, h); p.draw(ctx); });
  }
  if (STATE.phase === 2) {
    STATE.hearts = STATE.hearts.filter(p => p.life > 0);
    STATE.hearts.forEach(p => { p.update(w, h); p.draw(ctx); });
  }

  // ripples
  STATE.ripples = STATE.ripples.filter(r => r.life > 0);
  STATE.ripples.forEach(r => {
    r.r += 3.2;
    r.life -= 0.02;
    r.alpha -= 0.018;
    ctx.save();
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(166,61,42,${Math.max(0, r.alpha)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  });

  drawCursorTrail();
  requestAnimationFrame(drawParticles);
}
drawParticles();

// ═════════════════════════════════════════════════════════
// HAND TRACKING (MediaPipe)
// ═════════════════════════════════════════════════════════
const handCanvas = document.getElementById('hand-canvas');
const handCtx = handCanvas.getContext('2d');

function getGestureInfo(lm) {
  const onlyIndex = (lm[8].y < lm[6].y) && (lm[12].y > lm[10].y) && (lm[16].y > lm[14].y) && (lm[20].y > lm[18].y);
  const distOk = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  // Pinch uses same thumb-index distance but looser
  const isPinch = distOk < (0.04 + (1 - C.gestureSensitivity) * 0.06);
  const isOk = distOk < (0.035 + (1 - C.gestureSensitivity) * 0.04);
  return { onlyIndex, isOk, isPinch };
}

function drawSkeleton(ctx, lm, w, h, isGrabbing) {
  if (!C.showSkeleton) return;
  const isDark = document.body.classList.contains('dark');
  ctx.strokeStyle = isGrabbing ? C.accent : (isDark ? 'rgba(242,237,224,0.4)' : 'rgba(28,26,24,0.35)');
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 0.8;
  const conn = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],[9,10],[10,11],[11,12],[13,14],[14,15],[15,16]];
  conn.forEach(([a,b]) => {
    ctx.beginPath();
    const ax = C.handMirror ? (1-lm[a].x)*w : lm[a].x*w;
    const bx = C.handMirror ? (1-lm[b].x)*w : lm[b].x*w;
    ctx.moveTo(ax, lm[a].y*h);
    ctx.lineTo(bx, lm[b].y*h);
    ctx.stroke();
  });
  // dots
  lm.forEach((p, i) => {
    const x = C.handMirror ? (1-p.x)*w : p.x*w;
    ctx.beginPath();
    ctx.arc(x, p.y*h, i === 8 ? 3 : 1.6, 0, Math.PI*2);
    ctx.fill();
  });
}

let handsInstance = null, cameraInstance = null;

async function initHandTracking() {
  if (handsInstance) return;
  try {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.style.display = 'none';
    document.body.appendChild(video);

    const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });
    hands.onResults(onHandsResults);
    handsInstance = hands;

    const cam = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 1280, height: 720
    });
    await cam.start();
    cameraInstance = cam;
    STATE.cameraActive = true;
    updateCamStatus();
  } catch (err) {
    console.warn('Hand tracking failed', err);
    STATE.cameraActive = false;
    updateCamStatus();
  }
}

function updateCamStatus() {
  const el = document.getElementById('cam-status');
  if (!el) return;
  if (STATE.cameraActive) {
    el.classList.add('active');
    el.querySelector('.text').textContent = 'OBSERVATION · 观察中';
  } else {
    el.classList.remove('active');
    el.querySelector('.text').textContent = 'OFFLINE · 未开启';
  }
}

function onHandsResults(results) {
  const w = window.innerWidth, h = window.innerHeight;
  if (handCanvas.width !== w || handCanvas.height !== h) { handCanvas.width = w; handCanvas.height = h; }
  handCtx.clearRect(0, 0, w, h);

  // reset hands off-screen if none detected
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    HAND.forEach(h => { h.x = -9999; h.y = -9999; h.sx = -9999; h.sy = -9999; });
    return;
  }

  results.multiHandLandmarks.forEach((lm, idx) => {
    if (idx >= 2) return;
    const hand = HAND[idx];
    const tip = lm[8];
    const x = (C.handMirror ? (1 - tip.x) : tip.x) * w;
    const y = tip.y * h;
    hand.lastX = hand.x; hand.lastY = hand.y;
    hand.x = x; hand.y = y; hand.z = tip.z;

    // Smoothing: exponential moving average for "sx/sy" used for particle/drag
    const alpha = 1 - C.handSmoothing; // 0..1
    if (hand.sx < -1000) { hand.sx = x; hand.sy = y; }
    hand.sx += (x - hand.sx) * alpha;
    hand.sy += (y - hand.sy) * alpha;
    hand.vx = hand.x - hand.lastX;
    hand.vy = hand.y - hand.lastY;

    const g = getGestureInfo(lm);
    hand.isOk = g.isOk;
    hand.isPinch = g.isPinch;

    // OK transient triggers blink + ripple
    if (hand.isOk && !hand.lastOk) {
      triggerBlink();
      spawnRipple(hand.sx, hand.sy);
      playPing();
    }
    hand.lastOk = hand.isOk;

    // record path for residue
    if (STATE.phase >= 1 && STATE.phase <= 3) {
      hand.path.push({ x: hand.sx, y: hand.sy, phase: STATE.phase });
      if (hand.path.length > 2000) hand.path.shift();
    }

    // draw skeleton
    drawSkeleton(handCtx, lm, w, h, !!hand.grab);

    // phase interactions
    if (STATE.phase === 0 || STATE.phase === 5) {
      handleButtonHover(hand);
    }
    if (STATE.phase === 1 && g.onlyIndex && hand.vy < -14) {
      STATE.adaptation += 0.6;
      const pool = WORD_POOL;
      STATE.particles.push(new InkParticle('word', pool[Math.floor(Math.random()*pool.length)], hand.sx, hand.sy));
      if (STATE.adaptation >= 100) nextPhase();
      updateHUD();
    }
    if (STATE.phase === 2 && g.onlyIndex && hand.z < -0.12) {
      const hb = document.querySelector('.lotus-hitbox');
      if (hb) {
        const r = hb.getBoundingClientRect();
        if (hand.sx > r.left && hand.sx < r.right && hand.sy > r.top && hand.sy < r.bottom) {
          STATE.wash += 1.5;
          for (let i = 0; i < 2; i++) STATE.hearts.push(new InkParticle('heart', null, w/2, h/2));
          playPing();
          if (STATE.wash >= 100) nextPhase();
          updateHUD();
        }
      }
    }
    if (STATE.phase === 3) {
      handleDragging(idx);
    }
  });
}

function handleButtonHover(hand) {
  document.querySelectorAll('.btn-ink').forEach(btn => {
    const r = btn.getBoundingClientRect();
    const inside = hand.sx > r.left && hand.sx < r.right && hand.sy > r.top && hand.sy < r.bottom;
    if (inside) {
      btn.classList.add('hovered');
      if (hand.isOk) {
        btn.click();
        hand.isOk = false;
        hand.lastOk = false;
      }
    } else {
      btn.classList.remove('hovered');
    }
  });
}

function handleDragging(idx) {
  const h = HAND[idx];
  const now = Date.now();
  const HOLD_MS = 700;

  if (!h.grab) {
    // find the icon the fingertip is currently over (hit-test)
    let over = null;
    for (const icon of STATE.desktopIcons) {
      if (icon.cleared) continue;
      const r = icon.el.getBoundingClientRect();
      if (h.sx >= r.left - 12 && h.sx <= r.right + 12 &&
          h.sy >= r.top - 12  && h.sy <= r.bottom + 12) {
        over = { icon, cx: r.left + r.width/2, cy: r.top + r.height/2 };
        break;
      }
    }
    // track hover time
    if (over) {
      if (h.hoverIcon !== over.icon) {
        h.hoverIcon = over.icon;
        h.hoverStart = now;
        over.icon.el.classList.add('hovering');
        // reset progress ring on other icons
        STATE.desktopIcons.forEach(ic => {
          if (ic !== over.icon) ic.el.classList.remove('hovering');
        });
      }
      // show progress via CSS var
      const held = Math.min(1, (now - h.hoverStart) / HOLD_MS);
      over.icon.el.style.setProperty('--hold', held);
      if (held >= 1) {
        // promote to grab
        h.grab = over.icon;
        h.grabOffX = over.cx - h.sx;
        h.grabOffY = over.cy - h.sy;
        h.grab.el.classList.add('grabbed');
        h.grab.el.classList.remove('hovering');
        h.hoverIcon = null;
        playDrop();
      }
    } else {
      // left hover — reset
      if (h.hoverIcon) {
        h.hoverIcon.el.classList.remove('hovering');
        h.hoverIcon.el.style.setProperty('--hold', 0);
        h.hoverIcon = null;
      }
    }
    return;
  }

  // grabbed: move with finger
  const r = h.grab.el.getBoundingClientRect();
  const tx = h.sx + h.grabOffX - r.width/2;
  const ty = h.sy + h.grabOffY - r.height/2;
  h.grab.el.style.left = tx + 'px';
  h.grab.el.style.top = ty + 'px';

  // release when crossing the line (below threshold = dropped)
  const threshold = window.innerHeight * 0.82;
  const iconCy = h.sy + h.grabOffY;
  if (iconCy > threshold) {
    // drop it BELOW the line with a small offset, all icons fall-below
    const finalY = threshold + 20 + Math.random() * 40;
    h.grab.el.style.top = finalY + 'px';
    h.grab.el.classList.add('discarded');
    h.grab.cleared = true;
    if (h.grab.isTarget) h.grab.el.classList.add('locked');
    playDrop();
    if (STATE.desktopIcons.filter(i => i.isTarget && !i.cleared).length === 0) {
      setTimeout(nextPhase, 900);
    }
    h.grab.el.classList.remove('grabbed');
    h.grab.el.style.setProperty('--hold', 0);
    h.grab = null;
  }
}

// Mouse fallback for Phase 3 — long-press drag
(function mouseDragFallback() {
  let mouseDown = false, mouseStart = 0, mouseOver = null, grabbed = null, offX = 0, offY = 0;
  const HOLD_MS = 600;

  function phase3Active() { return STATE.phase === 3; }

  document.addEventListener('mousedown', (e) => {
    if (!phase3Active()) return;
    // hit test against glyphs
    const target = e.target.closest('.glyph');
    if (!target || target.classList.contains('locked') || target.classList.contains('discarded')) return;
    const icon = STATE.desktopIcons.find(i => i.el === target);
    if (!icon || icon.cleared) return;
    e.preventDefault();
    mouseDown = true;
    mouseStart = Date.now();
    mouseOver = icon;
    const r = target.getBoundingClientRect();
    offX = r.left + r.width/2 - e.clientX;
    offY = r.top + r.height/2 - e.clientY;
    target.classList.add('hovering');
  });

  document.addEventListener('mousemove', (e) => {
    if (!phase3Active() || !mouseDown) return;
    if (!grabbed && mouseOver) {
      const held = Math.min(1, (Date.now() - mouseStart) / HOLD_MS);
      mouseOver.el.style.setProperty('--hold', held);
      if (held >= 1) {
        grabbed = mouseOver;
        grabbed.el.classList.remove('hovering');
        grabbed.el.classList.add('grabbed');
        playDrop();
      }
    }
    if (grabbed) {
      const r = grabbed.el.getBoundingClientRect();
      grabbed.el.style.left = (e.clientX + offX - r.width/2) + 'px';
      grabbed.el.style.top  = (e.clientY + offY - r.height/2) + 'px';
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!phase3Active()) return;
    if (mouseOver && !grabbed) {
      mouseOver.el.classList.remove('hovering');
      mouseOver.el.style.setProperty('--hold', 0);
    }
    if (grabbed) {
      const threshold = window.innerHeight * 0.82;
      const cy = e.clientY + offY;
      if (cy > threshold) {
        const finalY = threshold + 20 + Math.random() * 40;
        grabbed.el.style.top = finalY + 'px';
        grabbed.el.classList.add('discarded');
        grabbed.cleared = true;
        if (grabbed.isTarget) grabbed.el.classList.add('locked');
        playDrop();
        if (STATE.desktopIcons.filter(i => i.isTarget && !i.cleared).length === 0) {
          setTimeout(nextPhase, 900);
        }
      }
      grabbed.el.classList.remove('grabbed');
      grabbed.el.style.setProperty('--hold', 0);
      grabbed = null;
    }
    mouseDown = false;
    mouseOver = null;
  });
})();

function fadeOut(el) {
  let o = 1;
  const t = setInterval(() => {
    o -= 0.05;
    el.style.opacity = o;
    if (o <= 0) { el.style.display = 'none'; clearInterval(t); }
  }, 40);
}

// ═════════════════════════════════════════════════════════
// PHASE FLOW
// ═════════════════════════════════════════════════════════
function updateHUD() {
  const meta = PHASE_META[STATE.phase];
  const lbl = document.getElementById('phase-label');
  if (lbl) {
    lbl.querySelector('.zh').textContent = meta.zh;
    lbl.querySelector('.en').textContent = meta.en;
  }
  const seal = document.getElementById('seal');
  if (seal) {
    seal.querySelector('.stamp').textContent = meta.label;
    seal.querySelector('.idx').textContent = meta.idx;
    const ie = seal.querySelector('.idx-en');
    if (ie) ie.textContent = String(STATE.phase).padStart(2, '0');
    const ie2 = seal.querySelector('.idx-en2');
    if (ie2) ie2.textContent = STATE.phase;
  }
  const hint = document.getElementById('hint');
  if (hint) {
    if (meta.hint) {
      hint.innerHTML = `<span class="zh">${meta.hint}</span><span class="sep"></span><span class="en">${meta.hintEn}</span>`;
      hint.classList.add('visible');
    } else {
      hint.classList.remove('visible');
    }
  }
  // progress
  const counter = document.getElementById('counter');
  if (counter) {
    const bar = counter.querySelector('.bar');
    let pct = 0;
    if (STATE.phase === 1) pct = Math.min(100, STATE.adaptation);
    if (STATE.phase === 2) pct = Math.min(100, STATE.wash);
    if (STATE.phase === 3) {
      const total = STATE.desktopIcons.filter(i => i.isTarget).length || 1;
      const done = STATE.desktopIcons.filter(i => i.isTarget && i.cleared).length;
      pct = (done / total) * 100;
    }
    bar.style.setProperty('--pct', pct + '%');
    counter.querySelector('.idx').textContent = String(STATE.phase).padStart(2, '0') + ' / 05';
    counter.querySelector('.load').textContent = String(Math.floor(pct)).padStart(2, '0') + '%';
  }
  // dark mode
  document.body.dataset.phase = STATE.phase;
  const darkPhases = [1,2,3,4];
  document.body.classList.toggle('dark', darkPhases.includes(STATE.phase));
}

function nextPhase() {
  if (STATE.phase >= 5 || STATE.transitioning) return;
  breathTransition(() => {
    STATE.phase++;
    applyPhase();
  });
}

function prevPhase() {
  if (STATE.phase <= 0 || STATE.transitioning) return;
  breathTransition(() => {
    STATE.phase--;
    applyPhase();
  });
}

function breathTransition(cb) {
  STATE.transitioning = true;
  const veil = document.getElementById('breath-veil');
  veil.classList.add('on');
  playBell();
  setTimeout(() => {
    cb();
    setTimeout(() => {
      veil.classList.remove('on');
      setTimeout(() => { STATE.transitioning = false; }, 700);
    }, 200);
  }, 700);
}

function applyPhase() {
  const sc = document.getElementById('scroller');
  sc.style.transform = `translateY(-${STATE.phase * 100}vh)`;
  updateHUD();
  if (STATE.phase === 1) initHandTracking();
  if (STATE.phase === 3) initDesktop();
  if (STATE.phase === 4) playTrace();
}

function initDesktop() {
  const ui = document.getElementById('desktop');
  if (!ui) return;
  ui.innerHTML = '';
  STATE.desktopIcons = [];
  const w = window.innerWidth, h = window.innerHeight;
  const TOTAL = Math.floor(60 * C.particleDensity) + 20; // 32..68
  const TARGETS = 4;
  const targetGap = 110;
  const targetStartX = w/2 - ((TARGETS-1) * targetGap) / 2;
  for (let i = 0; i < TOTAL; i++) {
    const isT = i < TARGETS;
    const el = document.createElement('div');
    el.className = 'glyph' + (isT ? ' target' : '');
    const sym = isT ? ['心','念','身','意'][i % 4] : GLYPH_SYMBOLS[Math.floor(Math.random()*GLYPH_SYMBOLS.length)];
    const lbl = isT ? `CORE_${String.fromCharCode(65+i)}` : `VOID_${String(i).padStart(2,'0')}`;
    el.innerHTML = `<div class="box">${sym}</div><div class="label">${lbl}</div>`;
    if (isT) {
      el.style.left = (targetStartX + i * targetGap - 29) + 'px';
      el.style.top = (h * 0.4) + 'px';
    } else {
      el.style.left = (w * 0.14 + Math.random() * w * 0.72) + 'px';
      el.style.top = (h * 0.18 + Math.random() * h * 0.45) + 'px';
    }
    el.style.pointerEvents = 'auto';
    ui.appendChild(el);
    STATE.desktopIcons.push({ el, isTarget: isT, cleared: false });
  }
}

function playTrace() {
  const cv = document.getElementById('trace-canvas');
  if (!cv) return;
  const w = cv.width = window.innerWidth;
  const h = cv.height = window.innerHeight;
  cv.style.opacity = 1;
  const ctx = cv.getContext('2d');
  const allPaths = [].concat(HAND[0].path, HAND[1].path).sort((a,b) => a.phase - b.phase);
  if (allPaths.length === 0) {
    // fallback: create a soft trace from mouse
    for (let i = 0; i < 600; i++) {
      const t = i / 600;
      allPaths.push({ x: w/2 + Math.sin(t*20)*w*0.3, y: h*0.3 + t*h*0.4, phase: 1 });
    }
  }
  let i = 0;
  function step() {
    if (STATE.phase !== 4) return;
    for (let k = 0; k < 12 && i < allPaths.length; k++, i++) {
      const p = allPaths[i];
      ctx.beginPath();
      ctx.fillStyle = p.phase === 2 ? 'rgba(166,61,42,0.18)' : 'rgba(242,237,224,0.14)';
      ctx.arc(p.x, p.y, 1.3, 0, Math.PI*2);
      ctx.fill();
    }
    if (i < allPaths.length) requestAnimationFrame(step);
    else setTimeout(() => { if (STATE.phase === 4) nextPhase(); }, 3200);
  }
  step();
}

// ═════════════════════════════════════════════════════════
// ENTRY / NAV
// ═════════════════════════════════════════════════════════
window.startExperience = () => {
  initAudio();
  nextPhase();
};

window.restartToTop = () => {
  const veil = document.getElementById('breath-veil');
  veil.classList.add('on');
  setTimeout(() => {
    STATE.phase = 0;
    STATE.adaptation = 0;
    STATE.wash = 0;
    STATE.particles = []; STATE.hearts = []; STATE.ripples = [];
    HAND.forEach(h => { h.path = []; h.grab = null; h.isOk = false; h.lastOk = false; });
    const tc = document.getElementById('trace-canvas');
    if (tc) { tc.getContext('2d').clearRect(0,0,tc.width,tc.height); tc.style.opacity = 0; }
    STATE.desktopIcons.forEach(i => i.el.remove());
    STATE.desktopIcons = [];
    applyPhase();
    setTimeout(() => veil.classList.remove('on'), 300);
  }, 800);
};

// scroll flow
let wheelLock = 0;
window.addEventListener('wheel', e => {
  if (STATE.transitioning) return;
  const now = Date.now();
  if (now - wheelLock < 1500) return;
  if (e.deltaY > 30 && STATE.phase < 5) { wheelLock = now; nextPhase(); }
  if (e.deltaY < -30 && STATE.phase > 0) { wheelLock = now; prevPhase(); }
}, { passive: true });

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); nextPhase(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); prevPhase(); }
});

// init
applyPhase();

// expose for tweaks
window.BT = {
  setConfig(next) {
    Object.assign(C, next);
    if ('soundVolume' in next) setVolume(next.soundVolume);
    if ('accent' in next) document.documentElement.style.setProperty('--cinnabar', next.accent);
  }
};
