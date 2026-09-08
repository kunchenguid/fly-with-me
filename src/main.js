// Fly With Me: the engine. One CPU heightfield, one horizon, one climate rule,
// the soft illustrated light, streamed rings of whatever the scenery library
// says stands here, a bird, a camera and a day. The page (index.html) holds
// the markup and the import map; the library (library/) holds every place.
import * as THREE from 'three';
import {
  WebGPURenderer,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  RenderPipeline,
} from 'three/webgpu';
import {
  Fn,
  uniform,
  textureLoad,
  positionLocal,
  positionWorld,
  normalLocal,
  cameraPosition,
  vec2,
  vec3,
  vec4,
  float,
  ivec2,
  mix,
  smoothstep,
  max,
  abs,
  sin,
  pow,
  dot,
  acos,
  normalize,
  hash,
  fog,
  densityFogFactor,
  exponentialHeightFogFactor,
  varying,
  mx_noise_float,
  select,
  clamp,
  attribute,
  fract,
  length,
  step,
  screenUV,
  saturation,
  pass,
  normalView,
  normalWorld,
  diffuseColor,
  texture,
  transformNormalToView,
  renderOutput,
  convertToTexture,
  viewportSize,
  exp,
  cross,
  sign,
  sqrt,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { hash2, perlin2, fbm, ridged, sstep, mulberry32 } from './noise.js';
import { createWaterMaterial } from './water.js';
import { createMilkyWay } from './milky-way.js';
import { SWATCH, LEAVES, swatchColor, colorProblem, validateLibrary, validateBaked, BUDGET } from '../library/contract.js';
import * as registry from '../library/index.js';
// Shader motion follows simulation time, including pause and hidden tabs.
const time = uniform(0);

// ---------------------------------------------------------------------------
// World constants. Everything is in meters and seconds.
// ---------------------------------------------------------------------------
const CELL = 16; // terrain sample spacing
const N = 560; // heightfield window, N x N cells (9 km)
const TERRAIN_CELLS = 528; // rendered terrain, ±4.2 km
const WATER_CELLS = 132;
const WATER_CELL = CELL * 4;
const SEA_LEVEL = 0;
const DECK_Y = 520; // cloud deck altitude
const SPEED = 40; // bird speed, m/s
const DAY_SECONDS = 600; // one full turn of the day clock
const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
// Night is a quarter of the cycle. The sun keeps its own clock, `solar`: one
// pace while it is up and a faster one while it is down, the change blended
// over the twilights so nothing jumps at the crossing. The palette, the sky
// bodies and the sky events all read solar phase, so the sky stays the one it
// was tuned as and only the night passes sooner. Midnight is 0, noon is 0.5,
// in both clocks.
const NIGHT_SHARE = 0.25; // of the day clock, sunset to sunrise
const NIGHT_CORE = 0.18; // of the day clock at the night pace, around midnight
const solar = (() => {
  const half = NIGHT_SHARE / 2,
    core = NIGHT_CORE / 2,
    ramp = half - core;
  const dayPace = 0.5 / (1 - NIGHT_SHARE); // half the sun's arc over the day
  // the night's half of the arc: the core at the night pace, each ramp at the mean of both
  const nightPace = (0.25 - (dayPace * ramp) / 2) / (core + ramp / 2);
  const rise = (nightPace - dayPace) / 2;
  const fold = (q) => {
    // 0..0.5 from midnight; the pace along a ramp is dayPace + rise * (1 + cos)
    if (q <= core) return nightPace * q;
    if (q <= half) {
      const u = (q - core) / ramp;
      return nightPace * core + ramp * ((dayPace + rise) * u + (rise * Math.sin(Math.PI * u)) / Math.PI);
    }
    return 0.25 + dayPace * (q - half);
  };
  return (phase) => {
    const whole = Math.floor(phase),
      q = phase - whole;
    return whole + (q <= 0.5 ? fold(q) : 1 - fold(1 - q));
  };
})();

// ---------------------------------------------------------------------------
// Memory. The page remembers the viewer's settings, and per world where the
// flight was, so reopening the tab resumes instead of restarting. Storage can
// be missing, full or damaged; any of those makes this a fresh visit.
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'fly-with-me-settings',
  RESUME_KEY = 'fly-with-me-resume';
const remember = {
  read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // nothing to remember with; the page still works
    }
  },
};
const finite = (v, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const storedSettings = remember.read(SETTINGS_KEY) ?? {};
const storedFlight = remember.read(RESUME_KEY);

// ---------------------------------------------------------------------------
// Seed. ?seed=<number> reproduces a world and always wins; without one the
// remembered world continues, and with nothing remembered every visit is new.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
// `?profile=1` arms the renderer's timestamp queries and the raw frame trace
// that `tools/bench.js` reads. Off, the loop costs one boolean per frame.
const profiling = params.has('profile');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
motionPreference.addEventListener('change', (e) => {
  reducedMotion = e.matches;
  if (reducedMotion && running && !paused) togglePause();
});
let seed = parseInt(params.get('seed'), 10);
if (!Number.isFinite(seed))
  seed = finite(storedFlight?.seed, 0, 0xffffffff) ?? (Math.random() * 0xffffffff) >>> 0;
seed = seed >>> 0;
const shareUrl = new URL(location.href);
shareUrl.search = '';
shareUrl.searchParams.set('seed', String(seed));
document.getElementById('shareLink').href = shareUrl.toString();

// ---------------------------------------------------------------------------
// The look: palette anchors through the whole day, keyed in solar phase (0.25
// sunrise, 0.5 noon, 0.75 sunset). Dawn and dusk carry the most keys because
// that is where the sky changes fastest. Night is dark.
// ---------------------------------------------------------------------------
const C = (hex) => new THREE.Color(hex);
const P = (
  zenith,
  upper,
  horizon,
  below,
  sun,
  sunI,
  hemiSky,
  hemiGround,
  hemiI,
  horizonWarm = horizon,
  upperWarm = upper,
  glow = horizonWarm,
) => ({
  zenith: C(zenith),
  upper: C(upper),
  horizon: C(horizon),
  horizonWarm: C(horizonWarm),
  upperWarm: C(upperWarm),
  glow: C(glow),
  below: C(below),
  sun: C(sun),
  sunI,
  hemiSky: C(hemiSky),
  hemiGround: C(hemiGround),
  hemiI,
});
const NIGHT = P(0x071222, 0x10192e, 0x2e2831, 0x10121b, 0xffb070, 2.4, 0x213258, 0x0e1116, 0.6);
const L = {
  sat: 1,
  fogDensity: 0.00018,
  moon: { color: 0xa8bce8, intensity: 0.7 },
  keys: [
    { t: 0.0, ...NIGHT },
    // astronomical dawn: the first hint of warmth low on the sun's side
    {
      t: 0.17,
      ...P(0x03071a, 0x0a1430, 0x1a2a4c, 0x0b1224, 0xffb070, 2.4, 0x22335a, 0x101318, 0.55, 0x2b3454, 0x0a1430, 0x3a3450),
    },
    // civil dawn: a deep orange band under a mauve sky, the land still blue
    {
      t: 0.215,
      ...P(0x11254e, 0x2c4878, 0x6b7d9c, 0x2a3448, 0xffa860, 2.5, 0x4c5f88, 0x2a2b2a, 0.9, 0xe28a52, 0x8a6a8e, 0xf07038),
    },
    // sunrise: gold on the horizon, peach above it, long cool shadows
    {
      t: 0.25,
      ...P(0x2d5c92, 0x6d95bc, 0x9eafbc, 0x5f7480, 0xffb070, 2.9, 0xa8c2d6, 0x4a5a44, 1.5, 0xffb066, 0xe8a88a, 0xff9a4a),
    },
    // morning
    {
      t: 0.3,
      ...P(0x3a80b4, 0x74a8cc, 0x9dbdcb, 0x83a3a8, 0xffe0b0, 3.0, 0xbcd8e8, 0x6a8850, 1.8, 0xf3d6a2, 0xb9ccd6, 0xf8d29c),
    },
    // noon: the approved day
    {
      t: 0.5,
      ...P(0x3e8dbb, 0x76acd0, 0x96bdcd, 0x8dacae, 0xfff1cb, 3, 0xc2deeb, 0x739054, 1.8, 0xe2e4c3, 0xabcfda),
    },
    // late afternoon: the light turns gold
    {
      t: 0.7,
      ...P(0x3f7fae, 0x7ca4c2, 0xa4b4ba, 0x8a9a94, 0xffd9a0, 2.9, 0xc4d4d8, 0x6a7a50, 1.7, 0xf4c584, 0xc4b8a0, 0xf8b468),
    },
    // sunset: orange fire low, salmon above, the far side already rose and blue
    {
      t: 0.75,
      ...P(0x2f4a82, 0x6c7aa0, 0x9aa0b0, 0x5a5c6a, 0xff9a40, 2.7, 0xa898b0, 0x5a4a40, 1.35, 0xffa040, 0xe09a78, 0xff6a2a),
    },
    // civil dusk: afterglow, purple upper sky, the first stars
    {
      t: 0.785,
      ...P(0x172850, 0x394272, 0x6c6480, 0x2e3448, 0xff9048, 2.4, 0x4a4a76, 0x2a2828, 0.9, 0xf07a3a, 0xa06a82, 0xf25a2a),
    },
    // nautical dusk: the last warmth drains into blue
    {
      t: 0.83,
      ...P(0x060c22, 0x0e1838, 0x243050, 0x0e1424, 0xffb070, 2.4, 0x263658, 0x121418, 0.55, 0x3d3452, 0x101838, 0x50384a),
    },
    { t: 1.0, ...NIGHT },
  ],
  terrain: {
    sand: 0xc5bc85,
    snow: 0xe1e5d2,
    seaFloor: 0x6d9988,
    waterDeep: 0x286e7b,
    waterShallow: 0x74b9a9,
  },
  cloud: { white: 0xe1e4cb },
  bird: { body: 0xdad9bc, wing: 0x566e73, tip: 0x566e73 },
};
const FOG_DENSITY = L.fogDensity;

// ---------------------------------------------------------------------------
// The scenery library lives in library/: a contract (swatches, envelope,
// budgets, validation) and one file per biome, species, ruin type and prop.
// The engine below owns light, sky, fog, streaming, the crown morph, shadows
// and budgets; the library only says what stands where and what color it is.
// It is validated once here, and every baked entry is measured as it is built,
// so a broken contribution cannot ship quietly.
// ---------------------------------------------------------------------------
const BIOMES = registry.biomes,
  SPECIES = Object.fromEntries(registry.species.map((entry) => [entry.id, entry])),
  RUINS = registry.ruins,
  PROPS = registry.props;
{
  const errors = validateLibrary(registry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
}
// How rare the sites are: one site cell in this many carries a site, before
// the biome's welcome. Cells are SITE_CELL meters wide.
const SITE_CELL = 1200,
  SITE_ODDS = 0.22;
// A color from the library, refused by name when it leaves the envelope.
function libraryColor(where, value) {
  const problem = colorProblem(value);
  if (problem) throw new Error(`scenery library: ${where}: ${problem}`);
  return C(swatchColor(value));
}

// ---------------------------------------------------------------------------
// Noise on the CPU (src/noise.js) is the single source of truth for the
// terrain; the GPU only displaces a static grid by what the CPU wrote.
// ---------------------------------------------------------------------------
// Three field seeds, hashed rather than sliced from the bits, so small
// seeds do not share a climate.
const S1 = hash2(seed, 1, 0x1a2b) & 0xffff,
  S2 = hash2(seed, 2, 0x3c4d) & 0xffff,
  S3 = hash2(seed, 3, 0x5e6f) & 0xffff;
// Slow control fields decide what kind of place this is; fast noise only
// decorates. Continentalness shapes the land. Temperature, moisture and
// region are the climate the biomes read: a dozen kilometers wide, warped so
// their borders wander like coastlines, and never read directly for color.
const CLIMATE_SCALE = 12000;
function sampleWorld(x, z, out) {
  const wx = x + 700 * fbm(x / 2200 + 31.7, z / 2200 - 12.3, S3, 3);
  const wz = z + 700 * fbm(x / 2200 - 54.1, z / 2200 + 77.9, S3 + 7, 3);
  const cont = fbm(wx / 3400, wz / 3400, S1, 4) * 0.5 + 0.5; // continentalness
  const kx = x + 900 * fbm(x / 3000 + 4.1, z / 3000 - 2.2, S3 + 41, 2),
    kz = z + 900 * fbm(x / 3000 - 7.7, z / 3000 + 5.5, S3 + 43, 2);
  const temp = fbm(kx / CLIMATE_SCALE + 9.1, kz / CLIMATE_SCALE + 3.3, S2, 2) * 0.5 + 0.5;
  const moist = fbm(kx / (CLIMATE_SCALE * 0.8) - 8.4, kz / (CLIMATE_SCALE * 0.8) + 15.2, S2 + 3, 2) * 0.5 + 0.5;
  const region = fbm(kx / (CLIMATE_SCALE * 0.9) + 21.3, kz / (CLIMATE_SCALE * 0.9) - 8.8, S3 + 19, 2) * 0.5 + 0.5;
  const land = sstep(0.4, 0.6, cont);
  const hills = fbm(wx / 520, wz / 520, S1 + 11, 4);
  const mountainMask = sstep(0.58, 0.86, cont);
  const ridge = ridged(wx / 1100, wz / 1100, S1 + 23, 2);
  let h = -70 + 150 * land + hills * (10 + 38 * land) + Math.pow(ridge, 1.7) * 680 * mountainMask;
  // a gentle shelf so beaches are wide and the shoreline never zigzags
  const shelf = sstep(-30, 30, h);
  h = h * (0.55 + 0.45 * shelf) + (1 - shelf) * -6;
  out[0] = h;
  out[1] = temp - Math.max(0, h) / 2600; // colder with altitude
  out[2] = moist;
  out[3] = region;
  return out;
}
// How much of each biome a climate is. The same rule runs on the GPU for
// terrain color, so a place is the same biome for its ground, its trees,
// its grass, its rocks and its ruins. Each biome is a soft cell in climate
// space; sharpening keeps most ground inside one biome with bands of a few
// hundred meters between them, so borders never seam and never smear.
const CLIMATE_STRETCH = 2.2,
  CLIMATE_RADIUS = 0.12,
  CLIMATE_SHARPNESS = 2.2;
const climateAxis = (v) => Math.min(1, Math.max(0, (v - 0.5) * CLIMATE_STRETCH + 0.5));
function biomeWeights(temp, moist, region, out = new Float32Array(BIOMES.length)) {
  const t = climateAxis(temp),
    m = climateAxis(moist),
    r = climateAxis(region);
  let nearest = Infinity;
  for (let i = 0; i < BIOMES.length; i++) {
    const [ct, cm, cr] = BIOMES[i].climate;
    out[i] = ((t - ct) ** 2 + (m - cm) ** 2 + (r - cr) ** 2) / (CLIMATE_RADIUS * CLIMATE_RADIUS);
    nearest = Math.min(nearest, out[i]);
  }
  // Measured from the nearest cell, so the largest weight is one and the
  // GPU's single-precision copy of this rule never underflows.
  let sum = 0;
  for (let i = 0; i < BIOMES.length; i++) sum += out[i] = Math.exp(-CLIMATE_SHARPNESS * (out[i] - nearest));
  for (let i = 0; i < BIOMES.length; i++) out[i] /= sum;
  return out;
}
function biomeAt(x, z, out) {
  return biomeWeights(fieldAt(x, z, 1), fieldAt(x, z, 2), fieldAt(x, z, 3), out);
}

// ---------------------------------------------------------------------------
// The heightfield: a toroidal N x N window of world cells kept fresh around the
// bird. Texel (ix mod N, iz mod N) always holds world cell (ix, iz).
// ---------------------------------------------------------------------------
const hfData = new Float32Array(N * N * 4);
const hfTex = new THREE.DataTexture(hfData, N, N, THREE.RGBAFormat, THREE.FloatType);
hfTex.magFilter = hfTex.minFilter = THREE.NearestFilter;
hfTex.generateMipmaps = false;
let hfCx = 0,
  hfCz = 0; // world cell the window is centered on
const tmp4 = [0, 0, 0, 0];
function wrap(i) {
  return ((i % N) + N) % N;
}
function fillCell(ix, iz) {
  sampleWorld(ix * CELL, iz * CELL, tmp4);
  const o = (wrap(iz) * N + wrap(ix)) * 4;
  hfData[o] = tmp4[0];
  hfData[o + 1] = tmp4[1];
  hfData[o + 2] = tmp4[2];
  hfData[o + 3] = tmp4[3];
}
function fillAll(cx, cz) {
  hfCx = cx;
  hfCz = cz;
  for (let iz = cz - N / 2; iz < cz + N / 2; iz++)
    for (let ix = cx - N / 2; ix < cx + N / 2; ix++) fillCell(ix, iz);
  hfTex.needsUpdate = true;
}
function updateHeightfield(x, z) {
  const cx = Math.round(x / CELL),
    cz = Math.round(z / CELL);
  let changed = false;
  if (Math.abs(cx - hfCx) > N / 4 || Math.abs(cz - hfCz) > N / 4) {
    fillAll(cx, cz);
    return;
  }
  while (hfCx < cx) {
    hfCx++;
    const ix = hfCx + N / 2 - 1;
    for (let iz = hfCz - N / 2; iz < hfCz + N / 2; iz++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCx > cx) {
    hfCx--;
    const ix = hfCx - N / 2;
    for (let iz = hfCz - N / 2; iz < hfCz + N / 2; iz++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCz < cz) {
    hfCz++;
    const iz = hfCz + N / 2 - 1;
    for (let ix = hfCx - N / 2; ix < hfCx + N / 2; ix++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCz > cz) {
    hfCz--;
    const iz = hfCz - N / 2;
    for (let ix = hfCx - N / 2; ix < hfCx + N / 2; ix++) fillCell(ix, iz);
    changed = true;
  }
  if (changed) hfTex.needsUpdate = true;
}
function texel(ix, iz, c) {
  return hfData[(wrap(iz) * N + wrap(ix)) * 4 + c];
}
// Barycentric interpolation on the exact triangles drawn by buildGrid.
function heightAt(x, z) {
  const fx = x / CELL,
    fz = z / CELL;
  const ix = Math.floor(fx),
    iz = Math.floor(fz);
  const tx = fx - ix,
    tz = fz - iz;
  const h00 = texel(ix, iz, 0),
    h10 = texel(ix + 1, iz, 0),
    h01 = texel(ix, iz + 1, 0),
    h11 = texel(ix + 1, iz + 1, 0);
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}
function fieldAt(x, z, c) {
  return texel(Math.round(x / CELL), Math.round(z / CELL), c);
}
function slopeAt(x, z) {
  const ix = Math.round(x / CELL),
    iz = Math.round(z / CELL);
  const dx = texel(ix + 1, iz, 0) - texel(ix - 1, iz, 0),
    dz = texel(ix, iz + 1, 0) - texel(ix, iz - 1, 0);
  return Math.hypot(dx, dz) / (2 * CELL);
}

// ---------------------------------------------------------------------------
// Renderer, scene, lights
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
// Multisampling belongs to the scene pass and nowhere else. `antialias` here
// would also multisample the canvas, where the only thing ever drawn is one
// full-screen quad: every sample of it takes the same shaded value and the
// resolve averages copies of that value, so four samples of the finished
// picture cost four times the raster and a resolve to produce it unchanged.
// The scene pass asks for its own four samples below, which is what the
// approved look and the foliage's alpha-to-coverage actually need.
const renderer = new WebGPURenderer({
  canvas,
  antialias: false,
  trackTimestamp: params.has('profile'),
  forceWebGL: params.get('webgl') === '1',
});
const renderScale = () =>
  Math.min(
    window.devicePixelRatio || 1,
    1.5,
    Math.sqrt(2000000 / (Math.max(1, window.innerWidth) * Math.max(1, window.innerHeight))),
  );
renderer.setPixelRatio(renderScale());
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
await renderer.init();
document.getElementById('backendLabel').textContent = renderer.backend.isWebGPUBackend
  ? 'webgpu'
  : 'webgl2';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 14000);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
const hemi = new THREE.HemisphereLight(0xa9c8e6, 0x8a8f78, 1.0);
scene.add(sun, sun.target, hemi);
renderer.shadowMap.enabled = true;
sun.castShadow = true;
const SHADOW_MAP = 2048,
  SHADOW_HALF = 360;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sun.shadow.camera, {
  left: -SHADOW_HALF,
  right: SHADOW_HALF,
  top: SHADOW_HALF,
  bottom: -SHADOW_HALF,
  near: 1,
  far: 2200,
});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.5;
sun.shadow.radius = 3;
sun.shadow.intensity = 0.55;
const shadowMatrix = uniform(sun.shadow.matrix);
const receiveSoftShadow = Fn(([shadow]) => {
  const projected = shadowMatrix.mul(vec4(positionWorld, 1));
  const edge = max(
    abs(projected.x.div(projected.w).sub(0.5)),
    abs(projected.y.div(projected.w).sub(0.5)),
  ).mul(2);
  return mix(float(1), shadow, float(1).sub(smoothstep(0.72, 0.98, edge)));
});

// ---------------------------------------------------------------------------
// Day cycle palette. The rule that keeps the world infinite: fog color equals
// the horizon color, always.
// ---------------------------------------------------------------------------
const KEYS = L.keys;
const pal = {
  zenith: C(0),
  upper: C(0),
  horizon: C(0),
  horizonWarm: C(0),
  upperWarm: C(0),
  glow: C(0),
  below: C(0),
  sun: C(0),
  sunI: 1,
  hemiSky: C(0),
  hemiGround: C(0),
  hemiI: 1,
};
function evalPalette(p) {
  p = p - Math.floor(p);
  let i = 0;
  while (KEYS[i + 1].t < p) i++;
  const a = KEYS[i],
    b = KEYS[i + 1];
  const t = sstep(0, 1, (p - a.t) / (b.t - a.t));
  for (const k of [
    'zenith',
    'upper',
    'horizon',
    'horizonWarm',
    'upperWarm',
    'glow',
    'below',
    'sun',
    'hemiSky',
    'hemiGround',
  ])
    pal[k].copy(a[k]).lerp(b[k], t);
  pal.sunI = a.sunI + (b.sunI - a.sunI) * t;
  pal.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
}

// uniforms shared by sky, fog, materials
const uZenith = uniform(C(0)),
  uUpper = uniform(C(0)),
  uHorizon = uniform(C(0)),
  uHorizonWarm = uniform(C(0)),
  uUpperWarm = uniform(C(0)),
  uBelow = uniform(C(0)),
  uSunColor = uniform(C(0));
const uSunDir = uniform(new THREE.Vector3(0, 1, 0)); // the true sun, even below the horizon
const uMoonDir = uniform(new THREE.Vector3(0, 1, 0));
const uMoonUp = uniform(0); // the moon is above the horizon
const uMoonLight = uniform(0); // moonlight strength: night, moon up
const uNight = uniform(0);
const uLowSun = uniform(0); // the sun sits on the horizon
const uGlow = uniform(C(0)); // the sun-side horizon band
const uGlowI = uniform(0);
const uVenusI = uniform(0); // the rose belt opposite a low sun
const MOON_COLOR = C(L.moon.color);
const uFogDensity = uniform(FOG_DENSITY);
const uAbove = uniform(0); // 1 when the camera is above the cloud deck
const uWhiteout = uniform(0); // 1 while crossing the deck
const uDeck = uniform(DECK_Y);
const cloudWhite = C(L.cloud.white);
const uCloudWhite = uniform(cloudWhite.clone()),
  uCloudBodies = uniform(0);

// One directional horizon owns both the sky boundary and every fogged surface.
const azimuthAlign = Fn(([dir, ref]) =>
  max(dot(dir.xz, ref.xz).div(max(length(dir.xz).mul(length(ref.xz)), 0.0001)), 0),
);
// Above the deck the far cloud sea meets a bright haze rather than a flat
// white: the horizon keeps the day's hue and its warmth toward the sun, so
// the sun stands out against it and the sea's far edge still meets the sky.
const horizonTint = Fn(([dir]) => {
  const align = pow(azimuthAlign(dir, uSunDir), 5);
  const base = mix(uHorizon, uHorizonWarm, align);
  const haze = mix(mix(uHorizon, uCloudWhite, 0.4), mix(uHorizonWarm, uGlow, uLowSun.mul(0.7)), align);
  return mix(mix(base, haze, uAbove), uCloudWhite, uWhiteout);
});

// fog: distance fog in the horizon color, plus a height fog below the cloud deck
// that becomes the cloud sea when the camera is above it, plus the whiteout.
{
  const distance = length(positionWorld.sub(cameraPosition));
  const distF = densityFogFactor(uFogDensity).mul(mix(1, 0.55, smoothstep(100, 1000, positionWorld.y)));
  const lowAir = distance
    .div(120)
    .clamp(0, 1)
    .mul(0.055)
    .mul(float(1).sub(smoothstep(200, 800, positionWorld.y)));
  // Preserve the study's gentle local air; only the far streamed edge needs cover.
  const farCover = smoothstep(2600, 4100, distance);
  const air = float(1).sub(float(1).sub(distF).mul(float(1).sub(lowAir)).mul(float(1).sub(farCover)));
  const seaF = exponentialHeightFogFactor(float(0.0000085), uDeck.sub(30)).mul(uAbove);
  const factor = max(max(air, seaF), uWhiteout);
  scene.fogNode = fog(horizonTint(normalize(positionWorld.sub(cameraPosition))), factor);
}

// ---------------------------------------------------------------------------
// Sky: a painted gradient keyed by time of day, dawn and dusk bands, a sun,
// a moon with its own face, stars and the Milky Way, then painted clouds.
// ---------------------------------------------------------------------------
const VENUS = vec3(0.86, 0.46, 0.52);
const SPARSE_STAR_AXIS = normalize(vec3(0.36, 0.5, -0.79));
// Shared by the dome and the star catalog: clouds occlude all
// celestial detail once, with the same shape. No galaxy is painted over them.
const paintedClouds = Fn(([dir]) => {
  const p = dir.xz.div(dir.y.max(0.025).add(0.19)).mul(vec2(2.8, 6)).add(vec2(time.mul(0.001), 0));
  const mass = mx_noise_float(p.mul(0.3).add(vec2(3, 12))).mul(0.28)
    .add(mx_noise_float(p).mul(0.6))
    .add(mx_noise_float(p.mul(2.1).add(8)).mul(0.3))
    .add(mx_noise_float(p.mul(5.8)).mul(0.16))
    .add(mx_noise_float(p.mul(15)).mul(0.06));
  // The night ceiling opens into clear windows, while the low cloud banks
  // and all near-deck cloud bodies keep their opacity.
  const opening = smoothstep(0.045, 0.22, dir.y).mul(uNight).mul(0.35);
  const mask = smoothstep(uNight.mul(0.14).sub(0.14).add(opening), uNight.mul(0.08).add(0.34).add(opening), mass)
    .mul(smoothstep(0.014, 0.15, dir.y));
  return vec2(mass, mask);
});
const celestialVisibility = Fn(([dir]) => uNight.mul(float(1).sub(uMoonLight.mul(0.45)))
  .mul(smoothstep(0.0, 0.15, dir.y)).mul(float(1).sub(uWhiteout)));
const galaxy = createMilkyWay(Fn(([dir]) => celestialVisibility(dir)
  .mul(float(1).sub(paintedClouds(dir).y.mul(mix(0.6, 0.94, uNight))))));
scene.add(galaxy.stars);
// Sparse hashed stars: one cell grid per layer, brightness and tint per star.
const starField = Fn(([dir, scale, threshold]) => {
  const sc = dir.mul(scale);
  const cellId = sc.floor(),
    cf = fract(sc);
  const seedA = dot(cellId, vec3(1.0, 57.0, 113.0));
  const center = vec3(hash(seedA), hash(seedA.add(11.0)), hash(seedA.add(29.0)));
  const dd = length(cf.sub(center));
  const isStar = step(threshold, hash(seedA.add(3.0)));
  const bright = hash(seedA.add(17.0));
  const dotv = smoothstep(0.2, 0.02, dd).mul(isStar).mul(mix(0.45, 1.7, bright.mul(bright)));
  const twinkle = sin(time.mul(1.3).add(hash(seedA.add(5.0)).mul(40.0)))
    .mul(0.3)
    .add(0.7);
  const tint = mix(vec3(0.76, 0.83, 1.0), vec3(1.0, 0.9, 0.78), hash(seedA.add(41.0)));
  return tint.mul(dotv).mul(twinkle);
});
const skyColor = Fn(([dir]) => {
  const y = dir.y;
  const sunUp = smoothstep(-0.14, 0.02, uSunDir.y);
  const s = max(dot(dir, uSunDir), 0.0).mul(sunUp);
  const align = azimuthAlign(dir, uSunDir);
  const anti = azimuthAlign(dir, uSunDir.negate());
  const horizon = horizonTint(dir);
  // sun-side warmth climbs higher the closer to the sun's azimuth
  const warmUpper = mix(uUpper, uUpperWarm, pow(align, 3.5).mul(0.8).add(pow(s, 5).mul(0.2)));
  const skyUp = mix(warmUpper, uZenith, smoothstep(0.1, 0.85, y));
  const aboveH = mix(horizon, skyUp, smoothstep(0.0, 0.4, y));
  const belowH = mix(horizon, uBelow, smoothstep(0.0, -0.25, y));
  const col = select(y.greaterThan(0.0), aboveH, belowH).toVar();
  // dawn and dusk: a thin saturated band along the sun-side horizon
  const band = pow(align, 3).mul(exp(abs(y).div(0.07).negate())).mul(uGlowI);
  col.assign(mix(col, uGlow, band.mul(0.8)));
  // the belt of Venus: a rose band opposite a low sun, over the earth's blue shadow
  const venusShape = exp(y.sub(0.07).div(0.06).pow(2).negate());
  const venus = pow(anti, 2).mul(venusShape).mul(uVenusI);
  col.assign(mix(col, VENUS, venus.mul(0.35)));
  const earthShadow = pow(anti, 2).mul(smoothstep(0.06, 0.0, y)).mul(smoothstep(-0.05, 0.01, y)).mul(uVenusI);
  col.assign(mix(col, col.mul(vec3(0.78, 0.84, 1.0)), earthShadow.mul(0.5)));
  // the sun: a disc, a tight glow, and a broad warm halo when it sits low
  const ang = acos(clamp(s, 0.0, 1.0));
  const disc = smoothstep(0.03, 0.024, ang);
  const sunCol = mix(uSunColor, uGlow, uLowSun.mul(0.6));
  const glow = pow(s, 30)
    .mul(0.12)
    .add(pow(s, 500).mul(0.6))
    .add(pow(s, 4).mul(uLowSun).mul(0.35));
  col.addAssign(sunCol.mul(glow.add(disc.mul(mix(1.2, 0.8, uLowSun)))).mul(smoothstep(-0.02, 0.0, y)));
  // the moon: a lit gibbous face with maria and limb darkening, a soft halo
  const m = max(dot(dir, uMoonDir), 0.0);
  const moonRight = normalize(cross(uMoonDir, vec3(0, 1, 0)));
  const moonUpV = cross(moonRight, uMoonDir);
  const MOON_R = 0.025;
  const u = dot(dir, moonRight).div(MOON_R),
    v = dot(dir, moonUpV).div(MOON_R);
  const rr = length(vec2(u, v));
  const discM = smoothstep(1.0, 0.9, rr).mul(step(0.0, m));
  const maria = mx_noise_float(vec2(u, v).mul(2.2).add(vec2(5.3, 1.7)))
    .mul(0.5)
    .add(mx_noise_float(vec2(u, v).mul(5.5).add(vec2(9.0, 3.0))).mul(0.3));
  const albedo = float(1).sub(smoothstep(0.05, 0.45, maria).mul(0.32));
  const limb = float(1).sub(rr.mul(rr).mul(0.25));
  const chord = sqrt(max(float(1).sub(v.mul(v)), 0.0001));
  const litSide = sign(dot(uSunDir, moonRight).add(0.0001));
  const lit = smoothstep(-0.8, -0.55, u.mul(litSide).div(chord));
  const moonSurface = albedo.mul(limb).mul(mix(0.06, 1.0, lit));
  const moonNight = vec3(0.98, 0.97, 0.92).mul(moonSurface).mul(1.35);
  const moonDay = col.mul(1.12).add(vec3(0.05)).mul(mix(0.55, 1.0, moonSurface));
  col.assign(mix(col, mix(moonDay, moonNight, uNight), discM.mul(uMoonUp)));
  const halo = pow(m, 250).mul(0.35).add(pow(m, 30).mul(0.06));
  col.addAssign(vec3(0.75, 0.8, 0.95).mul(halo).mul(uNight).mul(uMoonUp).mul(float(1).sub(discM)));
  // painted clouds: their mass and mask come first so stars can hide behind them
  const cloud = paintedClouds(dir), mass = cloud.x, mask = cloud.y;
  // stars and the Milky Way, only at night, fading into the horizon haze
  const sparseBand = exp(dot(dir, SPARSE_STAR_AXIS).div(0.15).pow(2).negate());
  const stars = starField(dir, 90.0, 0.955)
    .add(starField(dir, 200.0, float(0.975).sub(sparseBand.mul(0.05))).mul(0.5))
    .add(galaxy.radiance(dir));
  col.addAssign(stars.mul(celestialVisibility(dir)));
  // clouds: lit toward the sun, on fire at sunset, blushing opposite it, moonlit at night
  const shade = mix(uUpper.mul(0.85), horizon, 0.28);
  const light = mix(uCloudWhite, sunCol, pow(s, 4).mul(0.75))
    .toVar();
  light.assign(mix(light, uGlow, uLowSun.mul(pow(align, 1.5)).mul(0.7)));
  light.assign(mix(light, mix(light, VENUS, 0.5), uVenusI.mul(pow(anti, 1.5)).mul(0.6)));
  light.addAssign(vec3(0.5, 0.55, 0.7).mul(pow(m, 6)).mul(uMoonLight).mul(0.35));
  col.assign(mix(col, mix(light, shade, smoothstep(0.02, 0.36, mass)),
    mask.mul(mix(0.6, 0.94, uNight))));
  const edge = smoothstep(-0.18, 0.08, mass).mul(float(1).sub(smoothstep(0.08, 0.24, mass)));
  col.addAssign(
    sunCol
      .mul(edge)
      .mul(pow(s, 15))
      .mul(0.7)
      .mul(smoothstep(0.025, 0.12, y)),
  );
  return col;
});
// The dome only ever reads a direction, so its radius is free; it sits beyond
// the far corner of the streamed terrain (a little under six kilometres) so
// that nothing opaque is ever behind it. That lets it draw last among the
// opaque objects instead of first: the depth test then throws away every
// fragment the ground, the trees and the water already cover, and this shader
// (bands, sun, moon, painted cloud, two star fields and the galaxy) runs only
// on the sky a viewer can actually see. It writes no depth, so the stars and
// the clouds that follow it are unaffected.
const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 24), new MeshBasicNodeMaterial());
{
  const m = sky.material;
  m.side = THREE.BackSide;
  m.depthWrite = false;
  m.fog = false;
  m.colorNode = skyColor(normalize(positionWorld.sub(cameraPosition)));
}
sky.renderOrder = 1;
scene.add(sky);

// ---------------------------------------------------------------------------
// The approved illustrated response: broad diffuse groups, no specular lobe.
// ---------------------------------------------------------------------------
class SoftIllustratedLighting extends THREE.LightingModel {
  direct({ lightDirection, lightColor, reflectedLight }) {
    const nl = dot(normalView, lightDirection);
    const bands = mix(0.18, 0.72, smoothstep(-0.18, 0.15, nl)).add(smoothstep(0.5, 0.85, nl).mul(0.15));
    reflectedLight.directDiffuse.addAssign(
      lightColor
        .mul(mix(max(nl, 0), bands, 0.65))
        .mul(diffuseColor.rgb)
        .mul(1 / Math.PI),
    );
  }
  indirect(builder) {
    const { irradiance, ambientOcclusion, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb).mul(1 / Math.PI));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}
function litMaterial(colorNode, opts = {}) {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, ...(opts.basic || {}) });
  const base = vec4(colorNode);
  const compressed = pow(max(base.rgb, vec3(0.0001)), vec3(0.9)).mul(0.94);
  const value = dot(compressed, vec3(0.2126, 0.7152, 0.0722));
  m.colorNode = vec4(mix(compressed, vec3(value), 0.08), base.a);
  m.setupLightingModel = () => new SoftIllustratedLighting();
  m.receivedShadowNode = receiveSoftShadow;
  if (opts.emissiveNode) m.emissiveNode = opts.emissiveNode.mul(0.25);
  return m;
}
function paintedSample(map) {
  const image = map.image,
    bytes = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  const linear = Array.from(
    { length: 256 },
    (_, i) => C(0).setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r,
  );
  const mean = C(0);
  let weight = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3] / 255;
    mean.r += linear[bytes[i]] * a;
    mean.g += linear[bytes[i + 1]] * a;
    mean.b += linear[bytes[i + 2]] * a;
    weight += a;
  }
  mean.multiplyScalar(1 / Math.max(1, weight));
  const sharp = texture(map);
  return vec4(mix(sharp.bias(0.8).rgb, uniform(mean), 0.38), sharp.a);
}
const satU = float(L.sat);
const stylize = (c) => saturation(c, satU);

