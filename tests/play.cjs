// Gameplay checks for Groundwork: node tests/play.cjs [screenshot folder]. Needs Playwright with Chromium.
// The game's files are handed to the browser straight from disk (page.route), so no web server is needed.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || require('os').tmpdir();
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(180000);
  // the test browser has no graphics card: use the lightest graphics and pause the live loop while checking
  await p.addInitScript(() => localStorage.setItem('groundwork.quality', 'low'));
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('http://game.test/**', r => {
    const u = new URL(r.request().url());
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(fp) });
  });
  await p.goto('http://game.test/');
  await p.waitForFunction(() => window.GW, null, { timeout: 90000 });
  await p.click('#helpGo');
  await p.evaluate(() => GW.pause(true));

  // river
  const river = await p.evaluate(() => { let wet = 0, vol = 0; for (let k = 0; k < GW.W.length; k++) if (GW.W[k] > .05) { wet++; vol += GW.W[k]; } let east = 0; for (let j = 0; j < 160; j++) east = Math.max(east, GW.W[j * 160 + 150]); return { wet, vol: Math.round(vol), east: +east.toFixed(2) }; });
  check('river has water and reaches the east side', river.wet > 500 && river.east > .2, JSON.stringify(river));

  // dozer
  const dz = await p.evaluate(() => {
    GW.select(0); const m = GW.machines[0]; const x0 = m.x, z0 = m.z;
    GW.step(40, { tool: -1 });
    const blade = m.blade;
    GW.step(150, { throttle: 1 });
    const carried = m.load.v;
    GW.step(60, { throttle: -1 });
    return { blade: +blade.toFixed(2), carried: +carried.toFixed(2), left: +m.load.v.toFixed(2), moved: +GW.stats.moved.toFixed(2), dist: +Math.hypot(m.x - x0, m.z - z0).toFixed(1) };
  });
  check('dozer drives, cuts with the blade and leaves the pile when reversing', dz.carried > 1 && dz.moved > .5 && dz.dist > 3, JSON.stringify(dz));

  // loader fills, then dumps into the hauler
  const ld = await p.evaluate(() => {
    GW.select(1); const m = GW.machines[1];
    GW.step(60, { tool: -1 });
    GW.step(90, { throttle: 1 });
    const filled = m.load.v;
    GW.step(80, { tool: 1 });
    // park the hauler with its bed under the bucket, side-on
    const h = GW.machines[3];
    const tip = new m.bucket.position.constructor(0, -.45, .97); m.bucket.localToWorld(tip);
    h.yaw = m.yaw + Math.PI / 2;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    h.x = tip.x + fx * 1.5; h.z = tip.z + fz * 1.5;   // bed centre is 1.5 m behind the hauler's middle
    h.load.v = 0; h.load.g = 0;
    GW.step(3);
    GW.step(30, { act: true });
    return { filled: +filled.toFixed(2), after: +m.load.v.toFixed(2), hauler: +h.load.v.toFixed(2) };
  });
  check('loader fills its bucket by driving into the ground', ld.filled > 2.5, JSON.stringify(ld));
  check('loader dumps into the hauler bed', ld.hauler > 2.5 && ld.after < .1, JSON.stringify(ld));

  // hauler tips its load out
  const hl = await p.evaluate(() => {
    GW.select(3); const h = GW.machines[3]; const before = GW.stats.moved; const had = h.load.v;
    GW.step(150, { act: true });
    return { had: +had.toFixed(2), left: +h.load.v.toFixed(2), dumped: +(GW.stats.moved - before).toFixed(2), tip: +h.tip.toFixed(2) };
  });
  check('hauler tips its bed and dumps everything', hl.left < .01 && hl.dumped > 2.5, JSON.stringify(hl));

  // excavator digs then dumps
  const ex = await p.evaluate(() => {
    GW.select(2); const m = GW.machines[2];
    GW.step(45, { act: true });
    const dug = m.load.v;
    GW.step(30, { swing: 1 });
    GW.step(45, { act: true });
    return { dug: +dug.toFixed(2), after: +m.load.v.toFixed(2) };
  });
  check('excavator digs a bucketful and dumps it', ex.dug > 1 && ex.after < .05, JSON.stringify(ex));

  // dirt slides when piled too steep
  const sl = await p.evaluate(() => {
    const k = 100 * 160 + 120; const before = GW.H[k]; GW.H[k] += 6;
    GW.step(60);
    let steep = 0; for (const n of [1, -1, 160, -160]) steep = Math.max(steep, GW.H[k] - GW.H[k + n]);
    return { before: +before.toFixed(2), after: +GW.H[k].toFixed(2), steep: +steep.toFixed(2) };
  });
  check('a tall pile crumbles until it can stand', sl.steep < 1.3 && sl.after < sl.before + 3, JSON.stringify(sl));

  // finishing a job pays and opens a new one
  const jb = await p.evaluate(() => {
    const j = GW.jobs.find(j => j.type === 'level');
    for (let z = j.z0; z <= j.z1; z++) for (let x = j.x0; x <= j.x1; x++) GW.H[z * 160 + x] = j.target;
    const m0 = GW.stats.money;
    GW.step(25);
    return { paid: GW.stats.money - m0, jobs: GW.jobs.length, stillThere: GW.jobs.includes(j) };
  });
  check('a finished job pays and a new one appears', jb.paid === 450 && jb.jobs === 3 && !jb.stillThere, JSON.stringify(jb));

  await p.evaluate(() => { GW.select(0); GW.step(30); });
  await p.screenshot({ path: OUT + '/p1.png' });

  const bad = await p.evaluate(() => window.__badSound ? [...window.__badSound] : []);
  check('no broken numbers reach the sound', bad.length === 0, JSON.stringify(bad));

  // persistence
  const snap = await p.evaluate(() => { GW.save(); const m = GW.machines[0]; let s = 0; for (let k = 0; k < GW.H.length; k += 7) s += GW.H[k]; return { x: m.x, z: m.z, sum: s, money: GW.stats.money, gone: GW.trees.filter(t => t.st > 0).length }; });
  await p.reload();
  await p.waitForFunction(() => window.GW, null, { timeout: 90000 });
  await p.evaluate(() => GW.pause(true));
  const back = await p.evaluate(() => { const m = GW.machines[0]; let s = 0; for (let k = 0; k < GW.H.length; k += 7) s += GW.H[k]; return { x: m.x, z: m.z, sum: s, money: GW.stats.money, gone: GW.trees.filter(t => t.st > 0).length }; });
  check('the valley is the same after reloading the page', Math.abs(back.sum - snap.sum) < 1 && Math.abs(back.x - snap.x) < .01 && back.money === snap.money && back.gone === snap.gone, JSON.stringify({ snap, back }));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/p2.png' });

  // phone layout
  const ph = await b.newContext({ ...require('playwright').devices['iPhone 13'] });
  const q = await ph.newPage();
  q.setDefaultTimeout(180000);
  await q.addInitScript(() => localStorage.setItem('groundwork.quality', 'low'));
  q.on('pageerror', e => errs.push('PHONE ' + e.message));
  await q.route('http://game.test/**', r => {
    const u = new URL(r.request().url());
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(fp) });
  });
  await q.goto('http://game.test/');
  await q.waitForFunction(() => window.GW, null, { timeout: 90000 });
  await q.click('#helpGo');
  await q.waitForTimeout(2000);
  await q.screenshot({ path: OUT + '/p3.png' });

  check('no script errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})();
