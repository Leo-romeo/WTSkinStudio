// The shape tool on the model, in the 3-D view (ROADMAP 6.1b).
//
// WHY THIS EXISTS. 6.1's path lives in sheet texels, so a shape that crosses a UV seam cannot be drawn
// at all: the two sides of the seam are two islands that may lie anywhere on the sheet. On the model
// it is one shape, and Fill projects it back through the projector projected decals use. What makes
// that right is checkable exactly on a synthetic scene, for the reason t38 gives — these are
// properties of the projector and the tool, not of any vehicle:
//
//   * the sheet is four 128² quadrants at 64 texels a metre. The FRONT plate is two quads meeting at
//     x = 0 whose islands are at OPPOSITE ends of the sheet (the left half on the right quadrant, the
//     right half on the left one), so a square across x = 0 must paint near texel 256 AND near 0 —
//     a UV seam no sheet path could cross;
//   * a plate 3 cm BEHIND the front one, on the same rays and inside the beam's depth reach, must get
//     nothing: that is the projector's depth pre-pass, not the depth limit;
//   * a plate 1 m behind, reaching past the front plate's edge where nothing hides it, must get
//     nothing from a path drawn on the front plate (the depth limit) — and must fill when the path's
//     own nodes are put on it (the limit follows the nodes, it is not a fixed slab).
//
// Driven through the real viewport: synthetic pointer events on the 3-D canvas lay the nodes and close
// the path, the verbs are the panel's own, and every check reads the layer's pixels.
//
// Usage: node tools/t132_path3d.mjs [--keep] [--chrome <path>] [--page <built.html>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const html = argv.includes("--page") ? fs.readFileSync(argv[argv.indexOf("--page") + 1], "utf8") : undefined;

