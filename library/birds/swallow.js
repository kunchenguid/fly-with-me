// The swallow: small and fast. A scythe of swept, pointed wings, a deeply
// forked tail with two streamers, a steel-blue back with a cream rump over a
// cream belly and a rust throat. Quick shallow flickers that sweep the wings
// back, then long glides on a stiff crescent. A little larger than life so it
// still reads at the page's framing.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'swallow',
  name: 'swallow',
  scale: 1.08,
  colors: { body: 0x3f5178, wing: 0x3a4a6a, tip: 0x2f3d55, belly: 0xe8e1cd, throat: 0xb5624a, beak: 0x3a3a3a },
  body: { r: 0.3, at: [0, 0, 0], scale: [0.9, 0.85, 2.3] },
  head: { r: 0.2, at: [0, 0.13, 0.8], scale: [1, 0.95, 1.1] },
  beak: { r: 0.05, len: 0.18, at: [0, 0.09, 1.02], sides: 4 },
  marks: [
    { r: 0.3, at: [0, -0.07, 0.02], scale: [0.86, 0.75, 2.1], color: 'belly' },
    { r: 0.14, at: [0, 0.0, 0.76], scale: [0.95, 0.75, 0.9], color: 'throat' },
    { r: 0.16, at: [0, 0.1, -0.62], scale: [1.1, 0.55, 0.9], color: 'belly' },
  ],
  tail: [
    { count: 3, x: 0.06, z: -0.85, w: 0.08, len: 0.32, yaw: 0.08 },
    { x: -0.13, z: -1.2, w: 0.055, len: 0.72, yaw: -0.3 },
    { x: 0.13, z: -1.2, w: 0.055, len: 0.72, yaw: 0.3 },
  ],
  wings: {
    root: [0.22, 0.08, 0.1],
    colors: ['wing', 'wing', 'tip'],
    segments: [
      { len: 0.95, lead: 0.42, leadTip: 0.3, trail: -0.35, trailTip: -0.45 },
      {
        len: 1.05,
        lead: 0.3,
        leadTip: 0.05,
        trail: -0.45,
        trailTip: -0.62,
        primaries: { count: 3, x0: 0.3, dx: 0.3, z: -0.5, w: 0.09, len: 0.32, dlen: -0.02, yaw: -0.3, dyaw: -0.06 },
      },
      {
        len: 1.0,
        lead: 0.05,
        leadTip: -0.7,
        trail: -0.62,
        trailTip: -0.74,
        primaries: { count: 4, x0: 0.1, dx: 0.22, z: -0.56, w: 0.09, len: 0.34, dlen: -0.04, yaw: -0.4, dyaw: -0.08 },
      },
    ],
  },
  flight: { amp: 0.55, glideAmp: 0.1, rate: 10.0, glideRate: 2.0, ease: 5.0, rest: [0.0, -0.1, -0.14], seg: [1.0, 0.75, 0.65], lag: [0, 0.5, 0.9], sweep: 0.22, bob: 0.03 },
  flock: { scale: 0.9, spread: 0.7, wobble: 2.0 },
});
