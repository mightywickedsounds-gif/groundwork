// 3D models for Groundwork: the four machines (with moving track chains, tyres, hydraulic rams and cabs you can sit in),
// trees, boulders and grass. Everything is built from code.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { labelTexture } from './textures.js?v=15';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0), Z = V(0, 0, 1);

// ---------------------------------------------------------------- materials (each machine gets its own set: dirt builds up per machine)
function addGrime(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWP; varying vec3 vGLP; varying vec3 vGLN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vGLP = position; vGLN = normal;
        #ifdef USE_INSTANCING
          vGWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vGWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGround, uGrime, uDmg; uniform sampler2D tGrime, tWear; varying vec3 vGWP; varying vec3 vGLP; varying vec3 vGLN;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // worn paint and steel from a photographed painted-metal sheet: fine scratches, chips and streaks in the colour,
        // and the shine varying across each panel. Projected from three sides so every part gets the same scale.
        { vec3 gwB = abs(normalize(vGLN)); gwB = gwB * gwB * gwB; gwB /= (gwB.x + gwB.y + gwB.z + 1e-4);
          vec2 gwW = texture2D(tWear, vGLP.zy * .45).rg * gwB.x + texture2D(tWear, vGLP.xz * .45).rg * gwB.y + texture2D(tWear, vGLP.xy * .45).rg * gwB.z;
          diffuseColor.rgb *= .82 + .4 * gwW.r;
          roughnessFactor = clamp(roughnessFactor * (.7 + 1.3 * gwW.g), .05, 1.); }
        float gwHgt = vGWP.y - uGround;
        float gwN = texture2D(tGrime, vGLP.xz * .35 + vGLP.y * .21).r * .6 + texture2D(tGrime, vGLP.zy * .9).r * .4;
        float gwLow = clamp((1.8 - gwHgt) / 1.8, 0., 1.); gwLow *= gwLow;
        #ifndef FLAT_SHADED
          vec3 gwWN = inverseTransformDirection(normalize(vNormal), viewMatrix);
          diffuseColor.rgb *= mix(1., .5, clamp(-gwWN.y, 0., 1.)) * mix(.7, 1., smoothstep(.1, 1.5, gwHgt));
        #endif
        diffuseColor.rgb *= .88 + .24 * texture2D(tGrime, vGLP.xy * .23 + vGLP.z * .17).r;
        float gwAmt = clamp(gwLow * 1.3 * uGrime + uGrime * .22, 0., 1.) * smoothstep(.32, .66, gwN + gwLow * .3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.29, .21, .14), gwAmt * .85);
        roughnessFactor = mix(roughnessFactor, .95, gwAmt);
        // wear and damage: scuffs to bare steel, then rust streaks and dents' dark creases
        float dmN = texture2D(tGrime, vec2(vGLP.x + vGLP.y * .7, vGLP.z - vGLP.y * .6) * 3.1).r;
        float dmScuff = smoothstep(.84 - uDmg * .2, .88 - uDmg * .2, dmN) * step(.05, uDmg);
        float dmRust = smoothstep(.62 - uDmg * .22, .7 - uDmg * .22, texture2D(tGrime, vGLP.zy * .7 + .37).r) * smoothstep(.35, .8, uDmg);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.34, .33, .32), dmScuff * .3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.33, .17, .08), dmRust * .75);
        diffuseColor.rgb *= 1. - smoothstep(.85, .9, dmN) * uDmg * .5;
        roughnessFactor = mix(roughnessFactor, .9, dmRust);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - gwAmt;');
  };
  mat.customProgramCacheKey = () => 'gw-grime';
  return mat;
}
export function machineMats(T, color) {
  const U = { uGround: { value: 0 }, uGrime: { value: .2 }, uDmg: { value: 0 }, tGrime: { value: T.macro }, tWear: { value: T.wear } };
  const g = o => addGrime(new THREE.MeshStandardMaterial(o), U);
  return {
    U,
    paint: g({ color, roughness: .36, metalness: .25 }),
    frame: g({ color: 0x2a2c2f, roughness: .6, metalness: .4 }),
    steel: g({ color: 0x8d9298, roughness: .32, metalness: .85 }),
    track: g({ color: 0x3a3836, roughness: .7, metalness: .6 }),
    rubber: g({ color: 0x1b1b1c, roughness: .9, metalness: 0 }),
    hose: g({ color: 0x101012, roughness: .55, metalness: 0 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: .1, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x34454f, roughness: .02, metalness: 1, transparent: true, opacity: .32, envMapIntensity: 2.2, depthWrite: false }),
    interior: new THREE.MeshStandardMaterial({ color: 0x252525, roughness: .85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: .9 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0c1a14, emissive: 0x1f6a55, emissiveIntensity: .55, roughness: .2 }),
    light: new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff3d6, emissiveIntensity: .7, roughness: .15 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0x7a0808, emissiveIntensity: .5, roughness: .2 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8800, emissiveIntensity: .15, transparent: true, opacity: .9, roughness: .2 }),
    stripe: new THREE.MeshStandardMaterial({ map: T.stripes, roughness: .5 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: .8 }),
    drum: g({ color: 0xe9e6df, roughness: .45, metalness: .2 }),
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
// A wheel sits in a holder that doesn't spin: the game moves the holder up and down with the ground, turns it to steer
// and squashes it under load, and spins the tyre inside it (the tyre is what the builders get back).
function wheel(p, r, w, M, x, y, z) {
  const hold = new THREE.Group(); hold.position.set(x, y, z); p.add(hold);
  const t = new THREE.Mesh(tireGeo(r, w), M.rubber); t.castShadow = true; t.receiveShadow = true; hold.add(t);
  t.userData.r = r; t.userData.hold = hold; t.userData.y0 = y;
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
  const sgn = Math.sign(x) || 1;
  weld(p, s => {
    rbox(s, .05, R * .62, 2 * a * .96, M.paint, x + sgn * w * .28, cy - .03, 0, .02);
    rbox(s, .07, .1, 2 * a * .9, M.frame, x + sgn * w * .3, .3, 0, .02);
    for (let i = 0; i < 6; i++) cylX(s, .03, .04, M.steel, x + sgn * w * .31, cy - .03, -a * .8 + i * a * .32, 6);
    for (const z of [-a, a]) { cylX(s, R * .42, .05, M.paint, x + sgn * w * .29, cy, z, 14); for (let i = 0; i < 6; i++) { const q = i / 6 * Math.PI * 2; cylX(s, .025, .04, M.steel, x + sgn * w * .31, cy + Math.cos(q) * R * .28, z + Math.sin(q) * R * .28, 6); } }
  });
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
    if (s < 2 * a) { const u = s / (2 * a), t = u < .3 ? u / .3 : u < .7 ? (u - .3) / .4 : (u - .7) / .3; return [cy + R - (u < .3 || u > .7 ? .05 : .035) * 4 * t * (1 - t), -a + s, Math.PI]; }
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
  return { update, x, a };   // x: which side; a: half the length that sits on the ground
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
  detailCab(g, w, h, d, M);
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

// ---------------------------------------------------------------- fine detail (hoses, guards, ribs, panel seams, lamps)
// Detail parts are built into a scratch group and then welded into one mesh per material, so a machine gains a lot of
// detail for only a handful of extra draw calls.
function weld(parent, build) {
  const scratch = new THREE.Group();
  build(scratch);
  scratch.updateMatrixWorld(true);
  const by = new Map();
  scratch.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!by.has(o.material)) by.set(o.material, []);
    by.get(o.material).push(g);
  });
  for (const [mat, list] of by) {
    const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  }
}
function hose(p, pts, r, mat) {
  const c = new THREE.CatmullRomCurve3(pts.map(q => V(q[0], q[1], q[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(6, pts.length * 5), r, 6), mat); p.add(m); return m;
}
function bar(p, a, b, r, mat) {
  const A = V(a[0], a[1], a[2]), B = V(b[0], b[1], b[2]), d = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 7), mat);
  m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(Y, d.normalize()); p.add(m); return m;
}
// a work lamp in a housing, facing along +z (dir 1) or -z (dir -1)
function lamp(p, x, y, z, dir, M, s = 1) {
  rbox(p, .17 * s, .13 * s, .1 * s, M.frame, x, y, z, .02);
  rbox(p, .13 * s, .09 * s, .03 * s, M.light, x, y, z + dir * .05 * s, .01);
  rbox(p, .04 * s, .08 * s, .04 * s, M.frame, x, y - .1 * s, z, .01);
}
// a door or access panel outline on a side wall at x: thin dark seams with a handle
function panel(p, x, z0, z1, y0, y1, M) {
  const s = Math.sign(x) || 1, t = .014;
  rbox(p, t, t, z1 - z0, M.frame, x, y0, (z0 + z1) / 2, .003); rbox(p, t, t, z1 - z0, M.frame, x, y1, (z0 + z1) / 2, .003);
  rbox(p, t, y1 - y0, t, M.frame, x, (y0 + y1) / 2, z0, .003); rbox(p, t, y1 - y0, t, M.frame, x, (y0 + y1) / 2, z1, .003);
  rbox(p, .03, .035, .14, M.steel, x + s * .012, (y0 + y1) / 2, z1 - .12, .01);
  for (const y of [y0 + (y1 - y0) * .2, y0 + (y1 - y0) * .8]) rbox(p, .02, .07, .05, M.frame, x + s * .006, y, z0 + .03, .006);
}
function bolts(p, pts, r, M, axis = 'x') {
  for (const q of pts) { const b = axis === 'x' ? cylX(p, r, .03, M.steel, q[0], q[1], q[2], 6) : axis === 'z' ? cylZ(p, r, .03, M.steel, q[0], q[1], q[2], 6) : cylY(p, r, r, .03, M.steel, q[0], q[1], q[2], 6); b.castShadow = false; }
}
function liftEye(p, x, y, z, M) { const t = new THREE.Mesh(new THREE.TorusGeometry(.055, .018, 6, 10), M.steel); t.position.set(x, y, z); t.rotation.y = Math.PI / 2; p.add(t); }

