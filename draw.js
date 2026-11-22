// Everything you see: roads, junctions, markings, buildings, trees, cars, people, signals.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_W, ONEWAY_W, WALK_W, LANE_W, RING_R, along } from './net.js';

const Y_ROAD = .03, Y_WALK = .16, Y_MARK = .045;
export const hwOf = e => (e.oneway || e.ring ? ONEWAY_W : ROAD_W) / 2;

// ---------- geometry builder ----------
class Geo {
  constructor(color = false) { this.p = []; this.n = []; this.uv = []; this.c = color ? [] : null; this.i = []; }
  v(x, y, z, nx = 0, ny = 1, nz = 0, u = x / 10, w = z / 10, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); if (this.c) this.c.push(...(col || [1, 1, 1])); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  // flat quad on the ground, points [x,z]; winding fixed so it faces up
  flat(a, b, c, d, y, col) { const i = this.v(a[0], y, a[1], 0, 1, 0, undefined, undefined, col), j = this.v(b[0], y, b[1], 0, 1, 0, undefined, undefined, col), k = this.v(c[0], y, c[1], 0, 1, 0, undefined, undefined, col), l = this.v(d[0], y, d[1], 0, 1, 0, undefined, undefined, col); this.up(i, j, k); this.up(i, k, l); }
  up(a, b, c) { const P = this.p; const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2]; if (ux * vz - uz * vx > 0) this.i.push(a, c, b); else this.i.push(a, b, c); }
  // vertical wall between two ground points
  wall(a, b, y0, y1) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = dz / L, nz = -dx / L;
    const i = this.v(a[0], y0, a[1], nx, 0, nz), j = this.v(b[0], y0, b[1], nx, 0, nz), k = this.v(b[0], y1, b[1], nx, 0, nz), l = this.v(a[0], y1, a[1], nx, 0, nz);
    this.i.push(i, k, j, i, l, k); this.i.push(i, j, k, i, k, l);
  }
  fan(c, ring, y) { const ci = this.v(c[0], y, c[1]); const ids = ring.map(p => this.v(p[0], y, p[1])); for (let k = 0; k < ids.length; k++) this.up(ci, ids[k], ids[(k + 1) % ids.length]); }
  // strip between two polylines of equal length
  strip(A, B, y, col) { for (let k = 0; k + 1 < A.length; k++) this.flat(A[k], A[k + 1], B[k + 1], B[k], y, col); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); return g;
  }
}
function normals(pts) { const n = pts.length, out = []; for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; out.push([-dz / L, dx / L]); } return out; }
const off = (pts, nr, o) => pts.map((p, i) => [p[0] + nr[i][0] * o, p[1] + nr[i][1] * o]);
function cumOf(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
function cutPts(pts, cum, s0, s1) { const out = [along(pts, cum, s0).slice(0, 2)]; for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + .05 && cum[i] < s1 - .05) out.push(pts[i]); out.push(along(pts, cum, s1).slice(0, 2)); return out; }
function lineX(p, d, q, e) { const den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-4) return null; const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den; const u = ((q[0] - p[0]) * d[1] - (q[1] - p[1]) * d[0]) / den; return [t, u]; }
function quad(a, c, b, K) { const out = []; for (let i = 0; i <= K; i++) { const t = i / K, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } return out; }
// rounded corner between two road edges (A heading back along dA, B along dB); C = junction centre.
// A proper curb return when the edges meet in front of the junction, else a smooth arc round the centre (no spikes)
function corner(A, dA, B, dB, C, K = 8) {
  const x = lineX(A, dA, B, dB), rA = Math.hypot(A[0] - C[0], A[1] - C[1]), rB = Math.hypot(B[0] - C[0], B[1] - C[1]);
  if (x && x[0] < .3 && x[1] < .3 && x[0] > -40 && x[1] > -40) {
    const c = [A[0] + dA[0] * x[0], A[1] + dA[1] * x[0]];
    if (Math.hypot(c[0] - C[0], c[1] - C[1]) < Math.max(rA, rB) * 1.02) return quad(A, c, B, K);
  }
  let a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
  while (a1 < a0) a1 += Math.PI * 2;
  const out = [];
  for (let i = 0; i <= K; i++) { const t = i / K, a = a0 + (a1 - a0) * t, r = rA + (rB - rA) * t; out.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]); }
  out[0] = A; out[K] = B; return out;
}
// dashes along a polyline
function dashes(G, pts, w, dash, gap, y, start = 0) {
  const cum = cumOf(pts), L = cum[cum.length - 1];
  for (let s = start; s < L; s += dash + gap) { const e = Math.min(L, s + dash); if (e - s < .3) break; line(G, cutPts(pts, cum, s, e), w, y); }
}
function line(G, pts, w, y) { if (pts.length < 2) return; const nr = normals(pts); G.strip(off(pts, nr, -w / 2), off(pts, nr, w / 2), y); }

