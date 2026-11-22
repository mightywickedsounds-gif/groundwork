// Browser checks for Flowtown: node tests/play.cjs [screenshot folder]. Needs Playwright with Chromium.
// Files are served straight from disk (page.route), so no web server is needed.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || require('os').tmpdir();
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const TYPES = { js: 'text/javascript', mjs: 'text/javascript', jpg: 'image/jpeg', png: 'image/png', hdr: 'application/octet-stream', html: 'text/html' };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); p.setDefaultTimeout(180000);
  await p.addInitScript(q => localStorage.setItem('flowtown.quality', q), process.env.Q || 'medium');
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('http://game.test/**', r => {
    const u = new URL(r.request().url()), f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: TYPES[f.split('.').pop()] || 'text/plain', body: fs.readFileSync(fp) });
  });
  await p.goto('http://game.test/');
  await p.waitForFunction(() => window.FT && FT.net, null, { timeout: 240000 });
  await p.click('#playBtn');
  await p.evaluate(() => FT.setSpeed(0));
  const st = () => p.evaluate(() => ({ cars: FT.net.cars.length, nodes: FT.net.nodes.size, edges: FT.net.edges.size, b: FT.city.buildings.length, arrived: FT.net.stats.arrived, gave: FT.net.stats.gaveUp, meter: FT.S.meter }));
  check('city starts with streets and buildings', (await st()).edges > 20 && (await st()).b > 50, JSON.stringify(await st()));
  await p.evaluate(() => FT.step(120));
  const s1 = await st(); check('traffic runs', s1.cars > 20 && s1.arrived > 0, JSON.stringify(s1));
  const shot = async (name, cam, hour) => { await p.evaluate(([c, h]) => { if (h != null) FT.setHour(h); Object.assign(FT.cam, c); FT.placeCamera(); FT.render(); FT.render(); }, [cam, hour]); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, name + '.png') }); };
  await shot('overview', { x: 0, z: 30, dist: 520, yaw: .35, pitch: .9 }, 9.5);
  await shot('street', { x: 0, z: -150, dist: 120, yaw: .6, pitch: .62 }, 9.5);
  // tools
  const j = await p.evaluate(() => { const n = [...FT.net.nodes.values()].find(n => n.edges.size === 4 && Math.hypot(n.x, n.z) < 200); return n && [n.x, n.z, n.id]; });
  check('found a 4-way junction', !!j);
  await p.evaluate(([x, z]) => { FT.setTool('ring'); FT.click(x, z); }, j);
  const rings = await p.evaluate(() => [...FT.net.nodes.values()].filter(n => n.ring).length);
  check('roundabout built', rings >= 4, 'ring nodes ' + rings);
  const k = await p.evaluate(() => { const n = [...FT.net.nodes.values()].find(n => n.edges.size >= 3 && !n.ring && Math.hypot(n.x, n.z) < 300); return n && [n.x, n.z]; });
  await p.evaluate(([x, z]) => { FT.setTool('signal'); FT.click(x, z); }, k);
  check('lights added', await p.evaluate(() => [...FT.net.nodes.values()].some(n => n.sig)));
  const e0 = (await st()).edges;
  await p.evaluate(() => { FT.setTool('curve'); FT.click(-160, -60); FT.click(40, 60); FT.hover(-60, -20); FT.click(-60, -20); });
  check('curved road splits crossings', (await st()).edges > e0 + 2, `${e0} -> ${(await st()).edges}`);
  // lanes: widen two crossing avenues near the middle to 2 lanes + turn lanes (3 taps each)
  const av = await p.evaluate(() => {
    const n = [...FT.net.nodes.values()].find(n => n.edges.size === 4 && !n.ring && !n.sig && [...n.edges].every(id => FT.net.edges.get(id).kind === 'avenue'))
      || [...FT.net.nodes.values()].find(n => n.edges.size === 4 && !n.ring && !n.sig);
    if (!n) return null;
    const es = [...n.edges].map(id => FT.net.edges.get(id));
    FT.setTool('lanes');
    for (const e of es) for (let k = 0; k < 5 && !(e.nl === 2 && e.tl === 1); k++) { const q = FT.along(e.pts, e.cum, e.len / 2); FT.hover(q[0], q[1]); FT.click(q[0], q[1]); }
    return [n.x, n.z, n.id, es.map(e => [e.nl, e.tl])];
  });
  check('lanes tool widens roads', av && av[3].every(([nl, tl]) => nl === 2 && tl === 1), JSON.stringify(av));
  check('lights added where wide roads cross', await p.evaluate(id => !!FT.net.nodes.get(id).sig, av[2]));
  await p.evaluate(() => FT.step(90));
  check('cars use the extra lanes', await p.evaluate(() => FT.net.cars.some(c => c.lane.li > 0 || c.lane.pk)));
  await shot('lanes', { x: av[0] + 10, z: av[1] + 25, dist: 95, yaw: .5, pitch: .78 }, 10);
  await shot('lanes-top', { x: av[0], z: av[1], dist: 140, yaw: 0, pitch: 1.35 }, 10);
  const s2 = await st(); check('traffic still flows after edits', s2.arrived > s1.arrived, JSON.stringify(s2));
  await shot('roundabout', { x: j[0], z: j[1], dist: 110, yaw: .3, pitch: 1.0 }, 10);
  await p.evaluate(() => FT.toggleView());
  await shot('traffic-view', { x: 0, z: 0, dist: 420, yaw: .2, pitch: 1.15 }, 17.5);
  await p.evaluate(() => FT.toggleView());
  await shot('night', { x: 0, z: 0, dist: 300, yaw: .5, pitch: .7 }, 21.5);
  // phone gestures: a quick drag moves the map, hold-then-drag draws, a road ending beside a street joins it
  {
    const ph = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const q = await ph.newPage(); q.setDefaultTimeout(180000);
    q.on('pageerror', e => errs.push('PHONE ' + e.message));
    await q.route('http://game.test/**', r => {
      const u = new URL(r.request().url()), f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(ROOT, f);
      if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
      r.fulfill({ status: 200, contentType: TYPES[f.split('.').pop()] || 'text/plain', body: fs.readFileSync(fp) });
    });
    await q.goto('http://game.test/'); await q.waitForFunction(() => window.FT && FT.net, null, { timeout: 240000 });
    await q.click('#playBtn'); await q.evaluate(() => { FT.setSpeed(0); Object.assign(FT.cam, { x: 0, z: 0, dist: 160, yaw: 0, pitch: 1.3 }); FT.placeCamera(); FT.setTool('road'); });
    const cdp = await ph.newCDPSession(q);
    const touch = async (pts, holdMs = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      if (holdMs) await q.waitForTimeout(holdMs);
      for (let i = 1; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); await q.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await q.waitForTimeout(100);
    };
    const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    const ph0 = await q.evaluate(() => ({ e: FT.net.edges.size, x: FT.cam.x, z: FT.cam.z }));
    await touch(line(120, 300, 260, 420));
    const ph1 = await q.evaluate(() => ({ e: FT.net.edges.size, x: FT.cam.x, z: FT.cam.z }));
    check('phone: quick drag moves the map, builds nothing', ph1.e === ph0.e && Math.hypot(ph1.x - ph0.x, ph1.z - ph0.z) > 5, JSON.stringify([ph0, ph1]));
    // hold, then drag: a road from a street out into a block
    const sp = await q.evaluate(() => { const e = [...FT.net.edges.values()].find(e => !e.ring && e.len > 60 && Math.hypot(e.cx - FT.cam.x, e.cz - FT.cam.z) < 60) || [...FT.net.edges.values()][0]; const p = FT.along(e.pts, e.cum, e.len / 2); const r = [-p[3], p[2]]; return [FT.toScreen(p[0] + r[0] * 12.5, p[1] + r[1] * 12.5), FT.toScreen(p[0] + r[0] * 45, p[1] + r[1] * 45)]; });
    await touch(line(sp[1][0], sp[1][1], sp[0][0], sp[0][1]), 450);
    const ph2 = await q.evaluate(() => ({ e: FT.net.edges.size, pin: FT.T.pts.length }));
    check('phone: hold then drag draws a road', ph2.e > ph1.e, JSON.stringify(ph2));
    const joined = await q.evaluate(() => { const n = [...FT.net.nodes.values()].sort((a, b) => b.id - a.id); return n.slice(0, 3).some(m => m.edges.size >= 3); });
    check('phone: a road drawn up to a street (ending on its sidewalk) joins it', joined);
    // with the pin waiting, a quick drag still just moves the map
    await touch(line(200, 500, 80, 380));
    const ph3 = await q.evaluate(() => ({ e: FT.net.edges.size }));
    check('phone: quick drag after building moves the map, builds nothing', ph3.e === ph2.e, JSON.stringify([ph2, ph3]));
    await q.screenshot({ path: path.join(OUT, 'phone-draw.png') });
    await ph.close();
  }
  check('no page errors', !errs.length, errs.slice(0, 5).join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
