// Mask generators from the model: curvature and occlusion (ROADMAP 4.44, first candidate).
//
// WHY THIS EXISTS. A mask baked from the mesh has no oracle in the app: the user sees a field of
// grey and either believes it or does not. So the properties a mask author relies on are held here
// against shapes whose answer is exact, in two halves —
//
//   Node, on the pure `/*==BAKE==*/` section (the half the bake pool lifts into a worker):
//   * a sphere of radius R reads 1/R at every vertex, inside out it reads −1/R (the sign convention:
//     convex positive), and a flat plane reads exactly 0;
//   * a box's creases register at all — its faces are flat, so this is only true because the
//     merged normal is used at the rim — and register CONVEX, with the interior of each face at 0;
//   * welding: split copies of a vertex merge, and a position 1 mm away does not;
//   * the normal map's divergence is positive on a bump, negative in a groove, matching the mesh's
//     sign so the two can be summed;
//   * the 64 directions are unit vectors with orthonormal frames — the JS side of a formula the
//     shader repeats.
//
//   Headless Chrome, on the real page (the GPU half, `Bake`):
//   * a ridge bakes as a bright line down its sheet band, a valley as a dark one, and a flat plate
//     as 128 to the byte — through the worker, the attribute upload, the rasteriser and the readback;
//   * a floor under a roof bakes darker than the same floor in the open, and the roof's top — with
//     nothing above it — bakes as fully lit; hiding the roof lets the floor under it go bright,
//     which is what proves the darkness was occlusion and not the bias;
//   * the graded mask is cut to the UV islands: alpha 0 in the gutters, and the padded value keeps
//     the outermost row of an island from fading.
//
// Usage: node tools/t66_bake.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { BakeMesh } = new Function(sectionOf("BAKE").replace(/^"use strict";$/m, "") + "\nreturn { BakeMesh };")();

// ---- shapes ----
// A triangle soup the way App.geomData holds one: three flat arrays, three copies per triangle.
function soup(tris){
  const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9);
  let k = 0;
  for (const t of tris) for (const [p, n] of t) { pos.set(p, k); nrm.set(n, k); k += 3; }
  return { pos, nrm };
}
// A UV sphere of radius R, smooth normals (p/R). Inside-out when `inv`: normals and winding flipped.
function sphere(Rr, seg, inv){
  const tris = [];
  const P = (i, j) => {
    const th = Math.PI * i / seg, ph = 2 * Math.PI * j / seg;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return [[n[0] * Rr, n[1] * Rr, n[2] * Rr], inv ? n.map(x => -x) : n];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    tris.push(inv ? [a, c, b] : [a, b, c]);
    tris.push(inv ? [a, d, c] : [a, c, d]);
  }
  return soup(tris);
}
// A flat N×N grid in the y=0 plane, normal +y.
function plane(N, size){
  const tris = [], n = [0, 1, 0];
  const P = (i, j) => [[(i / N - .5) * size, 0, (j / N - .5) * size], n];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    tris.push([P(i, j), P(i + 1, j), P(i + 1, j + 1)]);
    tris.push([P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
  }
  return soup(tris);
}
// A unit box, each face an N×N grid with that face's flat normal. `tag` marks every vertex copy
// as rim, next-to-rim or interior of its face, so the test can tell the crease from the flat.
function box(N){
  const tris = [], tag = [];
  const faces = [
    { n: [0, 0, 1],  f: (u, v) => [u, v, .5] }, { n: [0, 0, -1], f: (u, v) => [v, u, -.5] },
    { n: [1, 0, 0],  f: (u, v) => [.5, u, v] }, { n: [-1, 0, 0], f: (u, v) => [-.5, v, u] },
    { n: [0, 1, 0],  f: (u, v) => [v, .5, u] }, { n: [0, -1, 0], f: (u, v) => [u, -.5, v] },
  ];
  faces.forEach((F, fi) => {
    const P = (i, j) => [F.f(i / N - .5, j / N - .5), F.n];
    const rim = (i, j) => i === 0 || j === 0 || i === N || j === N;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      tris.push([P(i, j), P(i + 1, j), P(i + 1, j + 1)]);
      tris.push([P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
      for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]])
        tag.push({ face: fi, rim: rim(a, b), nearRim: !rim(a, b) && (a === 1 || b === 1 || a === N - 1 || b === N - 1) });
    }
  });
  return { ...soup(tris), tag };
}
const stats = arr => {
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  return { lo, hi, mean: sum / arr.length };
};

