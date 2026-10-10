// The sidebar panels render the same markup they always did (ROADMAP 2.4).
//
// WHY THIS EXISTS. 2.4 splits the app's oversized functions, and the worst of them are panel
// builders: `refreshPartList` alone was 297 lines. Splitting one is a pure refactor — the claim is
// that nothing changes — and until now *nothing in the suite touched these panels' DOM at all*.
// `t31_boot.mjs` checks the panel elements exist; it has never checked what is in them. So a
// refactor could quietly drop a button, a title, a colour or a whole branch and every test would
// still pass.
//
// HOW. Each case builds a synthetic model / project state in the real page, calls the real refresh
// function, and takes the panel's `innerHTML`. That string is hashed and compared against
// `fixtures/panels.golden.json`. The synthetic state is deliberately awkward — parts selected AND
// protected AND hidden, a node split across two materials, an unbound material, a node pair that
// only differs by side, an unposed mesh, an effect mesh — because the branches a refactor is most
// likely to lose are the ones an ordinary vehicle does not take.
//
// A golden rather than an A/B against HEAD: an A/B stops meaning anything the moment the refactor
// is committed, because then HEAD *is* the refactored version. The encoders are gated the same way
// (`fixtures/encode.golden.json`).
//
// WHERE THE FIRST FIXTURE CAME FROM, since a golden is only worth what generated it. The two parts
// cases were captured with these exact page bodies run against BOTH builds — the committed
// 297-line `refreshPartList` and the split one — and the markup came back **byte-identical**
// (23 445 and 14 300 characters). So the fixture is the pre-split behaviour, recorded after the
// split rather than before it. A later case added by `--update` has no such backing unless whoever
// adds it does the same thing; say so in the commit if you do.
//
// WHEN THE MARKUP IS *MEANT* TO CHANGE: run with `--update`, then read the diff in the fixture
// before committing it. That diff is the review — it is the only place the change is visible.
// `--dump <id>` prints one case's markup, which is how you find out WHAT moved once the hash says
// something did — and how a new case is checked to be capturing the branches it claims to, before
// its hash is frozen into the fixture.
//
// Usage: node tools/t44_panels.mjs [--update] [--dump <id>] [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = path.join(ROOT, "tools", "fixtures", "panels.golden.json");
const argv = process.argv.slice(2);
const UPDATE = argv.includes("--update");
const DUMP = argv.includes("--dump") ? argv[argv.indexOf("--dump") + 1] : null;
const browser = findBrowser(argv[argv.indexOf("--chrome") + 1]);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

// A synthetic aircraft with every awkward case in it. Shared by the parts cases; declared as page
// source rather than built here because it has to run inside the page, against the real App.
const MODEL = `
  const mesh = (mat, extra) => ({ visible: true, userData: Object.assign({ mat }, extra || {}) });
  App.meshes = new Map();
  const add = (n, mat, extra) => App.meshes.set(n, mesh(mat, extra));
  add("@root (fuselage)", "m::fuselage_c");
  add("wing_l", "m::wing_c");            add("wing_r", "m::wing_c");
  add("aileron_l", "m::wing_c");         add("aileron_r", "m::wing_c");
  add("flap1_l", "m::wing_c");           add("flap1_r", "m::wing_c");
  add("gear_l (a)", "m::gear_c");        add("gear_l (b)", "m::detail_c");   // one node, two materials
  add("gear_r", "m::gear_c");
  add("wheel_l_01", "m::gear_c");        add("wheel_r_01", "m::gear_c");
  add("nozzle2_01", "m::engine_c");      add("nozzle2_02", "m::engine_c");
  add("canopy", "m::glass_c");
  add("net", "m::cloth_c", { unposed: true });                               // bone-driven cloth
  add("flame", "m::jet_flame", { effect: true });                            // no slot picker
  add("unbound_thing", "m::nowhere_c");                                      // gets the "bind..." row
  App.slots = new Map([["fuselage_c", { id: "fuselage_c", size: 2048, missing: false }],
                       ["wing_c", { id: "wing_c", size: 1024, missing: false }]]);
  App.matSlot = new Map([["m::fuselage_c", "fuselage_c"], ["m::wing_c", "wing_c"]]);
  App.manualBind = new Set();
  App.geomData = [...App.meshes.keys()].map(n => ({ name: n }));
  App.partGroups = null; App.partAssign = null; App.partGroupsKind = null;
  App.groupCollapsed = new Set(); App.groupOpen = new Set();
  App.soloKey = null; App.pendingParts = null;
  App.selParts = new Set(); App.protectedParts = new Set();
`;

// A slot with both sheets, and constructors for the three node kinds. Page source rather than test
// source, like MODEL above: it runs inside the page, against the real App and the real tree.
// `panel()` takes the whole Layers `.section` — header buttons, channel selector, list and props —
// because that is the unit ROADMAP 4.28(e) replaces.
const LSLOT = `
  const N = 32;
  const cv = hex => { const c = mkCanvas(N, N); const g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  // Through LayerNode.of, since 4.28(e). A bare record is no longer a state the app can be in:
  // addLayerTo adopts every layer that reaches a stack (4.28(c)), and a fixture built out of one
  // was measuring the panel drawing a layer that carries no channel at all — which since (e) is a
  // different panel from the one any user ever sees.
  const paint = (name, o) => LayerNode.of(Object.assign({ type: "paint", name, canvas: cv("#00000000"), opacity: 1, blend: "normal", visible: true }, o || {}));
  const fillL = (name, o) => LayerNode.of(Object.assign({ type: "fill", name, color: "#3a5f2a", opacity: 1, blend: "normal", visible: true }, o || {}));
  const grp = (name, kids, o) => Object.assign({ type: "group", name, children: kids, visible: true, opacity: 1,
                                                blend: "normal", mask: null, parts: null, collapsed: false }, o || {});
  const s = { id: "t44l_c", cStem: "t44l_c", nStem: "t44l_n", size: N, nSize: N, missing: false, layers: [] };
  s.baseC = cv("#202020"); s.composite = mkCanvas(N, N);
  s.smooth = cv("#101010"); s.metal = cv("#000000"); s.normal = cv("#808080");
  App.slots = new Map([["t44l_c", s]]);
  App.activeSlot = s;
  App.chanAuto = false;          // or the 3-D view follows the layer and the case depends on a pref
  const panel = () => document.getElementById("layerList").closest(".section").innerHTML;
`;
// Every brush case starts from the build's own slider defaults, so what the `.val` spans say is the
// per-tool memory (3.22) and not what the previous case left behind. `BrushTools.fresh` reads
// `defaultValue`, the attribute, so a tool the panel switches to lands on the same numbers every
// run — which is the property 4.28(d) has to keep.
const BRUSHRESET = `
  App.brushTools = {};
  App.paint3d = false;
  // A hidden hint keeps its last text, so without this the hash carries the PREVIOUS case's
  // sentence and moves when the cases are reordered — a fixture that fails for a reason that is
  // not a regression is a fixture that gets deleted.
  $("brushHint").textContent = "";
  App.brush.size = 48; App.brush.opacity = 1; App.brush.hardness = .7; App.brush.value = 128; App.brush.spacing = .35;
  // ROADMAP 4.50 (4) + 6.4's rows, the same way: Flow, Build up, what pressure drives, the string.
  Object.assign(App.brush, { flow: 1, build: false, pSize: true, pFlow: false, lazy: 0, curve: 1 });
  for (const [id, v] of [["brushSize", 48], ["brushOpacity", 100], ["brushHardness", 70], ["brushValue", 128], ["brushSpacing", 35],
                         ["brushFlow", 100], ["brushLazy", 0]]) {
    const el = document.getElementById(id); if (el) el.value = v;
    const lab = document.getElementById(id + "Val"); if (lab) lab.textContent = id === "brushLazy" ? "off" : String(v);
  }
  for (const [id, v] of [["brushBuild", false], ["penSize", true], ["penFlow", false]]) { const el = document.getElementById(id); if (el) el.checked = v; }
  if (document.getElementById("penCurve")) document.getElementById("penCurve").value = "1";
  // Hidden for Panel line and shown for everything else, and a row that has been hidden once keeps an
  // empty style attribute when shown again — so each case starts from the markup, not from the order
  // the cases happen to run in.
  for (const id of ["rowFlow", "rowBuild"]) { const el = document.getElementById(id); if (el) el.removeAttribute("style"); }
  const brushPanel = () => document.getElementById("brushModes").closest(".section").innerHTML;
`;
const BSLOT = `
  const N = 32;
  const cv = hex => { const c = mkCanvas(N, N); const g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  const paint = (name, o) => LayerNode.of(Object.assign({ type: "paint", name, canvas: cv("#00000000"), opacity: 1, blend: "normal", visible: true }, o || {}));
  const s = { id: "t44br_c", cStem: "t44br_c", nStem: "t44br_n", size: N, nSize: N, missing: false, layers: [] };
  s.baseC = cv("#202020"); s.composite = mkCanvas(N, N);
  s.smooth = cv("#101010"); s.metal = cv("#000000"); s.normal = cv("#808080");
  App.slots = new Map([["t44br_c", s]]);
  App.activeSlot = s;
  App.selParts = new Set();
  App.chanAuto = false;
`;

