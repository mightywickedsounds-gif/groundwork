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
  while (z + ROW_GAP <= z1 - 1) {
    const flip = row % 2, stalls = [];
    const aisle = flip ? z - AISLE / 2 : Math.min(z1 - 1.8, z + ROW_GAP + AISLE / 2);   // where cars back out to
    for (let x = x0 + 1, i = 0; x + STALL_W <= x1 - 1; x += STALL_W, i++) stalls.push({ x: x + STALL_W / 2, z: z + 2.6, i });
    // the ends of each row stay clear for a planted island (wider lots)
    const isl = l.w > 22 && stalls.length > 7 ? 1 : 0;
    rows.push({ z, flip, aisle, stalls: stalls.slice(isl, stalls.length - isl), island: isl, ends: [x0 + 1, x1 - 1] });
    z += flip ? ROW_GAP : ROW_GAP + AISLE; row++;
  }
  l._lay = { key: l.x + ',' + l.z + ',' + l.w + ',' + l.d + ',' + (l.rot || 0), rows, x0, x1, z0, z1 };
  Object.defineProperty(l, '_lay', { enumerable: false, writable: true, value: l._lay });   // (never saved)
  return l._lay;
}
// where a lot meets its street: the side facing the nearest road, one or two driveways across the sidewalk
export function entries(l, net) {
  let best = null, bd = 90;
  for (const e of net.edges.values()) {
    if (e.ring || !e.bb || e.bb[0] - 90 > l.x || e.bb[1] + 90 < l.x || e.bb[2] - 90 > l.z || e.bb[3] + 90 < l.z) continue;
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
// round the corners of a path (keeps its ends)
function smooth(pts, it = 2) {
  for (let k = 0; k < it; k++) { const o = [pts[0]]; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (i) o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]); if (i + 1 < pts.length - 1) o.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } o.push(pts[pts.length - 1]); pts = o; }
  return pts;
}
const cumOf = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
export const typeOf = roll => { let a = 0; for (const t of TYPES) { a += t.share; if (roll < a) return t.k; } return 'car'; };

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
  // where a trip should start or end for a building with a lot: on the street right by its driveway
  P.gate = function (b) { const L = P.lotFor(b); if (!L) return null; const en = L.E[L.E.length > 1 ? 1 : 0]; return { e: en.e, x: en.K[0], z: en.K[1] }; };
  const key = (l, r, i) => l.bid + ':' + r + ':' + i;
  // the free stall nearest the building's door
  function freeStall(L) {
    const lay = layout(L.l); let best = null, bd = 1e9;
    lay.rows.forEach((row, r) => row.stalls.forEach(st => { const k = key(L.l, r, st.i); if (P.parked.has(k)) return; const d = (st.z - lay.z0) + Math.abs(st.x - L.l.x) * .6; if (d < bd) { bd = d; best = { r, st, k }; } }));
    return best;
  }
  // the way from the street to a stall: kerb lane, driveway, down the aisle, nose into the stall
  function route(L, r, st, side = 0) {   // side: which half of the driveway (in on one side, out on the other)
    const F = frame(L.l), lay = layout(L.l), row = lay.rows[r];
    let ent = L.E[0], bd = 1e9; for (const e of L.E) { const p = F.L(e.P[0], e.P[1]), d = Math.abs(p[0] - st.x); if (d < bd) { bd = d; ent = e; } }
    const Pl = F.L(ent.P[0], ent.P[1]);
    const aisle = row.aisle, path = [];
    const o = [ent.t[0] * side, ent.t[1] * side], off = p => [p[0] + o[0], p[1] + o[1]];
    path.push(off([ent.K[0] + ent.n[0] * 2.2, ent.K[1] + ent.n[1] * 2.2]));          // in the kerb lane by the driveway
    path.push(off(ent.K), off(ent.P));                                                // up their side of the driveway
    path.push(F.W(Pl[0] - side, aisle), F.W(st.x, aisle));                           // down the aisle
    path.push(F.W(st.x, aisle + (row.flip ? 1.5 : -1.5) * 0), F.W(st.x, st.z));         // and into the stall
    return { pts: path, ent };
  }
  const yawAt = (dx, dz) => Math.atan2(-dz, dx);
  // a car has arrived at a building with a lot: it drives in and parks. done(x, z) when it's parked (where the driver gets out)
  P.arrive = function (car, b, pid, done) {
    if (car.type === 'truck' || car.type === 'bus' || car.type === 'ems' || car.type === 'fire') return false;   // (too big for a stall: they stop at the kerb)
    const L = P.lotFor(b); if (!L) return false;
    const f = freeStall(L); if (!f) return false;
    const { pts } = route(L, f.r, f.st, -1.6);
    const start = [car.x, car.z], path = smooth([start, ...pts], 2), F = frame(L.l), lay = layout(L.l);
    const stallW = F.W(f.st.x, f.st.z), nose = lay.rows[f.r].flip ? 1 : -1;
    const spot = { x: stallW[0], z: stallW[1], yaw: yawAt(...(() => { const a = F.W(f.st.x, f.st.z + nose), b2 = F.W(f.st.x, f.st.z); return [a[0] - b2[0], a[1] - b2[1]]; })()), type: car.type, color: car.color, id: car.id, pid, bid: b.id };
    P.parked.set(f.k, { ...spot, moving: true });
    P.movers.push({ pts: path, cum: cumOf(path), s: 0, v: 0, type: car.type, color: car.color, id: car.id, pid, k: f.k, done, park: true, sig: 2 });
    return f.k;
  };
  // they're leaving: a short wait (walking out to it), then it backs out and drives to the street, where `car` takes over
  P.leave = function (k, car, wait, ready, end) {
    const sp = P.parked.get(k); if (!sp) return false;
    const b = city.buildings.find(o => o.id === sp.bid), L = P.lotFor(b); if (!L) { P.parked.delete(k); return false; }
    const [, r, i] = k.split(':').map(Number), lay = layout(L.l), row = lay.rows[r], st = row && row.stalls.find(s => s.i === i); if (!st) { P.parked.delete(k); return false; }
    const F = frame(L.l), { pts } = route(L, r, st, 1.6);
    // back out into the aisle (reversing), then forward out of the lot to the car's spot in the road
    const back = F.W(st.x + (st.x > F.L(pts[2][0], pts[2][1])[0] ? 3 : -3), row.aisle);
    const fwd = smooth([back, ...pts.slice(1, 4).reverse(), pts[0], end || [car.x, car.z]], 2);
    const rev = [F.W(st.x, st.z), F.W(st.x, row.aisle + (row.flip ? 1.2 : -1.2)), back];
    // it stops at the stop bar (just inside the sidewalk) before pulling out
    const fc = cumOf(fwd), Kp = pts[1], Pp = pts[2], bar = [Pp[0] + (Kp[0] - Pp[0]) * .35, Pp[1] + (Kp[1] - Pp[1]) * .35]; let bi = 0, bd = 1e9; fwd.forEach((p, j) => { const d = Math.hypot(p[0] - bar[0], p[1] - bar[1]); if (d < bd) { bd = d; bi = j; } });
    // which way they'll turn out: with the traffic on this side (right) or across it (left)
    const ent = L.E.reduce((b2, e) => Math.hypot(e.P[0] - pts[2][0], e.P[1] - pts[2][1]) < Math.hypot(b2.P[0] - pts[2][0], b2.P[1] - pts[2][1]) ? e : b2, L.E[0]);
    const h = along(car.lane.pts, car.lane.cum, Math.max(0, car.s)), turn = h[2] * ent.t[0] + h[3] * ent.t[1] > 0 ? 2 : 1;
    P.movers.push({ pts: smooth(rev, 1), cum: cumOf(smooth(rev, 1)), s: 0, v: 0, type: sp.type, color: sp.color, id: sp.id, pid: sp.pid, k, wait, rev: true, next: fwd, stopAt: fc[bi], car, ready, sig: 1, turn });
    return true;
  };
  P.free = k => { P.parked.delete(k); };
  P.step = function (dt) {
    for (let i = P.movers.length - 1; i >= 0; i--) {
      const m = P.movers[i];
      if (m.wait > 0) { m.wait -= dt; continue; }
      if (m.stopT > 0) { m.stopT -= dt; m.v = 0; continue; }
      const len = m.cum[m.cum.length - 1], vmax = m.rev ? 1.6 : 4.2, left = Math.min(len - m.s, m.stopAt != null && !m.rev ? Math.max(0, m.stopAt - m.s) + (m.stopped ? 1e9 : 0) : 1e9);
      m.v = Math.min(vmax, m.v + 2.2 * dt, Math.sqrt(2 * 1.8 * Math.max(0, left)) + .4);
      m.s += m.v * dt;
      if (m.stopAt != null && !m.rev && !m.stopped && m.s >= m.stopAt - .3) { m.stopped = true; m.stopT = 1.1; m.v = 0; m.sig = m.turn || 2; }
      if (m.car && !net.cars.includes(m.car)) { P.movers.splice(i, 1); P.parked.delete(m.k); continue; }   // (its trip is gone)
      if (m.s < len) continue;
      if (m.rev) { m.rev = false; m.pts = m.next; m.cum = cumOf(m.next); m.s = 0; m.v = 0; m.sig = 0; P.parked.delete(m.k); continue; }   // backed out: drive off
      P.movers.splice(i, 1);
      if (m.park) { const sp = P.parked.get(m.k); if (sp) sp.moving = false; if (m.done) m.done(sp ? sp.x : m.pts[m.pts.length - 1][0], sp ? sp.z : m.pts[m.pts.length - 1][1]); }
      else if (m.ready) m.ready();
    }
    P.ver++;
  };
  // where a mover is: [x, z, yaw]
  P.pose = function (m) {
    const c = m.cum, s = Math.min(m.s, c[c.length - 1]); let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++;
    const a = m.pts[i], b = m.pts[i + 1] || a, L = (c[i + 1] - c[i]) || 1, t = Math.max(0, Math.min(1, (s - c[i]) / L));
    const dx = b[0] - a[0], dz = b[1] - a[1];
    return [a[0] + dx * t, a[1] + dz * t, m.rev ? yawAt(-dx, -dz) : yawAt(dx, dz)];
  };
  // lots that are gone (building knocked down, lot cut away): their cars go too
  P.prune = function () { for (const [k, sp] of P.parked) if (!city.lots.some(l => l.bid === sp.bid)) P.parked.delete(k); };
  // fill a lot with the cars of the people inside (after loading or starting)
  P.parkNow = function (b, pid, kindRoll, colorRoll) {
    if (['truck', 'bus'].includes(typeOf(kindRoll))) return null;
    const L = P.lotFor(b); if (!L) return null; const f = freeStall(L); if (!f) return null;
    const F = frame(L.l), lay = layout(L.l), w = F.W(f.st.x, f.st.z), nose = lay.rows[f.r].flip ? 1 : -1, a = F.W(f.st.x, f.st.z + nose);
    P.parked.set(f.k, { x: w[0], z: w[1], yaw: yawAt(a[0] - w[0], a[1] - w[1]), type: typeOf(kindRoll), color: colorRoll, id: pid, pid, bid: b.id });
    return f.k;
  };
  return P;
}
