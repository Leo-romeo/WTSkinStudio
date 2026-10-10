// Search that forgives, and one search control over both lists (ROADMAP 3.5, which is also 3.28(5)).
//
// WHY THIS EXISTS. The vehicle search was a chain of String.includes, so one keystroke kept a name
// out of reach: measured 2026-09-26 on a synthetic install, "f4e", "abrahms", "su30", "t34", "tiger 2"
// and "leopard2a6" all answered "No matches" while the vehicle was right there. A lit chip was a hard
// `return false`, so a hit the user could see he asked for was silently absent; raw textures vanished
// under any type chip; the UserSkins list had a box of its own with no chips and no order to choose;
// and the order of the vehicle list was hardcoded. This holds each of those, in two halves:
//
//   Node, on the pure `/*==MATCH==*/` section, against a FIXED unit list (the oracle): what every
//   query finds, in what order, and what it must not find — a typo in the letters is forgiven, a
//   different digit never is ("f-15" is not a typo of "f-16"), and the exact / prefix float the old
//   search had is still the top of the order ("f-4e" puts the F-4E above the F-4EJ).
//
//   Headless Chrome, on the real lists: one box searches both; typed, what the chips leave out is
//   listed under "Outside your filters" after what they keep; nothing typed, a chip narrows the list
//   and there is no outside group; raw textures come after the vehicles with a type chip lit; each of
//   the four sorts orders both lists the way its entry says; reset clears the box and the chips and
//   redraws both; and a list longer than a chunk crosses from one group to the next in order.
//
// Synthetic data throughout, so it needs no install.
//
// Usage: node tools/t96_search.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
let Match;
try { ({ Match } = new Function(sectionOf("MATCH") + "\nreturn { Match };")()); }
catch (e) { console.log("FAIL: " + e.message); process.exit(1); }

