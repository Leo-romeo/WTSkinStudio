// Putting a stroke down reads nothing back (ROADMAP 1.19 (d) + 1.17 (3), measured 2026-10-25).
//
// The owner's recordings at 4096² (`Issues examples/wtss-session-2026-10-24T16-07-10.json` and
// `…T20-52-40.json`, f_111f) put the freeze at the end of every stroke in one phase, `undo`: 80–392 ms
// a stroke across 31 strokes, for a single click as much as for a long line, while everything else a
// click cost was 7–45 ms. `undo` is `TileUndo.commit`, and commit took its before and after tiles
// with `getImageData` — one per tile ROW, from the pre-stroke snapshot and from the sheet. On an
// accelerated canvas that call transfers the whole surface whatever rectangle it is given
// (wt-canvas), so a click cost two full 4096² readbacks and an 8192² sheet four times that — the
// seconds of 1.17 (3). Commit now copies the touched tiles GPU-side, into one atlas per side.
//
// The suite runs Chrome with --disable-gpu, where a readback is nearly free, so it cannot time this.
// What it reads instead, in the booted page:
//   * commit reads neither the sheet nor the snapshot back (getImageData counted on every 2-D context
//     prototype, for a canvas the sheet's size) — the old one did it twice per tile row — and undo
//     and redo read nothing back either. Commit reads one texel of each small atlas it fills, which
//     plays its queued copies now (see TileUndo.copyTiles);
//   * on a sheet whose last row and column of tiles are partial, three rows of stamps undo to the
//     exact pre-stroke bytes and redo to the exact stroke;
//   * a second stroke over the same tiles — which reuses the shared pre-stroke scratch — leaves the
//     first entry intact: undo twice is the start, redo twice is the end;
//   * the entry's bytes are the touched tiles' real area × 4 × 2, which is what the budget spends.
//
// Usage: node tools/t172_undocommit.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var out = {};
  var W = TILE * 4 + 37, H = TILE * 3 + 11;                  // partial last column and row of tiles
  var c = mkCanvas(W, H), g = ctx2d(c);
  var img = g.createImageData(W, H), seed = 12345;
  for (var i = 0; i < img.data.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; img.data[i] = (i & 3) === 3 ? 255 : seed >>> 24; }
  g.putImageData(img, 0, 0);
  function hash(){ var d = g.getImageData(0, 0, W, H).data, h = 2166136261; for (var k = 0; k < d.length; k++) h = Math.imul(h ^ d[k], 16777619); return h >>> 0; }
  var protos = [CanvasRenderingContext2D.prototype];
  if (typeof OffscreenCanvasRenderingContext2D !== "undefined") protos.push(OffscreenCanvasRenderingContext2D.prototype);
  var reads = 0, real = protos.map(function(p){ return p.getImageData; });
  function count(on){ protos.forEach(function(p, j){ p.getImageData = on ? function(){ if (this.canvas.width === W && this.canvas.height === H) reads++; return real[j].apply(this, arguments); } : real[j]; }); }
  var stack = App.undoStack.slice(); App.undoStack.length = 0;
  try {
    var start = hash();
    // Stroke 1: stamps in three tile rows, one in the partial corner tile.
    var u = makeTileUndo(c, "probe 1", function(){});
    var pts = [[40, 40], [TILE + 3, 60], [TILE * 2 + 9, TILE + 20], [W - 5, H - 4], [TILE * 3 + 30, TILE * 2 + 40]];
    pts.forEach(function(p){ u.record(p[0], p[1], 12); });
    g.fillStyle = "#ff2000"; pts.forEach(function(p){ g.fillRect(p[0] - 12, p[1] - 12, 24, 24); });
    var after1 = hash();
    var area = 0; u.touched.forEach(function(k){ var t = u.tileRect(k); area += t.w * t.h; });
    out.tiles = u.touched.size;
    reads = 0; count(true); u.commit(); count(false);
    out.commitReads = reads;
    var e1 = App.undoStack[App.undoStack.length - 1];
    out.bytes = e1 ? e1.bytes : 0; out.wantBytes = area * 4 * 2;
    // Stroke 2 over the same tiles: it reuses the shared pre-stroke scratch, so stroke 1's entry
    // must not be holding that scratch.
    var u2 = makeTileUndo(c, "probe 2", function(){});
    pts.forEach(function(p){ u2.record(p[0], p[1], 12); });
    g.fillStyle = "#0040ff"; pts.forEach(function(p){ g.fillRect(p[0] - 8, p[1] - 8, 16, 16); });
    var after2 = hash();
    u2.commit();
    var e2 = App.undoStack[App.undoStack.length - 1];
    reads = 0; count(true); e2.undo(); count(false); out.undoReads = reads;
    out.undo2 = hash() === after1;
    e1.undo(); out.undo1 = hash() === start;
    reads = 0; count(true); e1.redo(); count(false); out.redoReads = reads;
    out.redo1 = hash() === after1;
    e2.redo(); out.redo2 = hash() === after2;
  } finally { count(false); App.undoStack.length = 0; stack.forEach(function(a){ App.undoStack.push(a); }); }
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 60000, keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const o = r0.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }

console.log(`=== a stroke over ${o.tiles} tiles in three rows is put down ===`);
R.is(o.commitReads === 0, `commit read the sheet or its snapshot back ${o.commitReads} time(s) — each one is a whole-surface transfer on a GPU canvas (want 0)`);
R.is(o.undoReads === 0 && o.redoReads === 0, `undo and redo read nothing back either (${o.undoReads}, ${o.redoReads})`);
R.is(o.bytes === o.wantBytes, `the entry costs ${o.bytes} bytes, its tiles' real area × 4 × 2 (${o.wantBytes})`);
console.log("=== and it is still an exact undo ===");
R.is(o.undo2, "undoing a second stroke over the same tiles restores the first stroke exactly");
R.is(o.undo1, "undoing the first restores the pre-stroke bytes, partial edge tiles included");
R.is(o.redo1 && o.redo2, "redo puts back each stroke exactly");
R.finish();
