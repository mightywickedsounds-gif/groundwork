// Multi-lane roads and turn lanes: node tests/lanes.mjs [hours]
// 1) a single crossroads of wide roads: lane arrows are right, left turns use the turn lane
// 2) the same city run twice (same random numbers): plain streets vs. wide avenues with turn lanes
import { Net, rng } from '../net.js';
import { createCity, DAY } from '../city.js';
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const hours = +(process.argv[2] || 24);

// ---- 1) one crossroads ----
{
  const net = new Net();
  net.addRoad([-200, 0], [200, 0]); net.addRoad([0, -200], [0, 200]);
  for (const e of net.edges.values()) { e.nl = 2; e.tl = 1; }
  net.ver++; net.rebuild();
  const c = [...net.nodes.values()].find(n => n.edges.size === 4);
  const ins = c.ins, pockets = ins.filter(l => l.pk);
  check('crossroads has 4 turn lanes', pockets.length === 4, `${pockets.length}`);
  check('every lane goes somewhere', ins.every(l => l.next.length > 0));
  const names = l => ['', 'straight', 'right', 'straight+right', 'left', 'straight+left', 'right+left', 'all'][l.mv & 7];
  const a = ins.filter(l => l.edge === ins[0].edge).sort((p, q) => (p.pk ? 9 : p.li) - (q.pk ? 9 : q.li)).map(names);
  check('lane arrows: kerb straight+right, middle straight, turn lane left', a.join(',') === 'straight+right,straight,left', a.join(','));
  // drive: from the west end to the north end (a left turn for eastbound traffic)
  const W = [...net.edges.values()].find(e => Math.min(net.nodes.get(e.a).x, net.nodes.get(e.b).x) < -100);
  const N = [...net.edges.values()].find(e => Math.min(net.nodes.get(e.a).z, net.nodes.get(e.b).z) < -100);
  let usedPocket = 0, arrived = 0, lat = 0;
  for (let t = 0; t < 900; t++) {
    if (t % 25 === 0) net.spawn({ e: W, x: -150, z: 0 }, { e: N, x: 0, z: -150 });
    if (t % 31 === 0) net.spawn({ e: W, x: -150, z: 0 }, { e: W, x: 150, z: 0 }) || 0;
    net.step(.1);
    for (const car of net.cars) { if (car.lane.pk) car.usedPk = 1; if (car.lat) lat++; }
  }
  for (let t = 0; t < 3000; t++) { net.step(.1); for (const car of net.cars) if (car.lane.pk) car.usedPk = 1; }
  void usedPocket; void arrived;
  const st = net.stats;
  check('cars finish their trips', st.arrived >= 30 && net.cars.length === 0, JSON.stringify({ arrived: st.arrived, left: net.cars.length, gaveUp: st.gaveUp }));
  check('cars change lanes smoothly (sideways drift seen)', lat > 0);
  // left turners: did they go through the turn lane?
  const net2 = new Net(); net2.addRoad([-200, 0], [200, 0]); net2.addRoad([0, -200], [0, 200]);
  for (const e of net2.edges.values()) { e.nl = 2; e.tl = 1; } net2.ver++; net2.rebuild();
  const W2 = [...net2.edges.values()].find(e => Math.min(net2.nodes.get(e.a).x, net2.nodes.get(e.b).x) < -100);
  const N2 = [...net2.edges.values()].find(e => Math.min(net2.nodes.get(e.a).z, net2.nodes.get(e.b).z) < -100);
  const car = net2.spawn({ e: W2, x: -150, z: 0 }, { e: N2, x: 0, z: -150 });
  check('a left-turning car plans through the turn lane', typeof car === 'object' && car.route.some(l => l.pk), car.route && car.route.map(l => l.key).join(' '));
  let seen = false; for (let t = 0; t < 1500 && net2.cars.length; t++) { net2.step(.1); if (car.lane.pk) seen = true; }
  check('...and drives through it', seen && net2.stats.arrived === 1);
}