// ---- the oracle: a fixed unit list, with the names the game gives them ----
const UNITS = [
  ["f_4e", "F-4E Phantom II", "USA"], ["f_4ej", "F-4EJ Phantom II", "Japan"], ["f_4j", "F-4J Phantom II", "USA"],
  ["us_m1_abrams", "M1 Abrams", "USA"], ["us_m1a2_sep3_abrams", "M1A2 SEPv3", "USA"],
  ["su_30sm", "Su-30SM", "USSR"], ["su_27", "Su-27", "USSR"],
  ["ussr_t_34_1941", "T-34 (1941)", "USSR"], ["ussr_t_34_85_zis_53", "T-34-85", "USSR"],
  ["germ_leopard_2a6", "Leopard 2A6", "Germany"], ["germ_leopard_2a4", "Leopard 2A4", "Germany"],
  ["germ_pzkpfw_vi_ausf_b_tiger_iih", "Tiger II (H)", "Germany"], ["spitfire_mk9c", "Spitfire Mk IX", "Britain"],
  ["f_15c", "F-15C", "USA"], ["f_16c", "F-16C", "USA"], ["bf-109g-6", "Bf 109 G-6", "Germany"],
  ["fr_amx_50_surbaisse", "AMX-50 Surbaissé", "France"], ["ki_43_2", "Ki-43 II", "Japan"],
  // Added 2026-09-27 from what the real roster showed (3 294 vehicles): a Chinese MiG whose unit id
  // begins "mig-", marks that carry a letter or run past ten, and an Italian Leopard 2 whose "it_"
  // id must not read as "1t".
  ["mig-15bis_nr23_china", "J-2", "China"], ["mig-15_ns23", "MiG-15", "USSR"],
  ["spitfire_lf_mk9c", "Spitfire LF Mk IXc", "Britain"], ["spitfire_mk14e", "Spitfire F Mk XIVe", "Britain"],
  ["germ_leopard_I", "Leopard I", "Germany"], ["it_leopard_2a7_hungary", "Leopard 2A7HU", "Hungary"],
  // Added 2026-09-27 from the review's run over the real install: "is-2" found an Israeli "…II" by
  // its tree's first two letters, "a-10" an AMX-10P by the "a" of "amx", and "m1" put the M-17 escort
  // ship above the M1 Abrams.
  ["ussr_is_2", "IS-2", "USSR"], ["f_16c_block_40_barak_2", "F-16C Barak II", "Israel"],
  ["a_10a_late", "A-10A Late", "USA"], ["amx_10p", "AMX-10P", "France"], ["escort_typem1935", "M-17", "USSR"],
];
// The record the vehicle list builds (ui/panels/game-list.js): names and ids as names, the operator
// as a word. Built here rather than lifted because the list is DOM code; the in-page half below
// holds the list's own records.
const recs = UNITS.map(([id, name, country]) => ({ name, rec: Match.record([name, name, id, id], [country]) }));
const rank = q => {
  const pq = Match.query(q);
  if (!pq) return null;
  return recs.map(r => [r.name, Match.score(pq, r.rec)]).filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const names = q => (rank(q) || []).map(x => x[0]);
const tier = (q, name) => { const x = (rank(q) || []).find(y => y[0] === name); return x ? Math.floor(x[1] / 100) : 0; };
const show = q => JSON.stringify(names(q));

console.log("\n=== the matcher against a fixed unit list (Node, the MATCH section) ===");
R.is(names("f-4e")[0] === "F-4E Phantom II" && names("f-4e")[1] === "F-4EJ Phantom II" && names("f-4e").length === 2,
  `"f-4e": the F-4E first, the F-4EJ second, nothing else — the exact/prefix float the old search had (${show("f-4e")})`);
R.is(names("f4e")[0] === "F-4E Phantom II" && tier("f4e", "F-4E Phantom II") === 5,
  `"f4e" — the missing hyphen — is the F-4E, and an exact match (${show("f4e")})`);
R.is(names("F 4E")[0] === "F-4E Phantom II", `"F 4E" — a space, and capitals — is the same F-4E`);
R.is(names("abrahms").length === 2 && names("abrahms").every(n => /Abrams|SEP/.test(n)) && tier("abrahms", "M1 Abrams") === 1,
  `"abrahms" — a letter too many — finds both Abrams, in the near tier (${show("abrahms")})`);
R.is(names("abrmas").includes("M1 Abrams"), `"abrmas" — two letters swapped — finds the M1 Abrams (${show("abrmas")})`);
R.is(show("su30") === '["Su-30SM"]' && tier("su30", "Su-30SM") === 4,
  `"su30" is the start of Su-30SM and nothing else — not the Su-27 (${show("su30")})`);
R.is(names("t34").length === 2 && names("t34").every(n => /^T-34/.test(n)) && tier("t34", "T-34-85") === 4,
  `"t34" finds both T-34s by their start (${show("t34")})`);
R.is(names("tiger 2")[0] === "Tiger II (H)" && tier("tiger 2", "Tiger II (H)") >= 3,
  `"tiger 2" is the Tiger II — a roman numeral answers to its digit (${show("tiger 2")})`);
R.is(names("spitfire 9")[0] === "Spitfire Mk IX", `"spitfire 9" is the Spitfire Mk IX (${show("spitfire 9")})`);
R.is(show("spitfire 9") === '["Spitfire Mk IX","Spitfire LF Mk IXc"]' && show("spitfire 14") === '["Spitfire F Mk XIVe"]',
  `a mark with a letter after it, or past ten, answers to its digits too: "spitfire 9" (${show("spitfire 9")}), "spitfire 14" (${show("spitfire 14")})`);
R.is(show("leopard 1") === '["Leopard I"]',
  `"leopard 1" is the Leopard I and not the Italian 2A7HU — one roman letter never takes a letter after it, so "it_" is not "1t" (${show("leopard 1")})`);
R.is(Match.roman("ixc") === "9c" && Match.roman("xive") === "14e" && Match.roman("xviii") === "18" && Match.roman("iv") === "4" &&
     Match.roman("it") === null && Match.roman("xm") === null && Match.roman("mix") === null && Match.roman("f4e") === null,
  "the numeral reader: ixc 9c, xive 14e, xviii 18, iv 4 — and it, xm, mix and f4e are not numerals");
R.is(show("mig") === '["MiG-15","J-2"]',
  `"mig": the MiG-15 by its name before the J-2 by its unit id — inside a tier the name on screen ranks first (${show("mig")})`);
R.is(show("leopard2a6") === '["Leopard 2A6"]' && tier("leopard2a6", "Leopard 2A6") === 5,
  `"leopard2a6" — no space — is the 2A6, exactly, and not the 2A4 (${show("leopard2a6")})`);
R.is(show("leopadr 2a6") === '["Leopard 2A6"]', `"leopadr 2a6" — letters swapped — is still only the 2A6 (${show("leopadr 2a6")})`);
R.is(show("f-15") === '["F-15C"]', `"f-15" is the F-15C and never the F-16C — a digit is not a typo (${show("f-15")})`);
R.is(names("phantom").length === 3 && tier("phantom", "F-4J Phantom II") === 3, `"phantom" finds the three Phantoms as a whole word (${show("phantom")})`);
R.is(show("hantom").includes("Phantom") && tier("hantom", "F-4E Phantom II") === 2,
  `"hantom" — letters inside a name — is the contains tier (${show("hantom")})`);
R.is(show("surbaisse") === '["AMX-50 Surbaissé"]', `"surbaisse" finds "Surbaissé" — accents do not count (${show("surbaisse")})`);
R.is(names("ki 43 2")[0] === "Ki-43 II" && tier("ki 43 2", "Ki-43 II") === 5, `"ki 43 2" is the Ki-43 II, exactly (${show("ki 43 2")})`);
R.is(names("usa").length === 7 && !names("usa").includes("F-4EJ Phantom II") && tier("usa", "F-16C") === 3, `"usa" lists the seven US vehicles by the operator word, and not the Japanese F-4EJ (${names("usa").length})`);
R.is(show("is-2") === '["IS-2"]' && names("isr").includes("F-16C Barak II"),
  `"is-2" is the IS-2 and not the Israeli Barak II — two letters are not the start of a nation, three are ("isr" finds it) (${show("is-2")})`);
R.is(show("a-10") === '["A-10A Late"]',
  `"a-10" is the A-10A and not the AMX-10P — one letter is a whole word or nothing (${show("a-10")})`);
R.is(names("m1")[0] === "M1 Abrams" && names("m1").includes("M-17"),
  `"m1": the M1 Abrams, whose first word it is, above the M-17 it is only the start of (${show("m1")})`);
{
  // The word's edge is one step and a name's place two, so an edge never lifts a later name even to
  // the level of an earlier one: "ho" starting the name on screen ("Hornet") outranks "ho" as the
  // whole first word of a unit's SECOND name ("Ho-Ri", the name on screen being "Chi-Ri").
  const pq = Match.query("ho"), a = Match.score(pq, Match.record(["Hornet"], [])), b = Match.score(pq, Match.record(["Chi-Ri", "Ho-Ri"], []));
  R.is(a > b && Math.floor(a / 100) === 4 && Math.floor(b / 100) === 4,
    `a prefix of the name on screen outranks a prefix of a later name even when only the later one ends on a word's edge (${a} > ${b})`);
}
R.is(names("abc").length === 0 && names("zzzz").length === 0, `"abc" and "zzzz" find nothing — three letters are not forgiven, and "zzzz" is near nothing`);
R.is(Match.query("f") === null && Match.query(" - ") === null && Match.query("f4") !== null,
  "one character, or only separators, is not a search yet — it browses, the way the old two-character rule did");
{
  // Every tier, one query each, strictly ordered: the ranking IS the tier first.
  const t = [tier("f4e", "F-4E Phantom II"), tier("f-4e", "F-4EJ Phantom II"), tier("phantom", "F-4E Phantom II"),
             tier("hantom", "F-4E Phantom II"), tier("abrahms", "M1 Abrams")];
  R.is(t.join(",") === "5,4,3,2,1", `the five tiers, exact → prefix → words → contains → near (${t.join(",")})`);
  const k = Match.key("f_4e_body_c"), q = s => Match.query(s);
  R.is(Match.keyScore(q("f-4e"), k) === 400 && Match.keyScore(q("f_4e_body_c"), k) === 500 &&
       Match.keyScore(q("body"), k) > 200 && Match.keyScore(q("body"), k) < 300 && Match.keyScore(q("zz"), k) === 0,
    "a texture stem answers exact, prefix and contains by its key — \"f-4e\" is the start of f_4e_body_c");
  R.is(Match.nearest("a".repeat(70), "a".repeat(70), 2) === 0 && Match.nearest("abcd", "abce", 1) === 1,
    "a word longer than the scratch rows grows them instead of reading past their end");
}
{
  // Not a latency gate — five suites share this machine — only a tripwire for something quadratic.
  const many = [];
  for (let i = 0; i < 4000; i++) many.push(Match.record(["Vehicle " + i + " Mk " + (i % 9), "Vehicle " + i, "veh_" + i], ["USA"]));
  const t0 = performance.now();
  const pq = Match.query("abrahms");
  let hits = 0;
  for (const r of many) if (Match.score(pq, r)) hits++;
  const ms = performance.now() - t0;
  R.is(ms < 1000, `4 000 prepared names scored for a near-miss query in ${ms.toFixed(1)} ms (${hits} hits) — nothing quadratic`);
}

/// ---- the page: the two lists under the one control ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP (page half): no Chrome or Edge found."); R.finish(); }

// EVERY action in here goes through its control the way a user's does — a key into the box (and the
// box's own 120 ms wait), a click on the chip, a change event on the select, a click on reset or on
// Reset all settings — and the lists are read straight after it, with nothing calling
// Finder.changed() in between. The review of 2026-09-27 found this half calling it itself after every
// action, so it could not see that a chip redrew only the vehicle list, nor whether the sort's own
// handler redrew anything at all: the suite passed with both broken. Loading data is the one thing no
// control does, and there the test redraws once, the way the end of a folder scan does.
const BODY = `async function(){
  var o = {};
  var $ = function(id){ return document.getElementById(id); };
  var el = $("gameList"), sl = $("userSkinList"), box = $("gameSearch");
  var keep = { db: Object.assign({}, GameDB), units: GameUnits.byId, nations: GameUnits.nations, maxRank: GameUnits.maxRank,
               skins: App.userSkins, dir: App.userSkinsDir, sort: Finder.sort, shown: $("rowGameSearch").style.display,
               disabled: box.disabled, confirm: window.confirm };
  // a list as a sequence: "#label" for a group's label, the row's name for a row, MORE for the button,
  // and "!" and the text when the list is a hint instead
  var seq = function(root){
    if (root.classList.contains("emptyhint")) return "!" + root.textContent;
    return [].slice.call(root.children).map(function(c){
      if (c.classList.contains("listmore")) return c.style.display === "none" ? "" : "MORE";
      if (c.classList.contains("rowitem")) { var t = c.querySelector(".t1"); return t ? t.textContent : c.firstChild.textContent; }
      return "#" + c.textContent;
    }).filter(Boolean).join("|");
  };
  var lists = function(){ return { veh: seq(el), skins: seq(sl) }; };
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  // A timer set after the box's own 120 ms one fires after it, however loaded the machine is.
  var type = async function(q){ box.value = q; box.dispatchEvent(new Event("input", { bubbles: true })); await wait(200); };
  var chip = function(row, title){
    var b = [].slice.call(document.querySelectorAll("#" + row + " .chip")).filter(function(c){ return c.title.indexOf(title) === 0; })[0];
    if (!b) throw new Error("no chip titled " + JSON.stringify(title) + " in #" + row);
    b.click();
  };
  var sortBy = function(v){ var s = $("gameSort"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); };
  var U = function(id, name, cls, tree, rank){ return { id: id, name: name, fullName: name, cls: cls, country: "", tree: tree, rank: rank }; };
  var setUnits = function(list){
    GameUnits.byId = new Map(list.map(function(u){ return [u.id, u]; }));
    GameDB.vehicleRows = list.map(function(u){ return { unit: u, model: u.id }; });
    GameDB.models = GameDB.vehicleRows.map(function(r){ return r.model; });
  };
  var stem = function(w){ return { stem: "f_4e_body_c", tiers: { base: { w: w, h: w, tier: "base", fmt: "DXT5", compName: "zstd", size: 4096, supported: true } } }; };
  var texTag = function(){ var r = el.querySelector(".partrow"); return r ? r.children[1].textContent : ""; };
  var four = function(){
    setUnits([U("f_4e", "F-4E Phantom II", "air", "country_usa", 6), U("f_4ej", "F-4EJ Phantom II", "air", "country_usa", 6),
              U("t_34", "T-34", "tank", "country_ussr", 2), U("leopard_2a6", "Leopard 2A6", "tank", "country_germany", 8)]);
  };
  try {
    GameUnits.nations = [{ tag: "country_usa", name: "USA" }, { tag: "country_germany", name: "Germany" }, { tag: "country_ussr", name: "USSR" }];
    GameUnits.maxRank = 8;
    GameDB.stems = new Map([["f_4e_body_c", stem(1024)]]);
    four();
    App.userSkins = [{ name: "desert", kind: "dir", units: ["f_4e"], texCount: 2, mtime: 3 },
                     { name: "winter", kind: "dir", units: ["t_34"], texCount: 2, mtime: 2 },
                     { name: "leo camo", kind: "dir", units: ["leopard_2a6"], texCount: 2, mtime: 1 }];
    App.userSkinsDir = null;
    $("rowGameSearch").style.display = ""; box.disabled = false;
    clearFilters(); renderFilterChips(); sortBy("best"); box.value = ""; Finder.changed();      // the end of a scan

    // (1) one box, both lists
    await type("phantom"); o.both = lists();
    await type("leopard"); o.both2 = lists();
    // (2) a chip clicked with something typed: BOTH lists split at once, before another key is pressed
    await type("phantom");
    chip("gameClassRow", "Show only ground"); o.chipTyped = lists();
    await type("f-4e"); o.out = seq(el);                          // what the chip leaves out, then the raw texture
    chip("gameClassRow", "Show only aircraft"); o.chipSwitch = lists();
    await type("t-34"); o.out2 = seq(el);
    // (3) nothing typed: a chip narrows both lists and nothing is listed as outside — each kind of chip
    await type(""); o.browse = lists();
    chip("gameClassRow", "Show only ground"); o.ground = lists();
    chip("gameRankRow", "Rank II,"); o.rank2 = lists();
    chip("gameNationRow", "Germany"); o.nation = lists();
    chip("gameNationRow", "Germany"); chip("gameRankRow", "Rank II,"); chip("gameClassRow", "Show only ground"); o.unchipped = lists();

    // (4) the four sorts, through the select, over both lists — each change read before anything else
    // redraws, and the order of the four chosen so that every change moves at least one list
    sortBy("name");
    setUnits([U("a", "Alpha", "air", "country_usa", 3), U("b", "Bravo", "air", "country_germany", 1),
              U("c", "Charlie", "air", "country_usa", 1), U("d", "Delta", "air", "country_ussr", 2),
              U("dp", "Deltaplan", "air", "country_ussr", 4), U("ad", "Alpha Delta", "air", "country_germany", 5)]);
    App.userSkins = [{ name: "zulu", kind: "dir", units: ["b"], texCount: 1, mtime: 3 },
                     { name: "alpha skin", kind: "dir", units: ["d"], texCount: 1, mtime: 1 },
                     { name: "mike", kind: "dir", units: ["c"], texCount: 1, mtime: 2 }];
    Finder.changed();                                              // new data
    o.sorts = {};
    ["best", "tree", "rank", "name"].forEach(function(s){ sortBy(s); o.sorts[s] = { empty: lists(), state: Finder.sort }; });
    await type("delta");
    ["best", "tree", "rank", "name"].forEach(function(s){ sortBy(s); o.sorts[s].typed = seq(el); o.sorts[s].typedSkins = seq(sl); });

    // (5) reset clears the box and the chips, and redraws both lists
    sortBy("best");
    chip("gameClassRow", "Show only ground"); await type("zulu");
    o.beforeReset = seq(sl);
    $("btnResetFilters").click();
    o.reset = { q: box.value, filtered: Finder.filtered(), skins: seq(sl), veh: seq(el) };

    // (6) Reset all settings and Import… move the sort; both lists follow at once
    sortBy("name"); o.beforePrefs = lists();
    window.confirm = function(){ return true; };
    $("btnPrefsReset").click();
    window.confirm = keep.confirm;
    o.prefsReset = { sort: Finder.sort, sel: $("gameSort").value, lists: lists() };
    sortBy("rank"); o.beforeImport = lists();                     // an order the file does not ask for
    var file = prefsBlob(true); file.gsort = "name";
    await importPrefsFile(new File([JSON.stringify(file)], "t96_settings.json", { type: "application/json" }));
    o.prefsImport = { sort: Finder.sort, sel: $("gameSort").value, lists: lists() };
    sortBy("best");

    // (7) a list longer than a chunk crosses from one group to the next, in order
    var many = [];
    for (var i = 0; i < 250; i++) many.push(U("za" + i, "Zeta A" + String(i).padStart(3, "0"), "air", "country_usa", 1));
    for (var j = 0; j < 100; j++) many.push(U("zt" + j, "Zeta T" + String(j).padStart(3, "0"), "tank", "country_usa", 1));
    setUnits(many); App.userSkins = []; Finder.changed();         // new data
    chip("gameClassRow", "Show only aircraft"); await type("zeta");
    var parts = function(){ var s = seq(el).split("|"); return { rows: s.filter(function(x){ return x[0] !== "#" && x !== "MORE"; }).length,
      labels: s.filter(function(x){ return x[0] === "#"; }), more: el.querySelector(".listmore") && el.querySelector(".listmore").style.display !== "none" ? el.querySelector(".listmore").textContent : "" }; };
    o.chunk1 = parts();
    el.querySelector(".listmore").click();
    o.chunk2 = parts();
    var s2 = seq(el).split("|"), at = s2.indexOf("#Outside your filters · 100");
    o.chunk2.join = at > 0 ? s2.slice(at - 1, at + 2).join("|") : "";
    $("btnResetFilters").click();

    // (8) a rescan that keeps the stem count: the texture rows are the new scan's, not the old one's.
    // The stem table's keys are cached beside it and rebuilt when the table is replaced — so a scan has
    // to replace it (GameScan.reset), not clear and refill the same Map.
    four(); GameDB.stems = new Map([["f_4e_body_c", stem(1024)]]); Finder.changed();
    await type("f-4e"); o.stemBefore = texTag();
    GameScan.reset(App.gameDir);
    GameDB.stems.set("f_4e_body_c", stem(2048));                   // the new scan's record: one stem, as before
    four(); Finder.changed();                                      // what the end of the scan draws
    o.stemAfter = texTag();

    // (9) units the list cannot tell apart are one row (review of 2026-10-10: f-4e and f_4e_event drew
    // two identical "F-4E Phantom II · Rank VII · USA · f_4e" rows) — and that row is found by any
    // of their ids, so typing the event copy's id still finds it
    var f4 = U("f-4e", "F-4E Phantom II", "air", "country_usa", 7), ev = U("f_4e_event", "F-4E Phantom II", "air", "country_usa", 7);
    GameUnits.byId = new Map([[f4.id, f4], [ev.id, ev]]);
    GameDB.vehicleRows = [{ unit: f4, units: [f4, ev], model: "f_4e" }];
    GameDB.models = ["f_4e"]; GameDB.stems = new Map(); Finder.changed();
    await type("f_4e_event"); o.mergedById = seq(el);
    await type("f-4e"); o.mergedByMain = seq(el);
    // …and by every one of their in-game names: a merged copy is often known by its full name alone
    // (review of 2026-10-10 — "Lanovski" found Lanovski's P-47M-1-RE as its own row, and nothing
    // once it was merged into Bostwick's)
    var bo = U("p-47m-1-re", "P-47M-1-RE", "air", "country_usa", 5), la = U("p-47m-1-re_boxted", "P-47M-1-RE", "air", "country_usa", 5);
    bo.fullName = "Bostwick's P-47M-1-RE Thunderbolt"; la.fullName = "Lanovski's P-47M-1-RE Thunderbolt";
    GameUnits.byId = new Map([[bo.id, bo], [la.id, la]]);
    GameDB.vehicleRows = [{ unit: bo, units: [bo, la], model: "p_47m_1_re" }];
    GameDB.models = ["p_47m_1_re"]; Finder.changed();
    await type("Lanovski"); o.mergedByFull = seq(el);
    await type("Bostwick"); o.mergedByOwnFull = seq(el);

    // (10) the first screen of every sort, nothing typed, on a roster shaped like the real one: the
    // first nation holds several rank I vehicles and a rankless radar. Rank I first was where the tree
    // itself starts, so on the real install Tree order, Rank and Best match opened on the same rows and
    // the owner read the sort as touching only the skins (2026-10-10).
    setUnits([U("mu", "Mustang", "air", "country_usa", 1), U("no", "Nomad", "air", "country_usa", 1),
              U("co", "Cobra", "air", "country_usa", 2), U("ra", "Radar", "other", "country_usa", undefined),
              U("gu", "Gustav", "tank", "country_germany", 7), U("ab", "Able", "air", "country_ussr", 1)]);
    App.userSkins = []; GameDB.stems = new Map(); Finder.changed();
    await type("");
    o.first = {};
    ["best", "tree", "rank", "name"].forEach(function(s){ sortBy(s); o.first[s] = seq(el); });
    sortBy("best");
  } finally {
    Object.assign(GameDB, keep.db);
    GameUnits.byId = keep.units; GameUnits.nations = keep.nations; GameUnits.maxRank = keep.maxRank;
    App.userSkins = keep.skins; App.userSkinsDir = keep.dir; window.confirm = keep.confirm;
    clearFilters(); renderFilterChips(); Finder.setSort(keep.sort); box.value = ""; box.disabled = keep.disabled;
    $("rowGameSearch").style.display = keep.shown; Finder.changed();
  }
  return o;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAIL: " + r.reason); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }

console.log("\n=== one box searches both lists ===");
R.is(o.both.veh === "#Vehicles · 2|F-4E Phantom II|F-4EJ Phantom II" &&
     o.both.skins === "#In your UserSkins folder|desert",
  `"phantom", typed, narrows the vehicles (${o.both.veh}) and the skins together — the skin for the F-4E (${o.both.skins})`);
R.is(o.both2.veh === "#Vehicles|Leopard 2A6" && o.both2.skins === "#In your UserSkins folder|leo camo",
  `"leopard" finds the Leopard and your Leopard skin at once (${o.both2.veh} / ${o.both2.skins})`);

console.log("\n=== a chip, clicked: both lists follow it at once ===");
R.is(o.chipTyped.veh === "#Outside your filters · 2|F-4E Phantom II|F-4EJ Phantom II" && o.chipTyped.skins === "#Outside your filters|desert",
  `with "phantom" typed, clicking Ground moves the Phantoms AND their skin under "Outside your filters" before another key is pressed (${o.chipTyped.veh} / ${o.chipTyped.skins})`);
R.is(o.out === "#Outside your filters · 2|F-4E Phantom II|F-4EJ Phantom II|#Raw textures|f_4e_body_c",
  `"f-4e" with the Ground chip: the Phantoms under "Outside your filters", exact first, and the raw texture after them (${o.out})`);
R.is(o.chipSwitch.veh === "#Vehicles · 2|F-4E Phantom II|F-4EJ Phantom II|#Raw textures|f_4e_body_c" && o.chipSwitch.skins === "#In your UserSkins folder|desert",
  `clicking Aircraft instead brings them back inside, in both lists (${o.chipSwitch.veh} / ${o.chipSwitch.skins})`);
R.is(o.out2 === "#Outside your filters|T-34", `"t-34" with the Aircraft chip: the T-34 is listed, not "No matches" (${o.out2})`);

console.log("\n=== nothing typed, a chip narrows both lists and nothing is \"outside\" ===");
R.is(o.browse.veh === "#Vehicles · 2|F-4E Phantom II|F-4EJ Phantom II" && o.browse.skins === "#In your UserSkins folder|desert",
  `the Aircraft chip with an empty box lists the aircraft and their skins, and no outside group (${o.browse.veh} / ${o.browse.skins})`);
R.is(o.ground.veh === "#Vehicles · 2|Leopard 2A6|T-34" && o.ground.skins === "#In your UserSkins folder · 2|winter|leo camo",
  `a type chip: Ground lists the tanks and the tanks' skins (${o.ground.veh} / ${o.ground.skins})`);
R.is(o.rank2.veh === "#Vehicles|T-34" && o.rank2.skins === "#In your UserSkins folder|winter",
  `a rank chip: II leaves the T-34 and its skin (${o.rank2.veh} / ${o.rank2.skins})`);
R.is(/^!Nothing in this nation \/ rank \/ class combination/.test(o.nation.veh) && /^!None of your 3 skins is for a vehicle in this nation/.test(o.nation.skins),
  `a nation chip: Germany with Ground and II leaves nothing, and both lists say so (${o.nation.veh.slice(0, 40)}… / ${o.nation.skins.slice(0, 40)}…)`);
R.is(o.unchipped.veh === "#Vehicles · 4|F-4E Phantom II|F-4EJ Phantom II|Leopard 2A6|T-34" && o.unchipped.skins === "#In your UserSkins folder · 3|desert|winter|leo camo",
  `clicking the three lit chips again widens both lists back to everything (${o.unchipped.veh} / ${o.unchipped.skins})`);

console.log("\n=== the sort: one control, both lists, four orders ===");
const S = o.sorts;
R.is(S.best.empty.veh === "#Vehicles · 6|Charlie|Alpha|Bravo|Alpha Delta|Delta|Deltaplan" && S.best.empty.skins === "#In your UserSkins folder · 3|zulu|mike|alpha skin",
  `Best match with nothing typed: vehicles in tree order, skins newest first (${S.best.empty.veh} / ${S.best.empty.skins})`);
R.is(S.best.typed === "#Vehicles · 3|Delta|Deltaplan|Alpha Delta", `Best match typed: the whole name, then its start, then a whole word (${S.best.typed})`);
R.is(S.tree.empty.veh === S.best.empty.veh && S.tree.typed === "#Vehicles · 3|Alpha Delta|Delta|Deltaplan" &&
     S.tree.empty.skins === "#In your UserSkins folder · 3|mike|zulu|alpha skin",
  `Tree order: nation, rank, name — typed too — and a skin by its vehicle's place in the tree (${S.tree.typed} / ${S.tree.empty.skins})`);
R.is(S.name.empty.veh === "#Vehicles · 6|Alpha|Alpha Delta|Bravo|Charlie|Delta|Deltaplan" && S.name.typed === "#Vehicles · 3|Alpha Delta|Delta|Deltaplan" &&
     S.name.empty.skins === "#In your UserSkins folder · 3|alpha skin|mike|zulu",
  `Name: alphabetical, both lists (${S.name.empty.veh} / ${S.name.empty.skins})`);
R.is(S.rank.empty.veh === "#Vehicles · 6|Alpha Delta|Deltaplan|Alpha|Delta|Charlie|Bravo" && S.rank.typed === "#Vehicles · 3|Alpha Delta|Deltaplan|Delta" &&
     S.rank.empty.skins === "#In your UserSkins folder · 3|alpha skin|zulu|mike",
  `Rank: highest first then tree, and a skin by its vehicle's rank, newest first on a tie (${S.rank.empty.veh} / ${S.rank.empty.skins})`);
R.is(["best", "tree", "rank", "name"].every(s => S[s].state === s),
  "the select's own change handler sets the sort, and every order above was read straight after it — so it is the handler that redrew both lists");

console.log("\n=== reset ===");
R.is(o.beforeReset === "#Outside your filters|zulu" && o.reset.q === "" && !o.reset.filtered &&
     o.reset.skins === "#In your UserSkins folder · 3|zulu|mike|alpha skin" && o.reset.veh === "#Vehicles · 6|Charlie|Alpha|Bravo|Alpha Delta|Delta|Deltaplan",
  `reset clears the box and the chips and redraws BOTH lists — the skins list is whole again (${o.reset.skins})`);

console.log("\n=== the sort is a setting: Reset all settings and Import… redraw both lists ===");
R.is(o.beforePrefs.veh === S.name.empty.veh && o.beforePrefs.skins === S.name.empty.skins && o.prefsReset.sort === "best" && o.prefsReset.sel === "best" &&
     o.prefsReset.lists.veh === S.best.empty.veh && o.prefsReset.lists.skins === S.best.empty.skins,
  `sorted by Name, Reset all settings puts the sort back to Best match and both lists into its order at once (${o.prefsReset.lists.skins})`);
R.is(o.beforeImport.veh === S.rank.empty.veh && o.prefsImport.sort === "name" && o.prefsImport.sel === "name" &&
     o.prefsImport.lists.veh === S.name.empty.veh && o.prefsImport.lists.skins === S.name.empty.skins,
  `sorted by Rank, a settings file that says Name sorts both lists by name as it is read (${o.prefsImport.lists.skins})`);

console.log("\n=== a long list crosses from one group to the next in order ===");
R.is(o.chunk1.rows === 200 && o.chunk1.labels.join() === "#Vehicles · 250" && /Show 150 more · 150 left/.test(o.chunk1.more),
  `250 kept + 100 left out: the first chunk is 200 rows under one label, then "${o.chunk1.more}"`);
R.is(o.chunk2.rows === 350 && o.chunk2.labels.join() === "#Vehicles · 250,#Outside your filters · 100" && !o.chunk2.more &&
     o.chunk2.join === "Zeta A249|#Outside your filters · 100|Zeta T000",
  `the next press adds the last 50 kept, the label, and the 100 left out — in order, nothing skipped (${o.chunk2.join})`);

console.log("\n=== a rescan ===");
R.is(o.stemBefore === "1024" && o.stemAfter === "2048",
  `after a rescan that keeps the stem count, the texture row is the new scan's record, not the old one's (${o.stemBefore} → ${o.stemAfter})`);

console.log("\n=== one row for units the list cannot tell apart ===");
R.is(o.mergedById === "#Vehicles|F-4E Phantom II" && o.mergedByMain === "#Vehicles|F-4E Phantom II",
  `the F-4E row that also stands for f_4e_event is found by that id (${o.mergedById}) and by its own (${o.mergedByMain})`);
R.is(o.mergedByFull === "#Vehicles|P-47M-1-RE" && o.mergedByOwnFull === "#Vehicles|P-47M-1-RE",
  `a merged row is found by every unit's full name — "Lanovski" (${o.mergedByFull}) as well as "Bostwick" (${o.mergedByOwnFull})`);

console.log("\n=== every sort opens on its own first rows ===");
const F = o.first || {};
R.is(F.tree === "#Vehicles · 6|Mustang|Nomad|Cobra|Radar|Gustav|Able" && F.best === F.tree,
  `Tree order (and Best match, nothing typed): nation, rank, name, the rankless radar after its nation's ranked vehicles (${F.tree})`);
R.is(F.rank === "#Vehicles · 6|Gustav|Cobra|Mustang|Nomad|Able|Radar",
  `Rank: highest first, the tree's order on a tie, the rankless radar last (${F.rank})`);
R.is(F.name === "#Vehicles · 6|Able|Cobra|Gustav|Mustang|Nomad|Radar", `Name: alphabetical (${F.name})`);
const firstRow = s => (s || "").split("|")[1];
R.is(new Set([firstRow(F.tree), firstRow(F.rank), firstRow(F.name)]).size === 3,
  `Tree order, Rank and Name each open on a different first row (${firstRow(F.tree)} / ${firstRow(F.rank)} / ${firstRow(F.name)})`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