function detailCab(g, w, h, d, M) {
  weld(g, s => {
    const t = .07;
    for (const sx of [-1, 1]) {
      rbox(s, .035, .045, d - 2 * t, M.paint, sx * (w / 2 - .025), h * .42 + .1, 0, .01);            // waist rail
      rbox(s, .02, .02, d * .9, M.frame, sx * (w / 2 + .045), h + .1, 0, .005);                         // rain gutter
      bar(s, [sx * (w / 2 + .03), .45, d / 2 - .04], [sx * (w / 2 + .03), h * .8, d / 2 - .04], .016, M.frame);   // grab handle
    }
    rbox(s, .03, .05, .16, M.steel, w / 2 + .012, h * .36, -d * .1, .01);                               // door handle
    rbox(s, .012, h * .92, .012, M.frame, w / 2 + .004, h / 2 + .12, d * .05 + .03, .003);              // door seam
    rbox(s, w * .56, .11, d * .42, M.paint, 0, h + .29, -d * .2, .03);                                  // air conditioner
    for (let i = 0; i < 5; i++) rbox(s, w * .46, .012, .03, M.frame, 0, h + .35, -d * .34 + i * .06, .004);
    const v = rbox(s, w + .04, .03, .24, M.frame, 0, h + .1, d / 2 + .16, .01); v.rotation.x = .28;     // sun visor
    bar(s, [-.02, .3, d / 2 - .015], [.2, h * .78, d / 2 - .015], .009, M.frame);                       // wipers
    bar(s, [.1, .3, -d / 2 + .015], [-.12, h * .7, -d / 2 + .015], .009, M.frame);
    rbox(s, .06, .05, .03, M.frame, -.02, .28, d / 2 + .0, .01);
    cylY(s, .012, .012, .5, M.frame, -w * .38, h + .5, -d * .38, 5);                                    // aerial
    rbox(s, w * .9, .025, d * .9, M.frame, 0, .105, 0, .005);                                           // floor mat
    rbox(s, w * .92, .02, d * .92, M.interior, 0, h + .085, 0, .005);                                   // headliner
    rbox(s, .3, .16, .1, M.seat, 0, 1.3, -d * .12 - .27, .04);                                          // headrest
    for (const sx of [-1, 1]) { rbox(s, .07, .05, .36, M.seat, sx * .3, .78, -d * .12 - .04, .02); rbox(s, .11, .03, .2, M.frame, sx * .16, .16, d / 2 - .22, .01).rotation.x = -.5; }
    const scr = rbox(s, .16, .11, .03, M.interior, w * .3, .98, d / 2 - .13, .01); scr.rotation.y = -.5;
    const scrOn = rbox(s, .13, .08, .012, M.screen, w * .3 - .008, .98, d / 2 - .146, .004); scrOn.rotation.y = -.5;
    for (let i = 0; i < 4; i++) rbox(s, .03, .012, .03, i === 1 ? M.tail : M.light, -w * .22 + i * .07, .79, d / 2 - .2, .004);
    cylY(s, .02, .02, .34, M.interior, 0, .72, d * .2, 6); const sw = new THREE.Mesh(new THREE.TorusGeometry(.15, .018, 6, 16), M.interior); sw.position.set(0, .9, d * .2); sw.rotation.x = -1.1; s.add(sw);
  });
}