// ---------------------------------------------------------------------------
// Indexed terrain reads CPU heights and smooth normals. Biomes belong to
// each triangle, not a colored corner; shore masks use actual fragment height.
// ---------------------------------------------------------------------------
const uOrigin = uniform(new THREE.Vector2(0, 0));
const uWaterOrigin = uniform(new THREE.Vector2(0, 0));
const palette = {};
for (const k of Object.keys(L.terrain)) palette[k] = uniform(C(L.terrain[k]));
const biomeColors = BIOMES.map((biome) => ({
  base: libraryColor(`biome ${biome.id}.ground.base`, biome.ground.base),
  alt: libraryColor(`biome ${biome.id}.ground.alt`, biome.ground.alt),
  rock: libraryColor(`biome ${biome.id}.ground.rock`, biome.ground.rock),
}));
const biomeUniforms = biomeColors.map((colors) => ({
  base: uniform(colors.base.clone()),
  alt: uniform(colors.alt.clone()),
  rock: uniform(colors.rock.clone()),
}));
const loadCell = (ix, iz) => textureLoad(hfTex, ivec2(ix.mod(N).toInt(), iz.mod(N).toInt()));
function buildGrid(cells, cell) {
  const side = cells + 1,
    count = side * side;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  const indices =
    count > 65535 ? new Uint32Array(cells * cells * 6) : new Uint16Array(cells * cells * 6);
  let index = 0;
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++) {
      const vertex = z * side + x;
      positions[vertex * 3] = (x - cells / 2) * cell;
      positions[vertex * 3 + 2] = (z - cells / 2) * cell;
      normals[vertex * 3 + 1] = 1;
      if (x < cells && z < cells) {
        // Same diagonal as heightAt, including at negative world coordinates.
        indices.set(
          [vertex, vertex + side, vertex + 1, vertex + side + 1, vertex + 1, vertex + side],
          index,
        );
        index += 6;
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

let terrainMat;
{
  const wx = positionLocal.x.add(uOrigin.x),
    wz = positionLocal.z.add(uOrigin.y);
  const ix = wx.div(CELL).add(0.5).floor(),
    iz = wz.div(CELL).add(0.5).floor();
  const sample = loadCell(ix, iz),
    hv = sample.x;
  const surfaceNormal = normalize(
    vec3(
      loadCell(ix.sub(1), iz).x.sub(loadCell(ix.add(1), iz).x),
      CELL * 2,
      loadCell(ix, iz.sub(1)).x.sub(loadCell(ix, iz.add(1)).x),
    ),
  );
  // Reconstruct the facet centroid's three samples in the fragment stage.
  // This keeps triangle-owned biome color without duplicating indexed vertices.
  const cell = positionWorld.xz.div(CELL),
    base = cell.floor();
  const upper = step(1, fract(cell.x).add(fract(cell.y)));
  const a = loadCell(base.x.add(upper), base.y.add(upper));
  const b = loadCell(base.x.add(1), base.y),
    c = loadCell(base.x, base.y.add(1));
  const h = positionWorld.y,
    temp = a.y.add(b.y).add(c.y).div(3),
    moist = a.z.add(b.z).add(c.z).div(3),
    region = a.w.add(b.w).add(c.w).div(3);
  const slope = float(1).sub(varying(surfaceNormal).normalize().y);

  // The GPU side of biomeWeights: the same cells, the same sharpening, on
  // the triangle's own climate, so ground color and placement agree.
  const climateAxisNode = (v) => v.sub(0.5).mul(CLIMATE_STRETCH).add(0.5).clamp(0, 1);
  const ct = climateAxisNode(temp),
    cm = climateAxisNode(moist),
    cr = climateAxisNode(region);
  const colorNode = Fn(() => {
    const macro = smoothstep(0.18, 0.48, mx_noise_float(positionWorld.xz.mul(0.012)));
    const distances = BIOMES.map(({ climate: [t0, m0, r0] }) =>
      ct.sub(t0).pow(2).add(cm.sub(m0).pow(2)).add(cr.sub(r0).pow(2)).div(CLIMATE_RADIUS * CLIMATE_RADIUS).toVar(),
    );
    let nearest = distances[0];
    for (const d of distances.slice(1)) nearest = nearest.min(d);
    let ground = vec3(0).toVar(),
      rock = vec3(0).toVar(),
      total = float(0).toVar();
    distances.forEach((d, i) => {
      const w = exp(d.sub(nearest).mul(-CLIMATE_SHARPNESS));
      ground.addAssign(mix(biomeUniforms[i].base, biomeUniforms[i].alt, macro).mul(w));
      rock.addAssign(biomeUniforms[i].rock.mul(w));
      total.addAssign(w);
    });
    ground.divAssign(total);
    rock.divAssign(total);
    ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));
    ground.assign(mix(ground, rock, smoothstep(0.32, 0.55, slope)));
    const snowLine = temp.mul(-420.0).add(560.0);
    const snowAmt = smoothstep(snowLine.sub(40.0), snowLine.add(40.0), h).mul(smoothstep(0.75, 0.45, slope));
    ground.assign(mix(ground, palette.snow, snowAmt));
    return stylize(ground);
  })();
  const brush = mx_noise_float(positionWorld.xz.mul(0.018))
    .mul(0.04)
    .add(mx_noise_float(positionWorld.xz.mul(0.13)).mul(0.015))
    .add(1);
  // Shore masks use the actual fragment height, never interpolated corner colors.
  terrainMat = litMaterial(
    mix(palette.sand, colorNode, smoothstep(1.5, 7.5, positionWorld.y)).mul(brush),
  );
  terrainMat.positionNode = vec3(positionLocal.x, hv, positionLocal.z);
  terrainMat.normalNode = transformNormalToView(varying(surfaceNormal).normalize());
}
const terrain = new THREE.Mesh(buildGrid(TERRAIN_CELLS, CELL), terrainMat);
terrain.frustumCulled = false;
terrain.receiveShadow = true;
scene.add(terrain);

