// Does the moving-parts rig come out of real models correctly? Extracts a vehicle, builds the
// rig with the page's own /*==POSE==*/ code, and reports what each control found.
//
// Two kinds of control can come out of it and both are checked here: one driven by the vehicle's
// own baked animation (`<model>_anim`, see t27_a2d.mjs for the decoder), and the older kind whose
// hinge axis is inferred from the shape of the part, still used for tanks — whose clips carry only
// track roll — and for anything the install ships no clip for.
//
//   node --max-old-space-size=6144 tools/t22_pose.mjs [model ...]
import fs from "fs";
import path from "path";
import { installOodle } from "./oodle_lift.mjs";
import { fileURLToPath } from "url";
import { installOrExit, isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const WT = installOrExit();   // tools/wtdir.mjs: WT_DIR, else Steam's library list, else the usual folders
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " missing");
  return src.slice(a + 1, b);
};
function fnSrc(name) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("function " + name + " not found");
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(i + 1, j + 1); }
  }
  throw new Error("unterminated " + name);
}
globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: (await import("node:crypto")).webcrypto });
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, "base64").toString("latin1");
// The page's own decoder, whichever this build carries (tools/oodle_lift.mjs) — not a RAD-only
// shim, which is what stood here until 2026-09-20 and had been broken since the page stopped
// carrying RAD's blob.
installOodle(src);
const Z = new Function(section("ZSTD") + "\nreturn { zstdDec: Zstd.zstdDec };")();
globalThis.Zstd = { zstdDec: Z.zstdDec };   // the sections reach it as Zstd.zstdDec (ROADMAP 2.3)
const MOD = new Function(section("MODEL") +
  "\nreturn { grpParseFront, GRP_CLS, grpDecompress, MReader, loadDynModelBytes, buildDynModelGeometry, loadSkeletonBytes, skelSubtree };")();
const BLK = new Function(section("ZSTD") + "\n" + section("BLK") + "\n" + section("VROMFS") +
  "\nreturn { loadGameResDesc, descGetModel, buildDescBind, descMatName };")();
const A2D = new Function(section("A2D") +
  "\nreturn { parseA2D, a2dIndexNodes, a2dNodeNames, a2dRefFrame, a2dDeltas, a2dWorld };")();
for (const k of ["parseA2D", "a2dIndexNodes", "a2dNodeNames", "a2dRefFrame", "a2dDeltas", "a2dWorld"])
  globalThis[k] = A2D[k];

// ---- the browser globals the POSE section touches
const App = { geomData: null, meshes: new Map(), extracted: null, pose: {}, _poseRig: null, skinUnits: [] };
globalThis.App = App;
globalThis.THREE = null;                          // applyPose is not exercised here, only the rig
globalThis.$ = () => null;
globalThis.needsRender = () => {};
globalThis.vehicleClass = () => tankRig ? "tank" : "air";
// The tank half of the rig reads the unit's own datasheet (game/turret.js). Here the section is
// lifted for its arithmetic and the reader is stubbed: each model under test supplies its own
// record through `tankRig`, so a sweep of aircraft behaves exactly as it did.
let tankRig = null;
const TANK = new Function(section("TANKRIG").replace(/^"use strict";$/m, "") + "\nreturn { TankRig };")();
globalThis.TankRig = TANK.TankRig;
globalThis.TankData = { current: () => tankRig, cache: new Map() };
const pose = new Function(fnSrc("partNode") + "\n" + fnSrc("vehicleSkeleton") + "\n" + fnSrc("vehicleAnim") + "\n" +
  section("POSE") +
  "\nreturn { buildPoseRig, buildA2DRig, buildHingeRig, poseAxis, nodeLocalSpread, poseRest," +
  " POSE_CONTROLS, POSE_ROOTS, A2D_GROUPS };")();
globalThis.skelSubtree = MOD.skelSubtree;

function walk(dir, out = { grp: [], desc: [] }, depth = 0) {
  if (depth > 7) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) { if (/^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i.test(e.name)) continue; walk(p, out, depth + 1); }
    else if (/\.grp$/i.test(e.name)) out.grp.push(p);
    else if (/Desc\.bin$/i.test(e.name)) out.desc.push(p);
  }
  return out;
}
const found = walk(WT);
const dyn = new Map(), skel = new Map(), anim = new Map();
for (const p of found.grp) {
  try {
    const fd = fs.openSync(p, "r");
    const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
    const front = Buffer.alloc(0xC + h.readUInt32LE(8) + 4);
    fs.readSync(fd, front, 0, front.length, 0); fs.closeSync(fd);
    for (const e of MOD.grpParseFront(new Uint8Array(front)).entries) {
      if (e.classId === MOD.GRP_CLS.DynModel && !dyn.has(e.name)) dyn.set(e.name, { p, e });
      else if (e.classId === MOD.GRP_CLS.GeomNodeTree && !skel.has(e.name)) skel.set(e.name, { p, e });
      else if (e.classId === MOD.GRP_CLS.Anim2Data && !anim.has(e.name)) anim.set(e.name, { p, e });
    }
  } catch { }
}
const descDbs = [];
for (const p of found.desc) { try { descDbs.push(BLK.loadGameResDesc(new Uint8Array(fs.readFileSync(p)))); } catch { } }
function bindFor(model) { for (const db of descDbs) if (BLK.descGetModel(db, model)) return BLK.buildDescBind(db, model); return null; }
globalThis.descMatName = BLK.descMatName;

const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ["f_4e", "p_51d_5", "fa_18a", "su_30sm2", "bf_109f_4", "a_10a_late", "mi_24p",
     "leopard_2a4", "m1a2_sep3", "t_34_1941", "type_10", "bmp_1"];

