// Gradient fills, in UV space and along the model (ROADMAP 4.44, fifth candidate).
//
// WHY THIS EXISTS. A gradient has an exact answer everywhere — a stop reads its own colour, the
// midpoint between two reads their mean, a texel whose position is 30 % of the way from nose to
// tail reads t = .3 — and the app had no way to say any of it before this test. So the properties
// are held in two halves:
//
//   Node, on the pure `/*==GRADIENT==*/` section:
//   * the LUT reads each stop's colour and alpha at its own t, the mean between two, and clamps to
//     the end stops outside them; stops are sorted whatever order they arrive in; one stop is flat;
//   * a box's extent along an axis is its side, and along a diagonal the corner-to-corner reach;
//   * `evalModel` on a synthetic position map reads t = 0 at `from`, 1 at `to`, clamped beyond,
//     reversed when the direction is, transparent where there is no position, and the same texels
//     over a region as over the whole sheet;
//   * the six presets are unit vectors, opposite in pairs, and follow the side axis;
//   * the UV axis spans the rectangle exactly at 0°, 90° and 45°.
//
//   Headless Chrome, on the real page:
//   * a linear UV gradient across a sheet reads the stops at its ends and the mean in the middle,
//     through the compositor; the dirty-rectangle path matches the whole-sheet path; a fill with no
//     `grad` still renders flat; a Limit rectangle centres the axis on the rectangle;
//   * a model-space gradient on quads at known positions (t66's shapes) reads the colour each quad's
//     position says — through the position bake, its two byte planes, the padding and the walk —
//     and the bake is cached under its key;
//   * the channel strip's convert-to-paint keeps the gradient's pixels; save / load keeps the record
//     at version 5; a duplicate does not share it.
//
// Usage: node tools/t74_gradient.mjs [--keep] [--chrome <path>]
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
const { Gradient } = new Function(sectionOf("GRADIENT").replace(/^"use strict";$/m, "") + "\nreturn { Gradient };")();

