// The owl: broad rounded wings with soft feathered edges, a short square tail,
// a big round head with a pale heart face and dark eyes, a tawny back and
// crown over buff underparts, dark enough to read over sand by day. Slow
// silent beats with a loose soft glide.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'owl',
  name: 'owl',
  colors: { body: 0xe3d5b8, wing: 0x9a7546, tip: 0x6e5236, face: 0xf2ead9, eye: 0x3b342c, beak: 0xb7a48a },
  body: { r: 0.5, at: [0, -0.02, -0.05], scale: [1.05, 1.0, 1.9] },
  head: { r: 0.36, at: [0, 0.2, 0.9], scale: [1.15, 1.0, 1.0] },
  beak: { r: 0.04, len: 0.16, at: [0, 0.12, 1.3], sides: 4, tilt: 0.7 },
  marks: [
    { r: 0.5, at: [0, 0.1, -0.08], scale: [0.98, 0.85, 1.78], color: 'wing' },
    { r: 0.36, at: [0, 0.3, 0.84], scale: [1.1, 0.85, 0.92], color: 'wing' },
    { r: 0.33, at: [0, 0.2, 1.14], scale: [1.05, 0.95, 0.35], color: 'face' },
    { r: 0.06, at: [0.13, 0.27, 1.26], scale: [1, 1, 0.7], color: 'eye' },
    { r: 0.06, at: [-0.13, 0.27, 1.26], scale: [1, 1, 0.7], color: 'eye' },
  ],
  tail: [{ count: 5, x: 0.13, z: -1.0, w: 0.16, len: 0.42, yaw: 0.09, color: 'wing' }],
  wings: {
    root: [0.34, 0.14, 0.0],
    colors: ['wing', 'wing', 'wing'],
    segments: [
      { len: 1.15, lead: 0.95, leadTip: 0.9, trail: -0.8, trailTip: -0.8 },
      {
        len: 1.15,
        lead: 0.9,
        leadTip: 0.72,
        trail: -0.8,
        trailTip: -0.78,
        primaries: { count: 5, x0: 0.12, dx: 0.22, z: -0.62, w: 0.19, len: 0.42, dlen: -0.02, yaw: -0.12, dyaw: -0.04, color: 'tip' },
      },
      {
        len: 0.95,
        lead: 0.72,
        leadTip: 0.2,
        trail: -0.78,
        trailTip: -0.48,
        tip: 'round',
        round: 0.32,
        primaries: { count: 5, x0: 0.08, dx: 0.2, z: -0.5, w: 0.18, len: 0.4, dlen: -0.04, yaw: -0.3, dyaw: -0.1, color: 'tip' },
      },
    ],
  },
  flight: { amp: 0.42, glideAmp: 0.06, rate: 3.4, glideRate: 0.9, ease: 2.5, rest: [0.12, -0.02, -0.04], seg: [1.0, 0.6, 0.5], lag: [0, 0.6, 1.1], warp: 0.1, bob: 0.05 },
  flock: { scale: 0.85, spread: 1.0 },
});