// ---- 1. the sphere, both ways round, and the plane ----
{
  const Rr = 2.5, s = sphere(Rr, 24, false);
  const k = BakeMesh.curvature(s.pos, s.nrm, 0);
  // the poles are degenerate (every top-row triangle shares a vertex there); read the body
  const body = [];
  for (let i = 0; i < k.length; i++) if (Math.abs(s.pos[i*3+1]) < Rr * .9) body.push(k[i]);
  const st = stats(body);
  R.is(Math.abs(st.mean * Rr - 1) < .02 && st.lo * Rr > .9 && st.hi * Rr < 1.1,
    `a sphere of radius ${Rr} reads 1/R everywhere: mean ${(st.mean * Rr).toFixed(4)}·(1/R), range ${(st.lo * Rr).toFixed(3)}–${(st.hi * Rr).toFixed(3)}`);
  const inv = sphere(Rr, 24, true);
  const ki = BakeMesh.curvature(inv.pos, inv.nrm, 0);
  const bi = [];
  for (let i = 0; i < ki.length; i++) if (Math.abs(inv.pos[i*3+1]) < Rr * .9) bi.push(ki[i]);
  const si = stats(bi);
  R.is(Math.abs(si.mean * Rr + 1) < .02 && si.hi * Rr < -.9,
    `inside out it reads −1/R: mean ${(si.mean * Rr).toFixed(4)}·(1/R) — concave is negative`);
  const p = plane(8, 4);
  const kp = BakeMesh.curvature(p.pos, p.nrm, 0);
  R.is(stats(kp).lo === 0 && stats(kp).hi === 0, "a flat plane reads exactly 0 at every vertex");
}
// ---- 2. the box: creases register, and register convex ----
{
  const N = 6, b = box(N);
  const k = BakeMesh.curvature(b.pos, b.nrm, 0);
  const rim = [], inner = [], near = [];
  for (let i = 0; i < k.length; i++) (b.tag[i].rim ? rim : b.tag[i].nearRim ? near : inner).push(k[i]);
  const sr = stats(rim), si = stats(inner), sn = stats(near);
  R.is(sr.lo > 0, `every vertex on a box's creases reads convex: rim min ${sr.lo.toFixed(3)}, mean ${sr.mean.toFixed(3)} (1/edge ≈ ${N})`);
  R.is(si.lo === 0 && si.hi === 0, `the interior of each face reads 0 (${inner.length} copies)`);
  R.is(sn.lo > 0 && sn.hi < sr.mean, `the ring next to a crease carries its falloff: ${sn.lo.toFixed(3)}–${sn.hi.toFixed(3)}, below the rim's ${sr.mean.toFixed(3)}`);
  // welding: the box's 6 × 7 × 7 = 294 grid points collapse to 294 − 12·7 (each edge counted twice) + 8 (corners, thrice) = 218
  const w = BakeMesh.weld(b.pos, BakeMesh.QUANT);
  R.is(w.count === 6 * (N + 1) * (N + 1) - 12 * (N + 1) + 8,
    `${k.length} copies weld to ${w.count} positions (expected ${6 * (N + 1) * (N + 1) - 12 * (N + 1) + 8})`);
  const pos2 = new Float32Array([0, 0, 0, 0, 0, 0.001, 0, 0, 0.00001]);
  const w2 = BakeMesh.weld(pos2, BakeMesh.QUANT);
  R.is(w2.count === 2 && w2.mid[0] === w2.mid[2] && w2.mid[1] !== w2.mid[0], "a copy 10 µm away welds, one 1 mm away does not");
}
// ---- 3. the normal map's divergence: bump positive, groove negative ----
{
  const w = 33, h = 33, nx = new Float32Array(w * h), ny = new Float32Array(w * h);
  // a gaussian bump: n = (−∂h/∂x, −∂h/∂y), the emboss's own convention, as bytes about 128
  const hgt = (x, y) => 40 * Math.exp(-((x - 16) ** 2 + (y - 16) ** 2) / 18);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    nx[y * w + x] = 128 - (hgt(x + 1, y) - hgt(x - 1, y)) / 2 * 6;
    ny[y * w + x] = 128 - (hgt(x, y + 1) - hgt(x, y - 1)) / 2 * 6;
  }
  const d = BakeMesh.detail(nx, ny, w, h);
  const centre = d[16 * w + 16], foot = d[16 * w + 10], far = d[2 * w + 2];
  R.is(centre > 0 && foot < 0 && far === 0,
    `a bump's crown is convex (${centre.toFixed(1)}), its foot concave (${foot.toFixed(1)}), the flat 0 — the same sign as the mesh`);
  // the scale: 95 % of non-trivial magnitudes fall at or under it
  const s = BakeMesh.scaleOf(d, 3);
  let under = 0, n = 0;
  for (const v of d) if (Math.abs(v) > 3) { n++; if (Math.abs(v) <= s) under++; }
  R.is(under / n >= .93 && under / n <= 1, `scaleOf puts ${(under / n * 100).toFixed(0)}% of the non-trivial values at or under 1`);
}
// ---- 4. the directions and their frames ----
{
  let bad = 0;
  for (let i = 0; i < BakeMesh.N_DIRS; i++) {
    const d = BakeMesh.dir(i, BakeMesh.N_DIRS), { t1, t2 } = BakeMesh.frame(d);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (Math.abs(dot(d, d) - 1) > 1e-6 || Math.abs(dot(t1, t1) - 1) > 1e-6 || Math.abs(dot(t2, t2) - 1) > 1e-6) bad++;
    if (Math.abs(dot(d, t1)) > 1e-6 || Math.abs(dot(d, t2)) > 1e-6 || Math.abs(dot(t1, t2)) > 1e-6) bad++;
  }
  // and they cover both hemispheres: the mean z of the set is 0
  let mz = 0;
  for (let i = 0; i < BakeMesh.N_DIRS; i++) mz += BakeMesh.dir(i, BakeMesh.N_DIRS)[2];
  R.is(bad === 0 && Math.abs(mz) < 1e-9, `${BakeMesh.N_DIRS} unit directions with orthonormal frames, balanced over the sphere`);
}

