// Controls that were lying about their own state (ROADMAP 3.10, 3.11a, 3.11b, 3.14, 3.15, 3.17,
// 4.2, 4.8).
//
// WHY THESE ARE ONE TEST. They have nothing in common as code — a CSS rule, a flex min-width, a
// swapped element, a select's default, a select's whole meaning — but they share a failure mode,
// and it is the one §4 of CLAUDE.md names: a control that says something the app does not do. Each
// was measured before it was fixed, and every number below is that measurement, so a regression
// reports the same quantity the bug report did rather than "the markup changed".
//
// Each, and the number that proves it:
//
//   3.11(b)  The reset button was not clipped by the sidebar — the search input PAINTED OVER it.
//            A flex item's `min-width` resolves to `auto`, which for an <input> is its intrinsic
//            width (181 px at the default size=20), so it refused to shrink into its 152 px slot.
//            Measured gap from the input's right edge to #btnResetFilters' left edge, before:
//            -52.7 px at a 200 px sidebar, -22.7 at the default 230, -2.7 at 250, +3.3 at 256 —
//            which is exactly why dragging the sidebar wider "fixed" it. After: +6 px (the flex
//            gap) at every width. Nothing reported the overflow at the time, because the input
//            overflows rather than the row, so scrollWidth === clientWidth throughout.
//
//   3.11(a)  The collapse carets were a "down triangle" glyph at 9 px and 60 % opacity against
//            11 px header text — about 5x3 px of ink, which is why they were reported as looking
//            like dots. They are drawn from borders now: 8x5 px, full opacity, the header's own
//            colour, and identical on every platform (the same reason §4 forbids emoji icons).
//
//   3.14     `button.primary` and `button.active` declared the same two properties with the same
//            two values, so #btnProjMove — which is both — changed by NOTHING when its mode came
//            on: rgb(44,92,176) background and rgb(79,143,247) border before and after adding the
//            class. The mode was invisible on the only control that sets it. Now `.active` is the
//            filled accent with dark text, the button says "Moving: on/off" the way Painting does,
//            and G reaches the same handler the button does.
//
//   3.10     The Vehicle field was an <input> in every state. Read-only is the wrong widget for a
//            settled value — it still takes focus and shows a caret — so the settled state is now
//            a <span>. The <input> is hidden, never removed, because every reader in the app asks
//            it for `.value`, and that is asserted here rather than assumed.
//
//   4.2      The decal editor keyed the corner colour out of every image before it was looked at.
//            Right on a marking with a white box round it; destructive on a camouflage tile or a
//            photo texture, with no undo inside the dialog. It opens on "Keep as-is" now, and the
//            guess is one click away — both halves are asserted, because "we removed the feature"
//            would pass the first alone.
//
//   4.8     The decal editor's "Look" (painted / vinyl / stencil / none) described a decal that
//            writes smoothness, metalness and normal, and wrote none of them. On a projection:
//            nothing at all — `bakeProjection` carried `surf` and nothing read it, which 4.8b fixed
//            on 2026-08-26. On a floating UV decal: it pre-filled three sidebar sliders that do
//            nothing until a differently named button is pressed. The full fix needs layer groups
//            (4.9); the paragraph below is the interim,
//            which is to stop promising — so what is asserted here is the *wording*, plus three
//            things that were simply wrong underneath it: two copies of the preset table that had
//            already drifted (only one knew "none", and the four labels were written twice in four
//            different wordings), a bake that walked the footprint, changed nothing, pushed an undo
//            step and reported "baked" when all three deltas were 0, and a generated normal PNG
//            written into every library record that the two loaders never read.
//
//   3.15    Alt+click read `slot.composite` — the albedo — whatever brush was selected, and wrote
//            `App.brush.color`. The surface brushes never read that field: `brushStamp` keys off
//            `b.value` for every mode except "color". So picking with a Metalness brush stored a
//            hex nothing would use and reported "Picked #rrggbb". Asserted against a slot whose
//            four maps hold four different known values (albedo #4080c0, smoothness 45, metalness
//            210, normal-R 90), so reading the wrong sheet is a wrong number, not a coincidence —
//            and against a layer stack, because it must pick what is on screen, not the import.
//
//   3.13    The mirror plane was `symOn ? show : hide` — it had no switch of its own, so keeping
//            mirrored painting meant keeping a translucent quad drawn through the middle of the
//            vehicle in the same view you paint in (renderOrder 998, DoubleSide, opacity .16, so it
//            tints everything behind it). It has three states now, and the second thing asserted is
//            its SIZE: it was `max(modelSize) * 1.5` on both of its axes and centred on
//            `mirrorCenters`, which are per-axis medians of mirrored part midpoints and mean
//            nothing off the mirror axis. On a 12 x 3 x 8 model that is an 18 x 18 wall hanging off
//            both ends; it is now the model's own extent on exactly the two axes the quad spans.
//
//   3.16    Selecting a Metalness layer left the viewport shaded, where a metalness edit is nearly
//            invisible — so the view was changed by hand on every layer change and changed back.
//            Auto is an entry in the same select rather than a fourth control setting the same
//            thing. What is asserted is the rule that makes it acceptable rather than annoying:
//            any manual pick turns it off, and an auto-driven switch does not.
//
//   3.17    "Compare against the original" swapped `s.tex` and nothing else, so the original it
//            showed still carried every normal, smoothness and metalness edit, and in a flat
//            channel view it did nothing at all. Now every map swaps. What is asserted is that the
//            snapshot of the imported surface pair EXISTS only while a surface layer does (a second
//            4096² pair is 67 MB a slot, §3.8), that it differs from the live repack — or the rest
//            of the test would pass on a bug — and that all three textures swap and swap back.
//
//   3.32    The three filter chip rows were flex-wrap, which breaks a line wherever the next chip
//            stops fitting, so the split moved with every pixel of a sidebar drag: measured at
//            220/240/280/340 px the class row went 2+3, 3+2, 4+1, 5, the flags 6+4, 6+4, 8+2, 10,
//            and the ranks left one chip alone on a line (7+1). A row is a column of computed
//            lines now (ChipRow in ui/panels/filters.js): the fewest lines that hold the chips,
//            split as evenly as possible. Asserted at every width: no line count above the greedy
//            minimum (nothing got taller), lines within one chip of each other, widening moving a
//            chip only to an earlier line and never back, and — because flags are one width — the
//            second line of flags sitting in the first line's columns.
//
//   3.31    Anything a published skin may not carry was reachable like anything else, and refused
//            only at export: an edited engine-flame sheet shipped by default, 8192 px was offered
//            to a tank, and replace_tex to a ground vehicle. Each is behind one gate now
//            (ui/gate.js): the control is disabled in the shared `.gated` style — an outline, so a
//            native checkbox shows it — with a mark beside it that names the rule, opens it for the
//            session, and stays lit once open. Asserted on a synthetic tank with a flame sheet:
//            the flame's tick starts off and disabled, hull_c's does not; the forbidden mode and
//            8192 are disabled in their selects and a value already sitting on either goes back
//            to the safe one; opening the flame gate enables its tick, the tick ships the sheet,
//            re-locking from the SLOT list's mark drops it again; a rank VI aircraft frees 8192
//            and locks set_tex instead, a rank IV aircraft does not free it.
//
//   3.29(4)  "Reset surface edits" was suspected of having become what deleting the affected layers
//            does. Measured instead: five paths still write the BASE _n sheets and none is a layer.
//            The button re-initialised from the decoded record as it stood, which after a same-size
//            replacement still held the stock pixels (by accident of restamp) and after a RESIZED
//            replacement held the replacement — the one path where the undo history had been
//            cleared and the button was the only way back, and there it did nothing while saying
//            "reset to original". It reads the kept stock bytes now, through the same step the
//            skin loader uses. Asserted: a baked write, a same-size and a resized replacement each
//            reset to the stock pixels, the resized one back to the stock size with the history
//            cleared, and the status says which slot and that layers were left alone.
//
//   4.35     A decal was placed and then hard to work with: nothing showed it in 3-D, its angle
//            could only be dragged, and a marking on an angled UV shell staircased. (3) the two
//            rotation readouts are number fields — a typed angle is one undo step. (4) "Square to
//            the texture" MEASURES the shell under the projector's centre: the image's right axis,
//            expressed in the hit triangle's UV space, against the nearest texel row. Asserted on
//            a plane whose UVs are turned 30°: the projection turns by -30° to sit on the grid,
//            and a second press turns it by nothing. (1) the selection overlay carries the
//            selected decal's footprint as a ring on the model — meshes appear with a projected
//            decal selected and go with the selection.
//
//   4.37     A promo image: the 3-D view at up to four times its size as a PNG with a transparent
//            background and a soft shadow under the vehicle. The canvas has no alpha channel, so it
//            is one render into a render target with the background off, read back the same frame;
//            the shadow is a ShadowMaterial catcher under the model, shadows on for that frame
//            only. Asserted on a box from the shadow side: the output is exactly the size asked,
//            its corner is alpha 0, the box is opaque, the shadow is black at partial alpha — and
//            afterwards the background, the clear alpha, the shadow map and the camera's aspect
//            are all as they were. (The first render from the light's side found no shadow: it was
//            behind the box. The camera is set where the shadow can be seen.)
//
// Usage: node tools/t50_controls.mjs [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var px = function(v){ return Math.round(v * 10) / 10; };
  var css = function(el){ var s = getComputedStyle(el); return s.backgroundColor + " / " + s.borderTopColor + " / " + s.color; };
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };

  // ---- 3.11(b): the search row at every sidebar width a user can drag to ----
  document.getElementById("rowGameSearch").style.display = "";
  var bar = document.getElementById("leftbar");
  var widths = [200, 230, 250, 256, 320];
  out.row = [];
  for (var i = 0; i < widths.length; i++) {
    bar.style.width = widths[i] + "px";
    await frame();
    var inp = document.getElementById("gameSearch").getBoundingClientRect();
    var btn = document.getElementById("btnResetFilters").getBoundingClientRect();
    out.row.push({ w: widths[i], inputW: px(inp.width), gap: px(btn.left - inp.right),
      insideBar: px(bar.getBoundingClientRect().right - btn.right) });
  }
  bar.style.width = "230px";
  await frame();

  // ---- 3.32: the chip rows at those same widths, with a synthetic ten-nation, eight-rank install ----
  var keepN = GameUnits.nations, keepR = GameUnits.maxRank;
  GameUnits.nations = ["usa","germany","ussr","britain","japan","china","italy","france","sweden","israel"]
    .map(function(t){ return { tag: "country_" + t, name: t }; });
  GameUnits.maxRank = 8;
  renderFilterChips();
  // This page is about 430 px tall, and below about 810 the nation and rank rows fold behind a chip
  // on the type row (2026-10-10, t102 holds the fold) — a folded row measures 0 wide, so they are
  // opened first, the way a user opens them. The type row is swept with that chip on it.
  var moreF = document.getElementById("gameMoreFilters");
  var openedF = !!(moreF && moreF.getAttribute("aria-expanded") === "false" && moreF.offsetParent);
  if (openedF) moreF.click();
  var chipWidths = [200, 220, 230, 240, 260, 280, 300, 320, 340, 400];
  out.chips = [];
  for (var i = 0; i < chipWidths.length; i++) {
    bar.style.width = chipWidths[i] + "px";
    await frame(); await frame();                  // the ResizeObserver delivers on the frame after the resize
    var rec = { w: chipWidths[i] };
    ["gameClassRow", "gameNationRow", "gameRankRow"].forEach(function(id){
      var host = document.getElementById(id), d = host.firstElementChild;
      var lines = [].slice.call(d.children);
      var chips = [].slice.call(d.querySelectorAll(".chip"));
      var W = d.clientWidth, s = -3, greedy = 1;
      for (var k = 0; k < chips.length; k++) { s += chips[k].offsetWidth + 3; if (s > W && k) { greedy++; s = chips[k].offsetWidth; } }
      var lefts = function(l){ return [].slice.call(l.children).map(function(c){ return Math.round(c.getBoundingClientRect().left); }); };
      var overflow = lines.some(function(l){ return l.scrollWidth > l.clientWidth + 1; });
      rec[id] = { split: lines.map(function(l){ return l.childElementCount; }), greedy: greedy, overflow: overflow,
        aligned: lines.length < 2 || lefts(lines[1]).every(function(x){ return lefts(lines[0]).indexOf(x) >= 0; }) };
    });
    out.chips.push(rec);
  }
  GameUnits.nations = keepN; GameUnits.maxRank = keepR;
  if (openedF) moreF.click();                    // folded again, as the page had it
  renderFilterChips();
  bar.style.width = "230px";
  await frame();
  // the same trap, swept: every text field that shares a flex row with anything else
  // (#skinSearch was the other one until ROADMAP 3.5 put the skins list under this same box.)
  out.minWidths = ["gameSearch"].map(function(id){
    var e = document.getElementById(id);
    return { id: id, minWidth: e ? getComputedStyle(e).minWidth : "missing" };
  });
  // ...and every <select> in a .row, which has the same intrinsic width and so the same trap. This
  // was swept on 2026-08-25 because a wording change in the decal editor tripped it, and the sweep
  // found three MORE, all in the export panel, all shipped: expMode ran 13 px past the right edge
  // of #rightbar, expAlpha 84 px and expCamoBase 101 px. A select sizes to its widest option, so
  // every one of these was one reworded option away from moving, and nothing was watching.
  var rowSel = [].slice.call(document.querySelectorAll(".row select"));
  for (var i = 0; i < rowSel.length; i++) {           // each lives in a section that may be hidden
    var p = rowSel[i].parentElement;
    while (p && p !== document.body) { if (getComputedStyle(p).display === "none") p.style.display = ""; p = p.parentElement; }
  }
  await frame();
  out.selects = rowSel.map(function(e){
    var r = e.getBoundingClientRect(), row = e.closest(".row").getBoundingClientRect();
    var host = e.closest("#rightbar,#leftbar");
    return { id: e.id || "(anon)", w: Math.round(r.width), minWidth: getComputedStyle(e).minWidth,
      pastRow: Math.round(r.right - row.right),
      pastHost: host ? Math.round(r.right - host.getBoundingClientRect().right) : -1 };
  }).filter(function(x){ return x.w > 0; });          // a select in a collapsed <details> has no box

  // ---- 3.11(a): caret ink, and it still flips and still leaves .mini on the right ----
  var heads = [].slice.call(document.querySelectorAll(".section h3"));
  var h3 = heads.filter(function(h){ return h.querySelector(".mini"); })[0] || heads[0];
  var sec = h3.parentElement;
  var kids = [].slice.call(sec.children).filter(function(c){ return c.tagName !== "H3"; });
  var ink = function(el){
    var c = getComputedStyle(el, "::before");
    return { w: px(parseFloat(c.borderLeftWidth) + parseFloat(c.borderRightWidth)),
             h: px(parseFloat(c.borderTopWidth) + parseFloat(c.borderBottomWidth)),
             opacity: c.opacity, glyph: c.content,
             colour: c.borderTopColor !== "rgba(0, 0, 0, 0)" ? c.borderTopColor : c.borderLeftColor };
  };
  if (sec.classList.contains("collapsed")) h3.click();
  out.caretOpen = ink(h3);
  out.caretOpen.headerColour = getComputedStyle(h3).color;
  var mini = h3.querySelector(".mini");
  out.miniRightGap = mini ? px(h3.getBoundingClientRect().right - mini.getBoundingClientRect().right) : null;
  h3.click();
  out.caretClosed = ink(h3);
  out.collapseHides = kids.every(function(c){ return getComputedStyle(c).display === "none"; });
  h3.click();
  out.reopened = !sec.classList.contains("collapsed");
  out.otherCarets = [".vchk > summary", "details.adv > summary"].map(function(sel){
    var e = document.querySelector(sel);
    return { sel: sel, ink: e ? ink(e) : null };
  });

  // ---- 3.14: .active must not be .primary ----
  // (The buttons this was measured on — Moving, Project onto model, Move to clicked spot — went on
  // 2026-10-17 with the decal's own modes; any primary and any plain button carry the rule.)
  var mv = document.getElementById("btnDecalEditor");
  setPlacing(false);
  out.primaryOnly = css(mv);
  mv.classList.add("active");
  out.primaryPlusActive = css(mv);
  mv.classList.remove("active");
  var plain = document.getElementById("btnReproject");
  out.plainOnly = css(plain);
  plain.classList.add("active");
  out.plainPlusActive = css(plain);
  plain.classList.remove("active");
  // the sidebar tabs have their own look and must keep it
  var tab = document.querySelector(".tabs button.active");
  out.tab = { bg: getComputedStyle(tab).backgroundColor, colour: getComputedStyle(tab).color };

  // ---- one decal, two placements (2026-10-17): the switch says which one this decal has ----
  var swOf = function(sec){ return [].map.call(document.querySelectorAll("#" + sec + " .placeSw"), function(b){
    return { place: b.dataset.place, text: b.textContent, active: b.classList.contains("active"), css: css(b) }; }); };
  out.sw = { proj: swOf("projSection"), flat: swOf("decalSection"),
             old: ["btnProjMove", "btnProject3d", "btnPlace3d"].filter(function(id){ return !!document.getElementById(id); }) };
  // G armed the Moving mode; a decal is dragged directly now, so G is free and says nothing
  var st = document.getElementById("status");
  st.textContent = "";
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", bubbles: true }));
  out.gWithNoDecal = st.textContent;
  out.gInHints = Object.keys(KEY_HINTS).indexOf("KeyG") >= 0;
  out.gInKeymap = document.getElementById("helpOverlay").innerHTML.indexOf("<kbd>G</kbd>") >= 0;

  // ---- 3.10: the Vehicle field ----
  var vi = document.getElementById("vehicleId"), vt = document.getElementById("vehicleIdText"),
      vb = document.getElementById("btnVehicleIdEdit");
  var shot = function(){
    return { span: getComputedStyle(vt).display !== "none", spanText: vt.textContent,
      input: getComputedStyle(vi).display !== "none", readOnly: vi.readOnly,
      pencil: getComputedStyle(vb).display !== "none", value: vi.value,
      pencilActive: vb.classList.contains("active") };
  };
  out.vehAtBoot = shot();          // nothing loaded yet: a field, and no pencil to protect it
  vi.value = "us_m1a2_sep3_abrams";
  App.skinUnits = [{ unit: { id: "us_m1a2_sep3_abrams", name: "M1A2 SEPv3", cls: "tank", country: "USA" }, score: 100, on: true }];
  refreshVehicleIdLock();
  out.vehSettled = shot();
  out.vehSettledUnits = selectedUnits();
  // the pencil unlocks it; its dialog is the user's, so the flag is set the way the handler sets it
  vehicleIdUnlocked = true;
  refreshVehicleIdLock();
  out.vehUnlocked = shot();
  vehicleIdUnlocked = false;
  // nothing ticked: this IS the .blk name, so it is a field and the pencil has nothing to protect
  App.skinUnits = [];
  refreshVehicleIdLock();
  out.vehOpen = shot();
  out.vehOpenUnits = selectedUnits();
  // typing has to reach the span, or re-locking would show the value from before the edit
  vi.value = "typed_by_hand";
  vi.dispatchEvent(new Event("input", { bubbles: true }));
  App.skinUnits = [{ unit: { id: "x", name: "X", cls: "air", country: "" }, score: 100, on: true }];
  refreshVehicleIdLock();
  out.vehAfterTyping = shot();
  // The unlock is about ONE vehicle's .blk name and must not outlive it. Reproduces the review
  // finding: unlock on vehicle A, load vehicle B, and the field used to still be an editable box.
  App.skinUnits = [{ unit: { id: "f-4e", name: "F-4E", cls: "air", country: "" }, score: 100, on: true }];
  vi.value = "f-4e";
  vehicleIdUnlocked = true;
  refreshVehicleIdLock();
  out.vehUnlockedOnA = shot();
  App.vehicleKey = "f_4e";
  clearVehicleState();                       // what loadVehicleModel does when the model changes
  App.skinUnits = [{ unit: { id: "us_m1a2_sep3_abrams", name: "M1A2 SEPv3", cls: "tank", country: "USA" }, score: 100, on: true }];
  vi.value = "us_m1a2_sep3_abrams";
  refreshVehicleIdLock();
  out.vehOnNextVehicle = shot();
  App.skinUnits = [];
  vi.value = "";
  vehicleIdUnlocked = false;
  refreshVehicleIdLock();

  // ---- 4.8 (interim): the Look control, and the bake it is a preset for ----
  out.surf = { oneTable: typeof DECAL_SURF === "undefined", keys: Object.keys(SURF_PRESETS) };
  var sp = document.getElementById("surfPreset");
  out.surf.sidebar = [].slice.call(sp.options).map(function(o){ return o.value + "=" + o.textContent; });
  // a look with nothing in it must not report success — it used to walk the footprint, change
  // nothing, push an undo step and say "baked"
  var slotWas = App.activeSlot, layerWas = App.activeLayer;
  var cv = function(){ var c = mkCanvas(16, 16); ctx2d(c).fillRect(4, 4, 8, 8); return c; };
  App.activeSlot = { id: "t50", size: 16, smooth: cv(), metal: cv(), normal: cv(), composite: cv(),
    layers: [LayerNode.of({ type: "decal", name: "t50", bmp: cv(), x: .5, y: .5, scale: 1, rot: 0, flip: false,
      visible: true, opacity: 1, blend: "normal" })] };
  App.activeLayer = App.activeSlot.layers[0];
  var bake = function(sm, mt, em){
    document.getElementById("scSm").value = sm;
    document.getElementById("scMt").value = mt;
    document.getElementById("scEm").value = em;
    var st = document.getElementById("status");
    st.textContent = "";
    document.getElementById("btnSurfBake").click();
    return { text: st.textContent, cls: st.className };
  };
  out.surf.bakeNothing = bake(0, 0, 0);
  var upWas = refreshSurfaceTextures, drawWas = draw2D;   // the bake's after-callback wants a real slot
  refreshSurfaceTextures = function(){}; draw2D = function(){};
  out.surf.bakeSomething = bake(20, 0, 0);
  refreshSurfaceTextures = upWas; draw2D = drawWas;
  App.activeSlot = slotWas; App.activeLayer = layerWas;
  // and the sidebar can now show "none" instead of falling through to Custom with three zeros
  out.surf.roundTrip = ["painted", "vinyl", "stencil", "none"].map(function(k){
    applyDecalSurfUI({ surf: { sm: SURF_PRESETS[k].sm, mt: SURF_PRESETS[k].mt, em: SURF_PRESETS[k].em, preset: k } });
    return { asked: k, shown: sp.value, custom: getComputedStyle(document.getElementById("surfCustom")).display !== "none" };
  });

  // ---- 3.15: the picker picks from the channel the brush writes ----
  // A slot whose four maps hold four DIFFERENT known values, so "it picked from the wrong sheet"
  // is a wrong number rather than a coincidence.
  var N = 64;
  var flat = function(hex){ var c = mkCanvas(N, N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var ps = { id: "pick", size: N, nSize: N, layers: [], missing: false };
  ps.baseC = flat("#4080c0"); ps.composite = flat("#4080c0");
  ps.smooth = flat("#2d2d2d");                 // 45
  ps.metal = flat("#d2d2d2");                  // 210
  ps.normal = flat("#5a9080");                 // R 90
  var slotWas2 = App.activeSlot, modeWas = App.brush.mode, valWas = App.brush.value, colWas = App.brush.color;
  App.activeSlot = ps;
  out.pick = {};
  [["color", null], ["smooth", 45], ["metal", 210], ["flatten", 90], ["height", 90]].forEach(function(pair){
    App.brush.mode = pair[0];
    App.brush.color = "#000000"; App.brush.value = 1;
    var st = document.getElementById("status"); st.textContent = "";
    pickColorFrom(ps, 32, 32);
    out.pick[pair[0]] = { want: pair[1], value: App.brush.value, colour: App.brush.color,
      slider: +document.getElementById("brushValue").value,
      shown: document.getElementById("brushValueVal").textContent, said: st.textContent };
  });
  // it must read the LAYER STACK, not the imported sheet, or picking your own paint gives the
  // colour underneath it
  App.brush.mode = "metal";
  ps.layers.push(LayerNode.of({ type: "fill", chan: "metal", color: "#1e1e1e", visible: true, opacity: 1, blend: "normal" }));
  Composite.sheet(ps, "metal", null);
  App.brush.value = 1;
  pickColorFrom(ps, 32, 32);
  out.pickLayered = { value: App.brush.value, want: 30 };
  ps.layers.length = 0;

  // ---- the colour it hands you must be the colour you can SEE ----
  // A ground or naval slot is drawn in NEITHER view as its composite: both lay the paint over the
  // vehicle's own bare sheet through the coverage mask, so wherever coverage is short of opaque the
  // composite holds a colour that is on screen nowhere. Reported 2026-09-01 — picked in the 3-D
  // view, painted in the 3-D view, and the two did not match — and it was never a 3-D bug: the 2-D
  // view gave the same wrong answer over the same texel.
  //
  // The oracle is the 2-D view's OWN pixels rather than a second copy of the blend arithmetic. If
  // the picker and the draw ever drift apart the pick is wrong again, in a way nobody can see.
  App.brush.mode = "color";
  ps.stockC = flat("#6b4a2f");                       // the bare, unpainted material
  ps.covBase = new Uint8Array(N * N);                // covered down the left half, bare down the right
  for (var cy = 0; cy < N; cy++) for (var cx = 0; cx < N; cx++) ps.covBase[cy * N + cx] = cx < N / 2 ? 255 : 0;
  ps._cov = null;
  App.matSlot.set("pickmat", ps.id);
  App.matPaint.set("pickmat", "camo_pick");
  App.paintColor.set("camo_pick", [40, 90, 50]);
  var tintWas = App.paintTint, covWas = App.coverageOn, slotWas3 = App.activeSlot;
  App.paintTint = true; App.coverageOn = true;
  ps.layers.push(LayerNode.of({ type: "fill", chan: "color", color: "#4080c0", visible: true, opacity: 1, blend: "normal" }));
  compositeSlot(ps);
  var rgbAt = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  out.camo = { covered: shownColorAt(ps, 10, 32), bare: shownColorAt(ps, N - 10, 32),
               composite: rgbAt(ps.composite, N - 10, 32) };
  App.activeSlot = ps;
  fit2D(); draw2DNow();
  var drawn = function(tx){
    return rgbAt(cnv2, Math.round((tx + .5) * v2.sc + v2.ox), Math.round(32.5 * v2.sc + v2.oy));
  };
  out.camo.drawnCovered = drawn(10); out.camo.drawnBare = drawn(N - 10);
  // and what the control actually says afterwards, since that is what the user reads
  var st2 = document.getElementById("status"); st2.textContent = "";
  App.brush.color = "#000000";
  pickColorFrom(ps, N - 10, 32);
  out.camo.picked = App.brush.color; out.camo.said = st2.textContent;
  App.activeSlot = slotWas3; App.paintTint = tintWas; App.coverageOn = covWas;
  App.matSlot.delete("pickmat"); App.matPaint.delete("pickmat"); App.paintColor.delete("camo_pick");
  ps.layers.length = 0; ps.stockC = null; ps.covBase = null;

  App.activeSlot = slotWas2; App.brush.mode = modeWas; App.brush.value = valWas; App.brush.color = colWas;

  // ---- 3.17: Compare shows the original of EVERY map, not only the albedo ----
  // Simpler than it was: the surface textures point straight at the sheets, so "the original" is
  // chanBase where the live view is chanOut, and there is no second copy of anything to keep.
  var cs = { id: "cmp", size: N, nSize: N, layers: [], missing: false };
  cs.baseC = flat("#4080c0"); cs.composite = flat("#c04040");
  cs.smooth = flat("#2d2d2d"); cs.metal = flat("#d2d2d2"); cs.normal = flat("#8080ff");
  App.slots.set("cmp", cs);
  cs.layers.push(LayerNode.of({ type: "fill", chan: "smooth", color: "#f0f0f0", visible: true, opacity: 1, blend: "normal" }));
  compositeChannels(cs, null);
  cs.tex = { image: cs.composite, needsUpdate: false };       // stand-in for a THREE texture
  out.cmpTex = !!cs.texCh;
  var imgOf = function(){ return SURF_CHANS.map(function(ch){
    return ch + "=" + (cs.texCh[ch].image === chanBase(cs, ch) ? "base" : "live"); }).join(" "); };
  out.cmpLive = imgOf();
  App.compare = false;
  setCompare(true);
  out.cmpOn = { alb: cs.tex.image === cs.baseC, maps: imgOf() };
  setCompare(false);
  out.cmpOff = { alb: cs.tex.image === cs.composite, maps: imgOf() };
  App.slots.delete("cmp");

  // ---- 4.2: the decal editor opens on "Keep as-is" ----
  // A tile whose corner colour is also most of its content — the case that was being destroyed.
  var src = document.createElement("canvas"); src.width = 64; src.height = 64;
  var g = src.getContext("2d");
  g.fillStyle = "#3d5a2b"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#a08b4f"; g.fillRect(20, 20, 24, 24);
  var dlg = openDecalEditor(src, "camo_tile.png", function(){});
  await frame(); await frame();
  var pv = dlg.body.querySelector("canvas");
  var corner = function(){ return [].slice.call(pv.getContext("2d").getImageData(1, 1, 1, 1).data); };
  var sel = dlg.body.querySelector("select");
  out.decal = { options: [].slice.call(sel.options).map(function(o){ return o.value; }),
    value: sel.value, cornerAlpha: corner()[3], cornerRGB: corner().slice(0, 3).join(",") };
  // and the guess is still one click
  sel.value = "tl"; sel.onchange();
  await frame(); await frame();
  out.decalAfterGuess = { value: sel.value, cornerAlpha: corner()[3] };
  // 4.8 interim: the Look control, in the dialog where the promise was being made
  var look = dlg.body.querySelectorAll("select")[1];
  var hints = function(){ return [].slice.call(dlg.body.querySelectorAll(".hint")).map(function(h){ return h.textContent; }); };
  var hintFor = function(){ return hints().filter(function(t){ return /surface response|surface change/i.test(t); })[0] || ""; };
  out.look = { options: [].slice.call(look.options).map(function(o){ return o.value; }),
    value: look.value, title: look.title, hint: hintFor() };
  look.value = "none"; look.onchange();
  out.lookNone = { hint: hintFor() };
  look.value = "vinyl"; look.onchange();
  out.lookVinyl = { hint: hintFor() };
  // ROADMAP 4.50 (17): the same claim, on the controls a user hovers rather than in the dialog. The
  // Projected image panel's Look is labelled by the label in its own row; the sidebar's Apply button
  // is named in the hint under it and in the Bake button's tooltip, so those are read too.
  var projLookLabel = $("projSurf").parentElement.querySelector("label");
  out.lookTips = { proj: projLookLabel ? projLookLabel.title : "", apply: $("btnSurfApply").title,
    applyName: $("btnSurfApply").textContent.trim(), bake: $("btnSurfBake").title, hint: $("surfHint").textContent };
  dlg.close();
  // What a save actually writes. The record used to carry a second PNG — a generated normal map
  // nothing ever read back — and the dialog advertised it, so this goes through the real library
  // rather than trusting the note. It also proves no UI label leaked out of the preset table.
  var applied = null;
  var dlg2 = openDecalEditor(src, "roundel.png", function(c, meta){ applied = meta; });
  var foot = function(d, re){ return [].slice.call(d.foot.querySelectorAll("button")).filter(function(b){ return re.test(b.textContent); })[0]; };
  await frame();
  foot(dlg2, /Save to library/).click();
  for (var w = 0; w < 40 && !/Saved/.test(document.getElementById("status").textContent); w++) await frame();
  var idx = await DecalLib.index();
  var mine = idx.filter(function(r){ return r.name === "roundel"; })[0];   // never touch a real library row
  var rec = mine ? await DecalLib.get(mine.id) : null;
  out.saved = rec ? { name: rec.name, fields: Object.keys(rec).sort(), hasNormal: "normal" in rec,
    png: !!rec.png, surfKeys: Object.keys(rec.surf || {}).sort() } : null;
  if (mine) await DecalLib.remove(mine.id);
  foot(dlg2, /Use this decal/).click();
  out.applied = applied && applied.surf ? Object.keys(applied.surf).sort() : null;


  // ---- 3.20: the 2-D brush ring follows the pointer while you are painting ----
  // Driven through real pointer events on the canvas rather than by calling stampAt, because the
  // bug was entirely in the event handler: "v2.cursor" — the only thing the ring is drawn from —
  // was updated on the "else" branch, so it froze at the last move before pointerdown and stayed
  // there for the whole stroke.
  var ringSlotWas = App.activeSlot, ringLayerWas = App.activeLayer, paintWas = App.paint3d;
  var modeWas2 = App.brush.mode;
  var RN = 128;
  var rs = { id: "t50ring", size: RN, nSize: RN, layers: [], missing: false };
  rs.baseC = flat("#303030"); rs.composite = flat("#303030");
  App.activeSlot = rs; App.activeLayer = null;
  App.paint3d = true; App.brush.mode = "color"; App.brush.size = 20;
  var cn = document.getElementById("view2d");
  fit2DNow();
  await frame();
  var rect = cn.getBoundingClientRect();
  var pe = function(type, cx, cy, btn){
    return new PointerEvent(type, { clientX: cx, clientY: cy, button: btn || 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true });
  };
  var at = function(fx, fy){ return [rect.left + rect.width * fx, rect.top + rect.height * fy]; };
  var p1 = at(.35, .45), p2 = at(.6, .55), p3 = at(.75, .7);
  cn.dispatchEvent(pe("pointermove", p1[0], p1[1]));
  var c0 = v2.cursor ? { x: v2.cursor.x, y: v2.cursor.y } : null;
  cn.dispatchEvent(pe("pointerdown", p1[0], p1[1]));
  var painting = !!stroke;
  cn.dispatchEvent(pe("pointermove", p2[0], p2[1]));
  var c1 = v2.cursor ? { x: v2.cursor.x, y: v2.cursor.y } : null;
  cn.dispatchEvent(pe("pointermove", p3[0], p3[1]));
  var c2 = v2.cursor ? { x: v2.cursor.x, y: v2.cursor.y } : null;
  cn.dispatchEvent(pe("pointerup", p3[0], p3[1]));
  var moved = function(a, b){ return a && b ? Math.round(Math.hypot(b.x - a.x, b.y - a.y)) : -1; };
  out.ring = { painting: painting, start: c0, movedWhilePainting: moved(c0, c1), keptMoving: moved(c1, c2) };
  App.activeSlot = ringSlotWas; App.activeLayer = ringLayerWas;
  App.paint3d = paintWas; App.brush.mode = modeWas2;

  // ---- 3.13: the mirror plane's own switch, and the size of the quad ----
  // A synthetic vehicle rather than a loaded one: this is about the plane's arithmetic, and made-up
  // numbers make a wrong axis a wrong number instead of a plausible one. mirrorCenters is set
  // deliberately absurd off the mirror axis, because that is exactly the value the old code centred
  // the quad on.
  modelGroup = new THREE.Group();
  App.modelSize = { x: 12, y: 3, z: 8 };
  App.modelCenter = { x: 1, y: 2, z: 3 };
  App.mirrorCenters = { x: 40, y: 50, z: 0 };
  App.symOffset = 0;
  out.planeStates = {};
  ["off", "adjust", "always"].forEach(function(m){
    document.getElementById("symPlaneVis").value = m;
    updateSymPlane();       var idle = symPlaneMesh ? symPlaneMesh.visible : false;
    updateSymPlane(true);   var prev = symPlaneMesh ? symPlaneMesh.visible : false;
    out.planeStates[m] = { idle: idle, preview: prev };
  });
  // ...and it does not consult symOn any more, in either direction
  document.getElementById("symPlaneVis").value = "always";
  document.getElementById("symOn").checked = false; updateSymPlane();
  var alwaysSymOff = symPlaneMesh.visible;
  document.getElementById("symPlaneVis").value = "off";
  document.getElementById("symOn").checked = true; updateSymPlane(true);
  out.planeIgnoresSymOn = { shownWithSymOff: alwaysSymOff, hiddenWithSymOn: !symPlaneMesh.visible };
  document.getElementById("symPlaneVis").value = "always";
  out.planeBox = {};
  ["x", "y", "z"].forEach(function(a){
    document.getElementById("symAxis").value = a;
    updateSymPlane();
    symPlaneMesh.updateMatrixWorld(true);
    var g = new THREE.PlaneGeometry(1, 1);
    var b = new THREE.Box3().setFromBufferAttribute(g.attributes.position).applyMatrix4(symPlaneMesh.matrixWorld);
    out.planeBox[a] = { x: [+b.min.x.toFixed(2), +b.max.x.toFixed(2)],
                        y: [+b.min.y.toFixed(2), +b.max.y.toFixed(2)],
                        z: [+b.min.z.toFixed(2), +b.max.z.toFixed(2)] };
  });
  document.getElementById("symAxis").value = "auto";
  document.getElementById("symPlaneVis").value = "adjust";
  updateSymPlane();

  // ---- 3.16: Auto follows the layer, and any manual pick turns it off ----
  var sel = document.getElementById("chanViewSel");
  out.autoOption = [].slice.call(sel.options).map(function(o){ return o.value; }).indexOf("auto");
  var chan = function(){ return { view: App.chanView, sel: sel.value, auto: !!App.chanAuto }; };
  setChannelView("shaded");
  sel.value = "auto"; sel.onchange({ target: sel });
  out.autoOn = chan();
  // The mapping, driven the way the app drives it — through refreshLayerProps and a real active
  // layer, not by calling applyAutoChanView directly, because the wiring is half of what 3.16 is.
  var slotWas3 = App.activeSlot, layerWas3 = App.activeLayer;
  var s16 = { id: "t316", size: N, nSize: N, missing: false, layers: [] };
  s16.baseC = flat("#4080c0"); s16.composite = flat("#4080c0");
  s16.smooth = flat("#2d2d2d"); s16.metal = flat("#d2d2d2"); s16.normal = flat("#5a9080");
  App.activeSlot = s16;
  out.autoFollows = [];
  ["color", "smooth", "metal", "normal", "wear"].forEach(function(ch){
    s16.layers = [LayerNode.of({ id: "t" + ch, name: ch, type: "fill", chan: ch, color: "#808080",
      opacity: 1, blend: "normal", visible: true })];
    App.activeLayer = s16.layers[0];
    refreshLayerProps();
    out.autoFollows.push({ layer: ch, view: App.chanView, sel: sel.value, auto: !!App.chanAuto });
  });
  App.activeSlot = slotWas3; App.activeLayer = layerWas3;
  setChannelView("normal");                 // a manual pick, from anywhere
  out.autoOffAfterManual = chan();
  App.chanAuto = true; setChannelView("smooth", true);
  out.autoSurvivesItsOwn = chan();
  App.chanAuto = false; setChannelView("shaded");
  // ---- 4.9a: the fold caret, and the eye column it was pushing about ----
  // ".lcaret" was drawn from borders in "var(--fg)", and this stylesheet has no "--fg" — it has
  // "--text". An invalid var() inside a SHORTHAND poisons the whole shorthand at computed-value
  // time, so "border-style" fell back to "none" and the triangle was never painted. It was still a
  // flex item with a margin, and a different WIDTH in each state (10x0 open, 0x10 closed), so it
  // also moved the row's eye about.
  var slotWas4 = App.activeSlot, layerWas4 = App.activeLayer;
  showTab("paint");
  var cN = 64;
  var cs = { id: "t50c", size: cN, layers: [], missing: false };
  cs.baseC = mkCanvas(cN, cN); cs.composite = mkCanvas(cN, cN);
  App.slots.set("t50c", cs); App.activeSlot = cs;
  var cpaint = function(n){ return LayerNode.of({ type: "paint", name: n, canvas: mkCanvas(cN, cN), visible: true, opacity: 1, blend: "normal" }); };
  var cGroup = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", collapsed: false, children: [cpaint("kid")] };
  cs.layers = [cpaint("loose"), cGroup];
  App.activeLayer = null;
  refreshLayerList();
  await frame(); await frame();
  var readRows = function(){
    var o = {};
    document.querySelectorAll("#layerList .layer").forEach(function(d){
      var nm = d.querySelector(".nm").textContent;
      var eye = d.querySelector(".eye"), car = d.querySelector(".lcaret:not(.ghost)");
      var rr = d.getBoundingClientRect();
      var st = car ? getComputedStyle(car) : null;
      var pb = car ? getComputedStyle(car, "::before") : null;
      o[nm] = { eyeX: Math.round(eye.getBoundingClientRect().left - rr.left),
                caretW: car ? Math.round(car.getBoundingClientRect().width) : null,
                caretH: car ? Math.round(car.getBoundingClientRect().height) : null,
                topStyle: pb ? pb.borderTopStyle : null,
                leftStyle: pb ? pb.borderLeftStyle : null,
                topColor: pb ? pb.borderTopColor : null };
    });
    return o;
  };
  out.lcaretOpen = readRows();
  cGroup.collapsed = true; refreshLayerList();
  await frame(); await frame();
  out.lcaretClosed = readRows();
  // and the only thing left that moves an eye is the depth indent
  cGroup.collapsed = false; refreshLayerList();
  await frame();
  out.lcaretDepth = readRows();
  App.slots.delete("t50c");
  App.activeSlot = slotWas4; App.activeLayer = layerWas4;
  refreshLayerList();

  // ---- 3.23: a finished load lands you on Textures, unless you were somewhere on purpose ----
  // "Loading a 3d model should switch to textures tab." The left panel opens on Vehicle, which is
  // where you go to FIND something, and stayed there once the model was up — so the first thing
  // after every load was the same click. rebuildAll is the one funnel every load path runs through,
  // which is why the four of them used to differ only by accident.
  var tabWas323 = App.leftTab, slotsWas323 = App.slots, geoWas323 = App.geomData, actWas323 = App.activeSlot;
  var texSlot = function(id){
    var c = mkCanvas(32, 32), g = ctx2d(c); g.fillStyle = "#404040"; g.fillRect(0, 0, 32, 32);
    return { id: id, size: 32, layers: [], baseC: c, composite: c, missing: false };
  };
  out.tab323 = {};
  var loadFrom = function(from, withSlot){
    App.geomData = null;
    App.slots = new Map();
    if (withSlot) App.slots.set("t50t", texSlot("t50t"));
    App.activeSlot = null;
    showTab(from);
    rebuildAll();
    return App.leftTab;
  };
  out.tab323.fromVehicle = loadFrom("vehicle", true);
  out.tab323.fromParts = loadFrom("parts", true);
  out.tab323.fromWeapons = loadFrom("weapons", true);
  out.tab323.alreadyThere = loadFrom("paint", true);
  out.tab323.noSlots = loadFrom("vehicle", false);
  App.slots = slotsWas323; App.geomData = geoWas323; App.activeSlot = actWas323;
  showTab(tabWas323 || "vehicle");

  // ---- 4.31: 3D / Split / 2D, after the divider has been dragged ----
  var vmW = function(){ return { views: document.getElementById("views").clientWidth,
    v3: document.getElementById("view3dwrap").clientWidth, v2: document.getElementById("view2dwrap").clientWidth }; };
  var vmBtn = function(m){ return document.querySelector('[data-vm="' + m + '"]'); };
  Layout.setSplit(0.6); await frame();
  out.vm = { dragged: vmW() };
  vmBtn("3d").click(); await frame(); out.vm.only3d = vmW();
  vmBtn("2d").click(); await frame(); out.vm.only2d = vmW();
  vmBtn("split").click(); await frame(); out.vm.back = vmW(); out.vm.ratio = Layout.split();
  Layout.setSplit(0.5); vmBtn("split").click(); await frame();

  // ---- 4.32: an ARMED click says what it is waiting for — the radial centre is the one left ----
  var rc = document.getElementById("btnRadialCentre");
  out.arm = { off: rc.textContent };
  setPlacing("radial"); out.arm.on = rc.textContent; out.arm.active = rc.classList.contains("active");
  setPlacing(false); out.arm.back = rc.textContent;

  // ---- 4.33: one decal editor, however many pastes arrive ----
  var modals = function(){ return document.querySelectorAll("#modalHost .modal").length; };
  var dsrc = mkCanvas(8, 8); ctx2d(dsrc).fillRect(0, 0, 8, 8);
  out.dedit = { before: modals() };
  openDecalEditor(dsrc, "first.png", function(){});
  out.dedit.one = modals();
  openDecalEditor(dsrc, "second.png", function(){});
  out.dedit.two = modals();
  out.dedit.said = document.getElementById("status").textContent;
  document.querySelector("#modalHost .modal .head .x").click();
  out.dedit.afterClose = modals();
  openDecalEditor(dsrc, "third.png", function(){});
  out.dedit.reopened = modals();
  document.querySelector("#modalHost .modal .head .x").click();
  out.dedit.end = modals();

  // ---- 4.39: whether a thing is DRAWN is one switch, in one panel ----
  // Reported as "weapon and pylon visibility is in two places". It was: the Arms tab carried a
  // "weapons" and a "pylons" checkbox and the Scene tab carried the same two, each calling
  // syncSceneToggles so the other would stop showing something untrue. The state is still written
  // from four places — the loadout turning it on, the part-name inference, the reset — and none of
  // those is a CONTROL, which is the distinction the item draws.
  App.showWeapons = false; App.showPylons = false;
  // The panel refuses to draw anything without a game folder, so the row under test needs one —
  // stubbed exactly as t44 does it, since the question here is what the row CONTAINS.
  var gdWas = App.gameDir, afcWas = armamentForCurrentUnit;
  App.gameDir = { name: "fake-439" };
  armamentForCurrentUnit = function(){ return { unit: null, arm: null }; };
  refreshWeaponPanel();
  var boxes = function(root){
    return [].map.call(root.querySelectorAll("input[type=checkbox]"), function(c){ return c.id || "(unnamed)"; });
  };
  out.vis = { inArms: boxes(document.getElementById("weaponList")),
              armRow: (document.getElementById("weaponList").textContent || "").trim(),
              inScene: boxes(document.getElementById("optShowPylons").closest(".section")).filter(function(id){
                return id === "optShowWeapons" || id === "optShowPylons"; }) };
  armamentForCurrentUnit = afcWas; App.gameDir = gdWas;
  var wb = document.getElementById("optShowWeapons"), pb = document.getElementById("optShowPylons");
  syncSceneToggles();
  out.vis.startsOff = { w: wb.checked, p: pb.checked };
  App.showWeapons = true; App.showPylons = true;
  syncSceneToggles();
  out.vis.follows = { w: wb.checked, p: pb.checked };
  wb.checked = false; wb.onchange({ target: wb });
  pb.checked = false; pb.onchange({ target: pb });
  out.vis.writes = { w: !!App.showWeapons, p: App.showPylons !== false };

  // ---- 3.31: publishability gates, on a synthetic tank carrying an engine-flame sheet ----
  var g31 = { geom: App.geomData, units: App.skinUnits, slots: App.slots, active: App.activeSlot, menu: App.slotMenu, open: App.gateOpen };
  App.gateOpen = new Set();
  var N31 = 16, cv31 = function(){ return mkCanvas(N31, N31); };
  var mkS = function(id){ return { id: id, cStem: id, layers: [], size: N31, sizeH: N31, missing: false, baseC: cv31(), composite: cv31(), cEdited: true }; };
  var hull = mkS("hull_c"), flame = mkS("jet_flame_diamonds");
  App.slots = new Map([["hull_c", hull], ["jet_flame_diamonds", flame]]);
  App.activeSlot = null; App.slotMenu = null;
  App.geomData = null;                 // no geometry: slotRole reads the NAME, which is how a flame sheet arrives via ->slot
  App.skinUnits = [{ on: true, unit: { cls: "tank", rank: 3 } }];
  document.getElementById("expMode").value = "auto";
  var rowOf = function(name){
    return [].filter.call(document.querySelectorAll("#expList .exprow"), function(r){ return r.querySelector(".nm").textContent.indexOf(name) === 0; })[0];
  };
  var gstate = function(){
    refreshSlotList();                 // draws the slot list AND the export list
    var fr = rowOf("jet_flame_diamonds"), hr = rowOf("hull_c");
    var tick = function(r){ var i = r && r.querySelector("input"); return i ? { disabled: i.disabled, checked: i.checked, gated: i.classList.contains("gated"),
      mark: !!r.querySelector(".gatemark"), open: !!r.querySelector(".gatemark.open") } : null; };
    var modeSel = document.getElementById("expMode");
    var hsz = hr && hr.querySelector("select");
    var gi = fr && fr.querySelector("input"), gs = gi && getComputedStyle(gi);
    return {
      flame: tick(fr), hull: tick(hr),
      live: collectExports(true).filter(function(it){ return !it.off; }).map(function(it){ return it.fileNameBase; }).sort(),
      mode: { value: modeSel.value, replaceOff: modeSel.querySelector('option[value="replace_tex"]').disabled,
              setOff: modeSel.querySelector('option[value="set_tex"]').disabled,
              mark: !!modeSel.parentNode.querySelector(".gatemark"), open: !!modeSel.parentNode.querySelector(".gatemark.open") },
      size8k: { off: hsz ? hsz.querySelector('option[value="8192"]').disabled : null,
                mark: !!document.getElementById("expAllNone").parentNode.querySelector('.gatemark[data-gate="size8k"]') },
      slotMarks: [].map.call(document.querySelectorAll("#slotList .gatemark"), function(m){ return m.closest(".rowitem").querySelector(".nm").textContent; }),
      gatedStyle: gs ? gs.outlineStyle + " " + gs.outlineColor : null,
    };
  };
  out.gate = { locked: gstate() };
  document.getElementById("expMode").value = "replace_tex"; updateExportWarnings();      // a remembered preference on the forbidden mode
  out.gate.remembered = document.getElementById("expMode").value;
  hull.exp.c.size = 8192; updateExportList();                                             // 8192 asked for while locked
  out.gate.size8kReset = hull.exp.c.size;
  rowOf("jet_flame_diamonds").querySelector(".gatemark").click();                         // open the protected gate from the export row
  out.gate.opened = gstate();
  var fi = rowOf("jet_flame_diamonds").querySelector("input"); fi.checked = true; fi.onchange();
  out.gate.ticked = gstate();
  document.querySelector('#slotList .gatemark[data-gate="protected"]').click();           // and lock it again from the slot list
  out.gate.relocked = gstate();
  document.getElementById("expMode").parentNode.querySelector(".gatemark").click();      // open the mode gate, pick the forbidden mode
  document.getElementById("expMode").value = "replace_tex"; document.getElementById("expMode").onchange();
  out.gate.modeOpen = gstate();
  App.gateOpen = new Set(); document.getElementById("expMode").value = "auto";
  App.skinUnits = [{ on: true, unit: { cls: "air", rank: 6 } }]; updateExportWarnings();
  out.gate.air6 = gstate();
  App.skinUnits = [{ on: true, unit: { cls: "air", rank: 4 } }]; updateExportWarnings();
  out.gate.air4 = gstate();
  App.gateOpen = g31.open; App.geomData = g31.geom; App.skinUnits = g31.units; App.slots = g31.slots; App.activeSlot = g31.active; App.slotMenu = g31.menu;
  document.getElementById("expMode").value = "auto";
  refreshSlotList();

  // ---- 3.29(4): the reset-surface button goes back to the GAME'S bytes on every path that overwrote them ----
  var r29 = { dec: App.decoded, slots: App.slots, active: App.activeSlot, geom: App.geomData, undo: App.undoStack.slice(), redo: App.redoStack.slice() };
  var tga29 = function(r, g, b, a, W){ W = W || 8; var H = W, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W & 255; u[13] = W >> 8; u[14] = H & 255; u[15] = H >> 8; u[16] = 32; u[17] = 0x20;
    for (var i = 0; i < W * H; i++) { var q = 18 + i * 4; u[q] = b; u[q+1] = g; u[q+2] = r; u[q+3] = a == null ? 255 : a; } return u; };
  var dec29 = function(bytes, name){ var d = parseTGA(bytes.buffer.slice(0)); d.raw = bytes.buffer.slice(0); d.rawName = name; d.fileName = name; return d; };
  var px29 = function(cv){ var d = ctx2d(cv).getImageData(1, 1, 1, 1).data; return [d[0], d[1], d[2]]; };
  var fresh29 = function(){
    App.decoded = new Map(); App.slots = new Map(); App.undoStack.length = 0; App.redoStack.length = 0; App.geomData = null;
    App.decoded.set("hull_c", dec29(tga29(0, 0, 255), "hull_c.tga"));
    App.decoded.set("hull_n", dec29(tga29(30, 40, 50, 128), "hull_n.tga"));     // stock: smooth 30, metal 50
    var s = ensureSlot({ stem: "hull", c: "hull_c", n: "hull_n" });
    App.activeSlot = s; return s;
  };
  var reset29 = function(s){
    document.getElementById("btnResetSurface").onclick();
    return { smooth: px29(s.smooth), metal: px29(s.metal), size: s.smooth.width, undo: App.undoStack.length, edited: !!s.nEdited,
             status: document.getElementById("status").textContent };
  };
  out.reset = {};
  var s29 = fresh29();
  ctx2d(s29.smooth).fillStyle = "rgb(200,200,200)"; ctx2d(s29.smooth).fillRect(0, 0, 8, 8); s29.nEdited = true;   // a baked write
  out.reset.baked = reset29(s29);
  s29 = fresh29();
  applyReplaceTexture(s29, dec29(tga29(200, 40, 90, 128, 8), "other_n.tga"), true, "other_n.tga");                 // same-size replacement
  out.reset.sameSize = { before: px29(s29.smooth), after: reset29(s29) };
  s29 = fresh29();
  applyReplaceTexture(s29, dec29(tga29(200, 40, 90, 128, 16), "other_n.tga"), true, "other_n.tga");                // resized replacement
  out.reset.resized = { before: px29(s29.smooth), sizeBefore: s29.smooth.width, after: reset29(s29) };
  App.decoded = r29.dec; App.slots = r29.slots; App.activeSlot = r29.active; App.geomData = r29.geom;
  App.undoStack.length = 0; App.redoStack.length = 0; [].push.apply(App.undoStack, r29.undo); [].push.apply(App.redoStack, r29.redo);
  refreshSlotList();

  // ---- 4.35: a decal you can handle in 3-D ----
  var r35 = { slots: App.slots, active: App.activeSlot, layer: App.activeLayer, meshes: App.meshes, matSlot: App.matSlot, sel: App.selParts,
              geom: App.geomData, size: App.modelSize, mg: modelGroup };
  var N35 = 64, cv35 = function(){ return mkCanvas(N35, N35); };
  var s35 = { id: "sq_c", cStem: "sq_c", layers: [], size: N35, sizeH: N35, missing: false, baseC: cv35(), composite: cv35(), cEdited: true };
  App.slots = new Map([["sq_c", s35]]); App.activeSlot = s35; App.geomData = null; App.modelSize = { x: 10, y: 10, z: 10 };
  // a 2 x 2 plane facing +Z whose UVs are the vertex positions TURNED 30 degrees — the shell sits at 30 on the sheet
  var geo35 = new THREE.PlaneGeometry(2, 2), pa = geo35.attributes.position, ua = geo35.attributes.uv, th = 30 * Math.PI / 180;
  for (var vi = 0; vi < pa.count; vi++) {
    var x = pa.getX(vi), y = pa.getY(vi);
    ua.setXY(vi, 0.5 + 0.25 * (x * Math.cos(th) - y * Math.sin(th)), 0.5 + 0.25 * (x * Math.sin(th) + y * Math.cos(th)));
  }
  var mesh35 = new THREE.Mesh(geo35, new THREE.MeshStandardMaterial()); mesh35.name = "plane"; mesh35.userData = { mat: "sqm" };
  mesh35.updateMatrixWorld(true);
  modelGroup = modelGroup || new THREE.Group();
  App.meshes = new Map([["plane", mesh35]]); App.matSlot = new Map([["sqm", "sq_c"]]); App.selParts = new Set();
  var bmp35 = mkCanvas(8, 8); ctx2d(bmp35).fillStyle = "#f00"; ctx2d(bmp35).fillRect(0, 0, 8, 8);
  var P35 = { frame: { p: [0, 0, 0], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, rot: 0, scale: .3, flip: false, name: "sq" };
  var liveWas = window.projLiveRender, syncWas = window.syncProjUI;
  window.projLiveRender = function(){}; window.syncProjUI = function(){};
  var t1 = alignProj(P35), rot1 = P35.rot;
  App._projEdit = null;
  var t2 = alignProj(P35), rot2 = P35.rot;
  App._projEdit = null;
  P35.rot = 47;                                          // from the other side of the grid, it lands on the SAME line
  var t3 = alignProj(P35), rot3 = P35.rot;
  App._projEdit = null;
  P35.frame.p = [50, 50, 50];                            // nothing under the frame
  var t4 = alignProj(P35);
  window.projLiveRender = liveWas; window.syncProjUI = syncWas;
  out.sq = { t1: t1, rot1: rot1, t2: t2, rot2: rot2, t3: t3, rot3: rot3, t4: t4 };
  // (3) the readouts are fields, and a typed angle is one undo step
  var dec35 = LayerNode.of({ type: "decal", name: "D", bmp: bmp35, x: .5, y: .5, scale: .5, rot: 0, opacity: 1, blend: "normal", visible: true });
  s35.layers = [dec35]; App.activeLayer = dec35; App.undoStack.length = 0;
  syncDecalUI();
  var fld = document.getElementById("decRotVal");
  out.typed = { tag: fld.tagName, before: fld.value };
  fld.value = "12.5"; fld.onchange({ target: fld });
  out.typed.rot = dec35.rot; out.typed.undo = App.undoStack.length;
  doUndo(); out.typed.undone = dec35.rot;
  document.getElementById("btnDecSquare").onclick();      // 0 -> already square
  out.typed.squareIdle = document.getElementById("status").textContent;
  dec35.rot = 100; document.getElementById("btnDecSquare").onclick();
  out.typed.squared = dec35.rot;
  // (1) the overlay: a selected PROJECTED decal puts a ring on the model; deselecting takes it off
  var lay35 = mkCanvas(N35, N35); ctx2d(lay35).fillStyle = "#0f0"; ctx2d(lay35).fillRect(16, 16, 32, 32);
  var proj35 = LayerNode.of({ type: "paint", name: "P", canvas: lay35, opacity: 1, blend: "normal", visible: true, proj: P35 });
  s35.layers = [proj35]; App.activeLayer = proj35;
  Marquee.act && Marquee.none && Marquee.none();
  SelOverlay.reset(); SelOverlay.sync();
  out.dring = { meshes: SelOverlay.meshes.length, key: SelOverlay.key };
  var ringPx = (function(){ if (!SelOverlay.canvas) return null; var d = ctx2d(SelOverlay.canvas).getImageData(0, 0, SelOverlay.canvas.width, SelOverlay.canvas.height).data;
    var D = SelOverlay.canvas.width, edge = 0, inside = 0, outside = 0;
    var at = function(x, y){ return d[(y * D + x) * 4 + 3]; };
    edge = at(Math.round(D * 15 / 64), Math.round(D * 32 / 64)); inside = at(Math.round(D * 32 / 64), Math.round(D * 32 / 64)); outside = at(2, 2);
    return { edge: edge, inside: inside, outside: outside }; })();
  out.dring.px = ringPx;
  App.activeLayer = null; SelOverlay.sync();
  out.dring.after = SelOverlay.meshes.length;
  SelOverlay.reset();
  App.slots = r35.slots; App.activeSlot = r35.active; App.activeLayer = r35.layer; App.meshes = r35.meshes; App.matSlot = r35.matSlot;
  App.selParts = r35.sel; App.geomData = r35.geom; App.modelSize = r35.size; modelGroup = r35.mg; App._projEdit = null;
  App.undoStack.length = 0;

  // ---- 4.37: a transparent PNG with a shadow under the model ----
  var r37 = { meshes: App.meshes, matSlot: App.matSlot, sel: App.selParts, mg: modelGroup, mgParent: modelGroup && modelGroup.parent,
              theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone(), bg: scene.background,
              clearAlpha: renderer.getClearAlpha(), aspect: camera.aspect, shadows: renderer.shadowMap.enabled };
  var box37 = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: 0xcc4444 }));
  box37.name = "box37"; box37.userData = { mat: "b37" };
  var mg37 = new THREE.Group(); mg37.add(box37); scene.add(mg37); mg37.updateMatrixWorld(true);
  modelGroup = mg37; App.meshes = new Map([["box37", box37]]); App.matSlot = new Map([["b37", "none"]]); App.selParts = new Set();
  cam.target.set(0, 0, 0); cam.dist = 6; cam.theta = Math.PI * 1.15; cam.phi = 1.1; syncCamera();   // the side the shadow falls to
  var shot = Shot.render(160, 120);
  var sd = shot ? ctx2d(shot).getImageData(0, 0, shot.width, shot.height).data : null;
  var o37 = { size: shot ? [shot.width, shot.height] : null, corner: sd ? [sd[0], sd[1], sd[2], sd[3]] : null, opaque: 0, shadow: 0, shadowSample: null };
  if (sd) for (var i = 0; i < sd.length; i += 4) {
    if (sd[i + 3] >= 250) o37.opaque++;
    else if (sd[i + 3] > 40 && sd[i + 3] < 180 && sd[i] < 30 && sd[i + 1] < 30) { o37.shadow++; if (!o37.shadowSample) o37.shadowSample = [sd[i], sd[i+1], sd[i+2], sd[i+3]]; }
  }
  o37.after = { bg: scene.background === r37.bg, clearAlpha: renderer.getClearAlpha(), clearAlphaWas: r37.clearAlpha, shadows: renderer.shadowMap.enabled, aspect: camera.aspect, aspectWas: r37.aspect,
                catcherGone: !scene.children.some(function(c){ return c.material && c.material.isShadowMaterial; }),
                cast: !!App.keyLight && App.keyLight.castShadow };
  out.shot = o37;
  scene.remove(mg37); box37.geometry.dispose(); box37.material.dispose();
  modelGroup = r37.mg; App.meshes = r37.meshes; App.matSlot = r37.matSlot; App.selParts = r37.sel;
  cam.theta = r37.theta; cam.phi = r37.phi; cam.dist = r37.dist; cam.target.copy(r37.target); syncCamera();

  // ---- 3.29: the export settings are a window under the top bar, with a preview of each ----
  var w29 = {};
  // (a) the sections MOVED — same elements, same ids — and the sidebar kept what is painted with,
  // plus View & scene and Moving parts, which are docked there since 3.36 (floating is parked, 3.37)
  w29.expIn = !!document.querySelector("#winExport #expMode");
  w29.viewIn = !!document.querySelector("#rightbar #optBg");
  w29.poseIn = !!document.querySelector("#rightbar #posePanel");
  w29.setIn = !!document.querySelector("#winSettings #optUndoBudget");
  w29.sidebar = [].slice.call(document.querySelectorAll("#rightbar .section h3")).map(function(h){ return h.firstChild.textContent.trim(); });
  // (b) one window at a time, the button toggles, Escape closes, and nothing dims the page
  document.getElementById("btnExport").click();
  w29.open1 = TopWin.open + ":" + document.getElementById("winExport").style.display + ":" + (document.getElementById("btnExport").className.indexOf("active") >= 0);
  w29.noBackdrop = !document.querySelector(".modal");
  document.getElementById("btnSettingsWin").click();
  w29.open2 = TopWin.open + ":" + document.getElementById("winExport").style.display;
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
  w29.afterEsc = TopWin.open;
  // (c) docked at load with no float button and no pref row a stored false could undo it with
  // (3.36); dock(false) still works, for the day floating is fixed (3.37)
  var dockBtn = document.getElementById("btnViewDock");
  w29.dockedTo = document.getElementById("secView").parentElement.id + "," + document.getElementById("posePanel").parentElement.id;
  w29.noRow = !PREFS.some(function(r){ return r.id === "ui.viewDock"; });
  w29.floatHidden = !!dockBtn && dockBtn.style.display === "none" && TopWin.FLOAT_OFF === true;
  document.getElementById("btnViewWin").click();                    // docked: no window opens
  w29.dockedClickOpens = TopWin.open;
  TopWin.dock(false);
  w29.floatedTo = document.getElementById("secView").parentElement.id;
  TopWin.dock(true);
  // (d) the format preview: a 4×4 block holding olive, white AND red is what DXT5 cannot keep —
  // four colours on one line — so the crop must come back changed under Game (BC3) and identical
  // under Lossless. The crop is the sheet's centre, so the three hues meet there.
  var E = 128, ec = mkCanvas(E, E), eg = ctx2d(ec);
  eg.fillStyle = "#6e7852"; eg.fillRect(0, 0, E, E);
  eg.fillStyle = "#ffffff"; eg.fillRect(62, 40, 40, 40);
  eg.fillStyle = "#e01010"; eg.fillRect(61, 39, 4, 4);       // straddles the white rect's corner: block (60..63, 40..43) holds all three
  var es = { id: "t329_c", cStem: "t329_c", nStem: "t329_n", size: E, nSize: E, missing: false, layers: [], baseC: ec, composite: ec, _uvMasks: {} };
  var emask = new Uint8Array(E * E);
  for (var ey = 0; ey < E; ey++) for (var ex = 0; ex < E; ex++) emask[ey * E + ex] = ex < 70 ? 1 : 0;   // islands on the left, void on the right
  es._uvMasks[E + "x" + E] = emask;
  var slotsWas29 = App.slots, activeWas29 = App.activeSlot, presetWas29 = document.getElementById("expPreset").value;
  var padWas29 = document.getElementById("optPad").checked, mipsWas29 = document.getElementById("optMips").checked;
  App.slots = new Map([["t329_c", es]]); App.activeSlot = es;
  fit2D(); draw2DNow();                                       // the crop follows the 2-D view, so show it this slot
  document.getElementById("expPreset").value = "game"; document.getElementById("expPreset").onchange();
  document.getElementById("optPad").checked = true; document.getElementById("optMips").checked = true;
  TopWin.show("winExport");
  await ExportPreview.refresh();
  var pvText = function(id){ var e = document.getElementById(id); return e ? e.textContent : "(missing)"; };
  w29.bc3 = { tag: pvText("pvFmtTag"), cap: pvText("pvCap_out"), note: pvText("pvFmtNote").slice(0, 60), where: pvText("pvWhere") };
  w29.pad = { tag: pvText("pvPadTag"), note: pvText("pvPadNote") };
  w29.mip = { tag: pvText("pvMipTag"), chosen: document.getElementById("pvFig_mip").className, other: document.getElementById("pvFig_nomip").className };
  // the exported crop really differs from the source, pixel for pixel, and only under BC3
  var pxOf = function(name){ var c = ExportPreview.cv[name]; return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var srcPx = pxOf("src"), outPx = pxOf("out"), nd = 0;
  for (var pi = 0; pi < srcPx.length; pi++) if (Math.abs(srcPx[pi] - outPx[pi]) > 8) nd++;
  w29.bc3.texelsMoved = nd / 4;
  document.getElementById("expPreset").value = "lossless"; document.getElementById("expPreset").onchange();
  await ExportPreview.refresh();
  w29.rgba8 = { tag: pvText("pvFmtTag"), cap: pvText("pvCap_out") };
  srcPx = pxOf("src"); outPx = pxOf("out"); nd = 0;
  for (pi = 0; pi < srcPx.length; pi++) if (srcPx[pi] !== outPx[pi]) nd++;
  w29.rgba8.texelsMoved = nd / 4;
  document.getElementById("optPad").checked = false; await ExportPreview.refresh();
  w29.padOff = { tag: pvText("pvPadTag"), note: pvText("pvPadNote").slice(0, 40) };
  TopWin.close();
  document.getElementById("expPreset").value = presetWas29; document.getElementById("expPreset").onchange();
  document.getElementById("optPad").checked = padWas29; document.getElementById("optMips").checked = mipsWas29;
  App.slots = slotsWas29; App.activeSlot = activeWas29;
  // (e) Alpha is previewed by the viewport: the tint carries the export's own decision, and the
  // shader blends the camouflage through the sheet's alpha exactly when it ships — in the stock
  // branch too, which used to skip that mix.
  App.matPaint.set("t329mat", "camo_329"); App.paintColor.set("camo_329", [40, 90, 50]);
  var tintWas29 = App.paintTint, covWas29 = App.coverageOn, modeWas29 = document.getElementById("expMode").value, alphaWas29 = document.getElementById("expAlpha").value;
  App.paintTint = true; App.coverageOn = true;
  es.stockC = ec; es.stockA = new Uint8Array(E * E).fill(255); es.covBase = new Uint8Array(E * E);
  App.activeSlot = es;                                        // the sentence under Alpha reads the active slot
  document.getElementById("expMode").value = "set_tex";
  var shaderOf = function(){
    var t = paintTintFor("t329mat", es);
    var m = new THREE.MeshStandardMaterial(); applyPaintTint(m, t);
    var sh = { fragmentShader: "#include <alphamap_fragment>", uniforms: {} }; m.onBeforeCompile(sh);
    return { keep: t.keepAlpha, mix: /wtPaint = mix\\( wtCamo, [^,]+, wtCov \\)/.test(sh.fragmentShader), cov: (/wtCov = mix\\( 1\\.0, diffuseColor\\.a, ([0-9.]+) \\)/.exec(sh.fragmentShader) || [])[1] };
  };
  document.getElementById("expAlpha").value = "auto";  w29.alphaAuto = shaderOf();
  document.getElementById("expAlpha").value = "keep";  w29.alphaKeep = shaderOf();
  document.getElementById("expAlpha").value = "opaque"; w29.alphaOpaque = shaderOf();
  // and the sentence under the control says which, for the same three
  document.getElementById("expAlpha").value = "auto"; ExportPreview.notes(); w29.noteAuto = document.getElementById("expAlphaNote").textContent.slice(0, 40);
  document.getElementById("expAlpha").value = "keep"; ExportPreview.notes(); w29.noteKeep = document.getElementById("expAlphaNote").textContent.slice(0, 40);
  w29.noteMode = document.getElementById("expModeNote").textContent.slice(0, 8);
  document.getElementById("expMode").value = "replace_tex"; ExportPreview.notes(); w29.noteModeR = document.getElementById("expModeNote").textContent.slice(0, 12);
  document.getElementById("expMode").value = modeWas29; document.getElementById("expAlpha").value = alphaWas29;
  App.paintTint = tintWas29; App.coverageOn = covWas29; App.activeSlot = activeWas29;
  App.matPaint.delete("t329mat"); App.paintColor.delete("camo_329");
  out.win29 = w29;

  // ---- 3.30, the selection half (option B): the quick pick stays and becomes visible, the
  // modifiers mean one thing everywhere, and the Selection tab is two grains over one verb row ----
  var s30 = {};
  var mg30 = new THREE.Group(), keep30 = { mg: modelGroup, meshes: App.meshes, sel: App.selParts, prot: App.protectedParts, over: App.over3d, ctrl: App.ctrlHeld, island: SelectUI.island, on: SelectUI.on, paint: App.paint3d, placing: App.placing };
  var mk30 = function(n){ var m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); m.name = n; m.userData = { mat: "m30" }; mg30.add(m); return m; };
  App.meshes = new Map([["hull30", mk30("hull30")], ["turret30", mk30("turret30")], ["gun30", mk30("gun30")]]);
  modelGroup = mg30; App.selParts = new Set(); App.protectedParts = new Set();
  App.paint3d = true; App.placing = false; SelectUI.setOn(false); SelectUI.setIslandMode(false);
  var cnv30 = document.getElementById("view3d");
  // (a) Ctrl down with the pointer over the model: a hand, and the status line names the gestures
  App.over3d = true; ctrlHeld(false);
  document.getElementById("status").textContent = "";
  ctrlHeld(true);
  s30.cursorPart = cnv30.style.cursor; s30.said = document.getElementById("status").textContent;
  SelectUI.setIslandMode(true); refreshViewCursor(); s30.cursorIsland = cnv30.style.cursor; SelectUI.setIslandMode(false);
  ctrlHeld(false); s30.cursorReleased = cnv30.style.cursor;            // painting's crosshair is back
  App.over3d = false; ctrlHeld(true); s30.cursorAway = cnv30.style.cursor; s30.saidAway = document.getElementById("status").textContent === s30.said;
  ctrlHeld(false); App.over3d = true;
  // (b) the Parts list: Shift adds, Alt removes, plain toggles — and Alt no longer excludes
  App.selParts = new Set(["hull30"]);
  selectionSet(["turret30"], true);                                    // what a Shift+click does
  s30.shiftAdds = App.selParts.has("turret30") && App.selParts.has("hull30");
  selectionSet(["hull30"], false);                                     // what an Alt+click does
  s30.altRemoves = !App.selParts.has("hull30") && !App.protectedParts.has("hull30");
  // through the real row: build the Parts panel and click a name with Alt
  refreshPartList();
  var nameEl = [].slice.call(document.querySelectorAll("#partList span")).filter(function(e){ return /turret30/.test(e.textContent); })[0];
  if (nameEl) nameEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
  s30.altClickRow = { selected: App.selParts.has("turret30"), excluded: App.protectedParts.has("turret30"), found: !!nameEl };
  // (c) the verbs act on the live grain, and the row says which
  SelectUI.setOn(false);
  s30.labelParts = document.getElementById("selGrainLabel").textContent;
  document.getElementById("btnSelAll").click(); s30.allParts = App.selParts.size;
  document.getElementById("btnSelInvert").click(); s30.invertedParts = App.selParts.size;
  document.getElementById("btnSelNone").click(); s30.noneParts = App.selParts.size;
  s30.invertOff = document.getElementById("btnSelInvert").disabled;
  SelectUI.setOn(true);
  s30.labelArea = document.getElementById("selGrainLabel").textContent;
  s30.invertOffArea = document.getElementById("btnSelInvert").disabled;
  // Rows ON SCREEN: the wand's Tolerance / Contiguous row (4.50 (9)) is in the markup always and shown
  // only while the wand is the kind, the way the Brush panel's Clone row is shown only for Clone.
  s30.rows = [].filter.call(document.querySelectorAll("#selSection > .row"), function(r){ return r.style.display !== "none"; }).length;
  s30.wandRowHidden = document.getElementById("selWandRow").style.display === "none";
  s30.folded = !!document.querySelector("#selSection details #selX") && !!document.querySelector("#selSection details #btnSelToMask");
  SelectUI.setOn(keep30.on); SelectUI.setIslandMode(keep30.island);
  modelGroup = keep30.mg; App.meshes = keep30.meshes; App.selParts = keep30.sel; App.protectedParts = keep30.prot;
  App.over3d = keep30.over; App.ctrlHeld = keep30.ctrl; App.paint3d = keep30.paint; App.placing = keep30.placing; refreshViewCursor();
  refreshPartList();
  out.sel30 = s30;

  // ---- 4.41: the rainbow coating has its rainbow — a view-angle term, not a texture ----
  // A quad of the game's rainbow-coated glass, rendered face-on and at grazing angles into a
  // target and read back at the centre: face-on it is the tint; edge-on it gains chroma, and the
  // dominant channel moves as the angle does (interference cycles). Black glass gains none.
  var g41 = App.matGlass; App.matGlass = new Map([["glass41r", { cls: "dynamic_glass_chrome", coat: "rainbow" }], ["glass41b", { cls: "dynamic_glass_chrome", coat: "black" }]]);
  var mr41 = makeMaterial("glass41r", "canopy"), mb41 = makeMaterial("glass41b", "canopy");
  var rt41 = new THREE.WebGLRenderTarget(32, 32), sc41 = new THREE.Scene();
  sc41.background = new THREE.Color(0x000000); sc41.add(new THREE.AmbientLight(0xffffff, .3));
  var cam41 = new THREE.PerspectiveCamera(40, 1, .1, 100); cam41.position.set(0, 0, 6); cam41.lookAt(0, 0, 0);
  var quad41 = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), mr41); sc41.add(quad41);
  var px41 = function(){ renderer.setRenderTarget(rt41); renderer.render(sc41, cam41); var b = new Uint8Array(4); renderer.readRenderTargetPixels(rt41, 16, 16, 1, 1, b); renderer.setRenderTarget(null); return [b[0], b[1], b[2]]; };
  var chroma41 = function(c){ return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); };
  var top41 = function(c){ return c.indexOf(Math.max(c[0], c[1], c[2])); };
  var o41 = {};
  quad41.rotation.y = 0;    o41.face = px41();
  quad41.rotation.y = 0.9;  o41.mid = px41();
  quad41.rotation.y = 1.45; o41.graze = px41();
  quad41.material = mb41;   o41.grazeBlack = px41();
  o41.chroma = { face: chroma41(o41.face), mid: chroma41(o41.mid), graze: chroma41(o41.graze), black: chroma41(o41.grazeBlack) };
  o41.top = { mid: top41(o41.mid), graze: top41(o41.graze) };
  o41.keys = { rainbow: mr41.customProgramCacheKey(), black: mb41.customProgramCacheKey() };
  rt41.dispose(); quad41.geometry.dispose(); mr41.dispose(); mb41.dispose();
  App.matGlass = g41;
  out.irid41 = o41;

  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 600), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("\n=== 3.11(b) the search input no longer paints over the reset button ===");
