// ---------- UI QoL: collapsible sections + persisted preferences ----------
document.querySelectorAll(".sidebar .section h3").forEach(h => {
  h.addEventListener("click", e => {
    if (/BUTTON|SELECT|INPUT/.test(e.target.tagName)) return;
    if (h.closest(".topwin")) return;                 // a window's one section has nowhere to fold to (3.29)
    h.parentElement.classList.toggle("collapsed");
  });
});
// Two stored preferences were the *cause* of the "import and export changes the colours" bug and
// must not survive an upgrade: `camoBase:"white"` (the old default, which repainted every texel the
// skin does not fully cover) and `keepAlpha:false` (which ships alpha 255 and throws the coverage
// mask away). Anything written before version 2 has those two reset to the new, safe defaults;
// everything else in the file is still honoured.
//
// Version 3 (2026-10-22): Spacing's default went from 35 % to 15 % (`Pen.SPACING`), and since every
// blob holds every row, touched or not, a 35 written before then is the old default rather than a
// choice — `applyPrefs` turns it into the tool's new one. Without that, nobody who had ever opened
// the app would have seen the change.
//
// Version 4 (2026-10-22): Mipmaps are off by default (ROADMAP 3.42 (4)) — with the game's
// older-video-card support on, a mipmapped surface seen at an angle comes out blurry. The same
// reasoning as Spacing: every blob stores the box, so a `true` written before then is the old
// default and not a choice, and it is turned off. A `false` was always a choice and stays. Decided
// without the owner (ROADMAP_DONE 3.42); to keep a stored `true` instead, delete the `ver < 4` line
// in `applyPrefs`.
//
// Version 5 (2026-10-24): the projected 3-D brush is on by default (ROADMAP 1.19 (e)). Every blob
// stores its switch, so a `false` written before then is the old default — the switch shipped off
// behind it from 2026-10-23 — and not a choice, and it is turned on; a `false` written from version 5
// on was chosen and stays. Decided without the owner (ROADMAP_DONE 1.19e); to keep a stored `false`,
// delete the `ver < 5` line in `applyPrefs`.
const PREFS_VERSION = 5;

