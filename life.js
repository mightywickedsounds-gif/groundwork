// The people of the town and its money: names, homes, jobs, bosses, daily routines, businesses, coins, goals.
// No drawing here (runs in Node for the tests).
import { along, closestOnPoly, halfW, WALK_W } from './net.js';
import { DAY, BLOCK } from './city.js';

const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const pickH = (list, a, b, c) => list[Math.floor(hash(a, b, c) * list.length) % list.length];

const FIRST = ['James', 'Maria', 'Robert', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'Jose', 'Patricia', 'Daniel', 'Sarah', 'Carlos', 'Jessica', 'Luis', 'Ashley', 'Matthew', 'Emily', 'Juan', 'Brittany', 'Joshua', 'Amanda', 'Tyler', 'Megan', 'Brandon', 'Laura', 'Austin', 'Rachel', 'Cody', 'Kayla', 'Travis', 'Lauren', 'Dustin', 'Hannah', 'Ricardo', 'Sofia', 'Miguel', 'Isabella', 'Diego', 'Valeria', 'Kevin', 'Heather', 'Brian', 'Crystal', 'Ray', 'Dolores', 'Wade', 'Tammy', 'Earl', 'Peggy', 'Hector', 'Rosa', 'Javier', 'Lupe', 'Dwayne', 'Shelby', 'Colton', 'Kaitlyn', 'Ethan', 'Olivia', 'Noah', 'Ava', 'Mateo', 'Camila', 'Grant', 'Paige', 'Marcus', 'Tasha', 'Andre', 'Keisha', 'Tran', 'Mai', 'Raj', 'Priya', 'Wei', 'Lin'];
const LAST = ['Smith', 'Garcia', 'Johnson', 'Martinez', 'Williams', 'Hernandez', 'Brown', 'Lopez', 'Jones', 'Gonzalez', 'Miller', 'Rodriguez', 'Davis', 'Perez', 'Wilson', 'Sanchez', 'Anderson', 'Ramirez', 'Taylor', 'Torres', 'Thomas', 'Flores', 'Moore', 'Rivera', 'Jackson', 'Gomez', 'White', 'Diaz', 'Harris', 'Reyes', 'Clark', 'Cruz', 'Lewis', 'Morales', 'Walker', 'Ortiz', 'Hall', 'Gutierrez', 'Young', 'Chavez', 'King', 'Ramos', 'Wright', 'Ruiz', 'Hill', 'Mendoza', 'Scott', 'Vasquez', 'Green', 'Castillo', 'Baker', 'Jimenez', 'Nelson', 'Moreno', 'Carter', 'Herrera', 'Mitchell', 'Medina', 'Roberts', 'Aguilar', 'Phillips', 'Garza', 'Evans', 'Vargas', 'Turner', 'Guerrero', 'Parker', 'Salinas', 'Collins', 'Trevino', 'Stewart', 'Pena', 'Morris', 'Cantu', 'Murphy', 'Nguyen', 'Cook', 'Tran', 'Rogers', 'Patel', 'Reed', 'Kim', 'Bell', 'Huber', 'Schmidt', 'Weber', 'Krause', 'Meyer'];
// street names: Main Street runs east-west through the middle; the rest come from the grid line
const EW = ['Pecan St', 'Live Oak St', 'Cedar St', 'Main St', 'Mesquite St', 'Bluebonnet Dr', 'Hackberry St', 'Sycamore St', 'Elm St', 'Walnut St', 'Juniper St', 'Willow St', 'Magnolia St', 'Cypress St', 'Persimmon St', 'Redbud Ln', 'Agarita St', 'Yaupon St', 'Laurel St', 'Sumac St', 'Chinquapin St', 'Hawthorn St'];
const NS = ['1st St', '2nd St', '3rd St', '4th St', '5th St', '6th St', '7th St', '8th St', '9th St', '10th St', '11th St', '12th St', '13th St', '14th St', '15th St', '16th St', '17th St', '18th St', '19th St', '20th St', '21st St', '22nd St'];
const BENT = ['Creek Bend', 'Ranch Rd', 'Mesa Trl', 'Limestone Way', 'Prairie Loop', 'Canyon Dr', 'Hilltop Rd', 'Bluff View', 'Ridge Rd', 'Arroyo Dr', 'Sunset Loop', 'Quarry Rd', 'Mill Rd', 'Pasture Ln', 'Bridle Path', 'Windmill Dr'];

