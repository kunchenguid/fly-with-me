// Plumage: many birds from a few kinds. A kind (library/birds/) is a shape
// with its own colors. A plumage (library/plumages/) is a coloring, four role
// colors and an accent; laid over a kind it keeps every relation the kind's
// own palette had (a covert band a shade paler than the wing, a crown darker
// than the head) by carrying each named color's offset from its role onto the
// plumage's color for that role. A marking (library/markings/) is a rule that
// says where the accent goes; it is painted over the built geometry by where
// each vertex sits. Every kind x plumage pair is one variant with a marking
// by rule, and a kind in its own colors is the first variant of its row, so
// the shipped birds are untouched until a viewer picks a plumage. Nothing
// here makes a material, and the bird kit in src/birds.js is not changed.

import { Color, SRGBColorSpace } from 'three';
import { ENVELOPE } from '../library/contract.js';

// ---------------------------------------------------------------------------
// Recoloring. Which of the four roles each of a kind's named colors belongs
// to; a name not listed is a body color. Adding a role name is one entry.
// ---------------------------------------------------------------------------
const ROLE = {
  body: 'body', belly: 'body', face: 'body', head: 'body', neck: 'body', throat: 'body', crown: 'body', cap: 'body', eye: 'body', rump: 'body', mantle: 'body',
  wing: 'wing', hand: 'wing', covert: 'wing', tail: 'wing', legs: 'wing',
  tip: 'tip',
  beak: 'beak',
};
const hsl = { h: 0, s: 0, l: 0 },
  base = { h: 0, s: 0, l: 0 },
  target = { h: 0, s: 0, l: 0 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A named color carried from the kind's role color onto the plumage's: same
// hue turn, same saturation and lightness offsets, clamped into the envelope.
// A grey base has no hue to turn from, so it takes the plumage's outright.
function carry(named, roleColor, plumageColor) {
  new Color(named).getHSL(hsl, SRGBColorSpace);
  new Color(roleColor).getHSL(base, SRGBColorSpace);
  new Color(plumageColor).getHSL(target, SRGBColorSpace);
  const h = base.s < 0.08 ? target.h : (target.h + (hsl.h - base.h) + 1) % 1;
  const s = clamp(target.s + (hsl.s - base.s), 0, ENVELOPE.maxSaturation);
  const l = clamp(target.l + (hsl.l - base.l), ENVELOPE.minLightness, ENVELOPE.maxLightness);
  return new Color().setHSL(h, s, l, SRGBColorSpace).getHex(SRGBColorSpace);
}
/** A kind's colors re-laid in a plumage: every name keeps its place in the kind's own palette. */
export function recolor(kind, plumage) {
  const colors = {};
  for (const [name, value] of Object.entries(kind.colors)) {
    const role = ROLE[name] ?? 'body';
    colors[name] = name === role ? plumage[role] : carry(value, kind.colors[role] ?? kind.colors.body, plumage[role]);
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Markings. A body rule sees a vertex in bird space with the kind's data and
// this kit; a wing rule sees a segment's pivot frame with the segment's data.
// ---------------------------------------------------------------------------
const markKit = {
  /** Whether a vertex lies inside one of the kind's ellipsoid parts, grown a little so a surface counts. */
  inside: (v, part, grow = 1.02) =>
    ((v.x - part.at[0]) / (part.r * part.scale[0])) ** 2 + ((v.y - part.at[1]) / (part.r * part.scale[1])) ** 2 + ((v.z - part.at[2]) / (part.r * part.scale[2])) ** 2 <= grow * grow,
};
/** Paints a marking's accent over a built bird in place; the kit's output is otherwise untouched. */
export function paintMarking(built, kind, marking, accent) {
  if (!marking.body && !marking.wing) return built;
  const c = new Color(accent),
    v = { x: 0, y: 0, z: 0 };
  const paint = (geometry, rule) => {
    const pos = geometry.attributes.position,
      col = geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      v.x = pos.getX(i);
      v.y = pos.getY(i);
      v.z = pos.getZ(i);
      if (rule(v)) col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };
  if (marking.body) paint(built.body, (p) => marking.body(p, kind, markKit));
  if (marking.wing) for (const wing of built.wings) wing.segments.forEach((seg, i) => paint(seg.geometry, (p) => marking.wing(p, kind.wings.segments[i], i, markKit)));
  return built;
}

// ---------------------------------------------------------------------------
// The catalog: for every kind, its own colors first, then every plumage with
// a marking by rule, spread so a kind shows every marking and no plumage
// wears the same one on two kinds. Built once from the registry.
// ---------------------------------------------------------------------------
export function plumageCatalog({ birds, plumages, markings }) {
  const variantOf = (kind, plumageId) => {
    const pi = plumages.findIndex((p) => p.id === plumageId);
    if (pi < 0) return { id: kind.id, name: kind.name, kind, base: kind, plumage: null, marking: markings[0] };
    const plumage = plumages[pi],
      marking = markings[(birds.indexOf(kind) * 3 + pi * 5) % markings.length];
    return { id: `${kind.id}-${plumage.id}`, name: `${plumage.name} ${kind.name}`, kind: { ...kind, colors: recolor(kind, plumage) }, base: kind, plumage, marking };
  };
  const variants = birds.flatMap((kind) => [variantOf(kind, null), ...plumages.map((p) => variantOf(kind, p.id))]);
  // A flock of one kind with the spread of a real flock: most birds the
  // chosen plumage, two its neighbors in the list. Own colors stay one plumage.
  const flock = (plumageId, i) => {
    const pi = plumages.findIndex((p) => p.id === plumageId);
    if (pi < 0) return null;
    const n = plumages.length,
      drift = [0, 0, n - 1, 0, 1];
    return plumages[(pi + drift[i % drift.length]) % n].id;
  };
  return { variants, variantOf, flock, has: (plumageId) => plumages.some((p) => p.id === plumageId) };
}

// ---------------------------------------------------------------------------
// The tile: a top-down silhouette from the kind's own numbers, as inline SVG,
// for a chooser that costs no GPU. Marks, bands, fingers, a neck, legs and the
// marking are all drawn where the kit would build them.
// ---------------------------------------------------------------------------
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
export function plumageTile(variant) {
  const k = variant.kind,
    s = k.scale ?? 1,
    accent = variant.plumage ? hex(variant.plumage.accent) : null,
    mark = variant.marking.id;
  const col = (name, fallback) => hex(typeof name === 'string' ? k.colors[name] : name ?? fallback);
  const X = (x) => (x * s).toFixed(2),
    Y = (z) => (-z * s).toFixed(2),
    R = (r) => (r * s).toFixed(2);
  const out = [];
  const w = k.wings;
  for (const d of [-1, 1]) {
    let x = w.root[0];
    w.segments.forEach((seg, i) => {
      const x1 = x + seg.len,
        color = col(seg.color, k.colors[w.colors[i]]);
      const lead = `M${X(d * x)} ${Y(seg.lead)} Q${X(d * (x + seg.len * 0.6))} ${Y(seg.lead * 0.95)} ${X(d * x1)} ${Y(seg.leadTip)}`;
      const tip = seg.tip === 'round' ? ` Q${X(d * (x1 + (seg.round ?? 0.2)))} ${Y((seg.leadTip + seg.trailTip) / 2)} ${X(d * x1)} ${Y(seg.trailTip)}` : ` L${X(d * x1)} ${Y(seg.trailTip)}`;
      out.push(`<path fill="${color}" d="${lead}${tip} L${X(d * x)} ${Y(seg.trail)} Z"/>`);
      for (const band of seg.bands ?? []) {
        const t = seg.lead + (seg.trail - seg.lead) * band.to,
          tt = seg.leadTip + (seg.trailTip - seg.leadTip) * band.to;
        out.push(`<path fill="${col(band.color, k.colors[w.colors[i]])}" d="${lead} L${X(d * x1)} ${Y(tt)} L${X(d * x)} ${Y(t)} Z"/>`);
      }
      if (mark === 'bar' && i < 2) {
        const a = seg.trail + (seg.lead - seg.trail) * 0.56,
          b = seg.trail + (seg.lead - seg.trail) * 0.36;
        out.push(`<path fill="${accent}" d="M${X(d * x)} ${Y(a)} L${X(d * x1)} ${Y(a)} L${X(d * x1)} ${Y(b)} L${X(d * x)} ${Y(b)} Z"/>`);
      }
      if (seg.primaries) {
        const p = seg.primaries;
        for (let j = 0; j < p.count; j++) {
          const px = x + p.x0 + j * p.dx,
            len = p.len + j * (p.dlen ?? 0),
            yaw = (p.yaw + j * (p.dyaw ?? 0)) * 57.3,
            fill = mark === 'barred' && j % 2 === 1 ? accent : col(p.color, k.colors.tip);
          out.push(`<ellipse fill="${fill}" cx="${X(d * px)}" cy="${Y(p.z - len * 0.9)}" rx="${R(p.w * 0.6)}" ry="${R(len)}" transform="rotate(${(d * -yaw).toFixed(0)} ${X(d * px)} ${Y(p.z - len * 0.9)})"/>`);
        }
      }
      if (seg.fingers) {
        const f = seg.fingers;
        for (let j = 0; j < f.count; j++) {
          const t = f.count > 1 ? j / (f.count - 1) : 0,
            angle = f.from + (f.to - f.from) * t,
            len = f.len - t * (f.taper ?? 0);
          const cx = x + f.root[0] + Math.cos(angle) * len,
            cz = f.root[1] - Math.sin(angle) * len;
          out.push(`<line stroke="${col(f.color, k.colors.tip)}" stroke-width="${R(f.w * 1.2)}" stroke-linecap="round" x1="${X(d * (x + f.root[0]))}" y1="${Y(f.root[1])}" x2="${X(d * cx)}" y2="${Y(cz)}"/>`);
        }
      }
      x = x1;
    });
  }
  for (const set of k.tail ?? []) {
    const blades = set.count
      ? Array.from({ length: set.count }, (_, i) => {
          const q = i - (set.count - 1) / 2;
          return { x: q * set.x, z: set.z - Math.abs(q) * (set.taper ?? 0) * 0.5, w: set.w, len: set.len - Math.abs(q) * (set.taper ?? 0), yaw: q * set.yaw, color: set.color };
        })
      : [set];
    for (const t of blades)
      out.push(`<ellipse fill="${mark === 'rump' ? accent : col(t.color, k.colors.tip)}" cx="${X(t.x)}" cy="${Y(t.z)}" rx="${R(t.w * 0.7)}" ry="${R(t.len)}" transform="rotate(${(-t.yaw * 57.3).toFixed(0)} ${X(t.x)} ${Y(t.z)})"/>`);
  }
  if (k.legs) for (const d of [-1, 1]) out.push(`<line stroke="${col(k.legs.color, k.colors.tip)}" stroke-width="${R(k.legs.r * 2)}" x1="${X(d * k.legs.from[0])}" y1="${Y(k.legs.from[2])}" x2="${X(d * k.legs.to[0])}" y2="${Y(k.legs.to[2])}"/>`);
  const b = k.body;
  out.push(`<ellipse fill="${col(b.color, k.colors.body)}" cx="${X(b.at[0])}" cy="${Y(b.at[2])}" rx="${R(b.r * b.scale[0])}" ry="${R(b.r * b.scale[2])}"/>`);
  if (mark === 'rump') out.push(`<ellipse fill="${accent}" cx="0" cy="${Y(b.at[2] - 0.62 * b.r * b.scale[2])}" rx="${R(0.85 * b.r * b.scale[0])}" ry="${R(0.36 * b.r * b.scale[2])}"/>`);
  if (mark === 'collar') out.push(`<ellipse fill="${accent}" cx="0" cy="${Y(b.at[2] + 0.62 * b.r * b.scale[2])}" rx="${R(0.95 * b.r * b.scale[0])}" ry="${R(0.11)}"/>`);
  if (k.neck) out.push(`<line stroke="${col(k.neck.color, k.colors.body)}" stroke-width="${R(k.neck.r0 * 1.8)}" stroke-linecap="round" x1="${X(k.neck.from[0])}" y1="${Y(k.neck.from[2])}" x2="${X(k.neck.to[0])}" y2="${Y(k.neck.to[2])}"/>`);
  const h = k.head;
  out.push(`<ellipse fill="${col(h.color, k.colors.body)}" cx="${X(h.at[0])}" cy="${Y(h.at[2])}" rx="${R(h.r * h.scale[0])}" ry="${R(h.r * h.scale[2])}"/>`);
  for (const m of k.marks ?? []) if (m.at[1] >= (markKit.inside({ x: m.at[0], y: m.at[1], z: m.at[2] }, h, 1.3) ? h.at[1] : b.at[1])) out.push(`<ellipse fill="${col(m.color, k.colors.body)}" cx="${X(m.at[0])}" cy="${Y(m.at[2])}" rx="${R(m.r * m.scale[0])}" ry="${R(m.r * m.scale[2])}"/>`);
  if (mark === 'cap') out.push(`<ellipse fill="${accent}" cx="${X(h.at[0])}" cy="${Y(h.at[2])}" rx="${R(h.r * h.scale[0] * 0.75)}" ry="${R(h.r * h.scale[2] * 0.6)}"/>`);
  if (mark === 'mask') out.push(`<rect fill="${accent}" x="${X(h.at[0] - h.r * h.scale[0])}" y="${Y(h.at[2] + h.r * h.scale[2] * 0.35)}" width="${R(2 * h.r * h.scale[0])}" height="${R(h.r * h.scale[2] * 0.45)}" rx="${R(0.05)}"/>`);
  if (mark === 'throat') out.push(`<ellipse fill="${accent}" cx="${X(h.at[0])}" cy="${Y(h.at[2] - h.r * h.scale[2] * 0.7)}" rx="${R(h.r * h.scale[0] * 0.5)}" ry="${R(h.r * h.scale[2] * 0.3)}"/>`);
  const bk = k.beak;
  out.push(`<path fill="${col(bk.color, k.colors.beak)}" d="M${X(bk.at[0] - bk.r * 1.1)} ${Y(bk.at[2] - bk.len * 0.4)} L${X(bk.at[0])} ${Y(bk.at[2] + bk.len * 0.6)} L${X(bk.at[0] + bk.r * 1.1)} ${Y(bk.at[2] - bk.len * 0.4)} Z"/>`);
  return `<svg viewBox="-6.4 -3.2 12.8 6.4" width="100%" height="100%" aria-hidden="true">${out.join('')}</svg>`;
}