// ---------- textures ----------
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function noiseFill(g, S, base, amp, n, seed = 1) {
  g.fillStyle = base; g.fillRect(0, 0, S, S); let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { const v = (r() - .5) * amp; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`; const z = 1 + r() * 2.5; g.fillRect(r() * S, r() * S, z, z); }
}
export function makeMaterials(maxAniso = 8) {
  const asphaltMap = canvasTex(512, (g, S) => {
    noiseFill(g, S, '#5d5f62', .22, 26000, 3);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,20,22,${.03 + Math.random() * .05})`; g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 20 + Math.random() * 70, 8 + Math.random() * 30, Math.random() * 3, 0, 7); g.fill(); }
  });
  const walkMap = canvasTex(256, (g, S) => {
    noiseFill(g, S, '#a7a49c', .12, 6000, 5);
    g.strokeStyle = 'rgba(60,58,52,.35)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.stroke(); g.beginPath(); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke(); }
  });
  const lotMap = canvasTex(256, (g, S) => noiseFill(g, S, '#57595c', .18, 9000, 9));
  for (const t of [asphaltMap, walkMap, lotMap]) t.anisotropy = maxAniso;
  const M = {
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltMap, roughness: .93, metalness: 0, color: 0xffffff }),
    walk: new THREE.MeshStandardMaterial({ map: walkMap, roughness: .96 }),
    curb: new THREE.MeshStandardMaterial({ color: 0xb4b1a8, roughness: .9 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xe6e5df, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    markY: new THREE.MeshStandardMaterial({ color: 0xe2b53a, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    lot: new THREE.MeshStandardMaterial({ map: lotMap, roughness: .9 }),
    island: new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 1 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: .5, metalness: .6 }),
  };
  M.lot.map.repeat.set(1, 1);
  return M;
}

