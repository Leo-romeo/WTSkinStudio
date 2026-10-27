// A .blk must name textures the vehicle it is written for actually has.
//
// Reported by the owner 2026-08-23, with the artifact: exporting an F-4E skin wrote seven .blk
// files — f-4e, f_4e_event, f-4ej, f-4ej_adtw, f-4ej_kai, f-4e_iaf, f-4e_kurnass_2000 — and every
// one of them said `from:"f_4e_c*"`. Five of those seven fly a different model with a different
// albedo (f_4ej_c, f_4ej_kai_c, f_4e_iaf_c, kurnass_2000_c), so the replace matched nothing and
// the skin silently did nothing on them.
//
// The units are pre-ticked by NAME — `unitsForModelStrong` scores anything starting with the model
// name at 80 — while the game matches by texture. The unit's own blk names its model and
// dynModelDesc names that model's textures, so the right answer is looked up, never guessed
// (CLAUDE.md §1: the desc beats name heuristics).
//
// WHY NOT REMAP THE STEM instead, writing `from:"f_4ej_c*"` and shipping the same pixels? Measured
// across the roster: matching a parent material to its counterpart on a variant works for 6.2 % of
// sheets, because material naming is not consistent between variants. A wrong remap paints the
// wrong sheet, which is worse than writing no line at all.
//
// AND THE JOIN THAT PICKS THE FAMILY (2026-10-10). The vehicle list joined units to models by name,
// and `boat_a` — "a" once its class token is off — took every unit whose key starts with "a". The
// second half runs the page's own buildModelUnitJoin and refreshSkinUnits on a fixture roster with
// boat_a, the "a…" units it swallowed and the F-4E family: no one-letter family by name, every unit
// on the model its own blk names (even against a perfect name match), units the list cannot tell
// apart as one row and rows alike but for the model marked as twins, and a load ticking exactly the
// units whose blk names the model, a ranked one with a real class first. Then the blks themselves:
// read in a real worker pool from a stand-in archive built here (CLAUDE.md §3.1), the same bytes as
// on this thread, an unreadable one said on the status line, and none read when the stored index
// already has them. tools/t138_join.mjs holds the join over the install.
//
// Usage: node tools/t49_family.mjs [--keep] [--chrome <path>]
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// The real F-4E family, exactly as the install has it. Kept as a fixture rather than read from the
// game so this runs with no install — the shape is what matters, and it is the reported case.
const BODY = `async function(){
  var out = {};

  // --- stand in for the two authoritative lookups, with the install's real values
  var UNIT_MODEL = {
    "f-4e": "f_4e", "f_4e_event": "f_4e",
    "f-4ej": "f_4ej", "f-4ej_adtw": "f_4ej", "f-4ej_kai": "f_4ej_kai",
    "f-4e_iaf": "f_4e_iaf", "f-4e_kurnass_2000": "kurnass_2000"
  };
  var MODEL_STEMS = {
    f_4e:         ["f_4e_c", "f_4e_add_c", "f_4c_inside_c", "f_4c_pylon1_c"],
    f_4ej:        ["f_4ej_c", "f_4c_inside_c", "f_4c_pylon1_c"],
    f_4ej_kai:    ["f_4ej_kai_c", "f_4c_inside_c", "f_4c_pylon1_c"],
    f_4e_iaf:     ["f_4e_iaf_c", "f_4e_add_c", "f_4c_inside_c", "f_4c_pylon1_c"],
    kurnass_2000: ["kurnass_2000_c", "f_4c_pylon1_c"]
  };
  var realModelForUnit = modelForUnit, realStemsForUnit = stemsForUnit;
  modelForUnit = function(u){ return UNIT_MODEL[u] || null; };
  stemsForUnit = function(u){
    var m = UNIT_MODEL[u];
    return m && MODEL_STEMS[m] ? new Set(MODEL_STEMS[m]) : null;
  };

  var UNITS = Object.keys(UNIT_MODEL);
  // what the user painted: the F-4E's own albedo
  var items = [{ kind: "c", fromStem: "f_4e_c", fileName: "f_4e_c.dds" }];

  out.perUnit = {};
  for (var i = 0; i < UNITS.length; i++) {
    var u = UNITS[i];
    var r = itemsForUnit(u, items);
    out.perUnit[u] = { keep: r.keep.length, drop: r.drop.length, known: r.known,
                       blk: r.keep.length ? buildBlk(r.keep, "replace_tex", []) : null };
  }

  // a second sheet that IS shared across the family
  var shared = [{ kind: "c", fromStem: "f_4c_pylon1_c", fileName: "f_4c_pylon1_c.dds" }];
  out.sharedKeeps = UNITS.filter(function(u){ return itemsForUnit(u, shared).keep.length > 0; }).length;

  // both together: the variants must keep the shared one and lose the F-4E-only one
  var both = items.concat(shared);
  var ej = itemsForUnit("f-4ej", both);
  out.mixed = { keep: ej.keep.map(function(i2){ return i2.fromStem; }), drop: ej.drop.map(function(i2){ return i2.fromStem; }) };

  // --- the escape hatch: no desc, no opinion. An imported .obj must export exactly as before.
  stemsForUnit = function(){ return null; };
  var unknown = itemsForUnit("whatever", items);
  out.unknown = { keep: unknown.keep.length, drop: unknown.drop.length, known: unknown.known };

  modelForUnit = realModelForUnit; stemsForUnit = realStemsForUnit;

  // --- the join itself (2026-10-10): a fixture roster with boat_a and the "a…" units it swallowed,
  // and the F-4E family. Real ids, names, ranks and blk models from the install of that day.
  var keepU = { byId: new Map(GameUnits.byId), list: GameUnits.list, loaded: GameUnits.loaded,
    nations: GameUnits.nations, maxRank: GameUnits.maxRank };
  var keepDB = { models: GameDB.models, rows: GameDB.vehicleRows, um: GameDB.unitModel, mu: GameDB.modelUnits,
    key: App.vehicleKey, su: App.skinUnits };
  try {
    var ROSTER = [
      // id, name, rank, its blk's model (null: the unit has no blk, like the AI guns), class (air if none)
      ["a-20g", "A-20G-25", 2, "a_20g"], ["a-26c-45-dt", "A-26C-45DT", 4, "a_26c_45dt"],
      ["a_7e", "A-7E", 7, "a_7e"], ["a_7e_thailand", "A-7E", 7, "a_7e"],
      ["uk_a_13_mk1", "A13 Mk I", 1, "a13_mk_1"], ["uk_a_13_mk1_3rd_rtr", "A13 Mk I (3rd R.T.R.)", 1, "a13_mk_1"],
      ["air_defence/germ_20mm_flak38", "AAA", 0, null], ["us_boat_a", "Boat A", 0, null],
      ["f-4e", "F-4E Phantom II", 7, "f_4e"], ["f_4e_event", "F-4E Phantom II", 7, "f_4e"], ["nt_f_4e", "F-4E Phantom II", 7, "f_4e"],
      ["f-4e_kurnass_2000", "Kurnass 2000", 8, "kurnass_2000"], ["f-4ej", "F-4EJ Phantom II", 7, "f_4ej"],
      // (review of 2026-10-10) a unit whose NAME is a perfect match for one model while its blk names
      // another: by name uk_m3_stuart is m3_stuart (100), its blk says stuart_I — one of the 8 units
      // the install put on the wrong model when the blk's precedence was taken out
      ["uk_m3_stuart", "Stuart I", 1, "stuart_I", "tank"],
      // units on one model that only their blks place (each scores 0 by name): whichever leads names
      // the .blk, the Vehicle field, the rank and the class. A ranked vehicle leads an unranked AI
      // copy of the same class (the real 9s18_m3 pair)…
      ["ussr_ai_sam_radar_9s18", "9S18M1", 0, "9s18_m3", "tank"], ["ussr_buk_m3_fcs", "9K317M", 8, "9s18_m3", "tank"],
      // …and between two with no rank, a real class leads "other" (shaped like m4a2_sherman_1944's
      // pair, which id order led with the class-less copy)
      ["us_m4a2_1944", "M4A2 (1944)", 0, "m4a2_sherman_1944", "other"], ["us_m4a2_sherman", "M4A2", 0, "m4a2_sherman_1944", "tank"],
      // rows the list draws alike but for the model, as the install has them: the skin-pack copy of a
      // tank, whose model only goes on from the base one's (and Challenger's shares its first 21
      // characters, more than a subtitle shows); ships whose models part mid-word after a shared
      // "cargo_ship_"; and the install's four pillboxes, whose models share no start as a group but
      // two of which share "swe_" — and "…152mm_coastal_a" past it read as "us_152mm_coastal_a"
      // beside it (pillbox-tell, 2026-10-10: the join's fix had cut both Swedish rows to "…")
      ["germ_leopard_2a4m_can", "Leopard 2A4M CAN", 7, "leopard_2a4m_can", "tank"],
      ["germ_leopard_2a4m_can_sm", "Leopard 2A4M CAN", 7, "leopard_2a4m_can_sm_elsa", "tank"],
      ["uk_challenger_2_megatron", "Challenger 2 OES", 7, "challenger_2_megatron", "tank"],
      ["uk_challenger_2_megatron_sm", "Challenger 2 OES", 7, "challenger_2_megatron_sm_emily", "tank"],
      ["uk_cargo_ship_liberty", "Cargo ship", 0, "cargo_ship_liberty", "other"],
      ["germ_cargo_ship_goldenfels", "Cargo ship", 0, "cargo_ship_goldenfels", "other"],
      ["germ_3x280mm_sk_c34_for_land_battles", "Pillbox", 0, "3x280mm_sk_c34_a", "other"],
      ["swe_120mm_for_land_battles", "Pillbox", 0, "swe_120mm_coastal_a", "other"],
      ["swe_152mm_for_land_battles", "Pillbox", 0, "swe_152mm_coastal_a", "other"],
      ["us_152mm_for_land_battles", "Pillbox", 0, "us_152mm_coastal_a", "other"],
      // (fix round 2 of that review) three US radars: the two Hawk models share 18 characters with each
      // other and only "mim_" with the Patriot's, so a cut at the start the whole GROUP shares left the
      // Hawks "…23_hawk_radar_cwar" / "…23_hawk_radar_an_mpq46", alike for 15 characters
      ["us_ai_sam_radar_cwar", "Radar", 0, "mim_23_hawk_radar_cwar", "tank"],
      ["us_ai_sam_radar_an_mpq_46", "Radar", 0, "mim_23_hawk_radar_an_mpq46", "tank"],
      ["us_ai_sam_radar_an_mpq_53", "Radar", 0, "mim_104_patriot_radar_an_mpq53", "tank"],
      // and a made-up trio (not the install's) whose models, each cut where it parts from its nearest
      // sibling, would read the same: fx_radar_cwar and fx_radar_hipir_cwar both "…cwar"
      ["fixture_radar_a", "Fixture radar", 0, "fx_radar_cwar", "tank"],
      ["fixture_radar_b", "Fixture radar", 0, "fx_radar_hipir_cwar", "tank"],
      ["fixture_radar_c", "Fixture radar", 0, "fx_radar_hipir_pip", "tank"],
      // and a made-up pair whose shorter model IS the start the pair shares, shown whole: past it the
      // longer one's "…a" reads as "fx_tower_a", so the shared start is backed up a word
      ["fixture_tower_a", "Fixture tower", 0, "fx_tower_a", "tank"],
      ["fixture_tower_aa", "Fixture tower", 0, "fx_tower_a_a", "tank"]
    ];
    var csvMap = new Map(), ranks = new Map(), own = new Map();
    ROSTER.forEach(function(r){ csvMap.set(r[0], { id: r[0], name: r[1] }); ranks.set(r[0], r[2]); if (r[3]) own.set(r[0], r[3]); });
    buildUnitIndex(csvMap, null, { ranks: ranks });
    ROSTER.forEach(function(r){ var u = GameUnits.byId.get(r[0]); u.tree = u.countryTag = "country_usa"; u.cls = r[4] || "air"; });
    GameDB.models = ["9s18_m3", "a13_mk_1", "a_20g", "a_26c_45dt", "a_7e", "boat_a", "cargo_ship_goldenfels", "cargo_ship_liberty",
      "challenger_2_megatron", "challenger_2_megatron_sm_emily", "f_4e", "f_4ej", "kurnass_2000",
      "leopard_2a4m_can", "leopard_2a4m_can_sm_elsa", "m3_stuart", "m4a2_sherman_1944", "stuart_I",
      "3x280mm_sk_c34_a", "swe_120mm_coastal_a", "swe_152mm_coastal_a", "us_152mm_coastal_a",
      "mim_23_hawk_radar_cwar", "mim_23_hawk_radar_an_mpq46", "mim_104_patriot_radar_an_mpq53",
      "fx_radar_cwar", "fx_radar_hipir_cwar", "fx_radar_hipir_pip", "fx_tower_a", "fx_tower_a_a"];
    var rowsBy = function(){
      var o = {};
      (GameDB.vehicleRows || []).forEach(function(r){ (r.units || [r.unit]).forEach(function(u){ o[u.id] = r.model; }); });
      return o;
    };
    // (1) the name join alone — what runs when aces.vromfs.bin cannot be read (§0.3): no floor on
    // the name tiers made every "a…" unit a variant of boat_a
    buildModelUnitJoin(new Map());
    out.byName = rowsBy();
    out.boatStrong = unitsForModelStrong("boat_a").map(function(c){ return c.unit.id; });
    out.boatAll = unitsForModel("boat_a").map(function(c){ return c.unit.id; });
    // (2) with each unit's own blk model, as a scan reads them
    buildModelUnitJoin(own);
    out.byBlk = rowsBy();
    out.rows = GameDB.vehicleRows.map(function(r){ return r.unit.name + "=" + r.model + "[" + (r.units || [r.unit]).map(function(u){ return u.id; }).join("+") + "]"; });
    out.twins = GameDB.vehicleRows.filter(function(r){ return r.twin; }).map(function(r){ return r.unit.id; }).sort();
    out.tells = {};
    GameDB.vehicleRows.forEach(function(r){ if (r.tell != null) out.tells[r.unit.id] = r.tell; });
    out.twinRows = GameDB.vehicleRows.filter(function(r){ return r.twin; }).map(function(r){ return [r.unit.name, r.model, r.tell]; });
    // (3) loading a model ticks exactly the units whose own blk names it, whatever their name scored
    modelForUnit = function(u){ return own.get(u) || null; };
    refreshSkinUnits("f_4e");
    out.tickF4 = App.skinUnits.map(function(s){ return s.unit.id + (s.on ? ":on" : ":off") + ":" + s.score; });
    refreshSkinUnits("kurnass_2000");
    out.tickKurnass = App.skinUnits.map(function(s){ return s.unit.id + (s.on ? ":on" : ":off") + ":" + s.score; });
    refreshSkinUnits("m4a2_sherman_1944");
    out.tickSherman = App.skinUnits.map(function(s){ return s.unit.id + (s.on ? ":on" : ":off") + ":" + s.score; });
    refreshSkinUnits("9s18_m3");
    out.tick9s18 = App.skinUnits.map(function(s){ return s.unit.id + (s.on ? ":on" : ":off") + ":" + s.score; });
    modelForUnit = realModelForUnit;

    // (4) every unit blk is read off this thread (CLAUDE.md §3.1): they are zstd frames against the
    // archive's dictionary, 3 474 of them on every scan. A stand-in archive, built here so no install
    // is needed: stored (type 1) SLIM blks whose root holds string params, one that is a zstd frame
    // the dictionary cannot decode, the shared name map as one raw zstd frame, and a raw-content
    // dictionary. GameUnits.ownModels packs them, GameScan.readRoots reads them in a worker pool.
    var NAMES = ["model", "f_4e", "fmFile", "kurnass_2000"];
    var u32 = function(a, v){ a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
    var slim = function(params){                       // [[name index, value index], ...] on the root
      var b = [1, 0, 1, params.length, 0];             // stored · SLIM · 1 block · n params · no data
      params.forEach(function(p){ u32(b, (1 << 24) | p[0]); u32(b, (0x80000000 | p[1]) >>> 0); });
      b.push(0, params.length, 0);                     // the root: no name, n params, no children
      return new Uint8Array(b);
    };
    var nmBody = [NAMES.length]; var nmText = new TextEncoder().encode(NAMES.join("\\0") + "\\0");
    nmBody.push(nmText.length); nmText.forEach(function(c){ nmBody.push(c); });
    var nmFile = new Array(40).fill(0).concat([0x28, 0xB5, 0x2F, 0xFD, 0x20, nmBody.length,
      (nmBody.length << 3 | 1) & 255, (nmBody.length << 3) >>> 8, 0]).concat(nmBody);
    var FAKE = [
      { name: "gamedata/flightmodels/f-4e.blk", data: slim([[2, 3], [0, 1]]) },           // fmFile first, then model
      { name: "gamedata/flightmodels/f-4e_kurnass_2000.blk", data: slim([[0, 3]]) },
      { name: "gamedata/flightmodels/f-4ej.blk", data: new Uint8Array([5, 1, 2, 3, 4, 5, 6, 7, 8]) },   // unreadable
      { name: "gamedata/flightmodels/nt_f_4e.blk", data: slim([[2, 1]]) },                // no model param
      { name: "test.dict", data: new TextEncoder().encode("a raw-content zstd dictionary, for t49 only") },
      { name: "nm", data: new Uint8Array(nmFile) }
    ];
    var keepA = { files: AcesDB.files, byName: AcesDB.byName, ready: AcesDB.ready, error: AcesDB.error, names: AcesDB.names, ddict: AcesDB.ddict };
    var keepPaths = WeaponDB.unitPaths, realPool = makeWorkerPool, made = [];
    try {
      AcesDB.files = FAKE; AcesDB.byName = new Map(FAKE.map(function(f){ return [acesKey(f.name), f]; }));
      AcesDB.ready = true; AcesDB.error = null; WeaponDB.unitPaths = null;
      makeWorkerPool = function(cfg){
        var P = realPool(cfg), dispose = P.dispose;
        P.dispose = function(){ P.atDispose = P.mode + ":" + P.workers.length; return dispose(); };
        made.push(P); return P;
      };
      var shape = function(r){ return JSON.stringify([[...r.models].sort(), r.unread]); };
      var sent = [];
      var inWorker = await GameUnits.ownModels(function(jobs){ sent = jobs; return GameScan.readRoots(jobs); }, 2);
      out.read = { worker: shape(inWorker), pools: made.map(function(P){ return P.name + ":" + P.atDispose + ":" + P.workers.length + ":" + !!P.url; }),
        // every buffer a job carries is moved to the worker, not copied (CLAUDE.md §3.2): left behind detached
        kept: sent.map(function(a){ return [a.blob, a.offs, a.dict, a.nm].map(function(b){ return b.byteLength; }).join(","); }) };
      // the same section, run here on this thread: the bytes a worker reads must be read the same way
      var onThread = await GameUnits.ownModels(function(jobs){ return jobs.map(function(a){
        return GameUnits.rootParams(a); }); }, 3);
      out.read.thread = shape(onThread);
      // (5) the scan's step: the stored copy is used when there is one — no pool, no decode — and an
      // unreadable blk is reported, not swallowed
      made.length = 0; GameDB.ownModels = null; StatusLog.entries.length = 0;
      await GameScan.join();
      out.join = { fresh: GameDB.ownModels ? [...GameDB.ownModels].sort() : null, pools: made.length,
                   said: (StatusLog.entries[0] || {}).msg || "", unread: GameDB.ownUnread };
      made.length = 0; GameDB.ownModels = new Map([["f-4e", "f_4e"]]);
      await GameScan.join();
      out.join.stored = made.length;
      out.join.storedRow = (GameDB.vehicleRows.filter(function(r){ return r.units.some(function(u){ return u.id === "f-4e"; }); })[0] || {}).model;
    } catch (e) {
      out.readErr = String(e && e.stack || e);          // reported by the checks below, which then fail
    } finally {
      Object.assign(AcesDB, keepA); WeaponDB.unitPaths = keepPaths; makeWorkerPool = realPool; GameDB.ownModels = null; GameDB.ownUnread = 0;
    }
  } finally {
    modelForUnit = realModelForUnit;
    GameUnits.byId = keepU.byId; GameUnits.list = keepU.list; GameUnits.loaded = keepU.loaded;
    GameUnits.nations = keepU.nations; GameUnits.maxRank = keepU.maxRank;
    GameDB.models = keepDB.models; GameDB.vehicleRows = keepDB.rows; GameDB.unitModel = keepDB.um; GameDB.modelUnits = keepDB.mu;
    App.vehicleKey = keepDB.key; App.skinUnits = keepDB.su;
    renderUnitList();
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const P = r.perUnit;

console.log("=== the two vehicles that really use f_4e_c get the skin ===");
for (const u of ["f-4e", "f_4e_event"]) {
  R.is(P[u] && P[u].keep === 1, `${u} keeps the texture`);
  R.is(P[u] && /from:t="f_4e_c\*"/.test(P[u].blk || ""), `${u}.blk names it`);
}

console.log("\n=== the five that do not, get no .blk at all rather than one that does nothing ===");
for (const u of ["f-4ej", "f-4ej_adtw", "f-4ej_kai", "f-4e_iaf", "f-4e_kurnass_2000"]) {
  R.is(P[u] && P[u].keep === 0 && P[u].drop === 1,
    `${u} (${{ "f-4ej": "f_4ej_c", "f-4ej_adtw": "f_4ej_c", "f-4ej_kai": "f_4ej_kai_c", "f-4e_iaf": "f_4e_iaf_c", "f-4e_kurnass_2000": "kurnass_2000_c" }[u]}) is dropped, not written with the wrong from:`);
}

console.log("\n=== a sheet the whole family shares still goes to all of them ===");
R.is(r.sharedKeeps === 7, `f_4c_pylon1_c reaches all seven units — ${r.sharedKeeps}`);
R.is(JSON.stringify(r.mixed.keep) === '["f_4c_pylon1_c"]' && JSON.stringify(r.mixed.drop) === '["f_4e_c"]',
  `and a mixed export splits per unit — f-4ej keeps ${JSON.stringify(r.mixed.keep)}, drops ${JSON.stringify(r.mixed.drop)}`);

console.log("\n=== no data means no opinion (CLAUDE.md §0.3) ===");
R.is(r.unknown.known === false && r.unknown.keep === 1 && r.unknown.drop === 0,
  "an imported .obj, or a folder never scanned, exports exactly what it always did");

// The vehicle list's join, on a fixture roster (2026-10-10). The real-roster half is t138_join.mjs.
console.log("\n=== a one-letter model is not a family: boat_a takes no \"a…\" unit, even by name alone ===");
const AS = ["a-20g", "a-26c-45-dt", "a_7e", "a_7e_thailand", "uk_a_13_mk1", "uk_a_13_mk1_3rd_rtr", "air_defence/germ_20mm_flak38"];
const onBoat = AS.filter(id => r.byName[id] === "boat_a");
R.is(onBoat.length === 0, `with no unit blks to read, no "a…" unit lands on boat_a — ${onBoat.length ? onBoat.join(", ") : "none"}`);
R.is(JSON.stringify(r.boatStrong) === '["us_boat_a"]' && r.boatAll.every(id => id === "us_boat_a"),
  `boat_a's name candidates are the boat alone — strong ${JSON.stringify(r.boatStrong)}, all ${JSON.stringify(r.boatAll)}`);
