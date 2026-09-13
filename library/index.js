// The registry. To add to the world, add a file under biomes/, species/,
// ruins/, props/ or birds/ and one line here. The order of biomes and species is
// theirs to keep: it is not a priority. See CONTRIBUTING.md.

import wildsong from './biomes/wildsong.js';
import elderwood from './biomes/elderwood.js';
import steppe from './biomes/steppe.js';
import badlands from './biomes/badlands.js';
import dunes from './biomes/dunes.js';
import frostpines from './biomes/frostpines.js';
import moor from './biomes/moor.js';
import autumn from './biomes/autumn.js';
import jungle from './biomes/jungle.js';
import blossom from './biomes/blossom.js';

import oak from './species/oak.js';
import elder from './species/elder.js';
import pine from './species/pine.js';
import acacia from './species/acacia.js';
import birch from './species/birch.js';
import palm from './species/palm.js';
import blossomTree from './species/blossom.js';
import deadwood from './species/deadwood.js';
import cypress from './species/cypress.js';

import ring from './ruins/ring.js';
import colonnade from './ruins/colonnade.js';
import gate from './ruins/gate.js';
import terrace from './ruins/terrace.js';
import monolith from './ruins/monolith.js';

import boulders from './props/boulders.js';
import cairns from './props/cairns.js';

import gull from './birds/gull.js';
import eagle from './birds/eagle.js';
import swallow from './birds/swallow.js';
import crane from './birds/crane.js';
import owl from './birds/owl.js';

export const biomes = [wildsong, elderwood, steppe, badlands, dunes, frostpines, moor, autumn, jungle, blossom];
export const species = [oak, elder, pine, acacia, birch, palm, blossomTree, deadwood, cypress];
export const ruins = [ring, colonnade, gate, terrace, monolith];
export const props = [boulders, cairns];
// The first bird is the one a new visitor flies; the corner control cycles this order.
export const birds = [gull, eagle, swallow, crane, owl];