const CASES = [
  { id: "parts-selection",
    what: "parts panel: a selection spanning two textures, a protected part, a hidden part",
    src: `${MODEL}
      App.partUnfold = 2;
      App.selParts = new Set(["wing_l", "aileron_l"]);
      App.protectedParts = new Set(["canopy"]);
      App.meshes.get("gear_r").visible = false;
      refreshPartList();
      return document.getElementById("partList").innerHTML;` },
  { id: "parts-folded",
    what: "parts panel: nothing selected, categories only",
    src: `${MODEL}
      App.partUnfold = 0;
      refreshPartList();
      return document.getElementById("partList").innerHTML;` },
  { id: "parts-empty", min: 0,
    what: "parts panel with no model loaded says what to do",
    src: `App.meshes = new Map();
      refreshPartList();
      return document.getElementById("partList").innerHTML;` },

  // The layer list, added 2026-08-26 BEFORE turning it into a tree (ROADMAP 4.9 slice 2). §4's rule
  // is that a panel builder is refactored only with its fixture already captured — nothing else in
  // the suite looks at what this panel contains, so without a golden the change from a flat list to
  // an indented tree would be invisible to every test in the repo. The stack below deliberately
  // holds one of everything the row builder branches on: a channel tag, a blend that is not normal,
  // a part scope, a mask (which draws a second thumbnail and its own click target), a hidden layer,
  // and a projected layer that spans two sheets (the "x2 tex" badge).
  // The fixture was captured against the FLAT renderer on 2026-08-26, before 4.9 slice 2, which is
  // §4's rule. When the tree renderer landed the hash moved and the character count did not
  // (2481 → 2481, 497 → 497): the only change is `data-idx` → `data-row`, same length, renumbered
  // from array index to render order. Every other byte of a leaf row is what it was.
  { id: "layers-stack", min: 1500,
    what: "layer list: one of every row the builder can draw, flat",
    src: `
      const N = 32;
      const cv = hex => { const c = mkCanvas(N, N); const g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
      const s = { id: "t44_c", size: N, nSize: N, missing: false, layers: [] };
      s.baseC = cv("#202020"); s.composite = mkCanvas(N, N);
      s.layers = [
        { type: "fill", name: "Base green", color: "#3a5f2a", opacity: 1, blend: "normal", visible: true },
        { type: "fill", name: "Gloss", chan: "smooth", color: "#c0c0c0", opacity: .8, blend: "multiply", visible: true },
        { type: "paint", name: "Weathering", canvas: cv("#00000000"), opacity: .6, blend: "normal", visible: false },
        { type: "paint", name: "Masked paint", canvas: cv("#00000000"), mask: cv("#ffffff"), opacity: 1, blend: "normal", visible: true },
        { type: "adjust", name: "Warm", hue: 8, sat: 110, bright: 100, contrast: 105, opacity: 1, blend: "normal", visible: true },
        { type: "paint", name: "Roundel", canvas: cv("#00000000"), opacity: 1, blend: "normal", visible: true,
          proj: { id: "p44", name: "roundel" }, parts: ["wing_l", "wing_r"] },
      ].map(LayerNode.of);
      App.slots = new Map([["t44_c", s], ["t44b_c", { id: "t44b_c", size: N, missing: false, layers: [
        LayerNode.of({ type: "paint", name: "Roundel", canvas: cv("#00000000"), opacity: 1, blend: "normal", visible: true, proj: { id: "p44", name: "roundel" } })] }]]);
      App.activeSlot = s;
      App.activeLayer = s.layers[3];
      refreshLayerList();
      return document.getElementById("layerList").innerHTML;` },
  { id: "layers-none", min: 300,
    what: "layer list with no layer selected says the brush writes into the base texture",
    src: `
      const N = 32;
      const s = { id: "t44_c", size: N, nSize: N, missing: false, layers: [
        LayerNode.of({ type: "fill", name: "Only", color: "#3a5f2a", opacity: 1, blend: "normal", visible: true })] };
      s.composite = mkCanvas(N, N);
      App.slots = new Map([["t44_c", s]]);
      App.activeSlot = s;
      App.activeLayer = null;
      refreshLayerList();
      return document.getElementById("layerList").innerHTML;` },

  // ---- ROADMAP 4.28(a): the two panels 4.28 rewrites, captured before it touches them ----
  //
  // Between them the Layers and Brush panels had ONE fixture — `layers-stack`, on `#layerList`
  // alone, captured against the flat renderer before groups existed. Everything else 4.28 moves is
  // uncovered: the tree the renderer actually draws now, `refreshLayerProps` (which changes shape
  // per node kind and is 110 lines on 2.4's list), the header's Group/Ungroup state, the "New layer
  // on" selector D4 turns into a live mode, and every disabled brush button together with the
  // sentence saying why it is disabled. (b) rewrites the node, (d) rewrites the mode enum and (e)
  // rewrites both panels; without these captured first, all three are refactors with no oracle.
  //
  // These capture the whole `.section`, not the one list inside it, because that is the unit 4.28(e)
  // replaces: the header buttons, the channel selector, the list and the props are one panel and a
  // fixture on a third of it would miss the two thirds that move. Sliders are captured through their
  // `.val` spans rather than their `value` — assigning to an `<input>`'s value changes the property
  // and not the serialised attribute, so the spans are the only place per-tool settings memory
  // (3.22) is visible in markup, and (d) must not regress it.
  //
  // The synthetic states are the awkward ones on purpose, the same discipline as the parts cases:
  // a group inside a group, a folded group, a decal's folder with its three derived siblings, a
  // masked and part-scoped group at half opacity, and a brush panel in each of the four states that
  // disable a tool for a different reason.
  { id: "layers-panel-tree", min: 3000,
    what: "layers panel: a tree — a decal's folder, a group inside a group, a folded one, a masked and scoped one",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [
        fillL("Base green"),
        grp("Roundel", [
          paint("Emboss", { chan: "normal", surfKey: "em" }),
          paint("Metal", { chan: "metal", surfKey: "mt" }),
          paint("Gloss", { chan: "smooth", surfKey: "sm" }),
          Object.assign(paint("Roundel"), { type: "decal", bmp: cv("#c04040"), x: .5, y: .5, scale: 1, rot: 0, flip: false,
                                            proj: { id: "p28", name: "roundel" } }),
        ]),
        grp("Turret markings", [
          paint("Numbers", { parts: ["wing_l"] }),
          grp("Stencils", [
            paint("Warning", { blend: "multiply" }),
            fillL("Gloss tint", { chan: "smooth", color: "#808080" }),
          ]),
        ], { mask: cv("#ffffff"), parts: ["wing_l", "wing_r"], opacity: .5, blend: "multiply" }),
        grp("Folded away", [paint("Inside the fold")], { collapsed: true }),
        paint("Loose weathering", { visible: false, mask: cv("#808080") }),
      ];
      App.activeLayer = s.layers[2].children[1].children[0];    // a leaf two groups deep
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-paint", min: 2000,
    what: "layers panel: a masked, part-scoped paint layer's properties, with parts selected to take from",
    src: `${LSLOT}
      App.selParts = new Set(["wing_l", "wing_r"]);
      App.paint3d = false;
      s.layers = [fillL("Base"), paint("Squadron badge", { mask: cv("#c0c0c0"), parts: ["wing_l"], opacity: .65, blend: "multiply" })];
      App.activeLayer = s.layers[1];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-fill-value", min: 1500,
    what: "layers panel: a smoothness fill takes a value and no colour picker, and says what the numbers mean",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Gloss", { chan: "smooth", color: "#b4b4b4" })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-adjust", min: 1500,
    what: "layers panel: an adjustment layer's four parameters — the rows 4.28's D2 turns into an effect",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Base"), LayerNode.of({ type: "adjust", name: "Warm", hue: 8, sat: 110, bright: 100, contrast: 105, opacity: 1, blend: "normal", visible: true })];
      App.activeLayer = s.layers[1];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-group", min: 1500,
    what: "layers panel: a group selected — its properties, and the header button says Ungroup",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Base"), grp("Markings", [paint("A"), paint("B", { chan: "smooth" })], { opacity: .8, blend: "multiply" })];
      App.activeLayer = s.layers[1];
      refreshLayerList();
      return panel();` },
  // ---- ROADMAP 4.50 (5): a gradient's stop rows, captured before the gradient map reused them ----
  // `GradUI.stopRows` edits a gradient map's stops as well since 4.50 (5), which made it take the
  // record it edits as an argument. Both cases were captured against the build BEFORE that change
  // (2026-09-25), so they prove the fill's own rows did not move: a colour gradient (colour
  // pickers) and a smoothness one (value sliders), three stops each, one of them part-transparent.
  { id: "layers-panel-props-gradient", min: 1500,
    what: "layers panel: a colour gradient fill — its shape rows and three stops with colour pickers",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Fade", { grad: { shape: "linear", space: "uv", angle: 30, dir: [1, 0, 0], from: .1, to: .9, repeat: "reflect",
        stops: [{ t: 0, color: "#203040", alpha: 1 }, { t: .5, color: "#a0b0c0", alpha: .5 }, { t: 1, color: "#ffffff", alpha: 0 }] } })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-gradient-grey", min: 1500,
    what: "layers panel: a smoothness gradient fill — value sliders instead of colour pickers",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Gloss fade", { chan: "smooth", color: "#b4b4b4", grad: { shape: "radial", space: "uv", angle: 0, dir: [1, 0, 0], from: 0, to: 1, repeat: "clamp",
        stops: [{ t: 0, color: "#202020", alpha: 1 }, { t: .4, color: "#808080", alpha: 1 }, { t: 1, color: "#e0e0e0", alpha: .25 }] } })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  // ---- ROADMAP 4.50 (7), (8): a noise's rows and a pattern's ----
  // Captured the day they landed (2026-09-26) — nothing rendered them before, so these hold what
  // --dump showed to be there: a noise's kind, its scale as a log slider with a box in metres, its
  // detail, roughness and seed above the gradient's own levels and stops; a streak's stretch on a
  // smoothness map, whose stops are values; a pattern's tile row, then its repeats on the sheet or
  // its size in metres and blend along the model; and the normal map's warning about a tile wrapped
  // from three sides. The same day the Fill select gained the three kinds and the Mask row its
  // "noise…" button, which moved the five cases above that show them — each diffed against main.
  { id: "layers-panel-props-noise", min: 1500,
    what: "layers panel: a colour Perlin noise — its kind, scale, detail, roughness and seed, then levels and stops",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Grime", { grad: { shape: "noise", space: "model", angle: 0, dir: [1, 0, 0], from: .35, to: .65, repeat: "clamp",
        stops: [{ t: 0, color: "#3a3020", alpha: 0 }, { t: 1, color: "#3a3020", alpha: .8 }],
        noise: { type: "perlin", seed: 42, scale: .25, octaves: 5, rough: .55, stretch: 8 } } })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-noise-streaks-grey", min: 1500,
    what: "layers panel: a streaks noise on smoothness — the stretch row, and value sliders for its stops",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Rain marks", { chan: "smooth", color: "#606060", grad: { shape: "noise", space: "model", angle: 0, dir: [1, 0, 0], from: 0, to: 1, repeat: "clamp",
        stops: [{ t: 0, color: "#606060", alpha: 0 }, { t: 1, color: "#303030", alpha: 1 }],
        noise: { type: "streaks", seed: 7, scale: .08, octaves: 3, rough: .4, stretch: 14 } } })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-pattern-uv", min: 1500,
    what: "layers panel: a pattern on the sheet — the tile row, repeats, angle and offsets",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Splinter camo", { color: "#8a6a3a", pat: { space: "uv", repeat: 6, size: 1, angle: 30, x: .25, y: .5, sharp: 4 },
        patImg: cv("#8a6a3a"), patName: "splinter_tile.png" })];
      App.activeLayer = s.layers[0];
      refreshLayerList();
      return panel();` },
  { id: "layers-panel-props-pattern-model-normal", min: 1500,
    what: "layers panel: a pattern along the model on the normal map — the size in metres, the blend, and the warning",
    src: `${LSLOT}
      App.selParts = new Set();
      s.layers = [fillL("Rivets", { chan: "normal", color: "#8080ff", pat: { space: "model", repeat: 8, size: .4, angle: 0, x: 0, y: 0, sharp: 6 },
        patImg: cv("#8080ff"), patName: "rivets_n.png" })];
      App.activeLayer = s.layers[0];
      const was = App.brush.mode;
      App.brush.mode = "normal";        // so the rows below describe the normal slot — and put back after
      refreshLayerList();
      const html = panel();
      App.brush.mode = was;
      return html;` },
  // ---- ROADMAP 4.50 (5): an effect's kinds ----
  // Captured the day the kinds landed (2026-09-26) — nothing rendered them before, so these hold
  // what was checked by --dump to be there, not an earlier build: each kind's rows under the Effect
  // select, the Channel select only where a channel can be picked, the colour-only kinds missing
  // from a smoothness layer's list, and a kind from a newer build named as such. FxUI's two pieces
  // of panel state are set and put back, so no later case depends on the order.
  ...[
    ["levels", "a colour Levels effect with its red channel in hand — the Channel select, five numbers, reset", "color",
     { type: "levels", rgb: { inLo: 12, inHi: 240, gamma: 1.25, outLo: 0, outHi: 255 }, r: { inLo: 0, inHi: 200, gamma: .8, outLo: 10, outHi: 255 } }, "r"],
    ["curves", "a colour Curves effect — the box, reset and the hint", "color", { type: "curves", rgb: [[0, 0], [64, 48], [192, 210], [255, 255]] }, "rgb"],
    ["balance", "a Colour balance with its midtones shifted — the range select, three sliders, keep luminosity", "color",
     { type: "balance", shadows: [0, 0, 0], mids: [20, -15, 5], highs: [0, 0, -30], keepLum: true }, "rgb"],
    ["gradmap", "a Gradient map — the stop rows, pointed at the effect's own stops", "color",
     { type: "gradmap", stops: [{ t: 0, color: "#1a2b3c", alpha: 1 }, { t: .5, color: "#c08040", alpha: .6 }, { t: 1, color: "#f0f0d0", alpha: 1 }] }, "rgb"],
    ["grey-levels", "a Levels effect on smoothness — no Channel select, no colour-only kinds, the map's own hint", "smooth",
     { type: "levels", rgb: { inLo: 40, inHi: 220, gamma: 1, outLo: 0, outHi: 255 } }, "r"],
    ["grey-threshold", "a Threshold on smoothness — one number and its hint", "smooth", { type: "threshold", level: 90 }, "rgb"],
    // Invert and Posterize, added 2026-09-26 by the item's review so every kind has a case (the four
    // numbers' is `layers-panel-props-adjust`); their rows were checked by --dump before capture.
    ["invert", "an Invert effect — the kind select and its hint, and nothing to set", "color", { type: "invert" }, "rgb"],
    ["posterize", "a Posterize effect — one number and its hint", "color", { type: "posterize", levels: 6 }, "rgb"],
    ["unknown", "an effect kind from a newer build — named as such, with no rows", "color", { type: "blur", radius: 3 }, "rgb"],
  ].map(([k, what, ch, fx, sub]) => ({ id: "layers-panel-fx-" + k, min: 1500, what: "layers panel: " + what,
    src: `${LSLOT}
      App.selParts = new Set();
      const was = [FxUI.sub, FxUI.range];
      FxUI.sub = ${JSON.stringify(sub)}; FxUI.range = "mids";
      s.layers = [fillL("Base"), LayerNode.of({ type: "adjust", name: "Effect", chan: ${JSON.stringify(ch === "color" ? undefined : ch)},
        opacity: 1, blend: "normal", visible: true, hue: 0, sat: 100, bright: 100, contrast: 100, fx: ${JSON.stringify(fx)} })];
      App.activeLayer = s.layers[1];
      refreshLayerList();
      const html = panel();
      FxUI.sub = was[0]; FxUI.range = was[1];
      return html;` })),

  // ---- 4.28(e): a layer that carries more than one channel ----
  // The state the whole slice exists to make possible, and the one no earlier fixture could even
  // describe: one layer holding painted colour, a smoothness fill and a metalness effect at once.
  // Captured over the whole section because it is the strip, the dots and the per-channel property
  // rows that have to agree with each other — the fill's value slider must be the SMOOTHNESS fill's
  // and not the colour content's, which is the exact bug a single-channel accessor would produce
  // and the reason `refreshLayerProps` asks `contentOn` rather than `L.color`.
  { id: "layers-panel-multichannel", min: 2000,
    what: "layers panel: one layer carrying three channels — the strip, the dots, and the rows describing the channel in hand",
    src: `${LSLOT}
      App.selParts = new Set();
      const multi = paint("Squadron badge");
      LayerNode.addContent(multi, "smooth", LayerNode.content("fill", { color: "#b4b4b4" }));
      LayerNode.addContent(multi, "metal", LayerNode.content("effect", { hue: 0, sat: 100, bright: 120, contrast: 90 }));
      s.layers = [fillL("Base"), multi];
      App.activeLayer = multi;
      App.brush.mode = "smooth";        // so the rows below describe the smoothness slot, not the colour one
      refreshLayerList();
      return panel();` },

  // The brush panel. Every case below is a state in which some tool cannot write, because that is
  // the whole of what this panel computes: `updateBrushAvailability` is 45 lines of "why not", and
  // 4.28(d) replaces the mode enum it branches on with a tool x channel x target triple. The
  // sentences are the contract — §4 forbids a tool that silently does nothing — so they are what
  // the hash is over.
  { id: "brush-no-slot", min: 2000,
    what: "brush panel: nothing loaded — every tool that needs a slot is off, and says so",
    src: `${BRUSHRESET}
      App.slots = new Map(); App.activeSlot = null; App.activeLayer = null;
      App.geomData = null; App.skinUnits = [];
      App.brush.mode = "color";
      updateBrushAvailability();
      return brushPanel();` },
  { id: "brush-air-paint", min: 2000,
    what: "brush panel: an aircraft with both sheets and a paint layer — the wear mask is not a concept here",
    src: `${BRUSHRESET}
      ${BSLOT}
      App.geomData = [{ name: "wing_l" }]; App.skinUnits = [{ on: true, unit: { cls: "air" } }];
      s.layers = [paint("Camouflage")];
      App.activeLayer = s.layers[0];
      App.brush.mode = "color";
      updateBrushAvailability();
      return brushPanel();` },
  { id: "brush-tank-no-n", min: 2000,
    what: "brush panel: a tank with no _n — the wear mask appears, every surface tool goes off with the reason",
    src: `${BRUSHRESET}
      ${BSLOT}
      s.smooth = s.metal = s.normal = null;
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls: "tank" } }];
      s.layers = [paint("Camouflage")];
      App.activeLayer = null;          // no layer, so a tool is refused for what the SLOT lacks
      App.brush.mode = "wear";
      updateBrushAvailability();
      return brushPanel();` },
  // Captured on 2026-09-01 as "the colour brush is the wrong tool here", and 4.28(e) is the reason
  // that sentence is no longer true: a tool addresses its OWN slot inside the selected layer and
  // creates it on the first stroke, so a smoothness layer does not make the colour brush wrong, it
  // makes it the thing that gives this layer a colour channel. What the case still gates is that
  // the Eraser is off — it needs pixels that exist — and that nothing else went off with it.
  { id: "brush-wrong-channel", min: 2000,
    what: "brush panel: a smoothness layer selected — every tool that can make its own slot stays on, the Eraser does not",
    src: `${BRUSHRESET}
      ${BSLOT}
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls: "tank" } }];
      s.layers = [paint("Gloss", { chan: "smooth" })];
      App.activeLayer = s.layers[0];
      App.brush.mode = "smooth";
      updateBrushAvailability();
      return brushPanel();` },
  { id: "brush-mask-target", min: 2000,
    what: "brush panel: the mask brush — the value row renames itself and Alt stops picking and starts revealing",
    src: `${BRUSHRESET}
      ${BSLOT}
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls: "tank" } }];
      s.layers = [paint("Badge", { mask: cv("#ffffff") })];
      App.activeLayer = s.layers[0];
      App.brush.mode = "mask";
      updateBrushAvailability();
      return brushPanel();` },
  // ROADMAP 4.50 (4) + 6.4. A Panel line stroke is a height FIELD that adds, so it always builds up and
  // Opacity is already its per-dab depth: Flow and Build up are hidden for it, and only for it.
  { id: "brush-panel-line", min: 2000,
    what: "brush panel: Panel line — the value row reads Depth, and Flow and Build up are hidden because a height stroke always adds",
    src: `${BRUSHRESET}
      ${BSLOT}
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls: "tank" } }];
      s.layers = [paint("Lines", { chan: "normal" })];
      App.activeLayer = s.layers[0];
      App.brush.mode = "height";
      updateBrushAvailability();
      return brushPanel();` },
  // A camouflage tile (ROADMAP 4.50 (6)) is a ground vehicle's sheet whose alpha is the camouflage's
  // own, not a wear mask — so the Wear mask brush is off on it, with that sentence.
  { id: "brush-camo-tile", min: 2000,
    what: "brush panel: a camouflage tile — the Wear mask brush is off and says the tile carries the camouflage's alpha",
    src: `${BRUSHRESET}
      ${BSLOT}
      s.camoTile = true; s.noGeom = true;
      s.smooth = s.metal = s.normal = null;
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls: "tank" } }];
      s.layers = [paint("Blots")];
      App.activeLayer = s.layers[0];
      App.brush.mode = "color";
      updateBrushAvailability();
      return brushPanel();` },

  // The weapons panel reads a real unit's armament out of aces.vromfs.bin. The armament READER is
  // already covered over the whole roster by t12/t14/t26; what is not covered anywhere is the
  // markup this panel builds from it. So the reader is stubbed with a hand-built `arm` and the
  // ---- the four ROW LISTS, added 2026-09-04 before ROADMAP 3.26 touches any of them ----
  // 3.26 measured five clickable row styles that are one component with five sets of numbers, and
  // unifying them changes the class on every list in the app at once. §4's rule is that the fixture
  // comes first, and here it is not a formality: nothing in the suite had ever looked at the slot
  // list, the vehicle search results, the UserSkins list or the pre-export rule check, so the whole
  // unification would have been invisible to `npm test`. Each case holds the branches the row
  // builder actually has — a missing slot beside a loaded one, a selected vehicle beside an
  // unselected one, an unreadable archive beside a folder, and one validation row of every level.
  { id: "slots-list", min: 300,
    what: "texture slots: one loaded and active, one missing, one runtime-built (2D only)",
    src: `
      const N = 16, cv = () => mkCanvas(N, N);
      const mk = (id, extra) => Object.assign({ id, layers: [], size: N, sizeH: N, missing: false,
                                                baseC: cv(), composite: cv() }, extra || {});
      // The active slot is the one refreshSlotList also refreshes the Channels panel from, so it
      // needs the sheets that panel reads — a slot without them is not a case, it is a crash.
      const a = mk("hull_c", { smooth: cv(), metal: cv(), normal: cv(), covBase: new Uint8Array(N * N) });
      const b = mk("turret_c", { missing: true, composite: null });
      const c = mk("track_c", { noGeom: true });
      App.slots = new Map([["hull_c", a], ["turret_c", b], ["track_c", c]]);
      App.activeSlot = a; App.activeLayer = null; App.slotMenu = null;
      refreshSlotList();
      return document.getElementById("slotList").innerHTML;` },
  // The camouflage tile's row (ROADMAP 4.50 (6)) with its ⋮ menu open: named as the tile, and only
  // the entries that mean something for it — a new base, its size, deleting it — where an ordinary
  // slot also offers albedo, _n and game-file entries a tile has no use for.
  { id: "slots-list-camo-tile", min: 300,
    what: "texture slots: the camouflage tile beside an ordinary slot, the tile's ⋮ menu open",
    src: `
      const N = 16, cv = () => mkCanvas(N, N);
      const mk = (id, extra) => Object.assign({ id, layers: [], size: N, sizeH: N, missing: false,
                                                baseC: cv(), composite: cv() }, extra || {});
      const a = mk("hull_c", { smooth: cv(), metal: cv(), normal: cv(), covBase: new Uint8Array(N * N) });
      const t = mk("wtss_camo_tile", { camoTile: true, noGeom: true });
      App.slots = new Map([["hull_c", a], ["wtss_camo_tile", t]]);
      App.activeSlot = a; App.activeLayer = null; App.slotMenu = "wtss_camo_tile";
      refreshSlotList();
      const html = document.getElementById("slotList").innerHTML;
      App.slotMenu = null;
      return html;` },
  // An ordinary texture's ⋮ menu open (ROADMAP 4.50 (16) added its layered pair, "export layers…"
  // and "import layers…", between the game-file entry and the resolution): until this case no
  // fixture held that menu, only the tile's three entries above.
  { id: "slots-list-menu", min: 300,
    what: "texture slots: an ordinary loaded texture with its ⋮ menu open",
    src: `
      const N = 16, cv = () => mkCanvas(N, N);
      const a = Object.assign({ id: "hull_c", layers: [], size: N, sizeH: N, missing: false, baseC: cv(), composite: cv() },
                              { smooth: cv(), metal: cv(), normal: cv(), covBase: new Uint8Array(N * N) });
      App.slots = new Map([["hull_c", a]]);
      App.activeSlot = a; App.activeLayer = null; App.slotMenu = "hull_c";
      refreshSlotList();
      const html = document.getElementById("slotList").innerHTML;
      App.slotMenu = null;
      return html;` },
  // The Channels panel the case above also refreshes, hashed on its own: it is the other 81-line
  // builder in ui/panels/slots.js (2.4), and until this case nothing looked at what it drew.
  { id: "channels-panel", min: 300,
    what: "the Channels panel: two sheets with their four raw channels, and the alpha line",
    src: `
      const N = 16, cv = () => mkCanvas(N, N);
      const mk = (id, extra) => Object.assign({ id, layers: [], size: N, sizeH: N, missing: false,
                                                baseC: cv(), composite: cv() }, extra || {});
      const a = mk("hull_c", { cStem: "hull_c", nStem: "hull_n", cFileName: "hull_c.dds", smooth: cv(), metal: cv(), normal: cv(), covBase: new Uint8Array(N * N) });
      App.slots = new Map([["hull_c", a]]);
      App.activeSlot = a; App.activeLayer = null; App.chanView = "n:r";
      refreshChannelPanel();
      const withN = document.getElementById("chanPanel").innerHTML;
      const b = mk("turret_c", { cStem: "turret_c" });                  // albedo only: the no-_n branch
      App.activeSlot = b; App.chanView = "shaded";
      refreshChannelPanel();
      return withN + "|" + document.getElementById("chanPanel").innerHTML;` },

  { id: "search-results", min: 300,
    what: "vehicle search: a selected result, an unselected one, and a bare model with no unit record",
    src: `
      const keep = { rows: GameDB.vehicleRows, models: GameDB.models, stems: GameDB.stems,
                     key: App.vehicleKey, units: GameUnits.byId, filter: JSON.stringify(GameFilter), su: App.skinUnits };
      try {
        GameUnits.byId = new Map([
          ["f_4e", { id: "f_4e", name: "F-4E Phantom II", fullName: "F-4E Phantom II", cls: "air",
                     country: "USA", countryTag: "country_usa", tree: "country_usa", rank: 6 }],
          ["f_4ej", { id: "f_4ej", name: "F-4EJ Phantom II", fullName: "F-4EJ Phantom II", cls: "air",
                     country: "Japan", countryTag: "country_japan", tree: "country_japan", rank: 6 }],
        ]);
        GameDB.vehicleRows = [
          { unit: GameUnits.byId.get("f_4e"), model: "f_4e" },
          { unit: GameUnits.byId.get("f_4ej"), model: "f_4ej" },
          { unit: null, model: "f_4e_late" },
        ];
        GameDB.models = GameDB.vehicleRows.map(r => r.model);
        GameDB.stems = new Map();
        App.vehicleKey = "f_4e";                       // so one row carries the selected state
        // ...because the skin is for its unit: since 2026-10-10 a row is lit by the ticked units, not
        // by sharing the loaded model (t90_browse holds that). Same row, same markup as before.
        App.skinUnits = [{ unit: GameUnits.byId.get("f_4e"), score: 100, on: true }];
        clearFilters();
        // A query, because with nothing typed the panel lists every vehicle, which is the case
        // below. "f_4" matches all three models, so the fixture holds a selected row, an unselected
        // one, and one with no unit record at all — which is the branch that draws the bare model name.
        // Re-captured 2026-09-27 for one intended move (--dump read before and after): the bare model
        // went from first to last. All three are the prefix tier, and inside a tier a hit on the name
        // on screen now ranks above one on an id (ROADMAP 3.5); before, the tie went to collation,
        // which sorts "_" ahead of "-" and so put f_4e_late above both Phantoms.
        // Re-captured 2026-10-10 with five more cases (search-empty-filtered, search-outside-filters,
        // search-forgiving, skins-list, search-control), every one read before and after: a vehicle
        // row lost its flag and its "Load ▸" label, its download glyph became a drawn icon with an
        // aria-label, its hover label gained a second line (rank · nation), the "other" class icon is
        // a box and no longer a square, and the type row gained the nation-and-rank fold chip. Nothing
        // else moved. tools/t102_sidebar.mjs holds why.
        document.getElementById("gameSearch").value = "f_4";
        renderGameSearch();
        return document.getElementById("gameList").innerHTML;
      } finally {
        GameDB.vehicleRows = keep.rows; GameDB.models = keep.models; GameDB.stems = keep.stems;
        GameUnits.byId = keep.units; App.vehicleKey = keep.key; App.skinUnits = keep.su;
        document.getElementById("gameSearch").value = "";
      }` },

  // ROADMAP 3.28(3) made a filter with an empty query open nothing and say what it narrowed to; the
  // owner reversed that on 2026-09-25 (3.38): nothing typed lists every vehicle the filters let
  // through, in tree order. So this case holds the reverse now — the aircraft filter alone lists the
  // F-4E and not the T-34. tools/t90_browse.mjs holds the behaviour; this holds the markup.
  { id: "search-empty-filtered", min: 0,
    what: "vehicle search: a filter picked with an empty query lists what it lets through",
    src: `
      const keep = { rows: GameDB.vehicleRows, models: GameDB.models, stems: GameDB.stems,
                     units: GameUnits.byId, nations: GameUnits.nations };
      try {
        GameUnits.byId = new Map([
          ["f_4e", { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 }],
          ["t_34", { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 }],
        ]);
        GameDB.vehicleRows = [...GameUnits.byId.values()].map(u => ({ unit: u, model: u.id }));
        GameDB.models = GameDB.vehicleRows.map(r => r.model);
        GameDB.stems = new Map();
        document.getElementById("gameSearch").value = "";
        clearFilters();
        GameFilter.cls = "air";                  // one filter, no query — the reported gesture
        renderGameSearch();
        const el = document.getElementById("gameList");
        return el.className + " | " + el.innerHTML;
      } finally {
        GameDB.vehicleRows = keep.rows; GameDB.models = keep.models; GameDB.stems = keep.stems;
        GameUnits.byId = keep.units; clearFilters();
        document.getElementById("gameSearch").value = "";
      }` },

  { id: "skins-list", min: 200,
    what: "UserSkins list: a folder, a zip, and an archive that cannot be read",
    src: `
      const keep = { skins: App.userSkins, dir: App.userSkinsDir };
      try {
        App.userSkins = [
          { name: "desert hull", kind: "dir", units: ["f_4e"], texCount: 3 },
          { name: "winter.zip", kind: "zip", units: [], texCount: 1 },
          { name: "pack.7z", kind: "7z", units: [], texCount: 0, unsupported: true },
        ];
        App.userSkinsDir = null;
        // Both boxes, because the list had its own until ROADMAP 3.5 put it under the vehicle search.
        const sb = document.getElementById("skinSearch"); if (sb) sb.value = "";
        document.getElementById("gameSearch").value = "";
        clearFilters();
        renderUserSkins();
        return document.getElementById("userSkinList").innerHTML;
      } finally { App.userSkins = keep.skins; App.userSkinsDir = keep.dir; }` },

  // ---- ROADMAP 3.5 / 3.6, captured 2026-09-26 against the build BEFORE the change ----
  // Four branches nothing held: the search control's own markup, a query with a filter that leaves
  // the hit out (it said "No matches … with these filters"), a typo and a missing hyphen (both found
  // nothing), and the skins list under a query and a type filter (it had its own box and no chips).
  { id: "search-control", min: 400,
    what: "the search control over both lists: the box, reset, the type / nation / rank chips and the sort",
    src: `
      const keep = { nations: GameUnits.nations, maxRank: GameUnits.maxRank };
      try {
        GameUnits.nations = [{ tag: "country_usa", name: "USA" }, { tag: "country_ussr", name: "USSR" }];
        GameUnits.maxRank = 3;
        clearFilters(); GameFilter.nation = "country_ussr";   // one lit chip, so the "on" branch is held
        renderFilterChips();
        return document.getElementById("rowGameSearch").innerHTML;
      } finally { GameUnits.nations = keep.nations; GameUnits.maxRank = keep.maxRank; clearFilters(); renderFilterChips(); }` },
  { id: "search-outside-filters", min: 0,
    what: "vehicle search: a query with the aircraft filter on — the T-34 it asked for, and a raw texture",
    src: `
      const keep = { rows: GameDB.vehicleRows, models: GameDB.models, stems: GameDB.stems, units: GameUnits.byId };
      try {
        GameUnits.byId = new Map([
          ["f_4e", { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 }],
          ["t_34", { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 }],
        ]);
        GameDB.vehicleRows = [...GameUnits.byId.values()].map(u => ({ unit: u, model: u.id }));
        GameDB.models = GameDB.vehicleRows.map(r => r.model);
        // A stem with a real tier, so the texture row is drawn and not just its label.
        GameDB.stems = new Map([["t_34_body_c", { stem: "t_34_body_c", tiers: { base: { w: 1024, h: 1024, tier: "base",
          fmt: "DXT5", compName: "zstd", size: 4096, supported: true } } }]]);
        clearFilters(); GameFilter.cls = "air";
        document.getElementById("gameSearch").value = "t-34";
        renderGameSearch();
        const el = document.getElementById("gameList");
        return el.className + " | " + el.innerHTML;
      } finally {
        GameDB.vehicleRows = keep.rows; GameDB.models = keep.models; GameDB.stems = keep.stems;
        GameUnits.byId = keep.units; clearFilters();
        document.getElementById("gameSearch").value = "";
      }` },
  { id: "search-forgiving", min: 0,
    what: "vehicle search: a typo (abrahms) and a missing hyphen (f4e) still find the vehicle",
    src: `
      const keep = { rows: GameDB.vehicleRows, models: GameDB.models, stems: GameDB.stems, units: GameUnits.byId };
      try {
        GameUnits.byId = new Map([
          ["us_m1_abrams", { id: "us_m1_abrams", name: "M1 Abrams", fullName: "M1 Abrams", cls: "tank", country: "USA", tree: "country_usa", rank: 7 }],
          ["f_4e", { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 }],
          ["f_4ej", { id: "f_4ej", name: "F-4EJ", fullName: "F-4EJ", cls: "air", country: "Japan", tree: "country_japan", rank: 6 }],
        ]);
        GameDB.vehicleRows = [...GameUnits.byId.values()].map(u => ({ unit: u, model: u.id }));
        GameDB.models = GameDB.vehicleRows.map(r => r.model);
        GameDB.stems = new Map();
        clearFilters();
        const el = document.getElementById("gameList"), box = document.getElementById("gameSearch");
        const out = [];
        for (const q of ["abrahms", "f4e"]) { box.value = q; renderGameSearch(); out.push(el.className + " | " + el.innerHTML); }
        return out.join(" || ");
      } finally {
        GameDB.vehicleRows = keep.rows; GameDB.models = keep.models; GameDB.stems = keep.stems;
        GameUnits.byId = keep.units; clearFilters();
        document.getElementById("gameSearch").value = "";
      }` },
  { id: "skins-search", min: 0,
    what: "UserSkins list under the one search: the aircraft filter with nothing typed, then a query it leaves out",
    src: `
      const keep = { skins: App.userSkins, dir: App.userSkinsDir, units: GameUnits.byId };
      const setQ = q => { const sb = document.getElementById("skinSearch"); if (sb) sb.value = q; document.getElementById("gameSearch").value = q; };
      try {
        GameUnits.byId = new Map([
          ["f_4e", { id: "f_4e", name: "F-4E", fullName: "F-4E", cls: "air", country: "USA", tree: "country_usa", rank: 6 }],
          ["t_34", { id: "t_34", name: "T-34", fullName: "T-34", cls: "tank", country: "USSR", tree: "country_ussr", rank: 2 }],
        ]);
        App.userSkins = [
          { name: "desert phantom", kind: "dir", units: ["f_4e"], texCount: 3, mtime: 3 },
          { name: "winter", kind: "dir", units: ["t_34"], texCount: 2, mtime: 2 },
          { name: "grey phantom", kind: "dir", units: ["f_4e"], texCount: 3, mtime: 1 },
        ];
        App.userSkinsDir = null;
        clearFilters(); GameFilter.cls = "air";
        const el = document.getElementById("userSkinList"), out = [];
        setQ(""); renderUserSkins(); out.push(el.innerHTML);
        setQ("winter"); renderUserSkins(); out.push(el.innerHTML);
        return out.join(" || ");
      } finally {
        App.userSkins = keep.skins; App.userSkinsDir = keep.dir; GameUnits.byId = keep.units;
        clearFilters(); setQ("");
      }` },

  { id: "export-validate", min: 200,
    what: "the pre-export rule check: one row of every level, worst first",
    src: `
      // Both the plan builder and the rule set are stubbed: this case is about what the PANEL
      // draws for each level, and t30_validate already owns whether the rules are right.
      const keep = { v: validateExport, p: buildExportPlan };
      try {
        buildExportPlan = () => ({ files: [], blk: "" });
        validateExport = () => [
          { level: "pass", title: "Every texture is a power of two" },
          { level: "info", title: "Ground vehicle", detail: "exported with set_tex + camo_skin_tex" },
          { level: "warn", title: "8192 x 8192 is above the recommended size", detail: "the Live market rejects over 4096" },
          { level: "error", title: "No albedo in the export", detail: "a skin with no _c does nothing in game" },
        ];
        updateExportValidation([{ id: "hull_c" }]);
        return document.getElementById("expValidateList").innerHTML;
      } finally { validateExport = keep.v; buildExportPlan = keep.p; }` },
  // Camo under skin ▸ My own pattern (ROADMAP 4.50 (6)): the Preview row with the hangar's two
  // sliders, and the pin list — the tile on the hull's camouflage, and the crew compartment's said
  // to keep the game's own. Which pins there ARE is t106's question; this is what the panel says.
  { id: "export-camo-tile", min: 200,
    what: "Camo under skin ▸ My own pattern: the preview row at 150 % / −30°, and the pin list naming the tile and the stem that keeps the game's own",
    src: `
      const keep = { mp: App.matPaint, pt: App.paintTex, pc: App.paintColor, su: App.skinUnits, us: CamoTile.unitStems,
        mode: $("expMode").value, base: $("expCamoBase").value, slots: App.slots, view: Object.assign({}, CamoTile.view) };
      try {
        App.matPaint = new Map([["hull", "us_camo_olive"], ["crew", "ger_camo_inside_elfebein"]]);
        App.paintTex = new Map(); App.paintColor = new Map();
        App.skinUnits = [{ unit: { id: "us_m1a2_sep3_abrams", name: "M1A2", cls: "tank", country: "" }, score: 100, on: true }];
        CamoTile.unitStems = () => new Set(["us_camo_olive"]);
        CamoTile._stems = null;
        App.slots = new Map();
        CamoTile.ensure(16);
        $("expMode").value = "set_tex"; $("expCamoBase").value = "tile";
        CamoTile.view.scale = 1.5; CamoTile.view.rot = -30;
        updateExportWarnings();
        return $("rowCamoTile").outerHTML + "|" + $("camoPinInfo").outerHTML;
      } finally {
        App.matPaint = keep.mp; App.paintTex = keep.pt; App.paintColor = keep.pc; App.skinUnits = keep.su;
        CamoTile.unitStems = keep.us; CamoTile._stems = null; App.slots = keep.slots;
        $("expMode").value = keep.mode; $("expCamoBase").value = keep.base; Object.assign(CamoTile.view, keep.view);
      }` },

  // ---- the Selection and Shape panels, added 2026-09-26 with ROADMAP 4.50 (9) ----
  // The Selection tab grew the Lasso and Wand kinds, a Tolerance / Contiguous row that shows only for
  // the wand, and a sentence for a shape that is not an island pick; the Shape tab grew "→ selection".
  // t99 drives what they DO; these hold what they SAY, in the three states the panel has a branch for:
  // the wand with a patch taken, a polygon lasso half drawn, and the tool off with nothing selected.
  { id: "select-panel", min: 3000,
    what: "Selection tab: the wand with a patch picked (its row shown), a lasso with two corners down, then off and empty",
    src: `
      const keep = { slot: App.activeSlot, layer: App.activeLayer, sel: App.selParts, geom: App.geomData, sc: v2.sc, ox: v2.ox, oy: v2.oy };
      const N = 32, s = { id: "t44sel", size: N, nSize: N, layers: [], missing: false, baseC: mkCanvas(N, N), composite: mkCanvas(N, N) };
      const g = ctx2d(s.composite); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); g.fillStyle = "rgb(200,40,40)"; g.fillRect(4, 4, 12, 8);
      try {
        App.slots.set(s.id, s); App.activeSlot = s; App.activeLayer = null; App.selParts = new Set(); App.geomData = null;
        v2.sc = 1; v2.ox = 0; v2.oy = 0;
        PathUI.set(false); Marquee.none();
        document.getElementById("selTol").value = "32"; document.getElementById("selContig").checked = true;
        // A button that has been active once keeps an empty class attribute when it is not, so each
        // case starts from the markup, not from whatever toggled these before it ran.
        for (const id of ["btnSelMode", "btnSelIsland", "btnSelLasso", "btnSelWand"]) document.getElementById(id).removeAttribute("class");
        const sec = () => document.getElementById("selSection").innerHTML;
        SelectUI.setKind("wand");
        Marquee.fromColour(s.composite, 6, 6, 32, true, "replace");
        const wand = sec();
        Marquee.none(); SelectUI.setKind("lasso");
        const ev = { shiftKey: false, altKey: false, button: 0 };
        SelectUI.down(ev, { x: 3, y: 3, vx: 3, vy: 3 }); SelectUI.up();
        SelectUI.down(ev, { x: 20, y: 3, vx: 20, vy: 3 }); SelectUI.up();
        const lasso = sec();
        SelectUI.cancelLasso(); SelectUI.setKind("box"); SelectUI.setOn(false);
        return wand + "|" + lasso + "|" + sec();
      } finally {
        SelectUI.lasso = null; Marquee.none(); SelectUI.setKind("box"); SelectUI.setOn(false);
        App.slots.delete(s.id); App.activeSlot = keep.slot; App.activeLayer = keep.layer; App.selParts = keep.sel; App.geomData = keep.geom;
        v2.sc = keep.sc; v2.ox = keep.ox; v2.oy = keep.oy;
      }` },
  { id: "shape-panel", min: 1000,
    what: "Shape tab: a closed path (Fill, Stamp along and → selection offered), then the same path open (→ selection refused)",
    src: `
      const keep = { slot: App.activeSlot };
      const N = 32, s = { id: "t44path", size: N, nSize: N, layers: [], missing: false, baseC: mkCanvas(N, N), composite: mkCanvas(N, N) };
      try {
        App.slots.set(s.id, s); App.activeSlot = s;
        // from the markup, as above: not from whatever toggled the tool before this case ran
        document.getElementById("btnPathTool").removeAttribute("class");
        document.getElementById("pathRow2").setAttribute("style", "display:none");
        PathUI.set(true);
        PathUI.path = Path.make();
        [[4, 4], [24, 6], [16, 26]].forEach(q => Path.add(PathUI.path, q[0], q[1]));
        PathUI.path.closed = true; PathUI.sync();
        const sec = () => document.getElementById("pathSection").innerHTML;
        const closed = sec();
        PathUI.path.closed = false; PathUI.sync();
        return closed + "|" + sec();
      } finally {
        PathUI.clear(); PathUI.set(false);
        App.slots.delete(s.id); App.activeSlot = keep.slot;
      }` },
  // The model dialog (ui/panels/mask-bake.js), captured 2026-09-27 when it grew its third entry,
  // *From the cockpit* (ROADMAP 4.45). It is a dialog, built fresh on every open, so the markup is
  // taken straight after `open`: with no cockpit model — the two mask sources, Curvature chosen — and
  // then with one, on a sheet the body on screen does not use — all three, the cockpit's entry chosen,
  // the two mask sources off and saying why, and the note saying the cockpit body was never opened.
  // `Bake.run` is held pending so no bake runs in this page; t104 drives what the dialog DOES. The
  // first half was compared with the same state run through the dialog as it was before 4.45: byte for
  // byte the same markup but for two changes meant — the note wraps (`white-space`, `max-width`), and
  // the Reach row is there, hidden.
  { id: "mask-bake-dialog", min: 2000,
    what: "the model dialog: its two mask sources with no cockpit model, then From the cockpit on a sheet the body on screen does not use",
    src: `
      const keep = { slot: App.activeSlot, layer: App.activeLayer, geom: App.geomData, matSlot: App.matSlot, bodies: App.bodies,
                     body: App.body, key: App.vehicleKey, obj: App.objName, run: Bake.run };
      const N = 32, cv = () => mkCanvas(N, N);
      const s = { id: "t44mb", size: N, nSize: N, layers: [], missing: false, baseC: cv(), composite: cv(), normal: null };
      const tri = { name: "tub", mat: "t44mb_mat", position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), uv: new Float32Array([.1, .1, .9, .1, .1, .9]) };
      const L = LayerNode.of({ type: "paint", name: "Wear", canvas: cv(), opacity: 1, blend: "normal", visible: true });
      const shot = () => { const ov = document.getElementById("modalHost").lastElementChild, h = ov.innerHTML; ov.querySelector(".x").click(); return h; };
      try {
        Bake.run = () => new Promise(() => {});
        App.slots.set(s.id, s); s.layers.push(L); App.activeSlot = s; App.activeLayer = L;
        App.body = "exterior"; App.vehicleKey = null; App.objName = null; App.bodies = {};
        App.geomData = [tri]; App.matSlot = new Map([["t44mb_mat", "t44mb"]]);
        MaskBake.open(s, L);
        const masks = shot();
        App.bodies = { cockpit: Cockpit.fresh({ geomData: null, objName: "t44mb_cockpit" }) };
        App.matSlot = new Map([["t44mb_mat", "t44mb_elsewhere"]]);
        MaskBake.open(s, L);
        return masks + "|" + shot();
      } finally {
        Bake.run = keep.run; App.slots.delete(s.id);
        Object.assign(App, { activeSlot: keep.slot, activeLayer: keep.layer, geomData: keep.geom, matSlot: keep.matSlot, bodies: keep.bodies,
                             body: keep.body, vehicleKey: keep.key, objName: keep.obj });
      }` },

  // The History window (ROADMAP 4.50 (15)), captured when it was added: one of everything a row can
  // be — a named Start, a step with no cost, costs in KB and MB, a checkpoint on a held step and one
  // on an undone step, the current state, and two undone steps. t97 owns what a click does; this
  // owns what the window shows.
  { id: "history-window", min: 1500,
    what: "history window: a named Start, costs in KB and MB, two checkpoints, the current state and two undone steps",
    src: `
      const nop = () => {};
      try {
        // Open: the window keeps rows only while it is shown, since they hold their steps (review
        // of 4.50 (15), 2026-09-27). Opening it changes nothing inside #secHistory but the rows.
        TopWin.show("winHistory");
        UndoHistory.clear();
        UndoHistory.mark("as loaded");
        pushAction("color stroke", nop, nop, 2 * 1048576);
        pushAction("add layer", nop, nop, 0);
        pushAction("fill path", nop, nop, 700 * 1024);
        UndoHistory.mark("before weathering");
        pushAction("move decal", nop, nop, 12);
        pushAction("wear stroke", nop, nop, 30 * 1048576);
        UndoHistory.mark("weathered");
        doUndo(true); doUndo(true);
        HistoryUI.render();
        return document.getElementById("secHistory").innerHTML;
      } finally { TopWin.close(); UndoHistory.clear(); }` },

  // panel is exercised against that — the stubs are put back afterwards so later cases see the
  // real ones. Top-level `function` declarations are writable properties of the global object in a
  // classic script, which is what makes the swap possible at all.
  // The weapons panel reads a real unit's armament out of aces.vromfs.bin. The armament READER is
  // already covered over the whole roster by t12/t14/t26; what is not covered anywhere is the
  // markup this panel builds from it. So the reader is stubbed with a hand-built `arm` and the
  // panel is exercised against that — the stubs are put back afterwards so later cases see the
  // real ones. Top-level `function` declarations are writable properties of the global object in a
  // classic script, which is what makes the swap possible at all.
  //
  // Two cases, because the panel is a BUILDER since 2026-09-02: one with nothing built (every
  // station empty, every list folded) and one mid-build (a station filled from a game preset,
  // another changed by hand, its preset list open). The second is the one that would notice a
  // regression in the thing that was actually added.
  ...["empty", "built"].map(kind => ({
    id: "weapons-" + kind,
    what: kind === "empty"
      ? "weapons panel: the builder with every station empty"
      : "weapons panel: a build filled from a game preset, one station changed by hand and open",
    src: `
      const keep = { armamentForCurrentUnit, loadoutStations };
      const keepExtracted = App.extracted;
      try {
        // Stores the shape resolveStore builds them: a payload with its blk mass, under a rack
        // with that many emitter nodes when there are several — so the real storeCount,
        // storePayload, storeModels and PresetInfo.tally run over them (stubbing those hid the
        // Ammo/Mass line and the trigger headings the panel prints since 2026-09-21).
        const store = (path, count, models, mass, trig) => {
          const pay = { path, kind: /rockets|aim/.test(path) ? "rocket" : /tanks/.test(path) ? "gun" : "bomb",
            mesh: models.slice(-1), nodes: [], mass: mass || null, child: null };
          if (count === 1 && models.length === 1) return pay;
          return { path: "containers/" + models[0] + ".blk", kind: "rack", mesh: models.slice(0, 1),
            nodes: Array.from({ length: count }, (_, i) => "n" + i), mass: null, child: pay };
        };
        const arm = {
          path: "gamedata/flightmodels/fake_unit.blk", maxload: 4200,
          loadouts: [
            { name: "fake_default", blk: "a.blk", assign: [{ slot: 0, preset: "2 x mk_82" }] },
            { name: "fake_heavy",   blk: "b.blk", assign: [{ slot: 0, preset: "2 x mk_82" }, { slot: 1, preset: "internal gun" }] },
            { name: "fake_internal",blk: "c.blk", assign: [{ slot: 1, preset: "internal gun" }] },
          ],
          // Three hardpoints in the game's own listing order — port outer, starboard outer,
          // centreline (WeaponSlot.order alternates wings, 1-based) — plus the fixed gun. The row
          // (ROADMAP 4.38) must lay them out by where their node IS, right wing on the LEFT.
          slots: [
            { index: 0, tier: 1, order: 1, presets: [
              { name: "2 x mk_82", req: "", weapons: [{ blk: "bombs/mk_82.blk", node: "pylon_l", trigger: "bombs", store: store("bombs/mk_82.blk", 2, ["ter", "mk_82"], 227) }] },
              { name: "aim9l",     req: "sidewinder_mod", weapons: [{ blk: "rockets/aim9l.blk", node: "pylon_l", trigger: "aam", store: store("rockets/aim9l.blk", 1, ["aim9l"], 85.3) }] },
            ] },
            { index: 2, tier: 1, order: 2, presets: [
              { name: "2 x mk_82", req: "", weapons: [{ blk: "bombs/mk_82.blk", node: "pylon_r", trigger: "bombs", store: store("bombs/mk_82.blk", 2, ["ter", "mk_82"], 227) }] },
            ] },
            { index: 3, tier: 2, order: 3, presets: [
              { name: "tank", req: "", weapons: [{ blk: "tanks/big.blk", node: "pylon_c", trigger: "fuel tanks", store: store("tanks/big.blk", 1, ["big_tank"]) }] },
            ] },
            { index: 1, tier: null, order: null, presets: [
              { name: "internal gun", req: "", weapons: [{ blk: "guns/m61.blk", node: "", trigger: "cannon", store: { path: "guns/m61.blk", kind: "gun", mesh: [], nodes: [], mass: 112, child: null } }] },
            ] },
          ],
        };
        // A skeleton the way the file stores it: tz is NEGATED (wt-geometry), so +2 here is the
        // port side (scene z −2) and −2 the starboard side. Only column 3 of row 2 is read.
        const wtm = tz => [[1,0,0,0],[0,1,0,0],[0,0,1,tz],[0,0,0,1]];
        App.extracted = { geo: { skeleton: new Map([["pylon_l", wtm(2)], ["pylon_r", wtm(-2)], ["pylon_c", wtm(0)]]) } };
        armamentForCurrentUnit = () => ({ unit: "fake_unit", arm });
        loadoutStations = (a, lo) => [];

        App.gameDir = { name: "fake" };
        App.weaponPreset = "fake_heavy";
        App.showWeapons = true; App.showPylons = false;
        App.weaponsLoaded = new Map([
          ["mk_82 #1", { kind: "store", path: "bombs/mk_82.blk", placed: true, parts: [] }],
          ["mer #1",   { kind: "rack",  path: "containers/mer.blk", placed: false, parts: [] }],
        ]);
        App.meshes = App.meshes || new Map();
        ArmBuild.unit = null; ArmBuild.saved = []; ArmBuild.naming = false; ArmBuild.nameDraft = "";
        ArmBuild.ensure("fake_unit");
        ${kind === "built" ? `
        ArmBuild.fromLoadout(arm, "fake_unit", arm.loadouts[1]);
        ArmBuild.set(0, "aim9l");
        ArmBuild.set(3, "tank");
        ArmBuild.open.add(0);
        ArmBuild.saved = [{ name: "my strike load", unit: "fake_unit", assign: [{ slot: 0, preset: "aim9l" }] }];
        ` : `ArmBuild.clear(); ArmBuild.open.clear();`}
        refreshWeaponPanel();
        return document.getElementById("weaponList").innerHTML;
      } finally { Object.assign(globalThis, keep); App.extracted = keepExtracted; ArmBuild.unit = null; ArmBuild.saved = []; ArmBuild.open.clear(); ArmBuild.sel.clear(); }` })),

  // ---- the moving-parts panel (ROADMAP 4.1) ----
  // Three of pose.js's functions are on 2.4's list — applyPose, buildHingeRig and refreshPosePanel
  // — and nothing has ever looked at what this panel DRAWS. §4's rule is that a panel refactor is
  // gated by a fixture captured first, so here it is, in the two shapes it takes: a tank posed from
  // its own datasheet (the travel is the vehicle's, the depression follows the hull) and a model
  // with no skeleton at all, which is the sentence an imported .obj gets.
  ...["tank", "bare"].map(kind => ({
    id: "pose-" + kind,
    min: kind === "tank" ? 400 : 100,
    what: kind === "tank"
      ? "moving parts: a tank's turret and gun, ranged by its own datasheet"
      : "moving parts: a model with no skeleton says why there is nothing to move",
    src: `
      const keepExtracted = App.extracted, keepGeom = App.geomData, keepMeshes = App.meshes;
      const keepKind = App.modelKind, keepRig = App._poseRig, keepFor = App._poseRigFor, keepPose = App.pose;
      const keepUnits = App.skinUnits, keepKey = App.vehicleKey, keepMat = App.matSlot;
      try {
        App.modelKind = "tank";
        App.pose = {};
        App._poseRig = null; App._poseRigFor = null;
        if (${JSON.stringify(kind)} === "bare") {
          App.geomData = [{ name: "hull", mat: "m", position: new Float32Array(9), normal: new Float32Array(9), uv: new Float32Array(6) }];
          App.extracted = null;
          App.meshes = new Map();
        } else {
          const node = (name, o) => ({ name, wtm: [[1,0,0,o[0]],[0,1,0,o[1]],[0,0,1,o[2]]], children: [], parent: -1 });
          const nodes = [node("bone_root",[0,0,0]), node("bone_turret",[0,1,0]), node("bone_gun",[.6,1.2,0]), node("bone_gun_barrel",[1.2,1.2,0])];
          nodes[0].children = [1]; nodes[1].parent = 0;
          nodes[1].children = [2]; nodes[2].parent = 1;
          nodes[2].children = [3]; nodes[3].parent = 2;
          const byName = new Map(); nodes.forEach(n => byName.set(n.name, n));
          const tri = (name, at) => {
            const S = .2, pts = [[at[0]+S,at[1],at[2]],[at[0]-S/2,at[1]+S,at[2]+S],[at[0]-S/2,at[1]-S,at[2]-S]];
            const pos = []; pts.forEach(p => pos.push(p[0], p[1], -p[2]));
            return { name, mat: "m", position: new Float32Array(pos), normal: new Float32Array([0,1,0,0,1,0,0,1,0]), uv: new Float32Array(6) };
          };
          App.geomData = [tri("bone_root",[0,0,0]), tri("bone_turret",[0,1,0]), tri("bone_gun",[.6,1.2,0]), tri("bone_gun_barrel",[1.2,1.2,0])];
          App.extracted = { geo: { skeleton: { nodes, byName }, a2d: null } };
          App.meshes = new Map(App.geomData.map(g => [g.name, { visible: true, userData: { mat: "m" } }]));
          App.matSlot = new Map([["m", "t44p"]]);
          App.vehicleKey = "t44_tank";
          App.skinUnits = [];
          TankData.cache.set("t44_tank", TankRig.main([{ turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" },
            limits: { yaw: [-180, 180], pitch: [-10, 20] },
            limitsTable: { lim1: [-180, -133, 2, 20], lim2: [-133, 133, -10, 20], lim3: [133, 180, 2, 20] } }]));
        }
        refreshPosePanel();
        return document.getElementById("poseList").innerHTML;
      } finally {
        App.extracted = keepExtracted; App.geomData = keepGeom; App.meshes = keepMeshes;
        App.modelKind = keepKind; App._poseRig = keepRig; App._poseRigFor = keepFor; App.pose = keepPose;
        App.skinUnits = keepUnits; App.vehicleKey = keepKey; App.matSlot = keepMat;
        TankData.cache.delete("t44_tank");
      }`,
  })),
];

const BODY = `async function(){
  const out = {};
  ${CASES.map(c => `try { out[${JSON.stringify(c.id)}] = (function(){ ${c.src} })(); }
    catch (e) { out[${JSON.stringify(c.id)}] = "THREW: " + ((e && e.stack) || e); }`).join("\n  ")}
  return { out };
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 500), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
if (run.result.__threw) { console.log("FAIL: the page threw\n" + run.result.__threw); process.exit(1); }

