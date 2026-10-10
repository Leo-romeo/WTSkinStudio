// ---------- Project save / load ----------
// Version 4 (2026-08-26) stores the layer stack as a TREE: a group is a record with `children`
// (ROADMAP 4.9). Additive — a version 3 file is the same records with no group among them, and
// the reader takes both without a branch. §0 allows this now and will not once the app ships.
//
// **The gate below is new, and its absence was the actual §0 violation.** The version number had
// been written into every project since v1 and NOTHING had ever read it: a file from a newer
// build was half-applied, layer by layer, until something threw. It is checked now, so a project
// this build cannot read is refused with a sentence instead of a partial restore.
const PROJ_VERSION = 5;
function toCanvas(img){
  if (img instanceof HTMLCanvasElement) return img;
  const c = mkCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
function canvasBlob(c){ return new Promise(res => c.toBlob(res, "image/png")); }
// ---------- One node, both directions ----------
// The four halves of this used to be closures inside `saveProject` and `tryApplyProject`, over
// `put` / `img` and two Maps. That was fine while a leaf was one flat record; 4.28(e) made it its
// channel slots and (f) added the derived contents and the fold that migrates an old surface
// folder, and the two functions went to 129 and 169 lines — both already on 2.4's list, and this
// work passes straight through them, which is the exception the 4.28 scope note names.
//
// `ctx` is what the closures used to capture, passed instead: `put` / `img` (the zip's two file
// halves), `heights` (one stored depth image per projected decal, not one per sheet), `shared`
// (proj id -> the ONE parameter object every sheet of that decal points at — moving it after a
// reload would otherwise only move the half that happened to be selected) and `seq`, a counter for
// files old enough to have no proj id.
const ProjNode = {
  // A project file is input from anywhere: someone else's .wtproj can be opened as easily as one's
  // own. Panels put blend, colour and adjustment values into markup (`value="${...}"`), so each is
  // forced to its known shape here, the one place they come in — a crafted string in any of them
  // was markup in the panel (review 2026-10-10).
  blendOf(v){ return COLOR_BLENDS.includes(v) || GREY_BLENDS.includes(v) || v === "pass through" ? v : "normal"; },
  hexOf(v){ const m = /^#?([0-9a-f]{6})$/i.exec(String(v == null ? "" : v)); return m ? "#" + m[1] : v == null ? v : "#808080"; },
  numOf(v, d){ v = +v; return isFinite(v) ? v : d; },
  hsbcOf(m){ const R = Effect.HSBC_REST; return { hue: ProjNode.numOf(m.hue, R.hue), sat: ProjNode.numOf(m.sat, R.sat),
                                                  bright: ProjNode.numOf(m.bright, R.bright), contrast: ProjNode.numOf(m.contrast, R.contrast) }; },
  async save(L, ctx){
    if (isGroup(L)) {
      const gm = { type: "group", name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend,
                   collapsed: !!L.collapsed, children: [] };
      if (!Scope.empty(L.scope)) gm.scope = Scope.clone(L.scope);
      if (L.mask) gm.maskFile = await ctx.put(L.mask);
      if (L.maskRef) gm.maskRef = L.maskRef;
      if (L.tone) gm.tone = { ...L.tone };
      if (L.uid) gm.uid = L.uid;
      for (const c of L.children) gm.children.push(await ProjNode.save(c, ctx));
      return gm;
    }
    // ---- version 5: a leaf IS its channel slots ----
    // A layer used to be one type, one channel and one set of fields, so the record was flat and
    // `chan` was a tag on it. Since 4.28(e) a layer can carry content on several channels at once
    // and there is no flat shape that can say so — which is the "something new to store" the
    // version bump was waiting for (D5, deferred out of (b) for exactly this reason). A version 4
    // leaf is one of these with a single slot in it, and `load` reads both.
    const lm = { name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, chans: {} };
    for (const ch of LayerNode.channelsOf(L)) lm.chans[ch] = await ProjNode.saveContent(L.chans[ch], ctx);
    // The scope is a RECIPE since 4.28(g) — parts and/or a rectangle — where it used to be a bare
    // array of part names. Additive, so the version does not move: a file with `parts` still loads
    // (below), and one written now names `scope` instead. Both are just a place, not pixels.
    if (!Scope.empty(L.scope)) lm.scope = Scope.clone(L.scope);
    if (L.link) lm.link = L.link;                                   // one layer spread over several textures
    if (L.mask) lm.maskFile = await ctx.put(L.mask);
    // A mask that is another layer (4.36): the reference travels as the source's uid, and every
    // node writes its uid so the reference can find it again. Additive — the version stays 5.
    if (L.maskRef) lm.maskRef = L.maskRef;
    // Blend-if (4.44's third): six numbers, no pixels. Additive — the version stays 5, and a reader
    // that has never heard of it shows the layer unmasked, which is the honest degradation.
    if (L.tone) lm.tone = { ...L.tone };
    if (L.uid) lm.uid = L.uid;
    return lm;
  },
  // One channel slot. The fields are the same ones the flat record carried; what moved is which
  // object they hang off, because they were always the CONTENT's and never the layer's.
  async saveContent(c, ctx){
    const m = { kind: c.kind };
    if (c.kind === "fill") {
      m.color = c.color;
      // A gradient (4.44's fifth candidate) is its record, no pixels. Additive — the version stays 5 —
      // and `color` beside it is kept at the first stop, so a reader that has never heard of
      // gradients draws a flat fill of the colour the fade starts from.
      if (c.grad) { m.grad = Gradient.clone(c.grad); if (m.grad.stops.length) m.color = Gradient.sorted(m.grad.stops)[0].color; }
      // A noise rides inside `grad` (4.50 (8)). A pattern (4.50 (7)) is its record plus its tile,
      // stored as an image like a decal's bitmap; `color` beside it is the tile's mean, set when the
      // tile was chosen, so a reader that has never heard of patterns draws the tile's average.
      // Additive, both — the version stays 5.
      if (c.pat && c.patImg) {
        m.pat = Procedural.patClone(c.pat);
        m.patFile = await ctx.put(toCanvas(c.patImg));
        if (c.patName) m.patName = c.patName;
      }
    }
    if (c.kind === "effect") {
      // Levels, Curves and the rest (4.50 (5)) are a record, no pixels. Additive — the version stays
      // 5 — and the four numbers beside it are written AT REST whenever there is one, so a reader
      // that has never heard of `fx` draws no effect rather than a hue shift left over from before
      // the kind was changed.
      Object.assign(m, c.fx ? Effect.HSBC_REST : { hue: c.hue, sat: c.sat, bright: c.bright, contrast: c.contrast });
      if (c.fx) m.fx = Effect.clone(c.fx);
    }
    if (c.kind === "image") {
      Object.assign(m, { x: c.x, y: c.y, scale: c.scale, rot: c.rot, flip: !!c.flip, sym: c.sym || null, surf: c.surf || null });
      m.bmpFile = await ctx.put(toCanvas(c.bmp));
      // The relief MODE rides inside `surf` and needs nothing of its own here; the depth image is
      // a canvas, so it is stored like the bitmap it belongs to (ROADMAP 4.19).
      if (c.heightMap) { m.heightFile = await ctx.put(toCanvas(c.heightMap)); m.heightName = c.heightName || null; }
      // A text decal's record (4.50 (3)), so it opens as text again and not as a picture of some.
      // Additive — the version stays 5 — and the bitmap beside it is what a reader that has never
      // heard of text draws, which is exactly the lettering.
      if (c.text) m.text = { ...c.text };
    }
    if (c.kind === "paint") m.canvasFile = await ctx.put(c.canvas);
    // A content's own flags. `derived` marks a decal's surface response since 4.28(f) — it is the
    // permission a rebuild needs to replace this slot, so a file that lost it would come back with
    // a gloss nothing refreshes and nothing can explain. `visible` and `opacity` belong to the
    // content rather than to the layer around it, and are stored only when they are not the default.
    if (c.derived) m.derived = c.derived;
    if (c.visible === false) m.visible = false;
    if (c.opacity != null && c.opacity !== 1) m.opacity = c.opacity;
    if (c.proj) {                                   // projected layers stay re-projectable
      // depth/wrap are absent from projects written before the GPU projector; the loader's
      // `== null` defaults reproduce exactly what those files used to render.
      if (c.proj.heightMap && !ctx.heights.has(c.proj.id))
        ctx.heights.set(c.proj.id, await ctx.put(toCanvas(c.proj.heightMap)));   // one copy per decal, not per sheet
      if (ctx.heights.has(c.proj.id)) {
        m.projHeightFile = ctx.heights.get(c.proj.id);
        m.projHeightName = c.proj.heightName || null;
      }
      // `sym2Read` (4.2, 2026-08-23) was never written here, so a reload kept the mirrored copy's
      // readable pixels until the first re-render — a nudge, or 4.2's re-edit — and then turned its
      // lettering backwards. Additive: a file without it reads as a true reflection, which is what
      // every copy written before the field was (found 2026-09-25, landing the re-edit).
      // `text` is a projected text decal's record (4.50 (3)); additive like `sym2Read`, and
      // `sharedProj` spreads it back without being told.
      m.proj = { id: c.proj.id, frame: c.proj.frame, scale: c.proj.scale, rot: c.proj.rot, flip: !!c.proj.flip,
        sym2: !!c.proj.sym2, sym2Read: !!c.proj.sym2Read, name: c.proj.name, parts: c.proj.parts || null, surf: c.proj.surf || null,
        depth: c.proj.depth == null ? PROJ_DEPTH_DEF : c.proj.depth,
        wrap: c.proj.wrap == null ? PROJ_WRAP_DEF : c.proj.wrap };
      if (c.proj.text) m.proj.text = { ...c.proj.text };
      m.projFile = await ctx.put(toCanvas(c.proj.bmp));
    }
    return m;
  },
  async load(lm, ctx){
    if (lm.type === "group") {
      const G = { type: "group", name: lm.name, visible: lm.visible !== false,
                  opacity: lm.opacity == null ? 1 : lm.opacity, blend: ProjNode.blendOf(lm.blend),
                  collapsed: !!lm.collapsed, mask: null, parts: null, children: [] };
      G.scope = ProjNode.scopeOf(lm);
      if (lm.maskFile) G.mask = await ctx.img(lm.maskFile);
      if (lm.maskRef) G.maskRef = lm.maskRef;
      if (lm.tone) G.tone = { ...lm.tone };
      G.uid = lm.uid || LayerNode.newUid();
      for (const c of (lm.children || [])) G.children.push(await ProjNode.load(c, ctx));
      return lm.surfGroup ? ProjNode.foldSurfGroup(G) : G;
    }
    // Version 5 stores the slots; version 4 and below store one flat record with a `chan` tag on
    // it, which `LayerNode.of` turns into a single-slot bundle. Two shapes, one node out.
    if (lm.chans) {
      const N = { name: lm.name, visible: lm.visible !== false, opacity: lm.opacity == null ? 1 : lm.opacity,
                  blend: ProjNode.blendOf(lm.blend), chans: {} };
      for (const ch of Object.keys(lm.chans)) N.chans[ch] = await ProjNode.loadContent(lm.chans[ch], ctx);
      N.scope = ProjNode.scopeOf(lm);
      if (lm.link) N.link = lm.link;
      if (lm.surfKey) N.surfKey = lm.surfKey;    // read only, so the fold below can still see it
      if (lm.maskFile) N.mask = await ctx.img(lm.maskFile);
      if (lm.maskRef) N.maskRef = lm.maskRef;
      if (lm.tone) N.tone = { ...lm.tone };
      if (lm.uid) N.uid = lm.uid;                // else LayerNode.of gives it one
      return LayerNode.of(N);
    }
    const L = { type: lm.type, name: lm.name, visible: lm.visible, opacity: lm.opacity, blend: ProjNode.blendOf(lm.blend) };
    if (lm.type === "fill") L.color = ProjNode.hexOf(lm.color);
    if (lm.type === "adjust") Object.assign(L, ProjNode.hsbcOf(lm));
    if (lm.type === "decal") {
      Object.assign(L, { x: lm.x, y: lm.y, scale: lm.scale, rot: lm.rot, flip: lm.flip, sym: lm.sym || null, surf: lm.surf || null });
      L.bmp = await ctx.img(lm.bmpFile);
      if (lm.heightFile) { L.heightMap = await ctx.img(lm.heightFile); L.heightName = lm.heightName || null; }
    }
    if (lm.type === "paint") L.canvas = await ctx.img(lm.canvasFile);
    L.scope = ProjNode.scopeOf(lm);
    if (lm.link) L.link = lm.link;
    if (lm.chan) L.chan = lm.chan;
    if (lm.surfKey) L.surfKey = lm.surfKey;
    if (lm.proj && lm.projFile) L.proj = await ProjNode.sharedProj(lm, ctx);
    if (lm.maskFile) L.mask = await ctx.img(lm.maskFile);
    return LayerNode.of(L);       // the flat record any version stores, migrated forward (4.28(b))
  },
  async loadContent(m, ctx){
    const c = { kind: m.kind };
    if (m.kind === "fill") {
      c.color = ProjNode.hexOf(m.color);
      if (m.grad) c.grad = Gradient.clone(m.grad);
      if (m.pat && m.patFile) {
        const im = await ctx.img(m.patFile);
        // a tile the file lost comes back as the flat fill `color` already describes, not as a
        // pattern with nothing to repeat
        if (im) { c.pat = Procedural.patClone(m.pat); c.patImg = toCanvas(im); c.patName = m.patName || null; }
      }
    }
    if (m.kind === "effect") {
      Object.assign(c, ProjNode.hsbcOf(m));
      if (m.fx) c.fx = Effect.clone(m.fx);             // a kind this build does not know is kept as it came
    }
    if (m.kind === "image") {
      Object.assign(c, { x: m.x, y: m.y, scale: m.scale, rot: m.rot, flip: m.flip, sym: m.sym || null, surf: m.surf || null });
      c.bmp = await ctx.img(m.bmpFile);
      if (m.heightFile) { c.heightMap = await ctx.img(m.heightFile); c.heightName = m.heightName || null; }
      if (m.text) c.text = { ...m.text };              // as it came: normalised only when it is edited
    }
    if (m.kind === "paint") c.canvas = await ctx.img(m.canvasFile);
    if (m.derived) c.derived = m.derived;
    if (m.visible === false) c.visible = false;
    if (m.opacity != null) c.opacity = m.opacity;
    if (m.proj && m.projFile) c.proj = await ProjNode.sharedProj(m, ctx);
    return c;
  },
  // Where a layer applies. Version 5 and later store a `scope` recipe (4.28(g)); everything before
  // it stored a bare `parts` array, which is the same recipe with one key in it. Left `undefined`
  // when the file names neither, because the projector reads that as "this layer predates per-layer
  // scope at all" and a null would tell it the user had cleared one.
  scopeOf(lm){
    if (lm.scope) return Scope.make(lm.scope.parts, lm.scope.rect) || undefined;
    if (lm.parts && lm.parts.length) return Scope.make(lm.parts, null);
    return undefined;
  },
  // Every layer of one projected decal ends up pointing at ONE parameter object, or moving the
  // decal after a reload would only move the half that happens to be selected.
  async sharedProj(m, ctx){
    const id = m.proj.id || ("legacy" + (ctx.seq++));
    if (!ctx.shared.has(id)) ctx.shared.set(id, { ...m.proj, id, bmp: await ctx.img(m.projFile) });
    const P = ctx.shared.get(id);
    if (m.projHeightFile && !P.heightMap) { P.heightMap = await ctx.img(m.projHeightFile); P.heightName = m.projHeightName || null; }
    return P;
  },
  // ROADMAP 4.28(f): fold an old surface folder into the decal it was built around.
  //
  // Until 2026-09-02 a decal's Look was three sibling LAYERS in a group made for it, each tagged
  // `surfKey`, and the group carried `surfGroup` so the loader could re-link them by object
  // identity. The response is channel slots of the decal's own node now (up to four, since wear
  // joined), so every file written before that date is migrated here rather than read back into a
  // shape nothing maintains: each derived sibling becomes a `derived` content on the decal, and the
  // folder — which existed only to hold them — dissolves when that is all it held. A folder the user
  // had also dragged something into keeps that something, and stays.
  foldSurfGroup(G){
    // "The one decal child" is a UV decal (`type: "decal"`) or, since 4.8b, a PROJECTED one —
    // a paint layer carrying `proj` and no `surfKey` of its own.
    const decal = G.children.find(c => !c.surfKey && (c.type === "decal" || c.proj));
    if (!decal) return G;
    for (const c of G.children) {
      const ch = c.surfKey && SURF_DELTA_CHAN[c.surfKey];
      if (!ch || !c.canvas || LayerNode.carries(decal, ch)) continue;
      LayerNode.addContent(decal, ch, LayerNode.content("paint", { derived: c.surfKey, canvas: c.canvas }));
    }
    G.children = G.children.filter(c => !c.surfKey);
    return (G.children.length === 1 && G.children[0] === decal) ? decal : G;
  },
};
// ---------- The file, in parts ----------
// What a .wtproj holds before it is a zip: `meta` is project.json, `files` every image the stack
// needs under the name `meta` gives it, and `assets` the models and source textures, by their path
// in the zip. Two things are written from it — the .wtproj the user downloads, and the recovery
// copy the app keeps in this browser (core/autosave.js, ROADMAP 4.50(2)) — so there is ONE writer,
// and a recovered session comes back through the same reader as a dropped file, version gate and
// all. A second serialiser for the copy would be a second format to keep in step with this one.
//
// `stop` is asked before each image, and a truthy answer abandons the walk with `Cancelled`. The
// recovery copy is taken in the background while the user may start working again, and a copy
// that straddles an edit is a state they never had.
const ProjectFile = {
  async parts(stop){
    // A body's parts layout, from the live App or from its stash (ROADMAP 4.14): the exterior's is
    // `parts`, as it always was; the cockpit body's goes under `cockpit`, additive, version unchanged.
    const partsOf = F => F && F.partAssign ? {
        groups: F.partGroups, assign: Object.fromEntries(F.partAssign),
        collapsed: [...F.groupCollapsed], opened: [...(F.groupOpen || [])], unfold: F.partUnfold || 0,
        selected: [...F.selParts], excluded: [...F.protectedParts],
      } : null;
    const ext = Cockpit.fields("exterior"), ck = Cockpit.fields("cockpit");
    const meta = { app: "wt-skin-studio", version: PROJ_VERSION, vehicleId: $("vehicleId").value, skinName: $("skinName").value,
      flipV: $("optFlipV").checked, preset: $("expPreset").value, slots: [],
      parts: partsOf(ext),
      body: Cockpit.current(), cockpit: ck ? { parts: partsOf(ck) } : null,
      // The loadout the skin was painted against (requested 2026-09-02). Purely additive, so the
      // version does not move: a reader that does not know the field does exactly what every reader
      // before it did. What is stored is the BUILD — unit, the preset it was filled from, and the
      // station→preset assignment — and not the loaded models, which are re-hung from the game's
      // own files on the way back in.
      loadout: (ArmBuild.unit && ArmBuild.assign().length)
        ? { unit: ArmBuild.unit, base: ArmBuild.base, assign: ArmBuild.assign() } : null };
    // both bodies' models, so the file stays self-contained whichever one is on screen; the
    // cockpit's is told apart on the way back in by its name, `<model>_cockpit_0.obj`
    const assets = [];
    if (ext && ext.objRaw) assets.push(["assets/" + ext.objRaw.name, ext.objRaw.text]);
    if (ck && ck.objRaw) assets.push(["assets/" + ck.objRaw.name, ck.objRaw.text]);
    for (const dec of App.decoded.values()) if (dec.raw) assets.push(["assets/" + (dec.rawName || dec.fileName), dec.raw]);
    const files = [];
    let n = 0;
    const put = async c => {
      if (stop && stop()) throw new Cancelled();
      const f = "t" + (n++) + ".png", b = await canvasBlob(c);
      // `toBlob` answers null rather than throwing for a sheet it cannot encode, and a null in the
      // zip failed later with a message about JSZip instead of about the picture.
      if (!b) throw new Error("a " + c.width + "×" + c.height + " image could not be encoded as PNG");
      files.push([f, b]);
      return f;
    };
    await ProjectFile.slots(meta, put);
    // The font files its text is drawn with (4.50 (3)), beside a note that their licence travels
    // with them — in the .wtproj and in a recovery copy alike, so the text stays editable in both.
    files.push(...await TextDecal.fontFiles(meta, TextDecal.fontIds([...App.slots.values()].flatMap(s => s.layers))));
    return { meta, files, assets };
  },
  // Every slot with something in it, into `meta.slots`. The body of what saveProject always did;
  // only where an image goes (`put`) moved out.
  async slots(meta, put){
    // proj id -> its stored depth image. Outside the slot loop on purpose: one projected decal spans
    // several sheets and they share one parameter object, so they must share one copy of the image.
    const projHeightSaved = new Map();
    const ctx = { put, heights: projHeightSaved };
    meta.camoTile = await CamoTile.save(ctx);          // beside the slots, not among them — CamoTile.save says why (4.50 (6))
    for (const s of App.slots.values()) {
      if (CamoTile.is(s) || (!s.layers.length && !s.nEdited && !s.cEdited)) continue;
      const sm = { id: s.id, nEdited: !!s.nEdited, cEdited: !!s.cEdited, layers: [] };
      // The resolution this slot is PAINTED at. It is the user's own choice (`resizeSlotPrompt`) and
      // no version before this one stored it — `resizeSlot` changes the sheets but never
      // `App.decoded`, and `assets/` above is written from `App.decoded`, so the slot came back at the
      // texture's size and the resize was silently lost while every layer returned at the size it was
      // painted. ROADMAP 1.15(A). Purely additive, so the version does not move: a reader that does
      // not know the field does exactly what every reader did before it.
      if (s.composite) { sm.size = s.composite.width; sm.sizeH = s.composite.height; }
      // The stack is a TREE from version 4 (ROADMAP 4.9): a group is a node with `children`, and
      // everything else is exactly the record it always was. A version 3 file is this same shape with
      // no groups in it, so the reader below needs no special case for one.
      for (const L of s.layers) sm.layers.push(await ProjNode.save(L, ctx));
      if (s.nEdited && s.smooth) {
        sm.smoothFile = await put(s.smooth);
        sm.metalFile = await put(s.metal);
        sm.normalFile = await put(s.normal);
      }
      // Per-texture export choices (resolution, format, whether it ships). Additive and optional: a
      // reader that does not know the field just exports everything at native size, which is what
      // every project written before this did. Only stored when something is not the default.
      const exp = {};
      for (const k of ["c", "n"]) {
        const o = s.exp && s.exp[k];
        if (o && (o.size || o.fmt || o.off)) exp[k] = { size: o.size || 0, fmt: o.fmt || "", off: !!o.off };
      }
      if (exp.c || exp.n) sm.exp = exp;
      meta.slots.push(sm);
    }
  },
  // …and the camouflage tile back from beside them, where `slots` put it (4.50 (6)) — the menu on
  // My own pattern first when the file was, so the pins, the warnings and the model it rebuilds are
  // the tile's. The one piece of the reader that lives here, because it is the one the writer
  // above keeps out of `meta.slots`.
  async readTile(rec, ctx){
    if (rec.on) $("expCamoBase").value = "tile";
    await CamoTile.load(rec, ctx);
    updateExportWarnings(); rebuildMaterials();
  },
  // The parts as a zip, in the order the writer has always used: the assets folder, the images in
  // the order the walk named them, project.json last. A recovery copy becomes one of these again to
  // be read (it is Blobs, which JSZip reads lazily) or to be saved as a file.
  zip(p){
    const zip = new JSZip();
    const af = zip.folder("assets");
    for (const [path, data] of p.assets) af.file(path.replace(/^assets\//, ""), data);
    for (const [f, data] of p.files) zip.file(f, data);
    zip.file("project.json", JSON.stringify(p.meta));
    return zip;
  },
  // A zip written out as a .wtproj download. DEFLATE 3, as always: measured 2026-09-25 on a
  // jet-sized project (208 MB, 23 sheets at 4096²) it takes 12.8 s, but JSZip works in chunks and the
  // longest single block of the UI thread was 127 ms, once, at the end. The recovery copy is not
  // built this way at all — see core/autosave.js.
  async download(zip, name){
    progBegin("Packing project…", false);
    let blob;
    try {
      blob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } },
        st => { progress("Packing project… " + (st.currentFile || ""), st.percent / 100); setStatus("Saving project… " + st.percent.toFixed(0) + "%"); });
    } finally { progEnd(); }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ((name || "skin").replace(/[^a-z0-9_\-]/gi, "_")) + ".wtproj";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return blob;
  },
};
async function saveProject(){
  if (!App.slots.size) { setStatus("Nothing to save yet", "err"); return; }
  setStatus("Saving project…");
  // The revision the file is OF, taken before the walk: an edit made while it packs is not in the
  // file, and must leave the project unsaved (ROADMAP 4.50(2)).
  const rev = Autosave.rev;
  let blob, parts;
  try {
    parts = await ProjectFile.parts();
    blob = await ProjectFile.download(ProjectFile.zip(parts), $("skinName").value.trim() || "skin");
  } catch (e) { reportFailure("Saving the project", e, "save-project"); return; }
  Autosave.saved(rev);
  setStatus("Project saved (" + (blob.size / 1048576).toFixed(1) + " MB, model + textures embedded" +
    TextDecal.fontNote((parts.meta.fonts || []).length) + ") — self-contained, reload via Add files", "ok");
}
$("btnSaveProj").onclick = saveProject;
// `file` is the bytes of a .wtproj, or a JSZip already — which is how a recovery copy comes back
// (ROADMAP 4.50(2)): through this reader, so it meets the same version gate as a dropped file.
// `recovered` names the session the copy belongs to, so the restored project carries on in it.
async function loadProject(file, recovered){
  const zip = file instanceof JSZip ? file : await JSZip.loadAsync(file);
  const jf = zip.file("project.json");
  if (!jf) throw new Error("Not a WT Skin Studio project");
  App.pendingProject = { meta: JSON.parse(await jf.async("string")), zip, recovered: recovered || null };
  // The fonts its text uses (4.50 (3)), registered before anything can open that text for editing —
  // a recovery copy's too, which comes back through here.
  await TextDecal.restoreFonts(App.pendingProject.meta, zip);
  // part groups / selection restore independently of the slot-edit pipeline —
  // refreshPartList consumes this once the model's meshes exist
  if (App.pendingProject.meta.parts) App.pendingParts = App.pendingProject.meta.parts;
  // v3 projects are self-contained: restore embedded model + textures first
  const assets = [];
  const afold = zip.folder("assets");
  if (afold) afold.forEach((rel, zf) => { if (!zf.dir) assets.push([rel, zf]); });
  if (assets.length) {
    Cockpit.reset();                                   // the file brings its own bodies (4.14)
    const meta = App.pendingProject.meta;
    for (const [rel, zf] of assets) {
      const nm = rel.toLowerCase();
      try {
        if (nm.endsWith(".obj")) {
          setStatus("Restoring embedded model…");
          await new Promise(r => setTimeout(r, 20));
          const text = await zf.async("string");
          const geomData = buildGeometryData(parseOBJ(text));
          const objName = rel.replace(/\.obj$/i, "").replace(/_\d+$/, "");
          // The vehicle's second body (ROADMAP 4.14), told apart by the name the save gave it.
          // Its parts layout waits in the body until that body is first drawn.
          if (/_cockpit$/i.test(objName)) Cockpit.install({ geomData, objRaw: { name: rel, text }, objName, pendingParts: (meta.cockpit && meta.cockpit.parts) || null });
          else { App.geomData = geomData; App.objRaw = { name: rel, text }; App.objName = objName; }
        } else if (/\.(dds|tga)$/.test(nm)) {
          const buf = await zf.async("arraybuffer");
          // parseDDSAsync transfers `buf` and returns it as .raw — see the decode pool
          let dec;
          if (nm.endsWith(".dds")) dec = await parseDDSAsync(buf);
          else { dec = parseTGA(buf); dec.raw = buf; }
          dec.fileName = rel; dec.rawName = rel;
          App.decoded.set(texStemOf(rel), dec);
        }
      } catch (err) { console.error("asset " + rel, err); }
    }
    // A cockpit sheet only gets its slot when the cockpit body's materials are rebound, and the
    // restore refuses to start while a saved slot is missing — so the restore is held back, the
    // cockpit body is drawn once so its slots exist, and the exterior is put back before it runs
    // (a loadout hangs on the exterior only). The body the file was saved on is set last.
    const held = App.pendingProject; App.pendingProject = null;
    rebuildAll();
    if (App.bodies.cockpit) { await Cockpit.show("cockpit"); await Cockpit.show("exterior"); }
    App.pendingProject = held;
    await tryApplyProject();
  } else await tryApplyProject();
}
async function tryApplyProject(){
  const P = App.pendingProject;
  if (!P) return;
  if (!Array.isArray(P.meta.slots)) { App.pendingProject = null; setStatus("Project file has no slot data — nothing to restore", "err"); return; }
  if ((P.meta.version | 0) > PROJ_VERSION) {
    App.pendingProject = null;
    setStatus("This project was saved by a newer build of the app (project version " + (P.meta.version | 0) +
      ", this build reads " + PROJ_VERSION + ") — update the app rather than risk a half-restored file", "err");
    return;
  }
  const missing = P.meta.slots.filter(sm => { const s = App.slots.get(sm.id); return !s || !s.composite || s.missing; }).map(sm => sm.id);
  if (missing.length) { setStatus("Project waiting for textures: " + missing.join(", ") + " — add the vehicle .obj/.dds files", "err"); return; }
  App.pendingProject = null;
  const img = async f => toCanvas(await createImageBitmap(await P.zip.file(f).async("blob")));
  const prevFlip = $("optFlipV").checked;
  $("optFlipV").checked = !!P.meta.flipV;
  if (prevFlip !== $("optFlipV").checked) {
    for (const s of App.slots.values()) { s.uvOverlay = null; s._uvMasks = null; s._partMaskCache = null; }
    if (App.geomData) buildScene();
  }
  const projShared = new Map();                      // proj id -> the one parameter object per decal
  const ctx = { img, shared: projShared, seq: 0 };
  const resized = [];                                // slots put back at a resolution the file lost
  for (const sm of P.meta.slots) {
    const s = App.slots.get(sm.id);
    s.cEdited = !!sm.cEdited;
    if (sm.exp) for (const k of ["c", "n"]) if (sm.exp[k]) Object.assign(expOpt(s, k), {
      size: +sm.exp[k].size || 0, fmt: sm.exp[k].fmt || "", off: !!sm.exp[k].off });
    s.layers = [];
    // Version 4 stores a tree; a version 3 file is the same records with no `group` among them, so
    // this reads both without a branch (ROADMAP 4.9).
    for (const lm of sm.layers) s.layers.push(await ProjNode.load(lm, ctx));
    if (sm.nEdited && s.smooth) {
      // Scaled to the sheet, not blitted at 1:1. A stored surface sheet is whatever size the `_n`
      // was when the project was written, and the `_n` the slot has now is whichever tier this
      // install actually carries — drawing it at its own size lands it in the corner and leaves the
      // rest of the map untouched. Every other restored sheet is scaled by the compositor's `blit`;
      // these three are written straight into the slot's own canvases, so it has to happen here.
      const paint = async (file, canvas) => {
        const c = await img(file);
        const g = ctx2d(canvas);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(c, 0, 0, canvas.width, canvas.height);
      };
      await paint(sm.smoothFile, s.smooth);
      await paint(sm.metalFile, s.metal);
      await paint(sm.normalFile, s.normal);
      s.nEdited = true;
      refreshSurfaceTextures(s);
    }
    // Put the slot back at the resolution it was painted at — stored since ROADMAP 1.15(A), and
    // inferred from the layers themselves for every project written before it. See projectSlotSize
    // for why it only ever goes up. It happens after the surface sheets are back, so `resizeSlot`
    // carries them up with everything else rather than resizing canvases that are about to be
    // overwritten at the old size.
    const want = projectSlotSize(sm, s);
    if (want) {
      resizeSlot(s, want.w, want.h);
      // Only the INFERRED ones are worth a sentence. A size the file actually carries is the format
      // doing its job, and announcing that on every load would be noise.
      if (want.from === "layers") resized.push(s.id + " → " + want.w + "×" + want.h);
    }
    compositeSlot(s);
    compositeChannels(s);
  }
  if (P.meta.vehicleId) { $("vehicleId").value = P.meta.vehicleId; refreshVehicleIdLock(); }
  if (P.meta.skinName) $("skinName").value = P.meta.skinName;
  if (P.meta.preset) { $("expPreset").value = P.meta.preset; $("expPreset").onchange(); }
  if (P.meta.camoTile) await ProjectFile.readTile(P.meta.camoTile, ctx);   // a tile of your own, beside the slots (4.50 (6))
  UndoHistory.clear();
  Autosave.opened(P.recovered);        // a new document: saved, as it IS the file — unless out of a recovery copy (4.50(2))
  refreshSlotList(); refreshLayerList(); draw2D();
  // Say when a slot came back at a size the file did not record. It is a change to what the user
  // will export, so it is not something to do quietly.
  const armed = await restoreProjectLoadout(P.meta.loadout);
  if (P.meta.body === "cockpit" && App.bodies.cockpit) await Cockpit.show("cockpit");   // the body it was saved on (4.14)
  setStatus("Project restored — " + P.meta.slots.length + " slot(s) with edits" + armed +
    (resized.length ? " · painting resolution restored from the layers: " + resized.join(", ") +
      " (this project predates it being saved)" : ""), "ok");
}

// Put back the loadout a project was painted against, and hang it again if this machine can.
// It is the last thing a restore does on purpose: re-hanging stores loads models out of the game
// packs, so it must not be able to interrupt the part of the restore that owns the user's pixels.
// A project opened without the game folder, or on a patch where the station no longer exists,
// still gets its build back in the panel — it simply cannot fill it in.
async function restoreProjectLoadout(saved){
  if (!saved || !Array.isArray(saved.assign) || !saved.assign.length) return "";
  const { unit, arm } = armamentForCurrentUnit();
  if (!arm || !unit || unit !== saved.unit) {
    return " · its loadout could not be restored (" + (arm ? "this is " + unit + ", not " + saved.unit : "the game folder is not open") + ")";
  }
  ArmBuild.fromAssign(arm, unit, saved.assign);
  ArmBuild.base = saved.base || null;
  refreshWeaponPanel();
  if (!ArmBuild.assign().length) return " · its loadout is not in this version of the game any more";
  if (!App.geomData) return " · loadout restored — it hangs once a model is loaded";
  try {
    await loadWeaponLoadout(arm, ArmBuild.toLoadout(ArmBuild.base || ArmBuild.label()));
  } catch (e) { reportFailure("hanging the loadout this project was painted against", e, "proj-loadout"); }
  return "";
}
