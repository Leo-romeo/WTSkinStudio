// ---------- The marquee: a rectangle of texels, and the verbs that act on one ----------
// ROADMAP 4.10. Before this the app had no way to say *which part* of an image you meant, anywhere.
// "Crop to content" existed — a checkbox inside the decal editor calling trimTransparent() — and it
// is an automatic trim to the alpha bounding box with no handles, no numbers and no existence
// outside that modal. So the selection comes first and the crop second: crop is one verb on a
// selection, and fill, clear and copy are the three others that had no gesture either.
//
// Everything here is in WHOLE TEXELS of the slot's albedo space, and that is a correctness rule
// rather than tidiness: a half-texel rectangle resamples the whole layer for nothing, and every
// verb below is a clearRect / fillRect / drawImage on integer coordinates — so none of them can
// leave the antialiased 1-px seam a `ctx.clip()` would (see the wt-canvas facts).
//
// The geometry half is a pure function of a rectangle and a scale: no DOM, no canvases, no App.
// That is what makes it a primitive rather than a feature of the 2-D view — the decal editor's
// preview is the next canvas it mounts on (4.11), and it will hand it a different transform and
// nothing else. The verbs need the editor's own state and live here rather than in ui/ because
// they own pixels, not widgets.
const Marquee = {
  slot: null,           // the sheet the rectangle belongs to
  r: null,              // {x, y, w, h}, integers, inside that sheet

  // ---- and, since ROADMAP 4.24, an optional SHAPE inside that rectangle ----
  // A UV island is a selection too, and it is not a rectangle. Rather than a second selection object
  // with its own verbs, an island selection is the rectangle it is bounded by PLUS a stencil: every
  // verb below already computes a region and then writes inside it, so each one gains one
  // composite and none of them gains a code path. The rectangle stays the thing undo, the number
  // fields and the region accounting are expressed in.
  mask: null,           // the island stencil, at MASK resolution (what partSetMaskCanvas builds)
  tint: null,           // the same stencil in the accent colour, so drawing it costs no scratch
  islands: null,        // the component ids behind it, so a shift-click can add to them
  bitsOf: null,         // {mask, bits, S, b, packed}: a shape made by 4.50 (9)'s sources, as its own
                        // bytes at the SHEET's resolution (`dims`) — what the verbs cut with, what
                        // the next Shift/Alt combines with, and (packed) what its undo step holds
  // Bumped by the two funnels below, so a consumer can tell "the selection changed" from "a frame
  // went by" without diffing a snapshot on every draw. `SelOverlay` rebuilds the on-model tint off
  // this, once per change instead of once per rendered frame.
  rev: 0,
  // One accent for both views. It lives here because this is where the tint canvas is built, and
  // two literals in two files is how the 2-D overlay and the 3-D one come to disagree.
  ACCENT: "#5aa0ff",

  // A selection belongs to ONE sheet. Switching slots does not carry it across, because the same
  // four numbers mean a different place on a differently sized sheet — and a crop aimed at the
  // wrong sheet is not something you can see before it happens.
  //
  // Re-normalised on every read rather than only when it is set, because the sheet can change size
  // underneath a live selection (Textures ▸ Resize, or a project load onto a smaller albedo). A
  // rectangle naming texels the sheet no longer has would hand every verb an out-of-bounds region.
  rect(){
    const s = App.activeSlot;
    if (!Marquee.r || Marquee.slot !== s || !s || !s.composite) return null;
    if (Marquee.r.x + Marquee.r.w > s.composite.width || Marquee.r.y + Marquee.r.h > s.composite.height)
      Marquee.r = Marquee.norm(Marquee.r, s.composite.width, s.composite.height);
    return Marquee.r;
  },

  // ---- geometry: pure, and the same functions the drawing and the drag both read ----
  // Whole texels, inside the sheet, at least one texel across. Anything smaller is a click that
  // missed, and it drops the selection rather than leaving a zero-width rectangle that every verb
  // would then have to special-case.
  norm(r, W, H){
    if (!r || !(W > 0) || !(H > 0)) return null;
    const clamp = (v, hi) => Math.max(0, Math.min(hi, Math.round(v)));
    const x0 = clamp(Math.min(r.x, r.x + r.w), W), x1 = clamp(Math.max(r.x, r.x + r.w), W);
    const y0 = clamp(Math.min(r.y, r.y + r.h), H), y1 = clamp(Math.max(r.y, r.y + r.h), H);
    return (x1 - x0 >= 1 && y1 - y0 >= 1) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  },
  // The eight handles as unit positions on the rectangle. One table, so hit-testing, drawing and
  // the drag can never disagree about where a handle is.
  HANDLES: [["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5],
            ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]],
  handleAt(r, kx, ky){ return { x: r.x + r.w * kx, y: r.y + r.h * ky }; },
  // Which handle is under a point, in texels. `tpp` is texels per screen pixel, so the grab radius
  // is constant on screen: a handle you cannot hit when zoomed out is not a handle.
  hit(r, px, py, tpp){
    if (!r) return null;
    const g = Math.max(.75, 6 * (tpp || 1));
    for (const [id, kx, ky] of Marquee.HANDLES) {
      const h = Marquee.handleAt(r, kx, ky);
      if (Math.abs(px - h.x) <= g && Math.abs(py - h.y) <= g) return id;
    }
    return (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) ? "in" : null;
  },
  // Move ("in") or resize (a handle id). `from` is the rectangle as it was when the drag STARTED,
  // so the result is always computed from the press rather than accumulated frame by frame —
  // accumulating rounds to whole texels every frame and the rectangle creeps as you drag.
  drag(from, id, dx, dy, opt){
    if (!from) return null;
    const W = (opt && opt.W) || 0, H = (opt && opt.H) || 0;
    if (id === "in") {
      // A move keeps its size at the edge of the sheet. Clamping the four edges independently (what
      // norm does) would silently shrink the rectangle instead of stopping it.
      const cl = (v, span, hi) => hi ? Math.max(0, Math.min(hi - span, v)) : v;
      return { x: cl(from.x + dx, from.w, W), y: cl(from.y + dy, from.h, H), w: from.w, h: from.h };
    }
    let x0 = from.x, y0 = from.y, x1 = from.x + from.w, y1 = from.y + from.h;
    if (/w/.test(id)) x0 += dx; else if (/e/.test(id)) x1 += dx;
    if (/n/.test(id)) y0 += dy; else if (/s/.test(id)) y1 += dy;
    if (opt && opt.aspect && from.w > 0 && from.h > 0) {
      // The edge you did not grab follows. The corner opposite the handle is the anchor, so the
      // rectangle grows away from the point you are holding still.
      const ar = from.w / from.h;
      let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (id === "n" || id === "s") w = h * ar; else h = w / ar;
      if (/w/.test(id)) x0 = x1 - w; else x1 = x0 + w;
      if (/n/.test(id)) y0 = y1 - h; else y1 = y0 + h;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
  // Everything OUTSIDE the rectangle, as four disjoint bands. Crop erases exactly these, and they
  // are also what its undo has to hold: a whole-sheet before/after for a crop that trims a border
  // is hundreds of megabytes of pixels that did not change.
  outside(r, W, H){
    const out = [];
    if (!r) return [{ x: 0, y: 0, w: W, h: H }];
    if (r.y > 0) out.push({ x: 0, y: 0, w: W, h: r.y });
    if (r.y + r.h < H) out.push({ x: 0, y: r.y + r.h, w: W, h: H - r.y - r.h });
    if (r.x > 0) out.push({ x: 0, y: r.y, w: r.x, h: r.h });
    if (r.x + r.w < W) out.push({ x: r.x + r.w, y: r.y, w: W - r.x - r.w, h: r.h });
    return out;
  },

  // ---- the selection itself ----
  sheet(){ const s = App.activeSlot; return s && s.composite ? { s, W: s.composite.width, H: s.composite.height } : null; },
  set(r, shape){
    const sh = Marquee.sheet();
    if (!sh) return null;
    Marquee.slot = sh.s;
    Marquee.r = Marquee.norm(r, sh.W, sh.H);
    // A rectangle REPLACES a shape. Every caller that drags a handle, types a number or takes the
    // whole sheet passes none, and that is the right default: there is no gesture that means "keep
    // the island but move its box", and silently keeping one would make the four number fields
    // describe a selection they do not control.
    const keep = Marquee.r && shape;
    Marquee.mask = keep ? shape.mask : null;
    Marquee.tint = keep ? shape.tint : null;
    Marquee.islands = keep ? shape.islands : null;
    if (Marquee.bitsOf && Marquee.bitsOf.mask !== Marquee.mask) Marquee.bitsOf = null;
    // A NEW selection is shown even if the last one was hidden (3.39 (3)): a selection made where
    // nothing draws it is the invisible mode 3.9 was reported for, and H puts it away again.
    Marquee.shown = true;
    Marquee.rev++;
    SelectUI.sync();
    draw2D();
    return Marquee.r;
  },
  none(){
    const had = !!Marquee.r;
    Marquee.r = null; Marquee.slot = null;
    Marquee.mask = Marquee.tint = Marquee.islands = Marquee.bitsOf = null;
    Marquee.rev++;
    SelectUI.sync();                                    // always: the panel must not outlive the rectangle
    if (had) draw2D();
  },
  // The stencil in force, or null for a plain rectangle. Read through `rect()` so a shape cannot
  // outlive the selection it belongs to — switching slots drops both together.
  shape(){ return Marquee.rect() ? Marquee.mask : null; },

  // ---- selection history (reported 2026-08-31: island picks were outside undo entirely) ----
  // A selection is something you MAKE, so it steps back like everything else you make. Three rules
  // fall out of the state above and each one is why this is not simply `pushAction` at every call
  // site:
  //
  // 1. **The snapshot stores island IDS, never the stencils.** A component id is an integer and the
  //    raster it implies is derived from the geometry and already LRU-cached (`UVIslands.stencil`).
  //    Holding the mask and the tint would put two mask-resolution canvases — up to 32 MB — into a
  //    history budget §3.7 measures in bytes, per click, to save a rebuild that costs nothing.
  // 2. **It is read through `rect()`.** That is the one accessor that knows a selection belongs to
  //    one sheet, so a snapshot taken after a slot switch records "nothing selected", which is what
  //    is actually in force, rather than a rectangle pointing at a texture nobody is looking at.
  // 3. **Entries are pushed by the GESTURE, not by `set`.** `set` runs on every frame of a drag;
  //    one entry per frame is a history nobody can walk back.
  //
  // 4. **...except a shape no id can rebuild.** 4.28(g)'s "selection from a mask" makes one: it is a
  //    threshold of pixels the user may edit a second later, so there is no recipe to re-derive it
  //    from. That one is held BY REFERENCE in the snapshot, and rule 1 still stands — it is one
  //    mask-resolution canvas per explicit command, not two per click of a gesture.
  // 5. **A shape 4.50 (9) made is held as its PACKED bits** (`bitsOf.packed`, one bit a texel) and
  //    rebuilt when it is stepped back onto. Those are made by the click — every wand patch Shift-
  //    added is one — and the canvas rule 4 holds cost 16 MB a step, so the default 384 MB history
  //    held 23 wand clicks before it pushed paint out (review of 4.50 (9), 2026-09-26). The bits of a
  //    4096² sheet are 2 MB.
  snapshot(){
    const r = Marquee.rect(), own = Marquee.ownBits();
    return { slot: r ? Marquee.slot : null, r: r ? { ...r } : null,
             islands: (r && Marquee.islands) ? new Set(Marquee.islands) : null,
             bits: (r && own) ? { packed: own.packed, S: own.S, b: own.b } : null,
             shape: (r && Marquee.mask && !Marquee.islands && !own) ? Marquee.mask : null };
  },
  // The bytes behind the shape in force, when 4.50 (9) made it — null for a rectangle, an island pick
  // or a mask's shape, whose stencil is only a canvas.
  ownBits(){
    const shp = Marquee.shape(), own = Marquee.bitsOf;
    return shp && !Marquee.islands && own && own.mask === shp ? own : null;
  },
  sameSnap(a, b){
    if (!a || !b) return a === b;
    if (a.slot !== b.slot) return false;
    if (!a.r || !b.r) return !a.r && !b.r;
    if (a.r.x !== b.r.x || a.r.y !== b.r.y || a.r.w !== b.r.w || a.r.h !== b.r.h) return false;
    if (a.shape !== b.shape) return false;
    if ((a.bits && a.bits.packed) !== (b.bits && b.bits.packed)) return false;
    if (!a.islands || !b.islands) return !a.islands && !b.islands;
    if (a.islands.size !== b.islands.size) return false;
    for (const v of a.islands) if (!b.islands.has(v)) return false;
    return true;
  },
  applySnapshot(sn){
    if (!sn || !sn.r) { Marquee.none(); return; }
    // A selection belongs to ONE sheet (see `rect`), so a step recorded on another one cannot be
    // put back while that sheet is not open. Dropping it silently is the no-op §4 forbids, and
    // restoring it onto whatever is open would aim a crop at the wrong texture.
    if (App.activeSlot !== sn.slot) {
      Marquee.none();
      setStatus("That selection was made on “" + ((sn.slot && sn.slot.id) || "another texture") +
        "” — open that texture to step back onto it", "err");
      return;
    }
    if (sn.islands && sn.islands.size) Marquee.setIslands(new Set(sn.islands));
    else if (sn.bits) Marquee.putBits(SelShape.unpack(sn.bits.packed, sn.bits.S.w * sn.bits.S.h), sn.bits.S, sn.bits.b, sn.bits.packed);
    else if (sn.shape) Marquee.set(sn.r, { mask: sn.shape, tint: Marquee.tintOf(sn.shape, sn.r), islands: null });
    else Marquee.set(sn.r);
  },
  // Run `fn` and record whatever it did to the selection as one undo step. Nothing is pushed when
  // the selection came out the same, so a click that missed does not fill history with no-ops.
  //
  // A shape the step holds lives exactly as long as the step does, so the step carries its bytes —
  // the packed bits of a 4.50 (9) shape (rule 5), or the canvas of a mask's (rule 4), which went
  // uncounted until 4.50 (9). The BEFORE shape is not counted again: the step that made it already
  // carries it.
  act(desc, fn){
    const before = Marquee.snapshot();
    fn();
    const after = Marquee.snapshot();
    if (Marquee.sameSnap(before, after)) return;
    const held = after.bits && after.bits.packed !== (before.bits && before.bits.packed) ? after.bits.packed.byteLength
               : after.shape && after.shape !== before.shape ? after.shape.width * after.shape.height * 4 : 0;
    pushAction(desc, () => Marquee.applySnapshot(before), () => Marquee.applySnapshot(after), held);
  },
  // A set of UV islands, as a selection (ROADMAP 4.24(a), decided 2026-08-28). Not persisted and not
  // a per-layer scope: an island's identity is derived from geometry, so storing one in a `.wtproj`
  // is a compatibility surface bought for a want nobody has stated yet — 4.24(b) is that item, and
  // it waits until working with this shows islands want to persist.
  setIslands(ids){
    const sh = Marquee.sheet();
    if (!sh) return null;
    if (!ids || !ids.size) { Marquee.none(); return null; }
    const box = UVIslands.bounds(sh.s, ids), mask = UVIslands.stencil(sh.s, sh.W, sh.H, ids);
    if (!box || !mask) {
      setStatus("That island covers no texel of this sheet — it is thinner than a texel at this size", "err");
      return null;
    }
    return Marquee.set(box, { mask, tint: Marquee.tintOf(mask, box), islands: new Set(ids) });
  },

  // ---- ROADMAP 4.28(g): the two bridges between a selection and a mask ----
  // One of them existed and was buried; the other did not exist in either direction of the app.
  //
  // "Selection → mask" was the `from selected parts` button on the mask row, and it could see only
  // the PART selection — so the rectangle you had just dragged, and the UV island you had just
  // clicked, were the two shapes you could not turn into a mask. "Mask → selection" had no control
  // at all: a mask you had painted, imported, softened or inverted was a shape every selection verb
  // was blind to, which is the same gap 4.27 closed between parts and islands, one layer down.
  //
  // Both go through ONE stencil — `Marquee.stencil` — which is the whole selection in force: the
  // rectangle, the island shape inside it and the part selection, composed the way a stroke is
  // (`t59` compares those two stencils texel for texel, so "the mask matches what you selected"
  // means the same thing as "the brush would have painted there").
  //
  // At MASK resolution, like every other stencil in the app (`maskDims`), and that is what makes
  // the reverse direction affordable: thresholding a 4096² layer mask would be the 67 MB
  // `getImageData` §3.6 exists to avoid, and the stencil it produces would be thrown away at this
  // size anyway.
  stencil(s){
    if (!s || !s.composite) return null;
    const W = s.composite.width, H = s.composite.height;
    const r = Marquee.rect(), shp = Marquee.shape();
    const parts = App.geomData && App.selParts.size ? [...App.selParts] : null;
    if (!r && !parts) return null;
    const D = maskDims(W, H);
    const c = mkCanvas(D.w, D.h), g = ctx2d(c);
    g.fillStyle = "#fff";
    // A shape IS the selection and its box only bounds it — the box is what a sheet resized under it
    // clips (see `rect`) — so with a shape in force the box takes every mask texel it touches, floor
    // and ceil, the way `clipStroke` and `areaBits` read it. Rounding the width, which a plain
    // rectangle keeps, cut a shape's last column and row wherever k is not a power of two: on a
    // 3000-texel sheet (k = 0.683) a shape ending at mask texel 199 has the box x 146, w 147, and
    // that rounds back to mask texels 99 … 198 (4.50 (9); t99 holds it).
    if (r && shp) {
      const x0 = Math.floor(r.x * D.k), y0 = Math.floor(r.y * D.k);
      g.fillRect(x0, y0, Math.min(D.w, Math.ceil((r.x + r.w) * D.k)) - x0, Math.min(D.h, Math.ceil((r.y + r.h) * D.k)) - y0);
    } else if (r) g.fillRect(Math.floor(r.x * D.k), Math.floor(r.y * D.k),
                      Math.max(1, Math.round(r.w * D.k)), Math.max(1, Math.round(r.h * D.k)));
    else g.fillRect(0, 0, D.w, D.h);
    const clip = m => { g.globalCompositeOperation = "destination-in"; g.drawImage(m, 0, 0, D.w, D.h); g.globalCompositeOperation = "source-over"; };
    if (shp) clip(shp);
    if (parts) {
      const pm = partSetMaskCanvas(s, W, H, parts);
      // Parts selected but none of them on this sheet is an EMPTY stencil, not "no restriction" —
      // the same reading `confine` takes, and the difference between masking nothing and masking
      // everything.
      if (pm) clip(pm); else { g.clearRect(0, 0, D.w, D.h); }
    }
    return c;
  },
  // The accent copy of a stencil, for the 2-D overlay. Built once per selection rather than per
  // frame: tinting needs a `source-in` fill into a scratch, and doing that inside draw2D would put
  // a full-sheet composite in the rAF the whole of §3 exists to keep empty.
  // `box` is the selection's rectangle in sheet texels: the shape lies inside it, so the work does too.
  tintOf(mask, box){
    const sh = Marquee.sheet(), k = sh ? mask.width / sh.W : 1;
    return Marquee.outline(mask, mkCanvas(mask.width, mask.height),
      box && { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k });
  },

  // ---- how a stencil is SHOWN: a rim and a wash, not a sticker (ROADMAP 3.39 (1)) ----
  // Reported 2026-10-21 with a wand-picked star on a tail: the tint was the accent at 0.42 on the
  // model and 0.32 in 2-D, flat over the whole shape, and it read as an opaque light-blue sticker —
  // the star's own colour and its weathering, the things you selected it to judge, could not be
  // seen. So the region is drawn the way Photoshop and Substance draw theirs: a solid line along its
  // edge says WHERE, and a wash faint enough to keep the texture's luminance says WHICH SIDE.
  //
  // The rim is INSIDE the stencil — the stencil minus itself eroded — and never outside it. These
  // canvases are UV space: past an island's edge is gutter, or another island that is somewhere else
  // on the vehicle entirely, so a rim dilated outward (what the decal ring used to be) lands on the
  // model in places that have nothing to do with the selection. Inside, every rim texel is a texel
  // the selection holds.
  //
  // Erosion is the stencil `destination-in` itself shifted eight ways by `r` mask texels: a texel
  // stays only if all eight neighbours at that reach are in. A feature thinner than 2r has no inside
  // and comes out all rim, which is the right picture of it. `r` grows with the mask so the line
  // keeps its width on the model whatever the sheet size (4 texels on a 2048² mask, 8 on the sheet).
  //
  // Fourteen draws, once per selection change and never per frame — but over the WHOLE mask they
  // were 199–232 ms at 2048² (40–48 at 1024²) in the suite's software-rasterised Chrome, against
  // 32 for the flat tint they replace (2026-10-23, a 1×1 getImageData either side). So given `R`, the
  // selection's box in `dst`'s pixels, the work is done over that box grown by r + 1 and nothing
  // else: the stencil is empty outside its box, so every shifted copy reads empty there too and the
  // result is exact, not approximate. A box a quarter of the mask across measured 27 ms there, half
  // across 66; only a selection as big as the sheet still pays the whole 200.
  RIM: .9,
  WASH: .14,
  outline(src, dst, R){
    const W = dst.width, H = dst.height, r = Math.max(2, Math.round(Math.max(W, H) / 512));
    const x0 = R ? Math.max(0, Math.floor(R.x) - r - 1) : 0, y0 = R ? Math.max(0, Math.floor(R.y) - r - 1) : 0;
    const x1 = R ? Math.min(W, Math.ceil(R.x + R.w) + r + 1) : W, y1 = R ? Math.min(H, Math.ceil(R.y + R.h) + r + 1) : H;
    const w = x1 - x0, h = y1 - y0, g = ctx2d(dst);
    Composite.reset(g); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    if (w <= 0 || h <= 0) return dst;
    const st = Composite.scratch("_selSt", w, h), er = Composite.scratch("_selEr", w, h);
    const gs = ctx2d(st), ge = ctx2d(er);
    for (const x of [gs, ge]) { Composite.reset(x); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); }
    // the stencil in the accent, whatever colour it came in (a mask is white, a decal is its image)
    const kx = src.width / W, ky = src.height / H;
    gs.drawImage(src, x0 * kx, y0 * ky, w * kx, h * ky, 0, 0, w, h);
    // Hardened, 1 − (1 − a)^8, before anything is eroded: erosion multiplies nine alphas, so a decal
    // whose image is see-through stayed rim all the way in — a footprint at alpha 0.8 came out 161 in
    // the middle against 184 on its rim, and at 0.5 the two were the same 115 (review of 3.39 (1),
    // 2026-10-23). A selection's stencil is all or nothing, so this changes it nowhere but its
    // antialiased edge. Three self-draws, `source-over`: the canvas-compositing route to "at least
    // this much" that `hardenMask` used to take for part stencils.
    for (let i = 0; i < 3; i++) gs.drawImage(st, 0, 0);
    gs.globalCompositeOperation = "source-in"; gs.fillStyle = Marquee.ACCENT; gs.fillRect(0, 0, w, h);
    Composite.reset(gs);
    ge.drawImage(st, 0, 0);
    ge.globalCompositeOperation = "destination-in";
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) ge.drawImage(st, dx, dy);
    Composite.reset(ge);
    g.globalAlpha = Marquee.RIM; g.drawImage(st, x0, y0);
    g.globalAlpha = 1; g.globalCompositeOperation = "destination-out"; g.drawImage(er, x0, y0);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = Marquee.WASH; g.drawImage(er, x0, y0);
    Composite.reset(g);
    return dst;
  },

  // ---- and a way to put it away without deselecting (ROADMAP 3.39 (3)) ----
  // "There is no way to hide the overlay without deselecting": turning the tool off keeps the
  // selection, rightly, and so kept the tint over the texture being painted. Photoshop's answer is
  // Show Extras (Ctrl+H — here Ctrl+H is already Solo, so H alone). Hidden, the selection still
  // confines the brush in both views and every verb still acts on it; only the drawing goes: the
  // tint and outline in 2-D, the overlay on the model, and the selected decal's ring there, which
  // is the same overlay (`SelOverlay`). The decal's 2-D frame stays — its handles are controls.
  // Not saved and not undone: it is a view setting, like the coverage tint.
  shown: true,
  setShown(on){
    Marquee.shown = !!on;
    SelectUI.sync();
    draw2D();
    needsRender();
  },
  // Is anything selected at all — a rectangle, a shape inside one, or a set of parts? Cheap, so a
  // panel can ask it while enabling a button; `stencil` allocates and is for when you mean it.
  any(){ return !!Marquee.rect() || !!(App.geomData && App.selParts.size); },
  toMask(){
    const s = App.activeSlot, L = activeLayerObj();
    if (!s || !s.composite) { setStatus("Open a texture slot first", "err"); return false; }
    if (!L || isGroup(L)) { setStatus("Select the layer the mask belongs to first — a mask hides one layer, not the sheet", "err"); return false; }
    const st = Marquee.stencil(s);
    if (!st) { setStatus("Nothing is selected — drag a rectangle in the 2-D view, click a UV island (K), or select parts on the model, then try again", "err"); return false; }
    const m = blankMask(s, false);
    ctx2d(m).drawImage(st, 0, 0, m.width, m.height);
    setLayerMask(s, L, m, "mask from selection");
    setStatus("“" + L.name + "” now has a mask matching the selection — soften or paint its edge from here. " +
      "The selection itself is untouched, and for a limit that survives a resize exactly the layer's Parts row is still the better tool.", "ok");
    return true;
  },
  // The other direction, which had no control at all. White shows, so white is what gets selected —
  // the same reading `imageToMask` takes coming in, which is what makes the round trip mean
  // something rather than being two conventions that happen to be inverses.
  fromMask(){
    const s = App.activeSlot, L = activeLayerObj();
    if (!s || !s.composite) { setStatus("Open a texture slot first", "err"); return false; }
    const lm = L && !isGroup(L) ? LayerNode.maskCanvas(s, L) : null;      // painted, or another layer's pixels (4.36)
    if (!L || isGroup(L) || !lm) {
      setStatus("Select a layer that has a mask — this turns the mask's light areas into a selection", "err");
      return false;
    }
    const W = s.composite.width, H = s.composite.height, D = maskDims(W, H);
    const small = mkCanvas(D.w, D.h), sg = ctx2d(small);
    sg.drawImage(lm, 0, 0, D.w, D.h);
    const src = sg.getImageData(0, 0, D.w, D.h);
    const out = new ImageData(D.w, D.h);
    let x0 = D.w, y0 = D.h, x1 = -1, y1 = -1;
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      const i = (y * D.w + x) * 4;
      // Luminance times its own alpha, thresholded at half: a mask is a grey sheet and a selection
      // is a yes/no, so somewhere has to be the line and the middle is the only defensible place.
      const lum = (src.data[i] * .2126 + src.data[i + 1] * .7152 + src.data[i + 2] * .0722) * (src.data[i + 3] / 255);
      if (lum < 128) continue;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = out.data[i + 3] = 255;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) {
      setStatus("“" + L.name + "”'s mask hides the layer everywhere — there is nothing light in it to select", "err");
      return false;
    }
    const mask = mkCanvas(D.w, D.h);
    ctx2d(mask).putImageData(out, 0, 0);
    const box = { x: Math.floor(x0 / D.k), y: Math.floor(y0 / D.k),
                  w: Math.ceil((x1 - x0 + 1) / D.k), h: Math.ceil((y1 - y0 + 1) / D.k) };
    Marquee.act("selection from mask", () => {
      Marquee.set(box, { mask, tint: Marquee.tintOf(mask, box), islands: null });
      if (!SelectUI.on) SelectUI.setOn(true);
    });
    setStatus("Selected what “" + L.name + "”'s mask shows — Fill, Clear, Crop and Copy follow the shape, not the box round it", "ok");
    return true;
  },
  all(){
    const sh = Marquee.sheet();
    if (!sh) { setStatus("Select a texture slot first", "err"); return; }
    Marquee.set({ x: 0, y: 0, w: sh.W, h: sh.H });
    setStatus("Selected the whole " + sh.W + " × " + sh.H + " sheet", "ok");
  },

  // ---- ROADMAP 4.50 (9): a selection from a lasso, a path, a colour range — and Shift / Alt ----
  // A shaped selection is already a mask (`fromMask` above), so every new source only makes one
  // — `SelShape` (editor/selshape.js) is the arithmetic — and this is where it is put in force.
  // Each source is one undo step through `act`, holding its packed bits (rule 5).
  //
  // **A shape is held at the SHEET's own resolution**, up to 4096² — every sheet a ground or naval
  // skin can publish at — not at the mask resolution (2048² at most) every other stencil lives at.
  // Held at 2048², a 4096² sheet's shape could only begin and end on every second texel: two
  // camouflage patches meeting at an odd texel came out a texel to one side, and every verb drew the
  // 2048² stencil up to the sheet smoothed, so a wand patch recoloured with Fill had α 191 and 63
  // along its edges. Recolouring two touching patches left 4 texels of each row neither patch's new
  // colour at 4096², and 0 at 2048² (review of 4.50 (9), 2026-09-26). The mask-resolution stencil
  // stays for what works at mask resolution anyway — the brush, `→ layer mask`, the tint in both
  // views — and is made FROM the bytes (`stencilOf`); the verbs cut with the bytes (`cut`).
  SEL_MAX: 4096,
  BAND: 1 << 20,        // texels the wand reads at a time: 4 MB of RGBA, 256 rows of a 4096² sheet
  dims(W, H){
    const k = Math.min(1, Marquee.SEL_MAX / Math.max(W, H));
    return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)), k };
  },
  // The AREA half of what is selected — the rectangle and any shape inside it, not the parts — as
  // selection bytes at `S`: what a Shift or Alt combine starts from. Null with nothing selected. A
  // shape made here combines from its own bytes, so Shift+clicking five patches with the wand reads
  // nothing back; an island pick or a mask's shape is read back once, drawn up to `S`.
  areaBits(S){
    const r = Marquee.rect(), sh = Marquee.sheet();
    if (!r || !sh) return null;
    const fx = S.w / sh.W, fy = S.h / sh.H;
    const x0 = Math.max(0, Math.floor(r.x * fx)), y0 = Math.max(0, Math.floor(r.y * fy));
    const x1 = Math.min(S.w, Math.ceil((r.x + r.w) * fx)), y1 = Math.min(S.h, Math.ceil((r.y + r.h) * fy));
    const shp = Marquee.shape();
    if (!shp) return SelShape.rect(x0, y0, x1, y1, S.w, S.h);
    const own = Marquee.ownBits();
    if (own && own.S.w === S.w && own.S.h === S.h) return own.bits.slice();
    // Inside the box only: a shape is bounded by its rectangle by construction, and a sheet resized
    // under the selection can have clipped the rectangle (`rect()` re-normalises) but not the shape.
    return Marquee.canvasBits(shp, S, x0, y0, x1, y1);
  },
  // A stencil canvas as selection bytes at `D` — alpha ≥ 128 is in, the mask convention (wt-canvas:
  // a mask here is alpha, not grey) — over [x0, x1) × [y0, y1), or all of it. One readback, at `D`;
  // a canvas at another size is drawn to it first.
  canvasBits(c, D, x0 = 0, y0 = 0, x1 = D.w, y1 = D.h){
    if (c.width !== D.w || c.height !== D.h) { const t = mkCanvas(D.w, D.h); ctx2d(t).drawImage(c, 0, 0, D.w, D.h); c = t; }
    const d = ctx2d(c).getImageData(0, 0, D.w, D.h).data, bits = new Uint8Array(D.w * D.h);
    for (let y = y0; y < y1; y++)
      for (let x = x0, i = y * D.w + x0; x < x1; x++, i++) bits[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    return bits;
  },
  // Put a shape in force — selection bytes at `S` — combined with what is selected the way the
  // modifiers say: "add" (Shift), "sub" (Alt), anything else replaces; and give it the box it fills,
  // since the rectangle is what undo, the number fields and the verbs' region are expressed in. The
  // result has no island ids even when an island pick went into it: an island plus a lasso is not an
  // island, and `→ parts` refusing it is truer than a set of ids that describes half of what is
  // selected.
  //
  // True when it is in force; false, with the selection dropped, when nothing is left; and "same"
  // when a Shift or Alt changes nothing — the selection is then left exactly as it was, so a
  // rectangle keeps its handles and `act` pushes no step. Before, a Shift-lasso round no texel centre
  // turned a rectangle into a shape without handles, pushed a step holding a canvas, and said it had
  // added the lasso (review of 4.50 (9), 2026-09-26). `box`, when the caller has it, is the shape's
  // own box in selection texels (the wand counts it as it floods); a combine works its own out.
  applyShape(bits, S, op, box){
    if (!Marquee.sheet()) return false;
    if (op === "add" || op === "sub") {
      const base = Marquee.areaBits(S);
      if (base) {
        if (!SelShape.changes(base, bits, op)) return "same";
        bits = SelShape.combine(base, bits, op); box = null;
      } else if (op === "sub") bits = null;                 // nothing, minus a shape, is nothing
    }
    const b = bits && (box || SelShape.bounds(bits, S.w, S.h));
    if (!b) { Marquee.none(); return false; }
    Marquee.putBits(bits, S, b);
    return true;
  },
  // Selection bytes in force: the box they fill, in sheet texels; the mask-resolution stencil made
  // from them and its tint; and the bytes themselves, with the packed copy an undo step holds — which
  // `applySnapshot` hands back in, so stepping onto a shape keeps the identity `sameSnap` compares.
  // Mapped by fractions of the sheet rather than by one scale, so a step recorded before Textures ▸
  // Resize still lands on the same part of the sheet.
  putBits(bits, S, b, packed){
    const sh = Marquee.sheet();
    if (!sh) return false;
    const fx = S.w / sh.W, fy = S.h / sh.H;
    const mask = Marquee.stencilOf(bits, S, maskDims(sh.W, sh.H), b);
    const x = Math.floor(b.x0 / fx), y = Math.floor(b.y0 / fy);
    const box = { x, y, w: Math.ceil((b.x1 + 1) / fx) - x, h: Math.ceil((b.y1 + 1) / fy) - y };
    Marquee.set(box, { mask, tint: Marquee.tintOf(mask, box), islands: null });
    Marquee.bitsOf = { mask, bits, S: { w: S.w, h: S.h, k: S.k }, b, packed: packed || SelShape.pack(bits) };
    return true;
  },
  // The mask-resolution stencil of selection bytes: what the brush clips a stroke to, what `→ layer
  // mask` bakes and what both views tint — each of which works at mask resolution (`maskDims`, 2048²
  // at most) whatever the selection is held at. Where the bytes are finer (a 4096² sheet), a mask
  // texel takes the share of four points in its footprint that is selected, so the brush's edge is
  // centred on the shape's own rather than a texel to one side; the texel-exact edge is `cut`'s. At
  // one selection texel per mask texel the four points are one texel, and the stencil is 0 or 255.
  // Only the box is written: the rest of a new canvas is already empty.
  stencilOf(bits, S, D, b){
    const img = new ImageData(D.w, D.h), px = new Uint32Array(img.data.buffer);
    const rx = S.w / D.w, ry = S.h / D.h;                  // selection texels per mask texel, 1 or more
    const mx0 = Math.max(0, Math.floor(b.x0 / rx)), mx1 = Math.min(D.w - 1, Math.floor(b.x1 / rx));
    const my0 = Math.max(0, Math.floor(b.y0 / ry)), my1 = Math.min(D.h - 1, Math.floor(b.y1 / ry));
    const qx = new Int32Array((mx1 - mx0 + 1) * 2);
    for (let mx = mx0, i = 0; mx <= mx1; mx++, i += 2) {
      qx[i] = Math.min(S.w - 1, Math.floor((mx + .25) * rx));
      qx[i + 1] = Math.min(S.w - 1, Math.floor((mx + .75) * rx));
    }
    for (let my = my0; my <= my1; my++) {
      const ra = Math.min(S.h - 1, Math.floor((my + .25) * ry)) * S.w, rb = Math.min(S.h - 1, Math.floor((my + .75) * ry)) * S.w;
      for (let i = 0, o = my * D.w + mx0; i < qx.length; i += 2, o++) {
        const n = bits[ra + qx[i]] + bits[ra + qx[i + 1]] + bits[rb + qx[i]] + bits[rb + qx[i + 1]];
        // white at that alpha, in either byte order — opaque white is 0xFFFFFFFF, as partSetMaskCanvas writes it
        if (n) px[o] = n === 4 ? 0xFFFFFFFF : ((((n * 255 + 2) >> 2) << 24) | 0xFFFFFF) >>> 0;
      }
    }
    const c = mkCanvas(D.w, D.h);
    ctx2d(c).putImageData(img, 0, 0, mx0, my0, mx1 - mx0 + 1, my1 - my0 + 1);
    return c;
  },
  // A closed outline in SHEET texels — a lasso, or the shape tool's path flattened.
  fromPoly(poly, op, desc){
    const sh = Marquee.sheet();
    if (!sh) { setStatus("Open a texture slot first", "err"); return false; }
    const S = Marquee.dims(sh.W, sh.H), fx = S.w / sh.W, fy = S.h / sh.H;
    const bits = SelShape.poly(poly.map(q => [q[0] * fx, q[1] * fy]), S.w, S.h);
    let ok = false;
    Marquee.act(desc || "lasso selection", () => { ok = Marquee.applyShape(bits, S, op); });
    return ok;
  },
  // A rectangle ADDED to or taken FROM the selection (Shift / Alt on a drag). A plain drag still
  // replaces through `set`, with its handles; a combined one becomes a shape, which has none.
  fromRect(r, op){
    const sh = Marquee.sheet();
    if (!sh) return false;
    const S = Marquee.dims(sh.W, sh.H), fx = S.w / sh.W, fy = S.h / sh.H;
    const bits = SelShape.rect(r.x * fx, r.y * fy, (r.x + r.w) * fx, (r.y + r.h) * fy, S.w, S.h);
    let ok = false;
    Marquee.act(op === "sub" ? "take a rectangle out of the selection" : "add a rectangle to the selection",
      () => { ok = Marquee.applyShape(bits, S, op); });
    return ok;
  },
  // A stencil at mask resolution, inside its box in sheet texels, ADDED to or taken FROM a selection
  // that is not an island pick — the UV island a Shift / Alt click takes when a rectangle, a lasso or
  // a wand's patch is what is selected. Inside the box because that is what an island pick of the
  // same island selects (`setIslands` sets exactly this pair), so the island adds the texels it
  // would select on its own. Runs inside the caller's step (`pickIsland` records its own).
  applyCanvas(m, box, op){
    const sh = Marquee.sheet();
    if (!sh || !m || !box) return false;
    const S = Marquee.dims(sh.W, sh.H), fx = S.w / sh.W, fy = S.h / sh.H;
    const bits = Marquee.canvasBits(m, S, Math.max(0, Math.floor(box.x * fx)), Math.max(0, Math.floor(box.y * fy)),
      Math.min(S.w, Math.ceil((box.x + box.w) * fx)), Math.min(S.h, Math.ceil((box.y + box.h) * fy)));
    return Marquee.applyShape(bits, S, op);
  },
  // Rows y0 … y0 + n − 1 of `img` at the selection's resolution `S`, as RGBA bytes. Each band is
  // blitted into a scratch of its own size and read back THERE: a read of the sheet itself transfers
  // the whole of an accelerated canvas whatever rectangle it names, and leaves the sheet read back,
  // which is what gets Chrome to demote it to the CPU where every later drawImage from it pays
  // (wt-canvas). Nearest, not smoothed: past 4096² a smoothed downscale would invent in-between
  // colours along every patch edge, a seam of texels no pick takes.
  //
  // The bands come from a COPY taken here, when the click is made, unless the caller says the sheet
  // cannot change (`still`, the stock sheet): a click reads over several frames, and a composite can
  // land in between — the Fill the click came straight after, a noise fill arriving from the pool —
  // so a sheet read half before it and half after gives a selection that is neither. Found landing
  // this (2026-09-26): a Fill, then a wand click on the next patch, and the recomposite the Fill had
  // queued landed between two bands of the click. One GPU-side copy, given back when the click is done.
  rowsOf(img, S, still){
    const ky = img.height / S.h;
    let from = img;
    if (!still) { from = mkCanvas(img.width, img.height); ctx2d(from).drawImage(img, 0, 0); }
    return (y0, n) => {
      const c = mkCanvas(S.w, n), g = ctx2d(c);
      g.imageSmoothingEnabled = false;
      g.drawImage(from, 0, y0 * ky, from.width, n * ky, 0, 0, S.w, n);
      return g.getImageData(0, 0, S.w, n).data;
    };
  },
  // The magic wand's work as steps: a BAND of the sheet read, matched and cut into runs per step,
  // then the flood (`SelShape`'s three steps). A generator so one piece of code runs straight through
  // (`fromColour`) or a band at a time with the page painting in between (`fromColourAsync`, which is
  // how a click runs it). Measured 2026-09-26 in headless Chrome, software raster, on a loaded
  // machine: read at the sheet's own 4096², a click in one piece held the page 203–259 ms for a patch
  // and 290–299 ms for the whole sheet, past §3.5's 200; a band at a time, its longest task was
  // 0–70 ms and 69–86 ms, over 222–249 and 323–362 ms of clock. At 2048² it is 74 ms for a patch.
  // `read(y0, n)` hands back rows at `S` — `rowsOf`, or what the 2-D view shows (`Draw2D.shownRows`).
  // Yields the share read so far; returns the selection's bytes, how many, and their box.
  //
  // With `edge` (the wand row's Edge box, 3.39 (2)) the rows of the box the flood took are read once
  // more, a band at a time with a row either side, for `SelShape.edge`'s ring: the progress runs to
  // a half for the match and on to the end for the ring. Only the box's rows — a patch's ring costs a
  // patch, and colour range over the whole sheet costs a second read, which is what it costs.
  *colourSteps(read, S, sx, sy, c, t, contig, edge){
    const m = new Uint8Array(S.w * S.h), R = SelShape.runs(m, S.w, S.h, null, 0, 0);
    const band = Math.max(1, Math.floor(Marquee.BAND / S.w)), share = edge ? .5 : 1;
    for (let y0 = 0; y0 < S.h; y0 += band) {
      const n = Math.min(band, S.h - y0);
      SelShape.near(read(y0, n), S.w * n, c, t, m, y0 * S.w);
      SelShape.runs(m, S.w, S.h, R, y0, y0 + n);          // colour range needs them too: its count and box
      yield share * (y0 + n) / S.h;
    }
    let got;
    if (!contig) got = Object.assign({ bits: m }, SelShape.tally(R, S.h));
    else { const info = {}; got = { bits: SelShape.walk(R, S.w, S.h, sx, sy, null, info), n: info.n, box: info.box }; }
    if (!edge || !got.box) return got;
    const out = got.bits.slice(), info = { n: got.n, box: { ...got.box } }, B = got.box;
    const ya = Math.max(0, B.y0 - 1), yb = Math.min(S.h, B.y1 + 2);
    for (let y0 = ya; y0 < yb; y0 += band) {
      const n = Math.min(band, yb - y0), r0 = Math.max(0, y0 - 1), r1 = Math.min(S.h, y0 + n + 1);
      SelShape.edge(read(r0, r1 - r0), S.w, S.h, r0, y0, y0 + n, got.bits, c, t, out, info);
      yield .5 + .5 * (y0 + n - ya) / (yb - ya);
    }
    return { bits: out, n: info.n, box: info.box };
  },
  // Where a wand click starts: the sheet, the resolution it is read at, the seed texel and its colour.
  // `src` is a canvas, or a row reader like `rowsOf`'s.
  colourJob(src, x, y, tol, contig, edge){
    const sh = Marquee.sheet();
    if (!sh || !src) { setStatus("Open a texture slot first", "err"); return null; }
    const S = Marquee.dims(sh.W, sh.H), fx = S.w / sh.W, fy = S.h / sh.H;
    const read = src.getContext ? Marquee.rowsOf(src, S) : src;
    const sx = Math.max(0, Math.min(S.w - 1, Math.floor(x * fx))), sy = Math.max(0, Math.min(S.h - 1, Math.floor(y * fy)));
    const row = read(sy, 1), o = sx * 4, c = [row[o], row[o + 1], row[o + 2], row[o + 3]];
    const t = Math.max(0, Math.min(255, Math.round(+tol || 0)));
    return { sh, S, fx, fy, c, contig, steps: Marquee.colourSteps(read, S, sx, sy, c, t, contig, edge) };
  },
  // …and where it ends: the bytes put in force as one undo step, and what the status line needs.
  colourDone(job, got, op){
    const res = { rgb: job.c.slice(0, 3), texels: Math.round(got.n / (job.fx * job.fy)), had: !!Marquee.rect(), ok: false };
    Marquee.act(job.contig ? "magic wand" : "colour range", () => { res.ok = Marquee.applyShape(got.bits, job.S, op, got.box); });
    return res;
  },
  // Every texel of `src` within `tol` of the colour at (x, y), in sheet texels: the magic wand with
  // `contig`, colour range without. Returns what was sampled, so the caller can say which colour it
  // took; null if it could not run.
  fromColour(src, x, y, tol, contig, op, edge){
    const job = Marquee.colourJob(src, x, y, tol, contig, edge);
    if (!job) return null;
    let st;
    do st = job.steps.next(); while (!st.done);
    return Marquee.colourDone(job, st.value, op);
  },
  // The same, a band at a time with the page painting in between (`progTick`), which is how a click
  // runs it. `bar` is SelectUI's progress bar — it opens only if the click is still reading at 200 ms
  // — and a cancel there ends it with nothing changed. Null too when the sheet was switched or resized
  // under it, since its bytes would then describe another texture.
  async fromColourAsync(src, x, y, tol, contig, op, bar, edge){
    const job = Marquee.colourJob(src, x, y, tol, contig, edge);
    if (!job) return null;
    let st;
    while (!(st = job.steps.next()).done) {
      if (bar) bar.tick(st.value);
      await progTick();
      if (bar && bar.cancelled()) return null;
      const now = Marquee.sheet();
      if (!now || now.s !== job.sh.s || now.W !== job.sh.W || now.H !== job.sh.H) return null;
    }
    return Marquee.colourDone(job, st.value, op);
  },
  // What the shape in force is, for a status line. `islands` is null for every shape that is not an
  // island pick — a mask's, a lasso's, a wand's — and the verbs used to read `.size` off it
  // unconditionally, so Fill, Clear and Crop threw after doing their work on any of those.
  shapeWord(){
    if (!Marquee.shape()) return "";
    return Marquee.islands ? Marquee.islands.size + " UV island(s) inside " : "the selected shape inside ";
  },

  // ---- the verbs ----
  // All four go through the same paintTarget() a stroke does, so "fill the selection" writes to a
  // Smoothness layer when a Smoothness brush is up, and refuses for the same reasons and in the
  // same words a stroke would. Anything else would be a second answer to "where does paint go".
  target(verb, mayCreate){
    const r = Marquee.rect();
    if (!r) { setStatus("Make a selection first — turn Select on and drag a rectangle in the 2-D view", "err"); return null; }
    let t = paintTarget();
    if (!t) { setStatus("Select a texture slot first", "err"); return null; }
    if (t.height) { setStatus("Panel line carves along a stroke — it has no “" + verb + "”. Pick another tool.", "err"); return null; }
    if (t.need) {
      if (!mayCreate) { setStatus("Select a paint layer to " + verb + " — this would have nothing to work on", "err"); return null; }
      if (!createPaintLayerFor(t.need)) { setStatus("Select a texture slot first", "err"); return null; }
      t = paintTarget();
      if (!t || t.err || t.need) { setStatus((t && t.err) || "Could not create a layer for this tool", "err"); return null; }
    }
    if (t.err) { setStatus(t.err, "err"); return null; }
    return { t, r, s: App.activeSlot };
  },
  // The layer's pixels are the size of the sheet its channel composites into, which is not always
  // the albedo's size — the selection is in albedo texels, so it is scaled into whichever sheet the
  // verb is about to write.
  //
  // **A texel of that sheet belongs to the selection holding its CENTRE**, and a centre that falls
  // exactly on the line between two albedo texels — every texel's does, on a layer half the albedo's
  // size — goes to the texel before the line. `cut` samples a shape by that rule (`Marquee.under`),
  // and this is the same rule applied to the box: both ENDS are rounded, half up, and the width is
  // what lies between them. It used to round the width on its own, while `cut` sent a tie the other
  // way — two rules that agree on a layer the albedo's size and disagree by a texel at every odd edge
  // on a smaller one. Smoothness, metalness and normal layers are the _n's size, which is half the
  // albedo in the game's own files: there a wand patch starting on an odd texel lost its first texel,
  // and two patches meeting on one, filled one after the other, left the texel they share to neither
  // — α 0 in the middle of a recolour, and Clear left it standing (review of 4.50 (9), second round,
  // 2026-09-26; before the first round's fixes the same fills tiled a 2048² _n and left α 127 on a
  // 1024² one). A rectangle of odd width at an odd texel also took a texel whose centre is outside
  // it, the one its neighbour starts on.
  // Integer arithmetic, so a tie is a tie at any pair of sizes and falls the same way here and in `cut`.
  // At the albedo's own size it is `r` itself, as it always was.
  inTarget(r, t, s){
    const T = t.canvas.width, U = t.canvas.height, W = s.composite.width, H = s.composite.height;
    const end = (v, n, m) => Math.floor((2 * v * n + m) / (2 * m));      // round(v · n / m), half up
    const x = Math.min(T - 1, end(r.x, T, W)), y = Math.min(U - 1, end(r.y, U, H));
    return { x, y, w: Math.max(1, end(r.x + r.w, T, W) - x), h: Math.max(1, end(r.y + r.h, U, H) - y) };
  },
  // The selection texel under the centre of texel `t` of a sheet `m` texels across, when the selection
  // is `n` across: the centre is at (t + ½) · n / m, and on a tie the texel before it — `inTarget`'s
  // rule. Exact: ((2t + 1) · n − 1) / 2m in whole numbers, so no pair of sizes can round a tie either way.
  under(t, n, m){ return Math.min(n - 1, Math.floor(((2 * t + 1) * n - 1) / (2 * m))); },
  // What a selection does to a stroke: the same shape as the layer-scope block in beginStroke —
  // start from "everywhere" if nothing has built a stencil yet, then keep only what is inside.
  // The rectangle is in albedo texels and the stencil is at mask resolution, so the edges are
  // floored and ceiled onto whole stencil pixels: a fractional fillRect is antialiased, and the
  // selection would fade out over its last texel rather than ending.
  clipStroke(st, s){
    const mq = Marquee.rect();
    if (!st || !mq || !s || !s.composite) return false;
    const fresh = !st.maskCanvas;
    const mc = strokeMaskCanvas(), g = ctx2d(mc);
    if (fresh) { g.fillStyle = "#fff"; g.fillRect(0, 0, mc.width, mc.height); }
    st.masking = true; st.maskFixed = true;
    const kx = mc.width / s.composite.width, ky = mc.height / s.composite.height;
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "#fff";
    g.fillRect(Math.floor(mq.x * kx), Math.floor(mq.y * ky),
      Math.max(1, Math.ceil(mq.w * kx)), Math.max(1, Math.ceil(mq.h * ky)));
    // An island selection is the rectangle AND its shape, so it takes a second destination-in. The
    // rectangle step is then redundant (the box bounds the shape) and is kept anyway: it costs one
    // fillRect and it means this function has one shape, not two.
    if (Marquee.mask) g.drawImage(Marquee.mask, 0, 0, mc.width, mc.height);
    g.globalCompositeOperation = "source-over";
    st.maskData = null;
    return true;
  },
  // The same shield a stroke gets: the part selection, minus anything protected, minus anything
  // outside the layer's own part scope. Returned at mask resolution (what partSetMaskCanvas builds)
  // or null when nothing is in force.
  //
  // Only FILL uses it, and that asymmetry is the rule rather than an oversight: the shield exists to
  // stop paint landing on parts you did not choose, and clear / crop only ever take away pixels this
  // layer already owns — a crop that left pixels outside the rectangle because a part was protected
  // would not be a crop. `beginStroke` composes these same three pieces inline (it has to, because
  // it also decides whether to REFUSE the stroke when the shield comes out empty); t59 asserts the
  // two agree pixel for pixel, so the rule cannot drift into two rules.
  confine(s, L, w, h){
    if (!s) return null;
    // The model is needed for the PART halves — a selection and the protected set are both lists of
    // part names — but not for a layer's limit, which since 4.28(g) can be a rectangle and means
    // exactly the same thing with no vehicle open. Returning null on `!App.geomData` refused a
    // rectangle for a reason that is true of something else.
    const geom = !!App.geomData;
    const prot = geom ? [...App.protectedParts].filter(n => App.matSlot.get((App.meshes.get(n) || { userData: {} }).userData.mat) === s.id) : [];
    const names = geom ? [...App.selParts].filter(n => !App.protectedParts.has(n)) : [];
    const scope = Scope.empty(Scope.of(L)) ? null : Scope.stencil(s, L);
    const sel = geom && App.selParts.size;
    if (!sel && !prot.length && !scope) return null;
    const D = maskDims(w, h);
    const mc = mkCanvas(D.w, D.h), g = ctx2d(mc);
    if (sel) {
      const pm = names.length ? partSetMaskCanvas(s, w, h, names) : null;
      if (pm) g.drawImage(pm, 0, 0, mc.width, mc.height);
      // Every selected part protected too, or none of them on this sheet: an empty shield, which
      // means "nothing here is yours to paint" — not "paint everywhere".
    } else { g.fillStyle = "#fff"; g.fillRect(0, 0, mc.width, mc.height); }
    if (prot.length) {
      const pm = partSetMaskCanvas(s, w, h, prot, 0);
      if (pm) { g.globalCompositeOperation = "destination-out"; g.drawImage(pm, 0, 0, mc.width, mc.height); }
    }
    if (scope) { g.globalCompositeOperation = "destination-in"; g.drawImage(scope, 0, 0, mc.width, mc.height); }
    g.globalCompositeOperation = "source-over";
    return mc;
  },
  // The shape in force over `rr` — a rectangle in `target`'s own pixels — as a canvas the size of
  // `rr` whose alpha IS the shape there: what all four verbs cut with. Kept OUT of `confine`
  // deliberately: t59 asserts confine equals the shield `beginStroke` composes inline, and a stroke
  // meets the shape by a different road — `clipStroke`, the selection's own clip.
  //
  // A shape held as bytes (`ownBits`) is cut TEXEL-EXACT: each target texel takes the selection texel
  // under its centre (`under`), in or out, so no texel a verb writes is partial, and two patches that
  // meet anywhere share no texel and leave none out between them — on a layer of any size, because
  // `inTarget` gives the verbs their region by the same rule. An island pick and a mask's shape are
  // only a stencil at mask resolution — an island's antialiased and grown into the gutter by
  // construction — and are drawn up to the target as they always were.
  cut(target, rr){
    const shp = Marquee.shape();
    if (!shp) return null;
    const c = mkCanvas(rr.w, rr.h), g = ctx2d(c), own = Marquee.ownBits();
    if (!own) {
      const kx = shp.width / target.width, ky = shp.height / target.height;
      g.drawImage(shp, rr.x * kx, rr.y * ky, rr.w * kx, rr.h * ky, 0, 0, rr.w, rr.h);
      return c;
    }
    const S = own.S, TW = target.width, TH = target.height;
    const img = new ImageData(rr.w, rr.h), px = new Uint32Array(img.data.buffer), xs = new Int32Array(rr.w);
    for (let x = 0; x < rr.w; x++) xs[x] = Marquee.under(rr.x + x, S.w, TW);
    for (let y = 0, o = 0; y < rr.h; y++) {
      const row = Marquee.under(rr.y + y, S.h, TH) * S.w;
      for (let x = 0; x < rr.w; x++, o++) if (own.bits[row + xs[x]]) px[o] = 0xFFFFFFFF;
    }
    g.putImageData(img, 0, 0);
    return c;
  },
  after(t, s, L){
    return () => {
      if (L) { L._thumb = null; L._thumbRev = -1; }
      t.chan ? scheduleChannels(s, null) : scheduleComposite(s, null);
      refreshLayerList();
      draw2D();
    };
  },
  // Wrapped in one undo batch because it may have to CREATE the layer first, and "add layer" plus
  // "fill" is two Ctrl+Z for one click — with the first one leaving a bare empty layer nobody asked
  // for. `beginStroke` solves the same problem by hand (it pops the add and re-pushes it merged);
  // a batch is what that hand-rolled merge should have been, and it costs one line here.
  fill(){ withUndoBatch("fill selection", () => Marquee.fillNow()); },
  fillNow(){
    const g0 = Marquee.target("fill", true);
    if (!g0) return;
    const { t, r, s } = g0, L = activeLayerObj();
    const b = App.brush, rr = Marquee.inTarget(r, t, s);
    // A mask holds its meaning in ALPHA, so filling one is the brush's own rule written once more:
    // value ≥ 128 reveals (opaque white), below it hides (erase). Everything else is one flat
    // colour at the brush's own opacity — the same knob the stroke uses.
    const hide = (t.mask && b.value < 128) || t.erase;
    const col = t.mask ? "#fff" : t.chan ? "rgb(" + b.value + "," + b.value + "," + b.value + ")" : b.color;
    const shield = Marquee.confine(s, L, t.canvas.width, t.canvas.height), cut = Marquee.cut(t.canvas, rr);
    bakeRegionAction(t.mask ? "fill selection on the mask" : "fill selection", [t.canvas], rr, () => {
      const g = ctx2d(t.canvas);
      g.globalCompositeOperation = hide ? "destination-out" : "source-over";
      g.globalAlpha = hide ? 1 : Math.min(1, b.opacity);
      g.fillStyle = col;
      if (!shield && !cut) g.fillRect(rr.x, rr.y, rr.w, rr.h);
      else {
        // Cut the rectangle out of the shield and the shape first and blit the result, rather than
        // clipping the target: one scratch the size of the selection, and no antialiased clip edge.
        const sc = mkCanvas(rr.w, rr.h), sg = ctx2d(sc);
        sg.fillStyle = col; sg.fillRect(0, 0, rr.w, rr.h);
        sg.globalCompositeOperation = "destination-in";
        if (shield) {
          const kx = shield.width / t.canvas.width, ky = shield.height / t.canvas.height;
          sg.drawImage(shield, rr.x * kx, rr.y * ky, rr.w * kx, rr.h * ky, 0, 0, rr.w, rr.h);
        }
        if (cut) sg.drawImage(cut, 0, 0);
        g.drawImage(sc, rr.x, rr.y);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }, Marquee.after(t, s, L));
    setStatus((hide ? "Cleared " : "Filled ") + Marquee.shapeWord() +
      rr.w + " × " + rr.h + " texels of “" + (L ? L.name : "the layer") + "”" +
      (shield ? " — inside the part selection / layer scope, like the brush" : ""), "ok");
  },
  erase(){
    const g0 = Marquee.target("clear", false);
    if (!g0) return;
    const { t, r, s } = g0, L = activeLayerObj();
    const rr = Marquee.inTarget(r, t, s), cut = Marquee.cut(t.canvas, rr);
    bakeRegionAction("clear selection", [t.canvas], rr, () => {
      const g = ctx2d(t.canvas);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      if (!cut) g.clearRect(rr.x, rr.y, rr.w, rr.h);
      else {
        // The shape's own texels and nothing else: one destination-out of it, over exactly the box
        // that bounds it. The region undo pays for is still the box, which is the smallest
        // rectangle that can contain what changed.
        g.globalCompositeOperation = "destination-out";
        g.drawImage(cut, rr.x, rr.y);
        g.globalCompositeOperation = "source-over";
      }
    }, Marquee.after(t, s, L));
    setStatus("Cleared " + Marquee.shapeWord() +
      rr.w + " × " + rr.h + " texels of “" + (L ? L.name : "the layer") + "”", "ok");
  },
  // Crop = clear everything outside. The four bands ARE the region that changes, so this is one
  // undo entry costing the pixels it really touched rather than a snapshot of the whole sheet.
  crop(){
    const g0 = Marquee.target("crop", false);
    if (!g0) return;
    const { t, r, s } = g0, L = activeLayerObj();
    const rr = Marquee.inTarget(r, t, s), cut = Marquee.cut(t.canvas, rr);
    const bands = Marquee.outside(rr, t.canvas.width, t.canvas.height);
    if (!bands.length && !cut) { setStatus("The selection is the whole sheet — there is nothing outside it to crop away", "err"); return; }
    // With a shape, the box itself changes too — everything in it the island does not cover goes —
    // so the region is the bands plus the box. That is honestly most of the sheet, and it is what
    // cropping to an island costs; the bands-only accounting stays exact for a rectangle.
    bakeRegionAction("crop to selection", [t.canvas], cut ? bands.concat([rr]) : bands, () => {
      const g = ctx2d(t.canvas);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      for (const b of bands) g.clearRect(b.x, b.y, b.w, b.h);
      if (cut) {
        // The shape's own inverse, built in a scratch the size of the box and taken away in one
        // destination-out. A `ctx.clip()` would be the obvious way and it is antialiased, which
        // would leave a half-erased seam one texel wide around every island edge.
        const sc = mkCanvas(rr.w, rr.h), sg = ctx2d(sc);
        sg.fillStyle = "#fff"; sg.fillRect(0, 0, rr.w, rr.h);
        sg.globalCompositeOperation = "destination-out";
        sg.drawImage(cut, 0, 0);
        g.globalCompositeOperation = "destination-out";
        g.drawImage(sc, rr.x, rr.y);
        g.globalCompositeOperation = "source-over";
      }
    }, Marquee.after(t, s, L));
    setStatus("Cropped “" + (L ? L.name : "the layer") + "” to " +
      Marquee.shapeWord() + rr.w + " × " + rr.h + " texels", "ok");
  },
  // "Copy this rectangle" becomes an image layer, because that is the only thing in this app that
  // holds loose pixels you can then move, rotate, mirror and project. It lands exactly where it was
  // taken from, at scale 1 — so the copy is invisible until you move it, which is what you want.
  copy(){
    const r = Marquee.rect(), s = App.activeSlot;
    if (!r || !s) { setStatus("Make a selection first — turn Select on and drag a rectangle in the 2-D view", "err"); return; }
    const L = activeLayerObj();
    // WHICH CHANNEL (ROADMAP 4.34(b)). This used to read `L.canvas` — the active layer's PRIMARY
    // content, whatever channel that was — and then build the new layer with no `chan` at all, so
    // a rectangle copied off a smoothness layer arrived as smoothness pixels on the albedo. Silent
    // wrong output, and exactly what 4.25 had already ruled out for the paste path: "the sources
    // are per CHANNEL, which is why a packed _n can never arrive as colour — it is not a check,
    // there is no such source". A copy is a source too.
    const ch = LayerNode.workingChan(L);
    const mine = L && !isGroup(L) ? LayerNode.contentOn(L, ch) : null;
    const from = (mine && mine.kind === "paint" && mine.canvas) ? mine.canvas :
                 (chanOut(s, ch) || s.composite);
    const rr = Marquee.inTarget(r, { canvas: from }, s);
    const c = mkCanvas(rr.w, rr.h);
    ctx2d(c).drawImage(from, rr.x, rr.y, rr.w, rr.h, 0, 0, rr.w, rr.h);
    // An island copy carries the island's silhouette, not its bounding box — otherwise "copy this
    // shell" would hand back a rectangle of its neighbours as well.
    const cut = Marquee.cut(from, rr);
    if (cut) {
      const g = ctx2d(c);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(cut, 0, 0);
      g.globalCompositeOperation = "source-over";
    }
    // `scale` is in COMPOSITE texels — every decal draw multiplies it by (target size / composite
    // size) — while `rr` is in the source sheet's own pixels. Those agreed only while every source
    // was the slot's own size, which is why 4.34 recorded the mismatch as latent. It is live the
    // moment a copy can come off a surface channel: the _n is routinely half the albedo, and a
    // copy at scale 1 would land at half the size of the texels it was made from.
    addLayer(LayerNode.of({ type: "decal", chan: ch === "color" ? undefined : ch,
      name: "Copy " + rr.w + "×" + rr.h, bmp: c, visible: true, opacity: 1, blend: "normal",
      x: (r.x + r.w / 2) / s.composite.width, y: (r.y + r.h / 2) / s.composite.height,
      scale: r.w / rr.w, rot: 0, flip: false }));
    syncDecalUI();
    // The copy lands IN PLACE, which is the point of it and also why this button was reported on
    // 2026-09-02 as one that "does not seem to do anything by itself": a new layer sitting exactly
    // over the pixels it was made from changes not one texel on screen. Every other way of adding
    // an image arms a placing mode and puts a ghost on the cursor, so this is the one that has to
    // say out loud that it worked and that the sameness is the expected result.
    setStatus("Copied " + rr.w + " × " + rr.h + " texels of " + Tool.chanWord(ch) + " out of " +
      (mine ? "“" + L.name + "”" : "the flattened sheet") +
      " into a new image layer on the same channel, sitting exactly on top of what it came from — so nothing looks different yet. " +
      "Drag it in the 2-D view, or use “Project onto model” to put it on the surface.", "ok");
  },
};
