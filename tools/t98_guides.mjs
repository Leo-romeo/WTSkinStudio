// A pixel grid, rulers and guides in the 2-D view, and the three gestures that snap to the guides
// (ROADMAP 4.50 (15)).
//
// WHY THIS EXISTS. Guides are only worth anything if the thing being lined up lands EXACTLY on them —
// a marquee one texel short of a stripe's edge is a seam in the finished skin — and every way that
// can go wrong looks almost right:
//
//   * **the arithmetic** (Node, lifted by the GUIDES marker): the ruler's 1-2-5 steps, ticks that are
//     integers across an 8192-texel sheet, the nearest-candidate rule with its tie-break, a rotated
//     box's extent, and guides that stay on the texture when the sheet is resized under them;
//   * **the gestures** (the page, through real pointer events): a guide pulled out of each ruler lands
//     on a whole texel and is one undo step; one let go back on its ruler is not placed; its tab moves
//     it, a click on the tab does not, and dropping it on a ruler removes it; the marquee's new
//     corners, each of a moved rectangle's four edges and a resize handle snap; a shape-tool node
//     snaps, and its handles do not; a flat decal snaps by any of its four edges or its centre, on
//     both axes, turned or not; Ctrl places freely in all three; nothing snaps while the guides are
//     hidden; and a checkpoint a guide throws away — on an undone step it replaces, or on the oldest
//     state its step pushes out of the history — is said over the guide's own line;
//   * **what is drawn**: the rulers and the guides where they should be, the view's own buttons moved
//     off the rulers, and a pixel grid that appears only past 600 % and only when asked for.
//
// Usage: node tools/t98_guides.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Guides } = new Function(sectionOf("GUIDES").replace(/^"use strict";$/m, "") + "\nreturn { Guides };")();
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-9 : e);

