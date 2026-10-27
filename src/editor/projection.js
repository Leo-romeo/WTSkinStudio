// GPU when it is there, the per-triangle canvas rasteriser when it is not — and always the canvas
// path for the `canvas === null` dry run, which only counts triangles and allocates nothing.
//
// Returns `{ drawn, box }`. The box is where the projection actually landed on this sheet, in sheet
// pixels, and it is what ROADMAP 4.8b needed before a projected decal could carry its Look: the
// derived surface layers walk per pixel, and the alternative to a box is walking the whole sheet.
// It is null for a live frame drawn whole (the canvas fallback's) — nothing reads it there, and finding
// it costs a readback; a live frame drawn in boxes (`region`) reads a 512-px scout for its box instead.
//
// `beam` ({ basis, halfW, halfH }) states the beam outright instead of deriving it from a decal's
// frame, rotation and scale — the shape tool's Fill on the model (6.1b) projects a path whose extent
// is its own bounding box in the plane of its first click, and it goes through this same projector
// (depth pre-pass, facing, tiled UVs, the canvas fallback) rather than a second one.
//
// `region` makes it a LIVE FRAME (ROADMAP 1.18, `ProjDrag`): `{ prev, scale }` — where the decal was
// on this sheet last frame (null when not known) and the resolution to project at. Only the old and
// the new box are cleared and drawn, and `rect` in the result is that union, for the composite.
function renderProjection(canvas, src, frame, slot, live, beam, region){
  const { halfW, halfH } = beam || projHalfSize(src);
  const basis = beam ? beam.basis : projBasis(frame, src.rot, src.flip);
  // A pose marks its meshes' world matrices stale until the next render; the projector reads them
  // (`Project.local`), as the projected brush does at its setup.
  if (modelGroup) modelGroup.updateMatrixWorld(true);
  const G = canvas && src.bmp ? projGL() : null;
  if (G) {
    const w = canvas.width, h = canvas.height, gl = G.gl;
    // ---- grow-only, never per sheet, and never past what the context gives ----
    // One projected decal routinely spans several sheets of DIFFERENT sizes (this project has it on
    // four, one of them 8192²). Sizing the drawing buffer to each sheet in turn reallocated up to
    // 268 MB several times per drag frame, which is why a drag started fast and then degraded
    // without recovering. So one buffer is kept at the largest size seen — capped at what the
    // context really gives (`ProjWin.fit`), with a bigger sheet drawn a window at a time — each window
    // gets a viewport, and that sub-rectangle is blitted back.
    ProjWin.fit(G, w, h);
    // The sheet drawn at ws × hs, in the windows that cover `box` of it (all of it when null), each
    // window handed to `k` with what it drew while it is still in the buffer.
    const pass = (ws, hs, box, k) => {
      let sent = 0;
      for (const t of ProjWin.windows(G, ws, hs, box)) {
        ProjWin.aim(G, ws, hs, t);
        let n = projDrawGL(G, src, basis, halfW, halfH, slot, true, 0, t.w, t.h);
        if (src.sym2) n += projDrawGL(G, src, mirrorBasis(basis, !!src.sym2Read), halfW, halfH, slot, false, 1, t.w, t.h);
        sent += n;
        k(t, n);
      }
      gl.disable(gl.SCISSOR_TEST);
      return sent;
    };
    if (region) return ProjDrag.frame(G, canvas, pass, region);
    const CH = G.canvas.height;
    let texels = 0, box = null;
    const sent = pass(w, h, null, (t, n) => {
      if (!n) { ctx2d(canvas).clearRect(t.x, t.y, t.w, t.h); return; }
      // The viewport sits at the framebuffer's bottom-left, which as an image is y = CH - t.h.
      // `preserveDrawingBuffer` is off, so the copy has to happen in this same task — it does.
      // The coverage probe is a readback, so it is skipped while dragging: it only feeds the
      // "empty here" tag and the status line, neither of which is read mid-drag.
      if (!live) {
        const c = projCoverage(G.canvas, 0, CH - t.h, t.w, t.h);
        texels += c.texels;
        if (c.box) box = rectUnion(box, { x: c.box.x + t.x, y: c.box.y + t.y, w: c.box.w, h: c.box.h });
      }
      projBlit(canvas, G.canvas, 0, CH - t.h, t.w, t.h, t.x, t.y);
    });
    if (!sent) return { drawn: 0, box: null };
    return { drawn: live ? 1 : texels, box };     // texels covered, not triangles touched
  }
  // The canvas fallback knows exactly which triangles it rasterised and where, so its box is the
  // union of their sheet-space bounds rather than a probe of the result.
  const a = projectInto(canvas, src, basis, halfW, halfH, slot);
  const b = src.sym2 ? projectInto(canvas, src, mirrorBasis(basis, !!src.sym2Read), halfW, halfH, slot) : null;
  return { drawn: a.drawn + (b ? b.drawn : 0), box: rectUnion(a.box, b && b.box) };
}
// ---- a live frame costs what the decal covers, not what the sheet does (ROADMAP 1.18) ----
// "The decal's projection should follow the dragged preview swiftly, not creating a ghost-like effect."
// Measured 2026-10-23 in software GL with one 512 × 256 decal on a plate: a live render took 109 ms at
// 2048² and 338 ms at 4096², and the composite after it 13 and 55 — four times the sheet, three times
// the cost, with the decal the same size. Every one of those costs was the SHEET's: the layer cleared
// whole, every window cleared, drawn and blitted, and a composite and texture upload with no rectangle.
// At 8192² that is well past a frame, so the projection trailed the handles — the ghost.
//
// So a live frame (a drag in either view, a handle, a nudge, a slider) finds where the decal lands with
// a scout of the same projection at SCOUT px on the sheet's longer side, clears and re-projects only
// its old box and its new one, and composites only those. While the decal is MOVING on a sheet longer
// than SIDE, the new box is projected at SIDE / side of the resolution and drawn up softly — the
// owner's own proposal — and once it moves SLOWLY (under STILL of its own size a frame) the box is
// projected at full resolution. SETTLE_MS after the last live frame the sheet is projected exactly as
// a placement projects it, so the settled picture is byte for byte a placement's, and so is the drop,
// which is the full render it always was. A frame that changes nothing after that draws nothing: a
// hand resting on the mouse must not re-project an 8192² sheet on every twitch.
const ProjDrag = {
  SIDE: 2048, SCOUT: 512, SETTLE_MS: 150,
  STILL: .01,                 // of the decal's half size, per frame: under this it is not moving
  last: null,                 // the decal at the last live frame: { P, p, scale, rot, n }
  full: null,                 // the decal whose next live frame is the settled one
  calm: null,                 // …and what the last settled frame drew: { P, at: projParamsClone(P) }
  timer: 0,
  stats: { scaled: 0, region: 0, settled: 0, same: 0 },
  // How P moves this live frame — "moving", "slow", "settled", or "same" (nothing changed since it
  // settled). Once per frame, whatever sheets it is on.
  pace(P){
    const L = ProjDrag.last, { halfW, halfH } = projHalfSize(P), lim = ProjDrag.STILL * Math.max(halfW, halfH);
    const moved = !L || L.P !== P || L.scale !== P.scale || L.rot !== P.rot || L.n.join() !== P.frame.n.join() ||
      Math.hypot(P.frame.p[0] - L.p[0], P.frame.p[1] - L.p[1], P.frame.p[2] - L.p[2]) > lim;
    ProjDrag.last = { P, p: P.frame.p.slice(), n: P.frame.n.slice(), scale: P.scale, rot: P.rot };
    clearTimeout(ProjDrag.timer);
    // Everything a render reads, the Look's outline and shadow included: the style rows re-project
    // through this same live path, and a signature of the frame alone called each of their steps after
    // a settle "same" and drew nothing until the release (review of 1.18).
    const at = projParamsClone(P), calm = ProjDrag.calm;
    if (ProjDrag.full === P) { ProjDrag.full = null; ProjDrag.calm = { P, at }; return "settled"; }
    if (calm && calm.P === P && ProjSource.same(calm.at, at)) return "same";
    ProjDrag.calm = null;
    return moved ? "moving" : "slow";
  },
  // After a frame drawn in boxes: the settled frame, unless another live frame — or the drop, which
  // bumps ProjLive.gen — comes first.
  // A slider step the sliders' gate held back (`ProjLive.held`, decals.js) is a hand still moving, so
  // the settle waits SETTLE_MS from the last of them: on a machine slow enough to close the gate it
  // otherwise re-projected the whole sheet between every two steps it let through — 136–184 ms each
  // at 4096 × 2048 in software GL, twice what a step had cost (review of 1.18). A drag is never gated.
  arm(P){
    const gen = ProjLive.gen, at = performance.now();
    ProjDrag.timer = setTimeout(function settle(){
      if (ProjLive.gen !== gen) return;
      const quiet = performance.now() - ProjLive.held;
      if (ProjLive.held > at && quiet < ProjDrag.SETTLE_MS) { ProjDrag.timer = setTimeout(settle, ProjDrag.SETTLE_MS - quiet); return; }
      ProjDrag.full = P; projLiveRender(P);
    }, ProjDrag.SETTLE_MS);
  },
  // One live frame on one sheet, given renderProjection's own `pass`. `region.prev` is where the decal
  // was on this canvas last frame (null: nowhere; undefined: not known, so all of it is cleared).
  frame(G, canvas, pass, region){
    const w = canvas.width, h = canvas.height, CH = G.canvas.height;
    const k = Math.min(1, ProjDrag.SCOUT / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
    let box = null;
    const sent = pass(sw, sh, null, (t, n) => {
      if (!n) return;
      const c = projCoverage(G.canvas, 0, CH - t.h, t.w, t.h);
      if (c.box) box = rectUnion(box, { x: c.box.x + t.x, y: c.box.y + t.y, w: c.box.w, h: c.box.h });
    });
    // back to the sheet's texels, a scout texel wider each way than the probe's own padding
    if (box) {
      const fx = w / sw, fy = h / sh, x0 = Math.max(0, Math.floor((box.x - 1) * fx)), y0 = Math.max(0, Math.floor((box.y - 1) * fy));
      box = { x: x0, y: y0, w: Math.min(w, Math.ceil((box.x + box.w + 1) * fx)) - x0, h: Math.min(h, Math.ceil((box.y + box.h + 1) * fy)) - y0 };
    }
    const R = region.prev === undefined ? { x: 0, y: 0, w, h } : rectUnion(region.prev, box);
    const g = ctx2d(canvas);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    if (R) g.clearRect(R.x, R.y, R.w, R.h);
    if (box) {
      const sc = region.scale, ws = Math.max(1, Math.round(w * sc)), hs = Math.max(1, Math.round(h * sc));
      const bx = Math.floor(box.x * ws / w), by = Math.floor(box.y * hs / h);
      const bs = { x: bx, y: by, w: Math.min(ws, Math.ceil((box.x + box.w) * ws / w)) - bx, h: Math.min(hs, Math.ceil((box.y + box.h) * hs / h)) - by };
      g.imageSmoothingEnabled = true;                 // drawn up softly, at a reduced scale
      let drew = null;
      pass(ws, hs, bs, (t, n) => {
        if (!n) return;
        const dx = t.x * w / ws, dy = t.y * h / hs, dw = t.w * w / ws, dh = t.h * h / hs;
        // A scaled drawImage filters from texels just past its source rectangle, and the buffer there
        // holds what the scout or another window drew: a faint line (alpha 15–63) along the top of the
        // box, left behind by the next frame (t159, 2026-10-23). So a clear row above the window and a
        // clear column right of it; its other two sides are the buffer's own edge, which clamps.
        if (sc < 1) {
          const gl = G.gl;
          gl.enable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0);
          gl.scissor(0, t.h, t.w + 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.scissor(t.w, 0, 1, t.h); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        g.drawImage(G.canvas, 0, CH - t.h, t.w, t.h, dx, dy, dw, dh);
        drew = rectUnion(drew, { x: Math.floor(dx), y: Math.floor(dy), w: Math.ceil(dx + dw) - Math.floor(dx), h: Math.ceil(dy + dh) - Math.floor(dy) });
      });
      // What was DRAWN is what the next frame clears: a box drawn up from a reduced one reaches past
      // it by up to a reduced texel, and a soft edge left there would stay until the drop.
      box = rectClamp(rectUnion(box, drew), w, h);
      ProjDrag.stats[sc < 1 ? "scaled" : "region"]++;
    }
    return { drawn: sent ? 1 : 0, box, rect: rectClamp(rectUnion(R, box), w, h) };
  },
};
// ---- A projected decal is ONE object, even when it spans several textures ----
// A marking across a wing root sits on the fuselage sheet and on the wing sheet. Each sheet needs
// its own layer, but the user placed one decal: the layers share a single parameter object
// (`proj`, by reference) and a group id, so moving / resizing / hiding / deleting acts on all of
// them at once. Before this, the halves were unrelated layers in different slots — deleting the
// one you could see left the other one painted on the model with no layer in sight.
let projSeq = 1;
function slotOfLayer(L){
  for (const s of App.slots.values()) if (nodeOwner(s.layers, L)) return s;
  return null;
}
function projSiblings(id){
  const out = [];
  if (!id) return out;
  for (const slot of App.slots.values())
    for (const L of layerLeaves(slot.layers)) if (L.proj && L.proj.id === id) out.push({ slot, L });
  return out;
}
// The snapshot every projection edit's undo step is built from: where it is put, plus its source
// (`ProjSource.FIELDS`, below). The Look joined in 4.8b — it produces layers, so changing it has to
// undo the way every other parameter does, by re-rendering from the old values — and the relief's
// image in 4.19(5), because what the file IS rides in `surf` and undoing a swap of one without the
// other read a normal map as a depth map. The image itself joined in 4.2's re-edit (2026-09-25).
function projParamsClone(P){
  return Object.assign({ frame: { p: P.frame.p.slice(), n: P.frame.n.slice(), r: P.frame.r.slice(), u: P.frame.u.slice() },
    scale: P.scale, rot: P.rot, flip: !!P.flip, sym2: !!P.sym2, sym2Read: !!P.sym2Read,
    parts: P.parts ? P.parts.slice() : null,
    depth: P.depth == null ? PROJ_DEPTH_DEF : P.depth, wrap: P.wrap == null ? PROJ_WRAP_DEF : P.wrap },
    ProjSource.snap(P));
}
function projParamsAssign(P, s){
  P.frame = { p: s.frame.p.slice(), n: s.frame.n.slice(), r: s.frame.r.slice(), u: s.frame.u.slice() };
  P.scale = s.scale; P.rot = s.rot; P.flip = s.flip; P.sym2 = s.sym2; P.sym2Read = !!s.sym2Read;
  P.parts = s.parts ? s.parts.slice() : null;
  // Older projects predate these two; the defaults reproduce exactly what they used to render.
  P.depth = s.depth == null ? PROJ_DEPTH_DEF : s.depth;
  P.wrap = s.wrap == null ? PROJ_WRAP_DEF : s.wrap;
  ProjSource.put(P, s);                  // each source field only when the snapshot carries it
}
// ---- What a projection DRAWS is a parameter, like where it draws it (ROADMAP 4.2) ----
// "Re-edit an already-projected decal", re-requested 2026-08-23. `btnDecalEditor` answers
// `type === "decal"` only and a projection is a `paint` layer carrying `proj`, so the moment a decal
// was projected its image was fixed: background removal, crop and adjust were out of reach for good.
// But a projection is fully described by its source plus its frame, so swapping `P.bmp` and
// re-rendering through `renderProjGroup` is the whole change, and its undo step is the parameter
// snapshot every other projection edit already pushes — now holding the old image. By REFERENCE,
// which is only safe because nothing edits a source in place: every path that changes one hands
// over a new canvas (the decal editor rebuilds from its untouched `orig` each time), and the GPU
// projector's texture cache keys on the same identity (`G.texBmp`).
//
// FIELDS is the one statement of what "the source" is and how a snapshot holds each part: an image
// by reference, a record by a shallow copy, a string as itself. The text tool (4.50(3)) added its
// record here — `text: "copy"`, a flat record, so the shallow copy is a whole one — and got the
// undo step, the snapshot comparison and `set` for nothing. The `.wtproj` is the one other place it
// has to be named, twice: `ProjNode.saveContent` writes `m.proj` field by field and `ProjNode.projOf`
// reads it back the same way — by name, since 2026-10-17, because a file is not trusted to say what
// a projection holds (t140 round-trips one with every field set).
const ProjSource = {
  FIELDS: { bmp: "ref", surf: "copy", heightMap: "ref", heightName: "value", text: "copy" },
  // The Size slider's range (`#projScale`, 5–400 %), which the keyboard resize clamps to as well.
  SCALE_MIN: .05, SCALE_MAX: 4,
  snap(P){
    const out = {};
    for (const [k, how] of Object.entries(ProjSource.FIELDS))
      out[k] = P[k] == null ? null : how === "copy" ? { ...P[k] } : P[k];
    return out;
  },
  put(P, s){
    for (const [k, how] of Object.entries(ProjSource.FIELDS))
      if (k in s) P[k] = s[k] == null ? null : how === "copy" ? { ...s[k] } : s[k];
  },
  // Do two snapshots describe the same projection? JSON alone cannot say: a canvas serialises as
  // `{}`, so a swap of one image for another under the same name compared equal, and the edit was
  // dropped as "a click that didn't move it" with no undo step. Images by identity, the rest by value.
  same(a, b){
    for (const [k, how] of Object.entries(ProjSource.FIELDS))
      if (how === "ref" && (a[k] || null) !== (b[k] || null)) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  },
  // The scale at which `bmp` keeps one SOURCE pixel the size it is now. `projHalfSize` spreads the
  // image's whole width over `scale`, so the same scale would draw a cropped marking bigger by
  // however much margin went, and a quarter-turned 2:1 image stretched to 4:1 — where a crop should
  // lose the margin and a turn should turn. It is the floating decal's rule too: there `scale` is
  // sheet pixels per source pixel, so a crop never resized anything. Text re-rendered from a longer
  // string gets longer at the same letter size by the same rule (4.50(3)).
  scaleFor(P, bmp){
    const w0 = P.bmp && P.bmp.width;
    return w0 && bmp && bmp.width ? P.scale * bmp.width / w0 : P.scale;
  },
  bytes(img){ return img ? img.width * img.height * 4 : 0; },
  // Where the frame's point goes when the new image's centre sat at `at` in the OLD image's pixels:
  // that offset in the projector's own axes, at the size one old pixel is drawn — the same in-plane
  // move the arrow-key nudge makes. The frame's point IS the image's centre, and a crop that takes
  // more margin off one side than the other moves the centre, so without this the marking slid by
  // half the difference: 4.2b's review (2026-09-26) measured a bar 24 source pixels left of centre
  // jumping 46 texels, its own width. Null when `at` is the centre.
  moved(P, at){
    const dx = at[0] - P.bmp.width / 2, dy = at[1] - P.bmp.height / 2;
    if (!dx && !dy) return null;
    const px = 2 * projHalfSize(P).k, b = projBasis(frameFromArrays(P.frame), P.rot, P.flip);
    return b.p.addScaledVector(b.t1, dx * px).addScaledVector(b.t2, dy * px).toArray();
  },
  // Give projection P a new source and re-project it where it stands: every sheet it covers is
  // re-rendered and its Look rebuilt, and it is ONE undo step. Not a recomposite — a projection's
  // pixels live in each layer's own canvas and only a re-render rebuilds them, which is the trap
  // 4.2's adjust bullet recorded (Apply refreshed the thumbnail and neither view). `next` holds
  // FIELDS to change, plus two placement answers: `scale`, to override the one a new WIDTH keeps
  // (`scaleFor`; either is fitted to the Size range), and `at`, where the new image's centre sat in
  // the old one when that is not its centre — a crop's rectangle — so the frame moves and the
  // marking does not (`moved`). A new image that changes the shorter side re-fits the outline and
  // shadow too (`DecalStyle.refit`). Returns updateProjGroup's result plus `clamped` (the size had
  // to be fitted), null when nothing changed, or `{ gone: true }` when the decal is on no sheet any
  // more — shortcuts still run under the editor's dialog, so it can be deleted or undone away while
  // its image is being edited, and re-rendering it then would put it back as new layers that no
  // step before this one knows about.
  set(P, next, desc){
    for (const k of Object.keys(next))
      if (k !== "scale" && k !== "at" && !(k in ProjSource.FIELDS)) throw new Error("ProjSource.set: “" + k + "” is not part of a projection's source");
    if (!projSiblings(P.id).length) return { gone: true, drawn: 0, sheets: 0 };
    const before = projParamsClone(P);
    const swap = !!(next.bmp && P.bmp) && next.bmp !== P.bmp;
    // A new WIDTH moves the scale, not merely a new image: a background keyed out keeps the width,
    // and has to keep a scale the Size range does not hold as well (4.2b's review: a same-size key
    // took 0.03 to 0.05 and grew the marking by two thirds).
    const want = next.scale != null ? next.scale : swap && next.bmp.width !== P.bmp.width ? ProjSource.scaleFor(P, next.bmp) : null;
    const p = next.at && P.bmp ? ProjSource.moved(P, next.at) : null;   // measured in the old image, so before it goes
    const src = !swap ? next : Object.assign({}, next, { surf: DecalStyle.refit("surf" in next ? next.surf : P.surf,
      Math.min(P.bmp.width, P.bmp.height), Math.min(next.bmp.width, next.bmp.height)) });
    ProjSource.put(P, src);
    if (want != null) P.scale = Math.max(ProjSource.SCALE_MIN, Math.min(ProjSource.SCALE_MAX, want));
    if (p) P.frame = { p, n: P.frame.n.slice(), r: P.frame.r.slice(), u: P.frame.u.slice() };
    if (ProjSource.same(before, projParamsClone(P))) return null;
    // The step holds both images, so it is budgeted as both (§3.7): the old one lives only in the
    // undo history now, and the new one is what redo has to put back.
    const bytes = before.bmp === P.bmp ? 0 : ProjSource.bytes(before.bmp) + ProjSource.bytes(P.bmp);
    // A READABLE mirrored copy is the reflection flipped about its own centre, so an uneven margin
    // held its marking off the mirror of this one; once the frame follows the crop it lands exactly
    // opposite — measured: 47 texels off the mirror before, 0 after (t91). That copy visibly moves,
    // so `copyMoved` lets the status line say it did. A true reflection stays put.
    return Object.assign(updateProjGroup(P, desc || "edit projected decal", before, bytes),
      { clamped: want != null && P.scale !== want, copyMoved: !!p && !!P.sym2 && !!P.sym2Read });
  },
  // The decal editor on a projected decal's image — the image as it is projected NOW, so the
  // dialog shows what is on the model and edits build on each other; Ctrl+Z is the way back. (Not
  // the floating decal's untouched `orig`: without 4.2's per-decal editor memory that would reopen
  // on an image the user already cleaned, with every setting back at its default — decided
  // 2026-09-25, `docs/ROADMAP_DONE.md` 4.2b.) "Use this decal" re-projects it in place.
  // Text (4.50 (3)) opens the same editor in its text mode, on the record: its result is a fresh
  // render plus the edited record, and `at` keeps the aligned edge where it was (`TextDecal.at`).
  async edit(L){
    const P = L && L.proj;
    if (!P || !P.bmp) { setStatus("Select a projected decal first — this edits the image a decal on the model was projected from", "err"); return null; }
    if (P.text) await TextDecal.ensureFont(P.text.fontId);     // so a re-render is in its own font
    // The editor hands an untouched image back as the very canvas it was given (`toCanvas` of a
    // canvas is itself), so keeping a canvas of our own is how "nothing was edited" is told apart
    // from an edit. An ImageBitmap source would come back as a fresh canvas and read as a change.
    const src = toCanvas(P.bmp);
    // The source as the dialog opened on it. Shortcuts run under the dialog, so an undo or a redo can
    // swap this decal's image or Look while it is being edited — and the result was made from THIS
    // one: its crop is measured in this image's pixels and its size kept relative to this width.
    // Applied over another, it would land wrong in a way nothing reports, so it is refused and said.
    const was = ProjSource.snap(P);
    const what = P.text ? "text" : "image";
    return openDecalEditor(src, P.name || L.name, (canvas, meta) => {
      if (!ProjSource.same(was, ProjSource.snap(P))) { ProjSource.report({ stale: true }, what); return; }
      // The Look comes back as it went in unless its select was moved (`DecalEd.look`), so an
      // unchanged one compares equal in `set` and costs no step.
      const next = { surf: meta.surf || null };
      if (canvas !== src) next.bmp = canvas;
      // What a crop kept, as the point the new image's centre was in this one (`ProjSource.moved`).
      const box = meta.geom && meta.geom.box;
      if (box) next.at = [box.x + box.w / 2, box.y + box.h / 2];
      // The depth map comes back cropped and turned with the image (`DecalEd.follow`); untouched, it
      // comes back as the very image it went in as, and costs nothing.
      if ((meta.height || null) !== (P.heightMap || null)) { next.heightMap = meta.height || null; next.heightName = meta.heightName || null; }
      const map = P.heightMap || null, t0 = P.text || null;
      if (meta.text) ProjSource.retext(P, next, meta.text);
      const res = ProjSource.set(P, next, P.text ? "edit projected text" : "edit projected decal");
      if (res && res.drawn && meta.text) res.mapNote = TextDecal.mapNote(map, t0, meta.text);
      ProjSource.report(res, what);
    }, { look: P.surf || null, height: P.heightMap || null, heightName: P.heightName || null, text: P.text || null });
  },
  // Text typed back to what it was is no edit, even though the editor drew it again: the record
  // decides, not the canvas's identity. Otherwise the new record goes in with its image, the frame
  // follows the aligned edge, and a depth image stays where the old lettering was rather than being
  // stretched over the new (`TextDecal.moveMap`, 4.50 (3)'s review).
  retext(P, next, t){
    if (P.text && TextDecal.same(t, P.text)) { delete next.bmp; return; }
    next.text = { ...t };
    const at = next.bmp && TextDecal.at(P.text, t, P.bmp);
    if (at) next.at = at;
    if (next.bmp && P.heightMap) {
      const m = TextDecal.moveMap(P.heightMap, P.bmp, next.bmp, at);
      if (m !== P.heightMap) { next.heightMap = m; next.heightName = P.heightName || null; }
    }
  },
  report(res, what){
    const it = what === "text" ? "text" : "image";
    if (!res) { setStatus("Nothing changed — the decal is as it was", "ok"); return; }
    if (res.stale) { setStatus("This decal's " + it + " or Look was changed while the editor was open — an undo or a redo reached it — so the edit was not applied. Open the editor again to edit it as it is now", "err"); return; }
    if (res.gone) { setStatus("That decal is no longer on the model — it was deleted or undone while the editor was open — so there is nothing to re-project", "err"); return; }
    if (!res.drawn) { setStatus("The edited " + it + " is empty where the decal lands, so nothing shows — Ctrl+Z puts the old one back", "err"); return; }
    setStatus("Re-projected the edited " + it + " onto " + res.sheets + " texture" + (res.sheets === 1 ? "" : "s") + " — it stays where it was" +
      (res.clamped ? ", but at its old pixel size the new image is beyond what Size can hold, so it was fitted to the nearest end of the range" : it === "text" ? ", its letters the size they were" : ", at the same size") +
      (res.copyMoved ? ", and its readable mirrored copy moved to sit exactly opposite it — the old uneven margin had held it off" : "") +
      (res.mapNote || "") + ". Ctrl+Z puts the old " + it + " back", res.clamped ? "err" : "ok");
  },
  // A number per source image, for a view's cache to key on. The 3-D ring round the selected decal
  // is rebuilt when its key string changes, and a re-edit that keeps the size — a background keyed
  // out — changes the footprint without moving any number the key held.
  ids: new WeakMap(), seq: 0,
  tag(img){
    if (!img) return 0;
    let t = ProjSource.ids.get(img);
    if (!t) ProjSource.ids.set(img, t = ++ProjSource.seq);
    return t;
  },

  // ---- one decal, two placements (2026-10-17) ----
  // "Decal and projected image should not be two completely separate things and should work
  // seamlessly, with nothing weird seen by the user." Underneath they still are two — a flat stamp
  // on one sheet, and a projector rasterised onto every sheet it reaches — because each is right for
  // something; what the user sees is one decal with a placement, switched in place (ProjGrip.flatOf
  // / frameOfFlat hold the maths).
  //
  // A new image goes straight onto the model, projected from this view at the middle of it, and is
  // selected with its frame and handles up — there is no image waiting on the cursor and no stand-in
  // drawn flat at the sheet's centre meanwhile (reported 2026-10-17: that stand-in showed smeared on
  // whatever part owns the middle of the sheet). Adding it and putting it there are one undo step.
  // Off the model — nothing under the middle of the view, or no model — it stays flat, at the
  // texture's centre, and says so.
  landAtView(L){
    if (!L || L.type !== "decal" || !App.geomData || !modelGroup) return false;
    const r = cnv3.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    // the middle first, then outwards in rings: the first hit nearest the middle wins
    let hit = null;
    for (let ring = 0; ring <= 4 && !hit; ring++) {
      const n = ring ? 8 * ring : 1;
      for (let i = 0; i < n && !hit; i++) {
        const a = i / n * Math.PI * 2, d = ring * .08;
        const h = ray3d({ clientX: r.left + r.width * (.5 + d * Math.cos(a)), clientY: r.top + r.height * (.5 + d * Math.sin(a)) }, true);
        if (h && h.uv) hit = h;
      }
    }
    return hit ? bakeProjection(L, hit) : false;
  },
  // On the texture → On the model: projected from straight above where it is drawn, at the size
  // and turn it is drawn at, its Look, relief map, text and mirrored copy with it. One undo step.
  fromFlat(L){
    if (!L || L.type !== "decal" || L.proj) return false;
    if (!App.geomData) { setStatus("Load the vehicle's model first — On the model projects the decal onto it", "err"); return false; }
    const slot = slotOfLayer(L), at = slot && ProjGrip.frameOfFlat(L, slot);
    if (!at) {
      setStatus("“" + (L.name || "This decal") + "” is not over any part of the model — its centre is in the gap between UV islands. Drag it onto a part first", "err");
      return false;
    }
    at.sym2 = !!L.sym;
    return bakeProjection(L, null, at);
  },
  // On the model → On the texture: one flat decal, on the sheet holding the decal's centre (the
  // active one when it is among them), drawn where the projection put it and at its size — its Look,
  // relief map, text, layer settings and mirrored copy carried across, every sheet's projected layer
  // taken away. One undo step, and undoing it puts the projection back exactly.
  toFlat(P){
    const sibs = projSiblings(P.id);
    if (!sibs.length) return false;
    const order = sibs.slice().sort((a, b) => (b.slot === App.activeSlot) - (a.slot === App.activeSlot));
    let at = null, home = null;
    for (const e of order) { at = ProjGrip.flatOf(P, e.slot); if (at) { home = e; break; } }
    if (!at) {
      setStatus("The decal's centre is not on any texture it covers — move it so its middle is on the model, then switch", "err");
      return false;
    }
    const scale = Math.max(.01, Math.min(3, at.scale));
    const F = ProjGrip.frame(P);
    let sym = null;
    if (P.sym2) { const m = mirrorBasis({ p: F.p, n: F.n, t1: F.t1, t2: F.t2 }, false); sym = ProjGrip.uvAt(home.slot, m.p, m.n); }
    const src = home.L;
    const L = LayerNode.of({ type: "decal", name: P.name || src.name, bmp: P.bmp, visible: src.visible !== false,
      opacity: src.opacity == null ? 1 : src.opacity, blend: src.blend || "normal",
      x: at.x, y: at.y, scale, rot: at.rot, flip: at.flip, sym, surf: P.surf || null,
      text: P.text ? { ...P.text } : null });
    if (P.heightMap) { L.heightMap = P.heightMap; L.heightName = P.heightName || null; }
    const slot = home.slot, placed = sibs.map(e => ({ slot: e.slot, L: e.L, idx: e.slot.layers.indexOf(e.L) }));
    const idx = Math.max(0, placed.find(q => q.slot === slot).idx);
    const put = () => {
      for (const q of placed) { const o = nodeOwner(q.slot.layers, q.L); if (o) { o.list.splice(o.i, 1); scheduleComposite(q.slot); } }
      if (!nodeOwner(slot.layers, L)) slot.layers.splice(Math.min(idx, slot.layers.length), 0, L);
      ensureDecalSurface(slot, L);
      scheduleComposite(slot);
      if (slot !== App.activeSlot) selectSlot(slot.id);
      App.activeLayer = L;
      refreshLayerList(); refreshSlotList(); draw2D();
    };
    const back = () => {
      const o = nodeOwner(slot.layers, L); if (o) o.list.splice(o.i, 1);
      scheduleComposite(slot);
      for (const q of placed.slice().sort((a, b) => a.idx - b.idx))
        if (!nodeOwner(q.slot.layers, q.L)) { q.slot.layers.splice(Math.min(Math.max(0, q.idx), q.slot.layers.length), 0, q.L); scheduleComposite(q.slot); }
      refreshProjSurfaces(P);
      App.activeLayer = src;
      refreshLayerList(); refreshSlotList(); draw2D();
    };
    pushAction("place “" + (L.name || "decal") + "” on the texture", back, put);
    put();
    setStatus("“" + (L.name || "Decal") + "” is on the texture " + slot.id + " now — drag it in either view; " +
      (at.scale > 3 ? "it was larger than a flat decal can be, so it is at the largest size; " : "") +
      (sibs.length > 1 ? "it covered " + sibs.length + " textures, and a flat decal is on one, so the parts on the others are gone; " : "") +
      "On the model puts it back on the surface", "ok");
    return true;
  },
};
// Cached world-space bounds per geometry group — the projector rejects whole meshes with this.
function gdBounds(gd){
  if (gd._bb) return gd._bb;
  const pos = gd.position;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i];       if (pos[i] > x1) x1 = pos[i];
    if (pos[i+1] < y0) y0 = pos[i+1];   if (pos[i+1] > y1) y1 = pos[i+1];
    if (pos[i+2] < z0) z0 = pos[i+2];   if (pos[i+2] > z1) z1 = pos[i+2];
  }
  return (gd._bb = { x0, y0, z0, x1, y1, z1 });
}
// Render the projection into every texture it covers. Sheets that already have a layer of this
// group keep it — and its place in the stack — even once the decal has moved off them: an empty
// layer is cheap, whereas re-adding one later would silently move it to the top of the stack.
// noAdd refreshes only the sheets that already have a layer; the live drag uses it, because
// creating layers on every mouse-move frame would leave ones no undo step knows about.
function renderProjGroup(P, noAdd){
  if (!noAdd) {
    ProjLive.gen++;                              // a live render still queued is superseded (decals.js)
    clearTimeout(ProjDrag.timer); ProjDrag.last = ProjDrag.calm = ProjDrag.full = null;   // and a drag's state (1.18)
  }
  const pace = noAdd ? ProjDrag.pace(P) : null;
  if (pace === "same") { ProjDrag.stats.same++; return { added: [], drawn: 0, sheets: 0, pace }; }
  let boxed = false;
  const frame = frameFromArrays(P.frame);
  const existing = new Map();
  for (const e of projSiblings(P.id)) existing.set(e.slot, e.L);
  const added = [];
  let total = 0, sheets = 0;
  for (const slot of App.slots.values()) {
    if (!slot.composite) continue;                 // placeholders included: the layer still previews
    let target = existing.get(slot);
    if (!target) {
      if (noAdd) continue;
      if (!renderProjection(null, P, frame, slot).drawn) continue;  // dry run: don't allocate 12 canvases
      target = LayerNode.of({ type: "paint", name: "Proj: " + (P.name || "image"), canvas: mkCanvas(slot.composite.width, slot.composite.height),
        visible: true, opacity: 1, blend: "normal", proj: P });
      slot.layers.push(target);
      added.push({ slot, L: target });
    } else if (target.canvas.width !== slot.composite.width || target.canvas.height !== slot.composite.height) {
      target.canvas = mkCanvas(slot.composite.width, slot.composite.height);
    }
    // A live frame while the decal moves is drawn in the boxes it moves between (ProjDrag, 1.18); a
    // settled one, and every placement, is the whole sheet.
    if ((pace === "moving" || pace === "slow") && projGL()) {
      const c = target.canvas, side = Math.max(c.width, c.height);
      const sc = pace === "moving" && side > ProjDrag.SIDE ? ProjDrag.SIDE / side : 1;
      const prev = target.liveOn === c ? target.liveBox : target.projBoxOn === c ? target.projBox : undefined;
      const f = renderProjection(c, P, frame, slot, true, null, { prev, scale: sc });
      boxed = true;
      target.liveBox = f.box; target.liveOn = c;
      target.projEmpty = !f.drawn;
      target.projBoxOn = null;
      if (f.drawn) { total += f.drawn; sheets++; }
      if (f.rect) scheduleComposite(slot, rectToSlot(slot, f.rect, c.width, c.height));
      continue;
    }
    const g = ctx2d(target.canvas);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    g.clearRect(0, 0, target.canvas.width, target.canvas.height);
    // The settled live frame measures where it landed, as a placement does, so the next moving frame
    // knows what to clear.
    const r = renderProjection(target.canvas, P, frame, slot, noAdd && pace !== "settled");
    if (noAdd) { target.liveBox = r.box; target.liveOn = target.canvas; if (pace === "settled") ProjDrag.stats.settled++; }
    else target.liveOn = null;
    target.projEmpty = !r.drawn;
    // Where it landed on THIS sheet, kept on the layer it describes. Not stored in the .wtproj:
    // it is recomputed by the next render, and a loaded project's derived layers already hold
    // their pixels, so nothing needs it until the decal moves.
    if (r.box) target.projBox = r.box;
    // …and the canvas that box is round, or null while it is not: a live render moves the pixels and
    // measures nothing, so the box it leaves for the Look is stale until the drop. `projAtUV` reads a
    // texel only inside a current box (4.2's review).
    target.projBoxOn = r.box ? target.canvas : null;
    if (r.drawn) { total += r.drawn; sheets++; }
    scheduleComposite(slot);
  }
  // The Look, as derived channels of this layer (ROADMAP 4.8b, 4.28(f)). Deferred to a non-live
  // render exactly as the item says: this runs a per-pixel walk per channel the Look writes and a
  // channel composite per sheet, and the live drag calls this function on every frame. `noAdd` IS the live path — the same flag, so the two cannot drift.
  // ROADMAP 4.8c. Released BEFORE the refresh, not after: `refreshDecalSurface` reads each derived
  // content's current visibility and puts it back at the end, so refreshing while they are still
  // hidden would make "hidden" the value it restores. The predicate names the LAYER since 4.28(f) —
  // the response is inside it, so there is no sibling to identify.
  if (boxed) ProjDrag.arm(P);
  if (noAdd) SurfDrag.hold(P, x => x.proj === P);
  else { SurfDrag.release(); refreshProjSurfaces(P); }
  return { added, drawn: total, sheets, pace };
}
// One undo step for a whole-group change. Undo re-renders from the old parameters instead of
// snapshotting canvases — a projection is fully described by its source image and its frame, so
// history costs a few hundred bytes rather than 64 MB per sheet. `bytes` is for the one edit whose
// snapshot pins pixels: a new source image (`ProjSource.set`) keeps the old one alive in the step.
function updateProjGroup(P, desc, before, bytes){
  // On no sheet any more: deleted, or undone away, while a gesture or an edit on it was still open —
  // Delete or Ctrl+Z with a handle or the decal held (4.2's review, 2026-09-27), or a key's last
  // repeat before its keyup commits. Every caller is an edit of a decal that exists (a new one is
  // `bakeProjection`'s), so rendering here would put it back as new layers that no step before this
  // one knows about, and undo would then leave two layers of one projection: the decal composited
  // twice. Nothing is put down; what a real render would also have done is still done — a live
  // render still queued is dropped, and whatever the gesture hid (its Look) is shown again, or it
  // would come back hidden with the undone delete. `ProjSource.set` answers the same case first.
  if (!projSiblings(P.id).length) {
    ProjLive.gen++;
    SurfDrag.release();
    return { gone: true, added: [], drawn: 0, sheets: 0 };
  }
  const after = projParamsClone(P);
  if (before && ProjSource.same(before, after)) before = null;   // a click that didn't move it
  const res = renderProjGroup(P);
  const added = res.added;
  const pull = () => { for (const a of added) { const o = nodeOwner(a.slot.layers, a.L); if (o) { o.list.splice(o.i, 1); scheduleComposite(a.slot); } } };
  const push = () => { for (const a of added) if (!nodeOwner(a.slot.layers, a.L)) { a.slot.layers.push(a.L); scheduleComposite(a.slot); } };
  if (before) pushAction(desc,
    () => { pull(); projParamsAssign(P, before); renderProjGroup(P); refreshLayerList(); syncProjUI(); },
    () => { push(); projParamsAssign(P, after); renderProjGroup(P); refreshLayerList(); syncProjUI(); }, bytes);
  refreshLayerList(); syncProjUI();
  return res;
}
// One layer per sheet, and the Look goes with it — since 4.28(f) the response is in that layer's own
// channel slots rather than in sibling layers inside a folder, so deleting the layer cannot leave a
// gloss highlight on the model with nothing in the list to take it off. That is what the folder
// lookup here used to be for.
function deleteProjGroup(P){
  deleteLayerGroup(projSiblings(P.id), "projected decal");
}
// A linked layer (a fill/adjustment/paint spread over every texture one selection covers) is one
// object to the user, so deleting it has to take every copy with it — the same rule projected
// decals already followed.
function deleteLayerGroup(sibs, what){
  if (!sibs.length) return;
  const placed = sibs.map(e => ({ slot: e.slot, L: e.L, idx: e.slot.layers.indexOf(e.L) }));
  const rm = () => {
    for (const q of placed) { const o = nodeOwner(q.slot.layers, q.L); if (o) o.list.splice(o.i, 1); scheduleComposite(q.slot); }
    // No index to clamp any more: activeLayerObj() reports a node that is no longer in the slot as
    // no selection at all, which is what the clamp was reaching for and never quite did.
    setPlacing(false); refreshLayerList(); refreshSlotList();
  };
  const back = () => {
    for (const q of placed.slice().sort((a, b) => a.idx - b.idx))
      if (!nodeOwner(q.slot.layers, q.L)) { q.slot.layers.splice(Math.min(q.idx, q.slot.layers.length), 0, q.L); scheduleComposite(q.slot); }
    refreshLayerList(); refreshSlotList();
  };
  pushAction("delete " + what, back, rm);
  rm();
  setStatus(what[0].toUpperCase() + what.slice(1) + " removed from " + placed.length + " texture" + (placed.length === 1 ? "" : "s"), "ok");
}
// Delete whatever the user thinks of as "this layer": a projected decal, a linked layer spread
// over several textures, or just the one layer.
function deleteLayerObject(s, L){
  if (L && L.proj) return deleteProjGroup(L.proj);
  if (L && L.link) { const sibs = linkSiblings(L.link); if (sibs.length > 1) return deleteLayerGroup(sibs, "linked layer"); }
  deleteLayerAt(s, L);
}
// Move the projector to a new point on the surface, keeping its orientation. This is what makes a
// projected decal draggable — the old code had no way to move one at all.
function moveProjTo(P, point, live){
  P.frame = { p: point.toArray(), n: P.frame.n.slice(), r: P.frame.r.slice(), u: P.frame.u.slice() };
  if (live) { projLiveRender(P); return null; }
  return renderProjGroup(P);
}
// ---- keyboard placement ----
// Three step sizes, because placing a marking accurately and roughing one in are different jobs
// and reaching for a slider loses the keyboard: plain is the normal step, Shift a coarse one
// (rotation snaps to 15°), Alt a fine one — half a degree, half a percent of size.
function beginProjEdit(P){ if (!App._projEdit || App._projEdit.P !== P) App._projEdit = { P, from: projParamsClone(P) }; }
function projStepMul(mod){ return mod === "big" ? 5 : mod === "fine" ? .2 : 1; }
// Nudge along the projector's own axes: ← → follow the image's left/right, ↑ ↓ its up/down,
// whatever angle the camera was at when it was placed.
function nudgeProj(P, dx, dy, mod){
  const frame = frameFromArrays(P.frame);
  const b = projBasis(frame, P.rot, P.flip);
  const { halfW } = projHalfSize(P);
  const step = halfW * .025 * projStepMul(mod);
  const p = frame.p.clone().addScaledVector(b.t1, dx * step).addScaledVector(b.t2, dy * step);
  beginProjEdit(P);
  P.frame = { p: p.toArray(), n: P.frame.n.slice(), r: P.frame.r.slice(), u: P.frame.u.slice() };
  projLiveRender(P);
}
function rotateProj(P, deg, mod){
  beginProjEdit(P);
  let r;
  if (mod === "big") r = Math.round(P.rot / 15) * 15 + (deg > 0 ? 15 : -15);   // snap to the 15° grid
  else if (mod === "fine") r = P.rot + Math.sign(deg) * .5;
  else r = P.rot + deg;
  r = ((r + 180) % 360 + 360) % 360 - 180;
  P.rot = Math.round(r * 10) / 10;                        // a tenth of a degree is the finest the UI shows
  syncProjUI();
  projLiveRender(P);
}
// ROADMAP 4.35(4): "align a decal's rotation to the texture underneath". The projector's own angle
// says nothing about the texel grid — the frame is in world space, the sheet is in UV space, and
// the shell under the decal sits at whatever angle its author unwrapped it. So it is MEASURED: cast
// from the frame's centre down its normal, take the triangle hit, and express the image's right
// axis (t1, projected into that triangle) in the triangle's UV space. Its angle there is how far
// the decal's edges are from the texel rows, and the nearest multiple of 90° is the grid. The
// world→UV map of a triangle is affine, so the UV angle is not simply "rot plus a constant" — it
// is solved by two Newton steps on the measured residual, which is exact enough that the third
// would move a hundredth of a degree. Measured at the centre only: a shell that curves under the
// decal cannot be squared everywhere, and the centre is where the eye reads the edge.
// Returns the degrees turned, or null with nothing under the frame.
function alignProj(P){
  const frame = frameFromArrays(P.frame);
  const rc = new THREE.Raycaster(frame.p.clone().addScaledVector(frame.n, .05), frame.n.clone().negate());
  const hits = rc.intersectObjects(paintTargets(), false);
  const h = hits.length ? hits[0] : null;
  if (!h || !h.face || !h.object.geometry.attributes.uv) return null;
  const pos = h.object.geometry.attributes.position, uv = h.object.geometry.attributes.uv, M = h.object.matrixWorld;
  const W = i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M);
  const U = i => new THREE.Vector2().fromBufferAttribute(uv, i);
  const P0 = W(h.face.a), e1 = W(h.face.b).sub(P0), e2 = W(h.face.c).sub(P0);
  const U0 = U(h.face.a), d1 = U(h.face.b).sub(U0), d2 = U(h.face.c).sub(U0);
  const e11 = e1.dot(e1), e12 = e1.dot(e2), e22 = e2.dot(e2), det = e11 * e22 - e12 * e12;
  if (Math.abs(det) < 1e-12) return null;
  // the residual of the image's right axis against the nearest texel row, at a given rotation
  const residual = rot => {
    const t1 = projBasis(frame, rot, P.flip).t1;
    const a = (t1.dot(e1) * e22 - t1.dot(e2) * e12) / det, b = (e11 * t1.dot(e2) - e12 * t1.dot(e1)) / det;
    const dir = d1.clone().multiplyScalar(a).add(d2.clone().multiplyScalar(b));
    if (dir.lengthSq() < 1e-14) return null;
    const ang = Math.atan2(-dir.y, dir.x) * 180 / Math.PI;      // sheet y runs against v
    return ang - Math.round(ang / 90) * 90;
  };
  let rot = P.rot;
  for (let i = 0; i < 3; i++) {
    const f0 = residual(rot); if (f0 == null) return null;
    if (Math.abs(f0) < .01) break;
    const f1 = residual(rot + 1); if (f1 == null) return null;
    let slope = f1 - f0; slope = ((slope + 45) % 90 + 90) % 90 - 45;   // the residual wraps at ±45
    if (Math.abs(slope) < 1e-4) return null;
    rot -= f0 / slope;
  }
  rot = ((rot + 180) % 360 + 360) % 360 - 180;
  const turned = Math.round((rot - P.rot) * 10) / 10;
  if (!turned) return 0;
  beginProjEdit(P);
  P.rot = Math.round(rot * 10) / 10;
  syncProjUI();
  projLiveRender(P);
  return turned;
}
// Resize from the keyboard. Multiplicative, so a step feels the same on a roundel and on a
// fuselage band; the bounds match the Size slider's own range.
function scaleProj(P, dir, mod){
  beginProjEdit(P);
  const f = mod === "big" ? 1.1 : mod === "fine" ? 1.005 : 1.02;
  P.scale = Math.max(ProjSource.SCALE_MIN, Math.min(ProjSource.SCALE_MAX, P.scale * (dir > 0 ? f : 1 / f)));
  syncProjUI();
  projLiveRender(P);
}
function commitProjEdit(){
  const ed = App._projEdit; if (!ed) return;
  App._projEdit = null;
  const P = ed.P, from = ed.from;
  if (ProjSource.same(from, projParamsClone(P))) return;
  updateProjGroup(P, "move projected decal", from);
}
// The floating UV decal is the SOURCE of a projection, not a second copy of it: once projected it
// is consumed. Leaving it behind is what put a smeared duplicate on the sheet next to the real one.
// `hit` aims it from the camera at a surface point; `at` (ProjSource.fromFlat) instead gives the
// frame, turn, flip, size and mirrored copy outright. Returns whether anything was projected.
function bakeProjection(L, hit, at){
  if (!App.geomData) { setStatus("Projection needs the 3D model loaded", "err"); return false; }
  const srcSlot = slotOfLayer(L);
  const srcIdx = srcSlot ? srcSlot.layers.indexOf(L) : -1;
  const P = { id: "p" + (projSeq++), frame: at ? at.frame : frameToArrays(projFrame(hit)), bmp: L.bmp,
    scale: at ? Math.max(ProjSource.SCALE_MIN, Math.min(ProjSource.SCALE_MAX, at.scale)) : L.scale, rot: at ? at.rot : L.rot,
    // `surf` is the Look the decal was given in the editor, and since 4.8b it is read: the first
    // non-live render turns it into derived content on the projected layer's own smoothness, metal
    // and normal channels (4.28(f)), on every sheet the projection landed on.
    flip: at ? at.flip : !!L.flip, sym2: at ? at.sym2 : symEnabled(), name: L.name, surf: L.surf || null,
    // the depth image travels with the Look that names it (4.19), on the model as on the sheet
    heightMap: L.heightMap || null, heightName: L.heightName || null,
    // Text stays text once projected (4.50 (3)): the record rides with the image it drew, so
    // "Edit text…" can re-render and re-project it (`ProjSource.edit`).
    text: L.text ? { ...L.text } : null,
    depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF,
    parts: App.selParts.size ? [...App.selParts] : null };
  const res = renderProjGroup(P);
  if (!res.drawn) {
    for (const a of res.added) { const o = nodeOwner(a.slot.layers, a.L); if (o) o.list.splice(o.i, 1); scheduleComposite(a.slot); }
    setStatus("Nothing projected — the image landed on parts with no editable texture, on a protected part, or it faces away from the camera", "err");
    return false;
  }
  const added = res.added;
  const bytes = added.reduce((n, a) => n + a.L.canvas.width * a.L.canvas.height * 4, 0);
  // Both directions end with refreshProjSurfaces, which keeps the Look in step with the layers: the
  // derived content lives in the decal's own node since 4.28(f), so on the way out it leaves with the
  // layer, and on the way back in it is rebuilt from the projection (ROADMAP 4.8b).
  const rm = () => {                                          // apply: layers in, source decal out
    for (const a of added) if (!nodeOwner(a.slot.layers, a.L)) { a.slot.layers.push(a.L); scheduleComposite(a.slot); }
    if (srcIdx >= 0) { const o = nodeOwner(srcSlot.layers, L); if (o) { o.list.splice(o.i, 1); scheduleComposite(srcSlot); } }
    refreshProjSurfaces(P);
  };
  const back = () => {                                        // undo: layers out, source decal back
    for (const a of added) { const o = nodeOwner(a.slot.layers, a.L); if (o) { o.list.splice(o.i, 1); scheduleComposite(a.slot); } }
    refreshProjSurfaces(P);
    if (srcIdx >= 0 && !nodeOwner(srcSlot.layers, L)) { srcSlot.layers.splice(Math.min(srcIdx, srcSlot.layers.length), 0, L); scheduleComposite(srcSlot); }
    if (srcSlot === App.activeSlot) App.activeLayer = L;
    refreshLayerList(); refreshSlotList();
  };
  pushAction("project “" + L.name + "”", back, () => { rm(); refreshLayerList(); refreshSlotList(); }, bytes);
  rm();
  // land on the projected layer, in whichever slot it went to, so its controls are right there
  const here = added.find(a => a.slot === App.activeSlot) || added[0];
  if (here) { if (here.slot !== App.activeSlot) selectSlot(here.slot.id); App.activeLayer = here.L; }
  const names = added.map(a => a.slot.id);
  const blank = added.filter(a => a.slot.missing).map(a => a.slot.id);
  setPlacing(false);
  refreshLayerList(); refreshSlotList();
  setStatus("“" + (L.name || "Decal") + "” is on the model" + (names.length > 1 ? ", across " + names.length + " textures (" + names.join(", ") + ")" : "") +
    (blank.length ? " — note: " + blank.join(", ") + " has no texture loaded yet, so that part will not export" : "") +
    " — drag it to move it, in either view; its corners resize it and the knob above it turns it", "ok");
  return true;
}

