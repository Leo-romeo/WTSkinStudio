// Layer styles for a decal: an outline and a drop shadow (ROADMAP 4.44, sixth candidate).
//
// WHY THIS EXISTS. A serial with a contrasting outline is the standard aircraft marking, and both
// styles are rendered in the decal's own image space so the projector carries them round the
// fuselage unchanged. Four things have to be true for that to be a feature rather than a smear, and
// each is asserted in the real page:
//
//   * the styled image keeps the source's CENTRE, and the source's own pixels, exactly — an outline
//     is added round a marking, not drawn over it, and the marking must not move;
//   * the outline is a disc dilation of the right width, solid to `r` and gone past it, and the
//     shadow lands where its offset says, at its opacity, softened by its blur;
//   * through the compositor a floating decal stamps the styled image, still centred where the decal
//     is; through the projector a projected decal keeps its size — the beam widens with the padding,
//     so the marking's own texel count on the sheet does not change when an outline is added;
//   * the footprint the Look's derived channels are built from takes the outline and NOT the shadow,
//     and a Look with no style draws the source object itself (so t58's pixels cannot have moved).
//
// Usage: node tools/t67_decalstyle.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  // a 64-px red square in the middle of a transparent 128-px image
  var src = mkCanvas(128, 128); var sg = ctx2d(src); sg.fillStyle = "#ff0000"; sg.fillRect(32, 32, 64, 64);

  // ---- 1. image space ----
  out.plain = DecalStyle.bitmap(src, { sm: 0 }, {}) === src;
  var S1 = { ol: 10, olc: "#00ff00" };                       // 10 % of 128 = 12.8 px
  var a = DecalStyle.bitmap(src, S1, {});
  var pad = (a.width - 128) / 2;
  out.padded = { w: a.width, h: a.height, pad: pad, square: a.width === a.height };
  out.centre = px(a, 64 + pad, 64 + pad);                    // the source's own pixel, moved by pad
  out.ringNear = px(a, 32 + pad - 6, 64 + pad);              // 6 px outside the left edge: outline
  out.ringCorner = px(a, 32 + pad - 8, 32 + pad - 8);        // 8·√2 = 11.3 px diagonally: still inside 12.8
  out.ringFar = px(a, 32 + pad - 20, 64 + pad);              // 20 px out: nothing
  out.ringEdge = px(a, 32 + pad - 13, 64 + pad);             // 13 px: the antialiased rim, partial
  var holder = {};
  var c1 = DecalStyle.bitmap(src, S1, holder), c2 = DecalStyle.bitmap(src, S1, holder);
  var c3 = DecalStyle.bitmap(src, { ol: 5, olc: "#00ff00" }, holder);
  out.cached = c1 === c2 && c3 !== c1 && c3.width < c1.width;
  var S2 = { sh: 100, shx: 10, shy: 10, shb: 0, shc: "#0000ff" }; // offset 12.8 px, hard
  var b = DecalStyle.bitmap(src, S2, {});
  var pb = (b.width - 128) / 2;
  out.shadow = px(b, 96 + pb + 8, 96 + pb + 8);              // 8 px right-and-below the square: shadow
  out.shadowNot = px(b, 32 + pb - 8, 32 + pb - 8);           // up-left: nothing there
  out.shadowUnder = px(b, 64 + pb, 64 + pb);                 // the square is still on top
  var S3 = { sh: 50, shx: 10, shy: 10, shb: 4, shc: "#0000ff" };
  var c = DecalStyle.bitmap(src, S3, {});
  var pc = (c.width - 128) / 2;
  out.shadowSoft = px(c, 96 + pc + 8, 96 + pc + 8);          // half opacity, blurred: alpha well under 255
  out.noShadowForFoot = DecalStyle.bitmap(src, S2, {}, true) === src;   // a shadow-only Look, footprint: the source itself

  // ---- 2. through the compositor: a floating decal ----
  var N = 256;
  var flat = function(hex){ var k = mkCanvas(N, N); var g = ctx2d(k); g.fillStyle = hex; g.fillRect(0, 0, N, N); return k; };
  var slot = { id: "t67", size: N, nSize: N, layers: [], missing: false, baseC: flat("#404040"), composite: flat("#404040") };
  var L = LayerNode.of({ type: "decal", name: "sq", bmp: src, x: .5, y: .5, scale: 1, rot: 0, flip: false,
                         visible: true, opacity: 1, blend: "normal", surf: null });
  slot.layers = [L];
  App.slots.set("t67", slot);
  var was = App.activeSlot; App.activeSlot = slot; App.activeLayer = L;
  compositeSlot(slot); flushComposites();
  var before = { centre: px(slot.composite, 128, 128), ring: px(slot.composite, 128 - 32 - 6, 128), edgeIn: px(slot.composite, 128 - 32 + 1, 128) };
  L.surf = { sm: 0, mt: 0, em: 0, wr: 0, preset: "none", ol: 10, olc: "#00ff00" };
  compositeSlot(slot); flushComposites();
  var after = { centre: px(slot.composite, 128, 128), ring: px(slot.composite, 128 - 32 - 6, 128), edgeIn: px(slot.composite, 128 - 32 + 1, 128), far: px(slot.composite, 128 - 32 - 24, 128) };
  out.comp = { before: before, after: after };
  // the footprint: outline in, shadow out
  L.surf = { sm: 0, mt: 0, em: 0, wr: 0, preset: "none", ol: 10, olc: "#00ff00", sh: 100, shx: 20, shy: 0, shb: 0, shc: "#000000" };
  var foot = decalFootprint(L, N, N, null);
  out.foot = { ring: px(foot.canvas, 128 - 32 - 6, 128)[3], shadow: px(foot.canvas, 128 + 32 + 14, 128)[3], body: px(foot.canvas, 128, 128)[3] };
  compositeSlot(slot); flushComposites();
  out.compShadow = px(slot.composite, 128 + 32 + 14, 128);   // 12.8 px offset shadow, past the outline: black on the sheet
  App.activeSlot = was; App.slots.delete("t67");

  // ---- 3. through the projector: a flat plate, one band of a sheet ----
  function V(x, y, z){
    return { x: x, y: y, z: z,
      clone: function(){ return V(this.x, this.y, this.z); },
      multiplyScalar: function(s){ this.x *= s; this.y *= s; this.z *= s; return this; },
      addScaledVector: function(v, s){ this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
      negate: function(){ this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; } };
  }
  var SH = 256;
  var pos = new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,-1,0, 1,1,0, -1,1,0]);
  var nor = new Float32Array(18); for (var k = 0; k < 6; k++) nor[k*3+2] = 1;
  var uv = new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]);
  App.geomData = [{ name: "plate", mat: "m", position: pos, normal: nor, uv: uv }];
  App.meshes = new Map([["plate", { visible: true }]]);
  App.matSlot = new Map([["m", "slotP"]]);
  App.protectedParts = new Set(); App.selParts = new Set();
  App.modelSize = { x: 10, y: 10, z: 10 };
  App._projGL = null;
  if (!projGL()) { out.gl = false; return out; }
  out.gl = true;
  var sheet = mkCanvas(SH, SH);
  var count = function(pred){ var d = ctx2d(sheet).getImageData(0, 0, SH, SH).data, n = 0; for (var i = 0; i < SH * SH; i++) if (pred(d[i*4], d[i*4+1], d[i*4+2], d[i*4+3])) n++; return n; };
  var frame = { p: V(0, 0, 0.05), n: V(0, 0, 1), r: V(1, 0, 0), u: V(0, 1, 0) };
  var P0 = { bmp: src, scale: .5, rot: 0, flip: false, sym2: false, parts: null, depth: 1, wrap: .85, surf: null };
  renderProjection(sheet, P0, frame, { id: "slotP" }, false);
  var red0 = count(function(r, g, b, a){ return a > 200 && r > 200 && g < 60; });
  var P1 = Object.assign({}, P0, { surf: { ol: 10, olc: "#00ff00" } });
  renderProjection(sheet, P1, frame, { id: "slotP" }, false);
  var red1 = count(function(r, g, b, a){ return a > 200 && r > 200 && g < 60; });
  var green1 = count(function(r, g, b, a){ return a > 200 && g > 200 && r < 60; });
  out.proj = { red0: red0, red1: red1, green1: green1 };
  // the outline's width on the sheet: the source is 64 px across, drawn at 2·halfW over the plate;
  // 12.8 px of outline is 20 % of that width each side
  var half = projHalfSize(P1), half0 = projHalfSize(P0);
  out.halves = { w0: half0.halfW, w1: half.halfW, ratio: half.halfW / half0.halfW, expect: (128 + 2 * DecalStyle.pad(src, DecalStyle.read(P1.surf), false)) / 128 };
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const rgba = p => "(" + p.join(",") + ")";