// Approved jade coves: the same one opaque draw, with CPU-owned depth and
// soft, footprint-filtered ripples. The shader lives in src/water.js.
const waterMaterial = createWaterMaterial({
  time, origin: uWaterOrigin, seaLevel: SEA_LEVEL, cellSize: CELL, loadCell,
  palette, litMaterial, horizonTint, azimuthAlign,
  sky: {
    zenith: uZenith, upper: uUpper, upperWarm: uUpperWarm,
    sunDir: uSunDir, sunColor: uSunColor, moonDir: uMoonDir,
    moonLight: uMoonLight, lowSun: uLowSun, glow: uGlow,
  },
});
const water = new THREE.Mesh(buildGrid(WATER_CELLS, WATER_CELL), waterMaterial);
water.frustumCulled = false;
scene.add(water);

// ---------------------------------------------------------------------------
// Geometry helpers for the procedural props (no assets anywhere).
// ---------------------------------------------------------------------------
function mergeParts(parts) {
  // parts: [{ geometry, matrix, color, card }]; returns one non-indexed geometry with
  // vertex colors. Leaf cards also carry their center and whether the distant crown
  // keeps them, packed into one attribute: WebGPU allows only eight vertex buffers.
  const positions = [],
    normals = [],
    colors = [],
    uvs = [],
    cards = [];
  const nm = new THREE.Matrix3();
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    const pos = g.attributes.position,
      nor = g.attributes.normal;
    const m = p.matrix || new THREE.Matrix4();
    nm.getNormalMatrix(m);
    const v = new THREE.Vector3(),
      n = new THREE.Vector3();
    const c = p.color !== undefined ? new THREE.Color(p.color) : new THREE.Color(0xffffff);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
      uvs.push(g.attributes.uv?.getX(i) ?? 0, g.attributes.uv?.getY(i) ?? 0);
      if (p.card) cards.push(p.card.center.x, p.card.center.y, p.card.center.z, p.card.kept ? 1 : 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (cards.length) geo.setAttribute('card', new THREE.Float32BufferAttribute(cards, 4));
  return geo;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
// vertex-colored props: color comes from the geometry, tinted per instance when instanced
function propMaterial(extra = {}) {
  return litMaterial(stylize(attribute('color', 'vec3')), extra);
}

// ---------------------------------------------------------------------------
// Trees: every species in the library is one baked tree, instanced whole and
// tinted per instance by its climate. All species share the crown rules.
// ---------------------------------------------------------------------------
// Painted leaves. Each form is a different way of filling the card: broad
// leaves, needle bundles, palm fronds, or blossom petals.
function leafTexture(leaf) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d'),
    r = mulberry32(178);
  ctx.lineCap = 'round';
  const form = leaf.form ?? 'broad';
  if (form === 'frond') {
    // long feathered blades radiating from the stem
    for (let j = 0; j < 9; j++) {
      const a = -0.35 + (j / 8) * 0.7 - Math.PI / 2 + (r() - 0.5) * 0.12,
        len = 215 + r() * 30;
      ctx.strokeStyle = leaf.dark[j % 3];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(256, 470);
      ctx.lineTo(256 + Math.cos(a) * len, 470 + Math.sin(a) * len);
      ctx.stroke();
      for (let k = 8; k < len; k += 7) {
        const x = 256 + Math.cos(a) * k,
          y = 470 + Math.sin(a) * k,
          w = 26 * (1 - k / len) + 6;
        ctx.strokeStyle = [...leaf.mid, leaf.light][(k / 7 + j) % 4 | 0];
        ctx.lineWidth = 3.5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a + side * 1.1) * w, y + Math.sin(a + side * 1.1) * w);
          ctx.stroke();
        }
      }
    }
  } else if (form === 'needle') {
    // bundles of short needles around twigs
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      ctx.strokeStyle = '#4a4634';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.lineTo(256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190);
      ctx.stroke();
    }
    for (let j = 0; j < 900; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * 200;
      const x = 256 + Math.cos(a) * rad,
        y = 256 + Math.sin(a) * rad,
        dir = a + (r() - 0.5) * 1.2,
        len = 14 + r() * 16;
      ctx.strokeStyle = [...leaf.dark, ...leaf.mid, leaf.light][j % 7];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
    }
  } else {
    for (let j = 0; j < 11; j++) {
      const a = (j / 11) * Math.PI * 2,
        x = 256 + Math.cos(a) * 170,
        y = 256 + Math.sin(a) * 170;
      ctx.strokeStyle = form === 'petal' ? '#6b5a4a' : '#526b3e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 275);
      ctx.quadraticCurveTo((256 + x) / 2, 220, x, y);
      ctx.stroke();
    }
    for (let j = 0; j < 360; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * (177 + 20 * Math.sin(a * 5));
      ctx.save();
      ctx.translate(256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad);
      ctx.rotate(a + (r() - 0.5) * 1.8);
      const len = 16 + r() * 15,
        w = 7 + r() * 7,
        g = ctx.createLinearGradient(-len / 2, w, len / 2, -w);
      g.addColorStop(0, leaf.dark[j % 3]);
      g.addColorStop(0.55, leaf.mid[j % 3]);
      g.addColorStop(1, leaf.light);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (form === 'petal') {
        // five round petals about a small heart
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2;
          ctx.moveTo(Math.cos(pa) * w * 0.9 + w * 0.55, Math.sin(pa) * w * 0.9);
          ctx.arc(Math.cos(pa) * w * 0.9, Math.sin(pa) * w * 0.9, w * 0.55, 0, Math.PI * 2);
        }
      } else {
        ctx.moveTo(-len * 0.55, 0);
        ctx.bezierCurveTo(-len * 0.2, -w, len * 0.24, -w * 0.7, len * 0.6, 0);
        ctx.bezierCurveTo(len * 0.15, w * 0.8, -len * 0.28, w, -len * 0.55, 0);
      }
      ctx.fill();
      if (form !== 'petal') {
        ctx.strokeStyle = '#cee09a55';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-len * 0.4, 0);
        ctx.lineTo(len * 0.45, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}
const barkCanvas = document.createElement('canvas');
barkCanvas.width = 512;
barkCanvas.height = 1024;
const bc = barkCanvas.getContext('2d'),
  br = mulberry32(911);
bc.fillStyle = '#73775b';
bc.fillRect(0, 0, 512, 1024);
for (let j = 0; j < 150; j++) {
  const x = br() * 512,
    phase = br() * Math.PI * 2,
    width = 2 + br() * 14;
  for (const wrap of [-512, 0, 512]) {
    bc.strokeStyle = ['#4f5b43', '#8d906a', '#656c50', '#a2a07b', '#596347'][j % 5];
    bc.lineWidth = width;
    bc.beginPath();
    for (let y = -16; y <= 1040; y += 16) {
      const xx =
        x +
        wrap +
        Math.sin((y / 1024) * Math.PI * 4 + phase) * 8 +
        Math.sin((y / 1024) * Math.PI * 10 + phase) * 3;
      y === -16 ? bc.moveTo(xx, y) : bc.lineTo(xx, y);
    }
    bc.stroke();
    bc.strokeStyle = '#b0ac8060';
    bc.lineWidth = 0.9;
    bc.stroke();
  }
}
bc.globalAlpha = 0.42;
bc.fillStyle = '#92947a';
bc.fillRect(0, 0, 512, 1024);
bc.globalAlpha = 1;
const barkMap = new THREE.CanvasTexture(barkCanvas);
barkMap.colorSpace = THREE.SRGBColorSpace;
barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
const barkRelief = new THREE.CanvasTexture(barkCanvas);
barkRelief.wrapS = barkRelief.wrapT = THREE.RepeatWrapping;
// Detail levels never switch, and nothing dithers: a screen-space dissolve
// between two crowns of different shape reads as a stripe of grain. The distant
// crown is every KEEP-th card of the full crown, enlarged, so over a band of
// camera distance the full crown morphs into it: kept cards grow, the rest
// shrink to nothing, and at the band's end the two are pixel-identical, so
// the swap is invisible. Before the streamed ring ends, every tree shrinks into
// its base, because the fog is still thin there and a dissolve would show.
const CROWN_FADE = [540, 680],
  RING_FADE = [1680, 1850];
// Each vertex reads its own instance base, so a whole tree shares one distance.
const treeBase = attribute('base', 'vec3');
const baseDistance = length(treeBase.sub(cameraPosition));
const crownBand = smoothstep(CROWN_FADE[0], CROWN_FADE[1], baseDistance);
const distantCrown = step(CROWN_FADE[1], baseDistance);
const ringScale = float(1).sub(smoothstep(RING_FADE[0], RING_FADE[1], baseDistance));
const grown = (position) => treeBase.add(position.sub(treeBase).mul(ringScale));
const sway = vec3(
  sin(time.mul(0.8).add(positionWorld.x.mul(0.05))).mul(attribute('position', 'vec3').y.mul(0.018)),
  0,
  0,
);
const barkSample = paintedSample(barkMap);
function woodMaterial(tint) {
  const m = litMaterial(vec4(barkSample.rgb.mul(uniform(tint)), barkSample.a));
  m.bumpMap = barkRelief;
  m.bumpScale = 0.015;
  m.positionNode = grown(positionLocal);
  return m;
}
function leafMaterial(map, visible, position) {
  const m = litMaterial(paintedSample(map), {
    basic: { side: THREE.DoubleSide, alphaTest: 0.04, alphaToCoverage: true },
  });
  m.normalNode = transformNormalToView(normalLocal);
  m.emissiveNode = texture(map).rgb.mul(0.025);
  m.opacityNode = visible;
  m.positionNode = grown(position.add(sway));
  return m;
}
// The full crown scales each card about its own center. Instancing has already
// moved the vertex, so the instance spin (cos, sin, xz scale, y scale) rebuilds
// the card center in world space from its tree-local one.
const spin = attribute('spin', 'vec4'),
  card = attribute('card', 'vec4'),
  cardCenter = card.xyz,
  cardKept = card.w;
const cardScaled = vec3(cardCenter.x.mul(spin.z), cardCenter.y.mul(spin.w), cardCenter.z.mul(spin.z));
const cardWorld = treeBase.add(
  vec3(
    cardScaled.x.mul(spin.x).add(cardScaled.z.mul(spin.y)),
    cardScaled.y,
    cardScaled.z.mul(spin.x).sub(cardScaled.x.mul(spin.y)),
  ),
);
const MAX_TREES = 4000;
// Bake one species: a trunk, its limbs, and a crown of painted cards. The
// distant crown is the kept cards enlarged, so it must be built from the same
// card list. Instance whole trees rather than upload 175 matrices per tree.
function bakeSpecies(id, spec) {
  const r = mulberry32(9702 + [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7));
  const woodParts = [],
    crownParts = [],
    distantParts = [];
  // The tree kit. A species grows through it: branch() lays wood, card()
  // hangs a painted card. Any generator that only does those two things keeps
  // the crown morph, the ring shrink and the tint rules for free.
  function branch(a, b, r1, r2) {
    const len = a.distanceTo(b),
      curve = new THREE.CatmullRomCurve3([
        a,
        a
          .clone()
          .lerp(b, 0.3)
          .add(new THREE.Vector3(-r1 * 0.3, len * 0.13, r1 * 0.4)),
        a.clone().lerp(b, 0.72),
        b,
      ]);
    const g = new THREE.TubeGeometry(curve, 4, 1, 6, false),
      p = g.attributes.position;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4,
        center = curve.getPointAt(t),
        radius = THREE.MathUtils.lerp(r1, r2, t);
      for (let j = 0; j <= 6; j++) {
        const k = i * 7 + j;
        p.setXYZ(
          k,
          center.x + (p.getX(k) - center.x) * radius,
          center.y + (p.getY(k) - center.y) * radius,
          center.z + (p.getZ(k) - center.z) * radius,
        );
        g.attributes.uv.setXY(k, j / 3, (t * len) / 6);
      }
    }
    g.computeVertexNormals();
    woodParts.push({ geometry: g });
    return curve;
  }
  const cards = [];
  const addCard = (p, normal, rotation, size) =>
    cards.push({
      p,
      normal,
      size,
      matrix: rotation.isMatrix4 ? rotation : M(p.x, p.y, p.z, 1, 1, 1, rotation.x, rotation.y, rotation.z),
    });
  const { trunk: T, limbs: Lb } = spec,
    K = spec.crown ?? { shape: 'custom' };
  if (spec.bake) spec.bake({ THREE, random: r, branch, card: addCard, matrix: M, spec });
  else growTree();
  function growTree() {
  const trunk = branch(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(T.lean, T.height, -T.lean * 0.25),
    T.radius,
    T.radius * (K.shape === 'cone' ? 0.12 : 0.33),
  );
  // limbs leave the trunk in a spiral; dome crowns hang a cloud of cards on each tip
  for (let j = 0; j < Lb.count; j++) {
    const a = j * 2.39996 + r() * 0.4,
      radius = Lb.spread * (0.85 + r() * 0.3);
    const tip = new THREE.Vector3(Math.cos(a) * radius, Lb.rise * (0.9 + r() * 0.25), Math.sin(a) * radius);
    branch(trunk.getPointAt(Math.min(0.95, Lb.from + j * 0.08)), tip, T.radius * 0.33, T.radius * 0.095);
    if (K.shape !== 'dome') continue;
    for (let k = 0; k < K.cards; k++) {
      const u = r() * Math.PI * 2,
        v = Math.acos(2 * r() - 1),
        rr = Math.pow(r(), 0.35);
      const p = new THREE.Vector3(
        tip.x + Math.cos(u) * Math.sin(v) * rr * K.radius,
        tip.y + Math.cos(v) * rr * K.height,
        tip.z + Math.sin(u) * Math.sin(v) * rr * K.radius,
      );
      addCard(
        p,
        new THREE.Vector3((p.x - tip.x) / K.radius, (p.y - tip.y) / K.height + 0.35, (p.z - tip.z) / K.radius).normalize(),
        new THREE.Euler((r() - 0.5) * 2.1, r() * Math.PI * 2, (r() - 0.5) * 0.7),
        K.size + r() * K.size * 0.5,
      );
    }
  }
  if (K.shape === 'cone') {
    // cards along the trunk in a cone that narrows toward the top
    for (let k = 0; k < K.cards; k++) {
      const t = K.from + (1 - K.from) * Math.pow(k / K.cards, 0.85),
        a = k * 2.39996,
        width = K.radius * Math.pow(1 - t, 0.75) * (0.55 + r() * 0.55);
      const center = trunk.getPointAt(Math.min(1, t)),
        p = new THREE.Vector3(center.x + Math.cos(a) * width, center.y + (r() - 0.3) * 0.8, center.z + Math.sin(a) * width);
      addCard(
        p,
        new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize(),
        new THREE.Euler(-0.5 + (r() - 0.5) * 0.9, -a + Math.PI / 2 + (r() - 0.5) * 0.5, (r() - 0.5) * 0.4),
        K.size * (0.7 + 0.45 * (1 - t)) + r() * 0.6,
      );
    }
  } else if (K.shape === 'fan') {
    // a ring of fronds from the top of the trunk, each painted from the
    // card's foot upward, so the card's own up axis is laid along the frond:
    // outward, drooping, its face turned to the sky
    const top = trunk.getPointAt(1);
    for (let k = 0; k < K.cards; k++) {
      const a = (k / K.cards) * Math.PI * 2 + r() * 0.3,
        droop = 0.15 + r() * 0.55,
        size = K.size * (0.85 + r() * 0.3);
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
        right = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)),
        frond = out
          .clone()
          .multiplyScalar(Math.cos(droop))
          .setY(-Math.sin(droop)),
        face = new THREE.Vector3().crossVectors(frond, right).normalize();
      if (face.y < 0) face.negate();
      const p = top.clone().addScaledVector(frond, size * 0.5 - 0.4).add(new THREE.Vector3(0, K.height * 0.3, 0));
      const basis = new THREE.Matrix4().makeBasis(right, frond, face).setPosition(p);
      addCard(p, face, basis, size);
    }
  }
  }
  if (cards.length > BUDGET.crownCards)
    throw new Error(`scenery library: species ${id}: ${cards.length} cards, the crown budget is ${BUDGET.crownCards}`);
  const keepEvery = Math.max(1, Math.round(cards.length / 35)),
    distantScale = 1 + 0.85 * ((keepEvery - 1) / 4);
  cards.forEach((c, k) => {
    const kept = k % keepEvery === 0;
    for (const [parts, factor] of [[crownParts, 1], ...(kept ? [[distantParts, distantScale]] : [])]) {
      const g = new THREE.PlaneGeometry(c.size * factor, c.size * factor);
      g.applyMatrix4(c.matrix);
      for (let i = 0; i < g.attributes.normal.count; i++)
        g.attributes.normal.setXYZ(i, c.normal.x, c.normal.y, c.normal.z);
      parts.push(parts === crownParts ? { geometry: g, card: { center: c.p, kept } } : { geometry: g });
    }
  });
  const woodGeo = mergeParts(woodParts),
    crownGeo = cards.length ? mergeParts(crownParts) : null,
    distantGeo = cards.length ? mergeParts(distantParts) : null;
  for (const part of [...woodParts, ...crownParts, ...distantParts]) part.geometry.dispose();
  (crownGeo ?? woodGeo).computeBoundingBox();
  const map = cards.length ? leafTexture(LEAVES[spec.leaf] ?? LEAVES.broad) : null;
  const wood = new THREE.InstancedMesh(woodGeo, woodMaterial(libraryColor(`species ${id}.trunk.tint`, spec.trunk.tint)), MAX_TREES);
  const meshes = [wood];
  const pool = { id, spec, wood, crown: null, distant: null, map, count: 0, near: 0, far: 0 };
  pool.top = (crownGeo ?? woodGeo).boundingBox.max.y;
  {
    // clearance from the baked shape itself, so any generator is honest
    const box = (crownGeo ?? woodGeo).boundingBox;
    pool.radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) + 2;
  }
  if (crownGeo) {
    const cardScale = mix(float(1).sub(crownBand), mix(1, distantScale, crownBand), cardKept);
    pool.crown = new THREE.InstancedMesh(
      crownGeo,
      leafMaterial(map, float(1).sub(distantCrown), cardWorld.add(positionLocal.sub(cardWorld).mul(cardScale))),
      MAX_TREES,
    );
    pool.distant = new THREE.InstancedMesh(distantGeo, leafMaterial(map, distantCrown, positionLocal), MAX_TREES);
    // The full crown also reads the instance spin, interleaved with the base
    // so the two share one vertex buffer: WebGPU allows eight per material.
    const leafInstance = new THREE.InstancedInterleavedBuffer(new Float32Array(MAX_TREES * 7), 7, 1);
    leafInstance.setUsage(THREE.DynamicDrawUsage);
    pool.crown.geometry.setAttribute('base', new THREE.InterleavedBufferAttribute(leafInstance, 3, 0));
    pool.spin = new THREE.InterleavedBufferAttribute(leafInstance, 4, 3);
    pool.crown.geometry.setAttribute('spin', pool.spin);
    meshes.push(pool.crown, pool.distant);
    pool.crown.castShadow = true;
  }
  for (const mesh of meshes) {
    if (mesh !== pool.crown) {
      const base = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
      base.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('base', base);
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    scene.add(mesh);
  }
  wood.castShadow = true;
  pool.meshes = meshes;
  pool.tint = {
    cold: libraryColor(`species ${id}.tint.cold`, spec.tint.cold),
    warm: libraryColor(`species ${id}.tint.warm`, spec.tint.warm),
    dry: libraryColor(`species ${id}.tint.dry`, spec.tint.dry),
  };
  return pool;
}
const speciesPools = {};
for (const [id, spec] of Object.entries(SPECIES)) speciesPools[id] = bakeSpecies(id, spec);
const speciesIds = Object.keys(speciesPools);
const treeRecords = [];
const TREE_CELL = 96,
  TREE_RADIUS = 1900;
