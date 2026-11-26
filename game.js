// Flowtown: keep a growing city's traffic moving.
import * as THREE from 'three';
import { Net, RING_R, ONEWAY_W, WALK_W, LANE_W, along, closestOnPoly, laneOff } from './net.js';
import { createCity, DAY, CHUNK, BLOCK } from './city.js';
import { createLife, BIZ, BUILD_ORDER, MAX_LVL, COST, lvlMul, upCost } from './life.js';
import { createLaw, aCar } from './police.js';
import { makeMaterials, CLOUD, cloudUniforms, buildRoads, buildCity, vehicleGeos, vehicleMaterial, makeFleet, staticCarGeo, carColor, personGeo, personMaterial, lampGeo, signalGeo, buildSignals, hwOf, beamMaterial } from './draw.js';
import { makeSky } from './sky.js';
import { buildScenery } from './scenery.js';

const $ = id => document.getElementById(id);
let titleUp = true;   // the title screen is up (the camera circles the town)
const SAVE = 'flowtown.save.v2', QKEY = 'flowtown.quality';
const touch = matchMedia('(pointer: coarse)').matches; if (touch) document.body.classList.add('touch');
const QS = {
  high: { pr: 2, shadow: 4096, shadows: 2, treeDetail: 2, peds: 1400, maxCars: 1600 },
  medium: { pr: 2, shadow: 2048, shadows: 1, treeDetail: 1, peds: 700, maxCars: 1100 },
  low: { pr: 1, shadow: 0, shadows: 0, treeDetail: 1, peds: 300, maxCars: 700 },
};
let qName = localStorage.getItem(QKEY) || (touch ? 'medium' : 'high');
let Q = QS[qName] || QS.high;

// ---------------- renderer + scene ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q.shadows > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG_DAY = new THREE.Color(0xb9c3c9);
scene.fog = new THREE.Fog(FOG_DAY.clone(), 900, 4200);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 2, 9000);
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x5b5a4a, .55); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); scene.add(sun); scene.add(sun.target);
sun.castShadow = Q.shadows > 0;
if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); }
sun.shadow.bias = -.0004; sun.shadow.normalBias = .6;
const U = { uNight: { value: 0 }, uTime: { value: 0 }, uCloudSh: { value: 0 }, uCover: { value: .5 } };
const M = makeMaterials(renderer.capabilities.getMaxAnisotropy(), U);
// the sky: a dome that follows the time of day; it also lights reflections
const sky = makeSky(renderer); scene.add(sky.mesh);

