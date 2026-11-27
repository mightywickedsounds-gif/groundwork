// Everything you see: roads, junctions, markings, buildings, trees, cars, people, signals.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_W, ONEWAY_W, WALK_W, LANE_W, RING_R, along, halfW, laneOff, rng, closestOnPoly, edgeH, FLAT } from './net.js';
import { frame as FR, layout as LAYOUT, entries as ENTRIES } from './parking.js';


const Y_ROAD = .03, Y_WALK = .16, Y_MARK = .045;
export const hwOf = halfW;

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
  // like strip, but the texture runs along it: u = metres along / size, v = metres across / size (sidewalk panels line up)
  stripUV(A, B, y, size = 1.5) {
    let u = 0;
    for (let k = 0; k + 1 < A.length; k++) {
      const m0 = [(A[k][0] + B[k][0]) / 2, (A[k][1] + B[k][1]) / 2], m1 = [(A[k + 1][0] + B[k + 1][0]) / 2, (A[k + 1][1] + B[k + 1][1]) / 2], du = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) / size;
      const w0 = Math.hypot(B[k][0] - A[k][0], B[k][1] - A[k][1]) / size, w1 = Math.hypot(B[k + 1][0] - A[k + 1][0], B[k + 1][1] - A[k + 1][1]) / size;
      const i = this.v(A[k][0], y, A[k][1], 0, 1, 0, u, 0), j = this.v(A[k + 1][0], y, A[k + 1][1], 0, 1, 0, u + du, 0), l = this.v(B[k + 1][0], y, B[k + 1][1], 0, 1, 0, u + du, w1), m = this.v(B[k][0], y, B[k][1], 0, 1, 0, u, w0);
      this.up(i, j, l); this.up(i, l, m); u += du;
    }
  }
  append(o) { const k = this.p.length / 3; this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv); if (this.c) this.c.push(...(o.c || o.p.map(() => 1))); for (const i of o.i) this.i.push(i + k); }
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
// one 1.5 m sidewalk panel (512 px): fine aggregate, a broom finish across the walk, tooled joints with smooth borders
function walkTex(joints) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  let sd = 9; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#c9c5bb'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { const v = r(); g.fillStyle = v < .5 ? `rgba(90,84,74,${.05 + r() * .1})` : `rgba(255,252,245,${.05 + r() * .1})`; const z = .8 + r() * 1.6; g.fillRect(r() * S, r() * S, z, z); }
  for (let i = 0; i < 520; i++) { const x = r() * S, a = .025 + r() * .035; g.strokeStyle = r() < .5 ? `rgba(70,64,56,${a})` : `rgba(255,255,255,${a})`; g.lineWidth = .6 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - .5) * 10, S); g.stroke(); }   // broom marks across the walk
  for (let i = 0; i < 7; i++) { const x = r() * S, y = r() * S, rr = 10 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(80,74,64,${.04 + r() * .05})`); gr.addColorStop(1, 'rgba(80,74,64,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); }   // faint stains
  if (joints) {
    for (const [x, y, w, h] of [[0, 0, S, 22], [0, S - 22, S, 22], [0, 0, 22, S], [S - 22, 0, 22, S]]) { g.fillStyle = 'rgba(232,228,220,.35)'; g.fillRect(x, y, w, h); }   // the trowelled border of each panel
    g.fillStyle = 'rgba(58,54,48,.85)'; g.fillRect(0, 0, S, 4); g.fillRect(0, 0, 4, S);
    g.fillStyle = 'rgba(58,54,48,.4)'; g.fillRect(0, 4, S, 2); g.fillRect(4, 0, 2, S);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// photo textures (Poly Haven, CC0), shrunk for the web
const TL = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;
function photo(f, aniso, srgb = true) {
  const t = TL.load('assets/tex/' + f + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// break up the repeat of a ground texture with soft patches (world space)
const PATCHY = `float ph1(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float pn1(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(ph1(i), ph1(i + vec2(1, 0)), f.x), mix(ph1(i + vec2(0, 1)), ph1(i + vec2(1, 1)), f.x), f.y); }`;
// shadows of the drifting clouds on the ground, roofs and trees (they cross the town at a few metres a second)
export const CLOUD = `uniform float uTime; uniform float uCloudSh; uniform float uCover;
float csh(vec2 p) { vec2 q = p / 480. + vec2(uTime * .0085, uTime * .003);
  float n = pn1(q) * .6 + pn1(q * 2.3 + 3.1) * .3 + pn1(q * 5.3 + 7.) * .1; return smoothstep(.64 - uCover * .2, .8 - uCover * .14, n) * uCloudSh; }`;
let CU = null;   // the shared uniforms (time, cloud shadow strength)
export function cloudUniforms(sh) { if (CU) { sh.uniforms.uTime = CU.uTime; sh.uniforms.uCloudSh = CU.uCloudSh; sh.uniforms.uCover = CU.uCover; } }
function patchy(m, amt, scale = 14, tint = '') {
  m.onBeforeCompile = sh => {
    cloudUniforms(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vPw = (modelMatrix * vec4(transformed, 1.)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPw;\n' + PATCHY + CLOUD)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float n = pn1(vPw / ${scale.toFixed(1)}) * .65 + pn1(vPw / ${(scale / 3.7).toFixed(2)}) * .35; diffuseColor.rgb *= (1. + (n - .5) * ${amt.toFixed(2)}) * (1. - csh(vPw) * .45); ${tint} }`);
  };
  m.customProgramCacheKey = () => 'patchy' + amt + scale + tint;
  return m;
}
export function makeMaterials(maxAniso = 8, U = null) {
  if (U) CU = U;
  const A = Math.min(8, maxAniso);
  const asphaltMap = photo('asphalt', A), lotMap = photo('asphalt', A);
  asphaltMap.repeat.set(.85, .85); lotMap.repeat.set(1.1, 1.1);
  const M = {
    asphalt: patchy(new THREE.MeshStandardMaterial({ map: asphaltMap, roughness: .9, metalness: 0, color: 0x9a9a9a }), .35, 22,
      // the wear of a real street: wiggly black crack sealant in places, darker square repair patches here and there
      `{ float zone = smoothstep(.62, .8, pn1(vPw / 46. + 9.));
         vec2 cq = vPw / 5.3 + 2.1; float cn = pn1(cq), ce = .02;
         float cg = length(vec2(pn1(cq + vec2(ce, 0.)) - pn1(cq - vec2(ce, 0.)), pn1(cq + vec2(0., ce)) - pn1(cq - vec2(0., ce)))) / (2. * ce) / 5.3;   // slope per metre
         float cr = (1. - smoothstep(.012, .028, abs(cn - .5) / max(cg, .02))) * step(.55, pn1(vPw / 3.1 + 7.)) * step(.03, cg);   // a thin line where the noise crosses the middle, in short pieces
         diffuseColor.rgb *= 1. - cr * zone * .3;
         vec2 cc = floor(vPw / 13.), ff = fract(vPw / 13.); float hh = ph1(cc + 4.);
         if (hh > .9) { float r = step(.12 + hh * .1, ff.x) * step(ff.x, .62 + hh * .2) * step(.2, ff.y) * step(ff.y, .55 + hh * .3); diffuseColor.rgb *= 1. - r * (.16 + (hh - .9) * 1.2); } }`),
    // sidewalks: poured concrete in 1.5 m panels (tooled joints, broom finish), each panel a slightly different shade, a little dirt
    walk: patchy(new THREE.MeshStandardMaterial({ map: walkTex(true), roughness: .93, color: 0xd6d3cc }), .16, 11, 'diffuseColor.rgb *= .955 + ph1(floor(vMapUv) + 3.7) * .08;'),
    curb: new THREE.MeshStandardMaterial({ color: 0xb4b1a8, roughness: .9 }),
    mark: patchy(new THREE.MeshStandardMaterial({ color: 0xe6e5df, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), .3, 2.5),   // paint a little worn
    markY: patchy(new THREE.MeshStandardMaterial({ color: 0xe2b53a, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), .3, 2.5),
    lot: patchy(new THREE.MeshStandardMaterial({ map: lotMap, roughness: .9, color: 0xa6a4a0 }), .4, 9),
    island: new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 1 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: .5, metalness: .6 }),
    tex: { brick: photo('brick', A), stone: photo('stone', A), stucco: photo('stucco', A), gravel: photo('gravel', A), shingle: photo('shingle', A), lawn: photo('lawn', A) },
  };
  // the same concrete for slabs laid out in world space (house driveways, decks), and a plain one with no joints (gutters, curbs)
  M.slab = patchy(new THREE.MeshStandardMaterial({ map: (() => { const t = M.walk.map.clone(); t.repeat.set(10 / 1.5, 10 / 1.5); t.needsUpdate = true; return t; })(), roughness: .93, color: 0xd6d3cc }), .2, 9);
  M.plainMap = walkTex(false);
  // mown lawns (yards, grass strips, islands): the same grass as the fields, a little greener and finer (watered and cut)
  M.tex.grass = (() => { const t = TL.load('assets/grass.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = A; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1.1, 1.1); return t; })();
  M.island = patchy(new THREE.MeshStandardMaterial({ map: M.tex.grass, color: 0xb2c48a, roughness: 1 }), .22, 6);
  M.tex.lawn.repeat.set(.4, .4);
  return M;
}

// ---------- roads + junctions + markings ----------
export function buildRoads(net, M, opt = {}) {
  let A = new Geo(), W = new Geo(), K = new Geo(), MK = new Geo(), MY = new Geo(), IS = new Geo(), GU = new Geo(), CT = new Geo(), TP = new Geo(), SH = new Geo(), GR = new Geo(), inlets = [], holes = [];
  let bare = false;   // drawing the raised/sunken middle of an over/underpass: road and paint only (no sidewalk, curb or drains)
  const ST = new Geo(true), MASK = new Geo();   // bridge and cutting concrete; the ground cut out over open cuttings
  const GW = .55, CW = .2;   // concrete gutter along every curb, and the curb's own top
  const PKW = 1.45, PW = new Geo(), parkway = e => e.kind === 'street' && (e.nl || 1) === 1 && !e.tl && !e.ring && !e.oneway && Math.hypot(e.cx, e.cz) > (opt.coreR || 0);
  const nodes = net.nodes, ringCenters = new Map(), deco = [];
  for (const n of nodes.values()) if (n.ring && !ringCenters.has(n.ring)) ringCenters.set(n.ring, net.ringCenter(n.ring));
  const lamps = [];
  // one stretch of road along centreline c: asphalt, sidewalks, curbs, markings, lights
  // a painted line at offset o (right of a->b) between arc lengths s0..s1 of polyline m
  function seg(G, m, cm, o, s0, s1, w = .13, dashed = false) {
    s0 = Math.max(0, s0); s1 = Math.min(cm.at(-1), s1); if (s1 - s0 < .4) return;
    const p = cutPts(m, cm, s0, s1), q = off(p, normals(p), o);
    if (dashed) dashes(G, q, w, 3, 6, Y_MARK, 1); else line(G, q, w, Y_MARK);
  }
  // diagonal hatching across the strip between offsets o0..o1 (a painted median)
  function hatch(G, m, cm, o0, o1, s0, s1) {
    for (let s = s0 + 1; s + 3.4 < s1; s += 5) {
      const a = along(m, cm, s), b = along(m, cm, s + 3.4);
      const p = [a[0] - a[3] * (o0 + .25), a[1] + a[2] * (o0 + .25)], q = [b[0] - b[3] * (o1 - .25), b[1] + b[2] * (o1 - .25)];
      line(G, [p, q], .3, Y_MARK);
    }
  }
  function piece(c, e, hw, inner, lights, pk = [0, 0], ends = null) {
    if (c.length < 2) return;
    const nr = normals(c);
    if (ends) for (const [i, t] of [[0, ends[0]], [c.length - 1, ends[1]]]) { const L = Math.hypot(t[0], t[1]); if (L > 1e-6) nr[i] = [-t[1] / L, t[0] / L]; }   // exact ends: no slivers where pieces meet
    A.strip(off(c, nr, -hw - (bare ? .12 : 0)), off(c, nr, hw + (bare ? .12 : 0)), Y_ROAD);
    const rural = !bare && opt.rural && opt.rural(e);   // out of town: a country road (gravel shoulders, no curb, no sidewalk)
    if (rural) for (const sg of [-1, 1]) {
      SH.strip(off(c, nr, sg * hw), off(c, nr, sg * (hw + 1.8)), Y_ROAD - .012);
      GR.strip(off(c, nr, sg * (hw + 1.8)), off(c, nr, sg * (hw + 3.2)), Y_ROAD - .018);
    }
    for (const sg of [-1, 1]) {
      if (sg === inner || rural || bare) continue;
      const i0 = off(c, nr, sg * hw), i1 = off(c, nr, sg * (hw + WALK_W));
      if (parkway(e)) {   // a house street: a grass strip (parkway) between the curb and the sidewalk
        const g1 = off(c, nr, sg * (hw + PKW));
        PW.strip(off(c, nr, sg * (hw + CW)), g1, Y_WALK - .012); W.stripUV(g1, i1, Y_WALK);
      } else W.stripUV(i0, i1, Y_WALK);
      for (let k = 0; k + 1 < i0.length; k++) sg > 0 ? K.wall(i0[k + 1], i0[k], Y_ROAD - .02, Y_WALK) : K.wall(i0[k], i0[k + 1], Y_ROAD - .02, Y_WALK);
      GU.strip(off(c, nr, sg * (hw - GW)), i0, Y_ROAD + .006); CT.strip(i0, off(c, nr, sg * (hw + CW)), Y_WALK + .004);
    }
    const cl = cumOf(c), m = cutPts(c, cl, Math.min(.8, cl.at(-1) / 3), cl.at(-1) - Math.min(.8, cl.at(-1) / 3));
    if (m.length >= 2 && cl.at(-1) > 1.5) {
      const mn = normals(m), cm = cumOf(m), Lm = cm.at(-1), nl = e.ring ? 1 : (e.nl || 1), tl = !e.ring && e.tl;
      const Pa = Math.max(0, pk[0] - .8), Pb = Math.max(0, pk[1] - .8);   // turn lane lengths at each end
      if (!e.oneway && !e.ring) {
        if (tl) {   // a painted middle: turn lanes at the ends, hatching between; yellow toward oncoming traffic, white beside your own lanes
          const H = LANE_W / 2;
          seg(MY, m, cm, H, 0, Lm - Pb); seg(MK, m, cm, H, Lm - Pb, Lm);
          seg(MY, m, cm, -H, Pa, Lm); seg(MK, m, cm, -H, 0, Pa);
          // between the turn bays: a two-way left-turn lane (solid yellow outside, dashed yellow inside, both sides)
          seg(MY, m, cm, H - .32, Pa + 1, Lm - Pb - 1, .12, true); seg(MY, m, cm, -(H - .32), Pa + 1, Lm - Pb - 1, .12, true);
        } else if (e.kind === 'avenue' || nl > 1) { line(MY, off(m, mn, -.16), .12, Y_MARK); line(MY, off(m, mn, .16), .12, Y_MARK); }
        else if (e.kind !== 'street') dashes(MY, m, .12, 3, 6, Y_MARK, 2);   // a two-way road: dashed yellow down the middle (US style; white lines only part lanes going the same way)
        // (a quiet residential street has no paint at all)
        for (let i = 0; i + 1 < nl; i++) { const o = (laneOff(e, i) + laneOff(e, i + 1)) / 2; seg(MK, m, cm, o, 0, Lm, .13, true); seg(MK, m, cm, -o, 0, Lm, .13, true); }
      } else if (e.ring) {   // a two-lane roundabout: dashed line between its lanes
        if (nl > 1) seg(MK, m, cm, (e.oneway || 1) * (laneOff(e, 0) + laneOff(e, 1)) / 2, 0, Lm, .13, true);
      } else {
        const sg = e.oneway;   // lane offsets face the way of travel
        for (let i = 0; i + 1 < nl; i++) seg(MK, m, cm, sg * (laneOff(e, i) + laneOff(e, i + 1)) / 2, 0, Lm, .13, true);
        if (tl) {
          const o = sg * (laneOff(e, nl - 1) + laneOff(e, nl)) / 2, P = sg > 0 ? Pb : Pa, e0 = sg > 0 ? Lm - P : 0, e1 = sg > 0 ? Lm : P;
          if (P) seg(MK, m, cm, o, e0, e1);
          const edge = -sg * (hw - .35), h0 = sg > 0 ? 0 : P, h1 = sg > 0 ? Lm - P : Lm;
          seg(MY, m, cm, o, h0, h1); hatch(MY, m, cm, Math.min(o, edge), Math.max(o, edge), h0 + 1, h1 - 1);
        }
      }
      if (e.kind !== 'street' || nl > 1 || e.oneway || e.ring) { line(MK, off(m, mn, -(hw - GW - .25)), .13, Y_MARK); line(MK, off(m, mn, hw - GW - .25), .13, Y_MARK); }   // edge lines on the bigger roads only
      if (e.oneway && !e.ring) { const dir = e.oneway; for (let s = 12; s < Lm - 22; s += 26) { const p = along(m, cm, s); for (let i = 0; i < nl; i++) { const o = dir * laneOff(e, i); arrow(MK, p[0] - p[3] * o, p[1] + p[2] * o, p[2] * dir, p[3] * dir); } } }
    }
    // storm drain grates in the gutter near each end, manhole covers down the lanes now and then
    if (!e.ring && !rural && !bare && cl.at(-1) > 24) {
      const Lc = cl.at(-1), hsh = (k) => { const v = Math.sin(e.id * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
      for (const sg of [-1, 1]) { if (sg === inner) continue; for (const s of [3.2, Lc - 3.2]) { const p = along(c, cl, s); inlets.push([p[0] - p[3] * sg * (hw - .32), p[1] + p[2] * sg * (hw - .32), Math.atan2(-p[3], p[2])]); } }
      for (let s = 14 + hsh(1) * 20; s < Lc - 10; s += 48 + hsh(s) * 30) { const p = along(c, cl, s), o = (hsh(s + 3) < .5 ? -1 : 1) * (e.oneway ? 0 : laneOff(e, 0)); holes.push([p[0] - p[3] * o, p[1] + p[2] * o, hsh(s + 5) * 6.28]); }
    }
    if (lights && !rural) { const L = cl.at(-1); for (let s = 10, k = 0; s < L - 6; s += 34, k++) { const p = along(c, cl, s), sg = k % 2 ? 1 : -1; const lo = parkway(e) ? hw + .85 : hw + WALK_W - .7; lamps.push([p[0] - p[3] * sg * lo, p[1] + p[2] * sg * lo, Math.atan2(p[3] * sg, -p[2] * sg)]); } }
  }
  for (const e of net.edges.values()) {
    const a = nodes.get(e.a), b = nodes.get(e.b), hw = hwOf(e);
    const tA = a.edges.size > 1 ? a.trim : 0, tB = b.edges.size > 1 ? b.trim : 0;
    if (e.len - tA - tB < .5) continue;
    if (e.lv && gradeSep(e, tA, tB, hw)) continue;
    const c = cutPts(e.pts, e.cum, tA, e.len - tB), nr = normals(c);
    let inner = 0;   // the island side of a roundabout has no sidewalk
    if (e.ring) { const C = ringCenters.get(e.ring); const m = c[c.length >> 1], q = nr[c.length >> 1]; inner = ((C[0] - m[0]) * q[0] + (C[1] - m[1]) * q[1]) > 0 ? 1 : -1; }
    const h0 = along(e.pts, e.cum, tA), h1 = along(e.pts, e.cum, e.len - tB);
    piece(c, e, hw, inner, !e.ring && opt.lights !== false, e.pk, [[h0[2], h0[3]], [h1[2], h1[3]]]);
  }
  // ---- an over/underpass: level road with sidewalks by each junction, then up onto an embankment and over the street on a
  // bridge deck (overpass), or down into a cutting between retaining walls and under the street (underpass) ----
  function gradeSep(e, tA, tB, hw) {
    const F0 = Math.max(tA, FLAT), F1 = Math.min(e.len - tB, e.len - FLAT); if (F1 - F0 < 4) return false;
    const hd = s => { const p = along(e.pts, e.cum, s); return [p[2], p[3]]; }, lights = opt.lights !== false;
    if (F0 > tA + .3) piece(cutPts(e.pts, e.cum, tA, F0), e, hw, 0, lights, [e.pk ? e.pk[0] : 0, 0], [hd(tA), hd(F0)]);
    if (F1 < e.len - tB - .3) piece(cutPts(e.pts, e.cum, F1, e.len - tB), e, hw, 0, lights, [0, e.pk ? e.pk[1] : 0], [hd(F1), hd(e.len - tB)]);
    // the middle: road and paint into their own pieces, lifted onto the height profile, then added in
    const keep = [A, MK, MY]; A = new Geo(); MK = new Geo(); MY = new Geo(); bare = true;
    const c = cutPts(e.pts, e.cum, F0, F1);
    piece(c, e, hw, 0, false, [0, 0], [hd(F0), hd(F1)]);
    bare = false;
    for (const G of [A, MK, MY]) for (let k = 0; k < G.p.length; k += 3) G.p[k + 1] += edgeH(e, closestOnPoly(e.pts, e.cum, G.p[k], G.p[k + 2]).s);
    keep[0].append(A); keep[1].append(MK); keep[2].append(MY); [A, MK, MY] = keep;
    // where other roads cross underneath (overpass: open spans on a deck) or over the top (underpass: covered, a tunnel mouth each side)
    const spans = [];
    for (const f of net.edges.values()) {
      if (f === e || f.bb[0] > e.bb[1] + 2 || f.bb[1] < e.bb[0] - 2 || f.bb[2] > e.bb[3] + 2 || f.bb[3] < e.bb[2] - 2) continue;
      for (let i = 1; i < e.pts.length; i++) for (let j = 1; j < f.pts.length; j++) {
        const x = lineX(e.pts[i - 1], [e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]], f.pts[j - 1], [f.pts[j][0] - f.pts[j - 1][0], f.pts[j][1] - f.pts[j - 1][1]]);
        if (!x || x[0] < 0 || x[0] > 1 || x[1] < 0 || x[1] > 1) continue;
        const sE = e.cum[i - 1] + (e.cum[i] - e.cum[i - 1]) * x[0]; if (sE < F0 || sE > F1) continue;
        const a = hd(sE), b = along(f.pts, f.cum, f.cum[j - 1] + (f.cum[j] - f.cum[j - 1]) * x[1]), sin = Math.max(.26, Math.abs(a[0] * b[3] - a[1] * b[2]));
        const half = (hwOf(f) + WALK_W + 1.2) / sin; spans.push([sE - half, sE + half]);
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    const sp = []; for (const q of spans) { const l = sp.at(-1); if (l && q[0] <= l[1] + 4) l[1] = Math.max(l[1], q[1]); else sp.push(q.slice()); }
    const inSpan = s => sp.some(q => s > q[0] && s < q[1]);
    // samples down the middle, finer where spans begin and end so the walls stop square
    const S = []; for (let s = F0; s < F1; s += 2) S.push(s); S.push(F1);
    for (const q of sp) for (const s of [q[0], q[1]]) if (s > F0 && s < F1) S.push(s - .01, s + .01);
    S.sort((p, q) => p - q);
    const P = S.map(s => { const p = along(e.pts, e.cum, s); return { s, x: p[0], z: p[1], n: [-p[3], p[2]], y: edgeH(e, s), span: inSpan(s) }; });
    const up = e.lv > 0, BO = hw + .75, BI = hw + .08, DECK = 1.6, CEIL = -1.2;
    const at = (q, o) => [q.x + q.n[0] * o, q.z + q.n[1] * o];
    // a quad between samples i and i+1: two points at offsets oa/ob and heights from y-functions, normal nn, colour tone
    const quadS = (i, oa, ya, ob, yb, nn, tone, uScale = 3, vScale = 1.5) => {
      const q0 = P[i], q1 = P[i + 1], col = [tone, tone, tone];
      const pa0 = at(q0, oa), pb0 = at(q0, ob), pa1 = at(q1, oa), pb1 = at(q1, ob);
      const n0 = nn(q0), n1 = nn(q1);
      const v = (p, y, n, q) => ST.v(p[0], y, p[1], n[0], n[1], n[2], q.s / uScale, y / vScale + (oa + ob) * .13, col);
      const k0 = v(pa0, ya(q0), n0, q0), k1 = v(pb0, yb(q0), n0, q0), k2 = v(pb1, yb(q1), n1, q1), k3 = v(pa1, ya(q1), n1, q1);
      ST.tri(k0, k1, k2); ST.tri(k0, k2, k3);
    };
    const side = (q, sg) => [q.n[0] * sg, 0, q.n[1] * sg], upN = () => [0, 1, 0], downN = () => [0, -1, 0];
    for (let i = 0; i + 1 < P.length; i++) {
      const q0 = P[i], q1 = P[i + 1];
      if (Math.abs(q0.y) < .02 && Math.abs(q1.y) < .02) continue;
      const span = q0.span && q1.span;
      for (const sg of [-1, 1]) {
        // concrete traffic barrier along each edge (sloped face toward the road, flat top, straight back)
        quadS(i, sg * BI, q => q.y + .02, sg * (BI + .22), q => q.y + .82, q => side(q, -sg), .92);
        quadS(i, sg * (BI + .22), q => q.y + .82, sg * BO, q => q.y + .82, upN, .97);
        if (up) {
          // embankment: a retaining wall straight down to the ground; over a span, just the deck's edge (fascia)
          quadS(i, sg * BO, q => span ? q.y - DECK : 0, sg * BO, q => q.y + .82, q => side(q, sg), .86);
        } else {
          quadS(i, sg * BO, q => q.y + .82, sg * BO, () => 0, q => side(q, -sg), .8);                 // the cutting's wall
          quadS(i, sg * BO, () => 0, sg * (BO + .35), () => 0, upN, .95);                              // coping
          quadS(i, sg * (BO + .35), () => 0, sg * (BO + .35), () => .95, q => side(q, sg), .9);       // parapet at street level
          quadS(i, sg * BO, () => .95, sg * (BO + .35), () => .95, upN, .97);
          quadS(i, sg * BO, () => 0, sg * BO, () => .95, q => side(q, -sg), .88);
        }
      }
      if (up && span) {   // under the deck: the slab and its beams
        quadS(i, -BO, q => q.y - DECK, BO, q => q.y - DECK, downN, .62);
        for (let k = -2; k <= 2; k++) { const o = k * (BO - .6) / 2; quadS(i, o - .35, q => q.y - DECK - .9, o + .35, q => q.y - DECK - .9, downN, .55); quadS(i, o - .35, q => q.y - DECK, o - .35, q => q.y - DECK - .9, q => side(q, -1), .58); quadS(i, o + .35, q => q.y - DECK, o + .35, q => q.y - DECK - .9, q => side(q, 1), .58); }
      }
      if (!up && span) quadS(i, -BO, () => CEIL, BO, () => CEIL, downN, .4);                         // the roof of the short tunnel
      if (!up && !span && (q0.y < -.02 || q1.y < -.02)) { const a0 = at(q0, -BO), b0 = at(q0, BO), a1 = at(q1, -BO), b1 = at(q1, BO); MASK.flat(a0, b0, b1, a1, 0); }   // no grass over the open cutting
    }
    // the ends of each span: abutments (overpass) or the tunnel mouths' faces (underpass), straight across the road
    for (const q of sp) for (const [s, dir] of [[q[0], -1], [q[1], 1]]) {
      if (s <= F0 || s >= F1) continue;
      const p = along(e.pts, e.cum, s), y = edgeH(e, s), n = [-p[3], p[2]], d = [p[2] * dir, 0, p[3] * dir];
      const L = [p[0] - n[0] * BO, p[1] - n[1] * BO], R = [p[0] + n[0] * BO, p[1] + n[1] * BO], col = up ? [.8, .8, .8] : [.7, .7, .7];
      const y0 = up ? 0 : CEIL, y1 = up ? y - DECK : 0;
      if (y1 - y0 < .1) continue;
      const k0 = ST.v(L[0], y0, L[1], ...(up ? d.map(v => -v) : d), s / 3, y0 / 1.5, col), k1 = ST.v(R[0], y0, R[1], ...(up ? d.map(v => -v) : d), s / 3 + 4, y0 / 1.5, col),
        k2 = ST.v(R[0], y1, R[1], ...(up ? d.map(v => -v) : d), s / 3 + 4, y1 / 1.5, col), k3 = ST.v(L[0], y1, L[1], ...(up ? d.map(v => -v) : d), s / 3, y1 / 1.5, col);
      ST.tri(k0, k1, k2); ST.tri(k0, k2, k3);
    }
    return true;
  }
  // a bend where two roads join end to end: one smooth curved stretch, not a junction
  const elbow = new Set();
  for (const n of nodes.values()) {
    if (n.ring || n.edges.size !== 2) continue;
    const [e1, e2] = [...n.edges].map(id => net.edges.get(id));
    if (hwOf(e1) !== hwOf(e2) || !!e1.oneway !== !!e2.oneway || (e1.nl || 1) !== (e2.nl || 1) || !!e1.tl !== !!e2.tl) continue;
    // each road's end point and its heading toward the joint
    const end = e => { const fromA = e.a === n.id, p = along(e.pts, e.cum, fromA ? n.trim : e.len - n.trim); return [[p[0], p[1]], fromA ? [-p[2], -p[3]] : [p[2], p[3]]]; };
    const [P1, d1] = end(e1), [P2, d2] = end(e2);
    // bend through where the two headings meet, so it leaves each road at the road's own angle
    // (aiming at the joint itself tore the sidewalk where a curved road meets the bend)
    let ctl = [n.x, n.z]; const x = lineX(P1, d1, P2, d2), lim = Math.max(3, n.trim * 3);
    if (x && x[0] > 0 && x[1] > 0 && x[0] < lim && x[1] < lim) ctl = [P1[0] + d1[0] * x[0], P1[1] + d1[1] * x[0]];
    else if (!x || d1[0] * d2[0] + d1[1] * d2[1] < -.98) ctl = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];   // straight on
    const into = (e1.oneway === 1 && e1.b === n.id) || (e1.oneway === -1 && e1.a === n.id);
    piece(quad(P1, ctl, P2, Math.max(6, Math.ceil(n.trim * 1.6))), { oneway: e1.oneway ? (into ? 1 : -1) : 0, kind: e1.kind, nl: e1.nl, tl: e1.tl, cx: e1.cx, cz: e1.cz, pts: e1.pts, id: e1.id }, hwOf(e1), 0, false, [0, 0], [d1, [-d2[0], -d2[1]]]);
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
      if (opt.rural && opt.rural(L.e)) { A.fan(L.P, cap, Y_ROAD); continue; }
      A.fan(L.P, cap, Y_ROAD); W.stripUV(cap, outer, Y_WALK); for (let k = 0; k + 1 < cap.length; k++) K.wall(cap[k + 1], cap[k], Y_ROAD - .02, Y_WALK);
      const tw = (p, f) => [L.P[0] + (p[0] - L.P[0]) * f, L.P[1] + (p[1] - L.P[1]) * f];
      GU.strip(cap.map(p => tw(p, (L.hw - GW) / L.hw)), cap, Y_ROAD + .006); CT.strip(cap, cap.map(p => tw(p, (L.hw + CW) / L.hw)), Y_WALK + .004);
      continue;
    }
    const ring = [];
    for (let i = 0; i < legs.length; i++) {
      const L = legs[i], N = legs[(i + 1) % legs.length];
      ring.push([L.P[0] - L.r[0] * L.hw, L.P[1] - L.r[1] * L.hw], [L.P[0] + L.r[0] * L.hw, L.P[1] + L.r[1] * L.hw]);
      const a0 = [L.P[0] + L.r[0] * L.hw, L.P[1] + L.r[1] * L.hw], b0 = [N.P[0] - N.r[0] * N.hw, N.P[1] - N.r[1] * N.hw];
      let gap = N.ang - L.ang; if (gap <= 0) gap += Math.PI * 2;
      // a road carrying straight on past the junction: a straight kerb, not a bulge round the middle
      const cv = gap > 2.7 && gap < 3.25 ? Array.from({ length: 9 }, (_, k) => [a0[0] + (b0[0] - a0[0]) * k / 8, a0[1] + (b0[1] - a0[1]) * k / 8]) : corner(a0, L.d, b0, N.d, [n.x, n.z]);
      for (let k = 1; k < cv.length - 1; k++) ring.push(cv[k]);
      // is this corner the island side of a roundabout?
      let island = false;
      if (C) { const mid = cv[cv.length >> 1]; const tc = [C[0] - n.x, C[1] - n.z], tm = [mid[0] - n.x, mid[1] - n.z]; island = tc[0] * tm[0] + tc[1] * tm[1] > 0 && L.e.ring && N.e.ring; }
      if (!island) {
        const a1 = [L.P[0] + L.r[0] * (L.hw + WALK_W), L.P[1] + L.r[1] * (L.hw + WALK_W)], b1 = [N.P[0] - N.r[0] * (N.hw + WALK_W), N.P[1] - N.r[1] * (N.hw + WALK_W)];
        // the sidewalk's outer edge follows the kerb a sidewalk-width out (worked out on its own, it could swing
        // the other way round and paint sidewalk over the whole junction)
        const cn = normals(cv), mid = cv.length >> 1, out = (cn[mid][0] * (cv[mid][0] - n.x) + cn[mid][1] * (cv[mid][1] - n.z)) >= 0 ? 1 : -1;
        const co = off(cv, cn, out * WALK_W); co[0] = a1; co[co.length - 1] = b1;
        W.stripUV(cv, co, Y_WALK);
        for (let k = 0; k + 1 < cv.length; k++) K.wall(cv[k + 1], cv[k], Y_ROAD - .02, Y_WALK);
        GU.strip(off(cv, cn, -out * GW), cv, Y_ROAD + .006); CT.strip(cv, off(cv, cn, out * CW), Y_WALK + .004);
        // where a crosswalk meets this corner: a curb ramp with a yellow warning pad (one for each leg's crossing)
        if (n.edges.size >= 3 && !n.ring) for (const [Lg, sgn] of [[L, 1], [N, -1]]) {
          if (Lg.e.ring) continue;
          const zc = [Lg.P[0] - Lg.d[0] * 2.1, Lg.P[1] - Lg.d[1] * 2.1];
          let bi = -1, bd = 1e9;
          for (let k = 0; k < cv.length; k++) { const dx = cv[k][0] - zc[0], dz = cv[k][1] - zc[1], along2 = Math.abs(dx * Lg.d[0] + dz * Lg.d[1]), side = (dx * Lg.r[0] + dz * Lg.r[1]) * sgn; if (side > 0 && along2 < bd) { bd = along2; bi = k; } }
          if (bi < 0 || bd > 1.6) continue;
          const p = cv[bi], nn = [cn[bi][0] * out, cn[bi][1] * out], tg = [-nn[1], nn[0]], c0 = [p[0] + nn[0] * .32, p[1] + nn[1] * .32], c1 = [p[0] + nn[0] * .95, p[1] + nn[1] * .95];
          TP.flat([c0[0] - tg[0] * .7, c0[1] - tg[1] * .7], [c0[0] + tg[0] * .7, c0[1] + tg[1] * .7], [c1[0] + tg[0] * .7, c1[1] + tg[1] * .7], [c1[0] - tg[0] * .7, c1[1] - tg[1] * .7], Y_WALK + .008);
        }
      }
    }
    A.fan([n.x, n.z], ring, Y_ROAD - .004);
    // stop lines + zebra crossings
    if (n.edges.size >= 3) for (const L of legs) {
      if (L.e.ring) continue;
      const entering = !(L.e.oneway && L.e.oneway === -L.into);   // traffic comes in on this leg
      const sgIn = -1;     // incoming lane is on the leg's left looking out = -r
      const two = !L.e.oneway, pkHere = L.e.tl && L.e.pk && L.e.pk[L.e.b === n.id ? 1 : 0];
      if (entering) {
        const o0 = two ? (L.e.tl ? (pkHere ? LANE_W / 2 : -LANE_W / 2) : 0) : -L.hw + .2, o1 = two ? sgIn * (L.hw - .25) : L.hw - .2;
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
  // arrows painted in each lane before a junction: which way that lane may go
  for (const n of nodes.values()) {
    if (n.ring || n.edges.size < 3 || !n.ins) continue;
    for (const L of n.ins) {
      const e = L.edge; if (e.ring || !(L.pk || (e.nl || 1) > 1 || e.tl) || L.len < 12 || !L.mv) continue;
      for (const back of L.pk || L.len < 40 || e.lv ? [4.6] : [4.6, 26]) { const p = along(L.pts, L.cum, L.len - back); turnArrow(MK, p[0], p[1], p[2], p[3], L.mv); }
    }
  }
  // roundabout islands
  for (const [rid, C] of ringCenters) {
    if (!C) continue;
    let rw = ONEWAY_W / 2, two = false; for (const e of net.edges.values()) if (e.ring === rid) { rw = hwOf(e); two = (e.nl || 1) > 1; break; }
    const R = net.ringR(rid) - rw - .05, pts = [];
    // ring markings drawn as whole circles (most of a ring is junction surface): edge line by the island, dashes between two lanes
    const circ = r => { const o = []; for (let k = 0; k <= 72; k++) { const a = k / 72 * Math.PI * 2; o.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]); } return o; };
    line(MK, circ(R + .45), .13, Y_MARK);
    if (two) dashes(MK, circ(net.ringR(rid) - .1), .13, 2.5, 3.5, Y_MARK, 0);
    for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; pts.push([C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R]); }
    IS.fan(C, pts, Y_WALK + .02);
    const outer = pts.map(p => [p[0], p[1]]), inner = pts.map(p => [C[0] + (p[0] - C[0]) * .9, C[1] + (p[1] - C[1]) * .9]);
    W.stripUV([...outer, outer[0]], [...inner, inner[0]], Y_WALK + .03);
    for (let k = 0; k < 40; k++) K.wall(pts[k], pts[(k + 1) % 40], Y_ROAD - .02, Y_WALK + .03);
    // landscaping: a ring of shrubs and a few limestone boulders on the island
    const ri = R * .9 - 1.2;
    if (ri > 2) {
      const n = Math.max(5, Math.round(ri * 1.2));
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + rid, d = ri * (.55 + .35 * ((k * 7) % 3) / 2); deco.push([C[0] + Math.cos(a) * d, C[1] + Math.sin(a) * d, k % 3 === 0 ? 1 : 0, .7 + ((k * 13) % 5) / 10]); }
      deco.push([C[0], C[1], 0, Math.min(2, ri * .35)]);
    }
  }
  const g = new THREE.Group();
  if (deco.length) {
    const shrub = new THREE.IcosahedronGeometry(1, 1).scale(1, .65, 1).translate(0, .45, 0), rock = new THREE.IcosahedronGeometry(1, 0).scale(1, .55, .8).translate(0, .2, 0);
    for (const [kind, geo, mat] of [[0, shrub, M.islandShrub || (M.islandShrub = new THREE.MeshStandardMaterial({ color: 0x3c5a2a, roughness: .9 }))], [1, rock, M.boulder || (M.boulder = new THREE.MeshStandardMaterial({ color: 0xbdb3a0, roughness: .95 }))]]) {
      const L = deco.filter(q => q[2] === kind); if (!L.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, L.length), d = new THREE.Object3D();
      L.forEach((q, i) => { d.position.set(q[0], Y_WALK, q[1]); d.rotation.set(0, i * 1.7, 0); d.scale.setScalar(q[3]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.castShadow = true; im.receiveShadow = true; g.add(im);
    }
  }
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo.build(), mat); m.receiveShadow = shadow; g.add(m); return m; };
  if (ST.p.length) { const m = add(ST, M.concrete || (M.concrete = concreteMaterial())); m.castShadow = true; }
  if (MASK.p.length) {   // marks where the ground is cut away (the ground skips those pixels), drawn before everything else
    const m = new THREE.Mesh(MASK.build(), M.cutMask || (M.cutMask = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp })));
    m.renderOrder = -10; m.frustumCulled = false; g.add(m);
  }
  add(A, M.asphalt); add(W, M.walk); add(K, M.curb); add(MK, M.mark); add(MY, M.markY); add(IS, M.island);
  add(PW, M.parkway || (M.parkway = patchy(new THREE.MeshStandardMaterial({ map: M.tex.grass, color: 0xb2c48a, roughness: 1 }), .22, 5)));
  if (SH.p.length) add(SH, M.shoulder || (M.shoulder = patchy(new THREE.MeshStandardMaterial({ map: M.asphalt.map, color: 0x8a8884, roughness: .95 }), .5, 6)));
  if (GR.p.length) add(GR, M.gravelEdge || (M.gravelEdge = patchy(new THREE.MeshStandardMaterial({ map: M.tex.gravel, color: 0xb8ae98, roughness: 1 }), .5, 3)));
  if (TP.p.length) add(TP, M.tactile || (M.tactile = (() => {   // truncated domes: a grid of little bumps on yellow
    const S = 64, cv2 = document.createElement('canvas'); cv2.width = cv2.height = S; const g2 = cv2.getContext('2d'); g2.fillStyle = '#d9a514'; g2.fillRect(0, 0, S, S);
    for (let y = 4; y < S; y += 8) for (let x = 4; x < S; x += 8) { g2.fillStyle = '#f0c232'; g2.beginPath(); g2.arc(x, y, 2.4, 0, 7); g2.fill(); g2.fillStyle = 'rgba(0,0,0,.25)'; g2.beginPath(); g2.arc(x + .8, y + .8, 2.4, 0, 7); g2.fill(); g2.fillStyle = '#f2c436'; g2.beginPath(); g2.arc(x - .3, y - .3, 2.1, 0, 7); g2.fill(); }
    const t = new THREE.CanvasTexture(cv2); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: .8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); })()));
  add(GU, M.gutter || (M.gutter = patchy(new THREE.MeshStandardMaterial({ map: M.plainMap, color: 0xa39f96, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), .45, 4)));
  add(CT, M.curbTop || (M.curbTop = patchy(new THREE.MeshStandardMaterial({ map: M.plainMap, color: 0xe4e0d6, roughness: .85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), .25, 3)));
  // the grates and covers: small textured plates just above the road
  const plate = (list, w, dd, key, draw) => {
    if (!list.length) return;
    if (!M[key]) { const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; draw(cv.getContext('2d'), S); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; M[key] = new THREE.MeshStandardMaterial({ map: t, roughness: .55, metalness: .5, transparent: true, alphaTest: .4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); }
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, dd).rotateX(-Math.PI / 2), M[key], list.length), dm = new THREE.Object3D();
    list.forEach((q, i) => { dm.position.set(q[0], Y_ROAD + .012, q[1]); dm.rotation.set(0, q[2], 0); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
    im.receiveShadow = true; g.add(im);
  };
  plate(inlets, 1.05, .55, 'grateMat', (g2, S) => { g2.fillStyle = '#3d3b38'; g2.fillRect(0, 0, S, S); g2.fillStyle = '#121212'; for (let x = 6; x < S - 4; x += 7) g2.fillRect(x, 8, 3.5, S - 16); g2.strokeStyle = '#5a5751'; g2.lineWidth = 3; g2.strokeRect(2, 2, S - 4, S - 4); });
  plate(holes, 1.3, 1.3, 'holeMat', (g2, S) => { g2.clearRect(0, 0, S, S); g2.fillStyle = '#4a4742'; g2.beginPath(); g2.arc(S / 2, S / 2, S / 2 - 1, 0, 7); g2.fill(); g2.strokeStyle = '#2e2c29'; g2.lineWidth = 2; for (let r2 = 8; r2 < S / 2 - 3; r2 += 6) { g2.beginPath(); g2.arc(S / 2, S / 2, r2, 0, 7); g2.stroke(); } for (let a = 0; a < 8; a++) { g2.beginPath(); g2.moveTo(S / 2, S / 2); g2.lineTo(S / 2 + Math.cos(a * .785) * (S / 2 - 3), S / 2 + Math.sin(a * .785) * (S / 2 - 3)); g2.stroke(); } });
  g.userData.lamps = lamps;
  return g;
}
// cast concrete: bridges, retaining walls, barriers. Faint panel joints (the walls of Texas overpasses are built of
// 1.5 m precast panels), streaks and grime toward the bottom
function concreteMaterial() {
  // one tile = 3 m along x 1.5 m up: two square panels, each cast a slightly different shade, with dark joints between
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  noiseFill(g, S, '#b3ada1', .12, 12000, 5);
  for (const [x, t] of [[0, .05], [128, -.04]]) { g.fillStyle = t > 0 ? `rgba(255,250,240,${t})` : `rgba(40,36,30,${-t})`; g.fillRect(x, 0, 128, S); }
  for (let i = 0; i < 60; i++) { const x = (i * 97) % S, w = 1 + (i % 4); const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, `rgba(60,54,46,${.03 + (i % 4) * .02})`); gr.addColorStop(1, 'rgba(60,54,46,0)'); g.fillStyle = gr; g.fillRect(x, 0, w, S); }   // rain streaks
  g.fillStyle = 'rgba(45,42,38,.55)'; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S); g.fillRect(127, 0, 3, S);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 3, S, 1); g.fillRect(3, 0, 1, S); g.fillRect(130, 0, 1, S);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, vertexColors: true, roughness: .92, side: THREE.DoubleSide });
}
function stop(G, p0, p1, d) { G.flat([p0[0] + d[0] * .05, p0[1] + d[1] * .05], [p1[0] + d[0] * .05, p1[1] + d[1] * .05], [p1[0] + d[0] * .55, p1[1] + d[1] * .55], [p0[0] + d[0] * .55, p0[1] + d[1] * .55], Y_MARK); }
// lane arrow: mv bits 1 straight, 2 right, 4 left. Tip points along (dx, dz); right is (-dz, dx)
function turnArrow(G, x, z, dx, dz, mv) {
  const P = (f, s) => [x + dx * f - dz * s, z + dz * f + dx * s];
  const tri = (a, b, c) => { const i = G.v(a[0], Y_MARK, a[1]), j = G.v(b[0], Y_MARK, b[1]), k = G.v(c[0], Y_MARK, c[1]); G.up(i, j, k); };
  const top = mv & 1 ? .4 : -.9;
  G.flat(P(-3, -.13), P(-3, .13), P(top, .13), P(top, -.13), Y_MARK);
  if (mv & 1) tri(P(.4, -.5), P(.4, .5), P(1.6, 0));
  for (const [bit, sd] of [[2, 1], [4, -1]]) {
    if (!(mv & bit)) continue;
    const a = P(-1.15, 0), b = P(-.35, sd * .95);         // a short bend out to the side, then the head
    line(G, [a, b], .26, Y_MARK);
    const h = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(h[0], h[1]); h[0] /= L; h[1] /= L;
    const nx = -h[1], nz = h[0];
    tri([b[0] + nx * .45, b[1] + nz * .45], [b[0] - nx * .45, b[1] - nz * .45], [b[0] + h[0] * 1.05, b[1] + h[1] * 1.05]);
  }
}
function arrow(G, x, z, dx, dz) {
  const r = [-dz, dx], P = (f, s) => [x + dx * f + r[0] * s, z + dz * f + r[1] * s];
  G.flat(P(-2.6, -.13), P(-2.6, .13), P(.4, .13), P(.4, -.13), Y_MARK);
  const a = P(.4, -.55), b = P(.4, .55), c = P(1.7, 0); const i = G.v(a[0], Y_MARK, a[1]), j = G.v(b[0], Y_MARK, b[1]), k = G.v(c[0], Y_MARK, c[1]); G.up(i, j, k);
}

