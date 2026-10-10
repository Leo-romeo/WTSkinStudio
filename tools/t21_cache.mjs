// The stored game index has to come back exactly as it went in — every texture entry, every
// model-pack record, every pack path — or a cached start quietly reads textures from the wrong
// offsets. Runs the page's own /*==PACKS==*/ section under Node against a synthetic index the
// size of a real install, with IndexedDB stubbed by a plain object.
//
//   node --max-old-space-size=4096 tools/t21_cache.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " missing");
  return src.slice(a + 1, b);
};
// the constants and helpers the section leans on, lifted from the page so they cannot drift
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
const KNOWN_FMTS_SRC = /const KNOWN_FMTS = \[[^\]]*\];/.exec(src)[0];
const GRP_CLS_SRC = /const GRP_CLS = \{[^}]*\};/.exec(src)[0];
// the page's own header reader, so this test cannot drift from what decodeGameEntry actually does
const texHeaderView = new Function("return " + fnSrc("texHeaderView"))();

const store = new Map();
const prelude = `
  const GameDB = { entries: [], stems: new Map(), packs: 0, packList: [], models: [], descPaths: [], grpIndex: null };
  const App = { gameDir: null };
  ${KNOWN_FMTS_SRC}
  ${GRP_CLS_SRC}
  function oodleAvailable(){ return true; }
  ${fnSrc("parseTexName")}
  const idbSet = (k, v) => { store.set(k, v); return Promise.resolve(); };
  const idbGet = k => Promise.resolve(store.get(k) || null);
  const idbDel = k => { store.delete(k); return Promise.resolve(); };
  const console = globalThis.console;
`;
const mod = new Function("store", prelude + section("PACKS") +
  "\nreturn { GameDB, packAdd, saveGameIndex, restoreGameIndex, GAME_INDEX_KEY, GRP_CLS, parseTexName, KNOWN_FMTS, installFingerprint };")(store);

const { GameDB, packAdd, saveGameIndex, restoreGameIndex, GRP_CLS, parseTexName, KNOWN_FMTS, installFingerprint } = mod;

// ---- build an index the size of a real install ----
const N = 214000, NPACK = 6285, NDYN = 25774, NSKEL = 27398, NGRP = 3438;
const packs = [];
for (let p = 0; p < NPACK; p++) packs.push(packAdd("content/base/res/some_longish_pack_name_" + p + ".dxp.bin", null, null));
// The model packs go on the same list AFTER the texture packs (indexGrpPacks runs once the texture
// walk is done), and a fresh scan's GameDB.packs is the texture packs alone, set in between. The
// restore used to count the whole list: measured 2026-10-10 on the live install, every visit after
// the first said "from 9935 packs" where the first had said 6 428.
GameDB.packs = NPACK;
for (let p = 0; p < NGRP; p++) packAdd("content/base/res/some_model_pack_" + p + ".grp", null, null);
const tiers = ["", "$hq", "$uhq", "$tq"];
const fmts = ["DXT1", "DXT5", "ATI2", "BC7", "ZZZZ"];
const compName = { 0: "raw", 0x20: "zstd", 0x40: "lzma", 0x60: "oodle", 0x80: "zlib" };
let t = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  const header = new Uint8Array(32);
  const hv = new DataView(header.buffer);
  header[0] = 0x44; header[1] = 0x44; header[2] = 0x53; header[3] = 0x78;
  const f = fmts[i % fmts.length];
  for (let k = 0; k < 4; k++) header[4 + k] = f.charCodeAt(k);
  const comp = [0, 0x20, 0x60, 0x80][i % 4];
  hv.setUint32(8, (comp << 24) | 0x40000, true);
  hv.setUint16(12, 1 << (7 + (i % 6)), true);
  hv.setUint16(14, 1 << (7 + (i % 6)), true);
  // the fields only decodeGameEntry reads, each distinct per entry: a reader that drops the
  // restored view's byteOffset yields entry 0's numbers for all 214 000 of them
  hv.setUint8(0x10, 1 + (i % 12));                     // mip levels
  hv.setUint32(0x18, 4096 + i * 17, true);             // memSz  — the Oodle output size
  hv.setUint32(0x1c, 512 + i * 3, true);               // packedSz
  const name = "some_vehicle_texture_name_" + i + "_c" + tiers[i % 4];
  const { stem, tier } = parseTexName(name);
  const en = { name, stem, tier, pack: packs[i % packs.length], header,
    off: (i * 3571) >>> 0, size: 500 + i, fmt: f,
    w: hv.getUint16(12, true), h: hv.getUint16(14, true),
    supported: KNOWN_FMTS.includes(f), compName: compName[comp] };
  GameDB.entries.push(en);
  let rec = GameDB.stems.get(stem);
  if (!rec) GameDB.stems.set(stem, rec = { stem, tiers: {} });
  const prev = rec.tiers[tier];
  if (!prev || (en.size && en.w > prev.w) || (!prev.size && en.size)) rec.tiers[tier] = en;
}
const dyn = new Map(), skel = new Map(), anim = new Map();
for (let i = 0; i < NDYN; i++) dyn.set("model_" + i, { pack: packs[i % NPACK], e: { name: "model_" + i, offset: (i * 7777) >>> 0, size: i * 13 + 5, classId: GRP_CLS.DynModel } });
for (let i = 0; i < NSKEL; i++) skel.set("m_" + i + "_skeleton", { pack: packs[i % NPACK], e: { name: "m_" + i + "_skeleton", offset: (i * 31) >>> 0, size: i * 7 + 3, classId: GRP_CLS.GeomNodeTree } });
// The animation clips are a third resource kind in the same packed array, distinguished only by
// a trailing kind byte — put enough of them in to catch a kind index that lands one map over.
for (let i = 0; i < NSKEL; i++) anim.set("m_" + i + "_anim", { pack: packs[i % NPACK], e: { name: "m_" + i + "_anim", offset: (i * 53) >>> 0, size: i * 11 + 9, classId: GRP_CLS.Anim2Data } });
GameDB.grpIndex = { dyn, skel, anim };
GameDB.descPaths = ["content/base/res/dynModelDesc.bin", "content/pkg_infantry/res/riDesc.bin"];
GameDB.models = ["f_4e", "m1a2_sep3", "leopard_2a4"];
// Each unit's own model, read from its blk at scan time (GameUnits.ownModels, game/registry.js):
// 3 474 of them on the install of 2026-10-10. Stored so that a reopen decodes none of those blks.
GameDB.ownModels = new Map();
for (let i = 0; i < 3474; i++) GameDB.ownModels.set(i % 3 ? "unit_" + i : "us_unit-" + i, "model_" + (i % 1700));
const buildMs = Number(process.hrtime.bigint() - t) / 1e6;

