// Road network + traffic simulation. No drawing here (tests run it in Node).
// Coordinates are metres: x = east, z = south (seen from above, north is up).
// Traffic drives on the right. A lane's right side is (-dz, dx) of its heading.

export const LANE_W = 3.5;          // one lane
export const ROAD_W = 7;            // two-way carriageway
export const ONEWAY_W = 5.2;        // one-way carriageway (one wide lane)
export const WALK_W = 3;            // sidewalk each side
export const SNAP = 9;              // clicks this close to a node/road join it
export const RING_R = 15;           // roundabout centre-line radius
const LIMIT = 13.9;                 // 50 km/h
const ACC = 1.6, DEC = 2.6, S0 = 2.2, HEAD = 1.15;  // IDM car following
const GIVE_UP = 120;                // seconds stuck before a driver gives up

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- small geometry helpers ----------
const qpt = (a, c, b, t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segX(p1, p2, p3, p4) {     // segment intersection -> [t, u] or null
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}
function cumOf(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; }
// point + heading at arc length s along a polyline
export function along(pts, cum, s) {
  const n = pts.length; if (n < 2) return [pts[0][0], pts[0][1], 1, 0];
  s = Math.max(0, Math.min(cum[n - 1], s));
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const L = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / L, a = pts[lo], b = pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
}
// cut a polyline between arc lengths s0..s1
function cut(pts, cum, s0, s1) {
  const out = [along(pts, cum, s0).slice(0, 2)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + .05 && cum[i] < s1 - .05) out.push(pts[i]);
  out.push(along(pts, cum, s1).slice(0, 2));
  return out;
}
// offset a polyline to the right by o metres
function offset(pts, o) {
  if (!o) return pts.map(p => [p[0], p[1]]);
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    out.push([pts[i][0] - dz * o, pts[i][1] + dx * o]);
  }
  return out;
}
export function closestOnPoly(pts, cum, x, z) {   // -> {d, s, i}
  let best = { d: 1e9, s: 0, i: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, i: i - 1, t };
  }
  return best;
}

// tiny binary heap for routing
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

export const TYPES = [            // vehicle kinds: length, width, top speed factor, share
  { k: 'car', len: 4.5, w: 1.85, share: .74 },
  { k: 'suv', len: 4.9, w: 2.0, share: .14 },
  { k: 'van', len: 5.6, w: 2.05, share: .07 },
  { k: 'truck', len: 8.5, w: 2.4, share: .03, slow: .85 },
  { k: 'bus', len: 12, w: 2.5, share: .02, slow: .8 },
];

export class Net {
  constructor() {
    this.nodes = new Map(); this.edges = new Map();
    this.nid = 1; this.eid = 1; this.rid = 1;
    this.lanes = new Map();       // key -> lane (links and connectors)
    this.links = [];              // lanes that are roads (not junction connectors)
    this.cars = []; this.carId = 1;
    this.ver = 0;                 // bumps on any geometry change (drawing rebuilds)
    this.stats = { arrived: 0, gaveUp: 0, spawned: 0, tripSec: 0, stranded: 0, ema: 0 };
    this.time = 0;
  }

