// The crane: neck stretched out ahead, legs trailing behind, broad rounded
// wings with black fingered tips, gray with a dark cap and a small red crown.
// Slow deep rowing beats, and a V when the flock comes. The camera looks a
// little ahead of its center so the head sits in frame, and its legs count in
// the bird's own floor.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'crane',
  name: 'crane',
  colors: { body: 0x9d9e99, wing: 0x84878a, hand: 0x6f7376, tip: 0x3a3a38, neck: 0xa9aaa5, cap: 0x3a3632, crown: 0xb54a3f, beak: 0x5a5148, legs: 0x3a3532 },
  body: { r: 0.42, at: [0, 0, 0], scale: [1.0, 0.9, 2.2] },
  neck: { from: [0, 0.18, 0.85], to: [0, 0.5, 2.55], r0: 0.17, r1: 0.1, arch: 0.18, color: 'neck' },
  head: { r: 0.15, at: [0, 0.52, 2.66], scale: [0.9, 0.9, 1.35], color: 'neck' },
  beak: { r: 0.05, len: 0.62, at: [0, 0.48, 3.15], sides: 5, tilt: 0.06 },
  marks: [
    { r: 0.15, at: [0, 0.55, 2.62], scale: [0.85, 0.7, 1.1], color: 'cap' },
    { r: 0.08, at: [0, 0.64, 2.66], scale: [0.9, 0.5, 1.2], color: 'crown' },
  ],
  legs: { from: [0.1, -0.22, -0.55], to: [0.13, -0.38, -2.35], r: 0.035, foot: [0.05, 0.03, 0.14], color: 'legs' },
  below: 0.45,
  look: { rise: 0.9, ahead: 1.3 },
  tail: [{ count: 5, x: 0.12, z: -1.12, w: 0.13, len: 0.36, yaw: 0.08, droop: 0.02, color: 'wing' }],
  wings: {
    root: [0.35, 0.14, 0.1],
    colors: ['wing', 'wing', 'wing'],
    segments: [
      { len: 1.3, lead: 0.8, leadTip: 0.78, trail: -0.7, trailTip: -0.7 },
      {
        len: 1.3,
        lead: 0.78,
        leadTip: 0.62,
        trail: -0.7,
        trailTip: -0.7,
        primaries: { count: 5, x0: 0.14, dx: 0.24, z: -0.6, w: 0.16, len: 0.42, dlen: -0.02, yaw: -0.15, dyaw: -0.04, color: 'wing' },
      },
      {
        len: 1.25,
        lead: 0.62,
        leadTip: 0.1,
        trail: -0.7,
        trailTip: -0.5,
        tip: 'round',
        round: 0.2,
        primaries: { count: 3, x0: 0.12, dx: 0.28, z: -0.55, w: 0.16, len: 0.42, dlen: -0.03, yaw: -0.28, dyaw: -0.08, color: 'hand' },
        fingers: { count: 6, root: [1.1, 0.0], from: -0.1, to: 1.25, len: 0.9, taper: 0.2, w: 0.1, thick: 0.03, lift: 0.06, color: 'tip' },
      },
    ],
  },
  flight: { amp: 0.5, glideAmp: 0.07, rate: 3.6, glideRate: 0.8, ease: 2.5, rest: [0.1, -0.06, -0.02], seg: [1.0, 0.6, 0.5], lag: [0, 0.8, 1.5], warp: 0.2, bob: 0.05 },
  flock: { scale: 0.85, spread: 1.25 },
});
