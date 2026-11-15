// The crew: three workers who drive the dozer, the excavator and the hauler. They follow the player around the valley
// in a loose convoy, finding their own way round deep water and steep ground. When the player stops at water too deep
// to drive through, they pick the narrowest place nearby and build a crossing there as a team: the excavator digs a
// borrow pit and loads the hauler, the hauler backs up to the water's edge and tips, and the dozer pushes the dirt out
// and grades the top. Then they fall in behind the player again.
// Each worker produces the same controls the player does (throttle, steer, tool, swing, act), so a machine behaves
// exactly the same whoever drives it. When the player takes a machine over, that worker sits out; the others carry on.
//
// A crossing site is a straight line across the water: s runs along it (0 = middle of the water, negative = our side)
// and o runs sideways. The "head" is how far along the line the built ground reaches.
export function makeCrew(G) {
  const { clamp, angWrap } = G;
  const ROLES = ['dozer', 'excavator', 'hauler'];
  let on = false, headT = 0, site = null, waitT = 0, coolT = 0, awayT = 0, gridT = 0;

  // ------------------------------------------------------------ choosing where to cross
  // Walk across the water along a direction; returns the wet span, or null if there is no dry land within reach.
  function span(x, z, ux, uz) {
    let sin = null;
    for (let d = 0; d < 70; d += .5) {
      const px = x + ux * d, pz = z + uz * d;
      if (px < 4 || pz < 4 || px > 251 || pz > 251) return null;
      const w = G.wAt(px, pz);
      if (sin === null) { if (w > .3) sin = d; else if (d > 24) return null; }
      else if (w < .05) {   // dry again: make sure it stays dry for a few metres (not just a bar in the middle)
        let ok = true; for (let e = .5; e <= 3; e += .5) if (G.wAt(px + ux * e, pz + uz * e) > .05) ok = false;
        if (ok) return [sin, d];
      }
    }
    return null;
  }
  // a crossing near where the machine stands, heading roughly the way it faces: the narrowest line that keeps clear of
  // the player's machine
  function siteAt(pm) {
    // straight across: towards the middle of the water near the machine (on a river that points across the channel)
    let cx = 0, cz = 0, n = 0;
    for (let dz = -16; dz <= 16; dz += 2) for (let dx = -16; dx <= 16; dx += 2) {
      if (dx * dx + dz * dz > 256) continue;
      const w = G.wAt(pm.x + dx, pm.z + dz); if (w > .3) { cx += dx * w; cz += dz * w; n += w; }
    }
    if (n <= 0) return null;
    const l = Math.hypot(cx, cz) || 1, fx = cx / l, fz = cz / l;
    let best = null;
    for (const da of [0, -.2, .2, -.4, .4]) {
      const ux = Math.cos(da) * fx + Math.sin(da) * fz, uz = -Math.sin(da) * fx + Math.cos(da) * fz;
      for (const off of [0, -6, 6, -10, 10, -14, 14, -19, 19]) {
        const x = pm.x + uz * off, z = pm.z - ux * off, sp = span(x, z, ux, uz);
        if (!sp || sp[0] > 14 || sp[1] - sp[0] < 2) continue;
        // the approach behind the line must be dry land
        let wet = false; for (let d = -30; d < sp[0] - 1; d += 2) if (G.wAt(x + ux * d, z + uz * d) > .2) wet = true;
        if (wet) continue;
        const width = sp[1] - sp[0], near = Math.abs(off) < 9 ? 12 : 0;   // keep the line off the player's machine
        const score = width + near + Math.abs(off) * .2 + Math.abs(da) * 4;
        if (!best || score < best.score) best = { score, x, z, ux, uz, sp };
      }
    }
    if (!best) return null;
    const { x, z, ux, uz, sp } = best, mid = (sp[0] + sp[1]) / 2, cw = (sp[1] - sp[0]) / 2 + 1;
    const P = [x + ux * mid, z + uz * mid];
    // the water level: the surface along the middle of the line
    let lvl = -1e9; for (let d = sp[0]; d <= sp[1]; d += 1) { const px = x + ux * d, pz = z + uz * d; if (G.wAt(px, pz) > .05) lvl = Math.max(lvl, G.hAt(px, pz) + G.wAt(px, pz)); }
    const S = { name: 'crossing', P, u: [ux, uz], p: [uz, -ux], lvl, cw, Ls: -(cw + 24), far: cw + 4, head: -cw, lock: null };
    // keep the loading spot on the map
    for (let k = 0; k < 6; k++) { const [lx, lz] = pt(S, S.Ls - 16, 0); if (lx > 8 && lz > 8 && lx < 247 && lz < 247) break; S.Ls += 3; }
    return S;
  }
  const pt = (S, s, o = 0) => [S.P[0] + S.u[0] * s + S.p[0] * o, S.P[1] + S.u[1] * s + S.p[1] * o];
  const sOf = (S, x, z) => (x - S.P[0]) * S.u[0] + (z - S.P[1]) * S.u[1];
  const oOf = (S, x, z) => (x - S.P[0]) * S.p[0] + (z - S.P[1]) * S.p[1];
  const topY = S => S.lvl + 1.0;   // the crossing is graded to this height
  // how far the crossing reaches: the first point along the line where the water is still too deep to drive
  function findHead(S) {
    for (let s = S.Ls + 6; s <= S.far; s += 1) {
      let deep = 0;
      for (const o of [-1.6, 0, 1.6]) { const [x, z] = pt(S, s, o); deep = Math.max(deep, G.wAt(x, z)); }
      if (deep > .42) return s;
    }
    return null;
  }

  // ------------------------------------------------------------ driving helpers
  const ctl = () => ({ throttle: 0, steer: 0, tool: 0, swing: 0, act: false });
  // steer towards a point; rev = drive backwards with the tail leading
  function steerTo(m, x, z, rev) {
    const e = angWrap(Math.atan2(x - m.x, z - m.z) - (rev ? m.yaw + Math.PI : m.yaw));
    if (G.SPEC[m.type].tracks) return [clamp(e * 2.4, -1, 1), e];
    return [(rev ? -1 : 1) * clamp(e * 2.2, -1, 1), e];
  }
  // drive to a point (forwards); returns true when there
  function goto(m, c, x, z, tol = 2.5, speed = .8) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < tol) return true;
    // steer round other machines that sit between here and there
    let ax = (x - m.x) / d, az = (z - m.z) / d, px = 0, pz = 0;
    for (const o of G.machines) {
      if (o === m) continue;
      const ox = o.x - m.x, oz = o.z - m.z, od = Math.hypot(ox, oz);
      if (od > 14 || od > d + 4 || od < .1) continue;
      const along = ox * ax + oz * az;
      if (along < od * .2) continue;
      let rx = -(ox - along * ax), rz = -(oz - along * az); const rl = Math.hypot(rx, rz);
      if (rl < .3) { rx = az; rz = -ax; } else { rx /= rl; rz /= rl; }   // dead ahead: pass on the right
      const w = (along / od) * (14 - od) / 14 * 1.8;
      px += rx * w; pz += rz * w;
    }
    ax += px; az += pz;
    const [st, e] = steerTo(m, m.x + ax * 10, m.z + az * 10, false);
    c.steer = st;
    const tracks = G.SPEC[m.type].tracks;
    c.throttle = tracks && Math.abs(e) > .6 ? 0 : speed * clamp(d / 8, .35, 1) * (Math.abs(e) > 1.2 ? .45 : 1);
    return false;
  }
  // follow the site line at sideways offset o, moving towards +s (dir 1) or -s (dir -1); rev = tail first
  function follow(m, c, S, o, dir, speed, rev = false) {
    const s = sOf(S, m.x, m.z), [x, z] = pt(S, s + dir * 7, o);
    c.steer = steerTo(m, x, z, rev)[0];
    c.throttle = (rev ? -1 : 1) * speed;
  }
  function facing(m, S) { return Math.abs(angWrap(Math.atan2(S.u[0], S.u[1]) - m.yaw)); }
  // a stuck machine (pushing against something) backs off for a moment and tries again
  function unstick(m, st, c, dt) {
    if (st.rec > 0) { st.rec -= dt; c.throttle = -st.recDir * .7; c.steer = st.recDir * .8; c.tool = 0; return true; }
    if ((Math.abs(c.throttle) > .1 && Math.abs(m.v) < .12) || m.blocked === 'machine') st.stall += dt; else st.stall = Math.max(0, st.stall - dt * 2);
    if (st.stall > 2.5) { st.stall = 0; st.rec = 1.6; st.recDir = Math.sign(c.throttle) || 1; }
    return false;
  }
  const lock = (S, m) => { if (!S.lock || S.lock === m) { S.lock = m; return true; } return false; };
  const unlock = (S, m) => { if (S.lock === m) S.lock = null; };

  // ------------------------------------------------------------ the dozer: pushes dirt out along lanes and grades the top
  const LANES = [0, -2.2, 2.2, -1.1, 1.1];
  function dozer(m, st, dt, S) {
    const c = ctl(), s = sOf(S, m.x, m.z), head = S.head;
    const bladeTo = y => { c.tool = clamp((y - m.blade) * 5, -1, 1); };
    // blade height: cut the ground ahead down towards the crossing height, and fill anything lower up to it
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const g0 = G.h0At(m.x + fx * 3.2, m.z + fz * 3.2);
    const wantY = Math.max(topY(S), g0 - .3);   // push piles off at grade; skim the natural ground at most 30 cm
    const lane = LANES[st.lane % LANES.length];
    const start = head - 16;
    switch (st.state) {
      case 'start': st.state = 'go'; break;
      case 'go': {   // to the start of the lane (or a waiting spot beside it when the hauler is working the line)
        bladeTo(.35);
        const free = S.lock === m || (!S.lock && !(G.time() - (S.waitAt || -9) < .5));   // a loaded hauler goes first
        const [x, z] = free ? pt(S, start, lane) : pt(S, start - 2, -7.5);
        const s0 = sOf(S, m.x, m.z), o0 = oOf(S, m.x, m.z);
        if (free && facing(m, S) < .5 && s0 > start + 1 && Math.abs(o0 - lane) < 3) { follow(m, c, S, lane, -1, .8, true); break; }   // back straight down the lane
        if (travel(m, st, c, x, z, free ? 1.8 : 2.5, .7)) {
          if (free && lock(S, m)) st.state = 'turn'; else c.throttle = 0;
        }
        break;
      }
      case 'turn': {   // face across the river
        bladeTo(.35);
        const [x, z] = pt(S, s + 10, lane);
        const [sv, e] = steerTo(m, x, z, false);
        c.steer = sv;
        if (Math.abs(e) < .08) { st.state = 'push'; st.t = 0; st.peak = 0; }
        break;
      }
      case 'push': {
        st.t += dt;
        bladeTo(clamp(wantY - m.y, -.55, .9));
        follow(m, c, S, lane, 1, .62);
        st.peak = Math.max(st.peak, m.load.v);
        const front = s + 2.8;
        const empty = st.peak > .5 && m.load.v < .15;
        if (front > S.far + 2 || empty || st.t > 28 || (m.blocked === 'deep' && st.t > 1) || (st.t > 3 && Math.abs(m.v) < .08)) { st.state = 'back'; st.t = 0; }
        break;
      }
      case 'back': {
        st.t += dt;
        bladeTo(Math.max(m.blade, .25));
        follow(m, c, S, lane, -1, .8, true);
        if (s < start || st.t > 20) {
          st.lane++; st.state = 'go'; unlock(S, m);
        }
        break;
      }
    }
    unstick(m, st, c, dt);
    return c;
  }

  // ------------------------------------------------------------ the excavator: digs a borrow pit and loads the hauler
  function excavator(m, st, dt, S) {
    const c = ctl();
    const E = pt(S, S.Ls, 5.8);
    switch (st.state) {
      case 'start': st.state = 'go'; break;
      case 'go': if (travel(m, st, c, E[0], E[1], 1.6, .8)) st.state = 'work'; break;
      case 'work': {
        if (Math.hypot(m.x - E[0], m.z - E[1]) > 4) { st.state = 'go'; break; }
        const h = G.machines.find(o => o.type === 'hauler');
        let tx, tz, mode;
        if (m.load.v < .05) {
          // next spot in the pit: a grid behind the machine (away from the river), skipping spots dug too deep
          const base = G.hAt(m.x, m.z);
          for (let tries = 0; tries < 12; tries++) {
            const q = st.dig % 9, ring = Math.floor(st.dig / 9) % 3;
            const [x, z] = pt(S, S.Ls - 5.5 - (q % 3) * 1.6 - ring * 1.2, 6.3 + (Math.floor(q / 3) - 1) * 1.7);
            if (G.hAt(x, z) > base - 3.2) { tx = x; tz = z; break; }
            st.dig++;
          }
          if (tx === undefined) { const [x, z] = pt(S, S.Ls - 6, 6.3); tx = x; tz = z; }
          mode = 'dig';
        } else {
          // tip into the hauler when it is parked within reach (whoever is driving it)
          const b = h ? G.bedPoint(h) : pt(S, S.Ls, 0);
          const ready = h && Math.abs(h.v) < .2 && !h.tipping && h.load.v < G.SPEC.hauler.cap - .4 && Math.hypot(b[0] - m.x, b[1] - m.z) < 8.6;
          tx = b[0]; tz = b[1]; mode = ready ? 'dump' : 'hold';
        }
        const want = angWrap(Math.atan2(tx - m.x, tz - m.z) - m.yaw);
        const se = angWrap(want - m.swing), reach = clamp(Math.hypot(tx - m.x, tz - m.z) - 1, 3.2, 7.6);
        if (m.act < 0) {
          c.swing = clamp(se * 3.5, -1, 1);
          c.tool = clamp((reach - m.reach) * 3, -1, 1);
          if (mode !== 'hold' && Math.abs(se) < .06 && Math.abs(reach - m.reach) < .25) { c.act = true; if (mode === 'dig') st.dig++; }
        }
        break;
      }
    }
    if (st.state === 'go') unstick(m, st, c, dt);
    return c;
  }

  // flat, dry, open places near the loading spot where the hauler can turn round (flattest first)
  function turnSpots(S) {
    if (S.spots) return S.spots;
    const c = [];
    for (let s = S.Ls - 32; s <= S.Ls - 4; s += 4) for (let o = -22; o <= 22; o += 4) {
      if (o > 0 && o < 14 && s > S.Ls - 16) continue;   // the excavator and its pit
      const [x, z] = pt(S, s, o);
      if (x < 10 || z < 10 || x > 245 || z > 245) continue;
      const h = G.hAt(x, z); let bump = 0, wet = 0;
      for (let a = 0; a < 12; a++) { const ax = x + Math.cos(a / 12 * 6.283) * 8, az = z + Math.sin(a / 12 * 6.283) * 8; bump = Math.max(bump, Math.abs(G.hAt(ax, az) - h)); wet = Math.max(wet, G.wAt(ax, az)); }
      if (wet > .05 || G.wAt(x, z) > .05) continue;
      c.push([bump + Math.hypot(s - S.Ls, o) * .03, x, z]);
    }
    c.sort((a, b) => a[0] - b[0]);
    S.spots = c.slice(0, 4).map(q => [q[1], q[2]]);
    if (!S.spots.length) S.spots = [pt(S, S.Ls - 15, -5)];
    return S.spots;
  }

  // ------------------------------------------------------------ the hauler: turns round once, then backs up to the edge, tips, and drives back
  // It waits at the loading spot facing away from the river, so every trip is a straight reverse to the water's edge
  // and a straight drive back, like a dump truck end-tipping into water.
  function hauler(m, st, dt, S) {
    const c = ctl(), s = sOf(S, m.x, m.z), o = oOf(S, m.x, m.z), cap = G.SPEC.hauler.cap;
    const away = Math.atan2(-S.u[0], -S.u[1]), he = angWrap(away - m.yaw);   // heading error from facing away from the river
    const spots = turnSpots(S), K = spots[st.tries % spots.length];
    let unst = true;
    switch (st.state) {
      case 'start':
        if (m.tipping) c.act = true;
        st.state = Math.abs(he) < .5 && Math.abs(o) < 3 && s > S.Ls - 3 && s < S.Ls + 6 ? 'load' : Math.abs(he) < .4 && s < S.Ls - 3 && s > S.Ls - 25 ? 'dock' : 'toTurn'; st.t = 0; break;
      case 'toTurn': if (travel(m, st, c, K[0], K[1], 7, .6)) { st.state = 'turn'; st.t = 0; st.tt = 0; st.ph = 0; st.sg = Math.sign(he) || 1; } break;
      case 'turn': {   // a three-point turn: full lock forwards, opposite lock backwards, until facing away from the river
        st.t += dt; st.tt += dt; unst = false;
        if (Math.abs(he) < .3) { st.state = 'dock'; st.t = 0; break; }
        if (st.tt > 40) { st.tries = (st.tries || 0) + 1; st.state = 'toTurn'; break; }   // no room here: try another spot
        if (Math.abs(he) < 1.5) st.sg = Math.sign(he) || 1;   // keep one turning direction until nearly round
        const sg = st.sg;
        if (st.ph === 0) { c.throttle = .35; c.steer = sg; } else { c.throttle = -.35; c.steer = -sg; }
        if (st.t > 3.2 || (st.t > .8 && Math.abs(m.v) < .05)) { st.ph ^= 1; st.t = 0; }
        break;
      }
      case 'dock': {   // back onto the line and up to the loading spot
        st.t += dt;
        follow(m, c, S, 0, 1, s > S.Ls - 4 ? .1 : .16, true);
        if (s >= S.Ls - .3) { c.throttle = 0; if (Math.abs(o) < 2.6) st.state = 'load'; else { st.state = 'toTurn'; st.tries++; } st.t = 0; }
        else if (st.t > 40) { st.tries++; st.state = 'toTurn'; }
        break;
      }
      case 'load': {
        st.t += dt;
        if (m.tipping) c.act = true;
        if (Math.abs(o) > 3.2 || s < S.Ls - 4 || s > S.Ls + 6 || Math.abs(he) > .7) { st.state = 'start'; break; }
        if (m.load.v > cap * .92 || (m.load.v > 4 && st.t > 90)) { S.waitAt = G.time(); if (lock(S, m)) { st.state = 'deliver'; st.t = 0; st.slow = 0; } }
        break;
      }
      case 'deliver': {   // reverse down the line until the tail is at the water's edge
        st.t += dt; unst = false;
        if (!lock(S, m)) { c.throttle = 0; break; }
        follow(m, c, S, 0, 1, .5, true);
        if (s + 4.4 > S.head - 1.2) c.throttle *= .5;
        st.slow = Math.abs(m.v) < .1 && st.t > 2 ? st.slow + dt : 0;
        if (s + 4.4 > S.head + .3 || (m.blocked === 'deep' && st.t > 1) || st.slow > 1.5 || st.t > 40) { c.throttle = 0; st.state = 'dump'; st.t = 0; }
        break;
      }
      case 'dump': {
        st.t += dt; unst = false;
        if (st.t > .3 && !m.tipping && m.load.v > .05 && st.t < 1) c.act = true;
        if ((m.load.v < .05 || st.t > 12) && m.tipping) c.act = true;
        if ((!m.tipping && st.t > 1.2 && m.tip < .05) || st.t > 16) { if (m.tipping) c.act = true; st.state = 'return'; st.t = 0; }
        break;
      }
      case 'return': {   // drive straight back to the loading spot
        st.t += dt;
        follow(m, c, S, 0, -1, .7);
        if (s < S.head - 20) unlock(S, m);
        if (s < S.Ls + 4) c.throttle = .3;
        if (s <= S.Ls + .3 || st.t > 40) { c.throttle = 0; unlock(S, m); st.state = 'load'; st.t = 0; }
        break;
      }
    }
    if (st.state !== 'deliver' && st.state !== 'dump' && st.state !== 'return') unlock(S, m);
    if (unst) unstick(m, st, c, dt);
    return c;
  }

  // ------------------------------------------------------------ finding a way: a route over the valley on a 2 m grid
  // Cells are blocked where the water is deeper than the machine can ford or the ground is too steep to climb.
  const GS = 2, GN = 128, gDepth = new Float32Array(GN * GN), gH = new Float32Array(GN * GN);
  function buildGrid() {
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x = i * GS + 1, z = j * GS + 1;
      gH[j * GN + i] = G.hAt(x, z);
      gDepth[j * GN + i] = Math.max(G.wAt(x - .5, z - .5), G.wAt(x + .5, z - .5), G.wAt(x - .5, z + .5), G.wAt(x + .5, z + .5));
    }
  }
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function findPath(m, x0, z0, x1, z1) {
    const ford = G.SPEC[m.type].ford * .85;
    const ok = n => { const i = n % GN, j = (n / GN) | 0; return i > 1 && j > 1 && i < GN - 2 && j < GN - 2 && gDepth[n] <= ford; };
    const cellOf = (x, z) => clamp(Math.round((z - 1) / GS), 0, GN - 1) * GN + clamp(Math.round((x - 1) / GS), 0, GN - 1);
    const start = cellOf(x0, z0);
    let goal = cellOf(x1, z1);
    if (!ok(goal)) {   // the spot itself is under water: aim for the nearest dry cell
      let bd = 1e9, bg = -1; const gi = goal % GN, gj = (goal / GN) | 0;
      for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) { const n = (gj + dj) * GN + gi + di; if (gj + dj < 0 || gj + dj >= GN || gi + di < 0 || gi + di >= GN) continue; const d = di * di + dj * dj; if (d < bd && ok(n)) { bd = d; bg = n; } }
      if (bg < 0) return null; goal = bg;
    }
    const gi = goal % GN, gj = (goal / GN) | 0;
    const g = new Float32Array(GN * GN).fill(1e9), from = new Int32Array(GN * GN).fill(-1), closed = new Uint8Array(GN * GN);
    const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
    const hgt = n => Math.hypot(n % GN - gi, ((n / GN) | 0) - gj);
    g[start] = 0; push(start, hgt(start));
    let it = 0;
    while (heap.length && it++ < 30000) {
      const [, n] = pop(); if (closed[n]) continue; closed[n] = 1;
      if (n === goal) break;
      const i = n % GN, j = (n / GN) | 0;
      for (const [di, dj, dc] of D8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        const q = nj * GN + ni; if (closed[q] || (!ok(q) && q !== start)) continue;
        const grade = Math.abs(gH[q] - gH[n]) / (dc * GS);
        if (grade > .5) continue;
        const cost = g[n] + dc * (1 + grade * 4 + gDepth[q] * 2);
        if (cost < g[q]) { g[q] = cost; from[q] = n; push(q, cost + hgt(q)); }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const path = []; for (let n = goal; n >= 0 && n !== start; n = from[n]) path.push([(n % GN) * GS + 1, ((n / GN) | 0) * GS + 1]);
    return path.reverse();
  }
  // drive somewhere, along a route when it is far or round water; returns true when there
  function travel(m, st, c, x, z, tol = 2.5, speed = .8) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < tol) { st.path = null; return true; }
    if (d < 10) return goto(m, c, x, z, tol, speed);
    st.pathT = (st.pathT || 0) - st.dt;
    if (!st.path || st.pathT <= 0 || Math.hypot(x - st.goal[0], z - st.goal[1]) > 6) {
      st.path = findPath(m, m.x, m.z, x, z); st.pi = 0; st.pathT = 3; st.goal = [x, z];
    }
    if (!st.path || !st.path.length) return goto(m, c, x, z, tol, speed);
    while (st.pi < st.path.length - 1 && Math.hypot(st.path[st.pi][0] - m.x, st.path[st.pi][1] - m.z) < 7) st.pi++;
    const [tx, tz] = st.path[st.pi];
    goto(m, c, tx, tz, 0, speed);
    return false;
  }

  // ------------------------------------------------------------ following the player in a loose convoy
  const SLOT = { dozer: [-7, -15], excavator: [7, -18], hauler: [0, -28] };   // [sideways, behind] the player
  function convoy(m, st, dt, pm) {
    const c = ctl(), [side, back] = SLOT[m.type];
    const fx = Math.sin(pm.yaw), fz = Math.cos(pm.yaw), lx = Math.cos(pm.yaw), lz = -Math.sin(pm.yaw);
    const x = clamp(pm.x + lx * side + fx * back, 5, 250), z = clamp(pm.z + lz * side + fz * back, 5, 250);
    const d = Math.hypot(x - m.x, z - m.z);
    if (d > (st.moving ? 4 : 11)) {
      st.moving = true;
      if (travel(m, st, c, x, z, 4, clamp(d / 25, .4, 1))) st.moving = false;
      unstick(m, st, c, dt);
    } else st.moving = false;
    if (m.type === 'dozer') c.tool = clamp((.35 - m.blade) * 5, -1, 1);
    if (m.type === 'hauler' && m.tipping) c.act = true;
    return c;
  }

  const BRAIN = { dozer, excavator, hauler };
  const state = new Map();
  const stOf = m => { let st = state.get(m); if (!st) { st = { state: 'start', stall: 0, rec: 0, lane: 0, dig: 0, t: 0, wp: 0, tries: 0, sg: 1, tt: 0 }; state.set(m, st); } return st; };
  function crewMachines() { return ROLES.map(t => G.machines.find(m => m.type === t)).filter(Boolean); }

  const restart = () => { for (const st of state.values()) { st.state = 'start'; st.wp = 0; st.path = null; } };
  function update(dt) {
    const player = G.machines[G.active()];
    for (const m of G.machines) if (!ROLES.includes(m.type)) m.ai = null;
    if (!on) { for (const m of G.machines) m.ai = null; return; }
    gridT -= dt; if (gridT <= 0) { gridT = 2; buildGrid(); }
    coolT -= dt;
    if (!site) {
      // the player has stopped at water too deep to drive through: build a crossing there
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw), ford = Math.min(.6, G.SPEC[player.type].ford);
      let deep = 0; for (let d = 3; d <= 10; d += 1.5) deep = Math.max(deep, G.wAt(player.x + fx * d, player.z + fz * d));
      if ((deep > ford && Math.abs(player.v) < .8) || player.blocked === 'deep') waitT += dt * (player.blocked === 'deep' ? 2 : 1); else waitT = 0;
      if (waitT > 1.5 && coolT <= 0) {
        waitT = 0; coolT = 6;
        site = siteAt(player);
        if (site) { const h = findHead(site); if (h === null) site = null; else { site.head = h; restart(); G.say('Crew: building a crossing'); } }
      }
    } else {
      // the player drove off: drop the job and follow
      if (Math.hypot(player.x - site.P[0], player.z - site.P[1]) > 90) awayT += dt; else awayT = 0;
      if (awayT > 6) { site = null; awayT = 0; restart(); }
      headT -= dt;
      if (site && headT <= 0) {
        headT = .5;
        const h = findHead(site);
        if (h === null) { G.crossed(site); site = null; coolT = 10; restart(); }   // nothing too deep left: done
        else site.head = h;
      }
    }
    for (const m of crewMachines()) {
      const st = stOf(m); st.dt = dt;
      if (m === player) {   // the player has this one: the worker steps out and the plan restarts when they hand it back
        m.ai = null; st.state = 'start'; st.wp = 0; st.rec = 0; st.path = null;
        if (site) unlock(site, m);
        continue;
      }
      m.ai = site ? BRAIN[m.type](m, st, dt, site) : convoy(m, st, dt, player);
    }
  }
  function setOn(v) {
    on = !!v;
    restart(); site = null; waitT = 0; coolT = 0;
    if (!on) for (const m of G.machines) m.ai = null;
  }
  return {
    update, setOn,
    get on() { return on; },
    isCrew: m => ROLES.includes(m.type),
    stateOf: m => (state.get(m) || {}).state,
    refresh() { for (const m of G.machines) { const st = state.get(m); if (st && m === G.machines[G.active()]) st.state = 'start'; } },
    get site() { return site; },
    buildAt(pm) { buildGrid(); const S = siteAt(pm); if (S) { const h = findHead(S); if (h !== null) { S.head = h; site = S; restart(); } } return site; },
    findPath: (m, x1, z1) => { buildGrid(); return findPath(m, m.x, m.z, x1, z1); },
    findHead, sOf, pt,
  };
}
