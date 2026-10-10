// Radial symmetry: N copies of a stroke turned about an axis (ROADMAP 4.44, eighth candidate).
//
// WHY THIS EXISTS. A turn about a line has exact answers everywhere, and none of them are visible
// in a field of paint: N turns of 2π/N come home, a point on the axis does not move, every copy
// keeps its distance from the line and its place along it, and the copies are evenly spaced. If any
// of those is wrong the ring of dabs merely looks a little off, which is the kind of wrong that
// ships. So both halves are held:
//
//   Node, on the pure `/*==RADIAL==*/` section:
//   * the turn: identity at k = 0, home after n, a point on the axis fixed, the radius and the
//     offset along the axis preserved, n copies evenly spaced and distinct, a direction's length
//     and its angle to the axis preserved;
//   * the axis: x / y / z are the model's own, "auto" is the picked normal normalised, and a pick
//     with no normal (or an unknown name) answers null rather than guessing;
//   * the ray: a ray that hits P at parameter t turns into one that hits the turned P at the SAME
//     t — which is what makes a copy a real hit rather than a point guessed from the first;
//   * mirror and turn COMMUTE when the mirror's normal is the axis (the bogie case: the ring on the
//     left wheel and the ring on the right one are in the same angular place) and do not when it
//     is not — the second half is there so the first cannot pass by accident;
//   * the sub-step budget divides by the copy count, so eight copies are not eight times the rays.
//
//   Headless Chrome, on the real page, against three.js's own raycaster:
//   * `radialHit(k)` on a real mesh returns the k-th turn of the first hit — the same radius about
//     the axis, the same place along it, the angles evenly spaced — and its UV differs from the
//     first's, which is what makes it a second stamp rather than the same one twice;
//   * `radialCount()` is 1 until a centre is picked, whatever the count says, and a pick sets the
//     centre and (on "auto") the axis from the hit's own normal;
//   * the axis gizmo is placed on the line, and the count survives a prefs round trip.
//
// Usage: node tools/t75_radial.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Radial } = new Function(sectionOf("RADIAL").replace(/^"use strict";$/m, "") + "\nreturn { Radial };")();

