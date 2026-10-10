// What the canvas projector DECIDES (ROADMAP 2.4's oracle for `projectInto`).
//
// WHY THIS EXISTS. `projectInto` is 91 lines and on 2.4's list, and its pixels are the only part of
// it anything ever looked at — `tools/t28_projector.mjs` builds a page you open by hand and compares
// its rasterising against the GPU's. What nothing held is the half that is not pixels: **which
// triangles it decides to draw at all**, which is five separate rules that each exist because of a
// reported defect, and the rectangle it reports back.
//
// Against synthetic plates whose geometry is exact:
//
//   * a plate facing the projector is drawn and one facing away is not (the facing band);
//   * a plate beyond the beam's reach is not, and one straddling the projector plane is — depth is
//     rejected only when the whole triangle stays clear of the plane;
//   * **a triangle bigger than the image is drawn**, with no corner of it inside the footprint: a
//     small decal dropped in the middle of one big fuselage triangle used to project nothing;
//   * a part the layer's own scope excludes is skipped, and the layer's REMEMBERED scope beats the
//     live selection — re-projecting a week later must not change shape because something else
//     happens to be selected;
//   * a hidden mesh, a protected part and another slot's geometry are all skipped;
//   * the dry run (no canvas) counts exactly the triangles the real run draws, because it is what
//     decides whether a sheet needs a layer at all;
//   * the box it returns is the union of what was rasterised, clamped to the sheet, and null when
//     nothing was drawn;
//   * a triangle whose UVs run past 1 is drawn once per tile it crosses (ROADMAP 4.23(a)).
//
// Usage: node tools/t79_project.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var keep = { geom: App.geomData, meshes: App.meshes, mat: App.matSlot, sel: App.selParts,
               prot: App.protectedParts, slot: App.activeSlot, size: App.modelSize };
  // ---- a sheet, and plates that face the projector from known distances ----
  var N = 256;
  var sheet = mkCanvas(N, N);
  var s = { id: "t79", size: N, nSize: N, layers: [], missing: false, composite: sheet, baseC: sheet };
  App.slots.set("t79", s);
  App.activeSlot = s;
  App.modelSize = { x: 4, y: 4, z: 4 };
  App.selParts = new Set();
  App.protectedParts = new Set();
  App.matSlot = new Map([["m", "t79"], ["other", "elsewhere"]]);

  // A quad in the x/y plane at z = \`z\`, facing +z (or −z when \`away\`), with UVs in a given
  // rectangle of the sheet. Two triangles, the shape geomData carries.
  function plate(name, z, box, opts){
    opts = opts || {};
    var half = opts.half == null ? .5 : opts.half;
    var nz = opts.away ? -1 : 1;
    var c = [[-half, -half], [half, -half], [half, half], [-half, half]];
    var idx = [0, 1, 2, 0, 2, 3];
    var pos = [], nrm = [], uv = [];
    for (var k = 0; k < 6; k++) {
      var p = c[idx[k]];
      pos.push(p[0], p[1], z);
      nrm.push(0, 0, nz);
      // the UV box the plate occupies on the sheet
      uv.push(box[0] + (p[0] / (2 * half) + .5) * box[2], box[1] + (p[1] / (2 * half) + .5) * box[3]);
    }
    return { name: name, mat: opts.mat || "m", position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv) };
  }
  // the decal: a 32×32 red square
  var bmp = mkCanvas(32, 32);
  var bg = ctx2d(bmp); bg.fillStyle = "#ff0000"; bg.fillRect(0, 0, 32, 32);
  var L = LayerNode.of({ type: "decal", name: "d", bmp: bmp, visible: true, opacity: 1, blend: "normal",
                         x: .5, y: .5, scale: 1, rot: 0 });
  // the beam: at the origin, looking down +z, half a metre across
  var basis = { p: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 0, z: 1 },
                t1: { x: 1, y: 0, z: 0 }, t2: { x: 0, y: 1, z: 0 } };
  var HW = .5, HH = .5;
  var run = function(canvas){ return projectInto(canvas, L, basis, HW, HH, s); };
  var fresh = function(){ var c = mkCanvas(N, N); return c; };

  // ---- 1. facing ----
  App.geomData = [plate("front", 1, [0, 0, .5, .5])];
  App.meshes = new Map([["front", { visible: true }]]);
  out.facing = run(fresh()).drawn;
  App.geomData = [plate("back", 1, [0, 0, .5, .5], { away: true })];
  App.meshes = new Map([["back", { visible: true }]]);
  out.facingAway = run(fresh()).drawn;

  // ---- 2. depth: the beam reaches depthLim = max(halfW, halfH) x 3 = 1.5 m ----
  App.geomData = [plate("near", 1, [0, 0, .5, .5]), plate("far", 4, [.5, 0, .5, .5])];
  App.meshes = new Map([["near", { visible: true }], ["far", { visible: true }]]);
  out.depth = run(fresh()).drawn;                       // the near plate only: 2 triangles
  App.geomData = [plate("straddle", 0, [0, 0, .5, .5])];
  App.meshes = new Map([["straddle", { visible: true }]]);
  out.straddle = run(fresh()).drawn;

  // ---- 3. a triangle bigger than the image, with no corner inside it ----
  App.geomData = [plate("huge", 1, [0, 0, 1, 1], { half: 8 })];
  App.meshes = new Map([["huge", { visible: true }]]);
  out.huge = run(fresh()).drawn;

  // ---- 4. scope: the layer's own beats the live selection ----
  App.geomData = [plate("a", 1, [0, 0, .5, .5]), plate("b", 1, [.5, .5, .5, .5])];
  App.meshes = new Map([["a", { visible: true }], ["b", { visible: true }]]);
  out.bothParts = run(fresh()).drawn;
  App.selParts = new Set(["b"]);
  out.liveSel = run(fresh()).drawn;                     // nothing remembered yet: the live one applies
  L.scope = Scope.make(["a"], null);
  out.rememberedScope = run(fresh()).drawn;             // the layer's own wins
  L.scope = undefined;
  App.selParts = new Set();

  // ---- 5. hidden, protected, another slot ----
  App.meshes = new Map([["a", { visible: false }], ["b", { visible: true }]]);
  out.hidden = run(fresh()).drawn;
  App.meshes = new Map([["a", { visible: true }], ["b", { visible: true }]]);
  App.protectedParts = new Set(["a"]);
  out.protectedOut = run(fresh()).drawn;
  App.protectedParts = new Set();
  App.geomData = [plate("a", 1, [0, 0, .5, .5]), plate("elsewhere", 1, [.5, .5, .5, .5], { mat: "other" })];
  App.meshes = new Map([["a", { visible: true }], ["elsewhere", { visible: true }]]);
  out.otherSlot = run(fresh()).drawn;

  // ---- 6. the dry run agrees with the real one ----
  App.geomData = [plate("a", 1, [0, 0, .5, .5]), plate("b", 1, [.5, .5, .5, .5])];
  App.meshes = new Map([["a", { visible: true }], ["b", { visible: true }]]);
  out.dry = projectInto(null, L, basis, HW, HH, s).drawn;
  out.wet = run(fresh()).drawn;

  // ---- 7. the box, and what it contains ----
  App.geomData = [plate("a", 1, [.25, .25, .25, .25])];      // the middle-left quarter of the sheet
  App.meshes = new Map([["a", { visible: true }]]);
  var c7 = fresh();
  var r7 = run(c7);
  out.box = r7.box;
  var d7 = ctx2d(c7).getImageData(0, 0, N, N).data;
  var minx = N, miny = N, maxx = -1, maxy = -1, painted = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    if (d7[(y * N + x) * 4 + 3] > 8) { painted++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  out.painted = { n: painted, minx: minx, miny: miny, maxx: maxx, maxy: maxy };
  // nothing drawn → no box
  App.geomData = [plate("far", 9, [0, 0, .5, .5])];
  App.meshes = new Map([["far", { visible: true }]]);
  var r8 = run(fresh());
  out.noBox = { drawn: r8.drawn, box: r8.box };

  // ---- 8. tiled UVs: a plate whose UVs run 0…2 is drawn on both tiles ----
  App.geomData = [plate("tiled", 1, [0, .25, 2, .25])];
  App.meshes = new Map([["tiled", { visible: true }]]);
  var c9 = fresh();
  out.tiled = run(c9).drawn;
  var d9 = ctx2d(c9).getImageData(0, 0, N, N).data;
  var leftHalf = 0, rightHalf = 0;
  for (var y2 = 0; y2 < N; y2++) for (var x2 = 0; x2 < N; x2++) {
    if (d9[(y2 * N + x2) * 4 + 3] > 8) { if (x2 < N / 2) leftHalf++; else rightHalf++; }
  }
  out.tiledPaint = { left: leftHalf, right: rightHalf };

  App.geomData = keep.geom; App.meshes = keep.meshes; App.matSlot = keep.mat;
  App.selParts = keep.sel; App.protectedParts = keep.prot; App.activeSlot = keep.slot; App.modelSize = keep.size;
  App.slots.delete("t79");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(r.facing === 2, `a plate facing the projector is drawn, both its triangles (${r.facing})`);
R.is(r.facingAway === 0, `…and one facing away is not (${r.facingAway})`);
R.is(r.depth === 2, `a plate past the beam's reach is left alone (${r.depth} of 4 triangles drawn)`);
R.is(r.straddle === 2, `…and one straddling the projector plane is drawn (${r.straddle})`);
R.is(r.huge === 2, `a triangle bigger than the image is drawn, with no corner of it inside (${r.huge}) — a decal in the middle of one fuselage triangle used to project nothing`);
R.is(r.bothParts === 4, `with nothing selected every part in the beam takes it (${r.bothParts})`);
R.is(r.liveSel === 2, `…a live part selection narrows it (${r.liveSel})`);
R.is(r.rememberedScope === 2, "…and the layer's own remembered scope wins over the live selection, so re-projecting keeps its shape");
R.is(r.hidden === 2, `a hidden mesh is skipped (${r.hidden})`);
R.is(r.protectedOut === 2, `a protected part is skipped (${r.protectedOut})`);
R.is(r.otherSlot === 2, `another slot's geometry is skipped (${r.otherSlot})`);
R.is(r.dry === r.wet && r.dry === 4, `the dry run counts exactly what the real one draws (${r.dry} vs ${r.wet}) — it is what decides whether a sheet needs a layer at all`);
{
  const b = r.box, p = r.painted;
  R.is(!!b && p.n > 0, `something was painted and a box came back (${p.n} texels)`);
  R.is(b && b.x <= p.minx && b.y <= p.miny && b.x + b.w >= p.maxx && b.y + b.h >= p.maxy,
    `the box contains every painted texel (box ${b && [b.x, b.y, b.w, b.h]}, paint ${p.minx}…${p.maxx} × ${p.miny}…${p.maxy})`);
  R.is(b && b.w <= 72 && b.h <= 72, `…and is the footprint rather than the sheet (${b && b.w}×${b && b.h} of 256)`);
  R.is(b && b.x >= 0 && b.y >= 0 && b.x + b.w <= 256 && b.y + b.h <= 256, "…clamped to the sheet");
}
R.is(r.noBox.drawn === 0 && r.noBox.box === null, "nothing drawn means no box at all, not an empty one");
// `drawn` counts TRIANGLES, not tile draws — the tiling shows up in the paint, which is the point:
// a part textured by one repeating strip used to take a projection on its first repeat only.
R.is(r.tiled === 2, `a plate whose UVs run 0…2 is still two triangles (${r.tiled})`);
R.is(r.tiledPaint.left > 0 && r.tiledPaint.right > 0,
  `…drawn once per tile it crosses, so both repeats carry paint (${r.tiledPaint.left} texels left, ${r.tiledPaint.right} right)`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
