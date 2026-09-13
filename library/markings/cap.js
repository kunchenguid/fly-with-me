// Cap: an accent crown over the top of the head.
import { defineMarking } from '../contract.js';

export default defineMarking({
  id: 'cap',
  about: 'an accent crown',
  body: (v, kind, kit) => kit.inside(v, kind.head) && v.y > kind.head.at[1] + 0.2 * kind.head.r * kind.head.scale[1],
});
