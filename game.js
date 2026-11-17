// Groundwork: a valley you dig. The ground is a height grid; dirt that is piled too steep slides,
// water flows over it (a "virtual pipes" shallow-water model), and the whole valley is saved in the
// browser so nothing ever resets.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { makeTextures } from './textures.js?v=14';
import * as MOD from './models.js?v=14';
import { Sound } from './audio.js?v=14';
import { makeCrew } from './crew.js?v=14';
import { makeWorks } from './construct.js?v=14';
import { makePeople } from './people.js?v=14';

const N = 256, NN = N * N;           // 256 x 256 cells, 1 m each
const SAVE_KEY = 'groundwork.save.v3';   // v1 (the first, smaller valley) is left untouched in the browser
const SPRING_Q = 4;                  // m³ of river water entering per second
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const angWrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- noise
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function makeNoise(seed) {
  const r = mulberry32(seed), P = new Uint16Array(512), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const G = new Float32Array(256); for (let i = 0; i < 256; i++) G[i] = r() * 2 - 1;
  const fade = t => t * t * (3 - 2 * t);
  const v = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const a = G[P[(xi & 255) + P[zi & 255]]], b = G[P[((xi + 1) & 255) + P[zi & 255]]];
    const c = G[P[(xi & 255) + P[(zi + 1) & 255]]], d = G[P[((xi + 1) & 255) + P[(zi + 1) & 255]]];
    const u = fade(xf), w = fade(zf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, z, oct = 4) => { let s = 0, amp = 1, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += v(x * f, z * f) * amp; n += amp; amp *= .5; f *= 2; } return s / n; };
}

// ---------------------------------------------------------------- world state
// The valley is a 256 x 256 m grid of 1 m cells. A river runs west to east through the middle, two creeks feed it
// (one from the north, one from the south) and a marsh sits in a hollow. The yard is south of the river; the gravel
// pit and the logging camp are across water.
const H = new Float32Array(NN);      // ground height
const H0 = new Float32Array(NN);     // the ground as it was before anyone dug (rebuilt from the seed; used for soil layers and bulking)
const SWELL = 1.2;                   // dug soil takes up 20% more room loose than it did in the ground
const COMP = new Uint8Array(NN);     // 1 = rolled flat by tracks or wheels (compacted fill resists washing away)
const W = new Float32Array(NN);      // water depth
const BED = new Float32Array(NN);    // can't dig below this
const M = new Uint8Array(NN);        // top material: 0 grass, 1 dirt, 2 gravel
const D = new Uint8Array(NN);        // 1 = disturbed (no grass)
const TINT = new Float32Array(NN);   // colour variation
const RD = new Float32Array(NN);     // distance to the nearest original river or creek line
const FL = new Float32Array(NN), FR = new Float32Array(NN), FU = new Float32Array(NN), FD = new Float32Array(NN);
const SPRINGS = [];                  // {cells, q, cap}
const GRAVEL = { x: 92, z: 62, r: 19, h: 9 };
const YARD = { x0: 108, x1: 140, z0: 166, z1: 188 };
const CAMP = { x: 212, z: 42 };
const MARSH = { x: 214, z: 166, r: 16 };
const inYard = (x, z, m = 0) => x > YARD.x0 - m && x < YARD.x1 + m && z > YARD.z0 - m && z < YARD.z1 + m;
let seed = 1 + Math.floor(Math.random() * 1e6);

// rivers: control points [x, z, bed level]; hw = half width of the water, bank = how far the valley sides reach
const RIVERS = [
  { name: 'river', hw: 5.5, bank: 15, depth: 1.8, q: 11, pts: [[-12, 100, 9.2], [30, 92, 8.9], [62, 110, 8.6], [96, 128, 8.3], [130, 119, 8.0], [165, 100, 7.6], [200, 108, 7.2], [234, 124, 6.8], [268, 120, 6.4]] },
  { name: 'north creek', hw: 3.2, bank: 9, depth: .9, q: 10, pts: [[152, -12, 10.4], [160, 24, 9.8], [146, 56, 9.2], [153, 84, 8.6], [141, 113, 7.9]] },
  { name: 'south creek', hw: 3, bank: 9, depth: .85, q: 9, pts: [[72, 268, 10.2], [60, 232, 9.7], [76, 196, 9.2], [64, 158, 8.7], [86, 125, 8.3]] },
];
for (const r of RIVERS) {
  const curve = new THREE.CatmullRomCurve3(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.ceil(curve.getLength() * 2);
  r.s = curve.getSpacedPoints(n).map((p, i) => {
    const f = i / n * (r.pts.length - 1), a = Math.floor(f), b = Math.min(r.pts.length - 1, a + 1);
    return [p.x, p.z, lerp(r.pts[a][2], r.pts[b][2], f - a)];
  });
  // straight on beyond the map's edge (used for the land around the valley)
  const s = r.s, A = s[0], B = s[3], Y = s[s.length - 4], Z = s[s.length - 1];
  r.ends = [[A, [A[0] - B[0], A[1] - B[1]], (A[2] - B[2]) / Math.hypot(A[0] - B[0], A[1] - B[1])], [Z, [Z[0] - Y[0], Z[1] - Y[1]], (Z[2] - Y[2]) / Math.hypot(Z[0] - Y[0], Z[1] - Y[1])]];
}
// nearest river point anywhere (inside or outside the map): {d, bed, r}
function riverAt(x, z) {
  let best = { d: 1e9, bed: 0, r: null };
  for (const r of RIVERS) {
    for (const p of r.s) { const dx = x - p[0], dz = z - p[1]; if (Math.abs(dx) > best.d || Math.abs(dz) > best.d) continue; const d = Math.hypot(dx, dz); if (d < best.d) best = { d, bed: p[2], r }; }
    for (const [p, dir, slope] of r.ends) {
      const l = Math.hypot(dir[0], dir[1]), ux = dir[0] / l, uz = dir[1] / l, t = (x - p[0]) * ux + (z - p[1]) * uz;
      if (t <= 0) continue;
      const d = Math.abs((x - p[0]) * uz - (z - p[1]) * ux);
      if (d < best.d) best = { d, bed: p[2] + slope * t, r };
    }
  }
  return best;
}

function hAt(x, z) {
  x = clamp(x, 0, N - 1.001); z = clamp(z, 0, N - 1.001);
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, k = j * N + i;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const cellOf = (x, z) => clamp(Math.round(z), 0, N - 1) * N + clamp(Math.round(x), 0, N - 1);
const wAt = (x, z) => W[cellOf(x, z)];
// bridge decks: a drivable surface above the ground and water (0 = no deck). Machines use gAt / wetAt.
const DECK = new Float32Array(NN);
const gAt = (x, z) => { const h = hAt(x, z), d = DECK[cellOf(x, z)]; return d > h ? d : h; };
const wetAt = (x, z) => DECK[cellOf(x, z)] > 0 ? 0 : W[cellOf(x, z)];

// what changed: per terrain chunk (for redrawing) and per 16 m tile (for the dirt-sliding check)
const CH = 32, NCH = Math.ceil((N - 1) / CH), TILE = 16, NT = N / TILE;
const chunkDirty = new Uint8Array(NCH * NCH).fill(1);
const tileLoose = new Uint8Array(NT * NT).fill(1);
let anyDirty = true, edgeDirty = true, dirtBox = null;
function dirty(k) {
  const i = k % N, j = (k / N) | 0;
  for (const [di, dj] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const ci = clamp(Math.floor((i + di) / CH), 0, NCH - 1), cj = clamp(Math.floor((j + dj) / CH), 0, NCH - 1);
    chunkDirty[cj * NCH + ci] = 1;
  }
  tileLoose[((j / TILE) | 0) * NT + ((i / TILE) | 0)] = 1;
  anyDirty = true;
  if (i < 2 || j < 2 || i > N - 3 || j > N - 3) edgeDirty = true;
  if (!dirtBox) dirtBox = [i, i, j, j]; else { dirtBox[0] = Math.min(dirtBox[0], i); dirtBox[1] = Math.max(dirtBox[1], i); dirtBox[2] = Math.min(dirtBox[2], j); dirtBox[3] = Math.max(dirtBox[3], j); }
}

// ---------------------------------------------------------------- generation
// How the land meets a river: a wide, gentle valley down to a floodplain just above the water, then a natural bank
// into the channel (not a canyon).
function carve(g, d, bed, r, wide = 1) {
  const lvl = bed + r.depth, flood = lvl + .6, vw = r.bank * 3 * wide, cw = r.hw * 1.7;
  if (d < vw) { const t = clamp((d - cw) / (vw - cw), 0, 1); g = Math.min(g, flood + Math.pow(t, 1.35) * Math.max(0, g - flood)); }
  if (d < cw) { const t = clamp((d - r.hw * .3) / (cw - r.hw * .3), 0, 1); g = Math.min(g, bed + t * t * (flood - bed)); }
  return g;
}
let noiseFn = null;
const MARSH_LEVEL = { v: 0 };
function generate(sd, settle) {
  const nz = makeNoise(sd), rnd = mulberry32(sd * 7 + 3);
  noiseFn = nz;
  M.fill(0); D.fill(0); W.fill(0); FL.fill(0); FR.fill(0); FU.fill(0); FD.fill(0);
  // where the rivers are: stamp each river point into the cells around it
  const rbed = new Float32Array(NN), rid = new Int8Array(NN).fill(-1);
  RD.fill(1e9);
  RIVERS.forEach((r, ri) => {
    for (const [px, pz, bed] of r.s) {
      const R = r.bank * 3 + 2;
      for (let j = Math.max(0, Math.floor(pz - R)); j <= Math.min(N - 1, Math.ceil(pz + R)); j++)
        for (let i = Math.max(0, Math.floor(px - R)); i <= Math.min(N - 1, Math.ceil(px + R)); i++) {
          const d = Math.hypot(i - px, j - pz), k = j * N + i;
          if (d < RD[k]) { RD[k] = d; rbed[k] = bed; rid[k] = ri; }
        }
    }
  });
  for (let k = 0; k < NN; k++) if (RD[k] > 1e8) RD[k] = 60;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, d = RD[k];
    const amp = clamp(d / 30, .3, 1);
    let g = 13.5 + (N - i) * .012 + (N - j) * .004 + nz(i / 55, j / 55, 4) * 8 * amp + nz(i / 13 + 50, j / 13, 2) * 1.2;
    if (rid[k] >= 0) g = carve(g, d, rbed[k], RIVERS[rid[k]]);
    let h = g;
    const base = h;
    const gd = Math.hypot(i - GRAVEL.x, j - GRAVEL.z);
    if (gd < GRAVEL.r) {
      const add = GRAVEL.h * Math.pow(1 - gd / GRAVEL.r, 1.3) + nz(i / 4, j / 4, 2) * .8;
      if (add > .25) { h += add; M[k] = 2; }
    }
    H[k] = h; BED[k] = base - 5;
    TINT[k] = nz(i / 7 + 20, j / 7 + 20, 2) + nz(i * .9, j * .9, 1) * .35;
  }
  // flatten the yard and the camp clearing
  const flatten = (x0, x1, z0, z1, e0) => {
    let s = 0, n = 0;
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) { s += H[j * N + i]; n++; }
    const ym = s / n;
    for (let j = z0 - e0; j <= z1 + e0; j++) for (let i = x0 - e0; i <= x1 + e0; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const k = j * N + i, e = Math.max(x0 - i, i - x1, z0 - j, j - z1, 0);
      let t = clamp(1 - e / e0, 0, 1); t = t * t * (3 - 2 * t);
      H[k] = lerp(H[k], ym, t); BED[k] = Math.min(BED[k], H[k] - 5);
      if (e === 0) { M[k] = 1; D[k] = 1; }
    }
  };
  flatten(YARD.x0, YARD.x1, YARD.z0, YARD.z1, 8);
  flatten(CAMP.x - 9, CAMP.x + 9, CAMP.z - 7, CAMP.z + 7, 7);
  // the marsh: a hollow with a low natural berm round it, so it always holds water until someone digs it out
  { let s = 0; for (let a = 0; a < 64; a++) s += hAt(MARSH.x + Math.cos(a / 64 * 6.283) * (MARSH.r + 4), MARSH.z + Math.sin(a / 64 * 6.283) * (MARSH.r + 4));
    const lvl = s / 64; MARSH_LEVEL.v = lvl;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const md = Math.hypot(i - MARSH.x, j - MARSH.z), k = j * N + i; if (md > MARSH.r + 11) continue;
      if (md < MARSH.r) H[k] = Math.min(H[k], lvl - .25 - 1.6 * (1 - (md / MARSH.r) ** 2) + nz(i / 5, j / 5, 2) * .3);
      else H[k] = Math.max(H[k], lvl + .55 * Math.max(0, 1 - Math.abs(md - MARSH.r - 3) / 8));
      BED[k] = Math.min(BED[k], H[k] - 5);
    } }
  // water in the rivers and the marsh
  for (let k = 0; k < NN; k++) {
    if (rid[k] < 0) continue;
    const r = RIVERS[rid[k]];
    if (RD[k] < r.hw) { const lvl = rbed[k] + r.depth; if (lvl > H[k]) W[k] = lvl - H[k]; }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (Math.hypot(i - MARSH.x, j - MARSH.z) < MARSH.r + 2 && H[k] < MARSH_LEVEL.v - .1) W[k] = MARSH_LEVEL.v - .1 - H[k]; }
  // gravel on the riverbeds, muddy banks just above the water
  for (let k = 0; k < NN; k++) {
    if (rid[k] < 0) continue;
    const r = RIVERS[rid[k]];
    if (RD[k] < r.hw * 1.15) { M[k] = 2; D[k] = 1; } else if (RD[k] < r.hw * 1.7) { M[k] = 1; D[k] = 1; }
  }
  // springs where each river enters the map, and a small one feeding the marsh
  SPRINGS.length = 0;
  const edgeCells = (r, test) => { const c = []; for (let k = 0; k < NN; k++) if (rid[k] === RIVERS.indexOf(r) && RD[k] < r.hw * .8 && test(k % N, (k / N) | 0)) c.push(k); return c; };
  SPRINGS.push({ cells: edgeCells(RIVERS[0], (i) => i === 1), q: RIVERS[0].q, cap: 4.2 });
  SPRINGS.push({ cells: edgeCells(RIVERS[1], (i, j) => j === 1), q: RIVERS[1].q, cap: 3.3 });
  SPRINGS.push({ cells: edgeCells(RIVERS[2], (i, j) => j === N - 2), q: RIVERS[2].q, cap: 3.3 });
  SPRINGS.push({ cells: [cellOf(MARSH.x, MARSH.z)], q: .12, cap: 2.2 });
  makeTrees(nz, rnd);
  makeRocks(sd);
  if (settle) {
    for (let it = 0; it < 140; it++) relaxAll(true);
    H0.set(H);
    if (settle !== 'relax') { waterActive.fill(1); for (let it = 0; it < 360; it++) waterStep(.06); }
  } else H0.set(H);
  eroded = 0;
  tileLoose.fill(0); chunkDirty.fill(1); anyDirty = true; edgeDirty = true;
}

// ---------------------------------------------------------------- dirt sliding (piles find their own slope)
// Each cell gives some of its dirt to a lower neighbour (straight or diagonal) when the slope between them is steeper
// than loose soil can stand. Wet soil gives way sooner. Only the 16 m tiles where something changed are checked.
const SQ2 = Math.SQRT2;
let slumpBudget = 0;
function slide(a, b, mv, gen) {
  mv = Math.min(mv, H[a] - BED[a]);
  if (mv < .003) return false;
  H[a] -= mv; H[b] += mv;
  if (!gen) {
    if (mv > .015) {
      if (M[a] === 0) M[a] = 1;
      D[a] = 1;
      const src = M[a];
      if (M[b] !== src && (M[b] === 0 || mv > .06)) M[b] = src;
      D[b] = 1;
      if (mv > .06) { treeFallAt(a); treeFallAt(b); }
      // a slump you can see: a clod breaks off and rolls down the face (a few per frame at most)
      if (mv > .045 && slumpBudget > 0 && typeof chunks === 'function') {
        slumpBudget--;
        const ax = a % N, az = (a / N) | 0, bx = b % N, bz = (b / N) | 0;
        chunks(ax + .5, H[a] + .15, az + .5, 1, M[a] === 2, (bx - ax) * 1.6, (bz - az) * 1.6, .5);
      }
    }
    dirty(a); dirty(b);
  }
  return true;
}
function pair(a, b, gen, dist) {
  const d = H[a] - H[b];
  const t = ((W[a] > .05 || W[b] > .05) ? .62 : .9) * dist;
  if (d > t) return slide(a, b, (d - t) * (dist > 1 ? .12 : .2), gen);
  if (-d > t) return slide(b, a, (-d - t) * (dist > 1 ? .12 : .2), gen);
  return false;
}
function relaxCell(i, j, gen) {
  const k = j * N + i; let m = false;
  if (i < N - 1 && pair(k, k + 1, gen, 1)) m = true;
  if (j < N - 1 && pair(k, k + N, gen, 1)) m = true;
  if (i < N - 1 && j < N - 1 && pair(k, k + N + 1, gen, SQ2)) m = true;
  if (i > 0 && j < N - 1 && pair(k, k + N - 1, gen, SQ2)) m = true;
  return m;
}
function relaxAll(gen) { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) relaxCell(i, j, gen); }
function relax() {
  for (let t = 0; t < NT * NT; t++) {
    if (!tileLoose[t]) continue;
    const ti = t % NT, tj = (t / NT) | 0;
    let moved = false;
    for (let j = Math.max(0, tj * TILE - 1); j < Math.min(N, tj * TILE + TILE + 1); j++)
      for (let i = Math.max(0, ti * TILE - 1); i < Math.min(N, ti * TILE + TILE + 1); i++) if (relaxCell(i, j, false)) moved = true;
    if (!moved) tileLoose[t] = 0;
  }
}

// ---------------------------------------------------------------- water ("virtual pipes": each cell pushes water to its neighbours)
// Only tiles that hold water, or sit next to a tile that does, are simulated.
const waterActive = new Uint8Array(NT * NT).fill(1);
let waterScan = 0;
function scanWater() {
  const has = new Uint8Array(NT * NT);
  for (let k = 0; k < NN; k++) if (W[k] > 0) has[((k / N / TILE) | 0) * NT + (((k % N) / TILE) | 0)] = 1;
  waterActive.fill(0);
  for (let tj = 0; tj < NT; tj++) for (let ti = 0; ti < NT; ti++) {
    if (!has[tj * NT + ti]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = ti + di, b = tj + dj; if (a >= 0 && b >= 0 && a < NT && b < NT) waterActive[b * NT + a] = 1;
    }
  }
}
const CULVERTS = [];   // {a, b (end cells), inv (pipe bottom), r, area}
const ERODE_V = 1.9, ERODE_K = .02;   // speed (m/s) above which loose dirt washes away, and how fast
let eroded = 0;
function waterStep(dt) {
  const K = dt * 9.81, damp = .996;
  for (let t = 0; t < NT * NT; t++) {
    if (!waterActive[t]) continue;
    const i0 = (t % NT) * TILE, j0 = ((t / NT) | 0) * TILE;
    for (let j = j0; j < j0 + TILE; j++) for (let i = i0; i < i0 + TILE; i++) {
      const k = j * N + i, w = W[k];
      if (w <= 0) { FL[k] = FR[k] = FU[k] = FD[k] = 0; continue; }
      const h = H[k] + w;
      let l = 0, r = 0, u = 0, d = 0;
      if (i > 0) { l = FL[k] * damp + K * (h - H[k - 1] - W[k - 1]); if (l < 0) l = 0; }
      if (i < N - 1) { r = FR[k] * damp + K * (h - H[k + 1] - W[k + 1]); if (r < 0) r = 0; }
      if (j > 0) { u = FU[k] * damp + K * (h - H[k - N] - W[k - N]); if (u < 0) u = 0; }
      if (j < N - 1) { d = FD[k] * damp + K * (h - H[k + N] - W[k + N]); if (d < 0) d = 0; }
      const s = l + r + u + d;
      if (s > 0) { const f = Math.min(1, w / (s * dt)); l *= f; r *= f; u *= f; d *= f; }
      FL[k] = l; FR[k] = r; FU[k] = u; FD[k] = d;
    }
  }
  for (let t = 0; t < NT * NT; t++) {
    if (!waterActive[t]) continue;
    const i0 = (t % NT) * TILE, j0 = ((t / NT) | 0) * TILE;
    for (let j = j0; j < j0 + TILE; j++) for (let i = i0; i < i0 + TILE; i++) {
      const k = j * N + i;
      let inf = 0;
      if (i > 0) inf += FR[k - 1];
      if (i < N - 1) inf += FL[k + 1];
      if (j > 0) inf += FD[k - N];
      if (j < N - 1) inf += FU[k + N];
      let w = W[k] + dt * (inf - FL[k] - FR[k] - FU[k] - FD[k]);
      if (w < .0005) w = 0;
      if (i >= N - 2) w *= Math.max(0, 1 - 4 * dt);   // the river leaves the valley here
      W[k] = w;
      // fast water washes away loose dirt that people have moved (never the untouched ground or gravel) and drops it
      // a cell downstream; where the water slows the silt stays. Overtopped dams and narrow gaps wear away.
      if (w > .04 && M[k] !== 2 && i > 0 && j > 0 && i < N - 1 && j < N - 1 && Math.abs(H[k] - H0[k]) > .05) {
        const ww = Math.max(w, .25);
        const vx = (FR[k] - FL[k] + FR[k - 1] - FL[k + 1]) * .5 / ww, vz = (FD[k] - FU[k] + FD[k - N] - FU[k + N]) * .5 / ww;
        const sp = Math.hypot(vx, vz);
        if (sp > ERODE_V) {
          const n = Math.abs(vx) > Math.abs(vz) ? (vx > 0 ? k + 1 : k - 1) : (vz > 0 ? k + N : k - N);
          const a = Math.min(ERODE_K * (sp - ERODE_V) * dt * (COMP[k] ? .15 : 1), .02, H[k] - BED[k]);
          if (a > 0 && H[n] < H[k] + .25) {
            H[k] -= a; H[n] += a; D[n] = 1; if (M[n] !== 2) M[n] = M[k] || 1;
            dirty(k); dirty(n); eroded += a;
          }
        }
      }
    }
  }
  for (const s of SPRINGS) { const add = s.q * dt / s.cells.length; for (const k of s.cells) if (W[k] < s.cap) W[k] += add; }
  // culvert pipes: water runs from the higher end to the lower, as fast as the head across the pipe drives it
  for (const c of CULVERTS) {
    const la = H[c.a] + W[c.a], lb = H[c.b] + W[c.b], hi = la > lb ? c.a : c.b, lo = hi === c.a ? c.b : c.a, top = Math.max(la, lb);
    if (top < c.inv + .02 || W[hi] < .01) continue;
    const head = Math.abs(la - lb), wet = clamp((top - c.inv) / (2 * c.r), 0, 1);
    const q = Math.min(.6 * c.area * wet * Math.sqrt(2 * 9.81 * head) * dt, W[hi] * .45);
    W[hi] -= q; W[lo] += q;
  }
}

// ---------------------------------------------------------------- trees
const trees = [];
const treeGrid = new Int16Array(NN).fill(-1);
function makeTrees(nz, rnd) {
  trees.length = 0; treeGrid.fill(-1);
  for (let a = 0; a < 20000 && trees.length < 1500; a++) {
    const x = 2 + rnd() * (N - 4), z = 2 + rnd() * (N - 4);
    const k = cellOf(x, z);
    if (RD[k] < 10 || M[k] === 2 || inYard(x, z, 10)) continue;
    if (Math.hypot(x - GRAVEL.x, z - GRAVEL.z) < GRAVEL.r + 3 || Math.hypot(x - CAMP.x, z - CAMP.z) < 14 || Math.hypot(x - MARSH.x, z - MARSH.z) < MARSH.r + 4) continue;
    if (nz(x / 26 + 7, z / 26 + 3, 2) < -.02 && rnd() < .88) continue;
    const i = k % N, j = (k / N) | 0;
    let ok = true;
    for (let dj = -2; dj <= 2 && ok; dj++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < N && jj < N && treeGrid[jj * N + ii] >= 0) { ok = false; break; }
    }
    if (!ok) continue;
    treeGrid[k] = trees.length;
    trees.push({ x, z, k, s: .75 + rnd() * .55, r: rnd() * 6.28, st: 0, a: 0, dx: 1, dz: 0, t: 0, g: 1, y: 0, dirty: true, hue: rnd() });
  }
}
function treeFall(t, fx, fz) {
  if (t.st !== 0) return;
  let dx = t.x - fx, dz = t.z - fz; const l = Math.hypot(dx, dz) || 1;
  if (l < .01) { dx = 1; dz = 0; }
  t.dx = dx / l; t.dz = dz / l; t.st = 1; t.a = 0; t.y = hAt(t.x, t.z) - .1; t.dirty = true;
  treeGrid[t.k] = -1;
  dust(t.x, t.y + .5, t.z, 10, [.45, .4, .3]);
  spawn('leaf', t.x, t.y + 6 * t.s, t.z, 10, [.25, .36, .14], { jitter: 3 });
  snd.treeFall(t.x, t.y + 3, t.z);
}
function treeFallAt(k, fx, fz) {
  const ti = treeGrid[k];
  if (ti >= 0) { const t = trees[ti]; treeFall(t, fx ?? t.x - .3, fz ?? t.z + .2); }
}

// ---------------------------------------------------------------- loads (what a bucket or bed holds)
const newLoad = () => ({ v: 0, g: 0 });
const loadMat = L => (L.v > 0 && L.g / L.v > .5) ? 2 : 1;
const loadName = L => loadMat(L) === 2 ? 'gravel' : 'dirt';
function takeFrom(L, k, amount) {
  if (amount <= 0) return 0;
  const gravel = M[k] === 2;
  const bank = Math.max(0, Math.min(H[k], H0[k]) - (H[k] - amount));   // the part that was never dug before bulks up
  H[k] -= amount; if (M[k] === 0) M[k] = 1; D[k] = 1;
  const loose = amount + bank * (SWELL - 1);
  L.v += loose; if (gravel) L.g += loose;
  dirty(k);
  if (treeGrid[k] >= 0) treeFallAt(k);
  return loose;
}
// dirt dropped into water pushes the water aside (into the neighbouring cells) instead of lifting it up on top
function displace(k, amt) {
  const d = Math.min(W[k], amt); if (d <= 0) return;
  const i = k % N, j = (k / N) | 0, nb = [];
  if (i > 0) nb.push(k - 1); if (i < N - 1) nb.push(k + 1); if (j > 0) nb.push(k - N); if (j < N - 1) nb.push(k + N);
  const s0 = H[k] + W[k] - d, low = nb.filter(n => H[n] + W[n] < s0), to = low.length ? low : nb;
  W[k] -= d; for (const n of to) W[n] += d / to.length;
  FL[k] = FR[k] = FU[k] = FD[k] = 0;
}
// a whole bucket or bed tipped at once lands over most of a second (the pile builds as the dirt pours out)
const pourQ = [];
function updatePour(dt) {
  for (let i = pourQ.length - 1; i >= 0; i--) {
    const q = pourQ[i], a = Math.min(q.rem, q.rate * dt);
    H[q.k] += a; q.rem -= a; displace(q.k, a); dirty(q.k);
    if (q.rem <= 1e-5) { pourQ[i] = pourQ[pourQ.length - 1]; pourQ.pop(); }
  }
}
function giveTo(L, k, amount, defer = 0) {
  amount = Math.min(amount, L.v);
  if (amount <= 0) return 0;
  const g = L.g * (amount / L.v);
  const mat = loadMat(L);
  L.v -= amount; L.g -= g;
  if (L.v < 1e-4) { L.v = 0; L.g = 0; }
  if (defer > 0) pourQ.push({ k, rem: amount, rate: amount / defer });
  else { H[k] += amount; displace(k, amount); }
  if (amount > .05) COMP[k] = 0;
  if (amount > .02 || M[k] === 0) M[k] = mat;
  D[k] = 1;
  dirty(k);
  if (treeGrid[k] >= 0) treeFallAt(k);
  stats.moved += amount;
  return amount;
}
function transfer(src, dst, cap) {
  const amt = Math.min(src.v, cap - dst.v);
  if (amt <= 1e-3) return 0;
  const g = src.g * (amt / src.v);
  src.v -= amt; src.g -= g; dst.v += amt; dst.g += g;
  if (src.v < 1e-4) { src.v = 0; src.g = 0; }
  return amt;
}
function cellsInCircle(x, z, r, fn) {
  const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(N - 1, Math.ceil(x + r));
  const j0 = Math.max(0, Math.floor(z - r)), j1 = Math.min(N - 1, Math.ceil(z + r));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i - x, j - z);
    if (d <= r) fn(j * N + i, d / r);
  }
}
// scoop a bowl out of the ground, at most maxV m³
function cutCircle(L, x, z, r, floorY, maxV) {
  const list = []; let total = 0;
  cellsInCircle(x, z, r, (k, f) => {
    const fl = Math.max(floorY + f * f * 1.0, BED[k]);
    const a = H[k] - fl;
    if (a > 0) { list.push([k, a]); total += a + Math.max(0, Math.min(H[k], H0[k]) - fl) * (SWELL - 1); }
  });
  if (total <= 0) return 0;
  const sc = Math.min(1, maxV / total);
  let got = 0;
  for (const [k, a] of list) got += takeFrom(L, k, a * sc);
  return got;
}
// tip out a load: it lands as a cone (as tall as loose soil stands) and then slumps on its own if it is too steep
function dropCircle(L, x, z, r, vol, defer = 0) {
  vol = Math.min(vol, L.v);
  if (vol <= 0) return 0;
  const list = []; let sw = 0;
  const R = clamp(Math.cbrt(vol * 1.3), .9, r);
  cellsInCircle(x, z, R, (k, f) => { const w = Math.max(.04, 1 - f); list.push([k, w]); sw += w; });
  if (!list.length) { list.push([cellOf(x, z), 1]); sw = 1; }
  let put = 0; const total = vol;
  for (const [k, w] of list) put += giveTo(L, k, total * w / sw, defer);
  return put;
}

