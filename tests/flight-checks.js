async function flightChecks() {
  // Run in a main-page tab, on either backend. No source-text assertions. The page
  // remembers settings and flights, so every check runs in a fresh frame of the same
  // address after clearing that memory; an earlier run cannot leak into this one.
  // The end reopens the world twice to check what is remembered.
  const checks = [];
  const assert = (condition, name, detail = '') => {
    if (!condition) throw new Error(detail ? `${name} (${detail})` : name);
    checks.push(name);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const openWorld = async (url) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
    frame.src = url;
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const deadline = Date.now() + 30000;
    // The veil holds, with Begin disabled, until the world says its first
    // frame is on screen; then it lifts and the gate opens.
    let veilHeld = true;
    while (!win.__fly?.ready && !win.flightFailed && Date.now() < deadline) {
      const veil = win.document?.getElementById('loading');
      if (veil && (veil.classList.contains('gone') || !win.document.getElementById('beginBtn').disabled)) veilHeld = false;
      await wait(20);
    }
    if (!win.__fly?.ready || win.flightFailed) throw new Error('world did not open: ' + url);
    const doc = win.document;
    if (
      !veilHeld ||
      win.__fly.perf.frames < 1 ||
      !doc.getElementById('loading').classList.contains('gone') ||
      doc.getElementById('beginBtn').disabled
    )
      throw new Error('the veil did not hold until the first frame was drawn, then lift: ' + url);
    return { frame, win, doc, z: win.__fly };
  };
  const closeWorld = async (world) => {
    await world.z.dispose();
    world.frame.remove();
  };
  const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
  const azimuth = (v) => Math.atan2(v.x, v.z);
  const settled = Date.now() + 20000;
  while (!window.__fly && !window.flightFailed && Date.now() < settled) await wait(50);
  await window.__fly?.dispose?.();
  localStorage.clear();
  const world = await openWorld(location.href);
  const { win, doc, z } = world;
  const button = (id) => doc.getElementById(id).click();
  assert(z && !win.flightFailed, 'scene initialized');
  assert(z.ready && doc.getElementById('loading').classList.contains('gone'), 'the veil held until the first frame was drawn, then lifted');
  const gate = doc.getElementById('begin');
  assert(
    gate.classList.contains('ready') && !gate.classList.contains('gone') && !gate.inert && !doc.getElementById('beginBtn').disabled,
    'the gate stands on the drawn world with Begin ready',
  );
  assert(!z.title.started && z.title.name === 0 && z.title.presents === 0, 'no title card before Begin');
  assert(!z.resumed && z.volume === 0.5, 'a fresh visit starts at half volume');
  assert(
    z.intro.beat === 'side' && Math.abs(Math.abs(wrapAngle(z.state.heading - azimuth(z.sky.sun))) - Math.PI / 2) < 0.03,
    'a new world arms the opening, abeam of the sun',
  );
  assert(doc.getElementById('volume').value === '0.5', 'the slider shows the half volume');
  assert(doc.getElementById('muteBtn').textContent === 'sound on', 'a fresh visit starts with sound on');
  const target = doc.querySelector('canvas');
  assert(target.width * target.height <= 2000000, 'drawing buffer respects the pixel budget');
  await wait(500);
  assert(!z.running && z.audioState === 'not-created', 'Begin gates flight and audio');
  const idleFrames = z.perf.frames;
  await wait(300);
  assert(z.perf.frames === idleFrames, 'no idle render loop');
  button('beginBtn');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  assert(z.paused === reduced, 'Begin respects the motion preference');
  if (z.paused) {
    assert(doc.getElementById('pauseBtn').title === 'Resume flight', 'paused control describes its action');
    button('pauseBtn');
  }
  await wait(300);
  assert(z.audioState === 'running', 'Begin unlocks audio');
  button('muteBtn');
  await wait(4500);
  assert(z.masterGain < 0.0001, 'mute survives the opening gain ramp');
  const volume = doc.getElementById('volume');
  volume.value = '0.4';
  volume.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(1200);
  assert(
    Math.abs(z.masterGain - 0.4) < 0.01 && doc.getElementById('muteBtn').textContent === 'sound on',
    'volume slider sets the master gain and unmutes',
  );
  assert(gate.inert && gate.classList.contains('gone'), 'the dismissed gate leaves the tab order');
  // Headless focus emulation keeps tabs visible. Exercise the visibility handler
  // explicitly; native tab transitions remain a separate manual device check.
  const hiddenProperty = Object.getOwnPropertyDescriptor(doc, 'hidden');
  try {
    Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
    doc.dispatchEvent(new win.Event('visibilitychange'));
    await wait(100);
    const hiddenFrames = z.perf.frames;
    await wait(200);
    assert(
      z.perf.frames === hiddenFrames && z.audioState === 'suspended',
      'visibility handler suspends rendering and audio',
    );
  } finally {
    if (hiddenProperty) Object.defineProperty(doc, 'hidden', hiddenProperty);
    else delete doc.hidden;
    doc.dispatchEvent(new win.Event('visibilitychange'));
  }
  await wait(100);
  assert(z.audioState === 'running', 'visibility handler resumes audio');
  const canvas = doc.getElementById('c');
  assert(['side', 'pivot'].includes(z.intro.beat), 'the opening is under way when the viewer first steers');
  const T = z.titleCard,
    O0 = z.opening;
  while (z.state.t < O0.side + 0.5) z.step(0.05);
  assert(
    z.intro.beat === 'pivot' && !z.title.started && z.title.presents === 0,
    'the title card stays hidden for the first three seconds of the turn',
    `t ${z.state.t.toFixed(1)}`,
  );
  while (z.state.t < O0.side + 3.5) z.step(0.05);
  assert(
    z.intro.beat === 'pivot' && z.title.started && z.title.presents > 0 && z.title.name < 1,
    'the title card begins three seconds into the turn toward the sun',
    `t ${z.state.t.toFixed(1)}`,
  );
  canvas.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert(
    !z.intro.beat && z.intro.ended === 'steered' && z.cloudCycle < 1,
    'a steer during the opening hands the bird back, with a full low stretch ahead',
  );
  const nudge = z.state.nudgeYaw,
    nudgeTime = z.state.t;
  await wait(1500);
  const expectedNudge = nudge * Math.exp(-(z.state.t - nudgeTime) / 2.4);
  // Heading grows with a left turn, so the right arrow's nudge is negative.
  assert(
    nudge < 0 && z.state.nudgeYaw > nudge && Math.abs(z.state.nudgeYaw - expectedNudge) < 0.000001,
    'the right arrow nudges a right turn that decays',
  );
  button('pauseBtn');
  await wait(100);
  const pausedTime = z.state.t,
    pausedFrames = z.perf.frames;
  await wait(300);
  assert(
    z.state.t === pausedTime && z.perf.frames === pausedFrames && z.audioState === 'suspended',
    'pause stops simulation, rendering and audio',
  );

  z.moments.flockOn = false;
  z.moments.nextFlock = z.state.t;
  for (let i = 0; i < 6; i++) z.step(0.05);
  const arriving = z.objects.companions.find((b) => b.visible);
  assert(
    arriving && arriving.position.distanceTo(z.objects.bird.position) > 100,
    'flock arrives from a distance instead of popping into formation',
  );
  {
    // A title card that has begun finishes even though the steer ended the
    // opening: it comes fully up, holds, and is gone, on the simulation clock.
    const titleName = doc.getElementById('titleName');
    while (z.state.t < O0.side + 3 + T.name[1]) z.step(0.05);
    assert(
      z.title.name === 1 && z.title.presents === 1 && Number(titleName.style.opacity) === 1,
      'the steered opening still brings the title card fully up',
    );
    while (z.state.t < O0.side + 3 + T.out[1]) z.step(0.05);
    assert(
      z.title.done && z.title.name === 0 && Number(titleName.style.opacity) === 0 && !z.intro.beat,
      'the title card fades away and leaves the flight clear',
    );
  }

  // The scenery library and the biomes it describes. The library validates
  // clean, and refuses a contribution outside the palette envelope or with an
  // unknown species; the weight rule sums to one and does not depend on the
  // path flown; every tree stands in a biome that grows its species.
  {
    const { library } = z;
    assert(library.validate().length === 0, 'the scenery library validates clean');
    const biome = library.biomes[0];
    const kept = { ground: biome.ground, species: biome.species };
    biome.ground = { ...biome.ground, base: 0xff00ff };
    biome.species = { ...biome.species, unicorn: 1 };
    const errors = library.validate();
    Object.assign(biome, kept);
    assert(
      errors.some((e) => e.includes('palette envelope')) && errors.some((e) => e.includes('unknown species')),
      'the library refuses a neon ground and an unknown species, naming the entry',
    );
    assert(library.validate().length === 0, 'the library is whole again after the trial');
    // a baked object is measured against its budget, by entry name
    const boulders = z.objects.props.boulders.geometry;
    const tight = library.validateBaked({ kind: 'prop', id: 'trial', budget: { triangles: 1 } }, boulders);
    assert(
      tight.length === 1 && tight[0].startsWith('prop trial:') && tight[0].includes('budget is 1'),
      'a baked prop over its triangle budget is refused by name',
    );
    assert(library.validateBaked(library.props[0], boulders).length === 0, 'the boulders fit their budget');
    assert(
      Object.keys(z.objects.props).length === library.props.length && library.props.every((p) => z.objects.props[p.id]),
      'every prop kind in the registry has a pool in the world',
    );
  }
  const dominantBiome = (x, zz) => {
    const w = z.biomeAt(x, zz);
    let best = 0;
    for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
    return { id: z.library.biomes[best].id, weight: w[best], weights: w };
  };
  const speciesAgree = () => {
    // every placed tree's species has weight in the biome mix of its cell,
    // which is the mix the placement reads
    for (const tree of z.trees) {
      const cell = z.treeCell,
        cx = (Math.floor(tree.x / cell) + 0.5) * cell,
        cz = (Math.floor(tree.z / cell) + 0.5) * cell;
      const w = dominantBiome(cx, cz).weights;
      let welcome = 0;
      for (let i = 0; i < w.length; i++) welcome += w[i] * (z.library.biomes[i].species[tree.species] ?? 0);
      // a stray of a neighbor's species deep in a border is legitimate; a
      // species with no weight at all is not
      if (!(welcome > 0.0000001)) return false;
    }
    return true;
  };
  {
    let sumError = 0,
      seen = new Set();
    for (let i = 0; i < 200; i++) {
      const a = i * 2.399963,
        d = (i * 7919) % 3800;
      const w = z.biomeAt(z.state.x + Math.cos(a) * d, z.state.z + Math.sin(a) * d);
      sumError = Math.max(sumError, Math.abs([...w].reduce((s, v) => s + v, 0) - 1));
      seen.add(dominantBiome(z.state.x + Math.cos(a) * d, z.state.z + Math.sin(a) * d).id);
    }
    assert(sumError < 0.000001, 'biome weights sum to one everywhere');
    assert(seen.size >= 2, 'the window around the bird holds more than one biome', [...seen].join(', '));
    assert(z.trees.length > 50 && speciesAgree(), 'every tree stands in a biome that grows its species');
  }
  const sitesAgree = () => {
    for (const site of z.sites) {
      if (Math.abs(site.ground - z.heightAt(site.x, site.z)) > 0.01) return `site floats at ${site.x.toFixed(0)}`;
      if (site.ground < 8) return 'site in the water';
      if (z.obstacleFloor(site.x, site.z) < site.top - 0.001) return 'site is not an obstacle';
    }
    return z.sites.length <= 12 ? null : 'too many sites in one ring';
  };
  // Ground shade and the shadow frame. The shade sheet is read the way the GPU
  // reads an uploaded canvas, so a mirrored upload fails here as it does on screen.
  const shadeAt = (() => {
    const { map, origin, span } = z.objects.groundShade;
    const image = map.image,
      pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    return (x, zz) => {
      const u = (x - origin.x) / span + 0.5,
        v = (zz - origin.y) / span + 0.5;
      if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return null;
      const column = Math.floor(u * image.width),
        row = Math.floor((map.flipY ? 1 - v : v) * image.height);
      return pixels[(row * image.width + column) * 4] / 255;
    };
  })();
  const pools = () => Object.values(z.objects.species);
  const treeBases = () => {
    const bases = [];
    for (const pool of pools()) {
      const matrices = pool.wood.instanceMatrix.array;
      for (let j = 0; j < pool.wood.count; j++) bases.push([matrices[j * 16 + 12], matrices[j * 16 + 14]]);
    }
    return bases;
  };
  {
    const bases = treeBases().filter(([x, zz]) => Math.hypot(x - z.state.x, zz - z.state.z) < 1200);
    const under = bases.map(([x, zz]) => shadeAt(x, zz)).filter((v) => v !== null);
    const open = [];
    for (let i = 0; i < 400; i++) {
      const a = i * 2.399963,
        d = 60 + ((i * 7919) % 1140);
      const x = z.state.x + Math.cos(a) * d,
        zz = z.state.z + Math.sin(a) * d;
      if (bases.some(([tx, tz]) => Math.hypot(tx - x, tz - zz) < 45)) continue;
      const v = shadeAt(x, zz);
      if (v !== null) open.push(v);
    }
    const mean = (list) => list.reduce((sum, v) => sum + v, 0) / Math.max(1, list.length);
    assert(
      under.length >= 12 && open.length >= 50 && mean(under) < mean(open) - 0.15,
      'the ground is shaded under trees and clear in the open',
      `under ${mean(under).toFixed(2)}, open ${mean(open).toFixed(2)}`,
    );
  }
  {
    // A rebuild of the sheet, as the bird crosses a tree cell, changes nothing
    // near the bird: the new sheet is the old one shifted by the re-centering,
    // texel for texel, wherever both cover the ground around the bird.
    const { map, origin, span } = z.objects.groundShade;
    const image = map.image,
      size = image.width;
    const snapshot = () => image.getContext('2d').getImageData(0, 0, size, size).data;
    const before = snapshot(),
      from = origin.clone();
    let steps = 0;
    while (origin.equals(from) && steps++ < 200) z.step(0.05);
    assert(steps < 200, 'the shade sheet re-centers as the bird flies');
    const after = snapshot();
    const shift = origin.clone().sub(from).multiplyScalar(size / span);
    assert(
      Math.abs(shift.x - Math.round(shift.x)) < 0.000001 && Math.abs(shift.y - Math.round(shift.y)) < 0.000001,
      'the sheet re-centers by whole texels',
    );
    const dx = Math.round(shift.x),
      dy = Math.round(shift.y);
    const radius = Math.floor((800 / span) * size);
    const center = [(z.state.x - origin.x) / span + 0.5, (z.state.z - origin.y) / span + 0.5].map((u) =>
      Math.floor(u * size),
    );
    let jump = 0;
    for (let row = center[1] - radius; row <= center[1] + radius; row++)
      for (let column = center[0] - radius; column <= center[0] + radius; column++) {
        const was = before[((row + dy) * size + column + dx) * 4],
          is = after[(row * size + column) * 4];
        jump = Math.max(jump, Math.abs(was - is));
      }
    // gradient rasterization rounds a little at a new sub-texel offset; the
    // mirrored sheet moved whole shades, a hundred levels
    assert(jump <= 12, 'the shade on the ground holds still when its sheet re-centers', `jumped ${jump}`);
  }
  {
    // The shadow frame follows the bird in whole shadow-map texels across the
    // light's plane, so shadows are drawn on the same ground texels every frame.
    const sun = z.objects.sun,
      M4 = z.camera.matrixWorld.constructor,
      V3 = z.camera.position.constructor;
    const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
    let maxFraction = 0,
      maxLag = 0;
    for (let i = 0; i < 40; i++) {
      z.dayPhase = 0.5;
      z.step(0.05);
      const e = new M4().lookAt(sun.position, sun.target.position, sun.up).elements;
      for (const axis of [new V3(e[0], e[1], e[2]), new V3(e[4], e[5], e[6])]) {
        const along = sun.target.position.dot(axis) / texel;
        maxFraction = Math.max(maxFraction, Math.abs(along - Math.round(along)));
        maxLag = Math.max(maxLag, Math.abs(z.objects.bird.position.dot(axis) - sun.target.position.dot(axis)));
      }
    }
    assert(maxFraction < 0.001 && maxLag <= texel * 0.5 + 0.001, 'the shadow frame moves in whole texels and stays on the bird');
  }

  const surfaceError = () => {
    const { cell, size, data } = z.surface;
    const wrap = (i) => ((i % size) + size) % size;
    const vertexHeight = (x, y) => data[(wrap(Math.round(y / cell)) * size + wrap(Math.round(x / cell))) * 4];
    const geometry = z.objects.terrain.geometry,
      positions = geometry.attributes.position;
    const triangles = (geometry.index?.count ?? positions.count) / 3;
    const origin = z.objects.terrain.position;
    let error = 0;
    for (let sample = 0; sample < 1000; sample++) {
      const triangle = (sample * 7919) % triangles;
      let x = 0,
        y = 0,
        h = 0;
      for (let k = 0; k < 3; k++) {
        const index = geometry.index ? geometry.index.getX(triangle * 3 + k) : triangle * 3 + k;
        const vx = positions.getX(index) + origin.x,
          vz = positions.getZ(index) + origin.z;
        x += vx / 3;
        y += vz / 3;
        h += vertexHeight(vx, vz) / 3;
      }
      error = Math.max(error, Math.abs(h - z.heightAt(x, y)));
    }
    return error;
  };
  let maxSurfaceError = surfaceError(),
    minBird = Infinity,
    minCamera = Infinity,
    maxTreeError = 0,
    maxGrassError = 0,
    maxRise = 0,
    minMeshClearance = Infinity;
  let lastCenter = z.surface.center,
    scrolled = 0;
  const firstTextureCount = z.renderer.info.memory.textures;
  let highest = -Infinity,
    lowest = Infinity;
  const orbit = { yaw: z.cam.yaw, pitch: z.cam.pitch, dist: z.cam.dist };
  assert(orbit.yaw === 0 && orbit.pitch > 0, 'the default framing sits behind and above the bird');
  // The camera is rigid on the bird: level distance is exactly the orbit radius, only
  // a vertical lift clears ground and canopies, and the bird holds the center line.
  const pivot = () => {
    const bird = z.objects.bird.position,
      eye = z.camera.position;
    const level = Math.hypot(eye.x - bird.x, eye.z - bird.z) - Math.cos(z.cam.pitch) * z.cam.dist;
    // Stepping while paused does not render, so refresh the view matrix by hand.
    z.camera.updateMatrixWorld(true);
    z.camera.matrixWorldInverse.copy(z.camera.matrixWorld).invert();
    const screen = bird.clone().project(z.camera);
    return { level: Math.abs(level), across: Math.abs(screen.x), below: -screen.y };
  };
  let maxPivotError = 0;
  const stepWatchingPivot = (steps) => {
    for (let i = 0; i < steps; i++) {
      z.step(0.05);
      const p = pivot();
      maxPivotError = Math.max(maxPivotError, p.level, p.across);
    }
  };
  const crownsAgree = () => {
    const key = (array, i) => `${array[i * 16 + 12].toFixed(2)},${array[i * 16 + 14].toFixed(2)}`;
    for (const pool of pools()) {
      if (!pool.crown) continue;
      const treeKeys = new Set();
      for (let j = 0; j < pool.wood.count; j++) treeKeys.add(key(pool.wood.instanceMatrix.array, j));
      const crowned = new Set();
      for (const crown of [pool.crown, pool.distant])
        for (let j = 0; j < crown.count; j++) {
          const k = key(crown.instanceMatrix.array, j);
          if (!treeKeys.has(k)) return false;
          crowned.add(k);
        }
      if (crowned.size !== treeKeys.size) return false;
    }
    return true;
  };
  let sitesSeen = 0,
    maxRockError = 0;
  const climateHere = dominantBiome(z.state.x, z.state.z);
  const startPlace = [z.state.x, z.state.z];
  let maxLow = 0,
    lowestGround = Infinity,
    lowestAhead = Infinity,
    deepSteps = 0;
  // A low pass flies just over the highest ground, crown or stone in the next
  // 520 m along the bird's own bending look-ahead, which is what the flight
  // steers by; the ground straight below varies with terrain.
  const floorAhead = () => z.terrainAhead(520);
  // Six simulated minutes exercise streamed windows, both cloud schedules and flocks.
  // Same executable update path as RAF, without scheduling accelerated audio. The
  // day starts in the night before the moonset, so the flight passes the moonset and
  // sunrise pulls while it climbs, and the low pass below is asked for in the day's
  // pull-free stretch.
  z.dayPhase = 0.06;
  let lowAsked = -1;
  for (let i = 0; i < 7200; i++) {
    // Ask for a low pass early in a low stretch of the cloud schedule, so the
    // climb is well ahead, and hold the request until the bird has flown deep
    // in one for twenty seconds; the schedule still decides where the ground
    // is gentle enough to accept it.
    if (lowAsked < 0 && i >= 600 && z.cloudCycle < 60) {
      lowAsked = i;
      z.forceLow = 1;
    }
    if (lowAsked >= 0 && i >= lowAsked + 2600 && (deepSteps >= 400 || i === lowAsked + 3800)) z.forceLow = null;
    const previousY = z.state.y;
    stepWatchingPivot(1);
    const center = z.surface.center;
    scrolled += Math.abs(center[0] - lastCenter[0]) + Math.abs(center[1] - lastCenter[1]);
    lastCenter = center;
    maxRise = Math.max(maxRise, z.state.y - previousY);
    maxLow = Math.max(maxLow, z.flight.lowAmount);
    if (z.flight.lowAmount > 0.9) {
      deepSteps++;
      lowestGround = Math.min(lowestGround, z.clearance);
      lowestAhead = Math.min(lowestAhead, z.state.y - floorAhead());
    }
    minBird = Math.min(minBird, z.objects.bird.position.y - z.obstacleFloor(z.state.x, z.state.z));
    minCamera = Math.min(
      minCamera,
      z.camera.position.y - z.obstacleFloor(z.camera.position.x, z.camera.position.z),
    );
    highest = Math.max(highest, z.state.y);
    lowest = Math.min(lowest, z.state.y);
    if (i % 600 === 0) {
      maxSurfaceError = Math.max(maxSurfaceError, surfaceError());
      z.objects.bird.updateWorldMatrix(true, true);
      const point = z.objects.bird.position.clone();
      z.objects.bird.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.attributes.position;
        for (let j = 0; j < positions.count; j += Math.max(1, Math.floor(positions.count / 24))) {
          point.fromBufferAttribute(positions, j).applyMatrix4(mesh.matrixWorld);
          minMeshClearance = Math.min(minMeshClearance, point.y - z.heightAt(point.x, point.z));
        }
      });
      for (const pool of pools()) {
        const matrices = pool.wood.instanceMatrix.array;
        for (let j = 0; j < pool.wood.count; j++) {
          const p = j * 16;
          maxTreeError = Math.max(
            maxTreeError,
            Math.abs(matrices[p + 13] - z.heightAt(matrices[p + 12], matrices[p + 14])),
          );
        }
      }
      const grassMatrices = z.objects.grass.instanceMatrix.array;
      if (z.objects.grass.visible)
        for (let j = 0; j < z.objects.grass.count; j += 17) {
          const p = j * 16;
          maxGrassError = Math.max(
            maxGrassError,
            Math.abs(grassMatrices[p + 13] - z.heightAt(grassMatrices[p + 12], grassMatrices[p + 14])),
          );
        }
      assert(crownsAgree(), `every tree keeps a crown at sample ${i / 600}`);
      assert(speciesAgree(), `every tree stands in a biome that grows its species at sample ${i / 600}`);
      const siteProblem = sitesAgree();
      assert(!siteProblem, `ruins stand on land, on the ground, as obstacles at sample ${i / 600}`, siteProblem ?? '');
      sitesSeen += z.sites.length;
      const rocks = z.objects.props.boulders,
        rockMatrices = rocks.instanceMatrix.array;
      for (let j = 0; j < rocks.count; j += 7) {
        const p = j * 16;
        // boulders sit a quarter of their size into the ground
        const size = Math.hypot(rockMatrices[p], rockMatrices[p + 1], rockMatrices[p + 2]);
        maxRockError = Math.max(
          maxRockError,
          Math.abs(rockMatrices[p + 13] + size * 0.25 - z.heightAt(rockMatrices[p + 12], rockMatrices[p + 14])),
        );
      }
    }
    if (i % 1200 === 1199) {
      // A paused resize redraws one real frame. Exercise cloud, dusk and night
      // shaders too, rather than only advancing invisible CPU state.
      const frames = z.perf.frames;
      win.dispatchEvent(new win.Event('resize'));
      await wait(300);
      assert(
        z.perf.frames > frames && z.perf.triangles > 10000,
        'paused redraw renders geometry, not a cached post texture',
      );
      assert(!win.flightFailed, 'streamed atmosphere renders without a graphics failure');
    }
  }
  assert(maxSurfaceError < 0.00001, 'CPU heights agree with rendered triangle centroids after streaming');
  assert(maxTreeError < 0.01 && maxGrassError < 0.01, 'tree and grass bases agree with the drawn surface');
  assert(maxRockError < 0.01, 'boulders sit on the drawn surface');
  assert(sitesSeen <= 12 * 12, 'ruins stay within their pools over six minutes', `${sitesSeen} site-samples`);
  {
    // Sites are rare, so a straight line of twenty rings 3.8 km apart is the
    // fair place to ask that they exist at all and always fit their ground.
    const from = { x: z.state.x, y: z.state.y, z: z.state.z };
    let found = 0,
      problem = null;
    for (let k = 0; k < 20 && !problem; k++) {
      z.state.x = from.x + Math.sin(0.7) * k * 3800;
      z.state.z = from.z + Math.cos(0.7) * k * 3800;
      z.state.y = 400;
      z.step(0.05);
      found += z.sites.length;
      problem = sitesAgree();
    }
    assert(!problem, 'ruins along seventy kilometers stand on land, on the ground, as obstacles', problem ?? '');
    assert(found >= 1 && found <= 20 * 12, 'ruins are rare but not absent along seventy kilometers', `${found} sites`);
    Object.assign(z.state, from);
    z.step(0.05);
  }
  {
    // the biome at a place does not depend on the path flown to it
    const memory = z.surface;
    const [sx, sz] = startPlace;
    const inside = Math.abs(sx / memory.cell - memory.center[0]) < memory.size / 2 - 4 && Math.abs(sz / memory.cell - memory.center[1]) < memory.size / 2 - 4;
    if (inside) {
      const again = dominantBiome(sx, sz);
      assert(
        again.id === climateHere.id && Math.abs(again.weight - climateHere.weight) < 0.000001,
        'the biome at the start is the same when streamed back over',
      );
    } else checks.push('the start left the window; biome path-independence checked at load only');
  }
  z.forceLow = null;
  assert(lowAsked >= 0, 'the cloud schedule offered a low stretch to ask for a low pass in');
  assert(maxRise < 1, 'flight does not teleport upward to escape terrain');
  assert(
    minBird > 5 && minCamera > 6 && minMeshClearance > 1,
    'bird mesh and camera clear the terrain; centers clear canopies',
  );
  assert(
    z.cam.yaw === orbit.yaw && z.cam.pitch === orbit.pitch && z.cam.dist === orbit.dist,
    'the camera framing never changes on its own',
  );
  assert(maxPivotError < 0.01, 'the camera stays rigid on the bird through the whole flight');
  assert(
    maxLow > 0.9 && lowestAhead < 70,
    'a low pass brings the bird close to the ground and canopies ahead',
    `deepest ${maxLow.toFixed(2)}, ${lowestAhead.toFixed(0)} m over the floor ahead`,
  );
  assert(scrolled > z.surface.size / 2, 'flight streams the heightfield window past its own size');
  assert(highest > 600 && lowest < 500, 'flight travels above and below the cloud deck');

  // Pointer conventions, stepped deterministically while paused.
  const pointer = (type, x, y, buttonIndex) =>
    canvas.dispatchEvent(
      new win.PointerEvent(type, {
        clientX: x,
        clientY: y,
        button: buttonIndex,
        buttons: buttonIndex === 2 ? 2 : 1,
        pointerId: 7,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      }),
    );
  const framing = pivot();
  pointer('pointerdown', 100, 100, 0);
  stepWatchingPivot(20);
  assert(
    maxPivotError < 0.01 && Math.abs(pivot().below - framing.below) < 0.05,
    'holding the left button leaves the camera where it is; nothing pulls it in',
  );
  pointer('pointermove', 180, 120, 0);
  pointer('pointerup', 180, 120, 0);
  const orbited = { yaw: z.cam.yaw, pitch: z.cam.pitch };
  assert(orbited.yaw < -0.2 && orbited.pitch > orbit.pitch, 'left-drag orbits the camera');
  z.step(0.05);
  const birdLeft = new (z.camera.position.constructor)(1, 0, 0).applyQuaternion(z.objects.bird.quaternion);
  assert(
    z.camera.position.clone().sub(z.objects.bird.position).dot(birdLeft) > 0,
    "a rightward left-drag swings the camera to the bird's left, so the view turns right, as in WoW",
  );
  stepWatchingPivot(400);
  assert(
    z.cam.yaw === orbited.yaw && z.cam.pitch === orbited.pitch,
    'the orbit stays where the viewer left it; nothing recenters',
  );
  assert(
    maxPivotError < 0.01 && framing.below > 0 && framing.below < 0.3 && pivot().below > 0 && pivot().below < 0.3,
    'the orbit pivots on the bird, which keeps its place a little below center',
  );
  canvas.dispatchEvent(new win.WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true }));
  assert(z.cam.dist > orbit.dist, 'the wheel zooms the camera out');
  const headingBefore = z.state.heading;
  let wandered = 0;
  pointer('pointerdown', 100, 100, 2);
  pointer('pointermove', 160, 100, 2);
  for (let i = 0; i < 60; i++) {
    z.step(0.05);
    wandered += z.state.yawRate * 0.05;
  }
  pointer('pointerup', 160, 100, 2);
  const steered = wrapAngle(z.state.heading - headingBefore - wandered);
  assert(
    Math.abs(steered - (orbited.yaw - 60 * 0.004)) < 0.001 && Math.abs(z.cam.yaw) < 0.001,
    'right-drag turns the bird toward the camera, then a rightward drag turns it right',
  );

  // Steering is vertical too: a drag aims the bird's nose, and while it is held
  // the aim is the only thing that moves the bird up or down. Whatever the
  // flight had planned - a climb through the deck, a low pass - lets go.
  {
    z.dayPhase = 0.5; // noon, so nothing in the sky pulls at the bird
    z.forceHigh = 1; // and the schedule wants it up through the deck
    z.state.y = z.heightAt(z.state.x, z.state.z) + 220;
    let climbing = 0;
    for (let i = 0; i < 400 && climbing < 6; i++) {
      z.step(0.05);
      climbing = z.state.vy;
    }
    assert(climbing > 6, 'the schedule has the bird climbing before the captain takes the stick', `${climbing.toFixed(1)} m/s`);
    const climbedTo = z.state.y;
    z.flight.low = true; // and a low pass is under way
    const framing = { yaw: z.cam.yaw, pitch: z.cam.pitch };
    pointer('pointerdown', 100, 100, 2);
    pointer('pointermove', 100, 240, 2); // 140 px down: the nose all the way down
    assert(
      z.state.aim < -0.4 && z.state.aimHold === 1 && !z.flight.low,
      'a downward drag aims the nose down, takes the vertical, and drops the low pass',
      `aim ${z.state.aim.toFixed(2)}`,
    );
    // the view comes down with the nose, by the same rule the left button uses
    const lowered = z.cam.pitch;
    assert(
      Math.abs(lowered - Math.min(1.2, framing.pitch + 140 * 0.004)) < 0.000001 && z.cam.yaw === framing.yaw,
      'the vertical steer pitches the camera exactly as the left button does, and leaves its yaw alone',
      `${framing.pitch.toFixed(3)} to ${lowered.toFixed(3)}`,
    );
    for (let i = 0; i < 60; i++) z.step(0.05);
    assert(
      z.state.vy < -10 && z.state.pitch < -0.3 && z.state.y < climbedTo,
      'the steered dive beats the climb the schedule had planned',
      `${z.state.vy.toFixed(1)} m/s, pitch ${z.state.pitch.toFixed(2)}`,
    );
    pointer('pointerup', 100, 240, 2);
    for (let i = 0; i < 60; i++) z.step(0.05); // longer than the aim's release
    assert(z.state.aimHold === 0 && z.state.aim === 0, 'the aim fades when the captain lets go');
    assert(z.cam.pitch === lowered, 'the view stays where the steer left it; only the aim is handed back');
    let climbedBack = 0;
    for (let i = 0; i < 200; i++) {
      z.step(0.05);
      climbedBack = Math.max(climbedBack, z.state.vy);
    }
    assert(climbedBack > 6, 'the flight takes the altitude back and climbs again', `${climbedBack.toFixed(1)} m/s`);
    const diving = z.state.y;
    pointer('pointerdown', 100, 300, 2);
    pointer('pointermove', 100, 200, 2); // 100 px up: the nose up
    for (let i = 0; i < 60; i++) z.step(0.05);
    assert(
      z.state.aim > 0.25 && z.state.vy > 9 && z.state.pitch > 0.3 && z.state.y > diving,
      'an upward drag aims the nose up and the bird climbs',
      `aim ${z.state.aim.toFixed(2)}, ${z.state.vy.toFixed(1)} m/s`,
    );
    assert(z.cam.pitch < lowered, 'and the view comes up with it');
    assert(
      z.state.aim <= z.aim.up + 1e-9 && z.state.aim >= -z.aim.down,
      "the aim stays inside the bird's own climb envelope",
    );
    pointer('pointerup', 100, 200, 2);
    z.forceHigh = null;
    for (let i = 0; i < 60; i++) z.step(0.05);
    assert(
      z.state.aimHold === 0 && (z.state.y > z.deck ? z.cloudCycle > 200 : z.cloudCycle < 2),
      'handing the altitude back re-bases the cloud schedule on where the bird was left',
      `${z.state.y.toFixed(0)} m, cycle ${z.cloudCycle.toFixed(1)} s`,
    );
  }

  // Sky events: while the sun or the moon crosses the horizon the bird turns to fly
  // straight at it, at a gentle capped rate with its wander silenced, unless steered.
  const event = (body, rising) => z.sky.events.find((e) => e.body === body && e.rising === rising);
  const towardRate = (dt) => {
    // The implied yaw-rate target of one step: the controller eases toward it at 1.5/s.
    const before = z.state.yawRate;
    z.step(dt);
    return before + (z.state.yawRate - before) / Math.min(1, dt * 1.5);
  };
  assert(
    ['moon', 'sun', 'moon', 'sun'].every((body, i) => z.sky.events[i]?.body === body) &&
      z.sky.events.every((e, i) => i === 0 || e.phase > z.sky.events[i - 1].phase),
    'the day has a moonset, a sunrise, a moonrise and a sunset, in that order',
  );
  {
    // The night, sunset to sunrise, is a quarter of the day, found on the arcs the
    // sky draws; the sun's own clock never runs backward and never jumps its pace.
    const night = (event('sun', true).phase - event('sun', false).phase + 1) % 1;
    assert(Math.abs(night - 0.25) < 0.002 && Math.abs(z.nightShare - 0.25) < 0.000001, 'the night is a quarter of the day', `${night.toFixed(4)}`);
    const samples = 6000;
    let previous = z.solar(0),
      previousPace = null,
      slowest = Infinity,
      fastest = 0,
      jump = 0;
    for (let i = 1; i <= samples; i++) {
      const s = z.solar(i / samples),
        pace = (s - previous) * samples;
      slowest = Math.min(slowest, pace);
      fastest = Math.max(fastest, pace);
      if (previousPace !== null) jump = Math.max(jump, Math.abs(pace - previousPace));
      previousPace = pace;
      previous = s;
    }
    assert(
      Math.abs(z.solar(1) - 1) < 0.000001 && Math.abs(z.solar(0.5) - 0.5) < 0.000001 && slowest > 0.5 && fastest < 3 && jump < 0.02,
      'the sun keeps a steady pace by day, hurries through the night, and never jumps between them',
      `pace ${slowest.toFixed(2)} to ${fastest.toFixed(2)}, largest step ${jump.toFixed(4)}`,
    );
    // dusk still takes its time: the afterglow keys of the sky lie within the
    // first 0.08 of solar phase after the sun sets, and the clock walks them
    // over a natural stretch of seconds, not a jump into night
    const sunset = event('sun', false);
    z.dayPhase = sunset.phase;
    let dusk = 0;
    while (z.solar(z.dayPhase) - sunset.solar < 0.08 && dusk < 120) {
      z.step(0.05);
      dusk += 0.05;
    }
    assert(dusk > 20 && dusk < 60, 'the dusk afterglow drains over a natural stretch of seconds', `${dusk.toFixed(1)} s`);
  }
  z.dayPhase = 0.5;
  z.step(0.05);
  assert(z.sunward.pull === 0 && !z.sunward.event, 'at noon nothing pulls the bird');
  // Inside the sunrise pull, which holds from before the sun clears the horizon
  // until it stands well clear; the checks below stay within it.
  z.dayPhase = event('sun', true).phase - 0.02;
  z.step(0.05);
  z.state.heading = wrapAngle(azimuth(z.sky.sun) + 1.4);
  let maxYaw = 0,
    cappedAlone = true;
  for (let i = 0; i < 60; i++) {
    const implied = towardRate(0.05);
    maxYaw = Math.max(maxYaw, Math.abs(z.state.yawRate));
    if (i > 5 && Math.abs(implied + 0.2) > 0.000001) cappedAlone = false;
  }
  assert(cappedAlone, 'far from the risen sun the pull turns at its capped rate alone');
  assert(z.sunward.pull === 1 && z.sunward.event.body === 'sun', 'a rising sun pulls with full weight');
  for (let i = 0; i < 500; i++) z.step(0.05);
  assert(Math.abs(wrapAngle(z.state.heading - azimuth(z.sky.sun))) < 0.02, 'the bird flies straight at the rising sun');
  for (let i = 0; i < 200; i++) {
    z.step(0.05);
    maxYaw = Math.max(maxYaw, Math.abs(z.state.yawRate));
  }
  assert(Math.abs(wrapAngle(z.state.heading - azimuth(z.sky.sun))) < 0.02, 'the bird keeps following the sun as it climbs');
  assert(maxYaw < 0.21, 'the pull never turns faster than its gentle cap');
  // The moon sets in the night, where the sun's clock runs fast, so its pull
  // is a dozen seconds long; these steps stay inside it, before the crossing.
  z.dayPhase = event('moon', false).phase - 0.02;
  z.step(0.05);
  z.state.heading = wrapAngle(azimuth(z.sky.moon) - 0.5);
  for (let i = 0; i < 200; i++) z.step(0.05);
  assert(
    z.sunward.event.body === 'moon' && Math.abs(wrapAngle(z.state.heading - azimuth(z.sky.moon))) < 0.02,
    'a setting moon pulls the bird toward the moon',
  );
  const moonHeading = z.state.heading;
  pointer('pointerdown', 100, 100, 2);
  pointer('pointermove', 350, 100, 2);
  pointer('pointerup', 350, 100, 2);
  z.step(0.05);
  assert(
    z.sunward.released && z.sunward.pull === 0 && z.sunward.event.body === 'moon',
    'steering away lets the moon go for the rest of its event',
  );
  assert(Math.abs(wrapAngle(z.state.heading - moonHeading + 1)) < 0.05, 'the steer turned the bird a radian away');
  assert(z.sky.moon.y > 0, 'the moon is still up when the steer lets it go');
  let wandering = true;
  for (let i = 0; i < 40; i++) {
    const implied = towardRate(0.05);
    if (z.sunward.pull !== 0 || Math.abs(implied) >= 0.19) wandering = false;
  }
  assert(wandering, 'released, the bird wanders instead of turning back');
  z.dayPhase = event('sun', true).phase;
  z.step(0.05);
  assert(!z.sunward.released && z.sunward.pull > 0.99 && z.sunward.event.body === 'sun', 'the next event pulls again');
  z.dayPhase = 0.5;
  z.step(0.05);
  assert(z.sunward.pull === 0 && !z.sunward.event && !z.sunward.released, 'by noon the bird is its own again');

  // Nightfall turns the bird, once, toward the brightest part of the Milky Way.
  {
    const core = azimuth(z.sky.galaxy.brightest);
    assert(
      Math.abs(wrapAngle(core - z.galaxyHeading)) < 1e-9,
      "the flight steers by the sky's own brightest bearing, not a second copy of it",
    );
    const sunset = event('sun', false);
    assert(!z.isNight(0.5) && z.isNight(sunset.phase + 0.1), 'night runs from the sunset crossing to the sunrise one');
    z.dayPhase = sunset.phase - 0.01;
    z.step(0.05);
    assert(
      !z.isNight(z.dayPhase) && !z.nightward.armed && z.nightward.pull === 0,
      'while the sun is up nothing turns the bird to the galaxy',
    );
    // night, and far enough past the crossing that the sunset has let go
    z.dayPhase = sunset.phase + 0.05;
    z.state.heading = wrapAngle(core + 2.2);
    z.step(0.05);
    assert(z.isNight(z.dayPhase) && z.sunward.pull === 0, 'night has begun and the sunset has let go of the bird');
    assert(z.nightward.armed && !z.nightward.done, 'nightfall arms the one turn');
    let turning = 0,
      maxYaw = 0;
    for (let i = 0; i < 1200 && !z.nightward.done; i++) {
      z.step(0.05);
      turning += 0.05;
      maxYaw = Math.max(maxYaw, Math.abs(z.state.yawRate));
    }
    assert(
      z.nightward.done && Math.abs(wrapAngle(z.state.heading - core)) < 0.05,
      'the bird comes around to face the brightest part of the Milky Way',
      `${wrapAngle(z.state.heading - core).toFixed(3)} rad off`,
    );
    assert(
      maxYaw < 0.21 && turning > 8,
      'it is a graceful turn, at the same gentle rate a sky event turns the bird',
      `${turning.toFixed(1)} s, ${maxYaw.toFixed(3)} rad/s`,
    );
    for (let i = 0; i < 40; i++) z.step(0.05);
    assert(z.nightward.pull === 0, 'the turn lets go as soon as the bird is facing the core');
    z.state.heading = wrapAngle(core + 2);
    let free = true;
    for (let i = 0; i < 400; i++) {
      z.step(0.05);
      if (!z.nightward.done || z.nightward.pull > 0) free = false;
    }
    assert(free, 'once a night: turned away, nothing takes the bird back to the core');
    z.dayPhase = 0.5;
    z.step(0.05);
    assert(!z.nightward.armed, 'daylight disarms the turn');
    z.dayPhase = sunset.phase + 0.05;
    z.state.heading = wrapAngle(core + 2.2);
    z.step(0.05);
    assert(z.nightward.armed && !z.nightward.done, 'the next nightfall arms it again');
    for (let i = 0; i < 20; i++) z.step(0.05);
    assert(z.nightward.pull > 0, 'the next night takes the bird around again');
    pointer('pointerdown', 100, 100, 2);
    pointer('pointermove', 200, 100, 2);
    pointer('pointerup', 200, 100, 2);
    assert(z.nightward.done && z.nightward.pull > 0, 'a steer ends the night turn at once');
    let fading = 0;
    while (z.nightward.pull > 0 && fading < 80) {
      z.step(0.05);
      fading++;
    }
    assert(
      fading > 4 && z.nightward.pull === 0,
      'the pull fades rather than snapping',
      `${(fading * 0.05).toFixed(2)} s`,
    );
    let onItsOwn = true;
    for (let i = 0; i < 200; i++) {
      z.step(0.05);
      if (z.nightward.pull > 0) onItsOwn = false;
    }
    assert(onItsOwn, 'and the bird is left on its own course for the rest of the night');
    z.dayPhase = 0.5;
    z.step(0.05);
  }

  // Read the water's pixels, not shader text. Find a real coast in the rolling
  // CPU window, then look straight down at the isolated, normally lit water.
  {
    const savedState = { ...z.state }, savedPhase = z.dayPhase, savedCam = { ...z.cam };
    const scene = z.objects.water.parent, camera = z.camera;
    const savedUp = camera.up.clone();
    const visibility = scene.children.map(o => [o, o.visible]);
    let coast;
    try {
      let best = 0;
      for (let window = 0; window < 8 && best < 2; window++) {
        const [cx, cz] = z.surface.center, cell = z.surface.cell;
        for (let iz = cz - 210; iz <= cz + 210; iz += 4)
          for (let ix = cx - 210; ix <= cx + 210; ix += 4) {
            const x = ix * cell, zz = iz * cell, h = z.heightAt(x, zz);
            if (h > -7 || h < -23) continue;
            let shallow = 0, deep = 0, land = 0;
            for (let dz = -120; dz <= 120; dz += 60)
              for (let dx = -120; dx <= 120; dx += 60) {
                const d = -z.heightAt(x + dx, zz + dz);
                if (d > 3 && d < 8) shallow++;
                if (d > 28) deep++;
                if (d < 0) land++;
              }
            const score = Math.min(shallow, deep, land);
            if (score > best) { best = score; coast = { x, z: zz }; }
          }
        if (best < 2) { z.state.x += 6000; z.step(0.001); }
      }
      assert(coast && best >= 2, 'a real coast supplies both shallow and deep water for pixel checks');
      const size = 192, height = 300;
      const render = async () => {
        for (const [o] of visibility) o.visible = o === z.objects.water || o.isLight === true;
        camera.up.set(0, 0, -1);
        camera.position.set(coast.x, height, coast.z);
        camera.lookAt(coast.x, 0, coast.z);
        camera.updateMatrixWorld(true);
        // Light nodes refresh on the renderer's animation tick, not a direct
        // renderAsync. Prime that tick before reading the small scene target.
        const before = z.perf.frames, deadline = Date.now() + 10000;
        win.dispatchEvent(new win.Event('resize'));
        while (z.perf.frames === before && Date.now() < deadline) await wait(10);
        if (z.perf.frames === before) throw new Error('water redraw did not finish');
        return z.capture(size, size);
      };
      Object.assign(z.cam, { yaw: 0, pitch: 0.2, dist: 42 });
      Object.assign(z.state, { x: coast.x, z: coast.z, y: 160 });
      z.dayPhase = 0.5;
      z.step(0.001);
      const day = await render(), still = await render();
      const half = Math.tan(camera.fov * Math.PI / 360) * height;
      const bins = { shallow: [], deep: [], foam: [] };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const wx = coast.x + ((x + 0.5) / size * 2 - 1) * half;
        const wz = coast.z + ((y + 0.5) / size * 2 - 1) * half;
        const depth = -z.heightAt(wx, wz), i = (y * size + x) * 4;
        if (depth > 3 && depth < 8) bins.shallow.push(i);
        if (depth > 28) bins.deep.push(i);
        if (depth > 0.35 && depth < 1.4) bins.foam.push(i);
      }
      const mean = (picture, ids, channel) => ids.reduce((s, i) => s + picture.data[i + channel], 0) / ids.length;
      const brightness = (picture, ids) => mean(picture, ids, 0) * 0.2126 + mean(picture, ids, 1) * 0.7152 + mean(picture, ids, 2) * 0.0722;
      const difference = (a, b) => {
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) sum += Math.abs(a.data[i] - b.data[i]);
        return sum / (size * size * 3);
      };
      assert(Object.values(bins).every(ids => ids.length > 20), 'water pixels include the shore wash, shelves and deep sea');
      assert(day.data.every(Number.isFinite) && brightness(day, bins.deep) > 0.01, 'water renders finite, nonblank pixels');
      assert(brightness(day, bins.shallow) > brightness(day, bins.deep) * 1.2, 'water shelves render lighter than the deep sea');
      assert(
        mean(day, bins.deep, 2) / mean(day, bins.deep, 1) > mean(day, bins.shallow, 2) / mean(day, bins.shallow, 1) + 0.05,
        'water deepens from jade toward turquoise',
      );
      assert(difference(day, still) < 0.000001, 'paused water renders the same pixels again');
      z.state.t += 8;
      z.dayPhase = 0.5;
      z.step(0.001);
      const moving = await render(), fixedTime = z.state.t;
      assert(difference(day, moving) > 0.00001, 'water ripples and shore wash move with simulation time');
      const origin = z.objects.water.position.clone();
      const shift = [[256, 0], [-256, 0], [0, 256], [0, -256]]
        .sort(([ax, az], [bx, bz]) => z.heightAt(coast.x + ax, coast.z + az) - z.heightAt(coast.x + bx, coast.z + bz))[0];
      z.state.x += shift[0];
      z.state.z += shift[1];
      z.state.t = fixedTime - 0.001;
      z.dayPhase = 0.5;
      z.step(0.001);
      const recentered = await render();
      assert(!z.objects.water.position.equals(origin), 'the water grid re-centers during the check');
      // Only water and lights are visible: birds, trees and ground shadows
      // legitimately move with the bird and must not pollute this comparison.
      assert(difference(moving, recentered) < 0.00005, 'water depth and ripples hold still in world space when the grid re-centers', difference(moving, recentered));
      z.dayPhase = 0;
      z.step(0.001);
      const night = await render();
      assert(brightness(night, bins.deep) < brightness(day, bins.deep) * 0.2 && brightness(night, bins.foam) < brightness(day, bins.foam) * 0.2, 'the water and shore wash take the night light instead of glowing');
      assert(z.objects.water.geometry.attributes.position.count <= 17689, 'water keeps its bounded vertex budget');
    } finally {
      Object.assign(z.state, savedState);
      Object.assign(z.cam, savedCam);
      z.dayPhase = savedPhase;
      camera.up.copy(savedUp);
      z.step(0.001);
      for (const [o, visible] of visibility) o.visible = visible;
    }
  }

  button('pauseBtn');
  await wait(1000);
  assert(z.state.t > pausedTime + 360 && z.audioState === 'running', 'resume renders the streamed world');
  assert(z.renderer.info.memory.textures <= firstTextureCount + 2, 'streaming retains a bounded texture set');
  assert(!win.flightFailed, 'no runtime failure');
  button('muteBtn');
  assert(doc.getElementById('muteBtn').textContent === 'sound off' && z.muted, 'sound can be turned off again');
  const performance = { ...z.renderer.info.render, ...z.perf };
  const left = {
    seed: z.seed,
    x: z.state.x,
    y: z.state.y,
    z: z.state.z,
    heading: z.state.heading,
    t: z.state.t,
    dayPhase: z.dayPhase,
    cam: { yaw: z.cam.yaw, pitch: z.cam.pitch, dist: z.cam.dist },
  };
  const disposal = z.dispose();
  await disposal;
  await wait(100);
  assert(z.audioState === 'closed' && z.disposed, 'teardown closes audio and renderer');
  assert(z.renderer.info.memory.total === 0, 'teardown releases all tracked graphics allocations');
  world.frame.remove();

  // What the page remembers. Reopened without a seed in the address, the remembered
  // world continues at the exact place, course and time of day, with the settings.
  const noSeed = new URL(location.href);
  noSeed.searchParams.delete('seed');
  const again = await openWorld(noSeed.href);
  assert(again.z.seed === left.seed && again.z.resumed, 'reopening without a seed continues the remembered world');
  assert(!again.z.intro.beat && again.z.intro.ended === null, 'a remembered flight resumes without the opening');
  assert(
    ['x', 'y', 'z', 'heading', 't'].every((k) => Math.abs(again.z.state[k] - left[k]) < 0.000001) &&
      Math.abs(again.z.dayPhase - left.dayPhase) < 0.000001,
    'the flight resumes at the exact place, course and time of day',
  );
  assert(
    again.z.volume === 0.4 && again.doc.getElementById('volume').value === '0.4',
    'the volume is remembered',
  );
  assert(again.z.muted && again.doc.getElementById('muteBtn').textContent === 'sound off', 'sound off is remembered');
  assert(
    ['yaw', 'pitch', 'dist'].every((k) => again.z.cam[k] === left.cam[k]),
    "the viewer's framing is remembered",
  );
  assert(!again.z.running && again.z.audioState === 'not-created', 'a remembered flight still waits for Begin');
  assert(
    again.doc.getElementById('begin').classList.contains('ready') && !again.doc.getElementById('beginBtn').disabled,
    'a remembered flight opens on the gate too',
  );
  again.doc.getElementById('beginBtn').click();
  if (again.z.paused) again.doc.getElementById('pauseBtn').click();
  await wait(400);
  assert(again.z.state.t > left.t && again.z.state.t < left.t + 5, 'Begin continues the remembered clock');
  assert(!again.z.title.started && again.z.title.name === 0, 'a remembered flight never shows the title card');
  assert(again.z.masterGain < 0.0001, 'remembered sound off keeps the audio silent');
  await closeWorld(again);
  // An explicit seed in the address always wins; only the settings carry over.
  const other = new URL(location.href);
  other.searchParams.set('seed', String((left.seed + 1) >>> 0));
  const fresh = await openWorld(other.href);
  assert(
    fresh.z.seed === (left.seed + 1) >>> 0 && !fresh.z.resumed && fresh.z.state.t === 0,
    'a seed in the address opens that world from its start',
  );
  assert(fresh.z.volume === 0.4 && fresh.z.muted, 'settings carry over to another world');
  assert(fresh.z.intro.beat === 'side', 'another world opens with the opening again');
  await closeWorld(fresh);
  localStorage.clear();

  // The opening, as a first visitor sees it: nothing remembered, the default
  // framing. Stepped deterministically from Begin: abeam of the sunrise for
  // five seconds, a turn at the sunrise pull's gentle cap to face the sun as it
  // clears the horizon, a climb through the deck with the day stretched so the
  // sun stays low, a hold above the clouds with the sun in the frame and its
  // light on the tops, a dive, and then the flight is its own.
  const firstUrl = new URL(location.href);
  firstUrl.searchParams.set('seed', String((left.seed + 2) >>> 0));
  const first = await openWorld(firstUrl.href);
  const f = first.z,
    O = f.opening;
  assert(!f.resumed && f.intro.beat === 'side' && f.cam.yaw === 0, 'a first visit arms the opening with the default framing');
  first.doc.getElementById('beginBtn').click();
  if (!f.paused) first.doc.getElementById('pauseBtn').click();
  const stepTo = (t) => {
    while (f.state.t < t - 0.0001) f.step(0.05);
  };
  const offSun = () => Math.abs(wrapAngle(f.state.heading - azimuth(f.sky.sun)));
  const startHeading = f.state.heading;
  assert(Math.abs(offSun() - Math.PI / 2) < 0.03 && f.sky.sun.y < 0, 'the opening starts abeam of a sun still below the horizon');
  stepTo(O.side - 0.1);
  assert(
    f.intro.beat === 'side' && Math.abs(wrapAngle(f.state.heading - startHeading)) < 0.01 && Math.abs(f.dayRate - 1) < 0.001,
    'the bird holds its course for the first five seconds at the day\'s own pace',
  );
  const FT = f.titleCard,
    titleName = first.doc.getElementById('titleName'),
    titlePresents = first.doc.getElementById('titlePresents');
  assert(!f.title.started && titleName.style.opacity === '' && titlePresents.style.opacity === '', 'no title card while the bird holds its course');
  let maxTurn = 0;
  stepTo(O.side + 0.5);
  assert(
    f.intro.beat === 'pivot' && !f.title.started && f.title.presents === 0 && titleName.style.opacity === '',
    'the title card stays hidden for the first three seconds of the turn toward the sun',
  );
  stepTo(O.side + 3.5);
  assert(
    f.intro.beat === 'pivot' && f.title.started && f.title.presents > 0 && f.title.name === 0 && Number(titlePresents.style.opacity) > 0 && Number(titleName.style.opacity) === 0,
    '"Kun Chen Presents" starts to come up three seconds into the turn, ahead of the title',
  );
  const turnUntil = (t) => {
    while (f.state.t < t) {
      f.step(0.05);
      maxTurn = Math.max(maxTurn, Math.abs(f.state.yawRate));
    }
  };
  turnUntil(O.beforeSunrise - 0.3);
  assert(f.intro.beat === 'pivot' && f.sky.sun.y < 0, 'the turn toward the sun begins before it rises');
  assert(f.title.presents > 0 && f.title.presents < 1 && f.title.name < 0.1, 'Kun Chen Presents is still coming up as the sun reaches the horizon');
  turnUntil(O.beforeSunrise + 0.3);
  assert(f.sky.sun.y > 0, 'the sun crosses the horizon ten seconds in, during the turn');
  turnUntil(O.climbAt + 0.05);
  assert(f.intro.beat === 'climb' && f.title.name > 0.9 && f.title.name < 1, 'the title is still coming up as the bird, facing the risen sun, begins to climb');
  stepTo(O.side + 3 + FT.name[1] + 0.05);
  assert(
    f.title.name === 1 && f.sky.sun.y > 0 && f.intro.beat === 'climb' && Number(titleName.style.opacity) === 1 && Number(titlePresents.style.opacity) === 1,
    'the title stands fully up after the sun has crested, as the bird begins its climb',
  );
  turnUntil(O.climbAt + 4);
  assert(maxTurn > 0.15 && maxTurn < 0.21, 'the turn is a real bank, capped at the sunrise pull\'s rate', `${maxTurn.toFixed(3)}`);
  assert(f.intro.beat === 'climb' && offSun() < 0.1 && f.state.vy > 5, 'facing the sun, the bird climbs');
  stepTo(O.climbAt + 12);
  assert(Math.abs(f.dayRate - O.stretch) < 0.02, 'the day is stretched while the bird climbs', `${f.dayRate.toFixed(2)}`);
  stepTo(O.side + 3 + FT.out[1] + 0.05);
  assert(
    f.title.done && f.title.name === 0 && f.title.presents === 0 && Number(titleName.style.opacity) === 0 && f.intro.beat === 'climb',
    'the title card is gone before the climb reaches the clouds',
    `${f.state.y.toFixed(0)} m`,
  );
  let climbSteps = 0;
  while (f.intro.beat === 'climb' && climbSteps++ < 1400) f.step(0.05);
  const deck = f.objects.cloudSea.position.y + 55;
  assert(
    f.intro.beat === 'above' && f.state.y > deck + 100 && f.state.t < O.climbLimit,
    'the bird rises above the clouds within the climb allowance',
    `${f.state.y.toFixed(0)} m at ${f.state.t.toFixed(0)} s`,
  );
  const sunElevation = Math.asin(f.sky.sun.y);
  assert(sunElevation > 0.06 && sunElevation < 0.2 && offSun() < 0.1, 'above the clouds the bird faces a sun still low', `${(sunElevation * 57.3).toFixed(1)} deg`);
  // What is drawn: the sun's disc over the sea, brighter than the sky around it,
  // and the tops warmer under the low sun than they are at noon, with real relief.
  const picture = async () => {
    const shot = await f.capture(192, 108);
    const { width, height, data } = shot;
    const at = (x, y) => {
      const i = (Math.min(width - 1, Math.max(0, x)) + Math.min(height - 1, Math.max(0, y)) * width) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    f.camera.updateMatrixWorld(true);
    f.camera.matrixWorldInverse.copy(f.camera.matrixWorld).invert();
    const p = f.sky.sun.clone().multiplyScalar(1000).add(f.camera.position).project(f.camera);
    const sx = Math.round(((p.x + 1) / 2) * width),
      sy = Math.round(((1 - p.y) / 2) * height);
    const inFrame = p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9;
    let disc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) disc += lum(at(sx + dx, sy + dy)) / 9;
    let ring = 0;
    for (let a = 0; a < 16; a++)
      ring += lum(at(Math.round(sx + Math.cos((a / 16) * 6.283) * 9), Math.round(sy + Math.sin((a / 16) * 6.283) * 9))) / 16;
    let warmth = 0,
      sum = 0,
      squares = 0,
      count = 0;
    for (let y = Math.floor(height * 0.6); y < height * 0.95; y += 2)
      for (let x = 4; x < width - 4; x += 3) {
        const c = at(x, y),
          l = lum(c);
        warmth += c[0] - c[2];
        sum += l;
        squares += l * l;
        count++;
      }
    return { inFrame, disc, ring, warmth: warmth / count, relief: Math.sqrt(squares / count - (sum / count) ** 2) };
  };
  const dawn = await picture();
  assert(dawn.inFrame && dawn.disc > dawn.ring * 1.4, 'the sun is drawn over the cloud sea, brighter than the sky around it', `${dawn.disc.toFixed(2)} against ${dawn.ring.toFixed(2)}`);
  assert(dawn.relief > 0.04, 'the cloud tops have relief, not a flat sheet', `${dawn.relief.toFixed(3)}`);
  const dawnPhase = f.dayPhase;
  f.dayPhase = 0.5;
  f.step(0.05);
  const noon = await picture();
  f.dayPhase = dawnPhase;
  f.step(0.05);
  assert(dawn.warmth > noon.warmth + 0.12, 'the low sun lays warm color across the cloud tops that noon does not', `${dawn.warmth.toFixed(2)} against ${noon.warmth.toFixed(2)}`);
  assert(noon.relief > 0.02, 'the tops stay sculpted under a high sun', `${noon.relief.toFixed(3)}`);
  stepTo(f.intro.at + O.hold + 0.1);
  assert(f.intro.beat === 'dive', 'after a hold above the clouds the bird dives');
  stepTo(f.intro.at + 8);
  assert(f.state.vy < -8, 'the dive is a real descent', `${f.state.vy.toFixed(1)} m/s`);
  stepTo(f.intro.at + O.dive + 0.1);
  assert(
    !f.intro.beat && f.intro.ended === 'flown' && f.cloudCycle < 1 && f.state.y < deck - 50 && f.dayRate > 0.95,
    'back under the deck the flight is its own, at the day\'s own pace, with a full low stretch ahead',
  );
  // The captain outranks the script. Put the opening back into its hold above
  // the clouds, where it climbs, and a downward steer takes the vertical away
  // from it at once and hands the flight back, as any steer does.
  f.intro.beat = 'above';
  f.intro.at = f.state.t;
  stepTo(f.state.t + 6);
  assert(
    f.intro.beat === 'above' && f.state.vy > 6,
    'the opening climbs again when it is put back on its beat',
    `${f.state.vy.toFixed(1)} m/s`,
  );
  {
    const stick = first.doc.getElementById('c');
    const steer = (type, x, y) =>
      stick.dispatchEvent(
        new first.win.PointerEvent(type, {
          clientX: x,
          clientY: y,
          button: 2,
          buttons: 2,
          pointerId: 8,
          pointerType: 'mouse',
          bubbles: true,
          cancelable: true,
        }),
      );
    steer('pointerdown', 100, 100);
    steer('pointermove', 100, 240);
    assert(
      !f.intro.beat && f.intro.ended === 'steered' && f.state.aimHold === 1,
      'a vertical steer hands the opening back the moment it is made',
    );
    stepTo(f.state.t + 3);
    assert(
      f.state.vy < -8 && f.state.pitch < -0.2,
      'and the steered dive takes the vertical from the climb the script had planned',
      `${f.state.vy.toFixed(1)} m/s`,
    );
    steer('pointerup', 100, 240);
  }
  assert(!first.win.flightFailed, 'the opening renders without a graphics failure');
  await closeWorld(first);
  localStorage.clear();
  return {
    checks,
    maxSurfaceError,
    maxTreeError,
    maxGrassError,
    maxRise,
    minMeshClearance,
    minBird,
    minCamera,
    highest,
    lowest,
    lowestGround,
    lowestAhead,
    performance,
  };
}
