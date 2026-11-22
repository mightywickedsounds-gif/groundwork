// Headless: let the city grow for N days with no help from the player. node tests/grow.mjs [days]
import { Net } from '../net.js';
import { createCity, DAY } from '../city.js';
const days = +(process.argv[2] || 3);
const net = new Net(), city = createCity(net, 7);
for (let i = 0; i < 3; i++) { const d = city.nextDistrict(); city.unlock(d[0], d[1]); }
city.sync();
let time = DAY * 6.5 / 24, growT = 0, districts = 3, meter = 0, jamT = 0, lastGave = 0, maxMs = 0, t0 = Date.now();
const growInterval = () => Math.max(85, 170 - (districts - 3) * 7);
const dt = .1; let rep = 0, peak = 0;
for (let i = 0; i < days * DAY / dt; i++) {
  time += dt; const hour = (time / DAY * 24) % 24;
  city.demand(dt, hour); city.release(dt, 1600);
  const s0 = performance.now(); net.step(dt); maxMs = Math.max(maxMs, performance.now() - s0);
  growT += dt; if (growT >= growInterval()) { growT = 0; const d = city.nextDistrict(); if (d) { city.unlock(d[0], d[1]); districts++; city.sync(); } }
  jamT += dt; if (jamT >= .5) { let st = 0; for (const c of net.cars) if (c.stuck > 25) st++; const jam = st / Math.max(40, net.cars.length); const g = net.stats.gaveUp - lastGave; lastGave = net.stats.gaveUp; meter = Math.max(0, Math.min(1, meter + (jam - .1) * jamT / 45 + g * .006)); jamT = 0; peak = Math.max(peak, meter); }
  if ((rep += dt) >= DAY / 8) { rep = 0; const st = net.cars.filter(c => c.stuck > 25).length; console.log(`day ${(time / DAY + 1).toFixed(2)} h${hour.toFixed(0).padStart(3)} districts ${districts} pop ${city.totals().res} cars ${net.cars.length} stuck ${st} meter ${(meter * 100).toFixed(0)}% gave ${net.stats.gaveUp} queue ${city.queue.length} stepMax ${maxMs.toFixed(1)}ms`); maxMs = 0; }
}
console.log('peak meter', (peak * 100).toFixed(0) + '%', 'secs', ((Date.now() - t0) / 1000).toFixed(0));
