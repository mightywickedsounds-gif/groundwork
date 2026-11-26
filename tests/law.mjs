// Headless: police, crashes, stops, chases. node tests/law.mjs [days]
import { Net } from '../net.js';
import { createCity, DAY } from '../city.js';
import { createLife } from '../life.js';
import { createLaw } from '../police.js';
const days = +(process.argv[2] || 2);
const net = new Net(), city = createCity(net, 11), life = createLife(net, city, 11), law = createLaw(net, city, life);
net.onDone = c => life.carDone(c); life.onCarOut = c => law.carOut(c);
let T = DAY * 7 / 24; life.T = T;
life.startTown(); city.sync(); life.sync();
let fails = 0; const check = (n, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  ' + info : '')); if (!ok) fails++; };
// a police station, a fire station and a hospital on Main Street (plus the people to staff them)
life.coins = 99999; for (let k = 0; k < 4; k++) { const b = city.buildings.find(b => b.biz && b.biz.t === 'diner'); if (b.biz.lvl < 5) life.upgrade(b); }
const main = [...net.edges.values()].filter(e => Math.hypot(e.cx, e.cz) < 200 && e.len > 60);
const put = (t, i, s, sg) => { for (let k = 0; k < 6; k++) for (const g of [sg, -sg]) { const e = main[(i + k) % main.length], b = life.place(t, e, e.len * s, g); if (b) return b; } return null; };
const pd = put('police', 0, .4, 1), fd = put('fire', 2, .5, 1), hs = put('hospital', 1, .2, -1);
check('built police, fire, hospital', pd && fd && hs, [!!pd, !!fd, !!hs].join());
city.sync(); life.sync();
const dt = .1, seen = {}; let maxUnits = 0, hidden = 0, sirens = 0;
let crashed = false, reported = null, boloGone = false;
for (let i = 0; i < days * DAY / dt; i++) {
  T += dt; life.T = T;
  city.release(dt, 500); net.step(dt); life.step(dt); law.step(dt);
  if (city.regrow(dt, life.wantHomes())) { city.sync(); life.sync(); }
  for (const e of law.events.splice(0)) if (e.k === 'feed') { seen[e.f.code] = (seen[e.f.code] || 0) + 1; if (Object.values(seen).reduce((a, b) => a + b) < 40) console.log(`  [${life.hour().toFixed(1)}] ${e.f.code} ${e.f.txt}`); }
  life.events.length = 0;
  hidden = Math.max(hidden, law.units.filter(u => u.state === 'hide').length);
  sirens = Math.max(sirens, net.cars.filter(c => c.siren).length);
  if (i === 3000 && !crashed) { const a = net.cars.find(c => !c.keep && c.v > 3 && c.ldr); if (a) { law.crash(a, a.ldr, 'rear'); crashed = true; } }
  if (i === 6000) law.robbery();
  if (i === 2500) { const p = [...life.people.values(), ...life.guests.values()].find(p => p.car && net.cars.includes(p.car) && (!p.reg || !p.ins)); if (p) { reported = p; console.log('  report', p.fn, p.ln, law.report(p.id)); } }
  if (reported && !boloGone && !law.bolo.has(reported.id)) boloGone = true;
  for (const c of net.cars) if (!isFinite(c.x) || !isFinite(c.s)) throw new Error('NaN car');
}
console.log('feed codes', seen, 'units', law.units.map(u => u.kind + ':' + u.state), 'cars', net.cars.length);
check('police hide and watch the road', hidden > 0, hidden);
check('a crash got a response with sirens', sirens > 0 && seen['10-50'] > 0, sirens);
check('crash cleared', (seen.CLEAR || 0) > 0);
check('traffic stops and tickets', (seen.TICKET || 0) + (seen['10-80'] || 0) > 0, JSON.stringify(seen));
check('robbery reported', seen['10-31'] > 0);
check('a reported driver gets a unit sent after them', !reported || boloGone, reported ? reported.fn : 'nobody to report');
check('nothing left holding the road', net.cars.filter(c => c.hold && !c.keep && !c.crashed && !c.chased && !(c.hide && life.park.movers.some(m => m.car === c))).length === 0);   // (a car waiting for its driver to back out of a stall is fine)
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
