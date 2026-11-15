// What the crew builds, as you see it: road layers, culverts, rock armour, guardrails, markings, signs, lights, and
// bridges (piers, abutments, girders, deck, barriers). Everything is laid out along a project's line across the water:
// s runs along the road (negative = the near bank), o runs across it.
//
// A project P holds plain data (so it can be saved) and its meshes. Each layer has a "cut": how far along s it has been
// laid. Meshes are built once for the whole road and the shader hides what is beyond the cut, so a layer appears behind
// the machine laying it.
import * as THREE from 'three';

export const MATERIALS = [
  'Fill dirt', 'Clay core', 'Corrugated steel culvert pipe', 'Concrete headwalls', 'Riprap rock', 'Geotextile fabric',
  'Crushed stone subbase', 'Aggregate base course', 'Prime coat', 'Asphalt binder course', 'Asphalt wearing course',
  'Concrete pavement', 'Dowel bars and joint sealant', 'Precast pier columns', 'Pier caps', 'Elastomeric bearings',
  'Concrete abutments', 'Steel plate girders', 'Prestressed concrete girders', 'Timber formwork', 'Rebar',
  'Deck concrete', 'Expansion joints', 'Concrete barriers', 'W-beam guardrail', 'Galvanised posts',
  'Thermoplastic road paint', 'Reflective road studs', 'Lamp posts', 'Road signs', 'Hydroseed mulch',
];

