// The city: street plan, buildings, growth and the trips people make. No drawing here.
import { rng, closestOnPoly } from './net.js';

export const BLOCK = 100;          // street grid spacing (m)
export const CHUNK = 3;            // blocks per district side
export const SPAN = 3;             // districts out from the centre each way (7 x 7 districts)
export const DAY = 480;            // seconds of game time per day at 1x
const SETBACK = 9.5;               // road centre to first building line
const ROAD_CLEAR = 6.2;            // road centre to sidewalk edge (buildings must stay outside)

const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// how busy the roads are at a given hour (0..24): morning and evening rush
export function rushCurve(h) {
  const g = (m, w) => Math.exp(-((h - m) ** 2) / (2 * w * w));
  return .14 + .95 * g(8, 1.0) + .85 * g(17.5, 1.25) + .35 * g(12.5, 2.2) + (h > 20 || h < 5 ? -.08 : 0);
}

export function createCity(net, seed = 7) {
  const C = { buildings: [], trees: [], lots: [], unlocked: [], bid: 1, seed, queue: [], ver: 0, pending: 0 };
  const lineOn = (axis, k, a) => {        // is the street on grid line k (segment index a) part of the plan?
    if (((k % CHUNK) + CHUNK) % CHUNK === 0) return true;   // district edges: avenues, always there
    return hash(axis * 7 + 3, k * 131 + a, seed) > .13;
  };
  const g0 = -BLOCK * CHUNK / 2;          // grid origin so district (0,0) is centred
  const gx = k => g0 + k * BLOCK;

  // district order: centre outwards, a little random
  const order = [];
  for (let i = -SPAN; i <= SPAN; i++) for (let j = -SPAN; j <= SPAN; j++) order.push({ i, j, r: Math.hypot(i, j) + hash(i, j, seed + 1) * .9 });
  order.sort((a, b) => a.r - b.r);
  C.order = order.map(o => [o.i, o.j]);

  const zoneOf = (x, z) => { const r = Math.hypot(x, z); return r < 230 ? 'down' : r < 560 ? 'mid' : 'sub'; };

  // does a rectangle (centre, half sizes, angle) touch any road?
  function hitsRoad(x, z, hw, hd, rot, pad = ROAD_CLEAR) {
    const c = Math.cos(rot), s = Math.sin(rot), R = Math.hypot(hw, hd) + pad + 3;
    for (const e of net.edges.values()) {
      const A = e.pts[0], B = e.pts[e.pts.length - 1];
      if (Math.min(A[0], B[0], e.cx) - R > x || Math.max(A[0], B[0], e.cx) + R < x || Math.min(A[1], B[1], e.cz) - R > z || Math.max(A[1], B[1], e.cz) + R < z) continue;
      const step = 1.5;
      for (let d = 0; d <= e.len; d += step) {
        const i = Math.min(e.pts.length - 1, Math.round(d / e.len * (e.pts.length - 1)));
        const p = e.pts[i]; const dx = p[0] - x, dz = p[1] - z;
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) < hw + pad && Math.abs(lz) < hd + pad) return true;
      }
    }
    return false;
  }

  function addBuilding(b) {
    b.id = C.bid++; C.buildings.push(b); return b;
  }

  // lay out one block: buildings around the edge, park or parking or courtyard inside
  function fillBlock(bx, bz) {
    const x0 = gx(bx), z0 = gx(bz), x1 = x0 + BLOCK, z1 = z0 + BLOCK, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const zone = zoneOf(cx, cz), r = rng((bx * 9973 + bz * 7919 + seed * 31) >>> 0);
    const roll = hash(bx, bz, seed + 5);
    const ix0 = x0 + SETBACK, ix1 = x1 - SETBACK, iz0 = z0 + SETBACK, iz1 = z1 - SETBACK;
    if (roll < (zone === 'sub' ? .07 : .1)) {        // park
      const n = 26 + (r() * 14 | 0);
      for (let i = 0; i < n; i++) C.trees.push([ix0 + 3 + r() * (ix1 - ix0 - 6), iz0 + 3 + r() * (iz1 - iz0 - 6), .8 + r() * .5, r()]);
      C.lots.push({ k: 'park', x: cx, z: cz, w: ix1 - ix0, d: iz1 - iz0 });
      return;
    }
    const D = zone === 'down' ? 30 : zone === 'mid' ? 24 : 21;
    const roadOn = { n: lineOn(0, bz, bx), s: lineOn(0, bz + 1, bx), w: lineOn(1, bx, bz), e: lineOn(1, bx + 1, bz) };
    // sides: [start, end, fixed coord, outward rotation, side key]
    const sides = [
      { k: 'n', a0: ix0, a1: ix1, f: iz0 + D / 2, rot: 0, horiz: true },
      { k: 's', a0: ix0, a1: ix1, f: iz1 - D / 2, rot: Math.PI, horiz: true },
      { k: 'w', a0: iz0 + D, a1: iz1 - D, f: ix0 + D / 2, rot: Math.PI / 2, horiz: false },
      { k: 'e', a0: iz0 + D, a1: iz1 - D, f: ix1 - D / 2, rot: -Math.PI / 2, horiz: false },
    ];
    for (const sd of sides) {
      if (!roadOn[sd.k]) { // no street here: a row of trees instead
        for (let a = sd.a0 + 4; a < sd.a1 - 2; a += 9 + r() * 4) C.trees.push(sd.horiz ? [a, sd.f + (r() - .5) * 8, .7 + r() * .4, r()] : [sd.f + (r() - .5) * 8, a, .7 + r() * .4, r()]);
        continue;
      }
      let a = sd.a0;
      while (a < sd.a1 - 6) {
        let W = zone === 'down' ? 24 + r() * 18 : zone === 'mid' ? 15 + r() * 10 : 12 + r() * 5;
        if (sd.a1 - a - W < 10) W = sd.a1 - a;
        const mid = a + W / 2;
        const x = sd.horiz ? mid : sd.f, z = sd.horiz ? sd.f : mid;
        const pad = zone === 'sub' ? 3.2 : zone === 'mid' ? 1.6 : 1.2;
        const fw = W - pad * 2, fd = D - pad * 2 - (zone === 'sub' ? 3 : 0);
        if (fw > 5) {
          const dist = Math.hypot(x, z);
          let kind, h, res = 0, jobs = 0, roof = 0;
          if (zone === 'down') { kind = r() < .78 ? 'office' : 'apt'; h = 24 + r() * r() * 95 * Math.max(.35, 1 - dist / 260); }
          else if (zone === 'mid') { kind = r() < .58 ? 'apt' : r() < .6 ? 'shop' : 'office'; h = kind === 'shop' ? 6 + r() * 4 : 11 + r() * 20; }
          else { kind = r() < .87 ? 'house' : 'shop'; h = kind === 'house' ? 6 + r() * 2.5 : 5 + r() * 2; roof = kind === 'house' ? 1 : 0; }
          const floors = Math.max(1, Math.round(h / 3.3)), area = fw * fd;
          if (kind === 'house') res = 3;
          else if (kind === 'apt') res = Math.round(area * floors / 55);
          else if (kind === 'office') jobs = Math.round(area * floors / 30);
          else jobs = Math.round(area / 25);
          if (kind === 'apt') jobs = Math.round(area / 60);   // ground floor shops
          // front of the lot faces the street: offset from the centre toward the street (yard in back for houses)
          const ox = sd.horiz ? 0 : (sd.k === 'w' ? -1 : 1), oz = sd.horiz ? (sd.k === 'n' ? -1 : 1) : 0;
          const shift = zone === 'sub' ? -1.5 : 0;
          const bxp = x + ox * shift, bzp = z + oz * shift;
          const hw = sd.horiz ? fw / 2 : fd / 2, hd = sd.horiz ? fd / 2 : fw / 2;
          if (!hitsRoad(bxp, bzp, hw, hd, 0)) {
            addBuilding({ x: +bxp.toFixed(2), z: +bzp.toFixed(2), w: +(hw * 2).toFixed(2), d: +(hd * 2).toFixed(2), h: +h.toFixed(1), kind, res, jobs, roof,
              face: sd.k, fx: +(x + ox * (D / 2 + SETBACK)).toFixed(2), fz: +(z + oz * (D / 2 + SETBACK)).toFixed(2), tone: +r().toFixed(3), chunk: 0 });
            if (zone === 'sub' && r() < .55) C.trees.push([x - ox * (D / 2 - 2) + (r() - .5) * W * .6, z - oz * (D / 2 - 2) + (r() - .5) * W * .6, .6 + r() * .35, r()]);
          }
        }
        a += W;
      }
    }
    // the middle of the block
    const mx0 = ix0 + D, mx1 = ix1 - D, mz0 = iz0 + D, mz1 = iz1 - D;
    if (mx1 - mx0 > 8 && mz1 - mz0 > 8) {
      if (zone !== 'sub' && hash(bx, bz, seed + 9) < .45) {
        C.lots.push({ k: 'parking', x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, w: mx1 - mx0 - 2, d: mz1 - mz0 - 2, fill: .35 + r() * .55, seed: r() });
      } else {
        const n = zone === 'sub' ? 3 : 6;
        for (let i = 0; i < n; i++) C.trees.push([mx0 + 2 + r() * (mx1 - mx0 - 4), mz0 + 2 + r() * (mz1 - mz0 - 4), .6 + r() * .5, r()]);
        C.lots.push({ k: 'yard', x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, w: mx1 - mx0, d: mz1 - mz0 });
      }
    }
  }

  // open a district: its streets and buildings
  C.unlock = function (i, j) {
    if (C.unlocked.some(u => u[0] === i && u[1] === j)) return false;
    C.unlocked.push([i, j]);
    const k0 = i * CHUNK, l0 = j * CHUNK;
    const sx = k => gx(k), avenue = k => ((k % CHUNK) + CHUNK) % CHUNK === 0;
    // horizontal streets (along x) on lines z = l0..l0+CHUNK
    for (let l = l0; l <= l0 + CHUNK; l++) for (let k = k0; k < k0 + CHUNK; k++) if (lineOn(0, l, k)) net.addRoad([sx(k), sx(l)], [sx(k + 1), sx(l)], null, { kind: avenue(l) ? 'avenue' : 'street' });
    for (let k = k0; k <= k0 + CHUNK; k++) for (let l = l0; l < l0 + CHUNK; l++) if (lineOn(1, k, l)) net.addRoad([sx(k), sx(l)], [sx(k), sx(l + 1)], null, { kind: avenue(k) ? 'avenue' : 'street' });
    const nb0 = C.buildings.length;
    for (let bx = k0; bx < k0 + CHUNK; bx++) for (let bz = l0; bz < l0 + CHUNK; bz++) fillBlock(bx, bz);
    for (let n = nb0; n < C.buildings.length; n++) C.buildings[n].chunk = C.unlocked.length;
    // street trees along avenues
    for (let l = l0; l <= l0 + CHUNK; l++) if (avenue(l)) for (let x = sx(k0) + 14; x < sx(k0 + CHUNK) - 10; x += 16) for (const sgn of [-1, 1]) {
      const p = [x + (hash(x | 0, l, 3) - .5) * 3, sx(l) + sgn * 7.6]; if (!treeNearBuilding(p)) C.trees.push([p[0], p[1], .55 + hash(x | 0, l, sgn + 5) * .25, hash(x | 0, l, 9)]);
    }
    for (let k = k0; k <= k0 + CHUNK; k++) if (avenue(k)) for (let z = sx(l0) + 14; z < sx(l0 + CHUNK) - 10; z += 16) for (const sgn of [-1, 1]) {
      const p = [sx(k) + sgn * 7.6, z + (hash(k, z | 0, 3) - .5) * 3]; if (!treeNearBuilding(p)) C.trees.push([p[0], p[1], .55 + hash(k, z | 0, sgn + 5) * .25, hash(k, z | 0, 9)]);
    }
    C.ver++;
    return true;
  };
  function treeNearBuilding(p) { for (let n = C.buildings.length - 1; n >= Math.max(0, C.buildings.length - 400); n--) { const b = C.buildings[n]; if (Math.abs(p[0] - b.x) < b.w / 2 + 2 && Math.abs(p[1] - b.z) < b.d / 2 + 2) return true; } return false; }
  C.nextDistrict = function () {
    for (const [i, j] of C.order) {
      if (C.unlocked.some(u => u[0] === i && u[1] === j)) continue;
      if (!C.unlocked.length || C.unlocked.some(u => Math.abs(u[0] - i) + Math.abs(u[1] - j) === 1)) return [i, j];
    }
    return null;
  };
  // woods and tree lines on districts not built yet (looks only, never saved)
  C.wild = function () {
    const out = [], S = BLOCK * CHUNK;
    for (let i = -SPAN - 1; i <= SPAN + 1; i++) for (let j = -SPAN - 1; j <= SPAN + 1; j++) {
      if (C.unlocked.some(u => u[0] === i && u[1] === j)) continue;
      const r = rng((i * 7919 + j * 104729 + C.seed * 13) >>> 0), x0 = gx(i * CHUNK), z0 = gx(j * CHUNK);
      const near = C.unlocked.some(u => Math.abs(u[0] - i) <= 1 && Math.abs(u[1] - j) <= 1);
      const clumps = 2 + (r() * 4 | 0);
      for (let k = 0; k < clumps; k++) {
        const cx = x0 + 20 + r() * (S - 40), cz = z0 + 20 + r() * (S - 40), rad = 15 + r() * 40, n = (near ? 18 : 10) + (r() * 25 | 0);
        for (let m = 0; m < n; m++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; out.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, .7 + r() * .6, r()]); }
      }
      for (let k = 0; k < 2; k++) if (r() < .5) { const z = z0 + r() * S; for (let x = x0; x < x0 + S; x += 7 + r() * 5) out.push([x, z + (r() - .5) * 3, .6 + r() * .4, r()]); }
    }
    return out.length > 3800 ? out.filter((_, k) => k % Math.ceil(out.length / 3800) === 0) : out;
  };
  C.bounds = function () {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (const [i, j] of C.unlocked) { a = Math.min(a, gx(i * CHUNK)); b = Math.max(b, gx(i * CHUNK + CHUNK)); c = Math.min(c, gx(j * CHUNK)); d = Math.max(d, gx(j * CHUNK + CHUNK)); }
    return { x0: a, x1: b, z0: c, z1: d };
  };

  // after the roads change: knock down what a road now runs through, find each building's street
  let seenVer = -1;
  C.sync = function () {
    if (seenVer === net.ver) return [];
    seenVer = net.ver;
    const gone = [];
    C.buildings = C.buildings.filter(b => { if (hitsRoad(b.x, b.z, b.w / 2, b.d / 2, 0, ROAD_CLEAR - .8)) { gone.push(b); return false; } return true; });
    const nt = C.trees.length;
    C.trees = C.trees.filter(t => !hitsRoad(t[0], t[1], .5, .5, 0, 5.5));
    C.lots = C.lots.filter(l => !hitsRoad(l.x, l.z, l.w / 2, l.d / 2, 0, ROAD_CLEAR - .8) || (gone.push({ lot: l }), false));
    // street for every building: a spatial hash of road samples
    const cell = 25, grid = new Map(), key = (x, z) => (Math.floor(x / cell) + 1000) * 4000 + Math.floor(z / cell) + 1000;
    for (const e of net.edges.values()) { if (e.ring) continue; const seen = new Set(); for (const p of e.pts) { const k = key(p[0], p[1]); if (seen.has(k)) continue; seen.add(k); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); } }
    for (const b of C.buildings) {
      let best = null, bd = 48;
      const cx = Math.floor(b.fx / cell), cz = Math.floor(b.fz / cell);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const L = grid.get((cx + i + 1000) * 4000 + cz + j + 1000); if (!L) continue;
        for (const e of L) { const c = closestOnPoly(e.pts, e.cum, b.fx, b.fz); if (c.d < bd && c.s > 3 && c.s < e.len - 3) { bd = c.d; best = e; } }
      }
      b.e = best;
    }
    C.ver++;
    if (gone.length || nt !== C.trees.length) C.changed = true;
    return gone;
  };

  C.totals = function () { let res = 0, jobs = 0; for (const b of C.buildings) { res += b.res; jobs += b.jobs; } return { res, jobs }; };

  // trips: residents leave home in the morning, come back in the evening, run errands in between
  let acc = 0;
  const pick = (list, w) => { let t = 0; for (const b of list) t += w(b); let r = Math.random() * t; for (const b of list) { r -= w(b); if (r <= 0) return b; } return list[list.length - 1]; };
  C.demand = function (dt, hour, scale = 1) {
    const { res } = C.totals();
    const rate = res * .0006 * rushCurve(hour) * scale;
    acc += rate * dt;
    const homes = C.buildings.filter(b => b.res > 0 && b.e), work = C.buildings.filter(b => b.jobs > 0 && b.e);
    if (!homes.length || !work.length) return;
    while (acc >= 1) {
      acc -= 1;
      if (C.queue.length > 400) { C.pending++; continue; }
      const am = hour < 12.5, errand = Math.random() < (hour > 10 && hour < 16 ? .5 : .18);
      const h = pick(homes, b => b.res), w = pick(work, b => b.jobs);
      let from = am ? h : w, to = am ? w : h;
      if (errand) { from = Math.random() < .5 ? h : w; to = pick(work, b => b.jobs); }
      if (from === to || Math.hypot(from.fx - to.fx, from.fz - to.fz) < 120) continue;
      C.queue.push({ from, to, t: 0 });
    }
  };
  // send queued trips out onto the roads
  C.release = function (dt, maxCars = 1600) {
    const out = { spawned: 0, stranded: 0, waiting: C.queue.length };
    const keep = []; let tries = 0;
    for (const q of C.queue) {
      q.t += dt;
      if (tries >= 8) { keep.push(q); continue; }
      tries++;
      if (net.cars.length >= maxCars || !q.from.e || !q.to.e) { if (q.t < 60) keep.push(q); else C.pending++; continue; }
      const r = net.spawn({ e: q.from.e, x: q.from.fx, z: q.from.fz }, { e: q.to.e, x: q.to.fx, z: q.to.fz });
      if (r === 'busy') { if (q.t < 60) keep.push(q); else C.pending++; continue; }
      if (r === 'stranded') { out.stranded++; q.from.cut = (q.from.cut || 0) + 1; continue; }
      r.home = q.from.id; out.spawned++;
    }
    C.queue = keep;
    return out;
  };

  C.serialize = function () {
    return { unlocked: C.unlocked, bid: C.bid, seed: C.seed,
      b: C.buildings.map(b => [b.id, b.x, b.z, b.w, b.d, b.h, b.kind, b.res, b.jobs, b.roof, b.face, b.fx, b.fz, b.tone, b.chunk]),
      t: C.trees.map(t => t.map(v => +v.toFixed(2))), l: C.lots };
  };
  C.load = function (d) {
    C.unlocked = d.unlocked; C.bid = d.bid; C.seed = d.seed;
    C.buildings = d.b.map(a => ({ id: a[0], x: a[1], z: a[2], w: a[3], d: a[4], h: a[5], kind: a[6], res: a[7], jobs: a[8], roof: a[9], face: a[10], fx: a[11], fz: a[12], tone: a[13], chunk: a[14] }));
    C.trees = d.t; C.lots = d.l; seenVer = -1; C.ver++;
  };
  return C;
}