R.is(r.byName["a_7e_thailand"] === "a_7e" && r.byName["uk_a_13_mk1_3rd_rtr"] === "a13_mk_1" && r.byName["f_4e_event"] === "f_4e",
  `and a real variant still joins its model by name — the Thai A-7E on ${r.byName["a_7e_thailand"]}, the 3rd R.T.R. A13 on ${r.byName["uk_a_13_mk1_3rd_rtr"]}`);

console.log("\n=== each unit is on the model its own blk names ===");
const want = { "a-20g": "a_20g", "a-26c-45-dt": "a_26c_45dt", "a_7e_thailand": "a_7e", "uk_a_13_mk1_3rd_rtr": "a13_mk_1",
  "f-4e": "f_4e", "f_4e_event": "f_4e", "nt_f_4e": "f_4e", "f-4e_kurnass_2000": "kurnass_2000", "f-4ej": "f_4ej" };
const off = Object.keys(want).filter(id => r.byBlk[id] !== want[id]);
R.is(off.length === 0, off.length ? "on the wrong model: " + off.map(id => id + " → " + r.byBlk[id] + " (blk: " + want[id] + ")").join(", ")
  : "every unit with a blk is on its own model — the Kurnass 2000 on kurnass_2000, not on f_4e by name");
R.is(r.byBlk["us_boat_a"] === "boat_a" && !r.byBlk["air_defence/germ_20mm_flak38"],
  `a unit with no blk is still placed by name (us_boat_a → ${r.byBlk["us_boat_a"]}), and an AI gun is on nothing`);
