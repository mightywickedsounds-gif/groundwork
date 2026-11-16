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
  // three.js normally comes from jsDelivr; if THREE_DIR points at a local copy of the npm package, serve that instead
  const THREE_DIR = process.env.THREE_DIR;
  const cdn = async page => { if (THREE_DIR) await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => {
    const f = path.join(THREE_DIR, new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', ''));
    r.fulfill({ status: fs.existsSync(f) ? 200 : 404, contentType: 'text/javascript', body: fs.existsSync(f) ? fs.readFileSync(f) : '' });
  }); };
  await cdn(p);
  await p.route('http://game.test/**', r => {
    const u = new URL(r.request().url());
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(fp) });
  });
  await p.goto('http://game.test/');
  await p.waitForFunction(() => window.GW, null, { timeout: 240000 });
  await p.click('#helpGo');
  await p.evaluate(() => GW.pause(true));

  // river
  const river = await p.evaluate(() => { let wet = 0, vol = 0; for (let k = 0; k < GW.W.length; k++) if (GW.W[k] > .05) { wet++; vol += GW.W[k]; } let east = 0; for (let j = 0; j < 256; j++) east = Math.max(east, GW.W[j * 256 + 250]); return { wet, vol: Math.round(vol), east: +east.toFixed(2) }; });
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
    const k = 182 * 256 + 132; const before = GW.H[k]; GW.H[k] += 6; GW.dirty(k);
    GW.step(60);
    let steep = 0; for (const n of [1, -1, 256, -256]) steep = Math.max(steep, GW.H[k] - GW.H[k + n]);
    return { before: +before.toFixed(2), after: +GW.H[k].toFixed(2), steep: +steep.toFixed(2) };
  });
  check('a tall pile crumbles until it can stand', sl.steep < 1.3 && sl.after < sl.before + 3, JSON.stringify(sl));

  // rivers are too deep to drive through
  const fd = await p.evaluate(() => {
    const h = GW.machines[3]; GW.select(3);
    h.x = 120; h.z = 142; h.yaw = Math.PI; h.v = 0;   // on the south bank, facing the river
    let deepest = 0;
    for (let i = 0; i < 300; i++) { GW.step(1, { throttle: 1 }); deepest = Math.max(deepest, GW.W[Math.round(h.z) * 256 + Math.round(h.x)]); }
    return { deepest: +deepest.toFixed(2), ford: GW.SPEC.hauler.ford, z: +h.z.toFixed(1) };
  });
  check('a machine will not drive into water deeper than it can ford', fd.deepest <= fd.ford + .15, JSON.stringify(fd));

  // the natural rivers don't wash their own banks away
  const er0 = await p.evaluate(() => GW.eroded);
  check('untouched river banks do not erode', er0 < .3, JSON.stringify({ eroded: +er0.toFixed(2) }));

  // a dam backs the creek up
  const dm = await p.evaluate(() => {
    const at = (x, z) => GW.W[z * 256 + x];
    let up = 0; for (let x = 58; x <= 80; x++) up = Math.max(up, at(x, 168));
    for (let z = 150; z <= 153; z++) for (let x = 36; x <= 104; x++) { const k = z * 256 + x; GW.H[k] = Math.max(GW.H[k], 14.5); GW.W[k] = 0; GW.dirty(k); }
    GW.step(1500);
    let after = 0; for (let x = 58; x <= 80; x++) after = Math.max(after, at(x, 168));
    return { before: +up.toFixed(2), after: +after.toFixed(2) };
  });
  check('damming a creek makes the water back up behind it', dm.after > dm.before + .4, JSON.stringify(dm));

  // reaching the first goal pays and moves on to the next
  const gl = await p.evaluate(() => {
    const G = GW.GOALS[0], h = GW.machines[3], m0 = GW.stats.money;
    h.x = G.x; h.z = G.z; GW.step(30);
    return { paid: GW.stats.money - m0, next: GW.GOALS[GW.goal.i] && GW.GOALS[GW.goal.i].id };
  });
  check('reaching the gravel pit with the hauler completes the first goal', gl.paid === 800 && gl.next === 'haul', JSON.stringify(gl));

  // a dumped load lands as a real heap, not a thin layer
  const pile = await p.evaluate(() => {
    GW.select(1); const m = GW.machines[1], h = GW.machines[3];
    m.x = 124; m.z = 180; m.yaw = 0; m.arm = .7; m.load.v = 3; m.load.g = 0; GW.step(5);
    const tip = new m.bucket.position.constructor(0, -.45, .97); m.bucket.localToWorld(tip);
    const before = []; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) before.push(GW.H[(Math.round(tip.z) + dz) * 256 + Math.round(tip.x) + dx]);
    GW.step(30, { act: true });
    let top = 0, i = 0; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) top = Math.max(top, GW.H[(Math.round(tip.z) + dz) * 256 + Math.round(tip.x) + dx] - before[i++]);
    return { left: +m.load.v.toFixed(2), top: +top.toFixed(2) };
  });
  check('a 3 m³ bucket dumps as a heap about a metre tall', pile.left < .05 && pile.top > .8, JSON.stringify(pile));

  // fallen trees stay as logs and get shoved about
  const lg = await p.evaluate(() => {
    const d = GW.machines[0]; GW.select(0);
    const t = GW.trees.find(t => t.st === 0 && t.x > 40 && t.x < 200 && t.z > 150 && t.z < 240 && GW.W[Math.round(t.z) * 256 + Math.round(t.x)] === 0 && !GW.machines.some(m => Math.hypot(m.x - t.x, m.z - t.z) < 12));
    d.x = t.x; d.z = t.z - 6; d.yaw = 0; d.v = 0; d.blade = .4;
    GW.step(90, { throttle: 1 });
    const fell = t.st;
    GW.step(600);
    const x0 = t.x, z0 = t.z, st = t.st;
    d.x = t.x + t.dx * 5 - 5; d.z = t.z + t.dz * 5; d.yaw = Math.PI / 2; d.v = 0;
    GW.step(90, { throttle: 1 });
    return { fell, st, moved: +Math.hypot(t.x - x0, t.z - z0).toFixed(2) };
  });
  check('a knocked-down tree stays as a log', lg.fell >= 1 && lg.st === 2, JSON.stringify(lg));
  check('machines push fallen logs out of the way', lg.moved > .5, JSON.stringify(lg));

  // the crew: workers get in, drive, and the player can take one machine over
  const cr = await p.evaluate(() => {
    const ms = GW.machines; const h = ms[3]; h.x = 135; h.z = 174; h.yaw = Math.PI; h.load.v = 0; h.tipping = false; h.tip = 0;
    ms[0].x = 113; ms[0].z = 172; ms[0].yaw = Math.PI; ms[2].x = 127.5; ms[2].z = 173; ms[1].x = 120; ms[1].z = 180;
    GW.setCrew(true); GW.step(1);
    const playerType = ms[GW.active].type;
    const inCab = ms.filter(m => m.ai).map(m => m.type);
    const d0 = [ms[0].x, ms[0].z];
    GW.step(600);
    const dozMoved = Math.hypot(ms[0].x - d0[0], ms[0].z - d0[1]);
    GW.select(0); GW.step(5);
    const takeover = { dozerAI: !!ms[0].ai, othersAI: !!ms[2].ai && !!ms[3].ai };
    return { playerType, inCab, workers: ms.filter(m => m.worker.visible).length, dozMoved: +dozMoved.toFixed(1), takeover };
  });
  check('turning the crew on puts workers in the dozer, excavator and hauler', cr.playerType === 'loader' && cr.inCab.length >= 3 && cr.workers >= 3, JSON.stringify(cr));
  check('taking a machine over leaves the rest of the crew working', !cr.takeover.dozerAI && cr.takeover.othersAI, JSON.stringify(cr));

  // the crew follows the player across the valley
  const fol = await p.evaluate(() => {
    GW.select(1); const L = GW.machines[1]; L.x = 150; L.z = 178; L.yaw = Math.PI / 2; L.v = 0;
    GW.step(30 * 50);
    return { dozer: +Math.hypot(GW.machines[0].x - L.x, GW.machines[0].z - L.z).toFixed(1), hauler: +Math.hypot(GW.machines[3].x - L.x, GW.machines[3].z - L.z).toFixed(1) };
  });
  check('the crew follows the player', fol.dozer < 32 && fol.hauler < 45, JSON.stringify(fol));

  // stop at the river and the crew builds a crossing there
  const build = await p.evaluate(() => {
    const L = GW.machines[1]; L.x = 118; L.z = 142; L.yaw = Math.PI; L.v = 0;
    GW.step(150, { throttle: .6 }); GW.step(90);
    const S = GW.crew.site; if (!S) return { site: false };
    const fill = () => { let v = 0; for (let s = -S.cw; s <= S.cw; s++) for (let o = -2; o <= 2; o++) { const [x, z] = GW.crew.pt(S, s, o); v += GW.H[Math.round(z) * 256 + Math.round(x)]; } return v; };
    const v0 = fill(), f0 = S.front ?? S.head; GW.step(30 * 60 * 5);
    const r = { site: true, kind: S.kind, added: +(fill() - v0).toFixed(1), front: +((S.front ?? S.head) - f0).toFixed(1), stage: GW.crew.stage() || 'done', si: S.si };
    // then let them finish it: every stage must complete (no machine stuck or circling)
    let t = 5; while (GW.crew.site === S && t < 30) { GW.step(30 * 60); t++; }
    r.finished = !GW.crew.site; r.minutes = t; r.last = GW.crew.stage();
    return r;
  });
  check('stopping at the river sets the crew building a crossing', build.site, JSON.stringify(build));
  check('in five minutes the crew has made real progress on the crossing', build.si > 0 || build.front > 6 || build.added > 15, JSON.stringify(build));
  check('the crew finishes the whole crossing within 30 minutes of game time', build.finished, JSON.stringify(build));

  const off = await p.evaluate(() => { GW.setCrew(false); GW.step(5); return { ai: GW.machines.filter(m => m.ai && !m.service).length, workers: GW.machines.filter((m, i) => i !== GW.active && !m.service && m.worker.visible).length }; });
  check('turning the crew off empties the cabs', off.ai === 0 && off.workers === 0, JSON.stringify(off));

  // fast water washes a loose heap out of the river
  const ero = await p.evaluate(() => {
    const e0 = GW.eroded; const r = GW.RIVERS[0].s; let best = r[0]; for (const q of r) if (Math.abs(q[0] - 185) < Math.abs(best[0] - 185)) best = q;
    const [x, z] = best;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const k = (Math.round(z) + dz) * 256 + Math.round(x) + dx; GW.H[k] += .5; GW.D[k] = 1; GW.M[k] = 1; GW.dirty(k); }
    GW.step(900); return { washed: +(GW.eroded - e0).toFixed(2) };
  });
  check('fast water washes loose dirt downstream', ero.washed > .05, JSON.stringify(ero));

  await p.evaluate(() => { GW.select(0); GW.step(30); });
  await p.screenshot({ path: OUT + '/p1.png' });

  const bad = await p.evaluate(() => window.__badSound ? [...window.__badSound] : []);
  check('no broken numbers reach the sound', bad.length === 0, JSON.stringify(bad));

  // persistence
  const snap = await p.evaluate(() => { GW.save(); const m = GW.machines[0]; m.goalI = GW.goal.i; let s = 0; for (let k = 0; k < GW.H.length; k += 7) s += GW.H[k]; return { x: m.x, z: m.z, sum: s, money: GW.stats.money, gone: GW.trees.filter(t => t.st > 0).length }; });
  await p.reload();
  await p.waitForFunction(() => window.GW, null, { timeout: 240000 });
  await p.evaluate(() => GW.pause(true));
  const back = await p.evaluate(() => { const m = GW.machines[0]; let s = 0; for (let k = 0; k < GW.H.length; k += 7) s += GW.H[k]; return { x: m.x, z: m.z, sum: s, money: GW.stats.money, gone: GW.trees.filter(t => t.st > 0).length, goal: GW.goal.i }; });
  check('the valley is the same after reloading the page', Math.abs(back.sum - snap.sum) < 1 && Math.abs(back.x - snap.x) < .01 && back.money === snap.money && back.gone === snap.gone, JSON.stringify({ snap, back }));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/p2.png' });

  // phone layout
  const ph = await b.newContext({ ...require('playwright').devices['iPhone 13'] });
  const q = await ph.newPage();
  q.setDefaultTimeout(180000);
  await q.addInitScript(() => localStorage.setItem('groundwork.quality', 'low'));
  q.on('pageerror', e => errs.push('PHONE ' + e.message));
  await cdn(q);
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