// ---- the LUT ----
{
  const lut = Gradient.lut([{ t: 1, color: "#0000ff", alpha: 0 }, { t: 0, color: "#ff0000", alpha: 1 }]);   // arrive unsorted
  const at = k => [lut[k*4], lut[k*4+1], lut[k*4+2], lut[k*4+3]];
  const first = at(0), last = at(255), mid = at(128);
  R.is(first[0] === 255 && first[2] === 0 && first[3] === 255, `t = 0 reads the first stop, whatever order the stops arrived in (${first})`);
  R.is(last[2] === 255 && last[0] === 0 && last[3] === 0, `t = 1 reads the last stop, alpha included (${last})`);
  R.is(Math.abs(mid[0] - 127) <= 1 && Math.abs(mid[2] - 128) <= 1 && Math.abs(mid[3] - 127) <= 1, `the midpoint is the mean of both, colour and alpha alike (${mid})`);
  const clamp = Gradient.lut([{ t: .25, color: "#000000", alpha: 1 }, { t: .75, color: "#ffffff", alpha: 1 }]);
  R.is(clamp[0] === 0 && clamp[(64 - 1) * 4] === 0 && clamp[255 * 4] === 255 && clamp[192 * 4] === 255,
    "outside the end stops the LUT clamps to them (black below 25 %, white above 75 %)");
  R.is(Math.abs(clamp[128 * 4] - 128) <= 1, `…and reads the mean halfway between them (${clamp[128 * 4]})`);
  const one = Gradient.lut([{ t: .5, color: "#123456", alpha: .5 }]);
  R.is(one[0] === 0x12 && one[255 * 4 + 2] === 0x56 && one[3] === 128, "one stop is a flat fill at its colour and alpha");
  R.is(Gradient.lut([])[3] === 0 && Gradient.lut(null)[3] === 0, "no stops is transparent");
}
// ---- the extent of a box ----
{
  const bb = { x0: -10, y0: -2, z0: -5, x1: 20, y1: 3, z1: 5 };
  const ex = Gradient.extent(bb, [1, 0, 0]), ey = Gradient.extent(bb, [0, -1, 0]);
  R.is(ex[0] === -10 && ex[1] === 20 && ey[0] === -3 && ey[1] === 2, `a box reaches its own sides along an axis, signed with the direction (${ex}, ${ey})`);
  const d = Gradient.unit([1, 0, 1]), ed = Gradient.extent(bb, d);
  R.is(Math.abs(ed[0] - (-15 / Math.SQRT2)) < 1e-9 && Math.abs(ed[1] - 25 / Math.SQRT2) < 1e-9, "…and corner to corner along a diagonal");
  const b = Gradient.band(bb, [1, 0, 0], .5, .5);
  R.is(b.t1 > b.t0, "from = to is a hard edge, not a division by zero");
}
// ---- the presets and the angles ----
{
  const P = Gradient.presets("z");
  const unit = v => Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9;
  R.is(P.length === 6 && P.every(p => unit(p.dir)), "six presets, every one a unit vector");
  const opp = (a, b) => a.dir.every((v, i) => Math.abs(v + b.dir[i]) < 1e-9);
  R.is(opp(P[0], P[1]) && opp(P[2], P[3]) && opp(P[4], P[5]), "…opposite in pairs");
  R.is(P[0].dir[0] === -1 && P[2].dir[1] === -1 && P[4].dir[2] === 1, "nose → tail runs −x on a game model, top → bottom −y, port → starboard +z");
  R.is(Gradient.presets("x")[0].dir[2] === -1, "…and nose → tail runs −z when the loader found x to be the side axis");
  const back = Gradient.anglesOf(Gradient.dirOf(30, -20));
  R.is(back.yaw === 30 && back.pitch === -20, `yaw / pitch round-trip through a direction (${back.yaw}, ${back.pitch})`);
}
// ---- evalModel on a synthetic position map ----
{
  // a 64 × 8 map whose x runs 0…1 across the columns (u16 0…65535), y and z constant; the right
  // quarter has no position at all
  const w = 64, h = 8, pos = new Uint16Array(w * h * 3), has = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    pos[i*3] = Math.round(x / (w - 1) * 65535); pos[i*3+1] = 32768; pos[i*3+2] = 32768;
    has[i] = x < 56 ? 1 : 0;                                      // the right eighth has none
  }
  const P = { w, h, pos, has, bb: { x0: 0, y0: -1, z0: -1, x1: 10, y1: 1, z1: 1 } };   // x spans 0…10 m
  const g = { shape: "linear", space: "model", dir: [1, 0, 0], from: .25, to: .75,
              stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  const out = new Uint8ClampedArray(w * h * 4);
  Gradient.evalModel(P, g, w, h, 0, 0, w, h, out);
  const R0 = x => out[(4 * w + x) * 4], A = x => out[(4 * w + x) * 4 + 3];
  R.is(R0(0) === 0 && R0(15) === 0, `below \`from\` (25 % of the way) the first stop: ${R0(0)}, ${R0(15)}`);
  // t = .5 sits at 5 m, between columns 31 (4.92 m) and 32 (5.08 m)
  R.is(Math.abs((R0(31) + R0(32)) / 2 - 128) <= 2, `halfway between from and to, the mean: ${R0(31)} / ${R0(32)}`);
  R.is(R0(55) === 255 && R0(50) === 255, `at \`to\` and beyond, the last stop: ${R0(50)}, ${R0(55)}`);
  R.is(A(55) === 255 && A(56) === 0 && A(63) === 0, "a texel with no position is left transparent");
  // reversed
  const rev = Object.assign({}, g, { dir: [-1, 0, 0] });
  const out2 = new Uint8ClampedArray(w * h * 4);
  Gradient.evalModel(P, rev, w, h, 0, 0, w, h, out2);
  R.is(out2[(4 * w + 0) * 4] === 255 && out2[(4 * w + 55) * 4] === 0, "the direction reversed reverses the gradient");
  // a region equals the same texels of the whole
  const reg = new Uint8ClampedArray(20 * 3 * 4);
  Gradient.evalModel(P, g, w, h, 10, 2, 20, 3, reg);
  let worst = 0;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 20; x++) for (let k = 0; k < 4; k++)
    worst = Math.max(worst, Math.abs(reg[(y * 20 + x) * 4 + k] - out[((y + 2) * w + x + 10) * 4 + k]));
  R.is(worst === 0, `a region reads the same texels as the whole sheet (worst difference ${worst})`);
  // a sheet twice the bake's size samples nearest
  const big = new Uint8ClampedArray(128 * 16 * 4);
  Gradient.evalModel(P, g, 128, 16, 0, 0, 128, 16, big);
  R.is(big[(8 * 128 + 111) * 4] === 255 && big[(8 * 128 + 111) * 4 + 3] === 255 && big[(8 * 128 + 112) * 4 + 3] === 0, "a sheet larger than the bake samples the bake nearest");
}
// ---- past the ends: repeat and reflect ----
{
  const w = 64, h = 4, pos = new Uint16Array(w * h * 3), has = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; pos[i*3] = Math.round(x / (w - 1) * 65535); pos[i*3+1] = pos[i*3+2] = 32768; }
  const P = { w, h, pos, has, bb: { x0: 0, y0: -1, z0: -1, x1: 10, y1: 1, z1: 1 } };
  const stops = [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }];
  const run = g => { const o = new Uint8ClampedArray(w * h * 4); Gradient.evalModel(P, g, w, h, 0, 0, w, h, o); return x => o[(2 * w + x) * 4]; };
  const rep = run({ dir: [1, 0, 0], from: 0, to: .25, repeat: "repeat", stops });
  R.is(rep(0) < 8 && rep(15) > 240 && rep(17) < 24 && rep(31) > 240 && rep(62) > 225 && rep(63) < 8,
    `repeat starts the ramp over past \`to\` — four ramps across the box, the far end the start of a fifth (${rep(0)} / ${rep(15)} / ${rep(17)} / ${rep(31)} / ${rep(62)} / ${rep(63)})`);
  const ref = run({ dir: [1, 0, 0], from: .5, to: 1, repeat: "reflect", stops });
  R.is(Math.abs(ref(0) - ref(63)) <= 8 && ref(0) > 240 && ref(31) < 12, `reflect runs it back: from 50 % out to both ends is bright at both ends and dark in the middle (${ref(0)} / ${ref(31)} / ${ref(63)})`);
  const cl = run({ dir: [1, 0, 0], from: 0, to: .25, repeat: "clamp", stops });
  R.is(cl(20) === 255 && cl(63) === 255, "clamp holds the last stop past `to`");
  // the extent box: the same map with a box a quarter of the width runs the whole ramp over that quarter
  const o2 = new Uint8ClampedArray(w * h * 4);
  Gradient.evalModel(P, { dir: [1, 0, 0], from: 0, to: 1, stops }, w, h, 0, 0, w, h, o2, { x0: 0, y0: -1, z0: -1, x1: 2.5, y1: 1, z1: 1 });
  R.is(o2[(2 * w + 0) * 4] < 8 && o2[(2 * w + 15) * 4] > 240 && o2[(2 * w + 40) * 4] === 255, "a parts box a quarter of the vehicle runs the whole ramp over that quarter (a layer limited to parts)");
  // the dither is a function of the absolute texel, so a region agrees with the whole
  const g3 = { dir: [1, 0, 0], from: 0, to: 1, stops };
  const whole = new Uint8ClampedArray(w * h * 4); Gradient.evalModel(P, g3, w, h, 0, 0, w, h, whole);
  const part = new Uint8ClampedArray(10 * 2 * 4); Gradient.evalModel(P, g3, w, h, 7, 1, 10, 2, part);
  let dd = 0; for (let y = 0; y < 2; y++) for (let x = 0; x < 10; x++) dd = Math.max(dd, Math.abs(part[(y * 10 + x) * 4] - whole[((y + 1) * w + x + 7) * 4]));
  R.is(dd === 0, "the ordered dither is in absolute texels, so a region still equals the whole");
  // a slow ramp — 32 values over 512 texels, which undithered is a staircase of 16-texel steps —
  // has no flat run longer than a few texels once the value is dithered
  const W2 = 512, pos2 = new Uint16Array(W2 * 4 * 3), has2 = new Uint8Array(W2 * 4).fill(1);
  for (let y = 0; y < 4; y++) for (let x = 0; x < W2; x++) { const i = y * W2 + x; pos2[i*3] = Math.round(x / (W2 - 1) * 65535); pos2[i*3+1] = pos2[i*3+2] = 32768; }
  const slow = new Uint8ClampedArray(W2 * 4 * 4);
  Gradient.evalModel({ w: W2, h: 4, pos: pos2, has: has2, bb: P.bb }, { dir: [1, 0, 0], from: 0, to: 1, stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#202020", alpha: 1 }] }, W2, 4, 0, 0, W2, 4, slow);
  let flat = 1, longest = 1;
  for (let x = 1; x < W2; x++) { if (slow[(W2 + x) * 4] === slow[(W2 + x - 1) * 4]) { flat++; if (flat > longest) longest = flat; } else flat = 1; }
  R.is(longest <= 8 && slow[(W2 + 0) * 4] === 0 && slow[(W2 + W2 - 1) * 4] === 32, `a slow ramp is dithered in value: its longest flat run is ${longest} texels where an undithered one is 16, and the ends are exact`);
}
// ---- the UV axis ----
{
  const r = { x: 100, y: 200, w: 300, h: 100 };
  const g0 = Gradient.uvAxis({ shape: "linear", angle: 0, from: 0, to: 1 }, r);
  R.is(g0.x0 === 100 && g0.x1 === 400 && g0.y0 === 250 && g0.y1 === 250, `at 0° the axis runs the rectangle's width through its centre (${g0.x0}→${g0.x1} at y ${g0.y0})`);
  const g90 = Gradient.uvAxis({ shape: "linear", angle: 90, from: 0, to: 1 }, r);
  R.is(Math.abs(g90.y0 - 200) < 1e-9 && Math.abs(g90.y1 - 300) < 1e-9 && Math.abs(g90.x0 - 250) < 1e-9, "at 90° its height, top to bottom");
  const g45 = Gradient.uvAxis({ shape: "linear", angle: 45, from: 0, to: 1 }, r);
  const reach = Math.hypot(g45.x1 - g45.x0, g45.y1 - g45.y0);
  R.is(Math.abs(reach - (300 + 100) / Math.SQRT2) < 1e-6, `at 45° the reach is the rectangle's projection on the diagonal (${reach.toFixed(2)})`);
  const gr = Gradient.uvAxis({ shape: "radial", from: 0, to: 1, angle: 0 }, r);
  R.is(gr.cx === 250 && gr.cy === 250 && gr.r0 === 0 && Math.abs(gr.r1 - Math.hypot(300, 100) / 2) < 1e-9, "a radial one is centred on the rectangle and reaches its corners at 100 %");
  const gh = Gradient.uvAxis({ shape: "linear", angle: 0, from: .25, to: .75 }, r);
  R.is(gh.x0 === 175 && gh.x1 === 325, `from / to are fractions of that reach (${gh.x0}→${gh.x1})`);
}

// ---- the real page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP: no Chrome or Edge found for the page half. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {}, N = 256;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t74", size: N, nSize: N, layers: [], missing: false, baseC: grey(), composite: grey(), normal: null };
  App.slots.set("t74", s);
  var was = App.activeSlot; App.activeSlot = s;
  var comp = function(){ compositeSlot(s); flushComposites(); return s.composite; };

  // ---- 1. a flat fill still renders flat ----
  var fill = LayerNode.of({ type: "fill", name: "f", color: "#ff0000", visible: true, opacity: 1, blend: "normal" });
  s.layers = [fill]; App.activeLayer = fill;
  comp();
  out.flat = px(s.composite, 10, 10);

  // ---- 2. a UV linear gradient across the sheet ----
  fill.grad = { shape: "linear", space: "uv", angle: 0, dir: [1, 0, 0], from: 0, to: 1,
                stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  comp();
  out.uv = { left: px(s.composite, 0, 128), mid: px(s.composite, 128, 128), right: px(s.composite, 255, 128) };
  // the region path equals the whole path
  var whole = ctx2d(s.composite).getImageData(40, 60, 100, 50).data;
  ctx2d(s.composite).fillStyle = "#123456"; ctx2d(s.composite).fillRect(40, 60, 100, 50);
  Composite.sheet(s, "color", { x: 40, y: 60, w: 100, h: 50 }); flushComposites();
  var part = ctx2d(s.composite).getImageData(40, 60, 100, 50).data;
  var worst = 0; for (var i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - part[i]));
  out.uvRegion = worst;
  // alpha fades to the base
  fill.grad = Gradient.make("uv", "#0000ff");                     // blue → blue at alpha 0
  comp();
  out.fade = { left: px(s.composite, 0, 128), right: px(s.composite, 255, 128) };
  // a Limit rectangle centres the axis on the rectangle: 90° over rows 64…192
  fill.grad = { shape: "linear", space: "uv", angle: 90, dir: [1, 0, 0], from: 0, to: 1,
                stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  fill.scope = Scope.make(null, { x: 0, y: 64, w: 256, h: 128 });
  for (var sl of App.slots.values()) invalidateScopeMasks(sl);
  comp();
  out.rect = { above: px(s.composite, 128, 32), top: px(s.composite, 128, 66), mid: px(s.composite, 128, 128), bottom: px(s.composite, 128, 190) };
  fill.scope = undefined;
  for (var sl2 of App.slots.values()) invalidateScopeMasks(sl2);
  // the thumbnail draws the gradient rather than one colour
  fill._thumb = null;
  var th = layerThumb(fill, s);
  out.thumb = { l: px(th, 1, 13), r: px(th, 24, 13) };

  // ---- 3. save / load and duplicate ----
  var ctx = { put: async function(){ return "x"; }, img: async function(){ return null; } };
  var saved = await ProjNode.save(fill, ctx);
  var back = await ProjNode.load(saved, ctx);
  out.roundTrip = { saved: saved.chans.color.grad, back: back.grad, color: saved.chans.color.color };
  duplicateLayer(s, fill);
  var dup = s.layers.filter(function(l){ return l !== fill; })[0];
  out.dup = { has: !!(dup && dup.grad), shared: !!(dup && dup.grad === fill.grad), stopsShared: !!(dup && dup.grad && dup.grad.stops === fill.grad.stops) };
  s.layers = [fill];

  // ---- 4. convert to paint keeps the pixels ----
  comp();
  var before = [px(s.composite, 128, 60), px(s.composite, 128, 128), px(s.composite, 128, 200)];
  ChanStrip.convert(s, fill, "color", "paint");
  comp();
  out.convert = { before: before, after: [px(s.composite, 128, 60), px(s.composite, 128, 128), px(s.composite, 128, 200)], kind: LayerNode.contentOn(fill, "color").kind };
  doUndo(); comp();
  out.convertUndo = { kind: LayerNode.contentOn(fill, "color").kind, grad: !!fill.grad };

  // ---- 5. along the model ----
  // four quads on four bands of the sheet (t66's helper), at x = 0, 1, 2, 3 metres; the sheet is
  // the slot's own, so the bake lands on it
  var BANDS = 4;
  function quad(name, x, band){
    var idx = [0, 1, 2, 0, 2, 3];
    var corners = [[x, 0, -1], [x + .5, 0, -1], [x + .5, 0, 1], [x, 0, 1]];
    var uvc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2];
      nor[k*3] = 0; nor[k*3+1] = 1; nor[k*3+2] = 0;
      uv[k*2] = (band + t[0] * .8 + .1) / BANDS;
      uv[k*2+1] = t[1] * .8 + .1;
    }
    return { name: name, mat: "testmat", position: pos, normal: nor, uv: uv };
  }
  var all = [quad("q0", 0, 0), quad("q1", 1, 1), quad("q2", 2, 2), quad("q3", 3, 3)];
  var meshes = new Map(); all.forEach(function(g){ meshes.set(g.name, { visible: true }); });
  App.geomData = all; App.meshes = meshes; App.matSlot = new Map([["testmat", "t74"]]);
  App.protectedParts = new Set(); App.selParts = new Set(); App._projGL = null;
  if (!projGL()) { out.mode = "none"; App.activeSlot = was; App.slots.delete("t74"); return out; }
  out.mode = "gl";
  var pb = await Bake.run(s, "pos");
  out.pos = { w: pb.w, h: pb.h, bb: pb.bb };
  // a texel of q1's centre: x = 1.25 of 0…3.5 → u16 ≈ .357 · 65535
  var cx1 = Math.round(1.5 * pb.w / BANDS), cy1 = Math.round(.5 * pb.h);
  out.posQ1 = { x: pb.pos[(cy1 * pb.w + cx1) * 3] / 65535, has: pb.has[cy1 * pb.w + cx1] };
  // across seven neighbouring texels of the quad, x steps by ~183 (0.5 m over ~51 texels of a
  // 3.5 m box): a bake that dropped its low byte would step by 0 or 256, one that ignored uLow by 0 or 257
  out.posSteps = []; for (var qx = cx1 - 3; qx < cx1 + 3; qx++) out.posSteps.push(pb.pos[(cy1 * pb.w + qx + 1) * 3] - pb.pos[(cy1 * pb.w + qx) * 3]);
  // the gutter beside q1 is padded (PAD texels deep — the 13-texel gap between bands is padded
  // right across); the sheet's top rows, 25 texels above every island, are not
  out.posPad = { near: pb.has[cy1 * pb.w + Math.round(1.1 * pb.w / BANDS) - 3], far: pb.has[2 * pb.w + cx1] };
  // the gradient: black at x = 0 (from 0) to white at x = 3.5 (to 1), the box's own reach
  fill.grad = { shape: "linear", space: "model", angle: 0, dir: [1, 0, 0], from: 0, to: 1,
                stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  comp();
  var band = function(b){ return px(s.composite, Math.round((b + .5) * N / BANDS), 128)[0]; };
  out.model = [band(0), band(1), band(2), band(3)];
  out.modelGutter = px(s.composite, 20, 2);                                  // no position: the base shows (a UV ramp would read ~20 here)
  // reversed by preset
  fill.grad = Object.assign({}, fill.grad, { dir: Gradient.presets("z")[0].dir });
  comp();
  out.modelRev = [band(0), band(3)];
  // the region path equals the whole path here too
  var whole2 = ctx2d(s.composite).getImageData(20, 40, 200, 60).data;
  ctx2d(s.composite).fillStyle = "#123456"; ctx2d(s.composite).fillRect(20, 40, 200, 60);
  Composite.sheet(s, "color", { x: 20, y: 40, w: 200, h: 60 }); flushComposites();
  var part2 = ctx2d(s.composite).getImageData(20, 40, 200, 60).data;
  var worst2 = 0; for (var j = 0; j < whole2.length; j++) worst2 = Math.max(worst2, Math.abs(whole2[j] - part2[j]));
  out.modelRegion = worst2;
  // cached: the same bake object comes back under the same key
  var pb2 = await Bake.run(s, "pos");
  out.cached = pb2 === pb;
  // the evaluated sheet is cached on the content: the same record blits the same canvas, a changed
  // record a new one, and a layer's rectangle limit is part of the key
  var c0 = LayerNode.contentOn(fill, "color");
  var sh1 = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, c0, fill);
  var sh2 = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 10, sy: 10, tw: 20, th: 20 }, c0, fill);
  fill.grad = Object.assign({}, fill.grad, { from: .1 });
  var sh3 = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, c0, fill);
  out.sheetCache = { same: sh1 === sh2, moved: sh1 !== sh3, size: [sh1.width, sh1.height] };
  // a store hung: App.geomData is a new array holding the same groups plus a weapon — the bake stays
  App.geomData = App.geomData.concat([{ name: "bomb", weapon: true, mat: "wm", position: new Float32Array(9), normal: new Float32Array(9), uv: new Float32Array(6) }]);
  out.storeKeepsBake = Bake.cached(s, "pos") === pb;
  App.geomData = App.geomData.filter(function(g){ return !g.weapon; });
  // the bake is dropped on the first whole composite after the last gradient along the model goes
  fill.grad = Gradient.make("uv", "#ff0000");
  comp();
  out.pruned = !(s._bake && s._bake.pos);
  fill.grad = Object.assign(Gradient.make("model", "#ff0000"), { dir: [1, 0, 0] });
  comp();
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  out.rebaked = !!(s._bake && s._bake.pos);
  // a fresh slot with no bake yet: the first composite draws nothing, asks for the bake, and the
  // next composite has it
  delete s._bake;
  fill.grad = { shape: "linear", space: "model", angle: 0, dir: [1, 0, 0], from: 0, to: 1,
                stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  comp();
  out.lazy = { first: band(3), pending: !!s._posPending };
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  flushComposites();
  out.lazy.after = band(3);

  // ---- 6. the claims: one bake at a time, a failure latched, a cancel declined, export waits ----
  // a second sheet of the same vehicle, sharing q3 under another material
  var s2 = { id: "t74b", size: N, nSize: N, layers: [], missing: false, baseC: grey(), composite: grey(), normal: null };
  App.slots.set("t74b", s2);
  all[3].mat = "testmat2"; App.matSlot.set("testmat2", "t74b");
  var fill2 = LayerNode.of({ type: "fill", name: "f2", color: "#ffffff", visible: true, opacity: 1, blend: "normal", grad: Object.assign(Gradient.make("model", "#ffffff"), { dir: [1, 0, 0] }) });
  s2.layers = [fill2];
  delete s._bake; delete s2._bake;
  var depth = 0, maxDepth = 0, order = [], origPos = Bake.position;
  Bake.position = async function(slot){ depth++; maxDepth = Math.max(maxDepth, depth); order.push(slot.id); try { return await origPos.call(Bake, slot); } finally { depth--; } };
  compositeSlot(s); compositeSlot(s2); flushComposites();
  await new Promise(function(r){ var n = 0; (function tick(){ if ((!s._posPending && !s2._posPending) || ++n > 400) return r(); setTimeout(tick, 25); })(); });
  out.serial = { maxDepth: maxDepth, order: order.slice(), both: !!(s._bake && s._bake.pos && s2._bake && s2._bake.pos) };
  // a real failure: reported once, latched under the key, not asked again by the next composite
  var fails = 0, reports = [], origReport = reportFailure;
  reportFailure = function(what, err, key){ reports.push(what); };
  Bake.position = async function(slot){ fails++; throw new Error("the GPU refused"); };
  delete s._bake; fill.grad = Object.assign({}, fill.grad);
  comp();
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  comp(); comp();
  await new Promise(function(r){ setTimeout(r, 200); });
  out.latch = { fails: fails, reports: reports.length, failKey: s._posFail === Bake.key(s, "pos"), pending: !!s._posPending, drawn: band(2) };
  reportFailure = origReport;
  Bake.position = origPos;
  delete s._posFail;
  // a cancel: declined on the slot, nothing reported, not asked again — until the gradient is touched
  var origTick = progTick;
  progTick = async function(f){ Prog.cancelled = true; return origTick(f); };
  reports = []; reportFailure = function(what){ reports.push(what); };
  comp();
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  progTick = origTick;
  comp();
  await new Promise(function(r){ setTimeout(r, 250); });
  out.cancel = { declined: s._posDeclined === Bake.key(s, "pos"), reported: reports.length, reasked: !!s._posPending, baked: !!(s._bake && s._bake.pos), barUp: !!Prog.active };
  reportFailure = origReport;
  GradFill.retry([s]);
  comp();
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  out.cancel.afterRetry = !!(s._bake && s._bake.pos);
  // export waits: a sheet with no bake gets one through ensure, and is re-composited before anything reads it
  delete s._bake; fill.grad = Object.assign({}, fill.grad);
  ctx2d(s.composite).fillStyle = "#123456"; ctx2d(s.composite).fillRect(0, 0, N, N);
  await GradFill.ensure();
  flushComposites();
  out.ensure = { baked: !!(s._bake && s._bake.pos), drawn: band(2) };   // q3 sits on the second sheet now
  // the queue is not poisoned by a rejection: ensure over a slot whose bake throws, then a request still runs
  Bake.position = async function(slot){ throw new Error("once"); };
  delete s._bake; fill.grad = Object.assign({}, fill.grad);
  var ensureThrew = false;
  try { await GradFill.ensure(); } catch (e) { ensureThrew = true; }
  Bake.position = origPos; delete s._posFail;
  comp();
  await new Promise(function(r){ var n = 0; (function tick(){ if (!s._posPending || ++n > 200) return r(); setTimeout(tick, 25); })(); });
  out.poison = { ensureThrew: ensureThrew, recovered: !!(s._bake && s._bake.pos), pending: !!s._posPending };
  // a Limit rectangle is part of the sheet's key
  var cc = LayerNode.contentOn(fill, "color");
  var k1 = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, cc, fill);
  fill.scope = Scope.make(null, { x: 0, y: 0, w: 128, h: 128 });
  var k2 = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, cc, fill);
  fill.scope = undefined;
  out.limitKey = k1 !== k2;
  // a gradient as a mask: a red paint layer clipped to a gradient fill below shows where the fade is opaque
  var red = mkCanvas(N, N); ctx2d(red).fillStyle = "#ff0000"; ctx2d(red).fillRect(0, 0, N, N);
  var paint = LayerNode.of({ type: "paint", name: "p", canvas: red, visible: true, opacity: 1, blend: "normal" });
  fill.grad = Object.assign(Gradient.make("uv", "#00ff00"), { angle: 0 });      // green, alpha 1 → 0 left to right
  fill.visible = false;
  paint.maskRef = LayerNode.BELOW;
  s.layers = [fill, paint];
  comp();
  out.maskBy = { left: px(s.composite, 4, 128), right: px(s.composite, 250, 128), sources: LayerNode.maskSources(s, paint).length, src: !!LayerNode.maskSource(s, paint) };
  fill.visible = true; paint.maskRef = null; s.layers = [fill];
  // the sheet is freed when the fill goes flat
  GradUI.put({ L: fill, C: cc, onChan: function(fn){ fn(cc, fill); } }, null);
  out.freed = { sheet: !!cc._gradSheet, grad: !!cc.grad };
  App.slots.delete("t74b"); App.activeSlot = was; App.slots.delete("t74");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(r.flat[0] === 255 && r.flat[1] === 0, `a fill with no gradient still renders flat (${r.flat.slice(0, 3)})`);
