// A saved stack: a group as its own file, loaded onto another sheet (ROADMAP 4.44, seventh candidate).
//
// WHY THIS EXISTS. "My weathering stack onto the next vehicle" is only worth anything if what
// arrives is what was saved, adapted where it must be and said so. In the real page: a group with
// one of everything a layer can carry — a painted layer with a blend-if band, a fill masked by that
// layer's pixels, a decal with an outline on its Look and a part limit, a projected decal with its
// rendered sheet — is packed with `Stack.pack`, read back with `Stack.read`, and adapted onto a slot
// twice the size whose model has only one of the two part names. Then:
//   * every canvas comes back at the new sheet's size, the decal's scale doubles with it, and its
//     placement (fractions) does not move;
//   * the blend-if band, the decal's outline and the mask-by-layer reference all survive — the
//     reference now naming the sibling's NEW uid, because every node is renumbered;
//   * the projected decal is flattened to its pixels and the part limit keeps the one name the
//     model has; both are said in the report;
//   * a file from a newer build is refused with the project's own sentence, and a zip that is not
//     a stack is refused by name.
//
// Usage: node tools/t69_stack.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 128;
  var flat = function(hex, w, h){ var c = mkCanvas(w || N, h || N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height); return c; };
  var mkSlot = function(id, n){
    var s = { id: id, size: n, nSize: n, layers: [], missing: false };
    s.baseC = flat("#404040", n, n); s.composite = flat("#404040", n, n);
    s.smooth = flat("#505050", n, n); s.metal = flat("#303030", n, n); s.normal = flat("#8080ff", n, n);
    return s;
  };
  var A = mkSlot("t69a", N);
  App.slots.set("t69a", A);
  var was = App.activeSlot; App.activeSlot = A;
  // ---- the stack ----
  var painted = mkCanvas(N, N); ctx2d(painted).fillStyle = "#ff0000"; ctx2d(painted).fillRect(32, 32, 64, 64);
  var paint = LayerNode.of({ type: "paint", name: "grime", canvas: painted, visible: true, opacity: 1, blend: "normal" });
  paint.tone = { src: "lum", lo: 0, hi: .4, soft: .1, invert: false };
  var fill = LayerNode.of({ type: "fill", name: "tint", color: "#00ff00", visible: true, opacity: .5, blend: "multiply" });
  fill.maskRef = paint.uid;
  var bmp = mkCanvas(40, 40); ctx2d(bmp).fillStyle = "#0000ff"; ctx2d(bmp).fillRect(0, 0, 40, 40);
  var decal = LayerNode.of({ type: "decal", name: "serial", bmp: bmp, x: .25, y: .75, scale: .5, rot: 10, flip: false,
                             visible: true, opacity: 1, blend: "normal", surf: { sm: 0, mt: 0, em: 0, wr: 0, preset: "none", ol: 8, olc: "#ffffff" } });
  decal.scope = { parts: ["wing_l", "gone_part"] };
  var projected = LayerNode.of({ type: "paint", name: "roundel (projected)", canvas: flat("#ff00ff"), visible: true, opacity: 1, blend: "normal" });
  LayerNode.contentOn(projected, "color").proj = { id: "p1", frame: { p: [0,0,0], n: [0,0,1], r: [1,0,0], u: [0,1,0] }, bmp: bmp, scale: 1, rot: 0, flip: false, sym2: false, parts: null, surf: null, depth: 3, wrap: .85 };
  var G = { type: "group", name: "weathering", visible: true, opacity: 1, blend: "normal", collapsed: false, mask: null, children: [paint, fill, decal, projected], uid: LayerNode.newUid() };
  G.mask = mkCanvas(N, N); ctx2d(G.mask).fillStyle = "#fff"; ctx2d(G.mask).fillRect(0, 0, N, N / 2);
  A.layers = [G];
  var oldUids = { paint: paint.uid, fill: fill.uid, decal: decal.uid, G: G.uid };

  // ---- out and back in ----
  var blob = await Stack.pack(A, G);
  out.bytes = blob.size;
  var back = await Stack.read(blob);
  out.meta = { kind: back.meta.kind, version: back.meta.version, sheet: back.meta.sheet, name: back.meta.name };
  // onto a sheet twice the size, on a model that has wing_l and not gone_part
  var B = mkSlot("t69b", 2 * N);
  App.slots.set("t69b", B);
  var meshesWas = App.meshes; App.meshes = new Map([["wing_l", { visible: true }]]);
  var report = Stack.adapt(back.node, back.meta, B);
  out.report = report;
  var g2 = back.node, kids = g2.children;
  var p2 = kids[0], f2 = kids[1], d2 = kids[2], j2 = kids[3];
  out.shape = { isGroup: isGroup(g2), n: kids.length, names: kids.map(function(k){ return k.name; }) };
  out.uids = { fresh: [g2.uid, p2.uid, f2.uid, d2.uid].every(function(u){ return u && Object.values(oldUids).indexOf(u) < 0; }),
               ref: f2.maskRef === p2.uid, refWasOld: f2.maskRef === oldUids.paint };
  out.sizes = { paint: [p2.canvas.width, p2.canvas.height], gmask: [g2.mask.width, g2.mask.height],
                proj: [j2.canvas.width, j2.canvas.height] };
  out.paintPx = ctx2d(p2.canvas).getImageData(128, 128, 1, 1).data[0];        // the red square, now 64…192
  out.tone = p2.tone;
  out.decal = { x: d2.x, y: d2.y, scale: d2.scale, rot: d2.rot, ol: d2.surf && d2.surf.ol, olc: d2.surf && d2.surf.olc, parts: d2.scope && d2.scope.parts };
  out.proj = { flattened: !LayerNode.contentOn(j2, "color").proj, kind: LayerNode.contentOn(j2, "color").kind,
               px: ctx2d(j2.canvas).getImageData(10, 10, 1, 1).data[2] };
  out.fill = { opacity: f2.opacity, blend: f2.blend, color: f2.color };
  // it lands, composites, and undoes
  addLayerTo(B, g2);
  out.landed = B.layers.length === 1 && B.layers[0] === g2;
  compositeSlot(B); flushComposites();
  out.composited = { shown: ctx2d(B.composite).getImageData(100, 100, 1, 1).data[0], hidden: ctx2d(B.composite).getImageData(100, 200, 1, 1).data[0] };
  // ---- refusals ----
  var newer = new JSZip(); newer.file("stack.json", JSON.stringify(Object.assign({}, back.meta, { version: PROJ_VERSION + 1 })));
  try { await Stack.read(await newer.generateAsync({ type: "blob" })); out.newer = "accepted"; } catch (e) { out.newer = e.message; }
  var notOne = new JSZip(); notOne.file("project.json", "{}");
  try { await Stack.read(await notOne.generateAsync({ type: "blob" })); out.notOne = "accepted"; } catch (e) { out.notOne = e.message; }
  App.meshes = meshesWas; App.activeSlot = was; App.slots.delete("t69a"); App.slots.delete("t69b");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(r.meta.kind === "stack" && r.meta.version >= 5 && r.meta.sheet[0] === 128 && r.meta.name === "weathering",
  `the file says what it is: kind ${r.meta.kind}, format ${r.meta.version}, painted at ${r.meta.sheet.join("×")}, “${r.meta.name}” (${r.bytes} bytes)`);
