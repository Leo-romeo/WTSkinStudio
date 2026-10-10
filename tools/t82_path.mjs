// The path model behind the shape tool (ROADMAP 6.1).
//
// WHY THIS EXISTS. A camouflage blotch and a run of rivets round a hatch are the same object — a
// path, filled or walked with a stamp — and every property that makes one of them right is exact:
//
//   * a segment with no handles is a straight LINE: two points and nothing in between, whatever the
//     tolerance, so a hard-edged camo edge does not acquire a hundred collinear vertices;
//   * a symmetric cubic passes through the point its control polygon predicts (the midpoint of a
//     quarter-circle-ish curve), and finer tolerance means more points and the same shape;
//   * a closed path does not repeat its first point — one duplicated vertex is a zero-length step
//     that a stamp walk would land twice on;
//   * walking a square of side 100 at step 10 gives **40** samples, evenly spaced, whose heading
//     turns a right angle at each corner, and the spacing CARRIES ACROSS a corner rather than
//     restarting — rivets that bunch at every node are the failure this prevents;
//   * hit-testing prefers a node to a handle, and finds neither when the cursor is far away.
//
// Usage: node tools/t82_path.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Path } = new Function(sectionOf("PATHS").replace(/^"use strict";$/m, "") + "\nreturn { Path };")();

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };
const is = (c, m) => c ? ok(m) : bad(m);
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

