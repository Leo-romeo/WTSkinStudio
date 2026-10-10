// Settings: one declared row each, and they survive a round trip (ROADMAP 3.12).
//
// WHY THIS EXISTS. `savePrefs` / `loadPrefs` were two hand-written lists that had to agree — 36-odd
// values, each written out in one function and read back in the other, with the defaults spread over
// a third place (the markup's `value=` and `checked`) and a fourth (a `|| fallback` chain). Nothing
// could put a control back, and nothing could say whether a control was at its default at all.
//
// They are one table now, and the risk that creates is the one this test is for: a row whose `get`
// and `set` disagree loses that setting on the next launch, silently and permanently. So the whole
// table is driven end to end — change every setting away from its default, save, wipe the live
// state, load, and demand every value came back.
//
// It also covers what 3.12 unblocked and 3.11(c) then landed: the two sidebar widths and the vehicle
// list's height. Those were the last pieces of layout the app forgot at every launch — the sidebar
// drag was stored nowhere at all, and the list height had a `wtss.gameListH` key of its own, which
// is precisely the fourth place to write a default that the table exists to remove. Since ROADMAP 3.6
// the list has no height of its own — it fills the Vehicle tab and shares it with the skins list — so
// that row is the SHARE between the two lists now, a ratio like the 3D / 2D split, and an old height
// in either of its old homes is dropped rather than carried.
//
// The other thing asserted is that **`def` is captured from the page, not written down**. That is
// what makes reset trustworthy: the default is by construction whatever the build ships, so the
// markup and the reset cannot drift apart the way the four copies did.
//
// Usage: node tools/t55_prefs.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var out = {};
  var J = function(v){ return JSON.stringify(v); };
  out.rows = PREFS.length;
  out.settings = prefRows().length;
  out.sections = Object.keys(PREF_SECTIONS);
  // every row must declare a section that exists, and captured a default
  out.badSec = PREFS.filter(function(r){ return !PREF_SECTIONS[r.sec]; }).map(function(r){ return r.id; });
  out.noDef = PREFS.filter(function(r){ return r.def === undefined; }).map(function(r){ return r.id; });
  out.dupes = (function(){
    var seen = {}, d = [];
    PREFS.forEach(function(r){ if (seen[r.id]) d.push(r.id); seen[r.id] = 1; });
    return d;
  })();
  out.defaults = {};
  PREFS.forEach(function(r){ out.defaults[r.id] = r.def; });

  // ---- change everything away from its default ----
  // Deliberately mechanical: derive a different value from the current one by TYPE, so a row added
  // later is exercised without this test being told about it.
  var other = function(v){
    if (typeof v === "boolean") return !v;
    if (typeof v === "number") return v === 0 ? 7 : Math.round(v / 2 * 1000) / 1000;
    if (Array.isArray(v)) return v.concat(["#123456"]);
    // A plain object row (brush.tools) — add a key rather than replace the value, so a row that
    // MERGES rather than assigns is still seen to have moved.
    if (v && typeof v === "object") { var c = Object.assign({}, v); c.t55tool = { size: 7, value: 9 }; return c; }
    if (typeof v === "string") {
      if (/^#[0-9a-f]{6}$/i.test(v)) return v === "#123456" ? "#654321" : "#123456";
      var el = null;                                    // a select can only take one of its options
      // Curated rather than a document-wide scan: two selects can hold the same value ("auto" is
      // both an axis and a view mode), and picking the wrong one would set a row to an option its
      // own control does not have, which passes quietly and tests nothing.
      // brushTip (ROADMAP 4.50 (10)) holds the tips; an id that names no tip is refused to Round.
      // gameSort (ROADMAP 3.5) is the one search control's sort, over both lists.
      ["optBg", "expPreset", "expAlpha", "expMode", "expCamoBase", "symAxis", "gameQuality", "gameSort",
       "expAlbFmt", "expNrmFmt", "symPlaneVis", "optUndoBudget", "brushTip"].forEach(function(id){
        var e = document.getElementById(id);
        if (e && e.value === v && !el) el = e;
      });
      if (el) { for (var i = 0; i < el.options.length; i++) if (el.options[i].value !== v) return el.options[i].value; }
      // Same reasoning one control further out. The brush.mode row used to take any string at all;
      // since ROADMAP 4.28(d) it is a VIEW over App.brush tool / chan / target, so an unknown name is
      // refused exactly the way a select refuses an option it does not have — and appending "_x"
      // would report the row as one that cannot be changed. Its control is the tool button strip.
      var bm = document.querySelectorAll("[data-bm]");
      for (var b = 0; b < bm.length; b++) if (bm[b].dataset.bm === v)
        for (var b2 = 0; b2 < bm.length; b2++) if (bm[b2].dataset.bm !== v) return bm[b2].dataset.bm;
      return v + "_x";
    }
    return v;
  };
  var wanted = {};
  prefRows().forEach(function(r){
    var v = other(r.def);
    try { r.set(v); wanted[r.id] = r.get(); } catch (e) { wanted[r.id] = "THREW: " + e.message; }
  });
  out.moved = prefRows().filter(function(r){ return J(r.get()) !== J(r.def); }).length;
  out.stuck = prefRows().filter(function(r){ return J(r.get()) === J(r.def); }).map(function(r){ return r.id; });
  out.changedCount = prefsChanged();

  // ---- save, wipe, load ----
  savePrefs();
  var raw = localStorage.getItem("wtss_prefs");
  out.stored = raw ? JSON.parse(raw) : null;
  // Put everything back to the defaults, so a load that does nothing at all would be visible. Note
  // resetPrefs PERSISTS — a reset the next launch forgets would be a bug — so the blob has to be
  // put back before loading, or this would be testing that defaults round-trip to defaults.
  resetPrefs();
  out.afterReset = prefsChanged();
  out.resetBackToDef = prefRows().filter(function(r){ return J(r.get()) !== J(r.def); }).map(function(r){ return r.id; });
  out.resetPersisted = localStorage.getItem("wtss_prefs") !== raw;
  localStorage.setItem("wtss_prefs", raw);
  loadPrefs();
  out.lost = prefRows().filter(function(r){ return J(r.get()) !== J(wanted[r.id]); })
    .map(function(r){ return r.id + ": wanted " + J(wanted[r.id]) + " got " + J(r.get()); });

  // ---- the stored shape has not moved ----
  // Existing installs already hold "brush:{…}", "sym:{…}", "light:{…}"; flattening them would
  // silently reset everybody on the next launch.
  var st = out.stored || {};
  out.shape = { v: st.v, brush: typeof st.brush, sym: typeof st.sym, light: typeof st.light,
    brushKeys: st.brush ? Object.keys(st.brush).sort().join(",") : null };

  // ---- the version gate still refuses the two unsafe pre-v2 values ----
  resetPrefs();
  var safeAlpha = $("expAlpha").value, safeCamo = $("expCamoBase").value;
  applyPrefs({ v: 1, expAlpha: other(safeAlpha), camoBase: other(safeCamo), exp: 137 });
  out.gate = { alpha: $("expAlpha").value === safeAlpha, camo: $("expCamoBase").value === safeCamo,
    othersStillApplied: +$("optLight").value === 137 };

  // ---- import refuses a file from a newer build rather than half-applying it ----
  resetPrefs();
  out.beforeImport = +$("optLight").value;

  // ---- per-section reset touches only its section, and never the user's own data ----
  resetPrefs();
  App.palette = ["#aabbcc"]; App.decalFolder = "roundels";
  prefRows("brush").forEach(function(r){ r.set(other(r.def)); });
  prefRows("view").forEach(function(r){ r.set(other(r.def)); });
  var n = resetPrefs("brush");
  out.section = { returned: n, brushBack: prefsChanged("brush"), viewStillChanged: prefsChanged("view"),
    paletteKept: J(App.palette) === J(["#aabbcc"]), folderKept: App.decalFolder === "roundels" };

  // ---- 3.11(c): the layout the user drags, and the key it replaced ----
  resetPrefs();
  var lrows = PREFS.filter(function(r){ return r.sec === "layout"; });
  out.layout = { rows: lrows.map(function(r){ return r.id; }), defs: {} };
  lrows.forEach(function(r){ out.layout.defs[r.id] = r.def; });
  Layout.setWidth("left", 340); Layout.setWidth("right", 300); Layout.setListSplit(.7);
  out.layout.set = { l: Layout.width("left"), r: Layout.width("right"), s: Layout.listSplit() };
  // The trap this is really here for: "Hide sidebars" sets display:none, and a hidden element
  // measures 0 px. Reading the width off the DOM when the save timer asks would have stored a
  // sidebar 0 px wide, with the resizer that fixes it 0 px away.
  $("leftbar").style.display = "none";
  out.layout.whileHidden = Layout.width("left");
  savePrefs();
  out.layout.storedWhileHidden = JSON.parse(localStorage.getItem("wtss_prefs")).ui;
  $("leftbar").style.display = "";
  resetPrefs("layout");
  out.layout.reset = { l: Layout.width("left"), r: Layout.width("right"), s: Layout.listSplit(),
    lStyle: $("leftbar").style.width,
    grow: $("gameListWrap").style.getPropertyValue("--grow") + "/" + $("userSkinWrap").style.getPropertyValue("--grow") };
  // a double-click on a resizer IS the per-control reset, and reads the same captured default
  Layout.setWidth("left", 555);
  Layout.reset("left");
  out.layout.dblclick = Layout.width("left");
  // The 3D | 2D divider. It is a RATIO and not a width, and these are the two things that buys:
  // one pane hidden does not destroy it (a width read off a display:none pane would be 0, the trap
  // above), and it still means the same split after a sidebar drag has changed the row it divides.
  Layout.setSplit(.3);
  out.layout.viewSplit = { r: Layout.split(),
    px3: $("view3dwrap").getBoundingClientRect().width,
    px2: $("view2dwrap").getBoundingClientRect().width };
  $("view2dwrap").style.display = "none";
  out.layout.splitOnePane = Layout.split();
  $("view2dwrap").style.display = "";
  Layout.setSplit(0); Layout.setSplit(.01);        // 0 refused outright, .01 clamped off the edge
  out.layout.splitClamped = Layout.split();
  Layout.resetSplit();
  out.layout.splitReset = Layout.split();
  // A pane showing a hint rather than a list drops out of the share. It is what 3.11(c) learned for
  // a fixed box — an inline height beat .empty{height:auto} and sat round the one-line welcome hint on
  // every launch — kept for a flexing one: the share is written as --grow, which only the flexing
  // rule reads, so .empty's flex:0 0 auto still wins. The vehicle list is the welcome hint here, and
  // the skins list has no folder, so the vehicle pane is the only candidate for the tab's height.
  Layout.setListSplit(.8);
  var gw = $("gameListWrap"), wasEmpty = gw.classList.contains("empty");
  gw.classList.add("empty");
  // Asked of the computed flex-grow, not of a height: this test's window is small enough that a list
  // pane can sit at its 64 px floor, below the hint's own height, and still be in the share.
  out.layout.asHint = { h: Math.round(gw.getBoundingClientRect().height), grow: gw.style.getPropertyValue("--grow"),
    flex: getComputedStyle(gw).flexGrow };
  gw.classList.remove("empty");
  out.layout.asList = getComputedStyle(gw).flexGrow;
  gw.classList.toggle("empty", wasEmpty);
  resetPrefs("layout");
  // An old list HEIGHT, in either of its two old homes, is dropped rather than carried: a pixel
  // height is not a share of a column that changes with the window (ROADMAP 3.6).
  localStorage.setItem("wtss.gameListH", "377");
  var blob = prefsBlob();
  blob.ui.gameListH = 377;
  localStorage.setItem("wtss_prefs", JSON.stringify(blob));
  loadPrefs();
  savePrefs();
  out.layout.dropped = { s: Layout.listSplit(), oldKey: localStorage.getItem("wtss.gameListH"),
    inBlob: JSON.parse(localStorage.getItem("wtss_prefs")).ui.gameListH };

  // ---- 3.19: no reset fires without asking, and "Reset layout" is only the layout ----
  // window.confirm is stubbed rather than driven: what is being tested is that the handler ASKS and
  // obeys the answer, and a real dialog in headless Chrome blocks the page instead of answering.
  resetPrefs();
  var asked = [], answer = false;
  var confirmWas = window.confirm;
  window.confirm = function(msg){ asked.push(msg); return answer; };
  var sayNo = function(sec, ids){
    ids.forEach(function(id){ var r = PREFS.filter(function(x){ return x.id === id; })[0]; r.set(other(r.def)); });
    asked = []; answer = false;
    document.querySelector(sec ? "button.prefreset[data-sec=" + sec + "]" : "#btnPrefsReset").click();
    return { asked: asked.length, changed: prefsChanged(sec) };
  };
  out.confirmed = {};
  out.confirmed.brushRefused = sayNo("brush", ["brush.size"]);
  answer = true;
  document.querySelector("button.prefreset[data-sec=brush]").click();
  out.confirmed.brushAccepted = prefsChanged("brush");
  // at the defaults already: it must not ask at all, and must say so
  asked = [];
  $("status").textContent = "";
  document.querySelector("button.prefreset[data-sec=brush]").click();
  out.confirmed.noopAsked = asked.length;
  out.confirmed.noopSaid = $("status").textContent;
  // the layout reset touches the layout and nothing else
  Layout.setWidth("left", 410); Layout.setListSplit(.3);
  prefRows("view").forEach(function(r){ r.set(other(r.def)); });
  asked = []; answer = true;
  $("btnPrefsResetUI").click();
  out.confirmed.layout = { asked: asked.length, msg: asked[0] || "",
    l: Layout.width("left"), s: Layout.listSplit(),
    viewStillChanged: prefsChanged("view"), layoutBack: prefsChanged("layout") };
  // and "Reset all settings" still asks, and still means all of it
  asked = []; answer = true;
  $("btnPrefsReset").click();
  out.confirmed.all = { asked: asked.length, msg: asked[0] || "", left: prefsChanged() };
  window.confirm = confirmWas;
  // The Settings section lives in a window under the top bar since 3.29; a hidden window
  // measures 0 px, so open it for the measurement and shut it after.
  TopWin.show("winSettings");
  out.buttons = ["btnPrefsResetUI", "btnPrefsReset"].map(function(id){
    var e = $(id), r = e.getBoundingClientRect(), row = e.closest(".row").getBoundingClientRect();
    return { id: id, w: Math.round(r.width), rowW: Math.round(row.width), text: e.textContent };
  });
  TopWin.close();
  resetPrefs();
  // ---- 3.22: one set of settings per tool, and nothing reset on the way in ----
  // Reported as "brushes settings as size opacity etc should be per brush settings and remembered.
  // Panel line depth always resets to 40". Two separate faults: applyBrushMode applied a defaults
  // table on EVERY selection of a tool rather than the first, and App.brush is one object that
  // every tool wrote to. Everything below runs from the defaults, because resetPrefs just ran.
  var slide = function(id, v){ var e = $(id); e.value = v; e.oninput({ target: e }); };
  App.brushTools = {};
  applyBrushMode("color");
  slide("brushSize", 80);
  var colourSize = App.brush.size;
  applyBrushMode("height");
  out.tools = { seedDepth: App.brush.value, colourSize: colourSize };
  slide("brushValue", 12);
  slide("brushSize", 6);
  applyBrushMode("smooth");
  out.tools.smoothSeed = App.brush.value;
  applyBrushMode("height");
  out.tools.depthKept = App.brush.value;
  out.tools.sizeKept = App.brush.size;
  out.tools.sliderAgrees = +$("brushValue").value === App.brush.value && $("brushValueVal").textContent === String(App.brush.value);
  applyBrushMode("color");
  out.tools.colourSizeKept = App.brush.size;
  // ...and a tool's settings survive a session, through 3.12's own table rather than a key of
  // its own. Left on Panel line on purpose: the tool in hand is the one that used to come back
  // wrong, because its live values were restored onto whatever mode the page happened to open in.
  applyBrushMode("height");
  savePrefs();
  var blob = localStorage.getItem("wtss_prefs");
  out.tools.storedKeys = Object.keys(JSON.parse(blob).brush || {}).sort().join(",");
  // Reset puts the tool in hand back to the one the build opens on, so the honest question is
  // whether the SEED comes back for a tool picked up afterwards — not what the value happens to be
  // for whatever tool reset left you holding.
  resetPrefs();
  out.tools.afterReset = { mode: App.brush.mode, rows: Object.keys(App.brushTools || {}).join(",") };
  applyBrushMode("height");
  out.tools.afterReset.depth = App.brush.value;
  out.tools.afterReset.size = App.brush.size;
  localStorage.setItem("wtss_prefs", blob);
  App.brushTools = {};
  loadPrefs();
  out.tools.back = { mode: App.brush.mode, depth: App.brush.value, size: App.brush.size };
  applyBrushMode("color");
  out.tools.backColourSize = App.brush.size;
  resetPrefs();
  App.brushTools = {};

  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 500), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== the table ===");
