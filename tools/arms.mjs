// Run the app's own ZSTD + BLK + VROMFS + ACES + ARMS + ARMSTM sections under Node, against the live
// install, with only the browser-only bits stubbed. This is the offline harness for armament.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { installOrExit, isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
// Resolved at import, because importing this module IS indexing the install: only install tools
// import it (checked 2026-10-10 — t12, t14, t15, t18, t26, t65, t72, t103, turret_sweep).
export const WT = installOrExit();
const src = fs.readFileSync(HTML, "utf8");
// Markers sit alone at the start of a line; prose elsewhere in the page mentions them inline.
function section(name) {
  const a = src.search(new RegExp("[\\n>]/\\*==" + name + "==\\*/"));
  const b = src.indexOf("\n/*==END" + name + "==*/");
  if (a < 0) throw new Error("section " + name + " not found");
  if (b < 0) throw new Error("section " + name + " has no END marker");
  return src.slice(a + 1, b);
}
const blob = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src);
if (!blob) throw new Error("ZSTD_WASM_B64 blob not in the page");
globalThis.ZSTD_WASM_B64 = blob[1];
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: (await import("node:crypto")).webcrypto });

// --- index every .grp: DynModel + GeomNodeTree names, so storeMesh() can pick nation variants
const M = new Function(section("MODEL") + "\nreturn { grpParseFront, GRP_CLS, loadSkeletonBytes };")();
function walkGrp(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) walkGrp(p, out); else if (/\.grp$/i.test(e.name)) out.push(p);
  }
  return out;
}
const dyn = new Map(), skelRefs = new Map();
for (const p of walkGrp(WT)) {
  try {
    for (const e of M.grpParseFront(new Uint8Array(fs.readFileSync(p))).entries) {
      if (e.classId === M.GRP_CLS.DynModel && !dyn.has(e.name)) dyn.set(e.name, { p, e });
      else if (e.classId === M.GRP_CLS.GeomNodeTree && !skelRefs.has(e.name)) skelRefs.set(e.name, { p, e });
    }
  } catch { /* not a readable pack */ }
}
export const grp = { dyn, skelRefs };
const skelCache = new Map();
export function skeletonOf(model) {
  if (skelCache.has(model)) return skelCache.get(model);
  let sk = null;
  const ref = skelRefs.get(model + "_skeleton");
  if (ref) {
    const u8 = new Uint8Array(fs.readFileSync(ref.p));
    sk = M.loadSkeletonBytes(u8.subarray(ref.e.offset, ref.e.offset + ref.e.size));
  }
  skelCache.set(model, sk);
  return sk;
}

// --- browser-only stubs the armament code touches
globalThis.GameDB = { grpIndex: { dyn, skel: skelRefs } };
globalThis.GameUnits = { weaponNames: new Map() };      // PresetInfo.name reads it; the page fills it from lang.vromfs.bin
globalThis.App = { gameDir: null, skinUnits: null, vehicleKey: null };

// ACES was inside VROMFS until the layer split (ROADMAP 2.2) put game/aces.js in its own section.
const code = section("ZSTD") + "\n" + section("BLK") + "\n" + section("VROMFS") + "\n" +
  section("ACES") + "\n" + section("ARMS") + "\n" + section("ARMSTM") + "\n" +
  "return { AcesDB, WeaponDB, ensureAces, acesBlk, acesHas, acesKey, blkParams, blkList, blkChildren," +
  " readVromfs, vromfsNameMap, loadVromfsBlk, zstdDec: Zstd.zstdDec, zstdDict: Zstd.zstdDict, resolveStore, storeMesh, storeModels," +
  " storePayload, storeCount, blkBaseName, unitArmament, readArmament, acesUnitPath, acesUnitPaths," +
  " loadoutStations, loadoutModels, matFlipZ, matMul, transformGeom, matDet3, flipWinding," +
  " placeGeom, podTubeNodes };";
export const A = new Function(code)();

// --- stand in for the File System Access handle ensureAces expects
const fakeDir = {
  getFileHandle: async name => {
    const p = path.join(WT, name);
    if (!fs.existsSync(p)) throw new Error("not found: " + name);
    return { getFile: async () => ({ arrayBuffer: async () => fs.readFileSync(p).buffer.slice(0) }) };
  },
};
export const ready = await A.ensureAces(fakeDir);
if (!ready) throw new Error("ensureAces failed: " + (A.AcesDB.error && A.AcesDB.error.message));
