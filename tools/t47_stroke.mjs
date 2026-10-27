// A brush stroke must not stall the window, and undo must still put back exactly what was there.
//
// Reported by the owner 2026-08-23: "fast strokes as well as the first stroke after creating a
// layer results in a noticeable freeze". Measured at 4096², the first frame of EVERY stroke cost
// 47 ms while every frame after it cost 0.2–1.0 ms, and the first stroke on a new layer cost ~200.
// Two full-sheet operations were behind it, and both had the same shape: work queued in 0.1 ms
// whose bill arrives on the first frame that reads the canvas back.
//
//   * `strokeSnapshot` copied the whole sheet at beginStroke so `restoreTile` would have the
//     pre-stroke pixels ready. It now copies one 256² tile at a time, from `record()`.
//   * `strokeBuffer` cleared the whole sheet at beginStroke. It now clears only the region the
//     previous stroke wrote.
//   * `addLayerTo` scheduled a whole-sheet composite for a layer that was still blank — 49 ms of
//     compositing nothing, inside the user's first stroke.
//
// MEASURING THIS AT ALL TAKES CARE. Canvas work is queued, so a naive timer round a canvas call
// measures the *previous* call's backlog: the same stroke measured 0.6 ms in one probe and 22 ms
// in another purely because of what ran before it. Every phase below is bracketed by `sync()` — a
// 1×1 `getImageData`, which cannot return until the pipeline has drained — so each number is that
// phase's own cost. Without it these thresholds would be noise.
//
// Usage: node tools/t47_stroke.mjs [--keep] [--chrome <path>]
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = { correct: {}, ms: {} };

  function mkSlot(id, N){
    var s = { id: id, cStem: null, nStem: null, size: 0, layers: [],
      baseC: null, smooth: null, metal: null, normal: null, composite: null, tex: null,
      texCh: null, thumb: null, missing: true };
    App.slots.set(id, s);
    initPlaceholderAlbedo(s, N, N);
    return s;
  }
  // Forces the canvas pipeline to drain. Everything timed below is bracketed by it.
  function sync(c){ ctx2d(c).getImageData(0, 0, 1, 1); }
  function fnv(u8){ var h = 0x811c9dc5; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hash(c){ return fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); }
  function paint(x, y, len){
    beginStroke(false, false);
    stampAt(x, y, 0, null);
    stampAt(x + len, y, 0, null);
    endStroke();
  }

  // ---------------------------------------------------------------- correctness
  // Small sheet: this half is about pixels, not speed.
  var s = mkSlot("t47", 1024);
  App.activeSlot = s; App.activeLayer = null;
  App.brush.mode = "color"; App.brush.size = 40; App.brush.opacity = 1;
  App.brush.hardness = 1; App.brush.spacing = .35; App.brush.color = "#ff0000";
  flushComposites(); sync(s.composite);

  var blank = hash(s.composite);
  paint(200, 200, 300);                      // stroke A (also creates the layer)
  flushComposites(); sync(s.composite);
  var afterA = hash(s.composite);
  out.correct.aChanged = afterA !== blank;

  paint(200, 700, 300);                      // stroke B, well away from A
  flushComposites(); sync(s.composite);
  var afterB = hash(s.composite);
  out.correct.bChanged = afterB !== afterA;

  doUndo();                                  // take B off
  flushComposites(); sync(s.composite);
  out.correct.undoB = hash(s.composite) === afterA;

  doRedo();
  flushComposites(); sync(s.composite);
  out.correct.redoB = hash(s.composite) === afterB;

  doUndo(); doUndo();                        // B, then A-and-its-layer
  flushComposites(); sync(s.composite);
  out.correct.undoAll = hash(s.composite) === blank;
  out.correct.layerGone = s.layers.length === 0;

  // The shared snapshot sheet is reused between strokes and deliberately not cleared, so a stroke
  // that lands where an earlier one did must still restore ITS OWN pixels, not the older ones.
  doRedo(); doRedo();
  flushComposites(); sync(s.composite);
  var twoStrokes = hash(s.composite);
  paint(210, 210, 280);                      // straight over stroke A
  flushComposites(); sync(s.composite);
  var overlaid = hash(s.composite);
  doUndo();
  flushComposites(); sync(s.composite);
  out.correct.overlapUndo = hash(s.composite) === twoStrokes;
  out.correct.overlapChanged = overlaid !== twoStrokes;

  // ---------------------------------------------------------------- 4.28(e): the stroke makes the slot
  // The claim the whole slice rests on, and the one thing no other test performs: with a layer
  // selected and the brush moved to a channel that layer does not carry, the stroke lands IN THAT
  // LAYER — a channel slot is created inside it — rather than being refused, or creating a second
  // layer beside the one the user chose. And it is one undo step with the stroke, not two: an undo
  // that took the pixels but left an empty channel behind would be the sort of half-step that only
  // shows up three actions later.
  var e5 = mkSlot("t47e", 256);
  var flat5 = function(hex){ var c = mkCanvas(256, 256), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, 256, 256); return c; };
  e5.smooth = flat5("#101010"); e5.metal = flat5("#000000"); e5.normal = flat5("#808080"); e5.nSize = 256;
  App.activeSlot = e5; App.activeLayer = null;
  App.brush.mode = "color"; App.brush.color = "#ff0000"; App.brush.size = 30; App.brush.opacity = 1;
  flushComposites(); sync(e5.composite);
  paint(60, 60, 80);                          // creates the layer, with a colour slot and nothing else
  flushComposites(); sync(e5.composite);
  var L5 = App.activeLayer;
  out.slot = { layerMade: !!L5, before: LayerNode.channelsOf(L5 || {}).join(","), layers: e5.layers.length };
  App.brush.mode = "smooth";
  paint(60, 160, 80);
  flushComposites();
  Composite.sheet(e5, "smooth", null);
  out.slot.after = LayerNode.channelsOf(L5 || {}).join(",");
  out.slot.sameLayer = App.activeLayer === L5;
  out.slot.layersAfter = e5.layers.length;
  out.slot.smoothSheet = !!(e5.chanC && e5.chanC.smooth) && hash(e5.chanC.smooth) !== hash(flat5("#101010"));
  doUndo();
  flushComposites();
  out.slot.afterUndo = LayerNode.channelsOf(L5 || {}).join(",");
  out.slot.layersAfterUndo = e5.layers.length;
  App.brush.mode = "color";

  // ---------------------------------------------------------------- latency, at a real sheet size
  var big = mkSlot("t47big", 4096);
  App.activeSlot = big; App.activeLayer = null;
  App.brush.size = 48; App.brush.hardness = .7;
  flushComposites(); sync(big.composite);

  // warm: first touch of any 4096² surface allocates and uploads, and that is a page cost, not a
  // per-stroke one. Measure the second stroke onwards.
  paint(100, 100, 200); flushComposites(); sync(big.composite);

  var firstFrame = [], whole = [];
  for (var n = 0; n < 4; n++) {
    var y = 600 + n * 500;
    sync(big.composite);
    var a = performance.now();
    beginStroke(false, false);
    for (var i = 0; i < 5; i++) stampAt(200 + i * 18, y, 0, null);
    refreshStrokeView();
    sync(stroke.t.canvas);
    firstFrame.push(+(performance.now() - a).toFixed(1));
    // and the rest of the stroke, frame by frame
    for (var f = 0; f < 8; f++) { for (var i2 = 0; i2 < 5; i2++) stampAt(300 + f * 90 + i2 * 18, y, 0, null); refreshStrokeView(); }
    endStroke(); flushComposites(); sync(big.composite);
    whole.push(+(performance.now() - a).toFixed(1));
  }
  out.ms.firstFrame = firstFrame;
  out.ms.wholeStroke = whole;

  // The same strokes with level content on the sheet (ROADMAP 4.58 (b)): a far-only layer gives the
  // 3-D view a chain of its own, whose restart is a whole-sheet walk — built at idle once the edits
  // stop, never inside a frame of the stroke (docs/MIP_LEVELS.md §5).
  big.layers.unshift(LayerNode.of({ type: "fill", name: "far only", color: "#0000ff", opacity: 1, blend: "normal", visible: true, levels: Levels.far(3) }));
  // A structural change is a whole-sheet pass and the first stroke after one pays to write into
  // canvases it read whole (~70–150 ms here, with or without level content) — warm past it, as above.
  // Between the strokes the levels are brought up to date, as they are when the user pauses; that
  // update must not make the next stroke pay the same again (it did while it walked the whole sheet).
  scheduleComposite(big);
  await LevelView.settle(); sync(big.composite);
  paint(100, 3600, 200); flushComposites(); await LevelView.settle(); renderer.initTexture(big.tex);
  paint(100, 3800, 200); flushComposites(); await LevelView.settle(); renderer.initTexture(big.tex); sync(big.composite);
  var lvFirst = [], lvWhole = [], lvIdle = [], lvIn = 0, lvAfter = 0;
  for (var n3 = 0; n3 < 4; n3++) {
    var y3 = 700 + n3 * 500;
    await LevelView.settle(); sync(big.composite);
    var b3 = LevelView.stats.builds;
    var a3 = performance.now();
    beginStroke(false, false);
    for (var i3 = 0; i3 < 5; i3++) stampAt(200 + i3 * 18, y3, 0, null);
    refreshStrokeView();
    sync(stroke.t.canvas);
    lvFirst.push(+(performance.now() - a3).toFixed(1));
    for (var f3 = 0; f3 < 8; f3++) { for (var j3 = 0; j3 < 5; j3++) stampAt(300 + f3 * 90 + j3 * 18, y3, 0, null); refreshStrokeView(); }
    endStroke(); flushComposites(); sync(big.composite);
    lvWhole.push(+(performance.now() - a3).toFixed(1));
    lvIn += LevelView.stats.builds - b3;
    // the pause after the stroke: the levels brought up to date, and the frame that draws them
    var i3 = performance.now();
    await LevelView.settle();
    renderer.initTexture(big.tex); sync(big.composite);
    lvIdle.push(+(performance.now() - i3).toFixed(1));
    lvAfter += LevelView.stats.builds - b3;
  }
  out.ms.lvFirst = lvFirst; out.ms.lvWhole = lvWhole; out.ms.lvIdle = lvIdle;
  out.correct.lvChain = (big.tex.mipmaps || []).length === 13;
  out.correct.lvNoBuildInStroke = lvIn === 0;
  out.correct.lvBuiltAfter = lvAfter === 4;
  // and back as it was, warmed past the structural change again for what follows
  big.layers.shift(); scheduleComposite(big); await LevelView.settle();
  paint(100, 3900, 200); flushComposites(); await LevelView.settle(); sync(big.composite);

  // the reported case: first stroke on a layer that did not exist a moment ago
  App.activeLayer = null;
  sync(big.composite);
  var c0 = performance.now();
  beginStroke(false, false);
  stampAt(1500, 3000, 0, null);
  refreshStrokeView();
  sync(stroke.t.canvas);
  out.ms.newLayerFirstFrame = +(performance.now() - c0).toFixed(1);
  endStroke(); flushComposites(); sync(big.composite);
  out.ms.newLayerWhole = +(performance.now() - c0).toFixed(1);

  // a fast flick: one pointer move that crosses most of the sheet in a single event
  sync(big.composite);
  beginStroke(false, false);
  stampAt(100, 2200, 0, null);
  var d0 = performance.now();
  stampAt(3900, 2200, 0, null);
  refreshStrokeView();
  sync(stroke.t.canvas);
  out.ms.flick = +(performance.now() - d0).toFixed(1);
  endStroke(); flushComposites(); sync(big.composite);

  // The same frames with Flow, Build up and a pen's pressure on size and flow (ROADMAP 4.50 (4) +
  // 6.4). What they add per dab is a globalAlpha and a smaller draw rectangle — no new pass over the
  // sheet and no second application of the buffer — so they must cost what the plain stroke costs.
  // Pressure is set per stamp the way the pointer paths set it, falling and rising along the stroke.
  var keepFlow = [App.brush.flow, App.brush.build, App.brush.pSize, App.brush.pFlow];
  App.brush.flow = .3; App.brush.build = true; App.brush.pSize = true; App.brush.pFlow = true;
  var penFirst = [], penWhole = [];
  for (var n2 = 0; n2 < 4; n2++) {
    var y2 = 800 + n2 * 500;
    sync(big.composite);
    var a2 = performance.now();
    beginStroke(false, false);
    for (var i4 = 0; i4 < 5; i4++) { stroke.p = .3 + .1 * i4; stampAt(2400 + i4 * 18, y2, 0, null); }
    refreshStrokeView();
    sync(stroke.t.canvas);
    penFirst.push(+(performance.now() - a2).toFixed(1));
    for (var f2 = 0; f2 < 8; f2++) { for (var i5 = 0; i5 < 5; i5++) { stroke.p = .5 + .5 * Math.sin(f2 + i5); stampAt(2500 + f2 * 90 + i5 * 18, y2, 0, null); } refreshStrokeView(); }
    endStroke(); flushComposites(); sync(big.composite);
    penWhole.push(+(performance.now() - a2).toFixed(1));
  }
  out.ms.penFirst = penFirst; out.ms.penWhole = penWhole;
  App.brush.flow = keepFlow[0]; App.brush.build = keepFlow[1]; App.brush.pSize = keepFlow[2]; App.brush.pFlow = keepFlow[3];

  // The same frames with a tip and every dynamic on (ROADMAP 4.50 (10)): a Chip, turned to follow the
  // stroke and jittered in angle, size and flow, and scattered its own size off the line. What they
  // add per dab is a rotation in the one drawImage, a dirty rectangle the turned dab's diagonal wide
  // and five random numbers — no new pass over the sheet, and the buffer still goes on once — so they
  // must cost what the plain stroke costs. The stamp is made on the warm-up stroke, as any brush's is
  // when a setting changes; how long making one takes at the largest size is printed, not gated.
  var TIPK = ["tip", "sizeJit", "flowJit", "angleJit", "scatter", "follow", "size"], keepTip = {};
  TIPK.forEach(function(k){ keepTip[k] = App.brush[k]; });
  Object.assign(App.brush, { tip: "chip", sizeJit: .5, flowJit: .5, angleJit: .3, scatter: 1, follow: true, size: 400 });
  brushStamp._key = null;
  // The first dab after a change of tip or size at the LARGEST size (4.50 (10)'s review: 20–26 ms,
  // because the stamp was made inside that first stampAt). Drawing the brush outline over the sheet —
  // which the pointer does before any stroke — asks for the stamp now (brushStamp.warm), so by the
  // first dab it is made: gated like any first frame. One dab and no dynamics, so what is measured is
  // the stamp and not how long a turned 400-texel drawImage takes in a software rasteriser. The first
  // case is the session's first Chip, the costliest stamp there is (V8 has not compiled its loop yet).
  var keepDyn = { sizeJit: App.brush.sizeJit, flowJit: App.brush.flowJit, angleJit: App.brush.angleJit, scatter: App.brush.scatter, follow: App.brush.follow };
  var keepV2 = { cursor: v2.cursor, lazy: v2.lazy, p3: App.paint3d };
  Object.assign(App.brush, { sizeJit: 0, flowJit: 0, angleJit: 0, scatter: 0, follow: false });
  App.paint3d = true; v2.lazy = null;
  var bigFirst = [], BIG = [["chip", 400], ["rivet", 400], ["chip", 380], ["square", 400]];
  for (var n4 = 0; n4 < BIG.length; n4++) {
    App.brush.tip = BIG[n4][0]; App.brush.size = BIG[n4][1];
    v2.cursor = { x: 1000, y: 1000 }; Draw2D.ring(ctx2d(mkCanvas(4, 4)));
    await new Promise(function(r){ setTimeout(r, brushStamp.WARM_MS + 150); });
    sync(big.composite);
    var a4 = performance.now();
    beginStroke(false, false);
    stampAt(600 + 500 * n4, 3600, 0, null);
    refreshStrokeView();
    sync(stroke.t.canvas);
    bigFirst.push(+(performance.now() - a4).toFixed(1));
    endStroke(); flushComposites(); sync(big.composite);
  }
  out.ms.bigFirst = bigFirst;
  // …and where nothing asked for the stamp first: printed, not gated — that is what the warm-up is for.
  App.brush.tip = "rivet"; App.brush.size = 390; brushStamp._key = null; Tips._cov = null;
  sync(big.composite);
  var a5 = performance.now();
  beginStroke(false, false); stampAt(2800, 3000, 0, null); refreshStrokeView(); sync(stroke.t.canvas);
  out.ms.bigCold = +(performance.now() - a5).toFixed(1);
  endStroke(); flushComposites(); sync(big.composite);
  v2.cursor = keepV2.cursor; v2.lazy = keepV2.lazy; App.paint3d = keepV2.p3;
  Object.assign(App.brush, keepDyn, { tip: "chip", size: 400 });
  brushStamp._key = null; Tips._cov = null;
  var mk0 = performance.now(); brushStamp(); out.ms.chipStamp400 = +(performance.now() - mk0).toFixed(1);
  App.brush.size = 48; brushStamp._key = null;
  paint(3000, 300, 200); flushComposites(); sync(big.composite);
  var tipFirst = [], tipWhole = [];
  for (var n3 = 0; n3 < 4; n3++) {
    var y3 = 700 + n3 * 500;
    sync(big.composite);
    var a3 = performance.now();
    beginStroke(false, false);
    for (var i6 = 0; i6 < 5; i6++) stampAt(3000 + i6 * 18, y3, 0, null);
    refreshStrokeView();
    sync(stroke.t.canvas);
    tipFirst.push(+(performance.now() - a3).toFixed(1));
    for (var f3 = 0; f3 < 8; f3++) { for (var i7 = 0; i7 < 5; i7++) stampAt(3100 + f3 * 90 + i7 * 18, y3 + 20 * Math.sin(f3 + i7), 0, null); refreshStrokeView(); }
    endStroke(); flushComposites(); sync(big.composite);
    tipWhole.push(+(performance.now() - a3).toFixed(1));
  }
  out.ms.tipFirst = tipFirst; out.ms.tipWhole = tipWhole;
  TIPK.forEach(function(k){ App.brush[k] = keepTip[k]; });
  brushStamp._key = null;

  out.spacingDefault = App.brush.spacing;

  // ------------------------------------------- how many raycasts one pointer move asks for
  // Each sub-step of a 3-D stroke is an intersectObjects over every visible part, and two of them
  // when symmetry is on. The count used to scale with the brush's STAMP spacing, so painting at
  // 5 % asked for seven times the raycasts of the default while painting the same pixels — which
  // is what the owner's session of 2026-08-23 measured as 126 dropped frames in 16 seconds.
  // Sub-steps follow the surface; stamps are interpolated between them. The two are unrelated.
  function subStepsFor(spacing, size, distPx){
    App.brush.spacing = spacing; App.brush.size = size;
    var d = distPx;
    var spt = 1;                                          // one screen pixel per texel, so the maths is readable
    var want = Math.min(64, Math.max(3, size * 0.35 * spt));
    return Math.min(24, Math.max(1, Math.ceil(d / want)));
  }
  // the shipped code path, read back out of the page so this cannot drift from it
  out.subFrac = (typeof PAINT_SUB_FRAC === "number") ? PAINT_SUB_FRAC : null;
  out.subSteps = {
    fine:    subStepsFor(.05, 128, 300),
    dflt:    subStepsFor(.35, 128, 300),
    coarse:  subStepsFor(1.0, 128, 300)
  };
  App.brush.spacing = .35; App.brush.size = 48;

  // ---------------------------------------------------------------- the session recorder
  // It exists to be handed a real painting session, which no test can stage — so what is checked
  // here is that it counts what it claims to, that F9 lands a marker, and that the report actually
  // serialises. That last one is not paranoia: symEnabled() returns the model GROUP rather than a
  // boolean, and putting that in the report would make JSON.stringify throw on a circular structure.
  App.activeSlot = big; App.activeLayer = null;
  recStart();
  out.rec = { onWhileRecording: Rec.on };
  beginStroke(false, false);
  // 100 px apart against a 16.8 px step, so each move must interpolate several stamps. At 20 px it
  // was exactly one stamp per move and the assertion below could not have failed.
  for (var i3 = 0; i3 < 6; i3++) stampAt(1000 + i3 * 100, 1200, 0, null);
  recMark("test marker");
  endStroke();
  beginStroke(false, true);                 // a second stroke, flagged as coming from the 3-D view
  stampAt(1400, 1300, 0, null);
  endStroke();
  var rep = recStop();
  out.rec.off = Rec.on === false;
  out.rec.strokes = rep.strokes.length;
  out.rec.marks = rep.marks.length;
  out.rec.markInStroke = rep.marks[0] && rep.marks[0].stroke === 1;
  out.rec.stamps = rep.strokes[0] ? rep.strokes[0].stamps : -1;
  out.rec.madeLayerIsBool = rep.strokes[0] ? rep.strokes[0].madeLayer === true : false;
  out.rec.where = rep.strokes.map(function(s2){ return s2.where; }).join(",");
  out.rec.hasContext = !!(rep.context && rep.context.version && rep.context.slot);
  out.rec.triangles = rep.context ? rep.context.triangles : -1;
  out.rec.symmetryIsBool = rep.context ? typeof rep.context.symmetry === "boolean" : false;
  out.rec.feltFieldEmpty = rep.howItFelt === "";
  try { out.rec.jsonBytes = JSON.stringify(rep).length; } catch (e) { out.rec.jsonThrew = String(e && e.message); }
  // Where the time went (recorder note 4, 2026-10-22): every dab is a timed phase, putting the stroke
  // down is one ("end"), the brush's size and spacing ride on each stroke, and the report opens with a
  // sentence per stroke. Rec.summary and Rec.whose are driven with numbers whose answer is known, since
  // a test machine's timings are not.
  var t0s = rep.strokes[0] || {}, tm = t0s.time || {};
  out.rec.phases = { dabN: tm.dab ? tm.dab.n : -1, end: !!tm.end, spacing: t0s.spacing, size: t0s.size,
                     summary: rep.summary && rep.summary.length, line: rep.summary && rep.summary[0] };
  var sumLine = Rec.summary([{ id: 1, where: "3d", moves: 3, size: 86, spacing: .05, ms: 2000,
      time: { move: { ms: 900, n: 3, max: 500 }, ray: { ms: 150, n: 30, max: 9 }, dab: { ms: 700, n: 100, max: 20 } } }],
    [{ t: 1, gap: 400, longtask: true, stroke: 1 }, { t: 2, gap: 300, longtask: true, stroke: 1 },
     { t: 5, gap: 410, stroke: 1 }, { t: 9, gap: 120, longtask: true, stroke: null, after: 1 }])[0];
  out.rec.sumLine = sumLine;
  // Stroke 7 ran 500 → 1000 ms. A long task that BEGAN at 900 is reported after the stroke closed,
  // and is still the stroke's; one beginning at 1500 followed it; one past AFTER_MS is nobody's.
  var strokesWas = Rec.strokes, curWas = Rec.cur; Rec.strokes = [{ id: 7, t: 500, ms: 500 }]; Rec.cur = null;
  var w1 = Rec.whose({ t: 900, longtask: true }), w2 = Rec.whose({ t: 1500 }), w3 = Rec.whose({ t: 1000 + Rec.AFTER_MS + 1 });
  var w4 = Rec.whose({ t: 1600 }, 950);                                // a rAF gap ending at 1600 that began at 950
  out.rec.after = [w1.stroke === 7 && w1.after === undefined, w2.stroke === null && w2.after === 7,
                   w3.stroke === null && w3.after === undefined, w4.stroke === 7];
  Rec.strokes = strokesWas; Rec.cur = curWas;
  // and off means off: nothing accumulates after a stop
  beginStroke(false, false); stampAt(1600, 1400, 0, null); endStroke();
  out.rec.quietAfterStop = Rec.strokes.length === rep.strokes.length;
  // What was ON (1.8's follow-up). The slot's layers are counted as LEAVES — one group of two plus a
  // loose layer is three, not the two top-level nodes it was reported as since groups landed — and
  // the settings that change a stroke's cost ride on every stroke, because they change mid-session.
  // The recorder's own hooks are driven here rather than a real stroke: a stubbed Mirror.ready would
  // send a real 2-D stroke down the sheet-mirror path with no bake behind it.
  var fl = function(n, c){ return LayerNode.of({ type: "fill", name: n, color: c, opacity: 1, blend: "normal", visible: true }); };
  var gs = { id: "t47g", layers: [{ type: "group", name: "G", visible: true, opacity: 1, blend: "normal",
             children: [fl("a", "#ff0000"), fl("b", "#00ff00")] }, fl("c", "#0000ff")] };
  var slotWas = App.activeSlot; App.activeSlot = gs;
  var ctxG = recContext();
  App.activeSlot = slotWas;
  out.rec.leaves = ctxG.slot.layers; out.rec.nodes = ctxG.slot.nodes;
  out.rec.brushTriple = [ctxG.brush.tool, ctxG.brush.chan, ctxG.brush.target].join("/");
  out.rec.brushTripleLive = [App.brush.tool, App.brush.chan, App.brush.target].join("/");
  var rcWas = radialCount, mrWas = Mirror.ready;
  try {
    recStart();
    recStrokeBegin("2d"); recStrokeEnd();                              // Radial off, no mirror
    radialCount = function(){ return 6; }; Mirror.ready = function(){ return true; };
    recStrokeBegin("3d"); recStrokeEnd();                              // switched on mid-session
    var rep2 = recStop();
    var sa = rep2.strokes[0] || {}, sb = rep2.strokes[1] || {};
    out.rec.perStroke = { before: [sa.radial, sa.sheetMirror].join(","), after: [sb.radial, sb.sheetMirror].join(","),
                          symIsBool: typeof sb.sym === "boolean", triple: [sb.tool, sb.chan, sb.target].join("/") };
    out.rec.ctxRadial = rep2.context.brush.radial;
  } finally { radialCount = rcWas; Mirror.ready = mrWas; }
  // ---------------------------------------------------------------- the height brush's line
  // ROADMAP 4.17, reported as "turning a line into multiple dashed lines along the line of the
  // stroke". The old stamp walked integer texel centres and took a hard "d2 >= 1" cut, so it was an
  // un-weighted raster disc whose SHAPE changed as the centre moved between texels — and a texel no
  // disc happened to cover kept the base surface exactly, which is what the gaps were. The three
  // numbers below are the three halves of that: how many texels along the stroke are still sitting
  // at base, how much the wall wobbles from one texel to the next, and whether the cross-section is
  // a wall at all rather than a row of pits.
  var modeWas = App.brush.mode, sizeWas = App.brush.size, valWas = App.brush.value;
  var opWas = App.brush.opacity, slotWas = App.activeSlot, layWas = App.activeLayer;
  var HN = 512;
  var hs = { id: "t47h", size: HN, nSize: HN, layers: [], missing: false };
  var grey = function(hex){ var c = mkCanvas(HN, HN); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, HN, HN); return c; };
  hs.baseC = grey("#404040"); hs.composite = grey("#404040");
  hs.smooth = grey("#505050"); hs.metal = grey("#303030"); hs.normal = grey("#8080ff");
  App.slots.set("t47h", hs); App.activeSlot = hs; App.activeLayer = null;
  // A moderate depth on purpose: at 255 the normal clamps to 0/255 along the whole line, which
  // hides exactly the shape this is measuring. 160 is a groove you would actually draw.
  App.brush.mode = "height"; App.brush.value = 160; App.brush.opacity = 1;

  // A stroke laid at a deliberately awkward angle and sub-texel offset: a perfectly axis-aligned
  // line at integer coordinates is the one case the old rasteriser got right.
  var lineRun = function(size){
    App.brush.size = size;
    var L = layerLeaves(hs.layers).filter(function(l){ return l.chan === "normal"; })[0];
    if (L) { var gg = ctx2d(L.canvas); gg.clearRect(0, 0, HN, HN); }
    var y0 = 200.37;
    beginStroke(false, false);
    stampAt(60.21, y0, 0, null);
    stampAt(440.79, y0, 0, null);
    endStroke();
    L = layerLeaves(hs.layers).filter(function(l){ return l.chan === "normal"; })[0];
    if (!L) return null;
    var d = ctx2d(L.canvas).getImageData(0, 0, HN, HN).data;
    var at = function(x, y){ return d[((y * HN + x) * 4) + 1]; };      // G = normal Y
    var alpha = function(x, y){ return d[((y * HN + x) * 4) + 3]; };
    // (a) ALONG the stroke, one texel off the centre line, where the wall is steepest.
    var off = Math.max(1, Math.round(size / 3));
    var yw = Math.round(y0) - off;
    var lo = 999, hi = -999, base = 0;
    for (var x = 100; x <= 400; x++) {
      var v = at(x, yw);
      if (alpha(x, yw) < 8) base++;                                    // never written at all
      else if (v === 128) base++;                                      // written, but still flat
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // (b) ACROSS it, through the middle, as a profile. A texel this stroke never wrote is
    // transparent, and its BYTE is 0 rather than 128 — read as a number that is a -128 spike at
    // both ends of every profile, which is what made the first version of this measurement report
    // a saturated wall at every size. What such a texel composites as is the base: 128.
    var prof = [];
    var span = Math.ceil(size) + 3;
    for (var y = Math.round(y0) - span; y <= Math.round(y0) + span; y++)
      prof.push(alpha(250, y) < 8 ? 128 : at(250, y));
    var top = Math.max.apply(null, prof), bot = Math.min.apply(null, prof);
    // One wall, not a row of pits: between the two peaks the profile goes one way and keeps going.
    // A per-stamp disc that misses texels leaves the base value standing between the peaks, which
    // shows up here as a reversal in the middle of the slope.
    var iTop = prof.indexOf(top), iBot = prof.indexOf(bot);
    var a = Math.min(iTop, iBot), z = Math.max(iTop, iBot);
    var down = prof[a] > prof[z], walls = iTop !== iBot;
    for (var i = a; i < z; i++)
      if (down ? prof[i + 1] > prof[i] + 1 : prof[i + 1] < prof[i] - 1) walls = false;
    return { size: size, flatAlong: base, rippleAlong: hi - lo, amp: Math.max(top - 128, 128 - bot),
             prof: prof, walls: walls };
  };
  out.line = [2, 3, 4, 8, 16].map(lineRun);
  App.slots.delete("t47h");
  App.brush.mode = modeWas; App.brush.size = sizeWas; App.brush.value = valWas;
  App.brush.opacity = opWas; App.activeSlot = slotWas; App.activeLayer = layWas;
  App.undoStack.length = 0; App.redoStack.length = 0;

  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 900), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const c = r.correct, ms = r.ms;

