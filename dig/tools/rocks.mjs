// Builds assets/rocks.bin from Poly Haven (CC0) scanned rocks: each picked rock is simplified to a phone-sized
// mesh (the photo and bump map carry the fine detail), centred, stood on y = 0 and scaled to a horizontal radius of 1.
//   cd somewhere && npm install meshoptimizer
//   node tools/rocks.mjs <folder with rock_moss_set_02(_1k).gltf + .bin> <out.bin> <triangles per rock> [mesh indices...]
// Layout of the .bin (little-endian): Uint32 count, then per rock Uint32 vertexCount, indexCount; then per rock
// Float32 position xyz, Float32 normal xyz, Float32 uv, Uint16 indices (padded to 4 bytes).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(path.resolve(process.env.MESHOPT_DIR || '.') + '/');
const { MeshoptSimplifier } = require('meshoptimizer');

const [dir, out, triArg, ...pick] = process.argv.slice(2);
const name = path.basename(path.resolve(dir));
const gf = [name + '_1k.gltf', name + '.gltf'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
const gl = JSON.parse(fs.readFileSync(gf, 'utf8'));
const bin = fs.readFileSync(path.join(dir, gl.buffers[0].uri));
const tris = +triArg || 1000;
const N = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3 };
function acc(i) {
  const a = gl.accessors[i], v = gl.bufferViews[a.bufferView], T = N[a.componentType], n = a.count * SIZE[a.type];
  const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from(new T(bin.buffer.slice(off, off + n * T.BYTES_PER_ELEMENT)));
}

await MeshoptSimplifier.ready;
const meshes = (pick.length ? pick.map(Number) : gl.meshes.map((_, i) => i));
const rocks = meshes.map(mi => {
  const node = gl.nodes.find(n => n.mesh === mi), s = node.scale ? node.scale[0] : 1;
  const p = gl.meshes[mi].primitives[0];
  const pos = acc(p.attributes.POSITION).map(v => v * s), nor = acc(p.attributes.NORMAL), uv = acc(p.attributes.TEXCOORD_0);
  const idx = new Uint32Array(acc(p.indices));
  const [sim] = MeshoptSimplifier.simplifyWithAttributes(idx, new Float32Array(pos), 3, new Float32Array(uv), 2, [.5, .5], null, tris * 3, .05, []);
  // keep only the vertices still used
  const map = new Map(), P = [], Nn = [], U = [], I = [];
  for (const v of sim) {
    if (!map.has(v)) { map.set(v, map.size); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); Nn.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); U.push(uv[v * 2], uv[v * 2 + 1]); }
    I.push(map.get(v));
  }
  // centre on the footprint, base on y = 0 (a low percentile, so a stray low vertex doesn't float it), radius 1
  const n = P.length / 3, ys = [];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); ys.push(P[i * 3 + 1]); }
  ys.sort((a, b) => a - b);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, base = ys[Math.floor(n * .03)];
  let r = 0; for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz));
  for (let i = 0; i < n; i++) { P[i * 3] = (P[i * 3] - cx) / r; P[i * 3 + 1] = (P[i * 3 + 1] - base) / r; P[i * 3 + 2] = (P[i * 3 + 2] - cz) / r; }
  console.log(gl.meshes[mi].name, 'tris', idx.length / 3, '->', I.length / 3, 'verts', n, 'height/radius', (ys[n - 1] - base) / r);
  return { P, Nn, U, I };
});

const head = [rocks.length, ...rocks.flatMap(r => [r.P.length / 3, r.I.length])];
const parts = [Buffer.from(new Uint32Array(head).buffer)];
for (const r of rocks) {
  parts.push(Buffer.from(new Float32Array(r.P).buffer), Buffer.from(new Float32Array(r.Nn).buffer), Buffer.from(new Float32Array(r.U).buffer));
  const ib = Buffer.from(new Uint16Array(r.I).buffer); parts.push(ib);
  if (ib.length % 4) parts.push(Buffer.alloc(4 - ib.length % 4));
}
fs.writeFileSync(out, Buffer.concat(parts));
console.log('wrote', out, Buffer.concat(parts).length, 'bytes');
