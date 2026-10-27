// The vehicle list can be browsed with nothing typed (ROADMAP 3.38, 2026-09-25).
//
// WHY THIS EXISTS. 3.28(3) had made an empty search box show a hint instead of a list — "a filter
// narrows a search, so there has to be a search first". The owner reversed it: "make search for
// vehicles show list of vehicles even with no input in text field". A box that is empty until you
// already know a name gives no way to browse. Four things make browsing work, one check each:
//
//   * nothing typed lists every vehicle, in the game's tree order (nation, then rank, then name);
//   * a filter narrows that list — the click's effect is the list itself;
//   * a long list arrives 200 rows at a time, so 3 882 vehicles cost what 200 did, and the "Show
//     more" button at its end loads the next chunk (an IntersectionObserver presses it on scroll);
//   * typing still searches, exact and prefix matches first, and the texture mode still wants text.
//
// Two more since the review of 2026-10-10, which browsed the real install: a unit with no rank (a
// radar, a SAM, the C-47) comes after the ranked ones instead of leading every nation; and the lit
// rows are the units the skin is for — the ticks under Export ▸ Vehicles, re-marked in place when
// they change — not every row that shares the loaded model.
//
// Synthetic rows, so it needs no install.
//
// Usage: node tools/t90_browse.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var o = {};
  var el = document.getElementById("gameList"), box = document.getElementById("gameSearch");
  var keep = { rows: GameDB.vehicleRows, models: GameDB.models, stems: GameDB.stems, units: GameUnits.byId,
               nations: GameUnits.nations, q: box.value, key: App.vehicleKey, su: App.skinUnits, sort: Finder.sort };
  var names = function(){ return [].slice.call(el.querySelectorAll(".rowitem .t1")).map(function(e){ return e.textContent; }); };
  var moreBtn = function(){ return el.querySelector(".listmore"); };
  var press = function(){ var b = moreBtn(); if (b) b.click(); };
  var setRows = function(units){
    GameUnits.byId = new Map(units.map(function(u){ return [u.id, u]; }));
    GameDB.vehicleRows = units.map(function(u){ return { unit: u, model: u.id }; });
    GameDB.models = GameDB.vehicleRows.map(function(r){ return r.model; });
  };
  try {
    GameUnits.nations = [{ tag: "country_usa" }, { tag: "country_ussr" }];
    GameDB.stems = new Map([["t90_sheet_c", { stem: "t90_sheet_c", tiers: {} }]]);
    setRows([
      { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 },
      { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 },
      { id: "p_51", name: "P-51D", fullName: "P-51D", cls: "air", country: "USA", tree: "country_usa", rank: 3 },
    ]);
    clearFilters(); box.value = "";

    // (1) nothing typed: every vehicle, nation then rank
    renderGameSearch();
    o.all = { names: names().join(","), hint: el.className };
    // (2) a filter narrows the list
    GameFilter.cls = "air"; renderGameSearch();
    o.air = names().join(",");
    clearFilters();

    // (3) 450 vehicles: 200, then a button that loads the rest 200 at a time
    var many = [];
    for (var i = 0; i < 450; i++) many.push({ id: "v" + i, name: "V" + String(i).padStart(3, "0"), fullName: "V" + i, cls: "air", country: "USA", tree: "country_usa", rank: 1 });
    setRows(many);
    renderGameSearch();
    o.chunk = { first: names().length, btn: moreBtn() && moreBtn().textContent, io: !!el._moreIO };
    press(); o.chunk.second = names().length; o.chunk.btn2 = moreBtn() && moreBtn().textContent;
    press(); o.chunk.third = names().length;
    o.chunk.hidden = !!moreBtn() && moreBtn().style.display === "none"; o.chunk.ioGone = !el._moreIO;
    o.chunk.order = names().slice(198, 202).join(",");
    // scrolled to the end, the observer loads the next chunk by itself — nobody has to press
    renderGameSearch();
    var wrap = document.getElementById("gameListWrap");
    var shownWas = wrap.offsetParent !== null;
    wrap.scrollTop = wrap.scrollHeight;
    for (var t = 0; t < 40 && names().length < 400; t++) await new Promise(function(r){ setTimeout(r, 50); });
    o.scrolled = { visible: shownWas, rows: names().length };
    // a short list gets no button at all
    setRows(many.slice(0, 20)); renderGameSearch();
    o.short = { n: names().length, btn: !!moreBtn(), io: !!el._moreIO };

    // (4) typing still searches, prefix first; texture mode with nothing typed asks for text
    setRows([
      { id: "f_4ej", name: "F-4EJ", fullName: "F-4EJ", cls: "air", country: "Japan", tree: "country_usa", rank: 6 },
      { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 },
      { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 },
    ]);
    box.value = "f-4e"; renderGameSearch();
    o.typed = names().join(",");
    box.value = ""; GameFilter.tex = true; renderGameSearch();
    o.tex = { cls: el.className, text: el.textContent };
    GameFilter.tex = false;

    // (5) a unit with no rank is not rank 0 (review of 2026-10-10): radars, SAMs and the C-47 led
    // every nation's list. In tree order they follow the nation's ranked vehicles; sorted by rank,
    // every ranked vehicle.
    setRows([
      { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 },
      { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 },
      { id: "p_51", name: "P-51D", fullName: "P-51D", cls: "air", country: "USA", tree: "country_usa", rank: 3 },
      { id: "us_radar", name: "AN/TPS-59 radar", fullName: "AN/TPS-59 radar", cls: "other", country: "USA", tree: "country_usa", rank: 0 },
      { id: "c-47", name: "C-47", fullName: "C-47", cls: "air", country: "USA", tree: "country_usa", rank: 0 },
      { id: "ussr_sam", name: "SAM", fullName: "SAM", cls: "other", country: "USSR", tree: "country_ussr", rank: 0 },
    ]);
    box.value = ""; renderGameSearch();
    o.rankless = { tree: names().join(",") };
    Finder.setSort("rank"); renderGameSearch(); o.rankless.rank = names().join(",");
    Finder.setSort("best");

    // (6) the highlight is the skin's units, not the loaded model's rows (review of 2026-10-10): the
    // F-4E loaded, its event copy ticked too, and a third row on the same model that is NOT ticked —
    // the Kurnass 2000 the old name join put on f_4e. Then unticking re-marks the rows in place.
    var f4 = { id: "f-4e", name: "F-4E Phantom II", fullName: "F-4E Phantom II", cls: "air", country: "USA", tree: "country_usa", rank: 7 };
    var ev = { id: "f_4e_event", name: "F-4E Phantom II (event)", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 7 };
    var ku = { id: "f-4e_kurnass_2000", name: "Kurnass 2000", fullName: "Kurnass 2000", cls: "air", country: "Israel", tree: "country_usa", rank: 8 };
    GameUnits.byId = new Map([[f4.id, f4], [ev.id, ev], [ku.id, ku]]);
    GameDB.vehicleRows = [{ unit: f4, model: "f_4e" }, { unit: ev, model: "f_4e" }, { unit: ku, model: "f_4e" }];
    GameDB.models = ["f_4e"];
    App.vehicleKey = "f_4e";
    App.skinUnits = [{ unit: f4, score: 100, on: true }, { unit: ev, score: 80, on: true }, { unit: ku, score: 80, on: false }];
    renderGameSearch();
    var lit = function(){ return [].slice.call(el.querySelectorAll(".rowitem.sel .t1")).map(function(e){ return e.textContent; }).join(","); };
    o.lit = { load: lit() };
    var evRow = [].slice.call(el.querySelectorAll(".rowitem")).filter(function(x){ return /event/.test(x.textContent); })[0];
    App.skinUnits[1].on = false; renderUnitList();
    o.lit.untick = lit();
    o.lit.sameNode = evRow === [].slice.call(el.querySelectorAll(".rowitem")).filter(function(x){ return /event/.test(x.textContent); })[0];
    App.skinUnits[2].on = true; renderUnitList();
    o.lit.tick = lit();
    App.vehicleKey = null; App.skinUnits = null; renderUnitList();
    o.lit.cleared = lit();
    // export/ loads before ui/ (CLAUDE.md §2): the unit list says it changed, it does not reach into
    // the vehicle list to re-mark it
    o.lit.noReach = !/VehicleList/.test(String(renderUnitList)) && !/VehicleList/.test(String(refreshSkinUnits));

    // (7) rows the list would draw alike but for the model — a tank and its skin-pack copy — lead
    // their subtitle with what tells them apart, the "tell" the join gives each twin (review of
    // 2026-10-10: at real window sizes the subtitle shows its first 10 characters, the model came
    // last, and these two models share their first 16)
    var la = { id: "germ_leopard_2a4m_can", name: "Leopard 2A4M CAN", fullName: "Leopard 2A4M CAN", cls: "tank", country: "Germany", tree: "country_germany", rank: 7 };
    var ls = { id: "germ_leopard_2a4m_can_sm", name: "Leopard 2A4M CAN", fullName: "Leopard 2A4M CAN", cls: "tank", country: "Germany", tree: "country_germany", rank: 7 };
    var l6 = { id: "germ_leopard_2a6", name: "Leopard 2A6", fullName: "Leopard 2A6", cls: "tank", country: "Germany", tree: "country_germany", rank: 8 };
    GameUnits.byId = new Map([[la.id, la], [ls.id, ls], [l6.id, l6]]);
    GameDB.vehicleRows = [{ unit: la, units: [la], model: "leopard_2a4m_can", twin: true, tell: "leopard_2a4m_can" },
                          { unit: ls, units: [ls], model: "leopard_2a4m_can_sm_elsa", twin: true, tell: "…sm_elsa" },
                          { unit: l6, units: [l6], model: "leopard_2a6" }];
    GameDB.models = GameDB.vehicleRows.map(function(r){ return r.model; });
    box.value = "leopard"; renderGameSearch();
    o.twins = [].slice.call(el.querySelectorAll(".rowitem .t2")).map(function(e){ return e.textContent; });
    o.twinTitles = [].slice.call(el.querySelectorAll(".rowitem")).map(function(e){ return e.title; });
  } finally {
    GameDB.vehicleRows = keep.rows; GameDB.models = keep.models; GameDB.stems = keep.stems;
    GameUnits.byId = keep.units; GameUnits.nations = keep.nations; box.value = keep.q;
    App.vehicleKey = keep.key; App.skinUnits = keep.su; Finder.setSort(keep.sort);
    clearFilters(); renderGameSearch(); renderUnitList();
  }
  return o;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAIL: " + r.reason); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }

