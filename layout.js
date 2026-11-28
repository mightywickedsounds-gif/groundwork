// A new town's street plan (plan 2), the way Hill Country towns grew. No three.js (runs in Node).
// - the highway winds in across the ranch land and runs straight for a few blocks through the old town as Main Street
// - a ranch road crosses it there and wanders off north and south
// - main roads run round each square of land you can buy, but they bow, their corners are shifted (so they meet at
//   odd angles), and now and then one is just a two-lane street
// - inside each square: a neighbourhood of curving streets laid over the square's own bent outline: a winding
//   collector with side streets and cul-de-sacs, a loop, or a collector with a crescent off it
// Everything comes from hashes of the seed and the square, never from random draws: the same town every time, and
// two neighbouring squares always agree where their streets meet on the line between them.
// Roads come out as control polygons: { poly, o (road options), name, quad (one curve a -> b bent by poly[1]), loop }
export const S = 300, G0 = -150;            // a square of land (a district) and where the grid of squares starts
export const REACH = 1250;                  // the highway and the ranch road run this far out (past the last land)
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const qpt = (a, c, b, t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ART = { kind: 'avenue', nl: 2, tl: 1 }, RANCH = { kind: 'avenue', nl: 1, tl: 0 }, ST = { kind: 'street' };
const LANES = ['Live Oak Dr', 'Cypress Creek Rd', 'Bluebonnet Ln', 'Mesquite Trl', 'Limestone Way', 'Prairie Loop', 'Canyon Dr', 'Hilltop Rd', 'Bluff View Dr',
  'Arroyo Dr', 'Sunset Loop', 'Quarry Rd', 'Pasture Ln', 'Bridle Path', 'Windmill Dr', 'Agarita Ct', 'Yaupon Ct', 'Redbud Ln', 'Madrone Dr', 'Pecan Hollow',
  'Deer Run', 'Cedar Ridge', 'Spring Creek Dr', 'Fossil Rim Rd', 'Sotol Ct', 'Hackberry Ln', 'Juniper Ct', 'Persimmon Pl', 'Caliche Rd', 'Big Sky Dr'];
const AVES = ['Oak Ridge Pkwy', 'Hill Country Blvd', 'Mustang Rd', 'Old Mill Rd', 'Schoolhouse Rd', 'Lakeview Pkwy', 'Comanche Trl', 'Ranch View Blvd', 'Creekside Pkwy', 'Settlers Way'];

// a smooth road through a control polygon: quadratic pieces between the midpoints of its sides (it starts and ends at
// the polygon's ends and runs tangent to its sides there). -> [[a, c, b], ...]
export function pieces(poly, loop = false) {
  const P = poly, n = P.length, out = [];
  if (loop) { for (let i = 0; i < n; i++) out.push([lerp(P[(i - 1 + n) % n], P[i], .5), P[i], lerp(P[i], P[(i + 1) % n], .5)]); return out; }
  if (n === 2) return [[P[0], lerp(P[0], P[1], .5), P[1]]];
  let a = P[0];
  for (let i = 1; i < n - 1; i++) { const b = i < n - 2 ? lerp(P[i], P[i + 1], .5) : P[n - 1]; out.push([a, P[i], b]); a = b; }
  return out;
}
// points along a road's pieces, every ~step metres
export function sample(pcs, step = 4) {
  const out = [];
  for (const [a, c, b] of pcs) { const L = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]), M = Math.max(2, Math.ceil(L / step)); for (let i = out.length ? 1 : 0; i <= M; i++) out.push(qpt(a, c, b, i / M)); }
  return out;
}