function detailDozer(g, blade, M) {
  weld(g, s => {
    // roll-over frame behind the cab, with sweeps running forward to the nose (they shed branches)
    for (const sx of [-1, 1]) {
      rbox(s, .11, 2.5, .13, M.frame, sx * .87, 2.32, -2.14, .02);
      beam(s, V(sx * .87, 3.56, -2.14), V(sx * .87, 3.56, -.5), .08, .09, M.frame, .02);
      bar(s, [sx * .87, 3.56, -.5], [sx * .74, 1.98, 1.78], .035, M.frame);
      lamp(s, sx * .6, 3.66, -.52, 1, M); lamp(s, sx * .6, 3.66, -2.12, -1, M);
      // grip plates on the fenders, access panel and hood latch on each side of the engine
      rbox(s, .62, .018, 1.25, M.frame, sx * 1.2, 1.062, -1.25, .004);
      panel(s, sx * .714, .02, 1.25, 1.1, 1.84, M);
      rbox(s, .05, .05, .22, M.frame, sx * .5, 1.955, 1.5, .012);
      // hydraulic lines to the lift rams
      hose(s, [[sx * .42, 1.92, 1.25], [sx * .52, 2.04, 1.42], [sx * .61, 1.9, 1.58]], .022, M.hose);
      hose(s, [[sx * .36, 1.92, 1.25], [sx * .48, 2.09, 1.46], [sx * .64, 1.94, 1.63]], .022, M.hose);
      rbox(s, .1, .26, .5, M.frame, sx * .78, .82, 1.75, .02);                                          // final-drive guard
      bolts(s, [[sx * 1.52, .5, -1.73], [sx * 1.52, .42, -1.65], [sx * 1.52, .42, -1.81], [sx * 1.52, .34, -1.73]], .022, M);
    }
    rbox(s, 1.86, .12, .13, M.frame, 0, 3.56, -2.14, .02);
    rbox(s, .5, .045, 1.75, M.paint, 0, 1.95, .86, .015);                                               // hood rib
    liftEye(s, 0, 2.0, .2, M); liftEye(s, 0, 2.0, 1.5, M);
    cylY(s, .1, .1, .5, M.steel, .42, 2.2, 1.3, 10);                                                    // exhaust heat shield
    const flap = rbox(s, .2, .015, .2, M.frame, .42, 2.97, 1.24, .004); flap.rotation.x = -.7;
    rbox(s, 1.3, .12, .1, M.frame, 0, 1.06, 1.93, .02);                                                 // nose guard
    for (const sx of [-1, 0, 1]) rbox(s, .06, .8, .05, M.frame, sx * .56, 1.46, 1.93, .01);
    rbox(s, .4, .16, .12, M.steel, 0, .58, 1.9, .03);                                                   // tow hook
  });
  weld(blade, s => {
    for (const x of [-1.25, -.42, .42, 1.25]) { beam(s, V(x, .06, .2), V(x, .68, -.01), .07, .12, M.paint, .01); beam(s, V(x, .68, -.01), V(x, 1.3, .2), .07, .12, M.paint, .01); }
    for (const sx of [-1, 1]) {
      rbox(s, .12, .3, .13, M.steel, sx * 1.86, .15, .33, .02);                                         // corner bits
      beam(s, V(sx * 1.62, .5, -1.25), V(sx * 1.25, 1.05, .0), .09, .1, M.frame, .02);                  // tilt braces
      cylX(s, .11, .16, M.steel, sx * 1.62, .43, -2.6, 10);                                             // trunnions
    }
    for (let i = 0; i < 9; i++) cylZ(s, .028, .03, M.frame, -1.6 + i * .4, .07, .385, 6);               // cutting-edge bolts
  });
}

function detailLoader(g, front, arms, bucket, M) {
  weld(g, s => {
    rbox(s, .6, .045, 1.9, M.paint, 0, 2.245, -1.85, .015);                                             // hood rib
    cylY(s, .13, .13, .26, M.frame, .45, 2.37, -2.3, 12); cylY(s, .16, .13, .1, M.steel, .45, 2.55, -2.3, 12);   // air pre-cleaner
    const flap = rbox(s, .18, .015, .18, M.frame, -.45, 3.07, -2.3, .004); flap.rotation.x = .7;
    cylY(s, .095, .095, .4, M.steel, -.45, 2.45, -2.25, 10);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) rbox(s, .03, .5, .07, M.frame, sx * .865, 1.78, -2.75 + i * .16, .008);
      panel(s, sx * .864, -1.7, -.95, 1.38, 2.16, M);
      rbox(s, .6, .018, 1.3, M.frame, sx * 1.18, 1.842, -1.6, .004);
      const fl = rbox(s, .66, .5, .03, M.rubber, sx * 1.18, 1.5, -2.42, .01); fl.rotation.x = -.12;     // mud flap
      liftEye(s, sx * .7, 1.66, -3.05, M);
      lamp(s, sx * .55, 2.3, -2.9, -1, M, .8);
    }
    rbox(s, .5, .18, .2, M.steel, 0, .95, -3.33, .04);                                                  // tow hitch
    rbox(s, 1.3, .3, .06, M.frame, 0, 1.28, -3.34, .02);
  });
  weld(front, s => {
    for (const sx of [-1, 1]) {
      const fl = rbox(s, .66, .45, .03, M.rubber, sx * 1.18, 1.52, .3, .01); fl.rotation.x = .1;
      rbox(s, .6, .018, 1.0, M.frame, sx * 1.18, 1.842, 1.0, .004);
      lamp(s, sx * .86, 1.95, 1.55, 1, M, .9);
    }
    rbox(s, 1.5, .1, .1, M.frame, 0, 1.3, 1.82, .02);
  });
  weld(arms, s => {
    for (const sx of [-1, 1]) {
      hose(s, [[sx * .69, .02, .1], [sx * .69, .27, 1.3], [sx * .69, .04, 2.4]], .024, M.hose);
      hose(s, [[sx * .69, .1, .1], [sx * .69, .35, 1.3], [sx * .69, .12, 2.4]], .024, M.hose);
      cylX(s, .13, .26, M.steel, sx * .82, 0, 2.62, 10); cylX(s, .13, .26, M.steel, sx * .82, 0, -.02, 10);   // pins
    }
    beam(s, V(0, .86, 1.47), V(0, .46, 2.52), .11, .13, M.frame, .02);                                 // tilt link
    cylX(s, .07, .3, M.steel, 0, .86, 1.47, 8);
  });
  weld(bucket, s => {
    rbox(s, 2.9, .14, .05, M.paint, 0, .62, .13, .01);                                                  // spill guard
    for (const sx of [-1, 1]) { rbox(s, .06, .3, .5, M.steel, sx * 1.46, -.3, .78, .01); rbox(s, .3, .26, .1, M.frame, sx * .82, .2, -.06, .02); }
    for (let i = 0; i < 5; i++) rbox(s, .09, .03, 1.0, M.steel, -1.2 + i * .6, -.49, .5, .008);        // wear strips
  });
}