// Crown assignment margins: a ring rebuild happens at most one cell after the
// bird crosses a cell, and the camera orbits at most CAMERA.maxDist from it.
const NEAR_CROWN = 830,
  FAR_CROWN = 400;
// Props: any object the library places in the world. Each kind bakes one
// geometry through the prop kit, is measured against its budget, and gets an
// instanced pool that shrinks into the ground at the ring's edge like a tree.
const propKit = {
  THREE,
  random: (name) => mulberry32(hash2(0x9e37, 0, [...String(name)].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 5))),
  merge: mergeParts,
  matrix: M,
  sstep,
  color: (value) => libraryColor('prop color', value),
};
const propMat = propMaterial();
propMat.positionNode = grown(positionLocal);
function makePool(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  const base = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  base.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('base', base);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}
const propPools = PROPS.map((entry) => {
  const geometry = entry.bake(propKit);
  const errors = validateBaked(entry, geometry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
  const capacity = Math.min(BUDGET.propInstances, entry.budget?.instances ?? 500);
  return { entry, mesh: makePool(geometry, propMat, capacity), capacity, count: 0 };
});
const propRecords = [];
// A bounded, streamed ambient-occlusion sheet anchors trunks beyond the sun map.
const aoCanvas = document.createElement('canvas');
aoCanvas.width = aoCanvas.height = 512;
const aoContext = aoCanvas.getContext('2d'),
  aoMap = new THREE.CanvasTexture(aoCanvas);
// The sheet is painted in world order, so it must upload unflipped: a
// flipped upload mirrors every shade in z, and the mirrored shades then
// jump two cells whenever the sheet re-centers.
aoMap.flipY = false;
const aoOrigin = uniform(new THREE.Vector2()),
  AO_SPAN = 4096;
const aoUV = positionWorld.xz.sub(aoOrigin).div(AO_SPAN).add(0.5);
const aoEdge = max(abs(aoUV.x.sub(0.5)), abs(aoUV.y.sub(0.5)));
terrainMat.aoNode = mix(texture(aoMap, aoUV).r, 1, smoothstep(0.45, 0.5, aoEdge));
function updateGroundAO(x, z) {
  aoOrigin.value.set(x, z);
  aoContext.fillStyle = '#fff';
  aoContext.fillRect(0, 0, 512, 512);
  for (const tree of treeRecords) {
    const px = ((tree.x - x) / AO_SPAN + 0.5) * 512,
      pz = ((tree.z - z) / AO_SPAN + 0.5) * 512,
      r = ((tree.radius * 0.6) / AO_SPAN) * 512;
    const gradient = aoContext.createRadialGradient(px, pz, 0, px, pz, r);
    gradient.addColorStop(0, '#0006');
    gradient.addColorStop(0.3, '#0004');
    gradient.addColorStop(1, '#0000');
    aoContext.fillStyle = gradient;
    aoContext.fillRect(px - r, pz - r, r * 2, r * 2);
  }
  aoMap.needsUpdate = true;
}
let treeCellX = 1e9,
  treeCellZ = 1e9;
const _m4 = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _v3 = new THREE.Vector3(),
  _s3 = new THREE.Vector3(),
  _zero = new THREE.Vector3(),
  _col = new THREE.Color(),
  _col2 = new THREE.Color();
const _weights = new Float32Array(BIOMES.length),
  _mix = new Float32Array(speciesIds.length);
// What a climate wants: the biome weights folded over the library.
function placeTrees(bx, bz) {
  const cx = Math.floor(bx / TREE_CELL),
    cz = Math.floor(bz / TREE_CELL);
  if (cx === treeCellX && cz === treeCellZ) return;
  treeCellX = cx;
  treeCellZ = cz;
  const r = Math.ceil(TREE_RADIUS / TREE_CELL);
  let n = 0;
  treeRecords.length = 0;
  propRecords.length = 0;
  for (const pool of Object.values(speciesPools)) pool.count = pool.near = pool.far = 0;
  for (const pool of propPools) pool.count = 0;
  // What a prop's place() may ask about a cell: its climate, the ground, and
  // a random stream of its own, so props never reshuffle the trees.
  const cell = {
    size: TREE_CELL,
    corner: { x: 0, z: 0 },
    x: 0,
    z: 0,
    weights: _weights,
    biome: (id) => _weights[BIOMES.findIndex((biome) => biome.id === id)] ?? 0,
    mix(id) {
      let sum = 0;
      for (let i = 0; i < BIOMES.length; i++) sum += _weights[i] * (BIOMES[i].props?.[id] ?? 0);
      return sum;
    },
    blend(pick) {
      _col2.setRGB(0, 0, 0);
      for (let i = 0; i < BIOMES.length; i++) {
        const c = biomeColors[i][pick(BIOMES[i]) === BIOMES[i].ground.rock ? 'rock' : 'base'];
        _col2.r += _weights[i] * c.r;
        _col2.g += _weights[i] * c.g;
        _col2.b += _weights[i] * c.b;
      }
      return _col2;
    },
    roll: null,
    height: heightAt,
    slope: slopeAt,
    land: (x, z) => heightAt(x, z) > 3,
  };
  for (let gz = cz - r; gz <= cz + r && n < MAX_TREES; gz++)
    for (let gx = cx - r; gx <= cx + r && n < MAX_TREES; gx++) {
      const ccx = (gx + 0.5) * TREE_CELL,
        ccz = (gz + 0.5) * TREE_CELL;
      if (Math.hypot(ccx - bx, ccz - bz) > TREE_RADIUS) continue;
      const h0 = heightAt(ccx, ccz);
      if (h0 < 3) continue;
      const temp = fieldAt(ccx, ccz, 1),
        moist = fieldAt(ccx, ccz, 2);
      biomeAt(ccx, ccz, _weights);
      let density = 0,
        mixTotal = 0;
      _mix.fill(0);
      for (let i = 0; i < BIOMES.length; i++) {
        const w = _weights[i],
          biome = BIOMES[i];
        density += w * biome.density;
        for (const [id, weight] of Object.entries(biome.species)) {
          _mix[speciesIds.indexOf(id)] += w * weight;
          mixTotal += w * weight;
        }
      }
      let s = hash2(gx, gz, seed);
      const roll = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      // every prop kind gets its own stream from this cell
      cell.corner.x = gx * TREE_CELL;
      cell.corner.z = gz * TREE_CELL;
      cell.x = ccx;
      cell.z = ccz;
      for (const pool of propPools) {
        const stream = mulberry32(hash2(gx, gz, seed ^ hash2(pool.entry.id.length, 7, 0x51)));
        cell.roll = stream;
        for (const put of pool.entry.place(cell, propKit) ?? []) {
          if (pool.count >= pool.capacity) break;
          const h = heightAt(put.x, put.z),
            scale = Array.isArray(put.scale) ? put.scale : [put.scale ?? 1, put.scale ?? 1, put.scale ?? 1];
          _q.setFromAxisAngle(_v3.set(0, 1, 0), put.yaw ?? 0);
          _m4.compose(_v3.set(put.x, h - (put.sink ?? 0), put.z), _q, _s3.set(scale[0], scale[1], scale[2]));
          pool.mesh.setMatrixAt(pool.count, _m4);
          pool.mesh.geometry.attributes.base.setXYZ(pool.count, put.x, h, put.z);
          pool.mesh.setColorAt(pool.count++, put.tint ?? _col.setRGB(1, 1, 1));
          const obstacle = pool.entry.obstacle;
          if (obstacle)
            propRecords.push({
              x: put.x,
              z: put.z,
              ground: h,
              top: h - (put.sink ?? 0) + obstacle.height * scale[1],
              radius: obstacle.radius * Math.max(scale[0], scale[2]),
              kind: pool.entry.id,
            });
        }
      }
      const treeline = 470 + temp * 260;
      const grove = 2 + 4 * sstep(-0.25, 0.3, perlin2(ccx / 370, ccz / 370, seed ^ 0xc071));
      // This density cap keeps the entire ring inside its fixed allocation.
      const count = Math.min(
        3,
        Math.floor(density * grove * (1 - sstep(treeline - 120, treeline, h0))),
      );
      if (count <= 0 || mixTotal <= 0) continue;
      for (let k = 0; k < count && n < MAX_TREES; k++) {
        const ux = roll(),
          uz = roll(),
          us = roll(),
          pick = roll() * mixTotal;
        const px = (gx + ux) * TREE_CELL,
          pz = (gz + uz) * TREE_CELL;
        const h = heightAt(px, pz);
        if (h < 4 || slopeAt(px, pz) > 0.6) continue;
        let chosen = -1,
          acc = 0;
        for (let i = 0; i < _mix.length; i++) {
          if (_mix[i] <= 0) continue;
          acc += _mix[i];
          chosen = i;
          if (pick <= acc) break;
        }
        const pool = speciesPools[speciesIds[chosen]],
          spec = pool.spec;
        const sc = spec.scale[0] + us * (spec.scale[1] - spec.scale[0]),
          tall = sc * (0.9 + uz * 0.4),
          angle = ux * 6.283;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), angle);
        _m4.compose(_v3.set(px, h, pz), _q, _s3.set(sc, tall, sc));
        pool.wood.setMatrixAt(pool.count, _m4);
        pool.wood.geometry.attributes.base.setXYZ(pool.count, px, h, pz);
        _col
          .copy(pool.tint.cold)
          .lerp(pool.tint.warm, sstep(0.3, 0.7, temp))
          .lerp(pool.tint.dry, sstep(0.45, 0.25, moist));
        pool.wood.setColorAt(pool.count++, _col);
        // Both crowns exist through the dissolve band, so a rebuild never changes what is drawn.
        const distance = Math.hypot(px - bx, pz - bz);
        if (pool.crown) {
          if (distance < NEAR_CROWN) {
            pool.crown.setMatrixAt(pool.near, _m4);
            pool.crown.geometry.attributes.base.setXYZ(pool.near, px, h, pz);
            pool.spin.setXYZW(pool.near, Math.cos(angle), Math.sin(angle), sc, tall);
            pool.crown.setColorAt(pool.near++, _col);
          }
          if (distance > FAR_CROWN) {
            pool.distant.setMatrixAt(pool.far, _m4);
            pool.distant.geometry.attributes.base.setXYZ(pool.far, px, h, pz);
            pool.distant.setColorAt(pool.far++, _col);
          }
        }
        treeRecords.push({
          x: px,
          z: pz,
          ground: h,
          top: h + pool.top * tall,
          radius: sc * pool.radius,
          species: pool.id,
        });
        n++;
      }
    }
  for (const pool of Object.values(speciesPools)) {
    pool.wood.count = pool.count;
    if (pool.crown) {
      pool.crown.count = pool.near;
      pool.distant.count = pool.far;
    }
    for (const mesh of pool.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.base.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  for (const pool of propPools) {
    pool.mesh.count = pool.count;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.geometry.attributes.base.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }
  updateGroundAO(cx * TREE_CELL, cz * TREE_CELL);
  placeRuins(bx, bz);
}

// ---------------------------------------------------------------------------
// Local grass uses the same quiet texture contrast and upward lighting as
// the approved close study. Placement does not depend on blade detail. Each
// biome tints the blades and says how thick they grow.
const grassCanvas = document.createElement('canvas');
grassCanvas.width = 256;
grassCanvas.height = 256;
const gc = grassCanvas.getContext('2d'),
  gr = mulberry32(614);
for (let i = 0; i < 96; i++) {
  const x = 6 + gr() * 244,
    h = 55 + gr() * 180,
    bend = (gr() - 0.5) * 60,
    width = 1.5 + gr() * 3;
  gc.fillStyle = ['#638c37', '#7ca448', '#8cae50', '#a2bb61'][i % 4];
  gc.beginPath();
  gc.moveTo(x - width, 256);
  gc.quadraticCurveTo(x - width * 0.5, 256 - h * 0.65, x + bend, 256 - h);
  gc.quadraticCurveTo(x + width * 0.6, 256 - h * 0.4, x + width, 256);
  gc.fill();
}
const grassMap = new THREE.CanvasTexture(grassCanvas);
grassMap.colorSpace = THREE.SRGBColorSpace;
grassMap.anisotropy = 4;
const grassMat = litMaterial(paintedSample(grassMap), {
  basic: { side: THREE.DoubleSide, alphaTest: 0.08, alphaToCoverage: true },
});
grassMat.normalNode = transformNormalToView(vec3(0, 1, 0));
grassMat.aoNode = mix(terrainMat.aoNode, 1, attribute('uv', 'vec2').y);
grassMat.opacityNode = float(1).sub(smoothstep(120, 190, length(positionWorld.sub(cameraPosition))));
grassMat.positionNode = positionLocal.add(
  vec3(
    sin(time.mul(1.4).add(positionWorld.x.mul(0.08)))
      .mul(attribute('position', 'vec3').y.pow(2))
      .mul(0.16),
    0,
    0,
  ),
);
const grassGeo = new THREE.PlaneGeometry(2.6, 1);
grassGeo.translate(0, 0.5, 0);
const grass = new THREE.InstancedMesh(grassGeo, grassMat, 20000);
grass.count = 0;
grass.frustumCulled = false;
grass.receiveShadow = true;
grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(grass);
const grassTints = BIOMES.map((biome) => libraryColor(`biome ${biome.id}.grass.tint`, biome.grass.tint));
let grassX = NaN,
  grassZ = NaN;
function placeGrass(x, z) {
  grass.visible = camera.position.y - heightAt(x, z) < 250;
  if (!grass.visible) return;
  const ix = Math.floor(x / CELL),
    iz = Math.floor(z / CELL);
  if (ix === grassX && iz === grassZ) return;
  grassX = ix;
  grassZ = iz;
  const cx = Math.floor(x / 64),
    cz = Math.floor(z / 64);
  let count = 0;
  for (let tz = cz - 5; tz <= cz + 5; tz++)
    for (let tx = cx - 5; tx <= cx + 5; tx++) {
      if (Math.hypot((tx + 0.5) * 64 - x, (tz + 0.5) * 64 - z) > 260) continue;
      biomeAt((tx + 0.5) * 64, (tz + 0.5) * 64, _weights);
      let thickness = 0;
      _col.setRGB(0, 0, 0);
      for (let i = 0; i < BIOMES.length; i++) {
        thickness += _weights[i] * BIOMES[i].grass.density;
        _col.r += _weights[i] * grassTints[i].r;
        _col.g += _weights[i] * grassTints[i].g;
        _col.b += _weights[i] * grassTints[i].b;
      }
      const r = mulberry32(hash2(tx, tz, seed ^ 0x6a455));
      for (let i = 0; i < 256 && count < grass.instanceMatrix.count; i++) {
        const px = (tx + r()) * 64,
          pz = (tz + r()) * 64,
          scale = 0.55 + r() * 0.8,
          angle = r() * Math.PI,
          keep = r() < thickness;
        const h = heightAt(px, pz);
        if (!keep || h < 2 || h > 480 || slopeAt(px, pz) > 0.65) continue;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), angle);
        _m4.compose(_v3.set(px, h, pz), _q, _s3.setScalar(scale));
        grass.setMatrixAt(count, _m4);
        grass.setColorAt(count++, _col);
      }
    }
  grass.count = count;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Ruins of one lost civilization. Rare sites of the same weathered masonry,