// ---- image space ----
R.is(r.plain, "a Look with no style draws the source object itself — nothing is copied, so t58's pixels cannot have moved");
R.is(r.padded.square && r.padded.pad >= 13 && r.padded.pad <= 15,
  `a 10 % outline on a 128-px image pads it to ${r.padded.w}×${r.padded.h} (${r.padded.pad} px a side, for a 12.8 px ring)`);
R.is(r.centre[0] === 255 && r.centre[1] === 0 && r.centre[3] === 255, `the source's own pixel is where it was, moved by the pad: ${rgba(r.centre)}`);
R.is(r.ringNear[1] === 255 && r.ringNear[0] === 0 && r.ringNear[3] === 255, `6 px outside the edge is solid outline: ${rgba(r.ringNear)}`);
R.is(r.ringCorner[1] === 255 && r.ringCorner[3] === 255, `11.3 px out on the diagonal is still outline — a disc, not a square: ${rgba(r.ringCorner)}`);
R.is(r.ringFar[3] === 0, `20 px out is nothing: ${rgba(r.ringFar)}`);
R.is(r.ringEdge[3] > 0 && r.ringEdge[3] < 255, `13 px out is the antialiased rim: alpha ${r.ringEdge[3]}`);
R.is(r.cached, "the styled image is cached on its holder and rebuilt when a number changes");
R.is(r.shadow[2] === 255 && r.shadow[0] === 0 && r.shadow[3] === 255, `a hard shadow offset 10 % right and down lands there, in its colour: ${rgba(r.shadow)}`);
R.is(r.shadowNot[3] === 0, `…and not up-left: ${rgba(r.shadowNot)}`);
R.is(r.shadowUnder[0] === 255 && r.shadowUnder[2] === 0, `the marking stays on top of its shadow: ${rgba(r.shadowUnder)}`);
R.is(r.shadowSoft[3] > 20 && r.shadowSoft[3] < 200, `at 50 % with a blur the shadow is soft: alpha ${r.shadowSoft[3]}`);
R.is(r.noShadowForFoot, "asked without the shadow, a shadow-only Look hands back the source — the footprint never sees a shadow");

