// Selections from a lasso, a path and a colour range (ROADMAP 4.50 (9)).
//
// WHY THIS EXISTS. Photoshop skinners isolate the patches of a camouflage with the magic wand and
// colour range, and cut panels out with the lasso. The app had a rectangle, UV islands, parts and
// *mask → selection*; the shape tool could fill a closed path but never become a selection. The item
// is small because a shaped selection is already a mask (`Marquee.fromMask`), so every new source
// only has to MAKE one — and that is exactly where it can be wrong without anything looking wrong:
//
//   * **which texels a polygon covers.** `SelShape.poly` is a scanline fill; this test holds it
//     against a second method that shares nothing with it (the winding number of every texel centre,
//     edge by edge), over hundreds of random self-intersecting polygons that run off the raster. The
//     rule is NONZERO, because the path's own Fill is a canvas `fill()` and that is nonzero — so a
//     pentagram's middle is inside and a square traced twice is not a hole.
//   * **a selection is a yes/no.** A canvas fill of the same outline is antialiased; a half-alpha rim
//     would fade every verb out over its last texel. So the page half reads the Fill of a lasso back
//     and counts texels that are neither 0 nor 255.
//   * **the wand's tolerance and its connectivity.** Exactly `tol` apart is in, `tol + 1` is out;
//     two patches touching at one CORNER are two patches (edge neighbours only); alpha counts.
//   * **Shift adds, Alt removes**, for every source, as one undo step each — and the step carries the
//     bytes of the canvas it holds, because a shape no id can rebuild is kept by reference.
//   * **path → selection covers what Fill paints**: every texel the path's Fill made opaque is
//     selected, and nothing it left empty is.
//   * the verbs run on a shape that is not an island pick. Before this item Fill, Clear and Crop read
//     `Marquee.islands.size` for their status line on ANY shape, and a mask's shape has none — so all
//     three threw after doing their work.
//   * four things found while landing it (2026-09-26): an island Shift-clicked onto a lasso or a
//     rectangle REPLACED it; `stencil` rounded a shape's box back into mask texels and cut its last
//     column and row wherever the mask scale is not a power of two (a 3000-texel sheet: 199 texels
//     of 10 000); a double-click whose first press closed the polygon then refused the stray second
//     press as "a lasso needs three corners"; and an outline could be carried to another slot and
//     closed there.
//   * and what its review found (2026-09-26), each read at the texels a user would see:
//       - **a 4096² sheet.** Shapes were held at the 2048² mask resolution and every verb drew them up
//         smoothed, so two touching camouflage patches recoloured with the wand and Fill left 4
//         texels of every row wrong — α 191 / 63 edges, a column of the neighbour's colour. Shapes
//         are now held at the sheet's own resolution up to 4096² and cut texel-exact; this reads the
//         recoloured row back, and the old check here, which read the MASK and used a patch starting
//         on an even texel, is gone.
//       - **what the view shows.** Every wand case read a plain colour sheet, so a wand matching the
//         composite under a ground slot's camouflage — colours shown nowhere — passed. The camouflage
//         blend is checked against the eyedropper's `shownColorAt`, texel by texel, and a smoothness
//         brush and a channel view against the canvas the view draws.
//       - **the undo step.** It held a 16 MB canvas per click; it holds the shape's packed bits.
//       - **Shift / Alt that changes nothing** turned a rectangle into a shape and said it added one.
//   * and what its second round found: **a layer half the sheet's size.** Smoothness, metalness and
//     normal layers are the _n's size, half the albedo in the game's own files. The verbs took their
//     region by rounding the box's width and cut a shape with a tie going the other way, so two wand
//     patches meeting at an odd texel, filled there one after the other, left the texel they share
//     empty, and Clear left it standing. A row of four selections meeting end to end — a rectangle,
//     two patches, a rectangle of odd width — is filled on a 2048² layer and read back against the
//     rule the verbs state: a texel takes the selection holding its centre, a tie the texel before.
//   * and one seam with 4.50 (6), which landed beside it: on a camouflage tile's repeats in the 3 × 3
//     view the texel under the pointer is the tile's own, one period over (the eyedropper's rule), and
//     a wand click there was clamped to the sheet and took the colour on its edge.
//
// Usage: node tools/t99_selshape.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { SelShape } = new Function(sectionOf("SELSHAPE").replace(/^"use strict";$/m, "") + "\nreturn { SelShape };")();
const R = makeReport();
const argv = process.argv.slice(2);

// ---------------------------------------------------------------- the pure half, under Node
// The oracle: Sunday's winding number at a point, one edge at a time — an upward edge with the point
// on its left counts +1, a downward one with the point on its right −1. Same half-open rule in y as
// the scanline, and no shared code; with random FLOAT corners no texel centre sits exactly on an edge,
// so the two must agree texel for texel.
const windAt = (pts, px, py) => {
  let wn = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py) { if (by > py && side > 0) wn++; }
    else if (by <= py && side < 0) wn--;
  }
  return wn;
};
const oracle = (pts, w, h) => {
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = windAt(pts, x + .5, y + .5) !== 0 ? 1 : 0;
  return b;
};
const count = b => b.reduce((n, v) => n + v, 0);
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

console.log("=== a polygon covers the texels whose centres it contains ===");
{
  const sq = SelShape.poly([[10, 10], [20, 10], [20, 20], [10, 20]], 32, 32);
  const b = SelShape.bounds(sq, 32, 32);
  R.is(count(sq) === 100 && b && b.x0 === 10 && b.y0 === 10 && b.x1 === 19 && b.y1 === 19,
    `a square from 10 to 20 is exactly the 10 × 10 texels whose centres (10.5 … 19.5) it holds — ${count(sq)}, box ${JSON.stringify(b)}`);
  const W = 64, H = 48;
  let worst = 0, total = 0, offRaster = 0;
  for (let t = 0; t < 300; t++) {
    const n = 3 + Math.floor(rnd() * 38), pts = [];
    for (let i = 0; i < n; i++) pts.push([rnd() * (W + 24) - 12, rnd() * (H + 24) - 12]);
    const d = diff(SelShape.poly(pts, W, H), oracle(pts, W, H));
    if (d > worst) worst = d;
    total += d;
    if (pts.some(p => p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H)) offRaster++;
  }
  R.is(total === 0, `300 random self-intersecting polygons of 3–40 corners (${offRaster} reaching off the raster) agree with the winding-number oracle texel for texel — ${total} texels differ, worst ${worst}`);
  // nonzero, not even-odd: what a canvas fill() of the same path paints
  const star = [];
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 4 * Math.PI / 5; star.push([32 + 28 * Math.cos(a), 32 + 28 * Math.sin(a)]); }
  const st = SelShape.poly(star, 64, 64);
  const twice = SelShape.poly([[4, 4], [28, 4], [28, 28], [4, 28], [4, 4], [28, 4], [28, 28], [4, 28]], 32, 32);
  R.is(st[32 * 64 + 32] === 1 && count(twice) === 576,
    `the NONZERO rule — a pentagram's middle is inside (${st[32 * 64 + 32]}) and a square traced twice is solid (${count(twice)} of 576), which is what the path's canvas fill() paints, so path → selection covers the same texels`);
  const out = SelShape.poly([[-40, -40], [-10, -40], [-10, -10]], 32, 32);
  const clip = SelShape.poly([[-10, 5], [10, 5], [10, 15], [-10, 15]], 32, 32);
  R.is(count(out) === 0 && count(clip) === 100 && out.length === 1024,
    `off the raster is clipped, never written past it — wholly outside ${count(out)}, half outside ${count(clip)} (the 10 × 10 on the sheet)`);
  const line = SelShape.poly([[1, 1], [20, 20], [30, 30]], 32, 32), two = SelShape.poly([[1, 1], [20, 20]], 32, 32);
  R.is(count(line) === 0 && count(two) === 0, "a lasso that is a line, or has two corners, covers nothing");
}

console.log("\n=== the wand: tolerance, connectivity, alpha ===");
{
  const W = 40, H = 20, img = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, r, g, b, a = 255) => { const o = (y * W + x) * 4; img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 128, 128, 128);
  for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) put(x, y, 200, 40, 40);        // A1, 64 texels
  for (let y = 2; y < 10; y++) for (let x = 25; x < 33; x++) put(x, y, 205, 38, 44);       // A2, 5 away, not touching
  put(10, 10, 200, 40, 40);                                                                // touches A1 at a corner only
  for (let y = 12; y < 19; y++) for (let x = 14; x < 22; x++) put(x, y, 200, 40, 40, 0);   // A1's RGB, transparent
  const c = SelShape.range(img, W, H, 5, 5, 10, true), g = SelShape.range(img, W, H, 5, 5, 10, false);
  const z = SelShape.range(img, W, H, 5, 5, 0, false), f = SelShape.range(img, W, H, 5, 5, 4, false);
  R.is(count(c) === 64, `contiguous takes the patch clicked and nothing else — ${count(c)} of A1's 64, not the look-alike across the sheet, not the texel touching only its corner`);
  R.is(count(g) === 64 + 64 + 1, `colour range (not contiguous) takes every texel of that colour anywhere — ${count(g)} = 64 + 64 + the corner texel`);
  R.is(count(z) === 65 && count(f) === 65,
    `tolerance is the largest single-channel difference: at 0 only the exact colour (${count(z)}), and the look-alike is 5 away so 4 leaves it out too (${count(f)})`);
  R.is(!g[15 * W + 16], "alpha is a channel like the others — the same RGB fully transparent is 255 away, and not taken");
  const ramp = new Uint8ClampedArray(256 * 4);
  for (let x = 0; x < 256; x++) { ramp[x * 4] = x; ramp[x * 4 + 3] = 255; }
  const rr = SelShape.range(ramp, 256, 1, 100, 0, 10, true), bb = SelShape.bounds(rr, 256, 1);
  R.is(count(rr) === 21 && bb.x0 === 90 && bb.x1 === 110, `exactly tol apart is in and tol + 1 is out: seed 100 ± 10 on a 0–255 ramp is 90 … 110 (${count(rr)} texels, ${bb.x0} … ${bb.x1})`);
  // a patch that winds: the flood must follow a spiral corridor, not only straight runs
  const S = 21, sp = new Uint8ClampedArray(S * S * 4).fill(255), wall = (x, y) => { const o = (y * S + x) * 4; sp[o] = sp[o + 1] = sp[o + 2] = 0; };
  for (let k = 0; k < S; k++) { wall(k, 0); wall(k, S - 1); wall(0, k); wall(S - 1, k); }
  for (let k = 2; k < S - 2; k++) { wall(k, 4); wall(S - 5, k); }
  for (let k = 4; k < S - 4; k++) { wall(k, S - 5); }
  for (let k = 6; k < S - 4; k++) { wall(4, k); }
  const sw = SelShape.range(sp, S, S, 1, 1, 0, true), all = SelShape.range(sp, S, S, 1, 1, 0, false);
  R.is(count(sw) === count(all), `the flood follows a winding corridor to its end — ${count(sw)} of the ${count(all)} white texels, all of them connected`);
}