function detailExcavator(g, house, boom, stick, bucket, M) {
  weld(g, s => {
    for (const z of [-.85, .85]) rbox(s, 2.3, .3, .55, M.frame, 0, .62, z, .04);                        // cross-members to the track frames
    for (const sx of [-1, 1]) rbox(s, .3, .035, .5, M.steel, sx * 1.66, .62, 0, .008);                  // steps
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; cylY(s, .03, .03, .04, M.steel, Math.cos(a) * .9, 1.16, Math.sin(a) * .9, 6); }
  });
  weld(house, s => {
    rbox(s, 1.02, .74, 1.52, M.paint, .72, .59, -1.14, .08);                                            // hydraulic and fuel tanks behind the cab
    panel(s, 1.232, -1.8, -.5, .32, .9, M);
    panel(s, -1.227, -.15, .95, .3, .92, M);
    cylY(s, .07, .07, .05, M.steel, .5, .98, -.7, 8); cylY(s, .06, .06, .05, M.frame, .9, .98, -1.5, 8);
    handrail(s, [[1.2, .96, -1.85], [1.2, 1.32, -1.85], [1.2, 1.32, -.48], [1.2, .96, -.48]], M);
    rbox(s, .62, .018, 1.2, M.frame, .72, .97, -1.15, .004);                                            // anti-slip top
    rbox(s, .9, .045, 1.3, M.paint, -.55, 1.06, -1.15, .015);                                           // engine cover rib
    rbox(s, .5, .04, .05, M.steel, -.55, 1.1, -.55, .01);
    cylY(s, .12, .12, .3, M.frame, -.25, 1.2, -1.6, 10); cylY(s, .14, .12, .08, M.steel, -.25, 1.38, -1.6, 10);   // air cleaner
    cylY(s, .09, .09, .36, M.steel, -.85, 1.2, -1.3, 10);
    rbox(s, 1.7, .03, .36, M.frame, 0, 1.095, -2.18, .006);                                             // counterweight top
    for (const sx of [-1, 1]) { liftEye(s, sx * .9, 1.12, -2.2, M); rbox(s, .5, .3, .03, M.frame, sx * .6, .62, -2.565, .01); lamp(s, sx * 1.0, 1.0, 1.05, 1, M, .8); }
    rbox(s, .12, .1, .1, M.frame, 0, 1.05, -2.5, .02);                                                  // rear camera
    for (let i = 0; i < 4; i++) rbox(s, .5, .015, .03, M.frame, .72, .4 + i * .1, -1.905, .004);
  });
  weld(boom, s => {
    for (const sx of [-1, 1]) for (const dy of [-.07, .07]) hose(s, [[sx * .26, .1 + dy, .25], [sx * .26, .44 + dy, 1.25], [sx * .245, .78 + dy, 2.3], [sx * .24, .44 + dy, 3.35], [sx * .23, .12 + dy, 4.35]], .017, M.hose);
    for (const z of [1.2, 3.4]) for (const sx of [-1, 1]) rbox(s, .03, .26, .07, M.steel, sx * .262, z < 2 ? .42 : .43, z, .008);   // hose clamps
    lamp(s, .32, .62, 1.6, 1, M, .9);
    for (const sx of [-1, 1]) { cylX(s, .12, .1, M.steel, sx * .26, 0, 4.6, 10); cylX(s, .13, .1, M.steel, sx * .28, 0, 0, 10); rbox(s, .04, .5, .9, M.paint, sx * .24, .8, 2.3, .01); }
  });
  weld(stick, s => {
    for (const sx of [-1, 1]) {
      hose(s, [[sx * .185, .46, -.3], [sx * .18, .28, 1.2], [sx * .175, .1, 2.5]], .015, M.hose);
      cylX(s, .09, .08, M.steel, sx * .19, 0, 3.3, 8);
      beam(s, V(sx * .2, .22, 2.62), V(sx * .2, .52, 2.98), .05, .09, M.frame, .01);                    // bucket links
    }
    cylX(s, .05, .5, M.steel, 0, .52, 2.98, 8);
    rbox(s, .34, .05, 1.4, M.paint, 0, .37, 1.3, .01).rotation.x = .135;
  });
  weld(bucket, s => {
    for (const sx of [-1, 1]) { rbox(s, .05, .12, .5, M.steel, sx * .57, -.02, .85, .01); rbox(s, .05, .3, .3, M.frame, sx * .2, .3, -.02, .01); }
    for (let i = 0; i < 3; i++) rbox(s, 1.1, .03, .07, M.steel, 0, .12 - .1 * Math.cos(i - 1), .2 + i * .3, .008);
  });
}

