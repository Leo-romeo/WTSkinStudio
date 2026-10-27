// The pre-export panel. Built as elements rather than an innerHTML string: every detail line
// carries texture stems and file names read out of the game's own packs.
const V_MARK = { error: "✕", warn: "!", pass: "✓", info: "i" };
const V_ORDER = { error: 0, warn: 1, info: 2, pass: 3 };
function updateExportValidation(items){
  const box = $("expValidate"), sum = $("expValidateSum"), list = $("expValidateList");
  if (!box || !sum || !list) return;
  let res;
  try {
    res = validateExport(buildExportPlan(items || collectExports(true).filter(it => !it.off), { estimate: true }));
  } catch (e) {
    // A broken check must not hide the export button or pretend the skin is fine.
    box.style.display = "";
    sum.textContent = "Rule check unavailable — " + e.message;
    list.textContent = "";
    console.error(e);
    return;
  }
  box.style.display = "";
  const errs = res.filter(r => r.level === "error").length;
  const warns = res.filter(r => r.level === "warn").length;
  const worst = validateWorst(res);
  sum.textContent = errs ? `${errs} problem${errs > 1 ? "s" : ""} the game will reject`
    : warns ? `${warns} thing${warns > 1 ? "s" : ""} to check`
    : `All ${res.length} publishing rules pass`;
  sum.style.color = worst === "error" ? "var(--danger)" : worst === "warn" ? "var(--warn)" : "var(--ok)";
  // open itself when something is actually wrong; stay closed when everything passes
  if (errs || warns) box.open = true;
  list.textContent = "";
  for (const r of res.slice().sort((a, b) => V_ORDER[a.level] - V_ORDER[b.level])) {
    const row = document.createElement("div");
    row.className = "vchkrow v-" + r.level;
    const mark = document.createElement("span");
    mark.className = "vmark";
    mark.textContent = V_MARK[r.level] || "·";
    const body = document.createElement("div");
    const t = document.createElement("div");
    t.className = "vtitle";
    t.textContent = r.title;
    body.appendChild(t);
    if (r.detail) {
      const d = document.createElement("div");
      d.className = "vdetail";
      d.textContent = r.detail;
      body.appendChild(d);
    }
    row.appendChild(mark);
    row.appendChild(body);
    list.appendChild(row);
  }
}
// ROADMAP 4.50 (13): the Market checklist's count, and its inverted-roughness line only while the
// textures carry it — asking the author to tick a box the export does not need would be a wrong
// instruction. Run when the Export window's settings change and on every tick.
const MarketList = {
  sync(){
    const inv = $("optInvRough"), row = $("expMarketInv");
    if (row) row.style.display = inv && inv.checked ? "" : "none";
    const all = [...document.querySelectorAll("#expMarket .mktChk")].filter(c => c.closest(".row").style.display !== "none");
    const done = all.filter(c => c.checked).length, sum = $("expMarketSum");
    if (sum) sum.textContent = "For WT Live — only you can confirm (" + done + " of " + all.length + ")";
  },
};
document.querySelectorAll("#expMarket .mktChk").forEach(c => c.addEventListener("change", MarketList.sync));
$("optInvRough").addEventListener("change", MarketList.sync);
MarketList.sync();
// Kept as the one-line summary the export confirmation dialog needs. Everything it knows now comes
// from validateExport, so there is a single oracle for the publishing rules.
function exportIssues(items){
  return validateExport(buildExportPlan(items, { estimate: true }))
    .filter(r => r.level === "error")
    .map(r => r.title + (r.detail ? " — " + r.detail : ""));
}
function updateExportWarnings(){
  const el = $("expWarn");
  if (!el) return;
  const cls = vehicleClass();
  // ROADMAP 3.31: the mode the CDK forbids for this class is locked in the select, with the mark
  // beside it. A select found sitting on it (a remembered preference, say) goes back to Auto, and
  // the list is redrawn because its rows read the mode.
  const wrongMode = Gate.bites.settex();
  const modeSel = $("expMode");
  if (Gate.options(modeSel, wrongMode ? [wrongMode] : [], "settex", "auto")) { updateExportList(); return; }
  Gate.place(modeSel.parentNode, "settex", () => { updateExportWarnings(); updateExportList(); }, !!wrongMode);
  const mode = exportMode();
  const notes = [];
  // The stock-camouflage row only means anything where the game paints from a camo texture —
  // i.e. exactly where set_tex is the right mode.
  const camoRow = $("rowCamoBase");
  const stems = stockCamoStems();
  if (camoRow) camoRow.style.display = mode === "set_tex" ? "" : "none";
  ExportPreview.tileRows(mode);
  if (cls === "tank" || cls === "ship") {
    if (mode === "replace_tex") notes.push("Ground vehicles normally need set_tex — with replace_tex in-game decals won't stick, and you take over the wear mask yourself.");
    if ($("expAlpha") && $("expAlpha").value === "keep")
      notes.push("Alpha kept: anything below 255 lets the player's camouflage show through your art. Published skins ship it opaque.");
  }
  if (cls === "air" && mode === "set_tex") notes.push("Aircraft only support fixed skins — replace_tex is the correct mode.");
  if (mode === "set_tex") {
    if (!stems.length) notes.push("No camouflage texture was found for this model, so nothing can be pinned — if the skin comes out tinted in game, load the vehicle from the game files rather than from an .obj.");
    else if (camoBaseMode() === "keep") notes.push("Camo left alone: whatever camouflage the player has selected (" + stems.slice(0, 3).join(", ") + (stems.length > 3 ? "…" : "") + ") shows through everywhere your alpha is not opaque.");
    else if (camoBaseMode() === "stock" && stems.some(s => !App.paintTex.has(s) && !App.skinCamo.has(s)))
      notes.push("The stock camo pixels for " + stems.filter(s => !App.paintTex.has(s) && !App.skinCamo.has(s)).slice(0, 2).join(", ") + " were not read from the game files, so that camo cannot be pinned — load the vehicle from the game folder, or pick a solid colour.");
    // My own pattern with nothing to pin: the tile was deleted from its ⋮ menu, or unticked in
    // Textures out. Either way the .blk pins no camouflage, which is the "Leave it" skin — said, not
    // shipped quietly (4.50 (6)).
    else if (camoBaseMode() === "tile" && !camoPinPlan().length)
      notes.push(CamoTile.slot()
        ? "Your camouflage tile is unticked in Textures out, so no camouflage is pinned — the player's own shows through everywhere your alpha is not opaque."
        : "My own pattern is chosen but there is no tile any more — Edit tile makes a new one. Until then no camouflage is pinned, and the player's own shows through everywhere your alpha is not opaque.");
  }
  // ---- BC3 cannot hold a keyed marking's edge, and the user should not have to find that out ----
  // BC3's colour half is BC1: FOUR colours per 4x4 block, all on one line in RGB. A decal edge that
  // has been keyed off its background puts THREE unrelated colours in the same block — the texture
  // underneath, the marking, and the leftover halo of the removed background — and three hues are
  // not on a line. The base beside a marking then pulls toward the marking's colour: measured,
  // olive (110,120,82) decodes as (195,90,80), one block at a time. Better endpoint selection
  // narrows it (worst channel error 106 -> 66) but cannot remove it; only an uncompressed albedo
  // can. It is invisible in the editor because nothing is block-compressed until export.
  if (exportFormats().c === "bc3") {
    let decals = 0;
    for (const s of App.slots.values())
      for (const L of layerLeaves(s.layers))
        if (L.visible && ((c => c && (c.kind === "image" || c.proj))(LayerNode.contentOn(L, "color")))) decals++;
    // A caution rather than a fault, so it is one line and the reason is in its tooltip (3.44).
    if (decals) notes.push({ line: decals + " decal layer" + (decals === 1 ? "" : "s") + " and a DXT5 albedo: keyed decal " +
      "edges can bleed in 4×4 blocks — the Lossless preset keeps them.",
      more: "This skin has " + decals + " image/decal layer" + (decals === 1 ? "" : "s") +
      " and the albedo is being compressed to DXT5. DXT5 stores four colours per 4×4 block along a " +
      "single line, so where a decal edge was keyed off its background — texture, marking and a " +
      "leftover halo in one block — colour bleeds between them in square chunks. It only shows up " +
      "after export, never in the editor. Use the Lossless preset (or set the albedo to " +
      "RGBA8) if the marking edges matter; the file is larger, so watch the archive size limit." });
  }
  // Built as text, never as markup: the stems in these lines are read out of the game's packs.
  // What says something is wrong is said in full; only the DXT5 caution carries a tooltip (3.44).
  el.style.display = notes.length ? "" : "none";
  el.replaceChildren(...notes.map(n => typeof n === "string" ? Tip.make("div", null, "⚠ " + n, "") : Tip.make("div", null, "⚠ " + n.line, n.more)));
  updateCamoPinInfo();
}
// Spell out exactly what the .blk will do to each camo sheet — this is the half of a ground skin
// that is invisible in the 2-D view and was silently repainting vehicles white.
function updateCamoPinInfo(){
  const el = $("camoPinInfo");
  if (!el) return;
  const colBox = $("expCamoColor");
  if (colBox) colBox.style.display = camoBaseMode() === "color" ? "" : "none";
  if (exportMode() !== "set_tex") { el.style.display = "none"; el.textContent = ""; return; }
  const pins = camoPinPlan();
  if (!pins.length) {
    el.style.display = camoBaseMode() === "keep" && stockCamoStems().length ? "" : "none";
    el.textContent = el.style.display ? "No pin: the player's own camouflage shows through everywhere your alpha is not opaque." : "";
    return;
  }
  const swatch = p => {
    if (p.source === "tile") return "your tile, " + escHtml(p.fileName);
    if (p.source === "skin") return "loaded skin's own " + escHtml(p.fileName);
    if (p.source === "stock") { const c = App.paintColor.get(p.stem); return "stock copy" + (c ? " ≈ rgb(" + c.map(v => Math.round(v)).join(",") + ")" : ""); }
    if (p.source === "color") return "solid rgb(" + camoBaseColor().join(",") + ")";
    return p.source === "white" ? "flat white" : "flat mid grey";
  };
  el.style.display = "";
  // The stems a tile leaves alone are the ones the vehicle's own skins never replace (a deck, an
  // interior) — said out loud, because "why is my pattern not on the turret basket" deserves an answer.
  const kept = CamoTile.on() ? stockCamoStems().filter(s => !pins.some(p => p.stem === s)) : [];
  el.innerHTML = pins.map(p => "· <b>" + escHtml(p.stem) + "</b> → " + swatch(p)).join("<br>") +
    (kept.length ? "<br>· " + kept.map(escHtml).join(", ") + " → the game's own (its skins never replace " +
      (kept.length === 1 ? "it" : "them") + ")" : "");
}
// ---------- Camo under skin ▸ My own pattern… (ROADMAP 4.50 (6)) ----------
// A block, so its handlers are not more names in the one shared scope (§2). Choosing
// the mode makes the tile (once) and opens it, because the one thing the choice can mean is "I am
// about to paint a pattern"; leaving it keeps the tile, so switching back and forth loses nothing.
{
  // The tile is made here if it is not there (selectSlot redraws the slot list): the menu can stay
  // on My own pattern after the tile's ⋮ ▸ delete slot, and Edit tile is where the warning under the
  // menu sends you.
  const open = () => {
    CamoTile.ensure();
    selectSlot(CamoTile.ID);
    showTab("paint");
    setStatus("Your camouflage tile — shown 3 × 3, and every stroke, fill and flat decal wraps at its edges. " +
      "It lands on the model through the model's own camouflage UV.", "ok");
  };
  // Both handlers end with what the tile changes: its pins and row (warnings, Textures out) and the
  // model, whose camouflage it now is.
  const changed = () => { updateExportWarnings(); updateExportList(); rebuildMaterials(); needsRender(); draw2D(); };
  // The hangar's two sliders, over the hangar's own ranges: scale 20 %–200 % (camoSettings in
  // gameparams.blk), rotation ±180°. In percent rather than in the hangar's ±10 steps, so the readout
  // is the slider's own value and can be typed like every other one (t88).
  const view = () => {
    const s = +$("camoTileScale").value, rot = +$("camoTileRot").value;
    CamoTile.view.scale = s / 100;
    CamoTile.view.rot = rot;
    $("camoTileScaleVal").textContent = Math.round(CamoTile.view.scale * 100) + "%";
    $("camoTileRotVal").textContent = (rot > 0 ? "+" : "") + rot + "°";
    CamoTile.applyView();
    Tip.set($("camoTileInfo"), CamoTile.readoutLine(), CamoTile.readout());
  };
  $("camoTileScale").oninput = $("camoTileRot").oninput = view;
  // The calibration grid goes in as the tile's base like any picture put there; paint layers already
  // on the tile still draw over it, which is said rather than left to be found. While it is in, the
  // same button takes it out again and puts back the base it covered (ROADMAP 3.45).
  $("btnCamoTileCal").onclick = () => {
    if (CamoTile.calIn()) {
      const back = CamoTile.calTake();
      setStatus(back === "kept" ? "Calibration grid removed — the tile's base is back as it was before the grid."
        : "Calibration grid removed — the base it covered was not kept across the reload, so the tile is back at its start: " +
          (back === "camo" ? "the vehicle's own camouflage." : "flat mid grey, as no camouflage sheet was read for this vehicle."), "ok");
      changed();
      return;
    }
    const made = !CamoTile.slot(), s = CamoTile.calPut(), N = s.baseC.width;
    if (made) changed(); else updateExportWarnings();
    const over = layerLeaves(s.layers).length;
    setStatus("Calibration grid in the tile (" + N + "²): cells 1–16 from the top left, a red frame one repeat wide, the arrow in cell 1 toward +v." +
      (over ? " " + over + " paint layer" + (over === 1 ? "" : "s") + " on the tile still draw over it — hide them for the check." : ""), "ok");
  };
  $("btnCamoTileEdit").onclick = () => { const made = !CamoTile.slot(); open(); if (made) changed(); };
  // The camo pin changes what the vehicle looks like under the skin, so the viewport has to follow.
  $("expCamoBase").onchange = () => {
    if (CamoTile.on()) open();
    CamoTile.applyView();                                     // identity again outside tile mode
    changed();
  };
}
// Mode and Alpha decide whether the albedo's alpha ships, and the viewport shows that decision
// (paintTintFor reads it), so both rebuild the materials — the 3-D view is their preview (3.29).
$("expMode").onchange = () => { updateExportWarnings(); updateExportList(); rebuildMaterials(); needsRender(); ExportPreview.schedule(); };
$("expAlpha").onchange = () => { updateExportWarnings(); updateExportList(); rebuildMaterials(); needsRender(); ExportPreview.schedule(); };
$("expCamoColor").oninput = () => { updateCamoPinInfo(); rebuildMaterials(); needsRender(); draw2D(); };
function exportFormats(){
  const p = $("expPreset").value;
  if (p === "game") return { c: "bc3", n: "rgba8" };
  if (p === "live") return { c: "bc3", n: "bc3" };
  if (p === "lossless") return { c: "rgba8", n: "rgba8" };
  if (p === "tga") return { c: "tga", n: "tga" };
  return { c: $("expAlbFmt").value, n: $("expNrmFmt").value };
}
$("expPreset").onchange = () => {
  const custom = $("expPreset").value === "custom";
  $("expAlbFmt").disabled = $("expNrmFmt").disabled = !custom;
  updateExportList();
  ExportPreview.schedule();
};
$("expAlbFmt").onchange = $("expNrmFmt").onchange = () => { updateExportList(); ExportPreview.schedule(); };
$("optMips").onchange = $("optPad").onchange = $("optInvRough").onchange = () => ExportPreview.schedule();
