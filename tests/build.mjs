// Stress test for building: hundreds of random roads, curves and roundabouts, then checks the network is sound.
// node tests/build.mjs [tries]
import { Net, rng } from '../net.js';
import { createCity } from '../city.js';
const tries = +(process.argv[2] || 400), R = rng(42);
const net = new Net(), city = createCity(net, 7);
for (let i = 0; i < 3; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
city.sync();
const reasons = {}; let ok = 0, rOk = 0, rTry = 0, lanesDone = 0;
const pick = () => [(R() - .5) * 700, (R() - .5) * 700];
for (let i = 0; i < tries; i++) {
  const k = R();
  if (k < .15) {   // roundabout on a random junction or road spot
    rTry++; const nodes = [...net.nodes.values()].filter(n => !n.ring); const n = nodes[(R() * nodes.length) | 0];
    const r = R() < .6 ? net.makeRoundabout(n.id) : (() => { const es = [...net.edges.values()].filter(e => !e.ring); const e = es[(R() * es.length) | 0]; return net.roundaboutOnRoad(e, e.len * (.2 + R() * .6)); })();
    if (typeof r === 'number') rOk++; else reasons['ring: ' + r] = (reasons['ring: ' + r] || 0) + 1;
    continue;
  }
  if (k > .9) {    // more lanes on a random road
    const es = [...net.edges.values()].filter(e => !e.ring); const e = es[(R() * es.length) | 0];
    for (let n = 1 + ((R() * 4) | 0); n > 0; n--) if (!process.env.NOLANES) net.cycleLanes(e.id);
    lanesDone++; continue;
  }
  // roads: often starting where the last one ended, like a player chaining
  const a = pick(), b = [a[0] + (R() - .5) * 260, a[1] + (R() - .5) * 260];
  const bend = k < .45 ? [(a[0] + b[0]) / 2 + (R() - .5) * 120, (a[1] + b[1]) / 2 + (R() - .5) * 120] : null;
  const made = net.addRoad(a, b, bend);
  if (made.reason) reasons[made.reason] = (reasons[made.reason] || 0) + 1; else ok++;
}
net.rebuild(); city.sync();
// 1) no two roads cross without a junction
const segX = (p1, p2, p3, p4) => { const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (Math.abs(d) < 1e-9) return false; const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d, u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d; return t > .02 && t < .98 && u > .02 && u < .98; };
const E = [...net.edges.values()]; let crossings = 0, short = 0;
const box = e => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const p of e.pts) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); } return [a, b, c, d]; };
const B = E.map(box);
for (let i = 0; i < E.length; i++) { if (E[i].len < 3) short++; for (let j = i + 1; j < E.length; j++) {
  const e = E[i], f = E[j]; if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
  if (B[i][0] > B[j][1] || B[j][0] > B[i][1] || B[i][2] > B[j][3] || B[j][2] > B[i][3]) continue;
  let hit = false; for (let p = 1; p < e.pts.length && !hit; p++) for (let q = 1; q < f.pts.length; q++) if (segX(e.pts[p - 1], e.pts[p], f.pts[q - 1], f.pts[q])) { hit = true; break; }
  if (hit) crossings++;
} }
// 2) traffic still runs on the result
for (let s = 0; s < 3000; s++) { city.demand(.1, 8); city.release(.1); net.step(.1); }
for (const c of net.cars) if (!isFinite(c.x)) throw new Error('NaN');
const roads = tries - rTry - lanesDone;
const wide = E.filter(e => e.nl > 1 || e.tl).length;
console.log({ roadsBuilt: `${ok}/${roads}`, roundabouts: `${rOk}/${rTry}`, widened: lanesDone, wideRoads: wide, reasons, crossingsWithoutJunction: crossings, tinyRoads: short, edges: E.length, arrived: net.stats.arrived, cars: net.cars.length });
if (crossings || short) { console.log('FAIL'); process.exit(1); } else console.log('PASS');