console.log("=== the pixels are right ===");
R.is(c.aChanged, "a stroke changes the composite");
R.is(c.bChanged, "a second stroke elsewhere changes it again");
R.is(c.undoB, "undoing the second stroke restores the first exactly");
R.is(c.redoB, "and redoing it comes back byte-for-byte");
R.is(c.undoAll, "undoing everything returns the sheet to how it started");
R.is(c.layerGone, "and takes the layer the first stroke created with it");
R.is(c.overlapChanged, "a stroke laid over an earlier one changes the sheet");
R.is(c.overlapUndo, "and undoing it restores what was under it — not a stale tile from an older stroke");

console.log("\n=== a stroke makes the channel it needs, inside the layer you are on (4.28(e)) ===");
const SL = r.slot;
console.log(`   ${SL.before} -> ${SL.after} -> undo -> ${SL.afterUndo}  ·  ${SL.layers} layer(s) throughout: ${SL.layersAfter}`);
R.is(SL.layerMade && SL.before === "color", `the first stroke makes a layer carrying colour and nothing else (${SL.before})`);
R.is(SL.after === "color,smooth",
  `moving the brush to Smoothness and painting adds that channel TO THAT LAYER (${SL.after}) — it used to refuse, naming the channel the layer wrote`);
R.is(SL.sameLayer && SL.layersAfter === SL.layers,
  `and creates no second layer beside the one that was selected (${SL.layersAfter} layer(s))`);
