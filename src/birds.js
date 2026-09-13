// The bird kit. Every kind in library/birds/ is data over it, the way a
// species is data over the tree kit: an ellipsoid body, a head on an optional
// neck, a beak, a tail of blades, marks, optional trailing legs, and two wings
// of three hinged segments, each a curved membrane with painted primaries,
// optional slotted fingers and a covert band, plus a flight profile the hinges
// follow. buildBird lays out vertex-colored geometry only; the engine makes
// the meshes, lights them with its own soft material, keeps the flock, and
// drives the hinges with animateBird. Lengths are meters; the bird faces +z.

// A set of tail blades. With `count` it is a fan: k runs from the middle
// outward, so x, yaw and taper spread symmetrically. Without, one blade.
function tailBlades(set) {
  if (!set.count) return [{ ...set }];
  return Array.from({ length: set.count }, (_, i) => {
    const k = i - (set.count - 1) / 2;
    return {
      x: k * set.x,
      y: (set.y ?? -0.03) - Math.abs(k) * (set.droop ?? 0),
      z: set.z - Math.abs(k) * (set.taper ?? 0) * 0.5,
      w: set.w,
      len: set.len - Math.abs(k) * (set.taper ?? 0),
      yaw: k * set.yaw,
      color: set.color,
    };
  });
}
// Primaries along a segment's trailing edge, from the root outward; the blade
// at j starts at x0 + j * dx, fans back by yaw + j * dyaw and shortens by dlen.
const primaries = (o) =>
  Array.from({ length: o.count }, (_, j) => ({
    x: o.x0 + j * o.dx,
    y: o.y ?? -0.01,
    z: o.z,
    w: o.w,
    thick: o.thick ?? 0.025,
    len: o.len + j * (o.dlen ?? 0),
    yaw: o.yaw + j * (o.dyaw ?? 0),
    color: o.color,
  }));
// Fingers: long separated primaries radiating from the wingtip, from an angle
// `from` to `to` measured from straight outward toward straight back, lifting
// toward the middle so a soaring wing reads as slotted.
const fingers = (o) =>
  Array.from({ length: o.count }, (_, j) => {
    const t = o.count > 1 ? j / (o.count - 1) : 0;
    return {
      root: o.root,
      angle: o.from + (o.to - o.from) * t,
      len: o.len - t * (o.taper ?? 0),
      w: o.w,
      thick: o.thick ?? 0.025,
      lift: (o.lift ?? 0) * (1 - Math.abs(t - 0.5) * 2),
      color: o.color,
    };
  });