console.log("=== the arithmetic ===");
{
  const st = [[1, 100], [4, 20], [.25, 500], [8, 10], [100, 1], [.001, 100000]].map(([sc, want]) => [sc, want, Guides.step(sc, 56)]);
  R.is(st.every(([, w, got]) => w === got),
    `a ruler labels every 1-2-5 × 10ⁿ texels that are 56 px apart (${st.map(([sc, , got]) => sc + "×→" + got).join(", ")})`);
  const mi = [[100, 1, 10], [20, 4, 2], [10, 8, 1], [1, 100, 1], [500, .25, 50], [20, 1, 10]].map(([s, sc, want]) => [want, Guides.minor(s, sc, 6)]);
  R.is(mi.every(([w, got]) => w === got), `its unlabelled ticks are the finest tenth, fifth or half that stays 6 px apart, never under a texel (${mi.map(x => x[1]).join(", ")})`);
  const tk = Guides.ticks(-5, 23, 10), neg = Guides.ticks(-25, -5, 10), big = Guides.ticks(8000, 8192, 64);
  R.is(tk.join() === "0,10,20" && neg.join() === "-20,-10" && big.join() === "8000,8064,8128,8192",
    `ticks are the multiples inside the range, negative ones included (${tk.join()} · ${neg.join()} · ${big.join()})`);
  R.is(big.every(Number.isInteger), "and integers all the way along an 8192-texel ruler — computed as n × step, never accumulated");
  const p = Guides.pick([10, 50], [12, 49], 3), none = Guides.pick([10], [14], 3), tie = Guides.pick([10, 20], [12, 18], 3);
  R.is(p && p.d === -1 && p.line === 49 && p.i === 1, `the nearest candidate to any line wins (${JSON.stringify(p)})`);
  R.is(none === null, "and nothing snaps from outside the tolerance");
  R.is(tie && tie.i === 0 && tie.line === 12, "a tie goes to the earlier candidate, so the order a gesture offers them in is its priority");
  const sn = Guides.snap([38.6], [31.2], [40], [30], 1.5);
  R.is(near(sn.dx, 1.4, 1e-9) && near(sn.dy, -1.2, 1e-9) && sn.v === 40 && sn.h === 30,
    `a point snaps on each axis independently (dx ${sn.dx.toFixed(2)}, dy ${sn.dy.toFixed(2)})`);
  const b0 = Guides.boxOf(20, 10, 0), b90 = Guides.boxOf(20, 10, 90), b45 = Guides.boxOf(10, 10, 45);
  R.is(near(b0.hw, 10) && near(b0.hh, 5) && near(b90.hw, 5, 1e-9) && near(b90.hh, 10, 1e-9) && near(b45.hw, Math.SQRT2 * 5, 1e-9),
    `a turned box's extent is its rotated bounds (0°: ${b0.hw}×${b0.hh}, 90°: ${b90.hw.toFixed(3)}×${b90.hh.toFixed(3)}, 45°: ${b45.hw.toFixed(3)})`);
  const g = { W: 100, H: 50, v: [25], h: [10] };
  R.is(Guides.lines(g, "v", 200, 100).join() === "50" && Guides.lines(g, "h", 200, 100).join() === "20" && Guides.toRef(g, "v", 50, 200, 100) === 25,
    "a guide stays on the texture when the sheet is resized — scaled on the way out, never rewritten");
  R.is(Guides.lines(null, "v", 10, 10).length === 0, "a slot with no guides has none");
}

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP the page half: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, k = devicePixelRatio || 1, N = 256;
  var flat = function(hex, w, h){ var c = mkCanvas(w || N, h || N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height); return c; };
  // The 2-D view on its own, as wide as the window allows, with a transform every number below is
  // read through: 3 screen px a texel, the sheet's corner at (40, 40).
  $("leftbar").style.display = "none"; $("rightbar").style.display = "none";
  $("view3dwrap").style.display = "none"; $("viewSep").style.display = "none";
  v2.fit = false; resize2D();
  var s = { id: "g98", size: N, nSize: N, layers: [], missing: false };
  s.baseC = flat("#404040"); s.composite = flat("#404040");
  var s2 = { id: "g98b", size: N, nSize: N, layers: [], missing: false };
  s2.baseC = flat("#404040"); s2.composite = flat("#404040");
  App.slots = new Map([["g98", s], ["g98b", s2]]);
  App.activeSlot = s; App.activeLayer = null;
  App.paint3d = false; App.brush.mode = "color"; App.coverageOn = false; App.paintTint = null;
  App.chanView = "shaded"; App.compare = false;
  SelectUI.setOn(false); PathUI.set(false); Marquee.none();
  UndoHistory.clear();
  var view = function(sc){ v2.sc = sc * k; v2.ox = 40 * k; v2.oy = 40 * k; draw2DNow(); };
  view(3);
  out.canvas = [cnv2.width, cnv2.height];
  var rect = cnv2.getBoundingClientRect();
  var dev = function(tx, ty){ return [tx * v2.sc + v2.ox, ty * v2.sc + v2.oy]; };
  var client = function(d){ return [rect.left + d[0] / k, rect.top + d[1] / k]; };
  var pe = function(type, d, mods){
    var c = client(d);
    return new PointerEvent(type, Object.assign({ clientX: c[0], clientY: c[1], button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }, mods || {}));
  };
  // A gesture through the real handlers: press at the first point, move through the rest, let go.
  var gesture = function(pts, mods){
    cnv2.dispatchEvent(pe("pointerdown", pts[0], mods));
    for (var i = 1; i < pts.length; i++) cnv2.dispatchEvent(pe("pointermove", pts[i], mods));
    cnv2.dispatchEvent(pe("pointerup", pts[pts.length - 1], mods));
  };
  var T = function(tx, ty){ return dev(tx, ty); };            // a sheet point, in device px
  var Rb = GuidesUI.band();
  var px = function(d){ var a = ctx2d(cnv2).getImageData(Math.round(d[0]), Math.round(d[1]), 1, 1).data; return [a[0], a[1], a[2]]; };
  var steps = function(){ return UndoHistory.steps().map(function(a){ return a.desc; }); };
  var gv = function(){ return (s.guides ? s.guides.v : []).join(); };
  var gh = function(){ return (s.guides ? s.guides.h : []).join(); };

  // ---- 1. off: nothing drawn, nothing moved ----
  out.offPx = px([Rb + 5 * k, 2 * k]);
  // ---- 2. on: the rulers, and the view's buttons move off them ----
  $("btnGuides2d").click();
  draw2DNow();
  out.on = { on: GuidesUI.on, cls: $("view2dwrap").classList.contains("rulers"),
    btnTop: getComputedStyle($("view2dwrap").querySelector(".viewbtns")).top,
    corner: px([Rb / 2, Rb / 2]), rulerOffSheet: px([Rb + 5 * k, 2 * k]), rulerOnSheet: px([2 * k, 110 * k]), status: $("status").textContent };

  // ---- 3. a guide out of each ruler ----
  gesture([[Rb / 2, T(0, 90)[1]], [T(10, 90)[0], T(10, 90)[1]], T(40, 90)]);             // left ruler → vertical
  out.madeV = { v: gv(), last: steps().slice(-1)[0], status: $("status").textContent };
  gesture([[T(90, 0)[0], Rb / 2], T(90, 10), T(90, 30)]);                                 // top ruler → horizontal
  out.madeH = { h: gh() };
  var before = steps().length;
  gesture([[T(90, 0)[0], Rb / 2], [T(90, 0)[0], Rb - 2 * k]]);                            // never left its ruler
  out.notPlaced = { h: gh(), steps: steps().length - before };
  doUndo(); out.undoneH = gh(); doRedo(); out.redoneH = gh();
  gesture([[Rb / 2, T(0, 90)[1]], T(100, 90)]);                                            // a second vertical one
  draw2DNow();
  out.drawn = { v40: px([T(40, 0)[0], T(0, 120)[1]]), h30: px([T(150, 0)[0], T(0, 30)[1]]), between: px(T(70.5, 100.5)) };

  // ---- 4. the marquee ----
  SelectUI.setOn(true);
  gesture([T(38.6, 31.2), T(50, 40), T(70.3, 55.2)]);
  out.mNew = Marquee.rect() && Object.assign({}, Marquee.rect());
  Marquee.none();
  gesture([T(38.6, 31.2), T(50, 40), T(70.3, 55.2)], { ctrlKey: true });
  out.mCtrl = Marquee.rect() && Object.assign({}, Marquee.rect());
  Marquee.none();
  gesture([T(38.6, 31.2), T(70.3, 55.2)]);                                                // {40,30,30,25} again
  gesture([T(55, 40), T(70, 40), T(83.8, 40)]);                                            // moved: its right edge meets 100
  out.mMoved = Object.assign({}, Marquee.rect());
  gesture([T(70, 42.5), T(60, 42.5), T(41.1, 42.5)]);                                      // the west handle, to 40
  out.mHandle = Object.assign({}, Marquee.rect());
  // A move snaps by its top and bottom edges too — the check above only ever lands a RIGHT edge.
  // Each step is 23.6 texels, so the edge stops 1.4 short of the guide and a move that did not snap
  // would round to a different whole texel (review of 4.50 (15), 2026-09-27).
  gesture([T(70, 42.5), T(70, 30), T(70, 18.9)]);                                          // up: its bottom 31.4 → 30
  out.mUp = Object.assign({}, Marquee.rect());
  Marquee.set({ x: 40, y: 5, w: 60, h: 25 });
  gesture([T(70, 17.5), T(70, 30), T(70, 41.1)]);                                          // down: its top 28.6 → 30
  out.mDown = Object.assign({}, Marquee.rect());
  // …and by its LEFT edge: 30 wide, so only the left one comes near a guide (40) — at 60 wide both
  // sides meet 40 and 100 together and neither could be told from the other.
  Marquee.set({ x: 70, y: 60, w: 30, h: 25 });
  gesture([T(85, 72.5), T(70, 72.5), T(56.4, 72.5)]);                                      // left: its left edge 41.4 → 40
  out.mLeft = Object.assign({}, Marquee.rect());
  SelectUI.setOn(false); Marquee.none();

  // ---- 5. the shape tool ----
  PathUI.set(true);
  gesture([T(40.9, 80.4)]);                                                                // a click: a node
  gesture([T(40.9, 90)], { ctrlKey: true });                                               // Ctrl: exactly where clicked
  gesture([T(40.9, 90), T(50, 60), T(60.2, 29.1)]);                                        // node 1 dragged near y = 30
  out.path = PathUI.path.pts.map(function(n){ return [n.x, n.y]; });
  PathUI.clear(); PathUI.set(false);

  // ---- 6. a flat decal, by either edge or its centre ----
  var dec = LayerNode.of({ type: "decal", name: "d", bmp: flat("#ffffff", 20, 10), x: 150 / N, y: 80 / N,
    scale: 1, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal" });
  s.layers = [dec]; App.activeLayer = dec;
  var at = function(){ return [dec.x * N, dec.y * N]; };
  gesture([T(150, 80), T(100, 80), T(51.2, 80)]);  out.dLeft = at();                      // left edge 41.2 → 40
  gesture([T(50, 80), T(99, 80)]);                  out.dCentre = at();                    // centre 99 → 100
  dec.rot = 90;
  gesture([T(100, 80), T(44.2, 80)]);               out.dTurned = at();                    // turned: left edge 39.2 → 40
  gesture([T(45, 80), T(51.2, 80)], { ctrlKey: true }); out.dCtrl = at();
  // The right and bottom edges, the top one, and the centre across — the drags above only ever bring
  // the LEFT edge or the centre along x near a guide, and dropping the other three candidates passed
  // every check (review of 4.50 (15), 2026-09-27). The box is 20 × 10 again; the guides are x 40, 100
  // and y 30, and nothing else is within the two texels a snap reaches from.
  dec.rot = 0;
  gesture([T(51.2, 80), T(70, 50), T(88.8, 23.8)]); out.dRightBottom = at();              // right 98.8 → 100, bottom 28.8 → 30
  gesture([T(90, 25), T(80, 30), T(70, 36.1)]);     out.dTop = at();                      // top 31.1 → 30
  gesture([T(70, 35), T(70, 31.5)]);                out.dCentreY = at();                  // centre 31.5 → 30
  out.dSteps = steps().filter(function(d){ return d === "move decal"; }).length;
  s.layers = []; App.activeLayer = null;

  // ---- 7. a guide's tab moves it; a click on it does not; a ruler takes it away ----
  gesture([[T(40, 0)[0], Rb / 2], [T(42, 0)[0], Rb / 2], [T(45, 0)[0], Rb / 2]]);
  out.tabMoved = gv();
  doUndo(); out.tabUndone = gv(); doRedo();
  before = steps().length;
  // A click that jitters two device pixels — two thirds of a texel here, which rounds to the NEXT
  // texel: without the drag threshold the guide would hop on a click (sixteen texels at a quarter zoom).
  gesture([[T(45, 0)[0] + 1, Rb / 2], [T(45, 0)[0] + 3, Rb / 2]]);
  out.tabClick = { v: gv(), steps: steps().length - before };
  gesture([[T(100, 0)[0], Rb / 2], [T(60, 0)[0], Rb + 40 * k], [Rb / 2, Rb + 40 * k]]);
  out.removed = gv();
  doUndo(); out.removeUndone = gv(); doRedo();

  // ---- 8. on the sheet, where no tool wants the drag ----
  var oxWas = v2.ox;
  gesture([T(70, 30), T(70, 32), T(70, 35)]);
  out.sheetGrab = { h: gh(), panned: v2.ox !== oxWas };

  // ---- 9. a guide belongs to its texture ----
  App.activeSlot = s2; GuidesUI.syncClear();
  out.otherSlot = { lines: GuidesUI.lines(s2, "v").length, clear: $("btnGuidesClear").hidden };
  App.activeSlot = s; GuidesUI.syncClear();
  out.ownSlot = { clear: $("btnGuidesClear").hidden };
  $("btnGuidesClear").click();
  out.cleared = { v: gv(), h: gh(), last: steps().slice(-1)[0] };
  out.history = steps();                                   // before a later edit discards the undone ones
  doUndo(); out.clearUndone = { v: gv(), h: gh() };

  // ---- 9b. a checkpoint a guide throws away is said over the guide's own line ----
  // The guide's gesture sets "Guide at x …" straight after the step that discarded the checkpoint, in
  // the same task, and that used to replace the notice before it was ever painted (review of 4.50 (15),
  // 2026-09-27). The name goes on the undone "clear guides" step, and a new guide replaces that step.
  doRedo(); UndoHistory.mark("cleared"); doUndo();
  StatusLog.entries.length = 0;
  gesture([[Rb / 2, T(0, 120)[1]], T(10, 120), T(20, 120)]);
  out.lostMark = { line: $("status").textContent, cls: $("status").className, marks: UndoHistory.marks().length, v: gv(),
    logged: StatusLog.entries.map(function(x){ return x.msg; }) };
  await new Promise(function(r){ setTimeout(r, 0); });
  setStatus("the next task's own line", "ok");
  out.lostMark.after = $("status").textContent;
  // ---- 9c. and so is one the history's own limit drops as the guide goes in ----
  // The other way an edit loses a checkpoint from inside itself: its step takes the history over its
  // limit and the oldest state goes, with the name on it (core/undo.js, trimUndoStack). The count limit
  // is the one a step of no size can reach, so the guide's own step is the one over it.
  UndoHistory.clear(); UndoHistory.mark("as loaded");
  for (var pad = 0; pad < UNDO_MAX_ENTRIES; pad++) pushAction("pad " + pad, function(){}, function(){});
  StatusLog.entries.length = 0;
  gesture([[Rb / 2, T(0, 120)[1]], T(10, 120), T(30, 120)]);
  out.evictMark = { line: $("status").textContent, cls: $("status").className, marks: UndoHistory.marks().length, v: gv(),
    first: UndoHistory.steps()[0].desc, logged: StatusLog.entries.map(function(x){ return x.msg; }) };
  doUndo();                                                // that guide out again: the sections below expect what they had
  UndoHistory.clear();
  await new Promise(function(r){ setTimeout(r, 0); });

  // ---- 10. hidden guides snap nothing ----
  $("btnGuides2d").click();
  SelectUI.setOn(true);
  gesture([T(38.6, 31.2), T(70.3, 55.2)]);
  out.hiddenSnap = Object.assign({}, Marquee.rect());
  SelectUI.setOn(false); Marquee.none();
  out.offAgain = { cls: $("view2dwrap").classList.contains("rulers"), btnTop: getComputedStyle($("view2dwrap").querySelector(".viewbtns")).top };

  // ---- 11. the pixel grid: past 600 % only, and only when asked ----
  var bound = function(){ return px([11 * v2.sc + v2.ox, 7.5 * v2.sc + v2.oy]); };        // on a texel edge
  var mid = function(){ return px([11.5 * v2.sc + v2.ox, 7.5 * v2.sc + v2.oy]); };
  view(8); out.gridOff8 = bound();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Quote", ctrlKey: true, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Quote", bubbles: true }));
  view(8); out.gridOn8 = { edge: bound(), mid: mid(), on: GuidesUI.grid, status: $("status").textContent };
  view(4); out.gridOn4 = bound();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Semicolon", ctrlKey: true, bubbles: true, cancelable: true }));
  out.keyGuides = GuidesUI.on;
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Semicolon", bubbles: true }));
  GuidesUI.setGrid(false); GuidesUI.setOn(false);

  $("leftbar").style.display = ""; $("rightbar").style.display = "";
  $("view3dwrap").style.display = ""; $("viewSep").style.display = "";
  UndoHistory.clear(); App.slots = new Map(); App.activeSlot = null;
  return out;
}`;

// A window of its own size: the default headless one leaves the 2-D view 281 px tall, and a point off
// the canvas reads back as black rather than as the thing that was drawn there.
const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep"),
  chromeArgs: ["--window-size=1280,960"] });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const rgb = a => a ? `rgb(${a.join(",")})` : "none";
const rect = x => x ? `${x.x},${x.y} ${x.w}×${x.h}` : "none";
const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= 2);

console.log(`\n=== the view (${o.canvas.join(" × ")} device px) ===`);
R.is(o.canvas[0] >= 520 && o.canvas[1] >= 360, `the 2-D view is big enough for every point below (${o.canvas.join(" × ")})`);
R.is(o.on.on && o.on.cls && o.on.btnTop === "24px",
  `Guides on puts the rulers up and moves the view's own buttons off them (top ${o.on.btnTop})`);