// what you can build. kind = how it's drawn; fw x fd = frontage x depth (m); h = height; jobs per level; rate = coins an hour
// with full staff at level 1; spend = what a customer leaves; hours open; titles: [boss, second, staff...]; pop = people needed first
export const BIZ = {
  diner: { name: 'Diner', kind: 'shop', fw: 18, fd: 16, h: 5, jobs: [4, 6, 8, 11, 14], rate: 30, spend: 9, hours: [6, 22], cost: 700, up: 420, food: 1,
    titles: ['Owner', 'Manager', 'Head Cook', 'Cook', 'Server', 'Server', 'Dishwasher', 'Host'], names: ['Bluebonnet Diner', 'Lone Star Grill', '{L} Family Diner', 'Pecan Street Cafe', 'Two Creeks Diner', 'The Chuckwagon', 'Sunrise Kitchen', '{L}\'s Kitchen'] },
  cafe: { name: 'Coffee Shop', kind: 'shop', fw: 12, fd: 13, h: 4.6, jobs: [3, 4, 6, 8, 10], rate: 20, spend: 6, hours: [6, 18], cost: 500, up: 320, food: 1, pop: 25,
    titles: ['Owner', 'Shift Lead', 'Barista', 'Barista', 'Baker'], names: ['Limestone Coffee', 'Cedar Roasters', 'Porch Light Coffee', 'Daybreak Coffee Co.', 'Bean & Barrel'] },
  gas: { name: 'Gas Station', kind: 'shop', fw: 20, fd: 14, h: 4.6, jobs: [3, 4, 6, 8, 10], rate: 24, spend: 15, hours: [0, 24], cost: 900, up: 500,
    titles: ['Owner', 'Manager', 'Clerk', 'Clerk', 'Mechanic'], names: ['Hill Country Fuel', '{L} Gas & Go', 'Crossroads Fuel Stop', 'Blue Star Gas', 'Red Mesa Fuel'] },
  salon: { name: 'Salon', kind: 'shop', fw: 12, fd: 14, h: 4.6, jobs: [3, 4, 6, 8, 10], rate: 20, spend: 14, hours: [9, 19], cost: 500, up: 350,
    titles: ['Owner', 'Salon Manager', 'Stylist', 'Stylist', 'Receptionist', 'Barber'], names: ['Shear Country', 'Main Street Salon', 'The Velvet Chair', '{L} Barber Shop', 'Hilltop Hair'] },
  hardware: { name: 'Hardware Store', kind: 'shop', fw: 28, fd: 22, h: 6, jobs: [4, 6, 9, 12, 16], rate: 34, spend: 18, hours: [7, 19], cost: 1100, up: 650,
    titles: ['Owner', 'Store Manager', 'Sales Associate', 'Cashier', 'Yard Worker'], names: ['{L} Hardware', 'Cedar Creek Lumber & Supply', 'Hill Country Hardware', 'Fence Post Supply'] },
  auto: { name: 'Auto Repair', kind: 'shop', fw: 22, fd: 18, h: 5.6, jobs: [3, 5, 7, 9, 12], rate: 32, spend: 25, hours: [7, 18], cost: 900, up: 550,
    titles: ['Owner', 'Shop Foreman', 'Mechanic', 'Mechanic', 'Service Writer', 'Tire Tech'], names: ['{L} Auto Repair', 'Precision Auto', 'Ranch Road Garage', 'Tri-County Tire & Lube'] },
  grocery: { name: 'Grocery', kind: 'shop', fw: 34, fd: 24, h: 6.5, jobs: [6, 9, 13, 18, 24], rate: 44, spend: 22, hours: [7, 22], cost: 1500, up: 850, food: 1, pop: 35,
    titles: ['Owner', 'Store Manager', 'Assistant Manager', 'Cashier', 'Stocker', 'Butcher', 'Produce Clerk'], names: ['{L} Grocery', 'Town & Country Market', 'Fresh Harvest Foods', 'Corner Market'] },
  office: { name: 'Offices', kind: 'office', fw: 24, fd: 20, h: 7.5, grow: 3.6, jobs: [8, 14, 20, 28, 38], rate: 58, spend: 0, hours: [8, 17], cost: 2200, up: 1300, pop: 60,
    titles: ['CEO', 'Director', 'Senior Analyst', 'Accountant', 'Analyst', 'Office Assistant', 'Receptionist', 'Sales Rep', 'Software Developer'], names: ['{L} & Associates', 'Hill Country Insurance', 'Limestone Realty', 'Cedar Point Software', 'Pecan Valley Title Co.', '{L} Law Office'] },
  bank: { name: 'Bank', kind: 'office', fw: 20, fd: 18, h: 6.5, jobs: [5, 7, 10, 13, 17], rate: 52, spend: 0, hours: [9, 17], cost: 2600, up: 1500, pop: 90,
    titles: ['Branch President', 'Branch Manager', 'Loan Officer', 'Teller', 'Teller', 'Personal Banker'], names: ['First Hill Country Bank', 'Pecan Valley Savings', 'Lone Oak Credit Union'] },
  market: { name: 'Supermarket', kind: 'big', fw: 62, fd: 40, h: 8.5, jobs: [14, 20, 28, 38, 50], rate: 95, spend: 40, hours: [6, 23], cost: 5200, up: 2800, food: 1, pop: 200,
    titles: ['Store Director', 'Store Manager', 'Department Manager', 'Cashier', 'Stocker', 'Butcher', 'Baker', 'Pharmacist', 'Bagger'], names: ['Big Bluebonnet Market', 'Hill Country Supercenter', 'ValuMart'] },
  police: { name: 'Police Station', kind: 'office', svc: 1, fw: 26, fd: 22, h: 7, jobs: [5, 8, 11, 15, 20], rate: 0, spend: 0, hours: [0, 24], cost: 3000, up: 1800, upkeep: 110, pop: 30,
    titles: ['Chief of Police', 'Lieutenant', 'Sergeant', 'Patrol Officer', 'Patrol Officer', 'Patrol Officer', 'Detective', 'Dispatcher', 'Traffic Officer'], names: ['Flowtown Police Department'] },
  fire: { name: 'Fire Station', kind: 'office', svc: 1, fw: 24, fd: 20, h: 7.5, jobs: [5, 8, 11, 14, 18], rate: 0, spend: 0, hours: [0, 24], cost: 2800, up: 1600, upkeep: 90, pop: 60,
    titles: ['Fire Chief', 'Captain', 'Lieutenant', 'Firefighter', 'Firefighter', 'Engineer', 'Paramedic'], names: ['Flowtown Fire Station'] },
  hospital: { name: 'Hospital', kind: 'office', svc: 1, fw: 40, fd: 30, h: 11, jobs: [10, 16, 24, 32, 44], rate: 0, spend: 30, hours: [0, 24], cost: 4500, up: 2500, upkeep: 160, pop: 120,
    titles: ['Chief of Medicine', 'Head Nurse', 'Doctor', 'Nurse', 'Nurse', 'EMT', 'Paramedic', 'Orderly', 'Receptionist'], names: ['Hill Country Medical Center'] },
};
export const BUILD_ORDER = ['diner', 'cafe', 'salon', 'gas', 'auto', 'hardware', 'grocery', 'office', 'bank', 'market', 'police', 'fire', 'hospital'];
export const MAX_LVL = 5;
export const lvlMul = l => Math.pow(1.65, l - 1);
export const upCost = (t, l) => Math.round(BIZ[t].up * Math.pow(2.05, l - 1) / 10) * 10;
// player costs
export const COST = { road: 1.6, lane: 1.1, light: 250, ring: 650, land: n => Math.round(3000 * Math.pow(1.75, n) / 100) * 100 };
// fines go to the town
export const FINE = { speeding: 160, redlight: 220, noins: 300, expired: 120, reckless: 400, hitrun: 900, robbery: 0 };