const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- the axis ----
{
  R.is(JSON.stringify(Radial.dirOf("z", null)) === "[0,0,1]" && JSON.stringify(Radial.dirOf("x", [9, 9, 9])) === "[1,0,0]",
    "a named axis is the model's own, whatever the pick's normal was");
  const au = Radial.dirOf("auto", [0, 3, 4]);
  R.is(near(au[1], .6) && near(au[2], .8), `"auto" is the picked normal, normalised (${au})`);
  R.is(Radial.dirOf("auto", null) === null && Radial.dirOf("auto", [0, 0, 0]) === null && Radial.dirOf("w", [1, 0, 0]) === null,
    "a pick with no usable normal, or a name that is not an axis, answers null rather than guessing");
  R.is(near(Radial.step(6, 1), Math.PI / 3) && near(Radial.step(6, 3), Math.PI) && Radial.step(1, 0) === 0,
    "the turn for copy k of n is k · 2π/n");
}
// ---- the turn ----
{
  const c = [1, -2, .5], axis = Radial.unit([0, 0, 1]);
  const p = [3, 1, 2];
  R.is(dist(Radial.rotate(p, c, axis, 0), p) < 1e-12, "copy 0 is the stroke itself");
  let q = p;
  for (let k = 0; k < 6; k++) q = Radial.rotate(q, c, axis, Radial.step(6, 1));
  R.is(dist(q, p) < 1e-9, `six turns of 60° come home (${dist(q, p).toExponential(1)} out)`);
  const on = [c[0], c[1], c[2] + 4];
  R.is(dist(Radial.rotate(on, c, axis, 1.234), on) < 1e-12, "a point on the axis does not move");
  const a0 = Radial.about(p, c, axis);
  let worst = 0, angs = [];
  for (let k = 1; k < 8; k++) {
    const r = Radial.rotate(p, c, axis, Radial.step(8, k)), ab = Radial.about(r, c, axis);
    worst = Math.max(worst, Math.abs(ab.r - a0.r), Math.abs(ab.along - a0.along));
    angs.push(Math.atan2(r[1] - c[1], r[0] - c[0]));
  }
  R.is(worst < 1e-9, `every copy keeps its distance from the line and its place along it (worst ${worst.toExponential(1)})`);
  angs.unshift(Math.atan2(p[1] - c[1], p[0] - c[0]));
  let gapWorst = 0;
  for (let k = 1; k < angs.length; k++) {
    let g = angs[k] - angs[k - 1];
    while (g < 0) g += 2 * Math.PI;
    gapWorst = Math.max(gapWorst, Math.abs(g - Math.PI / 4));
  }
  R.is(gapWorst < 1e-9, `eight copies are evenly spaced round the line (worst gap error ${gapWorst.toExponential(1)})`);
  let closest = Infinity;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++)
    closest = Math.min(closest, dist(Radial.rotate(p, c, axis, Radial.step(8, i)), Radial.rotate(p, c, axis, Radial.step(8, j))));
  R.is(closest > .1, `…and distinct (the two nearest are ${closest.toFixed(3)} apart)`);
  // an axis that is not a basis vector
  const ax2 = Radial.unit([1, 1, 0]);
  const b0 = Radial.about([2, 0, 3], [0, 0, 0], ax2);
  const r2 = Radial.rotate([2, 0, 3], [0, 0, 0], ax2, 1.1), b2 = Radial.about(r2, [0, 0, 0], ax2);
  R.is(near(b0.r, b2.r) && near(b0.along, b2.along), "…about a slanted axis too");
  const d = [.3, -.7, .2], rd = Radial.rotateDir(d, axis, .9);
  R.is(near(Radial.len(d), Radial.len(rd)) && near(d[2], rd[2]),
    "a direction keeps its length and its angle to the axis");
}
// ---- the ray ----
{
  const c = [0, 0, 0], axis = [0, 1, 0], ang = Radial.step(5, 2);
  const o = [2, 3, -4], d = Radial.unit([-.4, -.6, .7]);
  const t = 2.75;
  const P = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const r = Radial.ray(o, d, c, axis, ang);
  const Q = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];
  R.is(dist(Q, Radial.rotate(P, c, axis, ang)) < 1e-9,
    "a turned ray hits the turned point at the same distance along it — so a copy is a real hit, not a guess");
}
// ---- mirror and turn ----
{
  const mirror = (p, a, k) => { const q = p.slice(); q[a] = 2 * k - q[a]; return q; };
  const c = [0, .5, 0], p = [1.2, .3, 2.1];
  // the wheel case: the mirror's normal (z) IS the axle, so the two agree
  const axZ = [0, 0, 1], plane = 0;
  const A = mirror(Radial.rotate(p, c, axZ, Radial.step(6, 1)), 2, plane);
  const B = Radial.rotate(mirror(p, 2, plane), [c[0], c[1], 2 * plane - c[2]], axZ, Radial.step(6, 1));
  R.is(dist(A, B) < 1e-9, "mirror and turn commute when the mirror's normal is the axle — so each wheel's ring is the other's mirror image, bolt for bolt");
  // and a turn about an axis that is not the mirror's normal does not commute — so the check above
  // is measuring something
  const axY = [0, 1, 0];
  const C = mirror(Radial.rotate(p, c, axY, .7), 2, plane);
  const D = Radial.rotate(mirror(p, 2, plane), c, axY, .7);
  R.is(dist(C, D) > .1, `…and they do not when it is not (${dist(C, D).toFixed(3)} apart)`);
}
// ---- the budget ----
{
  R.is(Radial.budget(24, 1) === 24 && Radial.budget(24, 8) === 3 && Radial.budget(2, 8) === 1 && Radial.budget(24, 0) === 24,
    "the sub-step budget divides by the copy count and never reaches zero");
}