// ---------- roads + junctions + markings ----------
export function buildRoads(net, M, opt = {}) {
  const A = new Geo(), W = new Geo(), K = new Geo(), MK = new Geo(), MY = new Geo(), IS = new Geo();
  const nodes = net.nodes, ringCenters = new Map();
  for (const n of nodes.values()) if (n.ring && !ringCenters.has(n.ring)) ringCenters.set(n.ring, net.ringCenter(n.ring));
  const lamps = [];
  // one stretch of road along centreline c: asphalt, sidewalks, curbs, markings, lights
  function piece(c, e, hw, inner, lights) {
    if (c.length < 2) return;
    const nr = normals(c);
    A.strip(off(c, nr, -hw), off(c, nr, hw), Y_ROAD);
    for (const sg of [-1, 1]) {
      if (sg === inner) continue;
      const i0 = off(c, nr, sg * hw), i1 = off(c, nr, sg * (hw + WALK_W));
      W.strip(i0, i1, Y_WALK);
      for (let k = 0; k + 1 < i0.length; k++) sg > 0 ? K.wall(i0[k + 1], i0[k], Y_ROAD - .02, Y_WALK) : K.wall(i0[k], i0[k + 1], Y_ROAD - .02, Y_WALK);
    }
    const cl = cumOf(c), m = cutPts(c, cl, Math.min(.8, cl.at(-1) / 3), cl.at(-1) - Math.min(.8, cl.at(-1) / 3));
    if (m.length >= 2 && cl.at(-1) > 1.5) {
      const mn = normals(m);
      if (!e.oneway && !e.ring) {
        if (e.kind === 'avenue') { line(MY, off(m, mn, -.16), .12, Y_MARK); line(MY, off(m, mn, .16), .12, Y_MARK); }
        else dashes(MK, m, .14, 3, 5, Y_MARK, 2);
      }
      line(MK, off(m, mn, -(hw - .35)), .13, Y_MARK); line(MK, off(m, mn, hw - .35), .13, Y_MARK);
      if (e.oneway && !e.ring) { const cm = cumOf(m), L = cm.at(-1), dir = e.oneway; for (let s = 12; s < L - 8; s += 26) { const p = along(m, cm, s); arrow(MK, p[0], p[1], p[2] * dir, p[3] * dir); } }
    }
    if (lights) { const L = cl.at(-1); for (let s = 10, k = 0; s < L - 6; s += 34, k++) { const p = along(c, cl, s), sg = k % 2 ? 1 : -1; lamps.push([p[0] - p[3] * sg * (hw + WALK_W - .7), p[1] + p[2] * sg * (hw + WALK_W - .7), Math.atan2(p[3] * sg, -p[2] * sg)]); } }
  }
  for (const e of net.edges.values()) {
    const a = nodes.get(e.a), b = nodes.get(e.b), hw = hwOf(e);
    const tA = a.edges.size > 1 ? a.trim : 0, tB = b.edges.size > 1 ? b.trim : 0;
    if (e.len - tA - tB < .5) continue;
    const c = cutPts(e.pts, e.cum, tA, e.len - tB), nr = normals(c);
    let inner = 0;   // the island side of a roundabout has no sidewalk
    if (e.ring) { const C = ringCenters.get(e.ring); const m = c[c.length >> 1], q = nr[c.length >> 1]; inner = ((C[0] - m[0]) * q[0] + (C[1] - m[1]) * q[1]) > 0 ? 1 : -1; }
    piece(c, e, hw, inner, !e.ring && opt.lights !== false);
  }
  // a bend where two roads join end to end: one smooth curved stretch, not a junction
  const elbow = new Set();
  for (const n of nodes.values()) {
    if (n.ring || n.edges.size !== 2) continue;
    const [e1, e2] = [...n.edges].map(id => net.edges.get(id));
    if (hwOf(e1) !== hwOf(e2) || !!e1.oneway !== !!e2.oneway) continue;
    const end = e => { const fromA = e.a === n.id, p = along(e.pts, e.cum, fromA ? n.trim : e.len - n.trim); return [p[0], p[1]]; };
    const P1 = end(e1), P2 = end(e2);
    const into = (e1.oneway === 1 && e1.b === n.id) || (e1.oneway === -1 && e1.a === n.id);
    piece(quad(P1, [n.x, n.z], P2, Math.max(4, Math.ceil(n.trim * 1.2))), { oneway: e1.oneway ? (into ? 1 : -1) : 0, kind: e1.kind }, hwOf(e1), 0, false);
    elbow.add(n.id);
  }
  // junction patches
  for (const n of nodes.values()) {
    if (elbow.has(n.id)) continue;
    const legs = [];
    for (const id of n.edges) {
      const e = net.edges.get(id), hw = hwOf(e), t = n.edges.size > 1 ? n.trim : 0;
      const fromA = e.a === n.id, s = fromA ? t : e.len - t, p = along(e.pts, e.cum, s);
      const d = fromA ? [p[2], p[3]] : [-p[2], -p[3]];
      legs.push({ e, hw, P: [p[0], p[1]], d, r: [-d[1], d[0]], ang: Math.atan2(d[1], d[0]), into: fromA ? -1 : 1 });
    }
    if (!legs.length) continue;
    legs.sort((p, q) => p.ang - q.ang);
    const C = n.ring ? ringCenters.get(n.ring) : null;
    if (legs.length === 1) {       // dead end: round cap
      const L = legs[0], cap = [], outer = [];
      for (let k = 0; k <= 12; k++) { const f = -Math.PI / 2 + Math.PI * k / 12, dx = -L.d[0] * Math.cos(f) + L.r[0] * Math.sin(f), dz = -L.d[1] * Math.cos(f) + L.r[1] * Math.sin(f); cap.push([L.P[0] + dx * L.hw, L.P[1] + dz * L.hw]); outer.push([L.P[0] + dx * (L.hw + WALK_W), L.P[1] + dz * (L.hw + WALK_W)]); }
      A.fan(L.P, cap, Y_ROAD); W.strip(cap, outer, Y_WALK); for (let k = 0; k + 1 < cap.length; k++) K.wall(cap[k + 1], cap[k], Y_ROAD - .02, Y_WALK);
      continue;
    }
    const ring = [];
    for (let i = 0; i < legs.length; i++) {
      const L = legs[i], N = legs[(i + 1) % legs.length];
      ring.push([L.P[0] - L.r[0] * L.hw, L.P[1] - L.r[1] * L.hw], [L.P[0] + L.r[0] * L.hw, L.P[1] + L.r[1] * L.hw]);
      const a0 = [L.P[0] + L.r[0] * L.hw, L.P[1] + L.r[1] * L.hw], b0 = [N.P[0] - N.r[0] * N.hw, N.P[1] - N.r[1] * N.hw];
      const cv = corner(a0, L.d, b0, N.d, [n.x, n.z]);
      for (let k = 1; k < cv.length - 1; k++) ring.push(cv[k]);
      // is this corner the island side of a roundabout?
      let island = false;
      if (C) { const mid = cv[cv.length >> 1]; const tc = [C[0] - n.x, C[1] - n.z], tm = [mid[0] - n.x, mid[1] - n.z]; island = tc[0] * tm[0] + tc[1] * tm[1] > 0 && L.e.ring && N.e.ring; }
      if (!island) {
        const a1 = [L.P[0] + L.r[0] * (L.hw + WALK_W), L.P[1] + L.r[1] * (L.hw + WALK_W)], b1 = [N.P[0] - N.r[0] * (N.hw + WALK_W), N.P[1] - N.r[1] * (N.hw + WALK_W)];
        const co = corner(a1, L.d, b1, N.d, [n.x, n.z]);
        W.strip(cv, co, Y_WALK);
        for (let k = 0; k + 1 < cv.length; k++) K.wall(cv[k + 1], cv[k], Y_ROAD - .02, Y_WALK);
      }
    }
    A.fan([n.x, n.z], ring, Y_ROAD - .004);
    // stop lines + zebra crossings
    if (n.edges.size >= 3) for (const L of legs) {
      if (L.e.ring) continue;
      const entering = !(L.e.oneway && L.e.oneway === -L.into);   // traffic comes in on this leg
      const sgIn = -1;     // incoming lane is on the leg's left looking out = -r
      const two = !L.e.oneway;
      if (entering) {
        const o0 = two ? 0 : -L.hw + .2, o1 = two ? sgIn * (L.hw - .25) : L.hw - .2;
        const p0 = [L.P[0] + L.r[0] * o0, L.P[1] + L.r[1] * o0], p1 = [L.P[0] + L.r[0] * o1, L.P[1] + L.r[1] * o1];
        if (n.ring) { // give-way line: short dashes
          const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          for (let s = .1; s < d - .3; s += .9) { const a = [p0[0] + (p1[0] - p0[0]) * s / d, p0[1] + (p1[1] - p0[1]) * s / d], b = [p0[0] + (p1[0] - p0[0]) * (s + .5) / d, p0[1] + (p1[1] - p0[1]) * (s + .5) / d]; line(MK, [[a[0] + L.d[0] * .5, a[1] + L.d[1] * .5], a], .5, Y_MARK); void b; }
        } else stop(MK, p0, p1, L.d);
      }
      if (!n.ring) {   // zebra just inside the junction mouth
        for (let o = -L.hw + .5; o < L.hw - .3; o += 1.1) {
          const q = [L.P[0] + L.r[0] * o - L.d[0] * 3.4, L.P[1] + L.r[1] * o - L.d[1] * 3.4];
          const q2 = [q[0] + L.r[0] * .55, q[1] + L.r[1] * .55];
          MK.flat(q, q2, [q2[0] + L.d[0] * 2.6, q2[1] + L.d[1] * 2.6], [q[0] + L.d[0] * 2.6, q[1] + L.d[1] * 2.6], Y_MARK);
        }
      }
    }
  }
  // roundabout islands
  for (const [rid, C] of ringCenters) {
    if (!C) continue;
    const R = net.ringR(rid) - ONEWAY_W / 2 - .05, pts = [];
    for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; pts.push([C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R]); }
    IS.fan(C, pts, Y_WALK + .02);
    const outer = pts.map(p => [p[0], p[1]]), inner = pts.map(p => [C[0] + (p[0] - C[0]) * .9, C[1] + (p[1] - C[1]) * .9]);
    W.strip([...outer, outer[0]], [...inner, inner[0]], Y_WALK + .03);
    for (let k = 0; k < 40; k++) K.wall(pts[k], pts[(k + 1) % 40], Y_ROAD - .02, Y_WALK + .03);
    void rid;
  }
  const g = new THREE.Group();
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo.build(), mat); m.receiveShadow = shadow; g.add(m); return m; };
  add(A, M.asphalt); add(W, M.walk); add(K, M.curb); add(MK, M.mark); add(MY, M.markY); add(IS, M.island);
  g.userData.lamps = lamps;
  return g;
}
function stop(G, p0, p1, d) { G.flat([p0[0] + d[0] * .05, p0[1] + d[1] * .05], [p1[0] + d[0] * .05, p1[1] + d[1] * .05], [p1[0] + d[0] * .55, p1[1] + d[1] * .55], [p0[0] + d[0] * .55, p0[1] + d[1] * .55], Y_MARK); }
function arrow(G, x, z, dx, dz) {
  const r = [-dz, dx], P = (f, s) => [x + dx * f + r[0] * s, z + dz * f + r[1] * s];
  G.flat(P(-2.6, -.13), P(-2.6, .13), P(.4, .13), P(.4, -.13), Y_MARK);
  const a = P(.4, -.55), b = P(.4, .55), c = P(1.7, 0); const i = G.v(a[0], Y_MARK, a[1]), j = G.v(b[0], Y_MARK, b[1]), k = G.v(c[0], Y_MARK, c[1]); G.up(i, j, k);
}

