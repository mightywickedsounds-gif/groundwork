// Headless: how cars, drivers and people look while they move. node tests/cars.mjs [days] [seed]
// Watches every car and walker every step and counts what would look wrong on screen: cars driving through each other,
// cars sitting crooked in their lane, snaps and jumps, cars vanishing in the road, people walking through cars,
// buildings or across the road away from a crossing, cars blocking a junction.
import { Net, halfW, closestOnPoly, along } from '../net.js';
import { createCity, DAY } from '../city.js';
import { createLife } from '../life.js';
import { createLaw } from '../police.js';
const days = +(process.argv[2] || 1), seed = +(process.argv[3] || 7), grow = process.env.GROW !== '0';
const net = new Net(), city = createCity(net, seed), life = createLife(net, city, seed), law = createLaw(net, city, life);
const vanished = [];
net.onDone = c => { if (!c.hide && !c.lotIn && c.v > 1.5) vanished.push({ id: c.id, v: +c.v.toFixed(1), gave: !!c.gave, lane: c.lane.key }); life.carDone(c); };
life.onCarOut = c => law.carOut(c);
let T = DAY * 6.5 / 24; life.T = T;
life.startTown(); city.sync(); life.sync();
if (process.env.BUY) for (const [i, j] of [[1, 0], [0, 1], [-1, 0]]) { city.unlock(i, j, true); city.sync(); life.sync(); }

// oriented boxes: [x, z, hx, hz, half length, half width]
const box = (x, z, hx, hz, len, w) => [x, z, hx, hz, len / 2, w / 2];
function hit(A, B, m = .15) {   // separating axes, both shrunk by m
  const ax = [[A[2], A[3]], [-A[3], A[2]], [B[2], B[3]], [-B[3], B[2]]], d = [B[0] - A[0], B[1] - A[1]];
  for (const n of ax) {
    const ra = (A[4] - m) * Math.abs(A[2] * n[0] + A[3] * n[1]) + (A[5] - m) * Math.abs(-A[3] * n[0] + A[2] * n[1]);
    const rb = (B[4] - m) * Math.abs(B[2] * n[0] + B[3] * n[1]) + (B[5] - m) * Math.abs(-B[3] * n[0] + B[2] * n[1]);
    if (Math.abs(d[0] * n[0] + d[1] * n[1]) > ra + rb) return false;
  }
  return true;
}
const inBox = (B, x, z, pad = 0) => { const dx = x - B[0], dz = z - B[1]; return Math.abs(dx * B[2] + dz * B[3]) < B[4] + pad && Math.abs(-dx * B[3] + dz * B[2]) < B[5] + pad; };
const W = { car: 1.85, suv: 2, van: 2.05, truck: 2.4, bus: 2.5, police: 1.9, ems: 2.2, fire: 2.5 };
const L = { car: 4.5, suv: 4.9, van: 5.6, truck: 8.5, bus: 12, police: 4.9, ems: 6.4, fire: 10 };
const yawBox = (x, z, yaw, type) => box(x, z, Math.cos(yaw), -Math.sin(yaw), L[type] || 4.6, W[type] || 1.9);

