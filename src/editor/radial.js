/*==RADIAL==*/
"use strict";
// ---------- Radial symmetry (ROADMAP 4.44, eighth candidate) ----------
// The app mirrors a stroke across one plane. A bolt circle on a road wheel, the ring of rivets
// round a hatch, the blades of a spinner: those want N copies turned about an AXIS, of which the
// mirror is the two-copy case with a reflection instead of a turn.
//
// **The axis is a line, and it has to be picked rather than inferred.** That was measured before
// any of this was written (2026-09-22, over real DynModels): a part's own bounding box does not
// give it — an a6m2's `wheel_l` is modelled with its strut, so the box is thin on *y* while the
// axle runs on *z*, and 19 of a Pz.35(t)'s 85 parts read as disc-like with their thin axis spread
// over all three. So the user clicks the hub: that point is the centre, and the surface normal
// there is the direction — which is the axle of a wheel face, the up of a turret ring, the nose
// axis of a spinner — with x / y / z available when the pick is on a slanted face.
//
// This section is the pure half: plain arrays of numbers, no THREE, no DOM, no App, so
// `tools/t75_radial.mjs` holds it under Node against answers that are exact (N turns of 2π/N come
// home, a point on the axis is fixed, the distance to the axis is preserved, the copies are evenly
// spaced). The app-facing half — the raycast per copy and the gizmo — is beside the mirror's in
// `view3d/pointer.js`, because it is the same machinery: transform the camera's ray, cast it again.
const Radial = {
  MAX: 24,                              // copies; past this a stroke is a ring of overlapping dabs
  AXES: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  // The turn for copy `k` of `n`. Copy 0 is the stroke itself, so a caller walks 1 … n−1.
  step(n, k){ return 2 * Math.PI * k / Math.max(1, n); },
  len(v){ return Math.hypot(v[0], v[1], v[2]); },
  unit(v){ const l = Radial.len(v); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null; },
  // Which way the axis points: a named model axis, or — "auto" — the surface normal where the
  // centre was picked. Null when it cannot be answered, which is what keeps radial off rather than
  // spinning a stroke about a guess.
  dirOf(sel, normal){
    if (Radial.AXES[sel]) return Radial.AXES[sel].slice();
    if (sel !== "auto") return null;
    return normal ? Radial.unit(normal) : null;
  },
  // Rodrigues, about the line through `c` along `axis` (which must be a unit vector).
  rotate(p, c, axis, ang){
    const vx = p[0] - c[0], vy = p[1] - c[1], vz = p[2] - c[2];
    const C = Math.cos(ang), S = Math.sin(ang);
    const d = axis[0] * vx + axis[1] * vy + axis[2] * vz;
    const cx = axis[1] * vz - axis[2] * vy, cy = axis[2] * vx - axis[0] * vz, cz = axis[0] * vy - axis[1] * vx;
    return [c[0] + vx * C + cx * S + axis[0] * d * (1 - C),
            c[1] + vy * C + cy * S + axis[1] * d * (1 - C),
            c[2] + vz * C + cz * S + axis[2] * d * (1 - C)];
  },
  // The same turn applied to a direction — no centre, because a direction has no place.
  rotateDir(v, axis, ang){ return Radial.rotate(v, [0, 0, 0], axis, ang); },
  // A ray turned about the axis. The k-th copy of a stamp is found the way the mirror's is: turn
  // the camera's own ray and cast it again, so what is stamped is a real hit on the real surface
  // rather than a point guessed from the first one. Where the shape is not in fact symmetric the
  // copy simply misses, which is the honest answer.
  ray(o, d, c, axis, ang){ return { o: Radial.rotate(o, c, axis, ang), d: Radial.rotateDir(d, axis, ang) }; },
  // How far a point sits from the axis line, and how far along it — the two quantities a turn about
  // that line must leave alone, and what the test measures instead of trusting the matrix.
  about(p, c, axis){
    const vx = p[0] - c[0], vy = p[1] - c[1], vz = p[2] - c[2];
    const along = axis[0] * vx + axis[1] * vy + axis[2] * vz;
    const rx = vx - axis[0] * along, ry = vy - axis[1] * along, rz = vz - axis[2] * along;
    return { along, r: Math.hypot(rx, ry, rz) };
  },
  // What the sub-step budget becomes when every step costs `copies` raycasts instead of one.
  // A raycast is an intersectObjects over every visible part — 2.3 ms on an A-10C, which
  // is the measurement PAINT_SUB_STEPS exists for (editor/paint3d.js) — so eight copies must not
  // mean eight times the rays per pointer move. It means a coarser walk of the same move, which
  // costs a seam crossing noticed late and not a stamp missed: stamps are laid in texture space
  // between hits, not per raycast.
  budget(steps, copies){ return Math.max(1, Math.round(steps / Math.max(1, copies))); },
};
/*==ENDRADIAL==*/
