// What the scan SAYS when it finishes (ROADMAP 2.4's oracle for `indexGameFolder`).
//
// WHY THIS EXISTS. The scan itself needs a real game folder and is exercised every time the app is
// used; what nothing looks at is the part that runs after it — the row swap that puts the search box
// where the "open folder" button was, and a status sentence with five independent branches. Each
// branch is there because of something that went wrong once:
//
//   * the rows swap ONLY when something came out of the folder, or a wrong folder (easy to hand
//     over by drag & drop) hides the way to try again;
//   * the sentence counts vehicles, models, textures and packs, and says "from the stored index"
//     when nothing was rescanned — which is how a user knows to press Rescan after a game update;
//   * it counts the textures it does not open, when there are any — per TEXTURE, not per tier entry,
//     and with the reason, because "3024 not decodable (textures this build cannot read)" read as a
//     broken build after the build had its own decoder (2026-10-10 review);
//   * a DROPPED folder is not a real handle: it cannot be stored and cannot be written to, so the
//     sentence says to drag it in again and to export with Download .zip — and a folder CHOSEN
//     through the file chooser (4.48) is the same, except that it is picked again, not dragged;
//   * and with nothing found at all it is an error rather than a cheerful zero.
//
// Two more, from the review of 2026-10-10, measured on the live install:
//
//   * the LINE counts what the vehicle list lists. It said "3 883 vehicles ready" — every unit in the
//     registry — beside a list of 3 295; the 588 others are said, and said what they are, in the detail;
//   * a scan restored from the stored index says exactly what a fresh one said. It said "from 9935
//     packs" against 6 428 (it counted the model packs too) and ended Advanced on a bare "… — ",
//     because the per-format tally was filled only while packs were walked. This half drives the
//     REAL fresh path (indexDxp over a DxP2 pack built here) and the REAL restore (saveGameIndex,
//     restoreGameIndex through IndexedDB) and compares what each one leaves on screen.
//
// And where those textures turn up later: the texture row names the pixel format instead of printing
// the format NUMBER as text ("2 ✕" was L8) — also when an empty $hq stub is listed ahead of the tier
// that holds the sheet, which made 2 924 of the live install's 2 948 say "no data ✕"; a vehicle's load
// says why its propeller masks did not open, the greyed-out slot such a sheet leaves says the same, and
// so does Advanced ▸ Fill missing slots, which called them "not found" (review of 2026-10-10).
//
// Usage: node tools/t80_scan.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var keep = { entries: GameDB.entries, models: GameDB.models, packs: GameDB.packs, packList: GameDB.packList,
               stems: GameDB.stems, rows: GameDB.vehicleRows, grp: GameDB.grpIndex, desc: GameDB.desc,
               loaded: GameUnits.loaded, list: GameUnits.list, dir: App.gameDir, key: App.vehicleKey,
               vid: $("vehicleId").value };
  var rowOpen = $("rowGameOpen"), rowSearch = $("rowGameSearch");
  var was = { open: rowOpen.style.display, search: rowSearch.style.display };
  // A DDSx header holds its pixel format where a FOURCC would be. The game's utility sheets carry a
  // Direct3D format NUMBER there instead, below 256 — 113 A16B16G16R16F, 32 A8B8G8R8, 21 A8R8G8B8,
  // 50 L8 are the four commonest on the live install (2026-10-10).
  var DXT5 = 0x35545844, ODD = [113, 32, 21, 50];
  function header(code){
    var h = new Uint8Array(32), v = new DataView(h.buffer);
    h.set([0x44, 0x44, 0x53, 0x78]);
    v.setUint32(4, code, true);
    v.setUint32(8, (0x60 << 24) >>> 0, true);            // Oodle: this build has the decoder, so only the format bites
    v.setUint16(12, 64, true); v.setUint16(14, 64, true);
    return h;
  }
  // the same string indexDxp makes of those four bytes
  function fmtOf(h){ return String.fromCharCode(h[4], h[5], h[6], h[7]).replace(/[\\0 ]/g, ""); }
  function unit(id, tagged){ return { id: id, name: id.toUpperCase(), fullName: id, cls: "air", country: "USA",
    countryTag: "country_usa", tree: "country_usa", rank: 3, tagged: tagged }; }
  // Six units in the registry, four of them in the list on three rows (u5 rides the first row with u1,
  // the way buildModelUnitJoin merges what the list cannot tell apart — a merged unit is listed, not
  // "left out"): one with no model matched, one the game does not tag as a vehicle at all (a target,
  // an AI ship).
  function vehicles(){
    GameUnits.loaded = true;
    GameUnits.list = [unit("u1", true), unit("u2", true), unit("u3", true), unit("u4", true), unit("target_dummy"), unit("u5", true)];
    GameDB.vehicleRows = GameUnits.list.slice(0, 3).map(function(u, j){ return { unit: u, model: "m" + (j + 1) }; });
    GameDB.vehicleRows[0].units = [GameUnits.list[0], GameUnits.list[5]];
    GameDB.models = ["m1", "m2", "m3"];
  }
  // n textures, the first \`bad\` of them in a pixel format the editor has no reader for, each of
  // those at TWO tiers — two entries, one texture.
  function fill(n, bad){
    GameDB.entries = []; GameDB.stems = new Map();
    for (var i = 0; i < n; i++) {
      var odd = bad && i < bad, tiers = odd ? ["base", "hq"] : ["base"];
      var rec = { stem: "t" + i, tiers: {} };
      for (var k = 0; k < tiers.length; k++) {
        var h = header(odd ? ODD[i % ODD.length] : DXT5);
        var en = { name: "t" + i + (k ? "$hq" : ""), stem: "t" + i, tier: tiers[k], pack: 0, header: h, off: 0, size: 100,
                   fmt: fmtOf(h), w: 64, h: 64, supported: !odd, compName: "oodle" };
        GameDB.entries.push(en); rec.tiers[tiers[k]] = en;
      }
      GameDB.stems.set(rec.stem, rec);
    }
    GameDB.packs = 7;
    vehicles();
  }
  // The whole message: the line AND its detail, which only the log shows since ROADMAP 3.36.
  function say(){ return StatusLog.entries[0] ? StatusLog.entries[0].msg : ""; }
  function line(){ return $("status") ? $("status").textContent : ""; }
  function diag(){ return $("gameDiag").textContent; }

  // ---- a normal scan ----
  fill(1234, 0);
  rowOpen.style.display = ""; rowSearch.style.display = "none";
  GameScan.finish(false, { _legacy: false });
  out.normal = { text: say(), line: line(), open: rowOpen.style.display, search: rowSearch.style.display,
                 searchOn: !$("gameSearch").disabled, fill: !$("btnFillFromGame").disabled,
                 count: $("gameCount").textContent, listed: $("gameList").querySelectorAll(".rowitem").length, diag: diag() };

  // ---- from the stored index ----
  GameScan.finish(true, { _legacy: false });
  out.cached = say();

  // ---- some textures it does not open ----
  fill(1234, 9);
  GameScan.finish(false, { _legacy: false });
  out.bad = say();
  out.badDiag = diag();
  // where one of them turns up afterwards: its texture row, its slot, and a vehicle that names it
  var tr = textureRow(GameDB.stems.get("t3"), "auto");                 // t3 is L8 (code 50, which prints as "2")
  out.rowTag = tr ? tr.children[1].textContent : null;
  out.rowTitle = tr ? tr.firstChild.title : null;
  // …and the shape 2 924 of the 2 948 have on the live install: an empty 0×0 $hq stub listed ahead of
  // the base tier that holds the sheet. pickVariant hands the row the stub, which said "no data ✕"
  // under a summary saying these textures decompress fine (review of 2026-10-10).
  var stub = new Uint8Array(32); stub.set([0x44, 0x44, 0x53, 0x78]);
  var hb = header(21);
  var stubbed = { stem: "tree_pivot_dir", tiers: {
    hq: { name: "tree_pivot_dir$hq", stem: "tree_pivot_dir", tier: "hq", pack: 0, header: stub, off: 0, size: 0,
          fmt: "", w: 0, h: 0, supported: false, compName: "raw" },
    base: { name: "tree_pivot_dir", stem: "tree_pivot_dir", tier: "base", pack: 0, header: hb, off: 0, size: 100,
            fmt: fmtOf(hb), w: 64, h: 64, supported: false, compName: "oodle" } } };
  var sr = textureRow(stubbed, "auto");
  out.stubTag = sr ? sr.children[1].textContent : null;
  out.stubTitle = sr ? sr.firstChild.title : null;
  var box = document.createElement("div");
  SlotList.row(box, { id: "t3", cStem: "t3", nStem: null, missing: true, layers: [], composite: null });
  var sz = box.querySelector(".sz");
  out.slotText = sz ? sz.textContent : null;
  out.slotTitle = sz ? sz.title : null;
  // a vehicle whose materials name three such sheets and one that is not in the install at all
  GameDB.desc = GameDB.desc || {};
  GameDB.descBindCache.set("t80_vehicle", { map: new Map([
    ["prop_a", { c: "t3", n: "t1" }], ["prop_b", { c: "t2", n: null }], ["gone", { c: "nowhere_c", n: null }]]) });
  await loadVehicleTextures("t80_vehicle");
  out.vehicle = say();
  out.vehicleLine = line();
  GameDB.descBindCache.delete("t80_vehicle");
  // Advanced ▸ Fill missing slots over slots that want those sheets: two slots each want a utility
  // sheet as albedo and share a third as their normal (as a propeller's do), and one wants a sheet the
  // install does not have. It said "not found: t3, t1, t2, t1…" of sheets the slot itself had just
  // said are in the install (review of 2026-10-10, on the Bf 109 F-4).
  var keepSlots = App.slots;
  App.slots = new Map([
    ["t3", { id: "t3", cStem: "t3", nStem: "t1", missing: true, smooth: false, layers: [] }],
    ["t2", { id: "t2", cStem: "t2", nStem: "t1", missing: true, smooth: false, layers: [] }],
    ["gone", { id: "gone", cStem: "nowhere_c", nStem: null, missing: true, smooth: true, layers: [] }]]);
  try { await fillMissingFromGame(); } finally { App.slots = keepSlots; }
  out.fillText = say();
  out.fillLine = line();

  // ---- fresh against restored, through the real paths ----
  // Two texture packs and two model packs, as a real index holds them: the model packs are added to
  // the same pack list after the texture packs (indexGrpPacks), so a count of the whole list is not a
  // count of texture packs.
  function dxp(names, codes){
    var bytes = [];
    names.forEach(function(nm){ for (var i = 0; i < nm.length; i++) bytes.push(nm.charCodeAt(i)); bytes.push(42, 0); });
    var total = names.length;
    var ddsx = (0x48 + bytes.length + 15) & ~15, body = (ddsx + total * 0x20 + 15) & ~15, data = body + total * 0x18 + 16;
    var u8 = new Uint8Array(data + total * 64), v = new DataView(u8.buffer);
    v.setUint32(0, 0x32507844, true); v.setUint16(8, total, true);
    v.setUint32(0x20, ddsx - 0x10, true); v.setUint32(0x30, body - 0x10, true);
    u8.set(bytes, 0x48);
    for (var i = 0; i < total; i++) {
      u8.set(header(codes[i]), ddsx + i * 0x20);
      v.setUint32(body + i * 0x18 + 0xc, data + i * 64, true);
      v.setUint32(body + i * 0x18 + 0x10, 64, true);
    }
    var blob = new Blob([u8]);
    return { getFile: async function(){ return blob; } };
  }
  var dir = { _legacy: false };
  GameScan.reset(dir);
  await indexDxp(dxp(["hull_c", "hull_c$hq", "tree_pivot_dir", "tree_pivot_dir$hq", "grade_lut", "prop_mask"],
                     [DXT5, DXT5, 113, 113, 21, 50]), "content/base/res/a.dxp.bin");
  await indexDxp(dxp(["sand_mask", "noise"], [32, 50]), "content/base/res/b.dxp.bin");
  GameDB.packs = GameDB.packList.length;                                // what GameScan.fresh does after the texture packs
  GameDB.entries.sort(function(a, b){ return a.name.localeCompare(b.name); });
  packAdd("content/base/res/m1.grp", null, null); packAdd("content/base/res/m2.grp", null, null);
  vehicles();
  GameScan.finish(false, dir);
  out.fresh = { text: say(), diag: diag(), packs: GameDB.packs, entries: GameDB.entries.length, stems: GameDB.stems.size };
  saveGameIndex("t80-fp");
  for (var w = 0; w < 100; w++) { var c = await idbGet(GAME_INDEX_KEY); if (c && c.fp === "t80-fp") break; await new Promise(function(r){ setTimeout(r, 20); }); }
  GameScan.reset(dir);
  out.restoredOk = await restoreGameIndex("t80-fp");
  vehicles();
  GameScan.finish(true, dir);
  out.restored = { text: say(), diag: diag(), packs: GameDB.packs, entries: GameDB.entries.length, stems: GameDB.stems.size };
  await idbDel(GAME_INDEX_KEY);

  // ---- a dropped folder ----
  fill(1234, 0);
  GameScan.finish(false, { _legacy: true });
  out.dropped = say();
  // ---- a folder chosen through the file chooser (ROADMAP 4.48) ----
  fill(1234, 0);
  GameScan.finish(false, { _legacy: true, _via: "list" });
  out.listed = say();
  out.listedLine = line();
  out.listedMarked = $("status").hasAttribute("data-clip") || StatusLog.more;

  // ---- the install found BELOW the folder that was picked (2026-10-10) ----
  fill(1234, 0);
  GameScan.finish(false, { _legacy: false }, "SteamLibrary/steamapps/common/War Thunder");
  out.below = say(); out.belowLine = line();
  GameScan.finish(false, { _legacy: true, _via: "list" }, "SteamLibrary/steamapps/common/War Thunder");
  out.belowListed = say();

  // ---- nothing found ----
  GameDB.entries = []; GameDB.stems = new Map(); GameDB.models = []; GameDB.packs = 0; GameDB.vehicleRows = [];
  GameUnits.loaded = false; GameUnits.list = [];
  rowOpen.style.display = ""; rowSearch.style.display = "none";
  GameScan.finish(false, { _legacy: false });
  out.empty = { text: say(), open: rowOpen.style.display, search: rowSearch.style.display,
                cls: $("status") ? $("status").className : "" };

  GameDB.entries = keep.entries; GameDB.models = keep.models; GameDB.packs = keep.packs; GameDB.packList = keep.packList;
  GameDB.stems = keep.stems; GameDB.vehicleRows = keep.rows; GameDB.grpIndex = keep.grp; GameDB.desc = keep.desc;
  GameUnits.loaded = keep.loaded; GameUnits.list = keep.list; App.gameDir = keep.dir; App.vehicleKey = keep.key;
  $("vehicleId").value = keep.vid;
  rowOpen.style.display = was.open; rowSearch.style.display = was.search;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 60000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = v => JSON.stringify(v);
