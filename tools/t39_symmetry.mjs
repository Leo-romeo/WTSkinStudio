// The mirror plane must be MEASURED, not guessed (ROADMAP 4.6).
//
// It used to be a guess twice over: the plane was the bounding box's centre and the axis was picked
// between x and z by the *skewness* of the vertex distribution, which is not a measure of symmetry
// at all. Measured 2026-08-05 over three real vehicles, the true axis is z on all three and the
// true plane is the model's own origin — and the bounding-box centre was **2.5 m out on the
// Su-30SM2**, scoring 15.1 % symmetric against 82.2 % at the right plane. A mirrored stroke landed
// nowhere near its partner, which is what was reported.
//
// This runs the page's own findSymmetry over synthetic bodies whose answer is known exactly, with
// the Su-30's failure mode built in: an asymmetric boom that drags the bounding box away from the
// real plane. A synthetic body is used rather than a vehicle for the reason t28 and t38 give — the
// property under test belongs to the estimator, not to any model — and it means this needs no
// install and no browser.
//
// Usage: node tools/t39_symmetry.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const chunk = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b < a) throw new Error("not where this test expects it: " + from);
  const s = src.slice(a, b);
  // A lift that spans two <script> tags comes back with the markup between them, and the failure
  // is an unhelpful `SyntaxError: Unexpected token '<'`. That is what the module split (ROADMAP
  // 2.2) turned this test's old end sentinel — `function buildScene`, now a different module —
  // into, so say which lift crossed a boundary rather than making the next person find out.
  if (s.includes("</script>")) throw new Error(`the lift from "${from}" to "${to}" spans two <script> tags`);
  return s;
};
// Both estimators come out of marked sections rather than out of "everything up to the next
// function", so moving a module cannot silently change what this test runs.
const section = name => chunk("/*==" + name + "==*/", "/*==END" + name + "==*/");
const App = { geomData: null };
const findSymmetry = new Function("App",
  chunk("const SIDE_TOK", "const SUB_MIN") + "\n" +           // partSegments: the side tokens
  section("SYMMETRY") + "\nreturn findSymmetry;")(App);

let seed = 0x1d3f77;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// A body symmetric about `plane` on `axis`, plus an optional one-sided boom that pulls the
// bounding box off it. Points are jittered so nothing lines up with the voxel grid by luck.
function body({ axis = "z", plane = 0, n = 40000, boom = 0 }) {
  const pos = [];
  const put = (x, y, z) => pos.push(x, y, z);
  for (let i = 0; i < n; i++) {
    const along = (rnd() - 0.5) * 12;                       // fuselage direction
    const up = (rnd() - 0.5) * 3;
    const out = rnd() * 3 + 0.2;                            // distance from the plane, both sides
    for (const sgn of [1, -1]) {
      const d = plane + sgn * out;
      if (axis === "z") put(along, up, d);
      else if (axis === "x") put(d, up, along);
      else put(along, d, out * 0.3 + along * 0.01);
    }
  }
  // the asymmetric part: a boom on ONE side only, which is what moves the bounding-box centre
  for (let i = 0; i < boom; i++) {
    const along = (rnd() - 0.5) * 2;
    const d = plane + 3 + rnd() * 6;
    if (axis === "z") put(along, rnd() * 0.4, d);
    else if (axis === "x") put(d, rnd() * 0.4, along);
    else put(along, d, rnd() * 0.4);
  }
  return [{ name: "b", mat: "m", position: Float32Array.from(pos) }];
}

