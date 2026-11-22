// Flowtown: keep a growing city's traffic moving.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Net, RING_R, ONEWAY_W, WALK_W, LANE_W, along, closestOnPoly, laneOff } from './net.js';
import { createCity, DAY, CHUNK, BLOCK } from './city.js';
import { makeMaterials, buildRoads, buildCity, vehicleGeos, vehicleMaterial, makeFleet, staticCarGeo, carColor, personGeo, lampGeo, signalGeo, hwOf } from './draw.js';

const $ = id => document.getElementById(id);
const SAVE = 'flowtown.save.v1', QKEY = 'flowtown.quality';
const touch = matchMedia('(pointer: coarse)').matches; if (touch) document.body.classList.add('touch');
const QS = {
  high: { pr: 2, shadow: 4096, shadows: 2, treeDetail: 2, peds: 1400, maxCars: 1600 },
  medium: { pr: 1.5, shadow: 2048, shadows: 1, treeDetail: 1, peds: 700, maxCars: 1100 },
  low: { pr: 1, shadow: 0, shadows: 0, treeDetail: 1, peds: 0, maxCars: 700 },
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
const FOG_DAY = new THREE.Color(0xb9c3c9), FOG_NIGHT = new THREE.Color(0x34405c);
scene.fog = new THREE.Fog(FOG_DAY.clone(), 900, 4200);
scene.background = FOG_DAY.clone();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 2, 9000);
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x5b5a4a, .55); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); scene.add(sun); scene.add(sun.target);
sun.castShadow = Q.shadows > 0;
if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); }
sun.shadow.bias = -.0004; sun.shadow.normalBias = .6;
const U = { uNight: { value: 0 } };
const M = makeMaterials(renderer.capabilities.getMaxAnisotropy());
const pmrem = new THREE.PMREMGenerator(renderer);
let envTex = null;
new RGBELoader().load('assets/sky.hdr', t => {
  t.mapping = THREE.EquirectangularReflectionMapping;
  envTex = pmrem.fromEquirectangular(t).texture; scene.environment = envTex; scene.background = t; scene.backgroundBlurriness = .25; t.dispose = t.dispose;
}, undefined, () => {});

// ground
const grassTex = new THREE.TextureLoader().load('assets/grass.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; });
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.anisotropy = 8;
const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: 0xc4bf94 });   // drier Hill Country grass
groundMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGw;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vGw = (modelMatrix * vec4(position, 1.)).xz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGw;\nfloat gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); float a = fract(sin(dot(i, vec2(12.9, 78.2)))*43758.5), b = fract(sin(dot(i+vec2(1,0), vec2(12.9, 78.2)))*43758.5), c = fract(sin(dot(i+vec2(0,1), vec2(12.9, 78.2)))*43758.5), d = fract(sin(dot(i+vec2(1,1), vec2(12.9, 78.2)))*43758.5); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }')
    .replace('#include <map_fragment>', `vec4 g1 = texture2D(map, vGw / 13.); vec4 g2 = texture2D(map, vGw / 47. + .3); float m = gn(vGw / 90.) * .7 + gn(vGw / 23.) * .3;
      diffuseColor *= mix(g1, g2, .45) * vec4(mix(vec3(.92, .95, .8), vec3(1.08, 1.0, .82), m), 1.);`);
};
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true; scene.add(ground);

// ---------------- world ----------------
let net, city, S;          // S = game state
let roadsG = null, cityG = null, sigG = null, lampsG = null, overlay = null;
const VG = vehicleGeos(), carMat = vehicleMaterial(U); M.car = carMat;
const parkedGeo = staticCarGeo(VG);
let fleet = makeFleet(VG, carMat, Q.maxCars + 50); for (const m of Object.values(fleet)) scene.add(m);
const personMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
let pedMesh = new THREE.InstancedMesh(personGeo(), personMat, Math.max(1, Q.peds)); pedMesh.count = 0; pedMesh.frustumCulled = false; pedMesh.castShadow = Q.shadows > 1; scene.add(pedMesh);
pedMesh.setColorAt(0, new THREE.Color(1, 1, 1));