const hrIn = (h, a, b) => { a = ((a % 24) + 24) % 24; b = ((b % 24) + 24) % 24; if (b - a === 0) return true; return a < b ? h >= a && h < b : h >= a || h < b; };

export function createLife(net, city, seed = 1) {
  const L = { coins: 1500, people: new Map(), walkers: [], bmap: new Map(), ver: 0, seed,
    day: null, dayN: 0, goalI: 0, feed: [], events: [], hireT: 0, sliceI: 0, earnT: 0, bought: 0 };
  const newDay = () => ({ biz: 0, tax: 0, fines: 0, upkeep: 0, spent: 0, trips: 0, late: 0, crashes: 0, stops: 0, arrests: 0, robberies: 0 });
  L.day = newDay();
  const now = () => net.time;
  L.T = 0;   // the game clock (S.time); the game sets it every step
  L.hour = () => (L.T / DAY * 24) % 24;
  L.dayNum = () => Math.floor(L.T / DAY);

  // ---------- people from homes ----------
  function makePerson(b, k) {
    const id = b.id * 256 + k, h = (n) => hash(b.id, k, n * 31 + seed);
    const ln = k > 0 && h(1) < .7 && b.kind === 'house' ? (L.people.get(b.id * 256) || {}).ln || pickH(LAST, b.id, 0, seed) : pickH(LAST, b.id, k, seed + 3);
    const kid = b.kind === 'house' && k >= 2 && h(2) < .75;
    const age = kid ? 5 + Math.floor(h(3) * 13) : 19 + Math.floor(Math.pow(h(3), 1.3) * 64);
    return { id, home: b.id, fn: pickH(FIRST, b.id, k, seed + 7), ln, age, kid, ret: age >= 67,
      ins: h(4) < .82, reg: h(5) < .9, temper: h(6), carK: h(7), carC: h(8), lead: .45 + h(9) * .5,
      work: 0, rank: -1, state: 'in', at: b.id, since: now(), until: 0, back: 0, why: 'home', lunchDay: -1, workDay: -1, car: null, walk: null, late: 0 };
  }
  L.sync = function () {
    L.bmap = new Map(city.buildings.map(b => [b.id, b]));
    const want = new Set();
    for (const b of city.buildings) {
      if (b.biz) { const B = BIZ[b.biz.t]; b.jobs = B.jobs[b.biz.lvl - 1]; b.biz.staff = (b.biz.staff || []).filter(id => L.people.has(id)); if (!b.biz.name) b.biz.name = bizName(b); }
      for (let k = 0; k < b.res; k++) { const id = b.id * 256 + k; want.add(id); if (!L.people.has(id)) L.people.set(id, makePerson(b, k)); }
    }
    for (const [id, p] of L.people) if (!want.has(id)) { leaveJob(p); L.people.delete(id); }
    for (const p of L.people.values()) {
      if (p.work && !(L.bmap.get(p.work) || {}).biz) { p.work = 0; p.rank = -1; }
      if (p.state === 'in' && !L.bmap.has(p.at)) { p.at = p.home; }
    }
    for (const b of city.buildings) if (b.biz) b.biz.staff = b.biz.staff.filter(id => { const p = L.people.get(id); return p && p.work === b.id; });
    L.ver++;
  };
  function bizName(b) {
    const B = BIZ[b.biz.t], used = new Set(city.buildings.filter(o => o.biz && o !== b).map(o => o.biz.name));
    for (let i = 0; i < 12; i++) { const n = pickH(B.names, b.id, i, seed).replace('{L}', pickH(LAST, b.id, i + 50, seed)); if (!used.has(n)) return n; }
    return B.name + ' #' + b.id;
  }
  function leaveJob(p) { const w = p.work && L.bmap.get(p.work); if (w && w.biz) w.biz.staff = w.biz.staff.filter(id => id !== p.id); p.work = 0; p.rank = -1; }
  // job titles and bosses come from the order people were hired in
  L.title = p => { const w = p.work && L.bmap.get(p.work); if (!w || !w.biz) return ''; const T = BIZ[w.biz.t].titles, i = w.biz.staff.indexOf(p.id); return i < 0 ? '' : i < 2 ? T[i] : T[2 + (i - 2) % (T.length - 2)]; };
  L.boss = p => { const w = p.work && L.bmap.get(p.work); if (!w || !w.biz) return null; const i = w.biz.staff.indexOf(p.id); if (i <= 0) return null; return L.people.get(w.biz.staff[i === 1 ? 0 : (w.biz.staff.length > 1 ? 1 : 0)]) || null; };
  // work hours: long-hours places run shifts
  L.shift = p => {
    const w = L.bmap.get(p.work); if (!w || !w.biz) return null;
    const [o, c] = BIZ[w.biz.t].hours, i = Math.max(0, w.biz.staff.indexOf(p.id)), span = c - o;
    if (span >= 24) return [[6, 14], [14, 22], [22, 30]][i < 2 ? 0 : i % 3];
    if (span > 10 && i >= 2) return i % 2 ? [c - 8, c] : [o, o + 8];
    return [o, Math.min(c, o + (span > 10 ? 9 : span))];
  };
  function hire() {
    const free = [...L.people.values()].filter(p => !p.work && !p.kid && !p.ret && p.age >= 18);
    if (!free.length) return;
    for (const b of city.buildings) {
      if (!b.biz) continue;
      while (b.biz.staff.length < b.jobs && free.length) {
        let bi = 0, bd = 1e18;   // the nearest one looking for work
        for (let i = 0; i < free.length; i++) { const h = L.bmap.get(free[i].home); const d = h ? Math.hypot(h.x - b.x, h.z - b.z) + hash(free[i].id, b.id, seed) * 200 : 1e9; if (d < bd) { bd = d; bi = i; } }
        const p = free.splice(bi, 1)[0]; p.work = b.id; b.biz.staff.push(p.id);
      }
    }
  }
  L.openJobs = () => { let n = 0; for (const b of city.buildings) if (b.biz) n += Math.max(0, b.jobs - b.biz.staff.length); return n; };
  L.jobless = () => { let n = 0; for (const p of L.people.values()) if (!p.work && !p.kid && !p.ret) n++; return n; };
  // how many more homes the town wants: people move in when there's work
  L.wantHomes = () => Math.max(0, Math.ceil((L.openJobs() - L.jobless()) / 2.2));

  // ---------- where things are ----------
  // the door of a building and the sidewalk spot in front of it
  L.door = function (b) {
    const e = b.e; if (!e || !e.pts) return null;
    const c = closestOnPoly(e.pts, e.cum, b.fx, b.fz), q = along(e.pts, e.cum, c.s);
    let side = Math.sign((b.x - q[0]) * -q[3] + (b.z - q[1]) * q[2]) || 1;   // right of the street = +1
    const w = halfW(e) + WALK_W * .55, sx = q[0] - q[3] * w * side, sz = q[1] + q[2] * w * side;
    let ux = b.x - sx, uz = b.z - sz; const D = Math.hypot(ux, uz) || 1; ux /= D; uz /= D;
    const r = b.rot || 0, cs = Math.cos(r), sn = Math.sin(r), lx = ux * cs + uz * sn, lz = -ux * sn + uz * cs;
    const hd = Math.min(b.w / 2 / Math.max(1e-3, Math.abs(lx)), b.d / 2 / Math.max(1e-3, Math.abs(lz)));
    const dd = Math.max(0, D - hd + .3);
    return { e, s: c.s, side, walk: [sx, sz], door: [sx + ux * dd, sz + uz * dd], kerb: [q[0] - q[3] * (halfW(e) - 1.2) * side, q[1] + q[2] * (halfW(e) - 1.2) * side] };
  };
  const swPt = (e, s, side, o) => { const q = along(e.pts, e.cum, s), w = halfW(e) + o; return [q[0] - q[3] * w * side, q[1] + q[2] * w * side]; };
  // a walk along the sidewalks from one building to another (or back home), crossing at corners
  function walkRoute(A, B, o) {
    if (!A || !B) return null;
    const pts = [A.door, A.walk];
    const run = (e, s0, s1, side) => { const st = s1 > s0 ? 2.5 : -2.5; for (let s = s0; st > 0 ? s < s1 : s > s1; s += st) pts.push(swPt(e, s, side, o)); pts.push(swPt(e, s1, side, o)); };
    if (A.e === B.e) { run(A.e, A.s, B.s, A.side); if (A.side !== B.side) pts.push(B.walk); }
    else {
      // nodes: shortest way by street length (no roundabouts)
      const dist = new Map(), prev = new Map(), todo = [];
      for (const [nid, d0] of [[A.e.a, A.s], [A.e.b, A.e.len - A.s]]) { dist.set(nid, d0); prev.set(nid, null); todo.push(nid); }
      let guard = 0;
      while (todo.length && guard++ < 4000) {
        let bi = 0; for (let i = 1; i < todo.length; i++) if (dist.get(todo[i]) < dist.get(todo[bi])) bi = i;
        const n = todo.splice(bi, 1)[0], dn = dist.get(n), node = net.nodes.get(n); if (!node || dn > 2500) continue;
        for (const id of node.edges) {
          const e = net.edges.get(id); if (!e || e.ring) continue; const m = e.a === n ? e.b : e.a, d = dn + e.len;
          if (d < (dist.get(m) ?? 1e18)) { if (!dist.has(m)) todo.push(m); dist.set(m, d); prev.set(m, [n, e]); }
        }
      }
      let end = null, bd = 1e18;
      for (const [nid, d1] of [[B.e.a, B.s], [B.e.b, B.e.len - B.s]]) { const d = (dist.get(nid) ?? 1e18) + d1; if (d < bd) { bd = d; end = nid; } }
      if (!end || bd > 2500) return null;
      const chain = []; let n = end; while (prev.get(n)) { const [p, e] = prev.get(n); chain.unshift([p, e, n]); n = p; }
      const startNode = n;
      let side = A.side, e = A.e;
      const trimAt = (e, nid) => { const node = net.nodes.get(nid), t = node && node.edges.size > 1 ? net.trimOf(node) + 1.5 : 1; return e.a === nid ? Math.min(e.len / 2, t) : Math.max(e.len / 2, e.len - t); };
      run(e, A.s, trimAt(e, startNode), side);
      for (const [from, f, to] of chain) {
        const s0 = trimAt(f, from), cur = pts[pts.length - 1];
        const fs = f === B.e ? B.side : (() => { const a = swPt(f, s0, 1, o), b = swPt(f, s0, -1, o); return Math.hypot(a[0] - cur[0], a[1] - cur[1]) < Math.hypot(b[0] - cur[0], b[1] - cur[1]) ? 1 : -1; })();
        run(f, s0, trimAt(f, to), fs); side = fs; e = f;
      }
      const last = trimAt(B.e, end), cur = pts[pts.length - 1], a = swPt(B.e, last, B.side, o);
      if (Math.hypot(a[0] - cur[0], a[1] - cur[1]) > .5) pts.push(a);
      run(B.e, last, B.s, B.side); void side; void e;
    }
    pts.push(B.walk, B.door);
    return pts;
  }
  function startWalk(p, pts, to, why) {
    if (!pts || pts.length < 2) { arrive(p, to, why); return; }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const w = { pid: p.id, pts, cum, s: 0, len: cum[cum.length - 1], v: (p.kid ? 1.25 : 1.05 + hash(p.id, 3, seed) * .5) * (p.age > 70 ? .75 : 1), to, why, ph: hash(p.id, 4, seed) * 6 };
    p.state = 'walk'; p.walk = w; L.walkers.push(w);
  }
  // ---------- going places ----------
  const D = b => b && L.door(b);
  function go(p, to, why) {
    const A = L.bmap.get(p.at), B = L.bmap.get(to);
    if (!A || !B) return;
    if (A === B) { arrive(p, to, why); return; }
    const dA = D(A), dB = D(B); if (!dA || !dB) return;
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    const walkMax = p.kid ? 900 : why === 'lunch' ? 460 : why === 'walk' ? 900 : 140;   // Texas: most people drive anywhere further than next door
    if (d < walkMax) {    // close: walk
      const pts = walkRoute(dA, dB, .5 + hash(p.id, 5, seed) * 1.6);
      if (pts) { startWalk(p, pts, to, why); return; }
      if (p.kid) return;
    }
    // drive: queue a trip; the driver walks out to the car
    p.state = 'wait'; p.why = why; p.dest = to;
    city.queue.push({ from: A, to: B, t: 0, pid: p.id, kindRoll: p.carK, colorRoll: p.carC,
      ok: car => { car.pid = p.id; p.car = car; p.state = 'drive'; L.day.trips++; const w = [dA.door, dA.walk, dA.kerb]; ghost(p, w); },
      fail: why2 => { if (why2 === 'stranded') { p.state = 'in'; p.since = now(); p.until = now() + 40; p.blocked = why2; } else arrive(p, to, why); } });   // roads too full to pull out: they get there anyway (unseen)
  }
  // a short walk drawn for someone already in their car (out of the door to the kerb)
  function ghost(p, pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); L.walkers.push({ pid: p.id, pts, cum, s: 0, len: cum[cum.length - 1], v: 1.6, ghost: true, ph: 0 }); }
  function arrive(p, to, why) {
    p.state = 'in'; p.at = to; p.since = now(); p.walk = null; p.car = null; p.why = why; p.blocked = null;
    const b = L.bmap.get(to);
    if (p.guest) p.until = now() + (20 + Math.random() * 30) * DAY / 24 / 60 * 1.6;
    if (b && b.biz && (why === 'shop' || why === 'lunch')) {
      const B = BIZ[b.biz.t]; if (B.spend && hrIn(L.hour(), B.hours[0], B.hours[1])) { const c = B.spend * lvlMul(b.biz.lvl) * (.7 + hash(p.id, L.dayNum(), seed) * .6); addCash(b, c); }
      p.until = now() + (why === 'lunch' ? 30 : 25 + hash(p.id, 9, seed) * 40) * DAY / 24 / 60 * 1.6;
    }
    if (why === 'work' && p.workDay !== L.dayNum()) { const sh = L.shift(p); if (sh) { const h = L.hour(), late = ((h - sh[0]) % 24 + 24) % 24; if (late > .25 && late < 8) { p.late = late; L.day.late++; } else p.late = 0; } }
  }
  function addCash(b, c) {
    const B = BIZ[b.biz.t], cap = Math.max(60, B.rate * lvlMul(b.biz.lvl) * 7 + (B.spend || 0) * 20);
    if (b.biz.lvl >= 3) { L.coins += c; L.day.biz += c; b.biz.auto = (b.biz.auto || 0) + c; return; }   // a manager banks it
    b.biz.cash = Math.min(cap, (b.biz.cash || 0) + c);
  }
  L.collect = function (b) { if (!b || !b.biz || !b.biz.cash) return 0; const c = Math.floor(b.biz.cash); L.coins += c; L.day.biz += c; b.biz.cash -= c; return c; };
  L.cashCap = b => { const B = BIZ[b.biz.t]; return Math.max(60, B.rate * lvlMul(b.biz.lvl) * 7 + (B.spend || 0) * 20); };

  // a car got there (or gave up): the driver walks in
  L.carDone = function (car) {
    const g = car.pid < 0 && L.guests.get(car.pid);
    if (g) {
      if (g.car !== car) return; g.car = null;
      const to = g.dest; if (!to || to.exit || car.gave) { L.guests.delete(g.id); return; }   // out of town
      const dB = D(to); if (!dB) { L.guests.delete(g.id); return; }
      g.at = to.id; startWalk(g, [[car.x, car.z], dB.kerb, dB.walk, dB.door], to.id, 'shop'); return;
    }
    const p = car.pid && L.people.get(car.pid); if (!p || p.car !== car) return;
    const to = p.dest, B = L.bmap.get(to); p.car = null;
    if (!B) { p.state = 'in'; p.at = p.home; return; }
    if (car.gave) { L.day.late++; arrive(p, to, p.why); return; }
    const dB = D(B); if (!dB) { arrive(p, to, p.why); return; }
    startWalk(p, [[car.x, car.z], dB.kerb, dB.walk, dB.door], to, p.why);
  };

  // ---------- visitors: through traffic on the edge roads, and out-of-towners stopping at the shops ----------
  L.guests = new Map(); let guestN = 0, guestAcc = 0;
  L.exits = function () {   // dead ends on the outer edge of the town's land
    const bb = city.bounds(), out = [];
    for (const n of net.nodes.values()) {
      if (n.edges.size !== 1) continue;
      if (city.inCity(n.x, n.z) && Math.min(Math.abs(n.x - bb.x0), Math.abs(n.x - bb.x1), Math.abs(n.z - bb.z0), Math.abs(n.z - bb.z1)) > 20) continue;   // out of town, or on its edge
      const e = net.edges.get([...n.edges][0]); if (!e || e.ring || e.len < 25) continue;
      const s = e.a === n.id ? 6 : e.len - 6, q = along(e.pts, e.cum, s);
      out.push({ id: -n.id, e, fx: q[0], fz: q[1], exit: true, x: q[0], z: q[1] });
    }
    return out;
  };
  function guestTrip(g, from, to) {
    g.state = 'wait'; g.dest = to;
    city.queue.push({ from, to, t: 0, pid: g.id, kindRoll: g.carK, colorRoll: g.carC,
      ok: car => { car.pid = g.id; g.car = car; g.state = 'drive'; },
      fail: () => { if (to.exit) L.guests.delete(g.id); else { g.state = 'in'; g.at = to.id; g.until = now() + 60; } } });
  }
  function guests(dt) {
    const h = L.hour(), rate = (7 + L.people.size * .09) * (.25 + .9 * Math.exp(-((h - 8.2) ** 2) / 3) + .8 * Math.exp(-((h - 17.3) ** 2) / 3.5) + .5 * Math.exp(-((h - 12.5) ** 2) / 6)) * (h < 5.5 || h > 22.5 ? .25 : 1);
    guestAcc += rate * dt / DAY * 24;
    if (guestAcc >= 1) {
      guestAcc -= 1;
      const X = L.exits(); if (!X.length) return;
      const from = X[Math.floor(Math.random() * X.length)], R = Math.random;
      const g = { id: -(++guestN), guest: true, fn: FIRST[Math.floor(R() * FIRST.length)], ln: LAST[Math.floor(R() * LAST.length)], age: 18 + Math.floor(R() * 60),
        ins: R() < .78, reg: R() < .86, temper: R(), carK: R(), carC: R(), state: 'out', why: 'through', from: from.id };
      const shops = city.buildings.filter(b => b.biz && BIZ[b.biz.t].spend > 0 && !BIZ[b.biz.t].svc && hrIn(h, BIZ[b.biz.t].hours[0], BIZ[b.biz.t].hours[1] - .5));
      L.guests.set(g.id, g);
      if (shops.length && R() < .45) { const b = shops[Math.floor(R() * shops.length)]; g.why = 'shop'; guestTrip(g, from, b); }
      else { const others = X.filter(x => x !== from && Math.hypot(x.x - from.x, x.z - from.z) > 80); if (!others.length) { L.guests.delete(g.id); return; } g.why = 'through'; guestTrip(g, from, others[Math.floor(R() * others.length)]); }
    }
    for (const g of L.guests.values()) if (g.state === 'in' && now() > g.until) {
      const X = L.exits(), b = L.bmap.get(g.at); if (!X.length || !b) { L.guests.delete(g.id); continue; }
      g.why = 'leave'; guestTrip(g, b, X[Math.floor(Math.random() * X.length)]);
    }
  }
  L.person = id => id > 0 ? L.people.get(id) : L.guests.get(id);

  // ---------- every step ----------
  function decide(p) {
    if (p.state !== 'in') return;
    const h = L.hour(), day = L.dayNum(), t = now();
    if (p.blocked && t < p.until) return;
    const atHome = p.at === p.home;
    if (p.work) {
      const sh = L.shift(p); if (!sh) return;
      const onShift = hrIn(h, sh[0], sh[1]);
      if (atHome) {
        if (hrIn(h, sh[0] - p.lead, sh[1] - 1) && p.workDay !== day) { p.workDay = day; go(p, p.work, 'work'); return; }
      } else if (p.at === p.work) {
        if (!onShift && !hrIn(h, sh[0] - p.lead - .2, sh[0])) {
          if (hash(p.id, day, seed + 11) < .22) { const s = errandSpot(p, h); if (s) { p.back = p.home; go(p, s.id, 'shop'); return; } }
          go(p, p.home, 'home'); return;
        }
        if (h > 11.4 && h < 13.2 && p.lunchDay !== day && sh[1] - sh[0] <= 10 && hash(p.id, day, seed + 13) < .4) {
          p.lunchDay = day; const f = food(p, h); if (f) { p.back = p.work; go(p, f.id, 'lunch'); return; }
        }
      } else if (t > p.until) { go(p, p.back && (p.back !== p.work || onShift) ? p.back : p.home, p.back === p.work && onShift ? 'work' : 'home'); p.back = 0; return; }
      return;
    }
    // no job (children, retired, looking for work): errands in the day, a walk in the evening
    if (atHome) {
      if (h > 8.5 && h < 19.5 && !p.kid && hash(p.id, Math.floor(t / 6), seed + 17) < .012) { const s = errandSpot(p, h); if (s) { p.back = p.home; go(p, s.id, 'shop'); return; } }
      if (h > 16 && h < 20.5 && hash(p.id, Math.floor(t / 6), seed + 19) < (p.kid ? .01 : .006)) stroll(p);
    } else if (t > p.until) go(p, p.home, 'home');
  }
  // an evening walk round the block
  function stroll(p) {
    const A = D(L.bmap.get(p.home)); if (!A) return;
    const E = [...net.edges.values()].filter(e => !e.ring && e.len > 30 && Math.hypot(e.cx - A.walk[0], e.cz - A.walk[1]) < 260); if (!E.length) return;
    const e = E[Math.floor(hash(p.id, Math.floor(now()), seed) * E.length)], s = e.len * (.2 + hash(p.id, 2, Math.floor(now())) * .6);
    const mid = { e, s, side: hash(p.id, 3, Math.floor(now())) < .5 ? 1 : -1 }; mid.walk = swPt(e, s, mid.side, 1.4); mid.door = mid.walk;
    const o = .5 + hash(p.id, 5, seed) * 1.6, out = walkRoute(A, mid, o), back = walkRoute(mid, A, o);
    if (out && back) startWalk(p, out.concat(back.slice(1)), p.home, 'walk');
  }
  function openNear(p, h, filter, maxD) {
    const home = L.bmap.get(p.at); if (!home) return null;
    let best = null, bd = 1e18;
    for (const b of city.buildings) {
      if (!b.biz || !filter(BIZ[b.biz.t]) || b.id === p.at) continue;
      const B = BIZ[b.biz.t]; if (!hrIn(h, B.hours[0], B.hours[1] - .5)) continue;
      const d = Math.hypot(b.x - home.x, b.z - home.z) * (.6 + hash(p.id, b.id, seed + L.dayNum()) * .9); if (d < bd && d < maxD) { bd = d; best = b; }
    }
    return best;
  }
  const errandSpot = (p, h) => openNear(p, h, B => B.spend > 0 && !B.svc, 2500);
  const food = (p, h) => openNear(p, h, B => B.food, 420);

  // businesses earn while their staff are in
  function earn(dt) {
    const h = L.hour(), dh = dt / DAY * 24;
    for (const b of city.buildings) {
      if (!b.biz) continue; const B = BIZ[b.biz.t];
      let here = 0; for (const id of b.biz.staff) { const p = L.people.get(id); if (p && p.state === 'in' && p.at === b.id) here++; }
      b.biz.here = here;
      if (!B.rate || !hrIn(h, B.hours[0], B.hours[1]) || !b.jobs) continue;
      addCash(b, B.rate * lvlMul(b.biz.lvl) * (here / b.jobs) * dh);
    }
  }
  L.step = function (dt) {
    // every person gets a look every couple of seconds
    const ids = L.ids || (L.ids = [...L.people.keys()]);
    if (L.idsVer !== L.ver) { L.ids = [...L.people.keys()]; L.idsVer = L.ver; }
    const n = L.ids.length, k = Math.max(1, Math.ceil(n * dt / 2));
    for (let i = 0; i < k && n; i++) { const p = L.people.get(L.ids[L.sliceI++ % n]); if (p) decide(p); }
    // walkers move on
    for (let i = L.walkers.length - 1; i >= 0; i--) {
      const w = L.walkers[i]; w.s += w.v * dt; w.ph += dt * w.v * 4.4;
      if (w.s >= w.len) { L.walkers.splice(i, 1); if (!w.ghost) { const p = L.person(w.pid); if (p && p.walk === w) arrive(p, L.bmap.has(w.to) ? w.to : p.home, w.why); } }
    }
    guests(dt);
    L.hireT += dt; if (L.hireT > 3) { L.hireT = 0; hire(); }
    L.earnT += dt; if (L.earnT >= 1) { earn(L.earnT); L.earnT = 0; }
    // midnight: the day's books
    const d = L.dayNum(); if (d !== L.dayN) { const was = L.dayN; L.dayN = d; if (was >= 0 && L.started) L.events.push({ k: 'day', day: was + 1, sum: settle() }); L.started = true; }
  };
  function settle() {
    let tax = 0, upkeep = 0;
    for (const b of city.buildings) { if (b.res) tax += b.res * (b.kind === 'house' ? 5 : 3.5); if (b.biz && BIZ[b.biz.t].upkeep) upkeep += BIZ[b.biz.t].upkeep * (1 + (b.biz.lvl - 1) * .35); }
    tax = Math.round(tax); upkeep = Math.round(upkeep);
    L.coins += tax - upkeep; L.day.tax += tax; L.day.upkeep += upkeep;
    const sum = { ...L.day, people: L.people.size, net: Math.round(L.day.biz + L.day.tax + L.day.fines - L.day.upkeep - L.day.spent) };
    L.day = newDay();
    return sum;
  }
  // where someone is and what they're doing, in words
  L.doing = function (p) {
    if (p.guest) return p.state === 'drive' ? (p.why === 'through' ? 'Passing through town' : p.why === 'leave' ? 'Leaving town' : 'Driving to ' + ((p.dest && p.dest.biz && p.dest.biz.name) || 'town')) : p.state === 'walk' ? 'Walking in to ' + ((L.bmap.get(p.walk && p.walk.to) || {}).biz || {}).name : 'Shopping at ' + ((L.bmap.get(p.at) || {}).biz || {}).name;
    const nm = id => { const b = L.bmap.get(id); return b ? (b.biz ? b.biz.name : id === p.home ? 'home' : 'a friend\'s place') : 'somewhere'; };
    if (p.state === 'drive') return p.why === 'work' ? 'Driving to work' : p.why === 'home' ? 'Driving home' : p.why === 'lunch' ? 'Driving to lunch' : 'Driving to ' + nm(p.dest);
    if (p.state === 'walk') return p.why === 'walk' ? 'Out for a walk' : p.why === 'work' ? 'Walking to work' : p.why === 'home' ? 'Walking home' : p.why === 'lunch' ? 'Walking to lunch at ' + nm(p.walk && p.walk.to) : 'Walking to ' + nm(p.walk && p.walk.to);
    if (p.state === 'wait') return p.blocked ? 'Can\'t get there: no road' : 'Heading out';
    if (p.blocked) return 'Stuck: no road to get there';
    if (p.at === p.home) return 'At home';
    if (p.at === p.work) return p.late ? 'At work (late in)' : 'At work';
    const b = L.bmap.get(p.at); return b && b.biz ? (p.why === 'lunch' ? 'Lunch at ' : 'Shopping at ') + b.biz.name : 'Visiting';
  };
  // ---------- streets and addresses ----------
  L.streetName = function (e) {
    if (!e) return '';
    const A = e.pts[0], B = e.pts[e.pts.length - 1], g0 = -BLOCK * 1.5;
    if (Math.abs(A[1] - B[1]) < 1 && Math.abs(e.cz - A[1]) < 1) { const k = Math.round((A[1] - g0) / BLOCK); if (Math.abs((A[1] - g0) / BLOCK - k) < .02) return EW[((k + 2) % EW.length + EW.length) % EW.length]; }
    if (Math.abs(A[0] - B[0]) < 1 && Math.abs(e.cx - A[0]) < 1) { const k = Math.round((A[0] - g0) / BLOCK); if (Math.abs((A[0] - g0) / BLOCK - k) < .02) return NS[((k - 1) % NS.length + NS.length) % NS.length]; }
    return BENT[Math.floor(hash(Math.round(e.cx), Math.round(e.cz), 5) * BENT.length)];
  };
  L.address = function (b) {
    const d = L.door(b); if (!d) return '';
    const q = along(d.e.pts, d.e.cum, d.s), n = Math.round((Math.abs(q[0]) + Math.abs(q[1])) / 5) * 2 + 100 + (d.side > 0 ? 1 : 0);
    return n + ' ' + L.streetName(d.e);
  };
  // ---------- spending ----------
  L.can = c => L.coins >= c;
  L.spend = c => { if (L.coins < c) return false; L.coins -= c; L.day.spent += c; return true; };
  L.fine = (k, amt = FINE[k]) => { L.coins += amt; L.day.fines += amt; };
  L.upgrade = function (b) {
    if (!b || !b.biz || b.biz.lvl >= MAX_LVL) return false;
    const c = upCost(b.biz.t, b.biz.lvl); if (!L.spend(c)) return false;
    b.biz.lvl++; const B = BIZ[b.biz.t]; b.jobs = B.jobs[b.biz.lvl - 1];
    if (B.grow) b.h = +(b.h + B.grow).toFixed(1);
    if (b.biz.lvl >= 3 && b.biz.cash) { L.collect(b); }
    city.ver++; L.ver++; return true;
  };
  L.feedPush = (k, txt, at) => { L.feed.unshift({ k, txt, at, t: now() }); if (L.feed.length > 30) L.feed.length = 30; };

  // ---------- goals: one at a time, a reward for each ----------
  const has = t => city.buildings.some(b => b.biz && b.biz.t === t);
  L.GOALS = [
    { txt: 'Collect from a business', test: () => L.stat.collected >= 1, pay: 150 },
    { txt: 'Upgrade a business', test: () => city.buildings.some(b => b.biz && b.biz.lvl >= 2), pay: 300 },
    { txt: 'Build a road', test: () => L.stat.roads >= 1, pay: 200 },
    { txt: 'Open a new business', test: () => L.stat.built >= 1, pay: 400 },
    { txt: 'Reach 40 people', test: () => L.people.size >= 40, pay: 500 },
    { txt: 'Build a police station', test: () => has('police'), pay: 900 },
    { txt: 'Put up traffic lights', test: () => [...net.nodes.values()].some(n => n.sig), pay: 300 },
    { txt: 'Get a business to level 3', test: () => city.buildings.some(b => b.biz && b.biz.lvl >= 3), pay: 700 },
    { txt: 'Reach 90 people', test: () => L.people.size >= 90, pay: 1000 },
    { txt: 'Build a fire station', test: () => has('fire'), pay: 1200 },
    { txt: 'Buy more land', test: () => L.bought >= 1, pay: 1500 },
    { txt: 'Build a hospital', test: () => has('hospital'), pay: 1800 },
    { txt: 'Reach 200 people', test: () => L.people.size >= 200, pay: 2500 },
    { txt: 'Open a supermarket', test: () => has('market'), pay: 3000 },
  ];
  L.stat = { collected: 0, roads: 0, built: 0 };
  L.goal = () => L.goalI < L.GOALS.length ? L.GOALS[L.goalI] : { txt: 'Reach ' + (Math.ceil((L.people.size + 1) / 250) * 250) + ' people', test: () => false, pay: 0, open: true };
  L.checkGoal = function () { const g = L.goal(); if (!g.open && g.test()) { L.coins += g.pay; L.goalI++; L.events.push({ k: 'goal', txt: g.txt, pay: g.pay }); return g; } return null; };

  // ---------- saving ----------
  L.serialize = () => ({ coins: Math.round(L.coins), goalI: L.goalI, bought: L.bought, stat: L.stat, day: L.day, dayN: L.dayN,
    jobs: city.buildings.filter(b => b.biz).map(b => [b.id, b.biz.staff]) });
  L.load = function (d) {
    L.coins = d.coins; L.goalI = d.goalI || 0; L.bought = d.bought || 0; L.stat = Object.assign(L.stat, d.stat || {}); if (d.day) L.day = Object.assign(newDay(), d.day);
    for (const [bid, staff] of d.jobs || []) { const b = city.buildings.find(o => o.id === bid); if (b && b.biz) b.biz.staff = staff; }
    L.sync();
    for (const b of city.buildings) if (b.biz) for (const id of b.biz.staff) { const p = L.people.get(id); if (p) p.work = b.id; }
    L.placeAll();
  };
  // after loading: everyone where their day says they'd be
  L.placeAll = function () {
    const h = L.hour();
    for (const p of L.people.values()) { const sh = p.work && L.shift(p); p.state = 'in'; p.walk = p.car = null; p.at = sh && hrIn(h, sh[0], sh[1] - .3) ? p.work : p.home; if (p.at === p.work) p.workDay = L.dayNum(); }
    L.walkers.length = 0;
  };
  // open a business (or a service) at a spot on a street
  L.place = function (t, e, sAt, sg) {
    const B = BIZ[t]; const b = city.build(e, sAt, sg, B.kind, B.fw, B.fd, B.h, { biz: L.newBiz(t) });
    if (b) { L.sync(); b.biz.name = bizName(b); }
    return b;
  };
  // a new game: the crossroads village, its first shops (on Main Street) and its first families
  L.startTown = function () {
    const shop = t => (e, s, sg) => L.place(t, e, s, sg);
    city.startTown([[shop('diner'), 1, 1, .28], [shop('gas'), 0, -1, .55], [shop('salon'), 1, 1, .78], [shop('hardware'), 2, -1, .45], [shop('auto'), 1, -1, .55]]);
    L.sync(); hire(); L.placeAll(); L.coins = 1500;
  };
  L.newBiz = (t, R = Math.random) => ({ t, name: '', lvl: 1, cash: 0, staff: [], here: 0, auto: 0, r: R() });
  return L;
}
