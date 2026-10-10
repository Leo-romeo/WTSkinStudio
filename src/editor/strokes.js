// ---- where a stroke's dirty rectangle is measured, and where it is spent ----
// It is measured in the LAYER's own pixels: `stroke.t.canvas` is `L.canvas` for a paint stroke and
// `L.mask` for a mask stroke, and neither has to be the size of the sheet it composites onto. The
// compositor's rectangles are all in the slot's composite space (see `rectToSlot`), so it crosses
// here — at the three places a stroke hands one over, which are the two view refreshes and the undo
// restore. It did not cross at all until ROADMAP 1.15, and the reported symptom was total: on the
// t55e1 project, whose masks are 4096 over a 2048 sheet, a stamp changed no pixel of the composite
// until the layer was hidden and shown again.
function strokeRect(R, slot, canvas){
  return canvas ? rectToSlot(slot, R, canvas.width, canvas.height) : R;
}
// Reusable scratch canvas for clipping a single brush stamp to the part mask.
function stampClipBuf(size){ let c = stampClipBuf._c; if (!c || c.width < size || c.height < size) c = stampClipBuf._c = mkCanvas(Math.max(size, 128), Math.max(size, 128)); return c; }
// Add a part's UV coverage to the current stroke's paint mask (no-op when a fixed
// selection mask is already in force, or masking is off).
// The stroke's stencil lives at mask resolution, which can be smaller than the sheet — every
// sampler scales through strokeMaskScale().
function strokeMaskCanvas(){
  if (!stroke.maskCanvas) {
    const D = maskDims(stroke.t.canvas.width, stroke.t.canvas.height);
    stroke.maskCanvas = mkCanvas(D.w, D.h);
  }
  return stroke.maskCanvas;
}
function strokeMaskScale(){
  return stroke && stroke.maskCanvas
    ? { x: stroke.maskCanvas.width / stroke.t.canvas.width, y: stroke.maskCanvas.height / stroke.t.canvas.height }
    : { x: 1, y: 1 };
}
function ensureStrokePart(name){
  if (!stroke || !stroke.masking || stroke.maskFixed || !name) return;
  if (stroke.maskParts.has(name)) return;
  stroke.maskParts.add(name);
  const w = stroke.t.canvas.width, h = stroke.t.canvas.height;
  const pm = partMaskCanvas(App.activeSlot, w, h, name);
  if (!pm) return;
  ctx2d(strokeMaskCanvas()).drawImage(pm, 0, 0);
  stroke.maskData = null;                                     // invalidate point-sample cache
}
function strokeMaskData(){
  if (!stroke || !stroke.maskCanvas) return null;
  if (!stroke.maskData) {
    const w = stroke.maskCanvas.width, h = stroke.maskCanvas.height;
    const k = strokeMaskScale();
    stroke.maskData = { w, h, kx: k.x, ky: k.y, a: ctx2d(stroke.maskCanvas).getImageData(0, 0, w, h).data };
  }
  return stroke.maskData;
}
// ---------- Starting a stroke, as three named steps ----------
// ROADMAP 2.4. `beginStroke` was 108 lines and reads as one thing, but it is three: find something
// to paint on (making it if the tool is allowed to), build the stroke object, and build the shield
// that decides where the stroke may land. The third is five independent rules stacked on one canvas
// and is where every "the brush stopped working" report has come from, so it is worth being able to
// read on its own.
//
// One object rather than three new globals (§4), and the module-level `stroke` stays exactly what it
// was: `make` assigns it, because everything downstream — `stampAt`, `refreshStrokeView`,
// `endStroke` — reads that binding and not a return value.
const StrokeSetup = {
  // What this stroke writes to, or null having already said why not. Two ways the tool can be
  // missing what it needs, and they differ by one level: `need` is "no layer at all" and makes one;
  // `needSlot` is 4.28(e)'s — a layer IS selected and simply carries nothing on the channel the
  // brush is in, so the channel slot is added to it rather than a second layer appearing beside the
  // one the user chose. Both push exactly one undo entry, which is popped here and re-pushed by
  // `endStroke` together with the stroke, so undoing the stroke also removes what it had to create.
  target(){
    let t = paintTarget();
    let made = null, madeAct = null;
    if (t && (t.need || t.needSlot)) {
      const madeSlot = !!t.needSlot;
      made = madeSlot ? (createPaintSlotIn(App.activeSlot, t.on, t.needSlot) && t.on)
                      : createPaintLayerFor(t.need);
      if (!made) { setStatus("Select a texture slot first", "err"); return null; }
      madeAct = App.undoStack.pop() || null;
      t = paintTarget();
      if (!t || t.err || t.need || t.needSlot) {
        // taken back before it was ever a step: the document is where it began (ROADMAP 4.50(2))
        if (madeAct) { madeAct.undo(); Autosave.moveTo(madeAct.revFrom); }
        setStatus((t && t.err) || "Could not create a layer for this tool", "err");
        return null;
      }
      setStatus(madeSlot
        ? "Added a " + Tool.chanWord(App.brush.chan) + " channel to “" + made.name + "” — one layer can carry every channel"
        : "Added “" + made.name + "” — this tool paints onto a layer, never onto the game's texture", "ok");
    }
    if (!t || t.err) { if (t) setStatus(t.err, "err"); return null; }
    return { t, made, madeAct };
  },
  make(r, alt, mask3d){
    const t = r.t, s = App.activeSlot;
    recStrokeBegin(mask3d ? "3d" : "2d");
    if (r.made) recStrokeFlag("madeLayer");
    if (App.brush.mode === "color") pushPalette(App.brush.color);
    stroke = { t, lasts: [null, null], alt: !!alt,
      buf: t.height ? null : strokeBuffer(t.canvas.width, t.canvas.height),
      // The height brush's equivalent, and the reason its line is continuous (ROADMAP 4.17).
      h: t.height ? heightBuffer(t.canvas.width, t.canvas.height) : null,
      // 3-D bookkeeping: the surface point and local texel density of the previous stamp per
      // channel (0 = the stroke, 1 = its mirror), the pointer position the last sub-step was taken
      // at, and a running estimate of screen pixels per texel. Together they tell a genuine UV-seam
      // crossing apart from ordinary movement — see stamp3d.
      hits: [null, null], line: false, screen: null, spt: 0, madeAct: r.madeAct,
      masking: false, maskCanvas: null, maskParts: new Set(), maskFixed: false, maskData: null,
      // What each dab lays down and how the buffer goes on — Flow and wash / build-up, taken once so
      // the stroke is one thing from first dab to last (6.4). `p` is the pressure of the sample being
      // stamped, which the pointer paths set per sample; everything else paints at full. `pen` and
      // `string` are the pointer's (`Pen.begin`). ROADMAP 4.50 (4).
      dep: Pen.deposit(App.brush), p: 1, pen: false, string: null,
      // Tip dynamics (ROADMAP 4.50 (10)): the seed of the stroke's random streams — one per stroke
      // channel, made on first use by `Pen.stream` — and the heading each channel last had, for a
      // tip that follows the stroke.
      seed: Pen.seed(), rng: null, dirs: [],
      // Both sides get the restored tiles' rectangle. The channel side dropped it, so undoing a
      // metalness stroke rebuilt every layered channel whole-sheet (ROADMAP 1.10).
      // The rectangle the tiles report is in `t.canvas`'s pixels — see strokeRect. Undoing had the
      // same bug the stroke did, and for the same one line (ROADMAP 1.15).
      undo: makeTileUndo(t.canvas, App.brush.mode + " stroke", R => {
        const SR = strokeRect(R, s, t.canvas);
        t.chan ? compositeChannels(s, SR) : compositeSlot(s, SR);
      }) };
    // The Clone's pre-stroke copy of the sheet, built now so that no frame of this stroke can have
    // composited before it (see editor/clone.js). `paintTarget` has already refused a stroke with
    // no source, so this is never null here.
    if (App.brush.tool === "clone") stroke.clone = Clone.begin(t, s, App.brush.chan);
  },
  // Where the stroke may land: five rules over one stencil, in this order. False means the stroke
  // is refused — the one case being a selection with nothing paintable on this sheet, where an
  // empty mask would mean "paint everywhere", the exact opposite of the shield that was asked for.
  shield(mask3d){
    const s = App.activeSlot, t = stroke.t;
    const w = t.canvas.width, h = t.canvas.height;
    // A part selection always confines painting to that selection (every edit mode), and protected
    // parts are cut back out of whatever the mask ends up being.
    const prot = App.geomData ? [...App.protectedParts].filter(n => App.matSlot.get((App.meshes.get(n) || { userData: {} }).userData.mat) === s.id) : [];
    if (App.selParts.size && App.geomData) {
      stroke.masking = true; stroke.maskFixed = true;
      const names = [...App.selParts].filter(n => !App.protectedParts.has(n));
      const pm = names.length ? partSetMaskCanvas(s, w, h, names) : null;   // one stencil, no inter-part seams
      if (pm) ctx2d(strokeMaskCanvas()).drawImage(pm, 0, 0);
      // Every selected part being protected too (or gone from the mesh) leaves no mask at all, and
      // an empty mask means "paint everywhere". Refuse instead. Slots with no geometry (tank
      // tracks) are exempt: nothing could ever build a mask for them.
      if (!stroke.maskCanvas && App.geomData.some(g => App.matSlot.get(g.mat) === s.id)) {
        // The layer the tool made for this stroke goes with it, as in `target`: left behind, it was
        // an edit with no history step, and undoing the step before it could land on the saved
        // revision with the layer still there (ROADMAP 4.50(2), found fixing its review, 2026-09-26).
        const made = stroke.madeAct;
        stroke = null;
        if (made) { made.undo(); Autosave.moveTo(made.revFrom); }
        setStatus("Your selection has nothing paintable on “" + s.id + "” — every selected part is protected, " +
          "or none of them use this texture", "err");
        return false;
      }
    } else if (prot.length) {
      // no selection, but something is shielded — start from "everything" and punch holes
      stroke.masking = true; stroke.maskFixed = true;
      const mc = strokeMaskCanvas(), g = ctx2d(mc);
      g.fillStyle = "#fff"; g.fillRect(0, 0, mc.width, mc.height);
    } else if (mask3d && App.geomData) {
      stroke.masking = true;                                    // parts accumulate via ensureStrokePart
    }
    if (stroke.maskCanvas && prot.length) {
      const g = ctx2d(stroke.maskCanvas);
      g.globalCompositeOperation = "destination-out";
      const pm = partSetMaskCanvas(s, w, h, prot, 0);            // same mask resolution, never grown
      if (pm) g.drawImage(pm, 0, 0);
      g.globalCompositeOperation = "source-over";
      stroke.maskData = null;
    }
    // A layer's LIMIT confines the brush too. Without this the stamp would land on the layer, be
    // clipped away by the compositor, and look like the brush had stopped working. Since 4.28(g)
    // that limit is a recipe — parts, a rectangle, or both — so the model is no longer a
    // precondition: `Scope.stencil` needs one for the part half and nothing for the rectangle.
    const AL = activeLayerObj();
    const sc = AL && !Scope.empty(Scope.of(AL)) ? Scope.stencil(s, AL) : null;
    if (sc) {
      const fresh = !stroke.maskCanvas;
      const mc = strokeMaskCanvas(), g = ctx2d(mc);
      if (fresh) { g.fillStyle = "#fff"; g.fillRect(0, 0, mc.width, mc.height); }
      stroke.masking = true; stroke.maskFixed = true;
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sc, 0, 0, mc.width, mc.height);
      g.globalCompositeOperation = "source-over";
      stroke.maskData = null;
    }
    // A marquee confines the brush, in both views — that is what makes it a SELECTION rather than a
    // rectangle somebody drew (ROADMAP 4.10). The rule lives with the marquee, not here.
    Marquee.clipStroke(stroke, s);
    return true;
  },
};
// mask3d = the stroke originates in the 3-D view, so it should stay on the part(s) actually
// painted (prevents bleed onto other parts that happen to share the same UV region).
function beginStroke(alt, mask3d){
  // A History walk that has yielded takes no further step under a stroke: the pre-stroke copies of
  // its tiles are taken from the sheet as it is NOW (UndoHistory.interrupt, core/undo.js). A press
  // says so already; this is for the strokes code begins.
  UndoHistory.interrupt();
  const r = StrokeSetup.target();
  if (!r) return false;                          // it has already said why
  StrokeSetup.make(r, alt, mask3d);
  return StrokeSetup.shield(mask3d);
}
// The whole stroke accumulates in a buffer, then gets applied to the target ONCE per frame
// (restore pre-stroke tiles → draw buffer at stroke opacity). This kills the classic soft-brush
// artifact where overlapping stamps progressively darken edges via premultiplied-alpha rounding.
let strokeViewPending = false;
function scheduleStrokeView(){
  if (strokeViewPending) return;
  strokeViewPending = true;
  requestAnimationFrame(() => { strokeViewPending = false; refreshStrokeView(); });
}
// Only the tiles the brush touched SINCE THE LAST FRAME are redone. Replaying every tile of the
// stroke each frame made a long stroke cost O(length²) — the reason a 4096² sheet ground to a
// halt halfway through a drag.
// The height half of the same idea, and the whole of why the line is continuous now. The stroke's
// stamps go into a Float32 height FIELD; the layer is derived from that field's gradient — restore
// a tile's pre-stroke pixels, then add the gradient over them. Two things follow that no amount of
// fixing the per-stamp rasteriser could have given (ROADMAP 4.17):
//
//  * a texel between two stamps is not a gap. The bumps overlap and add in the field, so nothing is
//    left sitting at the base surface for the eye to read as a break in the line.
//  * a straight stroke's field is constant ALONG the stroke, so its gradient is perpendicular to
//    it. That is the direction-aware groove the item wondered whether to build a kernel for, and it
//    falls out of differentiating a field instead of summing radial gradients.
//
// Only texels the stroke actually reached are written. Walking the whole tile and writing the base
// everywhere would set alpha on texels no stamp came near, and this layer composites OVER the ones
// below it — an opaque texel holding the base normal erases whatever they had put there.
function refreshHeightView(){
  const t = stroke.t, s = App.activeSlot;
  const keys = [...stroke.undo.dirty];
  if (!keys.length) return;
  stroke.undo.dirty.clear();
  const W = t.canvas.width, Hh = t.canvas.height, H = stroke.h;
  const g = ctx2d(t.canvas);
  const bc = chanBase(s, "normal");
  const base = bc && bc !== t.canvas && bc.width === W && bc.height === Hh ? bc : null;
  let R = null;
  for (const k of keys) {
    const r = stroke.undo.restoreTile(k);
    if (!r) continue;
    const img = g.getImageData(r.x, r.y, r.w, r.h), d = img.data;
    const b = base ? ctx2d(base).getImageData(r.x, r.y, r.w, r.h).data : null;
    for (let y = 0; y < r.h; y++) {
      const py = r.y + y, up = py > 0 ? -W : 0, dn = py < Hh - 1 ? W : 0;
      const sy = (dn - up) / W || 1;
      for (let x = 0; x < r.w; x++) {
        const px = r.x + x, p = py * W + px;
        const lf = px > 0 ? -1 : 0, rt = px < W - 1 ? 1 : 0;
        const gx = (H[p + rt] - H[p + lf]) / ((rt - lf) || 1);
        const gy = (H[p + dn] - H[p + up]) / sy;
        if (!gx && !gy && !H[p]) continue;                   // outside the stroke: leave it alone
        const i = (y * r.w + x) * 4;
        // An untouched texel of the layer starts from the surface it is carving INTO — the map
        // unpacked from the slot's _n — and one this stroke's earlier frame already wrote starts
        // from its pre-stroke value, because restoreTile put that back a moment ago. That is what
        // makes a second pass over the same line deepen it instead of restarting from flat.
        let nx = d[i], ny = d[i+1];
        if (d[i+3] < 8) { nx = b ? b[i] : 128; ny = b ? b[i+1] : 128; }
        d[i]   = Math.max(0, Math.min(255, nx + gx));
        d[i+1] = Math.max(0, Math.min(255, ny + gy));
        d[i+2] = b ? b[i+2] : 128;
        d[i+3] = 255;
      }
    }
    g.putImageData(img, r.x, r.y);
    R = rectUnion(R, r);
  }
  scheduleChannels(s, strokeRect(R, s, t.canvas));
  draw2D();
}
function refreshStrokeView(){
  if (!stroke) return;
  if (stroke.t.height) return refreshHeightView();
  const t = stroke.t, b = App.brush;
  const keys = [...stroke.undo.dirty];
  if (!keys.length) return;
  stroke.undo.dirty.clear();
  const g = ctx2d(t.canvas);
  const hide = t.mask && !(stroke.alt || b.value >= 128);
  const tiles = [];
  let R = null;
  for (const k of keys) {
    const t2 = stroke.undo.restoreTile(k);                   // back to the pre-stroke pixels…
    if (!t2) continue;
    tiles.push([t2.x, t2.y, t2.w, t2.h]);
    R = rectUnion(R, t2);
  }
  // Opacity in a wash, 1 with Build up — Opacity then rode on every dab instead (`Pen.deposit`, 6.4).
  // Either way the buffer goes on ONCE, which is what §3.3's latency and the clean soft edge rest on.
  g.globalAlpha = stroke.dep.apply;
  g.globalCompositeOperation = t.erase || hide ? "destination-out" : "source-over";
  for (const [x, y, w, h] of tiles) g.drawImage(stroke.buf, x, y, w, h, x, y, w, h);   // …then the whole stroke over them
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  const s = App.activeSlot;
  const SR = strokeRect(R, s, t.canvas);
  if (t.chan) { scheduleChannels(s, SR); draw2D(); }
  else scheduleComposite(s, SR);
}
// One stamp of the height brush ("Panel line"), added to the stroke's HEIGHT FIELD rather than
// written into the normal layer. ROADMAP 4.17.
//
// The bump is (1 - (rho/R)²)², which is the same shape whose analytic gradient the per-stamp code
// this replaces applied straight to the normal — `-4·depth·(1-d²)·u` is exactly d/du of it. Three
// things change, and between them they are the reported dashing:
//
//  * **it goes into a field.** A texel no stamp's disc happened to cover kept the base surface
//    exactly (`if (d[i+3] < 8) start from base`), so the gaps between consecutive stamps stayed
//    flat — that is the "multiple dashed lines along the line of the stroke". A field has no gaps:
//    the bumps overlap and add, and the gradient is taken once, over the sum.
//  * **the support is R = r + ½ and the weight reaches zero there**, so a texel enters a stamp at
//    zero weight instead of popping in at whatever (1-d²)² happened to be at the rim. The old test
//    was a hard `d² >= 1` at the texel CENTRE: a plus-shape at r≈1.5, a blocky diamond at r≈2, and
//    a shape that changed as the centre moved between texels.
//  * **each stamp is normalised to the same peak**, so where it falls between texels changes how
//    much it deposits not at all. That is the sub-texel ripple, and overlap does not average it out
//    — it is what a hand-drawn line's wobble is made of.
//
// The peak is at the texel nearest the centre, so finding it costs one distance rather than a pass.
function embossInto(H, W, Hh, cx, cy, r, depth){
  const R = r + .5;
  const x0 = Math.max(0, Math.ceil(cx - R)), y0 = Math.max(0, Math.ceil(cy - R));
  const x1 = Math.min(W - 1, Math.floor(cx + R)), y1 = Math.min(Hh - 1, Math.floor(cy + R));
  if (x1 < x0 || y1 < y0) return;
  const px = Math.min(x1, Math.max(x0, Math.round(cx))), py = Math.min(y1, Math.max(y0, Math.round(cy)));
  const pu = (px - cx) / R, pv = (py - cy) / R, pq = pu * pu + pv * pv;
  if (pq >= 1) return;
  const peak = (1 - pq) * (1 - pq);
  // Amplitude scales with the support, so the analytic wall slope (1.54·depth) is the same at every
  // brush size — which is what the old code produced and what "depth" therefore already means.
  const k = depth * R / peak;
  for (let y = y0; y <= y1; y++) {
    const row = y * W, dv = (y - cy) / R, v2 = dv * dv;
    for (let x = x0; x <= x1; x++) {
      const du = (x - cx) / R, q = du * du + v2;
      if (q >= 1) continue;
      const w = (1 - q) * (1 - q);
      H[row + x] += k * w;
    }
  }
  heightBuffer._dirty = rectUnion(heightBuffer._dirty, { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
}
// opt.jump  this point is NOT continuous with the previous one in texture space (the stroke
//           crossed a UV seam), so lay a single stamp instead of a line from there.
// opt.line   the opposite promise: interpolate however far it is, because the user asked for a
//           straight line (Shift+click). This is what the old "any gap wider than ten brush
//           diameters must be a UV island jump" guess got wrong — a long line is exactly that
//           gap, so a shift-click across a sheet drew one dot at the far end.
//
// opt.ang   which way the stroke is heading here, in radians on the sheet, for a dab laid on its own
//           that has no previous dab to say so: the shape tool's Stamp along, a 3-D stroke's first dab
//           past a UV seam, the sheet mirror's copy where it leaps. ROADMAP 4.50 (10).
//
// Each dab carries the pressure it is laid at (ROADMAP 4.50 (4)): `stroke.p` is the pressure of the
// sample being stamped, and `Pen.walk` runs it linearly from the previous dab's, spacing the dabs by
// their own size. Everything else a dab is comes from `Pen.dab` at that pressure — where it lands
// (scatter), its size and flow (pressure and jitter) and which way it faces (4.50 (10)) — and
// `Tips` lays it in the brush's tip. A mouse is full pressure, which is the brush as set; a brush with
// no dynamics and the round tip is the stroke it was before either, drawn by the same one drawImage.
function stampAt(px, py, ch, opt){
  if (!stroke) return;
  ch = ch || 0;
  const b = App.brush, t = stroke.t;
  const p = stroke.p == null ? 1 : stroke.p;
  const jump = !!(opt && opt.jump), last = jump ? null : stroke.lasts[ch];
  const pts = last ? Pen.walk(last, px, py, p, b, opt && opt.line) : [{ x: px, y: py, p }];
  // A jump lands somewhere the channel's last heading does not reach — across a UV seam it is a way
  // on another island's sheet — so only what the caller knows turns its dab (4.50 (10)'s review).
  const head = stroke.dirs[ch] = Pen.heading(last, px, py, opt && opt.ang, jump ? null : stroke.dirs[ch]);
  if (!pts.length) return;
  recStrokeCount("stamps", pts.length);
  // A camouflage tile repeats, so a dab that crosses an edge lands on the opposite one as well
  // (ROADMAP 4.50 (6)). `lasts` stays where the pointer really is — in the 3 × 3 view that can be a
  // neighbouring copy — so a stroke dragged across a seam is one line, not a jump back into the sheet.
  const tile = CamoTile.is(App.activeSlot), W = t.canvas.width, H = t.canvas.height;
  const at = (x, y, R) => tile ? CamoTile.copies(x, y, R, W, H) : [[x, y]];
  if (t.height) {
    // Point-sampling the mask is the only place that needs it as pixel data; reading a whole
    // 4096² sheet back per stamp (which is what the unconditional call did) cost 67 MB a stamp.
    const md = strokeMaskData();
    const depth = (b.value - 128) / 128 * 26 * b.opacity;
    for (const q of pts) {
      const r = Pen.size(b, q.p) / 2;
      stroke.lasts[ch] = q;
      // A height stroke is a field that ADDS — build-up is what it always was — so Flow has no row
      // here and pressure's flow is the dab's depth instead.
      const d = depth * Pen.flow(b, q.p);
      for (const [x, y] of at(q.x, q.y, r + 1)) {
        if (md) { const ix = (x * md.kx) | 0, iy = (y * md.ky) | 0; if (ix < 0 || iy < 0 || ix >= md.w || iy >= md.h || md.a[(iy*md.w+ix)*4+3] < 8) continue; }
        stroke.undo.record(x, y, r + 2);
        embossInto(stroke.h, W, H, x, y, r, d);
      }
    }
    // Once per frame, like the colour path — not once per stamp. The old line here also asked for
    // `scheduleChannels(slot)` with NO rectangle, which is a whole-sheet rebuild of every layered
    // channel per batch of stamps: the rectangle it had computed was assigned and never passed.
    scheduleStrokeView();
    return;
  }
  const stamp = brushStamp(), spins = Tips.get(b.tip).turns;
  const bg = ctx2d(stroke.buf);
  bg.globalCompositeOperation = "source-over";
  const mk = stroke.maskCanvas ? strokeMaskScale() : null;
  const rnd = Pen.dynamic(b) ? Pen.stream(stroke, ch) : null;
  for (const q of pts) {
    // The dab: where it lands, how big, how much it lays and which way it faces. A round tip is the
    // same at every angle, so it is never turned — its draw is the one it always was.
    const d = Pen.dab(b, q, head, rnd), sz = d.size, turn = spins ? d.angle : 0;
    // How far it reaches: a turned square's corners go past half its size, and the undo tiles and the
    // buffer's dirty rectangle must take them in or they are never applied and never cleared.
    const D = 2 * Tips.reach(stamp, sz, turn);
    // Flow (6.4): what this dab lays down. Overlapping dabs build up in the buffer by its own
    // source-over, and refreshStrokeView still applies the whole buffer once.
    bg.globalAlpha = stroke.dep.dab * d.flow;
    // Whole texels for the Clone: its patch buffers and its tone weights are sized in them. Its tip is
    // drawn once per dab, not once per copy of it, so every copy on a tile shares one set of weights.
    const cz = stroke.clone ? Math.max(1, Math.round(D)) : 0;
    const shape = stroke.clone ? Tips.shape(stamp, cz, sz, turn) : null;
    const home = tile ? CamoTile.wrap(d.x, d.y, W, H) : null;   // the copy of this dab inside the sheet…
    const hq = tile ? CamoTile.wrap(q.x, q.y, W, H) : null;     // …and of the brush
    for (const [x, y] of at(d.x, d.y, D / 2 + 2)) {
      stroke.undo.record(x, y, D / 2 + 2);
      strokeBufferDirty(x, y, D / 2 + 2);                       // so the NEXT stroke clears only this much
      if (stroke.clone) {                                       // the pixels come from elsewhere on the sheet
        // The offset is fixed where the BRUSH is, in its copy inside the sheet, whichever copy of a
        // scattered dab is stamped first: the source keeps step with the brush and the dashed ring.
        Clone.stamp(stroke.clone, bg, x, y, ch, cz / 2, cz, shape, stroke.maskCanvas, mk,
          tile ? { x: hq[0] + x - home[0], y: hq[1] + y - home[1] } : q, home && { x: x - home[0], y: y - home[1] });
      } else if (stroke.maskCanvas) {                           // clip this stamp to the painted part(s)
        Tips.layIn(bg, stamp, x, y, sz, turn, D, stroke.maskCanvas, mk);
      } else {
        Tips.lay(bg, stamp, x, y, sz, turn);                    // scaled at draw time: the stamp is the full size
      }
    }
    stroke.lasts[ch] = q;                                     // the walk's point, not the scattered one
  }
  bg.globalAlpha = 1;
  scheduleStrokeView();
}
function endStroke(){
  if (!stroke) return;
  recStrokeEnd();
  refreshStrokeView();
  const depth = App.undoStack.length;
  stroke.undo.commit();
  // A layer this stroke had to create is folded into the same history entry, so Ctrl+Z takes both
  // away and the stack never shows a bare "add layer" the user did not ask for. The entry starts
  // where the layer's own step did (ROADMAP 4.50(2)), so undoing it is back where the stroke began —
  // clean again, when that was the saved state.
  if (stroke.madeAct) {
    const a = stroke.madeAct, b = App.undoStack.length > depth ? App.undoStack.pop() : null;
    Autosave.fold(pushAction(b ? b.desc : "add layer",
      () => { if (b) b.undo(); a.undo(); },
      () => { a.redo(); if (b) b.redo(); },
      (b && b.bytes) || 0), a);
  }
  const s = App.activeSlot;
  // Where the stroke ended, kept as a PLACE and nothing else. A Shift+click line starts here, and a
  // last dab carries the pressure it was laid at (ROADMAP 4.50 (4)) — for a pen, the near-zero of
  // lifting off — so keeping it whole made `Pen.walk` taper every line up from a hairline: a mouse's
  // too, measured in review 2026-09-26 as 8 → 36 texels where the brush is 40. With no pressure on
  // it the walk lays the line at the click's pressure all along, which is what the 3-D line (from
  // `_last3d`, a point on the model) always did.
  const place = q => q ? { x: q.x, y: q.y } : q;
  if (stroke.lasts[0] && s) s._lastPt = place(stroke.lasts[0]);
  if (s) s._lastPtSym = place(stroke.lasts[1]);               // mirror endpoint, for symmetric line continuation
  // Where the stroke ended on the MODEL. A Shift+click line in 3D is walked between two surface
  // points, not between two points on the sheet — see the pointerdown handler.
  if (s) s._last3d = stroke.hits[0] ? stroke.hits[0].p.clone() : null;
  // Every frame of the stroke already composited the tiles it touched, so all that is left is
  // whatever the last frame queued. Re-doing the whole stroke's bounding box here cost 40 ms on a
  // long 4096² stroke for no visible change.
  // Both branches drain the pending rectangles. The channel branch used to call
  // `compositeChannels(s)` with no rectangle at all — a guaranteed whole-sheet rebuild of every
  // layered channel at the end of every stroke, which is the thing the paragraph above says cost
  // 40 ms for no visible change. It was invisible as a bug only because compositeChannel ignored
  // the rectangle anyway (ROADMAP 1.10); now that it honours one, passing none is the whole cost.
  flushComposites();
  if (stroke.t.chan) draw2D();
  stroke = null;
}

