// Bar: an accent bar across the inner two wing segments, a little behind
// the leading edge.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'bar',
  about: 'an accent bar across the wing',
  wing: (v, segment, i) =>
    i < 2 &&
    v.z > segment.trail + (segment.lead - segment.trail) * 0.36 &&
    v.z < segment.trail + (segment.lead - segment.trail) * 0.56 &&
    Math.abs(v.x) <= segment.len,
});