const num = s => +String(s || "").replace(/\D/g, "");
// the detail lines, without the one that says where the index came from
const body = t => String(t || "").split("\n").filter(l => !/stored index/.test(l)).join("\n");

console.log("=== the closing sentence ===");
R.is(/3 models/.test(r.normal.text) && /1.234 textures/.test(r.normal.text) && /7 packs/.test(r.normal.text),
  // the thousands separator is the browser's locale, so the check does not name it
  `the sentence counts what came out of the folder (${J(r.normal.text)})`);
R.is(/^3 vehicles ready/.test(r.normal.line) && !/models|packs/.test(r.normal.line),
  `…but the LINE only says it worked and how many vehicles — the inventory is the detail in Messages (${r.normal.line})`);
R.is(num(r.normal.line.split(" vehicles")[0]) === num(r.normal.count) && r.normal.listed === 3,
  `the line's count is the vehicle list's own: ${J(r.normal.line.split(" — ")[0])} beside a header of ${J(r.normal.count)} and ${r.normal.listed} rows`);
R.is(/2 more units in the game's list are not listed/.test(r.normal.text) && /1 not tagged as a vehicle/.test(r.normal.text) &&
     /1 vehicle the editor could not match to a model by name/.test(r.normal.text) && !/in this install/.test(r.normal.text),
  // The unmatched ones are the editor's join failing, not the install lacking them: on the live install
  // none of the 234 has a model of its own name, yet the Maus, the Ostwind and the Grant are all there
  // under other names (review of 2026-10-10). "No model matched in this install" blamed the install.
  `…and the units the list leaves out are counted and said what they are — the editor's miss, not the install's (${J(r.normal.text.split("\n").find(l => /more units/.test(l)) || "")})`);
