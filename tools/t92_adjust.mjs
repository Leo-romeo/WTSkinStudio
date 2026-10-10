// Effect kinds: Levels, Curves, colour balance, a gradient map, invert, threshold, posterize
// (ROADMAP 4.50 (5)).
//
// WHY THIS EXISTS. An effect was four numbers through a CSS filter. Each new kind is a per-texel
// look-up — its value in, its value out — and that is the whole of why the dirty-rectangle path can
// stay equal to the whole-sheet one; so the properties are held in two halves, and every one of
// them has an exact answer:
//
//   Node, on the pure `/*==EFFECTS==*/` section (with GRADIENT, whose table the gradient map reuses):
//   * Levels at rest is no change; the input range stretches to the whole, gamma lifts or sinks the
//     middle and keeps the ends, the output range bounds it, a reversed one inverts exactly, an empty
//     input range is a hard step; a channel's own levels come first and the master's output range
//     bounds every channel;
//   * a curve passes through its points exactly, never falls between rising points and never
//     overshoots them, is flat past its ends, is a straight line through two, is no change through
//     fewer; a channel's curve comes before the master's;
//   * invert is 255 − x; posterize keeps exactly n values in equal shares of the input; threshold and
//     a gradient map read the texel's luma (pure red is dark, pure green is light), a stop's opacity
//     mixes toward its colour and at 0 % leaves the texel alone; a colour balance moves only the
//     range it names and, with "keep luminosity", keeps the tone to the byte; alpha is never touched;
//   * a record read from a file is put back in range, an unknown kind is kept verbatim and compiles to
//     nothing, and the tables are cached under the record; the curve editor's rules hold; a
//     channel's own Levels or Curves back at no change is dropped (`Effect.tidy`).
//
//   Headless Chrome, on the real page:
//   * for every kind, a whole-sheet composite and a dirty-rectangle one agree to the byte — on colour,
//     on a smoothness sheet, inside a group, inside a pass-through group, faded and masked (t52's
//     oracle, made to work: the region is overwritten before it is recomposited, so a region pass
//     that did nothing would fail, and the effect's own share of the region is counted against the
//     same stack with it hidden);
//   * a mask and a Limit confine it: where either hides the effect a texel is exactly the stack
//     beneath, where either shows it in full exactly the table's. The mask stores visibility in
//     ALPHA, as the app's do — the first version's was opaque grey, hid nothing, and a compositor
//     that ignored masks passed every check (review of 4.50 (5), 2026-09-26);
//   * an effect changes colour and never coverage: at rest inside a group over a 70 % layer it
//     changes no byte (drawn source-over with the stack's alpha it made the layer 91 %);
//   * the GPU pass and the CPU pass agree on EVERY texel, for every kind, and the GPU pass is the one
//     that runs; blend-if and the effects share one GL context; and a whole COMPOSITE with the GPU
//     pass forced off — the fallback, inside a group over 70 % paint, where a CPU result that was not
//     opaque would land at 70 % strength — equals the GPU one on every texel;
//   * the composite IS the table: an effect at full opacity turns the sheet into exactly what
//     `Effect.apply` says, and at half opacity into the mean of the two, to the canvas's rounding;
//     inside a pass-through group at 50 % it is exactly the same effect at 50 % with no group;
//   * the four numbers still draw exactly the CSS filter they always did;
//   * save / load keeps the record (version 5), with the four numbers written at rest beside it; a
//     duplicate does not share the record; an unknown kind survives the trip and draws nothing;
//   * the panel: the Effect select changes the kind in one undo step, setting the four numbers to
//     rest as the file stores them (undo brings a hue shift back, and choosing the four numbers again
//     starts them at rest, as a save and reload would); a Levels slider changes one number in one
//     step, and undoing a channel's first edit leaves the record as it was; every edit reaches a
//     linked sibling on another texture, as a record of its own; the Curves box, driven by pointer
//     events, adds a point where a click lands and carries it in one step, drops one dragged out of
//     the box or double-clicked, and takes a double-click on empty space as a click, in one step; a
//     smoothness layer is not offered the colour-only kinds; the thumbnail shows the base through
//     the table.
//
// Usage: node tools/t92_adjust.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Gradient, Effect } = new Function(sectionOf("GRADIENT").replace(/^"use strict";$/m, "") + "\n" +
  sectionOf("EFFECTS").replace(/^"use strict";$/m, "") + "\nreturn { Gradient, Effect };")();

const tab = fx => Effect.compile(Effect.clone(fx));
const chan = (T, c) => Array.from({ length: 256 }, (_, i) => T.per[i * 4 + c]);
const one = (T, rgb) => Array.from(Effect.apply(T, new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 200])));
const lv = o => Object.assign(Effect.lv(), o);

console.log("=== Levels ===");
{
  const id = tab({ type: "levels", rgb: Effect.lv() });
  R.is([0, 1, 2].every(c => chan(id, c).every((v, i) => v === i)), "Levels at rest is no change, on every channel");
  const S = chan(tab({ type: "levels", rgb: lv({ inLo: 50, inHi: 200 }) }), 0);
  R.is(S[0] === 0 && S[50] === 0 && S[200] === 255 && S[255] === 255 && S[125] === 128,
    `the input range stretches to the whole: 50 → ${S[50]}, 200 → ${S[200]}, 125 → ${S[125]}, and past it clips`);
  const G = chan(tab({ type: "levels", rgb: lv({ gamma: 2 }) }), 0), G2 = chan(tab({ type: "levels", rgb: lv({ gamma: .5 }) }), 0);
  R.is(G[128] === Math.round(Math.sqrt(128 / 255) * 255) && G[0] === 0 && G[255] === 255 && G2[128] < 128,
    `gamma above 1 lifts the middle (128 → ${G[128]}), below 1 sinks it (→ ${G2[128]}), and black and white stay put`);
  const O = chan(tab({ type: "levels", rgb: lv({ outLo: 20, outHi: 235 }) }), 0);
  R.is(O[0] === 20 && O[255] === 235, `the output range: black becomes ${O[0]}, white ${O[255]}`);
  const V = chan(tab({ type: "levels", rgb: lv({ outLo: 255, outHi: 0 }) }), 0);
  R.is(V.every((v, i) => v === 255 - i), "a reversed output range inverts, exactly");
  const H = chan(tab({ type: "levels", rgb: lv({ inLo: 90, inHi: 90 }) }), 0);
  R.is(H[89] === 0 && H[90] === 255, "an empty input range is a hard step at it, not a division by zero");
  const M = chan(tab({ type: "levels", rgb: { inLo: 30, inHi: 220, gamma: 1.7, outLo: 10, outHi: 240 } }), 0);
  R.is(M.every((v, i) => !i || v >= M[i - 1]), "with both ranges the right way round, the table never falls");
  const PC = tab({ type: "levels", rgb: lv({ outHi: 200 }), r: lv({ inHi: 100 }) });
  const pr = chan(PC, 0), pg = chan(PC, 1);
  R.is(pr[100] === 200 && pr[255] === 200 && pg[255] === 200 && pg[100] === Math.round(100 / 255 * 200),
    `a channel's own levels come first, then all channels': red reaches white at 100 and the master caps it at 200 (${pr[100]}; green 100 → ${pg[100]})`);
  R.is([0, 1, 2].every(c => chan(PC, c).every(v => v <= 200)), "…so no channel exceeds the master's Out white");
}