// found on a sparse grid, sunk and tilted by their age, mossy at the foot.
// Rings and gates face the sunrise. Nothing announces them.
// ---------------------------------------------------------------------------
const STONE = {
  warm: C(SWATCH.stoneWarm),
  cool: C(SWATCH.stoneCool),
  dark: C(SWATCH.stoneDark),
  moss: C(SWATCH.moss),
};
// The masonry kit every ruin type is built from: tapered pillars, blocks
// and slabs, each a little worn, sunk and leaning. Builders only compose it.
function masonryKit(parts, r) {
  const tone = () => C(0).copy(STONE.warm).lerp(STONE.cool, r()).lerp(STONE.dark, r() * 0.35);
  const taper = (g, amount) => {
    const p = g.attributes.position;
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - min.y) / Math.max(0.001, max.y - min.y);
      p.setX(i, p.getX(i) * (1 - amount * t));
      p.setZ(i, p.getZ(i) * (1 - amount * t));
    }
    g.computeVertexNormals();
    return g;
  };
  const place = (g, x, y, z, yaw = 0, tilt = 0, roll = 0) =>
    parts.push({ geometry: g, matrix: M(x, y, z, 1, 1, 1, tilt, yaw, roll), color: tone() });
  return {
    THREE,
    random: r,
    color: (value) => libraryColor('ruin color', value),
    raw(g, x, y, z, yaw = 0, tilt = 0, roll = 0) {
      place(g, x, y, z, yaw, tilt, roll);
    },
    block(x, y, z, w, h, d, yaw = 0, wear = 0.05) {
      place(taper(new THREE.BoxGeometry(w, h, d), wear), x, y, z, yaw, (r() - 0.5) * wear, (r() - 0.5) * wear);
    },
    pillar(x, z, height, radius, lean = 0.03, broken = false) {
      const h = broken ? height * (0.25 + r() * 0.35) : height;
      const g = new THREE.CylinderGeometry(radius * 0.72, radius, h, 7, 1);
      g.translate(0, h / 2 - 0.4, 0);
      place(g, x, 0, z, r() * 6.283, (r() - 0.5) * lean, (r() - 0.5) * lean);
      if (!broken) {
        const cap = new THREE.BoxGeometry(radius * 2.2, radius * 0.55, radius * 2.2);
        cap.translate(0, h - 0.4 + radius * 0.27, 0);
        place(cap, x, 0, z, 0, 0, 0);
      }
    },
    fallen(x, z, length, radius) {
      const g = new THREE.CylinderGeometry(radius * 0.72, radius, length, 7, 1);
      g.translate(0, length / 2, 0);
      place(g, x, radius * 0.6, z, r() * 6.283, Math.PI / 2 - 0.05 + r() * 0.1, 0);
    },
    standing(x, z, height, width, depth, yaw) {
      const g = taper(new THREE.BoxGeometry(width, height, depth), 0.25);
      g.translate(0, height / 2 - 0.5, 0);
      place(g, x, 0, z, yaw, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12);
    },
  };
}
function bakeRuin(type) {
  const parts = [],
    r = mulberry32(0x5e77 + type.id.length * 977 + type.id.charCodeAt(0));
  const kit = masonryKit(parts, r);
  type.build(kit);
  const geometry = mergeParts(parts);
  for (const part of parts) part.geometry.dispose();
  const errors = validateBaked(type, geometry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
  // moss climbs the lowest stones
  const positions = geometry.attributes.position,
    colors = geometry.attributes.color;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    _col.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    _col.lerp(STONE.moss, sstep(1.6, -0.3, y) * 0.55);
    colors.setXYZ(i, _col.r, _col.g, _col.b);
  }
  geometry.computeBoundingBox();
  return geometry;
}
const SITES_PER_TYPE = BUDGET.siteInstances;
const ruinMat = propMaterial();
ruinMat.positionNode = grown(positionLocal);
const ruinPools = RUINS.map((type) => {
  const geometry = bakeRuin(type);
  const mesh = new THREE.InstancedMesh(geometry, ruinMat, SITES_PER_TYPE);
  const base = new THREE.InstancedBufferAttribute(new Float32Array(SITES_PER_TYPE * 3), 3);
  base.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('base', base);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  return { type, mesh, height: geometry.boundingBox.max.y, count: 0 };
});
const ruinRecords = [];
// Sites are found, not scattered: a sparse grid of cells, each with a small
// chance of holding one, and the site must fit its ground. The same cell
// always holds the same site, so a place seen once is there when you return.
function placeRuins(bx, bz) {
  ruinRecords.length = 0;
  for (const pool of ruinPools) pool.count = 0;
  const reach = TREE_RADIUS + SITE_CELL,
    oddsTotal = RUINS.reduce((sum, type) => sum + type.odds, 0);
  const c0x = Math.floor((bx - reach) / SITE_CELL),
    c1x = Math.floor((bx + reach) / SITE_CELL),
    c0z = Math.floor((bz - reach) / SITE_CELL),
    c1z = Math.floor((bz + reach) / SITE_CELL);
  for (let gz = c0z; gz <= c1z; gz++)
    for (let gx = c0x; gx <= c1x; gx++) {
      const r = mulberry32(hash2(gx, gz, seed ^ 0x2a11));
      const ccx = (gx + 0.5) * SITE_CELL,
        ccz = (gz + 0.5) * SITE_CELL;
      if (Math.hypot(ccx - bx, ccz - bz) > TREE_RADIUS + SITE_CELL * 0.7) continue;
      // the biome's welcome, read at the cell center, scales the odds
      biomeAt(ccx, ccz, _weights);
      let welcome = 0;
      for (let i = 0; i < BIOMES.length; i++) welcome += _weights[i] * BIOMES[i].ruins;
      if (r() > SITE_ODDS * welcome) continue;
      let pick = r() * oddsTotal,
        pool = ruinPools[0];
      for (const candidate of ruinPools) {
        pick -= candidate.type.odds;
        if (pick <= 0) {
          pool = candidate;
          break;
        }
      }
      if (pool.count >= SITES_PER_TYPE) continue;
      const type = pool.type;
      const scale = 0.85 + r() * 0.4,
        yaw = type.sunward ? SUNRISE_AZIMUTH + (r() - 0.5) * 0.2 : r() * 6.283,
        sink = 0.3 + r() * 0.9;
      for (let attempt = 0; attempt < 4; attempt++) {
        const px = (gx + 0.2 + r() * 0.6) * SITE_CELL,
          pz = (gz + 0.2 + r() * 0.6) * SITE_CELL;
        const h = heightAt(px, pz);
        if (h < 8 || slopeAt(px, pz) > type.slope) continue;
        // a hill site stands on a local top; a flat site on ground that stays level
        let fits = true;
        for (let k = 0; k < 8 && fits; k++) {
          const a = (k / 8) * Math.PI * 2,
            around = heightAt(px + Math.cos(a) * 90, pz + Math.sin(a) * 90);
          fits = type.hill ? around <= h + 3 : Math.abs(around - h) < 12;
        }
        if (!fits) continue;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), yaw);
        _m4.compose(_v3.set(px, h - sink, pz), _q, _s3.setScalar(scale));
        pool.mesh.setMatrixAt(pool.count, _m4);
        pool.mesh.geometry.attributes.base.setXYZ(pool.count++, px, h, pz);
        ruinRecords.push({
          x: px,
          z: pz,
          ground: h,
          top: h - sink + pool.height * scale,
          radius: type.footprint * scale,
          type: type.id,
        });
        break;
      }
    }
  for (const pool of ruinPools) {
    pool.mesh.count = pool.count;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.geometry.attributes.base.needsUpdate = true;
  }
}

// Clouds: painted sky below; soft volumes as the bird approaches the deck.
// ---------------------------------------------------------------------------
const puffParts = [];
{
  const r = mulberry32(seed ^ 0x51ed);
  for (let i = 0; i < 7; i++) {
    const s = 0.55 + r() * 0.75;
    puffParts.push({
      geometry: new THREE.SphereGeometry(1, 20, 12),
      matrix: M((r() - 0.5) * 2.6, (r() - 0.5) * 0.7, (r() - 0.5) * 1.6, s * 1.25, s * 0.7, s),
      color: 0xffffff,
    });
  }
}
const puffGeo = mergeParts(puffParts);
const cloudMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
cloudMat.colorNode = mix(
  uHorizon,
  uCloudWhite,
  smoothstep(-0.7, 0.8, normalLocal.y).mul(0.7).add(0.15),
);
cloudMat.opacityNode = pow(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))), 0.7)
  .mul(0.8)
  .mul(uCloudBodies)
  .mul(float(1).sub(smoothstep(2300, 2900, length(positionWorld.sub(cameraPosition)))));
const CLOUDS = 40,
  CLOUD_FIELD = 6400;