// ---------- buildings ----------
const STYLE = { office: 0, apt: 1, house: 2, shop: 3 };
const FACADE = {
  office: [[.55, .6, .64], [.36, .42, .48], [.62, .6, .55], [.25, .3, .34], [.7, .72, .73]],
  apt: [[.78, .74, .66], [.66, .52, .44], [.84, .82, .78], [.58, .55, .5], [.72, .62, .5], [.5, .44, .4]],
  house: [[.88, .86, .8], [.8, .74, .64], [.72, .7, .68], [.9, .88, .84], [.68, .6, .52]],
  shop: [[.75, .72, .68], [.6, .58, .55], [.82, .8, .76]],
};
function buildingMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aInfo; varying vec3 vWp; varying vec3 vWn; varying vec4 vInfo;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vec4 wpp = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vWp = wpp.xyz; vWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal); vInfo = aInfo;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vWp; varying vec3 vWn; varying vec4 vInfo; float fWin; float fLit; float fRoof;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 n = normalize(vWn); float st = vInfo.x; float H = vInfo.y;
          fRoof = step(.5, n.y);
          float u = dot(vWp.xz, vec2(-n.z, n.x)); float y = vWp.y;
          float fh = st < .5 ? 3.9 : (st > 1.5 && st < 2.5 ? 3.0 : 3.25);
          float ww = st < .5 ? 1.55 : (st > 1.5 ? 3.4 : 2.7);
          vec2 cell = vec2(u / ww, (y - .9) / fh); vec2 g = fract(cell); vec2 id = floor(cell);
          float win;
          if (st < .5 && vInfo.z < .45) win = step(.05, g.x) * step(g.x, .95) * step(.14, g.y) * step(g.y, .93);
          else if (st < .5) win = step(.42, g.y) * step(g.y, .86) * step(.03, fract(u / 1.8));
          else if (st < 1.5) win = step(.22, g.x) * step(g.x, .78) * step(.28, g.y) * step(g.y, .82);
          else if (st < 2.5) win = step(.3, g.x) * step(g.x, .7) * step(.3, g.y) * step(g.y, .75) * step(h21(id + vInfo.z * 13.), .7);
          else win = step(y, 3.6) * step(.04, g.x) * step(g.x, .96) * step(.6, y);
          if (st < 1.5 && y < 4.2) win = step(.6, y) * step(.04, fract(u / 4.5)) * step(fract(u / 4.5), .96) * step(y, 3.5);   // shopfronts
          win *= (1. - fRoof) * step(y, H - .9);
          float slab = (1. - fRoof) * step(st, 1.5) * (1. - step(.06, abs(fract((y - .9) / fh + .02) - .02)));
          fWin = win;
          fLit = win * step(.66 - vInfo.z * .2, h21(id + floor(vInfo.z * 97.)));
          vec3 glass = st < .5 ? mix(vec3(.1, .14, .17), vec3(.14, .17, .16), step(.25, vInfo.z)) : vec3(.09, .1, .11);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
          diffuseColor.rgb *= 1. - slab * .25;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .24, .235) * (.85 + .3 * h21(floor(vWp.xz * .35))), fRoof * step(st, 1.5) + fRoof * step(2.5, st));
          diffuseColor.rgb *= .92 + .16 * h21(floor(vWp.xz * .3) + id.y);
          float ao = clamp(y / 2.5, .55, 1.); diffuseColor.rgb *= mix(1., ao, 1. - fRoof);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .14, fWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, .3, fWin);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n { float k = h21(floor(vWp.xz * .7) + floor(vWp.y / 3.3)); totalEmissiveRadiance += mix(vec3(1., .72, .42), vec3(.8, .86, 1.), step(.75, k)) * fLit * uNight * (.28 + .35 * k); }');
  };
  return m;
}
function roofGeo() {   // gable prism: base 1x1 at y=0, ridge along x at y=1
  const g = new THREE.BufferGeometry();
  const P = [-.5, 0, -.5, .5, 0, -.5, .5, 1, 0, -.5, 1, 0, /**/ .5, 0, .5, -.5, 0, .5, -.5, 1, 0, .5, 1, 0, /**/ -.5, 0, .5, -.5, 0, -.5, -.5, 1, 0, /**/ .5, 0, -.5, .5, 0, .5, .5, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12]);
  g.computeVertexNormals(); return g;
}
function canopyGeo(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + .16 * Math.sin(x * 4.1 + seed) * Math.cos(z * 3.7 + y * 2 + seed) + .08 * Math.sin(y * 9 + seed * 2); p.setXYZ(i, x * n, y * n * .82, z * n); }
  g.computeVertexNormals(); return g;
}

