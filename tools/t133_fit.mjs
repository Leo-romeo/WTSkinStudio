// Every control fits: the top bar and the 3-D view's bar on one line on a laptop, every layer and
// brush control inside its 230 / 250 px column, and the brush panel saying what it means.
//
// WHY THIS EXISTS. A review on 2026-10-10, in real Chrome at real window sizes, found controls the
// user could not see or could not read, and none of the suite noticed — `t44_panels` hashes what a
// panel CONTAINS and `t31_boot` that its elements exist, and a button 110 px past the edge of its
// column is in both. Measured that day:
//
//   * at the default sidebar width the layer panel's Mask row had "model…" (which holds From the
//     cockpit) and "clip ↓" entirely outside the column, "layer…" cut 14 px, "+ white" / "+ black"
//     broken onto two lines inside their buttons; the Layers header cut "Group" 37 px; and the
//     Texture slots header was two lines at every size. Writing this test found three more: a mask's
//     own row cut "✕ mask" 67 px, a masked layer's or a group's row squeezed its NAME to nothing
//     while its tag ran past the edge, and the radial row broke "Set centre…" over two lines;
//   * the top bar needed 1 445 px for one row (1 516 at its widest), so at 1366 and 1280 it wrapped
//     and pushed the work area down from 48 to 87 px; the 3-D view's bar wrapped over the model in
//     Split — two lines at 1366 and 1280, three at 960 — because a <select> is as wide as its
//     longest option;
//   * "Select a texture slot first" sat 337 px below the greyed tools it explained; the Color tool
//     was active AND disabled, a 45 % accent fill that read as neither; the tip preview's round tip
//     filled its box, so only four white corners showed; and on an aircraft the Wear mask button
//     vanished and six tools moved up a cell;
//   * the Weapons tab said "max load 7257 kg" above "Mass: 0 / 7 257 kg", named the vehicle by its
//     unit id, broke "f-4e" at its hyphen, and four of its buttons were lowercase beside "Reset".
// The review of the first fix found two more, the same day: sized to its text, the channel view
// wrapped the 3-D bar again whenever it showed more than "Shaded" (Auto, a saved preference, and every
// byte view, at 1366 and 1280); and a path made unbreakable to keep "f-4e" whole ran a long one out of
// the column — 38 of the install's 1 568 flying units' lines cut, where the build before cut 34.
//
// So this measures, at the page a maximised window gives on 2560 x 1440, 1920 x 1080, 1366 x 768 and
// 1280 x 720 screens (and 960 x 1040 for the view bar) — the screen less Chrome's frame and the
// taskbar, about 128 px, as the review's screenshots were taken:
//   * the top bar is one row at every one of the four, in its widest state (a vehicle ticked and its
//     name unlocked: field and pencil both up) — and at sixteen widths from 1280 to 1800, either
//     side of each of the stylesheet's two steps — and wraps to no more than two rows at 960;
//   * the 3-D view's bar is one line in Split at all four, with the channel view on every one of its
//     options, and no more than two at 960; the 2-D view's is one line at all four; the channel view's
//     text is whole at 2560 and 1920, and at 1280 for Shaded and the four maps;
//   * the page never scrolls sideways;
//   * every layer kind's panel — paint, masked, clipped, fill (colour, value, gradient, noise,
//     pattern), effect, group, a layer on three channels — has no control cut by its column and no
//     button broken inside itself, every row of the stack shows its name, and the Layers buttons
//     (Group or Ungroup) and the Slots header are one line — measured with the column's scrollbar
//     up, the narrowest it gets (203 px);
//   * every brush tool's panel the same, in the 250 px column (223 px inside its scrollbar), with
//     every fold open and the radial row up;
//   * the brush hint sits under the tool grid and above the Painting switch; a tool that is selected
//     but unavailable looks like the other unavailable ones (with the accent border saying which);
//     the tip preview is the tip on a clear ground; the tool grid stands still between a tank and an
//     aircraft, and the Wear mask says why it is off rather than leaving;
//   * the weapons line keeps a hyphenated name whole wherever it fits and never runs past the column —
//     for the F-4E, a long hyphenated id and a long underscore one — names the vehicle, prints the max
//     load the way the Mass line does, and no button in the Vehicle or Weapons tab is lowercase.
//
// Synthetic data, so it needs no install.
//
// Usage: node tools/t133_fit.mjs [--chrome <path>] [--page <built.html>]
//   --page runs it against another build — how each check was seen to fail on the build before the fix.
import fs from "fs";
import { findBrowser, evalInPage, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const html = argv.includes("--page") ? fs.readFileSync(argv[argv.indexOf("--page") + 1], "utf8") : undefined;

// [page width, page height, the screen it is a maximised window on]
const SIZES = [[2560, 1312, "2560 x 1440"], [1920, 952, "1920 x 1080"], [1366, 640, "1366 x 768"], [1280, 592, "1280 x 720"]];
const NARROW = [960, 912, "960 x 1040"];

// Page-side helpers. Written as a function so it reads as code; it runs in the page, not here.
function helpers(){
  const $ = id => document.getElementById(id);
  const vis = el => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
  const name = el => el.id ? "#" + el.id : el.tagName.toLowerCase() + ' "' + (el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 24) + '"';
  // How many rows a flex container's visible children sit in: a child starts a new row when its top
  // is at or below the bottom of everything in the row before it.
  const rows = el => {
    const rs = [...el.children].filter(vis).map(c => c.getBoundingClientRect()).filter(r => r.width > 0).sort((a, b) => a.top - b.top);
    let n = 0, bottom = -1e9;
    for (const r of rs) { if (r.top >= bottom - 1) { n++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom); }
    return n;
  };
  // Every control in `root` that the user cannot fully see or read: outside the nearest ancestor
  // that clips (the column), or a button whose label has broken onto a second line inside it.
  const cut = root => {
    const out = [];
    for (const el of root.querySelectorAll("button, select, input, label, canvas")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      let p = el.parentElement;
      for (; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") break;
      const c = p && p !== document.body ? p.getBoundingClientRect() : { left: 0, right: innerWidth };
      const over = Math.max(r.right - c.right, c.left - r.left);
      if (over > 0.5) { out.push(name(el) + " cut " + Math.round(over) + " px"); continue; }
      if (el.tagName === "BUTTON") {
        const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
        const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        if (inner > lh * 1.5) out.push(name(el) + " on " + Math.round(inner / lh) + " lines");
      }
    }
    return out;
  };
  const N = 32;
  const cv = hex => { const c = mkCanvas(N, N); const g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  const paint = (nm, o) => LayerNode.of(Object.assign({ type: "paint", name: nm, canvas: cv("#00000000"), opacity: 1, blend: "normal", visible: true }, o || {}));
  const fillL = (nm, o) => LayerNode.of(Object.assign({ type: "fill", name: nm, color: "#3a5f2a", opacity: 1, blend: "normal", visible: true }, o || {}));
  const grp = (nm, kids, o) => Object.assign({ type: "group", name: nm, children: kids, visible: true, opacity: 1,
    blend: "normal", mask: null, parts: null, collapsed: false }, o || {});
  const slot = () => {
    const s = { id: "fit_c", cStem: "fit_c", nStem: "fit_n", size: N, nSize: N, missing: false, layers: [] };
    s.baseC = cv("#202020"); s.composite = mkCanvas(N, N);
    s.smooth = cv("#101010"); s.metal = cv("#000000"); s.normal = cv("#808080");
    App.slots = new Map([["fit_c", s]]); App.activeSlot = s;
    return s;
  };
  // Every shape the layer panel takes. Each returns the layer to select; the stack is the slot's.
  const fx = f => s => { s.layers = [fillL("Base"), LayerNode.of({ type: "adjust", name: "Effect", opacity: 1, blend: "normal", visible: true,
    hue: 0, sat: 100, bright: 100, contrast: 100, fx: f })]; return s.layers[1]; };
  const KINDS = {
    "paint": s => (s.layers = [paint("Layer 1")])[0],
    "paint, masked": s => (s.layers = [fillL("Base"), paint("Badge", { mask: cv("#c0c0c0"), opacity: .65, blend: "multiply" })])[1],
    "paint, clipped": s => { s.layers = [paint("Under"), paint("Over")]; s.layers[1].maskRef = LayerNode.BELOW; return s.layers[1]; },
    "fill, colour": s => (s.layers = [fillL("Base")])[0],
    "fill, smoothness value": s => (s.layers = [fillL("Gloss", { chan: "smooth", color: "#b4b4b4" })])[0],
    "fill, gradient": s => (s.layers = [fillL("Fade", { grad: { shape: "linear", space: "uv", angle: 30, dir: [1, 0, 0], from: .1, to: .9, repeat: "reflect",
      stops: [{ t: 0, color: "#203040", alpha: 1 }, { t: .5, color: "#a0b0c0", alpha: .5 }, { t: 1, color: "#ffffff", alpha: 0 }] } })])[0],
    "fill, noise": s => (s.layers = [fillL("Grime", { grad: { shape: "noise", space: "model", angle: 0, dir: [1, 0, 0], from: .35, to: .65, repeat: "clamp",
      stops: [{ t: 0, color: "#3a3020", alpha: 0 }, { t: 1, color: "#3a3020", alpha: .8 }],
      noise: { type: "perlin", seed: 42, scale: .25, octaves: 5, rough: .55, stretch: 8 } } })])[0],
    "fill, pattern": s => (s.layers = [fillL("Splinter", { color: "#8a6a3a", pat: { space: "uv", repeat: 6, size: 1, angle: 30, x: .25, y: .5, sharp: 4 },
      patImg: cv("#8a6a3a"), patName: "splinter_tile.png" })])[0],
    "effect, hue": s => (s.layers = [fillL("Base"), LayerNode.of({ type: "adjust", name: "Warm", hue: 8, sat: 110, bright: 100, contrast: 105, opacity: 1, blend: "normal", visible: true })])[1],
    "effect, levels": fx({ type: "levels", rgb: { inLo: 12, inHi: 240, gamma: 1.25, outLo: 0, outHi: 255 } }),
    "effect, curves": fx({ type: "curves", rgb: [[0, 0], [64, 48], [192, 210], [255, 255]] }),
    "effect, balance": fx({ type: "balance", shadows: [0, 0, 0], mids: [20, -15, 5], highs: [0, 0, -30], keepLum: true }),
    "effect, gradient map": fx({ type: "gradmap", stops: [{ t: 0, color: "#1a2b3c", alpha: 1 }, { t: 1, color: "#f0f0d0", alpha: 1 }] }),
    "group": s => (s.layers = [fillL("Base"), grp("Markings", [paint("A"), paint("B", { chan: "smooth" })], { opacity: .8, blend: "multiply" })])[1],
    "three channels": s => {
      const m = paint("Squadron badge");
      LayerNode.addContent(m, "smooth", LayerNode.content("fill", { color: "#b4b4b4" }));
      LayerNode.addContent(m, "metal", LayerNode.content("effect", { hue: 0, sat: 100, bright: 120, contrast: 90 }));
      s.layers = [fillL("Base"), m]; return m;
    },
  };
  window.__fit = {
    rows, cut,
    page: () => ({ w: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }),
    top: () => ({ rows: rows($("topbar")), main: Math.round($("main").getBoundingClientRect().top), title: vis(document.querySelector("#topbar .title")) }),
    // The widest the top bar gets: a vehicle ticked under Installs onto, and its name unlocked to be
    // typed — the 160 px field AND the pencil, which are never both up otherwise.
    widest(){
      App.skinUnits = [{ on: true, unit: { id: "us_m1a2_sep3_abrams", name: "M1A2 SEPv3", cls: "tank", country: "" } }];
      $("vehicleId").value = "us_m1a2_sep3_abrams";
      vehicleIdUnlocked = true; refreshVehicleIdLock();
      return [$("vehicleId").offsetParent !== null, $("btnVehicleIdEdit").offsetParent !== null];
    },
    // The bars, and the 3-D one again with the channel view on each of its options: sized to its text,
    // the select widened the bar back onto two lines in Split at 1366 and 1280 whenever it showed
    // anything longer than "Shaded" — and "Auto — follow the layer" is a saved preference, so that
    // was every session for whoever keeps it on (review of the fix, 2026-10-10). `nat` is what the
    // option's text needs, so a select narrower than it is one showing its text cut short.
    views(){
      const b3 = document.querySelector("#view3dwrap .viewbtns"), b2 = document.querySelector("#view2dwrap .viewbtns");
      const s = $("chanViewSel"), was = s.value, opts = [];
      for (const o of s.options) {
        s.value = o.value;
        const lines = rows(b3), w = s.getBoundingClientRect().width;
        s.style.flex = "none"; s.style.maxWidth = "none";
        const nat = s.getBoundingClientRect().width;
        s.style.flex = s.style.maxWidth = "";
        opts.push({ v: o.value, lines, w: Math.round(w), nat: Math.round(nat) });
      }
      s.value = was;
      return { v3: rows(b3), v2: rows(b2), cam: Math.round($("camPreset").getBoundingClientRect().width), chan: Math.round(s.getBoundingClientRect().width), opts };
    },
    kinds: () => Object.keys(KINDS),
    // One layer kind in the panel; what is cut, and the two headers' heights against a one-line one.
    layer(k){
      document.querySelector("[data-tab=paint]").click();
      const s = slot();
      App.selParts = new Set(); App.chanAuto = false; App.brush.mode = "color";
      App.activeLayer = KINDS[k](s);
      refreshLayerList();
      // With its scrollbar, the narrowest the column's content gets (203 px): a stack of any length,
      // or the Channels section open, gives it one, and a fit that only holds without it does not hold.
      const pane = $("leftPane"), keep = pane.style.overflowY;
      pane.style.overflowY = "scroll";
      const one = $("secChannels").querySelector("h3").getBoundingClientRect().height;
      const slotsH = $("btnPasteTex").closest("h3").getBoundingClientRect().height;
      const lay = $("layerList").closest(".section");
      const head = ["btnNewLayer", "btnAddDecal", "btnAddText", "btnGroupLayer"].map(id => $(id));
      // and every row of the stack: nothing in it past its edge, and its name on screen — whole, or
      // 40 px of it at the least
      const rowCut = [];
      for (const row of $("layerList").querySelectorAll(".rowitem.layer")) {
        const rr = row.getBoundingClientRect(), nm = row.querySelector(".nm");
        const past = [...row.children].filter(c => vis(c) && c.getBoundingClientRect().width > 0 && c.getBoundingClientRect().right > rr.right + 0.5);
        if (past.length) rowCut.push("row “" + nm.textContent + "”: " + past.map(c => c.className || c.tagName).join(", ") + " past its edge");
        if (nm.clientWidth < Math.min(nm.scrollWidth, 40)) rowCut.push("row “" + nm.textContent + "”: its name " + nm.clientWidth + " px of " + nm.scrollWidth);
      }
      const out = { cut: cut($("tabPaint")).concat(rowCut), one: Math.round(one), slotsH: Math.round(slotsH),
        headRows: new Set(head.map(b => Math.round(b.getBoundingClientRect().top))).size, w: Math.round(lay.getBoundingClientRect().width) - 20 };
      pane.style.overflowY = keep;
      return out;
    },
    // One brush tool; what is cut in the Brush section, every fold open and a radial copy count set,
    // so the rows that only appear for some tools and settings are all on screen at some point.
    brush(m){
      const s = slot();
      s.layers = [paint("Layer 1")]; App.activeLayer = s.layers[0];
      App.geomData = null; App.skinUnits = [];
      refreshLayerList();
      applyBrushMode(m, true);
      const sec = $("brushModes").closest(".section");
      sec.querySelectorAll("details").forEach(d => d.open = true);
      $("radialRow2").style.display = "";
      const pane = $("rightPane"), keep = pane.style.overflowY;
      pane.style.overflowY = "scroll";
      const out = { mode: App.brush.mode, cut: cut(sec), w: Math.round(sec.getBoundingClientRect().width) - 20 };
      pane.style.overflowY = keep;
      sec.querySelectorAll("details").forEach(d => d.open = false);
      $("radialRow2").style.display = "none";
      return out;
    },
    modes: () => [...document.querySelectorAll("#brushModes [data-bm]")].map(b => b.dataset.bm),
    // Nothing loaded: where the hint is, and how the selected-but-unavailable tool is drawn.
    boot(){
      App.slots = new Map(); App.activeSlot = null; App.activeLayer = null; App.geomData = null; App.skinUnits = [];
      applyBrushMode("color", true);
      updateBrushAvailability();
      const grid = $("brushModes").getBoundingClientRect(), hint = $("brushHint"), h = hint.getBoundingClientRect();
      const on = $("brushPaintOn") || $("btnPaintOn");
      const col = document.querySelector('#brushModes [data-bm="color"]'), next = document.querySelector('#brushModes [data-bm="erase"]');
      const look = b => { const cs = getComputedStyle(b); return { bg: cs.backgroundColor, fg: cs.color, op: cs.opacity, border: cs.borderTopColor }; };
      return { hint: hint.offsetParent !== null ? hint.textContent : null, below: Math.round(h.top - grid.bottom), aboveSwitch: Math.round(on.getBoundingClientRect().top - h.bottom),
        color: { active: col.classList.contains("active"), disabled: col.disabled, look: look(col) }, next: { disabled: next.disabled, look: look(next) },
        accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() };
    },
    tip(){
      BrushPanel.setTip("round");
      const c = $("tipPreview"), d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = c.width;
      const at = (x, y) => [...d.slice((y * n + x) * 4, (y * n + x) * 4 + 4)];
      return { corners: [at(0, 0), at(n - 1, 0), at(0, n - 1), at(n - 1, n - 1)], mid: at(n >> 1, n >> 1) };
    },
    // Where every tool sits, and what it says, on a tank and then on an aircraft.
    grid(cls){
      const s = slot(); s.layers = [paint("Layer 1")]; App.activeLayer = s.layers[0];
      App.geomData = [{ name: "hull" }]; App.skinUnits = [{ on: true, unit: { cls } }];
      App.brush.mode = "color";
      updateBrushAvailability();
      const out = [...document.querySelectorAll("#brushModes [data-bm]")].map(b => {
        const r = b.getBoundingClientRect();
        return { m: b.dataset.bm, shown: b.offsetParent !== null, x: Math.round(r.left), y: Math.round(r.top), off: b.disabled, why: b.dataset.why || "" };
      });
      App.geomData = null; App.skinUnits = [];
      return out;
    },
    // The line above the loadout: the review's own numbers, for the F-4E at 1366 — and two units whose
    // file is longer than the line. Keeping "f-4e" whole by making the path one unbreakable span ran
    // "flightmodels/p-63c-5_kingcobra_animal_version.blk" 63 px past the column, where #leftPane cut
    // it off; over the install's 1 568 flying units that cut 38 lines where the build before cut 34,
    // the 34 being underscore ids with nowhere to break at all (review of the fix, 2026-10-10).
    weaponInfo(){
      document.querySelector("[data-tab=weapons]").click();
      const el = $("weaponInfo"), keepUnits = GameUnits.byId, keepW = el.style.width;
      const out = [];
      for (const [id, name] of [["f-4e", "F-4E Phantom II"], ["p-63c-5_kingcobra_animal_version", null], ["f_16am_block_20_mlu_netherlands", null]]) {
        GameUnits.byId = new Map(name ? [[id, { id, name, cls: "air" }]] : []);
        try {
          const arm = { path: "gamedata/flightmodels/" + id + ".blk", maxload: 7257, loadouts: new Array(26).fill(null), slots: new Array(12).fill(null) };
          WeaponsPanel.info(id, arm);
        } finally { GameUnits.byId = keepUnits; }
        // Every word with a hyphen in it, measured where it lies: all of it on one line whenever it is
        // narrower than the line — at every width the line can have, 150 to 230 px, because where it
        // breaks depends on whether the column has a scrollbar, and the review's break ("f-" / "4e")
        // was at the width a loaded vehicle's tab gives — and NOTHING past the line's right edge.
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const tokens = [];
        for (let t = walk.nextNode(); t; t = walk.nextNode()) for (const m of t.data.matchAll(/[^\s,·()]*-[^\s,·()]*/g)) tokens.push([t, m.index, m[0]]);
        const rects = ([t, i, word]) => { const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + word.length); return [...rg.getClientRects()].filter(r => r.width > 0); };
        el.style.width = "4000px";
        const natural = tokens.map(k => rects(k).reduce((a, r) => a + r.width, 0));
        const broken = new Set(), past = [];
        let shown = 0;
        for (let w = 150; w <= 230; w++) {
          el.style.width = w + "px";
          const all = document.createRange(); all.selectNodeContents(el);
          const over = Math.max(...[...all.getClientRects()].map(r => r.right)) - el.getBoundingClientRect().right;
          if (over > 0.5) past.push(w + " px (" + Math.round(over) + " px past)");
          tokens.forEach((k, n) => {
            const rs = rects(k);
            if (rs.length) shown++;
            if (natural[n] <= w && new Set(rs.map(r => Math.round(r.top))).size > 1) broken.add(k[2] + " at " + w + " px");
          });
        }
        el.style.width = keepW;
        out.push({ id, text: el.textContent, tokens: tokens.map(x => x[2]), shown, broken: [...broken].slice(0, 4), past: past.slice(0, 2), pastN: past.length });
      }
      return { cases: out, kg: (7257).toLocaleString() };
    },
    // Every button label in the Vehicle and Weapons tabs, with the Weapons tab built as t44 builds it.
    labels(){
      const keep = { armamentForCurrentUnit, loadoutStations }, keepEx = App.extracted, keepDir = App.gameDir;
      try {
        const arm = { path: "gamedata/flightmodels/fake.blk", maxload: 4200,
          loadouts: [{ name: "fake_default", blk: "a.blk", assign: [{ slot: 0, preset: "tank" }] }],
          slots: [{ index: 0, tier: 1, order: 1, presets: [{ name: "tank", req: "", weapons: [{ blk: "tanks/big.blk", node: "pylon_c", trigger: "fuel tanks",
            store: { path: "tanks/big.blk", kind: "gun", mesh: ["big_tank"], nodes: [], mass: null, child: null } }] }] }] };
        App.extracted = { geo: { skeleton: new Map([["pylon_c", [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]]]) } };
        armamentForCurrentUnit = () => ({ unit: "fake", arm });
        loadoutStations = () => [];
        App.gameDir = { name: "fake" }; App.geomData = [{ name: "hull" }];
        App.weaponsLoaded = new Map([["big_tank #1", { kind: "store", path: "tanks/big.blk", placed: true, parts: [] }]]);
        ArmBuild.unit = null; ArmBuild.saved = [{ name: "mine", unit: "fake", assign: [{ slot: 0, preset: "tank" }] }];
        ArmBuild.ensure("fake"); ArmBuild.fromLoadout(arm, "fake", arm.loadouts[0]); ArmBuild.base = "mine";
        refreshWeaponPanel();
        const one = [...document.querySelectorAll("#tabVehicle button, #tabWeapons button")].map(b => b.textContent.trim()).filter(Boolean);
        ArmBuild.naming = true; refreshWeaponPanel();
        const two = [...document.querySelectorAll("#tabWeapons button")].map(b => b.textContent.trim()).filter(Boolean);
        ArmBuild.naming = false;
        return [...new Set(one.concat(two))];
      } finally {
        Object.assign(globalThis, keep); App.extracted = keepEx; App.gameDir = keepDir; App.geomData = null;
        App.weaponsLoaded = new Map(); ArmBuild.unit = null; ArmBuild.saved = []; ArmBuild.base = null; ArmBuild.open.clear();
        refreshWeaponPanel();
      }
    },
  };
  return true;
}

const run = await evalInPage({ browser, html, expr: "1", timeoutMs: 240000, drive: async ({ cdp, evaluate }) => {
  const wait = ms => evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
  await evaluate(`new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", () => r()))`);
  await wait(400);
  await evaluate(`(${helpers.toString()})()`);
  const size = async (w, h) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))))`);
  };
  const o = { sizes: {} };
  o.kinds = await evaluate("__fit.kinds()");
  o.modes = await evaluate("__fit.modes()");
  for (const [w, h, label] of [...SIZES, NARROW]) {
    await size(w, h);
    const z = o.sizes[label] = { page: [await evaluate("__fit.page()")] };
    z.top = await evaluate("__fit.top()");
    z.views = await evaluate("__fit.views()");
    z.layers = {};
    for (const k of o.kinds) z.layers[k] = await evaluate(`__fit.layer(${JSON.stringify(k)})`);
    z.brush = {};
    for (const m of o.modes) z.brush[m] = await evaluate(`__fit.brush(${JSON.stringify(m)})`);
    z.page.push(await evaluate("__fit.page()"));
  }
  await size(1366, 640);
  o.boot = await evaluate("__fit.boot()");
  o.tip = await evaluate("__fit.tip()");
  o.tank = await evaluate("__fit.grid('tank')");
  o.air = await evaluate("__fit.grid('air')");
  o.weaponInfo = await evaluate("__fit.weaponInfo()");
  o.labels = await evaluate("__fit.labels()");
  o.widest = await evaluate("__fit.widest()");
  for (const [w, h, label] of [...SIZES, NARROW]) {
    await size(w, h);
    o.sizes[label].wide = await evaluate("__fit.top()");
    o.sizes[label].page.push(await evaluate("__fit.page()"));
  }
  // and every width in between, each side of the two steps the bar takes in the stylesheet: a step
  // put 10 px too low is a band of windows where it wraps that the four sizes above all miss
  o.sweep = [];
  for (const w of [1280, 1300, 1340, 1359, 1360, 1400, 1440, 1480, 1500, 1536, 1539, 1540, 1560, 1600, 1680, 1800]) {
    await size(w, 700);
    o.sweep.push([w, (await evaluate("__fit.top()")).rows]);
  }
  return o;
} });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const O = run.result;

console.log("=== the top bar: one row on a laptop ===");
R.is(O.widest[0] && O.widest[1], "the widest state is up: the vehicle name's field and its pencil both on screen");
for (const [, , label] of SIZES) {
  const z = O.sizes[label];
  R.is(z.top.rows === 1 && z.wide.rows === 1 && z.top.main === z.wide.main && z.top.main <= 50,
    `${label}: one row with nothing loaded and at its widest — the work area starts at ${z.top.main} / ${z.wide.main} px (${z.top.rows} / ${z.wide.rows} rows)`);
}
{
  const two = O.sweep.filter(([, n]) => n !== 1);
  R.is(!two.length, two.length ? `at its widest it wraps at ${two.map(([w, n]) => w + " px (" + n + " rows)").join(", ")}`
    : `and at its widest at every width between, either side of each step (${O.sweep.map(([w]) => w).join(", ")} px)`);
}
R.is(O.sizes["2560 x 1440"].top.title && O.sizes["1920 x 1080"].top.title,
  "the app's name is in the bar wherever there is room for it (2560, 1920)");
{
  const z = O.sizes[NARROW[2]];
  R.is(z.top.rows <= 2 && z.wide.rows <= 2, `${NARROW[2]}: it wraps, to no more than two rows (${z.top.rows} / ${z.wide.rows})`);
}

console.log("\n=== the view bars: one line in Split ===");
for (const [, , label] of SIZES) {
  const v = O.sizes[label].views, wrap = v.opts.filter(o => o.lines !== 1);
  R.is(v.v3 === 1 && v.v2 === 1 && !wrap.length, wrap.length
    ? `${label}: the 3-D view's bar wraps with the channel view on ${wrap.map(o => `${o.v} (${o.lines} lines, ${o.w} px)`).join(", ")}`
    : `${label}: the 3-D view's bar is ${v.v3} line with the channel view on any of its ${v.opts.length} options, the 2-D view's ${v.v2}`);
}
{
  const v = O.sizes[NARROW[2]].views, most = Math.max(v.v3, ...v.opts.map(o => o.lines));
  R.is(most <= 2, `${NARROW[2]}: the 3-D view's bar is no more than two lines on any channel view (${most})`);
}
const v1 = O.sizes["1920 x 1080"].views;
R.is(v1.cam <= 72 && v1.chan <= 80, `a view select is as wide as what it says, not its longest option ("View…" ${v1.cam} px, "Shaded" ${v1.chan} px)`);
// The channel view gives way only where the line has no room: whole at 2560 and 1920, and at 1280
// Shaded and the four maps whole — the longer byte views and Auto cut at what the line leaves.
for (const label of ["2560 x 1440", "1920 x 1080"]) {
  const cut = O.sizes[label].views.opts.filter(o => o.w < o.nat - 1);
  R.is(!cut.length, cut.length ? `${label}: the channel view is cut with room to spare: ${cut.map(o => `${o.v} ${o.w} of ${o.nat} px`).join(", ")}`
    : `${label}: every channel view's text whole (up to ${Math.max(...O.sizes[label].views.opts.map(o => o.nat))} px)`);
}
{
  const opts = O.sizes["1280 x 720"].views.opts, MAPS = ["shaded", "color", "smooth", "metal", "normal"];
  const cut = opts.filter(o => MAPS.includes(o.v) && o.w < o.nat - 1);
  R.is(!cut.length, cut.length ? `1280 x 720: ${cut.map(o => `${o.v} cut to ${o.w} of ${o.nat} px`).join(", ")}`
    : `1280 x 720: Shaded and the four maps whole; the rest given what the line leaves (${opts.filter(o => o.w < o.nat - 1).map(o => `${o.v} ${o.w}/${o.nat}`).join(", ")} px)`);
}

