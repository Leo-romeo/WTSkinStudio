// Each vehicle row loads its own model — the page's own join, run under Node against the install.
//
// WHY THIS EXISTS. Measured 2026-10-10 in real Chrome on the real install: the vehicle list joined
// models to units by NAME alone. `boat_a` loses its class token and reduces to "a", and with no floor
// on the name tiers every unit whose key starts with "a" was joined to it — 126 rows, 17 of them
// ranked vehicles (the A-20G-25, the A-26C-45DT, the Thai A-7E, the A13 Mk I (3rd R.T.R.)) — and the
// Kurnass 2000 sat on f_4e although kurnass_2000 is installed. Over the whole roster the name join
// put 185 of the 3 454 units whose own model is installed on the wrong one. Each unit's own blk names
// its model (`model:t=` at the root of gamedata/flightmodels/<unit>.blk and the units/ folders), and
// that is what the join reads now (`GameUnits.ownModels`, `buildModelUnitJoin` in game/registry.js).
//
// This lifts the page's REGISTRY section with what it reads through (ZSTD, BLK, VROMFS, ACES, ARMS),
// builds the unit registry and the model list the way game/units.js and loadDescFiles do, and holds:
//   * every unit whose own model is installed is on that model, and on no other;
//   * the seven vehicles the review named each load their own model;
//   * boat_a carries no unit whose blk names another model;
//   * no two rows are the same row (name, model, tree, operator, rank, class) — those merge.
// The install-free half — a fixture roster with boat_a and "a…" units — is in tools/t49_family.mjs.
//
// Usage: node tools/t138_join.mjs [--rows <out.json>]      (finds the install itself; WT_DIR overrides)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { installOrExit, isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url));
// No install is a failure, not a SKIP: this test exists to read the real roster (tools/wtdir.mjs).
const WT = installOrExit();
const argv = process.argv.slice(2);
const src = fs.readFileSync(HTML, "utf8");
const sec = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " not in the page");
  return src.slice(a + 1, b);
};
globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, "base64").toString("latin1");
globalThis.GameDB = { models: [], grpIndex: null };   // game/packs.js declares it outside every section
globalThis.App = { gameDir: null };
const P = new Function(sec("ZSTD") + "\n" + sec("BLK") + "\n" + sec("VROMFS") + "\n" + sec("ACES") + "\n" +
  sec("ARMS") + "\n" + sec("REGISTRY") +
  "\nreturn { readVromfs, vromfsNameMap, loadSlimDataBlock, vromfsBlkBody, loadGameResDesc, parseUnitsCsv," +
  " parseUnitRanks, parseShopTree, buildUnitIndex, GameUnits, buildModelUnitJoin, ensureAces, AcesDB, zstdDec: Zstd.zstdDec };")();
globalThis.Zstd = { zstdDec: P.zstdDec };   // the sections reach it as Zstd.zstdDec (ROADMAP 2.3)

let checks = 0, fails = 0;
const is = (c, m) => { checks++; if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };

