// Groundwork sound: everything is made in the browser with the Web Audio API (no sound files). Engines, pouring dirt
// and the river are built as recordings in memory when sound starts, then played in loops at the right speed.
// Each machine has its own diesel engine (firing pulses, clatter, turbo, exhaust), hydraulics, track clank, backup beeper
// and digging noise, placed in 3D where the machine is. Plus one-shots (dumps, tree falls, clangs, splashes) and the
// valley around you (wind, leaves, the river, birds).

function noiseBuffer(c, secs, kind) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === 'pink') { b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * .1848) * .2; }
    else d[i] = w;
  }
  return b;
}
// crackle: sparse random clicks (gravel, twigs)
function crackleBuffer(c, secs, density) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    if (Math.random() < density) { const amp = Math.random() * .9 + .1, len = 20 + Math.random() * 120; for (let k = 0; k < len && i + k < n; k++) d[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / (len * .25)); }
  }
  return b;
}
// a metallic track clank: a click plus a few ringing inharmonic partials
function clankBuffer(c, f0) {
  const n = Math.floor(c.sampleRate * .16), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), sr = c.sampleRate;
  const parts = [[f0, .5, 30], [f0 * 2.43, .3, 45], [f0 * 4.1, .18, 60], [f0 * 6.7, .1, 80]];
  for (let i = 0; i < n; i++) {
    const t = i / sr; let v = (Math.random() * 2 - 1) * Math.exp(-t * 180) * .8;
    for (const [f, a, dk] of parts) v += Math.sin(2 * Math.PI * f * t) * a * Math.exp(-t * dk);
    d[i] = v * .6;
  }
  return b;
}
function dieselWave(c) {
  const N = 48, re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 1; k < N; k++) { im[k] = (1 / Math.pow(k, .85)) * (1 + .55 * Math.sin(k * 1.31)) * (k === 2 ? 1.6 : 1); re[k] = (1 / Math.pow(k, 1.1)) * .4 * Math.cos(k * .7); }
  return c.createPeriodicWave(re, im);
}
function softClip(amount = 2.2) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return curve;
}

// ---------------------------------------------------------------- sample synthesis (done once, when sound starts)
// Real engines are not clean tones: every cylinder firing is a slightly different pressure pulse that rings the exhaust
// pipe, with a sharp diesel knock on top and plenty of irregularity. These functions build such recordings in memory.
function rngS(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function biquad(type, f, Q, sr) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q);
  let b0, b1, b2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
  else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filt(x, co, gain = 1, out = null) {
  const [b0, b1, b2, a1, a2] = co, y = out || new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] += v * gain; }
  return y;
}
// make the end of a buffer flow seamlessly into its start
function loopify(d, sr, fade = .06) {
  const n = Math.floor(sr * fade), L = d.length - n, out = d.slice(0, L);
  for (let i = 0; i < n; i++) { const t = i / n; out[i] = d[i] * t + d[L + i] * (1 - t); }
  return out;
}
function normalize(d, peak = .9) { let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; }
function toBuffer(c, d) { const b = c.createBuffer(1, d.length, c.sampleRate); b.getChannelData(0).set(d); return b; }
const gauss = R => (R() + R() + R() - 1.5) * .816;

