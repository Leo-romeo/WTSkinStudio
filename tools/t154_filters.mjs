// Blur, sharpen and add-noise as effect kinds, and the four numbers landing without adding coverage
// (ROADMAP 4.50 (5), what was left of it).
//
// WHY THIS EXISTS. These three are the effect kinds that are not a function of one texel, which is
// the property every other kind's region path rested on (t52, t92): a blur composited over a dirty
// rectangle reads texels the rectangle does not hold, and without the margin the compositor now
// gives it, its edge blurs against nothing and seams against the whole sheet the moment a brush
// stroke passes under it. Noise reads no neighbour but must be seeded on where the texel IS, or a
// region lays different grain from the sheet. So:
//
//   Node, on the pure `/*==EFFECTS==*/` section (with GRADIENT, which it needs):
//   * the kernel's weights sum to 1 and fall away from the centre; a flat region blurs to itself; a
//     separable pass is the 2-D kernel to a level; blurring is done premultiplied, so a transparent
//     texel lends no black to an opaque neighbour;
//   * sharpen at 0 % is the sheet, and at a step it overshoots on both sides;
//   * noise at 0 is the sheet, moves each channel by at most its amount, is the same shift on all
//     three when mono, and a region read from (sx, sy) is that block of the whole sheet, to the byte;
//   * the records are held to their ranges, and `reach` is what the compositor grows a region by.
//
//   Headless Chrome, on the real compositor:
//   * the GPU pass is the one running, and agrees with the CPU pass — noise to the byte, blur and
//     sharpen to a level (float32 sums against doubles);
//   * region == whole for each kind, with a soft mask, chained, and inside a group — and the same
//     check with the margin taken away fails, so it is the margin that holds it;
//   * an effect at rest inside a group keeps the group's coverage: the four numbers (which made a
//     0.69-coverage layer 0.90 until this change) and a blur;
//   * the CPU fallback inside a composite is the GPU's to a level;
//   * save / load keeps each kind, a crafted record is clamped, and the panel's rows are one undo
//     step each.
//
// Usage: node tools/t154_filters.mjs [--keep] [--chrome <path>]
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

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };
const worst = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

console.log("=== blur ===");
{
  const ok = [1, 4, 13, 32].every(r => {
    const w = Effect.weights(r), sum = w.reduce((a, v, i) => a + (i ? 2 * v : v), 0);
    return w.length === r + 1 && Math.abs(sum - 1) < 1e-12 && w.every((v, i) => !i || v < w[i - 1]);
  });
  R.is(ok, "the kernel's weights sum to 1 over −r…r and fall away from the centre, at radius 1, 4, 13 and 32");
  const flat = img(40, 30, () => [90, 140, 200, 255]);
  R.is(worst(Effect.spatial({ type: "blur", radius: 6 }, flat, 40, 30, 0, 0, false), flat) === 0, "a flat region blurs to itself, edges included (they are clamped, not faded)");
  // Against the 2-D kernel applied directly, on an opaque pattern: the separable pass rounds once
  // in between, so a level apart at most.
  const W = 48, H = 40, r = 5, pat = img(W, H, (x, y) => [(x * 37 + y * 11) % 256, (x * x + y * 7) % 256, ((x ^ y) * 13) % 256, 255]);
  const got = Effect.spatial({ type: "blur", radius: r }, pat, W, H, 0, 0, false), w = Effect.weights(r), ref = new Uint8ClampedArray(pat.length);
  const cl = (v, n) => v < 0 ? 0 : v >= n ? n - 1 : v;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) s += w[Math.abs(i)] * w[Math.abs(j)] * pat[(cl(y + j, H) * W + cl(x + i, W)) * 4 + c];
    ref[(y * W + x) * 4 + c] = Math.round(s); ref[(y * W + x) * 4 + 3] = 255;
  }
  const e = worst(got, ref);
  R.is(e <= 1 && worst(got, pat) > 40, `two passes are the 2-D Gaussian to a level (worst ${e}), and it does blur (moved up to ${worst(got, pat)})`);
  // Red beside transparent black, the way a group's scratch holds paint: premultiplied, the edge
  // texel stays red; straight, it would be pulled toward the black of a texel that is not there.
  const half = img(20, 4, x => x < 10 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  const hb = Effect.spatial({ type: "blur", radius: 4 }, half, 20, 4, 0, 0, false), at = x => [...hb.slice((20 + x) * 4, (20 + x) * 4 + 3)];
  R.is(at(9).join() === "255,0,0" && at(12).join() === "255,0,0", `blurred premultiplied: next to transparent texels red stays red (${at(9)} | ${at(12)}), no dark fringe`);
  // A camouflage tile repeats, so with `wrap` its blur reads round the edge: red at the left edge
  // takes blue from the right one, and the result equals the middle of the tile laid three times.
  const tw = 32, tl = img(tw, 4, x => x < tw / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  const wr = Effect.spatial({ type: "blur", radius: 5 }, tl, tw, 4, 0, 0, false, true), cl0 = Effect.spatial({ type: "blur", radius: 5 }, tl, tw, 4, 0, 0, false, false);
  const three = img(3 * tw, 4, x => x % tw < tw / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]), t3 = Effect.spatial({ type: "blur", radius: 5 }, three, 3 * tw, 4, 0, 0, false, false);
  let tdiff = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < 4; c++) tdiff = Math.max(tdiff, Math.abs(wr[(y * tw + x) * 4 + c] - t3[(y * 3 * tw + tw + x) * 4 + c]));
  R.is(wr[2] > 40 && cl0[2] === 0 && tdiff === 0, `on a tile it wraps: the left edge takes blue from the right (${wr[2]}, clamped ${cl0[2]}), exactly the middle of the tile laid three times (${tdiff} off)`);
}