console.log("\n=== the page never scrolls sideways ===");
for (const [, , label] of [...SIZES, NARROW]) {
  const ps = O.sizes[label].page;
  R.is(ps.every(p => p.sw <= p.w && p.bw <= p.w), `${label}: ${ps.map(p => p.sw + "/" + p.w).join(", ")} px`);
}

console.log("\n=== every layer control is in the 230 px column ===");
for (const k of O.kinds) {
  const bad = [...SIZES, NARROW].map(([, , label]) => O.sizes[label].layers[k]).filter(x => x.cut.length);
  const one = O.sizes["1366 x 768"].layers[k];
  R.is(!bad.length, bad.length ? `${k}: ${bad[0].cut.join("; ")}` : `${k}: nothing cut and no button on two lines in a ${one.w} px column`);
}
const L1 = O.sizes["1366 x 768"].layers.paint, LG = O.sizes["1366 x 768"].layers.group;
R.is(L1.headRows === 1 && LG.headRows === 1,
  `the Layers buttons — + Layer, Img, Text and Group, or Ungroup with a group selected — are one line in the column with its scrollbar (${L1.headRows} / ${LG.headRows})`);
R.is(L1.slotsH <= L1.one + 1, `the Slots header is one line, as tall as the Channels header (${L1.slotsH} / ${L1.one} px)`);