R.is(r.listedLine.length < 60 && !/Download|opened|another way/.test(r.listedLine) && r.listedMarked,
  `even with every branch on, the line stays short and is marked as having more (${r.listedLine})`);
R.is(r.normal.open === "none" && r.normal.search === "" && r.normal.searchOn && r.normal.fill,
  "…the search box takes the open button's place, and both its buttons come alive");
R.is(/stored index/.test(r.cached) && /Rescan/.test(r.cached),
  `a scan that reused the index says so, and names the way to force a fresh one (${r.cached.split("\n")[2] || r.cached})`);
R.is(!/stored index/.test(r.normal.text), "…and a fresh scan does not");

console.log("\n=== the textures it does not open ===");
R.is(/9 textures are not opened/.test(r.bad),
  `they are counted per texture — 9 textures, though each ships as 2 tier entries (${J(r.bad.split("\n").find(l => /not opened/.test(l)) || "")})`);
R.is(/pixel format/.test(r.bad) && /decompress fine/.test(r.bad) && !/this build cannot read|not decodable/.test(r.bad),
  "…and the sentence names the cause — a pixel format with no reader, not a build that cannot read the game");
R.is(!/not opened/.test(r.normal.text) && r.normal.diag === "", "…and nothing is said, here or in Advanced, when there are none");
R.is(/9 of 1.234 textures/.test(r.badDiag) && /A16B16G16R16F ×3/.test(r.badDiag) && /A8B8G8R8 ×2/.test(r.badDiag) &&
     /A8R8G8B8 ×2/.test(r.badDiag) && /L8 ×2/.test(r.badDiag),
  `Advanced names each pixel format and counts its textures (${J(r.badDiag.slice(0, 140))})`);
