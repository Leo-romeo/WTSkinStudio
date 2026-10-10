// Check the parts-tree rules against a real model: naming, ordering, l/r pairing, series split
// and the same-geometry detection. It pulls the page's own functions out by name and runs them.
// Usage: node tools/t15_parts.mjs [model]   (default fa_18e_block_2)
import fs from "fs";
import { grp, skeletonOf, A } from "./arms.mjs";
import { installOodle } from "./oodle_lift.mjs";
import { fileURLToPath } from "url";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  return src.slice(a + 1, b);
};
// pull a top-level `function NAME(...){...}` (or `const NAME = ...;`) out of the page by name
function fn(name) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) {
    const j = src.indexOf("\nconst " + name + " =");
    if (j < 0) throw new Error("not found: " + name);
    const end = src.indexOf("\n", src.indexOf(";", j));
    return src.slice(j + 1, end);
  }
  let d = 0, k = src.indexOf("{", i);
  for (let p = k; p < src.length; p++) {
    if (src[p] === "{") d++;
    else if (src[p] === "}") { d--; if (!d) return src.slice(i + 1, p + 1); }
  }
  throw new Error("unbalanced: " + name);
}
const names = ["partNode", "natCmp", "SIDE_TOK", "SIDE_LABEL", "SIDE_ORDER", "partSegCache", "partSegments",
  "partSegmentsOf", "commonPartLabel", "SUB_MIN", "SUB_DEPTH", "SIDE_SPLIT", "subTreeOf", "subGroupTitle",
  "buildGeomSigs", "geomSigs", "nodeShape", "nodeSig", "nodesLikeShape", "shapeSplit", "shapeTip"];
const code = names.map(fn).join("\n") +
  "\nreturn { partSegments, subTreeOf, subGroupTitle, natCmp, buildGeomSigs, shapeSplit, shapeTip, nodesLikeShape, nodeShape };";
const App = { geomData: null, geomSigs: null, geomSigSrc: null };
const P = new Function("App", code)(App);

// --- pure naming checks
const say = (ok, m) => console.log((ok ? "  PASS  " : "  FAIL  ") + m);
let bad = 0;
const eq = (got, want, m) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; say(ok, m + "  got " + JSON.stringify(got)); };

console.log("--- name segmentation ---");
eq(P.partSegments("nozzle2_24").levels, ["nozzle", "nozzle2"], "nozzle2_24 -> nozzle / nozzle2");
eq(P.partSegments("nozzle2_24").index, "24", "nozzle2_24 index 24");
eq(P.partSegments("nozzle1_1").levels, ["nozzle", "nozzle1"], "nozzle1_1 -> nozzle / nozzle1");
eq(P.partSegments("flaperon_l").levels, ["flaperon"], "flaperon_l level");
eq(P.partSegments("flaperon_l").side, "l", "flaperon_l side");
eq(P.partSegments("flaperon_r").side, "r", "flaperon_r side");
eq(P.partSegments("gear_l14").levels, ["gear"], "gear_l14 level");
eq(P.partSegments("gear_l14").side, "l", "gear_l14 side");
eq(P.partSegments("us_m61_gun_barrel_002").levels, ["us", "m61", "gun", "barrel"], "m61 stays m61");
eq(P.partSegments("aim_9e").levels, ["aim", "9e"], "aim_9e keeps 9e");

console.log("--- ordering ---");
eq(["nozzle2_24", "nozzle2_3", "nozzle2_10"].sort(P.natCmp), ["nozzle2_3", "nozzle2_10", "nozzle2_24"], "natural sort");

// --- against a real model
const model = process.argv[2] || "fa_18e_block_2";
// The page's own decoder, whichever this build carries (tools/oodle_lift.mjs) — not a RAD-only
// shim, which is what stood here until 2026-09-20 and had been broken since the page stopped
// carrying RAD's blob.
installOodle(src);
globalThis.zstdDec = A.zstdDec;
const M = new Function(section("MODEL") + "\nreturn { loadDynModelBytes, buildDynModelGeometry };")();
const ref = grp.dyn.get(model);
if (!ref) { console.log("\n" + model + " not in any .grp — skipping the model part"); process.exit(bad ? 1 : 0); }
const pack = new Uint8Array(fs.readFileSync(ref.p));
const dm = await M.loadDynModelBytes(pack.subarray(ref.e.offset, ref.e.offset + ref.e.size), model);
dm.skeleton = skeletonOf(model);
const geo = M.buildDynModelGeometry(dm, 0);

// geomData-shaped: one entry per object, positions flattened
App.geomData = geo.objects.map(o => {
  const pos = [];
  let tris = 0;
  for (const g of o.groups) for (const f of g.faces) {
    tris++;
    for (const vi of f) { const v = geo.verts[vi]; pos.push(v[0], v[1], v[2]); }
  }
  return { name: o.name, mat: "m", position: Float32Array.from(pos), tris };
}).filter(g => g.position.length);
console.log("\n" + model + ": " + App.geomData.length + " objects, " + geo.verts.length.toLocaleString() + " vertices");

const nodes = [...new Set(App.geomData.map(g => g.name))];
const tree = P.subTreeOf(nodes, "root", 0);
const show = (gs, ind) => {
  for (const g of gs) {
    console.log(ind + P.subGroupTitle(g) + "  (" + g.nodes.length + ")");
    if (g.children.length) show(g.children, ind + "  ");
    else {
      const sh = P.shapeSplit(g.nodes);
      if (sh) for (let i = 0; i < sh.length; i++)
        console.log(ind + "  shape " + (i + 1) + " · " + P.shapeTip(sh[i].shape) + "  → " + sh[i].nodes.slice(0, 6).join(", ") + (sh[i].nodes.length > 6 ? " …" : ""));
      else console.log(ind + "  " + g.nodes.slice(0, 8).sort(P.natCmp).join(", ") + (g.nodes.length > 8 ? " …" : ""));
    }
  }
};
show(tree.groups, "  ");
console.log("  loose: " + tree.loose.slice(0, 20).join(", ") + (tree.loose.length > 20 ? " …(" + tree.loose.length + ")" : ""));

// the specific claims the user made
const nz = nodes.filter(n => /^nozzle/i.test(n));
if (nz.length) {
  const t = P.subTreeOf(nz, "x", 0);
  const kids = t.groups[0] ? t.groups[0].children.map(c => c.key) : [];
  say(t.groups.length === 1 && kids.length >= 2, "nozzles split into series: " + JSON.stringify(kids));
  if (!(t.groups.length === 1 && kids.length >= 2)) bad++;
  const sh = P.shapeSplit(nz.filter(n => /^nozzle2/.test(n)));
  console.log("  nozzle2 shape classes: " + (sh ? sh.map(c => c.nodes.length + "× " + P.shapeTip(c.shape)).join(" | ") : "one shape"));
}
const fl = nodes.filter(n => /flaperon/i.test(n));
if (fl.length) {
  const t = P.subTreeOf(fl, "x", 0);
  const ok = t.groups.length === 1;
  if (!ok) bad++;
  say(ok, "flaperons under one parent: " + (t.groups[0] ? P.subGroupTitle(t.groups[0]) : "-") + "  " + JSON.stringify(fl));
}
console.log(bad ? "\n" + bad + " check(s) failed" : "\nall checks passed");
process.exit(bad ? 1 : 0);
