// Throat: an accent throat and belly, the underside of head and body.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'throat',
  about: 'an accent throat and belly',
  body: (v, kind, kit) =>
    (kit.inside(v, kind.body) && v.y < kind.body.at[1] - 0.3 * kind.body.r * kind.body.scale[1]) ||
    (kit.inside(v, kind.head) && v.y < kind.head.at[1] - 0.4 * kind.head.r * kind.head.scale[1]),
});
