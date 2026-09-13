# Snow and range review and validation

The captain asked for snow-capped mountains that look the way they should, and then, on the first board, for peaks closer to Mount Everest and K2. The prototypes ran on a scratch worktree in the page itself, at seed 42, on the current hills and on two new terrains, every frame at the same place, heading and hour, and were presented on a Lavish board (four shading studies, three terrains, 282 frames across two peaks, three hours and four distances). Five photographs of Everest and K2 from Wikimedia Commons were the reference for the second revision; they were reference only and are never loaded. The captain chose the Himalayan shading on the pyramid peaks, taller and sharper than shown, with the summit plume. Only that material ships; the other studies, the switches and the review images stay in the scout's worktree and its report.

## What was wrong

Three things, and only one was the shader. No summit reached the 520 m cloud deck (462 to 537 m across six seeds), so there was no such thing as a snow-capped mountain here, only a snow-dusted hill. The snow line was `560 - 420 × temp` on the altitude-cooled temperature field, so colder country put its snow higher and the cold hills had no cap at all. And the snow was one flat off-white swatch mixed in over an 80 m band, with no shade, rock or exposure.

## What ships

- The range: a warped four-octave ridged multifractal massif (640 m of lift) carrying a lattice of pyramidal summits (`pyramidPeaks`, one candidate per 2.4 km cell, three or four planar faces, reach 850 m, profile power 1.7, 900 m of lift), evaluated in barely warped coordinates, the massif quieting under each pyramid. Measured with the engine's own noise over an 80 km square at 80 m for seeds 42, 0, 4294967295 and 7: tallest summits 1043, 1083, 1038 and 1045 m; 0.14, 0.14, 0.15 and 0.09% of cells above the deck; of the ground above 450 m, 17 to 28% under 25 degrees, 30 to 33% between 25 and 41 degrees, 39 to 53% steeper.
- One snow line, `snowLineAt`: `200 + 380 × T` from the climate's own temperature with the altitude cooling undone, so frost-pine country holds snow from about 260 m and dunes only above 520 m. The tree line follows it (trees thin over the last 120 m below it and the first 60 m into the snow).
- The snow rule in the terrain's `colorNode`: exposure moves the line (sunny faces 50 m higher, hollows lower, crests bare, a slow wobble); snow holds fully under 25 degrees; steeper faces are rock with snow in fall-line flutes (six fixed stripe directions blended by the downhill direction, in patches), on thin level strata, and along the crests; a dark blue-grey alpine rock band 320 m under the line, warmer toward the sun, with an ochre band across the upper faces; blue-white seracs in the deep hollows of cold country; warm white snow toward the sun, sky-blue in its own shade with a sky lift through the terrain's emissive, alpenglow when the sun sits low.
- Spindrift plumes on the tallest summits above 700 m in the heightfield window (up to eight), one instanced ribbon each, rescanned every two seconds of simulation time and at once when the clock is set back.
- The flight looks 2.2 km ahead for walls (`climbAhead`) and a steered climb eases off at 1140 m instead of 940.

## Executable checks

`tests/flight-checks.js` gained a snow block of seven checks. It walks the rolling CPU window toward the coldest ground until a 32 m block of gentle ground stands well over the line (the range is steep, so a gentle snowfield is a cold-country thing, and the shader's exposure and wobble move the line by up to 100 m, so the highest such block wins), then toward the tallest ground until a summit above the deck is in reach, then toward the warmest. It asserts that the walk crossed cold and warm country by the library's own biome climates; that the snow line, read by `snowLineAt` inside the window that holds each cell, sits lower in the coldest low ground than in the warmest; that a snowfield, bare ground in the snowfield's own country (where the old rule put the snow) and a summit were found; that the snowfield, looked at straight down from 100 m over isolated terrain at noon, renders brighter than the bare ground by a quarter and near-neutral in the scene's own light (the capture comes before the display chain, where the warm sun and cyan sky make a white read a little green); and that the tallest summit in reach carries a plume. Every check also runs the six-minute flight over the new range, where `maxRise` under one meter says no wall hopped the bird.

The plume check found an engine gap on the way: the plume rescan was throttled on absolute simulation time, so a clock set back (the checks restore state between blocks) froze the plumes for as long as the rewind. The scan now also runs at once when the clock moves back.

Results on the shipped build, served from the source page and, once, from the bundle:

| run | checks |
| --- | --- |
| seed 42, WebGPU | 241 pass |
| seed 42, WebGL2 | 242 pass |
| seed 0, WebGPU | 241 pass |
| seed 0, WebGL2 | 242 pass |
| seed 4294967295, WebGPU | 241 pass |
| seed 4294967295, WebGL2 | 242 pass |
| the bundle, seed 42, WebGPU | 241 pass |

The seed 42 records, both backends: `maxRise` 0.55 m over the six minutes, the bird's lowest clearance 23.0 m and the camera's 28.1 m, the bird's highest point 718 m (the opening's climb, not terrain), the lowest ground under it 35 m, the lowest ground ahead 32 m, and the mesh never closer than 60 m. `tests/night-checks.js` on seed 42, WebGPU: 24 pass, since the plumes draw into the sky.

## Performance evidence

The snow's noise taps, ungated, cost 3 ms of GPU time a frame over lowland, twelve times the old terrain; behind a branch on the line they cost 0.4 ms there. `tools/bench.js` at its five vantages of seed 42, main against this branch in one session, vsync off, 1280 by 720 at one device pixel: GPU frame 5.4 ms mean and 4.4 ms at the quiet fifth percentile on main, 5.9 and 5.0 ms on the branch, half a millisecond a frame, the GPU busy 71% to 75% of the second, the main thread unchanged. A 6 km hop with its whole step took 235 to 313 ms on main and 221 to 285 ms on the branch, so the pyramids' CPU cost does not show. The full tables and how the gate was found are in `docs/perf-notes.md`.

## Before and after

At the same seed and vantage (seed 42, the revision 1 review peaks, noon, 1.8 to 4.5 km) the rolling green hills of the cold peak become a snow-capped spire with a dark shaded face, and the warm steppe hill a pyramid over the dunes. `tools/parity.js` at its five vantages reads the change in screen levels below.

At 384 by 216, the main build (`3fe3833`) saved as the reference and this branch compared at the same five vantages of seed 42, both from the same world start, in screen levels (0 to 255); the noise floor is two reads of one build moments apart.

| vantage | mean change | pixels over one level | worst pixel | floor (mean, over one) |
| --- | --- | --- | --- | --- |
| dawn | 2.09 | 19.7% | 155 | 0.11, 1.5% |
| noon | 2.24 | 20.2% | 171 | 0.24, 3.6% |
| far | 1.34 | 8.4% | 108 | 0.04, 0.3% |
| above the deck | 0.02 | 0.1% | 12 | 0.02, 0.2% |
| night | 0.46 | 6.4% | 50 | 0.02, 0.2% |

Read: the picture moved where the range stands in view, a fifth of the ground vantages' pixels at dawn and noon and a twelfth at the far vantage, and nowhere else: above the deck the frame is at its noise floor, and the night moved by half a level where the new silhouette meets the sky. The sky, the water, the trees and the grade are untouched.
