// Parking lots: their layout (rows of stalls, aisles, driveways to the street) and the cars that drive in, park,
// and back out again. Shared by the drawing (draw.js) and the town (life.js). No three.js here (runs in Node).
import { along, closestOnPoly, halfW, WALK_W, TYPES } from './net.js';

const STALL_W = 2.6, STALL_D = 5, ROW_GAP = 5.2, AISLE = 6.4;
// a lot's own frame: x along its rows, z across them (for a lot in front of a building, +z points to the street)
export function frame(l) {
  const r = l.rot || 0, c = Math.cos(r), s = Math.sin(r);
  return { c, s, W: (x, z) => { const u = x - l.x, v = z - l.z; return [l.x + u * c - v * s, l.z + u * s + v * c]; }, L: (x, z) => { const u = x - l.x, v = z - l.z; return [l.x + u * c + v * s, l.z - u * s + v * c]; } };
}
// rows of head-in stalls: a row, an aisle, two rows back to back, an aisle, ... (in the lot's frame, x0..x1 / z0..z1)
export function layout(l) {
  if (l._lay && l._lay.key === l.x + ',' + l.z + ',' + l.w + ',' + l.d + ',' + (l.rot || 0)) return l._lay;
  const x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, z0 = l.z - l.d / 2, z1 = l.z + l.d / 2, rows = [];
  let z = z0 + (l.bid ? 3.2 : 1), row = 0;   // (a business's lot: a walkway along the shopfront first)
  const fuel = pumpZone(l);   // a gas station: one row of stalls by the shop, the pumps under a canopy beyond
  while (z + ROW_GAP <= z1 - 1 && !(fuel && row >= 1)) {
    const flip = row % 2, stalls = [];
    const aisle = flip ? z - AISLE / 2 : Math.min(z1 - 1.8, z + ROW_GAP + AISLE / 2);   // where cars back out to
    for (let x = x0 + 1, i = 0; x + STALL_W <= x1 - 1; x += STALL_W, i++) stalls.push({ x: x + STALL_W / 2, z: z + 2.6, i });
    // the ends of each row stay clear for a planted island (wider lots)
    const isl = l.w > 22 && stalls.length > 7 ? 1 : 0;
    let st = stalls.slice(isl, stalls.length - isl), access = null;
    // a business's lot: a clear lane through the rows past the first, in line with each driveway, so cars can reach the aisles behind
    if (l.bid && row > 0) { const xs = l.w > 26 ? [l.x - (l.w / 2 - 5.5), l.x + (l.w / 2 - 5.5)] : [l.x]; st = st.filter(o => xs.every(x => Math.abs(o.x - x) > 3.6)); }
    if (row === 0 && st.length > 6) { const m = Math.floor(st.length / 2); access = { x: st[m].x, ax: st[m + 1].x }; st = st.filter((_, j) => j !== m + 1); }   // the accessible stall nearest the door, and its striped aisle (nobody parks there)
    rows.push({ z, flip, aisle, stalls: st, island: isl, ends: [x0 + 1, x1 - 1], access });
    z += flip ? ROW_GAP : ROW_GAP + AISLE; row++;
  }
  l._lay = { key: l.x + ',' + l.z + ',' + l.w + ',' + l.d + ',' + (l.rot || 0), rows, x0, x1, z0, z1 };
  Object.defineProperty(l, '_lay', { enumerable: false, writable: true, value: l._lay });   // (never saved)
  return l._lay;
}
// a gas station's forecourt: the strip of the lot (in its own frame, z from..to) left for the pump canopy, or null
export const PUMP_FROM = 3.2 + 5.2 + 6.4;
export function pumpZone(l) { const z0 = l.z - l.d / 2, z1 = l.z + l.d / 2; return l.fuel && z1 - z0 - PUMP_FROM >= 11 ? [z0 + PUMP_FROM, z1 - .8] : null; }
// where a lot meets its street: the side facing the nearest road, one or two driveways across the sidewalk
export function entries(l, net) {
  let best = null, bd = 90;
  for (const e of net.edges.values()) {
    if (e.ring || e.lv || !e.bb || e.bb[0] - 90 > l.x || e.bb[1] + 90 < l.x || e.bb[2] - 90 > l.z || e.bb[3] + 90 < l.z) continue;
    const c = closestOnPoly(e.pts, e.cum, l.x, l.z); if (c.d < bd) { bd = c.d; best = { e, c }; }
  }
  if (!best) return [];
  const F = frame(l), lc = F.c, ls = F.s;
  const q = along(best.e.pts, best.e.cum, best.c.s), dx = q[0] - l.x, dz = q[1] - l.z, lx = dx * lc + dz * ls, lz = -dx * ls + dz * lc;
  const alongX = Math.abs(lx) > Math.abs(lz), sgn = alongX ? Math.sign(lx) : Math.sign(lz);
  const n = alongX ? [lc * sgn, ls * sgn] : [-ls * sgn, lc * sgn], t = [-n[1], n[0]];
  const half = alongX ? l.w / 2 : l.d / 2, span = alongX ? l.d : l.w, hw = halfW(best.e);
  const us = span > 26 ? [-(span / 2 - 5.5), span / 2 - 5.5] : [0], out = [];
  for (const u of us) {
    const P = [l.x + n[0] * half + t[0] * u, l.z + n[1] * half + t[1] * u];
    const c = closestOnPoly(best.e.pts, best.e.cum, P[0], P[1]); if (c.d - hw > 30 || c.d - hw < .8) continue;
    const r = along(best.e.pts, best.e.cum, c.s); if (Math.abs((r[0] - P[0]) * n[0] + (r[1] - P[1]) * n[1]) < c.d * .8) continue;   // the street isn't straight out from here
    const L = c.d - hw;
    out.push({ P, n, t, L, u, e: best.e, s: c.s, alongX, sgn, K: [P[0] + n[0] * L, P[1] + n[1] * L] });
  }
  return out;
}
const cumOf = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
export const typeOf = roll => { let a = 0; for (const t of TYPES) { a += t.share; if (roll < a) return t.k; } return 'car'; };

