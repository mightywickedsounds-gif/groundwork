// Groundwork: a valley you dig. The ground is a height grid; dirt that is piled too steep slides,
// water flows over it (a "virtual pipes" shallow-water model), and the whole valley is saved in the
// browser so nothing ever resets.
import * as THREE from 'three';

const N = 160, NN = N * N;           // 160 x 160 cells, 1 m each
const SAVE_KEY = 'groundwork.save.v1';
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
const H = new Float32Array(NN);      // ground height
const W = new Float32Array(NN);      // water depth
const BED = new Float32Array(NN);    // can't dig below this
const M = new Uint8Array(NN);        // top material: 0 grass, 1 dirt, 2 gravel
const D = new Uint8Array(NN);        // 1 = disturbed (no grass)
const TINT = new Float32Array(NN);   // colour variation
const RD = new Float32Array(NN);     // distance to the original river line
const FL = new Float32Array(NN), FR = new Float32Array(NN), FU = new Float32Array(NN), FD = new Float32Array(NN);
const SPRING = [];
const GRAVEL = { x: 36, z: 42, r: 16, h: 8 };
const YARD = { x0: 68, x1: 98, z0: 122, z1: 144 };
const riverZ = x => N * .55 + Math.sin(x / 23) * 12 + Math.sin(x / 9 + 1) * 3;
const bedLevel = x => 7 + (N - x) * .02;
const inYard = (x, z, m = 0) => x > YARD.x0 - m && x < YARD.x1 + m && z > YARD.z0 - m && z < YARD.z1 + m;
let seed = 1 + Math.floor(Math.random() * 1e6);

function hAt(x, z) {
  x = clamp(x, 0, N - 1.001); z = clamp(z, 0, N - 1.001);
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, k = j * N + i;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const cellOf = (x, z) => clamp(Math.round(z), 0, N - 1) * N + clamp(Math.round(x), 0, N - 1);
const wAt = (x, z) => W[cellOf(x, z)];

let dMinI = 0, dMaxI = N - 1, dMinJ = 0, dMaxJ = N - 1;
function dirty(k) {
  const i = k % N, j = (k / N) | 0;
  if (i < dMinI) dMinI = i; if (i > dMaxI) dMaxI = i; if (j < dMinJ) dMinJ = j; if (j > dMaxJ) dMaxJ = j;
}

// ---------------------------------------------------------------- generation
let noiseFn = null;
function generate(sd, settle) {
  const nz = makeNoise(sd), rnd = mulberry32(sd * 7 + 3);
  noiseFn = nz;
  M.fill(0); D.fill(0); W.fill(0); FL.fill(0); FR.fill(0); FU.fill(0); FD.fill(0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    let best = 1e9;
    for (let dx = -14; dx <= 14; dx++) { const dz = j - riverZ(i + dx); const d = dx * dx + dz * dz; if (d < best) best = d; }
    const d = Math.sqrt(best); RD[k] = d;
    const amp = clamp(d / 28, .35, 1);
    const g = 11.5 + (N - i) * .02 + nz(i / 45, j / 45, 4) * 7 * amp + nz(i / 11 + 50, j / 11, 2) * 1.1;
    let h = g;
    if (d < 11) { const t = d / 11, bed = bedLevel(i); h = Math.min(g, bed + t * t * (g - bed)); }
    const base = h;
    const gd = Math.hypot(i - GRAVEL.x, j - GRAVEL.z);
    if (gd < GRAVEL.r) {
      const add = GRAVEL.h * Math.pow(1 - gd / GRAVEL.r, 1.3) + nz(i / 4, j / 4, 2) * .8;
      if (add > .25) { h += add; M[k] = 2; }
    }
    H[k] = h; BED[k] = base - 5;
    TINT[k] = nz(i / 7 + 20, j / 7 + 20, 2) + nz(i * .9, j * .9, 1) * .35;
  }
  // flatten the yard where the machines park
  let s = 0, n = 0;
  for (let j = YARD.z0; j <= YARD.z1; j++) for (let i = YARD.x0; i <= YARD.x1; i++) { s += H[j * N + i]; n++; }
  const ym = s / n;
  for (let j = YARD.z0 - 7; j <= YARD.z1 + 7; j++) for (let i = YARD.x0 - 7; i <= YARD.x1 + 7; i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const k = j * N + i;
    const e = Math.max(YARD.x0 - i, i - YARD.x1, YARD.z0 - j, j - YARD.z1, 0);
    let t = clamp(1 - e / 7, 0, 1); t = t * t * (3 - 2 * t);
    H[k] = lerp(H[k], ym, t); BED[k] = Math.min(BED[k], H[k] - 5);
    if (e === 0) { M[k] = 1; D[k] = 1; }
  }
  // the river
  for (let k = 0; k < NN; k++) {
    if (RD[k] < 7) { const lvl = bedLevel(k % N) + 1.3; if (lvl > H[k]) W[k] = lvl - H[k]; }
  }
  SPRING.length = 0;
  for (let j = 0; j < N; j++) { const k = j * N + 1; if (RD[k] < 3) SPRING.push(k); }
  makeTrees(nz, rnd);
  if (settle) {
    for (let it = 0; it < 120; it++) relax(true);
    for (let it = 0; it < 300; it++) waterStep(.06);
  }
}

// ---------------------------------------------------------------- dirt sliding
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
    }
    dirty(a); dirty(b);
  }
  return true;
}
function pair(a, b, gen) {
  const d = H[a] - H[b];
  const t = (W[a] > .05 || W[b] > .05) ? .62 : .92;   // steepest a pile can stand: wet soil less
  if (d > t) return slide(a, b, (d - t) * .22, gen);
  if (-d > t) return slide(b, a, (-d - t) * .22, gen);
  return false;
}
function relax(gen) {
  let moved = false;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (i < N - 1 && pair(k, k + 1, gen)) moved = true;
    if (j < N - 1 && pair(k, k + N, gen)) moved = true;
  }
  return moved;
}

// ---------------------------------------------------------------- water
function waterStep(dt) {
  const K = dt * 9.81, damp = .996;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
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
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
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
  }
  for (const k of SPRING) if (W[k] < 3) W[k] += SPRING_Q * dt / SPRING.length;
}