const clouds = new THREE.InstancedMesh(puffGeo, cloudMat, CLOUDS);
clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
clouds.frustumCulled = false;
scene.add(clouds);
const cloudBase = [];
{
  const r = mulberry32(seed ^ 0xc10d);
  for (let i = 0; i < CLOUDS; i++)
    cloudBase.push({
      x: r() * CLOUD_FIELD,
      z: r() * CLOUD_FIELD,
      y: DECK_Y + (r() - 0.5) * 90,
      s: 55 + r() * 95,
      rot: r() * 6.283,
      drift: 0.6 + r() * 0.8,
    });
}
function updateClouds(bx, bz, t) {
  const cx = camera.position.x,
    cy = camera.position.y,
    cz = camera.position.z;
  for (let i = 0; i < CLOUDS; i++) {
    const c = cloudBase[i];
    let x = c.x + t * 4.0 * c.drift - bx,
      z = c.z - bz;
    x = (((x % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
    z = (((z % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
    const px = bx + x,
      pz = bz + z;
    const d = Math.hypot(px - cx, c.y - cy, pz - cz);
    const shrink = sstep(c.s * 1.6, c.s * 3.6, d);
    _q.setFromAxisAngle(_v3.set(0, 1, 0), c.rot);
    _m4.compose(_v3.set(px, c.y, pz), _q, _s3.set(c.s * shrink, c.s * 0.6 * shrink, c.s * shrink));
    clouds.setMatrixAt(i, _m4);
  }
  clouds.instanceMatrix.needsUpdate = true;
}
// cloud sea: a heaped plane just under the deck, holes from noise, seen only from above
let seaMat;
{
  // The cloud surface is atmosphere, not land inside its own height fog.
  // Paint its folds directly so the view above does not become a blank sheet.
  seaMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  seaMat.opacityNode = uAbove.mul(0.94);
  const heapAt = (p) =>
    mx_noise_float(p.mul(0.0016).add(time.mul(0.003)))
      .mul(38.0)
      .add(mx_noise_float(p.mul(0.006).sub(time.mul(0.004))).mul(14.0));
  const heap = heapAt(positionWorld.xz);
  // The tops are lit: a normal from the heap's slope turns the sunward flanks
  // to the sun, warm while it is low and warmer toward it, blushing opposite
  // it, and leaves the hollows to the sky's blue; the moon lights them at
  // night. The far sea fades into the same horizon the sky draws.
  const STEP = 10;
  const slopeX = heapAt(positionWorld.xz.add(vec2(STEP, 0))).sub(heap).div(STEP),
    slopeZ = heapAt(positionWorld.xz.add(vec2(0, STEP))).sub(heap).div(STEP);
  const n = normalize(vec3(slopeX.negate().mul(3.5), 1, slopeZ.negate().mul(3.5)));
  const view = normalize(positionWorld.sub(cameraPosition));
  const sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  const s = max(dot(view, uSunDir), 0.0).mul(sunUp);
  const align = azimuthAlign(view, uSunDir),
    anti = azimuthAlign(view, uSunDir.negate());
  const sunCol = mix(uSunColor, uGlow, uLowSun.mul(0.6));
  // the ramp follows the sun's height, so the tops stay sculpted at noon
  const lit = smoothstep(uSunDir.y.sub(0.6), uSunDir.y.add(0.3), dot(n, uSunDir)).mul(sunUp);
  const moonlit = smoothstep(uMoonDir.y.sub(0.6), uMoonDir.y.add(0.3), dot(n, uMoonDir)).mul(uMoonLight);
  const hollow = smoothstep(26, -32, heap);
  const shade = mix(uUpper.mul(0.6), uCloudWhite, 0.2).mul(float(1).sub(hollow.mul(0.3)));
  const folds = Fn(() => {
    const light = mix(uCloudWhite, sunCol, uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, uGlow, uLowSun.mul(pow(align, 1.5)).mul(0.65)));
    light.assign(mix(light, mix(light, VENUS, 0.5), uVenusI.mul(pow(anti, 1.5)).mul(0.45)));
    const tops = mix(shade, light, lit.mul(float(1).sub(hollow.mul(0.55))));
    return tops.add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  const cover = max(uWhiteout, smoothstep(2000, 4300, length(positionWorld.sub(cameraPosition))));
  seaMat.colorNode = mix(folds, horizonTint(view), cover);
  seaMat.positionNode = vec3(
    positionLocal.x,
    heap.add(sin(positionWorld.x.mul(0.006).add(time.mul(0.2))).mul(4.0)),
    positionLocal.z,
  );
}
const cloudSeaGeo = new THREE.PlaneGeometry(9000, 9000, 96, 96);
cloudSeaGeo.rotateX(-Math.PI / 2);
const cloudSea = new THREE.Mesh(cloudSeaGeo, seaMat);
cloudSea.position.y = DECK_Y - 55;
cloudSea.frustumCulled = false;
cloudSea.renderOrder = 2;
scene.add(cloudSea);

// ---------------------------------------------------------------------------
// Feathered wings articulate on three pivots with a traveling wave.
// ---------------------------------------------------------------------------
const birdMaterial = propMaterial({ basic: { side: THREE.DoubleSide } });
function makeBird(bodyColor = L.bird.body, wingColor = L.bird.wing, tipColor = L.bird.tip) {
  const g = new THREE.Group();
  const mat = birdMaterial;
  const body = mergeParts([
    {
      geometry: new THREE.SphereGeometry(0.45, 16, 10),
      matrix: M(0, 0, 0, 1.0, 0.85, 2.3),
      color: bodyColor,
    },
    {
      geometry: new THREE.SphereGeometry(0.24, 12, 8),
      matrix: M(0, 0.22, 1.05, 1, 0.95, 1.15),
      color: bodyColor,
    },
    {
      geometry: new THREE.ConeGeometry(0.09, 0.42, 4),
      matrix: M(0, 0.18, 1.42, 1, 1, 1, Math.PI / 2, 0, 0),
      color: 0xbda66a,
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      geometry: new THREE.SphereGeometry(1, 8, 5),
      matrix: M((i - 2) * 0.12, -0.03, -1.15, 0.12, 0.025, 0.6, 0, (i - 2) * 0.06, 0),
      color: tipColor,
    })),
  ]);
  g.add(new THREE.Mesh(body, mat));
  const wings = [];
  for (const s of [-1, 1]) {
    const lens = [1.3, 1.3, 1.1],
      chords = [0.65, 0.6, 0.35],
      cols = [wingColor, wingColor, tipColor];
    let parent = g,
      px = s * 0.32;
    const pivots = [];
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(px, i === 0 ? 0.12 : 0, i === 0 ? 0.08 : 0);
      const shape = new THREE.Shape();
      shape.moveTo(0, chords[i]);
      shape.quadraticCurveTo(
        s * lens[i] * 0.6,
        chords[i] * 0.95,
        s * lens[i],
        i === 2 ? -0.35 : chords[i + 1],
      );
      shape.lineTo(s * lens[i], -0.65);
      shape.lineTo(0, -0.65);
      shape.closePath();
      const membrane = new THREE.ShapeGeometry(shape, 12);
      membrane.rotateX(Math.PI / 2);
      const parts = [{ geometry: membrane, color: cols[i] }];
      if (i > 0)
        for (let j = 0; j < 5; j++)
          parts.push({
            geometry: new THREE.SphereGeometry(1, 8, 5),
            matrix: M(
              s * (0.16 + j * 0.21),
              -0.01,
              -0.57,
              0.16,
              0.025,
              0.55 - i * 0.08 - j * 0.025,
              0,
              s * (-0.2 - j * 0.05),
              0,
            ),
            color: tipColor,
          });
      const segGeo = mergeParts(parts);
      pivot.add(new THREE.Mesh(segGeo, mat));
      parent.add(pivot);
      pivots.push(pivot);
      parent = pivot;
      px = s * lens[i];
    }
    wings.push({ s, pivots });
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.wings = wings;
  g.userData.phase = Math.random() * 6.28;
  g.userData.flapAmp = 0.1;
  g.rotation.order = 'YXZ';
  return g;
}
function animateWings(bird, dt, flapping, speedMul = 1) {
  const u = bird.userData;
  const targetAmp = flapping ? 0.48 : 0.09;
  u.flapAmp += (targetAmp - u.flapAmp) * Math.min(1, dt * 3.0);
  u.phase += dt * (flapping ? 6.5 : 1.4) * speedMul;
  const rest = [0.14, -0.08, -0.05],
    seg = [1.0, 0.55, 0.45],
    lag = [0, 0.9, 1.6];
  for (const w of u.wings) {
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(u.phase - lag[i]) * u.flapAmp * seg[i] + rest[i] * (1 - u.flapAmp * 0.5);
      w.pivots[i].rotation.z = -w.s * a;
    }
  }
}
const bird = makeBird();
bird.scale.setScalar(1);
scene.add(bird);

// companions for the flock moments
const companions = [];
for (let i = 0; i < 5; i++) {
  const b = makeBird();
  b.scale.setScalar(0.8);
  b.visible = false;
  scene.add(b);
  companions.push(b);
}
const formation = [
  [-9, -1, -7],
  [9, -1.5, -7],
  [-17, 1, -14],
  [17, 0.5, -14],
  [-25, 2, -21],
];

// ---------------------------------------------------------------------------
// Sky events. While the sun or the moon crosses the horizon the bird turns to
// fly straight at it and holds that course until the sky settles, unless the
// viewer steers it away; then it is free until the next event. The crossings
// are found on the same arcs the sky draws, so they cannot drift from it.
// ---------------------------------------------------------------------------
const SKY_EVENTS = (() => {
  const sun = new THREE.Vector3(),
    moon = new THREE.Vector3();
  const height = (body, phase) => {
    skyBodies(phase, sun, moon);
    return (body === 'sun' ? sun : moon).y;
  };
  // How long before and after the crossing the pull lasts, in solar phase, the
  // sun's own clock, so it is about how high the body stands: a rising body
  // from its first glow until it stands clear, a setting one from its last
  // stretch until the afterglow fades, the moon only while its disc is low.
  const spans = {
    sun: { rising: [0.035, 0.07], setting: [0.02, 0.045] },
    moon: { rising: [0.012, 0.03], setting: [0.035, 0.004] },
  };
  const events = [];
  const steps = 720;
  for (const body of ['sun', 'moon']) {
    let previous = height(body, 0);
    for (let i = 1; i <= steps; i++) {
      const next = height(body, i / steps);
      if (previous < 0 !== next < 0) {
        let lo = (i - 1) / steps,
          hi = i / steps;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (height(body, mid) < 0 === previous < 0) lo = mid;
          else hi = mid;
        }
        const rising = next > previous;
        const [before, after] = spans[body][rising ? 'rising' : 'setting'];
        const phase = (lo + hi) / 2;
        events.push({ body, rising, phase, solar: solar(phase), before, after });
      }
      previous = next;
    }
  }
  return events.sort((a, b) => a.phase - b.phase);
})();
const SUNRISE = SKY_EVENTS.find((event) => event.body === 'sun' && event.rising);
const SUNSET = SKY_EVENTS.find((event) => event.body === 'sun' && !event.rising);
// Night, sunset to sunrise, on the same crossings the events were found on.
const NIGHT_SPAN = (((SUNRISE.phase - SUNSET.phase) % 1) + 1) % 1;
const isNight = (phase) => ((((phase - SUNSET.phase) % 1) + 1) % 1) < NIGHT_SPAN;
const SUNRISE_AZIMUTH = (() => {
  skyBodies(SUNRISE.phase, _v3, _s3);
  return Math.atan2(_v3.x, _v3.z);
})();
const SKY_FADE = 0.015; // solar phase over which a pull comes and goes
function skyEventWeight(event, phase) {
  const s = solar(phase) - event.solar;
  const d = s - Math.round(s);
  const arriving = sstep(-event.before - SKY_FADE, -event.before, d),
    leaving = sstep(event.after, event.after + SKY_FADE, d);
  return arriving * (1 - leaving);
}
const sunward = { event: null, pull: 0, heading: 0, released: false };
function updateSunward() {
  let pull = 0,
    event = null;
  for (const candidate of SKY_EVENTS) {
    const weight = skyEventWeight(candidate, dayPhase);
    if (weight > pull) {
      pull = weight;
      event = candidate;
    }
  }
  if (event !== sunward.event) sunward.released = false;
  sunward.event = event;
  sunward.pull = sunward.released ? 0 : pull;
  if (event) {
    const dir = event.body === 'sun' ? _sunDir : _moonDir;
    sunward.heading = Math.atan2(dir.x, dir.z);
  }
}
// ---------------------------------------------------------------------------
// The night's one turn. The Milky Way stands still over the world, so the
// brightest place in it, the core the sky's own bake found, keeps one bearing.
// Once night has begun, and once the sunset has let go of the bird, it turns to
// face that core at the same gentle rate a sky event turns it, and lets go as
// soon as it is facing it. It happens once a night: a single turn, not a course
// it holds. A steer ends it, and the next nightfall arms it again.
// ---------------------------------------------------------------------------
const GALAXY_HEADING = Math.atan2(galaxy.brightest.x, galaxy.brightest.z);
const NIGHTWARD = {
  aligned: 0.03, // radians of heading that count as facing the core
  fade: 1.2, // seconds the pull takes to come and go
  give: 90, // seconds after which the turn gives up rather than hold the bird
};
const nightward = { night: null, armed: false, done: false, turning: false, pull: 0, since: 0, heading: GALAXY_HEADING };
function updateNightward(dt) {
  const night = isNight(dayPhase);
  if (nightward.night !== night) {
    // the first frame only reads where the day stands, so a flight resumed
    // into a night that began without it is left alone
    if (night && nightward.night !== null) {
      nightward.armed = true;
      nightward.done = false;
      nightward.turning = false;
    }
    if (!night) nightward.armed = false;
    nightward.night = night;
  }
  const holding = nightward.armed && !nightward.done;
  // the sunset's own pull has the bird until the sky settles into night
  if (holding && !nightward.turning && sunward.pull === 0) {
    nightward.turning = true;
    nightward.since = state.t;
  }
  if (
    holding &&
    nightward.turning &&
    (Math.abs(wrapAngle(GALAXY_HEADING - state.heading)) < NIGHTWARD.aligned || state.t - nightward.since > NIGHTWARD.give)
  )
    nightward.done = true;
  const want = nightward.armed && !nightward.done && nightward.turning ? 1 : 0;
  nightward.pull = Math.max(0, Math.min(1, nightward.pull + (want ? dt : -dt) / NIGHTWARD.fade));
}
// The viewer took the reins: the current event lets go of the bird, so does the
// night's one turn, and so does the opening.
function releaseSunward() {
  if (sunward.event) sunward.released = true;
  nightward.done = true;
  endIntro('steered');
}

// ---------------------------------------------------------------------------
// Flight controller: rails with a gentle hand. The bird flies itself; a drag
// turns it and aims its nose, and takes the vertical away from whatever the
// flight had planned for as long as it is held and a moment after.
// ---------------------------------------------------------------------------
const state = {
  x: 0,
  y: 260,
  z: 0,
  heading: 0,
  vy: 0,
  bank: 0,
  pitch: 0,
  yawRate: 0,
  nudgeYaw: 0,
  nudgeAlt: 0,
  steer: 0, // heading change from steering, applied whole on the next frame
  aim: 0, // climb angle the captain steered to, radians
  aimHold: 0, // how much of the vertical is his, 1 while he steers
  t: 0,
  flapping: false,
  flapTimer: 0,
  flapBurst: 0,
  dragging: false,
  dragButton: -1, // 0 orbits the camera, 2 steers the bird
  lastPX: 0,
  lastPY: 0,
};
// The captain has the stick while the steering button, or a touch, is held.
const steering = () => state.dragButton === 2;
{
  // A world's first flight opens with a scripted sunrise, so its start is
  // chosen for that: over land at cruising height, in the open oak hills the
  // page was approved in when they are within reach, on a course abeam of
  // the sunrise whose turn toward it and climb stay over land and hills.
  // The other biomes arrive as the flight goes on.
  const probe = [0, 0, 0, 0],
    weights = new Float32Array(BIOMES.length),
    home = BIOMES.findIndex((biome) => biome.id === 'wildsong');
  const homeAt = (x, z) => {
    sampleWorld(x, z, probe);
    biomeWeights(probe[1], probe[2], probe[3], weights);
    return home < 0 ? 0 : weights[home];
  };
  let best = null;
  const r = mulberry32(seed ^ 0xbead);
  for (let i = 0; i < 400; i++) {
    const a = r() * 6.283,
      d = 400 + r() * 11600;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    const here = homeAt(x, z),
      h = probe[0];
    const place = h > 20 && h < 260 ? 100 - Math.abs(h - 90) + 120 * here : -1e9;
    for (const side of [-1, 1]) {
      // the opening course: five seconds abeam of the sunrise, the same gentle
      // turn a sunrise pulls, then straight at it, sampled every five seconds
      const start = SUNRISE_AZIMUTH + (side * Math.PI) / 2;
      let heading = start,
        px = x,
        pz = z,
        score = place;
      for (let k = 1; k <= 14; k++) {
        if (k > 1) heading += Math.max(-1, Math.min(1, wrapAngle(SUNRISE_AZIMUTH - heading)));
        px += Math.sin(heading) * SPEED * 5;
        pz += Math.cos(heading) * SPEED * 5;
        const w = homeAt(px, pz),
          ground = probe[0];
        score += 8 * w + (ground > 10 ? 1 : -8) - (ground > 320 ? 5 : 0);
      }
      if (best === null || score > best.score) best = { x, z, h, heading: start, score };
    }
  }
  state.x = best.x;
  state.z = best.z;
  state.y = Math.max(best.h, 0) + 170;
  state.heading = wrapAngle(best.heading);
}
function n1(t, s) {
  return perlin2(t, 0.37, s);
}
// The highest ground, crown or stone along the path ahead. The path bends
// with the current turn rate, so the look-ahead follows that arc rather
// than a straight line, and the corridor is wider than the bird so a crown
// beside the path lifts the bird before it is over it.
const _ahead = [];
function terrainAhead(dist) {
  _ahead.length = 0;
  const reach = dist + 60;
  for (const records of [treeRecords, ruinRecords, propRecords])
    for (const tree of records) {
      const dx = tree.x - state.x,
        dz = tree.z - state.z;
      if (dx * dx + dz * dz < (reach + tree.radius) ** 2) _ahead.push(tree);
    }
  let h = -1e9,
    px = state.x,
    pz = state.z;
  const step = 30;
  for (let d = 0; d <= dist; d += step) {
    if (d > 0) {
      const heading = state.heading + (state.yawRate * d) / SPEED;
      px += Math.sin(heading) * step;
      pz += Math.cos(heading) * step;
    }
    h = Math.max(h, heightAt(px, pz));
    for (const tree of _ahead) {
      const margin = tree.radius + 18;
      if ((tree.x - px) ** 2 + (tree.z - pz) ** 2 < margin * margin) h = Math.max(h, tree.top);
    }
  }
  return h;
}
let cloudSchedule = 0; // 0 = below the deck, 1 = above it
// The schedule climbs through the deck for the last hundred seconds of every
// three hundred, counted from this origin; the opening resets it so a full
// low stretch follows the dive.
let cloudOrigin = -150;
let forceHigh = null,
  forceLow = null;

// ---------------------------------------------------------------------------
// The opening. A world's first flight is scripted so that every new viewer
// gets the same sunrise: ten seconds before it, flying abeam of the glow; a
// turn to face the sun as it clears the horizon; a climb through the deck,
// with the day stretched so the low sun still sits in the frame and lights
// the cloud tops; a pause above them; a dive back under; then the flight is
// its own. It touches only what the autonomous flight already steers by, the
// yaw target and the cloud schedule, so the hand-off changes nothing else,
// and a steer ends it the way a steer releases a sunrise pull. A resumed
// flight never plays it.
// ---------------------------------------------------------------------------
const INTRO = {
  beforeSunrise: 10, // seconds of dawn before the sun crosses
  side: 5, // seconds abeam of the sunrise before the turn
  climbAt: 13, // the turn is done and the sun is clear of the horizon
  climbLimit: 75, // give up on the deck if the ground kept the bird down
  aboveBy: 140, // meters over the deck that count as above the clouds
  hold: 10, // seconds above the clouds
  dive: 30, // seconds of descent before the flight is its own
  stretch: 0.55, // day clock speed while the sun should stay low (the sun's own pace by day is two thirds)
};
const intro = { beat: null, at: 0, ended: null };
let dayRate = 1,
  dayRateTarget = 1;
function updateIntro() {
  if (!intro.beat) return;
  const t = state.t;
  if (intro.beat === 'side' && t >= INTRO.side) intro.beat = 'pivot';
  if (intro.beat === 'pivot' && t >= INTRO.climbAt) intro.beat = 'climb';
  if (intro.beat === 'climb' && (state.y > DECK_Y + INTRO.aboveBy || t >= INTRO.climbLimit)) {
    intro.beat = 'above';
    intro.at = t;
  }
  if (intro.beat === 'above' && t >= intro.at + INTRO.hold) {
    intro.beat = 'dive';
    intro.at = t;
  }
  if (intro.beat === 'dive' && t >= intro.at + INTRO.dive) endIntro('flown');
  dayRateTarget = intro.beat === 'climb' || intro.beat === 'above' ? INTRO.stretch : 1;
}
function endIntro(how) {
  if (!intro.beat) return;
  intro.beat = null;
  intro.ended = how;
  cloudOrigin = state.t;
  dayRateTarget = 1;
}
// The title card. Three seconds into the turn toward the sunrise, "Kun Chen
// Presents" and then "Fly With Me" come up out of a soft blur, hold while the
// sun clears the horizon and the bird faces it, and are gone before the
// climb reaches the clouds. It belongs to the opening: it starts on its beat
// only while the opening is still playing, and once started it finishes even
// if the viewer steers, since a card cut off halfway reads as a fault. It runs
// on the simulation clock, so a pause holds it and the checks can step through it.
const TITLE = {
  at: INTRO.side + 3, // seconds after Begin: three seconds into the turn toward the sun
  presents: [0, 2.6], // seconds after `at` over which the small line comes up
  name: [1.6, 5.6], // the title, fully up a few seconds after the sun crests
  out: [11.5, 15], // both fade away
};
const title = { started: false, done: false, presents: 0, name: 0 };
const titleCard = {
  presents: document.getElementById('titlePresents'),
  name: document.getElementById('titleName'),
};
function updateTitle() {
  if (title.done) return;
  const t = state.t - TITLE.at;
  if (!title.started) {
    if (!intro.beat || t < 0) return;
    title.started = true;
  }
  const fall = 1 - sstep(TITLE.out[0], TITLE.out[1], t);
  const up = sstep(TITLE.name[0], TITLE.name[1], t);
  title.presents = sstep(TITLE.presents[0], TITLE.presents[1], t) * fall;
  title.name = up * fall;
  titleCard.presents.style.opacity = title.presents.toFixed(3);
  titleCard.name.style.opacity = title.name.toFixed(3);
  // the title sharpens as it comes up and drifts a little larger the whole
  // time it is on screen; a viewer who asked for less motion gets the fade alone
  if (!reducedMotion) {
    const drift = sstep(TITLE.name[0], TITLE.out[1], t);
    titleCard.name.style.filter = `blur(${((1 - up) * 12).toFixed(2)}px)`;
    titleCard.name.style.transform = `scale(${(0.955 + 0.06 * drift).toFixed(4)})`;
  }
  if (t >= TITLE.out[1]) title.done = true;
}
// Now and then the bird drops for a low pass over gentle ground, then climbs back.
const flight = { lowNext: 160, lowUntil: 0, low: false, lowAmount: 0 };
function updateFlight(dt) {
  state.t += dt;
  updateIntro();
  // where the schedule wants us: a slow climb through the deck every few
  // minutes, or where the opening is in its script
  const cyc = (((state.t - cloudOrigin) % 300) + 300) % 300;
  const wantHigh =
    forceHigh !== null
      ? forceHigh
      : intro.beat
        ? intro.beat === 'climb' || intro.beat === 'above'
          ? 1
          : 0
        : cyc > 200
          ? 1
          : 0;
  cloudSchedule += (wantHigh - cloudSchedule) * Math.min(1, dt * 0.5);
  // heading: slow noise, a low sun or moon to fly at, the captain's nudge, and
  // steering that turns the bird directly
  const wander = 0.22 * n1(state.t * 0.045 + 3.1, S2 + 5) + 0.08 * n1(state.t * 0.19, S2 + 9);
  updateSunward();
  updateNightward(dt);
  // one thing pulls at a time: a sky event first, then the night's one turn
  const pull = Math.max(sunward.pull, nightward.pull);
  const pulled = sunward.pull >= nightward.pull ? sunward.heading : nightward.heading;
  const toward = Math.max(-0.2, Math.min(0.2, wrapAngle(pulled - state.heading) * 0.5));
  let yawRateTarget = wander * (1 - pull) + toward * pull + state.nudgeYaw;
  if (intro.beat) {
    // the opening holds its course abeam of the sunrise, then turns at the
    // same gentle rate a sunrise pulls and flies straight at the sun
    const sunHeading = Math.atan2(_sunDir.x, _sunDir.z);
    yawRateTarget =
      intro.beat === 'side' ? 0 : Math.max(-0.2, Math.min(0.2, wrapAngle(sunHeading - state.heading) * 0.5));
  }
  state.yawRate += (yawRateTarget - state.yawRate) * Math.min(1, dt * 1.5);
  // Steering turns the bird one to one with the mouse, and the camera with it.
  let turn = state.steer;
  state.steer = 0;
  if (steering()) {
    // Steering from the camera's point of view: the bird turns to face the way
    // the camera looks, while the camera itself holds still in the world.
    const give = cam.yaw * Math.min(1, dt * 4);
    cam.yaw -= give;
    turn += give;
  }
  state.heading = wrapAngle(state.heading + state.yawRate * dt + turn);
  const steerRate = Math.max(-1.2, Math.min(1.2, (turn / dt) * 0.6));
  // altitude: cruise above the terrain ahead, higher when the schedule says so,
  // lower during a pass over ground that stays gentle for a while ahead
  const here = Math.max(heightAt(state.x, state.z), SEA_LEVEL);
  const gentle = terrainAhead(1100) < here + 70 && here < 420;
  const lowWindow =
    forceLow !== null ? forceLow > 0 : flight.low ? state.t < flight.lowUntil : state.t > flight.lowNext;
  if (!flight.low && lowWindow && wantHigh === 0 && cloudSchedule < 0.05 && gentle && !intro.beat && !state.aimHold) {
    flight.low = true;
    flight.lowUntil = state.t + 45 + Math.random() * 35;
  }
  if (flight.low && (!lowWindow || wantHigh === 1)) {
    flight.low = false;
    flight.lowNext = state.t + 170 + Math.random() * 130;
  }
  const wantLow = flight.low && gentle ? 1 : 0;
  flight.lowAmount += (wantLow - flight.lowAmount) * Math.min(1, dt * (wantLow ? 0.16 : 0.35));
  const low = flight.lowAmount;
  const ahead = terrainAhead(520);
  const cruise = Math.max(
    ahead + 110 - 80 * low + 40 * (1 - 0.6 * low) * n1(state.t * 0.03, S1 + 4),
    SEA_LEVEL + 55 - 32 * low,
  );
  const high = DECK_Y + 190 + 30 * n1(state.t * 0.05, S1 + 8);
  let target = cruise + (high - Math.min(cruise, high)) * cloudSchedule + state.nudgeAlt;
  target = Math.max(target, ahead + 18, heightAt(state.x, state.z) + 28);
  // A low pass follows the ground more eagerly: the gap the bird settles
  // into over falling ground is the ground's descent rate over this gain.
  let vyTarget = Math.max(-16, Math.min(11, (target - state.y) * (0.12 + 0.2 * low)));
  // The captain's aim overrides whatever the flight had planned: while he has
  // the stick, and for a moment after, the nose he set is the only thing that
  // moves the bird up or down, inside the same envelope, the same clearance
  // over the ground ahead, and a ceiling over the cloud sea. Then the flight
  // takes the altitude back from where he left it.
  if (state.aimHold > 0) {
    const aimed = Math.max(-16, Math.min(11, Math.sin(state.aim) * SPEED));
    vyTarget += (aimed - vyTarget) * state.aimHold;
    vyTarget = Math.min(vyTarget, (AIM.ceiling - state.y) * AIM.brake);
    vyTarget = Math.max(vyTarget, (Math.max(ahead + 18, here + 28) - state.y) * AIM.brake);
    if (!steering()) {
      state.aimHold = Math.max(0, state.aimHold - dt / AIM.release);
      if (state.aimHold === 0) {
        state.aim = 0;
        // a crossing stands a while longer if he left the bird over the deck;
        // under it, a full low stretch follows
        cloudOrigin = state.t - (state.y > DECK_Y ? 210 : 0);
      }
    }
  }
  // Pulling up answers faster than settling down, so a canopy or a wall
  // entering the look-ahead lifts the bird before the clearance clamp must.
  state.vy += (vyTarget - state.vy) * Math.min(1, dt * (vyTarget > state.vy ? 2.6 : 0.9));
  // move
  const fx = Math.sin(state.heading),
    fz = Math.cos(state.heading);
  state.x += fx * SPEED * dt;
  state.z += fz * SPEED * dt;
  state.y += state.vy * dt;
  state.y = Math.max(state.y, obstacleFloor(state.x, state.z) + 8);
  // pose: roll leads yaw, pitch follows climb
  const bankTarget = -(state.yawRate + steerRate) * 1.35;
  state.bank += (bankTarget - state.bank) * Math.min(1, dt * 2.2);
  const pitchTarget = Math.atan2(state.vy, SPEED) * 1.6;
  state.pitch += (pitchTarget - state.pitch) * Math.min(1, dt * 2.0);
  // flap bursts: when climbing, and now and then while gliding
  state.flapTimer -= dt;
  if (state.flapBurst > 0) {
    state.flapBurst -= dt;
    state.flapping = true;
  } else if (state.vy > 2.5) {
    state.flapping = true;
  } else {
    state.flapping = false;
    if (state.flapTimer <= 0) {
      state.flapBurst = 2.2 + Math.random() * 2;
      state.flapTimer = 7 + Math.random() * 9;
    }
  }
  // nudge decay
  if (!state.dragging) {
    state.nudgeYaw *= Math.exp(-dt / 2.4);
    state.nudgeAlt *= Math.exp(-dt / 3.5);
  }

  bird.position.set(state.x, state.y + Math.sin(state.t * 3.1) * 0.06, state.z);
  bird.rotation.set(-state.pitch, state.heading, state.bank);
  animateWings(bird, dt, state.flapping);
}

// Pointer input follows the conventions of World of Warcraft's camera: the left
// button orbits the camera and leaves it where you put it, the right button
// steers, and the wheel zooms. Touch steers, since it has only one button.
// Heading grows counter-clockwise seen from above, which is a left turn, so
// rightward input subtracts: the view and the bird turn right, as in WoW.
// Steering is both ways: sideways it turns the bird, up and down it lowers or
// raises the view exactly as the left button does and aims the bird's nose the
// same way at the same time, so the bird flies where the captain is looking.
// The view stays where he leaves it, as every orbit does; the aim is his for as
// long as he holds it and a moment after.
const AIM = {
  // The ends of the stick are the ends of the bird's own envelope: a full
  // drag reaches its fastest climb or its fastest descent and no further, so
  // the nose stays well short of anything like a loop and no travel is dead.
  up: Math.asin(11 / SPEED),
  down: Math.asin(16 / SPEED),
  release: 2.2, // seconds over which the flight takes the altitude back
  ceiling: DECK_Y + 420, // where a steered climb eases off, well over the deck
  brake: 0.35, // how firmly the ground ahead and the ceiling take the aim back
};
function aimBy(delta) {
  state.aim = Math.max(-AIM.down, Math.min(AIM.up, state.aim + delta));
  state.aimHold = 1;
  // a low pass under way lets go of the bird, the way a pull does when steered
  if (flight.low) {
    flight.low = false;
    flight.lowNext = state.t + 170 + Math.random() * 130;
  }
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (!running || disposed) return;
  if (e.button !== 0 && e.button !== 2 && e.pointerType !== 'touch') return;
  state.dragging = true;
  state.dragButton = e.pointerType === 'touch' || e.button === 2 ? 2 : 0;
  if (state.dragButton === 2) releaseSunward();
  state.lastPX = e.clientX;
  state.lastPY = e.clientY;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic pointers have nothing to capture
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  const dx = e.clientX - state.lastPX,
    dy = e.clientY - state.lastPY;
  state.lastPX = e.clientX;
  state.lastPY = e.clientY;
  // Either button lowers and raises the view the same way. The left one orbits
  // sideways around the bird; the right one turns the bird and, with the view,
  // aims its nose, so it flies where the captain is looking.
  if (dy) cam.pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, cam.pitch + dy * CAMERA.turnPerPixel));
  if (state.dragButton === 0) cam.yaw = wrapAngle(cam.yaw - dx * CAMERA.turnPerPixel);
  else {
    state.steer -= dx * CAMERA.turnPerPixel;
    if (dy) aimBy(-dy * CAMERA.turnPerPixel);
  }
});
const endDrag = () => {
  // either button can have moved the framing, and framing is remembered
  if (state.dragButton >= 0) saveSettings();
  state.dragging = false;
  state.dragButton = -1;
};
canvas.addEventListener('lostpointercapture', endDrag);
window.addEventListener('blur', endDrag);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!running) return;
    e.preventDefault();
    cam.dist = Math.max(CAMERA.minDist, Math.min(CAMERA.maxDist, cam.dist * Math.exp(e.deltaY * 0.0012)));
    saveSettings();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.target.closest('button, a, input') || !running) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.key.startsWith('Arrow')) e.preventDefault();
  if (paused) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') releaseSunward();
  if (e.key === 'ArrowLeft') state.nudgeYaw = 0.4;
  if (e.key === 'ArrowRight') state.nudgeYaw = -0.4;
  if (e.key === 'ArrowUp') state.nudgeAlt = 200;
  if (e.key === 'ArrowDown') state.nudgeAlt = -180;
});