console.log("\n=== Curves ===");
{
  const C = pts => Array.from(Effect.curve(pts));
  R.is(C(Effect.line()).every((v, i) => v === i), "the straight line is no change");
  const S = C([[0, 0], [64, 40], [192, 220], [255, 255]]);
  R.is(S[64] === 40 && S[192] === 220 && S[0] === 0 && S[255] === 255, `an S-curve passes through every point exactly (${S[64]}, ${S[192]})`);
  R.is(S.every((v, i) => !i || v >= S[i - 1]), "…never falls between rising points");
  R.is(S.slice(64, 193).every(v => v >= 40 && v <= 220), "…and never overshoots them (Fritsch–Carlson, where a natural spline would)");
  const F = C([[32, 10], [224, 240]]);
  R.is(F.slice(0, 33).every(v => v === 10) && F.slice(224).every(v => v === 240), "flat past its end points");
  R.is(C([[255, 0], [0, 255]]).every((v, i) => v === 255 - i), "two points are a straight line in whatever order they come — this one inverts exactly");
  R.is(C([[0, 0], [128, 90], [128, 200], [255, 255]])[128] === 200, "one x twice: the later point wins");
  R.is(C([[100, 50]]).every((v, i) => v === i) && C([]).every((v, i) => v === i), "fewer than two points is no change");
  const T = tab({ type: "curves", rgb: [[0, 0], [255, 128]], g: [[0, 255], [255, 0]] });
  R.is(T.per[1] === 128 && T.per[255 * 4 + 1] === 0 && T.per[255 * 4] === 128,
    `a channel's curve comes first, then all channels': green inverted, then halved (0 → ${T.per[1]}, 255 → ${T.per[255 * 4 + 1]}; red 255 → ${T.per[255 * 4]})`);
}

console.log("\n=== Invert, Posterize, Threshold ===");
{
  const I = tab({ type: "invert" });
  R.is([0, 1, 2].every(c => chan(I, c).every((v, i) => v === 255 - i)), "Invert: every value becomes 255 minus itself, on each channel");
  const P4 = chan(tab({ type: "posterize", levels: 4 }), 0);
  R.is(new Set(P4).size === 4 && [0, 85, 170, 255].every(v => P4.includes(v)), `Posterize 4 keeps exactly four values, evenly spread (${[...new Set(P4)].join(", ")})`);
  R.is(P4[63] === 0 && P4[64] === 85 && P4[127] === 85 && P4[128] === 170 && P4[191] === 170 && P4[192] === 255, "…each taking an equal share of the input");
  const P2 = chan(tab({ type: "posterize", levels: 2 }), 0);
  R.is(P2[127] === 0 && P2[128] === 255, "Posterize 2 splits at the middle");
  const Th = tab({ type: "threshold", level: 128 });
  R.is(one(Th, [128, 128, 128])[0] === 255 && one(Th, [127, 127, 127])[0] === 0, "Threshold: at the level is white, one below is black");
  R.is(one(Th, [255, 0, 0]).slice(0, 3).join() === "0,0,0" && one(Th, [0, 255, 0]).slice(0, 3).join() === "255,255,255",
    "…by the texel's tone, not a channel: pure red (luma 54) is black, pure green (luma 182) white");
  R.is([Th, I].every(T => one(T, [10, 20, 30])[3] === 200), "alpha is left alone");
  let lumOk = true;
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 7) for (let b = 0; b < 256; b += 11)
    if (Effect.lum(r, g, b) !== Math.round((2126 * r + 7152 * g + 722 * b) / 10000)) lumOk = false;
  R.is(lumOk && Effect.lum(255, 255, 255) === 255 && Effect.lum(255, 0, 0) === 54, "luma is Rec. 709's weights, rounded to a byte — blend-if's integer");
}

console.log("\n=== Gradient map ===");
{
  const BW = tab({ type: "gradmap", stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] });
  R.is(one(BW, [255, 0, 0]).slice(0, 3).join() === "54,54,54", "black → white turns a texel into its own tone");
  const stops = [{ t: 0, color: "#ff0000", alpha: 1 }, { t: 1, color: "#0000ff", alpha: 1 }];
  const RB = tab({ type: "gradmap", stops }), lut = Gradient.lut(stops);
  R.is(one(RB, [0, 0, 0]).slice(0, 3).join() === "255,0,0" && one(RB, [255, 255, 255]).slice(0, 3).join() === "0,0,255",
    "black takes the first stop's colour and white the last's");
  R.is(one(RB, [128, 128, 128]).slice(0, 3).join() === [lut[512], lut[513], lut[514]].join(), "a tone in between reads the gradient's own table (editor/gradient.js) at its luma");
  const Z = tab({ type: "gradmap", stops: [{ t: 0, color: "#ff00ff", alpha: 0 }, { t: 1, color: "#00ff00", alpha: 0 }] });
  R.is([[0, 0, 0], [30, 120, 200], [255, 255, 255]].every(s => one(Z, s).slice(0, 3).join() === s.join()), "a stop at 0 % opacity leaves those tones as they were");
  const Hf = tab({ type: "gradmap", stops: [{ t: 0, color: "#ffffff", alpha: .5 }, { t: 1, color: "#ffffff", alpha: .5 }] });
  R.is(one(Hf, [0, 0, 0])[0] === 128, `half a stop's opacity moves a texel halfway to its colour (0 → ${one(Hf, [0, 0, 0])[0]})`);
}

