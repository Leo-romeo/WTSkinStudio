// ---- putting a weapon model into the scene ----
// The model is appended to the same geometry list the airframe uses, so it gets materials,
// texture slots, part groups, painting and export for free. Its parts are prefixed with the
// model name and an instance number, so two racks of the same bomb never collide.
function geomBounds(list){
  let x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
  for (const g of list) {
    const p = g.position;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i+1] < y0) y0 = p[i+1]; if (p[i+1] > y1) y1 = p[i+1];
      if (p[i+2] < z0) z0 = p[i+2]; if (p[i+2] > z1) z1 = p[i+2];
    }
  }
  return { x0, y0, z0, x1, y1, z1, cx: (x0+x1)/2, cy: (y0+y1)/2, cz: (z0+z1)/2, w: x1-x0, h: y1-y0, d: z1-z0 };
}
function translateGeom(list, dx, dy, dz){
  for (const g of list) { const p = g.position; for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i+1] += dy; p[i+2] += dz; } }
}
// ---- Placing a store where the game places it ----
// Each Weapon entry names an `emitter` node on the vehicle, and that node's world transform is
// in the vehicle's GeomNodeTree — so a rack goes exactly where the game hangs it, rotation and
// all, instead of being dropped under the nearest pylon-ish part. Racks then repeat the trick
// one level down: a container's `emitter` names are nodes in the *rack's* own skeleton, so the
// three bombs on a MER sit on its canted shoulder stations. Verified on the live install: all 34
// of the F-4E's emitter nodes exist in its skeleton, and 2 055 of 2 081 rack nodes exist across
// all 811 containers in the game (the 26 that don't are stale references in the game's data;
// those stores fall back to the rack's origin).
//
// One wrinkle, and it is the whole of why placement is subtle: **every stored node transform is
// already multiplied by the axis flip.** Measured 2026-09-02 over whole skeletons, not just the
// stations: 308 of the F-4E's 312 nodes have determinant −1 — blister1, pilot1, chute1, both
// airbrakes — and the only +1 is the unnamed root at the origin. Su-25: 384 of 393. A-10A: 201 of
// 209. A file in which every node is a reflection is a file whose convention is a reflection.
//
// That is exactly what buildDynModelGeometry already knows: it applies a node's wtm to the raw
// vertices and *then* negates Z, and the airframe comes out right. So the stored matrix is
// F · (the honest transform), with F = diag(1,1,−1), and recovering the honest one is a single
// row negation — not a conjugation.
//
// The conjugation is what this used to do, and it is why some stores came out mirrored: F·N·F has
// the same translation as F·N (which is why every placement test, all of which check *position*,
// passed) but keeps the determinant at −1. Reflected geometry with the winding put back reads
// correctly under the lighting and backwards under the texture — stencilled text on a bomb or a
// pylon came out written the wrong way round. Two reflections cancel, so a store on a rack was
// fine and a store hung straight off a station was not, which is what "some" meant in the report.
/*==ARMSTM==*/
// Move a stored node transform into app space: undo the flip the file baked into it.
// Same translation the conjugation gave; determinant +1 instead of −1.
function matFlipZ(m){
  return [[ m[0][0],  m[0][1],  m[0][2],  m[0][3]],
          [ m[1][0],  m[1][1],  m[1][2],  m[1][3]],
          [-m[2][0], -m[2][1], -m[2][2], -m[2][3]],
          [0, 0, 0, 1]];
}
// a ∘ b, both 4×4 row-major with translation in column 3.
function matMul(a, b){
  const out = [];
  for (let r = 0; r < 3; r++) out.push([
    a[r][0]*b[0][0] + a[r][1]*b[1][0] + a[r][2]*b[2][0],
    a[r][0]*b[0][1] + a[r][1]*b[1][1] + a[r][2]*b[2][1],
    a[r][0]*b[0][2] + a[r][1]*b[1][2] + a[r][2]*b[2][2],
    a[r][0]*b[0][3] + a[r][1]*b[1][3] + a[r][2]*b[2][3] + a[r][3],
  ]);
  out.push([0, 0, 0, 1]);
  return out;
}
function transformGeom(list, m){
  for (const g of list) {
    const p = g.position;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i+1], z = p[i+2];
      p[i]   = m[0][0]*x + m[0][1]*y + m[0][2]*z + m[0][3];
      p[i+1] = m[1][0]*x + m[1][1]*y + m[1][2]*z + m[1][3];
      p[i+2] = m[2][0]*x + m[2][1]*y + m[2][2]*z + m[2][3];
    }
    const n = g.normal;
    if (n) for (let i = 0; i < n.length; i += 3) {
      const x = n[i], y = n[i+1], z = n[i+2];
      let nx = m[0][0]*x + m[0][1]*y + m[0][2]*z;
      let ny = m[1][0]*x + m[1][1]*y + m[1][2]*z;
      let nz = m[2][0]*x + m[2][1]*y + m[2][2]*z;
      const l = Math.hypot(nx, ny, nz) || 1;
      n[i] = nx/l; n[i+1] = ny/l; n[i+2] = nz/l;
    }
  }
}
// ---- Parity, and why a single bomb once rendered white ----
// Every geometry array in this app holds triangles wound to agree with their vertex normals: that
// is what buildGeometryData produces, and it is what three.js reads as gl_FrontFacing. Materials
// are DoubleSide, and the shader negates the normal on a back face — so winding and normals must
// stay in step or a surface is lit from inside.
//
// Under the old conjugation every station placement had determinant −1, so this guard fired on
// every directly-hung store; that was the "white, unlit bomb". With matFlipZ corrected above the
// placements are proper rotations and it fires on nothing the game ships. It stays because it is
// the invariant, not the workaround: a negative-determinant transform must swap two corners of
// every triangle, and the next thing that produces one (a mirrored user placement, a modded
// skeleton) must not re-open the bug.
function matDet3(m){
  return m[0][0] * (m[1][1]*m[2][2] - m[1][2]*m[2][1])
       - m[0][1] * (m[1][0]*m[2][2] - m[1][2]*m[2][0])
       + m[0][2] * (m[1][0]*m[2][1] - m[1][1]*m[2][0]);
}
function flipWinding(list){
  for (const g of list) {
    const p = g.position, n = g.normal, uv = g.uv;
    for (let t = 0; t + 8 < p.length; t += 9) for (let k = 0; k < 3; k++) {
      let s = p[t+3+k]; p[t+3+k] = p[t+6+k]; p[t+6+k] = s;
      if (n) { s = n[t+3+k]; n[t+3+k] = n[t+6+k]; n[t+6+k] = s; }
    }
    if (uv) for (let t = 0; t + 5 < uv.length; t += 6) for (let k = 0; k < 2; k++) {
      const s = uv[t+2+k]; uv[t+2+k] = uv[t+4+k]; uv[t+4+k] = s;
    }
  }
}
// Move a store's geometry into the place the game hangs it, parity intact.
function placeGeom(list, m){
  transformGeom(list, m);
  if (matDet3(m) < 0) flipWinding(list);
}
// ---- Rocket pods: the tubes are in the model, not in the blk ----
// A container normally lists its stations as `emitter` nodes. A pod does not: it says
// `amountPerTier` (4 for a LAU-10 Zuni, 7 for a LAU-131, 19 for a LAU-61 or an M261) and leaves
// the tubes to its own skeleton, where they are a run of numbered nodes — lau_10a_zuni_001…004,
// 2_75_ffar_1…7, hydra_70_m247_001…019. Without this the pod placed ONE rocket at its origin, so
// a Zuni or Hydra pod rendered as a tube with a single stub inside it.
//
// The run is picked by COUNT, not by name: lau_61ca carries two complete sets of 19 (aero_7_ffar_*
// for the Mighty Mouse and hydra_70_m247_* for the Hydra), so the name is only the tiebreak when
// two runs are the same length. Measured over every container in the game: 77 of the 83 that need
// this are resolved, 2 of them by the tiebreak. The 6 left are chaff and flare dispensers claiming
// 16–200 rounds, plus two pods with no tube nodes at all — none of which should be exploded into
// models anyway, and all of which fall back to the old single-store behaviour.
const POD_SKIP_NODE = /_(dmg\d*|phx|cap)(_|$)/;
function podTubeNodes(sk, model, count, childName){
  if (!sk || !(count > 1)) return null;
  const fam = new Map();
  for (const n of sk.keys()) {
    if (!n || n === model || POD_SKIP_NODE.test(n)) continue;
    const m = /^(.*?)_?(\d+)$/.exec(n);
    if (!m || !m[1]) continue;
    let a = fam.get(m[1]);
    if (!a) fam.set(m[1], a = []);
    a.push({ n, i: +m[2] });
  }
  const exact = [...fam].filter(([, v]) => v.length === count);
  if (!exact.length) return null;
  let best = exact[0];
  if (exact.length > 1) {
    const want = new Set(String(childName || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const score = k => k.toLowerCase().split(/[^a-z0-9]+/).filter(t => want.has(t)).length;
    const ranked = exact.map(e => ({ e, s: score(e[0]) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s === ranked[1].s) return null;      // two equally good runs — don't guess
    best = ranked[0].e;
  }
  return best[1].sort((a, b) => a.i - b.i).map(x => x.n);
}
/*==ENDARMSTM==*/