const f4rows = r.rows.filter(x => x.startsWith("F-4E Phantom II="));
R.is(f4rows.length === 1 && f4rows[0] === "F-4E Phantom II=f_4e[f-4e+nt_f_4e+f_4e_event]",
  `three units the list cannot tell apart are one row, shown as the shortest id — ${JSON.stringify(f4rows)}`);
R.is(r.rows.filter(x => x.startsWith("A-7E=")).length === 1, `the A-7E and the Thai A-7E share name, model, tree and rank: one row — ${JSON.stringify(r.rows.filter(x => x.startsWith("A-7E=")))}`);

console.log("\n=== loading a model ticks exactly the units whose blk names it ===");
R.is(JSON.stringify(r.tickF4.filter(t => /:on:/.test(t))) === '["f-4e:on:100","f_4e_event:on:100","nt_f_4e:on:100"]',
  `f_4e ticks f-4e, f_4e_event and nt_f_4e, f-4e first — ${JSON.stringify(r.tickF4)}`);
R.is(r.tickF4.includes("f-4e_kurnass_2000:off:80") || !r.tickF4.some(t => t.startsWith("f-4e_kurnass_2000")),
  `the Kurnass 2000 is not ticked on the F-4E (it flies kurnass_2000)`);
R.is(JSON.stringify(r.tickKurnass) === '["f-4e_kurnass_2000:on:100"]',
  `kurnass_2000 arrives with its own unit ticked as exact, though its name scores only 40 — ${JSON.stringify(r.tickKurnass)}`);