console.log(`   ${o.rows} rows, ${o.settings} of them settings, in ${o.sections.length} sections (${o.sections.join(", ")})`);
R.is(o.dupes.length === 0, o.dupes.length ? `two rows share an id: ${o.dupes.join(", ")}` : "every row has its own id");
R.is(o.badSec.length === 0, o.badSec.length ? `rows in an unknown section: ${o.badSec.join(", ")}` : "every row is in a declared section");
R.is(o.noDef.length === 0,
  o.noDef.length ? `rows whose default could not be read off the page: ${o.noDef.join(", ")}` : "every row captured a default from the live page");
R.is(o.settings >= 30, `the table really covers the settings, not a sample (${o.settings})`);

console.log("\n=== every setting survives save → wipe → load ===");
console.log(`   moved ${o.moved} of ${o.settings} away from their defaults; prefsChanged() said ${o.changedCount}`);
R.is(o.stuck.length === 0, o.stuck.length ? `rows that would not take a new value: ${o.stuck.join(", ")}` : "every setting could be changed");
R.is(o.changedCount === o.moved, `prefsChanged() agrees with what actually moved (${o.changedCount} vs ${o.moved})`);
R.is(o.resetPersisted, "a reset is written to storage — one the next launch forgets would be no reset at all");
R.is(o.afterReset === 0, `resetting puts every one back (${o.afterReset} still differ)`);
R.is(o.resetBackToDef.length === 0,
  o.resetBackToDef.length ? `reset missed: ${o.resetBackToDef.join(", ")}` : "and reset means the captured default exactly");