export function buildCity(city, M, U, Q, carGeos, opt = {}) {
  const g = new THREE.Group(), B = city.buildings, dummy = new THREE.Object3D(), col = new THREE.Color();
  // buildings
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  const info = new Float32Array(B.length * 4);
  const bm = new THREE.InstancedMesh(box, M.building || (M.building = buildingMaterial(U)), Math.max(1, B.length));
  bm.geometry = box.clone(); bm.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  bm.castShadow = bm.receiveShadow = true;
  const houses = B.filter(b => b.roof);
  const rm = new THREE.InstancedMesh(roofGeo(), M.roof || (M.roof = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8 })), Math.max(1, houses.length));
  rm.castShadow = rm.receiveShadow = true;
  const bits = [];
  let ri = 0;
  B.forEach((b, i) => {
    dummy.position.set(b.x, 0, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix(); bm.setMatrixAt(i, dummy.matrix);
    const pal = FACADE[b.kind]; const c = pal[Math.floor(b.tone * pal.length) % pal.length]; col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); bm.setColorAt(i, col);
    info.set([STYLE[b.kind], b.h, b.tone, 0], i * 4);
    if (b.roof) {
      const along = b.w >= b.d; dummy.position.set(b.x, b.h, b.z); dummy.rotation.set(0, along ? 0 : Math.PI / 2, 0); dummy.scale.set((along ? b.w : b.d) + .7, 2.2 + b.tone * 1.2, (along ? b.d : b.w) + .7); dummy.updateMatrix(); rm.setMatrixAt(ri, dummy.matrix);
      const rc = [[.42, .2, .16], [.3, .3, .32], [.36, .26, .2], [.22, .22, .24], [.5, .28, .2]][Math.floor(b.tone * 97) % 5]; col.setRGB(rc[0], rc[1], rc[2], THREE.SRGBColorSpace); rm.setColorAt(ri++, col);
    } else if (b.h > 9) {
      const n = 1 + Math.floor(b.tone * 4); let s = b.tone * 1000;
      const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
      for (let k = 0; k < n; k++) { const w = 2 + r() * Math.min(7, b.w * .3), d = 2 + r() * Math.min(6, b.d * .3); bits.push([b.x + (r() - .5) * (b.w - w - 2), b.h, b.z + (r() - .5) * (b.d - d - 2), w, 1.2 + r() * 2.6, d]); }
    }
  });
  bm.count = B.length; rm.count = ri;
  if (bm.instanceColor) bm.instanceColor.needsUpdate = true; if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
  g.add(bm); if (ri) g.add(rm);
  if (bits.length) {
    const im = new THREE.InstancedMesh(box, M.bits || (M.bits = new THREE.MeshStandardMaterial({ color: 0x6f7173, roughness: .7, metalness: .2 })), bits.length);
    bits.forEach((q, i) => { dummy.position.set(q[0], q[1], q[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(q[3], q[4], q[5]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.castShadow = true; im.receiveShadow = true; g.add(im);
  }
  // lots: parking, parks, yards
  const lotG = new Geo(), lines = new Geo(), parks = new Geo(), parked = [];
  for (const l of city.lots) {
    const x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, z0 = l.z - l.d / 2, z1 = l.z + l.d / 2;
    if (l.k === 'parking') {
      lotG.flat([x0, z0], [x1, z0], [x1, z1], [x0, z1], .05);
      let s = Math.floor(l.seed * 1e6) || 1; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      let z = z0 + 1, row = 0;
      while (z + 5.2 <= z1 - 1) {
        const flip = row % 2;
        for (let x = x0 + 1; x + 2.6 <= x1 - 1; x += 2.6) {
          lines.flat([x, z], [x + .1, z], [x + .1, z + 5], [x, z + 5], .065);
          if (r() < l.fill) parked.push([x + 1.3, z + 2.6, (flip ? -1 : 1) * Math.PI / 2 + (r() - .5) * .06, r()]);
        }
        z += flip ? 5.2 : 5.2 + 6.4; row++;
      }
    } else parks.flat([x0, z0], [x1, z0], [x1, z1], [x0, z1], .035);
  }
  if (lotG.p.length) { const m = new THREE.Mesh(lotG.build(), M.lot); m.receiveShadow = true; g.add(m); }
  if (lines.p.length) g.add(new THREE.Mesh(lines.build(), M.mark));
  if (parks.p.length) { const m = new THREE.Mesh(parks.build(), M.park || (M.park = new THREE.MeshStandardMaterial({ color: 0x4f6b32, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }))); m.receiveShadow = true; g.add(m); }
  if (parked.length) {
    const pm = new THREE.InstancedMesh(carGeos.car, M.car, parked.length); pm.castShadow = Q.shadows > 1; pm.receiveShadow = true;
    parked.forEach((p, i) => { dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, p[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); pm.setColorAt(i, carColor(p[3], col)); });
    g.add(pm);
  }
  // trees (plus woods on land the city hasn't reached yet)
  const T = city.trees.slice();
  if (opt.wild) for (const w of opt.wild) T.push(w);
  if (T.length) {
    const trunkG = new THREE.CylinderGeometry(.14, .22, 1, 6).translate(0, .5, 0);
    const tm = new THREE.InstancedMesh(trunkG, M.trunk || (M.trunk = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: .9 })), T.length);
    const cg = [canopyGeo(1, Q.treeDetail), canopyGeo(4.2, Q.treeDetail)];
    const cms = cg.map(geo => new THREE.InstancedMesh(geo, M.leaf || (M.leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85 })), T.length));
    const cnt = [0, 0];
    T.forEach((t, i) => {
      const s = t[2], h = 2.6 * s + 1.4;
      dummy.position.set(t[0], 0, t[1]); dummy.rotation.set(0, t[3] * 6.28, 0); dummy.scale.set(s, h, s); dummy.updateMatrix(); tm.setMatrixAt(i, dummy.matrix);
      const v = t[3] < .5 ? 0 : 1, m = cms[v];
      dummy.position.set(t[0], h + 1.2 * s, t[1]); dummy.scale.set(3.1 * s, 2.9 * s, 3.1 * s); dummy.updateMatrix(); m.setMatrixAt(cnt[v], dummy.matrix);
      const k = (t[3] * 7.13) % 1; col.setRGB(.2 + k * .12, .32 + k * .1, .12 + k * .05, THREE.SRGBColorSpace); m.setColorAt(cnt[v]++, col);
    });
    tm.castShadow = true; g.add(tm);
    cms.forEach((m, v) => { m.count = cnt[v]; m.castShadow = m.receiveShadow = true; if (cnt[v]) g.add(m); });
  }
  return g;
}

