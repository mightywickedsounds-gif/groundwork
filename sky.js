// The sky: a dome that follows the time of day (blue day, warm sunrise and sunset, moonlit night with stars),
// drifting clouds, the sun and the moon. It also lights the scene: reflections come from the same sky.
import * as THREE from 'three';

const vert = `varying vec3 vDir;
void main() { vDir = normalize((modelMatrix * vec4(position, 0.)).xyz); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`;

// colours are linear (tone mapping happens after)
const frag = `uniform vec3 uSun; uniform vec3 uMoon; uniform float uNight; uniform float uTime; uniform float uCloud; uniform float uEnv;
varying vec3 vDir;
float h3(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
vec3 skyCol(vec3 d) {
  float y = max(d.y, 0.), sy = uSun.y;
  float day = smoothstep(-.12, .25, sy);                       // 0 night .. 1 full day
  float low = (1. - smoothstep(.0, .32, sy)) * smoothstep(-.22, .02, sy);   // sun near the horizon
  vec3 zen = mix(vec3(.018, .03, .075), vec3(.11, .27, .62), day);
  vec3 hor = mix(vec3(.07, .1, .19), vec3(.56, .67, .8), day);
  float sd = max(dot(normalize(vec3(d.x, 0., d.z)), normalize(vec3(uSun.x, 0., uSun.z))), 0.);
  // sunrise / sunset: warm band on the sun's side, pink/violet above it
  hor = mix(hor, vec3(1., .42, .16) * (.55 + .45 * sd * sd), low * (.35 + .65 * sd));
  zen = mix(zen, vec3(.16, .17, .36), low * .55);
  vec3 c = mix(hor, zen, pow(y, .55));
  c = mix(c, vec3(.85, .5, .55) * .6, low * smoothstep(.05, .3, y) * (1. - smoothstep(.3, .7, y)) * .35 * sd);
  // glow round the sun
  float cs = max(dot(d, uSun), 0.);
  c += vec3(1., .78, .5) * (pow(cs, 9.) * .25 + pow(cs, 90.) * .6) * (.25 + .75 * day) * smoothstep(-.15, .0, sy);
  // below the horizon: fade to a hazy ground colour (hidden by the land anyway)
  c = mix(c, hor * .8, smoothstep(.0, -.08, d.y));
  return c;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyCol(d);
  float sy = uSun.y, day = smoothstep(-.12, .25, sy), low = (1. - smoothstep(.0, .32, sy)) * smoothstep(-.22, .02, sy);
  if (uEnv < .5) {
    // stars and moon at night
    if (uNight > .01 && d.y > 0.) {
      vec3 q = d * 260.; vec3 id = floor(q); float h = h3(id);
      float st = step(.9965, h) * smoothstep(.45, .0, length(fract(q) - .5)) * (.5 + .5 * sin(uTime * (2. + h * 5.) + h * 40.));
      c += vec3(.8, .85, 1.) * st * uNight * smoothstep(.0, .25, d.y) * 1.6;
    }
    float md = dot(d, uMoon);
    c += vec3(.9, .93, 1.) * smoothstep(.99945, .99965, md) * uNight * 2.2 + vec3(.25, .3, .45) * pow(max(md, 0.), 60.) * uNight * .5;
    // the sun itself
    c += vec3(1., .9, .75) * smoothstep(.99955, .9998, dot(d, uSun)) * 14. * smoothstep(-.05, .02, sy);
  }
  // clouds: a drifting layer, lit by the sun (warm at sunset, dim blue at night)
  if (d.y > .0) {
    vec2 p = d.xz / (d.y + .08) * 1.6 + vec2(uTime * .006, uTime * .002);
    float n = fbm(p) * .65 + fbm(p * 2.7 + 4.) * .35;
    float cov = smoothstep(.62 - uCloud * .25, .9 - uCloud * .2, n) * smoothstep(.02, .22, d.y);
    vec3 lit = mix(vec3(.08, .1, .16), vec3(1., .98, .95), day);
    lit = mix(lit, vec3(1., .6, .38), low);
    float shade = smoothstep(.55, .95, n);
    vec3 cc = lit * (1. - shade * .38) + vec3(1., .8, .6) * pow(max(dot(d, uSun), 0.), 8.) * .4 * day;
    c = mix(c, cc, cov * .9);
  }
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSky(renderer) {
  const U = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: .5 }, uEnv: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat); mesh.frustumCulled = false; mesh.renderOrder = -10;
  // the environment (reflections, soft light) is the same sky, rendered without the sun disc and stars
  const envU = { ...U, uEnv: { value: 1 } };
  const envMat = new THREE.ShaderMaterial({ uniforms: envU, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
  const envScene = new THREE.Scene(); const envMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat); envScene.add(envMesh);
  // a darker ground half for the environment, so reflections aren't lit from below
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x3a3a30, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(100, 24).rotateX(-Math.PI / 2).translate(0, -2, 0), floorMat); envScene.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, lastKey = '', lastT = -1e9;
  const tmp = new THREE.Color();
  const sky = {
    mesh, U,
    // sun and moon directions (unit vectors), night 0..1, seconds for drifting clouds
    update(sunDir, moonDir, night, t, camPos, far) {
      U.uSun.value.copy(sunDir); U.uMoon.value.copy(moonDir); U.uNight.value = night; U.uTime.value = t;
      mesh.position.copy(camPos); mesh.scale.setScalar(far * .9);
    },
    // colour of the sky at the horizon in a direction (for fog), linear
    horizon(dirX, dirZ, out) {
      const s = U.uSun.value, sy = s.y, sm = t => Math.max(0, Math.min(1, t)), ss = (a, b, x) => { const t = sm((x - a) / (b - a)); return t * t * (3 - 2 * t); };
      const day = ss(-.12, .25, sy), low = (1 - ss(0, .32, sy)) * ss(-.22, .02, sy);
      const L = Math.hypot(dirX, dirZ) || 1, Ls = Math.hypot(s.x, s.z) || 1, sd = Math.max(0, (dirX * s.x + dirZ * s.z) / L / Ls);
      out.setRGB(.07 + (.56 - .07) * day, .1 + (.67 - .1) * day, .19 + (.8 - .19) * day);
      const k = low * (.35 + .65 * sd), w = .55 + .45 * sd * sd;
      out.r += (1 * w - out.r) * k; out.g += (.42 * w - out.g) * k; out.b += (.16 * w - out.b) * k;
      return out;
    },
    // re-render the environment light when the sky has changed enough
    env(scene, force) {
      const s = U.uSun.value, key = [s.x, s.y, s.z].map(v => Math.round(v * 10)).join() + ':' + Math.round(U.uNight.value * 8), now = performance.now();
      if (!force && (key === lastKey || now - lastT < 2500)) return; lastKey = key; lastT = now;   // at most every few seconds (it costs a few ms)
      floorMat.color.copy(sky.horizon(1, 0, tmp)).multiplyScalar(.35);
      const rt = pmrem.fromScene(envScene, 0, .1, 300);
      scene.environment = rt.texture; if (envRT) envRT.dispose(); envRT = rt;
    },
  };
  return sky;
}