R.is(r.uv.left[0] === 0 && r.uv.right[0] === 255 && Math.abs(r.uv.mid[0] - 128) <= 2,
  `a UV gradient across the sheet reads its stops at the ends and the mean in the middle (${r.uv.left[0]} / ${r.uv.mid[0]} / ${r.uv.right[0]})`);
R.is(r.uvRegion <= 1, `the dirty-rectangle path matches the whole-sheet path in UV space (worst channel difference ${r.uvRegion})`);
R.is(r.fade.left[2] === 255 && r.fade.left[0] <= 2 && Math.abs(r.fade.right[0] - 128) <= 2 && Math.abs(r.fade.right[2] - 128) <= 2,
  `a fade to alpha 0 shows the base at its transparent end (${r.fade.left.slice(0, 3)} → ${r.fade.right.slice(0, 3)})`);
R.is(r.rect.above[0] === 128 && r.rect.top[0] < 12 && Math.abs(r.rect.mid[0] - 128) <= 3 && r.rect.bottom[0] > 240,
  `a Limit rectangle centres the axis on the rectangle: outside it the base, black at its top, the mean at its middle, white at its foot (${r.rect.above[0]} / ${r.rect.top[0]} / ${r.rect.mid[0]} / ${r.rect.bottom[0]})`);
