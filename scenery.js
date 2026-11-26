// The small things that make a street look lived in: shop signs with their names, street trees, power poles and
// wires, fire hydrants, street-name blades at the corners, speed limit signs, benches, bins, bus stops, and grass
// and wildflowers in the open ground. Everything here comes from the street plan and a hash (nothing saved).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { along, halfW, WALK_W } from './net.js';
import { entries as lotEntries } from './parking.js';

const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const tint = (g, rgb) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(rgb, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
const merge = list => { const g = mergeGeometries(list); g.computeBoundingSphere(); return g; };
const MAT = {};
const mat = (k, o) => MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, ...o }));

// ---------- props (each merged into one geometry, then instanced) ----------
const PROPS = {
  pole: () => merge([tint(new THREE.CylinderGeometry(.13, .17, 9.5, 7).translate(0, 4.75, 0), [.36, .27, .19]), tint(new THREE.BoxGeometry(.14, .14, 2.4).translate(0, 8.9, 0), [.33, .25, .18]),
    ...[-1.05, -.35, .35, 1.05].map(z => tint(new THREE.CylinderGeometry(.05, .05, .18, 5).translate(0, 9.06, z), [.85, .85, .8])), tint(new THREE.CylinderGeometry(.28, .28, .75, 8).translate(.32, 7.6, 0), [.55, .57, .58])]),
  hydrant: () => merge([tint(new THREE.CylinderGeometry(.16, .19, .62, 8).translate(0, .31, 0), [.75, .1, .08]), tint(new THREE.SphereGeometry(.17, 8, 5, 0, 6.3, 0, 1.6).translate(0, .62, 0), [.85, .7, .1]), tint(new THREE.CylinderGeometry(.07, .07, .42, 6).rotateZ(Math.PI / 2).translate(0, .42, 0), [.75, .1, .08])]),
  blade: () => merge([tint(new THREE.CylinderGeometry(.045, .05, 3.2, 6).translate(0, 1.6, 0), [.55, .56, .58]), tint(new THREE.BoxGeometry(1.5, .26, .04).translate(.55, 3.05, 0), [.05, .38, .2]), tint(new THREE.BoxGeometry(.04, .26, 1.5).translate(0, 2.75, .55), [.05, .38, .2]), tint(new THREE.BoxGeometry(.05, .5, .5).rotateX(Math.PI / 4).translate(0, 2.2, 0), [.75, .08, .06])]),
  speed: () => merge([tint(new THREE.CylinderGeometry(.04, .045, 2.6, 6).translate(0, 1.3, 0), [.55, .56, .58]), tint(new THREE.BoxGeometry(.04, .9, .62).translate(0, 2.35, 0), [.95, .95, .93])]),
  bench: () => merge([tint(new THREE.BoxGeometry(1.8, .08, .45).translate(0, .45, 0), [.35, .22, .14]), tint(new THREE.BoxGeometry(1.8, .4, .06).translate(0, .72, -.2), [.35, .22, .14]), tint(new THREE.BoxGeometry(.08, .45, .45).translate(-.8, .22, 0), [.12, .12, .13]), tint(new THREE.BoxGeometry(.08, .45, .45).translate(.8, .22, 0), [.12, .12, .13])]),
  bin: () => merge([tint(new THREE.CylinderGeometry(.27, .24, .9, 10).translate(0, .45, 0), [.15, .26, .2]), tint(new THREE.CylinderGeometry(.29, .29, .06, 10).translate(0, .92, 0), [.1, .1, .1])]),
  shelter: () => merge([tint(new THREE.BoxGeometry(3.4, .1, 1.6).translate(0, 2.5, 0), [.25, .27, .3]), tint(new THREE.BoxGeometry(3.4, 2.3, .05).translate(0, 1.3, -.75), [.55, .65, .7]), tint(new THREE.BoxGeometry(.05, 2.3, 1.5).translate(-1.68, 1.3, 0), [.55, .65, .7]), tint(new THREE.BoxGeometry(2.4, .08, .4).translate(0, .45, -.5), [.3, .3, .32])]),
  mailboxes: () => merge([tint(new THREE.BoxGeometry(1.1, .9, .5).translate(0, .95, 0), [.62, .62, .6]), tint(new THREE.BoxGeometry(.1, .5, .1).translate(0, .25, 0), [.3, .3, .3])]),
  bollard: () => tint(new THREE.CylinderGeometry(.11, .11, .9, 8).translate(0, .45, 0), [.85, .72, .1]),
  planter: () => merge([tint(new THREE.BoxGeometry(1.6, .45, .7).translate(0, .22, 0), [.62, .58, .52])]),
};
// grass blades and wildflowers: a clump of crossed cards with a painted texture
function tuftTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const x = 64 + (Math.random() - .5) * 96, bend = (Math.random() - .5) * 28, h = 50 + Math.random() * 70, v = 70 + Math.random() * 60;
    g.strokeStyle = `rgb(${v * .9 | 0},${v | 0},${v * .5 | 0})`; g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + bend * .3, 128 - h * .6, x + bend, 128 - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flowerTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) { const x = 64 + (Math.random() - .5) * 90, h = 40 + Math.random() * 50; g.strokeStyle = '#5e7a34'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 128); g.lineTo(x + (Math.random() - .5) * 10, 128 - h); g.stroke(); }
  for (let i = 0; i < 18; i++) { const x = 64 + (Math.random() - .5) * 90, y = 128 - 40 - Math.random() * 50; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 5 + Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const tuftGeo = () => { const a = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0), b = a.clone().rotateY(Math.PI / 2), c2 = a.clone().rotateY(Math.PI / 4); return mergeGeometries([a, b, c2]); };