R.is(JSON.stringify(r.tick9s18) === '["ussr_buk_m3_fcs:on:100","ussr_ai_sam_radar_9s18:on:100"]',
  `two units only their blks place: the ranked vehicle leads the unranked AI copy, so it names the .blk — ${JSON.stringify(r.tick9s18)}`);
R.is(JSON.stringify(r.tickSherman) === '["us_m4a2_sherman:on:100","us_m4a2_1944:on:100"]',
  `and with no rank on either, a real class leads "other", so the class is the tank's — ${JSON.stringify(r.tickSherman)}`);

console.log("\n=== the blk outranks the name, and twins are marked ===");
R.is(r.byBlk["uk_m3_stuart"] === "stuart_I",
  `a unit's own blk outranks a perfect name match — uk_m3_stuart is on ${r.byBlk["uk_m3_stuart"]} (its blk: stuart_I; by name: m3_stuart)`);
const TWINS = ["fixture_radar_a", "fixture_radar_b", "fixture_radar_c", "fixture_tower_a", "fixture_tower_aa",
  "germ_3x280mm_sk_c34_for_land_battles", "germ_cargo_ship_goldenfels", "germ_leopard_2a4m_can",
  "germ_leopard_2a4m_can_sm", "swe_120mm_for_land_battles", "swe_152mm_for_land_battles", "uk_cargo_ship_liberty",
  "uk_challenger_2_megatron", "uk_challenger_2_megatron_sm", "us_152mm_for_land_battles", "us_ai_sam_radar_an_mpq_46",
  "us_ai_sam_radar_an_mpq_53", "us_ai_sam_radar_cwar"];
