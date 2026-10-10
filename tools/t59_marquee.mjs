// A rectangular selection, and crop as one verb on it (ROADMAP 4.10).
//
// WHY THIS EXISTS. Before this item the app had no way to say *which part* of an image you meant.
// "Crop to content" was an automatic alpha trim inside the decal editor and nothing else, so
// "fill this rectangle", "clear this rectangle" and "copy this rectangle" had no gesture at all.
// The item's own instruction was to build the selection first, because crop is one verb on one —
// and the two traps it names are the two things a selection gets wrong when nobody checks:
//
//   * **whole texels.** A half-texel rectangle resamples the entire layer for nothing. Every
//     number here has to be an integer no matter what the pointer said, at every zoom level.
//   * **no antialiased edge.** `ctx.clip()` is antialiased, so a clipped fill or clear leaves a
//     1-px half-alpha seam along exactly the border being judged. Every verb is a fillRect /
//     clearRect / drawImage on integer coordinates instead, and the tests below read the four
//     border texels of each rectangle to prove it — a seam is invisible in a screenshot and
//     permanent in an export.
//
// The rest is what makes it a SELECTION rather than a rectangle somebody drew:
//
//   * the brush is confined to it, in both views, and the confinement is the same stencil the part
//     selection uses;
//   * **Fill respects the same shield the brush does** — part selection, protected parts, layer
//     scope. `beginStroke` composes those three inline and `Marquee.confine` composes them again
//     (the stroke's copy also has to decide whether to REFUSE itself, which a verb never does), so
//     this test compares the two stencils pixel for pixel. That comparison is the only thing
//     standing between one rule and two rules that drift.
//   * **Clear and Crop deliberately do NOT respect it**, because they only ever take away pixels
//     the layer already owns, and a crop that left something outside the rectangle would not be a
//     crop. That asymmetry is asserted, not assumed.
//   * crop's undo costs the four bands OUTSIDE the rectangle rather than a copy of the sheet.
//     That is why bakeRegionAction takes a list of rectangles now, and it is measured in bytes
//     below — the claim is the whole reason for the change.
//
// Usage: node tools/t59_marquee.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;

  function mkSlot(id){
    var s = { id: id, cStem: null, nStem: null, size: 0, layers: [], missing: true };
    App.slots.set(id, s);
    initPlaceholderAlbedo(s, N, N);
    return s;
  }
  function paintLayer(name){
    return LayerNode.of({ type: "paint", name: name, canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
  }
  function px(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; }
  function alpha(c, x, y){ return px(c, x, y)[3]; }
  function bytes(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; }
  function same(a, b){ if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  // How many texels of a canvas have any alpha at all, and where they sit.
  function coverBox(c){
    var d = bytes(c), x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 0) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
    return n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n: n } : { n: 0 };
  }
  // Any texel that is neither fully opaque nor fully clear. A clipped fill leaves a ring of them.
  function partials(c){
    var d = bytes(c), n = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i] < 255) n++;
    return n;
  }

  var s = mkSlot("t59");
  App.activeSlot = s; App.activeLayer = null;
  App.brush.mode = "color"; App.brush.color = "#ff0000"; App.brush.opacity = 1;
  App.brush.size = 24; App.brush.hardness = 1; App.brush.spacing = .35; App.brush.value = 128;
  App.selParts.clear(); App.protectedParts.clear();
  SelectUI.setOn(false);

  // ---- 1. whole texels, whatever the pointer said ----
  var frac = Marquee.norm({ x: 10.4, y: 20.6, w: 30.5, h: 9.4 }, N, N);
  var neg = Marquee.norm({ x: 80, y: 80, w: -30, h: -20 }, N, N);
  var over = Marquee.norm({ x: -40, y: -40, w: N + 400, h: N + 400 }, N, N);
  var tiny = Marquee.norm({ x: 10.1, y: 10.1, w: .2, h: .2 }, N, N);
  out.norm = {
    frac: frac, allInt: frac && [frac.x, frac.y, frac.w, frac.h].every(function(v){ return v === Math.round(v); }),
    neg: neg, over: over, tiny: tiny
  };

  // ---- 2. the eight handles, and a grab radius that is constant on screen ----
  var r0 = { x: 40, y: 60, w: 100, h: 50 };
  var found = Marquee.HANDLES.map(function(h){
    var p = Marquee.handleAt(r0, h[1], h[2]);
    return Marquee.hit(r0, p.x, p.y, 1) === h[0];
  });
  out.handles = {
    all: found.every(Boolean),
    inside: Marquee.hit(r0, 90, 85, 1),
    outside: Marquee.hit(r0, 200, 200, 1),
    // Zoomed out, one screen pixel is many texels: the corner must still be grabbable 20 texels
    // away, and must NOT be grabbable at that distance when zoomed in.
    farZoomedOut: Marquee.hit(r0, 40 + 20, 60 + 20, 8),
    farZoomedIn: Marquee.hit(r0, 40 + 20, 60 + 20, .25)
  };

  // ---- 3. resizing moves the edges the handle names, and nothing else ----
  var east = Marquee.drag(r0, "e", 30, 999, { W: N, H: N });
  var nw = Marquee.drag(r0, "nw", -10, -20, { W: N, H: N });
  var moved = Marquee.drag(r0, "in", 12, -8, { W: N, H: N });
  var pinned = Marquee.drag(r0, "in", 9999, 9999, { W: N, H: N });
  var lockCorner = Marquee.drag({ x: 0, y: 0, w: 100, h: 50 }, "se", 100, 0, { aspect: true, W: 1e6, H: 1e6 });
  out.resize = {
    east: east, nw: nw, moved: moved, pinned: pinned,
    lockRatio: lockCorner.w / lockCorner.h, wasRatio: 2
  };

  // ---- 4. outside() is the exact complement ----
  var bandsR = { x: 30, y: 40, w: 70, h: 60 };
  var bands = Marquee.outside(bandsR, N, N);
  var cov = mkCanvas(N, N), cg = ctx2d(cov);
  cg.fillStyle = "#fff";
  for (var i = 0; i < bands.length; i++) cg.fillRect(bands[i].x, bands[i].y, bands[i].w, bands[i].h);
  var bd = bytes(cov), overlapArea = 0;
  for (var b = 0; b < bands.length; b++) overlapArea += bands[b].w * bands[b].h;
  var insideLit = 0, outsideDark = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    var inR = x >= bandsR.x && x < bandsR.x + bandsR.w && y >= bandsR.y && y < bandsR.y + bandsR.h;
    var lit = bd[(y * N + x) * 4 + 3] > 0;
    if (inR && lit) insideLit++;
    if (!inR && !lit) outsideDark++;
  }
  out.bands = { count: bands.length, area: overlapArea, want: N * N - bandsR.w * bandsR.h,
                insideLit: insideLit, outsideDark: outsideDark };

  // ---- 5. fill writes exactly the rectangle, with a hard edge ----
  var L1 = paintLayer("P1");
  s.layers = [L1]; App.activeLayer = L1;
  App.undoStack.length = 0; App.redoStack.length = 0;
  Marquee.set({ x: 32, y: 48, w: 64, h: 40 });
  out.setBack = Marquee.rect();
  Marquee.fill();
  var box = coverBox(L1.canvas);
  out.fill = { box: box, want: { x: 32, y: 48, w: 64, h: 40, n: 64 * 40 },
               partials: partials(L1.canvas),
               inColour: px(L1.canvas, 40, 60),
               corner: alpha(L1.canvas, 32, 48), justOut: alpha(L1.canvas, 31, 48),
               steps: App.undoStack.length };
  var afterFill = bytes(L1.canvas);
  doUndo();
  out.fill.undoneEmpty = coverBox(L1.canvas).n;
  doRedo();
  out.fill.redoneSame = same(bytes(L1.canvas), afterFill);

  // ---- 6. clear takes out exactly the rectangle ----
  var g1 = ctx2d(L1.canvas);
  g1.globalCompositeOperation = "source-over"; g1.globalAlpha = 1;
  g1.fillStyle = "#00ff00"; g1.fillRect(0, 0, N, N);
  var beforeClear = bytes(L1.canvas);
  App.undoStack.length = 0;
  Marquee.set({ x: 32, y: 48, w: 64, h: 40 });
  Marquee.erase();
  out.clear = { hole: alpha(L1.canvas, 40, 60), keptOutside: alpha(L1.canvas, 20, 20),
                edgeIn: alpha(L1.canvas, 32, 48), edgeOut: alpha(L1.canvas, 31, 48),
                partials: partials(L1.canvas), steps: App.undoStack.length };
  doUndo();
  out.clear.undoneExact = same(bytes(L1.canvas), beforeClear);

  // ---- 7. crop clears the complement, leaves the rectangle untouched, and costs the bands ----
  var L2 = paintLayer("P2");
  s.layers = [L2]; App.activeLayer = L2;
  var g2 = ctx2d(L2.canvas);
  g2.fillStyle = "#3070ff"; g2.fillRect(0, 0, N, N);
  var beforeCrop = bytes(L2.canvas);
  App.undoStack.length = 0; App.redoStack.length = 0;
  var cr = { x: 32, y: 48, w: 64, h: 40 };
  Marquee.set(cr);
  Marquee.crop();
  out.crop = { box: coverBox(L2.canvas), want: cr, partials: partials(L2.canvas),
               inside: px(L2.canvas, 40, 60), outside: alpha(L2.canvas, 8, 8),
               steps: App.undoStack.length,
               costBytes: App.undoStack.length ? App.undoStack[App.undoStack.length - 1].bytes : -1,
               sheetBytes: N * N * 4 * 2, bandBytes: (N * N - cr.w * cr.h) * 4 * 2 };
  doUndo();
  out.crop.undoneExact = same(bytes(L2.canvas), beforeCrop);
  doRedo();
  out.crop.redoneBox = coverBox(L2.canvas);

  // ---- 8. a selection belongs to ONE sheet ----
  var s2 = mkSlot("t59b");
  Marquee.set({ x: 10, y: 10, w: 40, h: 40 });
  App.activeSlot = s2;
  out.perSheet = { onOther: Marquee.rect(), back: null };
  App.activeSlot = s;
  out.perSheet.back = Marquee.rect();

  // ---- 8b. the sheet can be resized under a live selection ----
  App.activeSlot = s;
  Marquee.set({ x: 100, y: 100, w: 100, h: 100 });
  var wideC = s.composite;
  s.composite = mkCanvas(160, 160);                          // as Textures ▸ Resize leaves it
  out.resized = { clamped: Marquee.rect() };
  s.composite = mkCanvas(48, 48);                            // now smaller than the rectangle's origin
  out.resized.gone = Marquee.rect();
  s.composite = wideC;
  Marquee.none();

  // ---- 9. the gesture: drag, click-to-deselect, and the whole-texel rule at every zoom ----
  var pt = function(tx, ty){ return { x: tx, y: ty, vx: tx * v2.sc + v2.ox, vy: ty * v2.sc + v2.oy }; };
  Marquee.none();
  SelectUI.setOn(true);
  v2.sc = 0.37;                                              // a scale that makes every texel fractional
  SelectUI.down({}, pt(20.3, 30.7));
  SelectUI.move({}, pt(60.8, 80.2));
  SelectUI.up();
  var dragged = Marquee.rect();
  out.gesture = { dragged: dragged,
                  ints: dragged && [dragged.x, dragged.y, dragged.w, dragged.h].every(function(v){ return v === Math.round(v); }) };
  // grab the east handle and pull it
  var e0 = Marquee.handleAt(dragged, 1, .5);
  SelectUI.down({}, pt(e0.x, e0.y));
  SelectUI.move({}, pt(e0.x + 25, e0.y));
  SelectUI.up();
  out.gesture.resized = Marquee.rect();
  // a click with no travel, on empty sheet, deselects
  SelectUI.down({}, pt(200, 200));
  SelectUI.up();
  out.gesture.afterClick = Marquee.rect();

  // ---- 10. the brush is confined to the selection ----
  var L3 = paintLayer("P3");
  s.layers = [L3]; App.activeLayer = L3;
  App.activeSlot = s;
  SelectUI.setOn(false);
  Marquee.set({ x: 100, y: 100, w: 40, h: 40 });
  App.brush.size = 60; App.brush.hardness = 1;
  beginStroke(false, false);
  stampAt(120, 120, 0, null);
  stampAt(90, 120, 0, null);                                 // deliberately walks outside the rectangle
  endStroke();
  var sb = coverBox(L3.canvas);
  out.confine = { box: sb, inside: alpha(L3.canvas, 120, 120), outsideLeft: alpha(L3.canvas, 95, 120) };

  // ---- 11. fill respects the same shield the brush does ----
  // A synthetic model: two "parts", each owning half the sheet in UV space, both on this slot.
  var uvQuad = function(u0, u1){
    return new Float32Array([u0,0, u1,0, u1,1,  u0,0, u1,1, u0,1]);
  };
  App.geomData = [{ name: "left", mat: "m", uv: uvQuad(0, .5) }, { name: "right", mat: "m", uv: uvQuad(.5, 1) }];
  App.matSlot.set("m", s.id);
  App.meshes.set("left", { userData: { mat: "m" } });
  App.meshes.set("right", { userData: { mat: "m" } });
  if (s._partMaskCache) s._partMaskCache.clear();
  App.selParts.clear(); App.selParts.add("left");
  var L4 = paintLayer("P4");
  s.layers = [L4]; App.activeLayer = L4;
  App.undoStack.length = 0;
  Marquee.set({ x: 0, y: 0, w: N, h: N });                   // the whole sheet — only the shield can shape it
  Marquee.fill();
  out.shield = { leftHalf: alpha(L4.canvas, 60, 128), rightHalf: alpha(L4.canvas, 200, 128) };
  // ...and it is the SAME stencil beginStroke builds, pixel for pixel
  var mine = Marquee.confine(s, L4, N, N);
  Marquee.none();                                            // so the stroke's stencil is the shield alone
  var L5 = paintLayer("P5");
  s.layers = [L5]; App.activeLayer = L5;
  beginStroke(false, false);
  var theirs = stroke && stroke.maskCanvas;
  out.shield.sameStencil = !!(mine && theirs && mine.width === theirs.width && mine.height === theirs.height &&
    same(bytes(mine), bytes(theirs)));
  out.shield.dims = mine ? mine.width + "x" + mine.height : "none";
  endStroke();

  // ---- 12. clear and crop ignore the shield, on purpose ----
  var L6 = paintLayer("P6");
  s.layers = [L6]; App.activeLayer = L6;
  var g6 = ctx2d(L6.canvas);
  g6.fillStyle = "#ffffff"; g6.fillRect(0, 0, N, N);
  Marquee.set({ x: 0, y: 0, w: 64, h: N });                  // entirely inside the "left" part
  Marquee.crop();
  out.cropIgnoresShield = { keptInside: alpha(L6.canvas, 30, 128),
                            clearedOnSelected: alpha(L6.canvas, 100, 128),   // "left" is selected, still cleared
                            clearedElsewhere: alpha(L6.canvas, 200, 128) };
  App.selParts.clear();

  // ---- 13. copy lands as an image layer, in place, with the right pixels ----
  var L7 = paintLayer("P7");
  s.layers = [L7]; App.activeLayer = L7;
  var g7 = ctx2d(L7.canvas);
  g7.fillStyle = "#20c040"; g7.fillRect(40, 50, 30, 20);
  Marquee.set({ x: 40, y: 50, w: 30, h: 20 });
  Marquee.copy();
  var cp = s.layers[s.layers.length - 1];
  out.copy = { type: cp && cp.type, w: cp && cp.bmp && cp.bmp.width, h: cp && cp.bmp && cp.bmp.height,
               cx: cp && cp.x, cy: cp && cp.y, scale: cp && cp.scale,
               pixel: cp && cp.bmp ? px(cp.bmp, 15, 10) : null };

  // ---- 13b. a copy comes off the channel you are working in, and lands on it (4.34(b)) ----
  // The _n is half the albedo here, which is the common case in the game's own files and is what
  // makes the scale half of this live rather than latent: rr is in the SOURCE sheet's pixels and
  // a decal's scale is in composite texels.
  var HN = N / 2;
  var mkSheet = function(col){ var c = mkCanvas(HN, HN), g = ctx2d(c); g.fillStyle = col; g.fillRect(0, 0, HN, HN); return c; };
  s.smooth = mkSheet("#303030"); s.metal = mkSheet("#101010"); s.normal = mkSheet("#8080ff");
  var Lg = LayerNode.of({ type: "paint", chan: "smooth", name: "Gloss", canvas: mkCanvas(HN, HN),
                          visible: true, opacity: 1, blend: "normal" });
  ctx2d(Lg.canvas).fillStyle = "#e0e0e0";
  ctx2d(Lg.canvas).fillRect(20, 25, 15, 10);            // = {40,50,30,20} in composite texels
  s.layers = [Lg]; App.activeLayer = Lg;
  App.brush.mode = "smooth";
  Marquee.set({ x: 40, y: 50, w: 30, h: 20 });
  Marquee.copy();
  var cg = s.layers[s.layers.length - 1];
  out.copyChan = { chan: cg && cg.chan, carries: cg ? LayerNode.channelsOf(cg).join(",") : null,
                   w: cg && cg.bmp && cg.bmp.width, h: cg && cg.bmp && cg.bmp.height,
                   scale: cg && cg.scale, pixel: cg && cg.bmp ? px(cg.bmp, 7, 5) : null };
  // ---- 13c. and Auto view follows the channel you are IN, not the layer's primary slot (4.34(a)) ----
  // A layer carrying colour FIRST and smoothness second: the two questions give different answers,
  // which is the whole reason asking for the layer's own tag was the wrong question.
  var Lm = LayerNode.of({ type: "paint", name: "Both", canvas: mkCanvas(N, N),
                          visible: true, opacity: 1, blend: "normal" });
  LayerNode.addContent(Lm, "smooth", LayerNode.content("paint", { canvas: mkCanvas(HN, HN) }));
  s.layers = [Lm]; App.activeLayer = Lm;
  out.autoView = { primary: Lm.chan, carries: LayerNode.channelsOf(Lm).join(",") };
  App.chanAuto = true;
  App.brush.mode = "smooth"; applyAutoChanView(); out.autoView.onSmooth = App.chanView;
  App.chanAuto = true;
  App.brush.mode = "color";  applyAutoChanView(); out.autoView.onColor = App.chanView;
  App.chanAuto = false;
  setChannelView("shaded");
  s.smooth = s.metal = s.normal = null;
  App.brush.mode = "color";

  // ---- 14. what the controls say, with and without a selection ----
  Marquee.none();
  SelectUI.setOn(false);
  out.ui = { idleStays: $("selSection").style.display !== "none" };
  SelectUI.setOn(true);
  out.ui.shownWithTool = $("selSection").style.display !== "none";
  out.ui.labels = $("btnSel2d").textContent + " / " + $("btnSelMode").textContent;
  out.ui.bothActive = $("btnSel2d").classList.contains("active") && $("btnSelMode").classList.contains("active");
  out.ui.verbsOff = ["btnSelFill", "btnSelClear", "btnSelCrop", "btnSelCopy"].every(function(id){ return $(id).disabled; });
  Marquee.set({ x: 5, y: 6, w: 70, h: 80 });
  out.ui.verbsOn = ["btnSelFill", "btnSelClear", "btnSelCrop", "btnSelCopy"].every(function(id){ return !$(id).disabled; });
  out.ui.fields = [$("selX").value, $("selY").value, $("selW").value, $("selH").value].join(",");
  // The trap CLAUDE.md §4 names twice already: a flex item's intrinsic width overrunning the side
  // panel. Four number spinners share two rows here, and a spinner is wider than a quarter of a
  // 250 px bar unless min-width:0 says otherwise.
  var bar = $("rightbar"), sec = $("selSection");
  out.ui.fit = { bar: bar.scrollWidth <= bar.clientWidth,
                 rows: [].every.call(sec.querySelectorAll(".row"), function(r){ return r.scrollWidth <= r.clientWidth; }),
                 over: Math.round(sec.getBoundingClientRect().right - bar.getBoundingClientRect().right) };
  // typing is the other half of the same rectangle
  $("selW").value = "33"; $("selH").value = "21";
  SelectUI.fromFields();
  out.ui.typed = Marquee.rect();

  // ---- 14b. the dim belongs to the tool, not to the selection ----
  // Drawn onto a scratch canvas with a known transform rather than onto the pane, so the assertion
  // does not depend on how big the 2-D view happens to be in a headless window.
  var drawOn = function(on){
    SelectUI.on = on;
    var c = mkCanvas(200, 200), g = ctx2d(c);
    g.fillStyle = "#808080"; g.fillRect(0, 0, 200, 200);
    SelectUI.draw(g, { sc: 1, ox: 0, oy: 0 });
    return c;
  };
  Marquee.set({ x: 60, y: 60, w: 80, h: 80 });
  var dOn = drawOn(true), dOff = drawOn(false);
  SelectUI.on = false;
  out.dim = { onOutside: px(dOn, 20, 20)[0], offOutside: px(dOff, 20, 20)[0],
              onInside: px(dOn, 100, 100)[0], offInside: px(dOff, 100, 100)[0],
              // the outline is on the boundary in both — a horizontal scan across the top edge
              onEdge: px(dOn, 100, 60)[0], offEdge: px(dOff, 100, 60)[0] };

  // ---- 15. the verbs refuse in words, rather than doing nothing ----
  var says = function(fn){ document.getElementById("status").textContent = ""; fn(); return document.getElementById("status").textContent; };
  var says16 = says;
  // Back to the colour brush: the copy above left an IMAGE layer selected, and
  // updateBrushAvailability moves off any tool that cannot write to the selected layer — so by here
  // the live tool is the mask brush, which refuses for its own perfectly good reason.
  App.brush.mode = "color";
  Marquee.none();
  out.refuse = { noSel: says(function(){ Marquee.crop(); }) };
  Marquee.set({ x: 10, y: 10, w: 50, h: 50 });
  App.activeLayer = null;
  out.refuse.noLayer = says(function(){ Marquee.crop(); });
  // ...but Fill makes the layer the first stroke would have made
  App.undoStack.length = 0;
  var before7 = s.layers.length;
  out.refuse.fillSaid = says(function(){ Marquee.fill(); });
  out.refuse.fillMadeLayer = s.layers.length === before7 + 1;
  // ...and taking it back is ONE Ctrl+Z, not "undo the fill, then undo a bare empty layer"
  out.refuse.fillSteps = App.undoStack.length;
  doUndo();
  out.refuse.afterUndo = s.layers.length === before7 && App.undoStack.length === 0;

  // ---- 16. a UV island is a selection too, and every verb follows its SHAPE (ROADMAP 4.24) ----
  // The island is a right TRIANGLE on purpose: its bounding box is twice its area, so every check
  // below can tell "followed the shape" apart from "followed the box", which a rectangular island
  // could not.
  App.brush.mode = "color"; App.brush.color = "#ff0000"; App.brush.opacity = 1;
  App.selParts.clear(); App.protectedParts.clear();
  App.meshes.clear();
  App.geomData = [
    { name: "tri", mat: "m", uv: new Float32Array([.05,.05, .45,.05, .05,.45]) },
    { name: "far", mat: "m", uv: new Float32Array([.6,.05, .95,.05, .95,.45,  .6,.05, .95,.45, .6,.45]) },
  ];
  App.matSlot.set("m", s.id);
  App.meshes.set("tri", { userData: { mat: "m" } });
  App.meshes.set("far", { userData: { mat: "m" } });
  s._partMaskCache = null; s._uvIslands = null;
  // UV v runs up the sheet and y down it, so a point at v is at (1 - v) * N.
  var IN = [Math.round(.12 * N), Math.round((1 - .12) * N)];     // inside the triangle
  var BOXOUT = [Math.round(.40 * N), Math.round((1 - .40) * N)]; // inside its BOX, outside the triangle
  var FAR = [Math.round(.80 * N), Math.round((1 - .25) * N)];    // the other island
  SelectUI.setOn(true);
  SelectUI.setIslandMode(true);
  SelectUI.pickIsland(s, IN[0], IN[1], false, false);
  out.isl = { n: Marquee.islands ? Marquee.islands.size : 0, box: Marquee.rect(),
              hasShape: !!Marquee.shape(), islandsTotal: UVIslands.of(s).count };
  // fill follows the triangle, not its box, and not the other island
  var LI = paintLayer("PI");
  s.layers = [LI]; App.activeLayer = LI;
  Marquee.fill();
  out.isl.fill = { inside: alpha(LI.canvas, IN[0], IN[1]), boxOut: alpha(LI.canvas, BOXOUT[0], BOXOUT[1]),
                   far: alpha(LI.canvas, FAR[0], FAR[1]) };
  // clear takes out the triangle and leaves the rest of the box
  var LC = paintLayer("PC");
  s.layers = [LC]; App.activeLayer = LC;
  var gc = ctx2d(LC.canvas); gc.fillStyle = "#00ff00"; gc.fillRect(0, 0, N, N);
  Marquee.erase();
  out.isl.clear = { hole: alpha(LC.canvas, IN[0], IN[1]), boxOut: alpha(LC.canvas, BOXOUT[0], BOXOUT[1]),
                    far: alpha(LC.canvas, FAR[0], FAR[1]) };
  // crop keeps the triangle and clears everything else, INCLUDING the rest of the box
  var LR = paintLayer("PR");
  s.layers = [LR]; App.activeLayer = LR;
  var gr = ctx2d(LR.canvas); gr.fillStyle = "#3070ff"; gr.fillRect(0, 0, N, N);
  Marquee.crop();
  out.isl.crop = { kept: alpha(LR.canvas, IN[0], IN[1]), boxOut: alpha(LR.canvas, BOXOUT[0], BOXOUT[1]),
                   far: alpha(LR.canvas, FAR[0], FAR[1]) };
  // a copy carries the island's silhouette, not a rectangle of its neighbours
  var LP = paintLayer("PP");
  s.layers = [LP]; App.activeLayer = LP;
  var gp = ctx2d(LP.canvas); gp.fillStyle = "#20c040"; gp.fillRect(0, 0, N, N);
  Marquee.copy();
  var cpi = s.layers[s.layers.length - 1], rb = Marquee.rect();
  out.isl.copy = cpi && cpi.bmp
    ? { w: cpi.bmp.width, h: cpi.bmp.height,
        inside: alpha(cpi.bmp, IN[0] - rb.x, IN[1] - rb.y),
        boxOut: alpha(cpi.bmp, BOXOUT[0] - rb.x, BOXOUT[1] - rb.y) }
    : null;
  // and the brush is confined to it, in both views — a stroke walked from inside out to the far island
  App.brush.mode = "color";
  var LS = paintLayer("PS");
  s.layers = [LS]; App.activeLayer = LS;
  App.brush.size = 40; App.brush.hardness = 1;
  beginStroke(false, false);
  stampAt(IN[0], IN[1], 0, null);
  stampAt(BOXOUT[0], BOXOUT[1], 0, null);
  stampAt(FAR[0], FAR[1], 0, null);
  endStroke();
  out.isl.stroke = { inside: alpha(LS.canvas, IN[0], IN[1]), boxOut: alpha(LS.canvas, BOXOUT[0], BOXOUT[1]),
                     far: alpha(LS.canvas, FAR[0], FAR[1]) };
  // dragging a rectangle afterwards REPLACES the shape rather than moving it around
  Marquee.set({ x: 10, y: 10, w: 40, h: 40 });
  out.isl.dropped = !Marquee.shape() && !Marquee.islands;
  // shift+click adds a second island, alt+click takes it back out
  SelectUI.pickIsland(s, IN[0], IN[1], false, false);
  SelectUI.pickIsland(s, FAR[0], FAR[1], true, false);
  out.isl.added = Marquee.islands ? Marquee.islands.size : 0;
  out.isl.addedBox = Marquee.rect();
  SelectUI.pickIsland(s, FAR[0], FAR[1], false, true);
  out.isl.removed = Marquee.islands ? Marquee.islands.size : 0;
  // a click on gutter clears it, and it says so rather than doing nothing
  out.isl.gutterSaid = says16(function(){ SelectUI.pickIsland(s, Math.round(.5 * N), Math.round(.5 * N), false, false); });
  out.isl.afterGutter = Marquee.rect();
  SelectUI.setIslandMode(false);

  // ---- 17. a selection is something you MAKE, so it steps back like one (reported 2026-08-31) ----
  // Two separate faults, and the second is the one with no way out. Island picks were outside undo
  // entirely; and turning the island toggle off left the SHAPE in force, which nothing else in the
  // UI can then move, resize, retype or clear — down() refuses an island's handles by design and
  // the four number fields do not describe it. So the tool was off and every brush was still
  // confined, with the switch the user had just tried being the one that did not release it.
  App.undoStack.length = 0; App.redoStack.length = 0;
  Marquee.none();
  SelectUI.setOn(true);
  SelectUI.setIslandMode(true);
  out.hist = {};
  SelectUI.pickIsland(s, IN[0], IN[1], false, false);
  out.hist.picked = Marquee.islands ? Marquee.islands.size : 0;
  out.hist.pickSteps = App.undoStack.length;
  doUndo();
  out.hist.afterUndo = Marquee.rect();
  doRedo();
  out.hist.afterRedo = Marquee.islands ? Marquee.islands.size : 0;
  out.hist.redoShape = !!Marquee.shape();
  // shift+click is its own step, so walking back takes the second island off and keeps the first
  SelectUI.pickIsland(s, FAR[0], FAR[1], true, false);
  out.hist.two = Marquee.islands ? Marquee.islands.size : 0;
  doUndo();
  out.hist.backToOne = Marquee.islands ? Marquee.islands.size : 0;
  // a click that changed nothing is not a step: gutter, with nothing selected
  Marquee.none();
  App.undoStack.length = 0;
  SelectUI.pickIsland(s, Math.round(.5 * N), Math.round(.5 * N), false, false);
  out.hist.noopSteps = App.undoStack.length;
  // turning the shape off releases the shape — and that too is one Ctrl+Z
  SelectUI.pickIsland(s, IN[0], IN[1], false, false);
  App.undoStack.length = 0; App.redoStack.length = 0;
  SelectUI.setIslandMode(false);
  out.hist.afterToggleOff = Marquee.rect();
  out.hist.toggleSteps = App.undoStack.length;
  doUndo();
  out.hist.toggleUndone = Marquee.islands ? Marquee.islands.size : 0;
  Marquee.none();
  // and the rectangle half: one entry per GESTURE, not one per drag frame
  App.undoStack.length = 0; App.redoStack.length = 0;
  SelectUI.setIslandMode(false);
  SelectUI.setOn(true);
  SelectUI.down({}, pt(20, 30));
  SelectUI.move({}, pt(40, 50));
  SelectUI.move({}, pt(60, 80));
  SelectUI.move({}, pt(90, 110));
  SelectUI.up();
  out.hist.dragSteps = App.undoStack.length;
  out.hist.dragged = Marquee.rect();
  doUndo();
  out.hist.dragUndone = Marquee.rect();
  SelectUI.setOn(false);

  // ---- 18. the two grains of "where does this apply", and the selection on the model ----
  // Reported 2026-09-01: an island selection has no feedback at all in the 3-D view, and there is
  // no way across between a part selection and an island one — you re-pick by hand in the other
  // vocabulary and hope the two agree.
  //
  // Real THREE.Mesh objects from here on, not the {userData} stubs above: partAction runs
  // updateSelectionVisuals, which reads every mesh's material, and SelOverlay needs a geometry with
  // a uv attribute to hang an overlay on at all.
  out.br = {};
  App.meshes.clear();
  var geo = new THREE.PlaneGeometry(1, 1);
  var realMesh = function(){ var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial()); m.userData = { mat: "m" }; return m; };
  App.meshes.set("tri", realMesh());
  App.meshes.set("far", realMesh());
  modelGroup = modelGroup || new THREE.Group();
  App.undoStack.length = 0; App.redoStack.length = 0;
  Marquee.none();
  SelectUI.setOn(true); SelectUI.setIslandMode(true);
  App.selParts.clear();
  out.br.refuseNoParts = says16(function(){ SelectUI.fromParts(); });
  App.selParts.add("tri");
  App.undoStack.length = 0;
  SelectUI.fromParts();
  out.br.fromParts = Marquee.islands ? Marquee.islands.size : 0;
  out.br.fromPartsShape = !!Marquee.shape();
  out.br.fromPartsSteps = App.undoStack.length;
  // one island, one triangle: the shape still follows the island and not its box
  out.br.fromPartsIn = !!(Marquee.shape() && ctx2d(Marquee.shape()).getImageData(
    Math.round(IN[0] * Marquee.shape().width / N), Math.round(IN[1] * Marquee.shape().height / N), 1, 1).data[3]);
  // the overlay: one child per part on this sheet, sharing the part's own geometry
  SelOverlay.sync();
  out.br.overlayKids = App.meshes.get("tri").children.length + App.meshes.get("far").children.length;
  out.br.overlaySharesGeom = App.meshes.get("tri").children[0] &&
    App.meshes.get("tri").children[0].geometry === App.meshes.get("tri").geometry;
  out.br.overlayUnlit = !!(App.meshes.get("tri").children[0] &&
    App.meshes.get("tri").children[0].material.isMeshBasicMaterial &&
    !App.meshes.get("tri").children[0].material.depthWrite);
  // ... and back the other way: the parts under these islands, REPLACING the part selection
  App.selParts.clear(); App.selParts.add("far");
  SelectUI.toParts();
  out.br.toParts = Array.from(App.selParts).sort().join(",");
  out.br.toPartsSteps = App.undoStack.length;
  // the panel is a place, and it says what the OTHER grain holds
  out.br.partInfo = $("selPartInfo").textContent;
  Marquee.none();
  SelOverlay.sync();
  out.br.overlayGone = App.meshes.get("tri").children.length + App.meshes.get("far").children.length;
  out.br.panelStays = $("selSection").style.display !== "none";
  out.br.bridgeOffNoIslands = $("btnSelToParts").disabled;
  SelectUI.setIslandMode(false); SelectUI.setOn(false);
  SelOverlay.reset();


  // ---- 19. the two bridges between a selection and a mask (ROADMAP 4.28(g)) ----
  // One existed and was buried: the mask row's "from selected parts" read App.selParts and nothing
  // else, so the rectangle you had just dragged and the UV island you had just clicked were the two
  // shapes it could not see. The other did not exist in either direction — a mask you had painted,
  // imported, softened or inverted was a shape every selection verb was blind to.
  //
  // What makes the pair worth having is that they go through the SAME stencil the brush is confined
  // by, so "the mask matches what I selected" and "the brush would have painted there" are the same
  // sentence. Section 10 above measures the second half of that against the first.
  out.bridge = {};
  App.geomData = null; App.meshes.clear(); App.selParts.clear();
  App.undoStack.length = 0; App.redoStack.length = 0;
  var bl = paintLayer("bridged");
  s.layers = [bl];
  App.activeLayer = bl;
  SelectUI.setOn(true); SelectUI.setIslandMode(false);
  Marquee.set({ x: 40, y: 60, w: 50, h: 30 });
  out.bridge.made = Marquee.toMask();
  out.bridge.hasMask = !!bl.mask;
  // The mask is white inside the rectangle and black outside it — and it is a MASK, at the sheet's
  // own size, not the mask-resolution stencil it was built from.
  if (bl.mask) {
    out.bridge.maskSize = [bl.mask.width, bl.mask.height];
    out.bridge.inside = px(bl.mask, 60, 70);
    out.bridge.outside = px(bl.mask, 10, 10);
    out.bridge.box = coverBox(bl.mask);
  }
  // The selection is NOT consumed by the command — you keep working with it.
  out.bridge.selStays = !!Marquee.rect();
  // ...and one Ctrl+Z takes the mask off again.
  doUndo();
  out.bridge.undone = !bl.mask;
  doRedo();
  out.bridge.redone = !!bl.mask;

  // The other direction. The mask is thrown away and rebuilt as a shape that is NOT a rectangle, so
  // the box coming back can be checked against the ink rather than against what was put in.
  var mk2 = mkCanvas(N, N), mg2 = ctx2d(mk2);
  mg2.fillStyle = "#000"; mg2.fillRect(0, 0, N, N);
  mg2.fillStyle = "#fff"; mg2.beginPath(); mg2.arc(160, 100, 30, 0, Math.PI * 2); mg2.fill();
  bl.mask = mk2;
  Marquee.none();
  out.bridge.fromOk = Marquee.fromMask();
  var fr = Marquee.rect(), fs = Marquee.shape();
  out.bridge.from = fr ? { x: fr.x, y: fr.y, w: fr.w, h: fr.h } : null;
  out.bridge.fromShape = !!fs;
  out.bridge.fromIslands = !!Marquee.islands;
  if (fs) {
    var sw = fs.width / N;
    out.bridge.shapeIn = ctx2d(fs).getImageData(Math.round(160 * sw), Math.round(100 * sw), 1, 1).data[3];
    // A corner of the bounding box, well outside the circle: a rectangle would have ink here and
    // the shape must not, or "follows the shape and not the box" is not what happened.
    out.bridge.shapeCorner = ctx2d(fs).getImageData(Math.round(132 * sw), Math.round(72 * sw), 1, 1).data[3];
  }
  // A shape no island id can rebuild still steps back, because the snapshot holds this one by
  // reference — the exception rule 4 of the history note names.
  doUndo();
  out.bridge.undoneSel = !Marquee.rect();
  doRedo();
  out.bridge.redoneShape = !!Marquee.shape();
  // An all-black mask has nothing light in it, and says so rather than selecting nothing silently.
  var mk3 = mkCanvas(N, N); ctx2d(mk3).fillStyle = "#000"; ctx2d(mk3).fillRect(0, 0, N, N);
  bl.mask = mk3;
  out.bridge.emptySaid = says16(function(){ Marquee.fromMask(); });
  // ...and with no selection at all, the forward direction says what to do instead of doing nothing.
  bl.mask = null;
  Marquee.none();
  out.bridge.noSelSaid = says16(function(){ Marquee.toMask(); });
  s.layers = [];
  App.activeLayer = null;
  SelectUI.setOn(false);
  App.undoStack.length = 0; App.redoStack.length = 0;


  // ---- 20. a layer's LIMIT is a selection recipe, not a parts list (ROADMAP 4.28(g)) ----
  // A layer could be limited to model parts and to nothing else. Draw a marquee, add a layer, and
  // the marquee was silently not carried — the only way to keep it was to bake it into a mask and
  // give up the exactness that makes a scope worth having over one. It is a recipe now, and the
  // rectangle half needs no model at all, which is what this section runs without one.
  out.lim = {};
  App.geomData = null; App.meshes.clear(); App.selParts.clear();
  App.undoStack.length = 0; App.redoStack.length = 0;
  Marquee.none();
  SelectUI.setOn(true);
  Marquee.set({ x: 100, y: 40, w: 60, h: 40 });
  // A new layer inherits it, the way it has always inherited a part selection.
  out.lim.inherited = Scope.ofSelection();
  var ll = paintLayer("limited");
  ll.scope = Scope.ofSelection();
  s.layers = [ll];
  App.activeLayer = ll;
  out.lim.label = Scope.label(ll);
  out.lim.partsHalf = Scope.parts(ll);
  // The stencil is the rectangle, at mask resolution, and it needs no geometry.
  var st = Scope.stencil(s, ll);
  out.lim.stencil = !!st;
  if (st) {
    var kx = st.width / N;
    out.lim.stIn = ctx2d(st).getImageData(Math.round(130 * kx), Math.round(60 * kx), 1, 1).data[3];
    out.lim.stOut = ctx2d(st).getImageData(Math.round(20 * kx), Math.round(20 * kx), 1, 1).data[3];
  }
  // ...and a stroke lands inside it and nowhere else. Deselect first, so what confines the brush is
  // the LAYER's limit and not the selection that is still up — which is the whole point of storing
  // one rather than working inside a live marquee.
  Marquee.none();
  SelectUI.setOn(false);
  App.brush.mode = "color"; App.brush.color = "#00ff00"; App.brush.size = 40; App.brush.opacity = 1;
  beginStroke(false, false);
  stampAt(130, 60, 0, null);
  stampAt(40, 60, 0, null);              // well outside the limit
  endStroke();
  flushComposites();
  out.lim.paintedIn = alpha(ll.canvas, 130, 60);
  out.lim.paintedOut = alpha(ll.canvas, 40, 60);
  // Clearing it puts the whole sheet back in reach, in one undo step.
  setLayerScope(ll, null);
  out.lim.cleared = Scope.empty(Scope.of(ll));
  doUndo();
  out.lim.undone = Scope.label(ll);
  s.layers = [];
  App.activeLayer = null;
  App.undoStack.length = 0; App.redoStack.length = 0;

  // ---- clean up ----
  App.geomData = null; App.meshes.clear();
  Marquee.none();
  SelectUI.setOn(false);
  App.geomData = null; App.matSlot.delete("m");
  App.meshes.delete("left"); App.meshes.delete("right");
  App.selParts.clear(); App.protectedParts.clear();
  App.slots.delete("t59"); App.slots.delete("t59b");
  App.activeSlot = null; App.activeLayer = null;
  App.undoStack.length = 0; App.redoStack.length = 0;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const box = b => b && b.n ? `${b.w}×${b.h} at ${b.x},${b.y} (${b.n} texels)` : "empty";