// ---------------------------------------------------------------- trees
const trees = [];
const treeGrid = new Int16Array(NN).fill(-1);
function makeTrees(nz, rnd) {
  trees.length = 0; treeGrid.fill(-1);
  for (let a = 0; a < 7000 && trees.length < 760; a++) {
    const x = 2 + rnd() * (N - 4), z = 2 + rnd() * (N - 4);
    const k = cellOf(x, z);
    if (RD[k] < 12.5 || M[k] === 2 || inYard(x, z, 9)) continue;
    if (Math.hypot(x - GRAVEL.x, z - GRAVEL.z) < GRAVEL.r + 2) continue;
    if (nz(x / 22 + 7, z / 22 + 3, 2) < -.04 && rnd() < .85) continue;
    const i = k % N, j = (k / N) | 0;
    let ok = true;
    for (let dj = -2; dj <= 2 && ok; dj++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < N && jj < N && treeGrid[jj * N + ii] >= 0) { ok = false; break; }
    }
    if (!ok) continue;
    treeGrid[k] = trees.length;
    trees.push({ x, z, k, s: .75 + rnd() * .6, r: rnd() * 6.28, st: 0, a: 0, dx: 1, dz: 0, t: 0, g: 1, y: 0, dirty: true, hue: rnd() });
  }
}
function treeFall(t, fx, fz) {
  if (t.st !== 0) return;
  let dx = t.x - fx, dz = t.z - fz; const l = Math.hypot(dx, dz) || 1;
  if (l < .01) { dx = 1; dz = 0; }
  t.dx = dx / l; t.dz = dz / l; t.st = 1; t.a = 0; t.y = hAt(t.x, t.z) - .1; t.dirty = true;
  treeGrid[t.k] = -1;
  dust(t.x, t.y + .5, t.z, 10, [.45, .4, .3]);
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
  H[k] -= amount; if (M[k] === 0) M[k] = 1; D[k] = 1;
  L.v += amount; if (gravel) L.g += amount;
  dirty(k);
  if (treeGrid[k] >= 0) treeFallAt(k);
  return amount;
}
function giveTo(L, k, amount) {
  amount = Math.min(amount, L.v);
  if (amount <= 0) return 0;
  const g = L.g * (amount / L.v);
  const mat = loadMat(L);
  L.v -= amount; L.g -= g;
  if (L.v < 1e-4) { L.v = 0; L.g = 0; }
  H[k] += amount;
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
    if (a > 0) { list.push([k, a]); total += a; }
  });
  if (total <= 0) return 0;
  const sc = Math.min(1, maxV / total);
  let got = 0;
  for (const [k, a] of list) got += takeFrom(L, k, a * sc);
  return got;
}
function dropCircle(L, x, z, r, vol) {
  vol = Math.min(vol, L.v);
  if (vol <= 0) return 0;
  const list = []; let sw = 0;
  cellsInCircle(x, z, r, (k, f) => { const w = 1 - f * f * .85; list.push([k, w]); sw += w; });
  if (!list.length) { list.push([cellOf(x, z), 1]); sw = 1; }
  let put = 0; const total = vol;
  for (const [k, w] of list) put += giveTo(L, k, total * w / sw);
  return put;
}

// ---------------------------------------------------------------- three.js scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xe8dcc6);
scene.fog = new THREE.Fog(HORIZON, 150, 480);
const camera = new THREE.PerspectiveCamera(55, 1, .1, 3000);

{ // sky dome
  const g = new THREE.SphereGeometry(1400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5d93c9) }, mid: { value: HORIZON }, bot: { value: new THREE.Color(0xc4b49c) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0. ? mix(mid, top, pow(clamp(h*1.6,0.,1.),.7)) : mix(mid, bot, clamp(-h*3.,0.,1.)); gl_FragColor = vec4(c,1.); }',
  });
  const sky = new THREE.Mesh(g, m); sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  scene.userData.sky = sky;
}
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6b5a45, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2bd, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 320 });
sun.shadow.bias = -.0005; sun.shadow.normalBias = .06;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-.55, .75, .38).normalize();

// terrain + water meshes share one index buffer
const index = new Uint32Array((N - 1) * (N - 1) * 6);
{ let p = 0; for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; index.set([a, c, b, b, c, d], p); p += 6; } }
const idxAttr = new THREE.BufferAttribute(index, 1);
const tPos = new Float32Array(NN * 3), tCol = new Float32Array(NN * 3);
const wPos = new Float32Array(NN * 3), wCol = new Float32Array(NN * 4);
for (let k = 0; k < NN; k++) { tPos[k * 3] = wPos[k * 3] = k % N; tPos[k * 3 + 2] = wPos[k * 3 + 2] = (k / N) | 0; }
const tGeo = new THREE.BufferGeometry();
tGeo.setIndex(idxAttr);
tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .96, metalness: 0 }));
terrain.receiveShadow = true; terrain.castShadow = true; terrain.frustumCulled = false;
scene.add(terrain);
const wGeo = new THREE.BufferGeometry();
wGeo.setIndex(idxAttr);
wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage));
wGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 4).setUsage(THREE.DynamicDrawUsage));
const water = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, flatShading: true, roughness: .12, metalness: .05, depthWrite: false }));
water.frustumCulled = false; water.receiveShadow = true; water.renderOrder = 2;
scene.add(water);

// soil walls around the edge of the valley (it sits like a cut-out block)
const EDGE = [];
for (let i = 0; i < N; i++) EDGE.push(i);                       // z = 0
for (let j = 0; j < N; j++) EDGE.push(j * N + N - 1);           // x = max
for (let i = N - 1; i >= 0; i--) EDGE.push((N - 1) * N + i);    // z = max
for (let j = N - 1; j >= 0; j--) EDGE.push(j * N);              // x = 0
const sPos = new Float32Array(EDGE.length * 3 * 3), sCol = new Float32Array(EDGE.length * 3 * 3);
const sIdx = [];
for (let e = 0; e < EDGE.length; e++) {
  const k = EDGE[e], x = k % N, z = (k / N) | 0;
  for (let r = 0; r < 3; r++) {
    const v = e * 3 + r;
    sPos[v * 3] = x; sPos[v * 3 + 2] = z; sPos[v * 3 + 1] = [0, 3, -4][r];
    const c = [[.42, .28, .17], [.3, .2, .13], [.2, .14, .1]][r];
    sCol.set(c, v * 3);
  }
  if (e < EDGE.length - 1) for (let r = 0; r < 2; r++) {
    const a = e * 3 + r, b = a + 1, c = a + 3, d = b + 3;
    sIdx.push(a, b, c, c, b, d);
  }
}
const sGeo = new THREE.BufferGeometry();
sGeo.setIndex(sIdx);
sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
const skirt = new THREE.Mesh(sGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, flatShading: true }));
skirt.frustumCulled = false;
scene.add(skirt);
{
  const base = new THREE.Mesh(new THREE.PlaneGeometry(N - 1, N - 1).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }));
  base.position.set((N - 1) / 2, -4, (N - 1) / 2); scene.add(base);
}

function updateSkirt() {
  for (let e = 0; e < EDGE.length; e++) {
    const k = EDGE[e], h = H[k];
    sPos[(e * 3) * 3 + 1] = h;
    sPos[(e * 3 + 1) * 3 + 1] = h - 1.4;
    sPos[(e * 3 + 2) * 3 + 1] = -4;
  }
  sGeo.attributes.position.needsUpdate = true;
}

