// A path is a layer (ROADMAP 4.52 (3)–(5)).
//
// WHY THIS EXISTS. Fill and Stamp along used to bake a path into whatever layer was selected, once,
// so a blotch could not be reshaped and a row of rivets could not be re-spaced. A path layer keeps the
// recipe — the path, the verb, the brush and its seed — and redraws its pixels from it. Every property
// that makes that right is read off the layer's own pixels here, in the real page:
//
//   * Fill with the Brush makes a new layer, filled, and the shape tool keeps editing ITS path;
//   * moving a node redraws the layer, and that is ONE undo step that puts both the node and the
//     pixels back; recolouring is Fill again with another colour, one step, no new layer;
//   * a stamp layer with every random dynamic on redraws to the same bytes (the stored seed);
//   * the brush cannot paint on one (its pixels would be redrawn away), and a duplicate is a plain
//     paint layer that keeps the pixels;
//   * Esc lets go and the layer keeps its path; selecting the layer again takes it up;
//   * the project writes the recipe and reads it back field for field, says version 6 only when it
//     holds one, a v6 file passes the gate and a v7 one does not; a crafted recipe is data.
//
// Usage: node tools/t147_pathlayer.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t147", size: N, nSize: N, layers: [], missing: false, baseC: grey(), composite: grey(), normal: null };
  App.slots.set("t147", s); App.activeSlot = s;
  setBrushMode("color");
  App.brush.color = "#ff0000"; App.brush.size = 16; App.brush.spacing = .5; App.brush.opacity = 1; App.brush.flow = 1;
  var base = LayerNode.of({ type: "paint", name: "base", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
  s.layers = [base]; App.activeLayer = base;
  App.undoStack.length = 0; App.redoStack.length = 0;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var hash = function(c){ var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, h = 2166136261;
    for (var i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; };
  var painted = function(c){ var d = ctx2d(c).getImageData(0, 0, N, N).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; };
  var ev = { altKey: false, ctrlKey: false, shiftKey: false, button: 0 };
  $("pathAsLayer").checked = true;
  PathUI.set(true);
  var mk = function(pts, closed){ PathUI.clear(); PathUI.path = Path.make(); pts.forEach(function(q){ Path.add(PathUI.path, q[0], q[1]); }); PathUI.path.closed = !!closed; PathUI.sync(); };

  // ---- Fill makes a layer ----
  mk([[64, 64], [160, 64], [160, 160], [64, 160]], true);
  var steps0 = App.undoStack.length;
  PathUI.fill();
  var L = App.activeLayer, c = LayerNode.contentOn(L, "color");
  out.fill = { n: s.layers.length, name: L && L.name, shape: !!(c && c.shape), bound: PathUI.layer === L, same: PathUI.path === (c && c.shape.path),
    inside: px(c.canvas, 100, 100), outside: px(c.canvas, 200, 200), base: painted(base.canvas), steps: App.undoStack.length - steps0,
    status: $("status").textContent, info: $("pathInfo").textContent };

  // ---- a node moved redraws it, as one step ----
  var before = App.undoStack.length;
  PathUI.down(ev, { x: 160, y: 160 }); PathUI.move(ev, { x: 220, y: 220 }); PathUI.up();
  out.move = { at: px(c.canvas, 200, 195), steps: App.undoStack.length - before, node: [PathUI.path.pts[2].x, PathUI.path.pts[2].y] };
  doUndo();
  out.move.undone = { at: px(c.canvas, 200, 195), node: [PathUI.path.pts[2].x, PathUI.path.pts[2].y] };
  doRedo();
  out.move.redone = { at: px(c.canvas, 200, 195), node: [PathUI.path.pts[2].x, PathUI.path.pts[2].y] };
  // a click that changes nothing makes no step
  before = App.undoStack.length;
  PathUI.down(ev, { x: 64, y: 64 }); PathUI.up();
  out.move.noop = App.undoStack.length - before;

  // ---- Fill again with another colour: the same layer, one step ----
  App.brush.color = "#0000ff";
  before = App.undoStack.length;
  PathUI.fill();
  out.recolour = { n: s.layers.length, at: px(c.canvas, 100, 100), steps: App.undoStack.length - before };
  doUndo();
  out.recolour.undone = px(c.canvas, 100, 100);
  doRedo();

  // ---- move, scale and turn the whole path: one step each, the layer redrawn (4.52 (5)) ----
  var xf = {}, at = function(){ return [PathUI.path.pts[0].x, PathUI.path.pts[0].y].map(function(v){ return Math.round(v * 100) / 100; }); };
  PathUI.setXf(true);
  xf.on = PathUI.xfOn && $("btnPathXf").classList.contains("active");
  var B = PathUI.xfBox(PathUI.path);
  before = App.undoStack.length;
  PathUI.down(ev, { x: B.cx, y: B.cy }); PathUI.move(ev, { x: B.cx + 20, y: B.cy + 10 }); PathUI.up();
  xf.moved = { node: at(), n: PathUI.path.pts.length, px: px(c.canvas, 175, 170), steps: App.undoStack.length - before };
  B = PathUI.xfBox(PathUI.path);
  PathUI.down(ev, { x: B.corners[2][0], y: B.corners[2][1] }); PathUI.move(ev, { x: B.cx + (B.corners[2][0] - B.cx) * .5, y: B.cy + (B.corners[2][1] - B.cy) * .5 }); PathUI.up();
  xf.scaled = { px: px(c.canvas, 90, 90), steps: App.undoStack.length - before };
  B = PathUI.xfBox(PathUI.path);
  PathUI.down(ev, { x: B.knob[0], y: B.knob[1] }); PathUI.move({ shiftKey: true }, { x: B.cx + (B.cy - B.knob[1]), y: B.cy }); PathUI.up();
  xf.turned = { steps: App.undoStack.length - before, node: at() };
  doUndo(); doUndo(); doUndo();
  xf.back = { node: at(), px: px(c.canvas, 90, 90) };
  PathUI.down(ev, { x: 2, y: 250 }); PathUI.up();            // off the box: not a point, not a step
  xf.outside = { n: PathUI.path.pts.length, steps: App.undoStack.length - before };     // the three were undone just above
  PathUI.setXf(false);
  out.xf = xf;

  // ---- the brush cannot paint on it; a duplicate is a plain paint layer ----
  App.activeLayer = L;
  out.refused = { began: beginStroke(false, false), said: $("status").textContent };
  if (stroke) endStroke();
  duplicateLayer(s, L);
  var D = App.activeLayer, dc = LayerNode.contentOn(D, "color");
  out.dup = { other: D !== L, shape: !!(dc && dc.shape), at: dc ? px(dc.canvas, 100, 100) : null, began: false };
  App.activeLayer = D; out.dup.began = beginStroke(false, false); if (stroke) endStroke();
  doUndo();                                                    // the duplicate goes again
  App.activeLayer = L;

  // ---- Esc lets go; selecting the layer takes it up again ----
  PathUI.clear();
  out.esc = { layer: !!PathLayer.of(L), bound: PathUI.layer, path: PathUI.path };
  App.activeLayer = base; PathUI.sync();
  App.activeLayer = L; PathUI.sync();
  out.esc.back = PathUI.layer === L && PathUI.path === c.shape.path;

  // ---- a stamp layer with every dynamic on redraws to the same bytes ----
  PathUI.clear(); App.activeLayer = base; PathUI.sync();
  App.brush.color = "#00ff00"; App.brush.scatter = 1; App.brush.sizeJit = .5; App.brush.flowJit = .5; App.brush.angleJit = .3;
  mk([[30, 230], [230, 230]], false);
  PathUI.stamp();
  var S = App.activeLayer, sc = LayerNode.contentOn(S, "color");
  out.stamp = { other: S !== L && S !== base, verb: sc && sc.shape && sc.shape.verb, n: painted(sc.canvas), h1: hash(sc.canvas) };
  PathLayer.draw(s, S); out.stamp.h2 = hash(sc.canvas);
  App.brush.scatter = 0; App.brush.sizeJit = 0; App.brush.flowJit = 0; App.brush.angleJit = 0;
  PathLayer.draw(s, S); out.stamp.h3 = hash(sc.canvas);           // the live brush changed; the layer's did not

  // ---- Colour along on a Stamp along, as a layer and one-shot (fix plan 2026-10-23, step 2) ----
  // The walk's points are one step apart, so the run along the path is known exactly: a Hue
  // cycle two sizes long (32 texels at size 16, Spacing .5) turns a quarter of the wheel every dab.
  var hues = function(c, y){ var seen = {}; for (var x = 24; x < 232; x += 8) { var a = px(c, x, y); if (a[3] > 200) seen[(a[0] >> 5) + "," + (a[1] >> 5) + "," + (a[2] >> 5)] = 1; } return Object.keys(seen).length; };
  var ca = {};
  PathUI.clear(); App.activeLayer = base; PathUI.sync();
  App.brush.color = "#ff0000"; App.brush.cycle = "hue"; App.brush.cycleLen = 2;
  mk([[20, 40], [236, 40]], false);
  PathUI.stamp();
  var CL = App.activeLayer, cc = LayerNode.contentOn(CL, "color");
  ca.layer = { other: CL !== base && CL !== S, hues: hues(cc.canvas, 40), cycle: cc.shape.brush.cycle, h1: hash(cc.canvas) };
  App.brush.cycle = "off"; PathLayer.draw(s, CL); ca.layer.h2 = hash(cc.canvas);      // redrawn with the brush in hand not cycling
  var keepCycle = cc.shape.brush.cycle; delete cc.shape.brush.cycle; App.brush.cycle = "hue";
  PathLayer.draw(s, CL); ca.layer.old = hues(cc.canvas, 40);                           // a recipe from before the field: Off
  cc.shape.brush.cycle = keepCycle; App.brush.cycle = "off"; PathLayer.draw(s, CL);
  PathUI.clear(); s.layers = s.layers.filter(function(l){ return l !== CL; });   // the presets below count the layers App.activeLayer = base; PathUI.sync();
  $("pathAsLayer").checked = false; App.brush.cycle = "hue";
  mk([[20, 90], [236, 90]], false);
  PathUI.stamp();
  var OL = App.activeLayer, oc = LayerNode.contentOn(OL, "color");
  ca.oneShot = { plain: !PathLayer.of(OL), hues: hues(oc.canvas, 90) };
  s.layers = s.layers.filter(function(l){ return l !== OL; }); App.activeLayer = base;
  ctx2d(base.canvas).clearRect(0, 0, N, N);
  App.brush.cycle = "off"; $("pathAsLayer").checked = true;
  out.colourAlong = ca;

  // ---- presets (4.52 (4)) ----
  var pr = {};
  App.activeLayer = L; PathUI.clear(); App.activeLayer = base; PathUI.sync(); App.activeLayer = L; PathUI.sync();   // take the fill layer up again
  pr.bound = PathUI.layer === L;
  await PathUI.save();
  var idx = await PathLib.index();
  pr.saved = { n: idx.length, name: idx[0] && idx[0].name, verb: idx[0] && idx[0].verb, said: $("status").textContent,
               offered: $("pathPreset").value === (idx[0] && idx[0].id) && !$("btnPathUse").disabled };
  // used on a sheet twice the size: a layer of its own, the path at that sheet's scale, its own brush
  var big = { id: "t147b", size: 2 * N, nSize: 2 * N, layers: [], missing: false, baseC: mkCanvas(2 * N, 2 * N), composite: mkCanvas(2 * N, 2 * N), normal: null };
  App.slots.set(big.id, big); App.activeSlot = big; App.activeLayer = null;
  App.brush.color = "#00ff00";
  await PathUI.use();
  var U = App.activeLayer, uc = U && LayerNode.contentOn(U, "color");
  pr.used = { layers: big.layers.length, bound: PathUI.layer === U, first: uc && [uc.shape.path.pts[0].x, uc.shape.path.pts[0].y], size: uc && uc.shape.brush.size,
              brush: uc && uc.shape.brush.color, px: uc && px(uc.canvas, 200, 200), said: $("status").textContent };
  // a path alone
  App.activeSlot = s; App.activeLayer = base; PathUI.clear();
  PathUI.path = Path.make(); Path.add(PathUI.path, 10, 10); Path.add(PathUI.path, 50, 30); PathUI.sync();
  await PathUI.save();
  idx = await PathLib.index();
  pr.alone = { verb: idx[0].verb, n: idx.length };
  PathUI.clear();
  await PathUI.use();
  pr.alone.path = PathUI.path && PathUI.path.pts.length; pr.alone.layer = PathUI.layer; pr.alone.layers = s.layers.length;
  // forget both
  await PathUI.forget(); $("pathPreset").value = (await PathLib.index())[0].id; await PathUI.forget();
  pr.forgot = { n: (await PathLib.index()).length, off: $("btnPathUse").disabled };
  pr.junk = [await PathLib.get("nope"), await (async function(){ await idbSet("path:junk", { shape: { path: { pts: "x" } } }); return PathLib.get("junk"); })()];
  out.presets = pr;
  // ---- found in review (2026-10-23) ----
  var rv = {};
  // a path-only preset laid while a path layer is selected is a free path, not that layer's
  App.activeSlot = s; App.activeLayer = L; PathUI.clear(); PathUI.sync();
  await (async function(){ PathUI.path = Path.make(); Path.add(PathUI.path, 5, 5); Path.add(PathUI.path, 40, 9); await PathUI.save(); })();
  App.activeLayer = L; PathUI.clear();
  await PathUI.use();
  rv.useAlone = { layer: PathUI.layer, n: PathUI.path && PathUI.path.pts.length };
  await PathUI.forget();
  // Esc in the middle of a drag on a path layer: the drag is its own step, and the next gesture is another
  App.activeLayer = base; PathUI.clear(); App.activeLayer = L; PathUI.sync();
  var d0 = App.undoStack.length;
  PathUI.down(ev, { x: 64, y: 64 }); PathUI.move(ev, { x: 70, y: 70 });
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
  PathUI.up();
  rv.esc = { steps: App.undoStack.length - d0, pending: PathLayer.pending };
  App.activeLayer = base; PathUI.sync(); App.activeLayer = L; PathUI.sync();
  PathUI.down(ev, { x: 70, y: 70 }); PathUI.move(ev, { x: 64, y: 64 }); PathUI.up();
  doUndo();
  rv.esc.afterUndo = [PathUI.path.pts[0].x, PathUI.path.pts[0].y];
  // a model click with a sheet path layer held writes nothing into it
  var nodes = c.shape.path.pts.length;
  rv.model = { took: PathUI.down3d({ button: 0, clientX: 5, clientY: 5, ctrlKey: false, altKey: false }), n: c.shape.path.pts.length === nodes, frame: PathUI.frame };
  // a resize takes the recipe with the pixels
  PathUI.clear();
  var probe = [c.shape.path.pts[2].x, c.shape.path.pts[2].y];
  resizeSlot(s, 2 * N, 2 * N); flushComposites();
  rv.resize = { node: [c.shape.path.pts[2].x, c.shape.path.pts[2].y], was: probe, w: c.canvas.width };
  PathLayer.draw(s, L);
  rv.resize.inside = px(c.canvas, 200, 200); rv.resize.far = px(c.canvas, 480, 100);
  resizeSlot(s, N, N); flushComposites();
  // moving the content to another map lets go of the recipe, and undo gives it back
  ChanStrip.move(s, L, "color", "smooth");
  rv.chan = { moved: !LayerNode.contentOn(L, "color") && !!LayerNode.contentOn(L, "smooth"), shape: !!LayerNode.contentOn(L, "smooth").shape };
  doUndo();
  rv.chan.back = !!(LayerNode.contentOn(L, "color") && LayerNode.contentOn(L, "color").shape);
  out.review = rv;
  App.slots.delete(big.id); App.activeSlot = s; App.activeLayer = L; PathUI.clear();

  // ---- the project ----
  var put = async function(){ return "x.png"; };
  var ctx = { put: put, heights: new Map() }, plain = { put: put, heights: new Map() };
  var rec = await ProjNode.save(L, ctx);
  await ProjNode.save(base, plain);
  var back = await ProjNode.load(JSON.parse(JSON.stringify(rec)), { img: async function(){ return mkCanvas(N, N); }, shared: new Map(), seq: 0, blank: null });
  var bc = LayerNode.contentOn(back, "color");
  out.proj = { v: ctx.version, plainV: plain.version, has: !!(rec.chans.color && rec.chans.color.shape),
    same: !!(bc && bc.shape) && JSON.stringify(PathLayer.save(bc.shape)) === JSON.stringify(PathLayer.save(c.shape)),
    gate6: ProjectFile.tooNew({ version: 6 }), gate7: ProjectFile.tooNew({ version: 7 }, 6), gate8: ProjectFile.tooNew({ version: 9 }) };
  // A path layer inside a group limited to some mip levels (4.58, version 7): the group is written
  // first, the path after it, and the file says 7 — a path never takes the version back down to 6.
  var both = { put: put, heights: new Map() };
  await ProjNode.save({ type: "group", name: "far", visible: true, opacity: 1, blend: "normal", children: [L], levels: Levels.far(3) }, both);
  out.proj.withLevels = both.version;
  var meta = (await ProjectFile.parts(function(){ return false; })).meta;
  out.proj.meta = meta.version;
  var crafted = PathLayer.load({ path: { pts: [{ x: "a", y: 3 }, null, { x: 1e400, y: 2, ix: 5 }], closed: 1, angle: 900, bias: -7 },
    verb: "evil", brush: { tool: "eraser", target: "mask", chan: "nope", color: "javascript:", size: Infinity, tip: 5, follow: "yes" }, seed: -1 });
  out.crafted = crafted;
  out.craftedNull = [PathLayer.load(null), PathLayer.load({ path: { pts: 3 } }), PathLayer.load("x")];

  PathUI.set(false); PathUI.clear();
  App.slots.delete("t147"); App.activeSlot = null; App.activeLayer = null;
  return out;
}`;

const r = (await evalInPage({ browser, expr: pageExpr(BODY, 300), keep: argv.includes("--keep"), timeoutMs: 120000 })).result || {};
if (r.__threw) { console.log("threw in page:\n" + r.__threw); process.exit(1); }
const J = JSON.stringify;
const red = a => a && a[0] > 200 && a[1] < 40 && a[2] < 40 && a[3] > 240;
const blue = a => a && a[2] > 200 && a[0] < 40 && a[3] > 240;

console.log("=== Fill makes a layer ===");
const F = r.fill || {};
R.is(F.n === 2 && F.name === "Path 1" && F.shape && F.bound && F.same, `Fill with the Brush makes a new layer, "${F.name}", that keeps the path — and the tool goes on editing that path (${F.n} layers)`);
R.is(red(F.inside) && F.outside[3] === 0 && F.base === 0, `it is filled inside (${F.inside}) and nowhere else, and the layer that was selected is untouched (${F.base} texels)`);
R.is(F.steps === 1 && /as “Path 1”/.test(F.status) && /“Path 1”/.test(F.info), `one undo step, and said: "${F.status.slice(0, 70)}…"`);
console.log("\n=== a node moved redraws it ===");
const M = r.move || {};
R.is(red(M.at) && J(M.node) === J([220, 220]) && M.steps === 1, `dragging a corner out redraws the fill to follow it (${M.at} where it was empty), in one step`);
R.is(M.undone.at[3] === 0 && J(M.undone.node) === J([160, 160]), "undo puts the node AND the pixels back");
R.is(red(M.redone.at) && J(M.redone.node) === J([220, 220]) && M.noop === 0, "redo takes them forward again, and a click that changes nothing makes no step");
const X5 = r.xf || {};
R.is(X5.on && J(X5.moved.node) === J([84, 74]) && X5.moved.n === 4 && blue(X5.moved.px) && X5.moved.steps === 1,
  `Move · scale · turn: a drag inside the box moves the whole path 20, 10 and the layer follows (${X5.moved.node}), one step, no point added (ROADMAP 4.52 (5))`);
R.is(X5.scaled.px[3] === 0 && X5.scaled.steps === 2, `a corner dragged halfway in scales it about its centre, and the layer shrinks with it (${X5.scaled.px} at 90, 90)`);
R.is(X5.turned.steps === 3 && J(X5.turned.node) !== J(X5.moved.node), `the knob turns it (Shift: in 15° steps), one step (${X5.turned.node})`);
R.is(J(X5.back.node) === J([64, 64]) && blue(X5.back.px), "three undos put the path and the pixels back where they were");
R.is(X5.outside.n === 4 && X5.outside.steps === 0, "a click off the box lays no point and makes no step");
const C = r.recolour || {};
R.is(C.n === 2 && blue(C.at) && C.steps === 1 && red(C.undone), `Fill again with another colour recolours the same layer, one step, no new layer (${C.at}, undone ${C.undone})`);
console.log("\n=== its pixels are the recipe's ===");
R.is(r.refused.began === false && /path layer/.test(r.refused.said), `the brush cannot paint on a path layer, and says why: "${r.refused.said.slice(0, 80)}…"`);
R.is(r.dup.other && !r.dup.shape && r.dup.at && r.dup.at[3] > 240 && r.dup.began === true, "a duplicate is a plain paint layer with the same pixels, which the brush can paint on");
R.is(r.esc.layer && r.esc.bound === null && r.esc.path === null && r.esc.back, "Esc lets go of the path and the layer keeps it; selecting the layer again takes it up");
const St = r.stamp || {};
R.is(St.other && St.verb === "stamp" && St.n > 100, `Stamp along makes a stamp layer of its own (${St.n} texels)`);
R.is(St.h1 === St.h2 && St.h2 === St.h3, `with scatter and every jitter on it redraws to the same bytes, whatever the brush in hand (${St.h1}, ${St.h2}, ${St.h3}) — the seed is stored`);
console.log("\n=== Colour along on a Stamp along ===");
const CA = r.colourAlong || { layer: {}, oneShot: {} };
R.is(CA.layer.other && CA.layer.cycle === "hue" && CA.layer.hues >= 4, `a Hue stamp along as a layer lays several colours along the path (${CA.layer.hues} distinct), and the layer stores the cycle (${CA.layer.cycle})`);
R.is(CA.layer.h1 === CA.layer.h2, `…and redraws to the same bytes with a brush in hand that does not cycle (${CA.layer.h1}, ${CA.layer.h2})`);
R.is(CA.layer.old === 1, `a recipe saved before the field reads as Off whatever the brush in hand (${CA.layer.old} colour)`);
R.is(CA.oneShot.plain && CA.oneShot.hues >= 4, `one-shot, a Hue stamp along lays several colours too (${CA.oneShot.hues} distinct; it used to be one: every dab was a jump at run 0)`);

console.log("\n=== presets ===");
const Pr = r.presets || {};
R.is(Pr.bound && Pr.saved.n === 1 && Pr.saved.name === "Path 1" && Pr.saved.verb === "fill" && Pr.saved.offered,
  `Save keeps a path layer as a preset — "${Pr.saved.name}", its fill and its brush — and offers it at once (ROADMAP 4.52 (4))`);
R.is(Pr.used.layers === 1 && Pr.used.bound && J(Pr.used.first) === J([128, 128]) && Pr.used.brush === "#0000ff" && blue(Pr.used.px),
  `Use on a sheet twice the size lays a path layer of its own at that scale (first node ${Pr.used.first}), with the preset's brush and not the one in hand (${Pr.used.brush})`);
R.is(Pr.used.size === 32, `…and its brush at that scale too: a 16-texel stamp is 32 on the bigger sheet (${Pr.used.size})`);
R.is(Pr.alone.verb === null && Pr.alone.path === 2 && Pr.alone.layer === null && Pr.alone.layers === r.fill.n + 1,
  "a path saved before it was filled is kept alone, and Use lays it as a path to fill or stamp, with no layer");
R.is(Pr.forgot.n === 0 && Pr.forgot.off && Pr.junk.every(v => v === null), "Forget removes them, and a record that is not a preset reads as none");
console.log("\n=== found in review ===");
const Rv = r.review || {};
R.is(Rv.useAlone.layer === null && Rv.useAlone.n === 2, "a path-only preset laid while a path layer is selected is a free path, not that layer's");
R.is(Rv.esc.steps === 1 && Rv.esc.pending === null && J(Rv.esc.afterUndo) === J([70, 70]),
  `Esc in the middle of a drag makes the drag its own step, so undoing the next gesture stops there (${Rv.esc.afterUndo})`);
R.is(Rv.model.n && Rv.model.frame === null, "a click on the 3-D view with a sheet path layer held writes nothing into it");
R.is(J(Rv.resize.node) === J([2 * Rv.resize.was[0], 2 * Rv.resize.was[1]]) && Rv.resize.w === 512 && blue(Rv.resize.inside) && Rv.resize.far[3] === 0,
  `a resize takes the path with the pixels: the corner at ${Rv.resize.was} is at ${Rv.resize.node} on the 512² sheet, and a redraw fills the same place (${Rv.resize.inside} inside, ${Rv.resize.far} outside)`);
R.is(Rv.chan.moved && !Rv.chan.shape && Rv.chan.back, "moving a path layer's content to another map lets go of the recipe, and undo gives it back");
console.log("\n=== the project ===");
const P = r.proj || {};
R.is(P.has && P.same, "the recipe is written into the paint content and read back field for field");
R.is(P.v === 6 && P.plainV === undefined && P.meta === 6, `a file with a path layer says version 6 (${P.meta}); one without stays 5 for older builds`);
R.is(P.gate6 === null && /project version 7, this build reads 6/.test(P.gate7 || "") && /project version 9/.test(P.gate8 || ""),
  "this build reads version 6 — and 7 (4.58), 8 (1.24) — and refuses 9 with the gate's sentence; a version 6 build refuses 7");
R.is(P.withLevels === 7, `a path layer inside a node with level content leaves the file at 7, not 6 (${P.withLevels})`);
const X = r.crafted || {};
R.is(X.verb === "fill" && X.brush.tool === "brush" && X.brush.target === "content" && X.brush.chan === "color" && X.brush.color === "#808080" &&
  !("size" in X.brush) && !("tip" in X.brush) && !("follow" in X.brush) && X.path.pts.length === 2 && X.path.pts[0].x === 0 &&
  X.path.pts[1].x === 0 && !("ix" in X.path.pts[1]) && X.path.angle === 90 && X.path.bias === -1 && X.path.closed === true,
  `a crafted recipe is data: unknown verb, tool, channel and colour put right, bad numbers zeroed, wrong types dropped, angle and bias clamped (${J(X).slice(0, 120)}…)`);
R.is(r.craftedNull.every(v => v === null), "and one that is not a recipe at all reads as none");
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