const rct = r2 => r2 ? `${r2.w}×${r2.h} at ${r2.x},${r2.y}` : "none";

console.log("=== a selection is whole texels, always ===");
console.log(`   {10.4, 20.6, 30.5, 9.4} → ${rct(o.norm.frac)}`);
R.is(o.norm.allInt, "a rectangle dragged off fractional pointer positions comes back on integers — a half-texel crop resamples the whole layer for nothing");
R.is(o.norm.neg && o.norm.neg.x === 50 && o.norm.neg.w === 30,
  `dragged up and to the left it is still a rectangle (${rct(o.norm.neg)})`);
R.is(o.norm.over && o.norm.over.x === 0 && o.norm.over.w === 256,
  `and it is clamped to the sheet rather than running off it (${rct(o.norm.over)})`);
R.is(o.norm.tiny === null, "smaller than one texel is a click that missed, and drops the selection instead of leaving a rectangle no verb can act on");

console.log("\n=== the eight handles ===");
R.is(o.handles.all, "each of the eight is where the table says it is — one table, so hit-testing, drawing and the drag cannot disagree");
R.is(o.handles.inside === "in" && o.handles.outside === null, `inside is a move, outside is nothing (${o.handles.inside} / ${o.handles.outside})`);
R.is(o.handles.farZoomedOut === "nw" && o.handles.farZoomedIn !== "nw",
  `the grab radius is constant on SCREEN: 20 texels away is the corner zoomed out (${o.handles.farZoomedOut}) and is not zoomed in (${o.handles.farZoomedIn})`);

