// The three surface sheets are read as they are, and the two conversions happen in the shader
// (ROADMAP 1.13).
//
// WHY THIS EXISTS, AND WHY IT CHECKS THE SHADER TEXT. There used to be a CPU repack: the smoothness,
// metalness and normal sheets were read back, packed into two more canvases (normal X/Y with Z
// derived; 0 / 1-smoothness / metalness) and those were what three.js sampled. That pass was the
// whole reason painting a surface channel cost 30–115 ms a frame against the albedo's 0.04 — it was
// the only place anything read surface pixels back, and on an accelerated canvas every such read
// transfers the whole surface and waits for the compositor's writes to drain. It is gone; the sheets
// are bound directly and `applySurfaceMaps` edits two stock r128 chunks instead.
//
// **The edit failing silently is the realistic bug, and it happened.** The shader handed to
// `onBeforeCompile` still has its `#include <name>` lines UNRESOLVED — three.js expands them
// afterwards, in WebGLProgram — so replacing the chunk's own source text matches nothing and does
// nothing at all. Nothing throws. The model simply renders with every surface normal flat in the
// tangent plane and roughness reading as smoothness, which measured as a visibly brighter aircraft
// (mean luminance 76.5 → 90.3 on a close view) and would have shipped looking merely "different".
// So what is asserted here is that the edits are PRESENT in the shader the material hands back.
//
// The render itself was gated once, by hand, against the build that still had the repack: five
// camera angles on the real F-4E from `samples/Base_f4e.wtproj`, a 16×12 luminance grid each.
// Identical — worst cell 1 of 255 across all 960 cells, against a run-to-run noise floor of 0, and
// that 1 is the old path having rounded Z into a byte where the shader now computes it exactly.
// That comparison needs a GPU and a 24 MB project file, so it is not in the suite; this is.
//
// Usage: node tools/t54_surface.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var out = {}, N = 64;
  var flat = function(hex){ var c = mkCanvas(N, N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t54", size: N, nSize: N, layers: [], missing: false };
  s.baseC = flat("#4080c0"); s.composite = flat("#4080c0");
  s.smooth = flat("#2d2d2d"); s.metal = flat("#d2d2d2"); s.normal = flat("#8080ff");
  App.slots.set("t54", s);
  App.matSlot.set("t54mat", "t54");
  s.tex = new THREE.CanvasTexture(s.composite);
  refreshSurfaceTextures(s);
  out.texCh = s.texCh ? Object.keys(s.texCh).sort() : null;

  var chanOnWas = App.chanOn, viewWas = App.chanView;
  App.chanView = "shaded";
  App.chanOn = { color: true, smooth: true, metal: true, normal: true };
  var m = makeMaterial("t54mat", "t54part");
  out.bound = { normal: m.normalMap === s.texCh.normal, rough: m.roughnessMap === s.texCh.smooth,
    metal: m.metalnessMap === s.texCh.metal,
    // the sheets themselves, not a repacked pair
    normalIsSheet: m.normalMap && m.normalMap.image === chanOut(s, "normal"),
    roughIsSheet: m.roughnessMap && m.roughnessMap.image === chanOut(s, "smooth") };

  // Run the compile hook against a shader in the shape three.js really hands over: includes, not
  // resolved chunk text. This is the check that would have caught the silent no-op.
  var run = function(mat){
    var sh = { vertexShader: "", uniforms: {}, defines: {},
      fragmentShader: "#include <normal_fragment_maps>" + String.fromCharCode(10) +
        "#include <roughnessmap_fragment>" + String.fromCharCode(10) +
        "#include <metalnessmap_fragment>" + String.fromCharCode(10) };
    if (mat.onBeforeCompile) mat.onBeforeCompile(sh);
    return sh.fragmentShader;
  };
  var f = run(m);
  out.shader = {
    zFromXY: f.indexOf("mapN.z = sqrt(") >= 0,
    readsXY: f.indexOf("texture2D( normalMap, vUv ).xy") >= 0,
    // only the TANGENT-space line is replaced; the object-space branch above it is untouched
    // and still reads .xyz, which is right — nothing here uses an object-space normal map
    noStockXYZ: f.indexOf("vec3 mapN = texture2D( normalMap, vUv ).xyz") < 0,
    keptObjectSpace: f.indexOf("normal = texture2D( normalMap, vUv ).xyz") >= 0,
    roughInverted: f.indexOf("roughnessFactor *= 1.0 - texelRoughness.g;") >= 0,
    noStockRough: f.indexOf("roughnessFactor *= texelRoughness.g;") < 0,
    // the metalness chunk must be untouched: it reads .b, and the metal sheet is greyscale
    metalUntouched: f.indexOf("#include <metalnessmap_fragment>") >= 0,
    normalIncludeGone: f.indexOf("#include <normal_fragment_maps>") < 0,
    roughIncludeGone: f.indexOf("#include <roughnessmap_fragment>") < 0,
    // the rest of the stock chunk has to survive — this replaces one line, not the chunk
    keptPerturb: f.indexOf("perturbNormal2Arb") >= 0,
  };
  out.key = m.customProgramCacheKey ? m.customProgramCacheKey() : null;

  // channel toggles still remove the right map, and then the edit for it must not be applied
  App.chanOn = { color: true, smooth: false, metal: true, normal: false };
  var m2 = makeMaterial("t54mat", "t54part");
  var f2 = run(m2);
  out.off = { normalMap: !!m2.normalMap, roughnessMap: !!m2.roughnessMap, metalnessMap: !!m2.metalnessMap,
    roughness: m2.roughness,
    zPatch: f2.indexOf("mapN.z = sqrt(") >= 0, roughPatch: f2.indexOf("1.0 - texelRoughness.g") >= 0 };

  // a slot with no _n at all gets neither map nor edit
  var bare = { id: "t54b", size: N, nSize: N, layers: [], missing: false, baseC: flat("#333"), composite: flat("#333") };
  bare.tex = new THREE.CanvasTexture(bare.composite);
  App.slots.set("t54b", bare); App.matSlot.set("t54bmat", "t54b");
  App.chanOn = { color: true, smooth: true, metal: true, normal: true };
  var m3 = makeMaterial("t54bmat", "t54bpart");
  out.bare = { normalMap: !!m3.normalMap, roughness: m3.roughness, metalness: m3.metalness,
    patched: run(m3).indexOf("mapN.z = sqrt(") >= 0 };

  App.chanOn = chanOnWas; App.chanView = viewWas;
  App.slots.delete("t54"); App.slots.delete("t54b");
  App.matSlot.delete("t54mat"); App.matSlot.delete("t54bmat");
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== the three sheets are bound as they are ===");
R.is(o.texCh && o.texCh.join(",") === "metal,normal,smooth", `the slot carries one texture per channel (${o.texCh})`);
R.is(o.bound.normal && o.bound.rough && o.bound.metal,
  "normalMap / roughnessMap / metalnessMap point at the normal / smoothness / metalness textures");
R.is(o.bound.normalIsSheet && o.bound.roughIsSheet,
  "and those textures are the CHANNEL SHEETS themselves — there is no repacked pair any more");

console.log("\n=== the shader edits actually land ===");
for (const [k, v] of Object.entries(o.shader)) console.log("   " + k.padEnd(20) + v);
R.is(o.shader.normalIncludeGone && o.shader.roughIncludeGone,
  "the include is replaced — three.js hands over UNRESOLVED includes, and patching chunk text instead does nothing at all");
R.is(o.shader.readsXY && o.shader.zFromXY && o.shader.noStockXYZ,
  "Z is reconstructed from x,y instead of read from a blue channel the game's _n does not have");
R.is(o.shader.roughInverted && o.shader.noStockRough,
  "roughness is 1 - the sheet, because the sheet holds smoothness (CLAUDE.md §1)");
R.is(o.shader.metalUntouched, "the metalness include is left alone — it reads .b and the metal sheet is grey");
R.is(o.shader.keptObjectSpace, "and so is the object-space branch, which nothing here uses");
R.is(o.shader.keptPerturb, "and the rest of the stock chunk survives: this replaces one line, not the chunk");
R.is(/wtsurf:nr/.test(o.key || ""), `the program cache key says which edits are in (${(o.key || "").slice(-24)})`);

console.log("\n=== the channel toggles still work, and take their edit with them ===");
R.is(!o.off.normalMap && !o.off.roughnessMap && o.off.metalnessMap,
  "switching normal and smoothness off unbinds exactly those two maps");
R.is(o.off.roughness === .6, `and roughness falls back to the constant (${o.off.roughness})`);
R.is(!o.off.zPatch && !o.off.roughPatch, "with neither edit applied — an edit for a map that is not bound would be dead code");
R.is(!o.bare.normalMap && !o.bare.patched, "a slot with no _n gets no surface map and no edit");
R.is(o.bare.roughness === .6 && o.bare.metalness === .15, `it keeps the flat fallback (${o.bare.roughness} / ${o.bare.metalness})`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