// ---------- shop signs: the business names on the storefronts ----------
const SIGN_BG = { diner: '#8f1d18', cafe: '#3d2a1e', gas: '#0d4a8c', salon: '#5a2650', hardware: '#a4561a', auto: '#1f1f22', grocery: '#1f5e2c', office: '#20303f', bank: '#1d3a5c', market: '#b0261d', police: '#10244a', fire: '#8c1410', hospital: '#f2f2ee' };
function signAtlas(list) {
  const CW = 512, CH = 96, cols = 4, rows = Math.max(1, Math.ceil(list.length / cols));
  const c = document.createElement('canvas'); c.width = CW * cols; c.height = CH * Math.min(64, Math.pow(2, Math.ceil(Math.log2(rows)))); const g = c.getContext('2d');
  list.forEach((q, i) => {
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH, bg = SIGN_BG[q.t] || '#222', light = q.t === 'hospital';
    g.fillStyle = bg; g.fillRect(x, y, CW, CH);
    g.strokeStyle = light ? '#b51c16' : '#f6f6f1'; g.lineWidth = 5; g.strokeRect(x + 7, y + 7, CW - 14, CH - 14);
    g.fillStyle = light ? '#b51c16' : '#f6f6f1';
    let fs = 58; g.font = `900 ${fs}px Overpass, Arial Narrow, sans-serif`;
    const name = q.name.toUpperCase(); while (g.measureText(name).width > CW - 50 && fs > 20) { fs -= 2; g.font = `900 ${fs}px Overpass, Arial Narrow, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, x + CW / 2, y + CH / 2 + 4);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { t, cols, rows: c.height / CH, CW, CH };
}

// every driveway (into a parking lot, or up to a house): rectangles to keep street furniture and lights off
export function driveRects(net, city) {
  const out = [];
  for (const l of city.lots) if (l.k === 'parking') for (const en of lotEntries(l, net)) {
    const cx = en.P[0] + en.n[0] * en.L / 2, cz = en.P[1] + en.n[1] * en.L / 2;
    out.push({ x: cx, z: cz, hw: 7.5, hd: en.L / 2 + 1.5, r: Math.atan2(en.t[1], en.t[0]) });
  }
  for (const b of city.buildings) {
    if (b.kind !== 'house' || !b.e) continue;
    let fx = b.fx - b.x, fz = b.fz - b.z; const L = Math.hypot(fx, fz); if (L < 4) continue; fx /= L; fz /= L;
    const px = -fz, pz = fx, c = Math.cos(b.rot || 0), sn = Math.sin(b.rot || 0), hp = Math.abs(px * c + pz * sn) * b.w / 2 + Math.abs(-px * sn + pz * c) * b.d / 2;
    const o = (b.tone < .5 ? -1 : 1) * Math.max(0, hp - 2.9), t = L - halfW(b.e) - WALK_W / 2, cx = b.x + fx * t + px * o, cz = b.z + fz * t + pz * o;
    out.push({ x: cx, z: cz, hw: 3.6, hd: WALK_W / 2 + 1.5, r: Math.atan2(pz, px) });
  }
  return out;
}
export const inRects = (rs, x, z, pad = 0) => rs.some(o => { const c = Math.cos(o.r), s = Math.sin(o.r), dx = x - o.x, dz = z - o.z, lx = dx * c + dz * s, lz = -dx * s + dz * c; return Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad; });

export function buildScenery(net, city, life, Q) {
  const G = new THREE.Group(), dummy = new THREE.Object3D(), trees = [];
  const B = city.buildings;
  // a quick look-up: is a spot free of buildings and lots?
  const cell = 30, grid = new Map(), key = (x, z) => (Math.floor(x / cell) + 2000) * 5000 + Math.floor(z / cell) + 2000;
  const addR = (x, z, r, o) => { const k0 = Math.floor((x - r) / cell), k1 = Math.floor((x + r) / cell), l0 = Math.floor((z - r) / cell), l1 = Math.floor((z + r) / cell); for (let i = k0; i <= k1; i++) for (let j = l0; j <= l1; j++) { const k = (i + 2000) * 5000 + j + 2000; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); } };
  for (const b of B) addR(b.x, b.z, Math.hypot(b.w, b.d) / 2 + (b.kind === 'house' ? 9 : 3), { x: b.x, z: b.z, hw: b.w / 2 + (b.kind === 'house' ? 3 : 1.5), hd: b.d / 2 + (b.kind === 'house' ? 3 : 1.5), r: b.rot || 0, b });
  for (const l of city.lots) addR(l.x, l.z, Math.hypot(l.w, l.d) / 2, { x: l.x, z: l.z, hw: l.w / 2 + 1, hd: l.d / 2 + 1, r: l.rot || 0 });
  for (const r of driveRects(net, city)) addR(r.x, r.z, Math.hypot(r.hw, r.hd) + 1, r);
  const blocked = (x, z, pad = 0) => { const L = grid.get(key(x, z)); if (!L) return false; for (const o of L) { const c = Math.cos(o.r), s = Math.sin(o.r), dx = x - o.x, dz = z - o.z, lx = dx * c + dz * s, lz = -dx * s + dz * c; if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true; } return false; };
  const nearNode = (e, s, m) => { const A = net.nodes.get(e.a), Bn = net.nodes.get(e.b), ta = A && A.edges.size > 1 ? net.trimOf(A) : 0, tb = Bn && Bn.edges.size > 1 ? net.trimOf(Bn) : 0; return s < ta + m || s > e.len - tb - m; };
  const spot = (e, s, side, o) => { const q = along(e.pts, e.cum, s), w = halfW(e) + o; return [q[0] - q[3] * w * side, q[1] + q[2] * w * side, Math.atan2(-q[3] * side, q[2] * side), q]; };
  const P = {}; for (const k of Object.keys(PROPS)) P[k] = [];
  const wires = [];
  for (const e of net.edges.values()) {
    if (e.ring || e.len < 20) continue;
    const inTown = city.inCity(e.cx, e.cz), big = e.kind === 'avenue' || (e.nl || 1) > 1, hw = halfW(e);
    const mid = along(e.pts, e.cum, e.len / 2), core = Math.hypot(mid[0], mid[1]) < (city.coreR || 0);
    // street trees just behind the sidewalk (on main roads and downtown; between the driveways on house streets)
    if (inTown) for (const side of [1, -1]) for (let s = 9 + hash(e.id, side) * 6; s < e.len - 6; s += (big || core ? 13 : 17) + hash(e.id, s | 0, side) * 6) {
      if (nearNode(e, s, 6)) continue;
      const pk = e.kind === 'street' && (e.nl || 1) === 1 && !e.tl && !e.oneway && !core;   // house streets: the trees stand in the grass strip by the curb
      const [x, z] = spot(e, s, side, pk ? .9 : WALK_W + (core ? -1.1 : 1.4));
      if (blocked(x, z, core ? 0 : 1.5)) continue;
      if (!big && !core && hash(e.id, s | 0, 9) < .35) continue;
      trees.push([+x.toFixed(2), +z.toFixed(2), core ? .55 + hash(e.id, s | 0, 3) * .15 : .62 + hash(e.id, s | 0, 3) * .3, hash(e.id, s | 0, 4) * .69]);
    }
    // power poles down one side, wires between them
    if (inTown || e.kind === 'avenue') {
      let last = null; const side = big ? -1 : 1;
      for (let s = 6 + hash(e.id, 31) * 10; s < e.len - 4; s += 38) {
        if (nearNode(e, s, 3)) { last = null; continue; }
        const [x, z, yaw, q] = spot(e, s, side, WALK_W + .7); if (blocked(x, z, -1)) { last = null; continue; }
        P.pole.push([x, z, Math.atan2(-q[3], q[2]) + Math.PI / 2]);
        if (last) for (const o of [-1.05, -.35, .35, 1.05]) wires.push([last[0] - q[3] * o * side, last[1] + q[2] * o * side, x - q[3] * o * side, z + q[2] * o * side]);
        last = [x, z]; void yaw;
      }
    }
    if (!inTown) continue;
    // fire hydrants at the kerb
    for (let s = 20 + hash(e.id, 7) * 30; s < e.len - 10; s += 85) { if (nearNode(e, s, 4)) continue; const [x, z] = spot(e, s, hash(e.id, s | 0) < .5 ? 1 : -1, .6); if (!blocked(x, z, -1)) P.hydrant.push([x, z, hash(e.id, s | 0, 2) * 6]); }
    // speed limit signs on the main roads
    if (big) for (const side of [1, -1]) { const s = side > 0 ? Math.min(e.len - 8, 30) : Math.max(8, e.len - 30); if (nearNode(e, s, 4) || e.len < 60) continue; const [x, z, yaw] = spot(e, s, side, .45); P.speed.push([x, z, yaw + Math.PI / 2]); }
    // bus stops along main roads in town
    if (big && e.len > 80 && hash(e.id, 77) < .45) { const s = e.len * (.3 + hash(e.id, 78) * .4), side = hash(e.id, 79) < .5 ? 1 : -1; const [x, z, yaw] = spot(e, s, side, WALK_W - .3); if (!blocked(x, z, -1.5)) P.shelter.push([x, z, yaw + Math.PI]); }
  }
  // street-name blades at the corners
  for (const n of net.nodes.values()) {
    if (n.edges.size < 3 || n.ring) continue;
    const e = net.edges.get([...n.edges][0]); if (!e) continue;
    const s = e.a === n.id ? net.trimOf(n) + 1 : e.len - net.trimOf(n) - 1, q = along(e.pts, e.cum, s), w = halfW(e) + WALK_W - .4;
    P.blade.push([q[0] - q[3] * w, q[1] + q[2] * w, Math.atan2(-q[3], q[2])]);
  }
  // in front of the shops: benches, bins, planters; bollards at the gas stations; mailbox banks at the apartments
  for (const b of B) {
    if (!b.e) continue;
    let fx = b.fx - b.x, fz = b.fz - b.z; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
    const tx = -fz, tz = fx, front = Math.min(L, Math.abs(fx * b.w / 2) + Math.abs(fz * b.d / 2) + .5);
    const yaw = Math.atan2(-fz, fx) + Math.PI / 2;
    const at = (a, o) => [b.x + fx * (front + o) + tx * a, b.z + fz * (front + o) + tz * a];
    if (b.biz && !['police', 'fire', 'hospital', 'gas', 'auto'].includes(b.biz.t)) {
      const w = Math.min(b.w, b.d) * .4, p1 = at(-w, 1.8), p2 = at(w * .6, 1.6), p3 = at(w, 1.4);
      if (!blocked(p1[0], p1[1], -1.2)) P.bench.push([p1[0], p1[1], yaw]); if (!blocked(p2[0], p2[1], -1.2)) P.bin.push([p2[0], p2[1], 0]); if (!blocked(p3[0], p3[1], -1.2)) P.planter.push([p3[0], p3[1], yaw]);
    }
    if (b.biz && b.biz.t === 'gas') for (const a of [-4, -1.5, 1.5, 4]) { const p = at(a, 4.5); P.bollard.push([p[0], p[1], 0]); }
    if (b.kind === 'apt') { const p = at(-Math.min(b.w, b.d) * .35, 2.4); if (!blocked(p[0], p[1], -1)) P.mailboxes.push([p[0], p[1], yaw]); }
  }
  // instance the props
  for (const [k, list] of Object.entries(P)) {
    if (!list.length) continue;
    const geo = MAT['g' + k] || (MAT['g' + k] = PROPS[k]()), m = new THREE.InstancedMesh(geo, mat('props', { roughness: .7, metalness: .1 }), list.length);
    list.forEach((q, i) => { dummy.position.set(q[0], .16, q[1]); dummy.rotation.set(0, q[2], 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    m.castShadow = k === 'pole' || k === 'shelter' || Q.shadows > 1; m.receiveShadow = true; G.add(m);
  }
  if (wires.length) {   // wires sag a little between the poles
    const pos = [];
    for (const [x0, z0, x1, z1] of wires) { let px = x0, pz = z0, py = 9.06; for (let i = 1; i <= 6; i++) { const t = i / 6, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = 9.06 - Math.sin(t * Math.PI) * .7; pos.push(px, py, pz, x, y, z); px = x; py = y; pz = z; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const wl = new THREE.LineSegments(g, MAT.wire || (MAT.wire = new THREE.LineBasicMaterial({ color: 0x4a4a48 }))); G.add(wl); G.userData.wires = wl;   // (hidden from far away: a hairline at any distance)
  }
  // shop signs
  const sl = B.filter(b => b.biz && b.e).slice(0, 256);
  if (sl.length && typeof document !== 'undefined') {
    const A = signAtlas(sl.map(b => ({ name: b.biz.name, t: b.biz.t }))), pos = [], uv = [], idx = [], nor = [];
    sl.forEach((b, i) => {
      let fx = b.fx - b.x, fz = b.fz - b.z; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
      const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), ax = fx * c + fz * s, az = -fx * s + fz * c, alongX = Math.abs(ax) >= Math.abs(az), sg = alongX ? Math.sign(ax) || 1 : Math.sign(az) || 1;
      const n = alongX ? [c * sg, s * sg] : [-s * sg, c * sg], t = [-n[1], n[0]], hf = (alongX ? b.w : b.d) / 2, hwid = (alongX ? b.d : b.w) / 2;
      const big = b.kind === 'big', W = Math.min(hwid * 1.6, big ? 18 : b.biz.t === 'hospital' ? 14 : 10), H = W * A.CH / A.CW * 1.1, y = big ? b.h - H / 2 - .6 : Math.min(b.h - .4 - H / 2, 3.25 + .5 + H / 2);
      const cx = b.x + n[0] * (hf + .12), cz = b.z + n[1] * (hf + .12), k = pos.length / 3;
      for (const [a, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(cx + t[0] * a * W / 2 * -1, y + v * H / 2, cz + t[1] * a * W / 2 * -1); nor.push(n[0], 0, n[1]); }
      const u0 = (i % A.cols) / A.cols, u1 = u0 + 1 / A.cols, v1 = 1 - Math.floor(i / A.cols) / A.rows, v0 = v1 - 1 / A.rows;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1); idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: A.t, roughness: .5, emissive: 0xffffff, emissiveMap: A.t, emissiveIntensity: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.userData.signs = true; G.add(m); G.userData.signMat = m.material;
  }
  // grass clumps and wildflowers on open ground (not on roads, lots or yards)
  const nT = 0;   // (grass cards looked like cardboard up close: the ground shader does the grass now)
  if (nT && typeof document !== 'undefined') {
    const bb = city.bounds(), cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2, R = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 260;
    const roadNear = (x, z) => { const h = net.nearestEdge(x, z, 30); return h && Math.hypot(...(() => { const q = along(h.e.pts, h.e.cum, h.s); return [q[0] - x, q[1] - z]; })()) < halfW(h.e) + WALK_W + 1.2; };
    const tm = [], fm = [];
    let seed = 1; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < nT * 1.6 && tm.length + fm.length < nT; i++) {
      // clumps gather in patches
      const a = r() * 6.283, d = Math.sqrt(r()) * R, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const patch = Math.sin(x * .031 + Math.sin(z * .017) * 2) * Math.cos(z * .027 + Math.sin(x * .013) * 2);
      if (patch < -.15 && r() < .7) continue;
      if (blocked(x, z, 1) || roadNear(x, z)) continue;
      (r() < .06 ? fm : tm).push([x, z, .5 + r() * .7, r() * 6.3, r()]);
    }
    const mk = (list, tex, colorF) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(MAT.tuft || (MAT.tuft = tuftGeo()), new THREE.MeshStandardMaterial({ map: tex, alphaTest: .45, side: THREE.DoubleSide, roughness: 1 }), list.length);
      const col = new THREE.Color();
      list.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[3], 0); dummy.scale.set(q[2] * 1.9, q[2] * 1.25, q[2] * 1.9); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, colorF(q[4], col)); });
      m.receiveShadow = true; G.add(m);
    };
    mk(tm, MAT.tuftTex || (MAT.tuftTex = tuftTex()), (k, c) => c.setRGB(.95 + k * .25, .9 + k * .1, .62 + k * .2, THREE.SRGBColorSpace));
    const FL = [[.25, .4, .9], [1, .85, .2], [.95, .45, .1], [.95, .95, .9], [.7, .3, .7]];   // bluebonnets, coreopsis, firewheel, daisies, winecups
    mk(fm, MAT.flowerTex || (MAT.flowerTex = flowerTex()), (k, c) => { const f = FL[Math.floor(k * FL.length)]; return c.setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace); });
  }
  G.userData.trees = trees;
  return G;
}