function fresh(seed = (Math.random() * 1e6) | 0) {
  net = new Net(); city = createCity(net, seed);
  for (let i = 0; i < 3; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
  city.sync();
  S = { time: DAY * 7 / 24, meter: 0, growT: 0, districts: 3, speed: 1, over: false, flow: 1, cam: null, seed };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE)); if (!d || d.v !== 1) return false;
    net = new Net(); net.load(d.net); city = createCity(net, d.city.seed); city.load(d.city); city.sync();
    S = Object.assign({ speed: 1, over: false, flow: 1 }, d.s); S.over = false; return true;
  } catch (e) { console.warn('save unreadable', e); return false; }
}
function save() { if (!net || S.over) return; try { localStorage.setItem(SAVE, JSON.stringify({ v: 1, net: net.serialize(), city: city.serialize(), s: { time: S.time, meter: S.meter, growT: S.growT, districts: S.districts, seed: S.seed, speed: S.speed, cam: [cam.x, cam.z, cam.dist, cam.yaw, cam.pitch] } })); } catch (e) { /* storage full: keep playing */ } }

// ---------------- camera ----------------
const cam = { x: 0, z: 40, dist: 420, yaw: .35, pitch: .82 };
function placeCamera() {
  cam.pitch = Math.max(.32, Math.min(1.5, cam.pitch)); cam.dist = Math.max(28, Math.min(1500, cam.dist));
  if (city) { const b = city.bounds(); cam.x = Math.max(b.x0 - 300, Math.min(b.x1 + 300, cam.x)); cam.z = Math.max(b.z0 - 300, Math.min(b.z1 + 300, cam.z)); }
  const cp = Math.cos(cam.pitch);
  camera.position.set(cam.x + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(cam.x, 0, cam.z);
  scene.fog.near = 500 + cam.dist * .8; scene.fog.far = 2600 + cam.dist * 2.4;
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
    glowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.3, .06, .62), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), L.length);
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
  // traffic lights
  disposeGroup(sigG); sigG = new THREE.Group(); sigLamps = [];
  const heads = [];
  for (const n of net.nodes.values()) if (n.sig) for (const L of n.ins) {
    if (L.li || L.pk) continue;     // one pole per road, at the kerb
    const p = along(L.pts, L.cum, L.len), h = [p[2], p[3]], r = [-h[1], h[0]], hw = hwOf(L.edge);
    const off = hw - laneOff(L.edge, 0) + .9;
    const px = p[0] + r[0] * off + h[0] * .4, pz = p[1] + r[1] * off + h[1] * .4, th = Math.atan2(-h[1], h[0]);
    heads.push([px, pz, th]);
    // lamps on the face looking back at drivers: local (-.19, y, -2.9)
    const lx = -.2, lz = -2.9, c = Math.cos(th), s = Math.sin(th);
    const wx = px + lx * c + lz * s, wz = pz - lx * s + lz * c;
    sigLamps.push({ n, L, x: wx, z: wz });
  }
  if (heads.length) {
    const hm = new THREE.InstancedMesh(signalGeo(), M.pole, heads.length); hm.castShadow = true;
    heads.forEach((q, i) => { dummy.position.set(q[0], 0, q[1]); dummy.rotation.set(0, q[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); hm.setMatrixAt(i, dummy.matrix); });
    lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.15, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), sigLamps.length * 3);
    sigLamps.forEach((q, i) => { [5.2, 4.85, 4.5].forEach((y, k) => { dummy.position.set(q.x, y, q.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); lampMesh.setMatrixAt(i * 3 + k, dummy.matrix); lampMesh.setColorAt(i * 3 + k, col.setRGB(.1, .1, .1)); }); });
    sigG.add(hm, lampMesh);
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
function rebuildCity() {
  disposeGroup(cityG); cityG = buildCity(city, M, U, Q, { car: parkedGeo }, { wild: city.wild() }); scene.add(cityG); seenCity = city.ver;
}

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
  overlay.userData.spans = spans; overlay.visible = S && S.view; overlay.renderOrder = 2; scene.add(overlay);
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
const TOOLS = ['road', 'curve', 'signal', 'ring', 'oneway', 'lanes', 'erase'];
const laneName = (nl, tl) => `${nl} lane${nl > 1 ? 's' : ''}${tl ? ' + turn lanes' : ''}`;
const HINT = touch
  ? { road: 'Hold, then drag to draw a road. Tap to keep going from the pin', curve: 'Hold, then drag to draw. Then drag to bend it', signal: 'Tap a junction for lights', ring: 'Tap a junction or road for a roundabout', oneway: 'Tap a road to switch its direction', lanes: 'Tap a road for more lanes', erase: 'Tap a road or roundabout to remove it' }
  : { road: 'Click to start, click to place. It keeps going from the end', curve: 'Click the start, click the end, then move to bend and click', signal: 'Click a junction for lights', ring: 'Click a junction or road for a roundabout', oneway: 'Click a road to switch its direction', lanes: 'Click a road for more lanes', erase: 'Click a road or roundabout to remove it' };
