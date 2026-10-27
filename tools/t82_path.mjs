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
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
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
  is(poly.length > 4, `a curved segment is subdivided (${poly.length} points at tolerance 2)`);
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
// ---- the cut adapts to the curve, and its look rides on the path (ROADMAP 4.52 (1)) ----
{
  // A quarter circle as one cubic (handles 0.5523 R): the worst sag of any piece, measured at each
  // piece's middle against the true radius.
  const arc = (R, look) => { const k = .5523 * R, p = Object.assign(Path.make(), look || {});
    Object.assign(Path.add(p, R, 0), { hx: 0, hy: k }); Object.assign(Path.add(p, 0, R), { hx: -k, hy: 0 }); return p; };
  const sagOf = (poly, R) => { let d = 0; for (let i = 1; i < poly.length; i++)
    d = Math.max(d, R - Math.hypot((poly[i][0] + poly[i - 1][0]) / 2, (poly[i][1] + poly[i - 1][1]) / 2)); return d; };
  // The owner's facets (2026-10-21) were on the model: a path there is in metres, and the old cut
  // floored its tolerance at 0.5 — of a metre. A 1 m arc at 1024 texels a metre was 4 pieces and
  // sagged 20 texels; held to a quarter texel it must sag no more than that, in texels.
  const m = arc(1), pm = Path.flatten(m, .25 / 1024), sm = sagOf(pm, 1) * 1024;
  is(sm <= .25 + 1e-6 && pm.length - 1 > 8, `a 1 m arc on the model at 1024 texels a metre sags ${sm.toFixed(3)} texels in ${pm.length - 1} pieces — at most the tolerance, where the old cut gave 4 pieces and 20 texels`);
  const sh = arc(200), ps = Path.flatten(sh, .25), ss = sagOf(ps, 200);
  is(ss <= .25 + 1e-6 && ps.length - 1 <= 32, `on the sheet a 200-texel arc sags ${ss.toFixed(3)} in ${ps.length - 1} pieces — not the 232 even pieces of before`);
  const tight = arc(20), gentle = arc(2000);
  is(Path.flatten(gentle, .25).length > Path.flatten(tight, .25).length,
    `a wider bend gets more pieces at the same tolerance — the cut follows the sag (${Path.flatten(tight, .25).length - 1} for r 20, ${Path.flatten(gentle, .25).length - 1} for r 2000)`);
  const lens = poly => poly.slice(1).map((q, i) => Math.hypot(q[0] - poly[i][0], q[1] - poly[i][1]));
  // Angle: the most the curve turns inside a piece. 30° over a 90° arc is 3 pieces at any size.
  const n30 = [20, 200, 2000].map(R => Path.flatten(arc(R, { angle: 30 }), .25).length - 1);
  is(n30.every(n => n === 3), `Angle 30° cuts a quarter circle into 3 pieces at any size (${n30.join(", ")}) — a low-poly curve`);
  // …placed by turn, not by length: a curve that bends hard at one end puts its corners there.
  const hook = Object.assign(Path.make(), { angle: 15 }); Object.assign(Path.add(hook, 0, 0), { hx: 90, hy: 0 }); Object.assign(Path.add(hook, 100, 40), { hx: 0, hy: 20 });
  const hl = lens(Path.flatten(hook, .25));
  is(hl[0] > 2 * hl[hl.length - 1], `…where it bends: a hook that turns hard at its end gets its short pieces there (${hl.map(v => v.toFixed(0)).join(" ")})`);
  is(Path.flatten(arc(200, { angle: 90 }), .25).length === 2, "…and 90° leaves it one chord");
  // Bias: the same count of pieces, bunched to one end.
  const even = lens(Path.flatten(arc(200, { angle: 30 }), .25));
  const toStart = lens(Path.flatten(arc(200, { angle: 30, bias: 1 }), .25)), toEnd = lens(Path.flatten(arc(200, { angle: 30, bias: -1 }), .25));
  const rising = a => a.every((v, i) => !i || v > a[i - 1]);
  is(Math.max(...even) - Math.min(...even) < 1 && toStart.length === even.length && toEnd.length === even.length &&
    rising(toStart) && rising(toEnd.slice().reverse()),
    `Bias bunches the pieces at the start (+: ${toStart.map(v => v.toFixed(0)).join(" ")}) or the end (−: ${toEnd.map(v => v.toFixed(0)).join(" ")}); even without it (${even.map(v => v.toFixed(0)).join(" ")})`);
  // The look is the path's: a clone keeps it, and a straight segment ignores it.
  const c = Path.clone(arc(10, { angle: 45, bias: -.5 }));
  is(c.angle === 45 && c.bias === -.5 && !("angle" in Path.clone(arc(10))), "a clone keeps the path's Angle and Bias, and a path without them stays without");
  const ln = Object.assign(Path.make(), { angle: 45, bias: 1 }); Path.add(ln, 0, 0); Path.add(ln, 100, 0);
  is(Path.flatten(ln, .25).length === 2, "a straight segment is two points whatever the look");
  // Found in review: a curve that runs back past its chord's end, and a cusp.
  const back = Path.make(); Object.assign(Path.add(back, 0, 0), { hx: 200, hy: 0 }); Path.add(back, 100, 0).ix = 100; back.pts[1].iy = 0;
  const bp = Path.flatten(back, .25), far = Math.max(...bp.map(q => q[0]));
  is(far > 160, `a curve whose handles run back past its chord is still followed (reaches x ${far.toFixed(1)} of the true 165.7)`);
  const cusp = Object.assign(Path.make(), { angle: 30 }); Object.assign(Path.add(cusp, 0, 0), { hx: 100, hy: 100 }); Object.assign(Path.add(cusp, 100, 0), { hx: 0, hy: 0 });
  cusp.pts[1].ix = -100; cusp.pts[1].iy = 100;
  const cl = lens(Path.flatten(cusp, .25));
  is(cl.every(v => v >= 1 - 1e-9), `a cusp is a corner, not pieces of no length spent on its point (shortest piece ${Math.min(...cl).toFixed(2)}, ${cl.length} pieces)`);
  const memo = arc(50, { angle: 20 }), f1 = Path.flatten(memo, .25), f2 = Path.flatten(memo, .25);
  memo.pts[1].x += 5; const f3 = Path.flatten(memo, .25);
  is(f1 === f2 && f3 !== f1 && f3[f3.length - 1][0] === 5, "the cut is kept for an unchanged path and made again when a node moves in place");
  // An S-bend whose ends run parallel still turns, so Angle still cuts it.
  const S = Object.assign(Path.make(), { angle: 60 }); Object.assign(Path.add(S, 0, 0), { hx: 60, hy: 0 }); Object.assign(Path.add(S, 100, 50), { hx: 60, hy: 0 });
  is(Path.flatten(S, .25).length > 2, `an S-bend with parallel ends is cut too (${Path.flatten(S, .25).length - 1} pieces at 60°)`);
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

// ---- a point put on the line keeps the curve's shape (ROADMAP 4.52 (2)) ----
{
  // An S-curve and a C-curve with handles of different lengths, so no half is a mirror of the other,
  // split at an uneven t: every point of the old curve must be ON the new pair of segments — the
  // old segment's point at u is the left half's at u/t, or the right half's at (u−t)/(1−t).
  const mk = () => { const p = Path.make();
    Object.assign(Path.add(p, 0, 0), { hx: 40, hy: 60 }); Object.assign(Path.add(p, 200, 0), { hx: 30, hy: -90 });
    Object.assign(Path.add(p, 260, 120), { hx: 0, hy: 50 }); return p; };
  const p0 = mk(), p = mk(), t = .3;
  const i = Path.split(p, 0, t);
  let worst = 0;
  for (let k = 0; k <= 50; k++) {
    const u = k / 50, old = Path.at(Path.seg(p0, 0), u);
    const q = u <= t ? Path.at(Path.seg(p, 0), u / t) : Path.at(Path.seg(p, 1), (u - t) / (1 - t));
    worst = Math.max(worst, Math.hypot(q[0] - old[0], q[1] - old[1]));
  }
  is(i === 1 && p.pts.length === 4 && worst < 1e-9, `splitting a segment at t = ${t} leaves the curve where it was (worst ${worst.toExponential(1)} texels over 51 points)`);
  let other = 0;
  for (let k = 0; k <= 20; k++) { const a = Path.at(Path.seg(p0, 1), k / 20), b = Path.at(Path.seg(p, 2), k / 20); other = Math.max(other, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  is(other < 1e-9, `…and the segment after it is untouched, though its first node's incoming handle was shortened (${other.toExponential(1)})`);
  const n = p.pts[1];
  is(n.ix != null && Math.abs(Math.atan2(n.iy, n.ix) - Math.atan2(-n.hy, -n.hx)) < 1e-9 && Math.abs(Math.hypot(n.ix, n.iy) - Math.hypot(n.hx, n.hy)) > 1,
    "the new node is smooth — its two handles opposite — with two lengths of its own, which is why a node can now carry `ix`");
  const half = mk(); Path.split(half, 0, .5);
  is(half.pts[1].ix == null, "split at ½ the two handles are equal, and the node is a plain mirrored one");
  const line = Path.make(); Path.add(line, 0, 0); Path.add(line, 100, 0); Path.split(line, 0, .25);
  is(line.pts.length === 3 && near(line.pts[1].x, 100 * (3 * .25 * .75 * .75 * 0 + 3 * .25 * .25 * .75 + .25 ** 3)) && line.pts[1].y === 0 && !line.pts.some(q => q.hx || q.hy || q.ix != null) && Path.flatten(line, 1).length === 3,
    "a point put on a straight line is a corner, and the line stays three points");
  // closed: the closing segment's node goes at the end
  const sq = Path.make(); [[0, 0], [100, 0], [100, 100], [0, 100]].forEach(q => Path.add(sq, q[0], q[1])); sq.closed = true;
  is(Path.split(sq, 3, .5) === 4 && sq.pts[4].x === 0 && sq.pts[4].y === 50, "on a closed path the closing segment's point goes in at the end");
  // a path on the model carries its depth to the new node, at t
  const dp = Path.make(); Path.add(dp, 0, 0).d = 1; Path.add(dp, 10, 0).d = 3; Path.split(dp, 0, .25);
  is(near(dp.pts[1].d, 1 + 2 * dp.pts[1].x / 10, 1e-12), `a path on the model gives a node put on a line the depth the line has there (${dp.pts[1].d.toFixed(4)} at x ${dp.pts[1].x.toFixed(4)})`);
  const dc = mk(); dc.pts.forEach((q, k) => { q.d = k; }); Path.split(dc, 0, .3);
  is(near(dc.pts[1].d, .3, 1e-12), `…and one put on a curve its depth at t, where flatten already put it (${dc.pts[1].d})`);
  // nearest finds the segment and the t
  const f = mk(), at = Path.at(Path.seg(f, 1), .6);
  const nr = Path.nearest(f, at[0], at[1] + 3);
  is(nr && nr.i === 1 && nr.dist <= 3 + 1e-6 && Math.abs(nr.t - .6) < .05, `the nearest point on the line is found by segment and t (${nr && nr.i}, ${nr && nr.t.toFixed(3)}, ${nr && nr.dist.toFixed(3)} away)`);
  is(Path.nearest(Path.make(), 0, 0) === null, "…and a path with no segment has none");
  const sc = Path.nearest(f, at[0] * 2, at[1] * 2, q => [q[0] * 2, q[1] * 2]);
  is(sc && sc.i === 1 && sc.dist < 1e-6, "measured through a map, as a path on the model is measured on the screen");
  // the incoming handle is a handle: hit, dragged, cloned
  is(Path.hit(p, n.x + n.ix, n.y + n.iy, 2).kind === "handle2", "the inserted node's incoming handle is found where it is, not at the mirror");
  Path.setHandle(p, 1, "handle", n.x + 10, n.y);
  is(near(n.hx, 10, 1e-9) && n.hy === 0 && Math.abs(n.iy) < 1e-9 && n.ix < 0, "dragging its outgoing handle turns the incoming one to stay opposite, keeping its own length");
  is(Path.clone(p).pts[1].ix === n.ix, "a clone keeps the incoming handle");
}

// ---- a whole path moved, scaled and turned is the same curve, mapped (ROADMAP 4.52 (5)) ----
{
  const mk = () => { const p = Path.make();
    Object.assign(Path.add(p, 0, 0), { hx: 40, hy: 60 }); Object.assign(Path.add(p, 200, 0), { hx: 30, hy: -90 });
    Object.assign(Path.add(p, 260, 120), { hx: 0, hy: 50 }); Path.split(p, 0, .3); return p; };
  const src = mk(), dst = mk(), cx = 100, cy = 40, k = 1.7, a = .9, tx = 13, ty = -8;
  Path.xform(src, dst, cx, cy, k, a, tx, ty);
  const map = q => [cx + k * (Math.cos(a) * (q[0] - cx) - Math.sin(a) * (q[1] - cy)) + tx, cy + k * (Math.sin(a) * (q[0] - cx) + Math.cos(a) * (q[1] - cy)) + ty];
  let worst = 0;
  for (let i = 0; i < Path.segCount(src); i++) for (let j = 0; j <= 20; j++) {
    const m = map(Path.at(Path.seg(src, i), j / 20)), q = Path.at(Path.seg(dst, i), j / 20);
    worst = Math.max(worst, Math.hypot(m[0] - q[0], m[1] - q[1]));
  }
  is(worst < 1e-9 && dst.pts[1].ix != null, `moving, scaling and turning the nodes and handles maps the whole curve exactly, incoming handles too (worst ${worst.toExponential(1)} over 63 points)`);
  Path.xform(src, dst, cx, cy, 1, 0, 0, 0);
  is(JSON.stringify(dst.pts) === JSON.stringify(src.pts.map(n => Object.assign({}, n))) || dst.pts.every((n, i) => near(n.x, src.pts[i].x, 1e-12) && near(n.hx, src.pts[i].hx, 1e-12)),
    "…and the identity from the gesture's starting copy puts it back where it was");
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
  // The one-shot Fill and Stamp along, which these checks are about; a path LAYER is t147's (4.52 (3)).
  document.getElementById("pathAsLayer").checked = false;
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

  // ---- a click on the line puts a point in it; Delete takes the selected one (4.52 (2)) ----
  PathUI.path = Path.make();
  PathUI.down(ev(), { x: 20, y: 20 }); PathUI.up();
  PathUI.down(ev(), { x: 120, y: 20 }); PathUI.up();
  PathUI.down(ev(), { x: 120, y: 120 }); PathUI.up();
  PathUI.down(ev(), { x: 20, y: 20 }); PathUI.up();            // closed
  PathUI.down(ev(), { x: 70, y: 21 }); PathUI.up();            // on the top edge, a texel off it
  var P = PathUI.path;
  out.ins = { n: P.pts.length, at: [P.pts[1].x, P.pts[1].y], sel: PathUI.sel, closed: P.closed,
              del: $("btnPathDel").disabled, status: $("status").textContent };
  var layersBefore = s.layers.length;
  var key = function(code){ window.dispatchEvent(new KeyboardEvent("keydown", { code: code, bubbles: true })); };
  key("Delete");
  out.ins.afterDel = P.pts.length; out.ins.layers = s.layers.length === layersBefore; out.ins.selAfter = PathUI.sel;
  out.ins.delOff = $("btnPathDel").disabled;
  key("Delete");                                                 // nothing selected: the path keeps its points
  out.ins.secondDel = P.pts.length; out.ins.layers2 = s.layers.length === layersBefore;
  $("pathAngle").focus();                                        // focus on a slider, as after dragging one
  $("pathAngle").dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", bubbles: true }));
  out.ins.fromSlider = s.layers.length === layersBefore && P.pts.length === 3;
  $("pathAngle").blur();
  PathUI.down(ev(), { x: 120, y: 120 }); PathUI.up();           // press a node: it is selected
  $("btnPathDel").click();
  out.ins.byButton = P.pts.length;

  // ---- Angle and Bias are the path's (4.52 (1)) ----
  PathUI.clear();
  PathUI.down(ev(), { x: 20, y: 200 }); PathUI.move(ev(), { x: 20, y: 140 }); PathUI.up();
  PathUI.down(ev(), { x: 200, y: 200 }); PathUI.move(ev(), { x: 200, y: 260 }); PathUI.up();
  var seen = function(){ return Path.flatten(PathUI.path, PathUI.TOL).length - 1; };
  var look = { smooth: seen(), label: $("pathAngleVal").textContent };
  var ang = $("pathAngle"); ang.value = "45"; ang.dispatchEvent(new Event("input"));
  look.angled = seen(); look.angle = PathUI.path.angle; look.label45 = $("pathAngleVal").textContent;
  PathUI.clear();
  PathUI.down(ev(), { x: 30, y: 30 }); PathUI.up();
  look.inherited = PathUI.path.angle;
  ang.value = "0"; ang.dispatchEvent(new Event("input"));
  look.reset = "angle" in PathUI.path;
  out.look = look;

  PathUI.set(false);
  PathUI.clear();
  App.activeSlot = keep.slot; App.slots.delete("t82"); App.activeLayer = null;
  App.brush.color = keep.color; App.brush.size = keep.size; App.brush.spacing = keep.spacing; App.brush.opacity = keep.op;
  setBrushMode(keep.tool === "brush" && keep.chan === "color" ? "color" : App.brush.mode);
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
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
const K = r.look;
is(K.label === "smooth" && K.angled < K.smooth && K.angle === 45 && K.label45 === "45°",
  `the panel's Angle re-cuts the path being drawn at once (${K.smooth} pieces smooth, ${K.angled} at 45°) (ROADMAP 4.52 (1))`);
is(K.inherited === 45 && K.reset === false, "a new path takes the panel's Angle, and Angle back at 0 leaves the path with none");
const I = r.ins;
is(I.n === 4 && Math.abs(I.at[0] - 70) < 1e-3 && I.at[1] === 20 && I.sel === 1 && I.closed,
  `a click a texel off a closed path's line puts a point ON the line, selected, and the path stays closed (${I.n} points, the new one at ${I.at})`);
is(I.del === false && /Delete removes it/.test(I.status), `…and says how to take it out again, with Delete point offered: "${I.status.slice(0, 60)}…"`);
is(I.afterDel === 3 && I.layers && I.selAfter === -1 && I.delOff, `the Delete key takes the selected point out — and not the layer under it (${I.afterDel} points, layers kept: ${I.layers})`);
is(I.secondDel === 3 && I.layers2 && I.fromSlider, "with nothing selected Delete takes no point — and no layer either, not even with focus left on the Angle slider (review of 4.52 (2))");
is(I.byButton === 2, `a pressed node is selected, and Delete point removes it (${I.byButton} points)`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
