/* Miss Minutes — Interactive Character Engine (vanilla JS)
   Pipeline: MP3 → <audio> → AudioContext → AnalyserNode → RMS/spectrum → smoothed mouth params → SVG overlay.
   One requestAnimationFrame loop owns all animation; everything is lerped toward targets. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmt = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';

  /* ---------- Logger (engine console) ---------- */
  const Logger = {
    el: $('#log'),
    write(msg, cls = '') {
      const d = document.createElement('div'); d.className = cls; d.textContent = msg;
      this.el.appendChild(d);
      while (this.el.childNodes.length > 60) this.el.firstChild.remove();
      this.el.scrollTop = this.el.scrollHeight;
    }
  };

  /* ---------- Data tables: add expressions / moves here ---------- */
  // brow: opacity, browY: px lift (negative = up), browTilt: deg (+angry, -sad), lid: eyelid droop 0..1,
  // curve: mouth curvature (.5 = original smile, 1 = big smile, 0 = frown), base: resting mouth opening,
  // round: "O" shape, pupil: pupil scale, rot/scale: whole-body pose.
  const EXPRESSIONS = {
    neutral: { brow: 0, browY: 0, browTilt: 0, lid: 0, curve: .5, base: 0, round: 0, pupil: 1, rot: 0, scale: 1 },
    happy: { brow: 1, browY: -10, browTilt: 0, lid: .12, curve: 1, base: 0, round: 0, pupil: 1.05, rot: -2, scale: 1.02 },
    sad: { brow: 1, browY: 0, browTilt: -14, lid: .35, curve: .05, base: 0, round: 0, pupil: .95, rot: 3, scale: .98 },
    angry: { brow: 1, browY: 8, browTilt: 18, lid: .3, curve: .12, base: 0, round: 0, pupil: .85, rot: 0, scale: 1.02 },
    surprised: { brow: 1, browY: -28, browTilt: 0, lid: 0, curve: .5, base: .5, round: .9, pupil: .7, rot: 0, scale: 1.04 },
    confused: { brow: 1, browY: -6, browTilt: -6, lid: .1, curve: .3, base: 0, round: 0, pupil: 1, rot: 5, scale: 1 },
    excited: { brow: 1, browY: -20, browTilt: 0, lid: 0, curve: 1, base: .25, round: 0, pupil: 1.1, rot: -1, scale: 1.05 },
    serious: { brow: 1, browY: 4, browTilt: 6, lid: .25, curve: .35, base: 0, round: 0, pupil: .95, rot: 0, scale: 1 },
    mischievous: { brow: 1, browY: -2, browTilt: 14, lid: .3, curve: 1, base: 0, round: 0, pupil: .9, rot: -4, scale: 1 },
    curious: { brow: 1, browY: -14, browTilt: -4, lid: 0, curve: .4, base: 0, round: .15, pupil: 1.12, rot: 6, scale: 1.01 },
    sleepy: { brow: 1, browY: 6, browTilt: -8, lid: .7, curve: .35, base: .08, round: .2, pupil: .9, rot: 4, scale: .98 },
    love: { brow: 1, browY: -12, browTilt: -8, lid: .15, curve: 1, base: 0, round: 0, pupil: 1.3, rot: -3, scale: 1.03 },
    smug: { brow: 1, browY: -6, browTilt: 10, lid: .4, curve: .8, base: 0, round: 0, pupil: .9, rot: -5, scale: 1 },
    scared: { brow: 1, browY: -24, browTilt: -16, lid: 0, curve: .1, base: .2, round: .5, pupil: .55, rot: 0, scale: .97 },
  };
  // Particle glyphs, their colours, and which expression auto-spawns which effect.
  const FXG = { sparkle: ['✦', '✧', '✨'], heart: ['♥', '♡'], note: ['♪', '♫'], star: ['★', '✦'], question: ['?'], exclaim: ['!'], sweat: ['💧'], zzz: ['z', 'Z'], anger: ['💢'], clock: ['◷', '◴'] };
  const FXC = { heart: '#ff6f91', anger: '#ff5a4a', question: '#9fd6ff', exclaim: '#ffe066', sweat: '#8fd3ff', zzz: '#cfc2ff', note: '#b5f5a0' };
  const FXE = { love: 'heart', scared: 'sweat', angry: 'anger', surprised: 'exclaim', confused: 'question', sleepy: 'zzz', excited: 'sparkle' };
  const mod = (v, m) => ((v % m) + m) % m;
  const SPR = ['head', 'aL', 'aR', 'hL', 'hR', 'lgL', 'lgR'];          // channels given spring follow-through
  const TIMELINE = ['Genesis', 'First Branch', 'Great Convergence', 'Loom Overload', 'Paradox Spike', 'Variant Detected', 'Pruning Order', 'Time Door Opened',
    'Sacred Timeline Merge', 'Nexus Event', 'Reset Charge', 'Loop Closed', 'Temporal Echo', 'Final Entry'].map((label, i) => ({ label, year: 1000 + i * 137 }));
  // Built-in animated backgrounds: (ctx, width, height, seconds). Add your own with MissMinutes.addBackground(name, fn).
  const BG = {
    tva: (c, w, h, t) => {
      const g = c.createRadialGradient(w * .5, h * .45, 10, w * .5, h * .5, h * .85); g.addColorStop(0, '#3d2410'); g.addColorStop(1, '#080503'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,157,46,.2)'; c.lineWidth = 1; const hz = h * .7;
      for (let i = 0; i < 12; i++) { const k = ((i + t * .5) % 12) / 12, y = hz + (h - hz) * k * k; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(w / 2 + i * w * .025, hz); c.lineTo(w / 2 + i * w * .17, h); c.stroke(); }
      c.fillStyle = 'rgba(255,200,120,.55)';
      for (let i = 0; i < 30; i++) c.fillRect(mod(Math.sin(i * 91.7) * .5 * w + w * .5, w), mod((i * 37 % 100) / 100 * h - t * (8 + i % 5 * 5), h), 2, 2);
    },
    timeline: (c, w, h, t) => {
      c.fillStyle = '#070504'; c.fillRect(0, 0, w, h); c.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const y0 = h * (.12 + i * .095), a = h * (.015 + (i % 3) * .01), pr = i === 4;
        c.lineWidth = pr ? 1.5 : 2.5; c.strokeStyle = pr ? `rgba(255,90,70,${.3 + .25 * Math.sin(t * 3)})` : 'rgba(255,157,46,.4)'; c.shadowColor = '#ff9d2e'; c.shadowBlur = pr ? 0 : 10;
        c.beginPath(); for (let x = 0; x <= w; x += 12) { const y = y0 + Math.sin(x / w * 5 + t * .8 + i) * a + (x / w) * (i - 4) * h * .02; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
      }
      c.shadowBlur = 0;
    },
    stars: (c, w, h, t) => {
      c.fillStyle = '#04030a'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { const z = (i % 3 + 1) / 3; c.fillStyle = `rgba(255,${200 + i % 50},${150 + i % 80},${.3 + .5 * Math.abs(Math.sin(t * z + i))})`; c.fillRect(mod(Math.sin(i * 12.9) * .5 * w + w * .5 - t * 6 * z, w), (Math.sin(i * 78.2) * .5 + .5) * h, 1 + z, 1 + z); }
    },
    office: (c, w, h, t) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b2013'); g.addColorStop(1, '#0d0905'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(255,190,110,${.05 + .03 * Math.sin(t * .7 + i)})`; c.fillRect(w * (.05 + i * .2), 0, w * .1, h * .78); }
      c.fillStyle = 'rgba(255,157,46,.08)'; c.fillRect(0, h * .78, w, h * .22);
      for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(255,200,130,.07)'; c.beginPath(); c.arc((i * 137.5 % 100) / 100 * w, h * .3 + Math.sin(t * .3 + i) * h * .2, h * (.01 + i % 4 * .006), 0, 7); c.fill(); }
    },
    void: (c, w, h) => { c.fillStyle = '#050403'; c.fillRect(0, 0, w, h); },
  };
  const e = Math.sin, PI = Math.PI;
  // Each move: duration (ms) + fn(p 0..1) → offsets. Keys: x,y (px), rot (deg, whole body), sx,sy (scale),
  // head (deg), aL/aR (arm raise deg), hL/hR (hand twist deg), lgL/lgR (leg swing deg). Missing keys = 0 / 1.
  const sm = p => p * p * (3 - 2 * p);                 // smoothstep
  const env = p => Math.min(1, p * 5, (1 - p) * 5);   // fade in/out so moves start and end smoothly
  const MOVES = {
    bounce: { ms: 900, fn: p => ({ y: -Math.abs(e(p * PI * 2)) * 30 * (1 - p * .4), sy: 1 - .04 * Math.abs(e(p * PI * 2 + PI / 2)), aL: 10 * e(p * PI * 4), aR: 10 * e(p * PI * 4) }) },
    shake: { ms: 700, fn: p => ({ x: e(p * PI * 8) * 12 * (1 - p), head: e(p * PI * 8) * 9 * (1 - p) }) },
    nod: { ms: 900, fn: p => ({ head: e(p * PI * 4) * 7 * env(p), y: e(p * PI * 4) * 6 }) },
    jump: {
      ms: 900, fn: p => ({
        y: -e(p * PI) * 130, sy: 1 + .05 * e(p * PI) - .14 * Math.max(0, 1 - p * 7) - .1 * Math.max(0, 1 - (1 - p) * 7),   // anticipation + landing squash
        aL: 55 * e(p * PI), aR: 55 * e(p * PI), lgL: 12 * e(p * PI), lgR: -12 * e(p * PI)
      })
    },
    wave: { ms: 2000, fn: p => ({ aR: env(p) * (95 + e(p * PI * 8) * 8), hR: e(p * PI * 8) * 22 * env(p), head: -3 * env(p) }) },
    wiggle: { ms: 900, fn: p => ({ rot: e(p * PI * 10) * 4 * (1 - p), lgL: e(p * PI * 10) * 8 * (1 - p), lgR: -e(p * PI * 10) * 8 * (1 - p) }) },
    float: { ms: 2400, fn: p => ({ y: -e(p * PI) * 40, rot: e(p * PI * 2) * 2, aL: 14 * e(p * PI), aR: 14 * e(p * PI) }) },
    celebrate: { ms: 1800, fn: p => ({ y: -Math.abs(e(p * PI * 4)) * 50, rot: e(p * PI * 4) * 5, aL: env(p) * (80 + e(p * PI * 8) * 14), aR: env(p) * (80 - e(p * PI * 8) * 14), hL: e(p * PI * 8) * 15, hR: e(p * PI * 8) * 15 }), expr: 'excited' },
    walk: { ms: 1600, fn: p => ({ lgL: e(p * PI * 6) * 14, lgR: -e(p * PI * 6) * 14, aL: e(p * PI * 6) * 8, aR: -e(p * PI * 6) * 8, y: -Math.abs(e(p * PI * 6)) * 6, rot: e(p * PI * 3) * 1.5 }) },
    // extra keys: lx/ly = eye look offset, fx = particle burst on start, expr = temporary expression
    spin: { ms: 900, fn: p => ({ rot: 360 * sm(p), y: -e(p * PI) * 45, aL: 70 * e(p * PI), aR: 70 * e(p * PI) }), fx: 'sparkle' },
    flip: { ms: 1100, fn: p => ({ rot: -360 * sm(p), y: -e(p * PI) * 170, sy: 1 - .06 * e(p * PI * 2), aL: 40 * e(p * PI), aR: 40 * e(p * PI) }), expr: 'excited' },
    dance: { ms: 3200, fn: p => { const w = env(p), b = p * PI * 8; return { x: e(p * PI * 4) * 22 * w, y: -Math.abs(e(b)) * 16 * w, rot: e(b) * 5 * w, head: e(b + 1) * 9 * w, aL: (50 + e(b) * 40) * w, aR: (50 - e(b) * 40) * w, hL: e(b * 2) * 20 * w, hR: e(b * 2) * 20 * w, lgL: e(b) * 14 * w, lgR: -e(b) * 14 * w }; }, expr: 'happy', fx: 'note' },
    bow: { ms: 1500, fn: p => ({ head: 24 * e(p * PI), y: 8 * e(p * PI), rot: 6 * e(p * PI), sy: 1 - .05 * e(p * PI) }) },
    think: { ms: 2400, fn: p => ({ head: -9 * env(p), rot: 3 * env(p), aR: 72 * env(p), hR: -20 * env(p), lx: -.7 * env(p), ly: -.8 * env(p) }), expr: 'curious', fx: 'question' },
    shrug: { ms: 1300, fn: p => ({ aL: 38 * e(p * PI), aR: 38 * e(p * PI), hL: 25 * e(p * PI), hR: -25 * e(p * PI), y: -8 * e(p * PI), head: 7 * e(p * PI * 2) }), expr: 'confused' },
    sneak: { ms: 2200, fn: p => ({ y: 8 * env(p), sy: 1 - .06 * env(p), rot: e(p * PI * 4) * 3, lgL: e(p * PI * 4) * 10, lgR: -e(p * PI * 4) * 10, lx: e(p * PI * 2) * .9 }), expr: 'mischievous' },
    shiver: { ms: 1100, fn: p => ({ x: e(p * PI * 44) * 3 * env(p), rot: e(p * PI * 36) * 1.2 * env(p), aL: 20 * env(p), aR: 20 * env(p) }), expr: 'scared', fx: 'sweat' },
    stomp: { ms: 1200, fn: p => ({ y: -Math.abs(e(p * PI * 3)) * 10, rot: e(p * PI * 6) * 2, lgL: e(p * PI * 6) * 10, lgR: -e(p * PI * 6) * 10, aL: 25 * env(p), aR: 25 * env(p), head: e(p * PI * 6) * 3 }), expr: 'angry', fx: 'anger' },
    tick: { ms: 2400, fn: p => ({ rot: Math.round(e(p * PI * 6)) * 5 * env(p), head: Math.round(e(p * PI * 6)) * -4 * env(p) }) },
    laugh: { ms: 1500, fn: p => ({ y: -Math.abs(e(p * PI * 10)) * 8, sy: 1 - .03 * e(p * PI * 20), rot: e(p * PI * 5) * 3, head: e(p * PI * 10) * 5, aL: 15 * env(p), aR: 15 * env(p) }), expr: 'happy', fx: 'sparkle' },
    clap: { ms: 1500, fn: p => ({ aL: env(p) * (62 - Math.abs(e(p * PI * 10)) * 12), aR: env(p) * (62 - Math.abs(e(p * PI * 10)) * 12), y: -Math.abs(e(p * PI * 5)) * 6 }), expr: 'excited', fx: 'star' },
  };

  /* ---------- AudioManager: <audio> → AnalyserNode ---------- */
  class AudioManager {
    constructor() {
      this.el = new Audio(); this.el.preload = 'auto'; this.el.volume = .8; this.el.preservesPitch = true;
      this.files = new Map();           // uploaded name → object URL
      this.ctx = this.analyser = null;  // created lazily on first play (browser autoplay rules)
      this.done = null; this.loaded = false;
      this.el.addEventListener('ended', () => this._finish(true));
      this.el.addEventListener('error', () => { if (this.el.src) Logger.write(`Audio error: could not load ${this.name}`, 'err'); this._finish(false); });
    }
    _ensureGraph() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = .1;
      this.time = new Float32Array(this.analyser.fftSize); this.freq = new Float32Array(this.analyser.frequencyBinCount);
      this.agc = { peak: .08, floor: .003 };
      const src = this.ctx.createMediaElementSource(this.el), dly = this.ctx.createDelay(.5); dly.delayTime.value = .06;
      src.connect(this.analyser); src.connect(dly); dly.connect(this.ctx.destination);   // analyse 60 ms AHEAD of what is heard → mouth leads the sound, which reads as perfect sync
    }
    resolve(name) { return this.files.get(name) || (/^(blob:|https?:|\/|\.)/.test(name) ? name : 'assets/audio/' + name); }
    addFile(file) { const url = URL.createObjectURL(file); this.files.set(file.name, url); this.load(file.name); }
    load(name) { this.name = name; this.el.src = this.resolve(name); this.loaded = true; }
    get playing() { return !this.el.paused && !this.el.ended; }
    get state() { return this.playing ? 'PLAYING' : (this.el.currentTime > 0 && !this.el.ended ? 'PAUSED' : 'STOPPED'); }
    async play() {
      if (!this.loaded) { Logger.write('No audio loaded. Upload an MP3 first.', 'err'); return false; }
      this._ensureGraph(); await this.ctx.resume();
      try { await this.el.play(); return true; } catch (err) { Logger.write('Playback failed: ' + err.message, 'err'); return false; }
    }
    pause() { this.el.pause(); }
    stop() { this.el.pause(); if (this.loaded) this.el.currentTime = 0; this._finish(true); }
    _finish(ok) { if (this.done) { const d = this.done; this.done = null; d(ok); } }
    async speak(name) {
      this.el.pause(); this._finish(true);
      if (name) this.load(name);
      const p = new Promise(r => this.done = r);
      if (!(await this.play())) { this._finish(false); return false; }
      return p;
    }
    /** Per-frame mouth targets from the voice: {level, open, wide, round, sib} (all 0..1).
        Adaptive gain + noise floor keep it accurate for quiet/loud files over long sessions.
        Formant balance F2/(F1+F2): low → "ah/oh/oo" (open, rounded) · high → "ee/ih" (wide, less open) · 4.5–9 kHz energy → "s/sh/f" (teeth, nearly closed). */
    sample() {
      if (!this.analyser || !this.playing) return { level: 0, open: 0, wide: 0, round: 0, sib: 0 };
      const a = this.analyser, hz = this.ctx.sampleRate / a.fftSize, G = this.agc;
      a.getFloatTimeDomainData(this.time); a.getFloatFrequencyData(this.freq);
      let sum = 0; for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
      const rms = Math.sqrt(sum / this.time.length);
      G.peak = Math.max(G.peak * .9993, rms, .02); G.floor = rms < G.floor ? rms : G.floor + (rms - G.floor) * .0008;
      const lo = G.floor * 1.6, level = clamp((rms - lo) / (G.peak * .75 - lo + 1e-6));
      const band = (f0, f1) => { let s = 0, n = 0; for (let i = Math.floor(f0 / hz); i <= f1 / hz; i++, n++) s += Math.pow(10, this.freq[i] / 10); return s / n; };
      const f1 = band(250, 900), f2 = band(1000, 2800), hi = band(4500, 9000), tot = f1 + f2 + hi + 1e-12, r = f2 / (f1 + f2 + 1e-12);
      return { level, open: level * (1 - clamp((r - .35) * 1.2) * .45), wide: clamp((r - .3) * 2.5) * level, round: clamp((.2 - r) * 5) * level, sib: clamp((hi / tot - .15) * 4) * level };
    }
  }

  /* ---------- Engine ---------- */
  class MissMinutesEngine {
    constructor() {
      this.audio = new AudioManager();
      this.P = { headTurn: 0, lean: 0, lookX: 0, lookY: 0, brow: 0, browY: 0, browTilt: 0, lid: 0, curve: .5, round: 0, base: 0, pupil: 1, rot: 0, scale: 1 };
      this.T = { ...this.P };           // targets; P is lerped toward T every frame
      this.exprName = 'neutral'; this.lookName = 'CENTER'; this.lookMode = 'auto';
      this.mouth = 0; this.mouthRound = 0; this.mouthWide = 0; this.teeth = 0; this.mouthLabel = 'CLOSED'; this.mouthPrev = 0;
      this.moves = []; this.blinkT = -1; this.blinkDone = null; this.autoBlink = true; this.track = true;
      this.pos = { x: 0, vx: 0, phase: 0 }; this.sp = {}; this.epoch = 0; this.sayId = 0; this.findId = 0; this.finding = false; this.data = TIMELINE; this.vids = new Map(); this.bgName = 'tva'; this.fc = 0; this.walkJob = null; this.cues = []; this.sayUntil = 0; this.busy = false; this.nextIdle = 9;
      this.nextBlink = 2; this.nextSaccade = 1; this.time = 0; this.mouse = { x: 0, y: 0, last: -9 }; this.hover = false;
      this.cache(); this.bindMouse(); this.last = performance.now(); requestAnimationFrame(t => this.frame(t));
    }
    cache() {
      const g = id => document.getElementById(id);
      this.el = {
        char: g('char'), stage: g('stage'), head: g('head'), aL: g('armL'), aR: g('armR'), hL: g('handL'), hR: g('handR'),
        lgL: g('legL'), lgR: g('legR'), shadow: g('shadow'), pL: g('pupilL'), pR: g('pupilR'), lidL: g('lidL'), lidR: g('lidR'),
        bL: g('browL'), bR: g('browR'), brows: g('brows'), mouth: g('mouth'), tongue: g('tongue'),
        hud: g('hud'), fx: g('fx'), cap: g('caption'), bgw: g('bgwrap'), bgc: g('bgc'), bgv: g('bgv'), tl: g('tl'), tlTrack: g('tlTrack'), tlCur: g('tlCur'), tlQ: g('tlQ'), teeth: g('teeth'), seek: g('seek'), time: g('time')
      };
      // Clock-face tick marks, generated so you can change count/length/width freely.
      for (let i = 0; i < 12; i++) {
        const a = i * PI / 6, big = i % 3 === 0, r1 = big ? 128 : 142, r2 = 172, l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', 300 + Math.sin(a) * r1); l.setAttribute('y1', 300 - Math.cos(a) * r1);
        l.setAttribute('x2', 300 + Math.sin(a) * r2); l.setAttribute('y2', 300 - Math.cos(a) * r2);
        l.setAttribute('stroke-width', i === 0 ? 14 : big ? 9 : 5); g('ticks').appendChild(l);
      }
      this.bctx = this.el.bgc.getContext('2d'); new ResizeObserver(() => this.sizeBg()).observe(this.el.stage); this.sizeBg();
      this.el.bgv.addEventListener('error', () => { if (this.el.bgv.getAttribute('src')) { Logger.write('Video background failed to load; using default.', 'err'); this.setBackground('tva'); } });
      this.hudCells = {};['Audio', 'Character', 'Mouth', 'Expression', 'Look', 'Pos'].forEach(k => {
        const a = document.createElement('span'); a.textContent = k.toUpperCase();
        const b = document.createElement('b'); this.el.hud.append(a, b); this.hudCells[k] = b;
      });
    }
    bindMouse() {
      addEventListener('pointermove', ev => { this.mouse.x = ev.clientX; this.mouse.y = ev.clientY; this.mouse.last = this.time; });
      const st = this.el.stage;
      st.addEventListener('pointerenter', () => { if (this.exprName === 'neutral' && !this.audio.playing) { this.hover = true; this.setExpr('happy'); } });
      st.addEventListener('pointerleave', () => { if (this.hover) { this.hover = false; this.setExpr('neutral'); } });
      st.addEventListener('click', () => { this.hover = false; const r = ['bounce', 'spin', 'wiggle', 'laugh', 'flip', 'clap']; this.move(r[Math.random() * r.length | 0]); this.blink(); this.fx('sparkle', 4); });
    }
    /* --- state setters (pure state; logging happens in the API wrapper) --- */
    setExpr(name) { const d = EXPRESSIONS[name]; if (!d) throw new Error(`Unknown expression "${name}"`); this.exprName = name; Object.assign(this.T, d); }
    setLook(dir) {
      // [eyeX, eyeY, headTurn°]. "far*" / "off*" glance past the stage edge and turn the head with the eyes.
      const D = {
        left: [-1, 0, -4], right: [1, 0, 4], up: [0, -1, 0], down: [0, 1, 0], center: [0, 0, 0], upleft: [-.8, -.8, -3], upright: [.8, -.8, 3], downleft: [-.8, .8, -3], downright: [.8, .8, 3],
        farleft: [-1.4, -.1, -12], farright: [1.4, -.1, 12], offleft: [-1.5, .1, -18], offright: [1.5, .1, 18]
      };
      const v = Array.isArray(dir) ? [clamp(dir[0], -1.5, 1.5), clamp(dir[1], -1.2, 1.2), clamp(dir[0], -1.5, 1.5) * 10] : D[dir];
      if (!v) throw new Error(`Unknown look direction "${dir}"`);
      this.lookName = Array.isArray(dir) ? 'CUSTOM' : dir.toUpperCase(); this.lookMode = dir === 'center' ? 'auto' : 'manual';
      this.T.lookX = v[0]; this.T.lookY = v[1]; this.T.headTurn = v[2];
    }
    blink() { return new Promise(r => { this.blinkT = 0; this.blinkDone = r; }); }
    move(name) {
      const m = MOVES[name]; if (!m) throw new Error(`Unknown move "${name}"`);
      return new Promise(res => {
        const prev = this.exprName; if (m.expr) this.setExpr(m.expr); if (m.fx) this.fx(m.fx, 4);
        this.moves.push({ m, t0: this.time, res, restore: m.expr ? prev : null });
      });
    }
    resetPose() {
      this.moves.forEach(x => x.res()); this.moves = []; this.cues = []; this.sayUntil = 0; this.T.lean = 0; this.epoch++; this.findId++; this.finding = false; this.el.tl.classList.remove('on');
      this.setExpr('neutral'); this.setLook('center'); this.hover = false; this.caption('');
      if (this.walkJob) { this.walkJob.res(); this.walkJob = null; }
      this.walkTo(0, 600);
    }
    sizeBg() { const d = Math.min(devicePixelRatio || 1, 1.5), c = this.el.bgc; c.width = Math.round(c.clientWidth * d) || 300; c.height = Math.round(c.clientHeight * d) || 400; }
    drawBg() {
      try { const c = this.el.bgc; BG[this.bgName](this.bctx, c.width, c.height, this.time); }
      catch (err) { Logger.write(`Background "${this.bgName}" crashed: ${err.message}`, 'err'); this.bgName = 'tva'; }
    }
    /** background("tva"|"timeline"|"stars"|"office"|"void"|yourOwn) or background("video", src, {loop, muted, rate}) */
    setBackground(name, src, o = {}) {
      const v = this.el.bgv; v.pause();
      if (name === 'video') {
        if (!src) throw new Error('background("video", src) needs a file name or URL');
        v.loop = o.loop !== false; v.muted = o.muted !== false; v.playbackRate = o.rate || 1;
        v.src = this.vids.get(src) || (/^(blob:|https?:|\/|\.)/.test(src) ? src : 'assets/video/' + src);
        v.hidden = false; this.el.bgc.hidden = true; this.bgName = 'video';
        v.play().catch(err => Logger.write('Video background: ' + err.message, 'err')); return;
      }
      if (!BG[name]) throw new Error(`Unknown background "${name}" (${Object.keys(BG).join(', ')}, video)`);
      v.removeAttribute('src'); v.load(); v.hidden = true; this.el.bgc.hidden = false; this.bgName = name; this.sizeBg();
    }
    buildTimeline(items, lab, qs) {
      const tr = this.el.tlTrack, n = items.length; this.el.tlQ.textContent = qs;
      tr.querySelectorAll('.tl-n').forEach(x => x.remove()); this.el.tlCur.style.transitionDuration = '0ms'; this.el.tlCur.style.left = '3%';
      return items.map((it, i) => {
        const d = document.createElement('div'), o = it.d, tt = o && typeof o === 'object' ? o.t ?? o.time ?? o.year ?? o.date ?? '' : '';
        d.className = 'tl-n ' + (i % 2 ? 'dn' : 'up') + (n > 14 ? ' many' : ''); d.style.left = (3 + (n > 1 ? i / (n - 1) : .5) * 94) + '%';
        d.innerHTML = '<u></u><s></s>'; d.lastChild.textContent = lab(o) + (tt !== '' ? ' · ' + tt : ''); tr.appendChild(d); return d;
      });
    }
    /** Search a timeline from BEGINNING to END. q: text | RegExp | {key: value} | (item, i) => bool. data: array (default = setData()). */
    async find(q, data, o = {}) {
      data = data || this.data; const n = data.length, found = [];
      if (!n) throw new Error('find(): no data. Pass an array or call setData([...]) first.');
      const lab = d => typeof d !== 'object' || !d ? String(d) : d.label ?? d.name ?? d.title ?? d.event ?? JSON.stringify(d), txt = d => typeof d === 'object' ? JSON.stringify(d) : String(d);
      const match = typeof q === 'function' ? q : q && typeof q.test === 'function' ? d => q.test(txt(d)) : q && typeof q === 'object' ? d => Object.entries(q).every(([k, v]) => v instanceof RegExp ? v.test(d[k]) : d[k] === v) : d => txt(d).toLowerCase().includes(String(q).toLowerCase());
      const qs = typeof q === 'function' ? 'custom query' : String(q), my = ++this.findId, alive = () => my === this.findId, cur = this.el.tlCur;
      const step = clamp((o.duration || clamp(n * 300, 2600, 9000)) / n, 60, 700), nodes = this.buildTimeline(data.map(d => ({ d })), lab, qs), ask = `Searching for “${qs}”…`;
      this.finding = true; this.el.tl.classList.add('on'); this.setExpr('serious'); this.T.lean = -4; this.setLook([-1.3, .6]); this.caption(ask); await sleep(600);
      for (let i = 0; i < n && alive(); i++) {
        const x = n > 1 ? i / (n - 1) : .5;
        cur.style.transitionDuration = step + 'ms'; cur.style.left = (3 + x * 94) + '%';
        this.T.lookX = -1.2 + x * 2.4; this.T.lookY = .55; this.T.headTurn = (x - .5) * 22;      // eyes + head track the scanner
        await sleep(step); if (!alive()) break;
        nodes[i].classList.add('seen');
        if (match(data[i], i)) {
          found.push(data[i]); nodes[i].classList.add('hit'); this.setExpr('surprised'); this.fx('exclaim', 3); this.caption('Found: ' + lab(data[i])); await sleep(450); if (!alive()) break;
          this.setExpr('excited'); this.move('jump'); this.T.lookX = 0; this.T.lookY = 0; this.T.headTurn = 0; await sleep(1000); if (!alive()) break;
          if (o.first) break; this.setExpr('serious'); this.caption(ask);
        }
      }
      if (alive()) {
        this.setLook('center'); this.T.lean = 0;
        if (found.length) { this.setExpr('happy'); this.fx('sparkle', 6); this.move('clap'); this.caption(`Found ${found.length} match${found.length > 1 ? 'es' : ''}`); }
        else { this.setExpr('sad'); this.move('shrug'); this.caption('Nothing found in the timeline'); }
        await sleep(2200);
      }
      if (alive()) { this.el.tl.classList.remove('on'); this.caption(''); this.setExpr('neutral'); this.finding = false; }
      Logger.write(`find("${qs}") → ${found.length} match(es)`, 'sys'); return found;
    }
    caption(t) { this.el.cap.textContent = t; this.el.cap.classList.toggle('on', !!t); }
    /** Walk across canvas space. x is in stage-widths from centre: 0 = middle, ±1.4 = fully off-screen. */
    walkTo(x, ms) {
      const a = this.pos.x; ms = ms || clamp(Math.abs(x - a) * 1900, 350, 7000);
      if (this.walkJob) this.walkJob.res();
      return new Promise(res => this.walkJob = { a, x, t0: this.time, ms, res });
    }
    enter(side = 'left') { const s = side === 'right' ? 1 : -1; if (Math.abs(this.pos.x) < 1.2) this.pos.x = s * 1.4; return this.walkTo(0); }
    exit(side = 'right') { return this.walkTo((side === 'left' ? -1 : 1) * 1.4); }
    /** Slide in from off-screen, lean toward the centre, glance around, then retreat. */
    async peek(side = 'right', hold = 1500) {
      const s = side === 'left' ? -1 : 1;
      if (Math.abs(this.pos.x) < 1.2) await this.walkTo(s * 1.4, 600);
      this.setExpr('curious'); this.setLook(s < 0 ? 'right' : 'left'); this.T.lean = -s * 16;
      await this.walkTo(s * .72, 1000); await sleep(hold * .5);
      this.setLook(s < 0 ? 'farright' : 'farleft'); this.blink(); await sleep(hold * .5);
      this.T.lean = 0; this.setExpr('neutral'); this.setLook('center'); await this.walkTo(s * 1.4, 700);
    }
    fx(kind, n = 5) {
      const g = FXG[kind]; if (!g) throw new Error(`Unknown effect "${kind}"`);
      const sr = this.el.stage.getBoundingClientRect(), cr = this.el.char.getBoundingClientRect();
      const cx = cr.left - sr.left + cr.width * .5, cy = cr.top - sr.top + cr.height * .36;
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span'); s.className = 'fx-p'; s.textContent = g[i % g.length];
        s.style.cssText = `left:${cx}px;top:${cy}px;--c:${FXC[kind] || '#ffd27a'}`; this.el.fx.appendChild(s);
        const a = rnd(-PI * .85, -PI * .15), r = rnd(110, 190), dx = Math.cos(a) * r, dy = Math.sin(a) * r;
        s.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * .6}px),calc(-50% + ${dy * .6}px)) scale(1.2)`, opacity: 1, offset: .35 },
        { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy - 30}px)) scale(.8) rotate(${rnd(-40, 40)}deg)`, opacity: 0 }],
          { duration: rnd(900, 1500), delay: i * 70, easing: 'ease-out', fill: 'backwards' }).onfinish = () => s.remove();
      }
    }
    /** Fire audio-timeline cues (set by speak(src, cues)) when playback passes their timestamp. */
    runCues() {
      const t = this.audio.el.currentTime;
      for (const c of this.cues) { if (t < c.at - .25) c.done = false; else if (!c.done && t >= c.at) { c.done = true; Promise.resolve(window.MissMinutes.act(c.act)).catch(() => { }); } }
    }

    /* --- main loop --- */
    frame(now) {
      requestAnimationFrame(t => this.frame(t));
      try { this.tick(now); } catch (err) { if (!this._err) { this._err = 1; Logger.write('Engine error: ' + err.message, 'err'); } }
    }
    tick(now) {
      const dt = Math.min(.05, (now - this.last) / 1000); this.last = now; this.time += dt;
      const { P, T } = this, k = 1 - Math.exp(-9 * dt);
      this.updateEyes();
      for (const key in P) P[key] += (T[key] - P[key]) * k;
      const a = this.audio.sample(), speaking = this.audio.playing, fake = !speaking && this.time < this.sayUntil;
      // Mouth: gate → normalise → curve → random variation → asymmetric smoothing (fast attack, slower release)
      const raw = speaking ? Math.pow(a.open, .85) : fake ? clamp(Math.abs(e(this.time * 11) * e(this.time * 5.3 + 1)) * 1.4 + .15) : 0;   // fake lip-flap for say()
      const target = clamp(Math.max(raw, P.base, speaking ? a.sib * .16 : 0));
      const rate = target > this.mouth ? 40 : 22;
      this.mouth += (target - this.mouth) * (1 - Math.exp(-rate * dt));
      this.mouthRound += (clamp((speaking ? a.round : 0) + P.round) - this.mouthRound) * (1 - Math.exp(-16 * dt));
      this.mouthWide += ((speaking ? a.wide : 0) - this.mouthWide) * (1 - Math.exp(-16 * dt));
      this.teeth += (clamp(speaking ? a.sib * 1.5 + (this.mouth > .3 ? .5 : 0) : fake ? .4 : 0) - this.teeth) * (1 - Math.exp(-18 * dt));
      this.el.stage.style.setProperty('--glow', (speaking ? clamp(a.level * 3) : 0).toFixed(3));
      const w = this.walkJob;                        // canvas-space walking (ease in/out)
      if (w) {
        const p = clamp((this.time - w.t0) * 1000 / w.ms), s = p < .5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p), nx = w.a + (w.x - w.a) * s;
        this.pos.vx = (nx - this.pos.x) / dt; this.pos.x = nx; if (p >= 1) { this.walkJob = null; w.res(); }
      }
      else this.pos.vx *= Math.exp(-12 * dt);
      if (this.cues.length && speaking) this.runCues();
      if (!this.busy && !this.finding && !speaking && !fake && !this.moves.length && !this.walkJob && Math.abs(this.pos.x) < .1 && this.time > this.nextIdle) {
        this.nextIdle = this.time + rnd(7, 14); this.move(['tick', 'wiggle', 'shrug', 'think'][Math.random() * 4 | 0]);   // idle life
      }
      if (this.bgName !== 'video' && (++this.fc & 1)) this.drawBg();   // scenes at 30 fps
      this.render(dt, speaking || fake);
    }
    updateEyes() {
      const t = this.time, { T } = this, m = this.mouse;
      if (this.autoBlink && t > this.nextBlink && this.blinkT < 0) { this.blink(); this.nextBlink = t + (Math.random() < .2 ? .24 : rnd(2.2, 6)); /* occasional double-blink */ }
      if (this.lookMode !== 'auto') return;
      const r = this.el.char.getBoundingClientRect();
      if (this.track && t - m.last < 3) {          // follow cursor
        T.lookX = clamp((m.x - (r.left + r.width * .5)) / 450, -1, 1) * .9;
        T.lookY = clamp((m.y - (r.top + r.height * .35)) / 350, -1, 1) * .7;
      } else if (t > this.nextSaccade) {           // idle micro-movements
        T.lookX = rnd(-.35, .35); T.lookY = rnd(-.25, .25); this.nextSaccade = t + rnd(1, 3.2);
      }
    }
    render(dt, speaking) {
      const { P, el, time: t } = this, f = n => n.toFixed(2);
      // Movements: sum all active offsets (sx/sy multiply); finish + clean up expired ones.
      const M = { lx: 0, ly: 0, x: 0, y: 0, rot: 0, sx: 1, sy: 1, head: 0, aL: 0, aR: 0, hL: 0, hR: 0, lgL: 0, lgR: 0 };
      this.moves = this.moves.filter(o => {
        const p = (t - o.t0) * 1000 / o.m.ms;
        if (p >= 1) { if (o.restore) this.setExpr(o.restore); o.res(); return false; }
        const v = o.m.fn(p); for (const k in v) { if (k === 'sx' || k === 'sy') M[k] *= v[k]; else M[k] += v[k]; } return true;
      });
      // Walk cycle driven by travel speed + talking gestures driven by mouth energy
      const v = this.pos.vx, spd = clamp(Math.abs(v) / 1.1); this.pos.phase += Math.abs(v) * dt * 24;
      const ph = e(this.pos.phase) * spd, gst = this.mouth;
      M.lgL += ph * 20; M.lgR -= ph * 20; M.aL += ph * 14 + gst * 9 * e(t * 3.1); M.aR += -ph * 14 + gst * 9 * e(t * 2.7 + 1);
      M.y -= Math.abs(ph) * 9; M.rot += clamp(v, -1.5, 1.5) * 3; M.head += gst * 3 * e(t * 4.3) + clamp(v, -1.5, 1.5) * 2;
      for (const k of SPR) { const sp = this.sp[k] || (this.sp[k] = { x: 0, v: 0 }); sp.v += (M[k] - sp.x) * 420 * dt; sp.v *= Math.exp(-18 * dt); sp.x += sp.v * dt; M[k] = sp.x; }   // spring follow-through
      // Idle breathing + cursor tilt
      const idle = Math.sin(t * 1.6), near = this.track && t - this.mouse.last < 3;
      const tilt = near ? clamp((this.mouse.x - innerWidth / 2) / innerWidth * 2, -1, 1) : 0;
      const tx = M.x + tilt * 8 + this.pos.x * el.stage.clientWidth, ty = M.y + idle * 3;
      el.char.style.transform = `translate3d(${f(tx)}px,${f(ty)}px,0) rotate(${f(M.rot + P.lean)}deg) scale(${(P.scale * M.sx * (1 + idle * .004)).toFixed(4)},${(P.scale * M.sy * (1 - idle * .004)).toFixed(4)})`;
      // Ground shadow stays on the floor and shrinks when the body lifts
      el.shadow.setAttribute('transform', `translate(300 ${f(742 - ty)}) scale(${clamp(1 + M.y / 350, .55, 1.1).toFixed(3)} 1)`);
      el.bgw.style.transform = `translate3d(${f(-this.pos.x * 40 - tilt * 6)}px,0,0)`;   // background parallax
      // Head (arms ride on it), arms, hands, legs
      el.head.setAttribute('transform', `translate(0 ${f(idle * 2)}) rotate(${f(P.rot + P.headTurn + M.head + tilt * 3 + Math.sin(t * .9))} 300 440)`);
      const sway = Math.sin(t * 1.3) * 1.5;
      el.aL.setAttribute('transform', `translate(120 400) rotate(${f(-(M.aL + sway))})`);
      el.aR.setAttribute('transform', `translate(480 400) rotate(${f(M.aR - sway)})`);
      el.hL.setAttribute('transform', `translate(150 75) rotate(${f(M.hL)})`);
      el.hR.setAttribute('transform', `translate(150 75) rotate(${f(M.hR)})`);
      el.lgL.setAttribute('transform', `translate(245 430) rotate(${f(M.lgL)})`);
      el.lgR.setAttribute('transform', `translate(355 430) rotate(${f(M.lgR)})`);

      // Blink (time-driven half-sine ≈ 180ms) combined with expression lid droop
      let b = 0;
      if (this.blinkT >= 0) { this.blinkT += dt; b = Math.sin(clamp(this.blinkT / .18) * PI); if (this.blinkT >= .18) { this.blinkT = -1; this.blinkDone && this.blinkDone(); } }
      const lid = Math.max(b, P.lid);
      el.lidL.setAttribute('transform', `translate(0 ${f(229 - 112 + lid * 112)})`);
      el.lidR.setAttribute('transform', `translate(0 ${f(214 - 112 + lid * 112)})`);
      el.pL.setAttribute('transform', `translate(${f(231 + (P.lookX + M.lx) * 17)} ${f(283 + (P.lookY + M.ly) * 12)}) scale(${f(P.pupil)})`);
      el.pR.setAttribute('transform', `translate(${f(381 + (P.lookX + M.lx) * 17)} ${f(268 + (P.lookY + M.ly) * 12)}) scale(${f(P.pupil)})`);
      el.brows.style.opacity = f(P.brow);
      el.bL.setAttribute('transform', `translate(225 ${f(205 + P.browY)}) rotate(${f(P.browTilt)})`);
      el.bR.setAttribute('transform', `translate(375 ${f(190 + P.browY)}) rotate(${f(-P.browTilt)})`);

      // Mouth: always drawn. Width narrows toward "O"; curve bends the corners (smile ↔ frown); height = audio.
      const open = this.mouth, h = open * 46 * (1 - this.mouthWide * .22), w = (40 + (P.curve - .5) * 22) * (1 - this.mouthRound * .5) * (1 + this.mouthWide * .2) + 6 * open;
      const c0 = -(P.curve - .2) * 24, up = c0 + (P.curve - .3) * 16, low = up + 2 * h + 3;
      el.mouth.setAttribute('d', `M${f(-w)} ${f(c0)}Q0 ${f(up)} ${f(w)} ${f(c0)}Q0 ${f(low)} ${f(-w)} ${f(c0)}Z`);
      el.tongue.setAttribute('rx', f(w * .45)); el.tongue.setAttribute('ry', f(h * .22));
      el.tongue.setAttribute('cy', f(c0 + h * .72)); el.tongue.style.opacity = clamp((open - .25) * 3);
      const th = Math.min(h * .45 + 1, 12) * this.teeth, tw = w * .78, ye = c0 + .2 * (up - c0), cy = 2 * (c0 + .5 * (up - c0)) - ye;
      el.teeth.setAttribute('d', th > .6 ? `M${f(-tw)} ${f(ye)}Q0 ${f(cy)} ${f(tw)} ${f(ye)}L${f(tw)} ${f(ye + th)}Q0 ${f(cy + th)} ${f(-tw)} ${f(ye + th)}Z` : '');

      // Mouth state label: CLOSED / OPENING / OPEN / CLOSING (+ shape)
      const d = open - this.mouthPrev; this.mouthPrev = open;
      this.mouthLabel = open < .05 ? 'CLOSED' : d > .004 ? 'OPENING' : d < -.004 ? 'CLOSING' : 'OPEN';
      const au = this.audio.el;
      this.setHud('Audio', this.audio.state); this.setHud('Mouth', this.mouthLabel + (open > .05 ? (this.mouthRound > .5 ? ' · O' : open > .66 ? ' · WIDE' : open > .33 ? ' · MED' : ' · SLIGHT') : ''));
      this.setHud('Character', speaking ? 'SPEAKING' : this.moves.length ? 'ANIMATING' : 'IDLE');
      this.setHud('Expression', this.exprName.toUpperCase()); this.setHud('Look', this.lookMode === 'auto' ? 'CENTER (AUTO)' : this.lookName); this.setHud('Pos', (this.pos.x >= 0 ? '+' : '') + this.pos.x.toFixed(2));
      if (!this._seeking) { this.el.seek.value = au.duration ? au.currentTime / au.duration * 1000 : 0; }
      this.setTime(`${fmt(au.currentTime)} / ${fmt(au.duration)}`);
    }
    setHud(k, v) { const c = this.hudCells[k]; if (c.textContent !== v) c.textContent = v; }   // only touch DOM on change
    setTime(v) { if (this.el.time.textContent !== v) this.el.time.textContent = v; }
  }

  /* ---------- Public API (every call is logged) ---------- */
  const engine = new MissMinutesEngine(), audio = engine.audio;
  let runToken = 0; const CANCEL = Symbol('cancel');
  const normCues = c => !c ? [] : (Array.isArray(c) ? c.map(x => Array.isArray(x) ? { at: +x[0], act: x[1] } : { at: +x.at, act: x.do }) : Object.entries(c).map(([at, act]) => ({ at: +at, act })))
    .sort((a, b) => a.at - b.at).map(x => ({ ...x, done: false }));
  function runAct(a) {
    const M = window.MissMinutes;
    if (Array.isArray(a)) return Promise.all(a.map(runAct));
    if (typeof a === 'function') return a(M);
    const [k, ...r] = String(a).split(':'), arg = r.join(':'), n = k.trim() === 'expr' ? 'expression' : k.trim();
    if (!['move', 'expression', 'look', 'lookAt', 'walkTo', 'walk', 'enter', 'exit', 'peek', 'fx', 'say', 'blink', 'lean', 'wait', 'background', 'find'].includes(n)) throw new Error(`Unknown action "${a}"`);
    return M[n](...(n === 'say' ? [arg] : arg.split(',').map(s => s.trim()).filter(Boolean)));
  }
  const show = a => a.map(x => JSON.stringify(x)).join(', ');
  const cmd = (name, fn) => (...args) => {
    Logger.write(`> MissMinutes.${name}(${show(args)})`); const ep = engine.epoch;
    try { const r = fn(...args); return r && typeof r.then === 'function' ? r.then(v => { if (engine.epoch !== ep) throw CANCEL; return v; }) : r; }   // reset() cancels running scripts
    catch (err) { Logger.write(err.message, 'err'); }
  };
  const MissMinutes = {
    speak: cmd('speak', (src, cues) => { engine.cues = normCues(cues); return audio.speak(src); }),   // cues: {sec: action}
    play: cmd('play', () => audio.play()),
    pause: cmd('pause', () => audio.pause()),
    stop: cmd('stop', () => audio.stop()),
    look: cmd('look', async dir => { engine.setLook(dir); await sleep(350); }),
    blink: cmd('blink', () => engine.blink()),
    expression: cmd('expression', async n => { engine.setExpr(n); engine.hover = false; if (FXE[n]) engine.fx(FXE[n], 3); await sleep(350); }),
    move: cmd('move', n => engine.move(n)),
    wait: cmd('wait', ms => sleep(+ms)),
    walkTo: cmd('walkTo', (x, ms) => engine.walkTo(+x, ms && +ms)),
    walk: cmd('walk', (dx, ms) => engine.walkTo(clamp(engine.pos.x + +dx, -1.5, 1.5), ms && +ms)),
    enter: cmd('enter', s => engine.enter(s)), exit: cmd('exit', s => engine.exit(s)),
    peek: cmd('peek', (s, ms) => engine.peek(s, ms && +ms)),
    lean: cmd('lean', d => { engine.T.lean = +d; }),
    lookAt: cmd('lookAt', (x, y = 0) => { engine.setLook([+x, +y]); return sleep(300); }),
    fx: cmd('fx', (k, n) => engine.fx(k, n && +n)),
    say: cmd('say', async (text, ms) => { const id = ++engine.sayId; ms = ms || Math.max(1400, text.length * 62); if (!audio.playing) engine.sayUntil = engine.time + ms / 1000; engine.caption(text); await sleep(ms); if (id === engine.sayId) engine.caption(''); }),
    find: cmd('find', (q, data, o) => engine.find(q, data, o)),                 // search a timeline; resolves to the matching items
    setData: cmd('setData', a => { engine.data = a; }),                          // default dataset for find()
    background: cmd('background', (n, src, o) => engine.setBackground(n, src, o)),
    addBackground: (name, fn) => { BG[name] = fn; buildButtons(); },             // fn(ctx, w, h, seconds)
    together: (...p) => Promise.all(p),                       // run several actions at once
    act: cmd('act', a => runAct(a)),                          // "move:wave" | ["look:left","fx:heart"] | fn(M)
    idle: cmd('idle', on => { engine.busy = !on; }),
    reset: cmd('reset', () => { runToken++; audio.stop(); engine.resetPose(); }),
    autoBlink: cmd('autoBlink', on => { engine.autoBlink = !!on; }),
    track: cmd('track', on => { engine.track = !!on; }),
    addExpression: (name, def) => { EXPRESSIONS[name] = { ...EXPRESSIONS.neutral, ...def }; buildButtons(); },
    addMove: (name, ms, fn) => { MOVES[name] = { ms, fn }; buildButtons(); },
    expressions: () => Object.keys(EXPRESSIONS), moves: () => Object.keys(MOVES),
    async demo() {
      Logger.write('> MissMinutes.demo()'); const tok = ++runToken, ok = () => tok === runToken, M = MissMinutes;
      const step = async f => { if (ok()) await f(); };
      await step(() => M.reset()); runToken = tok; engine.busy = true;
      try {
        await step(() => sleep(800)); await step(() => M.enter('left')); await step(() => M.expression('happy'));
        await step(() => M.together(M.move('wave'), M.say("Hi! I'm Miss Minutes, your Time Keeper!")));
        await step(() => M.together(M.walkTo(.4), M.say('Let me show you around the timeline…', 2200)));
        await step(() => M.look('farleft')); await step(() => M.together(M.move('think'), M.say('Wait… did something move offscreen?', 2400)));
        await step(() => M.look('offleft')); await step(() => sleep(700)); await step(() => M.look('center')); await step(() => M.expression('smug'));
        await step(() => M.together(M.move('dance'), M.say('Nope. Just me, being fabulous.', 3000)));
        await step(() => M.background('timeline')); await step(() => M.find('variant', undefined, { first: true }));
        await step(() => M.exit('right')); await step(() => M.peek('left', 1800));
        await step(() => M.enter('right')); await step(() => M.expression('excited')); await step(() => M.move('flip'));
        if (ok() && audio.loaded) await M.speak(undefined, { 0.3: 'move:wave', 2: ['expr:excited', 'fx:sparkle'], 4: 'move:dance', 7: 'peek:right' });
        await step(() => M.together(M.walkTo(0), M.move('bow'), M.say('Time flies when you script me!', 1800)));
        await step(() => M.expression('neutral'));
        if (ok()) { M.background('tva'); Logger.write('Demo complete.', 'sys'); }
      } catch (err) { if (err !== CANCEL) Logger.write('Demo error: ' + err.message, 'err'); } finally { engine.busy = false; }
    },
  };
  window.MissMinutes = Object.freeze(MissMinutes);
  window.__studio = { engine, audio, Logger, EXPRESSIONS, MOVES, FXG, BG };   // used by studio.js

  /* ---------- ScriptRunner: executes user code with only the MissMinutes API in scope ---------- */
  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  const BLOCKED = ['window', 'document', 'globalThis', 'self', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'Function', 'eval', 'location', 'navigator'];
  const csleep = ms => { const ep = engine.epoch; return sleep(ms).then(() => { if (engine.epoch !== ep) throw CANCEL; }); };
  async function runScript(code) {
    engine.busy = true;
    try { await new AsyncFunction('MissMinutes', 'sleep', ...BLOCKED, code)(window.MissMinutes, csleep); }
    catch (err) { Logger.write(err === CANCEL ? 'Script cancelled.' : 'Script error: ' + err.message, err === CANCEL ? 'sys' : 'err'); }
    finally { engine.busy = false; }
  }

  function buildButtons() { }   // button palette now lives in studio.js
})();
