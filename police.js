// The law and the emergencies: police units that hide and run radar, traffic stops and tickets, crashes and the
// police, fire engines and ambulances that answer them, hit-and-runs, robberies, carjackings, chases and road rage.
// No drawing here (runs in Node for the tests).
import { along, halfW, WALK_W } from './net.js';
import { DAY } from './city.js';
import { BIZ, FINE } from './life.js';

const R = Math.random;
const PAINTS = ['white', 'black', 'silver', 'grey', 'white', 'black', 'silver', 'blue', 'red', 'dark blue', 'tan', 'green', 'orange', 'maroon'];
const LOOKS = { car: 'sedan', suv: 'SUV', van: 'van', truck: 'box truck', bus: 'bus', police: 'cruiser', ems: 'ambulance', fire: 'fire engine' };
const an = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
export const aCar = c => an(carName(c));
export const carName = c => (c.type === 'bus' || c.type === 'police' || c.type === 'ems' || c.type === 'fire' ? '' : PAINTS[((Math.floor(c.color * PAINTS.length) % PAINTS.length) + PAINTS.length) % PAINTS.length] + ' ') + (c.type === 'suv' && c.id % 2 ? 'pickup' : LOOKS[c.type] || 'car');

export function createLaw(net, city, life) {
  const W = { units: [], inc: [], feed: [], events: [], rage: [], fires: [], spots: [], spotKey: '', t: 0, nid: 1, checkT: 0, rageT: 0, incT: 0 };
  const now = () => net.time;
  const feed = (code, txt, x, z, extra = {}) => { const f = { code, txt, x, z, t: now(), day: life.dayNum(), hour: life.hour(), ...extra }; W.feed.unshift(f); if (W.feed.length > 40) W.feed.length = 40; W.events.push({ k: 'feed', f }); return f; };
  const who = c => { const p = c && c.pid && life.person(c.pid); return p ? p.fn + ' ' + p.ln : 'the driver'; };
  const streetAt = (x, z) => { const h = net.nearestEdge(x, z, 40); return h ? life.streetName(h.e) : 'town'; };
  const corner = (x, z) => {   // "Main St and 1st St" for a junction, else the street
    let best = null, bd = 30; for (const n of net.nodes.values()) { if (n.edges.size < 3) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    if (!best) return streetAt(x, z);
    const names = [...new Set([...best.edges].map(id => life.streetName(net.edges.get(id))))];
    return names.slice(0, 2).join(' and ');
  };
  W.corner = corner;
  const alive = c => c && net.cars.includes(c);

  // ---------- the units: from the police station, the fire station and the hospital ----------
  function syncUnits() {
    const want = [];
    for (const b of city.buildings) {
      if (!b.biz) continue; const t = b.biz.t, L = b.biz.lvl;
      if (t === 'police') for (let i = 0; i < 1 + L; i++) want.push(['police', b, i]);
      if (t === 'fire') for (let i = 0; i < 1 + Math.floor(L / 2); i++) want.push(['fire', b, i]);
      if (t === 'hospital') for (let i = 0; i < 1 + Math.floor(L / 2); i++) want.push(['ems', b, i]);
    }
    const key = want.map(w => w[0] + w[1].id + ':' + w[2]).join(',');
    if (key === W.unitKey) return; W.unitKey = key;
    const keep = [];
    for (const [k, b, i] of want) {
      let u = W.units.find(u => u.kind === k && u.base === b.id && u.i === i);
      if (!u) u = { id: W.nid++, kind: k, base: b.id, i, state: 'base', car: null, spot: null, task: null, t: R() * 20, pid: 0 };
      keep.push(u);
    }
    for (const u of W.units) if (!keep.includes(u) && u.car && alive(u.car)) { u.car.keep = false; u.car.siren = false; }
    W.units = keep;
  }
  // who's in the car: a patrol officer (or firefighter, or paramedic) from that station's staff
  function crew(u) {
    const b = life.bmap.get(u.base); if (!b || !b.biz) return 0;
    const s = b.biz.staff.filter(id => { const p = life.people.get(id); return p && p.state === 'in' && p.at === b.id; });
    const pick = s.length > 2 ? s[2 + (u.i % (s.length - 2))] : s[u.i % Math.max(1, s.length)];
    return pick || b.biz.staff[0] || 0;
  }
  // ---------- hiding spots: the corner of a parking lot, an alley between buildings, an empty corner lot ----------
  function findSpots() {
    const key = net.ver + ':' + city.ver; if (key === W.spotKey) return; W.spotKey = key;
    const out = [], blocked = (x, z, r) => city.buildings.some(b => Math.abs(b.x - x) < b.w / 2 + r + 2 && Math.abs(b.z - z) < b.d / 2 + r + 2 && Math.hypot(b.x - x, b.z - z) < Math.hypot(b.w, b.d) / 2 + r + 2);
    const tryAt = (e, s, side, kind) => {
      if (s < 12 || s > e.len - 12) return;
      const q = along(e.pts, e.cum, s), w = halfW(e) + WALK_W + 4.2, x = q[0] - q[3] * w * side, z = q[1] + q[2] * w * side;
      if (blocked(x, z, 2.5) || !city.inCity(x, z)) return;
      for (const o of out) if (Math.hypot(o.x - x, o.z - z) < 40) return;
      const h = net.nearestEdge(x, z, w - 1); if (h && h.e !== e) return;   // too close to another road
      // parked facing out at an angle, nose to the road
      const yaw = Math.atan2(q[2] * side, q[3] * side) + (side > 0 ? .5 : -.5);
      out.push({ x, z, yaw, e, s, side, kind, busy: 0 });
    };
    for (const e of net.edges.values()) {
      if (e.ring || e.len < 40) continue;
      const fast = e.kind === 'avenue' || (e.nl || 1) > 1;
      for (const s of [e.len * .25, e.len * .5, e.len * .75]) for (const side of [1, -1]) if (fast || R() < .35) tryAt(e, s, side, 'lot');
    }
    W.spots = out;
  }
  // ---------- crashes ----------
  function crash(a, b, how) {
    if (!alive(a) || a.crashed || a.keep) return null;
    const x = b ? (a.x + b.x) / 2 : a.x, z = b ? (a.z + b.z) / 2 : a.z;
    for (const c of [a, b]) if (c) { c.hold = true; c.crashed = true; c.spin = (R() - .5) * (how === 'side' ? 1.6 : .5); c.v = 0; c.flee = false; c.chase = null; }
    const inc = { id: W.nid++, k: 'crash', cars: [a, b].filter(Boolean), x, z, t: now(), fire: R() < .18, hurt: R() < .55, units: [], clear: 0, police: 0, ems: 0, fireOut: 0 };
    W.inc.push(inc); life.day.crashes++;
    feed('10-50', `Crash at ${corner(x, z)}`, x, z, { inc: inc.id, pid: a.pid });
    if (inc.fire) W.fires.push({ x: a.x, z: a.z, inc: inc.id, t: 0 });
    // the other driver hasn't got insurance: they might just drive off
    for (const c of inc.cars) {
      const p = c.pid && life.person(c.pid);
      if (p && !p.ins && !c.keep && R() < .6 && inc.cars.length > 1) {
        setTimeout0(() => { if (!alive(c)) return; c.hold = false; c.crashed = false; c.damaged = true; c.spin *= .3; inc.cars = inc.cars.filter(o => o !== c); flee(c, 'hit and run'); feed('10-57', `Hit and run: ${who(c)} took off in ${aCar(c)}`, c.x, c.z, { pid: c.pid }); }, 3 + R() * 4);
      }
    }
    dispatch('police', inc); if (inc.hurt) dispatch('ems', inc); if (inc.fire) dispatch('fire', inc);
    return inc;
  }
  const later = [];
  function setTimeout0(fn, sec) { later.push({ t: now() + sec, fn }); }
  // a car heads for the edge of town as fast as it can
  function flee(c, why) {
    const X = life.exits(); if (!X.length) return;
    let best = null, bd = 0; for (const x of X) { const d = Math.hypot(x.x - c.x, x.z - c.z); if (d > bd) { bd = d; best = x; } }   // the far side: a long chase
    const to = X[Math.floor(R() * X.length)] || best;
    const spots = net.spotOn(to.e, to.fx, to.fz); if (!spots.length) return;
    c.flee = why; c.reckless = true; c.dest = spots[0].lane; c.destKey = c.dest.key; c.destS = spots[0].s; c.keep = false; net.reroute(c);
    const p = c.pid && life.person(c.pid); if (p) { p.wanted = why; p.dest = to; }
    pursue(c);
  }
  // ---------- dispatch: the nearest free unit of that kind ----------
  function freeUnit(kind, x, z) {
    let best = null, bd = 1e18;
    for (const u of W.units) {
      if (u.kind !== kind || u.task || !crew(u)) continue;
      const p = u.car && alive(u.car) ? [u.car.x, u.car.z] : u.state === 'hide' && u.spot ? [u.spot.x, u.spot.z] : (() => { const b = life.bmap.get(u.base); return b ? [b.x, b.z] : null; })();
      if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  // get a unit onto the road (from the station or its hiding spot) heading for a spot on a street
  function roll(u, toE, toS, siren) {
    let car = u.car && alive(u.car) ? u.car : null;
    const q = along(toE.pts, toE.cum, toS);
    if (!car) {
      let from;
      if (u.state === 'hide' && u.spot) { const s = u.spot; const p = along(s.e.pts, s.e.cum, s.s); from = { e: s.e, x: p[0], z: p[1] }; s.busy = 0; u.spot = null; }
      else { const b = life.bmap.get(u.base); if (!b || !b.e) return null; from = { e: b.e, x: b.fx, z: b.fz }; }
      const r = net.spawn(from, { e: toE, x: q[0], z: q[1] }, 0, 0, u.kind);
      if (typeof r === 'string') return null;
      car = r; car.unit = u; car.pid = crew(u); car.keep = true; u.car = car;
    } else {
      const spots = net.spotOn(toE, q[0], q[1]); if (!spots.length) return null;
      car.dest = spots[0].lane; car.destKey = car.dest.key; car.destS = spots[0].s; car.hold = false; car.aside = false; car.keep = true; net.reroute(car);
    }
    car.siren = !!siren; u.state = 'drive';
    return car;
  }
  function dispatch(kind, inc) {
    const u = freeUnit(kind, inc.x, inc.z);
    if (!u) { if (kind === 'police' && !W.units.some(u => u.kind === 'police')) inc.noPolice = true; return false; }
    const h = net.nearestEdge(inc.x, inc.z, 30); if (!h) return false;
    const s = Math.max(2, h.s - 14 - inc.units.length * 9);
    if (!roll(u, h.e, s, true)) return false;
    u.task = { k: 'scene', inc: inc.id }; inc.units.push(u.id);
    return true;
  }
  // a police car goes after someone
  function pursue(target, u = null) {
    u = u || freeUnit('police', target.x, target.z); if (!u) return false;
    const L = target.lane.conn ? target.route[target.ri + 1] || target.lane.out : target.lane;
    if (!roll(u, L.edge || target.lane.in.edge, 3, true)) return false;
    u.task = { k: 'chase', target, t: now(), why: target.flee || 'stop' }; u.car.chase = target; target.chased = u.id;
    return true;
  }
  // ---------- every step ----------
  W.step = function (dt) {
    W.t += dt;
    for (let i = later.length - 1; i >= 0; i--) if (now() >= later[i].t) { const f = later[i].fn; later.splice(i, 1); f(); }
    W.checkT += dt; if (W.checkT > 1) { W.checkT = 0; syncUnits(); findSpots(); hourly(); bolo(); }
    for (const u of W.units) unitStep(u, dt);
    // incidents
    for (let i = W.inc.length - 1; i >= 0; i--) if (incStep(W.inc[i], dt)) W.inc.splice(i, 1);
    for (const f of W.fires) f.t += dt;
    W.fires = W.fires.filter(f => W.inc.some(i => i.id === f.inc) && f.t < 240);
    // reckless drivers: tailgating, horn, and the finger
    W.rageT += dt; if (W.rageT > .5) { W.rageT = 0; rage(); }
    for (const r of W.rage) r.t -= dt; W.rage = W.rage.filter(r => r.t > 0 && alive(r.car));
    // a crash now and then: reckless and fleeing drivers mostly
    W.incT += dt; if (W.incT > 1) { W.incT = 0; maybeCrash(); }
  };
  function unitStep(u, dt) {
    const c = u.car && alive(u.car) ? u.car : null; if (u.car && !c) { u.car = null; if (u.state === 'drive' || u.state === 'scene' || u.state === 'stop') { u.state = 'base'; u.task = null; } }
    u.t += dt;
    if (u.kind === 'police' && !u.task && (u.state === 'base' || u.state === 'home') && u.t > 25 && crew(u)) {   // head out to a hiding spot and watch the traffic
      const free = W.spots.filter(s => !s.busy); if (!free.length) return;
      const b = life.bmap.get(u.base); free.sort((a, b2) => (Math.hypot(a.x - b.x, a.z - b.z) + R() * 400) - (Math.hypot(b2.x - b.x, b2.z - b.z) + R() * 400));
      const s = free[0]; s.busy = u.id;
      if (roll(u, s.e, s.s, false)) { u.task = { k: 'hide', spot: s }; u.t = 0; } else s.busy = 0;
      return;
    }
    if (!u.task) return;
    const T = u.task;
    if (T.k === 'hide' && c && (c.there || (c.lane.edge === T.spot.e && Math.abs(c.s - (c.lane.dir > 0 ? T.spot.s : T.spot.e.len - T.spot.s)) < 8))) {
      // into the lot: off the road, parked facing the traffic
      net.remove(c); u.car = null; u.spot = T.spot; u.state = 'hide'; u.task = null; u.t = 0; u.pid = c.pid;
      return;
    }
    if (T.k === 'home' && !c) { u.state = 'base'; u.task = null; u.t = 0; return; }
    if (T.k === 'scene') {
      const inc = W.inc.find(i => i.id === T.inc);
      if (!inc) { goHome(u); return; }
      if (c && (c.there || Math.hypot(c.x - inc.x, c.z - inc.z) < 22) && !c.hold) { c.hold = true; c.aside = true; c.siren = false; c.lights = true; u.state = 'scene'; u.t = 0; }
      if (u.state === 'scene') { if (u.kind === 'police') inc.police += dt; if (u.kind === 'ems') inc.ems += dt; if (u.kind === 'fire') inc.fireOut += dt; }
      return;
    }
    if (T.k === 'chase') chaseStep(u, c, dt);
  }
  function goHome(u) {
    const c = u.car && alive(u.car) ? u.car : null; u.task = null;
    if (!c) { u.state = 'base'; return; }
    const b = life.bmap.get(u.base); if (!b || !b.e) { c.keep = false; return; }
    const spots = net.spotOn(b.e, b.fx, b.fz); if (!spots.length) { c.keep = false; return; }
    c.hold = false; c.aside = false; c.siren = false; c.lights = false; c.chase = null; c.keep = false;
    c.dest = spots[0].lane; c.destKey = c.dest.key; c.destS = spots[0].s; net.reroute(c);
    u.task = { k: 'home' }; u.state = 'drive';
  }
  function chaseStep(u, c, dt) {
    const T = u.task, tg = T.target;
    if (!c) { u.task = null; return; }
    if (T.done) return;   // (dealt with: waiting to drive off)
    if (!alive(tg)) {   // got away (out of town) or already dealt with
      if (T.bolo && !T.done && tg.pid && life.person(tg.pid)) W.bolo.set(tg.pid, T.bolo);   // they got home first: still on the lookout
      if (T.why !== 'stop' && !T.done) { const p = tg.pid && life.person(tg.pid); feed('10-15', `${p ? p.fn + ' ' + p.ln : 'The suspect'} got away`, c.x, c.z); }
      goHome(u); return;
    }
    const d = Math.hypot(tg.x - c.x, tg.z - c.z);
    if (u.state === 'stop') {   // pulled over: the officer walks up, writes the ticket, walks back
      u.t += 0;
      if (now() - T.t0 > 26) {
        const p = tg.pid && life.person(tg.pid), fines = [];
        fines.push(T.why2); if (p && !p.ins) fines.push('noins'); if (p && !p.reg && T.why2 !== 'expired') fines.push('expired');
        let tot = 0; for (const f of new Set(fines)) { tot += FINE[f]; life.fine(f); }
        life.day.stops++;
        const words = { speeding: 'speeding', redlight: 'running a red light', expired: 'expired tags', noins: 'no insurance', reckless: 'reckless driving' };
        feed('TICKET', `${who(tg)}: ${[...new Set(fines)].map(f => words[f]).join(', ')} +${tot}`, tg.x, tg.z, { pid: tg.pid, fine: tot });
        tg.hold = false; tg.aside = false; tg.chased = 0; tg.ticketed = true; tg.reckless = false; tg.slow = Math.min(tg.slow, 1);
        T.done = true; goHome(u);
      }
      return;
    }
    // keep after them
    T.re = (T.re || 0) + dt;
    if (T.re > 1.2) {
      T.re = 0;
      const L = tg.lane.conn ? (tg.route[tg.ri + 1] || tg.lane.out) : tg.lane;
      c.dest = L; c.destKey = L.key; c.destS = Math.max(1, Math.min(L.len - 1, (L === tg.lane ? tg.s : 2) - tg.len - 4)); c.keep = true; net.reroute(c);
    }
    if (!tg.flee) {   // a traffic stop: lights on, they pull over
      if (d < 16 && !tg.lane.conn && !c.lane.conn) {
        const p = tg.pid && life.person(tg.pid);
        // no insurance, expired tags or a bad day: some floor it instead
        if (p && (!p.ins || !p.reg || p.temper > .93) && R() < .28) { flee(tg, 'evading police'); T.why = tg.flee; feed('10-80', `Pursuit: ${who(tg)} won't pull over (${carName(tg)})`, tg.x, tg.z, { pid: tg.pid }); return; }
        tg.hold = true; tg.aside = true; c.hold = true; c.aside = true; c.siren = false; c.lights = true; u.state = 'stop'; T.t0 = now();
        life.walkOfficer && life.walkOfficer(c.pid, [c.x, c.z], [tg.x, tg.z]);
      }
    } else if (d < 9 && tg.v < 2.5) {   // boxed in: arrest
      T.box = (T.box || 0) + dt;
      if (T.box > 1.5) arrest(u, c, tg);
    } else T.box = 0;
    if (now() - T.t > 200) { feed('10-15', `Lost ${who(tg)} in traffic`, c.x, c.z); tg.flee = false; tg.chased = 0; goHome(u); }
  }
  function arrest(u, c, tg) {
    const p = tg.pid && life.person(tg.pid), T = u.task;
    tg.hold = true; tg.aside = true; c.hold = true; c.aside = true; c.siren = false; c.lights = true; T.done = true;
    life.day.arrests++;
    let back = 0; if (T.loot) { back = T.loot; life.coins += back; }
    const pay = FINE[tg.flee === 'hit and run' ? 'hitrun' : 'reckless'];
    life.fine('reckless', pay);
    feed('10-15', `Arrested: ${who(tg)} (${tg.flee})${back ? ', ' + back + ' recovered' : ''} +${pay}`, tg.x, tg.z, { pid: tg.pid });
    setTimeout0(() => { if (alive(tg)) { tg.hold = false; tg.keep = false; tg.flee = false; if (p) { p.wanted = null; p.jailed = true; } net.remove(tg); } goHome(u); }, 18);
    if (p && p.guest) life.guests.delete(p.id);
  }
  function incStep(inc, dt) {
    const age = now() - inc.t;
    const policeOK = inc.police > 22 || (inc.noPolice && age > 140) || age > 260;
    const emsOK = !inc.hurt || inc.ems > 18 || (!W.units.some(u => u.kind === 'ems') && age > 100) || age > 260;
    const fireOK = !inc.fire || inc.fireOut > 16 || (!W.units.some(u => u.kind === 'fire') && age > 150) || age > 260;
    if (inc.fire && inc.fireOut > 16) { W.fires = W.fires.filter(f => f.inc !== inc.id); }
    if (!(policeOK && emsOK && fireOK)) return false;
    // tow the wrecks; the drivers get there in the end (or to the hospital)
    const hosp = city.buildings.find(b => b.biz && b.biz.t === 'hospital');
    for (const c of inc.cars) if (alive(c)) {
      const p = c.pid && life.person(c.pid);
      c.hold = false; c.keep = false; c.gave = true; net.remove(c);
      if (p && !p.guest && inc.hurt && hosp && inc.ems > 0 && c === inc.cars[0]) { p.state = 'in'; p.at = hosp.id; p.until = now() + DAY * .25; p.why = 'hurt'; p.back = p.home; }
    }
    for (const id of inc.units) { const u = W.units.find(u => u.id === id); if (u && u.task && u.task.inc === inc.id) goHome(u); }
    feed('CLEAR', `${corner(inc.x, inc.z)} is clear`, inc.x, inc.z);
    return true;
  }
  // ---------- hidden units: radar and plate readers ----------
  function hourly() {
    for (const u of W.units) {
      if (u.kind !== 'police' || u.state !== 'hide' || u.task || !u.spot) continue;
      const s = u.spot;
      for (const l of s.e.lanes || []) for (const c of l.cars) {
        if (c.keep || c.hold || c.chased || c.ticketed || c.flee || !c.pid) continue;
        const d = Math.hypot(c.x - s.x, c.z - s.z); if (d > 75) continue;
        const p = life.person(c.pid);
        let why = null;
        if (c.v > l.vmax * 1.12) why = 'speeding';
        else if (c.ranRed && now() - c.ranRed < 8) why = 'redlight';
        else if (p && !p.reg && !c.read && (c.read = true) && R() < .55) why = 'expired';
        if (!why) continue;
        if (pursue(c, u)) { u.task.why2 = why; feed('STOP', `Traffic stop: ${who(c)}, ${why === 'speeding' ? 'speeding on ' + life.streetName(s.e) : why === 'redlight' ? 'ran a red light' : 'expired tags'}`, c.x, c.z, { pid: c.pid }); }
        break;
      }
    }
    // crimes, a few a day once the town is big enough (fewer with more police)
    const pop = life.people.size, cops = W.units.filter(u => u.kind === 'police').length, hr = life.hour();
    const rate = Math.max(0, (pop - 25) / 900) * (1 / (1 + cops * .35)) * (hr > 20 || hr < 2 ? 1.6 : 1);
    if (R() < rate * 24 / DAY * .7) robbery();
    if (pop > 50 && R() < rate * .35 * 24 / DAY * .7) carjack();
  }
  function robbery() {
    const hr = life.hour();
    const shops = city.buildings.filter(b => b.biz && !BIZ[b.biz.t].svc && BIZ[b.biz.t].spend > 0 && b.e && hr >= BIZ[b.biz.t].hours[0] && hr < BIZ[b.biz.t].hours[1]);
    if (!shops.length) return;
    const b = shops[Math.floor(R() * shops.length)], X = life.exits(); if (!X.length) return;
    let loot = Math.floor(b.biz.cash || 0); b.biz.cash = 0;
    if (b.biz.lvl >= 3 || loot < 40) { const take = Math.min(Math.floor(life.coins * .04), 350); life.coins -= take; loot += take; }
    const to = X[Math.floor(R() * X.length)];
    const g = life.spawnGuest && life.spawnGuest(b, to, 'robbery');
    if (!g) return;
    W.pendingRob = W.pendingRob || []; W.pendingRob.push({ gid: g.id, loot, b: b.id, t: now() });
    life.day.robberies++;
    feed('10-31', `Robbery at ${b.biz.name}: ${loot} taken`, b.x, b.z, { bid: b.id });
  }
  // a guest robber got to their car: run
  W.carOut = function (car) {
    const r = (W.pendingRob || []).find(r => r.gid === car.pid); if (!r) return;
    W.pendingRob = W.pendingRob.filter(o => o !== r);
    car.flee = 'robbery'; car.reckless = true;
    if (pursue(car)) { const u = W.units.find(u => u.task && u.task.target === car); if (u) u.task.loot = r.loot; feed('10-80', `Pursuit: robbery suspect in ${aCar(car)}`, car.x, car.z, { pid: car.pid }); }
  };
  function carjack() {
    const c = net.cars.filter(c => c.pid > 0 && !c.keep && !c.hold && c.v < .3 && c.gw === 'line' && !c.lane.conn && (c.type === 'car' || c.type === 'suv'));
    if (!c.length) return;
    const car = c[Math.floor(R() * c.length)], p = life.person(car.pid); if (!p) return;
    const g = life.jack && life.jack(car); if (!g) return;
    flee(car, 'carjacking');
    feed('10-52', `Carjacking at ${corner(car.x, car.z)}: ${p.fn} ${p.ln}'s ${carName(car)} taken`, car.x, car.z, { pid: g.id });
  }
  // ---------- crashes, now and then ----------
  function maybeCrash() {
    const n = net.cars.length; if (n < 6) return;
    let risky = 0; for (const c of net.cars) if (c.reckless || c.flee) risky++;
    if (R() > (risky * .004 + n * .00012)) return;
    // someone who isn't careful, going through a junction or closing fast on the car ahead
    const cand = net.cars.filter(c => !c.keep && !c.hold && c.v > 5 && (c.reckless || c.flee || R() < .15));
    if (!cand.length) return;
    const a = cand[Math.floor(R() * cand.length)];
    if (a.lane.conn) {
      const o = net.cars.find(o => o !== a && !o.hold && o.lane.conn && o.lane.node === a.lane.node && o.lane !== a.lane && Math.hypot(o.x - a.x, o.z - a.z) < 10);
      if (o) { crash(a, o, 'side'); return; }
    }
    if (a.ldr && !a.ldr.hold && !a.ldr.keep && a.ldr.s - a.ldr.len - a.s < 4 && a.v > a.ldr.v + 2) crash(a, a.ldr, 'rear');
  }
  function rage() {
    if (now() - (W.lastRage || -99) < 30) return;   // a flash of temper now and then, not a running battle
    for (const c of net.cars) {
      if (!c.ldr || c.hold || c.keep || c.rageAt > now() - 40) continue;
      const L = c.ldr, gap = L.s - L.len - c.s;
      const mad = (c.reckless && gap < 5 && L.v < c.v * .7 && L.v < 6) || (c.pid && (life.person(c.pid) || {}).temper > .92 && gap < 3 && c.v < 1 && c.stuck > 14);
      if (!mad || R() > .1) continue;
      c.rageAt = now(); W.lastRage = now(); W.rage.push({ car: c, t: 3.5, at: L });
      W.events.push({ k: 'horn', x: c.x, z: c.z }); break;
      if (R() < .35) feed('RAGE', `${who(c)} flipped off ${who(L)} on ${life.streetName(c.lane.edge || (c.lane.in && c.lane.in.edge))}`, c.x, c.z, { pid: c.pid });
    }
  }
  // ---------- reports: you tip off the police about a driver; a unit goes out after them ----------
  W.bolo = new Map();
  W.isUnit = pid => W.units.some(u => (u.car && u.car.pid === pid) || (u.state === 'hide' && u.pid === pid));
  W.report = function (pid) {
    const p = life.person(pid); if (!p) return 'gone';
    if (W.bolo.has(pid)) return 'already';
    if (!W.units.some(u => u.kind === 'police')) return 'nopolice';
    const why = !p.reg ? 'expired' : !p.ins ? 'noins' : p.temper > .955 ? 'reckless' : null; if (!why) return 'clean';
    W.bolo.set(pid, { t: now(), why });
    const q = p.car && alive(p.car) ? [p.car.x, p.car.z] : (() => { const b = life.bmap.get(p.at); return b ? [b.x, b.z] : [0, 0]; })();
    const what = [!p.reg && 'expired tags', !p.ins && 'no insurance', p.temper > .955 && 'reckless driving'].filter(Boolean).join(', ');
    feed('BOLO', `Lookout for ${p.fn} ${p.ln}: ${what}`, q[0], q[1], { pid });
    bolo(); return 'ok';
  };
  // the next time they're behind the wheel, the nearest free unit (from the station or its hiding spot) goes after them
  function bolo() {
    for (const [pid, b] of W.bolo) {
      const p = life.person(pid);
      if (!p || now() - b.t > DAY) { W.bolo.delete(pid); continue; }
      const c = p.car && alive(p.car) ? p.car : null; if (!c || c.chased || c.hold || c.keep) continue;
      const u = freeUnit('police', c.x, c.z); if (!u) continue;
      const fromBase = u.state !== 'hide';
      if (pursue(c, u)) { u.task.why2 = b.why; u.task.bolo = b; W.bolo.delete(pid); feed('STOP', `${fromBase ? 'A unit leaves the station' : 'A unit pulls out'} after ${p.fn} ${p.ln}`, c.x, c.z, { pid, unit: u.id }); }
    }
  }
  // test hooks
  W.crash = crash; W.flee = flee; W.pursue = pursue; W.robbery = robbery; W.carjack = carjack; W.syncUnits = syncUnits; W.findSpots = findSpots;
  return W;
}
