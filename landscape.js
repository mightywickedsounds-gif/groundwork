// Landscaping (boss order LANDSCAPE, with the crew on): three groundskeepers on foot walk out from the yard and finish a
// round patch of ground, 8 m across the middle:
//  1. FINISH GRADE: they rake it smooth. Each pull moves soil from the bumps into the dips beside them, so nothing is
//     lost or added; the edge blends into the ground round it.
//  2. SEED: they walk it scattering grass seed. Seeded soil greens over and turns back into meadow in a minute and a
//     half (game time); digging or burying it, or flooding it, stops that (game.js, growSeed).
//  3. PLANT: they kneel and plant saplings (real trees that grow to full size), bushes and wild flowers round it.
// Then the job pays and they walk back to the yard. A job in progress saves as a few numbers.
export function makeLandscape(G) {
  const { clamp } = G;
  const N = 256, R = 8;
  let job = null, on = false;
  const crew = [];

  function cells(cx, cz, r, fn) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
      const d = Math.hypot(x - cx, z - cz); if (d <= r) fn(z * N + x, d, x, z);
    }
  }
  // ground the crew works: dry, not a gravel pad or road
  const workable = k => G.W[k] < .03 && G.M[k] !== 2;
  // how bumpy the patch is (average height difference from the neighbours, metres)
  function rough(S) {
    let s = 0, n = 0;
    cells(S.x, S.z, R - 1, k => { if (!workable(k)) return; const H = G.H; s += Math.abs((H[k - 1] + H[k + 1] + H[k - N] + H[k + N]) * .25 - H[k]); n++; });
    return n ? s / n : 0;
  }
  // the rakes: soil slides from each cell to its lower neighbours, a little at a time (the total stays the same)
  function rakeAt(S, x, z, r, rate) {
    const H = G.H;
    cells(x, z, r, k => {
      if (!workable(k) || Math.hypot((k % N) - S.x, ((k / N) | 0) - S.z) > R) return;
      for (const o of [1, N]) {
        const b = k + o; if (!workable(b)) continue;
        const f = (H[k] - H[b]) * rate; if (Math.abs(f) < 1e-5) continue;
        H[k] -= f; H[b] += f; G.dirty(b);
      }
      G.D[k] = 1; G.M[k] = 1; G.dirty(k);
    });
  }
  // what goes in, chosen from the spot's own numbers: saplings round the outside, bushes, then flowers inside
  function plan(x, z) {
    let s = (Math.floor(x * 73 + z * 151) % 2147483646) + 1;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const items = [], a0 = r() * 6.28;
    for (let i = 0; i < 3; i++) { const a = a0 + i * 2.09 + (r() - .5) * .5, d = R * (.72 + r() * .15); items.push({ kind: 'tree', x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: .55 + r() * .35 }); }
    for (let i = 0; i < 5; i++) { const a = a0 + 1 + i * 1.26 + (r() - .5) * .4, d = R * (.45 + r() * .3); items.push({ kind: 'bush', x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: .9 + r() * .6 }); }
    for (let i = 0; i < 7; i++) { const a = r() * 6.28, d = R * Math.sqrt(r()) * .45; items.push({ kind: 'flower', x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: .32 + r() * .14, c: 2 + (r() * 3 | 0) }); }
    return items;
  }
  function begin(x, z) {
    let wet = 0, n = 0;
    cells(x, z, R, k => { n++; if (!workable(k)) wet++; });
    if (!n || wet > n * .35) return 'NOT HERE: WATER OR GRAVEL';
    job = { x: +x.toFixed(2), z: +z.toFixed(2), phase: 'grade', t: 0, r0: 0, done: 0 };
    job.r0 = rough(job); job.items = plan(job.x, job.z);
    G.toast('Landscaping', 2400);
    return '';
  }
  function setPhase(ph) { job.phase = ph; job.t = 0; for (const p of crew) { p.lt = null; p.task = null; } }

  // ------------------------------------------------------------ each groundskeeper
  const K = () => G.kit;
  function addCrew() {
    for (let i = 0; i < 3; i++) {
      const p = K().addPerson('framer', 20 + i);
      p.x = G.YARD.x0 + 3 + i; p.z = G.YARD.z1 - 3; crew.push(p);
    }
  }
  function grader(p, dt, i) {
    K().hold(p, 'rake');
    if (!p.lt || p.lt.t > 4) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * R * .85; p.lt = { x: job.x + Math.cos(a) * d, z: job.z + Math.sin(a) * d, t: 0 }; }
    if (!K().walk(p, p.lt.x, p.lt.z, dt, .5)) return;
    p.lt.t += dt; p.pose = 'rake'; p.ph += dt * 3;
    const fx = p.x + Math.sin(p.yaw) * 1.2, fz = p.z + Math.cos(p.yaw) * 1.2;
    rakeAt(job, fx, fz, 1.7, Math.min(.2, dt * .5));
    if (Math.random() < dt * 4) G.spawn('dust', fx, G.hAt(fx, fz) + .2, fz, 1, [.45, .38, .28], { jitter: .8, size: .4, alpha: .35 });
  }
  function seeder(p, dt, i) {
    K().hold(p, null);
    if (!p.lt || K().walk(p, p.lt.x, p.lt.z, dt, .6)) {
      // walk to the part of the patch with the least seed yet
      let best = null;
      for (let q = 0; q < 10; q++) {
        const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * R * .9, x = job.x + Math.cos(a) * d, z = job.z + Math.sin(a) * d;
        let bare = 0; cells(x, z, 2, k => { if (workable(k) && G.canSeed(k)) bare++; });
        if (!best || bare > best.b) best = { x, z, b: bare };
      }
      p.lt = best;
    }
    p.pose = p.pose === 'walk' ? 'walk' : 'point'; p.ph += dt;
    // a handful thrown every step or so, to the side
    if ((p.st2 = (p.st2 || 0) - dt) <= 0) {
      p.st2 = .5;
      cells(p.x, p.z, 2.3, k => { if (Math.hypot((k % N) - job.x, ((k / N) | 0) - job.z) <= R) G.seedCell(k); });
      const sx = p.x + Math.cos(p.yaw) * .4, sz = p.z - Math.sin(p.yaw) * .4;
      G.spawn('grain', sx, G.hAt(sx, sz) + 1.1, sz, 6, [.78, .72, .5], { jitter: .3, size: .35, up: 1, vx: Math.cos(p.yaw) * 1.5, vz: -Math.sin(p.yaw) * 1.5 });
    }
  }
  function planter(p, dt) {
    if (!p.task) {
      const it = job.items.find(q => !q.claimed && !q.in);
      if (!it) { K().hold(p, null); p.pose = 'idle'; p.ph += dt; return; }
      it.claimed = true; p.task = { it, t: 0 };
    }
    const it = p.task.it;
    K().hold(p, 'shovel');
    if (!K().walk(p, it.x - .9, it.z - .3, dt, .5)) return;
    K().face(p, it.x, it.z, dt);
    p.task.t += dt; p.pose = p.task.t < 2 ? 'rake' : 'kneel'; p.ph += dt * 3;
    if (p.task.t > 4) {
      it.in = true; job.done++;
      G.plant(it.kind, it.x, it.z, it.s, it.c);
      G.spawn('dust', it.x, G.hAt(it.x, it.z) + .2, it.z, 3, [.4, .32, .22], { jitter: .5, size: .5, alpha: .4 });
      p.task = null;
    }
  }

  function update(dt) {
    if (!on || !job) {
      for (const p of crew) { p.f.root.visible = false; }
      return;
    }
    if (!crew.length) addCrew();
    job.t += dt;
    if (job.phase === 'grade') {
      if ((job.ct = (job.ct || 0) - dt) <= 0) { job.ct = 2; job.rn = rough(job); }
      if (job.t > 8 && (job.rn < Math.max(.012, job.r0 * .4) || job.t > 75)) { setPhase('seed'); G.toast('Landscaping: seeding', 2000); }
    } else if (job.phase === 'seed') {
      if ((job.ct = (job.ct || 0) - dt) <= 0) {
        job.ct = 2; let n = 0, bare = 0;
        cells(job.x, job.z, R, k => { if (!workable(k)) return; n++; if (G.canSeed(k)) bare++; });
        if (bare <= n * .04 || job.t > 70) { cells(job.x, job.z, R, k => G.seedCell(k)); setPhase('plant'); G.toast('Landscaping: planting', 2000); }
      }
    } else if (job.phase === 'plant') {
      if (job.items.every(q => q.in)) { G.landscaped(job); job = null; for (const p of crew) { p.f.root.visible = false; K().hold(p, null); } return; }
    }
    crew.forEach((p, i) => {
      p.f.root.visible = true;
      if (job.phase === 'grade') grader(p, dt, i);
      else if (job.phase === 'seed') seeder(p, dt, i);
      else planter(p, dt);
      p.y = K().standY(p);
      K().animate(p, dt);
    });
  }
  return {
    update,
    setOn(v) { on = !!v; if (!on) for (const p of crew) p.f.root.visible = false; },
    get job() { return job; }, get people() { return crew; },
    orderAt(x, z) { if (!on) return 'CREW IS OFF'; if (job) return 'GROUNDS CREW IS BUSY'; return begin(x, z); },
    cancel() { job = null; for (const p of crew) p.f.root.visible = false; },
    doing() {
      if (!on) return 'OFF'; if (!job) return 'WAITING';
      return { grade: 'RAKING', seed: 'SEEDING', plant: 'PLANTING ' + job.done + '/' + job.items.length }[job.phase];
    },
    rough: () => job ? rough(job) : 0,
    serialize() { return job ? { x: job.x, z: job.z, phase: job.phase, r0: job.r0, inn: job.items.map(q => q.in ? 1 : 0) } : null; },
    restore(d) {
      if (!d) return;
      job = { x: d.x, z: d.z, phase: d.phase, t: 0, r0: d.r0 || 0, done: 0 };
      job.items = plan(job.x, job.z);
      (d.inn || []).forEach((v, i) => { if (v && job.items[i]) { job.items[i].in = true; job.done++; } });
    },
  };
}