// ---------------------------------------------------------------- graphics quality
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
let quality = localStorage.getItem('groundwork.quality');
if (!['high', 'medium', 'low'].includes(quality)) quality = isTouch ? 'medium' : 'high';
const QS = {
  high: { shadow: 4096, shadowR: 75, grass: 22000, grassR: 46, dpr: 2, soft: true, near: 900, far: 3200, detail: 2, detailR: 95, post: true, msaa: 4, aoN: 12 },
  medium: { shadow: 2048, shadowR: 60, grass: 9000, grassR: 32, dpr: 1.5, soft: true, near: 450, far: 1800, detail: 2, detailR: 60, post: true, msaa: 2, aoN: 8 },
  low: { shadow: 1024, shadowR: 45, grass: 0, grassR: 0, dpr: 1, soft: false, near: 160, far: 800, detail: 1, detailR: 0, post: false, msaa: 0, aoN: 0 },
};
const Q = QS[quality];
const T = makeTextures(quality);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let simTime = 0;

// ---------------------------------------------------------------- scene, sky and light
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.post, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch && quality !== 'low' ? 2 : Q.dpr));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .8;
{ const an = Math.min(8, renderer.capabilities.getMaxAnisotropy()); for (const k in T) if (T[k] && T[k].isTexture) T[k].anisotropy = an; }
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xb7c4cf);
scene.fog = new THREE.FogExp2(FOG, .00095);
const camera = new THREE.PerspectiveCamera(55, 1, .1, 12000);
const SUN_DIR = new THREE.Vector3(-.5, .56, .66).normalize();
// the sky: deep blue overhead, paling to haze at the horizon (the same colour the far land fades into), with a warm
// glow around the sun
function makeSky(scale) {
  const fogLin = FOG.clone();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uFog: { value: fogLin } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 uSun, uFog; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.), s = max(dot(d, uSun), 0.);
        vec3 zen = vec3(.07, .2, .56), mid = vec3(.2, .42, .82);
        vec3 col = mix(mid, zen, pow(h, .55));
        col = mix(uFog * 1.12, col, 1. - pow(1. - h, 5.5));
        col += vec3(1., .78, .5) * (pow(s, 6.) * .16 + pow(s, 60.) * .5 + pow(s, 900.) * 6.) * (1. - pow(1. - h, 12.) * .6);
        col += vec3(1., .9, .75) * smoothstep(.99955, .9998, s) * 40.;
        col = mix(uFog, col, smoothstep(-.04, .0, d.y));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m); s.scale.setScalar(scale); s.frustumCulled = false; s.renderOrder = -2;
  return s;
}
const sky = makeSky(10000); sky.position.set(N / 2, 0, N / 2); scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(makeSky(1000));
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2f3a22 }));
  gp.position.y = -2; es.add(gp);
  scene.environment = pm.fromScene(es, .03).texture; pm.dispose();
  // then the real thing: a photographed sky (Poly Haven, CC0) lights and reflects in the paint, glass and steel, over
  // the same dark valley floor
  new RGBELoader().load('assets/sky.hdr', tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm2 = new THREE.PMREMGenerator(renderer), es2 = new THREE.Scene();
    es2.background = tex; es2.backgroundIntensity = .55;
    es2.add(gp);
    const old = scene.environment;
    scene.environment = pm2.fromScene(es2, .02).texture; pm2.dispose(); tex.dispose(); old.dispose();
  }, undefined, () => {});
}
T.clouds.repeat.set(3, 3);
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: T.clouds, transparent: true, opacity: .75, depthWrite: false, fog: false, color: new THREE.Color(1.5, 1.5, 1.5) }));
clouds.position.set(N / 2, 1100, N / 2); clouds.renderOrder = -1; scene.add(clouds);
const hemi = new THREE.HemisphereLight(0xbdd4ff, 0x6b5a45, 1.2);
const sun = new THREE.DirectionalLight(0xffe8c6, 5.0);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(sun.shadow.camera, { left: -Q.shadowR, right: Q.shadowR, top: Q.shadowR, bottom: -Q.shadowR, near: 1, far: 500 });
sun.shadow.bias = -.0003; sun.shadow.normalBias = .04;
// the shadow box follows the machine in whole shadow-map pixels, so shadows don't shimmer as it drives
const SUN_R = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize(), SUN_U = new THREE.Vector3().crossVectors(SUN_DIR, SUN_R).normalize();
const _sf = new THREE.Vector3();
function aimSun(x, y, z) {
  const px = Q.shadowR * 2 / Q.shadow;
  _sf.set(x, y, z);
  const a = Math.round(_sf.dot(SUN_R) / px) * px, b = Math.round(_sf.dot(SUN_U) / px) * px, c = _sf.dot(SUN_DIR);
  _sf.set(0, 0, 0).addScaledVector(SUN_R, a).addScaledVector(SUN_U, b).addScaledVector(SUN_DIR, c);
  sun.target.position.copy(_sf);
  sun.position.copy(_sf).addScaledVector(SUN_DIR, 150);
}
scene.add(hemi, sun, sun.target);

// ---------------------------------------------------------------- finishing pass (High and Medium): the picture is drawn into a
// buffer first, then shaded where things meet (under machines, in track wells, at the foot of trees and banks) from the
// depth of what was drawn, with a soft glow off bright metal and water, a little lens darkening at the corners and film
// grain. Low draws straight to the screen.
const POST = Q.post && (quality === 'high' || !isTouch) && renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')) ? (() => {
  const depthTex = new THREE.DepthTexture(4, 4); depthTex.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(4, 4, { samples: Q.msaa, type: THREE.HalfFloatType, depthTexture: depthTex, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const half = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const aoRT = new THREE.WebGLRenderTarget(4, 4, half);
  const glowA = new THREE.WebGLRenderTarget(4, 4, { ...half, type: THREE.HalfFloatType }), glowB = new THREE.WebGLRenderTarget(4, 4, { ...half, type: THREE.HalfFloatType });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const pass = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, uniforms,
    vertexShader: 'in vec3 position; out vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'precision highp float; precision highp sampler2D; in vec2 vUv; out vec4 outColor;\n' + fs });
  const aoMat = pass(`
    uniform sampler2D tDepth; uniform vec2 uPx; uniform vec4 uProj; uniform vec2 uNF;
    float viewZ(vec2 uv) { float d = texture(tDepth, uv).x; return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }   // distance in front of the camera
    vec3 viewPos(vec2 uv) { float z = viewZ(uv); return vec3((uv * 2. - 1.) * uProj.xy * z, -z); }
    void main() {
      float d0 = texture(tDepth, vUv).x;
      if (d0 >= .99999) { outColor = vec4(1.); return; }
      vec3 P = viewPos(vUv);
      // the surface's facing from its neighbours (taking the nearer-in-depth pair on each axis, so edges don't smear)
      vec3 pl = viewPos(vUv - vec2(uPx.x, 0.)), pr = viewPos(vUv + vec2(uPx.x, 0.)), pd = viewPos(vUv - vec2(0., uPx.y)), pu = viewPos(vUv + vec2(0., uPx.y));
      vec3 dx = abs(pl.z - P.z) < abs(pr.z - P.z) ? P - pl : pr - P, dy = abs(pd.z - P.z) < abs(pu.z - P.z) ? P - pd : pu - P;
      vec3 Nn = normalize(cross(dx, dy));
      float R = clamp(-P.z * .09, .35, 1.6);                // how far around (metres) counts as "nearby"
      float rPx = R / (-P.z * uProj.x) * .5;                // that radius on screen (fraction of the width)
      float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) * 6.2831853;
      float occ = 0.;
      const int NS = ${Q.aoN};
      for (int i = 0; i < NS; i++) {
        float f = (float(i) + .5) / float(NS), a = ang + float(i) * 2.399963;
        vec2 o = vec2(cos(a), sin(a)) * sqrt(f) * rPx; o.y *= uProj.x / uProj.y;
        vec3 v = viewPos(vUv + o) - P;
        float l2 = dot(v, v) + 1e-4;
        occ += max(0., dot(v, Nn) - .03 - .012 * -P.z) / l2 * max(0., 1. - l2 / (R * R)) * R;
      }
      float ao = clamp(1. - occ * 3.4 / float(NS), 0., 1.);
      ao = mix(ao, 1., smoothstep(60., 140., -P.z));
      outColor = vec4(ao, -P.z * .01, 0., 1.);
    }`, { tDepth: { value: depthTex }, uPx: { value: new THREE.Vector2() }, uProj: { value: new THREE.Vector4() }, uNF: { value: new THREE.Vector2() } });
  const brightMat = pass(`
    uniform sampler2D tCol; uniform vec2 uPx;
    void main() {
      vec3 c = vec3(0.);
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) c += min(texture(tCol, vUv + (vec2(float(i), float(j)) - .5) * uPx * 2.).rgb, vec3(40.));
      c *= .25; float l = max(c.r, max(c.g, c.b));
      outColor = vec4(c * smoothstep(1.6, 5., l), 1.);
    }`, { tCol: { value: rt.texture }, uPx: { value: new THREE.Vector2() } });
  const blurMat = pass(`
    uniform sampler2D tCol; uniform vec2 uDir;
    void main() {
      vec3 c = texture(tCol, vUv).rgb * .227;
      c += (texture(tCol, vUv + uDir * 1.385).rgb + texture(tCol, vUv - uDir * 1.385).rgb) * .316;
      c += (texture(tCol, vUv + uDir * 3.231).rgb + texture(tCol, vUv - uDir * 3.231).rgb) * .07;
      outColor = vec4(c, 1.);
    }`, { tCol: { value: null }, uDir: { value: new THREE.Vector2() } });
  const outMat = pass(`
    uniform sampler2D tCol, tAO, tGlow; uniform vec2 uPx; uniform float uExp, uTime, uDbg;
    const int AOB = ${quality === 'high' ? 2 : 1};
    vec3 aces(vec3 x) {   // the same film curve the renderer uses on Low
      const mat3 A = mat3(.59719, .076, .0284, .35458, .90834, .13383, .04823, .01566, .83777);
      const mat3 B = mat3(1.60475, -.10208, -.00327, -.53108, 1.10813, -.07276, -.07367, -.00605, 1.07602);
      x = A * (x * uExp / .6); x = (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .432951) + .238081); return clamp(B * x, 0., 1.);
    }
    void main() {
      vec3 c = texture(tCol, vUv).rgb;
      // soften the shading, without letting it leak across edges
      vec2 a0 = texture(tAO, vUv).xy; float ao = 0., wsum = 0.;
      for (int j = -AOB; j <= AOB; j++) for (int i = -AOB; i <= AOB; i++) {
        vec2 s = texture(tAO, vUv + vec2(float(i), float(j)) * uPx * 2.).xy;
        float w = 1. / (1. + abs(s.y - a0.y) * 4000. / (1. + a0.y * 100.));
        ao += s.x * w; wsum += w;
      }
      ao /= wsum;
      float lum = dot(c, vec3(.2126, .7152, .0722));
      c *= mix(vec3(1.), vec3(ao * ao, ao * ao * 1.02, ao * ao * 1.06), 1. - smoothstep(1.2, 4., lum) * .6);
      c += texture(tGlow, vUv).rgb * .35;
      vec2 q = vUv - .5; c *= 1. - dot(q, q) * .55;
      c = aces(c);
      c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, 1.06);
      c = pow(c, vec3(1. / 2.2));
      float n = fract(sin(dot(gl_FragCoord.xy + uTime * 61., vec2(12.9898, 78.233))) * 43758.5453);
      if (uDbg > .5) c = vec3(ao);
      outColor = vec4(c + (n - .5) * .018, 1.);
    }`, { tCol: { value: rt.texture }, tAO: { value: aoRT.texture }, tGlow: { value: glowA.texture }, uPx: { value: new THREE.Vector2() }, uExp: { value: 1 }, uTime: { value: 0 }, uDbg: { value: 0 } });
  const quad = new THREE.Mesh(tri, aoMat); quad.frustumCulled = false;
  const pcam = new THREE.Camera(), size = new THREE.Vector2();
  const draw = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, pcam); };
  return {
    debug(v) { outMat.uniforms.uDbg.value = v ? 1 : 0; },
    render() {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(2, size.x), h = Math.max(2, size.y), hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
      if (rt.width !== w || rt.height !== h) { rt.setSize(w, h); aoRT.setSize(hw, hh); glowA.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1)); glowB.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1)); }
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      const pe = camera.projectionMatrix.elements;
      aoMat.uniforms.uPx.value.set(1 / hw, 1 / hh); aoMat.uniforms.uProj.value.set(1 / pe[0], 1 / pe[5], 0, 0); aoMat.uniforms.uNF.value.set(camera.near, camera.far);
      draw(aoMat, aoRT);
      brightMat.uniforms.uPx.value.set(1 / w, 1 / h); draw(brightMat, glowA);
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tCol.value = glowA.texture; blurMat.uniforms.uDir.value.set((1 + i) / glowA.width, 0); draw(blurMat, glowB);
        blurMat.uniforms.tCol.value = glowB.texture; blurMat.uniforms.uDir.value.set(0, (1 + i) / glowA.height); draw(blurMat, glowA);
      }
      outMat.uniforms.uPx.value.set(1 / w, 1 / h); outMat.uniforms.uExp.value = renderer.toneMappingExposure; outMat.uniforms.uTime.value = simTime % 10;
      draw(outMat, null);
    },
  };
})() : null;
function drawFrame() {
  renderer.getDrawingBufferSize(_bs);
  pMat.uniforms.uScale.value = _bs.y * .5 * camera.projectionMatrix.elements[5];
  if (POST) POST.render(); else renderer.render(scene, camera);
}

// ---------------------------------------------------------------- the ground (textured: grass, dirt, gravel; wet where water is)
function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, metalness: 0, vertexColors: true });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tGrass: { value: T.grass }, tDirt: { value: T.dirt }, tGravel: { value: T.gravel }, tHgt: { value: T.heights }, tMacro: { value: T.macro } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nattribute vec2 aDig;\nvarying vec4 vMat;\nvarying vec2 vDig;\nvarying vec3 vTWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMat = aMat;\nvDig = aDig;\nvTWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tDirt, tGravel, tHgt, tMacro; varying vec4 vMat; varying vec2 vDig; varying vec3 vTWP;
        vec3 gwPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
          vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }`)
      .replace('#include <map_fragment>', `
        vec2 gp1 = vTWP.xz * .25, gp2 = vTWP.zx * .071 + .37;
        float gmac = texture2D(tMacro, vTWP.xz * .011).r * .6 + texture2D(tMacro, vTWP.xz * .053).r * .4;
        vec3 gh = texture2D(tHgt, gp1).rgb;
        vec3 gw = max(vMat.xyz, 0.) + 1e-4; gw = gw * (.35 + gh * 1.3); gw = gw * gw * gw; gw /= (gw.x + gw.y + gw.z);
        vec3 cG = mix(texture2D(tGrass, gp1).rgb, texture2D(tGrass, gp2).rgb, .4);
        cG *= vec3(.92, 1.06, .78);   // the photo is a late-summer lawn: a touch greener for a valley meadow
        // meadow patches: sun-dried yellow in places, deeper green in others
        { float gdry = texture2D(tMacro, vTWP.zx * .027 + .31).r, glush = texture2D(tMacro, vTWP.xz * .019 + .73).r;
          cG = mix(cG, cG * vec3(1.42, 1.2, .72), smoothstep(.5, .78, gdry) * .75);
          cG = mix(cG, cG * vec3(.72, .9, .7), smoothstep(.52, .8, glush) * .7); }
        vec3 cD = mix(texture2D(tDirt, gp1).rgb, texture2D(tDirt, gp2).rgb, .35);
        // fine grit and small stones up close
        { vec3 gfine = texture2D(tHgt, vTWP.xz * 1.13 + .17).rgb;
          cD *= .78 + gfine.g * .5; cD = mix(cD, vec3(.5, .47, .43), smoothstep(.82, .94, gfine.b) * .18); }
        // soil layers where the ground has been cut: dark topsoil, brown subsoil, then orange clay with a pale streak;
        // freshly dumped spoil is looser and lighter
        { float dB = vDig.x - vTWP.y + (gmac - .5) * .45 + (gh.r - .5) * .12;
          vec3 lay = mix(vec3(.82, .76, .72), vec3(1.0), smoothstep(-.05, .12, dB));
          lay = mix(lay, vec3(1.2, 1.0, .78), smoothstep(.18, .42, dB));
          lay = mix(lay, vec3(1.55, 1.07, .66), smoothstep(.75, 1.15, dB));
          lay = mix(lay, vec3(1.5, 1.3, 1.0), smoothstep(.3, .0, abs(dB - 1.6)) * .45);
          lay = mix(lay, vec3(1.25, .95, .7), smoothstep(2.6, 3.2, dB));
          float spoil = clamp(vDig.y / .5, 0., 1.);
          lay = mix(lay, vec3(1.1, 1.0, .9) * (.9 + gh.g * .25), spoil * smoothstep(-.1, -.3, dB));
          cD *= lay; }
        vec3 cR = mix(texture2D(tGravel, gp1 * 1.5).rgb, texture2D(tGravel, gp2 * 1.5).rgb, .3);
        vec3 gcol = cG * gw.x + cD * gw.y + cR * gw.z;
        gcol *= mix(.78, 1.15, gmac);
        float gwet = clamp(vMat.w, 0., 1.);
        gcol *= mix(1., .55, gwet);
        diffuseColor.rgb *= gcol;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .3, gwet * .85);\nroughnessFactor = mix(roughnessFactor, .82, clamp((vDig.x - vTWP.y - .2) * 2., 0., 1.) * gw.y * (1. - gwet));')
      .replace('#include <normal_fragment_maps>', `
        { vec2 gdx = dFdx(gp1), gdy = dFdy(gp1);
          float h0 = dot(texture2D(tHgt, gp1).rgb, gw), hx = dot(texture2D(tHgt, gp1 + gdx).rgb, gw), hy = dot(texture2D(tHgt, gp1 + gdy).rgb, gw);
          normal = gwPerturb(-vViewPosition, normal, vec2(hx - h0, hy - h0) * 1.6 * (1. - gwet * .7), faceDirection); }`);
  };
  m.customProgramCacheKey = () => 'gw-terrain';
  return m;
}
// ---------------------------------------------------------------- water (ripples that follow the current, reflections, foam)
function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, tN: { value: null }, uSun: { value: SUN_DIR.clone() }, uSunCol: { value: new THREE.Color(1, .92, .8) },
      uSky: { value: new THREE.Color(.13, .3, .68) }, uHor: { value: FOG.clone().multiplyScalar(1.05) },
      uDeep: { value: new THREE.Color(.008, .045, .05) }, uShallow: { value: new THREE.Color(.1, .17, .12) },
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aW; attribute vec2 aFlow;
      varying float vW; varying vec2 vFlow; varying vec3 vWP;
      void main() {
        vW = aW; vFlow = aFlow;
        vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform sampler2D tN; uniform vec3 uSun, uSunCol, uSky, uHor, uDeep, uShallow;
      varying float vW; varying vec2 vFlow; varying vec3 vWP;
      void main() {
        if (vW < 0.008) discard;
        vec2 fl = vFlow, uv = vWP.xz * .16;
        float speed = length(fl), dist = length(cameraPosition - vWP), calm = 1. / (1. + dist * .018);
        float ph = fract(uTime * .12), w1 = abs(ph - .5) * 2.;
        vec4 a1 = texture2D(tN, uv - fl * ph * .9 + vec2(uTime * .006, 0.));
        vec4 a2 = texture2D(tN, uv - fl * fract(ph + .5) * .9 + vec2(.37, .21));
        vec4 b1 = texture2D(tN, uv * 2.3 + vec2(-uTime * .011, uTime * .014));
        vec4 b2 = texture2D(tN, uv * 5.1 - fl * uTime * .12 + vec2(uTime * .02, -uTime * .017));
        vec3 n1 = mix(a1.xyz, a2.xyz, w1) * 2. - 1., n2 = b1.xyz * 2. - 1., n3 = b2.xyz * 2. - 1.;
        // still water is nearly a mirror; the faster it runs the more it is broken up (and less so far away, where
        // fine ripples would only sparkle)
        float chop = (.16 + min(speed, 2.5) * .5) * mix(.3, 1., calm);
        vec3 nt = normalize(vec3((n1.xy * .9 + n2.xy * .5 + n3.xy * .35 * calm) * chop, 1.));
        vec3 N = normalize(vec3(nt.x, nt.z, nt.y));
        vec3 V = normalize(cameraPosition - vWP);
        float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        // what it mirrors: sky overhead, haze lower down, and the dark line of the forest along the banks
        vec3 skyc = mix(uHor, uSky, clamp(R.y * 1.7, 0., 1.));
        skyc = mix(vec3(.018, .04, .022), skyc, smoothstep(.04, .3, R.y + (n2.x + n1.y) * .05));
        float sd = max(dot(R, uSun), 0.);
        float spec = pow(sd, 420.) * 14. + pow(sd, 48.) * .3;
        // depth: the bed shows through the shallows, then green, then near-black water
        float depthF = 1. - exp(-vW * 1.5);
        vec3 body = mix(uShallow, uDeep, depthF) * (.7 + .3 * max(dot(N, uSun), 0.));
        body = mix(body, uDeep * .45, smoothstep(.9, 2.4, vW));
        vec3 col = mix(body, skyc, fres) + uSunCol * spec;
        // foam: a line along the edge, streaks where the current is fast, white water where it is fast and shallow
        float fn = mix(a1.a, a2.a, w1) * .6 + texture2D(tN, uv * 3.7 - fl * uTime * .3).a * .4;
        float rush = smoothstep(.7, 2.2, speed), rapid = rush * smoothstep(.7, .12, vW);
        float foam = smoothstep(.6 - rapid * .25, .86 - rapid * .2, fn) * (smoothstep(.16, .0, vW) * .85 + rush * .45 + rapid * .5);
        foam = clamp(foam, 0., 1.);
        col = mix(col, vec3(.86, .89, .87) * (.75 + .25 * max(dot(N, uSun), 0.)), foam * .8);
        float alpha = clamp(.3 + depthF * .66 + fres * .45 + foam * .5, 0., .98) * smoothstep(.008, .07, vW);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
const terrainMat = terrainMaterial();
const waterMat = waterMaterial(); waterMat.uniforms.tN.value = T.water;

// ---------------------------------------------------------------- how each cell looks (material mix, wetness, shading in hollows)
const cMat = new Float32Array(NN * 4), cAO = new Float32Array(NN).fill(1);
function cellLook(i0, i1, j0, j1) {
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(N - 1, i1); j1 = Math.min(N - 1, j1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * N + i, h = H[k];
    const hl = H[i > 0 ? k - 1 : k], hr = H[i < N - 1 ? k + 1 : k], hd = H[j > 0 ? k - N : k], hu = H[j < N - 1 ? k + N : k];
    const lap = (hl + hr + hd + hu) * .25 - h;
    const h2 = (H[i > 1 ? k - 2 : k] + H[i < N - 2 ? k + 2 : k] + H[j > 1 ? k - 2 * N : k] + H[j < N - 2 ? k + 2 * N : k]) * .25 - h;
    cAO[k] = clamp(1 - Math.max(0, lap) * .4 - Math.max(0, h2) * .15 + Math.max(0, -lap) * .05, .52, 1.05);
    let g = 0, d = 0, r = 0;
    if (M[k] === 2) r = 1; else if (M[k] === 1 || D[k]) d = 1; else g = 1;
    const sl = Math.abs(hl - hr) + Math.abs(hd - hu);
    if (g && sl > 1.1) { const f = clamp((sl - 1.1) / 1.2, 0, .85); g -= f; d += f; }
    const w = W[k];
    if (w > .05 && M[k] === 0 && !D[k]) { g = 0; d = .7; r = .3; }
    let wet = 0;
    if (w > .02) wet = clamp(.6 + w * .3, 0, 1);
    else if ((i > 0 && W[k - 1] > .02) || (i < N - 1 && W[k + 1] > .02) || (j > 0 && W[k - N] > .02) || (j < N - 1 && W[k + N] > .02)) wet = .5;
    else if ((i > 1 && W[k - 2] > .02) || (i < N - 2 && W[k + 2] > .02) || (j > 1 && W[k - 2 * N] > .02) || (j < N - 2 && W[k + 2 * N] > .02)
      || (i > 0 && j > 0 && W[k - N - 1] > .02) || (i < N - 1 && j > 0 && W[k - N + 1] > .02) || (i > 0 && j < N - 1 && W[k + N - 1] > .02) || (i < N - 1 && j < N - 1 && W[k + N + 1] > .02)) wet = .26;
    cMat[k * 4] = g; cMat[k * 4 + 1] = d; cMat[k * 4 + 2] = r; cMat[k * 4 + 3] = wet;
  }
}
const hc = (i, j) => H[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
const cr = (p0, p1, p2, p3, t) => .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
// the ground drawn as a smooth surface through the cell heights (so dug holes and piles come out rounded)
function hSmooth(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  if (fx === 0 && fz === 0) return hc(i, j);
  const row = q => fx === 0 ? hc(i, j + q) : cr(hc(i - 1, j + q), hc(i, j + q), hc(i + 1, j + q), hc(i + 2, j + q), fx);
  if (fz === 0) return row(0);
  return cr(row(-1), row(0), row(1), row(2), fz);
}
const ih = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - .5; };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = ih(i, j), b = ih(i + 1, j), c = ih(i, j + 1), d = ih(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const _mb = new Float32Array(4);
function matAt(x, z) {
  const i = clamp(Math.floor(x), 0, N - 2), j = clamp(Math.floor(z), 0, N - 2), fx = clamp(x - i, 0, 1), fz = clamp(z - j, 0, 1);
  const k = j * N + i;
  for (let c = 0; c < 4; c++) {
    const a = cMat[k * 4 + c], b = cMat[(k + 1) * 4 + c], d = cMat[(k + N) * 4 + c], e = cMat[(k + N + 1) * 4 + c];
    _mb[c] = a + (b - a) * fx + (d - a) * fz + (a - b - d + e) * fx * fz;
  }
  return _mb;
}
function aoAt(x, z) {
  const i = clamp(Math.floor(x), 0, N - 2), j = clamp(Math.floor(z), 0, N - 2), fx = clamp(x - i, 0, 1), fz = clamp(z - j, 0, 1), k = j * N + i;
  const a = cAO[k], b = cAO[k + 1], d = cAO[k + N], e = cAO[k + N + 1];
  return a + (b - a) * fx + (d - a) * fz + (a - b - d + e) * fx * fz;
}
function bil(A, x, z) {
  const i = clamp(Math.floor(x), 0, N - 2), j = clamp(Math.floor(z), 0, N - 2), fx = clamp(x - i, 0, 1), fz = clamp(z - j, 0, 1), k = j * N + i;
  const a = A[k], b = A[k + 1], c = A[k + N], d = A[k + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
// lumps and clods on bare soil and gravel (bigger clods in freshly dumped spoil); grass stays smooth
function lump(x, z, md, mr, spoil) {
  if (md + mr < .02) return 0;
  const n = vnoise(x * 1.7, z * 1.7) * .65 + vnoise(x * 4.3 + 7.1, z * 4.3 - 2.3) * .35;
  const c = spoil > 0 ? Math.max(0, vnoise(x * 3.1 - 4.7, z * 3.1 + 1.9)) * spoil * .22 : 0;
  return n * (md * .1 + mr * .13) + c * md;
}
function hDraw(x, z, F) {
  const m = matAt(x, z), spoil = F === 1 ? 0 : clamp((bil(H, x, z) - bil(H0, x, z)) / .5, 0, 1);
  return (F === 1 ? hc(Math.round(x), Math.round(z)) : hSmooth(x, z)) + lump(x, z, m[1], m[2] * (1 - m[3] * .5), spoil);
}

// ---------------------------------------------------------------- terrain chunks: near the camera they are drawn at half a metre
const tchunks = [];
for (let cj = 0; cj < NCH; cj++) for (let ci = 0; ci < NCH; ci++) {
  const c = { ci, cj, i0: ci * CH, j0: cj * CH, i1: Math.min(ci * CH + CH, N - 1), j1: Math.min(cj * CH + CH, N - 1), lod: 0, mesh: null, wmesh: null, wet: false };
  tchunks.push(c);
}
function chunkGeo(c, F) {
  const nx = (c.i1 - c.i0) * F + 1, nz = (c.j1 - c.j0) * F + 1, ng = nx * nz;
  const border = [];
  for (let a = 0; a < nx; a++) border.push(a);
  for (let b = 1; b < nz; b++) border.push(b * nx + nx - 1);
  for (let a = nx - 2; a >= 0; a--) border.push((nz - 1) * nx + a);
  for (let b = nz - 2; b >= 0; b--) border.push(b * nx);
  const nv = ng + border.length;
  const idx = [];
  for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) { const p = b * nx + a, q = p + 1, r = p + nx, s = r + 1; idx.push(p, r, q, q, r, s); }
  for (let e = 0; e < border.length; e++) {   // skirts hide the gaps where a detailed chunk meets a plain one
    const a = border[e], b = border[(e + 1) % border.length], sa = ng + e, sb = ng + (e + 1) % border.length;
    idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
  g.setAttribute('aDig', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
  g.userData = { nx, nz, ng, border, F };
  return g;
}
function fillChunk(c) {
  const g = c.mesh.geometry, { nx, nz, ng, border, F } = g.userData;
  const P = g.attributes.position.array, Nr = g.attributes.normal.array, C = g.attributes.color.array, A = g.attributes.aMat.array, DG = g.attributes.aDig.array;
  const ex = nx + 2, hh = new Float32Array(ex * (nz + 2)), st = 1 / F;
  for (let b = -1; b <= nz; b++) for (let a = -1; a <= nx; a++) hh[(b + 1) * ex + a + 1] = hDraw(c.i0 + a * st, c.j0 + b * st, F);
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const v = b * nx + a, x = c.i0 + a * st, z = c.j0 + b * st, h = hh[(b + 1) * ex + a + 1];
    P[v * 3] = x; P[v * 3 + 1] = h; P[v * 3 + 2] = z;
    const dx = (hh[(b + 1) * ex + a] - hh[(b + 1) * ex + a + 2]) / (2 * st), dz = (hh[b * ex + a + 1] - hh[(b + 2) * ex + a + 1]) / (2 * st);
    const l = Math.hypot(dx, 1, dz); Nr[v * 3] = dx / l; Nr[v * 3 + 1] = 1 / l; Nr[v * 3 + 2] = dz / l;
    const ao = aoAt(x, z); C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = ao;
    const m = matAt(x, z); A[v * 4] = m[0]; A[v * 4 + 1] = m[1]; A[v * 4 + 2] = m[2]; A[v * 4 + 3] = m[3];
    const h0 = bil(H0, x, z); DG[v * 2] = h0; DG[v * 2 + 1] = Math.max(0, bil(H, x, z) - h0);
  }
  border.forEach((v, e) => {
    const s = ng + e;
    P[s * 3] = P[v * 3]; P[s * 3 + 1] = P[v * 3 + 1] - 1.2; P[s * 3 + 2] = P[v * 3 + 2];
    Nr[s * 3] = Nr[v * 3]; Nr[s * 3 + 1] = Nr[v * 3 + 1]; Nr[s * 3 + 2] = Nr[v * 3 + 2];
    C[s * 3] = C[s * 3 + 1] = C[s * 3 + 2] = C[v * 3] * .8;
    for (let q = 0; q < 4; q++) A[s * 4 + q] = A[v * 4 + q];
    DG[s * 2] = DG[v * 2]; DG[s * 2 + 1] = DG[v * 2 + 1];
  });
  for (const a of ['position', 'normal', 'color', 'aMat', 'aDig']) g.attributes[a].needsUpdate = true;
  g.computeBoundingSphere();
}
function chunkWaterGeo(c) {
  const nx = c.i1 - c.i0 + 1, nz = c.j1 - c.j0 + 1, idx = [];
  for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) { const p = b * nx + a, q = p + 1, r = p + nx, s = r + 1; idx.push(p, r, q, q, r, s); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(nx * nz), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(nx * nz * 2), 2).setUsage(THREE.DynamicDrawUsage));
  g.userData = { nx, nz };
  return g;
}
function fillWater(c) {
  const g = c.wmesh.geometry, { nx, nz } = g.userData;
  const P = g.attributes.position.array, Dp = g.attributes.aW.array, Fl = g.attributes.aFlow.array;
  let wet = false;
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const v = b * nx + a, i = c.i0 + a, j = c.j0 + b, k = j * N + i, w = W[k];
    P[v * 3] = i; P[v * 3 + 2] = j;
    if (w > .012) {
      wet = true;
      P[v * 3 + 1] = H[k] + w; Dp[v] = w;
      let vx = (FR[k] - FL[k] + (i > 0 ? FR[k - 1] : 0) - (i < N - 1 ? FL[k + 1] : 0)) * .5;
      let vz = (FD[k] - FU[k] + (j > 0 ? FD[k - N] : 0) - (j < N - 1 ? FU[k + N] : 0)) * .5;
      const dd = Math.max(w, .08); vx /= dd; vz /= dd;
      const sp = Math.hypot(vx, vz); if (sp > 2.5) { vx *= 2.5 / sp; vz *= 2.5 / sp; }
      Fl[v * 2] = vx; Fl[v * 2 + 1] = vz;
    } else {
      let lvl = -1e9;
      if (i > 0 && W[k - 1] > .012) lvl = Math.max(lvl, H[k - 1] + W[k - 1]);
      if (i < N - 1 && W[k + 1] > .012) lvl = Math.max(lvl, H[k + 1] + W[k + 1]);
      if (j > 0 && W[k - N] > .012) lvl = Math.max(lvl, H[k - N] + W[k - N]);
      if (j < N - 1 && W[k + N] > .012) lvl = Math.max(lvl, H[k + N] + W[k + N]);
      if (lvl > -1e8) { P[v * 3 + 1] = lvl; Dp[v] = Math.max(-2, lvl - H[k]); } else { P[v * 3 + 1] = H[k] - .3; Dp[v] = -1; }
      Fl[v * 2] = Fl[v * 2 + 1] = 0;
    }
  }
  c.wet = wet; c.wmesh.visible = wet;
  if (wet) { g.attributes.position.needsUpdate = true; g.attributes.aW.needsUpdate = true; g.attributes.aFlow.needsUpdate = true; }
}
const chunkTiles = c => { const t = []; for (let tj = Math.floor(c.j0 / TILE); tj <= Math.min(NT - 1, Math.floor(c.j1 / TILE)); tj++) for (let ti = Math.floor(c.i0 / TILE); ti <= Math.min(NT - 1, Math.floor(c.i1 / TILE)); ti++) t.push(tj * NT + ti); return t; };
for (const c of tchunks) c.tiles = chunkTiles(c);
let wetRecolor = 0;
const _cv = new THREE.Vector3();
// rebuild what changed (nearest first, a few chunks a frame) and refresh the water
function updateTerrainChunks(dt, focus, all = false) {
  wetRecolor -= dt;
  if (wetRecolor <= 0) { wetRecolor = 3; for (const c of tchunks) if (c.wet) chunkDirty[c.cj * NCH + c.ci] = 1; }
  const todo = [];
  for (const c of tchunks) {
    const cx = (c.i0 + c.i1) / 2, cz = (c.j0 + c.j1) / 2, d = Math.hypot(cx - focus.x, cz - focus.z);
    const lod = Q.detail > 1 && d < Q.detailR ? 2 : 1;
    if (lod !== c.lod || chunkDirty[c.cj * NCH + c.ci]) todo.push([d, c, lod]);
  }
  todo.sort((a, b) => a[0] - b[0]);
  let budget = all ? 1e9 : 3.5;
  for (const [, c, lod] of todo) {
    if (budget <= 0) break;
    budget -= lod === 2 ? 1 : .35;
    cellLook(c.i0 - 2, c.i1 + 2, c.j0 - 2, c.j1 + 2);
    if (lod !== c.lod || !c.mesh) {
      if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      c.mesh = new THREE.Mesh(chunkGeo(c, lod), terrainMat);
      c.mesh.castShadow = true; c.mesh.receiveShadow = true;
      scene.add(c.mesh); c.lod = lod;
    }
    fillChunk(c);
    chunkDirty[c.cj * NCH + c.ci] = 0;
  }
  for (const c of tchunks) {
    if (!c.wmesh) { c.wmesh = new THREE.Mesh(chunkWaterGeo(c), waterMat); c.wmesh.renderOrder = 2; c.wmesh.frustumCulled = false; scene.add(c.wmesh); fillWater(c); continue; }
    // near water is refreshed every frame, far water a few times a second (it barely moves at that distance)
    if (!all) { const d = Math.hypot((c.i0 + c.i1) / 2 - camera.position.x, (c.j0 + c.j1) / 2 - camera.position.z); c.wT = (c.wT || 0) - dt; if (c.wT > 0) continue; c.wT = d < 60 ? 0 : d < 130 ? .25 : .6; }
    if (all || c.tiles.some(t => waterActive[t])) fillWater(c);
    else if (c.wet) { c.wet = false; c.wmesh.visible = false; }
  }
}
let grassDirty = true;

// ---------------------------------------------------------------- the land beyond the work site (out to the horizon)
const EDGE = [];
for (let i = 0; i < N; i++) EDGE.push(i);
for (let j = 0; j < N; j++) EDGE.push(j * N + N - 1);
for (let i = N - 1; i >= 0; i--) EDGE.push((N - 1) * N + i);
for (let j = N - 1; j >= 0; j--) EDGE.push(j * N);
const RING_R = [0, 1.5, 4, 8, 14, 24, 40, 65, 100, 160, 250, 400, 650, 1000, 1600, 2400, 3400, 4600];
const RN = RING_R.length, RP = EDGE.length;
const RDIR = EDGE.map(k => { const dx = k % N - (N - 1) / 2, dz = ((k / N) | 0) - (N - 1) / 2, l = Math.hypot(dx, dz); return [dx / l, dz / l]; });
const rPos = new Float32Array(RP * RN * 3), rAO = new Float32Array(RP * RN * 3).fill(1), rMat = new Float32Array(RP * RN * 4);
const rwPos = new Float32Array(RP * RN * 3), rwDep = new Float32Array(RP * RN), rwFlow = new Float32Array(RP * RN * 2);
const rIdx = [];
for (let e = 0; e < RP - 1; e++) for (let r = 0; r < RN - 1; r++) { const a = e * RN + r, b = a + 1, c = a + RN, d = c + 1; rIdx.push(a, c, b, c, d, b); }
const rGeo = new THREE.BufferGeometry(), rwGeo = new THREE.BufferGeometry();
rGeo.setIndex(rIdx); rwGeo.setIndex(rIdx);
const rDig = new Float32Array(RP * RN * 2);
rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3)); rGeo.setAttribute('color', new THREE.BufferAttribute(rAO, 3)); rGeo.setAttribute('aMat', new THREE.BufferAttribute(rMat, 4)); rGeo.setAttribute('aDig', new THREE.BufferAttribute(rDig, 2));
rwGeo.setAttribute('position', new THREE.BufferAttribute(rwPos, 3)); rwGeo.setAttribute('aW', new THREE.BufferAttribute(rwDep, 1)); rwGeo.setAttribute('aFlow', new THREE.BufferAttribute(rwFlow, 2));
const ringLand = new THREE.Mesh(rGeo, terrainMat); ringLand.receiveShadow = true; ringLand.frustumCulled = false; scene.add(ringLand);
const ringWater = new THREE.Mesh(rwGeo, waterMat); ringWater.frustumCulled = false; ringWater.renderOrder = 2; scene.add(ringWater);
function farH(x, z, R) {
  const rv = riverAt(x, z), d = rv.d, amp = clamp(d / 30, .3, 1);
  let h = 13.5 + (N - x) * .012 + (N - z) * .004 + noiseFn(x / 55, z / 55, 4) * 8 * amp + noiseFn(x / 13 + 50, z / 13, 2) * 1.2;
  h += smooth(80, 900, R) * (16 + noiseFn(x / 230 + 9, z / 230 - 4, 4) * 60);
  h += smooth(900, 3000, R) * (90 + noiseFn(x / 900 - 3, z / 900 + 5, 4) * 420);
  if (rv.r) h = carve(h, d, rv.bed, rv.r, 1 + R * .003);
  return h;
}
let rFar = null, rLvl = null;
function ringPrep() {
  rFar = new Float32Array(RP * RN); rLvl = new Float32Array(RP * RN).fill(-1e9);
  for (let e = 0; e < RP; e++) {
    const k = EDGE[e], x0 = k % N, z0 = (k / N) | 0, [dx, dz] = RDIR[e];
    for (let r = 1; r < RN; r++) {
      const R = RING_R[r], x = x0 + dx * R, z = z0 + dz * R, v = e * RN + r;
      rFar[v] = farH(x, z, R);
      const rv = riverAt(x, z);
      if (rv.r && rv.d < rv.r.hw && R < 1200) rLvl[v] = rv.bed + rv.r.depth;
    }
  }
}
const ringH = (k, x, z, R, v) => R === 0 ? H[k] : lerp(H[k], v !== undefined && rFar ? rFar[v] : farH(x, z, R), smooth(0, 30, R));
let ringDirty = true;
function updateRing() {
  ringDirty = false;
  if (!rFar) ringPrep();
  for (let e = 0; e < RP; e++) {
    const k = EDGE[e], x0 = k % N, z0 = (k / N) | 0, [dx, dz] = RDIR[e];
    for (let r = 0; r < RN; r++) {
      const v = e * RN + r, R = RING_R[r], x = x0 + dx * R, z = z0 + dz * R, h = ringH(k, x, z, R, v);
      rPos[v * 3] = rwPos[v * 3] = x; rPos[v * 3 + 1] = h; rPos[v * 3 + 2] = rwPos[v * 3 + 2] = z; rDig[v * 2] = h;
      const lv = R === 0 ? (W[k] > .012 ? H[k] + W[k] : null) : (rLvl[v] > -1e8 ? rLvl[v] : null);
      if (lv !== null && lv > h) { rwPos[v * 3 + 1] = lv; rwDep[v] = lv - h; rwFlow[v * 2] = dx * .6; rwFlow[v * 2 + 1] = dz * .6; }
      else { rwPos[v * 3 + 1] = h - .3; rwDep[v] = -1; rwFlow[v * 2] = rwFlow[v * 2 + 1] = 0; }
      rMat[v * 4] = R > 1500 ? .3 : 1; rMat[v * 4 + 1] = 0; rMat[v * 4 + 2] = R > 1500 ? .7 : 0; rMat[v * 4 + 3] = (lv !== null && lv > h) ? 1 : 0;
    }
  }
  for (let e = 0; e < RP; e++) for (let r = 0; r < RN; r++) {
    const v = e * RN + r; if (rwDep[v] > 0) continue;
    let lvl = -1e9;
    for (const n of [v - RN, v + RN, v - 1, v + 1]) if (n >= 0 && n < RP * RN && rwDep[n] > 0 && Math.abs((n % RN) - r) <= 1) lvl = Math.max(lvl, rwPos[n * 3 + 1]);
    if (lvl > -1e8) { rwPos[v * 3 + 1] = lvl; rwDep[v] = Math.max(-2, lvl - rPos[v * 3 + 1]); rMat[v * 4 + 3] = .5; }
  }
  rGeo.computeVertexNormals();
  for (const a of ['position', 'aMat', 'normal', 'aDig']) rGeo.attributes[a].needsUpdate = true;
  for (const a of ['position', 'aW', 'aFlow']) rwGeo.attributes[a].needsUpdate = true;
  rGeo.computeBoundingSphere(); rwGeo.computeBoundingSphere();
}

