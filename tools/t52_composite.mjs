// Compositing a dirty rectangle must give the same pixels as compositing the whole sheet
// (ROADMAP 1.10, CLAUDE.md §3.4).
//
// WHY THIS EXISTS. `compositeSlot` (the albedo) has taken a dirty rectangle since Phase 1;
// `compositeChannel` (smoothness / metalness / normal / wear) never did, and its own comment said
// so deliberately — "always full-sheet: these are painted far less often than the albedo, and the
// sheets are small enough that a region path is not worth the extra state". Measured 2026-08-25,
// per stroke frame at 4096²: colour 0.04 ms, one surface channel 25.8 ms, three surface channels
// 77.5 ms. §3.3's budget is 16 ms at 2048² and a three-channel stack broke it there too.
//
// There is one composite now, not two: ROADMAP 4.28(c) collapsed them into `Composite.sheet(slot,
// ch, rect)`, so `compositeSlot` is that call on "color" plus the GPU upload. This file did not
// change shape for it — it still drives colour through `compositeSlot` and everything else through
// the channel call, because what it is checking is the pixels, and a merge that changed them is
// exactly the failure it exists to catch.
//
// Nothing in the suite hashed composite output before this, so giving the channels a region path
// had no oracle at all. This is that oracle, and it is deliberately not a stored golden: the
// property that matters is not "these bytes" but **region == whole, restricted to the region**,
// which is self-checking, survives an intentional change to how a layer looks, and is exactly the
// bug a region path can introduce (a seam at the border, a decal stamped at the wrong offset, a
// mask sampled from the wrong place). A stored hash would go stale the first time a blend changed
// and would prove less.
//
// The stack is deliberately awkward — every layer type, on every channel, with masks, non-normal
// blend modes and a decal straddling the region border, because a decal that is entirely inside or
// entirely outside the rectangle would never catch an offset error.
//
// ONE THING IS NOT EXACT, and it was measured before it was excused. A **rotated** decal composites
// to slightly different pixels through the region path than through the whole-sheet path: max 7/255
// on 130 of 30 720 bytes at 21° and scale 1.4, 1/255 on a single byte at 21° and scale 1. Paint,
// fill, adjust, and decals at 0° — including scaled ones — are byte-identical, which is what rules
// out an offset or mask-sampling error and leaves Chrome's rasteriser: an antialiased rotated
// `drawImage` is not bit-reproducible across destination surfaces of different sizes. So rotated
// decals get a tolerance and everything else must be exact. A real logic error would be off by far
// more than 7 and on far more than 0.4 % of the bytes — the tolerance does not hide one.
// (This is a pre-existing property of the ALBEDO path, found by this test on the day it was
// written; it is not something the channel region path introduced.)
//
// (The surface repack this file also used to gate is GONE — the three sheets are bound straight to
// the material and packed in the shader, ROADMAP 1.13. `tools/t54_surface.mjs` gates that instead.)
//
// Usage: node tools/t52_composite.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var N = 256;
  // A deterministic sheet: no randomness, so a failure is reproducible from the report alone.
  var fillPattern = function(c, a, b){
    var g = ctx2d(c);
    for (var y = 0; y < c.height; y += 16) for (var x = 0; x < c.width; x += 16) {
      g.fillStyle = ((x / 16 + y / 16) % 2) ? a : b;
      g.fillRect(x, y, 16, 16);
    }
  };
  var mkSlot = function(size){
    var M = size || N;
    var s = { id: "t52", size: M, nSize: M, layers: [], missing: false, slotIdx: 0 };
    s.baseC = mkCanvas(M, M); fillPattern(s.baseC, "#3d5a2b", "#6a7f4a");
    s.composite = mkCanvas(M, M);
    ["smooth", "metal", "normal"].forEach(function(k){
      s[k] = mkCanvas(M, M); fillPattern(s[k], "#404040", "#b0b0b0");
    });
    return s;
  };
  // a mask with a soft edge, so a mis-sampled mask shows as a value difference and not only a shape
  var mkMask = function(){
    var c = mkCanvas(N, N), g = ctx2d(c);
    var grd = g.createLinearGradient(0, 0, N, N);
    grd.addColorStop(0, "#000"); grd.addColorStop(.5, "#fff"); grd.addColorStop(1, "#333");
    g.fillStyle = grd; g.fillRect(0, 0, N, N);
    return c;
  };
  var mkBmp = function(){
    var c = mkCanvas(48, 32), g = ctx2d(c);
    g.fillStyle = "#c02020"; g.fillRect(0, 0, 48, 32);
    g.fillStyle = "rgba(255,255,255,.5)"; g.fillRect(8, 8, 20, 16);   // a semi-transparent part
    return c;
  };
  var paintLayer = function(ch, blend, op, mask){
    var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "#d0c060"; g.fillRect(40, 40, 150, 150);
    g.fillStyle = "rgba(20,40,200,.6)"; g.fillRect(90, 20, 60, 200);
    return LayerNode.of({ type: "paint", name: "p_" + ch, chan: ch, canvas: c, visible: true,
      opacity: op, blend: blend, mask: mask ? mkMask() : null });
  };
  var fillLayer = function(ch, col, blend, op){
    return LayerNode.of({ type: "fill", name: "f_" + ch, chan: ch, color: col, visible: true,
      opacity: op, blend: blend, mask: mkMask() });
  };
  // straddles the region border on purpose. rot defaults to 0 because a rotated decal is not
  // bit-reproducible across destination sizes (see the header) — the rotated case is its own test.
  var decalLayer = function(ch, rot){
    return LayerNode.of({ type: "decal", name: "d_" + ch, chan: ch, bmp: mkBmp(), visible: true, opacity: .85,
      blend: "normal", x: 100 / N, y: 100 / N, scale: 1.4, rot: rot || 0, flip: false, mask: null, sym: null });
  };

  // The rectangle every comparison is made over. Its border cuts through the paint layer, the
  // decal and the gradient mask.
  var RECT = { x: 64, y: 64, w: 96, h: 80 };
  var sub = function(c, r){
    var d = ctx2d(c).getImageData(r.x, r.y, r.w, r.h).data;
    // FNV-1a over the region, plus a plain sum so a report can say how far apart two runs are
    var h = 2166136261, sum = 0;
    for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); sum += d[i]; }
    return { hash: (h >>> 0).toString(16), sum: sum };
  };
  var maxDiff = function(a, b, r){
    var da = ctx2d(a).getImageData(r.x, r.y, r.w, r.h).data;
    var db = ctx2d(b).getImageData(r.x, r.y, r.w, r.h).data;
    var m = 0, n = 0;
    for (var i = 0; i < da.length; i++) { var d = Math.abs(da[i] - db[i]); if (d) n++; if (d > m) m = d; }
    return { max: m, differing: n, of: da.length };
  };

  var stacks = {
    color:  function(s){ s.layers.push(paintLayer("color", "multiply", .8, true),
                                       fillLayer("color", "#8040c0", "overlay", .55),
                                       decalLayer("color")); },
    smooth: function(s){ s.layers.push(paintLayer("smooth", "screen", .7, true),
                                       fillLayer("smooth", "#909090", "multiply", .6),
                                       decalLayer("smooth")); },
    metal:  function(s){ s.layers.push(paintLayer("metal", "normal", 1, true), decalLayer("metal")); },
    normal: function(s){ s.layers.push(paintLayer("normal", "soft-light", .9, true),
                                       fillLayer("normal", "#8080ff", "normal", .4)); },
    wear:   function(s){ s.layers.push(paintLayer("wear", "multiply", .75, true), decalLayer("wear")); },
  };

  out.chans = {};
  Object.keys(stacks).forEach(function(ch){
    var isColor = ch === "color";
    // whole-sheet reference
    var a = mkSlot(); stacks[ch](a);
    if (isColor) compositeSlot(a, null); else Composite.sheet(a, ch, null);
    // the same stack, composited only over RECT
    var b = mkSlot(); stacks[ch](b);
    if (isColor) { compositeSlot(b, null); compositeSlot(b, RECT); }
    else { Composite.sheet(b, ch, null); Composite.sheet(b, ch, RECT); }
    var outOf = function(s){ return isColor ? s.composite : (s.chanC && s.chanC[ch]); };
    var ca = outOf(a), cb = outOf(b);
    out.chans[ch] = ca && cb
      ? { whole: sub(ca, RECT), region: sub(cb, RECT), diff: maxDiff(ca, cb, RECT),
          tookRect: Composite.sheet.length >= 3 || isColor }
      : { missing: true };
  });

  // The rotated decal, on its own, with a tolerance rather than an assertion of exactness.
  out.rotated = {};
  [["color", 21], ["metal", 21], ["color", 0], ["metal", 0]].forEach(function(pair){
    var ch = pair[0], rot = pair[1], isColor = ch === "color";
    var a = mkSlot(); a.layers.push(decalLayer(ch, rot));
    var b = mkSlot(); b.layers.push(decalLayer(ch, rot));
    if (isColor) { compositeSlot(a, null); compositeSlot(b, null); compositeSlot(b, RECT); }
    else { Composite.sheet(a, ch, null); Composite.sheet(b, ch, null); Composite.sheet(b, ch, RECT); }
    var ca = isColor ? a.composite : a.chanC[ch], cb = isColor ? b.composite : b.chanC[ch];
    out.rotated[ch + "@" + rot] = maxDiff(ca, cb, RECT);
  });

  // A region that is entirely off-sheet must be a no-op, not a crash or a cleared sheet.
  var off = mkSlot(); stacks.metal(off);
  Composite.sheet(off, "metal", null);
  var before = sub(off.chanC.metal, RECT);
  Composite.sheet(off, "metal", { x: N + 50, y: N + 50, w: 32, h: 32 });
  out.offSheet = { before: before, after: sub(off.chanC.metal, RECT) };

  // An invisible layer must stay invisible through the region path too — the full-sheet code
  // filtered on .visible up front, and a region path that forgets to is a silent regression.
  var vis = mkSlot(); stacks.metal(vis);
  vis.layers[0].visible = false;
  Composite.sheet(vis, "metal", null);
  var hidWhole = sub(vis.chanC.metal, RECT);
  Composite.sheet(vis, "metal", RECT);
  out.hidden = { whole: hidWhole, region: sub(vis.chanC.metal, RECT) };

  // ...and the last visible layer going away must drop the channel composite entirely, so
  // chanOut() falls back to the untouched base rather than to a stale sheet.
  var gone = mkSlot(); stacks.metal(gone);
  Composite.sheet(gone, "metal", null);
  out.droppedBefore = !!(gone.chanC && gone.chanC.metal);
  gone.layers.forEach(function(L){ L.visible = false; });
  out.droppedReturn = Composite.sheet(gone, "metal", RECT).live;
  out.droppedAfter = !!(gone.chanC && gone.chanC.metal);
  out.droppedFallsBackToBase = chanOut(gone, "metal") === gone.metal;

  // ---- ROADMAP 1.14: a flat byte view is not rebuilt by a composite that cannot have changed it ----
  // These views read the slot's own imported sheets (baseC / smooth / metal / normal), and their
  // cache key used to carry _chanRev and thumbRev, which bump on every channel and every albedo
  // composite. So dragging a decal rebuilt, once per frame, a canvas whose source cannot have
  // changed: measured at 2048, 32.5 ms per composite with n:g up and 21.7 with c:a, against 0.15
  // for shaded. The pair below is what makes keying on the SOURCE safe rather than merely fast —
  // it must not rebuild when nothing it reads moved, and it must rebuild when something did.
  var vs = { id: "t52v", size: 64, nSize: 64, layers: [], missing: false };
  var vflat = function(hex){ var c = mkCanvas(64, 64); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, 64, 64); return c; };
  vs.baseC = vflat("#404040"); vs.composite = vflat("#404040");
  vs.smooth = vflat("#505050"); vs.metal = vflat("#303030"); vs.normal = vflat("#8080ff");
  App.slots.set("t52v", vs);
  var slotWasV = App.activeSlot, viewWas = App.chanView;
  App.activeSlot = vs;
  vs.layers = [LayerNode.of({ type: "fill", name: "f", color: "#00ff00", opacity: 1, blend: "normal", visible: true })];
  var first = rawChanCanvas(vs, "n:g");
  var firstRev = first && first._rev;
  compositeSlot(vs, { x: 8, y: 8, w: 16, h: 16 });
  compositeChannels(vs, { x: 8, y: 8, w: 16, h: 16 });
  var second = rawChanCanvas(vs, "n:g");
  out.view = { sameObject: first === second, sameRev: !!first && second._rev === firstRev };
  // ...and it DOES rebuild when the sheet it reads is really written
  var wasPx = ctx2d(second).getImageData(20, 20, 1, 1).data[0];
  bakeAction("t52 normal edit", [vs.normal], function(){
    var g = ctx2d(vs.normal); g.fillStyle = "#20a0ff"; g.fillRect(0, 0, 64, 64);
  }, function(){});
  var third = rawChanCanvas(vs, "n:g");
  out.view.rebuiltAfterEdit = ctx2d(third).getImageData(20, 20, 1, 1).data[0] !== wasPx;
  // ...and when the sheet is REPLACED wholesale, which hands over a different canvas object
  vs.normal = vflat("#000000");
  var fourth = rawChanCanvas(vs, "n:g");
  out.view.rebuiltAfterSwap = ctx2d(fourth).getImageData(20, 20, 1, 1).data[0] === 0;
  App.slots.delete("t52v");
  App.activeSlot = slotWasV; App.chanView = viewWas;

  // ---- ROADMAP 1.15: the rectangle crosses from the LAYER's pixels into the SHEET's ----
  // A mask is allowed to be a different size from the sheet it masks — that is what blit's scaling
  // is for, and the reported project's masks are 4096 over a 2048 sheet. But a stroke measures its
  // dirty rectangle on the thing it painted (here, the mask), and the compositor spends rectangles
  // in the slot's composite space. Until that crossing existed, a stamp recomposited a region that
  // had not changed and never visited the one that had, so the stroke changed **no pixel of the
  // composite at all** until something forced a whole-sheet pass — which is what hiding and showing
  // the layer does, and is exactly how it was reported.
  //
  // Driven through the real stroke path, because that is where the rectangle is minted. Everything
  // above this point builds its layers at the sheet's size, so none of it exercises the crossing.
  // THE SHEET HAS TO BE BIGGER THAN ONE UNDO TILE, and the first version of this case was not.
  // Rectangles are reported per 256² tile (core/undo.js), so on a 256 mask the whole mask is one
  // tile, the rectangle comes out as the entire sheet, and a scaling error cannot show. 512 over a
  // 1024 mask puts the stamp in a tile whose unscaled rectangle starts at 512 — off a 512 sheet
  // entirely, so the composite is skipped outright and the stroke is invisible. Which is the bug.
  out.cross = (function(){
    var M = 512;
    var s = { id: "t52x", cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null,
              metal: null, normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
    App.slots.set("t52x", s);
    initPlaceholderAlbedo(s, M, M);
    var bg = ctx2d(s.baseC); bg.fillStyle = "#000000"; bg.fillRect(0, 0, M, M);   // a base that is not red
    var pc = mkCanvas(M, M), pg = ctx2d(pc);
    pg.fillStyle = "#ff0000"; pg.fillRect(0, 0, M, M);
    var mk = mkCanvas(M * 2, M * 2), mg = ctx2d(mk);                              // the mask is TWICE the sheet
    mg.fillStyle = "#ffffff"; mg.fillRect(0, 0, M * 2, M * 2);
    var L = LayerNode.of({ type: "paint", name: "t52x", canvas: pc, mask: mk, visible: true, opacity: 1, blend: "normal" });
    s.layers.push(L);
    var slotWas = App.activeSlot, layerWas = App.activeLayer, modeWas = App.brush.mode;
    App.activeSlot = s; App.activeLayer = L;
    compositeSlot(s, null);
    var px = function(x, y){ return ctx2d(s.composite).getImageData(x, y, 1, 1).data[0]; };
    var read = function(){ return { hit: px(M * 3 / 4, M * 3 / 4), away: px(M / 4, M / 4) }; };
    var before = read();
    setBrushMode("mask");
    App.brush.size = 48; App.brush.opacity = 1; App.brush.hardness = 1; App.brush.value = 0;
    // (3M/2, 3M/2) of a 2M mask is (3M/4, 3M/4) of the sheet, which is where read() samples.
    // Painting a mask at value 0 hides the layer there, so the black base shows through and the red
    // goes away — at that texel, and at no other.
    var began = beginStroke(false, false);
    if (began) { stampAt(M * 3 / 2, M * 3 / 2, 0, null); endStroke(); }
    var after = read();
    var maskHole = ctx2d(mk).getImageData(M * 3 / 2, M * 3 / 2, 1, 1).data[3];   // it reached the mask
    compositeSlot(s, null);                                                      // hide-and-show does this
    var whole = read();
    App.slots.delete("t52x");
    App.activeSlot = slotWas; App.activeLayer = layerWas; setBrushMode(modeWas);
    return { began: began, maskHole: maskHole, before: before, after: after, whole: whole };
  })();

  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== a dirty-rectangle composite equals the whole-sheet one, over that rectangle ===");
for (const [ch, c] of Object.entries(o.chans)) {
  if (c.missing) { R.is(false, `${ch}: no composite was produced at all`); continue; }
  console.log(`   ${ch.padEnd(7)} whole ${c.whole.hash}  region ${c.region.hash}  ` +
    `max channel diff ${c.diff.max} over ${c.diff.differing}/${c.diff.of} bytes`);
  R.is(c.whole.hash === c.region.hash,
    `${ch}: the region composite is byte-identical to the whole-sheet one` +
    (c.whole.hash === c.region.hash ? "" : ` (max diff ${c.diff.max} on ${c.diff.differing} bytes)`));
}
R.is(Object.values(o.chans).every(c => c.tookRect),
  "Composite.sheet takes a rect at all — the whole point of ROADMAP 1.10");

console.log("\n=== a rotated decal, which the rasteriser will not reproduce exactly ===");
for (const [k, d] of Object.entries(o.rotated)) {
  const rot = +k.split("@")[1];
  console.log(`   ${k.padEnd(10)} max ${d.max}  on ${d.differing}/${d.of} bytes`);
  if (rot === 0) R.is(d.max === 0, `${k}: an unrotated decal is still byte-identical (${d.max})`);
  else {
    R.is(d.max <= 8, `${k}: within the measured rasteriser tolerance — max ${d.max}, was 7`);
    R.is(d.differing < d.of * 0.01, `${k}: and confined to an edge — ${d.differing}/${d.of} bytes, under 1 %`);
  }
}

console.log("");
console.log("\n=== the edges of the region path ===");
R.is(o.offSheet.before.hash === o.offSheet.after.hash,
  "a rectangle entirely off the sheet changes nothing");
R.is(o.hidden.whole.hash === o.hidden.region.hash,
  "a hidden layer stays hidden through the region path");
R.is(o.droppedBefore, "a channel with visible layers has its own composite");
R.is(o.droppedReturn === false, "hiding the last one reports that the channel no longer composites");
R.is(!o.droppedAfter, "and drops the sheet");
R.is(o.droppedFallsBackToBase, "so chanOut falls back to the untouched base, not to a stale sheet");

console.log("\n=== ROADMAP 1.15: a stroke on a mask twice the size of the sheet ===");
const x = o.cross;
console.log(`   sheet texel (384,384) red:  before ${x.before.hit}  after the stroke ${x.after.hit}  ` +
  `after a whole-sheet pass ${x.whole.hit}`);
console.log(`   the untouched texel (128,128): ${x.before.away} / ${x.after.away} / ${x.whole.away}` +
  `   ·  mask alpha under the stamp: ${x.maskHole}`);
R.is(x.began, "the mask stroke started at all");
R.is(x.maskHole === 0, `the stamp reached the mask itself (alpha ${x.maskHole}, want 0)`);
// The control. Without it a fix that composited nothing anywhere would pass the assertion below.
R.is(x.whole.hit !== x.before.hit,
  `a whole-sheet composite does show the stroke (${x.before.hit} → ${x.whole.hit})`);
R.is(x.after.hit === x.whole.hit,
  "the stroke's own composite put the same pixel there as a whole-sheet pass" +
  (x.after.hit === x.whole.hit ? "" : ` — got ${x.after.hit}, want ${x.whole.hit}: the rectangle did not cross from the mask's pixels into the sheet's`));
R.is(x.after.away === x.before.away && x.whole.away === x.before.away,
  "and repainted nothing where the stroke did not go");

console.log("\n=== a flat byte view is not rebuilt by a composite that cannot have changed it (1.14) ===");
R.is(o.view.sameObject && o.view.sameRev,
  "compositing the albedo and the channels leaves the n:g view's cache alone — it reads the slot's imported _n, which neither of them writes. Measured before this: 32.5 ms per composite at 2048, against 0.15 for shaded");
R.is(o.view.rebuiltAfterEdit,
  "but a destructive edit to that sheet DOES rebuild it — bakeAction bumps the sheet's own revision, and every destructive write in the app goes through bakeAction or bakeRegionAction");
R.is(o.view.rebuiltAfterSwap,
  "and so does replacing the sheet outright, which hands over a different canvas object — the identity half of the key, for the paths that reassign rather than mutate");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