// a diesel engine at rpm0: 'load' 0 = idling smoothly, 1 = pulling hard (harsher pulses, more knock and roar)
export function engineSample(c, { rpm0 = 1200, cyl = 6, res = [80, 200, 410], seed = 1, load = 0, secs = 2.4 }) {
  const sr = c.sampleRate, R = rngS(seed * 31 + (load ? 7 : 0)), cycle = 120 / rpm0, fire = cycle / cyl;
  const n = Math.floor(Math.round(secs / cycle) * cycle * sr) + Math.floor(sr * .06);
  const ex = new Float32Array(n), nb = new Float32Array(n), kn = new Float32Array(n);
  const bias = Array.from({ length: cyl }, () => .78 + R() * .44);
  const pw = Math.floor(fire * sr * (load ? .3 : .38)), nbw = Math.floor(sr * .006), knw = Math.floor(sr * .0007);
  for (let i = 0, t = 0; t < n / sr; i++, t = i * fire + gauss(R) * fire * (load ? .05 : .035)) {
    const s0 = Math.floor(Math.max(0, t) * sr), a = bias[i % cyl] * (1 + gauss(R) * (load ? .28 : .18));
    for (let k = 0; k < pw && s0 + k < n; k++) ex[s0 + k] += a * Math.sin(Math.PI * k / pw) ** (load ? 1.5 : 2);
    for (let k = 0; k < nbw && s0 + k < n; k++) nb[s0 + k] += a * (R() * 2 - 1) * Math.exp(-k / (sr * .0016));
    const kd = s0 + Math.floor(pw * .15);
    for (let k = 0; k < knw && kd + k < n; k++) kn[kd + k] += a * (R() * 2 - 1) * (1 - k / knw);
  }
  const y = new Float32Array(n);
  res.forEach((f, q) => filt(ex, biquad('bp', f * (1 + (R() - .5) * .04), [3.5, 5, 4][q], sr), [1, .55, .3][q] * (1 + load * .3), y));
  filt(ex, biquad('lp', 70, .7, sr), 1.4, y);
  filt(nb, biquad('bp', 900 + load * 500, .8, sr), .55 + load * .5, y);
  filt(kn, biquad('hp', 2400, .7, sr), .22 + load * .25, y);
  let br = 0; for (let i = 0; i < n; i++) { br = (br + .02 * (R() * 2 - 1)) / 1.02; y[i] += br * (1.2 + load * 1.6); }
  for (let i = 0; i < n; i++) y[i] = Math.tanh(y[i] * (1.2 + load * .8));
  return toBuffer(c, normalize(loopify(y, sr), .85));
}
// soil or gravel pouring: thousands of tiny impacts, plus the low rumble of the mass landing
export function pourSample(c, gravel, secs = 3) {
  const sr = c.sampleRate, n = Math.floor(sr * secs) + Math.floor(sr * .06), R = rngS(gravel ? 11 : 5), x = new Float32Array(n);
  const rate = gravel ? 1400 : 2600;
  for (let t = 0; t < secs + .06; t += -Math.log(1 - R()) / rate) {
    const s0 = Math.floor(t * sr), a = Math.pow(R(), 2.2), len = Math.floor(sr * (gravel ? .004 + R() * .006 : .002 + R() * .004));
    const f = gravel ? 2500 + R() * 3500 : 0;
    for (let k = 0; k < len && s0 + k < n; k++) x[s0 + k] += a * (gravel ? Math.sin(2 * Math.PI * f * k / sr) : (R() * 2 - 1)) * Math.exp(-k / (len * .3));
  }
  const y = new Float32Array(n);
  if (gravel) { filt(x, biquad('bp', 3200, .7, sr), 1, y); filt(x, biquad('lp', 600, .7, sr), .8, y); }
  else { filt(x, biquad('lp', 1400, .6, sr), 1, y); filt(x, biquad('lp', 250, .7, sr), 1.5, y); }
  let br = 0; for (let i = 0; i < n; i++) { br = (br + .02 * (R() * 2 - 1)) / 1.02; y[i] += br * 1.4; }
  return toBuffer(c, normalize(loopify(y, sr), .8));
}
// a babbling stream: a bed of rushing water with countless small bubbles popping on top
export function streamSample(c, secs = 4) {
  const sr = c.sampleRate, n = Math.floor(sr * secs) + Math.floor(sr * .06), R = rngS(77), y = new Float32Array(n), w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = R() * 2 - 1;
  filt(w, biquad('bp', 700, .5, sr), .5, y); filt(w, biquad('bp', 2200, .7, sr), .25, y);
  for (let t = 0; t < secs; t += -Math.log(1 - R()) / 90) {
    const s0 = Math.floor(t * sr), len = Math.floor(sr * (.01 + R() * .03)), f0 = 350 + R() * 900, a = .15 + R() * .5;
    let ph = 0;
    for (let k = 0; k < len && s0 + k < n; k++) { const f = f0 * (1 + 1.6 * k / len); ph += 2 * Math.PI * f / sr; y[s0 + k] += Math.sin(ph) * a * Math.sin(Math.PI * k / len); }
  }
  return toBuffer(c, normalize(loopify(y, sr), .8));
}