// ---------- buildings ----------
const STYLE = { office: 0, apt: 1, house: 2, shop: 3, big: 4 };
// Central Texas suburb: limestone, tan stucco and brick; cream and tan shopping centres.
// Each entry: [r, g, b, wall] with wall 0 stucco (tinted by the colour), 1 brick, 2 limestone (photo, lightly tinted)
const FACADE = {
  office: [[.8, .76, .66, 2], [.5, .56, .6, 0], [.86, .84, .78, 0], [.62, .6, .55, 0], [.92, .88, .8, 2]],
  apt: [[.84, .78, .64, 0], [.95, .9, .82, 1], [.9, .86, .76, 0], [1, .96, .9, 2], [.62, .52, .42, 0]],
  house: [[1, .97, .92, 2], [.82, .72, .56, 0], [.95, .9, .86, 1], [.82, .78, .78, 1], [.88, .82, .74, 2], [.9, .88, .82, 0], [.7, .68, .62, 0]],
  shop: [[.86, .8, .68, 0], [.98, .94, .88, 2], [.9, .88, .82, 0], [.72, .66, .58, 0], [1, .95, .9, 2]],
  big: [[.82, .78, .7, 0], [.74, .72, .68, 0], [.86, .84, .8, 0]],
};
const facadeOf = b => { const pal = FACADE[b.kind] || FACADE.shop; return pal[Math.floor(b.tone * pal.length) % pal.length]; };
function buildingMaterial(U, T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: 0 });
  m.onBeforeCompile = sh => {
    cloudUniforms(sh); sh.uniforms.uNight = U.uNight; sh.uniforms.tBrick = { value: T.brick }; sh.uniforms.tStone = { value: T.stone }; sh.uniforms.tStucco = { value: T.stucco }; sh.uniforms.tGravel = { value: T.gravel };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aInfo; attribute float aWall; varying vec3 vWp; varying vec3 vWn; varying vec4 vInfo; varying float vWall;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vec4 wpp = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vWp = wpp.xyz; vWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal); vInfo = aInfo; vWall = aWall;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; uniform sampler2D tBrick, tStone, tStucco, tGravel; varying vec3 vWp; varying vec3 vWn; varying vec4 vInfo; varying float vWall; float fWin; float fLit; float fRoof;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' + PATCHY + CLOUD)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 n = normalize(vWn); float st = floor(vInfo.x + .5); float H = vInfo.y;
          vec4 vI = vec4(st, H, floor(vInfo.z * 1000. + .5) / 1000., floor(vInfo.w + .5));   // (interpolation noise would scramble the hashes)
          float wallK = floor(vWall + .5);
          fRoof = step(.5, n.y);
          float u = dot(vWp.xz, vec2(-n.z, n.x)); float y = vWp.y;
          // the wall itself: photo brick or limestone, or stucco with a little texture
          vec2 wuv = vec2(u, y);
          vec3 wall;
          if (wallK < .5) wall = diffuseColor.rgb * (.72 + .3 * texture2D(tStucco, wuv / 3.2).r / .28);
          else if (wallK < 1.5) wall = texture2D(tBrick, wuv / 2.1).rgb * diffuseColor.rgb * 1.12;
          else wall = texture2D(tStone, wuv / 2.6).rgb * diffuseColor.rgb * 1.08;
          diffuseColor.rgb = wall;
          float fh = st < .5 ? 3.6 : (st > 1.5 && st < 2.5 ? 2.9 : 3.3);
          float ww = st < .5 ? 1.55 : (st > 1.5 ? 3.4 : 2.9);
          vec2 cell = vec2(u / ww, (y - .9) / fh); vec2 g = fract(cell); vec2 id = floor(cell);
          float win, band = 0., trim = 0.;
          if (st < .5 && vI.z < .35) win = step(.05, g.x) * step(g.x, .95) * step(.14, g.y) * step(g.y, .93);          // glass office
          else if (st < .5) win = step(.38, g.y) * step(g.y, .84) * step(.03, fract(u / 1.8));                          // ribbon windows
          else if (st < 1.5) { win = step(.25, g.x) * step(g.x, .75) * step(.3, g.y) * step(g.y, .8);                   // apartments
                               trim = step(.2, g.x) * step(g.x, .8) * step(.24, g.y) * step(g.y, .84) - win; }
          else if (st < 2.5) { float has = step(h21(id + vI.z * 13.), .62);                                          // a house: white-trimmed windows
                               win = step(.3, g.x) * step(g.x, .7) * step(.3, g.y) * step(g.y, .78) * has;
                               trim = (step(.26, g.x) * step(g.x, .74) * step(.25, g.y) * step(g.y, .82)) * has - win; }
          else if (st < 3.5) { float bay = fract(u / 6.), mul = fract(u / 1.5);
                               win = step(.5, y) * step(y, 3.1) * step(.05, bay) * step(bay, .95) * step(.035, mul) * step(mul, .965) * (1. - step(2.45, y) * step(y, 2.55));   // shopfronts: glass between thin frames, a transom bar
                               trim = step(.05, bay) * step(bay, .95) * step(y, 3.2) * (1. - win) * step(.3, y) * .55;                                                         // dark aluminium frames
                               band = step(3.6, y) * step(y, H - .4) * step(.08, fract(u / 12.)) * step(fract(u / 12.), .7); } // sign band
          else win = step(.4, y) * step(y, 4.2) * step(.44, fract(u / 46.)) * step(fract(u / 46.), .56);                // a big store's entrance
          if (vI.w > 1.5) { win = 0.; trim = 0.; }   // a garage wing
          else if (vI.w > .5 && st < 1.5 && y < 4.2) { win = step(.6, y) * step(.04, fract(u / 4.5)) * step(fract(u / 4.5), .96) * step(y, 3.5); trim = 0.; }   // town centre: shops downstairs
          win *= (1. - fRoof) * step(y, H - .9); band *= 1. - fRoof; trim = max(trim, 0.) * (1. - fRoof) * step(y, H - .7);
          float slab = (1. - fRoof) * step(st, .5) * (1. - step(.06, abs(fract((y - .9) / fh + .02) - .02)));
          fWin = win;
          fLit = win * step(.66 - vI.z * .2, h21(id + floor(vI.z * 97.)));
          // glass reflects the sky; a hint of blinds and rooms behind it
          vec3 glass = st < .5 ? mix(vec3(.08, .12, .15), vec3(.13, .16, .15), step(.25, vI.z)) : vec3(.07, .08, .09) + vec3(.05, .045, .04) * step(.55, h21(id * 1.7 + vI.z));
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
          diffuseColor.rgb = mix(diffuseColor.rgb, st > 2.5 && st < 3.5 ? vec3(.16, .17, .18) : vec3(.86, .85, .82), trim * .9);
          float corn = (1. - fRoof) * step(st, 3.5) * step(.5, st) * step(H - .55, y) * step(st, 1.5) + (1. - fRoof) * step(2.5, st) * step(H - .5, y);   // a cornice line along the top
          diffuseColor.rgb *= 1. - corn * .28;
          float kick = (1. - fRoof) * step(y, .45) * step(2.5, st); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .4, .37), kick);   // a stone base under the shopfronts
          { float sh = h21(vec2(floor(u / 12.), vI.z * 7.)); vec3 sc = sh < .2 ? vec3(.45, .08, .06) : sh < .4 ? vec3(.08, .14, .3) : sh < .55 ? vec3(.1, .26, .16) : sh < .7 ? vec3(.33, .24, .16) : sh < .85 ? vec3(.88, .86, .8) : vec3(.12, .12, .12);
            diffuseColor.rgb = mix(diffuseColor.rgb, sc, band); }   // each tenant's sign panel
          diffuseColor.rgb *= 1. - slab * .25;
          // flat roofs: white membrane with seams on stores, gravel elsewhere (pitched roofs sit on top as their own mesh)
          vec3 roofC = st > 2.5 ? mix(vec3(.4, .41, .41), texture2D(tGravel, vWp.xz / 4.).rgb * .85, .45) * (.9 + .1 * texture2D(tStucco, vWp.xz / 5.).r / .28) * (1. - .14 * step(fract(vWp.x / 3.05), .03))
                                : texture2D(tGravel, vWp.xz / 5.).rgb * 1.05;
          diffuseColor.rgb = mix(diffuseColor.rgb, roofC * (.9 + .2 * h21(floor(vWp.xz * .1))), fRoof);
          float ao = clamp(y / 2.2, .62, 1.); diffuseColor.rgb *= mix(1., ao, 1. - fRoof) * (1. - csh(vWp.xz) * .4);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .08, fWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, .2, fWin);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n { float k = h21(floor(vWp.xz * .7) + floor(vWp.y / 3.3)); totalEmissiveRadiance += mix(vec3(1., .72, .42), vec3(.8, .86, 1.), step(.75, k)) * fLit * uNight * (.28 + .35 * k); }');
  };
  return m;
}
// pitched roofs: photo shingles laid along each slope (world space, so any angle works)
function roofMaterial(T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85 });
  m.onBeforeCompile = sh => {
    cloudUniforms(sh); sh.uniforms.tShingle = { value: T.shingle };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRp; varying vec3 vRn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vec4 rp = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vRp = rp.xyz; vRn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tShingle; varying vec3 vRp; varying vec3 vRn;\n' + PATCHY + CLOUD)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 n = normalize(vRn); vec3 e = normalize(vec3(-n.z, 0., n.x) + vec3(1e-4, 0., 0.)); vec3 up = cross(n, e);
          vec2 ruv = vec2(dot(vRp, e), dot(vRp, up)) / 2.6;
          diffuseColor.rgb *= texture2D(tShingle, ruv).rgb * 1.9 * (1. - csh(vRp.xz) * .45); }`);
  };
  return m;
}
function roofGeo() {   // hip roof: base 1x1 at y=0, short ridge along x at y=1, sloping on all four sides
  const k = .22, P = [], add = (...v) => P.push(...v);
  const b0 = [-.5, 0, -.5], b1 = [.5, 0, -.5], b2 = [.5, 0, .5], b3 = [-.5, 0, .5], r0 = [-k, 1, 0], r1 = [k, 1, 0];
  add(...b0, ...r1, ...b1, ...b0, ...r0, ...r1);      // north slope
  add(...b2, ...r0, ...b3, ...b2, ...r1, ...r0);      // south slope
  add(...b3, ...r0, ...b0);                           // west hip
  add(...b1, ...r1, ...b2);                           // east hip
  // soffit: the underside of the overhang, so the eaves aren't see-through from below
  add(...b0, ...b1, ...b2, ...b0, ...b2, ...b3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals(); return g;
}
// ---------- trees ----------
// A crown is a cluster of round lobes (low-poly, with sphere normals so it shades softly); the leafy look comes from the shader.
function lobes(list, rnd, ctr = null) {
  const geos = [];
  // the crown's centre: normals lean toward "out from the whole crown" so it shades as one soft mass
  if (!ctr) { ctr = [0, 0, 0]; for (const l of list) for (let k = 0; k < 3; k++) ctr[k] += l[k] / list.length; }
  const jit = new Map();   // the same corner shared by neighbouring faces moves the same way (no cracks)
  for (const [x, y, z, r, sy = .8] of list) {
    const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position, nr = new Float32Array(p.count * 3), c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), key = [vx, vy, vz].map(v => v.toFixed(3)).join();
      if (!jit.has(key)) jit.set(key, .82 + rnd() * .36);
      const j = jit.get(key), px = x + vx * r * j, py = y + vy * r * sy * j, pz = z + vz * r * j;
      p.setXYZ(i, px, py, pz);
      let ox = px - ctr[0], oy = (py - ctr[1]) * 1.3, oz = pz - ctr[2]; const ol = Math.hypot(ox, oy, oz) || 1;
      const nx = vx * .35 + ox / ol * .65, ny = vy * .35 + oy / ol * .65, nz = vz * .35 + oz / ol * .65, nl = Math.hypot(nx, ny, nz) || 1;
      nr.set([nx / nl, ny / nl, nz / nl], i * 3);
      const sh = .55 + .45 * Math.max(0, Math.min(1, (vy + 1) / 2 + (y - 2.5) * .08));   // darker underneath and inside
      c.set([sh, sh, sh], i * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv');
    geos.push(g);
  }
  return mergeGeometries(geos);
}
// A leafy crown the way it really reads from above: dozens of small clusters of leaves (cards cut out of a painted leaf
// texture) spread through each lobe and facing outward, shaded as one soft mass (normals from the crown's centre),
// darker inside and underneath, around a dark core so you never see daylight straight through the middle.
const CORE_UV = [.93, .93];   // a solid patch of leaves in the texture's corner, for the core
function cards(list, rnd, per = 9, size = 1, ctr = null) {
  if (!ctr) { ctr = [0, 0, 0]; for (const l of list) for (let k = 0; k < 3; k++) ctr[k] += l[k] / list.length; }
  const P = [], N = [], C = [], UV = [], I = [];
  const add = (x, y, z, nx, ny, nz, sh, u, v) => { P.push(x, y, z); N.push(nx, ny, nz); C.push(sh, sh, sh); UV.push(u, v); return P.length / 3 - 1; };
  const nrm = (x, y, z) => { const ox = x - ctr[0], oy = (y - ctr[1]) * 1.25 + .4, oz = z - ctr[2], L = Math.hypot(ox, oy, oz) || 1; return [ox / L, oy / L, oz / L]; };
  const shade = (x, y, z, out) => .6 + .4 * Math.max(0, Math.min(1, out * .6 + (y - ctr[1]) * .14 + .45));
  for (const [x, y, z, r, sy = .8] of list) {
    const n = Math.max(3, Math.round(per * r * r / 2.2));
    for (let k = 0; k < n; k++) {
      // a spot in the lobe, mostly toward its surface
      let dx, dy, dz; do { dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1; } while (dx * dx + dy * dy + dz * dz > 1);
      const f = .55 + .45 * Math.cbrt(rnd()), dl = Math.hypot(dx, dy, dz) || 1;
      const px = x + dx / dl * r * f, py = y + dy / dl * r * sy * f, pz = z + dz / dl * r * f;
      const no = nrm(px, py, pz);
      // the card faces out of the crown (give or take), a random turn about that
      let fx = no[0] + (rnd() - .5) * .9, fy = no[1] + (rnd() - .5) * .9 + .25, fz = no[2] + (rnd() - .5) * .9; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let ax = -fz, ay = 0, az = fx; if (Math.hypot(ax, az) < .2) { ax = 1; az = 0; } const al = Math.hypot(ax, ay, az); ax /= al; az /= al;
      const bx = fy * az - fz * ay, by = fz * ax - fx * az, bz = fx * ay - fy * ax;
      const t = rnd() * 6.28, ct = Math.cos(t), st = Math.sin(t), ux = ax * ct + bx * st, uy = ay * ct + by * st, uz = az * ct + bz * st, vx = -ax * st + bx * ct, vy = -ay * st + by * ct, vz = -az * st + bz * ct;
      const h = size * r * (.5 + rnd() * .3), out = f;
      const ids = [[-1, -1, 0, 0], [1, -1, .86, 0], [1, 1, .86, .86], [-1, 1, 0, .86]].map(([a, b, u, v]) => {
        const qx = px + (ux * a + vx * b) * h, qy = py + (uy * a + vy * b) * h, qz = pz + (uz * a + vz * b) * h, qn = nrm(qx, qy, qz);
        return add(qx, qy, qz, qn[0], qn[1], qn[2], shade(qx, qy, qz, out), u, v);
      });
      I.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  // the core: the same lobes, smaller, solid and dark
  let core = lobes(list.map(([x, y, z, r, sy = .8]) => [x, y, z, r * .62, sy]), rnd, ctr); if (core.index) core = core.toNonIndexed();
  const cc = core.attributes.color; for (let i = 0; i < cc.count; i++) cc.setXYZ(i, cc.getX(i) * .55, cc.getY(i) * .55, cc.getZ(i) * .55);
  core.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(core.attributes.position.count).fill(CORE_UV).flat(), 2));
  return mergeGeometries([g.toNonIndexed(), core]);
}
// the leaf texture: clusters of small leaves (grey-green; each tree's own colour tints it), a solid patch in one corner for the cores
function leafTex() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  let sd = 3; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  // clumps of leaves, each lit from above (bright top, shaded underside), so a crown reads as lumps of foliage with gaps
  const C = S * .43, clumps = [];
  for (let i = 0; i < 26; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * C * .72; clumps.push([C + Math.cos(a) * d, C + Math.sin(a) * d, 34 + r() * 30]); }
  clumps.sort((p, q) => p[1] - q[1]);
  for (const [cx, cy, cr] of clumps) for (let i = 0; i < 95; i++) {
    const a = r() * 6.28, d = Math.pow(r(), .6) * cr, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .85;
    const L = 10 + r() * 8, W = L * (.4 + r() * .2), ang = r() * 6.28, top = 1 - (y - cy + cr) / (2 * cr);
    const v = Math.min(1, .5 + top * .42 + r() * .2), warm = (r() - .5) * .1;
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = `rgb(${Math.round(255 * Math.min(1, v + warm))},${Math.round(255 * v)},${Math.round(255 * Math.min(1, v - warm * .6))})`;
    g.beginPath(); g.ellipse(0, 0, L / 2, W / 2, 0, 0, 6.29); g.fill();
    g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.ellipse(0, W * .18, L / 2, W / 3, 0, 0, 3.15); g.fill();
    g.restore();
  }
  // the solid corner patch for the cores
  const x0 = S * .88; g.fillStyle = 'rgb(120,120,112)'; g.fillRect(x0, x0, S - x0, S - x0);
  for (let i = 0; i < 300; i++) { const v = 90 + r() * 90; g.fillStyle = `rgb(${v},${v},${v * .92})`; g.fillRect(x0 + r() * (S - x0), x0 + r() * (S - x0), 4, 3); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function limbs(list) {   // trunk and branches: [x0,y0,z0, x1,y1,z1, r0, r1]
  const geos = [];
  for (const [x0, y0, z0, x1, y1, z1, r0, r1] of list) {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), g = new THREE.CylinderGeometry(r1, r0, L, 5, 1, true).translate(0, L / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    g.applyQuaternion(q).translate(x0, y0, z0); g.deleteAttribute('uv'); geos.push(g);
  }
  return mergeGeometries(geos);
}
// live oak: short thick trunk splitting into long low limbs, a wide spreading dome of a crown (about 9 m across at scale 1)
function oakGeo(seed, lite = false) {
  const r = rng(seed), L = [], B = [[0, 0, 0, 0, 1.6, 0, .32, .26]];
  const n = lite ? 4 : 7;
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.28 + r() * .5, d = 2.8 + r() * 1.2;
    L.push([Math.cos(a) * d, 3 + r() * .7, Math.sin(a) * d, 1.45 + r() * .45, .72]);
    if (i % 3 === 0) B.push([0, 1.5, 0, Math.cos(a) * d * .75, 2.8, Math.sin(a) * d * .75, .19, .09]);
  }
  for (let i = 0; i < (lite ? 1 : 3); i++) { const a = i / 3 * 6.28 + 1, d = lite ? 0 : 1.2 + r() * .5; L.push([Math.cos(a) * d, 4.0 + r() * .5, Math.sin(a) * d, (lite ? 2.6 : 1.7) + r() * .4, .72]); }
  return { crown: cards(L, r, lite ? 6 : 9, 1.05), wood: limbs(B) };
}
// Ashe juniper ("cedar"): dense, dark, often several stems, an irregular cone
function cedarGeo(seed, lite = false) {
  const r = rng(seed), L = [], B = [[0, 0, 0, 0, 1.2, 0, .16, .12]], k = lite ? 3 : 6;
  for (let i = 0; i < k; i++) { const t = i / (k - 1), a = r() * 6.28, o = (1 - t) * .6 + .15; L.push([Math.cos(a) * o, 1.2 + t * 3.4, Math.sin(a) * o, 1.15 - t * .65 + r() * .2, .95]); }
  return { crown: cards(L, r, lite ? 7 : 16, .8), wood: limbs(B) };   // (finer, denser foliage than the oaks)
}
function shrubGeo() { const r = rng(77); return cards([[0, .45, 0, .6, .8], [.4, .35, .1, .45, .8], [-.35, .38, -.1, .5, .8]], r, 40, .9); }
// leaves: clumpy light and shade (world space noise), a little sway in the wind
function leafMaterial(U, fine) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, vertexColors: true, map: leafTex(), alphaTest: .5, side: THREE.DoubleSide });
  // shadows: the leaf clusters' own shapes (dappled shade under a tree)
  m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: .5, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    cloudUniforms(sh); sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vLp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz; float sw = max(0., position.y - 1.5) * .025;
          transformed.x += sin(uTime * 1.3 + ip.x * .05 + ip.y * .03) * sw; transformed.z += cos(uTime * 1.1 + ip.y * .05) * sw;
        #endif`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vLp = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLp;
