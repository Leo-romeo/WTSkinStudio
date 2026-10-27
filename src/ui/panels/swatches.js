"use strict";
// ---------- Swatches: recent colours, your own palettes and published paint standards (ROADMAP 4.50 (12)) ----------
// "Skinners work beside photos and colour charts. Today: there are recent colours and nothing else."
// One row under the brush: a library to show and its chips. A chip click is the brush's colour.
//
//   Recent        — the last ten colours painted with, as before (`pushPalette`, ui/keys.js)
//   My palette    — colours you keep: + adds the brush's colour, Alt+click takes a chip out. Data,
//                   not a setting, like the recent row: a reset keeps it and a settings export
//                   carries it (`brush.myPalette` in core/prefs.js)
//   paint standards — RLM, FS 595, ANA, RAL and the Soviet A-/AMT enamels, each from one cited
//                   table (`PAINT_STD`, below). The values are facts about published samples, not
//                   artwork. **Every chip is an sRGB approximation of a paint sample**, and the row
//                   says so whenever one of these is up: real paint differs with gloss, age, the
//                   batch and the light, and the tables themselves disagree by a few levels.
const Swatches = {
  lib: "recent",
  mine: [],
  // The brush takes a colour: what a chip, the reference window's eyedropper and the recent row do.
  use(hex){
    App.brush.color = hex; $("brushColor").value = hex; brushStamp._key = null; BrushPanel.syncCycle();
  },
  libs(){
    return [{ id: "recent", name: "Recent colours" }, { id: "mine", name: "My palette" },
            ...PAINT_STD.map(s => ({ id: s.id, name: s.name }))];
  },
  fill(){
    const sel = $("swLib");
    sel.textContent = "";
    for (const L of Swatches.libs()) { const o = document.createElement("option"); o.value = L.id; o.textContent = L.name; sel.appendChild(o); }
    sel.value = Swatches.lib;
  },
  set(id){
    Swatches.lib = Swatches.libs().some(L => L.id === id) ? id : "recent";
    $("swLib").value = Swatches.lib;
    Swatches.render();
  },
  // [{hex, label}] for the library shown
  chips(){
    if (Swatches.lib === "recent") return (App.palette || []).map(h => ({ hex: h, label: h }));
    if (Swatches.lib === "mine") return Swatches.mine.map(h => ({ hex: h, label: h + " — Alt+click takes it out" }));
    const S = PAINT_STD.find(s => s.id === Swatches.lib);
    return S ? S.colors.map(([code, name, hex]) => ({ hex, label: code + (name ? " " + name : "") + " — " + hex + " (an sRGB approximation of the paint sample)" })) : [];
  },
  render(){
    const el = $("palette"), note = $("swNote");
    el.textContent = "";
    for (const c of Swatches.chips()) {
      const b = document.createElement("div");
      b.className = "swchip";
      b.title = c.label;
      b.style.cssText = "width:18px;height:18px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:" + c.hex;
      b.onclick = e => {
        if (e.altKey && Swatches.lib === "mine") { Swatches.drop(c.hex); return; }
        Swatches.use(c.hex);
        if (Swatches.lib !== "recent") setStatus("Brush colour " + c.label.replace(/ — Alt\+click.*$/, ""), "ok");
      };
      el.appendChild(b);
    }
    if (Swatches.lib === "mine") {
      const add = document.createElement("button");
      add.id = "btnSwAdd"; add.textContent = "+";
      add.title = "Keep the brush's colour in My palette";
      add.style.cssText = "width:20px;height:20px;padding:0;line-height:1";
      add.onclick = () => Swatches.add(App.brush.color);
      el.appendChild(add);
    }
    const S = PAINT_STD.find(s => s.id === Swatches.lib);
    note.style.display = S || (Swatches.lib === "mine" && !Swatches.mine.length) || (Swatches.lib === "recent" && !(App.palette || []).length) ? "" : "none";
    note.textContent = S ? "sRGB approximations of the paint samples (" + S.source + ") — real paint differs with gloss, age and light. Hover a chip for its name."
      : Swatches.lib === "mine" ? "Empty — + keeps the brush's colour here. A settings export carries it to another machine."
      : "The colours you paint with appear here.";
  },
  add(hex){
    if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return;
    hex = hex.toLowerCase();
    if (!Swatches.mine.includes(hex)) Swatches.mine.push(hex);
    Swatches.render();
    savePrefs();
    setStatus(hex + " is in My palette", "ok");
  },
  drop(hex){
    Swatches.mine = Swatches.mine.filter(h => h !== hex);
    Swatches.render();
    savePrefs();
    setStatus(hex + " taken out of My palette", "ok");
  },
  // what the prefs row stores and restores — defensive, since a settings file is any JSON at all
  adopt(v){
    Swatches.mine = Array.isArray(v) ? [...new Set(v.filter(h => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h)).map(h => h.toLowerCase()))].slice(0, 256) : [];
    Swatches.render();
  },
};