if (o.lost.length) for (const l of o.lost) console.log("   LOST " + l);
R.is(o.lost.length === 0,
  o.lost.length ? `${o.lost.length} setting(s) did not survive the round trip` : "all of them came back from storage unchanged");

console.log("\n=== every tool keeps its own settings, and picking one up does not reset it (3.22) ===");
const T = o.tools;
console.log(`   Panel line starts at ${T.seedDepth}, was set to 12, and comes back at ${T.depthKept} · its size ${T.sizeKept} against the colour brush's ${T.colourSizeKept}`);
R.is(T.seedDepth === 40 && T.smoothSeed === 160,
  `a tool the user has not touched starts at its seed (Panel line ${T.seedDepth}, Smoothness ${T.smoothSeed}) — the table is a starting point again instead of the reset it had become`);
R.is(T.depthKept === 12,
  `and picking Panel line up a SECOND time leaves the depth where it was left (${T.depthKept}) — this is the reported bug, and it was one line: applyBrushMode ran the defaults table on every selection`);
R.is(T.sliderAgrees, "with the slider and its readout saying the same thing as the state, not the seed");
R.is(T.sizeKept === 6 && T.colourSizeKept === 80 && T.colourSize === 80,
  `size is per tool too (${T.sizeKept} for the panel line, ${T.colourSizeKept} for the colour brush) — one App.brush meant a 6-texel panel line and an 80-texel colour brush could not both exist`);
