// ---------- A saved stack: a group, or a layer, as its own file (ROADMAP 4.44, seventh candidate) ----------
// Substance's *smart material* is a saved layer stack — base, wear, dirt, with their generator
// masks — applied to any mesh. The 20 % of that which gives 80 % here is a **group saved on its
// own**: "my weathering stack" written once and dropped onto the next vehicle. The file is a
// `.wtstack`: a zip holding `stack.json` (one `ProjNode.save` record — the same writer the
// `.wtproj` uses, so every field a layer can carry is already covered, including a bake-made mask,
// a blend-if band, a decal's Look and its styles) plus the PNGs it names.
//
// What cannot carry over is adapted on the way in rather than refused, and each adaptation is
// named in the status line:
//   * every canvas is resampled from the sheet size it was painted at to the slot it lands in;
//     a decal's placement is fractions of the sheet already, only its scale moves;
//   * a projected decal's parameters are a frame in the SOURCE vehicle's world, so the projection
//     is flattened: its rendered sheet is kept as a paint layer, the parameters dropped;
//   * a part limit names parts of the source vehicle — the names this model also has are kept,
//     the rest dropped, and a limit left with no parts becomes no limit;
//   * a link (one layer spread over several textures) is dropped — the stack lands on one slot;
//   * every node gets a fresh uid and a mask-by-layer reference inside the stack follows it, so
//     loading a stack back into the project it came from cannot cross-wire it with the original.
// The version gate is the project's: a file from a newer build is refused with the same sentence.
const Stack = {
  EXT: ".wtstack",
  KIND: "stack",
  // ---- out ----
  async save(slot, node){
    if (!slot || !node) return null;
    const blob = await Stack.pack(slot, node);
    const name = String(node.name || "stack").replace(/[^a-z0-9_\-]/gi, "_") + Stack.EXT;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus("Saved “" + name + "” — drop it onto any texture of any vehicle to load the stack there", "ok");
    return name;
  },
  // The file's bytes, apart from the download — what the test reads back.
  async pack(slot, node){
    const zip = new JSZip();
    let n = 0;
    const put = async c => { const f = "t" + (n++) + ".png"; zip.file(f, await canvasBlob(c)); return f; };
    const ctx = { put, heights: new Map() };
    const sizes = {};
    for (const ch of CHANNELS.map(c => c.id)) { const b = chanBase(slot, ch); if (b) sizes[ch] = [b.width, b.height]; }
    const meta = { app: "wt-skin-studio", kind: Stack.KIND, version: PROJ_VERSION, name: node.name || "stack",
                   vehicle: App.vehicleKey || App.objName || null, slot: slot.id,
                   sheet: [slot.composite.width, slot.composite.height], sizes,
                   node: await ProjNode.save(node, ctx) };
    for (const [f, b] of await TextDecal.fontFiles(meta, TextDecal.fontIds([node]))) zip.file(f, b);   // its text stays editable (4.50 (3))
    zip.file("stack.json", JSON.stringify(meta));
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  },
  // ---- in ----
  async read(file){
    const zip = await JSZip.loadAsync(file);
    const jf = zip.file("stack.json");
    if (!jf) throw new Error("not a WT Skin Studio stack (no stack.json inside)");
    const meta = JSON.parse(await jf.async("string"));
    if (meta.kind !== Stack.KIND || !meta.node) throw new Error("not a saved stack");
    if ((meta.version | 0) > PROJ_VERSION)
      throw new Error("this stack was written by a newer build (format " + meta.version + ", this build reads " + PROJ_VERSION + ") — update the app rather than risk a half-restored file");
    const img = async f => toCanvas(await createImageBitmap(await zip.file(f).async("blob")));
    await TextDecal.restoreFonts(meta, zip);
    const node = await ProjNode.load(meta.node, { img, shared: new Map(), seq: 0 });
    return { meta, node };
  },
  async load(file, slot){
    slot = slot || App.activeSlot;
    if (!slot || !slot.composite) throw new Error("select a texture to put the stack on first");
    const { meta, node } = await Stack.read(file);
    const report = Stack.adapt(node, meta, slot);
    addLayerTo(slot, node);
    const what = isGroup(node) ? "group “" + node.name + "” (" + layerLeaves(node.children).length + " layers)" : "layer “" + node.name + "”";
    setStatus("Loaded " + what + " onto " + slot.id + (report.length ? " — " + report.join("; ") : ""), "ok");
    return node;
  },
  // Everything that has to change for a stack painted on one sheet to sit on another. Returns the
  // list of adaptations made, in words, for the status line.
  adapt(node, meta, slot){
    const W = slot.composite.width, H = slot.composite.height;
    const sw = (meta.sheet && meta.sheet[0]) || W, sh = (meta.sheet && meta.sheet[1]) || H;
    const rep = { resized: 0, flattened: 0, partsDropped: 0, limitsDropped: 0, links: 0, refs: 0 };
    const fresh = new Map();                         // old uid → new
    const fit = (c, w, h) => (c && (c.width !== w || c.height !== h)) ? (rep.resized++, resizeCanvasTo(c, w, h)) : c;
    const walk = n => {
      const old = n.uid; n.uid = LayerNode.newUid(); if (old) fresh.set(old, n.uid);
      if (n.mask) n.mask = fit(n.mask, W, H);
      if (n.link) { delete n.link; rep.links++; }
      if (n.scope && n.scope.parts && n.scope.parts.length) {
        const have = App.meshes ? n.scope.parts.filter(p => App.meshes.has(p)) : [];
        rep.partsDropped += n.scope.parts.length - have.length;
        if (!have.length) { rep.limitsDropped++; n.scope = n.scope.rect ? { rect: n.scope.rect } : null; }
        else n.scope.parts = have;
      }
      if (isGroup(n)) { for (const c of n.children) walk(c); return; }
      for (const ch of LayerNode.channelsOf(n)) {
        const c = n.chans[ch];
        const base = chanBase(slot, ch) || slot.composite;
        if (c.proj) {                                // the frame is another vehicle's world: keep the pixels
          const flat = LayerNode.content("paint", { canvas: fit(c.canvas || mkCanvas(base.width, base.height), base.width, base.height) });
          if (c.visible === false) flat.visible = false;
          if (c.opacity != null) flat.opacity = c.opacity;
          n.chans[ch] = flat; rep.flattened++;
          continue;
        }
        if (c.kind === "paint" && c.canvas) c.canvas = fit(c.canvas, base.width, base.height);
        if (c.kind === "image" && c.scale != null && sw !== W) c.scale = c.scale * (W / sw);
      }
    };
    walk(node);
    // a mask that points at a layer inside the stack follows the renumbering; one that pointed
    // outside it has nothing to point at here and is dropped
    const relink = n => {
      if (n.maskRef && n.maskRef !== LayerNode.BELOW) {
        if (fresh.has(n.maskRef)) n.maskRef = fresh.get(n.maskRef);
        else { delete n.maskRef; rep.refs++; }
      }
      if (isGroup(n)) for (const c of n.children) relink(c);
    };
    relink(node);
    const out = [];
    if (sw !== W || sh !== H) out.push("resampled from " + sw + "×" + sh + " to " + W + "×" + H);
    if (rep.flattened) out.push(rep.flattened + " projected decal" + (rep.flattened === 1 ? "" : "s") + " kept as painted pixels (the projection frame belongs to the vehicle it was made on)");
    if (rep.partsDropped) out.push(rep.partsDropped + " part name" + (rep.partsDropped === 1 ? "" : "s") + " this model does not have dropped from part limits");
    if (rep.links) out.push("its texture link dropped — it sits on this one texture");
    if (rep.refs) out.push(rep.refs + " mask-by-layer reference" + (rep.refs === 1 ? "" : "s") + " pointed outside the stack and " + (rep.refs === 1 ? "was" : "were") + " dropped");
    return out;
  },
};
