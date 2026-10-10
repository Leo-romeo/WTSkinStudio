// The file chooser over a REAL install, from a double-clicked page (ROADMAP 4.48). Needs the game.
//
// t84 holds the adapter against a synthetic tree; what it cannot hold is the part that is the whole
// reason for 4.48 — that the browser's own chooser, handed a real install under Program Files, gives
// a file:// page something the real scan can index and the real loader can build a vehicle from.
// This drives exactly that: the page is opened from disk the way a user opens it (headless.mjs loads
// it from a file:// path), the chooser is given the install through CDP's DOM.setFileInputFiles —
// the protocol's stand-in for the user picking a folder — and the page's own change handler does the
// rest. Nothing in the page is stubbed.
//
// What it cannot see: the dialog a real Chrome shows before handing a folder over ("Upload N files to
// this site?"). The protocol skips it, and so the wording the hint uses about it is unverified here.
//
// Since 2026-10-10 it also scans the install a SECOND time, from the stored index the first scan
// wrote — which is what every visit after the first is — and holds the two to the same message. The
// review that day measured this install saying "3 883 vehicles ready" over a list of 3 295, "from 9935
// packs" on the second visit against 6 428 on the first, and Advanced ending "… not decodable — "
// with nothing after the dash. It checks the summary's claim that no vehicle body or camouflage sheet
// is among the textures not opened against every listed vehicle's own materials, loads a propeller
// aircraft's sheets to see its propeller masks said as utility sheets, renders every unopened
// texture's row at each quality to see its format named, and runs Fill missing slots on that
// aircraft's own slots.
//
// Usage: node tools/t85_listed_install.mjs [--keep] [--chrome <path>]   (finds the install itself; WT_DIR overrides)
import path from "node:path";
import { findBrowser, evalInPage, makeReport } from "./headless.mjs";
import { installOrExit } from "./wtdir.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
// No install is a failure, not a SKIP: this test exists to run against one (tools/wtdir.mjs).
const WT = installOrExit();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const VEHICLE = "f_4e";
const PROP_VEHICLE = "bf_109f_4";          // four utility sheets on the live install: two propeller masks, the side blur, their _n
const sleep = ms => new Promise(r => setTimeout(r, ms));
// What the scan left on screen: its closing message (the newest one — later messages push it down),
// Advanced, the list's header count, and the numbers they are made of.
const SUMMARY = `(() => {
  const closing = (StatusLog.entries.find(e => /textures from [\\d\\s,.]+ packs/.test(e.msg)) || {}).msg || "";
  const u = GameScan.unread();
  return { closing, diag: [...$("gameDiag").children].map(d => d.textContent), count: $("gameCount").textContent,
    rows: (GameDB.vehicleRows || []).length, units: GameUnits.list.length,
    // a merged row carries several units (buildModelUnitJoin): the units the list lists are theirs, not the rows
    listedUnits: new Set((GameDB.vehicleRows || []).flatMap(r => (r.units || [r.unit]).map(u => u.id))).size, packs: GameDB.packs, packList: GameDB.packList.length,
    stems: GameDB.stems.size, textures: u.textures, format: u.format, sheets: u.sheets, wind: u.wind, fmts: [...u.fmts] };
})()`;

