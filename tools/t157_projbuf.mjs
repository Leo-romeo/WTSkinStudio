// The GPU projector draws into a buffer the context really gives (ROADMAP 1.17 (1)).
//
// WHY THIS EXISTS. The owner raised a slot to 8192 and every decal on the page shifted or did not
// apply, and clearing the project did not fix it — only something that outlives the project could
// do that. The projector's own WebGL context does: its canvas grew to the largest sheet ever seen and
// each sheet was read back from `canvas.height − h`. Chrome caps a drawing buffer's AREA and gives a
// smaller one without an error — measured 2026-10-23 in headless Chromium 141, an 8192² canvas got a
// 5760² buffer and 8192×4096 got 8145×4072 — so from then on every projection drew into one corner
// of the buffer and was read back from rows it does not have.
//
// The mixed case reproduces it without an 8192² sheet (256 MB a canvas in software): a 512×8192
// sheet and an 8192×512 one grow a grow-only canvas to 8192², exactly what a project with 8192×4096
// and 4096×8192 sheets asked for. Against a synthetic plate whose coverage is known to the texel:
//
//   * a solid decal on a plate that fills the sheet covers EXACTLY the texels whose centres are in
//     its footprint, and nothing else — on a 256² sheet, on 512×8192 and on 8192×512, where the
//     footprint crosses the 4096 window seam (no gap, no double at the seam);
//   * the same 256² projection after those two sheets is byte-identical to the one before them —
//     the "for the rest of the page" half of the report;
//   * the projector's canvas is never bigger than its drawing buffer, and a bigger sheet is drawn in
//     windows of at most 4096;
//   * a context that gives less than it is asked for is caught: with the window forced to 128 and a
//     canvas that cannot shrink (the check re-run on a lying buffer), the windows follow it.
//
// The first two fail on the grow-only buffer this replaced.
//
// Usage: node tools/t157_projbuf.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = { sheets: [] };
  App._projGL = null;                                   // a fresh context, as at page load
  var s = { id: "t157", size: 256, nSize: 256, layers: [], missing: false };
  App.slots.set("t157", s);
  App.activeSlot = s;
  App.modelSize = { x: 1, y: 1, z: 1 };
  App.selParts = new Set();
  App.protectedParts = new Set();
  App.matSlot = new Map([["m", "t157"]]);
  App.meshes = new Map();
  // One plate, x and y in [−0.5, 0.5] at z = 0.2, facing the projector, its UVs the whole sheet:
  // UV = (x + 0.5, y + 0.5).
  var c = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]], idx = [0, 1, 2, 0, 2, 3], pos = [], nrm = [], uv = [];
  for (var k = 0; k < 6; k++) { var q = c[idx[k]]; pos.push(q[0], q[1], .2); nrm.push(0, 0, 1); uv.push(q[0] + .5, q[1] + .5); }
  App.geomData = [{ name: "plate", mat: "m", position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv) }];
  var bmp = mkCanvas(32, 32), bg = ctx2d(bmp); bg.fillStyle = "#ff0000"; bg.fillRect(0, 0, 32, 32);
  var src = { bmp: bmp, rot: 0, flip: false, sym2: false, surf: null, depth: 3, wrap: PROJ_WRAP_DEF };
  // The beam off-centre, so a shift cannot hide behind symmetry: footprint x in [−0.15, 0.35],
  // y in [−0.2, 0.3], i.e. u in [0.35, 0.85] and v in [0.3, 0.8].
  var B = { basis: { p: new THREE.Vector3(.1, .05, 0), n: new THREE.Vector3(0, 0, 1),
                     t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 1, 0) }, halfW: .25, halfH: .25 };
  // Texel (x, y) of a w×h sheet is covered when its centre is inside the footprint. Sheet row 0 is
  // v = 1 (the image's top), so v = 1 − (y + ½) / h.
  function want(x, y, w, h){
    var u = (x + .5) / w, v = 1 - (y + .5) / h;
    return u >= .35 && u <= .85 && v >= .3 && v <= .8;
  }
  function project(w, h){
    var cv = mkCanvas(w, h);
    var r = renderProjection(cv, src, null, s, false, B);
    var d = ctx2d(cv).getImageData(0, 0, w, h).data;
    var wrong = 0, covered = 0, seamL = 0, seamR = 0, first = null;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var a = d[(y * w + x) * 4 + 3], on = a === 255 && d[(y * w + x) * 4] === 255;
      if (a) covered++;
      if (on !== want(x, y, w, h) || (a && !on)) { wrong++; if (!first) first = [x, y, a]; }
      if (w > 4096 && x === 4095 && a) seamL++;
      if (w > 4096 && x === 4096 && a) seamR++;
    }
    var G = App._projGL;
    return { w: w, h: h, drawn: r.drawn, box: r.box, covered: covered, wrong: wrong, first: first,
             seamL: seamL, seamR: seamR,
             // (guarded only so the test can be run against the build before this fix, to watch it fail)
             wins: typeof ProjWin === "object" ? ProjWin.windows(G, w, h).length : 1,
             cw: G.canvas.width, ch: G.canvas.height, bw: G.gl.drawingBufferWidth, bh: G.gl.drawingBufferHeight,
             bytes: Array.prototype.slice.call(d) };
  }
  var a = project(256, 256);
  out.sheets.push(a);
  out.sheets.push(project(512, 8192));
  out.sheets.push(project(8192, 512));
  var b = project(256, 256);
  out.sheets.push(b);
  var diff = 0;
  for (var i = 0; i < a.bytes.length; i++) if (a.bytes[i] !== b.bytes[i]) diff++;
  out.sameAfter = diff;
  out.tile = App._projGL.tile;
  // A lying buffer: pretend the context gives only 100×100 whatever it is asked, and see that the
  // window follows it down — and that the result is still right, drawn in windows that small.
  var G = App._projGL, gl = G.gl;
  var dbw = Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, "drawingBufferWidth");
  var dbh = Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, "drawingBufferHeight");
  Object.defineProperty(gl, "drawingBufferWidth", { get: function(){ return Math.min(100, dbw.get.call(gl)); }, configurable: true });
  Object.defineProperty(gl, "drawingBufferHeight", { get: function(){ return Math.min(100, dbh.get.call(gl)); }, configurable: true });
  G.canvas.width = G.canvas.height = 4;
  var lie = project(256, 256);
  delete gl.drawingBufferWidth; delete gl.drawingBufferHeight;
  out.lie = { tile: G.tile, wins: lie.wins, wrong: lie.wrong, cw: lie.cw, ch: lie.ch };
  for (var j = 0; j < out.sheets.length; j++) delete out.sheets[j].bytes;

  // ---- a posed part (fix plan 2026-10-23, step 8): PoseApply moves a part's MESH, not its arrays ----
  // A plate 0.6 m square at rest about the origin, its UVs the whole sheet, moved 0.9 m and turned
  // 0.6 rad by its mesh's matrix — the posed plate of t158. A beam 0.2 m square aimed at where the plate
  // IS lands on the plate's middle: centred on the sheet, (0.2 / 0.6 · 256)² ≈ 7 282 texels, on the GPU
  // and on the canvas fallback alike. The decal projector read the arrays and drew nothing there.
  var keepGeom = App.geomData, keepMeshes = App.meshes;
  var pc = [[-.3, -.3], [.3, -.3], [.3, .3], [-.3, .3]], ppos = [], pnrm = [], puv = [];
  for (var k2 = 0; k2 < 6; k2++) { var q2 = pc[idx[k2]]; ppos.push(q2[0], q2[1], .2); pnrm.push(0, 0, 1); puv.push((q2[0] + .3) / .6, (q2[1] + .3) / .6); }
  App.geomData = [{ name: "posed", mat: "m", position: new Float32Array(ppos), normal: new Float32Array(pnrm), uv: new Float32Array(puv) }];
  var pm = new THREE.Object3D(); pm.name = "posed"; pm.matrixAutoUpdate = false;
  pm.matrix.makeRotationZ(.6).setPosition(.9, 0, 0); pm.updateMatrixWorld(true);
  App.meshes = new Map([["posed", pm]]);
  var PB = { basis: { p: new THREE.Vector3(.9, 0, 0), n: new THREE.Vector3(0, 0, 1),
                      t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 1, 0) }, halfW: .1, halfH: .1 };
  var posedRun = function(){
    var cv = mkCanvas(256, 256);
    renderProjection(cv, src, null, s, false, PB);
    var d = ctx2d(cv).getImageData(0, 0, 256, 256).data, n = 0, sx = 0, sy = 0;
    for (var y = 0; y < 256; y++) for (var x = 0; x < 256; x++) if (d[(y * 256 + x) * 4 + 3] >= 128) { n++; sx += x + .5; sy += y + .5; }
    return { n: n, cx: n ? sx / n : -1, cy: n ? sy / n : -1 };
  };
  out.posed = { gl: posedRun() };
  var keepG = App._projGL; App._projGL = { gl: null };            // the canvas fallback
  out.posed.cpu = posedRun();
  App._projGL = keepG;
  App.geomData = keepGeom; App.meshes = keepMeshes;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