${PATCHY}
${CLOUD}
float lh(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float ln(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(lh(i), lh(i + vec3(1,0,0)), f.x), mix(lh(i + vec3(0,1,0)), lh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(lh(i + vec3(0,0,1)), lh(i + vec3(1,0,1)), f.x), mix(lh(i + vec3(0,1,1)), lh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lf = ln(vLp * 1.7) * .5 + ln(vLp * 4.3) * .5; ${fine ? 'lf = lf * .75 + ln(vLp * 9.1) * .25;' : ''}
        diffuseColor.rgb *= (.82 + .4 * lf) * (1. - csh(vLp.xz) * .45);`)
      // far away the texture's smaller mipmaps fade the leaf edges and whole cards would vanish: keep their coverage
      .replace('#include <alphatest_fragment>', `#ifdef USE_MAP
        { vec2 tx = dFdx(vMapUv * 512.), ty = dFdy(vMapUv * 512.); float mip = max(0., .5 * log2(max(dot(tx, tx), dot(ty, ty)))); diffuseColor.a *= 1. + mip * .32; }
        #endif
        #include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => 'leaf' + fine;
  return m;
}

export function buildCity(city, M, U, Q, carGeos, opt = {}) {
  const g = new THREE.Group(), B = city.buildings, dummy = new THREE.Object3D(), col = new THREE.Color();
  const T = M.tex;
  // each building's own frame: x axis (cos, sin), front = the side facing its street
  const frame = b => {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    let fx = b.fx - b.x, fz = b.fz - b.z; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
    const ax = fx * c + fz * s, az = -fx * s + fz * c;           // front in the building's own axes
    const alongX = Math.abs(ax) >= Math.abs(az), sg = alongX ? Math.sign(ax) || 1 : Math.sign(az) || 1;
    const nx = alongX ? [c * sg, s * sg] : [-s * sg, c * sg];     // outward normal of the front wall (world)
    const tx = [-nx[1], nx[0]];                                  // along the front wall
    const hf = alongX ? b.w / 2 : b.d / 2, hw = alongX ? b.d / 2 : b.w / 2;
    return { c, s, n: nx, t: tx, hf, hw, dist: L };
  };
  // buildings
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  const NB = B.length + B.filter(b => b.kind === 'house').length;   // houses may get a garage wing
  const info = new Float32Array(NB * 4), wallA = new Float32Array(NB);
  const bm = new THREE.InstancedMesh(box, M.building || (M.building = buildingMaterial(U, T)), Math.max(1, NB));
  bm.geometry = box.clone(); bm.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4)); bm.geometry.setAttribute('aWall', new THREE.InstancedBufferAttribute(wallA, 1));
  bm.castShadow = bm.receiveShadow = true;
  const houses = B.filter(b => b.roof);
  const rm = new THREE.InstancedMesh(roofGeo(), M.roof || (M.roof = roofMaterial(T)), Math.max(1, houses.length * 2));
  let bi = B.length;   // next free building instance (garage wings)
  rm.castShadow = rm.receiveShadow = true;
  const bits = [], awn = [], signs = [], doors = [], chim = [], shrubs = [], mulchBeds = [], mulch = new Geo(), par = new Geo(true);
  let ri = 0;
  const AWN = [[.24, .2, .17], [.12, .25, .2], [.36, .12, .1], [.12, .16, .26], [.55, .45, .3], [.2, .2, .2]];
  B.forEach((b, i) => {
    const ry = -(b.rot || 0), bc = Math.cos(b.rot || 0), bs = Math.sin(b.rot || 0);   // b.rot turns its own x axis to (cos, sin) on the ground
    const at = (ox, oz) => [b.x + ox * bc - oz * bs, b.z + ox * bs + oz * bc];
    dummy.position.set(b.x, 0, b.z); dummy.rotation.set(0, ry, 0); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix(); bm.setMatrixAt(i, dummy.matrix);
    const c = facadeOf(b); col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); bm.setColorAt(i, col); wallA[i] = c[3];
    const core = Math.hypot(b.x, b.z) < 175 && b.kind !== 'house';
    info.set([STYLE[b.kind] ?? 3, b.h, b.tone, core ? 1 : 0], i * 4);
    const F = frame(b), hr = (k) => ((b.tone * 9301 + b.id * 49297 + k * 233) % 1000) / 1000;
    if (b.roof) {
      const along = b.w >= b.d, rh = 1.8 + b.tone * 1.3;
      dummy.position.set(b.x, b.h, b.z); dummy.rotation.set(0, ry + (along ? 0 : Math.PI / 2), 0); dummy.scale.set((along ? b.w : b.d) + .9, rh, (along ? b.d : b.w) + .9); dummy.updateMatrix(); rm.setMatrixAt(ri, dummy.matrix);
      const rc = [[.34, .33, .32], [.44, .38, .32], [.55, .53, .5], [.4, .34, .28], [.6, .57, .52], [.36, .36, .38]][Math.floor(b.tone * 97) % 6]; col.setRGB(rc[0], rc[1], rc[2], THREE.SRGBColorSpace); rm.setColorAt(ri++, col);   // composition shingles
      if (b.kind === 'house') {
        // garage door on the driveway side, front door on the other; a chimney on some
        const side = b.tone < .5 ? -1 : 1, o = side * Math.max(0, F.hw - 2.9), go = Math.max(-F.hw + 2.6, Math.min(F.hw - 2.6, o));
        // wider houses: a lower garage wing standing a little forward on the driveway side, with its own roof
        const wing = F.hw > 6.2 && F.hf > 3.5 && hr(9) < .7, wf = wing ? 1.2 : 0;
        if (wing) {
          const gw = 6.4, gd = Math.min(7, F.hf * 2 - .5), gx = go, gz = F.hf + wf - gd / 2, gh = 2.9;
          const cxw = b.x + F.n[0] * gz + F.t[0] * gx, czw = b.z + F.n[1] * gz + F.t[1] * gx, yaw = Math.atan2(-F.n[1], F.n[0]);
          dummy.position.set(cxw, 0, czw); dummy.rotation.set(0, yaw, 0); dummy.scale.set(gd, gh, gw); dummy.updateMatrix(); bm.setMatrixAt(bi, dummy.matrix); bm.setColorAt(bi, col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)); wallA[bi] = c[3];
          info.set([2, gh, b.tone, 2], bi * 4); bi++;
          dummy.position.set(cxw, gh, czw); dummy.rotation.set(0, yaw + Math.PI / 2, 0); dummy.scale.set(gw + .8, 1.5, gd + .8); dummy.updateMatrix(); rm.setMatrixAt(ri, dummy.matrix); rm.setColorAt(ri++, col.setRGB(rc[0], rc[1], rc[2], THREE.SRGBColorSpace));
        }
        if (F.hw > 3.2) doors.push([b.x + F.n[0] * (F.hf + wf + .04) + F.t[0] * go, b.z + F.n[1] * (F.hf + wf + .04) + F.t[1] * go, 4.8, 2.25, Math.atan2(-F.t[1], F.t[0]), 0]);
        const fo = -side * Math.min(F.hw - 1, Math.max(1.5, F.hw * .35));
        doors.push([b.x + F.n[0] * (F.hf + .04) + F.t[0] * fo, b.z + F.n[1] * (F.hf + .04) + F.t[1] * fo, 1.05, 2.15, Math.atan2(-F.t[1], F.t[0]), 1]);
        if (hr(1) < .35) { const ex = (along ? b.w : b.d) / 2 - .5, p = along ? at(ex * (hr(2) < .5 ? 1 : -1), 0) : at(0, ex * (hr(2) < .5 ? 1 : -1)); chim.push([p[0], p[1], 1.3, b.h + rh * .75 + .9, 1.1, ry, hr(3)]); }
        // foundation shrubs along the front
        { const a0 = -F.hw + .6, a1 = F.hw - .6, gs0 = go - (wing ? 3.9 : 2.8), gs1 = go + (wing ? 3.9 : 2.8);   // a mulch bed, broken by the garage
          for (const [u0, u1] of F.hw > 3.2 ? [[a0, Math.min(a1, gs0)], [Math.max(a0, gs1), a1]] : [[a0, a1]]) if (u1 - u0 > 1.2) {
            const P = (t, u) => [b.x + F.n[0] * t + F.t[0] * u, b.z + F.n[1] * t + F.t[1] * u];
            mulchBeds.push([P(F.hf, u0), P(F.hf, u1), P(F.hf + 1.7, u1), P(F.hf + 1.7, u0)]);
          } }
        const nsh = 3 + Math.floor(hr(4) * 4);
        for (let k = 0; k < nsh; k++) { const a = -F.hw + 1 + (k + .5) / nsh * (F.hw * 2 - 2); if (Math.abs(a - go) < (wing ? 3.9 : 2.8) && F.hw > 3.2) continue; shrubs.push([b.x + F.n[0] * (F.hf + .9) + F.t[0] * a, b.z + F.n[1] * (F.hf + .9) + F.t[1] * a, .8 + hr(k + 5) * .5]); }
      }
    } else {
      // parapet round a flat roof, the wall colour, with a lighter coping on top
      const pc = [c[0] * .92, c[1] * .92, c[2] * .92], cc = [.6, .58, .55], ph = b.kind === 'house' ? 0 : .9, th = .3;
      if (ph) {   // with a cornice: the top band stands a little proud of the wall
        const cx = .2, cy = b.h - .4;
        const outer = [at(-b.w / 2 - cx, -b.d / 2 - cx), at(b.w / 2 + cx, -b.d / 2 - cx), at(b.w / 2 + cx, b.d / 2 + cx), at(-b.w / 2 - cx, b.d / 2 + cx)];
        const corners = [at(-b.w / 2, -b.d / 2), at(b.w / 2, -b.d / 2), at(b.w / 2, b.d / 2), at(-b.w / 2, b.d / 2)];
        const inner = [at(-b.w / 2 + th, -b.d / 2 + th), at(b.w / 2 - th, -b.d / 2 + th), at(b.w / 2 - th, b.d / 2 - th), at(-b.w / 2 + th, b.d / 2 - th)];
        for (let k = 0; k < 4; k++) {
          const o0 = outer[k], o1 = outer[(k + 1) % 4], a0 = corners[k], a1 = corners[(k + 1) % 4], i0 = inner[k], i1 = inner[(k + 1) % 4];
          wallQ(par, o0, o1, cy, b.h + ph, pc, 1); wallQ(par, i0, i1, b.h, b.h + ph, pc, -1);
          flatBoth(par, a0, a1, o1, o0, cy, pc);      // underside of the cornice
          par.flat(o0, o1, i1, i0, b.h + ph, cc);
        }
      }
      if (b.h > 4.5) {   // air-conditioning units, vents; skylights on big stores
        const area = b.w * b.d, n = Math.max(1, Math.min(12, Math.round(area / (b.kind === 'big' ? 700 : 260)))); let s = (b.tone * 1000 + b.id) % 233280 || 1;
        const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
        for (let k = 0; k < n; k++) { const w = 1.6 + r() * 1.6, d = 1.3 + r() * 1.1, ox = (r() - .5) * (b.w - w - 4), oz = (r() - .5) * (b.d - d - 4), p = at(ox, oz); bits.push([p[0], b.h, p[1], w, 1 + r() * .7, d, ry, .55 + r() * .25]); }
        if (b.kind === 'big') for (let x = -b.w / 2 + 8; x < b.w / 2 - 6; x += 12) for (let z = -b.d / 2 + 8; z < b.d / 2 - 6; z += 14) { const p = at(x, z); bits.push([p[0], b.h, p[1], 2.4, .25, 2.4, ry, -1]); }
      }
      // shopfront canopy along the street side of stores and town-centre buildings
      if ((b.kind === 'shop' || b.kind === 'big' || core) && F.hw > 4) {
        const dep = b.kind === 'big' ? 3.5 : 2.4, len = b.kind === 'big' ? Math.min(24, F.hw) : F.hw * 2 - 1.5, y = b.kind === 'big' ? 4.4 : 3.25;
        const a = AWN[Math.floor(b.tone * 53) % AWN.length];
        awn.push([b.x + F.n[0] * (F.hf + dep / 2), b.z + F.n[1] * (F.hf + dep / 2), len, dep, y, Math.atan2(-F.t[1], F.t[0]), a]);
        if (b.kind === 'big' && b.h > 7) { const SC = [[.7, .08, .06], [.06, .2, .5], [.85, .45, .05], [.1, .35, .2]][Math.floor(b.tone * 31) % 4]; signs.push([b.x + F.n[0] * (F.hf + .2), b.z + F.n[1] * (F.hf + .2), Math.min(16, F.hw), 2.2, b.h - 2.2, Math.atan2(-F.t[1], F.t[0]), SC]); }
      }
    }
  });
  bm.count = bi; rm.count = ri;
  if (bm.instanceColor) bm.instanceColor.needsUpdate = true; if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
  g.add(bm); if (ri) g.add(rm);
  if (par.p.length) { const m = new THREE.Mesh(par.build(), M.parapet || (M.parapet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 }))); m.castShadow = m.receiveShadow = true; g.add(m); }
  if (bits.length) {
    const im = new THREE.InstancedMesh(box, M.bits || (M.bits = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, metalness: .3 })), bits.length);
    bits.forEach((q, i) => { dummy.position.set(q[0], q[1], q[2]); dummy.rotation.set(0, q[6] || 0, 0); dummy.scale.set(q[3], q[4], q[5]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, q[7] < 0 ? col.setRGB(.55, .68, .75) : col.setRGB(q[7], q[7], q[7] * .97)); });
    im.castShadow = true; im.receiveShadow = true; g.add(im);
  }
  if (awn.length) {
    const am = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .35, 1), M.awning || (M.awning = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .7 })), awn.length);
    awn.forEach((q, i) => { dummy.position.set(q[0], q[4], q[1]); dummy.rotation.set(0, q[5], 0); dummy.scale.set(q[2], 1, q[3]); dummy.updateMatrix(); am.setMatrixAt(i, dummy.matrix); am.setColorAt(i, col.setRGB(q[6][0], q[6][1], q[6][2], THREE.SRGBColorSpace)); });
    am.castShadow = true; am.receiveShadow = true; g.add(am);
  }
  if (signs.length) {
    const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, .3), M.storeSign || (M.storeSign = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, emissive: 0x000000 })), signs.length);
    signs.forEach((q, i) => { dummy.position.set(q[0], q[4], q[1]); dummy.rotation.set(0, q[5], 0); dummy.scale.set(q[2], q[3], 1); dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix); sm.setColorAt(i, col.setRGB(q[6][0], q[6][1], q[6][2], THREE.SRGBColorSpace)); });
    sm.castShadow = true; g.add(sm);
  }
  if (doors.length) {
    const dm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, .08).translate(0, .5, 0), M.door || (M.door = doorMaterial()), doors.length);
    doors.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[4], 0); dummy.scale.set(q[2], q[3], 1); dummy.updateMatrix(); dm.setMatrixAt(i, dummy.matrix); dm.setColorAt(i, q[5] ? col.setRGB(.25 + (i % 3) * .1, .16, .1, THREE.SRGBColorSpace) : col.setRGB(.93, .92, .88, THREE.SRGBColorSpace)); });
    dm.receiveShadow = true; g.add(dm);
  }
  if (chim.length) {
    const cm = new THREE.InstancedMesh(box, M.chimney || (M.chimney = new THREE.MeshStandardMaterial({ color: 0x9c8f80, roughness: .95 })), chim.length);
    chim.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[5], 0); dummy.scale.set(q[2], q[3], q[4]); dummy.updateMatrix(); cm.setMatrixAt(i, dummy.matrix); });
    cm.castShadow = true; cm.receiveShadow = true; g.add(cm);
  }
  // lots: parking, parks, yards
  const lotG = new Geo(), lines = new Geo(), parks = new Geo(), shore = new Geo(), pond = new Geo(), parked = [], lotLights = [], drive = new Geo(), stains = [], apron = new Geo(), joints = new Geo(), blue = new Geo(), islands = new Geo(), curbs = [], wheelStops = [], accSigns = [], stopSigns = [];
  const islandTrees = opt.more || (opt.more = []);
  for (const l of city.lots) {
    const x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, z0 = l.z - l.d / 2, z1 = l.z + l.d / 2;
    if (l.k === 'parking') {
      // laid out in the lot's own frame (a lot in front of a building turns with it), then put in place
      const lr = l.rot || 0, W = FR(l).W, lay = LAYOUT(l), dyn = !!l.bid;   // (a business's lot: its cars come and go, drawn by the game)
      lotG.flat(W(x0, z0), W(x1, z0), W(x1, z1), W(x0, z1), .05);
      for (let x = x0 + 14; x < x1 - 8; x += 30) for (let z = z0 + 11.6; z < z1 - 6; z += 23.2) lotLights.push(W(x, z));
      if (dyn && l.w > 16) lotLights.push(W(x0 + 2, z0 + 1.5));
      let s = Math.floor(l.seed * 1e6) || 1; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const quad = (G, a, b2, c, d2, y) => G.flat(W(a[0], a[1]), W(b2[0], b2[1]), W(c[0], c[1]), W(d2[0], d2[1]), y);
      if (dyn) {   // the walkway along the shopfront: raised concrete with a curb on the parking side
        quad(apron, [x0, z0], [x1, z0], [x1, z0 + 2.6], [x0, z0 + 2.6], .15);
        curbs.push([W(x0, z0 + 2.62), W(x1, z0 + 2.62)]);
      }
      lay.rows.forEach((row, ri) => {
        const { z, flip } = row, head = flip ? z + 5 : z;   // the end of the stall the car noses into
        for (const st of row.stalls) {
          const xl = st.x - 1.3;
          quad(lines, [xl, z], [xl + .1, z], [xl + .1, z + 5], [xl, z + 5], .065);
          wheelStops.push([...W(st.x, head + (flip ? -.55 : .55)), -lr]);
          if (r() < .7) { const sp = W(st.x + (r() - .5) * .8, head + (flip ? -1.2 : 1.2) + (r() - .5) * .8); stains.push([sp[0], sp[1], .9 + r() * 1.1, r() * 6.3, .35 + r() * .45]); }   // drips where engines sit
          if (!dyn && r() < l.fill) { const p = W(st.x, st.z); parked.push([p[0], p[1], (flip ? -1 : 1) * Math.PI / 2 + (r() - .5) * .06 - lr, r()]); }
        }
        if (row.stalls.length) { const xr = row.stalls[row.stalls.length - 1].x + 1.3; quad(lines, [xr - .1, z], [xr, z], [xr, z + 5], [xr - .1, z + 5], .065); }
        // the accessible stall nearest the door: blue, with its sign
        if (row.access) {
          const ax = row.access.x, bx = row.access.ax; quad(blue, [ax - 1.2, z + .1], [ax + 1.2, z + .1], [ax + 1.2, z + 4.9], [ax - 1.2, z + 4.9], .062);
          const sp = W(ax, flip ? z + 5.4 : z - .35); accSigns.push([sp[0], sp[1], -lr]);
          // the access aisle beside it: white diagonal stripes, a line down each side
          for (const xx of [bx - 1.25, bx + 1.25]) quad(lines, [xx - .06, z], [xx + .06, z], [xx + .06, z + 5], [xx - .06, z + 5], .066);
          for (let zz = z + .5; zz < z + 4.6; zz += .9) { const p0 = [bx - 1.2, zz], p1 = [bx + 1.2, zz + .9]; const L2 = Math.hypot(2.4, .9), nx = -.9 / L2 * .07, nz = 2.4 / L2 * .07; quad(lines, [p0[0] - nx, p0[1] - nz], [p0[0] + nx, p0[1] + nz], [p1[0] + nx, Math.min(z + 5, p1[1] + nz)], [p1[0] - nx, Math.min(z + 5, p1[1] - nz)], .066); }
        }
        // planted islands at the ends of the rows, with a tree
        if (row.island) for (const xe of [row.ends[0] + 1.3, row.ends[1] - 1.3]) {
          quad(islands, [xe - 1.2, z + .2], [xe + 1.2, z + .2], [xe + 1.2, z + 4.8], [xe - 1.2, z + 4.8], .14);
          for (const [p0, p1] of [[[xe - 1.25, z + .15], [xe + 1.25, z + .15]], [[xe + 1.25, z + .15], [xe + 1.25, z + 4.85]], [[xe + 1.25, z + 4.85], [xe - 1.25, z + 4.85]], [[xe - 1.25, z + 4.85], [xe - 1.25, z + .15]]]) curbs.push([W(p0[0], p0[1]), W(p1[0], p1[1])]);
          const tp = W(xe, z + 2.5); if (islandTrees) islandTrees.push([+tp[0].toFixed(2), +tp[1].toFixed(2), .5 + r() * .15, r() * .69]);
        }
      });
      // driveways: from the side of the lot facing the nearest street, across the sidewalk (concrete) and down a curb cut onto the road
      const ents = opt.net ? ENTRIES(l, opt.net) : [];
      for (const en of ents) {
        // a real entrance: the lot's asphalt flares out to the sidewalk between rounded curb ends, a concrete apron crosses
        // the sidewalk (joints scored across it), and a sloped lip takes it down into the gutter where the curb is cut
        const { P, n, t, L } = en, at = (s2, o) => [P[0] + n[0] * s2 + t[0] * o, P[1] + n[1] * s2 + t[1] * o];
        const sw = Math.max(.4, L - WALK_W), w = 3.3, mouth = w + 1.6;
        const strip = (G, s0, s1, w0, w1, y0, y1, segs = 1) => {
          for (let k = 0; k < segs; k++) {
            const a0 = s0 + (s1 - s0) * k / segs, a1 = s0 + (s1 - s0) * (k + 1) / segs, f0 = k / segs, f1 = (k + 1) / segs;
            const wa = w0 + (w1 - w0) * f0, wb = w0 + (w1 - w0) * f1, ya = y0 + (y1 - y0) * f0, yb = y0 + (y1 - y0) * f1;
            const p = at(a0, -wa), q = at(a0, wa), r2 = at(a1, wb), m = at(a1, -wb);
            const i = G.v(p[0], ya, p[1]), j = G.v(q[0], ya, q[1]), kk = G.v(r2[0], yb, r2[1]), mm = G.v(m[0], yb, m[1]); G.up(i, j, kk); G.up(i, kk, mm);
          }
        };
        // the mouth: asphalt, wide where it leaves the lot (rounded), narrowing to the driveway, rising to sidewalk height at the end
        const ease = k => { const f = k / 6; return mouth + (w - mouth) * (1 - Math.pow(1 - f, 2)); };
        for (let k = 0; k < 6; k++) { const s0 = sw * k / 6, s1 = sw * (k + 1) / 6, y0 = k < 4 ? .052 : .052 + (k - 4) / 2 * .12, y1 = k + 1 < 4 ? .052 : .052 + (k - 3) / 2 * .12; strip(lotG, s0, s1, ease(k), ease(k + 1), y0, y1); }
        // the apron across the sidewalk, and its lip down into the road (wider at the gutter)
        strip(apron, sw, sw + .5, w, w, .177, .177);
        strip(apron, sw + .5, L - .15, w, w + 1.4, .177, .177);          // the wings widen across the sidewalk to the curb
        strip(apron, L - .15, L + .6, w + 1.4, w + 1.4, .177, .034, 2);  // the cut curb: a short slope into the gutter
        // scored joints: along both sides, across at each end and down the middle of the apron
        const jl = (s0, s1, o0, o1, wd = .06) => { const dx = n[0] * (s1 - s0) + t[0] * (o1 - o0), dz = n[1] * (s1 - s0) + t[1] * (o1 - o0), Lj = Math.hypot(dx, dz) || 1, px = -dz / Lj * wd, pz = dx / Lj * wd, A = at(s0, o0), B2 = at(s1, o1); joints.flat([A[0] - px, A[1] - pz], [A[0] + px, A[1] + pz], [B2[0] + px, B2[1] + pz], [B2[0] - px, B2[1] - pz], .182); };
        jl(sw, sw, -w, w, .03); jl(sw + .5, sw + .5, -w, w, .02); jl(L - .15, L - .15, -w - 1.4, w + 1.4, .025); jl(sw + .5, L - .15, 0, 0, .02); jl(sw + .5, L - .15, -w * .5 - .7, -w * .5 - .7, .018); jl(sw + .5, L - .15, w * .5 + .7, w * .5 + .7, .018);
        // rounded curb ends turning into the mouth from the lot's front curb
        for (const sd of [-1, 1]) {
          const S0 = [0, sd * (mouth + 1.4)], C0 = [0, sd * mouth], S1 = [Math.min(sw, 1.6), sd * ease(Math.min(6, 6 * Math.min(sw, 1.6) / sw))];
          let prev = at(S0[0], S0[1]);
          for (let k = 1; k <= 5; k++) { const f = k / 5, u = 1 - f, s2 = u * u * S0[0] + 2 * u * f * C0[0] + f * f * S1[0], o = u * u * S0[1] + 2 * u * f * C0[1] + f * f * S1[1], p = at(s2, o); curbs.push([prev, p]); prev = p; }
        }
        // a stop bar across the mouth, and a stop sign on the right going out
        const sb = Math.max(.15, sw - .55), wb = ease(6 * sb / sw) - .3;
        lines.flat(at(sb - .22, -.1), at(sb - .22, wb), at(sb + .22, wb), at(sb + .22, -.1), .068);   // (the way out is the right-hand half)
        const ss = at(Math.max(.1, sw - .7), mouth + .9); stopSigns.push([ss[0], ss[1], Math.atan2(n[1], -n[0])]);
      }
      // a curb all round, open at the driveways; a planted strip with shrubs between the lot and the street
      const corners = [W(x0, z0), W(x1, z0), W(x1, z1), W(x0, z1)];
      for (let k = 0; k < 4; k++) {
        const A = corners[k], B = corners[(k + 1) % 4], len = Math.hypot(B[0] - A[0], B[1] - A[1]); if (len < .5) continue;
        const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len; let cuts = [];
        for (const en of ents) { const pr = (en.P[0] - A[0]) * ux + (en.P[1] - A[1]) * uz, off = Math.abs((en.P[0] - A[0]) * -uz + (en.P[1] - A[1]) * ux); if (off < 1 && pr > -7 && pr < len + 7) cuts.push([pr - 6.3, pr + 6.3]); }   // (the rounded curb ends take it from there)
        cuts.sort((p, q) => p[0] - q[0]); let s0 = 0;
        const seg = (a2, b2) => { if (b2 - a2 > .3) curbs.push([[A[0] + ux * a2, A[1] + uz * a2], [A[0] + ux * b2, A[1] + uz * b2]]); };
        for (const [c0, c1] of cuts) { seg(s0, Math.max(s0, c0)); s0 = Math.max(s0, c1); } seg(s0, len);
        if (cuts.length) for (let s3 = 2; s3 < len - 1.5; s3 += 2.7) { if (cuts.some(([c0, c1]) => s3 > c0 - .6 && s3 < c1 + .6)) continue; const nx = uz, nz = -ux; shrubs.push([A[0] + ux * s3 + nx * .55, A[1] + uz * s3 + nz * .55, .45 + r() * .2]); }
      }
    } else {
      parks.flat([x0, z0], [x1, z0], [x1, z1], [x0, z1], .035);
      // a retention pond in some of the bigger parks
      const hh = Math.abs(Math.sin(l.x * 12.9898 + l.z * 78.233) * 43758.5453) % 1;
      if (l.w > 38 && l.d > 38 && hh < .6) {
        const rx = l.w * (.22 + hh * .2), rz = l.d * (.2 + hh * .25), sh = [], wt = [];
        for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2, wob = 1 + .08 * Math.sin(a * 3 + hh * 20); sh.push([l.x + Math.cos(a) * (rx + 2.2) * wob, l.z + Math.sin(a) * (rz + 2.2) * wob]); wt.push([l.x + Math.cos(a) * rx * wob, l.z + Math.sin(a) * rz * wob]); }
        shore.fan([l.x, l.z], sh, .045); pond.fan([l.x, l.z], wt, .06);
      }
    }
  }
  if (shore.p.length) { const m = new THREE.Mesh(shore.build(), M.shore || (M.shore = patchy(new THREE.MeshStandardMaterial({ map: T.lawn, color: 0x8c8a62, roughness: 1 }), .4, 4))); m.receiveShadow = true; g.add(m); }
  if (pond.p.length) { const m = new THREE.Mesh(pond.build(), M.pond || (M.pond = new THREE.MeshStandardMaterial({ color: 0x2f4f4a, roughness: .04, metalness: .1 }))); m.receiveShadow = true; g.add(m); }
  if (lotG.p.length) { const m = new THREE.Mesh(lotG.build(), M.lot); m.receiveShadow = true; g.add(m); }
  if (lines.p.length) g.add(new THREE.Mesh(lines.build(), M.mark));
  if (stains.length) {   // oil drips in the stalls: soft dark irregular spots
    if (!M.stainTex) { const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g2 = cv.getContext('2d'); let s = 7; const rr = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 26; i++) { const x = S / 2 + (rr() - .5) * S * .45, y = S / 2 + (rr() - .5) * S * .3, rad = 6 + rr() * 22, gr = g2.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, S, S); }
      M.stainTex = new THREE.CanvasTexture(cv); }
    const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), M.stain || (M.stain = new THREE.MeshBasicMaterial({ color: 0x000000, map: M.stainTex, transparent: true, depthWrite: false, opacity: .55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), stains.length);
    stains.forEach((q, i) => { dummy.position.set(q[0], .056, q[1]); dummy.rotation.set(0, q[3], 0); dummy.scale.set(q[2] * 1.4, 1, q[2]); dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix); });
    sm.renderOrder = 1; g.add(sm); dummy.scale.set(1, 1, 1);
  }
  if (apron.p.length) { const m = new THREE.Mesh(apron.build(), M.apron || (M.apron = patchy(new THREE.MeshStandardMaterial({ map: M.slab.map, color: 0xd9d4c8, roughness: .9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), .35, 3))); m.receiveShadow = true; g.add(m); }
  if (joints.p.length) g.add(new THREE.Mesh(joints.build(), M.joint || (M.joint = new THREE.MeshStandardMaterial({ color: 0x8c8981, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))));
  if (blue.p.length) g.add(new THREE.Mesh(blue.build(), M.accPaint || (M.accPaint = new THREE.MeshStandardMaterial({ color: 0x1f4fa0, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 }))));
  if (islands.p.length) { const m = new THREE.Mesh(islands.build(), M.mulchIsl || (M.mulchIsl = patchy(new THREE.MeshStandardMaterial({ map: T.lawn, color: 0x7d8f52, roughness: 1 }), .4, 3))); m.receiveShadow = true; g.add(m); }
  if (curbs.length) {   // concrete curbs round the lots and islands
    const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .16, .3).translate(0, .08, 0), M.curb, curbs.length);
    curbs.forEach(([a2, b2], i) => { const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]); dummy.position.set((a2[0] + b2[0]) / 2, .03, (a2[1] + b2[1]) / 2); dummy.rotation.set(0, Math.atan2(-(b2[1] - a2[1]), b2[0] - a2[0]), 0); dummy.scale.set(L, 1, 1); dummy.updateMatrix(); cm.setMatrixAt(i, dummy.matrix); });
    cm.receiveShadow = true; cm.castShadow = Q.shadows > 1; g.add(cm); dummy.scale.set(1, 1, 1);
  }
  if (wheelStops.length) {   // concrete wheel stops at the head of each stall
    const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, .13, .22).translate(0, .12, 0), M.curb, wheelStops.length);
    wheelStops.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[2], 0); dummy.updateMatrix(); wm.setMatrixAt(i, dummy.matrix); });
    wm.receiveShadow = true; g.add(wm);
  }
  for (const [list, geo, mat] of [[accSigns, M.accSignGeo || (M.accSignGeo = mergeGeometries([new THREE.CylinderGeometry(.04, .04, 2.2, 6).translate(0, 1.1, 0), new THREE.BoxGeometry(.04, .45, .32).translate(0, 2, 0)])), M.accSignMat || (M.accSignMat = new THREE.MeshStandardMaterial({ color: 0x2456b0, roughness: .5 }))],
                                  [stopSigns, M.stopGeo || (M.stopGeo = mergeGeometries([new THREE.CylinderGeometry(.04, .04, 2.1, 6).translate(0, 1.05, 0), new THREE.CylinderGeometry(.3, .3, .04, 8).rotateZ(Math.PI / 2).translate(0, 2.05, 0)])), M.stopMat || (M.stopMat = new THREE.MeshStandardMaterial({ color: 0xb3221a, roughness: .5 }))]]) {
    if (!list.length) continue; const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((q, i) => { dummy.position.set(q[0], .05, q[1]); dummy.rotation.set(0, q[2], 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }); im.castShadow = Q.shadows > 1; g.add(im);
  }
  if (parks.p.length) { const m = new THREE.Mesh(parks.build(), M.park || (M.park = patchy(new THREE.MeshStandardMaterial({ map: T.lawn, color: 0x9cb46a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), .35, 8))); m.receiveShadow = true; g.add(m); }
  // houses: a lawn, a concrete driveway to the street, a wooden privacy fence round the back yard, sometimes a pool
  const lawn = new Geo(), pool = new Geo(), deck = new Geo(), fence = [], boxes = [];
  for (const m of mulchBeds) mulch.flat(m[0], m[1], m[2], m[3], .045);
  for (const b of B) {
    if (b.kind !== 'house') continue;
    let fxv = b.fx - b.x, fzv = b.fz - b.z; const L = Math.hypot(fxv, fzv); if (L < 4) continue; fxv /= L; fzv /= L;
    const px = -fzv, pz = fxv, c = Math.cos(b.rot || 0), sn = Math.sin(b.rot || 0);
    const hf = Math.abs(fxv * c + fzv * sn) * b.w / 2 + Math.abs(-fxv * sn + fzv * c) * b.d / 2;   // half size toward the street
    const hp = Math.abs(px * c + pz * sn) * b.w / 2 + Math.abs(-px * sn + pz * c) * b.d / 2;       // ... and across
    const edge = (b.e ? hwOf(b.e) : 3.5) + WALK_W, len = L - hf - edge;
    const q = (t, s2, o = 0) => [b.x + fxv * t + px * (o + s2), b.z + fzv * t + pz * (o + s2)];
    if (len > 1.5) {
      const side = b.tone < .5 ? -1 : 1, o = side * Math.max(0, hp - 2.9), w = 2.6;
      drive.flat(q(hf, -w, o), q(hf, w, o), q(hf + len, w, o), q(hf + len, -w, o), .055);
      // on across the grass strip and the sidewalk to the street, with a cut curb (like the lots' driveways, smaller)
      { const tK = hf + len + WALK_W, prof = [[hf + len, .06, w], [hf + len + .3, .177, w], [tK - .15, .177, w + .7], [tK + .45, .034, w + .7]];
        for (let k = 0; k + 1 < prof.length; k++) { const [t0, y0, w0] = prof[k], [t1, y1, w1] = prof[k + 1], A2 = q(t0, -w0, o), B2 = q(t0, w0, o), C2 = q(t1, w1, o), D2 = q(t1, -w1, o);
          const i = apron.v(A2[0], y0, A2[1]), j = apron.v(B2[0], y0, B2[1]), kk = apron.v(C2[0], y1, C2[1]), mm = apron.v(D2[0], y1, D2[1]); apron.up(i, j, kk); apron.up(i, kk, mm); } }
      const hc = ((b.id * 2654435761) >>> 0) / 4294967296;   // some households have a car (or two) at home
      if (len > 6.5 && hc < (Q.shadows > 1 ? .7 : .45)) {
        const two = hc < .2 && len > 6.5, yaw = Math.atan2(-fzv, fxv) + (hc < .35 ? Math.PI : 0);
        for (const sd of two ? [-1.3, 1.3] : [0]) { const p = q(hf + 1.2 + 2.35, sd, o); parked.push([p[0], p[1], yaw + (hc * 40 % 1 - .5) * .08, (hc * 977 + sd + 2) % 1]); }
      }
      const mb = q(hf + len - .7, (w + .8) * -side, o); boxes.push([mb[0], mb[1], .45, 1.15, .45, Math.atan2(-pz, px), 0]);   // a brick mailbox by the street
    }
    if (b.lw > 0) {   // fence: along the back lot line and down both sides to the house
      const rear = Math.max(4, Math.min(16, (b.ld || 30) - 7 - hf * 2)), bk = hf + rear, half = b.lw / 2;
      lawn.flat(q(-bk, -half), q(-bk, half), q(hf + Math.max(0, len), half), q(hf + Math.max(0, len), -half), .03);
      // (a fence stops short of any road built across the yard since: it never runs over a sidewalk or into a bridge wall)
      const clearOf = (x, z) => { const h = opt.net && opt.net.nearestEdge(x, z, 30); return !h || h.d > halfW(h.e) + WALK_W + .4; };
      const seg = (t0, s0, t1, s1) => {
        const a = [b.x + fxv * -t0 + px * s0, b.z + fzv * -t0 + pz * s0], e2 = [b.x + fxv * -t1 + px * s1, b.z + fzv * -t1 + pz * s1], L = Math.hypot(e2[0] - a[0], e2[1] - a[1]), ang = Math.atan2(-(e2[1] - a[1]), e2[0] - a[0]);
        const n = Math.max(1, Math.ceil(L / 2.5)); let run = -1;
        const flush = k => { if (run < 0) return; const p0 = [a[0] + (e2[0] - a[0]) * run / n, a[1] + (e2[1] - a[1]) * run / n], p1 = [a[0] + (e2[0] - a[0]) * k / n, a[1] + (e2[1] - a[1]) * k / n]; fence.push([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, L * (k - run) / n, ang]); run = -1; };
        for (let k = 0; k < n; k++) { const m = [a[0] + (e2[0] - a[0]) * (k + .5) / n, a[1] + (e2[1] - a[1]) * (k + .5) / n]; if (clearOf(m[0], m[1])) { if (run < 0) run = k; } else flush(k); }
        flush(n);
      };
      seg(bk, -half, bk, half); seg(0, -half, bk, -half); seg(0, half, bk, half);
      seg(0, -half, 0, -hp); seg(0, hp, 0, half);   // short runs from the house to the side lot lines
      // a pool in some back yards (it's Texas), with a concrete deck; a patio otherwise
      const h = ((b.id * 7919 + Math.floor(b.tone * 1000)) % 100) / 100;
      if (rear > 9 && h < .22) { const pw = Math.min(2.2, half - 3), t0 = hf + 2.2, t1 = Math.min(bk - 2, t0 + 6.5), so = (h < .11 ? 1 : -1) * Math.max(0, Math.min(2, half - pw - 3)); if (pw > 1.4 && t1 - t0 > 4) { deck.flat(q(-t0 + 1.2, -pw - 1.2, so), q(-t0 + 1.2, pw + 1.2, so), q(-t1 - 1, pw + 1.2, so), q(-t1 - 1, -pw - 1.2, so), .05); pool.flat(q(-t0, -pw, so), q(-t0, pw, so), q(-t1, pw, so), q(-t1, -pw, so), .065); } }
      else if (rear > 6) deck.flat(q(-hf, -Math.min(hp, 3.5)), q(-hf, Math.min(hp, 3.5)), q(-hf - 3.2, Math.min(hp, 3.5)), q(-hf - 3.2, -Math.min(hp, 3.5)), .05);
    }
  }
  if (parked.length) {   // in parking lots and on driveways
    const pm = new THREE.InstancedMesh(carGeos.car, M.car, parked.length); pm.castShadow = Q.shadows > 1; pm.receiveShadow = true;
    parked.forEach((p, i) => { dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, p[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); pm.setColorAt(i, carColor(p[3], col)); });
    g.add(pm);
  }
  if (mulch.p.length) { const m = new THREE.Mesh(mulch.build(), M.mulch || (M.mulch = patchy(new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), .5, 1.5))); m.receiveShadow = true; g.add(m); }
  if (lawn.p.length) { const m = new THREE.Mesh(lawn.build(), M.lawn || (M.lawn = patchy(new THREE.MeshStandardMaterial({ map: T.grass, color: 0xb6c88e, roughness: 1 }), .22, 7))); m.receiveShadow = true; g.add(m); }
  if (drive.p.length) { const m = new THREE.Mesh(drive.build(), M.slab); m.receiveShadow = true; g.add(m); }
  if (deck.p.length) { const m = new THREE.Mesh(deck.build(), M.slab); m.receiveShadow = true; g.add(m); }
  if (boxes.length) {
    const xm = new THREE.InstancedMesh(box, M.mailbox || (M.mailbox = new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: .9 })), boxes.length);
    boxes.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[5], 0); dummy.scale.set(q[2], q[3], q[4]); dummy.updateMatrix(); xm.setMatrixAt(i, dummy.matrix); });
    xm.castShadow = Q.shadows > 1; xm.receiveShadow = true; g.add(xm);
  }
  if (lotLights.length) {   // tall lights over the parking lots (they glow at night with the street lights)
    const pole = new THREE.CylinderGeometry(.09, .12, 9, 5).translate(0, 4.5, 0), head = new THREE.BoxGeometry(.9, .2, .5).translate(0, 9, 0);
    const lm = new THREE.InstancedMesh(mergeGeometries([pole.toNonIndexed(), head.toNonIndexed()]), M.pole, lotLights.length);
    lotLights.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); lm.setMatrixAt(i, dummy.matrix); });
    lm.castShadow = Q.shadows > 1; g.add(lm);
  }
  g.userData.lotLights = lotLights;
  if (pool.p.length) { const m = new THREE.Mesh(pool.build(), M.pool || (M.pool = new THREE.MeshStandardMaterial({ color: 0x1b7f98, roughness: .06, metalness: .05, emissive: 0x031c24 }))); m.receiveShadow = true; g.add(m); }
  if (fence.length) {
    const fm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.8, .12).translate(0, .9, 0), M.fence || (M.fence = fenceMaterial()), fence.length);
    fence.forEach((f, i) => { dummy.position.set(f[0], 0, f[1]); dummy.rotation.set(0, f[3], 0); dummy.scale.set(f[2], 1, 1); dummy.updateMatrix(); fm.setMatrixAt(i, dummy.matrix); });
    fm.castShadow = Q.shadows > 1; fm.receiveShadow = true; g.add(fm);
  }
  // trees (plus woods on land the city hasn't reached yet) and shrubs
  const leaf = M.leaf || (M.leaf = leafMaterial(U, Q.treeDetail > 1)), wood = M.trunk || (M.trunk = new THREE.MeshStandardMaterial({ color: 0x4a3d31, roughness: .95 }));
  const ownTrees = opt.more && opt.more.length ? city.trees.concat(opt.more) : city.trees;
  for (const [Tr, shadow] of [[ownTrees, true], [opt.wild || [], Q.shadows > 1]]) if (Tr.length) {
    // the woods round the town are mostly seen from afar: simpler crowns there
    const kinds = Tr === ownTrees ? (M.treeGeos || (M.treeGeos = [oakGeo(11), oakGeo(23), oakGeo(37), cedarGeo(5), cedarGeo(9)])) : (M.treeLite || (M.treeLite = [oakGeo(11, true), oakGeo(23, true), oakGeo(37, true), cedarGeo(5, true), cedarGeo(9, true)]));
    const pick = t => t[3] < .7 ? Math.floor(t[3] * 4.29) % 3 : 3 + (Math.floor(t[3] * 97) % 2);
    const cnt = kinds.map(() => 0); for (const t of Tr) cnt[pick(t)]++;
    const cm = kinds.map((k, v) => new THREE.InstancedMesh(k.crown, leaf, Math.max(1, cnt[v]))), wm = kinds.map((k, v) => new THREE.InstancedMesh(k.wood, wood, Math.max(1, cnt[v])));
    const used = kinds.map(() => 0);
    for (const t of Tr) {
      const v = pick(t), s = t[2], k = (t[3] * 7.13) % 1, i = used[v]++;
      const sc = v < 3 ? [s * .88, s * .9 + .1, s * .88] : [s * .9, s * 1.05, s * .9];
      dummy.position.set(t[0], 0, t[1]); dummy.rotation.set(0, t[3] * 6.28 * 7, 0); dummy.scale.set(...sc); dummy.updateMatrix();
      cm[v].setMatrixAt(i, dummy.matrix); wm[v].setMatrixAt(i, dummy.matrix);
      if (v < 3) col.setRGB(.29 + k * .08, .37 + k * .07, .15 + k * .04, THREE.SRGBColorSpace);   // live oak: olive green
      else col.setRGB(.18 + k * .05, .25 + k * .05, .17 + k * .03, THREE.SRGBColorSpace);         // cedar: dark blue-green
      cm[v].setColorAt(i, col);
    }
    for (let v = 0; v < kinds.length; v++) { if (!cnt[v]) continue; cm[v].count = wm[v].count = cnt[v]; cm[v].castShadow = shadow; cm[v].receiveShadow = true; cm[v].customDepthMaterial = leaf.userData.depth; wm[v].castShadow = shadow && Q.shadows > 1; g.add(cm[v], wm[v]); }
  }
  if (shrubs.length) {
    const sm = new THREE.InstancedMesh(M.shrubGeo || (M.shrubGeo = shrubGeo()), leaf, shrubs.length);
    shrubs.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, i * 2.4, 0); dummy.scale.set(q[2], q[2], q[2]); dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix); sm.setColorAt(i, col.setRGB(.17 + (i % 4) * .03, .27 + (i % 3) * .03, .13, THREE.SRGBColorSpace)); });
    sm.castShadow = Q.shadows > 1; sm.receiveShadow = true; sm.customDepthMaterial = leaf.userData.depth; g.add(sm);
  }
  return g;
}
// a flat quad seen from above and below
function flatBoth(G, a, b, c, d, y, col) {
  const ids = [a, b, c, d].map(p => G.v(p[0], y, p[1], 0, -1, 0, 0, 0, col));
  G.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3], ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
}
// a wall quad between two ground points, coloured, facing one side (sg = 1 or -1)
function wallQ(G, a, b, y0, y1, col, sg) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = sg * -dz / L, nz = sg * dx / L;
  const i = G.v(a[0], y0, a[1], nx, 0, nz, 0, 0, col), j = G.v(b[0], y0, b[1], nx, 0, nz, 0, 0, col), k = G.v(b[0], y1, b[1], nx, 0, nz, 0, 0, col), l = G.v(a[0], y1, a[1], nx, 0, nz, 0, 0, col);
  G.i.push(i, j, k, i, k, l, i, k, j, i, l, k);
}
// garage doors (panels) and front doors
function doorMaterial() {
  const t = canvasTex(64, (g, S) => { g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = 'rgba(0,0,0,.22)'; for (let i = 1; i < 4; i++) g.fillRect(0, i * S / 4 - 1, S, 2); g.fillStyle = 'rgba(0,0,0,.1)'; for (let i = 1; i < 8; i++) g.fillRect(i * S / 8, 0, 1, S); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S); g.fillRect(S - 2, 0, 2, S); }, false);
  return new THREE.MeshStandardMaterial({ map: t, roughness: .6 });
}
// cedar privacy fence: vertical pickets, weathered
function fenceMaterial() {
  const t = canvasTex(128, (g, S) => { g.fillStyle = '#8a7258'; g.fillRect(0, 0, S, S); for (let i = 0; i < 16; i++) { const v = 110 + ((i * 37) % 40); g.fillStyle = `rgb(${v + 20},${v},${v - 25})`; g.fillRect(i * 8 + 1, 0, 6, S); } g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, S * .12, S, 3); g.fillRect(0, S * .85, S, 3); });
  t.repeat.set(.35, 1);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: .95 });
  m.onBeforeCompile = sh => {   // pickets in world space along the fence (it's stretched per run)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFu;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vec4 fw = modelMatrix * instanceMatrix * vec4(position, 1.); vFu = vec2(fw.x + fw.z, position.y / 1.8);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFu;').replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vec2(vFu.x * .5, vFu.y)); diffuseColor *= sampledDiffuseColor;');
  };
  return m;
}