// ---- the GPU half, in the real page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP (browser half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {};
  var SH = 256, BANDS = 4;
  // One quad (2 triangles), flat normal, on vertical band \`band\` of the sheet (t38's helper).
  function quad(name, corners, nrm, band){
    var idx = [0, 1, 2, 0, 2, 3];
    var uvc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2];
      nor[k*3] = nrm[0]; nor[k*3+1] = nrm[1]; nor[k*3+2] = nrm[2];
      uv[k*2] = (band + t[0] * .8 + .1) / BANDS;      // a gutter either side of every band
      uv[k*2+1] = t[1] * .8 + .1;
    }
    return { name: name, mat: "testmat", position: pos, normal: nor, uv: uv };
  }
  // A slope of N quads along x on one half of a band, so the crease's falloff — one edge wide by
  // construction — is a fraction of the band rather than all of it. Corners run from the crease
  // (x = 0) outward to x = ±1.
  function slope(name, dir, yCrease, nrm, band, half, N){
    var pos = [], nor = [], uv = [];
    for (var i = 0; i < N; i++) {
      var xa = dir * i / N, xb = dir * (i + 1) / N;
      var ya = yCrease * (1 - i / N), yb = yCrease * (1 - (i + 1) / N);
      var c = [[xa, ya, -1], [xb, yb, -1], [xb, yb, 1], [xa, ya, 1]];
      var ua = half + (dir > 0 ? i / N : 1 - i / N) * .5, ub = half + (dir > 0 ? (i + 1) / N : 1 - (i + 1) / N) * .5;
      var t = [[ua, 0], [ub, 0], [ub, 1], [ua, 1]];
      var idx = [0, 1, 2, 0, 2, 3];
      for (var k = 0; k < 6; k++) {
        pos.push(c[idx[k]][0], c[idx[k]][1], c[idx[k]][2]);
        nor.push(nrm[0], nrm[1], nrm[2]);
        uv.push((band + .1 + t[idx[k]][0] * .8) / BANDS, t[idx[k]][1] * .8 + .1);
      }
    }
    return { name: name, mat: "testmat", position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uv) };
  }
  var s = Math.SQRT1_2, NS = 8;
  // band 0: a ridge — two slopes meeting at x = 0, y = .5, normals tilted apart (convex); the
  // crease is the band's centre column, the feet its edges
  var ridgeL = slope("ridgeL", -1, .5, [-s, s, 0], 0, 0, NS);
  var ridgeR = slope("ridgeR",  1, .5, [ s, s, 0], 0, .5, NS);
  // band 1: a valley — meeting at y = −.5, normals tilted together (concave)
  var valL = slope("valL", -1, -.5, [ s, s, 0], 1, 0, NS);
  var valR = slope("valR",  1, -.5, [-s, s, 0], 1, .5, NS);
  // band 2: a flat floor, y = 0, x from −2 to 1; band 3: a roof over its right third, .3 above
  var floor = quad("floor", [[-2,0,-1],[1,0,-1],[1,0,1],[-2,0,1]], [0, 1, 0], 2);
  var roof  = quad("roof",  [[0,.3,-1],[1,.3,-1],[1,.3,1],[0,.3,1]], [0, 1, 0], 3);
  var all = [ridgeL, ridgeR, valL, valR, floor, roof];
  var meshes = new Map();
  all.forEach(function(g){ meshes.set(g.name, { visible: true }); });
  // the ridge and valley are far away in x so they cannot shadow the floor
  [ridgeL, ridgeR].forEach(function(g){ for (var k = 0; k < g.position.length; k += 3) g.position[k] += 10; });
  [valL, valR].forEach(function(g){ for (var k = 0; k < g.position.length; k += 3) g.position[k] -= 10; });
  App.geomData = all;
  App.meshes = meshes;
  App.matSlot = new Map([["testmat", "slotA"]]);
  App.protectedParts = new Set();
  App.selParts = new Set();
  App._projGL = null;
  var sheet = document.createElement("canvas"); sheet.width = sheet.height = SH;
  var slot = { id: "slotA", composite: sheet, normal: null };
  if (!projGL()) return { mode: "none" };
  out.mode = "gl";

  // Read a band's interior as a column profile: for each column x in the band, the mean value
  // down the band's covered rows. That is what a ridge (a line along the sheet's v) shows up as.
  function profile(b, band){
    var x0 = Math.round((band + .1) * SH / BANDS) + 2, x1 = Math.round((band + .9) * SH / BANDS) - 2;
    var y0 = Math.round(.1 * SH) + 2, y1 = Math.round(.9 * SH) - 2;
    var cols = [];
    for (var x = x0; x < x1; x++) { var sum = 0, n = 0; for (var y = y0; y < y1; y++) { sum += b.data[y * b.w + x]; n++; } cols.push(sum / n); }
    return cols;
  }
  function mm(a){ var lo = Infinity, hi = -Infinity, sum = 0; a.forEach(function(v){ if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }); return { lo: lo, hi: hi, mean: sum / a.length }; }

  // ---- curvature ----
  var cb = await Bake.curvature(slot);
  out.curvSize = [cb.w, cb.h];
  out.ridge = mm(profile(cb, 0)); out.valley = mm(profile(cb, 1)); out.flat = mm(profile(cb, 2));
  // where in the band the extreme sits: the ridge is at the band's centre column
  var pr = profile(cb, 0), best = 0; for (var i = 0; i < pr.length; i++) if (pr[i] > pr[best]) best = i;
  out.ridgeAt = best / pr.length;
  var pv = profile(cb, 1), worst = 0; for (var i = 0; i < pv.length; i++) if (pv[i] < pv[worst]) worst = i;
  out.valleyAt = worst / pv.length;
  // coverage: the gutter between bands is uncovered, the band's interior covered
  out.gutterCov = cb.cov[Math.round(.5 * SH) * cb.w + Math.round((1.0) * SH / BANDS)];
  out.bandCov = cb.cov[Math.round(.5 * SH) * cb.w + Math.round((2.5) * SH / BANDS)];
  // the padded value reaches into the gutter next to the flat band: 128 there too
  out.padVal = cb.data[Math.round(.5 * SH) * cb.w + Math.round((2.1) * SH / BANDS) - 4];

  // ---- occlusion ----
  var ab = await Bake.occlusion(slot);
  var fp = profile(ab, 2);
  // the floor runs x = −2…1 across its band; the roof covers x = 0…1, the rightmost third
  var open = fp.slice(0, Math.floor(fp.length * .25)), under = fp.slice(Math.ceil(fp.length * .75));
  out.floorOpen = mm(open); out.floorUnder = mm(under); out.roofTop = mm(profile(ab, 3));
  // hide the roof: the floor under it must brighten to match the open half
  meshes.get("roof").visible = false;
  var ab2 = await Bake.occlusion(slot);
  var fp2 = profile(ab2, 2);
  out.floorUnder2 = mm(fp2.slice(Math.ceil(fp2.length * .75)));
  out.keyChanged = ab.key !== ab2.key;

  // ---- the graded mask ----
  var mask = Bake.toMask(slot, ab, "occluded", .2, .8, 0);
  var md = mask.getContext("2d").getImageData(0, 0, SH, SH).data;
  out.maskSize = [mask.width, mask.height];
  var gx = Math.round(1.0 * SH / BANDS), gy = Math.round(.5 * SH);
  out.maskGutterA = md[(gy * SH + gx) * 4 + 3];
  var ux = Math.round(2.85 * SH / BANDS);            // x ≈ .8, under the roof
  out.maskUnderA = md[(gy * SH + ux) * 4 + 3];
  var ox = Math.round(2.15 * SH / BANDS);            // x ≈ −1.8, in the open
  out.maskOpenA = md[(gy * SH + ox) * 4 + 3];
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
if (r.mode !== "gl") { R.finish("SKIP (browser half): this browser gave no WebGL context, so the GPU bakes did not run."); }