// ---- the real page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP: no Chrome or Edge found for the page half. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {};
  // a ring of geometry about the y axis at the origin: a 24-sided drum, radius 2, height 2, with a
  // UV that runs u round it — so a turn about y lands on a different u, which is what a second
  // stamp means
  var geo = new THREE.CylinderGeometry(2, 2, 2, 24, 1, true);
  var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.name = "drum"; mesh.userData = { mat: "m" };
  mesh.updateMatrixWorld(true);
  App.meshes = new Map([["drum", mesh]]);
  App.matSlot = new Map([["m", "t75"]]);
  App.selParts = new Set(); App.protectedParts = new Set();
  var s = { id: "t75", size: 64, nSize: 64, layers: [], missing: false, composite: mkCanvas(64, 64) };
  App.slots.set("t75", s);
  var was = App.activeSlot; App.activeSlot = s;
  raycaster = new THREE.Raycaster();
  modelGroup = modelGroup || new THREE.Group();          // radialCount() refuses without a model, as the app should
  // look at the drum from outside, along −x, slightly above the middle
  var aim = function(){ raycaster.set(new THREE.Vector3(8, .3, 0), new THREE.Vector3(-1, 0, 0).normalize()); };
  aim();
  var first = raycaster.intersectObjects([mesh], false)[0];
  out.first = first ? { p: first.point.toArray(), uv: [first.uv.x, first.uv.y] } : null;

  // ---- the count is 1 until a centre is picked ----
  App.radial = { n: 6, axis: "auto", c: null, dir: null };
  out.countNoCentre = radialCount();
  // pick the centre off the hit, the way the armed click does
  setRadialCentre(first);
  out.picked = { c: App.radial.c, dir: App.radial.dir };
  out.count = radialCount();
  // "auto" takes the hit's own normal, which on a drum points out of the surface — not the axle.
  // Naming the axis is what a pick on a curved wall is for, so the rest of the run uses y.
  App.radial.axis = "y"; App.radial.c = [0, 0, 0]; App.radial.dir = Radial.dirOf("y", null);

  // ---- radialHit(k) is the k-th turn of the first hit ----
  var pts = [], uvs = [];
  for (var k = 1; k < 6; k++) {
    aim();
    var h = radialHit(k);
    pts.push(h && h.point ? h.point.toArray() : null);
    uvs.push(h && h.uv ? [h.uv.x, h.uv.y] : null);
  }
  out.pts = pts; out.uvs = uvs;

  // ---- a real stroke lays one ring of dabs, not one dab ----
  // Through the app's own paint3dStrokeTo, because that is where a copy is stamped and because the
  // first thing built here read the copy count above its own declaration: the first stamp of a stroke
  // landed and every move after it threw. Nothing in the suite would have noticed.
  var sheet = mkCanvas(512, 512);
  var s2 = { id: "t75", size: 512, nSize: 512, layers: [], missing: false, composite: sheet, baseC: sheet };
  App.slots.set("t75", s2); App.activeSlot = s2;
  App.matSlot = new Map([["m", "t75"]]);
  var L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(512, 512), visible: true, opacity: 1, blend: "normal" });
  s2.layers = [L]; App.activeLayer = L;
  App.brush.mode = "color"; App.brush.color = "#ff0000"; App.brush.size = 14; App.brush.opacity = 1;
  App.brush.hardness = 1; App.brush.spacing = .35;
  App.radial = { n: 6, axis: "y", c: [0, 0, 0], dir: [0, 1, 0], geom: Bake.vehicleGeom().first };
  // the camera's ray comes from outside the drum, level with the middle; paint3dStrokeTo reads the
  // pointer through ray3d(), so cnv3's rect and the camera have to answer — the ray is set here
  // instead by driving the stroke one move at a time with a stubbed ray3d
  var realRay3d = ray3d, at = 0;
  var aimAt = function(ang){
    var o = new THREE.Vector3(8 * Math.cos(ang), .3, 8 * Math.sin(ang));
    var d = new THREE.Vector3(-Math.cos(ang), 0, -Math.sin(ang));
    raycaster.set(o, d.normalize());
    return raycaster.intersectObjects([mesh], false)[0] || null;
  };
  ray3d = function(){ return aimAt(at); };
  beginStroke(false, true);
  stroke.screen = { x: 100, y: 100 };
  // A move is the brush positions it adds since ROADMAP 4.50 (4) — what Pen.follow hands over.
  for (var i = 0; i < 4; i++) { at = i * .04; paint3dStrokeTo([{ x: 100 + i * 6, y: 100, p: 1 }]); }
  endStroke();
  ray3d = realRay3d;
  // count the separate clusters of paint on the layer: six copies of a stroke that is 4 moves long
  var lc = L.canvas, ld = ctx2d(lc).getImageData(0, 0, lc.width, lc.height).data;
  var S = 16, GW = lc.width / S | 0, GH = lc.height / S | 0, cells = new Set();
  for (var yy = 0; yy < lc.height; yy++) for (var xx = 0; xx < lc.width; xx++)
    if (ld[(yy * lc.width + xx) * 4 + 3] > 8) cells.add(((yy / S) | 0) * GW + ((xx / S) | 0));
  var seen = new Set(), groups = 0;
  cells.forEach(function(c0){
    if (seen.has(c0)) return;
    groups++;
    var q = [c0]; seen.add(c0);
    while (q.length) {
      var cc = q.pop(), cx = cc % GW, cy = (cc / GW) | 0;
      [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]].forEach(function(d){
        var nx = cx + d[0], ny = cy + d[1], n = ny * GW + nx;
        if (nx >= 0 && nx < GW && ny >= 0 && ny < GH && cells.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      });
    }
  });
  out.stroke = { groups: groups, cells: cells.size };
  // …and with radial off the same stroke lays one
  ctx2d(L.canvas).clearRect(0, 0, 512, 512);
  App.radial.n = 1;
  ray3d = function(){ return aimAt(at); };
  beginStroke(false, true);
  stroke.screen = { x: 100, y: 100 };
  for (var j = 0; j < 4; j++) { at = j * .04; paint3dStrokeTo([{ x: 100 + j * 6, y: 100, p: 1 }]); }
  endStroke();
  ray3d = realRay3d;
  var ld2 = ctx2d(L.canvas).getImageData(0, 0, 512, 512).data;
  var cells2 = new Set();
  for (var y2 = 0; y2 < 512; y2++) for (var x2 = 0; x2 < 512; x2++)
    if (ld2[(y2 * 512 + x2) * 4 + 3] > 8) cells2.add(((y2 / S) | 0) * GW + ((x2 / S) | 0));
  var seen2 = new Set(), groups2 = 0;
  cells2.forEach(function(c0){
    if (seen2.has(c0)) return;
    groups2++;
    var q = [c0]; seen2.add(c0);
    while (q.length) {
      var cc = q.pop(), cx = cc % GW, cy = (cc / GW) | 0;
      [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]].forEach(function(d){
        var nx = cx + d[0], ny = cy + d[1], n = ny * GW + nx;
        if (nx >= 0 && nx < GW && ny >= 0 && ny < GH && cells2.has(n) && !seen2.has(n)) { seen2.add(n); q.push(n); }
      });
    }
  });
  out.strokeOff = { groups: groups2, cells: cells2.size };
  App.radial = { n: 6, axis: "y", c: [0, 0, 0], dir: [0, 1, 0], geom: Bake.vehicleGeom().first };
  App.slots.delete("t75"); App.activeLayer = null;

  // ---- the gizmo sits on the line ----
  showRadialAxis(true);
  out.gizmo = radialAxisMesh ? { at: radialAxisMesh.position.toArray(), on: radialAxisMesh.visible } : null;
  hideRadialAxis();

  // ---- prefs ----
  $("radialN").value = 8; $("radialN").dispatchEvent(new Event("input", { bubbles: true }));
  out.prefN = App.radial.n;
  out.prefLabel = $("radialNVal").textContent;
  App.radial = { n: 1, axis: "auto", c: null, dir: null };
  App.activeSlot = was; App.slots.delete("t75");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\\n" + r.__threw); process.exit(1); }