console.log("   sidebar    input   gap to reset      (was: 181 px input, gap -52.7 / -22.7 / -2.7 / +3.3)");
for (const c of o.row) console.log(`   ${String(c.w).padStart(4)} px  ${String(c.inputW).padStart(7)} ${String(c.gap).padStart(9)}`);
for (const c of o.row) R.is(c.gap > 0, `at a ${c.w} px sidebar the input ends ${c.gap} px before the reset button`);
for (const c of o.row) R.is(c.insideBar >= 0, `and the reset button stays inside the sidebar at ${c.w} px (${c.insideBar} px to spare)`);
R.is(o.row.every((c, i, a) => i === 0 || c.inputW > a[i - 1].inputW),
  "the input tracks the sidebar width instead of holding one intrinsic size");
R.is(o.row.filter(c => c.w <= 250).every(c => c.inputW < 181),
  "and at every width that used to overlap it is now narrower than the 181 px it refused to go below");
for (const m of o.minWidths) R.is(m.minWidth === "0px", `${m.id} declares min-width:0 (${m.minWidth})`);
const escaped = o.selects.filter(s => s.pastRow > 0 || s.pastHost > 0);
console.log(`   and ${o.selects.length} <select>s in a .row, none of them past its own row` +
  (escaped.length ? " — EXCEPT " + escaped.map(s => `${s.id} +${Math.max(s.pastRow, s.pastHost)}px`).join(", ") : ""));