const BODY = `async function(){
  var out = {};
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };
  var V3 = function(x, y, z){ return new THREE.Vector3(x, y, z); };
  var N = 256;
  // One quad per plate: corners CCW from +z, uv (u0, v0) + 0.5 * (0..1) — 2 m onto 128 texels.
  var quad = function(name, x0, x1, z, u0, v0){
    var cs = [[x0, -1], [x1, -1], [x1, 1], [x0, 1]], ts = [[0, 0], [1, 0], [1, 1], [0, 1]], idx = [0, 1, 2, 0, 2, 3];
    var pos = new Float32Array(18), nrm = new Float32Array(18), uv = new Float32Array(12);
    idx.forEach(function(ci, k){ pos[k*3] = cs[ci][0]; pos[k*3+1] = cs[ci][1]; pos[k*3+2] = z; nrm[k*3+2] = 1;
      uv[k*2] = u0 + ts[ci][0] * .5; uv[k*2+1] = v0 + ts[ci][1] * .5; });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080 }));
    mesh.name = name; mesh.userData = { mat: "m132" };
    return { gd: { name: name, mat: "m132", position: pos, normal: nrm, uv: uv }, mesh: mesh };
  };
  // fl → the RIGHT top quadrant, fr → the LEFT one: the seam at x = 0 is 256 texels wide on the sheet.
  var Q = [quad("fl", -2, 0, 0, .5, .5), quad("fr", 0, 2, 0, 0, .5), quad("far", 1, 3, -1, 0, 0), quad("near", -2, 0, -.03, .5, 0)];
  var group = new THREE.Group(); Q.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t132", cStem: "t132", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
            baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
  App.slots = new Map([["t132", s]]); App.activeSlot = s;
  App.geomData = Q.map(function(q){ return q.gd; });
  App.meshes = new Map(Q.map(function(q){ return [q.mesh.name, q.mesh]; }));
  App.matSlot = new Map([["m132", "t132"]]);
  App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 6, y: 2, z: 1 };
  App._projGL = null;
  modelGroup = group;
  document.getElementById("symOn").checked = false;
  document.getElementById("optFlipV").checked = false;
  if (App.paint3d) setPaint3d(false);
  setPlacing(false);
  cam.fly = false; cam.target.set(0, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 6;
  resize3D(); syncCamera();
  out.mode = projGL() ? "gl" : "canvas";

  setBrushMode("color");
  App.brush.color = "#ff0000"; App.brush.opacity = 1; App.brush.size = 4; App.brush.spacing = 2;
  var L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
  s.layers = [L]; App.activeLayer = L;
  App.undoStack.length = 0; App.redoStack.length = 0;

  var el = document.getElementById("view3d");
  var pe = function(type, x, y, o){ o = o || {};
    return new PointerEvent(type, { clientX: x, clientY: y, button: o.button || 0, buttons: type === "pointerup" ? 0 : 1,
      altKey: !!o.alt, ctrlKey: !!o.ctrl, shiftKey: false, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }); };
  var click = function(w, o){ var p = worldToScreen(w);
    el.dispatchEvent(pe("pointermove", p.x, p.y)); el.dispatchEvent(pe("pointerdown", p.x, p.y, o)); el.dispatchEvent(pe("pointerup", p.x, p.y, o)); };
  var data = function(){ return ctx2d(L.canvas).getImageData(0, 0, N, N).data; };
  // painted texels per quadrant: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
  var quads = function(){ var d = data(), q = [0, 0, 0, 0];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 0) q[(y >= 128 ? 2 : 0) + (x >= 128 ? 1 : 0)]++;
    return q; };
  var same = function(a, b){ if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  var esc = function(){ document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true })); };

  PathUI.set(true);
  // ---- a square across the seam, laid and closed through the viewport ----
  var sq = [V3(-.5, -.5, 0), V3(.5, -.5, 0), V3(.5, .5, 0), V3(-.5, .5, 0)];
  sq.forEach(function(w){ click(w); });
  out.laid = { n: PathUI.path ? PathUI.path.pts.length : 0, frame: !!PathUI.frame, closed: PathUI.path && PathUI.path.closed };
  click(sq[0]);                                           // back on the first: close
  var P = PathUI.path;
  out.laid.closedAfter = P && P.closed;
  out.laid.pts = P ? P.pts.map(function(n){ return [n.x, n.y, n.d].map(function(v){ return Math.round(v * 1000) / 1000; }); }) : null;
  out.laid.n2 = P ? P.pts.length : 0;
  out.laid.info = document.getElementById("pathInfo").textContent;
  needsRender(); await frame(); await frame();
  out.overlay = { shown: PathOverlay.shown, visible: !!(PathOverlay.group && PathOverlay.group.visible) };
  // ---- a click on the line puts a point in it, on the model too; Delete takes it out (4.52 (2)) ----
  click(V3(0, -.5, 0));
  out.ins = { n: P.pts.length, sel: PathUI.sel, at: P.pts[1] ? [P.pts[1].x, P.pts[1].y].map(function(v){ return Math.round(v * 1000) / 1000; }) : null };
  needsRender(); await frame();
  out.ins.ring = !!(PathOverlay.sel && PathOverlay.sel.visible);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", key: "Delete", bubbles: true }));
  out.ins.after = P.pts.length; out.ins.layer = s.layers.length === 1 && s.layers[0] === L;
  // the sheet's pointer refuses to add to a path on the model
  var before2d = P.pts.length;
  out.cross2d = { took: PathUI.down({ altKey: false, ctrlKey: false, button: 0 }, { x: 10, y: 10 }), n: P.pts.length === before2d };

  // ---- Fill ----
  var snap = data().slice(), depth = App.undoStack.length;
  var t0 = performance.now();
  PathUI.fill();
  out.fillMs = Math.round(performance.now() - t0);
  out.fill = { q: quads(), steps: App.undoStack.length - depth };
  // the row through the middle (world y = 0 is sheet y = 64): every texel 0 or 255, and full inside
  var d = data(), soft = 0, inHole = 0;
  for (var x = 0; x < N; x++) { var a = d[(64 * N + x) * 4 + 3]; if (a > 0 && a < 255) soft++; }
  for (var x = 227; x < 254; x++) if (d[(64 * N + x) * 4 + 3] < 255) inHole++;
  for (var x = 3; x < 30; x++) if (d[(64 * N + x) * 4 + 3] < 255) inHole++;
  out.fill.soft = soft; out.fill.inHole = inHole;
  out.fill.red = [d[(64 * N + 240) * 4], d[(64 * N + 240) * 4 + 1], d[(64 * N + 16) * 4], d[(64 * N + 16) * 4 + 3]];
  doUndo();
  out.fill.undone = same(data(), snap);

  // ---- the depth limit: a path on the front plate reaching past its edge ----
  P.pts = [[2, 0], [3, 0], [3, 1], [2, 1]].map(function(q){ return { x: q[0], y: q[1], hx: 0, hy: 0, d: 0 }; });   // world x 1.5 … 2.5
  P.closed = true; PathUI.sync();
  PathUI.fill();
  out.depth = { q: quads() };
  doUndo();

  // ---- …and the limit follows the nodes: the same kind of square laid ON the far plate ----
  esc();
  out.escCleared = !PathUI.path && !PathUI.frame;
  [V3(2.45, -.4, -1), V3(2.95, -.4, -1), V3(2.95, .4, -1), V3(2.45, .4, -1)].forEach(function(w){ click(w); });
  // x from 2.45: the camera is perspective, 6 m out, so its ray to (2.45, y, −1) crosses z = 0 at
  // x = 2.1 — past the front plate's edge. At 2.2 the first click landed on the front plate instead.
  click(V3(2.45, -.4, -1));
  out.farPath = { closed: PathUI.path && PathUI.path.closed, d: PathUI.path && PathUI.path.pts.map(function(n){ return Math.round(n.d * 1000) / 1000; }) };
  PathUI.fill();
  out.farPath.q = quads();
  doUndo();

  // ---- Stamp along: a 3 m line across the seam at 8 texels (size 4 × Spacing 2 = 1/8 m) ----
  esc();
  click(V3(-1.5, .5, 0)); click(V3(1.5, .5, 0));
  out.line = { n: PathUI.path && PathUI.path.pts.length, closed: PathUI.path && PathUI.path.closed };
  snap = data().slice(); depth = App.undoStack.length;
  out.stamp = { laid: PathUI.stamp(), steps: 0 };
  out.stamp.steps = App.undoStack.length - depth;
  // world y = 0.5 is sheet y = 32: count the separate dabs along it
  d = data(); var runs = 0, inRun = false;
  for (var x = 0; x < N; x++) { var on = d[(32 * N + x) * 4 + 3] > 0; if (on && !inRun) runs++; inRun = on; }
  out.stamp.runs = runs;
  out.stamp.q = quads();
  doUndo();
  out.stamp.undone = same(data(), snap);

  // ---- → selection: the same square as a selection, both islands of it ----
  esc();
  sq.forEach(function(w){ click(w); }); click(sq[0]);
  Marquee.none();
  out.sel = { ok: PathUI.toSelection({}) };
  var st = Marquee.stencil(s);
  if (st) { var sg = ctx2d(st), k = st.width / N;
    var at = function(x, y){ return sg.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data[3]; };
    out.sel.left = at(16, 64); out.sel.right = at(240, 64); out.sel.off = at(128, 64); out.sel.far = at(80, 200); }
  Marquee.none();

  // ---- the model's pointer refuses to add to a path on the sheet ----
  esc();
  PathUI.path = Path.make(); Path.add(PathUI.path, 20, 20); PathUI.frame = null;
  click(V3(0, 0, 0));
  out.cross3d = { n: PathUI.path.pts.length, frame: !!PathUI.frame };
  // …and a click off the model is the view's, not the tool's
  esc();
  click(V3(0, 5, 0));
  out.offModel = { path: !!(PathUI.path && PathUI.path.pts.length), frame: !!PathUI.frame };

  PathUI.set(false); PathUI.clear();
  scene.remove(group);
  return out;
}`;