R.is(JSON.stringify(r.twins) === JSON.stringify(TWINS),
  `rows the list draws alike but for the model are marked as twins, and no other row is — ${JSON.stringify(r.twins)}`);
// What a twin's subtitle leads with: its model less the longest start it shares with a sibling, so the
// part that differs comes first however little of the line shows. The review of 2026-10-10 measured
// the subtitle cut to ~10 characters, and "leopard_2a4m_can…" / "challenger_2_megatron…" lead their
// skin-pack copies' models for 16 and 21. A start the whole group shares is not enough (fix round 2):
// for the US radars it is only "mim_", which left both Hawks "…23_hawk_radar_…".
const TELLS = { "germ_leopard_2a4m_can": "leopard_2a4m_can", "germ_leopard_2a4m_can_sm": "…sm_elsa",
  "uk_challenger_2_megatron": "challenger_2_megatron", "uk_challenger_2_megatron_sm": "…sm_emily",
  "uk_cargo_ship_liberty": "…liberty", "germ_cargo_ship_goldenfels": "…goldenfels",
  "us_ai_sam_radar_cwar": "…cwar", "us_ai_sam_radar_an_mpq_46": "…an_mpq46", "us_ai_sam_radar_an_mpq_53": "…104_patriot_radar_an_mpq53" };
