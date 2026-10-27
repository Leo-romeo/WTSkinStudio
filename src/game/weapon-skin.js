// ---- Bringing a saved weapon paint job into a vehicle project ----
// A weapon painted on its own is saved as an ordinary .wtproj. Loading it normally would replace
// the aircraft; merging instead copies its layers onto whichever slots this project already has,
// which is how a bomb or a pylon painted once gets attached to a skin at export time.
async function mergeProjectLayers(file){
  const zip = await JSZip.loadAsync(file);
  const jf = zip.file("project.json");
  if (!jf) { setStatus("Not a WT Skin Studio project", "err"); return; }
  const meta = JSON.parse(await jf.async("string"));
  if (!Array.isArray(meta.slots) || !meta.slots.length) { setStatus("That project has no painted textures", "err"); return; }
  const img = async f => toCanvas(await createImageBitmap(await zip.file(f).async("blob")));
  const mine = new Map();
  for (const s of App.slots.values()) mine.set(s.id.toLowerCase(), s);
  let merged = 0, skipped = [];
  const undo = [];
  for (const sm of meta.slots) {
    const s = mine.get(String(sm.id).toLowerCase());
    if (!s || !s.composite) { skipped.push(sm.id); continue; }
    for (const lm of (sm.layers || [])) {
      // A second reader of the same file, so every field it copies goes through the project
      // reader's own shapes (ProjNode, core/project.js). It copied them as given until 2026-10-17:
      // a crafted blend, fill colour, channel or hue was markup in the layer panel, untouched by the
      // review that forced them in ProjNode (t140).
      const L = { type: lm.type, name: lm.name, visible: lm.visible !== false, opacity: ProjNode.inOf(lm.opacity, 0, 1, 1),
        blend: ProjNode.blendOf(lm.blend) };
      if (ProjNode.chanOf(lm.chan)) L.chan = lm.chan;
      L.scope = ProjNode.scopeOf(lm);      // parts and/or a rectangle, either shape of file (4.28(g))
      try {
        if (lm.type === "fill") L.color = ProjNode.hexOf(lm.color);
        else if (lm.type === "adjust") Object.assign(L, ProjNode.hsbcOf(lm));
        else if (lm.type === "decal" && lm.bmpFile) { Object.assign(L, ProjNode.placeOf(lm)); L.bmp = await img(lm.bmpFile); }
        else if (lm.type === "paint" && lm.canvasFile) L.canvas = await img(lm.canvasFile);
        else continue;                                    // a projected decal needs its projector; skip rather than guess
        if (lm.maskFile) L.mask = await img(lm.maskFile);
      } catch (e) { console.warn("merge layer", e); continue; }
      s.layers.push(LayerNode.of(L));                     // the flat record a project stores, migrated forward
      undo.push({ slot: s, L });
      merged++;
    }
    // a surface stack that was baked destructively comes over as it was saved
    if (sm.nEdited && s.smooth && sm.smoothFile) {
      try {
        const paint = async (f, c) => { const im = await img(f); const g = ctx2d(c); g.clearRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); };
        await paint(sm.smoothFile, s.smooth); await paint(sm.metalFile, s.metal); await paint(sm.normalFile, s.normal);
        if ((meta.version | 0) < 8) NSheet.turn(s.normal);            // stored in the old order, as tryApplyProject turns it (1.24)
        s.nEdited = true; refreshSurfaceTextures(s);
      } catch (e) { console.warn("merge surface", e); }
    }
    compositeSlot(s); compositeChannels(s);
  }
  if (!merged) { setStatus("Nothing to merge — that project paints " + (skipped.join(", ") || "other") + ", which this one does not have", "err"); return; }
  pushAction("merge " + merged + " layer(s)",
    () => { for (const u of undo) { const o = nodeOwner(u.slot.layers, u.L); if (o) o.list.splice(o.i, 1); scheduleComposite(u.slot); scheduleChannels(u.slot); } refreshLayerList(); },
    () => { for (const u of undo) if (!nodeOwner(u.slot.layers, u.L)) { u.slot.layers.push(u.L); scheduleComposite(u.slot); scheduleChannels(u.slot); } refreshLayerList(); });
  refreshSlotList(); refreshLayerList(); draw2D();
  setStatus("Merged " + merged + " layer(s) from " + (meta.skinName || "that project") +
    (skipped.length ? " · " + skipped.length + " texture(s) it paints are not in this project" : ""), "ok");
}