// ---- The paint standards ----
// Each set is ONE table, cited, so a value can be checked against where it came from; where tables
// disagree the set's note says how this one was chosen. Each colour is [code, common name, sRGB hex],
// the hex as the table publishes it. A name is left empty where no source this was built from gave
// one with confidence: the number is the paint's identity, the name only a help.
//
// **RLM and the Soviet A-/AMT enamels are not here yet**, and that is deliberate. The item asks for
// both; no table of either could be read from the session that built this (2026-10-23, every colour
// reference site refused), and a set of recalled values would be the opposite of "the values are
// facts". They go in when a cited table does — a set is one entry below.
const PAINT_STD = [
  // FS 595C chips as digitised in thundergnat/Color-Names (Color::Names::FS595C, after federalstandardcolor.com), read from npm chromonym 3.5.3 dist/palettes/fs595c.js on 2026-10-23. That digitisation runs the dark chips light (37038 black reads #424243), so a dark here is at most as dark as the paint.
  { id: "fs595", name: "FS 595 (US Federal Standard)", source: "the FS 595C digitisation in thundergnat/Color-Names", colors: [
    ["FS 34079", "Forest Green", "#595c4e"],
    ["FS 34102", "Medium Green", "#636750"],
    ["FS 30219", "Tan", "#a1836c"],
    ["FS 30118", "Field Drab", "#7b694e"],
    ["FS 33531", "Middlestone", "#d6c1aa"],
    ["FS 34092", "Dark Green", "#53645a"],
    ["FS 34087", "Olive Drab", "#554f44"],
    ["FS 36375", "Light Compass Ghost Gray", "#a6adb4"],
    ["FS 36320", "Dark Compass Ghost Gray", "#98a1a9"],
    ["FS 36118", "Medium Gunship Gray", "#676c73"],
    ["FS 36270", "Medium Gray", "#8f9396"],
    ["FS 36622", "", "#d4d0c7"],
    ["FS 36495", "Light Gray", "#cfd1d2"],
    ["FS 36440", "Light Gull Gray", "#b6b5b0"],
    ["FS 35237", "Gray Blue", "#879297"],
    ["FS 35164", "Intermediate Blue", "#6f7c8a"],
    ["FS 35042", "Sea Blue", "#454a4e"],
    ["FS 17875", "Insignia White", "#f1f0ea"],
    ["FS 37038", "Black", "#424243"],
    ["FS 34151", "Interior Green", "#717048"],
    ["FS 34052", "USMC Green", "#55564f"],
    ["FS 33070", "", "#65604d"],
    ["FS 30400", "", "#c29963"],
    ["FS 33303", "Sand", "#b0a183"],
    ["FS 36176", "Dark Gray", "#778089"],
    ["FS 36081", "", "#5b5e5f"],
    ["FS 35109", "", "#457285"],
    ["FS 30140", "", "#886b58"],
    ["FS 36173", "Neutral Gray", "#7f848a"],
    ["FS 36231", "Dark Gull Gray", "#888b8d"],
    ["FS 34095", "Field Green", "#595f43"],
    ["FS 34258", "", "#909468"],
    ["FS 35450", "Air Superiority Blue", "#92b6d1"],
    ["FS 37875", "Insignia White", "#f2f1ea"],
    ["FS 11136", "Insignia Red", "#a32b25"],
    ["FS 15044", "Insignia Blue", "#263042"],
  ] },
  // Each ANA bulletin 157/166 colour as the FS 595 chip it is paired with in the FS 595 table of npm
  // color-catalogs 0.1.1, valued from the same FS 595C digitisation as the set above — though 11 of
  // the 22 pair with chips that set does not list, and the pairing is the table's, so an ANA name
  // need not match the FS chip of the same name above (ANA 619 Insignia Red is not FS 11136). A modern
  // FS equivalent of the 1940s chip, not the chip itself; ANA 613 Olive Drab has no documented
  // pairing there and is left out.
  { id: "ana", name: "ANA (US, WWII)", source: "FS 595 equivalents of the ANA chips", colors: [
    ["ANA 601", "Insignia White", "#f2f1ea"],
    ["ANA 602", "Light Gray", "#b6b5b0"],
    ["ANA 603", "Sea Gray", "#676c73"],
    ["ANA 604", "Black", "#424243"],
    ["ANA 605", "Insignia Blue", "#444854"],
    ["ANA 606", "Semigloss Sea Blue", "#353f45"],
    ["ANA 607", "Non-specular Sea Blue", "#454a4e"],
    ["ANA 608", "Intermediate Blue", "#6f7c8a"],
    ["ANA 609", "Azure Blue", "#7d91b9"],
    ["ANA 611", "Interior Green", "#717048"],
    ["ANA 612", "Medium Green", "#53645a"],
    ["ANA 614", "Orange Yellow", "#ffb700"],
    ["ANA 615", "Tan", "#b0935c"],
    ["ANA 616", "Desert Sand", "#b79d8a"],
    ["ANA 617", "Dark Earth", "#7b694e"],
    ["ANA 618", "Dull Red", "#905a4c"],
    ["ANA 619", "Insignia Red", "#a84946"],
    ["ANA 623", "Sea Blue (gloss)", "#2d373d"],
    ["ANA 625", "Seaplane Gray", "#585b5b"],
    ["ANA 627", "Field Green", "#636a51"],
    ["ANA 628", "Sierra Tan", "#a1836c"],
    ["ANA 631", "Army Forest Green", "#595c4e"],
  ] },
  // RAL Classic sRGB values from github.com/JohannesVoigt/ral-color-converter, read from npm chromonym 3.5.3 dist/palettes/ral.js on 2026-10-23. RAL's own site was not reachable from the session that built this, and tables of RAL in sRGB disagree on saturated chips by tens of levels. The RAL 840-HR military chips (7028 Dunkelgelb, 6031, 1039, 1040 …) are not RAL Classic and are not here.
  { id: "ral", name: "RAL Classic", source: "RAL Classic in sRGB, after the ral-color-converter table", colors: [
    ["RAL 1001", "Beige", "#d0b084"],
    ["RAL 1002", "Sandgelb", "#d2aa6d"],
    ["RAL 1011", "Braunbeige", "#af8050"],
    ["RAL 1014", "Elfenbein", "#ddc49b"],
    ["RAL 1019", "Graubeige", "#a48f7a"],
    ["RAL 1023", "Verkehrsgelb", "#f7b500"],
    ["RAL 3000", "Feuerrot", "#a72920"],
    ["RAL 6002", "Laubgrün", "#325928"],
    ["RAL 6003", "Olivgrün", "#50533c"],
    ["RAL 6006", "Grauoliv", "#3c392e"],
    ["RAL 6007", "Flaschengrün", "#2c3222"],
    ["RAL 6008", "Braungrün", "#36342a"],
    ["RAL 6014", "Gelboliv", "#474135"],
    ["RAL 6020", "Chromoxidgrün", "#37422f"],
    ["RAL 7008", "Khakigrau", "#745f3d"],
    ["RAL 7013", "Braungrau", "#575044"],
    ["RAL 7016", "Anthrazitgrau", "#383e42"],
    ["RAL 7021", "Schwarzgrau (Wehrmacht ’Dunkelgrau’)", "#2f3234"],
    ["RAL 7024", "Graphitgrau", "#45494e"],
    ["RAL 7030", "Steingrau", "#928e85"],
    ["RAL 7032", "Kieselgrau", "#b5b0a1"],
    ["RAL 7033", "Zementgrau", "#7f8274"],
    ["RAL 7035", "Lichtgrau", "#c5c7c4"],
    ["RAL 7038", "Achatgrau", "#b0b0a9"],
    ["RAL 8000", "Grünbraun", "#89693f"],
    ["RAL 8002", "Signalbraun", "#794d3e"],
    ["RAL 8012", "Rotbraun", "#66332b"],
    ["RAL 8014", "Sepiabraun", "#4a3526"],
    ["RAL 8017", "Schokoladenbraun (Wehrmacht ’Rotbraun’)", "#442f29"],
    ["RAL 8019", "Graubraun", "#3d3635"],
    ["RAL 9005", "Tiefschwarz", "#0e0e10"],
    ["RAL 9010", "Reinweiß", "#f1ede1"],
  ] },
];

Swatches.fill();
$("swLib").onchange = e => Swatches.set(e.target.value);
$("btnRefWin").onclick = () => RefWin.toggle();
Swatches.render();
