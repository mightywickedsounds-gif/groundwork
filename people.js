// The crew on foot (Menu: Crew). Beside the machine crew there is a building crew that works near the yard:
//  1. fallers with chainsaws drop the trees around the site (away from it), then strip the branches off the logs;
//  2. a self-loading log truck comes, picks the logs up with its crane and drives them away (several trips if needed);
//  3. the dozer levels a gravel pad (or, if the dozer is busy, the crew rakes it level by hand, slower);
//  4. a flatbed drops off lumber, sheet board and roofing;
//  5. framers carry each piece over and nail it in: concrete piers, sills, joists, floor, wall studs and plates,
//     ladders go up for the ceiling joists, ridge, rafters, roof boards and metal roofing, then the wall boards, door
//     and windows;
//  6. they rake and seed round the building so the grass comes back, and move on to the next site.
// The mechanic (always on duty) drives the service truck out to any machine that's broken down or badly damaged and
// fixes it.
//
// Every piece of every building is plain data (a list built from the building's size), so a site saves as a few numbers
// and a string of which pieces are in.
import * as THREE from 'three';
import { buildPerson, toolMesh } from './models.js?v=8';

export function makePeople(G) {
  const { clamp, angWrap } = G;
  const lerp = (a, b, t) => a + (b - a) * t;
  const scene = G.scene;

  // ------------------------------------------------------------ materials for the buildings
  const MAT = {
    conc: new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: .9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xd9b27a, roughness: .82 }),
    osb: new THREE.MeshStandardMaterial({ color: 0xc79f62, roughness: .9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3e5649, roughness: .45, metalness: .55 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: .6 }),
    door: new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: .7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223441, roughness: .05, metalness: .8 }),
    ladder: new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: .35, metalness: .8 }),
    stake: new THREE.MeshStandardMaterial({ color: 0xd9b27a, roughness: .85 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: .6, side: THREE.DoubleSide }),
  };
  // a little grain in the timber and sheet board, drawn once
  {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(120,80,40,${.05 + Math.random() * .12})`; g.lineWidth = .5 + Math.random() * 1.5; g.beginPath(); const x = Math.random() * 64; g.moveTo(x, 0); g.bezierCurveTo(x + 4, 80, x - 4, 170, x + Math.random() * 6 - 3, 256); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    MAT.wood.map = t;
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 128; const h = cv2.getContext('2d');
    h.fillStyle = '#fff'; h.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 700; i++) { h.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},30,${.15 + Math.random() * .3})`; h.save(); h.translate(Math.random() * 128, Math.random() * 128); h.rotate(Math.random() * 6.28); h.fillRect(-4, -1.5, 5 + Math.random() * 8, 2 + Math.random() * 3); h.restore(); }
    const t2 = new THREE.CanvasTexture(cv2); t2.colorSpace = THREE.SRGBColorSpace; t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
    MAT.osb.map = t2;
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1);

  // ------------------------------------------------------------ the buildings: every piece as data
  const KINDS = {
    cabin: { w: 8, d: 6, h: 2.5, pitch: .5 },
    shed: { w: 5.4, d: 4.2, h: 2.3, pitch: .45 },
    workshop: { w: 10, d: 7.2, h: 3, pitch: .4 },
  };
  const ORDER = ['cabin', 'shed', 'workshop', 'cabin', 'shed', 'workshop', 'cabin', 'shed'];
  const FL = .92;   // floor surface above the pad
  function pieces(kind) {
    const K = KINDS[kind], { w, d, h } = K, L = [], rise = d / 2 * K.pitch, pa = Math.atan(K.pitch);
    const add = (stage, mat, sx, sy, sz, x, y, z, rx = 0, work = 'nail') => L.push({ stage, mat, s: [sx, sy, sz], p: [x, y, z], rx, work });
    const span = (a, b, step) => { const n = Math.max(1, Math.round((b - a) / step)), o = []; for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; };
    // 0 stakes and string lines at the corners
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(0, 'stake', .05, .7, .05, x * (w / 2 + .6), .35, z * (d / 2 + .6), 0, 'set');
    // 1 concrete piers
    const px = span(-w / 2 + .25, w / 2 - .25, 2.4), pz = [-d / 2 + .25, 0, d / 2 - .25];
    for (const z of pz) for (const x of px) add(1, 'conc', .38, .5, .38, x, .2, z, 0, 'pour');
    // 2 sill beams on the piers, in pieces a person can carry
    for (const z of pz) { const n = Math.ceil(w / 4.2); for (let i = 0; i < n; i++) add(2, 'wood', w / n, .2, .15, -w / 2 + (i + .5) * w / n, .55, z); }
    // 3 rim and floor joists
    for (const z of [-d / 2 + .025, d / 2 - .025]) add(3, 'wood', w, .2, .05, 0, .75, z);
    for (const x of span(-w / 2 + .025, w / 2 - .025, .6)) add(3, 'wood', .05, .2, d - .1, x, .75, 0);
    // 4 floor sheets
    const fx = Math.ceil(w / 2.44), fz = Math.ceil(d / 1.22);
    for (let j = 0; j < fz; j++) for (let i = 0; i < fx; i++) { const sx = Math.min(2.44, w - i * 2.44), sz = Math.min(1.22, d - j * 1.22); add(4, 'osb', sx - .01, .022, sz - .01, -w / 2 + i * 2.44 + sx / 2, FL - .011, -d / 2 + j * 1.22 + sz / 2); }
    // 5 walls: bottom plate, studs every 60 cm, openings with headers, double top plate
    const walls = [
      { ax: 'x', len: w, at: -d / 2 + .045, open: [[0, 1.0, 2.1, 0]] },                        // front: the door
      { ax: 'x', len: w, at: d / 2 - .045, open: [[-w / 4, 1.2, 1.1, 1.0], [w / 4, 1.2, 1.1, 1.0]] },
      { ax: 'z', len: d - .18, at: -w / 2 + .045, open: [[0, 1.2, 1.1, 1.0]] },
      { ax: 'z', len: d - .18, at: w / 2 - .045, open: [[0, 1.2, 1.1, 1.0]] },
    ];
    const wallPiece = (stage, mat, wl, along, sAlong, sy, y, work = 'nail', thick = .09) => {
      if (wl.ax === 'x') add(stage, mat, sAlong, sy, thick, along, y, wl.at, 0, work); else add(stage, mat, thick, sy, sAlong, wl.at, y, along, 0, work);
    };
    for (const wl of walls) {
      wallPiece(5, 'wood', wl, 0, wl.len, .04, FL + .02);
      for (const a of span(-wl.len / 2 + .02, wl.len / 2 - .02, .6)) {
        const o = wl.open.find(([c, ow]) => Math.abs(a - c) < ow / 2 + .02);
        if (!o) { wallPiece(5, 'wood', wl, a, .04, h - .12, FL + .04 + (h - .12) / 2); continue; }
        const [, , oh, sill] = o;
        if (sill > 0) wallPiece(5, 'wood', wl, a, .04, sill - .04, FL + .04 + (sill - .04) / 2);           // cripple under a window
        wallPiece(5, 'wood', wl, a, .04, h - .2 - (sill + oh), FL + sill + oh + .12 + (h - .2 - (sill + oh)) / 2 - .04);   // cripple over the header
      }
      for (const [c, ow, oh, sill] of wl.open) {
        wallPiece(5, 'wood', wl, c, ow + .1, .2, FL + sill + oh + .1);                   // header
        for (const s of [-1, 1]) wallPiece(5, 'wood', wl, c + s * (ow / 2 + .02), .04, sill + oh, FL + .04 + (sill + oh) / 2);   // king/jack studs
        if (sill > 0) wallPiece(5, 'wood', wl, c, ow, .04, FL + sill);
      }
      wallPiece(6, 'wood', wl, 0, wl.len, .04, FL + h - .06);
      wallPiece(6, 'wood', wl, 0, wl.len, .04, FL + h - .02);
    }
    // 7 ceiling joists, 8 ridge, rafters and gable studs (from ladders)
    const top = FL + h;
    for (const x of span(-w / 2 + .1, w / 2 - .1, .6)) add(7, 'wood', .05, .15, d, x, top + .075, 0);
    add(8, 'wood', w + .6, .25, .06, 0, top + rise + .1, 0);
    const rl = Math.hypot(d / 2 + .35, rise);
    for (const x of span(-w / 2 + .05, w / 2 - .05, .6)) for (const s of [-1, 1]) add(8, 'wood', .05, .18, rl, x, top + rise / 2 + .05 - .35 * K.pitch / 2, s * (d / 4 - .175 + .175), s * pa);
    for (const s of [-1, 1]) for (const z of span(-d / 2 + .5, d / 2 - .5, .6)) { const gh = rise * (1 - Math.abs(z) / (d / 2)) - .05; if (gh > .15) add(8, 'wood', .04, gh, .09, s * (w / 2 - .045), top + gh / 2, z); }
    // 9 roof boards, 10 metal roofing
    const rows = Math.ceil(rl / 1.22), cols = Math.ceil((w + .6) / 2.44);
    for (const s of [-1, 1]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const sx = Math.min(2.44, w + .6 - c * 2.44), sl = Math.min(1.22, rl - r * 1.22), mid = r * 1.22 + sl / 2;   // mid: distance down the slope from the ridge
      const zz = s * mid * Math.cos(pa), yy = top + rise - mid * Math.sin(pa) + .15;
      add(9, 'osb', sx - .01, .02, sl - .01, -(w + .6) / 2 + c * 2.44 + sx / 2, yy, zz, s * pa);
    }
    for (const s of [-1, 1]) for (const x of span(-(w + .6) / 2 + .45, (w + .6) / 2 - .45, .9)) {
      const mid = rl / 2 + .05;
      add(10, 'roof', .92, .03, rl + .1, x, top + rise - mid * Math.sin(pa) + .19, s * mid * Math.cos(pa), s * pa);
    }
    // 11 wall boards (sheet board on the outside, round the openings), then door and windows
    for (const wl of walls) {
      const o = wl.ax === 'x' ? Math.sign(wl.at) : Math.sign(wl.at), out = wl.at + o * .055;
      for (const a of span(-wl.len / 2 + .61, wl.len / 2 - .61, 1.22)) {
        const op = wl.open.find(([c, ow]) => Math.abs(a - c) < ow / 2 + .55);
        const wlo = { ax: wl.ax, at: out };
        if (!op) { wallPiece(11, 'osb', wlo, a, 1.21, h, FL + h / 2, 'nail', .015); continue; }
        const [, , oh, sill] = op;
        if (sill > 0) wallPiece(11, 'osb', wlo, a, 1.21, sill, FL + sill / 2, 'nail', .015);
        wallPiece(11, 'osb', wlo, a, 1.21, h - sill - oh, FL + sill + oh + (h - sill - oh) / 2, 'nail', .015);
      }
      for (const [c, ow, oh, sill] of wl.open) {
        const wlo = { ax: wl.ax, at: out + o * .01 };
        if (sill === 0) wallPiece(12, 'door', wlo, c, ow - .08, oh - .04, FL + oh / 2, 'set', .05);
        else { wallPiece(12, 'glass', wlo, c, ow - .1, oh - .1, FL + sill + oh / 2, 'set', .02); wallPiece(12, 'trim', { ax: wl.ax, at: out + o * .03 }, c, ow + .12, .08, FL + sill - .02, 'set', .05); }
        wallPiece(12, 'trim', { ax: wl.ax, at: out + o * .03 }, c, ow + .12, .08, FL + sill + oh + .02, 'set', .05);
      }
    }
    // corner boards
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(12, 'trim', .1, h, .1, x * (w / 2 + .03), FL + h / 2, z * (d / 2 + .03), 0, 'set');
    L.sort((a, b) => a.stage - b.stage);   // stable: within a stage the pieces keep their order
    L.forEach((q, i) => { q.i = i; q.high = q.p[1] > FL + 1.85; });
    return L;
  }

  // ------------------------------------------------------------ sites
  const sites = [];
  let cur = null;
  const toW = (S, lx, lz) => [S.x + lx * Math.cos(S.yaw) + lz * Math.sin(S.yaw), S.z - lx * Math.sin(S.yaw) + lz * Math.cos(S.yaw)];
  const toL = (S, x, z) => { const dx = x - S.x, dz = z - S.z; return [dx * Math.cos(S.yaw) - dz * Math.sin(S.yaw), dx * Math.sin(S.yaw) + dz * Math.cos(S.yaw)]; };
  const halfPad = S => [KINDS[S.kind].w / 2 + 2, KINDS[S.kind].d / 2 + 2.5];
  const onPad = (S, x, z, m = 0) => { const [lx, lz] = toL(S, x, z), [hx, hz] = halfPad(S); return Math.abs(lx) < hx + m && Math.abs(lz) < hz + m; };
  const clearR = S => Math.hypot(KINDS[S.kind].w, KINDS[S.kind].d) / 2 + 7;

  // pick a spot in the forest near the yard (or near the last building): fairly flat, dry, a few trees to clear,
  // clear of the yard, roads and other buildings. No random numbers: the same valley picks the same spots.
  function chooseSite() {
    const kind = ORDER[sites.length % ORDER.length], K = KINDS[kind];
    const base = sites.length ? sites[sites.length - 1] : { x: (G.YARD.x0 + G.YARD.x1) / 2, z: (G.YARD.z0 + G.YARD.z1) / 2 };
    let best = null;
    for (let r = 22; r <= 70; r += 6) for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2 + r * .1, x = base.x + Math.cos(ang) * r, z = base.z + Math.sin(ang) * r;
      if (x < 22 || z < 22 || x > 234 || z > 234) continue;
      if (G.inYard(x, z, 14)) continue;
      if (sites.some(s => Math.hypot(s.x - x, s.z - z) < 24)) continue;
      if (G.nearRoad(x, z, 16)) continue;
      const yaw = Math.round(Math.atan2(base.x - x, base.z - z) / (Math.PI / 2)) * (Math.PI / 2);   // face back towards the yard
      let lo = 1e9, hi = -1e9, wet = 0;
      for (let dz = -K.d / 2 - 3; dz <= K.d / 2 + 3; dz += 1.5) for (let dx = -K.w / 2 - 3; dx <= K.w / 2 + 3; dx += 1.5) {
        const h = G.hAt(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      for (let q = 0; q < 16; q++) wet = Math.max(wet, G.wAt(x + Math.cos(q * .39) * 16, z + Math.sin(q * .39) * 16), G.wAt(x + Math.cos(q * .39) * 8, z + Math.sin(q * .39) * 8));
      if (wet > .02 || hi - lo > 2.4) continue;
      const S = { x, z, yaw, kind }, R = clearR(S);
      let n = 0; for (const t of G.trees) if (t.st === 0 && Math.abs(t.x - x) < R && Math.abs(t.z - z) < R && Math.hypot(t.x - x, t.z - z) < R) n++;
      if (n < 2) continue;
      const score = (hi - lo) * 3 + Math.abs(n - 9) * .25 + r / 25;
      if (!best || score < best.score) best = { x, z, yaw, kind, score };
    }
    if (!best) return null;
    const S = { x: +best.x.toFixed(2), z: +best.z.toFixed(2), yaw: best.yaw, kind: best.kind, phase: 'clear', pl: '', grade: 0, t: 0, trips: 0 };
    return S;
  }
  function padLevel(S) {
    const [hx, hz] = halfPad(S); let sum = 0, n = 0;
    for (let lz = -hz; lz <= hz; lz += 1) for (let lx = -hx; lx <= hx; lx += 1) { const [x, z] = toW(S, lx, lz); sum += G.h0At(x, z); n++; }
    return +(sum / n + .05).toFixed(3);
  }
  function siteMeshes(S) {
    if (S.grp) return;
    S.list = pieces(S.kind);
    if (S.pl.length !== S.list.length) S.pl = S.pl.padEnd(S.list.length, '0').slice(0, S.list.length);
    S.state = new Uint8Array(S.list.length); for (let i = 0; i < S.list.length; i++) S.state[i] = S.pl[i] === '1' ? 2 : 0;
    if (S.pad === undefined) S.pad = padLevel(S);
    const grp = new THREE.Group(); grp.position.set(S.x, S.pad, S.z); grp.rotation.y = S.yaw; scene.add(grp); S.grp = grp;
    const counts = {}; for (const q of S.list) counts[q.mat] = (counts[q.mat] || 0) + 1;
    S.ims = {};
    const col = new THREE.Color();
    for (const k in counts) {
      const im = new THREE.InstancedMesh(BOX, MAT[k], counts[k]); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      grp.add(im); S.ims[k] = im; im.userData.n = 0;
    }
    for (const q of S.list) {
      const im = S.ims[q.mat]; q.slot = im.userData.n++;
      if (q.mat === 'wood' || q.mat === 'osb') { const v = .9 + ((q.i * 37) % 17) / 17 * .18; col.setRGB(v, v * .98, v * .95); im.setColorAt(q.slot, col); }
      showPiece(S, q, S.state[q.i] === 2);
    }
    for (const k in S.ims) if (S.ims[k].instanceColor) S.ims[k].instanceColor.needsUpdate = true;
    // material stacks beside the pad, and ladders
    S.stacks = new THREE.Group(); grp.add(S.stacks);
    const K = KINDS[S.kind];
    const stack = (mat, x, z, sx, sy, sz, n, gap) => { for (let i = 0; i < n; i++) { const m = new THREE.Mesh(BOX, MAT[mat]); m.scale.set(sx, sy, sz); m.position.set(x + ((i * 13) % 5 - 2) * .01, .1 + sy / 2 + i * (sy + gap), z); m.castShadow = true; m.receiveShadow = true; S.stacks.add(m); } };
    const sx = -K.w / 2 - 1.2, sz = -K.d / 2 - 2.2;
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(BOX, MAT.wood); m.scale.set(.1, .1, 1.2); m.position.set(sx + .5, .05, sz + (i - 1) * 1.1 + 4); S.stacks.add(m); }
    stack('wood', sx + .5, sz + 4, .9, .045, 3.6, 12, .004);                // lumber
    stack('osb', sx + .5, sz + 1.2, 1.22, .022, 2.44, 16, .002);            // sheet board
    stack('roof', sx + 2.2, sz + .5, .92, .03, 3, 8, .004);                  // roofing
    S.stackAt = toW(S, sx + 1.3, sz + 2.6);
    S.stacks.visible = !!S.delivered && S.phase !== 'done';
    S.ladders = new THREE.Group(); grp.add(S.ladders);
    S.ladderSpots = [];
    for (const [lx, side] of [[-K.w / 4, -1], [K.w / 4, -1], [-K.w / 4, 1], [K.w / 4, 1]]) {
      const lz = side * (K.d / 2 + .75), lad = new THREE.Group();
      const len = K.h + FL + .9, lean = Math.atan2(.7, len);
      for (const s of [-1, 1]) { const r = new THREE.Mesh(BOX, MAT.ladder); r.scale.set(.05, len, .07); r.position.set(s * .22, len / 2, 0); lad.add(r); }
      for (let y = .3; y < len; y += .3) { const r = new THREE.Mesh(BOX, MAT.ladder); r.scale.set(.44, .035, .035); r.position.set(0, y, 0); lad.add(r); }
      lad.position.set(lx, 0, lz); lad.rotation.x = side * lean; lad.traverse(o => { o.castShadow = true; }); S.ladders.add(lad);
      S.ladderSpots.push({ lx, lz: lz + side * .35, side, top: FL + K.h - .9 });
    }
    S.ladders.visible = false;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  function showPiece(S, q, on) {
    const im = S.ims[q.mat];
    if (on) { _q.setFromEuler(_e.set(q.rx, 0, 0)); _m.compose(_v.set(q.p[0], q.p[1], q.p[2]), _q, _s.set(q.s[0], q.s[1], q.s[2])); }
    else _m.makeScale(0, 0, 0);
    im.setMatrixAt(q.slot, _m); im.instanceMatrix.needsUpdate = true;
  }
  function placed(S, q) {
    S.state[q.i] = 2; showPiece(S, q, true);
    S.pl = S.pl.slice(0, q.i) + '1' + S.pl.slice(q.i + 1);
  }
  const stageOpen = (S, st) => { for (const q of S.list) if (q.stage < st && S.state[q.i] !== 2) return false; return true; };
  function claim(S, p) {
    // the next piece whose earlier stages are all in; small pieces close together go in one trip (up to 3)
    let first = null; const got = [];
    for (const q of S.list) {
      if (S.state[q.i] !== 0) continue;
      if (!stageOpen(S, q.stage)) break;
      if (!first) { first = q; got.push(q); continue; }
      if (q.stage !== first.stage || q.high !== first.high || got.length >= (q.mat === 'osb' || q.mat === 'roof' || q.s[2] > 3 || q.s[0] > 3 ? 1 : 3)) break;
      if (Math.hypot(q.p[0] - first.p[0], q.p[2] - first.p[2]) > 2.2) break;
      got.push(q);
    }
    for (const q of got) S.state[q.i] = 1;
    return got;
  }
  const allIn = S => S.list.every(q => S.state[q.i] === 2);

  // ------------------------------------------------------------ people
  const people = [];
  const tools = {};
  function addPerson(role, i) {
    const f = buildPerson(i, role);
    const p = { f, role, x: G.YARD.x0 + 4 + i * 1.3, z: G.YARD.z0 + 3, y: 0, yaw: 0, ph: Math.random() * 6, pose: 'idle', tool: null, task: null, st: '', t: 0, j: new Float32Array(16), id: 900 + i, climb: 0, wait: 0 };
    scene.add(f.root); people.push(p); f.root.visible = false;
    return p;
  }
  function hold(p, kind) {
    if (p.tool === kind) return;
    if (p.toolMesh) { p.toolMesh.parent.remove(p.toolMesh); p.toolMesh = null; }
    p.tool = kind;
    if (!kind) return;
    const m = toolMesh(kind); p.toolMesh = m;
    if (kind === 'toolbox') { p.f.arms[0].hand.add(m); return; }
    p.f.arms[1].hand.add(m);
    if (kind === 'hammer') m.rotation.set(-1.4, 0, 0);
    else if (kind === 'saw') m.rotation.set(-1.25, 0, 0), m.position.set(-.08, -.02, 0);
    else if (kind === 'rake' || kind === 'shovel') m.rotation.set(-1.5, 0, 0), m.position.set(0, 0, -.5);
    else if (kind === 'wrench') m.rotation.set(-1.2, 0, 0);
  }
  function carry(p, q) {   // a piece over the shoulder (sheet board under the arm)
    if (p.carryMesh) { p.f.torso.remove(p.carryMesh); p.carryMesh = null; }
    if (!q) return;
    const m = new THREE.Mesh(BOX, MAT[q.mat === 'conc' ? 'conc' : q.mat === 'glass' ? 'trim' : q.mat]);
    const long = Math.min(3.6, Math.max(q.s[0], q.s[2], q.s[1]));
    if (q.mat === 'osb' || q.mat === 'roof') { m.scale.set(.03, Math.min(1.2, Math.min(q.s[0], q.s[2])), Math.min(2.4, long)); m.position.set(.28, .1, .1); }
    else if (q.mat === 'conc') { m.scale.set(.3, .2, .3); m.position.set(0, .05, .35); }
    else { m.scale.set(.06, .1, long); m.position.set(.2, .58, .25); }
    m.castShadow = true; p.f.torso.add(m); p.carryMesh = m;
  }

  // ------------------------------------------------------------ animation: each pose sets joint targets, joints ease
  // joints: 0 hips height, 1 torso lean, 2 head, 3/4 left shoulder fwd/out, 5 left elbow, 6/7 right shoulder, 8 right elbow,
  // 9/10 left hip/knee, 11/12 right hip/knee
  const T = new Float32Array(16);
  function animate(p, dt) {
    const ph = p.ph; T.fill(0); T[0] = .95; T[5] = -.15; T[8] = -.15; T[4] = -.06; T[7] = .06;
    const walkLegs = (amp, rate = 1) => {
      for (let i = 0; i < 2; i++) {
        const sw = Math.sin(ph * rate + i * Math.PI);
        T[9 + i * 2] = -sw * .48 * amp; T[10 + i * 2] = Math.max(0, Math.sin(ph * rate + i * Math.PI + 1.9)) * .95 * amp;
      }
      T[0] = .95 - .035 * amp + Math.abs(Math.cos(ph * rate)) * .04 * amp;
    };
    switch (p.pose) {
      case 'walk': case 'walkCarry': {
        walkLegs(1);
        if (p.pose === 'walk') { T[3] = Math.sin(ph) * .42; T[6] = Math.sin(ph + Math.PI) * .42; T[5] = -.35; T[8] = -.35; }
        else { T[3] = Math.sin(ph) * .3; T[5] = -.3; T[6] = -2.5; T[7] = .25; T[8] = -1.9; }
        T[1] = .06;
        break;
      }
      case 'hammer': case 'hammerHigh': {
        const c = (ph / (Math.PI * 2)) % 1, strike = c < .7 ? c / .7 : 1 - (c - .7) / .3;   // slow lift, fast blow
        const up = p.pose === 'hammerHigh' ? -.8 : 0;
        T[1] = p.pose === 'hammerHigh' ? -.05 : .35; T[2] = p.pose === 'hammerHigh' ? -.35 : .25;
        T[6] = -1.0 - strike * 1.25 + up; T[8] = -1.4 + strike * .9; T[7] = .15;
        T[3] = -1.1 + up; T[5] = -.7; T[4] = .25;
        if (p.pose === 'hammer') { T[9] = -.35; T[10] = .55; T[11] = -.1; T[12] = .45; T[0] = .87; }
        break;
      }
      case 'saw': {
        const j = Math.sin(ph * 9) * .03;
        T[0] = .78; T[1] = .55 + j; T[2] = .2; T[9] = -.7; T[10] = 1.1; T[11] = -.2; T[12] = .7;
        T[3] = -.9 + j; T[5] = -.6; T[4] = .3; T[6] = -.95 + j; T[8] = -.5; T[7] = -.1;
        break;
      }
      case 'climb': {
        for (let i = 0; i < 2; i++) { const s = Math.sin(ph + i * Math.PI); T[9 + i * 2] = -.9 - s * .45; T[10 + i * 2] = 1.3 + s * .3; T[3 + i * 3] = -2.4 - s * .35; T[5 + i * 3] = -.4; }
        T[1] = -.1; T[2] = -.3;
        break;
      }
      case 'kneel': {
        T[0] = .52; T[1] = .4; T[2] = .3; T[9] = -1.55; T[10] = 1.55; T[11] = .25; T[12] = 1.75;
        const w = Math.sin(ph * 3) * .25; T[6] = -1.2 + w; T[8] = -.7; T[3] = -1.0; T[5] = -.9;
        break;
      }
      case 'rake': case 'shovel': {
        const s = Math.sin(ph * 1.4);
        T[1] = .35 + s * .08; T[0] = .9; T[9] = -.3; T[10] = .3; T[11] = .15; T[12] = .2;
        T[6] = -.8 + s * .4; T[8] = -.5; T[3] = -.6 + s * .4; T[5] = -.7; T[4] = .2;
        break;
      }
      case 'carryStand': { T[6] = -2.5; T[7] = .25; T[8] = -1.9; break; }
      case 'point': { T[6] = -1.5; T[8] = -.05; T[7] = .2; T[2] = -.1; break; }
      default: { T[1] = Math.sin(ph * .4) * .02; T[2] = Math.sin(ph * .23) * .15; }
    }
    const k = 1 - Math.exp(-dt * 10), J = p.j;
    for (let i = 0; i < 13; i++) J[i] += (T[i] - J[i]) * k;
    const f = p.f;
    f.hips.position.y = J[0]; f.torso.rotation.x = J[1]; f.neck.rotation.x = J[2] - J[1] * .5;
    f.arms[0].sh.rotation.set(J[3], 0, J[4]); f.arms[0].el.rotation.x = J[5];
    f.arms[1].sh.rotation.set(J[6], 0, J[7]); f.arms[1].el.rotation.x = J[8];
    f.legs[0].hp.rotation.x = J[9]; f.legs[0].kn.rotation.x = J[10]; f.legs[0].ft.rotation.x = -(J[9] + J[10]) * .6;
    f.legs[1].hp.rotation.x = J[11]; f.legs[1].kn.rotation.x = J[12]; f.legs[1].ft.rotation.x = -(J[11] + J[12]) * .6;
    f.root.position.set(p.x, p.y, p.z); f.root.rotation.y = p.yaw;
  }
  // where a person's feet are: on the floor once it is in, else on the ground
  function standY(p) {
    if (p.climb > 0) return p.climb;
    const S = cur || p.site;
    if (S && S.grp && S.state && S.list) {
      const [lx, lz] = toL(S, p.x, p.z), K = KINDS[S.kind];
      if (Math.abs(lx) < K.w / 2 - .05 && Math.abs(lz) < K.d / 2 - .05 && floorIn(S)) return S.pad + FL;
    }
    return G.hAt(p.x, p.z);
  }
  const floorIn = S => S.floorIn || (S.floorIn = S.list.every(q => q.stage > 4 || S.state[q.i] === 2)) || false;
  // walk towards x, z (true when there)
  function walk(p, x, z, dt, tol = .45, speed = 1.35) {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < tol) return true;
    const want = Math.atan2(dx, dz); p.yaw += clamp(angWrap(want - p.yaw), -dt * 5, dt * 5);
    const turnSlow = Math.abs(angWrap(want - p.yaw)) > 1 ? .3 : 1;
    let st = Math.min(d, speed * turnSlow * dt);
    // stay out of the machines' way: step round anything close
    let ox = Math.sin(p.yaw) * st, oz = Math.cos(p.yaw) * st;
    for (const m of G.machines) {
      const ex = p.x + ox - m.x, ez = p.z + oz - m.z, el = Math.hypot(ex, ez), r = G.SPEC[m.type].len / 2 + .6;
      if (el < r && el > .01) { ox += ex / el * (r - el) * .5; oz += ez / el * (r - el) * .5; }
    }
    p.x += ox; p.z += oz;
    p.ph += dt * speed * turnSlow * 5.2;
    p.pose = p.carryMesh ? 'walkCarry' : 'walk';
    return false;
  }
  const face = (p, x, z, dt) => { p.yaw += clamp(angWrap(Math.atan2(x - p.x, z - p.z) - p.yaw), -dt * 5, dt * 5); };

  // ------------------------------------------------------------ fallers: drop the trees away from the site, then limb them
  function siteTrees(S) {
    const R = clearR(S), out = [];
    G.trees.forEach((t, i) => { if (t.st !== 3 && Math.abs(t.x - S.x) < R + 9 && Math.abs(t.z - S.z) < R + 9 && (t.cut || (t.st === 0 && Math.hypot(t.x - S.x, t.z - S.z) < R))) out.push(i); });
    return out;
  }
  function faller(p, dt, S) {
    const tr = G.trees;
    if (!p.task) {
      // nearest standing tree no one has, else a fallen one to limb
      let best = null, bd = 1e9;
      for (const i of siteTrees(S)) {
        const t = tr[i]; if (t.claim && t.claim !== p) continue;
        const need = t.st === 0 ? 'fell' : t.st === 2 && t.cut && !t.lim ? 'limb' : null; if (!need) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z) + (need === 'limb' ? 6 : 0); if (d < bd) { bd = d; best = { i, need }; }
      }
      if (!best) { p.pose = 'idle'; return true; }
      p.task = best; tr[best.i].claim = p; p.st = 'go'; p.t = 0;
    }
    const t = tr[p.task.i];
    hold(p, 'saw');
    if (p.task.need === 'fell') {
      // stand on the far side so the tree falls into the clearing, where the log truck can reach it
      let ux = t.x - S.x, uz = t.z - S.z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const sx = t.x + ux * .85, sz = t.z + uz * .85;
      if (t.st !== 0 && p.st !== 'clear') { p.st = 'clear'; p.t = 0; }
      if (p.st === 'go') { G.saw(p.id, p.x, p.y + 1, p.z, true, false); if (walk(p, sx, sz, dt)) { p.st = 'cut'; p.t = 0; } return false; }
      if (p.st === 'cut') {
        face(p, t.x, t.z, dt); p.pose = 'saw'; p.ph += dt; p.t += dt;
        G.saw(p.id, p.x, p.y + 1, p.z, true, true);
        if (Math.random() < dt * 14) G.spawn('dust', t.x + ux * .3, t.y + .5, t.z + uz * .3, 1, [.86, .74, .52], { jitter: .3, size: .35, alpha: .7 });
        if (p.t > 5.5) { G.treeFall(t, sx, sz); t.cut = 1; t.sx = t.x; t.sz = t.z; p.st = 'clear'; p.t = 0; }
        return false;
      }
      // step back out of the way while it comes down
      G.saw(p.id, p.x, p.y + 1, p.z, true, false);
      p.t += dt;
      if (p.t < 2.5) walk(p, sx + ux * 2 - uz * 4, sz + uz * 2 + ux * 4, dt, .3, 1.8);   // back and to the side
      else { p.pose = 'idle'; if (p.t > 4.5) { t.claim = null; p.task = null; } }
      return false;
    }
    // limbing: walk along the log cutting the branches off
    if (t.st !== 2) { t.claim = null; p.task = null; return false; }
    const L = G.logLen(t);
    if (p.st === 'go') { G.saw(p.id, p.x, p.y + 1, p.z, true, false); if (walk(p, t.x + t.dx * L * .3 + t.dz * 1, t.z + t.dz * L * .3 - t.dx * 1, dt)) { p.st = 'limb'; p.t = 0; } return false; }
    p.t += dt;
    const u = .3 + clamp(p.t / 6, 0, 1) * .55, tx = t.x + t.dx * L * u + t.dz * 1, tz = t.z + t.dz * L * u - t.dx * 1;
    p.x = lerp(p.x, tx, 1 - Math.exp(-dt * 3)); p.z = lerp(p.z, tz, 1 - Math.exp(-dt * 3));
    face(p, t.x + t.dx * L * u, t.z + t.dz * L * u, dt); p.pose = 'saw'; p.ph += dt;
    G.saw(p.id, p.x, p.y + 1, p.z, true, true);
    if (Math.random() < dt * 6) G.spawn('leaf', t.x + t.dx * L * u, G.hAt(p.x, p.z) + 1, t.z + t.dz * L * u, 2, [.25, .36, .14], { jitter: 1.5 });
    if (p.t > 6) { G.treeLimb(t); t.claim = null; p.task = null; }
    return false;
  }

  // ------------------------------------------------------------ trucks: the log truck, the flatbed, the service truck
  let logTruck = null, flatbed = null, service = null;
  // trucks come in along the way from the yard and leave the same way (they don't fight through the parked machines)
  const exitPoint = S => {
    const Y = G.YARD, yx = (Y.x0 + Y.x1) / 2, yz = (Y.z0 + Y.z1) / 2;
    if (!S) return [yx, Y.z1 - 3];
    const dx = yx - S.x, dz = yz - S.z, l = Math.hypot(dx, dz) || 1, r = clamp(l - 8, 10, 34);
    return [clamp(S.x + dx / l * r, 8, 247), clamp(S.z + dz / l * r, 8, 247)];
  };
  function spawnTruck(type, S) {
    const [ex, ez] = exitPoint(S), yaw = Math.atan2(S.x - ex, S.z - ez), [x, z] = G.freeSpot(type, ex, ez, yaw);
    const m = G.makeMachine(type, x, z, yaw, true); m.worker.visible = true; m.ppl = { st: 'go', t: 0 };
    return m;
  }
  function dropTruck(m) { if (m) G.removeMachine(m); }
  const KB = { slew: 0, a1: 1.35, a2: -2.85, open: 1 };   // stowed crane pose
  function kbAim(m, x, y, z) {
    // turn the post towards the point; fold the two booms so the grapple hangs over it at height y
    const post = m.kb.post, pw = post.getWorldPosition(new THREE.Vector3());
    const R = clamp(Math.hypot(x - pw.x, z - pw.z), 1.5, 7.6), hy = y - (pw.y + 1.6) + 1.0;
    const L1 = 4.2, L2 = 3.8, D = Math.min(L1 + L2 - .05, Math.hypot(R, hy));
    const c2 = clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1), a2 = -Math.acos(c2);
    const a1 = Math.atan2(hy, R) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
    m.kbT = { slew: angWrap(Math.atan2(x - pw.x, z - pw.z) - m.yaw), a1, a2, open: m.kbT ? m.kbT.open : 1 };
  }
  const kbThere = m => m.kbA && Math.abs(angWrap(m.kbT.slew - m.kbA.slew)) < .04 && Math.abs(m.kbT.a1 - m.kbA.a1) < .04 && Math.abs(m.kbT.a2 - m.kbA.a2) < .04;
  function logJob(dt, S) {
    const m = logTruck, st = m.ppl; st.t += dt;
    const logs = siteTrees(S).map(i => G.trees[i]).filter(t => t.st === 2 && t.cut);
    let c = null;
    if (st.st === 'go') {
      const tgt = logs[0] ? nearestSpot(S, logs) : null;
      if (!tgt || m.loaded >= 9) { st.st = 'leave'; return; }
      const r = G.crewDrive(m, tgt[0], tgt[1], 3, .6); c = r.c;
      if (r.there || st.t > 60) { st.st = 'load'; st.t = 0; m.kbT = { ...KB, open: 1 }; }
    } else if (st.st === 'load') {
      c = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
      const reach = logs.filter(t => { const [cx, cz] = logMid(t); return Math.hypot(cx - m.x, cz - m.z) < 9; });
      if (!st.log) {
        if (!reach.length || m.loaded >= 9) { st.st = logs.length > reach.length && m.loaded < 9 ? 'go' : 'leave'; st.t = 0; m.kbT = { ...KB, open: 1 }; return c; }
        st.log = reach[0]; st.ph = 'reach'; st.t = 0;
      }
      const t = st.log, [cx, cz] = logMid(t), gy = G.hAt(cx, cz);
      if (st.ph === 'reach') { kbAim(m, cx, gy + 2.2, cz); m.kbT.open = 1; if (kbThere(m) || st.t > 8) { st.ph = 'down'; st.t = 0; } }
      else if (st.ph === 'down') { kbAim(m, cx, gy + 1.15, cz); if (kbThere(m) || st.t > 4) { st.ph = 'grab'; st.t = 0; } }
      else if (st.ph === 'grab') { m.kbT.open = 0; if (st.t > 1) { G.treeGone(t); m.kb.held.visible = true; m.kb.held.rotation.y = 0; st.ph = 'lift'; st.t = 0; G.clang(cx, gy + 1, cz); } }
      else if (st.ph === 'lift') { kbAim(m, cx, gy + 4, cz); if (kbThere(m) || st.t > 3) { st.ph = 'swing'; st.t = 0; } }
      else if (st.ph === 'swing') {
        const bx = m.x - Math.sin(m.yaw) * 2.6, bz = m.z - Math.cos(m.yaw) * 2.6;
        kbAim(m, bx, m.y + 3.3, bz); if (kbThere(m) || st.t > 9) { st.ph = 'drop'; st.t = 0; }
      } else if (st.ph === 'drop') {
        m.kbT.open = 1;
        if (st.t > .8) { m.kb.held.visible = false; m.logMeshes[Math.min(8, m.loaded)].visible = true; m.loaded++; G.thud(m.x, m.y + 2, m.z); st.log = null; }
      }
    } else if (st.st === 'leave') {
      const [ex, ez] = exitPoint(S);
      const r = G.crewDrive(m, ex, ez, 4, .75); c = r.c;
      m.kbT = { ...KB, open: 1 };
      if (r.there || st.t > 120) { dropTruck(m); logTruck = null; S.trips = (S.trips || 0) + 1; return null; }
    }
    return c;
  }
  const logMid = t => { const L = G.logLen(t); return [t.x + t.dx * L * .5, t.z + t.dz * L * .5]; };
  function nearestSpot(S, logs) {
    // first the middle of the clearing (the logs lie towards it); then beside any log still out of reach
    if (!logTruck.ppl.trips) { logTruck.ppl.trips = 1; return G.freeSpot('logtruck', S.x, S.z, 0); }
    const [cx, cz] = logMid(logs[0]);
    const ux = S.x - cx, uz = S.z - cz, l = Math.hypot(ux, uz) || 1;
    return G.freeSpot('logtruck', cx + ux / l * 4.5, cz + uz / l * 4.5, 0);
  }
  function toolLogTruck(m, dt) {
    if (!m.kb) return;
    const A = m.kbA || (m.kbA = { ...KB }), Tg = m.kbT || KB, k = 1 - Math.exp(-dt * 2.2);
    A.slew += angWrap(Tg.slew - A.slew) * k; A.a1 += (Tg.a1 - A.a1) * k; A.a2 += (Tg.a2 - A.a2) * k; A.open += (Tg.open - A.open) * (1 - Math.exp(-dt * 5));
    m.kb.post.rotation.y = A.slew; m.kb.b1.rotation.x = -A.a1; m.kb.b2.rotation.x = -A.a2;
    m.kb.grap.rotation.x = A.a1 + A.a2;   // the grapple hangs straight down
    m.tongs[0].rotation.z = -.5 * A.open; m.tongs[1].rotation.z = .5 * A.open;
    const moving = Math.abs(Tg.slew - A.slew) + Math.abs(Tg.a1 - A.a1) + Math.abs(Tg.a2 - A.a2);
    if (moving > .02) { m.work = Math.max(m.work, .5); m.hyd = Math.max(m.hyd, .7); }
  }
  function deliverJob(dt, S) {
    const m = flatbed, st = m.ppl; st.t += dt;
    if (st.st === 'go') {
      const r = G.crewDrive(m, S.stackAt[0], S.stackAt[1], 4, .6);
      if (r.there || st.t > 100) { st.st = 'drop'; st.t = 0; }
      return r.c;
    }
    if (st.st === 'drop') {
      if (st.t > 4) { S.delivered = true; S.stacks.visible = true; G.thud(S.stackAt[0], S.pad + 1, S.stackAt[1]); st.st = 'leave'; st.t = 0; }
      return { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
    }
    const [ex, ez] = exitPoint(S), r = G.crewDrive(m, ex, ez, 4, .75);
    if (r.there || st.t > 120) { dropTruck(m); flatbed = null; return null; }
    return r.c;
  }

  // ------------------------------------------------------------ grading the pad (dozer if it's free, else by hand)
  function padCells(S, fn) {
    const [hx, hz] = halfPad(S), R = Math.hypot(hx, hz) + 3;
    for (let z = Math.floor(S.z - R); z <= Math.ceil(S.z + R); z++) for (let x = Math.floor(S.x - R); x <= Math.ceil(S.x + R); x++) {
      if (x < 1 || z < 1 || x > 254 || z > 254) continue;
      const [lx, lz] = toL(S, x, z), ex = Math.max(0, Math.abs(lx) - hx), ez = Math.max(0, Math.abs(lz) - hz), e = Math.hypot(ex, ez);
      if (e < 3) fn(z * 256 + x, e, x, z);
    }
  }
  function gradeAt(S, x, z, r, rate) {
    // pull the ground under the blade (or rakes) towards pad level; the edge eases into the old ground
    let moved = 0;
    padCells(S, (k, e, cx, cz) => {
      if (Math.hypot(cx - x, cz - z) > r) return;
      const want = e === 0 ? S.pad : lerp(S.pad, G.H[k], e / 3), d = want - G.H[k];
      if (Math.abs(d) < .005) return;
      const st = Math.sign(d) * Math.min(Math.abs(d), rate);
      G.H[k] += st; moved += Math.abs(st);
      G.D[k] = 1; G.M[k] = e === 0 ? 2 : 1; G.dirty(k);
    });
    return moved;
  }
  function gradeDone(S) {
    let off = 0, n = 0;
    padCells(S, (k, e) => { if (e === 0) { n++; if (Math.abs(G.H[k] - S.pad) > .08) off++; } });
    return n ? 1 - off / n : 1;
  }
  // the crew's dozer, lent to the building crew while the machine crew has nothing to build
  function lend(m, st, dt) {
    if (!cur || cur.phase !== 'grade' || m.type !== 'dozer') return null;
    const S = cur, [hx, hz] = halfPad(S), c = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
    S.dozer = G.time(); m.noCut = G.time();
    if (st.lsite !== S) { st.lanes = null; st.lsite = S; }
    if (!st.lanes) { st.lanes = []; for (let lz = -hz + 1; lz <= hz - 1 + .01; lz += 2.4) st.lanes.push(lz); st.li = 0; st.dir = 1; st.gs = 'to'; }
    const lz = st.lanes[st.li % st.lanes.length], [ax, az] = toW(S, -st.dir * (hx + 4), lz), [bx, bz] = toW(S, st.dir * (hx + 4), lz);
    if (st.gs === 'to') { const r = G.crewDrive(m, ax, az, 2.2, .6); Object.assign(c, r.c); c.tool = m.blade < .5 ? 1 : 0; if (r.there) st.gs = 'push'; return c; }
    // along the lane with the blade at pad level
    const dx = bx - m.x, dz = bz - m.z, d = Math.hypot(dx, dz);
    const e = angWrap(Math.atan2(dx, dz) - m.yaw);
    c.steer = clamp(e * 2.4, -1, 1); c.throttle = Math.abs(e) > .5 ? 0 : .45;
    c.tool = m.blade > .22 ? -1 : m.blade < .12 ? 1 : 0;   // blade skimming the pad (its own cut would dig the pad below level)
    const bxw = m.x + Math.sin(m.yaw) * 2.9, bzw = m.z + Math.cos(m.yaw) * 2.9;
    if (gradeAt(S, bxw, bzw, 2.1, dt * .9) > .002) m.work = Math.max(m.work, .7);
    if (Math.random() < dt * 5) G.spawn('dust', bxw, S.pad + .4, bzw, 1, [.5, .4, .3], { jitter: 2, size: .9, alpha: .4 });
    if (d < 2.5 || (Math.abs(m.v) < .05 && (st.gt = (st.gt || 0) + dt) > 6)) { st.gt = 0; st.li++; st.dir = -st.dir; st.gs = 'to'; }
    return c;
  }

  // ------------------------------------------------------------ framers: carry, climb, nail
  function framer(p, dt, S) {
    if (!p.task) {
      if (!S.delivered) return idleNear(p, dt, S);
      const got = claim(S, p);
      if (!got.length) return idleNear(p, dt, S);
      p.task = { q: got, n: 0 }; p.st = got[0].work === 'pour' || got[0].mat === 'stake' ? 'walk' : 'fetch'; p.t = 0;
      p.lad = got[0].high ? S.ladderSpots.reduce((a, l) => Math.hypot(l.lx - got[0].p[0], l.lz - got[0].p[2]) < Math.hypot(a.lx - got[0].p[0], a.lz - got[0].p[2]) ? l : a) : null;
    }
    const tk = p.task, q = tk.q[tk.n];
    if (p.st === 'fetch') {
      hold(p, null);
      if (walk(p, S.stackAt[0] + (p.id % 3 - 1) * .8, S.stackAt[1] + (p.id % 2) * .7, dt, .6)) { p.st = 'pick'; p.t = 0; }
      return;
    }
    if (p.st === 'pick') { p.pose = 'rake'; p.t += dt; if (p.t > .9) { carry(p, q); p.st = 'walk'; p.t = 0; } return; }
    if (p.st === 'walk') {
      if (p.lad) { const [x, z] = toW(S, p.lad.lx, p.lad.lz); if (walk(p, x, z, dt, .35)) { p.st = 'up'; p.t = 0; } return; }
      // stand just off the piece: inside the walls for wall pieces, beside it otherwise
      const K = KINDS[S.kind], lx = q.p[0], lz = q.p[2];
      let sx = lx, sz = lz;
      if (q.stage >= 5) { sx = clamp(lx, -K.w / 2 + .7, K.w / 2 - .7); sz = clamp(lz, -K.d / 2 + .7, K.d / 2 - .7); if (q.stage === 11 || q.stage === 12) { sx = Math.abs(lx) > K.w / 2 - .1 ? lx + Math.sign(lx) * .8 : lx; sz = Math.abs(lz) > K.d / 2 - .1 ? lz + Math.sign(lz) * .8 : lz; } }
      else if (q.stage === 4) { sz = lz - .9 * Math.sign(lz || 1); }
      else { sz = lz + (lz <= 0 ? -.75 : .75); if (q.stage === 3 && q.s[2] > 1) sz = lz; sx = q.stage === 3 && q.s[2] > 1 ? lx + .4 : lx; }
      const [x, z] = toW(S, sx, sz);
      if (walk(p, x, z, dt, .35)) { p.st = 'work'; p.t = 0; carry(p, null); }
      return;
    }
    if (p.st === 'up') {   // up the ladder (with the piece)
      const L = p.lad, [bx, bz] = toW(S, L.lx, L.lz);
      p.x = bx; p.z = bz; face(p, ...toW(S, L.lx, 0), dt);
      p.t += dt; p.climb = S.pad + clamp(p.t / 3.2, 0, 1) * L.top + .02; p.pose = 'climb'; p.ph += dt * 5;
      if (p.t > 3.2) { p.st = 'work'; p.t = 0; }
      return;
    }
    if (p.st === 'work') {
      const [wx, wz] = toW(S, q.p[0], q.p[2]);
      face(p, wx, wz, dt);
      p.t += dt;
      if (q.work === 'pour') { hold(p, 'shovel'); p.pose = 'shovel'; p.ph += dt * 3; if (Math.random() < dt * 3) G.spawn('dust', wx, S.pad + .4, wz, 1, [.7, .7, .68], { jitter: .3, size: .5 }); }
      else if (q.work === 'set') { hold(p, null); p.pose = 'hammer'; p.ph += dt * 2; }
      else {
        hold(p, 'hammer'); p.pose = p.lad ? 'hammerHigh' : 'hammer';
        const before = p.ph % (Math.PI * 2); p.ph += dt * 7.5;
        if (before < Math.PI * 2 * .7 && p.ph % (Math.PI * 2) >= Math.PI * 2 * .7) G.tok(wx, S.pad + q.p[1], wz, .5);
      }
      if (p.t > .35 && !q.shown) { q.shown = true; placed(S, q); }   // the piece is set in place, then nailed
      if (p.t > (q.work === 'pour' ? 3.5 : q.work === 'set' ? 1.6 : 2.6)) {
        q.shown = false; tk.n++;
        if (tk.n < tk.q.length) { p.st = p.lad ? 'work' : 'walk'; p.t = 0; if (!p.lad && tk.q[tk.n].work !== 'pour') carry(p, tk.q[tk.n]); return; }
        p.st = p.lad ? 'down' : 'done'; p.t = 0;
      }
      return;
    }
    if (p.st === 'down') {
      const L = p.lad; p.t += dt; p.climb = S.pad + clamp(1 - p.t / 2.6, 0, 1) * L.top + .02; p.pose = 'climb'; p.ph -= dt * 5;
      if (p.t > 2.6) { p.climb = 0; p.st = 'done'; }
      return;
    }
    p.task = null; p.lad = null; p.climb = 0; hold(p, null);
  }
  function idleNear(p, dt, S) {
    const [x, z] = toW(S, -KINDS[S.kind].w / 2 - 3 - (p.id % 3) * .9, -KINDS[S.kind].d / 2 - 4 + (p.id % 2) * 1.2);
    if (walk(p, x, z, dt, .8)) { p.pose = p.role === 'boss' ? 'point' : 'idle'; face(p, S.x, S.z, dt); p.ph += dt; }
  }
  function raker(p, dt, S, inside) {
    // rake (and seed) round the site: inside = level the pad by hand; else bring the grass back outside the pad
    hold(p, 'rake');
    if (!p.rk || p.rk.t > 5) {
      const [hx, hz] = halfPad(S), a = (p.id * 2.4 + G.time() * .37) % (Math.PI * 2), rr = inside ? .7 : 1.25 + (p.id % 3) * .15;
      p.rk = { lx: Math.cos(a) * hx * rr, lz: Math.sin(a) * hz * rr, t: 0 };
    }
    const [x, z] = toW(S, p.rk.lx, p.rk.lz);
    if (!walk(p, x, z, dt, .6)) return;
    p.rk.t += dt; p.pose = 'rake'; p.ph += dt * 3;
    if (inside) gradeAt(S, p.x + Math.sin(p.yaw) * 1.2, p.z + Math.cos(p.yaw) * 1.2, 1.4, dt * .05);
    else {
      G.cellsAround(p.x + Math.sin(p.yaw) * 1.4, p.z + Math.cos(p.yaw) * 1.4, 1.6, k => {
        if (onPad(S, k % 256, (k / 256) | 0)) return;
        if (G.W[k] < .02 && G.M[k] !== 2 && G.D[k] && Math.random() < dt * .6) { G.D[k] = 0; G.M[k] = 0; G.dirty(k); }
      });
      if (Math.random() < dt * 4) G.spawn('dust', p.x + Math.sin(p.yaw) * 1.3, G.hAt(p.x, p.z) + .3, p.z + Math.cos(p.yaw) * 1.3, 1, [.45, .38, .28], { jitter: .8, size: .4, alpha: .4 });
    }
  }

  // ------------------------------------------------------------ the mechanic
  const mech = { p: null, m: null, st: 'home', t: 0, tgt: null };
  function mechanic(dt) {
    const p = mech.p;
    if (mech.st === 'home') {
      p.f.root.visible = false;
      const bad = G.machines.filter(m => !m.equip && (m.hp <= 0 || (m.hp < .35 && Math.abs(m.v) < .2))).sort((a, b) => a.hp - b.hp)[0];
      if (!bad) return;
      mech.tgt = bad; mech.st = 'drive'; mech.t = 0;
      mech.from = exitPoint(bad); mech.m = G.makeMachine('truck', ...G.freeSpot('truck', ...mech.from, 0), Math.atan2(bad.x - mech.from[0], bad.z - mech.from[1]), true); mech.m.worker.visible = true; mech.m.service = true;
      G.toast('Mechanic on the way');
    }
    const m = mech.m, tg = mech.tgt;
    mech.t += dt;
    if (!m) { mech.st = 'home'; return; }
    if (mech.st === 'drive') {
      const r = G.crewDrive(m, tg.x + 6, tg.z + 6, 5, .85); m.ai = r.c;
      if (r.there || mech.t > 150) { mech.st = 'walk'; mech.t = 0; m.ai = null; m.worker.visible = false; p.x = m.x + Math.cos(m.yaw) * 1.6; p.z = m.z - Math.sin(m.yaw) * 1.6; p.f.root.visible = true; hold(p, 'toolbox'); }
      return;
    }
    m.ai = { throttle: 0, steer: 0, tool: 0, swing: 0, act: false };
    p.y = G.hAt(p.x, p.z);
    if (mech.st === 'walk') {
      const ax = tg.x + Math.cos(tg.yaw) * (G.SPEC[tg.type].wid / 2 + .7), az = tg.z - Math.sin(tg.yaw) * (G.SPEC[tg.type].wid / 2 + .7);
      if (Math.hypot(tg.x - m.x, tg.z - m.z) > 30) { mech.st = 'back'; return; }   // driven off
      if (walk(p, ax, az, dt, .4)) { mech.st = 'fix'; mech.t = 0; hold(p, 'wrench'); }
    } else if (mech.st === 'fix') {
      face(p, tg.x, tg.z, dt); p.pose = 'kneel'; p.ph += dt;
      if (Math.hypot(tg.x - p.x, tg.z - p.z) > G.SPEC[tg.type].wid / 2 + 2.5) { mech.st = 'walk'; return; }
      tg.hp = Math.min(1, tg.hp + dt * .055);
      if (Math.random() < dt * 1.5) G.tok(p.x, p.y + .6, p.z, .35);
      if (Math.random() < dt * .7) { G.clang(p.x, p.y + .6, p.z); G.spawn('spark', p.x + Math.sin(p.yaw) * .5, p.y + .6, p.z + Math.cos(p.yaw) * .5, 5, [1, .75, .35], { jitter: .2 }); }
      if (tg.hp >= 1) { mech.st = 'back'; mech.t = 0; hold(p, 'toolbox'); G.say(tg, G.SPEC[tg.type].name + ' repaired'); }
    } else if (mech.st === 'back') {
      if (walk(p, m.x + Math.cos(m.yaw) * 1.6, m.z - Math.sin(m.yaw) * 1.6, dt, .5)) { mech.st = 'return'; mech.t = 0; p.f.root.visible = false; m.worker.visible = true; }
    } else if (mech.st === 'return') {
      const [ex, ez] = mech.from, r = G.crewDrive(m, ex, ez, 4, .8); m.ai = r.c;
      if (r.there || mech.t > 150) { dropTruck(m); mech.m = null; mech.st = 'home'; }
    }
  }

  // ------------------------------------------------------------ the building crew's day
  const crew = [];
  let on = false, nextT = 0;
  function begin() {
    const S = chooseSite(); if (!S) return;
    sites.push(S); cur = S; siteMeshes(S);
    G.toast('Crew: clearing a building site', 2600);
  }
  function setPhase(S, ph) {
    S.phase = ph; S.t = 0;
    for (const p of crew) { if (p.task && p.task.q) for (const q of p.task.q) if (S.state && S.state[q.i] === 1) S.state[q.i] = 0; p.task = null; p.st = ''; p.climb = 0; carry(p, null); }
    for (const t of G.trees) t.claim = null;
  }
  function phase(S, dt) {
    S.t += dt;
    if (S.phase === 'clear') {
      const left = siteTrees(S).map(i => G.trees[i]).filter(t => t.st === 0 || t.st === 1 || (t.st === 2 && t.cut && !t.lim));
      if (!left.length) { setPhase(S, 'haul'); G.toast('Crew: logs to haul', 2000); }
    } else if (S.phase === 'haul') {
      const logs = siteTrees(S).map(i => G.trees[i]).filter(t => t.st === 2 && t.cut);
      if (!logs.length && !logTruck) setPhase(S, 'grade');
      else if (!logTruck && logs.length) { logTruck = spawnTruck('logtruck', S); logTruck.loaded = 0; }
    } else if (S.phase === 'grade') {
      // stumps on the pad come out as it's levelled
      for (const t of G.trees) if (t.cut && t.stump !== 0 && onPad(S, t.sx, t.sz, 1)) G.stumpOut(t);
      if (!S.delivered && !flatbed) flatbed = spawnTruck('truck', S);
      if (S.t % 2 < dt) S.grade = gradeDone(S);
      if (S.grade > .93 || S.t > 150) {
        padCells(S, (k, e) => { const want = e === 0 ? S.pad : lerp(S.pad, G.H[k], e / 3); G.H[k] = want; G.D[k] = 1; G.M[k] = e === 0 ? 2 : 1; G.dirty(k); });
        setPhase(S, 'frame'); G.toast('Crew: framing', 2000);
      }
    } else if (S.phase === 'frame') {
      if (!S.delivered && !flatbed) flatbed = spawnTruck('truck', S);
      S.ladders.visible = stageOpen(S, 7) && !stageOpen(S, 11);
      if (allIn(S)) { setPhase(S, 'land'); S.ladders.visible = false; S.stacks.visible = false; G.toast('Crew: landscaping', 2000); }
    } else if (S.phase === 'land') {
      if (S.t > 45) { setPhase(S, 'done'); cur = null; nextT = 20; G.toast('Building finished', 3000); G.chime(); }
    }
  }
  function update(dt) {
    if (!crew.length) {
      ['boss', 'faller', 'faller', 'framer', 'framer', 'framer'].forEach((r, i) => crew.push(addPerson(r, i)));
      mech.p = addPerson('mechanic', 7);
      G.TOOL.logtruck = toolLogTruck;
    }
    mechanic(dt);
    if (mech.p.f.root.visible) animate(mech.p, dt);
    if (logTruck) { const c = logJob(dt, cur || sites[sites.length - 1]); if (logTruck) logTruck.ai = c; }
    if (flatbed) { const S = cur || sites[sites.length - 1]; const c = deliverJob(dt, S); if (flatbed) flatbed.ai = c; }
    if (!on) { for (const p of crew) { p.f.root.visible = false; G.saw(p.id, 0, 0, 0, false, false); } return; }
    if (!cur) { nextT -= dt; if (nextT <= 0) { nextT = 30; if (sites.length < 12) begin(); } }
    const S = cur;
    for (const p of crew) {
      p.f.root.visible = true;
      if (!S) { p.pose = 'idle'; p.ph += dt; animate(p, dt); G.saw(p.id, 0, 0, 0, false, false); continue; }
      p.site = S;
      if (p.role !== 'faller' || S.phase !== 'clear') G.saw(p.id, p.x, p.y + 1, p.z, false, false);
      if (S.phase === 'clear') { if (p.role === 'faller') faller(p, dt, S); else idleNear(p, dt, S); }
      else if (S.phase === 'haul') idleNear(p, dt, S);
      else if (S.phase === 'grade') { if (G.time() - (S.dozer || -9) > 3) raker(p, dt, S, true); else idleNear(p, dt, S); }
      else if (S.phase === 'frame') framer(p, dt, S);
      else if (S.phase === 'land') { carry(p, null); p.climb = 0; p.task = null; raker(p, dt, S, false); }
      else idleNear(p, dt, S);
      if (!p.climb) p.y = lerp(p.y || standY(p), standY(p), 1 - Math.exp(-dt * 12)); else p.y = p.climb;
      animate(p, dt);
    }
    if (S) phase(S, dt);
  }
  function setOn(v) {
    on = !!v;
    if (on && crew.length) for (const [i, p] of crew.entries()) { const S = cur || sites[sites.length - 1]; if (S) { const [x, z] = toW(S, -KINDS[S.kind].w / 2 - 3 - i * .8, -KINDS[S.kind].d / 2 - 4); p.x = x; p.z = z; } }
    if (!on) { dropTruck(logTruck); logTruck = null; dropTruck(flatbed); flatbed = null; }
    if (!on) for (const p of crew) { p.task = null; p.climb = 0; carry(p, null); hold(p, null); p.st = ''; }
    if (!on && cur) for (const q of cur.list || []) if (cur.state[q.i] === 1) cur.state[q.i] = 0;
    if (!on) for (const t of G.trees) t.claim = null;
    nextT = 3;
  }
  // ------------------------------------------------------------ saving
  const KEEP = ['x', 'z', 'yaw', 'kind', 'phase', 'pl', 'pad', 'grade', 'delivered', 'trips'];
  function serialize() { return { sites: sites.map(S => Object.fromEntries(KEEP.filter(k => S[k] !== undefined).map(k => [k, S[k]]))), cur: cur ? sites.indexOf(cur) : -1 }; }
  function restore(d) {
    if (!d) return;
    for (const s of d.sites || []) { const S = { t: 0, ...s }; sites.push(S); siteMeshes(S); if (S.phase === 'done') { S.stacks.visible = false; } }
    cur = d.cur >= 0 && sites[d.cur] && sites[d.cur].phase !== 'done' ? sites[d.cur] : null;
  }
  return {
    update, setOn, serialize, restore, lend,
    get on() { return on; }, get sites() { return sites; }, get site() { return cur; }, get people() { return crew; }, get mech() { return mech; },
    get logTruck() { return logTruck; }, get flatbed() { return flatbed; },
    begin,
    // for tests: clear the current site at once and go straight to framing
    toFrame() { const S = cur; if (!S) return; for (const i of siteTrees(S)) G.treeGone(G.trees[i]); S.phase = 'grade'; S.t = 1e9; S.delivered = true; S.stacks.visible = true; phase(S, 0); },
    skip() { if (cur) { if (cur.phase === 'frame') for (const q of cur.list) if (cur.state[q.i] !== 2) placed(cur, q); cur.t = 1e9; } },
  };
}
