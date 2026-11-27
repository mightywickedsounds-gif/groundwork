// The city: street plan, buildings, growth and the trips people make. No drawing here.
import { rng, closestOnPoly, halfW, ROAD_W, WALK_W, along } from './net.js';

export const BLOCK = 100;          // street grid spacing (m)
export const CHUNK = 3;            // blocks per district side
export const SPAN = 3;             // districts out from the centre each way (7 x 7 districts)
export const DAY = 480;            // seconds of game time per day at 1x
const TRIPS = .0036;               // trips started per resident per second at rush = 1 (a suburb: everyone drives)
const SETBACK = 9.5;               // road centre to the lot line on a neighbourhood street
const SETBACK_AV = 13;             // ... on an arterial (2 lanes each way + a turn lane)
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

  const zoneOf = (x, z) => Math.hypot(x, z) < C.coreR ? 'core' : 'home';
  C.coreR = 175;   // the town centre (the game grows it with the town)   // arterial frontage is 'corridor' (by road kind)

  // does a rectangle (centre, half sizes, angle) touch any road?
  function hitsRoad(x, z, hw, hd, rot, pad = ROAD_CLEAR) {
    const c = Math.cos(rot), s = Math.sin(rot), R0 = Math.hypot(hw, hd) + pad + 3;
    for (const e of net.edges.values()) {
      const A = e.pts[0], B = e.pts[e.pts.length - 1];
      const xw = Math.max(0, halfW(e) - ROAD_W / 2), R = R0 + xw, pd = pad + xw;   // wider roads clear more
      if (Math.min(A[0], B[0], e.cx) - R > x || Math.max(A[0], B[0], e.cx) + R < x || Math.min(A[1], B[1], e.cz) - R > z || Math.max(A[1], B[1], e.cz) + R < z) continue;
      const step = 1.5;
      for (let d = 0; d <= e.len; d += step) {
        const i = Math.min(e.pts.length - 1, Math.round(d / e.len * (e.pts.length - 1)));
        const p = e.pts[i]; const dx = p[0] - x, dz = p[1] - z;
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) < hw + pd && Math.abs(lz) < hd + pd) return true;
      }
    }
    return false;
  }

  // how far each side of a rectangle must move in so no road comes closer than pad: [+x, -x, +z, -z] in its own frame
  function cutsFor(x, z, hw, hd, rot, pad) {
    const c = Math.cos(rot), s = Math.sin(rot), R0 = Math.hypot(hw, hd) + pad + 3, cuts = [0, 0, 0, 0];
    let hit = false;
    for (const e of net.edges.values()) {
      const xw = Math.max(0, halfW(e) - ROAD_W / 2), R = R0 + xw, pd = pad + xw;
      const A = e.pts[0], B = e.pts[e.pts.length - 1];
      if (Math.min(A[0], B[0], e.cx) - R > x || Math.max(A[0], B[0], e.cx) + R < x || Math.min(A[1], B[1], e.cz) - R > z || Math.max(A[1], B[1], e.cz) + R < z) continue;
      for (let d = 0; d <= e.len; d += 1.5) {
        const p = e.pts[Math.min(e.pts.length - 1, Math.round(d / e.len * (e.pts.length - 1)))], dx = p[0] - x, dz = p[1] - z;
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) >= hw + pd || Math.abs(lz) >= hd + pd) continue;
        hit = true;
        const need = [hw - lx + pd, hw + lx + pd, hd - lz + pd, hd + lz + pd]; let k = 0; for (let i = 1; i < 4; i++) if (need[i] < need[k]) k = i;   // the nearest side gives way
        cuts[k] = Math.max(cuts[k], need[k]);
      }
    }
    return hit ? cuts : null;
  }
  // a road came through: cut the building (or lot) back from it instead of knocking it down, if enough is left
  function cutBack(b, pad, minSide, minShare) {
    const rot = b.rot || 0, cuts = cutsFor(b.x, b.z, b.w / 2, b.d / 2, rot, pad); if (!cuts) return true;
    const x0 = -b.w / 2 + cuts[1], x1 = b.w / 2 - cuts[0], z0 = -b.d / 2 + cuts[3], z1 = b.d / 2 - cuts[2];
    const w = x1 - x0, d = z1 - z0;
    if (w < minSide || d < minSide || w * d < b.w * b.d * minShare) return false;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, c = Math.cos(rot), s = Math.sin(rot);
    const nb = { x: b.x + mx * c - mz * s, z: b.z + mx * s + mz * c, w, d };
    if (hitsRoad(nb.x, nb.z, w / 2, d / 2, rot, pad)) return false;
    const k = w * d / (b.w * b.d);
    if (b.res && b.kind !== 'house') b.res = Math.max(1, Math.round(b.res * k));
    if (b.jobs) b.jobs = Math.max(1, Math.round(b.jobs * k));
    b.x = +nb.x.toFixed(2); b.z = +nb.z.toFixed(2); b.w = +w.toFixed(2); b.d = +d.toFixed(2);
    return true;
  }
  // ---- how wide a road may get without touching what stands beside it ----
  // a building keeps this much clear past the back of the sidewalk (a house keeps a front yard); a business keeps its own lot
  const CLEAR = { house: 3, lot: .3, other: .8 };
  // distance from a point to a rectangle (centre, half sizes, angle)
  const rectDist = (px, pz, x, z, hw, hd, rot) => { const c = Math.cos(rot), s = Math.sin(rot), dx = px - x, dz = pz - z, lx = dx * c + dz * s, lz = -dx * s + dz * c; return Math.max(Math.abs(lx) - hw, Math.abs(lz) - hd); };   // (square reach, like the clearing test in sync)
  // the widest carriageway (half width, kerb to centre) these road pieces could have before a building or a business's lot would be in the way
  C.maxHalfW = function (edges) {
    let best = Infinity;
    const things = [];
    for (const b of C.buildings) things.push([b.x, b.z, b.w / 2, b.d / 2, b.rot || 0, b.kind === 'house' ? CLEAR.house : CLEAR.other]);
    for (const l of C.lots) if (l.bid) things.push([l.x, l.z, l.w / 2, l.d / 2, l.rot || 0, CLEAR.lot]);
    for (const e of edges) {
      const [x0, x1, z0, z1] = e.bb;
      for (const [x, z, hw, hd, rot, cl] of things) {
        const R = Math.hypot(hw, hd) + 40; if (x < x0 - R || x > x1 + R || z < z0 - R || z > z1 + R) continue;
        for (let i = 0; i < e.pts.length; i++) { const p = e.pts[i]; const d = rectDist(p[0], p[1], x, z, hw, hd, rot) - WALK_W - cl; if (d < best) best = d; }
      }
    }
    return best;
  };
  // the buildings a planned road (centreline pts, half width hw) would have to clear
  C.inTheWay = function (pts, hw) {
    if (!pts || pts.length < 2) return [];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const out = [];
    for (const b of C.buildings) {
      const R = Math.hypot(b.w, b.d) / 2 + hw + 12; if (b.x < x0 - R || b.x > x1 + R || b.z < z0 - R || b.z > z1 + R) continue;
      const need = hw + ROAD_CLEAR - ROAD_W / 2 - .8;   // (the same reach as sync's clearing)
      if (pts.some(p => rectDist(p[0], p[1], b.x, b.z, b.w / 2, b.d / 2, b.rot || 0) < need)) out.push(b);
    }
    return out;
  };
  function addBuilding(b) {
    b.id = C.bid++; C.buildings.push(b); return b;
  }

  // lay out one block, like a Central Texas Hill Country suburb: houses with yards on the neighbourhood streets,
  // shopping strips, big stores, offices and garden apartments (parking in front) along the arterials,
  // and a small town centre of 2-4 storey buildings near the middle. Nothing tall.
  const CORE_R = 175;
  const avenueLine = k => ((k % CHUNK) + CHUNK) % CHUNK === 0;
  function fillBlock(bx, bz) {
    const x0 = gx(bx), z0 = gx(bz), x1 = x0 + BLOCK, z1 = z0 + BLOCK, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const r = rng((bx * 9973 + bz * 7919 + seed * 31) >>> 0);
    const roll = hash(bx, bz, seed + 5), core = Math.hypot(cx, cz) < CORE_R;
    const roadOn = { n: lineOn(0, bz, bx), s: lineOn(0, bz + 1, bx), w: lineOn(1, bx, bz), e: lineOn(1, bx + 1, bz) };
    const av = { n: avenueLine(bz), s: avenueLine(bz + 1), w: avenueLine(bx), e: avenueLine(bx + 1) };
    const back = k => (av[k] ? SETBACK_AV : SETBACK);           // road centre to the lot line
    const ix0 = x0 + back('w'), ix1 = x1 - back('e'), iz0 = z0 + back('n'), iz1 = z1 - back('s');
    if (roll < (core ? .06 : .09)) {        // a park: live oaks and cedars on open grass
      const n = 20 + (r() * 14 | 0);
      for (let i = 0; i < n; i++) C.trees.push([ix0 + 3 + r() * (ix1 - ix0 - 6), iz0 + 3 + r() * (iz1 - iz0 - 6), .8 + r() * .5, r()]);
      C.lots.push({ k: 'park', x: cx, z: cz, w: ix1 - ix0, d: iz1 - iz0 });
      return;
    }
    const zoneOfSide = k => core ? 'core' : av[k] && roadOn[k] ? 'corridor' : 'home';
    const depthOf = k => ({ core: 26, corridor: 42, home: 30 })[zoneOfSide(k)];
    const D = { n: depthOf('n'), s: depthOf('s'), w: depthOf('w'), e: depthOf('e') };
    // sides: run from a0 to a1 along the side; f = the lot line; out = direction to the street
    const sides = [
      { k: 'n', a0: ix0, a1: ix1, f: iz0, horiz: true, out: -1 },
      { k: 's', a0: ix0, a1: ix1, f: iz1, horiz: true, out: 1 },
      { k: 'w', a0: iz0 + D.n, a1: iz1 - D.s, f: ix0, horiz: false, out: -1 },
      { k: 'e', a0: iz0 + D.n, a1: iz1 - D.s, f: ix1, horiz: false, out: 1 },
    ];
    // a rectangle in a side's frame: along a..a+len, from depth d0 to d1 in from the lot line -> world rect
    const rectIn = (sd, a, len, d0, d1) => {
      const m = sd.f - sd.out * (d0 + d1) / 2, al = a + len / 2;
      return sd.horiz ? { x: al, z: m, w: len, d: d1 - d0 } : { x: m, z: al, w: d1 - d0, d: len };
    };
    const put = (sd, a, len, d0, d1, kind, h, roof, extra = {}) => {
      const q = rectIn(sd, a, len, d0, d1); if (q.w < 5 || q.d < 5) return null;
      if (hitsRoad(q.x, q.z, q.w / 2, q.d / 2, 0)) return null;
      const floors = Math.max(1, Math.round(h / 3.4)), area = q.w * q.d;
      let res = 0, jobs = 0;
      if (kind === 'house') res = 3;
      else if (kind === 'apt') { res = Math.round(area * floors / 45); jobs = Math.round(area / 400); }
      else if (kind === 'office') jobs = Math.round(area * floors / 28);
      else if (kind === 'big') jobs = Math.round(area / 45);
      else jobs = Math.round(area / 30);
      const al = a + len / 2, fx = sd.horiz ? al : sd.f + sd.out * back(sd.k), fz = sd.horiz ? sd.f + sd.out * back(sd.k) : al;
      return addBuilding({ x: +q.x.toFixed(2), z: +q.z.toFixed(2), w: +q.w.toFixed(2), d: +q.d.toFixed(2), h: +h.toFixed(1), kind, res, jobs, roof,
        face: sd.k, fx: +fx.toFixed(2), fz: +fz.toFixed(2), tone: +r().toFixed(3), chunk: 0, ...extra });
    };
    const tree = (sd, a, depth, sc) => { const q = rectIn(sd, a, 0, depth, depth); if (!hitsRoad(q.x, q.z, .5, .5, 0, 5.5)) C.trees.push([+q.x.toFixed(2), +q.z.toFixed(2), sc, r() * .7]); };
    const lot = (sd, a, len, d0, d1) => { const q = rectIn(sd, a, len, d0, d1); if (q.w > 8 && q.d > 8 && !hitsRoad(q.x, q.z, q.w / 2, q.d / 2, 0)) C.lots.push({ k: 'parking', ...q, fill: .3 + r() * .55, seed: r() }); };
    for (const sd of sides) {
      const zone = zoneOfSide(sd.k), Dk = D[sd.k];
      if (!roadOn[sd.k]) {                 // no street here: a tree line along the back fences
        for (let a = sd.a0 + 4; a < sd.a1 - 2; a += 8 + r() * 5) tree(sd, a, 4 + r() * 8, .7 + r() * .4);
        continue;
      }
      let a = sd.a0;
      while (a < sd.a1 - 8) {
        if (zone === 'home') {             // a house: front yard, side yards, back yard (fences drawn later)
          let W = 15 + r() * 4; if (sd.a1 - a - W < 11) W = sd.a1 - a;
          const fd = 10 + r() * 4, yard = 5.5 + r() * 2, two = r() < .4;
          put(sd, a + 2.2, W - 4.4, yard, yard + fd, 'house', two ? 6.6 + r() * .8 : 3.9 + r() * .6, 1, { lw: +W.toFixed(2), ld: Dk });
          if (r() < .55) tree(sd, a + 3 + r() * (W - 6), 2.5 + r() * 2, .65 + r() * .35);        // front yard oak
          if (r() < .6) tree(sd, a + 3 + r() * (W - 6), yard + fd + 4 + r() * 5, .7 + r() * .4);  // back yard tree
          a += W;
        } else if (zone === 'corridor') {  // along the arterial: buildings at the back, parking in front
          const left = sd.a1 - a, q = r();
          if (q < .22 && left > 75) {       // a big store
            const W = Math.min(left, 70 + r() * 20), fd = 30;
            lot(sd, a + 2, W - 4, 1, Dk - fd - 1); put(sd, a + 4, W - 8, Dk - fd, Dk, 'big', 8 + r() * 2, 0); a += W;
          } else if (q < .62) {             // a shopping strip
            let W = 40 + r() * 30; if (left - W < 20) W = left;
            const fd = 17 + r() * 4;
            lot(sd, a + 2, W - 4, 1, Dk - fd - 1); put(sd, a + 2, W - 4, Dk - fd, Dk, 'shop', 5.5 + r() * 1.5, 0); a += W;
          } else if (q < .8) {              // an office, 2-4 storeys, parking beside it
            let W = 34 + r() * 16; if (left - W < 20) W = left;
            const bw = Math.min(W - 4, 20 + r() * 8), fd = 18 + r() * 6;
            put(sd, a + 2, bw, 5, 5 + fd, 'office', 7.5 + (r() * 3 | 0) * 3.6, 0); lot(sd, a + bw + 4, W - bw - 6, 2, Dk - 2); a += W;
          } else {                          // garden apartments, 3 storeys, pitched roof
            let W = 36 + r() * 16; if (left - W < 20) W = left;
            lot(sd, a + 2, W - 4, 1, 12); put(sd, a + 3, W - 6, 15, 15 + 15 + r() * 3, 'apt', 10 + r() * 1.5, 1); a += W;
          }
        } else {                           // town centre: up to the sidewalk, shops downstairs
          let W = 14 + r() * 14; if (sd.a1 - a - W < 10) W = sd.a1 - a;
          const q = r(), kind = q < .45 ? 'shop' : q < .75 ? 'apt' : 'office';
          const h = kind === 'shop' ? 5.5 + r() * 3.5 : 7.5 + (r() * 3 | 0) * 3.6;
          put(sd, a + .6, W - 1.2, .8, Dk - 2 - r() * 4, kind, h, 0);
          a += W;
        }
      }
    }
    // the middle of the block: back yards (trees), or shared parking behind the shops
    const mx0 = ix0 + D.w, mx1 = ix1 - D.e, mz0 = iz0 + D.n, mz1 = iz1 - D.s;
    if (mx1 - mx0 > 8 && mz1 - mz0 > 8) {
      const busy = core || ['n', 's', 'w', 'e'].some(k => zoneOfSide(k) === 'corridor');
      if (busy && hash(bx, bz, seed + 9) < .5) C.lots.push({ k: 'parking', x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, w: mx1 - mx0 - 2, d: mz1 - mz0 - 2, fill: .35 + r() * .55, seed: r() });
      else {
        for (let i = 0; i < 5; i++) C.trees.push([mx0 + 2 + r() * (mx1 - mx0 - 4), mz0 + 2 + r() * (mz1 - mz0 - 4), .7 + r() * .5, r()]);
        C.lots.push({ k: 'yard', x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, w: mx1 - mx0, d: mz1 - mz0 });
      }
    }
  }

  // open a district: its streets and buildings
  C.unlock = function (i, j, bare = false) {
    if (C.unlocked.some(u => u[0] === i && u[1] === j)) return false;
    C.unlocked.push(bare ? [i, j, 1] : [i, j]);
    const k0 = i * CHUNK, l0 = j * CHUNK;
    const sx = k => gx(k), avenue = k => ((k % CHUNK) + CHUNK) % CHUNK === 0;
    // horizontal streets (along x) on lines z = l0..l0+CHUNK
    // arterials: 2 lanes each way with a centre turn lane; neighbourhood streets: one lane each way
    const ART = { kind: 'avenue', nl: 2, tl: 1 }, ST = { kind: 'street' };
    // (a stretch already covered by a road along the same line, like the highway, is left as it is)
    const covered = (a, b) => { const h = net.nearestEdge((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3); if (!h) return false; const q = along(h.e.pts, h.e.cum, h.s); return Math.abs(q[2] * (b[0] - a[0]) + q[3] * (b[1] - a[1])) > .95 * Math.hypot(b[0] - a[0], b[1] - a[1]); };
    const add = (a, b, o) => { if (!covered(a, b)) net.addRoad(a, b, null, o); };
    for (let l = l0; l <= l0 + CHUNK; l++) for (let k = k0; k < k0 + CHUNK; k++) if (lineOn(0, l, k)) add([sx(k), sx(l)], [sx(k + 1), sx(l)], avenue(l) ? ART : ST);
    for (let k = k0; k <= k0 + CHUNK; k++) for (let l = l0; l < l0 + CHUNK; l++) if (lineOn(1, k, l)) add([sx(k), sx(l)], [sx(k), sx(l + 1)], avenue(k) ? ART : ST);
    // traffic lights where arterials cross
    for (const n of net.nodes.values()) { if (n.ring || n.sig || n.edges.size < 3) continue; let a = 0; for (const id of n.edges) if (net.edges.get(id).kind === 'avenue') a++; if (a >= 3) n.sig = { phase: 0, t: 0, st: 'g' }; }
    const nb0 = C.buildings.length;
    if (!bare) for (let bx = k0; bx < k0 + CHUNK; bx++) for (let bz = l0; bz < l0 + CHUNK; bz++) fillBlock(bx, bz);
    for (let n = nb0; n < C.buildings.length; n++) C.buildings[n].chunk = C.unlocked.length;
    // street trees along avenues
    for (let l = l0; l <= l0 + CHUNK; l++) if (avenue(l)) for (let x = sx(k0) + 14; x < sx(k0 + CHUNK) - 10; x += 16) for (const sgn of [-1, 1]) {
      const p = [x + (hash(x | 0, l, 3) - .5) * 3, sx(l) + sgn * 12.4]; if (!treeNearBuilding(p)) C.trees.push([p[0], p[1], .55 + hash(x | 0, l, sgn + 5) * .25, hash(x | 0, l, 9) * .7]);
    }
    for (let k = k0; k <= k0 + CHUNK; k++) if (avenue(k)) for (let z = sx(l0) + 14; z < sx(l0 + CHUNK) - 10; z += 16) for (const sgn of [-1, 1]) {
      const p = [sx(k) + sgn * 12.4, z + (hash(k, z | 0, 3) - .5) * 3]; if (!treeNearBuilding(p)) C.trees.push([p[0], p[1], .55 + hash(k, z | 0, sgn + 5) * .25, hash(k, z | 0, 9) * .7]);
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
      if (C.unlocked.some(u => u[0] === i && u[1] === j && !u[2])) continue;
      const r = rng((i * 7919 + j * 104729 + C.seed * 13) >>> 0), x0 = gx(i * CHUNK), z0 = gx(j * CHUNK);
      const near = C.unlocked.some(u => Math.abs(u[0] - i) <= 1 && Math.abs(u[1] - j) <= 1);
      const clumps = 4 + (r() * 6 | 0);
      for (let k = 0; k < clumps; k++) {
        const cx = x0 + 20 + r() * (S - 40), cz = z0 + 20 + r() * (S - 40), rad = 15 + r() * 40, n = (near ? 18 : 10) + (r() * 25 | 0);
        for (let m = 0; m < n; m++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; out.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, .7 + r() * .6, .25 + r() * .75]); }   // Hill Country woods: lots of cedar
      }
      for (let k = 0; k < 2; k++) if (r() < .5) { const z = z0 + r() * S; for (let x = x0; x < x0 + S; x += 7 + r() * 5) out.push([x, z + (r() - .5) * 3, .6 + r() * .4, r()]); }
    }
    // no trees on roads built out there (a grid of road points, checked after placing so nothing else moves)
    const cell = 16, grid = new Map(), key = (x, z) => (Math.floor(x / cell) + 2000) * 5000 + Math.floor(z / cell) + 2000;
    for (const e of net.edges.values()) { const w = halfW(e) + 4.5; for (const p of e.pts) { const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([p[0], p[1], w]); } }
    const clear = t => { const cx = Math.floor(t[0] / cell), cz = Math.floor(t[1] / cell); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = grid.get((cx + i + 2000) * 5000 + cz + j + 2000); if (L) for (const q of L) if (Math.hypot(q[0] - t[0], q[1] - t[1]) < q[2]) return false; } return true; };
    for (const b of C.buildings) { const k = key(b.x, b.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([b.x, b.z, Math.hypot(b.w, b.d) / 2 + (b.kind === 'house' ? 12 : 6)]); }
    for (const l of C.lots) { const k = key(l.x, l.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([l.x, l.z, Math.hypot(l.w, l.d) / 2 + 2]); }
    const kept = out.filter(clear);
    return kept.length > 6000 ? kept.filter((_, k) => k % Math.ceil(kept.length / 6000) === 0) : kept;
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
    let cut = 0;
    C.buildings = C.buildings.filter(b => {
      if (!hitsRoad(b.x, b.z, b.w / 2, b.d / 2, b.rot || 0, ROAD_CLEAR - .8)) return true;
      // (buildings used to be cut down to a sliver here; a real road either clears a building or keeps its distance)
      gone.push(b); return false;
    });
    C.cutBack = cut;
    const nt = C.trees.length;
    C.trees = C.trees.filter(t => !hitsRoad(t[0], t[1], .5, .5, 0, 5.5));
    const ids = new Set(C.buildings.map(b => b.id));
    C.lots = C.lots.filter(l => (!l.bid || ids.has(l.bid)) && (!hitsRoad(l.x, l.z, l.w / 2, l.d / 2, l.rot || 0, ROAD_CLEAR - .8) || cutBack(l, ROAD_CLEAR - .5, 8, .3) || (gone.push({ lot: l }), false)));
    // street for every building: a spatial hash of road samples
    const cell = 25, grid = new Map(), key = (x, z) => (Math.floor(x / cell) + 1000) * 4000 + Math.floor(z / cell) + 1000;
    for (const e of net.edges.values()) { if (e.ring || e.lv) continue; const seen = new Set(); for (const p of e.pts) { const k = key(p[0], p[1]); if (seen.has(k)) continue; seen.add(k); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); } }
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

  // ---- the city grows back: empty land along any street gets new buildings, facing the street ----
  const inCity = C.inCity = (x, z) => { const S = BLOCK * CHUNK, i = Math.floor((x - g0) / S), j = Math.floor((z - g0) / S); return C.unlocked.some(u => u[0] === i && u[1] === j); };
  // do two rectangles (centre, half sizes, angle) overlap? (separating axes)
  function overlap(a, b, m = 0) {
    const ax = [Math.cos(a.r), Math.sin(a.r)], az = [-ax[1], ax[0]], bx = [Math.cos(b.r), Math.sin(b.r)], bz = [-bx[1], bx[0]], d = [b.x - a.x, b.z - a.z];
    for (const n of [ax, az, bx, bz]) {
      const ra = a.hw * Math.abs(ax[0] * n[0] + ax[1] * n[1]) + a.hd * Math.abs(az[0] * n[0] + az[1] * n[1]);
      const rb = b.hw * Math.abs(bx[0] * n[0] + bx[1] * n[1]) + b.hd * Math.abs(bz[0] * n[0] + bz[1] * n[1]);
      if (Math.abs(d[0] * n[0] + d[1] * n[1]) > ra + rb + m) return false;
    }
    return true;
  }
  const rectOf = b => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, r: b.rot || 0 });
  let regrowT = 0, commitT = 0, fresh = 0, tries = 0;
  const zoneAt = (e, p) => zoneOf(p[0], p[1]) === 'core' ? 'core' : e.kind === 'avenue' || halfW(e) > 5.5 ? 'corridor' : 'home';
  // the usable stretch of a street (clear of the junctions at its ends)
  C.span = function (e) { const A = net.nodes.get(e.a), B = net.nodes.get(e.b); return [(A.edges.size > 1 ? net.trimOf(A) : 0) + 4, e.len - (B.edges.size > 1 ? net.trimOf(B) : 0) - 4]; };
  // put a building facing street e at sAt on side sg (frontage fw, depth fd, gap from the sidewalk). Returns it or null
  function placeOn(e, sAt, sg, kind, fw, fd0, gap, h, roof, extra = {}, R = Math.random) {
    const front = halfW(e) + WALK_W + gap, p = along(e.pts, e.cum, sAt), r = [-p[3] * sg, p[2] * sg];
    const rot = Math.atan2(r[1], r[0]);   // local x points away from the street
    const near = C.buildings.filter(b => Math.abs(b.x - p[0]) < 120 && Math.abs(b.z - p[1]) < 120).map(rectOf);
    const lots = C.lots.filter(l => Math.abs(l.x - p[0]) < 140 && Math.abs(l.z - p[1]) < 140).map(l => ({ x: l.x, z: l.z, hw: l.w / 2, hd: l.d / 2, r: l.rot || 0 }));
    for (const fd of [fd0, fd0 * .8]) {
      if (fd < 7) continue;
      const off = front + fd / 2, x = p[0] + r[0] * off, z = p[1] + r[1] * off;
      if (!inCity(x, z)) continue;
      const me = { x, z, hw: fd / 2, hd: fw / 2, r: rot };
      if (hitsRoad(x, z, fd / 2, fw / 2, rot, ROAD_CLEAR + .3)) continue;
      if (near.some(o => overlap(me, o, kind === 'house' ? 4.4 : 2)) || lots.some(o => overlap(me, o, .5))) continue;
      const floors = Math.max(1, Math.round(h / 3.4)), area = fw * fd;
      let res = 0, jobs = 0;
      if (kind === 'house') res = extra.res || 3; else if (kind === 'apt') res = Math.round(area * floors / 45);
      else if (!extra.biz) { if (kind === 'office') jobs = Math.round(area * floors / 28); else jobs = Math.round(area / 30); }
      const b = addBuilding({ x: +x.toFixed(2), z: +z.toFixed(2), w: +fd.toFixed(2), d: +fw.toFixed(2), h: +h.toFixed(1), kind, res, jobs, roof,
        face: 'r', fx: +p[0].toFixed(2), fz: +p[1].toFixed(2), tone: +R().toFixed(3), chunk: C.unlocked.length, rot: +rot.toFixed(4), ...(kind === 'house' ? { lw: +(fw + 4.4).toFixed(2), ld: +(gap + fd + 12).toFixed(2) } : {}), ...extra });
      delete b.res0; if (b.biz) b.jobs = 0;
      b.e = e;
      C.trees = C.trees.filter(t => !overlap(me, { x: t[0], z: t[1], hw: .5, hd: .5, r: 0 }, 1));
      if (kind === 'house' && R() < .7) { const bo = off + fd / 2 + 4; C.trees.push([+(p[0] + r[0] * bo).toFixed(2), +(p[1] + r[1] * bo).toFixed(2), +(.65 + R() * .35).toFixed(2), +(R() * .7).toFixed(2)]); }
      if (kind === 'house' && R() < .6) { const bo = front - gap * .45; C.trees.push([+(p[0] + r[0] * bo + p[2] * (fw * .3)).toFixed(2), +(p[1] + r[1] * bo + p[3] * (fw * .3)).toFixed(2), +(.6 + R() * .3).toFixed(2), +(R() * .7).toFixed(2)]); }
      return b;
    }
    return null;
  }
  // what grows on its own: homes (houses on neighbourhood streets, apartments on main roads and downtown, taller in the middle)
  function homePlan(zone, R) {
    if (zone === 'home') return ['house', 11 + R() * 4, 10 + R() * 4, 5.5 + R() * 2, R() < .4 ? 6.6 + R() * .8 : 3.9 + R() * .6, 1];
    if (zone === 'corridor') return ['apt', 30 + R() * 16, 15 + R() * 3, 13, 10 + R() * 1.5, 1];
    return ['apt', 16 + R() * 12, 16 + R() * 6, .8, 10.5 + (R() * 5 | 0) * 3.4, 0];   // downtown: 3 to 7 storeys up to the sidewalk
  }
  // one try at new growth along a random street. resi: homes only (businesses are the player's)
  function tryGrow(resi = false, R = Math.random) {
    const E = [...net.edges.values()].filter(e => !e.ring && !e.lv && e.len > 30); if (!E.length) return null;
    const e = E[(R() * E.length) | 0];
    const mid = along(e.pts, e.cum, e.len / 2); if (!inCity(mid[0], mid[1])) return null;
    const sg = R() < .5 ? 1 : -1, zone = zoneAt(e, mid), q = R();
    const [s0, s1] = C.span(e);
    let plan;
    if (resi) plan = homePlan(zone, R);
    else if (zone === 'home') plan = homePlan(zone, R);
    else if (zone === 'corridor') plan = q < .55 ? ['shop', 36 + R() * 24, 17 + R() * 4, 14, 5.5 + R() * 1.5, 0] : q < .8 ? ['office', 20 + R() * 10, 18 + R() * 6, 8, 7.5 + (R() * 3 | 0) * 3.6, 0] : ['apt', 30 + R() * 16, 15 + R() * 3, 13, 10 + R() * 1.5, 1];
    else { const k = q < .45 ? 'shop' : q < .75 ? 'apt' : 'office'; plan = [k, 12 + R() * 14, 18 + R() * 6, .8, k === 'shop' ? 5.5 + R() * 3.5 : 7.5 + (R() * 3 | 0) * 3.6, 0]; }
    const [kind, fw, fd0, gap, h, roof] = plan;
    if (s1 - s0 < fw + 2) return null;
    const sAt = s0 + fw / 2 + 1 + R() * (s1 - s0 - fw - 2);
    const b = placeOn(e, sAt, sg, kind, fw, fd0, gap, h, roof, {}, R);
    if (b && kind === 'apt' && zone === 'corridor') C.frontLot(b);   // garden apartments: parking out front
    return b;
  }
  // call every sim step: a few tries a second; new buildings show up together every so often (fewer redraws).
  // want(): how many more homes the town wants right now (game: people move in when there are jobs); null = grow freely (tests)
  C.regrow = function (dt, want = null) {
    regrowT += dt; commitT += dt; let made = 0;
    const every = want == null ? 1.5 : want > 0 ? .5 : 1e9;
    while (regrowT >= every) { regrowT -= every; tries++; if (want != null && made >= want) break; if (tryGrow(want != null)) { fresh++; made++; } }
    if (regrowT > 5) regrowT = 0;
    if (fresh && commitT >= (want == null ? 12 : 4)) { commitT = 0; const n = fresh; fresh = 0; C.ver++; C.changed = true; return n; }
    if (commitT >= 12) commitT = 0;
    return 0;
  };
  // the player builds a business or service at a spot on a street (sAt along it, on side sg)
  C.build = function (e, sAt, sg, kind, fw, fd, h, extra) {
    const [s0, s1] = C.span(e); if (s1 - s0 < fw + 2) return null;
    sAt = Math.max(s0 + fw / 2 + 1, Math.min(s1 - fw / 2 - 1, sAt));
    // set back behind a parking lot (downtown: up to the sidewalk, no lot)
    const core = zoneAt(e, along(e.pts, e.cum, sAt)) === 'core', t = extra.biz && extra.biz.t;
    const gap = core ? 1 : kind === 'big' ? 26 : ({ gas: 12, auto: 12, police: 14, fire: 11, hospital: 18 })[t] || 14;
    for (const ds of [0, -6, 6, -12, 12, -20, 20]) {
      const s = sAt + ds; if (s - fw / 2 < s0 || s + fw / 2 > s1) continue;
      for (const g of core ? [gap] : [gap, 8]) {
        const b = placeOn(e, s, sg, kind, fw, fd, g, h, 0, extra); if (b) { if (!core) C.frontLot(b); C.ver++; C.changed = true; return b; }
      }
    }
    return null;
  };
  // a new game: a crossroads village of a few streets and a handful of houses and shops
  C.startTown = function (shops) {
    C.unlocked.push([0, 0, 1]);
    const R = rng((seed * 7 + 11) >>> 0), ART = { kind: 'avenue', nl: 2, tl: 1 }, ST = { kind: 'street' };
    const L = (a, b, o) => net.addRoad(a, b, null, o);
    L([-150, -50], [-50, -50], ART); L([-50, -50], [50, -50], ART); L([50, -50], [150, -50], ART);   // Main Street
    L([-850, -50], [-150, -50], ART); L([150, -50], [850, -50], ART);                                // ... and the highway it becomes out of town
    L([-50, -150], [-50, -50], ST); L([-50, -50], [-50, 50], ST);                                     // two side streets
    L([50, -150], [50, -50], ST); L([50, -50], [50, 50], ST);
    L([-50, 50], [50, 50], ST);                                                                       // and one across
    const edge = (x0, z0, x1, z1) => [...net.edges.values()].find(e => { const A = net.nodes.get(e.a), B = net.nodes.get(e.b); return (Math.hypot(A.x - x0, A.z - z0) < 1 && Math.hypot(B.x - x1, B.z - z1) < 1) || (Math.hypot(A.x - x1, A.z - z1) < 1 && Math.hypot(B.x - x0, B.z - z0) < 1); });
    // the shops on Main Street, then houses on the side streets
    const main = [edge(-150, -50, -50, -50), edge(-50, -50, 50, -50), edge(50, -50, 150, -50)];
    for (const [k, mi, side, frac] of shops) { const e = main[mi]; const [s0, s1] = C.span(e); k(e, s0 + (s1 - s0) * frac, side); }
    let houses = 0;
    for (const [x0, z0, x1, z1] of [[-50, -50, -50, 50], [50, -50, 50, 50], [-50, 50, 50, 50], [-50, -150, -50, -50], [50, -150, 50, -50]]) {
      const e = edge(x0, z0, x1, z1); if (!e) continue; const [s0, s1] = C.span(e);
      for (const sg of [1, -1]) for (let s = s0 + 9; s < s1 - 8 && houses < 12; s += 17 + R() * 3) {
        if (R() < .35) continue;
        const [kind, fw, fd, gap, h, roof] = homePlan('home', R);
        if (placeOn(e, s, sg, kind, fw, fd, gap, h, roof, { res: 2 + (R() * 3 | 0) }, R)) houses++;
      }
    }
    C.ver++;
  };
  // a parking lot between a building and its street, filling the space there (head-in stalls, wider than the building where there's room)
  C.frontLot = function (b) {
    if (b.face !== 'r' || !b.e || C.lots.some(l => l.bid === b.id)) return null;
    const e = b.e, c = closestOnPoly(e.pts, e.cum, b.x, b.z), r = b.rot || 0, ax = [Math.cos(r), Math.sin(r)];
    const space = c.d - halfW(e) - WALK_W - b.w / 2 - 1.5; if (space < 6.2) return null;
    const D = Math.min(space, 32), mid = b.w / 2 + .6 + D / 2;
    for (const L of [b.d + 8, b.d + 3, b.d]) {
      const lot = { k: 'parking', x: +(b.x - ax[0] * mid).toFixed(2), z: +(b.z - ax[1] * mid).toFixed(2), w: +L.toFixed(2), d: +D.toFixed(2), rot: +(r + Math.PI / 2).toFixed(4), fill: +(.3 + hash(b.id, 3, seed) * .5).toFixed(2), seed: +hash(b.id, 4, seed).toFixed(4), bid: b.id };
      const me = { x: lot.x, z: lot.z, hw: L / 2, hd: D / 2, r: lot.rot };
      if (hitsRoad(lot.x, lot.z, L / 2, D / 2, lot.rot, ROAD_CLEAR - .8)) continue;
      if (C.buildings.some(o => o !== b && Math.abs(o.x - lot.x) < 90 && Math.abs(o.z - lot.z) < 90 && overlap(me, rectOf(o), .3))) continue;
      if (C.lots.some(o => Math.abs(o.x - lot.x) < 120 && Math.abs(o.z - lot.z) < 120 && overlap(me, { x: o.x, z: o.z, hw: o.w / 2, hd: o.d / 2, r: o.rot || 0 }, .2))) continue;
      C.trees = C.trees.filter(t => !overlap(me, { x: t[0], z: t[1], hw: .5, hd: .5, r: 0 }, 1));
      C.lots.push(lot); C.ver++; return lot;
    }
    return null;
  };
  // businesses from before parking lots: give each one where there's room
  C.ensureLots = function () { let n = 0; for (const b of C.buildings) if ((b.biz || (b.kind === 'apt' && b.face === 'r')) && C.frontLot(b)) n++; return n; };
  C.isBare = (i, j) => C.unlocked.some(u => u[0] === i && u[1] === j && u[2]);

  C.totals = function () { let res = 0, jobs = 0; for (const b of C.buildings) { res += b.res; jobs += b.jobs; } return { res, jobs }; };

  // trips: residents leave home in the morning, come back in the evening, run errands in between
  let acc = 0;
  const pick = (list, w) => { let t = 0; for (const b of list) t += w(b); let r = Math.random() * t; for (const b of list) { r -= w(b); if (r <= 0) return b; } return list[list.length - 1]; };
  C.demand = function (dt, hour, scale = 1) {
    const { res } = C.totals();
    const rate = res * TRIPS * rushCurve(hour) * scale;
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
    const fail = (q, why) => { if (q.fail) q.fail(why); };
    for (const q of C.queue) {
      q.t += dt;
      if (tries >= 8) { keep.push(q); continue; }
      tries++;
      if (!q.from.e || !q.to.e) { if (q.t < 60) keep.push(q); else { C.pending++; fail(q, 'stranded'); } continue; }
      if (net.cars.length >= maxCars) { if (q.t < 20) keep.push(q); else { C.pending++; fail(q, 'cap'); } continue; }
      const r = net.spawn(q.fromAt || { e: q.from.e, x: q.from.fx, z: q.from.fz }, q.toAt || { e: q.to.e, x: q.to.fx, z: q.to.fz }, q.kindRoll ?? Math.random(), q.colorRoll ?? Math.random());   // (at a lot: from/to its driveway)
      if (r === 'busy') { if (q.t < 60) keep.push(q); else { C.pending++; fail(q, 'busy'); } continue; }
      if (r === 'stranded') { out.stranded++; q.from.cut = (q.from.cut || 0) + 1; fail(q, 'stranded'); continue; }
      r.home = q.from.id; out.spawned++; if (q.ok) q.ok(r);
    }
    C.queue = keep;
    return out;
  };

  C.serialize = function () {
    return { unlocked: C.unlocked, bid: C.bid, seed: C.seed,
      b: C.buildings.map(b => [b.id, b.x, b.z, b.w, b.d, b.h, b.kind, b.res, b.jobs, b.roof, b.face, b.fx, b.fz, b.tone, b.chunk, b.rot ? +b.rot.toFixed(4) : 0, b.lw || 0, b.ld || 0, b.biz ? [b.biz.t, b.biz.name, b.biz.lvl, Math.round(b.biz.cash)] : 0]),
      t: C.trees.map(t => t.map(v => +v.toFixed(2))), l: C.lots };
  };
  C.load = function (d) {
    C.unlocked = d.unlocked; C.bid = d.bid; C.seed = d.seed;
    C.buildings = d.b.map(a => ({ id: a[0], x: a[1], z: a[2], w: a[3], d: a[4], h: a[5], kind: a[6], res: a[7], jobs: a[8], roof: a[9], face: a[10], fx: a[11], fz: a[12], tone: a[13], chunk: a[14], rot: a[15] || 0, lw: a[16] || 0, ld: a[17] || 0, ...(a[18] ? { biz: { t: a[18][0], name: a[18][1], lvl: a[18][2], cash: a[18][3] } } : {}) }));
    C.trees = d.t; C.lots = d.l; seenVer = -1; C.ver++;
  };
  return C;
}
