// The gull: the bird the page has always flown. Cream body, slate wings, a
// five-blade tail; a generalist that reads at every height. First in the
// registry, so it is the bird a new visitor gets.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'gull',
  name: 'gull',
  colors: { body: 0xdad9bc, wing: 0x566e73, tip: 0x566e73, beak: 0xbda66a },
  body: { r: 0.45, at: [0, 0, 0], scale: [1.0, 0.85, 2.3] },
  head: { r: 0.24, at: [0, 0.22, 1.05], scale: [1, 0.95, 1.15] },
  beak: { r: 0.09, len: 0.42, at: [0, 0.18, 1.42], sides: 4 },
  tail: [{ count: 5, x: 0.12, z: -1.15, w: 0.12, len: 0.6, yaw: 0.06 }],
  wings: {
    root: [0.32, 0.12, 0.08],
    colors: ['wing', 'wing', 'tip'],
    segments: [
      { len: 1.3, lead: 0.65, leadTip: 0.6, trail: -0.65, trailTip: -0.65 },
      {
        len: 1.3,
        lead: 0.6,
        leadTip: 0.35,
        trail: -0.65,
        trailTip: -0.65,
        primaries: { count: 5, x0: 0.16, dx: 0.21, z: -0.57, w: 0.16, len: 0.47, dlen: -0.025, yaw: -0.2, dyaw: -0.05 },
      },
      {
        len: 1.1,
        lead: 0.35,
        leadTip: -0.35,
        trail: -0.65,
        trailTip: -0.65,
        primaries: { count: 5, x0: 0.16, dx: 0.21, z: -0.57, w: 0.16, len: 0.39, dlen: -0.025, yaw: -0.2, dyaw: -0.05 },
      },
    ],
  },
  flight: { amp: 0.48, glideAmp: 0.09, rate: 6.5, glideRate: 1.4, ease: 3.0, rest: [0.14, -0.08, -0.05], seg: [1.0, 0.55, 0.45], lag: [0, 0.9, 1.6], bob: 0.06 },
  flock: { scale: 0.8, spread: 1.0 },
});
