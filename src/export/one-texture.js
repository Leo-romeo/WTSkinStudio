"use strict";
// ---------- One texture out on its own (ROADMAP 4.59) ----------
// Before this a texture left the app only inside the skin export, the OBJ zip (raw `.dds` per
// texture) or as a layer (`LayerExport`). Two doors, both downloads like the project file — nothing
// leaves the machine (CLAUDE.md §0.1):
//   * *save* on a texture-search row: the game's own file (`dec.raw`, the original blocks — exactly
//     what the OBJ export writes) or level 0 decoded, as PNG or TGA;
//   * *export texture…* in a slot's ⋮ menu: the albedo or `_n` as the skin export writes it — the
//     same `ExportCollect` pixels through the same `encodeAllTextures`, so the file is that row's
//     format, size and mips byte for byte, and carries whatever the export learns later — or as PNG /
//     TGA, or the game's original.
// A game texture saved this way is Gaijin's and for the user's own use — the footing the OBJ export
// already stands on (§0.5 forbids hosting and bundling, not a local save).
//
// A PNG is written from the bytes (`codecs/png.js`), never through a canvas: a packed `_n` keeps
// normal X in alpha and a canvas premultiplies, so its colour would round away where X is low.
// Both image encoders run in a pool (§3.1) — a 4096² PNG is 64 MB of filtering and deflate.
const OneTex = {
  _pool: null,
  pool(){
    return OneTex._pool || (OneTex._pool = makeWorkerPool({ name: "onetex", size: 1, sections: ["PNG", "ENCODE"], ops: `var WT_OPS = {
  image: function(a){
    var px = new Uint8Array(a.rgba);
    var done = function(o){ return { __t: 1, result: o.buffer, transfer: [o.buffer] }; };
    if (a.fmt === "tga") return done(writeTGA(px, a.w, a.h));
    return PNG.encode(px, a.w, a.h).then(done);
  }
};` }));
  },
  // RGBA bytes → the file, off this thread. `rgba` is copied when its buffer is not exactly its own.
  async image(rgba, w, h, fmt){
    const exact = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
    const buf = exact ? rgba.buffer : rgba.slice().buffer;
    return new Uint8Array(await OneTex.pool().call("image", { rgba: buf, w, h, fmt }, [buf]));
  },
  // The one place a file is handed to the user (the test replaces it to read what would be saved).
  download(name, data, type){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: type || "application/octet-stream" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  // The install's entry for a texture name, at the quality the search is set to, when it opens.
  gameEntry(stem){
    if (!stem || !GameDB.stems.size) return null;
    let rec = GameDB.stems.get(stem);
    if (!rec) { const lo = stem.toLowerCase(); for (const [s, r] of GameDB.stems) if (s.toLowerCase() === lo) { rec = r; break; } }
    const en = rec && pickVariant(rec, $("gameQuality").value);
    return en && en.supported && en.size ? en : null;
  },
  // ---- the texture search ----
  async entryFile(en, form){
    const dec = await decodeGameEntry(en);
    if (form === "dds") {
      if (!dec.raw) throw new Error("the game's file for " + en.stem + " came back without its bytes");
      return { name: en.stem + ".dds", data: new Uint8Array(dec.raw) };
    }
    const m = dec.mips[0];
    return { name: en.stem + "." + form, data: await OneTex.image(m.rgba, m.w, m.h, form) };
  },
  async fromSearch(en){
    const form = await choiceDialog("Save " + en.stem + " (" + en.w + " × " + en.h + ")", [
      { list: true, label: "The game's own file (.dds)", sub: "the original blocks and mip levels, exactly as the game ships them", go: "Save", value: "dds" },
      { list: true, label: "As an image (PNG)", sub: "level 0 decoded, all four channels — lossless, opens anywhere", go: "Save", value: "png" },
      { list: true, label: "As an image (TGA)", sub: "the same pixels in the file the game's own tools read", go: "Save", value: "tga" },
      { label: "Cancel", value: "cancel" }]);
    if (form !== "dds" && form !== "png" && form !== "tga") return;
    await OneTex.run("saving " + en.stem, () => OneTex.entryFile(en, form));
  },
  // ---- a slot ----
  // The item the skin export would collect for this sheet, ticked or not: asking for one texture is
  // asking for it. Not resized — `override` is applied by the caller that wants the export's size.
  item(slot, kind){
    ExportCollect.settle(false);
    const cx = ExportCollect.ctx(false);
    if (kind === "n") return ExportCollect.surfPixels(cx, slot);
    if (!CamoTile.is(slot)) return ExportCollect.albedoPixels(cx, slot);
    // A camouflage tile writes as its pin names it, and only in its own mode; outside it, its pixels.
    return ExportCollect.tile(cx, slot, false) || Object.assign(ExportCollect.albedoPixels(cx, slot), { fileNameBase: CamoTile.ID });
  },
  async slotFile(slot, kind, form){
    if (form === "dds") {
      const en = OneTex.gameEntry(kind === "n" ? slot.nStem : slot.cStem);
      if (!en) throw new Error("the game folder holds no readable " + (kind === "n" ? slot.nStem : slot.cStem));
      return OneTex.entryFile(en, "dds");
    }
    const it = OneTex.item(slot, kind);
    if (form === "export") {
      ExportCollect.override([it]);
      const enc = await encodeAllTextures([it]);
      if (!enc) return null;                                      // cancelled
      return { name: enc.files[0].name, data: enc.files[0].data };
    }
    return { name: it.fileNameBase + "." + form, data: await OneTex.image(it.rgba, it.w, it.h, form) };
  },
  // What the dialog offers: per sheet the slot has, each form that can be written.
  async slotChoices(slot){
    const sheets = [{ kind: "c", stem: slot.cStem || slot.id, what: "albedo" }];
    if (slot.smooth && !CamoTile.is(slot)) sheets.push({ kind: "n", stem: slot.nStem || String(slot.cStem || slot.id).replace(/_c$/, "") + "_n", what: "surface map" });
    const fmts = exportFormats(), out = [];
    for (const s of sheets) {
      // The format and chain the export decides (`ExportCollect.formatFor`): a flame sheet's DXT5, and a
      // sheet with level content's chain and its DDS under the TGA preset (ROADMAP 4.58; review of (a)).
      const o = expOpt(slot, s.kind), w = s.kind === "n" ? slot.nSize : slot.composite && slot.composite.width;
      const h = s.kind === "n" ? slot.normal && slot.normal.height : slot.composite && slot.composite.height;
      const lv = w && h ? ExportCollect.levels(ExportCollect.ctx(true), slot, s.kind, w, h) : null;
      const fmt = ExportCollect.formatFor({ slot, kind: s.kind, levelNote: lv && lv.note }, fmts);
      out.push({ list: true, label: s.stem + " — as the skin export writes it", go: "Write", value: s.kind + ":export",
        sub: "the " + s.what + " exactly as Export puts it in the skin — " + (fmt === "tga" ? "TGA" : String(fmt).toUpperCase() + " .dds") + (o.size ? ", " + o.size + " px" : "") +
          (lv ? ", with " + lv.note : $("optMips").checked ? ", with mip levels" : "") });
      out.push({ list: true, label: s.stem + " — as an image (PNG)", go: "Write", value: s.kind + ":png",
        sub: "the pixels Export would encode, at the size you paint at, all four channels" + (s.kind === "n" ? " (R roughness, G normal Y, B metal, A normal X)" : "") });
      out.push({ list: true, label: s.stem + " — as an image (TGA)", go: "Write", value: s.kind + ":tga", sub: "the same pixels as TGA" });
      if (OneTex.gameEntry(s.stem)) out.push({ list: true, label: s.stem + " — the game's original (.dds)", go: "Write", value: s.kind + ":dds", sub: "the file as the game ships it, before any of your edits" });
    }
    return out;
  },
  async fromSlot(slot){
    if (!slot || slot.missing) return;
    const v = await choiceDialog("Export a texture of " + slot.id, (await OneTex.slotChoices(slot)).concat([{ label: "Cancel", value: "cancel" }]));
    if (!v || v === "cancel") return;
    const [kind, form] = v.split(":");
    await OneTex.run("exporting " + (kind === "n" ? "the surface map" : "the albedo") + " of " + slot.id, () => OneTex.slotFile(slot, kind, form));
  },
  // One write with a progress surface (§3.5) and the failure said in the user's terms (§4).
  async run(what, make){
    progBegin(what[0].toUpperCase() + what.slice(1) + "…", false);
    try {
      const f = await make();
      progEnd();
      if (!f) { setStatus("Cancelled"); return; }
      OneTex.download(f.name, f.data, /\.png$/.test(f.name) ? "image/png" : /\.tga$/.test(f.name) ? "image/x-tga" : "application/octet-stream");
      setStatus("Written " + f.name + " (" + (f.data.byteLength / 1048576).toFixed(f.data.byteLength < 1048576 ? 2 : 1) + " MB)", "ok");
    } catch (e) { progEnd(); reportFailure(what, e, "one-texture"); }
  },
};
