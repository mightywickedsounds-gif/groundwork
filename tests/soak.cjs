// Soak test: the game plays itself for a long while (random roads, curves, bridges, roundabouts, lights, lanes,
// one-ways, removals, undo, building, buying land, pausing, day and night, following cars, every panel), at a
// desktop and a phone size, and reports every page error, console error, failed request, broken car or walker
// position, road crossing without a junction, and the memory / GPU objects over time (leaks).
// node tests/soak.cjs [actions per size] [screenshot folder]. Needs Playwright with Chromium.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), N = +(process.argv[2] || 120), OUT = process.argv[3] || require('os').tmpdir();
const TYPES = { js: 'text/javascript', mjs: 'text/javascript', jpg: 'image/jpeg', png: 'image/png', html: 'text/html', woff2: 'font/woff2' };
let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  for (const [tag, opt] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await b.newContext({ ...opt, deviceScaleFactor: 1 }); const p = await ctx.newPage(); p.setDefaultTimeout(300000);
    await p.addInitScript(() => { if (!sessionStorage.getItem('soaked')) { localStorage.clear(); localStorage.setItem('flowtown.quality', 'low'); sessionStorage.setItem('soaked', 1); } });
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|GL Driver/.test(m.text()))) errs.push('console.' + m.type() + ': ' + m.text().slice(0, 200)); });
    p.on('requestfailed', r => errs.push('request failed: ' + r.url()));
    await p.route('http://game.test/**', r => { const u = new URL(r.request().url()), f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(ROOT, f); if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ status: 200, contentType: TYPES[f.split('.').pop()] || 'text/plain', body: fs.readFileSync(fp) }); });
    await p.route(/^https:\/\/cdn\.jsdelivr\.net\//, r => r.continue());
    await p.goto('http://game.test/'); await p.waitForSelector('#title.show');
    await (tag === 'phone' ? p.tap('#playBtn') : p.click('#playBtn')); await p.waitForTimeout(800);
    await p.evaluate(() => { FT.life.coins = 1e7; FT.setSpeed(0); window.__R = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); });
    const mem = [], bad = [], log = {};
    for (let i = 0; i < N; i++) {
      const r = await p.evaluate(i => {
        const R = window.__R, E = [...FT.net.edges.values()], Nd = [...FT.net.nodes.values()], pick = a => a[Math.floor(R() * a.length)];
        const pt = () => [(R() - .5) * 700, (R() - .5) * 700], mid = e => FT.along(e.pts, e.cum, e.len * (.3 + R() * .4));
        const k = Math.floor(R() * 17); let what = '';
        try {
          if (k === 0) { what = 'road'; FT.setTool('road'); FT.setLv(R() < .15 ? (R() < .5 ? 1 : -1) : 0); const a = pt(), c = pt(); FT.click(a[0], a[1]); FT.hover(c[0], c[1]); FT.click(c[0], c[1]); FT.T.pts = []; FT.setLv(0); }
          else if (k === 1) { what = 'curve'; FT.setTool('curve'); const a = pt(), c = pt(), m = pt(); FT.click(a[0], a[1]); FT.click(c[0], c[1]); FT.hover(m[0], m[1]); FT.click(m[0], m[1]); FT.T.pts = []; FT.T.pend = null; }
          else if (k === 2 && E.length > 8) { what = 'erase'; const e = pick(E), q = mid(e); FT.setTool('erase'); FT.hover(q[0], q[1]); FT.click(q[0], q[1]); }
          else if (k === 3) { what = 'lanes'; const e = pick(E), q = mid(e); FT.setTool('lanes'); FT.hover(q[0], q[1]); FT.click(q[0], q[1]); }
          else if (k === 4) { what = 'oneway'; const e = pick(E), q = mid(e); FT.setTool('oneway'); FT.hover(q[0], q[1]); FT.click(q[0], q[1]); }
          else if (k === 5) { what = 'signal'; const n = pick(Nd.filter(n => n.edges.size >= 3)) ; if (n) { FT.setTool('signal'); FT.hover(n.x, n.z); FT.click(n.x, n.z); } }
          else if (k === 6) { what = 'ring'; const n = pick(Nd.filter(n => n.edges.size >= 3 && !n.ring)); if (n) { FT.setTool('ring'); FT.hover(n.x, n.z); FT.click(n.x, n.z); } }
          else if (k === 7) { what = 'undo'; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true })); }
          else if (k === 8) { what = 'build'; const e = pick(E.filter(e => !e.lv && e.len > 40)); if (e) FT.doBuild({ e, s: e.len / 2, sg: R() < .5 ? 1 : -1 }, pick(['diner', 'cafe', 'gas', 'hardware', 'grocery', 'office', 'police', 'fire', 'hospital'])); }
          else if (k === 9) { what = 'land'; FT.buyLand([Math.floor(R() * 5) - 2, Math.floor(R() * 5) - 2], 0); }
          else if (k === 10) { what = 'follow'; const c = pick(FT.net.cars.filter(c => c.pid && !c.hide)); if (c) FT.select({ k: 'p', id: c.pid }); }
          else if (k === 11) { what = 'pickbuilding'; const bd = pick(FT.city.buildings); if (bd) FT.select({ k: 'b', id: bd.id }); }
          else if (k === 12) { what = 'deselect+view'; FT.select(null); FT.toggleView(); }
          else if (k === 13) { what = 'hour'; FT.setHour(R() * 24); }
          else if (k === 14) { what = 'menu'; document.getElementById('menuBtn').click(); document.getElementById('menuSetBtn').click(); document.getElementById('setBack').click(); document.getElementById('closeBtn').click(); }
          else if (k === 15) { what = 'speed'; const ids = ['pauseBtn', 'fastBtn']; document.getElementById(ids[Math.floor(R() * 2)]).click(); for (const bt of document.querySelectorAll('#speed button')) if (R() < .3) bt.click(); }
          else { what = 'tool-escape'; FT.setTool(pick(['road', 'curve', 'build', 'erase', ''])); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); }
        } catch (err) { return { what, err: String(err && err.stack || err).slice(0, 300) }; }
        FT.setTool(''); FT.step(20 + R() * 40);
        const ds = document.getElementById('daySum'); if (ds.classList.contains('show')) document.getElementById('dsGo').click();
        // checks: every car and walker somewhere real, no road crossing another without a junction
        const nanCar = FT.net.cars.find(c => !Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.s) || !c.lane);
        const W = FT.life.walkers, nanW = W.findIndex((w, j) => { const q = FT.pedPos(j); return q && (!Number.isFinite(q[0]) || !Number.isFinite(q[1])); });
        const movers = FT.life.park.movers.filter(m => { const q = FT.life.park.pose(m); return !Number.isFinite(q[0]) || !Number.isFinite(q[2]); }).length;
        const cross = FT.net.crossesOthers([...FT.net.edges.values()]);
        const stuckHidden = FT.net.cars.filter(c => c.hide && FT.net.time - (c.hideT || (c.hideT = FT.net.time)) > 240).length;
        for (const c of FT.net.cars) if (!c.hide) c.hideT = 0;
        return { what, nanCar: nanCar ? nanCar.id : 0, nanW, movers, cross, stuckHidden, cars: FT.net.cars.length, edges: FT.net.edges.size, d: FT.dbg() };
      }, i);
      log[r.what] = (log[r.what] || 0) + 1;
      if (r.err || r.nanCar || r.nanW >= 0 || r.movers || r.cross || r.stuckHidden) bad.push(i + ' ' + JSON.stringify(r).slice(0, 400));
      if (i % 10 === 0) {
        await p.evaluate(() => FT.render());
        const ft = await p.evaluate(async () => { const t = []; let l = performance.now(); for (let k = 0; k < 6; k++) { await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); t.push(n - l); l = n; } return t.sort((a, b) => a - b)[3]; });
        mem.push({ i, heap: r.d && r.d.heap, geo: r.d && r.d.geo, tex: r.d && r.d.tex, ms: Math.round(ft), cars: r.cars, edges: r.edges });
      }
      if (i === Math.floor(N / 2)) {   // save and load in the middle of everything (cars parking, changing lanes, chases)
        const before = await p.evaluate(() => { FT.save && FT.save(); return { e: FT.net.edges.size, b: FT.city.buildings.length }; });
        await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await p.reload(); await p.waitForSelector('#title.show'); await (tag === 'phone' ? p.tap('#playBtn') : p.click('#playBtn')); await p.waitForTimeout(500);
        const after = await p.evaluate(() => { FT.life.coins = 1e7; FT.setSpeed(0); window.__R = (() => { let s = 999; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); FT.step(30); return { e: FT.net.edges.size, b: FT.city.buildings.length, cars: FT.net.cars.length }; });
        check(tag + ': save and reload keeps the town', after.e === before.e && Math.abs(after.b - before.b) <= 2, JSON.stringify([before, after]));
      }
    }
    await p.screenshot({ path: path.join(OUT, 'soak-' + tag + '.png') });
    console.log(tag, 'actions', JSON.stringify(log));
    console.log(tag, 'memory over time', mem.map(m => `#${m.i} heap ${m.heap}MB geo ${m.geo} tex ${m.tex} ${m.ms}ms cars ${m.cars} roads ${m.edges}`).join('\n  '));
    check(tag + ': no page errors', !errs.length, [...new Set(errs)].slice(0, 6).join(' | '));
    check(tag + ': nothing broken during play (errors, NaN cars or walkers, crossings, cars hidden for good)', !bad.length, bad.slice(0, 6).join('\n   '));
    const g0 = mem[1] || mem[0], g1 = mem[mem.length - 1];
    check(tag + ': GPU objects do not keep piling up', g1.geo < g0.geo * 2.5 + 200 && g1.tex < g0.tex + 40, `geo ${g0.geo} -> ${g1.geo}, tex ${g0.tex} -> ${g1.tex}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