R.is(/(^|,)tools(,|$)/.test(T.storedKeys) && /(^|,)mode(,|$)/.test(T.storedKeys),
  `it is remembered through 3.12's table rather than a storage key of its own (brush holds ${T.storedKeys})`);
R.is(T.afterReset.depth === 40 && T.afterReset.size === 48 && T.afterReset.mode !== "height",
  `Reset forgets what every tool was set to: it leaves you on the tool the build opens with (${T.afterReset.mode}), and Panel line picked up after it is back at its seed (depth ${T.afterReset.depth}, size ${T.afterReset.size}). The one row left behind is the tool in hand, which savePrefs writes on the way out — ${T.afterReset.rows || "none"}`);
R.is(T.back.mode === "height" && T.back.depth === 12 && T.back.size === 6,
  `a session comes back on the tool it ended on, set the way it was left (${T.back.mode}, depth ${T.back.depth}, size ${T.back.size}) — restoring the live values without the mode is what would put a 6-texel panel line onto the colour brush`);
R.is(T.backColourSize === 80,
  `and the tools that were NOT in hand come back too (colour brush ${T.backColourSize})`);

console.log("\n=== the stored file is the shape existing installs already hold ===");
console.log(`   v${o.shape.v}  brush=${o.shape.brush} (${o.shape.brushKeys})  sym=${o.shape.sym}  light=${o.shape.light}`);
R.is(o.shape.v === 2, `the version is still 2 — this refactor is not a migration (${o.shape.v})`);
R.is(o.shape.brush === "object" && o.shape.sym === "object" && o.shape.light === "object",
  "brush / sym / light are still nested objects, so an existing prefs blob still loads");