// ---------------------------------------------------------------------------
// Camera: World of Warcraft's third person. It hangs rigidly at a yaw, pitch
// and distance from the bird, so the bird is the pivot of every orbit and holds
// its place on screen. There is no director; only the viewer moves it, and it
// stays where it is put.
// ---------------------------------------------------------------------------
function obstacleFloor(x, z) {
  let floor = Math.max(SEA_LEVEL, heightAt(x, z));
  for (const records of [treeRecords, ruinRecords, propRecords])
    for (const tree of records)
      if ((tree.x - x) ** 2 + (tree.z - z) ** 2 < (tree.radius + 5) ** 2) floor = Math.max(floor, tree.top);
  return floor;
}
const CAMERA = {
  dist: 17,
  pitch: 0.3, // elevation above the bird, radians
  minDist: 9,
  maxDist: 40,
  minPitch: -0.5,
  maxPitch: 1.2,
  turnPerPixel: 0.004,
  lookRise: 0.9, // aim just above the bird, so it sits a little below center
  clearance: 9,
};
const cam = {
  yaw: 0, // orbit around the bird, relative to its heading; 0 is behind
  pitch: CAMERA.pitch,
  dist: CAMERA.dist,
  lift: 0, // extra height that keeps the camera out of ground and canopies
};
{
  // the viewer's framing is theirs across visits and worlds
  const orbit = storedSettings.camera ?? {};
  cam.yaw = finite(orbit.yaw, -Math.PI, Math.PI) ?? cam.yaw;
  cam.pitch = finite(orbit.pitch, CAMERA.minPitch, CAMERA.maxPitch) ?? cam.pitch;
  cam.dist = finite(orbit.dist, CAMERA.minDist, CAMERA.maxDist) ?? cam.dist;
}
function updateCamera(dt) {
  const yaw = state.heading + Math.PI + cam.yaw,
    cp = Math.cos(cam.pitch);
  const want = _v3.set(
    state.x + Math.sin(yaw) * cp * cam.dist,
    state.y + Math.sin(cam.pitch) * cam.dist,
    state.z + Math.cos(yaw) * cp * cam.dist,
  );
  // Ground and canopies lift the camera quickly and let it settle back slowly.
  const floor = obstacleFloor(want.x, want.z);
  const lift = Math.max(0, floor + CAMERA.clearance - want.y);
  cam.lift += (lift - cam.lift) * Math.min(1, dt * (lift > cam.lift ? 10 : 1.5));
  want.y = Math.max(want.y + cam.lift, floor + 7);
  camera.position.copy(want);
  camera.lookAt(state.x, state.y + CAMERA.lookRise, state.z);
}

// ---------------------------------------------------------------------------
// Moments: rare, scheduled, with cooldowns. For now: a flock that joins and
// leaves. Cloud crossings come from the altitude schedule.
// ---------------------------------------------------------------------------
const moments = { nextFlock: 75, flockStarted: 0, flockUntil: 0, flockOn: false };
function updateMoments(dt, sound = true) {
  if (!moments.flockOn && state.t > moments.nextFlock) {
    moments.flockOn = true;
    moments.flockStarted = state.t;
    moments.flockUntil = state.t + 70 + Math.random() * 30;
    if (sound) audio.chime(2);
  }
  if (moments.flockOn && state.t > moments.flockUntil) {
    moments.flockOn = false;
    moments.nextFlock = state.t + 95 + Math.random() * 50;
  }
  const fx = Math.sin(state.heading),
    fz = Math.cos(state.heading),
    rx = Math.cos(state.heading),
    rz = -Math.sin(state.heading);
  companions.forEach((b, i) => {
    const f = formation[i];
    // ease in from far behind and below; ease out the same way
    const tIn = Math.min(1, Math.max(0, (state.t - moments.flockStarted) / 14));
    const tOut = moments.flockOn ? 1 : Math.max(0, 1 - (state.t - moments.flockUntil) / 14);
    const a = moments.flockStarted > 0 ? Math.min(tIn, tOut) : 0;
    b.visible = a > 0.01;
    if (!b.visible) return;
    const ease = 1 - Math.pow(1 - a, 3);
    const back = (1 - ease) * 140;
    const wob = n1(state.t * 0.3 + i * 7.7, S3 + i) * 3;
    b.position.set(
      state.x + rx * f[0] + fx * (f[2] - back),
      state.y + f[1] - (1 - ease) * 40 + wob,
      state.z + rz * f[0] + fz * (f[2] - back),
    );
    b.position.y = Math.max(b.position.y, obstacleFloor(b.position.x, b.position.z) + 6);
    b.rotation.set(-state.pitch * 0.8, state.heading, state.bank * 0.9);
    animateWings(b, dt, state.flapping || (i % 2 === 0 && state.flapBurst > 0), 0.9 + i * 0.05);
  });
}

// ---------------------------------------------------------------------------
// Sound: everything synthesized. Wind that follows altitude and speed, water
// near the ocean, a pentatonic chime now and then, a soft brush per wing beat.
// ---------------------------------------------------------------------------
const audio = (() => {
  let ctx = null,
    master = null,
    windFilter = null,
    windGain = null,
    waterGain = null,
    noise = null,
    delay = null,
    muted = storedSettings.muted === true,
    volume = finite(storedSettings.volume, 0, 1) ?? 0.5,
    started = false;
  let lastFlapPhase = 0,
    chimeTimer = 25;
  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  function pinkBuffer(seconds) {
    const sr = ctx.sampleRate,
      n = Math.floor(sr * seconds),
      buf = ctx.createBuffer(1, n, sr),
      d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }
  function start() {
    if (started) return;
    started = true;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) {
      document.getElementById('muteBtn').textContent = 'sound unavailable';
      document.getElementById('muteBtn').disabled = true;
      return;
    }
    try {
      ctx = new Audio();
    } catch {
      document.getElementById('muteBtn').textContent = 'sound unavailable';
      document.getElementById('muteBtn').disabled = true;
      return;
    }
    ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(muted ? 0 : volume, ctx.currentTime + 4);
    noise = pinkBuffer(4);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0.22;
    src.connect(windFilter).connect(windGain).connect(master);
    src.start();
    const src2 = ctx.createBufferSource();
    src2.buffer = noise;
    src2.loop = true;
    src2.playbackRate.value = 0.7;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 220;
    wf.Q.value = 0.9;
    waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    src2.connect(wf).connect(waterGain).connect(master);
    src2.start();
    delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    delay.connect(master);
  }
  function chime(count = 1) {
    if (!ctx) return;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * (0.9 + Math.random() * 0.6);
      const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 2 : 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.01;
      const g2 = ctx.createGain();
      g2.gain.value = 0.18;
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(master);
      g.connect(delay);
      o.start(t);
      o2.start(t);
      o.stop(t + 5);
      o2.stop(t + 5);
      o.onended = () => {
        o.disconnect();
        o2.disconnect();
        g2.disconnect();
        g.disconnect();
      };
    }
  }
  function flap() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    src.connect(bp).connect(g).connect(master);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.25);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }
  function update(dt) {
    if (!ctx) return;
    const alt = Math.max(0, state.y - heightAt(state.x, state.z));
    const gust = 0.5 + 0.5 * Math.sin(state.t * 0.43) * Math.sin(state.t * 0.071 + 1.3);
    const f = 380 + Math.min(1, alt / 700) * 700 + gust * 260 + Math.abs(state.vy) * 18;
    windFilter.frequency.setTargetAtTime(f, ctx.currentTime, 0.4);
    windGain.gain.setTargetAtTime(
      0.16 + 0.1 * gust + 0.05 * Math.min(1, Math.abs(state.vy) / 10),
      ctx.currentTime,
      0.5,
    );
    // ocean-ness: how much of the ground around the bird is under water
    let under = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      if (heightAt(state.x + Math.cos(a) * 320, state.z + Math.sin(a) * 320) < 0) under++;
    }
    const near = heightAt(state.x, state.z) < 0 ? 1 : 0;
    const water = Math.min(1, (under / 8) * 0.8 + near * 0.4) * Math.max(0, 1 - alt / 500);
    waterGain.gain.setTargetAtTime(water * 0.28, ctx.currentTime, 1.2);
    // wing beats
    const ph = bird.userData.phase % 6.283;
    if (state.flapping && ph < lastFlapPhase) flap();
    lastFlapPhase = ph;
    chimeTimer -= dt;
    if (chimeTimer <= 0) {
      chime(1 + (Math.random() < 0.3 ? 1 : 0));
      chimeTimer = 22 + Math.random() * 40;
    }
  }
  function applyGain(seconds) {
    if (master && ctx.state !== 'closed') {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, seconds);
    }
  }
  function toggleMute() {
    muted = !muted;
    applyGain(0.3);
    saveSettings();
    return muted;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (muted) muted = false;
    applyGain(0.08);
    saveSettings();
    return muted;
  }
  function suspend(s) {
    if (!ctx || ctx.state === 'closed') return;
    ctx[s ? 'suspend' : 'resume']().catch(() => {});
  }
  function dispose() {
    return ctx && ctx.state !== 'closed' ? ctx.close().catch(() => {}) : Promise.resolve();
  }
  return {
    start,
    chime,
    flap,
    update,
    toggleMute,
    setVolume,
    suspend,
    dispose,
    get state() {
      return ctx?.state ?? 'not-created';
    },
    get gain() {
      return master?.gain.value ?? 0;
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
  };
})();
function saveSettings() {
  remember.write(SETTINGS_KEY, {
    volume: audio.volume,
    muted: audio.muted,
    camera: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist },
  });
}
const muteButton = document.getElementById('muteBtn'),
  volumeSlider = document.getElementById('volume');
const showMuted = (muted) => {
  muteButton.textContent = muted ? 'sound off' : 'sound on';
  muteButton.setAttribute('aria-pressed', String(muted));
};
muteButton.addEventListener('click', () => showMuted(audio.toggleMute()));
volumeSlider.value = String(audio.volume);
showMuted(audio.muted);
volumeSlider.addEventListener('input', () => showMuted(audio.setVolume(volumeSlider.value)));

// ---------------------------------------------------------------------------
// Approved soft reconstruction in display space, followed by FXAA.
// ---------------------------------------------------------------------------
// Four samples here and nowhere else; see the renderer above.
const scenePass = pass(scene, camera, { samples: 4 });
const col = scenePass.getTextureNode();
const glow = bloom(col, 0.23, 0.6, 1.1);
const post = new RenderPipeline(renderer);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
post.outputColorTransform = false;
// Everything past tone mapping is display-referred, in the eight bits per
// channel a screen has, so the two intermediates the chain materialises hold
// exactly that. The soft pass reads its input nine times per pixel and FXAA
// reads its own more than that, and halving the width of every one of those
// reads is the cheapest bandwidth this page can give back. Neither needs a
// depth buffer either; each is one full-screen quad.
const LDR = { type: THREE.UnsignedByteType, depthBuffer: false };
const display = convertToTexture(renderOutput(vec4(col.rgb.add(glow.rgb), 1)), null, null, LDR);
const softened = Fn(() => {
  const center = display.sample(screenUV),
    sum = center.rgb.mul(4).toVar(),
    weights = float(4).toVar();
  for (const [x, y, spatial] of [
    [-1, 0, 2],
    [1, 0, 2],
    [0, -1, 2],
    [0, 1, 2],
    [-1, -1, 1],
    [1, -1, 1],
    [-1, 1, 1],
    [1, 1, 1],
  ]) {
    const neighbor = display.sample(screenUV.add(vec2(x, y).div(viewportSize))).rgb;
    const delta = neighbor.sub(center.rgb),
      weight = exp(dot(delta, delta).mul(-40)).mul(spatial);
    sum.addAssign(neighbor.mul(weight));
    weights.addAssign(weight);
  }
  return vec4(
    mix(center.rgb, sum.div(weights), 0.65)
      .mul(0.96)
      .add(vec3(0.02, 0.025, 0.022)),
    center.a,
  );
})();
const softDisplay = convertToTexture(softened, null, null, LDR);
post.outputNode = fxaa(softDisplay);

// ---------------------------------------------------------------------------
// Day cycle and atmosphere per frame
// ---------------------------------------------------------------------------
// A fresh world opens ten seconds before the sunrise the opening flies into.
let dayPhase = SUNRISE.phase - INTRO.beforeSunrise / DAY_SECONDS;
const _sunDir = new THREE.Vector3(),
  _moonDir = new THREE.Vector3();