function detailHauler(g, front, bed, M) {
  weld(g, s => {
    for (const sx of [-1, 1]) {
      rbox(s, .42, .5, .95, M.paint, sx * .98, 1.12, .5, .08);                                          // tanks on the frame
      for (const z of [.2, .8]) rbox(s, .44, .03, .04, M.steel, sx * .98, 1.12, z, .008);
      cylY(s, .06, .06, .04, M.steel, sx * .98, 1.39, .7, 8);
      for (const z of [-1.86, -3.95]) { const fl = rbox(s, .7, .55, .03, M.rubber, sx * 1.3, .95, z, .01); fl.rotation.x = -.1; }
      rbox(s, .2, .12, .05, M.frame, sx * .55, 1.2, -4.4, .02);
    }
    rbox(s, 1.5, .16, .12, M.frame, 0, .95, -4.38, .03);
    for (const z of [-.8, -2.9]) cylX(s, .14, 2.0, M.frame, 0, .9, z, 10);                              // axles
  });
  weld(front, s => {
    rbox(s, .7, .045, 1.5, M.paint, 0, 2.415, 2.1, .015);                                               // hood rib
    for (const sx of [-1, 1]) {
      panel(s, sx * 1.002, 1.45, 2.75, 1.45, 2.3, M);
      for (let i = 0; i < 5; i++) rbox(s, .03, .4, .07, M.frame, sx * 1.004, 1.9, 1.7 + i * .16, .008);
      handrail(s, [[sx * .98, 2.4, 1.3], [sx * .98, 2.85, 1.3], [sx * .98, 2.85, 2.9], [sx * .98, 2.4, 2.9]], M);
      rbox(s, .7, .018, 1.6, M.frame, sx * 1.3, 1.922, 1.75, .004);
      lamp(s, sx * .9, 2.5, 2.98, 1, M, .9);
      rbox(s, .3, .035, .4, M.steel, sx * 1.18, .75, .4, .008);                                         // step
    }
    cylY(s, .13, .13, .3, M.frame, -.95, 2.56, 1.5, 12); cylY(s, .16, .13, .1, M.steel, -.95, 2.76, 1.5, 12);
    cylY(s, .095, .095, .5, M.steel, .95, 2.7, 1.45, 10);
    rbox(s, .5, .2, .16, M.steel, 0, 1.0, 3.14, .04);
    for (const sx of [-1, 1]) rbox(s, .1, .34, .1, M.stripe, sx * 1.02, 1.0, 3.06, .02);
  });
  weld(bed, s => {
    // the spill guard: the front wall carries on up and reaches forward over the cab
    rbox(s, 2.85, 1.1, .12, M.paint, 0, 2.1, 5.6, .03);
    rbox(s, 2.7, .09, 1.15, M.paint, 0, 2.66, 6.15, .03);
    for (const sx of [-1, 0, 1]) { beam(s, V(sx * 1.2, 1.7, 5.68), V(sx * 1.2, 2.6, 6.6), .07, .09, M.paint, .01); rbox(s, .07, .06, 1.1, M.paint, sx * 1.2, 2.72, 6.15, .01); }
    for (let i = 0; i < 4; i++) rbox(s, 2.6, .06, .1, M.paint, 0, -.02, .9 + i * 1.3, .01);             // floor bearers
    for (const sx of [-1, 1]) { rbox(s, .1, .1, 5.5, M.frame, sx * .55, -.06, 2.8, .02); cylX(s, .1, .3, M.steel, sx * .55, 0, 0, 10); }
  });
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
  detailDozer(g, blade, M);
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
  detailLoader(g, front, arms, bucket, M);
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
  detailExcavator(g, house, boom, stick, bucket, M);
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
  detailHauler(g, front, bed, M);
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
  // a tuft of fine curved blades: dark at the root, the ground's own green higher up, a few dry straws
  const pos = [], col = [], nor = [];
  let s = 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let b = 0; b < 14; b++) {
    const a = r() * Math.PI * 2, ox = (r() - .5) * .42, oz = (r() - .5) * .42, h = .13 + r() * r() * .3, w = .009 + r() * .008;
    const lean = .05 + r() * .16, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const mx = ox + lx * .35, mz = oz + lz * .35, my = h * .55, tx = ox + lx, tz = oz + lz;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, mx + px * .8, my, mz + pz * .8,
      ox - px, 0, oz - pz, mx + px * .8, my, mz + pz * .8, mx - px * .8, my, mz - pz * .8,
      mx - px * .8, my, mz - pz * .8, mx + px * .8, my, mz + pz * .8, tx, h, tz);
    const k = .75 + r() * .5, dry = r() < .16;
    const c0 = [.05 * k, .085 * k, .028 * k], c1 = dry ? [.24 * k, .23 * k, .1 * k] : [.13 * k, .21 * k, .06 * k], c2 = dry ? [.4 * k, .38 * k, .18 * k] : [.22 * k, .33 * k, .1 * k];
    col.push(...c0, ...c0, ...c1, ...c0, ...c1, ...c1, ...c1, ...c1, ...c2);
    const nl = Math.hypot(lx * 1.5, 1, lz * 1.5);
    for (let i = 0; i < 9; i++) nor.push(lx * 1.5 / nl, 1 / nl, lz * 1.5 / nl);
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
// A trunk: tapering, flared into roots at the foot, with a slight lean and a few bulges, so no two are the same
// (from the tree's own seeded numbers). Open at the bottom (it stands in the ground).
function trunkGeo(R, h, rTop, rBot, flare) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 10, 8, true).translate(0, h / 2, 0), p = g.attributes.position;
  const lx = (R() - .5) * .04 * h, lz = (R() - .5) * .04 * h, ph = R() * 6.28, roots = 4 + (R() * 3 | 0), rp = R() * 6.28;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / h, a = Math.atan2(z, x);
    let k = 1 + flare * Math.exp(-y / (.035 * h + .25)) * (.6 + .4 * Math.max(0, Math.cos(roots * a + rp)));   // root flare, lobed
    k *= 1 + .06 * Math.sin(y * 1.7 + ph) * Math.sin(a * 3 + ph);                                                // bulges
    p.setXYZ(i, x * k + lx * t * t, y, z * k + lz * t * t);
  }
  g.computeVertexNormals();
  return g;
}
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
  const trunk = trunkGeo(R, h * .96, .08 * h / 10, .3 * h / 10, 1.6);
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
  const parts = [trunkGeo(R, h * .62, .14, .3, 1.3)];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * 6.283 + R(), len = h * .3, br = new THREE.CylinderGeometry(.05, .11, len, 6, 1).translate(0, len / 2, 0);
    br.rotateZ(.75); br.rotateY(a); br.translate(0, h * .5, 0); parts.push(br);
  }
  return { fol: B.geo(), trunk: mergeGeometries(parts.map(p => p.toNonIndexed())) };
}
// distant trees: two crossed pictures of a whole spruce, inside a six-sided cone of the same picture so the crown
// looks solid from above too (the boss view looks down on the far forest)
export function farCardGeo() {
  const B = cardBuilder(), h = 14, w = 7;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    B.quad([[-dx, 0, -dz], [dx, 0, dz], [dx, h, dz], [-dx, h, -dz]], [[.5, 0], [.75, 0], [.75, 1], [.5, 1]], [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], [.75, .75, 1, 1]);
  }
  const n = 6, rb = w * .46, y0 = h * .12;
  for (let k = 0; k < n; k++) {
    const a0 = (k + .25) / n * 6.283, a1 = (k + 1.25) / n * 6.283, am = (a0 + a1) / 2;
    const p0 = [Math.cos(a0) * rb, y0, Math.sin(a0) * rb], p1 = [Math.cos(a1) * rb, y0, Math.sin(a1) * rb], top = [0, h, 0];
    const nn = nrm(Math.cos(am), .55, Math.sin(am));
    // a triangle drawn as a quad with two corners at the top
    B.quad([p0, p1, top, top], [[.5, 0], [.75, 0], [.625, 1], [.625, 1]], [nn, nn, [0, 1, 0], [0, 1, 0]], [.7, .7, 1, 1]);
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

// ---------------------------------------------------------------- a crew member sitting in a cab (seat at the cab's origin)
const WORKER_MATS = {
  vest: new THREE.MeshStandardMaterial({ color: 0xd8f03a, emissive: 0x3a4a00, emissiveIntensity: .35, roughness: .7 }),
  band: new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: .3, metalness: .4 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: .9 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: .95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: .7 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: .8 }),
};
const HAT_COLS = [0xf2f2ec, 0xf6c21c, 0xe8792a];
function limb(p, a, b, r, mat) {
  const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .9, d.length(), 7), mat);
  m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(Y, d.normalize()); m.castShadow = true; p.add(m); return m;
}
export function buildWorker(i = 0) {
  const g = new THREE.Group(), W = WORKER_MATS;
  rbox(g, .4, .52, .26, W.shirt, 0, .9, -.22, .08);                      // body
  rbox(g, .43, .4, .28, W.vest, 0, .95, -.22, .07);                      // hi-vis vest
  for (const y of [.86, 1.0]) rbox(g, .44, .035, .29, W.band, 0, y, -.22, .01);
  rbox(g, .4, .14, .3, W.pants, 0, .66, -.2, .05);                       // hips
  const head = new THREE.Mesh(new THREE.SphereGeometry(.105, 12, 10), W.skin); head.scale.set(1, 1.12, 1.05); head.position.set(0, 1.29, -.2); g.add(head);
  const hm = new THREE.MeshStandardMaterial({ color: HAT_COLS[i % 3], roughness: .35 });
  const hat = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm); hat.position.set(0, 1.33, -.2); hat.castShadow = true; g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(.165, .165, .02, 16), hm); brim.position.set(0, 1.335, -.17); brim.scale.set(1, 1, 1.1); g.add(brim);
  for (const s of [-1, 1]) {
    limb(g, V(s * .11, .66, -.18), V(s * .12, .66, .22), .075, W.pants);   // thighs
    limb(g, V(s * .12, .66, .22), V(s * .13, .2, .3), .062, W.pants);     // shins
    rbox(g, .11, .1, .24, W.boot, s * .13, .16, .36, .03);
    limb(g, V(s * .23, 1.1, -.22), V(s * .27, .86, -.06), .055, W.vest);   // upper arms
    limb(g, V(s * .27, .86, -.06), V(s * .34, .8, .14), .045, W.shirt);   // forearms
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), W.skin); hand.position.set(s * .35, .8, .16); g.add(hand);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- road and bridge equipment (brought in by the crew)
// single-drum road roller: steel drum at the front (steers by bending in the middle), tyres and cab at the back
export function buildRoller(m, M) {
  const g = new THREE.Group();
  rbox(g, 1.5, .7, 2.4, M.paint, 0, 1.25, -1.0, .12);
  rbox(g, 1.9, .5, .6, M.paint, 0, 1.0, -2.2, .1);
  for (const s of [-1, 1]) rbox(g, .14, .1, .05, M.tail, s * .7, 1.2, -2.52, .02);
  m.wheels = [];
  for (const s of [-1, 1]) m.wheels.push(wheel(g, .78, .62, M, s * .95, .78, -1.3));
  m.cabG = buildCab(g, 1.4, 1.35, 1.3, 0, 1.6, -.7, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(0, 2.8, -.65); g.add(m.cab);
  cylY(g, .06, .06, .7, M.frame, .55, 2.25, -1.9); m.exhaust = new THREE.Object3D(); m.exhaust.position.set(.55, 2.6, -1.9); g.add(m.exhaust);
  m.beacons = [beacon(g, 0, 3.12, -.9, M)];
  const front = new THREE.Group(); front.position.set(0, 0, .35); g.add(front); m.front = front;
  cylY(g, .18, .18, .5, M.steel, 0, .95, .35);
  rbox(front, .9, .45, 1.0, M.frame, 0, 1.0, .5);
  for (const s of [-1, 1]) rbox(front, .14, 1.35, 1.9, M.paint, s * 1.18, .95, 1.55, .04);
  rbox(front, 2.5, .14, 1.9, M.paint, 0, 1.65, 1.55, .04);
  const drum = new THREE.Group(); drum.position.set(0, .78, 1.55); front.add(drum); m.drum = drum;
  const dm = new THREE.Mesh(new THREE.CylinderGeometry(.78, .78, 2.1, 28).rotateZ(Math.PI / 2), M.steel); dm.castShadow = true; drum.add(dm);
  for (let i = 0; i < 6; i++) { const r = rbox(drum, 2.12, .03, .04, M.frame, 0, .78, 0, .005); r.position.set(0, Math.cos(i / 6 * 6.283) * .78, Math.sin(i / 6 * 6.283) * .78); r.rotation.x = i / 6 * 6.283; }
  label(g, 'GW R12', .9, .22, .76, 1.3, -1.0, Math.PI / 2); label(g, 'GW R12', .9, .22, -.76, 1.3, -1.0, -Math.PI / 2);
  m.rams = [];
  Object.assign(m, { group: g });
}
// asphalt paver: tracks, a hopper in front, a conveyor through the middle and a wide screed trailing behind
export function buildPaver(m, M) {
  const g = new THREE.Group();
  m.tracks = [buildTrack(g, 1.05, 2.9, .32, .45, M), buildTrack(g, -1.05, 2.9, .32, .45, M)];
  rbox(g, 1.7, .6, 3.4, M.paint, 0, 1.0, -.1, .08);
  rbox(g, 2.3, .8, 1.3, M.paint, 0, 1.55, -.9, .1);
  // hopper with folding wings
  rbox(g, 2.2, .1, 1.5, M.frame, 0, .95, 1.95, .02);
  for (const s of [-1, 1]) { const w = rbox(g, .08, .7, 1.5, M.paint, s * 1.1, 1.3, 1.95, .02); w.rotation.z = s * .5; }
  rbox(g, 2.2, .7, .08, M.paint, 0, 1.25, 2.7, .02);
  m.hopperLoad = new THREE.Mesh(heapGeo(1.8, .5, 1.3, 11), M.asphalt); m.hopperLoad.position.set(0, 1.0, 1.95); g.add(m.hopperLoad);
  // operator platform with canopy
  rbox(g, 2.0, .1, 1.0, M.frame, 0, 2.0, -1.9, .02);
  rbox(g, .5, .5, .45, M.seat, .5, 2.3, -2.0, .05); rbox(g, .5, .5, .45, M.seat, -.5, 2.3, -2.0, .05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(g, .06, 1.4, .06, M.frame, sx * .95, 2.7, -1.9 + sz * .45, .01);
  rbox(g, 2.2, .08, 1.2, M.paint, 0, 3.42, -1.9, .03);
  m.cabG = new THREE.Group(); m.cabG.position.set(.5, 2.05, -1.9); g.add(m.cabG);
  m.cab = new THREE.Object3D(); m.cab.position.set(.5, 3.2, -1.95); g.add(m.cab);
  cylY(g, .06, .06, .9, M.frame, -.7, 2.4, -.5); m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-.7, 2.85, -.5); g.add(m.exhaust);
  m.beacons = [beacon(g, 0, 3.5, -1.9, M)];
  // the screed: a wide heated plate that irons the asphalt flat
  const screed = new THREE.Group(); screed.position.set(0, .35, -2.75); g.add(screed); m.screed = screed;
  rbox(screed, 3.6, .45, .7, M.paint, 0, .2, 0, .04);
  rbox(screed, 3.7, .08, .8, M.frame, 0, -.02, 0, .01);
  for (const s of [-1, 1]) rbox(screed, .06, .5, .8, M.frame, s * 1.86, .25, 0, .01);
  rbox(screed, 3.4, .08, .3, M.frame, 0, .5, -.45, .01);
  for (const s of [-1, 1]) beam(g, V(s * .8, .9, -1.8), V(s * 1.2, .55, -2.6), .1, .12, M.frame);
  label(g, 'GW P8', .8, .22, 1.16, 1.6, -.9, Math.PI / 2); label(g, 'GW P8', .8, .22, -1.16, 1.6, -.9, -Math.PI / 2);
  m.rams = [];
  Object.assign(m, { group: g });
}
// concrete mixer truck: three axles, a turning drum and a chute at the back
export function buildMixer(m, M) {
  const g = new THREE.Group();
  rbox(g, 1.2, .4, 7.2, M.frame, 0, 1.05, -.4);
  m.wheels = [];
  for (const s of [-1, 1]) { m.wheels.push(wheel(g, .55, .4, M, s * 1.05, .55, 2.4)); for (const z of [-1.6, -2.9]) m.wheels.push(wheel(g, .55, .55, M, s * 1.0, .55, z)); }
  rbox(g, 2.3, 1.4, 1.7, M.paint, 0, 1.95, 2.55, .12);
  rbox(g, 2.1, .7, .05, M.frame, 0, 1.6, 3.42, .02);
  m.cabG = buildCab(g, 2.0, 1.15, 1.3, 0, 2.55, 2.45, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(.45, 3.25, 2.5); g.add(m.cab);
  for (const s of [-1, 1]) { rbox(g, .2, .12, .05, M.light, s * .8, 1.5, 3.44, .02); rbox(g, .14, .1, .05, M.tail, s * .9, 1.0, -4.0, .02); }
  cylY(g, .07, .07, 1.2, M.frame, -1.0, 3.1, 1.6); m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-1.0, 3.7, 1.6); g.add(m.exhaust);
  m.beacons = [beacon(g, 0, 3.9, 2.4, M)];
  // the drum: a fat spindle on a tilt, with spiral fins painted on
  const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(.25 + Math.sin(Math.PI * Math.pow(t, .8)) * 1.0 + (1 - t) * .2, t * 5.2 - 2.6)); }
  const drumG = new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2);
  const drum = new THREE.Group(); drum.position.set(0, 2.65, -.9); drum.rotation.x = -.22; g.add(drum);
  const dm = new THREE.Mesh(drumG, M.drum); dm.castShadow = true; drum.add(dm); m.drum = dm;
  for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(1.12, .05, 6, 28, Math.PI * 1.2), M.paint); f.position.z = -1.4 + i * 1.3; f.rotation.y = .25; dm.add(f); }
  rbox(g, 1.3, 1.3, .3, M.frame, 0, 2.1, 1.25, .04);
  const chute = new THREE.Group(); chute.position.set(0, 2.1, -3.7); g.add(chute); m.chute = chute;
  rbox(chute, .45, .08, 1.6, M.steel, 0, 0, -.8, .01); for (const s of [-1, 1]) rbox(chute, .05, .2, 1.6, M.steel, s * .22, .08, -.8, .01);
  chute.rotation.x = .5;
  ladder(g, .8, 1.2, 3.2, -3.4, M);
  label(g, 'GW READYMIX', 1.6, .3, 1.16, 1.25, -.6, Math.PI / 2); label(g, 'GW READYMIX', 1.6, .3, -1.16, 1.25, -.6, -Math.PI / 2);
  m.rams = [];
  Object.assign(m, { group: g });
}
// mobile crane: four axles, outriggers, a turning upper with its own cab, telescopic boom and a hook on a cable
export function buildCrane(m, M) {
  const g = new THREE.Group();
  rbox(g, 2.3, .8, 9.0, M.paint, 0, 1.35, 0, .1);
  m.wheels = [];
  for (const s of [-1, 1]) for (const z of [3.2, 1.9, -1.9, -3.2]) m.wheels.push(wheel(g, .62, .5, M, s * 1.12, .62, z));
  rbox(g, 1.2, 1.3, 1.6, M.paint, -.55, 2.4, 3.8, .1);
  buildCab(g, 1.1, 1.0, 1.3, -.55, 2.0, 3.9, M);
  m.outr = [];
  for (const s of [-1, 1]) for (const z of [3.0, -3.3]) { const o = new THREE.Group(); o.position.set(s * 1.15, 1.2, z); g.add(o); rbox(o, 1.6, .25, .3, M.frame, s * .8, 0, 0, .03); const leg = rbox(o, .2, .9, .2, M.frame, s * 1.55, -.5, 0, .02); rbox(o, .6, .08, .6, M.steel, s * 1.55, -.95, 0, .01); o.leg = leg; m.outr.push(o); }
  const house = new THREE.Group(); house.position.set(0, 1.8, -1.2); g.add(house); m.house = house;
  cylY(house, 1.1, 1.1, .3, M.frame, 0, 0, 0, 24);
  rbox(house, 2.2, 1.0, 3.2, M.paint, 0, .7, -.9, .1);
  rbox(house, 2.3, 1.0, 1.1, M.frame, 0, .8, -2.6, .1);   // counterweight
  m.cabG = buildCab(house, .9, 1.2, 1.3, -.8, .3, .9, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(-.8, 1.5, .95); house.add(m.cab);
  // telescopic boom: three sections; the tip is 12.6 m from the pivot retracted and 32.6 m fully out
  const boom = new THREE.Group(); boom.position.set(.3, 1.4, -.6); house.add(boom); m.boom = boom;
  rbox(boom, .8, .8, 8.5, M.paint, 0, 0, 3.75, .06);
  const b2 = new THREE.Group(); b2.position.set(0, 0, 1); boom.add(b2); m.boom2 = b2;
  rbox(b2, .64, .64, 10.5, M.paint, 0, 0, 5.25, .05);
  const b3 = new THREE.Group(); b3.position.set(0, 0, 1); b2.add(b3); m.boom3 = b3;
  rbox(b3, .5, .5, 10.5, M.paint, 0, 0, 5.25, .05);
  const tip = new THREE.Object3D(); tip.position.set(0, .1, 10.6); b3.add(tip); m.tip = tip;
  cylX(b3, .3, .5, M.frame, 0, .1, 10.5, 16);
  m.rams = [new Ram(house, V(.3, .3, .9), house, V(.3, -.3, 2.6), boom, .14, M)];
  // hook block and cable (in world space, placed every frame)
  m.hook = new THREE.Group(); const hb = rbox(m.hook, .4, .5, .3, M.stripe, 0, 0, 0, .05); hb.castShadow = true;
  const hk = new THREE.Mesh(new THREE.TorusGeometry(.14, .04, 6, 12, Math.PI * 1.4), M.steel); hk.position.y = -.4; m.hook.add(hk);
  m.cable = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1, 4).translate(0, -.5, 0), M.frame);
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(.9, 1.6, -2.0); house.add(m.exhaust);
  m.beacons = [beacon(g, -.55, 3.1, 3.4, M)];
  label(g, 'GW C60', 1.0, .26, 1.16, 1.4, .5, Math.PI / 2); label(g, 'GW C60', 1.0, .26, -1.16, 1.4, .5, -Math.PI / 2);
  Object.assign(m, { group: g });
}
// utility truck: crew cab and a flatbed with a paint tank and a post driver (markings, posts, signs, lights, seeding)
export function buildTruck(m, M) {
  const g = new THREE.Group();
  rbox(g, 1.1, .35, 6.0, M.frame, 0, .85, -.4);
  m.wheels = [];
  for (const s of [-1, 1]) { m.wheels.push(wheel(g, .5, .38, M, s * .98, .5, 1.9)); m.wheels.push(wheel(g, .5, .5, M, s * .95, .5, -2.1)); }
  rbox(g, 2.2, 1.1, 1.5, M.paint, 0, 1.6, 2.4, .14);
  m.cabG = buildCab(g, 2.0, 1.0, 1.6, 0, 1.95, 1.6, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(.45, 2.6, 1.65); g.add(m.cab);
  rbox(g, 2.3, .12, 3.6, M.frame, 0, 1.1, -1.7, .02);
  for (const s of [-1, 1]) rbox(g, .05, .35, 3.6, M.steel, s * 1.12, 1.33, -1.7, .01);
  cylZ(g, .5, 1.4, M.drum, 0, 1.75, -1.1, 16);
  rbox(g, .4, 1.2, .4, M.stripe, .6, 1.8, -2.9, .03);
  rbox(g, 1.6, .1, .25, M.light, 0, 3.05, 1.7, .03);
  for (const s of [-1, 1]) { rbox(g, .2, .12, .05, M.light, s * .8, 1.3, 3.16, .02); rbox(g, .14, .1, .05, M.tail, s * .95, .9, -3.42, .02); }
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-.9, .7, -3.3); g.add(m.exhaust);
  m.beacons = [beacon(g, -.7, 3.0, 1.5, M), beacon(g, .7, 3.0, 1.5, M)];
  m.rams = [];
  Object.assign(m, { group: g });
}