// ---- the registry, as game/units.js reads it
const lang = P.readVromfs(new Uint8Array(fs.readFileSync(path.join(WT, "lang.vromfs.bin"))));
const csv = P.parseUnitsCsv(new TextDecoder().decode(lang.find(f => /(^|\/)units\.csv$/i.test(f.name)).data));
const chr = P.readVromfs(new Uint8Array(fs.readFileSync(path.join(WT, "char.vromfs.bin"))));
const nm = P.vromfsNameMap(chr.find(f => /(^|\/)\??nm$/.test(f.name)).data);
const blk = re => { const f = chr.find(x => re.test(x.name)); return f ? P.loadSlimDataBlock(P.vromfsBlkBody(f.data), nm) : null; };
P.buildUnitIndex(csv, blk(/unittags\.blk$/i), { ranks: P.parseUnitRanks(blk(/wpcost\.blk$/i)), shop: P.parseShopTree(blk(/(^|\/)shop\.blk$/i)) });
// ---- the model list, as loadDescFiles builds it (same walk as scanGameDir, same filter)
const SKIP = /^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i;
const descs = [];
(function walk(d, depth) {
  if (depth > 7) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (isDirEntry(e, p)) { if (!SKIP.test(e.name)) walk(p, depth + 1); }
    else if (/Desc\.bin$/i.test(e.name)) descs.push(p);
  }
})(WT, 0);
const names = new Set();
for (const p of descs) {
  const db = P.loadGameResDesc(new Uint8Array(fs.readFileSync(p)));
  for (const c of db.root.children) { const n = db.name(c); if (n && n !== "(root)") names.add(n); }
}
GameDB.models = [...names].filter(n => !/_(xray|collision|dm|dead|destroyed|dstr|gun|fx)$/.test(n)).sort();
// ---- the data tree, and the join itself
const fakeDir = { getFileHandle: async n => ({ getFile: async () => ({ arrayBuffer: async () => fs.readFileSync(path.join(WT, n)).buffer.slice(0) }) }) };
if (!await P.ensureAces(fakeDir)) { console.log("FAIL: aces.vromfs.bin could not be read: " + P.AcesDB.error); process.exit(1); }
const t0 = performance.now();
// The page reads these in a worker pool (GameScan.readRoots), whose op is GameUnits.rootParams' own
// text; here that function runs in-line, on the same packed jobs GameUnits.ownModels hands the pool.
const read = jobs => jobs.map(a => P.GameUnits.rootParams(a));
const res = await P.GameUnits.ownModels(read, 1);
const own = res.models;
const tOwn = performance.now() - t0;
P.buildModelUnitJoin(own);
const rows = GameDB.vehicleRows, U = P.GameUnits;
const rowOf = new Map();
for (const r of rows) for (const u of r.units) rowOf.set(u.id, r);
const modelSet = new Set(GameDB.models);
console.log(`${U.list.length} units, ${GameDB.models.length} models, ${own.size} unit blks naming a model (read in ${tOwn.toFixed(0)} ms), ${rows.length} rows`);
const per = new Map(); for (const r of rows) per.set(r.model, (per.get(r.model) || 0) + 1);
console.log("most rows on one model: " + [...per].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, n]) => m + " ×" + n).join(", "));
if (argv.includes("--rows")) fs.writeFileSync(argv[argv.indexOf("--rows") + 1], JSON.stringify(rows.map(r => ({ model: r.model, units: r.units.map(u => u.id), name: r.unit.name, rank: r.unit.rank, tree: r.unit.tree }))));

console.log("\n=== every unit is on the model its own blk names ===");
is(own.size > 3000 && res.unread === 0, `the unit blks were read: ${own.size} of ${U.list.length} units name a model, ${res.unread} unreadable`);
let right = 0, wrong = [], absent = 0;
for (const [id, m] of own) {
  if (!modelSet.has(m)) { if (rowOf.has(id)) wrong.push(id + " has a row though its model " + m + " is not installed"); else absent++; continue; }
  const r = rowOf.get(id);
  if (r && r.model === m) right++; else wrong.push(id + " → " + (r ? r.model : "no row") + ", its blk says " + m);
}
is(wrong.length === 0, `${right} units on their own model, ${absent} whose model is not in this install left out, ${wrong.length} wrong` +
  (wrong.length ? ":\n        " + wrong.slice(0, 12).join("\n        ") : ""));

console.log("\n=== the vehicles the review named each load their own model ===");
for (const [id, want] of [["f-4e", "f_4e"], ["us_m1a2_sep3_abrams", "m1a2_sep3"], ["bf-109f-4", "bf_109f_4"], ["su_30sm2", "su_30sm2"],
                          ["f-4e_kurnass_2000", "kurnass_2000"], ["a_7e", "a_7e"], ["a_7e_thailand", "a_7e"],
                          ["uk_a_13_mk1", "a13_mk_1"], ["uk_a_13_mk1_3rd_rtr", "a13_mk_1"]]) {
  const r = rowOf.get(id);
  is(r && r.model === want && own.get(id) === want, `${id} (${U.byId.get(id) ? U.byId.get(id).name : "?"}) loads ${r ? r.model : "nothing"} — its blk says ${own.get(id)}`);
}

console.log("\n=== boat_a is a boat again ===");
const onBoat = rows.filter(r => r.model === "boat_a");
const stray = onBoat.flatMap(r => r.units).filter(u => own.has(u.id) && own.get(u.id) !== "boat_a");
is(stray.length === 0 && onBoat.length <= 3, `boat_a carries ${onBoat.length} row(s) (126 on 2026-10-10), none of them a unit whose blk names another model` +
  (onBoat.length ? ": " + onBoat.map(r => r.units.map(u => u.id).join("+")).join(", ") : ""));
const ranked = onBoat.filter(r => r.unit.rank).length;
is(ranked === 0, `no ranked vehicle is on boat_a (${ranked}; 17 on 2026-10-10)`);