R.is(!/[\u0000-\u001f]|\(blank\)/.test(r.badDiag),
  "…by its Direct3D name, never the format number printed as text (\\u0015, 'q', '(blank)', '2')");
R.is(r.rowTag === "L8 ✕" && /pixel format L8 has no reader/.test(r.rowTitle),
  `the texture row names the format too (tag ${J(r.rowTag)}, title ${J(r.rowTitle)})`);
R.is(r.stubTag === "A8R8G8B8 ✕" && /^64×64 A8R8G8B8 · oodle — pixel format A8R8G8B8 has no reader/.test(r.stubTitle || "") && !/no data/.test(r.stubTitle || ""),
  `…also when an empty $hq stub is listed ahead of the tier that holds the sheet — not "no data" (tag ${J(r.stubTag)}, title ${J(r.stubTitle)})`);
R.is(/utility sheet/.test(r.slotText || "") && /L8/.test(r.slotText || "") && /not part of the paint scheme/.test(r.slotTitle || ""),
  `a slot left without its sheet says why, on the slot (${J(r.slotText)} — ${J(r.slotTitle)})`);
R.is(/3 utility sheets not opened/.test(r.vehicle) && /1 unavailable/.test(r.vehicle) && /not part of the paint scheme/.test(r.vehicle),
  `a vehicle's load says why its utility sheets did not open, apart from what is missing (${J(r.vehicle)})`);