R.is(SL.smoothSheet, "the stroke really reaches the smoothness sheet — a slot that exists and composites nothing would pass the two checks above");
R.is(SL.afterUndo === "color" && SL.layersAfterUndo === SL.layers,
  `and ONE undo takes the channel back with the pixels (${SL.afterUndo}) — the slot is created inside the stroke's own undo step, not beside it`);

console.log("\n=== and it does not stall the window ===");
const worst = a => Math.max(...a);
console.log(`  first frame of a stroke   ${ms.firstFrame.join(", ")} ms`);
console.log(`  whole stroke, 9 frames    ${ms.wholeStroke.join(", ")} ms`);
console.log(`  first stroke on a new layer   ${ms.newLayerFirstFrame} ms to first frame, ${ms.newLayerWhole} ms in total`);
console.log(`  one flick across the sheet    ${ms.flick} ms`);
// 47 ms measured before the fix, 0.6 after. The gate is deliberately loose — this runs on whatever
// machine happens to be to hand, and what it is guarding against is the return of a whole-sheet
// operation, which costs tens of milliseconds, not a couple.
R.is(worst(ms.firstFrame) < 12, `the first frame of a stroke stays under 12 ms — worst ${worst(ms.firstFrame)} ms (it was 47 before the fix)`);
R.is(worst(ms.wholeStroke) < 60, `a whole 9-frame stroke stays under 60 ms — worst ${worst(ms.wholeStroke)} ms`);
R.is(worst(ms.lvFirst) < 12 && worst(ms.lvWhole) < 60,
  `with a far-only layer on the sheet the same strokes stay under 12 ms and 60 ms — worst ${worst(ms.lvFirst)} and ${worst(ms.lvWhole)} ms (ROADMAP 4.58 (b))`);
