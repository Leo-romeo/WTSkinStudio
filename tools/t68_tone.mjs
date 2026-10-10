// Blend-if: a layer shown by what lies beneath it (ROADMAP 4.44, third candidate).
//
// WHY THIS EXISTS. Photoshop's "Blend If: underlying layer" and Substance's "mask by colour" —
// weathering that follows the panel lines already in the game's albedo, which 4.36's texture… mask
// approximated with a whole sheet and no curve. It is a stencil the compositor reads off what the
// stack has built so far, so the properties held here are about the WALK, in the real page:
//
//   * a white fill over a black→white ramp with a band [60 %, 100 %] shows on the light end only,
//     with a hard cut at 60 %; inverted, on the dark end only; softened, with a ramp of the width
//     asked for and full alpha in the middle of the band;
//   * "near a colour" shows over the patch of that colour and not over another;
//   * it multiplies with a painted mask — black mask, band matching: nothing shows;
//   * a group's tone applies to the group's flattened result, read off the sheet beneath the GROUP;
//   * the dirty-rectangle path gives the same texels as the whole-sheet path over the rectangle
//     (t52's oracle, for the one stencil that reads the sheet it is drawn into);
//   * it survives a save / load (six numbers, version 5 unchanged) and a duplicate.
//
// Usage: node tools/t68_tone.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  // the base: a black→white ramp along x, with a red square top-left and a blue one top-right
  var ramp = function(){
    var c = mkCanvas(N, N), g = ctx2d(c);
    var gr = g.createLinearGradient(0, 0, N, 0); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#fff");
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    g.fillStyle = "#ff0000"; g.fillRect(16, 16, 48, 48);
    g.fillStyle = "#0000ff"; g.fillRect(192, 16, 48, 48);
    return c;
  };
  var mkSlot = function(id){
    var s = { id: id, size: N, nSize: N, layers: [], missing: false };
    s.baseC = ramp(); s.composite = ramp();
    return s;
  };
  var s = mkSlot("t68");
  var fill = LayerNode.of({ type: "fill", name: "white", color: "#ffffff", visible: true, opacity: 1, blend: "normal" });
  s.layers = [fill];
  App.slots.set("t68", s);
  var was = App.activeSlot; App.activeSlot = s; App.activeLayer = fill;
  var comp = function(){ compositeSlot(s); flushComposites(); return s.composite; };
  var lum = function(x){ return px(s.composite, x, 128)[0]; };       // the ramp row: grey, so R is the luminance

  // ---- 1. a band on the tone beneath ----
  comp();
  out.plain = { left: lum(20), right: lum(236) };                     // no tone: white everywhere
  fill.tone = { src: "lum", lo: .6, hi: 1, soft: 0, invert: false };
  comp();
  out.band = { at20: lum(20), at140: lum(140), at160: lum(160), at236: lum(236) };   // 60 % of 256 ≈ x 153
  fill.tone.invert = true; comp();
  out.inv = { at20: lum(20), at236: lum(236) };
  fill.tone = { src: "lum", lo: .6, hi: 1, soft: .2, invert: false }; comp();
  // the ramp runs from 40 % (lo − soft) to 60 % (lo): x ≈ 102 … 153
  out.soft = { at80: lum(80), at128: lum(128), at180: lum(180), base128: px(s.baseC, 128, 128)[0] };

  // ---- 2. near a colour ----
  fill.tone = { src: "color", color: "#ff0000", lo: .8, hi: 1, soft: 0, invert: false }; comp();
  out.colour = { red: px(s.composite, 40, 40), blue: px(s.composite, 216, 40), grey: px(s.composite, 128, 128) };

  // ---- 3. with a painted mask: both have to agree ----
  fill.tone = { src: "lum", lo: .6, hi: 1, soft: 0, invert: false };
  fill.mask = mkCanvas(N, N);                                          // transparent = hides everything
  comp();
  out.masked = { at236: lum(236) };
  fill.mask = null;

  // ---- 4. a group's tone reads the sheet beneath the group ----
  var G = { type: "group", name: "g", visible: true, opacity: 1, blend: "normal", children: [fill], mask: null, tone: { src: "lum", lo: .6, hi: 1, soft: 0, invert: false }, uid: LayerNode.newUid() };
  fill.tone = null;
  s.layers = [G]; comp();
  out.group = { at20: lum(20), at236: lum(236) };
  s.layers = [fill];

  // ---- 5. the region path equals the whole-sheet path ----
  fill.tone = { src: "lum", lo: .3, hi: .7, soft: .1, invert: false };
  comp();
  var whole = ctx2d(s.composite).getImageData(60, 100, 120, 40).data;
  // dirty a rectangle inside the band's ramp and composite just that
  ctx2d(s.composite).fillStyle = "#123456"; ctx2d(s.composite).fillRect(60, 100, 120, 40);
  Composite.sheet(s, "color", { x: 60, y: 100, w: 120, h: 40 }); flushComposites();
  var part = ctx2d(s.composite).getImageData(60, 100, 120, 40).data;
  var worst = 0; for (var i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - part[i]));
  out.region = { worst: worst };

  // ---- 6. save / load, and duplicate ----
  var ctx = { put: async function(){ return "x"; }, img: async function(){ return null; } };
  var saved = await ProjNode.save(fill, ctx);
  var back = await ProjNode.load(saved, ctx);
  out.roundTrip = { saved: saved.tone, back: back.tone };
  duplicateLayer(s, fill);
  out.dup = s.layers.filter(function(l){ return l !== fill; }).map(function(l){ return l.tone; });
  App.activeSlot = was; App.slots.delete("t68");

  // ---- the GPU pass against the CPU pass, texel by texel (2026-09-24) ----
  // Everything above ran on whichever pass the page picked — the GPU one, wherever WebGL exists.
  // This holds the two to each other: a source with EVERY grey level along x (so every hard edge has
  // texels exactly on it), colour patches, and seeded noise, through hard, soft, inverted and colour
  // bands. A hard edge must agree on every texel; a soft ramp to one level of alpha.
  var gsrc = mkCanvas(N, N), gg = ctx2d(gsrc);
  for (var gx = 0; gx < N; gx++) { gg.fillStyle = "rgb(" + gx + "," + gx + "," + gx + ")"; gg.fillRect(gx, 0, 1, N / 2); }
  var seed = 7;
  for (var by = N / 2; by < N; by += 4) for (var bx = 0; bx < N; bx += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; var q = seed;
    gg.fillStyle = "rgb(" + (q & 255) + "," + ((q >> 8) & 255) + "," + ((q >> 16) & 255) + ")"; gg.fillRect(bx, by, 4, 4);
  }
  gg.fillStyle = "#ff0000"; gg.fillRect(8, N / 2 + 8, 24, 24);
  gg.fillStyle = "#3070c0"; gg.fillRect(40, N / 2 + 8, 24, 24);
  var into = { canvas: gsrc, g: gg }, gcx = { tw: N, th: N };
  var alphaOf = function(c){ var d = ctx2d(c).getImageData(0, 0, N, N).data, a = new Uint8Array(N * N); for (var i = 0; i < N * N; i++) a[i] = d[i * 4 + 3]; return a; };
  var TG = Composite.toneGL;
  TG.init();
  out.gl = { active: !!TG.st && !TG.dead, cases: [] };
  [{ name: "lum 60-100 hard", t: { src: "lum", lo: .6, hi: 1, soft: 0 } },
   { name: "lum 20-70 soft .15", t: { src: "lum", lo: .2, hi: .7, soft: .15 } },
   { name: "lum 30-80 hard inverted", t: { src: "lum", lo: .3, hi: .8, soft: 0, invert: true } },
   { name: "lum on 153/255 exactly", t: { src: "lum", lo: 153 / 255, hi: 200 / 255, soft: 0 } },
   { name: "near red 80-100 hard", t: { src: "color", color: "#ff0000", lo: .8, hi: 1, soft: 0 } },
   { name: "near #3070c0 60-95 soft .1", t: { src: "color", color: "#3070c0", lo: .6, hi: .95, soft: .1 } }].forEach(function(C){
    var g = alphaOf(Composite.tone(gcx, into, C.t));
    var keep = { st: TG.st, dead: TG.dead };
    TG.st = null; TG.dead = true;                                  // the CPU pass, forced
    var c = alphaOf(Composite.tone(gcx, into, C.t));
    TG.st = keep.st; TG.dead = keep.dead;
    var worst = 0, diff = 0, shown = 0;
    for (var i = 0; i < N * N; i++) { var e = Math.abs(g[i] - c[i]); if (e) diff++; if (e > worst) worst = e; if (c[i]) shown++; }
    out.gl.cases.push({ name: C.name, hard: !C.t.soft, worst: worst, diff: diff, shown: shown });
  });
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(r.plain.left === 255 && r.plain.right === 255, "without a tone the white fill covers the ramp end to end");
R.is(r.band.at20 < 40 && r.band.at140 < 160 && r.band.at160 === 255 && r.band.at236 === 255,
  `a band of 60–100 % shows the fill on the light end only, with a hard cut: ${r.band.at20} / ${r.band.at140} at 55 %, ${r.band.at160} at 63 % / ${r.band.at236}`);