R.is(escaped.length === 0,
  escaped.length ? `selects overrunning their row or panel: ${escaped.map(s => s.id).join(", ")}`
    : `no <select> in a .row overruns it — the trap that shipped in expMode (+13 px past #rightbar), expAlpha (+84) and expCamoBase (+101)`);
R.is(o.selects.every(s => s.minWidth === "0px"), `and all ${o.selects.length} declare min-width:0, so a reworded option cannot move them`);

console.log("\n=== 3.32 the filter chip rows split by line count, not by where a label ends ===");
console.log("   sidebar   class      flags      ranks      (was, flex-wrap: 2+3 / 3+2 / 4+1 · 6+4 / 8+2 · 7+1)");
for (const c of o.chips) console.log(`   ${String(c.w).padStart(4)} px   ${c.gameClassRow.split.join("+").padEnd(8)}   ${c.gameNationRow.split.join("+").padEnd(8)}   ${c.gameRankRow.split.join("+")}`);
for (const id of ["gameClassRow", "gameNationRow", "gameRankRow"]) {
  const rows = o.chips.map(c => ({ w: c.w, ...c[id] }));
  R.is(rows.every(r => r.split.length === r.greedy),
    `${id}: never more lines than flex-wrap would have used (${rows.map(r => r.split.length + "/" + r.greedy).join(" ")})`);
  R.is(rows.every(r => Math.max(...r.split) - Math.min(...r.split) <= 1),
    `${id}: every line within one chip of every other (${rows.map(r => r.split.join("+")).join(" · ")})`);
  R.is(rows.every(r => !r.overflow), `${id}: no line overflows its row`);
  // At one line count the split may still change once — 2+3 at 220 px becomes 3+2 at 230, because
  // a three-chip first line is 194 px and the row is 190 — but only in one direction: widening the
  // sidebar moves chips UP to an earlier line, never back down. Lexicographic order says exactly that.
  const frontHeavier = (a, b) => { for (let k = 0; k < Math.max(a.length, b.length); k++) { const d = (a[k] || 0) - (b[k] || 0); if (d) return d > 0; } return true; };
  R.is(rows.every((r, i) => i === 0 || r.split.length !== rows[i - 1].split.length || frontHeavier(r.split, rows[i - 1].split)),
    `${id}: at one line count, widening only ever moves a chip to an earlier line`);
  R.is(rows.every((r, i) => i === 0 || r.split.length <= rows[i - 1].split.length), `${id}: a wider sidebar never adds a line`);
}
R.is(o.chips.every(c => c.gameNationRow.aligned), "the second line of flags sits in the first line's columns");

