# Contributing

Fly With Me is one engine reading a library of places and things. Most contributions are one file under `library/` and one line in `library/index.js`, a bird included; light, sky, fog, shadows, streaming and shaders belong to the engine and stay closed, which is what keeps every contribution looking like the same world. Read `VISION.md` first: a contribution is judged by whether it makes the viewer calmer or gives them a moment of awe, whether it keeps the world plausible, endless and coherent, and what it costs a machine that runs the page for hours. Quiet and rare beats busy and loud. The engine's own rules are in `AGENTS.md`.

## Running the source

Serve the repository with any static server and open `index.html`:

```bash
python3 -m http.server
```

The browser loads `src/` and `library/` as modules, so the source does not run from `file://`. Three.js r185.1 comes from a CDN through the import map in the page's head, so the first load needs a network connection. WebGPU is used over HTTPS or localhost and WebGL2 otherwise; `?webgl=1` forces WebGL2, `?seed=<number>` picks a world, and `?profile=1` arms the frame trace. The page validates the whole library as it loads and refuses a broken entry by name in the console before anything is drawn.

`node tools/bundle.mjs` (Node 18 or later, no dependencies) folds the page and every module it reaches into `dist/index.html`, one file that opens from anywhere, as one inline module script in dependency order with Three.js left on its CDN; `--check` says whether an existing bundle is current. It folds only static `import ... from` and `export const|let|function|class|default`, so keep modules to those forms: no dynamic import, no `import.meta`, and top-level await only in the entry. `dist/` is generated and ignored.

## The contract

`library/contract.js` is the whole contract: the swatch book, the palette envelope, the budgets, the shape of each entry, and the validator. Read it before writing an entry.

- **Colors** are swatch names (`'meadow'`, `'rockCold'`) or hex values inside the envelope: saturation at most 0.62, lightness between 0.18 and 0.93, measured in sRGB. No neon, no black, no white ground. Named tints such as `'white'` are multipliers over painted textures and are allowed by name.
- **Budgets**: a tree crown has at most 200 painted cards; a baked prop or ruin type at most 6,000 triangles; a prop kind at most 2,000 instances in the streamed ring; a ruin type at most 8 sites in the ring. The engine measures every baked geometry and refuses one over its budget by name.
- **Randomness**: use the random stream the kit gives you. It is seeded per entry and per cell, so a change to your object never reshuffles the trees, and the same cell always holds the same thing.
- **Materials**: there are none to write. Kits produce vertex-colored geometry; the engine lights it with its own soft material, fogs it, shadows it, and shrinks it into the ground at the edge of the streamed ring.

## A biome

`library/biomes/<id>.js`, data only: where it lives in climate (temperature, moisture, region, each 0..1), what its ground looks like, which species grow there and how thickly, the grass, the props, and how welcome the old builders were. Copy `library/biomes/autumn.js`.

Biomes are soft cells in the three-axis climate, three slow fields each a dozen kilometers wide and warped so borders wander; the borders are bands of a couple of hundred meters where ground, species and grass blend. Two biomes with the same temperature and moisture can differ on the third axis, region: that is how the autumn vale and the oak hills both exist. Put a new biome where the climate makes sense (frost is cold, dunes are hot and dry) and it will sit between its neighbors without a seam.

## A tree species

`library/species/<id>.js`. Two ways:

- **Data for the tree kit**: a trunk, limbs, and a crown shape, `dome` (cards around each limb tip), `cone` (cards along the trunk), `fan` (a ring of fronds at the top) or `bare`, with a leaf palette from `LEAVES`. Copy `library/species/pine.js` or `oak.js`.
- **Your own generator**: give `bake(kit)` and grow the tree any way you like (an L-system, space colonization, a hand-placed silhouette). The kit gives you `kit.branch(from, to, radiusStart, radiusEnd)` to lay wood along a curve, `kit.card(center, normal, rotationOrMatrix, size)` to hang a painted card, `kit.random()` and `kit.matrix(...)`. A tree that only does those two things gets the crown morph between near and far, the ring shrink, shadows and the climate tint for free.

Every species is one baked tree, instanced whole and tinted per instance by its climate (`tint.cold`, `tint.warm`, `tint.dry`). Keep tops inside what a bird climbing at 11 m/s can clear: roughly 50 m at the largest scale.

## A ruin type

`library/ruins/<id>.js`. One site type of the lost civilization: its share of the sites found (`odds`), the ground it needs (`slope`, and `hill` for a local top or level ground), its `footprint` for clearance, `sunward` if it should face the sunrise, and `build(kit)`, which composes the site around the origin from the masonry kit: `kit.pillar`, `kit.block`, `kit.standing`, `kit.fallen`, and `kit.raw(geometry, ...)` for anything else. The kit's stone is one weathered masonry for every site, mossy at the foot, so every ruin reads as the work of the same builders. Copy `library/ruins/gate.js`.