const sig = () => ({
  entries: GameDB.entries.map(e => [e.name, e.stem, e.tier, e.pack, e.off, e.size, e.fmt, e.w, e.h, e.supported, e.compName].join("|")).join("\n"),
  // read back exactly as decodeGameEntry does, not straight out of the byte array — the restored
  // headers are views into one packed buffer and only this path notices a dropped byteOffset
  heads: GameDB.entries.map(e => {
    const h = texHeaderView(e);
    return [h.getUint32(8, true), h.getUint8(0x10), h.getUint32(0x18, true), h.getUint32(0x1c, true)].join("|");
  }).join("\n"),
  stems: [...GameDB.stems.keys()].sort().join("\n"),
  packs: GameDB.packList.map(p => p.path).join("\n"),
  dyn: [...GameDB.grpIndex.dyn].map(([k, v]) => k + "|" + v.pack + "|" + v.e.offset + "|" + v.e.size + "|" + v.e.classId).sort().join("\n"),
  skel: [...GameDB.grpIndex.skel].map(([k, v]) => k + "|" + v.pack + "|" + v.e.offset + "|" + v.e.size + "|" + v.e.classId).sort().join("\n"),
  models: GameDB.models.join("\n"), descPaths: GameDB.descPaths.join("\n"),
  own: GameDB.ownModels ? [...GameDB.ownModels].map(p => p.join("=")).join("\n") : "(none)",
});
const before = sig();

t = process.hrtime.bigint();
saveGameIndex("FP-TEST");
const saveMs = Number(process.hrtime.bigint() - t) / 1e6;

// wipe, then restore
GameDB.entries = []; GameDB.stems = new Map(); GameDB.packList = []; GameDB.packs = 0;
GameDB.grpIndex = null; GameDB.models = []; GameDB.descPaths = []; GameDB.ownModels = null;

const wrongFp = await restoreGameIndex("SOME-OTHER-FINGERPRINT");
t = process.hrtime.bigint();
const ok = await restoreGameIndex("FP-TEST");
const loadMs = Number(process.hrtime.bigint() - t) / 1e6;
const after = sig();

