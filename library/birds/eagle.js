// The eagle: a broad soarer. Plank wings held in a shallow V, a paler covert
// band, six slotted fingers at each tip, a broad fan tail, a pale head with a
// golden crown and nape over a dark body, a hooked yellow bill. Slow deep beats
// with a quick downstroke; mostly it glides.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'eagle',
  name: 'eagle',
  colors: { body: 0x5b4535, wing: 0x6e4d36, hand: 0x5e4230, covert: 0x8d6a45, tip: 0x35302b, head: 0xd9c9a2, crown: 0x9a7440, beak: 0xd0ae55, tail: 0x8a5a3a },
  body: { r: 0.5, at: [0, 0, 0], scale: [1.1, 0.95, 2.4] },
  head: { r: 0.26, at: [0, 0.26, 1.12], scale: [1, 0.95, 1.2], color: 'head' },
  beak: { r: 0.1, len: 0.4, at: [0, 0.2, 1.48], sides: 5, tilt: 0.4 },
  marks: [
    { r: 0.26, at: [0, 0.31, 1.05], scale: [0.95, 0.8, 1.05], color: 'crown' },
    { r: 0.11, at: [0, 0.22, 1.36], scale: [1.1, 0.9, 0.9], color: 'beak' },
  ],
  tail: [{ count: 7, x: 0.11, z: -1.25, w: 0.15, len: 0.7, yaw: 0.11, taper: 0.03, color: 'tail' }],
  wings: {
    root: [0.4, 0.14, 0.1],
    colors: ['wing', 'wing', 'wing'],
    segments: [
      { len: 1.5, lead: 0.85, leadTip: 0.8, trail: -0.75, trailTip: -0.75, bands: [{ to: 0.42, color: 'covert' }] },
      {
        len: 1.5,
        lead: 0.8,
        leadTip: 0.6,
        trail: -0.75,
        trailTip: -0.72,
        bands: [{ to: 0.4, color: 'covert' }],
        primaries: { count: 6, x0: 0.12, dx: 0.23, z: -0.6, w: 0.17, len: 0.52, dlen: -0.02, yaw: -0.15, dyaw: -0.04, color: 'wing' },
      },
      {
        len: 1.3,
        lead: 0.6,
        leadTip: 0.15,
        trail: -0.72,
        trailTip: -0.5,
        tip: 'round',
        round: 0.15,
        primaries: { count: 3, x0: 0.1, dx: 0.28, z: -0.5, w: 0.17, len: 0.45, dlen: -0.03, yaw: -0.3, dyaw: -0.08, color: 'hand' },
        fingers: { count: 6, root: [1.15, 0.05], from: -0.2, to: 1.35, len: 1.05, taper: 0.25, w: 0.1, thick: 0.03, lift: 0.12, color: 'tip' },
      },
    ],
  },
  flight: { amp: 0.4, glideAmp: 0.05, rate: 4.0, glideRate: 0.8, ease: 2.2, rest: [0.2, 0.04, 0.14], seg: [1.0, 0.5, 0.4], lag: [0, 0.7, 1.3], warp: 0.3, bob: 0.04 },
  flock: { scale: 0.85, spread: 1.4 },
});