// crickets: many insects chirping out of step, high and quiet
export function cricketSample(c, secs = 5) {
  const sr = c.sampleRate, n = Math.floor(sr * secs) + Math.floor(sr * .06), R = rngS(41), y = new Float32Array(n);
  for (let bug = 0; bug < 7; bug++) {
    const f = 3900 + R() * 1400, period = .45 + R() * .5, amp = .25 + R() * .6;
    for (let t = R() * period; t < secs; t += period * (.9 + R() * .2)) {
      const pulses = 2 + (R() * 3 | 0);
      for (let q = 0; q < pulses; q++) {
        const s0 = Math.floor((t + q * .035) * sr), len = Math.floor(sr * .022);
        for (let k = 0; k < len && s0 + k < n; k++) y[s0 + k] += Math.sin(2 * Math.PI * f * k / sr) * Math.sin(Math.PI * k / len) * amp * (.6 + .4 * Math.sin(2 * Math.PI * 180 * k / sr));
      }
    }
  }
  return toBuffer(c, normalize(loopify(y, sr), .6));
}
// frogs: low throaty croaks, each a quick train of pulses
export function frogSample(c, secs = 7) {
  const sr = c.sampleRate, n = Math.floor(sr * secs) + Math.floor(sr * .06), R = rngS(53), x = new Float32Array(n);
  for (let t = R() * .5; t < secs; t += .25 + R() * 1.1) {
    const f0 = 210 + R() * 160, pulses = 6 + (R() * 9 | 0), rate = 18 + R() * 14, amp = .3 + R() * .7;
    for (let q = 0; q < pulses; q++) {
      const s0 = Math.floor((t + q / rate) * sr), len = Math.floor(sr * .022);
      let ph = 0;
      for (let k = 0; k < len && s0 + k < n; k++) { ph += 2 * Math.PI * f0 / sr; x[s0 + k] += (Math.sin(ph) + .5 * Math.sin(ph * 2) + .3 * Math.sin(ph * 3)) * Math.sin(Math.PI * k / len) * amp; }
    }
  }
  const y = new Float32Array(n); filt(x, biquad('bp', 500, .9, sr), 1, y); filt(x, biquad('lp', 300, .7, sr), .6, y);
  return toBuffer(c, normalize(loopify(y, sr), .7));
}

export class Sound {
  constructor() { this.c = null; this.muted = false; this.voices = new Map(); this.t = 0; this.nextBird = 4; }
  get ready() { return !!this.c; }
  start() {
    if (this.c) { if (this.c.state === 'suspended') this.c.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    let c; try { c = this.c = new AC(); } catch (e) { return; }
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : .9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = .01; comp.release.value = .25;
    this.master.connect(comp).connect(c.destination);
    this.bus = c.createGain(); this.bus.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = .7; this.amb.connect(this.master);
    this.white = noiseBuffer(c, 2, 'white'); this.brown = noiseBuffer(c, 3, 'brown'); this.pink = noiseBuffer(c, 3, 'pink');
    this.crackle = crackleBuffer(c, 2, .004); this.crackleDense = crackleBuffer(c, 2, .02);
    this.clanks = [180, 210, 240, 165].map(f => clankBuffer(c, f));
    this.pourSoil = pourSample(c, false); this.pourGravel = pourSample(c, true); this.stream = streamSample(c);
    this.crickets = cricketSample(c); this.frogs = frogSample(c);
    this.engBufs = {};
    this.ambient();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : .9, this.c.currentTime, .05); }
  pause(p) { if (!this.c) return; if (p) this.c.suspend(); else this.c.resume(); }

