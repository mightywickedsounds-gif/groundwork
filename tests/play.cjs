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
  await p.waitForSelector('#title.show');
  check('title screen shows after loading', await p.evaluate(() => document.getElementById('boot').classList.contains('gone')));
  await p.click('#playBtn');
  await p.evaluate(() => { FT.setSpeed(0); FT.life.coins = 1e6; });
  const st = () => p.evaluate(() => ({ cars: FT.net.cars.length, nodes: FT.net.nodes.size, edges: FT.net.edges.size, b: FT.city.buildings.length, arrived: FT.net.stats.arrived, gave: FT.net.stats.gaveUp, meter: FT.S.meter }));
  const inTown = await p.evaluate(() => [...FT.net.edges.values()].filter(e => FT.city.inCity(e.cx, e.cz)).length);
  check('the town starts small (5-24 roads in town, under 20 buildings)', inTown >= 5 && inTown <= 24 && (await st()).b < 20 && (await st()).b >= 10, inTown + ' in town ' + JSON.stringify(await st()));
  await p.evaluate(() => FT.step(120));
  const s1 = await st(); check('traffic runs', s1.cars > 5 && s1.arrived > 0, JSON.stringify(s1));
  // the economy, people and the law
  const eco = await p.evaluate(() => {
    const L = FT.life, e = [...FT.net.edges.values()].filter(e => e.len > 60 && Math.hypot(e.cx, e.cz) < 220);
    let pd = null; for (const ed of e) for (const sg of [1, -1]) if (!pd) pd = L.place('police', ed, ed.len * .5, sg);
    const b = FT.city.buildings.find(b => b.biz && b.biz.t === 'diner'), lv = b.biz.lvl; L.upgrade(b);
    const car = FT.net.cars.find(c => c.pid > 0) || FT.net.cars.find(c => c.pid); let card = '';
    if (car) { FT.select({ k: 'p', id: car.pid }); card = document.getElementById('card').textContent; }
    FT.select({ k: 'b', id: b.id }); const bcard = document.getElementById('card').textContent; FT.select(null);
    return { police: !!pd, up: b.biz.lvl === lv + 1, card: card.slice(0, 80), bcard: bcard.slice(0, 60), walkers: L.walkers.length };
  });
  check('a police station can be built', eco.police);
  check('a business can be upgraded', eco.up);
  check('tapping a driver shows who they are', /Reports to|Visitor|Lives at/.test(eco.card), eco.card);
  check('a business card shows its name and level', /Level/.test(eco.bcard), eco.bcard);
  await p.evaluate(() => FT.step(60));
  check('police head out to watch the roads', await p.evaluate(() => FT.law.units.some(u => u.state !== 'base')), await p.evaluate(() => FT.law.units.map(u => u.state).join()));
  const shot = async (name, cam, hour) => { await p.evaluate(([c, h]) => { if (h != null) FT.setHour(h); Object.assign(FT.cam, c); FT.placeCamera(); FT.render(); FT.render(); }, [cam, hour]); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, name + '.png') }); };
  await shot('overview', { x: 0, z: -20, dist: 330, yaw: .9, pitch: .62 }, 9.5);
  await shot('street', { x: 10, z: -50, dist: 75, yaw: .5, pitch: .42 }, 10);
  // tools
  const j = await p.evaluate(() => { const n = [...FT.net.nodes.values()].find(n => n.edges.size === 4 && Math.hypot(n.x, n.z) < 200 && n.x < 0); return n && [n.x, n.z, n.id]; });
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
    const es = [...n.edges].map(id => FT.net.edges.get(id)), b0 = FT.city.buildings.length;
    FT.setTool('lanes');
    // each leg: tap until it's as wide as the buildings beside it allow (it never knocks one down)
    const want = es.map(e => FT.net.maxStep(e, FT.city.maxHalfW(FT.net.roadChain(e))));
    es.forEach((e, i) => { for (let k = 0; k < 5 && !(e.nl === want[i][0] && e.tl === want[i][1]); k++) { const q = FT.along(e.pts, e.cum, e.len / 2); FT.hover(q[0], q[1]); FT.click(q[0], q[1]); } });
    const got = es.map(e => [e.nl, e.tl]), lost = b0 - FT.city.buildings.length;
    // then the whole crossroads to 2 lanes + turn lanes regardless (as if the land were clear) for the lights rule
    for (const e of es) for (let k = 0; k < 5 && !(e.nl === 2 && e.tl === 1); k++) FT.net.cycleLanes(e.id);
    return [n.x, n.z, n.id, got, want, lost];
  });
  check('lanes tool widens each road as far as the buildings allow, knocking none down', av && av[3].every((g, i) => g[0] === av[4][i][0] && g[1] === av[4][i][1]) && av[5] === 0 && av[3].some(g => g[0] > 1 || g[1]), JSON.stringify(av));
  check('lights added where wide roads cross', await p.evaluate(id => !!FT.net.nodes.get(id).sig, av[2]), await p.evaluate(id => { const n = FT.net.nodes.get(id); return n ? JSON.stringify({ deg: n.edges.size, ring: n.ring, legs: [...n.edges].map(e => { const f = FT.net.edges.get(e); return [f.kind, f.nl, f.tl]; }) }) : 'node gone'; }, av[2]));
  await p.evaluate(() => FT.step(90));
  check('cars use the extra lanes', await p.evaluate(() => FT.net.cars.some(c => c.lane.li > 0 || c.lane.pk)));
  await shot('lanes', { x: av[0] + 10, z: av[1] + 25, dist: 95, yaw: .5, pitch: .78 }, 10);
  await shot('lanes-top', { x: av[0], z: av[1], dist: 140, yaw: 0, pitch: 1.35 }, 10);
  // an overpass over Main Street with the Road tool on Overpass, and an underpass
  const br = await p.evaluate(() => {
    const has = lv => [...FT.net.edges.values()].some(e => e.lv === lv);   // (every town is laid out differently: try a few lines across Main Street)
    for (const x of [125, 110, 135, 95, 140]) { if (has(1)) break; FT.setTool('road'); FT.setLv(1); FT.click(x, -330); FT.hover(x, 160); FT.click(x, 160); }
    for (const x of [250, 270, 230, 290]) { if (has(-1)) break; FT.setTool('road'); FT.setLv(-1); FT.click(x, -300); FT.hover(x, 200); FT.click(x, 200); }
    FT.setLv(0); FT.setTool('road');
    return [...FT.net.edges.values()].filter(e => e.lv).map(e => e.lv);
  });
  check('overpass and underpass built with the Road tool', br.includes(1) && br.includes(-1), JSON.stringify(br));
  check('no road crosses another without a junction or a bridge', await p.evaluate(() => !FT.net.crossesOthers([...FT.net.edges.values()])));
  await shot('overpass', { x: 120, z: -50, dist: 110, yaw: .9, pitch: .45 }, 10);
  await shot('underpass', { x: 250, z: -100, dist: 140, yaw: 3.0, pitch: .7 }, 10);
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
    await q.waitForSelector('#title.show'); await q.click('#playBtn'); await q.evaluate(() => { FT.life.coins = 1e6; FT.setSpeed(0); Object.assign(FT.cam, { x: 0, z: 0, dist: 160, yaw: 0, pitch: 1.3 }); FT.placeCamera(); FT.setTool('road'); });
    const cdp = await ph.newCDPSession(q);
    // touches carry the time they happened (like a real phone), even when this slow test browser handles them late
    const touch = async (pts, holdMs = 0) => {
      const t0 = Date.now() / 1000;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }], timestamp: t0 });
      if (holdMs) await q.waitForTimeout(holdMs);
      for (let i = 1; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1] }], timestamp: t0 + holdMs / 1000 + i * .016 }); await q.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + holdMs / 1000 + pts.length * .016 + .02 }); await q.waitForTimeout(100);
    };
    const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    const ph0 = await q.evaluate(() => ({ e: FT.net.edges.size, x: FT.cam.x, z: FT.cam.z }));
    await touch(line(120, 300, 260, 420));
    const ph1 = await q.evaluate(() => ({ e: FT.net.edges.size, x: FT.cam.x, z: FT.cam.z }));
    check('phone: quick drag moves the map, builds nothing', ph1.e === ph0.e && Math.hypot(ph1.x - ph0.x, ph1.z - ph0.z) > 5, JSON.stringify([ph0, ph1]));
    // hold, then drag: a road from a street out into a block
    // (the camera leans over when zoomed in, so centre it on the spot first: both ends on screen)
    const sp = await q.evaluate(() => { const e = [...FT.net.edges.values()].filter(e => !e.ring && e.len > 60).sort((a, b) => Math.hypot(a.cx - FT.cam.x, a.cz - FT.cam.z) - Math.hypot(b.cx - FT.cam.x, b.cz - FT.cam.z))[0]; const p = FT.along(e.pts, e.cum, e.len / 2); const r = [-p[3], p[2]]; FT.cam.x = p[0] + r[0] * 28; FT.cam.z = p[1] + r[1] * 28; FT.placeCamera(); FT.render(); return [FT.toScreen(p[0] + r[0] * 12.5, p[1] + r[1] * 12.5), FT.toScreen(p[0] + r[0] * 45, p[1] + r[1] * 45)]; });
    await touch(line(sp[1][0], sp[1][1], sp[0][0], sp[0][1]), 450);
    const ph2 = await q.evaluate(() => ({ e: FT.net.edges.size, pin: FT.T.pts.length, toast: document.getElementById('toast').textContent, hint: document.getElementById('hint').textContent }));
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