function cellColor(k, i, j, o) {
  const t = TINT[k];
  let r, g, b;
  const sl = (i > 0 && i < N - 1 && j > 0 && j < N - 1) ? Math.abs(H[k + 1] - H[k - 1]) + Math.abs(H[k + N] - H[k - N]) : 0;
  if (M[k] === 2) { r = .6 + t * .09; g = .58 + t * .09; b = .54 + t * .08; }
  else if (M[k] === 1 || D[k]) { r = .55 + t * .07; g = .35 + t * .05; b = .21 + t * .04; }
  else {
    r = .37 + t * .12; g = .55 + t * .13; b = .2 + t * .05;
    if (sl > 1.1) { const f = clamp((sl - 1.1) / 1.2, 0, .8); r = lerp(r, .5, f); g = lerp(g, .36, f); b = lerp(b, .22, f); }
  }
  const w = W[k];
  if (w > .02) {
    if (M[k] === 0 && !D[k]) { r = .46; g = .42; b = .3; }
    const f = clamp(.75 - w * .12, .45, .75); r *= f; g *= f * 1.02; b *= f * 1.05;
  } else if (M[k] !== 2) {
    // damp ground next to water
    const wet = (i > 0 && W[k - 1] > .02) || (i < N - 1 && W[k + 1] > .02) || (j > 0 && W[k - N] > .02) || (j < N - 1 && W[k + N] > .02);
    if (wet) { r *= .82; g *= .84; b *= .86; }
  }
  o[0] = r; o[1] = g; o[2] = b;
}
const tmpC = [0, 0, 0];
function updateTerrain() {
  if (dMaxI < dMinI) return;
  const i0 = Math.max(0, dMinI - 1), i1 = Math.min(N - 1, dMaxI + 1), j0 = Math.max(0, dMinJ - 1), j1 = Math.min(N - 1, dMaxJ + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * N + i;
    tPos[k * 3 + 1] = H[k];
    cellColor(k, i, j, tmpC);
    tCol[k * 3] = tmpC[0]; tCol[k * 3 + 1] = tmpC[1]; tCol[k * 3 + 2] = tmpC[2];
  }
  tGeo.attributes.position.needsUpdate = true;
  tGeo.attributes.color.needsUpdate = true;
  if (i0 === 0 || j0 === 0 || i1 === N - 1 || j1 === N - 1) updateSkirt();
  dMinI = N; dMaxI = -1; dMinJ = N; dMaxJ = -1;
}
let waterColorTick = 0;
function updateWater() {
  waterColorTick++;
  const doCol = true;
  for (let k = 0; k < NN; k++) {
    const w = W[k];
    const wet = w > .015;
    wPos[k * 3 + 1] = wet ? H[k] + w : H[k] - .25;
    if (doCol) {
      const o = k * 4;
      if (!wet) { wCol[o + 3] = 0; continue; }
      const f = clamp(w / 2.2, 0, 1);
      wCol[o] = lerp(.36, .1, f); wCol[o + 1] = lerp(.6, .3, f); wCol[o + 2] = lerp(.58, .44, f);
      wCol[o + 3] = clamp(.35 + w * .5, .35, .88);
    }
  }
  wGeo.attributes.position.needsUpdate = true;
  wGeo.attributes.color.needsUpdate = true;
  // the river colours the bank, so recolour terrain cells with water now and then
  if (waterColorTick % 30 === 0) { dMinI = 0; dMaxI = N - 1; dMinJ = 0; dMaxJ = N - 1; }
}

// ---------------------------------------------------------------- tree meshes
let trunkIM, crownIM, crown2IM;
function buildTreeMeshes() {
  for (const im of [trunkIM, crownIM, crown2IM]) if (im) { scene.remove(im); im.dispose(); }
  const trunkG = new THREE.CylinderGeometry(.16, .27, 2.2, 6).translate(0, 1.1, 0);
  const c1 = new THREE.ConeGeometry(1.7, 3.8, 7).translate(0, 3.7, 0);
  const c2 = new THREE.ConeGeometry(1.2, 3.0, 7).translate(0, 5.6, 0);
  trunkIM = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1, flatShading: true }), trees.length);
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, flatShading: true });
  crownIM = new THREE.InstancedMesh(c1, cm, trees.length);
  crown2IM = new THREE.InstancedMesh(c2, cm, trees.length);
  const col = new THREE.Color();
  trees.forEach((t, i) => {
    col.setHSL(.27 + t.hue * .07, .42 + t.hue * .15, .2 + t.hue * .08);
    crownIM.setColorAt(i, col);
    col.offsetHSL(.01, 0, .04);
    crown2IM.setColorAt(i, col);
    t.dirty = true;
  });
  for (const im of [trunkIM, crownIM, crown2IM]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); }
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
let treeHeightTimer = 0;
function updateTrees(dt, terrainChanged) {
  treeHeightTimer -= dt;
  const refresh = terrainChanged && treeHeightTimer <= 0;
  if (refresh) treeHeightTimer = .4;
  let any = false;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t.st === 1) { t.a = Math.min(1, t.a + dt * (.5 + t.a * 2.6)); if (t.a >= 1) { t.st = 2; t.t = 0; } t.dirty = true; }
    else if (t.st === 2) { t.t += dt; if (t.t > 5) { t.g -= dt * .8; if (t.g <= 0) { t.g = 0; t.st = 3; } t.dirty = true; } }
    else if (t.st === 0 && refresh) {
      const y = hAt(t.x, t.z) - .1;
      if (Math.abs(y - t.y) > .01) { t.y = y; t.dirty = true; }
    }
    if (!t.dirty) continue;
    t.dirty = false; any = true;
    if (t.st === 3) { _m4.makeScale(0, 0, 0); }
    else {
      _q2.setFromAxisAngle(_ax.set(0, 1, 0), t.r);
      if (t.st > 0) { _q.setFromAxisAngle(_ax.set(t.dz, 0, -t.dx), t.a * 1.47); _q.multiply(_q2); } else _q.copy(_q2);
      const sc = t.s * t.g;
      _m4.compose(_v.set(t.x, t.y, t.z), _q, _s.set(sc, sc, sc));
    }
    trunkIM.setMatrixAt(i, _m4); crownIM.setMatrixAt(i, _m4); crown2IM.setMatrixAt(i, _m4);
  }
  if (any) for (const im of [trunkIM, crownIM, crown2IM]) im.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- dust