R.is(same(o.on.rulerOffSheet, [27, 30, 37]) && same(o.offPx, [16, 18, 22]),
  `the top ruler is drawn where the view's background was (${rgb(o.offPx)} → ${rgb(o.on.rulerOffSheet)})`);
R.is(same(o.on.rulerOnSheet, [38, 43, 53]) && same(o.on.corner, [27, 30, 37]),
  `and the left one marks where the sheet is along it (${rgb(o.on.rulerOnSheet)}), under a plain corner (${rgb(o.on.corner)})`);
R.is(/drag out of a ruler/.test(o.on.status), `and it says how to use them: "${o.on.status}"`);

console.log("\n=== guides out of the rulers ===");
R.is(o.madeV.v === "40" && o.madeV.last === "add guide" && /Guide at x 40/.test(o.madeV.status),
  `a drag out of the left ruler is a vertical guide on a whole texel (x ${o.madeV.v}), one undo step: "${o.madeV.status.slice(0, 40)}…"`);
R.is(o.madeH.h === "30", `a drag out of the top ruler is a horizontal one (y ${o.madeH.h})`);
R.is(o.notPlaced.h === "30" && o.notPlaced.steps === 0, "one that never leaves its ruler is not placed, and records nothing");
R.is(o.undoneH === "" && o.redoneH === "30", "Ctrl+Z takes a guide away and redo puts it back");
R.is(o.drawn.v40[1] > 150 && o.drawn.v40[2] > 180 && o.drawn.v40[0] < 60 && o.drawn.h30[1] > 150 && same(o.drawn.between, [64, 64, 64]),
  `each is drawn on the sheet where it is (${rgb(o.drawn.v40)}, ${rgb(o.drawn.h30)}) and nowhere else (${rgb(o.drawn.between)})`);

