// ---------- A texture's layers out to another editor, and another editor's layers in (ROADMAP 4.50 (16)) ----------
// Most skinners' work lives in Photoshop, Krita, GIMP or Paint.NET. Before this the only ways out of
// the app were one layer at a time (*Export as image*, 4.21) or the flattened sheet, and the only way
// in was one image at a time. Two formats, one walk: OpenRaster (`formats/ora.js`) is the layered
// format the free editors share, a zip of PNGs that JSZip already writes; PSD (`formats/psd.js`) is
// the one Photoshop and Paint.NET need, because neither opens an .ora. The walk hands each raster to
// a SINK — a PNG into the zip, or PackBits channels from the psd worker pool — so the two files of
// one stack carry the same pixels, which `t101` checks layer by layer.
//
// **Out: what another editor holds is a stack of rasters,** each with a name, an opacity, a
// visibility and a blend mode, in groups. The app's layers are more than that, so the export decides
// once, here, what each extra becomes — and the rule is the one that keeps the picture exact:
//   * opacity, visibility and blend stay LIVE — they are what the file can say;
//   * everything that is a stencil — a mask, a mask by another layer, a clip, a part limit, blend-if
//     — is applied to the layer's pixels, because the file has no masks. Blend-if is read off the
//     sheet beneath the layer as it stands, exactly as the compositor reads it;
//   * a normal group carrying a stencil of its own is written as ONE layer: a soft mask on a group
//     multiplies the flattened result, and pushed into each child instead it is a different picture;
//   * a pass-through group is a stack with `isolation="auto"` at full opacity, and its opacity and
//     stencils are handed to each child — which is what `Composite.group` does with them anyway;
//   * an effect has no pixels, so it is written as its RESULT: the stencilled, adjusted sheet
//     beneath it, source-over at its opacity — right in the file as exported, and frozen after that.
//     A Levels, Curves… lands source-atop in the app, which a file cannot say, so a normal group
//     holding one is written as one layer (`flatWhy`);
//   * a fill, a decal, a projection and a gradient are what they draw on the sheet;
//   * the base sheet is the bottom layer, so the file opens looking like the texture.
// The walk that does this IS the compositor's walk — `Composite.stencil`, `.groupStencil`,
// `.passAmb` and `.content` are the same calls `Composite.sheet` makes, so the two cannot drift —
// and it lands every layer on a backdrop of its own as it goes, so a blend-if band reads what it
// would read in the app. `t101` holds the result to the app's own composite, and a reference
// OpenRaster renderer to both.
//
// **In: another editor's layers arrive as paint layers**, keeping name, opacity, visibility and
// blend where the compositor has the same formula (`Ora.blendOf`, `Psd.blendOf`) and nested stacks
// as groups. From a PSD also: a layer's or a group's mask as its mask, clipping — of a layer or a
// group — as a mask by the clipping base, fill opacity. What has no equivalent is said, never
// guessed: a coverage operator or another program's own mode (Linear Burn, `krita:…`) is imported
// HIDDEN, because drawn as Normal it would paint the wrong thing over the work; a layer whose image
// is missing or unreadable, and an adjustment layer, which has no pixels, are left out; a layer's or
// a group's style and Blend If are dropped; a Linear Dodge faded below full opacity is kept and
// named, because it fades differently here (`Psd.BLEND`). The file lands as
// ONE node — its only layer, or its layers as a group named after it, the way a saved stack lands
// (`editor/stack.js`) — on the channel the brush is in, the rule every new layer follows (4.28's
// D4), in one undo step.
//
// Nothing leaves the machine: the file is a download and a file you pick (CLAUDE.md §0.1).
const Interchange = {
  EXTS: [".ora", ".psd", ".psb"],
  ACCEPT: ".ora,.psd,.psb",
  // The channels this texture has layers on, colour first — or colour alone when it has none, so a
  // bare texture can still be taken into another editor as a starting point.
  chans(slot){
    const out = CHANNELS.map(c => c.id).filter(ch => Interchange.leafCount(slot, ch) && chanBase(slot, ch));
    return out.length ? out : ["color"];
  },
  leafCount(slot, ch){ return layerLeaves(slot.layers).filter(L => LayerNode.contentOn(L, ch)).length; },

  // ---- out: the stack as rasters another editor can hold ----
  // `sink(canvas)` is handed each raster in stack order, bottom first, and returns what the file
  // calls it. The raster is released as soon as the sink has it, so a 30-layer 4096² stack costs
  // three sheets of memory at a time rather than thirty.
  async rasters(slot, ch, sink){
    const base = chanBase(slot, ch);
    if (!base) throw new Error("no " + CHAN_LABEL[ch] + " sheet is loaded for " + slot.id);
    const sheet = ch === "color" && slot.composite ? slot.composite : base;     // what Composite.sheetFor builds into
    const W = sheet.width, H = sheet.height;
    // A gradient along the model draws nothing until its position bake exists (and asks for one);
    // an export must not be the thing that catches it half-way.
    if (GradFill.needsBake(slot) && !Bake.cached(slot, "pos") && GradFill.bakeable(slot)) await GradFill.enqueue(slot);
    const cx = { slot, ch, W, H, sx: 0, sy: 0, tw: W, th: H, amb: null };
    const st = { sink, done: 0, total: 3 + Interchange.leafCount(slot, ch), notes: { baked: [], flat: [], flatFx: [], effects: [], ops: [], dodge: [] } };
    const back = mkCanvas(W, H), g = ctx2d(back);
    Composite.reset(g);
    Composite.blit(cx, g, base);
    const bottom = { kind: "layer", name: "Base " + CHAN_LABEL[ch].toLowerCase() + " — " + slot.id,
                     opacity: 1, visible: true, blend: "normal", ref: await sink(back) };
    await Interchange.tick(st);
    const rest = await Interchange.walk(cx, { g, canvas: back }, slot.layers.slice(), true, st, true);
    return { w: W, h: H, children: [bottom].concat(rest), merged: back, notes: st.notes, st };
  },
  // One level of the stack, bottom first, exactly as `Composite.stack` walks it. `live` is whether
  // this level lands on `into` at all (not under a hidden group); `emit` is whether its layers go to
  // the file (not inside a group being written as one layer). A hidden layer is still written —
  // hidden — at what it would draw here.
  async walk(cx, into, nodes, live, st, emit){
    const out = [];
    for (const L of nodes) {
      if (isGroup(L)) { const n = await Interchange.group(cx, into, L, live, st, emit); if (n) out.push(n); continue; }
      const c = LayerNode.contentOn(L, cx.ch);
      if (!c) continue;                                         // nothing on this channel: another sheet's layer
      const fx = c.kind === "effect";
      const px = Interchange.leaf(cx, into, L, c);
      // What lands is what the file says: the layer's opacity times every pass-through group's
      // around it (those are written fully opaque), and an effect is Normal in the file whatever
      // its blend says, because the compositor ignores it — the four numbers land source-over and
      // any other kind source-atop, and the walk lands each the way the compositor does.
      const alpha = (L.opacity == null ? 1 : L.opacity) * (fx || c.opacity == null ? 1 : c.opacity) * Composite.ambAlpha(cx);
      const blend = fx ? "normal" : (L.blend || "normal"), atop = fx && !!c.fx;
      const shown = !!L.visible && c.visible !== false;
      if (live && shown) Interchange.land(into, px, alpha, atop ? "source-atop" : blend);
      if (atop) Interchange.keepCoverage(px, into.canvas);
      if (emit) {
        if (fx) st.notes.effects.push(L.name);
        else if (Interchange.stencilled(cx, L)) st.notes.baked.push(L.name);
        out.push({ kind: "layer", name: L.name || "Layer", opacity: alpha, visible: shown, blend, ref: await st.sink(px) });
      }
      px.width = px.height = 0;                                  // in the file now: give the pixels back
      await Interchange.tick(st);
    }
    return out;
  },
  // A group, the way `Composite.group` composites it — see the header for what each kind becomes.
  async group(cx, into, G, live, st, emit){
    if (!layerLeaves(G.children).some(x => LayerNode.contentOn(x, cx.ch))) return null;
    const shown = !!G.visible, ambWas = cx.amb, kids = G.children.slice(), name = G.name || "Group";
    if (G.blend === "pass through") {
      cx.amb = Composite.passAmb(cx, G);
      let children;
      try { children = await Interchange.walk(cx, into, kids, live && shown, st, emit); }
      finally { cx.amb = ambWas; }
      return emit ? { kind: "group", name, pass: true, opacity: 1, visible: shown, blend: "normal", children } : null;
    }
    const K = mkCanvas(cx.W, cx.H), kg = ctx2d(K);
    Composite.reset(kg);
    const why = Interchange.flatWhy(cx, G), flat = !!why;
    cx.amb = null;                                                // the children flatten on their own first
    let children;
    try { children = await Interchange.walk(cx, { g: kg, canvas: K }, kids, true, st, emit && !flat); }
    finally { cx.amb = ambWas; }
    Composite.groupStencil(cx, into, G, kg);
    const alpha = (G.opacity == null ? 1 : G.opacity) * Composite.ambAlpha(cx), blend = G.blend || "normal";
    if (live && shown) Interchange.land(into, K, alpha, blend);
    let node = null;
    if (emit && flat) {
      st.notes[why === "effect" ? "flatFx" : "flat"].push(name);
      node = { kind: "layer", name, opacity: alpha, visible: shown, blend, ref: await st.sink(K) };
    } else if (emit) node = { kind: "group", name, pass: false, opacity: alpha, visible: shown, blend, children };
    K.width = K.height = 0;
    return node;
  },
  // One leaf's raster: its content through its stencil, at full strength, on a transparent sheet.
  // `into.canvas` is the sheet beneath it, which blend-if reads and an effect adjusts.
  leaf(cx, into, L, c){
    const px = mkCanvas(cx.W, cx.H), g = ctx2d(px);
    Composite.reset(g);
    Composite.stencil(cx, { g, canvas: into.canvas }, L, Interchange.drawOf(cx, into, L, c));
    Composite.reset(g);
    return px;
  },
  // `Composite.tables` lands a Levels, Curves… result source-ATOP — colour, never coverage — and the
  // walk lands it the same way (`walk`). The FILE's layer is then given the beneath's alpha, which
  // makes it, drawn source-over, the same picture wherever the beneath is opaque: the whole sheet at
  // the top of the stack and in any pass-through group there. Inside a normal group the beneath is
  // the group's own content, and there it is not — which is why `flatWhy` writes that group as one
  // layer. Source-atop leaves the beneath's alpha as it was, so it can be read after the landing.
  keepCoverage(px, beneath){
    const g = ctx2d(px);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(beneath, 0, 0);
    Composite.reset(g);
  },
  // What a leaf draws, as the compositor draws it: the content, or an effect's adjusted copy of the
  // sheet beneath — the four numbers through `Composite.fxFilter`, any other kind through the same
  // tables and the same GPU-or-CPU pass `Composite.tables` uses (4.50 (5)). A kind this build does
  // not know compiles to nothing and draws nothing, there as here.
  drawOf(cx, into, L, c){
    if (c.kind !== "effect") return dst => Composite.content(cx, dst, c, L);
    if (!c.fx) return dst => { dst.filter = Composite.fxFilter(c); dst.drawImage(into.canvas, 0, 0); dst.filter = "none"; };
    const T = Effect.table(c);
    if (!T) return () => {};
    const adj = Composite.fxGL.draw(cx, into, T) || Composite.fxCPU(cx, into, T);
    return dst => dst.drawImage(adj, 0, 0);
  },
  land(into, px, alpha, blend){
    const g = into.g;
    g.globalAlpha = alpha;
    g.globalCompositeOperation = blend === "normal" ? "source-over" : blend;
    g.drawImage(px, 0, 0);
    Composite.reset(g);
  },
  // Does anything stencil this node — the test `Composite.stencil` / `.groupStencil` apply, asked
  // ahead of time: for a leaf it is a line in the report, for a group it is "write it as one layer".
  stencilled(cx, n){
    if (LayerNode.maskCanvas(cx.slot, n) || Scope.stencil(cx.slot, n) || (n.tone && n.tone.on !== false)) return true;
    for (let a = cx.amb; a; a = a.up) if (a.mask || a.scope) return true;
    return false;
  },
  // Why a NORMAL group is written as one layer, or null. "mask": a stencil of its own, because a
  // soft mask on a group multiplies the flattened result and pushed into each child it is a
  // different picture. "effect": a Levels, Curves… inside it (directly, or in a pass-through group
  // in it), because the app lands that on the group's own content without adding coverage, and a
  // layer in a file cannot — over a 70 % layer, a Levels at rest would make it 91 % (the case t92
  // measured in the compositor). The four numbers draw source-over in the app as well, so they
  // write exactly and do not count; a hidden effect draws nothing and does not count.
  flatWhy(cx, G){
    if (Interchange.stencilled(cx, G)) return "mask";
    const has = list => list.some(n => {
      if (!n.visible) return false;
      if (isGroup(n)) return n.blend === "pass through" && has(n.children);
      const c = LayerNode.contentOn(n, cx.ch);
      return !!(c && c.kind === "effect" && c.fx && c.visible !== false);
    });
    return has(G.children) ? "effect" : null;
  },
  async tick(st){
    st.done++;
    progress(null, Math.min(1, st.done / st.total));
    await progTick();
    throwIfCancelled();
  },
  async png(c){
    const b = await canvasBlob(c);
    if (!b) throw new Error("the browser could not encode a " + c.width + " × " + c.height + " PNG");
    return b;
  },
  thumb(src, max){
    const k = Math.min(1, max / Math.max(src.width, src.height));
    return resizeCanvasTo(src, Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  },

  // The flattened picture a file carries is the app's own sheet, not the walk's: they are one
  // computation, but an effect or a rotated decal written as a layer is rounded to 8 bits once more
  // than the app rounds it, so the two differ by a level or two here and there (measured in t101).
  // The preview another program shows should be exactly the texture you painted.
  flatSheet(slot, ch, R){
    flushComposites();
    const s = chanOut(slot, ch);
    return s && s.width === R.w && s.height === R.h ? s : R.merged;
  },
  // Layers and groups in a tree of either shape (the walk's, or an imported one).
  count(list){
    const k = { layers: 0, groups: 0 };
    const walk = l => { for (const n of l) { if (n.children) { k.groups++; walk(n.children); } else k.layers++; } };
    walk(list || []);
    return k;
  },

  // ---- OpenRaster ----
  // The file's bytes, apart from the download — what the test reads.
  async packOra(slot, ch){
    const zip = new JSZip();
    zip.file("mimetype", Ora.MIME, { compression: "STORE" });   // first and stored: see formats/ora.js
    let n = 0;
    // PNG is compressed already, so the zip stores it: deflating it again is CPU spent on the page's
    // one thread for a few per cent.
    const sink = async c => {
      const f = "data/layer" + String(n++).padStart(3, "0") + ".png";
      zip.file(f, await Interchange.png(c), { compression: "STORE" });
      return f;
    };
    const R = await Interchange.rasters(slot, ch, sink);
    zip.file("stack.xml", Ora.write({ w: R.w, h: R.h, children: Interchange.oraNodes(R.children, R.notes) }), { compression: "DEFLATE" });
    const merged = Interchange.flatSheet(slot, ch, R);
    zip.file("mergedimage.png", await Interchange.png(merged), { compression: "STORE" });
    await Interchange.tick(R.st);
    zip.file("Thumbnails/thumbnail.png", await Interchange.png(Interchange.thumb(merged, 256)), { compression: "STORE" });
    await Interchange.tick(R.st);
    const blob = await zip.generateAsync({ type: "blob", mimeType: Ora.MIME });
    return { blob, w: R.w, h: R.h, count: Interchange.count(R.children), notes: R.notes };
  },
  oraNodes(list, notes){
    return list.map(n => {
      const op = n.pass ? "svg:src-over" : Ora.opOf(n.blend);
      if (!op) notes.ops.push(n.name + " (" + n.blend + ")");
      const o = { kind: n.kind === "group" ? "stack" : "layer", name: n.name, opacity: n.opacity, visible: n.visible, op: op || "svg:src-over" };
      if (n.kind === "group") { o.isolation = n.pass ? "auto" : "isolate"; o.children = Interchange.oraNodes(n.children, notes); }
      else { o.src = n.ref; o.x = 0; o.y = 0; }
      return o;
    });
  },
  async readOra(file){
    const zip = await JSZip.loadAsync(file);
    const sx = zip.file("stack.xml");
    if (!sx) throw new Error("not an OpenRaster file (no stack.xml inside)");
    return { zip, doc: Ora.parse(await sx.async("string")) };
  },
  // The parsed file as ONE node for `slot` (see the header), every raster at the size a new layer
  // on `ch` gets.
  async adoptOra(zip, doc, slot, ch, name){
    const st = Interchange.inState(slot, ch, doc.w, doc.h, Interchange.count(doc.children).layers);
    Object.assign(st, { zip, doc });
    const kids = await Interchange.oraList(doc.children, st);
    if (!kids.length) throw new Error("it holds no layer this app can read" +
      (st.notes.unread.length ? " — " + st.notes.unread.length + " of them are not PNG images" : ""));
    return Object.assign(Interchange.one(kids, name), { notes: st.notes, from: [doc.w, doc.h], to: [st.SW, st.SH], skipped: doc.skipped });
  },
  async oraList(list, st){
    const out = [];
    for (const n of list) {
      if (n.kind !== "stack") { const L = await Interchange.oraLayer(n, st); if (L) out.push(L); continue; }
      const kids = await Interchange.oraList(n.children, st);
      if (!kids.length) continue;                                // empty, or nothing in it could be read
      const m = Ora.blendOf(n.op);
      if (m.lost) st.notes.lost.push({ name: n.name || "Group", op: m.lost });
      // "auto", source-over and opaque is not isolated at all: the app's pass-through (formats/ora.js)
      const pass = n.isolation === "auto" && m.blend === "normal" && !m.lost && n.opacity >= 1;
      out.push(Object.assign(newGroupNode(n.name || "Group"), { children: kids, opacity: n.opacity,
        visible: n.visible && !m.lost, blend: pass ? "pass through" : m.blend }));
    }
    return out;
  },
  async oraLayer(n, st){
    const name = n.name || String(n.src || "layer").replace(/^.*\//, "").replace(/\.[^.]*$/, "");
    const path = String(n.src || "").replace(/^(\.?\/)+/, "");
    const f = path ? st.zip.file(path) : null;
    let bmp = null;
    if (!f) st.notes.missing.push(name);
    else {
      // The file's bytes as they are, with no colour management — the game applies none, so neither
      // does the texture. An SVG layer or a broken PNG is named in the report and the rest lands.
      try { bmp = await createImageBitmap(await f.async("blob"), { colorSpaceConversion: "none" }); }
      catch (e) { st.notes.unread.push(name); }             // the browser's reason says no more than "not decodable"
    }
    await Interchange.tick(st);
    if (!bmp) return null;
    const c = mkCanvas(st.W, st.H);
    ctx2d(c).drawImage(bmp, n.x, n.y);                           // a writer may crop a layer and place it
    bmp.close();
    const m = Ora.blendOf(n.op);
    if (m.lost) st.notes.lost.push({ name, op: m.lost });
    return Interchange.paintLayer(st, name, c, n.visible && !m.lost, n.opacity, m.blend);
  },

  // ---- PSD ----
  // The pixel half of `formats/psd.js` in a worker: PackBits is codec work (CLAUDE.md §3.1), and a
  // 4096² layer is sixteen million texels a channel — measured on a skin's PSD, 1.5 s of plain
  // JavaScript to decode and flatten its two layers. The READBACK goes there too: a layer is handed
  // over as an ImageBitmap and read on an OffscreenCanvas in the worker, because `getImageData` on
  // an accelerated sheet transfers the whole surface — ~520 ms at 8192² (wt-canvas skill), once per
  // layer, on this thread. The inline fallback has both APIs on the main thread and runs the same ops.
  pool(){
    return Interchange._pool || (Interchange._pool = makeWorkerPool({ name: "psd", size: Math.min(2, poolSize()), sections: ["PSD"],
      ops: `var WT_OPS = {
  read: function(bmp){
    var c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0); bmp.close();
    return g.getImageData(0, 0, c.width, c.height).data;
  },
  encode: function(a){ var e = Psd.encode(WT_OPS.read(a.bmp), a.w, a.h); return { __t: 1, result: e, transfer: e.chans.map(function(c){ return c.data.buffer; }) }; },
  merged: function(a){ var m = Psd.mergedData(WT_OPS.read(a.bmp), a.w, a.h); return { __t: 1, result: m, transfer: [m.buffer] }; },
  flat: function(a){ var m = Psd.merged(new Uint8Array(a.buf), a.doc); return { __t: 1, result: m, transfer: [m.buffer] }; },
  pixels: function(a){
    var p = Psd.pixels(new Uint8Array(a.buf), a.rec, a.depth, a.psb, a.grey), t = [p.rgba.buffer];
    if (p.mask) {
      var m = p.mask, rgba = new Uint8ClampedArray(m.w * m.h * 4);
      for (var i = 0; i < m.w * m.h; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = m.data[i]; }
      m.rgba = rgba; m.data = null; t.push(rgba.buffer);
    }
    return { __t: 1, result: p, transfer: t };
  }
};` }));
  },
  async packPsd(slot, ch){
    const pool = Interchange.pool(), encs = [];
    // The bitmap is a snapshot taken when it is asked for, so the raster can be released as soon as
    // the sink returns, exactly as the OpenRaster sink releases it once its PNG exists.
    const job = async (op, c) => { const bmp = await createImageBitmap(c); return pool.call(op, { bmp, w: c.width, h: c.height }, [bmp]); };
    const sink = async c => { encs.push(await job("encode", c)); return encs.length - 1; };
    const R = await Interchange.rasters(slot, ch, sink);
    const merged = await job("merged", Interchange.flatSheet(slot, ch, R));
    await Interchange.tick(R.st);
    const parts = Psd.write({ w: R.w, h: R.h, layers: Interchange.psdLayers(R.children, encs, R.notes), merged });
    await Interchange.tick(R.st);
    return { blob: new Blob(parts, { type: Psd.MIME }), w: R.w, h: R.h, count: Interchange.count(R.children), notes: R.notes };
  },
  // The walk's tree as Photoshop's flat record list, bottom first: a group is its divider, its
  // children, then its folder, which carries the group's name, opacity and blend (`pass` for a
  // pass-through group — the walk wrote those at full opacity, as it does for OpenRaster). A
  // `lighter` node written below full opacity is Linear Dodge faded after the add in Photoshop, where
  // the app fades it inside (`Psd.BLEND`), so it is named. Writing its alpha as a fill opacity
  // instead, which Photoshop applies inside the add for that mode, was not taken: whether the other
  // programs the file is for read a fill opacity is not known here, and one that did not would draw
  // the layer at full strength.
  psdLayers(list, encs, notes){
    const out = [];
    for (const n of list) {
      const key = n.pass ? "pass" : Psd.keyOf(n.blend);
      if (!key) notes.ops.push(n.name + " (" + n.blend + ")");
      if (n.blend === "soft-light") notes.soft = (notes.soft || 0) + 1;
      if (n.blend === "lighter" && Math.round(n.opacity * 255) < 255) notes.dodge.push(n.name);
      if (n.kind !== "group") { out.push({ name: n.name, key: key || "norm", opacity: n.opacity, hidden: !n.visible, enc: encs[n.ref] }); continue; }
      out.push({ name: "</Layer group>", section: 3, key: "norm", opacity: 1, hidden: false });
      out.push(...Interchange.psdLayers(n.children, encs, notes));
      out.push({ name: n.name, section: 1, key: key || "norm", opacity: n.opacity, hidden: !n.visible });
    }
    return out;
  },
  async readPsd(file){
    const b = new Uint8Array(await file.arrayBuffer());
    const doc = Psd.read(b);
    const MODES = ["bitmap", "greyscale", "indexed-colour", "RGB", "CMYK", "", "", "multichannel", "duotone", "Lab"];
    if (doc.mode !== 3 && doc.mode !== 1) throw new Error("it is a " + (MODES[doc.mode] || "mode " + doc.mode) + " PSD — this reads RGB and greyscale; convert it in Photoshop first");
    if (doc.depth !== 8 && doc.depth !== 16) throw new Error("it is a " + doc.depth + "-bit PSD — save it at 8 or 16 bits per channel first");
    return { b, doc };
  },
  async adoptPsd(b, doc, slot, ch, name){
    const st = Interchange.inState(slot, ch, doc.w, doc.h, Math.max(1, doc.layers.filter(r => !r.section).length));
    Object.assign(st, { b, doc, pool: Interchange.pool() });
    // a file with no layers is its flattened picture, which becomes the one layer
    const kids = doc.layers.length ? await Interchange.psdNodes(Interchange.psdTree(doc.layers), st) : [await Interchange.psdFlat(st, name)];
    if (!kids.length) throw new Error("it holds no layer this app can read" + (st.notes.unread.length ? " — " + st.notes.unread.join("; ") : ""));
    return Object.assign(Interchange.one(kids, name), { notes: st.notes, from: [doc.w, doc.h], to: [st.SW, st.SH], skipped: [] });
  },
  // Photoshop's flat list, bottom first, as the tree it encodes: a divider (`lsct` 3) opens a group
  // below its children and the folder (1 open, 2 closed) closes it above them. A divider that is
  // never closed leaves its layers where they are, ungrouped.
  psdTree(recs){
    const root = [], open = [root];
    for (const r of recs) {
      if (r.section === 3) { open.push([]); continue; }
      if (r.section === 1 || r.section === 2) { const kids = open.length > 1 ? open.pop() : []; open[open.length - 1].push({ group: r, kids }); continue; }
      open[open.length - 1].push({ rec: r });
    }
    while (open.length > 1) { const k = open.pop(); open[open.length - 1].push(...k); }
    return root;
  },
  // One level of the tree as nodes, bottom first, with each node's record beside it for the clips. A
  // layer that is left out keeps its place as a null until the clips are resolved, so a layer clipped
  // to it is not clipped to the one below instead — and so does a group left with nothing in it (one
  // that held only adjustment layers, say), for the same reason.
  async psdNodes(list, st){
    const out = [], recs = [];
    for (const e of list) {
      if (e.rec) { out.push(await Interchange.psdLayer(e.rec, st)); recs.push(e.rec); continue; }
      const kids = await Interchange.psdNodes(e.kids, st), r = e.group;
      if (!kids.length) { out.push(null); recs.push(r); continue; }
      const m = Psd.blendOf(r.sectionKey || r.key), name = r.uname || r.name || "Group";
      Interchange.psdSaid(r, m, name, st);
      const G = Object.assign(newGroupNode(name), { children: kids, opacity: r.opacity / 255, visible: !r.hidden && !m.lost, blend: m.blend });
      // The folder record carries a group's layer mask exactly as a layer's record carries its own,
      // and it is the group's mask here (4.9): on a normal group's flattened children, handed to each
      // child of a pass-through one. Read as a layer's, or it was dropped without a word.
      if (Psd.userMask(r)) {
        try { G.mask = Interchange.psdMask(await Interchange.psdPixels(r, st), r, st); }
        catch (err) { st.notes.unread.push(name + "'s mask — " + err.message); }
      }
      out.push(G);
      recs.push(r);
    }
    return Interchange.psdClips(out, recs, st).filter(Boolean);
  },
  async psdLayer(r, st){
    const name = r.uname || r.name || "Layer";
    await Interchange.tick(st);
    if (r.adjust) { st.notes.adjust.push(name); return null; }    // an adjustment or a generated fill: no pixels
    let px;
    try { px = await Interchange.psdPixels(r, st); }
    catch (e) { st.notes.unread.push(name + " — " + e.message); return null; }
    const c = mkCanvas(st.W, st.H);
    if (px && px.w > 0 && px.h > 0) ctx2d(c).putImageData(new ImageData(px.rgba, px.w, px.h), r.left, r.top);
    const m = Psd.blendOf(r.key);
    Interchange.psdSaid(r, m, name, st);
    // Fill opacity is the pixels' own opacity apart from any layer style; with the styles gone, the
    // two multiply.
    const L = Interchange.paintLayer(st, name, c, !r.hidden && !m.lost, (r.opacity / 255) * (r.fill == null ? 1 : r.fill / 255),
                                     m.blend === "pass through" ? "normal" : m.blend);
    const mk = Interchange.psdMask(px, r, st);
    if (mk) L.mask = mk;
    return L;
  },
  // What a record carries that does not come across, said alike for a layer and a group: a blend
  // with no formula here, a layer style (Photoshop styles groups too — the first version named a
  // layer's and dropped a group's without a word), a Blend If, and a Linear Dodge faded below full
  // opacity, which Photoshop fades after the add and the app within it (`Psd.BLEND`). Fill is not
  // counted there: Photoshop applies it inside the add for that mode, as the canvas applies alpha.
  psdSaid(r, m, name, st){
    if (m.lost) st.notes.lost.push({ name, op: m.lost });
    if (r.fx) st.notes.fx.push(name);
    if (r.blendIf) st.notes.blendIf.push(name);
    if ((r.sectionKey || r.key) === "lddg" && r.opacity < 255) st.notes.dodge.push(name);
  },
  // A record's channels, decoded in the pool: RGBA over its bounds, and the mask's own plane over the
  // mask's (`Psd.pixels`); null for a record with no channels. Throws what the decoder refuses.
  async psdPixels(r, st){
    if (!r.chans.length) return null;
    const lo = Math.min(...r.chans.map(c => c.off)), hi = Math.max(...r.chans.map(c => c.off + c.len));
    const rec = Object.assign({}, r, { chans: r.chans.map(c => ({ id: c.id, len: c.len, off: c.off - lo })) });
    const buf = st.b.slice(lo, hi).buffer;
    return st.pool.call("pixels", { buf, rec, depth: st.doc.depth, psb: st.doc.psb, grey: st.doc.mode === 1 }, [buf]);
  },
  // A layer mask is the app's mask: white, its value in the ALPHA (`maskFill` clears to hide), and
  // the mask's own default outside its bounds — and everywhere, when the bounds are EMPTY: Photoshop
  // crops a mask to where it differs from its default, so one left all at it has no area. Hide All
  // (default 0) hides the whole layer or group, and a mask all white is no mask. The first version
  // dropped any mask without area, so a layer or group hidden by one came in shown and nothing said
  // it (the review of 4.50 (16), 2026-09-27). The record decides (`Psd.userMask`), not whether the
  // pool found a plane: an empty mask has none. A mask switched off in Photoshop is not applied
  // there, and is null here; so is one whose rectangle has area but whose plane is missing.
  psdMask(px, r, st){
    const m = Psd.userMask(r), mk = px && px.mask;
    if (!m || m.off) return null;
    const empty = !(m.right > m.left && m.bottom > m.top);
    if (!mk && !(empty && m.def < 128)) return null;
    const k = mkCanvas(st.W, st.H), g = ctx2d(k);
    if (m.def >= 128) { g.fillStyle = "#fff"; g.fillRect(0, 0, st.W, st.H); }
    if (mk) g.putImageData(new ImageData(mk.rgba, mk.w, mk.h), mk.left, mk.top);
    return Interchange.fit(k, st);
  },
  // Clipping: a clipped layer shows only where the nearest unclipped layer below it — its base —
  // has pixels, which is a mask by that layer here (4.36): the base's raw pixels, read live. A base
  // that is a group cannot lend a shape here, and what is clipped to it stays unclipped, said.
  //
  // Photoshop blends a clipping stack AS ONE by default ("Blend Clipped Layers as Group"): the
  // clipped layers land on the base, and that result takes the base's blend and opacity — a hidden
  // base hides them all, and the base's own mask masks them all. Where the base is Normal, opaque AT
  // FULL FILL, shown and unmasked, the mask alone is that picture wherever the base is opaque;
  // otherwise the stack becomes a group carrying the base's blend, opacity, visibility and mask, the
  // base inside it plain at its fill. Fill counts because a clipped layer blends with the base AT ITS
  // FILL: a base at Fill 0 — the usual way to keep a layer as a shape only — gives a Multiply clipped
  // to it nothing to multiply, where left flat it multiplied with the layers under the base, and one
  // level of the base's opacity moved the picture ~150 levels (the review of 4.50 (16), 2026-09-27).
  // Returns the list with those groups in it.
  psdClips(nodes, recs, st){
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const base = nodes[i], r = recs[i];
      if (r.clipping === 1) { if (base) st.notes.clip.push(base.name); out.push(base); continue; }   // nothing below it to clip to
      let j = i + 1;
      while (j < nodes.length && recs[j].clipping === 1) j++;
      const clipped = nodes.slice(i + 1, j).filter(Boolean);
      i = j - 1;
      out.push(base);
      if (!clipped.length) continue;
      // a group lends no shape here, and a layer that was left out has none to lend
      if (!base || isGroup(base)) { for (const L of clipped) { st.notes.clip.push(L.name); out.push(L); } continue; }
      const kept = clipped.map(L => Interchange.clipTo(L, base));
      if (base.visible && base.blend === "normal" && r.opacity === 255 && (r.fill == null || r.fill === 255) && !base.mask) { out.push(...kept); continue; }
      const G = Object.assign(newGroupNode(base.name), { children: [base, ...kept], opacity: r.opacity / 255, visible: base.visible, blend: base.blend });
      if (base.mask) { G.mask = base.mask; base.mask = null; }
      out[out.length - 1] = G;
      Object.assign(base, { visible: true, blend: "normal", opacity: r.fill == null ? 1 : r.fill / 255 });
    }
    return out;
  },
  // `L` clipped to `base`, as the node that takes its place. A node holds one mask and the clip is
  // it, so a clipped LAYER's own mask goes into its pixels first; a clipped GROUP keeps its own, and
  // the clip goes on a pass-through group around it — which hands its mask to the group's flattened
  // result exactly where the group's own lands (`Composite.groupStencil`), or to each child of a
  // pass-through one, and changes nothing else.
  clipTo(L, base){
    if (isGroup(L)) {
      if (!L.mask) { L.maskRef = base.uid; return L; }
      return Object.assign(newGroupNode(L.name), { blend: "pass through", children: [L], maskRef: base.uid });
    }
    if (L.mask) {
      const g = ctx2d(L.canvas);
      g.globalCompositeOperation = "destination-in"; g.drawImage(L.mask, 0, 0, L.canvas.width, L.canvas.height);
      g.globalCompositeOperation = "source-over";
      L.mask = null;
    }
    L.maskRef = base.uid;
    return L;
  },
  async psdFlat(st, name){
    const buf = st.b.slice(st.doc.merged).buffer;
    const doc = Object.assign({}, st.doc, { merged: 0, layers: [] });
    const rgba = await st.pool.call("flat", { buf, doc }, [buf]);
    await Interchange.tick(st);
    const c = mkCanvas(st.W, st.H);
    ctx2d(c).putImageData(new ImageData(rgba, st.W, st.H), 0, 0);
    return Interchange.paintLayer(st, name || "Layer", c, true, 1, "normal");
  },

  // ---- in, either format ----
  inState(slot, ch, W, H, total){
    const base = chanBase(slot, ch) || slot.composite;
    return { ch, W, H, SW: base.width, SH: base.height, done: 0, total,
             notes: { lost: [], missing: [], unread: [], adjust: [], fx: [], blendIf: [], clip: [], dodge: [] } };
  },
  // A sheet of the FILE's size at the size a new layer on this channel gets.
  fit(c, st){ return c.width === st.SW && c.height === st.SH ? c : resizeCanvasTo(c, st.SW, st.SH); },
  paintLayer(st, name, c, visible, opacity, blend){
    return LayerNode.of({ type: "paint", chan: st.ch === "color" ? undefined : st.ch, name, canvas: Interchange.fit(c, st),
                          visible, opacity, blend });
  },
  // One node lands, the way a saved stack does: the file's only layer, or its layers as a group
  // named after the file. A lone pass-through group is wrapped all the same — landed bare, it would
  // blend with the texture where the file's own root never did.
  one(kids, name){
    const bare = kids.length === 1 && !(isGroup(kids[0]) && kids[0].blend === "pass through");
    return { node: bare ? kids[0] : Object.assign(newGroupNode(name || "Layers"), { children: kids }), count: Interchange.count(kids) };
  },

  // ---- the two verbs ----
  async exportFile(slot){
    slot = slot || App.activeSlot;
    if (!slot || !slot.composite) { setStatus("Select a texture first — its layers are what gets written", "err"); return null; }
    const fmt = await choiceDialog("Write every layer of " + slot.id + " as a file another editor opens — which kind?", [
      { list: true, label: "OpenRaster (.ora)", sub: "Krita, GIMP and MyPaint — every blend mode exactly as it is here", go: "Choose", value: "ora" },
      { list: true, label: "Photoshop (.psd)", sub: "Photoshop, Paint.NET, GIMP, Krita, Photopea — soft light is Photoshop's own, slightly different curve", go: "Choose", value: "psd" },
      { label: "Cancel", value: null }]);
    if (!fmt) return null;
    const ch = await Interchange.pickChan(slot);
    if (!ch) return null;
    const skin = $("skinName").value.trim();
    const name = ((skin ? skin + "_" : "") + slot.id + (ch === "color" ? "" : "_" + ch)).replace(/[^a-z0-9_\-]/gi, "_") + "." + fmt;
    progBegin("Writing " + name + "…", true);
    try {
      const R = fmt === "psd" ? await Interchange.packPsd(slot, ch) : await Interchange.packOra(slot, ch);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(R.blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus(Interchange.saidOut(name, ch, R, fmt), "ok");
      return name;
    } catch (e) {
      if (e instanceof Cancelled) { setStatus("Stopped — " + name + " was not written"); return null; }
      reportFailure("writing the layers of " + slot.id + " as " + (fmt === "psd" ? "a PSD" : "OpenRaster"), e, "layers-out");
      return null;
    } finally { progEnd(); }
  },
  // One file holds one channel — the image another editor opens is one picture.
  async pickChan(slot){
    const chs = Interchange.chans(slot);
    if (chs.length === 1) return chs[0];
    return choiceDialog("Write which channel's layers of " + slot.id + "?\n\nThe file is one picture, so it holds one channel; write another the same way.",
      chs.map(c => ({ list: true, label: CHAN_LABEL[c], sub: Interchange.leafCount(slot, c) + " layer(s), over the " + CHAN_LABEL[c].toLowerCase() + " sheet", go: "Write", value: c }))
        .concat([{ label: "Cancel", value: null }]));
  },
  async importFile(file, slot){
    slot = slot || App.activeSlot;
    if (!slot || !slot.composite) throw new Error("select a texture to put the layers on first");
    const want = newLayerChan(), ch = chanBase(slot, want) ? want : "color";    // the brush's channel, if this texture has that sheet
    const name = String(file.name || "").replace(/\.[^.]*$/, ""), psd = /\.ps[db]$/i.test(file.name || "");
    progBegin("Reading " + file.name + "…", true);
    try {
      let R;
      if (psd) { const { b, doc } = await Interchange.readPsd(file); R = await Interchange.adoptPsd(b, doc, slot, ch, name); }
      else { const { zip, doc } = await Interchange.readOra(file); R = await Interchange.adoptOra(zip, doc, slot, ch, name); }
      addLayerTo(slot, R.node);
      setStatus(Interchange.saidIn(R, slot, ch), "ok");
      return R.node;
    } catch (e) {
      if (e instanceof Cancelled) { setStatus("Stopped — nothing from " + file.name + " was added"); return null; }
      throw e;                                                   // addFiles reports it with the file's name
    } finally { progEnd(); }
  },
  // ---- what the status line says ----
  saidOut(name, ch, R, fmt){
    const n = R.count, N = R.notes, s = k => k === 1 ? "" : "s", psd = fmt === "psd";
    const out = ["Wrote " + name + " — " + n.layers + " layer" + s(n.layers) + (n.groups ? " in " + n.groups + " group" + s(n.groups) : "") +
      ", " + R.w + " × " + R.h + " " + CHAN_LABEL[ch].toLowerCase() + ", the base sheet at the bottom; it opens in " +
      (psd ? "Photoshop, Paint.NET, GIMP, Krita and Photopea" : "Krita, GIMP and MyPaint")];
    if (N.baked.length) out.push(N.baked.length + " layer" + s(N.baked.length) + " carry their mask, part limit or blend-if in their pixels (the file has no masks of this app's kind)");
    if (N.flat.length) out.push("group" + s(N.flat.length) + " " + N.flat.map(x => "“" + x + "”").join(", ") + " written as one layer, for the same reason");
    if (N.flatFx.length) out.push("group" + s(N.flatFx.length) + " " + N.flatFx.map(x => "“" + x + "”").join(", ") + " written as one layer, because an effect inside changes only what the group has painted, which a layer in the file cannot");
    if (N.effects.length) out.push(N.effects.length + " effect" + s(N.effects.length) + " written as what " + (N.effects.length === 1 ? "it does" : "they do") + " to the layers below, which will not follow edits made under " + (N.effects.length === 1 ? "it" : "them"));
    if (N.ops.length) out.push("no " + (psd ? "Photoshop" : "OpenRaster") + " name for the blend of " + N.ops.join(", ") + " — written as Normal");
    if (psd && N.soft) out.push(N.soft + " soft-light layer" + s(N.soft) + " will look a little different: Photoshop's soft light is its own curve");
    if (psd && N.dodge.length) out.push(N.dodge.length + " in Linear Dodge below full opacity will look darker in Photoshop wherever the sum passes white — Photoshop fades after the add, this app within it: " +
      N.dodge.map(x => "“" + x + "”").join(", "));
    return out.join("; ");
  },
  saidIn(R, slot, ch){
    const n = R.count, N = R.notes, s = k => k === 1 ? "" : "s", q = l => l.map(x => "“" + x + "”").join(", ");
    const out = ["Loaded “" + R.node.name + "” onto " + slot.id + " (" + CHAN_LABEL[ch] + ") — " + n.layers + " layer" + s(n.layers) +
      (n.groups ? " in " + n.groups + " group" + s(n.groups) : "")];
    if (R.from[0] !== R.to[0] || R.from[1] !== R.to[1]) out.push("resampled from " + R.from.join(" × ") + " to " + R.to.join(" × "));
    if (N.lost.length) out.push(N.lost.length + " hidden, because this app has no blend that does what theirs does: " +
      N.lost.map(x => "“" + x.name + "” (" + x.op + ")").join(", "));
    if (N.missing.length) out.push(N.missing.length + " left out, their image missing from the file: " + q(N.missing));
    if (N.unread.length) out.push(N.unread.length + " left out as unreadable: " + q(N.unread));
    if (N.adjust.length) out.push(N.adjust.length + " adjustment or fill layer" + s(N.adjust.length) + " left out — no pixels of " + (N.adjust.length === 1 ? "its" : "their") + " own: " + q(N.adjust));
    if (N.fx.length) out.push(N.fx.length + " without " + (N.fx.length === 1 ? "its" : "their") + " Photoshop layer style (shadow, stroke, glow…), which is not in the pixels: " + q(N.fx));
    if (N.blendIf.length) out.push(N.blendIf.length + " without " + (N.blendIf.length === 1 ? "its" : "their") + " Photoshop Blend If, which does not come across — the layer's own Blend if here can be set to match: " + q(N.blendIf));
    if (N.clip.length) out.push(N.clip.length + " left unclipped — what " + (N.clip.length === 1 ? "it clips" : "they clip") + " to is a group or a layer left out, which lends no shape here: " + q(N.clip));
    if (N.dodge.length) out.push(N.dodge.length + " in Linear Dodge below full opacity, which looks brighter here than in Photoshop wherever the sum passes white — Photoshop fades after the add, this app within it: " + q(N.dodge));
    if (R.skipped.length) out.push(R.skipped.length + " element" + s(R.skipped.length) + " this reader does not know skipped (" + [...new Set(R.skipped)].join(", ") + ")");
    return out.join("; ");
  },
};