const PMAX = 600;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 4), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
const dustTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); return t;
})();
const dustPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .8, map: dustTex, alphaTest: .02, vertexColors: true, transparent: true, depthWrite: false }));
dustPts.frustumCulled = false;
scene.add(dustPts);
let pNext = 0;
function dust(x, y, z, n, c) {
  for (let q = 0; q < n; q++) {
    const p = pNext; pNext = (pNext + 1) % PMAX;
    pPos[p * 3] = x + (Math.random() - .5) * 1.4; pPos[p * 3 + 1] = y + Math.random() * .4; pPos[p * 3 + 2] = z + (Math.random() - .5) * 1.4;
    pVel[p * 3] = (Math.random() - .5) * 1.6; pVel[p * 3 + 1] = .6 + Math.random() * 1.6; pVel[p * 3 + 2] = (Math.random() - .5) * 1.6;
    pLife[p] = 1 + Math.random() * .6;
    pCol[p * 4] = c[0]; pCol[p * 4 + 1] = c[1]; pCol[p * 4 + 2] = c[2];
  }
}
const DIRT_C = [.55, .4, .28], GRAVEL_C = [.68, .66, .62];
function updateDust(dt) {
  for (let p = 0; p < PMAX; p++) {
    if (pLife[p] <= 0) { pCol[p * 4 + 3] = 0; continue; }
    pLife[p] -= dt;
    pVel[p * 3 + 1] -= 1.2 * dt;
    pPos[p * 3] += pVel[p * 3] * dt; pPos[p * 3 + 1] += pVel[p * 3 + 1] * dt; pPos[p * 3 + 2] += pVel[p * 3 + 2] * dt;
    pCol[p * 4 + 3] = clamp(pLife[p], 0, 1) * .55;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- machines
const MAT = {
  paint: new THREE.MeshStandardMaterial({ color: 0xdf7a2e, roughness: .5, metalness: .15, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: .85, flatShading: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: .38, metalness: .7, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x4b6a7c, roughness: .1, metalness: .2, transparent: true, opacity: .62 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: .95, flatShading: true }),
  cream: new THREE.MeshStandardMaterial({ color: 0xefe5cd, roughness: .6, flatShading: true }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x7c5435, roughness: 1, flatShading: true }),
  gravel: new THREE.MeshStandardMaterial({ color: 0x9c978e, roughness: 1, flatShading: true }),
};
function addBox(p, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
}
function addWheel(p, r, w, x, y, z, mat = MAT.tire, hubMat = MAT.paint) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), mat);
  m.position.set(x, y, z); m.castShadow = true; p.add(m);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * .45, r * .45, w + .04, 8).rotateZ(Math.PI / 2), hubMat);
  m.add(hub);
  return m;
}
function addCab(p, w, h, d, x, y, z) {
  addBox(p, w - .08, h, d - .08, MAT.glass, x, y + h / 2, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(p, .1, h, .1, MAT.paint, x + sx * (w / 2 - .05), y + h / 2, z + sz * (d / 2 - .05));
  addBox(p, w + .16, .14, d + .16, MAT.paint, x, y + h + .07, z);
}
function addTracks(g, half, len) {
  for (const s of [-1, 1]) {
    addBox(g, .78, .88, len, MAT.dark, s * half, .44, 0);
    for (const z of [-len / 2 + .35, len / 2 - .35]) addWheel(g, .42, .82, s * half, .44, z, MAT.steel, MAT.dark);
    addBox(g, .8, .1, len - .9, MAT.steel, s * half, .92, 0);
  }
}
const SPEC = {
  dozer: { name: 'Dozer', vmax: 3.6, acc: 2.5, turn: .85, tracks: true, len: 4.6, wid: 3.2, circ: [[1.2, 1.9], [-1.0, 1.7]], cap: 6, tool: 'Blade',
    hint: 'R/F blade up and down. Drive forward with the blade low to cut; over low ground it fills. Back up to leave the pile.' },
  loader: { name: 'Loader', vmax: 6, acc: 3, wb: 2.9, len: 5.4, wid: 2.8, circ: [[1.6, 1.6], [-1.5, 1.6]], cap: 3, tool: 'Bucket',
    hint: 'F lowers the bucket; drive into a pile to fill it. R raises it. Space dumps (into a hauler if one is under the bucket).' },
  excavator: { name: 'Excavator', vmax: 2.2, acc: 1.8, turn: .6, tracks: true, len: 4.4, wid: 3.2, circ: [[0, 2.2]], cap: 1.5, tool: 'Bucket',
    hint: 'Q/E swing, R/F reach out and in. Space digs, Space again dumps (into a hauler if it is under the bucket).' },
  hauler: { name: 'Hauler', vmax: 8.5, acc: 3, wb: 4.6, len: 8, wid: 3, circ: [[2.6, 1.6], [-.6, 1.6], [-3.2, 1.6]], cap: 12, tool: 'Bed',
    hint: 'Park next to the loader or excavator to get filled. Space tips the bed and dumps behind you; Space again lowers it.' },
};
const ORDER = ['dozer', 'loader', 'excavator', 'hauler'];

function buildDozer(m) {
  const g = new THREE.Group();
  addTracks(g, 1.2, 4.4);
  addBox(g, 1.7, .9, 3.6, MAT.paint, 0, 1.3, -.2);
  addBox(g, 1.55, .75, 1.7, MAT.paint, 0, 2.1, .8);
  addBox(g, 1.72, .1, 3.62, MAT.cream, 0, 1.72, -.2);
  addBox(g, 1.2, .5, .08, MAT.dark, 0, 2.05, 1.66);
  addBox(g, .14, .9, .14, MAT.dark, .5, 2.9, 1.2);
  addCab(g, 1.7, 1.25, 1.6, 0, 1.75, -.9);
  addBox(g, .2, 1.0, .3, MAT.dark, 0, .7, -2.55);
  addBox(g, 1.4, .25, .35, MAT.paint, 0, 1.15, -2.45);
  const blade = new THREE.Group(); blade.position.set(0, 0, 2.55); g.add(blade);
  addBox(blade, 3.8, 1.3, .26, MAT.paint, 0, .65, .15);
  addBox(blade, 3.8, .14, .34, MAT.steel, 0, .07, .2);
  for (const s of [-1, 1]) { addBox(blade, .12, 1.3, .55, MAT.paint, s * 1.88, .65, .4); addBox(blade, .2, .26, 2.3, MAT.dark, s * 1.3, .5, -1.05); }
  const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), MAT.dirt); pile.castShadow = true; blade.add(pile);
  const cab = new THREE.Object3D(); cab.position.set(0, 2.55, -.85); g.add(cab);
  Object.assign(m, { group: g, blade3: blade, pile, cab });
}
function buildLoader(m) {
  const g = new THREE.Group();
  addBox(g, 1.9, .9, 2.6, MAT.paint, 0, 1.3, -1.3);
  addBox(g, 1.75, .85, 1.9, MAT.paint, 0, 2.15, -1.75);
  addBox(g, 2.1, .9, .45, MAT.dark, 0, 1.35, -2.75);
  addBox(g, 1.92, .1, 2.62, MAT.cream, 0, 1.78, -1.3);
  addBox(g, 1.2, .7, 2.0, MAT.dark, 0, 1.15, .8);
  m.wheels = [];
  for (const s of [-1, 1]) for (const z of [1.3, -1.6]) { m.wheels.push(addWheel(g, .82, .62, s * 1.2, .82, z)); addBox(g, .72, .1, 1.7, MAT.paint, s * 1.2, 1.72, z); }
  addCab(g, 1.5, 1.35, 1.5, 0, 1.75, -.05);
  const arms = new THREE.Group(); arms.position.set(0, 1.75, 1.0); g.add(arms);
  for (const s of [-1, 1]) addBox(arms, .22, .3, 2.6, MAT.paint, s * .85, 0, 1.3);
  addBox(arms, 1.9, .2, .2, MAT.paint, 0, 0, 1.6);
  const bucket = new THREE.Group(); bucket.position.set(0, 0, 2.6); arms.add(bucket);
  addBox(bucket, 2.9, .12, 1.0, MAT.steel, 0, -.45, .45);
  addBox(bucket, 2.9, .95, .12, MAT.paint, 0, 0, 0);
  for (const s of [-1, 1]) addBox(bucket, .1, .95, 1.0, MAT.paint, s * 1.45, 0, .45);
  addBox(bucket, 2.9, .07, .14, MAT.steel, 0, -.45, .97);
  const bl = new THREE.Mesh(new THREE.BoxGeometry(2.6, .7, .85).translate(0, .35, 0), MAT.dirt); bl.position.set(0, -.42, .45); bl.castShadow = true; bucket.add(bl);
  const cab = new THREE.Object3D(); cab.position.set(0, 2.65, -.05); g.add(cab);
  Object.assign(m, { group: g, arms, bucket, bucketLoad: bl, cab });
}
function buildExcavator(m) {
  const g = new THREE.Group();
  addTracks(g, 1.25, 4.3);
  addBox(g, 1.6, .35, 2.6, MAT.dark, 0, .95, 0);
  const house = new THREE.Group(); house.position.set(0, 1.15, 0); g.add(house);
  addBox(house, 2.5, 1.0, 3.0, MAT.paint, 0, .55, -.45);
  addBox(house, 2.5, .95, .8, MAT.dark, 0, .6, -2.2);
  addBox(house, 2.52, .1, 3.02, MAT.cream, 0, .98, -.45);
  addCab(house, 1.05, 1.35, 1.4, .7, 1.05, .35);
  addBox(house, 1.2, .4, 1.5, MAT.paint, -.55, 1.25, -1.0);
  const boom = new THREE.Group(); boom.position.set(-.25, 1.0, 1.0); house.add(boom);
  addBox(boom, .42, .55, 4.6, MAT.paint, 0, 0, 2.3);
  addBox(boom, .12, .12, 2.6, MAT.steel, 0, -.4, 1.4);
  const stick = new THREE.Group(); stick.position.set(0, 0, 4.6); boom.add(stick);
  addBox(stick, .32, .42, 3.3, MAT.paint, 0, 0, 1.65);
  addBox(stick, .1, .1, 2.2, MAT.steel, 0, .32, 1.1);
  const bucket = new THREE.Group(); bucket.position.set(0, 0, 3.3); stick.add(bucket);
  addBox(bucket, 1.15, .65, .95, MAT.dark, 0, 0, .5);
  addBox(bucket, 1.15, .1, .2, MAT.steel, 0, -.28, 1.02);
  const bl = new THREE.Mesh(new THREE.BoxGeometry(1.0, .5, .8), MAT.dirt); bl.position.set(0, .4, .5); bl.castShadow = true; bucket.add(bl);
  const cab = new THREE.Object3D(); cab.position.set(.7, 2.05, .45); house.add(cab);
  Object.assign(m, { group: g, house, boom, stick, bucket, bucketLoad: bl, cab });
}
function buildHauler(m) {
  const g = new THREE.Group();
  addBox(g, 2.3, 1.1, 1.9, MAT.paint, 0, 1.65, 3.2);
  addBox(g, 1.8, .45, .1, MAT.dark, 0, 1.6, 4.17);
  addCab(g, 1.7, 1.25, 1.4, 0, 2.2, 2.25);
  addBox(g, .9, .6, 1.4, MAT.dark, 0, 1.25, 1.4);
  addBox(g, 1.6, .5, 5.4, MAT.dark, 0, 1.15, -1.6);
  m.wheels = [];
  for (const s of [-1, 1]) {
    for (const z of [3.1, -.8, -2.9]) m.wheels.push(addWheel(g, .88, .75, s * 1.3, .88, z));
    addBox(g, .8, .1, 1.9, MAT.paint, s * 1.3, 1.85, 3.1);
  }
  const bed = new THREE.Group(); bed.position.set(0, 1.62, -4.3); g.add(bed);
  addBox(bed, 2.7, .14, 5.6, MAT.paint, 0, 0, 2.8);
  for (const s of [-1, 1]) addBox(bed, .12, 1.25, 5.6, MAT.paint, s * 1.35, .62, 2.8);
  addBox(bed, 2.7, 1.55, .14, MAT.paint, 0, .78, 5.6);
  for (const s of [-1, 1]) addBox(bed, .2, .1, 5.62, MAT.cream, s * 1.35, 1.27, 2.8);
  const bl = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1, 5.3).translate(0, .5, 0), MAT.dirt); bl.position.set(0, .07, 2.75); bl.castShadow = true; bed.add(bl);
  const cab = new THREE.Object3D(); cab.position.set(0, 3.05, 2.25); g.add(cab);
  Object.assign(m, { group: g, bed, bedLoad: bl, cab });
}
const BUILD = { dozer: buildDozer, loader: buildLoader, excavator: buildExcavator, hauler: buildHauler };