console.log(`  note  curvature baked at ${r.curvSize.join("×")}`);
R.is(r.ridge.hi > 128 + 40 && r.ridge.lo >= 126 && r.ridge.lo <= 132,
  `a ridge bakes as a bright line: column peak ${r.ridge.hi.toFixed(0)} against a flat of 128, and its feet are flat (band min ${r.ridge.lo.toFixed(0)})`);
R.is(Math.abs(r.ridgeAt - .5) < .08, `…and the line sits at the crease (${(r.ridgeAt * 100).toFixed(0)}% across the band)`);
R.is(r.valley.lo < 128 - 40 && r.valley.hi <= 130 && r.valley.hi >= 126,
  `a valley bakes as a dark line: column trough ${r.valley.lo.toFixed(0)} against flat feet (band max ${r.valley.hi.toFixed(0)}) — concave reads as cavity`);
R.is(Math.abs(r.valleyAt - .5) < .08, `…at the crease (${(r.valleyAt * 100).toFixed(0)}% across)`);
R.is(r.flat.lo >= 127 && r.flat.hi <= 129, `a flat plate bakes as 128 to the byte (${r.flat.lo.toFixed(0)}–${r.flat.hi.toFixed(0)})`);
R.is(r.gutterCov === 0 && r.bandCov === 1, "coverage is 1 on the island and 0 in the gutter");
R.is(r.padVal >= 127 && r.padVal <= 129, `the padded value reaches into the gutter (${r.padVal} next to the flat band)`);