R.is(r.shape.isGroup && r.shape.n === 4 && r.shape.names.join() === "grime,tint,serial,roundel (projected)",
  `the group comes back as a group of its four layers, in order: ${r.shape.names.join(" / ")}`);
R.is(r.uids.fresh && r.uids.ref && !r.uids.refWasOld, "every node is renumbered and the mask-by-layer reference follows its sibling's new uid");
R.is(r.sizes.paint.join() === "256,256" && r.sizes.gmask.join() === "256,256" && r.sizes.proj.join() === "256,256",
  `every canvas is resampled to the new sheet: paint ${r.sizes.paint.join("×")}, group mask ${r.sizes.gmask.join("×")}, projected ${r.sizes.proj.join("×")}`);
R.is(r.paintPx === 255, `…and the painted square is where it was, twice the size (red at 128,128: ${r.paintPx})`);
R.is(r.tone && r.tone.hi === .4 && r.tone.soft === .1, "the blend-if band survives");
R.is(r.decal.x === .25 && r.decal.y === .75 && r.decal.scale === 1 && r.decal.rot === 10,
  `the decal's placement is unchanged and its scale doubled with the sheet: (${r.decal.x}, ${r.decal.y}) ×${r.decal.scale} at ${r.decal.rot}°`);
R.is(r.decal.ol === 8 && r.decal.olc === "#ffffff", "the decal's outline survives on its Look");
R.is(r.decal.parts && r.decal.parts.join() === "wing_l", `the part limit keeps the name this model has and drops the other: [${r.decal.parts}]`);
R.is(r.proj.flattened && r.proj.kind === "paint" && r.proj.px === 255, "the projected decal is flattened to its rendered pixels (a paint content, magenta intact)");
R.is(r.fill.opacity === .5 && r.fill.blend === "multiply" && r.fill.color === "#00ff00", "the fill's opacity, blend and colour survive");
R.is(r.report.some(x => /resampled from 128×128 to 256×256/.test(x)) && r.report.some(x => /1 projected decal kept as painted pixels/.test(x)) && r.report.some(x => /1 part name .* dropped/.test(x)),
  "the report names each adaptation: " + r.report.join("; "));
R.is(r.landed && r.composited.shown === 255 && r.composited.hidden === 0x40,
  `it lands on the slot as its top node and composites: red ${r.composited.shown} where the group mask shows it, base grey ${r.composited.hidden} where it hides it`);
R.is(/newer build/.test(r.newer) && /format 6/.test(r.newer), `a stack from a newer build is refused: “${r.newer}”`);
R.is(/not a WT Skin Studio stack/.test(r.notOne), `a zip that is not a stack is refused by name: “${r.notOne}”`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