// ---------- driving in the lot: smooth paths, speeds, and waiting for gaps ----------
const R_TURN = 3.4;            // turning circle in the lot (m)
const KEEP = 1.4;              // keep right of the middle of an aisle or a driveway
// a cubic curve from pose a ([x, z] heading [hx, hz]) to pose b, bent like a car would steer it
function curve(a, ha, b, hb, out) {
  const dx = b[0] - a[0], dz = b[1] - a[1], ch = Math.hypot(dx, dz); if (ch < .05) return;
  let k0 = ch * .4, k1 = ch * .4;
  const den = ha[0] * hb[1] - ha[1] * hb[0];
  if (Math.abs(den) > .05) {   // where the two headings meet: the corner the curve rounds
    const t = (dx * hb[1] - dz * hb[0]) / den, u = (dx * ha[1] - dz * ha[0]) / den;
    if (t > .2 && u > .2) { k0 = t * .56; k1 = u * .56; }
  }
  const p1 = [a[0] + ha[0] * k0, a[1] + ha[1] * k0], p2 = [b[0] - hb[0] * k1, b[1] - hb[1] * k1];
  const n = Math.max(4, Math.ceil((k0 + k1 + ch) / .35));
  for (let i = 1; i <= n; i++) {
    const t = i / n, m = 1 - t;
    out.push([m * m * m * a[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * b[0], m * m * m * a[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * b[1]]);
  }
}
// a leg of driving through poses [[x, z], [hx, hz]]; `lead` = the straight bit behind the first pose (where the other axle is)
function leg(poses, lead, vmax, endV, rev = false) {
  const p0 = poses[0][0], h0 = poses[0][1], pts = [[p0[0] - h0[0] * lead, p0[1] - h0[1] * lead], p0];
  for (let i = 1; i < poses.length; i++) curve(poses[i - 1][0], poses[i - 1][1], poses[i][0], poses[i][1], pts);
  const cum = cumOf(pts), n = pts.length, cap = new Float32Array(n), vp = new Float32Array(n);
  for (let i = 0; i < n; i++) {   // as fast as the bend allows
    const a = pts[Math.max(0, i - 2)], b = pts[i], c = pts[Math.min(n - 1, i + 2)];
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(h2 - h1); if (d > Math.PI) d = 2 * Math.PI - d;
    const L = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) || 1, k = d / L;
    cap[i] = Math.min(vmax, Math.max(1.3, Math.sqrt(2.2 / Math.max(1e-4, k))));
  }
  vp[n - 1] = Math.min(cap[n - 1], endV);
  for (let i = n - 2; i >= 0; i--) vp[i] = Math.min(cap[i], Math.sqrt(vp[i + 1] ** 2 + 2 * 1.9 * (cum[i + 1] - cum[i])));
  return { pts, cum, vp, s: lead, rev, len: cum[n - 1] };
}
const at = (L, s) => along(L.pts, L.cum, s);
const vAt = (L, s) => { let lo = 0, hi = L.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] <= s) lo = m; else hi = m; } return L.vp[hi]; };
const sNear = (L, p) => { let bi = 0, bd = 1e9; L.pts.forEach((q, j) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = j; } }); return L.cum[bi]; };

