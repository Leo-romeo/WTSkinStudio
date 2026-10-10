/*==SYMMETRY==*/
// ---- Where is the mirror plane, really? ----
// This used to be a guess twice over: the plane was the bounding box's CENTRE, and the axis was
// chosen between x and z by the skewness of the vertex distribution — which is not a measure of
// symmetry at all. Both are thrown off by one asymmetric part, and y was never considered.
//
// Measured 2026-08-05 over three vehicles by scoring how much of the model overlaps its own
// reflection: the real axis is z on all three and the real plane is the model's own ORIGIN
// (F-111A 82.8 % symmetric, Su-30SM2 82.2 %, M1A2 65.7 %). The bounding-box centre agreed on two
// of them by luck and was **2.5 m out on the Su-30SM2**, where it scored 15.1 % — a mirrored
// stroke landing nowhere near its partner, which is what was reported. x and y score 30–48 % on
// every vehicle, which is just the noise floor of a shape overlapping itself.
//
// So: measure it. Voxelise a sample of the vertices and score candidate planes per axis, keeping
// the best. Subsampled and coarse on purpose — this runs on every geometry load, and the answer
// only has to be good to a fraction of a voxel because `symOffset` is the manual nudge.
//
// Cost: ~100 ms on a 2 M-vertex F-111A, which is why it is keyed on the geometry object and not
// re-run by every rebuildAll — buildScene runs again each time a texture finishes decoding.
//
// It is also only the FALLBACK. Where the model names its own parts, symmetryFromPairs below is
// exact rather than close, and costs a fraction as much.
const SYM_SAMPLES = 25000, SYM_RES = 64;
// ---- The mirror plane, read off the model's own part names ----
// Every side-tagged part has a twin — `slat1_l`/`slat1_r`, `flaperon_l`/`flaperon_r`,
// `wheel_l_01`/`wheel_r_01` — and the plane is the midpoint between the pair. `partSegments`
// already separates a side token from a name, so this is a use of machinery that exists.
//
// Measured 2026-08-05 across three vehicles, this is exact where the shape scan is merely close:
// the median midpoint on z is −0.0000 (F-111A, 28 pairs), 0.0004 (Su-30SM2, 60) and −0.0000
// (M1A2, 55). It names the AXIS for free too, and more robustly than any shape statistic: twins
// are 6.003 m apart on z and 0.015 m apart on x for the F-111A, so the mirrored axis is simply
// the one the twins are FAR APART on, and the others are the ones they sit on top of each other on.
//
// The MEDIAN, not the mean. One mis-paired name, or a part that is genuinely not mirrored, drags a
// mean and cannot move a median: the Su-30SM2's z midpoints have a ±0.857 spread about a median of
// 0.0004, and its weighted mean is 0.0001 only because the outliers happen to cancel.
function symmetryFromPairs(size){
  const byKey = new Map();
  for (const g of App.geomData) {
    if (!g.position || !g.position.length) continue;
    const seg = partSegments(g.name);
    if (seg.side !== "l" && seg.side !== "r") continue;
    const n = g.position.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < g.position.length; i += 3) { cx += g.position[i]; cy += g.position[i+1]; cz += g.position[i+2]; }
    const key = seg.levels.join("/") + "#" + (seg.index || "");
    if (!byKey.has(key)) byKey.set(key, {});
    byKey.get(key)[seg.side] = [cx / n, cy / n, cz / n];
  }
  const pairs = [];
  for (const v of byKey.values()) if (v.l && v.r) pairs.push(v);
  if (pairs.length < 3) return null;
  const AX = ["x", "y", "z"];
  const median = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const centres = {}, sep = {};
  for (let k = 0; k < 3; k++) {
    centres[AX[k]] = median(pairs.map(p => (p.l[k] + p.r[k]) / 2));
    sep[AX[k]] = pairs.reduce((t, p) => t + Math.abs(p.l[k] - p.r[k]), 0) / pairs.length;
  }
  const axis = AX.reduce((a, b) => sep[b] > sep[a] ? b : a);
  const span = Math.max(size.x, size.y, size.z) || 1;
  const rest = AX.filter(a => a !== axis).map(a => sep[a]);
  // Two ways this can be meaningless, and both must be refused rather than guessed through: the
  // twins coincide (nothing is actually mirrored, e.g. a part named `_l` with no counterpart
  // offset), or no axis stands out (so "which one" would be a coin toss).
  if (sep[axis] < span * 0.02) return null;
  if (sep[axis] < 4 * Math.max(...rest)) return null;
  const k = AX.indexOf(axis), tol = span * 0.02;
  const agree = pairs.filter(p => Math.abs((p.l[k] + p.r[k]) / 2 - centres[axis]) <= tol).length / pairs.length;
  return { axis, centres, pairs: pairs.length, agree };
}
function findSymmetry(c, s){
  if (App._symGeom === App.geomData) return;
  App._symGeom = App.geomData;
  const named = symmetryFromPairs(s);
  if (named) {
    App.autoAxis = named.axis;
    App.mirrorCenters = named.centres;
    App.symFrom = "pairs";
    App.symPairs = named.pairs;
    App.symAgree = named.agree;
    App.symScore = named.agree;
    App.symScores = null;                 // a shape score would mean something different — see the UI
    return;
  }
  App.symFrom = "shape";
  App.symPairs = 0;
  const span = Math.max(s.x, s.y, s.z) || 1;
  const cell = span / SYM_RES;
  const lo = { x: c.x - s.x / 2, y: c.y - s.y / 2, z: c.z - s.z / 2 };
  // stride the vertices rather than take a prefix: a prefix is one part of the model, not a sample
  let total = 0;
  for (const g of App.geomData) total += g.position.length / 3;
  const step = Math.max(1, Math.floor(total / SYM_SAMPLES)) * 3;
  const bins = { x: [], y: [], z: [] };
  const cells = new Set();
  for (const g of App.geomData) {
    const p = g.position;
    for (let i = 0; i < p.length; i += step) {
      const bx = Math.round((p[i] - lo.x) / cell), by = Math.round((p[i+1] - lo.y) / cell), bz = Math.round((p[i+2] - lo.z) / cell);
      cells.add((bx * 4096 + by) * 4096 + bz);
      bins.x.push(bx); bins.y.push(by); bins.z.push(bz);
    }
  }
  const n = bins.x.length;
  if (!n) { App.autoAxis = "z"; App.mirrorCenters = { x: c.x, y: c.y, z: c.z }; App.symScore = 0; return; }
  // A plane at half-cell resolution maps bin i to (k - i), so k runs over twice the extent.
  const score = (ax, k) => {
    const A = bins.x, B = bins.y, C = bins.z;
    let hit = 0;
    for (let j = 0; j < n; j++) {
      let bx = A[j], by = B[j], bz = C[j];
      if (ax === "x") bx = k - bx; else if (ax === "y") by = k - by; else bz = k - bz;
      if (bx < 0 || by < 0 || bz < 0) continue;
      if (cells.has((bx * 4096 + by) * 4096 + bz)) hit++;
    }
    return hit / n;
  };
  // Every axis gets its own measured plane, not just the winner: picking one by hand should give
  // the best plane for THAT axis rather than the bounding box's centre. `symScores` is what says
  // whether it means anything — on a vehicle only one axis is a real mirror, and the other two sit
  // at the noise floor of a shape overlapping itself (30–48 % on all three measured).
  const centres = {}, scores = {};
  let best = { a: "z", s: -1 };
  for (const ax of ["x", "y", "z"]) {
    const extent = Math.round((ax === "x" ? s.x : ax === "y" ? s.y : s.z) / cell);
    let b = { k: 0, s: -1 };
    for (let k = 0; k <= 2 * extent; k++) {
      const v = score(ax, k);
      if (v > b.s) b = { k, s: v };
    }
    centres[ax] = lo[ax] + b.k / 2 * cell;
    scores[ax] = b.s;
    if (b.s > best.s) best = { a: ax, s: b.s };
  }
  App.autoAxis = best.a;
  App.symScore = best.s;
  App.symScores = scores;
  App.mirrorCenters = centres;
}
/*==ENDSYMMETRY==*/
