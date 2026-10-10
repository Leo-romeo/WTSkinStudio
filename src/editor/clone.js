/*==CLONE==*/
"use strict";
// ---------- The Clone brush: paint with pixels from somewhere else on the same sheet ----------
// ROADMAP 4.44, fourth candidate. Every game albedo carries rivets, panel lines and dirt worth
// copying to where a marking was removed, and since 2022 the normal map carries the same lines as
// bumps. The stroke machinery is the ordinary one (4.28(d)): what changes is where a stamp's
// pixels come from. Alt+click sets the SOURCE; the first stamp of the next stroke fixes the OFFSET
// between source and destination, and every stamp after it — in that stroke and the ones that
// follow, until the source is set again — copies the sheet at "here + offset". That is Photoshop's
// aligned clone, and it is the only mode there is: the unaligned one (every stroke restarts from
// the source) is Alt+click again.
//
// **The stroke reads the sheet as it was when the stroke began, never its own output.** The
// composite is rebuilt under the stroke every frame, so a stamp that read it live would, whenever
// the offset is shorter than the brush, copy what the previous frame of the same stroke had just
// put down — a smear that walks away from the source. Photoshop snapshots the document at
// mousedown. Copying a 4096² sheet at mousedown is the 47 ms first-frame stall `t47` was written
// to remove, so the snapshot here is lazy and by tile, with one rule that makes it exact: **a tile
// is copied before anything of this stroke reaches it.** `stampAt` calls `ensure` over the
// destination of every stamp before that stamp's frame composites, and over the source before it
// is read; a tile no stamp has touched still equals the pre-stroke sheet, so copying it on first
// read is the same as having copied it at mousedown. `tools/t70_clone.mjs` holds this by cloning
// a gradient over itself with an offset shorter than the brush.
//
// **Heal is the same tool with the tone matched.** A rivet copied from a sunlit panel onto a
// shaded one carries the sunlit grey with it; with *Match tone* on, each stamp is shifted by the
// difference between the mean of the destination and the mean of the source under the brush,
// before the brush's own alpha cuts it out. That is the first-order approximation of a healing
// brush (Photoshop solves a Poisson problem; this shifts by a constant), and at brush spacing it
// is enough: the overlapping stamps average the steps out. Both means are read off the same
// pre-stroke copy, for the same reason the pixels are.
//
// Source and offset live on the SLOT, in its composite's pixels — a sheet's coordinates, not a
// layer's — so a colour layer smaller than the sheet (which `rectToSlot` allows) clones from the
// right place, and the 2-D view can draw the marker without knowing which layer is in hand.
const Clone = {
  TILE: 256,
  source(slot){ return (slot && slot._cloneSrc) || null; },
  // Alt+click, in either view. `x, y` in the slot's composite pixels. Resets the offset, which
  // is what makes the next stroke start FROM here rather than continue the last one's alignment.
  pick(slot, x, y){
    if (!slot || !slot.composite) return false;
    const W = slot.composite.width, H = slot.composite.height;
    slot._cloneSrc = { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)), off: [null, null] };
    setStatus("Clone source set — paint where the copy should go. Alt-click again to move the source.", "ok");
    return true;
  },
  // What a stroke needs, built at its start: the live sheet it copies from (the composite for
  // colour, the channel's own composite otherwise — flushed first, so it IS what is on screen), a
  // pooled full-size copy the tiles land in, and the source point and any offset an earlier
  // stroke fixed, converted into this layer's pixels. Pooled like `strokeBuffer`, and for the same
  // reason: a 4096² allocation per mousedown is the stall the pool exists to avoid.
  begin(t, slot, chan){
    const pick = Clone.source(slot);
    if (!pick) return null;
    flushComposites();
    const live = chan === "color" ? slot.composite : chanOut(slot, chan);
    // Unreachable past `paintTarget`, which has already found this channel's base; said loudly
    // rather than painting the white stamp the brush would otherwise fall through to.
    if (!live) throw new Error("Clone: no " + chan + " sheet to copy from on “" + slot.id + "”");
    const W = t.canvas.width, H = t.canvas.height;
    let sheet = Clone._sheet;
    if (!sheet || sheet.width !== W || sheet.height !== H) sheet = Clone._sheet = mkCanvas(W, H);
    const g = ctx2d(sheet);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    const lx = W / slot.composite.width, ly = H / slot.composite.height;   // composite px -> layer px
    return { live, sheet, kx: live.width / W, ky: live.height / H, lx, ly, copied: new Set(), pick,
      src: { x: pick.x * lx, y: pick.y * ly },
      off: pick.off.map(o => o ? { x: o.x * lx, y: o.y * ly } : null),
      wrap: CamoTile.is(slot) };                      // a camouflage tile has no outside to read (`read`)
  },
  // Copy the tiles under a rectangle from the live sheet into the stroke's copy, once each.
  ensure(cl, x, y, w, h){
    const T = Clone.TILE, W = cl.sheet.width, H = cl.sheet.height;
    const t0x = Math.max(0, Math.floor(x / T)), t1x = Math.min(Math.floor((x + w) / T), Math.ceil(W / T) - 1);
    const t0y = Math.max(0, Math.floor(y / T)), t1y = Math.min(Math.floor((y + h) / T), Math.ceil(H / T) - 1);
    if (t1x < t0x || t1y < t0y) return;
    const g = ctx2d(cl.sheet);
    for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
      const k = tx + "," + ty;
      if (cl.copied.has(k)) continue;
      cl.copied.add(k);
      const px = tx * T, py = ty * T, pw = Math.min(T, W - px), ph = Math.min(T, H - py);
      g.clearRect(px, py, pw, ph);
      g.drawImage(cl.live, px * cl.kx, py * cl.ky, pw * cl.kx, ph * cl.ky, px, py, pw, ph);
    }
  },
  // The size² square of the stroke's copy with its corner at (x, y), drawn into `g` at the origin,
  // its tiles copied from the live sheet first. A square partly off an ordinary sheet is clipped
  // by the canvas, and that part of the patch stays clear. A camouflage tile (4.50 (6)) has no
  // outside: there the square is read from the sheet's repetition, a piece from each copy it
  // overlaps, so a source that runs over an edge carries on from the opposite one. Measured before
  // this (review, 2026-09-26): aligned 50 texels left of its source on a 256² tile, a stroke dragged
  // from x = 230 over the right edge copied up to x = 2 and then left x = 12–30 as they were, where
  // the brush on the same path painted them. The pieces go whole texel for whole texel into a
  // scratch one texel larger, and the patch is read from that at the sub-texel offset: pieces
  // meeting at a fractional edge would each cover it in part, and two partial coverages never sum
  // to a whole (wt-canvas).
  read(cl, g, x, y, size){
    if (!cl.wrap) {
      Clone.ensure(cl, x, y, size, size);
      g.drawImage(cl.sheet, x, y, size, size, 0, 0, size, size);
      return;
    }
    const W = cl.sheet.width, H = cl.sheet.height, ix = Math.floor(x), iy = Math.floor(y), n = size + 1;
    const pc = Clone.buf(4, n), pg = ctx2d(pc);
    pg.globalCompositeOperation = "source-over"; pg.globalAlpha = 1;
    pg.clearRect(0, 0, n, n);
    for (let py = 0; py < n; ) {
      const sy = (((iy + py) % H) + H) % H, h = Math.min(H - sy, n - py);
      for (let px = 0; px < n; ) {
        const sx = (((ix + px) % W) + W) % W, w = Math.min(W - sx, n - px);
        Clone.ensure(cl, sx, sy, w, h);
        pg.drawImage(cl.sheet, sx, sy, w, h, px, py, w, h);
        px += w;
      }
      py += h;
    }
    g.drawImage(pc, x - ix, y - iy, size, size, 0, 0, size, size);
  },
  // Scratch canvases the size of a stamp — the patch being built, for heal the destination under
  // it, the brush's weights and `read`'s pieces — grown as the brush grows and never freed, like
  // `stampClipBuf`.
  buf(i, size){
    const key = "_buf" + i;
    let c = Clone[key];
    if (!c || c.width < size || c.height < size) c = Clone[key] = mkCanvas(Math.max(size, 128), Math.max(size, 128));
    return c;
  },
  // The brush's alpha as bytes, one per texel of the stamp, cached against the stamp canvas
  // itself — `brushStamp` makes a new canvas whenever any of its inputs change, so identity is
  // the key without this module having to know what the inputs are. A TURNED dab (ROADMAP
  // 4.50 (10)) is redrawn into one scratch canvas by `Tips.shape`, dab after dab, which counts its
  // redraws in `_v`: identity alone would hand every turned dab the first one's weights.
  weights(alpha, size){
    if (Clone._wOf === alpha && Clone._w && Clone._wSize === size && Clone._wV === alpha._v) return Clone._w;
    const c = Clone.buf(3, size), g = ctx2d(c);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.clearRect(0, 0, size, size);
    Clone.lay(g, alpha, size);
    const d = g.getImageData(0, 0, size, size).data, w = new Uint8ClampedArray(size * size);
    for (let i = 0, p = 3; i < w.length; i++, p += 4) w[i] = d[p];
    Clone._wOf = alpha; Clone._wSize = size; Clone._wV = alpha._v; Clone._w = w;
    return w;
  },
  // The brush's alpha drawn over a patch `size` across: all of a stamp, or the top-left `_side`
  // square of `Tips.shape`'s scratch, which is made for the largest dab and so is usually bigger.
  lay(g, alpha, size){
    const k = alpha._side;
    if (k) g.drawImage(alpha, 0, 0, k, k, 0, 0, size, size);
    else g.drawImage(alpha, 0, 0, size, size);
  },
  // One stamp: the source patch, tone-matched if asked, cut to the brush's alpha and the stroke's
  // stencil, laid into the stroke buffer at the destination. `ch` is the stroke's channel — 0 the
  // stroke, 1 its mirror — and each fixes its own offset from the same source, because the
  // mirror's first stamp lands wherever the model's other side put it.
  //
  // `at` is where the BRUSH is when that differs from where the dab lands — a scattered dab (ROADMAP
  // 4.50 (10)) — given in the same copy of the sheet as (x, y), and it is what fixes the offset, so
  // the source keeps step with the brush and the dashed ring rather than with the first dab's random
  // throw.
  //
  // `rep` is set on a camouflage tile (ROADMAP 4.50 (6)), whose every dab is stamped once per copy
  // of the sheet it touches: it is how far THIS copy sits from the one inside the sheet. Every copy
  // takes the one source patch — the offset is fixed, and the source read, at the copy inside — so
  // the halves of a dab split by an edge are one patch; and `read` takes that patch from the tile's
  // repetition, so a source that crosses an edge is not cut at it either. Measured before `rep`: the
  // copy left of the sheet came first, fixed the offset a period out, and a clone stroke started at
  // x = 250 of a 256² tile painted nothing at 250.
  stamp(cl, bg, x, y, ch, r, size, alpha, mask, mk, at, rep){
    const ox = rep ? rep.x : 0, oy = rep ? rep.y : 0;
    let off = cl.off[ch];
    if (!off) {
      const a = at || { x, y };
      off = cl.off[ch] = { x: cl.src.x - (a.x - ox), y: cl.src.y - (a.y - oy) };
      cl.pick.off[ch] = { x: off.x / cl.lx, y: off.y / cl.ly };  // kept on the slot: the next stroke stays aligned
    }
    const dx = x - r, dy = y - r, sx = dx - ox + off.x, sy = dy - oy + off.y;
    Clone.ensure(cl, dx, dy, size, size);          // the destination, before this stamp's frame composites it
    const tmp = Clone.buf(1, size), tg = ctx2d(tmp);
    tg.globalCompositeOperation = "source-over"; tg.globalAlpha = 1;
    tg.clearRect(0, 0, tmp.width, tmp.height);
    // A source rectangle partly off the sheet is clipped by the canvas, and the destination with
    // it in proportion, so the patch keeps its alignment and the part that fell off stays clear —
    // on any sheet but a tile, which has no outside (`read`).
    Clone.read(cl, tg, sx, sy, size);              // the source, its tiles copied before it is read
    if (App.brush.heal) Clone.matchTone(tg, cl, dx, dy, size, alpha);
    tg.globalCompositeOperation = "destination-in";
    Clone.lay(tg, alpha, size);
    if (mask) tg.drawImage(mask, dx * mk.x, dy * mk.y, size * mk.x, size * mk.y, 0, 0, size, size);
    tg.globalCompositeOperation = "source-over";
    bg.drawImage(tmp, 0, 0, size, size, dx, dy, size, size);
  },
  // Shift the patch by (mean of the destination − mean of the source), each mean taken over the
  // texels the brush reaches and weighted by its alpha, and only where both sheets have a texel.
  matchTone(tg, cl, dx, dy, size, alpha){
    const S = tg.getImageData(0, 0, size, size), s = S.data;
    const dc = Clone.buf(2, size), dg = ctx2d(dc);
    dg.globalCompositeOperation = "source-over"; dg.globalAlpha = 1;
    dg.clearRect(0, 0, size, size);
    Clone.read(cl, dg, dx, dy, size);              // on a tile, the whole destination: every copy of a dab shifts alike
    const d = dg.getImageData(0, 0, size, size).data;
    const w = Clone.weights(alpha, size);
    let n = 0, sr = 0, sg = 0, sb = 0, dr = 0, dg2 = 0, db = 0;
    for (let i = 0, p = 0; i < w.length; i++, p += 4) {
      const k = w[i];
      if (!k || s[p + 3] < 128 || d[p + 3] < 128) continue;
      n += k;
      sr += s[p] * k; sg += s[p + 1] * k; sb += s[p + 2] * k;
      dr += d[p] * k; dg2 += d[p + 1] * k; db += d[p + 2] * k;
    }
    if (!n) return;
    const tr = (dr - sr) / n, tg2 = (dg2 - sg) / n, tb = (db - sb) / n;
    if (!tr && !tg2 && !tb) return;
    for (let p = 0; p < s.length; p += 4) {
      if (!s[p + 3]) continue;
      s[p] = s[p] + tr; s[p + 1] = s[p + 1] + tg2; s[p + 2] = s[p + 2] + tb;   // clamped by the array
    }
    tg.putImageData(S, 0, 0);
  },
};
/*==ENDCLONE==*/