const machines = [];
function makeMachine(type, x, z, yaw) {
  const m = { type, x, z, yaw, v: 0, y: hAt(x, z), pitch: 0, roll: 0, load: newLoad(),
    blade: 0, arm: .3, armA: 0, dumpT: 0, swing: 0, reach: 5, act: -1, did: false, mode: 'dig', curl: .2, tip: 0, tipping: false, ext: { hover: 0 } };
  BUILD[type](m);
  scene.add(m.group);
  m.y = hAt(x, z);
  machines.push(m);
  return m;
}
function resetMachines() {
  for (const m of machines) scene.remove(m.group);
  machines.length = 0;
  makeMachine('dozer', 73, 129, Math.PI);
  makeMachine('loader', 80, 129, Math.PI);
  makeMachine('excavator', 87.5, 130, Math.PI);
  makeMachine('hauler', 94.5, 131, Math.PI);
}

const fwdX = y => Math.sin(y), fwdZ = y => Math.cos(y);
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
function poseMachine(m, dt) {
  const s = SPEC[m.type];
  const fx = fwdX(m.yaw), fz = fwdZ(m.yaw), lx = Math.cos(m.yaw), lz = -Math.sin(m.yaw);
  const L = s.len / 2 * .9, Wd = s.wid / 2 * .9;
  const hf = hAt(m.x + fx * L, m.z + fz * L), hb = hAt(m.x - fx * L, m.z - fz * L);
  const hl = hAt(m.x + lx * Wd, m.z + lz * Wd), hr = hAt(m.x - lx * Wd, m.z - lz * Wd), hc = hAt(m.x, m.z);
  const y = Math.max((hf + hb + hl + hr) / 4, hc - .1);
  const k = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
  m.y = lerp(m.y, y, k);
  m.pitch = lerp(m.pitch, Math.atan2(hf - hb, L * 2), k);
  m.roll = lerp(m.roll, Math.atan2(hl - hr, Wd * 2), k);
  m.group.position.set(m.x, m.y, m.z);
  m.group.rotation.set(-m.pitch, m.yaw, m.roll, 'YXZ');
}

function drive(m, dt, inp) {
  const s = SPEC[m.type];
  let target = inp.throttle * s.vmax;
  const dir = Math.sign(Math.abs(m.v) > .05 ? m.v : target) || 1;
  const fx = fwdX(m.yaw), fz = fwdZ(m.yaw);
  const L = s.len / 2;
  const hA = hAt(m.x + fx * L * dir, m.z + fz * L * dir), hB = hAt(m.x - fx * L * dir, m.z - fz * L * dir);
  const grade = (hA - hB) / s.len;
  let lim = 1;
  if (grade > .35) lim = Math.max(0, 1 - (grade - .35) / .45);
  lim *= Math.max(.15, 1 - wAt(m.x, m.z) / 1.8);
  if (m.type === 'dozer') lim *= 1 - .35 * m.load.v / s.cap;
  if (m.type === 'hauler') lim *= 1 - .25 * m.load.v / s.cap;
  target *= lim;
  m.v += clamp(target - m.v, -s.acc * dt * (inp.throttle === 0 ? 1.6 : 1), s.acc * dt);
  if (Math.abs(m.v) < .01 && inp.throttle === 0) m.v = 0;
  let yaw = m.yaw;
  if (s.tracks) yaw += inp.steer * s.turn * dt;
  else yaw += (m.v / s.wb) * Math.tan(inp.steer * .55) * dt;
  let nx = clamp(m.x + fwdX(yaw) * m.v * dt, 3, N - 4), nz = clamp(m.z + fwdZ(yaw) * m.v * dt, 3, N - 4);
  const before = overlap(m, m.x, m.z, m.yaw), after = overlap(m, nx, nz, yaw);
  if (after > before + 1e-4) { m.v = 0; return; }
  const dist = Math.hypot(nx - m.x, nz - m.z) * Math.sign(m.v);
  m.x = nx; m.z = nz; m.yaw = yaw;
  if (m.wheels) for (const w of m.wheels) w.rotation.x += dist / .85;
  // knock trees over
  if (Math.abs(m.v) > .15) {
    const cs = circlesOf(m, m.x, m.z, m.yaw);
    for (const t of trees) {
      if (t.st !== 0) continue;
      for (const c of cs) if (Math.abs(t.x - c[0]) < c[2] + .6 && Math.abs(t.z - c[1]) < c[2] + .6 && Math.hypot(t.x - c[0], t.z - c[1]) < c[2] + .5) { treeFall(t, m.x, m.z); break; }
    }
  }
}

