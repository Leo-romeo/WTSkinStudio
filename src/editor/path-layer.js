"use strict";
// ---------- A path is a layer (ROADMAP 4.52 (3)–(5)) ----------
// Decided by the owner 2026-10-21: "paths become layers". Fill and Stamp along used to bake the path
// into whatever layer was selected, once — move a node afterwards and the paint stayed where it was,
// so a camouflage blotch could not be reshaped and a row of rivets could not be re-spaced. A path
// layer keeps the RECIPE as well as the pixels: the path, the verb (fill or stamp), the brush it was
// laid with and the seed of that brush's random dynamics. Its pixels are redrawn from the recipe
// whenever the path or the brush changes, the way a projected decal is re-projected when it moves.
//
// The recipe is the layer content's `shape`: `{ path, verb, brush, seed }`. The pixels stay an
// ordinary paint content's canvas, so everything that reads a layer — the compositor, export, the
// thumbnail, a project reader from before path layers — reads them as it always did.
//
// **What a redraw is.** The one-shot verbs run through the stroke machinery into the selected
// layer, and that machinery is aimed by the active slot, the active layer and the live brush. A
// redraw must not depend on any of them — it happens when a node moves, an undo runs or a preset
// lands, with whatever is selected at the time — so it lays the same dabs itself: `Pen.dab` for size,
// flow, angle and scatter, `Tips.lay` for the tip, `Pen.deposit` for Flow and Opacity, into a buffer
// that goes onto the cleared canvas once — the same two steps a stroke takes on an empty layer. Its
// random stream is `Pen.rng(seed)`, so a scattered stamp comes back the same every time.
//
// **What it deliberately leaves out**, each said in the item's record: the brush's Symmetry and
// radial copies (they are mirrored on the MODEL; a path layer is a sheet object), the live marquee
// and the live part selection (the layer's own scope, taken from the part selection when it is made,
// is what confines it, through the compositor like any layer's), and protected parts (cut at every
// redraw, because a protected part is never painted). Only the Brush on a layer's content makes
// one: the Eraser has nothing of its own to draw, the Clone's pixels come from elsewhere, Panel line
// writes a height field, and a mask is the layer's, not a layer — those stay one-shot.
const PathLayer = {
  // The brush fields a stamp or a fill reads (`brushStamp`'s key, `Pen.deposit`, `Pen.dab`, the
  // walk's spacing), stored with the layer so a redraw does not depend on the brush in hand.
  BRUSH: ["tool", "chan", "target", "color", "value", "size", "opacity", "hardness", "flow", "build",
          "spacing", "tip", "sizeJit", "flowJit", "scatter", "angle", "angleJit", "follow", "cycle", "cycleLen"],
  // `cycle` and `cycleLen` are Colour along (4.56), added after format 6 shipped: a recipe without
  // them reads as Off (`paint`), so the format stays 6 (fix plan 2026-10-23, step 2).
  WORDS: ["tool", "chan", "target", "color", "tip", "cycle"], FLAGS: ["build", "follow"],
  VERBS: ["fill", "stamp"],
  // The content holding a recipe on this node, and its channel; null when the node has none.
  of(L){
    if (!LayerNode.isLayer(L)) return null;
    for (const ch of LayerNode.channelsOf(L)) { const c = L.chans[ch]; if (c && c.kind === "paint" && c.shape) return { c, ch }; }
    return null;
  },
  // Whether the brush in hand lays a path layer, or the verb stays one-shot (see above).
  takes(b){ return b.tool === "brush" && b.target === "content"; },
  snap(b){ const o = {}; for (const k of PathLayer.BRUSH) o[k] = b[k]; return o; },

  // ---- making one ----
  // A new layer at the top of the active slot's stack, the path and the brush copied into it, and
  // drawn once. One undo step: `addLayerTo`'s. `from` is a preset's recipe (4.52 (4)): its brush and
  // its seed rather than the ones in hand, so the preset comes back as it was saved.
  make(s, path, verb, from){
    const brush = from ? Object.assign(PathLayer.snap(App.brush), from.brush) : PathLayer.snap(App.brush);
    const ch = brush.chan, base = chanBase(s, ch) || s.composite;
    const shape = { path: Path.clone(path), verb, brush, seed: from ? from.seed >>> 0 : Pen.seed() };
    const n = layerLeaves(s.layers).filter(l => PathLayer.of(l)).length + 1;
    const L = LayerNode.of({ type: "paint", chan: ch === "color" ? undefined : ch, name: "Path " + n,
      canvas: mkCanvas(base.width, base.height), visible: true, opacity: 1, blend: "normal",
      scope: Scope.ofSelection(), shape });
    PathLayer.draw(s, L);
    addLayerTo(s, L);
    return L;
  },

  // ---- drawing ----
  // Redraw the node's pixels from its recipe, then the composite it is part of.
  draw(s, L){
    const r = PathLayer.of(L);
    if (!r || !s) return;
    PathLayer.paint(s, r.c);
    L._thumb = null;
    if (r.ch === "color") scheduleComposite(s); else scheduleChannels(s);
  },
  paint(s, c){
    const R = c.shape, W = c.canvas.width, H = c.canvas.height, g = ctx2d(c.canvas);
    g.clearRect(0, 0, W, H);
    const p = R.path;
    if (!p || p.pts.length < 2 || (R.verb === "fill" && (p.pts.length < 3 || !p.closed))) return;
    const SW = s.composite ? s.composite.width : W, SH = s.composite ? s.composite.height : H;
    const kx = W / SW, ky = H / SH, tile = CamoTile.is(s);
    const buf = PathLayer.scratch(W, H), bg = ctx2d(buf);
    bg.globalAlpha = 1; bg.globalCompositeOperation = "source-over";
    bg.clearRect(0, 0, W, H);
    // The recipe's brush, put in App.brush for the length of the draw and nothing longer: the stamp
    // cache, the tip and Pen all read it from there. Field by field, because App.brush carries
    // accessors (`mode`) that a copy would freeze.
    const b = App.brush, keep = {};
    for (const k of PathLayer.BRUSH) keep[k] = b[k];
    Object.assign(b, { cycle: "off" }, R.brush);
    try {
      const dep = Pen.deposit(b), poly = Path.flatten(p, Path.TOL);
      if (R.verb === "fill") {
        // One fill of the whole path, once per copy of a camouflage tile it overlaps — the one-shot
        // Fill's rule, for the same pale-seam reason (`PathUI.fillAt`).
        const bb = Path.bounds(poly);
        bg.globalAlpha = dep.fill;
        bg.fillStyle = b.chan === "color" ? b.color : hexOfGrey(b.value);
        for (const dy of CamoTile.span(bb.y0, bb.y1, SH, tile))
          for (const dx of CamoTile.span(bb.x0, bb.x1, SW, tile)) {
            bg.beginPath();
            poly.forEach((q, i) => { const x = (q[0] + dx * SW) * kx, y = (q[1] + dy * SH) * ky; if (i) bg.lineTo(x, y); else bg.moveTo(x, y); });
            bg.closePath();
            bg.fill();
          }
      } else {
        const step = Math.max(1, b.size * (b.spacing || Pen.SPACING));
        const stamp = brushStamp(), spins = Tips.get(b.tip).turns, rnd = Pen.dynamic(b) ? Pen.rng(R.seed >>> 0) : null;
        // Colour along: each stamp's colour from how far along the path it is, a step a point — the
        // one-shot Stamp along's rule (`PathUI.stamp`, `stampAt`'s opt.run).
        const lut = Pen.cycles(b) && b.cycle !== "hue" ? Gradient.holoLut(b.cycle) : null;
        for (const [i, q] of Path.walk(poly, step, p.closed).entries()) {
          const tint = Pen.ink(b, i * step, lut);
          const d = Pen.dab(b, { x: q.x, y: q.y, p: 1 }, q.a, rnd), turn = spins ? d.angle : 0;
          const D = 2 * Tips.reach(stamp, d.size, turn);
          bg.globalAlpha = dep.dab * d.flow;
          for (const [x, y] of (tile ? CamoTile.copies(d.x, d.y, D / 2 + 2, SW, SH) : [[d.x, d.y]]))
            if (tint) Tips.layIn(bg, stamp, x * kx, y * ky, d.size * kx, turn, D * kx, null, null, tint);
            else Tips.lay(bg, stamp, x * kx, y * ky, d.size * kx, turn);
        }
      }
      // Protected parts are never painted, so they are cut at every redraw, not only at the first.
      const prot = App.geomData ? [...App.protectedParts].filter(n => App.matSlot.get((App.meshes.get(n) || { userData: {} }).userData.mat) === s.id) : [];
      const pm = prot.length ? partSetMaskCanvas(s, W, H, prot, 0) : null;
      if (pm) { bg.globalAlpha = 1; bg.globalCompositeOperation = "destination-out"; bg.drawImage(pm, 0, 0, W, H); bg.globalCompositeOperation = "source-over"; }
      g.globalAlpha = dep.apply;
      g.drawImage(buf, 0, 0);
      g.globalAlpha = 1;
    } finally {
      Object.assign(b, keep);
    }
  },
  // The recipe moved to a sheet of w × h, from the size its canvas is now (the sheet it was drawn on):
  // the path scaled with it, and the brush, so a resized sheet's next redraw is the same layer at the
  // new size and not the old one in a corner. Found in review (2026-10-23): a resize resampled the
  // pixels and left the path in the old texels, so the first node moved after a 2048 → 4096 resize
  // redrew the whole layer at half scale in the top-left quarter. The caller resamples the canvas.
  fit(c, w, h){
    if (!c || !c.shape || !c.canvas || (c.canvas.width === w && c.canvas.height === h)) return;
    const kx = w / c.canvas.width, ky = h / c.canvas.height;
    Path.scale(c.shape.path, kx, ky);
    if (typeof c.shape.brush.size === "number") c.shape.brush.size *= (kx + ky) / 2;
  },
  // One scratch canvas for every redraw, grown to the largest asked for (§3.6).
  scratch(W, H){
    let c = PathLayer._buf;
    if (!c || c.width !== W || c.height !== H) c = PathLayer._buf = mkCanvas(W, H);
    return c;
  },

  // ---- an edit, as one undo step ----
  // `begin` keeps the recipe as it was before the first change of a gesture; `live` redraws once a
  // frame while it goes on; `commit` redraws for good and makes the step — a recipe before and after,
  // no pixels, because a redraw is what puts the pixels back (the projected decal's pattern).
  // `after` is the caller's own refresh, run when an undo or redo puts a recipe back: this layer
  // does not know which panel shows the path.
  pending: null,
  begin(s, L, after){
    if (PathLayer.pending && PathLayer.pending.L === L) return;
    const r = PathLayer.of(L);
    if (r) PathLayer.pending = { s, L, after, before: PathLayer.clone(r.c.shape) };
  },
  live(s, L){
    if (PathLayer._raf) return;
    PathLayer._raf = requestAnimationFrame(() => { PathLayer._raf = 0; PathLayer.draw(s, L); });
  },
  commit(desc){
    const P = PathLayer.pending;
    PathLayer.pending = null;
    if (!P) return false;
    const r = PathLayer.of(P.L);
    if (!r) return false;
    if (PathLayer._raf) { cancelAnimationFrame(PathLayer._raf); PathLayer._raf = 0; }
    const after = PathLayer.clone(r.c.shape);
    PathLayer.draw(P.s, P.L);
    if (JSON.stringify(after) === JSON.stringify(P.before)) return false;
    const put = rec => () => { const q = PathLayer.of(P.L); if (!q) return; PathLayer.assign(q.c.shape, rec); PathLayer.draw(P.s, P.L); if (P.after) P.after(); };
    pushAction(desc || "edit path", put(P.before), put(after), 0);
    return true;
  },
  // The recipe is mutated IN PLACE by the shape tool — it edits `shape.path` directly — so undo puts
  // the old numbers back into the same objects rather than swapping the record under it.
  assign(shape, rec){
    const src = PathLayer.clone(rec);
    shape.path.pts.length = 0;
    for (const n of src.path.pts) shape.path.pts.push(n);
    shape.path.closed = src.path.closed;
    delete shape.path.angle; delete shape.path.bias;
    if (src.path.angle) shape.path.angle = src.path.angle;
    if (src.path.bias) shape.path.bias = src.path.bias;
    shape.verb = src.verb; shape.brush = src.brush; shape.seed = src.seed;
  },
  clone(shape){
    return { path: Path.clone(shape.path), verb: shape.verb, brush: Object.assign({}, shape.brush), seed: shape.seed >>> 0 };
  },

  // ---- the project file ----
  // Numbers and words only; the pixels are the content's canvas, stored as every paint layer's is.
  // Read back defensively — a crafted file is data, not code (ROADMAP 1.21): a node list capped, every
  // number finite, the verb one of two, the brush only the fields above and of the types they have.
  save(shape){ return PathLayer.clone(shape); },
  load(m){
    if (!m || typeof m !== "object" || !m.path || !Array.isArray(m.path.pts)) return null;
    const num = v => typeof v === "number" && isFinite(v) ? v : 0;
    const p = { pts: [], closed: !!m.path.closed };
    for (const n of m.path.pts.slice(0, 4096)) {
      if (!n || typeof n !== "object") continue;
      const q = { x: num(n.x), y: num(n.y), hx: num(n.hx), hy: num(n.hy) };
      if (typeof n.ix === "number" && typeof n.iy === "number" && isFinite(n.ix) && isFinite(n.iy)) { q.ix = n.ix; q.iy = n.iy; }
      p.pts.push(q);
    }
    const a = num(m.path.angle), bi = num(m.path.bias);
    if (a) p.angle = Math.max(0, Math.min(Path.ANGLE_MAX, a));
    if (bi) p.bias = Math.max(-1, Math.min(1, bi));
    const brush = {}, src = m.brush && typeof m.brush === "object" ? m.brush : {};
    for (const k of PathLayer.BRUSH) {
      const v = src[k], want = PathLayer.WORDS.includes(k) ? "string" : PathLayer.FLAGS.includes(k) ? "boolean" : "number";
      if (typeof v === want && (want !== "number" || isFinite(v)) && (want !== "string" || v.length < 200)) brush[k] = v;
    }
    // Only what a path layer can be made with: the Brush, on content, on a channel it writes.
    brush.tool = "brush"; brush.target = "content";
    if (!Tool.TOOLS.brush.chans.includes(brush.chan)) brush.chan = "color";
    if (!/^#[0-9a-f]{6}$/i.test(brush.color || "")) brush.color = "#808080";
    return { path: p, verb: PathLayer.VERBS.includes(m.verb) ? m.verb : "fill", brush, seed: num(m.seed) >>> 0 };
  },
};