const T = { tool: '', pts: [], pend: null, bend: null, draw: null, hover: null, mouse: null, plan: null };
function setTool(t) {
  T.tool = T.tool === t ? '' : t; T.pts = []; T.pend = null; T.bend = null; T.draw = null; previewMesh.visible = false; hoverMesh.visible = false; pin.visible = false;
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
  previewMesh.material.color.setRGB(...(plan.reason ? [1, .35, .25] : [.4, .9, 1]));
  cursor.position.set(B[0], .35, B[1]); cursor.visible = true;
  hint(plan.reason);
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
    ribbon(hoverMesh, h.e.pts, hwOf({ ...h.e, nl, tl }) + .6); hint(`${touch ? 'Tap' : 'Click'} for ${laneName(nl, tl)}`); $('hint').classList.remove('bad');
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
// build a road; on success keep going from its end
function place(a, b, bend) {
  const c = through(a, b, bend), made = net.addRoad(a, b, c, {}, snapR());
  if (made.reason) { toast(made.reason, true); return false; }
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
  if (t === 'erase') {
    if (!h) return;
    if (h.ring) { const c = net.ringCenter(h.ring); net.removeRoundabout(h.ring); afterEdit(null); burst(c[0], c[1], 120, [1, .45, .3], 14); toast('Roundabout removed'); }
    else if (h.e) { const pts = h.e.pts; net.removeEdge(h.e.id); afterEdit(pts, [1, .45, .3]); }
    T.hover = null; return;
  }
  if (t === 'lanes') {
    if (!h) return; const r = net.cycleLanes(h.e.id); if (!r) return;
    afterEdit(net.roadChain(h.e).flatMap(e => e.pts)); toast(laneName(r.nl, r.tl) + (r.lights ? ' · lights added' : '')); hoverUpdate(); return;
  }
  if (t === 'oneway') { if (!h) return; const r = net.cycleOneWay(h.e.id); if (r != null) { afterEdit(h.e.pts); toast(r === 0 ? 'Two-way' : 'One-way'); } return; }
  if (t === 'signal') {
    if (!h) return; if (h.n.ring) return toast('Roundabouts don\'t need lights', true);
    const r = net.toggleSignal(h.n.id); afterEdit(null); burst(h.n.x, h.n.z, 70, r ? [.4, 1, .5] : [1, .45, .3], 8); toast(r ? 'Lights on' : 'Lights off'); return;
  }
  if (t === 'ring') {
    if (!h) return; if (h.bad) return toast(h.bad, true);
    const r = h.n ? net.makeRoundabout(h.n.id) : net.roundaboutOnRoad(h.e, h.s);
    if (typeof r !== 'number') return toast(r, true);
    const c = net.ringCenter(r); afterEdit(null); burst(c[0], c[1], 160, [.5, .95, 1], 18); toast('Roundabout built'); hoverUpdate();
  }
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
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, g0: groundAt((a.x + b.x) / 2, (a.y + b.y) / 2) }; }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (e.pointerType === 'mouse' && (!drag || drag.moved < 8)) { T.mouse = groundAt(e.clientX, e.clientY); hoverUpdate(); }
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    cam.dist *= pinch.d / Math.max(10, d); cam.yaw -= ang - pinch.ang; pinch.d = d; pinch.ang = ang;
    const my = (a.y + b.y) / 2; cam.pitch += (my - pinch.my) * .004; pinch.my = my;
    placeCamera(); const g = groundAt((a.x + b.x) / 2, (a.y + b.y) / 2); if (g && pinch.g0) { cam.x += pinch.g0[0] - g[0]; cam.z += pinch.g0[1] - g[1]; placeCamera(); }
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
  if (drag.moved > 6 && drag.g0) { const g = groundAt(e.clientX, e.clientY); if (g) { cam.x += drag.g0[0] - g[0]; cam.z += drag.g0[1] - g[1]; placeCamera(); } }
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
  if (drag.btn === 0 && drag.moved < 10 && g) { click(g[0], g[1]); if (e.pointerType === 'mouse') { T.mouse = g; hoverUpdate(); } }
  drag = null;
}
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', () => { if (!ptrs.size) { T.mouse = null; cursor.visible = false; } });
canvas.addEventListener('wheel', e => {
  e.preventDefault(); const g0 = groundAt(e.clientX, e.clientY);
  const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY * .0012))); cam.dist *= f; placeCamera();
  const g1 = groundAt(e.clientX, e.clientY); if (g0 && g1) { cam.x += g0[0] - g1[0]; cam.z += g0[1] - g1[1]; placeCamera(); }
}, { passive: false });
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  const n = '1234567'.indexOf(e.key); if (n >= 0) setTool(TOOLS[n]);
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
const growInterval = () => Math.max(85, 170 - (S.districts - 3) * 7);
function hud() {
  const h = (S.time / DAY * 24) % 24, day = Math.floor(S.time / DAY) + 1;
  $('clock').textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0');
  $('day').textContent = 'DAY ' + day;
  const { res } = city.totals();
  $('sPop').textContent = fmt(res); $('sCars').textContent = fmt(net.cars.length); $('sFlow').textContent = Math.round(S.flow * 100) + '%';
  const tr = net.stats.ema || 0; $('sTrip').textContent = Math.floor(tr / 60) + ':' + String(Math.floor(tr % 60)).padStart(2, '0');
  const nx = city.nextDistrict();
  $('growTxt').textContent = nx ? 'New district in ' + Math.max(0, Math.ceil((growInterval() - S.growT) / 60 * 24 / DAY * 60)) + ' min' : 'City complete';
  $('growBar').style.width = (nx ? Math.min(100, S.growT / growInterval() * 100) : 100) + '%';
  $('jamPct').textContent = Math.round(S.meter * 100) + '%';
  $('jamBar').querySelector('i').style.width = (S.meter * 100) + '%';
  $('jamBar').className = S.meter > .7 ? 'bad' : S.meter > .4 ? 'warn' : '';
}