console.log("\n=== Colour balance ===");
{
  const zero = tab(Effect.make("balance"));
  const samples = [[0, 0, 0], [20, 20, 20], [128, 128, 128], [240, 240, 240], [255, 0, 0], [30, 120, 200], [255, 255, 255]];
  R.is(samples.every(s => one(zero, s).slice(0, 3).join() === s.join()), "a balance at zero is no change");
  const sh = tab({ type: "balance", shadows: [100, 0, 0], mids: [0, 0, 0], highs: [0, 0, 0], keepLum: false });
  const d = one(sh, [20, 20, 20]);
  R.is(d[0] === 147 && d[1] === 20 && d[2] === 20, `shadows toward red: a dark texel gains 127 of red and nothing else (${d.slice(0, 3)})`);
  R.is(one(sh, [128, 128, 128]).slice(0, 3).join() === "128,128,128" && one(sh, [240, 240, 240]).slice(0, 3).join() === "240,240,240",
    "…a midtone and a highlight are left alone");
  const hi = tab({ type: "balance", shadows: [0, 0, 0], mids: [0, 0, 0], highs: [0, 0, -100], keepLum: false });
  R.is(one(hi, [240, 240, 240])[2] === 113 && one(hi, [20, 20, 20])[2] === 20, "highlights toward yellow take blue out of the light texels only");
  const keep = tab({ type: "balance", shadows: [0, 0, 0], mids: [60, -20, 0], highs: [0, 0, 0], keepLum: true });
  const k = one(keep, [100, 110, 90]);
  R.is(Effect.lum(k[0], k[1], k[2]) === Effect.lum(100, 110, 90) && k[0] - k[1] > 100 - 110,
    `keep luminosity: the colour moves toward red and the tone stays where it was (${k.slice(0, 3)}, luma ${Effect.lum(k[0], k[1], k[2])} = ${Effect.lum(100, 110, 90)})`);
  const loose = tab({ type: "balance", shadows: [0, 0, 0], mids: [60, -20, 0], highs: [0, 0, 0], keepLum: false });
  const l = one(loose, [100, 110, 90]);
  R.is(Effect.lum(l[0], l[1], l[2]) !== Effect.lum(100, 110, 90), "…and without it, the same shift moves the tone as well");
}

console.log("\n=== records ===");
{
  const c = Effect.clone({ type: "levels", rgb: { inLo: -5, inHi: 999, gamma: 0, outLo: "x", outHi: 255 }, r: null });
  R.is(c.rgb.inLo === 0 && c.rgb.inHi === 255 && c.rgb.gamma === .1 && c.rgb.outLo === 0 && !("r" in c), "a record read from a file is put back in range");
  const u = { type: "blur", radius: 4, deep: { a: [1, 2] } }, cu = Effect.clone(u);
  R.is(JSON.stringify(cu) === JSON.stringify(u) && cu !== u && cu.deep !== u.deep, "a kind this build does not know is kept exactly, as a copy");
  R.is(Effect.compile(cu) === null, "…and compiles to nothing, so it draws nothing");
  const cc = { fx: { type: "invert" } };
  const t1 = Effect.table(cc), t2 = Effect.table(cc);
  cc.fx = { type: "posterize", levels: 3 };
  R.is(t1 === t2 && Effect.table(cc) !== t1, "the tables are cached on the content under the record, and remade when it changes");
  R.is(Effect.make("hsbc") === null && Effect.KINDS.every(k => k.id === "hsbc" || !!tab(Effect.make(k.id))), "every kind but the four numbers makes a record that compiles");
  R.is(Effect.KINDS.filter(k => k.colour).map(k => k.id).join() === "balance,gradmap", "only colour balance and the gradient map are held to the colour channel");
  const tl = Effect.tidy(Effect.clone({ type: "levels", rgb: Effect.lv(), g: Effect.lv(), r: lv({ inLo: 1 }) }));
  R.is(!("g" in tl) && tl.r && tl.r.inLo === 1 && tl.rgb, "a channel's own Levels back at no change is no setting at all, and goes; one that changes anything stays, and so does all channels'");
  const tc = Effect.tidy(Effect.clone({ type: "curves", rgb: Effect.line(), b: Effect.line(), g: [[0, 0], [128, 128], [255, 255]] }));
  R.is(!("b" in tc) && tc.g && tc.g.length === 3 && tc.rgb,
    "…and so does a channel's curve back at the plain line — but not one through a point on the diagonal, an anchor someone put there");
}

console.log("\n=== the curve editor's rules ===");
{
  const base = [[0, 0], [128, 128], [255, 255]];
  const a = Effect.curveAdd(base, 64.4, 30.6);
  R.is(a.i === 1 && JSON.stringify(a.pts) === "[[0,0],[64,31],[128,128],[255,255]]" && base.length === 3,
    "a new point lands between its neighbours, rounded, and the array it came from is left alone");
  const same = Effect.curveAdd(base, 128.2, 10);
  R.is(same.pts.length === 3 && same.pts[1][1] === 10, "a click on a point's own x moves that point rather than stacking a second");
  const mv = Effect.curveMove(a.pts, 1, 200, 300);
  R.is(mv[1][0] === 127 && mv[1][1] === 255, "a point moves no further than one step short of its neighbour, and stays in the box");
  const end = Effect.curveMove(base, 0, -40, 50);
  R.is(end[0][0] === 0 && end[0][1] === 50, "an end point stays on the box's edge");
  R.is(Effect.curveDrop(a.pts, 1).length === 3 && Effect.curveDrop(Effect.line(), 0).length === 2, "a point can be removed; the last two cannot");
  R.is(Effect.curveHit(base, 131, 125, 8) === 1 && Effect.curveHit(base, 60, 200, 8) === -1, "a click near a point takes it; one nowhere near misses");
}