// …and where two of those would read the same ("…cwar" past fx_radar_ and past fx_radar_hipir_), the
// group falls back to the start all of it shares
const FALLBACK = { "fixture_radar_a": "…cwar", "fixture_radar_b": "…hipir_cwar", "fixture_radar_c": "…hipir_pip" };
// …and so it does where one "…" would read as a sibling that shows a different start (pillbox-tell,
// 2026-10-10). The four pillboxes share no start as a group, so they stay whole, as they were before
// the join's fix cut the Swedish two to "…120mm_coastal_a" / "…152mm_coastal_a" — the second of which
// read as "us_152mm_coastal_a" beside it, and the first left its nation to guess between the two. A
// group whose shared start is one row's whole model ("fx_tower_a", shown whole beside "…a") backs that
// start up a word at a time.
const KEPT = { "germ_3x280mm_sk_c34_for_land_battles": "3x280mm_sk_c34_a", "swe_120mm_for_land_battles": "swe_120mm_coastal_a",
  "swe_152mm_for_land_battles": "swe_152mm_coastal_a", "us_152mm_for_land_battles": "us_152mm_coastal_a",
  "fixture_tower_a": "…a", "fixture_tower_aa": "…a_a" };
const tells = r.tells || {};
R.is(Object.keys(TELLS).every(id => tells[id] === TELLS[id]) &&
  Object.keys(tells).length === Object.keys(TELLS).length + Object.keys(FALLBACK).length + Object.keys(KEPT).length,
  `each twin leads with what tells it from its nearest sibling, and a row with no twin has no such lead — ${JSON.stringify(tells)}`);