console.log("\n=== the pre-v2 gate still refuses the two unsafe values ===");
R.is(o.gate.alpha, "a v1 file cannot restore expAlpha — it is what shipped alpha 255 and lost the coverage mask");
R.is(o.gate.camo, "nor camoBase — it is what repainted every texel the skin does not fully cover");
R.is(o.gate.othersStillApplied, "while everything else in that file is still honoured");

console.log("\n=== a section reset is a section reset ===");
R.is(o.section.brushBack === 0, `the brush section went back to its defaults (${o.section.brushBack} still differ)`);
R.is(o.section.viewStillChanged > 0, `and View was left exactly as it was (${o.section.viewStillChanged} still differ)`);
R.is(o.section.paletteKept && o.section.folderKept,
  "the palette and the last decal folder survive — they are the user's work, not the app's settings");

console.log("\n=== 3.11(c) the layout the user drags is remembered here, not in a key of its own ===");
console.log(`   ${o.layout.rows.join(", ")}  defaults ${o.layout.rows.map(r => o.layout.defs[r]).join(" / ")}`);
R.is(o.layout.rows.length === 4, `the sidebar widths, the share between the two lists and the 3D/2D split are rows in the table — where View & scene lives is not while floating is parked (3.37) (${o.layout.rows.length})`);
R.is(o.layout.defs["ui.leftW"] === 230 && o.layout.defs["ui.rightW"] === 250 && o.layout.defs["ui.listSplit"] === .6
  && o.layout.defs["ui.viewSplit"] === .5,
  "and their defaults are the stylesheet's, captured off the page — not 0, which is what a mis-read would give");