const got = run.result.out || {};
const sha = s => crypto.createHash("sha256").update(s, "utf8").digest("hex");

if (DUMP) {
  if (!(DUMP in got)) { console.log("no such case. Cases: " + CASES.map(c => c.id).join(", ")); process.exit(1); }
  console.log(got[DUMP]);
  process.exit(0);
}

if (UPDATE) {
  const next = { note: "Markup of the sidebar panels, hashed. A change here is a change the user sees. " +
    "Regenerate with: node tools/t44_panels.mjs --update, then READ THE DIFF — it is the only place the change is visible.", cases: {} };
  for (const c of CASES) next.cases[c.id] = { what: c.what, chars: (got[c.id] || "").length, sha256: sha(got[c.id] || "") };
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(next, null, 2) + "\n");
  console.log("wrote " + path.relative(ROOT, GOLDEN).replace(/\\/g, "/"));
  for (const c of CASES) console.log(`  ${c.id.padEnd(18)} ${String(next.cases[c.id].chars).padStart(6)} chars  ${next.cases[c.id].sha256.slice(0, 16)}`);
  process.exit(0);
}

if (!fs.existsSync(GOLDEN)) { console.log("FAIL: no fixture. Create it with: node tools/t44_panels.mjs --update"); process.exit(1); }
const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const R = makeReport();