const label = ["256² (fresh context)", "512×8192", "8192×512", "256² again, after both"];
o.sheets.forEach((x, i) => {
  R.is(x.wrong === 0, `${label[i]}: covers exactly its footprint — ${x.covered} texels covered, ${x.wrong} wrong` + (x.first ? ` (first at ${x.first})` : ""));
  R.is(x.cw <= x.bw && x.ch <= x.bh, `${label[i]}: the projector's canvas ${x.cw}×${x.ch} fits its drawing buffer ${x.bw}×${x.bh}`);
});
const wide = o.sheets[2];
R.is(wide.wins === 2 && wide.seamL > 0 && wide.seamL === wide.seamR,
  `8192×512 is drawn in ${wide.wins} windows and the footprint runs straight across the seam (${wide.seamL} | ${wide.seamR} texels either side)`);
R.is(o.tile === 4096, `the window is 4096 a side here (${o.tile}) — the largest square under Chrome's area cap`);
R.is(o.sameAfter === 0, `the 256² projection after an 8192 sheet is byte-identical to the one before (${o.sameAfter} bytes differ)`);
R.is(o.lie.tile < 100 && o.lie.wins > 1 && o.lie.wrong === 0 && o.lie.cw <= 100 && o.lie.ch <= 100,
  `a context that gives less than it is asked is caught: window ${o.lie.tile}, ${o.lie.wins} windows, canvas ${o.lie.cw}×${o.lie.ch}, ${o.lie.wrong} texels wrong`);
const PZ = o.posed || {}, near = q => q && Math.abs(q.cx - 128) < 3 && Math.abs(q.cy - 128) < 3 && Math.abs(q.n - 7282) < 7282 * .1;
R.is(near(PZ.gl), `a posed part — moved 0.9 m and turned 0.6 rad by its mesh's matrix — takes the decal where it is, on the GPU: ${PZ.gl && PZ.gl.n} texels about (${PZ.gl && PZ.gl.cx.toFixed(1)}, ${PZ.gl && PZ.gl.cy.toFixed(1)}), ≈ 7 282 about (128, 128) expected`);
R.is(near(PZ.cpu), `    …and on the canvas fallback: ${PZ.cpu && PZ.cpu.n} texels about (${PZ.cpu && PZ.cpu.cx.toFixed(1)}, ${PZ.cpu && PZ.cpu.cy.toFixed(1)})`);
R.finish();