R.is(r.thumb.l[0] < 40 && r.thumb.r[0] > 200, `the thumbnail draws the ramp, not one colour (${r.thumb.l[0]} → ${r.thumb.r[0]})`);
R.is(r.roundTrip.saved && r.roundTrip.back && JSON.stringify(r.roundTrip.saved) === JSON.stringify(r.roundTrip.back) && r.roundTrip.back.angle === 90 && r.roundTrip.back.stops.length === 2,
  "a gradient survives save and load as its record (the format stays at version 5)");
R.is(r.roundTrip.color === "#000000", `…and the flat colour written beside it is the first stop, for a reader that has never heard of gradients (${r.roundTrip.color})`);
R.is(r.dup.has && !r.dup.shared && !r.dup.stopsShared, "duplicating the layer copies the record rather than sharing it");
R.is(r.convert.kind === "paint" && r.convert.before[0][0] < 100 && r.convert.before[2][0] > 160 &&
     r.convert.after.every((p, i) => Math.abs(p[0] - r.convert.before[i][0]) <= 1 && Math.abs(p[1] - r.convert.before[i][1]) <= 1),
  `convert to painted pixels keeps the gradient's pixels, ramp and all (${r.convert.before.map(p => p[0]).join("/")} → ${r.convert.after.map(p => p[0]).join("/")})`);
