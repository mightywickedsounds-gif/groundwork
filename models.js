// 3D models for Groundwork: the four machines (with moving track chains, tyres, hydraulic rams and cabs you can sit in),
// trees, boulders and grass. Everything is built from code.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { labelTexture } from './textures.js?v=5';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0), Z = V(0, 0, 1);

// ---------------------------------------------------------------- materials (each machine gets its own set: dirt builds up per machine)
function addGrime(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vGWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vGWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGround, uGrime; uniform sampler2D tGrime; varying vec3 vGWP;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float gwHgt = vGWP.y - uGround;
        float gwN = texture2D(tGrime, vGWP.xz * .35 + vGWP.y * .21).r * .6 + texture2D(tGrime, vGWP.zy * .9).r * .4;
        float gwLow = clamp((1.8 - gwHgt) / 1.8, 0., 1.); gwLow *= gwLow;
        float gwAmt = clamp(gwLow * 1.3 * uGrime + uGrime * .22, 0., 1.) * smoothstep(.32, .66, gwN + gwLow * .3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.29, .21, .14), gwAmt * .85);
        roughnessFactor = mix(roughnessFactor, .95, gwAmt);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - gwAmt;');
  };
  mat.customProgramCacheKey = () => 'gw-grime';
  return mat;
}
export function machineMats(T, color) {
  const U = { uGround: { value: 0 }, uGrime: { value: .2 }, tGrime: { value: T.macro } };
  const g = o => addGrime(new THREE.MeshStandardMaterial(o), U);
  return {
    U,
    paint: g({ color, roughness: .4, metalness: .2 }),
    frame: g({ color: 0x2a2c2f, roughness: .6, metalness: .4 }),
    steel: g({ color: 0x8d9298, roughness: .32, metalness: .85 }),
    track: g({ color: 0x3a3836, roughness: .7, metalness: .6 }),
    rubber: g({ color: 0x1b1b1c, roughness: .9, metalness: 0 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: .1, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2731, roughness: .03, metalness: .9, transparent: true, opacity: .42, envMapIntensity: 1.6, depthWrite: false }),
    interior: new THREE.MeshStandardMaterial({ color: 0x252525, roughness: .85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: .9 }),
    light: new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff3d6, emissiveIntensity: .7, roughness: .15 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0x7a0808, emissiveIntensity: .5, roughness: .2 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8800, emissiveIntensity: .15, transparent: true, opacity: .9, roughness: .2 }),
    stripe: new THREE.MeshStandardMaterial({ map: T.stripes, roughness: .5 }),
  };
}