console.log("\n=== every brush control is in the 250 px column ===");
for (const m of O.modes) {
  const bad = [...SIZES, NARROW].map(([, , label]) => O.sizes[label].brush[m]).filter(x => x.cut.length);
  R.is(!bad.length, bad.length ? `${m}: ${bad[0].cut.join("; ")}` : `${m}: nothing cut and no button on two lines in a ${O.sizes["1366 x 768"].brush[m].w} px column, every fold open`);
}

console.log("\n=== the brush panel says what it means ===");
const B = O.boot;
R.is(B.hint && B.below >= 0 && B.below <= 12 && B.aboveSwitch >= 0,
  `"${B.hint}" sits ${B.below} px under the tool grid it explains, above the Painting switch (${B.aboveSwitch} px)`);
R.is(B.color.active && B.color.disabled && B.next.disabled, "with nothing loaded Color is still the tool in hand, and unavailable like the rest");
R.is(B.color.look.bg === B.next.look.bg && B.color.look.fg === B.next.look.fg && B.color.look.op === B.next.look.op,
  `so it is drawn like the other unavailable tools, not as a 45 % "on" (${B.color.look.bg} / ${B.color.look.fg} at ${B.color.look.op}, Eraser ${B.next.look.bg} / ${B.next.look.fg} at ${B.next.look.op})`);