// The other estimator: parts that NAME their side. `n` twin pairs straddling `plane` on `axis`,
// each a small blob, plus a fuselage that names no side and a one-sided boom — so the bounding box
// is wrong and only the pairing can be right.
function namedParts({ axis = "z", plane = 0, n = 8, boom = true, sepScale = 1, stray = 0 }) {
  const out = [];
  const blob = (name, cx, cy, cz) => {
    const pos = [];
    for (let i = 0; i < 400; i++) pos.push(cx + (rnd() - .5) * .3, cy + (rnd() - .5) * .3, cz + (rnd() - .5) * .3);
    out.push({ name, mat: "m", position: Float32Array.from(pos) });
  };
  const k = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  // A real twin is the SAME mesh reflected, not an independently random one — two independent
  // point clouds would differ by their own sampling noise and this would be testing that instead.
  const twin = (base, along, off, mid) => {
    const shape = [];
    for (let i = 0; i < 400; i++) shape.push([(rnd() - .5) * .3, (rnd() - .5) * .3, (rnd() - .5) * .3]);
    for (const side of ["l", "r"]) {
      const c = [0, 0.2, 0];
      c[k] = mid + (side === "l" ? -off : off);
      c[k === 0 ? 2 : 0] = along;                                // lay them out along another axis
      const pos = [];
      for (const d of shape) {
        const p = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
        if (side === "r") p[k] = c[k] - d[k];                    // the same mesh, reflected
        pos.push(p[0], p[1], p[2]);
      }
      out.push({ name: base + "_" + side, mat: "m", position: Float32Array.from(pos) });
    }
  };
  for (let i = 0; i < n; i++) twin(`wing${i}`, -5 + i * 1.2, (1 + i * 0.4) * sepScale, plane);
  // a pair whose midpoint is nowhere near the plane: the median must ignore it, a mean would not
  for (let i = 0; i < stray; i++) twin(`stray${i}`, 0, 1, plane + 9);
  for (let i = 0; i < 6; i++) blob("fuselage" + i, -5 + i * 2, 0, plane);
  if (boom) for (let i = 0; i < 8; i++) {
    const d = plane + 4 + i;
    if (axis === "z") blob("boom" + i, 0, 0, d);
    else if (axis === "x") blob("boom" + i, d, 0, 0);
    else blob("boom" + i, 0, d, 0);
  }
  return out;
}

function run(geom) {
  App.geomData = geom;
  App._symGeom = null;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of geom) for (let i = 0; i < g.position.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = g.position[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const c = { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 };
  const s = { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] };
  const t = Date.now();
  findSymmetry(c, s);
  return { c, s, ms: Date.now() - t, axis: App.autoAxis, plane: App.mirrorCenters[App.autoAxis],
    score: App.symScore, scores: App.symScores, centres: App.mirrorCenters,
    from: App.symFrom, pairs: App.symPairs };
}

let checks = 0, fails = 0;
const is = (ok, m) => { checks++; if (!ok) fails++; console.log((ok ? "  ok   " : "  FAIL ") + m); };

// ---- 0. named part pairs: exact, and it names the axis for free ----
// Measured on real vehicles 2026-08-05: the median midpoint on z is −0.0000 (F-111A, 28 pairs),
// 0.0004 (Su-30SM2, 60) and −0.0000 (M1A2, 55), against a bounding-box centre 2.5 m out on the
// Su-30SM2. Twins are 6.003 m apart on z and 0.015 m apart on x, which is what identifies the axis.
for (const axis of ["z", "x", "y"]) {
  const P = 0.35;
  const r = run(namedParts({ axis, plane: P }));
  is(r.from === "pairs", `${axis}: the plane came from the part names, not the shape (from "${r.from}", ${r.pairs} pairs)`);
  is(r.axis === axis, `${axis}: the axis is the one the twins are far apart on (got "${r.axis}")`);
  is(Math.abs(r.plane - P) < 1e-6,
    Math.abs(r.plane - P) < 1e-6 ? `${axis}: plane is exactly ${r.plane.toFixed(6)} — a midpoint, not an estimate`
      : `${axis}: plane ${r.plane} should be ${P}`);
  is(Math.abs(r.c[axis] - P) > 0.5, `${axis}: and the bounding-box centre it replaces is ${r.c[axis].toFixed(2)}, well off it`);
}

// ---- 0b. the median has to survive a pair that does not belong ----
{
  const P = 0.35;
  const r = run(namedParts({ axis: "z", plane: P, n: 8, stray: 2 }));
  is(r.from === "pairs" && Math.abs(r.plane - P) < 1e-6,
    Math.abs(r.plane - P) < 1e-6
      ? `two pairs 9 units off the plane do not move it (${r.plane.toFixed(6)}) — the median ignores them, a mean would not`
      : `stray pairs pulled the plane to ${r.plane}`);
  is(r.score < 1, `and they are reported as disagreeing rather than hidden (${(r.score * 100).toFixed(0)}% of pairs agree)`);
}