console.log("\n=== the marquee ===");
R.is(rect(o.mNew) === "40,30 30×25", `a new rectangle starts and ends on the guides it is near (${rect(o.mNew)}; drawn from 38.6,31.2)`);
R.is(rect(o.mCtrl) === "39,31 31×24", `Ctrl places it freely, to the nearest whole texel as always (${rect(o.mCtrl)})`);
R.is(rect(o.mMoved) === "70,30 30×25", `a moved one snaps by whichever edge is near a guide and keeps its size (${rect(o.mMoved)})`);
R.is(rect(o.mHandle) === "40,30 60×25", `a handle snaps the edge it moves (${rect(o.mHandle)})`);
R.is(rect(o.mUp) === "40,5 60×25" && rect(o.mDown) === "40,30 60×25" && rect(o.mLeft) === "40,60 30×25",
  `and a move snaps by its bottom edge (${rect(o.mUp)}, not 40,6), its top one (${rect(o.mDown)}, not 40,29) and its left one (${rect(o.mLeft)}, not 41,60) — all four edges, not only the right`);

console.log("\n=== the shape tool ===");
const P = o.path;
R.is(P.length === 2 && P[0][0] === 40 && Math.abs(P[0][1] - 80.4) < 1e-9, `a node clicked near a guide lands on it (${P[0].map(v => +v.toFixed(3)).join(", ")}), and off the other axis's guides it stays where it was put`);
R.is(P[1][0] !== 40 && Math.abs(P[1][0] - 60.2) < 1e-9 && P[1][1] === 30,
  `a node dragged near a guide lands on it (${P[1].map(v => +v.toFixed(3)).join(", ")})`);