const _p = new THREE.Vector3();
let work = 0;  // how hard the engine is working (sound)
function toolDozer(m, dt, inp) {
  const s = SPEC.dozer;
  m.blade = clamp(m.blade + inp.tool * .8 * dt, -.6, 1.2);
  m.blade3.position.y = m.blade;
  m.group.updateMatrixWorld();
  if (m.v > .1) {
    const rate = 1.4 * m.v * dt;
    for (let sx = -1.75; sx <= 1.76; sx += .5) {
      _p.set(sx, m.blade, 2.75); m.group.localToWorld(_p);
      const k = cellOf(_p.x, _p.z);
      const over = H[k] - _p.y;
      if (over > .02 && m.load.v < s.cap * 1.4) {
        const a = Math.min(over, rate, H[k] - BED[k]);
        if (a > 0) { takeFrom(m.load, k, a); work = Math.max(work, .8); }
      } else if (over < -.05 && m.load.v > 0) {
        giveTo(m.load, k, Math.min(-over, rate, m.load.v / 6));
      }
    }
    if (m.load.v > s.cap) {   // spill off the blade ends
      const spill = Math.min(m.load.v - s.cap, 2.5 * dt);
      for (const sx of [-2.2, 2.2]) { _p.set(sx, 0, 2.6); m.group.localToWorld(_p); dropCircle(m.load, _p.x, _p.z, 1.1, spill / 2); }
    }
    if (m.load.v > .3 && Math.random() < dt * 8) { _p.set(0, m.blade + .4, 3.3); m.group.localToWorld(_p); dust(_p.x, _p.y, _p.z, 2, M[cellOf(_p.x, _p.z)] === 2 ? GRAVEL_C : DIRT_C); }
  } else if (m.v < -.05 && m.load.v > 0) {
    _p.set(0, 0, 3.2); m.group.localToWorld(_p);
    dropCircle(m.load, _p.x, _p.z, 1.9, Math.min(m.load.v, 4 * dt));
  }
  const v = m.load.v;
  m.pile.visible = v > .05;
  if (m.pile.visible) {
    const sc = Math.cbrt(v) * .75;
    m.pile.scale.set(sc * 1.7, sc * .8, sc);
    m.pile.position.set(0, m.blade + sc * .45, .45 + sc * .7);
    m.pile.material = loadMat(m.load) === 2 ? MAT.gravel : MAT.dirt;
  }
}
function haulerNear(x, z, r) {
  for (const o of machines) if (o.type === 'hauler') {
    _p.set(0, 2.3, -1.5); o.group.localToWorld(_p);
    if (Math.hypot(_p.x - x, _p.z - z) < r) return o;
  }
  return null;
}
function toolLoader(m, dt, inp) {
  const s = SPEC.loader;
  m.arm = clamp(m.arm + inp.tool * .55 * dt, -.15, 1);
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
        const amt = Math.min(over, rate, room, H[k] - BED[k]);
        if (amt > 0) { takeFrom(m.load, k, amt); work = Math.max(work, .9); }
      }
    }
  }
  if (inp.act) {
    if (m.load.v < .05) toast('Lower the bucket (F) and drive into dirt to fill it');
    else if (m.dumpT <= 0) {
      m.dumpT = .9;
      _p.set(0, -.45, .97); m.bucket.localToWorld(_p);
      const h = haulerNear(_p.x, _p.z, 3.4);
      if (h && m.arm > .55) {
        const got = transfer(m.load, h.load, SPEC.hauler.cap);
        if (got <= 0) toast('The hauler is full'); else dust(_p.x, _p.y, _p.z, 14, loadMat(h.load) === 2 ? GRAVEL_C : DIRT_C);
      } else {
        if (h) toast('Raise the bucket higher (R) to reach the hauler bed');
        const c = loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C;
        dropCircle(m.load, _p.x, _p.z, 1.6, m.load.v);
        dust(_p.x, hAt(_p.x, _p.z) + .5, _p.z, 16, c);
      }
    }
  }
  const f = m.load.v / s.cap;
  m.bucketLoad.visible = f > .02;
  m.bucketLoad.scale.set(1, Math.max(.05, f), 1);
  m.bucketLoad.material = loadMat(m.load) === 2 ? MAT.gravel : MAT.dirt;
}
function toolExcavator(m, dt, inp) {
  const s = SPEC.excavator;
  m.swing += inp.swing * 1.1 * dt;
  m.reach = clamp(m.reach + inp.tool * 2.4 * dt, 3.2, 7.6);
  m.house.rotation.y = m.swing;
  const a = m.yaw + m.swing, R = m.reach + 1.0;
  const tx = m.x + Math.sin(a) * R, tz = m.z + Math.cos(a) * R;
  const g = hAt(tx, tz);
  const truck = haulerNear(tx, tz, 3.2);
  const hover = Math.max(g + 2.4, truck ? truck.y + 4.4 : -1e9);
  let y = hover, curlT = m.load.v > .05 ? -.9 : .15;
  if (inp.act && m.act < 0) { m.act = 0; m.did = false; m.mode = m.load.v > .05 ? 'dump' : 'dig'; }
  if (m.act >= 0) {
    m.act += dt / 1.1;
    const p = Math.min(1, m.act), dip = Math.sin(p * Math.PI);
    const low = m.mode === 'dig' ? g - .4 : hover - .7;
    y = hover + (low - hover) * dip;
    if (m.mode === 'dump' && p > .35) curlT = .95;
    if (m.mode === 'dig') curlT = p < .5 ? .5 : -.9;
    work = Math.max(work, .7);
    if (!m.did && p >= .5) {
      m.did = true;
      if (m.mode === 'dig') {
        const got = cutCircle(m.load, tx, tz, 1.3, g - 1.0, s.cap);
        if (got < .05) toast('Nothing left to dig here: the ground is too hard below');
        dust(tx, g + .3, tz, 12, loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C);
      } else if (truck) {
        const got = transfer(m.load, truck.load, SPEC.hauler.cap);
        if (got <= 0) toast('The hauler is full');
        dust(tx, truck.y + 3, tz, 12, loadMat(truck.load) === 2 ? GRAVEL_C : DIRT_C);
      } else {
        const c = loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C;
        dropCircle(m.load, tx, tz, 1.4, m.load.v);
        dust(tx, g + .5, tz, 14, c);
      }
    }
    if (m.act >= 1) m.act = -1;
  }
  m.curl = lerp(m.curl, curlT, 1 - Math.exp(-dt * 6));
  // two-link arm reaching the bucket point
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
  const f = m.load.v / s.cap;
  m.bucketLoad.visible = f > .02;
  m.bucketLoad.scale.set(1, Math.max(.05, f), 1);
  m.bucketLoad.material = loadMat(m.load) === 2 ? MAT.gravel : MAT.dirt;
}
function toolHauler(m, dt, inp) {
  const s = SPEC.hauler;
  if (inp.act) { m.tipping = !m.tipping; if (m.tipping && m.load.v < .05) toast('The bed is empty: get loaded at the gravel pit or a dig site'); }
  m.tip = clamp(m.tip + (m.tipping ? .45 : -.5) * dt, 0, 1);
  m.bed.rotation.x = -m.tip * .9;
  if (m.tip > .45 && m.load.v > 0) {
    m.group.updateMatrixWorld();
    _p.set(0, 0, -5.4); m.group.localToWorld(_p);
    const c = loadMat(m.load) === 2 ? GRAVEL_C : DIRT_C;
    dropCircle(m.load, _p.x, _p.z, 1.7, Math.min(m.load.v, 3.5 * dt));
    if (Math.random() < dt * 12) dust(_p.x, hAt(_p.x, _p.z) + .4, _p.z, 3, c);
    work = Math.max(work, .5);
  }
  const f = m.load.v / s.cap;
  m.bedLoad.visible = f > .01;
  m.bedLoad.scale.set(1, Math.max(.03, f * 1.15), 1);
  m.bedLoad.material = loadMat(m.load) === 2 ? MAT.gravel : MAT.dirt;
}
const TOOL = { dozer: toolDozer, loader: toolLoader, excavator: toolExcavator, hauler: toolHauler };