// ---------------------------------------------------------------- trees, rocks, grass
const windU = { uTime: { value: 0 } };
// card trees: the crowns sway in the wind (more toward the top and the branch tips), each tree in its own time, and
// leaves glow when the sun is behind them
function leafy(sh, trunk) {
  sh.uniforms.uTime = windU.uTime;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        { vec4 gIP = instanceMatrix * vec4(0., 0., 0., 1.);
          float gph = gIP.x * .37 + gIP.z * .29, gh = max(position.y, 0.);
          float gsw = sin(uTime * .9 + gph) + .45 * sin(uTime * 2.1 + gph * 1.7);
          float gtip = ${trunk ? '0.' : 'length(position.xz)'};
          transformed.x += gsw * gh * gh * .0011 + sin(uTime * 2.7 + gph + position.y * .8) * gtip * .012;
          transformed.z += gsw * gh * gh * .0007 + cos(uTime * 2.3 + gph + position.y * .6) * gtip * .012;
          transformed.y += sin(uTime * 3.1 + gph + position.x + position.z) * gtip * .008; }
      #endif`);
  if (!trunk) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #if NUM_DIR_LIGHTS > 0
        { float gback = max(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.25, .55) * pow(gback, 3.) * .55; }
      #endif`);
}
const folMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.foliage, alphaTest: .42, side: THREE.DoubleSide, roughness: .88, alphaToCoverage: true });
const barkTex = T.bark.clone(); barkTex.repeat.set(2, 5); barkTex.needsUpdate = true;
const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: .95, color: 0xd2c2ac });
folMat.onBeforeCompile = sh => leafy(sh, false); folMat.customProgramCacheKey = () => 'gw-fol';
barkMat.onBeforeCompile = sh => leafy(sh, true); barkMat.customProgramCacheKey = () => 'gw-bark';
const TREE_GEOS = [MOD.spruceGeo(1, 12), MOD.spruceGeo(2, 14.5), MOD.spruceGeo(3, 16.5), MOD.leafyGeo(1, 10), MOD.leafyGeo(2, 12)];
const TREE_H = [12, 14.5, 16.5, 10, 12];
// trees in the valley thin out (a dithered fade) when they stand between the camera and the machine you're watching
function fadeable(mat, key) {
  const m = mat.clone();
  m.onBeforeCompile = sh => {
    leafy(sh, key === 'bark');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade; varying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vFade;
        const float GW_B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vFade < .995) { ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.)); if ((GW_B[q.x + q.y * 4] + .5) / 16. > vFade) discard; }`);
  };
  m.customProgramCacheKey = () => 'gw-fade-' + key;
  return m;
}
const folMatNear = fadeable(folMat, 'fol'), barkMatNear = fadeable(barkMat, 'bark');
const treeVariant = t => t.hue < .27 ? 3 + (t.hue < .135 ? 0 : 1) : Math.min(2, Math.floor((t.hue - .27) / .73 * 3));
let treeIMs = [];
function buildTreeMeshes() {
  for (const p of treeIMs) for (const im of [p.fol, p.trunk]) { scene.remove(im); im.dispose(); }
  const counts = TREE_GEOS.map(() => 0);
  for (const t of trees) { t.v = treeVariant(t); t.slot = counts[t.v]++; }
  treeIMs = TREE_GEOS.map((g, v) => {
    const n = Math.max(1, counts[v]), fade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    const mk = (geo, mat) => { geo = geo.clone(); geo.setAttribute('aFade', fade); const im = new THREE.InstancedMesh(geo, mat, n); im.count = counts[v]; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; };
    return { fol: mk(g.fol, folMatNear), trunk: mk(g.trunk, barkMatNear), fade };
  });
  const col = new THREE.Color();
  for (const t of trees) { col.setRGB(.82 + t.hue * .3, .88 + t.hue * .2, .8 + t.hue * .2); treeIMs[t.v].fol.setColorAt(t.slot, col); t.dirty = true; }
  for (const p of treeIMs) if (p.fol.instanceColor) p.fol.instanceColor.needsUpdate = true;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
let treeHeightTimer = 0;
function updateTrees(dt, terrainChanged) {
  treeHeightTimer -= dt;
  const refresh = terrainChanged && treeHeightTimer <= 0;
  if (refresh) treeHeightTimer = .4;
  const touched = new Set();
  for (const t of trees) {
    if (t.st === 1) {
      t.a = Math.min(1, t.a + dt * (.45 + t.a * 2.4));
      if (t.a >= 1) { t.st = 2; t.t = 0; logRest(t); quake(t.x, t.y, t.z, .5 * t.s); dust(t.x + t.dx * 7 * t.s, t.y + .5, t.z + t.dz * 7 * t.s, 16, [.42, .38, .3]); }
      t.dirty = true;
    } else if (t.st === 2 && refresh) { if (logRest(t)) t.dirty = true; }
    else if (t.st === 0 && refresh) { const y = hAt(t.x, t.z) - .15; if (Math.abs(y - t.y) > .01) { t.y = y; t.dirty = true; } }
    if (!t.dirty) continue;
    t.dirty = false; touched.add(t.v);
    if (t.st === 3) _m4.makeScale(0, 0, 0);
    else {
      _q2.setFromAxisAngle(_ax.set(0, 1, 0), t.r);
      if (t.st > 0) { _q.setFromAxisAngle(_ax.set(t.dz, 0, -t.dx), t.a * (t.lie || 1.5)); _q.multiply(_q2); } else _q.copy(_q2);
      const sc = t.s * t.g;
      _m4.compose(_v.set(t.x, t.y, t.z), _q, _s.set(sc, sc, sc));
    }
    treeIMs[t.v].trunk.setMatrixAt(t.slot, _m4);
    if (t.lim && t.st !== 0) _m4.makeScale(0, 0, 0);   // branches cut off: just the log
    treeIMs[t.v].fol.setMatrixAt(t.slot, _m4);
  }
  for (const v of touched) { treeIMs[v].fol.instanceMatrix.needsUpdate = true; treeIMs[v].trunk.instanceMatrix.needsUpdate = true; }
  if (touched.size || stumpDirty) drawStumps();
}
// stumps where the fallers cut trees down
let stumpIM = null, stumpDirty = true;
function drawStumps() {
  stumpDirty = false;
  if (!stumpIM) {
    const g = new THREE.CylinderGeometry(.2, .27, .5, 9); g.translate(0, .2, 0);
    const top = new THREE.MeshStandardMaterial({ color: 0xd8b77f, roughness: .9 });
    stumpIM = new THREE.InstancedMesh(g, [barkMat, top, top], trees.length); stumpIM.castShadow = true; stumpIM.receiveShadow = true; stumpIM.frustumCulled = false; scene.add(stumpIM);
  }
  let n = 0;
  for (const t of trees) if (t.cut && t.stump !== 0) { _m4.compose(_v.set(t.sx, hAt(t.sx, t.sz) - .05, t.sz), _q.identity(), _s.set(t.s, t.s, t.s)); stumpIM.setMatrixAt(n++, _m4); }
  stumpIM.count = n; stumpIM.instanceMatrix.needsUpdate = true;
}
// how a log lies: its foot on the ground, tipped to follow the slope towards its crown
const logLen = t => TREE_H[t.v] * t.s * .82;
function logRest(t) {
  const L = logLen(t), y = hAt(t.x, t.z) - .1, yt = hAt(t.x + t.dx * L * .6, t.z + t.dz * L * .6);
  const lie = clamp(Math.PI / 2 - Math.atan2(yt - y, L * .6), 1.25, 1.85);
  const ch = Math.abs(y - t.y) > .01 || Math.abs(lie - (t.lie || 0)) > .01;
  t.y = y; t.lie = lie; return ch;
}
// machines shove logs: a push near one end swings the log round, a push in the middle slides it
function pushLogs(m, cs) {
  for (const t of trees) {
    if (t.st !== 2) continue;
    const L = logLen(t), cx = t.x + t.dx * L * .5, cz = t.z + t.dz * L * .5;
    if (Math.abs(cx - m.x) > L * .5 + 6 || Math.abs(cz - m.z) > L * .5 + 6) continue;
    for (const [px, pz, r] of cs) {
      const rx = px - t.x, rz = pz - t.z, u = clamp(rx * t.dx + rz * t.dz, 0, L) / L;
      const qx = t.x + t.dx * L * u, qz = t.z + t.dz * L * u, ex = qx - px, ez = qz - pz, d = Math.hypot(ex, ez);
      const rad = (u < .35 ? .45 : 1.6) * t.s, need = r + rad;
      if (d >= need || d < 1e-3) continue;
      const pen = need - d, nx = ex / d, nz = ez / d, k = 1 / ((1 - u) ** 2 + u * u);
      const bx = t.x + nx * pen * (1 - u) * k, bz = t.z + nz * pen * (1 - u) * k;
      const tx = t.x + t.dx * L + nx * pen * u * k, tz = t.z + t.dz * L + nz * pen * u * k;
      let dx = tx - bx, dz = tz - bz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const mx = (bx + tx) / 2, mz = (bz + tz) / 2;
      t.x = clamp(mx - dx * L / 2, 2, N - 3); t.z = clamp(mz - dz * L / 2, 2, N - 3); t.dx = dx; t.dz = dz;
      logRest(t); t.dirty = true;
      m.work = Math.max(m.work, .55);
      if (Math.random() < .04) dust(qx, hAt(qx, qz) + .3, qz, 2, DIRT_C);
    }
  }
}
// trees between the camera and the machine (or right by the camera) thin out so you can see what you're doing
let fadeT = 0;
function treeFade(dt) {
  fadeT -= dt;
  const me = boss ? bossCam : machines[active]; if (!me || !treeIMs.length) return;
  const cx = camera.position.x, cz = camera.position.z, mx = me.x, mz = me.z;
  const sx = mx - cx, sz = mz - cz, sl = Math.hypot(sx, sz) || 1, ux = sx / sl, uz = sz / sl;
  const k = 1 - Math.exp(-dt * 6), dirty = new Set();
  // from above, the trees right over a working machine thin out so you can watch it
  const pts = boss ? machines.filter(m => m.ai || m.equip).map(m => [m.x, m.z]) : null;
  if (boss && people.site) pts.push([people.site.x, people.site.z]);
  for (const t of trees) {
    if (t.st === 3) continue;
    let want = 1;
    if (boss) {
      for (const [px, pz] of pts) { const dx = t.x - px, dz = t.z - pz, r = 3.2 * t.s + 4; if (dx * dx + dz * dz < r * r) { want = .2; break; } }
      const f = t.fade ?? 1, nf = Math.abs(want - f) < .01 ? want : f + (want - f) * k;
      if (nf !== f) { t.fade = nf; treeIMs[t.v].fade.array[t.slot] = nf; dirty.add(t.v); }
      continue;
    }
    const tx = t.x - cx, tz = t.z - cz;
    if (Math.abs(tx) < sl + 12 && Math.abs(tz) < sl + 12) {
      const along = tx * ux + tz * uz, side = Math.abs(tx * uz - tz * ux), crown = 3.2 * t.s;
      if (Math.hypot(tx, tz) < crown + 2.5) want = .15;
      else if (along > 0 && along < sl - 1.5 && side < crown + 1.2) {
        const yLine = camera.position.y + (me.y + 2 - camera.position.y) * along / sl;   // height of the line of sight above this tree
        if (yLine < hAt(t.x, t.z) + TREE_H[t.v] * t.s + 1) want = .22;
      }
      if (t.st === 2) {   // a log: fade if it lies across the view near the machine
        const L = logLen(t), lx = t.x + t.dx * L * .6 - cx, lz = t.z + t.dz * L * .6 - cz;
        if (lx * ux + lz * uz > 0 && lx * ux + lz * uz < sl && Math.abs(lx * uz - lz * ux) < 3) want = Math.min(want, .35);
      }
    }
    const f = t.fade ?? 1, nf = Math.abs(want - f) < .01 ? want : f + (want - f) * k;
    if (nf !== f) { t.fade = nf; treeIMs[t.v].fade.array[t.slot] = nf; dirty.add(t.v); }
  }
  for (const v of dirty) treeIMs[v].fade.needsUpdate = true;
}

// boulders: lie about the valley and get shoved aside by the machines
const rocks = [];
function makeRocks(sd) {
  const r = mulberry32(sd * 13 + 5); rocks.length = 0;
  for (let a = 0; a < 4000 && rocks.length < 120; a++) {
    let x, z;
    if (rocks.length < 45) { const an = r() * 6.283, d = GRAVEL.r * (.6 + r() * .7); x = GRAVEL.x + Math.cos(an) * d; z = GRAVEL.z + Math.sin(an) * d; }
    else { x = 4 + r() * (N - 8); z = 4 + r() * (N - 8); }
    if (x < 3 || z < 3 || x > N - 4 || z > N - 4) continue;
    const k = cellOf(x, z); if (RD[k] < 9 || inYard(x, z, 6)) continue;
    rocks.push({ x, z, s: .3 + r() ** 2 * 1.1, ry: r() * 6.28, rx: 0, tint: .75 + r() * .35, y: 0, dirty: true });
  }
}
const rockMat = new THREE.MeshStandardMaterial({ map: T.rock, roughness: .88, metalness: 0 });
let rockIM = null;
function buildRocks() {
  if (rockIM) scene.remove(rockIM);
  rockIM = new THREE.InstancedMesh(MOD.rockGeo(3), rockMat, Math.max(1, rocks.length));
  rockIM.castShadow = true; rockIM.receiveShadow = true; rockIM.frustumCulled = false; scene.add(rockIM);
  const col = new THREE.Color();
  rocks.forEach((rk, i) => { col.setRGB(rk.tint, rk.tint * .98, rk.tint * .94); rockIM.setColorAt(i, col); rk.dirty = true; });
  updateRocks(1, true);
}
let rockTimer = 0;
function updateRocks(dt, changed) {
  rockTimer -= dt;
  const refresh = changed && rockTimer <= 0; if (refresh) rockTimer = .4;
  let any = false;
  rocks.forEach((rk, i) => {
    if (refresh) rk.dirty = true;
    if (!rk.dirty) return;
    rk.dirty = false; any = true;
    rk.y = hAt(rk.x, rk.z) - rk.s * .22;
    _q.setFromEuler(new THREE.Euler(rk.rx, rk.ry, 0, 'YXZ'));
    _m4.compose(_v.set(rk.x, rk.y, rk.z), _q, _s.set(rk.s, rk.s, rk.s));
    rockIM.setMatrixAt(i, _m4);
  });
  if (any) rockIM.instanceMatrix.needsUpdate = true;
}

// grass tufts near the camera, swaying in the wind; gone wherever the ground has been dug or driven
const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .85 });
const grassU = { uTime: { value: 0 } };
grassMat.onBeforeCompile = sh => {
  sh.uniforms.uTime = grassU.uTime;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 gIP = instanceMatrix * vec4(0., 0., 0., 1.);
        float sway = sin(uTime * 1.7 + gIP.x * .35 + gIP.z * .27) + .5 * sin(uTime * 2.9 + gIP.x * .9 - gIP.z * .4);
        transformed.x += sway * .07 * position.y; transformed.z += sway * .045 * position.y;
      #endif`);
};
let grassIM = null, grassAt = null, grassTimer = 0;
if (Q.grass > 0) {
  grassIM = new THREE.InstancedMesh(MOD.tuftGeo(), grassMat, Q.grass);
  grassIM.receiveShadow = true; grassIM.frustumCulled = false; grassIM.count = 0; scene.add(grassIM);
}
const _gc = new THREE.Color();
const hashf = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function updateGrass(dt, me) {
  if (!grassIM) return;
  grassTimer -= dt;
  const cx = camera.position.x * .5 + me.x * .5, cz = camera.position.z * .5 + me.z * .5;
  const moved = !grassAt || Math.hypot(cx - grassAt[0], cz - grassAt[1]) > 6;
  if (!(moved || grassDirty) || grassTimer > 0) return;
  grassTimer = .5; grassDirty = false; grassAt = [cx, cz];
  const R = Q.grassR, i0 = Math.max(1, Math.floor(cx - R)), i1 = Math.min(N - 2, Math.ceil(cx + R)), j0 = Math.max(1, Math.floor(cz - R)), j1 = Math.min(N - 2, Math.ceil(cz + R));
  let n = 0;
  for (let j = j0; j <= j1 && n < Q.grass; j++) for (let i = i0; i <= i1 && n < Q.grass; i++) {
    const dd = (i - cx) ** 2 + (j - cz) ** 2; if (dd > R * R) continue;
    const k = j * N + i;
    if (W[k] > .005) continue;
    // reeds and tall grass line the water's edge
    const bank = W[k - 1] > .05 || W[k + 1] > .05 || W[k - N] > .05 || W[k + N] > .05 || W[k - 2] > .05 || W[k + 2] > .05 || W[k - 2 * N] > .05 || W[k + 2 * N] > .05;
    if (!bank && (M[k] !== 0 || D[k] || W[k + 1] > .005 || W[k + N] > .005)) continue;
    if (!bank && Math.abs(H[k + 1] - H[k - 1]) + Math.abs(H[k + N] - H[k - N]) > 1.1) continue;
    for (let q = 0; q < (bank ? 3 : 2) && n < Q.grass; q++) {
      const hx = hashf(i + q * .37, j), hz = hashf(j + q * .51, i + 3.1);
      if (dd > R * R * .55 && hx < .5) continue;
      const patch = vnoise(i * .11 + 3.3, j * .11 - 1.7) + .5 * vnoise(i * .37, j * .37);   // about -.75 .. .75
      if (!bank && patch < -.18 && hz < .55) continue;
      const x = i + hx - .5, z = j + hz - .5, s = (.7 + hashf(i, j + q) * .7) * clamp(1 + patch * .9, .55, 1.7);
      { const dryp = clamp(vnoise(i * .07 - 9.1, j * .07 + 4.2) * 2.2 + .25, 0, 1), sh = .72 + hashf(j * 1.3 + q, i * .7) * .56;
        _gc.setRGB(sh * (1 + dryp * .55), sh * (1 + dryp * .22), sh * (1 - dryp * .3)); grassIM.setColorAt(n, _gc); }
      _q.setFromAxisAngle(_ax.set(0, 1, 0), hx * 6.28);
      _m4.compose(_v.set(x, hAt(x, z) - .03, z), _q, _s.set(s * (bank ? .8 : 1), s * (.8 + hz * .5) * (bank ? 2.6 + hz * 1.4 : 1), s * (bank ? .8 : 1)));
      grassIM.setMatrixAt(n++, _m4);
    }
  }
  grassIM.count = n; grassIM.instanceMatrix.needsUpdate = true; if (grassIM.instanceColor) grassIM.instanceColor.needsUpdate = true;
}