R.is(r.inv.at20 === 255 && r.inv.at236 > 220 && r.inv.at236 < 255, `inverted, the dark end shows the fill and the light end shows the ramp: ${r.inv.at20} / ${r.inv.at236}`);
R.is(Math.abs(r.soft.at80 - 80) < 6, `softened over 20 %, below the ramp the base shows (${r.soft.at80} at x = 80, 31 % grey)`);
R.is(r.soft.at128 > r.soft.base128 + 20 && r.soft.at128 < 255, `…halfway up the ramp the fill is partly there (${r.soft.at128} over a base of ${r.soft.base128})`);
R.is(r.soft.at180 === 255, `…and past it the fill is whole (${r.soft.at180})`);
R.is(r.colour.red[0] === 255 && r.colour.red[1] === 255 && r.colour.blue[2] === 255 && r.colour.blue[0] === 0 && r.colour.grey[0] === 128,
  `near red at 80 %: the red patch is covered, the blue one is not, the grey ramp is not (${r.colour.red.slice(0, 3)} / ${r.colour.blue.slice(0, 3)} / ${r.colour.grey.slice(0, 3)})`);
R.is(r.masked.at236 > 200 && r.masked.at236 < 255,
  `with a black mask on top of a matching band nothing shows — both have to agree: ${r.masked.at236} (the ramp's own value)`);