R.is(Object.keys(FALLBACK).every(id => tells[id] === FALLBACK[id]),
  `twins that would lead alike lead with what tells them from the whole group — ${JSON.stringify(Object.keys(FALLBACK).map(id => tells[id]))}`);
R.is(Object.keys(KEPT).every(id => tells[id] === KEPT[id]),
  `twins whose "…" would read as a sibling keep the start that tells them apart — ${JSON.stringify(Object.keys(KEPT).map(id => tells[id]))}`);
// What a reader sees: a tell READS AS a sibling's when its "…" could stand for that sibling — what it
// shows is the end of what the sibling shows, behind a different start. Over every twin group here.
const shows = t => t[2][0] === "…" ? t[2].slice(1) : t[2], hides = t => t[1].slice(0, t[1].length - shows(t).length);
const readsAs = (a, b) => a[2][0] === "…" && shows(b).endsWith(shows(a)) && hides(a) !== hides(b);
const misread = [];
for (const a of r.twinRows || []) for (const b of r.twinRows || [])
  if (a !== b && a[0] === b[0] && readsAs(a, b)) misread.push(`"${a[2]}" (${a[1]}) as "${b[2]}" (${b[1]})`);
R.is((r.twinRows || []).length === TWINS.length && misread.length === 0,
  `no twin's tell reads as a sibling's — ${misread.length ? misread.join("; ") : (r.twinRows || []).length + " twins"}`);