// ---- 2) a whole city, twice ----
function run(wide) {
  const R = rng(99); const orig = Math.random; Math.random = R;
  const net = new Net(), city = createCity(net, 7);
  for (let i = 0; i < 3; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
  city.sync();
  let changed = 0;
  let lights = 0;
  if (!wide) {   // the city now starts with wide arterials and lights: make them plain two-lane streets for comparison
    for (const e of net.edges.values()) if (e.kind === 'avenue') { e.nl = 1; e.tl = 0; }
    for (const n of net.nodes.values()) n.sig = null;
    net.ver++;
  }
  if (wide) for (const e of [...net.edges.values()]) {   // the Lanes tool on every avenue, until 2 lanes + turn lanes
    if (e.kind !== 'avenue' || e.ring) continue;
    for (let k = 0; k < 5 && !(e.nl === 2 && e.tl === 1); k++) { const r = net.cycleLanes(e.id); lights += r.lights; changed++; }
  }
  const gone = city.sync().length;
  const dt = .1, steps = Math.round(hours / 24 * DAY / dt); let stuckMax = 0, pk = 0, multi = 0, maxMs = 0;
  for (let i = 0; i < steps; i++) {
    const hour = (6 + i * dt / DAY * 24) % 24;
    city.demand(dt, hour); city.release(dt);
    const t0 = performance.now(); net.step(dt); maxMs = Math.max(maxMs, performance.now() - t0);
    for (const c of net.cars) { if (!isFinite(c.x) || !isFinite(c.s)) throw new Error('NaN'); if (c.lane.pk) pk++; else if (c.lane.li) multi++; }
    stuckMax = Math.max(stuckMax, net.cars.filter(c => c.stuck > 20).length);
  }
  Math.random = orig;
  const s = net.stats;
  return { changed, lights, buildingsCleared: gone, arrived: s.arrived, gaveUp: s.gaveUp, avgTrip: +(s.tripSec / s.arrived).toFixed(1), stuckMax, carSecsInTurnLanes: Math.round(pk * dt), carSecsInInnerLanes: Math.round(multi * dt), stepMaxMs: +maxMs.toFixed(1) };
}
// ---- 3) widening every road to 3 lanes + turn lanes keeps the city: buildings set back, empty street land grows back ----
{
  const R = rng(5); const orig = Math.random; Math.random = R;
  const net = new Net(), city = createCity(net, 7);
  for (let i = 0; i < 3; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
  city.sync(); const b0 = city.buildings.length;
  for (const e of [...net.edges.values()]) { if (!net.edges.has(e.id) || e.ring) continue; for (let k = 0; k < 5 && !(e.nl === 3 && e.tl === 1); k++) net.cycleLanes(e.id); }
  const gone = city.sync().filter(g => !g.lot).length, b1 = city.buildings.length;
  check('widening every road sets buildings back instead of clearing them all', city.cutBack > 20 && b1 > b0 * .3, `${b0} buildings, ${gone} cleared, ${city.cutBack} set back`);
  for (let i = 0; i < DAY / .1; i++) city.regrow(.1);
  const b2 = city.buildings.length;
  check('empty street land grows back within a day', b2 > b1 && b2 >= b0 * .8, `${b0} at the start, ${b1} after widening, ${b2} a day later`);
  // nothing regrown sits on a road or on another building
  const ov = (a, b) => { const ax = [Math.cos(a.rot || 0), Math.sin(a.rot || 0)], bx = [Math.cos(b.rot || 0), Math.sin(b.rot || 0)], axs = [ax, [-ax[1], ax[0]], bx, [-bx[1], bx[0]]], d = [b.x - a.x, b.z - a.z];
    for (const n of axs) { const ra = a.w / 2 * Math.abs(ax[0] * n[0] + ax[1] * n[1]) + a.d / 2 * Math.abs(-ax[1] * n[0] + ax[0] * n[1]), rb = b.w / 2 * Math.abs(bx[0] * n[0] + bx[1] * n[1]) + b.d / 2 * Math.abs(-bx[1] * n[0] + bx[0] * n[1]); if (Math.abs(d[0] * n[0] + d[1] * n[1]) > ra + rb - .05) return false; } return true; };
  const B = city.buildings; let bad = 0;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (Math.abs(B[i].x - B[j].x) < 80 && Math.abs(B[i].z - B[j].z) < 80 && ov(B[i], B[j])) bad++;
  check('no two buildings overlap', bad === 0, `${bad} overlapping pairs`);
  net.ver++; const gone2 = city.sync().filter(g => !g.lot).length;
  check('no building stands on a road', gone2 === 0, `${gone2} would be knocked down`);
  // a saved city keeps turned buildings
  const C2 = createCity(new Net(), 7); C2.load(JSON.parse(JSON.stringify(city.serialize())));
  check('saves keep turned buildings', C2.buildings.filter(b => b.rot).length === B.filter(b => b.rot).length && B.some(b => b.rot));
  Math.random = orig;
}

const plain = run(false), wide = run(true);
console.log('plain streets ', plain);
console.log('wide arterials', wide);
check('wide roads get used', wide.carSecsInTurnLanes > 0 && wide.carSecsInInnerLanes > 0);
check('no more drivers give up than with plain streets (+5)', wide.gaveUp <= plain.gaveUp + 5);
check('more trips get done', wide.arrived > plain.arrived);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
