// The crew: four workers who drive the dozer, two excavators and the hauler, plus specialists who bring in a crane,
// roller, paver, mixer truck and utility truck when a job needs them. They follow the player around the valley
// in a loose convoy, finding their own way round deep water and steep ground. When the player stops at water too deep
// to drive through, they pick the narrowest place nearby and build a crossing there as a team: the excavator digs a
// borrow pit and loads the hauler, the hauler backs up to the water's edge and tips, and the dozer pushes the dirt out
// and grades the top. Then they fall in behind the player again.
// Each worker produces the same controls the player does (throttle, steer, tool, swing, act), so a machine behaves
// exactly the same whoever drives it. When the player takes a machine over, that worker sits out; the others carry on.
//
// A crossing site is a straight line across the water: s runs along it (0 = middle of the water, negative = our side)
// and o runs sideways. The "head" is how far along the line the built ground reaches.
//
// A crossing is a project built in stages. A small creek gets a causeway: culvert pipes first (so the water keeps
// flowing), earth fill, rock armour, geotextile and crushed-stone subbase, base course, asphalt or concrete paving,
// guardrails, markings and road studs, then the banks are hydroseeded. A big river gets a bridge: the near approach is
// filled, a crane sets abutments, piers and girders, the deck is poured over rebar, the far approach is built, then
// barriers, road layers, paving, markings, lights and signs.
export function makeCrew(G) {
  const { clamp, angWrap } = G;
  const ROLES = ['dozer', 'excavator', 'hauler'];
  let driveGrid = -1;
  let on = false, headT = 0, site = null, waitT = 0, coolT = 0, gridT = 0, lastDone = null;
  const roads = [];        // every project (finished ones stay, they're part of the valley)
  const equip = [];        // equipment brought in for the current stage
  const W = G.works;

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
  // the height the earthwork must reach at s: a causeway is graded level across; a bridge gets a ramp up to its deck
  function gradeAt(S, s) {
    if (S.kind === 'bridge') {
      if (s > S.sL || s < S.sL - 14) return -1e9;
      const g0 = S.rampFoot ?? (S.rampFoot = (() => { const [x, z] = pt(S, S.sL - 14, 0); return G.h0At(x, z); })());
      return g0 + (S.deckY - .5 - g0) * (s - (S.sL - 14)) / 14;
    }
    return S.top;
  }
  const endOf = S => S.kind === 'bridge' ? S.sL - .6 : S.far;
  // The fill front: how far along the line the finished embankment reaches. Truck loads and dozer pushes move it on
  // (the crew also keeps shaping it between loads), and the ground behind it is shaped into the embankment with side
  // slopes, so the earthwork can't stall or slide backwards.
  const fillStart = S => S.kind === 'bridge' ? S.sL - 14 : -S.cw - 2;
  function advance(S, d) { if (S.front !== undefined) S.front = Math.min(endOf(S) + .6, S.front + d); }
  function shapeFill(S, s0, s1) {
    const hw = S.w / 2 + 1.2;
    for (let s = s0; s <= s1; s += .5) {
      const y = S.kind === 'bridge' ? gradeAt(S, Math.min(s, S.sL)) : S.top;
      if (y < -1e8) continue;
      for (let o = -hw - 5; o <= hw + 5; o += .5) {
        const [x, z] = pt(S, s, o), i = Math.round(x), j = Math.round(z); if (i < 1 || j < 1 || i > 254 || j > 254) continue;
        const k = j * 256 + i, h = y - Math.max(0, Math.abs(o) - hw) / 1.8;
        if (G.H[k] < h) { const up = h - G.H[k]; G.H[k] = h; G.displace(k, up); G.D[k] = 1; if (G.M[k] === 0) G.M[k] = 1; G.dirty(k); }
      }
    }
  }
  // how far the earthwork reaches: the first point along the line still under water or below grade
  function findHead(S) {
    for (let s = S.Ls + 6; s <= endOf(S); s += 1) {
      let need = 0; const g = gradeAt(S, s);
      for (const o of [-1.6, 0, 1.6]) { const [x, z] = pt(S, s, o); need = Math.max(need, G.wAt(x, z) > .42 ? 1 : 0, G.hAt(x, z) < g - .35 ? 1 : 0); }
      if (need) return s;
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
  const LANES = [0, -3.2, 3.2, -1.6, 1.6];   // the outer lanes stay clear of the hauler, so the dozer needn't wait
  function dozer(m, st, dt, S) {
    const c = ctl(), s = sOf(S, m.x, m.z), head = S.head;
    const bladeTo = y => { c.tool = clamp((y - m.blade) * 5, -1, 1); };
    // blade height: cut the ground ahead down towards the crossing height, and fill anything lower up to it
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const g0 = G.h0At(m.x + fx * 3.2, m.z + fz * 3.2);
    const wantY = Math.max(gradeAt(S, s + 3.2), g0 - .3);   // push piles off at grade; skim the natural ground at most 30 cm
    const lane = LANES[st.lane % LANES.length];
    const start = head - 16;
    switch (st.state) {
      case 'start': st.state = 'go'; break;
      case 'go': {   // to the start of the lane (or a waiting spot beside it when the hauler is working the line)
        bladeTo(.35);
        st.goT = (st.goT || 0) + dt;
        if (st.goT > 25) { st.goT = 0; st.lane++; st.path = null; }   // can't get there: try another lane
        const outer = Math.abs(lane) > 3;
        const free = outer || S.lock === m || (!S.lock && !(G.time() - (S.waitAt || -9) < .5));   // a loaded hauler goes first
        const [x, z] = free ? pt(S, start, lane) : pt(S, start - 2, -7.5);
        const s0 = sOf(S, m.x, m.z), o0 = oOf(S, m.x, m.z);
        if (free && facing(m, S) < .5 && s0 > start + 1 && Math.abs(o0 - lane) < 3) { follow(m, c, S, lane, -1, .8, true); break; }   // back straight down the lane
        if (travel(m, st, c, x, z, free ? 1.8 : 2.5, .7)) {
          if (free && (outer || lock(S, m))) { st.state = 'turn'; st.goT = 0; } else c.throttle = 0;
        }
        break;
      }
      case 'turn': {   // face across the river
        bladeTo(.35); st.credited = false;
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
        if ((empty || m.blocked === 'deep') && front > S.head - 3 && !st.credited) { advance(S, 1.0); st.credited = true; }
        if (front > endOf(S) + (S.kind === 'bridge' ? 0 : 2) || empty || st.t > 28 || (m.blocked === 'deep' && st.t > 1) || (st.t > 3 && Math.abs(m.v) < .08)) { st.state = 'back'; st.t = 0; }
        break;
      }
      case 'back': {
        st.t += dt;
        bladeTo(Math.max(m.blade, .25));
        follow(m, c, S, lane, -1, .8, true);
        if (s < start || st.t > 20) {
          st.lane++; if (S.lock && S.lock !== m && Math.abs(LANES[st.lane % LANES.length]) < 3) st.lane++;   // hauler on the line: take an outer lane
          st.state = 'go'; unlock(S, m);
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
    const side = st.side || 1, E = pt(S, S.Ls, 5.8 * side);
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
            const [x, z] = pt(S, S.Ls - 5.5 - (q % 3) * 1.6 - ring * 1.2, side * (6.3 + (Math.floor(q / 3) - 1) * 1.7));
            if (G.hAt(x, z) > base - 3.2) { tx = x; tz = z; break; }
            st.dig++;
          }
          if (tx === undefined) { const [x, z] = pt(S, S.Ls - 6, 6.3 * side); tx = x; tz = z; }
          mode = 'dig';
        } else {
          // tip into the hauler when it is parked within reach (whoever is driving it)
          const b = h ? G.bedPoint(h) : pt(S, S.Ls, 0);
          const ready = h && Math.abs(h.v) < .2 && !h.tipping && h.load.v < G.SPEC.hauler.cap - .4 && Math.hypot(b[0] - m.x, b[1] - m.z) < 9;
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
      if (Math.abs(o) < 14 && s > S.Ls - 16) continue;   // the excavators and their pits
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
        if ((!m.tipping && st.t > 1.2 && m.tip < .05) || st.t > 16) { if (m.tipping) c.act = true; st.state = 'return'; st.t = 0; advance(S, 2.4); }
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
      gH[j * GN + i] = G.gAt(x, z);
      gDepth[j * GN + i] = Math.max(G.wetAt(x - .5, z - .5), G.wetAt(x + .5, z - .5), G.wetAt(x - .5, z + .5), G.wetAt(x + .5, z + .5));
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
    const c = ctl(), [side, back] = m.type === 'excavator' && stOf(m).side === -1 ? [-15, -24] : SLOT[m.type];
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
  // the core crew: the dozer, two excavators and the hauler (whichever of those the player isn't driving)
  function crewMachines() {
    const out = [], ex = G.machines.filter(m => m.type === 'excavator' && !m.equip);
    const d = G.machines.find(m => m.type === 'dozer'), h = G.machines.find(m => m.type === 'hauler' && !m.equip);
    if (d) out.push(d); ex.slice(0, 2).forEach((m, i) => { stOf(m).side = i ? -1 : 1; out.push(m); }); if (h) out.push(h);
    return out;
  }
  const restart = () => { for (const st of state.values()) { st.state = 'start'; st.wp = 0; st.path = null; st.rec = 0; } };

  // ------------------------------------------------------------ planning a crossing
  // A wide or deep river gets a bridge; a creek gets a causeway with culverts. The crew picks the surface and girders.
  function plan(S) {
    const P = Object.assign(S, { w: 6, seed: Math.floor(Math.random() * 1e6), si: 0, cut: {}, placed: 0, pipes: 0, stageT: 0 });
    let deep = 0, bed = 1e9, bedS = 0;
    for (let s = -S.cw; s <= S.cw; s += .5) { const [x, z] = pt(S, s, 0); deep = Math.max(deep, G.wAt(x, z)); const h = G.h0At(x, z); if (h < bed) { bed = h; bedS = s; } }
    const span = 2 * (S.cw - 1);
    P.kind = span > 12 || deep > 1.35 ? 'bridge' : 'causeway';
    P.top = S.lvl + 1.0;
    P.sA = -(S.cw + 12); P.sB = S.cw + 12;
    if (P.kind === 'bridge') {
      P.deckY = S.lvl + 2.2; P.sL = -S.cw; P.sR = S.cw;
      const n = Math.max(1, Math.ceil((P.sR - P.sL) / 12)) - 1;
      P.piers = Array.from({ length: n }, (_, i) => +(P.sL + (P.sR - P.sL) * (i + 1) / (n + 1)).toFixed(2));
      P.girder = (P.sR - P.sL) / (n + 1) > 10 ? 'steel' : 'concrete';
      P.surface = 'asphalt';
    } else {
      // pipes under the causeway, centred on the deepest part of the channel, sized to the creek
      const k = clamp(Math.round(span / 4), 1, 3), r = .6, len = P.w + 2 * (P.top - bed) * 2 + 2;
      P.culverts = Array.from({ length: k }, (_, i) => ({ s: +(bedS + (i - (k - 1) / 2) * 1.8).toFixed(2), r, y: +(bed + .05).toFixed(2), len: +len.toFixed(1) }));
      P.surface = deep > .9 ? 'concrete' : 'asphalt';   // a low crossing that may flood gets concrete
    }
    P.stages = P.kind === 'bridge'
      ? ['ramp', 'crane', 'deck', 'farRamp', 'barriers', 'subbase', 'base', 'surface', 'markings', 'lights', 'seed']
      : ['culverts', 'fill', 'riprap', 'subbase', 'base', 'surface', 'rails', 'markings', 'seed'];
    return P;
  }
  const stage = P => P.stages[P.si];
  const TITLE = {
    culverts: () => 'Culvert pipes', fill: () => 'Earth fill', ramp: () => 'Approach fill', riprap: () => 'Riprap',
    subbase: () => 'Subbase', base: () => 'Base course', surface: P => P.surface === 'concrete' ? 'Concrete paving' : 'Asphalt paving',
    rails: () => 'Guardrails', markings: () => 'Markings', seed: () => 'Hydroseeding', crane: P => P.girder === 'steel' ? 'Piers + steel girders' : 'Piers + concrete girders',
    deck: () => 'Deck pour', farRamp: () => 'Far approach', barriers: () => 'Barriers', lights: () => 'Lights + signs',
  };
  // which equipment each stage brings in; who leads it along the road and who follows behind
  const STG = {
    culverts: { equip: ['crane'] },
    fill: { earth: true }, ramp: { earth: true },
    riprap: { lead: ['excavator', 'dozer'], o: 3.6, dur: 40 },
    subbase: { lead: ['dozer', 'hauler', 'excavator'], follow: 'roller', equip: ['roller'], dur: 45 },
    base: { lead: ['dozer', 'hauler', 'excavator'], follow: 'roller', equip: ['roller'], dur: 38 },
    surface: { lead: ['paver'], follow: 'roller', equip: ['paver', 'roller'], dur: 55, concrete: ['paver', 'mixer'] },
    rails: { lead: ['truck'], equip: ['truck'], o: -1.5, dur: 40 },
    barriers: { lead: ['truck'], equip: ['truck'], o: -1.5, dur: 40 },
    markings: { lead: ['truck'], equip: ['truck'], dur: 32 },
    lights: { lead: ['truck'], equip: ['truck'], o: 1.5, dur: 28 },
    seed: { lead: ['truck'], equip: ['truck'], o: 2, dur: 24 },
    crane: { equip: ['crane', 'truck'] },
    deck: { equip: ['mixer'], dur: 70 },
    farRamp: { lead: ['dozer'], o: 0, dur: 45 },
  };
  function stageEquip(P) { const d = STG[stage(P)] || {}; return stage(P) === 'surface' && P.surface === 'concrete' ? d.concrete : d.equip || []; }

  // ------------------------------------------------------------ equipment comes in for a stage and leaves after
  function spawnPoint(P) {
    for (const [s, o] of [[P.Ls - 30, 0], [P.Ls - 20, -12], [P.Ls - 20, 12], [P.Ls - 10, -18], [P.Ls - 10, 18], [P.Ls, -20]]) {
      const [x, z] = pt(P, s, o); if (x > 6 && z > 6 && x < 249 && z < 249 && G.wAt(x, z) < .05) return [x, z];
    }
    return pt(P, P.Ls - 8, 0);
  }
  function syncEquip(P) {
    const want = P && !P.done ? stageEquip(P) : [];
    for (const t of want) if (!equip.some(m => m.type === t && !m.leaving)) {
      const yw = Math.atan2(P.u[0], P.u[1]), [x0, z0] = spawnPoint(P), [x, z] = G.freeSpot(t, x0, z0, yw), m = G.makeMachine(t, x, z, yw, true);
      equip.push(m); stOf(m).state = 'start';
    }
    for (const m of equip) if (!want.includes(m.type) && !m.leaving && !(P && !P.done && stillNeeded(P, m.type))) { m.leaving = true; stOf(m).state = 'leave'; m.leaveAt = P ? spawnPoint(P) : [m.x, m.z]; }
  }
  // keep a machine on site if a later stage needs it soon (the roller does several layers in a row)
  function stillNeeded(P, t) { for (let i = P.si + 1; i < Math.min(P.stages.length, P.si + 3); i++) { const d = STG[P.stages[i]] || {}; if ((d.equip || []).includes(t)) return true; } return false; }
  function leave(m, st, dt) {
    const c = ctl(), [x, z] = m.leaveAt;
    st.t = (st.t || 0) + dt;
    if (travel(m, st, c, x, z, 5, .9) || st.t > 60) { G.removeMachine(m); equip.splice(equip.indexOf(m), 1); }
    return c;
  }

  // ------------------------------------------------------------ the stages that run along the road
  // The lead machine drives the length of the road at a steady pace and the layer appears behind it; a follower
  // (the roller) works behind the lead. Progress is wherever the lead has got to.
  const parkSpot = (P, i) => pt(P, P.sA - 8 - (i % 3) * 5, (i % 2 ? -1 : 1) * (P.w / 2 + 7 + Math.floor(i / 2) * 4));
  function park(m, st, dt, P, i) {
    const c = ctl(), [x, z] = parkSpot(P, i);
    if (!travel(m, st, c, x, z, 3, .6)) unstick(m, st, c, dt);
    if (m.type === 'dozer') c.tool = clamp((.35 - m.blade) * 5, -1, 1);
    if (m.type === 'hauler' && m.tipping) c.act = true;
    return c;
  }
  function range(P) {
    const id = stage(P);
    if (id === 'farRamp') return [P.sR + .5, P.sB];
    if (id === 'riprap') return [-P.cw - 2, P.cw + 2];
    if (id === 'barriers' || id === 'lights') return P.kind === 'bridge' ? [P.sA + 1, P.sB - 1] : [P.sA, P.sB];
    return [P.sA, P.sB];
  }
  function leadRun(m, st, dt, P, d) {
    const c = ctl(), [s0, s1] = range(P), o = d.o || 0, s = sOf(P, m.x, m.z), spd = (s1 - s0) / (d.dur || 40);
    switch (st.state) {
      case 'start': st.state = 'toStart'; break;
      case 'toStart': {   // come in from behind the start, lined up along the road
        const [x, z] = pt(P, s0 - 9, o);
        if (travel(m, st, c, x, z, 3, .7)) st.state = 'align';
        unstick(m, st, c, dt);
        break;
      }
      case 'align': {
        const [x, z] = pt(P, s0, o), [sv, e] = steerTo(m, x, z, false);
        c.steer = sv; c.throttle = G.SPEC[m.type].tracks ? (Math.abs(e) < .3 ? .3 : 0) : .25;
        if (s >= s0 - .5) st.state = 'work';
        if (Math.hypot(x - m.x, z - m.z) > 16) st.state = 'toStart';
        break;
      }
      case 'work': {
        follow(m, c, P, o, 1, clamp(spd / G.SPEC[m.type].vmax, .1, .6));
        if (m.type === 'dozer') c.tool = clamp((-.1 - m.blade) * 5, -1, 1);
        if (m.type === 'excavator') { c.swing = Math.sin(G.time() * 1.3) * .7; c.tool = Math.sin(G.time() * .9) * .6; }
        if (m.type === 'paver') m.paving = true;
        P.lead = Math.max(P.lead ?? -1e9, s);
        if (s >= s1) { st.state = 'done'; m.paving = false; }
        break;
      }
      case 'done': c.throttle = 0; break;
    }
    return c;
  }
  function followRun(m, st, dt, P, d) {
    const c = ctl(), [s0] = range(P), o = (d.o || 0) + (m.type === 'mixer' ? 4 : 0), s = sOf(P, m.x, m.z);
    const lead = P.lead ?? s0 - 12, want = m.type === 'mixer' ? lead + 3 : lead - 7;   // the roller trails; the mixer feeds alongside
    if (st.state === 'start' || st.state === 'toStart') {
      st.state = 'toStart';
      const [x, z] = pt(P, s0 - 18, o);
      if (travel(m, st, c, x, z, 4, .7)) st.state = 'work';
      unstick(m, st, c, dt);
      return c;
    }
    if (s < want - .5) follow(m, c, P, o, 1, m.type === 'roller' ? .5 : .3);
    else if (m.type === 'roller' && s > want + 4) follow(m, c, P, o, -1, .4, true);   // rolling back and forth over the fresh layer
    if (m.type === 'mixer') m.pouring = s > s0;
    return c;
  }
  // what each stage does to the world as its lead moves along the road
  function applyLead(P, dt) {
    const id = stage(P), L = P.lead ?? -1e9, c = P.cut;
    if (id === 'riprap') c.rip = L;
    if (id === 'subbase') { c.geo = L + 3; c.sub = L - 1; W.raise(P, P.sA, L - 1, 'sub'); }
    if (id === 'base') { c.base = L - 1; W.raise(P, P.sA, L - 1, 'base'); }
    if (id === 'surface') { c.surf = L - 2; W.raise(P, P.sA, L - 2, 'surf', 3); }
    if (id === 'rails' || id === 'barriers') { c.rails = L - 1; if (id === 'barriers') c.barrier = L - 1; }
    if (id === 'markings') { c.seal = L + 2; c.mark = L - 1; c.studs = L - 1; }
    if (id === 'lights') c.lights = L;
    if (id === 'farRamp') W.raise(P, P.sR, L + 2, 'geo', 1.8);
    if (id === 'seed') {   // the bare slopes either side go back to grass
      for (let o = P.w / 2 + 1; o < P.w / 2 + 9; o += .7) for (const sd of [-1, 1]) {
        const [x, z] = pt(P, L, sd * o), i = Math.round(x), j = Math.round(z); if (i < 1 || j < 1 || i > 254 || j > 254) continue;
        const k = j * 256 + i; if (G.W[k] < .05 && G.D[k] && G.M[k] !== 2) { G.D[k] = 0; G.M[k] = 0; G.dirty(k); }
      }
      if (Math.random() < dt * 8) { const [x, z] = pt(P, L, (Math.random() < .5 ? -1 : 1) * (P.w / 2 + 3)); G.spray(x, G.hAt(x, z) + 1, z); }
    }
    W.refresh(P);
  }

  // ------------------------------------------------------------ the crane: culvert pipes, abutments, piers and girders
  function craneJob(m, st, dt, P) {
    const c = ctl(), hw = P.w / 2, C = P.kind === 'bridge' ? pt(P, P.sL - 5, -(hw + 4.5)) : pt(P, -P.cw - 7, -(hw + 6));
    const list = P.kind === 'bridge' ? P.items : P.culverts, n = list.length, done = P.kind === 'bridge' ? P.placed : P.pipes;
    const cr = m.cr || (m.cr = { sw: 0, el: .15, ext: 0, drop: 2, out: 0, t: { sw: 0, el: .15, ext: 0, drop: 2, out: 0 }, load: null });
    const aim = (x, z, y) => {   // turn, raise and run out the boom so the hook hangs over x, z at height y
      const hp = new G.THREE.Vector3(); m.house.getWorldPosition(hp);
      const R = Math.max(1, Math.hypot(x - hp.x, z - hp.z) - .3), Lmin = 12.6, Lmax = 32.6;
      const L = clamp(R / Math.cos(.62), Lmin, Lmax), el = Math.acos(clamp(R / L, 0, 1));
      cr.t.sw = angWrap(Math.atan2(x - hp.x, z - hp.z) - m.yaw); cr.t.el = el; cr.t.ext = (L - Lmin) / (Lmax - Lmin);
      cr.t.drop = clamp(hp.y + 1.4 + L * Math.sin(el) - y, 1, 40);
    };
    const there = () => Math.abs(angWrap(cr.t.sw - cr.sw)) < .03 && Math.abs(cr.t.el - cr.el) < .02 && Math.abs(cr.t.ext - cr.ext) < .02 && Math.abs(cr.t.drop - cr.drop) < .15;
    st.t = (st.t || 0) + dt;
    switch (st.state) {
      case 'start': st.state = 'go'; break;
      case 'go': if (travel(m, st, c, C[0], C[1], 3, .7)) { st.state = 'setup'; st.t = 0; } unstick(m, st, c, dt); break;
      case 'setup': cr.t.out = 1; if (st.t > 3) { st.state = 'pick'; st.t = 0; } break;
      case 'pick': {   // hook down to the pieces stacked beside the crane
        if (done >= n) { st.state = 'stow'; break; }
        const [kx, kz] = pt(P, (P.kind === 'bridge' ? P.sL - 13 : -P.cw - 15), -(hw + 9));
        aim(kx, kz, G.hAt(kx, kz) + .8);
        if (there() || st.t > 9) { st.state = 'hoist'; st.t = 0; cr.load = P.kind === 'bridge' ? P.items[done].mesh() : pipeMesh(P.culverts[done]); G.scene.add(cr.load); cr.load.position.set(0, -999, 0); }
        break;
      }
      case 'hoist': cr.t.drop = Math.max(2, cr.drop - 6); if (st.t > 2) { st.state = 'swing'; st.t = 0; } break;
      case 'swing': case 'set': {
        const it = list[done], [x, z] = pt(P, it.s, it.o || 0), y = (it.y ?? it.y) + (st.state === 'swing' ? 2.5 : .9);
        aim(x, z, y);
        if (there() || st.t > 10) {
          if (st.state === 'swing') { st.state = 'set'; st.t = 0; }
          else { G.scene.remove(cr.load); cr.load = null; if (P.kind === 'bridge') P.placed++; else P.pipes++; W.refresh(P); st.state = 'pick'; st.t = 0; G.clang(x, y, z); }
        }
        break;
      }
      case 'stow': cr.t.el = .15; cr.t.ext = 0; cr.t.drop = 2; cr.t.sw = 0; if (st.t > 4) cr.t.out = 0; break;
    }
    if (st.state !== 'go') { c.throttle = 0; }
    return c;
  }
  function pipeMesh(cv) {
    const m = new G.THREE.Mesh(new G.THREE.CylinderGeometry(cv.r, cv.r, 3, 16, 1, true).rotateZ(Math.PI / 2), G.pipeMat);
    m.material.side = G.THREE.DoubleSide; return m;
  }
  const craneDone = P => (P.kind === 'bridge' ? P.placed >= P.items.length : P.pipes >= P.culverts.length);

  // ------------------------------------------------------------ the mixer pours the bridge deck
  function deckJob(m, st, dt, P) {
    const c = ctl(), [x, z] = pt(P, P.sL - 6, 0);
    if (st.state === 'start' || st.state === 'go') {
      st.state = 'go';
      if (travel(m, st, c, x, z, 3, .7)) st.state = 'pour';
      unstick(m, st, c, dt);
      P.cut.form = P.sR + 1; P.cut.rebar = P.sR + 1; W.refresh(P);
      return c;
    }
    m.pouring = true;
    P.cut.deck = Math.min(P.sR + .5, (P.cut.deck ?? P.sL - .5) + (P.sR - P.sL + 1) / (STG.deck.dur) * dt);
    P.cut.rebar = P.sR + 1;
    W.refresh(P);
    if (P.cut.deck >= P.sR + .5) { m.pouring = false; P.cut.form = -1e9; P.cut.rebar = -1e9; }
    return c;
  }

  // ------------------------------------------------------------ running a project
  let proj = null;
  function startStage(P) {
    P.lead = undefined; P.stageT = 0; restart();
    const id = stage(P);
    if (id === 'subbase' && !P.prof) designProfile(P);
    G.status(TITLE[id](P));
    if (P.si > 0) G.say('Crew: ' + TITLE[id](P));
  }
  // the road's height along its line once the earthwork is in (for a bridge, the far approach is designed, not measured)
  function designProfile(P) {
    W.profile(P);
    if (P.kind === 'bridge') {
      const n = P.prof.length, base = P.deckY - .5;
      const [fx, fz] = pt(P, P.sR + 14, 0), foot = G.h0At(fx, fz);
      for (let i = 0; i < n; i++) {
        const s = P.sA + i;
        if (s >= P.sL - .5 && s <= P.sR + .5) P.prof[i] = base;
        else if (s > P.sR) P.prof[i] = +(s < P.sR + 14 ? base + (foot - base) * (s - P.sR) / 14 : Math.max(P.prof[i], foot)).toFixed(3);
        else if (s > P.sL - 14) P.prof[i] = +Math.max(P.prof[i], gradeAt(P, s) - .02).toFixed(3);
      }
    }
  }
  function stageDone(P) {
    const id = stage(P), d = STG[id] || {};
    if (d.earth) return false;   // checked from the head
    if (id === 'culverts' || id === 'crane') return craneDone(P);
    if (id === 'deck') return (P.cut.deck ?? -1e9) >= P.sR + .5;
    const [, s1] = range(P); return (P.lead ?? -1e9) >= s1;
  }
  function nextStage(P) {
    const id = stage(P);
    if (id === 'culverts') for (const cv of P.culverts) G.addCulvert(P, cv);
    if (id === 'fill' || id === 'ramp') designProfile(P);
    if (id === 'farRamp') W.raise(P, P.sR, P.sB, 'geo', 1.8);
    P.si++;
    if (P.si >= P.stages.length) {
      P.done = true; proj = null; lastDone = P.P; coolT = 10; restart(); syncEquip(null);
      G.status(''); G.crossed(P);
      return;
    }
    if (stage(P) === 'subbase' && !P.prof) designProfile(P);
    W.build(P);
    startStage(P);
    syncEquip(P);
  }
  function runProject(dt) {
    const P = proj;
    P.stageT += dt;
    const id = stage(P), d = STG[id] || {};
    if (d.earth) {
      if (P.front === undefined) P.front = fillStart(P);
      const was = P.front;
      advance(P, dt * .07);   // the crew keeps shaping between loads
      if (Math.floor(P.front * 2) !== Math.floor(was * 2)) shapeFill(P, fillStart(P), P.front);
      P.head = P.front;
      if (P.front >= endOf(P) + .5) { shapeFill(P, fillStart(P), endOf(P) + .5); nextStage(P); }
    } else {
      applyLead(P, dt);
      if (stageDone(P)) nextStage(P);
    }
    if (proj) { const [s0, s1] = range(proj); G.status(TITLE[stage(proj)](proj), statusPct(proj, s0, s1)); }
  }
  function statusPct(P, s0, s1) {
    const id = stage(P), d = STG[id] || {};
    if (d.earth) return clamp(((P.front ?? fillStart(P)) - fillStart(P)) / (endOf(P) + .5 - fillStart(P)), 0, 1);
    if (id === 'culverts' || id === 'crane') return (P.kind === 'bridge' ? P.placed / P.items.length : P.pipes / P.culverts.length);
    if (id === 'deck') return clamp(((P.cut.deck ?? P.sL) - P.sL) / (P.sR - P.sL + .5), 0, 1);
    return clamp(((P.lead ?? s0) - s0) / (s1 - s0), 0, 1);
  }
  // who does what in the current stage
  function brain(m, st, dt, P) {
    const id = stage(P), d = STG[id] || {};
    if (d.earth) return ROLES.includes(m.type) ? BRAIN[m.type](m, st, dt, P) : park(m, st, dt, P, 0);
    if (id === 'culverts' || id === 'crane') {
      if (m.type === 'crane') return craneJob(m, st, dt, P);
      if (m.type === 'truck') { const c = ctl(), [x, z] = pt(P, (P.kind === 'bridge' ? P.sL - 13 : -P.cw - 15), -(P.w / 2 + 13)); travel(m, st, c, x, z, 3, .7); return c; }
    }
    if (id === 'deck' && m.type === 'mixer') return deckJob(m, st, dt, P);
    const leads = (stage(P) === 'surface' && P.surface === 'concrete') ? ['paver'] : d.lead || [];
    const leadM = pickLead(P, leads);
    if (m === leadM) return leadRun(m, st, dt, P, d);
    if ((d.follow && m.type === d.follow) || (id === 'surface' && P.surface === 'concrete' && m.type === 'mixer')) return followRun(m, st, dt, P, d);
    return park(m, st, dt, P, crewMachines().indexOf(m) + 1);
  }
  function pickLead(P, types) {
    const player = G.machines[G.active()];
    for (const t of types) { const m = [...crewMachines(), ...equip].find(q => q.type === t && q !== player && !q.leaving); if (m) return m; }
    return null;
  }

  function update(dt) {
    const player = G.machines[G.active()];
    for (const m of G.machines) if (!ROLES.includes(m.type) && !m.equip) m.ai = null;
    if (!on) { for (const m of G.machines) m.ai = null; return; }
    gridT -= dt; if (gridT <= 0) { gridT = 2; buildGrid(); }
    coolT -= dt;
    if (!proj) {
      // the player has stopped at water too deep to drive through: plan a crossing there
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw), ford = Math.min(.6, G.SPEC[player.type].ford);
      let deep = 0; for (let d = 3; d <= 10; d += 1.5) deep = Math.max(deep, G.wetAt(player.x + fx * d, player.z + fz * d));
      if ((deep > ford && Math.abs(player.v) < .8) || player.blocked === 'deep') waitT += dt * (player.blocked === 'deep' ? 2 : 1); else waitT = 0;
      const nearDone = lastDone && Math.hypot(player.x - lastDone[0], player.z - lastDone[1]) < 30;   // just finished one here
      if (waitT > 1.5 && coolT <= 0 && !nearDone) {
        waitT = 0; coolT = 6;
        const S = siteAt(player);
        if (S) { const h = findHead(S); if (h !== null) begin(plan(S), h); }
      }
    } else runProject(dt);
    site = proj;
    syncEquip(proj);
    for (const m of crewMachines()) {
      const st = stOf(m); st.dt = dt;
      if (m === player) {   // the player has this one: the worker steps out and the plan restarts when they hand it back
        m.ai = null; st.state = 'start'; st.wp = 0; st.rec = 0; st.path = null;
        if (proj) unlock(proj, m);
        continue;
      }
      m.ai = proj ? brain(m, st, dt, proj) : (G.lend && G.lend(m, st, dt)) || convoy(m, st, dt, player);
    }
    for (const m of [...equip]) { const st = stOf(m); st.dt = dt; m.ai = m.leaving ? leave(m, st, dt) : proj ? brain(m, st, dt, proj) : leave(m, st, dt); }
  }
  function begin(P, head) {
    P.head = head; proj = P; roads.push(P);
    W.build(P); startStage(P); syncEquip(P);
    G.say(P.kind === 'bridge' ? 'Crew: building a bridge' : 'Crew: building a causeway');
  }
  function setOn(v) {
    on = !!v;
    restart(); waitT = 0; coolT = 0; lastDone = null;
    if (!on) { for (const m of G.machines) m.ai = null; for (const m of [...equip]) { G.removeMachine(m); } equip.length = 0; G.status(''); }
    else if (proj) { syncEquip(proj); startStage(proj); }
  }
  // saving: plain data for every project (meshes are rebuilt on load)
  const KEEP = ['name', 'P', 'u', 'p', 'lvl', 'cw', 'Ls', 'far', 'head', 'front', 'kind', 'w', 'seed', 'surface', 'girder', 'top', 'deckY', 'sL', 'sR', 'sA', 'sB', 'piers', 'culverts', 'si', 'cut', 'placed', 'pipes', 'prof', 'done', 'stages', 'rampFoot'];
  function serialize() { return { roads: roads.map(P => Object.fromEntries(KEEP.filter(k => P[k] !== undefined).map(k => [k, P[k]]))), cur: proj ? roads.indexOf(proj) : -1, lastDone }; }
  function restore(d) {
    if (!d) return;
    for (const r of d.roads || []) {
      const P = Object.assign({ lock: null }, r); roads.push(P);
      W.build(P);
      if (P.kind === 'causeway' && P.culverts && P.stages.indexOf('culverts') < P.si) for (const cv of P.culverts) G.addCulvert(P, cv);
    }
    if (d.cur >= 0 && roads[d.cur] && !roads[d.cur].done) proj = roads[d.cur];
    lastDone = d.lastDone || null;
  }
  return {
    update, setOn, serialize, restore,
    get on() { return on; },
    isCrew: m => ROLES.includes(m.type),
    stateOf: m => (state.get(m) || {}).state,
    refresh() { for (const m of G.machines) { const st = state.get(m); if (st && m === G.machines[G.active()]) st.state = 'start'; } },
    get site() { return proj; }, get roads() { return roads; }, get equip() { return equip; },
    stage: () => proj ? stage(proj) : null,
    buildAt(pm) { buildGrid(); const S = siteAt(pm); if (S) { const h = findHead(S); if (h !== null) begin(plan(S), h); } return proj; },
    findPath: (m, x1, z1) => { buildGrid(); return findPath(m, m.x, m.z, x1, z1); },
    skipStage() { if (proj) nextStage(proj); },
    findHead, sOf, pt,
    // drive any machine somewhere with the crew's route finding (used by the trucks of the building crew)
    drive(m, x, z, tol = 3, speed = .8) { const st = stOf(m), c = ctl(); st.dt = G.dt(); if (G.time() - driveGrid > 2 || driveGrid < 0) { if (!on) buildGrid(); driveGrid = G.time(); } const there = travel(m, st, c, x, z, tol, speed); unstick(m, st, c, st.dt); return { c, there }; },
  };
}