// ---- straight segments stay straight ----
{
  const p = Path.make();
  Path.add(p, 0, 0); Path.add(p, 100, 0); Path.add(p, 100, 100);
  const poly = Path.flatten(p, 1);
  is(poly.length === 3, `an open path of three corners flattens to three points, whatever the tolerance (${poly.length})`);
  p.closed = true;
  const cl = Path.flatten(p, 1);
  is(cl.length === 3, `…and closed it is still three — the first point is not repeated (${cl.length})`);
  is(near(Path.length(poly, false), 200) && near(Path.length(cl, true), 200 + Math.hypot(100, 100)),
    `closing it adds the segment home (${Path.length(poly, false)} → ${Path.length(cl, true).toFixed(2)})`);
  is(Path.segCount(p) === 3 && Path.segCount({ pts: p.pts, closed: false }) === 2,
    "a closed path has one more segment than an open one");
}
// ---- a curve is a curve ----
{
  const p = Path.make();
  const a = Path.add(p, 0, 0), b = Path.add(p, 100, 0);
  a.hx = 0; a.hy = 50; b.hx = 0; b.hy = 50;       // symmetric: both handles point the same way
  const poly = Path.flatten(p, 2);
  is(poly.length > 8, `a curved segment is subdivided (${poly.length} points at tolerance 2)`);
  const fine = Path.flatten(p, .5);
  is(fine.length > poly.length, `…and finer tolerance gives more of them (${fine.length} at 0.5)`);
  // …until the cap, which is what stops a pathological tolerance from making a million points
  const capped = Path.flatten(p, .001);
  is(capped.length <= Path.MAX_SEG + 2 && Path.MAX_SEG >= 256,
    `…up to the cap of ${Path.MAX_SEG} segments (${capped.length} points at tolerance 0.001)`);
  // the cubic's own midpoint: (p0 + 3c0 + 3c1 + p1) / 8
  const s = Path.seg(p, 0), mid = Path.at(s, .5);
  is(near(mid[0], 50) && near(mid[1], (3 * 50 + 3 * -50) / 8 + 0, 1e-9),
    `the midpoint is where the control polygon puts it (${mid.map(v => v.toFixed(3))})`);
  // every flattened point lies between the ends, and the shape does not depend on the tolerance
  const bb = Path.bounds(poly), bf = Path.bounds(fine);
  is(near(bb.x0, bf.x0, .5) && near(bb.x1, bf.x1, .5) && near(bb.y0, bf.y0, .5) && near(bb.y1, bf.y1, .5),
    "…and the shape is the same at either tolerance");
  is(near(bb.x0, 0, 1e-9) && near(bb.x1, 100, 1e-9), `the bounds are the path's own (${bb.x0}…${bb.x1})`);
}
// ---- walking a square ----
{
  const p = Path.make();
  Path.add(p, 0, 0); Path.add(p, 100, 0); Path.add(p, 100, 100); Path.add(p, 0, 100);
  p.closed = true;
  const poly = Path.flatten(p, 1);
  is(near(Path.length(poly, true), 400), `the square's perimeter is 400 (${Path.length(poly, true)})`);
  const w = Path.walk(poly, 10, true);
  is(w.length === 40, `walking it at step 10 gives 40 stamps (${w.length})`);
  let worst = 0;
  for (let i = 1; i < w.length; i++) {
    const d = Math.hypot(w[i].x - w[i-1].x, w[i].y - w[i-1].y);
    // a step that turns a corner is shorter than 10 across the chord, but never longer
    worst = Math.max(worst, d - 10);
  }
  is(worst < 1e-6, `…none of them further apart than the step (worst overshoot ${worst.toExponential(1)})`);
  const angles = new Set(w.map(s => Math.round(s.a * 180 / Math.PI)));
  is(angles.size === 4 && angles.has(0) && angles.has(90) && angles.has(180),
    `…and the heading takes exactly four values, one per side (${[...angles].sort((a, b) => a - b)})`);
  // the spacing carries across a corner: the first sample of side two is 10 from the corner along
  // the whole path, not restarted at it
  const onSecond = w.filter(s => Math.round(s.a * 180 / Math.PI) === 90);
  is(onSecond.length === 10 && near(onSecond[0].y, 0), `…and it carries across a corner rather than restarting (${onSecond.length} on the second side, first at y ${onSecond[0].y})`);
  const open = Path.walk(poly, 10, false);
  is(open.length === 30, `an open walk of the same points is three sides (${open.length})`);
}
// ---- degenerate input ----
{
  is(Path.flatten(Path.make(), 1).length === 0, "an empty path flattens to nothing");
  const one = Path.make(); Path.add(one, 5, 5);
  is(Path.flatten(one, 1).length === 1, "…and a single point to itself");
  is(Path.walk([[0, 0]], 10, false).length === 1, "walking a single point gives that point");
  is(Path.walk([[0, 0], [0, 0]], 10, false).length === 0, "…and a zero-length segment gives nothing to stamp");
  is(Path.length([], false) === 0 && Path.bounds([]) === null, "the length of nothing is zero and it has no bounds");
}
// ---- hit-testing ----
{
  const p = Path.make();
  const a = Path.add(p, 10, 10);
  Path.add(p, 100, 10);
  a.hx = 20; a.hy = 0;
  const h1 = Path.hit(p, 12, 11, 8);
  is(h1 && h1.kind === "point" && h1.i === 0, `a node under the cursor is found (${JSON.stringify(h1)})`);
  const h2 = Path.hit(p, 30, 10, 8);
  is(h2 && h2.kind === "handle" && h2.i === 0, `…and its handle, out at its own offset (${JSON.stringify(h2)})`);
  const h3 = Path.hit(p, -10, 10, 8);
  is(h3 && h3.kind === "handle2" && h3.i === 0, "…and the mirror handle on the other side");
  is(Path.hit(p, 55, 60, 8) === null, "nothing is found where nothing is");
  // a node wins a tie against a handle sitting on top of it
  const t = Path.make();
  const n = Path.add(t, 0, 0); n.hx = 1; n.hy = 0;
  is(Path.hit(t, 0, 0, 5).kind === "point", "a node wins over a handle at the same place");
}
// ---- handles ----
{
  const p = Path.make();
  const n = Path.add(p, 50, 50);
  Path.setHandle(p, 0, "handle", 70, 50);
  is(n.hx === 20 && n.hy === 0, `dragging a handle sets the offset from its node (${n.hx}, ${n.hy})`);
  Path.setHandle(p, 0, "handle2", 70, 50);
  is(n.hx === -20 && n.hy === 0, "…and dragging the mirror handle sets the opposite one, so the node stays smooth");
  const c = Path.clone(p);
  c.pts[0].x = 999;
  is(p.pts[0].x === 50, "a clone shares no node with the original");
}

// ---- the real page: the two verbs ----
const { findBrowser, evalInPage, pageExpr } = await import("./headless.mjs");
const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) {
  console.log("\n(SKIP: no Chrome or Edge found, so the fill and the stamp are not exercised)");
  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
}