console.log("\n=== resizing, moving, and the aspect lock ===");
console.log(`   e +30 → ${rct(o.resize.east)}   nw -10,-20 → ${rct(o.resize.nw)}   move → ${rct(o.resize.moved)}`);
R.is(o.resize.east.x === 40 && o.resize.east.w === 130 && o.resize.east.h === 50,
  "an east handle moves the right edge and nothing else — the vertical delta is ignored, however far the pointer wandered");
R.is(o.resize.nw.x === 30 && o.resize.nw.y === 40 && o.resize.nw.w === 110 && o.resize.nw.h === 70,
  "a corner moves two edges and leaves the opposite corner pinned");
R.is(o.resize.moved.w === 100 && o.resize.moved.h === 50, "a move keeps its size");
R.is(o.resize.pinned.w === 100 && o.resize.pinned.h === 50 && o.resize.pinned.x === 156,
  `and keeps it at the edge of the sheet (${rct(o.resize.pinned)}) — clamping the four edges one at a time would have shrunk it silently instead of stopping it`);
R.is(Math.abs(o.resize.lockRatio - o.resize.wasRatio) < 1e-6,
  `locked, the shape survives the resize (${o.resize.lockRatio.toFixed(3)} against ${o.resize.wasRatio})`);

console.log("\n=== outside() is the exact complement ===");
R.is(o.bands.count === 4 && o.bands.area === o.bands.want,
  `four bands, ${o.bands.area} texels, which is the sheet minus the rectangle (${o.bands.want}) — so they neither overlap nor leave a gap`);
