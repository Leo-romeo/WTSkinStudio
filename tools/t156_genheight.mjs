// A decal's height made from its own image, in the app (ROADMAP 4.19 (6)).
//
// WHY THIS EXISTS. The estimator is deliberately simple — the image's luma times its alpha,
// softened, stretched to the full range — and each step fails quietly: a map read without the alpha
// raises the transparent surround as a plinth; one not stretched leaves the Emboss weaker than it
// says; one not softened is a one-texel cliff the emboss reads as a line; and a panel that cannot
// tell a map it made from one the user loaded would overwrite the user's file when a slider moves.
//
//   Node, on the pure `/*==DECALSURF==*/` section:
//   * a white mark on transparent is 255 where it is opaque and 0 round it, its edge sloping over
//     about the softening; a light and a dark part of one opaque image are high and low; a flat
//     image, or a wholly transparent one, gives nothing;
//   * the range is stretched: the lowest texel is 0 and the highest 255;
//   * softening widens the slope and never moves a far-inside or far-outside texel.
//
//   Headless Chrome, on a real floating decal and a real projected one:
//   * *Generate from the image* gives the decal a map (named so, at most 1024 on its longer side),
//     the relief mode "map" and the softening kept on the Look; the normal it derives changes inside
//     the marking where the edge relief left it flat; the preview shows the map;
//   * the select's fourth line does the same, moving Soften remakes a generated map, Invert turns
//     it over, and none of it touches a map the user loaded;
//   * a flat image is refused in words, and nothing is written;
//   * a projected decal takes the map on its shared parameters.
//
// Usage: node tools/t156_genheight.mjs [--keep] [--chrome <path>]
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
const { Relief } = new Function(sectionOf("DECALSURF").replace(/^"use strict";$/m, "") + "\nreturn { Relief };")();
const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };
const row = (o, w, y) => Array.from({ length: w }, (_, x) => o[(y * w + x) * 4]);