R.is(/^Loaded 0 textures for t80_vehicle · 3 utility sheets not opened/.test(r.vehicleLine) && !/paint scheme/.test(r.vehicleLine),
  `…with the count on the line and the explanation in Messages (${J(r.vehicleLine)})`);
const notFound = (/not found: ([^\n]*)/.exec(r.fillText || "") || [, ""])[1].replace(/…$/, "").split(", ").filter(Boolean);
R.is(/^Filled 0 texture\(s\) from game files · 3 utility sheets not opened/.test(r.fillLine || "") && /not part of the paint scheme/.test(r.fillText || ""),
  `Fill missing slots counts the utility sheets as the load does, and says why in Messages (${J(r.fillText)})`);
R.is(J(notFound) === J(["nowhere_c"]),
  `…and calls only the sheet the install lacks "not found", each name once — not the sheets the slots say it has (${J(notFound)})`);

console.log("\n=== a restored scan says what the fresh one said ===");
R.is(r.restoredOk === true && r.restored.entries === r.fresh.entries && r.restored.stems === r.fresh.stems,
  `the real save and restore round-tripped the index (${r.fresh.entries} entries, ${r.fresh.stems} textures)`);
R.is(r.fresh.packs === 2 && r.restored.packs === 2,
  `both count the TEXTURE packs the textures came from — not the model packs beside them (fresh ${r.fresh.packs}, restored ${r.restored.packs})`);