R.is(o.layout.set.l === 340 && o.layout.set.r === 300 && o.layout.set.s === .7, "a drag is read back as the width, or the share, it set");
R.is(o.layout.whileHidden === 340 && o.layout.storedWhileHidden.leftW === 340,
  `a HIDDEN sidebar still reports its real width (${o.layout.whileHidden}) — display:none measures 0 px, and 0 is what would have been stored`);
R.is(o.layout.reset.l === 230 && o.layout.reset.r === 250 && o.layout.reset.s === .6,
  "reset puts all three back to the build's defaults");
R.is(o.layout.reset.lStyle === "230px" && o.layout.reset.grow === "6/4",
  `and puts it back on the elements, not only in the table (${o.layout.reset.lStyle} / --grow ${o.layout.reset.grow})`);
R.is(o.layout.dblclick === 230, `double-clicking a resizer is the same captured default (${o.layout.dblclick}), not a number written twice`);

const vs = o.layout.viewSplit, seen = vs.px3 / (vs.px3 + vs.px2);
console.log(`   3D/2D split set to .3 → read back ${vs.r}, panes ${Math.round(vs.px3)} / ${Math.round(vs.px2)} px (${seen.toFixed(3)})`);
R.is(vs.r === .3, `the divider stores the ratio it was dragged to (${vs.r})`);
R.is(Math.abs(seen - .3) < .02, `and the panes are really that wide — the grow factors divide the free space (${seen.toFixed(3)})`);
R.is(o.layout.splitOnePane === .3,
  `a hidden pane still reports the split (${o.layout.splitOnePane}) — 3D-only mode must not flatten it the way display:none flattens a width`);