console.log("\n=== a flat decal ===");
const nx = (a, x, y) => Math.abs(a[0] - x) < 1e-6 && Math.abs(a[1] - y) < 1e-6;
R.is(nx(o.dLeft, 50, 80), `by its left edge — centre ${o.dLeft.map(v => +v.toFixed(3)).join(", ")}, so the edge is on 40`);
R.is(nx(o.dCentre, 100, 80), `by its centre (${o.dCentre.map(v => +v.toFixed(3)).join(", ")})`);
R.is(nx(o.dTurned, 45, 80), `turned a quarter, by the edge it has now (${o.dTurned.map(v => +v.toFixed(3)).join(", ")})`);
R.is(nx(o.dCtrl, 51.2, 80), `and freely with Ctrl (${o.dCtrl.map(v => +v.toFixed(3)).join(", ")})`);
R.is(nx(o.dRightBottom, 90, 25), `by its right edge and its bottom one at once — centre ${o.dRightBottom.map(v => +v.toFixed(3)).join(", ")}, so the edges are on 100 and 30 (not 88.8, 23.8)`);
R.is(nx(o.dTop, 70, 35), `by its top edge (${o.dTop.map(v => +v.toFixed(3)).join(", ")}, not 70, 36.1)`);
R.is(nx(o.dCentreY, 70, 30), `and by its centre across (${o.dCentreY.map(v => +v.toFixed(3)).join(", ")}, not 70, 31.5)`);
R.is(o.dSteps === 7, `each drag is one "move decal" step (${o.dSteps})`);