console.log("\n=== 3.11(a) the carets are triangles, not dots ===");
console.log(`   open ${o.caretOpen.w}x${o.caretOpen.h} px at opacity ${o.caretOpen.opacity} in ${o.caretOpen.colour}   (was ~5x3 px of glyph ink at .6)`);
R.is(o.caretOpen.w >= 8 && o.caretOpen.h >= 5, `the open caret is ${o.caretOpen.w}x${o.caretOpen.h} px of ink`);
R.is(o.caretOpen.opacity === "1", `at full opacity (${o.caretOpen.opacity})`);
R.is(o.caretOpen.colour === o.caretOpen.headerColour, `in the header's own colour (${o.caretOpen.colour})`);
R.is(o.caretOpen.glyph === '""' || o.caretOpen.glyph === "none", `drawn rather than typed, so it is the same on every platform (content: ${o.caretOpen.glyph})`);
R.is(o.caretClosed.w >= 5 && o.caretClosed.h >= 8, `and it turns on collapse — ${o.caretClosed.w}x${o.caretClosed.h} px pointing right`);
R.is(o.collapseHides && o.reopened, "collapsing still hides the section, and clicking again brings it back");
R.is(o.miniRightGap === 0, "the header's button row is still flush right, so the new flex item did not move it");
for (const c of o.otherCarets) R.is(c.ink && c.ink.w >= 5 && c.ink.h >= 5, `${c.sel} got the same treatment (${c.ink ? c.ink.w + "x" + c.ink.h : "missing"})`);