console.log("\n=== sharpen ===");
{
  const W = 30, H = 6, step = img(W, H, x => x < 15 ? [60, 60, 60, 255] : [180, 180, 180, 255]);
  R.is(worst(Effect.spatial({ type: "sharpen", radius: 3, amount: 0 }, step, W, H, 0, 0, false), step) === 0, "at 0 % it is the sheet, to the byte");
  const s = Effect.spatial({ type: "sharpen", radius: 3, amount: 150 }, step, W, H, 0, 0, false), v = x => s[(2 * W + x) * 4];
  R.is(v(14) < 60 && v(15) > 180 && v(2) === 60 && v(27) === 180, `at a step it overshoots on both sides (${v(14)} | ${v(15)} against 60 | 180) and leaves the flats alone (${v(2)}, ${v(27)})`);
}

console.log("\n=== noise ===");
{
  const W = 300, H = 280, grey = img(W, H, (x, y) => [100 + (x % 7), 120, 140 - (y % 5), 255]);
  R.is(worst(Effect.spatial({ type: "noise", amount: 0, mono: true, seed: 3 }, grey, W, H, 0, 0, false), grey) === 0, "at amount 0 it is the sheet");
  const n = Effect.spatial({ type: "noise", amount: 20, mono: false, seed: 3 }, grey, W, H, 0, 0, false);
  let mx = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n.length; i += 4) for (let c = 0; c < 3; c++) { const d = n[i + c] - grey[i + c]; mx = Math.max(mx, Math.abs(d)); sum += d; cnt++; }
  R.is(mx === 20 && Math.abs(sum / cnt) < .2, `each channel moves at most its amount (worst ${mx} of 20), about nothing on average (${(sum / cnt).toFixed(3)})`);
  const m = Effect.spatial({ type: "noise", amount: 20, mono: true, seed: 3 }, grey, W, H, 0, 0, false);
  let same = true, diff = 0;
  for (let i = 0; i < m.length; i += 4) { const a = m[i] - grey[i], b = m[i + 1] - grey[i + 1], c = m[i + 2] - grey[i + 2]; if (a !== b || b !== c) same = false; }
  for (let i = 0; i < n.length; i += 4) if (n[i] - grey[i] !== n[i + 1] - grey[i + 1]) diff++;
  R.is(same && diff > n.length / 8, `mono moves all three channels alike; colour moves them apart (${diff} texels)`);
  // A region read from (sx, sy) is that block of the whole sheet: the noise is seeded on the texel's place.
  const sx = 37, sy = 61, w = 120, h = 90, sub = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) sub.set(grey.subarray(((sy + y) * W + sx) * 4, ((sy + y) * W + sx + w) * 4), y * w * 4);
  const rn = Effect.spatial({ type: "noise", amount: 20, mono: false, seed: 3 }, sub, w, h, sx, sy, false);
  let off = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) if (rn[y * w * 4 + x] !== n[((sy + y) * W + sx) * 4 + x]) off++;
  R.is(off === 0, `a ${w} × ${h} region at (${sx}, ${sy}) lays the whole sheet's noise there, to the byte (${off} differ) — across the tile's 256 wrap too`);
  const other = Effect.spatial({ type: "noise", amount: 20, mono: false, seed: 4 }, grey, W, H, 0, 0, false);
  R.is(worst(other, n) > 0, "another seed is another noise");
  const g2 = Effect.spatial({ type: "noise", amount: 20, mono: false, seed: 3 }, grey, W, H, 0, 0, true);
  let gs = true; for (let i = 0; i < g2.length; i += 4) if (g2[i] - grey[i] !== g2[i + 1] - grey[i + 1]) gs = false;
  R.is(gs, "on a single-value channel it is mono whatever the record says");
}