// ---------- vehicles ----------
const PAINT = [[.92, .92, .9], [.06, .06, .07], [.62, .63, .65], [.35, .36, .38], [.92, .92, .9], [.06, .06, .07], [.62, .63, .65], [.1, .16, .32], [.55, .06, .06], [.16, .2, .26], [.8, .78, .7], [.2, .28, .22], [.74, .48, .12], [.4, .1, .12]];
export function carColor(r, col) { const c = PAINT[Math.floor(r * PAINT.length) % PAINT.length]; return col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }
function part(geos, w, h, d, x, y, z, rgb, light = 0, taper = 0) {
  const b = new THREE.BoxGeometry(w, h, d);
  if (taper) { const p = b.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - taper) + (p.getX(i) > 0 ? -1 : 1) * 0 ); p.setZ(i, p.getZ(i) * (1 - taper * .35)); } b.computeVertexNormals(); }
  b.translate(x, y, z);
  const n = b.attributes.position.count, c = new Float32Array(n * 3), l = new Float32Array(n);
  for (let i = 0; i < n; i++) { c.set(rgb, i * 3); l[i] = light; }
  b.setAttribute('color', new THREE.BufferAttribute(c, 3)); b.setAttribute('aLight', new THREE.BufferAttribute(l, 1));
  geos.push(b.toNonIndexed ? b : b);
}
function wheels(geos, len, w, r = .33, axles = 2) {
  const cyl = new THREE.CylinderGeometry(r, r, .24, 10).rotateX(Math.PI / 2);
  const xs = axles === 2 ? [len * .32, -len * .32] : [len * .38, -len * .18, -len * .34];
  for (const x of xs) for (const s of [-1, 1]) {
    const g = cyl.clone().translate(x, r, s * (w / 2 - .14)); const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(.05), 3)); g.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(n), 1)); geos.push(g);
  }
}
const GLASS = [.05, .06, .07], BODY = [1, 1, 1], DARK = [.08, .08, .08], HEAD = [1, 1, .95], TAIL = [.5, .05, .04];
export function vehicleGeos() {
  const make = fn => { const geos = []; fn(geos); const g = mergeGeometries(geos.map(x => x.index ? x.toNonIndexed() : x)); g.computeBoundingSphere(); return g; };
  const lights = (geos, len, w, y) => { for (const s of [-1, 1]) { part(geos, .1, .16, .32, len / 2, y, s * (w / 2 - .3), HEAD, 1); part(geos, .1, .16, .34, -len / 2, y, s * (w / 2 - .28), TAIL, 2); } };
  return {
    car: make(gs => { const L = 4.5, W = 1.84; part(gs, L, .55, W, 0, .58, 0, BODY); part(gs, L * .5, .46, W * .9, -.2, 1.08, 0, GLASS, 0, .3); part(gs, L * .42, .05, W * .78, -.24, 1.32, 0, BODY); part(gs, L * .98, .14, W * 1.01, 0, .36, 0, DARK); lights(gs, L, W, .7); wheels(gs, L, W); }),
    suv: make(gs => { const L = 4.9, W = 2.0; part(gs, L, .72, W, 0, .7, 0, BODY); part(gs, L * .62, .55, W * .92, -.35, 1.33, 0, GLASS, 0, .18); part(gs, L * .56, .06, W * .86, -.38, 1.63, 0, BODY); part(gs, L * .98, .16, W * 1.01, 0, .42, 0, DARK); lights(gs, L, W, .85); wheels(gs, L, W, .38); }),
    van: make(gs => { const L = 5.6, W = 2.05; part(gs, L, 1.55, W, -.1, 1.25, 0, BODY); part(gs, .5, .6, W * .9, L / 2 - .3, 1.55, 0, GLASS, 0, .4); part(gs, L * .98, .18, W * 1.01, 0, .5, 0, DARK); lights(gs, L, W, .85); wheels(gs, L, W, .36); }),
    truck: make(gs => { const L = 8.5, W = 2.4; part(gs, 2.1, 2.2, W, L / 2 - 1.05, 1.6, 0, BODY); part(gs, .3, .8, W * .88, L / 2 - .02, 2.0, 0, GLASS); part(gs, 6.1, 2.7, W, -1.15, 1.95, 0, [.9, .9, .88]); part(gs, L, .3, W * .9, 0, .62, 0, DARK); lights(gs, L, W, .9); wheels(gs, L, W, .48, 3); }),
    bus: make(gs => { const L = 12, W = 2.5; part(gs, L, 2.4, W, 0, 1.75, 0, BODY); part(gs, L * .94, .85, W * 1.01, -.15, 2.1, 0, GLASS); part(gs, .2, 1.3, W * .9, L / 2, 1.9, 0, GLASS); part(gs, L, .25, W * 1.01, 0, .55, 0, DARK); lights(gs, L, W, .85); wheels(gs, L, W, .5); }),
  };
}
export function vehicleMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .45 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLight; attribute float aBrake; varying float vLight; varying float vBrake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLight = aLight; vBrake = aBrake;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vLight; varying float vBrake;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hd = 1. - step(.5, abs(vLight - 1.)); float tl = 1. - step(.5, abs(vLight - 2.));
        totalEmissiveRadiance += vec3(1., .93, .78) * hd * (uNight * 3. + .15) + vec3(1., .04, .02) * tl * (uNight * 1.2 + vBrake * 2.5 + .05);`);
  };
  return m;
}
// one instanced mesh per vehicle kind; aBrake is per instance
export function makeFleet(geos, mat, max) {
  const out = {};
  for (const k of Object.keys(geos)) {
    const geo = geos[k].clone(), brake = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); brake.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBrake', brake);
    const m = new THREE.InstancedMesh(geo, mat, max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    out[k] = m;
  }
  return out;
}
// geometry for the parked cars shares the material, needs aBrake too
export function staticCarGeo(geos) { const g = geos.car.clone(); g.setAttribute('aBrake', new THREE.InstancedBufferAttribute(new Float32Array(20000), 1)); return g; }

// people: a body + head, tinted per instance (clothes)
export function personGeo() {
  const geos = [];
  const body = new THREE.CylinderGeometry(.2, .17, 1.15, 6).translate(0, .78, 0), legs = new THREE.CylinderGeometry(.15, .12, .5, 5).translate(0, .25, 0), head = new THREE.SphereGeometry(.13, 6, 5).translate(0, 1.5, 0);
  const paint = (g, rgb) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(rgb, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g.toNonIndexed(); };
  geos.push(paint(body, [1, 1, 1]), paint(legs, [.18, .2, .26]), paint(head, [.78, .6, .48]));
  return mergeGeometries(geos);
}

export function lampGeo() {   // street light: pole + arm + head
  const pole = new THREE.CylinderGeometry(.08, .12, 7.5, 6).translate(0, 3.75, 0), arm = new THREE.BoxGeometry(.08, .08, 1.8).translate(0, 7.4, .9), head = new THREE.BoxGeometry(.32, .14, .7).translate(0, 7.3, 1.7);
  return mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), head.toNonIndexed()]);
}
export function signalGeo() {  // pole + mast arm + housing
  const pole = new THREE.CylinderGeometry(.1, .13, 5.6, 6).translate(0, 2.8, 0), arm = new THREE.BoxGeometry(.1, .1, 3.2).translate(0, 5.4, -1.6), box = new THREE.BoxGeometry(.36, 1.05, .34).translate(0, 4.85, -2.9);
  return mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), box.toNonIndexed()]);
}