// ---- 0c. refuse rather than guess ----
{
  // twins that coincide are not a mirror at all
  const r1 = run(namedParts({ axis: "z", plane: 0.35, sepScale: 0.0005 }));
  is(r1.from === "shape", `twins sitting on top of each other are refused, not believed (fell back to "${r1.from}")`);
  // too few pairs to trust
  const r2 = run(namedParts({ axis: "z", plane: 0.35, n: 2 }));
  is(r2.from === "shape", `two pairs is not enough to name a plane (fell back to "${r2.from}")`);
}

// ---- 1. no side-tagged names at all: the shape scan is the fallback ----
for (const axis of ["z", "x"]) {
  const P = axis === "z" ? 0.7 : -1.3;
  const r = run(body({ axis, plane: P }));
  const cell = Math.max(r.s.x, r.s.y, r.s.z) / 64;
  is(r.axis === axis, `${axis}-symmetric body: axis found as "${r.axis}" (expected "${axis}")`);
  is(Math.abs(r.plane - P) <= cell, `${axis}: plane ${r.plane.toFixed(3)} within one voxel (${cell.toFixed(3)}) of the true ${P}`);
  is(r.score > 0.9, `${axis}: ${(r.score * 100).toFixed(1)}% of the body overlaps its own reflection there`);
}

// ---- 2. the Su-30SM2 failure: an asymmetric boom drags the bounding box off the plane ----
{
  const P = 0.5;
  const r = run(body({ axis: "z", plane: P, boom: 12000 }));
  const cell = Math.max(r.s.x, r.s.y, r.s.z) / 64;
  const off = Math.abs(r.c.z - P);
  is(off > 5 * cell, `the boom really does move the bounding-box centre off the plane: ${r.c.z.toFixed(3)} vs ${P} (${off.toFixed(2)} units, ${(off / cell).toFixed(0)} voxels)`);
  is(r.axis === "z", `the axis is still found as z (got "${r.axis}")`);
  is(Math.abs(r.plane - P) <= cell,
    Math.abs(r.plane - P) <= cell
      ? `and the plane is still ${r.plane.toFixed(3)}, not the box centre — this is the case that was 2.5 m out on the Su-30SM2`
      : `the plane came out at ${r.plane.toFixed(3)}, expected ${P}`);
  is(r.scores.z > r.scores.x && r.scores.z > r.scores.y,
    `the real axis scores highest: z ${(r.scores.z * 100).toFixed(0)}% vs x ${(r.scores.x * 100).toFixed(0)}% and y ${(r.scores.y * 100).toFixed(0)}%`);
}

// ---- 3. every axis gets its own measured plane, not the box centre ----
{
  const r = run(body({ axis: "z", plane: 0.5, boom: 12000 }));
  is(["x", "y", "z"].every(k => typeof r.centres[k] === "number" && isFinite(r.centres[k])),
    "all three axes carry a finite measured plane, so picking one by hand is not the bounding box");
  is(r.scores.x != null && r.scores.y != null,
    `and a score each, which is what says an axis is meaningless rather than silently mirroring into space (x ${(r.scores.x * 100).toFixed(0)}%, y ${(r.scores.y * 100).toFixed(0)}%)`);
}

// ---- 4. it is cached on the geometry: buildScene reruns on every texture that arrives ----
{
  const geom = body({ axis: "z", plane: 0.5 });
  const r1 = run(geom);
  const before = App.mirrorCenters;
  const t = Date.now();
  findSymmetry(r1.c, r1.s);                       // same App.geomData — must be a no-op
  const again = Date.now() - t;
  is(App.mirrorCenters === before && again < 5,
    `a second call on the same geometry is a no-op (${again} ms) — buildScene runs again for every texture that finishes decoding`);
  is(r1.ms < 400, `a ${(geom[0].position.length / 3).toLocaleString()}-vertex body measures in ${r1.ms} ms`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