// ---------------- simulation tick ----------------
let jamT = 0, ovT = 0, lastGave = 0;
function simStep(dt) {
  S.time += dt * clockRate((S.time / DAY * 24) % 24);
  const hour = (S.time / DAY * 24) % 24;
  city.demand(dt, hour);
  city.release(dt, Q.maxCars);
  net.step(dt);
  // the city keeps growing
  S.growT += dt;
  if (S.growT >= growInterval()) {
    S.growT = 0; const d = city.nextDistrict();
    if (d) { city.unlock(d[0], d[1]); S.districts++; city.sync(); toast('A new district opened'); const x = (d[0] * CHUNK) * BLOCK, z = (d[1] * CHUNK) * BLOCK; burst(x, z, 200, [.5, .95, 1], 120); }
  }
  // empty land along streets fills back in (new buildings show up together every few seconds)
  if (city.regrow(dt)) save();
  // gridlock meter
  jamT += dt;
  if (jamT >= .5) {
    let stuck = 0, flow = 0; for (const c of net.cars) { if (c.stuck > 25) stuck++; flow += Math.min(1, c.v / (c.lane.vmax * .8)); }
    const n = net.cars.length, jam = stuck / Math.max(40, n);
    S.flow += ((n ? flow / n : 1) - S.flow) * .1;
    const gave = net.stats.gaveUp - lastGave; lastGave = net.stats.gaveUp;
    S.meter = Math.max(0, Math.min(1, S.meter + (jam - .1) * jamT / 45 + gave * .006));
    jamT = 0;
    if (S.meter >= 1 && !S.over) gameOver();
  }
}
function gameOver() {
  S.over = true; setSpeed(0);
  const { res } = city.totals(), day = Math.floor(S.time / DAY) + 1;
  $('overTxt').innerHTML = `Day <b>${day}</b> · <b>${fmt(res)}</b> people · <b>${S.districts}</b> districts<br><b>${fmt(net.stats.arrived)}</b> trips made, <b>${fmt(net.stats.gaveUp)}</b> drivers gave up`;
  $('over').classList.add('show'); localStorage.removeItem(SAVE);
}
$('goOnBtn').onclick = () => { S.over = false; S.meter = .55; $('over').classList.remove('show'); setSpeed(1); };
$('overNewBtn').onclick = () => { $('over').classList.remove('show'); newCity(); };