R.is(o.bands.insideLit === 0, `nothing inside the rectangle is covered (${o.bands.insideLit} texels)`);
R.is(o.bands.outsideDark === 0, `and nothing outside it is missed (${o.bands.outsideDark} texels)`);

console.log("\n=== fill writes the rectangle, and only the rectangle ===");
console.log(`   ${box(o.fill.box)}, wanted ${box(o.fill.want)}`);
R.is(o.fill.box.x === 32 && o.fill.box.y === 48 && o.fill.box.w === 64 && o.fill.box.h === 40 && o.fill.box.n === 64 * 40,
  "every texel inside is painted and not one outside is");
R.is(o.fill.partials === 0,
  `and the edge is HARD — ${o.fill.partials} partially covered texels. A clipped fill would leave a ring of them, which is invisible on screen and permanent in the export`);
R.is(o.fill.inColour[0] > 240 && o.fill.inColour[1] < 20, `it is the brush's own colour (rgb ${o.fill.inColour.slice(0, 3).join(",")})`);
R.is(o.fill.corner === 255 && o.fill.justOut === 0, `the boundary is exactly where the numbers say (in ${o.fill.corner}, one texel out ${o.fill.justOut})`);
R.is(o.fill.steps === 1, `one undo step, not one per band (${o.fill.steps})`);
R.is(o.fill.undoneEmpty === 0 && o.fill.redoneSame, "undo empties the layer again and redo puts back the identical pixels");