console.log("\n=== nothing typed lists the vehicles ===");
R.is(o.all.names === "P-51D,F-4E,T-34" && !/emptyhint/.test(o.all.hint),
  `with an empty box every vehicle is listed, in tree order — nation, then rank (${o.all.names})`);
R.is(o.air === "P-51D,F-4E", `a filter narrows that list, and the list is its visible effect (${o.air})`);

console.log("\n=== a long list arrives a chunk at a time ===");
const C = o.chunk;
R.is(C.first === 200 && /Show 200 more · 250 left/.test(C.btn || "") && C.io,
  `450 vehicles render 200 rows and a button — "${C.btn}" — which an IntersectionObserver presses on scroll`);
R.is(C.second === 400 && /Show 50 more · 50 left/.test(C.btn2 || ""), `pressing it adds the next 200 (${C.second}), and it counts what is left ("${C.btn2}")`);
R.is(C.third === 450 && C.hidden && C.ioGone, `the last press shows the rest (${C.third}); the button hides and the observer is let go`);
R.is(C.order === "V198,V199,V200,V201", `the chunks join in order, with nothing skipped or repeated (${C.order})`);
R.is(o.scrolled.visible && o.scrolled.rows >= 400,
  `scrolled to the end, the next chunk loads by itself (${o.scrolled.rows} rows) — the IntersectionObserver presses the button`);