const C = {}, ex = {}; const bump = (k, info) => { C[k] = (C[k] || 0) + 1; if (info && !ex[k]) ex[k] = info; };
const pairOn = new Map();   // pair key -> still overlapping (count each episode once)
let steps = 0, carSteps = 0, walkSteps = 0;
const prev = new Map(), blockT = new Map(), crooked = [], tl = new Map(), tlRuns = [];
const dt = .1;
for (let i = 0; i < days * DAY / dt; i++) {
  T += dt; life.T = T; steps++;
  city.release(dt, 400); net.step(dt); life.step(dt); law.step(dt);
  if (grow) { const w = city.regrow(dt, life.wantHomes()); if (w) { city.sync(); life.sync(); } }
  life.events.length = 0;
  // everything with a body, this step
  const bodies = [];
  for (const c of net.cars) if (!c.hide) bodies.push({ k: 'road', o: c, b: box(c.x, c.z, c.hx, c.hz, c.len, c.w), y: c.y || 0 });
  for (const sp of life.park.parked.values()) if (!sp.moving) bodies.push({ k: 'parked', o: sp, b: yawBox(sp.x, sp.z, sp.yaw, sp.type), y: 0 });
  for (const m of life.park.movers) { if (m.wait > 0) continue; const q = life.park.pose(m); bodies.push({ k: 'lot', o: m, b: yawBox(q[0], q[1], q[2], m.type), y: 0 }); }
  for (const u of law.units) if (u.state === 'hide' && u.spot) bodies.push({ k: 'hidden', o: u, b: yawBox(u.spot.x, u.spot.z, u.spot.yaw, 'police'), y: 0 });
  // overlaps (a grid so it stays quick)
  const grid = new Map(), cell = 14, now = new Set();
  bodies.forEach((B, n) => { const k = Math.floor(B.b[0] / cell) * 9973 + Math.floor(B.b[1] / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); });
  bodies.forEach((A, n) => {
    const gx = Math.floor(A.b[0] / cell), gz = Math.floor(A.b[1] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of grid.get((gx + a) * 9973 + gz + b) || []) {
      if (m <= n) continue; const B = bodies[m];
      if (Math.abs(A.y - B.y) > 2.5) continue;
      if ((A.o.crashed && B.o.crashed) || (A.k === 'lot' && B.k === 'parked' && A.o.k && life.park.parked.get(A.o.k) === B.o) || (B.k === 'lot' && A.k === 'parked' && B.o.k && life.park.parked.get(B.o.k) === A.o)) continue;
      if (A.k === 'lot' && B.k === 'road' && A.o.car === B.o || B.k === 'lot' && A.k === 'road' && B.o.car === A.o) continue;
      if (!hit(A.b, B.b)) continue;
      const kinds = [A.k, B.k].sort().join('+'), key = (A.o.id ?? n) + ':' + (B.o.id ?? m) + kinds;
      now.add(key); if (pairOn.has(key)) continue; pairOn.set(key, 1);
      let where = '';
      if (A.k === 'road' && B.k === 'road') { const a = A.o, b = B.o; where = a.lane === b.lane ? (a.lane.conn ? ' same junction path' : ' same lane') : a.lane.conn && b.lane.conn ? ' crossing paths in a junction' : (a.lane.conn || b.lane.conn) ? ' junction/lane' : a.lane.edge === b.lane.edge ? ' side by side (lane change)' : ' other'; }
      bump('overlap ' + kinds + where, { at: A.b.slice(0, 2).map(v => +v.toFixed(1)), a: A.k === 'road' ? { lane: A.o.lane.key, s: +A.o.s.toFixed(1), v: +A.o.v.toFixed(1), lat: +(A.o.lat || 0).toFixed(2), latT: A.o.latT } : A.k, b: B.k === 'road' ? { lane: B.o.lane.key, s: +B.o.s.toFixed(1), v: +B.o.v.toFixed(1), lat: +(B.o.lat || 0).toFixed(2), latT: B.o.latT } : B.k });
    }
  });
  // each car on the road
  for (const c of net.cars) {
    if (c.hide) { prev.delete(c); continue; }
    carSteps++;
    const p = prev.get(c);
    if (p) {
      const jump = Math.hypot(c.x - p.x, c.z - p.z), turn = Math.acos(Math.max(-1, Math.min(1, c.hx * p.hx + c.hz * p.hz))) * 180 / Math.PI;
      if (jump > c.v * dt + .6 && jump > .8) bump('jump > 0.8 m in one step', { id: c.id, jump: +jump.toFixed(1), lane: c.lane.key });
      if (turn > 8) bump('snap > 8 deg in one step', { id: c.id, turn: +turn.toFixed(0), v: +c.v.toFixed(1), lane: c.lane.key });
    }
    prev.set(c, { x: c.x, z: c.z, hx: c.hx, hz: c.hz });
    // crooked: the body pointing well off its lane on a plain stretch, with no sideways move going on
    if (!c.lane.conn && !c.side && Math.abs(c.latV || 0) < .05 && !c.latT && !c.aside && c.s > c.len + 2 && c.lane.len - c.s > 2 && c.v > .5) {
      const g = along(c.lane.pts, c.lane.cum, c.s - c.len * .5), ang = Math.acos(Math.max(-1, Math.min(1, g[2] * c.hx + g[3] * c.hz))) * 180 / Math.PI;
      if (ang > 10) { bump('crooked > 10 deg in a lane', { id: c.id, ang: +ang.toFixed(0), lane: c.lane.key, s: +c.s.toFixed(1), lat: c.lat }); crooked.push(ang); }
    }
    // standing still in the middle of a junction
    if (c.lane.conn && c.v < .1 && !c.hold && !c.crashed) { const t = (blockT.get(c) || 0) + dt; blockT.set(c, t); if (Math.abs(t - 4) < dt / 2) bump('stopped inside a junction > 4 s', { id: c.id, lane: c.lane.key }); } else blockT.delete(c);
    // long runs in a turn lane (it is for turning, not driving along)
    const ip = c.lane.key && c.lane.key.endsWith('p');
    if (ip && !tl.has(c)) tl.set(c, c.lane.len - c.s);
    if (!ip && tl.has(c)) { tlRuns.push(tl.get(c)); tl.delete(c); }
  }
  // people on foot
  for (const w of life.walkers) {
    walkSteps++;
    const s = Math.min(w.s, w.len); let j = 0; while (j < w.cum.length - 2 && w.cum[j + 1] < s) j++;
    const a = w.pts[j], b = w.pts[Math.min(j + 1, w.pts.length - 1)], Ls = (w.cum[j + 1] - w.cum[j]) || 1, t = Math.max(0, Math.min(1, (s - w.cum[j]) / Ls));
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    for (const B of bodies) if (Math.abs(B.b[0] - x) < 8 && Math.abs(B.b[1] - z) < 8 && inBox(B.b, x, z, -.1)) {
      const key = 'p' + w.pid + ':' + (B.o.id ?? B.o.k); now.add(key); if (pairOn.has(key)) break; pairOn.set(key, 1);
      bump('person walks into a car (' + B.k + ')', { pid: w.pid, ghost: !!w.ghost, x: +x.toFixed(1), z: +z.toFixed(1), at: +(s / w.len).toFixed(2) }); break; }
    if (s > 2.5 && w.len - s > 2.5) for (const bd of city.buildings) {
      if (Math.abs(bd.x - x) > 40 || Math.abs(bd.z - z) > 40) continue;
      const r = bd.rot || 0; if (inBox([bd.x, bd.z, Math.cos(r), Math.sin(r), bd.w / 2, bd.d / 2], x, z, -.3)) { bump('person inside a building', { pid: w.pid, x: +x.toFixed(1), z: +z.toFixed(1) }); break; }
    }
    // in the roadway away from a junction (crossing mid-block)
    if (i % 5 === 0) for (const e of net.edges.values()) {
      if (e.lv || e.bb[0] - 20 > x || e.bb[1] + 20 < x || e.bb[2] - 20 > z || e.bb[3] + 20 < z) continue;
      const q = closestOnPoly(e.pts, e.cum, x, z); if (q.d > halfW(e) - .4) continue;
      const A = net.nodes.get(e.a), B = net.nodes.get(e.b), ta = A.edges.size > 1 ? net.trimOf(A) + 4 : 0, tb = B.edges.size > 1 ? net.trimOf(B) + 4 : 0;
      if (q.s > ta && q.s < e.len - tb) { bump('person in the road mid-block' + (w.ghost ? ' (to/from a car)' : ''), { pid: w.pid, x: +x.toFixed(1), z: +z.toFixed(1), d: +q.d.toFixed(1), hw: halfW(e) }); }
      break;
    }
  }
  // (pairs no longer touching can count again)
  for (const k of pairOn.keys()) if (!now.has(k)) pairOn.delete(k);
}
for (const v of vanished) bump('car vanished while moving' + (v.gave ? ' (gave up)' : ''), v);
console.log(`steps ${steps}, car-steps ${carSteps}, walker-steps ${walkSteps}, trips ${net.stats.arrived}, gave up ${net.stats.gaveUp}`);
for (const k of Object.keys(C).sort()) console.log(String(C[k]).padStart(7), ' ', k, ' e.g.', JSON.stringify(ex[k]));
if (crooked.length) console.log('crooked angles: median', crooked.sort((a, b) => a - b)[crooked.length >> 1].toFixed(0), 'max', crooked[crooked.length - 1].toFixed(0));
if (tlRuns.length) { tlRuns.sort((a, b) => a - b); console.log('runs in a turn lane:', tlRuns.length, 'median', tlRuns[tlRuns.length >> 1].toFixed(0), 'm, longest', tlRuns[tlRuns.length - 1].toFixed(0), 'm, over 60 m:', tlRuns.filter(r => r > 60).length); }