// ---------- one row per setting ----------
// Every persisted setting is declared once, here, and save / load / reset / export all walk this
// list. Before it, "what is the default?" had no answer anywhere: defaults lived in the markup's
// `value=` and `checked`, in loadPrefs's `|| fallback` chain, and in constants like PROJ_DEPTH_DEF,
// and nothing could put a control back. ROADMAP 3.12.
//
// **`def` is not written down — it is CAPTURED from the running page at boot**, before loadPrefs
// applies anything. Declaring it a third time next to the markup is how the three copies drifted in
// the first place; snapshotting means the default is by construction whatever the build ships, and
// a control's markup and its reset can never disagree.
//
// `set` exists rather than `{ id, default }` because some values must go in through a setter or the
// UI and the state end up saying different things — the note loadPrefs already carried about
// setBackground and setExposure. `sec` groups a row under a sidebar section for the per-section
// reset. `data: true` marks a row that is not a *setting* — the palette and the last decal folder
// are things the user made, so "reset settings" must not throw them away.
const PREFS = [
  // ---- view / scene ----
  { id: "bg", sec: "view", get: () => $("optBg").value,
    // via setBackground: going through onchange would pop the OS colour picker on a "#custom" pref
    set: v => { $("optBg").value = v; setBackground(v); } },
  { id: "bgCustom", sec: "view", get: () => $("optBgCustom").value, set: v => $("optBgCustom").value = v },
  { id: "exp", sec: "view", get: () => +$("optLight").value,
    // via setExposure: it also syncs the number beside the slider, which used to keep saying 1.0
    // over a scene lit at 0.6
    set: v => setExposure(v) },
  { id: "light.az", sec: "view", get: () => +$("lightAz").value, set: v => { $("lightAz").value = v; $("lightAzVal").textContent = $("lightAz").value + "°"; applyLightDir(); } },
  { id: "light.el", sec: "view", get: () => +$("lightEl").value, set: v => { $("lightEl").value = v; $("lightElVal").textContent = $("lightEl").value + "°"; applyLightDir(); } },
  { id: "light.follow", sec: "view", get: () => $("lightFollow").checked,
    set: v => { $("lightFollow").checked = !!v; App.lightFollow = !!v; applyLightDir(); } },
  { id: "paintTint", sec: "view", get: () => App.paintTint !== false,
    set: v => { App.paintTint = v !== false; $("optPaintTint").checked = v !== false; } },
  { id: "paintStrength", sec: "view", get: () => App.paintStrength,
    set: v => { App.paintStrength = v; $("optPaintStrength").value = Math.round(v * 100); $("optPaintStrengthVal").textContent = Math.round(v * 100); } },
  { id: "coverageOn", sec: "view", get: () => App.coverageOn !== false,
    set: v => { App.coverageOn = v !== false; $("optCoverage").checked = v !== false; } },
  { id: "showUnposed", sec: "view", get: () => !!App.showUnposed,
    set: v => { App.showUnposed = !!v; $("optShowUnposed").checked = !!v; } },
  { id: "showEffects", sec: "view", get: () => !!App.showEffects, set: v => { App.showEffects = !!v; } },
  // ROADMAP 3.16. Only the Auto FLAG is remembered, not whichever channel it or the user last
  // picked: a build that opened showing a flat normal map would be a puzzle, and the flag is the
  // preference — "keep choosing for me" — while the channel is a moment-to-moment view.
  { id: "chanAuto", sec: "view", get: () => !!App.chanAuto,
    set: v => { App.chanAuto = !!v; $("chanViewSel").value = v ? "auto" : App.chanView || "shaded"; applyAutoChanView(); } },
  { id: "trackTiling", sec: "view", get: () => App.trackTiling,
    set: v => { if (!(v > 0)) return; App.trackTiling = v; $("optTrackTiling").value = Math.round(v * 100); $("optTrackTilingVal").textContent = v.toFixed(2) + "×"; } },
  // ---- brush ----
  // Which tool is in hand, and it has to be restored BEFORE the five live rows below it or they
  // land on the wrong one — a session that ended on a 4-texel panel line would come back with the
  // colour brush set to 4 (ROADMAP 3.22). A plain assignment on purpose: `applyBrushMode` would
  // pull settings out of the per-tool map, which has not been restored yet at this point in the
  // walk. Any string is accepted, because a row that silently refuses a value is a row nothing can
  // test; `updateBrushAvailability` moves off a tool that cannot paint on the next real interaction.
  { id: "brush.mode", sec: "brush", get: () => App.brush.mode,
    set: v => { if (!v) return; App.brush.mode = v; brushStamp._key = null;
      document.querySelectorAll("[data-bm]").forEach(x => x.classList.toggle("active", x.dataset.bm === v));
      syncBrushOptionRows(); } },
  { id: "brush.size", sec: "brush", get: () => App.brush.size,
    set: v => { App.brush.size = v; $("brushSize").value = v; $("brushSizeVal").textContent = v; } },
  { id: "brush.opacity", sec: "brush", get: () => App.brush.opacity,
    set: v => { App.brush.opacity = v; $("brushOpacity").value = Math.round(v * 100); $("brushOpacityVal").textContent = Math.round(v * 100); } },
  { id: "brush.hardness", sec: "brush", get: () => App.brush.hardness,
    set: v => { App.brush.hardness = v; $("brushHardness").value = Math.round(v * 100); $("brushHardnessVal").textContent = Math.round(v * 100); } },
  // Spacing used to live behind "More brush options" and its slider went to 200%. A value saved
  // from there survived every later session invisibly — which is exactly how a user ended up
  // painting with a spacing they had not chosen and could not see (2026-08-23). Measured at a 48 px
  // brush: up to 35% the stroke edge wobbles 0-1 px, at 50% 3 px, at 100% 10-17 px, and past 100%
  // the stamps stop touching at all. So a stored value outside the range is brought back into it
  // rather than kept as a setting the UI cannot show. The default is `Pen.SPACING`, 15 % since
  // 2026-10-22 (why, there; how a stored 35 moves to it, `applyPrefs`).
  { id: "brush.spacing", sec: "brush", get: () => App.brush.spacing || Pen.SPACING,
    set: v => { const s = Math.min(1, Math.max(.05, v || Pen.SPACING)); App.brush.spacing = s;
      $("brushSpacing").value = Math.round(s * 100); $("brushSpacingVal").textContent = Math.round(s * 100); } },
  // ROADMAP 4.50 (4) + 6.4. Flow, Build up and what pressure drives are the tool in hand's, like the
  // rows above — every other tool keeps its own through brush.tools below.
  { id: "brush.flow", sec: "brush", get: () => App.brush.flow,
    set: v => { const f = Math.min(1, Math.max(.01, +v || 1)); App.brush.flow = f;
      $("brushFlow").value = Math.round(f * 100); $("brushFlowVal").textContent = Math.round(f * 100); } },
  { id: "brush.build", sec: "brush", get: () => !!App.brush.build,
    set: v => { App.brush.build = !!v; $("brushBuild").checked = !!v; } },
  { id: "brush.pSize", sec: "brush", get: () => !!App.brush.pSize,
    set: v => { App.brush.pSize = !!v; $("penSize").checked = !!v; } },
  { id: "brush.pFlow", sec: "brush", get: () => !!App.brush.pFlow,
    set: v => { App.brush.pFlow = !!v; $("penFlow").checked = !!v; } },
  // ROADMAP 4.50 (10). The tips a user has loaded are DATA, like the palette — "reset" never throws
  // them away — and they live in IndexedDB beside the decal library. `file` keeps them out of the
  // localStorage copy this table is written to every four seconds and puts them in the settings FILE,
  // which is how they travel. Above the tip row on purpose: an imported file's tip has to be in the
  // library by the time the row naming it is applied.
  { id: "brush.tipLib", sec: "brush", data: true, file: true, get: () => Tips.serialise(),
    set: v => BrushPanel.adoptTips(v) },
  // The tip in hand and how its dabs vary are the tool's, like Flow — the other tools' are in
  // brush.tools below. Each goes through BrushTools.put, the same write a tool switch makes.
  { id: "brush.tip", sec: "brush", get: () => App.brush.tip || "round", set: v => BrushPanel.setTip(v) },
  ...["sizeJit", "flowJit", "scatter", "angle", "angleJit", "follow"].map(k => ({ id: "brush." + k, sec: "brush",
    get: () => k === "follow" ? !!App.brush.follow : +App.brush[k] || 0,
    set: v => BrushTools.put(BrushTools.field(k), k === "follow" ? !!v : +v || 0) })),
  // ROADMAP 4.56: the colour along the stroke, the tool's like the dynamics. A name the select does
  // not have is refused by BrushTools.put, which leaves the row where it was.
  { id: "brush.cycle", sec: "brush", get: () => App.brush.cycle || "off",
    set: v => { BrushTools.put(BrushTools.field("cycle"), String(v)); BrushPanel.syncCycle(); } },
  { id: "brush.cycleLen", sec: "brush", get: () => +App.brush.cycleLen || 10,
    set: v => { BrushTools.put(BrushTools.field("cycleLen"), +v || 10); BrushPanel.syncCycle(); } },
  // ROADMAP 4.50 (11): the Retouch brush's settings, the tool's own like the rest.
  { id: "brush.retouch", sec: "brush", get: () => App.brush.retouch || "blur",
    set: v => { BrushTools.put(BrushTools.field("retouch"), String(v)); BrushPanel.syncRetouch(); } },
  { id: "brush.range", sec: "brush", get: () => App.brush.range || "mids", set: v => BrushTools.put(BrushTools.field("range"), String(v)) },
  { id: "brush.strength", sec: "brush", get: () => App.brush.strength == null ? .5 : +App.brush.strength,
    set: v => BrushTools.put(BrushTools.field("strength"), isFinite(+v) ? +v : .5) },
  // Smoothing and the pressure curve belong to the HAND, not the tool — one string length and one
  // curve across the tools, the way the colour is one colour.
  { id: "brush.lazy", sec: "brush", get: () => App.brush.lazy || 0,
    set: v => { const n = Math.min(100, Math.max(0, Math.round(+v || 0))); App.brush.lazy = n;
      $("brushLazy").value = n; $("brushLazyVal").textContent = BrushPanel.lazyText(n); } },
  { id: "brush.curve", sec: "brush", get: () => App.brush.curve,
    set: v => { const g = BrushPanel.CURVES.includes(+v) ? +v : 1; App.brush.curve = g; $("penCurve").value = String(g); } },
  // The projected 3-D brush's switch (ROADMAP 1.19 (a)) is the hand's too: one way of painting on the
  // model, whichever tool is in it.
  { id: "brush.proj3d", sec: "brush", get: () => !!App.brush.proj3d,
    set: v => { App.brush.proj3d = !!v; $("brushProj").checked = !!v; BrushPanel.syncPattern(); } },
  // …and its facing limit (1.19 (e)), the hand's for the same reason.
  { id: "brush.face", sec: "brush", get: () => App.brush.face,
    set: v => { const n = ProjBrush.faceOf(v); App.brush.face = n; $("brushFace").value = n; $("brushFaceVal").textContent = n + "°"; } },
  // ROADMAP 4.55: the pattern brush's lattice, one record — the hand's, like the colour.
  { id: "brush.pattern", sec: "brush", get: () => Procedural.brushPatClone(App.brush.pattern), set: v => BrushPanel.setPattern(v) },
  { id: "brush.color", sec: "brush", get: () => App.brush.color,
    set: v => { App.brush.color = v; $("brushColor").value = v; brushStamp._key = null; BrushPanel.syncCycle(); } },
  { id: "brush.value", sec: "brush", get: () => App.brush.value,
    set: v => { App.brush.value = v; $("brushValue").value = v; $("brushValueVal").textContent = v; } },
  // The Clone's tone matching, like the colour: one setting across the tools, since one tool reads it.
  { id: "brush.heal", sec: "brush", get: () => !!App.brush.heal,
    set: v => { App.brush.heal = !!v; $("brushHeal").checked = !!v; } },
  // Every OTHER tool's settings (ROADMAP 3.22). The five rows above are the tool in hand — their
  // ids are the shape every existing install already holds, and they keep it — so this row holds
  // the rest, and deliberately **excludes the current mode**: the same fact stored twice is a fact
  // that disagrees with itself, and the first thing that would have noticed is a save/load round
  // trip restoring one copy over the other. The current tool's row is rebuilt from the live values
  // by `BrushTools.save` on the way out of it, so nothing is lost by leaving it out.
  //
  // Both directions deep-copy, or `capturePrefDefaults` hands `def` the very object about to be
  // mutated and "reset" puts back the settings it was asked to clear.
  { id: "brush.tools", sec: "brush",
    get: () => {
      BrushTools.save(App.brush.mode);
      const o = JSON.parse(JSON.stringify(App.brushTools || {}));
      delete o[App.brush.mode];
      return o;
    },
    set: v => {
      const o = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : {};
      delete o[App.brush.mode];                                // never over the tool in hand
      App.brushTools = o;
    } },
  { id: "palette", sec: "brush", data: true, get: () => App.palette || [],
    set: v => { if (v && v.length) { App.palette = v; renderPalette(); } } },
  // Your own palette (4.50 (12)): data like the recent row — reset keeps it, a settings export carries it.
  { id: "brush.myPalette", sec: "brush", data: true, get: () => Swatches.mine.slice(), set: v => Swatches.adopt(v) },
  { id: "brush.swLib", sec: "brush", get: () => Swatches.lib, set: v => Swatches.set(v) },
  // ---- symmetry ----
  { id: "sym.on", sec: "sym", get: () => $("symOn").checked, set: v => $("symOn").checked = !!v },
  { id: "sym.axis", sec: "sym", get: () => $("symAxis").value, set: v => $("symAxis").value = v },
  { id: "sym.off", sec: "sym", get: () => +$("symOff").value,
    set: v => { $("symOff").value = v; App.symOffset = (v || 0) / 100; $("symOffVal").textContent = v || 0; } },
  // Radial symmetry (ROADMAP 4.44's eighth candidate). The count and the axis travel; the CENTRE
  // does not — it is a point on one vehicle, and restoring it onto the next one would put a ring
  // somewhere arbitrary (radialCount() refuses a centre picked on other geometry anyway).
  { id: "sym.radialN", sec: "sym", get: () => (App.radial && App.radial.n) || 1,
    set: v => { $("radialN").value = v || 1; App.radial = Object.assign(App.radial || { axis: "auto", c: null, dir: null }, { n: v || 1 }); syncRadialUI(); } },
  { id: "sym.radialAxis", sec: "sym", get: () => (App.radial && App.radial.axis) || "auto",
    set: v => { $("radialAxis").value = v || "auto"; App.radial = Object.assign(App.radial || { n: 1, c: null, dir: null }, { axis: v || "auto" }); } },
  // Whether the mirror plane is drawn — its own setting now, not a consequence of symmetry being on
  // (ROADMAP 3.13). Through updateSymPlane rather than by assigning `.value`, or the quad stays on
  // screen after a restore that says it should not be.
  { id: "sym.plane", sec: "sym", get: () => $("symPlaneVis").value,
    set: v => { $("symPlaneVis").value = v; updateSymPlane(); updateRadialAxis(); } },
  // ---- export ----
  { id: "preset", sec: "export", get: () => $("expPreset").value, set: v => { $("expPreset").value = v; $("expPreset").onchange(); } },
  { id: "albFmt", sec: "export", get: () => $("expAlbFmt").value, set: v => $("expAlbFmt").value = v },
  { id: "nrmFmt", sec: "export", get: () => $("expNrmFmt").value, set: v => $("expNrmFmt").value = v },
  { id: "expAlpha", sec: "export", sinceV: 2, get: () => $("expAlpha").value, set: v => $("expAlpha").value = v },
  { id: "expMode", sec: "export", get: () => $("expMode").value, set: v => $("expMode").value = v },
  // "tile" is not a preference: the tile is a sheet of THIS project (4.50 (6)), and a new session has
  // none — so it is remembered as the vehicle's own, and the project file carries the real choice.
  { id: "camoBase", sec: "export", sinceV: 2, get: () => $("expCamoBase").value === "tile" ? "stock" : $("expCamoBase").value,
    set: v => $("expCamoBase").value = v },
  { id: "camoColor", sec: "export", get: () => $("expCamoColor").value, set: v => $("expCamoColor").value = v },
  { id: "invRough", sec: "export", get: () => $("optInvRough").checked, set: v => $("optInvRough").checked = v !== false },
  { id: "mips", sec: "export", get: () => $("optMips").checked, set: v => $("optMips").checked = v === true },
  { id: "pad", sec: "export", get: () => $("optPad").checked, set: v => $("optPad").checked = v !== false },
  { id: "flipV", sec: "export", get: () => $("optFlipV").checked, set: v => $("optFlipV").checked = !!v },
  // ---- game list ----
  { id: "quality", sec: "game", get: () => $("gameQuality").value, set: v => $("gameQuality").value = v },
  { id: "gclass", sec: "game", get: () => GameFilter.cls, set: v => GameFilter.cls = v || "" },
  { id: "gnation", sec: "game", get: () => GameFilter.nation, set: v => GameFilter.nation = v || "" },
  { id: "grank", sec: "game", get: () => GameFilter.rank, set: v => GameFilter.rank = (v | 0) || 0 },
  { id: "gtex", sec: "game", get: () => GameFilter.tex, set: v => GameFilter.tex = !!v },
  // How both lists under the search are ordered (ROADMAP 3.5). Finder.setSort refuses a name it has
  // no entry for, the way a select refuses an option it does not have.
  { id: "gsort", sec: "game", get: () => Finder.sort, set: v => Finder.setSort(v) },
  { id: "decalFolder", sec: "game", data: true, get: () => App.decalFolder || "",
    set: v => App.decalFolder = typeof v === "string" ? v : "" },
  // Loadouts the user built by hand in the Weapons tab. `data` because they are something the user MADE,
  // like the palette — "reset settings" must not throw them away. ArmBuild.adopt is defensive:
  // a settings file is user-editable and one bad row must not stop the app booting.
  { id: "armLoadouts", sec: "game", data: true, get: () => ArmBuild.serialise(),
    set: v => ArmBuild.adopt(v) },
  // ---- layout ----
  // The last things the app forgot at every launch (ROADMAP 3.11c): the sidebar drag was not stored
  // at all, so the width a user had to set to stop the reset button being painted over went back
  // to 230 every time; and the vehicle list's height had a `wtss.gameListH` key of its own, which is
  // exactly the fourth place to write a default that this table exists to remove. `Layout` owns the
  // values — see ui/keys.js for why they are tracked there and not read off `offsetWidth`.
  // The list's HEIGHT became the share between the Vehicle tab's two lists in ROADMAP 3.6 — a new id
  // rather than the old one reinterpreted, because a stored 320 is not a ratio.
  { id: "ui.leftW", sec: "layout", get: () => Layout.width("left"), set: v => Layout.setWidth("left", v) },
  { id: "ui.rightW", sec: "layout", get: () => Layout.width("right"), set: v => Layout.setWidth("right", v) },
  { id: "ui.listSplit", sec: "layout", get: () => Layout.listSplit(), set: v => Layout.setListSplit(v) },
  // The 3D | 2D divider, as a ratio of the pane row — see ui/keys.js for why a ratio and not a width.
  { id: "ui.viewSplit", sec: "layout", get: () => Layout.split(), set: v => Layout.setSplit(v) },
  // `ui.viewDock` (View & scene in the sidebar or in a window, ROADMAP 3.29) is NOT a row while
  // floating is parked (2026-09-25, ui/panels/topwin.js): it is always docked, and a stored `false`
  // from before would float it with no button left to dock it back. The row comes back with the fix.
  // ---- history ----
  // How much memory the undo stack may hold (ROADMAP 1.5). A string, because that is what the
  // <select> holds and what makes "is this at its default?" a plain comparison; setUndoBudget owns
  // the conversion to bytes, the fallback for a value that is not one of the options, and the trim
  // that a lowered ceiling needs.
  { id: "undoBudget", sec: "history", get: () => $("optUndoBudget").value, set: v => setUndoBudget(v) },
];
const PREF_SECTIONS = { view: "View & lighting", brush: "Brush", sym: "Symmetry", export: "Export", game: "Game files", layout: "Layout", history: "History" };
// Dotted ids keep the STORED shape byte-compatible with what every existing install already has —
// `brush:{size,…}`, `sym:{…}`, `light:{…}` — so this refactor does not silently reset anybody.
function prefGet(o, id){ return id.split(".").reduce((v, k) => (v == null ? v : v[k]), o); }
function prefSet(o, id, v){
  const parts = id.split(".");
  let t = o;
  for (let i = 0; i < parts.length - 1; i++) t = t[parts[i]] || (t[parts[i]] = {});
  t[parts[parts.length - 1]] = v;
}
// Whatever the build ships, read off the live page before a single stored value is applied.
function capturePrefDefaults(){
  for (const r of PREFS) { try { r.def = r.get(); } catch (e) { r.def = undefined; } }
}
function prefRows(sec){ return PREFS.filter(r => !r.data && (!sec || r.sec === sec)); }
// Put a section — or everything — back to the build's defaults. Settings only: the palette and the
// last decal folder are the user's, not the app's, and the indexed game folder, the decal library
// and the open project are data and are never touched (`Forget folder & cache` is the one for that).
function resetPrefs(sec){
  let n = 0;
  for (const r of prefRows(sec)) {
    if (r.def === undefined) continue;
    try { r.set(r.def); n++; } catch (e) { reportFailure("Resetting “" + r.id + "”", e, "prefs-reset"); }
  }
  syncSceneToggles();
  Finder.refresh();                            // the chips and the sort are settings: both lists follow
  savePrefs();
  return n;
}
// How many settings in a section are not at their default — what a "changed" dot would read.
function prefsChanged(sec){
  return prefRows(sec).filter(r => r.def !== undefined && JSON.stringify(r.get()) !== JSON.stringify(r.def)).length;
}
// `forFile`: the copy a settings export writes, which carries the rows marked `file` — the brush tips
// (ROADMAP 4.50 (10)), whose home is IndexedDB and which would be dead weight in localStorage.
function prefsBlob(forFile){
  const o = { v: PREFS_VERSION };
  for (const r of PREFS) {
    if (r.file && !forFile) continue;
    try { prefSet(o, r.id, r.get()); } catch (e) { /* a control that is not in this build */ }
  }
  return o;
}
function applyPrefs(p){
  const ver = p.v | 0;
  // A 35 from before v3 becomes the tool's own default — 15, or Panel line's 35 (`BrushTools.fresh`)
  // — while any other value was chosen and stays. Here rather than in loadPrefs, so that a settings
  // file exported by an older build is read the same way.
  if (ver < 3 && p.brush && typeof p.brush === "object") {
    const was = s => typeof s === "number" && Math.abs(s - .35) < 1e-9, b = p.brush;
    if (was(b.spacing)) b.spacing = BrushTools.fresh(b.mode || App.brush.mode).spacing;
    if (b.tools && typeof b.tools === "object")
      for (const m in b.tools) if (b.tools[m] && was(b.tools[m].spacing)) b.tools[m].spacing = BrushTools.fresh(m).spacing;
  }
  if (ver < 4 && p.mips === true) p.mips = false;          // the old default, not a choice (version 4, above)
  if (ver < 5 && p.brush && typeof p.brush === "object" && p.brush.proj3d === false) p.brush.proj3d = true;   // version 5, above
  for (const r of PREFS) {
    // Gated on the version that brought the row in, not on this build's: compared with the build's,
    // the two v2 rows would be dropped from every v2 file the moment the version moved on.
    if (r.sinceV && ver < r.sinceV) continue;
    const v = prefGet(p, r.id);
    if (v === undefined || v === null) continue;
    try { r.set(v); } catch (e) { reportFailure("Restoring the setting “" + r.id + "”", e, "prefs-load"); }
  }
}
function savePrefs(){
  try {
    localStorage.setItem("wtss_prefs", JSON.stringify(prefsBlob()));
    clearFailure("prefs-save");                // working again — allowed to complain again if it stops
  } catch (e) {
    // This runs on a 4-second timer, so it is the one failure that has to be told once rather than
    // 900 times an hour. Silence was worse than noise: the settings simply were not there next
    // time, and nothing had ever said so. A private-mode or quota-full localStorage is the usual
    // cause, and neither is something the app can fix for the user.
    reportFailure("Settings could not be saved — this session's preferences will not be remembered", e, "prefs-save");
  }
}
function loadPrefs(){
  capturePrefDefaults();                       // before anything stored is applied — that is the point
  try {
    const p = JSON.parse(localStorage.getItem("wtss_prefs") || "null");
    if (!p) return;
    // Prefs written by older builds hold either a single `gfilter` string or (briefly, in v0.14)
    // arrays — one filter takes one value now, so an array restores its first entry.
    const one = v => Array.isArray(v) ? v[0] : v;
    if (p.gfilter) { if (p.gfilter === "tex") p.gtex = true; else if (p.gfilter !== "all") p.gclass = p.gfilter; }
    for (const k of ["gclass", "gnation", "grank"]) if (p[k] !== undefined) p[k] = one(p[k]);
    // The vehicle list's dragged height — `ui.gameListH`, and before the table the `wtss.gameListH`
    // key 3.11(c) carried into it — has nothing left to size since ROADMAP 3.6: the list fills the
    // tab and shares it with the skins list by a ratio, and a pixel height says nothing about a share
    // of a column that changes with the window. Decided 2026-09-26: an old value
    // is dropped, not converted, so the first launch of this build opens at the stylesheet's 3:2.
    // Reversal: turn the height into a share of the tab's height here, before applyPrefs.
    localStorage.removeItem("wtss.gameListH");
    applyPrefs(p);
    syncSceneToggles();
    renderFilterChips();
  } catch (e) {
    // A half-applied restore is the honest state and is kept: what has been read is already in the
    // UI and undoing it would lose settings that did survive. Saying so is the whole fix — before,
    // a corrupt prefs blob silently reverted the app to defaults and looked like it had forgotten.
    reportFailure("Some saved settings could not be restored — the rest are as you left them", e, "prefs-load");
  }
}
// ---- carry the settings to another machine ----
// The same JSON, as a file the user saves. Nothing leaves the machine (§0.1) — this is a download
// and an <input type=file>, not an upload. The version gate is the one `.wtproj` uses: a file from
// a newer build is refused with a readable message instead of being half-applied.
function exportPrefsFile(){
  const blob = new Blob([JSON.stringify(prefsBlob(true), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wt_skin_studio_settings.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus("Settings written to " + a.download, "ok");
}
async function importPrefsFile(file){
  try {
    const p = JSON.parse(await file.text());
    if (!p || typeof p !== "object") throw new Error("that file is not a settings file");
    if ((p.v | 0) > PREFS_VERSION)
      throw new Error("it was written by a newer build of the app (settings version " + (p.v | 0) + ", this build reads " + PREFS_VERSION + ")");
    applyPrefs(p);
    syncSceneToggles();
    Finder.refresh();                          // the chips and the sort are settings: both lists follow
    savePrefs();
    setStatus("Settings restored from " + file.name, "ok");
  } catch (e) {
    setStatus("Could not read those settings — " + e.message, "err");
  }
}
// ---- the controls ----
// Bound here rather than in ui/ because the table is here and there is nothing to draw: every one
// of these is one call. (The layer rule in CLAUDE.md §2 is about who owns the DOM, and prefs.js has
// always read it directly — savePrefs did nothing else.)
// Every reset asks first, section ones included (ROADMAP 3.19). There is no undo for a setting, so
// all four of these are unrecoverable — and three of them used to fire on the first click, from a
// button sitting in a section header you look at all day.
//
// It asks only when something would actually change, which is what keeps it from being a click tax:
// already at the defaults, it says so and does nothing. That answer is worth having on its own —
// "did that do anything?" is the question a silent reset leaves you with.
function confirmReset(sec){
  const n = prefsChanged(sec), where = sec ? PREF_SECTIONS[sec] || sec : null;
  if (!n) {
    setStatus((where || "Every setting") + " is already at this build's defaults — nothing to reset", "ok");
    return false;
  }
  const what = where
    ? n + " setting" + (n === 1 ? "" : "s") + " in " + where + " differ" + (n === 1 ? "s" : "") + " from this build's defaults."
    : n + " of " + prefRows().length + " settings differ from this build's defaults.";
  return confirm("Put " + (where || "every setting") + " back to the defaults?\n\n" + what +
    "\n\nYour game folder, decal library and open project are not touched.");
}
function runReset(sec){
  if (!confirmReset(sec)) return;
  const n = resetPrefs(sec);
  setStatus(n + " setting" + (n === 1 ? "" : "s") +
    (sec ? " in " + (PREF_SECTIONS[sec] || sec) : "") + " put back to the defaults", "ok");
  refreshPrefsChanged();
}
for (const b of document.querySelectorAll("button.prefreset")) b.onclick = () => runReset(b.dataset.sec);
$("btnPrefsReset").onclick = () => runReset();
$("btnPrefsExport").onclick = exportPrefsFile;
$("btnPrefsImport").onclick = () => $("prefsPick").click();
$("prefsPick").onchange = async e => {
  const f = e.target.files[0];
  if (f) await importPrefsFile(f);
  e.target.value = "";                          // so the same file can be picked twice
  refreshPrefsChanged();
};
// "How much of this is still stock?" — the question the table makes answerable at all.
function refreshPrefsChanged(){
  const el = $("prefsChanged");
  if (!el) return;
  const n = prefsChanged(), all = prefRows().length;
  el.textContent = n ? n + " of " + all + " settings differ from this build's defaults."
    : "All " + all + " settings are at this build's defaults.";
}
setInterval(refreshPrefsChanged, 4000);
setInterval(savePrefs, 4000);
window.addEventListener("beforeunload", savePrefs);