console.log("\n=== clear takes out the rectangle ===");
R.is(o.clear.hole === 0 && o.clear.keptOutside === 255, `a hole inside (${o.clear.hole}), untouched outside (${o.clear.keptOutside})`);
R.is(o.clear.edgeIn === 0 && o.clear.edgeOut === 255, `with the same hard boundary (in ${o.clear.edgeIn}, one out ${o.clear.edgeOut})`);
R.is(o.clear.partials === 0, `and no antialiased seam (${o.clear.partials} partial texels)`);
R.is(o.clear.steps === 1 && o.clear.undoneExact, "one step, and undo restores the sheet byte for byte");

console.log("\n=== crop is the same verb pointed outwards ===");
console.log(`   what survives: ${box(o.crop.box)}`);
R.is(o.crop.box.x === 32 && o.crop.box.y === 48 && o.crop.box.w === 64 && o.crop.box.h === 40,
  "exactly the selection survives");
R.is(o.crop.outside === 0 && o.crop.inside[3] === 255 && o.crop.partials === 0,
  `everything outside is gone, the inside is untouched, and there is no seam between them (${o.crop.partials} partial texels)`);
R.is(o.crop.steps === 1 && o.crop.undoneExact, "one undo step for the whole crop, and it restores the sheet byte for byte");
R.is(o.crop.redoneBox.w === 64 && o.crop.redoneBox.h === 40, "redo crops it again");
console.log(`   undo cost ${(o.crop.costBytes / 1024).toFixed(0)} KB — the four bands are ${(o.crop.bandBytes / 1024).toFixed(0)} KB, the whole sheet would be ${(o.crop.sheetBytes / 1024).toFixed(0)} KB`);
R.is(o.crop.costBytes === o.crop.bandBytes,
  "and it costs the bands rather than a copy of the sheet — the whole reason bakeRegionAction takes a list of rectangles");

