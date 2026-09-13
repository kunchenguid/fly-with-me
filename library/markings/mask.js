// Mask: an accent band through the eyes, across the front of the head.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'mask',
  about: 'an accent band through the eyes',
  body: (v, kind, kit) => {
    const head = kind.head;
    return kit.inside(v, head) && Math.abs(v.y - head.at[1]) < 0.28 * head.r * head.scale[1] && v.z > head.at[2] - 0.1 * head.r;
  },
});