// ---------- vehicles ----------
// Bodies are side profiles extruded across the width with rounded edges; glass is a slightly larger cabin profile.
// Vertex colours: white body (tinted per car), dark trim and glass. aLight: 1 head, 2 tail, 3 left blinker, 4 right blinker.
const PAINT = [[.92, .92, .9], [.06, .06, .07], [.62, .63, .65], [.35, .36, .38], [.92, .92, .9], [.06, .06, .07], [.62, .63, .65], [.1, .16, .32], [.55, .06, .06], [.16, .2, .26], [.8, .78, .7], [.2, .28, .22], [.74, .48, .12], [.4, .1, .12]];
export function carColor(r, col) { const n = PAINT.length, c = PAINT[((Math.floor(r * n) % n) + n) % n]; return col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }   // (any number in, never out of range)
const GLASS = [.04, .05, .06], BODY = [1, 1, 1], DARK = [.07, .07, .075], HEAD = [1, 1, .95], TAIL = [.5, .05, .04], AMBER = [.9, .45, .05], CHROME = [.55, .56, .58];
function paint(g, rgb, light = 0) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), l = new Float32Array(n);
  for (let i = 0; i < n; i++) { c.set(rgb, i * 3); l[i] = light; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aLight', new THREE.BufferAttribute(l, 1));
  g.clearGroups(); return g;
}
function part(geos, w, h, d, x, y, z, rgb, light = 0) { geos.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), rgb, light)); }
// cars aren't boxes: seen from above the nose and tail round off, and the cabin narrows towards the roof.
// WARP (set while a car is built) bends every body and glass part that way
let WARP = null;
function carWarp(L, belt, roof) {
  const h = L / 2;
  return (x, y, z) => {
    const t = Math.min(1, Math.abs(x) / h), e = Math.max(0, (t - .7) / .3);
    let k = Math.sqrt(Math.max(0, 1 - e * e * .42));                           // round the corners in plan
    k *= 1 - .13 * Math.max(0, Math.min(1, (y - belt) / Math.max(.2, roof - belt)));   // tumblehome
    k *= 1 - .035 * Math.max(0, Math.min(1, (belt - y) / belt * 2.2));          // tuck in at the sills
    return z * k;
  };
}
// round off a profile's corners (Chaikin): a smoother silhouette
function smoothP(pts, n = 2) {
  for (let it = 0; it < n; it++) { const o = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } pts = o; }
  return pts;
}
// extrude a side profile [[x, y], ...] (x forward) to width W, rounded edges
function slab(pts, W, rgb, bevel = .08) {
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(.05, W - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * .7, bevelSegments: WARP ? 3 : 1, curveSegments: 1 });
  g.translate(0, 0, -(W - 2 * bevel) / 2);
  if (WARP) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, WARP(p.getX(i), p.getY(i), p.getZ(i))); }
  g.computeVertexNormals();
  return paint(g, rgb);
}
// glass that sits proud of a body (vans, trucks): the window outline grown a little, a touch wider than the body
function glass(pts, W, top) {
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  return slab(pts.map(p => [cx + (p[0] - cx) * 1.035, Math.min(top, cy + (p[1] - cy) * 1.035)]), W + .04, GLASS, .07);
}
// a car's cabin: all-round glass, narrower than the body (tumblehome), with a body-coloured roof panel
function cabin(gs, pts, W, roofY) {
  gs.push(slab(pts, W - .2, GLASS, .07));
  const xs = pts.filter(p => p[1] >= roofY - .05).map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  gs.push(slab([[x1 + .03, roofY - .04], [x1 - .02, roofY + .04], [x0 + .02, roofY + .04], [x0 - .03, roofY - .04]], W - .22, BODY, .06));
}
function wheels(geos, xs, w, r = .34) {
  const tire = new THREE.CylinderGeometry(r, r, .24, 14, 1, true).rotateX(Math.PI / 2), hub = new THREE.CircleGeometry(r * .62, 10);
  for (const x of xs) for (const s of [-1, 1]) { geos.push(paint(tire.clone().translate(x, r, s * (w / 2 - .16)), DARK)); geos.push(paint(hub.clone().rotateY(s < 0 ? Math.PI : 0).translate(x, r, s * (w / 2 - .04)), CHROME)); }
}
function lamps(geos, L, W, yh, yt, rear = -L / 2, front = L / 2) {
  for (const s of [-1, 1]) {
    part(geos, .08, .14, .36, front, yh, s * (W / 2 - .3), HEAD, 1);
    part(geos, .08, .16, .3, rear, yt, s * (W / 2 - .26), TAIL, 2);
    part(geos, .09, .1, .12, front - .02, yh, s * (W / 2 - .06), AMBER, s < 0 ? 3 : 4);    // blinkers: left side is -z
    part(geos, .09, .1, .1, rear + .01, yt + .13, s * (W / 2 - .08), AMBER, s < 0 ? 3 : 4);
  }
}
function mirrors(geos, x, y, W) { for (const s of [-1, 1]) part(geos, .12, .12, .2, x, y, s * (W / 2 + .07), BODY); }
export function vehicleGeos() {
  const make = fn => { const geos = []; fn(geos); const g = mergeGeometries(geos); g.computeBoundingSphere(); return g; };
  return {
    car: make(gs => {   // sedan
      const L = 4.6, W = 1.82, h = L / 2; WARP = carWarp(L, .95, 1.42);
      gs.push(slab(smoothP([[-h, .34], [h - .08, .34], [h, .5], [h - .05, .74], [h - .9, .86], [1.05, .98], [-1.35, 1.0], [-h + .1, .94], [-h, .7]], 1), W, BODY, .12));
      cabin(gs, smoothP([[1.12, .95], [.32, 1.41], [-.78, 1.41], [-1.42, .97]], 1), W, 1.4); WARP = null;
      part(gs, .16, .2, W * .96, h - .03, .45, 0, DARK); part(gs, .16, .2, W * .96, -h + .03, .45, 0, DARK);
      lamps(gs, L, W, .7, .82); mirrors(gs, .9, 1.05, W - .1); wheels(gs, [1.38, -1.4], W);
    }),
    hatch: make(gs => {
      const L = 4.2, W = 1.78, h = L / 2; WARP = carWarp(L, .95, 1.43);
      gs.push(slab(smoothP([[-h, .34], [h - .08, .34], [h, .5], [h - .05, .74], [h - .75, .86], [.9, .98], [-h + .1, 1.0], [-h, .7]], 1), W, BODY, .12));
      cabin(gs, smoothP([[.97, .95], [.2, 1.44], [-1.55, 1.43], [-h + .12, .97]], 1), W, 1.42); WARP = null;
      part(gs, .16, .2, W * .96, h - .03, .45, 0, DARK); part(gs, .16, .2, W * .96, -h + .03, .45, 0, DARK);
      lamps(gs, L, W, .7, .92); mirrors(gs, .75, 1.05, W - .1); wheels(gs, [1.28, -1.3], W, .32);
    }),
    suv: make(gs => {
      const L = 4.85, W = 1.96, h = L / 2; WARP = carWarp(L, 1.15, 1.74);
      gs.push(slab(smoothP([[-h, .42], [h - .1, .42], [h, .6], [h - .04, .95], [h - .85, 1.08], [1.1, 1.18], [-h, 1.2], [-h, .7]], 1), W, BODY, .13));
      cabin(gs, smoothP([[1.16, 1.15], [.55, 1.73], [-h + .2, 1.73], [-h + .06, 1.17]], 1), W, 1.72); WARP = null;
      part(gs, .18, .26, W * .97, h - .04, .55, 0, DARK); part(gs, .18, .26, W * .97, -h + .04, .55, 0, DARK);
      part(gs, L * .55, .05, W * .7, -.3, 1.77, 0, DARK);   // roof rails
      lamps(gs, L, W, .92, 1.05); mirrors(gs, .95, 1.25, W - .1); wheels(gs, [1.45, -1.5], W, .39);
    }),
    pickup: make(gs => {   // full-size pickup: cab and an open bed
      const L = 5.3, W = 2.0, h = L / 2; WARP = carWarp(L, 1.22, 1.85);
      gs.push(slab(smoothP([[-.55, .45], [h - .1, .45], [h, .65], [h - .02, 1.12], [h - 1.0, 1.2], [1.05, 1.25], [-.55, 1.25]], 1), W, BODY, .12));
      cabin(gs, smoothP([[1.1, 1.22], [.55, 1.85], [-.45, 1.85], [-.55, 1.22]], 1), W, 1.84); WARP = null;
      gs.push(slab([[-h, .5], [-.55, .5], [-.55, 1.18], [-h, 1.18]], W, BODY, .05));
      part(gs, h - .65, .04, W - .24, -(h + .55) / 2 - .02, 1.19, 0, [.12, .12, .12]);   // bed floor seen from above
      part(gs, .2, .32, W * .97, h - .05, .62, 0, CHROME); part(gs, .2, .26, W * .97, -h + .05, .58, 0, DARK);
      lamps(gs, L, W, 1.0, 1.0); mirrors(gs, .9, 1.35, W - .1); wheels(gs, [1.7, -1.75], W, .41);
    }),
    van: make(gs => {   // delivery van
      const L = 5.6, W = 2.05, h = L / 2;
      gs.push(slab([[-h, .42], [h - .1, .42], [h, .6], [h - .05, 1.05], [h - .55, 1.2], [h - 1.05, 2.0], [h - 1.3, 2.45], [-h, 2.45], [-h, .6]], W, BODY));
      gs.push(glass([[h - .55, 1.2], [h - 1.05, 1.98], [h - 1.55, 1.98], [h - 1.55, 1.2]], W - .1, 1.97));
      part(gs, .18, .26, W * .97, h - .04, .55, 0, DARK); part(gs, .18, .26, W * .97, -h + .04, .55, 0, DARK);
      lamps(gs, L, W, .95, 1.1); mirrors(gs, h - 1.1, 1.6, W - .1); wheels(gs, [1.75, -1.85], W, .37);
    }),
    truck: make(gs => {   // box truck
      const L = 8.5, W = 2.4, h = L / 2;
      gs.push(slab([[h - 2.2, .7], [h - .1, .7], [h, .9], [h - .05, 1.6], [h - .45, 2.0], [h - .7, 2.85], [h - 2.2, 2.85]], W - .1, BODY));
      gs.push(glass([[h - .45, 2.0], [h - .7, 2.75], [h - 1.3, 2.75], [h - 1.3, 2.0]], W - .2, 2.74));
      part(gs, 6.1, 2.85, W, -1.15, 2.05, 0, [.92, .92, .9]);
      part(gs, L, .3, W * .85, 0, .65, 0, DARK);
      lamps(gs, L, W, .95, 1.0); mirrors(gs, h - .8, 2.2, W - .1); wheels(gs, [3.0, -2.2, -3.4], W, .5);
    }),
    police: make(gs => {   // a police utility vehicle: black and white, light bar on the roof, push bar
      const L = 4.95, W = 2.0, h = L / 2, K = [.04, .045, .05], Wt = [.95, .95, .95]; WARP = carWarp(L, 1.15, 1.74);
      gs.push(slab(smoothP([[-h, .42], [h - .1, .42], [h, .6], [h - .04, .95], [h - .85, 1.08], [1.1, 1.18], [-h, 1.2], [-h, .7]], 1), W, K, .13));
      gs.push(slab([[-1.3, .62], [1.0, .62], [1.0, 1.12], [-1.3, 1.12]], W + .03, Wt, .02));   // white doors
      cabin(gs, smoothP([[1.16, 1.15], [.55, 1.73], [-h + .2, 1.73], [-h + .06, 1.17]], 1), W, 1.72); WARP = null;
      part(gs, 2.2, .05, W - .26, -.4, 1.765, 0, Wt);                                // white roof
      part(gs, .3, .14, W * .75, -.05, 1.84, 0, [.12, .12, .14]);                    // light bar
      for (const sd of [-1, 1]) part(gs, .26, .12, W * .34, -.05, 1.86, sd * W * .2, sd < 0 ? [1, .1, .08] : [.15, .3, 1], sd < 0 ? 5 : 6);
      part(gs, .2, .44, W * .7, h + .08, .72, 0, K);                                  // push bar
      part(gs, .18, .26, W * .97, -h + .04, .55, 0, K);
      lamps(gs, L, W, .92, 1.05); mirrors(gs, .95, 1.25, W - .1); wheels(gs, [1.45, -1.5], W, .39);
    }),
    ems: make(gs => {   // ambulance: cab and a white box with a red band and lights on the corners
      const L = 6.4, W = 2.2, h = L / 2, Rd = [.75, .06, .05], Wt = [.96, .96, .95];
      gs.push(slab([[h - 2.0, .5], [h - .1, .5], [h, .7], [h - .05, 1.2], [h - .5, 1.35], [h - .9, 2.1], [h - 2.0, 2.1]], W - .1, Wt));
      gs.push(glass([[h - .5, 1.35], [h - .9, 2.0], [h - 1.5, 2.0], [h - 1.5, 1.35]], W - .2, 1.99));
      part(gs, 4.3, 2.35, W, -h + 2.15, 1.75, 0, Wt);
      part(gs, 4.32, .32, W + .02, -h + 2.15, 1.45, 0, Rd);
      for (const sd of [-1, 1]) { part(gs, .22, .16, .3, h - 2.0, 2.96, sd * (W / 2 - .2), sd < 0 ? [1, .1, .08] : [1, .1, .08], 5); part(gs, .22, .16, .3, -h + .1, 2.96, sd * (W / 2 - .2), [1, .1, .08], 6); }
      part(gs, L, .3, W * .85, 0, .55, 0, DARK);
      lamps(gs, L, W, .95, 1.2); mirrors(gs, h - .9, 1.7, W - .1); wheels(gs, [h - 1.0, -h + 1.3], W, .42);
    }),
    fire: make(gs => {   // fire engine: red, chrome, a ladder on top
      const L = 10, W = 2.5, h = L / 2, Rd = [.62, .04, .03], Ch = [.7, .7, .72];
      gs.push(slab([[h - 2.4, .7], [h - .05, .7], [h, .95], [h - .05, 2.0], [h - .3, 2.9], [h - 2.4, 2.9]], W, Rd, .1));
      gs.push(glass([[h - .1, 1.95], [h - .3, 2.75], [h - 1.0, 2.75], [h - 1.0, 1.95]], W - .1, 2.74));
      part(gs, L - 2.5, 2.3, W, -1.2, 1.85, 0, Rd);
      part(gs, L - 2.6, .1, W + .04, -1.2, 1.3, 0, Ch); part(gs, L - 2.6, .1, W + .04, -1.2, 2.4, 0, Ch);
      for (const sd of [-1, 1]) part(gs, L - 1.0, .1, .08, -.6, 3.25, sd * .42, Ch);                       // ladder rails
      for (let x = -h + .7; x < h - 1.2; x += .7) part(gs, .06, .06, .84, x, 3.25, 0, Ch);                 // rungs
      part(gs, .3, .16, W * .8, h - 1.4, 3.0, 0, [.12, .12, .14]);
      for (const sd of [-1, 1]) part(gs, .26, .14, W * .32, h - 1.4, 3.06, sd * W * .2, [1, .1, .08], sd < 0 ? 5 : 6);
      part(gs, .25, .4, W * .9, h + .05, .9, 0, Ch);
      lamps(gs, L, W, 1.1, 1.1); mirrors(gs, h - .5, 2.3, W); wheels(gs, [h - 1.6, -h + 2.6, -h + 1.4], W, .52);
    }),
    bus: make(gs => {   // yellow school bus with a hood
      const L = 12, W = 2.5, h = L / 2;
      gs.push(slab([[-h, .55], [h - .05, .55], [h, .8], [h - .05, 1.35], [h - 1.3, 1.45], [h - 1.45, 2.95], [-h, 2.95], [-h, .6]], W, BODY, .1));
      part(gs, L - 1.6, .7, W + .04, -.75, 2.05, 0, GLASS);                 // window band
      part(gs, .1, .9, W * .85, h - 1.42, 2.1, 0, GLASS);                    // windscreen
      part(gs, L - 1.4, .12, W + .05, -.65, 1.55, 0, DARK); part(gs, L - 1.4, .12, W + .05, -.65, 1.25, 0, DARK);   // black rub rails
      part(gs, L - 1.5, .06, W * .8, -.7, 2.97, 0, [.95, .95, .92]);         // white roof
      lamps(gs, L, W, 1.0, 1.4); mirrors(gs, h - .2, 1.9, W); wheels(gs, [h - 2.0, -h + 3.0], W, .52);
    }),
  };
}
export function vehicleMaterial(U, fine = true) {
  const m = fine ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .32, metalness: .35, clearcoat: .9, clearcoatRoughness: .12 }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .3, metalness: .4 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.uNight; sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLight; attribute float aBrake; varying float vLight; varying float vBrake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLight = aLight; vBrake = aBrake;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; uniform float uTime; varying float vLight; varying float vBrake;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lk = floor(vLight + .5), fl = floor(vBrake + .5), lt = step(7.5, fl); fl -= 8. * lt;
        float bk = mod(fl, 2.), sg = floor(fl / 2. + .01);
        float hd = 1. - step(.5, abs(lk - 1.)), tl = 1. - step(.5, abs(lk - 2.));
        float haz = 1. - step(.5, abs(sg - 3.));
        float bl = (1. - step(.5, abs(lk - 3.))) * max(1. - step(.5, abs(sg - 1.)), haz) + (1. - step(.5, abs(lk - 4.))) * max(1. - step(.5, abs(sg - 2.)), haz);
        float on = step(.5, fract(uTime * 1.4)), fa = step(.5, fract(uTime * 2.7 + floor(uTime * 1.35) * .5));
        float b5 = 1. - step(.5, abs(lk - 5.)), b6 = 1. - step(.5, abs(lk - 6.));
        totalEmissiveRadiance += vec3(1., .93, .78) * hd * (uNight * 3. + .12) + vec3(1., .04, .02) * tl * (uNight * 1.2 + bk * 2.5 + .05) + vec3(1., .5, .05) * bl * on * 3.
          + (vec3(1., .06, .03) * b5 * fa + vec3(.12, .3, 1.) * b6 * (1. - fa)) * lt * 9. + (b5 + b6) * .08;`);
  };
  return m;
}
// one instanced mesh per vehicle look; aBrake is per instance (brake lights + 2 * blinker: 1 left, 2 right)
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
// parked cars (there are many): a plainer sedan
export function staticCarGeo() {
  const gs = [], L = 4.6, W = 1.82, h = L / 2;
  gs.push(slab([[-h, .34], [h - .08, .34], [h, .5], [h - .05, .74], [h - .9, .86], [1.05, .98], [-1.35, 1.0], [-h + .1, .94], [-h, .7]], W, BODY, 0));
  gs.push(slab([[1.05, .96], [.32, 1.4], [-.78, 1.4], [-1.35, .98]], W - .2, GLASS, 0));
  part(gs, .5, .04, W - .25, -.25, 1.41, 0, BODY);
  const tire = new THREE.CylinderGeometry(.34, .34, .22, 6, 1, true).rotateX(Math.PI / 2);
  for (const x of [1.38, -1.4]) for (const sd of [-1, 1]) gs.push(paint(tire.clone().translate(x, .34, sd * (W / 2 - .16)), DARK));
  const g = mergeGeometries(gs); g.computeBoundingSphere();
  g.setAttribute('aBrake', new THREE.InstancedBufferAttribute(new Float32Array(20000), 1)); return g;
}

// people: torso, head and hair, legs and arms that swing as they walk (in the shader).
// aPart: 0 still, 1/2 left/right leg, 3/4 left/right arm. aKind: 0 shirt (per-person colour), 1 skin, 2 trousers, 3 hair, 4 shoes
export function personGeo() {
  const geos = [];
  const add = (g, part, kind) => {
    g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1)); g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
    geos.push(g);
  };
  for (const [sd, part] of [[-1, 1], [1, 2]]) {
    add(new THREE.BoxGeometry(.15, .8, .15).translate(0, .5, sd * .09), part, 2);          // leg
    add(new THREE.BoxGeometry(.24, .1, .13).translate(.04, .05, sd * .09), part, 4);       // shoe
  }
  add(new THREE.BoxGeometry(.24, .58, .38).translate(0, 1.18, 0), 0, 0);                    // torso
  add(new THREE.BoxGeometry(.22, .1, .36).translate(0, .93, 0), 0, 2);                      // hips
  for (const [sd, part] of [[-1, 3], [1, 4]]) {
    add(new THREE.BoxGeometry(.11, .3, .11).translate(0, 1.3, sd * .25), part, 0);          // sleeve
    add(new THREE.BoxGeometry(.09, .32, .09).translate(0, .99, sd * .25), part, 1);         // forearm
  }
  add(new THREE.BoxGeometry(.08, .1, .08).translate(0, 1.5, 0), 0, 1);                      // neck
  add(new THREE.SphereGeometry(.115, 7, 5).scale(1, 1.15, .95).translate(0, 1.64, 0), 0, 1); // head
  add(new THREE.SphereGeometry(.122, 7, 3, 0, Math.PI * 2, 0, Math.PI * .5).scale(1.02, 1.1, 1).translate(-.01, 1.66, 0), 0, 3);   // hair
  return mergeGeometries(geos);
}
export function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: .85 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aPart; attribute float aKind; attribute vec3 aLook; attribute float aWalk;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float pp = floor(aPart + .5);
          if (pp > .5) {
            float arm = step(2.5, pp), sd = mod(pp, 2.) > .5 ? 1. : -1.;
            float piv = arm > .5 ? 1.44 : .92, ang = aWalk * (arm > .5 ? -.45 : .5) * sd;
            float cs = cos(ang), sn = sin(ang), yy = transformed.y - piv;
            transformed.xy = vec2(transformed.x * cs - yy * sn, transformed.x * sn + yy * cs + piv);
          } }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        { float k = floor(aKind + .5);
          vec3 skin = mix(mix(vec3(.93, .74, .6), vec3(.72, .5, .36), smoothstep(0., .5, aLook.x)), vec3(.36, .23, .15), smoothstep(.5, 1., aLook.x));
          float pi = floor(aLook.y * 5.);
          vec3 pants = pi < 1. ? vec3(.1, .15, .28) : pi < 2. ? vec3(.47, .42, .31) : pi < 3. ? vec3(.06, .06, .07) : pi < 4. ? vec3(.28, .29, .31) : vec3(.18, .22, .36);
          float hi = floor(aLook.z * 4.);
          vec3 hair = hi < 1. ? vec3(.05, .04, .035) : hi < 2. ? vec3(.22, .13, .07) : hi < 3. ? vec3(.62, .48, .3) : vec3(.55, .54, .52);
          vec3 pc = k < 1.5 ? skin : k < 2.5 ? pants : k < 3.5 ? hair : vec3(.08, .07, .07);
          #ifdef USE_INSTANCING_COLOR
          vColor = k < .5 ? instanceColor : pc;
          #endif
        }`);
  };
  return m;
}

