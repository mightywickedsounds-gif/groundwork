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
export const MAX_LANES = 3;         // lanes each way
// what the Lanes tool steps through: [lanes each way, turn lanes]
export const LANE_STEPS = [[1, 0], [1, 1], [2, 0], [2, 1], [3, 1]];

// half the width of a road's carriageway (kerb to kerb / 2)
export function halfW(e) {
  const nl = e.ring ? 1 : (e.nl || 1), tl = e.ring ? 0 : (e.tl || 0);
  if (e.oneway || e.ring) return nl === 1 && !tl ? ONEWAY_W / 2 : (nl * LANE_W + (tl ? LANE_W : 0) + .6) / 2;
  return nl * LANE_W + (tl ? LANE_W / 2 : 0);
}
// how far right of the centreline lane i sits, facing the way it drives (0 = kerb lane, nl = turn lane)
export function laneOff(e, i) {
  if (e.ring) return 0;
  const nl = e.nl || 1, tl = e.tl || 0;
  if (e.oneway) return nl === 1 && !tl ? 0 : halfW(e) - .3 - (i + .5) * LANE_W;
  if (i >= nl) return 0;              // the turn lane sits in the middle
  return (tl ? LANE_W / 2 : 0) + (nl - 1 - i + .5) * LANE_W;
}

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
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } e.bb = [x0, x1, z0, z1];
  }
  addEdge(a, b, cx, cz, o = {}) {
    if (a === b) return null;
    for (const id of this.nodes.get(a).edges) { const f = this.edges.get(id); if ((f.a === a && f.b === b) || (f.a === b && f.b === a)) return null; }
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (cx == null) { cx = (A.x + B.x) / 2; cz = (A.z + B.z) / 2; }
    const e = { id: this.eid++, a, b, cx, cz, oneway: o.oneway || 0, ring: o.ring || 0, kind: o.kind || 'street', nl: o.nl || 1, tl: o.tl || 0, lanes: [] };
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
    const n = this.addNode(m[0], m[1]); const o = { oneway: e.oneway, ring: e.ring, kind: e.kind, nl: e.nl, tl: e.tl };
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
    for (const e of this.edges.values()) { const b = e.bb; if (x < b[0] - bd || x > b[1] + bd || z < b[2] - bd || z > b[3] + bd) continue; const c = closestOnPoly(e.pts, e.cum, x, z); if (c.d < bd) { bd = c.d; best = { e, s: c.s, d: c.d }; } }
    return best;
  }
  // do these edges cross any road they don't share a junction with?
  crossesOthers(list) {
    for (const e of list) {
      if (!this.edges.has(e.id)) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of e.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (const f of this.edges.values()) {
        if (f === e || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
        const [fx0, fx1, fz0, fz1] = f.bb;
        if (fx0 > x1 || x0 > fx1 || fz0 > z1 || z0 > fz1) continue;
        for (let i = 1; i < e.pts.length; i++) for (let j = 1; j < f.pts.length; j++) { const x = segX(e.pts[i - 1], e.pts[i], f.pts[j - 1], f.pts[j]); if (x && x[0] > .01 && x[0] < .99 && x[1] > .01 && x[1] < .99) return true; }
      }
    }
    return false;
  }
  // put the network back as it was (cars keep their places where their lanes still exist)
  restore(snap) { const cars = this.cars; this.load(snap); this.cars = cars; this.built = -1; }
  // a click point -> node (existing, on a road, or new)
  snapNode(x, z, make = true, r = SNAP) {
    const q = this.probe(x, z, r);
    if (!make) return q.n || (q.e ? { x: q.p[0], z: q.p[1], virt: true } : null);
    return this.realize(q);
  }
  // what a point would join: an existing node, a spot on a road, or open ground
  probe(x, z, r = SNAP) {
    const n = this.nearestNode(x, z, r), h = this.nearestEdge(x, z, r);
    if (n && (!h || Math.hypot(n.x - x, n.z - z) <= h.d + 7)) return { n };
    if (h) {
      const A = this.nodes.get(h.e.a), B = this.nodes.get(h.e.b);
      if (h.e.ring) return { n: Math.hypot(A.x - x, A.z - z) < Math.hypot(B.x - x, B.z - z) ? A : B };
      if (h.s < 9) return { n: A };
      if (h.s > h.e.len - 9) return { n: B };
      const p = along(h.e.pts, h.e.cum, h.s); return { e: h.e, s: h.s, p: [p[0], p[1]] };
    }
    return { p: [x, z] };
  }
  realize(q) {
    if (q.n) return this.nodes.has(q.n.id) ? q.n : this.addNode(q.n.x, q.n.z);
    if (q.e) {
      const e = this.edges.has(q.e.id) ? q.e : (this.nearestEdge(q.p[0], q.p[1], 3) || {}).e;
      if (e && !e.ring) { const c = closestOnPoly(e.pts, e.cum, q.p[0], q.p[1]); if (c.s > 3 && c.s < e.len - 3) return this.splitEdge(e, this.tAt(e, c.s), q.p); }
      const n = this.nearestNode(q.p[0], q.p[1], 6); if (n) return n;
    }
    return this.addNode(q.p[0], q.p[1]);
  }
  // plan a road without changing anything: endpoints, curve, crossings, or a reason it can't be built
  planRoad(p0, p1, c = null, r = SNAP) {
    let qa = this.probe(p0[0], p0[1], r), qb = this.probe(p1[0], p1[1], r);
    const P = q => q.n ? [q.n.x, q.n.z] : q.p;
    if (qa.n && qb.n && qa.n === qb.n) { if (dist(p0, p1) > 14) qb = { p: p1 }; else return { reason: 'Too short' }; }
    if (qa.e && qb.e && qa.e === qb.e) return { reason: 'There\'s already a road there' };
    let a = P(qa), b = P(qb);
    if (dist(a, b) < 8) return { reason: 'Too short' };
    if (qa.n && qb.n) for (const id of qa.n.edges) { const f = this.edges.get(id); if (f.a === qb.n.id || f.b === qb.n.id) return { reason: 'There\'s already a road there' }; }
    let cc = c || lerp2(a, b, .5);
    const curve = () => { const M = Math.max(4, Math.ceil((dist(a, cc) + dist(cc, b)) / 2.5)), pts = []; for (let i = 0; i <= M; i++) pts.push(qpt(a, cc, b, i / M)); return pts; };
    let pts = curve();
    // crossings; a free end just past a road snaps back onto it
    const hitsOf = pts => {
      const out = [], M = pts.length - 1;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (const e of this.edges.values()) if (!(e.bb[0] > x1 || e.bb[1] < x0 || e.bb[2] > z1 || e.bb[3] < z0)) for (let i = 1; i < pts.length; i++) for (let j = 1; j < e.pts.length; j++) {
        const x = segX(pts[i - 1], pts[i], e.pts[j - 1], e.pts[j]); if (!x) continue;
        out.push({ t: (i - 1 + x[0]) / M, e, s: e.cum[j - 1] + (e.cum[j] - e.cum[j - 1]) * x[1], pt: lerp2(pts[i - 1], pts[i], x[0]) });
      }
      out.sort((p, q) => p.t - q.t);
      return out.filter((h, i) => !out.slice(0, i).some(g => g.e === h.e && dist(g.pt, h.pt) < .5));   // a crossing right on a sample point counts once
    };
    let hits = hitsOf(pts);
    const endFix = (q, near) => { if (q.n || q.e) return q; const h = near(); if (!h) return q; return h.e.ring ? q : (h.s < 9 ? { n: this.nodes.get(h.e.a) } : h.s > h.e.len - 9 ? { n: this.nodes.get(h.e.b) } : { e: h.e, s: h.s, p: h.pt }); };
    const nqb = endFix(qb, () => [...hits].reverse().find(h => dist(h.pt, b) < 10 && dist(h.pt, a) > 10));
    const nqa = endFix(qa, () => hits.find(h => dist(h.pt, a) < 10 && dist(h.pt, b) > 10));
    if (nqa !== qa || nqb !== qb) {
      qa = nqa; qb = nqb; const a2 = P(qa), b2 = P(qb);
      if (!c) cc = lerp2(a2, b2, .5); a = a2; b = b2;
      if (dist(a, b) < 8) return { reason: 'Too short' };
      pts = curve(); hits = hitsOf(pts);
    }
    // every crossing becomes a junction: an end of the crossed road if one is close, else a new one on it
    const ends = new Set([qa.n, qb.n].filter(Boolean)), endEdges = new Set([qa.e, qb.e].filter(Boolean));
    const stops = [];
    for (const h of hits) {
      if (endEdges.has(h.e)) continue;
      if ((qa.n && (h.e.a === qa.n.id || h.e.b === qa.n.id) && dist(h.pt, a) < 12) || (qb.n && (h.e.a === qb.n.id || h.e.b === qb.n.id) && dist(h.pt, b) < 12)) continue;
      const EA = this.nodes.get(h.e.a), EB = this.nodes.get(h.e.b);
      let st = null;
      for (const N of [EA, EB]) if (Math.hypot(N.x - h.pt[0], N.z - h.pt[1]) < 9 && (!st || Math.hypot(N.x - h.pt[0], N.z - h.pt[1]) < Math.hypot(st.n.x - h.pt[0], st.n.z - h.pt[1]))) st = { t: h.t, n: N };
      if (!st) st = { t: h.t, e: h.e, s: h.s, pt: h.pt };
      if (h.e.ring) { st.ring = h.e.ring; if (st.e) { const c = this.ringCenter(h.e.ring), R = this.ringR(h.e.ring), ang = Math.atan2(h.pt[1] - c[1], h.pt[0] - c[0]); st.pt = [c[0] + Math.cos(ang) * R, c[1] + Math.sin(ang) * R]; } }
      if (st.n && (ends.has(st.n) || stops.some(x => x.n === st.n))) continue;
      stops.push(st);
    }
    const ringOf = q => q.ring || (q.n && q.n.ring) || 0;
    // pieces must be long enough to drive (gaps here are what made roads glitch before)
    const list = [{ t: 0, pt: a, ring: ringOf(qa) }, ...stops.map(x => ({ ...x, pt: x.n ? [x.n.x, x.n.z] : x.pt })), { t: 1, pt: b, ring: ringOf(qb) }];
    for (let k = 1; k < list.length; k++) {
      if (list[k].ring && list[k].ring === list[k - 1].ring) continue;   // through a roundabout: no road across the island
      if (dist(list[k].pt, list[k - 1].pt) < 5) return { reason: 'Too close to another road' };
    }
    return { qa, qb, a, b, cc, stops, pts };
  }
  // build a road from p0 to p1 (optional bend control c). Crossings become junctions.
  // Returns the new edges (array); if nothing was built, the array has .reason
  addRoad(p0, p1, c = null, o = {}, r = SNAP) {
    const plan = this.planRoad(p0, p1, c, r), made = [];
    if (plan.reason) { made.reason = plan.reason; return made; }
    const snap = this.serialize(), eid0 = this.eid;
    const A = this.realize(plan.qa), B = this.realize(plan.qb);
    if (A === B) { made.reason = 'Too short'; return made; }
    const a = [A.x, A.z], b = [B.x, B.z], cc = c ? plan.cc : lerp2(a, b, .5);
    const stops = [{ t: 0, n: A }];
    for (const st of plan.stops) {
      let n = st.n && this.nodes.has(st.n.id) ? st.n : null;
      if (!n) {
        const near = this.nearestEdge(st.pt[0], st.pt[1], 3);
        if (!near) continue;
        n = near.s < 2 ? this.nodes.get(near.e.a) : near.s > near.e.len - 2 ? this.nodes.get(near.e.b) : this.splitEdge(near.e, this.tAt(near.e, near.s), st.pt);
        if (st.ring && !n.ring) { n.ring = st.ring; const any = [...this.nodes.values()].find(m => m.ring === st.ring && m.rc); if (any) n.rc = any.rc; }
      }
      if (n === A || n === B || stops.some(x => x.n === n)) continue;
      stops.push({ t: st.t, n });
    }
    stops.push({ t: 1, n: B });
    let p0c = a, pc = cc, p1c = b, tPrev = 0;
    for (let k = 1; k < stops.length; k++) {
      const t = k === stops.length - 1 ? 1 : (stops[k].t - tPrev) / (1 - tPrev);
      const q0 = lerp2(p0c, pc, t), q1 = lerp2(pc, p1c, t), m = lerp2(q0, q1, t);
      const n0 = stops[k - 1].n, n1 = stops[k].n;
      if (!(n0.ring && n0.ring === n1.ring)) { const e = this.addEdge(n0.id, n1.id, q0[0], q0[1], o) || this.addEdge(n0.id, n1.id, null, null, o); if (e) made.push(e); }
      p0c = m; pc = q1; tPrev = stops[k].t;
    }
    for (const n of [A, B]) if (!n.edges.size) this.nodes.delete(n.id);
    if (!made.length) made.reason = 'There\'s already a road there';
    // the new road and every road it split must not cross anything without a junction
    else if (this.crossesOthers([...this.edges.values()].filter(e => e.id >= eid0))) { this.restore(snap); const out = []; out.reason = 'Too close to another road'; return out; }
    made.end = [B.x, B.z];
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
  // this road plus the pieces joined end to end with it (through bends, not through junctions)
  roadChain(e) {
    const out = [e], seen = new Set([e.id]);
    for (const start of [e.a, e.b]) {
      let nid = start, cur = e;
      for (;;) {
        const n = this.nodes.get(nid); if (!n || n.ring || n.edges.size !== 2) break;
        const id = [...n.edges].find(i => i !== cur.id); if (seen.has(id)) break;
        const f = this.edges.get(id); if (!f || f.ring) break;
        seen.add(id); out.push(f); cur = f; nid = f.a === nid ? f.b : f.a;
      }
    }
    return out;
  }
  // Lanes tool: 1 lane -> 1 + turn lanes -> 2 -> 2 + turn lanes -> 3 + turn lanes -> 1
  nextLanes(e) { const i = LANE_STEPS.findIndex(s => s[0] === (e.nl || 1) && s[1] === (e.tl || 0)); return LANE_STEPS[(i + 1) % LANE_STEPS.length]; }
  cycleLanes(eid) {
    const e = this.edges.get(eid); if (!e || e.ring) return null;
    const [nl, tl] = this.nextLanes(e), chain = this.roadChain(e);
    for (const f of chain) { f.nl = nl; f.tl = tl; }
    // where wide roads cross (or one ends at another) at a plain junction, put up traffic lights (one at a time doesn't work there)
    let lights = 0;
    if (nl >= 2) for (const f of chain) for (const nid of [f.a, f.b]) {
      const n = this.nodes.get(nid); if (!n || n.ring || n.sig || n.edges.size < 3) continue;
      let wide = 0; for (const id of n.edges) if ((this.edges.get(id).nl || 1) >= 2) wide++;
      if (wide >= 3) { n.sig = { phase: 0, t: 0, st: 'g' }; lights++; }
    }
    this.ver++; return { nl, tl, lights };
  }
  // how big a roundabout fits at node n (0 if none)
  ringFit(n, Rwant = RING_R) {
    let R = Rwant; for (const id of n.edges) R = Math.min(R, this.edges.get(id).len - 7);
    for (const e of this.edges.values()) {   // other roads nearby must stay outside the ring
      if (e.a === n.id || e.b === n.id) continue;
      const c = closestOnPoly(e.pts, e.cum, n.x, n.z); if (c.d < R + 9) R = Math.min(R, c.d - 9);
    }
    return R >= 8 ? R : 0;
  }
  // turn a junction, bend or road end into a roundabout. Returns ring id or a reason string.
  makeRoundabout(nid, Rwant = RING_R) {
    const n = this.nodes.get(nid); if (!n) return 'Tap a road or junction';
    if (n.ring) return 'Already a roundabout';
    if (!n.edges.size) return 'Tap a road or junction';
    const R = this.ringFit(n, Rwant); if (!R) return 'Not enough room here';
    const snap = this.serialize(), eid0 = this.eid;
    const spokes = [];
    for (const id of n.edges) {
      const e = this.edges.get(id), fromA = e.a === n.id, s = fromA ? R : e.len - R;
      const p = along(e.pts, e.cum, s); spokes.push({ e, fromA, s, ang: Math.atan2(p[1] - n.z, p[0] - n.x) });
    }
    spokes.sort((p, q) => p.ang - q.ang);
    // roads leaving at nearly the same angle share one entrance
    const groups = [];
    for (const sp of spokes) { const g = groups[groups.length - 1]; if (g && sp.ang - g.at(-1).ang < .5) g.push(sp); else groups.push([sp]); }
    if (groups.length > 1) { const f = groups[0], l = groups.at(-1); if (f[0].ang + Math.PI * 2 - l.at(-1).ang < .5) { for (const sp of f) l.push({ ...sp, ang: sp.ang + Math.PI * 2 }); groups.shift(); } }
    const rid = this.rid++, ringNodes = [];
    for (const g of groups) {
      let node = null, sx = 0, sz = 0;
      for (const sp of g) {
        sx += Math.cos(sp.ang); sz += Math.sin(sp.ang);
        const m = this.splitEdge(sp.e, this.tAt(sp.e, sp.s));
        for (const id of [...m.edges]) { const f = this.edges.get(id); if (f.a === n.id || f.b === n.id) this.delEdge(id); }
        if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
        if (!node) { node = m; continue; }
        for (const id of [...m.edges]) {   // hook this road onto the shared entrance
          const f = this.edges.get(id), o = { oneway: f.oneway, kind: f.kind, nl: f.nl, tl: f.tl };
          if (f.a === m.id) this.addEdge(node.id, f.b, f.cx, f.cz, o); else this.addEdge(f.a, node.id, f.cx, f.cz, o);
          this.delEdge(id);
        }
        this.nodes.delete(m.id);
      }
      const ang = Math.atan2(sz, sx);
      node.x = n.x + Math.cos(ang) * R; node.z = n.z + Math.sin(ang) * R; node.ring = rid; node.sig = null;
      for (const id of node.edges) this.edgeGeom(this.edges.get(id));
      ringNodes.push({ n: node, ang });
    }
    this.nodes.delete(n.id);
    ringNodes.sort((p, q) => p.ang - q.ang);
    // fill big gaps so arcs stay round
    const all = [];
    for (let i = 0; i < ringNodes.length; i++) {
      const a0 = ringNodes[i].ang, a1 = i + 1 < ringNodes.length ? ringNodes[i + 1].ang : ringNodes[0].ang + Math.PI * 2;
      all.push(ringNodes[i]);
      const k = Math.floor((a1 - a0) / 1.75);
      for (let j = 1; j <= k; j++) { const ang = a0 + (a1 - a0) * j / (k + 1); const f = this.addNode(n.x + Math.cos(ang) * R, n.z + Math.sin(ang) * R); f.ring = rid; all.push({ n: f, ang }); }
    }
    for (const r of all) r.n.rc = [n.x, n.z, R];
    // one-way arcs going the way of decreasing angle (island on the driver's left)
    for (let i = 0; i < all.length; i++) {
      const from = all[(i + 1) % all.length], to = all[i];
      let a0 = from.ang, a1 = to.ang; while (a0 <= a1) a0 += Math.PI * 2;
      const mid = (a0 + a1) / 2, k = R / Math.cos((a0 - a1) / 2);
      this.addEdge(from.n.id, to.n.id, n.x + Math.cos(mid) * k, n.z + Math.sin(mid) * k, { oneway: 1, ring: rid });
    }
    if (this.crossesOthers([...this.edges.values()].filter(e => e.id >= eid0))) { this.restore(snap); return 'Not enough room here'; }
    this.ver++;
    return rid;
  }
  // a roundabout on a plain stretch of road: split it there first
  roundaboutOnRoad(e, s) {
    const R = Math.min(RING_R, s - 7, e.len - s - 7);
    if (R < 8) return 'Too close to a junction';
    const p = along(e.pts, e.cum, s);
    for (const f of this.edges.values()) if (f !== e && closestOnPoly(f.pts, f.cum, p[0], p[1]).d < 17) return 'Not enough room here';
    const snap = this.serialize(), n = this.splitEdge(e, this.tAt(e, s), [p[0], p[1]]);
    const r = this.makeRoundabout(n.id, R); if (typeof r !== 'number') this.restore(snap); return r;
  }
  ringCenter(rid) { let x = 0, z = 0, k = 0; for (const n of this.nodes.values()) if (n.ring === rid) { if (n.rc) return [n.rc[0], n.rc[1]]; x += n.x; z += n.z; k++; } return k ? [x / k, z / k] : null; }
  ringR(rid) { for (const n of this.nodes.values()) if (n.ring === rid && n.rc) return n.rc[2]; return RING_R; }
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
        const o = { oneway: f.oneway, kind: f.kind, nl: f.nl, tl: f.tl };
        if (toward) this.addEdge(center.id, far, (center.x + F.x) / 2, (center.z + F.z) / 2, o);
        else this.addEdge(far, center.id, (center.x + F.x) / 2, (center.z + F.z) / 2, o);
      }
      this.nodes.delete(m.id);
    }
    if (!center.edges.size) this.nodes.delete(center.id);
    this.ver++; return true;
  }
  serialize() {
    return { nodes: [...this.nodes.values()].map(n => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), n.sig ? 1 : 0, n.ring, n.rc || 0]),
      edges: [...this.edges.values()].map(e => [e.id, e.a, e.b, +e.cx.toFixed(2), +e.cz.toFixed(2), e.oneway, e.ring, e.kind, e.nl || 1, e.tl || 0]), nid: this.nid, eid: this.eid, rid: this.rid };
  }
  load(d) {
    this.nodes.clear(); this.edges.clear(); this.cars = [];
    for (const [id, x, z, sig, ring, rc] of d.nodes) this.nodes.set(id, { id, x, z, sig: sig ? { phase: 0, t: 0, st: 'g' } : null, ring, rc: rc || null, edges: new Set() });
    for (const [id, a, b, cx, cz, oneway, ring, kind, nl, tl] of d.edges) {
      if (!this.nodes.has(a) || !this.nodes.has(b)) continue;
      const e = { id, a, b, cx, cz, oneway, ring, kind, nl: nl || 1, tl: tl || 0, lanes: [] }; this.edgeGeom(e); this.edges.set(id, e);
      this.nodes.get(a).edges.add(id); this.nodes.get(b).edges.add(id);
    }
    for (const n of [...this.nodes.values()]) if (!n.edges.size) this.nodes.delete(n.id);
    this.nid = d.nid; this.eid = d.eid; this.rid = d.rid; this.ver++;
  }

  // ---------------- lanes ----------------
  trimOf(n) {
    let hw = 0, hmin = 1e9; for (const id of n.edges) { const w = halfW(this.edges.get(id)); hw = Math.max(hw, w); hmin = Math.min(hmin, w); }
    const H = Math.max(ROAD_W / 2, hw), xw = H - ROAD_W / 2;   // wider roads need bigger junctions
    if (n.ring) return 5.5 + xw * .6;
    const deg = n.edges.size; if (deg <= 1) return 0;
    const angs = [];
    for (const id of n.edges) { const e = this.edges.get(id); const p = e.a === n.id ? e.pts[1] : e.pts[e.pts.length - 2]; angs.push(Math.atan2(p[1] - n.z, p[0] - n.x)); }
    angs.sort((a, b) => a - b); let mn = 7;
    for (let i = 0; i < angs.length; i++) { const d = (i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2) - angs[i]; mn = Math.min(mn, d); }
    if (deg === 2) {
      const bend = mn > 2.6 ? 1 : Math.min(9 + xw, (H + .5) / Math.tan(Math.min(mn, 3.1) / 2) + 1.5);
      const dw = hw - hmin; return dw > 1 ? Math.max(bend, 5 + dw * 1.6) : bend;   // room for the road to widen or narrow
    }
    return Math.max(7.5 + xw, Math.min(22 + xw * 2, (H + 1.7) / Math.tan(Math.min(mn, 3.1) / 2) + 3));
  }
  // unit heading of travel on edge e at node nid: arriving (into) or leaving
  endHeading(e, nid, into) {
    const P = e.pts, M = P.length - 1;
    const [p, q] = into ? (e.b === nid ? [P[M - 1], P[M]] : [P[1], P[0]]) : (e.a === nid ? [P[0], P[1]] : [P[M], P[M - 1]]);
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L];
  }
  // arc position s on lane A -> the same spot on a lane B beside it
  mapS(A, s, B) { const F = A.Fa + (s / A.len) * (A.Fb - A.Fa); return (F - B.Fa) / ((B.Fb - B.Fa) || 1e-6) * B.len; }
  // one connector lane through node n from lane L to lane O
  connect(n, L, O, old) {
    const key = L.key + '>' + O.key; if (this.lanes.has(key)) return;
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
    const c = { key, conn: true, in: L, out: O, node: n, pts, cum, len: Math.max(.5, len), cars: [], turn, ang,
      vmax: Math.min(LIMIT, Math.max(3.2, Math.sqrt(2.6 * R))), conflicts: [], busy: 0, next: [O], spd: LIMIT, prio: L.prio };
    const o = old.get(c.key); if (o) c.spd = o.spd;
    this.lanes.set(c.key, c); n.conns.push(c); L.next.push(c);
  }
  // rebuild every lane + connector; cars keep their place where their lane survives
  rebuild() {
    const old = this.lanes; this.lanes = new Map(); this.links = [];
    const trims = new Map(); for (const n of this.nodes.values()) { n.trim = this.trimOf(n); trims.set(n.id, n.trim); n.ins = []; n.outs = []; n.conns = []; n.deg = n.edges.size; }
    // where turn lanes open: a road with turn lanes, at a junction where its drivers can turn left
    for (const e of this.edges.values()) {
      e.pk = [0, 0];
      if (!e.tl || e.ring) continue;
      for (const end of [0, 1]) {
        const n = this.nodes.get(end ? e.b : e.a), dirIn = end ? 1 : -1;
        if (n.ring || n.edges.size < 3 || (e.oneway && e.oneway !== dirIn)) continue;
        const hin = this.endHeading(e, n.id, true); let left = false;
        for (const id of n.edges) {
          if (id === e.id) continue;
          const f = this.edges.get(id), dOut = f.a === n.id ? 1 : -1; if (f.oneway && f.oneway !== dOut) continue;
          const ho = this.endHeading(f, n.id, false);
          if (Math.atan2(hin[0] * ho[1] - hin[1] * ho[0], hin[0] * ho[0] + hin[1] * ho[1]) < -.5) left = true;
        }
        if (!left) continue;
        const room = e.len - this.nodes.get(e.a).trim - this.nodes.get(e.b).trim, P = Math.min(36, room * .45);
        if (P >= 10) e.pk[end] = P;
      }
    }
    for (const e of this.edges.values()) {
      e.lanes = [];
      const nl = e.ring ? 1 : Math.max(1, Math.min(MAX_LANES, e.nl || 1));
      for (const dir of [1, -1]) {
        if (e.oneway && e.oneway !== dir) continue;
        const from = this.nodes.get(dir > 0 ? e.a : e.b), to = this.nodes.get(dir > 0 ? e.b : e.a);
        const base = dir > 0 ? e.pts : [...e.pts].reverse();
        const P = e.pk[dir > 0 ? 1 : 0], grp = [];
        for (let i = 0; i <= nl; i++) {
          const pk = i === nl; if (pk && !P) break;
          const lo = laneOff(e, i), off = offset(base, lo), cum = cumOf(off), L = cum[cum.length - 1];
          let t0 = from.trim, t1 = to.trim; if (t0 + t1 > L - 3) { const k = (L - 3) / (t0 + t1); t0 *= k; t1 *= k; }
          const s0 = pk ? Math.max(t0, L - t1 - P) : t0;
          const pts = cut(off, cum, s0, L - t1);
          const key = e.id + (dir > 0 ? 'f' : 'b') + (pk ? 'p' : i ? i : '');
          const lane = { key, edge: e, dir, from, to, pts, cum: cumOf(pts), conn: false, cars: [], vmax: e.ring ? 8.5 : LIMIT, prio: !!e.ring, t0, k: 1, next: [], spd: LIMIT, inc: 0,
            li: i, pk, off: lo, Fa: s0 / L, Fb: (L - t1) / L, chg: [], mv: 0 };
          lane.len = lane.cum[lane.cum.length - 1];
          lane.k = lane.len / Math.max(1, L - t0 - t1);
          const o = old.get(lane.key); if (o) lane.spd = o.spd;
          this.lanes.set(lane.key, lane); this.links.push(lane); e.lanes.push(lane); grp.push(lane);
          if (!pk) from.outs.push(lane);
          to.ins.push(lane);
        }
        // a driver may move to the lane beside them; into the turn lane only from the lane next to it
        for (const l of grp) l.chg = l.pk ? [] : grp.filter(o => o.pk ? l.li === nl - 1 : Math.abs(o.li - l.li) === 1);
      }
    }
    // connectors through each node: which lane may go where (like the arrows painted on the road)
    for (const n of this.nodes.values()) {
      const apps = new Map(), exits = new Map(), grpOf = (m, l) => { const k = l.edge.id + ':' + l.dir; if (!m.has(k)) m.set(k, { edge: l.edge, main: [], pk: null }); return m.get(k); };
      for (const L of n.ins) { const a = grpOf(apps, L); if (L.pk) a.pk = L; else a.main[L.li] = L; }
      for (const O of n.outs) grpOf(exits, O).main[O.li] = O;
      for (const ap of apps.values()) {
        const L0 = ap.main[0], h0 = along(L0.pts, L0.cum, L0.len), mvs = [];
        for (const ex of exits.values()) {
          const uturn = ex.edge === ap.edge; if (uturn && n.deg > 1) continue;
          const O0 = ex.main[0], h1 = along(O0.pts, O0.cum, 0);
          let ang = Math.atan2(h0[2] * h1[3] - h0[3] * h1[2], h0[2] * h1[2] + h0[3] * h1[3]);
          const u = uturn || Math.abs(ang) > 2.7; if (u) ang = -Math.PI;
          const t = u ? 3 : Math.abs(ang) < .5 ? 0 : ang > 0 ? 1 : 2;     // straight, right, left, U-turn
          mvs.push({ ex, ang, t, w: t === 0 ? 3 : 1 });
        }
        if (!mvs.length) continue;
        mvs.sort((p, q) => q.ang - p.ang);        // rightmost turn first, like the lanes (kerb lane first)
        const k = ap.main.length;
        let main = mvs, pkM = [];
        if (ap.pk) { pkM = mvs.filter(m => m.t >= 2); main = mvs.filter(m => m.t < 2); if (!main.length) main = mvs; }
        // share the movements out over the lanes: kerb lane turns right, middle lane goes straight, inner lane turns left
        const W = main.reduce((a, m) => a + m.w, 0); let c = 0;
        for (const m of main) { m.S = []; for (let i = 0; i < k; i++) { const lo = Math.max(c, i * W / k), hi = Math.min(c + m.w, (i + 1) * W / k); if (hi - lo > 1e-6) m.S.push(ap.main[i]); } c += m.w; }
        if (ap.pk) for (const m of pkM) { if (main !== mvs) m.S = []; m.S.push(ap.pk); }
        for (const m of mvs) {
          const S = m.S, s = S.length, O = m.ex.main, o = O.length, bit = [1, 2, 4, 8][m.t];
          for (const L of S) L.mv |= bit;
          for (let q = 0; q < s; q++) {
            if (m.t >= 2) this.connect(n, S[s - 1 - q], O[Math.max(0, o - 1 - q)], old);      // left: inside lane to inside lane
            else if (m.t === 1 || s >= o) this.connect(n, S[q], O[Math.min(q, o - 1)], old);  // right / straight, from the kerb
            else { this.connect(n, S[q], O[q], old); if (q === s - 1) for (let j = s; j < o; j++) this.connect(n, S[q], O[j], old); }  // road widens: spread out
          }
        }
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
      if (!lane && !car.lane.conn) { lane = this.lanes.get(car.lane.edge.id + (car.lane.dir > 0 ? 'f' : 'b')); if (lane) car.s = lane.len * Math.max(0, Math.min(1, ((car.lane.Fa + car.s / car.lane.len * (car.lane.Fb - car.lane.Fa)) - lane.Fa) / ((lane.Fb - lane.Fa) || 1))); }   // its lane went: the kerb lane
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
  // extra time for moving over to lane B (busier lane: costs more)
  chgCost(l, B) { return 2 + (B.cars.length - l.cars.length) * .8; }
  // lanes from `start` (car at s) to dest lane; returns array of lanes or null. noChg: stay in this lane for now
  route(start, s, dest, destS, noChg = false) {
    if (start === dest && destS > s + 3) return [start];
    const best = new Map(), prev = new Map(), h = new Heap();
    const c0 = (start.len - s) / Math.max(1.2, start.spd);
    const put = (nx, c, from) => { if (c < (best.get(nx) ?? 1e18)) { best.set(nx, c); prev.set(nx, from); h.push(c, nx); } };
    for (const nx of start.next) put(nx, c0 + this.cost(nx), start);
    if (!noChg && start.chg) for (const B of start.chg) {      // move over first
      const sb = this.mapS(start, s, B); if (sb > B.len - 8) continue;
      if (B === dest) { if (destS > sb + 6) put(B, this.chgCost(start, B) + (destS - Math.max(0, sb)) / Math.max(1.2, B.spd), start); continue; }
      put(B, this.chgCost(start, B) + (B.len - Math.max(0, sb)) / Math.max(1.2, B.spd), start);
    }
    let guard = 0;
    while (h.size && guard++ < 40000) {
      const [c, l] = h.pop(); if (c > (best.get(l) ?? 1e18)) continue;
      if (l === dest) { const path = [l]; let p = prev.get(l); while (p) { path.push(p); if (p === start) break; p = prev.get(p); } return path.reverse(); }
      for (const nx of l.next) put(nx, c + (nx === dest ? destS / Math.max(1.2, nx.spd) : this.cost(nx)), l);
      if (l.chg && l !== start) for (const B of l.chg) {
        if (B === dest && destS < 8) continue;
        put(B, c + Math.max(.3, this.chgCost(l, B) + (B === dest ? destS / Math.max(1.2, B.spd) : this.cost(B)) - this.cost(l)), l);
      }
    }
    return null;
  }
  reroute(car, noChg = false) {
    let r = this.route(car.lane, car.s, car.dest, car.destS, noChg);
    if (!r && car.dest.edge) { // try the other side of the street
      const other = car.dest.edge.lanes.find(l => l !== car.dest && !l.li && !l.pk);
      if (other) { const s2 = Math.max(1, Math.min(other.len - 1, other.len - car.destS)); r = this.route(car.lane, car.s, other, s2, noChg); if (r) { car.dest = other; car.destKey = other.key; car.destS = s2; } }
    }
    if (r) { car.route = r; car.ri = 0; }
    else if (!car.route) car.route = null;
    return !!r;
  }
  // lane + s for a spot on an edge (x,z near the road)
  spotOn(e, x, z) {
    const c = closestOnPoly(e.pts, e.cum, x, z), out = [];
    for (const l of e.lanes) {
      if (l.li || l.pk) continue;         // trips start and end in the kerb lane
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
    if (n.deg <= 2 && !n.ring && !conn.conflicts.length) return true;   // (two lanes merging into one still take turns)
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
      else if (theyFirst === null) { if (f.arrT && (!car.arrT || f.arrT < car.arrT - .01 || (Math.abs(f.arrT - car.arrT) < .01 && f.id < car.id)) && (this.room(f, c) || (L.pk && this.time - f.arrT > 12))) { car.why = 'fcfs'; return false; } }   // a long wait in a turn lane gets let through
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
    for (const l of this.lanes.values()) { if (l.cars.length > 1) l.cars.sort((a, b) => b.s - a.s); l.inc = 0; l.mq = null; }
    // drivers who need to move over; once they have waited a moment, the car behind lets them in
    for (const car of this.cars) {
      const B = car.route[car.ri + 1]; car.chgTo = B && !B.conn && !car.lane.conn ? B : null;
      if (car.chgTo && car.chgWait > 1.2) (B.mq || (B.mq = [])).push({ s: this.mapS(car.lane, car.s, B), len: car.len, id: car.id });
    }
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
      let lane = car.lane, mustBy = 1e4;
      const B = car.chgTo;
      if (B) {   // moving over to the lane beside: when there's a gap, else slow down and wait near the end
        const sb = this.mapS(lane, car.s, B);
        if (sb >= (B.pk ? .5 : car.len + 1) && sb < B.len - 1 && this.gapOK(car, B, sb)) {
          lane.cars.splice(lane.cars.indexOf(car), 1);
          let j = 0; while (j < B.cars.length && B.cars[j].s > sb) j++; B.cars.splice(j, 0, car);
          car.lat = (car.lat || 0) + lane.off - B.off; car.lane = lane = B; car.s = sb; car.ri++; car.chgTo = null; car.chgWait = 0;
        } else {
          mustBy = Math.min(lane.len, this.mapS(B, B.len, lane)) - 1.5;
          if (B === car.dest) mustBy = Math.min(mustBy, this.mapS(B, car.destS, lane) - 2);
          if (mustBy - car.s < 30 && car.v < 5) car.chgWait = (car.chgWait || 0) + dt;
        }
      }
      const idx = lane.cars.indexOf(car);
      let gap = 1e4, lv = 0, ahead = lane.len - car.s, v0 = lane.vmax * car.slow;
      if (idx > 0) { const L = lane.cars[idx - 1]; gap = L.s - L.len - car.s; lv = L.v; car.gw = 'leader'; } else car.gw = 'free';
      if (lane.mq) for (const q of lane.mq) {   // let a waiting driver in from the next lane
        if (q.id === car.id) continue;
        const g = q.s - q.len - car.s; if (g > .5 && g < 30 && g < gap) { gap = g; lv = 0; car.gw = 'let'; }
      }
      // destination: stop at it
      if (car.chgTo) {
        const g = mustBy - car.s; if (g < gap) { gap = Math.max(0, g); lv = 0; car.gw = 'merge'; }
        if (g < 45) v0 = Math.min(v0, 7);
      } else if (lane === car.dest) { const d = car.destS - car.s; if (d < gap) { gap = d + 3; lv = 0; car.gw = 'dest'; } }
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
      // let go of the junction if we can't actually drive into it (the road beyond filled up)
      if (car.granted && car.granted !== lane && !lane.conn && gap < ahead + 3 && car.v < 1) {
        car.holdT = (car.holdT || 0) + dt;
        if (car.holdT > 2) { car.granted.busy = Math.max(0, car.granted.busy - 1); car.granted = null; car.holdT = 0; car.arrT = this.time - 5; }
      } else car.holdT = 0;
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
        if (!nx.conn && !car.lane.conn) { car.s = car.lane.len; car.v = 0; break; }   // still needs to move over
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
      if (car.stuck > 12 && car.rerouteT > 10 && !car.lane.conn && !car.granted) { car.rerouteT = 0; this.reroute(car, car.chgWait > 6); car.chgWait = 0; }
      if (car.stuck > GIVE_UP) { car.gave = true; done.push(car); }
      // lane speed estimate for routing (slow EMA)
      car.lane.spd += (car.v - car.lane.spd) * Math.min(1, dt * .08);
    }
    for (const car of done) this.remove(car);
    // empty lanes drift back to free flow
    for (const l of this.lanes.values()) if (!l.cars.length) l.spd += (l.vmax - l.spd) * Math.min(1, dt * .05);
    // world positions for drawing
    for (const car of this.cars) {
      const p = along(car.lane.pts, car.lane.cum, car.s - car.len / 2); car.x = p[0]; car.z = p[1]; car.hx = p[2]; car.hz = p[3];
      if (car.lat) {   // drifting across after a lane change
        const r = Math.sign(car.lat) * Math.min(Math.abs(car.lat), dt * 1.5); car.lat -= r; if (Math.abs(car.lat) < .01) car.lat = 0;
        car.x += -p[3] * car.lat; car.z += p[2] * car.lat;
        const k = Math.max(-.3, Math.min(.3, -(r / dt) / Math.max(3, car.v))); let hx = p[2] - p[3] * k, hz = p[3] + p[2] * k; const L = Math.hypot(hx, hz) || 1; car.hx = hx / L; car.hz = hz / L;
      }
    }
  }
  // is there room to move into lane B at sb (cars ahead and behind far enough)?
  gapOK(car, B, sb) {
    if (!B.pk && sb - car.len < B.inc + 2) return false;   // keep the start clear for cars coming out of the junction
    for (const o of B.cars) {
      if (o === car) continue;
      if (o.s >= sb) { if (o.s - o.len - sb < 1.5 + car.v * .5) return false; }
      else if (sb - car.len - o.s < 1.5 + o.v * .9 + Math.max(0, o.v - car.v) * 1.2) return false;
    }
    return true;
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
