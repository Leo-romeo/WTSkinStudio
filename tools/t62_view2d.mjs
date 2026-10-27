// What the 2-D view actually DRAWS (ROADMAP 2.4's oracle for draw2DNow).
//
// WHY THIS EXISTS. `draw2DNow` is 134 lines and the worst left on 2.4's list, and until now nothing
// in the suite looked at a single pixel it produced. `t59` drives the marquee through it, `t47`
// times it and `t48` checks the pan arithmetic — all three would pass on a renderer that had stopped
// drawing the decal outline, or the mask tint, or the coverage blend, or that had started showing
// the albedo when a smoothness view was asked for (which is a bug this view has actually had:
// ROADMAP 3.17). A panel gets `t44` because a panel is markup; a canvas gets this, which is the same
// idea one layer down — render from a synthetic state and hash the bytes.
//
// **The two halves do different jobs, and neither is a stored golden.** A golden hash of a canvas is
// a hostage to the browser's antialiasing, so there is none: the hashes are compared to EACH OTHER,
// and what they assert is that the seven states are seven different pictures — a branch that renders
// the same as another branch is a branch doing nothing, which is the failure a suite of hashes hides
// best. What each picture actually IS comes from named texels: the mask tint is red where the mask
// hides, Compare shows the imported sheet and not the composite, the decal outline is the accent
// colour at the decal's own corner. The slot below carries a different colour in every place the
// renderer can read from, so "it drew the wrong one" is a wrong colour and not a wrong number.
//
// The states are the ones with a branch behind them, one each:
//
//   plain        the ordinary path — composite blitted through the visible window
//   compare      holding ` — the IMPORTED sheet, on whichever channel is in hand (3.17)
//   channel      an explicit channel view, which wins over the brush's own channel
//   coverage     the camo/paint blend, which is the longest branch in the function
//   maskEdit     the red "this is hidden" tint the Mask brush puts up
//   decal        the selected decal's outline and its mirrored copy's dashed one
//   ring         the brush footprint, in texture pixels
//
// Usage: node tools/t62_view2d.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var out = {}, N = 128;
  var flat = function(hex, w, h){ var c = mkCanvas(w || N, h || N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height); return c; };
  var slotWas = App.activeSlot, layerWas = App.activeLayer, cmpWas = App.compare, viewWas = App.chanView;
  var paintWas = App.paint3d, modeWas = App.brush.mode, covWas = App.coverageOn, tintWas = App.paintTint;

  // A slot with a DIFFERENT colour in every place the renderer can read from, so "it drew the wrong
  // one" is a different colour rather than a different hash.
  var s = { id: "v2t", size: N, nSize: N, layers: [], missing: false };
  s.baseC = flat("#204080");                 // the imported albedo — what Compare shows
  s.composite = flat("#c02020");             // the painted result — what the ordinary path shows
  s.smooth = flat("#303030"); s.metal = flat("#101010"); s.normal = flat("#8080ff");
  App.slots = new Map([["v2t", s]]);
  App.activeSlot = s; App.activeLayer = null;
  App.compare = false; App.chanView = "shaded"; App.paint3d = false;
  App.coverageOn = false; App.paintTint = null;
  App.brush.mode = "color";
  SelectUI.setOn(false);
  Marquee.none();

  // The view, pinned: the canvas is whatever size the pane happens to be, so every number below is
  // read through the same transform the renderer uses rather than assumed.
  cnv2.width = 200; cnv2.height = 150;
  v2.sc = 1; v2.ox = 10; v2.oy = 10; v2.fit = false; v2.uvOn = false; v2.cursor = null;
  var sheetPx = function(tx, ty){
    var d = ctx2d(cnv2).getImageData(Math.round(v2.ox + tx * v2.sc), Math.round(v2.oy + ty * v2.sc), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  var hash = function(){
    var d = ctx2d(cnv2).getImageData(0, 0, cnv2.width, cnv2.height).data, h = 0x811c9dc5;
    for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  };
  var shot = function(name, probe){
    draw2DNow();
    var o = { hash: hash() };
    if (probe) for (var k in probe) o[k] = probe[k]();
    out[name] = o;
  };

  // ---- 1. the ordinary path ----
  shot("plain", { mid: function(){ return sheetPx(60, 60); },
                  outside: function(){ return ctx2d(cnv2).getImageData(2, 2, 1, 1).data[0]; } });

  // ---- 2. Compare shows the IMPORTED sheet, on the channel in hand (3.17) ----
  App.compare = true;
  shot("compare", { mid: function(){ return sheetPx(60, 60); } });
  App.compare = false;

  // ---- 3. an explicit channel view wins over the brush's channel ----
  App.chanView = "smooth";
  shot("channel", { mid: function(){ return sheetPx(60, 60); } });
  App.chanView = "shaded";

  // ---- 4. the coverage blend: bare sheet where the paint mask is dark ----
  // The longest branch in the function, and the one whose absence looks like "the tank is rusty".
  s.stockC = flat("#20a020");                                     // the bare material
  s.chanC = { wear: (function(){ var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "#000"; g.fillRect(0, 0, N, N);
    g.fillStyle = "#fff"; g.fillRect(0, 0, N, N / 2); return c; })() };   // top half painted
  s.layers = [LayerNode.of({ type: "paint", chan: "wear", name: "wear", canvas: s.chanC.wear,
                             visible: true, opacity: 1, blend: "normal" })];
  s.cEdited = true;
  // slotCamoColor is what turns this branch on, and it needs a material bound to this slot with a
  // camouflage stem and a colour for it — the same three facts a real ground vehicle brings.
  var matPaintWas = App.matPaint, matSlotWas = App.matSlot, colWas = App.paintColor;
  App.matPaint = new Map([["hull_mat", "camo_stem"]]);
  App.matSlot = new Map([["hull_mat", "v2t"]]);
  App.paintColor = new Map([["camo_stem", [32, 160, 32]]]);
  App.coverageOn = true; App.paintTint = { c: "#c02020" };
  shot("coverage", { painted: function(){ return sheetPx(60, 20); },
                     bare: function(){ return sheetPx(60, 100); } });
  App.coverageOn = false; App.paintTint = null;
  App.matPaint = matPaintWas; App.matSlot = matSlotWas; App.paintColor = colWas;
  s.layers = []; s.chanC = null; s._cov = null; delete s.stockC; s.cEdited = false;

  // ---- 5. the Mask brush's red "this is hidden" tint ----
  var masked = LayerNode.of({ type: "paint", name: "masked", canvas: flat("#ffffff"),
    mask: (function(){ var c = mkCanvas(N, N), g = ctx2d(c);
      g.fillStyle = "#fff"; g.fillRect(0, 0, N, N / 2); return c; })(),   // top shows, bottom hidden
    visible: true, opacity: 1, blend: "normal" });
  s.layers = [masked];
  App.activeLayer = masked;
  App.brush.mode = "mask";
  shot("maskEdit", { shown: function(){ return sheetPx(60, 20); },
                     hidden: function(){ return sheetPx(60, 100); },
                     plain: function(){ return out.plain.mid; } });
  App.brush.mode = "color";
  s.layers = [];

  // ---- 6. the selected decal's outline, and the dashed one on its mirrored copy ----
  var dec = LayerNode.of({ type: "decal", name: "d", bmp: flat("#ffffff", 40, 40),
    x: .25, y: .25, scale: 1, rot: 0, flip: false, sym: { x: .75, y: .25 },
    visible: true, opacity: 1, blend: "normal" });
  s.layers = [dec];
  App.activeLayer = dec;
  // The outline is stroked at the decal's own corner: x = .25 * 128 - 20 = 12, y likewise.
  // The copy's outline is DASHED, so a single texel of it can fall in a gap. Scan its left edge
  // instead and count how much accent blue is on it — that is the fact, and a probe that can miss
  // is a probe that fails for the wrong reason.
  var blueOn = function(tx, y0, y1){
    var n = 0;
    for (var y = y0; y <= y1; y++) { var p = sheetPx(tx, y); if (p[2] > 150 && p[2] > p[0] + 40) n++; }
    return n;
  };
  shot("decal", { corner: function(){ return sheetPx(12, 32); },
                  symEdge: function(){ return blueOn(76, 12, 52); },
                  ownEdge: function(){ return blueOn(12, 12, 52); },
                  away: function(){ return sheetPx(60, 100); } });
  s.layers = []; App.activeLayer = null;

  // ---- 7. the brush ring, in texture pixels ----
  App.paint3d = true;
  App.brush.size = 40; App.brush.hardness = .5;
  v2.cursor = { x: 60, y: 60 };
  shot("ring", { onRim: function(){ return sheetPx(60, 40); },
                 inside: function(){ return sheetPx(60, 58); } });
  App.paint3d = false; v2.cursor = null;

  // Every state has to be its own picture, or a hash that never moves proves nothing.
  var keys = ["plain", "compare", "channel", "coverage", "maskEdit", "decal", "ring"];
  var seen = {}, dupes = [];
  for (var i = 0; i < keys.length; i++) {
    var h = out[keys[i]].hash;
    if (seen[h]) dupes.push(seen[h] + "=" + keys[i]);
    seen[h] = keys[i];
  }
  out.distinct = dupes;

  App.slots = new Map();
  App.activeSlot = slotWas; App.activeLayer = layerWas; App.compare = cmpWas; App.chanView = viewWas;
  App.paint3d = paintWas; App.brush.mode = modeWas; App.coverageOn = covWas; App.paintTint = tintWas;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const rgb = a => a ? `rgb(${a[0]},${a[1]},${a[2]})` : "none";

console.log("=== the ordinary path ===");
console.log(`   middle ${rgb(o.plain.mid)}, outside the sheet ${o.plain.outside}`);
R.is(o.plain.mid[0] > 150 && o.plain.mid[1] < 80,
  `the composite is what is drawn (${rgb(o.plain.mid)}) — the painted sheet, not the imported one`);
R.is(o.plain.outside < 40, `and the area outside the sheet is the view's own background (${o.plain.outside}), not a stale frame`);

console.log("\n=== Compare shows the imported sheet (3.17) ===");
console.log(`   ${rgb(o.compare.mid)} against the composite's ${rgb(o.plain.mid)}`);
R.is(o.compare.mid[2] > 100 && o.compare.mid[0] < 80,
  `holding Compare swaps to the IMPORTED albedo (${rgb(o.compare.mid)}) — the two sheets are deliberately different colours, so drawing the wrong one is a wrong colour rather than a wrong hash`);

console.log("\n=== an explicit channel view wins over the brush's channel ===");
R.is(o.channel.mid[0] === o.channel.mid[1] && o.channel.mid[1] === o.channel.mid[2],
  `asking for the smoothness view draws a grey sheet (${rgb(o.channel.mid)}) — the albedo is red here, so "it ignored the view" is visible`);

console.log("\n=== the coverage blend ===");
console.log(`   painted half ${rgb(o.coverage.painted)}, bare half ${rgb(o.coverage.bare)}`);
R.is(o.coverage.painted[0] > 120 && o.coverage.painted[1] < 90,
  `where the paint mask is light the paint shows (${rgb(o.coverage.painted)})`);
R.is(o.coverage.bare[1] > 120 && o.coverage.bare[0] < 90,
  `and where it is dark the vehicle's own bare sheet shows through (${rgb(o.coverage.bare)}) — this is the branch whose absence makes a freshly loaded tank look like rusty metal`);

console.log("\n=== the Mask brush's tint ===");
console.log(`   shown ${rgb(o.maskEdit.shown)}, hidden ${rgb(o.maskEdit.hidden)}`);
R.is(o.maskEdit.hidden[0] > o.maskEdit.hidden[1] + 30,
  `the hidden half is tinted red (${rgb(o.maskEdit.hidden)}) — that tint is the only thing on screen that says a mask is in force while you paint it`);
R.is(o.maskEdit.hidden[0] > o.maskEdit.shown[0] && o.maskEdit.hidden[1] > o.maskEdit.shown[1] &&
     rgb(o.maskEdit.shown) === rgb(o.maskEdit.plain),
  `and the shown half is exactly what it would be with no mask brush up (${rgb(o.maskEdit.shown)}) — the tint is added, not a different picture`);

console.log("\n=== the decal outline, and its mirrored copy's ===");
console.log(`   corner ${rgb(o.decal.corner)}, edges lit: own ${o.decal.ownEdge}, mirrored ${o.decal.symEdge}, away ${rgb(o.decal.away)}`);
R.is(o.decal.corner[2] > 150 && o.decal.corner[2] > o.decal.corner[0] + 40,
  `the selected decal is outlined in the accent blue at its own corner (${rgb(o.decal.corner)})`);
R.is(o.decal.symEdge > 3 && o.decal.symEdge < o.decal.ownEdge,
  `and the mirrored copy gets one too, DASHED (${o.decal.symEdge} lit texels down its left edge against ${o.decal.ownEdge} down the original's solid one) — which is what makes it read as the copy rather than as a second decal`);
R.is(o.decal.away[2] < 120, `while the rest of the sheet is untouched (${rgb(o.decal.away)})`);

console.log("\n=== the brush ring, in texture pixels ===");
console.log(`   on the rim ${rgb(o.ring.onRim)}, inside ${rgb(o.ring.inside)}`);
R.is(o.ring.onRim[2] > o.ring.onRim[0] + 40 && o.ring.onRim[1] > o.ring.onRim[0],
  `the footprint is drawn at radius size/2 in TEXTURE pixels (${rgb(o.ring.onRim)}) — the unit the size slider is in, so it is the same circle the model shows`);
R.is(o.ring.inside[2] < 200, `and it is an outline rather than a disc (${rgb(o.ring.inside)})`);

console.log("\n=== every state is its own picture ===");
R.is(o.distinct.length === 0,
  o.distinct.length ? "two states render identically: " + o.distinct.join(", ") + " — a hash that never moves proves nothing"
    : "all seven states hash differently, so none of the branches above is a no-op");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