const BASE_EXPOSURE = 1.05;
// Where the sun and the moon stand at a moment of the day clock. The moon
// rides its own arc, up before dusk and gone before dawn. The flight reads
// these too.
function skyBodies(phase, sunOut, moonOut) {
  const elev = (solar(phase) - 0.25) * Math.PI * 2;
  sunOut
    .set(-0.18 - 0.27 * Math.sin(elev), Math.sin(elev) * 0.7, Math.cos(elev) * 0.65 + 0.55)
    .normalize();
  const melev = elev + Math.PI + 0.35;
  moonOut
    .set(0.3 - 0.2 * Math.sin(melev), Math.sin(melev) * 0.45, -(Math.cos(melev) * 0.5 + 0.45))
    .normalize();
}
function updateAtmosphere(dt) {
  dayRate += (dayRateTarget - dayRate) * Math.min(1, dt * 0.8);
  dayPhase = (dayPhase + (dt * dayRate) / DAY_SECONDS) % 1;
  evalPalette(solar(dayPhase));
  skyBodies(dayPhase, _sunDir, _moonDir);
  const sy = _sunDir.y;
  const night = sstep(-0.02, -0.2, sy);
  const sunUp = sstep(-0.025, 0.06, sy);
  const moonAbove = sstep(-0.02, 0.12, _moonDir.y);
  const moonLight = sstep(-0.09, -0.2, sy) * moonAbove;
  uNight.value = night;
  uSunDir.value.copy(_sunDir);
  uMoonDir.value.copy(_moonDir);
  uMoonUp.value = moonAbove;
  uMoonLight.value = moonLight;
  uLowSun.value = Math.exp(-((sy / 0.14) ** 2));
  uGlowI.value = sstep(-0.22, -0.04, sy) * (1 - sstep(0.12, 0.32, sy));
  uVenusI.value = Math.exp(-(((sy + 0.03) / 0.09) ** 2));
  uZenith.value.copy(pal.zenith);
  uUpper.value.copy(pal.upper);
  uHorizon.value.copy(pal.horizon);
  uHorizonWarm.value.copy(pal.horizonWarm);
  uUpperWarm.value.copy(pal.upperWarm);
  uGlow.value.copy(pal.glow);
  uCloudWhite.value
    .copy(cloudWhite)
    .lerp(pal.glow, uLowSun.value * 0.45)
    .lerp(pal.horizon, night * 0.97);
  uBelow.value.copy(pal.below);
  uSunColor.value.copy(pal.sun);
  // One shadow-casting light: the sun by day, the moon by night. It changes
  // direction only while its intensity is zero, so nothing ever jumps.
  if (sunUp > 0) {
    sun.position.copy(_sunDir);
    sun.color.copy(pal.sun);
    sun.intensity = pal.sunI * sunUp;
    sun.shadow.intensity = 0.55;
  } else {
    sun.position.copy(_moonDir);
    sun.color.copy(MOON_COLOR);
    sun.intensity = L.moon.intensity * moonLight;
    sun.shadow.intensity = 0.4;
  }
  // The shadow frame follows the bird, but only in whole shadow-map texels
  // across the light's plane, so the shadows drawn on the ground never crawl
  // as the frame slides under them.
  _m4.lookAt(sun.position, _zero, sun.up);
  const texel = (SHADOW_HALF * 2) / SHADOW_MAP,
    e = _m4.elements;
  _v3.set(e[0], e[1], e[2]);
  _s3.set(e[4], e[5], e[6]);
  const along = bird.position.dot(_v3),
    up = bird.position.dot(_s3);
  sun.target.position
    .copy(bird.position)
    .addScaledVector(_v3, Math.round(along / texel) * texel - along)
    .addScaledVector(_s3, Math.round(up / texel) * texel - up);
  sun.position.multiplyScalar(1000).add(sun.target.position);
  hemi.color.copy(pal.hemiSky);
  hemi.groundColor.copy(pal.hemiGround);
  hemi.intensity = pal.hemiI;
  // cloud sea and whiteout follow the camera's altitude relative to the deck;
  // the eye stops down a little over the bright sea
  const rel = camera.position.y - DECK_Y;
  uAbove.value = sstep(-90, 30, rel);
  renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.25 * night) * (1 - 0.12 * uAbove.value);
  uFogDensity.value = FOG_DENSITY * (1 - 0.28 * sstep(0.1, 0.65, sy)) * (1 + 0.35 * night);
  cloudSea.visible = uAbove.value > 0.001;
  uCloudBodies.value = sstep(-240, -80, rel);
  clouds.visible = uCloudBodies.value > 0.001;
  uWhiteout.value = (1 - sstep(0, 80, Math.abs(rel + 20))) * 0.996;
  // No star vertices submitted in daylight or inside the opaque deck.
  galaxy.stars.visible = night > 0 && uWhiteout.value < 0.995;
  sky.position.copy(camera.position);
}

// ---------------------------------------------------------------------------
// Resume. A remembered flight in this world continues from its exact moment:
// place, course, time of day and the schedules that hang off the clock.
// ---------------------------------------------------------------------------
function restoreFlight(stored) {
  if (!stored || stored.seed !== seed) return false;
  const n = (key, min, max) => finite(stored[key], min, max);
  const x = n('x'),
    z = n('z'),
    y = n('y', -200, 6000),
    heading = n('heading'),
    t = n('t', 0),
    phase = n('dayPhase', 0, 1);
  if ([x, z, y, heading, t, phase].some((v) => v === null)) return false;
  Object.assign(state, {
    x,
    y,
    z,
    t,
    heading: wrapAngle(heading),
    vy: n('vy', -40, 40) ?? 0,
    bank: n('bank', -1, 1) ?? 0,
    pitch: n('pitch', -1, 1) ?? 0,
    yawRate: n('yawRate', -1, 1) ?? 0,
  });
  dayPhase = phase % 1;
  cloudSchedule = n('cloudSchedule', 0, 1) ?? 0;
  cloudOrigin = n('cloudOrigin') ?? -150;
  const low = stored.low ?? {},
    flock = stored.flock ?? {};
  Object.assign(flight, {
    lowNext: finite(low.next, 0) ?? t + 160,
    lowUntil: finite(low.until, 0) ?? 0,
    low: low.on === true,
    lowAmount: finite(low.amount, 0, 1) ?? 0,
  });
  Object.assign(moments, {
    nextFlock: finite(flock.next, 0) ?? t + 75,
    flockStarted: finite(flock.started, 0) ?? 0,
    flockUntil: finite(flock.until, 0) ?? 0,
    flockOn: flock.on === true,
  });
  skyBodies(dayPhase, _sunDir, _moonDir);
  updateSunward();
  sunward.released = stored.released === true;
  return true;
}
function flightMemory() {
  return {
    seed,
    x: state.x,
    y: state.y,
    z: state.z,
    t: state.t,
    heading: state.heading,
    vy: state.vy,
    bank: state.bank,
    pitch: state.pitch,
    yawRate: state.yawRate,
    dayPhase,
    cloudSchedule,
    cloudOrigin,
    low: { next: flight.lowNext, until: flight.lowUntil, on: flight.low, amount: flight.lowAmount },
    flock: {
      next: moments.nextFlock,
      started: moments.flockStarted,
      until: moments.flockUntil,
      on: moments.flockOn,
    },
    released: sunward.released,
  };
}
// Written a couple of times a minute while flying and whenever the flight
// stops, hides or leaves; never before Begin, when nothing has changed.
let begun = false,
  lastSave = -Infinity;
function saveFlight() {
  if (!begun || disposed) return;
  lastSave = performance.now();
  remember.write(RESUME_KEY, flightMemory());
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const resumed = restoreFlight(storedFlight);
if (!resumed) {
  intro.beat = 'side';
  skyBodies(dayPhase, _sunDir, _moonDir);
}
fillAll(Math.round(state.x / CELL), Math.round(state.z / CELL));
if (!resumed) state.y = Math.max(state.y, heightAt(state.x, state.z) + 120);
placeTrees(state.x, state.z);
if (resumed) state.y = Math.max(state.y, obstacleFloor(state.x, state.z) + 8);
let last = performance.now();
let running = false,
  paused = false,
  disposed = false,
  primed = false;
let openingTimer, disposalTask;
let timestampPending = false,
  timestampTask = Promise.resolve(),
  captureTask = Promise.resolve();
const perf = { cpuMs: 0, renderMs: 0, frameMs: 0, frames: 0, gpuMs: null };
// Raw per-frame samples, kept only under `?profile=1`. Averages hide the
// long frames a fan hears, so the bench needs the distribution, not an EMA.
const TRACE_MAX = 60000;
const trace = {
  frame: [],
  cpu: [],
  render: [],
  gpu: [],
  reset() {
    for (const key of ['frame', 'cpu', 'render', 'gpu']) trace[key].length = 0;
    trace.at = performance.now();
    return trace;
  },
  at: 0,
};
const push = (list, value) => {
  if (list.length < TRACE_MAX) list.push(value);
};
// One executable simulation path, also used by sustained-flight regression checks.
function advance(dt, sound = true) {
  if (disposed || !Number.isFinite(dt) || dt <= 0 || dt > 0.05) return;
  updateFlight(dt);
  updateTitle();
  time.value = state.t;
  updateHeightfield(state.x, state.z);
  uOrigin.value.set(Math.round(state.x / CELL) * CELL, Math.round(state.z / CELL) * CELL);
  terrain.position.set(uOrigin.value.x, 0, uOrigin.value.y);
  uWaterOrigin.value.set(
    Math.round(state.x / WATER_CELL) * WATER_CELL,
    Math.round(state.z / WATER_CELL) * WATER_CELL,
  );
  water.position.set(uWaterOrigin.value.x, 0, uWaterOrigin.value.y);
  cloudSea.position.set(state.x, DECK_Y - 55, state.z);
  placeTrees(state.x, state.z);
  updateClouds(state.x, state.z, state.t);
  updateMoments(dt, sound);
  updateCamera(dt);
  placeGrass(camera.position.x, camera.position.z);
  updateAtmosphere(dt);
  if (performance.now() - lastSave > 2000) saveFlight();
}
// A small linear picture of the scene as it stands, for checks that must see
// what is drawn (the sun over the clouds, the light on their tops) rather than
// trust a uniform: the canvas itself cannot be read back after presentation.
function capture(width = 192, height = 108) {
  if (disposed) return Promise.resolve(null);
  const task = captureTask.then(async () => {
    if (disposed) return null;
    const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: true });
    const aspect = camera.aspect;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(target);
    try {
      await renderer.renderAsync(scene, camera);
      const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      // rows come top first on both backends
      const data = new Float32Array(read.length),
        row = width * 4,
        flip = !renderer.backend.isWebGPUBackend;
      for (let y = 0; y < height; y++) data.set(read.subarray(y * row, (y + 1) * row), (flip ? height - 1 - y : y) * row);
      return { width, height, data };
    } finally {
      renderer.setRenderTarget(null);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      target.dispose();
    }
  });
  captureTask = task.catch(() => null);
  return task;
}
function frame(now) {
  if (disposed || document.hidden) return;
  const interval = now - last;
  const dt = Math.min(0.05, interval / 1000);
  last = now;
  if (primed && running && !paused) perf.frameMs += (interval - perf.frameMs) * 0.05;
  const t0 = performance.now();
  if (running && !paused) {
    advance(dt);
    audio.update(dt);
  } else if (!running) {
    // One still, lit frame behind Begin. No idle GPU loop.
    uOrigin.value.set(Math.round(state.x / CELL) * CELL, Math.round(state.z / CELL) * CELL);
    terrain.position.set(uOrigin.value.x, 0, uOrigin.value.y);
    uWaterOrigin.value.set(
      Math.round(state.x / WATER_CELL) * WATER_CELL,
      Math.round(state.z / WATER_CELL) * WATER_CELL,
    );
    water.position.set(uWaterOrigin.value.x, 0, uWaterOrigin.value.y);
    cloudSea.position.set(state.x, DECK_Y - 55, state.z);
    updateClouds(state.x, state.z, 0);
    bird.position.set(state.x, state.y, state.z);
    bird.rotation.set(0, state.heading, 0);
    animateWings(bird, dt, false);
    updateCamera(dt);
    placeGrass(camera.position.x, camera.position.z);
    updateAtmosphere(0);
  }
  const t1 = performance.now();
  post.render();
  perf.triangles = renderer.info.render.triangles;
  perf.drawCalls = renderer.info.render.drawCalls;
  if (profiling && !timestampPending) {
    timestampPending = true;
    timestampTask = renderer.resolveTimestampsAsync().then(
      () => {
        perf.gpuMs = renderer.info.render.timestamp || null;
        if (perf.gpuMs) push(trace.gpu, perf.gpuMs);
        timestampPending = false;
      },
      () => {
        timestampPending = false;
      },
    );
  }
  const t2 = performance.now();
  perf.cpuMs += (t1 - t0 - perf.cpuMs) * 0.1;
  perf.renderMs += (t2 - t1 - perf.renderMs) * 0.1;
  perf.frames++;
  if (profiling && primed && running && !paused) {
    push(trace.frame, interval);
    push(trace.cpu, t1 - t0);
    push(trace.render, t2 - t1);
  }
  primed = true;
  if (!running || paused) renderer.setAnimationLoop(null);
  unveil();
}
// The veil lifts only once the first frame is on screen: the GPU has finished
// the work behind it (the queue on WebGPU, a fence on WebGL2) and the browser
// has had a frame in which to present it. A fade begun any earlier would show
// a blank canvas for a moment, or a world with half its shaders compiled.
let ready = false,
  veilTask = null;
function unveil() {
  if (veilTask) return veilTask;
  veilTask = (async () => {
    const backend = renderer.backend;
    if (backend.isWebGPUBackend) await backend.device.queue.onSubmittedWorkDone();
    else {
      const gl = backend.gl,
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      while (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 16));
      gl.deleteSync(fence);
    }
    await new Promise(requestAnimationFrame);
    if (disposed) return;
    ready = true;
    document.getElementById('loading').classList.add('gone');
    panel.classList.add('ready');
    beginBtn.disabled = false;
  })();
  return veilTask;
}
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  if (disposed) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderScale());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (!running || paused) {
    last = performance.now();
    // TSL FRAME nodes advance on the renderer's animation tick, not a direct
    // call. Schedule one tick so the scene pass does not reuse its old image.
    renderer.setAnimationLoop(frame);
  }
});
function syncPlayback() {
  if (disposed) return;
  endDrag();
  saveFlight();
  last = performance.now();
  audio.suspend(document.hidden || paused || !running);
  renderer.setAnimationLoop(!disposed && !document.hidden && running && !paused ? frame : null);
}
function togglePause() {
  if (!running || disposed) return;
  paused = !paused;
  const button = document.getElementById('pauseBtn');
  button.textContent = paused ? 'resume' : 'pause';
  button.title = paused ? 'Resume flight' : 'Pause flight';
  button.setAttribute('aria-pressed', String(paused));
  syncPlayback();
}
document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.addEventListener('visibilitychange', () => {
  syncPlayback();
  if (!document.hidden && !primed) renderer.setAnimationLoop(frame);
});
function dispose() {
  if (disposed) return disposalTask;
  saveFlight();
  disposed = true;
  running = false;
  renderer.setAnimationLoop(null);
  clearTimeout(openingTimer);
  const audioTask = audio.dispose();
  // Readback buffers must finish mapping before renderer disposal destroys them.
  disposalTask = Promise.all([timestampTask, captureTask, audioTask]).then(() => {
    const geometries = new Set(),
      materials = new Set();
    scene.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      if (o.isInstancedMesh) o.dispose();
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of [hfTex, barkMap, barkRelief, aoMap, grassMap, galaxy.map]) t.dispose();
    for (const pool of Object.values(speciesPools)) pool.map?.dispose();
    sun.shadow.dispose();
    scenePass.dispose();
    glow.dispose();
    display.dispose();
    softDisplay.dispose();
    post.dispose();
    renderer.dispose();
  });
  return disposalTask;
}
window.addEventListener('pagehide', (e) => {
  saveFlight();
  if (e.persisted) {
    renderer.setAnimationLoop(null);
    audio.suspend(true);
  } else dispose();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) syncPlayback();
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  window.flightFailure();
});
renderer.backend.device?.addEventListener('uncapturederror', () => {
  if (!disposed) window.flightFailure();
});
renderer.backend.device?.lost.then((info) => {
  if (!disposed && info.reason !== 'destroyed') window.flightFailure();
});

// The gate. The world stands still behind Begin until the veil has lifted and
// the viewer asks; that click is also the gesture that unlocks sound.
const beginBtn = document.getElementById('beginBtn'),
  panel = document.getElementById('begin');
beginBtn.addEventListener('click', () => {
  if (running || disposed || !ready) return;
  audio.start();
  running = true;
  begun = true;
  paused = reducedMotion;
  panel.classList.add('gone');
  panel.inert = true;
  document.getElementById('hud').inert = false;
  const pauseButton = document.getElementById('pauseBtn');
  pauseButton.disabled = false;
  pauseButton.textContent = paused ? 'resume' : 'pause';
  pauseButton.title = paused ? 'Resume flight' : 'Pause flight';
  pauseButton.setAttribute('aria-pressed', String(paused));
  canvas.inert = false;
  canvas.focus({ preventScroll: true });
  syncPlayback();
  openingTimer = setTimeout(() => {
    if (!disposed && !paused && !document.hidden) audio.chime(3);
  }, 1800);
});
// expose a little for review tooling
window.__fly = {
  state,
  cam,
  perf,
  trace,
  renderer,
  camera,
  moments,
  heightAt,
  obstacleFloor,
  dispose,
  step: (dt) => advance(dt, false),
  capture,
  surface: {
    cell: CELL,
    size: N,
    data: hfData,
    get center() {
      return [hfCx, hfCz];
    },
  },
  objects: {
    terrain,
    water,
    species: speciesPools,
    props: Object.fromEntries(propPools.map((pool) => [pool.entry.id, pool.mesh])),
    ruins: ruinPools,
    grass,
    clouds,
    cloudSea,
    sky,
    bird,
    companions,
    sun,
    groundShade: { map: aoMap, origin: aoOrigin.value, span: AO_SPAN },
  },
  get dayPhase() {
    return dayPhase;
  },
  set dayPhase(v) {
    dayPhase = ((v % 1) + 1) % 1;
  },
  set forceHigh(v) {
    forceHigh = v;
  },
  get running() {
    return running;
  },
  get paused() {
    return paused;
  },
  get disposed() {
    return disposed;
  },
  get audioState() {
    return audio.state;
  },
  get masterGain() {
    return audio.gain;
  },
  get clearance() {
    return state.y - heightAt(state.x, state.z);
  },
  flight,
  set forceLow(v) {
    forceLow = v;
  },
  get volume() {
    return audio.volume;
  },
  get muted() {
    return audio.muted;
  },
  seed,
  resumed,
  sunward,
  nightward,
  galaxyHeading: GALAXY_HEADING,
  isNight,
  aim: AIM,
  intro,
  opening: INTRO,
  title,
  titleCard: TITLE,
  get ready() {
    return ready;
  },
  solar,
  nightShare: NIGHT_SHARE,
  deck: DECK_Y,
  get cloudCycle() {
    return (((state.t - cloudOrigin) % 300) + 300) % 300;
  },
  get dayRate() {
    return dayRate;
  },
  biomeAt,
  terrainAhead,
  treeCell: TREE_CELL,
  trees: treeRecords,
  sites: ruinRecords,
  placed: propRecords,
  library: {
    swatches: SWATCH,
    biomes: BIOMES,
    species: SPECIES,
    ruins: RUINS,
    props: PROPS,
    validate: () => validateLibrary(registry),
    validateBaked,
  },
  sky: { sun: _sunDir, moon: _moonDir, events: SKY_EVENTS, galaxy },
  begin: () => beginBtn.click(),
  renderStyle: 'soft',
};
