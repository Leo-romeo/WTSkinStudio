// A .wtproj is refused before any of it is applied, and one file missing from it costs that file only.
//
// WHY THIS EXISTS. The scan of 2026-10-22 (ROADMAP 1.21 (3) and (4)), re-read at HEAD the same day:
//   (3) core/project.js promised that a project from a newer build is refused "instead of a partial
//       restore" — but the version gate sat in tryApplyProject, which runs AFTER loadProject had
//       already put the file's embedded model and textures into the app (`assets/`), reset the
//       cockpit body and rebuilt the scene. A too-new file replaced the open vehicle, then said no.
//   (4) the image reader handed to every layer called `zip.file(f).async(…)` with no null check, so
//       one image missing from the zip was a TypeError out of the whole load — while the reader's
//       own comment promised that a lost tile comes back as the flat fill its record describes.
// This drives the real loadProject in the page with zips built there:
//   A. version 99 with an embedded .obj and .dds: nothing of it is parsed or applied, and it says why;
//   B. version 5 whose first paint layer names an image the zip does not hold: the project loads,
//      both layers are there, the lost one is a blank sheet the size of the slot, the other has its
//      pixels, and the status line names what was missing.
//
// Usage: node tools/t145_projload.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 64;
  var why = function(e){ return String(e && e.name) + ": " + String(e && e.message); };
  var said = function(){ return document.getElementById("status").textContent; };
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t145", size: N, nSize: N, layers: [], missing: false };
  s.baseC = grey(); s.composite = grey();
  App.slots.set("t145", s);

  // ---- A. a project from a newer build, with embedded assets ----
  var calls = [], keep = { obj: parseOBJ, dds: parseDDSAsync, tga: TGA.parseTGA, rebuild: rebuildAll, reset: Cockpit.reset,
                            geom: App.geomData, raw: App.objRaw, name: App.objName };
  parseOBJ = function(){ calls.push("parseOBJ"); throw new Error("stub"); };
  parseDDSAsync = async function(){ calls.push("parseDDS"); throw new Error("stub"); };
  TGA.parseTGA = function(){ calls.push("parseTGA"); throw new Error("stub"); };
  rebuildAll = function(){ calls.push("rebuildAll"); };
  Cockpit.reset = function(){ calls.push("Cockpit.reset"); };
  try {
    var za = new JSZip();
    za.file("project.json", JSON.stringify({ app: "wt-skin-studio", version: 99, slots: [] }));
    za.file("assets/hull.obj", "v 0 0 0\\nv 1 0 0\\nv 0 1 0\\nf 1 2 3\\n");
    za.file("assets/hull_c.dds", new Uint8Array(256));
    za.file("assets/hull_n.tga", new Uint8Array(64));
    var ta = null;
    try { await loadProject(await za.generateAsync({ type: "uint8array" })); } catch (e) { ta = why(e); }
    out.A = { calls: calls.slice(), threw: ta, said: said(), pending: !!App.pendingProject,
              geomKept: App.geomData === keep.geom && App.objName === keep.name };
  } finally {
    parseOBJ = keep.obj; parseDDSAsync = keep.dds; TGA.parseTGA = keep.tga; rebuildAll = keep.rebuild; Cockpit.reset = keep.reset;
    App.geomData = keep.geom; App.objRaw = keep.raw; App.objName = keep.name; App.pendingProject = null;
  }

  // ---- B. one image missing from the zip ----
  var zb = new JSZip(), red = mkCanvas(N, N), rg = ctx2d(red);
  rg.fillStyle = "#ff0000"; rg.fillRect(0, 0, N, N);
  zb.file("here.png", await new Promise(function(r){ red.toBlob(r, "image/png"); }));
  var leaf = function(name, file){ return { name: name, visible: true, opacity: 1, blend: "normal", chans: { color: { kind: "paint", canvasFile: file } } }; };
  zb.file("project.json", JSON.stringify({ app: "wt-skin-studio", version: 5,
    slots: [{ id: "t145", layers: [leaf("lost", "gone.png"), leaf("kept", "here.png")] }] }));
  var tb = null;
  try { await loadProject(await zb.generateAsync({ type: "uint8array" })); } catch (e) { tb = why(e); }
  var cv = function(L){ var c = L && LayerNode.contentOn(L, "color"); return c && c.canvas; };
  var at = function(c){ return c ? Array.prototype.slice.call(ctx2d(c).getImageData(N / 2, N / 2, 1, 1).data) : null; };
  var lost = cv(s.layers[0]), kept = cv(s.layers[1]);
  out.B = { threw: tb, said: said(), n: s.layers.length, names: s.layers.map(function(L){ return L.name; }),
            lost: lost ? { w: lost.width, h: lost.height, px: at(lost) } : null, kept: kept ? at(kept) : null };
  App.slots.delete("t145");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 300), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = JSON.stringify;

console.log("=== A. a project from a newer build, with embedded assets ===");
R.is(!r.A.threw && r.A.calls.length === 0 && r.A.geomKept,
  `nothing of it is parsed or applied — no model, no texture, no rebuild, the open vehicle kept (${r.A.threw || J(r.A.calls)})`);
R.is(/newer build/.test(r.A.said) && /project version 99/.test(r.A.said) && !r.A.pending,
  `…and it says why: "${r.A.said.slice(0, 110)}"`);

console.log("\n=== B. one image missing from the zip ===");
R.is(!r.B.threw && r.B.n === 2 && J(r.B.names) === J(["lost", "kept"]),
  `the project loads with both layers (${r.B.threw || J(r.B.names)})`);
R.is(!!r.B.lost && r.B.lost.w === 64 && r.B.lost.h === 64 && J(r.B.lost.px) === J([0, 0, 0, 0]),
  `the layer whose image is missing comes back as a blank sheet the size of the slot, still paintable (${J(r.B.lost)})`);
R.is(J(r.B.kept) === J([255, 0, 0, 255]), `the other layer has its pixels (${J(r.B.kept)})`);
R.is(/Project restored/.test(r.B.said) && /gone\.png/.test(r.B.said) && /missing/.test(r.B.said),
  `the status line names what the file was missing: "${r.B.said.slice(0, 140)}"`);

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