  // ---------------- topology ----------------
  addNode(x, z) { const n = { id: this.nid++, x, z, sig: null, ring: 0, edges: new Set() }; this.nodes.set(n.id, n); return n; }
  edgeGeom(e) {
    const A = this.nodes.get(e.a), B = this.nodes.get(e.b), a = [A.x, A.z], b = [B.x, B.z], c = [e.cx, e.cz];
    const approx = dist(a, c) + dist(c, b), M = Math.max(2, Math.ceil(approx / 2.5));
    const pts = []; for (let i = 0; i <= M; i++) pts.push(qpt(a, c, b, i / M));
    e.pts = pts; e.cum = cumOf(pts); e.len = e.cum[e.cum.length - 1];
  }
  addEdge(a, b, cx, cz, o = {}) {
    if (a === b) return null;
    for (const id of this.nodes.get(a).edges) { const f = this.edges.get(id); if ((f.a === a && f.b === b) || (f.a === b && f.b === a)) return null; }
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (cx == null) { cx = (A.x + B.x) / 2; cz = (A.z + B.z) / 2; }
    const e = { id: this.eid++, a, b, cx, cz, oneway: o.oneway || 0, ring: o.ring || 0, kind: o.kind || 'street', lanes: 1 };
    this.edgeGeom(e); if (e.len < 4) return null;
    this.edges.set(e.id, e); A.edges.add(e.id); B.edges.add(e.id);
    return e;
  }
  delEdge(id) {
    const e = this.edges.get(id); if (!e) return;
    this.edges.delete(id);
    for (const nid of [e.a, e.b]) { const n = this.nodes.get(nid); if (!n) continue; n.edges.delete(id); if (!n.edges.size) this.nodes.delete(nid); else if (n.edges.size < 3) n.sig = null; }
  }
  // split an edge at curve parameter t -> the new node
  splitEdge(e, t, at) {
    const A = this.nodes.get(e.a), B = this.nodes.get(e.b), a = [A.x, A.z], c = [e.cx, e.cz], b = [B.x, B.z];
    const q0 = lerp2(a, c, t), q1 = lerp2(c, b, t), m = at || lerp2(q0, q1, t);
    const n = this.addNode(m[0], m[1]); const o = { oneway: e.oneway, ring: e.ring, kind: e.kind };
    this.delEdge(e.id);
    if (!this.nodes.has(A.id)) this.nodes.set(A.id, A);
    if (!this.nodes.has(B.id)) this.nodes.set(B.id, B);
    this.addEdge(A.id, n.id, q0[0], q0[1], o); this.addEdge(n.id, B.id, q1[0], q1[1], o);
    return n;
  }
  // param t on edge's curve for arc length s (via samples)
  tAt(e, s) { const M = e.pts.length - 1; let i = 1; while (i < M && e.cum[i] < s) i++; const f = (s - e.cum[i - 1]) / ((e.cum[i] - e.cum[i - 1]) || 1); return (i - 1 + f) / M; }
  nearestNode(x, z, r = SNAP) { let best = null, bd = r; for (const n of this.nodes.values()) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } } return best; }
  nearestEdge(x, z, r = SNAP) {
    let best = null, bd = r;
    for (const e of this.edges.values()) { const c = closestOnPoly(e.pts, e.cum, x, z); if (c.d < bd) { bd = c.d; best = { e, s: c.s, d: c.d }; } }
    return best;
  }
  // a click point -> node (existing, on a road, or new)
  snapNode(x, z, make = true) {
    const n = this.nearestNode(x, z); if (n) return n;
    const h = this.nearestEdge(x, z);
    if (h && h.s > 5 && h.s < h.e.len - 5) { if (!make) return { x, z, virt: true }; const p = along(h.e.pts, h.e.cum, h.s); return this.splitEdge(h.e, this.tAt(h.e, h.s), [p[0], p[1]]); }
    if (!make) return null;
    return this.addNode(x, z);
  }
  // draw a road from p0 to p1 (optional bend point c). Splits crossings into junctions. Returns created edges.
  addRoad(p0, p1, c = null, o = {}) {
    const A = this.snapNode(p0[0], p0[1]), B = this.snapNode(p1[0], p1[1]);
    if (A === B) return [];
    let a = [A.x, A.z], b = [B.x, B.z];
    if (dist(a, b) < 6) return [];
    let cc = c ? c : lerp2(a, b, .5);
    // crossings with existing roads
    const M = Math.max(4, Math.ceil((dist(a, cc) + dist(cc, b)) / 2.5)); const P = []; for (let i = 0; i <= M; i++) P.push(qpt(a, cc, b, i / M));
    const hits = [];
    for (const e of [...this.edges.values()]) {
      if (e.a === A.id || e.b === A.id || e.a === B.id || e.b === B.id) {
        // still allow crossings away from the shared node
      }
      for (let i = 1; i < P.length; i++) for (let j = 1; j < e.pts.length; j++) {
        const x = segX(P[i - 1], P[i], e.pts[j - 1], e.pts[j]); if (!x) continue;
        const pt = lerp2(P[i - 1], P[i], x[0]); if (dist(pt, a) < 6 || dist(pt, b) < 6) continue;
        hits.push({ t: (i - 1 + x[0]) / M, e, s: e.cum[j - 1] + (e.cum[j] - e.cum[j - 1]) * x[1], pt });
      }
    }
    hits.sort((p, q) => p.t - q.t);
    const stops = [{ t: 0, n: A }];
    for (const h of hits) {
      if (h.t - stops[stops.length - 1].t < .02) continue;
      if (!this.edges.has(h.e.id)) {         // edge was split by an earlier hit: find its piece
        const near = this.nearestEdge(h.pt[0], h.pt[1], 2); if (!near) continue; h.e = near.e; h.s = near.s;
      }
      let n = this.nearestNode(h.pt[0], h.pt[1], 7);
      if (!n) { if (h.s < 4 || h.s > h.e.len - 4) continue; n = this.splitEdge(h.e, this.tAt(h.e, h.s), h.pt); }
      if (n === A || n === B || stops.some(s => s.n === n)) continue;
      stops.push({ t: h.t, n });
    }
    stops.push({ t: 1, n: B });
    // split the new curve at the stops (de Casteljau), endpoints pinned to the nodes
    const made = []; let p0c = a, pc = cc, p1c = b, tPrev = 0;
    for (let k = 1; k < stops.length; k++) {
      const t = k === stops.length - 1 ? 1 : (stops[k].t - tPrev) / (1 - tPrev);
      const q0 = lerp2(p0c, pc, t), q1 = lerp2(pc, p1c, t), m = lerp2(q0, q1, t);
      const n0 = stops[k - 1].n, n1 = stops[k].n;
      const e = this.addEdge(n0.id, n1.id, q0[0], q0[1], o); if (e) made.push(e);
      p0c = m; pc = q1; tPrev = stops[k].t;
    }
    for (const n of [A, B]) if (!n.edges.size) this.nodes.delete(n.id);
    this.ver++;
    return made;
  }
  removeEdge(id) { const e = this.edges.get(id); if (!e) return false; if (e.ring) return this.removeRoundabout(e.ring); this.delEdge(id); this.ver++; return true; }
  toggleSignal(nid) {
    const n = this.nodes.get(nid); if (!n || n.ring || n.edges.size < 3) return null;
    n.sig = n.sig ? null : { phase: 0, t: 0, st: 'g' }; this.ver++; return !!n.sig;
  }
  cycleOneWay(eid) {
    const e = this.edges.get(eid); if (!e || e.ring) return null;
    e.oneway = e.oneway === 0 ? 1 : e.oneway === 1 ? -1 : 0; this.ver++; return e.oneway;
  }
  // replace a junction with a roundabout. Returns ring id or a reason string.
  makeRoundabout(nid, R = RING_R) {
    const n = this.nodes.get(nid); if (!n) return 'NO JUNCTION';
    if (n.ring) return 'ALREADY A ROUNDABOUT';
    if (n.edges.size < 3) return 'NEEDS 3+ ROADS';
    const spokes = [];
    for (const id of [...n.edges]) {
      const e = this.edges.get(id);
      if (e.len < R + 10) return 'NOT ENOUGH ROOM';
      const fromA = e.a === n.id, s = fromA ? R : e.len - R;
      const p = along(e.pts, e.cum, s); const ang = Math.atan2(p[1] - n.z, p[0] - n.x);
      spokes.push({ e, fromA, s, ang });
    }
    spokes.sort((p, q) => p.ang - q.ang);
    for (let i = 0; i < spokes.length; i++) { const d = spokes[(i + 1) % spokes.length].ang - spokes[i].ang + (i === spokes.length - 1 ? Math.PI * 2 : 0); if (d < .45) return 'ROADS TOO CLOSE'; }
    const rid = this.rid++, ringNodes = [];
    for (const sp of spokes) {
      const keep = sp.fromA ? sp.e.b : sp.e.a;  // far node
      const m = this.splitEdge(sp.e, this.tAt(sp.e, sp.s));
      // drop the inner piece (n -> m)
      for (const id of [...m.edges]) { const f = this.edges.get(id); if (f.a === n.id || f.b === n.id) this.delEdge(id); }
      m.x = n.x + Math.cos(sp.ang) * R; m.z = n.z + Math.sin(sp.ang) * R; m.ring = rid; m.sig = null;
      for (const id of m.edges) { const f = this.edges.get(id); if (f.a === keep || f.b === keep) this.edgeGeom(f); }
      ringNodes.push({ n: m, ang: sp.ang });
    }
    this.nodes.delete(n.id);
    // fill big gaps so arcs stay round
    const all = [];
    for (let i = 0; i < ringNodes.length; i++) {
      const a0 = ringNodes[i].ang, a1 = i + 1 < ringNodes.length ? ringNodes[i + 1].ang : ringNodes[0].ang + Math.PI * 2;
      all.push(ringNodes[i]);
      const k = Math.floor((a1 - a0) / 1.75);
      for (let j = 1; j <= k; j++) { const ang = a0 + (a1 - a0) * j / (k + 1); const f = this.addNode(n.x + Math.cos(ang) * R, n.z + Math.sin(ang) * R); f.ring = rid; all.push({ n: f, ang }); }
    }
    // one-way arcs going the way of decreasing angle (island on the driver's left)
    for (let i = 0; i < all.length; i++) {
      const from = all[(i + 1) % all.length], to = all[i];
      let a0 = from.ang, a1 = to.ang; if (a0 < a1) a0 += Math.PI * 2;
      const mid = (a0 + a1) / 2, k = R / Math.cos((a0 - a1) / 2);
      this.addEdge(from.n.id, to.n.id, n.x + Math.cos(mid) * k, n.z + Math.sin(mid) * k, { oneway: 1, ring: rid });
    }
    this.ver++;
    return rid;
  }
  ringCenter(rid) { let x = 0, z = 0, k = 0; for (const n of this.nodes.values()) if (n.ring === rid) { x += n.x; z += n.z; k++; } return k ? [x / k, z / k] : null; }
  removeRoundabout(rid) {
    const c = this.ringCenter(rid); if (!c) return false;
    const ring = [...this.nodes.values()].filter(n => n.ring === rid);
    for (const e of [...this.edges.values()]) if (e.ring === rid) this.delEdge(e.id);
    const center = this.addNode(c[0], c[1]);
    for (const m of ring) {
      if (!this.nodes.has(m.id)) continue;
      // reconnect each spoke straight to the centre
      for (const id of [...m.edges]) {
        const f = this.edges.get(id), far = f.a === m.id ? f.b : f.a, toward = f.a === m.id;
        const F = this.nodes.get(far); this.delEdge(id); if (!this.nodes.has(far)) this.nodes.set(far, F);
        const o = { oneway: f.oneway, kind: f.kind };
        if (toward) this.addEdge(center.id, far, (center.x + F.x) / 2, (center.z + F.z) / 2, o);
        else this.addEdge(far, center.id, (center.x + F.x) / 2, (center.z + F.z) / 2, o);
      }
      this.nodes.delete(m.id);
    }
    if (!center.edges.size) this.nodes.delete(center.id);
    this.ver++; return true;
  }
  serialize() {
    return { nodes: [...this.nodes.values()].map(n => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), n.sig ? 1 : 0, n.ring]),
      edges: [...this.edges.values()].map(e => [e.id, e.a, e.b, +e.cx.toFixed(2), +e.cz.toFixed(2), e.oneway, e.ring, e.kind]), nid: this.nid, eid: this.eid, rid: this.rid };
  }
  load(d) {
    this.nodes.clear(); this.edges.clear(); this.cars = [];
    for (const [id, x, z, sig, ring] of d.nodes) this.nodes.set(id, { id, x, z, sig: sig ? { phase: 0, t: 0, st: 'g' } : null, ring, edges: new Set() });
    for (const [id, a, b, cx, cz, oneway, ring, kind] of d.edges) {
      if (!this.nodes.has(a) || !this.nodes.has(b)) continue;
      const e = { id, a, b, cx, cz, oneway, ring, kind, lanes: 1 }; this.edgeGeom(e); this.edges.set(id, e);
      this.nodes.get(a).edges.add(id); this.nodes.get(b).edges.add(id);
    }
    for (const n of [...this.nodes.values()]) if (!n.edges.size) this.nodes.delete(n.id);
    this.nid = d.nid; this.eid = d.eid; this.rid = d.rid; this.ver++;
  }

  // ---------------- lanes ----------------
  trimOf(n) {
    if (n.ring) return 5.5;
    const deg = n.edges.size; if (deg <= 1) return 0;
    const angs = [];
    for (const id of n.edges) { const e = this.edges.get(id); const p = e.a === n.id ? e.pts[1] : e.pts[e.pts.length - 2]; angs.push(Math.atan2(p[1] - n.z, p[0] - n.x)); }
    angs.sort((a, b) => a - b); let mn = 7;
    for (let i = 0; i < angs.length; i++) { const d = (i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2) - angs[i]; mn = Math.min(mn, d); }
    if (deg === 2) return mn > 2.6 ? 1 : Math.min(9, 4 / Math.tan(Math.min(mn, 3.1) / 2) + 1.5);
    return Math.max(7.5, Math.min(22, 5.2 / Math.tan(Math.min(mn, 3.1) / 2) + 3));
  }
  // rebuild every lane + connector; cars keep their place where their lane survives
  rebuild() {
    const old = this.lanes; this.lanes = new Map(); this.links = [];
    const trims = new Map(); for (const n of this.nodes.values()) { n.trim = this.trimOf(n); trims.set(n.id, n.trim); n.ins = []; n.outs = []; n.conns = []; n.deg = n.edges.size; }
    for (const e of this.edges.values()) {
      e.lanes = [];
      for (const dir of [1, -1]) {
        if (e.oneway && e.oneway !== dir) continue;
        const from = this.nodes.get(dir > 0 ? e.a : e.b), to = this.nodes.get(dir > 0 ? e.b : e.a);
        const base = dir > 0 ? e.pts : [...e.pts].reverse();
        const off = offset(base, e.oneway ? 0 : LANE_W / 2), cum = cumOf(off), L = cum[cum.length - 1];
        let t0 = from.trim, t1 = to.trim; if (t0 + t1 > L - 3) { const k = (L - 3) / (t0 + t1); t0 *= k; t1 *= k; }
        const pts = cut(off, cum, t0, L - t1);
        const lane = { key: e.id + (dir > 0 ? 'f' : 'b'), edge: e, dir, from, to, pts, cum: cumOf(pts), conn: false, cars: [], vmax: e.ring ? 8.5 : LIMIT, prio: !!e.ring, t0, k: 1, next: [], spd: LIMIT, inc: 0 };
        lane.len = lane.cum[lane.cum.length - 1];
        lane.k = lane.len / Math.max(1, L - t0 - t1);
        const o = old.get(lane.key); if (o) lane.spd = o.spd;
        this.lanes.set(lane.key, lane); this.links.push(lane); e.lanes.push(lane);
        from.outs.push(lane); to.ins.push(lane);
      }
    }
    // connectors through each node
    for (const n of this.nodes.values()) {
      for (const L of n.ins) for (const O of n.outs) {
        if (O.edge === L.edge && n.deg > 1) continue;
        const p0 = L.pts[L.pts.length - 1], p1 = O.pts[0];
        const h0 = along(L.pts, L.cum, L.len); const h1 = along(O.pts, O.cum, 0);
        const cr = h0[2] * h1[3] - h0[3] * h1[2], dt = h0[2] * h1[2] + h0[3] * h1[3];
        let ctl = lerp2(p0, p1, .5);
        if (Math.abs(cr) > .08) {
          const x = segLine(p0, [h0[2], h0[3]], p1, [h1[2], h1[3]]);
          if (x && x[0] > 0 && x[0] < 40 && x[1] < 0) ctl = [p0[0] + h0[2] * x[0], p0[1] + h0[3] * x[0]];
        } else if (dt < 0) {       // U-turn at a dead end: swing out wide
          ctl = [ (p0[0] + p1[0]) / 2 + h0[2] * 7, (p0[1] + p1[1]) / 2 + h0[3] * 7 ];
        }
        const M = Math.max(3, Math.ceil((dist(p0, ctl) + dist(ctl, p1)) / 1.5)); const pts = []; for (let i = 0; i <= M; i++) pts.push(qpt(p0, ctl, p1, i / M));
        const cum = cumOf(pts), len = cum[cum.length - 1];
        const ang = Math.atan2(cr, dt), turn = Math.abs(ang) < .5 ? 0 : ang > 0 ? 1 : 2;  // 0 straight, 1 right, 2 left
        const chord = dist(p0, p1), R = Math.abs(ang) > .1 ? chord / (2 * Math.sin(Math.abs(ang) / 2)) : 1e3;
        const c = { key: L.key + '>' + O.key, conn: true, in: L, out: O, node: n, pts, cum, len: Math.max(.5, len), cars: [], turn, ang,
          vmax: Math.min(LIMIT, Math.max(3.2, Math.sqrt(2.6 * R))), conflicts: [], busy: 0, next: [O], spd: LIMIT, prio: L.prio };
        const o = old.get(c.key); if (o) c.spd = o.spd;
        this.lanes.set(c.key, c); n.conns.push(c); L.next.push(c);
      }
      // conflicts: different approaches whose paths cross or merge
      const cs = n.conns;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j]; if (a.in === b.in) continue;
        let hit = a.out === b.out;
        if (!hit) outer: for (let p = 1; p < a.pts.length; p++) for (let q = 1; q < b.pts.length; q++) if (segX(a.pts[p - 1], a.pts[p], b.pts[q - 1], b.pts[q])) { hit = true; break outer; }
        if (hit) { a.conflicts.push(b); b.conflicts.push(a); }
      }
      // signal groups: approaches split by axis
      if (n.sig) {
        const ins = n.ins.map(L => { const h = along(L.pts, L.cum, L.len); return { L, a: Math.atan2(h[3], h[2]) }; });
        const groups = [];
        for (const it of ins) {
          let g = groups.find(g => { let d = Math.abs(((it.a - g.a) % Math.PI + Math.PI) % Math.PI); d = Math.min(d, Math.PI - d); return d < .5; });
          if (!g) { g = { a: it.a, ls: [] }; groups.push(g); }
          g.ls.push(it.L); it.L.sg = groups.indexOf(g);
        }
        n.sig.groups = groups.length; if (n.sig.phase >= groups.length) n.sig.phase = 0;
      }
    }
    // move cars onto the new lanes
    const keep = [];
    for (const car of this.cars) {
      let lane = this.lanes.get(car.lane.key);
      if (!lane && car.lane.conn) { lane = this.lanes.get(car.lane.out.key); if (lane) car.s = 0; }
      if (!lane) continue;
      car.lane = lane; car.s = Math.min(car.s, lane.len); car.granted = lane.conn ? lane : null; car.oldRoute = car.route; car.oldRi = car.ri; car.route = null; lane.cars.push(car);
      const d = this.lanes.get(car.destKey); if (!d) continue;
      car.dest = d; car.destS = Math.min(car.destS, d.len - .5);
      keep.push(car);
    }
    this.cars = keep;
    for (const car of this.cars) {    // keep a route whose lanes all survived; re-plan the rest
      const r = car.oldRoute ? car.oldRoute.slice(car.oldRi).map(l => this.lanes.get(l.key)) : null;
      if (r && r.length && r[0] === car.lane && r.every(Boolean) && r.at(-1) === car.dest) { car.route = r; car.ri = 0; }
      else this.reroute(car);
      car.oldRoute = null;
    }
    this.cars = this.cars.filter(c => c.route);
    for (const l of this.lanes.values()) { l.cars = l.cars.filter(c => c.route); if (l.conn) l.busy = l.cars.length; }
    this.built = this.ver;
  }

  // ---------------- routing ----------------
  cost(l) {
    let c = l.len / Math.max(1.2, Math.min(l.spd, l.vmax));
    if (l.conn) { const n = l.node; c += n.sig ? 7 : n.deg > 2 ? (l.prio ? .5 : 2.5) : 0; if (l.turn === 2) c += 2; }
    return c;
  }
  // lanes from `start` (car at s) to dest lane; returns array of lanes or null
  route(start, s, dest, destS) {
    if (start === dest && destS > s + 3) return [start];
    const best = new Map(), prev = new Map(), h = new Heap();
    const c0 = (start.len - s) / Math.max(1.2, start.spd);
    for (const nx of start.next) { const c = c0 + this.cost(nx); best.set(nx, c); prev.set(nx, start); h.push(c, nx); }
    let guard = 0;
    while (h.size && guard++ < 40000) {
      const [c, l] = h.pop(); if (c > (best.get(l) ?? 1e18)) continue;
      if (l === dest) { const path = [l]; let p = prev.get(l); while (p) { path.push(p); if (p === start) break; p = prev.get(p); } return path.reverse(); }
      for (const nx of l.next) {
        const nc = c + (nx === dest ? destS / Math.max(1.2, nx.spd) : this.cost(nx));
        if (nc < (best.get(nx) ?? 1e18)) { best.set(nx, nc); prev.set(nx, l); h.push(nc, nx); }
      }
    }
    return null;
  }
  reroute(car) {
    let r = this.route(car.lane, car.s, car.dest, car.destS);
    if (!r && car.dest.edge) { // try the other side of the street
      const other = car.dest.edge.lanes.find(l => l !== car.dest);
      if (other) { const s2 = Math.max(1, Math.min(other.len - 1, other.len - car.destS)); r = this.route(car.lane, car.s, other, s2); if (r) { car.dest = other; car.destKey = other.key; car.destS = s2; } }
    }
    if (r) { car.route = r; car.ri = 0; }
    else if (!car.route) car.route = null;
    return !!r;
  }
  // lane + s for a spot on an edge (x,z near the road)
  spotOn(e, x, z) {
    const c = closestOnPoly(e.pts, e.cum, x, z), out = [];
    for (const l of e.lanes) {
      const arc = l.dir > 0 ? c.s : e.len - c.s;
      const s = (arc - (l.dir > 0 ? l.from.trim : l.from.trim)) * l.k;
      out.push({ lane: l, s: Math.max(1.5, Math.min(l.len - 1.5, s)) });
    }
    return out;
  }
  // try to start a trip. from/to: {e, x, z}. Returns car or a failure string.
  spawn(from, to, kindRoll = Math.random(), colorRoll = Math.random()) {
    if (this.built !== this.ver) this.rebuild();
    let acc = 0, ty = TYPES[0]; for (const t of TYPES) { acc += t.share; if (kindRoll < acc) { ty = t; break; } }
    const A = this.spotOn(from.e, from.x, from.z).filter(a => !a.lane.cars.some(o => Math.abs(o.s - a.s) < ty.len + 6)), B = this.spotOn(to.e, to.x, to.z);
    if (!A.length) return 'busy';
    if (!B.length) return 'stranded';
    let best = null;
    for (const a of A) for (const b of B) {
      const r = this.route(a.lane, a.s, b.lane, b.s); if (!r) continue;
      let c = 0; for (let i = 1; i < r.length; i++) c += this.cost(r[i]);
      if (!best || c < best.c) best = { a, b, r, c };
    }
    if (!best) return 'stranded';
    const car = { id: this.carId++, lane: best.a.lane, s: best.a.s, v: 0, len: ty.len, w: ty.w, type: ty.k, slow: ty.slow || 1,
      dest: best.b.lane, destKey: best.b.lane.key, destS: best.b.s, route: best.r, ri: 0, granted: null, wait: 0, stuck: 0, born: this.time,
      color: colorRoll, arrT: 0, x: 0, z: 0, hx: 1, hz: 0, rerouteT: 0, brake: 0 };
    best.a.lane.cars.push(car); this.cars.push(car); this.stats.spawned++;
    return car;
  }

  // ---------------- junction rules ----------------
  room(car, conn) {
    const out = conn.out; let tail = out.len;
    for (const o of out.cars) tail = Math.min(tail, o.s - o.len);
    const need = Math.min(car.len + 1.5, out.len * .6) + out.inc;
    return tail >= need;
  }
  sigState(n, L) {          // 'g' | 'y' | 'r' for approach lane L
    const s = n.sig; if (!s) return 'g';
    if (L.sg !== s.phase) return 'r';
    return s.st === 'g' ? 'g' : s.st === 'y' ? 'y' : 'r';
  }
  canEnter(car, conn, distLeft) {
    const n = conn.node;
    if (!this.room(car, conn)) { car.why = 'room'; return false; }
    if (n.deg <= 2 && !n.ring) return true;
    if (conn.out.prio && !conn.in.prio) {    // entering a roundabout: never fill the ring
      const r = this.ringOcc.get(conn.out.edge.ring);
      if (r && r.occ + car.len + 6 > r.cap * .55) { car.why = 'ringfull'; return false; }
    }
    if (n.sig) {
      const st = this.sigState(n, conn.in);
      if (st === 'r') { car.why = 'red'; return false; }
      if (st === 'y' && distLeft > car.v * car.v / (2 * 3.5) + 1) { car.why = 'red'; return false; }
    }
    for (const c of conn.conflicts) if (c.busy > 0) { car.why = 'busy'; return false; }
    // yield to approaching traffic that has priority
    for (const c of conn.conflicts) {
      const L = c.in; if (L === conn.in) continue;
      let theyFirst;
      if (n.sig) theyFirst = this.sigState(n, L) !== 'r' && c.turn < conn.turn;
      else if (L.prio !== conn.in.prio) theyFirst = L.prio;
      else theyFirst = null;   // same rank: first come first served
      const f = L.cars.length ? L.cars.reduce((m, o) => o.s > m.s ? o : m) : null;
      if (!f || f.granted) continue;
      const nxt = f.route && f.route[f.ri + 1]; if (nxt !== c) continue;
      const d = L.len - f.s;
      if (theyFirst === true) { if (d < 6 + f.v * 3.2) { car.why = 'yieldprio'; return false; } }
      else if (theyFirst === null) { if (f.arrT && (!car.arrT || f.arrT < car.arrT - .01 || (Math.abs(f.arrT - car.arrT) < .01 && f.id < car.id)) && this.room(f, c)) { car.why = 'fcfs'; return false; } }
    }
    return true;
  }

  // ---------------- simulation step ----------------
  step(dt) {
    if (this.built !== this.ver) this.rebuild();
    this.time += dt;
    // signals (actuated: a green with nobody waiting ends early)
    for (const n of this.nodes.values()) {
      const s = n.sig; if (!s || !s.groups) continue;
      s.t += dt;
      if (s.st === 'g') {
        const waitingHere = n.ins.some(L => L.sg === s.phase && L.cars.some(c => L.len - c.s < 40));
        const waitingElse = n.ins.some(L => L.sg !== s.phase && L.cars.some(c => L.len - c.s < 30));
        if (s.t > 32 || (s.t > 7 && !waitingHere && waitingElse)) { s.st = 'y'; s.t = 0; }
      } else if (s.st === 'y' && s.t > 3) { s.st = 'a'; s.t = 0; }
      else if (s.st === 'a' && s.t > 1.5) { s.st = 'g'; s.t = 0; s.phase = (s.phase + 1) % s.groups; }
    }
    for (const l of this.lanes.values()) { if (l.cars.length > 1) l.cars.sort((a, b) => b.s - a.s); l.inc = 0; }
    // how full each roundabout is
    this.ringOcc = new Map();
    for (const l of this.lanes.values()) {
      const rid = l.conn ? (l.in.edge.ring && l.out.edge.ring ? l.in.edge.ring : (l.out.edge.ring && !l.in.edge.ring ? l.out.edge.ring : 0)) : l.edge.ring;
      if (!rid) continue;
      let r = this.ringOcc.get(rid); if (!r) { r = { occ: 0, cap: 0 }; this.ringOcc.set(rid, r); }
      if (!l.conn || l.in.edge.ring) r.cap += l.len;
      for (const c of l.cars) r.occ += c.len + 2;
    }
    for (const car of this.cars) if (car.granted && !car.lane.conn && car.granted.out.prio && !car.lane.prio) { const r = this.ringOcc.get(car.granted.out.edge.ring); if (r) r.occ += car.len + 2; }
    for (const car of this.cars) if (car.granted && !car.lane.conn) car.granted.out.inc += car.len + 2;
    for (const l of this.lanes.values()) if (l.conn) for (const c of l.cars) l.out.inc += c.len + 2;

    const done = [];
    for (const car of this.cars) {
      const lane = car.lane, idx = lane.cars.indexOf(car);
      let gap = 1e4, lv = 0, ahead = lane.len - car.s, v0 = lane.vmax * car.slow;
      if (idx > 0) { const L = lane.cars[idx - 1]; gap = L.s - L.len - car.s; lv = L.v; car.gw = 'leader'; } else car.gw = 'free';
      // destination: stop at it
      if (lane === car.dest) { const d = car.destS - car.s; if (d < gap) { gap = d + 3; lv = 0; car.gw = 'dest'; } }
      else if (idx === 0 || ahead < 80) {
        // look ahead along the route
        let d = ahead, k = car.ri + 1, prevConnOk = true, steps = 0, lead = idx === 0;
        while (d < 90 && steps++ < 5) {
          const nx = car.route[k]; if (!nx) break;
          if (nx.conn && car.route[k - 1] === lane && !lane.conn) {
            // the junction ahead of us
            if (car.granted !== nx) {
              if (lead) {
                if (d < 8 && !car.arrT) car.arrT = this.time;
                if (d < car.v * car.v / (2 * DEC) + 18 && this.canEnter(car, nx, d)) { car.granted = nx; nx.busy++; car.arrT = 0; }
              }
              if (car.granted !== nx) { if (d - .3 < gap) { gap = d - .3; lv = 0; car.gw = 'line'; } prevConnOk = false; break; }
            }
          } else if (nx.conn && k > car.ri + 1) {  // a later junction: don't plan through it, just slow for it
            if (d < gap) { gap = d + 4; lv = Math.min(lv, nx.vmax); car.gw = 'later'; }
            break;
          }
          // turn speed
          v0 = Math.min(v0, Math.sqrt(nx.vmax * nx.vmax + 2 * 1.8 * Math.max(0, d - 2)));
          if (idx === 0 || k > car.ri + 1) {
            let tail = null; for (const o of nx.cars) if (!tail || o.s < tail.s) tail = o;
            if (tail) { const g = d + tail.s - tail.len; if (g < gap) { gap = g; lv = tail.v; car.gw = 'tail'; car.gwId = tail.id; } break; }
          }
          if (nx === car.dest) { const g = d + car.destS; if (g < gap) { gap = g + 3; lv = 0; car.gw = 'dest2'; } break; }
          d += nx.len; k++;
        }
        void prevConnOk;
      }
      // IDM
      const v = car.v, dv = v - lv, ss = S0 + Math.max(0, v * HEAD + v * dv / (2 * Math.sqrt(ACC * DEC)));
      let a = ACC * (1 - Math.pow(v / Math.max(.5, v0), 4)) - ACC * (ss / Math.max(.1, gap)) ** 2;
      a = Math.max(-9, Math.min(ACC, a));
      car.brake = a < -1 ? 1 : 0;
      car.v = Math.max(0, v + a * dt);
      let mv = car.v * dt;
      if (gap < 1e4) mv = Math.min(mv, Math.max(0, gap - .2));
      car.s += mv;
      // lane changes along the route
      while (car.s > car.lane.len) {
        const nx = car.route[car.ri + 1];
        if (!nx) { car.s = car.lane.len; break; }
        if (nx.conn && car.granted !== nx) { car.s = car.lane.len; car.v = 0; break; }
        const was = car.lane;
        car.s -= was.len; was.cars.splice(was.cars.indexOf(car), 1);
        if (was.conn) was.busy = Math.max(0, was.busy - 1);
        car.ri++; car.lane = nx; nx.cars.push(car);
        if (!nx.conn) car.granted = null;
      }
      if (car.lane === car.dest && car.s >= car.destS - .5) done.push(car);
      // waiting
      if (car.v < .6) { car.stuck += dt; } else if (car.v > 2.5) car.stuck = 0;
      if (car.v < 3) car.wait += dt;
      // a car stuck at a junction tries another way now and then
      car.rerouteT += dt;
      if (car.stuck > 12 && car.rerouteT > 10 && !car.lane.conn && !car.granted) { car.rerouteT = 0; this.reroute(car); }
      if (car.stuck > GIVE_UP) { car.gave = true; done.push(car); }
      // lane speed estimate for routing (slow EMA)
      car.lane.spd += (car.v - car.lane.spd) * Math.min(1, dt * .08);
    }
    for (const car of done) this.remove(car);
    // empty lanes drift back to free flow
    for (const l of this.lanes.values()) if (!l.cars.length) l.spd += (l.vmax - l.spd) * Math.min(1, dt * .05);
    // world positions for drawing
    for (const car of this.cars) { const p = along(car.lane.pts, car.lane.cum, car.s - car.len / 2); car.x = p[0]; car.z = p[1]; car.hx = p[2]; car.hz = p[3]; }
  }
  remove(car) {
    const l = car.lane, i = l.cars.indexOf(car); if (i >= 0) l.cars.splice(i, 1);
    if (l.conn) l.busy = Math.max(0, l.busy - 1);
    if (car.granted && car.granted !== l) car.granted.busy = Math.max(0, car.granted.busy - 1);
    const j = this.cars.indexOf(car); if (j >= 0) this.cars.splice(j, 1);
    if (car.gave) this.stats.gaveUp++; else { const d = this.time - car.born; this.stats.arrived++; this.stats.tripSec += d; this.stats.ema = this.stats.ema ? this.stats.ema * .97 + d * .03 : d; }
  }
}

// ray/ray: p + t*d = q + u*e -> [t, u]
function segLine(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  const u = ((q[0] - p[0]) * d[1] - (q[1] - p[1]) * d[0]) / den;
  return [t, u];
}