// ---- compositor ----
const cb = r.comp.before, ca = r.comp.after;
R.is(cb.centre.join() === ca.centre.join() && cb.edgeIn.join() === ca.edgeIn.join(),
  `through the compositor the marking's own pixels do not move when an outline is added: centre ${rgba(ca.centre)}, inner edge ${rgba(ca.edgeIn)}`);
R.is(cb.ring[1] < 100 && ca.ring[1] === 255 && ca.ring[0] === 0, `and the sheet has the outline round it: ${rgba(cb.ring)} → ${rgba(ca.ring)}`);
R.is(ca.far[0] === 0x40 && ca.far[1] === 0x40, `24 px out the base shows: ${rgba(ca.far)}`);
R.is(r.foot.ring === 255 && r.foot.body === 255 && r.foot.shadow === 0,
  `the footprint takes the outline (alpha ${r.foot.ring}) and the body (${r.foot.body}) and not the shadow (${r.foot.shadow})`);
R.is(r.compShadow[0] < 40 && r.compShadow[3] === 255, `…while the sheet does show the shadow there: ${rgba(r.compShadow)}`);

// ---- projector ----
if (!r.gl) console.log("  SKIP projector half: no WebGL context in this browser");
else {
  R.is(r.proj.red0 > 500 && Math.abs(r.proj.red1 - r.proj.red0) <= r.proj.red0 * .02,
    `a projected marking keeps its size when an outline is added: ${r.proj.red0} → ${r.proj.red1} red texels (the beam widens with the padding)`);
  R.is(r.proj.green1 > r.proj.red0 * .5, `and the outline is projected round it: ${r.proj.green1} green texels`);
  R.is(Math.abs(r.halves.ratio - r.halves.expect) < 1e-6, `projHalfSize widens by exactly the padding: ×${r.halves.ratio.toFixed(4)} (expected ×${r.halves.expect.toFixed(4)})`);
}

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