// ---------------------------------------------------------------- people on foot: a jointed figure that can walk, carry,
// hammer, saw, climb and kneel. Every joint is an Object3D the animation turns; limbs hang down (-y) from their joint.
// The root stands on the ground facing +z.
const PERSON_SHIRTS = [0x2b3a55, 0x5a3b2a, 0x3d4a35, 0x6b6f75, 0x7a2f2a, 0x2f2f33];
const PERSON_SKIN = [0xc08a68, 0x8d5a3b, 0xe0b090, 0x6b4430, 0xd49c78];
function seg(p, len, r0, r1, mat) {   // a tapered limb hanging down from p's origin
  const m = new THREE.Mesh(new THREE.CapsuleGeometry((r0 + r1) / 2, Math.max(.01, len - r0 - r1), 3, 8), mat);
  m.position.y = -len / 2; m.castShadow = true; p.add(m); return m;
}
const joint = (p, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); p.add(o); return o; };
export function buildPerson(i = 0, role = 'framer') {
  const W = WORKER_MATS, root = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: PERSON_SHIRTS[i % PERSON_SHIRTS.length], roughness: .92 });
  const skin = new THREE.MeshStandardMaterial({ color: PERSON_SKIN[(i * 3 + 1) % PERSON_SKIN.length], roughness: .7 });
  const pants = role === 'mechanic' ? new THREE.MeshStandardMaterial({ color: 0x23324a, roughness: .9 }) : W.pants;
  const hips = joint(root, 0, .95, 0);
  rbox(hips, .34, .16, .2, pants, 0, -.02, 0, .06);
  const torso = joint(hips, 0, .04, 0);
  rbox(torso, .36, .46, .21, role === 'mechanic' ? pants : shirt, 0, .25, 0, .08);
  rbox(torso, .39, .36, .235, W.vest, 0, .3, 0, .07);                          // hi-vis vest
  for (const y of [.22, .36]) rbox(torso, .4, .03, .24, W.band, 0, y, 0, .01);
  rbox(torso, .06, .14, .05, W.band, .1, .38, .12, .01);                        // pencil and tape in the vest pocket
  const neck = joint(torso, 0, .5, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.105, 14, 10), skin); head.scale.set(.95, 1.12, 1.05); head.position.y = .12; neck.add(head); head.castShadow = true;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.022, 6, 5), skin); nose.position.set(0, .1, .1); neck.add(nose);
  const hm = new THREE.MeshStandardMaterial({ color: role === 'boss' ? 0xf2f2ec : role === 'faller' ? 0xe8792a : role === 'mechanic' ? 0x2d6ab0 : HAT_COLS[(i + 1) % 3], roughness: .35 });
  const hat = new THREE.Mesh(new THREE.SphereGeometry(.128, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm); hat.position.y = .17; hat.castShadow = true; neck.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .018, 16), hm); brim.position.set(0, .175, .03); brim.scale.set(1, 1, 1.15); neck.add(brim);
  if (role === 'faller') {   // ear defenders and a face screen
    for (const s of [-1, 1]) rbox(neck, .04, .08, .07, new THREE.MeshStandardMaterial({ color: 0xe8792a }), s * .12, .12, 0, .02);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(.22, .1), new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false })); scr.position.set(0, .1, .13); neck.add(scr);
  }
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = joint(torso, s * .215, .44, 0);
    seg(sh, .29, .055, .048, shirt);
    const el = joint(sh, 0, -.29, 0);
    seg(el, .26, .045, .038, s > 0 && role !== 'mechanic' ? skin : shirt);
    const hand = joint(el, 0, -.27, 0);
    const hm2 = new THREE.Mesh(new THREE.BoxGeometry(.07, .09, .04), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: .9 })); hand.add(hm2);   // gloves
    arms.push({ sh, el, hand });
    const hp = joint(hips, s * .1, -.05, 0);
    seg(hp, .44, .072, .06, pants);
    const kn = joint(hp, 0, -.44, 0);
    seg(kn, .42, .058, .048, pants);
    const ft = joint(kn, 0, -.42, 0);
    rbox(ft, .1, .09, .24, W.boot, 0, -.02, .05, .03);
    legs.push({ hp, kn, ft });
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, torso, neck, arms, legs, held: null, carry: null };
}
// what people hold
const TOOL_MATS = {
  wood: new THREE.MeshStandardMaterial({ color: 0xb48a58, roughness: .85 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: .3, metalness: .85 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe8662a, roughness: .5 }),
  black: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: .7 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb02a22, roughness: .5 }),
};
export function toolMesh(kind) {
  const g = new THREE.Group(), T = TOOL_MATS;
  if (kind === 'hammer') { rbox(g, .03, .32, .03, T.wood, 0, -.1, 0, .01); rbox(g, .05, .05, .14, T.steel, 0, .06, .02, .01); }
  else if (kind === 'saw') {   // chainsaw: body, handle bar, guide bar and chain
    rbox(g, .14, .2, .34, T.orange, 0, -.02, .04, .04); rbox(g, .03, .03, .2, T.black, 0, .12, .02, .01);
    rbox(g, .02, .07, .55, T.steel, 0, -.06, .45, .01); rbox(g, .025, .085, .55, T.black, 0, -.06, .45, .005);
  } else if (kind === 'rake') { rbox(g, .03, .03, 1.5, T.wood, 0, 0, .55, .01); rbox(g, .4, .04, .04, T.steel, 0, -.03, 1.3, .01); for (let i = -4; i <= 4; i++) rbox(g, .012, .08, .012, T.steel, i * .045, -.07, 1.3, .003); }
  else if (kind === 'wrench') { rbox(g, .03, .28, .015, T.steel, 0, -.08, 0, .005); rbox(g, .07, .05, .02, T.steel, 0, .06, 0, .005); }
  else if (kind === 'toolbox') { rbox(g, .42, .2, .18, T.red, 0, -.18, 0, .02); rbox(g, .2, .03, .03, T.black, 0, -.04, 0, .01); }
  else if (kind === 'shovel') { rbox(g, .03, .03, 1.2, T.wood, 0, 0, .4, .01); rbox(g, .22, .02, .28, T.steel, 0, -.02, 1.1, .01); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// self-loading log truck: cab, bunks with stakes, and a knuckle-boom crane with a grapple behind the cab
export function buildLogTruck(m, M) {
  const g = new THREE.Group();
  rbox(g, 1.1, .35, 8.2, M.frame, 0, .85, -1.2);
  m.wheels = [];
  for (const s of [-1, 1]) { m.wheels.push(wheel(g, .52, .4, M, s * 1.0, .52, 2.3)); for (const z of [-2.6, -3.9]) m.wheels.push(wheel(g, .52, .52, M, s * .95, .52, z)); }
  rbox(g, 2.3, 1.2, 1.7, M.paint, 0, 1.65, 2.9, .16);
  m.cabG = buildCab(g, 2.1, 1.05, 1.6, 0, 2.05, 1.85, M);
  m.cab = new THREE.Object3D(); m.cab.position.set(.45, 2.7, 1.9); g.add(m.cab);
  rbox(g, 2.4, .9, .2, M.frame, 0, 2.3, .85, .03);                              // headache rack
  for (const z of [-.9, -2.6, -4.3]) {                                          // bunks and stakes
    rbox(g, 2.5, .16, .25, M.steel, 0, 1.15, z, .02);
    for (const s of [-1, 1]) rbox(g, .1, 1.4, .1, M.steel, s * 1.2, 1.85, z, .02);
  }
  const logMat = new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: .95 }), endMat = new THREE.MeshStandardMaterial({ color: 0xd8b77f, roughness: .9 });
  m.logMeshes = [];
  for (let i = 0; i < 9; i++) {
    const r = .2 + (i * 7 % 5) * .02, row = Math.floor(i / 4), col = i % 4;
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 6.4, 10).rotateX(Math.PI / 2), [logMat, endMat, endMat]);
    lg.position.set((col - 1.5) * .52 + (row % 2) * .26, 1.45 + row * .4, -2.6 + (i % 3 - 1) * .12); lg.visible = false; lg.castShadow = true; g.add(lg); m.logMeshes.push(lg);
  }
  // knuckle boom: post turns (slew), main boom and jib fold, the grapple hangs from the jib tip
  const post = new THREE.Group(); post.position.set(0, 1.2, .35); g.add(post);
  cylY(post, .18, .22, 1.6, M.paint, 0, .8, 0, 12);
  const b1 = new THREE.Group(); b1.position.set(0, 1.6, 0); post.add(b1);
  rbox(b1, .26, .3, 4.2, M.paint, 0, 0, 2.1, .05);
  const b2 = new THREE.Group(); b2.position.set(0, 0, 4.2); b1.add(b2);
  rbox(b2, .2, .24, 3.8, M.paint, 0, 0, 1.9, .04);
  const grap = new THREE.Group(); b2.add(grap); grap.position.set(0, 0, 3.8);
  cylY(grap, .05, .05, .5, M.steel, 0, -.25, 0, 6);
  rbox(grap, .4, .2, .3, M.paint, 0, -.55, 0, .04);
  m.tongs = [];
  for (const s of [-1, 1]) { const t = new THREE.Group(); t.position.set(s * .15, -.62, 0); grap.add(t); rbox(t, .06, .6, .22, M.steel, s * .14, -.3, 0, .02); m.tongs.push(t); }
  const held = new THREE.Mesh(new THREE.CylinderGeometry(.22, .24, 6.4, 10).rotateZ(Math.PI / 2), [logMat, endMat, endMat]); held.position.y = -1.0; held.visible = false; grap.add(held);
  m.kb = { post, b1, b2, grap, held };
  m.exhaust = new THREE.Object3D(); m.exhaust.position.set(-1.0, 2.9, 1.95); g.add(m.exhaust);
  cylY(g, .07, .07, 1.5, M.chrome, -1.0, 2.3, 1.95, 8);
  for (const s of [-1, 1]) { rbox(g, .2, .12, .05, M.light, s * .8, 1.35, 3.78, .02); rbox(g, .14, .1, .05, M.tail, s * .95, .9, -5.32, .02); }
  m.beacons = [beacon(g, -.7, 3.15, 1.75, M), beacon(g, .7, 3.15, 1.75, M)];
  m.rams = [];
  Object.assign(m, { group: g });
}