R.is(o.short.n === 20 && !o.short.btn && !o.short.io, "a list shorter than one chunk gets no button and no observer");

console.log("\n=== typing still searches ===");
R.is(o.typed === "F-4E,F-4EJ", `a query filters, the exact match first (${o.typed})`);
R.is(/emptyhint/.test(o.tex.cls) && /texture/.test(o.tex.text), `the texture mode with nothing typed asks for a name ("${o.tex.text}") rather than listing 70 000 sheets`);

console.log("\n=== a vehicle with no rank comes after the ranked ones ===");
R.is(o.rankless.tree === "P-51D,F-4E,AN/TPS-59 radar,C-47,T-34,SAM",
  `in tree order the radar and the C-47 follow the nation's ranked vehicles instead of leading it (${o.rankless.tree})`);
R.is(o.rankless.rank === "F-4E,P-51D,T-34,AN/TPS-59 radar,C-47,SAM",
  `sorted by rank (highest first) they come after every ranked vehicle (${o.rankless.rank})`);

console.log("\n=== the highlight is the units the skin is for ===");
R.is(o.lit.load === "F-4E Phantom II,F-4E Phantom II (event)",
  `with the F-4E loaded and its event copy ticked, those two rows are lit — not the Kurnass 2000 on the same model (${o.lit.load})`);
R.is(o.lit.untick === "F-4E Phantom II" && o.lit.sameNode,
  `unticking the event copy unlights its row, in place (${o.lit.untick}; same element: ${o.lit.sameNode})`);
R.is(o.lit.tick === "F-4E Phantom II,Kurnass 2000", `ticking the Kurnass 2000 lights its row (${o.lit.tick})`);
R.is(o.lit.cleared === "", `with no vehicle loaded nothing is lit ("${o.lit.cleared}")`);
R.is(o.lit.noReach, `export/units.js tells the list by an event; it does not call VehicleList, which loads after it`);

console.log("\n=== rows drawn alike but for the model lead with the model ===");
const tw = o.twins || [];
R.is(tw.includes("leopard_2a4m_can · Rank VII · Germany") && tw.includes("…sm_elsa · Rank VII · Germany"),
  `the two Leopard 2A4M CAN rows start with what tells them apart (${JSON.stringify(tw)})`);
R.is((o.twinTitles || []).some(t => /\(leopard_2a4m_can_sm_elsa\)/.test(t)),
  `and the copy's whole model is still in its row's hover label (${JSON.stringify(o.twinTitles)})`);
R.is(tw.includes("Rank VIII · Germany · leopard_2a6"), `a row with no twin keeps its order, the model last (${JSON.stringify(tw)})`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