console.log(`  the pause after it: levels brought up to date and drawn  ${ms.lvIdle.join(", ")} ms`);
R.is(worst(ms.lvIdle) < 50, `and the pause after each costs the stroke's rectangle, not the sheet — worst ${worst(ms.lvIdle)} ms (a whole-sheet walk measured 151–195, a whole re-upload 94–131)`);
R.is(c.lvChain && c.lvNoBuildInStroke && c.lvBuiltAfter,
  `the sheet is drawn from its own 13 levels, none rebuilt inside a stroke, and they follow once each stroke stops (${c.lvChain}, ${c.lvNoBuildInStroke}, ${c.lvBuiltAfter})`);
// What is left here is the layer's own canvas: a paint layer is sheet-sized, so creating one at
// 4096² allocates 67 MB and there is no way round that short of not having the layer. ~25 ms is
// one dropped frame at the moment you start painting, against ~200 ms before.
R.is(ms.newLayerFirstFrame < 45, `the first stroke on a new layer reaches the screen in under 45 ms — ${ms.newLayerFirstFrame} ms (it was ~200; what is left is the 67 MB canvas the layer needs)`);
R.is(ms.flick < 25, `a flick across the whole sheet in one event stays under 25 ms — ${ms.flick} ms`);
console.log(`  with Flow 30 %, Build up and pen pressure on size and flow: first frame ${ms.penFirst.join(", ")} ms, whole ${ms.penWhole.join(", ")} ms`);
R.is(worst(ms.penFirst) < 12 && worst(ms.penWhole) < 60,
  `and the same with Flow, Build up and pressure on (4.50 (4) + 6.4): first frame worst ${worst(ms.penFirst)} ms, whole stroke worst ${worst(ms.penWhole)} ms — a dab's alpha and size are set when it is drawn, and the buffer still goes on once`);
