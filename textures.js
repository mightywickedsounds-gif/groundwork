// Textures for Groundwork, all drawn by code when the game starts (no image downloads):
// grass, dirt, gravel, rock, bark, needles, water ripples, clouds, smoke puffs, hazard stripes.
import * as THREE from 'three';

function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// value noise that tiles seamlessly, 0..1
export function tileNoise(size, cells, seed, oct = 4, gain = .5) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const c = cells << o, sc = c / size, sd = seed + o * 31;
    for (let y = 0; y < size; y++) {
      const fy = y * sc, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = y0 % c, yb = (y0 + 1) % c;
      for (let x = 0; x < size; x++) {
        const fx = x * sc, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % c, xb = (x0 + 1) % c;
        const a = hash2(xa, ya, sd), b = hash2(xb, ya, sd), cc = hash2(xa, yb, sd), d = hash2(xb, yb, sd);
        out[y * size + x] += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy);
      }
    }
    tot += amp; amp *= gain;
  }
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < out.length; i++) { out[i] /= tot; if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn || 1);
  return out;
}
function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mix = (a, b, t) => a + (b - a) * t;
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function paintNoise(g, size, fn) {
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) { const [r, gg, b] = fn(i); d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
}
// draw something that may cross the edge of a tiling texture: draw it again on the far side
function wrap(size, x, y, r, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    const xx = x + dx, yy = y + dy;
    if (xx > -r && xx < size + r && yy > -r && yy < size + r) fn(xx, yy);
  }
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function lumOf(g, size) {
  const d = g.getImageData(0, 0, size, size).data, out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255;
  return out;
}
function dataTex(arr, size, srgb = false) {
  const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

function grass(S) {
  const [c, g] = canvas(S), r = rng(11);
  const n = tileNoise(S, 4, 11, 5), n2 = tileNoise(S, 24, 12, 2);
  paintNoise(g, S, i => {
    const t = n[i] * .7 + n2[i] * .3, dry = Math.max(0, .38 - n[i]) * 1.6;
    return [mix(mix(38, 92, t), 120, dry), mix(mix(58, 104, t), 108, dry), mix(mix(20, 38, t), 52, dry)];
  });
  for (let i = 0; i < 16000; i++) {
    const x = r() * S, y = r() * S, len = 3 + r() * 8, a = r() * Math.PI * 2, k = r();
    const col = k < .15 ? `rgba(${140 + r() * 40 | 0},${140 + r() * 30 | 0},${70 + r() * 20 | 0},.8)`
      : `rgba(${30 + k * 70 | 0},${60 + k * 75 | 0},${14 + k * 30 | 0},.85)`;
    g.strokeStyle = col; g.lineWidth = .8 + r() * 1.1;
    wrap(S, x, y, 10, (xx, yy) => { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(a) * len, yy + Math.sin(a) * len); g.stroke(); });
  }
  return [c, g];
}
function dirt(S) {
  const [c, g] = canvas(S), r = rng(21);
  const n = tileNoise(S, 3, 21, 5), n2 = tileNoise(S, 32, 22, 2);
  paintNoise(g, S, i => { const t = n[i] * .75 + n2[i] * .25; return [mix(78, 132, t), mix(54, 92, t), mix(34, 60, t)]; });
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, rad = 1.5 + r() * 6, l = .7 + r() * .6;
    wrap(S, x, y, rad, (xx, yy) => {
      const gr = g.createRadialGradient(xx - rad * .3, yy - rad * .3, rad * .1, xx, yy, rad);
      gr.addColorStop(0, `rgba(${150 * l | 0},${108 * l | 0},${72 * l | 0},.9)`);
      gr.addColorStop(.7, `rgba(${92 * l | 0},${62 * l | 0},${40 * l | 0},.8)`);
      gr.addColorStop(1, 'rgba(40,26,16,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(xx, yy, rad, 0, Math.PI * 2); g.fill();
    });
  }
  for (let i = 0; i < 1400; i++) {
    const x = r() * S, y = r() * S, rad = .8 + r() * 1.8, v = 90 + r() * 80 | 0;
    wrap(S, x, y, rad, (xx, yy) => { g.fillStyle = `rgb(${v},${v * .9 | 0},${v * .8 | 0})`; g.beginPath(); g.arc(xx, yy, rad, 0, Math.PI * 2); g.fill(); });
  }
  return [c, g];
}
function gravel(S) {
  const [c, g] = canvas(S), r = rng(31);
  paintNoise(g, S, () => [62, 60, 56]);
  for (let i = 0; i < 7000; i++) {
    const x = r() * S, y = r() * S, rx = 2 + r() * 4.5, ry = rx * (.6 + r() * .4), a = r() * Math.PI;
    const v = 105 + r() * 95, tint = (r() - .5) * 18;
    wrap(S, x, y, rx + 2, (xx, yy) => {
      g.fillStyle = 'rgba(20,18,16,.55)'; g.beginPath(); g.ellipse(xx + 1.2, yy + 1.4, rx, ry, a, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgb(${v + tint | 0},${v | 0},${v - tint | 0})`; g.beginPath(); g.ellipse(xx, yy, rx, ry, a, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,250,.22)'; g.beginPath(); g.ellipse(xx - rx * .25, yy - ry * .3, rx * .5, ry * .45, a, 0, Math.PI * 2); g.fill();
    });
  }
  return [c, g];
}
function rock(S) {
  const [c, g] = canvas(S), r = rng(41);
  const n = tileNoise(S, 4, 41, 6), n2 = tileNoise(S, 16, 42, 3);
  paintNoise(g, S, i => { const t = n[i] * .6 + n2[i] * .4; const v = mix(78, 150, t); return [v, v * .98, v * .94]; });
  for (let i = 0; i < 70; i++) {
    let x = r() * S, y = r() * S; g.strokeStyle = 'rgba(30,28,26,.6)'; g.lineWidth = .6 + r(); g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - .5) * 26; y += (r() - .5) * 26; g.lineTo(x, y); } g.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 1 + r() * 5;
    g.fillStyle = r() < .5 ? `rgba(150,160,90,${.3 + r() * .4})` : `rgba(200,195,170,${.25 + r() * .3})`;
    wrap(S, x, y, rad, (xx, yy) => { g.beginPath(); g.arc(xx, yy, rad, 0, Math.PI * 2); g.fill(); });
  }
  return [c, g];
}
function bark(S) {
  const [c, g] = canvas(S), r = rng(51), n = tileNoise(S, 4, 51, 4);
  paintNoise(g, S, i => { const t = n[i]; return [mix(58, 98, t), mix(40, 70, t), mix(28, 48, t)]; });
  for (let i = 0; i < 260; i++) {
    const x = r() * S, w = .8 + r() * 2.2; g.strokeStyle = `rgba(28,18,12,${.4 + r() * .4})`; g.lineWidth = w;
    g.beginPath(); let xx = x; g.moveTo(xx, 0); for (let y = 0; y <= S; y += 16) { xx += (r() - .5) * 4; g.lineTo(xx, y); } g.stroke();
  }
  return [c, g];
}
function needles(S) {
  const [c, g] = canvas(S), r = rng(61), n = tileNoise(S, 4, 61, 4);
  paintNoise(g, S, i => { const t = n[i]; return [mix(150, 230, t), mix(170, 240, t), mix(140, 200, t)]; });
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI * 2, len = 2 + r() * 5, v = r();
    g.strokeStyle = v < .5 ? 'rgba(70,90,60,.6)' : 'rgba(250,255,235,.55)'; g.lineWidth = .7;
    wrap(S, x, y, 8, (xx, yy) => { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(a) * len, yy + Math.sin(a) * len); g.stroke(); });
  }
  return [c, g];
}
function heightsFrom(lums, S) {
  const arr = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { arr[i * 4] = lums[0][i] * 255; arr[i * 4 + 1] = lums[1][i] * 255; arr[i * 4 + 2] = lums[2][i] * 255; arr[i * 4 + 3] = 255; }
  return dataTex(arr, S);
}
function normalTex(S, cells, seed, strength) {
  const h = tileNoise(S, cells, seed, 5, .55), f = tileNoise(S, cells * 2, seed + 9, 3);
  const arr = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S];
    const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    let nx = -dx * strength, ny = -dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    arr[i * 4] = (nx * .5 + .5) * 255; arr[i * 4 + 1] = (ny * .5 + .5) * 255; arr[i * 4 + 2] = (nz * .5 + .5) * 255; arr[i * 4 + 3] = f[i] * 255;
  }
  return dataTex(arr, S);
}
function grey(S, cells, seed, oct) {
  const n = tileNoise(S, cells, seed, oct), arr = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { const v = n[i] * 255; arr[i * 4] = arr[i * 4 + 1] = arr[i * 4 + 2] = v; arr[i * 4 + 3] = 255; }
  return dataTex(arr, S);
}
function clouds(S) {
  const n = tileNoise(S, 3, 71, 6, .55), arr = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const a = Math.min(1, Math.max(0, (n[i] - .5) / .3));
    arr[i * 4] = 255; arr[i * 4 + 1] = 255; arr[i * 4 + 2] = 255; arr[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
  }
  return dataTex(arr, S, true);
}
function puff(S) {
  const n = tileNoise(S, 4, 81, 4), arr = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, d = Math.hypot(x - S / 2 + .5, y - S / 2 + .5) / (S / 2);
    const a = Math.max(0, 1 - d) ** 1.4 * (.55 + n[i] * .7);
    arr[i * 4] = arr[i * 4 + 1] = arr[i * 4 + 2] = 255; arr[i * 4 + 3] = Math.min(255, a * 255);
  }
  const t = new THREE.DataTexture(arr, S, S, THREE.RGBAFormat); t.needsUpdate = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
function stripes() {
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#e8b320'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#1b1b1b';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); }
  return canvasTex(c);
}
export function labelTexture(text) {
  const [c, g] = canvas(256, 64);
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 44px "Arial Black", Arial, sans-serif'; g.fillStyle = '#1d1d1d'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function makeTextures(quality) {
  const S = quality === 'low' ? 256 : 512;
  const [gc, gg] = grass(S), [dc, dg] = dirt(S), [rc, rg] = gravel(S);
  const T = {
    grass: canvasTex(gc), dirt: canvasTex(dc), gravel: canvasTex(rc),
    heights: heightsFrom([lumOf(gg, S), lumOf(dg, S), lumOf(rg, S)], S),
    macro: grey(256, 4, 91, 5),
    rock: canvasTex(rock(256)[0]), bark: canvasTex(bark(128)[0]), needles: canvasTex(needles(256)[0]),
    water: normalTex(256, 8, 101, 9),
    clouds: clouds(512), puff: puff(64), stripes: stripes(),
  };
  return T;
}