// ---------------------------------------------------------------- building blocks
const geoCache = new Map();
function rgeo(w, h, d, r) {
  r = Math.max(0, Math.min(r, w / 2 - .002, h / 2 - .002, d / 2 - .002));
  const key = [w, h, d, r].map(v => v.toFixed(3)).join(',');
  let g = geoCache.get(key);
  if (!g) { g = r > .006 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d); geoCache.set(key, g); }
  return g;
}
export function rbox(p, w, h, d, mat, x, y, z, r = .04) {
  const m = new THREE.Mesh(rgeo(w, h, d, r), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
}
function cylX(p, r, len, mat, x, y, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
}
function cylY(p, rt, rb, len, mat, x, y, z, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
}
function cylZ(p, r, len, mat, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), mat);
  m.position.set(x, y, z); m.castShadow = true; p.add(m); return m;
}
// a box stretched between two points (both in p's space)
function beam(p, a, b, w, h, mat, r = .05) {
  const d = b.clone().sub(a), L = d.length();
  const m = rbox(p, w, h, L, mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, r);
  m.quaternion.setFromUnitVectors(Z, d.normalize());
  return m;
}
// a flat profile drawn in the side view (z forward, y up), made into a solid across the machine's width
function profileSolid(pts, width, mat) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2); g.translate(width / 2, 0, 0); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}
// a curved plate: points along a curve in side view, given a thickness, as a solid across the width
function shell(curve, thick, width, mat) {
  const outer = curve, inner = [];
  for (let i = 0; i < curve.length; i++) {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
    let tz = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
    inner.push([curve[i][0] - ty * thick, curve[i][1] + tz * thick]);
  }
  return profileSolid([...outer, ...inner.reverse()], width, mat);
}
function smoothCurve(pts, n) {
  const c = new THREE.SplineCurve(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  return c.getPoints(n).map(v => [v.x, v.y]);
}

const tireCache = new Map();
function tireGeo(r, w) {
  const key = r + ',' + w;
  if (tireCache.has(key)) return tireCache.get(key);
  const parts = [];
  const core = new THREE.CylinderGeometry(r * .9, r * .9, w * .96, 32, 1).rotateZ(Math.PI / 2);
  parts.push(core.toNonIndexed());
  const side = new THREE.TorusGeometry(r * .78, w * .2, 6, 32).rotateY(Math.PI / 2);
  for (const s of [-1, 1]) parts.push(side.clone().translate(s * w * .3, 0, 0).toNonIndexed());
  const nL = Math.round(r * 24);
  for (let i = 0; i < nL; i++) for (const s of [-1, 1]) {
    const lug = new THREE.BoxGeometry(w * .5, r * .14, r * .17);
    lug.rotateY(s * .45); lug.translate(s * w * .24, r * .92, 0);
    lug.rotateX((i + (s > 0 ? .5 : 0)) / nL * Math.PI * 2);
    parts.push(lug.toNonIndexed());
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  tireCache.set(key, g);
  return g;
}
function wheel(p, r, w, M, x, y, z) {
  const t = new THREE.Mesh(tireGeo(r, w), M.rubber); t.position.set(x, y, z); t.castShadow = true; t.receiveShadow = true; p.add(t);
  cylX(t, r * .58, w * 1.0, M.paint, 0, 0, 0, 20);
  cylX(t, r * .3, w * 1.06, M.frame, 0, 0, 0, 12);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; cylX(t, .025, w * 1.1, M.steel, 0, Math.cos(a) * r * .42, Math.sin(a) * r * .42, 6); }
  return t;
}
function roller(p, r, w, M, x, y, z) {
  const m = cylX(p, r, w, M.steel, x, y, z, 14);
  cylX(m, r * .55, w * 1.08, M.frame, 0, 0, 0, 10);
  return m;
}

// A crawler track: a chain of shoes running round an idler (front), a sprocket (back) and road wheels.
function buildTrack(p, x, len, R, w, M) {
  const a = len / 2 - R, P = 4 * a + 2 * Math.PI * R, n = Math.round(P / .27), pp = P / n, cy = R + .04;
  const shoeG = mergeGeometries([
    new THREE.BoxGeometry(w, .055, pp * .92).toNonIndexed(),
    new THREE.BoxGeometry(w, .05, .045).translate(0, -.045, 0).toNonIndexed(),
    new THREE.BoxGeometry(w * .3, .05, pp * .7).translate(0, .045, 0).toNonIndexed(),
  ]);
  const im = new THREE.InstancedMesh(shoeG, M.track, n);
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; p.add(im);
  rbox(p, w * .5, R * .9, 2 * a + .2, M.frame, x, cy, 0, .06);
  const idler = roller(p, R - .07, w * .55, M, x, cy, a);
  const sprocket = roller(p, R - .05, w * .55, M, x, cy, -a);
  for (let i = 0; i < 10; i++) { const t = rbox(sprocket, w * .4, .09, .11, M.steel, 0, R - .05, 0, .01); t.position.set(0, Math.cos(i / 10 * Math.PI * 2) * (R - .03), Math.sin(i / 10 * Math.PI * 2) * (R - .03)); t.rotation.x = -i / 10 * Math.PI * 2; }
  const wheels = [idler, sprocket];
  for (let i = 0; i < 5; i++) wheels.push(roller(p, .17, w * .5, M, x, .24, -a + (i + 1) * 2 * a / 6));
  for (const z of [-a * .4, a * .4]) wheels.push(roller(p, .1, w * .4, M, x, cy + R - .13, z));
  const o = new THREE.Object3D();
  let off = 0;
  function at(s) {
    if (s < 2 * a) return [cy - R, a - s, 0];
    s -= 2 * a;
    if (s < Math.PI * R) { const f = s / R, dy = -Math.cos(f) * R, dz = -Math.sin(f) * R; return [cy + dy, -a + dz, Math.atan2(-dz, -dy)]; }
    s -= Math.PI * R;
    if (s < 2 * a) return [cy + R, -a + s, Math.PI];
    s -= 2 * a;
    const f = s / R, dy = Math.cos(f) * R, dz = Math.sin(f) * R; return [cy + dy, a + dz, Math.atan2(-dz, -dy)];
  }
  function update(d) {
    off = ((off + d) % P + P) % P;
    for (let i = 0; i < n; i++) {
      const [y, z, ang] = at((i * pp + off) % P);
      o.position.set(x, y, z); o.rotation.set(ang, 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    for (const wh of wheels) wh.rotation.x += d / (wh === idler || wh === sprocket ? R : .17);
  }
  update(0);
  return { update };
}

// A hydraulic ram between point a (on one part) and point b (on another): the chrome rod slides out of the barrel.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
export class Ram {
  constructor(root, pa, oa, pb, ob, r, M) {
    this.root = root;
    this.a = new THREE.Object3D(); this.a.position.copy(pa); oa.add(this.a);
    this.b = new THREE.Object3D(); this.b.position.copy(pb); ob.add(this.b);
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12).translate(0, .5, 0), M.paint);
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(r * .55, r * .55, 1, 10).translate(0, .5, 0), M.chrome);
    for (const m of [this.barrel, this.rod]) { m.castShadow = true; root.add(m); }
    this.L0 = 0;
  }
  update() {
    this.a.getWorldPosition(_a); this.root.worldToLocal(_a);
    this.b.getWorldPosition(_b); this.root.worldToLocal(_b);
    _d.subVectors(_b, _a); const L = _d.length(); if (L < 1e-4) return;
    if (!this.L0) this.L0 = L;
    _d.divideScalar(L);
    const lb = this.L0 * .6;
    this.barrel.position.copy(_a); this.barrel.quaternion.setFromUnitVectors(Y, _d); this.barrel.scale.set(1, Math.min(lb, L), 1);
    this.rod.position.copy(_b); this.rod.quaternion.setFromUnitVectors(Y, _d.negate()); this.rod.scale.set(1, Math.max(.15, L - lb * .85), 1);
  }
}

