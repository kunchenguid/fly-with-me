// Storybook Punch: the world's look. Richer daylight blue, higher sat and
// contrast, stronger bloom, ACES kept. Palette nudges follow solar time so
// dawn and dusk stay gold and night stays dark. Cheap: copies at load plus a
// few ops in the existing display pass.

import { Color } from 'three';

export const LOOK = {
  sat: 1.26,
  exposure: 1.12,
  bloom: { strength: 0.34, radius: 0.68, threshold: 1.02 },
  materialGray: 0,
  materialPow: 0.84,
  sunI: 1.12,
  hemiI: 1.08,
  fog: 0.82,
  moonI: 1.05,
  shadowI: 1.08,
  post: {
    sat: 1.18,
    contrast: 1.14,
    mul: 0.98,
    lift: [0.006, 0.01, 0.016],
  },
  sky: {
    dayBlue: { hueTarget: 0.585, huePull: 0.78, sat: 0.26, light: -0.05 },
    dayHorizon: { hueTarget: 0.56, huePull: 0.5, sat: 0.16, light: -0.03 },
    twilightSat: 0.12,
    nightBlue: { sat: 0.04, light: -0.01 },
  },
  terrain: { sat: 0.08, light: 0.01 },
};

const hsl = { h: 0, s: 0, l: 0 };

function adjustColor(color, { hueTarget, huePull = 0, sat = 0, light = 0 }, amount = 1) {
  if (!color || amount <= 0) return color;
  color.getHSL(hsl);
  if (hueTarget != null && huePull) {
    let d = hueTarget - hsl.h;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    hsl.h = (hsl.h + d * huePull * amount + 1) % 1;
  }
  hsl.s = Math.min(1, Math.max(0, hsl.s + sat * amount));
  hsl.l = Math.min(1, Math.max(0.02, Math.min(0.96, hsl.l + light * amount)));
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color;
}

function dayWeight(t) {
  if (t <= 0.22 || t >= 0.8) return 0;
  if (t >= 0.34 && t <= 0.66) return 1;
  if (t < 0.34) return (t - 0.22) / 0.12;
  return (0.8 - t) / 0.14;
}

function twilightWeight(t) {
  const near = (center, width) => Math.max(0, 1 - Math.abs(t - center) / width);
  return Math.max(near(0.215, 0.05), near(0.25, 0.06), near(0.75, 0.06), near(0.785, 0.05));
}

function nightWeight(t) {
  if (t <= 0.17 || t >= 0.83) return 1;
  if (t >= 0.22 && t <= 0.8) return 0;
  if (t < 0.22) return (0.22 - t) / 0.05;
  return Math.min(1, (t - 0.8) / 0.03);
}

function adjustHex(hex, recipe, amount) {
  return adjustColor(new Color(hex), recipe, amount).getHex();
}

export function applyLook(look) {
  look.sat = LOOK.sat;
  look.fogDensity *= LOOK.fog;
  look.moon.intensity *= LOOK.moonI;
  for (const key of Object.keys(look.terrain)) {
    look.terrain[key] = adjustHex(look.terrain[key], LOOK.terrain, 1);
  }
  for (const key of look.keys) {
    const day = dayWeight(key.t);
    const dusk = twilightWeight(key.t);
    const night = nightWeight(key.t);
    const sky = LOOK.sky;
    if (day) {
      for (const field of ['zenith', 'upper', 'hemiSky']) adjustColor(key[field], sky.dayBlue, day);
      for (const field of ['horizon', 'below']) adjustColor(key[field], sky.dayHorizon, day * 0.85);
    }
    if (dusk) {
      for (const field of ['glow', 'horizonWarm', 'upperWarm', 'sun']) {
        adjustColor(key[field], { sat: sky.twilightSat }, dusk);
      }
    }
    if (night) {
      for (const field of ['zenith', 'upper', 'hemiSky']) adjustColor(key[field], sky.nightBlue, night);
    }
    key.sunI *= LOOK.sunI;
    key.hemiI *= LOOK.hemiI;
  }
  return look;
}