export function makeWorks(G) {
  const { scene, T, N, H, M, D, DECK, clamp } = G;
  const pt = (P, s, o = 0) => [P.P[0] + P.u[0] * s + P.p[0] * o, P.P[1] + P.u[1] * s + P.p[1] * o];
  const yaw = P => Math.atan2(P.u[0], P.u[1]);

  // ---------------------------------------------------------------- materials
  function cutMat(params, key, extra) {
    const m = new THREE.MeshStandardMaterial(params);
    m.userData.cut = { value: -1e9 };
    m.userData.u = {}; if (extra) for (const k in extra.uniforms) m.userData.u[k] = { value: extra.uniforms[k].value };   // each road its own
    m.onBeforeCompile = sh => {
      sh.uniforms.uCut = m.userData.cut;
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSO; varying vec2 vSO; varying vec3 vRW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSO = aSO; vRW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCut; varying vec2 vSO; varying vec3 vRW;' + (extra ? extra.decl || '' : ''))
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vSO.x > uCut) discard;');
      if (extra && extra.frag) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + extra.frag);
    };
    m.customProgramCacheKey = () => 'gw-works-' + key;
    return m;
  }
  const tex = (t, r) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(r, r); c.needsUpdate = true; return c; };
  // asphalt: dark with stone speckle; lines painted as the marking cut passes; sealing darkens it
  const asphaltExtra = {
    uniforms: { uMark: { value: -1e9 }, uSeal: { value: -1e9 }, uHalf: { value: 3 } },
    decl: 'uniform float uMark, uSeal, uHalf;',
    frag: `{ float sp = texture2D(map, vRW.xz * .9).r; diffuseColor.rgb = mix(vec3(.075, .073, .07), vec3(.2, .19, .18), sp * sp);
      if (vSO.x < uSeal) diffuseColor.rgb *= .78;
      if (vSO.x < uMark) { float ao = abs(vSO.y);
        float edge = step(uHalf - .45, ao) * step(ao, uHalf - .3);
        float cen = step(ao, .07) * step(.5, fract(vSO.x / 6.));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92, .92, .88), edge);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.95, .72, .12), cen); } }`,
  };
  const concreteExtra = {
    uniforms: { uMark: { value: -1e9 }, uSeal: { value: -1e9 }, uHalf: { value: 3 } },
    decl: 'uniform float uMark, uSeal, uHalf;',
    frag: `{ float sp = texture2D(map, vRW.xz * .35).r; diffuseColor.rgb = vec3(.43, .425, .405) * (.85 + sp * .25);
      float j = step(fract(vSO.x / 4.5), .012) + step(abs(vSO.y), .015);
      diffuseColor.rgb *= 1. - min(j, 1.) * .45;
      if (vSO.x < uSeal) diffuseColor.rgb *= .92;
      if (vSO.x < uMark) { float ao = abs(vSO.y);
        float edge = step(uHalf - .45, ao) * step(ao, uHalf - .3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.95, .95, .92), edge); } }`,
  };
  const MAT = {
    geotextile: () => cutMat({ color: 0xd8d6cc, roughness: .95 }, 'geo'),
    subbase: () => cutMat({ map: tex(T.gravel, 1), color: 0xb8b2a6, roughness: 1 }, 'sub'),
    base: () => cutMat({ map: tex(T.gravel, 1), color: 0x8e8a82, roughness: 1 }, 'base'),
    asphalt: () => cutMat({ map: tex(T.gravel, 1), color: 0xffffff, roughness: .85 }, 'asph', asphaltExtra),
    concrete: () => cutMat({ map: tex(T.macro, 1), color: 0xffffff, roughness: .8 }, 'conc', concreteExtra),
    deck: () => cutMat({ map: tex(T.macro, 1), color: 0xb5b2aa, roughness: .82 }, 'deck'),
    rebar: () => cutMat({ color: 0x6a3a22, roughness: .7, metalness: .5, wireframe: true }, 'rebar'),
    form: () => cutMat({ map: tex(T.bark, 1), color: 0xb08a5a, roughness: .9 }, 'form'),
    barrier: () => cutMat({ map: tex(T.macro, 1), color: 0xc9c6bd, roughness: .85 }, 'barrier'),
    rail: () => cutMat({ color: 0xb9c0c6, roughness: .35, metalness: .85 }, 'rail'),
    post: () => cutMat({ color: 0x9aa1a6, roughness: .4, metalness: .8 }, 'post'),
    stud: () => cutMat({ color: 0xffd36a, emissive: 0x5a3c00, emissiveIntensity: .7, roughness: .3 }, 'stud'),
  };
  const conc = new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: .88 });
  const steelGirder = new THREE.MeshStandardMaterial({ color: 0x6e4a36, roughness: .55, metalness: .6 });   // weathering steel
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: .35, metalness: .85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: .8 });
  const signMat = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: .5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe2a0, emissiveIntensity: .8 });
  const reflMat = new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0x5a3c00, emissiveIntensity: .6, roughness: .3 });
  const rockMat = new THREE.MeshStandardMaterial({ map: T.rock, roughness: .9 });

  // ---------------------------------------------------------------- a strip along the road: top face plus its two edges
  // y(s) gives the top height; the strip runs s0..s1 at half-width hw, thick metres deep. aSO = (s, o) for the shader.
  function strip(P, s0, s1, hw, y, thick, mat, oc = 0) {
    const n = Math.max(2, Math.ceil(s1 - s0)) + 1, across = 6;
    const pos = [], so = [], nor = [], idx = [];
    const add = (s, o, h, nx, ny, nz) => { const [x, z] = pt(P, s, o + oc); pos.push(x, h, z); so.push(s, o); nor.push(nx, ny, nz); return pos.length / 3 - 1; };
    for (let i = 0; i < n; i++) {
      const s = s0 + (s1 - s0) * i / (n - 1), h = y(s);
      for (let a = 0; a <= across; a++) { const o = -hw + 2 * hw * a / across; add(s, o, h + (1 - Math.pow(o / hw, 2)) * .03, 0, 1, 0); }
    }
    for (let i = 0; i < n - 1; i++) for (let a = 0; a < across; a++) { const p = i * (across + 1) + a, q = p + 1, r = p + across + 1, t = r + 1; idx.push(p, r, q, q, r, t); }
    // edges (sides of the layer, so you see its thickness)
    for (const sd of [-1, 1]) {
      const base = pos.length / 3, nx = P.p[0] * sd, nz = P.p[1] * sd;
      for (let i = 0; i < n; i++) { const s = s0 + (s1 - s0) * i / (n - 1), h = y(s); add(s, sd * hw, h, nx, 0, nz); add(s, sd * (hw + thick * .6), h - thick, nx, .5, nz); }
      for (let i = 0; i < n - 1; i++) { const p = base + i * 2, q = p + 2; if (sd > 0) idx.push(p, p + 1, q, q, p + 1, q + 1); else idx.push(p, q, p + 1, q, q + 1, p + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aSO', new THREE.Float32BufferAttribute(so, 2));
    const uv = []; for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] * .25, pos[i * 3 + 2] * .25);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true; m.renderOrder = 1;
    return m;
  }
  // an extruded profile (barrier, W-beam) running along the road at offset o
  function rail(P, s0, s1, o, profile, y, mat) {
    const n = Math.max(2, Math.ceil((s1 - s0) / 1)) + 1, pos = [], so = [], idx = [];
    for (let i = 0; i < n; i++) {
      const s = s0 + (s1 - s0) * i / (n - 1), h = y(s);
      for (const [a, b] of profile) { const [x, z] = pt(P, s, o + a); pos.push(x, h + b, z); so.push(s, o); }
    }
    const k = profile.length;
    for (let i = 0; i < n - 1; i++) for (let a = 0; a < k - 1; a++) { const p = i * k + a, q = p + 1, r = p + k, t = r + 1; idx.push(p, r, q, q, r, t, p, q, r, q, t, r); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSO', new THREE.Float32BufferAttribute(so, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
  // instanced pieces along the road (posts, studs, rocks); each instance carries its s for the cut
  function along(P, geo, mat, list) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length;
    const ss = new Float32Array(list.length * 2), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach(([s, o, h, sc, ry, rx], i) => { const [x, z] = pt(P, s, o); e.set(rx || 0, yaw(P) + (ry || 0), 0); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(sc, sc, sc)); im.setMatrixAt(i, m4); ss[i * 2] = s; ss[i * 2 + 1] = o; });
    geo = geo.clone(); geo.setAttribute('aSO', new THREE.InstancedBufferAttribute(ss, 2)); im.geometry = geo;
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    return im;
  }

  // ---------------------------------------------------------------- the road's height along its line
  // base(s): top of the earthwork (or the bridge deck); layers stack on top of it
  const LAYER = { geo: .02, sub: .3, base: .5, surf: .62 };
  const baseY = (P, s) => {
    if (P.kind === 'bridge' && s >= P.sL && s <= P.sR) return P.deckY - LAYER.base;   // the deck counts as base course
    const i = clamp((s - P.sA), 0, P.prof.length - 1), a = Math.floor(i), b = Math.min(P.prof.length - 1, a + 1);
    return P.prof[a] + (P.prof[b] - P.prof[a]) * (i - a);
  };
  P_top.layer = LAYER;
  function P_top(P, s, layer) { return baseY(P, s) + LAYER[layer]; }
  // measure the finished earthwork under the line and smooth it into a drivable profile
  function profile(P) {
    const n = Math.ceil(P.sB - P.sA) + 1, raw = new Float32Array(n), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const o of [-2, -1, 0, 1, 2]) { const [x, z] = pt(P, P.sA + i, o); s += G.hAt(x, z); } raw[i] = s / 5; }
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -4; k <= 4; k++) { const j = i + k; if (j >= 0 && j < n) { s += raw[j]; c++; } } out[i] = s / c; }
    if (P.kind === 'causeway') for (let i = 0; i < n; i++) { const s = P.sA + i; if (Math.abs(s) < P.cw + 1) out[i] = Math.max(out[i], P.top - .05); }
    for (let pass = 0; pass < 2; pass++) {   // no steeper than 9%
      for (let i = 1; i < n; i++) out[i] = clamp(out[i], out[i - 1] - .09, out[i - 1] + .09);
      for (let i = n - 2; i >= 0; i--) out[i] = clamp(out[i], out[i + 1] - .09, out[i + 1] + .09);
    }
    P.prof = Array.from(out, v => +v.toFixed(3));
  }
  // raise the ground under the road to just below a layer's top, with side slopes, between s0 and s1
  function raise(P, s0, s1, layer, slope = 2.2) {
    const hw = P.w / 2 + .3;
    for (let s = Math.max(P.sA, s0); s <= Math.min(P.sB, s1); s += .5) {
      if (P.kind === 'bridge' && s > P.sL - .5 && s < P.sR + .5) continue;
      const top = P_top(P, s, layer) - .03;
      for (let o = -hw - slope * 1.6; o <= hw + slope * 1.6; o += .5) {
        const [x, z] = pt(P, s, o), i = Math.round(x), j = Math.round(z); if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
        const k = j * N + i, h = top - Math.max(0, Math.abs(o) - hw) / slope;
        if (H[k] < h) { H[k] = h; M[k] = Math.abs(o) <= hw ? 2 : 1; D[k] = 1; G.dirty(k); }
      }
    }
  }

  // ---------------------------------------------------------------- building a project's meshes
  function build(P) {
    if (P.grp) scene.remove(P.grp);
    const grp = new THREE.Group(); P.grp = grp; scene.add(grp); P.mesh = {};
    const hw = P.w / 2, y = layer => s => P_top(P, s, layer);
    const appr = (s0, s1, fn) => P.kind === 'bridge' ? [fn(s0, Math.min(s1, P.sL)), fn(Math.max(s0, P.sR), s1)] : [fn(s0, s1)];
    const add = (key, meshes) => { P.mesh[key] = [].concat(meshes).filter(Boolean); for (const m of P.mesh[key]) grp.add(m); };
    // culverts: corrugated pipes under the causeway with concrete headwalls at both ends
    if (P.kind === 'causeway' && P.culverts) {
      const pipes = [];
      for (const c of P.culverts) {
        const len = c.len, [x, z] = pt(P, c.s, 0), pg = new THREE.CylinderGeometry(c.r, c.r, len, 20, 1, true).rotateX(Math.PI / 2);
        const pipe = new THREE.Mesh(pg, pipeMat); pipe.material.side = THREE.DoubleSide; pipe.position.set(x, c.y + c.r, z); pipe.rotation.y = Math.atan2(P.p[0], P.p[1]); pipe.castShadow = true;
        const g2 = new THREE.Group(); g2.add(pipe);
        for (const e of [-1, 1]) { const [hx, hz] = pt(P, c.s, e * len / 2); const hwm = new THREE.Mesh(new THREE.BoxGeometry(c.r * 2 + 1.2, c.r * 2 + .6, .35), conc); hwm.position.set(hx, c.y + c.r + .1, hz); hwm.rotation.y = Math.atan2(P.p[0], P.p[1]); hwm.castShadow = true; g2.add(hwm); const ring = new THREE.Mesh(new THREE.RingGeometry(c.r * .92, c.r, 20), darkMat); ring.position.set(hx, c.y + c.r, hz); ring.rotation.y = Math.atan2(P.p[0], P.p[1]); g2.add(ring); }
        pipes.push(g2);
      }
      add('culverts', pipes);
    }
    if (P.prof) {
      // rock armour on the causeway's side slopes, at the waterline
      if (P.kind === 'causeway') {
        const list = [], r = G.rand(P.seed);
        for (let s = -P.cw - 1; s <= P.cw + 1; s += .7) for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) {
          const o = sd * (hw + 1.3 + k * 1.2 + r() * .5), ss = s + r() * .5, [x, z] = pt(P, ss, o), sc = .45 + r() * .4;
          list.push([ss, o, G.hAt(x, z) - sc * .15, sc, r() * 6, r() * 2]);
        }
        add('rip', along(P, G.rockGeo, rockMat, list));
      }
      add('geo', appr(P.sA, P.sB, (a, b) => strip(P, a, b, hw + .6, y('geo'), .02, MAT.geotextile())));
      add('sub', appr(P.sA, P.sB, (a, b) => strip(P, a, b, hw + .3, y('sub'), .28, MAT.subbase())));
      add('base', appr(P.sA, P.sB, (a, b) => strip(P, a, b, hw + .1, y('base'), .2, MAT.base())));
      const sm = P.surface === 'concrete' ? MAT.concrete() : MAT.asphalt();
      add('surf', strip(P, P.sA, P.sB, hw, y('surf'), P.surface === 'concrete' ? .25 : .12, sm));
      P.surfMat = sm;
      // guardrails on the approaches, concrete barriers on a bridge
      const posts = [], studs = [];
      for (let s = P.sA + 2; s <= P.sB - 2; s += 2) {
        if (P.kind === 'bridge' && s > P.sL - 1 && s < P.sR + 1) continue;
        for (const sd of [-1, 1]) posts.push([s, sd * (hw + .55), P_top(P, s, 'surf') - .05, 1, 0]);
      }
      for (let s = P.sA + 1; s <= P.sB - 1; s += 6) for (const sd of [-1, 1]) studs.push([s, sd * (hw - .38), P_top(P, s, 'surf') + .005, 1, 0]);
      const postGeo = new THREE.BoxGeometry(.12, 1.1, .1).translate(0, .3, 0);
      const wbeam = [[-.02, .45], [.1, .5], [.0, .58], [.1, .66], [-.02, .71]];
      const railMeshes = [along(P, postGeo, MAT.post(), posts)];
      for (const sd of [-1, 1]) appr(P.sA + 1, P.sB - 1, (a, b) => railMeshes.push(rail(P, a, b, sd * (hw + .45), wbeam.map(([q, h]) => [-sd * q, h]), y('surf'), MAT.rail())));
      add('rails', railMeshes);
      add('studs', along(P, new THREE.BoxGeometry(.12, .03, .12), MAT.stud(), studs));
    }
    if (P.kind === 'bridge') {
      // supports and girders are placed one by one by the crane: built here, shown as P.placed counts up
      P.items = items(P);
      const parts = P.items.map(it => { const m = it.mesh(); m.visible = false; return m; });
      add('items', parts);
      add('rebar', strip(P, P.sL - .4, P.sR + .4, hw + .4, s => P.deckY + .02, .2, MAT.rebar()));
      add('form', strip(P, P.sL - .4, P.sR + .4, hw + .6, s => P.deckY - .24, .06, MAT.form()));
      add('deck', strip(P, P.sL - .4, P.sR + .4, hw + .5, s => P.deckY, .3, MAT.deck()));
      const jersey = [[-.3, 0], [-.22, .25], [-.08, .5], [-.08, .85], [.08, .85], [.08, .5], [.22, .25], [.3, 0]];
      add('barrier', [-1, 1].map(sd => rail(P, P.sL - .3, P.sR + .3, sd * (hw + .2), jersey, s => P.deckY, MAT.barrier())));
      const lamps = [];
      for (let s = P.sL + 2; s <= P.sR - 2; s += 12) for (const sd of [-1, 1]) lamps.push(lampPost(P, s, sd * (hw + .3), P.deckY + .85, sd));
      for (const L of lamps) L.visible = false;
      add('lamps', lamps);
    }
    if (P.prof) {
      const signs = [];
      for (const [s, sd] of [[P.sA + 3, 1], [P.sB - 3, -1]]) signs.push(sign(P, s, sd * (P.w / 2 + 1.6), P_top(P, s, 'surf'), sd));
      for (const sg of signs) sg.visible = false;
      add('signs', signs);
    }
    refresh(P);
  }
  function lampPost(P, s, o, y, sd) {
    const g = new THREE.Group(), [x, z] = pt(P, s, o);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .09, 7, 8).translate(0, 3.5, 0), MAT.post()); pole.castShadow = true; g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, 1.6).translate(0, 7, -.8), MAT.post()); g.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.3, .12, .6).translate(0, 6.95, -1.5), lampMat); g.add(head);
    g.position.set(x, y, z); g.rotation.y = Math.atan2(P.p[0] * sd, P.p[1] * sd) + Math.PI; return g;
  }
  function sign(P, s, o, y, sd) {
    const g = new THREE.Group(), [x, z] = pt(P, s, o);
    for (const e of [-.5, .5]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.6, 6).translate(e, 1.3, 0), MAT.post()); g.add(p); }
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, .8, .05).translate(0, 2.4, 0), signMat); b.castShadow = true; g.add(b);
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.45, .06, .06).translate(0, 2.15, .03), reflMat); g.add(r);
    g.position.set(x, y, z); g.rotation.y = yaw(P) + (sd > 0 ? 0 : Math.PI); return g;
  }
  // the bridge's pieces in the order the crane sets them: abutments, piers (columns then caps), bearings, girders
  function items(P) {
    const L = [], hw = P.w / 2, gd = P.girder === 'steel' ? .9 : 1.0, capTop = P.deckY - .3 - gd - .15;
    const bed = s => Math.min(...[-1.8, 0, 1.8].map(o => { const [x, z] = pt(P, s, o); return G.h0At(x, z); }));
    const piece = (geo, mat, s, o, y, ry = 0) => () => { const m = new THREE.Mesh(geo, mat); const [x, z] = pt(P, s, o); m.position.set(x, y, z); m.rotation.y = yaw(P) + ry; m.castShadow = true; m.receiveShadow = true; return m; };
    for (const s of [P.sL, P.sR]) {
      const g0 = bed(s) - .4, h = capTop + .1 - g0;
      L.push({ kind: 'abutment', s, o: 0, y: g0 + h / 2, mesh: piece(new THREE.BoxGeometry(P.w + 2, h, 1.6), conc, s, 0, g0 + h / 2) });
    }
    for (const s of P.piers) {
      const g0 = bed(s) - .3, h = capTop - .5 - g0;
      for (const o of [-hw * .55, hw * .55]) L.push({ kind: 'column', s, o, y: g0 + h / 2, mesh: piece(new THREE.CylinderGeometry(.45, .5, h, 16), conc, s, o, g0 + h / 2) });
      L.push({ kind: 'cap', s, o: 0, y: capTop - .25, mesh: piece(new THREE.BoxGeometry(P.w + .6, .55, 1.1), conc, s, 0, capTop - .25) });
    }
    const sup = [P.sL, ...P.piers, P.sR];
    const ibeam = (() => { const sh = new THREE.Shape(), f = .32, t = .03, w = .02; sh.moveTo(-f, 0); sh.lineTo(f, 0); sh.lineTo(f, t * 2); sh.lineTo(w * 2, t * 2); sh.lineTo(w * 2, gd - t * 2); sh.lineTo(f, gd - t * 2); sh.lineTo(f, gd); sh.lineTo(-f, gd); sh.lineTo(-f, gd - t * 2); sh.lineTo(-w * 2, gd - t * 2); sh.lineTo(-w * 2, t * 2); sh.lineTo(-f, t * 2); sh.lineTo(-f, 0); return sh; })();
    const tbeam = (() => { const sh = new THREE.Shape(); sh.moveTo(-.3, 0); sh.lineTo(.3, 0); sh.lineTo(.3, gd * .25); sh.lineTo(.12, gd * .35); sh.lineTo(.12, gd - .18); sh.lineTo(.6, gd - .1); sh.lineTo(.6, gd); sh.lineTo(-.6, gd); sh.lineTo(-.6, gd - .1); sh.lineTo(-.12, gd - .18); sh.lineTo(-.12, gd * .35); sh.lineTo(-.3, gd * .25); sh.lineTo(-.3, 0); return sh; })();
    for (let i = 0; i < sup.length - 1; i++) {
      const a = sup[i] + .3, b = sup[i + 1] - .3, len = b - a;
      for (const o of [-hw * .75, -hw * .25, hw * .25, hw * .75]) {
        L.push({ kind: 'bearing', s: a, o, y: capTop + .05, mesh: piece(new THREE.BoxGeometry(.5, .12, .4), darkMat, a, o, capTop + .05) });
        const geo = new THREE.ExtrudeGeometry(P.girder === 'steel' ? ibeam : tbeam, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2);
        L.push({ kind: 'girder', s: (a + b) / 2, o, y: capTop + .12, mesh: piece(geo, P.girder === 'steel' ? steelGirder : conc, (a + b) / 2, o, capTop + .12) });
      }
    }
    // bearings are set as part of their girder lift (keeps the crane's list short)
    const out = [];
    for (const it of L) { if (it.kind === 'bearing') { const nx = L[L.indexOf(it) + 1]; nx.extra = (nx.extra || []).concat([it]); } else out.push(it); }
    for (const it of out) if (it.extra) { const f = it.mesh, ex = it.extra.map(e => e.mesh); it.mesh = () => { const g = new THREE.Group(); g.add(f()); for (const e of ex) g.add(e()); return g; }; }
    return out;
  }

  // ---------------------------------------------------------------- showing progress
  function setCut(P, key, s) { for (const m of P.mesh[key] || []) { const mats = [].concat(m.material); for (const mt of mats) if (mt.userData.cut) mt.userData.cut.value = s; } }
  function refresh(P) {
    const c = P.cut || {};
    for (const key of ['geo', 'sub', 'base', 'surf', 'rails', 'studs', 'rip', 'rebar', 'form', 'deck', 'barrier']) setCut(P, key, c[key] ?? -1e9);
    if (P.surfMat) { const u = P.surfMat.userData.u; u.uMark.value = c.mark ?? -1e9; u.uSeal.value = c.seal ?? -1e9; u.uHalf.value = P.w / 2; }
    if (P.mesh.items) P.mesh.items.forEach((m, i) => { m.visible = i < (P.placed || 0); });
    if (P.mesh.lamps) for (const L of P.mesh.lamps) { const s = G.sOf(P, L.position.x, L.position.z); L.visible = s < (c.lights ?? -1e9); }
    if (P.mesh.signs) for (const S of P.mesh.signs) S.visible = (c.lights ?? -1e9) > P.sA || (c.mark ?? -1e9) >= P.sB;
    if (P.mesh.culverts) for (const m of P.mesh.culverts) m.visible = (P.pipes || 0) > P.mesh.culverts.indexOf(m);
    // the deck is drivable where it has been poured
    if (P.kind === 'bridge') deck(P, c.deck ?? -1e9);
  }
  function deck(P, upTo) {
    const hw = P.w / 2 + .6, surf = (P.cut && P.cut.surf) ?? -1e9;
    for (let s = P.sL - .5; s <= P.sR + .5; s += .4) for (let o = -hw; o <= hw; o += .4) {
      const [x, z] = pt(P, s, o), i = Math.round(x), j = Math.round(z); if (i < 0 || j < 0 || i >= N || j >= N) continue;
      DECK[j * N + i] = s <= upTo ? (s <= surf && P.prof ? P_top(P, s, 'surf') - .01 : P.deckY + .01) : 0;
    }
  }
  function dispose(P) { if (P.grp) scene.remove(P.grp); if (P.kind === 'bridge') deck(P, -1e9); }

  return { build, refresh, raise, profile, top: P_top, baseY, pt, items, dispose, setCut };
}