R.is(r.floorOpen.lo > 235, `the far end of the floor, with the roof low on its horizon, is lit (${r.floorOpen.lo.toFixed(0)}–${r.floorOpen.hi.toFixed(0)})`);
R.is(r.floorUnder.mean < r.floorOpen.mean - 60,
  `the end under the roof is darker (mean ${r.floorUnder.mean.toFixed(0)} against ${r.floorOpen.mean.toFixed(0)}) — the roof occludes it`);
R.is(r.roofTop.lo > 235, `the roof's top, with nothing above it, is fully lit (${r.roofTop.lo.toFixed(0)}–${r.roofTop.hi.toFixed(0)}) — a surface does not shadow itself`);
R.is(r.keyChanged && r.floorUnder2.lo > 235,
  r.keyChanged ? `hiding the roof changes the bake's key and the floor under it goes bright (${r.floorUnder2.lo.toFixed(0)}–${r.floorUnder2.hi.toFixed(0)}) — so that darkness was occlusion, not bias`
               : "hiding the roof did not change the bake's key — a stale occlusion bake would be reused");

R.is(r.maskSize[0] === 256 && r.maskSize[1] === 256, "the mask comes out at the sheet's size");
R.is(r.maskGutterA === 0, `the mask is cut to the islands: alpha ${r.maskGutterA} in the gutter`);
R.is(r.maskUnderA > 150 && r.maskOpenA === 0,
  `graded "occluded": under the roof shows (alpha ${r.maskUnderA}), the open floor is hidden (alpha ${r.maskOpenA})`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
