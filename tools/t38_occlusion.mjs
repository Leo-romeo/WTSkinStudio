// The projector must paint only the FIRST surface each of its rays meets (ROADMAP 4.2).
//
// The bug this gates: the projector is a beam with a depth *range*, and nothing stopped it painting
// the second, third and fourth surface it passed through. Measured 2026-08-05 by replaying the
// owner's own saved projector over the real F-111A it embeds (`my_f_111a (3).wtproj`, depth 0.83,
// wrap 0.85, scale 0.775): 62 982 triangles accepted, **521 % of a sheet covered in total**, one
// triangle alone covering 50 % of a sheet, and the gun, gunfire, pod and interior sheets filling
// with a magnified crop of the image. That is the reported "everything except the correct part
// fills with a zoomed-in section". With the depth pre-pass: 5 030 triangles and 31 %, with the gun
// and gunfire sheets gone entirely.
//
// A synthetic scene is used here rather than that vehicle, for the reason t28 gives: occlusion is a
// property of the projector, not of any model, so the thresholds can be exact. Four plates share
// one sheet and one beam:
//
//   band 0  the front plate                    — must be painted, fully
//   band 1  300 mm behind it, on the same rays — must get nothing
//   band 2   40 mm behind it, on the same rays — must get nothing (the bias is not over-generous)
//   band 3  a 45° plate on its own rays        — must be painted, fully (no self-occlusion acne)
//
// Then the front plate is HIDDEN and the run repeated: band 1 must now fill. That is what proves
// the exclusion above was occlusion and not the depth or facing test quietly rejecting it — and it
// is the documented way to reach a surface inside a vehicle.
//
// Usage: node tools/t38_occlusion.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var SH = 256;                                        // sheet side
  var BANDS = 4;

  // Duck-typed vectors: projBasis only ever clones, scales and adds, and this keeps the test
  // independent of whether the CDN copy of three.js loaded.
  function V(x, y, z){
    return { x: x, y: y, z: z,
      clone: function(){ return V(this.x, this.y, this.z); },
      multiplyScalar: function(s){ this.x *= s; this.y *= s; this.z *= s; return this; },
      addScaledVector: function(v, s){ this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
      negate: function(){ this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; } };
  }
  // One quad (2 triangles) with a flat normal, mapped onto vertical band \`band\` of the sheet.
  function quad(name, corners, nrm, band){
    var idx = [0, 1, 2, 0, 2, 3];
    var uvc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2];
      nor[k*3] = nrm[0]; nor[k*3+1] = nrm[1]; nor[k*3+2] = nrm[2];
      uv[k*2] = (band + t[0]) / BANDS;
      uv[k*2+1] = t[1];
    }
    return { name: name, mat: "testmat", position: pos, normal: nor, uv: uv };
  }

  // ---- the scene ----
  // The front plate and the two behind it occupy the SAME world x/y, so they sit on the same rays
  // of the beam; only their sheet bands differ, which is what makes "who got painted" readable.
  var XA = -1.1, XB = -0.1;
  var front = quad("front", [[XA,-1,0],[XB,-1,0],[XB,1,0],[XA,1,0]], [0,0,1], 0);
  var far   = quad("far",   [[XA,-1,-0.3],[XB,-1,-0.3],[XB,1,-0.3],[XA,1,-0.3]], [0,0,1], 1);
  var near  = quad("near",  [[XA,-1,-0.04],[XB,-1,-0.04],[XB,1,-0.04],[XA,1,-0.04]], [0,0,1], 2);
  var s = Math.SQRT1_2;
  var tilt  = quad("tilt",  [[0.2,-0.5,0.35],[0.9,-0.5,-0.35],[0.9,0.5,-0.35],[0.2,0.5,0.35]], [s,0,s], 3);

  var meshes = new Map();
  for (var nm of ["front", "far", "near", "tilt"]) meshes.set(nm, { visible: true });
  App.geomData = [front, far, near, tilt];
  App.meshes = meshes;
  App.matSlot = new Map([["testmat", "slotA"]]);
  App.protectedParts = new Set();
  App.selParts = new Set();
  App.modelSize = { x: 10, y: 10, z: 10 };             // → projHalfSize diag 10
  App._projGL = null;

  // an opaque white decal
  var bmp = document.createElement("canvas"); bmp.width = bmp.height = 64;
  var bg = bmp.getContext("2d"); bg.fillStyle = "#fff"; bg.fillRect(0, 0, 64, 64);

  var src = { bmp: bmp, scale: 1, rot: 0, flip: false, sym2: false, parts: null,
              depth: 0.5, wrap: 0.85 };               // halfW = 1*10*.12 = 1.2 → reach 0.6 m
  var frame = { p: V(0, 0, 0.05), n: V(0, 0, 1), r: V(1, 0, 0), u: V(0, 1, 0) };
  var slot = { id: "slotA" };

  var sheet = document.createElement("canvas"); sheet.width = sheet.height = SH;

  // Coverage of one band's INTERIOR. The outermost row of a UV island has no texel centre inside
  // any triangle under an exact fill rule (CLAUDE.md §3), so a 3-px margin is taken off.
  function band(i){
    var x0 = Math.round(i * SH / BANDS) + 3, x1 = Math.round((i + 1) * SH / BANDS) - 3;
    var d = sheet.getContext("2d").getImageData(x0, 3, x1 - x0, SH - 6).data;
    var n = d.length / 4, hit = 0, full = 0;
    for (var k = 0; k < n; k++) { if (d[k*4+3] > 0) hit++; if (d[k*4+3] === 255) full++; }
    return { pct: hit / n, solid: full / n, n: n };
  }

  out.mode = projGL() ? "gl" : "canvas";
  var covered = renderProjection(sheet, src, frame, slot, false);   // {drawn, box} since ROADMAP 4.8b
  out.covered = covered.drawn;
  out.bands = [band(0), band(1), band(2), band(3)];

  // ---- peel the stack one plate at a time ----
  // Hiding the front plate must promote the NEXT surface along those rays, and only that one.
  meshes.get("front").visible = false;
  renderProjection(sheet, src, frame, slot, false);
  out.peel1 = [band(0), band(1), band(2)];
  meshes.get("near").visible = false;
  renderProjection(sheet, src, frame, slot, false);
  out.peel2 = [band(1), band(2)];

  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log(`projector path: ${r.mode}; ${r.covered} texels reported covered`);