console.log("\n=== moving and removing a guide ===");
R.is(o.tabMoved === "45,100" && o.tabUndone === "40,100", `its tab on the ruler moves it (${o.tabMoved}), and that is a step (${o.tabUndone} after undo)`);
R.is(o.tabClick.v === "45,100" && o.tabClick.steps === 0, "a click on a tab that jitters a couple of pixels moves nothing and records nothing");
R.is(o.removed === "45" && o.removeUndone === "45,100", `dropped onto a ruler it is removed (${o.removed}), and undo brings it back`);
R.is(o.sheetGrab.h === "35" && !o.sheetGrab.panned, `with no tool on, a drag that starts on a guide moves it rather than panning (y ${o.sheetGrab.h})`);

console.log("\n=== per texture ===");
R.is(o.otherSlot.lines === 0 && o.otherSlot.clear && !o.ownSlot.clear,
  "another texture has its own guides — none here — and Clear guides is only offered where there are some");
R.is(o.cleared.v === "" && o.cleared.h === "" && o.cleared.last === "clear guides" && o.clearUndone.v === "45" && o.clearUndone.h === "35",
  "Clear guides takes them all in one step, and undo brings them all back");

console.log("\n=== a checkpoint a guide throws away ===");
const LM = o.lostMark;
R.is(LM.marks === 0 && LM.v === "45,20", `a guide pulled out over an undone, named step replaces it and its name (${LM.marks} checkpoints left; guides ${LM.v})`);
R.is(/^Checkpoint “cleared” was on an undone step/.test(LM.line) && LM.cls === "err",
  `and the line says so over the guide's own message, which it used to lose to: "${LM.line}" [${LM.cls}]`);