// the forest beyond the work site (fixed scenery)
let farForest = [];
function buildFarForest() {
  for (const im of farForest) scene.remove(im);
  farForest = [];
  const r = mulberry32(seed * 3 + 7);
  const near = [[], [], [], [], []], far = [];
  let nn = 0;
  for (let a = 0; a < (Q.near + Q.far) * 5 && (nn < Q.near || far.length < Q.far); a++) {
    const e = Math.floor(r() * RP), isNear = r() < Q.near / (Q.near + Q.far);
    const R = isNear ? 3 + r() ** 1.2 * 90 : 90 + r() ** 1.6 * 1300;
    const k = EDGE[e], [dx, dz] = RDIR[e], x = k % N + dx * R + (r() - .5) * 8, z = ((k / N) | 0) + dz * R + (r() - .5) * 8;
    const rv = riverAt(x, z); if (rv.r && rv.d < rv.r.bank * .8 + R * .03) continue;
    if (noiseFn(x / 80, z / 80, 2) < -.1 && r() < .7) continue;
    const y = ringH(k, x, z, R) - .2, s = .8 + r() * .5, ry = r() * 6.28;
    if (isNear) { if (nn >= Q.near) continue; nn++; near[r() < .27 ? 3 + (r() < .5 ? 0 : 1) : Math.floor(r() * 3)].push([x, y, z, s, ry]); }
    else { if (far.length >= Q.far) continue; far.push([x, y, z, s * 1.2, ry]); }
  }
  const put = (geo, mat, list, shadow) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, s, ry], i) => { _q.setFromAxisAngle(_ax.set(0, 1, 0), ry); _m4.compose(_v.set(x, y, z), _q, _s.set(s, s, s)); im.setMatrixAt(i, _m4); });
    im.castShadow = shadow; im.receiveShadow = true; scene.add(im); farForest.push(im);
  };
  near.forEach((l, v) => { put(TREE_GEOS[v].fol, folMat, l, false); put(TREE_GEOS[v].trunk, barkMat, l, false); });
  put(MOD.farCardGeo(), folMat, far, false);
}

