// Groundwork sound: everything is synthesized live with the Web Audio API (no sound files).
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
    this.wave = dieselWave(c);
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
    const c = this.c, v = { cfg, rpm: cfg.idle, boost: 0, clankPhase: 0, beep: false };
    v.pan = this.panner(9); v.pan.connect(this.bus);
    v.out = this.gain(0); v.out.connect(v.pan);
    // combustion: two slightly detuned pulse trains plus a sub rumble, driven into a soft clipper and a lowpass
    v.o1 = c.createOscillator(); v.o1.setPeriodicWave(this.wave);
    v.o2 = c.createOscillator(); v.o2.setPeriodicWave(this.wave); v.o2.detune.value = 9;
    v.sub = c.createOscillator(); v.sub.type = 'triangle';
    const mix = this.gain(.45), subG = this.gain(.5);
    v.o1.connect(mix); v.o2.connect(mix); v.sub.connect(subG).connect(mix);
    const sh = c.createWaveShaper(); sh.curve = softClip(2.4); sh.oversample = '2x';
    v.lp = this.filt('lowpass', 400, .9);
    const body = this.filt('peaking', 140, 1.2); body.gain.value = 5;
    mix.connect(sh).connect(v.lp).connect(body).connect(v.out);
    // injector/valve clatter: noise opened and shut by the firing pulses
    const nz = this.loop(this.white), bp = this.filt('bandpass', 1500, .9);
    v.gate = this.gain(.5); const mod = this.gain(.5); v.o1.connect(mod).connect(v.gate.gain);
    v.clat = this.gain(.05); nz.connect(bp).connect(v.gate).connect(v.clat).connect(v.out);
    // turbo whistle
    v.tb = c.createOscillator(); v.tb.type = 'sine'; v.tbG = this.gain(0); v.tb.connect(v.tbG).connect(v.out);
    // exhaust breath
    const ex = this.loop(this.brown); v.exLp = this.filt('lowpass', 140, .5); v.exG = this.gain(.2); ex.connect(v.exLp).connect(v.exG).connect(v.out);
    // hydraulics: pump whine + fluid hiss (not scaled by engine level)
    v.hy = c.createOscillator(); v.hy.type = 'sawtooth'; v.hyBp = this.filt('bandpass', 900, 5); v.hyG = this.gain(0);
    const hn = this.loop(this.white), hbp = this.filt('bandpass', 3200, 1.5), hnG = this.gain(.25);
    v.hy.connect(v.hyBp).connect(v.hyG); hn.connect(hbp).connect(hnG).connect(v.hyG); v.hyG.connect(v.pan);
    // digging / scraping: brown noise thump + gravel crackle
    const dn = this.loop(this.brown), dbp = this.filt('bandpass', 380, .6); v.digG = this.gain(0); dn.connect(dbp).connect(v.digG).connect(v.pan);
    const dc = this.loop(this.crackleDense, .8), dhp = this.filt('highpass', 900); v.gravG = this.gain(0); dc.connect(dhp).connect(v.gravG).connect(v.pan);
    // pouring (hauler bed / bucket stream)
    const pn = this.loop(this.pink), plp = this.filt('lowpass', 700); v.pourG = this.gain(0); pn.connect(plp).connect(v.pourG).connect(v.pan);
    // backup beeper
    v.bp = c.createOscillator(); v.bp.type = 'square'; v.bp.frequency.value = 1180; const bpf = this.filt('bandpass', 1180, 3); v.bpG = this.gain(0); v.bp.connect(bpf).connect(v.bpG).connect(v.pan);
    for (const o of [v.o1, v.o2, v.sub, v.tb, v.hy, v.bp]) o.start();
    this.voices.set(id, v);
    return v;
  }
  // s: {x,y,z, rpm (0..1), load (0..1), hyd (0..1), hydLoad, dig (m³/s), gravel (0..1), pour (m³/s), track (m/s, 0 if wheeled), reverse, active}
  updateMachine(id, s, dt) {
    const v = this.voices.get(id); if (!v) return;
    for (const key in s) if (typeof s[key] === 'number' && !Number.isFinite(s[key])) { (window.__badSound ||= new Set()).add(key); s[key] = 0; }
    const c = this.c, t = c.currentTime, cfg = v.cfg, T = (p, x, k = .08) => { if (Number.isFinite(x)) p.setTargetAtTime(x, t, k); };
    const target = cfg.idle + (cfg.max - cfg.idle) * s.rpm;
    v.rpm += (target - v.rpm) * Math.min(1, dt * (target > v.rpm ? 2.6 : 1.6));
    v.boost += (s.load * s.rpm - v.boost) * Math.min(1, dt * 1.5);
    const f = v.rpm / 60 * cfg.cyl / 2;
    T(v.o1.frequency, f, .03); T(v.o2.frequency, f, .03); T(v.sub.frequency, f / cfg.cyl * 1.0, .03);
    T(v.lp.frequency, cfg.tone + s.load * 1300 + (v.rpm - cfg.idle) / (cfg.max - cfg.idle) * 700);
    T(v.tb.frequency, 1700 + v.boost * 4800, .2); T(v.tbG.gain, .004 + v.boost * .018, .2);
    T(v.exG.gain, .1 + s.load * .4); T(v.exLp.frequency, 110 + s.load * 260);
    T(v.clat.gain, .03 + (v.rpm - cfg.idle) / (cfg.max - cfg.idle) * .06);
    const lvl = cfg.vol * (s.active ? 1 : .55) * (.5 + s.load * .5);
    T(v.out.gain, lvl, .1);
    T(v.hy.frequency, 120 + s.hyd * 110 + s.hydLoad * 90); T(v.hyBp.frequency, 700 + s.hyd * 900 + s.hydLoad * 500);
    T(v.hyG.gain, (s.hyd * .05 + s.hydLoad * .05) * cfg.vol, .06);
    T(v.digG.gain, Math.min(.7, s.dig * .25) * (1 - s.gravel * .5), .05);
    T(v.gravG.gain, Math.min(.5, s.dig * .25 + s.pour * .1) * s.gravel, .05);
    T(v.pourG.gain, Math.min(.5, s.pour * .12), .1);
    // backup beeper: half a second on, half off
    const on = s.reverse && (Math.floor(t * 2) % 2 === 0);
    T(v.bpG.gain, on ? .07 : 0, .006);
    this.setPos(v.pan, s.x, s.y, s.z);
    // track clank: one clank per shoe that rolls round the sprocket
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
  dump(x, y, z, vol, gravel) {
    if (!this.c) return;
    const p = this.at(x, y, z, 10), k = Math.min(1, .3 + vol * .25);
    this.burst(this.brown, p, { gain: .9 * k, attack: .04, decay: .5 + vol * .2, f: 260 });
    this.burst(gravel ? this.crackleDense : this.pink, p, { gain: (gravel ? .7 : .35) * k, attack: .03, decay: .4 + vol * .15, type: gravel ? 'highpass' : 'lowpass', f: gravel ? 1200 : 900 });
  }
  scoop(x, y, z, gravel) {
    if (!this.c) return;
    const p = this.at(x, y, z, 8);
    this.burst(this.brown, p, { gain: .6, attack: .02, decay: .35, f: 420, type: 'bandpass', q: .8 });
    if (gravel) this.burst(this.crackleDense, p, { gain: .5, attack: .01, decay: .3, type: 'highpass', f: 1500 });
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
    const r1 = this.loop(this.white), rl = this.filt('lowpass', 2200, .5), rh = this.filt('highpass', 250, .5); this.riverG = this.gain(0);
    r1.connect(rl).connect(rh).connect(this.riverG).connect(this.riverPan);
    const r2 = this.loop(this.crackle, .6), rb = this.filt('bandpass', 900, 1.2); this.bubbleG = this.gain(0); r2.connect(rb).connect(this.bubbleG).connect(this.riverPan);
  }
  // river: {x,y,z, amount 0..1}, wind 0..1
  updateAmbient(dt, cam, river) {
    if (!this.c) return;
    const t = this.c.currentTime;
    this.t += dt;
    const gust = .5 + .5 * Math.sin(this.t * .13) * Math.sin(this.t * .051 + 1);
    this.windG.gain.setTargetAtTime(.025 + gust * .05, t, .5);
    this.leafG.gain.setTargetAtTime(.004 + gust * .012, t, .5);
    if (river) {
      this.setPos(this.riverPan, river.x, river.y, river.z);
      this.riverG.gain.setTargetAtTime(river.amount * .16, t, .3);
      this.bubbleG.gain.setTargetAtTime(river.amount * .25, t, .3);
    }
    this.nextBird -= dt;
    if (this.nextBird <= 0) { this.nextBird = 2 + Math.random() * 7; this.bird(cam); }
  }
  bird(cam) {
    const c = this.c, t = c.currentTime + .05;
    const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 50;
    const p = this.at(cam.position.x + Math.cos(a) * d, cam.position.y + 6 + Math.random() * 8, cam.position.z + Math.sin(a) * d, 10);
    const kind = Math.random(), notes = 2 + (Math.random() * 5 | 0), base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator(), g = this.gain(0), st = t + i * (kind < .5 ? .09 : .16), len = kind < .5 ? .06 : .12;
      const f0 = base * (kind < .5 ? 1 + (i % 2) * .18 : 1 + Math.random() * .25);
      o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * (kind < .5 ? 1.25 : .78), st + len);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(.05, st + .01); g.gain.exponentialRampToValueAtTime(.0001, st + len);
      o.connect(g).connect(p); o.start(st); o.stop(st + len + .02);
    }
  }
}