console.log("\n=== 3.14 a mode is visible on the control that sets it ===");
console.log(`   .primary          ${o.primaryOnly}`);
console.log(`   .primary.active   ${o.primaryPlusActive}`);
R.is(o.primaryOnly !== o.primaryPlusActive, "adding .active to a .primary button changes how it looks");
R.is(o.plainOnly !== o.plainPlusActive, "and it still changes a plain button");
R.is(o.primaryPlusActive === o.plainPlusActive, "with the same result either way — .active means one thing");
const activeBg = o.primaryPlusActive.split(" / ")[0], activeFg = o.primaryPlusActive.split(" / ")[2];
R.is(o.tab.bg !== activeBg && o.tab.colour !== activeFg,
  `the sidebar tabs keep their own look — ${o.tab.bg} on ${o.tab.colour}, not the ${activeBg} chip`);
const SW = o.sw || {}, swA = l => (l || []).filter(b => b.active).map(b => b.place).join(",");
console.log(`   projected: ${JSON.stringify((SW.proj || []).map(b => b.text + (b.active ? "*" : "")))}  ·  flat: ${JSON.stringify((SW.flat || []).map(b => b.text + (b.active ? "*" : "")))}`);
R.is(swA(SW.proj) === "model" && swA(SW.flat) === "sheet" && (SW.proj || []).length === 2 && (SW.flat || []).length === 2,
  "a decal's panel has one placement switch, On the model / On the texture, lit on the placement it has — the projected panel on the model, the flat one on the texture");
R.is(SW.proj && SW.proj[0].css !== SW.proj[1].css, "and the lit one looks different, not only reads different");
R.is(SW.old && SW.old.length === 0, `and the three mode buttons it replaces are gone (${JSON.stringify(SW.old)})`);
R.is(o.gWithNoDecal === "" && !o.gInHints && !o.gInKeymap,
  `G armed the Moving mode, which is gone: it is out of the hints and the keymap, and says nothing ("${o.gWithNoDecal}")`);