console.log("=== the estimator ===");
{
  const W = 64, H = 32, mark = img(W, H, x => x >= 20 && x < 44 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const hard = Relief.generate(mark, W, H, 0), r0 = row(hard, W, 16);
  R.is(r0[30] === 255 && r0[10] === 0 && r0[19] === 0 && r0[20] === 255 && hard[3] === 255,
    `a white mark on transparent is 255 where it is opaque and 0 round it (${r0[10]} | ${r0[20]} … ${r0[30]}), and the map is opaque`);
  const soft = Relief.generate(mark, W, H, 3), r3 = row(soft, W, 16);
  const ramp = r3.filter((v, x) => x > 10 && x < 32 && v > 0 && v < 255).length;
  R.is(r3[32] === 255 && r3[4] === 0 && ramp >= 6 && r3.slice(14, 26).every((v, i, a) => !i || v >= a[i - 1]),
    `softened by 3 its edge slopes over ${ramp} texels, rising monotonically, and far inside and far outside are untouched (${r3[4]}, ${r3[32]})`);
  const two = img(W, H, x => x < W / 2 ? [200, 200, 200, 255] : [60, 60, 60, 255]), t2 = row(Relief.generate(two, W, H, 0), W, 5);
  R.is(t2[5] === 255 && t2[50] === 0, `in one opaque image the light part is high and the dark part low, stretched to the full range (${t2[5]} | ${t2[50]})`);
  const mid = img(W, H, x => x < W / 2 ? [140, 140, 140, 255] : [110, 110, 110, 255]), tm = row(Relief.generate(mid, W, H, 0), W, 5);
  R.is(tm[5] === 255 && tm[50] === 0, `a faint difference is stretched too — 140 against 110 is 255 against 0 — so the Look's Emboss alone sets the strength`);
  const blk = row(Relief.generate(img(W, H, x => x >= 20 && x < 44 ? [0, 0, 0, 255] : [0, 0, 0, 0]), W, H, 0), W, 16);
  R.is(blk[30] === 255 && blk[10] === 0, `black ink on transparent stands above the surface too (${blk[10]} | ${blk[30]}) — luma × alpha alone put it level with the surround (review, 2026-10-23)`);
  const small = Relief.generate(img(16, 16, (x, y) => x > 3 && x < 12 && y > 3 && y < 12 ? [255, 255, 255, 255] : [0, 0, 0, 0]), 16, 16, 16);
  R.is(small !== null && small[(8 * 16 + 8) * 4] > small[0], "a 16² mark at Soften 16 still has a height — the softening is held to a quarter of the shorter side");
  R.is(Relief.genOf({ heightGen: 3 }) === 3 && Relief.genOf({ heightGen: "3" }) === null && Relief.genOf({ heightGen: 1e9 }) === null && Relief.genOf({}) === null,
    "only a number in Soften's range marks a map as generated");
  R.is(Relief.generate(img(W, H, () => [90, 120, 30, 255]), W, H, 2) === null && Relief.generate(img(W, H, () => [255, 255, 255, 0]), W, H, 2) === null,
    "a flat image, or a wholly transparent one, has no height to read: none is made");
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 128;
  var flat = function(hex){ var c = mkCanvas(N, N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var sheet = function(c){ return [].slice.call(ctx2d(c).getImageData(0, 0, c.width, c.height).data); };
  var was = { slot: App.activeSlot, layer: App.activeLayer };
  var S = { id: "t156", size: N, nSize: N, layers: [], missing: false, baseC: flat("#404040"), composite: flat("#404040"),
            smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
  App.slots.set(S.id, S); App.activeSlot = S;
  // A 48² decal: opaque white with a black bar across its middle — interior detail the edge relief
  // cannot see.
  var bmp = function(barred){ var c = mkCanvas(48, 48), g = ctx2d(c); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 48, 48); if (barred) { g.fillStyle = "#000000"; g.fillRect(0, 20, 48, 8); } return c; };
  var decal = function(b){ return LayerNode.of({ type: "decal", name: "gen", bmp: b, x: .5, y: .5, scale: 1, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal",
                                                 surf: { sm: 0, mt: 0, em: 8, preset: "custom", relief: "edge" } }); };
  var normalOf = function(){ compositeChannels(S); return sheet(chanOut(S, "normal")); };
  var differ = function(a, b){ var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  // the normal at the bar's edge inside the marking: x 64 (the decal's centre), y 64 − 4 (the bar's top)
  var at = function(nm, x, y){ var k = (y * N + x) * 4; return [nm[k], nm[k + 1], nm[k + 2]]; };
  try {
  var d = decal(bmp(true));
  S.layers = [d]; App.activeLayer = d;
  applyDecalSurface(S, d);
  var edge = normalOf();
  ReliefUI.sync();
  document.getElementById("depthGenSoft").value = 2;
  document.getElementById("btnDepthGen").click();
  var gen = normalOf(), surf = surfOf(d);
  out.floating = { relief: surf.relief, gen: surf.heightGen, from: surf.heightFrom, name: d.heightName, size: d.heightMap && [d.heightMap.width, d.heightMap.height],
                   moved: differ(edge, gen), edgeBar: at(edge, 64, 59), genBar: at(gen, 64, 59), said: document.getElementById("status").textContent,
                   preview: (function(){ var p = document.getElementById("depthPreview"), dd = ctx2d(p).getImageData(0, 0, p.width, p.height).data, n = 0; for (var i = 0; i < dd.length; i += 4) if (dd[i] > 128) n++; return n; })(),
                   info: document.getElementById("depthInfo").textContent };
  var map1 = d.heightMap;
  var s1 = document.getElementById("depthGenSoft"); s1.value = 8; s1.dispatchEvent(new Event("change"));
  out.floating.resoft = { gen: surfOf(d).heightGen, newMap: d.heightMap !== map1 };
  var inv0 = normalOf();
  var cb = document.getElementById("reliefInvert"); cb.checked = true; cb.dispatchEvent(new Event("change"));
  out.floating.inverted = differ(inv0, normalOf()) > 50;
  // A map the user loaded is theirs: Soften leaves it alone.
  var loaded = mkCanvas(48, 48); ctx2d(loaded).fillStyle = "#808080"; ctx2d(loaded).fillRect(0, 0, 48, 48);
  ReliefUI.change(function(sf, t){ t.heightMap = loaded; t.heightName = "mine.png"; sf.relief = "map"; sf.heightFrom = "depth"; delete sf.heightGen; }, "decal depth map");
  s1.value = 3; s1.dispatchEvent(new Event("change"));
  out.floating.userKept = d.heightMap === loaded && d.heightName === "mine.png";
  // The select's fourth line generates as well.
  var sel = document.getElementById("reliefMode");
  sel.value = "gen"; sel.dispatchEvent(new Event("change"));
  out.floating.viaSelect = { name: d.heightName, relief: surfOf(d).relief, gen: surfOf(d).heightGen, shows: sel.value };
  // …and it is an undo step: the user's map comes back.
  doUndo(true);
  out.floating.undo = { name: d.heightName, map: d.heightMap === loaded, gen: surfOf(d).heightGen === undefined };
  doRedo(true);
  out.floating.redo = d.heightName === "generated from the image";
  // A generated map follows the image: when the bitmap changes it is made again from the new one.
  var oldMap = d.heightMap, nb = bmp(false); ctx2d(nb).fillStyle = "#000"; ctx2d(nb).fillRect(20, 0, 8, 48);
  LayerNode.contentOn(d, "color").bmp = nb;
  Relief.heightImage(d, surfOf(d));
  out.floating.follows = d.heightMap !== oldMap && d.heightMap._genOf === nb;

  // A Look read from a file: only a number in range survives as heightGen.
  out.crafted = [ProjNode.lookOf({ em: 4, heightGen: "<b>x</b>" }).heightGen, ProjNode.lookOf({ heightGen: 1e9 }).heightGen, ProjNode.lookOf({ heightGen: 3.4 }).heightGen];

  // A flat image: refused in words, nothing written.
  var f = decal(bmp(false));
  ctx2d(f.bmp).fillStyle = "#3060a0"; ctx2d(f.bmp).fillRect(0, 0, 48, 48);
  S.layers = [f]; App.activeLayer = f; applyDecalSurface(S, f); ReliefUI.sync();
  document.getElementById("btnDepthGen").click();
  out.flat = { map: !!f.heightMap, relief: surfOf(f).relief, said: document.getElementById("status").textContent };

  // A projected decal keeps its map on the shared parameters.
  out.proj = (function(){
    var P = { bmp: bmp(true), surf: { sm: 0, mt: 0, em: 8, preset: "custom", relief: "edge" } };
    var L = { type: "decal", name: "p", proj: P, visible: true };
    var t = ReliefUI.target(L);
    return { onParams: t === P };
  })();
  } catch (e) { out.__threw = String(e && e.stack || e); }
  finally { App.activeSlot = was.slot; App.activeLayer = was.layer; App.slots.delete("t156"); App.undoStack.length = 0; App.redoStack.length = 0; }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page ===");
const F = r.floating;
R.is(F.relief === "map" && F.gen === 2 && F.from === "depth" && F.name === "generated from the image" && F.size && F.size[0] === 48,
  `Generate from the image gives the decal a map (“${F.name}”, ${F.size}), relief "map", the softening kept on the Look (${F.gen})`);
R.is(F.moved > 100 && F.edgeBar.join() === "128,128,255" && F.genBar.join() !== "128,128,255",
  `the normal it derives tilts at the black bar inside the marking (${F.genBar}) where the edge relief left it flat (${F.edgeBar}) — ${F.moved} values moved`);
R.is(F.preview > 100 && /generated/.test(F.info), `the preview shows the map (${F.preview} light texels) and the info line says what it is (“${F.info}”)`);
R.is(/generated from the decal's own image/.test(F.said), `and the status line says what happened: “${F.said.slice(0, 90)}…”`);
R.is(F.resoft.gen === 8 && F.resoft.newMap && F.inverted, "moving Soften remakes a generated map, and Invert turns it over");
R.is(F.userKept, "a map the user loaded is left alone when Soften moves");
R.is(F.undo.name === "mine.png" && F.undo.map && F.undo.gen && F.redo, `generating over a loaded map is one undo step — the user's map, its name and the Look come back (“${F.undo.name}”), and redo generates again`);
R.is(F.follows, "a generated map is made again from the decal's new image when the image changes (a text re-edit, the decal editor's Use)");
R.is(F.viaSelect.name === "generated from the image" && F.viaSelect.relief === "map" && F.viaSelect.shows === "map",
  `the relief select's fourth line generates too, and then shows the mode it made (${F.viaSelect.shows})`);
R.is(!r.flat.map && r.flat.relief === "edge" && /one flat tone/.test(r.flat.said), `a flat image is refused in words and nothing is written: “${r.flat.said.slice(0, 80)}…”`);
R.is(r.crafted[0] == null && r.crafted[1] == null && r.crafted[2] === 3, `a project's Look keeps heightGen only as a number in Soften's range (${JSON.stringify(r.crafted)})`);
R.is(r.proj.onParams, "a projected decal's map goes on its shared parameters, as a loaded one does");

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