console.log("\n=== a row the list cannot tell from another is one row ===");
const keys = new Map();
for (const r of rows) {
  const u = r.unit, k = [u.name, r.model, u.tree, u.countryTag, u.rank, u.cls].join("|");
  keys.set(k, (keys.get(k) || 0) + 1);
}
const dup = [...keys].filter(([, n]) => n > 1);
is(dup.length === 0, `${rows.length} rows, ${dup.length} drawn twice` + (dup.length ? ": " + dup.slice(0, 5).map(d => d[0]).join("; ") : ""));
const f4 = rowOf.get("f-4e");
is(f4 && f4.units.map(u => u.id).includes("f_4e_event") && f4.unit.id === "f-4e",
  `the F-4E is one row for ${f4 ? f4.units.map(u => u.id).join(", ") : "nothing"}, shown as f-4e`);
const p47 = rowOf.get("p-47m-1-re_boxted");
is(p47 && p47.units.some(u => /Lanovski/.test(u.fullName)) && p47.units.some(u => /Bostwick/.test(u.fullName)),
  `a merged row keeps every unit, and so every full name to be found by: ${p47 ? p47.units.map(u => u.fullName).join(" / ") : "no row"}`);

console.log("\n=== rows drawn alike but for the model are marked, and each leads with what tells it apart ===");
// What a row shows before its model: the name, the class icon, the rank and the nation (tree and
// operator flags). Rows that share all of it differ only in the model, which came last in a
// subtitle cut to ~10 characters at real window sizes (review of 2026-10-10: 13 such groups).
const look = new Map();
for (const r of rows) {
  const u = r.unit, k = [u.name, u.tree, u.countryTag, u.rank, u.cls].join("|");
  if (!look.has(k)) look.set(k, []);
  look.get(k).push(r);
}
const unmarked = [], alone = [];
for (const g of look.values()) for (const r of g) {
  if (g.length > 1 && !r.twin) unmarked.push(r.unit.id);
  if (g.length === 1 && r.twin) alone.push(r.unit.id);
}
const twins = rows.filter(r => r.twin);
is(unmarked.length === 0 && alone.length === 0 && twins.length > 0,
  `${twins.length} rows in ${[...look.values()].filter(g => g.length > 1).length} groups are twins, ${unmarked.length} unmarked, ${alone.length} marked alone` +
  (unmarked.length + alone.length ? ": " + unmarked.concat(alone).slice(0, 8).join(", ") : ""));
const named = ["IS-2", "T-72B3", "Comet I", "Leopard 2A4M", "M1A1 HC", "Type 90 (B)", "Challenger 2 OES", "MBT-2000",
  "Sd.Kfz.234/2", "9K317M", "Radar", "SAM", "Studebaker US6"];
const notTwin = named.filter(n => twins.filter(r => r.unit.name === n).length < 2);
is(notTwin.length === 0, `the 13 groups the review saw drawn alike are each marked` + (notTwin.length ? " — not: " + notTwin.join(", ") : ""));
// …and what a twin leads with (`tell`, its model less the longest start it shares with a sibling)
// tells it from every other row of its group within the first 6 characters, the most a cut subtitle
// is sure to show: the whole model did not — leopard_2a4m_can / leopard_2a4m_can_sm_elsa share 16,
// the Challenger 2 OES pair 21, the cargo ships "cargo_ship_" — and nor did the model less the start
// the whole group shares, which left the US and USSR Radar groups blurred (fix round 2: the Hawks'
// "…23_hawk_radar_cwar" / "…23_hawk_radar_an_mpq46", the S-300's two "s300ps_…").
const blurred = [];
for (const g of look.values()) {
  if (g.length < 2) continue;
  const heads = g.map(r => String(r.tell == null ? "" : r.tell).slice(0, 6));
  if (g.some(r => !r.tell) || new Set(heads).size < g.length) blurred.push(g[0].unit.name + " [" + g.map(r => r.tell).join(" / ") + "]");
}
is(blurred.length === 0, `every twin group's rows lead with tells that differ in their first 6 characters` +
  (blurred.length ? " — not: " + blurred.slice(0, 8).join("; ") : ""));
// …and no tell READS AS a sibling's: a "…" that could stand for it — what the tell shows is the end of
// what the sibling shows, behind a different start. The check above passed "…152mm_coastal_a" beside
// "us_152mm_coastal_a" (pillbox-tell, 2026-10-10: the one such row in the install's 634 rows whose name repeats).
const shows = r => r.tell[0] === "…" ? r.tell.slice(1) : r.tell, hides = r => r.model.slice(0, r.model.length - shows(r).length);
const misread = [];
for (const g of look.values()) if (g.length > 1 && g.every(r => r.tell)) for (const a of g) for (const b of g)
  if (a !== b && a.tell[0] === "…" && hides(a) !== hides(b) && shows(b).endsWith(shows(a))) misread.push(`${a.tell} as ${b.tell}`);
is(misread.length === 0, `no twin's tell reads as a sibling's` + (misread.length ? " — not: " + misread.slice(0, 8).join("; ") : ""));

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
