// Collar: an accent ring around the body where the neck meets it.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'collar',
  about: 'an accent ring at the neck',
  body: (v, kind, kit) => {
    const neck = kind.body.at[2] + 0.62 * kind.body.r * kind.body.scale[2];
    return kit.inside(v, kind.body) && v.z > neck - 0.1 && v.z < neck + 0.12;
  },
});