const BODY = `async function(){
  var out = {}, N = 256;
  var keep = { slot: App.activeSlot, tool: App.brush.tool, chan: App.brush.chan, target: App.brush.target,
               color: App.brush.color, size: App.brush.size, spacing: App.brush.spacing, op: App.brush.opacity };
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t82", size: N, nSize: N, layers: [], missing: false, baseC: grey(), composite: grey(), normal: null };
  App.slots.set("t82", s);
  App.activeSlot = s;
  setBrushMode("color");
  App.brush.color = "#ff0000"; App.brush.size = 16; App.brush.spacing = .5; App.brush.opacity = 1;
  var L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
  s.layers = [L]; App.activeLayer = L;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var painted = function(c){ var d = ctx2d(c).getImageData(0, 0, N, N).data, n = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; };

  // ---- a square path, filled ----
  PathUI.set(true);
  out.on = PathUI.on;
  var mk = function(pts, closed){
    PathUI.path = Path.make();
    pts.forEach(function(q){ Path.add(PathUI.path, q[0], q[1]); });
    PathUI.path.closed = !!closed;
    PathUI.sync();
  };
  mk([[64, 64], [192, 64], [192, 192], [64, 192]], true);
  out.rows = { info: $("pathInfo").textContent, fillOff: $("btnPathFill").disabled };
  PathUI.fill();
  out.fill = { inside: px(L.canvas, 128, 128), outside: px(L.canvas, 10, 10), n: painted(L.canvas) };
  // the edge is one fill, so the rim is not a double-drawn seam: the row through the middle is a
  // clean run of opaque texels with antialiased ends and nothing pale inside it
  var row = ctx2d(L.canvas).getImageData(0, 128, N, 1).data, holes = 0;
  for (var x = 70; x < 186; x++) if (row[x * 4 + 3] < 250) holes++;
  out.fill.holes = holes;
  // undo puts it back
  doUndo();
  out.afterUndo = painted(L.canvas);

  // ---- a fill is a stroke: the shield holds, the Eraser erases, a missing channel slot is made ----
  // (each of these went wrong while Fill had its own path round beginStroke — see PathUI.fill)
  Marquee.set({ x: 64, y: 64, w: 64, h: 128 });
  PathUI.fill();
  out.sel = { inSel: px(L.canvas, 90, 128), outSel: px(L.canvas, 160, 128) };
  Marquee.none();
  doUndo();
  var gl = ctx2d(L.canvas); gl.fillStyle = "#00ff00"; gl.fillRect(0, 0, N, N);
  setBrushMode("erase");
  PathUI.fill();
  out.erase = { inside: px(L.canvas, 128, 128), outside: px(L.canvas, 10, 10) };
  setBrushMode("color");
  doUndo();
  gl.clearRect(0, 0, N, N);
  var R2 = LayerNode.of({ type: "paint", name: "r", chan: "rough", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
  s.layers = [L, R2]; App.activeLayer = R2;
  var depth = App.undoStack.length, threw = null;
  try { PathUI.fill(); } catch (e) { threw = String(e && e.message || e); }
  var cc = LayerNode.contentOn(R2, "color");
  out.slot = { threw: threw, inside: cc && cc.canvas ? px(cc.canvas, 128, 128) : null, steps: App.undoStack.length - depth };
  doUndo();
  out.slot.gone = !LayerNode.contentOn(R2, "color");
  s.layers = [L]; App.activeLayer = L;
  // turning the shape tool on with Select already on hands the pointer over instead of throwing
  PathUI.set(false); SelectUI.setOn(true);
  try { PathUI.set(true); out.withSel = { threw: null, path: PathUI.on, sel: SelectUI.on }; }
  catch (e) { out.withSel = { threw: String(e && e.message || e) }; }
  SelectUI.setOn(true);
  out.selBack = { path: PathUI.on, sel: SelectUI.on };
  SelectUI.setOn(false); PathUI.set(true);

  // ---- an open path cannot be filled, and says so ----
  mk([[10, 10], [60, 60]], false);
  out.openFillOff = $("btnPathFill").disabled;

  // ---- the stamp walks it ----
  ctx2d(L.canvas).clearRect(0, 0, N, N);
  mk([[32, 128], [224, 128]], false);
  PathUI.stamp();
  out.stamp = { n: painted(L.canvas), mid: px(L.canvas, 128, 128), off: px(L.canvas, 128, 40) };
  // …at the brush's own spacing: 16 x .5 = 8 texels, so a 192-texel line is 24 stamps
  out.stampUndo = (function(){ doUndo(); return painted(L.canvas); })();

  // ---- a click adds a point, Alt+click takes it away, the first point closes it ----
  PathUI.path = Path.make();
  var ev = function(alt){ return { altKey: !!alt, shiftKey: false, button: 0 }; };
  PathUI.down(ev(), { x: 20, y: 20 }); PathUI.up();
  PathUI.down(ev(), { x: 120, y: 20 }); PathUI.up();
  PathUI.down(ev(), { x: 120, y: 120 }); PathUI.up();
  out.three = PathUI.path.pts.length;
  PathUI.down(ev(), { x: 20, y: 20 }); PathUI.up();            // back on the first: close
  out.closed = PathUI.path.closed;
  PathUI.down(ev(true), { x: 120, y: 120 }); PathUI.up();      // Alt+click removes
  out.afterAlt = PathUI.path.pts.length;
  // a drag out of a fresh click pulls a handle
  PathUI.path = Path.make();
  PathUI.down(ev(), { x: 50, y: 50 });
  PathUI.move(ev(), { x: 70, y: 50 });
  PathUI.up();
  out.handle = [PathUI.path.pts[0].hx, PathUI.path.pts[0].hy];
  // …and Ctrl+drag pulls one out of a node that was placed as a corner
  PathUI.path = Path.make();
  PathUI.down(ev(), { x: 50, y: 50 }); PathUI.up();
  PathUI.down({ altKey: false, ctrlKey: true, button: 0 }, { x: 50, y: 50 });
  PathUI.move(ev(), { x: 50, y: 80 });
  PathUI.up();
  out.ctrlHandle = [PathUI.path.pts[0].hx, PathUI.path.pts[0].hy];

  PathUI.set(false);
  PathUI.clear();
  App.activeSlot = keep.slot; App.slots.delete("t82"); App.activeLayer = null;
  App.brush.color = keep.color; App.brush.size = keep.size; App.brush.spacing = keep.spacing; App.brush.opacity = keep.op;
  setBrushMode(keep.tool === "brush" && keep.chan === "color" ? "color" : App.brush.mode);
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

is(r.on === true, "the shape tool turns on");
is(/4 points · closed/.test(r.rows.info), `the panel says what the path is (${r.rows.info})`);
is(r.rows.fillOff === false, "…and Fill is offered for a closed path");
is(r.fill.inside[0] === 255 && r.fill.inside[3] === 255, `filling a closed square paints its inside in the brush's colour (${r.fill.inside})`);
is(r.fill.outside[3] === 0, "…and nothing outside it");
is(r.fill.n > 15000 && r.fill.n < 17500, `…over its own area, 128² ≈ 16 384 texels (${r.fill.n})`);
is(r.fill.holes === 0, `…in one fill, so the run across it is solid with no pale seam (${r.fill.holes} texels below full alpha)`);
is(r.afterUndo === 0, "…and it is one undo step");
is(r.sel.inSel[3] === 255 && r.sel.outSel[3] === 0,
  `a marquee confines a fill the way it confines a dab (inside ${r.sel.inSel}, outside ${r.sel.outSel})`);
