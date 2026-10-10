// ---------- The selection, drawn on the model ----------
// Reported 2026-09-01: "selecting UV islands in 3-D has no visual feedback which will allow you to
// see in 3-D your current selection." It was true of the rectangle too, and the gap is not
// cosmetic: a selection confines the brush in BOTH views — `beginStroke` and `Marquee.confine`
// build the same stencil — and only one of them said so. Painting into a 3-D view that shows no
// selection while a selection silently refuses half the strokes is the invisible mode 3.9 was
// reported for, one level down.
//
// **Why a second mesh and not a tint inside the material.** The part selection dims what is not
// selected by touching each material's opacity (`updateSelectionVisuals`), which works because a
// part IS a whole mesh. An island is a region of a *sheet*: the same mesh is half in and half out,
// so the distinction only exists per texel. The vehicle material already carries four maps plus a
// hand-written blend riding in on `emissiveMap` (materials.js), and a fifth sampler through
// `onBeforeCompile` would put this feature inside the one shader every vehicle depends on. A mesh
// sharing the SAME BufferGeometry costs one draw call per part, no upload, and touches nothing.
//
// **It shares geometry, so it must come off before the model is disposed.** `disposeModelGroup`
// traverses and disposes every geometry it meets; an overlay would present the same one twice.
// `reset()` runs from there, first.
//
// **The overlay is derived state, rebuilt where the frame is drawn.** `sync()` is called once per
// rendered frame and its first act is to compare a key — the slot, the sheet size, `Marquee.rev`
// and the mesh count. Nothing else has to remember to call it, which is the failure mode a mode
// this quiet would otherwise have: a stale tint is worse than none.
const SelOverlay = {
  key: null, node: null, canvas: null, tex: null, mat: null, meshes: [],

  // The stencil the verbs and the brush are actually about, in the accent colour. An island
  // selection already has one — `Marquee.setIslands` builds it once, when the islands are picked —
  // and a plain rectangle gets a cheap one drawn here at the same mask resolution, into one reused
  // canvas.
  source(sh){
    if (Marquee.shape()) return Marquee.tint;
    const r = Marquee.rect();
    if (!r) return null;
    const D = maskDims(sh.W, sh.H);
    const c = (SelOverlay.canvas && SelOverlay.canvas.width === D.w && SelOverlay.canvas.height === D.h)
      ? SelOverlay.canvas : (SelOverlay.canvas = mkCanvas(D.w, D.h));
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, D.w, D.h);
    g.fillStyle = Marquee.ACCENT;
    g.fillRect(Math.floor(r.x * D.w / sh.W), Math.floor(r.y * D.h / sh.H),
               Math.max(1, Math.round(r.w * D.w / sh.W)), Math.max(1, Math.round(r.h * D.h / sh.H)));
    return c;
  },

  // ---- ROADMAP 4.35(1): with no selection in force, the overlay shows the SELECTED DECAL ----
  // "Selecting a decal highlights it in 3-D — its border, its depth, its rotation. Right now the
  // only place a decal reads as an object with a shape is the 2-D view." Its footprint on the sheet
  // is exactly what the projector produced — the rasterised layer for a projected decal, the stamp
  // at its placement for a 2-D one — so a ring round that footprint, on the same second mesh, IS
  // the border, and where the depth reached and how it is turned come with it. Same material, same
  // meshes; only the source canvas differs.
  decal(sh){
    const L = App.activeLayer;
    if (!L || !sh || !nodeOwner(sh.s.layers, L)) return null;
    if (L.proj && L.canvas) return L;
    if (L.type === "decal" && L.bmp) return L;
    return null;
  },
  // What the ring depends on, as a string — a move, a turn, a resize or a change of decal rebuilds
  // it; a camera orbit does not. So does a new source image (ROADMAP 4.2's re-edit): keying out a
  // background changes the footprint and no number here, so the image's own tag rides along — on a
  // floating decal too, whose centred text re-drawn longer keeps every number here while its
  // footprint grows (4.50 (3)'s review, 2026-09-26: the ring stayed round the old lettering).
  decalKey(L){
    if (L.proj) { const P = L.proj; return "P" + P.frame.p.join(",") + "|" + P.rot + "|" + P.scale + "|" + (P.flip ? 1 : 0) + "|" + (P.depth || 0) + "|" + (P.wrap || 0) + "|" + (P.sym2 ? 1 : 0) + "|" + ProjSource.tag(P.bmp); }
    return "D" + [L.x, L.y, L.scale, L.rot, L.flip ? 1 : 0, L.sym ? L.sym.x + "," + L.sym.y : "", ProjSource.tag(L.bmp)].join("|");
  },
  ring(sh, L){
    const D = maskDims(sh.W, sh.H);
    const c = (SelOverlay.canvas && SelOverlay.canvas.width === D.w && SelOverlay.canvas.height === D.h)
      ? SelOverlay.canvas : (SelOverlay.canvas = mkCanvas(D.w, D.h));
    // the footprint, in the accent colour: the layer's alpha through source-in
    const st = Composite.scratch("_ovl", D.w, D.h);
    const gs = ctx2d(st);
    Composite.reset(gs); gs.setTransform(1, 0, 0, 1, 0, 0); gs.clearRect(0, 0, D.w, D.h);
    if (L.proj) gs.drawImage(L.canvas, 0, 0, D.w, D.h);
    else {
      // the 2-D decal is stamped exactly as the compositor stamps it, scaled into the mask by a transform
      gs.setTransform(D.w / sh.W, 0, 0, D.h / sh.H, 0, 0);
      Composite.content({ slot: sh.s, ch: "color", W: sh.W, H: sh.H, sx: 0, sy: 0, tw: sh.W, th: sh.H }, gs, LayerNode.contentOn(L, "color"));
      gs.setTransform(1, 0, 0, 1, 0, 0);
    }
    gs.globalCompositeOperation = "source-in"; gs.fillStyle = Marquee.ACCENT; gs.fillRect(0, 0, D.w, D.h);
    Composite.reset(gs);
    // the ring: the footprint dilated in eight directions, minus the footprint — then the inside at
    // a third, so the region reads as well as its edge
    const g = ctx2d(c);
    Composite.reset(g); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, D.w, D.h);
    const r = Math.max(2, Math.round(D.w / 512));
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) g.drawImage(st, dx, dy);
    g.globalCompositeOperation = "destination-out"; g.drawImage(st, 0, 0);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = .35; g.drawImage(st, 0, 0);
    Composite.reset(g);
    return c;
  },

  sync(){
    const sh = Marquee.sheet();
    const r = (sh && modelGroup) ? Marquee.rect() : null;
    const L = (!r && sh && modelGroup) ? SelOverlay.decal(sh) : null;
    // A decal being dragged re-renders at every step; the ring waits for the drop rather than
    // redrawing a mask-resolution canvas per pointer move (§3.4).
    if (L && (App.projDragging || (typeof v2 === "object" && v2 && v2.draggingDecal))) return;
    // The key is built from `Marquee.rev` and not from the stencil, so this costs a short join per
    // rendered frame and nothing else. Building the source first would put a clear + fillRect at
    // mask resolution — 2048² on a 4096 sheet — inside the rAF that §3 exists to keep empty.
    const key = r ? [sh.s.id, sh.W, sh.H, Marquee.rev, App.meshes.size].join("|")
              : L ? ["d", sh.s.id, sh.W, sh.H, App.meshes.size, SelOverlay.decalKey(L)].join("|") : "";
    if (key === SelOverlay.key && L === SelOverlay.node) return;
    SelOverlay.key = key; SelOverlay.node = L;
    SelOverlay.clear();
    if (!r && !L) return;
    const src = r ? SelOverlay.source(sh) : SelOverlay.ring(sh, L);
    if (!src) return;
    SelOverlay.tex = new THREE.CanvasTexture(src);
    SelOverlay.tex.encoding = THREE.sRGBEncoding;
    // Unlit on purpose: this is an interface element on top of the vehicle, not paint on it, so it
    // must read the same on a shadowed underside as on a lit deck. depthWrite off and a negative
    // polygon offset put it on the surface without fighting it; DoubleSide because a skirt or an
    // aerial is one triangle thick and would otherwise show the selection from one side only.
    SelOverlay.mat = new THREE.MeshBasicMaterial({
      map: SelOverlay.tex, transparent: true, opacity: .42, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const mesh of App.meshes.values()) {
      if (mesh.userData.effect) continue;
      if (App.matSlot.get(mesh.userData.mat) !== sh.s.id) continue;
      // A raw .obj without UVs samples the whole map at (0,0) — a flat wash over the part, which
      // says the opposite of what a selection means.
      if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.uv) continue;
      // A CHILD of the part, not a sibling in modelGroup: it inherits the part's transform, so a
      // posed or mirrored station needs no second copy of the placement maths, and it inherits
      // `visible`, so hiding a part hides its overlay without this knowing that visibility exists.
      const o = new THREE.Mesh(mesh.geometry, SelOverlay.mat);
      o.userData.selOverlay = true;
      o.renderOrder = 2;
      mesh.add(o);
      SelOverlay.meshes.push(o);
    }
    needsRender();
  },

  clear(){
    for (const o of SelOverlay.meshes) if (o.parent) o.parent.remove(o);
    SelOverlay.meshes.length = 0;
    if (SelOverlay.tex) { SelOverlay.tex.dispose(); SelOverlay.tex = null; }
    if (SelOverlay.mat) { SelOverlay.mat.dispose(); SelOverlay.mat = null; }
  },
  // Forget the key as well, so the next frame rebuilds against whatever model is there now.
  reset(){ SelOverlay.clear(); SelOverlay.key = null; SelOverlay.node = null; },
};