if (r.mode !== "gl") {
  console.log("SKIP: this browser gave no WebGL context, so the GPU projector — the only path with");
  console.log("      occlusion — did not run. The canvas fallback has no depth pre-pass by design.");
  process.exit(0);
}
const pc = b => (b.pct * 100).toFixed(1) + "%";

R.is(r.bands[0].solid > 0.99,
  `the plate the projector is aimed at is painted solid (${pc(r.bands[0])} covered, ${(r.bands[0].solid*100).toFixed(1)}% at full alpha) — the pre-pass does not make a surface occlude itself`);
R.is(r.bands[1].pct === 0,
  r.bands[1].pct === 0 ? "a plate 300 mm behind it, on the same rays, gets nothing"
    : `a plate 300 mm behind it still got ${pc(r.bands[1])} — the beam is still going through`);
R.is(r.bands[2].pct === 0,
  r.bands[2].pct === 0 ? "a plate only 40 mm behind it gets nothing either — the bias is not over-generous"
    : `a plate 40 mm behind it got ${pc(r.bands[2])} — the bias is too large`);
R.is(r.bands[3].solid > 0.99,
  `a 45° plate on its own rays is painted solid (${pc(r.bands[3])}, ${(r.bands[3].solid*100).toFixed(1)}% full) — slope does not cause acne`);

R.is(r.peel1[0].pct === 0, `hiding the front plate stops it being painted (${pc(r.peel1[0])})`);
R.is(r.peel1[2].solid > 0.99,
  r.peel1[2].solid > 0.99
    ? `and the 40 mm plate — the next one along those rays — then fills (${pc(r.peel1[2])}), so the exclusion above really was occlusion`
    : `the next plate along only reached ${pc(r.peel1[2])} once the front was hidden — something other than occlusion is rejecting it`);
R.is(r.peel1[1].pct === 0,
  r.peel1[1].pct === 0 ? "the 300 mm plate stays empty — being promoted is not the same as everything behind coming through"
    : `the 300 mm plate got ${pc(r.peel1[1])} while a nearer surface was still in the way`);
R.is(r.peel2[0].solid > 0.99 && r.peel2[1].pct === 0,
  r.peel2[0].solid > 0.99 && r.peel2[1].pct === 0
    ? `hiding that one too finally reaches the 300 mm plate (${pc(r.peel2[0])}) — the stack peels one surface at a time`
    : `peeling the second plate gave band1 ${pc(r.peel2[0])} and band2 ${pc(r.peel2[1])}`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