console.log(`  with a Chip tip following the stroke, size / flow / angle jitter and scatter: first frame ${ms.tipFirst.join(", ")} ms, whole ${ms.tipWhole.join(", ")} ms`);
console.log(`  making the Chip's stamp at 400 texels once V8 has compiled its loop, once per change of tip, size or hardness: ${ms.chipStamp400} ms`);
console.log(`  the first dab after a change at the largest size, the outline having asked for the stamp: ${ms.bigFirst.join(", ")} ms (Chip 400, Rivet 400, Chip 380, Square 400); with nothing asking first: ${ms.bigCold} ms`);
R.is(worst(ms.bigFirst) < 12,
  `the first dab after a change of tip or size at the largest size stays under the first-frame bar — worst ${worst(ms.bigFirst)} ms: the stamp is made when the brush outline is drawn, before the stroke (4.50 (10)'s review measured 20–26 ms, made inside the dab)`);
R.is(worst(ms.tipFirst) < 12 && worst(ms.tipWhole) < 60,
  `and the same with a tip and every dynamic on (4.50 (10)): first frame worst ${worst(ms.tipFirst)} ms, whole stroke worst ${worst(ms.tipWhole)} ms — a turned, scattered, jittered dab is still one drawImage into the buffer`);

console.log("\n=== the height brush draws one line, not a row of dashes (4.17) ===");
console.log("   size  flat texels along it   ripple   amplitude");
for (const L of r.line)
  console.log(`   ${String(L.size).padStart(4)}  ${String(L.flatAlong).padStart(18)}   ${String(L.rippleAlong).padStart(6)}   ${String("±" + L.amp).padStart(9)}`);