console.log("\n=== a selection belongs to one sheet ===");
R.is(o.perSheet.onOther === null,
  "switching slots does not carry it across — the same four numbers mean a different place on a differently sized sheet");
R.is(o.perSheet.back && o.perSheet.back.w === 40, `and it is still there when you switch back (${rct(o.perSheet.back)})`);
R.is(o.resized.clamped && o.resized.clamped.x === 100 && o.resized.clamped.w === 60,
  `resizing the sheet under a live selection clamps it to what is left (${rct(o.resized.clamped)}) — a rectangle naming texels the sheet no longer has would hand every verb an out-of-bounds region`);
R.is(o.resized.gone === null, "and a sheet smaller than the rectangle's own origin leaves no selection at all, rather than a negative one");

console.log("\n=== the gesture ===");
console.log(`   drag → ${rct(o.gesture.dragged)}   east handle +25 → ${rct(o.gesture.resized)}`);
R.is(o.gesture.dragged && o.gesture.dragged.x === 20 && o.gesture.dragged.w === 41, `a drag makes the rectangle it looks like (${rct(o.gesture.dragged)})`);
R.is(o.gesture.ints, "at a fractional zoom, off fractional texel positions, every number is still an integer");
R.is(o.gesture.resized && o.gesture.resized.w === 66 && o.gesture.resized.y === o.gesture.dragged.y,
  `grabbing a handle resizes rather than starting a new rectangle (${rct(o.gesture.resized)})`);
R.is(o.gesture.afterClick === null, "and a click that goes nowhere deselects, which is the only way anyone expects to get rid of one");

console.log("\n=== the brush is confined to the selection ===");
console.log(`   a 60-px brush walked from 120,120 out to 90,120 left: ${box(o.confine.box)}`);
R.is(o.confine.box.x >= 100 && o.confine.box.y >= 100 && o.confine.box.x + o.confine.box.w <= 140 && o.confine.box.y + o.confine.box.h <= 140,
  "nothing landed outside the rectangle, in either direction");