R.is(r.group.at20 < 40 && r.group.at236 === 255, `a group's tone reads the sheet beneath the group: ${r.group.at20} / ${r.group.at236}`);
R.is(r.region.worst <= 1, `the dirty-rectangle path matches the whole-sheet path over the rectangle (worst channel difference ${r.region.worst})`);
R.is(r.roundTrip.saved && r.roundTrip.back && JSON.stringify(r.roundTrip.saved) === JSON.stringify(r.roundTrip.back) && r.roundTrip.back.lo === .3,
  "a tone survives save and load as six numbers (the format stays at version 5)");
R.is(r.dup.length === 1 && r.dup[0] && r.dup[0].lo === .3 && r.dup[0].hi === .7, "duplicating the layer copies its tone");

console.log("\n=== the GPU pass against the CPU pass ===");
const GL = r.gl || { cases: [] };
for (const c of GL.cases) console.log(`   ${c.name.padEnd(28)} worst ${c.worst} · ${c.diff} texel(s) differ · ${c.shown} shown`);
R.is(GL.active, "the GPU pass is the one running here — or every check above tested only the fallback");
R.is(GL.cases.length === 6 && GL.cases.every(c => c.shown > 0 && c.shown < 256 * 256),
  "every case shows some texels and hides others, or agreeing would prove nothing");
R.is(GL.cases.filter(c => c.hard).every(c => c.worst === 0),
  "on a hard edge the two passes agree on every texel — including texels exactly on the threshold, which is what the integer luminance and the fround thresholds are for");
R.is(GL.cases.filter(c => !c.hard).every(c => c.worst <= 1),
  "on a soft ramp they agree to one level of alpha");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