R.is(r.line.every(x => x.flatAlong === 0),
  `no texel beside the stroke is left at the base surface, at any size (${r.line.map(x => x.size + "px:" + x.flatAlong).join(" ")}) — measured against the old rasteriser this row reads 301 of 301 at 2 px, which is the smallest brush writing a single texel of centre line and NOTHING either side of it: no gradient across the stroke at all, which is the "smallest size" half of the report`);
R.is(r.line.every(x => x.rippleAlong <= 2),
  `and the wall does not wobble from one texel to the next along it (worst ${Math.max(...r.line.map(x => x.rippleAlong))} of 255, against 4 before) — each stamp is normalised to the same peak, so where it lands between texels changes nothing about how much it deposits`);
// This one and the next passed before the fix too, and are here as guards rather than as
// reproductions: the shape was wrong in the two ways above, not in these.
R.is(r.line.every(x => x.walls),
  "the cross-section is a wall — monotone from one peak through the centre to the other — rather than a row of pits at the stamp positions");
R.is(r.line.every(x => x.amp >= 6 && x.amp < 60),
  `every size carves a wall the shader can see, and none of them clamps (${r.line.map(x => x.size + "px:±" + x.amp).join(" ")} around 128)`);
// Worth having the number rather than the impression: a narrow groove cannot be as steep as a wide
// one, because a wall two texels across has only two texels to turn in. The old code hid that by
// applying the CONTINUUM gradient at every texel regardless of what the neighbouring texels held —
// a normal field no height field could produce, which is its own kind of wrong. So a 2 px line is
// about half the depth of a 16 px one at the same setting, and the depth slider is the answer.
console.log(`   a 2 px line is ${(r.line[0].amp / r.line[r.line.length - 1].amp).toFixed(2)}x the depth of a 16 px one at the same setting`);