console.log("\n=== 3.10 the Vehicle name is a control only when it is one ===");
R.is(o.vehAtBoot.input && !o.vehAtBoot.span && !o.vehAtBoot.pencil,
  "an empty app opens with a field and no edit button, because nothing is ticked to protect it from");
R.is(o.vehSettled.span && !o.vehSettled.input, `with a unit ticked it is plain text — "${o.vehSettled.spanText}"`);
R.is(o.vehSettled.spanText === o.vehSettled.value, "showing exactly the value every reader still asks the input for");
R.is(o.vehSettled.pencil, "and the edit button is there to override it");
R.is(o.vehSettledUnits.join(",") === "us_m1a2_sep3_abrams", `the .blk is named from the ticked unit (${o.vehSettledUnits.join(", ")})`);
R.is(o.vehUnlocked.input && !o.vehUnlocked.span && !o.vehUnlocked.readOnly, "unlocking gives a real, editable field — not a read-only one");
R.is(o.vehUnlocked.pencilActive, "and the button shows that it is on, instead of swapping to a lock emoji");
R.is(o.vehOpen.input && !o.vehOpen.span, "with nothing ticked it is a field, because then it IS the .blk name");
R.is(!o.vehOpen.pencil, "and the edit button is gone, because there is nothing to protect");
R.is(o.vehOpenUnits.join(",") === "us_m1a2_sep3_abrams", `which is what names the file (${o.vehOpenUnits.join(", ")})`);
R.is(o.vehAfterTyping.spanText === "typed_by_hand", `typing reaches the settled text — "${o.vehAfterTyping.spanText}"`);
R.is(!o.vehSettled.readOnly && !o.vehOpen.readOnly, "the input is never read-only now: it is hidden when it should not be typed in");
R.is(o.vehUnlockedOnA.input && o.vehUnlockedOnA.pencilActive, "unlocking one vehicle's name opens its field");
R.is(o.vehOnNextVehicle.span && !o.vehOnNextVehicle.input && !o.vehOnNextVehicle.pencilActive,
  `and loading a different vehicle takes the unlock back — "${o.vehOnNextVehicle.spanText}" as plain text again`);

console.log("\n=== 3.15 the picker picks from the channel the brush writes ===");
for (const [mode, r] of Object.entries(o.pick)) {
  console.log(`   ${mode.padEnd(8)} value ${String(r.value).padStart(3)} (want ${r.want === null ? "—" : r.want})  ` +
    `colour ${r.colour}  slider ${r.slider}/${r.shown}  "${r.said}"`);
  if (r.want === null) {
    R.is(r.colour === "#4080c0", `${mode}: still picks the albedo as a hex (${r.colour})`);
    R.is(/Picked #4080c0/.test(r.said), `${mode}: and says so — "${r.said}"`);
  } else {
    R.is(r.value === r.want, `${mode}: picks ${r.want} off the ${mode} sheet, not a hex off the albedo (got ${r.value})`);
    R.is(r.slider === r.want && r.shown === String(r.want), `${mode}: and the Value slider follows it (${r.slider}/${r.shown})`);
    R.is(r.said.indexOf(String(r.want)) >= 0 && !/#/.test(r.said), `${mode}: the status line names the value — "${r.said}"`);
  }
}
const near = (a, b) => a && b && [0, 1, 2].every(i => Math.abs(a[i] - b[i]) <= 3);
const rgb = a => a ? "rgb(" + a.join(",") + ")" : "null";
R.is(near(o.camo.bare, [107, 74, 47]) && near(o.camo.bare, o.camo.drawnBare),
  `over a bare texel the picker gives the colour the view DRAWS there ${rgb(o.camo.bare)}, not the composite's ${rgb(o.camo.composite)} — the reported "the colour I copied is not the colour I painted"`);
R.is(near(o.camo.covered, [64, 128, 192]) && near(o.camo.covered, o.camo.drawnCovered),
  `and over a covered texel it is unchanged ${rgb(o.camo.covered)}, because there the paint IS what is on screen`);
R.is(o.camo.picked === "#6b4a2f" && /coverage mask/i.test(o.camo.said || ""),
  `the brush takes that colour (${o.camo.picked}) and the status line says where it came from, because two different answers to "what colour is this" need one of them named`);
R.is(o.pickLayered.value === o.pickLayered.want,
  `and it reads the layer stack, not the imported sheet — a metal fill of 30 picks ${o.pickLayered.value}`);

console.log("");
console.log("=== 3.17 Compare shows the original of every map, not only the albedo ===");
console.log(`   live ${o.cmpLive}   held ${o.cmpOn.maps}   released ${o.cmpOff.maps}`);
R.is(o.cmpTex, "the slot's three surface textures exist");
R.is(o.cmpLive === "smooth=live metal=base normal=base",
  `only the layered channel differs from its base to begin with (${o.cmpLive})`);
R.is(o.cmpOn.alb, "holding Compare swaps the albedo (it always did)");
R.is(o.cmpOn.maps === "smooth=base metal=base normal=base",
  `and every surface map points at the imported sheet — the half that was reported missing (${o.cmpOn.maps})`);
R.is(o.cmpOff.alb && o.cmpOff.maps === o.cmpLive, `releasing it puts them all back (${o.cmpOff.maps})`);

console.log("\n=== 4.2 the decal editor keeps the image until it is asked not to ===");
R.is(o.decal.options[0] === "off" && o.decal.value === "off", `it opens on "Keep as-is" (${o.decal.options.join(", ")})`);
R.is(o.decal.cornerAlpha === 255, `and the corner pixel is still there — alpha ${o.decal.cornerAlpha}, rgb(${o.decal.cornerRGB})`);
R.is(o.decalAfterGuess.cornerAlpha === 0, `the corner guess is still one click away — alpha ${o.decalAfterGuess.cornerAlpha} after picking it`);

console.log("\n=== 4.8 (interim) the Look control says what it does, and the bake refuses a no-op ===");
R.is(o.surf.oneTable, "there is one preset table — DECAL_SURF is gone");
R.is(o.surf.keys.join(",") === "painted,vinyl,stencil,none", `and it holds all four Looks (${o.surf.keys.join(", ")})`);
R.is(o.look.options.join(",") === "painted,vinyl,stencil,none",
  `the editor offers them in that order (${o.look.options.join(", ")})`);
R.is(o.surf.sidebar.length === 5 && o.surf.sidebar[4].startsWith("custom="),
  `the sidebar offers the same four plus Custom (${o.surf.sidebar.map(s => s.split("=")[0]).join(", ")})`);
R.is(o.surf.sidebar.slice(0, 4).map(s => s.split("=")[1]).join(" | ") ===
     o.look.options.map((k, i) => o.surf.sidebar[i].split("=")[1]).join(" | "),
  "with one set of labels rather than two that had already drifted apart");
console.log(`   editor hint: ${o.look.hint}`);
// These five were written for the 2026-08-25 interim, when the honest thing the control could say
// was "this only moves three sliders in the sidebar". 4.8 in full made that false: the look lands.
// The property they protect is unchanged — the control says what it actually does — so they have
// been rewritten twice rather than deleted. The third one is the record of that: it required the
// sentence "projecting it does not carry the look" until 4.8b made projections carry it
// (2026-08-26), and it now requires the opposite. An exception that has been fixed and is still
// printed is the same defect as one that was never named. The first was rewritten a third time on
// 2026-09-24: it required "as layers in a group", which 4.28(f) had made false three weeks before —
// the response is content in the decal's own layer — and this test was holding the stale sentence in.
R.is(/inside the decal's own layer/.test(o.look.hint) && !/in a group/.test(o.look.hint),
  "the editor states that the look arrives inside the decal's own layer, not as layers in a group (4.28(f))");
R.is(/never written/.test(o.look.hint), "and that the slot's own _n sheets are not touched — the difference from the old bake");
R.is(/[Pp]rojecting.*carries the look/.test(o.look.hint) && !/does not carry/.test(o.look.hint),
  "and that projecting it carries the look — the exception this line used to require is fixed, so printing it would now be the untrue half");
R.is(/Gloss \+20/.test(o.look.hint) && /Emboss 0/.test(o.look.hint), "with the actual numbers of the chosen Look");
R.is(/Gloss \+55/.test(o.lookVinyl.hint) && /Emboss 6/.test(o.lookVinyl.hint),
  "which follow the choice — vinyl reads Gloss +55, Emboss 6");
R.is(/No surface change/.test(o.lookNone.hint), `and "None" says so outright — "${o.lookNone.hint}"`);
R.is(!!o.look.title && /not|neither/i.test(o.look.title), "the select's own tooltip says it changes nothing on its own");
// The editor's hint above was the only one of these that anything read. The Projected image panel's
// Look tooltip and the sidebar button's tooltip said "in a group with the decal" until 4.50 (17),
// 2026-09-25, and the button was still NAMED "Apply as layers" until that item's review on
// 2026-09-26 — the most visible place the pre-4.28(f) model survived, because it is the label the
// user clicks. Proved able to fail by putting the two old tooltips and the old name back.
const LT = o.lookTips;
console.log(`   sidebar button: “${LT.applyName}”`);
R.is(/own layer/.test(LT.proj) && !/in a group|layer per channel/.test(LT.proj),
  "the Projected image panel's Look tooltip says the response is on the decal's own layer, not a layer per channel in a group");
R.is(/own layer/.test(LT.apply) && !/in a group/.test(LT.apply) && !/\blayers\b/i.test(LT.applyName),
  `the sidebar's Apply button says the same in its tooltip, and its name does not promise layers (“${LT.applyName}”)`);
R.is(!!LT.applyName && LT.hint.includes(LT.applyName) && LT.bake.includes(LT.applyName),
  "and the hint under it and the Bake button's tooltip call it by the name it has, not by an old one");
console.log(`   bake 0/0/0: "${o.surf.bakeNothing.text}"`);
R.is(o.surf.bakeNothing.cls === "err" && /nothing to bake/.test(o.surf.bakeNothing.text),
  "a Look with three zero deltas is refused instead of reported as baked");
R.is(/baked/.test(o.surf.bakeSomething.text) && o.surf.bakeSomething.cls !== "err",
  `and a Look with something in it still bakes — "${o.surf.bakeSomething.text}"`);
for (const t of o.surf.roundTrip)
  R.is(t.shown === t.asked, `a decal saved as "${t.asked}" comes back to the sidebar as "${t.shown}", not Custom`);
R.is(o.surf.roundTrip.every(t => !t.custom), "and none of the four opens the Custom sliders");
console.log(`   saved record: ${o.saved ? o.saved.fields.join(", ") : "NOT SAVED"}`);
R.is(!!o.saved, "a save through the library still writes a record");
R.is(o.saved && o.saved.png, "with the cut-out image in it");
R.is(o.saved && !o.saved.hasNormal, "and no generated-normal blob — that was one dead PNG per decal, written and never read");
R.is(o.saved && o.saved.surfKeys.join(",") === "em,mt,preset,sm,wr",
  `the look is stored as data only (${o.saved ? o.saved.surfKeys.join(", ") : "—"}) — no select label leaked out of the table`);
R.is(o.applied && o.applied.join(",") === "em,mt,preset,sm,wr",
  `and the same shape reaches the layer when the decal is used (${o.applied ? o.applied.join(", ") : "—"})`);

console.log("\n=== 3.20 the 2-D brush ring follows the pointer while you paint ===");
console.log(`   pressed, then moved twice: ${o.ring.movedWhilePainting} px, then a further ${o.ring.keptMoving} px`);
R.is(o.ring.painting, "the pointerdown really started a stroke — otherwise this would be testing the not-painting branch that always worked");
R.is(o.ring.movedWhilePainting > 5,
  `the ring moves with the first drag (${o.ring.movedWhilePainting} px) — it used to stay at the stroke's start for the whole stroke`);
R.is(o.ring.keptMoving > 5, `and keeps up on every move after that (${o.ring.keptMoving} px)`);

console.log("\n=== 3.13 the mirror plane has a switch of its own ===");
for (const m of ["off", "adjust", "always"])
  console.log(`   ${m.padEnd(7)} idle ${String(o.planeStates[m].idle).padEnd(5)} while adjusting ${o.planeStates[m].preview}`);
R.is(!o.planeStates.off.idle && !o.planeStates.off.preview, "“Never” means never — not even while the symmetry rows are being touched");
R.is(!o.planeStates.adjust.idle && o.planeStates.adjust.preview,
  "“While adjusting” shows it only while symmetry is being adjusted — the default, and the reported complaint");
R.is(o.planeStates.always.idle && o.planeStates.always.preview,
  "“Always” keeps it up, which is what the app used to do whenever symmetry was on");
R.is(o.planeIgnoresSymOn.shownWithSymOff && o.planeIgnoresSymOn.hiddenWithSymOn,
  "and it no longer reads symOn in either direction — mirrored painting and drawing a plane are two questions");
console.log("   quad, on a 12x3x8 model centred at (1,2,3), mirrorCenters (40,50,0):");
for (const a of ["x", "y", "z"])
  console.log(`     mirror ${a}:  x ${o.planeBox[a].x.join(" → ")}   y ${o.planeBox[a].y.join(" → ")}   z ${o.planeBox[a].z.join(" → ")}`);
const flatAt = (a, v) => o.planeBox[a][a][0] === v && o.planeBox[a][a][1] === v;
R.is(flatAt("x", 40) && flatAt("y", 50) && flatAt("z", 0), "the quad is flat at the mirror plane on the mirror axis (40 / 50 / 0)");
// 12 x 1.06 = 12.72 about 1 -> [-5.36, 7.36];  3 x 1.06 = 3.18 about 2 -> [0.41, 3.59];  8 x 1.06 = 8.48 about 3 -> [-1.24, 7.24]
const span = (a, ax) => +(o.planeBox[a][ax][1] - o.planeBox[a][ax][0]).toFixed(2);
R.is(span("z", "x") === 12.72 && span("z", "y") === 3.18,
  `mirroring on z spans the model's x and y, not max(size) (${span("z","x")} x ${span("z","y")}, was 18 x 18)`);
R.is(span("x", "z") === 8.48 && span("x", "y") === 3.18, `on x it spans z and y (${span("x","z")} x ${span("x","y")})`);
R.is(span("y", "x") === 12.72 && span("y", "z") === 8.48, `on y it spans x and z (${span("y","x")} x ${span("y","z")})`);
R.is(o.planeBox.z.x[0] === -5.36 && o.planeBox.z.y[0] === 0.41,
  "centred on the model, not on mirrorCenters — those are per-axis medians and mean nothing off the mirror axis");

console.log("\n=== 3.16 the 3-D view follows the layer, until you pick one yourself ===");
R.is(o.autoOption === 1, `Auto is an entry in the same select, right after Shaded (index ${o.autoOption})`);
R.is(o.autoOn.auto && o.autoOn.sel === "auto", "choosing it turns Auto on and the select keeps saying so");
for (const f of o.autoFollows) console.log(`   ${f.layer.padEnd(7)} → ${f.view.padEnd(7)} (select still “${f.sel}”)`);
const chanFor = ch => (o.autoFollows.find(f => f.layer === ch) || {}).view;
R.is(chanFor("color") === "shaded" && chanFor("wear") === "shaded", "colour and wear stay shaded — both read correctly lit");
R.is(chanFor("smooth") === "smooth" && chanFor("metal") === "metal" && chanFor("normal") === "normal",
  "and the three surface maps switch to themselves, flat and unlit, where the edit is actually visible");
R.is(o.autoFollows.every(f => f.auto && f.sel === "auto"),
  "following the layer does not turn Auto off, and the select never drifts off “auto”");
R.is(!o.autoOffAfterManual.auto && o.autoOffAfterManual.sel === "normal" && o.autoOffAfterManual.view === "normal",
  "a manual pick — the select, a channel cell, the context menu or the Shaded button — turns Auto off");
R.is(o.autoSurvivesItsOwn.auto && o.autoSurvivesItsOwn.sel === "auto" && o.autoSurvivesItsOwn.view === "smooth",
  "while a switch Auto made itself does not, or it would turn itself off on the first layer it followed");

// Just the numbers, so the two lines above stay readable.
const out49 = rows => Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.eyeX]));

console.log("\n=== 4.9a: the fold caret exists, and the eye column stands still ===");
console.log(`   open   ${JSON.stringify(out49(o.lcaretOpen))}`);
console.log(`   closed ${JSON.stringify(out49(o.lcaretClosed))}`);
R.is(o.lcaretOpen.G.caretW > 0 && o.lcaretOpen.G.caretH > 0 && o.lcaretClosed.G.caretW > 0 && o.lcaretClosed.G.caretH > 0,
  `the caret has a box in BOTH states (open ${o.lcaretOpen.G.caretW}x${o.lcaretOpen.G.caretH}, closed ${o.lcaretClosed.G.caretW}x${o.lcaretClosed.G.caretH}) — it was 10x0 and 0x10, so a collapsed group could not be opened at all and the context menu has no fold entry`);
R.is(o.lcaretOpen.G.topStyle === "solid" && o.lcaretClosed.G.leftStyle === "solid",
  "and its triangle is actually drawn — an undefined var() in a shorthand falls back to border-style:none, which paints nothing while still taking layout");