const r0 = await evalInPage({
  browser, keep: argv.includes("--keep"), timeoutMs: 900000,
  drive: async ({ cdp, contextId, evaluate }) => {
    await evaluate(`new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", () => r()))`);
    await evaluate(`new Promise(r => setTimeout(r, 400))`);
    await evaluate(`window.__t85 = { t0: performance.now(), listed: 0, n: 0 };
      // capture phase on the document: it runs before the page's own handler, which empties the input
      document.addEventListener("change", e => { if (e.target.id !== "gameDirPick") return; __t85.listed = performance.now(); __t85.n = e.target.files.length; }, true);
      true`);
    const input = await cdp.send("Runtime.evaluate", { expression: `document.getElementById("gameDirPick")`, contextId });
    await cdp.send("DOM.setFileInputFiles", { files: [WT.replace(/\//g, path.sep)], objectId: input.result.objectId });
    // The scan is over when its closing sentence is up (GameScan.finish) or it has said why not.
    let st = null;
    for (let i = 0; i < 1200; i++) {
      st = await evaluate(`({ status: (StatusLog.entries[0] || {}).msg || $("status").textContent, listed: __t85.listed, n: __t85.n })`);
      // The CLOSING sentence ("… textures from 5300 packs"), not " packs" alone: the progress line
      // "Reading texture packs… 32/5305" matches that too, and ended the wait mid-scan.
      if (/textures from [\d\s,.  ]+ packs/.test(st.status) || /Scan failed|No game data/.test(st.status)) break;
      await sleep(500);
    }
    const scan = await evaluate(`({ status: (StatusLog.entries[0] || {}).msg || $("status").textContent, ms: Math.round(performance.now() - __t85.t0),
      listMs: Math.round(__t85.listed - __t85.t0), files: __t85.n,
      via: App.gameDir && App.gameDir._via, legacy: !!(App.gameDir && App.gameDir._legacy), dirName: App.gameDir && App.gameDir.name,
      models: GameDB.models.length, stems: GameDB.stems.size, packs: GameDB.packs, units: GameUnits.loaded ? GameUnits.list.length : 0,
      search: $("rowGameSearch").style.display, open: $("rowGameOpen").style.display })`);
    // A vehicle out of it: geometry from a .grp, sheets from the .dxp packs, all through the chooser's Files.
    const veh = await evaluate(`(async () => {
      const t = performance.now();
      try { await loadVehicleModel(${JSON.stringify(VEHICLE)}); } catch (e) { return { threw: String(e && e.message || e) }; }
      for (let i = 0; i < 240 && ![...App.slots.values()].some(s => s.composite); i++) await new Promise(r => setTimeout(r, 250));
      const slots = [...App.slots.values()];
      const big = slots.filter(s => s.composite && s.composite.width >= 1024).length;
      return { ms: Math.round(performance.now() - t), parts: (App.geomData || []).length, slots: slots.length, big,
               decoded: App.decoded.size, status: $("status").textContent };
    })()`, 300000);
    const first = await evaluate(SUMMARY);
    // ---- the same install again, from the stored index the scan just wrote (2026-10-10) ----
    // Every visit after the first looks like this, and it used to say a different thing: "from 9935
    // packs" against 6 428, and Advanced ending on a bare "… — ". The scan saved its index before it
    // finished (saveGameIndex); wait for the write to land, then scan again without forcing a rescan.
    await evaluate(`(async () => { for (let i = 0; i < 200; i++) { const c = await idbGet(GAME_INDEX_KEY); if (c && c.names) return true;
      await new Promise(r => setTimeout(r, 100)); } return false; })()`);
    await evaluate(`indexGameFolder(App.gameDir, false).then(() => true)`, 600000);
    const second = await evaluate(SUMMARY);
    // "No vehicle body or camouflage sheet is among them", which the summary says, checked against
    // every listed vehicle's own materials: no unopened sheet is a camouflage (t1) sheet, and none is
    // the colour or normal sheet of a paintable (masked-class) material named for the vehicle itself.
    const claim = await evaluate(`(() => {
      const bad = new Set();
      for (const rec of GameDB.stems.values()) { const en = GameDB.unreadOf(rec); if (en && GameDB.blockKind(en) === "format") bad.add(rec.stem.toLowerCase()); }
      const isBad = s => !!s && bad.has(String(s).toLowerCase());
      const camo = [], body = [];
      let vehicles = 0;
      for (const r of GameDB.vehicleRows) {
        const b = descBindFor(r.model);
        if (!b) continue;
        let hit = false;
        for (const e of new Set(b.map.values())) {
          if (!/masked/.test(e.cls || "")) { if (isBad(e.c) || isBad(e.n)) hit = true; continue; }
          if (isBad(e.c) || isBad(e.n)) hit = true;
          if (e.all && isBad(e.all.t1)) camo.push(r.model + ":" + e.all.t1);
          const own = String(e.c || "").toLowerCase().startsWith(r.model.toLowerCase());
          if (own && (isBad(e.c) || isBad(e.n))) body.push(r.model + ":" + e.c + "/" + e.n);
        }
        if (hit) vehicles++;
      }
      return { vehicles, camo: camo.slice(0, 6), nCamo: camo.length, body: body.slice(0, 6), nBody: body.length };
    })()`, 300000);
    // A propeller aircraft's load, which names its propeller masks: they are said as utility sheets.
    const prop = await evaluate(`(async () => { await loadVehicleTextures(${JSON.stringify(PROP_VEHICLE)});
      return (StatusLog.entries.find(e => /^(Loaded|Cancelled)/.test(e.msg)) || {}).msg || ""; })()`, 300000);
    // Every texture not opened as its row in the texture list shows it, at each quality: the row names
    // the pixel format of the tier that HOLDS the sheet. pickVariant hands the row the first tier
    // listed, a 0×0 $hq stub for 2 924 of the 2 948 here, and the row said "no data ✕" (review of
    // 2026-10-10). A quality with no tier of the texture at all lists no row, which is right.
    const rows = await evaluate(`(() => {
      const out = { n: 0, none: 0, bad: [] };
      for (const q of ["auto", "hq", "base"]) for (const rec of GameDB.stems.values()) {
        const en = GameDB.unreadOf(rec);
        if (!en || GameDB.blockKind(en) !== "format") continue;
        const row = textureRow(rec, q);
        if (!row) { out.none++; continue; }
        out.n++;
        const tag = row.children[1].textContent, title = row.firstChild.title;
        if (!/^[A-Z][A-Z0-9]+ ✕$/.test(tag) || !/pixel format [A-Z0-9]+ has no reader/.test(title) || /no data/.test(title))
          out.bad.push(q + " " + rec.stem + ": " + tag + " / " + title);
      }
      return { n: out.n, none: out.none, nBad: out.bad.length, bad: out.bad.slice(0, 5) };
    })()`, 120000);
    // Advanced ▸ Fill missing slots on the propeller aircraft's own slots. It called the sheets its
    // slots say the install HAS "not found", and named the shared propeller normal twice.
    const fill = await evaluate(`(async () => {
      try { await loadVehicleModel(${JSON.stringify(PROP_VEHICLE)}); } catch (e) { return { threw: String(e && e.message || e) }; }
      for (let i = 0; i < 240 && ![...App.slots.values()].some(s => s.composite); i++) await new Promise(r => setTimeout(r, 250));
      await fillMissingFromGame();
      const msg = (StatusLog.entries.find(e => /^Filled /.test(e.msg)) || {}).msg || "";
      const named = ((/not found: ([^\\n]*)/.exec(msg) || [, ""])[1]).replace(/…$/, "").split(", ").filter(Boolean);
      const held = named.filter(s => { const rec = [...GameDB.stems.values()].find(r => r.stem.toLowerCase() === s.toLowerCase());
        return rec && GameDB.unreadOf(rec); });
      return { msg, named, held, missing: [...App.slots.values()].filter(s => s.missing).length };
    })()`, 300000);
    const errs = await evaluate(`({ errs: (window.__boot || {}).errs || [], rejs: (window.__boot || {}).rejs || [] })`);
    return { scan, veh, errs, first, second, claim, prop, rows, fill };
  },
});
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const { scan: S, veh: V, errs: E } = r0.result;

console.log("\n=== the chooser, handed " + WT + " ===");
console.log(`   ${S.files} files listed in ${S.listMs} ms · scan done ${S.ms} ms after the pick`);
console.log(`   "${S.status}"`);
R.is(S.files > 1000 && S.listMs > 0, `the page's own change handler got the whole install from file:// (${S.files} files)`);
R.is(S.via === "list" && S.legacy && S.dirName === path.basename(WT),
  `the scan was handed the chooser's tree, as a read-only stand-in (${S.via}, "${S.dirName}")`);
R.is(!/Scan failed|No game data/.test(S.status) && S.models > 1000 && S.stems > 10000 && S.packs > 50 && S.units > 1000,
  `and indexed the install through it: ${S.units} vehicles, ${S.models} models, ${S.stems} textures, ${S.packs} packs`);
R.is(/opened another way/i.test(S.status) && /Download \.zip/.test(S.status),
  "the closing sentence says it was opened another way — pick it again next visit, export with Download .zip");
R.is(S.search === "" && S.open === "none", "the search box took the open button's place");

console.log(`\n=== ${VEHICLE}, loaded through it ===`);
console.log(`   ${V.threw ? "threw: " + V.threw : `${V.parts} mesh parts · ${V.slots} slots (${V.big} at 1024 px or more) · ${V.decoded} textures decoded · ${V.ms} ms`}`);
R.is(!V.threw && V.parts > 10, `the model's geometry came out of its .grp pack (${V.parts} parts)`);
R.is(!V.threw && V.big > 0 && V.decoded > 0, `and its sheets out of the .dxp packs, full size (${V.big} slot(s) at 1024 px or more)`);

// ---- the scan's summary on the real install, fresh and restored (review of 2026-10-10) ----
const { first: F, second: F2, claim: C, prop: P } = r0.result;
const num = s => +String(s || "").replace(/\D/g, "");
const sansSource = t => String(t || "").split("\n").filter(l => !/stored index/.test(l)).join("\n");
console.log("\n=== what the scan says, fresh and from the stored index ===");
console.log(`   fresh:    ${JSON.stringify(F.closing)}\n   restored: ${JSON.stringify(F2.closing)}\n   Advanced: ${JSON.stringify(F.diag)}`);
console.log(`   ${F.units} units · ${F.rows} listed · ${F.stems} textures, ${F.textures} not opened (${F.wind} wind tables) · ` +
  `${F.packs} texture packs of ${F.packList} on the list · ${C.vehicles} listed vehicles name an unopened sheet`);
R.is(/stored index/.test(F2.closing) && !/stored index/.test(F.closing), "the second scan came from the stored index, the first did not");
R.is(sansSource(F2.closing) === sansSource(F.closing), "and they say the same thing, but for where the index came from");
R.is(F.diag.length >= 2 && JSON.stringify(F2.diag) === JSON.stringify(F.diag) && !F.diag.some(l => /—\s*$/.test(l)),
  "Advanced is the same both times, and does not end on a bare dash");
R.is(F.packs === F2.packs && F.packs > 50 && F.packs < F.packList,
  `both count the texture packs alone (${F.packs} / ${F2.packs}), not the model packs on the same list (${F.packList})`);
R.is(num(F.closing.split(" vehicles")[0]) === F.rows && num(F.count) === F.rows,
  `the line counts what the list lists: ${JSON.stringify(F.closing.split("\n")[0])}, header ${JSON.stringify(F.count)}, ${F.rows} rows`);
const more = /([\d\s,.]+) more units in the game's list are not listed: .*/.exec(F.closing);
R.is(F.units === F.listedUnits || (more && num(more[1]) === F.units - F.listedUnits),
  `…and the ${F.units - F.listedUnits} registry units it does not list (${F.listedUnits} are listed on ${F.rows} rows) are said, and what they are`);
R.is(F.textures > 0 && F.textures === F.format && F.textures < F.stems / 10 && F.sheets === 0,
  `every unopened texture is a pixel-format case in this build (${F.format} of ${F.textures}), a small share of ${F.stems}, none named like a colour sheet`);
R.is(F.fmts.every(([f]) => /^[A-Z][A-Z0-9]+$/.test(f)),
  `each format is named, not printed as a number: ${F.fmts.map(([f, k]) => f + " ×" + k).join(", ")}`);
R.is(C.nCamo === 0 && C.nBody === 0,
  `no listed vehicle's camouflage sheet, or the paintable sheet named for it, is among them — what the summary says` +
  (C.nCamo || C.nBody ? ` (camo ${JSON.stringify(C.camo)}, body ${JSON.stringify(C.body)})` : ""));
R.is(/\d+ utility sheets? not opened/.test(P) && !/unavailable/.test(P),
  `a propeller aircraft's load says its utility sheets are not opened, and calls nothing unavailable: ${JSON.stringify(P)}`);
const { rows: TR, fill: FL } = r0.result;
R.is(TR.n > 0 && TR.nBad === 0,
  `every unopened texture's row names its pixel format, at every quality (${TR.n} rows, ${TR.none} with no tier at that quality)` +
  (TR.nBad ? ` — ${TR.nBad} do not: ${JSON.stringify(TR.bad)}` : ""));
R.is(!FL.threw && /\d+ utility sheets? not opened/.test(FL.msg) && FL.held.length === 0 && new Set(FL.named).size === FL.named.length,
  `Fill missing slots on ${PROP_VEHICLE} counts its utility sheets apart and calls none of them "not found": ${JSON.stringify(FL.threw || FL.msg)}`);
// Which kinds appear depends on the join: since the vehicle-join fix every tagged vehicle is on the
// model its own blk names, so on the real install the "could not match" clause is gone and only the
// untagged units are left (412 of 3 883, measured 2026-10-10). What must hold either way is that the
// left-out units are counted and said what they are, and never blamed on the install.
const unlistedLine = (/\d[\d\s,.]* more units in the game's list are not listed: [^\n]*/.exec(F.closing) || [""])[0];
R.is(!!unlistedLine && /not tagged as a vehicle|could not match to a model by name/.test(unlistedLine) && !/in this install/.test(F.closing),
  `the units the list leaves out are counted and said what they are, never as the install's miss: ${JSON.stringify(unlistedLine)}`);

const errs = (E.errs || []).concat(E.rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