const rec = store.get(mod.GAME_INDEX_KEY);
const bytes = rec.names.length * 2 + rec.heads.length + rec.nums.byteLength + rec.grpNames.length * 2 + rec.grpNums.byteLength;

let fails = 0;
const check = (name, cond, extra) => { console.log((cond ? "  ok   " : "  FAIL ") + name + (extra ? "  " + extra : "")); if (!cond) fails++; };
console.log("\n=== stored game index round-trip (" + N.toLocaleString() + " textures, " +
  (NDYN + NSKEL).toLocaleString() + " model records, " + NPACK.toLocaleString() + " packs) ===");
check("a wrong install fingerprint is rejected", wrongFp === false);
check("restore reports success", ok === true);
check("texture entries identical", before.entries === after.entries);
const headsOk = before.heads === after.heads;
check("header fields identical as decodeGameEntry reads them", headsOk, headsOk ? "" : (() => {
  const a = before.heads.split("\n"), b = after.heads.split("\n");
  const i = b.findIndex((h, j) => h !== a[j]);
  return "entry " + i + " flags|levels|memSz|packedSz was " + a[i] + ", came back " + b[i];
})());
check("stem → tier map identical", before.stems === after.stems);
check("pack paths identical", before.packs === after.packs);
check("the pack count is the texture packs, as the fresh scan counted them — not the model packs too",
  GameDB.packs === NPACK, "restored " + GameDB.packs + ", fresh " + NPACK + " (+ " + NGRP + " model packs on the list)");
check("DynModel records identical (32-bit class ids survive)", before.dyn === after.dyn);
check("GeomNodeTree records identical", before.skel === after.skel);
check("Anim2Data records identical (not mixed into the other two maps)", before.anim === after.anim);
check("model list identical", before.models === after.models);
check("Desc.bin paths identical", before.descPaths === after.descPaths);
check("each unit's own model identical (" + (after.own === "(none)" ? 0 : after.own.split("\n").length) + " units)",
  before.own === after.own && after.own !== "(none)");