R.is(r.first && Math.abs(Math.hypot(r.first.p[0], r.first.p[2]) - 2) < 1e-6, "the drum is where the test aimed");
R.is(r.countNoCentre === 1, "the count is 1 until a centre is picked, whatever the setting says");
R.is(r.picked.c && Math.abs(r.picked.c[0] - r.first.p[0]) < 1e-6, "the armed click sets the centre to the point it hit");
R.is(r.picked.dir && Math.abs(Math.hypot(r.picked.dir[0], r.picked.dir[1], r.picked.dir[2]) - 1) < 1e-6,
  "…and, on auto, the axis from that hit's own surface normal");
R.is(r.count === 6, "with a centre the count is what the setting says");
{
  const ok = r.pts.every(p => p && Math.abs(Math.hypot(p[0], p[2]) - 2) < 1e-4 && Math.abs(p[1] - r.first.p[1]) < 1e-4);
  R.is(ok, "every copy lands on the drum at the first hit's radius and height");
  const ang = p => Math.atan2(p[2], p[0]);
  const all = [r.first.p].concat(r.pts);
  let worst = 0;
  for (let k = 1; k < all.length; k++) {
    let g = ang(all[k]) - ang(all[k - 1]);
    while (g < -Math.PI) g += 2 * Math.PI;
    while (g > Math.PI) g -= 2 * Math.PI;
    worst = Math.max(worst, Math.abs(Math.abs(g) - Math.PI / 3));
  }
  R.is(worst < 1e-3, `…six copies evenly spaced round the axis (worst gap error ${(worst * 180 / Math.PI).toFixed(3)}°)`);
  const us = [r.first.uv[0]].concat(r.uvs.map(u => u && u[0]));
  R.is(us.every(u => u != null) && new Set(us.map(u => u.toFixed(3))).size === 6,
    `…and each is a different place on the sheet (u = ${us.map(u => u == null ? "-" : u.toFixed(3)).join(", ")})`);
}
R.is(r.stroke.groups === 6, `a real stroke through paint3dStrokeTo lays six separate rings of paint on the sheet (${r.stroke.groups} clusters, ${r.stroke.cells} cells)`);
R.is(r.strokeOff.groups === 1 && r.strokeOff.cells > 0, `…and one with radial off (${r.strokeOff.groups})`);
R.is(r.stroke.cells > r.strokeOff.cells * 4, `…so the ring really is more paint, not the same paint relabelled (${r.stroke.cells} cells against ${r.strokeOff.cells})`);
R.is(r.gizmo && r.gizmo.on && Math.hypot(r.gizmo.at[0], r.gizmo.at[1], r.gizmo.at[2]) < 1e-6, "the axis gizmo is drawn on the line");
R.is(r.prefN === 8 && r.prefLabel === "8×", `the count control writes the setting and says so (${r.prefLabel})`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\\n        " + errs.join("\\n        ") : "no uncaught errors during the run");
R.finish();