const run = await evalInPage({ browser, html, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
console.log(`  (projector: ${r.mode}; fill took ${r.fillMs} ms on a 256² sheet)`);

R.is(r.laid.n === 4 && r.laid.frame && !r.laid.closed, `four clicks on the model lay four nodes in a plane fixed at the first (${JSON.stringify(r.laid)})`);
R.is(r.laid.closedAfter && r.laid.n2 === 4, "…and a click on the first node closes the path rather than adding a fifth");
R.is(r.laid.pts && r.laid.pts.every((p, i) => near(p[0], [0, 1, 1, 0][i], .01) && near(p[1], [0, 0, 1, 1][i], .01) && near(p[2], 0, .01)),
  `…each node where it was clicked, in metres along the screen's right and up, at depth 0 (${JSON.stringify(r.laid.pts)})`);
R.is(/on the model/.test(r.laid.info), `the panel says where the path is (${r.laid.info})`);
R.is(r.overlay.shown && r.overlay.visible, "the path is drawn over the 3-D view");
R.is(r.ins.n === 5 && r.ins.sel === 1 && r.ins.ring && JSON.stringify(r.ins.at) === JSON.stringify([0.5, 0]),
  `a click on the path's line on the model puts a point in it, selected and ringed (${r.ins.n} points, the new one at ${r.ins.at} m in the path's plane, halfway along its first side) (ROADMAP 4.52 (2))`);
R.is(r.ins.after === 4 && r.ins.layer, `…and Delete takes it out, not the layer (${r.ins.after} points)`);
R.is(r.cross2d.took === true && r.cross2d.n, "a click on the sheet does not add to a path on the model");

const [q0, q1, q2, q3] = r.fill.q;
R.is(near(q0, 2048, 300) && near(q1, 2048, 300), `Fill paints BOTH islands of a square across the UV seam — 0.5 × 1 m each, 2048 texels (${q0} at the sheet's left edge, ${q1} at its right)`);
R.is(q3 === 0, `…and nothing on the plate 3 cm behind, inside the beam's reach: the depth pre-pass (${q3})`);
R.is(q2 === 0, `…and nothing on the plate 1 m behind (${q2})`);
R.is(r.fill.soft === 0, `…hardened: across the row through its middle every texel is 0 or 255 (${r.fill.soft} in between)`);
R.is(r.fill.inHole === 0, `…with nothing below full alpha inside it (${r.fill.inHole})`);
R.is(r.fill.red[0] === 255 && r.fill.red[1] === 0 && r.fill.red[2] === 255 && r.fill.red[3] === 255, `…in the brush's colour (${r.fill.red})`);
R.is(r.fill.steps === 1, `…as one undo step (${r.fill.steps})`);
R.is(r.fill.undone, "…and undo puts the sheet back exactly");

R.is(near(r.depth.q[0], 2048, 300), `a path on the front plate reaching past its edge fills the front plate (${r.depth.q[0]})`);
R.is(r.depth.q[2] === 0, `…and nothing on the plate 1 m behind where nothing hides it: the depth limit (${r.depth.q[2]})`);
R.is(r.escCleared, "Esc clears a path on the model, plane and all");
R.is(r.farPath.closed && r.farPath.d && r.farPath.d.every(v => near(v, 0, .01)), `a path laid on the far plate is at its own depth (${JSON.stringify(r.farPath.d)})`);
R.is(near(r.farPath.q[2], 1638, 250) && r.farPath.q[0] === 0 && r.farPath.q[1] === 0,
  `…and fills it — the limit follows the nodes, it is not a slab (${r.farPath.q.join(" / ")}; 0.5 × 0.8 m is 1638)`);

R.is(r.line.n === 2 && !r.line.closed, "two clicks lay an open line");
R.is(r.stamp.laid === 24, `Stamp along walks a 3 m line at 1/8 m: 24 stamps, every one on the surface (${r.stamp.laid})`);
R.is(r.stamp.runs >= 23 && r.stamp.runs <= 25, `…laid apart, not joined into a line: ${r.stamp.runs} separate dabs along the row (24 ± 1 — the one on the seam can land on either island's edge)`);
R.is(r.stamp.q[0] > 0 && r.stamp.q[1] > 0 && r.stamp.q[2] === 0 && r.stamp.q[3] === 0, `…on both islands and nowhere else (${r.stamp.q.join(" / ")})`);
R.is(r.stamp.steps === 1 && r.stamp.undone, `…as one undo step that puts the sheet back exactly (${r.stamp.steps})`);

R.is(r.sel.ok === true && r.sel.left > 0 && r.sel.right > 0 && r.sel.off === 0 && r.sel.far === 0,
  `→ selection selects both islands of the projected square and nothing else (${JSON.stringify(r.sel)})`);
R.is(r.cross3d.n === 1 && !r.cross3d.frame, "a click on the model does not add to a path on the sheet");
R.is(!r.offModel.path && !r.offModel.frame, "a click off the model lays nothing — it is the view's, to orbit");
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