// ground: grass in town, rolling cedar hills on the horizon (well beyond the furthest district)
const texLoad = (f, rep = true) => { const t = new THREE.TextureLoader().load(f, t => { t.colorSpace = THREE.SRGBColorSpace; }); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
const grassTex = texLoad('assets/grass.jpg'), dryTex = texLoad('assets/tex/lawn.jpg');
const HILL0 = 1650, HILL1 = 2700;
function vnoise(x, z) {
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(z), f = x - i, g = z - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
function hillH(x, z) {
  const m = Math.max(Math.abs(x), Math.abs(z)), t = Math.max(0, Math.min(1, (m - HILL0) / (HILL1 - HILL0)));
  if (t <= 0) return 0;
  const k = t * t * (3 - 2 * t);
  const n = vnoise(x / 900, z / 900) * .6 + vnoise(x / 380 + 7, z / 380 + 3) * .3 + vnoise(x / 150 + 2, z / 150 + 9) * .1;
  return k * (25 + n * n * 190);
}
const groundGeo = new THREE.PlaneGeometry(12000, 12000, 160, 160).rotateX(-Math.PI / 2);
{ const p = groundGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hillH(p.getX(i), p.getZ(i))); groundGeo.computeVertexNormals(); }
const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: 0xb4bd8a, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });   // (pushed back: roads and lots always draw over it)   // drier Hill Country grass
groundMat.onBeforeCompile = sh => {
  sh.uniforms.tDry = { value: dryTex }; cloudUniforms(sh);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw; varying float vGny;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vGw = (modelMatrix * vec4(position, 1.)).xyz; vGny = normal.y;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D tDry; varying vec3 vGw; varying float vGny;
float gh(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
#define pn1 gn
${CLOUD}`)
    .replace('#include <map_fragment>', `vec2 gw = vGw.xz;
      vec4 g1 = texture2D(map, gw / 13.); vec4 g2 = texture2D(map, gw / 47. + .3); vec4 g0 = texture2D(map, gw / 3.7 + .7); vec4 dr = texture2D(tDry, gw / 21.);
      float m = gn(gw / 90.) * .7 + gn(gw / 23.) * .3;
      vec3 gc = mix(mix(g1, g2, .45).rgb, g0.rgb, .35) * mix(vec3(.86, .97, .74), vec3(1.04, 1.0, .8), m);
      // clumps and bare spots at a few metres, so the field isn't one flat colour up close
      float cl = gn(gw / 2.3) * .6 + gn(gw / .9) * .4; gc *= .82 + .3 * cl;
      gc = mix(gc, vec3(.36, .31, .22), smoothstep(.8, .95, gn(gw / 7. + 5.)) * .35);
      // straw-coloured dry patches
      float dry = smoothstep(.55, .8, gn(gw / 140. + 3.) * .75 + gn(gw / 31.) * .25);
      gc = mix(gc, dr.rgb * vec3(1.05, 1., .9), dry * .55);
      // the hills round the town: drier, with dark cedar brakes and pale limestone
      float hm = max(abs(gw.x), abs(gw.y)), hk = smoothstep(${HILL0 - 150}., ${HILL0 + 350}., hm);
      if (hk > 0.) {
        float ced = smoothstep(.5, .62, gn(gw / 38.) * .6 + gn(gw / 9.) * .4);
        float rock = smoothstep(.72, .8, gn(gw / 17. + 11.)) * (.4 + .6 * smoothstep(.97, .85, vGny));
        vec3 hc = mix(dr.rgb * vec3(1.1, 1.02, .82), vec3(.16, .2, .12), ced * .85);
        hc = mix(hc, vec3(.62, .6, .55), rock * .6);
        gc = mix(gc, hc, hk);
      }
      diffuseColor.rgb *= gc * (1. - csh(gw) * .45);`);
};
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true; scene.add(ground);

// ---------------- world ----------------
let net, city, S;          // S = game state
let roadsG = null, cityG = null, sigG = null, lampsG = null, overlay = null;
const VG = vehicleGeos(), carMat = vehicleMaterial(U, qName !== 'low'); M.car = carMat;
const parkedGeo = staticCarGeo();
let fleet = makeFleet(VG, carMat, Q.maxCars + 50); for (const m of Object.values(fleet)) scene.add(m);
const pedMat = personMaterial(U), beamMat = beamMaterial();
let pedMesh = new THREE.InstancedMesh(personGeo(), pedMat, Math.max(1, Q.peds)); pedMesh.count = 0; pedMesh.frustumCulled = false; pedMesh.castShadow = Q.shadows > 1; scene.add(pedMesh);
const pedLook = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, Q.peds) * 3), 3), pedWalk = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, Q.peds)), 1);
pedLook.setUsage(THREE.DynamicDrawUsage); pedWalk.setUsage(THREE.DynamicDrawUsage); pedMesh.geometry.setAttribute('aLook', pedLook); pedMesh.geometry.setAttribute('aWalk', pedWalk);
pedMesh.setColorAt(0, new THREE.Color(1, 1, 1));

function fresh(seed = (Math.random() * 1e6) | 0) {
  net = new Net(); city = createCity(net, seed); city.coreR = 0;
  life = createLife(net, city, seed); net.onDone = c => life.carDone(c);
  S = { time: DAY * 7 / 24, meter: 0, speed: 1, over: false, flow: 1, cam: null, seed, view: false };
  law = createLaw(net, city, life); life.onCarOut = c => law.carOut(c);
  life.T = S.time; life.startTown(); city.sync(); life.sync(); lifeVer = city.ver;
  if (typeof document !== 'undefined' && $('viewBtn')) $('viewBtn').classList.remove('on');
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE)); if (!d || d.v !== 2) return false;
    net = new Net(); net.load(d.net); city = createCity(net, d.city.seed); city.load(d.city); city.sync();
    S = Object.assign({ speed: 1, over: false, flow: 1 }, d.s); S.over = false;
    if (city.ensureLots()) city.sync();   // towns from before parking lots get them now
    life = createLife(net, city, d.city.seed); net.onDone = c => life.carDone(c); life.T = S.time; life.load(d.life); lifeVer = city.ver;
    law = createLaw(net, city, life); life.onCarOut = c => law.carOut(c);
    coreGrow(); return true;
  } catch (e) { console.warn('save unreadable', e); return false; }
}
function save() {
  if (!net || S.over) return; if (!titleUp) S.cam = [cam.x, cam.z, cam.dist, cam.yaw, cam.pitch];
  try { localStorage.setItem(SAVE, JSON.stringify({ v: 2, net: net.serialize(), city: city.serialize(), life: life.serialize(), s: { time: S.time, meter: S.meter, seed: S.seed, speed: S.speed, cam: S.cam } })); } catch (e) { /* storage full: keep playing */ }
}
let life, law, lifeVer = -1;
// the town centre: none while it's a village; it grows (and gets taller) as people move in
function coreGrow() { const p = life.people.size; city.coreR = p < 160 ? 0 : Math.min(175, 50 + (p - 160) * .5); }

// ---------------- camera ----------------
const cam = { x: 0, z: 40, dist: 420, yaw: .35, pitch: .82 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth01 = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// how far the view may tilt at this zoom: close in it leans over to show the street fronts (never flat on the map),
// far out it looks down more so the whole town reads
function pitchRange(d) { return [.34 + .4 * smooth01(160, 1300, d), Math.min(1.45, .95 + .5 * smooth01(90, 800, d))]; }
let camBox = null;   // where the camera may go (the town plus a margin)
function placeCamera() {
  cam.dist = clamp(cam.dist, 26, 1500);
  const [p0, p1] = pitchRange(cam.dist); cam.pitch = clamp(cam.pitch, p0, p1);
  if (camBox) { cam.x = clamp(cam.x, camBox.x0, camBox.x1); cam.z = clamp(cam.z, camBox.z0, camBox.z1); }
  for (let k = 0; k < 20; k++) {   // never inside a hill
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.x + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * cp * cam.dist);
    if (camera.position.y > hillH(camera.position.x, camera.position.z) + 25 || cam.pitch >= 1.5) break;
    cam.pitch += .03;
  }
  camera.lookAt(cam.x, 0, cam.z);
  scene.fog.near = 500 + cam.dist * .8; scene.fog.far = 2600 + cam.dist * 2.4;
  // depth precision: the near limit follows the camera's height, so far out the roads never flicker with the grass under them
  const near = clamp((camera.position.y - Math.max(0, hillH(camera.position.x, camera.position.z))) * .35, 1, 90);
  if (Math.abs(camera.near - near) > .05) { camera.near = near; camera.updateProjectionMatrix(); }
}
// smooth camera moves (flying to a spot, wheel zoom); finger drags move it directly
let fly = null, zoomTo = null, coast = null;
function flyTo(goal, secs = 1.2) { fly = { from: { ...cam }, to: { ...cam, ...goal }, t: 0, secs }; coast = null; }
function camTick(dt) {
  if (fly) {
    fly.t += dt / fly.secs; const t = Math.min(1, fly.t), k = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    let dy = fly.to.yaw - fly.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    cam.x = fly.from.x + (fly.to.x - fly.from.x) * k; cam.z = fly.from.z + (fly.to.z - fly.from.z) * k; cam.yaw = fly.from.yaw + dy * k;
    cam.dist = Math.exp(Math.log(fly.from.dist) + (Math.log(fly.to.dist) - Math.log(fly.from.dist)) * k); cam.pitch = fly.from.pitch + (fly.to.pitch - fly.from.pitch) * k;
    placeCamera(); if (t >= 1) fly = null; return;
  }
  if (zoomTo) {   // ease towards the wanted zoom, keeping the ground under the pointer where it is
    const f = 1 - Math.exp(-dt * 14), g0 = groundAt(zoomTo.cx, zoomTo.cy);
    cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(zoomTo.dist) - Math.log(cam.dist)) * f); placeCamera();
    const g1 = groundAt(zoomTo.cx, zoomTo.cy); if (g0 && g1) { cam.x += g0[0] - g1[0]; cam.z += g0[1] - g1[1]; placeCamera(); }
    if (Math.abs(Math.log(cam.dist / zoomTo.dist)) < .004 || cam.dist <= 26.01 || cam.dist >= 1499.9) zoomTo = null;
  }
  if (coast) {   // a flicked map keeps gliding a moment
    cam.x += coast.vx * dt; cam.z += coast.vz * dt; const k = Math.exp(-dt * 4.2); coast.vx *= k; coast.vz *= k; placeCamera();
    if (Math.hypot(coast.vx, coast.vz) < cam.dist * .02) coast = null;
  }
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
function groundAt(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, hitV) ? [hitV.x, hitV.z] : null;
}

// ---------------- rebuild what's drawn ----------------
let seenNet = -1, seenCity = -1;
const dummy = new THREE.Object3D(), col = new THREE.Color();
function disposeGroup(g) { if (!g) return; scene.remove(g); g.traverse(o => { if (o.geometry && o.geometry !== parkedGeo && !Object.values(VG).includes(o.geometry)) o.geometry.dispose(); }); }
let sigLamps = [], lampMesh = null, glowMesh = null, poolMesh = null;
function rebuildRoads() {
  if (net.built !== net.ver) net.rebuild();
  disposeGroup(roadsG); roadsG = buildRoads(net, M, { lights: true }); scene.add(roadsG);
  // street lights
  disposeGroup(lampsG); lampsG = new THREE.Group(); const L = roadsG.userData.lamps;
  if (L.length) {
    const pm = new THREE.InstancedMesh(lampGeo(), M.pole, L.length); pm.castShadow = Q.shadows > 1;
    glowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.3, .06, .62), lampGlowMat, L.length);
    poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, L.length);
    L.forEach((l, i) => {
      dummy.position.set(l[0], 0, l[1]); dummy.rotation.set(0, l[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix);
      const hx = l[0] + Math.sin(l[2]) * 1.7, hz = l[1] + Math.cos(l[2]) * 1.7;
      dummy.position.set(hx, 7.22, hz); dummy.updateMatrix(); glowMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(hx, .2, hz); dummy.scale.set(17, 1, 17); dummy.updateMatrix(); poolMesh.setMatrixAt(i, dummy.matrix);
    });
    lampsG.add(pm, glowMesh, poolMesh);
  }
  scene.add(lampsG);
  // traffic lights and stop signs
  disposeGroup(sigG); const SG = buildSignals(net, M); sigG = SG.group; sigLamps = SG.lamps;
  if (sigLamps.length) {
    lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), sigLamps.length);
    sigLamps.forEach((q, i) => { dummy.position.set(q.x, q.y, q.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); lampMesh.setMatrixAt(i, dummy.matrix); lampMesh.setColorAt(i, col.setRGB(.1, .1, .1)); });
    sigG.add(lampMesh);
  } else lampMesh = null;
  scene.add(sigG);
  buildOverlay();
  seenNet = net.ver;
}
const poolMat = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,200,130,1)'); gr.addColorStop(1, 'rgba(255,200,130,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
})();
let sceneryG = null;
function rebuildCity() {
  if (life) life.sync();
  if (sceneryG && sceneryG.userData.signMat) { sceneryG.userData.signMat.map.dispose(); sceneryG.userData.signMat.dispose(); }
  disposeGroup(sceneryG); sceneryG = buildScenery(net, city, life, Q); scene.add(sceneryG);
  disposeGroup(cityG); cityG = buildCity(city, M, U, Q, { car: parkedGeo }, { wild: city.wild(), more: sceneryG.userData.trees, net });
  const LL = cityG.userData.lotLights;   // parking lot lights: a glowing head and a pool of light at night
  if (LL && LL.length) {
    const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, .06, .4), lampGlowMat, LL.length), pm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, LL.length);
    LL.forEach((q, i) => { dummy.rotation.set(0, 0, 0); dummy.position.set(q[0], 8.88, q[1]); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); gm.setMatrixAt(i, dummy.matrix); dummy.position.set(q[0], .2, q[1]); dummy.scale.set(24, 1, 24); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); });
    cityG.add(gm, pm);
  }
  if (contactB) { scene.remove(contactB); contactB.dispose(); }
  contactB = new THREE.InstancedMesh(contactGeo, contactMat, Math.max(1, city.buildings.length)); contactB.renderOrder = 1;
  city.buildings.forEach((b, i) => { dummy.position.set(b.x, b.kind === 'house' ? .09 : .07, b.z); dummy.rotation.set(0, -(b.rot || 0), 0); dummy.scale.set(b.w + 5, 1, b.d + 5); dummy.updateMatrix(); contactB.setMatrixAt(i, dummy.matrix); });
  dummy.scale.set(1, 1, 1); scene.add(contactB);
  scene.add(cityG); seenCity = city.ver;
  const b = city.bounds(); camBox = { x0: b.x0 - 250, x1: b.x1 + 250, z0: b.z0 - 250, z1: b.z1 + 250 };
}
const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
// contact shadows: a soft dark patch under every building and car, so nothing looks pasted on the ground
const softTex = (() => {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g2 = c.getContext('2d'), img = g2.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = Math.abs(x / (S - 1) * 2 - 1), v = Math.abs(y / (S - 1) * 2 - 1), d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), .25), a = Math.max(0, Math.min(1, (1 - d) / .45)); img.data[(y * S + x) * 4 + 3] = Math.round(255 * a * a); }
  g2.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
})();
const contactMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: softTex, transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let contactB = null;
const carBlobs = new THREE.InstancedMesh(contactGeo, contactMat, Q.maxCars + 300); carBlobs.count = 0; carBlobs.frustumCulled = false; carBlobs.renderOrder = 1; scene.add(carBlobs);

// traffic view: a coloured ribbon per lane
function buildOverlay() {
  if (overlay) { scene.remove(overlay); overlay.geometry.dispose(); }
  const pos = [], colA = [], idx = [], spans = [];
  // one band per direction of each road, down the middle of that direction's lanes (not one per lane: wide roads stay readable)
  const groups = new Map();
  for (const l of net.links) { const k = l.edge.id + ':' + l.dir; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  for (const ls of groups.values()) {
    const kerb = ls.find(l => !l.li && !l.pk) || ls[0], main = ls.filter(l => !l.pk);
    const shift = kerb.off - main.reduce((a, l) => a + l.off, 0) / main.length;   // from the kerb lane to the middle of the lanes (leftward)
    const start = pos.length / 3, pts = kerb.pts, w = main.length > 1 ? 1.5 : 1.15;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const cx = pts[i][0] + dz * shift, cz = pts[i][1] - dx * shift;
      pos.push(cx + dz * w, .25, cz - dx * w, cx - dz * w, .25, cz + dx * w); colA.push(0, 1, 0, 0, 1, 0);
      if (i) { const k = start + i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    spans.push([ls, start, pts.length * 2]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3)); g.setIndex(idx);
  overlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  overlay.userData.spans = spans; overlay.visible = !!(S && S.view); overlay.renderOrder = 2; scene.add(overlay);
}
function laneLoad(l) {   // 0 free .. 1 jammed
  let occ = 0, slow = 0; for (const c of l.cars) { occ += c.len + 2; if (c.stuck > 8) slow++; }
  const dens = Math.min(1, occ / Math.max(8, l.len)), sp = 1 - Math.min(1, l.spd / l.vmax);
  return Math.min(1, Math.max(dens * .9 * (sp + .2), slow ? .5 + slow * .1 : 0, sp * .6 * Math.min(1, l.cars.length / 2)));
}
function paintOverlay() {
  if (!overlay || !overlay.visible) return;
  const c = overlay.geometry.attributes.color;
  for (const [ls, start, n] of overlay.userData.spans) {
    let j = 0; for (const l of ls) j = Math.max(j, laneLoad(l)); const r = j < .5 ? .2 + j * 1.6 : 1, g = j < .5 ? .85 : .85 - (j - .5) * 1.6, b = .25 - j * .2;
    for (let k = 0; k < n; k++) c.setXYZ(start + k, r, Math.max(.08, g), Math.max(.05, b));
  }
  c.needsUpdate = true;
}

// ---------------- magic: sparkles + glowing cursor ----------------
const SPARKS = 900, sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS), sparkCol = new Float32Array(SPARKS * 3);
let sparkI = 0;
const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3)); sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 2.2, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
sparks.frustumCulled = false; scene.add(sparks);
function burst(x, z, n = 60, rgb = [.4, .9, 1], spread = 6) {
  for (let i = 0; i < n; i++) {
    const k = sparkI++ % SPARKS; const a = Math.random() * 6.28, r = Math.random() * spread;
    sparkPos.set([x + Math.cos(a) * r, .5 + Math.random() * 2, z + Math.sin(a) * r], k * 3);
    sparkVel.set([Math.cos(a) * (1 + Math.random() * 3), 4 + Math.random() * 9, Math.sin(a) * (1 + Math.random() * 3)], k * 3);
    sparkLife[k] = 1 + Math.random() * .6; sparkCol.set(rgb.map(v => v * (.7 + Math.random() * .5)), k * 3);
  }
}
function burstAlong(pts, rgb) { for (let i = 0; i < pts.length; i += 2) burst(pts[i][0], pts[i][1], 6, rgb, 3); }
function updateSparks(dt) {
  for (let k = 0; k < SPARKS; k++) {
    if (sparkLife[k] <= 0) { sparkPos[k * 3 + 1] = -100; continue; }
    sparkLife[k] -= dt; sparkVel[k * 3 + 1] -= 6 * dt;
    for (let j = 0; j < 3; j++) sparkPos[k * 3 + j] += sparkVel[k * 3 + j] * dt;
    const f = Math.max(0, sparkLife[k]); sparkCol[k * 3] *= .985; sparkCol[k * 3 + 1] *= .985; sparkCol[k * 3 + 2] *= .985; void f;
  }
  sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
  sparks.material.size = Math.max(1.2, cam.dist / 160);
}
const glowMat = (rgb, op = .55) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
const cursor = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 40).rotateX(-Math.PI / 2), glowMat([.4, .9, 1], .9)); cursor.renderOrder = 5; scene.add(cursor);
const pin = new THREE.Mesh(new THREE.RingGeometry(1.6, 3.4, 40).rotateX(-Math.PI / 2), glowMat([1, .8, .2], .95)); pin.renderOrder = 5; pin.visible = false; scene.add(pin);
const hoverMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMat([.4, .9, 1], .45)); hoverMesh.renderOrder = 4; scene.add(hoverMesh);
const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMat([.4, .9, 1], .42)); previewMesh.renderOrder = 4; scene.add(previewMesh);
function ribbon(mesh, pts, w, y = .3) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    pos.push(pts[i][0] + dz * w, y, pts[i][1] - dx * w, pts[i][0] - dz * w, y, pts[i][1] + dx * w);
    if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  mesh.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); mesh.geometry = g; mesh.visible = true;
}
function ringShape(mesh, x, z, r0, r1) { mesh.geometry.dispose(); mesh.geometry = new THREE.RingGeometry(r0, r1, 56).rotateX(-Math.PI / 2).translate(x, .3, z); mesh.visible = true; }
const jamMarks = []; const jamGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(jamGeo, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); m.renderOrder = 3; m.visible = false; scene.add(m); jamMarks.push(m); }

// ---------------- tools ----------------
const TOOLS = ['road', 'curve', 'signal', 'ring', 'oneway', 'lanes', 'erase'];   // keys 1-7; Build is B
const laneName = (nl, tl) => `${nl} lane${nl > 1 ? 's' : ''}${tl ? ' + turn lanes' : ''}`;
const HINT = touch
  ? { build: 'Tap a street to build there, or land outside town to buy it', road: 'Hold, then drag to draw a road. Tap to keep going from the pin', curve: 'Hold, then drag to draw. Then drag to bend it', signal: 'Tap a junction for lights', ring: 'Tap a junction or road for a roundabout', oneway: 'Tap a road to switch its direction', lanes: 'Tap a road for more lanes', erase: 'Tap a road or roundabout to remove it' }
  : { build: 'Click a street to build there, or land outside town to buy it', road: 'Click to start, click to place. It keeps going from the end', curve: 'Click the start, click the end, then move to bend and click', signal: 'Click a junction for lights', ring: 'Click a junction or road for a roundabout', oneway: 'Click a road to switch its direction', lanes: 'Click a road for more lanes', erase: 'Click a road or roundabout to remove it' };
const T = { tool: '', pts: [], pend: null, bend: null, draw: null, hover: null, mouse: null, plan: null };
function setTool(t) {
  T.tool = T.tool === t ? '' : t; T.pts = []; T.pend = null; T.bend = null; T.draw = null; previewMesh.visible = false; hoverMesh.visible = false; pin.visible = false;
  if (!T.tool) { cursor.visible = false; T.hover = null; }   // (the cursor ring used to stay on the map after dropping a tool)
  for (const b of document.querySelectorAll('#tools button[data-tool]')) b.classList.toggle('on', b.dataset.tool === T.tool);
  hint();
}
function hint(msg) { $('hint').textContent = msg || HINT[T.tool] || ''; $('hint').classList.toggle('bad', !!msg); }
// how far a tap may land from a road and still count: about 30 px on a phone, 16 with a mouse
function snapR() { const wpp = 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / innerHeight; return Math.max(7, Math.min(45, (touch ? 30 : 16) * wpp)); }
function ringAt(x, z) { const seen = new Set(); for (const n of net.nodes.values()) { if (!n.ring || seen.has(n.ring)) continue; seen.add(n.ring); const c = net.ringCenter(n.ring), R = net.ringR(n.ring); if (c && Math.hypot(c[0] - x, c[1] - z) < R + 2) return { rid: n.ring, c, R }; } return null; }
const qpts = (a, c, b, K = 24) => { const o = []; for (let i = 0; i <= K; i++) { const t = i / K, u = 1 - t; o.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } return o; };
const through = (a, b, m) => m ? [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2] : null;   // bend control so the road passes through m
// show where a road from a to b would go, and whether it can be built
let planT = 0;
function previewRoad(a, b, bend, force) {
  const now = performance.now(); if (!force && now - planT < 45) return; planT = now;
  const plan = net.planRoad(a, b, through(a, b, bend), snapR()); T.plan = plan;
  const A = plan.a || a, B = plan.b || b, c = plan.cc || [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  ribbon(previewMesh, qpts(A, c, B, 20), 3.6);
  const cost = roadCost(A, B, plan.cc), poor = !plan.reason && !life.can(cost);
  previewMesh.material.color.setRGB(...(plan.reason || poor ? [1, .35, .25] : [.4, .9, 1]));
  cursor.position.set(B[0], .35, B[1]); cursor.visible = true;
  hint(plan.reason || (poor ? 'Need ' + money(cost) + ' coins' : null)); if (!plan.reason && !poor) { $('hint').textContent = 'Road ' + money(cost) + ' coins'; }
}
function hoverUpdate() {
  const m = T.mouse; hoverMesh.visible = false; cursor.visible = !!m && !!T.tool;
  if (!T.draw) previewMesh.visible = false;
  pin.visible = !!T.pts.length && (T.tool === 'road' || T.tool === 'curve'); if (pin.visible) { pin.position.set(T.pts[0][0], .4, T.pts[0][1]); const sc = Math.max(1, cam.dist / 260); pin.scale.set(sc, 1, sc); }
  if (!m) return;
  const sc = Math.max(1, cam.dist / 260); cursor.position.set(m[0], .35, m[1]); cursor.scale.set(sc, 1, sc);
  hoverMesh.material.color.setRGB(.4, .9, 1);
  const R = snapR();
  T.hover = null;
  if (T.tool === 'road' || T.tool === 'curve') {
    if (T.draw) return;
    if (T.pend) { T.bend = m; previewRoad(T.pend[0], T.pend[1], m); return; }
    if (T.pts.length) { previewRoad(T.pts[0], m, null); return; }
    const q = net.probe(m[0], m[1], R); const p = q.n ? [q.n.x, q.n.z] : q.p; cursor.position.set(p[0], .35, p[1]); hint();
    return;
  }
  if (T.tool === 'build') {
    const site = buildSite(m[0], m[1], R);
    if (site && site.e) { T.hover = site; ribbon(hoverMesh, site.e.pts, hwOf(site.e) + 3.5); hoverMesh.material.color.setRGB(.95, .8, .2); }
    else if (site && site.land) { T.hover = site; const S0 = BLOCK * CHUNK, g0 = -S0 / 2, x0 = g0 + site.land[0] * S0, z0 = g0 + site.land[1] * S0; ribbon(hoverMesh, [[x0, z0], [x0 + S0, z0], [x0 + S0, z0 + S0], [x0, z0 + S0], [x0, z0]], 4); hoverMesh.material.color.setRGB(.4, 1, .5); }
    return;
  }
  if (T.tool === 'erase') {
    hoverMesh.material.color.setRGB(1, .3, .2);
    const r = ringAt(m[0], m[1]); if (r) { ringShape(hoverMesh, r.c[0], r.c[1], r.R - 4, r.R + 4); T.hover = { ring: r.rid }; return; }
    const h = net.nearestEdge(m[0], m[1], R); if (h) { T.hover = { e: h.e }; ribbon(hoverMesh, h.e.pts, hwOf(h.e) + .6); }
    return;
  }
  if (T.tool === 'oneway') { const h = net.nearestEdge(m[0], m[1], R); if (h && !h.e.ring) { T.hover = { e: h.e }; ribbon(hoverMesh, h.e.pts, hwOf(h.e) + .6); } return; }
  if (T.tool === 'lanes') {   // show how wide it will be, and what it becomes
    const h = net.nearestEdge(m[0], m[1], R); if (!h || h.e.ring) { hint(); return; }
    const [nl, tl] = net.nextLanes(h.e); T.hover = { e: h.e };
    ribbon(hoverMesh, h.e.pts, hwOf({ ...h.e, nl, tl }) + .6);
    const chainL = net.roadChain(h.e).reduce((a, e) => a + e.len, 0), up = nl * 2 + tl > (h.e.nl || 1) * 2 + (h.e.tl || 0), cost = up ? Math.round(chainL * COST.lane * (nl + tl * .5) / 5) * 5 : 0;
    hint(`${laneName(nl, tl)}${cost ? ' · ' + money(cost) + ' coins' : ''}`); $('hint').classList.remove('bad');
    return;
  }
  if (T.tool === 'signal') {
    let best = null, bd = Math.max(16, R); for (const n of net.nodes.values()) { if (n.edges.size < 3) continue; const d = Math.hypot(n.x - m[0], n.z - m[1]); if (d < bd) { bd = d; best = n; } }
    if (best) { T.hover = { n: best }; ringShape(hoverMesh, best.x, best.z, best.trim + 1, best.trim + 3); if (best.sig) hoverMesh.material.color.setRGB(1, .75, .3); }
    return;
  }
  if (T.tool === 'ring') {
    const r = ringAt(m[0], m[1]); if (r) { T.hover = { bad: 'Already a roundabout' }; ringShape(hoverMesh, r.c[0], r.c[1], r.R - 3, r.R + 3); hoverMesh.material.color.setRGB(1, .35, .25); return; }
    let n = net.nearestNode(m[0], m[1], Math.max(25, R)); if (n && (n.ring || n.edges.size < 2 && net.nearestEdge(m[0], m[1], R))) n = n.ring ? null : n;
    let at, Rr;
    if (n) { at = [n.x, n.z]; Rr = net.ringFit(n); T.hover = Rr ? { n } : { bad: 'Not enough room here' }; }
    else { const h = net.nearestEdge(m[0], m[1], R); if (!h || h.e.ring) return; const p = along(h.e.pts, h.e.cum, h.s); at = [p[0], p[1]]; Rr = Math.min(net.ringWant([h.e, h.e]), h.s - 7, h.e.len - h.s - 7); T.hover = Rr >= 8 ? { e: h.e, s: h.s } : { bad: 'Too close to a junction' }; if (Rr < 8) Rr = 8; }
    const es = n ? [...n.edges].map(id => net.edges.get(id)) : T.hover.e ? [T.hover.e, T.hover.e] : [], rw = net.ringLanes(es) > 1 ? 3.8 : ONEWAY_W / 2;
    ringShape(hoverMesh, at[0], at[1], (Rr || 8) - rw, (Rr || 8) + rw + WALK_W);
    if (T.hover.bad) hoverMesh.material.color.setRGB(1, .35, .25);
  }
}
function afterEdit(pts, rgb = [.4, .9, 1]) {
  if (pts) burstAlong(pts, rgb);
  const gone = city.sync();
  const nb = gone.filter(g => !g.lot).length;
  const cb = city.cutBack || 0;
  if (nb || cb) toast([nb ? `${nb} building${nb > 1 ? 's' : ''} cleared` : '', cb ? `${cb} set back` : ''].filter(Boolean).join(', '));
  sound.magic();
  save();
}
// what a road costs: by its length
function roadCost(A, B, c) { const L = c ? Math.hypot(c[0] - A[0], c[1] - A[1]) + Math.hypot(B[0] - c[0], B[1] - c[1]) : Math.hypot(B[0] - A[0], B[1] - A[1]); return Math.round(L * COST.road / 5) * 5; }
// build a road; on success keep going from its end
function place(a, b, bend) {
  const c = through(a, b, bend), plan = net.planRoad(a, b, c, snapR()), cost = plan.reason ? 0 : roadCost(plan.a || a, plan.b || b, plan.cc);
  if (!plan.reason && !life.can(cost)) { toast('Need ' + money(cost) + ' coins', true); return false; }
  const made = net.addRoad(a, b, c, {}, snapR());
  if (made.reason) { toast(made.reason, true); return false; }
  life.spend(cost); life.stat.roads++; spentFx(cost);
  afterEdit(made.flatMap(e => e.pts));
  T.pts = [made.end]; T.pend = null; T.bend = null; T.draw = null; previewMesh.visible = false; hint();
  return true;
}
function click(x, z) {
  const t = T.tool; if (!t) return;
  T.mouse = [x, z]; if (!T.pend) hoverUpdate();
  if (t === 'road') {
    if (!T.pts.length) { const q = net.probe(x, z, snapR()); T.pts = [q.n ? [q.n.x, q.n.z] : q.p]; hoverUpdate(); return; }
    const a = T.pts[0]; if (Math.hypot(x - a[0], z - a[1]) < snapR()) { T.pts = []; hoverUpdate(); return; }   // tap the pin again to let go
    place(a, [x, z]); hoverUpdate(); return;
  }
  if (t === 'curve') {
    if (T.pend) { place(T.pend[0], T.pend[1], T.bend); hoverUpdate(); return; }
    if (!T.pts.length) { const q = net.probe(x, z, snapR()); T.pts = [q.n ? [q.n.x, q.n.z] : q.p]; hoverUpdate(); return; }
    const a = T.pts[0]; if (Math.hypot(x - a[0], z - a[1]) < snapR()) { T.pts = []; hoverUpdate(); return; }
    T.pend = [a, [x, z]]; T.bend = null; previewRoad(a, [x, z], null, true); hint(touch ? 'Drag to bend it, tap to place' : 'Move to bend it, click to place'); return;
  }
  const h = T.hover;
  if (t === 'build') { if (h) openPicker(h); else toast('Pick a street', true); return; }
  if (t === 'erase') {
    if (!h) return;
    if (h.ring) { const c = net.ringCenter(h.ring); net.removeRoundabout(h.ring); afterEdit(null); burst(c[0], c[1], 120, [1, .45, .3], 14); toast('Roundabout removed'); }
    else if (h.e) { const pts = h.e.pts; net.removeEdge(h.e.id); afterEdit(pts, [1, .45, .3]); }
    T.hover = null; return;
  }
  if (t === 'lanes') {
    if (!h) return;
    const [nl, tl] = net.nextLanes(h.e), chainL = net.roadChain(h.e).reduce((a, e) => a + e.len, 0), cost = nl * 2 + tl > (h.e.nl || 1) * 2 + (h.e.tl || 0) ? Math.round(chainL * COST.lane * (nl + tl * .5) / 5) * 5 : 0;
    if (cost && !life.can(cost)) return toast('Need ' + money(cost) + ' coins', true);
    const r = net.cycleLanes(h.e.id); if (!r) return; if (cost) { life.spend(cost); spentFx(cost); }
    afterEdit(net.roadChain(h.e).flatMap(e => e.pts)); toast(laneName(r.nl, r.tl) + (r.lights ? ' · lights added' : '')); hoverUpdate(); return;
  }
  if (t === 'oneway') { if (!h) return; const r = net.cycleOneWay(h.e.id); if (r != null) { afterEdit(h.e.pts); toast(r === 0 ? 'Two-way' : 'One-way'); } return; }
  if (t === 'signal') {
    if (!h) return; if (h.n.ring) return toast('Roundabouts don\'t need lights', true);
    if (!h.n.sig && !life.can(COST.light)) return toast('Need ' + money(COST.light) + ' coins', true);
    const r = net.toggleSignal(h.n.id); if (r) { life.spend(COST.light); spentFx(COST.light); } afterEdit(null); burst(h.n.x, h.n.z, 70, r ? [.4, 1, .5] : [1, .45, .3], 8); toast(r ? 'Lights on' : 'Lights off'); return;
  }
  if (t === 'ring') {
    if (!h) return; if (h.bad) return toast(h.bad, true);
    if (!life.can(COST.ring)) return toast('Need ' + money(COST.ring) + ' coins', true);
    const r = h.n ? net.makeRoundabout(h.n.id) : net.roundaboutOnRoad(h.e, h.s);
    if (typeof r !== 'number') return toast(r, true);
    life.spend(COST.ring); spentFx(COST.ring);
    const c = net.ringCenter(r); afterEdit(null); burst(c[0], c[1], 160, [.5, .95, 1], 18); toast('Roundabout built'); hoverUpdate();
  }
}

// ---------------- the town: building, buying land, looking at people and places ----------------
const hsh = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function buildSite(x, z, R) {
  const S0 = BLOCK * CHUNK, i = Math.floor((x + S0 / 2) / S0), j = Math.floor((z + S0 / 2) / S0);
  if (!city.inCity(x, z)) {
    const adj = city.unlocked.some(u => Math.abs(u[0] - i) + Math.abs(u[1] - j) === 1);
    return adj && Math.abs(i) <= 3 && Math.abs(j) <= 3 ? { land: [i, j] } : null;
  }
  const h = net.nearestEdge(x, z, Math.max(R, 34)); if (!h || h.e.ring) return null;
  const q = along(h.e.pts, h.e.cum, h.s), sg = Math.sign((x - q[0]) * -q[3] + (z - q[1]) * q[2]) || 1;
  return { e: h.e, s: h.s, sg };
}
const coinI = '<i class="coin"></i>';
function openPicker(site) {
  const L = $('pickList'); L.innerHTML = '';
  const add = (html, cls, ok, fn) => { const b = document.createElement('button'); b.innerHTML = html; if (cls) b.className = cls; b.disabled = !ok; b.onclick = () => { show('pick', false); fn(); }; L.appendChild(b); };
  if (site.land) {
    const c = COST.land(life.bought);
    $('pick').querySelector('h3').textContent = 'New land';
    add(`Buy this land, streets included<small>${coinI}${money(c)}</small>`, 'land', life.can(c), () => buyLand(site.land, c));
  } else {
    $('pick').querySelector('h3').textContent = 'Build on ' + life.streetName(site.e);
    for (const t of BUILD_ORDER) {
      const B = BIZ[t], locked = B.pop && life.people.size < B.pop;
      add(`${B.name}<small>${locked ? 'Needs ' + B.pop + ' people' : coinI + money(B.cost)}</small>`, B.svc ? 'svc' : '', !locked && life.can(B.cost), () => doBuild(site, t));
    }
  }
  show('pick', true);
}
$('pickX').onclick = () => show('pick', false);
$('pick').addEventListener('pointerdown', e => { if (e.target === $('pick')) show('pick', false); });
function doBuild(site, t) {
  const B = BIZ[t]; if (!life.can(B.cost)) return toast('Need ' + money(B.cost) + ' coins', true);
  const b = life.place(t, site.e, site.s, site.sg);
  if (!b) return toast('No room here', true);
  life.spend(B.cost); life.stat.built++; spentFx(B.cost);
  burst(b.x, b.z, 140, [1, .85, .3], Math.max(b.w, b.d) / 2); sound.magic(); toast(b.biz.name + ' opened');
  select({ k: 'b', id: b.id }); save();
}
function buyLand([i, j], c) {
  if (!life.spend(c)) return toast('Need ' + money(c) + ' coins', true);
  city.unlock(i, j, true); city.sync(); life.bought++; spentFx(c);
  const S0 = BLOCK * CHUNK, x = i * S0, z = j * S0;
  burst(x, z, 260, [.5, 1, .6], 130); sound.magic(); toast('New land: streets are in'); save();
}
function spentFx(c) { const el = $('coins'); el.classList.remove('spent'); void el.offsetWidth; el.classList.add('spent'); }
function gainFx() { const el = $('coins'); el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain'); }

// where a walker is: [x, z, hx, hz]
function walkPos(w) {
  let i = w.i || 0; const c = w.cum, s = Math.min(w.s, w.len);
  while (i < c.length - 2 && c[i + 1] < s) i++; while (i > 0 && c[i] > s) i--; w.i = i;
  const a = w.pts[i], b = w.pts[Math.min(i + 1, w.pts.length - 1)], L = (c[i + 1] - c[i]) || 1, t = Math.max(0, Math.min(1, (s - c[i]) / L));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
}
// where a person is right now: [x, z] (in a car, on foot, or inside a building)
function personPos(p) {
  if (p.car && net.cars.includes(p.car) && !p.car.hide) return [p.car.x, p.car.z];
  for (const mv of life.park.movers) if (mv.pid === p.id && !(mv.wait > 0)) { const q = life.park.pose(mv); return [q[0], q[1]]; }
  for (const u of law.units) { if (u.car && u.car.pid === p.id && net.cars.includes(u.car)) return [u.car.x, u.car.z]; if (u.state === 'hide' && u.pid === p.id && u.spot) return [u.spot.x, u.spot.z]; }
  if (p.walk) { const q = walkPos(p.walk); return [q[0], q[1]]; }
  const b = life.bmap.get(p.at); return b ? [b.x, b.z] : null;
}
// ray from the camera through a screen point into a building's box
const rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
function hitBuilding(sx, sy) {
  ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); rayO.copy(ray.ray.origin); rayD.copy(ray.ray.direction);
  let best = null, bt = 1e9;
  for (const b of city.buildings) {
    const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), ox = rayO.x - b.x, oz = rayO.z - b.z;
    const o = [ox * c + oz * s, rayO.y, -ox * s + oz * c], d = [rayD.x * c + rayD.z * s, rayD.y, -rayD.x * s + rayD.z * c];
    const lo = [-b.w / 2, 0, -b.d / 2], hi = [b.w / 2, b.h + (b.roof ? 2.5 : .6), b.d / 2];
    let t0 = 0, t1 = 1e9, ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(d[k]) < 1e-8) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; continue; }
      let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false;
    }
    if (ok && t0 < bt) { bt = t0; best = b; }
  }
  return best;
}
let sel = null, follow = null, cardT = 0;
function onTapWorld(x, z, sx, sy) {
  // a coin over a business: collect it
  for (const q of coinSpots) { const v = new THREE.Vector3(q.x, q.y, q.z).project(camera), px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight; if (Math.hypot(px - sx, py - sy) < (touch ? 34 : 24)) { collectAt(q.b); return; } }
  // people: on foot or in a car
  const r = Math.max(3.2, snapR() * .55); let best = null, bd = r;
  for (const w of life.walkers) { if (w.ghost) continue; const q = walkPos(w), d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; best = w.pid; } }
  for (const c of net.cars) { if (!c.pid || c.hide) continue; const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - c.len * .35); if (d < bd) { bd = d; best = c.pid; } }
  for (const sp of life.park.parked.values()) { const d = Math.max(0, Math.hypot(sp.x - x, sp.z - z) - 1.8); if (d < bd) { bd = d; best = sp.pid; } }
  for (const mv of life.park.movers) { const q = life.park.pose(mv), d = Math.max(0, Math.hypot(q[0] - x, q[1] - z) - 1.8); if (d < bd) { bd = d; best = mv.pid; } }
  for (const u of law.units) if (u.state === 'hide' && u.spot && u.pid) { const d = Math.hypot(u.spot.x - x, u.spot.z - z) - 1.5; if (d < bd) { bd = d; best = u.pid; } }
  if (best != null && life.person(best)) { select({ k: 'p', id: best }); return; }
  const b = hitBuilding(sx, sy); if (b) { select({ k: 'b', id: b.id }); return; }
  select(null);
}

function collectAt(b) {
  const c = life.collect(b); if (!c) return;
  life.stat.collected++; burst(b.x, b.z, 50, [1, .82, .2], 4); sound.coin(); gainFx(); toast('+' + money(c));
}
function select(s) {
  if (!s || !sel || s.k !== sel.k || s.id !== sel.id) setFollow(null);
  sel = s; document.body.classList.toggle('carded', !!s);
  if (!s) { $('card').classList.remove('show'); selRing.visible = false; return; }
  drawCard(); $('card').classList.add('show');
}
// following someone: the camera swings round behind them and stays low; the card shrinks out of the way
let followUserT = 0;
function setFollow(id) {
  follow = id; $('card').classList.toggle('mini', id != null);
  if (id == null) return;
  const p = life.person(id), q = p && personPos(p), h = p && personHeading(p);
  if (q) flyTo({ x: q[0], z: q[1], dist: Math.min(cam.dist, 56), pitch: .5, yaw: h ? Math.atan2(-h[0], -h[1]) : cam.yaw }, .8);
}
function personHeading(p) {
  for (const mv of life.park.movers) if (mv.pid === p.id && !(mv.wait > 0)) { const q = life.park.pose(mv); return [Math.cos(q[2]), -Math.sin(q[2])]; }
  if (p.car && net.cars.includes(p.car)) return [p.car.hx, p.car.hz];
  for (const u of law.units) if (u.car && u.car.pid === p.id && net.cars.includes(u.car)) return [u.car.hx, u.car.hz];
  if (p.walk) { const q = walkPos(p.walk); return [q[2], q[3]]; }
  return null;
}
const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function drawCard() {
  const C = $('card'); if (!sel) return;
  if (sel.k === 'p') {
    const p = life.person(sel.id); if (!p) return select(null);
    const w = p.work && life.bmap.get(p.work), boss = life.boss(p), home = life.bmap.get(p.home);
    const role = p.guest ? 'Visitor' : p.work ? life.title(p) : p.kid ? 'Student' : p.ret ? 'Retired' : 'Looking for work';
    const bad = !p.kid && (!p.ins || !p.reg || p.temper > .955);   // something the police would want to know about
    let rows = '';
    if (w) rows += `<span>Job</span><b>${esc(life.title(p))}</b><span>Works at</span><b class="link" data-b="${w.id}">${esc(w.biz.name)}</b>`;
    if (w) rows += `<span>Reports to</span>${boss ? `<b class="link" data-p="${boss.id}">${esc(boss.fn + ' ' + boss.ln)}, ${esc(life.title(boss))}</b>` : '<b>Nobody: runs the place</b>'}`;
    if (w) { const sh = life.shift(p); if (sh) rows += `<span>Hours</span><b>${hhmm(sh[0])} to ${hhmm(sh[1])}</b>`; }
    if (home) rows += `<span>Lives at</span><b class="link" data-b="${home.id}">${esc(life.address(home))}</b>`;
    else if (p.guest) rows += `<span>From</span><b>Out of town</b>`;
    if (!p.kid) rows += `<span>Car</span><b>${p.car && net.cars.includes(p.car) ? esc(aCar(p.car)) + ', ' : ''}${p.ins ? 'insured' : 'no insurance'}, ${p.reg ? 'tags current' : 'tags expired'}</b>`;
    if (p.temper > .955 && !p.kid) rows += `<span>Driving</span><b>Reckless</b>`; else if (p.temper > .7 && !p.kid) rows += `<span>Driving</span><b>Heavy right foot</b>`;
    C.innerHTML = `<div class="ch"><div><h4>${esc(p.fn + ' ' + p.ln)}</h4><div class="sub">${p.age} · ${esc(role)}</div></div><button class="x" data-act="close">${X_ICON}</button></div>
      <div class="doing">${esc(unitDoing(p.id) || (p.wanted && p.car ? 'Running from the police' : life.doing(p)))}</div><div class="rows">${rows}</div>
      <div class="cb"><button data-act="follow" class="${follow === p.id ? 'y' : ''}">${follow === p.id ? 'Stop following' : 'Follow'}</button>${bad && !law.isUnit(p.id) ? `<button data-act="report" class="rep" ${law.bolo.has(p.id) ? 'disabled' : ''}>${law.bolo.has(p.id) ? 'Reported' : 'Report'}</button>` : ''}${w && follow !== p.id ? `<button data-b="${w.id}">Workplace</button>` : ''}${home && follow !== p.id ? `<button data-b="${home.id}">Home</button>` : ''}</div>`;
    return;
  }
  const b = life.bmap.get(sel.id); if (!b) return select(null);
  if (b.biz) {
    const B = BIZ[b.biz.t], lv = b.biz.lvl, up = lv < MAX_LVL ? upCost(b.biz.t, lv) : 0, cap = life.cashCap(b);
    const per = B.rate ? Math.round(B.rate * lvlMul(lv)) : 0;
    let staff = '';
    for (const id of b.biz.staff) { const p = life.people.get(id); if (!p) continue; staff += `<div data-p="${id}"><b>${esc(p.fn + ' ' + p.ln)}</b><span>${esc(life.title(p))}</span><i class="${p.state === 'in' && p.at === b.id ? 'in' : ''}"></i></div>`; }
    const inside = [...life.people.values(), ...life.guests.values()].filter(p => p.state === 'in' && p.at === b.id).length;
    C.innerHTML = `<div class="ch"><div><h4>${esc(b.biz.name)}</h4><div class="sub">${esc(B.name)} · Level ${lv}</div></div><button class="x" data-act="close">${X_ICON}</button></div>
      <div class="lvl">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</div>
      <div class="rows"><span>Staff in</span><b>${b.biz.here || 0} of ${b.jobs}${b.biz.staff.length < b.jobs ? ' (' + (b.jobs - b.biz.staff.length) + ' to hire)' : ''}</b>
      <span>Inside now</span><b>${inside}</b>
      ${per ? `<span>Earns</span><b>${money(per)} an hour, fully staffed</b>` : `<span>Upkeep</span><b>${money(B.upkeep * (1 + (lv - 1) * .35))} a day</b>`}
      <span>Open</span><b>${B.hours[1] - B.hours[0] >= 24 ? 'Day and night' : hhmm(B.hours[0]) + ' to ' + hhmm(B.hours[1])}</b>
      <span>Address</span><b>${esc(life.address(b))}</b>
      ${lv >= 3 ? '<span>Manager</span><b>Banks the takings for you</b>' : B.rate || B.spend ? `<span>Till</span><b>${money(b.biz.cash || 0)} of ${money(cap)}</b>` : ''}</div>
      <div class="cb">${lv < 3 && (B.rate || B.spend) ? `<button data-act="collect" class="y" ${b.biz.cash >= 1 ? '' : 'disabled'}>${coinI} Collect</button>` : ''}
      <button data-act="upgrade" ${lv < MAX_LVL && life.can(up) ? '' : 'disabled'}>${lv < MAX_LVL ? 'Upgrade ' + coinI + money(up) : 'Top level'}</button></div>
      <div class="staff">${staff}</div>`;
    return;
  }
  const res = [...life.people.values()].filter(p => p.home === b.id);
  const inside = res.filter(p => p.state === 'in' && p.at === b.id).length;
  C.innerHTML = `<div class="ch"><div><h4>${esc(life.address(b))}</h4><div class="sub">${b.kind === 'house' ? 'House' : 'Apartments'} · ${res.length} living here</div></div><button class="x" data-act="close">${X_ICON}</button></div>
    <div class="rows"><span>Home now</span><b>${inside}</b></div>
    <div class="staff">${res.slice(0, 40).map(p => `<div data-p="${p.id}"><b>${esc(p.fn + ' ' + p.ln)}</b><span>${p.work ? esc(life.title(p)) : p.kid ? 'Student' : p.ret ? 'Retired' : 'Looking for work'}</span><i class="${p.state === 'in' && p.at === b.id ? 'in' : ''}"></i></div>`).join('')}</div>`;
}
const hhmm = h => { h = ((h % 24) + 24) % 24; const H = Math.floor(h), m = Math.round((h - H) * 60); return (H % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (H < 12 ? ' am' : ' pm'); };
$('card').addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-b],[data-p]'); if (!t) return;
  if (t.dataset.act === 'close') return select(null);
  if (t.dataset.act === 'follow') { setFollow(follow === sel.id ? null : sel.id); drawCard(); return; }
  if (t.dataset.act === 'report') { const r = law.report(sel.id); toast(r === 'ok' ? 'Reported: an officer is heading out' : r === 'nopolice' ? 'Build a police station first' : r === 'clean' ? 'Nothing to report' : 'Already reported', r !== 'ok'); drawCard(); return; }
  if (t.dataset.act === 'collect') { const b = life.bmap.get(sel.id); if (b) collectAt(b); drawCard(); return; }
  if (t.dataset.act === 'upgrade') { const b = life.bmap.get(sel.id); if (b && life.upgrade(b)) { spentFx(0); burst(b.x, b.z, 120, [.5, 1, .6], Math.max(b.w, b.d) / 2); sound.magic(); toast(b.biz.name + ': level ' + b.biz.lvl); save(); } drawCard(); return; }
  if (t.dataset.b) { const b = life.bmap.get(+t.dataset.b); if (b) { select({ k: 'b', id: b.id }); follow = null; flyTo({ x: b.x, z: b.z, dist: Math.min(cam.dist, 160) }, .9); } return; }
  if (t.dataset.p) { const p = life.person(+t.dataset.p); if (p) { select({ k: 'p', id: p.id }); const q = personPos(p); if (q) flyTo({ x: q[0], z: q[1], dist: Math.min(cam.dist, 140) }, .9); } }
});
// the selected person: a ring at their feet (or round their car); following keeps them in view
const selRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.1, 36).rotateX(-Math.PI / 2), glowMat([1, .8, .15], .95)); selRing.renderOrder = 6; selRing.visible = false; scene.add(selRing);
function selTick(dt) {
  selRing.visible = false;
  if (!sel) return;
  cardT += dt; if (cardT > .5) { cardT = 0; drawCard(); }
  if (sel.k === 'p') {
    const p = life.person(sel.id); if (!p) return;
    const q = personPos(p); if (!q) return;
    const inCar = (p.car && net.cars.includes(p.car)) || law.isUnit(p.id), r = (inCar ? 3.3 : 1) * (follow === p.id ? .62 : 1);
    selRing.position.set(q[0], .45, q[1]); selRing.scale.set(r, 1, r); selRing.visible = !(p.state === 'in');
    if (follow === p.id && !fly && !pinch) {
      // a chase camera: a little ahead of them, swinging round behind as they turn (unless you've just turned it yourself)
      const h = personHeading(p), lead = h && inCar ? Math.min(8, (p.car ? p.car.v : 4) * .6) : 0;
      const k = 1 - Math.exp(-dt * 5); cam.x += (q[0] + (h ? h[0] * lead : 0) - cam.x) * k; cam.z += (q[1] + (h ? h[1] * lead : 0) - cam.z) * k;
      followUserT -= dt;
      if (h && followUserT <= 0 && !drag) { let d = Math.atan2(-h[0], -h[1]) - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * (1 - Math.exp(-dt * 1.6)); }
      placeCamera();
    }
  } else if (sel.k === 'b') {
    const b = life.bmap.get(sel.id); if (!b) return;
    selRing.position.set(b.x, .45, b.z); const r = Math.max(b.w, b.d) / 2 / 1.8 + 1.5; selRing.scale.set(r, 1, r); selRing.visible = true;
  }
}
// coins waiting over the businesses (tap one to collect)
const coinTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#121314'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  g.fillStyle = '#f5c000'; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill();
  g.strokeStyle = '#b38a00'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 38, 0, 7); g.stroke();
  g.fillStyle = '#b38a00'; g.fillRect(57, 40, 14, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const coinMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: coinTex, transparent: true, alphaTest: .5, toneMapped: false, depthTest: true }), 256);
coinMesh.count = 0; coinMesh.frustumCulled = false; coinMesh.renderOrder = 7; scene.add(coinMesh);
let coinSpots = [];
function drawCoins(t) {
  coinSpots = []; let n = 0;
  if (!titleUp) for (const b of city.buildings) {
    if (!b.biz || b.biz.lvl >= 3 || n >= 256) continue;
    const cap = life.cashCap(b); if ((b.biz.cash || 0) < Math.max(12, cap * .12)) continue;
    const sc = Math.max(3.2, Math.min(16, cam.dist * .028)) * (b.biz.cash >= cap - 1 ? 1.25 : 1), y = b.h + 3 + sc * .6 + Math.sin(t * 2.4 + b.id) * sc * .08;
    dummy.position.set(b.x, y, b.z); dummy.quaternion.copy(camera.quaternion); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); coinMesh.setMatrixAt(n++, dummy.matrix);
    coinSpots.push({ x: b.x, y, z: b.z, b });
  }
  dummy.quaternion.identity();
  coinMesh.count = n; coinMesh.instanceMatrix.needsUpdate = true;
}

// ---------------- input ----------------
// phones: a quick drag always moves the map; with Road or Curve picked, press and hold, then drag, to draw.
// Two fingers turn, tilt and zoom. Bending a curve that's waiting: plain drag.
const ptrs = new Map(); let drag = null, pinch = null;
const HOLD = 260;   // ms to hold still before a drag draws
const drawing = e => e.pointerType !== 'mouse' && (T.tool === 'road' || T.tool === 'curve');
function startDraw(d, sure = false) {   // the finger has been held still: from here on this drag draws
  if (drag !== d || ptrs.size !== 1 || (d.moved > 6 && !sure) || !d.g0 || d.draw) return;
  d.draw = true; d.held = true; const q = net.probe(d.g0[0], d.g0[1], snapR()); d.start = q.n ? [q.n.x, q.n.z] : q.p;
  cursor.position.set(d.start[0], .35, d.start[1]); cursor.visible = true; burst(d.start[0], d.start[1], 18, [.5, .95, 1], 3);
  if (navigator.vibrate) navigator.vibrate(12);
  hint(T.tool === 'road' ? 'Drag to where the road ends' : 'Drag to where the curve ends'); $('hint').classList.remove('bad');
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  sound.start();
  if (ptrs.size === 1) {
    const g = groundAt(e.clientX, e.clientY); drag = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, btn: e.button, moved: 0, g0: g, draw: false };
    if (drawing(e) && e.button === 0) { if (T.tool === 'curve' && T.pend) drag.draw = true; else { const d = drag; d.mayDraw = true; d.timer = setTimeout(() => startDraw(d), HOLD); } }
  }
  else { if (drag) clearTimeout(drag.timer); drag = null; if (T.draw) { T.draw = null; previewMesh.visible = false; hint(); } }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ay: a.y, by: b.y, g0: groundAt((a.x + b.x) / 2, (a.y + b.y) / 2) }; }
  fly = zoomTo = coast = null;
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (e.pointerType === 'mouse' && (!drag || drag.moved < 8)) { T.mouse = groundAt(e.clientX, e.clientY); hoverUpdate(); }
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) {
    // two fingers hold the map: twist turns it the way the fingers turn, pinch zooms, sliding both up or down tilts.
    // The ground between the fingers stays between the fingers.
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let da = ang - pinch.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
    const tilting = Math.abs(my - pinch.my) > 2 * Math.abs(d - pinch.d) && Math.abs(a.y - pinch.ay - (b.y - pinch.by)) < 14;   // both fingers slide together
    cam.dist *= pinch.d / Math.max(10, d); cam.yaw += da;
    if (tilting) cam.pitch += (my - pinch.my) * .0045;
    pinch.d = d; pinch.ang = ang; pinch.my = my; pinch.ay = a.y; pinch.by = b.y; fly = zoomTo = coast = null; if (Math.abs(da) > .002) followUserT = 4;
    placeCamera(); const g = groundAt(mx, my); if (g && pinch.g0 && !tilting) { cam.x += pinch.g0[0] - g[0]; cam.z += pinch.g0[1] - g[1]; placeCamera(); }
    if (tilting) pinch.g0 = groundAt(mx, my);
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  // first real movement decides, by the touch's own timestamps (timers run late on a busy phone):
  // held still long enough first = draw, else = move the map
  if (drag.mayDraw && !drag.checked && drag.moved > 6) {
    drag.checked = true; clearTimeout(drag.timer);
    if (e.timeStamp - drag.t0 >= HOLD) startDraw(drag, true); else if (drag.draw) { drag.draw = drag.held = false; hint(); }
  }
  if (drag.draw) {
    if (drag.moved < 10) return;
    const g = groundAt(e.clientX, e.clientY); if (!g) return;
    if (T.tool === 'curve' && T.pend) { T.bend = g; previewRoad(T.pend[0], T.pend[1], g); }
    else if (drag.start) { T.draw = { a: drag.start, b: g }; pin.visible = false; previewRoad(drag.start, g, null); }
    return;
  }
  if (drag.btn === 2 || (drag.btn === 0 && e.shiftKey && e.pointerType === 'mouse')) { cam.yaw -= (e.movementX || 0) * .006; cam.pitch += (e.movementY || 0) * .005; placeCamera(); return; }
  if (follow != null && drag.moved > 6) {   // following: a drag swings the camera round them
    const lx = drag.lx ?? drag.x0, ly = drag.ly ?? drag.y0; drag.lx = e.clientX; drag.ly = e.clientY;
    cam.yaw -= (e.clientX - lx) * .008; cam.pitch += (e.clientY - ly) * .004; followUserT = 4; placeCamera(); return;
  }
  if (drag.moved > 6 && drag.g0) {
    const g = groundAt(e.clientX, e.clientY);
    if (g) {
      const mx = drag.g0[0] - g[0], mz = drag.g0[1] - g[1]; cam.x += mx; cam.z += mz; placeCamera();
      // how fast the map is moving (for the glide when the finger lets go)
      const t = e.timeStamp, dt = Math.max(.004, (t - (drag.vt || drag.t0)) / 1000); drag.vt = t;
      const k = Math.min(1, dt * 18); drag.vx = (drag.vx || 0) * (1 - k) + mx / dt * k; drag.vz = (drag.vz || 0) * (1 - k) + mz / dt * k;
    }
  }
});
function up(e) {
  const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (!had || !drag) return;
  clearTimeout(drag.timer);
  const g = groundAt(e.clientX, e.clientY);
  if (drag.draw && drag.moved >= 10 && g) {
    if (T.tool === 'curve' && T.pend) place(T.pend[0], T.pend[1], g);
    else if (T.draw) {
      const a = T.draw.a; T.draw = null;
      if (T.tool === 'road') place(a, g);
      else { T.pts = [a]; T.pend = [a, g]; T.bend = null; previewRoad(a, g, null, true); hint('Drag to bend it, tap to place'); }
    }
    hoverUpdate(); drag = null; return;
  }
  if (drag.btn === 2 && drag.moved < 6) { T.pts = []; T.pend = null; previewMesh.visible = false; hint(); hoverUpdate(); drag = null; return; }
  if (drag.draw && drag.moved < 10) { hint(); drag = null; return; }   // held but didn't drag: nothing
  if (drag.btn === 0 && drag.moved < 10 && g) {
    if (T.tool) click(g[0], g[1]); else tap(g[0], g[1], e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { T.mouse = g; hoverUpdate(); }
  }
  // let go while moving: the map glides on (not after a slow, careful drag)
  else if (follow == null && drag.moved >= 10 && drag.vx !== undefined && e.timeStamp - (drag.vt || 0) < 80 && !ptrs.size) {
    const v = Math.hypot(drag.vx, drag.vz), cap = cam.dist * 4;
    if (v > cam.dist * .25) coast = { vx: drag.vx * Math.min(1, cap / v), vz: drag.vz * Math.min(1, cap / v) };
  }
  drag = null;
}
// a tap with no tool picked: double tap zooms in there (selecting things comes with the people)
let lastTap = null;
function tap(x, z, sx, sy) {
  const now = performance.now();
  if (lastTap && now - lastTap.t < 320 && Math.hypot(sx - lastTap.sx, sy - lastTap.sy) < 30) { zoomTo = { dist: Math.max(26, cam.dist * .45), cx: sx, cy: sy }; lastTap = null; return; }
  lastTap = { t: now, sx, sy };
  onTapWorld(x, z, sx, sy);
}

canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', () => { if (!ptrs.size) { T.mouse = null; cursor.visible = false; } });
canvas.addEventListener('wheel', e => {
  e.preventDefault(); fly = coast = null;
  const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode ? .05 : .0016))));
  zoomTo = { dist: clamp((zoomTo ? zoomTo.dist : cam.dist) * f, 26, 1500), cx: e.clientX, cy: e.clientY };
}, { passive: false });
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  // while the start screen, the menu or the game-over sign is up, keys don't reach the game behind it
  if (document.querySelector('.screen.show') || titleUp) {
    if (e.code === 'Escape') { if ($('settings').classList.contains('show')) $('setBack').click(); else if ($('credits').classList.contains('show')) show('credits', false); else if ($('menu').classList.contains('show')) showMenu(false); }
    if (e.code === 'Space') e.preventDefault(); return;
  }
  if (e.code === 'Escape' && !T.tool && !T.pts.length) { showMenu(true); return; }
  keys.add(e.code);
  const n = '1234567'.indexOf(e.key); if (n >= 0) setTool(TOOLS[n]); if (e.code === 'KeyB') setTool('build');
  if (e.code === 'Escape') { if (T.pend) T.pend = null; else if (T.pts.length) T.pts = []; else setTool(''); previewMesh.visible = false; hint(); hoverUpdate(); }
  if (e.code === 'Space') { e.preventDefault(); setSpeed(S.speed ? 0 : (S.lastSpeed || 1)); }
  if (e.code === 'KeyT') toggleView();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function keyMove(dt) {
  let mx = 0, mz = 0, ry = 0, rp = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyQ')) ry += 1; if (keys.has('KeyE')) ry -= 1; if (keys.has('KeyR')) rp += 1; if (keys.has('KeyF')) rp -= 1;
  if (keys.has('KeyZ') || keys.has('Equal')) z -= 1; if (keys.has('KeyX') || keys.has('Minus')) z += 1;
  if (!mx && !mz && !ry && !rp && !z) return;
  const sp = cam.dist * 1.2 * dt, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  cam.x += (mx * c + mz * s) * sp; cam.z += (-mx * s + mz * c) * sp; cam.yaw += ry * dt * 1.6; cam.pitch += rp * dt; cam.dist *= Math.exp(z * dt * 1.5);
  placeCamera(); if (T.mouse) hoverUpdate();
}

// ---------------- HUD ----------------
function toast(msg, bad = false) { const t = $('toast'); t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1800); }
function setSpeed(v) { if (v) S.lastSpeed = v; S.speed = v; for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('on', +b.dataset.speed === v); }
function toggleView() { S.view = !S.view; $('viewBtn').classList.toggle('on', S.view); if (overlay) overlay.visible = S.view; paintOverlay(); }
for (const b of document.querySelectorAll('#tools button[data-tool]')) b.addEventListener('click', () => { setTool(b.dataset.tool); sound.start(); });
for (const b of document.querySelectorAll('#speed button')) b.addEventListener('click', () => setSpeed(+b.dataset.speed));
$('viewBtn').addEventListener('click', toggleView);
const fmt = n => n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const money = n => Math.floor(n).toLocaleString('en-US');
function hud() {
  const h = (S.time / DAY * 24) % 24, day = Math.floor(S.time / DAY) + 1;
  $('clock').textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0');
  $('day').textContent = 'DAY ' + day;
  $('sCoins').textContent = money(life.coins);
  let jobs = 0, filled = 0; for (const b of city.buildings) if (b.biz) { jobs += b.jobs; filled += b.biz.staff.length; }
  $('sPop').textContent = fmt(life.people.size); $('sJobs').textContent = filled + '/' + jobs; $('sCars').textContent = fmt(net.cars.length); $('sFlow').textContent = Math.round(S.flow * 100) + '%';
  const g = life.goal(); $('goalTxt').textContent = g.txt; $('goalPay').textContent = g.pay ? '+' + money(g.pay) : '';
  $('jamPct').textContent = Math.round(S.meter * 100) + '%';
  $('jamBar').querySelector('i').style.width = (S.meter * 100) + '%';
  $('jamBar').className = S.meter > .7 ? 'bad' : S.meter > .4 ? 'warn' : '';
}

// ---------------- simulation tick ----------------
let jamT = 0, ovT = 0, lastGave = 0, goalT = 0, jamWarnT = 0;
function simStep(dt) {
  S.time += dt * clockRate((S.time / DAY * 24) % 24); life.T = S.time;
  city.release(dt, Q.maxCars);
  net.step(dt);
  life.step(dt);
  law.step(dt);
  for (const ev of law.events.splice(0)) {
    if (ev.k === 'horn') sound.honk(ev.x, ev.z);
    if (ev.k === 'feed' && !titleUp) { scanPush(ev.f); if (['10-50', '10-80', '10-31', '10-52', '10-57'].includes(ev.f.code)) sound.siren(ev.f.x, ev.f.z); }
  }
  // people move in when there's work: new homes go up along the streets (together every few seconds)
  if (city.regrow(dt, life.wantHomes())) save();
  if (city.ver !== lifeVer) { life.sync(); lifeVer = city.ver; coreGrow(); }
  goalT += dt; if (goalT > 1) { goalT = 0; life.checkGoal(); }
  for (const ev of life.events.splice(0)) {
    if (ev.k === 'goal') { toast('Goal done +' + money(ev.pay)); sound.coin(); }
    if (ev.k === 'day' && !titleUp) daySummary(ev);
  }
  // gridlock meter: when it's high, workers and shoppers don't get through (the businesses earn less)
  jamT += dt;
  if (jamT >= .5) {
    let stuck = 0, flow = 0; for (const c of net.cars) { if (c.stuck > 25) stuck++; flow += Math.min(1, c.v / (c.lane.vmax * .8)); }
    const n = net.cars.length, jam = stuck / Math.max(40, n);
    S.flow += ((n ? flow / n : 1) - S.flow) * .1;
    const gave = net.stats.gaveUp - lastGave; lastGave = net.stats.gaveUp;
    S.meter = Math.max(0, Math.min(1, S.meter + (jam - .1) * jamT / 45 + gave * .006));
    jamT = 0;
    jamWarnT -= .5; if (S.meter > .85 && jamWarnT <= 0 && !titleUp) { jamWarnT = 60; toast('Gridlock: people can\'t get to work', true); }
  }
}
// the end of each day: the books, then on to the next day
function daySummary(ev) {
  const s = ev.sum, row = (k, v, cls = '') => `<span class="${cls}">${k}</span><b class="${cls}">${v}</b>`;
  $('dsTitle').textContent = 'DAY ' + ev.day;
  $('dsRows').innerHTML = row('Businesses', '+' + money(s.biz)) + row('Taxes', '+' + money(s.tax)) + (s.fines ? row('Fines', '+' + money(s.fines)) : '') + (s.upkeep ? row('Services', '-' + money(s.upkeep)) : '') + (s.spent ? row('Spent', '-' + money(s.spent)) : '')
    + row('Total', (s.net >= 0 ? '+' : '') + money(s.net), 'tot') + row('Trips', fmt(s.trips)) + (s.late ? row('Late for work', s.late) : '') + (s.crashes ? row('Crashes', s.crashes) : '') + (s.stops ? row('Traffic stops', s.stops) : '') + (s.arrests ? row('Arrests', s.arrests) : '') + row('People', fmt(s.people));
  S.daySpeed = S.speed || S.lastSpeed || 1; setSpeed(0); show('daySum', true); sound.coin(); save();
}
$('hud').addEventListener('click', () => $('hud').classList.toggle('open'));
$('dsGo').onclick = () => { show('daySum', false); setSpeed(S.daySpeed || 1); };

// ---------------- per frame drawing ----------------
const kinds = Object.keys(fleet);
const LOOK = c => c.type === 'car' ? (c.id % 3 === 0 ? 'hatch' : 'car') : c.type === 'suv' ? (c.id % 2 ? 'pickup' : 'suv') : c.type;
const flashes = [];   // emergency lights: [x, z, phase]
const beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beamMat, Q.maxCars + 50); beams.count = 0; beams.frustumCulled = false; beams.renderOrder = 1; scene.add(beams);
function drawCars() {
  const cnt = {}; for (const k of kinds) cnt[k] = 0;
  const lit = beamMat.opacity > .02; let nb = 0;
  flashes.length = 0; let nBlob = 0;
  for (const c of net.cars) {
    if (c.hide) continue;   // (still in its parking stall: the parked copy is drawn below)
    const look = LOOK(c), m = fleet[look], i = cnt[look]++; if (i >= m.instanceMatrix.count) continue;
    const yaw = Math.atan2(-c.hz, c.hx) + (c.spin || 0);
    dummy.position.set(c.x, 0, c.z); dummy.rotation.set(0, yaw, c.crashed ? .02 : 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    if (c.siren || c.lights) flashes.push([c.x, c.z, c.id]);
    if (nBlob < carBlobs.instanceMatrix.count) { dummy.position.set(c.x, .2, c.z); dummy.scale.set(c.len + 1.4, 1, c.w + 1.3); dummy.updateMatrix(); carBlobs.setMatrixAt(nBlob++, dummy.matrix); dummy.position.set(c.x, 0, c.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); }
    m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, c.type === 'bus' ? col.setRGB(.96, .6, .03, THREE.SRGBColorSpace) : c.type === 'police' || c.type === 'ems' || c.type === 'fire' ? col.setRGB(1, 1, 1) : c.type === 'truck' ? carColor((c.color * 3) % 1, col) : carColor(c.color, col));
    m.geometry.attributes.aBrake.array[i] = c.brake + 2 * (c.sig || 0) + (c.siren || c.lights ? 8 : 0);
    if (lit) { const f = c.len / 2 + 6.5; dummy.position.set(c.x + c.hx * f, .1, c.z + c.hz * f); dummy.scale.set(13, 1, 7.5); dummy.updateMatrix(); beams.setMatrixAt(nb++, dummy.matrix); }
  }
  // cars in the parking lots: parked, pulling in, backing out
  const pk = life.park, putCar = (type, id, color, x, z, yaw, brake) => {
    const look = LOOK({ type, id }), m = fleet[look]; if (!m) return; const i = cnt[look]++; if (i >= m.instanceMatrix.count) return;
    dummy.position.set(x, 0, z); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, type === 'bus' ? col.setRGB(.96, .6, .03, THREE.SRGBColorSpace) : type === 'truck' ? carColor((color * 3) % 1, col) : carColor(color, col)); m.geometry.attributes.aBrake.array[i] = brake;
    if (nBlob < carBlobs.instanceMatrix.count) { dummy.position.set(x, .2, z); dummy.scale.set(5.6, 1, 3); dummy.updateMatrix(); carBlobs.setMatrixAt(nBlob++, dummy.matrix); dummy.scale.set(1, 1, 1); }
  };
  for (const sp of pk.parked.values()) if (!sp.moving) putCar(sp.type, sp.id, sp.color, sp.x, sp.z, sp.yaw, 0);
  for (const mv of pk.movers) {
    if (mv.wait > 0) { const sp = pk.parked.get(mv.k); if (sp) putCar(sp.type, sp.id, sp.color, sp.x, sp.z, sp.yaw, 0); continue; }
    const q = pk.pose(mv); putCar(mv.type, mv.id, mv.color, q[0], q[1], q[2], (mv.v < 1.2 ? 1 : 0) + 2 * (mv.sig || 0));
  }
  // police parked out of sight at their spots, watching the traffic
  for (const u of law.units) {
    if (u.state !== 'hide' || !u.spot) continue; const m = fleet.police, i = cnt.police++; if (i >= m.instanceMatrix.count) continue;
    dummy.position.set(u.spot.x, 0, u.spot.z); dummy.rotation.set(0, u.spot.yaw, 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, col.setRGB(1, 1, 1)); m.geometry.attributes.aBrake.array[i] = 0;
  }
  for (const k of kinds) { const m = fleet[k]; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.geometry.attributes.aBrake.needsUpdate = true; }
  carBlobs.count = nBlob; carBlobs.instanceMatrix.needsUpdate = true;
  beams.count = nb; beams.visible = lit; if (nb) beams.instanceMatrix.needsUpdate = true;
}
// people on foot: everyone you see walking is someone in the town (or a visitor), going somewhere
const PED_MAX = Math.max(1, Q.peds);
function updatePeds(dt) {
  let n = 0;
  for (const w of life.walkers) {
    if (n >= PED_MAX) break;
    const [x, z, hx, hz] = walkPos(w), p = life.person(w.pid), id = Math.abs(w.pid);
    const h = p && p.kid ? .72 + hsh(id, 1) * .12 : .92 + hsh(id, 1) * .14;
    dummy.position.set(x, .16 + Math.abs(Math.sin(w.ph)) * .035, z); dummy.rotation.set(0, Math.atan2(-hz, hx), 0); dummy.scale.setScalar(h); dummy.updateMatrix();
    pedMesh.setMatrixAt(n, dummy.matrix); const c = CLOTH[Math.floor(hsh(id, 2) * CLOTH.length)]; pedMesh.setColorAt(n, col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));
    pedLook.setXYZ(n, hsh(id, 3), hsh(id, 4), hsh(id, 5)); pedWalk.setX(n, dt > 0 ? Math.sin(w.ph) : pedWalk.getX(n)); n++;
  }
  pedMesh.count = n; pedMesh.instanceMatrix.needsUpdate = true; if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true; pedLook.needsUpdate = true; pedWalk.needsUpdate = true;
}
const CLOTH = [[.15, .17, .22], [.85, .85, .82], [.6, .12, .12], [.18, .3, .5], [.25, .25, .25], [.62, .5, .32], [.3, .42, .3], [.9, .65, .2], [.1, .1, .12], [.55, .3, .5], [.3, .55, .65], [.95, .95, .95]];
function drawSignals() {
  if (!lampMesh) return;
  const st = new Map();
  sigLamps.forEach((q, i) => {
    let v = st.get(q.L); if (v === undefined) { v = net.sigState(q.n, q.L); st.set(q.L, v); }
    const on = (q.k === 0 && v === 'r') || (q.k === 1 && v === 'y') || (q.k === 2 && v === 'g');
    if (q.k === 0) lampMesh.setColorAt(i, on ? col.setRGB(1, .12, .06) : col.setRGB(.14, .03, .03));
    else if (q.k === 1) lampMesh.setColorAt(i, on ? col.setRGB(1, .7, .08) : col.setRGB(.13, .1, .02));
    else lampMesh.setColorAt(i, on ? col.setRGB(.15, 1, .45) : col.setRGB(.02, .1, .05));
  });
  lampMesh.instanceColor.needsUpdate = true;
}
function drawJams(t) {
  const list = [];
  for (const n of net.nodes.values()) {
    if (n.edges.size < 3 || !n.ins) continue; let q = 0;
    for (const L of n.ins) for (const c of L.cars) if (c.stuck > 42) q++;   // longer than a full cycle of lights: a real jam
    if (q >= 3) list.push([n, q]);
  }
  list.sort((a, b) => b[1] - a[1]);
  jamMarks.forEach((m, i) => {
    const it = list[i]; m.visible = !!it; if (!it) return;
    const [n, q] = it, c = n.ring ? net.ringCenter(n.ring) : [n.x, n.z], r = 10 + Math.min(14, q * 1.2);
    m.position.set(c[0], .4, c[1]); m.scale.set(r, 1, r); m.material.opacity = (.16 + .14 * Math.sin(t * 5)) * Math.min(1, q / 6);
  });
}
// day and night. Night is a soft moonlit blue (never black) so the city stays readable;
// lit windows and street lights still come on. With night switched off the sun never sets.
// The sun rises in the east (+x), passes to the south (+z) at noon and sets in the west.
let nightOn = localStorage.getItem('flowtown.night') !== '0';
const MOON = new THREE.Color(.72, .8, 1), HEMI_NIGHT = new THREE.Color(.55, .64, .92);
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
function lighting(hour, t = performance.now() / 1000) {
  if (!nightOn) hour = 6.6 + ((hour - 6.6 + 24) % 24) * (11 / 24);
  const e = Math.sin((hour - 6) / 12 * Math.PI), az = (hour - 6) / 12 * Math.PI;
  const night = Math.min(1, Math.max(0, (.12 - e) / .3)), dark = night * .6;
  U.uNight.value = night;
  const el = Math.asin(e) * .78, hx = Math.cos(az), hz = Math.sin(az) * .55, hl = Math.hypot(hx, hz);
  sunDir.set(hx / hl * Math.cos(el), Math.sin(el), hz / hl * Math.cos(el));
  moonDir.set(-sunDir.x * .7, Math.max(.42, -sunDir.y), -sunDir.z * .7 - .25).normalize();
  const sunUp = Math.max(0, e);
  // the weather changes from day to day: clear, a few clouds, partly cloudy (it blends across the day)
  const dayF = S ? S.time / DAY : 0, wh = d => { const v = Math.sin(Math.floor(d) * 12.9898 + ((S && S.seed) || 0) * .0137) * 43758.5453; return v - Math.floor(v); };
  const f = dayF - Math.floor(dayF), cover = .12 + .72 * (wh(dayF) * (1 - f) + wh(dayF + 1) * f);
  U.uCover.value = cover; sky.U.uCloud.value = cover;
  sun.intensity = (3.6 * Math.pow(sunUp, .4) * (1 - night)) * (1 - .3 * cover * cover) + .9 * night;
  const warm = 1 - Math.min(1, sunUp * 2.2);
  sun.color.setRGB(1, .92 - warm * .26, .82 - warm * .48).lerp(MOON, night);
  // shadows: never from a sun lower than ~10 degrees (endless shadows); the moon at night
  if (night > .5) lightDir.copy(moonDir); else lightDir.set(sunDir.x, Math.max(.18, sunDir.y), sunDir.z).normalize();
  sun.position.set(cam.x + lightDir.x * 700, lightDir.y * 700, cam.z + lightDir.z * 700);
  sun.target.position.set(cam.x, 0, cam.z);
  const S2 = Math.max(160, Math.min(900, cam.dist * 1.1)), sc = sun.shadow.camera;
  if (sc.right !== S2) { sc.left = -S2; sc.right = S2; sc.top = S2; sc.bottom = -S2; sc.near = 10; sc.far = 2400; sc.updateProjectionMatrix(); }
  hemi.intensity = (.3 + .12 * cover) * (1 - night) + .5 * night; hemi.color.setRGB(.87, .91, 1).lerp(HEMI_NIGHT, night);
  sky.update(sunDir, moonDir, night, t, camera.position, camera.far);
  sky.horizon(cam.x - camera.position.x, cam.z - camera.position.z, scene.fog.color);
  sky.env(scene);
  U.uTime.value = t; U.uCloudSh.value = Math.max(0, 1 - night * 1.6) * Math.min(1, sunUp * 4) * Math.min(1, .45 + .8 * cover);
  renderer.toneMappingExposure = 1;
  lampGlowMat.color.setRGB(.25 + night * .9, .22 + night * .75, .18 + night * .5);
  poolMat.opacity = night * .4;
  if (sceneryG && sceneryG.userData.signMat) sceneryG.userData.signMat.emissiveIntensity = night * .5;
  if (sceneryG && sceneryG.userData.wires) sceneryG.userData.wires.visible = cam.dist < 190;
  beamMat.opacity = night * .5;
  for (const m of [M.asphalt, M.walk, M.curb, M.building, M.roof, M.bits, M.leaf, M.trunk, M.lot, M.park, M.lawn, M.shrub, groundMat, pedMat]) if (m) m.envMapIntensity = .8 * (1 - dark * .5);
  if (M.car) M.car.envMapIntensity = 1.2 - dark * .5;
  return night;
}
// the clock runs three times faster late at night (little traffic, nothing to wait for)
const clockRate = h => (h >= 21.5 || h < 5) ? 3 : 1;

// ---------------- emergencies on screen: flashing lights on the road, smoke and fire at wrecks, tempers ----------------
const flashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolMat.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 64);
flashMesh.count = 0; flashMesh.frustumCulled = false; flashMesh.renderOrder = 2; scene.add(flashMesh); flashMesh.setColorAt(0, new THREE.Color());
// smoke: soft grey puffs rising (normal blending); flames: additive orange
const PUFFS = 400, puffPos = new Float32Array(PUFFS * 3), puffVel = new Float32Array(PUFFS * 3), puffLife = new Float32Array(PUFFS), puffCol = new Float32Array(PUFFS * 3);
const puffGeo = new THREE.BufferGeometry(); puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3)); puffGeo.setAttribute('color', new THREE.BufferAttribute(puffCol, 3));
const puffs = new THREE.Points(puffGeo, new THREE.PointsMaterial({ size: 4, map: dotTex, vertexColors: true, transparent: true, opacity: .55, depthWrite: false }));
puffs.frustumCulled = false; scene.add(puffs);
let puffI = 0;
function puff(x, y, z, grey, up = 2.2, spread = .8) {
  const k = puffI++ % PUFFS; puffPos.set([x + (Math.random() - .5) * spread, y, z + (Math.random() - .5) * spread], k * 3);
  puffVel.set([(Math.random() - .5) * .8 + .5, up + Math.random() * 1.5, (Math.random() - .5) * .8 + .2], k * 3); puffLife[k] = 3 + Math.random() * 2; puffCol.set([grey, grey, grey * 1.02], k * 3);
}
let puffT = 0;
function updateFx(dt, t) {
  // red and blue light washing over the road round each emergency vehicle
  let n = 0;
  for (const [x, z, id] of flashes) {
    if (n >= 62) break; const ph = (t * 2.7 + id * .37) % 1 < .5;
    dummy.position.set(x, .22, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(16, 1, 16); dummy.updateMatrix(); flashMesh.setMatrixAt(n, dummy.matrix);
    flashMesh.setColorAt(n, ph ? col.setRGB(.9, .08, .05) : col.setRGB(.1, .25, 1)); n++;
  }
  flashMesh.count = n; flashMesh.instanceMatrix.needsUpdate = true; if (flashMesh.instanceColor) flashMesh.instanceColor.needsUpdate = true;
  flashMesh.material.opacity = .35 + U.uNight.value * .5;
  // wrecks steam, fires burn
  puffT += dt;
  if (puffT > .08) {
    puffT = 0;
    for (const inc of law.inc) for (const c of inc.cars) if (c.crashed && Math.random() < .5) puff(c.x + c.hx * c.len * .4, 1, c.z + c.hz * c.len * .4, .78, 1.2, .5);
    for (const f of law.fires) { puff(f.x, 1.5, f.z, .16, 3.4, 1.2); puff(f.x, 1.5, f.z, .22, 3.0, 1.6); burst(f.x, f.z, 2, [1, .45, .08], 1.2); }
  }
  for (let k = 0; k < PUFFS; k++) {
    if (puffLife[k] <= 0) { puffPos[k * 3 + 1] = -100; continue; }
    puffLife[k] -= dt; for (let j = 0; j < 3; j++) puffPos[k * 3 + j] += puffVel[k * 3 + j] * dt; puffVel[k * 3 + 1] *= .995;
  }
  puffGeo.attributes.position.needsUpdate = true; puffGeo.attributes.color.needsUpdate = true;
  puffs.material.size = Math.max(3, Math.min(14, cam.dist / 40));
  // tempers: a sign over the car of the driver who lost it
  let r = 0;
  for (const q of law.rage) {
    if (r >= 16) break; const c = q.car, sc = Math.max(2.4, Math.min(9, cam.dist * .02)), y = 3.2 + sc * .5 + Math.sin(t * 9) * .15;
    dummy.position.set(c.x, y, c.z); dummy.quaternion.copy(camera.quaternion); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); rageMesh.setMatrixAt(r++, dummy.matrix);
  }
  dummy.quaternion.identity(); rageMesh.count = r; rageMesh.instanceMatrix.needsUpdate = true;
}
// a red sign with a raised hand
const rageTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f6f6f1'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.fillStyle = '#c9221b'; g.beginPath(); g.arc(64, 64, 55, 0, 7); g.fill();
  g.fillStyle = '#f6f6f1'; const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.fill(); };
  rr(38, 62, 52, 38, 10); rr(57, 22, 15, 50, 7); rr(42, 54, 13, 20, 6); rr(73, 54, 13, 20, 6); rr(84, 58, 12, 18, 6); rr(30, 70, 14, 14, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const rageMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: rageTex, transparent: true, alphaTest: .5, toneMapped: false }), 16);
rageMesh.count = 0; rageMesh.frustumCulled = false; rageMesh.renderOrder = 7; scene.add(rageMesh);
// the police scanner: the latest calls, tap one to go there
function scanPush(f) {
  const L = $('scanList'), row = document.createElement('div'); row.className = 'srow c' + f.code.replace(/[^A-Z0-9]/g, '');
  row.innerHTML = `<b>${esc(f.code)}</b><span>${esc(f.txt)}</span>`;
  row.onclick = () => { flyTo({ x: f.x, z: f.z, dist: Math.min(cam.dist, 130) }, 1); if (f.pid && life.person(f.pid)) { select({ k: 'p', id: f.pid }); } else if (f.bid) select({ k: 'b', id: f.bid }); };
  L.prepend(row); while (L.children.length > 5) L.lastChild.remove();
  if (scanOff) { $('scanBtn').classList.add('show', 'ping'); return; }   // closed: just a dot on the radio button
  $('scan').classList.add('show', 'fresh'); $('scan').classList.remove('ping'); void $('scan').offsetWidth; $('scan').classList.add('ping');
  clearTimeout(scanPush.h); scanPush.h = setTimeout(() => $('scan').classList.remove('fresh'), 9000);   // (on a phone it folds away to its header after a while)
}
let scanOff = localStorage.getItem('flowtown.scan') === '0';
$('scan').querySelector('.sh').onclick = e => { if (!e.target.closest('#scanX')) $('scan').classList.toggle('fresh'); };
$('scanX').onclick = e => { e.stopPropagation(); scanOff = true; localStorage.setItem('flowtown.scan', '0'); $('scan').classList.remove('show'); $('scanBtn').classList.add('show'); $('scanBtn').classList.remove('ping'); };
$('scanBtn').onclick = () => { scanOff = false; localStorage.setItem('flowtown.scan', '1'); $('scanBtn').classList.remove('show', 'ping'); if ($('scanList').children.length) $('scan').classList.add('show', 'fresh'); };
if (scanOff) $('scanBtn').classList.add('show');
// what an officer, firefighter or paramedic is doing right now
function unitDoing(pid) {
  for (const u of law.units) {
    const on = (u.car && u.car.pid === pid && net.cars.includes(u.car)) || (u.state === 'hide' && u.pid === pid);
    if (!on) continue;
    const T = u.task;
    if (u.state === 'hide') return 'Running radar on ' + life.streetName(u.spot.e);
    if (T && T.k === 'chase') return u.state === 'stop' ? 'Traffic stop: writing a ticket' : T.target && T.target.flee ? 'In pursuit: ' + T.target.flee : 'Pulling a car over';
    if (T && T.k === 'scene') return u.state === 'scene' ? (u.kind === 'fire' ? 'Putting out a car fire' : u.kind === 'ems' ? 'Treating the injured' : 'Working a crash') : 'Responding, lights and siren';
    if (T && T.k === 'hide') return 'Heading out on patrol';
    return 'Heading back to the station';
  }
  return null;
}

// ---------------- sound (made in code) ----------------
const sound = (() => {
  let ctx = null, on = localStorage.getItem('flowtown.sound') !== '0', rumble = null, hornT = 0;
  function start() {
    if (ctx || !on) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    rumble = ctx.createGain(); rumble.gain.value = 0; src.connect(f).connect(rumble).connect(ctx.destination); src.start();
  }
  function tick(dt, cars, jam) {
    if (!ctx || !rumble) return;
    const near = Math.min(1, 220 / cam.dist); rumble.gain.setTargetAtTime(on ? Math.min(.5, .05 + cars / 900) * near : 0, ctx.currentTime, .4);
    hornT -= dt;
    if (on && jam > .1 && hornT < 0 && near > .3) { hornT = 2 + Math.random() * 8 / (jam * 4); horn(near); }
  }
  function horn(v) {
    const t = ctx.currentTime, g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null, f0 = 360 + Math.random() * 120;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05 * v, t + .02); const L = .15 + Math.random() * .35; g.gain.setValueAtTime(.05 * v, t + L); g.gain.linearRampToValueAtTime(0, t + L + .05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    for (const fr of [f0, f0 * 1.26]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(bp); o.start(t); o.stop(t + L + .1); }
    if (p) { p.pan.value = Math.random() * 1.6 - .8; bp.connect(g).connect(p).connect(ctx.destination); } else bp.connect(g).connect(ctx.destination);
  }
  function magic() {
    if (!ctx || !on) return; const t = ctx.currentTime;
    [880, 1320, 1760].forEach((fr, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(fr, t + i * .05); o.frequency.exponentialRampToValueAtTime(fr * 1.5, t + i * .05 + .35); g.gain.setValueAtTime(0, t + i * .05); g.gain.linearRampToValueAtTime(.05, t + i * .05 + .02); g.gain.exponentialRampToValueAtTime(.0001, t + i * .05 + .6); o.connect(g).connect(ctx.destination); o.start(t + i * .05); o.stop(t + i * .05 + .7); });
  }
  function coin() {
    if (!ctx || !on) return; const t = ctx.currentTime;
    [1318, 1976].forEach((fr, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = fr; g.gain.setValueAtTime(0, t + i * .07); g.gain.linearRampToValueAtTime(.06, t + i * .07 + .01); g.gain.exponentialRampToValueAtTime(.0001, t + i * .07 + .35); o.connect(g).connect(ctx.destination); o.start(t + i * .07); o.stop(t + i * .07 + .4); });
  }
  // a siren wail (fainter further away) and a car horn
  function siren(x, z) {
    if (!ctx || !on) return; const d = Math.hypot(x - cam.x, z - cam.z), v = Math.min(1, 200 / (cam.dist + d)) * .045; if (v < .004) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    o.type = 'sawtooth'; for (let i = 0; i < 4; i++) { o.frequency.setValueAtTime(620, t + i * .9); o.frequency.linearRampToValueAtTime(1250, t + i * .9 + .45); o.frequency.linearRampToValueAtTime(620, t + i * .9 + .9); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .2); g.gain.setValueAtTime(v, t + 3.2); g.gain.linearRampToValueAtTime(0, t + 3.6);
    o.connect(f).connect(g).connect(ctx.destination); o.start(t); o.stop(t + 3.7);
  }
  function honk(x, z) { if (!ctx || !on) return; const d = Math.hypot(x - cam.x, z - cam.z), v = Math.min(1, 160 / (cam.dist + d)); if (v > .25) horn(v * 1.4); }
  function toggle() { on = !on; localStorage.setItem('flowtown.sound', on ? '1' : '0'); if (on) start(); return on; }
  return { start, tick, magic, coin, siren, honk, toggle, get on() { return on; } };
})();

// ---------------- menus ----------------
// screens: the title (the city slowly circling behind it), pause, settings, credits
let settingsFrom = null;
const show = (id, v) => $(id).classList.toggle('show', v);
function showMenu(v) { show('menu', v); if (v) { S.menuSpeed = S.speed; setSpeed(0); } else setSpeed(S.menuSpeed || 1); }
$('menuBtn').onclick = () => showMenu(true);
$('closeBtn').onclick = () => showMenu(false);
$('menuSetBtn').onclick = () => { show('menu', false); settingsFrom = 'menu'; show('settings', true); };
$('setBtn').onclick = () => { settingsFrom = null; show('settings', true); };
$('setBack').onclick = () => { show('settings', false); if (settingsFrom) show(settingsFrom, true); };
$('credBtn').onclick = () => show('credits', true);
$('credBack').onclick = () => show('credits', false);
$('quitBtn').onclick = () => { save(); show('menu', false); toTitle(); };
const soundTxt = () => { $('soundBtn').textContent = sound.on ? 'Sound on' : 'Sound off'; $('soundBtn').classList.toggle('on', sound.on); };
const nightTxt = () => { $('nightBtn').textContent = nightOn ? 'Night on' : 'Night off'; $('nightBtn').classList.toggle('on', nightOn); };
soundTxt(); nightTxt();
$('nightBtn').onclick = () => { nightOn = !nightOn; localStorage.setItem('flowtown.night', nightOn ? '1' : '0'); nightTxt(); };
$('soundBtn').onclick = () => { sound.toggle(); soundTxt(); };
for (const b of document.querySelectorAll('#qRow button')) { b.classList.toggle('on', b.dataset.q === qName); b.onclick = () => { localStorage.setItem(QKEY, b.dataset.q); save(); location.reload(); }; }
$('resetBtn').onclick = () => { if (confirm('Start a brand new city? This one will be lost.')) { show('settings', false); show('menu', false); newCity(); if (titleUp) play(); } };
const HOME_CAM = { x: 0, z: 40, dist: 300, yaw: .55, pitch: .72 };
function newCity(seed) { localStorage.removeItem(SAVE); fresh(seed); select(null); seenNet = seenCity = -1; Object.assign(cam, HOME_CAM); placeCamera(); setSpeed(titleUp ? 0 : 1); setTool(''); }
let hadSave = !!localStorage.getItem(SAVE);
function titleButtons() {
  $('playBtn').querySelector('span').textContent = hadSave ? 'Continue' : 'Start';
  $('newBtn').style.display = hadSave ? '' : 'none';
  $('titlePop').textContent = 'POP ' + (life ? life.people.size.toLocaleString('en-US') : 0);
}
// the title: the camera circles the town; leaving it flies down to where you were
let orbit = 0;
function toTitle() {
  titleUp = true; hadSave = !!localStorage.getItem(SAVE); titleButtons(); setTool('');
  S.titleSpeed = S.speed || S.lastSpeed || 1; setSpeed(0);
  document.body.classList.add('titleUp'); $('title').classList.remove('leaving'); show('title', true);
  fly = zoomTo = coast = null; orbit = 0;
}
function play() {
  if (!titleUp) return;
  titleUp = false; sound.start();
  $('title').classList.add('leaving');
  const goal = S.cam ? { x: S.cam[0], z: S.cam[1], dist: S.cam[2], yaw: S.cam[3], pitch: S.cam[4] } : HOME_CAM;
  flyTo(goal, 1.6);
  setTimeout(() => { show('title', false); document.body.classList.remove('titleUp'); }, 650);
  setSpeed(S.titleSpeed || S.speed || 1);
}
$('playBtn').onclick = () => play();
$('newBtn').onclick = () => { if (confirm('Start a brand new city? This one will be lost.')) { newCity(); S.cam = null; play(); } };
function titleCam(dt) {   // a slow circle round the middle of town, low enough to see the streets
  orbit += dt;
  const b = city.bounds(), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  cam.x = cx + Math.sin(orbit * .05) * 40; cam.z = cz + Math.cos(orbit * .05) * 40; cam.yaw += dt * .045;
  cam.dist = 260 + Math.sin(orbit * .07) * 40; cam.pitch = .5 + Math.sin(orbit * .09) * .06; placeCamera();
}

// ---------------- boot ----------------
if (!(hadSave && load())) fresh();
if (S.cam) [cam.x, cam.z, cam.dist, cam.yaw, cam.pitch] = S.cam;
placeCamera(); setTool(''); S.view = false;
const startSpeed = S.speed || 1; setSpeed(0); S.lastSpeed = startSpeed; S.titleSpeed = startSpeed;
titleButtons();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
setInterval(() => { if (!titleUp) save(); }, 10000);
// loading: textures and fonts first, then a couple of frames, then the title fades in (nothing pops in half-drawn)
{
  let total = 1, done = 0, frames = 0, ready = false;
  const bar = $('loadBar').querySelector('i'), upd = () => { bar.style.width = Math.round(100 * Math.min(1, (done + (ready ? 1 : 0)) / (total + 1))) + '%'; };
  THREE.DefaultLoadingManager.onProgress = (u, l, t) => { done = l; total = Math.max(total, t); upd(); };
  const fontsOk = document.fonts ? document.fonts.ready : Promise.resolve();
  const texOk = new Promise(r => { THREE.DefaultLoadingManager.onLoad = r; setTimeout(r, 12000); });
  Promise.all([fontsOk, texOk]).then(() => { ready = true; upd(); const wait = () => { if (++frames > 3) { show('title', true); $('boot').classList.add('gone'); setTimeout(() => show('boot', false), 700); } else requestAnimationFrame(wait); }; requestAnimationFrame(wait); });
}

let last = performance.now(), hudT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(.1, (now - last) / 1000); last = now;
  if (titleUp) titleCam(rdt); else { keyMove(rdt); camTick(rdt); }
  if (net.ver !== seenNet) rebuildRoads();
  if (city.ver !== seenCity) rebuildCity();
  const spd = titleUp ? 1 : S.speed;   // the town lives on behind the title
  if (spd && !S.over) { let left = rdt * spd; while (left > 1e-4) { const d = Math.min(.1, left); simStep(d); left -= d; } }
  const hour = (S.time / DAY * 24) % 24, night = lighting(hour);
  drawCars(); updatePeds(rdt * (spd ? Math.min(2, spd) : 0)); drawSignals(); updateSparks(rdt); selTick(rdt); drawCoins(now / 1000); updateFx(rdt * (spd ? 1 : 0), now / 1000);
  ovT += rdt; if (ovT > .5) { ovT = 0; paintOverlay(); }
  drawJams(now / 1000);
  hudT += rdt; if (hudT > .25) { hudT = 0; hud(); }
  sound.tick(rdt, net.cars.length, S.meter);
  cursor.material.opacity = .6 + .3 * Math.sin(now / 180);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// test hooks
window.FT = {
  dbg() { return { tris: renderer.info.render.triangles, calls: renderer.info.render.calls, shadowOn: renderer.shadowMap.enabled, sunCast: sun.castShadow, map: !!sun.shadow.map, ms: sun.shadow.mapSize.x, bg: scene.background && scene.background.isTexture, env: !!scene.environment, cam: sun.shadow.camera.right, sunPos: sun.position.toArray().map(Math.round), q: qName, prog: renderer.info.programs.length }; },
  get net() { return net; }, get scene() { return scene; }, along, toScreen(x, z) { const v = new THREE.Vector3(x, 0, z).project(camera), r = canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, hover(x, z) { T.mouse = [x, z]; hoverUpdate(); }, get T() { return T; }, get city() { return city; }, get S() { return S; }, cam, placeCamera() { fly = zoomTo = coast = null; placeCamera(); }, setTool, click, setSpeed, toggleView,
  step(sec) { for (let t = 0; t < sec; t += .1) simStep(.1); },
  render() { if (net.ver !== seenNet) rebuildRoads(); if (city.ver !== seenCity) rebuildCity(); lighting((S.time / DAY * 24) % 24); drawCars(); updatePeds(.05); drawCoins(1); drawSignals(); paintOverlay(); drawJams(1); renderer.render(scene, camera); },
  setHour(h) { S.time = Math.floor(S.time / DAY) * DAY + h / 24 * DAY; },
  newCity(seed) { newCity(seed); setSpeed(0); },
  pedPos(i) { const w = life.walkers[i]; if (!w) return null; const q = walkPos(w); return [q[0], q[1]]; }, get life() { return life; }, get law() { return law; }, select, onTapWorld, buyLand, doBuild, openPicker, money,
  carPos(i) { const c = net.cars[i]; return c ? [c.x, c.z, c.type] : null; },
};