console.log("\n=== the wand's three steps, band by band, agree with the one-call form ===");
{
  // The page reads a sheet a band at a time: `near` per band, `runs` appended per band, then `walk`
  // (or `tally`, for colour range). That has to be the same selection `range` makes in one call,
  // wherever the bands happen to fall — including a band boundary through the middle of a patch.
  const W = 53, H = 41, img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = rnd() < .45 ? 90 : 180; img[i * 4] = v; img[i * 4 + 1] = v; img[i * 4 + 2] = v; img[i * 4 + 3] = 255; }
  let worst = 0, boxBad = 0;
  for (const band of [1, 3, 7, 41]) for (const contig of [true, false]) for (let t = 0; t < 12; t++) {
    const sx = Math.floor(rnd() * W), sy = Math.floor(rnd() * H), s = (sy * W + sx) * 4, c = [img[s], img[s + 1], img[s + 2], img[s + 3]];
    const m = new Uint8Array(W * H), Rr = SelShape.runs(m, W, H, null, 0, 0);
    for (let y0 = 0; y0 < H; y0 += band) {
      const n = Math.min(band, H - y0);
      SelShape.near(img.subarray(y0 * W * 4, (y0 + n) * W * 4), W * n, c, 20, m, y0 * W);
      SelShape.runs(m, W, H, Rr, y0, y0 + n);
    }
    const info = {}, got = contig ? SelShape.walk(Rr, W, H, sx, sy, null, info) : m, ti = contig ? info : SelShape.tally(Rr, H);
    const want = SelShape.range(img, W, H, sx, sy, 20, contig);
    worst = Math.max(worst, diff(got, want));
    const wb = SelShape.bounds(want, W, H);
    if (ti.n !== count(want) || JSON.stringify(ti.box) !== JSON.stringify(wb)) boxBad++;
  }
  R.is(worst === 0, `96 picks on a noisy sheet, read in bands of 1, 3, 7 and all 41 rows, contiguous and not, are the one-call selection texel for texel (worst ${worst} differ)`);
  R.is(boxBad === 0, `and the count and box the flood keeps as it goes are the ones a scan of the bytes finds (${boxBad} of 96 disagree)`);
}

console.log("\n=== Shift adds, Alt removes; the box; the undo step's bits ===");
{
  const a = SelShape.rect(0, 0, 4, 4, 8, 8), b = SelShape.rect(2, 2, 6, 6, 8, 8);
  const u = SelShape.combine(a.slice(), b, "add"), s = SelShape.combine(a.slice(), b, "sub"), r = SelShape.combine(a.slice(), b, "replace");
  R.is(count(u) === 28 && count(s) === 12 && count(r) === 16, `union ${count(u)} (16 + 16 − 4), difference ${count(s)} (16 − 4), replace ${count(r)}`);
  R.is(SelShape.bounds(SelShape.combine(a.slice(), a, "sub"), 8, 8) === null, "taking a shape away from itself leaves no box at all — the caller drops the selection");
  const rc = SelShape.rect(-3, 5.5, 3.2, 99, 8, 8);
  R.is(count(rc) === 4 * 3, `a rectangle is clipped to the raster and covers every texel it touches (${count(rc)})`);
  const inner = SelShape.rect(1, 1, 3, 3, 8, 8), none = new Uint8Array(64), far = SelShape.rect(5, 5, 7, 7, 8, 8);
  R.is(!SelShape.changes(a, inner, "add") && !SelShape.changes(a, none, "add") && !SelShape.changes(a, far, "sub") &&
       SelShape.changes(a, b, "add") && SelShape.changes(a, b, "sub"),
    "Shift with a shape already inside, or covering no texel, and Alt with one outside, change nothing — and are told apart from ones that do");
  let bad = 0;
  for (const n of [1, 7, 8, 9, 63, 64, 65, 1000]) {
    const bits = new Uint8Array(n);
    for (let i = 0; i < n; i++) bits[i] = rnd() < .4 ? 1 : 0;
    const p = SelShape.pack(bits);
    if (p.length !== Math.ceil(n / 8) || diff(SelShape.unpack(p, n), bits)) bad++;
  }
  R.is(bad === 0, `packed to one bit a texel and back, bit for bit, at lengths that are and are not a multiple of 8 (${bad} of 8 wrong)`);
}

console.log("\n=== at 4096², the most a selection is ever held at ===");
{
  const W = 4096, H = 4096, flat = new Uint8ClampedArray(W * H * 4).fill(200);
  let t0 = performance.now();
  const fl = SelShape.range(flat, W, H, 1000, 1000, 0, true);
  const tFlood = performance.now() - t0;
  const ring = [];
  for (let i = 0; i < 4000; i++) { const a = i / 4000 * Math.PI * 2; ring.push([2048 + 1800 * Math.cos(a), 2048 + 1800 * Math.sin(a)]); }
  t0 = performance.now();
  const pr = SelShape.poly(ring, W, H);
  const tPoly = performance.now() - t0;
  console.log(`   flood of all ${W * H} texels ${tFlood.toFixed(0)} ms · a 4000-corner lasso ${tPoly.toFixed(0)} ms (${count(pr)} texels)`);
  R.is(count(fl) === W * H && Math.abs(count(pr) - Math.PI * 1800 * 1800) < 4000 * 4,
    "a flood that has to take the whole of a 4096² sheet takes all of it, and a 4000-corner lasso covers πr² to within its outline");
  R.is(tFlood < 3000 && tPoly < 3000, `both a click's work even on a loaded machine (${tFlood.toFixed(0)} / ${tPoly.toFixed(0)} ms, bound 3000 — measured, not a latency gate)`);
}

