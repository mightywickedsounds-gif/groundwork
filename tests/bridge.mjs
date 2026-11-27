// Over- and underpasses: node tests/bridge.mjs
// Roads that cross without a junction (one climbs over or dips under the other), cars driving up and down them,
// the rules for where they can and can't go, and saving.
import { Net, edgeH, rampLen, CLEARANCE } from '../net.js';
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const net = new Net();
// a grid of streets 200 m apart, 3 x 3 blocks
for (let k = -300; k <= 300; k += 200) { for (let a = -300; a < 300; a += 200) { net.addRoad([a, k], [a + 200, k]); net.addRoad([k, a], [k, a + 200]); } }
const e0 = net.edges.size, n0 = net.nodes.size;
// an overpass running north-south between the streets, over two east-west streets
const over = net.addRoad([0, -300], [0, 300], null, { lv: 1 });
check('an overpass can be built across the streets', over.length === 1 && over[0].lv === 1, over.reason || '');
check('...with no junctions where it crosses (only its two ends join streets)', net.edges.size === e0 + 3, `${e0} -> ${net.edges.size}`);
const oe = over[0], top = Math.max(...oe.pts.map((p, i) => edgeH(oe, oe.cum[i])));
check('it climbs to about 6.6 m', top > 6.4 && top < 6.7, top.toFixed(2));
// an underpass east-west under the north-south streets
const under = net.addRoad([-300, 0], [300, 0], null, { lv: -1 });
check('an underpass can be built under the streets and the overpass', under.length === 1 && under[0].lv === -1, under.reason || '');
check('no road crosses another without a junction or a bridge', !net.crossesOthers([...net.edges.values()]));
// what can't be done
check('an overpass too short to climb over is refused', !!net.planRoad([60, -160], [60, -40], null, 9, 1).reason, net.planRoad([60, -160], [60, -40], null, 9, 1).reason);
check('an overpass over nothing is refused', /over a road/.test(net.planRoad([-280, -250], [-280, -150], null, 9, 1).reason || ''), net.planRoad([-280, -250], [-280, -150], null, 9, 1).reason);
const ramp = net.planRoad([-40, -270], [40, -270], null, 9, 0);
check('a street across the low end of a ramp is refused', /ramp/.test(ramp.reason || ''), ramp.reason);
const across = net.planRoad([-60, -40], [60, -40], null, 9, 0);
check('a street under the high part of the overpass passes beneath (no junction)', !across.reason && across.stops.length === 0, JSON.stringify({ r: across.reason, stops: across.stops && across.stops.length }));
const ex = net.edges.size; const made = net.addRoad([-60, -40], [60, -40]);
check('...and gets built as one piece', made.length === 1 && net.edges.size === ex + 1, made.reason || '');
check('a road snapped to the bridge deck does not join it', !net.probe(0, 0, 9).e);
check('ramps are long enough to be realistic (8 % at most)', rampLen(1) > 80 && rampLen(-1) > 75, rampLen(1).toFixed(0) + ' / ' + rampLen(-1).toFixed(0));
// traffic: send cars along the overpass and the underpass
net.rebuild();
const lanesOn = e => [...net.lanes.values()].filter(l => !l.conn && l.edge === e);
let up = 0, down = 0, maxPitch = 0, spawned = 0;
const at = (x, z) => ({ e: net.nearestEdge(x, z, 30).e, x, z });
const T = (x0, z0, x1, z1) => { const r = net.spawn(at(x0, z0), at(x1, z1), .3, .5); if (r && r.id) spawned++; };
for (let t = 0; t < 600; t += .1) {
  if (Math.round(t * 10) % 100 === 0) { T(-50, -300, 50, 300); T(50, 300, -50, -300); T(-300, -50, 300, 50); T(300, 50, -300, -50); T(-200, -300, 200, 300); }
  net.step(.1);
  for (const c of net.cars) { if (c.y > 5) up++; if (c.y < -5) down++; maxPitch = Math.max(maxPitch, Math.abs(c.pitch || 0)); if (!isFinite(c.y)) throw new Error('NaN height'); }
}
check('cars drive over the overpass', up > 50, up);
check('cars drive through the underpass', down > 50, down);
check('cars tilt with the ramps, never steeper than the ramp', maxPitch > .03 && maxPitch < .1, maxPitch.toFixed(3));
const st = {}; for (const c of net.cars) if (c.stuck > 30) { const k = (c.lane.conn ? 'J' + c.lane.node.id : c.lane.key) + (c.lane.edge && c.lane.edge.lv ? 'lv' : ''); st[k] = (st[k] || 0) + 1; }
console.log('stuck', JSON.stringify(st), 'cars', net.cars.length);
check('trips finish', net.stats.arrived > 40 && net.stats.gaveUp === 0, JSON.stringify({ spawned, arrived: net.stats.arrived, gave: net.stats.gaveUp }));
// saving keeps them
const N2 = new Net(); N2.load(JSON.parse(JSON.stringify(net.serialize())));
check('saves keep over- and underpasses', [...N2.edges.values()].filter(e => e.lv).length === 2 && !N2.crossesOthers([...N2.edges.values()]));
// a roundabout at the end of the overpass can't pull the ramp down onto the street it crosses
const endN = [...net.nodes.values()].find(n => Math.hypot(n.x, n.z + 300) < 1);
const r = net.makeRoundabout(endN.id);
check('a roundabout at the end of a bridge keeps the bridge clear', !net.crossesOthers([...net.edges.values()]), String(r));
void lanesOn; void CLEARANCE; void n0;
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