R.is(r.convertUndo.kind === "fill" && r.convertUndo.grad, "…and undo brings the gradient back");
if (r.mode === "none") {
  R.ok("no WebGL in this browser: the model-space half is skipped (the position bake needs the GPU projector)");
} else {
  R.is(r.pos.bb && r.pos.bb.x0 === 0 && Math.abs(r.pos.bb.x1 - 3.5) < 1e-6, `the position bake's box is the vehicle's (${JSON.stringify(r.pos.bb)})`);
  R.is(r.posQ1.has === 1 && Math.abs(r.posQ1.x - 1.25 / 3.5) < 2e-3, `a texel of the second quad holds its own x (${r.posQ1.x.toFixed(4)} of ${(1.25 / 3.5).toFixed(4)})`);
  R.is(r.posSteps.every(d => d > 0 && d < 256), `…to sixteen bits: neighbouring texels step by less than a high byte (${r.posSteps.join(", ")})`);
  R.is(r.posPad.near === 1 && r.posPad.far === 0, "the gutter beside an island is padded with a position, the far gutter is not");
  const m = r.model;
  R.is(m[0] < 30 && m[1] > m[0] + 40 && m[2] > m[1] + 40 && m[3] > 200 && m[3] < 256,
    `along the model, black at the nose end and brighter with every quad toward the far end (${m.join(" / ")})`);
  R.is(Math.abs((m[1] - m[0]) - (m[2] - m[1])) <= 3, `…in equal steps, because the quads are equally spaced (${m[1] - m[0]} vs ${m[2] - m[1]})`);
  R.is(r.modelGutter[0] === 128, `where the sheet has no position the base shows through (${r.modelGutter[0]})`);
  R.is(r.modelRev[0] > r.modelRev[1] + 100, `the nose → tail preset runs it the other way (${r.modelRev.join(" / ")})`);
  R.is(r.modelRegion <= 1, `the dirty-rectangle path matches the whole-sheet path along the model (worst channel difference ${r.modelRegion})`);
  R.is(r.cached === true, "the position bake is cached under its key and not rebuilt");
  R.is(r.sheetCache.same && r.sheetCache.moved && r.sheetCache.size[0] === 256, "the evaluated sheet is cached on the content — one canvas per record, a new one when the record moves");
  R.is(r.storeKeepsBake === true, "hanging a store (a new App.geomData holding the same vehicle) keeps the bake");
  R.is(r.pruned === true && r.rebaked === true, "the bake is dropped once nothing on the sheet reads it, and made again when something does");
  R.is(r.lazy.first === 128 && r.lazy.pending === true && r.lazy.after > 200,
    `a sheet with no bake yet draws the base, asks for one, and shows the gradient once it lands (${r.lazy.first} → ${r.lazy.after})`);
  R.is(r.serial.maxDepth === 1 && r.serial.both && r.serial.order.length === 2, `two sheets asked in one frame bake one at a time, both land (${r.serial.order.join(" then ")})`);
  R.is(r.latch.fails === 1 && r.latch.reports === 1 && r.latch.failKey && !r.latch.pending && r.latch.drawn === 128,
    `a bake that fails is reported once and not asked again by the next composites (${r.latch.fails} attempt, ${r.latch.reports} report)`);
  R.is(r.cancel.declined && r.cancel.reported === 0 && !r.cancel.reasked && !r.cancel.baked && !r.cancel.barUp,
    "a cancel is declined on the slot, reported to no one, and the next composite does not bring the bar back");
  R.is(r.cancel.afterRetry === true, "…and touching the gradient asks again");
  R.is(r.ensure.baked && r.ensure.drawn > 140 && r.ensure.drawn < 200, `export's ensure() bakes a sheet that has no bake and re-composites it before it is read (${r.ensure.drawn})`);
  R.is(r.poison.ensureThrew && r.poison.recovered && !r.poison.pending, "a bake that throws under ensure() does not poison the queue: the next request still lands");
  R.is(r.limitKey === true, "a Limit rectangle is part of the cached sheet's key");
  R.is(r.maskBy.src && r.maskBy.sources === 1 && r.maskBy.left[0] > 240 && r.maskBy.left[1] < 12 && Math.abs(r.maskBy.right[0] - 128) <= 2,
    `a gradient lends its fade as a mask: red clipped to a hidden green→nothing fill shows red at the opaque end and the base at the other (${r.maskBy.left.slice(0, 3)} / ${r.maskBy.right.slice(0, 3)})`);
  R.is(!r.freed.sheet && !r.freed.grad, "a fill made flat again keeps no evaluated sheet behind it");
}
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors or rejections during the run:\n        " + errs.join("\n        ") : "no uncaught errors or unhandled rejections during the run");
R.finish();