// excavator aim ring
const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.35, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: .7, depthWrite: false }));
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
  const tag = document.createElement('div'); tag.className = 'tag'; tag.style.borderBottom = '2px solid #' + info.color.toString(16).padStart(6, '0');
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
    const r = placeRect(JOB[type].w, JOB[type].d, [83, 120]);
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
    if (j.prog >= need) {
      const info = JOB[j.type];
      stats.money += info.reward; stats.done++;
      toast(`Job done: ${info.name}. +$${info.reward}`, 3500);
      jobDispose(j);
      jobs.splice(jobs.indexOf(j), 1);
      const r = placeRect(info.w, info.d);
      if (r) { const nj = makeJob(j.type, r); jobs.push(nj); jobVis(nj); }
      save();
    }
  }
  renderJobs();
}
function renderJobs() {
  $('money').textContent = '$' + stats.money.toLocaleString();
  $('moved').textContent = Math.round(stats.moved).toLocaleString() + ' m³ moved';
  $('joblist').innerHTML = jobs.map(j => {
    const info = JOB[j.type], p = Math.round(j.prog * 100);
    const what = j.type === 'stock' ? `Dump ${j.goal} m³ of gravel inside the posts` : info.what;
    return `<div class="job"><div class="nm"><span>${info.name}</span><span>${p}% · $${info.reward}</span></div><div class="what">${what}</div><div class="bar"><i style="width:${p}%;background:#${info.color.toString(16).padStart(6, '0')}"></i></div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- input
const keys = new Set();
const touch = { throttle: 0, steer: 0, hold: {} };
const inp = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
let actPressed = false;
let active = 0;
let cabView = false;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'tab') { e.preventDefault(); select((active + 1) % machines.length); return; }
  if (e.repeat) { keys.add(k); return; }
  keys.add(k);
  if (k === ' ') { e.preventDefault(); actPressed = true; }
  if (k === 'c') cabView = !cabView;
  if (k >= '1' && k <= '4') select(+k - 1);
  if (k === 'm') toggleSound();
  if (k === 'h' || k === '?') showHelp(true);
  audioStart();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function readInput() {
  const kd = k => keys.has(k);
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
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); audioStart();
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = camDist; } });
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) camDist = clamp(dist0 * pinch0 / d, 6, 70); return; }
  camOff -= (e.clientX - px) * .006;
  camPitch = clamp(camPitch + (e.clientY - py) * .004, cabView ? -.6 : .08, cabView ? .6 : 1.35);
  lastDrag = performance.now();
});
const endPtr = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); camDist = clamp(camDist * Math.exp(e.deltaY * .001), 6, 70); }, { passive: false });

// touch controls
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
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
      else if (k === 'next') select((active + 1) % machines.length);
      else touch.hold[k] = true;
    });
    const rel = () => { touch.hold[k] = false; };
    b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
  }
}

function select(i) {
  if (!machines[i]) return;
  active = i;
  camOff = 0;
  machines.forEach(m => { if (m !== machines[i]) m.v = 0; });
  renderBar();
  const m = machines[i];
  $('mname').textContent = SPEC[m.type].name;
  $('mhint').textContent = SPEC[m.type].hint + ' 1-4 or Tab switches machine, C cab view.';
  const show = (k, on) => document.querySelector(`#tbtns [data-k=${k}]`).classList.toggle('hide', !on);
  show('swl', m.type === 'excavator'); show('swr', m.type === 'excavator');
  show('up', m.type !== 'hauler'); show('down', m.type !== 'hauler');
  show('act', m.type !== 'dozer');
  $('actBtn').textContent = { loader: 'Dump', excavator: 'Dig / Dump', hauler: 'Tip bed' }[m.type] || '';
}
function renderBar() {
  $('mbar').innerHTML = machines.map((m, i) => {
    const s = SPEC[m.type], f = Math.round(100 * m.load.v / s.cap);
    return `<button data-i="${i}" class="${i === active ? 'on' : ''}"><b>${s.name}</b><small>${i + 1}</small><div class="bar"><i style="width:${Math.min(100, f)}%;background:#e0772c"></i></div></button>`;
  }).join('');
}
$('mbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { select(+b.dataset.i); b.blur(); } });

// ---------------------------------------------------------------- HUD, toast, menus
let toastT = 0;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms);
}
function hudStat(m) {
  const s = SPEC[m.type], L = m.load;
  const amt = `${L.v.toFixed(1)} / ${s.cap} m³${L.v > .05 ? ' ' + loadName(L) : ''}`;
  if (m.type === 'dozer') return `Blade ${m.blade >= 0 ? '+' : ''}${m.blade.toFixed(1)} m · pushing ${amt}`;
  if (m.type === 'loader') return `Bucket ${amt} · ${m.arm < .2 ? 'down' : m.arm > .55 ? 'high' : 'mid'}`;
  if (m.type === 'excavator') return `Bucket ${amt} · reach ${m.reach.toFixed(1)} m`;
  return `Bed ${amt} · ${m.tipping ? 'tipping' : 'down'}`;
}
let barTimer = 0;
function updateHud(dt) {
  barTimer -= dt;
  if (barTimer > 0) return;
  barTimer = .2;
  const m = machines[active];
  $('mstat').textContent = hudStat(m) + (Math.abs(m.v) > .1 ? ` · ${(Math.abs(m.v) * 3.6).toFixed(0)} km/h` : '');
  document.querySelectorAll('#mbar button').forEach((b, i) => {
    const mm = machines[i]; if (!mm) return;
    b.querySelector('i').style.width = Math.min(100, Math.round(100 * mm.load.v / SPEC[mm.type].cap)) + '%';
  });
}
function showHelp(on) { $('help').style.display = on ? 'flex' : 'none'; }
$('helpGo').onclick = () => { showHelp(false); audioStart(); localStorage.setItem('groundwork.seenHelp', '1'); };
$('menuBtn').onclick = () => { $('menu').style.display = 'flex'; };
$('mClose').onclick = () => { $('menu').style.display = 'none'; };
$('mHelp').onclick = () => { $('menu').style.display = 'none'; showHelp(true); };
$('mSound').onclick = () => toggleSound();
$('mNew').onclick = () => {
  if (!confirm('Start a brand new valley? Everything you dug here will be gone for good.')) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  noSave = true;
  location.reload();
};

// ---------------------------------------------------------------- sound
let AC = null, osc, osc2, gainN, filt, muted = localStorage.getItem('groundwork.muted') === '1';
$('mSound').textContent = 'Sound: ' + (muted ? 'off' : 'on');
function audioStart() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    osc = AC.createOscillator(); osc.type = 'sawtooth';
    osc2 = AC.createOscillator(); osc2.type = 'square';
    filt = AC.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 320;
    gainN = AC.createGain(); gainN.gain.value = 0;
    const g2 = AC.createGain(); g2.gain.value = .35;
    osc.connect(filt); osc2.connect(g2).connect(filt); filt.connect(gainN).connect(AC.destination);
    osc.start(); osc2.start();
  } catch (e) { AC = null; }
}
function toggleSound() {
  muted = !muted; localStorage.setItem('groundwork.muted', muted ? '1' : '0');
  $('mSound').textContent = 'Sound: ' + (muted ? 'off' : 'on');
}
function updateSound(dt) {
  work = Math.max(0, work - dt * 1.5);
  if (!AC) return;
  const m = machines[active];
  const rev = Math.abs(m.v) / SPEC[m.type].vmax + Math.abs(inp.throttle) * .3 + work * .6;
  const t = AC.currentTime;
  osc.frequency.setTargetAtTime(34 + rev * 34, t, .1);
  osc2.frequency.setTargetAtTime(17 + rev * 17, t, .1);
  filt.frequency.setTargetAtTime(260 + rev * 420, t, .1);
  gainN.gain.setTargetAtTime(muted || document.hidden ? 0 : .045 + rev * .04, t, .15);
}