// A blade: one flattened ellipsoid with its long axis along `dir`.
function blade(kit, center, dir, w, thick, len) {
  const { THREE } = kit;
  const d = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  return {
    geometry: new THREE.SphereGeometry(1, 8, 5),
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(...center), q, new THREE.Vector3(w, thick, len)),
  };
}
// A strut between two points: legs.
function strut(kit, from, to, r) {
  const { THREE } = kit;
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const d = b.clone().sub(a),
    len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return {
    geometry: new THREE.CylinderGeometry(r, r * 0.8, len, 6),
    matrix: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)),
  };
}
// A neck: one tapered tube along an arched curve from the breast to the head,
// so it reads as one smooth limb and not a string of beads.
function neck(kit, n) {
  const { THREE } = kit;
  const p0 = new THREE.Vector3(...n.from),
    p2 = new THREE.Vector3(...n.to),
    c = p0.clone().add(p2).multiplyScalar(0.5).add(new THREE.Vector3(0, n.arch ?? 0, 0));
  const curve = new THREE.QuadraticBezierCurve3(p0, c, p2);
  const rings = 18,
    around = 10;
  const g = new THREE.TubeGeometry(curve, rings, 1, around, false);
  const pos = g.attributes.position,
    at = new THREE.Vector3(),
    v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings,
      r = n.r0 + (n.r1 - n.r0) * t;
    curve.getPoint(t, at);
    for (let j = 0; j <= around; j++) {
      const k = i * (around + 1) + j;
      v.fromBufferAttribute(pos, k).sub(at).multiplyScalar(r).add(at);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
// One wing segment's membrane, in the pivot's frame: the root along x = 0,
// the tip at x = s * len; z is forward. The leading edge curves from `lead`
// at the root to `leadTip`, the trailing edge runs straight from `trail` to
// `trailTip`; a round tip bulges outward between them, a pointed tip has
// leadTip close to trailTip.
function membrane(kit, s, seg) {
  const { THREE } = kit;
  const shape = new THREE.Shape();
  shape.moveTo(0, seg.lead);
  shape.quadraticCurveTo(s * seg.len * 0.6, seg.lead * 0.95, s * seg.len, seg.leadTip);
  if (seg.tip === 'round') shape.quadraticCurveTo(s * (seg.len + (seg.round ?? 0.2)), (seg.leadTip + seg.trailTip) / 2, s * seg.len, seg.trailTip);
  else shape.lineTo(s * seg.len, seg.trailTip);
  shape.lineTo(0, seg.trail);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 12);
  g.rotateX(Math.PI / 2);
  return g;
}

/** The wingspan a kind's data describes, in meters, before its scale. */
export const birdSpan = (kind) => 2 * (kind.wings.root[0] + kind.wings.segments.reduce((a, s) => a + s.len, 0));

// Lays out one kind: returns { body, wings: [{ s, segments: [{ at, geometry }] }] },
// every geometry vertex-colored and merged, ready for the engine's bird material.
export function buildBird(kind, kit) {
  const { THREE, merge, M } = kit;
  const col = (name, fallback) => {
    const v = name === undefined ? fallback : name;
    return typeof v === 'string' ? kind.colors[v] : v;
  };
  const parts = [];
  const b = kind.body;
  parts.push({ geometry: new THREE.SphereGeometry(b.r, 16, 10), matrix: M(...b.at, ...b.scale), color: col(b.color, kind.colors.body) });
  if (kind.neck) parts.push({ geometry: neck(kit, kind.neck), color: col(kind.neck.color, kind.colors.body) });
  const h = kind.head;
  parts.push({ geometry: new THREE.SphereGeometry(h.r, 12, 8), matrix: M(...h.at, ...h.scale), color: col(h.color, kind.colors.body) });
  const k = kind.beak;
  parts.push({
    geometry: new THREE.ConeGeometry(k.r, k.len, k.sides ?? 4),
    matrix: M(...k.at, 1, 1, 1, Math.PI / 2 + (k.tilt ?? 0), 0, 0),
    color: col(k.color, kind.colors.beak),
  });
  for (const m of kind.marks ?? [])
    parts.push({ geometry: new THREE.SphereGeometry(m.r, 12, 8), matrix: M(...m.at, ...m.scale), color: col(m.color, kind.colors.body) });
  for (const set of kind.tail ?? [])
    for (const t of tailBlades(set))
      parts.push({
        geometry: new THREE.SphereGeometry(1, 8, 5),
        matrix: M(t.x, t.y ?? -0.03, t.z, t.w, t.thick ?? 0.025, t.len, 0, t.yaw, 0),
        color: col(t.color, kind.colors.tip),
      });
  if (kind.legs) {
    const l = kind.legs;
    for (const s of [-1, 1]) {
      const from = [s * l.from[0], l.from[1], l.from[2]],
        to = [s * l.to[0], l.to[1], l.to[2]];
      parts.push({ ...strut(kit, from, to, l.r), color: col(l.color, kind.colors.tip) });
      parts.push({ geometry: new THREE.SphereGeometry(1, 8, 5), matrix: M(to[0], to[1], to[2] - l.foot[2] * 0.6, ...l.foot), color: col(l.color, kind.colors.tip) });
    }
  }
  const body = merge(parts);

  const wings = [];
  const w = kind.wings;
  for (const s of [-1, 1]) {
    const segments = [];
    let px = s * w.root[0];
    for (let i = 0; i < w.segments.length; i++) {
      const seg = w.segments[i];
      const at = i === 0 ? [px, w.root[1], w.root[2]] : [px, 0, 0];
      const color = col(seg.color, kind.colors[w.colors[i]]);
      const segParts = [{ geometry: membrane(kit, s, seg), color }];
      for (const band of seg.bands ?? []) {
        // coverts: the same membrane cut at a fraction of the chord, painted a shade over the wing
        const strip = membrane(kit, s, {
          ...seg,
          trail: seg.lead + (seg.trail - seg.lead) * band.to,
          trailTip: seg.leadTip + (seg.trailTip - seg.leadTip) * band.to,
          tip: 'flat',
        });
        strip.translate(0, 0.02, 0);
        segParts.push({ geometry: strip, color: col(band.color, color) });
      }
      if (w.under) {
        const under = membrane(kit, s, seg);
        under.translate(0, -0.03, 0);
        segParts.push({ geometry: under, color: col(w.under, kind.colors.body) });
      }
      if (seg.primaries)
        for (const p of primaries(seg.primaries))
          segParts.push({
            geometry: new THREE.SphereGeometry(1, 8, 5),
            matrix: M(s * p.x, p.y, p.z, p.w, p.thick, p.len, 0, s * p.yaw, 0),
            color: col(p.color, kind.colors.tip),
          });
      if (seg.fingers)
        for (const f of fingers(seg.fingers)) {
          // angle 0 points straight outward, pi/2 straight back; lift raises the tip
          const dir = [s * Math.cos(f.angle) * Math.cos(f.lift), Math.sin(f.lift), -Math.sin(f.angle) * Math.cos(f.lift)];
          const center = [s * f.root[0] + dir[0] * f.len, dir[1] * f.len, f.root[1] + dir[2] * f.len];
          segParts.push({ ...blade(kit, center, dir, f.w, f.thick, f.len), color: col(f.color, kind.colors.tip) });
        }
      segments.push({ at, geometry: merge(segParts) });
      px = s * seg.len;
    }
    wings.push({ s, segments });
  }
  return { body, wings };
}

// Drives the hinges from the kind's flight profile. The wings' three pivots
// carry a traveling wave from the shoulder out; `warp` makes the downstroke
// quicker than the upstroke, `sweep` draws the outer segments back on the
// downstroke, and the rest pose (the glide's dihedral) fades as the beat grows.
export function animateBird(bird, dt, flapping, speedMul = 1) {
  const u = bird.userData,
    f = u.kind.flight;
  const targetAmp = flapping ? f.amp : f.glideAmp;
  u.flapAmp += (targetAmp - u.flapAmp) * Math.min(1, dt * (f.ease ?? 3.0));
  u.phase += dt * (flapping ? f.rate : f.glideRate) * speedMul;
  const warp = f.warp ?? 0,
    sweep = f.sweep ?? 0;
  for (const w of u.wings)
    for (let i = 0; i < w.pivots.length; i++) {
      const p = u.phase - f.lag[i];
      const wave = Math.sin(p + warp * Math.sin(p));
      const a = wave * u.flapAmp * f.seg[i] + f.rest[i] * (1 - u.flapAmp * 0.5);
      w.pivots[i].rotation.z = -w.s * a;
      if (sweep && i > 0) w.pivots[i].rotation.y = w.s * sweep * (0.35 + 0.65 * Math.max(0, wave)) * Math.min(1, u.flapAmp / f.amp);
    }
}