R.is(B.color.look.border !== B.next.look.border, `with its border saying it is the one selected (${B.color.look.border}, Eraser ${B.next.look.border})`);
const T = O.tip;
R.is(T.corners.every(c => c[3] === 0) && T.mid[3] >= 200 && T.mid[0] >= 180,
  `the tip preview is the tip on a clear ground: corners ${T.corners.map(c => c[3]).join("/")} alpha, middle rgba(${T.mid.join(",")})`);
const moved = O.tank.filter((t, i) => t.x !== O.air[i].x || t.y !== O.air[i].y || t.shown !== O.air[i].shown).map(t => t.m);
R.is(!moved.length, moved.length ? `the tool grid moves between a tank and an aircraft: ${moved.join(", ")}` : "the tool grid stands still between a tank and an aircraft — every tool in its cell");
const wearT = O.tank.find(t => t.m === "wear"), wearA = O.air.find(t => t.m === "wear");
R.is(!wearT.off && wearA.shown && wearA.off && /aircraft|ground|naval/i.test(wearA.why),
  `on the tank the Wear mask is on; on the aircraft it is off and says why ("${wearA.why}")`);

console.log("\n=== the Weapons tab ===");
const W = O.weaponInfo.cases[0], kg = O.weaponInfo.kg;
for (const c of O.weaponInfo.cases) {
  R.is(!c.pastN && !c.broken.length && c.shown === c.tokens.length * 81 && (c !== W || c.tokens.length >= 2), c.pastN
    ? `${c.id}: the line above the loadout runs past the column at ${c.pastN} of 81 widths — ${c.past.join(", ")}`
    : `${c.id}: the line above the loadout stays in the column at every width from 150 to 230 px` +
      (c.broken.length ? `, but a hyphenated word that fits breaks: ${c.broken.join(", ")}` : c.tokens.length
        ? `, every hyphenated word whole wherever it fits (${c.tokens.join(", ")})` : " — no hyphen, so the path breaks where it must"));
}
R.is(/F-4E Phantom II/.test(W.text), `it names the vehicle, not its unit id ("${W.text}")`);
R.is(W.text.replace(/\s/g, " ").includes((kg + " kg").replace(/\s/g, " ")) &&!/\b7257\b/.test(W.text), `and prints the max load the way the Mass line does (${kg} kg)`);
const LOW = ["reset", "unload", "look", "save as…", "cancel", "save", "delete", "edit alone"];
const low = O.labels.filter(t => LOW.includes(t));
R.is(!low.length && ["Reset", "Unload", "Look", "Save as…", "Delete"].every(t => O.labels.includes(t)),
  low.length ? `lowercase buttons beside capitalised ones: ${low.join(", ")}` : `the Vehicle and Weapons tabs' buttons are capitalised alike (${O.labels.filter(t => /^[A-Z]/.test(t)).slice(0, 12).join(", ")} …)`);

R.finish();