R.is(o.confine.inside > 0 && o.confine.outsideLeft === 0,
  `paint inside (${o.confine.inside}) and none at 95,120 (${o.confine.outsideLeft}), where the brush certainly reached`);

console.log("\n=== fill respects the same shield the brush does ===");
R.is(o.shield.leftHalf === 255 && o.shield.rightHalf === 0,
  `with one part selected, a whole-sheet fill lands only on it (selected ${o.shield.leftHalf}, unselected ${o.shield.rightHalf})`);
R.is(o.shield.sameStencil,
  `and it is the SAME stencil beginStroke builds, pixel for pixel at ${o.shield.dims} — the two are written separately because the stroke also has to decide whether to refuse itself, so this is what stops one rule becoming two`);

console.log("\n=== clear and crop ignore it, deliberately ===");
R.is(o.cropIgnoresShield.keptInside === 255 &&
     o.cropIgnoresShield.clearedOnSelected === 0 && o.cropIgnoresShield.clearedElsewhere === 0,
  "a crop clears everything outside the rectangle including the selected part — it only ever takes away pixels this layer already owns, and a crop that left something outside would not be a crop");

console.log("\n=== copy lands as an image layer, in place ===");
R.is(o.copy.type === "decal" && o.copy.w === 30 && o.copy.h === 20,
  `the selected texels become a ${o.copy.w}×${o.copy.h} image layer`);
R.is(Math.abs(o.copy.cx - 55 / 256) < 1e-6 && Math.abs(o.copy.cy - 60 / 256) < 1e-6 && o.copy.scale === 1,
  "centred exactly where it was taken from, at scale 1 — so the copy sits on the original until you move it");
R.is(o.copy.pixel && o.copy.pixel[1] > 180 && o.copy.pixel[3] === 255, `carrying the pixels, not a blank (rgba ${o.copy.pixel.join(",")})`);

console.log("\n=== a copy comes off a channel, and lands on the same one ===");
console.log("   " + JSON.stringify(o.copyChan));
R.is(o.copyChan.chan === "smooth" && o.copyChan.carries === "smooth",
  `a copy taken while working on the smoothness channel lands on smoothness (${o.copyChan.chan}) — it used to be built with no channel at all, so the pixels of a surface map arrived on the albedo (ROADMAP 4.34(b))`);
R.is(o.copyChan.w === 15 && o.copyChan.h === 10,
  `the bitmap is the rectangle in the SOURCE sheet's pixels (${o.copyChan.w}×${o.copyChan.h}), because that is where the texels are`);
R.is(Math.abs(o.copyChan.scale - 2) < 1e-9,
  `...and its scale puts it back over the texels it came from (${o.copyChan.scale}) — the _n is half the albedo here, and a decal's scale is in COMPOSITE texels, so scale 1 would have landed it at half size`);
R.is(o.copyChan.pixel && o.copyChan.pixel[0] > 200 && o.copyChan.pixel[3] === 255,
  `carrying the smoothness pixels, not the albedo's (rgba ${(o.copyChan.pixel || []).join(",")})`);

console.log("\n=== Auto view follows the channel you are in, not the layer's primary slot ===");
console.log("   " + JSON.stringify(o.autoView));
R.is(o.autoView.primary === "color" && o.autoView.carries === "color,smooth",
  "the case only exists since 4.28(e): one layer whose primary slot and working channel differ");
R.is(o.autoView.onSmooth === "smooth",
  `with the brush on smoothness the view follows it (${o.autoView.onSmooth}) — it used to ask layerChan and follow the primary slot, so the view showed a channel the user was not editing (ROADMAP 4.34(a))`);
R.is(o.autoView.onColor === "shaded",
  `and with the brush back on colour it goes back to shaded (${o.autoView.onColor}), which is 3.16's rule unchanged`);

console.log("\n=== the controls say what the tool is doing ===");
R.is(o.ui.idleStays, "the panel is a PLACE: with the tool off and nothing selected it is still there, because a section that appeared and vanished with M and K moved the sidebar under the cursor (reported 2026-09-01)");
R.is(o.ui.shownWithTool, "and it is still there with the tool on");
R.is(o.ui.labels === "Select: on / Select: on" && o.ui.bothActive,
  `both switches are the one switch, and both show it (${o.ui.labels})`);
R.is(o.ui.verbsOff, "with no selection every verb is disabled rather than offering to act on nothing");
R.is(o.ui.verbsOn, "and with one they are all live");
R.is(o.ui.fields === "5,6,70,80", `the four boxes are the rectangle (${o.ui.fields})`);
R.is(o.ui.typed && o.ui.typed.w === 33 && o.ui.typed.h === 21 && o.ui.typed.x === 5,
  `and typing into them is the other half of the same gesture (${rct(o.ui.typed)})`);
console.log(`   outside the rectangle: tool on ${o.dim.onOutside}, tool off ${o.dim.offOutside} (the sheet is 128)`);
R.is(o.dim.onOutside < 100 && o.dim.offOutside === 128,
  "the dim belongs to the TOOL — with Select off you are painting beside the selection, and 45% of black over most of the sheet is the last thing between someone and the colour they are judging");
R.is(o.dim.onInside === 128 && o.dim.offInside === 128, "inside is never dimmed, in either mode");
R.is(o.dim.onEdge !== 128 && o.dim.offEdge !== 128,
  "but the outline is drawn in both, because the selection is still confining the brush after the tool goes off");
R.is(o.ui.fit.bar && o.ui.fit.rows && o.ui.fit.over <= 0,
  `nothing in the panel overruns the sidebar (${o.ui.fit.over} px past its right edge) — four number spinners in two rows is exactly the shape that overran it twice before`);

console.log("\n=== and the verbs refuse in words ===");
console.log(`   no selection: ${o.refuse.noSel}\n   no layer:     ${o.refuse.noLayer}`);
R.is(/selection first/i.test(o.refuse.noSel), "crop with nothing selected says so");
R.is(/paint layer/i.test(o.refuse.noLayer), "crop with no layer says which layer it wanted");
R.is(o.refuse.fillMadeLayer && /Filled/i.test(o.refuse.fillSaid),
  `but Fill makes the layer the first stroke would have made, and says what it did (${o.refuse.fillSaid})`);
R.is(o.refuse.fillSteps === 1 && o.refuse.afterUndo,
  `and taking it back is one Ctrl+Z (${o.refuse.fillSteps} step), layer and all — otherwise the second undo is a bare empty layer nobody asked for`);

console.log("\n=== a UV island is a selection, and every verb follows its shape (4.24) ===");
const I = o.isl;
console.log(`   ${I.islandsTotal} islands on the sheet · picked ${I.n} · box ${I.box ? I.box.x + "," + I.box.y + " " + I.box.w + "×" + I.box.h : "none"}`);
console.log(`   fill in/boxOut/far ${I.fill.inside}/${I.fill.boxOut}/${I.fill.far}  ·  clear ${I.clear.hole}/${I.clear.boxOut}/${I.clear.far}` +
  `  ·  crop ${I.crop.kept}/${I.crop.boxOut}/${I.crop.far}  ·  stroke ${I.stroke.inside}/${I.stroke.boxOut}/${I.stroke.far}`);
R.is(I.islandsTotal === 2 && I.n === 1 && I.hasShape,
  `a click takes one island of the two and it carries a SHAPE, not just a box (${I.n} of ${I.islandsTotal})`);
R.is(I.fill.inside > 0 && I.fill.boxOut === 0 && I.fill.far === 0,
  `Fill paints the island and not the rest of its bounding box (${I.fill.inside} inside, ${I.fill.boxOut} in the box corner) — the island is a triangle, so its box is twice its area and "followed the box" would be visible here`);
R.is(I.clear.hole === 0 && I.clear.boxOut > 0 && I.clear.far > 0,
  `Clear takes out the island and leaves the rest of the box standing (${I.clear.hole} / ${I.clear.boxOut})`);
R.is(I.crop.kept > 0 && I.crop.boxOut === 0 && I.crop.far === 0,
  `Crop keeps the island and clears everything else, the rest of its own box included (${I.crop.kept} / ${I.crop.boxOut} / ${I.crop.far})`);
R.is(!!I.copy && I.copy.inside > 0 && I.copy.boxOut === 0,
  `Copy carries the island's silhouette rather than a rectangle of its neighbours (${I.copy ? I.copy.w + "×" + I.copy.h + ", " + I.copy.inside + " / " + I.copy.boxOut : "no layer"})`);