export function makePlan(seed) {
  const H = (a, b, c) => hash(a, b, seed * 7 + c);
  // ---- the highway (Main Street in town) ----
  const A = [-150, -60 + (H(1, 1, 1) - .5) * 16], B = [150, -40 + (H(1, 2, 1) - .5) * 16];   // Main Street: straight, at a slight angle
  const d = (() => { const L = Math.hypot(B[0] - A[0], B[1] - A[1]); return [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; })();
  const hz = k => -50 + (H(k, 3, 2) - .5) * 80;   // out of town it wanders 40 m either way
  const highway = [
    { poly: [A, B], o: ART, name: 'Main St' },
    { poly: [B, [B[0] + d[0] * 110, B[1] + d[1] * 110], [440, hz(1)], [720, hz(2)], [1000, hz(3)], [REACH, hz(4)]], o: ART, name: 'Hwy 9' },
    { poly: [A, [A[0] - d[0] * 110, A[1] - d[1] * 110], [-440, hz(5)], [-720, hz(6)], [-1000, hz(7)], [-REACH, hz(8)]], o: ART, name: 'Hwy 9' },
  ];
  const mainAt = x => lerp(A, B, (x - A[0]) / (B[0] - A[0]));   // a point on Main Street
  // ---- the ranch road: crosses Main Street at a slant in the west of the old town ----
  const X0 = mainAt(-48 + (H(2, 1, 3) - .5) * 10), sk = (78 + H(2, 2, 3) * 8) * Math.PI / 180;   // meets Main Street at 78-86 degrees
  const dn = [d[0] * Math.cos(sk) + d[1] * Math.sin(sk), -d[0] * Math.sin(sk) + d[1] * Math.cos(sk)];   // (heading north out of it)
  const rx = k => (H(k, 4, 4) - .5) * 100;   // wanders 50 m either side of x = 0
  const ranch = [
    { poly: [X0, [X0[0] + dn[0] * 90, X0[1] + dn[1] * 90], [rx(1), -380], [rx(2), -660], [rx(3), -950], [rx(4) * .5, -REACH]], o: RANCH, name: 'Ranch Rd 1940' },
    { poly: [X0, [X0[0] - dn[0] * 90, X0[1] - dn[1] * 90], [rx(5), 380], [rx(6), 660], [rx(7), 950], [rx(8) * .5, REACH]], o: RANCH, name: 'Ranch Rd 1940' },
  ];
  // ---- the old town's own streets ----
  const ranchS = sample(pieces(ranch[1].poly), 2), onRanch = z => ranchS.reduce((b, p) => Math.abs(p[1] - z) < Math.abs(b[1] - z) ? p : b, ranchS[0]);
  const M0 = mainAt(55 + (H(3, 1, 5) - .5) * 14), m2 = (95 + (H(3, 2, 5) - .5) * 10) * Math.PI / 180;
  const dm = [d[0] * Math.cos(m2) + d[1] * Math.sin(m2), -d[0] * Math.sin(m2) + d[1] * Math.cos(m2)];
  const back = onRanch(48 + H(3, 3, 5) * 10), west = onRanch(-2 + H(3, 4, 5) * 8);
  const village = [
    { poly: [M0, [M0[0] + dm[0] * 36, M0[1] + dm[1] * 36], [M0[0] + 8, -104]], o: ST, name: 'Mill St' },                         // north: a short dead end behind the shops
    { poly: [M0, [M0[0] - dm[0] * 50, M0[1] - dm[1] * 50], [M0[0] - 4, 40], [M0[0] - 50, 66], back], o: ST, name: 'Mill St' },      // south, round into the back street
    { poly: [[M0[0] - 22, 56], [M0[0] + 6, 80], [M0[0] + 44, 100]], o: ST, name: 'Pecan Ct' },                                      // a cul-de-sac off it
    { poly: [west, [west[0] - 36, west[1] + 4], [-88, 28], [-98, 52]], o: ST, name: 'Church St' },                                 // west of the ranch road
  ];
  // ---- the squares of land: their corners (moved), the main roads along their sides, where streets cross those ----
  const old = (ci, cj) => ci >= 0 && ci <= 1 && cj >= 0 && cj <= 1;   // the old town's square's corners: barely moved (its streets come close)
  const corner = (ci, cj) => {
    const near = cj === 0 || cj === 1, k = old(ci, cj) ? .3 : 1;   // (the rows either side of the highway: keep their corners off it)
    return [G0 + ci * S + (H(ci, cj, 11) - .5) * 90 * k, G0 + cj * S + (H(ci, cj, 12) - .5) * (near ? 48 : 90) * k];
  };
  // the side of a square: k 0 = along x (from corner ci,cj to ci+1,cj), 1 = along z (ci,cj to ci,cj+1)
  const side = (k, ci, cj) => {
    const a = corner(ci, cj), b = k ? corner(ci, cj + 1) : corner(ci + 1, cj), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const id = ci * 2 + k, calm = old(ci, cj) && old(k ? ci : ci + 1, k ? cj + 1 : cj) ? .3 : 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    // bowed one way (a C) or, now and then, both ways (an S, like a road round a hill)
    const b1 = (H(id, cj, 13) - .5) * 80 * calm, b2 = H(id, cj, 19) < .4 ? -b1 * (.6 + H(id, cj, 20) * .5) : b1 * (.5 + H(id, cj, 20) * .6);
    const c1 = [a[0] + (b[0] - a[0]) / 3 + n[0] * b1, a[1] + (b[1] - a[1]) / 3 + n[1] * b1], c2 = [a[0] + (b[0] - a[0]) * 2 / 3 + n[0] * b2, a[1] + (b[1] - a[1]) * 2 / 3 + n[1] * b2];
    const poly = [a, c1, c2, b], pts = sample(pieces(poly), 2), cum = [0];
    for (let m = 1; m < pts.length; m++) cum.push(cum[m - 1] + Math.hypot(pts[m][0] - pts[m - 1][0], pts[m][1] - pts[m - 1][1]));
    const at = s => { const want = Math.max(0, Math.min(1, s)) * cum[cum.length - 1]; let m = 1; while (m < cum.length - 1 && cum[m] < want) m++; const f = (want - cum[m - 1]) / ((cum[m] - cum[m - 1]) || 1); return lerp(pts[m - 1], pts[m], f); };
    // a main road here, or (now and then) just a two-lane street (the old town's own square: main roads)
    const on = H(id, cj, 14) > .3 || (ci >= 0 && ci <= 1 && cj >= 0 && cj <= 1 && (k ? cj === 0 : ci === 0));
    // where streets from either side meet it: two side streets and a main crossing in the middle
    const t = [.24 + H(id, cj, 15) * .1, .44 + H(id, cj, 16) * .12, .66 + H(id, cj, 17) * .1];
    return { a, b, poly, on, t, at, name: on ? AVES[Math.floor(H(id, cj, 18) * AVES.length)] : LANES[Math.floor(H(id, cj, 18) * LANES.length)] };
  };
  // one square: its main roads and its streets
  // try: which neighbourhood pattern (0 collector, 1 loop, 2 crescent) and which way round; by default from the hash
  function district(i, j, kindIn = null, rotIn = null) {
    const W = side(1, i, j), E = side(1, i + 1, j), N = side(0, i, j), So = side(0, i, j + 1);
    const P00 = W.a, P01 = W.b, P10 = E.a, P11 = E.b;
    // a point inside: the outline's sides blended (a Coons patch), so streets follow the bends of the main roads
    const Q = (u, v) => {
      const bot = N.at(u), top = So.at(u), lf = W.at(v), rt = E.at(v);
      const x = (1 - v) * bot[0] + v * top[0] + (1 - u) * lf[0] + u * rt[0] - ((1 - u) * (1 - v) * P00[0] + u * (1 - v) * P10[0] + (1 - u) * v * P01[0] + u * v * P11[0]);
      const z = (1 - v) * bot[1] + v * top[1] + (1 - u) * lf[1] + u * rt[1] - ((1 - u) * (1 - v) * P00[1] + u * (1 - v) * P10[1] + (1 - u) * v * P01[1] + u * v * P11[1]);
      return [x, z];
    };
    const arterials = [W, E, N, So].map(s => ({ poly: s.poly, o: s.on ? ART : ST, name: s.name, big: s.on }));
    // the neighbourhood, drawn in its own frame: U along the collector, V across it (rot: turned a quarter)
    const h = (k, c) => H(i * 53 + k, j * 29 + c, 21);
    const rot = rotIn ?? h(1, 1) < .5;
    const L = rot ? N : W, R = rot ? So : E, T = rot ? W : N, Bt = rot ? E : So;   // the sides at U = 0, U = 1, V = 0, V = 1
    const uv = p => (rot ? Q(p[1], p[0]) : Q(p[0], p[1]));
    const streets = [], nm = k => LANES[Math.floor(h(40 + k, 3) * LANES.length)];
    const add = (pts, k, extra = {}) => streets.push({ poly: pts.map(uv), o: ST, name: nm(k), ...extra });
    const kind = kindIn == null ? h(2, 2) : [.2, .6, .9][kindIn];
    const V0 = .13, V1 = .87;                                               // how far a cul-de-sac stops short of the main road
    // the collector: from the left side's middle crossing to the right side's, winding
    const cl = L.t[1], cr = R.t[1], w1 = (h(3, 1) - .5) * .2, w2 = (h(3, 2) - .5) * .2;
    const bowV = kind < .7 ? 0 : -.16;   // (with a crescent: bowed up out of its way)
    const col = [[0, cl], [.3, cl + w1 + bowV], [.7, cr + w2 + bowV], [1, cr]];
    const colAt = U => { const pcs = pieces(col), pts = sample(pcs, .01); return pts.reduce((b, p) => Math.abs(p[0] - U) < Math.abs(b[0] - U) ? p : b, pts[0]); };
    // a side street off the collector at U = u to side sd (toward V = 0 when up): through to the main road, or a cul-de-sac
    const branch = (u, sd, up, k, link = false) => {   // (link: the one that meets the next square's street, where there's no main road)
      const c = colAt(u), end = link || h(30 + k, 4) >= .55 ? (up ? 0 : 1) : (up ? V0 : V1), wig = (h(5 + k, 1) - .5) * .12;
      const ue = end === 0 || end === 1 ? u : u + wig * .6;
      add([c, [u + wig, (c[1] + end) / 2], [ue, end]], 10 + k);
    };
    if (kind < .45) {          // a winding collector, side streets off it both ways
      add(col, 0);
      branch(T.t[0], T, true, 1); branch(T.t[2], T, true, 2); branch(Bt.t[1], Bt, false, 3);
    } else if (kind < .7) {    // a loop street, joined to the main roads (or the next square) on every side
      const cx = .5 + (h(6, 1) - .5) * .08, cz = .5 + (h(6, 2) - .5) * .08, rx = .27 + h(6, 3) * .04, rz = .25 + h(6, 4) * .04, ring = [];
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + h(7, k) * .2, r = 1 + (h(8, k) - .5) * .16; ring.push([cx + Math.cos(a) * rx * r, cz + Math.sin(a) * rz * r]); }
      streets.push({ poly: ring.map(uv), o: ST, name: nm(0), loop: true });
      const toRing = (p, k) => add([p, lerp(p, [cx, cz], .3), lerp(p, [cx, cz], .62)], 20 + k, { trim: true });   // (ends where it meets the loop)
      toRing([0, L.t[1]], 1); toRing([1, R.t[1]], 2);
      if (h(9, 1) < .5) toRing([T.t[1], 0], 3);
      if (h(9, 2) < .5) toRing([Bt.t[1], 1], 4);
      add([[cx + (h(9, 3) - .5) * .1, cz + rz * .2], [cx, cz - rz * .5], [cx + (h(9, 4) - .5) * .06, cz - rz * 1.5]], 5, { trim: true });   // a cul-de-sac into the middle
    } else {                   // a collector bowed up, a crescent dipping down off it, and side streets
      add(col, 0);
      const a0 = .2 + h(10, 1) * .06, a1 = .74 + h(10, 2) * .06, ca = colAt(a0), cb = colAt(a1), dip = .8 + h(10, 3) * .05;
      add([ca, [a0 - .02, dip], [a1 + .02, dip], cb], 1, { crescent: true });
      branch(T.t[1], T, true, 2);
      if (h(10, 5) < .5) add([[Bt.t[1], 1], [Bt.t[1] + (h(10, 4) - .5) * .06, (1 + dip) / 2], [Bt.t[1], dip - .1]], 3, { trim: true });   // out to the road below
    }
    return { arterials, streets, sides: { W, E, N, S: So }, Q };
  }
  return { highway, ranch, village, district, corner, side, mainAt, A, B };
}