console.log("\n=== the records ===");
{
  const c = Effect.clone({ type: "blur", radius: 999 }), s = Effect.clone({ type: "sharpen", radius: -3, amount: 9e9 }), n = Effect.clone({ type: "noise", amount: "x", mono: 0, seed: -5 });
  R.is(c.radius === 32 && s.radius === 1 && s.amount === 500 && n.amount === 24 && n.mono === true && n.seed === 0,
    `a crafted record is held to its ranges: blur ${c.radius}, sharpen ${s.radius} / ${s.amount}, noise ${n.amount} / ${n.mono} / ${n.seed}`);
  R.is(Effect.reach({ type: "blur", radius: 7 }) === 7 && Effect.reach({ type: "sharpen", radius: 3 }) === 3 && Effect.reach({ type: "noise", amount: 9 }) === 0 && Effect.reach({ type: "levels" }) === 0,
    "reach — how far a region is grown — is the radius for blur and sharpen and nothing for the rest");
  R.is(["blur", "sharpen", "noise"].every(k => Effect.kind(k) && Effect.make(k) && Effect.compile(Effect.make(k)) === null),
    "all three are kinds the select offers, make a record, and compile to no table — they run as Effect.spatial");
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 256;
  var paintSrc = function(c){
    var g = ctx2d(c);
    var gr = g.createLinearGradient(0, 0, N, 0); gr.addColorStop(0, "#102030"); gr.addColorStop(1, "#f0e0c0");
    g.fillStyle = gr; g.fillRect(0, 0, N, N / 2);
    for (var y = N / 2; y < N; y += 4) for (var x = 0; x < N; x += 4) { g.fillStyle = "rgb(" + ((x * 7 + y * 3) % 256) + "," + ((x * y) % 256) + "," + ((x + 2 * y) % 256) + ")"; g.fillRect(x, y, 4, 4); }
    g.fillStyle = "#ff0000"; g.fillRect(8, N / 2 + 8, 24, 24);
    return c;
  };
  var sheet = function(){ return paintSrc(mkCanvas(N, N)); };
  var mkSlot = function(){ var s = { id: "t154", size: N, nSize: N, layers: [], missing: false }; s.baseC = sheet(); s.composite = mkCanvas(N, N); s.smooth = sheet(); s.metal = sheet(); s.normal = sheet(); return s; };
  var data = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var worstOf = function(a, b){ var w = 0, n = 0; for (var i = 0; i < a.length; i++) { var e = Math.abs(a[i] - b[i]); if (e) n++; if (e > w) w = e; } return { worst: w, differ: n }; };
  var RECT = { x: 37, y: 90, w: 120, h: 101 };
  var regionOf = function(c){ return ctx2d(c).getImageData(RECT.x, RECT.y, RECT.w, RECT.h).data; };
  var softMask = function(){ var c = mkCanvas(N, N), g = ctx2d(c), gr = g.createLinearGradient(80, 0, 176, 0); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,1)"); g.fillStyle = gr; g.fillRect(0, 0, N, N); return c; };
  var paintUnder = function(ch){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "rgba(200,60,40,.7)"; g.fillRect(20, 70, 140, 90); return LayerNode.of({ type: "paint", name: "under", chan: ch === "color" ? undefined : ch, canvas: c, visible: true, opacity: 1, blend: "normal" }); };
  var fxLayer = function(fx, ch, o){ return LayerNode.of(Object.assign({ type: "adjust", name: "fx", chan: ch === "color" ? undefined : ch, visible: true, opacity: 1, blend: "normal", hue: 0, sat: 100, bright: 100, contrast: 100, fx: fx }, o || {})); };
  var KINDS = { blur: { type: "blur", radius: 6 }, sharpen: { type: "sharpen", radius: 3, amount: 180 }, noise: { type: "noise", amount: 30, mono: false, seed: 7 } };
  var wholeVsRegion = function(build, ch){
    var a = mkSlot(), b = mkSlot(), n = mkSlot();
    build(a); build(b); build(n);
    layerLeaves(n.layers).forEach(function(L){ if (L.type === "adjust") L.visible = false; });
    var sheetOf = function(s){ return ch === "color" ? s.composite : s.chanC[ch]; };
    Composite.sheet(a, ch, null); Composite.sheet(b, ch, null); Composite.sheet(n, ch, null);
    var bs = sheetOf(b), bg = ctx2d(bs);
    bg.fillStyle = "#123456"; bg.fillRect(RECT.x, RECT.y, RECT.w, RECT.h);
    Composite.sheet(b, ch, RECT);
    var r = worstOf(regionOf(sheetOf(a)), regionOf(bs));
    r.moved = worstOf(regionOf(sheetOf(a)), regionOf(sheetOf(n))).differ;
    return r;
  };
  try {
  // ---- 1. the GPU pass against the CPU pass ----
  var F = Composite.spaceGL, src = sheet(), into = { canvas: src, g: ctx2d(src) }, gcx = { tw: N, th: N, sx: 0, sy: 0 };
  F.init();
  out.gl = { active: !!F.st && !F.dead, shared: !!(F.st && Composite.fxGL.init() && Composite.fxGL.st.C === F.st.C), cases: {} };
  Object.keys(KINDS).forEach(function(k){
    var gpu = F.draw(gcx, into, KINDS[k], false), g = gpu ? data(gpu).slice() : null;
    var c = data(Composite.spaceCPU(gcx, into, KINDS[k], false)).slice();
    var e = g ? worstOf(g, c) : { worst: -1, differ: -1 };
    e.moved = worstOf(c, data(src)).differ;
    out.gl.cases[k] = e;
  });
  // a region whose corner is not at the origin: the noise has to start from the corner on the GPU too
  var gcx2 = { tw: 100, th: 80, sx: 37, sy: 61 }, part = mkCanvas(100, 80); ctx2d(part).drawImage(src, 37, 61, 100, 80, 0, 0, 100, 80);
  var pi = { canvas: part, g: ctx2d(part) }, pg = F.draw(gcx2, pi, KINDS.noise, false);
  out.gl.corner = pg ? worstOf(data(pg).slice(), data(Composite.spaceCPU(gcx2, pi, KINDS.noise, false)).slice()).worst : -1;

  // ---- 2. region == whole ----
  out.region = {};
  Object.keys(KINDS).forEach(function(k){
    out.region[k] = wholeVsRegion(function(s){ s.layers = [paintUnder("color"), fxLayer(KINDS[k], "color", { opacity: .8, mask: softMask() })]; }, "color");
  });
  out.region.chained = wholeVsRegion(function(s){ s.layers = [paintUnder("color"), fxLayer(KINDS.blur, "color"), fxLayer({ type: "sharpen", radius: 4, amount: 120 }, "color")]; }, "color");
  out.region.smooth = wholeVsRegion(function(s){ s.layers = [paintUnder("smooth"), fxLayer(KINDS.blur, "smooth")]; }, "smooth");
  out.region.group = wholeVsRegion(function(s){
    s.layers = [{ type: "group", name: "g", visible: true, opacity: .8, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g148",
                  children: [paintUnder("color"), fxLayer(KINDS.blur, "color")] }];
  }, "color");
  // ...and it is the margin that holds it: with Composite.reach answering 0, the same check fails.
  var reach0 = Composite.reach;
  Composite.reach = function(){ return 0; };
  try { out.region.noMargin = wholeVsRegion(function(s){ s.layers = [paintUnder("color"), fxLayer(KINDS.blur, "color")]; }, "color"); }
  finally { Composite.reach = reach0; }
  // A change INSIDE the rectangle moves the blurred result outside it: a dot painted under a blur and
  // composited by its own rectangle must land on the whole sheet as the whole-sheet pass lays it —
  // the dirty rectangle grown by the reach is written back. Compared over the whole sheet.
  var changed = function(){
    var a = mkSlot(), b = mkSlot(), ua = paintUnder("color"), ub = paintUnder("color");
    a.layers = [ua, fxLayer(KINDS.blur, "color")]; b.layers = [ub, fxLayer(KINDS.blur, "color")];
    Composite.sheet(a, "color", null); Composite.sheet(b, "color", null);
    [ua, ub].forEach(function(L){ var g = ctx2d(L.canvas); g.fillStyle = "#00ff00"; g.fillRect(100, 120, 4, 4); });
    Composite.sheet(a, "color", null); Composite.sheet(b, "color", { x: 100, y: 120, w: 4, h: 4 });
    return worstOf(data(a.composite), data(b.composite));
  };
  out.region.dot = changed();
  // …and written back as the bare rectangle, as it was before the review, the halo stops at its edge.
  out.region.dotOld = (function(){
    var a = mkSlot(), b = mkSlot(), ua = paintUnder("color"), ub = paintUnder("color");
    a.layers = [ua, fxLayer(KINDS.blur, "color")]; b.layers = [ub, fxLayer(KINDS.blur, "color")];
    Composite.sheet(a, "color", null); Composite.sheet(b, "color", null);
    [ua, ub].forEach(function(L){ var g = ctx2d(L.canvas); g.fillStyle = "#00ff00"; g.fillRect(100, 120, 4, 4); });
    Composite.sheet(a, "color", null);
    var keep = mkCanvas(N, N); ctx2d(keep).drawImage(b.composite, 0, 0);
    Composite.sheet(b, "color", { x: 100, y: 120, w: 4, h: 4 });
    ctx2d(keep).drawImage(b.composite, 100, 120, 4, 4, 100, 120, 4, 4);       // only the bare rectangle taken
    return worstOf(data(a.composite), data(keep));
  })();
  // A camouflage tile: its blur wraps, on the GPU too.
  var tsrc = sheet(), tin = { canvas: tsrc, g: ctx2d(tsrc) }, tcx = { tw: N, th: N, sx: 0, sy: 0 };
  var tg = F.draw(tcx, tin, KINDS.blur, false, true);
  out.gl.wrap = tg ? worstOf(data(tg).slice(), data(Composite.spaceCPU(tcx, tin, KINDS.blur, false, true)).slice()) : { worst: -1 };
  out.gl.wrap.moved = worstOf(data(Composite.spaceCPU(tcx, tin, KINDS.blur, false, true)).slice(), data(Composite.spaceCPU(tcx, tin, KINDS.blur, false, false)).slice()).differ;

  // ---- 3. at rest inside a group, the coverage stays ----
  var coverage = function(E){
    var s = mkSlot(), c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "rgba(200,60,40,.69)"; g.fillRect(20, 70, 140, 90);
    s.layers = [{ type: "group", name: "g", visible: true, opacity: 1, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g148r",
                  children: [LayerNode.of({ type: "paint", name: "p", canvas: c, visible: true, opacity: 1, blend: "normal" })].concat(E ? [E] : []) }];
    compositeSlot(s, null);
    return data(s.composite);
  };
  var bare = coverage(null);
  out.rest = {
    hsbc: worstOf(coverage(LayerNode.of({ type: "adjust", name: "fx", visible: true, opacity: 1, blend: "normal", hue: 0, sat: 100, bright: 100, contrast: 100 })), bare),
    // A blur over a flat patch changes nothing inside it; at the patch's edge it softens the colour
    // there and nothing else — the composite is opaque, so compare a texel well inside.
    blurInside: (function(){ var d = coverage(fxLayer(KINDS.blur, "color")), k = (110 * N + 90) * 4; return Math.max(Math.abs(d[k] - bare[k]), Math.abs(d[k + 1] - bare[k + 1]), Math.abs(d[k + 2] - bare[k + 2])); })(),
  };
  // the four numbers moved still read as the filter on an opaque sheet — the same pixels as before
  var hs = mkSlot(); hs.layers = [LayerNode.of({ type: "adjust", name: "Warm", visible: true, opacity: .6, blend: "normal", hue: 25, sat: 140, bright: 90, contrast: 120 })];
  compositeSlot(hs, null);
  var ref = mkCanvas(N, N), rg = ctx2d(ref);
  rg.drawImage(hs.baseC, 0, 0); rg.globalAlpha = .6;
  rg.filter = "hue-rotate(25deg) saturate(140%) brightness(90%) contrast(120%)"; rg.drawImage(hs.baseC, 0, 0); rg.filter = "none";
  out.hsbc = worstOf(data(hs.composite), data(ref));
  // the plain cross-fade: the filter at full strength, then 60 % of the way from the sheet to it
  var full = mkCanvas(N, N), fg = ctx2d(full);
  fg.filter = "hue-rotate(25deg) saturate(140%) brightness(90%) contrast(120%)"; fg.drawImage(hs.baseC, 0, 0); fg.filter = "none";
  var fd = data(full), bd = data(hs.baseC), xf = new Uint8ClampedArray(fd.length);
  for (var i = 0; i < fd.length; i++) xf[i] = i % 4 === 3 ? 255 : bd[i] + (fd[i] - bd[i]) * .6;
  out.hsbc.fade = worstOf(data(hs.composite), xf).worst;

  // ---- 4. the CPU fallback inside a composite ----
  var onCPU = function(fn){ var was = F.dead; F.dead = true; try { return fn(); } finally { F.dead = was; } };
  out.cpu = {};
  Object.keys(KINDS).forEach(function(k){
    var make = function(){ var s = mkSlot(); s.layers = [{ type: "group", name: "g", visible: true, opacity: 1, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g148c",
                  children: [paintUnder("color"), fxLayer(KINDS[k], "color")] }]; compositeSlot(s, null); return data(s.composite).slice(); };
    out.cpu[k] = worstOf(make(), onCPU(make));
  });

  // ---- 5. save / load, and the panel ----
  var ctx = { put: async function(){ return "x"; }, img: async function(){ return null; } };
  out.save = {};
  for (var k in KINDS) { var back = await ProjNode.load(await ProjNode.save(fxLayer(KINDS[k], "color"), ctx), ctx); out.save[k] = JSON.stringify(back.fx) === JSON.stringify(KINDS[k]); }
  var crafted = await ProjNode.load(JSON.parse(JSON.stringify(await ProjNode.save(fxLayer({ type: "blur", radius: 4 }, "color"), ctx)).replace('"radius":4', '"radius":4000')), ctx);
  out.save.crafted = crafted.fx.radius;

  var ps = mkSlot(); ps.id = "t148p"; App.slots.set(ps.id, ps);
  var was = { slot: App.activeSlot, layer: App.activeLayer };
  var E = fxLayer({ type: "levels", rgb: Effect.lv() }, "color");
  ps.layers = [paintUnder("color"), E]; App.activeSlot = ps; App.activeLayer = E;
  refreshLayerList(); refreshLayerProps();
  var pane = document.getElementById("layerProps") || document.body;
  var sel = Array.prototype.find.call(pane.querySelectorAll("select"), function(e){ return Array.prototype.some.call(e.options, function(o){ return o.value === "blur"; }); });
  out.panel = { found: !!sel };
  if (sel) {
    var d0 = App.undoStack.length;
    sel.value = "blur"; sel.dispatchEvent(new Event("change"));
    out.panel.kind = E.fx && E.fx.type; out.panel.steps = App.undoStack.length - d0;
    var rng = Array.prototype.find.call(pane.querySelectorAll("input[type=range]"), function(i){ return i.max === String(Effect.MAX_R); });
    out.panel.radius = !!rng;
    if (rng) { rng.value = 9; rng.dispatchEvent(new Event("input")); rng.dispatchEvent(new Event("change")); out.panel.r = E.fx.radius; out.panel.steps2 = App.undoStack.length - d0; }
    doUndo(true); out.panel.undone = E.fx && E.fx.radius;
  }
  App.activeSlot = was.slot; App.activeLayer = was.layer; App.slots.delete(ps.id);
  App.undoStack.length = 0; App.redoStack.length = 0;
  refreshLayerList();
  } catch (e) { out.__threw = String(e && e.stack || e); }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page: the GPU pass against the CPU's ===");
R.is(r.gl.active && r.gl.shared, "the GPU pass is the one running here, on the context the other per-texel passes share — or the checks below test only the fallback");
for (const [k, e] of Object.entries(r.gl.cases))
  R.is(e.worst >= 0 && e.worst <= (k === "noise" ? 0 : 1) && e.moved > 1000, `${k}: GPU and CPU agree ${k === "noise" ? "to the byte" : "to a level"} (worst ${e.worst}, ${e.differ} values differ) on a sheet it changes (${e.moved})`);
R.is(r.gl.corner === 0, `a region whose corner is at (37, 61) lays the same noise on the GPU as on the CPU (worst ${r.gl.corner})`);

console.log("\n=== region == whole ===");
for (const k of ["blur", "sharpen", "noise", "chained", "smooth", "group"]) {
  const e = r.region[k];
  R.is(e.worst === 0 && e.moved > 200, `${k}: a dirty rectangle composites exactly what the whole sheet does there (${e.differ} values differ), where the effect moved ${e.moved}`);
}
R.is(r.region.dot.worst === 0, `a dot painted under a blur and composited by its own 4 × 4 rectangle lands on the whole sheet as the whole-sheet pass lays it (${r.region.dot.differ} values differ)`);
R.is(r.region.dotOld.worst > 10, `…where writing back the bare rectangle, as before the review, left the blur's halo cut at its edge (worst ${r.region.dotOld.worst}, ${r.region.dotOld.differ} values)`);
R.is(r.gl.wrap.worst >= 0 && r.gl.wrap.worst <= 1 && r.gl.wrap.moved > 100, `on a camouflage tile the GPU's blur wraps round the edges as the CPU's does (worst ${r.gl.wrap.worst}; wrapping moved ${r.gl.wrap.moved} values)`);
R.is(r.region.noMargin.worst > 0, `…and with the margin taken away a blur's rectangle seams against the sheet (worst ${r.region.noMargin.worst}, ${r.region.noMargin.differ} values) — the margin is what holds it`);

console.log("\n=== coverage ===");
// One level: the 69 % paint goes through the GPU upload as straight colour and back, which rounds.
R.is(r.rest.hsbc.worst === 0, `the four numbers at rest inside a group leave a 69 % layer exactly as it was — at rest there is no pass at all (worst ${r.rest.hsbc.worst}; they made it 90 % until this change)`);
R.is(r.rest.blurInside <= 1, `a blur inside a group leaves a flat patch's inside as it was, to a level (${r.rest.blurInside})`);
// Two levels: the canvas blends in bytes, the reference here in doubles.
R.is(r.hsbc.fade <= 2 && r.hsbc.worst <= 3, `on an opaque sheet at 60 % the four numbers are the plain cross-fade to the filter (worst ${r.hsbc.fade}); the old draw, the filter applied under globalAlpha, was within ${r.hsbc.worst} of it (at 100 % they are the filter exactly — t92)`);

console.log("\n=== the CPU fallback in a composite ===");
for (const [k, e] of Object.entries(r.cpu)) R.is(e.worst <= (k === "noise" ? 0 : 1), `${k} in a group: the CPU composite is the GPU's ${k === "noise" ? "to the byte" : "to a level"} (worst ${e.worst})`);

console.log("\n=== save, load, the panel ===");
R.is(r.save.blur && r.save.sharpen && r.save.noise && r.save.crafted === 32, `each kind comes back from a project as it went, and a crafted radius of 4000 comes back as ${r.save.crafted}`);
const P = r.panel;
R.is(P.found && P.kind === "blur" && P.steps === 1 && P.radius && P.r === 9 && P.steps2 === 2 && P.undone === 4,
  P.found ? `the Effect select offers Blur (one undo step), its Radius row moves it (${P.r}, a step of its own), and undo puts it back (${P.undone})` : "the Effect select offers Blur");

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