// ---------------- per frame drawing ----------------
const kinds = Object.keys(fleet);
function drawCars() {
  const cnt = {}; for (const k of kinds) cnt[k] = 0;
  for (const c of net.cars) {
    const m = fleet[c.type], i = cnt[c.type]++; if (i >= m.instanceMatrix.count) continue;
    dummy.position.set(c.x, 0, c.z); dummy.rotation.set(0, Math.atan2(-c.hz, c.hx), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, c.type === 'bus' ? col.setRGB(.85, .55, .1) : c.type === 'truck' ? carColor((c.color * 3) % 1, col) : carColor(c.color, col));
    m.geometry.attributes.aBrake.array[i] = c.brake;
  }
  for (const k of kinds) { const m = fleet[k]; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.geometry.attributes.aBrake.needsUpdate = true; }
}
// people on the sidewalks
let peds = [];
function edgeList() { return [...net.edges.values()].filter(e => !e.ring && e.len > 20); }
function updatePeds(dt, night) {
  const want = Math.min(Q.peds, Math.round(city.totals().res / 9));
  if (peds.length !== want) { const E = edgeList(); while (peds.length < want && E.length) peds.push(newPed(E)); peds.length = Math.min(peds.length, want); }
  let n = 0; const show = 1 - night * .7;
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i]; let e = net.edges.get(p.e);
    if (!e) { peds[i] = newPed(edgeList()); continue; }
    p.s += p.v * p.dir * dt;
    if (p.s < 0 || p.s > e.len) {   // walk on round the corner
      const nid = p.s < 0 ? e.a : e.b, node = net.nodes.get(nid);
      const opts = node ? [...node.edges].map(id => net.edges.get(id)).filter(f => f && !f.ring && f.id !== e.id) : [];
      if (opts.length) { const f = opts[(Math.random() * opts.length) | 0]; p.e = f.id; p.dir = f.a === nid ? 1 : -1; p.s = p.dir > 0 ? node.trim + 1 : f.len - node.trim - 1; e = f; }
      else { p.dir *= -1; p.s = Math.max(0, Math.min(e.len, p.s)); }
    }
    if (i / peds.length > show) continue;
    const q = along(e.pts, e.cum, p.s), o = hwOf(e) + p.o;
    const x = q[0] - q[3] * o * p.side, z = q[1] + q[2] * o * p.side;
    dummy.position.set(x, .16 + Math.abs(Math.sin(p.ph += dt * 7.5)) * .05, z); dummy.rotation.set(0, Math.atan2(-q[3] * p.dir, q[2] * p.dir) + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    pedMesh.setMatrixAt(n, dummy.matrix); pedMesh.setColorAt(n, col.setRGB(p.c[0], p.c[1], p.c[2], THREE.SRGBColorSpace)); n++;
  }
  pedMesh.count = n; pedMesh.instanceMatrix.needsUpdate = true; if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
}
const CLOTH = [[.15, .17, .22], [.8, .8, .78], [.5, .1, .1], [.18, .3, .45], [.25, .25, .25], [.55, .45, .3], [.3, .4, .3], [.85, .6, .2], [.1, .1, .12]];
function newPed(E) {
  const e = E[(Math.random() * E.length) | 0]; if (!e) return { e: -1, s: 0, v: 1.3, dir: 1, side: 1, o: 1.5, ph: 0, c: CLOTH[0] };
  return { e: e.id, s: Math.random() * e.len, v: 1.1 + Math.random() * .6, dir: Math.random() < .5 ? 1 : -1, side: Math.random() < .5 ? 1 : -1, o: .8 + Math.random() * 1.6, ph: Math.random() * 6, c: CLOTH[(Math.random() * CLOTH.length) | 0] };
}
function drawSignals() {
  if (!lampMesh) return;
  sigLamps.forEach((q, i) => {
    const st = net.sigState(q.n, q.L);
    lampMesh.setColorAt(i * 3, st === 'r' ? col.setRGB(1, .12, .06) : col.setRGB(.14, .03, .03));
    lampMesh.setColorAt(i * 3 + 1, st === 'y' ? col.setRGB(1, .7, .08) : col.setRGB(.13, .1, .02));
    lampMesh.setColorAt(i * 3 + 2, st === 'g' ? col.setRGB(.15, 1, .45) : col.setRGB(.02, .1, .05));
  });
  lampMesh.instanceColor.needsUpdate = true;
}
function drawJams(t) {
  const list = [];
  for (const n of net.nodes.values()) {
    if (n.edges.size < 3 || !n.ins) continue; let q = 0;
    for (const L of n.ins) for (const c of L.cars) if (c.stuck > 15) q++;
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
let nightOn = localStorage.getItem('flowtown.night') !== '0';
const MOON = new THREE.Color(.72, .8, 1), HEMI_NIGHT = new THREE.Color(.55, .64, .92);
function lighting(hour) {
  if (!nightOn) hour = 6.6 + ((hour - 6.6 + 24) % 24) * (11 / 24);
  const e = Math.sin((hour - 6) / 12 * Math.PI), az = (hour - 6) / 12 * Math.PI;
  const night = Math.min(1, Math.max(0, (.12 - e) / .3)), dark = night * .6;
  U.uNight.value = night;
  const sunUp = Math.max(0, e);
  sun.intensity = 3.6 * Math.pow(sunUp, .4) * (1 - night) + 1.0 * night;
  const warm = 1 - Math.min(1, sunUp * 2.2);
  sun.color.setRGB(1, .92 - warm * .22, .82 - warm * .4).lerp(MOON, night);
  const el = night > .5 ? .75 : Math.max(.18, Math.abs(e));
  const dx = Math.cos(az) * .75, dz = -.45;
  sun.position.set(cam.x + (night > .5 ? -.3 : dx) * 600, 600 * el + 80, cam.z + dz * 600 + Math.sin(az) * 150);
  sun.target.position.set(cam.x, 0, cam.z);
  const S2 = Math.max(160, Math.min(900, cam.dist * 1.1)), sc = sun.shadow.camera;
  if (sc.right !== S2) { sc.left = -S2; sc.right = S2; sc.top = S2; sc.bottom = -S2; sc.near = 10; sc.far = 2400; sc.updateProjectionMatrix(); }
  hemi.intensity = .28 * (1 - night) + .5 * night; hemi.color.setRGB(.87, .91, 1).lerp(HEMI_NIGHT, night);
  scene.fog.color.copy(FOG_DAY).lerp(FOG_NIGHT, night);
  if (scene.background && scene.background.isTexture) scene.backgroundIntensity = 1 - dark;
  else if (scene.background) scene.background.copy(scene.fog.color);
  renderer.toneMappingExposure = 1;
  if (glowMesh) glowMesh.material.color.setRGB(.25 + night * .9, .22 + night * .75, .18 + night * .5);
  poolMat.opacity = night * .4;
  for (const m of [M.asphalt, M.walk, M.curb, M.building, M.roof, M.bits, M.leaf, M.trunk, M.lot, M.park, groundMat, personMat]) if (m) m.envMapIntensity = .5 * (1 - dark * .6);
  if (M.car) M.car.envMapIntensity = 1 - dark * .6;
  return night;
}
// the clock runs three times faster late at night (little traffic, nothing to wait for)
const clockRate = h => (h >= 21.5 || h < 5) ? 3 : 1;

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
  function toggle() { on = !on; localStorage.setItem('flowtown.sound', on ? '1' : '0'); if (on) start(); return on; }
  return { start, tick, magic, toggle, get on() { return on; } };
})();

