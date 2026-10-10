// Placement parity and rocket-pod tubes — the two things that made suspended armament render
// wrong. Runs the page's own placeStore() over the real install, with only the two I/O helpers
// it calls (extractWeaponGeom, modelSkeleton) stubbed to read from disk instead of the browser.
//
//   1. A store must be placed by a PROPER rotation. Every stored node transform has determinant
//      −1, but so does almost every other node in the file (308 of the F-4E's 312), so that is the
//      format's convention and not a mirror: the honest transform is recovered by negating one row,
//      which is what matFlipZ does. Conjugating instead keeps the −1, and a reflected store wears
//      its texture backwards — ROADMAP 4.29. placeGeom's winding swap stays as the invariant for
//      anything that really does reflect, and is exercised here with a transform built to.
//   2. A rocket pod lists no emitter nodes at all: it says amountPerTier and leaves the tubes to
//      its own skeleton. Without reading them a pod got ONE rocket at its origin.
import fs from "fs";
import { A, grp, skeletonOf } from "./arms.mjs";
import { installOodle } from "./oodle_lift.mjs";
import { fileURLToPath } from "url";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  return src.slice(a + 1, b);
};

// The page's own decoder, whichever this build carries (tools/oodle_lift.mjs) — not a RAD-only
// shim, which is what stood here until 2026-09-20 and had been broken since the page stopped
// carrying RAD's blob.
installOodle(src);
globalThis.zstdDec = A.zstdDec;
const M = new Function(section("MODEL") +
  "\nreturn { loadDynModelBytes, buildDynModelGeometry };")();
const G = new Function(
  src.slice(src.indexOf("function buildGeometryData("), src.indexOf("function matchTexture(")) + "\n" +
  // Marked, not "up to the next banner": the tank-track banner this used to stop at is a separate
  // module since the split (ROADMAP 2.2), so the old lift came back with markup in it.
  section("GEOMDATA") + "\n" +
  "return { geomDataFromExtracted };")();

// The shipped placeStore(), with its two I/O calls fed from disk. Lifted by MARKER since
// 2026-09-22: it was lifted from `async function placeStore(` to a COMMENT that had been reworded
// out of existence, and `indexOf` returning −1 made `slice` run to the end of the page instead of
// failing — so this test died on `Unexpected token '<'` with a stack pointing at new Function(),
// which is CLAUDE.md §2's warning happening for real. `tools/t51_claims.mjs` now checks every
// page-source anchor in tools/ on each npm test, so the next one cannot rot silently.
const placeStoreSrc = section("PLACESTORE");
const geomCache = new Map();
async function extractWeaponGeom(model){
  if (geomCache.has(model)) return geomCache.get(model);
  const ref = grp.dyn.get(model);
  if (!ref) throw new Error("no DynModel " + model);
  const pack = new Uint8Array(fs.readFileSync(ref.p));
  const dm = await M.loadDynModelBytes(pack.subarray(ref.e.offset, ref.e.offset + ref.e.size), model);
  dm.skeleton = skeletonOf(model);
  const list = G.geomDataFromExtracted(M.buildDynModelGeometry(dm, 0), null);
  for (const g of list) { g.name = model + " · " + g.name; g.weapon = model; }
  const got = { list, bind: null };
  geomCache.set(model, got);
  return got;
}
const placeStore = new Function("deps", "with (deps) { " + placeStoreSrc + "\nreturn placeStore; }")({
  storeMesh: A.storeMesh, placeGeom: A.placeGeom, matDet3: A.matDet3, matMul: A.matMul,
  matFlipZ: A.matFlipZ, podTubeNodes: A.podTubeNodes, extractWeaponGeom,
  modelSkeleton: async m => skeletonOf(m), console,
});

let fails = 0;
const ok = (c, m, e) => { console.log((c ? "  PASS  " : "  FAIL  ") + m + (e ? "  " + e : "")); if (!c) fails++; };