R.is(/^Guide at x 20/.test(LM.logged[0] || "") && /“cleared”/.test(LM.logged[1] || ""),
  "the guide's own message is still in Messages, after the notice");
R.is(LM.after === "the next task's own line", "and the line is held for that task only — the next message replaces it as usual");
const EM = o.evictMark;
R.is(EM.marks === 0 && EM.first === "pad 1" && EM.v.split(",").includes("30"),
  `a guide that takes the history over its limit drops the oldest state, and the name on it (${EM.marks} checkpoints left; oldest step now "${EM.first}")`);
R.is(/^Checkpoint “as loaded” dropped with the oldest steps — the history keeps at most 250 steps.$/.test(EM.line) && EM.cls === "err" && /^Guide at x 30/.test(EM.logged[0] || ""),
  `and that is said over the guide's line too, without sending anyone to raise a memory limit a count is not: "${EM.line}" [${EM.cls}], the guide's own in Messages`);

console.log("\n=== hidden guides ===");
R.is(rect(o.hiddenSnap) === "39,31 31×24" && !o.offAgain.cls && o.offAgain.btnTop === "6px",
  `hidden, they snap nothing (${rect(o.hiddenSnap)}) and the view's buttons are back where they were`);

console.log("\n=== the pixel grid ===");
console.log(`   texel edge at 800 %: off ${rgb(o.gridOff8)}, on ${rgb(o.gridOn8.edge)} · mid-texel ${rgb(o.gridOn8.mid)} · edge at 400 % ${rgb(o.gridOn4)}`);
R.is(o.gridOn8.on && same(o.gridOff8, [64, 64, 64]) && o.gridOn8.edge[0] > 72, `Ctrl+' draws every texel edge at 800 % (${rgb(o.gridOn8.edge)})`);
R.is(same(o.gridOn8.mid, [64, 64, 64]), "and only the edges — a texel's own pixels are untouched");
R.is(same(o.gridOn4, [64, 64, 64]), "below 600 % it draws nothing, however it is set");
R.is(/600 %/.test(o.gridOn8.status) || /every texel edge/.test(o.gridOn8.status), `and turning it on says when it shows: "${o.gridOn8.status}"`);
R.is(o.keyGuides === true, "Ctrl+; is the guides' key");

console.log("\n=== the History list ===");
const H = o.history.filter(d => /guide/.test(d));
R.is(["add guide", "move guide", "remove guide", "clear guides"].every(d => H.includes(d)),
  `every guide change is a step with its own name (${[...new Set(H)].join(", ")})`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
