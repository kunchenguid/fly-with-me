// Noise on the CPU. The terrain, the climate and every placement read these;
// the GPU only reads what the CPU wrote. Nothing here depends on the page.

export function hash2(ix, iz, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const GRAD = new Float32Array(64 * 2);
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  GRAD[i * 2] = Math.cos(a);
  GRAD[i * 2 + 1] = Math.sin(a);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function perlin2(x, z, s) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const u = fade(fx),
    v = fade(fz);
  const g00 = hash2(ix, iz, s) & 63,
    g10 = hash2(ix + 1, iz, s) & 63,
    g01 = hash2(ix, iz + 1, s) & 63,
    g11 = hash2(ix + 1, iz + 1, s) & 63;
  const n00 = GRAD[g00 * 2] * fx + GRAD[g00 * 2 + 1] * fz;
  const n10 = GRAD[g10 * 2] * (fx - 1) + GRAD[g10 * 2 + 1] * fz;
  const n01 = GRAD[g01 * 2] * fx + GRAD[g01 * 2 + 1] * (fz - 1);
  const n11 = GRAD[g11 * 2] * (fx - 1) + GRAD[g11 * 2 + 1] * (fz - 1);
  const nx0 = n00 + (n10 - n00) * u,
    nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.6; // roughly [-1, 1]
}

export function fbm(x, z, s, oct, lac = 2.0, gain = 0.5) {
  let a = 1,
    f = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += perlin2(x * f, z * f, s + i * 131) * a;
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm;
}

export function ridged(x, z, s, oct) {
  let a = 1,
    f = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < oct; i++) {
    const noise = perlin2(x * f, z * f, s + i * 977);
    const n = 1 - Math.sqrt(noise * noise + 0.012); // rounded, eroded ridge crests
    sum += n * n * a;
    norm += a;
    a *= 0.55;
    f *= 2.1;
  }
  return sum / norm; // [0, 1], sharp ridges near 1
}

export function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// A small deterministic random stream; every baked asset and every placement
// cell has its own, so a change in one never reshuffles another.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A ridged multifractal: finer octaves only sharpen where the coarser ridge
// already stands, so crests grow arêtes and gullies while the valleys stay
// quiet. Finer octaves get rounder crests, so a crease never falls between two
// 16 m samples and saw-tooths along the grid.
export function ridgedMulti(x, z, s, oct) {
  let a = 1,
    f = 1,
    sum = 0,
    norm = 0,
    weight = 1;
  for (let i = 0; i < oct; i++) {
    const noise = perlin2(x * f, z * f, s + i * 977);
    let n = 1 - Math.sqrt(noise * noise + 0.012 + 0.03 * i);
    n = n * n * weight;
    weight = Math.min(1, Math.max(0, n * 1.7));
    sum += n * a;
    norm += a;
    a *= 0.5;
    f *= 2.05;
  }
  return sum / norm; // [0, 1], sharp ridges near 1
}

// The range's summits: a jittered lattice, one candidate per cell, each a
// pyramid of three or four planar faces (the largest of the faces' plane
// distances from the apex), so its ridges are sharp creases from the apex
// down and each face leans at its own angle; the profile steepens toward the
// top. Neighbours join through a soft maximum so two pyramids share a ridge
// and a valley floor rather than a crease. Returns 0..1 of the lift.
export function pyramidPeaks(x, z, s, cell, radius, power) {
  const cx = Math.floor(x / cell),
    cz = Math.floor(z / cell);
  let acc = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i,
        gz = cz + j;
      const u = (k) => hash2(gx, gz, s + k) / 4294967296;
      const dx = x - (gx + 0.25 + 0.5 * u(0)) * cell,
        dz = z - (gz + 0.25 + 0.5 * u(1)) * cell;
      if (dx * dx + dz * dz >= radius * radius * 2.25) continue;
      const faces = u(2) < 0.45 ? 3 : 4,
        spin = u(3) * 6.2832,
        amp = 0.55 + 0.45 * u(4);
      let de = 0;
      for (let f = 0; f < faces; f++) {
        const a = spin + (f + 0.3 * (u(5 + f) - 0.5)) * (6.2832 / faces);
        const reach = radius * (0.7 + 0.6 * u(9 + f)) * (0.6 + 0.4 * amp);
        de = Math.max(de, (dx * Math.cos(a) + dz * Math.sin(a)) / reach);
      }
      const f = Math.pow(Math.max(0, 1 - de), power) * amp;
      const k = 0.06,
        hmix = Math.max(k - Math.abs(acc - f), 0) / k;
      acc = Math.max(acc, f) + hmix * hmix * k * 0.25;
    }
  return acc;
}