// Does every triangle's winding agree with its own vertex normals? That agreement is what
// gl_FrontFacing reports and what DoubleSide lighting depends on. +1 all agree, −1 all inverted.
function parity(list){
  let agree = 0, tot = 0;
  for (const g of list) {
    const p = g.position, nr = g.normal;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const ux = p[t+3]-p[t], uy = p[t+4]-p[t+1], uz = p[t+5]-p[t+2];
      const vx = p[t+6]-p[t], vy = p[t+7]-p[t+1], vz = p[t+8]-p[t+2];
      const fx = uy*vz-uz*vy, fy = uz*vx-ux*vz, fz = ux*vy-uy*vx;
      const d = fx*(nr[t]+nr[t+3]+nr[t+6]) + fy*(nr[t+1]+nr[t+4]+nr[t+7]) + fz*(nr[t+2]+nr[t+5]+nr[t+8]);
      if (d !== 0) { tot++; if (d > 0) agree++; }
    }
  }
  return tot ? 2 * agree / tot - 1 : 0;
}
const bounds = list => {
  const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (const g of list) for (let i = 0; i < g.position.length; i += 3) for (let k = 0; k < 3; k++) {
    if (g.position[i+k] < b[k]) b[k] = g.position[i+k];
    if (g.position[i+k] > b[k+3]) b[k+3] = g.position[i+k];
  }
  return b;
};
const centre = l => { const b = bounds(l); return [(b[0]+b[3])/2, (b[1]+b[4])/2, (b[2]+b[5])/2]; };

async function place(unit, loadoutName){
  const arm = A.unitArmament(unit);
  const lo = arm.loadouts.find(l => l.name === loadoutName);
  if (!lo) throw new Error("no loadout " + loadoutName + " on " + unit);
  const skel = skeletonOf(arm.model);
  const ctx = { geom: new Map(), added: [], placed: [], failed: [], looseNodes: [], seq: {} };
  for (const st of A.loadoutModels(arm, lo)) {
    const wtm = st.node && skel && skel.get(st.node);
    await placeStore(st.weapon.store, wtm ? A.matFlipZ(wtm) : null, ctx);
  }
  return ctx;
}

// ---------------------------------------------------------------- 1. mirrored placement
console.log("=== A-10C, GBU-12 preset: five bombs straight on a pylon, four triple racks ===");
const ctx = await place("a_10c", "a_10c_gbu_12");
console.log("  " + ctx.placed.length + " store instances, " + ctx.added.length + " meshes, " +
  ctx.failed.length + " unreadable");
ok(ctx.failed.length === 0, "every model in the preset loaded",
   ctx.failed.length ? "unreadable: " + ctx.failed.join(", ") : "");
// Five stations carry one bomb each (bomb_1, bomb_2, bomb_5, bomb_6, bomb_10) and four carry a
// pylon_ter9a with three. The tenth is the targeting pod, which has no model of its own.
ok(ctx.placed.filter(p => p.model === "us_500_lb_gbu_12_paveway_2").length === 17,
   "5 single bombs + 4 racks × 3 = 17 GBU-12s",
   ctx.placed.filter(p => p.model === "us_500_lb_gbu_12_paveway_2").length + " placed");
ok(ctx.placed.filter(p => p.model === "pylon_ter9a").length === 4, "and four triple racks",
   ctx.placed.filter(p => p.model === "pylon_ter9a").length + " placed");

let worst = 1, worstTag = "";
for (const p of ctx.placed) {
  const inst = ctx.added.filter(g => g.weaponTag === p.tag);
  const q = parity(inst);
  if (q < worst) { worst = q; worstTag = p.tag; }
}
ok(worst > .98, "every placed store keeps winding and normals in step",
   "worst " + worst.toFixed(3) + (worstTag ? " on " + worstTag : ""));