console.log("\n=== raycast sub-steps do not scale with stamp spacing ===");
R.is(r.subFrac === 0.35, `the sub-step fraction is a constant, not the brush's spacing — ${r.subFrac}`);
R.is(r.subSteps.fine === r.subSteps.dflt && r.subSteps.dflt === r.subSteps.coarse,
  `5 %, 35 % and 100 % spacing all ask for the same number of raycasts — ${r.subSteps.fine}, ${r.subSteps.dflt}, ${r.subSteps.coarse}`);
R.is(r.subSteps.dflt <= 8, `and a 300 px move with a 128 px brush is ${r.subSteps.dflt} sub-steps, not the 24-step cap`);

console.log("\n=== the session recorder logs what it claims to ===");
const rec = r.rec || {};
R.is(rec.onWhileRecording === true && rec.off === true, "it starts and stops");
R.is(rec.strokes === 2, `both strokes were recorded — ${rec.strokes}`);
R.is(rec.where === "2d,3d", `and each knows which view it came from — ${JSON.stringify(rec.where)}`);
R.is(rec.stamps > 20, `stamps are counted, not pointer moves — ${rec.stamps} stamps from 6 moves`);
R.is(rec.madeLayerIsBool, "a layer created mid-stroke is flagged as a boolean, not summed into a count");
R.is(rec.marks === 1 && rec.markInStroke, "F9 lands a marker, tied to the stroke it happened during");
R.is(rec.hasContext && rec.triangles >= 0, `the report carries the context a number is meaningless without — ${rec.triangles} triangles`);
R.is(rec.symmetryIsBool, "symmetry is a boolean — symEnabled() returns the model group, which would make the report circular");
R.is(!rec.jsonThrew && rec.jsonBytes > 0, `and the whole report serialises — ${rec.jsonThrew || rec.jsonBytes + " bytes"}`);
R.is(rec.feltFieldEmpty, "howItFelt is left empty, for the half no instrument can record");
R.is(rec.quietAfterStop, "after stopping, painting records nothing");
R.is(rec.phases.dabN === 6 && rec.phases.end, `each dab is a timed phase of its stroke, and so is putting it down — ${JSON.stringify(rec.phases)}`);
R.is(rec.phases.spacing === .35 && rec.phases.size === 48, `the brush's size and spacing ride on each stroke, not only on the context — ${rec.phases.size}, ${rec.phases.spacing}`);
R.is(rec.phases.summary === 2 && /^stroke 1 \(2d, .*spacing 35 %.*dab /.test(rec.phases.line || ""), `the report opens with a line per stroke — ${rec.phases.line}`);
R.is(/blocked 700 ms of 2\.0 s, worst move 500 ms — dab 700 ms \(100 × 7\.00 ms\), ray 150 ms/.test(rec.sumLine || "") && /120 ms blocked after it ended/.test(rec.sumLine || ""),
  `the line sums long tasks only, puts the slowest phase first and counts what followed the stroke — ${rec.sumLine}`);
R.is(rec.after.every(Boolean), `a stall is the stroke's it BEGAN in, even reported after the stroke closed; one just after is put down to it, one 2 s later to nobody — ${JSON.stringify(rec.after)}`);
R.is(rec.leaves === 3 && rec.nodes === 2,
  `a slot's layers are counted as leaves — a group of two plus one loose layer is ${rec.leaves}, with ${rec.nodes} top-level nodes beside it`);
R.is(rec.brushTriple === rec.brushTripleLive && !/undefined/.test(rec.brushTriple),
  `the brush is recorded as its tool, channel and target, not only the legacy mode name (${rec.brushTriple})`);
const PS = rec.perStroke || {};
R.is(PS.before === "1,false" && PS.after === "6,true" && rec.ctxRadial === 1,
  `Radial copies and the sheet mirror are taken per stroke, so switching them on mid-session shows (${PS.before} → ${PS.after}; the start said ${rec.ctxRadial})`);
R.is(PS.symIsBool && PS.triple === rec.brushTripleLive, `and each stroke carries the 3-D symmetry as a boolean and the brush triple (${PS.triple})`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