// ---------------- menus ----------------
function showMenu(v) { $('menu').classList.toggle('show', v); if (v) { S.menuSpeed = S.speed; setSpeed(0); } else setSpeed(S.menuSpeed || 1); }
$('menuBtn').onclick = () => showMenu(true);
$('closeBtn').onclick = () => showMenu(false);
$('soundBtn').textContent = sound.on ? 'Sound on' : 'Sound off';
$('nightBtn').textContent = nightOn ? 'Night on' : 'Night off';
$('nightBtn').onclick = () => { nightOn = !nightOn; localStorage.setItem('flowtown.night', nightOn ? '1' : '0'); $('nightBtn').textContent = nightOn ? 'Night on' : 'Night off'; };
$('soundBtn').onclick = () => { $('soundBtn').textContent = sound.toggle() ? 'Sound on' : 'Sound off'; };
for (const b of document.querySelectorAll('#qRow button')) { b.classList.toggle('on', b.dataset.q === qName); b.onclick = () => { localStorage.setItem(QKEY, b.dataset.q); save(); location.reload(); }; }
$('digBtn').onclick = () => { save(); location.href = 'dig/'; };
$('resetBtn').onclick = () => { if (confirm('Start a brand new city? This one will be lost.')) { showMenu(false); newCity(); } };
function newCity() { localStorage.removeItem(SAVE); fresh(); peds = []; seenNet = seenCity = -1; cam.x = 0; cam.z = 40; cam.dist = 420; cam.yaw = .35; cam.pitch = .82; placeCamera(); setSpeed(1); setTool(''); }
const hadSave = !!localStorage.getItem(SAVE);
if (hadSave) { $('playBtn').textContent = 'Continue'; $('newBtn').style.display = ''; }
$('playBtn').onclick = () => { $('start').classList.remove('show'); sound.start(); setSpeed(S.speed || 1); };
$('newBtn').onclick = () => { $('start').classList.remove('show'); newCity(); sound.start(); };