// the cars in the lots: parked ones, and ones driving in or backing out
export function createParking(net, city) {
  const P = { parked: new Map(), movers: [], ver: 0 };
  const lotsOf = new Map();
  // the lot in front of a building, if cars can drive into it from the building's own street
  P.lotFor = function (b) {
    if (!b) return null;
    let k = lotsOf.get(b.id);
    if (k && k.ver === net.ver + ':' + city.ver) return k.lot;
    const l = city.lots.find(l => l.bid === b.id && l.k === 'parking');
    let ok = null;
    if (l) { const E = entries(l, net); if (E.length && !E[0].alongX && E[0].e === b.e && E[0].sgn > 0) ok = { l, E }; }
    lotsOf.set(b.id, { ver: net.ver + ':' + city.ver, lot: ok });
    return ok;
  };
  // where a trip to or from a building with a lot starts or ends: in the lane by one of its driveways (`lot` = the kerb point there)
  P.gate = function (b, pick = 0) { const L = P.lotFor(b); if (!L) return null; const en = L.E[Math.abs(Math.floor(pick)) % L.E.length]; return { e: en.e, x: en.K[0], z: en.K[1], lot: en.K }; };
  const key = (l, r, i) => l.bid + ':' + r + ':' + i;
  const entNear = (L, x, z) => L.E.reduce((b, e) => Math.hypot(e.K[0] - x, e.K[1] - z) < Math.hypot(b.K[0] - x, b.K[1] - z) ? e : b, L.E[0]);
  // the free stall nearest the building's door that a car coming in at this driveway can turn into
  function freeStall(L, ent) {
    const F = frame(L.l), lay = layout(L.l), xin = F.L(ent.P[0], ent.P[1])[0] + KEEP; let best = null, bd = 1e9;
    lay.rows.forEach((row, r) => row.stalls.forEach(st => {
      const k = key(L.l, r, st.i); if (P.parked.has(k)) return;
      if (row.flip && Math.abs(st.x - xin) < 2 * R_TURN + .6) return;   // (facing the street right by the driveway: no room to swing round)
      const d = (st.z - lay.z0) + Math.abs(st.x - L.l.x) * .6 + Math.abs(st.x - xin) * .15;
      if (d < bd) { bd = d; best = { r, st, k }; }
    }));
    return best;
  }
  // the lot's frame: points and directions to the world
  const toW = F => ({ p: (x, z) => F.W(x, z), h: (hx, hz) => [hx * F.c - hz * F.s, hx * F.s + hz * F.c] });
  // the lanes a car crosses between the road edge and its lane (turning left in or out across traffic), as points to keep clear
  function crossing(lg, K, sFrom, sTo) {
    const pts = []; for (let s = sFrom; s <= sTo; s += 2.5) pts.push(at(lg, s)); pts.push(K); return pts;
  }
  // nothing coming that would hit a car crossing these points (visible traffic heading for them, or a car right there)
  function clear(pts, me, mv, at, patient) {
    for (const c of net.cars) {
      if (c === me || (c.hide && c.aside)) continue;
      if (at && c.hx * at[2] + c.hz * at[3] > .6) continue;   // (going its way, beside or behind: turning left across the other side, only that traffic matters)
      for (const p of pts) {
        const dx = p[0] - c.x, dz = p[1] - c.z, d = Math.hypot(dx, dz);
        if (d < 4.2) return false;
        if (c.v < .5 || patient) continue;   // (standing still: waiting for something else)
        const ahead = dx * c.hx + dz * c.hz, side = Math.abs(dx * c.hz - dz * c.hx);
        if (ahead > 0 && side < 3 && ahead < 9 + c.v * 3.4) return false;
      }
    }
    for (const m of P.movers) if (m.onRoad && m !== mv && (m.go || m.v > .3)) { const q = P.pose(m); for (const p of pts) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 5) return false; }   // (one already turning)
    return true;
  }
  // a car has arrived at a building with a lot: it turns in at the driveway, finds a stall and parks. done(x, z) once parked
  P.arrive = function (car, b, pid, done) {
    if (car.type === 'truck' || car.type === 'bus' || car.type === 'ems' || car.type === 'fire') return false;   // (too big for a stall: they stop at the kerb)
    const L = P.lotFor(b); if (!L) return false;
    const ent = entNear(L, car.x, car.z), f = freeStall(L, ent); if (!f) return false;
    const F = frame(L.l), w = toW(F), lay = layout(L.l), row = lay.rows[f.r], st = f.st, wb = car.len * .6;
    const Pl = F.L(ent.P[0], ent.P[1]), Kl = F.L(ent.K[0], ent.K[1]), xin = Pl[0] + KEEP, nose = row.flip ? 1 : -1, IN = w.h(0, -1);
    const g = net.posAt(car, car.s - car.len * .2), lat = car.lat || 0, g0 = [g[0] - g[3] * lat, g[1] + g[2] * lat];   // the car's front wheels, where they are now
    const hv = car.rx === undefined ? [g[2], g[3]] : [g0[0] - car.rx, g0[1] - car.rz], hl = Math.hypot(hv[0], hv[1]) || 1, h = [hv[0] / hl, hv[1] / hl];
    const deep = Math.min(3, Math.max(1, (Kl[1] - Pl[1]) * .8)), poses = [[g0, h], [w.p(xin, Kl[1] - deep), IN]];
    const end = [w.p(st.x, st.z + nose * wb / 2), w.h(0, nose)], mouth = [w.p(st.x, st.z - nose * 1.2), w.h(0, nose)];
    const dir = Math.sign(st.x - xin) || 1, zl = row.aisle + dir * KEEP * .9;
    if (!row.flip && Math.abs(st.x - xin) < 2 * R_TURN + .6) {   // straight ahead from the driveway: ease across into it
      if (Kl[1] - deep - Pl[1] > .5) poses.push([w.p(xin, Pl[1]), IN]);
      poses.push(mouth, end);
    } else {
      if (Pl[1] - zl > R_TURN + .8 && Kl[1] - deep - Pl[1] > .5) poses.push([w.p(xin, Pl[1]), IN]);
      const a3 = xin + dir * R_TURN, a4 = st.x - dir * R_TURN;
      poses.push([w.p(a3, zl), w.h(dir, 0)]);
      if ((a4 - a3) * dir > .4) poses.push([w.p(a4, zl), w.h(dir, 0)]);
      poses.push(mouth, end);
    }
    const lg = leg(poses, wb, 4.6, 0), sK = sNear(lg, ent.K);
    const cr = h[0] * IN[1] - h[1] * IN[0];   // turning right (with the traffic on this side) or left (across it)
    const far = cr < 0 && !ent.e.oneway;   // a left turn in across the oncoming lanes: wait for a gap first
    const spot = { x: w.p(st.x, st.z)[0], z: w.p(st.x, st.z)[1], yaw: yawAt(...w.h(0, nose)), type: car.type, color: car.color, id: car.id, pid, bid: b.id };
    P.parked.set(f.k, { ...spot, moving: true });
    const blk = [net.block(car.lane, car.s, car.len)];   // traffic behind waits while it turns in
    P.movers.push({ legs: [lg], li: 0, v: Math.min(car.v, lg.vp[1] + 2), wb, len: car.len, type: car.type, color: car.color, id: car.id, pid, k: f.k, done, park: true,
      sig: cr > 0 ? 2 : 1, onRoad: true, sK, blk, at: [g0[0], g0[1], h[0], h[1]], e: ent.e, cross: far ? crossing(lg, ent.K, lg.s + 3, sK) : null, go: !far });
    return f.k;
  };
  // they're leaving: the driver walks out to it, it backs out, drives to the driveway, stops, waits for a gap, pulls out
  // into the street where `car` (waiting hidden in its lane) takes over
  P.leave = function (k, car, wait, ready) {
    const sp = P.parked.get(k); if (!sp) return false;
    const b = city.buildings.find(o => o.id === sp.bid), L = P.lotFor(b); if (!L) { P.parked.delete(k); return false; }
    const [, r, i] = k.split(':').map(Number), lay = layout(L.l), row = lay.rows[r], st = row && row.stalls.find(s => s.i === i); if (!st) { P.parked.delete(k); return false; }
    const F = frame(L.l), w = toW(F), wb = car.len * .6, nose = row.flip ? 1 : -1;
    const tg = along(car.lane.pts, car.lane.cum, Math.max(0, car.s - car.len * .2));   // where its front wheels will be in the lane
    const ent = entNear(L, tg[0], tg[1]), Pl = F.L(ent.P[0], ent.P[1]), Kl = F.L(ent.K[0], ent.K[1]), xout = Pl[0] - KEEP, OUT = w.h(0, 1);
    const dOut = Math.sign(xout - st.x) || 1, zl = row.aisle + dOut * KEEP * .9;
    // backing out: the rear wheels lead, swinging away from the way out so it ends up facing it
    const rb = Math.max(1.6, Math.min(R_TURN, dOut > 0 ? st.x - (lay.x0 + .4) : (lay.x1 - .4) - st.x));
    const r0 = [st.x, st.z - nose * wb / 2], rEnd = [st.x - dOut * rb, zl];
    const back = leg([[w.p(...r0), w.h(0, -nose)], [w.p(...rEnd), w.h(-dOut, 0)]], wb, 1.6, 0, true);
    // then forward (planned once it has backed out, from where it really is): along the aisle, up the driveway to the stop bar, out into the lane
    const rest = [], f0x = rEnd[0] + dOut * wb, deep = Math.min(3, Math.max(1, (Kl[1] - Pl[1]) * .8));
    if ((xout - dOut * R_TURN - f0x) * dOut > .4) rest.push([w.p(xout - dOut * R_TURN, zl), w.h(dOut, 0)]);
    if (Kl[1] - deep - (zl + R_TURN) > .5) rest.push([w.p(xout, zl + R_TURN), OUT]);
    rest.push([w.p(xout, Kl[1] - deep), OUT], [[tg[0], tg[1]], [tg[2], tg[3]]]);
    const cr = OUT[0] * tg[3] - OUT[1] * tg[2];
    P.movers.push({ legs: [back], li: 0, v: 0, wb, len: car.len, type: sp.type, color: sp.color, id: sp.id, pid: sp.pid, k, wait, car, ready,
      sig: 0, turn: cr > 0 ? 2 : 1, e: ent.e, blk: [], rest, bar: w.p(xout, Pl[1] + (Kl[1] - Pl[1]) * .3), K: ent.K });
    return true;
  };
  function drive(m) {   // backed out: the way on from here
    const f = frontBack(m), L = Math.hypot(f.hx, f.hz) || 1, h = [f.hx / L, f.hz / L], g = [f.lead[0] + h[0] * m.wb, f.lead[1] + h[1] * m.wb];
    const fwd = leg([[g, h], ...m.rest], m.wb, 4.6, 4.5);
    m.legs.push(fwd); m.sBar = sNear(fwd, m.bar); m.sK = sNear(fwd, m.K); m.cross = crossing(fwd, m.K, m.sK, fwd.len);
  }
  P.free = k => { P.parked.delete(k); };
  const unblock = m => { for (const b of m.blk || []) net.unblock(b); m.blk = []; };
  // a mover's front (or rear, backing) wheels, heading and middle
  function frontBack(m) {
    const lg = m.legs[m.li], a = at(lg, lg.s), b = at(lg, lg.s - m.wb);
    return lg.rev ? { lead: a, other: b, hx: b[0] - a[0], hz: b[1] - a[1] } : { lead: a, other: b, hx: a[0] - b[0], hz: a[1] - b[1] };
  }
  P.step = function (dt) {
    for (let i = P.movers.length - 1; i >= 0; i--) {
      const m = P.movers[i];
      if (m.car && !net.cars.includes(m.car)) { unblock(m); P.movers.splice(i, 1); P.parked.delete(m.k); continue; }   // (its trip is gone)
      if (m.wait > 0) { m.wait -= dt; continue; }
      if (m.pause > 0) { m.pause -= dt; continue; }
      const lg = m.legs[m.li];
      // how fast: the bends ahead, a stop at the bar, waiting for a gap, another car in the way
      let vt = vAt(lg, lg.s);
      if (!m.go && m.cross && !lg.rev) {
        if (!m.park) vt = Math.min(vt, Math.sqrt(2 * 1.9 * Math.max(0, m.sBar - lg.s)));   // up to the stop bar
        if (m.park || lg.s >= m.sBar - .4) {
          m.held = (m.held || 0) + dt; if (!m.park) m.sig = m.turn;
          if (m.held > (m.park ? 0 : .9) && clear(m.cross, m.car, m, m.park ? m.at : null, m.held > 25)) {   // a gap: go, holding the lanes it crosses
            m.go = true; m.onRoad = true;
            if (m.car) m.car.aside = false;
            const mine = new Set(m.blk.map(b => b.lane)); if (m.car) mine.add(m.car.lane);
            for (const l of m.e.lanes || []) {
              if (mine.has(l)) continue;
              let best = null; for (const p of m.cross) { const c = closestOnPoly(l.pts, l.cum, p[0], p[1]); if (!best || c.d < best.d) best = c; }
              if (best && best.d < 1.9) m.blk.push(net.block(l, Math.min(l.len, best.s + 2.5), 5));
            }
          } else vt = 0;
        }
      }
      {
        const me = P.pose(m), fx = Math.cos(me[2]) * (lg.rev ? -1 : 1), fz = -Math.sin(me[2]) * (lg.rev ? -1 : 1);
        for (const o of P.movers) {   // another car moving in the lot, right in front: wait for it (unless it's waiting for this one)
          if (o === m || o.wait > 0 || o.yieldTo === m) continue;
          const q = P.pose(o), dx = q[0] - me[0], dz = q[1] - me[1], ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          if (ahead > 1 && ahead < 6.8 && side < 2.3) { vt = Math.min(vt, Math.max(0, (ahead - 4.8) * .8)); if (vt < .2) { m.stuck = (m.stuck || 0) + dt; m.yieldTo = o; } }
        }
        if (vt > .2) { m.stuck = 0; m.yieldTo = null; }
        if ((m.stuck || 0) > 6) vt = Math.max(vt, .8);   // (never stuck for good)
      }
      if (lg.len - lg.s < 1.5 && vt === vAt(lg, lg.s)) vt = Math.max(vt, .5);   // (the last bit into the stall or the stop)
      m.v = m.v < vt ? Math.min(vt, m.v + 1.8 * dt) : Math.max(vt, m.v - 4 * dt);
      lg.s = Math.min(lg.len, lg.s + m.v * dt);
      // signals: turning in at the driveway, then nothing while in the lot; pulling out: the way it'll turn
      if (m.park && lg.s > m.sK + m.len * .7) { m.sig = 0; if (m.onRoad) { m.onRoad = false; unblock(m); } }
      if (lg.s < lg.len - .05) continue;
      // end of a leg
      if (m.rest) { drive(m); m.rest = null; }
      if (m.li < m.legs.length - 1) {   // backed out: into drive, and on
        m.li++; m.v = 0; m.pause = .5; m.sig = 0; P.parked.delete(m.k); continue;
      }
      P.movers.splice(i, 1); unblock(m);
      if (m.park) { const sp = P.parked.get(m.k); if (sp) sp.moving = false; if (m.done) m.done(sp ? sp.x : lg.pts[lg.pts.length - 1][0], sp ? sp.z : lg.pts[lg.pts.length - 1][1]); }
      else if (m.car) {   // in the lane: the car on the road takes over, at this speed, with its wheels where these are
        const c = m.car, fb = frontBack(m);
        c.hide = false; c.hold = false; c.aside = false; c.v = m.v; c.lat = 0; c.latV = 0; c.rx = fb.other[0]; c.rz = fb.other[1];
        const L = Math.hypot(fb.hx, fb.hz) || 1; c.x = (fb.lead[0] + fb.other[0]) / 2; c.z = (fb.lead[1] + fb.other[1]) / 2; c.hx = fb.hx / L; c.hz = fb.hz / L;
        if (m.ready) m.ready();
      }
    }
    P.ver++;
  };
  // where a mover is drawn: [x, z, yaw] (its middle, between front and rear wheels)
  P.pose = function (m) {
    if (!m.legs) return [0, 0, 0];
    const f = frontBack(m), L = Math.hypot(f.hx, f.hz) || 1;
    return [(f.lead[0] + f.other[0]) / 2, (f.lead[1] + f.other[1]) / 2, yawAt(f.hx / L, f.hz / L)];
  };
  // lots that are gone (building knocked down, lot cut away): their cars go too
  P.prune = function () { for (const [k, sp] of P.parked) if (!city.lots.some(l => l.bid === sp.bid)) P.parked.delete(k); };
  // fill a lot with the cars of the people inside (after loading or starting)
  P.parkNow = function (b, pid, kindRoll, colorRoll) {
    if (['truck', 'bus'].includes(typeOf(kindRoll))) return null;
    const L = P.lotFor(b); if (!L) return null; const f = freeStall(L, L.E[0]); if (!f) return null;
    const F = frame(L.l), lay = layout(L.l), w = F.W(f.st.x, f.st.z), nose = lay.rows[f.r].flip ? 1 : -1, a = F.W(f.st.x, f.st.z + nose);
    P.parked.set(f.k, { x: w[0], z: w[1], yaw: yawAt(a[0] - w[0], a[1] - w[1]), type: typeOf(kindRoll), color: colorRoll, id: pid, pid, bid: b.id });
    return f.k;
  };
  return P;
}
const yawAt = (dx, dz) => Math.atan2(-dz, dx);
