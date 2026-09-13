// Barred: every other primary feather in the accent.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'barred',
  about: 'alternating primaries',
  wing: (v, segment) => {
    const p = segment.primaries;
    if (!p || v.z > segment.trailTip - 0.02 || Math.abs(v.x) > segment.len) return false;
    return Math.round((Math.abs(v.x) - p.x0) / p.dx) % 2 === 1;
  },
});