// ---------------------------------------------------------------- dust, smoke and spray
const PMAX = 6000;
const pPos = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 4), pSize = new Float32Array(PMAX);
const pLand = new Uint8Array(PMAX), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pS0 = new Float32Array(PMAX), pS1 = new Float32Array(PMAX), pA0 = new Float32Array(PMAX), pG = new Float32Array(PMAX), pDrag = new Float32Array(PMAX);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aCol', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tPuff: { value: null }, uScale: { value: 400 } }]),
  vertexShader: `
    #include <common>
    #include <fog_pars_vertex>
    attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
    void main() { vCol = aCol; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / max(.2, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    #include <common>
    #include <fog_pars_fragment>
    uniform sampler2D tPuff; varying vec4 vCol;
    void main() { float a = texture2D(tPuff, gl_PointCoord).a * vCol.a; if (a < .01) discard; gl_FragColor = vec4(vCol.rgb, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
pMat.uniforms.tPuff.value = T.puff;
const puffs = new THREE.Points(pGeo, pMat); puffs.frustumCulled = false; puffs.renderOrder = 3; scene.add(puffs);
let pNext = 0;
const lin = c => c.map(v => Math.pow(v, 2.2));
const PK = {
  dust: { life: [1.4, 2.6], s0: .5, s1: 3.2, a: .5, up: [.3, 1.1], spread: 1.6, g: -.05, drag: 1.2 },
  smoke: { life: [1.6, 2.6], s0: .3, s1: 2.4, a: .45, up: [1.4, 2.2], spread: .3, g: -.25, drag: .6 },
  splash: { life: [.5, .9], s0: .35, s1: .7, a: .7, up: [1.5, 3.2], spread: 1.8, g: 9, drag: .2 },
  leaf: { life: [1.5, 2.5], s0: .25, s1: .25, a: .9, up: [.2, 1.2], spread: 2.4, g: 1.2, drag: 1.5 },
  spark: { life: [.25, .5], s0: .07, s1: .03, a: 1, up: [1.5, 4], spread: 5, g: 9.8, drag: .4 },
  grain: { life: [1.2, 2], s0: .11, s1: .09, a: 1, up: [-.5, .4], spread: .6, g: 9.8, drag: .15, land: true },
};
function spawn(kind, x, y, z, n, col, opts = {}) {
  const K = PK[kind], c = lin(col);
  for (let q = 0; q < n; q++) {
    const p = pNext; pNext = (pNext + 1) % PMAX;
    pPos[p * 3] = x + (Math.random() - .5) * (opts.jitter ?? .8); pPos[p * 3 + 1] = y + Math.random() * .3; pPos[p * 3 + 2] = z + (Math.random() - .5) * (opts.jitter ?? .8);
    pVel[p * 3] = (Math.random() - .5) * K.spread + (opts.vx || 0); pVel[p * 3 + 1] = lerp(K.up[0], K.up[1], Math.random()) * (opts.up ?? 1); pVel[p * 3 + 2] = (Math.random() - .5) * K.spread + (opts.vz || 0);
    pMax[p] = pLife[p] = lerp(K.life[0], K.life[1], Math.random());
    pS0[p] = K.s0 * (opts.size ?? 1) * (K.land ? .6 + Math.random() * .9 : 1); pS1[p] = K.s1 * (opts.size ?? 1); pA0[p] = K.a * (opts.alpha ?? 1); pG[p] = K.g; pDrag[p] = K.drag; pLand[p] = K.land ? 1 : 0;
    if (K.land) { const sh = .75 + Math.random() * .4; pCol[p * 4] = c[0] * sh; pCol[p * 4 + 1] = c[1] * sh; pCol[p * 4 + 2] = c[2] * sh; continue; }
    pCol[p * 4] = c[0]; pCol[p * 4 + 1] = c[1]; pCol[p * 4 + 2] = c[2];
  }
}
function dust(x, y, z, n, c) { spawn('dust', x, y, z, Math.ceil(n * .6), c); }
const DIRT_C = [.5, .38, .27], GRAVEL_C = [.62, .6, .57];
function updateParticles(dt) {
  const wind = .6;
  for (let p = 0; p < PMAX; p++) {
    if (pLife[p] <= 0) { pCol[p * 4 + 3] = 0; pSize[p] = 0; continue; }
    pLife[p] -= dt;
    const f = 1 - pLife[p] / pMax[p], dr = Math.exp(-pDrag[p] * dt);
    pVel[p * 3] = pVel[p * 3] * dr + wind * dt * .4; pVel[p * 3 + 1] = pVel[p * 3 + 1] * dr - pG[p] * dt; pVel[p * 3 + 2] = pVel[p * 3 + 2] * dr + wind * dt * .25;
    pPos[p * 3] += pVel[p * 3] * dt; pPos[p * 3 + 1] += pVel[p * 3 + 1] * dt; pPos[p * 3 + 2] += pVel[p * 3 + 2] * dt;
    if (pLand[p]) {   // a grain of soil: falls, and is gone when it lands
      pSize[p] = pS0[p]; pCol[p * 4 + 3] = 1;
      if (pPos[p * 3 + 1] < hAt(pPos[p * 3], pPos[p * 3 + 2])) { pLife[p] = 0; if (Math.random() < .04) spawn('dust', pPos[p * 3], pPos[p * 3 + 1], pPos[p * 3 + 2], 1, [pCol[p * 4] ** .45, pCol[p * 4 + 1] ** .45, pCol[p * 4 + 2] ** .45], { alpha: .5, size: .7 }); }
      continue;
    }
    pSize[p] = lerp(pS0[p], pS1[p], Math.sqrt(f));
    pCol[p * 4 + 3] = pA0[p] * Math.min(1, f * 6) * (1 - f) * (1 - f * .3);
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aCol.needsUpdate = true; pGeo.attributes.aSize.needsUpdate = true;
}

// ---------------------------------------------------------------- prints: tracks and tyres press their pattern into the ground
// (just for show; the oldest are reused, and a print goes when the ground under it is dug, buried or flooded)
const TMAX = quality === 'high' ? 1800 : quality === 'medium' ? 1000 : 500;
const treadGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const tInfo = new Float32Array(TMAX * 2), tCell = new Int32Array(TMAX).fill(-1), tH = new Float32Array(TMAX);
treadGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(tInfo, 2).setUsage(THREE.DynamicDrawUsage));
const treadMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  uniforms: { tMap: { value: T.tread }, uFade: { value: quality === 'high' ? 110 : 70 } },
  vertexShader: `attribute vec2 aInfo; varying vec2 vUv; varying float vA; uniform float uFade;
    void main() { vUv = vec2(uv.x * .5 + aInfo.x, uv.y); vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vA = aInfo.y * (1. - smoothstep(uFade * .55, uFade, -mv.z)); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D tMap; varying vec2 vUv; varying float vA;
    void main() { float a = texture2D(tMap, vUv).a * vA; if (a < .01) discard; gl_FragColor = vec4(.03, .022, .015, a * .85); }`,
});
const treadIM = new THREE.InstancedMesh(treadGeo, treadMat, TMAX);
treadIM.frustumCulled = false; treadIM.renderOrder = 1; scene.add(treadIM);
let tNext = 0, tCheck = 0;
const _tr = new THREE.Vector3(), _tf = new THREE.Vector3(), _tu = new THREE.Vector3();
const hShow = (x, z) => (Q.detail > 1 ? hDraw(x, z, 2) : hAt(x, z));
function addPrint(x, z, yaw, wid, len, tyre) {
  if (x < 2 || z < 2 || x > N - 3 || z > N - 3) return;
  const k = cellOf(x, z);
  if (W[k] > .02 || DECK[k] > 0) return;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), a = len / 2, b = wid / 2;
  const hf = hShow(x + fx * a, z + fz * a), hb = hShow(x - fx * a, z - fz * a), hr = hShow(x + rx * b, z + rz * b), hl = hShow(x - rx * b, z - rz * b);
  _tf.set(fx * len, hf - hb, fz * len); _tr.set(rx * wid, hr - hl, rz * wid); _tu.crossVectors(_tf, _tr).normalize();
  const i = tNext; tNext = (tNext + 1) % TMAX;
  _m4.makeBasis(_tr, _tu, _tf).setPosition(x, (hf + hb + hr + hl) / 4 + .025, z);
  treadIM.setMatrixAt(i, _m4); treadIM.instanceMatrix.needsUpdate = true;
  tInfo[i * 2] = tyre ? .5 : 0; tInfo[i * 2 + 1] = M[k] === 2 ? .55 : (M[k] === 1 || D[k]) ? 1 : .6;
  treadGeo.attributes.aInfo.needsUpdate = true;
  tCell[i] = k; tH[i] = H[k];
}
function updatePrints() {
  let any = false;
  for (let q = 0; q < 60; q++) {
    const i = tCheck; tCheck = (tCheck + 1) % TMAX;
    const k = tCell[i]; if (k < 0) continue;
    if (Math.abs(H[k] - tH[i]) > .05 || W[k] > .03) { tCell[i] = -1; tInfo[i * 2 + 1] = 0; any = true; }
  }
  if (any) treadGeo.attributes.aInfo.needsUpdate = true;
}
// where each machine's tracks or wheels touch: [sideways, along, width]
const CONTACT = { dozer: [[1.2, 0, .62], [-1.2, 0, .62]], excavator: [[1.25, 0, .62], [-1.25, 0, .62]], paver: [[1.3, 0, .5], [-1.3, 0, .5]],
  loader: [[1.18, -1.6, .66], [-1.18, -1.6, .66]], hauler: [[1.3, -2.9, .76], [-1.3, -2.9, .76]] };
function leavePrints(m, dist, dyaw) {
  const pts = CONTACT[m.type]; if (!pts) return;
  m.printAcc = (m.printAcc || 0) + Math.abs(dist) + Math.abs(dyaw) * 1.2;
  if (m.printAcc < .5) return;
  m.printAcc = 0;
  const c = Math.cos(m.yaw), sn = Math.sin(m.yaw), tyre = !SPEC[m.type].tracks;
  for (const [px, pz, w] of pts) addPrint(m.x + c * px + sn * pz, m.z - sn * px + c * pz, m.yaw, w, .52, tyre);
}

// clods and stones that tumble out of buckets and beds (just for show: the ground has already been changed)
const CMAX = quality === 'low' ? 360 : 900;
const clodGeo = (() => { const g = new THREE.IcosahedronGeometry(.11, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = .75 + .45 * Math.abs(Math.sin(p.getX(i) * 41 + p.getY(i) * 23 + p.getZ(i) * 17)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .8, p.getZ(i) * k); } g.computeVertexNormals(); return g; })();
const chunkIM = new THREE.InstancedMesh(clodGeo, new THREE.MeshStandardMaterial({ roughness: 1, map: T.dirt }), CMAX);
chunkIM.castShadow = true; chunkIM.frustumCulled = false; scene.add(chunkIM);
const cPos = new Float32Array(CMAX * 3), cVel = new Float32Array(CMAX * 3), cLife = new Float32Array(CMAX), cRot = new Float32Array(CMAX * 2), cS = new Float32Array(CMAX);
let cNext = 0, chunksLive = 0;
{ const col = new THREE.Color(); for (let i = 0; i < CMAX; i++) { chunkIM.setMatrixAt(i, _m4.makeScale(0, 0, 0)); chunkIM.setColorAt(i, col.setRGB(.4, .3, .2)); } }
const CHUNK_DIRT = new THREE.Color(0x9a7352), CHUNK_GRAVEL = new THREE.Color(0x8c8880), _cc = new THREE.Color();
function chunks(x, y, z, n, gravel, vx = 0, vz = 0, spread = 1) {
  spawn('grain', x, y, z, n * 9, gravel ? [.55, .53, .5] : [.34, .24, .16], { jitter: spread, vx, vz, size: .75 });
  n = Math.ceil(n * .55);
  for (let q = 0; q < n; q++) {
    const i = cNext; cNext = (cNext + 1) % CMAX;
    cPos[i * 3] = x + (Math.random() - .5) * spread; cPos[i * 3 + 1] = y + (Math.random() - .5) * .3; cPos[i * 3 + 2] = z + (Math.random() - .5) * spread;
    cVel[i * 3] = vx + (Math.random() - .5) * 1.2; cVel[i * 3 + 1] = Math.random() * 1.2; cVel[i * 3 + 2] = vz + (Math.random() - .5) * 1.2;
    cLife[i] = 1.6 + Math.random(); cRot[i * 2] = Math.random() * 6; cRot[i * 2 + 1] = Math.random() * 6; cS[i] = .4 + Math.random() * Math.random() * 1.3;
    _cc.copy(gravel ? CHUNK_GRAVEL : CHUNK_DIRT).multiplyScalar(.75 + Math.random() * .5);
    chunkIM.setColorAt(i, _cc);
  }
  chunkIM.instanceColor.needsUpdate = true;
  chunksLive = 3;
}
function updateChunks(dt) {
  if (chunksLive <= 0) return;
  chunksLive -= dt;
  for (let i = 0; i < CMAX; i++) {
    if (cLife[i] <= 0) continue;
    cLife[i] -= dt;
    cVel[i * 3 + 1] -= 9.8 * dt;
    let x = cPos[i * 3] + cVel[i * 3] * dt, y = cPos[i * 3 + 1] + cVel[i * 3 + 1] * dt, z = cPos[i * 3 + 2] + cVel[i * 3 + 2] * dt;
    const g = hAt(x, z) + .05 * cS[i];
    if (y < g) {
      const vy = cVel[i * 3 + 1];
      if (vy < -1.2) {   // lands: a puff of dust for the big ones and a small bounce
        if (vy < -2.5 && cS[i] > .9 && Math.random() < .5) spawn('dust', x, g + .1, z, 1, DIRT_C, { alpha: .3, size: .55 });
        cVel[i * 3] *= .6; cVel[i * 3 + 2] *= .6; cVel[i * 3 + 1] = -vy * .2;
      } else cVel[i * 3 + 1] = 0;
      y = g;
      // on the ground it rolls down whatever slope it's on (a heap's face, the side of a pit) and stops on the flat
      const gx = (hAt(x + .4, z) - hAt(x - .4, z)) * 1.25, gz = (hAt(x, z + .4) - hAt(x, z - .4)) * 1.25, sl = Math.hypot(gx, gz);
      if (sl > .4) { cVel[i * 3] -= gx * 6.5 * dt; cVel[i * 3 + 2] -= gz * 6.5 * dt; }
      const f = Math.exp(-dt * (sl > .4 ? 1.2 : 5));
      cVel[i * 3] *= f; cVel[i * 3 + 2] *= f;
      const hs = Math.hypot(cVel[i * 3], cVel[i * 3 + 2]);
      if (hs > .4) { cLife[i] = Math.max(cLife[i], .6); cRot[i * 2] += hs * dt * 3 / Math.max(.3, cS[i]); }
      else cLife[i] = Math.min(cLife[i], 1.1);
    }
    cPos[i * 3] = x; cPos[i * 3 + 1] = y; cPos[i * 3 + 2] = z;
    cRot[i * 2] += dt * 6; cRot[i * 2 + 1] += dt * 4;
    const s = cLife[i] > 0 ? cS[i] * Math.min(1, cLife[i] * 2.5) : 0;
    _q.setFromEuler(new THREE.Euler(cRot[i * 2], cRot[i * 2 + 1], 0));
    chunkIM.setMatrixAt(i, _m4.compose(_v.set(x, y, z), _q, _s.set(s, s, s)));
  }
  chunkIM.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- machines
const LOADMAT = {
  dirt: new THREE.MeshStandardMaterial({ map: T.dirt, roughness: 1, color: 0xc8b8a8 }),
  gravel: new THREE.MeshStandardMaterial({ map: T.gravel, roughness: .95 }),
};
const SPEC = {
  dozer: { name: 'Dozer', ford: 1.0, vmax: 4.6, acc: 3.1, turn: .85, tracks: true, len: 4.6, wid: 3.2, circ: [[1.2, 1.9], [-1.0, 1.7]], cap: 6, tool: 'Blade',
    hint: 'R/F blade up and down. Drive forward with the blade low to cut; over low ground it fills. Back up to leave the pile.' },
  loader: { name: 'Loader', ford: .55, vmax: 7.8, acc: 3.8, wb: 2.9, len: 5.4, wid: 2.8, circ: [[1.6, 1.6], [-1.5, 1.6]], cap: 3, tool: 'Bucket',
    hint: 'F lowers the bucket; drive into a pile to fill it. R raises it. Space dumps (into a hauler if one is under the bucket).' },
  excavator: { name: 'Excavator', ford: 1.2, vmax: 3, acc: 2.3, turn: .6, tracks: true, len: 4.4, wid: 3.2, circ: [[0, 2.2]], cap: 1.5, tool: 'Bucket',
    hint: 'Q/E swing, R/F reach out and in. Space digs, Space again dumps (into a hauler if it is under the bucket).' },
  hauler: { name: 'Hauler', ford: .65, vmax: 11, acc: 3.8, wb: 4.6, len: 8, wid: 3, circ: [[2.6, 1.6], [-.6, 1.6], [-3.2, 1.6]], cap: 12, tool: 'Bed',
    hint: 'Park next to the loader or excavator to get filled. Space tips the bed and dumps behind you; Space again lowers it.' },
};
// crew equipment for roads and bridges
Object.assign(SPEC, {
  roller: { name: 'Roller', ford: .5, vmax: 3.5, acc: 2, wb: 2.6, len: 5, wid: 2.4, circ: [[1.5, 1.3], [-1.2, 1.3]], cap: 1, tool: 'Drum', paint: 0xe0a91c },
  paver: { name: 'Paver', ford: .4, vmax: 2.5, acc: 1.5, turn: .5, tracks: true, len: 5.5, wid: 3.6, circ: [[1.6, 1.4], [-1.2, 1.6]], cap: 1, tool: 'Screed', paint: 0xe0a91c },
  mixer: { name: 'Mixer', ford: .6, vmax: 9, acc: 2.6, wb: 5, len: 8, wid: 2.5, circ: [[2.6, 1.4], [-.4, 1.4], [-3, 1.4]], cap: 8, tool: 'Drum', paint: 0xd9701c },
  crane: { name: 'Crane', ford: .7, vmax: 7, acc: 2, wb: 6, len: 9.4, wid: 2.6, circ: [[3.2, 1.5], [0, 1.5], [-3.2, 1.5]], cap: 1, tool: 'Hook', paint: 0xe8c21a },
  truck: { name: 'Truck', ford: .5, vmax: 10, acc: 3, wb: 4, len: 7, wid: 2.4, circ: [[2, 1.3], [-1.6, 1.3]], cap: 1, tool: 'Bed', paint: 0xf2f0ea },
  logtruck: { name: 'Log truck', ford: .55, vmax: 9, acc: 2.6, wb: 5.2, len: 10.4, wid: 2.6, circ: [[2.6, 1.4], [-.6, 1.4], [-3.8, 1.4]], cap: 1, tool: 'Crane', paint: 0x2f5d8a },
});
const BUILD = { dozer: MOD.buildDozer, loader: MOD.buildLoader, excavator: MOD.buildExcavator, hauler: MOD.buildHauler,
  roller: MOD.buildRoller, paver: MOD.buildPaver, mixer: MOD.buildMixer, crane: MOD.buildCrane, truck: MOD.buildTruck, logtruck: MOD.buildLogTruck };
const PAINT = 0xd9701c;
const machines = [];
let machineSeq = 0;
// equip: crew-only equipment brought in for a job (not in the machine bar, not saved; always after the driveable ones)
function makeMachine(type, x, z, yaw, equip = false) {
  const mats = MOD.machineMats(T, SPEC[type].paint || PAINT);
  const m = { type, x, z, yaw, v: 0, y: gAt(x, z), pitch: 0, roll: 0, load: newLoad(), mats, id: machineSeq++, equip,
    blade: 0, arm: .3, dumpT: 0, swing: 0, reach: 5, act: -1, did: false, mode: 'dig', curl: .2, tip: 0, tipping: false,
    work: 0, workSm: 0, hyd: 0, hydSm: 0, dig: 0, digG: 0, digSm: 0, pour: 0, pourSm: 0, trackSpeed: 0, steerVis: 0,
    sPitch: 0, sRoll: 0, lastV: 0, grime: .2, hp: 1, hurtT: 0, smokeAcc: 0, pourT: 0, pourG: false, splashT: 0 };
  BUILD[type](m, mats, LOADMAT);
  rigUp(m);
  m.group.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; } });
  m.worker = MOD.buildWorker(m.id); m.worker.position.set(0, 0, -.02); m.cabG.add(m.worker); m.worker.visible = false;
  scene.add(m.group);
  if (equip) machines.push(m); else machines.splice(driveCount(), 0, m);
  if (snd.ready) snd.machine(m.id, ENGINE[type]);
  return m;
}
function removeMachine(m) {
  const i = machines.indexOf(m); if (i < 0 || !m.equip) return;
  machines.splice(i, 1); scene.remove(m.group); snd.dropMachine(m.id);
  if (m.hook) { scene.remove(m.hook); scene.remove(m.cable); }
}
const driveCount = () => { let n = 0; while (n < machines.length && !machines[n].equip) n++; return n; };
function resetMachines() {
  for (const m of machines) scene.remove(m.group);
  machines.length = 0;
  makeMachine('dozer', 113, 172, Math.PI);
  makeMachine('loader', 120, 172, Math.PI);
  makeMachine('excavator', 127.5, 173, Math.PI);
  makeMachine('hauler', 135, 174, Math.PI);
}

const fwdX = y => Math.sin(y), fwdZ = y => Math.cos(y);
// Where a machine touches the ground, and how it steers.
// Tracks: five road-wheel stations along each track. Wheels: every tyre (those on the front frame turn with it).
// Loader, hauler and roller bend in the middle (`hinge`): a = hinge to front axle, b = hinge to rear axle, b0 = middle
// of the machine to the rear axle, max = the bend that gives the same turning circle the crew plans with (wb / tan .55).
function rigUp(m) {
  const s = SPEC[m.type], cp = [];
  if (m.tracks) for (const t of m.tracks) for (let i = 0; i < 5; i++) cp.push({ x: t.x, z: -t.a + i * t.a / 2, r: 0, f: false, tr: t });
  else if (m.wheels) for (const w of m.wheels) { const h = w.userData.hold; cp.push({ x: h.position.x, z: h.position.z, r: w.userData.r, f: !!m.front && h.parent === m.front, w, h, y0: w.userData.y0 }); }
  if (m.drum && m.front) for (const sx of [-.9, .9]) cp.push({ x: sx, z: 1.55, r: .78, f: true });   // the roller's drum
  m.cp = cp; m.art = 0; m.om = 0; m.vs = 0; m.slipV = 0; m.vy = 0; m.pv = 0; m.rv = 0; m.twist = 0; m.brake = 1;
  if (!m.tracks && cp.length) {
    const rear = cp.filter(c => !c.f && (m.front || c.z < 0));
    for (const c of cp) c.front = !rear.includes(c);
    const frontPts = cp.filter(c => c.front);
    const zr = rear.reduce((a, c) => a + c.z, 0) / Math.max(1, rear.length);
    if (m.front && frontPts.length) {
      const hz = m.front.position.z, zf = hz + frontPts.reduce((a, c) => a + c.z, 0) / frontPts.length;
      const a = zf - hz, b = hz - zr, b0 = -zr, Rt = s.wb / Math.tan(.55), Rr = Math.sqrt(Math.max(1, Rt * Rt - b0 * b0));
      m.hinge = { hz, a, b, b0, max: clamp(Math.atan2(b, Rr) + Math.asin(clamp(a / Math.hypot(Rr, b), -1, 1)), .3, .75) };
    }
  }
}
// how soft the ground under a machine is (0 firm .. 1): loose tipped soil that hasn't been rolled yet, mud beside water, water
function softAt(x, z) {
  const k = cellOf(x, z); if (DECK[k] > 0 || M[k] === 2) return W[k] > .1 && !DECK[k] ? .3 : 0;
  let v = 0;
  if (H[k] - H0[k] > .15 && D[k]) v += COMP[k] & 1 ? .2 : .55;
  if (W[k] > .1) v += .5; else if (cMat[k * 4 + 3] > .2 && (D[k] || M[k] === 1)) v += .35;
  return Math.min(1, v);
}
function circlesOf(m, x, z, yaw) { return SPEC[m.type].circ.map(([oz, r]) => [x + Math.sin(yaw) * oz, z + Math.cos(yaw) * oz, r]); }
function overlap(m, x, z, yaw) {
  const A = circlesOf(m, x, z, yaw); let pen = 0;
  for (const o of machines) {
    if (o === m) continue;
    for (const b of circlesOf(o, o.x, o.z, o.yaw)) for (const a of A) {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < a[2] + b[2]) pen += a[2] + b[2] - d;
    }
  }
  return pen;
}
function separate(m, dt) {
  let px = 0, pz = 0;
  for (const o of machines) {
    if (o === m) continue;
    for (const b of circlesOf(o, o.x, o.z, o.yaw)) for (const a of circlesOf(m, m.x, m.z, m.yaw)) {
      const dx = a[0] - b[0], dz = a[1] - b[1], d = Math.hypot(dx, dz) || .01, pen = a[2] + b[2] - d;
      if (pen > 0) { px += dx / d * pen; pz += dz / d * pen; }
    }
  }
  const l = Math.hypot(px, pz); if (l < 1e-4) return;
  const st = Math.min(l, 1.2 * dt);
  m.x = clamp(m.x + px / l * st, 3, N - 4); m.z = clamp(m.z + pz / l * st, 3, N - 4);
}
// somewhere near x, z where a machine of this type fits without touching another
function freeSpot(type, x, z, yaw) {
  const probe = { type };
  for (let r = 0; r < 30; r += 3) for (let a = 0; a < 8; a++) {
    const px = clamp(x + Math.cos(a * .785) * r, 6, N - 7), pz = clamp(z + Math.sin(a * .785) * r, 6, N - 7);
    if (wetAt(px, pz) < .05 && overlap(probe, px, pz, yaw) === 0) return [px, pz];
    if (r === 0) break;
  }
  return [x, z];
}
// Where the ground would hold a machine: its height, pitch and roll (m.gy, m.gp, m.gr) worked out from the points that
// actually touch.
// A track is a stiff beam lying on the highest ground under it, so it bridges hollows, rides up over a hump and only tips
// forward once the machine's weight is past the crest. Each tyre rides at its own height (a wheel is round, so it rolls
// over a bump rather than stepping up it), the body sits on the axles, and on machines that bend in the middle the front
// frame rolls on its own axle.
const _gh = new Float32Array(5);
function groundPose(m) {
  const cy = Math.cos(m.yaw), sy = Math.sin(m.yaw);
  if (m.tracks) {
    let ss = 0, yA = 0, yB = 0;
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 5; i++) { const c = m.cp[t * 5 + i]; _gh[i] = gAt(m.x + cy * c.x + sy * c.z, m.z - sy * c.x + cy * c.z); }
      let best = -1e9, slope = 0;
      for (let i = 0; i < 2; i++) for (let j = 2; j < 5; j++) {
        const zi = m.cp[t * 5 + i].z, zj = m.cp[t * 5 + j].z, sl = (_gh[j] - _gh[i]) / (zj - zi), h0 = _gh[i] - sl * zi;
        if (h0 > best) { best = h0; slope = sl; }
      }
      ss += slope; if (t) yB = best; else yA = best;
    }
    m.gy = (yA + yB) / 2; m.gp = Math.atan(ss / 2); m.gr = Math.atan2(yA - yB, m.tracks[0].x - m.tracks[1].x); m.gtw = 0;
    return;
  }
  if (!m.cp || !m.cp.length) { m.gy = gAt(m.x, m.z); m.gp = m.gr = m.gtw = 0; return; }
  const A = m.hinge, ca = Math.cos(m.art), sa = Math.sin(m.art);
  // sums for the front and rear groups: n, height, z, then left (+x) and right heights and x
  let nF = 0, hF = 0, zF = 0, nR = 0, hR = 0, zR = 0, fl = 0, flx = 0, fln = 0, fr = 0, frx = 0, frn = 0, rl = 0, rlx = 0, rln = 0, rr = 0, rrx = 0, rrn = 0;
  for (const c of m.cp) {
    let lx = c.x, lz = c.z, dx = sy, dz = cy;
    if (c.f && A) { lx = c.x * ca + c.z * sa; lz = A.hz - c.x * sa + c.z * ca; dx = Math.sin(m.yaw + m.art); dz = Math.cos(m.yaw + m.art); }
    c.lx = lx; c.lz = lz;
    const wx = m.x + cy * lx + sy * lz, wz = m.z - sy * lx + cy * lz, d = c.r * .55, drop = c.r - Math.sqrt(c.r * c.r - d * d);
    const h = Math.max(gAt(wx, wz), gAt(wx + dx * d, wz + dz * d) - drop, gAt(wx - dx * d, wz - dz * d) - drop);
    c.gh = h;
    if (c.front) { nF++; hF += h; zF += lz; if (lx > 0) { fl += h; flx += lx; fln++; } else { fr += h; frx += lx; frn++; } }
    else { nR++; hR += h; zR += lz; if (lx > 0) { rl += h; rlx += lx; rln++; } else { rr += h; rrx += lx; rrn++; } }
  }
  if (!nF || !nR) { m.gy = (hF + hR) / (nF + nR); m.gp = m.gr = m.gtw = 0; for (const c of m.cp) c.res = 0; return; }
  hF /= nF; zF /= nF; hR /= nR; zR /= nR;
  const slope = (hF - hR) / (zF - zR);
  const qF = fln && frn ? (fl / fln - fr / frn) / (flx / fln - frx / frn) : 0, qR = rln && rrn ? (rl / rln - rr / rrn) / (rlx / rln - rrx / rrn) : qF;
  const qBody = A ? qR : (qF + qR) / 2;
  m.gy = hR - slope * zR; m.gp = Math.atan(slope); m.gr = Math.atan(qBody);
  m.gtw = A ? clamp(Math.atan(qF) - Math.atan(qR), -.2, .2) : 0;
  // how far each tyre sits above or below the frame it hangs from
  for (const c of m.cp) {
    const q = A ? (c.front ? qF : qR) : qBody, xm = c.front ? (flx + frx) / nF : (rlx + rrx) / nR;
    c.res = c.gh - ((c.front ? hF : hR) + q * (c.lx - xm) + slope * (c.lz - (c.front ? zF : zR)));
  }
}
function poseMachine(m, dt, inp) {
  const s = SPEC[m.type];
  groundPose(m);
  const y = m.gy;
  let impact = 0;
  if (dt > 0 && Math.hypot(m.x - (m.px ?? m.x), m.z - (m.pz ?? m.z)) < 3) {
    // rolling on a side slope or sitting in deep water wears the machine
    const tilt = Math.max(Math.abs(m.gr), Math.abs(m.gp) * .7);
    if (tilt > .52) hurt(m, (tilt - .52) * .08 * dt * (m.ai ? .15 : 1), m.x, m.y + 1, m.z, 'tilt');
    const wet = wetAt(m.x, m.z);
    if (wet > s.ford + .25) { hurt(m, (wet - s.ford) * .006 * dt, m.x, m.y + 1, m.z, 'water'); if (Math.random() < dt * 3) spawn('splash', m.x, m.y + s.ford + .4, m.z, 1, [.75, .8, .82], { jitter: s.wid * .6, up: .3 }); }
    // the yard's workshop slowly fixes whatever is parked there
    if (inYard(m.x, m.z) && Math.abs(m.v) < .1 && m.hp < 1) m.hp = Math.min(1, m.hp + dt * .01);
    // The ground pushes the machine up at once, but it can only come down as fast as it falls: off a ledge it drops and
    // lands, and over a crest it hangs level for a moment and then tips, rocking once as it comes down.
    const n = dt > .02 ? 2 : 1, h = dt / n, KP = s.tracks ? 85 : 70, CP = s.tracks ? 13 : 12;
    for (let i = 0; i < n; i++) {
      if (y >= m.y - .03) { const ny = m.y + (y - m.y) * (1 - Math.exp(-h * 22)); m.vy = Math.min(0, (ny - m.y) / h); m.y = ny; }
      else { m.vy -= 15 * h; m.y += m.vy * h; if (m.y <= y) { impact = Math.max(impact, -m.vy); m.y = y; m.vy = 0; } }
      m.pv += ((m.gp - m.pitch) * KP - m.pv * CP) * h; m.pitch += m.pv * h;
      m.rv += ((m.gr - m.roll) * KP - m.rv * CP) * h; m.roll += m.rv * h;
    }
    m.twist += (m.gtw - m.twist) * (1 - Math.exp(-dt * 10));
    if (!(Math.abs(m.pitch) < 1.3 && Math.abs(m.roll) < 1.3 && Math.abs(m.y) < 1e4)) { m.y = y; m.pitch = m.gp; m.roll = m.gr; m.pv = m.rv = m.vy = 0; }
    // dropping off a ledge is hard on a machine
    if (impact > 4.5) hurt(m, (impact * impact / 30 - .67) * .1 * (m.ai ? .2 : 1), m.x, y + .3, m.z, 'fall');
  } else { m.y = y; m.pitch = m.gp; m.roll = m.gr; m.twist = m.gtw || 0; m.pv = m.rv = m.vy = 0; }
  m.px = m.x; m.pz = m.z;
  // the body rocks back when pulling away, dips when stopping and leans in turns
  if (dt > 0) {
    const acc = clamp((m.v - m.lastV) / dt, -12, 12); m.lastV = m.v;
    const soft = s.tracks ? .007 : .015, lf = s.cap ? clamp(m.load.v / s.cap, 0, 1) : 0;
    // what the body is being asked to do: squat back under power, nose down under braking, lean out of turns...
    let tp = -acc * soft, tr = -m.v * inp.steer * soft * .9, ty = 0;
    // ...and the weight of the work: the dozer's nose digs in when the blade bites and when it shoves a full blade,
    // the loader tips forward under a full raised bucket, the hauler sits down on its springs under a load, and the
    // excavator is dragged toward its bucket
    if (m.type === 'dozer') tp += clamp(m.digSm * .012, 0, .03) + lf * .014 * (m.v > .2 ? 1 : .4);
    else if (m.type === 'loader') { tp += lf * (.012 + m.arm * .012) + clamp(m.digSm * .01, 0, .02); ty -= lf * .03; }
    else if (m.type === 'hauler') { tp -= lf * .012 + m.tip * .012; ty -= lf * .07; }
    else if (m.type === 'excavator') { const pull = clamp(m.digSm * .02, 0, .028) + lf * .008; tp += pull * Math.cos(m.swing); tr -= pull * Math.sin(m.swing); tr += clamp(((m.swing - (m.lastSwing ?? m.swing)) / dt - (m.swingRate || 0)) * .02, -.02, .02); m.swingRate = (m.swing - (m.lastSwing ?? m.swing)) / dt; m.lastSwing = m.swing; }
    // rough ground rocks it as it travels (tyres wallow, tracks rattle), and the engine pulling hard makes it shudder
    const sp = Math.abs(m.v), rough = s.tracks ? .006 : .012, ph = (m.x * 1.9 + m.z * 2.3);
    tp += Math.sin(ph) * rough * Math.min(1, sp / 2); tr += Math.sin(ph * .73 + 1.7) * rough * Math.min(1, sp / 2);
    tp = clamp(tp, -.075, .075); tr = clamp(tr, -.06, .06);
    // a sprung, well-damped body: a heavy machine settles in one small dip, it doesn't wallow
    const K = s.tracks ? 120 : 70, C = s.tracks ? 19 : 14, n = dt > .02 ? 2 : 1, h = dt / n;
    for (let i = 0; i < n; i++) {
      m.sPitchV = (m.sPitchV || 0) + ((tp - m.sPitch) * K - m.sPitchV * C) * h; m.sPitch += m.sPitchV * h;
      m.sRollV = (m.sRollV || 0) + ((tr - m.sRoll) * K - m.sRollV * C) * h; m.sRoll += m.sRollV * h;
      m.bobV = (m.bobV || 0) + ((ty - (m.bob || 0)) * K - m.bobV * C) * h; m.bob = (m.bob || 0) + m.bobV * h;
    }
    if (!(Math.abs(m.sPitch) < .2 && Math.abs(m.sRoll) < .2 && Math.abs(m.bob) < .5)) { m.sPitch = m.sRoll = m.bob = 0; m.sPitchV = m.sRollV = m.bobV = 0; }
    // dropping onto the ground after a ledge slams the suspension down
    if (impact > 2.4) { m.bobV -= impact * .05; quake(m.x, m.y, m.z, clamp(impact * .05, 0, .5)); snd.clang(m.x, m.y, m.z, 46, clamp(impact * .06, .1, .45)); dust(m.x, y + .2, m.z, 5, DIRT_C); }
    m.strain = lerp(m.strain || 0, clamp(Math.abs(inp.throttle) * clamp(1 - sp / (s.vmax * .6), 0, 1) * .7 + m.workSm, 0, 1), 1 - Math.exp(-dt * 4));
    m.steerVis = lerp(m.steerVis, inp.steer * (Math.abs(m.v) > .05 || inp.throttle ? 1 : .6), 1 - Math.exp(-dt * 3));
  }
  // the engine: a fine tremble at idle that turns into a heavy shudder when it's pulling
  const st = m.hp <= 0 ? 0 : .35 + (m.strain || 0) * 1.6 + m.workSm * .8, et = simTime * (44 + (m.strain || 0) * 9) + m.id * 3;
  const shake = Math.sin(et) * .0022 * st, shR = Math.sin(et * .5 + 1.3) * .0016 * st, shP = Math.sin(et * 1.31 + .4) * .0009 * st;
  m.group.position.set(m.x, m.y + shake + (m.bob || 0), m.z);
  m.group.rotation.set(-m.pitch + m.sPitch + shP, m.yaw, m.roll + m.sRoll + shR, 'YXZ');
  m.swayed = true;
  // the front frame swings at the hinge and rolls on its own axle; front wheels turn; every tyre stays on the ground
  // while the body squats and leans above it, and flattens a little under the weight it carries
  if (m.front) m.front.rotation.set(0, m.hinge ? m.art : 0, m.twist || 0);
  if (m.cp) {
    const lf = s.cap ? clamp(m.load.v / s.cap, 0, 1) : 0, bob = m.bob || 0;
    for (const c of m.cp) {
      if (!c.h) continue;
      const heavy = m.type === 'loader' ? c.front : m.type === 'hauler' ? !c.front : true, sq = .025 + (heavy ? .04 * lf : 0) + clamp(-bob * .25, 0, .02);
      c.h.position.y = c.y0 + clamp(c.res || 0, -.3, .3) - bob + m.sPitch * (c.lz ?? c.z) - m.sRoll * (c.lx ?? c.x) - c.r * sq;
      c.h.scale.set(1 + sq * .6, 1 - sq, 1);
      if (!m.hinge && c.front) c.h.rotation.y = m.art;
    }
  }
  m.group.updateMatrixWorld(true);
  for (const r of m.rams) r.update();
  m.mats.U.uGround.value = m.y; m.mats.U.uGrime.value = m.grime; m.mats.U.uDmg.value = 1 - m.hp;
}
const _w = new THREE.Vector3();
function machineFx(m, dt, isActive) {
  // exhaust: a light haze at idle, dark puffs when the engine is pulling
  const s = SPEC[m.type], load = clamp((isActive ? Math.abs(m.ctl.throttle) * .6 : 0) + m.workSm + (m.strain || 0) * .3, 0, 1);
  const thr = isActive && m.hp > 0 ? Math.abs(m.ctl.throttle) : 0;
  if (thr > .5 && (m.lastThr || 0) <= .5 && simTime - (m.belchT || -9) > 1.2) {
    m.belchT = simTime; m.exhaust.getWorldPosition(_w);
    spawn('smoke', _w.x, _w.y, _w.z, 7, [.1, .1, .1], { jitter: .15, size: 1.5, alpha: .8, up: 1.5 });
  }
  m.lastThr = thr;
  m.smokeAcc += dt * (1.5 + load * 14 + (isActive ? Math.abs(m.v) / s.vmax * 4 : 0));
  if (m.smokeAcc >= 1) {
    const n = Math.floor(m.smokeAcc); m.smokeAcc -= n;
    m.exhaust.getWorldPosition(_w);
    const g = lerp(.55, .16, load);
    spawn('smoke', _w.x, _w.y, _w.z, n, [g, g, g * .98], { jitter: .1, size: .7 + load * .8, alpha: .35 + load * .5 });
  }
  // a damaged engine smokes grey, then black; a broken one just smoulders
  if (m.hp < .6) {
    m.dmgSmoke = (m.dmgSmoke || 0) + dt * (m.hp <= 0 ? 3 : (.6 - m.hp) * 14);
    if (m.dmgSmoke >= 1) {
      m.dmgSmoke = 0; m.exhaust.getWorldPosition(_w);
      const g = m.hp < .25 ? .08 : .3;
      spawn('smoke', _w.x, _w.y, _w.z, 1, [g, g, g], { jitter: .5, size: 1.1, alpha: .6 });
    }
  }
  // soil boils off the ends of a cutting blade, and a full bucket on the move sheds a little
  if (m.type === 'dozer' && m.digSm > .25 && m.v > .3) {
    const grav = m.digGSm > m.digSm * .5, col = grav ? [.55, .53, .5] : [.33, .23, .15], n = Math.min(4, Math.floor(m.digSm * dt * 14 + Math.random()));
    for (let q = 0; q < n; q++) {
      const sx = Math.random() < .5 ? -1 : 1, out = (1.5 + Math.random() * 2) * sx;
      _w.set(sx * 1.95, m.blade + .15 + Math.random() * .5, 2.85); m.group.localToWorld(_w);
      spawn('grain', _w.x, _w.y, _w.z, 2, col, { jitter: .25, vx: Math.cos(m.yaw) * out + Math.sin(m.yaw) * m.v, vz: -Math.sin(m.yaw) * out + Math.cos(m.yaw) * m.v, up: -3.5, size: .9 });
      if (Math.random() < .25) chunks(_w.x, _w.y + .2, _w.z, 1, grav, Math.cos(m.yaw) * out * .7 + Math.sin(m.yaw) * m.v, -Math.sin(m.yaw) * out * .7 + Math.cos(m.yaw) * m.v, .3);
    }
    if (Math.random() < dt * 6) { _w.set(0, m.blade + .2, 3.0); m.group.localToWorld(_w); spawn('dust', _w.x, _w.y, _w.z, 1, grav ? GRAVEL_C : DIRT_C, { jitter: 3, alpha: .4, size: 1.1 }); }
  }
  if ((m.type === 'excavator' || m.type === 'loader') && m.load.v > .3 && m.bucket && Math.random() < dt * (m.type === 'excavator' ? 5 + Math.abs(m.swingRate || 0) * 14 : Math.abs(m.v) * 1.6)) {
    _w.set((Math.random() - .5) * (m.type === 'loader' ? 2.4 : .8), 0, m.type === 'loader' ? .8 : .7); m.bucket.localToWorld(_w);
    spawn('grain', _w.x, _w.y, _w.z, 2, m.load.g > m.load.v * .5 ? [.55, .53, .5] : [.33, .23, .15], { jitter: .3, size: .8 });
  }
  m.mats.glass.opacity = cabView && m === machines[active] ? .06 : .32;
  for (const b of m.beacons) b.material.emissiveIntensity = isActive ? (Math.sin(simTime * 9) > .55 ? 4 : .25) : .1;
  // driving through water throws spray
  if (Math.abs(m.v) > .8 && wetAt(m.x, m.z) > .15) {
    m.splashT -= dt;
    spawn('splash', m.x, m.y + .3, m.z, 2, [.75, .8, .82], { jitter: s.wid });
    if (m.splashT <= 0) { m.splashT = .7; snd.splash(m.x, m.y, m.z, Math.min(1, Math.abs(m.v) / 3)); }
    m.grime = Math.max(.12, m.grime - dt * .04);
  }
}

// ---------------------------------------------------------------- damage: knocks, falls, rolling and flooding wear a machine
// out. Below half it loses power and smokes; at nothing it breaks down until the mechanic fixes it.
function hurt(m, amt, x = m.x, y = m.y + 1, z = m.z, why = '?') {
  if (amt <= 0 || m.hp <= 0) return;
  if (window.GW_DMG) { const l = m.dmgLog || (m.dmgLog = {}); l[why] = (l[why] || 0) + amt; }
  const was = m.hp; m.hp = Math.max(0, m.hp - amt);
  if (amt > .006 && simTime - m.hurtT > .25) {
    m.hurtT = simTime;
    snd.clang(x, y, z, 70 + Math.random() * 90, clamp(amt * 12, .12, .6));
    quake(x, y, z, clamp(amt * 25, .15, .9));
    spawn('spark', x, y, z, Math.ceil(clamp(amt * 400, 3, 18)), [1, .72, .32], { jitter: .4 });
  }
  const name = SPEC[m.type].name;
  if (was > .5 && m.hp <= .5) say(m, name + ' damaged');
  if (was > .2 && m.hp <= .2) say(m, name + ' badly damaged');
  if (was > 0 && m.hp <= 0) { toast(name + ' broken down', 2600); m.v = 0; }
}
const _p = new THREE.Vector3(), _p2 = new THREE.Vector3();
function drive(m, dt, inp) {
  const s = SPEC[m.type];
  let target = inp.throttle * s.vmax;
  const dir = Math.sign(Math.abs(m.v) > .05 ? m.v : target) || 1;
  const fx = fwdX(m.yaw), fz = fwdZ(m.yaw);
  const L = s.len / 2;
  let hA = gAt(m.x + fx * L * dir, m.z + fz * L * dir); const hB = gAt(m.x - fx * L * dir, m.z - fz * L * dir);
  // a dozer with its blade down doesn't climb the heap in front: the blade shoves it (only the ground up to the edge counts)
  if (m.type === 'dozer' && dir > 0 && m.blade < .4) hA = Math.min(hA, m.y + m.blade + .35);
  const grade = (hA - hB) / s.len;
  let lim = 1;
  if (grade > .35) lim = Math.max(0, 1 - (grade - .35) / .45);
  lim *= Math.max(.15, 1 - wetAt(m.x, m.z) / (s.ford * 2.2));
  const lf = s.cap ? clamp(m.load.v / s.cap, 0, 1) : 0, soft = softAt(m.x, m.z), thr = m.hp <= 0 ? 0 : inp.throttle;
  if (m.type === 'dozer') lim *= 1 - .35 * m.load.v / s.cap;
  if (m.type === 'hauler') lim *= 1 - .25 * m.load.v / s.cap;
  // skid steering scrubs speed off: one track is held back to turn
  if (s.tracks) lim *= 1 - .22 * Math.min(1, Math.abs(m.om) / s.turn);
  const power = m.hp <= 0 ? 0 : .55 + .45 * Math.min(1, m.hp / .5);   // a damaged machine loses power
  target *= lim * power;
  if (grade > .2 && Math.abs(thr) > 0) m.work = Math.max(m.work, clamp(grade * 1.5, 0, .8));
  // ---- speed. The engine pulls hardest when the machine is well short of the speed asked for and eases off as it gets
  // there; weight on a slope pulls it back (or on); soft ground and a biting blade drag on it; a load makes it slower off
  // the mark and longer to stop.
  const mass = 1 + (m.type === 'hauler' ? .55 : m.type === 'loader' ? .2 : 0) * lf;
  const GS = 9.8 * .42, gs = GS * Math.sin(clamp(m.pitch, -.9, .9));          // what the slope takes from forward speed (m/s²)
  let drag = soft * .7 + (m.type === 'dozer' && m.v > 0 ? Math.min(1.2, m.digSm * .9) : 0);
  const v0 = m.v;
  if (thr !== 0) {
    m.brake = 0;
    const span = s.vmax * .22, pull = clamp((target - m.v) / span, -1, 1) * s.acc / mass;
    drag = Math.min(drag, .3 * Math.abs(target) / span * s.acc / mass);   // (drag slows it, it never stalls it outright)
    m.v += (pull - gs) * dt;
    // it can't be dragged backwards while it's trying to go forwards: the tracks or tyres just spin and dig
    if (thr * m.v < 0 && thr * v0 >= 0) m.v = 0;
  } else {
    // off the throttle it rolls on for a moment while the brakes come on, then they haul it down and hold it
    m.brake = Math.min(1, m.brake + dt / (s.tracks ? .18 : .4));
    drag += lerp(.7, s.acc * 1.6 / mass, m.brake);
    m.v -= gs * dt;
    // too steep for the brakes to hold: it creeps down with everything locked
    const sp = Math.sin(clamp(m.pitch, -.9, .9)), hold = (s.tracks ? .52 : .36) - soft * .06;
    if (Math.abs(sp) > hold && Math.abs(m.v) < 2) { drag = Math.min(drag, GS * hold); m.work = Math.max(m.work, .3); }
  }
  { const dv = drag * dt; m.v = Math.abs(m.v) <= dv ? 0 : m.v - Math.sign(m.v) * dv; }
  if (!(Math.abs(m.v) < 40)) m.v = 0;
  // how much the tracks or tyres are slipping: bogged in soft ground, shoving a full blade or clawing up a bank they turn
  // faster than the machine moves
  const bog = clamp(soft * .6 + (m.type === 'dozer' ? lf * .5 + Math.min(.5, m.digSm * .5) : 0) + Math.max(0, grade * dir) * 1.6, 0, 1);
  m.slipV = thr !== 0 ? (thr * s.vmax * power - m.v) * .4 * bog : 0;
  if (Math.abs(m.slipV) > .5) m.work = Math.max(m.work, .7);
  // ---- steering
  let yaw = m.yaw, nx, nz;
  if (s.tracks) {
    // skid steer: the turn builds up and dies away (it's a heavy thing to swing), and soft ground or a loaded blade
    // dug into the dirt makes it harder to slew
    const grip = (1 - .25 * soft) * (m.type === 'dozer' ? 1 - .3 * lf * (m.blade < .3 ? 1 : .3) : 1) * power;
    m.om += (inp.steer * s.turn * grip - m.om) * (1 - Math.exp(-dt * 6));
    if (Math.abs(m.om) < 1e-4 && inp.steer === 0) m.om = 0;
    if (inp.steer !== 0) m.work = Math.max(m.work, Math.abs(inp.steer) * (.35 + .3 * soft));
    yaw += m.om * dt;
    nx = m.x + fwdX(yaw) * m.v * dt; nz = m.z + fwdZ(yaw) * m.v * dt;
  } else if (m.hinge) {
    // articulated: rams bend the machine in the middle. The rear axle rolls straight ahead on its own heading, the
    // front frame swings; bending it while standing still walks both ends sideways.
    const A = m.hinge, g0 = m.art, rate = (Math.abs(m.v) > .3 ? 1.15 : .8) * power;
    m.art += clamp(inp.steer * A.max - m.art, -rate * dt, rate * dt);
    const gd = dt > 0 ? (m.art - g0) / dt : 0;
    m.om = (m.v * Math.sin(m.art) - A.a * gd) / (A.b * Math.cos(m.art) + A.a);
    if (gd !== 0) m.hyd = Math.max(m.hyd, .5);
    yaw += m.om * dt;
    nx = m.x - fx * A.b0 + fwdX(yaw) * (m.v * dt + A.b0); nz = m.z - fz * A.b0 + fwdZ(yaw) * (m.v * dt + A.b0);
  } else {
    // front-wheel steering: the wheels take a moment to come round
    m.art += clamp(inp.steer * .55 - m.art, -1.8 * dt, 1.8 * dt);
    m.om = (m.v / s.wb) * Math.tan(m.art);
    yaw += m.om * dt;
    nx = m.x + fwdX(yaw) * m.v * dt; nz = m.z + fwdZ(yaw) * m.v * dt;
  }
  // ---- across a very steep bank the whole machine slides sideways downhill
  {
    const sr = Math.sin(clamp(m.roll, -1, 1)), hold = (s.tracks ? .44 : .38) - soft * .08;
    if (Math.abs(sr) > hold) { m.vs = clamp(m.vs - Math.sign(sr) * 9.8 * (Math.abs(sr) - hold) * 1.2 * dt, -2.5, 2.5); m.work = Math.max(m.work, .4); }
    else m.vs *= Math.exp(-dt * 7);
    if (Math.abs(m.vs) < .02) m.vs = 0;
    nx += Math.cos(yaw) * m.vs * dt; nz -= Math.sin(yaw) * m.vs * dt;
  }
  nx = clamp(nx, 3, N - 4); nz = clamp(nz, 3, N - 4);
  const before = overlap(m, m.x, m.z, m.yaw);
  // two machines already caught inside each other (dropped off together, or shoved) ease apart instead of locking up
  if (before > .05) separate(m, dt);
  const after = overlap(m, nx, nz, yaw);
  if (after > before + 1e-4) {
    if (Math.abs(m.v) > 2.2) {   // ran into another machine (a nudge at walking pace does no harm)
      const o = machines.reduce((a, q) => q !== m && Math.hypot(q.x - m.x, q.z - m.z) < Math.hypot(a.x - m.x, a.z - m.z) ? q : a, machines.find(q => q !== m) || m);
      // the crew drive carefully (their bumps are the planner's, not real crashes): only the player's knocks count
      const pl = boss ? null : machines[active], imp = (m === pl || o === pl) ? (Math.abs(m.v) - 2.2) * .018 : 0, hx = (m.x + o.x) / 2, hz = (m.z + o.z) / 2;
      hurt(m, imp, hx, m.y + 1, hz, 'bump'); if (o !== m) hurt(o, imp * .6, hx, o.y + 1, hz, 'bumped');
    }
    m.v = 0; m.vs = 0; m.om = 0; m.slipV = 0; m.trackSpeed = 0; m.blocked = 'machine'; return;
  }
  m.blocked = '';
  // too deep: the machine won't move its nose (or tail, backing up) into water deeper than it can ford
  if (m.v !== 0 || m.vs !== 0) {
    const sg = Math.sign(m.v) || 1, reach = L + .4;
    const depthAt = (x, z, y) => wetAt(x + Math.sin(y) * reach * sg, z + Math.cos(y) * reach * sg);
    const dNew = depthAt(nx, nz, yaw);
    if (dNew > s.ford && dNew > depthAt(m.x, m.z, m.yaw) - .005) {
      m.v = 0; m.vs = 0; m.om = 0; m.slipV = 0; m.trackSpeed = 0;
      if (simTime - (m.deepT || -9) > 3) { m.deepT = simTime; say(m, `Too deep for the ${s.name.toLowerCase()}`); }
      m.blocked = 'deep';
      return;
    }
  }
  const dist = m.v * dt, dyaw = angWrap(yaw - m.yaw), slide = Math.abs(m.vs) * dt, spin = m.slipV * dt;
  m.x = nx; m.z = nz; m.yaw = yaw;
  // every tyre and each track turns at exactly the speed the ground passes under it (the outside of a turn runs faster,
  // the inside slower or backwards), plus whatever it is slipping
  if (m.tracks) {
    const dl = dist - dyaw * m.tracks[0].x + spin, dr = dist - dyaw * m.tracks[1].x + spin;
    m.tracks[0].update(dl); m.tracks[1].update(dr);
    m.trackSpeed = Math.max(Math.abs(dl), Math.abs(dr)) / Math.max(dt, 1e-3);
  } else {
    m.trackSpeed = 0;
    const dart = m.hinge ? m.art - (m.artWas ?? m.art) : 0; m.artWas = m.art;
    for (const c of m.cp) if (c.w) c.w.rotation.x += (dist - (dyaw + (c.f ? dart : 0)) * c.x + spin) / c.r;
    if (m.drum && m.type === 'roller') m.drum.rotation.x += (dist + spin) / .78;
  }
  if (Math.abs(dist) + Math.abs(dyaw) + slide < 1e-4) return;
  const cs = circlesOf(m, m.x, m.z, m.yaw);
  // knock trees over
  if (Math.abs(m.v) > .15 || Math.abs(dyaw) > .002) {
    for (const t of trees) {
      if (t.st !== 0) continue;
      for (const c of cs) if (Math.abs(t.x - c[0]) < c[2] + .6 && Math.abs(t.z - c[1]) < c[2] + .6 && Math.hypot(t.x - c[0], t.z - c[1]) < c[2] + .5) {
        treeFall(t, m.x, m.z);
        // a tree is hard on a machine; a dozer with its blade down is built for it
        const guard = (m.type === 'dozer' && m.blade < .6 ? .25 : 1) * (m.ai ? .3 : 1);   // the crew pick their way through
        hurt(m, (.004 + Math.abs(m.v) * .006) * t.s * guard, t.x, t.y + 1.5, t.z, 'tree');
        break;
      }
    }
  }
  pushLogs(m, cs);
  // shove boulders aside
  for (const rk of rocks) {
    for (const c of cs) {
      const dx = rk.x - c[0], dz = rk.z - c[1], need = c[2] + rk.s * .9;
      if (Math.abs(dx) > need || Math.abs(dz) > need) continue;
      const d = Math.hypot(dx, dz) || .01;
      if (d < need) {
        const push = need - d;
        rk.x = clamp(rk.x + dx / d * push, 2, N - 3); rk.z = clamp(rk.z + dz / d * push, 2, N - 3);
        rk.rx += push / rk.s; rk.ry += push * .3 / rk.s; rk.dirty = true;
        if (Math.abs(m.v) > 2.2 && !(m.type === 'dozer' && m.blade < .6)) hurt(m, (Math.abs(m.v) - 2.2) * .01 * rk.s * dt * 30, rk.x, hAt(rk.x, rk.z) + .5, rk.z, 'rock');
        m.work = Math.max(m.work, .5);
      }
    }
  }
  // rolling over fill compacts it
  for (const [cx, cz, r] of cs) cellsInCircle(cx, cz, r * .8, k => { COMP[k] |= 1; });
  // wheels and tracks wear the grass off where they run
  const pts = s.tracks ? [[1.2, 1.6], [-1.2, 1.6], [1.2, -1.6], [-1.2, -1.6], [1.2, 0], [-1.2, 0]]
    : m.type === 'hauler' ? [[1.3, 3.1], [-1.3, 3.1], [1.3, -.8], [-1.3, -.8], [1.3, -2.9], [-1.3, -2.9]] : [[1.18, 1.3], [-1.18, 1.3], [1.18, -1.6], [-1.18, -1.6]];
  const chance = Math.abs(dist) * (s.tracks ? .9 : .5) + Math.abs(dyaw) * (s.tracks ? 3 : 0);
  for (const [px, pz] of pts) {
    const wx = m.x + Math.cos(m.yaw) * px + Math.sin(m.yaw) * pz, wz = m.z - Math.sin(m.yaw) * px + Math.cos(m.yaw) * pz;
    const k = cellOf(wx, wz);
    // ruts: the first time a track or tyre runs over loose tipped soil or mud it presses it down (bit 2 of COMP: done)
    if (!(COMP[k] & 2) && M[k] === 1 && D[k] && DECK[k] === 0 && W[k] < .05) {
      const spoil = H[k] - H0[k], wetK = cMat[k * 4 + 3] > .2;
      const press = Math.min(H[k] - BED[k], (spoil > .08 ? Math.min(.07, spoil * .14) : 0) + (wetK ? .035 : 0)) * (s.tracks ? 1 : 1.2);
      COMP[k] |= 2;
      if (press > .004) { H[k] -= press; dirty(k); if (wetK && Math.random() < .5) spawn('grain', wx, H[k] + .15, wz, 2, [.2, .15, .1], { jitter: .5, up: 1.5, size: .9 }); }
    }
    if (Math.random() > chance) continue;
    if (M[k] === 0 && !D[k]) { D[k] = 1; dirty(k); }
  }
  leavePrints(m, dist, dyaw);
  // dust rolls up behind the tracks or wheels on dry bare ground, and they fling a little soil
  const sp = Math.abs(m.v) + Math.abs(dyaw) / Math.max(dt, 1e-3) * (s.tracks ? 1.5 : 0);
  if (sp > .6) {
    const back = -Math.sign(m.v || 1), rear = s.tracks ? 1.9 : m.type === 'hauler' ? 3.5 : 2.2, hw = s.wid * .4;
    for (const sx of [-1, 1]) {
      const wx = m.x + Math.cos(m.yaw) * sx * hw + fx * rear * back, wz = m.z - Math.sin(m.yaw) * sx * hw + fz * rear * back, k = cellOf(wx, wz);
      if (W[k] > .03 || DECK[k] > 0) continue;
      const bare = M[k] === 2 || M[k] === 1 || D[k] ? 1 : .12, gy = hAt(wx, wz);
      if (Math.random() < dt * sp * 2.4 * bare) spawn('dust', wx, gy + .15, wz, 1, M[k] === 2 ? GRAVEL_C : bare < 1 ? [.5, .47, .36] : DIRT_C, { alpha: .25 + Math.min(.3, sp * .04), size: .6 + sp * .09, vx: -fx * m.v * .25, vz: -fz * m.v * .25 });
      if (bare === 1 && sp > 1.2 && Math.random() < dt * sp * 1.6) spawn('grain', wx, gy + .12, wz, 2, M[k] === 2 ? [.55, .53, .5] : [.3, .21, .14], { jitter: .45, vx: -fx * m.v * .3, vz: -fz * m.v * .3, up: -3, size: .7 });
    }
  }
}

function toolDozer(m, dt, inp) {
  const s = SPEC.dozer;
  m.blade = clamp(m.blade + inp.tool * .8 * dt, -.6, 1.2);
  m.hyd = Math.max(m.hyd, Math.abs(inp.tool));
  m.blade3.position.y = m.blade;
  m.group.updateMatrixWorld();
  if (simTime - (m.noCut ?? -9) < .5) return;   // lent out to grade a building pad: the grading is done for it
  if (m.v > .1) {
    const rate = 1.4 * m.v * dt;
    for (let sx = -1.75; sx <= 1.76; sx += .5) {
      _p.set(sx, m.blade, 2.75); m.group.localToWorld(_p);
      const k = cellOf(_p.x, _p.z);
      const over = H[k] - _p.y;
      if (over > .02 && m.load.v < s.cap * 1.4) {
        const a = Math.min(over, rate, H[k] - BED[k]);
        if (a > 0) { if (M[k] === 2) m.digG += a; takeFrom(m.load, k, a); m.dig += a; m.work = Math.max(m.work, .85); }
      } else if (over > .02) {
        // a full blade bulldozes whatever stands in front of it: the heap rolls on ahead instead of passing through
        _p2.set(sx, m.blade, 3.9); m.group.localToWorld(_p2);
        const k2 = cellOf(_p2.x, _p2.z);
        const a = Math.min(over, 3.2 * m.v * dt + .01, H[k] - BED[k]);
        if (k2 !== k && a > 0) {
          H[k] -= a; H[k2] += a; if (M[k2] !== M[k] && M[k] !== 0) M[k2] = M[k]; if (M[k] === 0) M[k] = 1; D[k] = D[k2] = 1;
          dirty(k); dirty(k2); m.work = 1;
          if (treeGrid[k2] >= 0) treeFallAt(k2);
        }
      } else if (over < -.05 && m.load.v > 0) {
        giveTo(m.load, k, Math.min(-over, rate, m.load.v / 6));
      }
    }
    if (m.load.v > s.cap) {   // spill off the blade ends
      const spill = Math.min(m.load.v - s.cap, 2.5 * dt);
      for (const sx of [-2.2, 2.2]) {
        _p.set(sx, 0, 2.6); m.group.localToWorld(_p); dropCircle(m.load, _p.x, _p.z, 1.1, spill / 2);
        if (Math.random() < dt * 10) chunks(_p.x, _p.y + .8, _p.z, 2, loadMat(m.load) === 2);
      }
    }
    // soil rolls and tumbles off the face of the heap in front of the blade
    if (m.load.v > .4) {
      const n = Math.min(6, Math.floor(m.v * dt * 25 * Math.min(1, m.load.v / 3) + Math.random()));
      const top = Math.cbrt(m.load.v / 1.25) * .8;
      for (let q = 0; q < n; q++) { _p.set((Math.random() - .5) * 3.2, m.blade + top * (.5 + Math.random() * .5), 2.9 + top * .5); m.group.localToWorld(_p); spawn('grain', _p.x, _p.y, _p.z, 1, loadMat(m.load) === 2 ? [.55, .53, .5] : [.36, .26, .17], { jitter: .2, vx: Math.sin(m.yaw) * (m.v + .8), vz: Math.cos(m.yaw) * (m.v + .8), up: .3, size: .8 }); }
    }
    if (m.load.v > .3 && Math.random() < dt * 9) { _p.set(0, m.blade + .4, 3.3); m.group.localToWorld(_p); dust(_p.x, _p.y, _p.z, 2, loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C); }
    if (m.load.v > 1.5 && Math.random() < dt * 7) { _p.set((Math.random() - .5) * 3, m.blade + 1.4, 3.0); m.group.localToWorld(_p); chunks(_p.x, _p.y, _p.z, 1, loadMat(m.load) === 2, Math.sin(m.yaw) * m.v, Math.cos(m.yaw) * m.v, .3); }
  } else if (m.v < -.05 && m.load.v > 0) {
    _p.set(0, 0, 3.2); m.group.localToWorld(_p);
    m.pour += dropCircle(m.load, _p.x, _p.z, 1.9, Math.min(m.load.v, 4 * dt));
    m.pourG = loadMat(m.load) === 2;
  }
  const v = m.load.v;
  m.pile.visible = v > .05;
  if (m.pile.visible) {
    const sc = Math.cbrt(v / 1.25);
    m.pile.scale.set(sc * 1.15, sc * .9, sc);
    m.pile.position.set(0, m.blade, .5 + sc * .55);
    m.pile.material = loadMat(m.load) === 2 ? LOADMAT.gravel : LOADMAT.dirt;
  }
}
const _hb = new THREE.Vector3();
function haulerNear(x, z, r) {
  for (const o of machines) if (o.type === 'hauler') {
    _hb.set(0, 2.3, -1.5); o.group.localToWorld(_hb);   // (its own vector: callers keep using _p afterwards)
    if (Math.hypot(_hb.x - x, _hb.z - z) < r) return o;
  }
  return null;
}
function toolLoader(m, dt, inp) {
  const s = SPEC.loader;
  m.arm = clamp(m.arm + inp.tool * .55 * dt, -.15, 1);
  m.hyd = Math.max(m.hyd, Math.abs(inp.tool), m.dumpT > 0 ? .8 : 0);
  const a = -.62 + m.arm * 1.57;
  m.arms.rotation.x = -a;
  let tilt = m.arm > .45 ? -.25 : 0;
  if (m.dumpT > 0) { m.dumpT -= dt; tilt = 1.15 * Math.sin(clamp(1 - m.dumpT / .9, 0, 1) * Math.PI); }
  m.bucket.rotation.x = a + tilt;
  m.group.updateMatrixWorld();
  if (m.v > .1 && m.load.v < s.cap && m.arm < .2) {
    const rate = 1.6 * m.v * dt;
    for (let sx = -1.3; sx <= 1.31; sx += .43) {
      _p.set(sx, -.45, .97); m.bucket.localToWorld(_p);
      const k = cellOf(_p.x, _p.z);
      const over = H[k] - _p.y;
      if (over > .02) {
        const room = s.cap - m.load.v;
        const amt = Math.min(over, rate, room / SWELL, H[k] - BED[k]);
        if (amt > 0) { if (M[k] === 2) m.digG += amt; takeFrom(m.load, k, amt); m.dig += amt; m.work = Math.max(m.work, .9); }
      }
    }
    if (m.dig > 0 && Math.random() < dt * 8) { _p.set(0, 0, 1.2); m.bucket.localToWorld(_p); dust(_p.x, _p.y, _p.z, 2, m.digG > 0 ? GRAVEL_C : DIRT_C); }
  }
  // the stream of dirt falling out while the bucket tips
  if (m.pourT > 0) {
    m.pourT -= dt;
    _p.set(0, -.3, 1.0); m.bucket.localToWorld(_p);
    chunks(_p.x, _p.y, _p.z, Math.ceil(dt * 90), m.pourG, 0, 0, 1.6);
    m.pour += dt * 4;
  }
  if (inp.act) {
    if (m.load.v < .05) say(m, isTouch ? 'Lower bucket into dirt' : 'Lower bucket into dirt <kbd>F</kbd>');
    else if (m.dumpT <= 0) {
      m.dumpT = .9;
      _p.set(0, -.45, .97); m.bucket.localToWorld(_p);
      const h = haulerNear(_p.x, _p.z, 3.4);
      const vol = m.load.v, grav = loadMat(m.load) === 2;
      m.pourT = .55; m.pourG = grav;
      if (h && m.arm > .55) {
        const got = transfer(m.load, h.load, SPEC.hauler.cap);
        if (got <= 0) say(m, 'Hauler full');
        else { dust(_p.x, _p.y - 1, _p.z, 14, grav ? GRAVEL_C : DIRT_C); snd.dump(_p.x, _p.y - 1, _p.z, got, grav); snd.clang(_p.x, _p.y - 1, _p.z, 95, .25); }
      } else {
        if (h) say(m, isTouch ? 'Raise bucket higher' : 'Raise bucket higher <kbd>R</kbd>');
        dropCircle(m.load, _p.x, _p.z, 1.6, m.load.v, .7);
        dust(_p.x, hAt(_p.x, _p.z) + .5, _p.z, 16, grav ? GRAVEL_C : DIRT_C);
        snd.dump(_p.x, hAt(_p.x, _p.z), _p.z, vol, grav);
      }
    }
  }
  const f = m.load.v / s.cap;
  m.bucketLoad.visible = f > .02;
  m.bucketLoad.scale.set(1, Math.max(.05, f * 1.35), 1);
  m.bucketLoad.material = loadMat(m.load) === 2 ? LOADMAT.gravel : LOADMAT.dirt;
}
function toolExcavator(m, dt, inp) {
  const s = SPEC.excavator;
  const fast = m.ai ? 1.6 : 1, cap = s.cap * (m.ai ? 1.5 : 1);   // crew operators: quicker, with a bigger bucket
  m.swing += inp.swing * 1.1 * fast * dt;
  m.reach = clamp(m.reach + inp.tool * 2.4 * fast * dt, 3.2, 7.6);
  m.hyd = Math.max(m.hyd, Math.abs(inp.swing), Math.abs(inp.tool) * .8, m.act >= 0 ? .9 : 0);
  m.house.rotation.y = m.swing;
  const a = m.yaw + m.swing, R = m.reach + 1.0;
  const tx = m.x + Math.sin(a) * R, tz = m.z + Math.cos(a) * R;
  const g = hAt(tx, tz);
  const truck = haulerNear(tx, tz, 3.2);
  const hover = Math.max(g + 2.4, truck ? truck.y + 4.4 : -1e9);
  let y = hover, curlT = m.load.v > .05 ? -.9 : .15;
  if (inp.act && m.act < 0) { m.act = 0; m.did = false; m.mode = m.load.v > .05 ? 'dump' : 'dig'; }
  if (m.act >= 0) {
    m.act += dt * fast / 1.1;
    const p = Math.min(1, m.act), dip = Math.sin(p * Math.PI);
    const low = m.mode === 'dig' ? g - .4 : hover - .7;
    y = hover + (low - hover) * dip;
    if (m.mode === 'dump' && p > .35) curlT = .95;
    if (m.mode === 'dig') curlT = p < .5 ? .5 : -.9;
    m.work = Math.max(m.work, m.mode === 'dig' ? .9 : .5);
    if (!m.did && p >= .5) {
      m.did = true;
      if (m.mode === 'dig') {
        const gBefore = m.load.g;
        const got = cutCircle(m.load, tx, tz, 1.45, g - 1.2, cap);
        if (got < .05) say(m, 'Rock below. Too hard to dig');
        else { m.dig += got; m.digG += m.load.g - gBefore; snd.scoop(tx, g, tz, loadMat(m.load) === 2); }
        dust(tx, g + .3, tz, 12, loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C);
      } else {
        const grav = loadMat(m.load) === 2, vol = m.load.v;
        _p.set(0, .2, .5); m.bucket.localToWorld(_p);
        chunks(_p.x, _p.y, _p.z, 26, grav, 0, 0, .9);
        if (truck) {
          const got = transfer(m.load, truck.load, SPEC.hauler.cap);
          if (got <= 0) say(m, 'Hauler full');
          else { snd.dump(tx, truck.y + 2.5, tz, got, grav); snd.clang(tx, truck.y + 2, tz, 90, .3); }
          dust(tx, truck.y + 3, tz, 12, grav ? GRAVEL_C : DIRT_C);
        } else {
          dropCircle(m.load, tx, tz, 1.4, m.load.v, .6);
          dust(tx, g + .5, tz, 14, grav ? GRAVEL_C : DIRT_C);
          snd.dump(tx, g, tz, vol, grav);
        }
      }
    }
    if (m.act >= 1) m.act = -1;
  }
  m.curl = lerp(m.curl, curlT, 1 - Math.exp(-dt * 6));
  const L1 = 4.6, L2 = 3.3;
  const ty = y + 1.0 - (m.y + 2.15), r = m.reach;
  let d = clamp(Math.hypot(r, ty), 1.6, L1 + L2 - .05);
  const phi = Math.atan2(ty, r);
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const B = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const t1 = phi + A, t2 = -(Math.PI - B);
  m.boom.rotation.x = -t1; m.stick.rotation.x = -t2;
  m.bucket.rotation.x = -(-Math.PI / 2 + m.curl - t1 - t2);
  m.target = [tx, g, tz];
  const f = m.load.v / cap;
  m.bucketLoad.visible = f > .02;
  m.bucketLoad.scale.set(1, Math.max(.05, f), 1);
  m.bucketLoad.material = loadMat(m.load) === 2 ? LOADMAT.gravel : LOADMAT.dirt;
}
function toolHauler(m, dt, inp) {
  const s = SPEC.hauler;
  if (inp.act) { m.tipping = !m.tipping; if (m.tipping && m.load.v < .05) say(m, 'Bed empty'); }
  const before = m.tip;
  m.tip = clamp(m.tip + (m.tipping ? .45 : -.5) * dt, 0, 1);
  if (m.tip !== before) m.hyd = Math.max(m.hyd, .85);
  if (before > .02 && m.tip === 0) { _p.set(0, 1.8, -3); m.group.localToWorld(_p); snd.clang(_p.x, _p.y, _p.z, 70, .55); quake(_p.x, _p.y, _p.z, .45); m.bobV = (m.bobV || 0) - .5; m.sPitchV = (m.sPitchV || 0) - .25; }
  m.bed.rotation.x = -m.tip * .9;
  if (m.tip > .45 && m.load.v > 0) {
    m.group.updateMatrixWorld();
    _p.set(0, 0, -5.4); m.group.localToWorld(_p);
    const grav = loadMat(m.load) === 2;
    const put = dropCircle(m.load, _p.x, _p.z, 1.7, Math.min(m.load.v, 3.5 * dt));
    m.pour += put; m.pourG = grav;
    _p.set(0, 1.4, -4.9); m.group.localToWorld(_p);
    chunks(_p.x, _p.y, _p.z, Math.ceil(dt * 70), grav, -Math.sin(m.yaw) * 1.2, -Math.cos(m.yaw) * 1.2, 2.2);
    if (Math.random() < dt * 22) spawn('dust', _p.x, hAt(_p.x, _p.z) + .4, _p.z, 3, grav ? GRAVEL_C : DIRT_C, { jitter: 2.4, size: 1.5, alpha: .8 });
    m.work = Math.max(m.work, .5);
  }
  const f = m.load.v / s.cap;
  m.bedLoad.visible = f > .01;
  m.bedLoad.scale.set(1, Math.max(.03, f * 1.4), 1);
  m.bedLoad.material = loadMat(m.load) === 2 ? LOADMAT.gravel : LOADMAT.dirt;
}
// the equipment's moving parts (driven by the crew's scripts through m.work and m.cr)
function toolRoller(m, dt) { if (Math.abs(m.v) > .1) m.work = Math.max(m.work, .6); }
function toolPaver(m, dt) {
  m.screed.position.y = .35 + Math.sin(simTime * 9) * .01 * (m.paving ? 1 : 0); m.hopperLoad.visible = !!m.paving;
  if (!m.paving) return;
  m.work = Math.max(m.work, .7);
  // hot mix: steam off the fresh mat behind the screed, and black chips spilling through the augers
  if (Math.random() < dt * 10) { _p.set((Math.random() - .5) * 3.4, .3, -2.4 - Math.random() * 1.5); m.group.localToWorld(_p); spawn('smoke', _p.x, _p.y, _p.z, 1, [.82, .82, .8], { jitter: .6, size: .9, alpha: .18, up: .4 }); }
  if (Math.random() < dt * 30) { _p.set((Math.random() - .5) * 3, .45, -1.5); m.group.localToWorld(_p); spawn('grain', _p.x, _p.y, _p.z, 2, [.07, .066, .062], { jitter: .2, vx: (Math.random() - .5) * 2, vz: 0, up: .2, size: .7 }); }
}
function toolMixer(m, dt) { m.drum.rotation.z += dt * (m.pouring ? 3.5 : 1.2); m.chute.rotation.y = lerp(m.chute.rotation.y, m.pouring ? .6 : 0, 1 - Math.exp(-dt * 2)); if (m.pouring) { m.work = Math.max(m.work, .6); m.pour = Math.max(m.pour, dt * 2); m.pourG = false; } }
function toolTruck() { }
// crane: m.cr = { sw (turn), el (boom angle), ext (telescope), drop (cable), out (outriggers 0..1), load (an object on the hook) }
const _hw = new THREE.Vector3();
function toolCrane(m, dt) {
  const c = m.cr || (m.cr = { sw: 0, el: .15, ext: 0, drop: 2, out: 0, t: { sw: 0, el: .15, ext: 0, drop: 2, out: 0 }, load: null });
  const k = 1 - Math.exp(-dt * 1.6);
  for (const key of ['el', 'ext', 'drop', 'out']) c[key] = lerp(c[key], c.t[key], key === 'out' ? 1 - Math.exp(-dt * 1.2) : k);
  c.sw += clamp(angWrap(c.t.sw - c.sw), -.5 * dt, .5 * dt);
  const moving = Math.abs(angWrap(c.t.sw - c.sw)) > .01 || Math.abs(c.t.el - c.el) > .01 || Math.abs(c.t.drop - c.drop) > .05;
  if (moving) m.hyd = Math.max(m.hyd, .7);
  m.house.rotation.y = c.sw; m.boom.rotation.x = -c.el; m.boom2.position.z = 1 + c.ext * 10; m.boom3.position.z = 1 + c.ext * 10;
  for (const o of m.outr) { o.scale.x = .35 + c.out * .65; o.leg.position.y = -.5 - c.out * .2; }
  m.group.updateMatrixWorld(true);
  m.tip.getWorldPosition(_hw);
  if (!m.hook.parent) { scene.add(m.hook); scene.add(m.cable); }
  m.hook.position.set(_hw.x, _hw.y - c.drop, _hw.z);
  m.cable.position.copy(_hw); m.cable.scale.set(1, Math.max(.1, c.drop - .25), 1);
  if (c.load) { c.load.position.set(_hw.x, _hw.y - c.drop - .7, _hw.z); c.load.rotation.y = m.yaw + c.sw; }
}
const TOOL = { dozer: toolDozer, loader: toolLoader, excavator: toolExcavator, hauler: toolHauler, roller: toolRoller, paver: toolPaver, mixer: toolMixer, crane: toolCrane, truck: toolTruck };

// ---------------------------------------------------------------- the crew (Menu: Crew on/off): workers who build a river crossing
const works = makeWorks({
  scene, T, N, H, M, D, DECK, clamp, hAt, dirty, rockGeo: MOD.rockGeo(5),
  h0At: (x, z) => H0[cellOf(x, z)],
  sOf: (P, x, z) => (x - P.P[0]) * P.u[0] + (z - P.P[1]) * P.u[1],
  rand: s => mulberry32(s),
});
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: .35, metalness: .85 });
const crew = makeCrew({
  clamp, angWrap, YARD, RIVERS, SPEC, machines, hAt, wAt, gAt, wetAt, H, W, D, M, dirty, scene, THREE, pipeMat, works,
  h0At: (x, z) => H0[cellOf(x, z)], displace,
  makeMachine, removeMachine, freeSpot,
  status: (t, f) => { const e = $('crewSt'); e.style.display = t ? 'flex' : 'none'; $('crewG').style.display = t ? 'block' : 'none'; if (t) { $('crewName').textContent = 'Crew · ' + t; $('crewPct').textContent = f === undefined ? '' : Math.round(f * 100) + '%'; $('crewBar').style.width = Math.round((f || 0) * 100) + '%'; } },
  addCulvert: (P, cv) => {
    const e = o => { const x = P.P[0] + P.u[0] * cv.s + P.p[0] * o, z = P.P[1] + P.u[1] * cv.s + P.p[1] * o; return cellOf(x, z); };
    const a = e(-cv.len / 2 - 1.5), b = e(cv.len / 2 + 1.5);
    if (!CULVERTS.some(c => c.a === a && c.b === b)) CULVERTS.push({ a, b, inv: cv.y, r: cv.r, area: Math.PI * cv.r * cv.r });
  },
  clang: (x, y, z) => snd.clang(x, y, z, 80, .35),
  spray: (x, y, z) => spawn('splash', x, y, z, 3, [.35, .55, .25], { jitter: 1.5, up: .6 }),
  active: () => active, time: () => simTime, boss: () => boss, get people() { return people; },
  bedPoint: h => { _p.set(0, 2.3, -1.5); h.group.localToWorld(_p); return [_p.x, _p.z]; },
  crossed: P => { const pay = P && P.kind === 'bridge' ? 1500 : 800; stats.money += pay; toast(P && P.kind === 'bridge' ? 'Bridge finished' : 'Crossing finished', 3600, `+$${pay}`); snd.chime(); checkContract(); renderJobs(); save(); },
  say: msg => toast(msg, 2600),
  dt: () => curDt,
  lend: (m, st, dt) => people.lend(m, st, dt),
});
// the building crew on foot (people.js), and the mechanic
const people = makePeople({
  clamp, angWrap, scene, YARD, inYard, hAt, wAt, H, W, M, D, dirty, trees, machines, SPEC, TOOL,
  h0At: (x, z) => H0[cellOf(x, z)],
  nearRoad: (x, z, r) => crew.roads.some(P => { const s = clamp((x - P.P[0]) * P.u[0] + (z - P.P[1]) * P.u[1], P.sA ?? -20, P.sB ?? 20), px = P.P[0] + P.u[0] * s, pz = P.P[1] + P.u[1] * s; return Math.hypot(x - px, z - pz) < r + (P.w || 6) / 2; }),
  freeSpot, makeMachine, removeMachine,
  crewDrive: (m, x, z, tol, sp) => crew.drive(m, x, z, tol, sp),
  saw: (id, x, y, z, on, cut) => snd.saw(id, x, y, z, on, cut),
  tok: (x, y, z, a) => snd.tok(x, y, z, a),
  clang: (x, y, z) => snd.clang(x, y, z, 120, .3),
  thud: (x, y, z) => snd.clang(x, y, z, 48, .4),
  chime: () => snd.chime(),
  spawn, treeFall, logLen,
  treeLimb: t => { t.lim = 1; t.dirty = true; },
  treeGone: t => { t.st = 3; t.g = 0; t.dirty = true; },
  stumpOut: t => { t.stump = 0; stumpDirty = true; },
  cellsAround: cellsInCircle,
  toast: (m, ms) => toast(m, ms || 2200), say: (m, msg) => say(m, msg), time: () => simTime,
  boss: () => boss,
  built: S => { stats.money += 600; toast(({ shed: 'Shed', workshop: 'Workshop' }[S.kind] || 'Cabin') + ' finished', 3600, '+$600'); snd.chime(); checkContract(); renderJobs(); save(); },
});
function setCrew(v, quiet) {
  // the crew's fifth machine: a second excavator, parked in the yard the first time the crew comes on
  if (v && machines.filter(m => m.type === 'excavator' && !m.equip).length < 2) { const m = makeMachine('excavator', YARD.x1 - 4, YARD.z1 - 6, Math.PI); poseMachine(m, 0, ZERO); renderBar(); }
  crew.setOn(v); people.setOn(crew.on);
  localStorage.setItem('groundwork.crew', crew.on ? '1' : '0');
  $('mCrew').textContent = 'Crew: ' + (crew.on ? 'on' : 'off');
  // with the crew on, hand the player the loader so all three workers have a machine
  if (crew.on && !quiet && !boss && crew.isCrew(machines[active])) { const i = machines.findIndex(m => m.type === 'loader'); if (i >= 0) select(i); }
  if (!quiet) toast(crew.on ? 'Crew working' : 'Crew off');
}
function updateWorkers() {
  for (const m of machines) m.worker.visible = m === machines[active] && !boss ? !cabView : !!m.ai;
}

// excavator aim ring
const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.35, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: .7, depthWrite: false }));
ring.renderOrder = 3; scene.add(ring);

// ---------------------------------------------------------------- jobs
const JOB = {
  level: { name: 'Level the pad', what: 'Make the ground flat at the see-through plane', color: 0xf2c14e, reward: 450, w: 12, d: 10 },
  pond: { name: 'Dig the pond', what: 'Dig down to the see-through plane', color: 0x4fb3d9, reward: 600, w: 9, d: 7 },
  stock: { name: 'Stockpile gravel', what: 'Dump 30 m³ of gravel inside the posts', color: 0xe9e3d6, reward: 500, w: 8, d: 8 },
};
let jobs = [];
const stats = { money: 0, moved: 0, done: 0 };
function jobCells(j, fn) { let n = 0; for (let z = j.z0; z <= j.z1; z++) for (let x = j.x0; x <= j.x1; x++) fn(z * N + x, n++); }
function placeRect(w, d, near) {
  for (let a = 0; a < 300; a++) {
    let x0, z0;
    if (near && a < 150) { x0 = Math.round(near[0] + (Math.random() - .5) * 60 - w / 2); z0 = Math.round(near[1] + (Math.random() - .5) * 60 - d / 2); }
    else { x0 = 6 + Math.floor(Math.random() * (N - 12 - w)); z0 = 6 + Math.floor(Math.random() * (N - 12 - d)); }
    if (x0 < 6 || z0 < 6 || x0 + w > N - 6 || z0 + d > N - 6) continue;
    const x1 = x0 + w - 1, z1 = z0 + d - 1;
    let ok = true;
    for (let z = z0; z <= z1 && ok; z++) for (let x = x0; x <= x1; x++) { const k = z * N + x; if (RD[k] < 14 || M[k] === 2 || inYard(x, z, 2)) { ok = false; break; } }
    if (!ok) continue;
    if (Math.hypot((x0 + x1) / 2 - GRAVEL.x, (z0 + z1) / 2 - GRAVEL.z) < GRAVEL.r + 8) continue;
    if (Math.hypot((x0 + x1) / 2 - MARSH.x, (z0 + z1) / 2 - MARSH.z) < MARSH.r + 10 || Math.hypot((x0 + x1) / 2 - CAMP.x, (z0 + z1) / 2 - CAMP.z) < 16) continue;
    for (const o of jobs) if (x0 < o.x1 + 6 && x1 > o.x0 - 6 && z0 < o.z1 + 6 && z1 > o.z0 - 6) { ok = false; break; }
    if (ok) return { x0, z0, x1, z1 };
  }
  return null;
}
function makeJob(type, rect) {
  const j = { type, ...rect, prog: 0 };
  let s = 0, n = 0;
  jobCells(j, k => { s += H[k]; n++; });
  const mean = s / n;
  if (type === 'level') j.target = Math.round(mean * 2) / 2;
  if (type === 'pond') j.target = Math.round((mean - 1.6) * 2) / 2;
  if (type === 'stock') { j.base = []; jobCells(j, k => j.base.push(+H[k].toFixed(2))); j.goal = 30; }
  return j;
}
function jobVis(j) {
  const info = JOB[j.type];
  const grp = new THREE.Group();
  const w = j.x1 - j.x0 + 1, d = j.z1 - j.z0 + 1, cx = (j.x0 + j.x1) / 2, cz = (j.z0 + j.z1) / 2;
  const postG = new THREE.CylinderGeometry(.09, .09, 2.2, 6).translate(0, 1.1, 0);
  const postM = new THREE.MeshStandardMaterial({ color: info.color, roughness: .6 });
  const tapeM = new THREE.MeshStandardMaterial({ color: info.color, roughness: .6, side: THREE.DoubleSide });
  j.posts = [];
  const corners = [[j.x0 - .5, j.z0 - .5], [j.x1 + .5, j.z0 - .5], [j.x1 + .5, j.z1 + .5], [j.x0 - .5, j.z1 + .5]];
  for (const [x, z] of corners) { const p = new THREE.Mesh(postG, postM); p.position.set(x, hAt(x, z), z); p.castShadow = true; grp.add(p); j.posts.push(p); }
  // tape between the posts
  j.tapes = [];
  for (let c = 0; c < 4; c++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(1, .14), tapeM); grp.add(t); j.tapes.push(t);
  }
  if (j.type !== 'stock') {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide }));
    pl.position.set(cx, j.target, cz); pl.renderOrder = 4; grp.add(pl);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, .001, d)), new THREE.LineBasicMaterial({ color: info.color, transparent: true, opacity: .8 }));
    edge.position.set(cx, j.target, cz); grp.add(edge);
  }
  scene.add(grp);
  j.grp = grp;
  const tag = document.createElement('div'); tag.className = 'tag t cap'; tag.style.setProperty('--c', '#' + info.color.toString(16).padStart(6, '0'));
  $('tags').appendChild(tag); j.tag = tag;
  jobVisRefresh(j);
}
function jobVisRefresh(j) {
  const ps = j.posts.map(p => { p.position.y = hAt(p.position.x, p.position.z); return p.position; });
  for (let c = 0; c < 4; c++) {
    const a = ps[c], b = ps[(c + 1) % 4], t = j.tapes[c];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    t.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 1.9, (a.z + b.z) / 2);
    t.scale.set(len, 1, 1);
    t.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
  }
}
function jobDispose(j) { scene.remove(j.grp); j.tag.remove(); }
function jobProgress(j) {
  let n = 0, ok = 0, v = 0;
  jobCells(j, (k, i) => {
    n++;
    if (j.type === 'level') { if (Math.abs(H[k] - j.target) < .3) ok++; }
    else if (j.type === 'pond') { if (H[k] <= j.target + .3) ok++; }
    else if (M[k] === 2) v += Math.max(0, H[k] - j.base[i]);
  });
  return j.type === 'stock' ? Math.min(1, v / j.goal) : ok / n;
}
function freshJobs() {
  for (const j of jobs) jobDispose(j);
  jobs = [];
  for (const type of ['level', 'stock', 'pond']) {
    const r = placeRect(JOB[type].w, JOB[type].d, [124, 177]);
    if (r) { const j = makeJob(type, r); jobs.push(j); jobVis(j); }
  }
}
let jobTimer = 0;
function updateJobs(dt) {
  jobTimer -= dt;
  if (jobTimer > 0) return;
  jobTimer = .5;
  for (const j of [...jobs]) {
    j.prog = jobProgress(j);
    jobVisRefresh(j);
    const need = j.type === 'stock' ? 1 : .9;
    if (j.prog >= need && j !== goal.job) {
      const info = JOB[j.type];
      stats.money += info.reward; stats.done++;
      toast('Job complete', 3200, `+$${info.reward}`);
      snd.chime();
      jobDispose(j);
      jobs.splice(jobs.indexOf(j), 1);
      if (j === goal.job) continue;
      const r = goal.i >= GOALS.length ? placeRect(info.w, info.d) : null;
      if (r) { const nj = makeJob(j.type, r); jobs.push(nj); jobVis(nj); }
      save();
    }
  }
  renderJobs();
}
const SHORT = { level: 'Level pad', pond: 'Dig pond', stock: 'Stockpile' };
// contracts: what the boss is being paid to get built, in order
const riverOf = (x, z) => { let bi = -1, bd = 1e9; RIVERS.forEach((r, i) => { for (const q of r.s) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; bi = i; } } }); return bi; };
const riverSpot = i => { const Y = [(YARD.x0 + YARD.x1) / 2, (YARD.z0 + YARD.z1) / 2]; let best = null, bd = 1e9; for (const q of RIVERS[i].s) { if (q[0] < 20 || q[1] < 20 || q[0] > N - 20 || q[1] > N - 20) continue; const d = Math.hypot(q[0] - Y[0], q[1] - Y[1]); if (d < bd) { bd = d; best = q; } } return best; };
const CONTRACTS = [
  { name: 'Bridge the river', river: 0, reward: 2500 },
  { name: 'Build a cabin', build: 1, reward: 1500 },
  { name: 'Cross the south creek', river: 2, reward: 1500 },
  { name: 'Cross the north creek', river: 1, reward: 1500 },
  { name: 'Build three buildings', build: 3, reward: 2500 },
];
const contract = { i: 0, mark: null };
const builtCount = () => people.sites.filter(S => S.phase === 'done').length;
function contractDone(C) { return C.river !== undefined ? crew.roads.some(P => P.done && riverOf(P.P[0], P.P[1]) === C.river) : builtCount() >= C.build; }
function checkContract() {
  let C = CONTRACTS[contract.i];
  while (C && contractDone(C)) {
    stats.money += C.reward; contract.i++;
    const c = C; setTimeout(() => { toast(c.name, 3600, `+$${c.reward}`); snd.chime(); }, 3800);
    C = CONTRACTS[contract.i];
  }
  contractMark();
}
function contractMark() {
  if (contract.mark) { scene.remove(contract.mark); contract.mark = null; }
  const C = CONTRACTS[contract.i]; if (!C) return;
  const at = C.river !== undefined && riverSpot(C.river); if (!at) return;
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 80, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xf2d24e, transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 40; beam.renderOrder = 4; g.add(beam);
  g.position.set(at[0], hAt(at[0], at[1]), at[1]); scene.add(g); contract.mark = g; C.at = at;
}
function renderJobs() {
  $('money').textContent = '$' + stats.money.toLocaleString();
  for (const g of goalMarks) g.visible = !boss;
  if (contract.mark) contract.mark.visible = boss;
  if (boss) {
    const C = CONTRACTS[contract.i];
    let f = 0;
    if (C && C.river !== undefined) { const P = crew.site; if (P && riverOf(P.P[0], P.P[1]) === C.river) f = (P.si + 0.5) / P.stages.length; }
    else if (C) f = builtCount() / C.build;
    $('objName').textContent = C ? C.name : 'Build what you like';
    $('objPct').textContent = C ? '$' + C.reward.toLocaleString() : '';
    $('objBar').style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
    return;
  }
  const G = GOALS[goal.i], me = machines[active];
  if (G) {
    $('objName').textContent = G.name;
    const far = G.x !== undefined && me ? Math.hypot(G.x - me.x, G.z - me.z) : 0;
    $('objPct').textContent = (G.id === 'cross' || G.id === 'camp') ? `${Math.round(far)} m` : Math.round(goal.prog * 100) + '%';
    $('objBar').style.width = Math.round(goal.prog * 100) + '%';
    return;
  }
  let best = null, bd = 1e9;
  if (me) for (const j of jobs) { const d = Math.hypot((j.x0 + j.x1) / 2 - me.x, (j.z0 + j.z1) / 2 - me.z); if (d < bd) { bd = d; best = j; } }
  $('objName').textContent = best ? SHORT[best.type] : '';
  $('objPct').textContent = best ? Math.round(best.prog * 100) + '%' : '';
  $('objBar').style.width = best ? Math.round(best.prog * 100) + '%' : '0';
}

// ---------------------------------------------------------------- objectives (the open-world goals) and side jobs
// Main goals, in order: cross the river to the gravel pit, bring gravel home, dam the south creek, reach the logging
// camp with the loader, drain the marsh. Side jobs (level a pad, dig a pond, stockpile) keep coming after that.
const GOALS = [
  { id: 'cross', name: 'Cross the river', hint: 'Get the hauler to the gravel pit', x: GRAVEL.x + 6, z: GRAVEL.z + GRAVEL.r + 4, reward: 800 },
  { id: 'haul', name: 'Haul gravel home', hint: 'Dump 30 m³ of gravel in the yard', reward: 700 },
  { id: 'dam', name: 'Dam the creek', hint: 'Back the south creek up to 1.6 m deep at the marker', x: 72, z: 214, reward: 700 },
  { id: 'camp', name: 'Reach the camp', hint: 'Drive the loader to the logging camp', x: CAMP.x, z: CAMP.z, reward: 900 },
  { id: 'marsh', name: 'Drain the marsh', hint: 'Dig a channel so the marsh drains away', x: MARSH.x, z: MARSH.z, reward: 1000 },
];
const goal = { i: 0, prog: 0, hold: 0, marsh0: 0, job: null };
const goalMarks = [];
function marshVolume() { let v = 0; cellsInCircle(MARSH.x, MARSH.z, MARSH.r + 6, k => { v += W[k]; }); return v; }
function goalSetup() {
  for (const g of goalMarks) scene.remove(g);
  goalMarks.length = 0;
  const G = GOALS[goal.i]; if (!G) return;
  if (G.id === 'haul' && !goal.job) {
    const r = { x0: YARD.x0 + 2, z0: YARD.z1 - 9, x1: YARD.x0 + 10, z1: YARD.z1 - 2 };
    goal.job = makeJob('stock', r); jobs.push(goal.job); jobVis(goal.job);
  }
  if (G.id === 'marsh' && !goal.marsh0) goal.marsh0 = marshVolume();
  if (G.x !== undefined) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 60, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc061, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 30; beam.renderOrder = 4; g.add(beam);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 3, 8), new THREE.MeshStandardMaterial({ color: 0xffc061, roughness: .5 }));
    pole.position.y = 1.5; pole.castShadow = true; g.add(pole);
    g.position.set(G.x, hAt(G.x, G.z), G.z); scene.add(g); goalMarks.push(g);
  }
}
let goalTimer = 0;
function updateGoal(dt) {
  goalTimer -= dt; if (goalTimer > 0) return; goalTimer = .5;
  const G = GOALS[goal.i];
  for (const g of goalMarks) g.position.y = hAt(g.position.x, g.position.z);
  if (!G) return;
  const by = t => machines.find(m => m.type === t);
  let done = false;
  if (G.id === 'cross' || G.id === 'camp') {
    const m = by(G.id === 'cross' ? 'hauler' : 'loader'), d = Math.hypot(m.x - G.x, m.z - G.z);
    goal.prog = clamp(1 - (d - 8) / 150, 0, 1); done = d < 8;
  } else if (G.id === 'haul') {
    goal.prog = goal.job ? goal.job.prog : 0; done = goal.prog >= 1;
  } else if (G.id === 'dam') {
    const w = W[cellOf(G.x, G.z)]; goal.prog = clamp(w / 1.6, 0, 1);
    goal.hold = w >= 1.6 ? goal.hold + .5 : 0; done = goal.hold >= 5;
  } else if (G.id === 'marsh') {
    const v = marshVolume(); goal.prog = clamp(1 - (v / Math.max(1, goal.marsh0) - .25) / .75, 0, 1); done = v < goal.marsh0 * .25;
  }
  if (done) {
    stats.money += G.reward; stats.done++;
    toast(G.name, 3600, `+$${G.reward}`); snd.chime();
    if (goal.job) { if (jobs.includes(goal.job)) { jobDispose(goal.job); jobs.splice(jobs.indexOf(goal.job), 1); } goal.job = null; }
    goal.i++; goal.prog = 0; goal.hold = 0; goal.marsh0 = 0;
    goalSetup();
    if (goal.i >= GOALS.length && !jobs.length) freshJobs();
    save();
  }
}

// ---------------------------------------------------------------- minimap (M to hide)
const mapCv = $('minimap'), mapG = mapCv ? mapCv.getContext('2d') : null;
const mapBase = document.createElement('canvas'); mapBase.width = mapBase.height = N;
let mapTimer = 0, mapBaseTimer = 0, mapOn = localStorage.getItem('groundwork.map') !== '0';
function drawMapBase() {
  const g = mapBase.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x, o = (y * N + x) * 4, h = H[k];
    const sh = clamp(.75 + (H[k] - H[Math.min(NN - 1, k + N + 1)]) * .35, .45, 1.15) * clamp(.75 + (h - 8) * .025, .7, 1.1);
    let c = M[k] === 2 ? [150, 146, 136] : (M[k] === 1 || D[k]) ? [128, 98, 70] : [74, 98, 54];
    if (treeGrid[k] >= 0 || treeGrid[Math.max(0, k - 1)] >= 0 || treeGrid[Math.min(NN - 1, k + 1)] >= 0 || treeGrid[Math.max(0, k - N)] >= 0 || treeGrid[Math.min(NN - 1, k + N)] >= 0) c = [46, 66, 38];
    if (W[k] > .05) c = W[k] > .8 ? [46, 82, 104] : [72, 112, 128];
    d[o] = c[0] * sh; d[o + 1] = c[1] * sh; d[o + 2] = c[2] * sh; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
function updateMap(dt) {
  if (!mapG || !mapOn) return;
  mapTimer -= dt; mapBaseTimer -= dt;
  if (mapTimer > 0) return; mapTimer = .25;
  if (mapBaseTimer <= 0) { mapBaseTimer = 2; drawMapBase(); }
  const S = mapCv.width, f = S / N;
  mapG.clearRect(0, 0, S, S);
  mapG.drawImage(mapBase, 0, 0, S, S);
  const G = GOALS[goal.i];
  const diamond = (x, z, c, r) => { mapG.fillStyle = c; mapG.beginPath(); mapG.moveTo(x * f, z * f - r); mapG.lineTo(x * f + r, z * f); mapG.lineTo(x * f, z * f + r); mapG.lineTo(x * f - r, z * f); mapG.fill(); };
  const ds = S / 300;
  for (const j of jobs) diamond((j.x0 + j.x1) / 2, (j.z0 + j.z1) / 2, '#' + JOB[j.type].color.toString(16).padStart(6, '0'), 3 * ds);
  for (const R of crew.roads) if (R.done || R.prof) { const [ax, az] = crew.pt(R, R.sA), [bx, bz] = crew.pt(R, R.sB); mapG.strokeStyle = R.done ? '#3a3a38' : '#8a8a84'; mapG.lineWidth = 4 * ds; mapG.beginPath(); mapG.moveTo(ax * f, az * f); mapG.lineTo(bx * f, bz * f); mapG.stroke(); }
  const CS = crew.site;   // the crossing the crew is building
  if (CS) { const [ax, az] = crew.pt(CS, -CS.cw - 2), [bx, bz] = crew.pt(CS, CS.far); mapG.strokeStyle = '#f2d24e'; mapG.lineWidth = 3 * ds; mapG.beginPath(); mapG.moveTo(ax * f, az * f); mapG.lineTo(bx * f, bz * f); mapG.stroke(); }
  const CC = CONTRACTS[contract.i];
  if (boss) { if (CC && CC.at) diamond(CC.at[0], CC.at[1], '#f2d24e', 6 * ds); }
  else if (G && G.x !== undefined) { diamond(G.x, G.z, '#ffc061', 5 * ds); }
  machines.forEach((m, i) => {
    mapG.save(); mapG.translate(m.x * f, m.z * f); mapG.rotate(-m.yaw + Math.PI);
    mapG.fillStyle = i === active ? '#fff' : m.ai ? '#f2d24e' : '#e8792a';
    const r = S / 300 * 2.2;
    mapG.beginPath(); mapG.moveTo(0, -5 * r); mapG.lineTo(3.5 * r, 4 * r); mapG.lineTo(-3.5 * r, 4 * r); mapG.fill(); mapG.restore();
  });
}
function toggleMap() { mapOn = !mapOn; localStorage.setItem('groundwork.map', mapOn ? '1' : '0'); if (mapCv) mapCv.style.display = mapOn ? 'block' : 'none'; }

// ---------------------------------------------------------------- input
const keys = new Set();
const touch = { throttle: 0, steer: 0, hold: {} };
const inp = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
let actPressed = false;
let active = 0;
let cabView = false;
// the boss view: the game starts looking down on the valley; the crew drive every machine and the player gives orders.
// Tap a machine (or its button) to get in and drive it yourself; BOSS takes you back out.
let boss = localStorage.getItem('groundwork.boss') !== '0';
const bossCam = { x: 128, z: 150, dist: 80, yaw: 0 };
let order = null;   // 'cross' or 'build' while waiting for the player to tap where
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'tab') { e.preventDefault(); select((active + 1) % driveCount()); return; }
  if (e.repeat) { keys.add(k); return; }
  keys.add(k);
  if (k === ' ') { e.preventDefault(); actPressed = true; }
  if (k === 'b') { setBoss(!boss); return; }
  if (boss && k === 'escape' && order) { order = null; refreshOrders(); return; }
  if (k === 'c' && !boss) cabView = !cabView;
  if (k >= '1' && k <= '9' && +k <= driveCount()) select(+k - 1);
  if (k === 'm') toggleMap();
  if (k === 't') setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1);
  if (k === 'h' || k === '?') showHelp(true);
  if (k === 'escape') { const open = $('menu').style.display === 'flex' || $('help').style.display === 'flex' || $('worlds').style.display === 'flex'; showHelp(false); $('worlds').style.display = 'none'; $('menu').style.display = open ? 'none' : 'flex'; }
  audioStart();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function readInput() {
  const kd = k => keys.has(k);
  if (boss) {   // the keys pan and turn the boss view; the machines get no input from the player
    const step = bossCam.dist * .012, r = [Math.cos(bossCam.yaw), -Math.sin(bossCam.yaw)], f = [-Math.sin(bossCam.yaw), -Math.cos(bossCam.yaw)];
    const fw = (kd('w') || kd('arrowup') ? 1 : 0) - (kd('s') || kd('arrowdown') ? 1 : 0), rt = (kd('d') || kd('arrowright') ? 1 : 0) - (kd('a') || kd('arrowleft') ? 1 : 0);
    bossCam.x += (f[0] * fw + r[0] * rt) * step; bossCam.z += (f[1] * fw + r[1] * rt) * step;
    bossCam.yaw += ((kd('q') ? 1 : 0) - (kd('e') ? 1 : 0)) * .03;
    Object.assign(inp, ZERO); actPressed = false;
    return;
  }
  inp.throttle = clamp((kd('w') || kd('arrowup') ? 1 : 0) - (kd('s') || kd('arrowdown') ? 1 : 0) + touch.throttle, -1, 1);
  inp.steer = clamp((kd('a') || kd('arrowleft') ? 1 : 0) - (kd('d') || kd('arrowright') ? 1 : 0) + touch.steer, -1, 1);
  inp.tool = (kd('r') || touch.hold.up ? 1 : 0) - (kd('f') || touch.hold.down ? 1 : 0);
  inp.swing = (kd('q') || touch.hold.swl ? 1 : 0) - (kd('e') || touch.hold.swr ? 1 : 0);
  inp.act = actPressed; actPressed = false;
}
const ZERO = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };

// camera orbit
let camOff = 0, camPitch = .42, camDist = 17, camYawSm = 0, lastDrag = 0;
const ptrs = new Map();
let pinch0 = 0, dist0 = 0;
let tap0 = null;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); audioStart();
  tap0 = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 } : null;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = boss ? bossCam.dist : camDist; } });
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (tap0) tap0.moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) { if (boss) bossCam.dist = clamp(dist0 * pinch0 / d, 22, 170); else camDist = clamp(dist0 * pinch0 / d, 6, 70); } return; }
  if (boss) {   // drag the valley under your finger
    const k = bossCam.dist * .0021, dx = e.clientX - px, dy = e.clientY - py, c = Math.cos(bossCam.yaw), sn = Math.sin(bossCam.yaw);
    bossCam.x -= (c * dx + sn * dy) * k; bossCam.z -= (-sn * dx + c * dy) * k;
    return;
  }
  camOff -= (e.clientX - px) * .006;
  camPitch = clamp(camPitch + (e.clientY - py) * .004, cabView ? -.6 : .08, cabView ? .6 : 1.35);
  lastDrag = performance.now();
});
const endPtr = e => {
  if (e.type === 'pointerup' && boss && tap0 && ptrs.size === 1 && tap0.moved < 12 && performance.now() - tap0.t < 600) bossTap(e.clientX, e.clientY);
  ptrs.delete(e.pointerId); pinch0 = 0; tap0 = null;
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); if (boss) bossCam.dist = clamp(bossCam.dist * Math.exp(e.deltaY * .001), 22, 170); else camDist = clamp(camDist * Math.exp(e.deltaY * .001), 6, 70); }, { passive: false });
// where a tap lands on the ground: walk along the view ray until it goes under the terrain
const _ray = new THREE.Raycaster();
function groundAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  _ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  let prev = 0;
  for (let t = 1; t < 700; t += 1) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (x < 0 || z < 0 || x > N - 1 || z > N - 1) { if (t > 400) return null; prev = t; continue; }
    if (y < hAt(x, z) + Math.max(0, W[cellOf(x, z)])) {
      let a = prev, b = t;   // narrow it down
      for (let q = 0; q < 8; q++) { const m = (a + b) / 2, mx = o.x + d.x * m, mz = o.z + d.z * m; if (o.y + d.y * m < hAt(mx, mz) + Math.max(0, W[cellOf(mx, mz)])) b = m; else a = m; }
      return [o.x + d.x * b, o.z + d.z * b];
    }
    prev = t;
  }
  return null;
}
// a tap in the boss view: place the order that's waiting, or get into the machine that was tapped
function bossTap(cx, cy) {
  const g = groundAt(cx, cy); if (!g) return;
  const [x, z] = g;
  if (order) { doOrder(order, x, z); return; }
  let bi = -1, bd = 7;
  for (let i = 0; i < driveCount(); i++) { const m = machines[i], d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; bi = i; } }
  if (bi >= 0) select(bi);
}

// touch controls
if (isTouch) document.body.classList.add('touch');
{
  const stick = $('stick'), knob = $('knob');
  let sid = null;
  const setStick = (x, y) => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = x - cx, dy = y - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    touch.throttle = clamp(-dy / R * 1.25, -1, 1); touch.steer = clamp(-dx / R * 1.25, -1, 1);
    if (Math.abs(touch.throttle) < .15) touch.throttle = 0; if (Math.abs(touch.steer) < .15) touch.steer = 0;
  };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); setStick(e.clientX, e.clientY); audioStart(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) setStick(e.clientX, e.clientY); });
  const up = e => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; touch.throttle = touch.steer = 0; };
  stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
  for (const b of document.querySelectorAll('#tbtns button')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); audioStart();
      if (k === 'act') actPressed = true;
      else if (k === 'cam') cabView = !cabView;
      else if (k === 'next') select((active + 1) % driveCount());
      else touch.hold[k] = true;
    });
    const rel = () => { touch.hold[k] = false; };
    b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
  }
}

const ICON = {
  dozer: '<svg viewBox="0 0 40 24"><rect x="5" y="16" width="24" height="6" rx="3"/><rect x="8" y="9" width="15" height="7"/><rect x="10" y="3" width="8" height="7"/><path d="M30 6q6 7 1 16h3q5-9-1-16z"/></svg>',
  loader: '<svg viewBox="0 0 40 24"><circle cx="9" cy="18" r="5"/><circle cx="25" cy="18" r="5"/><rect x="4" y="9" width="20" height="6"/><rect x="7" y="2" width="8" height="8"/><path d="M19 10l11 3" stroke-width="3" fill="none"/><path d="M29 10h8l-1 9h-6z"/></svg>',
  excavator: '<svg viewBox="0 0 40 24"><rect x="3" y="17" width="22" height="5" rx="2.5"/><rect x="5" y="10" width="17" height="7"/><rect x="15" y="4" width="6" height="7"/><path d="M20 10l8-7 8 9" stroke-width="3" fill="none"/><path d="M33 12h5l-1 6h-4z"/></svg>',
  hauler: '<svg viewBox="0 0 40 24"><circle cx="8" cy="19" r="4"/><circle cx="25" cy="19" r="4"/><circle cx="34" cy="19" r="4"/><rect x="2" y="6" width="9" height="9"/><path d="M13 3h25l-2 12H13z"/></svg>',
};
function select(i, stay = false) {
  if (!machines[i]) return;
  if (boss && !stay) { active = i; setBoss(false); }
  active = i;
  camOff = 0;
  machines.forEach(m => { if (m !== machines[i] && !m.ai) m.v = 0; });
  crew.refresh();
  renderBar();
  const m = machines[i];
  $('mname').textContent = SPEC[m.type].name;
  const show = (k, on) => document.querySelector(`#tbtns [data-k=${k}]`).classList.toggle('hide', !on);
  show('swl', m.type === 'excavator'); show('swr', m.type === 'excavator');
  show('up', m.type !== 'hauler'); show('down', m.type !== 'hauler');
  show('act', m.type !== 'dozer');
  renderJobs();
}
function renderBar() {
  $('mbar').innerHTML = machines.slice(0, driveCount()).map((m, i) =>
    `<button data-i="${i}" class="${i === active ? 'on' : ''}" aria-label="${SPEC[m.type].name}"><b>${i + 1}</b>${ICON[m.type]}<i><u></u></i></button>`).join('');
}
function setBoss(v) {
  boss = !!v; order = null;
  document.body.classList.toggle('boss', boss);
  localStorage.setItem('groundwork.boss', boss ? '1' : '0');
  const m = machines[active];
  if (boss) {
    if (m) { bossCam.x = m.x; bossCam.z = m.z; }
    cabView = false;
    if (!crew.on) setCrew(true, true);
  } else if (m) { camYawSm = m.yaw; camOff = 0; toast(SPEC[m.type].name + ' · tap boss to go back', 2600); }
  for (const q of machines) if (!q.ai) q.v = 0;
  crew.refresh(); refreshOrders(); barTimer = 0; renderJobs();
}
$('bossBtn').onclick = e => { e.currentTarget.blur(); setBoss(true); };
// ---------------------------------------------------------------- orders and the crew list (boss view)
function refreshOrders() {
  document.querySelectorAll('#orders button').forEach(b => b.classList.toggle('on', b.dataset.o === order));
  const h = $('hint');
  h.textContent = order === 'cross' ? 'TAP A RIVER OR CREEK' : order === 'build' ? 'TAP WHERE TO BUILD' : '';
  h.style.display = order ? 'block' : 'none';
}
$('orders').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; b.blur(); audioStart();
  const o = b.dataset.o;
  if (o === 'stop') {
    order = null; refreshOrders();
    if (crew.site) { crew.cancel(); toast('Job stopped'); } else toast('No crossing to stop');
    return;
  }
  order = order === o ? null : o; refreshOrders();
});
function doOrder(o, x, z) {
  const why = o === 'cross' ? crew.orderAt(x, z) : people.orderAt(x, z, 'cabin');
  if (why) { toast(why, 2200); return; }
  order = null; refreshOrders();
  // look at the whole job: from the dirt pit to the water (or the building site), a little up from the bottom bar
  if (o === 'cross' && crew.site) { const [x, zz] = crew.pt(crew.site, crew.site.Ls * .55); bossCam.x = x; bossCam.z = zz + 6; }
  else if (people.site) { bossCam.x = people.site.x; bossCam.z = people.site.z + 6; }
}
let crewHtml = '';
function bossHud() {
  let h = '<div class="h cap">Crew</div>';
  for (let i = 0; i < driveCount(); i++) {
    const m = machines[i], what = crew.isCrew(m) ? crew.doing(m) : 'PARKED', idle = /WAITING|PARKED|OFF|STANDING/.test(what);
    h += `<button data-i="${i}" class="${idle ? 'idle' : ''}"><span>${SPEC[m.type].name}</span><span>${what}</span></button>`;
  }
  const bw = people.doing();
  h += `<button data-b="1" class="${/WAITING|OFF/.test(bw) ? 'idle' : ''}"><span>Builders</span><span>${bw}</span></button>`;
  if (h !== crewHtml) { crewHtml = h; $('crewList').innerHTML = h; }
  renderJobs();
}
$('crewList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; b.blur();
  if (b.dataset.b) { const S = people.site; if (S) { bossCam.x = S.x; bossCam.z = S.z; } return; }
  const m = machines[+b.dataset.i]; if (m) { bossCam.x = m.x; bossCam.z = m.z; }   // look at it; tap it on the ground to drive it
});
$('mbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { select(+b.dataset.i); b.blur(); } });

// ---------------------------------------------------------------- HUD, toast, menus
let toastT = 0;
const say = (m, msg) => { if (m === machines[active] && !boss) toast(msg); };
function toast(msg, ms = 1800, sub = '') {
  const t = $('toast');
  t.innerHTML = msg + (sub ? `<small>${sub}</small>` : '');
  t.classList.toggle('big', !!sub); t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms);
}
function toolText(m) {
  if (m.type === 'dozer') return `Blade ${m.blade >= 0 ? '+' : ''}${m.blade.toFixed(1)}`;
  if (m.type === 'loader') return `Bucket ${m.arm < .2 ? 'down' : m.arm > .55 ? 'up' : 'mid'}`;
  if (m.type === 'excavator') return `Reach ${m.reach.toFixed(1)} m`;
  return m.tipping ? 'Bed up' : 'Bed down';
}
let barTimer = 0;
function updateHud(dt) {
  barTimer -= dt;
  if (barTimer > 0) return;
  barTimer = .15;
  if (boss) { bossHud(); return; }
  const m = machines[active], s = SPEC[m.type], f = Math.min(1, m.load.v / s.cap);
  $('mspd').textContent = Math.abs(m.v) > .3 ? `${(Math.abs(m.v) * 3.6).toFixed(0)} km/h` : '';
  $('mgauge').style.width = (f * 100).toFixed(0) + '%';
  const hp = $('mhp'); hp.parentNode.style.display = m.hp < .995 ? 'block' : 'none';
  hp.style.width = (m.hp * 100).toFixed(0) + '%'; hp.style.background = m.hp > .5 ? '#9ccf5a' : m.hp > .2 ? '#f2b33d' : '#e2483a';
  $('mcond').textContent = m.hp <= 0 ? 'broken down' : m.hp < .995 ? `condition ${Math.round(m.hp * 100)}%` : '';
  $('mtool').textContent = toolText(m);
  $('mload').textContent = m.load.v > .05 ? `${m.load.v.toFixed(1)} m³ ${loadName(m.load)}` : 'empty';
  document.querySelectorAll('#mbar button').forEach((b, i) => {
    const mm = machines[i]; if (!mm) return;
    b.querySelector('u').style.width = Math.min(100, Math.round(100 * mm.load.v / SPEC[mm.type].cap)) + '%';
    b.classList.toggle('broke', mm.hp <= 0);
  });
  if (m.type === 'excavator') $('actBtn').textContent = m.load.v > .05 ? 'DUMP' : 'DIG';
  else $('actBtn').textContent = { loader: 'DUMP', hauler: 'TIP' }[m.type] || '';
  renderJobs();
}
function showHelp(on) { $('help').style.display = on ? 'flex' : 'none'; }
$('helpGo').onclick = () => { showHelp(false); audioStart(); localStorage.setItem('groundwork.seenHelp', '1'); };
$('menuBtn').onclick = () => { $('menu').style.display = 'flex'; };
$('spdBtn').onclick = () => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1);
$('mClose').onclick = () => { $('menu').style.display = 'none'; };
$('mHelp').onclick = () => { $('menu').style.display = 'none'; showHelp(true); };
$('mSound').onclick = () => toggleSound();
$('mCrew').onclick = () => setCrew(!crew.on);
$('mGfx').textContent = 'Graphics: ' + quality;
$('mGfx').onclick = () => {
  const next = { high: 'medium', medium: 'low', low: 'high' }[quality];
  localStorage.setItem('groundwork.quality', next); save(); location.reload();
};
// ---------------------------------------------------------------- worlds: saved valleys kept in the browser (IndexedDB)
// The valley you're playing is always saved by itself. "Save this world" keeps a named copy; "Load" and "New world"
// first keep the current valley as "Autosave" so nothing is lost by accident.
const WDB = { db: null };
function wdb() {
  if (WDB.db) return Promise.resolve(WDB.db);
  return new Promise((ok, bad) => {
    const r = indexedDB.open('groundwork', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('worlds', { keyPath: 'id' });
    r.onsuccess = () => { WDB.db = r.result; ok(r.result); };
    r.onerror = () => bad(r.error);
  });
}
const wreq = (mode, fn) => wdb().then(db => new Promise((ok, bad) => { const t = db.transaction('worlds', mode), r = fn(t.objectStore('worlds')); t.oncomplete = () => ok(r && r.result); t.onerror = () => bad(t.error); }));
const worldsList = () => wreq('readonly', s => s.getAll()).then(l => (l || []).sort((a, b) => b.t - a.t));
const worldPut = w => wreq('readwrite', s => s.put(w));
const worldDel = id => wreq('readwrite', s => s.delete(id));
async function keepCurrent(name, id) { const d = saveData(); if (d) await worldPut({ id: id || 'w' + Date.now(), name, t: Date.now(), data: d }); }
function openWorlds() {
  $('menu').style.display = 'none'; $('worlds').style.display = 'flex';
  const L = $('wList'); L.textContent = '...';
  worldsList().then(list => {
    L.innerHTML = list.length ? '' : '<div class="wNone">NO SAVED WORLDS</div>';
    for (const w of list) {
      const row = document.createElement('div'); row.className = 'wRow';
      const d = new Date(w.t);
      row.innerHTML = `<span class="wName"></span><span class="wDate">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><button class="wLoad">Load</button><button class="wDel">X</button>`;
      row.querySelector('.wName').textContent = w.name;
      row.querySelector('.wLoad').onclick = async () => {
        if (!confirm(`Load "${w.name}"? Your current valley is kept as "Autosave".`)) return;
        await keepCurrent('Autosave', 'autosave');
        localStorage.setItem(SAVE_KEY, w.data); noSave = true; location.reload();
      };
      row.querySelector('.wDel').onclick = async () => { if (!confirm(`Delete "${w.name}" for good?`)) return; await worldDel(w.id); openWorlds(); };
      L.appendChild(row);
    }
  }).catch(() => { L.textContent = 'SAVING WORLDS IS BLOCKED IN THIS BROWSER'; });
}
$('mWorlds').onclick = openWorlds;
$('wBack').onclick = () => { $('worlds').style.display = 'none'; $('menu').style.display = 'flex'; };
$('wSave').onclick = async () => {
  const n = prompt('Name this world', 'Valley ' + new Date().toLocaleDateString());
  if (!n) return;
  try { await keepCurrent(n.slice(0, 40)); toast('World saved'); openWorlds(); } catch (e) { toast('Could not save the world', 3000); }
};
$('wNew').onclick = async () => {
  if (!confirm('Start a fresh valley? Your current one is kept as "Autosave" in Worlds.')) return;
  try { await keepCurrent('Autosave', 'autosave'); } catch (e) { if (!confirm('Could not keep a copy of this valley. Start fresh anyway?')) return; }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  noSave = true; location.reload();
};

// ---------------------------------------------------------------- saving (nothing ever resets)
let noSave = false, crewSave = null, peopleSave = null;
function b64(arr) {
  const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = '';
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
}
function unb64(str, Type) {
  const s = atob(str), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Type(u.buffer);
}
let saveWarned = false;
function saveData() {
  if (!machines.length) return null;
  {
    const data = {
      v: 3, seed, t: Date.now(), active, stats, goal: { i: goal.i, marsh0: goal.marsh0 }, contract: contract.i, goalJob: goal.job ? jobs.indexOf(goal.job) : -1,
      H: b64(H), W: b64(W), M: b64(M), D: b64(D),
      gone: trees.map((t, i) => t.st === 3 ? i : -1).filter(i => i >= 0),
      logs: trees.map((t, i) => t.st === 1 || t.st === 2 ? [i, +t.x.toFixed(2), +t.z.toFixed(2), +t.dx.toFixed(3), +t.dz.toFixed(3)] : null).filter(Boolean),
      rocks: rocks.map(r => [+r.x.toFixed(2), +r.z.toFixed(2), +r.rx.toFixed(2), +r.ry.toFixed(2)]),
      mach: machines.filter(m => !m.equip).map(m => ({ type: m.type, x: +m.x.toFixed(3), z: +m.z.toFixed(3), yaw: +m.yaw.toFixed(4), load: m.load, blade: m.blade, arm: m.arm, swing: m.swing, reach: m.reach, tip: m.tip, tipping: m.tipping, grime: +m.grime.toFixed(3), hp: +m.hp.toFixed(3) })),
      crew: crew.serialize(), people: people.serialize(),
      cut: trees.map((t, i) => t.cut ? [i, +t.sx.toFixed(2), +t.sz.toFixed(2), t.lim ? 1 : 0, t.stump === 0 ? 0 : 1] : null).filter(Boolean),
      jobs: jobs.map(j => ({ type: j.type, x0: j.x0, z0: j.z0, x1: j.x1, z1: j.z1, target: j.target, base: j.base, goal: j.goal })),
    };
    return JSON.stringify(data);
  }
}
function save() {
  if (noSave || !machines.length) return;
  try {
    localStorage.setItem(SAVE_KEY, saveData());
  } catch (e) {
    if (!saveWarned) { saveWarned = true; toast('Saving is blocked in this browser', 4000); }
  }
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { data = null; }
  if (!data || data.v !== 3) return false;
  try {
    seed = data.seed;
    generate(seed, 'relax');
    H.set(unb64(data.H, Float32Array)); W.set(unb64(data.W, Float32Array));
    M.set(unb64(data.M, Uint8Array)); D.set(unb64(data.D, Uint8Array));
    for (const i of data.gone || []) if (trees[i]) { trees[i].st = 3; trees[i].g = 0; treeGrid[trees[i].k] = -1; }
    for (const t of trees) t.y = hAt(t.x, t.z) - .15;
    for (const [i, x, z, dx, dz] of data.logs || []) { const t = trees[i]; if (!t) continue; Object.assign(t, { st: 2, a: 1, x, z, dx, dz }); treeGrid[t.k] = -1; }
    (data.rocks || []).forEach((r, i) => { if (rocks[i]) Object.assign(rocks[i], { x: r[0], z: r[1], rx: r[2], ry: r[3] }); });
    for (const s of data.mach) {
      const m = makeMachine(s.type, s.x, s.z, s.yaw);
      Object.assign(m, { load: s.load || newLoad(), blade: s.blade ?? 0, arm: s.arm ?? .3, swing: s.swing ?? 0, reach: s.reach ?? 5, tip: s.tip ?? 0, tipping: !!s.tipping, grime: s.grime ?? .2, hp: s.hp ?? 1 });
    }
    Object.assign(stats, data.stats || {});
    for (const j of data.jobs || []) { const jj = { ...j, prog: 0 }; jobs.push(jj); jobVis(jj); }
    if (data.goal) { goal.i = data.goal.i | 0; goal.marsh0 = data.goal.marsh0 || 0; }
    contract.i = data.contract | 0;
    if (data.goalJob >= 0 && jobs[data.goalJob]) goal.job = jobs[data.goalJob];
    active = clamp(data.active | 0, 0, machines.length - 1);
    crewSave = data.crew || null; peopleSave = data.people || null;
    for (const [i, sx, sz, lim, st] of data.cut || []) { const t = trees[i]; if (t) Object.assign(t, { cut: 1, sx, sz, lim, stump: st ? 1 : 0 }); }
    return true;
  } catch (e) {
    console.warn('save unreadable, starting a new valley', e);
    for (const m of machines) scene.remove(m.group);
    machines.length = 0; jobs.forEach(jobDispose); jobs = [];
    return false;
  }
}
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------------------------------------------------------------- camera
const _cam = new THREE.Vector3(), _look = new THREE.Vector3(), _qq = new THREE.Quaternion(), _e = new THREE.Euler();
// camera shake: knocks, dumps and falling trees jolt the view (less the further away they are), and an engine pulling
// hard makes it tremble
let camJolt = 0, camFov = 55;
function quake(x, y, z, amt) {
  const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  camJolt = Math.min(1, Math.max(camJolt, amt / (1 + d * d / 250)));
}
function shakeCamera(dt, m) {
  camJolt *= Math.exp(-dt * 5.5);
  const rumble = (m.strain || 0) * .06 + Math.min(1, m.digSm * .25) * .08 + (m.hp > 0 ? .008 : 0), a = camJolt + rumble * (cabView ? 1 : .35);
  if (a > .002) {
    const t = simTime, k = cabView ? .012 : .02;
    camera.rotateX((Math.sin(t * 61.3) + Math.sin(t * 37.7 + 1.1)) * a * k * .5);
    camera.rotateY((Math.sin(t * 53.1 + 2.2) + Math.sin(t * 29.9)) * a * k * .35);
    camera.rotateZ((Math.sin(t * 47.9 + .7) + Math.sin(t * 23.3 + 4.)) * a * k * .3);
  }
  // the view opens up a little with speed
  const want = (cabView ? 62 : 55) + clamp(Math.abs(m.v) / 11, 0, 1) * 7;
  camFov = lerp(camFov, want, 1 - Math.exp(-dt * 2.5));
  if (Math.abs(camera.fov - camFov) > .02) { camera.fov = camFov; camera.updateProjectionMatrix(); }
}
function updateCamera(dt) {
  if (boss) {   // looking down on the valley from behind and above the point being watched
    if (camera.near !== .3) { camera.near = .3; camera.updateProjectionMatrix(); }
    bossCam.x = clamp(bossCam.x, 0, N); bossCam.z = clamp(bossCam.z, 0, N);
    const pitch = .95 + bossCam.dist / 450, d = bossCam.dist, gy = hAt(bossCam.x, bossCam.z);
    _cam.set(bossCam.x + Math.sin(bossCam.yaw) * Math.cos(pitch) * d, gy + Math.sin(pitch) * d, bossCam.z + Math.cos(bossCam.yaw) * Math.cos(pitch) * d);
    _cam.y = Math.max(_cam.y, hAt(_cam.x, _cam.z) + 4);
    camera.position.lerp(_cam, 1 - Math.exp(-dt * 8));
    _look.set(bossCam.x, gy, bossCam.z); camera.lookAt(_look);
    camJolt = 0;
    if (Math.abs(camera.fov - 50) > .02) { camera.fov = camFov = 50; camera.updateProjectionMatrix(); }
    return;
  }
  const m = machines[active];
  const near = cabView ? .05 : .1;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  if (cabView) {
    m.cab.getWorldPosition(_cam);
    m.cab.getWorldQuaternion(_qq);
    camera.position.copy(_cam);
    camera.quaternion.copy(_qq);
    camera.rotateY(Math.PI + camOff);       // the machine faces +z, the camera looks down -z
    camera.rotateX(-(camPitch - .42) * .8 - .12);
    shakeCamera(dt, m);
    return;
  }
  const baseYaw = m.type === 'excavator' ? m.yaw + m.swing : m.yaw;
  camYawSm += angWrap(baseYaw - camYawSm) * (1 - Math.exp(-dt * 3));
  if (performance.now() - lastDrag > 2500 && Math.abs(m.v) > .6) camOff *= Math.exp(-dt * .8);
  const yaw = camYawSm + Math.PI + camOff;
  const tx = m.x, ty = m.y + 2.2, tz = m.z;
  const cp = Math.cos(camPitch);
  _cam.set(tx + Math.sin(yaw) * cp * camDist, ty + Math.sin(camPitch) * camDist, tz + Math.cos(yaw) * cp * camDist);
  const gy = hAt(_cam.x, _cam.z) + 1.2;
  if (_cam.y < gy) _cam.y = gy;
  camera.position.lerp(_cam, 1 - Math.exp(-dt * 7));
  _look.set(tx, ty, tz);
  camera.lookAt(_look);
  shakeCamera(dt, m);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- tags over jobs
const _tv = new THREE.Vector3();
function updateTags() {
  const w = innerWidth, h = innerHeight;
  for (const j of jobs) {
    const cx = (j.x0 + j.x1) / 2, cz = (j.z0 + j.z1) / 2;
    _tv.set(cx, Math.max(hAt(cx, cz), j.target ?? -1e9) + 3.2, cz).project(camera);
    const vis = _tv.z < 1 && Math.abs(_tv.x) < 1.1 && Math.abs(_tv.y) < 1.1;
    j.tag.style.display = vis ? 'block' : 'none';
    if (vis) {
      j.tag.style.left = ((_tv.x + 1) / 2 * w).toFixed(0) + 'px';
      j.tag.style.top = ((1 - _tv.y) / 2 * h).toFixed(0) + 'px';
      const txt = `${SHORT[j.type]} ${Math.round(j.prog * 100)}%`;
      if (j.tag.textContent !== txt) j.tag.textContent = txt;
    }
  }
}

// ---------------------------------------------------------------- sound
const snd = new Sound();
// heavy things landing are felt as well as heard: a dumped load or a bucket biting in jolts the view
{ const dump = snd.dump.bind(snd), scoop = snd.scoop.bind(snd);
  snd.dump = (x, y, z, vol, gravel) => { quake(x, y, z, clamp(vol * .1, .12, .55)); dump(x, y, z, vol, gravel); };
  snd.scoop = (x, y, z, gravel) => { quake(x, y, z, .16); scoop(x, y, z, gravel); }; }
let muted = localStorage.getItem('groundwork.muted') === '1';
snd.muted = muted;
$('mSound').textContent = 'Sound: ' + (muted ? 'off' : 'on');
const ENGINE = {
  dozer: { cyl: 6, idle: 640, max: 1900, tone: 240, vol: .55 },
  loader: { cyl: 6, idle: 740, max: 2150, tone: 300, vol: .5 },
  excavator: { cyl: 6, idle: 820, max: 1950, tone: 280, vol: .5 },
  hauler: { cyl: 6, idle: 680, max: 2100, tone: 260, vol: .55 },
  roller: { cyl: 4, idle: 800, max: 2200, tone: 320, vol: .4 },
  paver: { cyl: 6, idle: 780, max: 2100, tone: 300, vol: .42 },
  mixer: { cyl: 6, idle: 650, max: 2000, tone: 250, vol: .45 },
  crane: { cyl: 6, idle: 620, max: 1900, tone: 230, vol: .45 },
  truck: { cyl: 6, idle: 720, max: 2600, tone: 340, vol: .35 },
  logtruck: { cyl: 6, idle: 680, max: 2400, tone: 300, vol: .4 },
};
function audioStart() {
  snd.start();
  if (snd.ready) for (const m of machines) snd.machine(m.id, ENGINE[m.type]);
}
function toggleSound() {
  muted = !muted; localStorage.setItem('groundwork.muted', muted ? '1' : '0');
  snd.setMuted(muted);
  $('mSound').textContent = 'Sound: ' + (muted ? 'off' : 'on');
}
document.addEventListener('visibilitychange', () => snd.pause(document.hidden));
let riverTimer = 0, riverInfo = null;
function riverNear(p) {
  let sw = 0, sx = 0, sz = 0, sy = 0;
  const i0 = Math.max(0, Math.floor(p.x - 45)), i1 = Math.min(N - 1, Math.ceil(p.x + 45)), j0 = Math.max(0, Math.floor(p.z - 45)), j1 = Math.min(N - 1, Math.ceil(p.z + 45));
  for (let j = j0; j <= j1; j += 3) for (let i = i0; i <= i1; i += 3) {
    const k = j * N + i; if (W[k] < .05) continue;
    const sp = Math.hypot(FR[k] - FL[k], FD[k] - FU[k]) / Math.max(W[k], .1);
    const w = Math.min(W[k], 1.5) * (.3 + Math.min(sp, 2)) / (1 + Math.hypot(i - p.x, j - p.z) / 8);
    sw += w; sx += i * w; sz += j * w; sy += (H[k] + W[k]) * w;
  }
  if (sw <= 0) return { x: p.x, y: p.y, z: p.z, amount: 0 };
  return { x: sx / sw, y: sy / sw, z: sz / sw, amount: clamp(sw / 6, 0, 1) };
}
function updateSound(dt) {
  if (!snd.ready) return;
  const me = boss ? null : machines[active];
  for (const m of machines) {
    const s = SPEC[m.type], act = m === me || !!m.ai, inpM = m.ctl || ZERO;
    const rpm = clamp((act ? .06 + Math.abs(m.v) / s.vmax * .5 + Math.abs(inpM.throttle) * .3 : 0) + m.workSm * .45 + m.hydSm * .3, 0, 1);
    const load = clamp(Math.abs(inpM.throttle) * .45 + m.workSm * .75 + m.hydSm * .2 + (m.strain || 0) * .35, 0, 1);
    m.exhaust.getWorldPosition(_w);
    snd.updateMachine(m.id, {
      x: _w.x, y: _w.y, z: _w.z, rpm, load, hyd: m.hydSm, hydLoad: m.workSm * (m.hydSm > .1 ? 1 : .3),
      dig: m.digSm, gravel: m.digSm > .01 ? clamp(m.digGSm / m.digSm, 0, 1) : (m.pourG ? 1 : 0), pour: m.pourSm,
      track: m.trackSpeed, reverse: m.v < -.15, active: m === me,
    }, dt);
  }
  snd.listener(camera);
  riverTimer -= dt;
  if (riverTimer <= 0) { riverTimer = .5; riverInfo = riverNear(camera.position); }
  snd.updateAmbient(dt, camera, riverInfo, { x: MARSH.x, y: MARSH_LEVEL.v, z: MARSH.z, wet: W[cellOf(MARSH.x, MARSH.z)] > .2 });
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), waterAcc = 0, saveTimer = 5, relaxFlip = 0, ringTimer = 0, scanTimer = 0;
const _bs = new THREE.Vector2();
let curDt = 1 / 30;
function update(dt, draw = true) {
  simTime += dt; curDt = dt;
  const me = boss ? null : machines[active];
  for (const m of machines) {
    m.dig = 0; m.digG = 0; m.pour = 0; m.hyd = 0;
    // the body's sway, bounce and engine shake are for the eye only: the work (where a bucket tip or blade edge is)
    // is always measured from the machine sitting square on the ground
    if (m.swayed) { m.group.position.set(m.x, m.y, m.z); m.group.rotation.set(-m.pitch, m.yaw, m.roll, 'YXZ'); m.group.updateMatrixWorld(true); m.swayed = false; }
  }
  crew.update(dt);
  people.update(dt);
  for (const m of machines) {
    m.ctl = m.hp <= 0 ? ZERO : m === me ? inp : (m.ai || ZERO);
    drive(m, dt, m.ctl);
  }
  for (const m of machines) {
    const isMe = m === me, driven = isMe || !!m.ai;
    TOOL[m.type](m, dt, m.ctl);
    const k = 1 - Math.exp(-dt * 7);
    m.workSm = lerp(m.workSm, m.work, k); m.work = Math.max(0, m.work - dt * 2.5);
    m.hydSm = lerp(m.hydSm, m.hyd, k);
    const idt = 1 / Math.max(dt, 1e-3);
    m.digSm = lerp(m.digSm, m.dig * idt, k); m.digGSm = lerp(m.digGSm || 0, m.digG * idt, k);
    m.pourSm = lerp(m.pourSm, m.pour * idt, k);
    m.grime = clamp(m.grime + m.dig * .004 + m.pour * .001, .12, 1);
    poseMachine(m, dt, m.ctl);
    machineFx(m, dt, driven);
  }
  updateWorkers();
  ring.visible = !!me && me.type === 'excavator' && !!me.target;
  if (ring.visible) ring.position.set(me.target[0], me.target[1] + .08, me.target[2]);

  waterAcc += dt * 2;
  let steps = 0;
  while (waterAcc >= .04 && steps < 4) { waterStep(.04); waterAcc -= .04; steps++; }
  if (steps === 4) waterAcc = 0;
  scanTimer -= dt;
  if (scanTimer <= 0) { scanTimer = .5; scanWater(); }
  relaxFlip ^= 1;
  slumpBudget = draw ? 3 : 0;
  if (relaxFlip) relax();

  updatePour(dt);
  updateTrees(dt, anyDirty && draw);
  updateParticles(dt);
  updateChunks(dt);
  updatePrints();
  updateJobs(dt);
  updateGoal(dt);
  saveTimer -= dt;
  if (saveTimer <= 0) { saveTimer = 5; save(); }
  if (!draw) return;   // fast-forward: the in-between steps only run the world, the last one draws it
  const changed = anyDirty; anyDirty = false;
  if (dirtBox && grassAt && dirtBox[1] > grassAt[0] - Q.grassR && dirtBox[0] < grassAt[0] + Q.grassR && dirtBox[3] > grassAt[1] - Q.grassR && dirtBox[2] < grassAt[1] + Q.grassR) grassDirty = true;
  dirtBox = null;
  updateTerrainChunks(dt, camera.position);
  if (edgeDirty) { ringDirty = true; edgeDirty = false; }
  ringTimer -= dt;
  if (ringDirty && ringTimer <= 0) { ringTimer = 2; updateRing(); }
  updateRocks(dt, changed);
  treeFade(dt);
  updateMap(dt);
  updateCamera(dt);
  const fo = me || { x: bossCam.x, y: hAt(bossCam.x, bossCam.z), z: bossCam.z, v: 0, yaw: 0 };   // what the view is centred on
  updateGrass(dt, fo);
  aimSun(fo.x, fo.y, fo.z);
  T.clouds.offset.x = simTime * .0012; T.clouds.offset.y = simTime * .0005;
  waterMat.uniforms.uTime.value = simTime; grassU.uTime.value = simTime; windU.uTime.value = simTime;
  updateHud(dt);
  updateSound(dt);
}
let paused = false, speed = 1;
function setSpeed(v) {
  speed = v; const b = $('spdBtn'); if (b) { b.textContent = speed + 'X'; b.classList.toggle('on', speed > 1); }
}
// automatic sharpness: a phone that can't keep up draws at a slightly lower resolution (and goes back up when it can)
// it never goes below 1.25x on a phone (lower looks smeared on a small sharp screen)
const dprMax = Math.min(devicePixelRatio, isTouch && quality !== 'low' ? 2 : Q.dpr), dprMin = Math.min(dprMax, isTouch ? 1.25 : 1);
let dprNow = dprMax, frameAvg = 16, resT = 0;
function adaptRes(ms) {
  frameAvg += (Math.min(ms, 100) - frameAvg) * .05; resT += ms;
  if (resT < 2000 || document.hidden) return;
  resT = 0;
  let next = dprNow;
  if (frameAvg > 30) next = Math.max(dprMin, dprNow - .1);
  else if (frameAvg < 14.5) next = Math.min(dprMax, dprNow + .1);
  if (Math.abs(next - dprNow) > .01) { dprNow = next; renderer.setPixelRatio(dprNow); resize(); }
}
function frame(now) {
  const ms = now - last;
  const dt = Math.min(.05, ms / 1000); last = now;
  if (paused || dt <= 0) { requestAnimationFrame(frame); return; }
  adaptRes(ms);
  readInput();
  for (let i = 0; i < speed; i++) update(dt, i === speed - 1);
  drawFrame();
  updateTags();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
function start() {
  resize();
  const resumed = load();
  if (!resumed) {
    generate(seed, true);
    for (const t of trees) t.y = hAt(t.x, t.z) - .15;
    resetMachines();
  }
  buildTreeMeshes();
  buildRocks();
  scanWater();
  goalSetup();
  updateTerrainChunks(0, machines[active], true);
  updateRing(); buildFarForest();
  if (mapCv) mapCv.style.display = mapOn ? 'block' : 'none';
  for (const m of machines) poseMachine(m, 0, ZERO);
  crew.restore(crewSave);
  people.restore(peopleSave);
  setCrew(localStorage.getItem('groundwork.crew') === '1' || boss, true);
  select(active, true);
  document.body.classList.toggle('boss', boss);
  { const m = machines[active]; bossCam.x = m.x; bossCam.z = m.z - 10; }
  checkContract();
  for (const j of jobs) j.prog = jobProgress(j);
  renderJobs();
  camYawSm = machines[active].yaw;
  updateCamera(1);
  camera.position.copy(_cam);
  $('loading').style.display = 'none';
  if (!resumed && !localStorage.getItem('groundwork.seenHelp')) showHelp(true);
  if (!resumed) save();
  // test hook: run the game forward without drawing (used by the automated checks)
  window.GW = { prints: treadIM, post: POST, SPRINGS, drop: (x, z, v) => dropCircle({ v, g: 0 }, x, z, 6, v), people, works, CULVERTS, DECK, get eroded() { return eroded; }, flux: { FL, FR, FU, FD }, H0, crew, setCrew, dirty, snd, goal, GOALS, RIVERS, YARD, GRAVEL, CAMP, MARSH, SPEC, riverAt, tchunks, machines, H, W, M, D, BED, stats, hAt, select, save, trees, rocks, renderer, scene, camera, get jobs() { return jobs; }, get active() { return active; }, setBoss, get boss() { return boss; }, bossCam, bossTap, groundAt, doOrder, contract, CONTRACTS, checkContract, riverSpot,
    draw(n = 1) { for (let i = 0; i < n; i++) { Object.assign(inp, ZERO); update(1 / 30, true); } drawFrame(); },   // tests: one drawn frame while paused
    step(n, input = {}) { for (let i = 0; i < n; i++) { Object.assign(inp, ZERO, input); if (i > 0) inp.act = false; update(1 / 30); } },
    pause(on) { paused = !!on; },
    cab(on) { cabView = !!on; },
    camSet(off, pitch, dist) { camOff = off; camPitch = pitch; camDist = dist; lastDrag = performance.now(); },
    render() { updateCamera(1); camera.position.copy(_cam); drawFrame(); } };
  requestAnimationFrame(t => { last = t; frame(t); });
}
setTimeout(start, 30);