export function lampGeo() {   // street light: pole + arm + head
  const pole = new THREE.CylinderGeometry(.08, .12, 7.5, 6).translate(0, 3.75, 0), arm = new THREE.BoxGeometry(.08, .08, 1.8).translate(0, 7.4, .9), head = new THREE.BoxGeometry(.32, .14, .7).translate(0, 7.3, 1.7);
  return mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), head.toNonIndexed()]);
}
// Traffic lights Texas style: a pole at the kerb with a mast arm over the road and one signal head over each lane
// (black with a yellow-edged backplate); stop signs on the other approaches of plain junctions.
// Returns the static meshes and the lamp positions [{n, L, x, y, z, k}] (k 0 red, 1 yellow, 2 green).
export function buildSignals(net, M) {
  const gs = [], lamps = [], stops = [];
  const P = (g, rgb) => gs.push(paint(g, rgb));
  const POLE = [.36, .37, .38], HEAD = [.05, .05, .05], YEL = [.85, .7, .1];
  for (const n of net.nodes.values()) {
    if (!n.ins || n.ring || n.edges.size < 3) continue;
    const apps = new Map(); for (const L of n.ins) { const k = L.edge.id + ':' + L.dir; if (!apps.has(k)) apps.set(k, []); apps.get(k).push(L); }
    for (const ls of apps.values()) {
      const kerb = ls.find(l => !l.li && !l.pk) || ls[0], e = kerb.edge, hw = halfW(e);
      const p = along(kerb.pts, kerb.cum, kerb.len), h = [p[2], p[3]], r = [-h[1], h[0]], th = Math.atan2(-h[1], h[0]);
      const off = hw - laneOff(e, 0) + .9;
      const px = p[0] + r[0] * off + h[0] * .4, pz = p[1] + r[1] * off + h[1] * .4;
      if (!n.sig) { if (net.stopAt(n, e)) stops.push([p[0] + r[0] * (off - .2) - h[0] * .6, p[1] + r[1] * (off - .2) - h[1] * .6, th]); continue; }
      // one head over each lane of this approach
      const ds = ls.map(l => { const q = along(l.pts, l.cum, l.len); return [(px - q[0]) * r[0] + (pz - q[1]) * r[1], l]; });
      const reach = Math.max(2.5, ...ds.map(d => d[0])) + .6;
      P(new THREE.CylinderGeometry(.13, .17, 6.4, 7).translate(px, 3.2, pz), POLE);
      const arm = new THREE.CylinderGeometry(.07, .1, reach, 6).rotateZ(Math.PI / 2).translate(-reach / 2, 0, 0).rotateY(Math.atan2(-r[1], r[0])).translate(px, 6.1, pz);
      P(arm, POLE);
      for (const [d, l] of ds) {
        const hx = px - r[0] * d, hz = pz - r[1] * d, y = 5.35;
        const mk = (w, ht, dp, f, rgb) => P(new THREE.BoxGeometry(dp, ht, w).rotateY(th).translate(hx + h[0] * f, y, hz + h[1] * f), rgb);
        mk(.42, 1.18, .3, 0, HEAD); mk(.8, 1.52, .03, .17, YEL); mk(.7, 1.42, .03, .15, HEAD);
        P(new THREE.CylinderGeometry(.03, .03, .55, 4).translate(hx, 6.0, hz), POLE);
        [y + .37, y, y - .37].forEach((ly, k) => lamps.push({ n, L: l, x: hx - h[0] * .17, y: ly, z: hz - h[1] * .17, k }));
      }
    }
  }
  const g = new THREE.Group();
  if (gs.length) { const m = new THREE.Mesh(mergeGeometries(gs), M.signal || (M.signal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .3 }))); m.castShadow = true; g.add(m); }
  if (stops.length) {
    const sg = [];
    sg.push(paint(new THREE.CylinderGeometry(.035, .035, 2.4, 5).translate(0, 1.2, 0), POLE));
    sg.push(paint(new THREE.CylinderGeometry(.4, .4, .025, 8).rotateZ(Math.PI / 2).rotateX(Math.PI / 8).translate(-.05, 2.35, 0), [.95, .95, .95]));
    sg.push(paint(new THREE.CylinderGeometry(.36, .36, .03, 8).rotateZ(Math.PI / 2).rotateX(Math.PI / 8).translate(-.07, 2.35, 0), [.7, .04, .04]));
    const sm = new THREE.InstancedMesh(mergeGeometries(sg), M.signal || (M.signal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .3 })), stops.length);
    const d = new THREE.Object3D(); stops.forEach((q, i) => { d.position.set(q[0], 0, q[1]); d.rotation.set(0, q[2], 0); d.updateMatrix(); sm.setMatrixAt(i, d.matrix); });
    sm.castShadow = true; g.add(sm);
  }
  return { group: g, lamps };
}
export function signalGeo() {  // pole + mast arm + housing
  const pole = new THREE.CylinderGeometry(.1, .13, 5.6, 6).translate(0, 2.8, 0), arm = new THREE.BoxGeometry(.1, .1, 3.2).translate(0, 5.4, -1.6), box = new THREE.BoxGeometry(.36, 1.05, .34).translate(0, 4.85, -2.9);
  return mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), box.toNonIndexed()]);
}
// headlight light on the road ahead of a car at night (a soft cone, drawn flat on the ground)
export function beamMaterial() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d'), im = g.createImageData(64, 32);
  for (let x = 0; x < 64; x++) for (let y = 0; y < 32; y++) {
    const u = x / 63, v = (y - 15.5) / 16, w = .25 + u * .75, k = Math.pow(1 - u, 1.3) * Math.min(1, u * 6) * Math.exp(-(v * v) / (w * w * .35));
    const i = (y * 64 + x) * 4; im.data[i] = 255; im.data[i + 1] = 226; im.data[i + 2] = 170; im.data[i + 3] = Math.round(k * 255);
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
}
