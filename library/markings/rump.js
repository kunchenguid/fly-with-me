// Rump: an accent rump and tail, the back third of the body and everything
// behind it.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'rump',
  about: 'an accent rump and tail',
  body: (v, kind, kit) =>
    (kit.inside(v, kind.body) && v.z < kind.body.at[2] - 0.35 * kind.body.r * kind.body.scale[2]) || v.z < kind.body.at[2] - kind.body.r * kind.body.scale[2] * 0.98,
});