// ---- the placement transform must not reflect, and must agree with the model builder ----
// This is the check ROADMAP 4.29 needed and did not have. Everything above measures *position*,
// and position is identical under F·N and under F·N·F — which is exactly how a conjugation that
// mirrored every directly-hung store survived here, wearing its texture backwards while lighting
// correctly, until someone read the stencilling on a bomb.
const apply = (m, v) => [
  m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2] + m[0][3],
  m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2] + m[1][3],
  m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2] + m[2][3]];
{
  const arm = A.unitArmament("a_10c");
  const lo = arm.loadouts.find(l => l.name === "a_10c_gbu_12");
  const skel = skeletonOf(arm.model);
  let worstDet = 1e30, worstNode = "", nodes = 0;
  for (const st of A.loadoutModels(arm, lo)) {
    const m = st.node && skel && skel.get(st.node);
    if (!m) continue;
    nodes++;
    const d = A.matDet3(A.matFlipZ(m));
    if (d < worstDet) { worstDet = d; worstNode = st.node; }
  }
  ok(nodes > 0 && worstDet > .99, "every station places by a proper rotation, not a reflection",
     nodes + " stations, worst determinant " + worstDet.toFixed(3) + (worstNode ? " at " + worstNode : ""));

  // The tie to buildDynModelGeometry, which is the ground truth for what space the app's geometry
  // is in: it applies a node's wtm to the raw vertices and THEN negates Z. Moving that same
  // transform into app space therefore has to be exactly "apply, then negate Z" — vector by
  // vector — or a store lands in a different convention from the airframe it hangs under.
  const m = skel.get("bomb_1");
  let worstErr = 0;
  for (const v of [[1,0,0],[0,1,0],[0,0,1],[.37,-1.2,2.4],[-3,.5,-1.75]]) {
    const got = apply(A.matFlipZ(m), v);
    const want = apply(m, v); want[2] = -want[2];
    for (let k = 0; k < 3; k++) worstErr = Math.max(worstErr, Math.abs(got[k] - want[k]));
  }
  ok(worstErr < 1e-5, "matFlipZ is exactly buildDynModelGeometry's own Z negation",
     "worst component error " + worstErr.toExponential(2));
}

// The parity guard itself still has to work, so it is driven with a transform that really does
// reflect — nothing the game ships does any more, which is the point of 4.29.
{
  const bomb = (await extractWeaponGeom("us_500_lb_gbu_12_paveway_2")).list;
  const at = A.matFlipZ(skeletonOf("a_10c").get("bomb_1"));
  const mirrored = at.map(r => r.slice());
  for (let r = 0; r < 3; r++) mirrored[r][2] = -mirrored[r][2];       // reflect one axis
  ok(A.matDet3(mirrored) < 0, "the test's own transform mirrors", "det " + A.matDet3(mirrored).toFixed(3));
  const copy = bomb.map(g => ({ ...g, position: Float32Array.from(g.position), normal: Float32Array.from(g.normal) }));
  A.transformGeom(copy, mirrored);
  ok(parity(copy) < -.98, "transformGeom alone inverts it (the bug placeGeom exists for)", "parity " + parity(copy).toFixed(3));
  const fixed = bomb.map(g => ({ ...g, position: Float32Array.from(g.position), normal: Float32Array.from(g.normal), uv: Float32Array.from(g.uv) }));
  A.placeGeom(fixed, mirrored);
  ok(parity(fixed) > .98, "placeGeom puts it back", "parity " + parity(fixed).toFixed(3));
  // and the vertices must not have moved: only the corner order changed
  const x = bounds(copy), y = bounds(fixed);
  ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-4), "the fix does not move the store", "bounds identical");
}

// The bombs really are in eighteen different places, not stacked at their stations.
{
  const seen = new Set(ctx.placed.filter(p => p.model === "us_500_lb_gbu_12_paveway_2")
    .map(p => centre(ctx.added.filter(g => g.weaponTag === p.tag)).map(v => v.toFixed(3)).join(",")));
  ok(seen.size === 17, "every bomb has its own station or rack shoulder", seen.size + " distinct positions");
}

// ---------------------------------------------------------------- 2. rocket pods
console.log("\n=== rocket pods: tubes recovered from the pod's own skeleton ===");
for (const [blk, model, want] of [
  ["gameData/Weapons/containers/lau_10a_zuni_wafar_mk32.blk", "lau_10a", 4],
  ["gameData/Weapons/containers/hl_7_70_heli_stone_hydra_70_m247.blk", "lau_131a_olive", 7],
  ["gameData/Weapons/containers/aero_7a_hydra_70.blk", "lau_61ca", 19],
  ["gameData/Weapons/containers/hl_19_70_hydra_70_m247.blk", "m261", 19],
]) {
  const store = A.resolveStore(blk);
  const nodes = A.podTubeNodes(skeletonOf(model), model, store.perTier || 0,
    A.storeMesh(store.child) || store.child.path);
  ok(nodes && nodes.length === want, A.blkBaseName(blk) + ": " + want + " tubes found",
     nodes ? nodes.length + " — " + nodes[0] + " … " + nodes[nodes.length-1] : "none");
}
// lau_61ca carries two full sets of 19; the Hydra pod must take the Hydra one.
{
  const store = A.resolveStore("gameData/Weapons/containers/aero_7a_hydra_70.blk");
  const nodes = A.podTubeNodes(skeletonOf("lau_61ca"), "lau_61ca", 19, "us_hydra_70_m247_rocket");
  const ffar = A.podTubeNodes(skeletonOf("lau_61ca"), "lau_61ca", 19, "us_2_75_in_ffar_mighty_mouse_rocket");
  ok(nodes[0].startsWith("hydra_70_m247"), "two runs of 19 — the Hydra pod takes the Hydra run", nodes[0]);
  ok(ffar[0].startsWith("aero_7_ffar"), "…and the Mighty Mouse pod takes the FFAR run", ffar[0]);
  ok(store.perTier === 19, "amountPerTier is what says how many", String(store.perTier));
}