R.is(o.layout.splitClamped === .12, `a corrupt value is refused and an off-the-edge one clamped, so neither pane drags to nothing (${o.layout.splitClamped})`);
R.is(o.layout.splitReset === .5, `double-clicking it is the stylesheet's even split (${o.layout.splitReset})`);
R.is(o.layout.asHint.h < 100 && o.layout.asHint.flex === "0" && o.layout.asHint.grow === "8",
  `a pane showing a hint drops out of the share instead of stretching round it (${o.layout.asHint.h} px, flex-grow ${o.layout.asHint.flex} with --grow ${o.layout.asHint.grow} still set)`);
R.is(o.layout.asList === "8", `and takes its share straight back when it is a list again (flex-grow ${o.layout.asList})`);
R.is(o.layout.dropped.s === .6 && o.layout.dropped.inBlob === undefined,
  `an old list height is dropped, not carried — the share is the stylesheet's (${o.layout.dropped.s}) and the next save leaves gameListH out`);
R.is(o.layout.dropped.oldKey === null, "and the old wtss.gameListH key is removed, so it cannot fight the table later");

console.log("\n=== 3.19 a reset asks before it throws settings away ===");
console.log(`   section: ${o.confirmed.layout.msg.split("\n")[0]}`);
R.is(o.confirmed.brushRefused.asked === 1, `a section Reset asks (${o.confirmed.brushRefused.asked} dialog) — three of the four used to fire on the first click`);
R.is(o.confirmed.brushRefused.changed === 1, "and answering no leaves the section exactly as it was");
R.is(o.confirmed.brushAccepted === 0, "answering yes resets it");
R.is(o.confirmed.noopAsked === 0, `at the defaults already it does not ask at all (${o.confirmed.noopAsked} dialogs)`);
R.is(/already at this build's defaults/.test(o.confirmed.noopSaid), `it says so instead — "${o.confirmed.noopSaid}"`);
R.is(o.confirmed.layout.asked === 1 && /Layout/.test(o.confirmed.layout.msg), "Reset layout asks too, and names Layout");
R.is(o.confirmed.layout.l === 230 && o.confirmed.layout.s === .6 && o.confirmed.layout.layoutBack === 0,
  `and puts the panels back (${o.confirmed.layout.l} px sidebar, the lists at ${o.confirmed.layout.s})`);
R.is(o.confirmed.layout.viewStillChanged > 0,
  `while View is left exactly as it was (${o.confirmed.layout.viewStillChanged} still differ) — that is the whole point of a second button`);
R.is(o.confirmed.all.asked === 1 && o.confirmed.all.left === 0, "Reset all settings asks once and then means all of it");
console.log(`   ${o.buttons.map(b => `${b.text} ${b.w}px`).join("   ")}  (row ${o.buttons[0].rowW}px)`);
R.is(o.buttons.every(b => b.w < b.rowW * 0.7),
  "neither reset is the widest thing in the panel any more — Reset all settings was flex:1, full width");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
