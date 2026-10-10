// ---------- Replace base textures ----------
function scaleRGBA(rgba, sw, sh, dw, dh){
  if (sw === dw && sh === dh) return rgba;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(sw - 1, (x * sw / dw) | 0), sy = Math.min(sh - 1, (y * sh / dh) | 0);
    const si = (sy * sw + sx) * 4, di = (y * dw + x) * 4;
    out[di] = rgba[si]; out[di+1] = rgba[si+1]; out[di+2] = rgba[si+2]; out[di+3] = rgba[si+3];
  }
  return out;
}
$("btnReplaceTex").onclick = () => {
  if (!App.activeSlot) { setStatus("Select a slot first", "err"); return; }
  $("replacePick").click();
};
// Keep the game's own bytes for a slot the first time something overwrites them, so loading a
// second skin can put the stock texture back instead of leaving the previous skin's art behind.
function rememberStock(slot, isN){
  const stem = (isN ? slot.nStem : slot.cStem) || "";
  const d = App.decoded.get(stem.toLowerCase());
  if (d && d.raw && !d.stockRaw) { d.stockRaw = d.raw; d.stockName = d.rawName || d.fileName; }
  if (isN) { if (!slot.stockN) slot.stockN = stem; } else if (!slot.stockC) slot.stockC = stem;
}
// The way back. Whatever overwrote a slot's sheet — a second skin, a replaced file, a baked look, a
// raw-channel edit — the game's original bytes are still on the decoded record (rememberStock), so
// putting them back is a re-decode, not a trip to disk. Until 2026-09-20 only the skin loader knew
// this; the "Reset surface edits" button re-initialised from the decoded record AS IT STOOD, which
// after a same-size replacement happened to still hold the stock pixels and after a RESIZED one held
// the replacement — so on the one path where the undo history had been cleared and the button was
// the only way back, it did nothing and said "reset to original" (ROADMAP 3.29(4)). Returns false
// when there is nothing original to go back to.
function restoreStockSheet(slot, isN){
  const stem = String((isN ? slot.nStem : slot.cStem) || "").toLowerCase();
  const d = stem && App.decoded.get(stem);
  if (!d) return false;
  if (d.stockRaw) {
    const st = /\.tga$/i.test(d.stockName || "") ? parseTGA(d.stockRaw) : parseDDS(d.stockRaw);
    d.width = st.width; d.height = st.height; d.mips = st.mips;
    d.raw = d.stockRaw; d.rawName = d.stockName; d.fileName = d.stockName;
  }
  if (isN) { slot.smooth = slot.metal = slot.normal = null; initSlotSurface(slot, d); slot.nEdited = false; }
  else { slot.wearC = null; slot.wearEdited = false; slot._cov = null; fillSlotAlbedo(slot, d, slot.cStem); slot.cEdited = false; }
  return true;
}
// Putting a texture into a slot is a 3 x 2 decision — adopt, resize or bake, on the albedo or on
// the `_n` — and it used to be six `if … return` blocks sharing one body, each with its own copy of
// the "and now tell everything that changed" tail. The tail is why they could not be read apart:
// four of the six returned early through nearly-but-not-quite the same four calls.
//
// Same move as `Composite`, `SkinLoad` and `ExportCollect`: the six are methods, the shared endings
// are one `refresh`, and the three shapes of "write this back into App.decoded" are two helpers
// instead of four copies. `tools/t63_skinload.mjs` sections 10-12 are the oracle for the four
// branches a skin can reach; they were proved able to fail (37/41) before this was touched.
const ReplaceTex = {
  // Raised while a SKIN is being applied, when one caller is about to replace twenty sheets and
  // rebuild once at the end: `refresh` then skips the four scene/DOM calls, and the two bake
  // paths write the sheet without an undo snapshot — a 4096² before-and-after is 128 MB per
  // texture, and a skin load clears the history anyway (SkinLoad.applyAll).
  deferred: 0,
  // Which of the six. Kept as one readable statement rather than spread over the branches, because
  // "why did my texture take that path" is the question every report about this function has asked.
  situation(s, dec, isN){
    if (isN) return !s.smooth ? "adopt"
      : (dec.width !== s.smooth.width || dec.height !== s.smooth.height) ? "resize" : "bake";
    if (!s.baseC || s.missing) return "adopt";
    return (dec.width !== s.baseC.width || dec.height !== s.baseC.height) ? "resize" : "bake";
  },
  // A slot that had nothing here takes the incoming sheet whole, under its own stem — so the export
  // names it, and so a skin is not made unloadable by a texture the GAME did not ship.
  adopt(stem, dec, srcName){
    if (!dec.raw) return;
    dec.fileName = dec.fileName || dec.rawName || srcName;
    App.decoded.set(stem.toLowerCase(), dec);
  },
  // A slot that already had one keeps its decoded record and has the bytes swapped underneath it.
  // The resize path carries the new dimensions with them; the same-size path must not, or a later
  // reader would believe a sheet is a size it is not.
  restamp(stem, dec, srcName, resized){
    if (!dec.raw) return;
    const d = App.decoded.get(String(stem || "").toLowerCase());
    if (!d) return;
    d.raw = dec.raw; d.rawName = dec.rawName || srcName;
    if (resized) { d.width = dec.width; d.height = dec.height; d.mips = dec.mips; }
  },
  // A texture the USER put into a slot — a file (Replace…) or a game texture (the vehicle list's
  // "to slot"). Not applyReplaceTexture itself, which a skin being LOADED also runs through. The bytes
  // change in all six paths, but only the two bakes make a history step; the adopt paths go round
  // the history and the resize paths clear it, so a path that left the revision where it was is a
  // change with no step (ROADMAP 4.50(2)). `changed()` re-stamps every step in the history, so it is
  // not called after a bake: calling it there too — as the first version did, from the file picker
  // only — would re-stamp the replacement's own step, and undoing it would never be clean again.
  byUser(s, dec, isN, srcName){
    const rev = Autosave.rev;
    applyReplaceTexture(s, dec, isN, srcName);
    if (Autosave.rev === rev) Autosave.changed();
  },
  // The four calls every branch ended with, in the one order that is right for all of them.
  // `updateExportList` is in it unconditionally now: the two adopt branches left it out, and an
  // adopted sheet is a new file in the archive, which is exactly what that list reports.
  refresh(s, msg){
    if (!ReplaceTex.deferred) { rebuildMaterials(); refreshSlotList(); updateExportList(); draw2D(); }
    if (msg) setStatus(msg, "ok");
  },
  // The bake the two same-size paths make: with history, or — under `deferred` — the write alone,
  // with the sheet's revision bumped the way bakeAction bumps it, so the flat channel view still
  // knows its source changed.
  bake(desc, canvases, mutate, after){
    if (!ReplaceTex.deferred) { bakeAction(desc, canvases, mutate, after); return; }
    mutate();
    for (const c of canvases) if (c) c._rev = (c._rev || 0) + 1;
    after();
  },

  // ---- the surface half ----
  adoptSurface(s, dec, srcName){
    s.nStem = s.nStem || s.id.replace(/_c$/, "") + "_n";
    initSlotSurface(s, dec);
    s.nEdited = true;
    ReplaceTex.adopt(s.nStem, dec, srcName);
    ReplaceTex.refresh(s, "Surface (_n) loaded into " + s.id + " from " + srcName);
  },
  // A skin authored at 8192 must stay at 8192: rebuild the slot at the incoming resolution rather
  // than squeezing it into whatever the stock texture happened to be.
  resizeSurface(s, dec, srcName){
    const was = s.smooth.width;
    initSlotSurface(s, dec);
    s.nEdited = true;
    ReplaceTex.restamp(s.nStem, dec, srcName, true);
    UndoHistory.clear();                        // old snapshots are the wrong size now
    ReplaceTex.refresh(s, "Surface (_n) replaced from " + srcName + " — slot resized " + was + "→" + dec.width +
      "px (undo history cleared)");
  },
  bakeSurface(s, dec, srcName){
    const w = s.smooth.width, h = s.smooth.height;
    const src = scaleRGBA(dec.mips[0].rgba, dec.width, dec.height, w, h);
    ReplaceTex.bake("replace surface texture", [s.smooth, s.metal, s.normal], () => {
      const sm = new ImageData(w, h), mt = new ImageData(w, h), nr = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const R = src[i*4], G = src[i*4+1], B = src[i*4+2], A = src[i*4+3];
        sm.data[i*4] = sm.data[i*4+1] = sm.data[i*4+2] = R; sm.data[i*4+3] = 255;
        mt.data[i*4] = mt.data[i*4+1] = mt.data[i*4+2] = B; mt.data[i*4+3] = 255;
        nr.data[i*4] = G; nr.data[i*4+1] = A; nr.data[i*4+2] = 128; nr.data[i*4+3] = 255;
      }
      ctx2d(s.smooth).putImageData(sm, 0, 0);
      ctx2d(s.metal).putImageData(mt, 0, 0);
      ctx2d(s.normal).putImageData(nr, 0, 0);
    }, () => { s.nEdited = true; refreshSurfaceTextures(s); draw2D(); });
    ReplaceTex.restamp(s.nStem, dec, srcName, false);
    setStatus("Surface (_n) base replaced from " + srcName, "ok");
    if (!ReplaceTex.deferred) { refreshSlotList(); updateExportList(); }
  },

  // ---- the albedo half ----
  adoptAlbedo(s, dec, srcName){
    s.cStem = s.cStem || s.id;
    fillSlotAlbedo(s, dec, s.cStem);
    s.cEdited = true;
    ReplaceTex.adopt(s.cStem, dec, srcName);
    ReplaceTex.refresh(s, "Albedo loaded into " + s.id + " from " + srcName);
  },
  resizeAlbedo(s, dec, srcName){
    const was = s.baseC.width;
    s.wearC = null; s.wearEdited = false; s._cov = null;
    fillSlotAlbedo(s, dec, s.cStem);
    s.cEdited = true;
    ReplaceTex.restamp(s.cStem, dec, srcName, true);
    UndoHistory.clear();
    ReplaceTex.refresh(s, "Albedo replaced from " + srcName + " — slot resized " + was + "→" + dec.width +
      "px, layers rescaled (undo history cleared)");
  },
  bakeAlbedo(s, dec, srcName){
    const w = s.baseC.width, h = s.baseC.height;
    const src = scaleRGBA(dec.mips[0].rgba, dec.width, dec.height, w, h);
    // The incoming alpha is the coverage mask, not paint, so it goes to covBase and the canvas
    // keeps RGB only — the same split fillSlotAlbedo makes on the resize path above. Putting the
    // RGBA in wholesale left the *stock* coverage to be exported with the new skin, and the alpha
    // that leaked into the composite attenuated the camouflage a second time in the shader.
    const rgb = new Uint8ClampedArray(w * h * 4), cov = new Uint8Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) {
      rgb[i*4] = src[i*4]; rgb[i*4+1] = src[i*4+1]; rgb[i*4+2] = src[i*4+2]; rgb[i*4+3] = 255;
      cov[i] = src[i*4+3];
    }
    // covBase is bytes rather than a canvas, so bakeAction's snapshots do not carry it, and wearC
    // is its cached rendering whenever no wear stack overrides it. Both move under one Ctrl+Z.
    const applyCov = st => () => {
      s.covBase = st.cov; s.wearC = st.wearC;
      s._covRev = (s._covRev || 0) + 1;
      refreshCoverageTexture(s);
    };
    const covWas = { cov: s.covBase, wearC: s.wearC }, covNow = { cov, wearC: null };
    const write = () => {
      ReplaceTex.bake("replace base texture", [s.baseC], () => {
        ctx2d(s.baseC).putImageData(new ImageData(rgb, w, h), 0, 0);
      }, () => compositeSlot(s));
      if (!ReplaceTex.deferred) pushAction("replace base coverage", applyCov(covWas), applyCov(covNow), cov.length * 2);
      applyCov(covNow)();
    };
    if (ReplaceTex.deferred) write(); else withUndoBatch("replace base texture", write);
    s.cEdited = true;
    ReplaceTex.restamp(s.cStem, dec, srcName, false);
    setStatus("Albedo base replaced from " + srcName, "ok");
    if (!ReplaceTex.deferred) { refreshSlotList(); updateExportList(); }
  },
};
// The albedo bake used to open with `if (!s.baseC) { setStatus("This slot has no albedo yet") }`.
// That line was unreachable and is not carried over: a slot with no `baseC` never got that far,
// because the first branch claims `!s.baseC || s.missing` and adopts the incoming sheet instead.
// Writing the six situations out as one statement is what made that visible.
function applyReplaceTexture(s, dec, isN, srcName){
  // A camouflage tile stays square at a size the game takes (4.50 (6)): a picture that is not one is
  // stretched to the tile as a tile, and said so — the same size then makes this an undoable bake.
  const was = !isN && CamoTile.is(s) ? dec : null;
  if (was) dec = CamoTile.squared(dec, s);
  rememberStock(s, isN);
  const how = ReplaceTex.situation(s, dec, isN);
  if (isN) {
    if (how === "adopt") ReplaceTex.adoptSurface(s, dec, srcName);
    else if (how === "resize") ReplaceTex.resizeSurface(s, dec, srcName);
    else ReplaceTex.bakeSurface(s, dec, srcName);
  } else {
    if (how === "adopt") ReplaceTex.adoptAlbedo(s, dec, srcName);
    else if (how === "resize") ReplaceTex.resizeAlbedo(s, dec, srcName);
    else ReplaceTex.bakeAlbedo(s, dec, srcName);
  }
  if (was && dec.stretched) setStatus("Pattern loaded from " + srcName + " — it is " + dec.stretched.join("×") +
    ", and a camouflage tile is a square power of two, so it was stretched to the tile's " + dec.width + "×" +
    dec.height + " (a seamless pattern stays seamless)", "ok");
}
$("replacePick").onchange = async e => {
  const f = e.target.files[0];
  e.target.value = "";
  const tgt = App.replaceTarget; App.replaceTarget = null;
  const s = tgt ? tgt.slot : App.activeSlot;
  if (!f || !s) return;
  try {
    const name = f.name.toLowerCase();
    let dec;
    if (name.endsWith(".dds")) { dec = await parseDDSAsync(await f.arrayBuffer()); dec.rawName = f.name; }   // .raw comes back from the worker
    else if (name.endsWith(".tga")) { const buf = await f.arrayBuffer(); dec = parseTGA(buf); dec.raw = buf; dec.rawName = f.name; }
    else {
      const bmp = await createImageBitmap(f);
      const c = mkCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      dec = { width: bmp.width, height: bmp.height, mips: [{ w: bmp.width, h: bmp.height, rgba: ctx2d(c).getImageData(0, 0, bmp.width, bmp.height).data }] };
    }
    const isN = tgt ? tgt.isN : /_n(\.|_|$)/.test(name.replace(/\.[^.]+$/, "") + ".");
    ReplaceTex.byUser(s, dec, isN, f.name);
  } catch (err) { setStatus("Replace failed: " + err.message, "err"); console.error(err); }
};

