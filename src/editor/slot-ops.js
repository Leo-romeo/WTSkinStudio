// ---------- Slot & layer UI ----------
function decodedStillUsed(stem, exceptSlot){
  if (!stem) return false;
  for (const s of App.slots.values()) {
    if (s === exceptSlot) continue;
    if (s.cStem === stem || s.nStem === stem) return true;
  }
  return false;
}
// Stop a removed texture from being re-bound on the next rebuild, or embedded on save.
function releaseDecoded(stem, slot){ if (stem && !decodedStillUsed(stem, slot)) App.decoded.delete(stem); }

function removeAlbedo(slot){
  if (slot.missing) { setStatus("This slot has no albedo to remove", "err"); return; }
  if (slot.layers.length && !confirm('"' + slot.id + '" has ' + slot.layers.length +
      " layer(s). Remove the albedo texture? The layers are kept.")) return;
  releaseDecoded(slot.cStem, slot);
  slot.cStem = null; slot.cFileName = null;
  initPlaceholderAlbedo(slot, slot.size || PLACEHOLDER_SIZE, slot.sizeH || slot.size || PLACEHOLDER_SIZE);
  rebuildMaterials(); refreshSlotList(); draw2D();
  setStatus("Albedo removed from " + slot.id + " — slot is now an empty placeholder", "ok");
}
function removeSurface(slot){
  if (!slot.smooth) { setStatus("This slot has no _n loaded", "err"); return; }
  if (slot.nEdited && !confirm('"' + slot.id + '" has edited _n maps. Discard them?')) return;
  releaseDecoded(slot.nStem, slot);
  disposeSurfaceTextures(slot);
  slot.nStem = null; slot.nFileName = null; slot.nSize = 0; slot.nEdited = false;
  slot.smooth = slot.metal = slot.normal = null;
  rebuildMaterials(); refreshSlotList(); draw2D();
  setStatus("Surface (_n) removed from " + slot.id, "ok");
}
function deleteSlot(slot){
  if (!confirm('Delete slot "' + slot.id + '"? Its layers and any _n edits are discarded.')) return;
  releaseDecoded(slot.cStem, slot);
  releaseDecoded(slot.nStem, slot);
  disposeSlotTextures(slot);
  compPending.delete(slot);
  App.slots.delete(slot.id);
  for (const [mat, id] of [...App.matSlot]) if (id === slot.id) { App.matSlot.delete(mat); App.manualBind.delete(mat); }
  if (App.activeSlot === slot) { App.activeSlot = null; App.activeLayer = null; }
  App.slotMenu = null;
  rebuildAll(); // materials left orphaned pick up fresh placeholders
  setStatus("Slot " + slot.id + " deleted", "ok");
}
function pickSlotTexture(slot, isN){
  App.replaceTarget = { slot, isN };
  $("replacePick").click();
}
function findInGameFiles(slot, isN){
  const box = $("gameSearch");
  if (box.disabled) { setStatus("Open the War Thunder folder first (Game panel)", "err"); return; }
  const base = (slot.cStem || slot.id).replace(/_c$/, "");
  selectSlot(slot.id);
  showTab("vehicle");
  setTexMode(true);
  box.value = isN ? (slot.nStem || base + "_n") : base;
  $("gameSearchClear").hidden = false;
  renderFilterChips();
  Finder.changed();                  // the box searches the skins list too (ROADMAP 3.5)
  box.scrollIntoView({ block: "nearest" });
  box.focus();
  setStatus('Game files filtered to "' + box.value + '" — use →slot to load into ' + slot.id, "ok");
}
function buildSlotMenu(slot){
  const box = document.createElement("div");
  box.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:5px 8px 8px;border-bottom:1px solid var(--border)";
  const add = (label, title, fn, danger) => {
    const b = document.createElement("button");
    b.textContent = label; b.title = title;
    b.style.cssText = "padding:1px 7px;font-size:11px" + (danger ? ";color:#e2857a" : "");
    b.onclick = ev => { ev.stopPropagation(); fn(); };
    box.appendChild(b);
  };
  // A camouflage tile (4.50 (6)) is colour only and names no game texture, so it keeps the three
  // entries that mean something for it: a new base, its size, and deleting it.
  const tile = CamoTile.is(slot);
  if (tile) add("load a pattern…", "Load an image as the tile's base — square and a power of two, like every War Thunder texture", () => pickSlotTexture(slot, false));
  else add(slot.missing ? "load albedo…" : "replace albedo…", "Load a DDS / TGA / PNG as this slot's base colour", () => pickSlotTexture(slot, false));
  if (!tile) add(slot.smooth ? "replace _n…" : "load _n…", "Load a WT surface (_n) texture: smoothness / normal / metalness", () => pickSlotTexture(slot, true));
  if (!tile) add("from game files", "Filter the game texture list to this slot's name", () => findInGameFiles(slot, false));
  // The layered pair (ROADMAP 4.50 (16)): this texture's stack to another editor and back. Import
  // lands on the selected texture, which the ⋮ that opened this menu has just made this one.
  if (!slot.missing && !tile) add("export layers…", "Write every layer of this texture as one file another editor opens — OpenRaster for Krita, GIMP and MyPaint, PSD for Photoshop and Paint.NET — with the base sheet at the bottom", () => Interchange.exportFile(slot));
  if (!slot.missing && !tile) add("import layers…", "Bring an .ora or .psd file's layers in, as paint layers above this texture's stack", () => pickFiles(Interchange.ACCEPT));
  // One sheet out as a file of its own (ROADMAP 4.59): as the skin export writes it, as an image, or
  // the game's original.
  if (!slot.missing) add("export texture…", "Write this texture on its own — the albedo or _n exactly as Export writes it into the skin, as a PNG / TGA image, or the game's original .dds", () => OneTex.fromSlot(slot));
  // The level ruler (ROADMAP 4.58, docs/MIP_LEVELS.md §6.1): one colour and number per mip level, to
  // see in the game which level lands where on this vehicle.
  if (!slot.missing && !tile) add("level ruler","Add a group that colours and numbers every mip level of this texture, with a filter strip. The 3-D view's Mip levels view shows where each level takes over here; export it and walk away from the vehicle in the game to see where each level takes over — the measurement every level effect is set from.", () => Levels.ruler(slot));
  // ...and the level effects built on it (4.58 (c)): holo foil, colour flip, distance camouflage, metal flake
  if (!slot.missing && !tile) add("level effect…", "Add a holo foil, a colour flip, a distance camouflage or a metal flake — ordinary layers whose look changes from one mip level to the next, so with distance and, on a UserSkin, with the viewing angle.", () => LayerProps.presetDialog(slot));
  if (!slot.missing) add("resolution…","Change the resolution you paint this texture at. Working bigger than the game's own sheet is normal — decals and fine detail are rasterised at this size, so it is what decides how sharp they come out.", () => resizeSlotPrompt(slot));
  if (!slot.missing && !tile) add("remove albedo", "Revert this slot to an empty placeholder", () => removeAlbedo(slot), true);
  if (slot.smooth) add("remove _n", "Drop this slot's surface stack", () => removeSurface(slot), true);
  add("delete slot", "Remove the slot entirely and unbind its materials", () => deleteSlot(slot), true);
  return box;
}
// ---------- The resolution you paint at is not the game's ----------
// A slot used to be locked to whatever size the game shipped, and that is a real limit, not a
// detail: `bag_a_c` and `attch_m1a1_abrams_track_c` only exist in this install at 32×32 (their
// `$hq` entries are empty stubs), so those parts arrived as a 32-pixel sheet that one brush dab
// covers entirely — which is what "I can't paint the bags" is. It also decides decal quality: a
// decal is rasterised into the sheet at composite time, so a small one on a small sheet has no
// pixels to be sharp with. Working above the stock size is normal and costs nothing in game — the
// export writes whatever you choose.
const SLOT_SIZES = [128, 256, 512, 1024, 2048, 4096, 8192];
function resizeCanvasTo(srcCanvas, w, h){
  if (!srcCanvas) return null;
  const out = mkCanvas(w, h);
  const g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  // Downscaling in one step aliases badly; halve repeatedly the way resampleRGBA does.
  let cur = srcCanvas, cw = srcCanvas.width, ch = srcCanvas.height;
  while (cw > w * 2 && ch > h * 2) {
    const nx = mkCanvas(Math.max(w, cw >> 1), Math.max(h, ch >> 1));
    const ng = nx.getContext("2d");
    ng.imageSmoothingQuality = "high";
    ng.drawImage(cur, 0, 0, nx.width, nx.height);
    cur = nx; cw = nx.width; ch = nx.height;
  }
  g.drawImage(cur, 0, 0, w, h);
  return out;
}
function resizeBytes(src, sw, sh, w, h){
  if (!src) return null;
  if (sw === w && sh === h) return new Uint8Array(src);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / h));
    for (let x = 0; x < w; x++) out[y * w + x] = src[sy * sw + Math.min(sw - 1, Math.floor(x * sw / w))];
  }
  return out;
}
function resizeSlot(slot, w, h){
  if (!slot || !slot.baseC) return false;
  const ow = slot.baseC.width, oh = slot.baseC.height;
  if (ow === w && oh === h) return false;
  // A tile wearing the calibration grid takes the grid drawn at the new size, not the old one
  // resampled — smoothing would widen its two-texel frame and move its numbers, and the grid would no
  // longer be recognised as the grid (ROADMAP 3.45, found in its review).
  slot.baseC = CamoTile.is(slot) && CamoTile.calIn() && w === h ? CamoTile.calibration(w) : resizeCanvasTo(slot.baseC, w, h);
  slot.covBase = resizeBytes(slot.covBase, ow, oh, w, h);
  slot.wearC = null; slot._cov = null; slot.chanC = null;
  // The vehicle's own sheet and its paint mask move with it, so the preview keeps working.
  if (slot.stockC) {
    const sw = slot.stockC.width, sh = slot.stockC.height;
    slot.stockA = resizeBytes(slot.stockA, sw, sh, w, h);
    slot.stockC = resizeCanvasTo(slot.stockC, w, h);
    if (slot.texStock) { slot.texStock.dispose(); slot.texStock = null; }
    if (slot.texPaintMask) { slot.texPaintMask.dispose(); slot.texPaintMask = null; }
  }
  // Paint layers and masks are bitmaps and have to be resampled; fills and DECALS are not — a
  // decal keeps its source image and its placement, so it re-rasterises at the new size and comes
  // out genuinely sharper. That is the whole point of raising the resolution before placing one.
  rescaleSlotLayers(slot, w, h);
  slot.size = w; slot.sizeH = h;
  slot._uvMasks = null; slot._rawView = null; slot._rawPrev = null;
  slot._covRev = (slot._covRev || 0) + 1;
  slot._chanRev = (slot._chanRev || 0) + 1;
  ensureComposite(slot, w, h);
  if (slot.smooth) {
    const nh = Math.max(1, Math.round(slot.normal.height * w / slot.nSize));
    slot.smooth = resizeCanvasTo(slot.smooth, w, nh);
    slot.metal = resizeCanvasTo(slot.metal, w, nh);
    slot.normal = resizeCanvasTo(slot.normal, w, nh);
    // The surface textures point at the sheets themselves, which resizeCanvasTo has just replaced,
    // so they are rebuilt rather than re-pointed.
    disposeSurfaceTextures(slot);
    slot.nSize = w;
    refreshSurfaceTextures(slot);
  }
  compositeSlot(slot);
  refreshCoverageTexture(slot);
  // Every snapshot in the history is the wrong size now.
  UndoHistory.clear();
  rebuildMaterials(); refreshSlotList(); refreshLayerList(); updateExportList();
  fit2DNow(); draw2D(); needsRender();
  return true;
}
// ---- the resolution a restored slot should be painted at (ROADMAP 1.15) ----
// `resizeSlot` above changes the sheets and never touches `App.decoded`, and `saveProject` writes
// `App.decoded`'s raw bytes as the project's `assets/` — so a project restores its slot at the
// TEXTURE's own size and the resize is lost, while every layer comes back at the size it was
// painted on. That is stored now (`sm.size`), and this is the answer for the files written before
// it was: the layers themselves are the record. If they agree on a size larger than the sheet, a
// resize is the only thing that could have made them, so put the slot back where the user had it.
//
// Deliberately only ever UPWARDS, and only when every layer agrees. Scaling them down to meet the
// sheet would also "fix" the mismatch and would throw away the resolution the user asked for — and
// it is not needed for correctness, because a layer of another size composites correctly (`blit`
// scales it). Disagreement means something else is going on; infer nothing and leave it alone.
function projectSlotSize(sm, slot){
  if (!slot || !slot.baseC) return null;
  const W = slot.baseC.width, H = slot.baseC.height;
  if (sm && sm.size) {
    const w = sm.size | 0, h = (sm.sizeH | 0) || (sm.size | 0);
    return (w > 0 && h > 0 && (w !== W || h !== H)) ? { w, h, from: "file" } : null;
  }
  let w = 0, h = 0;
  for (const L of layerNodes(slot.layers)) {
    for (const c of [L.type === "paint" ? L.canvas : null, L.mask]) {
      if (!c) continue;
      if (!w) { w = c.width; h = c.height; }
      else if (c.width !== w || c.height !== h) return null;   // they disagree — this is not a resize
    }
  }
  return (w > W && h > H) ? { w, h, from: "layers" } : null;
}
async function resizeSlotPrompt(slot){
  const ow = slot.baseC.width, oh = slot.baseC.height;
  // A camouflage tile stays square, at the sizes a ground vehicle's texture may have (4.50 (6)):
  // keeping the aspect is what every other sheet wants, and it is what kept a tile that was once
  // made 512×256 from ever being put right here.
  const tile = CamoTile.is(slot);
  const opts = (tile ? CamoTile.SIZES : SLOT_SIZES).map(v => ({ label: v + " px" + (v === ow ? " (current)" : v > ow ? " ↑" : ""), value: String(v) }));
  opts.push({ label: "Cancel", value: "" });
  const v = await choiceDialog("Paint “" + slot.id + "” at what resolution?\n\nNow " + ow + "×" + oh +
    ". This is the size decals and brush strokes are rasterised at, and the size the skin exports at. " +
    "Going above the game's own texture is fine and is how you get crisp decals; the undo history is cleared.", opts);
  if (!v) return;
  const n = parseInt(v, 10);
  if (!n || (n === ow && (!tile || n === oh))) return;
  const h = tile ? n : Math.max(1, Math.round(oh * n / ow));
  if (resizeSlot(slot, n, h)) {
    Autosave.changed();                        // an edit that clears the history instead of joining it (4.50(2))
    setStatus("“" + slot.id + "” is now " + n + "×" + h + " — undo history cleared", "ok");
  }
}
// The texture name a missing slot most likely wants, guessed from its material stem
// and WT's channel-suffix conventions.
function guessSlotTexNames(slot){
  const base = (slot.cStem || slot.id).replace(/_[cn]$/, "");
  return base + "_c" + (slot.smooth ? "" : " · " + base + "_n");
}