R.is(!/rgba\(0, 0, 0, 0\)/.test(o.lcaretOpen.G.topColor),
  `in a colour this stylesheet defines (${o.lcaretOpen.G.topColor})`);
R.is(o.lcaretOpen.G.caretW === o.lcaretClosed.G.caretW,
  "the two states are the same width, so folding a group does not slide its own eye sideways");
R.is(o.lcaretOpen.G.eyeX === o.lcaretOpen.loose.eyeX,
  `a group and a layer at the same depth put their eye in the same column (${o.lcaretOpen.G.eyeX} and ${o.lcaretOpen.loose.eyeX}) — the caret's box is reserved on rows that have none`);
R.is(o.lcaretClosed.G.eyeX === o.lcaretOpen.G.eyeX,
  `and folding leaves it there (${o.lcaretClosed.G.eyeX})`);
R.is(o.lcaretDepth.kid.eyeX > o.lcaretDepth.G.eyeX,
  `a group's child is indented PAST its parent (${o.lcaretDepth.kid.eyeX} against ${o.lcaretDepth.G.eyeX}) — it used to sit to the left of it, so the tree read upside down`);

console.log("\n=== a finished load lands you on Textures (3.23) ===");
const TB = o.tab323;
console.log(`   from vehicle -> ${TB.fromVehicle} · parts -> ${TB.fromParts} · arms -> ${TB.fromWeapons} · paint -> ${TB.alreadyThere} · nothing loaded -> ${TB.noSlots}`);
R.is(TB.fromVehicle === "paint",
  "a load that finishes with something to paint moves off Vehicle — that tab is where you go to FIND a model, so a load completing is the moment its job is done");
R.is(TB.fromParts === "parts" && TB.fromWeapons === "weapons",
  `but not from Parts or Arms (${TB.fromParts}, ${TB.fromWeapons}) — somebody replacing a model while they are in there is somewhere on purpose, and moving them is a mode change nobody asked for`);
R.is(TB.noSlots === "vehicle",
  "and not when the load produced no texture slots, where Textures would be an empty panel and Vehicle is still the useful one");

console.log("\n=== the view switch, after the divider has been dragged (4.31) ===");
const VM = o.vm;
console.log(`   dragged ${JSON.stringify(VM.dragged)} · 3D ${JSON.stringify(VM.only3d)} · 2D ${JSON.stringify(VM.only2d)} · back ${JSON.stringify(VM.back)}`);
// Flexbox hands out only `sum(flex-grow) x free space` when that sum is under 1 (Flexbox §9.7), and
// the split's two grows were `r` and `1 - r`. Together they sum to 1 and the split is right; hide
// one pane and the survivor holds `r` alone. Dragged to 0.6, "3D" left the 3-D pane covering 60 %
// of the row with #views' own background beside it — reported as "it does not switch completely
// and the screen stays split, but tooltips get hidden", the tooltips being the hidden pane's label
// and buttons, which DID go. The numbers are the whole point of this one: the mode was never the
// thing that failed, the width was.
R.is(VM.only3d.v3 >= VM.only3d.views - 4,
  `"3D" gives the whole row to the 3-D pane (${VM.only3d.v3} of ${VM.only3d.views}) — at a 0.6 split it used to take 0.6 of it and leave the rest empty`);
R.is(VM.only2d.v2 >= VM.only2d.views - 4,
  `and "2D" the whole row to the 2-D pane (${VM.only2d.v2} of ${VM.only2d.views})`);
R.is(Math.abs(VM.back.v3 - VM.dragged.v3) <= 1 && Math.abs(VM.back.v2 - VM.dragged.v2) <= 1,
  `going back to Split restores the dragged split rather than an even one (${VM.back.v3}/${VM.back.v2} against ${VM.dragged.v3}/${VM.dragged.v2})`);
R.is(VM.ratio === 0.6,
  `and the ratio the settings save reads back as the dragged one (${VM.ratio}) — it is stored now, because a solo pane's grow no longer describes it`);

console.log("\n=== the armed placing buttons say what they are waiting for (4.32) ===");
const AR = o.arm;
console.log(`   "${AR.off}" -> "${AR.on}" -> "${AR.back}"`);
R.is(AR.on !== AR.off && /click/i.test(AR.on) && AR.active && AR.back === AR.off,
  "the one armed click left, the radial centre, says what it is waiting for while armed and puts its label back after");

console.log("\n=== one decal editor, however many pastes arrive (4.33) ===");
const DE = o.dedit;
console.log(`   ${DE.before} -> open ${DE.one} -> second open ${DE.two} -> closed ${DE.afterClose} -> reopened ${DE.reopened}`);
R.is(DE.one === DE.before + 1 && DE.two === DE.one,
  `a second image while the editor is up opens no second dialog (${DE.two}) — holding Ctrl+V fires a paste per key repeat, and each one used to build its own`);
R.is(/already open/.test(DE.said), `and it says why rather than doing nothing: "${DE.said.slice(0, 80)}"`);
R.is(DE.afterClose === DE.before && DE.reopened === DE.before + 1 && DE.end === DE.before,
  "closing it releases the guard, so the next image opens normally — the flag is cleared by the dialog's own close, not by the caller remembering");

console.log("\n=== one switch for what is drawn, in one panel (4.39) ===");
console.log("   Arms tab checkboxes: " + (o.vis.inArms.join(", ") || "none") + " · Scene tab: " + o.vis.inScene.join(", "));
R.is(o.vis.inArms.length === 0,
  o.vis.inArms.length
    ? `the Arms panel still offers its own visibility checkbox (${o.vis.inArms.join(", ")}) — one fact, two controls is what was reported (ROADMAP 4.39)`
    : "the Arms panel offers no visibility checkbox of its own — it keeps the unload button, which changes what the project HOLDS rather than what the viewport shows");
R.is(o.vis.inScene.length === 2 && o.vis.inScene.indexOf("optShowWeapons") >= 0,
  `and both switches are in View & scene, with the other "what is drawn" switches (${o.vis.inScene.join(", ")})`);
R.is(!o.vis.startsOff.w && !o.vis.startsOff.p && o.vis.follows.w && o.vis.follows.p,
  "they read the state rather than holding their own copy of it — loading a loadout turns both on, and that is a consequence of an action, not a second switch for it");
R.is(!o.vis.writes.w && !o.vis.writes.p,
  `and unticking either one writes it back (weapons ${o.vis.writes.w}, pylons ${o.vis.writes.p})`);

console.log("\n=== a setting that makes a skin unpublishable says so before it is used (3.31) ===");
const G = o.gate;
console.log(`   locked: flame tick ${JSON.stringify(G.locked.flame)} · hull tick ${JSON.stringify(G.locked.hull)} · ships ${JSON.stringify(G.locked.live)}`);
console.log(`   mode ${JSON.stringify(G.locked.mode)} · 8192 ${JSON.stringify(G.locked.size8k)} · slot marks ${JSON.stringify(G.locked.slotMarks)}`);
R.is(G.locked.flame && G.locked.flame.disabled && !G.locked.flame.checked && G.locked.flame.mark && !G.locked.flame.open,
  "the flame sheet's tick starts OFF and disabled, with the gate's mark beside it, unlit");
R.is(G.locked.hull && !G.locked.hull.disabled && G.locked.hull.checked && !G.locked.hull.mark,
  "hull_c's tick is on and free, with no mark — the gate is for the rule, not for every row");
R.is(G.locked.live.join(",") === "hull_c", `so only the hull ships (${G.locked.live.join(",")}) — the flame sheet is not in the archive by default`);
R.is(G.locked.flame && G.locked.flame.gated && /dashed/.test(G.locked.gatedStyle || ""),
  `the disabled tick carries the shared .gated style — a dashed outline (${G.locked.gatedStyle}), not :disabled's plain dimming`);
R.is(G.locked.mode.replaceOff && !G.locked.mode.setOff && G.locked.mode.mark && !G.locked.mode.open,
  "on a tank, replace_tex is the locked option and set_tex is free, with the mark on the row");
R.is(G.remembered === "auto", `a select found sitting on the forbidden mode goes back to Auto (${G.remembered})`);
R.is(G.locked.size8k.off === true && G.locked.size8k.mark, "8192 px is listed but disabled in the hull's size select, with one mark for the rule in the list header");
R.is(G.size8kReset === 0, `a stored 8192 on a locked row goes back to native (${G.size8kReset})`);
R.is(G.locked.slotMarks.join(",") === "jet_flame_diamonds", `the slot list marks the flame sheet and nothing else (${G.locked.slotMarks.join(",")})`);
console.log(`   opened: flame tick ${JSON.stringify(G.opened.flame)} → ticked ships ${JSON.stringify(G.ticked.live)} → relocked ships ${JSON.stringify(G.relocked.live)}`);
R.is(G.opened.flame && !G.opened.flame.disabled && !G.opened.flame.checked && G.opened.flame.open && G.opened.slotMarks.length === 1,
  "opening the gate from the export row enables the tick — still unticked — and the mark stays, lit, in both lists");
R.is(G.ticked.live.join(",") === "hull_c,jet_flame_diamonds", `ticking it ships the flame sheet (${G.ticked.live.join(",")})`);
R.is(G.relocked.flame && G.relocked.flame.disabled && !G.relocked.flame.checked && G.relocked.live.join(",") === "hull_c" && !G.relocked.flame.open,
  `locking it again from the SLOT list's mark drops the sheet from the archive (${G.relocked.live.join(",")}) — one gate, wherever it is shown`);
R.is(G.modeOpen.mode.value === "replace_tex" && !G.modeOpen.mode.replaceOff && G.modeOpen.mode.open,
  `opening the mode gate lets replace_tex be chosen on a tank, and the mark stays lit (${G.modeOpen.mode.value})`);
console.log(`   rank VI aircraft: 8192 ${JSON.stringify(G.air6.size8k)} mode ${JSON.stringify(G.air6.mode)} · rank IV: 8192 ${JSON.stringify(G.air4.size8k)}`);
R.is(G.air6.size8k.off === false && !G.air6.size8k.mark && G.air6.mode.setOff && !G.air6.mode.replaceOff,
  "a rank VI aircraft frees 8192 — no mark — and locks set_tex instead of replace_tex");
R.is(G.air4.size8k.off === true && G.air4.size8k.mark, "a rank IV aircraft does not free 8192");

console.log("\n=== the reset-surface button goes back to the game's bytes on every path (3.29(4)) ===");
const RS = o.reset;
console.log(`   baked ${rgb(RS.baked.smooth)} · same-size replace ${rgb(RS.sameSize.before)} → ${rgb(RS.sameSize.after.smooth)} · resized ${rgb(RS.resized.before)} @${RS.resized.sizeBefore}px → ${rgb(RS.resized.after.smooth)} @${RS.resized.after.size}px, undo ${RS.resized.after.undo}`);
const stock = a => a && a[0] === 30;
R.is(stock(RS.baked.smooth) && RS.baked.metal[0] === 50 && !RS.baked.edited,
  `a write straight into the base sheet is undone (${rgb(RS.baked.smooth)}) — which no layer delete can do, so the button stays`);
R.is(RS.sameSize.before[0] === 200 && stock(RS.sameSize.after.smooth),
  `a same-size replaced _n goes back to the stock pixels (${rgb(RS.sameSize.before)} → ${rgb(RS.sameSize.after.smooth)})`);
R.is(RS.resized.before[0] === 200 && RS.resized.sizeBefore === 16 && stock(RS.resized.after.smooth) && RS.resized.after.size === 8,
  `a RESIZED replaced _n goes back too, at the stock size (${RS.resized.sizeBefore} → ${RS.resized.after.size}px) — it stayed on the replacement until 2026-09-20`);
R.is(RS.resized.after.undo === 0 && /undo history cleared/.test(RS.resized.after.status),
  `and the history is cleared with it, said out loud ("${RS.resized.after.status.slice(0, 90)}…")`);
R.is(/hull/.test(RS.baked.status) && /layers are untouched/.test(RS.baked.status),
  `the status names the slot and says layers were left alone ("${RS.baked.status}")`);

console.log("\n=== a decal you can handle in 3-D (4.35) ===");
const Q = o.sq, T = o.typed, RG = o.dring;
console.log(`   square: turned ${Q.t1} → rot ${Q.rot1}; again ${Q.t2} → ${Q.rot2}; from 47: ${Q.t3} → ${Q.rot3}; off the model: ${Q.t4}`);
R.is(Q.t1 != null && Math.abs(Q.rot1 - (-30)) < .15,
  `a projection on a shell turned 30° is squared by turning -30° (turned ${Q.t1}, now ${Q.rot1}) — measured off the triangle's UVs, not guessed from the projector`);
R.is(Q.t2 === 0 && Q.rot2 === Q.rot1, `a second press turns it by nothing (${Q.t2})`);
R.is(Q.t3 != null && Math.abs(((Q.rot3 + 30) % 90 + 90) % 90) < .15, `from 47° it lands on the same grid line, the nearest one (${Q.rot3})`);
R.is(Q.t4 === null, `with nothing under the frame it says so instead of turning (${Q.t4})`);
console.log(`   typed: ${T.tag} "${T.before}" → 12.5 gives rot ${T.rot}, undo steps ${T.undo}, undone ${T.undone}; squared 100 → ${T.squared}`);
R.is(T.tag === "INPUT" && T.before === "0", `the rotation readout is a number field showing the angle (${T.tag}, "${T.before}")`);
R.is(T.rot === 12.5 && T.undo === 1 && T.undone === 0, `a typed angle is applied as one undo step (${T.rot}, ${T.undo} step, undone ${T.undone})`);
R.is(/Already square/.test(T.squareIdle) && T.squared === 90, `Square on a 2-D decal is the nearest right angle (100 → ${T.squared}), and says when there is nothing to do`);
console.log(`   ring: ${RG.meshes} overlay mesh(es) with a projected decal selected, ${RG.after} after; alpha edge ${RG.px && RG.px.edge} inside ${RG.px && RG.px.inside} outside ${RG.px && RG.px.outside}`);
R.is(RG.meshes === 1 && RG.after === 0, `selecting a projected decal puts the overlay on the model (${RG.meshes}) and deselecting takes it off (${RG.after})`);
R.is(RG.px && RG.px.edge > 200 && RG.px.inside > 40 && RG.px.inside < 140 && RG.px.outside === 0,
  `and it is a RING round the footprint — solid at the edge (${RG.px && RG.px.edge}), faint inside (${RG.px && RG.px.inside}), nothing outside (${RG.px && RG.px.outside})`);

console.log("\n=== a promo image: transparent PNG with a shadow (4.37) ===");
const SH = o.shot;
console.log(`   ${SH.size && SH.size.join("x")} px · corner ${JSON.stringify(SH.corner)} · opaque ${SH.opaque} · shadow ${SH.shadow} (e.g. ${JSON.stringify(SH.shadowSample)}) · after ${JSON.stringify(SH.after)}`);
R.is(SH.size && SH.size[0] === 160 && SH.size[1] === 120, `the output is exactly the size asked (${SH.size && SH.size.join("x")}) — supersampled and scaled down, not rounded`);
R.is(SH.corner && SH.corner[3] === 0, `the background is transparent (corner alpha ${SH.corner && SH.corner[3]})`);
R.is(SH.opaque > 500, `the model is there, opaque (${SH.opaque} px)`);
R.is(SH.shadow > 100 && SH.shadowSample && SH.shadowSample[0] < 30 && SH.shadowSample[3] > 40 && SH.shadowSample[3] < 180,
  `and under it a SEMI-TRANSPARENT shadow — black at partial alpha (${SH.shadow} px, e.g. ${JSON.stringify(SH.shadowSample)}) — the receiver itself never appears`);
R.is(SH.after.bg && SH.after.clearAlpha === SH.after.clearAlphaWas && !SH.after.shadows && !SH.after.cast && SH.after.catcherGone && Math.abs(SH.after.aspect - SH.after.aspectWas) < 1e-9,
  `afterwards the scene is as it was: background back, clear alpha ${SH.after.clearAlpha} (was ${SH.after.clearAlphaWas}), shadows ${SH.after.shadows ? "still on" : "off"}, catcher gone, aspect back`);

console.log("\n=== 3.29: the export settings are a window under the top bar, with a preview of each ===");
const W = o.win29 || {};
R.is(W.expIn && W.viewIn && W.poseIn && W.setIn,
  "Skin & export and Settings moved into their windows, View & scene and Moving parts docked in the sidebar — the same elements, every id intact");
R.is(Array.isArray(W.sidebar) && !W.sidebar.some(s => /export|Settings/i.test(s)) && W.sidebar.some(s => /Brush/.test(s)) && W.sidebar.some(s => /View/.test(s)),
  `the right sidebar holds what is painted with, and View & scene: ${(W.sidebar || []).join(" · ")}`);