  loop(buf, rate = 1) { const s = this.c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.loopStart = Math.random(); s.start(0, Math.random() * buf.duration); return s; }
  filt(type, f, q = .7) { const b = this.c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.c.createGain(); g.gain.value = v; return g; }
  panner(ref = 7) {
    const p = this.c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = 1.15; p.maxDistance = 600; return p;
  }
  setPos(p, x, y, z) {
    if (p.positionX) { const t = this.c.currentTime; p.positionX.setTargetAtTime(x, t, .02); p.positionY.setTargetAtTime(y, t, .02); p.positionZ.setTargetAtTime(z, t, .02); }
    else p.setPosition(x, y, z);
  }
  listener(cam) {
    if (!this.c) return;
    const L = this.c.listener, t = this.c.currentTime, p = cam.position;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone())), u = cam.up;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, .02); L.positionY.setTargetAtTime(p.y, t, .02); L.positionZ.setTargetAtTime(p.z, t, .02);
      L.forwardX.setTargetAtTime(f.x, t, .02); L.forwardY.setTargetAtTime(f.y, t, .02); L.forwardZ.setTargetAtTime(f.z, t, .02);
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // ------------------------------------------------ a machine's voice
  machine(id, cfg) {
    if (!this.c || this.voices.has(id)) return this.voices.get(id);
    const c = this.c, v = { cfg, rpm: cfg.idle, boost: 0, clankPhase: 0 };
    const key = cfg.cyl + ':' + cfg.tone;
    if (!this.engBufs[key]) {
      const res = [cfg.tone * .34, cfg.tone * .86, cfg.tone * 1.72], seed = Math.round(cfg.tone);
      this.engBufs[key] = [engineSample(c, { res, seed, cyl: cfg.cyl, load: 0 }), engineSample(c, { res, seed, cyl: cfg.cyl, load: 1 })];
    }
    const [bi, bl] = this.engBufs[key];
    v.pan = this.panner(9); v.pan.connect(this.bus);
    v.out = this.gain(0); v.out.connect(v.pan);
    v.lp = this.filt('lowpass', 1200, .7); v.lp.connect(v.out);
    const src = buf => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * buf.duration); return s; };
    v.sI = src(bi); v.gI = this.gain(1); v.sI.connect(v.gI).connect(v.lp);
    v.sL = src(bl); v.gL = this.gain(0); v.sL.connect(v.gL).connect(v.lp);
    // turbo whistle
    v.tb = c.createOscillator(); v.tb.type = 'sine'; v.tbG = this.gain(0); v.tb.connect(v.tbG).connect(v.out);
    // hydraulic pump (its pitch follows the engine) and the hiss of oil through the valves
    v.hy = c.createOscillator(); v.hy.type = 'sawtooth'; v.hyBp = this.filt('bandpass', 900, 3); v.hyG = this.gain(0);
    const hn = this.loop(this.white), hbp = this.filt('bandpass', 3500, 1.2), hnG = this.gain(.3);
    v.hy.connect(v.hyBp).connect(v.hyG); hn.connect(hbp).connect(hnG).connect(v.hyG); v.hyG.connect(v.pan);
    // digging and pouring: the grain-by-grain recordings
    const dS = src(this.pourSoil), dG = src(this.pourGravel);
    v.digG = this.gain(0); v.gravG = this.gain(0); v.pourG = this.gain(0); v.pourGG = this.gain(0);
    const dlp = this.filt('lowpass', 1100, .6);
    dS.connect(dlp).connect(v.digG).connect(v.pan); dG.connect(v.gravG).connect(v.pan);
    const pS = src(this.pourSoil), pG = src(this.pourGravel); pS.connect(v.pourG).connect(v.pan); pG.connect(v.pourGG).connect(v.pan);
    // backup beeper
    v.bp = c.createOscillator(); v.bp.type = 'square'; v.bp.frequency.value = 1180; const bpf = this.filt('bandpass', 1180, 3); v.bpG = this.gain(0); v.bp.connect(bpf).connect(v.bpG).connect(v.pan);
    for (const o of [v.tb, v.hy, v.bp]) o.start();
    this.voices.set(id, v);
    return v;
  }
  // s: {x,y,z, rpm (0..1), load (0..1), hyd (0..1), hydLoad, dig (m³/s), gravel (0..1), pour (m³/s), track (m/s, 0 if wheeled), reverse, active}
  updateMachine(id, s, dt) {
    const v = this.voices.get(id); if (!v) return;
    for (const key in s) if (typeof s[key] === 'number' && !Number.isFinite(s[key])) { (window.__badSound ||= new Set()).add(key); s[key] = 0; }
    const c = this.c, t = c.currentTime, cfg = v.cfg, T = (p, x, k = .08) => { if (Number.isFinite(x)) p.setTargetAtTime(x, t, k); };
    const target = cfg.idle + (cfg.max - cfg.idle) * s.rpm;
    v.rpm += (target - v.rpm) * Math.min(1, dt * (target > v.rpm ? 2.4 : 1.5));
    v.boost += (s.load * s.rpm - v.boost) * Math.min(1, dt * 1.4);
    const rf = (v.rpm - cfg.idle) / (cfg.max - cfg.idle), rate = v.rpm / 1200;
    T(v.sI.playbackRate, rate, .05); T(v.sL.playbackRate, rate, .05);
    const lvl = cfg.vol * (s.active ? 1 : .55);
    const ld = Math.min(1, s.load * 1.15);
    T(v.gI.gain, (1 - ld) * (.75 + rf * .3)); T(v.gL.gain, ld * (.85 + rf * .3));
    T(v.lp.frequency, 700 + rf * 1600 + s.load * 2600);
    T(v.out.gain, lvl * (.55 + s.load * .35 + rf * .25), .1);
    T(v.tb.frequency, 1800 + v.boost * 5200, .25); T(v.tbG.gain, (.002 + v.boost * .012) * cfg.vol, .25);
    T(v.hy.frequency, v.rpm / 60 * 9 * (1 - s.hydLoad * .08)); T(v.hyBp.frequency, 600 + s.hyd * 700 + s.hydLoad * 500);
    T(v.hyG.gain, (s.hyd * .045 + s.hydLoad * .04) * cfg.vol * 2, .06);
    const dig = Math.min(1, s.dig * .35);
    T(v.digG.gain, dig * (1 - s.gravel) * .9, .05); T(v.gravG.gain, dig * s.gravel * .7, .05);
    const pr = Math.min(1, s.pour * .2);
    T(v.pourG.gain, pr * (1 - s.gravel) * .9, .08); T(v.pourGG.gain, pr * s.gravel * .7, .08);
    const on = s.reverse && (Math.floor(t * 2) % 2 === 0);
    T(v.bpG.gain, on ? .07 : 0, .006);
    this.setPos(v.pan, s.x, s.y, s.z);
    if (s.track > .05) {
      v.clankPhase += s.track * dt / .27;
      let n = 0;
      while (v.clankPhase >= 1 && n < 3) { v.clankPhase -= 1; n++; this.clank(v, Math.min(1, .35 + s.track * .25)); }
      if (v.clankPhase > 1) v.clankPhase = 0;
    }
  }
  clank(v, amp) {
    const s = this.c.createBufferSource(); s.buffer = this.clanks[Math.random() * 4 | 0]; s.playbackRate.value = .85 + Math.random() * .3;
    const g = this.gain(amp * .16); s.connect(g).connect(v.pan); s.start();
  }

  // ------------------------------------------------ one-shots
  at(x, y, z, ref = 8) { const p = this.panner(ref); if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); p.connect(this.bus); return p; }
  burst(buf, dest, { gain = .5, attack = .01, decay = .5, type = 'lowpass', f = 600, q = .7, rate = 1, dur } = {}) {
    const c = this.c, t = c.currentTime, s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    const fl = this.filt(type, f, q), g = this.gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + attack, decay / 3);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + (dur || attack + decay * 2.5));
    return fl;
  }
  slice(buf, dest, gain, dur, rate = 1) {
    const c = this.c, t = c.currentTime, src = c.createBufferSource(), g = this.gain(0);
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .03); g.gain.setTargetAtTime(0, t + dur * .6, dur * .25);
    src.connect(g).connect(dest); src.start(t, Math.random() * (buf.duration - dur - .1)); src.stop(t + dur + .3);
  }
  dump(x, y, z, vol, gravel) {
    if (!this.c) return;
    const p = this.at(x, y, z, 10), k = Math.min(1, .35 + vol * .22), dur = .5 + Math.min(1.2, vol * .3);
    this.slice(gravel ? this.pourGravel : this.pourSoil, p, .9 * k, dur, .9 + Math.random() * .2);
    this.burst(this.brown, p, { gain: .8 * k, attack: .03, decay: .35 + vol * .1, f: 180 });
  }
  scoop(x, y, z, gravel) {
    if (!this.c) return;
    const p = this.at(x, y, z, 8);
    this.slice(gravel ? this.pourGravel : this.pourSoil, p, .7, .45, .8);
    this.burst(this.brown, p, { gain: .5, attack: .02, decay: .3, f: 300 });
  }
  clang(x, y, z, f0 = 140, amp = .4) {
    if (!this.c) return;
    const c = this.c, t = c.currentTime, p = this.at(x, y, z, 8);
    for (const [m, a, d] of [[1, 1, .9], [2.76, .6, .6], [5.4, .4, .35], [8.93, .25, .22]]) {
      const o = c.createOscillator(); o.frequency.value = f0 * m * (1 + (Math.random() - .5) * .02);
      const g = this.gain(0); g.gain.setValueAtTime(amp * a * .25, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(p); o.start(t); o.stop(t + d + .05);
    }
    this.burst(this.white, p, { gain: amp * .5, attack: .002, decay: .06, type: 'highpass', f: 2000 });
  }
  treeFall(x, y, z) {
    if (!this.c) return;
    const c = this.c, t = c.currentTime, p = this.at(x, y, z, 12);
    this.burst(this.white, p, { gain: .7, attack: .002, decay: .08, type: 'highpass', f: 2500 });
    this.burst(this.crackle, p, { gain: .8, attack: .01, decay: .8, type: 'bandpass', f: 1800, q: .6 });
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t + .1); o.frequency.exponentialRampToValueAtTime(55, t + 1.1);
    const bp = this.filt('bandpass', 380, 4), g = this.gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .3); g.gain.linearRampToValueAtTime(0, t + 1.1);
    o.connect(bp).connect(g).connect(p); o.start(t); o.stop(t + 1.2);
    this.burst(this.white, p, { gain: .25, attack: .4, decay: .8, type: 'bandpass', f: 3500, q: .5, dur: 1.6 });
    setTimeout(() => {
      if (!this.c) return; const t2 = this.c.currentTime;
      const th = this.c.createOscillator(); th.frequency.setValueAtTime(70, t2); th.frequency.exponentialRampToValueAtTime(32, t2 + .4);
      const tg = this.gain(0); tg.gain.setValueAtTime(.5, t2); tg.gain.exponentialRampToValueAtTime(.001, t2 + .5); th.connect(tg).connect(p); th.start(t2); th.stop(t2 + .55);
      this.burst(this.brown, p, { gain: .9, attack: .01, decay: .45, f: 300 });
      this.burst(this.crackle, p, { gain: .5, attack: .01, decay: .5, type: 'highpass', f: 1500 });
    }, 1250);
  }
  splash(x, y, z, amt = 1) {
    if (!this.c) return;
    const p = this.at(x, y, z, 8);
    this.burst(this.white, p, { gain: .35 * amt, attack: .01, decay: .35, type: 'bandpass', f: 1400, q: .7 });
    this.burst(this.pink, p, { gain: .3 * amt, attack: .02, decay: .5, f: 500 });
  }
  chime() {
    if (!this.c) return;
    const c = this.c, t = c.currentTime;
    [784, 988, 1175].forEach((f, i) => {
      for (const [m, a] of [[1, .14], [2, .05], [3, .02]]) {
        const o = c.createOscillator(); o.frequency.value = f * m; const g = this.gain(0);
        g.gain.setValueAtTime(0, t + i * .12); g.gain.linearRampToValueAtTime(a, t + i * .12 + .01); g.gain.exponentialRampToValueAtTime(.0001, t + i * .12 + 1.4);
        o.connect(g).connect(this.master); o.start(t + i * .12); o.stop(t + i * .12 + 1.5);
      }
    });
  }

  // ------------------------------------------------ the valley around you
  ambient() {
    const c = this.c;
    const w = this.loop(this.brown, .9), wl = this.filt('lowpass', 380, .4); this.windG = this.gain(.05); w.connect(wl).connect(this.windG).connect(this.amb);
    const lv = this.loop(this.white), lb = this.filt('bandpass', 3800, .6); this.leafG = this.gain(.008); lv.connect(lb).connect(this.leafG).connect(this.amb);
    this.riverPan = this.panner(14); this.riverPan.connect(this.amb);
    const r1 = this.loop(this.stream), rh = this.filt('highpass', 150, .5); this.riverG = this.gain(0);
    r1.connect(rh).connect(this.riverG).connect(this.riverPan);
    const r2 = this.loop(this.stream, .73), rl = this.filt('lowpass', 900, .5); this.bubbleG = this.gain(0); r2.connect(rl).connect(this.bubbleG).connect(this.riverPan);
    // insects all around you; frogs by the marsh and along the water
    const cr = this.loop(this.crickets); this.cricketG = this.gain(.02); cr.connect(this.cricketG).connect(this.amb);
    const cr2 = this.loop(this.crickets, .93); const cg2 = this.gain(.012); cr2.connect(cg2).connect(this.amb);
    this.frogPan = this.panner(10); this.frogPan.connect(this.amb);
    const fr = this.loop(this.frogs); this.frogG = this.gain(0); fr.connect(this.frogG).connect(this.frogPan);
    this.riverFrogPan = this.panner(8); this.riverFrogPan.connect(this.amb);
    const fr2 = this.loop(this.frogs, 1.12); this.riverFrogG = this.gain(0); fr2.connect(this.riverFrogG).connect(this.riverFrogPan);
    this.nextWood = 12 + Math.random() * 20; this.nextCrow = 20 + Math.random() * 25; this.nextDove = 30 + Math.random() * 30;
  }
  // river: {x,y,z, amount 0..1}, wind 0..1
  updateAmbient(dt, cam, river, marsh) {
    if (!this.c) return;
    const t = this.c.currentTime;
    this.t += dt;
    const gust = .5 + .5 * Math.sin(this.t * .13) * Math.sin(this.t * .051 + 1);
    this.windG.gain.setTargetAtTime(.025 + gust * .05, t, .5);
    this.leafG.gain.setTargetAtTime(.004 + gust * .012, t, .5);
    if (river) {
      this.setPos(this.riverPan, river.x, river.y, river.z);
      this.riverG.gain.setTargetAtTime(river.amount * .35, t, .3);
      this.bubbleG.gain.setTargetAtTime(river.amount * .25, t, .3);
    }
    this.cricketG.gain.setTargetAtTime(.012 + (1 - gust) * .02, t, 1);
    if (marsh) { this.setPos(this.frogPan, marsh.x, marsh.y, marsh.z); this.frogG.gain.setTargetAtTime(marsh.wet ? .35 : 0, t, 1); }
    if (river) { this.setPos(this.riverFrogPan, river.x + 6, river.y, river.z - 4); this.riverFrogG.gain.setTargetAtTime(river.amount * .12, t, 1); }
    this.nextBird -= dt;
    if (this.nextBird <= 0) { this.nextBird = 1.5 + Math.random() * 5; this.bird(cam); }
    this.nextWood -= dt; if (this.nextWood <= 0) { this.nextWood = 18 + Math.random() * 30; this.woodpecker(cam); }
    this.nextCrow -= dt; if (this.nextCrow <= 0) { this.nextCrow = 25 + Math.random() * 40; this.crow(cam); }
    this.nextDove -= dt; if (this.nextDove <= 0) { this.nextDove = 30 + Math.random() * 45; this.dove(cam); }
  }
  around(cam, d0, d1, up = 6) {
    const a = Math.random() * Math.PI * 2, d = d0 + Math.random() * (d1 - d0);
    return this.at(cam.position.x + Math.cos(a) * d, cam.position.y + up + Math.random() * 8, cam.position.z + Math.sin(a) * d, 12);
  }
  woodpecker(cam) {
    const c = this.c, t = c.currentTime + .05, p = this.around(cam, 30, 70), n = 12 + (Math.random() * 10 | 0), rate = 16 + Math.random() * 6;
    for (let i = 0; i < n; i++) {
      const s = c.createBufferSource(); s.buffer = this.white;
      const bp = this.filt('bandpass', 1100 + Math.random() * 200, 4), g = this.gain(0), st = t + i / rate, a = .5 * (1 - i / n * .6);
      g.gain.setValueAtTime(a, st); g.gain.exponentialRampToValueAtTime(.0001, st + .012);
      s.connect(bp).connect(g).connect(p); s.start(st, Math.random()); s.stop(st + .02);
    }
  }
  crow(cam) {
    const c = this.c, t = c.currentTime + .05, p = this.around(cam, 40, 90, 12), caws = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < caws; i++) {
      const st = t + i * (.42 + Math.random() * .1), o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(560, st); o.frequency.linearRampToValueAtTime(700, st + .06); o.frequency.linearRampToValueAtTime(480, st + .3);
      const f1 = this.filt('bandpass', 1000, 2.5), f2 = this.filt('bandpass', 2300, 3), g = this.gain(0);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(.18, st + .03); g.gain.setTargetAtTime(0, st + .2, .05);
      o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(p); o.start(st); o.stop(st + .45);
      this.burst(this.white, p, { gain: .08, attack: .02, decay: .2, type: 'bandpass', f: 1500, q: 1 });
    }
  }
  dove(cam) {
    const c = this.c, t = c.currentTime + .05, p = this.around(cam, 25, 60, 8);
    [[0, 520, .35], [.45, 560, .5], [1.05, 470, .45], [1.6, 470, .45]].forEach(([d, f, len]) => {
      const o = c.createOscillator(), g = this.gain(0), st = t + d;
      o.frequency.setValueAtTime(f, st); o.frequency.linearRampToValueAtTime(f * .93, st + len);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(.09, st + .08); g.gain.linearRampToValueAtTime(0, st + len);
      o.connect(g).connect(p); o.start(st); o.stop(st + len + .05);
    });
  }
  bird(cam) {
    const c = this.c, t = c.currentTime + .05;
    const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 50;
    const p = this.at(cam.position.x + Math.cos(a) * d, cam.position.y + 6 + Math.random() * 8, cam.position.z + Math.sin(a) * d, 10);
    const kind = Math.random(), notes = kind > .8 ? 10 + (Math.random() * 10 | 0) : 2 + (Math.random() * 5 | 0), base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator(), g = this.gain(0), st = t + i * (kind < .5 ? .09 : .16), len = kind < .5 ? .06 : .12;
      const f0 = base * (kind < .5 ? 1 + (i % 2) * .18 : 1 + Math.random() * .25);
      o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * (kind < .5 ? 1.25 : .78), st + len);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(.05, st + .01); g.gain.exponentialRampToValueAtTime(.0001, st + len);
      o.connect(g).connect(p); o.start(st); o.stop(st + len + .02);
    }
  }
}