let fails = 0, built = 0;
for (const m of models) {
  const dref = dyn.get(m), sref = skel.get(m + "_skeleton");
  if (!dref || !sref) { console.log("\n" + m + ": no model or skeleton"); continue; }
  built++;
  const dm = await MOD.loadDynModelBytes(new Uint8Array(fs.readFileSync(dref.p)).subarray(dref.e.offset, dref.e.offset + dref.e.size), m);
  const sk = MOD.loadSkeletonBytes(new Uint8Array(fs.readFileSync(sref.p)).subarray(sref.e.offset, sref.e.offset + sref.e.size));
  dm.skeleton = sk;
  const geo = MOD.buildDynModelGeometry(dm, 0);
  geo.skeleton = sk;                                 // extractVehicleGeometry does this in the page
  const bind = bindFor(m);
  // geomDataFromExtracted, in miniature: one entry per node with a flat position array
  App.geomData = geo.objects.map(o => {
    const vs = new Set();
    for (const g of o.groups) for (const f of g.faces) for (const v of f) vs.add(v);
    const pos = new Float32Array(vs.size * 3);
    let i = 0;
    for (const vi of vs) { const v = geo.verts[vi]; if (!v) continue; pos[i++] = v[0]; pos[i++] = v[1]; pos[i++] = v[2]; }
    return { name: o.name, mat: "m", position: pos.subarray(0, i) };
  }).filter(g => g.position.length);
  App.meshes = new Map(App.geomData.map(g => [g.name, {}]));
  const aref = anim.get(m + "_anim");
  if (aref) {
    try {
      const raw = new Uint8Array(fs.readFileSync(aref.p)).subarray(aref.e.offset, aref.e.offset + aref.e.size);
      geo.a2d = A2D.parseA2D(await MOD.grpDecompress(new MOD.MReader(raw, 0)));
    } catch (e) { console.log("  (a2d unreadable: " + e.message + ")"); }
  }
  App.extracted = { geo };
  App._poseRig = null;
  const rig = pose.buildPoseRig();
  console.log("\n=== " + m + " (" + App.geomData.length + " renderable nodes, skeleton " + sk.size +
    ", " + (geo.a2d ? "baked clip present" : "no baked clip") + ")");
  if (!rig || !rig.size) { console.log("  NO CONTROLS FOUND"); fails++; continue; }
  for (const c of pose.POSE_CONTROLS) {
    const e = rig.get(c.id);
    if (!e) continue;
    if (e.src === "a2d") {
      console.log("  " + c.label.padEnd(15) + "baked  " + String(e.nodes.length).padStart(4) + " nodes, rest at frame " +
        String(e.ref).padStart(3) + "   " + e.nodes.slice(0, 4).join(", ") + (e.nodes.length > 4 ? " …" : ""));
      if (!(e.ref >= 0 && e.ref <= 100)) { console.log("    FAIL rest frame " + e.ref + " out of range"); fails++; }
      // Posing back to the rest frame must land on the geometry as extracted, or the first touch
      // of the slider jerks the part. Measured against the skeleton's own world transforms.
      const set = new Set(e.nodes);
      const w = A2D.a2dWorld(geo.a2d, sk, n => set.has(n) ? e.ref : null);
      let worst = 0, worstN = "";
      for (const n of e.nodes) {
        const nd = sk.byName.get(n); if (!nd) continue;
        const d = Math.hypot(w[nd.i][0][3] - nd.wtm[0][3], w[nd.i][1][3] - nd.wtm[1][3], w[nd.i][2][3] - nd.wtm[2][3]);
        if (d > worst) { worst = d; worstN = n; }
      }
      if (worst > 0.05) { console.log("    FAIL at rest frame " + e.ref + ", " + worstN + " is " +
        worst.toFixed(2) + " m from where the geometry is"); fails++; }
    } else {
      const list = e.list;
      const parts = list.reduce((n, a) => n + a.members.length, 0);
      const axes = list.map(a => a.node + " ax[" + a.axis.map(v => v.toFixed(2)).join(",") + "] " + (a.sign > 0 ? "+" : "−"));
      console.log("  " + c.label.padEnd(15) + "hinge " + String(list.length).padStart(2) + " assembl" + (list.length === 1 ? "y " : "ies") +
        String(parts).padStart(4) + " parts   " + axes.slice(0, 2).join(" | ") + (axes.length > 2 ? " …" : ""));
      for (const a of list) {
        const len = Math.hypot(...a.axis);
        if (Math.abs(len - 1) > 0.02) { console.log("    FAIL non-unit axis on " + a.node + " (" + len.toFixed(3) + ")"); fails++; }
      }
    }
  }
  // No part may be claimed by two controls, whichever kind they are — a node rotated twice tears
  // away from the rest of its assembly.
  const seen = new Map();
  const claim = (p, id) => {
    if (seen.has(p)) { console.log("    FAIL " + p + " is claimed by both " + seen.get(p) + " and " + id); fails++; }
    seen.set(p, id);
  };
  for (const [id, e] of rig) {
    if (e.src === "a2d") for (const n of e.nodes) claim(n, id);
    else for (const a of e.list) for (const p of a.members) claim(p, id);
  }
}
// Nothing built is not a pass: a folder that only looks like an install, or a game update that moved
// the packs (CLAUDE.md §0.3), finds no model for any name above — and this used to print "all rigs
// built cleanly" over zero rigs, exit 0 (review of 2026-10-10).
if (!built) {
  console.log("\nFAIL none of the " + models.length + " models has a model and a skeleton in " + WT + " (" + dyn.size +
    " models, " + skel.size + " skeletons indexed) — no rig was built");
  fails++;
}
console.log(fails ? "\n" + fails + " problem(s)" : "\nall " + built + " rigs built cleanly, no part claimed twice");
process.exit(fails ? 1 : 0);