is(r.erase.inside[3] === 0 && r.erase.outside[1] === 255 && r.erase.outside[3] === 255,
  `the Eraser's fill rubs the shape out rather than painting it (inside ${r.erase.inside}, outside ${r.erase.outside})`);
is(!r.slot.threw && r.slot.inside && r.slot.inside[0] === 255 && r.slot.inside[3] === 255,
  `a selected layer with nothing on the brush's channel gets the slot made and filled (${r.slot.threw || r.slot.inside})`);
is(r.slot.steps === 1 && r.slot.gone, `…as ONE undo step with the slot it made (${r.slot.steps} step(s), slot gone after undo: ${r.slot.gone})`);
is(r.withSel && !r.withSel.threw && r.withSel.path === true && r.withSel.sel === false,
  `turning Shape on with Select on turns Select off (${JSON.stringify(r.withSel)})`);
is(r.selBack.path === false && r.selBack.sel === true, `…and turning Select on turns Shape off (${JSON.stringify(r.selBack)})`);
is(r.openFillOff === true, "an open path cannot be filled, and the button says so");
is(r.stamp.n > 500, `stamping walks the brush along the path (${r.stamp.n} texels painted)`);
is(r.stamp.mid[0] >= 250 && r.stamp.mid[3] > 200, `…in the brush's colour, along the line (${r.stamp.mid})`);
is(r.stamp.off[3] === 0, "…and nowhere else");
is(r.stampUndo === 0, "…and it is one undo step too");
is(r.three === 3, `three clicks make three points (${r.three})`);
is(r.closed === true, "…clicking the first one closes the path");
is(r.afterAlt === 2, `…and Alt+click takes a point out again (${r.afterAlt})`);
is(r.ctrlHandle[0] === 0 && r.ctrlHandle[1] === 30, `Ctrl+drag pulls a handle out of a node placed as a corner (${r.ctrlHandle}) — without it a corner could never be curved`);
is(r.handle[0] === 20 && r.handle[1] === 0, `a drag out of a fresh click pulls that node's handle (${r.handle})`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
