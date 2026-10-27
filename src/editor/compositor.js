// ---------- Dirty rectangles ----------
// Everything that touches a texture reports which rectangle it touched, so compositing, the
// surface repack and the GPU upload can all work on that rectangle instead of on 16.7 million
// pixels. This is the difference between 5 fps and 60 fps at 4096².
function rectClamp(r, w, h){
  if (!r) return null;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return (x1 > x0 && y1 > y0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function rectUnion(a, b){
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function rectScale(r, fx, fy){ return r ? { x: r.x * fx, y: r.y * fy, w: r.w * fx, h: r.h * fy } : null; }
// ---- every dirty rectangle is in the slot's COMPOSITE texel space ----
// It has to be one space, because the sheets a rectangle travels between are routinely different
// sizes: a mask is deliberately allowed to differ (that is what `blit`'s scaling below is for), the
// three surface sheets come from the `_n` and can be half the albedo, and a layer's canvas is
// whatever it was painted at. `coverageBytes` has converted into the wear canvas since it was
// written and is the precedent; nothing else did, and ROADMAP 1.15 is what that cost. A stroke
// reported its rectangle in the LAYER's pixels and it was spent as the sheet's, so on a 4096 mask
// over a 2048 sheet the compositor rebuilt a quarter that had not changed and never visited the one
// that had — measured, the stroke changed **nothing** on screen until a whole-sheet pass, which is
// exactly what hiding and showing the layer does.
//
// Neither of these rounds: every consumer already puts the result through `rectClamp`, which floors
// the origin and ceils the far edge, i.e. outwards. Rounding here as well would only widen it twice.
function rectToSlot(slot, r, w, h){                          // a sheet of w×h  ->  composite space
  if (!r || !slot || !slot.composite || !w || !h) return r;
  const W = slot.composite.width, H = slot.composite.height;
  return (w === W && h === H) ? r : rectScale(r, W / w, H / h);
}
function rectFromSlot(slot, r, w, h){                        // composite space  ->  a sheet of w×h
  if (!r || !slot || !slot.composite) return r;
  const W = slot.composite.width, H = slot.composite.height;
  return (w === W && h === H) ? r : rectScale(r, w / W, h / H);
}
// A full CanvasTexture re-upload of a 4096² sheet is ~67 MB across the bus, every frame of a
// brush stroke. texSubImage2D of the touched rectangle costs a few hundred KB instead.
let texRegionOk = true;
function uploadTexRegion(tex, src, R){
  if (!tex) return true;                                   // nothing to upload
  // Texture quality has dropped level 0 from the GPU (4.58 (b)): there is no rectangle of it to
  // update, and the chain it is drawn from follows at idle (`LevelView`).
  if (tex._lv && tex._lv.detached) return true;
  if (!R || !texRegionOk || !renderer || typeof renderer.copyTextureToTexture !== "function"
      || tex.image !== src                                  // holding Compare: the texture is showing the original
      || R.w * R.h > src.width * src.height * .5) {         // more than half the sheet: plain upload wins
    tex.needsUpdate = true;
    return true;
  }
  try {
    const c = uploadTexRegion._c || (uploadTexRegion._c = mkCanvas(1, 1));
    if (c.width !== R.w || c.height !== R.h) { c.width = R.w; c.height = R.h; }
    const g = c.getContext("2d");
    g.clearRect(0, 0, R.w, R.h);
    g.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    const st = uploadTexRegion._t || (uploadTexRegion._t = new THREE.CanvasTexture(c));
    st.image = c;
    // GL's origin is bottom-left and the sheet went up flipped, so the row range mirrors.
    const y = tex.flipY ? src.height - (R.y + R.h) : R.y;
    renderer.copyTextureToTexture(new THREE.Vector2(R.x, y), st, tex, 0);
  } catch (e) {
    console.warn("partial texture upload unavailable — falling back to full uploads", e);
    texRegionOk = false;
    tex.needsUpdate = true;
  }
  return true;
}

// ---------- the three surface sheets, straight onto the GPU ----------
// There is no repack. There used to be: the smoothness, metalness and normal sheets were read back
// to the CPU, packed into two more canvases (`pvNorm` = normal X/Y with Z derived, `pvOrm` = 0 /
// 1-smoothness / metalness) and those were what three.js sampled. It is gone, and so are both
// canvases, because that CPU pass was the entire reason painting on a surface channel cost 30-115 ms
// a frame against the albedo's 0.04: it is the only place anything read surface pixels back, and on
// an accelerated canvas every such read transfers the whole surface AND waits for the compositor's
// writes to drain. ROADMAP 1.12's follow-up.
//
// The three sheets are now bound directly as `normalMap` / `roughnessMap` / `metalnessMap` and the
// two conversions happen in the shader, where they are free — see `makeMaterial`. So this function
// is the exact mirror of what the albedo does after `compositeSlot`: upload the rectangle that
// changed, and nothing else.
//
// `chanOut` swaps identity when a channel gains or loses its first layer (base sheet <-> channel
// composite), so the texture is re-pointed rather than rebuilt; `rebuildMaterials` is only needed
// the first time, when the maps did not exist at all.
function refreshSurfaceTextures(slot, rect){
  if (!slot || !slot.smooth) return;
  const made = !slot.texCh;
  if (!slot.texCh) slot.texCh = {};
  for (const ch of SURF_CHANS) {
    const src = (App.compare ? chanBase(slot, ch) : chanOut(slot, ch)) || slot[ch];
    if (!src) continue;
    let t = slot.texCh[ch];
    if (!t) {
      t = slot.texCh[ch] = new THREE.CanvasTexture(src);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.encoding = THREE.LinearEncoding;                      // data, not colour — never sRGB
    } else if (t.image !== src && !(t._lv && t._lv.detached)) { t.image = src; t.needsUpdate = true; }   // a detached chain is LevelView's (4.58 (b))
    // `rect` is composite space; this sheet came out of the `_n` and need not be that size.
    else uploadTexRegion(t, src, rect ? rectClamp(rectFromSlot(slot, rect, src.width, src.height), src.width, src.height) : null);
    LevelView.touched(slot, ch, rect || null);                // its own levels follow at idle (4.58 (b))
  }
  if (made) rebuildMaterials();                               // the maps exist now; rebind them
  needsRender();
}
function disposeSurfaceTextures(slot){
  if (!slot || !slot.texCh) return;
  for (const ch of Object.keys(slot.texCh)) { const t = slot.texCh[ch]; if (t) t.dispose(); }
  slot.texCh = null;
}
// ---- a decal shrunk in one step is a decal full of holes ----
// `drawImage` does a single bilinear tap per destination pixel: taking a 1024-px logo down to 80 px
// samples 1 source texel in 13 and drops the rest, which is the ragged, sparkling edge you get when
// you scale a pasted decal down. Halving repeatedly to the target size averages every texel in,
// exactly the way the export resampler already does it. Cached on the content and per target size,
// so a drag that does not change the scale costs nothing.
//
// `L` is an `image` CONTENT — the bitmap, its placement and the mip cache, which is where 4.28(b)
// put all three. A layer still answers to it through the legacy accessors while it holds one.
function decalDraw(L){
  const bmp = DecalStyle.bitmap(L.bmp, L.surf, L);             // outline and shadow, if the Look has them
  const w = Math.max(1, Math.round(bmp.width * L.scale));
  const h = Math.max(1, Math.round(bmp.height * L.scale));
  if (w >= bmp.width / 2) return { img: bmp, w, h };            // upscale or a gentle shrink: direct
  // The source image itself is replaced by the decal editor (background removal, crop, adjust), so
  // the cache is keyed on it as well as on the target size.
  const key = w + "x" + h;
  if (L._mip && L._mipKey === key && L._mipSrc === bmp) return { img: L._mip, w, h };
  L._mipSrc = bmp;
  let cur = bmp, cw = bmp.width, ch = bmp.height;
  while (cw > w * 2 && ch > h * 2) {
    const nx = mkCanvas(Math.max(w, cw >> 1), Math.max(h, ch >> 1));
    const g = nx.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, nx.width, nx.height);
    cur = nx; cw = nx.width; ch = nx.height;
  }
  const out = mkCanvas(w, h);
  const g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(cur, 0, 0, w, h);
  L._mip = out; L._mipKey = key;
  return { img: out, w, h };
}
// ---------- one composite, addressed by channel (ROADMAP 4.28(c)) ----------
// There used to be two of these. `compositeSlot` built the albedo and `compositeChannel` built
// smoothness, metalness, normal and wear, and they were one walk written twice — 160 lines against
// 111, both over §4's ceiling, both on 2.4's list, and they had **already drifted**: only one
// applied adjustment layers, only one guarded a paint layer with no canvas, and the dirty-rectangle
// path arrived in one of them a month after the other (ROADMAP 1.10).
//
// They were two functions for exactly one reason. A layer's channel was a TAG on the node, so "does
// this layer belong to this sheet" could only be asked once per sheet, by code written per sheet.
// 4.28(b) made it an ADDRESS — `LayerNode.contentOn(node, ch)` — and the walk is one function with
// a channel argument. Nothing else about it changed: same order, same scratches, same stencil pass,
// same recursion into groups, same pixels (`t52` and `t57` are the oracles).
//
// **The steps are methods on one object, not closures**, which is what CLAUDE.md §4 asks for and
// what had kept the albedo version at 160 lines: every step wants the same seven numbers, so they
// travel in `cx` rather than being captured. One binding — and `compositeChannel` is gone, so the
// global count goes down rather than up.
//
// `rect` (optional) limits the work to the part of the sheet that actually changed. The region is
// composited into a scratch of exactly that size and blitted back, rather than clipping the full
// sheet: a clip path is antialiased, which left a faint one-pixel seam along every dirty-rect
// border. The channels did not have this until 2026-08-25 and the measurement is why they do —
// per stroke frame at 4096², with the 1×1 `getImageData` sync barrier canvas timing needs: the
// albedo's region path is **0.04 ms and flat in sheet size**, the whole-sheet channel path was
// **25.8 ms** for one channel and **77.5 ms** with three layered, against §3.3's budget of 16 ms
// at 2048² (which three channels already broke there, at 25.1 ms). ROADMAP 1.10. `t52`'s oracle is
// that a region composite equals the whole-sheet one over that region, which is what makes the two
// paths safe to keep in one function.
const Composite = {
  // Region-sized scratches, reused across calls and kept alive on purpose — several are in flight
  // at once inside one pass, and a 4096² allocation per group per brush dab is exactly the
  // full-sheet cost the dirty-rectangle path exists to avoid (§3.4, §3.6).
  _s: {},
  scratch(key, w, h){
    const cur = Composite._s[key];
    return (cur && cur.width === w && cur.height === h) ? cur : (Composite._s[key] = mkCanvas(w, h));
  },
  reset(g){ g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none"; },
  // Full-sheet source → the piece of it this region needs, landing at the scratch origin. A source
  // of another size (a mask authored at a different resolution, a surface sheet half the albedo)
  // covers the same sheet and is scaled to it.
  blit(cx, tg, img){
    const kx = img.width / cx.W, ky = img.height / cx.H;
    tg.drawImage(img, cx.sx * kx, cx.sy * ky, cx.tw * kx, cx.th * ky, 0, 0, cx.tw, cx.th);
  },
  // The canvas this channel composites INTO. Colour's is the slot's own composite and always
  // exists; every other channel gets one made at its base sheet's size the first time anything
  // lands on it, and dropped again when the last layer goes — so `chanOut` falls back to the
  // untouched base rather than to a stale sheet.
  sheetFor(slot, ch, base){
    if (ch === "color") return slot.composite || null;
    if (!slot.chanC) slot.chanC = {};
    const W = base.width, H = base.height;
    let out = slot.chanC[ch];
    if (!out || out.width !== W || out.height !== H) { out = slot.chanC[ch] = mkCanvas(W, H); out._full = false; }
    return out;
  },

  // ---- the one walk ----
  // Returns { live, wrote }:
  //   live  — is anything on this channel at all. Colour is always live: its sheet is what the
  //           viewport samples, so it is built even when only the base is in it.
  //   wrote — the rectangle written, in THIS SHEET's texels; null for the whole sheet, and `false`
  //           when nothing was written (no sheet, nothing on the channel, or a dirty rectangle
  //           entirely off this sheet). `live` and `wrote` are separate answers because an
  //           off-sheet rectangle writes nothing while the channel is still there — collapsing the
  //           two would re-point the surface textures every time a stroke missed a sheet.
  sheet(slot, ch, rect){
    if (!slot) return { live: false, wrote: false };
    const base = chanBase(slot, ch);
    if (!base) return { live: false, wrote: false };
    // Colour aside, an empty channel has no sheet: drop it and say so.
    if (ch !== "color" && !chanHasLayers(slot, ch)) {
      if (slot.chanC) slot.chanC[ch] = null;
      return { live: false, wrote: false };
    }
    const out = Composite.sheetFor(slot, ch, base);
    if (!out) return { live: false, wrote: false };
    const W = out.width, H = out.height;
    // `rect` arrives in the slot's COMPOSITE space and this sheet need not be that size — a surface
    // map is routinely half the albedo (ROADMAP 1.15). And a region pass paints over pixels that
    // have to be there already, so the first pass on any sheet is whole however small the rectangle
    // is: without that, adding a layer and then stroking it leaves everything outside the stroke
    // transparent.
    // A blur or sharpen on this channel reads `reach` texels round each one (4.50 (5)), so a change
    // inside the dirty rectangle moves the result up to `reach` outside it, and each of THOSE texels
    // reads `reach` further still: the rectangle written back is the dirty one grown by the reach, and
    // the one composited is grown by twice it. Writing back only the dirty rectangle left a hard-edged
    // halo where a stroke under a blur stopped (review, 2026-10-23: 632 stale bytes, worst 29 levels,
    // for a 4 × 4 stroke under radius 6). A camouflage tile repeats, so its blur wraps round the
    // edges (`Effect.spatial`'s `wrap`), and there a region with a reach is the whole sheet.
    const m = rect && out._full ? Composite.reach(slot, ch) : 0, tile = m && CamoTile.is(slot);
    const grow = (Q, k) => Q && k ? rectClamp({ x: Q.x - k, y: Q.y - k, w: Q.w + 2 * k, h: Q.h + 2 * k }, W, H) : Q;
    const R0 = (rect && out._full && !tile) ? rectClamp(rectFromSlot(slot, rect, W, H), W, H) : null;
    if (rect && out._full && !tile && !R0) return { live: true, wrote: false };   // dirty area entirely off-sheet
    const R = grow(R0, m), G = grow(R0, 2 * m);
    // The live sheet is mip level 0 (ROADMAP 4.58): what the game shows up close. A layer limited to
    // further levels is built by `at` — for the export, and at idle for the views' own chain
    // (`LevelView`, 4.58 (b)), never here.
    const cx = { slot, ch, W, H, sx: G ? G.x : 0, sy: G ? G.y : 0, tw: G ? G.w : W, th: G ? G.h : H, wrap: !!CamoTile.is(slot), level: 0 };
    const target = R ? Composite.scratch("_reg", cx.tw, cx.th) : out;
    const into = { g: ctx2d(target), canvas: target };
    Composite.build(cx, into, base);
    if (R) {
      const g0 = ctx2d(out);
      Composite.reset(g0);
      g0.clearRect(R.x, R.y, R.w, R.h);
      g0.drawImage(target, R.x - G.x, R.y - G.y, R.w, R.h, R.x, R.y, R.w, R.h);
    } else { out._full = true; if (ch === "color") GradFill.prune(slot); }   // a position bake nothing reads any more goes (4.44's fifth)
    return { live: true, wrote: R };
  },
  // The base and the stack onto `into`, at the region's origin — the whole of a pass, shared by the
  // live sheet and `at`.
  build(cx, into, base){
    Composite.reset(into.g);
    into.g.clearRect(0, 0, cx.tw, cx.th);
    Composite.blit(cx, into.g, base);
    Composite.stack(cx, into, cx.slot.layers, 0);
    Composite.reset(into.g);
  },
  // ---- one channel at one mip level (ROADMAP 4.58, docs/MIP_LEVELS.md §4) ----
  // The same walk at full size with that level's set of layers — a far-only layer drawn from its first
  // level on, a near-only one dropped — onto a canvas of its own, never the live sheet, which stays
  // level 0. The export pads it and takes it down to its level in the pool. Null when nothing is on
  // the channel, so the caller reads the base, exactly as `chanOut` would. The caller owns the canvas
  // and gives its pixels back (`width = 0`) once it has read them: at 4096² it is 64 MB.
  // `rect` (4.58 (b), the views' own chain) builds only that rectangle of the sheet, onto a canvas its
  // size, the way a stroke's region pass does — for a channel with no blur or sharpen on it, since
  // those read past the rectangle (`reach`; the caller asks for the whole sheet there). `into`, when
  // it is a canvas of the size asked for, is reused.
  at(slot, ch, level, into, rect){
    const base = chanBase(slot, ch);
    if (!base || (ch !== "color" && !chanHasLayers(slot, ch))) return null;
    const ref = ch === "color" ? slot.composite : base;
    if (!ref) return null;
    const W = ref.width, H = ref.height, R = (rect && rectClamp(rect, W, H)) || { x: 0, y: 0, w: W, h: H };
    const out = into && into.width === R.w && into.height === R.h ? into : mkCanvas(R.w, R.h);
    const cx = { slot, ch, W, H, sx: R.x, sy: R.y, tw: R.w, th: R.h, wrap: !!CamoTile.is(slot), level };
    Composite.build(cx, { g: ctx2d(out), canvas: out }, base);
    return out;
  },
  // How far round a texel this channel's effects read: every visible blur's and sharpen's radius,
  // summed, since one over another reaches as far as both. 0 on every stack without one.
  reach(slot, ch){
    let m = 0;
    for (const L of visibleLeaves(slot.layers)) {
      const c = LayerNode.contentOn(L, ch);
      if (!c || c.kind !== "effect" || c.visible === false || !Effect.isSpatial(c.fx)) continue;
      // as `adjust` reads it — at the widest radius keys give it at any level (4.58 (c))
      const K = Levels.keyed(c) && c.keys.radius;
      m += Math.max(Effect.reach(Effect.clone(c.fx)), ...(K ? K.map(e => Effect.reach({ type: c.fx.type, radius: e[1] })) : []));
    }
    return m;
  },
  // One level of the stack, bottom first. `into` is the canvas being built AND its context — both,
  // because an effect has to read back what the stack has produced so far.
  stack(cx, into, nodes, depth){
    const g = into.g;
    for (const L of nodes) {
      if (!L.visible) continue;
      // Which mip levels it shows at (4.58): its opacity times its weight at the level being built,
      // and nothing at all where the weight is 0 — the part scope's idea along the chain instead of
      // over the model. A walk that names no level (one layer's own image) weighs everything 1.
      const lw = Levels.weight(L, cx.level);
      if (!lw) continue;
      if (isGroup(L)) { Composite.group(cx, into, L, depth, lw); continue; }
      // The address, not the tag: what does this node hold HERE? A layer holding nothing on this
      // channel is not this sheet's business — drawing it anyway is what made a "Metalness fill"
      // repaint the whole vehicle in the colour picked for it.
      // A number keyed by level (4.58 (c)) is drawn at its value here: the content as this level
      // sees it, which is the content itself wherever nothing is keyed.
      const c = Levels.content(LayerNode.contentOn(L, cx.ch), cx.level);
      if (!c || c.visible === false) continue;
      // A content can be hidden and faded on its own, not only through the layer around it
      // (ROADMAP 4.28(e)'s model, built in (f) because that is where the first user of it arrived).
      // `SurfDrag` needs it: a decal's derived response is stale for the length of a drag and has to
      // go dark without the decal going with it, and since (f) the two are the same node. Absent on
      // every content the app writes today except a derived one, so this costs a property read.
      g.globalAlpha = L.opacity * (c.opacity == null ? 1 : c.opacity) * Composite.ambAlpha(cx) * lw;
      g.globalCompositeOperation = L.blend === "normal" ? "source-over" : L.blend;
      if (c.kind === "effect") Composite.effect(cx, into, L, c, lw);
      else Composite.stencil(cx, into, L, tg => Composite.content(cx, tg, c, L));
    }
  },
  // ---- groups composite recursively (ROADMAP 4.9) ----
  // A group's children are drawn onto a scratch of their own and the result is then treated exactly
  // like one layer's content: the group's opacity, blend, mask and part scope apply to the
  // FLATTENED children. That is what makes a group a group rather than an indent, and it is why the
  // scratch is not optional — blending each child separately with the group's blend mode gives a
  // different picture. It is sized to the REGION and never to the sheet (§3.4), and keyed by DEPTH
  // so a group inside a group does not paint over its parent's.
  //
  // One consequence worth knowing: an effect inside a group reads the group's scratch, so it
  // adjusts the group's own content and not the layers beneath it. That is what a group whose blend
  // is "normal" means (Photoshop calls the other behaviour "pass through"), and it falls out of
  // flattening rather than being coded for.
  group(cx, into, G, depth, lw = 1){
    // Nothing of this channel inside it — skip before allocating anything. A decal group holding
    // colour, normal and smoothness children reaches this composite three times over, and two of
    // those have no work to do.
    if (!visibleLeaves(G.children).some(x => { const c = LayerNode.contentOn(x, cx.ch); return c && c.visible !== false; })) return;
    // ---- "pass through" (ROADMAP 4.9's last open piece) ----
    // A group's children are normally flattened onto a scratch and the result treated as one
    // layer's content — which is what makes a group a group, and which also means an EFFECT inside
    // one reads the group's own scratch and adjusts its siblings rather than the layers beneath it.
    // Photoshop calls the other behaviour "pass through" and makes it the default; this makes it a
    // blend mode you can choose, because changing the default would re-render every project that
    // already has a group in it.
    //
    // There is nothing to flatten here, so the group's mask, scope and opacity cannot be applied to
    // a flattened result — they are handed down and applied to each CHILD instead (`cx.amb`), which
    // is the same picture whenever the children do not overlap and an honest approximation when
    // they do. It nests: a pass-through group inside one chains, and a normal group inside one
    // flattens first and then takes the ambient on its result, which is why `amb` is cleared for the
    // recursion below and restored after it.
    const ambWas = cx.amb;
    if (G.blend === "pass through") {
      cx.amb = Composite.passAmb(cx, G);
      cx.amb.alpha *= lw;                            // its level weight rides with its opacity (4.58)
      Composite.stack(cx, into, G.children, depth + 1);
      cx.amb = ambWas;
      return;
    }
    const kids = Composite.scratch("_g" + depth, cx.tw, cx.th);
    const kg = ctx2d(kids);
    Composite.reset(kg);
    kg.clearRect(0, 0, cx.tw, cx.th);
    cx.amb = null;                                   // the children flatten on their own first
    Composite.stack(cx, { g: kg, canvas: kids }, G.children, depth + 1);
    cx.amb = ambWas;
    Composite.groupStencil(cx, into, G, kg);
    const g = into.g;
    g.globalAlpha = (G.opacity == null ? 1 : G.opacity) * Composite.ambAlpha(cx) * lw;
    g.globalCompositeOperation = G.blend && G.blend !== "normal" ? G.blend : "source-over";
    g.filter = "none";
    g.drawImage(kids, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  },
  // What a pass-through group hands down to each child in place of a flattened result: its mask,
  // its scope and its opacity, chained onto whatever an enclosing pass-through group handed down.
  // A step of its own, and `groupStencil` below with it, because the layered export
  // (`Interchange`, ROADMAP 4.50 (16)) walks the stack the same way to write each layer's pixels
  // out — and a second copy of these lines is how two compositors drifted apart before (4.28(c)).
  passAmb(cx, G){
    return { mask: LayerNode.maskCanvas(cx.slot, G), scope: Scope.stencil(cx.slot, G),
             alpha: G.opacity == null ? 1 : G.opacity, up: cx.amb };
  },
  // A normal group's own mask, scope and blend-if, plus any pass-through ancestor's mask and scope
  // (`cx.amb`, restored to the group's own ambient before this is called), as one alpha stencil on
  // the FLATTENED children in `kg` — the same pass a layer's content gets. A child's own mask has
  // already been applied to the child, so the two multiply, which is the behaviour to check against
  // Substance. The blend-if band is read off `into`, the sheet beneath the group (4.44's third).
  groupStencil(cx, into, G, kg){
    const scope = Scope.stencil(cx.slot, G);
    const gmask = LayerNode.maskCanvas(cx.slot, G);
    const gtone = Composite.tone(cx, into, G.tone);
    if (!gmask && !scope && !cx.amb && !gtone) return false;
    kg.globalCompositeOperation = "destination-in";
    if (gmask) Composite.blit(cx, kg, gmask);
    if (scope) Composite.blit(cx, kg, scope);
    if (gtone) kg.drawImage(gtone, 0, 0);
    // ...and any pass-through group around this one, on the FLATTENED result — which is where a
    // normal group's own mask lands, so it is where an inherited one belongs too.
    for (let a = cx.amb; a; a = a.up) {
      if (a.mask) Composite.blit(cx, kg, a.mask);
      if (a.scope) Composite.blit(cx, kg, a.scope);
    }
    kg.globalCompositeOperation = "source-over";
    return true;
  },
  // A layer can be limited to a set of model parts (the Substance-style polygon scope) and can
  // carry a hand-painted mask. Both are alpha stencils, so they combine in one pass — and with
  // neither, `draw` goes straight at the target and costs nothing.
  stencil(cx, into, L, draw){
    const scope = Scope.stencil(cx.slot, L);
    const amb = cx.amb;
    const mask = LayerNode.maskCanvas(cx.slot, L);          // painted, or another layer's pixels (4.36)
    const tone = Composite.tone(cx, into, L.tone);          // by what lies beneath (4.44's third candidate)
    if (!mask && !scope && !amb && !tone) { draw(into.g); return; }
    const tm = Composite.scratch("_m", cx.tw, cx.th), mg = ctx2d(tm);
    Composite.reset(mg);
    mg.clearRect(0, 0, cx.tw, cx.th);
    draw(mg);
    mg.globalCompositeOperation = "destination-in";
    if (mask) Composite.blit(cx, mg, mask);
    if (scope) Composite.blit(cx, mg, scope);
    if (tone) mg.drawImage(tone, 0, 0);                     // region-sized already, so no blit
    // The stencil of every enclosing PASS-THROUGH group (ROADMAP 4.9's last open piece). A normal
    // group applies its mask to the flattened children, which is why it is not here; a pass-through
    // group has no flattened result to apply anything to, so its mask lands on each child instead —
    // and the two multiply, exactly as a child's own mask multiplies its group's.
    for (let a = amb; a; a = a.up) {
      if (a.mask) Composite.blit(cx, mg, a.mask);
      if (a.scope) Composite.blit(cx, mg, a.scope);
    }
    mg.globalCompositeOperation = "source-over";
    into.g.drawImage(tm, 0, 0);
  },
  // ---- blend-if: a stencil read off what the stack has built so far (ROADMAP 4.44, third) ----
  // Photoshop's *Blend If: underlying layer*, Substance's *mask by colour*. `T` is the layer's
  // `tone` — `{ src, lo, hi, soft, invert, color }` — and the answer is a region-sized alpha
  // sheet: 1 where the sheet beneath, at this point in the walk, is within the band, 0 outside,
  // ramped over `soft` at each end. `src` is the luminance (0…1) or, for "color", the nearness to a
  // picked colour (1 = that colour, 0 = its RGB opposite), so a colour mask is the same band read
  // near 1. It multiplies with the painted mask, the scope and any pass-through ancestor, like every
  // other stencil.
  //
  // It reads `into.canvas`, which is the REGION's scratch on the dirty-rectangle path and the whole
  // sheet on the first pass — a full-sheet `getImageData` there, which is the one canvas cost this
  // app avoids everywhere else (wt-canvas skill). It is paid only by a sheet that has a tone-masked
  // layer on it, and only on a whole-sheet composite (a load, a resize, a new layer); a brush dab
  // reads its own few hundred texels. Inside a normal group the "beneath" is the group's own
  // flattened content, the way an effect inside a group sees it; inside a pass-through group it is
  // the sheet.
  tone(cx, into, T){
    if (!T || T.on === false) return null;
    const lo = Math.max(0, Math.min(1, +T.lo || 0)), hi = Math.max(lo, Math.min(1, T.hi == null ? 1 : +T.hi));
    const col = T.src === "color" ? Composite.rgb(T.color) : null, S2 = 195075;   // (√3·255)²
    // A HARD edge is compared exactly, and identically on both passes — or a texel sitting on the
    // edge could be in on one and out on the other, which is a whole texel of difference, not one
    // level. Luminance is kept as the integer 2126r + 7152g + 722b (the Rec. 709 weights ×10⁴, at most
    // 2 550 000, exact in float32); "near a colour" as the integer squared distance, whose band is
    // [(1−hi)², (1−lo)²]·S2. Both thresholds go through Math.fround, so the CPU compares against the
    // very float the shader receives. A SOFT edge is a ramp, and there the two agree to one level.
    const band = { lo, hi, soft: Math.max(0, Math.min(1, +T.soft || 0)), inv: !!T.invert, col,
                   tLo: Math.fround(col ? (1 - hi) * (1 - hi) * S2 : lo * 2550000),
                   tHi: Math.fround(col ? (1 - lo) * (1 - lo) * S2 : hi * 2550000) };
    return Composite.toneGL.draw(cx, into, band) || Composite.toneCPU(cx, into, band);
  },
  // The band on the CPU: a whole-region readback, a loop, and a putImageData. It is the reference
  // the GPU pass is measured against (t68) and the fallback wherever WebGL is missing or refuses.
  toneCPU(cx, into, B){
    const src = ctx2d(into.canvas).getImageData(0, 0, cx.tw, cx.th).data;
    const out = Composite.scratch("_t", cx.tw, cx.th), og = ctx2d(out);
    const img = og.createImageData(cx.tw, cx.th), od = img.data;
    const K = 1 / (Math.sqrt(3) * 255), lo = B.lo, hi = B.hi, soft = B.soft;
    const [cr, cg, cb] = B.col || [0, 0, 0];
    for (let i = 0, n = cx.tw * cx.th; i < n; i++) {
      const k = i * 4;
      let v, x;
      if (B.col) { const dr = src[k] - cr, dg = src[k+1] - cg, db = src[k+2] - cb; x = dr*dr + dg*dg + db*db; v = 1 - Math.sqrt(x) * K; }
      else { x = src[k] * 2126 + src[k+1] * 7152 + src[k+2] * 722; v = x / 2550000; }
      let a;
      if (soft > 0) a = Math.max(0, Math.min(1, (v - lo + soft) / soft)) * Math.max(0, Math.min(1, (hi + soft - v) / soft));
      else a = (x >= B.tLo && x <= B.tHi) ? 1 : 0;
      if (B.inv) a = 1 - a;
      od[k] = od[k+1] = od[k+2] = 255;
      od[k+3] = Math.round(a * 255);
    }
    og.putImageData(img, 0, 0);
    return out;
  },
  // ---- one GL context for the per-texel passes: blend-if's band and an effect's tables ----
  // Both are "upload the region, run one fragment shader over it, draw the result into a region-
  // sized scratch", so they share one context, one quad and one source texture (4.50 (5)). A second
  // context would keep a second copy of the largest region either had seen — a 64 MB drawing buffer
  // plus a 64 MB texture at 4096², four times that at 8192² — for as long as the page stays open.
  // Each pass keeps its own program and its own `st` / `dead`, so one that fails to build falls back
  // to the CPU on its own and a test can force either one off. A lost context is dropped and made
  // again on the next call, and a pass whose program belonged to the lost one builds it again.
  gl: {
    st: null, dead: false,
    init(){
      const G = Composite.gl;
      if (G.st || G.dead) return G.st;
      try {
        const canvas = mkCanvas(1, 1);
        const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
        if (!gl) { G.dead = true; return null; }
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        // what getImageData gives: straight (unpremultiplied) colour, top row first
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); G.st = null; });
        G.st = { canvas, gl, max: gl.getParameter(gl.MAX_TEXTURE_SIZE), src: Composite.gl.texture(gl) };
      } catch (e) { G.dead = true; G.st = null; reportFailure("setting up the GPU pass for blend-if and effects (the CPU one is used instead)", e, "compGL"); }
      return G.st;
    },
    // NEAREST, clamped, no mips: one texel in, the same texel out — the shaders sample texel centres.
    texture(gl){
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    },
    // A pass's program on the shared context, its one attribute bound to location 0 so the quad
    // above serves every program. Null with no context; throws on a compile or link error.
    program(FS, names){
      const C = Composite.gl.init();
      if (!C) return null;
      const gl = C.gl;
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || "shader"); return o; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, "p");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
      const u = {};
      for (const k of names) u[k] = gl.getUniformLocation(prog, k);
      return { C, gl, prog, u };
    },
    // Is pass `P`'s program still one of the live context's? Build it (again) if not.
    pass(P, FS, names, what){
      if (P.dead) return null;
      if (P.st && P.st.C === Composite.gl.st) return P.st;
      try { P.st = Composite.gl.program(FS, names); if (!P.st) P.dead = true; }
      catch (e) { P.dead = true; P.st = null; reportFailure("setting up " + what + " (the CPU one is used instead)", e, what); }
      return P.st;
    },
    // Upload the region (`into.canvas`), run pass `S` with `set(gl, S)` setting its uniforms, and
    // draw the result into the region-sized scratch `key`. Null on any refusal — the CPU pass runs.
    run(cx, into, S, set, key){
      const C = S.C, gl = S.gl;
      if (C !== Composite.gl.st || gl.isContextLost() || cx.tw > C.max || cx.th > C.max) return null;
      if (C.canvas.width !== cx.tw || C.canvas.height !== cx.th) { C.canvas.width = cx.tw; C.canvas.height = cx.th; }
      gl.viewport(0, 0, cx.tw, cx.th);
      gl.useProgram(S.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, C.src);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, into.canvas);
      set(gl, S);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (gl.getError() !== gl.NO_ERROR) return null;
      const out = Composite.scratch(key, cx.tw, cx.th), og = ctx2d(out);
      Composite.reset(og);
      og.clearRect(0, 0, cx.tw, cx.th);
      og.drawImage(C.canvas, 0, 0);
      return out;
    },
  },
  // The same band on the GPU. MEASURED 2026-09-24 on a mid-range desktop GPU, one blend-if layer in a
  // 22-leaf stack: a whole-sheet composite blocked the UI thread 120–220 ms at 2048² and 400–500 ms
  // at 4096², and EVERY frame of a slider drag on any layer of that sheet is a whole-sheet composite
  // (familyApply → scheduleComposite with no rectangle) — two frames a second. Of the ~300 ms at
  // 4096², the readback was ~35, the loop ~70 and the putImageData and its re-upload ~200: the
  // pixels went GPU → CPU → GPU to compute one alpha per texel. Here they never leave the GPU:
  // the region is uploaded as a texture (a GPU-to-GPU copy from an accelerated canvas), the band is
  // one fragment shader with the CPU loop's own arithmetic, and the result is drawn into the "_t"
  // scratch. `t68` holds the two paths to one level of alpha on every texel. Anything that fails —
  // no WebGL, a lost context, a region over the texture limit — returns null and the CPU pass runs.
  toneGL: {
    st: null, dead: false,
    FS: "precision highp float;\n" +
        "uniform sampler2D u_src; uniform vec2 u_size; uniform vec4 u_band; uniform vec3 u_col; uniform vec2 u_hard; uniform float u_mode;\n" +
        "void main(){\n" +
        // the texel's own bytes back, exactly: one sample at its centre, ×255, rounded
        "  vec3 b = floor(texture2D(u_src, vec2(gl_FragCoord.x / u_size.x, 1.0 - gl_FragCoord.y / u_size.y)).rgb * 255.0 + 0.5);\n" +
        "  float x, v;\n" +
        "  if (u_mode > .5) { vec3 d = b - u_col; x = dot(d, d); v = 1.0 - sqrt(x) / (sqrt(3.0) * 255.0); }\n" +
        "  else { x = dot(b, vec3(2126.0, 7152.0, 722.0)); v = x / 2550000.0; }\n" +
        "  float lo = u_band.x, hi = u_band.y, soft = u_band.z, a;\n" +
        "  if (soft > 0.0) a = clamp((v - lo + soft) / soft, 0.0, 1.0) * clamp((hi + soft - v) / soft, 0.0, 1.0);\n" +
        "  else a = (x >= u_hard.x && x <= u_hard.y) ? 1.0 : 0.0;\n" +
        "  if (u_band.w > .5) a = 1.0 - a;\n" +
        "  gl_FragColor = vec4(1.0, 1.0, 1.0, a);\n" +
        "}",
    init(){ const T = Composite.toneGL; return Composite.gl.pass(T, T.FS, ["u_src", "u_size", "u_band", "u_col", "u_hard", "u_mode"], "the GPU blend-if pass"); },
    draw(cx, into, B){
      const S = Composite.toneGL.init();
      if (!S) return null;
      return Composite.gl.run(cx, into, S, (gl, S) => {
        gl.uniform1i(S.u.u_src, 0);
        gl.uniform2f(S.u.u_size, cx.tw, cx.th);
        gl.uniform4f(S.u.u_band, B.lo, B.hi, B.soft, B.inv ? 1 : 0);
        const c = B.col || [0, 0, 0];
        gl.uniform3f(S.u.u_col, c[0], c[1], c[2]);             // bytes, as the shader recovers the texel's
        gl.uniform2f(S.u.u_hard, B.tLo, B.tHi);
        gl.uniform1f(S.u.u_mode, B.col ? 1 : 0);
      }, "_t");
    },
  },
  // ---- an effect's tables on the GPU (ROADMAP 4.50 (5)) ----
  // The pass `Effect.apply` describes — per channel, then by luma (map or offset), then keep luma —
  // as one fragment shader over the region, reading the kind's two tables as a 256 × 2 texture
  // sampled at texel centres. Every value in it is an integer float32 holds exactly, the luma byte
  // is floored and then checked back by multiplication (a divide on the GPU may be an ulp or two
  // out), and the one division that is not exact never lands within 1/510 of a rounding point — so
  // it agrees with the CPU pass on every texel, not merely to a level (`t92`).
  //
  // MEASURED 2026-09-26 on a mid-range desktop GPU (ANGLE D3D11, not the suite's --disable-gpu), a
  // whole-sheet colour composite, several per 1×1 barrier: with a Levels layer 22 ms at 4096² and
  // 2.6 ms at 2048² — no effect at all measured 27 and 3, so the pass is inside the noise — against
  // 329 ms and 64 ms for the same composite on the CPU pass. A whole-sheet composite is every frame
  // of a slider drag on any layer of the sheet, which is why the CPU pass is only the fallback.
  fxGL: {
    st: null, dead: false,
    FS: "precision highp float;\n" +
        "uniform sampler2D u_src; uniform sampler2D u_lut; uniform vec2 u_size; uniform float u_mode; uniform float u_keep;\n" +
        "float luma(vec3 c){\n" +
        "  float x = dot(c, vec3(2126.0, 7152.0, 722.0)) + 5000.0;\n" +
        "  float y = floor(x / 10000.0);\n" +
        "  if (y * 10000.0 > x) y -= 1.0; else if ((y + 1.0) * 10000.0 <= x) y += 1.0;\n" +
        "  return y;\n" +
        "}\n" +
        "vec4 lut(float i, float row){ return floor(texture2D(u_lut, vec2((i + 0.5) / 256.0, (row + 0.5) / 2.0)) * 255.0 + 0.5); }\n" +
        "void main(){\n" +
        "  vec4 t = texture2D(u_src, vec2(gl_FragCoord.x / u_size.x, 1.0 - gl_FragCoord.y / u_size.y));\n" +
        "  vec3 b = floor(t.rgb * 255.0 + 0.5);\n" +
        "  vec3 o = vec3(lut(b.r, 0.0).r, lut(b.g, 0.0).g, lut(b.b, 0.0).b);\n" +
        "  float y = luma(o);\n" +
        "  if (u_mode > 1.5) o = clamp(o + lut(y, 1.0).rgb - 128.0, 0.0, 255.0);\n" +
        "  else if (u_mode > 0.5) { vec4 m = lut(y, 1.0); o = o + floor((m.rgb - o) * m.a / 255.0 + 0.5); }\n" +
        "  if (u_keep > 0.5) o = clamp(o + (y - luma(o)), 0.0, 255.0);\n" +
        "  gl_FragColor = vec4(o / 255.0, 1.0);\n" +             // opaque: `effect` says why
        "}",
    init(){
      const F = Composite.fxGL, was = F.st;
      const S = Composite.gl.pass(F, F.FS, ["u_src", "u_lut", "u_size", "u_mode", "u_keep"], "the GPU effect pass");
      if (S && S !== was) S.lut = Composite.gl.texture(S.gl);     // a new program: its table texture, on the same context
      return S;
    },
    draw(cx, into, T){
      const S = Composite.fxGL.init();
      if (!S) return null;
      return Composite.gl.run(cx, into, S, (gl, S) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, S.lut);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, T.buf);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(S.u.u_src, 0);
        gl.uniform1i(S.u.u_lut, 1);
        gl.uniform2f(S.u.u_size, cx.tw, cx.th);
        gl.uniform1f(S.u.u_mode, T.mode);
        gl.uniform1f(S.u.u_keep, T.keep ? 1 : 0);
      }, "_fxo");
    },
  },
  // The same pass on the CPU: the region read back, `Effect.apply`, written into the same scratch —
  // opaque, as the GPU's is.
  fxCPU(cx, into, T){
    const img = ctx2d(into.canvas).getImageData(0, 0, cx.tw, cx.th), d = img.data;
    Effect.apply(T, d);
    for (let k = 3; k < d.length; k += 4) d[k] = 255;
    const out = Composite.scratch("_fxo", cx.tw, cx.th);
    ctx2d(out).putImageData(img, 0, 0);
    return out;
  },
  // ---- blur, sharpen and noise on the GPU (ROADMAP 4.50 (5), second step) ----
  // `Effect.spatial`'s steps as one program on the shared context: mode 0 lays the across pass,
  // premultiplied, into a framebuffer of bytes (as the CPU keeps it), and mode 1 (blur) or 2 (sharpen)
  // reads it down and writes straight, opaque colour; mode 3 is the noise, one pass, its tile read at
  // the texel's place on the sheet — `u_off` is the region's corner. The weights are a uniform array
  // out to MAX_R, each tap taken twice (±i) so the array is indexed by the loop alone, as GLSL ES 1.0
  // asks. CLAMP_TO_EDGE is the CPU's clamped index. Anything refused returns null: the CPU runs.
  spaceGL: {
    st: null, dead: false,
    FS: "precision highp float;\n" +
        "uniform sampler2D u_src; uniform sampler2D u_mid; uniform sampler2D u_tile;\n" +
        "uniform vec2 u_size; uniform vec2 u_off; uniform float u_mode; uniform float u_r; uniform float u_amt; uniform float u_mono; uniform float u_wrap;\n" +
        "uniform float u_w[33];\n" +
        "vec4 at(sampler2D s, vec2 p){ return floor(texture2D(s, u_wrap > 0.5 ? fract(p) : p) * 255.0 + 0.5); }\n" +
        "vec4 pm(vec4 t){ return vec4(t.rgb * t.a / 255.0, t.a); }\n" +
        "void main(){\n" +
        "  vec2 f = gl_FragCoord.xy; float y = 1.0 - f.y / u_size.y;\n" +
        "  vec3 s = at(u_src, vec2(f.x / u_size.x, y)).rgb;\n" +
        "  if (u_mode > 2.5) {\n" +
        "    vec2 q = mod(vec2(floor(f.x), u_size.y - 0.5 - f.y) + u_off, 256.0);\n" +
        "    vec4 n = at(u_tile, (q + 0.5) / 256.0);\n" +
        "    vec3 d = u_mono > 0.5 ? vec3(n.r) : n.rgb;\n" +
        "    gl_FragColor = vec4(clamp(s + floor((d - 128.0) * u_amt / 128.0 + 0.5), 0.0, 255.0) / 255.0, 1.0);\n" +
        "    return;\n" +
        "  }\n" +
        "  vec4 acc = vec4(0.0);\n" +
        "  for (int i = 0; i <= 32; i++) {\n" +
        "    float k = float(i);\n" +
        "    if (k > u_r) break;\n" +
        "    if (u_mode < 0.5) {\n" +
        "      vec4 a = pm(at(u_src, vec2((f.x + k) / u_size.x, y)));\n" +
        "      if (i > 0) a += pm(at(u_src, vec2((f.x - k) / u_size.x, y)));\n" +
        "      acc += u_w[i] * a;\n" +
        "    } else {\n" +
        "      vec4 a = at(u_mid, vec2(f.x / u_size.x, (f.y + k) / u_size.y));\n" +
        "      if (i > 0) a += at(u_mid, vec2(f.x / u_size.x, (f.y - k) / u_size.y));\n" +
        "      acc += u_w[i] * a;\n" +
        "    }\n" +
        "  }\n" +
        "  if (u_mode < 0.5) { gl_FragColor = floor(acc + 0.5) / 255.0; return; }\n" +
        "  vec3 b = acc.a > 0.0 ? acc.rgb * 255.0 / acc.a : vec3(0.0);\n" +
        "  vec3 o = u_mode > 1.5 ? s + (s - b) * u_amt : b;\n" +
        "  gl_FragColor = vec4(clamp(floor(o + 0.5), 0.0, 255.0) / 255.0, 1.0);\n" +
        "}",
    init(){
      const F = Composite.spaceGL, was = F.st;
      const S = Composite.gl.pass(F, F.FS, ["u_src", "u_mid", "u_tile", "u_size", "u_off", "u_mode", "u_r", "u_amt", "u_mono", "u_wrap", "u_w"], "the GPU blur, sharpen and noise pass");
      if (S && S !== was) { const gl = S.gl; S.mid = Composite.gl.texture(gl); S.tile = Composite.gl.texture(gl); S.fbo = gl.createFramebuffer(); S.seed = null; S.mw = S.mh = 0; }
      return S;
    },
    draw(cx, into, fx, grey, wrap){
      const S = Composite.spaceGL.init();
      if (!S) return null;
      const C = S.C, gl = S.gl, w = cx.tw, h = cx.th, u = S.u;
      if (C !== Composite.gl.st || gl.isContextLost() || w > C.max || h > C.max) return null;
      if (C.canvas.width !== w || C.canvas.height !== h) { C.canvas.width = w; C.canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.useProgram(S.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, C.src);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, into.canvas);
      gl.uniform1i(u.u_src, 0); gl.uniform1i(u.u_mid, 1); gl.uniform1i(u.u_tile, 2);
      gl.uniform2f(u.u_size, w, h); gl.uniform2f(u.u_off, cx.sx, cx.sy); gl.uniform1f(u.u_wrap, wrap ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);                    // not the framebuffer's own texture while it is drawn into
      if (fx.type === "noise") {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, S.tile);
        if (S.seed !== fx.seed) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, Effect.tile(fx.seed)); S.seed = fx.seed; }
        gl.uniform1f(u.u_mode, 3); gl.uniform1f(u.u_amt, fx.amount); gl.uniform1f(u.u_mono, grey || fx.mono ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const r = Effect.reach(fx), wts = new Float32Array(33);
        wts.set(Effect.weights(r));
        gl.uniform1fv(u.u_w, wts); gl.uniform1f(u.u_r, r);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, S.mid);
        if (S.mw !== w || S.mh !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); S.mw = w; S.mh = h; }
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, S.mid, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        if (ok) { gl.uniform1f(u.u_mode, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) { gl.activeTexture(gl.TEXTURE0); return null; }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, S.mid);
        gl.uniform1f(u.u_mode, fx.type === "sharpen" ? 2 : 1); gl.uniform1f(u.u_amt, fx.type === "sharpen" ? fx.amount / 100 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.activeTexture(gl.TEXTURE0);
      if (gl.getError() !== gl.NO_ERROR) return null;
      const out = Composite.scratch("_fxo", w, h), og = ctx2d(out);
      Composite.reset(og);
      og.clearRect(0, 0, w, h);
      og.drawImage(C.canvas, 0, 0);
      return out;
    },
  },
  // The same on the CPU — the region read back, `Effect.spatial`, written into the same scratch.
  spaceCPU(cx, into, fx, grey, wrap){
    const img = ctx2d(into.canvas).getImageData(0, 0, cx.tw, cx.th);
    img.data.set(Effect.spatial(fx, img.data, cx.tw, cx.th, cx.sx, cx.sy, grey, wrap));
    const out = Composite.scratch("_fxo", cx.tw, cx.th);
    ctx2d(out).putImageData(img, 0, 0);
    return out;
  },
  rgb(hex){
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
  },
  // What every enclosing pass-through group multiplies into a child's opacity. One walk of a chain
  // that is empty in every stack that has no pass-through group in it, which is all of them until
  // somebody chooses one.
  ambAlpha(cx){ let k = 1; for (let a = cx.amb; a; a = a.up) k *= a.alpha; return k; },
  // One channel slot's content, drawn at the region's origin. `fill` and `paint` mean the same
  // thing on every channel; an `image` carries its own placement and stamps its mirrored copy
  // inside the same layer. A fill carrying a gradient (4.44's fifth candidate), a noise or a
  // pattern (4.50 (7), (8)) is drawn by `GradFill`, which needs the layer for its rectangle limit —
  // the one content that does.
  content(cx, tg, c, L){
    if (c.kind === "fill") {
      if (c.grad || c.pat) GradFill.draw(cx, tg, c, L);
      else { tg.fillStyle = c.color; tg.fillRect(0, 0, cx.tw, cx.th); }
      return;
    }
    if (c.kind === "paint") { if (c.canvas) Composite.blit(cx, tg, c.canvas); return; }
    if (c.kind !== "image" || !c.bmp) return;
    const d = decalDraw(c);
    const stamp = (px, py, rot, xs) => {
      tg.save();
      tg.translate(px * cx.W - cx.sx, py * cx.H - cx.sy); tg.rotate(rot * Math.PI / 180); tg.scale(xs, 1);
      tg.imageSmoothingQuality = "high";
      tg.drawImage(d.img, -d.w / 2, -d.h / 2, d.w, d.h);
      tg.restore();
    };
    // On a camouflage tile every placement is drawn once per neighbouring copy as well, so a decal
    // over an edge comes back in on the other side (ROADMAP 4.50 (6)); the canvas clips the rest.
    // Asked of the SLOT, not of the walk: Layer ▸ export "on the sheet" and a decal converted to
    // paint place content here without the sheet walk, and both dropped the wrapped half while only
    // the walk said "wrap" (review of 4.50 (6), 2026-09-26).
    const sh = CamoTile.shifts(CamoTile.is(cx.slot));
    for (const j of sh) for (const i of sh) {
      stamp(c.x + i, c.y + j, c.rot, c.flip ? -1 : 1);
      if (c.sym) stamp(c.sym.x + i, c.sym.y + j, -c.rot, c.flip ? 1 : -1);   // mirrored copy inside the same layer
    }
  },
  // The filter a hue / saturation / brightness / contrast effect applies — one copy, because the
  // layered export renders an effect's result as a layer of its own and must apply exactly this
  // (ROADMAP 4.50 (16)).
  fxFilter(c){ return `hue-rotate(${c.hue}deg) saturate(${c.sat}%) brightness(${c.bright}%) contrast(${c.contrast}%)`; },
  // Every effect, whatever its kind, is an adjusted copy of what the stack has produced so far — made
  // by `adjust` — drawn over the stack at the layer's opacity, through its stencil. Nothing is copied
  // out first: each pass READS the region and writes a separate canvas, so the stack under it is
  // still whole when the result lands. A kind this build does not know adjusts nothing and draws
  // nothing. Masked or part-scoped, it takes the same stencil pass as any other content — the reason
  // an effect applies on a greyscale channel as well (4.28's D2). What refuses one there is the
  // Layers panel, which is a judgement about hue rotation on a roughness map and not a limit of the
  // composite.
  //
  // The copy is OPAQUE and lands `source-atop`, so an effect changes colour and never coverage:
  // the stack's alpha stays exactly what it was, and the colour is the plain cross-fade
  // adjusted · k + beneath · (1 − k), k being opacity × mask. Drawn `source-over` with the stack's
  // own alpha instead, a 70 % paint layer inside a group came out 91 % with a Levels AT REST over it
  // (0.7 + 0.7 · 0.3): measured 2026-09-26 by t92, 45 levels off on 37 266 bytes of a 256² sheet,
  // from an effect that should change nothing. That is the layer composited twice, the wt-canvas
  // skill's "invisible while it is opaque and obvious once it is not". On an opaque sheet — every
  // top-level composite — the two are the same pixels. The four numbers drew that way until
  // 2026-10-23 (a 0.69-coverage layer came out 0.90); they land the same way as the rest now.
  effect(cx, into, L, c, lw = 1){
    const adj = Composite.adjust(cx, into, c);
    if (!adj) return;
    const g = into.g;
    Composite.reset(g);
    g.globalAlpha = L.opacity * Composite.ambAlpha(cx) * lw;
    g.globalCompositeOperation = "source-atop";
    Composite.stencil(cx, into, L, dst => dst.drawImage(adj, 0, 0));
    Composite.reset(g);
  },
  // The adjusted copy of the region, opaque, or null. One function, because the layered export
  // renders an effect's result as a layer of its own and must draw exactly this (4.50 (16)):
  //   the four numbers  the CSS filter over a copy of the stack, made opaque by the identity
  //                     tables — the GPU upload reads straight colour, and the pass writes alpha 1
  //   blur, sharpen,    `Effect.spatial`'s steps, on the GPU where it can be, on the CPU where it
  //   noise             cannot (single-value channels take noise mono)
  //   every other kind  its tables, the same way (4.50 (5)).
  adjust(cx, into, c){
    if (Effect.atRest(c)) return null;               // a new effect layer, before anything is set: no pass at all
    if (!c.fx) {
      const tmp = Composite.scratch("_fx", cx.tw, cx.th), tg = ctx2d(tmp), T = Effect.identity();
      Composite.reset(tg);
      tg.clearRect(0, 0, cx.tw, cx.th);
      tg.filter = Composite.fxFilter(c);
      tg.drawImage(into.canvas, 0, 0);
      tg.filter = "none";
      const src = { g: tg, canvas: tmp };
      return Composite.fxGL.draw(cx, src, T) || Composite.fxCPU(cx, src, T);
    }
    if (Effect.isSpatial(c.fx)) {
      const fx = Effect.clone(c.fx), grey = cx.ch !== "color";
      return Composite.spaceGL.draw(cx, into, fx, grey, cx.wrap) || Composite.spaceCPU(cx, into, fx, grey, cx.wrap);
    }
    const T = Effect.table(c);
    if (!T) return null;
    return Composite.fxGL.draw(cx, into, T) || Composite.fxCPU(cx, into, T);
  },
};
// The albedo, plus the three things only the albedo does afterwards: it is the sheet the viewport
// samples, the sheet the 2-D view draws, and the sheet a slot's thumbnail comes from.
//
// The composite carries colour only, always opaque. The coverage mask War Thunder reads out of the
// albedo's alpha is kept beside it (coverageBytes / slot.texCov) and applied by the shader and by
// the 2-D view, so no frame of a stroke ever has to touch a full sheet.
function compositeSlot(slot, rect){
  const done = Composite.sheet(slot, "color", rect);
  if (done.wrote === false) return;                          // nothing changed: nothing to upload
  if (slot.tex) { uploadTexRegion(slot.tex, slot.composite, done.wrote); needsRender(); }
  LevelView.touched(slot, "color", done.wrote);              // its own levels follow at idle (4.58 (b))
  if (App.chanView && App.chanView !== "shaded") refreshChannelTextures(slot);
  slot.thumbDirty = true;
  slot.thumbRev = (slot.thumbRev || 0) + 1;
  if (slot === App.activeSlot) draw2D();
}
function coverageSource(slot){
  if (!slot || !slot.baseC) return null;
  if (chanHasLayers(slot, "wear")) return (slot.chanC && slot.chanC.wear) || null;
  if (!slot.covBase) return null;                             // nothing imported to preserve
  return ensureWearCanvas(slot);
}
// The coverage sheet as a texture the GPU can sample, so the viewport blends the camouflage
// through it with no per-frame CPU work at all. Rebuilt only when the wear stack changes.
function refreshCoverageTexture(slot){
  const src = coverageSource(slot);
  if (!src) {
    if (slot.texCov) { slot.texCov.dispose(); slot.texCov = null; rebuildMaterials(); }
    return null;
  }
  if (!slot.texCov || slot.texCov.image !== src) {
    if (slot.texCov) slot.texCov.dispose();
    slot.texCov = new THREE.CanvasTexture(src);
    slot.texCov.wrapS = slot.texCov.wrapT = THREE.RepeatWrapping;
    slot.texCov.encoding = THREE.LinearEncoding;
    rebuildMaterials();                                       // the alphaMap binding changed
  } else slot.texCov.needsUpdate = true;
  needsRender();
  return slot.texCov;
}
// The coverage sheet as one byte per texel — what the exporter writes into the albedo's alpha.
// Kept as plain bytes so nothing ever has to read a texture sheet back off the GPU (a full
// `getImageData` of an 8192² canvas measured ~520 ms and stalls the whole frame). The imported
// half comes from the decoded pixels in fillSlotAlbedo; only a hand-painted wear stack has to be
// read back, and then only over the rectangle the stroke touched.
function coverageBytes(slot, rect){
  if (!slot || !slot.baseC) return null;
  const W = slot.baseC.width, H = slot.baseC.height;
  if (!chanHasLayers(slot, "wear")) { slot._cov = null; return slot.covBase || null; }
  const src = slot.chanC && slot.chanC.wear;
  if (!src) return slot.covBase || null;
  let cov = slot._cov;
  if (!cov || cov.length !== src.width * src.height) {
    cov = slot._cov = new Uint8Array(src.width * src.height);
    rect = null;                                              // fresh array: fill all of it
  }
  const R = rect ? rectClamp(rectScale(rect, src.width / W, src.height / H), src.width, src.height)
    : { x: 0, y: 0, w: src.width, h: src.height };
  if (!R || R.w <= 0 || R.h <= 0) return cov;
  const x0 = Math.max(0, Math.floor(R.x)), y0 = Math.max(0, Math.floor(R.y));
  const rw = Math.min(src.width - x0, Math.ceil(R.w)), rh = Math.min(src.height - y0, Math.ceil(R.h));
  if (rw <= 0 || rh <= 0) return cov;
  const d = ctx2d(src).getImageData(x0, y0, rw, rh).data;
  for (let y = 0; y < rh; y++) {
    let o = (y0 + y) * src.width + x0, i = y * rw * 4;
    for (let x = 0; x < rw; x++, o++, i += 4) cov[o] = d[i];
  }
  return cov;
}
// The coverage bytes at the albedo's own resolution, for export.
//
// This is the single most load-bearing function in the exporter: whatever it fails to return ships
// as alpha 255, and alpha 255 means "cover the player's camouflage completely", i.e. a flat repaint
// with no wear anywhere. It used to read `slot._cov`, a cache that only compositeChannels() fills —
// so a wear layer that had been added but never painted on, a project just loaded from disk, or a
// slot whose channels had not been recomposited since a resize all exported a fully opaque sheet
// and silently threw the mask away. It now derives the answer every time, and falls back through
// every place the mask could still be found before giving up.
// `level` (ROADMAP 4.58) asks for the mask at that mip level: a wear layer can be limited to some
// levels like any other, and the restart's alpha is that level's. Absent, it is the live mask.
function coverageForExport(slot, w, h, level){
  if (!slot) return null;
  let cov = null, sw = 0, sh = 0;
  // 1) a hand-painted wear/coverage stack — recomposited here rather than trusted from a cache
  if (chanHasLayers(slot, "wear")) {
    const own = level ? Composite.at(slot, "wear", level) : null;
    if (!own) Composite.sheet(slot, "wear", null);
    const src = own || (slot.chanC && slot.chanC.wear);
    if (src && src.width && src.height) {
      sw = src.width; sh = src.height;
      const d = ctx2d(src).getImageData(0, 0, sw, sh).data;
      cov = new Uint8Array(sw * sh);
      for (let i = 0, n = sw * sh; i < n; i++) cov[i] = d[i*4];
    }
    if (own) own.width = own.height = 0;                       // read: give the 64 MB back
  }
  // 2) the mask the imported / stock texture came in with
  if (!cov && slot.covBase && slot.baseC && slot.covBase.length === slot.baseC.width * slot.baseC.height) {
    cov = slot.covBase; sw = slot.baseC.width; sh = slot.baseC.height;
  }
  // 3) last resort — straight out of the decoded source texture. Reached when a slot was rebuilt
  //    without going through fillSlotAlbedo, which is where covBase is normally taken.
  if (!cov) {
    const d = App.decoded.get(String(slot.cStem || "").toLowerCase());
    const mip = d && d.mips && d.mips[0];
    if (mip && mip.rgba && d.width && d.height && mip.rgba.length >= d.width * d.height * 4) {
      sw = d.width; sh = d.height;
      cov = new Uint8Array(sw * sh);
      for (let i = 0, n = sw * sh; i < n; i++) cov[i] = mip.rgba[i*4+3];
    }
  }
  if (!cov) return null;
  if (sw === w && sh === h) return cov;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, (y * sh / h) | 0);
    for (let x = 0; x < w; x++) out[y * w + x] = cov[sy * sw + Math.min(sw - 1, (x * sw / w) | 0)];
  }
  return out;
}
let compTimer = false;
const compPending = new Map();                              // slot -> accumulated dirty rect (null = whole sheet)
function scheduleComposite(slot, rect){
  if (!slot) return;
  if (!rect) chanPending.set(slot, null);                     // structural change - channels may have moved
  if (compPending.has(slot)) {
    const cur = compPending.get(slot);
    compPending.set(slot, cur && rect ? rectUnion(cur, rect) : null);
  } else compPending.set(slot, rect || null);
  if (compTimer) return;
  compTimer = true;
  requestAnimationFrame(() => { compTimer = false; const t0 = Rec.clock(); flushComposites(); Rec.span("composite", t0); });
}
function flushComposites(){
  // Channels first. The wear channel ends up as the albedo composite's alpha, so its sheet has to
  // exist before compositeSlot runs — the other way round left a wear stroke invisible until the
  // next unrelated repaint.
  for (const [s, r] of chanPending) {
    compositeChannels(s, r);
    if (chanHasLayers(s, "wear")) {
      const cur = compPending.get(s);
      compPending.set(s, compPending.has(s) ? (cur && r ? rectUnion(cur, r) : null) : (r || null));
    }
  }
  chanPending.clear();
  for (const [s, r] of compPending) compositeSlot(s, r);      // don't drop a second slot in the same frame
  compPending.clear();
}
// A stroke reports the rectangle it touched; anything structural (a layer added, hidden,
// reordered, re-scoped) comes through with no rectangle. Only the second kind can change what a
// non-colour channel looks like, so that is the one that rebuilds them - a colour brush stroke
// never pays for the smoothness stack.
const chanPending = new Map();                              // slot -> dirty rect (null = whole sheet)
function scheduleChannels(slot, rect){
  if (!slot) return;
  if (chanPending.has(slot)) {
    const cur = chanPending.get(slot);
    chanPending.set(slot, cur && rect ? rectUnion(cur, rect) : null);
  } else chanPending.set(slot, rect || null);
  if (compTimer) return;
  compTimer = true;
  requestAnimationFrame(() => { compTimer = false; const t0 = Rec.clock(); flushComposites(); Rec.span("composite", t0); });
}