const pairs = [["germ_leopard_2a4m_can", "germ_leopard_2a4m_can_sm"], ["uk_challenger_2_megatron", "uk_challenger_2_megatron_sm"],
  ["uk_cargo_ship_liberty", "germ_cargo_ship_goldenfels"], ["swe_120mm_for_land_battles", "us_152mm_for_land_battles"],
  ["swe_120mm_for_land_battles", "swe_152mm_for_land_battles"], ["swe_152mm_for_land_battles", "us_152mm_for_land_battles"],
  ["germ_3x280mm_sk_c34_for_land_battles", "swe_120mm_for_land_battles"], ["fixture_tower_a", "fixture_tower_aa"],
  ["us_ai_sam_radar_cwar", "us_ai_sam_radar_an_mpq_46"], ["us_ai_sam_radar_cwar", "us_ai_sam_radar_an_mpq_53"],
  ["us_ai_sam_radar_an_mpq_46", "us_ai_sam_radar_an_mpq_53"]];
const alike = pairs.filter(([a, b]) => String(tells[a]).slice(0, 6) === String(tells[b]).slice(0, 6));
R.is(alike.length === 0, `every twin pair differs in its first 6 characters` + (alike.length ? " — not: " + alike.map(p => p.join(" / ")).join(", ") : ""));

console.log("\n=== every unit blk is read in a worker (CLAUDE.md §3.1) ===");
const WANT = '[[["f-4e","f_4e"],["f-4e_kurnass_2000","kurnass_2000"]],1]';
if (r.readErr) console.log("  note  the read threw: " + r.readErr.split("\n").slice(0, 3).join(" | "));
r.read = r.read || {}; r.join = r.join || {};
R.is(r.read.worker === WANT, `the worker pool reads each blk's root model, and counts the one it cannot read — ${r.read.worker}`);
R.is(r.read.thread === WANT, `the same section on this thread reads the same — ${r.read.thread}`);
R.is(JSON.stringify(r.read.pools) === '["unitblk:worker:2:0:false"]',
  `one pool, two real workers, let go when the read is done — ${JSON.stringify(r.read.pools)}`);
R.is(JSON.stringify(r.read.kept) === '["0,0,0,0","0,0,0,0"]',
  `each lane's blks, offsets, dictionary and name map are moved to its worker, not copied — bytes left behind ${JSON.stringify(r.read.kept)}`);
R.is(JSON.stringify(r.join.fresh) === '[["f-4e","f_4e"],["f-4e_kurnass_2000","kurnass_2000"]]' && r.join.pools === 1,
  `a scan with no stored copy reads them — ${JSON.stringify(r.join.fresh)}, ${r.join.pools} pool`);
R.is(/matching vehicles to their models/.test(r.join.said) && /\b1 vehicle/.test(r.join.said),
  `and says when a blk could not be read, rather than only logging it — "${r.join.said}"`);
R.is(r.join.unread === 1, `and counts it, so the stored index keeps no read short of a blk (t21) — ${r.join.unread} unread`);
R.is(r.join.stored === 0 && r.join.storedRow === "f_4e",
  `a scan with the stored index's copy decodes nothing — ${r.join.stored} pools, and the F-4E row is on ${r.join.storedRow}`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