R.is(I.stroke.inside > 0 && I.stroke.boxOut === 0 && I.stroke.far === 0,
  `and the brush is confined to it: a stroke walked from inside, through the box corner, to the other island paints only inside (${I.stroke.inside} / ${I.stroke.boxOut} / ${I.stroke.far})`);
R.is(I.dropped, "dragging a rectangle afterwards REPLACES the shape — there is no gesture meaning “keep the island but move its box”, and a box the four number fields did not control would be a lie");
R.is(I.added === 2 && I.removed === 1,
  `shift+click adds an island and alt+click takes it back out (${I.added} → ${I.removed}), the same two modifiers the part picker uses`);
R.is(I.afterGutter === null && /gutter/i.test(I.gutterSaid || ""),
  `a click on gutter clears the selection and says why (“${I.gutterSaid}”) rather than doing nothing`);

console.log("\n=== a selection steps back like everything else you make ===");
const H = o.hist;
console.log(`   pick ${H.pickSteps} step · undo ${rct(H.afterUndo)} · redo ${H.afterRedo} island(s)` +
  `  ·  drag ${H.dragSteps} step over 3 move frames · toggle-off ${H.toggleSteps} step`);
R.is(H.picked === 1 && H.pickSteps === 1 && H.afterUndo === null && H.afterRedo === 1 && H.redoShape,
  `an island pick is one undo step, and redo brings back the SHAPE and not just its box (${H.pickSteps} step, ${H.afterRedo} island back)`);
R.is(H.two === 2 && H.backToOne === 1,
  `shift+click is its own step, so one undo takes the second island off and keeps the first (${H.two} → ${H.backToOne})`);
R.is(H.noopSteps === 0,
  `a click that changed nothing is not a step (${H.noopSteps}) — history is for what you did, and gutter clicks are most of what a click on a sheet is`);
R.is(H.afterToggleOff === null && H.toggleSteps === 1 && H.toggleUndone === 1,
  `turning UV island mode off RELEASES the island (${H.toggleSteps} step, undo restores ${H.toggleUndone}) — an island selection cannot be resized, moved or typed into, so one left in force with its own mode off is a restriction with nothing left in the UI to lift it`);
R.is(H.dragSteps === 1 && H.dragged !== null && H.dragUndone === null,
  `and a drag is ONE entry however many frames it took (${H.dragSteps} over 3 move frames) — Marquee.set runs per frame, and one entry per frame is a history nobody can walk back`);

console.log("\n=== the two bridges between a selection and a mask (4.28(g)) ===");
const BR = o.bridge;
console.log(`   -> mask: ${BR.maskSize && BR.maskSize.join("x")}, inside ${BR.inside && BR.inside.join(",")}, outside ${BR.outside && BR.outside.join(",")}, ink box ${JSON.stringify(BR.box)}`);
R.is(BR.made && BR.hasMask, "a selection becomes the active layer's mask — the button that did this saw only the PART selection, so the rectangle you had just dragged was one of the two shapes it could not read");
R.is(BR.inside && BR.inside[0] > 200 && BR.inside[3] > 200 && BR.outside && BR.outside[3] === 0,
  `white inside the selection and nothing outside it (${BR.inside && BR.inside.join(",")} / ${BR.outside && BR.outside.join(",")}) — a mask is read as luminance times its own alpha, so both halves matter`);
R.is(BR.box && BR.box.x === 40 && BR.box.y === 60 && BR.box.w === 50 && BR.box.h === 30,
  `and the ink is exactly the rectangle (${BR.box && [BR.box.x, BR.box.y, BR.box.w, BR.box.h].join(",")}), not the mask-resolution stencil it was built from scaled up by eye`);
R.is(BR.selStays, "the selection is not consumed — it is a shape you go on working with, and a command that silently dropped it would be one you have to re-make");
R.is(BR.undone && BR.redone, "and it is one undo step, like every other thing that touches a mask");
console.log(`   <- selection: box ${JSON.stringify(BR.from)}, shape=${BR.fromShape}, islands=${BR.fromIslands}, in ${BR.shapeIn} corner ${BR.shapeCorner}`);
R.is(BR.fromOk && BR.fromShape && !BR.fromIslands,
  "and a mask becomes a selection, which had no control at all in either direction — a SHAPE, not the box round it, and not an island pick either: there is no id to rebuild it from");
R.is(BR.from && BR.from.w <= 64 && BR.from.h <= 64 && BR.from.x >= 125 && BR.from.y >= 65,
  `the box is the ink's own extent (${BR.from && [BR.from.x, BR.from.y, BR.from.w, BR.from.h].join(",")}) — a 60 px circle at 160,100 on a 256² sheet, found by threshold rather than assumed`);
R.is(BR.shapeIn > 200 && BR.shapeCorner === 0,
  `and the stencil follows the circle, not its bounding box (${BR.shapeIn} at the middle, ${BR.shapeCorner} at a corner of the box) — which is what makes Fill, Crop and Copy follow a shape you painted`);
R.is(BR.undoneSel && BR.redoneShape,
  "a shape no island id can rebuild still steps back and forward: the snapshot holds this one by reference, which is the exception the history note names and the reason it is safe — one canvas per explicit command, not two per click of a gesture");
console.log(`   empty mask: ${BR.emptySaid}`);
R.is(/nothing light/.test(BR.emptySaid || ""), "a mask with nothing light in it says so rather than selecting nothing");
console.log(`   no selection: ${BR.noSelSaid}`);
R.is(/Select something first|Nothing is selected/.test(BR.noSelSaid || ""),
  "and with nothing selected the forward direction says what to select with, rather than doing nothing");

console.log("\n=== a layer's limit is a selection recipe (4.28(g)) ===");
const LM = o.lim;
console.log(`   inherited ${JSON.stringify(LM.inherited)} · label "${LM.label}" · stencil in ${LM.stIn} out ${LM.stOut} · painted in ${LM.paintedIn} out ${LM.paintedOut}`);
R.is(LM.inherited && LM.inherited.rect && LM.inherited.rect.w === 60 && !LM.partsHalf,
  `a new layer inherits the RECTANGLE that is up, not only the parts (${JSON.stringify(LM.inherited && LM.inherited.rect)}) — before this the marquee was silently not carried, and baking it into a mask was the only way to keep it`);
R.is(/60×40 box/.test(LM.label || ""), `and the panel names what it actually is (${LM.label})`);
R.is(LM.stencil && LM.stIn > 200 && LM.stOut === 0,
  `the stencil is that rectangle (${LM.stIn} inside, ${LM.stOut} outside) — and it is built with NO model loaded, which a parts-only scope could never be`);
R.is(LM.paintedIn > 200 && LM.paintedOut === 0,
  `a stroke lands inside the limit and nowhere else (${LM.paintedIn} / ${LM.paintedOut}), with the selection dropped first — so what confined it is the layer's own limit, which is the whole reason to store one instead of working inside a live marquee`);
R.is(LM.cleared && /60×40 box/.test(LM.undone || ""),
  `clearing it frees the sheet and one undo puts it back (${LM.undone})`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
console.log("\n=== parts and islands are two grains of one selection ===");
var B = o.br;
R.is(/no parts are selected/i.test(B.refuseNoParts), "with nothing selected the bridge says what to do instead of doing nothing");
R.is(B.fromParts === 1 && B.fromPartsShape && B.fromPartsIn,
  "the islands of a selected part come across as a SHAPE, not as its bounding box");
R.is(B.fromPartsSteps === 1, "and as one undo step, like every other way of making a selection");
R.is(B.toParts === "tri", `the other direction REPLACES the part selection with the parts those islands cover — “far” was selected, the island came from “tri”, and afterwards it is “${B.toParts}”`);
R.is(B.toPartsSteps === 2, "which is its own step too");
R.is(B.overlayKids === 2 && B.overlaySharesGeom,
  "the selection is on the MODEL as well: one overlay per part on this sheet, sharing the part's own geometry rather than a copy of it");
R.is(B.overlayUnlit, "unlit and depth-write off, so it reads the same on a shadowed underside as on a lit deck and never fights the surface it sits on");
R.is(B.overlayGone === 0, "and it comes off when the selection does");
R.is(B.panelStays && /part/i.test(B.partInfo || ""),
  "the panel stays put and carries the part count, so the two grains are one panel instead of two tabs");
R.is(B.bridgeOffNoIslands, "with no islands selected the reverse bridge is disabled rather than offering to act on nothing");

R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