R.is(/5 textures are not opened/.test(r.fresh.text),
  `the fresh scan counts the unread ones per texture (${J(r.fresh.text.split("\n").find(l => /not opened/.test(l)) || r.fresh.text)})`);
R.is(body(r.restored.text) === body(r.fresh.text),
  `the closing sentence is the same either way, but for saying where the index came from\n        fresh:    ${J(r.fresh.text)}\n        restored: ${J(r.restored.text)}`);
R.is(r.restored.diag === r.fresh.diag && /A8R8G8B8 ×1/.test(r.restored.diag) && !/—\s*$/.test(r.restored.diag),
  `…and so is Advanced — the restored one no longer ends on a bare dash\n        fresh:    ${J(r.fresh.diag)}\n        restored: ${J(r.restored.diag)}`);
R.is(/1 vegetation wind table/.test(r.fresh.diag), `the wind tables are counted by name (${J(r.fresh.diag)})`);

console.log("\n=== the folder it came from ===");
R.is(/dropped folder/i.test(r.dropped) && /Download \.zip/.test(r.dropped),
  `a dropped folder says it cannot be stored or written to (${r.dropped.slice(-90)})`);
R.is(!/dropped folder/i.test(r.normal.text), "…and a real handle does not");
R.is(/opened another way/i.test(r.listed) && /pick it again/.test(r.listed) && /Download \.zip/.test(r.listed) && !/drag it in/.test(r.listed),
  `a folder chosen through the file chooser says to pick it again, not to drag it in (${r.listed.slice(-90)})`);
R.is(/Found the install inside the folder you picked: SteamLibrary\/steamapps\/common\/War Thunder — that is the folder remembered/.test(r.below)
  && /^3 vehicles ready/.test(r.belowLine) && r.belowLine.length < 60,
  `an install found below the folder that was picked says where, in the detail, and that THAT folder is the one remembered — the line stays short (${J(r.belowLine)}; detail: ${r.below.split("\n")[1]})`);
R.is(/Found the install inside the folder you picked: SteamLibrary/.test(r.belowListed) && !/remembered/.test(r.belowListed.split("\n")[1] || ""),
  "…and through the file chooser it says where without promising to remember it — a listing cannot be stored");
R.is(!/Found the install/.test(r.normal.text), "…and an install picked as itself says nothing of the kind");
R.is(r.empty.open === "" && r.empty.search === "none",
  "a folder that yielded nothing leaves the open button where it is — the way to try again");
R.is(/err/.test(r.empty.cls), `…and says so as an error (class ${JSON.stringify(r.empty.cls)})`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
