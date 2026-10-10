// ---------- 2D view ----------
// `fit` starts on: the sheet is framed in the pane and stays framed while the pane changes size.
// Zooming or panning turns it off, so the view only ever re-frames itself when you have not
// positioned it yourself.
const v2 = { sc: .3, ox: 40, oy: 40, uvOn: false, panning: false, space: false, draggingDecal: false, fit: true, cursor: null, lazy: null,
             projCur: "" };   // the handle cursor Draw2D.projPointer put on the sheet, so it can take it back
const cnv2 = $("view2d");
function resize2D(){
  const wrap = $("view2dwrap");
  const w = Math.max(1, Math.round(wrap.clientWidth * devicePixelRatio));
  const h = Math.max(1, Math.round(wrap.clientHeight * devicePixelRatio));
  // Assigning canvas.width CLEARS the canvas, even when the value does not change. A sidebar
  // drag fires pointermove several times per frame, so every one of those cleared the sheet and
  // left it blank until the next animation frame — that is the flicker. Only touch the size when
  // it really changed, and repaint synchronously so no blank frame can reach the screen.
  if (cnv2.width === w && cnv2.height === h) return;
  cnv2.width = w; cnv2.height = h;
  if (v2.fit) fit2DNow(); else draw2DNow();
}
function fit2DNow(){
  const s = App.activeSlot;
  if (!s || !s.composite) return;
  const w = cnv2.width, h = cnv2.height;
  if (w < 2 || h < 2) return;                     // pane is hidden — a zero scale would break panning
  // A camouflage tile is framed smaller, so a band of its repeats shows all round it (4.50 (6)).
  v2.sc = Math.min(w / s.composite.width, h / s.composite.height) * (CamoTile.is(s) ? .6 : .92);
  v2.ox = (w - s.composite.width * v2.sc) / 2; v2.oy = (h - s.composite.height * v2.sc) / 2;
  draw2DNow();
}
function fit2D(){ v2.fit = true; fit2DNow(); syncFitBtn(); }
function syncFitBtn(){ const b = $("btnFit"); if (b) b.classList.toggle("active", !!v2.fit); }
// Any deliberate zoom / pan means "I have framed this myself" — stop re-fitting on resize.
function freeView2D(){ if (!v2.fit) return; v2.fit = false; syncFitBtn(); }
// Repaints are coalesced to one per frame: a brush stroke used to ask for a full 2D repaint per
// stamp, several times inside a single frame, on a canvas the size of the pane.
let draw2Pending = false;
function draw2D(){
  if (draw2Pending) return;
  draw2Pending = true;
  // The Export window's crop follows what this view shows, so a redraw is its cue (3.29). Cheap
  // when the window is shut, and coalesced on its side.
  requestAnimationFrame(() => { draw2Pending = false; draw2DNow(); ExportPreview.schedule(); });
}
// ---------- One frame of the 2-D view, as named steps on one object ----------
// ROADMAP 2.4. `draw2DNow` was 134 lines: six things drawn one over the other, sharing a context, a
// source canvas and eight numbers describing the visible window. The eight become `D` — the window,
// with the blit that reads through it — and each thing drawn becomes a method. Same move as
// `Composite`, `DecalEd`, `LayerProps` and `ExportRun`, on ONE object rather than a dozen new
// globals (§4).
//
// The frame-scratch caches stay hung off `draw2D` where they were: each is keyed and read by exactly
// one phase, and moving them would be a second change riding along with this one.
const Draw2D = {
  // Which sheet is on screen, decided BEFORE whether to show its original — holding Compare in a
  // smoothness view used to jump to the ALBEDO, because the swap was `src = s.baseC`
  // unconditionally (ROADMAP 3.17). `chanViewCanvas` is compare-aware itself, so the explicit-view
  // branch needs no second swap; the brush-driven branch picks base or composite here.
  source(s){
    // The channel the tool in hand writes, which since ROADMAP 4.28(d) is a field rather than five
    // lines of enum arithmetic. Null is the mask brush and no tool at all, and both show the albedo.
    const ch = Tool.chanOf(App.brush.mode) || "color";
    let src = App.compare ? chanBase(s, ch) : (ch === "color" ? s.composite : chanOut(s, ch));
    if (ch === "wear" && !src) src = App.compare ? s.baseC : s.composite;
    // an explicit channel view wins over whatever the brush happens to be set to
    if (App.chanView && App.chanView !== "shaded") src = chanViewCanvas(s, App.chanView) || src;
    return src || (App.compare ? (s.baseC || s.composite) : s.composite);
  },
  // Only the part of the sheet that is actually on screen. At 8192² zoomed in, blitting the whole
  // sheet and letting the clip discard it cost 533 ms a frame against 51 ms for the visible slice —
  // the source rectangle is what makes a big texture pan and zoom at all. Null when nothing of the
  // sheet is in view, which is a real state at the end of a pan.
  window(s, g){
    const cw = s.composite.width, chh = s.composite.height;
    const vx0 = Math.max(0, Math.floor(-v2.ox / v2.sc) - 1);
    const vy0 = Math.max(0, Math.floor(-v2.oy / v2.sc) - 1);
    const vx1 = Math.min(cw, Math.ceil((cnv2.width - v2.ox) / v2.sc) + 1);
    const vy1 = Math.min(chh, Math.ceil((cnv2.height - v2.oy) / v2.sc) + 1);
    const vw = vx1 - vx0, vh = vy1 - vy0;
    if (vw <= 0 || vh <= 0) return null;
    return { cw, chh, vx0, vy0, vw, vh,
      blit(img){
        if (!img) return;
        // A source of another size covers the same sheet, so scale the window into its space.
        const kx = img.width / cw, ky = img.height / chh;
        g.drawImage(img, vx0 * kx, vy0 * ky, vw * kx, vh * ky, vx0, vy0, vw, vh);
      } };
  },
  // The camouflage blend this view and the viewport draw on a ground or naval slot, or null where the
  // slot is drawn as its plain composite: the coverage bytes, the camouflage colour, what shows through
  // under the paint (the vehicle's bare sheet, or the camouflage itself on a raw .obj), and whether the
  // paint is still the camouflage (nothing painted yet). One copy, for the two readers of what is ON
  // SCREEN — the eyedropper (`shownColorAt`) and the magic wand (`shownRows`) — which is what keeps
  // them agreeing with each other.
  blend(s){
    const cov = (App.coverageOn !== false && App.paintTint) ? coverageBytes(s) : null;
    const css = cov ? slotCamoColor(s) : null;
    if (!css) return null;
    const n = css.split(/[^0-9]+/).filter(t => t.length).map(Number), cw = s.composite.width;
    const covW = (chanHasLayers(s, "wear") && s.chanC && s.chanC.wear) ? s.chanC.wear.width : cw;
    return { cov, covW, covH: cov.length / covW, camo: n.length >= 3 ? n.slice(0, 3) : [255, 255, 255],
             bare: s.stockC || null, paintIsCamo: !!s.stockC && !chanEdited(s, "color") };
  },
  // Rows of what this view shows of the sheet, at the selection's resolution `S`, as RGBA bytes — what
  // the magic wand matches (ROADMAP 4.50 (9)): `read(y0, n)` hands back rows y0 … y0 + n − 1. That is
  // `source` itself, except where `paint` below draws the camouflage blend over it: there it is the
  // blend, worked out texel by texel with `shownColorAt`'s arithmetic — the eyedropper's (4.26) — so
  // a wand click takes the colour on screen. Reported in review, 2026-09-26: on a ground slot the wand
  // matched the composite under the camouflage, and two clicks on one visible green took two
  // different patches, named by colours shown nowhere.
  shownRows(s, S){
    const src = Draw2D.source(s), B = src === s.composite ? Draw2D.blend(s) : null;
    if (!B) return Marquee.rowsOf(src, S);
    // the paint is read only once something has been painted — until then it IS the camouflage
    const rows = B.paintIsCamo ? null : Marquee.rowsOf(src, S);
    const bare = B.bare ? Marquee.rowsOf(B.bare, S, true) : null, cw = s.composite.width, chh = s.composite.height;
    const cx = new Int32Array(S.w);                       // the coverage column under each column read
    for (let X = 0; X < S.w; X++) { const x = Math.floor((X + .5) * cw / S.w); cx[X] = Math.min(B.covW - 1, (x * B.covW / cw) | 0); }
    return (y0, n) => {
      const u = bare ? bare(y0, n) : null, p = rows ? rows(y0, n) : null, out = new Uint8ClampedArray(S.w * n * 4);
      for (let r = 0; r < n; r++) {
        const y = Math.floor((y0 + r + .5) * chh / S.h), crow = Math.min(B.covH - 1, (y * B.covH / chh) | 0) * B.covW;
        for (let X = 0, o = r * S.w * 4; X < S.w; X++, o += 4) {
          const a = (B.cov[crow + cx[X]] || 0) / 255;
          for (let k = 0; k < 3; k++) {
            const uu = u ? u[o + k] : B.camo[k], pp = p ? p[o + k] : B.camo[k];
            out[o + k] = Math.round(uu + (pp - uu) * a);
          }
          out[o + 3] = 255;                                 // the view is opaque there
        }
      }
      return out;
    };
  },
  // The camouflage shows through wherever the coverage mask is dark, so the 2-D view says the same
  // thing the 3-D one does instead of showing worn areas as flat colour. Everything here is the size
  // of the visible window, never the size of the sheet, and the alpha stencil is cached until the
  // view or the mask changes — so a stroke on an 8192² sheet pays nothing for it.
  paint(g, s, D, src){
    // Same blend as the viewport: what shows through where the paint mask is dark is the vehicle's
    // own bare sheet, not the camouflage. With no stock sheet to fall back on (a raw .obj) the
    // camouflage colour is the best stand-in there is.
    const cov = (src === s.composite && App.coverageOn !== false && App.paintTint) ? coverageBytes(s) : null;
    const camo = cov ? slotCamoColor(s) : null;
    if (!camo) { D.blit(src); return; }
    const bare = s.stockC || null;
    const { cw, chh, vx0, vy0, vw, vh } = D;
    // 1) the bare, unpainted material — the vehicle's own sheet, which set_tex leaves in the game
    if (bare) D.blit(bare); else { g.fillStyle = camo; g.fillRect(vx0, vy0, vw, vh); }
    const pw = Math.max(1, Math.min(2048, Math.round(vw * Math.min(2, v2.sc))));
    const ph = Math.max(1, Math.min(2048, Math.round(vh * Math.min(2, v2.sc))));
    const key = [pw, ph, vx0, vy0, vw, vh, cw, chh, s.id, s._covRev || 0].join(",");
    let st = draw2D._stencil;
    if (!st || st.key !== key) {
      const c = st && st.c.width === pw && st.c.height === ph ? st.c : mkCanvas(pw, ph);
      const img = new ImageData(pw, ph);
      const d = img.data;
      // cov is one byte per texel of the coverage sheet, which may be a different size
      const covW = (chanHasLayers(s, "wear") && s.chanC && s.chanC.wear) ? s.chanC.wear.width : cw;
      const covH = cov.length / covW;
      for (let y = 0; y < ph; y++) {
        const ty = Math.min(covH - 1, (((vy0 + (y + .5) * vh / ph) * covH / chh)) | 0);
        for (let x = 0; x < pw; x++) {
          const tx = Math.min(covW - 1, (((vx0 + (x + .5) * vw / pw) * covW / cw)) | 0);
          const i = (y * pw + x) * 4;
          d[i] = d[i+1] = d[i+2] = 255;
          d[i+3] = cov[ty * covW + tx];
        }
      }
      ctx2d(c).putImageData(img, 0, 0);
      st = draw2D._stencil = { key, c };
    }
    // 2) the paint, cut out by that mask and laid over it. Until you have painted something the
    //    paint is the camouflage itself — showing the stock detail sheet as if it were your paint
    //    is what made a freshly loaded tank look like bare, rusty metal.
    const sc = draw2D._cov && draw2D._cov.width === pw && draw2D._cov.height === ph ? draw2D._cov : (draw2D._cov = mkCanvas(pw, ph));
    const cg = ctx2d(sc);
    cg.globalCompositeOperation = "copy"; cg.globalAlpha = 1;
    if (bare && !chanEdited(s, "color")) { cg.fillStyle = camo; cg.fillRect(0, 0, pw, ph); }
    else cg.drawImage(src, vx0, vy0, vw, vh, 0, 0, pw, ph);
    cg.globalCompositeOperation = "destination-in";
    cg.drawImage(st.c, 0, 0);
    cg.globalCompositeOperation = "source-over";
    g.drawImage(sc, 0, 0, pw, ph, vx0, vy0, vw, vh);
  },
  // The red "this is hidden" tint, which is the only thing on screen that says a mask is in force
  // while you paint on it. Built at the size of the visible WINDOW rather than the whole sheet: at
  // 8192² the old full-sheet scratch was a 268 MB canvas rebuilt on every frame of a mask stroke.
  maskTint(g, D){
    const L = activeLayerObj();
    if (App.brush.target !== "mask" || !L || !L.mask) return;
    const { cw, chh, vx0, vy0, vw, vh } = D;
    const mw = Math.max(1, Math.min(cw, Math.ceil(vw))), mh = Math.max(1, Math.min(chh, Math.ceil(vh)));
    const viz = draw2D._viz && draw2D._viz.width === mw && draw2D._viz.height === mh ? draw2D._viz : (draw2D._viz = mkCanvas(mw, mh));
    const vg = ctx2d(viz);
    vg.globalCompositeOperation = "source-over"; vg.globalAlpha = 1;
    vg.fillStyle = "#e03030"; vg.fillRect(0, 0, mw, mh);
    vg.globalCompositeOperation = "destination-out";
    const kx = L.mask.width / cw, ky = L.mask.height / chh;
    vg.drawImage(L.mask, vx0 * kx, vy0 * ky, vw * kx, vh * ky, 0, 0, mw, mh);
    vg.globalCompositeOperation = "source-over";
    g.globalAlpha = .4; g.drawImage(viz, 0, 0, mw, mh, vx0, vy0, vw, vh); g.globalAlpha = 1;
  },
  // The selected decal's outline, and its mirrored copy's — dashed, so the copy reads as a copy
  // rather than as a second decal.
  decal(g, D){
    const L = activeLayerObj();
    if (!L || L.type !== "decal") return;
    const box = (x, y, rot, dash) => {
      g.save();
      g.translate(x * D.cw, y * D.chh); g.rotate(rot * Math.PI / 180); g.scale(L.scale, L.scale);
      g.strokeStyle = "#4f8ff7"; g.lineWidth = 2 / (v2.sc * L.scale);
      if (dash) g.setLineDash([6 / (v2.sc * L.scale), 5 / (v2.sc * L.scale)]);
      g.strokeRect(-L.bmp.width / 2, -L.bmp.height / 2, L.bmp.width, L.bmp.height);
      g.restore();
    };
    box(L.x, L.y, L.rot, false);
    if (L.sym) box(L.sym.x, L.sym.y, -L.rot, true);
  },
  // ---- a PROJECTED decal on the sheet (ROADMAP 4.2) ----
  // Its frame and the handles the 3-D view gives it — corners that resize, a knob off the top edge
  // that turns — where the projector's own corners land through the map around the decal's centre
  // (`ProjGrip.sheetFrame`): exact on a flat panel, the tangent-plane estimate where the surface
  // curves, which is enough for a handle because the pixels are the projector's. In DEVICE pixels, so
  // they are the same size at every zoom, and only with painting off — with it on, a press paints.
  // Not while the decal is being dragged on the MODEL: its centre moves every frame there, and each
  // new centre costs a search for the triangle under it that the 3-D drag does not otherwise pay.
  // The frame shows whenever the decal is in hand — `ProjGrip.target`, the model's own rule, so with
  // painting on or another placing mode armed the sheet has none either. Its HANDLES show only where a
  // press on the sheet can take one: not while Select or the shape tool owns the sheet's pointer (both
  // take every press before a decal sees it), nor with the brush on the layer's mask, whose press is
  // the mask's. A handle drawn where a press does something else is a handle that lies.
  projGeom(s){
    const L = ProjGrip.target();
    if (!L || !s || !s.composite || (App.projDragging && !ProjGrip.g)) return null;
    const SF = ProjGrip.sheetFrame(L.proj, s);
    if (!SF) return null;
    const dev = t => ({ x: t.x * v2.sc + v2.ox, y: t.y * v2.sc + v2.oy });
    const F = SF.F, c = dev(SF.c);
    const corners = ProjGrip.CORNERS.map(([x, y]) => dev(ProjGrip.toSheet(SF, x * F.halfW, y * F.halfH)));
    const top = dev(ProjGrip.toSheet(SF, 0, -F.halfH));
    let dx = top.x - c.x, dy = top.y - c.y;
    const dl = Math.hypot(dx, dy), K = ProjGrip.KNOB * devicePixelRatio;
    if (dl < 1) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
    const span = Math.max(...corners.map(q => Math.hypot(q.x - c.x, q.y - c.y)));
    const free = !SelectUI.on && !PathUI.on && App.brush.target !== "mask";
    return { L, SF, c, corners, top, knob: { x: top.x + dx * K, y: top.y + dy * K },
             handles: free && span >= ProjGrip.MIN * devicePixelRatio };
  },
  // The sheet's cursor over a projected decal's handle: the arrow for that drag, or nothing. An inline
  // style, so this is the ONE place it is written and taken back — on every move, before Select or the
  // shape tool can take the move, and from `refreshViewCursor`, where painting and the placing mode
  // end up when they change — or it outlives the handles (4.2's review: B over a corner kept the
  // resize arrow on the sheet for a whole painting session). A handle held keeps the arrow it was
  // taken with.
  projPointer(){
    if (v2.draggingDecal) return;
    const p = v2.cursorClient ? view2px(v2.cursorClient) : null;
    const H = p ? Draw2D.projGeom(App.activeSlot) : null;
    const cur = H ? Draw2D.projCursor(H, Draw2D.projHit(H, p.vx, p.vy)) : "";
    if (cur || v2.projCur) { if (cnv2.style.cursor !== cur) cnv2.style.cursor = cur; v2.projCur = cur; }
  },
  // The handle under device point (vx, vy): the same answers as ProjHandles.hit.
  projHit(H, vx, vy){
    if (!H || !H.handles) return null;
    let best = null, bd = 10 * devicePixelRatio;
    const dk = Math.hypot(vx - H.knob.x, vy - H.knob.y);
    if (dk <= bd) { best = { kind: "rot" }; bd = dk; }
    H.corners.forEach((q, i) => { const d = Math.hypot(vx - q.x, vy - q.y); if (d <= bd) { best = { kind: "scale", i }; bd = d; } });
    return best;
  },
  projCursor(H, h){
    if (!h) return "";
    if (h.kind === "rot") return ProjHandles.ROT;
    const q = H.corners[h.i];
    return (q.x - H.c.x) * (q.y - H.c.y) > 0 ? "nwse-resize" : "nesw-resize";
  },
  proj(g, s){
    const H = Draw2D.projGeom(s);
    if (!H) return;
    const dpr = devicePixelRatio, A = Marquee.ACCENT;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.lineWidth = 1.5 * dpr; g.strokeStyle = A;
    g.beginPath();
    H.corners.forEach((q, i) => { if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
    g.closePath(); g.stroke();
    const k = 5 * dpr;
    g.beginPath(); g.moveTo(H.c.x - k, H.c.y); g.lineTo(H.c.x + k, H.c.y); g.moveTo(H.c.x, H.c.y - k); g.lineTo(H.c.x, H.c.y + k); g.stroke();
    if (H.handles) {
      g.beginPath(); g.moveTo(H.top.x, H.top.y); g.lineTo(H.knob.x, H.knob.y); g.stroke();
      g.fillStyle = "#fff";
      const h = 4.5 * dpr;
      for (const q of H.corners) { g.fillRect(q.x - h, q.y - h, 2 * h, 2 * h); g.strokeRect(q.x - h, q.y - h, 2 * h, 2 * h); }
      g.beginPath(); g.arc(H.knob.x, H.knob.y, h, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
  },
  // A camouflage tile repeats in the game, so it is shown 3 × 3 (ROADMAP 4.50 (6)): a seam the
  // pattern would have in the hangar is on screen while you paint, and a stroke may start on a
  // neighbouring copy. The eight neighbours are the whole sheet each — a tile is at most 4096², and
  // a canvas blit is GPU-side — and the sheet itself keeps a faint frame so you know which is which.
  tile(g, s){
    if (!CamoTile.is(s)) return;
    const src = Draw2D.source(s), W = s.composite.width, H = s.composite.height;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) g.drawImage(src, i * W, j * H, W, H);
    g.fillStyle = "rgba(16,18,22,.28)";                         // the repeats a shade darker than the sheet
    g.fillRect(-W, -H, 3 * W, H); g.fillRect(-W, H, 3 * W, H); g.fillRect(-W, 0, W, H); g.fillRect(W, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.45)"; g.lineWidth = 1 / v2.sc;
    g.strokeRect(0, 0, W, H);
  },
  // The brush footprint, in TEXTURE pixels — the unit the size slider is actually in, so the
  // outline is the same size here as the ring projected on the model.
  // With Smoothing on, a stroke's paint lands at the end of the string rather than under the pointer
  // (ROADMAP 4.50 (4)), so mid-stroke the ring is drawn there and the string itself as a line to it.
  ring(g){
    Draw2D.cloneSource(g);
    if (!App.paint3d || SelectUI.on || !v2.cursor || App.brush.mode === "none") return;
    brushStamp.warm();                                     // a stroke may be about to start: have its stamp ready
    const r = App.brush.size / 2, at = v2.lazy || v2.cursor;
    g.lineWidth = Math.max(0.5, 1.5 / v2.sc);
    if (v2.lazy) {
      g.strokeStyle = "rgba(127,224,255,.5)";
      g.beginPath(); g.moveTo(v2.cursor.x, v2.cursor.y); g.lineTo(at.x, at.y); g.stroke();
    }
    // The outline of the dab (ROADMAP 4.50 (10)): a square tip is drawn as its square, at its own
    // Angle — before the stroke says which way it is heading — and every other tip as the circle its
    // Size spans. The inner line is where a soft edge stops being opaque, for the tips Hardness shapes.
    const T = Tips.of(App.brush), hard = Math.max(0, Math.min(1, App.brush.hardness));
    const outline = (k, alpha) => {
      g.strokeStyle = "rgba(127,224,255," + alpha + ")";
      g.beginPath();
      if (T.id !== "square") g.arc(at.x, at.y, r * k, 0, Math.PI * 2);
      else {
        const a = (+App.brush.angle || 0) * Math.PI / 180, c = Math.cos(a) * r * k, s = Math.sin(a) * r * k;
        g.moveTo(at.x + c - s, at.y + s + c); g.lineTo(at.x - c - s, at.y - s + c);
        g.lineTo(at.x - c + s, at.y - s - c); g.lineTo(at.x + c + s, at.y + s - c); g.closePath();
      }
      g.stroke();
    };
    outline(1, .95);
    if (T.hard && hard > .02 && hard < .98) outline(hard, .4);
  },
  // Where the Clone is copying from: a cross at the source, and once a stroke has fixed the offset,
  // a dashed ring the brush's size at cursor + offset — the patch the next stamp will take. Both in
  // the sheet's pixels, which is what the slot stores them in.
  cloneSource(g){
    const s = App.activeSlot, src = App.brush.tool === "clone" && s ? Clone.source(s) : null;
    if (!src) return;
    const k = 8 / v2.sc;
    g.lineWidth = Math.max(0.5, 1.5 / v2.sc);
    g.strokeStyle = "rgba(255,200,80,.95)";
    g.beginPath();
    g.moveTo(src.x - k, src.y); g.lineTo(src.x + k, src.y);
    g.moveTo(src.x, src.y - k); g.lineTo(src.x, src.y + k);
    g.stroke();
    const off = src.off[0];
    if (!off || !v2.cursor || !App.paint3d) return;
    g.setLineDash([4 / v2.sc, 4 / v2.sc]);
    g.beginPath(); g.arc(v2.cursor.x + off.x, v2.cursor.y + off.y, App.brush.size / 2, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
  },
};
function draw2DNow(){
  const g = cnv2.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#101216";
  g.fillRect(0, 0, cnv2.width, cnv2.height);
  const s = App.activeSlot;
  if (!s || !s.composite) return;
  g.imageSmoothingEnabled = v2.sc < 3;
  g.setTransform(v2.sc, 0, 0, v2.sc, v2.ox, v2.oy);
  Draw2D.tile(g, s);                          // before the early return: a repeat can be in view when the sheet is not
  const D = Draw2D.window(s, g);
  if (D) {
    Draw2D.paint(g, s, D, Draw2D.source(s));
    Draw2D.maskTint(g, D);
    if (v2.uvOn && s.uvOverlay) D.blit(s.uvOverlay);
    Draw2D.decal(g, D);
    Draw2D.proj(g, s);                        // a projected decal's frame and handles (4.2)
    SelectUI.draw(g, v2);                     // the marquee, its handles and the dimmed outside
    PathUI.draw(g);                           // the path being drawn, its nodes and handles (6.1)
    Draw2D.ring(g);
  } else if (CamoTile.is(s)) Draw2D.ring(g);  // a tile's repeat can be under the brush with no texel of it in view (4.50 (6))
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Last, and even with no texel in view: the rulers are what finds the sheet again after a pan.
  GuidesUI.draw(g, s);                        // the pixel grid, the guides and the rulers (4.50 (15))
}
function view2px(e){
  const r = cnv2.getBoundingClientRect();
  const x = (e.clientX - r.left) * devicePixelRatio, y = (e.clientY - r.top) * devicePixelRatio;
  return { x: (x - v2.ox) / v2.sc, y: (y - v2.oy) / v2.sc, vx: x, vy: y };
}
cnv2.addEventListener("wheel", e => {
  e.preventDefault();
  // Ctrl+wheel widens / narrows the part selection a level at a time (see growSelection);
  // Alt+wheel is the brush size it used to be, and [ / ] still do the same.
  if (e.ctrlKey) { growSelection(e.deltaY < 0 ? 1 : -1); return; }
  if (e.altKey) { adjustBrushSize(e.deltaY < 0 ? 6 : -6); return; }
  const p = view2px(e);
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  v2.sc *= f;
  v2.ox = p.vx - p.x * v2.sc; v2.oy = p.vy - p.y * v2.sc;
  freeView2D();
  draw2D();
}, { passive: false });
cnv2.addEventListener("pointerdown", e => {
  cnv2.setPointerCapture(e.pointerId);
  const p = view2px(e);
  const s = App.activeSlot;
  if (e.button === 1 || v2.space || e.button === 2) { v2.panning = true; v2.px = p.vx; v2.py = p.vy; return; }
  // The rulers are the view's frame, not the sheet: a press on one pulls out or takes hold of a guide
  // whatever tool is on, and nothing on a ruler ever paints or selects (4.50 (15)).
  if (GuidesUI.down(e, p)) return;
  // Select is a mode of this pointer: while it is on, a drag makes a rectangle and nothing else.
  // It sits above the colour pick and the decal drag deliberately — a mode that some drags escape
  // is the thing 3.9 was reported for.
  // The shape tool owns the pointer before Select does: both want a drag on the sheet, and the
  // one that is ON is the one that means something (ROADMAP 6.1).
  if (PathUI.down(e, p)) return;
  if (SelectUI.down(e, p)) return;
  if (e.altKey && App.brush.target !== "mask" && s && s.composite) { // color pick (any target except the mask, where Alt = reveal)
    // On a tile's repeats the texel under the cursor is the sheet's own, one period over (4.50 (6)).
    const q = CamoTile.is(s) ? CamoTile.wrap(p.x, p.y, s.composite.width, s.composite.height) : [p.x, p.y];
    if (App.brush.tool === "clone") { Clone.pick(s, q[0], q[1]); BrushPanel.cloneHint(); draw2D(); }   // …or the Clone's source
    else pickColorFrom(s, q[0], q[1]);
    return;
  }
  const L = activeLayerObj();
  // ROADMAP 4.2: a PROJECTED decal is dragged on the sheet too — by a handle, which resizes or turns
  // it exactly as in 3-D, or by its own pixels, which moves it to the surface under the texel the
  // pointer is over. Only while the decal is in hand (`ProjGrip.target`, the 3-D view's rule): with
  // painting on a press paints, and another placing mode armed owns the click.
  if (L && L.proj && s && L === ProjGrip.target() && App.brush.target !== "mask") {
    const H = Draw2D.projGeom(s), h = Draw2D.projHit(H, p.vx, p.vy);
    const on = h ? null : projAtUV(s, p.x, p.y);
    if (h || on) {
      if (on && on !== L) { App.activeLayer = on; refreshLayerList(); }   // another projected decal: that one
      if (h) ProjGrip.begin(L.proj, h.kind, ProjGrip.fromSheet(H.SF, p.x, p.y), { corner: h.i, view: "2d", sf: H.SF, handle: h });
      else ProjGrip.grabSheet(on.proj, s, p.x, p.y);
      v2.draggingDecal = true;
      return;
    }
  }
  if (L && L.type === "decal" && s && App.brush.target !== "mask") {
    const dx = p.x - L.x * s.composite.width, dy = p.y - L.y * s.composite.height;
    const cos = Math.cos(-L.rot * Math.PI / 180), sin = Math.sin(-L.rot * Math.PI / 180);
    const lx = (dx * cos - dy * sin) / (L.scale * (L.flip ? -1 : 1)), ly = (dx * sin + dy * cos) / L.scale;
    if (Math.abs(lx) < L.bmp.width / 2 && Math.abs(ly) < L.bmp.height / 2) {
      v2.draggingDecal = true;
      SurfDrag.hold(L, x => x === L);                          // ROADMAP 4.8c, 4.28(f)
      // Grab offset, so the decal follows the point you took hold of instead of snapping its
      // centre under the cursor the moment you press.
      v2.decalStart = { L, x: L.x, y: L.y, gx: p.x - L.x * s.composite.width, gy: p.y - L.y * s.composite.height };
      return;
    }
  }
  // Painting is off → a drag pans the sheet, which is what the old "brush: off" mode was for — or,
  // started on a guide, moves the guide: this is the one place on the sheet no tool wants the drag.
  if (!App.paint3d) {
    if (GuidesUI.grab(e, p)) return;
    v2.panning = true; v2.px = p.vx; v2.py = p.vy; return;
  }
  if (App.brush.tool !== "none" && beginStroke(e.altKey)) {
    // The pressure the first dab is laid at, and whether a pen is driving this (ROADMAP 4.50 (4)).
    if (Pen.begin(stroke, e)) recStrokeFlag("pen");
    // Shift = a straight line from where the last stroke ended, however far away that is.
    if (e.shiftKey && s && s._lastPt) {
      stroke.lasts[0] = s._lastPt; stroke.line = true;
      if (s._lastPtSym) stroke.lasts[1] = s._lastPtSym;      // …and its mirror from the mirror's end (6.2)
    }
    Mirror.begin();                                          // symmetry on the sheet (ROADMAP 6.2)
    stampAt(p.x, p.y, 0, stroke.line ? { line: true } : null);
    Mirror.stamp(p, stroke.line ? { line: true } : null);
  }
});
cnv2.addEventListener("pointermove", e => {
  const p = view2px(e);
  v2.cursorClient = { clientX: e.clientX, clientY: e.clientY };  // replayed by refreshBrushCursor()
  if (v2.panning) { v2.ox += p.vx - v2.px; v2.oy += p.vy - v2.py; v2.px = p.vx; v2.py = p.vy; freeView2D(); draw2D(); return; }
  if (GuidesUI.move(e, p)) return;            // a guide in hand, or the pointer over a ruler (4.50 (15))
  // Over a projected decal's handle the cursor names the drag — arithmetic on what was drawn, so free —
  // and anywhere else it is taken back, painting or not (4.2's review). After the guides: a handle
  // on the sheet takes a press before a guide under it does, so its cursor wins there too.
  Draw2D.projPointer();
  if (PathUI.move(e, p)) return;
  if (SelectUI.move(e, p)) return;
  if (v2.draggingDecal && ProjGrip.g && ProjGrip.g.view === "2d") {    // a projected decal (4.2)
    const g = ProjGrip.g;
    if (g.kind === "move") ProjGrip.dragSheet(p.x, p.y);
    else ProjGrip.drag(ProjGrip.fromSheet(g.sf, p.x, p.y), e.shiftKey);
    draw2D();
    return;
  }
  if (v2.draggingDecal) {
    const L = activeLayerObj(), s = App.activeSlot, st = v2.decalStart;
    if (L && s && st) {
      const gx = st.gx || 0, gy = st.gy || 0;
      const px = L.x, py = L.y;
      // The box the decal covers on the sheet lines up with a guide by either edge or its centre,
      // turned or not — the edges are what a stripe or a serial box is aligned by (4.50 (15)).
      let cx = p.x - gx, cy = p.y - gy;
      const b = Guides.boxOf(L.bmp.width * L.scale, L.bmp.height * L.scale, L.rot);
      const sn = GuidesUI.snap(e, [cx - b.hw, cx + b.hw, cx], [cy - b.hh, cy + b.hh, cy]);
      cx += sn.dx; cy += sn.dy;
      L.x = Math.max(0, Math.min(1, cx / s.composite.width));
      L.y = Math.max(0, Math.min(1, cy / s.composite.height));
      moveDecalSiblings(s, L, L.x - px, L.y - py);   // anything else in its group comes along
      scheduleComposite(s); draw2D();
    }
    return;
  }
  // The ring is drawn from `v2.cursor`, and this used to update it only on the branch where there
  // was NO stroke — so the moment you pressed, the ring froze at the last position before
  // pointerdown and sat there for the whole stroke, while the comment on the line said "follows the
  // pointer" (ROADMAP 3.20). It follows it now, painting or not. `draw2D` is rAF-coalesced, so
  // asking on every move costs at most one redraw a frame, and the stamp's own request folds into
  // the same one.
  if (App.paint3d) { v2.cursor = p; draw2D(); }
  if (stroke) {
    // Every sample the move carries — a pen's coalesced ones, each at its own pressure — through the
    // Smoothing string (ROADMAP 4.50 (4)). A mouse with Smoothing off is the one sample it always was.
    for (const q of Pen.follow(stroke, e, App.brush.lazy)) {
      stroke.p = q.p;
      const tp = view2px({ clientX: q.x, clientY: q.y });
      stampAt(tp.x, tp.y); Mirror.stamp(tp, null);
    }
    // Where the paint is going while the string trails: the ring is drawn there (Draw2D.ring).
    v2.lazy = App.brush.lazy > 0 && stroke.string ? view2px({ clientX: stroke.string.x, clientY: stroke.string.y }) : null;
  }
});
cnv2.addEventListener("pointerleave", () => { v2.cursorClient = null; if (v2.cursor) { v2.cursor = null; draw2D(); } });
const endAll = () => {
  GuidesUI.up();
  PathUI.up();
  SelectUI.up();
  GuidesUI.endSnap();                                        // the guide a gesture held stops glowing
  SurfDrag.release();                                        // whatever happened, the layers come back
  if (v2.draggingDecal && v2.decalStart) {
    const { L, x, y } = v2.decalStart;
    const nx = L.x, ny = L.y, s = App.activeSlot;
    // A surface response is DERIVED from where the decal sits, so a move has to rebuild it. The
    // keyboard path (`commitDecalEdit`) has done that since 4.8 and this one never did, which left
    // the gloss and the raised edge where the sticker used to be **permanently** — until some other
    // edit happened to refresh them. Both closures too, or undo puts the decal back and leaves the
    // response where it was dragged to. ROADMAP 4.8c.
    const place = (px, py) => { L.x = px; L.y = py; ensureDecalSurface(s, L); scheduleComposite(s); draw2D(); };
    if (x !== nx || y !== ny) {
      pushAction("move decal", () => place(x, y), () => place(nx, ny));
      place(nx, ny);
    }
    v2.decalStart = null;
  }
  if (ProjGrip.g && ProjGrip.g.view === "2d") ProjGrip.end();   // one undo step, and the real render
  // The ring goes back under the pointer the moment the stroke ends, not at the next move.
  if (v2.lazy) { v2.lazy = null; draw2D(); }
  v2.panning = false; v2.draggingDecal = false; endStroke();
  Mirror.end();                                              // what the stroke could not mirror, once
  BrushPanel.cloneHint();                                    // a first clone stroke has fixed the offset
};
cnv2.addEventListener("pointerup", endAll);
cnv2.addEventListener("pointercancel", endAll);
function adjustBrushSize(d){
  App.brush.size = Math.max(2, Math.min(400, App.brush.size + d));
  $("brushSize").value = App.brush.size; $("brushSizeVal").textContent = App.brush.size;
  brushStamp._key = null;
  refreshBrushCursor();                                      // [ / ] and Alt+wheel resize the indicators too
}
// Alt+click picks from the channel the ACTIVE BRUSH writes. It used to read slot.composite — the
// albedo — whatever the tool was, and write App.brush.color, which the surface brushes never read:
// brushStamp keys off `b.value` for every mode except "color". So picking with a Metalness brush
// stored a hex nothing would use and still reported "Picked #rrggbb" — a silent no-op with a status
// line in front of it, the failure mode CLAUDE.md §4 names. ROADMAP 3.15.
//
// (x, y) arrive in ALBEDO space, from the 2-D view and from the 3-D hit's UV alike; the surface
// sheets need not be that size, so the sample point is scaled into whichever sheet is read.
// The colour the two views actually SHOW at one texel, or null when the slot is drawn as its plain
// composite and the caller should read that instead.
//
// A ground or naval slot is not drawn as its composite in either view. Both lay the paint over the
// vehicle's own bare sheet through the coverage mask — draw2DNow does it in the three blits above,
// the viewport binds the same mask as an alphaMap (materials.js) — so wherever coverage is short of
// opaque the composite holds a colour that is on screen nowhere. Reported 2026-09-01, picking and
// painting both in the 3-D view; it is not a 3-D bug, the 2-D view gave the same wrong answer over
// the same texel. This is deliberately the same rule as the draw above and not an approximation of
// it: if the two ever disagree the pick is wrong again, in a way nobody can see.
function shownColorAt(slot, x, y){
  const B = Draw2D.blend(slot);                               // the same blend the magic wand reads
  if (!B) return null;
  const cw = slot.composite.width, chh = slot.composite.height;
  const at = img => {
    const sx = Math.max(0, Math.min(img.width - 1, (x * img.width / cw) | 0));
    const sy = Math.max(0, Math.min(img.height - 1, (y * img.height / chh) | 0));
    const d = ctx2d(img).getImageData(sx, sy, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const under = B.bare ? at(B.bare) : B.camo;
  const paint = B.paintIsCamo ? B.camo : at(slot.composite);
  const i = Math.min(B.covH - 1, (y * B.covH / chh) | 0) * B.covW + Math.min(B.covW - 1, (x * B.covW / cw) | 0);
  const a = (B.cov[i] || 0) / 255;
  return [0, 1, 2].map(k => Math.round(under[k] + (paint[k] - under[k]) * a));
}
function pickColorFrom(slot, x, y){
  if (!slot || !slot.composite) return;
  const ch = BRUSH_CHAN[App.brush.mode] || null;              // null for colour / erase / mask
  const src = ch ? chanOut(slot, ch) : slot.composite;
  if (!src) {
    setStatus("This slot has no " + (CHAN_LABEL[ch] || ch).toLowerCase() + " map to pick from", "err");
    return;
  }
  const kx = src.width / slot.composite.width, ky = src.height / slot.composite.height;
  const d = ctx2d(src).getImageData(
    Math.max(0, Math.min(src.width - 1, (x * kx) | 0)),
    Math.max(0, Math.min(src.height - 1, (y * ky) | 0)), 1, 1).data;
  if (!ch) {
    const shown = shownColorAt(slot, x, y);
    const rgb = shown || [d[0], d[1], d[2]];
    const hex = "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
    App.brush.color = hex; $("brushColor").value = hex; brushStamp._key = null;
    // Only say it when it made a difference: on an aircraft, or on a fully covered texel, the two
    // answers are the same number and the note would be noise on every pick.
    const moved = shown && shown.some((v, i) => v !== d[i]);
    setStatus("Picked " + hex + (moved
      ? " — the colour on the surface. The layer underneath is " +
        "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join("") +
        ", showing through the coverage mask over the camouflage."
      : ""), "ok");
    return;
  }
  // Every non-colour sheet is one value per texel and the brushes paint it as rgb(v,v,v), so the
  // red byte is the value — including on the normal map, whose red IS the axis `height`/`flatten`
  // write. Round-trips: picking a texel and painting it back reproduces that texel.
  const v = d[0];
  App.brush.value = v;
  $("brushValue").value = v; $("brushValueVal").textContent = v;
  brushStamp._key = null;
  setStatus("Picked " + (CHAN_LABEL[ch] || ch).toLowerCase() + " " + v, "ok");
}
cnv2.addEventListener("contextmenu", e => e.preventDefault());
$("btnFit").onclick = fit2D;
$("btnUv").onclick = async () => {
  v2.uvOn = !v2.uvOn;
  $("btnUv").classList.toggle("active", v2.uvOn);
  const s = App.activeSlot;
  if (v2.uvOn && s && !s.uvOverlay && App.geomData) {
    setStatus("Building UV island outlines…");
    await new Promise(r => setTimeout(r, 20));
    s.uvOverlay = buildUVOverlay(s);
    setStatus("UV outlines ready", "ok");
  }
  draw2D();
};
// The island outlines. This function used to own the walk — quantise every UV, count how many
// triangles share each edge, stroke the ones with a count of 1 — and threw the adjacency away
// afterwards. That adjacency IS the island decomposition (ROADMAP 4.24), so the walk moved to
// `uvIslands` and this draws the boundary edges it kept. Two consequences worth the move: the mesh
// is walked once for both, and the outline on screen is provably the boundary of the same
// components a click selects, rather than of a second decomposition that merely intends to agree.
function buildUVOverlay(slot){
  const size = slot.composite.width, sizeH = slot.composite.height;
  const c = mkCanvas(size, sizeH), g = ctx2d(c);
  g.strokeStyle = "rgba(90,160,255,0.85)"; g.lineWidth = Math.max(1, size / 2048);
  const I = UVIslands.of(slot);
  if (!I) return c;
  const b = I.boundary, Q = I.Q;
  g.beginPath();
  for (let i = 0; i < b.length; i += 4) {
    g.moveTo(b[i] / Q * size, (1 - b[i+1] / Q) * sizeH);
    g.lineTo(b[i+2] / Q * size, (1 - b[i+3] / Q) * sizeH);
  }
  g.stroke();
  return c;
}