// ---------------------------------------------------------------- saving (nothing ever resets)
let noSave = false;
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
function save() {
  if (noSave || !machines.length) return;
  try {
    const data = {
      v: 1, seed, t: Date.now(), active, stats,
      H: b64(H), W: b64(W), M: b64(M), D: b64(D),
      gone: trees.map((t, i) => t.st > 0 ? i : -1).filter(i => i >= 0),
      mach: machines.map(m => ({ type: m.type, x: +m.x.toFixed(3), z: +m.z.toFixed(3), yaw: +m.yaw.toFixed(4), load: m.load, blade: m.blade, arm: m.arm, swing: m.swing, reach: m.reach, tip: m.tip, tipping: m.tipping })),
      jobs: jobs.map(j => ({ type: j.type, x0: j.x0, z0: j.z0, x1: j.x1, z1: j.z1, target: j.target, base: j.base, goal: j.goal })),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    if (!saveWarned) { saveWarned = true; toast('This browser would not let the valley save. Progress may be lost.', 4000); }
  }
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { data = null; }
  if (!data || data.v !== 1) return false;
  try {
    seed = data.seed;
    generate(seed, false);
    H.set(unb64(data.H, Float32Array)); W.set(unb64(data.W, Float32Array));
    M.set(unb64(data.M, Uint8Array)); D.set(unb64(data.D, Uint8Array));
    for (const i of data.gone || []) if (trees[i]) { trees[i].st = 3; trees[i].g = 0; treeGrid[trees[i].k] = -1; }
    for (const t of trees) t.y = hAt(t.x, t.z) - .1;
    for (const s of data.mach) {
      const m = makeMachine(s.type, s.x, s.z, s.yaw);
      Object.assign(m, { load: s.load || newLoad(), blade: s.blade ?? 0, arm: s.arm ?? .3, swing: s.swing ?? 0, reach: s.reach ?? 5, tip: s.tip ?? 0, tipping: !!s.tipping });
    }
    Object.assign(stats, data.stats || {});
    for (const j of data.jobs || []) { const jj = { ...j, prog: 0 }; jobs.push(jj); jobVis(jj); }
    active = clamp(data.active | 0, 0, machines.length - 1);
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
function updateCamera(dt) {
  const m = machines[active];
  if (cabView) {
    m.cab.getWorldPosition(_cam);
    m.cab.getWorldQuaternion(_qq);
    camera.position.copy(_cam);
    camera.quaternion.copy(_qq);
    camera.rotateY(Math.PI + camOff);       // the machine faces +z, the camera looks down -z
    camera.rotateX(-(camPitch - .42) * .8 - .12);
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
      const txt = `${JOB[j.type].name} · ${Math.round(j.prog * 100)}%`;
      if (j.tag.textContent !== txt) j.tag.textContent = txt;
    }
  }
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), waterAcc = 0, saveTimer = 5, relaxFlip = 0;
function update(dt) {
  const me = machines[active];
  drive(me, dt, inp);
  for (const m of machines) {
    if (m !== me && m.v !== 0) { m.v = 0; }
    TOOL[m.type](m, dt, m === me ? inp : ZERO);
    poseMachine(m, dt);
  }
  ring.visible = me.type === 'excavator' && !!me.target;
  if (ring.visible) ring.position.set(me.target[0], me.target[1] + .08, me.target[2]);

  waterAcc += dt * 2;
  let steps = 0;
  while (waterAcc >= .04 && steps < 4) { waterStep(.04); waterAcc -= .04; steps++; }
  if (steps === 4) waterAcc = 0;
  relaxFlip ^= 1;
  if (relaxFlip) relax(false);

  const changed = dMaxI >= dMinI;
  updateWater();
  updateTerrain();
  updateTrees(dt, changed);
  updateDust(dt);
  updateJobs(dt);
  updateCamera(dt);
  sun.position.set(me.x + SUN_DIR.x * 120, me.y + SUN_DIR.y * 120, me.z + SUN_DIR.z * 120);
  sun.target.position.set(me.x, me.y, me.z);
  scene.userData.sky.position.copy(camera.position);
  updateHud(dt);
  updateSound(dt);
  saveTimer -= dt;
  if (saveTimer <= 0) { saveTimer = 5; save(); }
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  readInput();
  update(dt);
  renderer.render(scene, camera);
  updateTags();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
function start() {
  resize();
  const resumed = load();
  if (!resumed) {
    generate(seed, true);
    for (const t of trees) t.y = hAt(t.x, t.z) - .1;
    resetMachines();
    freshJobs();
  }
  buildTreeMeshes();
  dMinI = 0; dMaxI = N - 1; dMinJ = 0; dMaxJ = N - 1;
  updateTerrain(); updateSkirt(); updateWater();
  for (const m of machines) poseMachine(m, 0);
  select(active);
  for (const j of jobs) j.prog = jobProgress(j);
  renderJobs();
  camYawSm = machines[active].yaw;
  updateCamera(1);
  camera.position.copy(_cam);
  $('loading').style.display = 'none';
  if (!resumed && !localStorage.getItem('groundwork.seenHelp')) showHelp(true);
  else if (resumed) toast('Welcome back. Your valley is just as you left it.', 3000);
  if (!resumed) save();
  // test hook: run the game forward without drawing (used by the automated checks)
  window.GW = { machines, H, W, M, D, BED, stats, hAt, select, save, trees, get jobs() { return jobs; }, get active() { return active; },
    step(n, input = {}) { for (let i = 0; i < n; i++) { Object.assign(inp, ZERO, input); if (i > 0) inp.act = false; update(1 / 30); } } };
  requestAnimationFrame(t => { last = t; frame(t); });
}
setTimeout(start, 30);
