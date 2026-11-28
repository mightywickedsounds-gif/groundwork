// Headless traffic check: node tests/sim.mjs [districts] [hours]
import { Net } from '../net.js';
import { createCity, DAY } from '../city.js';
const nd = +(process.argv[2] || 3), hours = +(process.argv[3] || 24);
const net = new Net(), city = createCity(net, 7, +(process.env.PLAN || 2));   // (PLAN=1: the old straight grid)
for (let i = 0; i < nd; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
city.sync();
const MODE = process.env.MODE || '';
if (MODE) { let n = 0, fail = {};
  for (const node of [...net.nodes.values()]) { if (!net.nodes.has(node.id) || node.ring || node.edges.size < 3) continue;
    if (MODE === 'sig') { if (!node.sig) net.toggleSignal(node.id); n++; }
    if (MODE === 'ring') { const r = net.makeRoundabout(node.id); if (typeof r === 'number') n++; else fail[r] = (fail[r] || 0) + 1; }
  }
  const gone = city.sync(); console.log(MODE, 'changed', n, fail, 'buildings lost', gone.length);
}
const t0 = Date.now(); let hour = 6, maxCars = 0, stranded = 0;
const dt = 1 / 10, steps = Math.round(hours / 24 * DAY / dt);
let report = 0;
for (let i = 0; i < steps; i++) {
  hour = (6 + i * dt / DAY * 24) % 24;
  city.demand(dt, hour); const r = city.release(dt); stranded += r.stranded;
  net.step(dt);
  for (const c of net.cars) if (!isFinite(c.x) || !isFinite(c.s) || !isFinite(c.v)) throw new Error('NaN car ' + c.id);
  maxCars = Math.max(maxCars, net.cars.length);
  if ((report += dt) > DAY / 12) { report = 0; const st = net.cars.filter(c => c.stuck > 20).length; console.log(`h${hour.toFixed(1).padStart(5)} cars ${String(net.cars.length).padStart(4)} stuck20 ${String(st).padStart(3)} arrived ${net.stats.arrived} gaveUp ${net.stats.gaveUp} queue ${city.queue.length}`); }
}
const { res, jobs } = city.totals();
console.log({ nodes: net.nodes.size, edges: net.edges.size, buildings: city.buildings.length, res, jobs, maxCars, ...net.stats, avgTrip: (net.stats.tripSec / net.stats.arrived).toFixed(1), stranded, ms: Date.now() - t0 });
// why are stuck cars stuck?
const why = {};
for (const c of net.cars) if (c.stuck > 20) {
  const L = c.lane, i = L.cars.indexOf(c);
  let k = L.conn ? 'onJunction' : i > 0 ? 'behindCar' : (L.len - c.s < 1 ? 'stopLine:' + (c.why || '?') : 'lead-notAtLine');
  why[k] = (why[k] || 0) + 1;
}
console.log('stuck reasons', why);
for (const c of net.cars) if (c.stuck > 20 && c.lane.cars.indexOf(c) === 0 && !c.lane.conn && c.lane.len - c.s >= 1) {
  const nx = c.route[c.ri + 1];
  console.log({ id: c.id, left: +(c.lane.len - c.s).toFixed(1), v: c.v, gw: c.gw, len: c.lane.len.toFixed(1), next: nx && nx.key, nextConn: nx && nx.conn, granted: c.granted && c.granted.key, dest: c.lane === c.dest, destS: c.destS, s: c.s });
  if (c.gw === 'tail') { const t = net.cars.find(o => o.id === c.gwId); console.log('   tail', t && { id: t.id, lane: t.lane.key, s: t.s, v: t.v, stuck: t.stuck, gw: t.gw, why: t.why }); }
}
const wh = {}; for (const c of net.cars) if (c.stuck > 20 && c.gw === 'line') wh[c.why] = (wh[c.why] || 0) + 1; console.log('line-why', wh);
const dl = {}; for (const c of net.cars) if (c.stuck > 20) dl[c.gw] = (dl[c.gw] || 0) + 1; console.log('gw', dl);