// A scan that could not read aces.vromfs.bin has no such map, and an index written before the map
// was stored has no field at all: both restore as "not read", so the next open reads the blks
// rather than trusting an empty map that would leave every vehicle to the name join.
{
  const keepOwn = GameDB.ownModels;
  GameDB.ownModels = null; saveGameIndex("FP-NONE");
  GameDB.ownModels = new Map([["x", "y"]]);
  const okNone = await restoreGameIndex("FP-NONE");
  check("an index saved with no unit models restores none, not an empty map", okNone && GameDB.ownModels === null);
  const old = Object.assign({}, store.get(mod.GAME_INDEX_KEY));
  delete old.own;
  store.set(mod.GAME_INDEX_KEY, old);
  GameDB.ownModels = new Map([["x", "y"]]);
  const okOld = await restoreGameIndex("FP-NONE");
  check("an index from before the field still restores, and the unit models are read anew", okOld && GameDB.ownModels === null);
  // A read that left some blks unread is used for that visit but not kept: kept, the next open would
  // place those vehicles by name and say nothing, where reading again says it again (CLAUDE.md §4).
  GameDB.ownModels = new Map([["f-4e", "f_4e"]]); GameDB.ownUnread = 2; saveGameIndex("FP-PART");
  GameDB.ownModels = new Map([["x", "y"]]); GameDB.ownUnread = 0;
  const okPart = await restoreGameIndex("FP-PART");
  check("an index saved after some unit blks could not be read keeps none of them, so the next open reads and says it again",
    okPart && GameDB.ownModels === null);
  // An empty read (no unit had a blk — a registry that did not load) is no answer: kept, every
  // reopen would place every vehicle by name without reading again.
  GameDB.ownModels = new Map(); saveGameIndex("FP-EMPTY");
  GameDB.ownModels = new Map([["x", "y"]]);
  const okEmpty = await restoreGameIndex("FP-EMPTY");
  check("an index saved after an empty read keeps no unit models, so the next open reads again", okEmpty && GameDB.ownModels === null);
  GameDB.ownModels = keepOwn; GameDB.ownUnread = 0;
}
// ---- the fingerprint has to see a content pack arrive ----
// Steam installing the ultra-quality ground textures adds content.hq/uhq_vehicles/ and a
// content/pkg_uhq_vehicles.ver stamp, and touches none of the three files a patch rewrites
// (measured on the live install 2026-08-11: the pack landed 23:59, warthunder.yup was still
// 13:20). A fingerprint built only from those three said "unchanged", the scan was skipped, and
// every ground vehicle kept its old 2048² sheet while the 4096² one sat unread. Model the whole
// shape here rather than the one file, so the next pack layout Gaijin ships is caught too.
const file = (size, lastModified) => ({ kind: "file", size, lastModified });
const dirOf = tree => ({
  kind: "directory",
  async getFileHandle(name){
    const e = tree[name];
    if (!e || e.kind !== "file") throw new Error("NotFoundError: " + name);
    return { kind: "file", getFile: async () => e };
  },
  async getDirectoryHandle(name){
    const e = tree[name];
    if (!e || e.kind !== "directory") throw new Error("NotFoundError: " + name);
    return dirOf(e.tree);
  },
  async *entries(){
    for (const [k, v] of Object.entries(tree))
      yield [k, v.kind === "directory" ? dirOf(v.tree) : { kind: "file", getFile: async () => v }];
  },
});
const subdir = tree => ({ kind: "directory", tree });
const PATCH_T = 1786000000000, DLC_T = 1786037940000;   // 13:20 and 23:59
// the install as it stood before the DLC, trimmed to what the fingerprint reads
const baseInstall = () => ({
  "warthunder.yup": file(9766066, PATCH_T),
  "aces.vromfs.bin": file(17712345, PATCH_T),
  "char.vromfs.bin": file(1114358, PATCH_T),
  content: subdir({
    base: subdir({}), pkg_infantry: subdir({}), pkg_local: subdir({}),
    "pkg_main.ver": file(9, PATCH_T), "pkg_main.rq2": file(9, PATCH_T),
    "pkg_uhq_aircraft.ver": file(9, PATCH_T), "pkg_uhq_aircraft.rq2": file(9, PATCH_T),
    "warthunder.blk": file(1590865, PATCH_T),
  }),
  "content.hq": subdir({ hq_tex: subdir({}), pkg_cockpits: subdir({}), uhq_aircraft: subdir({}) }),
});
const withGroundDlc = () => {
  const t = baseInstall();
  t["content.hq"].tree.uhq_vehicles = subdir({});          // 944 packs' worth of new textures
  t.content.tree["pkg_uhq_vehicles.ver"] = file(9, DLC_T);
  t.content.tree["pkg_uhq_vehicles.rq2"] = file(9, DLC_T);
  return t;
};
const fpOf = tree => installFingerprint(dirOf(tree));
const fpBefore = await fpOf(baseInstall());
const fpAfter = await fpOf(withGroundDlc());
check("a content pack install changes the fingerprint (the DLC bug)", fpBefore !== fpAfter);
check("...even though no patch file moved",
  /warthunder\.yup:9766066:1786000000000/.test(fpAfter) && fpBefore.split("|content[")[0] === fpAfter.split("|content[")[0]);
check("uninstalling it goes back to the old fingerprint", (await fpOf(baseInstall())) === fpBefore);
check("an unchanged install still matches, so a warm start keeps its cache",
  (await fpOf(withGroundDlc())) === fpAfter);
// The directory-order guard matters more than it looks: an unstable fingerprint would never
// match, so every visit would pay the full walk and the cache would be dead weight.
const shuffled = () => {
  const t = withGroundDlc();
  for (const sub of ["content", "content.hq"])
    t[sub].tree = Object.fromEntries(Object.entries(t[sub].tree).reverse());
  return t;
};
check("directory iteration order does not move it", (await fpOf(shuffled())) === fpAfter);
const updatedInPlace = () => {
  const t = withGroundDlc();
  t.content.tree["pkg_uhq_vehicles.ver"] = file(9, DLC_T + 86400000);   // same size, new version
  return t;
};
check("a pack updated in place changes it", (await fpOf(updatedInPlace())) !== fpAfter);
const slim = () => { const t = baseInstall(); delete t["content.hq"]; return t; };
const fpSlim = await fpOf(slim());
check("an install with no content.hq is fingerprinted, not an error", !!fpSlim && fpSlim !== fpBefore);
check("...and is stable across visits", (await fpOf(slim())) === fpSlim);

console.log("\n  built in " + buildMs.toFixed(0) + " ms · serialised in " + saveMs.toFixed(0) +
  " ms · restored in " + loadMs.toFixed(0) + " ms · cache " + (bytes / 1048576).toFixed(1) + " MB");
if (fails) { console.log("\n" + fails + " check(s) failed"); process.exit(1); }
console.log("\nall checks passed");