// ---- the page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 256;
  // Every grey level along x in the top half (so each table is read at every index), seeded
  // colour noise and two saturated patches below — a sheet with an exact answer everywhere.
  var paintSrc = function(c){
    var g = ctx2d(c);
    for (var x = 0; x < N; x++) { g.fillStyle = "rgb(" + x + "," + x + "," + x + ")"; g.fillRect(x, 0, 1, N / 2); }
    var seed = 11;
    for (var by = N / 2; by < N; by += 4) for (var bx = 0; bx < N; bx += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff; var q = seed;
      g.fillStyle = "rgb(" + (q & 255) + "," + ((q >> 8) & 255) + "," + ((q >> 16) & 255) + ")"; g.fillRect(bx, by, 4, 4);
    }
    g.fillStyle = "#ff0000"; g.fillRect(8, N / 2 + 8, 24, 24);
    g.fillStyle = "#3070c0"; g.fillRect(40, N / 2 + 8, 24, 24);
    return c;
  };
  var sheet = function(){ return paintSrc(mkCanvas(N, N)); };
  var mkSlot = function(id){
    var s = { id: id || "t92", size: N, nSize: N, layers: [], missing: false };
    s.baseC = sheet(); s.composite = mkCanvas(N, N);
    s.smooth = sheet(); s.metal = sheet(); s.normal = sheet();
    return s;
  };
  var data = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var worstOf = function(a, b){ var w = 0, n = 0; for (var i = 0; i < a.length; i++) { var e = Math.abs(a[i] - b[i]); if (e) n++; if (e > w) w = e; } return { worst: w, differ: n }; };
  var RECT = { x: 37, y: 90, w: 120, h: 101 };                    // cuts the ramp, the noise and a patch
  var regionOf = function(c){ return ctx2d(c).getImageData(RECT.x, RECT.y, RECT.w, RECT.h).data; };
  // A mask keeps what it shows in ALPHA — maskFill clears to hide and fills #fff to show, and the
  // stencil lands destination-in — so this one is white at every alpha: hidden left of x = 80, shown
  // in full right of 176, a ramp between. The first version was an opaque grey gradient, alpha 255
  // everywhere, which hid nothing: the "masked" cases ran the stencil and it masked no texel, and a
  // compositor that ignored the mask passed them all (review of 4.50 (5), 2026-09-26). RECT cuts the
  // hidden part and the ramp.
  var softMask = function(){
    var c = mkCanvas(N, N), g = ctx2d(c), gr = g.createLinearGradient(80, 0, 176, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = gr; g.fillRect(0, 0, N, N); return c;
  };
  var paintUnder = function(ch){
    var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "rgba(200,60,40,.7)"; g.fillRect(20, 70, 140, 90);
    return LayerNode.of({ type: "paint", name: "under", chan: ch === "color" ? undefined : ch, canvas: c, visible: true, opacity: 1, blend: "normal" });
  };
  var fxLayer = function(fx, ch, o){
    return LayerNode.of(Object.assign({ type: "adjust", name: "fx", chan: ch === "color" ? undefined : ch, visible: true, opacity: 1, blend: "normal",
      hue: 0, sat: 100, bright: 100, contrast: 100, fx: fx }, o || {}));
  };
  var KINDS = {
    levels:    { type: "levels", rgb: { inLo: 30, inHi: 220, gamma: 1.6, outLo: 12, outHi: 240 }, r: { inLo: 0, inHi: 180, gamma: 1, outLo: 0, outHi: 255 } },
    curves:    { type: "curves", rgb: [[0, 0], [70, 40], [180, 215], [255, 255]], b: [[0, 30], [255, 200]] },
    balance:   { type: "balance", shadows: [40, -10, 20], mids: [-30, 50, 0], highs: [0, 0, -60], keepLum: true },
    gradmap:   { type: "gradmap", stops: [{ t: 0, color: "#1a2b3c", alpha: 1 }, { t: .4, color: "#c08040", alpha: .6 }, { t: 1, color: "#f0f0d0", alpha: 1 }] },
    invert:    { type: "invert" },
    threshold: { type: "threshold", level: 100 },
    posterize: { type: "posterize", levels: 5 },
  };
  var GREY = ["levels", "curves", "invert", "threshold", "posterize"];
  // whole vs region on one channel: the region is overwritten before its own pass, so a region pass
  // that drew nothing cannot pass by leaving the whole-sheet pixels where they were. "moved" is how
  // much of the region the EFFECT changed — the same stack with the effect hidden, compared — so a
  // pair that agrees because the effect drew nothing on either path cannot pass either.
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

  // ---- 1. region == whole, every kind ----
  out.region = {};
  Object.keys(KINDS).forEach(function(k){
    out.region[k + "@color"] = wholeVsRegion(function(s){ s.layers = [paintUnder("color"), fxLayer(KINDS[k], "color", { opacity: .7, mask: softMask() })]; }, "color");
  });
  GREY.forEach(function(k){
    out.region[k + "@smooth"] = wholeVsRegion(function(s){ s.layers = [paintUnder("smooth"), fxLayer(KINDS[k], "smooth")]; }, "smooth");
  });
  // inside a group, the effect reads the group's own scratch; the group is faded on top of that
  out.region["curves@group"] = wholeVsRegion(function(s){
    s.layers = [{ type: "group", name: "g", visible: true, opacity: .8, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g91",
                  children: [paintUnder("color"), fxLayer(KINDS.curves, "color")] }];
  }, "color");
  // inside a PASS-THROUGH group the effect reads the stack beneath, and takes the group's opacity
  // and mask as its own (\`cx.amb\`)
  out.region["levels@passthrough"] = wholeVsRegion(function(s){
    s.layers = [paintUnder("color"), { type: "group", name: "pt", visible: true, opacity: .6, blend: "pass through", mask: softMask(), parts: null, collapsed: false, uid: "g91t",
                  children: [fxLayer(KINDS.levels, "color")] }];
  }, "color");

  // ---- 1b. a mask and a Limit confine the effect ----
  // Region = whole cannot see this: a stencil ignored on both paths is ignored alike. So, against
  // the same stack with no effect: a texel the mask hides is exactly what lay beneath, and one it
  // shows in full, at full opacity, is exactly the table's; likewise inside and outside a Limit.
  var confined = function(k, o){
    var s = mkSlot(), n = mkSlot();
    s.layers = [paintUnder("color"), fxLayer(KINDS[k], "color", o)];
    n.layers = [paintUnder("color")];
    compositeSlot(s, null); compositeSlot(n, null);
    var under = data(n.composite);
    return { got: data(s.composite), under: under, want: Effect.apply(Effect.table({ fx: KINDS[k] }), new Uint8ClampedArray(under)) };
  };
  // shown(i): 1 where the effect must land in full, 0 where it must not land at all, -1 in between
  var confinedBy = function(k, o, shown){
    var r = confined(k, o), e = { off: 0, on: 0, offWorst: 0, onWorst: 0 };
    for (var i = 0; i < r.got.length; i += 4) {
      var w = shown(i / 4);
      if (w < 0) continue;
      var ref = w ? r.want : r.under;
      if (w) e.on++; else e.off++;
      for (var j = 0; j < 3; j++) { var d = Math.abs(r.got[i + j] - ref[i + j]); if (w) e.onWorst = Math.max(e.onWorst, d); else e.offWorst = Math.max(e.offWorst, d); }
    }
    // and the effect is not the stack beneath where it lands, or "untouched" would prove nothing
    e.moved = worstOf(r.want, r.under).differ;
    return e;
  };
  out.confined = {};
  ["invert", "levels"].forEach(function(k){
    var M = softMask(), ma = data(M);
    out.confined[k + "@mask"] = confinedBy(k, { mask: M }, function(t){ var a = ma[t * 4 + 3]; return a === 0 ? 0 : a === 255 ? 1 : -1; });
    var box = { x: 30, y: 64, w: 110, h: 100 };
    out.confined[k + "@limit"] = confinedBy(k, { scope: { rect: box } }, function(t){
      var x = t % N, y = (t - x) / N;
      return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h ? 1 : 0;
    });
  });

  // an effect at rest inside a group changes nothing — not the colour, and not the group's coverage:
  // a 70 % paint layer stays 70 %, where drawing the adjusted copy over it would make it 91 %
  var atRest = function(hide){
    var s = mkSlot(), c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "rgba(200,60,40,.7)"; g.fillRect(20, 70, 140, 90);
    var E = fxLayer({ type: "levels", rgb: Effect.lv() }, "color");
    if (hide) E.visible = false;
    s.layers = [{ type: "group", name: "g", visible: true, opacity: 1, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g91r",
                  children: [LayerNode.of({ type: "paint", name: "p", canvas: c, visible: true, opacity: 1, blend: "normal" }), E] }];
    compositeSlot(s, null);
    return data(s.composite);
  };
  out.rest = worstOf(atRest(false), atRest(true));

  // ---- 2. the GPU pass against the CPU pass, texel by texel ----
  var F = Composite.fxGL, src = sheet(), into = { canvas: src, g: ctx2d(src) }, gcx = { tw: N, th: N };
  F.init();
  out.gl = { active: !!F.st && !F.dead, shared: !!(Composite.toneGL.init() && F.st && Composite.toneGL.st.C === F.st.C), cases: {} };
  Object.keys(KINDS).forEach(function(k){
    var T = Effect.table({ fx: KINDS[k] });
    var gpu = F.draw(gcx, into, T);
    var g = gpu ? data(gpu).slice() : null;
    var c = data(Composite.fxCPU(gcx, into, T)).slice();
    var e = g ? worstOf(g, c) : { worst: -1, differ: -1 };
    e.moved = worstOf(c, data(src)).differ;
    out.gl.cases[k] = e;
  });

  // ---- 2b. the CPU pass inside a composite, and a pass-through group's opacity ----
  // What runs where WebGL is missing or refuses: the effect pass forced off, the way a program the
  // driver will not build leaves it. Its result has to be OPAQUE before it lands source-atop, as the
  // GPU's is, or over a group's 70 % paint the effect reaches only 70 % of its strength — which the
  // opaque source above cannot show. Held to the GPU composite on every texel; \`calls\` proves which
  // pass each one ran.
  var calls = 0, fxCPU0 = Composite.fxCPU;
  Composite.fxCPU = function(){ calls++; return fxCPU0.apply(Composite, arguments); };
  var onCPU = function(fn){ var F = Composite.fxGL, was = F.dead; F.dead = true; try { return fn(); } finally { F.dead = was; } };
  var inGroup = function(k){
    var s = mkSlot();
    s.layers = [{ type: "group", name: "g", visible: true, opacity: 1, blend: "normal", mask: null, parts: null, collapsed: false, uid: "g91c",
                  children: k ? [paintUnder("color"), fxLayer(KINDS[k], "color")] : [paintUnder("color")] }];
    compositeSlot(s, null);
    return data(s.composite);
  };
  out.cpu = { cases: {} };
  try {
    var bare = inGroup(null);
    Object.keys(KINDS).forEach(function(k){
      calls = 0; var g = inGroup(k), gCalls = calls;
      calls = 0; var c = onCPU(function(){ return inGroup(k); }), cCalls = calls;
      var e = worstOf(g, c);
      e.moved = worstOf(c, bare).differ; e.gpuCalls = gCalls; e.cpuCalls = cCalls;
      out.cpu.cases[k] = e;
    });
    // A pass-through group hands its opacity down (\`Composite.ambAlpha\`): an effect inside one at
    // 50 % is exactly the same effect at 50 % with no group — on either pass.
    var passThrough = function(viaGroup){
      var s = mkSlot();
      s.layers = viaGroup
        ? [paintUnder("color"), { type: "group", name: "pt", visible: true, opacity: .5, blend: "pass through", mask: null, parts: null, collapsed: false, uid: "g91h",
                                  children: [fxLayer(KINDS.levels, "color")] }]
        : [paintUnder("color"), fxLayer(KINDS.levels, "color", { opacity: .5 })];
      compositeSlot(s, null);
      return data(s.composite);
    };
    var flat = mkSlot(); flat.layers = [paintUnder("color")]; compositeSlot(flat, null);
    var ptG = passThrough(true);
    out.cpu.pass = worstOf(ptG, passThrough(false));
    out.cpu.pass.cpu = worstOf(onCPU(function(){ return passThrough(true); }), ptG).worst;
    out.cpu.pass.moved = worstOf(ptG, data(flat.composite)).differ;
    out.cpu.pass.full = worstOf(ptG, (function(){ var s = mkSlot(); s.layers = [paintUnder("color"), fxLayer(KINDS.levels, "color")]; compositeSlot(s, null); return data(s.composite); })()).differ;
  } finally { Composite.fxCPU = fxCPU0; }

  // ---- 3. the composite IS the table, and a fade is the mean ----
  out.exact = {};
  ["levels", "balance", "gradmap", "threshold"].forEach(function(k){
    var s = mkSlot(); s.layers = [fxLayer(KINDS[k], "color")];
    compositeSlot(s, null);
    var want = Effect.apply(Effect.table({ fx: KINDS[k] }), new Uint8ClampedArray(data(s.baseC)));
    out.exact[k] = worstOf(data(s.composite), want);
    var h = mkSlot(); h.layers = [fxLayer(KINDS[k], "color", { opacity: .5 })];
    compositeSlot(h, null);
    var base = data(h.baseC), got = data(h.composite), w = 0;
    for (var i = 0; i < got.length; i += 4) for (var j = 0; j < 3; j++) w = Math.max(w, Math.abs(got[i + j] - (base[i + j] + want[i + j]) / 2));
    out.exact[k].half = w;
  });

  // ---- 4. the four numbers still draw the CSS filter they always did ----
  var hs = mkSlot(); hs.layers = [LayerNode.of({ type: "adjust", name: "Warm", visible: true, opacity: 1, blend: "normal", hue: 25, sat: 140, bright: 90, contrast: 120 })];
  compositeSlot(hs, null);
  var ref = mkCanvas(N, N), rg = ctx2d(ref);
  rg.drawImage(hs.baseC, 0, 0);
  rg.filter = "hue-rotate(25deg) saturate(140%) brightness(90%) contrast(120%)"; rg.drawImage(hs.baseC, 0, 0); rg.filter = "none";
  out.hsbc = worstOf(data(hs.composite), data(ref));
  out.hsbc.moved = worstOf(data(hs.composite), data(hs.baseC)).differ;

  // ---- 5. save / load, duplicate, a kind from a newer build ----
  var ctx = { put: async function(){ return "x"; }, img: async function(){ return null; } };
  var L = fxLayer(KINDS.levels, "color", { hue: 30, sat: 150 });
  var saved = await ProjNode.save(L, ctx);
  var back = await ProjNode.load(saved, ctx);
  var sc = saved.chans.color;
  out.save = { fx: sc.fx, rest: [sc.hue, sc.sat, sc.bright, sc.contrast], back: back.fx, kind: LayerNode.contentOn(back, "color").kind };
  var ds = mkSlot(); ds.layers = [L];
  duplicateLayer(ds, L);
  var dup = ds.layers.filter(function(x){ return x !== L; })[0];
  out.dup = { has: !!(dup && dup.fx), shared: !!(dup && dup.fx === L.fx), deep: !!(dup && dup.fx && dup.fx.rgb === L.fx.rgb) };
  var U = fxLayer({ type: "blur", radius: 3 }, "color");
  var ub = await ProjNode.load(await ProjNode.save(U, ctx), ctx);
  var us = mkSlot(); us.layers = [ub]; compositeSlot(us, null);
  out.unknown = { kept: JSON.stringify(ub.fx), drawn: worstOf(data(us.composite), data(us.baseC)).worst };

  // ---- 6. the panel ----
  var ps = mkSlot("t92p"), P1 = fxLayer(null, "color");
  delete LayerNode.contentOn(P1, "color").fx;
  ps.layers = [P1];
  // a linked sibling on another texture: every edit has to reach it as well (\`FxUI.put\` through
  // \`onChan\`), each with a record of its own
  var qs = mkSlot("t92q"), Q1 = fxLayer(null, "color");
  delete LayerNode.contentOn(Q1, "color").fx;
  qs.layers = [Q1];
  P1.link = Q1.link = "t92link";
  App.slots.set("t92p", ps); App.slots.set("t92q", qs);
  var wasSlot = App.activeSlot, wasLayer = App.activeLayer;
  App.activeSlot = ps; App.activeLayer = P1;
  refreshLayerList();
  var C1 = LayerNode.contentOn(P1, "color"), CQ = LayerNode.contentOn(Q1, "color");
  var nums = function(c){ return [c.hue, c.sat, c.bright, c.contrast].join(); };
  var sibs = [];
  var sib = function(at){
    sibs.push({ at: at, same: JSON.stringify(CQ.fx || null) === JSON.stringify(C1.fx || null) && nums(CQ) === nums(C1),
                own: !C1.fx || CQ.fx !== C1.fx });
  };
  var rowOf = function(label, what){
    var rows = document.querySelectorAll("#layerProps .row");
    for (var i = 0; i < rows.length; i++) { var lb = rows[i].querySelector("label"); if (lb && lb.textContent === label) return rows[i].querySelector(what); }
    return null;
  };
  var effectSelect = function(){ return rowOf("Effect", "select"); };
  var rowInput = function(label){ return rowOf(label, "input"); };
  var slide = function(inp, v){ inp.value = String(v); inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); };
  var sel = effectSelect();
  out.panel = { options: sel ? Array.prototype.map.call(sel.options, function(o){ return o.value; }).join() : null, initial: sel && sel.value,
                family: layerFamily(P1).length };
  // a hue shift from before the kind moved: choosing Levels sets the four numbers to rest, as the
  // file has always stored them beside a record, and undo brings the shift back
  C1.hue = CQ.hue = 30; C1.sat = CQ.sat = 150;
  sel.value = "levels"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  out.panel.after = P1.fx && P1.fx.type;
  out.panel.numsAfter = nums(C1);
  sib("levels chosen");
  doUndo();
  out.panel.undone = P1.fx ? P1.fx.type : "none";
  out.panel.numsUndone = nums(C1);
  sib("levels undone");
  doRedo();
  out.panel.redone = P1.fx && P1.fx.type;
  out.panel.numsRedone = nums(C1);
  var inLo = rowInput("In black");
  out.panel.hasInBlack = !!inLo;
  if (inLo) {
    slide(inLo, 40);
    out.panel.inLo = P1.fx.rgb.inLo;
    sib("in black slid");
    doUndo();
    out.panel.inLoUndone = P1.fx.rgb.inLo;
    sib("in black undone");
  }
  // a channel's first edit, undone, leaves the record as it was — not an identity the Channel select
  // goes on calling "adjusted"
  var subWas = FxUI.sub;
  FxUI.sub = "g"; refreshLayerProps();
  var recWas = JSON.stringify(P1.fx), outHi = rowInput("Out white");
  out.panel.chan = { has: !!outHi };
  if (outHi) {
    slide(outHi, 180);
    out.panel.chan.set = P1.fx.g ? P1.fx.g.outHi : null;
    refreshLayerProps();                     // the marks are written when the rows are built; a drag leaves the rows alone
    var chanSel = rowOf("Channel", "select");
    out.panel.chan.labelSet = chanSel ? chanSel.options[2].textContent : null;
    doUndo();
    out.panel.chan.same = JSON.stringify(P1.fx) === recWas;
    chanSel = rowOf("Channel", "select");
    out.panel.chan.labels = chanSel ? Array.prototype.map.call(chanSel.options, function(o){ return o.textContent; }).join("|") : null;
    sib("channel undone");
  }
  FxUI.sub = subWas; refreshLayerProps();
  // the Curves box, driven by pointer: the Textures tab is shown so the box is laid out
  var tabWas = App.leftTab;
  showTab("paint");
  sel = effectSelect();
  sel.value = "curves"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  // the box as the panel has it NOW: an undo or a redo rebuilds the panel, and an event sent to the
  // canvas it replaced would land on a detached element with no size
  var box = function(){ return document.querySelector("#layerProps canvas"); };
  var cv = box();
  out.curve = { box: !!cv };
  if (cv) {
    var rc = cv.getBoundingClientRect();
    out.curve.size = [Math.round(rc.width), Math.round(rc.height)];
    var ptr = function(type, fx, fy){
      var c = box(), b = c.getBoundingClientRect();
      var o = { clientX: b.left + fx * b.width, clientY: b.top + fy * b.height, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", bubbles: true };
      c.dispatchEvent(type === "dblclick" ? new MouseEvent(type, o) : new PointerEvent(type, o));
    };
    var pts = function(){ return JSON.stringify(P1.fx.rgb); };
    ptr("pointerdown", .25, .4); ptr("pointermove", .3, .3); ptr("pointerup", .3, .3);
    out.curve.added = pts();
    sib("curve point added");
    doUndo(); out.curve.undone = pts(); doRedo();
    ptr("pointerdown", .3, .3); ptr("pointermove", 1.5, .3); ptr("pointerup", 1.5, .3);
    out.curve.draggedOut = pts();
    doUndo();
    // a double-click as the browser sends one — press, release, press, release, dblclick — on the
    // point: it goes, in one step
    var dbl = function(fx, fy){ ptr("pointerdown", fx, fy); ptr("pointerup", fx, fy); ptr("pointerdown", fx, fy); ptr("pointerup", fx, fy); ptr("dblclick", fx, fy); };
    var depth = App.undoStack.length;
    dbl(.3, .3);
    out.curve.dblclicked = pts(); out.curve.dblSteps = App.undoStack.length - depth;
    // ...and on empty space, where its first press put a point down: a click, and the point stays,
    // in one step — not added and taken away again as two
    depth = App.undoStack.length;
    dbl(.6, .8);
    out.curve.dblEmpty = pts(); out.curve.dblEmptySteps = App.undoStack.length - depth;
    sib("double-clicked");
  }
  // back to the four numbers: at rest, the answer a save and reload in between gives too
  sel = effectSelect();
  sel.value = "hsbc"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  out.panel.numsBack = [P1.fx ? P1.fx.type : "none", nums(C1)];
  sib("four numbers chosen again");
  doUndo();
  out.panel.sibs = sibs;
  showTab(tabWas || "vehicle");
  // on a smoothness layer the colour-only kinds are not offered
  var P2 = fxLayer(null, "smooth"); delete LayerNode.contentOn(P2, "smooth").fx;
  ps.layers = [P1, P2]; App.activeLayer = P2;
  refreshLayerList();
  var sel2 = effectSelect();
  out.panel.grey = sel2 ? Array.prototype.map.call(sel2.options, function(o){ return o.value; }).join() : null;
  // the thumbnail: the base through the kind's own table
  P1.fx = { type: "invert" };
  P1._thumb = null;
  var th = layerThumb(P1, ps);
  var tb = mkCanvas(26, 26); ctx2d(tb).drawImage(ps.baseC, 0, 0, 26, 26);
  var want = Effect.apply(Effect.table({ fx: { type: "invert" } }), new Uint8ClampedArray(data(tb)));
  out.thumb = worstOf(data(th), want);
  App.slots.delete("t92p"); App.slots.delete("t92q");
  App.activeSlot = wasSlot; App.activeLayer = wasLayer;
  refreshLayerList();
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== a dirty-rectangle composite equals the whole-sheet one ===");
for (const [k, e] of Object.entries(r.region)) {
  console.log(`   ${k.padEnd(18)} worst ${e.worst} over ${e.differ} bytes · the effect changed ${e.moved} bytes of the region`);
  R.is(e.worst === 0 && e.moved > 1000, `${k}: the region is byte-identical to the whole sheet, and the effect really changed it`);
}

R.is(r.rest.worst <= 1, `an effect at rest inside a group changes nothing, not even the group's coverage — a 70 % layer stays 70 % (worst ${r.rest.worst} over ${r.rest.differ} bytes)`);

console.log("\n=== a mask and a Limit confine the effect ===");
for (const [k, e] of Object.entries(r.confined)) {
  console.log(`   ${k.padEnd(14)} ${e.off} texels outside: worst ${e.offWorst} · ${e.on} texels inside: worst ${e.onWorst} · the effect moves ${e.moved} bytes`);
  R.is(e.off > 5000 && e.offWorst === 0, `${k}: where it hides the effect, every texel is exactly the stack beneath (${e.off} texels, worst ${e.offWorst})`);
  R.is(e.on > 5000 && e.onWorst === 0 && e.moved > 10000, `${k}: where it shows it in full, every texel is exactly the table's (${e.on} texels, worst ${e.onWorst})`);
}

console.log("\n=== the GPU pass against the CPU pass ===");
for (const [k, e] of Object.entries(r.gl.cases)) console.log(`   ${k.padEnd(10)} worst ${e.worst} · ${e.differ} byte(s) differ · the pass changed ${e.moved}`);
R.is(r.gl.active, "the GPU pass is the one running here — or every check above tested only the fallback");
R.is(r.gl.shared, "blend-if and the effects share one GL context — one copy of the largest region, not two");
R.is(Object.values(r.gl.cases).every(e => e.worst === 0), "on every texel of every kind the two passes agree exactly");
R.is(Object.values(r.gl.cases).every(e => e.moved > 10000), "…and every kind changed most of the sheet, or agreeing would prove nothing");
for (const [k, e] of Object.entries(r.cpu.cases)) console.log(`   ${(k + "@group").padEnd(16)} forced CPU against GPU: worst ${e.worst} · ${e.differ} byte(s) differ · the effect moved ${e.moved} · passes run: GPU ${e.gpuCalls} CPU call(s), forced ${e.cpuCalls}`);
R.is(Object.values(r.cpu.cases).every(e => e.gpuCalls === 0 && e.cpuCalls > 0), "the forced composite ran the CPU pass and the other one did not");
R.is(Object.values(r.cpu.cases).every(e => e.worst === 0 && e.moved > 1000),
  "inside a group over 70 % paint, a composite on the CPU pass equals the one on the GPU pass, texel for texel, for every kind — the CPU result lands opaque, as the GPU's does");
R.is(r.cpu.pass.worst === 0 && r.cpu.pass.cpu === 0 && r.cpu.pass.moved > 1000 && r.cpu.pass.full > 1000,
  `an effect inside a pass-through group at 50 % is exactly that effect at 50 % with no group, on either pass (worst ${r.cpu.pass.worst}, CPU ${r.cpu.pass.cpu}; ${r.cpu.pass.full} bytes short of full strength)`);

console.log("\n=== the composite is the table ===");
// The fade is the canvas's own source-over at globalAlpha .5, which rounds in its premultiplied
// arithmetic: measured 2026-09-26, 1 level off the exact mean where sheet and table are close and
// 1.5 where they are 255 apart (threshold's black against white). Two levels is that rounding; a
// fade that was not a cross-fade at all — the table alone, or the sheet alone — is off by up to 127.
for (const [k, e] of Object.entries(r.exact)) {
  R.is(e.worst === 0, `${k} at full opacity: the sheet is exactly what Effect.apply says (worst ${e.worst})`);
  R.is(e.half <= 2, `${k} at half opacity: the mean of the sheet and the table, to the canvas's own blend rounding (worst ${e.half})`);
}
R.is(r.hsbc.worst === 0 && r.hsbc.moved > 10000, `the four numbers still draw exactly the CSS filter they always did (worst ${r.hsbc.worst})`);

console.log("\n=== save, load, duplicate ===");
R.is(JSON.stringify(r.save.fx) === JSON.stringify(r.save.back) && r.save.back && r.save.back.type === "levels" && r.save.back.r && r.save.back.rgb.gamma === 1.6 && r.save.kind === "effect",
  "a Levels record survives save and load whole — channel levels included (the format stays at version 5)");
R.is(r.save.rest.join() === "0,100,100,100", `…with the four numbers written at rest beside it, so an older build draws no effect instead of a stale hue shift (${r.save.rest.join(", ")})`);
R.is(r.dup.has && !r.dup.shared && !r.dup.deep, "a duplicate gets a record of its own, not a shared one");
R.is(r.unknown.kept === JSON.stringify({ type: "blur", radius: 3 }) && r.unknown.drawn === 0, "a kind from a newer build survives the trip verbatim and draws nothing");

console.log("\n=== the panel ===");
R.is(r.panel.options === "hsbc,levels,curves,balance,gradmap,invert,threshold,posterize" && r.panel.initial === "hsbc",
  `the Effect select lists every kind, starting at the four numbers (${r.panel.options})`);
R.is(r.panel.after === "levels" && r.panel.undone === "none" && r.panel.redone === "levels", "choosing Levels is one undo step, both ways");
R.is(r.panel.numsAfter === "0,100,100,100" && r.panel.numsUndone === "30,150,100,100" && r.panel.numsRedone === "0,100,100,100",
  `…the four numbers go to rest with it, as the file stores them, and undo brings the hue shift back (${r.panel.numsAfter} → undo → ${r.panel.numsUndone})`);
R.is(r.panel.numsBack[0] === "none" && r.panel.numsBack[1] === "0,100,100,100",
  `choosing the four numbers again starts them at rest — the same answer a save and reload in between gives (${r.panel.numsBack[1]})`);
R.is(r.panel.hasInBlack && r.panel.inLo === 40 && r.panel.inLoUndone === 0, "a Levels slider changes its one number, and one undo puts it back");
const ch = r.panel.chan || {};
R.is(ch.has && ch.set === 180 && /\(adjusted\)$/.test(ch.labelSet || ""), `a channel's own Levels is set by its slider, and the Channel select marks it (${ch.labelSet})`);
R.is(ch.same && ch.labels === "all channels|red|green|blue",
  `undoing a channel's first edit leaves the record exactly as it was, with no do-nothing channel for the select to call adjusted (${ch.labels})`);
R.is(r.panel.family === 2 && r.panel.sibs.length >= 8 && r.panel.sibs.every(s => s.same && s.own),
  `every edit reaches the linked sibling on the other texture, as a record of its own — ${r.panel.sibs.filter(s => !(s.same && s.own)).map(s => s.at).join(", ") || r.panel.sibs.length + " checkpoints"}`);
const cu = r.curve || {};
R.is(cu.box && cu.size && cu.size[0] > 100 && cu.size[0] === cu.size[1], `choosing Curves shows the box, square and laid out (${cu.size})`);
R.is(cu.added === "[[0,0],[77,179],[255,255]]" && cu.undone === "[[0,0],[255,255]]",
  `a click in the box adds a point where it lands and a drag carries it, in one undo step (${cu.added} → undo → ${cu.undone})`);
R.is(cu.draggedOut === "[[0,0],[255,255]]", `a point dragged well out of the box goes when it is let go (${cu.draggedOut})`);
R.is(cu.dblclicked === "[[0,0],[255,255]]" && cu.dblSteps === 1, `…and so does one double-clicked, in one step (${cu.dblclicked}, ${cu.dblSteps} step)`);
R.is(cu.dblEmpty === "[[0,0],[153,51],[255,255]]" && cu.dblEmptySteps === 1,
  `a double-click on empty space is a click: the point its first press put down stays, in one step — not added and removed as two (${cu.dblEmpty}, ${cu.dblEmptySteps} step)`);
R.is(r.panel.grey === "hsbc,levels,curves,invert,threshold,posterize", `on a smoothness layer the colour-only kinds are not offered (${r.panel.grey})`);
R.is(r.thumb.worst === 0, `the layer's thumbnail is the base through the kind's own table (worst ${r.thumb.worst})`);

const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors or rejections during the run:\n        " + errs.join("\n        ") : "no uncaught errors or unhandled rejections during the run");
R.finish();