// ---------------- boot ----------------
if (!(hadSave && load())) fresh();
if (S.cam) [cam.x, cam.z, cam.dist, cam.yaw, cam.pitch] = S.cam;
placeCamera(); setTool(''); S.view = false;
const startSpeed = S.speed || 1; setSpeed(0); S.lastSpeed = startSpeed;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
setInterval(save, 10000);

let last = performance.now(), hudT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(.1, (now - last) / 1000); last = now;
  keyMove(rdt);
  if (net.ver !== seenNet) rebuildRoads();
  if (city.ver !== seenCity) rebuildCity();
  if (S.speed && !S.over) { let left = rdt * S.speed; while (left > 1e-4) { const d = Math.min(.1, left); simStep(d); left -= d; } }
  const hour = (S.time / DAY * 24) % 24, night = lighting(hour);
  drawCars(); updatePeds(rdt * (S.speed ? Math.min(2, S.speed) : 0), night); drawSignals(); updateSparks(rdt);
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
  dbg() { return { shadowOn: renderer.shadowMap.enabled, sunCast: sun.castShadow, map: !!sun.shadow.map, ms: sun.shadow.mapSize.x, bg: scene.background && scene.background.isTexture, env: !!scene.environment, cam: sun.shadow.camera.right, sunPos: sun.position.toArray().map(Math.round), q: qName, prog: renderer.info.programs.length }; },
  get net() { return net; }, along, toScreen(x, z) { const v = new THREE.Vector3(x, 0, z).project(camera), r = canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, hover(x, z) { T.mouse = [x, z]; hoverUpdate(); }, get T() { return T; }, get city() { return city; }, get S() { return S; }, cam, placeCamera, setTool, click, setSpeed, toggleView,
  step(sec) { for (let t = 0; t < sec; t += .1) simStep(.1); },
  render() { if (net.ver !== seenNet) rebuildRoads(); if (city.ver !== seenCity) rebuildCity(); lighting((S.time / DAY * 24) % 24); drawCars(); updatePeds(.05, U.uNight.value); drawSignals(); paintOverlay(); drawJams(1); renderer.render(scene, camera); },
  setHour(h) { S.time = Math.floor(S.time / DAY) * DAY + h / 24 * DAY; },
};