Sites are rare on purpose. Do not make one type loud to be seen more often; make it read from cruise height, a hundred meters up, and let rarity do the rest.

## Any other object

`library/props/<id>.js`. Two functions:

- `bake(kit)` builds the geometry once. The kit has `kit.THREE` for geometry classes, `kit.merge(parts)` to fold `{ geometry, matrix, color }` parts into one vertex-colored geometry, `kit.color(swatchOrHex)`, `kit.matrix(x, y, z, sx, sy, sz, rx, ry, rz)` and `kit.random(name)`.
- `place(cell, kit)` is called for every 96 m cell in the streamed ring and returns where instances stand: `{ x, z, yaw, scale, sink, tint }`. The cell tells you its climate: `cell.weights`, `cell.biome(id)`, `cell.mix(id)` (this prop's density here, from each biome's `props`), `cell.blend(pick)` for a climate-blended color, and the ground: `cell.height(x, z)`, `cell.slope(x, z)`, `cell.land(x, z)`. Use `cell.roll()` for randomness.

Give `budget: { instances, triangles }` and, if the bird and the camera should keep clear of it, `obstacle: { radius, height }`. Add the prop's density to the biomes that should have it, under `props`. Copy `library/props/boulders.js`.

## A bird

`library/birds/<id>.js`, data only, over the engine's bird kit: an ellipsoid `body`, a `head` on an optional `neck`, a `beak`, `marks` (a belly, a face, an eye), a `tail` of blade sets, optional trailing `legs`, and `wings` of three hinged segments per side, each a membrane with a root chord and a tip chord, a `round` tip if you want one, `primaries` along its trailing edge, `fingers` radiating from the tip and a covert band; then a `flight` profile, the wingbeat's amplitude and rate flapping and gliding, the rest pose, and each segment's weight and lag in the traveling wave; and `flock`, how companions of the kind are sized and spaced. Copy `library/birds/gull.js`, the bird the page has always flown, or `crane.js` for a neck and legs.

Colors are named in `colors` and must sit inside the envelope. A kind is at most 4,000 triangles, 12 m across after its `scale`, and beats at most 15 radians per second; the engine measures the baked kind and refuses one over budget by name. `below` says how far legs or a tail hang under the body, so the flight keeps them off the ground; `look` moves where the camera looks, never where it hangs, so a long neck sits in frame. Every bird on the page is one kind at a time, the flock included; the viewer picks it from the perch behind the corner control after Begin, in its own colors or in any plumage, and the page remembers both. The first entry in `library/index.js`, in its own colors, is the bird a new visitor gets.

## A plumage

`library/plumages/<id>.js`, five colors and a `name` for the perch: `body`, `wing`, `tip`, `beak` and an `accent`, each inside the envelope. A plumage dresses any kind. Every color a kind names is sorted into one of four roles (the body family: body, belly, face, head, neck, throat, crown, cap, eye, rump, mantle; the wing family: wing, hand, covert, tail, legs; then tip and beak), and its offset from the kind's own role color, in hue, saturation and lightness, is carried onto the plumage's color for that role and clamped into the envelope. A covert band a shade paler than the gull's wing stays a shade paler in every plumage, so a kind never needs a table per plumage. Copy `library/plumages/dove.js`.

## A marking

`library/markings/<id>.js`, an `about` and a rule saying where a plumage's accent goes. `body(v, kind, kit)` sees a vertex in bird space with the kind's data and `kit.inside(v, part)`, which tells whether it lies in one of the kind's ellipsoid parts; `wing(v, segment, i, kit)` sees a vertex in a wing segment's pivot frame with that segment's data (its chords `lead`, `trail`, `leadTip` and `trailTip`, its `len` and its `primaries`). Where the rule returns true the accent is painted over the kit's own colors after the bird is built. The first marking in `library/index.js` must paint nothing: it is what a kind in its own colors wears. Every kind and plumage pair gets a marking by rule, spread so each kind shows every marking. Copy `library/markings/cap.js` for a body rule or `bar.js` for a wing rule.

## Checking changes

Serve the repository, then run the browser checks in a fresh tab. With the Chrome DevTools AXI CLI:

```bash
export CHROME_DEVTOOLS_AXI_SESSION=fly-with-me-checks
npx -y chrome-devtools-axi open "http://localhost:8000/index.html?seed=42&check=$(date +%s)"
npx -y chrome-devtools-axi eval "$(<tests/flight-checks.js)"
```