R.is(W.open1 === "winExport::true" && W.noBackdrop, `Export as… opens its window, lights its button, and dims nothing (${W.open1})`);
R.is(W.open2 === "winSettings:none", `opening Settings closes Export — one window at a time (${W.open2})`);
R.is(W.afterEsc === null, "and Escape closes whichever is up");
// Into the right column's one scrolling pane since ROADMAP 3.6 — the column itself no longer scrolls.
R.is(W.dockedTo === "rightPane,rightPane" && W.noRow && W.floatHidden,
  `View & scene and Moving parts are docked at load (${W.dockedTo}), the float button is hidden, and no ui.viewDock row can float them from a stored value (3.36)`);
R.is(W.dockedClickOpens === null && W.floatedTo === "winView",
  "docked, the View button opens no window; dock(false) still floats the sections, for when floating is fixed (3.37)");
R.is(W.bc3 && W.bc3.tag === "DXT5 (BC3)" && /up to \d+ levels off/.test(W.bc3.cap) && W.bc3.texelsMoved > 0,
  `Game preset: the crop is encoded to DXT5 in the export pool and decoded back — "${W.bc3 && W.bc3.cap}", ${W.bc3 && W.bc3.texelsMoved} texels moved`);
R.is(W.rgba8 && W.rgba8.tag === "RGBA8" && /identical/.test(W.rgba8.cap) && W.rgba8.texelsMoved === 0,
  `Lossless preset: no round trip, and the two crops are the same pixels — "${W.rgba8 && W.rgba8.cap}"`);
R.is(W.pad && W.pad.tag === "on" && /of the \d+ texels outside the islands .* filled from the nearest edge/.test(W.pad.note),
  `seam padding on: the export's own padSeams, on the crop against the slot's UV mask — "${W.pad && W.pad.note.slice(0, 70)}…"`);
R.is(W.padOff && W.padOff.tag === "off" && /^Off: /.test(W.padOff.note), `seam padding off says what the rim will be — "${W.padOff && W.padOff.note}…"`);
R.is(W.mip && W.mip.tag === "on" && /chosen/.test(W.mip.chosen) && !/chosen/.test(W.mip.other),
  "mipmaps on: the ¼ mip is the chosen picture, the point sample beside it is not");
R.is(W.alphaAuto && W.alphaAuto.keep === false && W.alphaAuto.cov === "0.00000" && W.alphaAuto.mix,
  `set_tex + Alpha auto: the tint says the alpha ships opaque and the stock-branch shader mixes the camo through cov=1 (${W.alphaAuto && W.alphaAuto.cov})`);
R.is(W.alphaKeep && W.alphaKeep.keep === true && W.alphaKeep.cov === "1.00000" && W.alphaKeep.mix,
  `set_tex + Alpha keep: the sheet's alpha is blended in the stock branch — paint = mix(camo, skin, skin.a) (${W.alphaKeep && W.alphaKeep.cov})`);
R.is(W.alphaOpaque && W.alphaOpaque.keep === false && W.alphaOpaque.cov === "0.00000", "set_tex + Alpha opaque: the sheet covers everywhere");
R.is(/^The alpha ships fully opaque/.test(W.noteAuto || "") && /^The alpha is kept/.test(W.noteKeep || ""),
  `and the sentence under Alpha says which — "${W.noteAuto}…" / "${W.noteKeep}…"`);
R.is(W.noteMode === "set_tex:" && W.noteModeR === "replace_tex:", `the sentence under Mode names the mode it resolves to (${W.noteMode} / ${W.noteModeR})`);

console.log("\n=== 3.30, the selection half: the quick pick is visible, the modifiers mean one thing, two grains over one verb row ===");
const S = o.sel30 || {};
R.is(S.cursorPart === "pointer", `Ctrl held over the model turns the cursor into a hand before the click — ${S.cursorPart}`);
R.is(S.cursorIsland === "cell", `and a cell when Islands is on — ${S.cursorIsland}`);
R.is(/Ctrl\+click: select the part/.test(S.said || "") && /Ctrl\+right-click: shut it out/.test(S.said || "") && /K: islands/.test(S.said || ""),
  `the status line names the three things a click can then do — "${(S.said || "").slice(0, 60)}…"`);
R.is(S.cursorReleased === "crosshair", `Ctrl up: painting's crosshair is back — ${S.cursorReleased}`);
R.is(S.cursorAway !== "pointer" && S.saidAway, "Ctrl with the pointer elsewhere changes nothing and says nothing (Ctrl+Z does not narrate)");
R.is(S.shiftAdds && S.altRemoves, "in the Parts list Shift adds and Alt removes — the marquee's two keys");
R.is(S.altClickRow && S.altClickRow.found && !S.altClickRow.selected && !S.altClickRow.excluded,
  `an Alt+click on a part's name drops it from the selection and does NOT shut it out of painting (${JSON.stringify(S.altClickRow)})`);
R.is(S.labelParts === "parts:" && S.allParts === 3 && S.invertedParts === 0 && S.noneParts === 0 && S.invertOff === false,
  `with Select off the row says "parts:" and All / Invert / None act on the parts (${S.allParts} → ${S.invertedParts} → ${S.noneParts})`);
R.is(S.labelArea === "area:" && S.invertOffArea === true, `with Select on it says "area:" and Invert is off — a rectangle's outside is not a rectangle`);
console.log("\n=== 4.41: coated glass has its rainbow at grazing angles ===");
const I = o.irid41 || {}, IC = I.chroma || {};
console.log(`   face-on ${JSON.stringify(I.face)} · 52° ${JSON.stringify(I.mid)} · 83° ${JSON.stringify(I.graze)} · black glass at 83° ${JSON.stringify(I.grazeBlack)}`);
R.is(IC.graze >= IC.face + 6, `rainbow glass gains chroma edge-on: ${IC.face} face-on → ${IC.graze} at 83°`);
R.is(I.top && I.top.mid !== I.top.graze, `and the hue turns with the angle — dominant channel ${["R","G","B"][I.top && I.top.mid]} at 52°, ${["R","G","B"][I.top && I.top.graze]} at 83° (interference cycles)`);
R.is(IC.black <= 4, `black-coated glass gains none (${IC.black}) — the term is the rainbow coating's alone`);
R.is(I.keys && /^wtirid:/.test(I.keys.rainbow) && !/^wtirid:/.test(I.keys.black), "the program cache key carries the term, so the two do not share a program (r128 would)");

R.is(S.rows === 4 && S.folded && S.wandRowHidden, `the tab is four rows — Parts, Area, the live grain's verbs, Fill/Clear/Crop/Copy — with the exact rectangle and the mask bridges folded, and the wand's own row away until the wand is on (${S.rows} rows)`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");

// ---- the Controls & guide screen (2026-10-10 docs review) ----
// It was plain markup with three inline onclick= attributes (CLAUDE.md §4 forbids them), nothing
// closed it on Escape, and at z-index 100 it opened UNDER a top-bar window (120): `?` pressed with
// the Export window up put the guide behind it. Driven with real key events over the protocol — a
// synthetic KeyboardEvent would not prove the key reaches the page the way a user's does — at two
// window sizes, with and without a window open. Proved able to fail on the page before the fix:
// Escape left the guide up, the window's centre hit the window and not the guide, and the first
// Escape with a window open closed the window under the guide instead of the guide.
console.log("\n=== the Controls & guide screen: Esc closes it, it opens above the windows, no inline handlers ===");
{
  const src = fs.readFileSync(path.join(ROOT, "src", "index.html"), "utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const inline = [...src.matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)].map(m => m[1]);
  R.is(inline.length === 0, inline.length ? `src/index.html still has inline handlers: ${inline.join(", ")}` : "src/index.html has no inline on…= handler (CLAUDE.md §4)");
}
const KEYS = {
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Question: { key: "?", code: "Slash", windowsVirtualKeyCode: 191, nativeVirtualKeyCode: 191, modifiers: 8, text: "?", unmodifiedText: "/" },
};
const H = await evalInPage({ browser, timeoutMs: 120000, keep: argv.includes("--keep"), drive: async ({ cdp, evaluate }) => {
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const press = async k => {
    const d = KEYS[k];
    await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: d.text ? "keyDown" : "rawKeyDown" }, d));
    const up = Object.assign({ type: "keyUp" }, d); delete up.text; delete up.unmodifiedText;
    await cdp.send("Input.dispatchKeyEvent", up);
    await sleep(120);
  };
  const clickAt = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await cdp.send("Input.dispatchMouseEvent", Object.assign({ type, x, y }, type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }));
    await sleep(120);
  };
  const STATE = `(function(){
    var h = document.getElementById("helpOverlay"), w = document.getElementById("winExport");
    var up = getComputedStyle(h).display !== "none", win = getComputedStyle(w).display !== "none";
    var r = w.getBoundingClientRect(), at = win ? document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60)) : null;
    var p = h.firstElementChild.getBoundingClientRect();
    return { up: up, win: win, overWin: !!(at && h.contains(at)), atWin: at ? (at.id || at.tagName.toLowerCase()) : "",
      panel: { x: p.left + p.width / 2, y: p.top + 30 }, edge: { x: Math.max(4, p.left / 2), y: innerHeight / 2 },
      x: (function(){ var b = document.getElementById("btnHelpClose"); if (!b) return null; var q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })() };
  })()`;
  await evaluate(`new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", () => r()))`);
  await sleep(400);
  const out = {};
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const o = out[w + "x" + h] = {};
    await evaluate(`(document.getElementById("welcome").style.display = "none", true)`);
    await press("Question");      o.open = await evaluate(STATE);
    await press("Escape");        o.esc = await evaluate(STATE);
    // with the Export window up: the guide over it, Esc takes the guide first and the window second
    await evaluate(`(TopWin.show("winExport"), true)`); await sleep(200);
    await press("Question");      o.winOpen = await evaluate(STATE);
    await press("Escape");        o.winEsc1 = await evaluate(STATE);
    await press("Escape");        o.winEsc2 = await evaluate(STATE);
    // the ✕, a click on the backdrop, and a click inside the panel (which must not close it)
    await press("Question");      const s = await evaluate(STATE);
    if (s.x) { await clickAt(s.x.x, s.x.y); o.byX = await evaluate(STATE); } else o.byX = { up: true, noX: true };
    await press("Question");      await clickAt(s.panel.x, s.panel.y); o.inside = await evaluate(STATE);
    await clickAt(s.edge.x, s.edge.y); o.backdrop = await evaluate(STATE);
    if (o.backdrop.up) await evaluate(`(document.getElementById("helpOverlay").style.display = "none", true)`);
    // Something drawn ABOVE the guide takes Escape before it. A choice dialog, a layer menu or the
    // Messages popover can come up over the guide (an error opens Messages by itself, a load can ask
    // a question), and the guide's capture-phase Escape took the key first: under a choice dialog,
    // whose Escape listens on the window, the first Escape closed the hidden guide and stopped the
    // key, so the dialog in plain view needed a second one; under a menu or Messages one Escape
    // closed both. And `?` with a choice dialog up opened the guide BEHIND it (2026-10-10 review).
    const dialog = `(window.__t50cd = "open", choiceDialog("t50", [{ label: "OK", value: 1 }]).then(v => { window.__t50cd = v; }), true)`;
    const withCd = async () => Object.assign(await evaluate(STATE), { cd: await evaluate(`window.__t50cd`) });
    await press("Question");      await evaluate(dialog); await sleep(100);
    await press("Escape");        o.dlg1 = await withCd();
    await press("Escape");        o.dlg2 = await withCd();
    await press("Question");      await evaluate(`(StatusLog.open("pin"), true)`); await sleep(100);
    await press("Escape");        o.log1 = Object.assign(await evaluate(STATE), { log: await evaluate(`StatusLog.mode`) });
    await press("Escape");        o.log2 = await evaluate(STATE);
    const menuUp = `[...document.body.children].some(e => e.textContent === "t50 item")`;
    await press("Question");      await evaluate(`(popupMenu({ clientX: 200, clientY: 200 }, [{ label: "t50 item", run(){} }]), true)`); await sleep(100);
    await press("Escape");        o.menu1 = Object.assign(await evaluate(STATE), { menu: await evaluate(menuUp) });
    await press("Escape");        o.menu2 = await evaluate(STATE);
    await evaluate(dialog); await sleep(100);
    await press("Question");      o.under = await withCd();
    await press("Escape");        o.under2 = await withCd();
    // leave nothing up for the next size, whichever way the checks went
    if (o.under2.cd === "open" || o.dlg2.cd === "open") await press("Escape");
    if (await evaluate(menuUp)) await press("Escape");
    await evaluate(`(StatusLog.close(), document.getElementById("helpOverlay").style.display = "none", true)`);
    // Three deep: the Export window, the guide over it, and a choice dialog or Messages over the
    // guide. Each Escape takes ONE of them, top first. The guide stepped aside for the thing above it
    // and did not stop the key — it must not, or that thing never gets it — so TopWin's own Escape
    // listener (document, bubble) saw it too and closed the window hidden under the guide: after the
    // first Escape the dialog or Messages was gone AND the window, the guide still up over nothing
    // (measured with real key events at 1600×900, the 2026-10-10 review's second round).
    for (const [k, raise] of [["wDlg", dialog], ["wLog", `(StatusLog.open("pin"), true)`]]) {
      await evaluate(`(window.__t50cd = null, TopWin.show("winExport"), true)`); await sleep(200);
      await press("Question");      await evaluate(raise); await sleep(100);
      await press("Escape");        const a = Object.assign(await withCd(), { log: await evaluate(`StatusLog.mode`) });
      await press("Escape");        const b = await evaluate(STATE);
      await press("Escape");        const c = await evaluate(STATE);
      o[k] = { a, b, c };
      if (await evaluate(`window.__t50cd`) === "open") await press("Escape");
      await evaluate(`(StatusLog.close(), TopWin.close(), document.getElementById("helpOverlay").style.display = "none", true)`);
    }
  }
  out.errs = await evaluate(`(window.__boot && window.__boot.errs) || []`);
  return out;
} });
if (!H.ok) R.bad("the Controls & guide drive did not run: " + String(H.reason).slice(0, 300));
else for (const [size, o] of Object.entries(H.result).filter(([k]) => k !== "errs")) {
  R.is(o.open.up && !o.esc.up, `${size}: ? opens the guide and a real Escape closes it (open ${o.open.up}, after Esc ${o.esc.up})`);
  R.is(o.winOpen.up && o.winOpen.win && o.winOpen.overWin,
    `${size}: ? with the Export window up puts the guide above the window — the window's centre hits ${o.winOpen.atWin || "nothing"}`);
  R.is(!o.winEsc1.up && o.winEsc1.win && !o.winEsc2.win,
    `${size}: the first Escape closes the guide and leaves the window (guide ${o.winEsc1.up}, window ${o.winEsc1.win}), the second closes the window (${o.winEsc2.win})`);
  R.is(!o.byX.up && o.inside.up && !o.backdrop.up,
    `${size}: the ✕ closes it (${!o.byX.up}${o.byX.noX ? ", no #btnHelpClose" : ""}), a click inside the panel does not (${o.inside.up}), a click on the backdrop does (${!o.backdrop.up})`);
  R.is(o.dlg1.cd === null && o.dlg1.up && !o.dlg2.up,
    `${size}: a choice dialog over the guide takes the first Escape (dialog ${o.dlg1.cd === null ? "closed" : "still open"}, guide ${o.dlg1.up ? "still up" : "closed"}) and the guide the second (${o.dlg2.up ? "still up" : "closed"})`);
  R.is(!o.log1.log && o.log1.up && !o.log2.up,
    `${size}: Messages over the guide takes the first Escape (Messages ${o.log1.log ? "still open" : "closed"}, guide ${o.log1.up ? "still up" : "closed"}) and the guide the second (${o.log2.up ? "still up" : "closed"})`);
  R.is(!o.menu1.menu && o.menu1.up && !o.menu2.up,
    `${size}: a layer menu over the guide takes the first Escape (menu ${o.menu1.menu ? "still open" : "closed"}, guide ${o.menu1.up ? "still up" : "closed"}) and the guide the second (${o.menu2.up ? "still up" : "closed"})`);
  R.is(!o.under.up && o.under.cd === "open" && o.under2.cd === null && !o.under2.up,
    `${size}: ? under a choice dialog does not open the guide behind it (${o.under.up ? "it did" : "it did not"}), and Escape closes the dialog (${o.under2.cd === null ? "closed" : "still open"})`);
  for (const [k, what] of [["wDlg", "a choice dialog"], ["wLog", "Messages"]]) {
    const { a, b, c } = o[k];
    const gone = k === "wDlg" ? a.cd === null : !a.log;
    R.is(gone && a.up && a.win && !b.up && b.win && !c.win,
      `${size}: the Export window, the guide over it and ${what} over that — the first Escape takes only ${what} (${gone ? "closed" : "still open"}; guide ${a.up ? "up" : "closed"}, window ${a.win ? "up" : "closed"}), the second the guide (${b.up ? "still up" : "closed"}; window ${b.win ? "up" : "closed"}), the third the window (${c.win ? "still up" : "closed"})`);
  }
}
if (H.ok) R.is(!(H.result.errs || []).length, (H.result.errs || []).length ? "uncaught errors while driving the guide: " + H.result.errs.join(" | ") : "no uncaught errors while driving the guide");
R.finish();
