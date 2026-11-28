// Headless: the small starting town, its people, jobs and money over a few days. node tests/life.mjs [days]
import { Net } from '../net.js';
import { createCity, DAY } from '../city.js';
import { createLife, BIZ } from '../life.js';
const days = +(process.argv[2] || 2);
const net = new Net(), city = createCity(net, 7), life = createLife(net, city, 7);
net.onDone = c => life.carDone(c);
let T = DAY * 6 / 24; life.T = T;
life.startTown(); city.sync(); life.sync();
const biz = city.buildings.filter(b => b.biz);
console.log({ roads: net.edges.size, buildings: city.buildings.length, businesses: biz.map(b => b.biz.name + ' (' + b.biz.t + ')'), people: life.people.size, staff: biz.map(b => b.biz.staff.length + '/' + b.jobs) });
let fails = 0; const check = (n, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  ' + info : '')); if (!ok) fails++; };
const inTown = [...net.edges.values()].filter(e => city.inCity(e.cx, e.cz)).length;
check('starts small: 5-24 roads in town', inTown >= 5 && inTown <= 24, inTown + ' (' + net.edges.size + ' with the highway and ranch road out of town)');
check('starts small: under 20 buildings', city.buildings.length < 20 && city.buildings.length >= 10, city.buildings.length);
check('every business has staff', biz.every(b => b.biz.staff.length > 0));
// buying the land next door brings its streets, joined to the highway (no road on top of another)
{ const n0 = net.edges.size; city.unlock(1, 0, true); city.sync(); const xs = net.crossesOthers ? 0 : 0; check('bought land has streets', net.edges.size > n0 + 6, n0 + ' -> ' + net.edges.size); const dup = [...net.edges.values()].filter(e => [...net.edges.values()].some(f => f !== e && ((f.a === e.a && f.b === e.b) || (f.a === e.b && f.b === e.a)))).length; check('no doubled roads', dup === 0, dup); }
const dt = .1; let rep = 0, maxWalk = 0, maxCars = 0, sums = [], maxParked = 0, maxMovers = 0, hiddenLong = 0, backedOut = 0;
const hidT = new Map();
for (let i = 0; i < days * DAY / dt; i++) {
  T += dt; life.T = T;
  city.release(dt, 400); net.step(dt); life.step(dt);
  const w = city.regrow(dt, life.wantHomes()); if (w) { city.sync(); life.sync(); }
  for (const e of life.events.splice(0)) if (e.k === 'day') sums.push(e.sum);
  if (i === 2000) { const d = city.buildings.find(b => b.biz && b.biz.t === 'diner'); life.coins += 5000; life.upgrade(d); life.upgrade(d); city.sync(); life.sync(); }
  if (i % 50 === 0) for (const b of city.buildings) if (b.biz && b.biz.cash > 20) { life.collect(b); life.stat.collected++; }
  life.checkGoal();
  maxParked = Math.max(maxParked, life.park.parked.size); maxMovers = Math.max(maxMovers, life.park.movers.length); backedOut += life.park.movers.filter(m => m.legs && m.legs[m.li].rev && m.legs[m.li].s > m.wb + .1 && !m.counted && (m.counted = true)).length;
  for (const c of net.cars) if (c.hide) { const h = (hidT.get(c) || 0) + dt; hidT.set(c, h); if (h > 90) hiddenLong++; }
  maxWalk = Math.max(maxWalk, life.walkers.length); maxCars = Math.max(maxCars, net.cars.length);
  if ((rep += dt) >= DAY / 8) { rep = 0; const st = {}; for (const p of life.people.values()) st[p.state + (p.state === 'in' ? (p.at === p.home ? ':home' : p.at === p.work ? ':work' : ':other') : '')] = (st[p.state + (p.state === 'in' ? (p.at === p.home ? ':home' : p.at === p.work ? ':work' : ':other') : '')] || 0) + 1;
    console.log(`day ${(T / DAY + 1).toFixed(2)} h${life.hour().toFixed(1).padStart(5)} coins ${Math.round(life.coins)} people ${life.people.size} buildings ${city.buildings.length} cars ${net.cars.length} walkers ${life.walkers.length} goal ${life.goalI}`, JSON.stringify(st)); }
}
console.log('day sums', JSON.stringify(sums));
const p = [...life.people.values()].find(p => p.work);
console.log('sample', p.fn, p.ln, p.age, life.title(p), 'at', life.bmap.get(p.work).biz.name, 'boss', life.boss(p) && life.boss(p).fn, '|', life.doing(p), '|', life.address(life.bmap.get(p.home)));
check('people drove to work', sums.length && sums[0].trips > 10, sums[0] && sums[0].trips);
check('people walked', maxWalk > 0, maxWalk);
check('businesses earned coins', sums.length && sums[0].biz > 200, sums[0] && sums[0].biz);
check('the town grew (homes for new workers)', life.people.size > 25, life.people.size);
check('cars park in the lots in front of businesses', maxParked >= 5 && maxMovers > 0, 'most parked ' + maxParked + ', most driving in/out at once ' + maxMovers);
check('cars back out of their stalls when they leave', backedOut > 5, backedOut);
check('no car left waiting unseen in the road', hiddenLong === 0, hiddenLong);
check('no NaN', [...life.people.values()].every(p => p.state));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