Repeat with `webgl=1` and with seeds `0` and `4294967295`, then once on the bundle at `http://localhost:8000/dist/index.html?seed=42`, which is what Pages serves. The script clears the page's memory and runs every check in a fresh frame of the same address, so an earlier run cannot leak into it, then reopens the world twice to check what is remembered. The checks consume the running page, its geometry and its pixels, never source text. They cover the veil, the gate and Begin; the opening and the title card stepped from Begin, with a small render of the scene above the clouds; the library validating clean and refusing a neon ground and an unknown species by name; biome weights, species placement, ruins rare but present over a seventy-kilometer sweep, and boulders and ruins on the drawn surface and counting as obstacles; six simulated minutes of streaming with a forced low pass, and crowns surviving ring rebuilds; the ground shade and the shadow frame; the camera rigid on the bird, and every orbit and steer; the sunrise, moonset and nightfall pulls; the quarter night and the sun's steady pace; the bird kinds, plumages and markings, refused by name when broken, the perch behind the corner control dressing the bird and its flock in a kind and a plumage, a legged kind's floor, a kind's look-at leaving the camera on the bird, and the chosen kind and plumage remembered; clearance, teardown, memory and resume; and the water's color, motion, pause and night response on a real coast of each seed. The visibility handler is tested with a synthetic hidden state because headless focus emulation keeps tabs visible; native background suspension remains a manual browser check.

After sky changes, also run `node tests/galaxy-checks.mjs` and evaluate `tests/night-checks.js` the way the flight checks are, over the same seed, backend and bundle matrix. The CPU checks exercise deterministic, bounded, periodic dust and light, and the brightest place the flight steers by; the browser checks read pixels for stars and colored structure under painted clouds, stability while paused, no stellar light in daylight, extinction through the cloud deck, fixed allocations and full disposal.

By hand: compare renders with the approved looks described in `AGENTS.md`, at the same seed and vantage, and check mobile and landscape layouts, native dragging, cloud crossings and a full day cycle. Physical-phone performance needs a device; no universal 60 fps claim is made.

## Measuring what a change costs

`?profile=1` arms the renderer's timestamp queries, a smoothed summary in `window.__fly.perf` and the raw per-frame trace in `window.__fly.trace`. Two dev-only scripts read them, and the bundler never folds `tools/`. `tools/bench.js` holds the bird at five fixed vantages of one seed's world and reports frame time and its percentiles, main-thread simulation and render submission, the GPU's own frame cost, draw calls, triangles, and the share of each second the GPU and the main thread spend busy, which is the practical stand-in for power and fan. `tools/parity.js` reads back the finished eight-bit picture at the same vantages, tone mapping, bloom, the soft reconstruction and FXAA included: run it once with `{ save: true }` to keep a build as the reference, then again on a changed build for the difference in screen levels per vantage, beside its own noise floor. `docs/perf-notes.md` says why the tools work that way and what they have found; read it before optimizing and add to it after.

Both need a fresh world, so clear `fly-with-me-resume` before loading, and a browser started without vsync when the question is what a frame costs rather than what the display allows:

```bash
export CHROME_DEVTOOLS_AXI_SESSION=fly-with-me-bench CHROME_DEVTOOLS_AXI_HEADED=1
export CHROME_DEVTOOLS_AXI_CHROME_ARGS="--disable-gpu-vsync --disable-frame-rate-limit"
npx -y chrome-devtools-axi open "http://localhost:8000/index.html?seed=42&profile=1"
npx -y chrome-devtools-axi eval "$(<tools/bench.js)"
```

## The launch media

`node tools/capture-launch-media.mjs` records the film and the still the project is shown with, from the page itself. It serves the page, opens it in a headless Chrome of its own, presses Begin and records a world's first minute at 1920x1080 and sixty frames a second with the sound the page synthesizes, then flies the same world again for a still. It writes `media/fly-with-me-launch.mp4` and `media/hero.png`; `media/` is not committed, and `assets/hero.png`, the image the README opens with, is updated by hand by copying over a still you like. It needs Node 22, a Chrome and an ffmpeg, nothing else, and nothing it does reaches the published page.

- `--seconds 60` how long the film runs, counted from Begin
- `--seed 42` which world, and `--hero-at 26` the second of the flight the still is taken at
- `--only video` or `--only hero`; `--out media`, or `--video <path>` and `--hero <path>`
- `--loudness -16` the delivery loudness in LUFS and `--ceiling -2` the true-peak ceiling; the gain is measured from the take, not typed in
- `--chrome <path>` when Chrome lives somewhere unusual, and `--keep` to leave the raw capture beside the cut

The film is the engine's canvas composited with the page's own title card, lifted out of the live DOM so the type is the real thing; the veil, the Begin gate and the controls are never drawn into it. The tool's header says why it records the way it does.

## Publishing

`.github/workflows/pages.yml` runs the bundler and publishes `dist/` to GitHub Pages on every push to `main`, or by hand from the Actions tab. One-time setup: **Settings > Pages > Build and deployment > Source: GitHub Actions**. Every path in the page is relative, so it works from a project subpath such as `https://<user>.github.io/fly-with-me/`, and the share link carries whatever address it is served from. Pages serves over HTTPS, which enables WebGPU.

## Before you open a pull request

Run the browser checks on both backends and the three seeds, and once on the bundle. Then fly it: a contribution is judged by eye at seed 42, at cruise height and on a low pass.