// ---------------------------------------------------------------- the page half
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\n(SKIP: no Chrome or Edge found, so the gestures are not exercised)"); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 256;
  var keep = { slot: App.activeSlot, layer: App.activeLayer, mode: App.brush.mode, color: App.brush.color, size: App.brush.size,
               hard: App.brush.hardness, op: App.brush.opacity, sc: v2.sc, ox: v2.ox, oy: v2.oy, chanView: App.chanView };
  var grey = function(n){ var c = mkCanvas(n, n), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, n, n); return c; };
  var mkSlot = function(id, n){ var s = { id: id, size: n, nSize: n, layers: [], missing: false, baseC: grey(n), composite: grey(n), normal: null }; App.slots.set(id, s); return s; };
  var paintBoth = function(slot, css, x, y, w, h){ [slot.baseC, slot.composite].forEach(function(c){ var g = ctx2d(c); g.fillStyle = css; g.fillRect(x, y, w, h); }); };
  var s = mkSlot("t99", N);
  App.activeSlot = s; App.chanView = null;
  setBrushMode("color");
  App.brush.color = "#ff0000"; App.brush.opacity = 1; App.brush.size = 24; App.brush.hardness = 1;
  App.selParts.clear(); App.protectedParts.clear();
  PathUI.set(false);
  v2.sc = 1; v2.ox = 0; v2.oy = 0;                       // a screen pixel is a texel: thresholds read plainly
  var paintLayer = function(name){ return LayerNode.of({ type: "paint", name: name, canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" }); };
  var bytes = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var alpha = function(c, x, y){ return ctx2d(c).getImageData(x, y, 1, 1).data[3]; };
  var said = function(){ return $("status").textContent; };
  // The whole selection in force, one byte per texel — 256² is below MASK_MAX, so mask texels ARE texels.
  var selBits = function(){
    var st = Marquee.stencil(s);
    if (!st) return new Uint8Array(N * N);
    var d = bytes(st), b = new Uint8Array(N * N);
    for (var i = 0; i < b.length; i++) b[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    return b;
  };
  var count = function(b){ var n = 0; for (var i = 0; i < b.length; i++) n += b[i]; return n; };
  var diff = function(a, b){ var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  var at = function(b, x, y){ return b[y * N + x]; };
  var ev = function(o){ o = o || {}; return { shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: false, button: 0 }; };
  var pt = function(x, y){ return { x: x, y: y, vx: x, vy: y }; };
  var key = function(code){ window.dispatchEvent(new KeyboardEvent("keydown", { code: code })); window.dispatchEvent(new KeyboardEvent("keyup", { code: code })); };
  var top = function(){ return App.undoStack[App.undoStack.length - 1] || {}; };
  // A polygon lasso: the first press carries the modifiers, the rest are plain clicks, then closed.
  var clickLasso = function(pts, mods){
    SelectUI.down(ev(mods), pt(pts[0][0], pts[0][1])); SelectUI.up();
    for (var i = 1; i < pts.length; i++) { SelectUI.down(ev(), pt(pts[i][0], pts[i][1])); SelectUI.up(); }
    SelectUI.closeLasso();
  };

  // ---- 1. a freehand lasso: drag round, let go, and it is a shape ----
  Marquee.none();
  SelectUI.setOn(false); SelectUI.setKind("lasso");
  out.kind = { kind: SelectUI.kind, on: SelectUI.on, lasso: $("btnSelLasso").textContent, wandRow: $("selWandRow").style.display };
  var C = [];
  for (var i = 0; i < 64; i++) { var t = i / 64 * Math.PI * 2; C.push([128 + 50 * Math.cos(t), 128 + 50 * Math.sin(t)]); }
  SelectUI.down(ev(), pt(C[0][0], C[0][1]));
  for (i = 1; i < C.length; i++) SelectUI.move(ev(), pt(C[i][0], C[i][1]));
  var drawn = SelectUI.lasso ? SelectUI.lasso.pts.length : -1, d0 = App.undoStack.length;
  SelectUI.up();
  var want = SelShape.poly(C, N, N), got = selBits();
  out.free = { drawn: drawn, closed: !SelectUI.lasso, shape: !!Marquee.shape(), islands: Marquee.islands, box: Marquee.rect(),
               n: count(got), want: count(want), diff: diff(got, want), steps: App.undoStack.length - d0, bytes: top().bytes,
               info: $("selInfo").textContent, said: said() };

  // ---- 2. the verbs follow it, and none of them throws on a shape that is not an island pick ----
  var threw = {};
  var LF = paintLayer("fill"); s.layers = [LF]; App.activeLayer = LF;
  try { Marquee.fill(); } catch (e) { threw.fill = String(e && e.message || e); }
  var fd = bytes(LF.canvas), fin = 0, fout = 0, fpart = 0;
  for (i = 0; i < N * N; i++) { var a = fd[i * 4 + 3]; if (a > 0 && a < 255) fpart++; if (want[i] && a === 255) fin++; if (!want[i] && a > 0) fout++; }
  out.fill = { inside: fin, outside: fout, partial: fpart, said: said() };
  var green = function(){ var g = ctx2d(LF.canvas); g.globalCompositeOperation = "source-over"; g.fillStyle = "#00ff00"; g.fillRect(0, 0, N, N); };
  green();
  try { Marquee.erase(); } catch (e) { threw.clear = String(e && e.message || e); }
  out.clear = { hole: alpha(LF.canvas, 128, 128), boxCorner: alpha(LF.canvas, 82, 82), far: alpha(LF.canvas, 10, 10) };
  green();
  try { Marquee.crop(); } catch (e) { threw.crop = String(e && e.message || e); }
  out.crop = { kept: alpha(LF.canvas, 128, 128), boxCorner: alpha(LF.canvas, 82, 82), far: alpha(LF.canvas, 10, 10) };
  var nBefore = s.layers.length;
  try { Marquee.copy(); } catch (e) { threw.copy = String(e && e.message || e); }
  var cp = s.layers.length > nBefore ? s.layers[s.layers.length - 1] : null, rb = Marquee.rect();
  out.copy = cp && cp.bmp ? { mid: alpha(cp.bmp, 128 - rb.x, 128 - rb.y), boxCorner: alpha(cp.bmp, 82 - rb.x, 82 - rb.y) } : null;
  out.threw = threw;
  // Copy makes a decal layer, and making one moves the brush onto a channel that layer's slot can
  // take (on this synthetic slot, the wear mask) — put it back, or every stroke below lands there.
  setBrushMode("color");
  // and the brush: a stroke walked from inside, through the box corner, out past the circle
  var LS = paintLayer("stroke"); s.layers = [LS]; App.activeLayer = LS;
  App.brush.size = 40;
  beginStroke(false, false); stampAt(128, 128, 0, null); stampAt(82, 82, 0, null); stampAt(40, 128, 0, null); endStroke();
  out.stroke = { inside: alpha(LS.canvas, 128, 128), boxCorner: alpha(LS.canvas, 82, 82), far: alpha(LS.canvas, 40, 128) };

  // ---- 3. a polygon lasso: click corner by corner, close on the first ----
  Marquee.none();
  var P = [[40, 40], [120, 40], [120, 100], [40, 100]];
  P.forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  out.open = { open: !!SelectUI.lasso, corners: SelectUI.lasso ? SelectUI.lasso.pts.length : 0, info: $("selInfo").textContent, sel: !!Marquee.rect() };
  SelectUI.down(ev(), pt(43, 42)); SelectUI.up();          // within 7 screen pixels of the first corner
  var gp = selBits();
  out.poly = { closed: !SelectUI.lasso, n: count(gp), diff: diff(gp, SelShape.poly(P, N, N)) };
  // Backspace takes a corner back and Esc drops the outline — and neither touches the selection
  var snapP = Marquee.snapshot();
  [[150, 150], [200, 150], [200, 200], [230, 240]].forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  key("Backspace");
  out.back = SelectUI.lasso ? SelectUI.lasso.pts.length : -1;
  key("Escape");
  out.esc = { dropped: !SelectUI.lasso, same: Marquee.sameSnap(snapP, Marquee.snapshot()) };
  // Enter closes one
  [[150, 150], [200, 150], [200, 200]].forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  key("Enter");
  var ge = selBits();
  out.enter = { closed: !SelectUI.lasso, inTri: at(ge, 190, 160), outTri: at(ge, 160, 190), oldGone: !at(ge, 60, 60) };
  // …and two corners are not a lasso, and it says so
  Marquee.none();
  [[10, 10], [60, 10]].forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  key("Enter");
  out.two = { said: said(), sel: Marquee.rect(), lasso: !!SelectUI.lasso };

  // ---- 4. Shift adds, Alt removes, one undo step each ----
  Marquee.none();
  var A = [[20, 20], [100, 20], [100, 100], [20, 100]], B = [[140, 20], [220, 20], [220, 100], [140, 100]], H = [[50, 50], [70, 50], [70, 70], [50, 70]];
  clickLasso(A);
  var d1 = App.undoStack.length;
  clickLasso(B, { shift: true });
  var u = selBits();
  out.add = { a: at(u, 60, 60), b: at(u, 180, 60), gap: at(u, 120, 60), n: count(u), steps: App.undoStack.length - d1, bytes: top().bytes, said: said() };
  // the step holds the shape as packed bits and rebuilds it: redo brings back the same bytes, and the
  // same packed copy, so a second undo compares equal to it
  var bitsBefore = Marquee.bitsOf.bits.slice(), packedBefore = Marquee.bitsOf.packed;
  doUndo(); var ua = selBits(); out.add.undoA = at(ua, 60, 60); out.add.undoB = at(ua, 180, 60);
  doRedo(); out.add.redoB = at(selBits(), 180, 60);
  out.add.redoExact = !!Marquee.bitsOf && diff(Marquee.bitsOf.bits, bitsBefore) === 0 && Marquee.bitsOf.packed === packedBefore;
  clickLasso(H, { alt: true });
  var hh = selBits();
  out.sub = { hole: at(hh, 60, 60), ring: at(hh, 30, 30), b: at(hh, 180, 60), n: count(hh), said: said() };
  // Alt with nothing selected has nothing to take from, and says so
  Marquee.none();
  clickLasso(A, { alt: true });
  out.subNothing = { said: said(), sel: Marquee.rect() };

  // ---- 5. …and a rectangle does the same with Shift or Alt on the drag ----
  Marquee.none(); SelectUI.setKind("box");
  Marquee.act("select", function(){ Marquee.set({ x: 20, y: 20, w: 60, h: 60 }); });
  out.rectBytes = top().bytes;
  SelectUI.down(ev({ shift: true }), pt(100, 20)); SelectUI.move(ev({ shift: true }), pt(130, 40)); SelectUI.move(ev({ shift: true }), pt(160, 80));
  var band = !!(SelectUI.d && SelectUI.d.band), live = Marquee.rect() && Marquee.rect().w === 60;
  SelectUI.up();
  var ra = selBits();
  out.rectAdd = { band: band, live: live, a: at(ra, 50, 50), b: at(ra, 130, 50), gap: at(ra, 90, 50), n: count(ra), shape: !!Marquee.shape() };
  SelectUI.down(ev({ alt: true }), pt(30, 30)); SelectUI.move(ev({ alt: true }), pt(50, 50)); SelectUI.up();
  var rs = selBits();
  out.rectSub = { hole: at(rs, 40, 40), kept: at(rs, 70, 70), n: count(rs) };
  var snapC = Marquee.snapshot();
  SelectUI.down(ev({ shift: true }), pt(200, 200)); SelectUI.up();
  out.shiftClickKeeps = Marquee.sameSnap(snapC, Marquee.snapshot());

  // ---- 6. the wand, on the sheet the 2-D view shows ----
  Marquee.none();
  // The patches go on the slot's own sheet AND its composite, the way a texture arrives: a click
  // brings the composite up to date first (what is on screen), and a composite rebuilt from a base
  // that lacked them would take them away.
  s.layers = []; App.activeLayer = null;
  paintBoth(s, "#808080", 0, 0, N, N);
  paintBoth(s, "rgb(200,40,40)", 20, 20, 40, 40);      // A1
  paintBoth(s, "rgb(205,38,44)", 150, 20, 40, 40);     // A2: 5 away, not touching
  paintBoth(s, "rgb(40,160,60)", 100, 150, 40, 50);    // B
  paintBoth(s, "rgb(200,40,40)", 60, 60, 1, 1);         // touches A1 at a corner only
  SelectUI.setKind("wand");
  $("selTol").value = "10"; $("selContig").checked = true;
  // A click reads the sheet a band at a time and resolves later (\`SelectUI.wand\` is the queue's tail).
  var wandAt = async function(x, y, mods){ SelectUI.down(ev(mods), pt(x, y)); SelectUI.up(); await SelectUI.wand; };
  await wandAt(40, 40);
  var w1 = selBits();
  out.wand = { n: count(w1), a2: at(w1, 170, 40), corner: at(w1, 60, 60), box: Marquee.rect(), said: said(),
               row: $("selWandRow").style.display, label: $("btnSelWand").textContent, bytes: top().bytes };
  $("selContig").checked = false;
  await wandAt(40, 40);
  var w2 = selBits(); out.range = { n: count(w2), a2: at(w2, 170, 40), corner: at(w2, 60, 60) };
  $("selTol").value = "0";
  await wandAt(40, 40);
  var w3 = selBits(); out.tol0 = { n: count(w3), a2: at(w3, 170, 40) };
  $("selTol").value = "10"; $("selContig").checked = true;
  await wandAt(40, 40);
  await wandAt(120, 170, { shift: true });
  var w4 = selBits(); out.wandAdd = { n: count(w4), a1: at(w4, 40, 40), b: at(w4, 120, 170) };
  await wandAt(40, 40, { alt: true });
  var w5 = selBits(); out.wandSub = { n: count(w5), a1: at(w5, 40, 40), b: at(w5, 120, 170) };
  // …and an Alt+click on a patch that is not selected takes nothing away: the selection stays as it
  // was, with no step for it, and the status says so rather than that it took something out
  var snapW = Marquee.snapshot(), dW = App.undoStack.length;
  await wandAt(40, 40, { alt: true });
  out.wandSubNothing = { same: Marquee.sameSnap(snapW, Marquee.snapshot()), steps: App.undoStack.length - dW, said: said() };
  SelectUI.down(ev(), pt(10, 200)); SelectUI.move(ev(), pt(30, 220)); SelectUI.up();
  out.wandDrag = { shape: !!Marquee.shape(), r: Marquee.rect() };
  // what the model's Ctrl+click reaches: the same pick, at a texel
  Marquee.none();
  SelectUI.pickAt(s, 120, 170, false, false); await SelectUI.wand;
  out.pickAt = count(selBits());
  // Clicks are QUEUED: a Shift+click made while the one before is still reading combines with what
  // that one selected — two made back to back, without waiting, are both patches.
  Marquee.none();
  SelectUI.pickWand(s, 40, 40, false, false); SelectUI.pickWand(s, 120, 170, true, false);
  await SelectUI.wand;
  var wq = selBits(); out.queued = { n: count(wq), a1: at(wq, 40, 40), b: at(wq, 120, 170) };
  // A click straight after a Fill reads what the Fill made — the composite it queued for the next
  // frame is brought up to date first, as the clone tool does before it reads — not the sheet as it
  // was a frame before. The left half of A1 filled blue is its own patch now.
  Marquee.none(); SelectUI.setKind("box");
  var LQ = paintLayer("fresh"); s.layers = [LQ]; App.activeLayer = LQ;
  Marquee.act("t99 rect", function(){ Marquee.set({ x: 20, y: 20, w: 20, h: 40 }); });
  App.brush.color = "#0000ff"; Marquee.fill();
  SelectUI.setKind("wand");
  await SelectUI.pickWand(s, 25, 30, false, false);
  var wf = selBits(); out.fresh = { n: count(wf), left: at(wf, 25, 30), right: at(wf, 50, 30), said: said() };
  s.layers = []; App.activeLayer = null; App.brush.color = "#ff0000"; scheduleComposite(s); flushComposites();

  // ---- 7. a 4096² sheet: read at its own resolution, a band at a time, and cut texel-exact ----
  var BIG = 4096, sb = mkSlot("t99big", BIG);
  var gb = ctx2d(sb.composite); paintBoth(sb, "rgb(30,90,200)", 1000, 1200, 1000, 600);
  App.activeSlot = sb; Marquee.none();
  $("selTol").value = "10"; $("selContig").checked = true;
  gb.getImageData(0, 0, 1, 1);                                   // drain the queue before the clock starts
  // The click as it is made: timers keep firing while it reads, because it reads a band at a time
  // with the page painting in between — one piece at this size measured past §3.5's 200 ms.
  var ticks = 0, iv = setInterval(function(){ ticks++; }, 0);
  var t0 = performance.now();
  await SelectUI.pickWand(sb, 1500, 1500, false, false);
  var bigMs = Math.round(performance.now() - t0);
  clearInterval(iv);
  var own = Marquee.bitsOf;
  out.big = { ms: bigMs, ticks: ticks, box: Marquee.rect(), said: said(), S: own && own.S, bytes: top().bytes,
              exact: own ? count(own.bits) : -1 };
  // …and the worst case there is: one colour over the whole sheet, so the flood takes every texel
  paintBoth(sb, "rgb(30,90,200)", 0, 0, BIG, BIG); gb.getImageData(0, 0, 1, 1);
  t0 = performance.now();
  await SelectUI.pickWand(sb, 10, 10, false, false);
  out.big.allMs = Math.round(performance.now() - t0); out.big.allTexels = Marquee.bitsOf ? count(Marquee.bitsOf.bits) : -1; out.big.allBox = Marquee.rect();
  // Two patches meeting at an ODD texel, recoloured one after the other with the wand and Fill: every
  // texel of each is its own patch's new colour, opaque, and nothing past either edge is touched. Held
  // at 2048² (the mask resolution) this left 4 texels of the row wrong — A's first column bare, α 191
  // and 63 along both edges, B's colour a texel into A — and the same run at 2048² left none.
  paintBoth(sb, "#808080", 0, 0, BIG, BIG);
  paintBoth(sb, "rgb(200,40,40)", 1001, 1001, 1000, 1000);
  paintBoth(sb, "rgb(40,160,60)", 2001, 1001, 1000, 1000);
  var LB = LayerNode.of({ type: "paint", name: "recolour", canvas: mkCanvas(BIG, BIG), visible: true, opacity: 1, blend: "normal" });
  sb.layers = [LB]; App.activeLayer = LB;
  await SelectUI.pickWand(sb, 1500, 1500, false, false); App.brush.color = "#0000ff"; Marquee.fill();
  await SelectUI.pickWand(sb, 2500, 1500, false, false); App.brush.color = "#ffff00"; Marquee.fill();
  var brow = ctx2d(LB.canvas).getImageData(0, 1500, BIG, 1).data, wrong = 0, partial = 0, spill = 0;
  for (i = 0; i < BIG; i++) {
    var o4 = i * 4, al = brow[o4 + 3];
    if (al > 0 && al < 255) partial++;
    if (i >= 1001 && i < 3001) {
      var blue = brow[o4] === 0 && brow[o4 + 1] === 0 && brow[o4 + 2] === 255, yel = brow[o4] === 255 && brow[o4 + 1] === 255 && brow[o4 + 2] === 0;
      if (al !== 255 || (i < 2001 ? !blue : !yel)) wrong++;
    } else if (al) spill++;
  }
  out.big.recolour = { wrong: wrong, partial: partial, spill: spill };
  // Clear takes exactly the patch out of a full layer: B and the texel before A stay whole. A is
  // picked again first — it shows blue now, the layer over the sheet — and then the layer is filled.
  await SelectUI.pickWand(sb, 1500, 1500, false, false);
  var gl = ctx2d(LB.canvas); gl.globalCompositeOperation = "source-over"; gl.fillStyle = "#00ff00"; gl.fillRect(0, 0, BIG, BIG);
  Marquee.erase();
  var crow = ctx2d(LB.canvas).getImageData(0, 1500, BIG, 1).data, cleft = 0, cpart = 0;
  for (i = 0; i < BIG; i++) { var ca = crow[i * 4 + 3]; if (ca > 0 && ca < 255) cpart++; if (i >= 1001 && i < 2001 && ca) cleft++; }
  out.big.clear = { left: cleft, partial: cpart, before: crow[1000 * 4 + 3], after: crow[2001 * 4 + 3] };
  // A rectangle stays exact when a Shift drag adds a far one to it: the shape they make is filled
  // on exactly the texels the plain rectangle is (at 2048² it spilled a texel out at α 191 and 63)
  var LR = LayerNode.of({ type: "paint", name: "rect", canvas: mkCanvas(BIG, BIG), visible: true, opacity: 1, blend: "normal" });
  sb.layers = [LR]; App.activeLayer = LR; App.brush.color = "#ff0000";
  Marquee.act("t99 rect", function(){ Marquee.set({ x: 101, y: 101, w: 101, h: 101 }); });
  Marquee.fromRect({ x: 3001, y: 3001, w: 11, h: 11 }, "add");
  Marquee.fill();
  var fr = ctx2d(LR.canvas).getImageData(99, 150, 105, 1).data;
  out.big.rectAdd = { x100: fr[1 * 4 + 3], x101: fr[2 * 4 + 3], x201: fr[102 * 4 + 3], x202: fr[103 * 4 + 3] };
  // A composite that lands WHILE a click reads — the Fill made a moment before, a noise fill arriving
  // from the pool — does not change what that click takes: it reads a copy made when it was clicked.
  // Here the patch grows downward on the sheet just after the click starts reading; the click takes
  // the patch as it was, and the next one takes it grown.
  sb.layers = []; App.activeLayer = null;
  paintBoth(sb, "#808080", 0, 0, BIG, BIG);
  paintBoth(sb, "rgb(200,40,40)", 1001, 1001, 1000, 1000);
  var grew = false, inClick = true;
  setTimeout(function(){
    var g = ctx2d(sb.baseC); g.fillStyle = "rgb(200,40,40)"; g.fillRect(1001, 2001, 1000, 1000);
    scheduleComposite(sb); grew = inClick;
  }, 0);
  await SelectUI.pickWand(sb, 1500, 1100, false, false);
  inClick = false;
  out.big.midRead = { grew: grew, n: Marquee.bitsOf ? count(Marquee.bitsOf.bits) : -1, box: Marquee.rect() };
  await SelectUI.pickWand(sb, 1500, 1100, false, false);
  out.big.midRead.next = Marquee.bitsOf ? count(Marquee.bitsOf.bits) : -1;
  Marquee.none(); App.activeSlot = s; App.slots.delete("t99big");
  v2.sc = 1; v2.ox = 0; v2.oy = 0;                        // a click lets the view fit the big sheet; the lasso grabs its first corner in screen pixels

  // ---- 7b. the same verbs on a layer HALF the sheet's size ----
  // Smoothness, metalness and normal layers are the _n's size, and the _n is half the albedo in the
  // game's own files, so there every texel a verb writes covers two of the selection's. The region a
  // verb writes and the shape it cuts with have to put a texel on a boundary on the same side, or two
  // selections meeting at an odd texel each leave that texel to the other: after this review's first
  // round it was α 0 between two wand patches filled one after the other, and Clear left it standing
  // (second round, 2026-09-26). Four selections meet end to end along the albedo — a rectangle, two
  // wand patches and a rectangle of odd width, all starting on odd texels — and each is filled with a
  // smoothness of its own. The oracle is the rule the verbs state, worked out here from the four
  // selections as they were made: texel t of the layer has its centre on the line between albedo
  // texels 2t and 2t + 1, and a tie goes to the texel before, so t is whatever holds albedo texel 2t.
  var HB = BIG / 2, sh2 = mkSlot("t99half", BIG), keepVal = App.brush.value;
  var halfSheet = function(css){ var c = mkCanvas(HB, HB), g = ctx2d(c); g.fillStyle = css; g.fillRect(0, 0, HB, HB); return c; };
  sh2.nSize = HB; sh2.smooth = halfSheet("rgb(60,60,60)"); sh2.metal = halfSheet("#101010"); sh2.normal = halfSheet("#8080ff");
  paintBoth(sh2, "rgb(200,40,40)", 1001, 601, 1000, 800);          // A: albedo x 1001 … 2000, y 601 … 1400
  paintBoth(sh2, "rgb(40,160,60)", 2001, 601, 1000, 800);          // B: x 2001 … 3000
  App.activeSlot = sh2; Marquee.none();
  var LH = LayerNode.of({ type: "paint", chan: "smooth", name: "half", canvas: mkCanvas(HB, HB), visible: true, opacity: 1, blend: "normal" });
  sh2.layers = [LH]; App.activeLayer = LH;
  var lh = function(){ return LayerNode.contentOn(LH, "smooth").canvas; };
  // Each selection is made the way a user makes it — the wand with the colour brush up reads the albedo
  // the view shows — and the verb then runs with the Smoothness brush, which sends it to the layer.
  var selRect = function(x, w){ return function(){ Marquee.act("t99 rect", function(){ Marquee.set({ x: x, y: 601, w: w, h: 800 }); }); }; };
  var selWand = function(x){ return function(){ return SelectUI.pickWand(sh2, x, 1000, false, false); }; };
  var onHalf = async function(sel, verb, v){ setBrushMode("color"); await sel(); setBrushMode("smooth"); App.brush.value = v || 0; App.brush.opacity = 1; verb(); };
  await onHalf(selRect(1, 1000), Marquee.fill, 50);                // C: x 1 … 1000, ending where A begins
  await onHalf(selWand(1500), Marquee.fill, 200);                  // A
  await onHalf(selWand(2500), Marquee.fill, 100);                  // B
  await onHalf(selRect(3001, 1001), Marquee.fill, 150);            // D: x 3001 … 4001, an odd width
  var holder = function(ax){ return ax >= 1 && ax < 1001 ? 50 : ax >= 1001 && ax < 2001 ? 200 : ax >= 2001 && ax < 3001 ? 100 : ax >= 3001 && ax < 4002 ? 150 : -1; };
  var rowsIn = function(ay){ return ay >= 601 && ay < 1401; };
  var val = function(d, i){ var a = d[i * 4 + 3]; return a === 255 ? d[i * 4] : a === 0 ? -1 : -2; };   // -1 empty, -2 partial
  var hrow = ctx2d(lh()).getImageData(0, 500, HB, 1).data, hcol = ctx2d(lh()).getImageData(750, 0, 1, HB).data;
  var hWrong = 0, hFirst = null, vWrong = 0, hPart = 0;
  for (i = 0; i < HB; i++) {
    var hv = val(hrow, i), vv = val(hcol, i);
    if (hv === -2 || vv === -2) hPart++;
    if (hv !== holder(2 * i)) { hWrong++; if (!hFirst) hFirst = i + ": " + hv + ", not " + holder(2 * i); }
    if (vv !== (rowsIn(2 * i) ? 200 : -1)) vWrong++;                // column 750 is albedo x 1500, inside A
  }
  out.half = { target: lh().width, fill: { wrongRow: hWrong, first: hFirst, wrongCol: vWrong, partial: hPart,
    at: [0, 1, 500, 501, 1000, 1001, 1500, 1501, 2000, 2001].map(function(x){ return x + ":" + val(hrow, x); }) } };
  // Clear takes exactly the texels Fill gave A out of a full layer, and Crop keeps exactly B's
  var full = function(){ var g = ctx2d(lh()); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.fillStyle = "rgb(250,250,250)"; g.fillRect(0, 0, HB, HB); };
  var sweep = function(inX, xcol, keep){
    var r = ctx2d(lh()).getImageData(0, 500, HB, 1).data, c = ctx2d(lh()).getImageData(xcol, 0, 1, HB).data, n = 0, first = null;
    for (var k = 0; k < HB; k++) {
      var wantR = inX(2 * k) === keep ? 250 : -1, wantC = rowsIn(2 * k) === keep ? 250 : -1;
      if (val(r, k) !== wantR) { n++; if (!first) first = "x " + k + ": " + val(r, k); }
      if (val(c, k) !== wantC) { n++; if (!first) first = "y " + k + ": " + val(c, k); }
    }
    return { wrong: n, first: first };
  };
  full(); await onHalf(selWand(1500), Marquee.erase);
  out.half.clear = sweep(function(ax){ return ax >= 1001 && ax < 2001; }, 750, false);
  full(); await onHalf(selWand(2500), Marquee.crop);
  out.half.crop = sweep(function(ax){ return ax >= 2001 && ax < 3001; }, 1250, true);
  Marquee.none(); sh2.layers = []; App.activeLayer = null; App.activeSlot = s; App.slots.delete("t99half");
  setBrushMode("color"); App.brush.value = keepVal;
  v2.sc = 1; v2.ox = 0; v2.oy = 0;

  // ---- 8. path → selection covers what the path's Fill paints ----
  Marquee.none(); SelectUI.setOn(false);
  var LP = paintLayer("path"); s.layers = [LP]; App.activeLayer = LP;
  PathUI.set(true);
  PathUI.path = Path.make();
  [[60, 40], [200, 70], [170, 210], [90, 180], [40, 120]].forEach(function(q){ Path.add(PathUI.path, q[0], q[1]); });
  PathUI.path.pts[1].hx = 20; PathUI.path.pts[1].hy = 30;         // one curved node
  PathUI.path.closed = true; PathUI.sync();
  out.pathBtnOn = !$("btnPathSel").disabled;
  PathUI.fill();
  var pf = bytes(LP.canvas), d2 = App.undoStack.length;
  var ok = PathUI.toSelection(ev());
  var ps = selBits(), solidOut = 0, emptyIn = 0, n255 = 0, nAny = 0;
  for (i = 0; i < N * N; i++) { var pa = pf[i * 4 + 3]; if (pa === 255) { n255++; if (!ps[i]) solidOut++; } if (pa > 0) nAny++; if (pa === 0 && ps[i]) emptyIn++; }
  out.path = { ok: ok, solidOut: solidOut, emptyIn: emptyIn, nSel: count(ps), n255: n255, nAny: nAny, steps: App.undoStack.length - d2, shape: !!Marquee.shape(), said: said() };
  Marquee.act("t99 corner", function(){ Marquee.set({ x: 0, y: 0, w: 20, h: 20 }); });
  PathUI.toSelection(ev({ shift: true }));
  var pad = selBits(); out.pathAdd = { corner: at(pad, 5, 5), inPath: at(pad, 120, 120), n: count(pad) };
  PathUI.path.closed = false; PathUI.sync();
  out.pathOpenOff = $("btnPathSel").disabled;
  PathUI.set(false); PathUI.clear();

  // ---- 9. the kinds: one at a time, on their keys, and the panel says which ----
  Marquee.none(); SelectUI.setKind("box"); SelectUI.setOn(false);
  var lbl = function(){ return { kind: SelectUI.kind, on: SelectUI.on, island: SelectUI.island, lasso: $("btnSelLasso").textContent,
                                 wand: $("btnSelWand").textContent, isl: $("btnSelIsland").textContent, row: $("selWandRow").style.display }; };
  key("KeyL"); var k1 = lbl();
  key("KeyW"); var k2 = lbl();
  key("KeyK"); var k3 = lbl();
  key("KeyW"); key("KeyW"); var k4 = lbl();
  out.keys = [k1, k2, k3, k4];
  // switching the lasso or the wand off keeps what it made; only an island PICK is released by Islands off
  SelectUI.setKind("lasso"); clickLasso(A);
  var keepSnap = Marquee.snapshot();
  SelectUI.setIslandMode(false); var keptIsl = Marquee.sameSnap(keepSnap, Marquee.snapshot());
  SelectUI.toggleKind("lasso");
  out.kept = { islandsOff: keptIsl, lassoOff: Marquee.sameSnap(keepSnap, Marquee.snapshot()), kind: SelectUI.kind, info: $("selInfo").textContent };

  // ---- 10. a double-click whose first press lands on the first corner ----
  // That press closes the polygon; the second starts a one-corner outline before the dblclick event
  // arrives, and that outline must be dropped — not refused as "needs three corners" over a
  // selection that was just made.
  Marquee.none(); SelectUI.setKind("lasso");
  var T3 = [[30, 30], [90, 30], [90, 80]];
  T3.forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  SelectUI.down(ev(), pt(31, 31)); SelectUI.up();
  var saidAtClose = said();
  SelectUI.down(ev(), pt(31, 31)); SelectUI.up();
  cnv2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  var gdbl = selBits();
  out.dbl = { lasso: !!SelectUI.lasso, said: said(), saidAtClose: saidAtClose, diff: diff(gdbl, SelShape.poly(T3, N, N)), n: count(gdbl) };
  // An outline half drawn goes with its sheet: a slot switch drops it, and one that reaches Enter on
  // another sheet anyway is refused rather than closed onto a texture it was not drawn on.
  Marquee.none();
  var other = mkSlot("t99other", N);
  [[30, 30], [90, 30]].forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  App.activeSlot = other; SelectUI.sync();
  out.slotSwitch = { dropped: !SelectUI.lasso };
  App.activeSlot = s;
  T3.forEach(function(q){ SelectUI.down(ev(), pt(q[0], q[1])); SelectUI.up(); });
  App.activeSlot = other; key("Enter");
  out.slotSwitch.sel = !!Marquee.rect(); out.slotSwitch.said = said(); out.slotSwitch.after = !!SelectUI.lasso;
  App.activeSlot = s; App.slots.delete("t99other");

  // ---- 11. Shift / Alt with a UV island onto a selection that is not an island pick ----
  App.geomData = [{ name: "isl99", mat: "m99", uv: new Float32Array([.6,.6, .9,.6, .9,.9,  .6,.6, .9,.9, .6,.9]) }];
  App.matSlot.set("m99", s.id); App.meshes.set("isl99", { userData: { mat: "m99" } });
  s._partMaskCache = null; s._uvIslands = null;
  var IP = [Math.round(.75 * N), Math.round((1 - .75) * N)];      // inside the island, far from square A
  // what the island selects on its own — the texels a Shift+click has to add, no more and no fewer
  Marquee.none(); SelectUI.pickIsland(s, IP[0], IP[1], false, false);
  var islN = count(selBits());
  Marquee.none(); SelectUI.setKind("lasso"); clickLasso(A);
  var d11 = App.undoStack.length;
  SelectUI.pickIsland(s, IP[0], IP[1], true, false);
  var ci = selBits();
  out.islAdd = { a: at(ci, 60, 60), isl: at(ci, IP[0], IP[1]), islands: Marquee.islands, n: count(ci), islN: islN,
                 steps: App.undoStack.length - d11, said: said() };
  SelectUI.pickIsland(s, IP[0], IP[1], false, true);
  var cs = selBits();
  out.islSub = { a: at(cs, 60, 60), isl: at(cs, IP[0], IP[1]), n: count(cs), said: said() };
  // a plain rectangle takes the island the same way, and an island pick still adds island ids
  Marquee.none(); Marquee.act("t99 rect", function(){ Marquee.set({ x: 20, y: 20, w: 40, h: 40 }); });
  SelectUI.pickIsland(s, IP[0], IP[1], true, false);
  var cr = selBits();
  out.islRect = { a: at(cr, 30, 30), isl: at(cr, IP[0], IP[1]), n: count(cr) };
  Marquee.none(); SelectUI.pickIsland(s, IP[0], IP[1], false, false);
  out.islPick = { ids: Marquee.islands ? Marquee.islands.size : 0 };
  Marquee.none();
  App.geomData = null; App.meshes.delete("isl99"); App.matSlot.delete("m99"); s._partMaskCache = null; s._uvIslands = null;

  // ---- 12. a sheet whose mask scale is not a power of two keeps every texel of a shape ----
  // 3000 texels sample at k = 2048 / 3000. The box a shape keeps is in sheet texels, and \`stencil\`
  // turns it back into mask texels; rounding the width there cut a shape's last column and row.
  var ODD = 3000, so = mkSlot("t99odd", ODD), go = ctx2d(so.composite), Do = maskDims(ODD, ODD);
  App.activeSlot = so;
  out.odd = { k: Do.k, cases: [] };
  for (var oc = 0; oc < 5; oc++) {
    var ox = 147 + 211 * oc, oy = 147 + 157 * oc, ow = 146 - 7 * oc;
    paintBoth(so, "#808080", 0, 0, ODD, ODD);
    paintBoth(so, "rgb(200,40,40)", ox, oy, ow, ow);
    Marquee.none();
    Marquee.fromColour(so.composite, ox + 20, oy + 20, 10, true, "replace");
    var shB = Marquee.canvasBits(Marquee.mask, Do), stB = Marquee.canvasBits(Marquee.stencil(so), Do);
    out.odd.cases.push({ shape: count(shB), stencil: count(stB), diff: diff(shB, stB), b: SelShape.bounds(shB, Do.w, Do.h), box: Marquee.rect(),
                         exact: Marquee.bitsOf ? count(Marquee.bitsOf.bits) : -1, want: ow * ow, at: [ox, oy, ow] });
  }
  Marquee.none(); App.activeSlot = s; App.slots.delete("t99odd"); v2.sc = 1; v2.ox = 0; v2.oy = 0;

  // ---- 13. the wand reads the sheet the 2-D view SHOWS ----
  // (a) A ground slot with the camouflage preview on, the default: the view draws the vehicle's bare
  // sheet, then the camouflage cut by coverage over it — so the composite under it is on screen
  // nowhere. Its bare sheet has a lighter blotch at x < 8, coverage is opaque at x < 16, half at
  // 16 … 19 and none past that. The oracle is the eyedropper's own \`shownColorAt\`, texel by texel.
  var G = 32, sgnd = mkSlot("t99gnd", G);
  var paintSheet = function(c){ var g = ctx2d(c); g.fillStyle = "rgb(90,60,40)"; g.fillRect(0, 0, G, G); g.fillStyle = "rgb(150,120,90)"; g.fillRect(0, 0, 8, G); };
  sgnd.stockC = mkCanvas(G, G); [sgnd.stockC, sgnd.baseC, sgnd.composite].forEach(paintSheet);
  var cov = new Uint8Array(G * G); for (var yy = 0; yy < G; yy++) for (var xx = 0; xx < 20; xx++) cov[yy * G + xx] = xx < 16 ? 255 : 128;
  sgnd.covBase = cov; sgnd._covRev = 1;
  App.matPaint = App.matPaint || new Map(); App.paintColor = App.paintColor || new Map();
  App.matSlot.set("m99g", sgnd.id); App.matPaint.set("m99g", sgnd.id); App.paintColor.set(sgnd.id, [60, 110, 70]);
  var keepTint = { tint: App.paintTint, cov: App.coverageOn }; App.paintTint = true; App.coverageOn = true;
  App.activeSlot = sgnd; Marquee.none(); SelectUI.setKind("wand");
  $("selTol").value = "0"; $("selContig").checked = true;
  var shown = new Array(G * G), camoN = 0;
  for (i = 0; i < G * G; i++) { shown[i] = shownColorAt(sgnd, i % G, Math.floor(i / G)).join(","); }
  var seedShown = shown[10 * G + 12], wantG = new Uint8Array(G * G);
  for (i = 0; i < G * G; i++) if (shown[i] === seedShown) { wantG[i] = 1; camoN++; }
  var gBits = function(){ return Marquee.bitsOf ? Marquee.bitsOf.bits : new Uint8Array(G * G); };
  await SelectUI.pickWand(sgnd, 12, 10, false, false);
  var gc12 = gBits().slice(), said12 = said();
  await SelectUI.pickWand(sgnd, 4, 10, false, false);                    // on the blotch the camouflage hides
  var gc4 = gBits().slice();
  await SelectUI.pickWand(sgnd, 17, 10, false, false);                   // half coverage: a colour of its own
  var gc17 = gBits().slice(), want17 = 0;
  for (i = 0; i < G * G; i++) if (shown[i] === shown[10 * G + 17]) want17++;
  out.shown = { seed: seedShown, camoN: camoN, d12: diff(gc12, wantG), d4: diff(gc4, wantG), n17: count(gc17), want17: want17,
                at17: gc17[10 * G + 17], said: said12, hex: "#" + shownColorAt(sgnd, 12, 10).map(function(v){ return v.toString(16).padStart(2, "0"); }).join("") };
  App.paintTint = keepTint.tint; App.coverageOn = keepTint.cov;
  App.matSlot.delete("m99g"); App.matPaint.delete("m99g"); App.paintColor.delete(sgnd.id);
  Marquee.none(); App.slots.delete("t99gnd");
  // (b) A smoothness brush shows the smoothness sheet, and (c) so does a channel view of it with the
  // colour brush — here half the albedo's size, as the _n often is. The oracle is \`range\` over the
  // canvas the view draws (\`Draw2D.source\`), read nearest at the selection's resolution; and the
  // colour composite underneath is a different pattern, so a wand reading it would take another set.
  var ssm = mkSlot("t99sm", N), gsm = ctx2d(ssm.composite);
  gsm.fillStyle = "rgb(200,40,40)"; gsm.fillRect(0, 0, N, 64);                           // colour: a band along the top
  ssm.smooth = mkCanvas(N / 2, N / 2);
  var gsh = ctx2d(ssm.smooth); gsh.fillStyle = "rgb(60,60,60)"; gsh.fillRect(0, 0, N / 2, N / 2);
  gsh.fillStyle = "rgb(220,220,220)"; gsh.fillRect(10, 10, 30, 20);                       // gloss: a patch
  App.activeSlot = ssm; Marquee.none();
  $("selTol").value = "10";
  var srcBits = function(){
    var c = Draw2D.source(ssm), t = mkCanvas(N, N), g = ctx2d(t); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, N, N);
    return { src: c, bits: SelShape.range(g.getImageData(0, 0, N, N).data, N, N, 50, 40, 10, true) };
  };
  setBrushMode("smooth");
  var wantSm = srcBits();
  await SelectUI.pickWand(ssm, 50, 40, false, false);
  var gotSm = gBits().slice();
  setBrushMode("color"); App.chanView = "smooth";
  var wantCv = srcBits();
  await SelectUI.pickWand(ssm, 50, 40, false, false);
  var gotCv = gBits().slice();
  App.chanView = null;
  out.chan = { smSrc: wantSm.src === ssm.smooth, dSm: diff(gotSm, wantSm.bits), nSm: count(gotSm), dCv: diff(gotCv, wantCv.bits), nCv: count(gotCv),
               cvSrc: wantCv.src !== ssm.composite, colourWouldBe: count(SelShape.range(bytes(ssm.composite), N, N, 50, 40, 10, true)) };
  Marquee.none(); App.activeSlot = s; App.slots.delete("t99sm"); v2.sc = 1; v2.ox = 0; v2.oy = 0;
  $("selTol").value = "10";

  // ---- 14. Shift or Alt with a shape that changes nothing leaves the selection as it was ----
  // A lasso round no texel centre, Shift-added to a rectangle, used to turn the rectangle into a
  // shape with no handles, push a step holding a canvas, and say it had added the lasso.
  Marquee.none(); SelectUI.setKind("box");
  Marquee.act("t99 rect", function(){ Marquee.set({ x: 10, y: 10, w: 50, h: 50 }); });
  var snapN = Marquee.snapshot(), dN = App.undoStack.length;
  SelectUI.setKind("lasso");
  clickLasso([[100.1, 100.1], [100.4, 100.1], [100.4, 100.4]], { shift: true });
  out.noop = { same: Marquee.sameSnap(snapN, Marquee.snapshot()), shape: !!Marquee.shape(), steps: App.undoStack.length - dN, said: said() };
  clickLasso([[20, 20], [40, 20], [40, 40], [20, 40]], { shift: true });   // already inside the rectangle
  out.noop.inside = { same: Marquee.sameSnap(snapN, Marquee.snapshot()), steps: App.undoStack.length - dN, said: said() };
  clickLasso([[150, 150], [200, 150], [200, 200], [150, 200]], { alt: true });   // nowhere near it
  out.noop.alt = { same: Marquee.sameSnap(snapN, Marquee.snapshot()), steps: App.undoStack.length - dN, said: said() };
  Marquee.none(); SelectUI.setKind("box");

  // ---- 15. a camouflage tile's repeats (4.50 (6), which landed beside this item) ----
  // The 2-D view draws a tile 3 × 3, and on a repeat the texel under the pointer is the sheet's own,
  // one period over — the eyedropper's rule. A wand click there was clamped to the sheet's edge and
  // took whatever colour sat on it. A patch well inside, and a column along the right edge where a
  // clamp from the right-hand repeat lands; the corner a clamp from the top-left one lands on is grey.
  var stl = mkSlot("t99tile", N); stl.camoTile = true;
  paintBoth(stl, "rgb(30,90,200)", 20, 20, 40, 40);
  paintBoth(stl, "rgb(220,200,40)", N - 8, 0, 8, N);
  App.activeSlot = stl; Marquee.none(); SelectUI.setKind("wand");
  $("selTol").value = "10"; $("selContig").checked = true;
  var tileSel = function(){ var b = Marquee.bitsOf ? Marquee.bitsOf.bits : new Uint8Array(N * N); return { n: count(b), patch: at(b, 40, 40), edge: at(b, N - 1, 40), corner: at(b, 0, 0), said: said() }; };
  await wandAt(N + 40, 40);                              // on the right-hand repeat, over the patch
  out.tile = { right: tileSel() };
  Marquee.none();
  await wandAt(40 - N, 40 - N);                          // on the repeat up and to the left
  out.tile.upLeft = tileSel();
  Marquee.none(); App.activeSlot = s; App.slots.delete("t99tile");

  Marquee.none(); SelectUI.setKind("box"); SelectUI.setOn(false);
  s.layers = []; App.activeLayer = keep.layer; App.activeSlot = keep.slot; App.slots.delete("t99");
  App.brush.color = keep.color; App.brush.size = keep.size; App.brush.hardness = keep.hard; App.brush.opacity = keep.op;
  setBrushMode(keep.mode);
  v2.sc = keep.sc; v2.ox = keep.ox; v2.oy = keep.oy; App.chanView = keep.chanView;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 300000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const o = run.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }
const J = v => JSON.stringify(v);

console.log("\n=== a freehand lasso ===");
const F = o.free;
console.log(`   ${F.drawn} corners drawn · box ${J(F.box)} · ${F.n} texels (the polygon's own ${F.want}) · ${F.steps} step of ${F.bytes} bytes`);
R.is(o.kind.kind === "lasso" && o.kind.on && /Lasso: on/.test(o.kind.lasso) && o.kind.wandRow === "none",
  `choosing the lasso turns Select on and says so (${o.kind.lasso}); the wand's row stays hidden`);
R.is(F.drawn === 64 && F.closed && F.shape && F.islands === null,
  `a drag round a circle is 64 corners, closes when the button comes up, and is a SHAPE with no island ids (${F.drawn}, closed ${F.closed})`);
R.is(F.diff === 0 && F.n > 7500,
  `the selection is exactly the polygon's texels — ${F.diff} of ${F.want} differ (πr² for r = 50 is about 7 854)`);
R.is(F.box && F.box.x === 78 && F.box.y === 78 && F.box.w === 100 && F.box.h === 100,
  `and its box is the shape's own extent — texels 78 … 177, whose centres lie inside x = 78 … 178 (${J(F.box)})`);
R.is(F.steps === 1 && F.bytes === 256 * 256 / 8,
  `one undo step, which carries the shape as one bit a texel — ${F.bytes} bytes, not the ${256 * 256 * 4} of a canvas — and counts them: a shape no id can rebuild lives as long as its step, and the byte budget has to see it`);
R.is(/shape is selected/.test(F.info) && /Selected the lasso/.test(F.said),
  `the panel calls it a shape, not "texels selected" (“${F.info.slice(0, 40)}…”), and the status line says what happened`);

console.log("\n=== the verbs and the brush follow it ===");
R.is(Object.keys(o.threw).length === 0,
  Object.keys(o.threw).length ? "a verb threw on a non-island shape: " + J(o.threw) : "Fill, Clear, Crop and Copy all run on a shape that is not an island pick — before this item three of them threw reading `islands.size`");
R.is(o.fill.inside === F.want && o.fill.outside === 0,
  `Fill paints the lasso's texels and nothing else (${o.fill.inside} of ${F.want} inside, ${o.fill.outside} outside)`);
R.is(o.fill.partial === 0, `and every one of them is opaque — a selection is a yes/no, so no texel of the fill is partial (${o.fill.partial})`);
R.is(o.clear.hole === 0 && o.clear.boxCorner === 255 && o.clear.far === 255,
  `Clear takes the shape out and leaves the rest of its box (${o.clear.hole} / ${o.clear.boxCorner} / ${o.clear.far})`);
R.is(o.crop.kept === 255 && o.crop.boxCorner === 0 && o.crop.far === 0,
  `Crop keeps the shape and clears the rest, the corners of its own box included (${o.crop.kept} / ${o.crop.boxCorner} / ${o.crop.far})`);
R.is(o.copy && o.copy.mid === 255 && o.copy.boxCorner === 0, `Copy carries the silhouette, not the box (${J(o.copy)})`);
R.is(o.stroke.inside === 255 && o.stroke.boxCorner === 0 && o.stroke.far === 0,
  `and a stroke walked out through the box corner and past the circle paints only inside it (${o.stroke.inside} / ${o.stroke.boxCorner} / ${o.stroke.far})`);

console.log("\n=== a polygon lasso ===");
R.is(o.open.open && o.open.corners === 4 && !o.open.sel && /4 corners/.test(o.open.info),
  `clicks put down corners and the outline stays open, saying how to close it (“${o.open.info.slice(0, 30)}…”)`);
R.is(o.poly.closed && o.poly.n === 80 * 60 && o.poly.diff === 0,
  `a click on the first corner closes it, and the selection is the polygon's 80 × 60 texels exactly (${o.poly.n}, ${o.poly.diff} differ)`);
R.is(o.back === 3, `Backspace takes back the last corner (${o.back} left of 4)`);
R.is(o.esc.dropped && o.esc.same, "Esc drops the outline being drawn and leaves the selection under it alone — it does not also clear the selection, which is what Esc means once nothing is being drawn");
R.is(o.enter.closed && o.enter.inTri === 1 && o.enter.outTri === 0 && o.enter.oldGone,
  "Enter closes a polygon, and a plain lasso REPLACES what was selected");
R.is(!o.two.sel && !o.two.lasso && /three corners/.test(o.two.said), `two corners are not a lasso, and it says so (“${o.two.said}”)`);

console.log("\n=== Shift adds, Alt removes ===");
const AD = o.add, SB = o.sub;
R.is(AD.a && AD.b && !AD.gap && AD.n === 2 * 80 * 80, `Shift at the first press adds the second lasso to the first (${AD.n} = 2 × 6 400, nothing in the gap)`);
R.is(AD.steps === 1 && AD.bytes === 256 * 256 / 8 && /Added the lasso/.test(AD.said), `as one step (${AD.steps}) carrying its own bits (${AD.bytes} bytes)`);
R.is(AD.undoA && !AD.undoB && AD.redoB, "undo takes the added lasso back off and keeps the first; redo puts it back");
R.is(AD.redoExact, "and redo rebuilds the shape from the step's packed bits byte for byte, keeping the step's own copy");
R.is(!SB.hole && SB.ring && SB.b && SB.n === 2 * 80 * 80 - 20 * 20 && /Took the lasso out/.test(SB.said),
  `Alt takes a lasso OUT — a 20 × 20 hole in the first square, the rest kept (${SB.n})`);
R.is(!o.subNothing.sel && /Nothing is selected to take away from/.test(o.subNothing.said), `Alt with nothing selected says there was nothing to take from (“${o.subNothing.said}”)`);
const RA = o.rectAdd, RS = o.rectSub;
R.is(o.rectBytes === 0, "a plain rectangle step carries no bytes — it is four numbers, not a canvas");
R.is(RA.band && RA.live, "a Shift drag is only an outline while it moves — the live selection is untouched until the button comes up");
R.is(RA.a && RA.b && !RA.gap && RA.n === 2 * 60 * 60 && RA.shape, `then the rectangle joins the selection (${RA.n} = 2 × 3 600), which becomes a shape`);
R.is(!RS.hole && RS.kept && RS.n === 2 * 60 * 60 - 20 * 20, `and an Alt drag takes a rectangle out of it (${RS.n})`);
R.is(o.shiftClickKeeps, "a Shift+click that never became a rectangle changes nothing — a plain click clears, a modified one was the start of adding");

console.log("\n=== the magic wand and colour range ===");
const W = o.wand;
console.log(`   contiguous ${W.n} · range ${o.range.n} · tolerance 0 ${o.tol0.n} · + B ${o.wandAdd.n} · − A1 ${o.wandSub.n} · box ${J(W.box)}`);
R.is(W.row === "" && /Wand: on/.test(W.label), "the wand's Tolerance and Contiguous row is there while the wand is");
R.is(W.n === 1600 && !W.a2 && !W.corner && W.box && W.box.x === 20 && W.box.w === 40,
  `a click takes the patch under it — 40 × 40 = ${W.n}, not the look-alike across the sheet, not the texel touching its corner`);
R.is(/patch of #c82828 ± 10/.test(W.said) && W.bytes === 256 * 256 / 8, `the status names the colour it took (“${W.said.slice(0, 44)}…”), and the step carries its bits (${W.bytes} bytes)`);
R.is(o.range.n === 3201 && o.range.a2 && o.range.corner, `with Contiguous off it is colour range: every texel within 10, anywhere (${o.range.n} = 1 600 + 1 600 + 1)`);
R.is(o.tol0.n === 1601 && !o.tol0.a2, `at tolerance 0 only the exact colour — the look-alike 5 away drops out (${o.tol0.n})`);
R.is(o.wandAdd.n === 1600 + 2000 && o.wandAdd.a1 && o.wandAdd.b, `Shift+click adds a second patch (${o.wandAdd.n})`);
R.is(o.wandSub.n === 2000 && !o.wandSub.a1 && o.wandSub.b, `Alt+click takes one away (${o.wandSub.n})`);
R.is(o.wandSubNothing.same && o.wandSubNothing.steps === 0 && /takes nothing away/.test(o.wandSubNothing.said),
  `and Alt+click on a patch that is not selected leaves the selection as it was, with no step, and says so (“${o.wandSubNothing.said.slice(0, 44)}…”)`);
R.is(!o.wandDrag.shape && o.wandDrag.r && o.wandDrag.r.w === 20, "a drag with the wand still makes a rectangle, the way it does with Islands");
R.is(o.pickAt === 2000, `the model's Ctrl+click reaches the same pick at a texel (${o.pickAt})`);
R.is(o.queued.n === 1600 + 2000 && o.queued.a1 && o.queued.b,
  `a click and a Shift+click made back to back, before the first has finished reading, are both taken — the clicks are queued, not raced (${o.queued.n})`);
R.is(o.fresh.n === 20 * 40 && o.fresh.left && !o.fresh.right && /#0000ff/.test(o.fresh.said),
  `a click straight after a Fill takes what the Fill made — the half of the patch just filled blue, ${o.fresh.n} texels, not the whole red patch the sheet was a frame before (“${o.fresh.said.slice(0, 36)}…”)`);

console.log("\n=== a 4096² sheet: at its own resolution, a band at a time, cut texel-exact ===");
const BG = o.big;
console.log(`   ${BG.ms} ms for a patch, ${BG.ticks} timer ticks while it read (headless, software raster) · box ${J(BG.box)}` +
  ` · the whole sheet one colour: ${BG.allMs} ms for ${BG.allTexels} texels`);
R.is(BG.S && BG.S.w === 4096 && BG.S.h === 4096 && BG.exact === 600000 && BG.box && BG.box.x === 1000 && BG.box.y === 1200 && BG.box.w === 1000 && BG.box.h === 600,
  `the selection is held at the sheet's own 4096², not the 2048² mask resolution: the patch is its exact ${BG.exact} texels, 1000 × 600 at 1000, 1200`);
R.is(BG.bytes === 4096 * 4096 / 8, `and that step carries it as 2 MB of bits (${BG.bytes} bytes) — the 2048² canvas it used to hold was 16 MB, a default history's worth in 23 clicks`);
R.is(BG.ticks > 0, `the click reads the sheet a band at a time with the page running in between — ${BG.ticks} timer ticks landed while it read, where one piece would have held the page for all of it`);
R.is(BG.allTexels === 4096 * 4096 && BG.allBox && BG.allBox.w === 4096 && BG.allBox.h === 4096,
  `a patch that is the whole 4096² sheet is taken whole (${BG.allTexels} texels) — the flood's worst case, ${BG.allMs} ms here`);
R.is(BG.allMs < 5000 && BG.ms < 5000, `a wand click on a 4096² sheet stays a click even on a loaded machine (${BG.ms} / ${BG.allMs} ms, bound 5000 — measured, not a latency gate)`);
R.is(BG.recolour.wrong === 0 && BG.recolour.partial === 0 && BG.recolour.spill === 0,
  `two patches meeting at an ODD texel, each taken with the wand and filled: every texel of both is its own patch's new colour, opaque, and nothing past them is touched (${BG.recolour.wrong} wrong, ${BG.recolour.partial} partial, ${BG.recolour.spill} spilled) — at 2048² this row had 4 wrong`);
R.is(BG.clear.left === 0 && BG.clear.partial === 0 && BG.clear.before === 255 && BG.clear.after === 255,
  `Clear takes exactly that patch out — ${BG.clear.left} of its texels left, ${BG.clear.partial} partial, the texel before it and the neighbour's first kept (${BG.clear.before} / ${BG.clear.after})`);
const RQ = BG.rectAdd;
R.is(RQ.x100 === 0 && RQ.x101 === 255 && RQ.x201 === 255 && RQ.x202 === 0,
  `a rectangle Shift-joined by a far one fills exactly its own texels, as a plain rectangle does (${RQ.x100} / ${RQ.x101} / ${RQ.x201} / ${RQ.x202} at 100 / 101 / 201 / 202; at 2048² it was 191 / 255 / 191 / 63)`);
const MR = BG.midRead;
R.is(MR.grew && MR.n === 1000 * 1000 && MR.box && MR.box.h === 1000 && MR.next === 1000 * 2000,
  `a sheet recomposited while a click is still reading does not reach that click — it takes the patch as it was when clicked (${MR.n} texels, box ${MR.box && MR.box.h} high; the sheet changed during it: ${MR.grew}), and the next click takes it grown (${MR.next})`);

console.log("\n=== the verbs on a layer half the sheet's size ===");
const HF = o.half;
console.log(`   row 1000 of the albedo on the ${HF.target}² smoothness layer (texel: value, −1 empty): ${HF.fill.at.join(" · ")}`);
R.is(HF.target === 2048 && HF.fill.wrongRow === 0 && HF.fill.partial === 0,
  `a rectangle, two wand patches and a rectangle of odd width, meeting end to end at odd texels of a 4096² albedo and each filled with its own smoothness, tile the 2048² layer: every texel takes the selection holding its centre, a tie going to the texel before — ${HF.fill.wrongRow} of 2048 wrong${HF.fill.first ? " (first " + HF.fill.first + ")" : ""}, ${HF.fill.partial} partial. After the review's first round the texel the two patches share was left empty, and the odd-width rectangle took the texel past its end`);
R.is(HF.fill.wrongCol === 0, `and down a column, across the patch's top and bottom rows, which start and end on odd texels too (${HF.fill.wrongCol} wrong)`);
R.is(HF.clear.wrong === 0,
  `Clear on a full layer takes exactly the texels Fill gave that patch — the one it shares with its neighbour included, the one before it kept — along the row and down the column (${HF.clear.wrong} wrong${HF.clear.first ? ", first " + HF.clear.first : ""})`);
R.is(HF.crop.wrong === 0, `and Crop keeps exactly the other patch's (${HF.crop.wrong} wrong${HF.crop.first ? ", first " + HF.crop.first : ""})`);

console.log("\n=== the shape tool's path becomes a selection ===");
const PA = o.path;
console.log(`   Fill: ${PA.n255} opaque, ${PA.nAny} touched · selection ${PA.nSel} texels`);
R.is(o.pathBtnOn && o.pathOpenOff, "→ selection is offered for a closed path and not for an open one");
R.is(PA.ok && PA.shape && PA.steps === 1 && /Selected the path/.test(PA.said), "a closed path becomes a shaped selection in one step");
R.is(PA.solidOut === 0 && PA.emptyIn === 0 && PA.nSel >= PA.n255 && PA.nSel <= PA.nAny,
  `and it covers what the path's Fill paints: every opaque texel of the Fill is selected (${PA.solidOut} are not), nothing the Fill left empty is (${PA.emptyIn}) — only the antialiased rim is decided by its centre`);
R.is(o.pathAdd.corner && o.pathAdd.inPath && o.pathAdd.n === PA.nSel + 400, `Shift+click adds the path to what was selected (${o.pathAdd.n} = ${PA.nSel} + 400)`);

console.log("\n=== the kinds ===");
const [k1, k2, k3, k4] = o.keys;
R.is(k1.kind === "lasso" && k1.on && /on/.test(k1.lasso) && /off/.test(k1.wand) && /off/.test(k1.isl), `L turns the lasso on, and Select with it (${k1.lasso} · ${k1.wand} · ${k1.isl})`);
R.is(k2.kind === "wand" && /off/.test(k2.lasso) && /on/.test(k2.wand) && k2.row === "", `W switches to the wand — one kind at a time, and its row appears (${k2.lasso} · ${k2.wand})`);
R.is(k3.kind === "island" && k3.island && /off/.test(k3.wand) && k3.row === "none", `K is Islands, and the wand's row goes (${k3.isl} · ${k3.wand})`);
R.is(k4.kind === "box" && k4.on, "a kind's own key twice is on and back to the plain rectangle");
R.is(o.kept.islandsOff && o.kept.lassoOff && o.kept.kind === "box" && /shape is selected/.test(o.kept.info),
  "switching the lasso off, or Islands off, keeps what the lasso made — only an island PICK is released by Islands off (2026-08-31's rule)");

console.log("\n=== a double-click on the first corner ===");
const DB = o.dbl;
R.is(!DB.lasso && DB.diff === 0 && DB.n > 0 && DB.said === DB.saidAtClose && /Selected the lasso/.test(DB.said),
  `a double-click whose first press closes the polygon on its first corner keeps that selection (${DB.n} texels, ${DB.diff} off) and leaves no stray outline; the status still says what was selected (“${DB.said.slice(0, 32)}…”), not that a lasso needs three corners`);
const SW = o.slotSwitch;
R.is(SW.dropped && !SW.sel && !SW.after && /drawn on another texture/.test(SW.said),
  `an outline half drawn goes with its sheet — a slot switch drops it, and Enter on another sheet refuses it rather than selecting there (“${SW.said.slice(0, 44)}…”)`);

console.log("\n=== a UV island onto a selection that is not an island pick ===");
const IA = o.islAdd, IS = o.islSub;
console.log(`   the island selects ${IA.islN} texels on its own; square + island ${IA.n}; minus the island ${IS.n}; rectangle + island ${o.islRect.n}`);
R.is(IA.a && IA.isl && IA.islands === null && IA.islN > 1000 && IA.n === 80 * 80 + IA.islN && IA.steps === 1 && /Added the UV island/.test(IA.said),
  `Shift+click on an island ADDS it to a lasso's shape — the square kept, the island joined (${IA.n} = 6 400 + ${IA.islN}), as one step (${IA.steps}); before, the island replaced it`);
R.is(IS.a && !IS.isl && IS.n === 80 * 80 && /Took the UV island out/.test(IS.said), `and Alt+click takes it back out (${IS.n})`);
R.is(o.islRect.a && o.islRect.isl && o.islRect.n === 40 * 40 + IA.islN, `a plain rectangle takes an island the same way (${o.islRect.n} = 1 600 + ${IA.islN})`);
R.is(o.islPick.ids === 1, "and a click with nothing selected is still an island pick, with its id");

console.log("\n=== a sheet whose mask scale is not a power of two ===");
const OD = o.odd;
for (const c of OD.cases) console.log(`   shape ${c.shape} · stencil ${c.stencil} · ${c.diff} differ · mask box ${J(c.b)} · sheet box ${J(c.box)}`);
R.is(OD.k < 1 && OD.cases.length === 5 && OD.cases.every(c => c.shape > 5000 && c.diff === 0),
  `at k = ${OD.k.toFixed(4)} (a 3000-texel sheet) the stencil in force is the wand's shape texel for texel, in all ${OD.cases.length} placements (${OD.cases.map(c => c.diff).join(" / ")} differ) — the box no longer rounds off its last column and row`);
R.is(OD.cases.every(c => c.exact === c.want && c.box && c.box.x === c.at[0] && c.box.y === c.at[1] && c.box.w === c.at[2] && c.box.h === c.at[2]),
  `and the selection itself is each patch's exact texels in sheet texels, box and all (${OD.cases.map(c => c.exact + "/" + c.want).join(" · ")})`);

console.log("\n=== the wand reads the sheet the 2-D view shows ===");
const SH = o.shown, CH = o.chan;
console.log(`   ground slot: the camouflage ${SH.seed} shows on ${SH.camoN} texels · smoothness ${CH.nSm} · channel view ${CH.nCv} · the colour composite would give ${CH.colourWouldBe}`);
R.is(SH.d12 === 0 && SH.camoN === 16 * 32,
  `on a ground slot with the camouflage preview on, a click takes the texels SHOWING the colour under it, the eyedropper's colour texel by texel (${SH.d12} of ${SH.camoN} differ)`);
R.is(SH.d4 === 0,
  `a click on the stock sheet's blotch the camouflage covers takes the same patch — the blotch is on screen nowhere (${SH.d4} differ; before, it took the blotch)`);
R.is(SH.n17 === SH.want17 && SH.at17 === 1, `and half coverage is its own colour, taken on its own (${SH.n17} of ${SH.want17})`);
R.is(new RegExp("patch of " + SH.hex).test(SH.said), `the status names the colour on screen, the eyedropper's ${SH.hex} (“${SH.said.slice(0, 40)}…”)`);
R.is(CH.smSrc && CH.dSm === 0 && CH.nSm === 60 * 40,
  `with a smoothness brush it reads the smoothness sheet the view shows — half the albedo's size, taken exactly (${CH.nSm} = 60 × 40, ${CH.dSm} differ)`);
R.is(CH.cvSrc && CH.dCv === 0 && CH.nCv > 0, `and with a channel view of it and the colour brush, the view (${CH.nCv} texels, ${CH.dCv} differ)`);
R.is(CH.colourWouldBe !== CH.nSm, `where the colour composite under the same texel is another patch altogether (${CH.colourWouldBe} texels)`);

console.log("\n=== Shift or Alt that changes nothing ===");
const NO = o.noop;
R.is(NO.same && !NO.shape && NO.steps === 0 && /adds nothing/.test(NO.said),
  `a Shift-lasso round no texel centre leaves the rectangle a rectangle, pushes no step, and says it added nothing (“${NO.said.slice(0, 44)}…”)`);
R.is(NO.inside.same && NO.inside.steps === 0 && /adds nothing/.test(NO.inside.said), "so does a Shift-lasso wholly inside what is selected");
R.is(NO.alt.same && NO.alt.steps === 0 && /takes nothing away/.test(NO.alt.said), "and an Alt-lasso nowhere near it takes nothing away and says so");

console.log("\n=== a camouflage tile's repeats ===");
const TR = o.tile.right, TU = o.tile.upLeft;
R.is(TR.n === 1600 && TR.patch === 1 && TR.edge === 0 && /patch of #1e5ac8/.test(TR.said),
  `a wand click on a camouflage tile's right-hand repeat takes the patch under the pointer, one period over — the eyedropper's rule (${TR.n} texels, “${TR.said.slice(0, 40)}…”); clamped to the sheet, it took the column along its edge`);
R.is(TU.n === 1600 && TU.patch === 1 && TU.corner === 0,
  `and so does one on the repeat up and to the left (${TU.n} texels; clamped, it took the grey from the corner)`);

const errs = (o.__errs || []).concat(o.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