// End to end: a pod on an aircraft holds its full complement, each rocket in a different place.
console.log("\n=== A-10C, LAU-131 preset: seven rockets per pod, each in its own tube ===");
const pods = await place("a_10c", "a_10c_lau_131");
const rockets = pods.placed.filter(p => p.kind === "rocket");
console.log("  " + pods.placed.length + " instances: " +
  [...new Set(pods.placed.map(p => p.model))].join(", "));
ok(rockets.length >= 7, "the pod's rockets are all placed", rockets.length + " rockets");
{
  const byPod = new Map();
  for (const r of rockets) {
    const c = centre(pods.added.filter(g => g.weaponTag === r.tag));
    const k = c.map(v => Math.round(v)).join(",");
    byPod.set(k, (byPod.get(k) || 0) + 1);
  }
  const distinct = new Set(rockets.map(r => centre(pods.added.filter(g => g.weaponTag === r.tag)).map(v => v.toFixed(3)).join(",")));
  ok(distinct.size === rockets.length, "no two rockets sit in the same place",
     distinct.size + " distinct positions for " + rockets.length + " rockets");
}
{
  const podInst = pods.placed.find(p => p.kind === "rack");
  if (podInst) {
    const pb = bounds(pods.added.filter(g => g.weaponTag === podInst.tag));
    const mine = rockets.filter(r => {
      const c = centre(pods.added.filter(g => g.weaponTag === r.tag));
      return c[0] > pb[0] - .4 && c[0] < pb[3] + .4 && c[1] > pb[1] - .4 && c[1] < pb[4] + .4;
    });
    ok(mine.length >= 7, "the rockets sit inside the pod they belong to", mine.length + " within its bounds");
  } else ok(false, "the pod itself is in the scene");
}
let podWorst = 1;
for (const p of pods.placed) {
  const q = parity(pods.added.filter(g => g.weaponTag === p.tag));
  if (q < podWorst) podWorst = q;
}
ok(podWorst > .98, "pods and their rockets all keep parity", "worst " + podWorst.toFixed(3));

// ---------------------------------------------------------------- 3. the whole roster
console.log("\n=== every container in the game ===");
let racks = 0, single = 0, solved = 0, unsolved = 0;
const left = [];
for (const f of A.AcesDB.files) {
  if (!/^gamedata\/weapons\/containers\/.*\.blk$/i.test(f.name)) continue;
  const s = A.resolveStore(f.name);
  if (!s || s.missing || s.kind !== "rack" || !s.child) continue;
  const mesh = A.storeMesh(s);
  if (!mesh) continue;
  racks++;
  if (s.nodes.length || !(s.perTier > 1)) { single++; continue; }
  const nodes = A.podTubeNodes(skeletonOf(mesh), mesh, s.perTier, A.storeMesh(s.child) || s.child.path);
  if (nodes) solved++; else { unsolved++; left.push(A.blkBaseName(f.name) + "(" + s.perTier + ")"); }
}
console.log("  " + racks + " containers carry a store; " + single + " already name their stations");
ok(solved >= 77, "emitter-less pods resolved from their own skeletons", solved + " of " + (solved + unsolved));
// The remainder are chaff and flare dispensers claiming 16–200 rounds and two pods with no tube
// nodes; they fall back to one store at the pod origin, which is what they should do.
ok(unsolved <= 6, "the rest are dispensers, left alone", unsolved + ": " + left.join(" "));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
