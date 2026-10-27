// The Retouch brush: blur, sharpen, smudge, dodge and burn under the brush (ROADMAP 4.50 (11)).
//
// WHY THIS EXISTS. Each of the five reads the sheet under the brush and lays a changed copy of it, and
// each fails in a way that still paints: a blur that reads its own output smears further every frame
// the stroke lingers; one cut at its dab's edge leaves a grid of seams where dabs meet; a smudge whose
// carried patch is never carried is a blur; a dodge that moves black and white moves the whole sheet.
// So, against exact answers:
//
//   Node, on the pure `/*==EFFECTS==*/` section:
//   * a stroke's settings are held to their ranges, and blur's radius follows Strength × Size / 8;
//   * blur and sharpen run as the effect kinds' own records; dodge and burn follow their formula and
//     leave black and white where they are at Midtones; a smudge texel is the carried one laid at
//     Strength, source-over, so a transparent one lends nothing.
//
//   Headless Chrome, on the real stroke path (beginStroke / stampAt / endStroke):
//   * a blur stroke over a checker softens it and nothing off the stroke, and one undo takes it off;
//   * passing back over the same line changes no texel the first pass covered — it reads the sheet as
//     it was when the stroke began, not its own output;
//   * a blur of radius r over a dab-sized patch is the blur effect's result there: no seam where dabs
//     meet;
//   * sharpen raises contrast at an edge, smudge drags red into the blue it is pulled across, dodge
//     lightens the midtones and burn darkens the shadows;
//   * the blurred copy is made once per 256² tile however often the stroke passes; smudge keeps
//     carrying under size jitter and drags no black in from off the sheet; Fill is refused; Tones
//     follows the tool's own kind after a round trip (the review of 2026-10-23 found all four);
//   * the tool is colour-only and refuses a mask; its kind, strength and tones are the tool's, and the
//     panel shows Tones only for dodge and burn.
//
// Usage: node tools/t155_retouch.mjs [--keep] [--chrome <path>]
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
const { Effect } = new Function(sectionOf("GRADIENT").replace(/^"use strict";$/m, "") + "\n" +
  sectionOf("EFFECTS").replace(/^"use strict";$/m, "") + "\nreturn { Gradient, Effect };")();
const RT = Effect.retouch;
const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };

console.log("=== a stroke's settings ===");
{
  const a = RT.of({ retouch: "nope", strength: 9, range: "x", size: 64 }), b = RT.of({ retouch: "blur", strength: .5, size: 64 }), c = RT.of({ retouch: "sharpen", strength: .25, size: 64 });
  R.is(a.kind === "blur" && a.s === 1 && a.range === "mids" && a.radius === 8, `an unknown kind is Blur, a strength over 1 is 1, an unknown range Midtones (${a.kind}, ${a.s}, ${a.range}); at Size 64 and full strength the blur reaches 8`);
  R.is(b.radius === 4 && c.radius === 2 && c.amount === 50 && RT.of({ retouch: "blur", strength: 1, size: 400 }).radius === 32,
    `blur's radius is Strength × Size / 8 (${b.radius} at 50 %), at most 32; sharpen is radius 2 at Strength × 200 % (${c.amount} %)`);
}

