// The registry. To add to the world, add a file under biomes/, species/,
// ruins/, props/, birds/, plumages/ or markings/ and one line here. The order
// of biomes and species is theirs to keep: it is not a priority. See
// CONTRIBUTING.md.

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

import dove from './plumages/dove.js';
import chestnut from './plumages/chestnut.js';
import ember from './plumages/ember.js';
import jay from './plumages/jay.js';
import kingfisher from './plumages/kingfisher.js';
import raven from './plumages/raven.js';
import snow from './plumages/snow.js';
import dawn from './plumages/dawn.js';
import moss from './plumages/moss.js';
import oriole from './plumages/oriole.js';
import plum from './plumages/plum.js';
import ash from './plumages/ash.js';
import sand from './plumages/sand.js';
import sky from './plumages/sky.js';
import coal from './plumages/coal.js';
import slate from './plumages/slate.js';

import plain from './markings/plain.js';
import cap from './markings/cap.js';
import mask from './markings/mask.js';
import throat from './markings/throat.js';
import collar from './markings/collar.js';
import bar from './markings/bar.js';
import barred from './markings/barred.js';
import rump from './markings/rump.js';

export const biomes = [wildsong, elderwood, steppe, badlands, dunes, frostpines, moor, autumn, jungle, blossom];
export const species = [oak, elder, pine, acacia, birch, palm, blossomTree, deadwood, cypress];
export const ruins = [ring, colonnade, gate, terrace, monolith];
export const props = [boulders, cairns];
// The first bird is the one a new visitor flies, in its own colors; the perch lists this order.
export const birds = [gull, eagle, swallow, crane, owl];
// Plumages recolor any kind; the perch lists them after the kind's own colors, in this order.
export const plumages = [dove, chestnut, ember, jay, kingfisher, raven, snow, dawn, moss, oriole, plum, ash, sand, sky, coal, slate];
// The first marking paints nothing: it is what a kind in its own colors wears.
// The rest are spread over the catalog by rule, so every kind shows each one.
export const markings = [plain, cap, mask, throat, collar, bar, barred, rump];