console.log("=== the panels render what they rendered before ===");
for (const c of CASES) {
  const html = got[c.id];
  if (typeof html !== "string" || html.startsWith("THREW:")) { R.is(false, `${c.id}: the panel threw — ${String(html).slice(0, 200)}`); continue; }
  const g = golden.cases[c.id];
  if (!g) { R.is(false, `${c.id}: not in the fixture — run --update if this case is new`); continue; }
  const h = sha(html);
  R.is(h === g.sha256, h === g.sha256
    ? `${c.id}: unchanged (${html.length} chars) — ${c.what}`
    : `${c.id}: MARKUP CHANGED — ${html.length} chars now, ${g.chars} in the fixture.\n` +
      `         If that was intended: node tools/t44_panels.mjs --update, and read the diff.`);
}

// The panel must actually have built something, or a hash of "" would pass forever. The floor is
// per case: 2000 chars is right for a parts or weapons panel and wrong for a one-layer stack, and a
// threshold that some cases cannot meet is one that gets deleted rather than tightened.
for (const c of CASES) if (c.min !== 0 && typeof got[c.id] === "string")
  R.is(got[c.id].length > (c.min || 2000),
    `${c.id}: the panel really rendered (${got[c.id].length} chars, over its ${c.min || 2000} floor)`);

R.finish();