console.log("\n=== the arithmetic ===");
{
  R.is(JSON.stringify(RT.fx(RT.of({ retouch: "blur", strength: .5, size: 64 }))) === JSON.stringify({ type: "blur", radius: 4, amount: 0 }) &&
       RT.fx(RT.of({ retouch: "sharpen", strength: .5, size: 64 })).amount === 100 && RT.fx(RT.of({ retouch: "dodge" })) === null && RT.fx(RT.of({ retouch: "smudge" })) === null,
    "blur and sharpen run as the effect kinds' own records; dodge, burn and smudge as none");
  const S = 32, ramp = img(S, 1, x => { const t = Math.round(x * 255 / (S - 1)); return [t, t, t, 255]; });
  const dg = RT.tone(RT.of({ retouch: "dodge", strength: 1, range: "mids" }), ramp.slice()), bn = RT.tone(RT.of({ retouch: "burn", strength: .5, range: "shadows" }), ramp.slice());
  let worst = 0;
  for (let x = 0; x < S; x++) {
    const v0 = ramp[x * 4], l = v0 / 255;
    worst = Math.max(worst, Math.abs(dg[x * 4] - Math.round(v0 + (255 - v0) * 4 * l * (1 - l))), Math.abs(bn[x * 4] - Math.round(v0 * (1 - .5 * (1 - l) * (1 - l)))));
  }
  R.is(worst <= 1 && dg[3] === 255, `dodge (midtones, 100 %) and burn (shadows, 50 %) follow their formula along a ramp, alpha left alone (worst ${worst})`);
  const bw = img(2, 1, x => x ? [255, 255, 255, 255] : [0, 0, 0, 255]), bwd = RT.tone(RT.of({ retouch: "dodge", strength: 1, range: "mids" }), bw);
  R.is(bwd[0] === 0 && bwd[4] === 255, "at Midtones black and white stay where they are");
  const red = RT.smudge(.75, [255, 0, 0, 255], [0, 0, 255, 255]), none = RT.smudge(.75, [0, 0, 0, 0], [0, 0, 255, 255]);
  R.is(Math.round(red[0]) === 191 && Math.round(red[2]) === 64 && red[3] === 255 && none.join() === "0,0,255,255",
    `smudge lays the carried red at 75 % over blue (${red.slice(0, 3).map(Math.round)}), and a carried transparent texel — off the sheet — lends nothing, no black`);
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 384, seq = 0;
  var data = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  // The base: a 4-texel checker in rows 0..96, a red | blue split in rows 128..224, a grey ramp in
  // rows 256..320.
  var base = function(){
    var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "#808080"; g.fillRect(0, 0, N, N);
    for (var y = 0; y < 96; y += 4) for (var x = 0; x < N; x += 4) { g.fillStyle = ((x + y) >> 2) & 1 ? "#e0e0e0" : "#202020"; g.fillRect(x, y, 4, 4); }
    g.fillStyle = "#ff0000"; g.fillRect(0, 128, N / 2, 96); g.fillStyle = "#0000ff"; g.fillRect(N / 2, 128, N / 2, 96);
    var gr = g.createLinearGradient(0, 0, N, 0); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#fff"); g.fillStyle = gr; g.fillRect(0, 256, N, 64);
    return c;
  };
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var fresh = function(){
    var s = { id: "t149_" + (++seq), size: N, nSize: N, layers: [], missing: false, baseC: base(), composite: base(),
              smooth: flat("#303030"), metal: flat("#606060"), normal: flat("#8080ff") };
    App.slots.set(s.id, s); App.activeSlot = s; App.activeLayer = null; flushComposites(); return s;
  };
  var was = { slot: App.activeSlot, layer: App.activeLayer, mode: App.brush.mode, tools: JSON.stringify(App.brushTools || {}),
              keep: ["size", "opacity", "hardness", "spacing", "flow", "tip", "retouch", "strength", "range", "sizeJit", "scatter", "angleJit", "flowJit"].map(function(k){ return [k, App.brush[k]]; }) };
  var set = function(o){
    applyBrushMode("retouch");
    Object.assign(App.brush, { size: 24, opacity: 1, hardness: 1, spacing: .1, flow: 1, tip: "round", sizeJit: 0, scatter: 0, angleJit: 0, flowJit: 0,
      retouch: "blur", strength: .5, range: "mids" }, o || {});
    brushStamp._key = null;
  };
  var comp = function(s){ flushComposites(); return s.composite; };
  var line = function(pts){ beginStroke(false, false); pts.forEach(function(p){ stampAt(p[0], p[1], 0, null); }); endStroke(); };
  var spread = function(c, y0, y1, x0, x1){ var d = ctx2d(c).getImageData(x0, y0, x1 - x0, y1 - y0).data, lo = 255, hi = 0; for (var i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } return hi - lo; };
  try {
  // ---- 1. blur softens the checker under the stroke, nothing else, and undo takes it off ----
  var s = fresh(); set({ size: 32, strength: 1 });             // radius 4
  var before = data(comp(s)).slice();
  line([[60, 48], [320, 48]]);
  var after = data(comp(s));
  var offStroke = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) { if (y >= 28 && y <= 68 && x >= 40 && x <= 340) continue; var k = (y * N + x) * 4; if (after[k] !== before[k] || after[k + 1] !== before[k + 1] || after[k + 2] !== before[k + 2]) offStroke++; }
  out.blur = { before: spread(s.baseC, 44, 52, 150, 230), after: spread(s.composite, 44, 52, 150, 230), offStroke: offStroke, layers: s.layers.length };
  // the blur effect's result at the middle of the stroke: no seam where dabs meet
  var ref = mkCanvas(N, N); ctx2d(ref).drawImage(s.baseC, 0, 0);
  var rd = ctx2d(ref).getImageData(0, 0, N, N), rb = Effect.spatial({ type: "blur", radius: 4 }, rd.data, N, N, 0, 0, false);
  var worst = 0;
  for (var y2 = 44; y2 <= 52; y2++) for (var x2 = 100; x2 <= 300; x2++) for (var c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(after[(y2 * N + x2) * 4 + c] - rb[(y2 * N + x2) * 4 + c]));
  out.blur.vsEffect = worst;
  doUndo(true);
  var undone = data(comp(s)), back = 0; for (var i = 0; i < undone.length; i++) if (undone[i] !== before[i]) back++;
  out.blur.undo = back;

  // ---- 2. back over the same line changes nothing the first pass covered ----
  var s1 = fresh(); set({ size: 32, strength: 1 }); line([[60, 48], [320, 48]]);
  var once = data(comp(s1)).slice();
  var s2 = fresh(); set({ size: 32, strength: 1 }); line([[60, 48], [320, 48], [60, 48], [320, 48]]);
  var thrice = data(comp(s2)), diff = 0;
  for (var y3 = 40; y3 <= 56; y3++) for (var x3 = 80; x3 <= 300; x3++) for (var c3 = 0; c3 < 3; c3++) if (once[(y3 * N + x3) * 4 + c3] !== thrice[(y3 * N + x3) * 4 + c3]) diff++;
  out.again = diff;

  // ---- 3. sharpen, smudge, dodge, burn ----
  var s3 = fresh(); set({ retouch: "sharpen", size: 32, strength: 1 }); line([[N / 2, 140], [N / 2, 210]]);
  out.sharpen = { left: px(comp(s3), N / 2 - 1, 176), right: px(s3.composite, N / 2, 176), far: px(s3.composite, 40, 176) };
  var s4 = fresh(); set({ retouch: "smudge", size: 24, strength: .9 }); line([[N / 2 - 30, 176], [N / 2 + 60, 176]]);
  out.smudge = { into: px(comp(s4), N / 2 + 30, 176), beyond: px(s4.composite, N / 2 + 100, 176) };
  var s5 = fresh(); set({ retouch: "dodge", range: "mids", size: 40, strength: .5 }); line([[2, 288], [360, 288]]);
  var s6 = fresh(); set({ retouch: "burn", range: "shadows", size: 40, strength: 1 }); line([[20, 288], [360, 288]]);
  var at = function(sl, x){ return px(comp(sl), x, 288)[0]; }, orig = function(x){ return px(s5.baseC, x, 288)[0]; };
  out.tone = { mid: [orig(N / 2), at(s5, N / 2)], dark: [orig(4), at(s5, 4)], darkBurn: [orig(70), at(s6, 70)], lightBurn: [orig(330), at(s6, 330)] };

  // ---- 3b. the processed copy is made once per tile, and a blur stroke's cost ----
  var s7 = fresh(); set({ size: 200, strength: 1 });            // radius 25
  var made = 0, pr0 = Clone.procRect;
  Clone.procRect = function(){ made++; return pr0.apply(Clone, arguments); };
  var t0 = performance.now();
  try { line([[40, 48], [340, 48], [40, 48]]); } finally { Clone.procRect = pr0; }
  out.tiles = { made: made, ms: performance.now() - t0 };
  // ---- 3c. smudge under size jitter keeps carrying; from off the sheet it drags no black ----
  var s8 = fresh(); set({ retouch: "smudge", size: 24, strength: .9, sizeJit: .5 }); line([[N / 2 - 30, 176], [N / 2 + 60, 176]]);
  out.jit = px(comp(s8), N / 2 + 20, 176);
  var s9 = fresh(); set({ retouch: "smudge", size: 24, strength: .5 }); line([[-20, 176], [60, 176]]);
  out.edge = px(comp(s9), 14, 176);
  // ---- 3d. a Fill with Retouch in hand is refused, before any layer is made ----
  var s10 = fresh(); set();
  PathUI.path = { pts: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }], closed: true };
  PathUI.frame = null;
  PathUI.fill();
  out.fill = { said: document.getElementById("status").textContent, layers: s10.layers.length };
  PathUI.path = null;
  // ---- 3e. Tones follow the tool's own kind after a round trip through another tool ----
  set({ retouch: "dodge" }); BrushTools.put(BrushTools.field("retouch"), "dodge"); BrushPanel.syncRetouch();
  applyBrushMode("color"); applyBrushMode("retouch");
  out.trip = { kind: App.brush.retouch, tones: document.getElementById("rowRange").style.display !== "none" };

  // ---- 4. the tool's rules and its panel ----
  out.rules = { mask: Tool.resolve("retouch", "color", "mask").err || null, smooth: Tool.resolve("retouch", "smooth", "content").err || null,
                ok: Tool.resolve("retouch", "color", "content").mode };
  set({ retouch: "dodge" }); BrushTools.put(BrushTools.field("retouch"), "dodge"); BrushPanel.syncRetouch();
  out.panel = { rows: ["rowRetouch", "rowStrength", "rowRange"].map(function(id){ return document.getElementById(id).style.display !== "none"; }) };
  BrushTools.put(BrushTools.field("retouch"), "smudge"); BrushPanel.syncRetouch();
  out.panel.smudgeRange = document.getElementById("rowRange").style.display !== "none";
  applyBrushMode("color");
  out.panel.hidden = ["rowRetouch", "rowStrength", "rowRange"].every(function(id){ return document.getElementById(id).style.display === "none"; });
  applyBrushMode("retouch");
  out.panel.kept = App.brush.retouch;
  } catch (e) { out.__threw = String(e && e.stack || e); }
  finally {
    applyBrushMode(was.mode);
    was.keep.forEach(function(kv){ App.brush[kv[0]] = kv[1]; });
    App.brushTools = JSON.parse(was.tools);
    App.activeSlot = was.slot; App.activeLayer = was.layer;
    for (var q = 1; q <= seq; q++) App.slots.delete("t149_" + q);
    App.undoStack.length = 0; App.redoStack.length = 0;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page: a blur stroke ===");
R.is(r.blur.before > 150 && r.blur.after < 60 && r.blur.layers === 1, `a blur stroke softens the checker under it (spread ${r.blur.before} → ${r.blur.after}), on a layer it made`);
R.is(r.blur.offStroke === 0, `and changes no texel off the stroke (${r.blur.offStroke})`);
R.is(r.blur.vsEffect <= 1, `along the stroke it is the blur effect's result there, to a level — no seam where dabs meet (worst ${r.blur.vsEffect})`);
R.is(r.blur.undo === 0, `one undo takes it off, to the byte (${r.blur.undo} values differ)`);
R.is(r.again === 0, `going back over the line twice more changes nothing the first pass covered (${r.again} values differ) — it reads the sheet as the stroke began`);

console.log("\n=== sharpen, smudge, dodge, burn ===");
R.is(r.sharpen.left[0] > 250 && r.sharpen.left[2] === 0 && r.sharpen.right[2] > 250 && r.sharpen.right[0] === 0 && r.sharpen.far.join() === "255,0,0,255",
  `sharpen keeps red and blue apart at their edge (${r.sharpen.left.slice(0, 3)} | ${r.sharpen.right.slice(0, 3)}) and leaves the flat red as it was`);
// At 90 % a dab keeps 0.9 of what it carries, and at Spacing 10 % of 24 a dab is 2.4 texels on, so
// 30 texels into the blue about a quarter of the red is left: a smudge fades with distance.
R.is(r.smudge.into[0] > 30 && r.smudge.into[2] < 230 && r.smudge.beyond.join() === "0,0,255,255", `smudge drags red into the blue it is pulled across (${r.smudge.into.slice(0, 3)} 30 texels in), and not past the stroke`);
const T = r.tone;
R.is(T.mid[1] > T.mid[0] + 40 && (T.dark[1] - T.dark[0]) * 8 < T.mid[1] - T.mid[0], `dodge at Midtones, 50 %, lightens the middle grey (${T.mid[0]} → ${T.mid[1]}) and moves the near-black less than an eighth as far (${T.dark[0]} → ${T.dark[1]})`);
R.is(T.darkBurn[1] < T.darkBurn[0] - 10 && Math.abs(T.lightBurn[1] - T.lightBurn[0]) <= 5, `burn at Shadows darkens the darks (${T.darkBurn[0]} → ${T.darkBurn[1]}) and barely the lights (${T.lightBurn[0]} → ${T.lightBurn[1]})`);

console.log("\n=== what the review found ===");
R.is(r.tiles.made > 0 && r.tiles.made <= 6, `a 200-texel blur stroke there and back makes each 256² tile of the blurred copy once (${r.tiles.made} made, ${Math.round(r.tiles.ms)} ms for the stroke here, software GL)`);
R.is(r.jit[0] > 30 && r.jit[2] < 230, `with size jitter smudge keeps carrying red into the blue (${r.jit.slice(0, 3)})`);
R.is(r.edge[0] > 240 && r.edge[1] < 10 && r.edge[2] < 10, `a smudge started off the sheet drags no black onto it: the red there stays red (${r.edge.slice(0, 3)})`);
R.is(/no fill/.test(r.fill.said) && r.fill.layers === 0, `Fill with Retouch in hand is refused in words and makes no layer: “${r.fill.said}”`);
R.is(r.trip.kind === "dodge" && r.trip.tones, "after a round trip through another tool, Dodge is back and so is its Tones row");

console.log("\n=== the tool ===");
R.is(r.rules.ok === "retouch" && /nothing to do on a mask/.test(r.rules.mask) && /colour channel/.test(r.rules.smooth), `colour only, never a mask: “${r.rules.smooth}”`);
R.is(r.panel.rows.join() === "true,true,true" && !r.panel.smudgeRange && r.panel.hidden && r.panel.kept === "smudge",
  "its panel shows the kind and Strength, Tones only for dodge and burn, none of them for another tool — and the kind is the tool's own, back when it is picked up again");

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