function buildCab(p, w, h, d, x, y, z, M) {
  const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
  rbox(g, w, .1, d, M.frame, 0, .05, 0, .02);
  const t = .07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(g, t, h, t, M.paint, sx * (w / 2 - t / 2), h / 2 + .1, sz * (d / 2 - t / 2), .02);
  for (const sx of [-1, 1]) rbox(g, .05, h, .05, M.paint, sx * (w / 2 - .03), h / 2 + .1, d * .05, .015);
  const gh = h - .1, gy = h / 2 + .12;
  rbox(g, w - 2 * t, gh, .02, M.glass, 0, gy, d / 2 - .035, .005);
  rbox(g, w - 2 * t, gh, .02, M.glass, 0, gy, -d / 2 + .035, .005);
  for (const sx of [-1, 1]) rbox(g, .02, gh, d - 2 * t, M.glass, sx * (w / 2 - .035), gy, 0, .005);
  rbox(g, w, .26, .05, M.paint, 0, .23, d / 2 - .02, .02);
  rbox(g, w + .16, .13, d + .16, M.paint, 0, h + .17, 0, .05);
  rbox(g, w * .7, .06, .1, M.frame, 0, h + .28, d * .2, .02);
  for (const sx of [-1, 1]) { rbox(g, .16, .1, .06, M.light, sx * w * .33, h + .1, d / 2 + .1, .02); rbox(g, .12, .09, .05, M.light, sx * w * .33, h + .1, -d / 2 - .08, .02); }
  rbox(g, .52, .12, .5, M.seat, 0, .55, -d * .12, .04);
  rbox(g, .52, .62, .12, M.seat, 0, .92, -d * .12 - .27, .05);
  for (const sx of [-1, 1]) { rbox(g, .16, .38, .34, M.interior, sx * .36, .48, -d * .08, .03); cylY(g, .025, .025, .2, M.interior, sx * .36, .76, -d * .02, 6); }
  rbox(g, w * .72, .16, .18, M.interior, 0, .7, d / 2 - .2, .03);
  for (const sx of [-1, 1]) {   // mirrors
    cylX(g, .015, .3, M.frame, sx * (w / 2 + .12), h * .7, d / 2 - .05, 5);
    rbox(g, .03, .26, .16, M.frame, sx * (w / 2 + .27), h * .7, d / 2 - .05, .01);
  }
  return g;
}
function beacon(p, x, y, z, M) {
  cylY(p, .08, .1, .05, M.frame, x, y, z, 10);
  return cylY(p, .07, .07, .13, M.beacon, x, y + .09, z, 10);
}
function label(p, text, w, h, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: labelTexture(text), transparent: true, roughness: .6, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(x, y, z); m.rotation.y = ry; p.add(m); return m;
}
function handrail(p, pts, M) { for (let i = 0; i < pts.length - 1; i++) { const a = V(...pts[i]), b = V(...pts[i + 1]); const d = b.clone().sub(a); const m = cylY(p, .02, .02, d.length(), M.paint, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, 6); m.quaternion.setFromUnitVectors(Y, d.normalize()); m.castShadow = false; } }
function ladder(p, x, y0, y1, z, M) {
  for (const dz of [-.18, .18]) cylY(p, .022, .022, y1 - y0, M.frame, x, (y0 + y1) / 2, z + dz, 6);
  for (let y = y0 + .15; y < y1; y += .28) cylZ(p, .018, .36, M.steel, x, y, z, 5);
}
// a heap of dirt or gravel to sit in a bucket or bed (scaled in height by how full it is)
export function moundGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d, 10, 1, 8).translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h * .5) {
      const fx = p.getX(i) / (w / 2), fz = p.getZ(i) / (d / 2);
      p.setY(i, h * (.62 + .38 * Math.max(0, 1 - fx * fx) * Math.max(0, 1 - fz * fz)) + Math.sin(i * 12.9898) * h * .03);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the machines
// Each builder keeps the same tool positions the gameplay code uses (blade edge, bucket tips, bed hinge).
export function buildDozer(m, M, L) {
  const g = new THREE.Group();
  const tl = buildTrack(g, 1.2, 4.3, .42, .6, M), tr = buildTrack(g, -1.2, 4.3, .42, .6, M);
  m.tracks = [tl, tr];
  rbox(g, 1.5, .5, 3.6, M.frame, 0, .72, -.1);
  for (const s of [-1, 1]) {
    rbox(g, .8, .07, 3.4, M.paint, s * 1.2, 1.02, -.2, .02);
    rbox(g, .8, .07, .5, M.paint, s * 1.2, .9, 1.62, .02).rotation.x = .45;
  }
  rbox(g, 1.42, .92, 2.0, M.paint, 0, 1.47, .85, .1);
  rbox(g, 1.2, .7, .06, M.frame, 0, 1.45, 1.86, .02);
  for (let i = 0; i < 8; i++) rbox(g, .035, .62, .05, M.steel, -.49 + i * .14, 1.45, 1.89, .008);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) rbox(g, .03, .5, .07, M.frame, s * .715, 1.45, .2 + i * .2, .008);
  rbox(g, 1.86, .76, 1.4, M.paint, 0, 1.39, -1.5, .1);
  rbox(g, 1.88, .1, 1.42, M.stripe, 0, 1.12, -1.5, .02);
  m.cabG = buildCab(g, 1.55, 1.4, 1.5, 0, 1.77, -1.3, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(0, 3.0, -1.25); g.add(m.cab);
  cylY(g, .075, .075, 1.0, M.frame, .42, 2.4, 1.3); cylY(g, .1, .085, .05, M.frame, .42, 2.92, 1.3);
  cylY(g, .14, .14, .32, M.frame, -.42, 2.08, 1.3); cylY(g, .17, .12, .14, M.steel, -.42, 2.3, 1.3);
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(.42, 2.95, 1.3); g.add(m.exhaust);
  m.beacons = [beacon(g, .55, 3.4, -1.75, M)];
  for (const s of [-1, 1]) { rbox(g, .14, .1, .06, M.tail, s * .8, 1.6, -2.22, .02); rbox(g, .16, .1, .06, M.light, s * .55, 1.75, 1.88, .02); }
  handrail(g, [[.72, 1.05, -2.0], [.72, 1.6, -2.0], [.72, 1.6, -.55]], M);
  rbox(g, 1.5, .24, .32, M.paint, 0, 1.0, -2.42);
  rbox(g, .14, 1.05, .26, M.frame, 0, .55, -2.62, .03); rbox(g, .1, .12, .26, M.steel, 0, .02, -2.66, .02);
  for (const s of [-1, 1]) beam(g, V(s * .55, 1.0, -2.2), V(s * .55, .85, -2.55), .12, .14, M.frame);
  label(g, 'GW 140', .8, .2, .715, 1.65, .85, Math.PI / 2); label(g, 'GW 140', .8, .2, -.715, 1.65, .85, -Math.PI / 2);
  // the blade: a curved moldboard that pushes forward
  const blade = new THREE.Group(); blade.position.set(0, 0, 2.55); g.add(blade);
  const front = [], back = [];
  for (let i = 0; i <= 12; i++) { const y = i / 12 * 1.35, z = .32 - .2 * Math.sin(Math.PI * y / 1.35); front.push([z, y]); back.push([z - .1, y]); }
  blade.add(profileSolid([...front, ...back.reverse()], 3.8, M.paint));
  rbox(blade, 3.8, .14, .1, M.steel, 0, .07, .32, .02);
  for (const s of [-1, 1]) rbox(blade, .1, .55, .38, M.steel, s * 1.9, .28, .2, .02);
  rbox(blade, 3.8, .06, .12, M.stripe, 0, 1.36, .14, .01);
  rbox(blade, 3.1, .3, .18, M.frame, 0, .62, .02, .04);
  for (const s of [-1, 1]) {
    beam(blade, V(s * 1.62, .45, .05), V(s * 1.62, .42, -2.62), .16, .22, M.frame);
    rbox(blade, .22, .36, .26, M.frame, s * 1.62, .45, .02, .04);
  }
  const pile = new THREE.Mesh(heapGeo(2.0, 1.0, 1.2, 3), L.dirt);
  pile.castShadow = true; pile.receiveShadow = true; blade.add(pile);
  m.rams = [-1, 1].map(s => new Ram(g, V(s * .62, 1.82, 1.6), g, V(s * .62, 1.05, -.02), blade, .075, M));
  Object.assign(m, { group: g, blade3: blade, pile });
}

export function buildLoader(m, M, L) {
  const g = new THREE.Group();
  rbox(g, 1.0, .55, 2.9, M.frame, 0, 1.0, -1.35);
  rbox(g, 1.72, .95, 2.2, M.paint, 0, 1.75, -1.85, .12);
  rbox(g, 1.4, .7, .05, M.frame, 0, 1.75, -2.97, .02);
  for (let i = 0; i < 6; i++) rbox(g, 1.3, .04, .05, M.steel, 0, 1.47 + i * .11, -3.0, .008);
  rbox(g, 2.2, .75, .55, M.paint, 0, 1.25, -3.05, .16);
  rbox(g, 2.22, .1, .57, M.stripe, 0, .98, -3.05, .02);
  for (const s of [-1, 1]) { rbox(g, .14, .1, .05, M.tail, s * .85, 1.5, -3.34, .02); rbox(g, .14, .1, .05, M.light, s * .62, 1.5, -3.34, .02); }
  rbox(g, 1.6, .35, 1.7, M.frame, 0, 1.45, -.15);
  m.cabG = buildCab(g, 1.5, 1.4, 1.5, 0, 1.62, -.1, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(0, 2.85, -.05); g.add(m.cab);
  cylY(g, .07, .07, .8, M.frame, -.45, 2.6, -2.25); cylY(g, .09, .08, .05, M.frame, -.45, 3.02, -2.25);
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-.45, 3.05, -2.25); g.add(m.exhaust);
  m.beacons = [beacon(g, -.5, 3.28, -.6, M)];
  m.wheels = [];
  for (const s of [-1, 1]) { m.wheels.push(wheel(g, .85, .65, M, s * 1.18, .85, -1.6)); rbox(g, .74, .07, 1.5, M.paint, s * 1.18, 1.8, -1.6, .02); }
  ladder(g, .92, .4, 1.6, -.95, M);
  handrail(g, [[.8, 1.65, -1.0], [.8, 2.3, -1.0], [.8, 2.3, -2.6]], M);
  label(g, 'GW 950', .9, .22, .865, 1.85, -1.85, Math.PI / 2); label(g, 'GW 950', .9, .22, -.865, 1.85, -1.85, -Math.PI / 2);
  // front half (steers by bending in the middle)
  const front = new THREE.Group(); front.position.set(0, 0, .25); g.add(front); m.front = front;
  cylY(g, .2, .2, .6, M.steel, 0, 1.0, .25);
  rbox(front, 1.1, .6, 1.9, M.frame, 0, 1.0, .85);
  for (const s of [-1, 1]) {
    m.wheels.push(wheel(front, .85, .65, M, s * 1.18, .85, 1.05));
    rbox(front, .74, .07, 1.25, M.paint, s * 1.18, 1.8, 1.0, .02);
    rbox(front, .74, .07, .4, M.paint, s * 1.18, 1.65, 1.72, .02).rotation.x = .7;
    rbox(front, .24, .85, .55, M.frame, s * .62, 1.42, .75, .04);
    rbox(front, .16, .1, .05, M.light, s * .5, 1.5, 1.82, .02);
  }
  const arms = new THREE.Group(); arms.position.set(0, 1.75, .75); front.add(arms);
  for (const s of [-1, 1]) { beam(arms, V(s * .82, 0, -.05), V(s * .82, .28, 1.3), .2, .34, M.paint); beam(arms, V(s * .82, .28, 1.3), V(s * .82, 0, 2.65), .2, .3, M.paint); }
  cylX(arms, .12, 1.7, M.frame, 0, .2, 1.35);
  const crank = rbox(arms, .22, .95, .24, M.paint, 0, .45, 1.3, .05); crank.rotation.x = .35;
  const bucket = new THREE.Group(); bucket.position.set(0, 0, 2.6); arms.add(bucket);
  const curve = smoothCurve([[0, .55], [-.1, .15], [-.02, -.25], [.25, -.43], [.6, -.45], [1.0, -.45]], 18);
  bucket.add(shell(curve, .05, 2.9, M.paint));
  for (const s of [-1, 1]) { const sp = profileSolid([...curve, [.62, .2], [.15, .56]], .05, M.paint); sp.position.x = s * 1.43; bucket.add(sp); }
  rbox(bucket, 2.9, .05, .2, M.steel, 0, -.45, .96, .01);
  for (let i = 0; i < 7; i++) rbox(bucket, .08, .05, .2, M.steel, -1.2 + i * .4, -.45, 1.12, .01);
  rbox(bucket, .5, .3, .15, M.frame, 0, .45, -.02, .03);
  const bl = new THREE.Mesh(heapGeo(2.65, .75, .9, 5), L.dirt); bl.position.set(0, -.42, .45); bl.castShadow = true; bucket.add(bl);
  m.rams = [
    ...[-1, 1].map(s => new Ram(g, V(s * .62, 1.1, .5), front, V(s * .82, -.14, 1.2), arms, .085, M)),
    new Ram(g, V(0, 1.62, .45), front, V(0, .85, 1.18), arms, .08, M),
  ];
  Object.assign(m, { group: g, arms, bucket, bucketLoad: bl });
}

export function buildExcavator(m, M, L) {
  const g = new THREE.Group();
  m.tracks = [buildTrack(g, 1.25, 4.3, .42, .6, M), buildTrack(g, -1.25, 4.3, .42, .6, M)];
  rbox(g, 1.5, .45, 3.0, M.frame, 0, .75, 0);
  cylY(g, 1.0, 1.0, .18, M.frame, 0, 1.06, 0, 28);
  const house = new THREE.Group(); house.position.set(0, 1.15, 0); g.add(house);
  rbox(house, 2.5, .22, 3.2, M.frame, 0, .11, -.45);
  rbox(house, 1.35, .82, 1.6, M.paint, -.55, .63, -1.15, .1);
  for (let i = 0; i < 6; i++) rbox(house, .03, .55, .08, M.frame, -1.235, .63, -1.7 + i * .2, .008);
  rbox(house, 2.5, .92, .72, M.paint, 0, .63, -2.2, .3);
  rbox(house, 2.52, .12, .74, M.stripe, 0, .3, -2.2, .03);
  rbox(house, 1.05, .76, 1.3, M.paint, -.7, .6, .42, .08);
  m.cabG = buildCab(house, 1.0, 1.45, 1.55, .72, .22, .4, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(.72, 1.55, .45); house.add(m.cab);
  rbox(house, .55, .55, .7, M.frame, -.25, .72, .95, .05);
  cylY(house, .065, .065, .62, M.frame, -.85, 1.32, -1.3); cylY(house, .085, .075, .05, M.frame, -.85, 1.65, -1.3);
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-.85, 1.68, -1.3); house.add(m.exhaust);
  m.beacons = [beacon(house, .72, 1.95, .1, M)];
  handrail(house, [[-1.2, 1.05, -.4], [-1.2, 1.4, -.4], [-1.2, 1.4, .95]], M);
  for (const s of [-1, 1]) rbox(house, .14, .1, .05, M.tail, s * .95, .7, -2.57, .02);
  label(house, 'GW 320', .9, .22, -1.236, .85, -1.0, -Math.PI / 2);
  const boom = new THREE.Group(); boom.position.set(-.25, 1.0, 1.0); house.add(boom);
  beam(boom, V(0, 0, 0), V(0, .78, 2.3), .46, .58, M.paint, .07);
  beam(boom, V(0, .78, 2.3), V(0, 0, 4.6), .42, .5, M.paint, .07);
  rbox(boom, .5, .4, .45, M.frame, 0, .8, 2.3, .05);
  const stick = new THREE.Group(); stick.position.set(0, 0, 4.6); boom.add(stick);
  beam(stick, V(0, .5, -.5), V(0, 0, 3.32), .32, .42, M.paint, .05);
  rbox(stick, .38, .3, .3, M.frame, 0, 0, 0, .04);
  const bucket = new THREE.Group(); bucket.position.set(0, 0, 3.3); stick.add(bucket);
  const arc = []; for (let i = 0; i <= 14; i++) { const t = Math.PI - i / 14 * Math.PI; arc.push([.5 + Math.cos(t) * .5, .1 + Math.sin(t) * .5]); }
  arc.push([1.06, -.06]);
  bucket.add(shell(arc, .045, 1.1, M.paint));
  for (const s of [-1, 1]) { const sp = profileSolid(arc, .04, M.paint); sp.position.x = s * .55; bucket.add(sp); }
  for (let i = 0; i < 5; i++) { const t = rbox(bucket, .08, .06, .2, M.steel, -.4 + i * .2, -.1, 1.1, .01); t.rotation.x = .6; }
  rbox(bucket, .3, .2, .25, M.frame, 0, .25, -.05, .03);
  const bl = new THREE.Mesh(heapGeo(.95, .45, .8, 7), L.dirt); bl.position.set(0, .05, .5); bl.rotation.x = Math.PI; bl.castShadow = true; bucket.add(bl);
  m.rams = [
    ...[-1, 1].map(s => new Ram(g, V(-.25 + s * .3, .42, 1.55), house, V(s * .3, .1, 1.9), boom, .1, M)),
    new Ram(g, V(0, 1.1, 2.0), boom, V(0, .62, -.5), stick, .085, M),
    new Ram(g, V(0, .3, .45), stick, V(0, .3, -.08), bucket, .07, M),
  ];
  Object.assign(m, { group: g, house, boom, stick, bucket, bucketLoad: bl });
}

export function buildHauler(m, M, L) {
  const g = new THREE.Group();
  rbox(g, 1.3, .5, 5.6, M.frame, 0, 1.15, -1.6);
  m.wheels = [];
  for (const s of [-1, 1]) {
    rbox(g, .22, .32, 2.7, M.frame, s * .9, .92, -1.85, .04);
    for (const z of [-.8, -2.9]) m.wheels.push(wheel(g, .9, .75, M, s * 1.3, .9, z));
    rbox(g, .14, .1, .05, M.tail, s * .55, 1.2, -4.42, .02);
  }
  const bed = new THREE.Group(); bed.position.set(0, 1.62, -4.3); g.add(bed);
  rbox(bed, 2.55, .14, 5.6, M.paint, 0, .07, 2.8, .03);
  for (const s of [-1, 1]) {
    rbox(bed, .1, 1.3, 5.6, M.paint, s * 1.33, .72, 2.8, .03).rotation.z = -s * .12;
    rbox(bed, .17, .11, 5.66, M.paint, s * 1.42, 1.38, 2.8, .03);
    for (let i = 0; i < 5; i++) rbox(bed, .08, 1.1, .12, M.paint, s * 1.43, .64, .6 + i * 1.1, .02).rotation.z = -s * .12;
  }
  rbox(bed, 2.85, 1.6, .14, M.paint, 0, .8, 5.6, .04);
  rbox(bed, 2.85, .1, .16, M.stripe, 0, 1.55, 5.68, .02);
  rbox(bed, 2.55, .12, .6, M.paint, 0, .18, -.2, .02).rotation.x = .5;
  const bl = new THREE.Mesh(heapGeo(2.55, 1.15, 5.4, 9), L.dirt); bl.position.set(0, .07, 2.75); bl.castShadow = true; bed.add(bl);
  label(bed, 'GW 30', .9, .26, 1.47, .75, 3.0, Math.PI / 2 - .12); label(bed, 'GW 30', .9, .26, -1.47, .75, 3.0, -Math.PI / 2 + .12);
  const front = new THREE.Group(); front.position.set(0, 0, 1.35); g.add(front); m.front = front;
  cylY(g, .24, .24, .7, M.steel, 0, 1.25, 1.35);
  rbox(front, 1.2, .55, 3.0, M.frame, 0, 1.15, 1.6);
  for (const s of [-1, 1]) {
    m.wheels.push(wheel(front, .9, .75, M, s * 1.3, .9, 1.75));
    rbox(front, .86, .07, 1.9, M.paint, s * 1.3, 1.88, 1.75, .02);
    rbox(front, .2, .14, .06, M.light, s * .72, 1.62, 2.98, .02);
  }
  rbox(front, 2.0, 1.1, 1.75, M.paint, 0, 1.85, 2.1, .14);
  rbox(front, 1.5, .7, .05, M.frame, 0, 1.85, 2.98, .02);
  for (let i = 0; i < 7; i++) rbox(front, 1.4, .035, .05, M.steel, 0, 1.58 + i * .09, 3.0, .006);
  rbox(front, 2.3, .3, .3, M.frame, 0, 1.0, 3.0, .05);
  m.cabG = buildCab(front, 1.6, 1.4, 1.45, 0, 2.3, .78, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(0, 3.5, .85); front.add(m.cab);
  cylY(front, .07, .07, 1.0, M.frame, .95, 2.9, 1.45); cylY(front, .09, .08, .05, M.frame, .95, 3.42, 1.45);
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(.95, 3.45, 1.45); front.add(m.exhaust);
  m.beacons = [beacon(front, 0, 3.92, .4, M)];
  ladder(front, -.95, .5, 2.3, .4, M);
  m.rams = [-1, 1].map(s => new Ram(g, V(s * .55, 1.3, -1.2), g, V(s * .55, .0, 3.4), bed, .1, M));
  Object.assign(m, { group: g, bed, bedLoad: bl });
}

// ---------------------------------------------------------------- nature
function colorize(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const [r, g, b] = fn(p.getX(i), p.getY(i), p.getZ(i), i); c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const prep = g => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g.index ? g.toNonIndexed() : g; };
export function pineGeo(seed, h = 11) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(.12 * h / 10, .3 * h / 10, h * .8, 8, 4).translate(0, h * .4, 0);
  colorize(trunk, () => [.36, .27, .2]);
  parts.push(prep(trunk));
  const layers = 8;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1), y0 = h * (.18 + t * .72), R = h * .22 * (1 - t * .8) + .22, H = h * .3 * (1 - t * .4);
    const cone = new THREE.ConeGeometry(R, H, 8, 2).translate(0, y0 + H * .35, 0);
    const p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), rr = Math.hypot(x, z);
      if (rr < .01) continue;
      const j = .8 + h3(Math.round(x * 50) + seed, Math.round(y * 50), Math.round(z * 50)) * .4;
      const droop = rr / R > .85 ? R * .16 * h3(x, seed, z) : 0;
      p.setXYZ(k, x * j, y - droop, z * j);
    }
    cone.computeVertexNormals();
    colorize(cone, (x, y, z) => { const rr = Math.hypot(x, z) / R, v = .55 + rr * .45 + t * .15; return [.13 * v, .25 * v, .11 * v]; });
    parts.push(prep(cone));
  }
  const g = mergeGeometries(parts); return g;
}
export function broadGeo(seed, h = 9) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(.16, .3, h * .6, 8, 3).translate(0, h * .3, 0); colorize(trunk, () => [.38, .31, .24]); parts.push(prep(trunk));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + seed, r = i === 0 ? 0 : h * .17, R = h * (i === 0 ? .26 : .2);
    const b = mergeVertices(new THREE.IcosahedronGeometry(R, 1).deleteAttribute('normal').deleteAttribute('uv')).translate(Math.cos(a) * r, h * (.62 + (i === 0 ? .14 : h3(i, seed, 1) * .1)), Math.sin(a) * r);
    const p = b.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); const j = .82 + h3(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20) + seed) * .32; const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cyy = h * .7; p.setXYZ(k, cx + (x - cx) * j, cyy + (y - cyy) * j, cz + (z - cz) * j); }
    b.computeVertexNormals();
    b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.attributes.position.count * 2), 2));
    colorize(b, (x, y) => { const v = .7 + (y / h - .55) * .9; return [.2 * v, .33 * v, .12 * v]; });
    parts.push(prep(b));
  }
  return mergeGeometries(parts);
}
export function rockGeo(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv')), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = .78 + .22 * Math.sin(x * 2.3 + seed) * Math.cos(z * 2.1 - seed) + .08 * Math.sin(x * 7.1 + y * 6.3 + z * 5.7 + seed);
    p.setXYZ(i, x * n * 1.2, Math.max(-.3, y * n * .62), z * n);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * .5; uv[i * 2 + 1] = p.getY(i) * .5 + p.getZ(i) * .5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
export function tuftGeo() {
  const pos = [], col = [], nor = [];
  let s = 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let b = 0; b < 12; b++) {
    const a = r() * Math.PI * 2, ox = (r() - .5) * .3, oz = (r() - .5) * .3, h = .16 + r() * .26, w = .016 + r() * .01;
    const lean = .1 + r() * .18, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + lx, h, oz + lz);
    const k = .8 + r() * .4;
    const dry = r() < .2;
    col.push(.1 * k, .17 * k, .05 * k, .1 * k, .17 * k, .05 * k, (dry ? .5 : .32) * k, (dry ? .5 : .46) * k, (dry ? .26 : .16) * k);
    for (let i = 0; i < 3; i++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
export function farTreeGeo() {
  const t = new THREE.CylinderGeometry(.2, .3, 3, 5).translate(0, 1.5, 0); colorize(t, () => [.3, .22, .16]);
  const c1 = new THREE.ConeGeometry(2.6, 6, 7).translate(0, 5, 0); colorize(c1, () => [.11, .2, .09]);
  const c2 = new THREE.ConeGeometry(1.9, 5, 7).translate(0, 8, 0); colorize(c2, () => [.13, .23, .1]);
  return mergeGeometries([prep(t), prep(c1), prep(c2)]);
}

// ---------------------------------------------------------------- trees made of textured cards (branches, leaf clumps)
function cardBuilder() {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  return {
    quad(ps, uvs, ns, cs) {
      const b = pos.length / 3;
      for (let q = 0; q < 4; q++) { pos.push(...ps[q]); uv.push(...uvs[q]); nor.push(...ns[q]); col.push(cs[q], cs[q], cs[q] * .95); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    },
    geo() {
      const g = new THREE.BufferGeometry(); g.setIndex(idx);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeBoundingSphere(); return g;
    },
  };
}
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
function seeded(seed) { let s = (seed * 9301 + 49297) % 2147483647 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
// Atlas: branch A u 0-.5 v .5-1, branch B u 0-.5 v 0-.5, whole spruce u .5-.75, leaf clumps u .75-1 (v .5-1 and 0-.5)
export function spruceGeo(seed, h = 13) {
  const R = seeded(seed), B = cardBuilder();
  const cw = h * .48;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3 + R() * .3, dx = Math.cos(a) * cw / 2, dz = Math.sin(a) * cw / 2;
    B.quad([[-dx, h * .03, -dz], [dx, h * .03, dz], [dx, h, dz], [-dx, h, -dz]], [[.5, 0], [.75, 0], [.75, 1], [.5, 1]],
      [nrm(-dx, .4, -dz), nrm(dx, .4, dz), nrm(dx, .9, dz), nrm(-dx, .9, -dz)], [.5, .5, 1, 1]);
  }
  const levels = 12;
  for (let l = 0; l < levels; l++) {
    const t = l / (levels - 1), y = h * (.13 + t * .8), len = h * .34 * Math.pow(1 - t, .85) + .4, nb = 5 + (R() * 2 | 0);
    for (let b = 0; b < nb; b++) {
      const a = b / nb * 6.283 + l * 1.3 + R() * .5, dx = Math.cos(a), dz = Math.sin(a), droop = .22 + R() * .22 + (1 - t) * .15;
      const ex = dx * len * Math.cos(droop), ey = y - len * Math.sin(droop), ez = dz * len * Math.cos(droop);
      const sx = -dz, sz = dx, wb = len * .1, we = len * .34, curl = len * .06;
      const dense = R() < .5, v0 = dense ? 0 : .5, v1 = dense ? .5 : 1;
      const cb = .45 + t * .25, ce = Math.min(1, cb + .35);
      B.quad([[dx * .08 - sx * wb, y, dz * .08 - sz * wb], [ex - sx * we, ey + curl, ez - sz * we], [ex + sx * we, ey + curl, ez + sz * we], [dx * .08 + sx * wb, y, dz * .08 + sz * wb]],
        [[0, v0], [.5, v0], [.5, v1], [0, v1]],
        [nrm(dx - sx * .3, .8, dz - sz * .3), nrm(dx - sx * .4, .6, dz - sz * .4), nrm(dx + sx * .4, .6, dz + sz * .4), nrm(dx + sx * .3, .8, dz + sz * .3)], [cb, ce, ce, cb]);
    }
  }
  const trunk = new THREE.CylinderGeometry(.08 * h / 10, .3 * h / 10, h * .96, 8, 1).translate(0, h * .48, 0);
  return { fol: B.geo(), trunk };
}
export function leafyGeo(seed, h = 11) {
  const R = seeded(seed + 50), B = cardBuilder();
  const cy = h * .66, rx = h * .3, ry = h * .24;
  for (let i = 0; i < 44; i++) {
    let px, py, pz; do { px = R() * 2 - 1; py = R() * 2 - 1; pz = R() * 2 - 1; } while (px * px + py * py + pz * pz > 1);
    const c = [px * rx, cy + py * ry, pz * rx], out = nrm(px + (R() - .5) * .8, py + .3 + (R() - .5) * .8, pz + (R() - .5) * .8);
    let ux = -out[2], uz = out[0]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const vx = out[1] * uz, vy = out[2] * ux - out[0] * uz, vz = -out[1] * ux;
    const s = h * .2 * (.8 + R() * .5) / 2, lo = R() < .5 ? .5 : 0;
    const P = (a, b) => [c[0] + ux * a * s + vx * b * s, c[1] + vy * b * s, c[2] + uz * a * s + vz * b * s];
    const shade = .55 + (py + 1) * .25;
    const nn = p => nrm(p[0], p[1] - cy + ry * .3, p[2]);
    const ps = [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)];
    B.quad(ps, [[.75, lo], [1, lo], [1, lo + .5], [.75, lo + .5]], ps.map(nn), [shade * .85, shade * .85, shade * 1.1, shade * 1.1]);
  }
  const parts = [new THREE.CylinderGeometry(.14, .3, h * .62, 8, 1).translate(0, h * .31, 0)];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * 6.283 + R(), len = h * .3, br = new THREE.CylinderGeometry(.05, .11, len, 6, 1).translate(0, len / 2, 0);
    br.rotateZ(.75); br.rotateY(a); br.translate(0, h * .5, 0); parts.push(br);
  }
  return { fol: B.geo(), trunk: mergeGeometries(parts.map(p => p.toNonIndexed())) };
}
// distant trees: two crossed pictures of a whole spruce
export function farCardGeo() {
  const B = cardBuilder(), h = 14, w = 7;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    B.quad([[-dx, 0, -dz], [dx, 0, dz], [dx, h, dz], [-dx, h, -dz]], [[.5, 0], [.75, 0], [.75, 1], [.5, 1]], [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], [.75, .75, 1, 1]);
  }
  return B.geo();
}
// a lumpy heap of dirt or gravel (for buckets, the bed and in front of the blade); sits on y = 0
export function heapGeo(w, h, d, seed = 1) {
  const g = new THREE.PlaneGeometry(w, d, 16, 16).rotateX(-Math.PI / 2), p = g.attributes.position, R = seeded(seed);
  const bumps = Array.from({ length: 8 }, () => [(R() - .5) * w * .7, (R() - .5) * d * .7, .12 + R() * .2]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), fx = x / (w / 2), fz = z / (d / 2);
    const base = Math.max(0, 1 - fx * fx) * Math.max(0, 1 - fz * fz);
    let y = h * Math.pow(base, .55);
    for (const [bx, bz, bh] of bumps) y += h * bh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (w * w * .02)) * Math.sqrt(base);
    y += h * .06 * Math.sin(x * 11.1 + seed) * Math.cos(z * 9.3 - seed) * Math.sqrt(base);
    p.setY(i, y);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * .6, p.getZ(i) * .6);
  return g;
}
