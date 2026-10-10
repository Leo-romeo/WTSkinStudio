// ---- The decal you are carrying ----
// A picked decal stays bound to the pointer until it is put down: the camera can be orbited, a slot
// picked, tabs switched, and the thing you chose is still visibly in hand. The only previous signal
// that the next click would drop an image somewhere was a line of status text, which is nowhere
// near where anyone is looking while lining a projection up on the model.
//
// Gathered on one object beside DecalLib / DecalTree / DecalUI rather than spread across four more
// top-level names (§2: no new bare globals).
const DecalCarry = {
  // Show / hide the ghost. `set(null)` is the only way it goes away, and setPlacing is the single
  // caller that ends a carry, so no path can strand it on the cursor.
  set(bmp, label){
    const el = $("carryGhost");
    App.carry = bmp ? { label: label || "decal" } : null;
    document.body.classList.toggle("carrying", !!bmp);
    if (!el) return;
    if (!bmp) { el.style.display = "none"; return; }
    const c = el.querySelector("canvas"), g = ctx2d(c);
    const k = Math.min(72 / bmp.width, 72 / bmp.height, 1);
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    el.querySelector(".cap").textContent = label || "decal";
    el.style.display = "block";
  },
  clear(){ this.set(null); },
  // The one way a finished image becomes a decal on the skin. With a slot it lands as a layer and
  // arms placement; without one it stays in hand instead of being thrown away with an error,
  // because the user has already done the work of choosing and editing it.
  place(canvas, meta, name){
    const nm = (meta && meta.name) || name || "decal";
    const surf = meta && meta.surf;
    const s = App.activeSlot;
    if (s && s.composite) {
      addDecalLayer(canvas, nm);
      const L = activeLayerObj();
      // The Look is REMEMBERED here and applied when the decal is put down — not now. Applying it
      // at this moment was the 4.8 bug reported 2026-08-26: `addDecalLayer` puts the app straight
      // into projection mode with the decal floating at the sheet centre, so there is nowhere yet
      // for a surface response to be derived from — and building the group here also moved the
      // selection onto the group, which broke every path that asks `activeLayerObj().type ===
      // "decal"`: clicking the model to place or project it, and G.
      if (L && L.type === "decal" && surf) { L.surf = surf; applyDecalSurfUI(L); }
      // The depth image travels with the Look that names it (ROADMAP 4.19). A relief mode of "map"
      // with no map is a mode that cannot do what it says, so `refreshDecalSurface` falls back to
      // the outline — which is honest, and also exactly what used to happen to every decal that came
      // back out of the library.
      if (L && L.type === "decal" && meta && meta.height) { L.heightMap = meta.height; L.heightName = meta.heightName || null; }
      // Text stays text (4.50 (3)): the record the image was drawn from goes on with it, so the
      // decal can be edited AS text — here, once projected, and out of the library. Its name is
      // the lettering as typed; `addDecalLayer` strips what looks like a file extension, which
      // would take "SGT. PEPPER" down to "SGT".
      if (L && L.type === "decal" && meta && meta.text) { L.text = { ...meta.text }; L.name = nm; refreshLayerList(); }
      return true;
    }
    pendingDecal = { bmp: canvas, name: nm, surf, edited: true, text: (meta && meta.text) || null,
                     height: (meta && meta.height) || null, heightName: (meta && meta.heightName) || null };
    this.set(canvas, nm);
    setStatus("“" + nm + "” is in hand — load a model or textures, then pick a texture slot and it drops straight on", "ok");
    return false;
  },
  // A decal picked before any texture was open waits on the cursor; this is what finally puts it
  // down, once there is a slot to put it on. Nothing happens when nothing is held.
  dropPending(){
    const p = pendingDecal;
    if (!p || !p.edited || !App.activeSlot || !App.activeSlot.composite) return false;
    pendingDecal = null;
    this.clear();
    return this.place(p.bmp, { name: p.name, surf: p.surf, height: p.height, heightName: p.heightName, text: p.text });
  },
};
// Offset down-right of the hotspot, so the ghost never covers the point being clicked.
window.addEventListener("pointermove", e => {
  if (!App.carry) return;
  const el = $("carryGhost");
  el.style.left = (e.clientX + 16) + "px";
  el.style.top = (e.clientY + 18) + "px";
}, { passive: true });
// The look chosen in the editor drives the "Surface under decal" bake.
function applyDecalSurfUI(L){
  if (!L || !L.surf) return;
  const p = L.surf.preset && SURF_PRESETS[L.surf.preset] ? L.surf.preset : "custom";
  $("surfPreset").value = p;
  $("surfCustom").style.display = p === "custom" ? "" : "none";
  // By the delta table, not by three named lines — that is what let wear be added as a table entry
  // (4.28(f), 2026-09-02). `surfDeltas` fills in a key an older look does not carry.
  const d = surfDeltas(L.surf);
  for (const k in SURF_DELTA_CHAN) {
    const id = "sc" + k[0].toUpperCase() + k[1];
    $(id).value = d[k]; $(id + "Val").textContent = d[k];
  }
}
$("btnDecalEditor").onclick = () => {
  const L = activeLayerObj(), s = App.activeSlot;
  if (!L || L.type !== "decal") { setStatus("Select a decal layer first", "err"); return; }
  // Text is re-drawn from its record rather than edited as pixels (4.50 (3)): the button says
  // "Edit text…" on such a decal (`syncDecalUI`).
  if (L.text) { TextDecal.editFloating(L, s); return; }
  openDecalEditor(L.orig || L.bmp, L.name, (canvas, meta) => {
    const before = L.bmp, after = canvas;
    const apply = v => { L.bmp = v; scheduleComposite(s); draw2D(); };
    pushAction("edit decal", () => apply(before), () => apply(after), (after.width * after.height + before.width * before.height) * 4);
    if (!L.orig) L.orig = before;
    L.surf = meta.surf;
    // The depth map is left as it is — which is what this line always did, `meta.height` being the
    // map it was given until 4.2b's review (2026-09-26) made the editor crop and turn it with the
    // image. This editor reopens on the untouched ORIGINAL (`L.orig`) while the map belongs to the
    // image on the sheet, so the dialog's crop is not a crop of the map's image and following it
    // would misplace the relief the other way round; and this step's undo swaps the image only. A
    // projected decal's editor opens on the image as it is, and takes the map (`ProjSource.edit`).
    // Open in ROADMAP 4.2 with the per-decal editor memory, which decides what the editor opens on.
    L.name = meta.name || L.name;
    apply(after);
    applyDecalSurfUI(L);
    ReliefUI.sync();
    refreshLayerList();
  }, { look: L.surf, height: L.heightMap || null, heightName: L.heightName || null });
};
function addDecalLayer(bmp, name){
  const s = App.activeSlot; if (!s || !s.composite) { setStatus("Select a slot first", "err"); return; }
  const scale = Math.min(1, (s.size * .3) / Math.max(bmp.width, bmp.height));
  addLayer(LayerNode.of({ type: "decal", name: name.replace(/\.[^.]+$/, ""), bmp, visible: true, opacity: 1, blend: "normal", x: .5, y: .5, scale, rot: 0, flip: false }));
  syncDecalUI();
  // Straight into projection: dropping an image into UV space is what makes it look smeared
  // across the model, because the UV atlas is not the shape of the aircraft.
  setPlacing(App.geomData ? "proj" : "uv");
  DecalCarry.set(bmp, name);                   // after setPlacing — that call clears any earlier carry
  setStatus(App.geomData
    ? "Image added — click it onto the model from the angle you want it seen; it wraps around the surface. (Move to clicked spot places it in UV space instead.)"
    : "Image added — drag it in 2D, nudge with arrow keys ( , / . rotate)", "ok");
}
// Nudge / rotate the active decal (arrow keys + , . keys), coalescing a key-hold into one undo.
function nudgeDecal(dx, dy){
  const L = decalOfSelection(), s = App.activeSlot; if (!L || L.type !== "decal" || !s) return;
  beginDecalEdit(L);
  const px = L.x, py = L.y;
  L.x = Math.max(0, Math.min(1, L.x + dx)); L.y = Math.max(0, Math.min(1, L.y + dy));
  moveDecalSiblings(s, L, L.x - px, L.y - py);   // anything else in its group comes along
  scheduleComposite(s); draw2D();
}
function rotateDecal(deg, mod){
  const L = decalOfSelection(), s = App.activeSlot; if (!L || L.type !== "decal" || !s) return;
  beginDecalEdit(L);
  let r;
  if (mod === "big") r = Math.round(L.rot / 90) * 90 + (deg > 0 ? 90 : -90);   // snap to the quarter turns
  else if (mod === "fine") r = L.rot + Math.sign(deg) * .5;
  else r = L.rot + deg;
  r = ((r + 180) % 360 + 360) % 360 - 180;
  L.rot = Math.round(r * 10) / 10;
  syncDecalUI(); scheduleComposite(s); draw2D();
}
// The floating UV decal resizes from the keyboard on the same three steps as the projected one.
function scaleDecal(dir, mod){
  const L = decalOfSelection(), s = App.activeSlot; if (!L || L.type !== "decal" || !s) return;
  beginDecalEdit(L);
  const f = mod === "big" ? 1.1 : mod === "fine" ? 1.005 : 1.02;
  L.scale = Math.max(.01, Math.min(3, L.scale * (dir > 0 ? f : 1 / f)));
  syncDecalUI(); scheduleComposite(s); draw2D();
}
function beginDecalEdit(L){ if (!App._decalEdit || App._decalEdit.L !== L) App._decalEdit = { L, from: { x: L.x, y: L.y, rot: L.rot, scale: L.scale } }; }
// Topmost visible decal layer whose placed footprint contains texture-space point (px,py).
// Returns the LAYER, not an index: with groups in the tree an index into the flattened leaves is
// not an index into `slot.layers`, and the two agreeing today is only because nothing has a group
// in it yet (ROADMAP 4.9).
function decalAtUV(slot, px, py){
  const dl = visibleLeaves(slot.layers);
  for (let i = dl.length - 1; i >= 0; i--) {
    const L = dl[i];
    if (L.type !== "decal" || !L.bmp) continue;
    const hit = (cx, cy, rot, flipSign) => {
      const dx = px - cx * slot.composite.width, dy = py - cy * slot.composite.height;
      const cos = Math.cos(-rot * Math.PI / 180), sin = Math.sin(-rot * Math.PI / 180);
      const lx = (dx * cos - dy * sin) / (L.scale * flipSign), ly = (dx * sin + dy * cos) / L.scale;
      return Math.abs(lx) < L.bmp.width / 2 && Math.abs(ly) < L.bmp.height / 2;
    };
    if (hit(L.x, L.y, L.rot, L.flip ? -1 : 1)) return L;
    if (L.sym && hit(L.sym.x, L.sym.y, -L.rot, L.flip ? 1 : -1)) return L;   // the mirrored copy counts
  }
  return null;
}
// Topmost visible projected layer whose baked pixels are opaque at texture-space (px,py) —
// this is what makes clicking a projected decal on the model select and grab it.
// A texel is only READ where the layer can have one: not on a layer that drew nothing, nor outside
// the box its last real render measured round everything it drew (`projBox`, renderProjGroup) —
// trusted only while it still describes this canvas, which a live render, measuring nothing, ends.
// Every readback is a full-surface transfer on an accelerated canvas (wt-canvas), and since the sheet
// took presses on projected decals (ROADMAP 4.2) a pan's press read every projected layer on the
// sheet; now it reads none (review, 2026-09-27; t100 counts them).
function projAtUV(slot, px, py){
  const x = px | 0, y = py | 0;
  const pl = visibleLeaves(slot.layers);
  for (let i = pl.length - 1; i >= 0; i--) {
    const L = pl[i];
    if (!L.proj || !L.canvas || L.projEmpty) continue;
    if (x < 0 || y < 0 || x >= L.canvas.width || y >= L.canvas.height) continue;
    const b = L.projBoxOn === L.canvas ? L.projBox : null;
    if (b && (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h)) continue;
    if (ctx2d(L.canvas).getImageData(x, y, 1, 1).data[3] > 12) return L;
  }
  return null;
}
function commitDecalEdit(){
  const ed = App._decalEdit; if (!ed) return; App._decalEdit = null;
  const L = ed.L, from = ed.from, to = { x: L.x, y: L.y, rot: L.rot, scale: L.scale };
  if (from.x === to.x && from.y === to.y && from.rot === to.rot && from.scale === to.scale) return;
  const s = App.activeSlot;
  // A surface response is DERIVED from where the decal sits, so moving the decal has to rebuild it
  // — otherwise the gloss stays behind on the fuselage where the sticker used to be (ROADMAP 4.8).
  // This is also where a decal that arrived from the editor with a Look FIRST gets one: a decal is
  // put down by being moved, and until it has been there is nothing to derive from.
  const apply = v => { L.x = v.x; L.y = v.y; L.rot = v.rot; if (v.scale != null) L.scale = v.scale;
    syncDecalUI(); ensureDecalSurface(s, L); scheduleComposite(s); draw2D(); };
  pushAction("move decal", () => apply(from), () => apply(to));
}
function syncDecalUI(){
  const L = activeLayerObj();
  if (!L || L.type !== "decal") return;
  $("decScale").value = Math.round(L.scale * 100); $("decScaleVal").textContent = L.scale.toFixed(2);
  $("decRot").value = L.rot; $("decRotVal").value = Math.round(L.rot * 10) / 10;
  TextUI.label($("btnDecalEditor"), !!L.text);            // "Edit text…" on text (4.50 (3))
  TextUI.lockPixels(!!L.text);
}
// ---- projected-image layer controls ----
function syncProjUI(){
  const L = activeLayerObj();
  if (!L || !L.proj) return;
  const P = L.proj;
  $("projScale").value = Math.round(P.scale * 100); $("projScaleVal").textContent = P.scale.toFixed(2);
  $("projRot").value = P.rot; $("projRotVal").value = Math.round(P.rot * 10) / 10;
  const dep = P.depth == null ? PROJ_DEPTH_DEF : P.depth, wrp = P.wrap == null ? PROJ_WRAP_DEF : P.wrap;
  $("projDepth").value = Math.round(dep * 100); $("projDepthVal").textContent = projDepthText(P);
  $("projWrap").value = Math.round(wrp * 100); $("projWrapVal").textContent = Math.round(wrp * 100) + "%";
  $("projSym2").checked = !!P.sym2;
  $("projSym2Read").checked = !!P.sym2Read;
  TextUI.label($("btnProjEdit"), !!P.text);              // "Edit text…" on projected text (4.50 (3))
  // The row is only a question while there IS a copy to ask it about.
  $("rowSymRead").style.display = P.sym2 ? "" : "none";
  // Which Look this projection is carrying. A saved decal can hold deltas that match no preset —
  // report that as "Custom" rather than showing one it is not.
  const ps = $("projSurf");
  if (ps) {
    const d = surfDeltas(P.surf);
    const key = Object.keys(SURF_PRESETS).find(k =>
      Object.keys(SURF_DELTA_CHAN).every(x => (SURF_PRESETS[k][x] || 0) === d[x]));
    ps.value = key || "custom";
  }
  // Which plane the copy is mirrored across, and how symmetric the model actually is about it —
  // measured, not assumed (findSymmetry). A low score is the honest way to say "this vehicle has no
  // usable mirror plane" instead of putting the copy somewhere meaningless.
  const si = $("projSymInfo");
  if (si) {
    const { a } = symPlane();
    // The two sources measure different things, so they are reported differently rather than
    // squeezed into one number: pairs count agreeing twins, the shape scan counts overlap.
    let how = "";
    if (App.symFrom === "pairs" && a === App.autoAxis) how = " · " + App.symPairs + " mirrored part pairs";
    else if (App.symScores && App.symScores[a] != null) how = " · " + Math.round(App.symScores[a] * 100) + "% symmetric";
    si.textContent = App.mirrorCenters ? a + " plane" + how : "";
    si.title = App.symFrom === "pairs"
      ? "Taken from the model's own part names — the midpoint between each left/right pair. Change the axis, or nudge it, in the brush panel."
      : "This model names no left/right parts, so the plane was measured from its shape. Change the axis, or nudge it, in the brush panel.";
  }
  const sibs = projSiblings(P.id);
  const info = $("projInfo");
  if (info) {
    info.textContent = sibs.length > 1
      ? "One decal across " + sibs.length + " textures: " + sibs.map(e => e.slot.id).join(", ") + " — moving, size, rotate and delete apply to all of them."
      : "";
    info.style.display = sibs.length > 1 ? "" : "none";
  }
}
// Size / rotate / depth / wrap re-project live while their slider moves, at most one render a frame
// (`projLiveRender` coalesces). A drag, a nudge and a handle render ungated; the SLIDER is gated,
// because a slider fires faster than a slow machine can re-project and must not lock up.
//
// **The gate, re-tuned 2026-09-26 (ROADMAP 4.2).** It used to be one number: the last live render
// over 45 ms turned slider preview off, and nothing but a drag or a nudge ever measured it again — so
// ONE slow frame (the first render after an upload, a collection pause) latched every slider to
// on-release for the rest of the session. The GPU projector is 0.5–4 ms, so on a real GPU the gate
// only ever closed by accident. It stays, because WebGL in software (hardware acceleration off,
// SwiftShader) and the canvas fallback can take hundreds of milliseconds a render; but it can no
// longer latch:
//   * it closes only on TWO consecutive live renders over budget, never on one;
//   * closed, a slider still re-projects instead of never, once the thread has been left alone for
//     EVERY ms AND for IDLE times the last render's own cost since that render ENDED — and each of
//     those renders is a fresh measurement, so one fast render reopens it.
// Timed from a render's START, as it first was, the wait shrank by whatever the render took and was
// gone at 250 ms: a closed gate then rendered back to back, exactly like an open one, in the one range
// it is kept for (review, 2026-09-27: 400 ms renders ran 3–14 ms apart and held the UI thread 96 % of
// the time). Measured from the end, however slow a render gets, a slider holds the thread a third of
// the time at most.
// `tools/t100_handles.mjs` drives it with renders made slow on purpose — 60 ms and 300 ms — and fails
// the old single-number rule and the start-timed one.
const ProjLive = {
  BUDGET: 45,             // ms: a live render slower than this, twice running, closes the gate
  EVERY: 250,             // ms: while closed, the least idle time between one render's end and the next
  IDLE: 2,                // …and at least this many times the last render's own cost
  ms: [0, 0],             // the last two live renders, newest first
  end: -Infinity,         // when the last one ended
  pending: false,
  // Every real (non-live) render bumps `gen` (renderProjGroup). A live render queued BEFORE one is
  // stale when its frame comes: the real render already drew the same parameters and rebuilt the
  // decal's Look — and running the live one after it would hide that Look again (`SurfDrag.hold`),
  // with no drop left to release it. A move and a release inside one frame is all it takes: a drag,
  // a handle or a nudge whose last step and its commit share a frame.
  gen: 0, want: 0,
  closed(){ return ProjLive.ms[0] >= ProjLive.BUDGET && ProjLive.ms[1] >= ProjLive.BUDGET; },
  ok(){
    return !ProjLive.closed() ||
      performance.now() - ProjLive.end >= Math.max(ProjLive.EVERY, ProjLive.IDLE * ProjLive.ms[0]);
  },
};
let projEditFrom = null;
function projLiveRender(P){
  ProjLive.want = ProjLive.gen;                        // the newest request, not the first, decides
  if (ProjLive.pending) return;
  ProjLive.pending = true;
  requestAnimationFrame(() => {
    ProjLive.pending = false;
    if (ProjLive.want !== ProjLive.gen) return;
    const t0 = performance.now();
    renderProjGroup(P, true);
    ProjLive.end = performance.now();
    ProjLive.ms = [ProjLive.end - t0, ProjLive.ms[0]];
  });
}
function projSliderInput(P, label, val){
  const el = $(label);
  if (el.tagName === "INPUT") el.value = parseFloat(val); else el.textContent = val;   // the rotation readout is typed into (4.35(3))
  if (!projEditFrom) projEditFrom = projParamsClone(P);
  if (ProjLive.ok()) projLiveRender(P);
}
function projSliderCommit(P, desc){
  const from = projEditFrom; projEditFrom = null;
  if (!from) return;
  updateProjGroup(P, desc, from);
}
$("projScale").oninput = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  L.proj.scale = +e.target.value / 100;
  projSliderInput(L.proj, "projScaleVal", L.proj.scale.toFixed(2));
};
$("projRot").oninput = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  L.proj.rot = +e.target.value;
  projSliderInput(L.proj, "projRotVal", L.proj.rot + "°");
};
// Depth reads in metres as well as in multiples, because "3×" means nothing until you know how
// big the image is on the vehicle.
function projDepthText(P){
  const d = P.depth == null ? PROJ_DEPTH_DEF : P.depth;
  if (!P.bmp) return d.toFixed(1) + "×";
  const { halfW, halfH } = projHalfSize(P);
  return d.toFixed(1) + "× (" + projDepthLim(P, halfW, halfH).toFixed(2) + " m)";
}
function projRotText(r){ return (Math.round(r * 10) / 10) + "°"; }
$("projDepth").oninput = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  L.proj.depth = +e.target.value / 100;
  projSliderInput(L.proj, "projDepthVal", projDepthText(L.proj));
};
$("projWrap").oninput = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  L.proj.wrap = +e.target.value / 100;
  projSliderInput(L.proj, "projWrapVal", Math.round(L.proj.wrap * 100) + "%");
};
$("projScale").onchange = () => { const L = decalOfSelection(); if (L && L.proj) projSliderCommit(L.proj, "projected decal size"); };
$("projRot").onchange = () => { const L = decalOfSelection(); if (L && L.proj) projSliderCommit(L.proj, "projected decal angle"); };
$("projDepth").onchange = () => { const L = decalOfSelection(); if (L && L.proj) projSliderCommit(L.proj, "projection depth"); };
$("projWrap").onchange = () => { const L = decalOfSelection(); if (L && L.proj) projSliderCommit(L.proj, "projection wrap"); };
$("projSym2Read").onchange = () => {
  const L = decalOfSelection();
  if (!L || !L.proj) return;
  const from = projParamsClone(L.proj);
  L.proj.sym2Read = $("projSym2Read").checked;
  updateProjGroup(L.proj, L.proj.sym2Read ? "keep the mirrored copy readable" : "mirror the copy's image too", from);
  setStatus(L.proj.sym2Read
    ? "The mirrored copy stays where it is and its image reads the same way round as the original — for lettering"
    : "The mirrored copy is a true reflection again, image and all — for a shape that should point forward on both sides", "ok");
};
$("btnProjFlip").onclick = () => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const from = projParamsClone(L.proj);
  L.proj.flip = !L.proj.flip;
  updateProjGroup(L.proj, "flip projected decal", from);
};
// ---- the vertical mirror, which is not a third transform (ROADMAP 4.2) ----
// The item asked for a `flipY` beside `flip`, noting that `L.flip` is `scale(-1, 1)` and there is no
// vertical one anywhere in the app. There does not need to be: **a vertical mirror is a horizontal
// mirror and a half turn**, and both of those already exist on every decal, on every path, in the
// project format and in the projector. A third stored field would be a fourth thing every one of
// those fourteen sites has to agree about, for a transform they can already express.
//
// What was genuinely missing is the BUTTON — doing it by hand means two controls in the right order,
// and getting the order wrong leaves a marking rotated rather than flipped. So it is one command and
// one undo step over the two fields.
function flipDecalV(rot){ const r = rot + 180; return Math.round((((r + 180) % 360 + 360) % 360 - 180) * 10) / 10; }
$("btnProjFlipY").onclick = () => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const from = projParamsClone(L.proj);
  L.proj.flip = !L.proj.flip;
  L.proj.rot = flipDecalV(L.proj.rot);
  updateProjGroup(L.proj, "flip projected decal vertically", from);
  setStatus("Flipped top to bottom — a vertical mirror is the horizontal one plus a half turn, so that is what this did, in one step", "ok");
};
// The mirrored copy is a property OF THIS DECAL. It used to be a snapshot of the brush panel's
// Symmetry checkbox taken once, at bake time, with nothing able to change it afterwards — so
// unticking that checkbox left the second copy on the model and no control removed it.
// Ticked by default for a copy made from now on, and ABSENT — so a true reflection — on every
// projection written before the field existed. That is the same `== null` rule depth and wrap
// follow: an old file renders exactly as it did, and a new copy gets the behaviour the report asked
// for (ROADMAP 4.2, reported 2026-08-23).
$("projSym2").onchange = () => {
  const L = activeLayerObj();
  if (!L || !L.proj) return;
  const from = projParamsClone(L.proj);
  if ($("projSym2").checked && L.proj.sym2Read == null) { L.proj.sym2Read = true; $("projSym2Read").checked = true; }
  L.proj.sym2 = $("projSym2").checked;
  const res = updateProjGroup(L.proj, L.proj.sym2 ? "add mirrored copy" : "remove mirrored copy", from);
  if (!L.proj.sym2) setStatus("Mirrored copy removed", "ok");
  else setStatus(res.drawn ? "Mirrored copy added across the " + symPlane().a + " plane" +
    " — set the axis and offset in the brush panel if it lands wrong"
    : "The mirrored copy landed on nothing — check the symmetry axis in the brush panel", res.drawn ? "ok" : "err");
};
// The "select a projected decal layer first" message belongs HERE, where the user has just asked
// for the mode and can act on it — not on every later click on the model, which is where it used to
// come out once the mode outlived its layer.
$("btnProjMove").onclick = () => {
  if (App.placing === "movproj") { setPlacing(false); return; }
  const L = decalOfSelection();
  // Three different situations used to give one answer. "Select a projected decal layer first" is
  // right when nothing decal-ish is selected; it is a poor answer when a decal IS selected and has
  // simply not been projected yet, which is the state G was pressed in (reported 2026-08-26).
  if (!L) { setStatus("Select a decal layer first — G moves a decal that has been projected onto the model", "err"); return; }
  if (!L.proj) {
    // "Click it onto the model first" was the answer here until 2026-09-02, and it was wrong in the
    // one state a user reaches by following the panel: "Move to clicked spot" DOES click it onto
    // the model, in UV, and G then told them to do what they had just done ("error keeps saying it
    // floats in uv"). UV placement and projection are two different things and this is the only
    // message that has to tell them apart, so it names the button that makes the difference.
    setStatus("“" + (L.name || "This decal") + "” is placed in UV space, not projected — “Project onto model” is what puts it on the " +
      "surface, and G moves it once it is there. Where it is now, drag it in the 2-D view or nudge it with the arrow keys.", "err");
    return;
  }
  setPlacing("movproj");
};
// Re-aim the projector at the current camera without moving where it sits on the vehicle —
// the fix for "I projected it from the wrong angle".
$("btnReproject").onclick = () => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const P = L.proj, from = projParamsClone(P);
  const n = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).normalize();
  const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const u = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  P.frame = { p: P.frame.p.slice(), n: n.toArray(), r: r.toArray(), u: u.toArray() };
  const res = updateProjGroup(P, "re-aim projected decal", from);
  setStatus(res.drawn ? "Re-projected from this view onto " + res.sheets + " texture" + (res.sheets === 1 ? "" : "s")
    : "Nothing hit from this angle — the surface faces away from the camera, or the Depth is too shallow to reach it", res.drawn ? "ok" : "err");
};
$("btnProjDelete").onclick = () => { const L = decalOfSelection(); if (L && L.proj) deleteProjGroup(L.proj); };
bindUndoRange($("decScale"), () => { const L = activeLayerObj(); return L ? L.scale * 100 : 100; },
  v => { const L = activeLayerObj(); if (L && L.type === "decal") { L.scale = v / 100; scheduleComposite(App.activeSlot); } },
  "decal scale", () => { const L = activeLayerObj(); if (L) $("decScaleVal").textContent = L.scale.toFixed(2); });
bindUndoRange($("decRot"), () => { const L = activeLayerObj(); return L ? L.rot : 0; },
  v => { const L = activeLayerObj(); if (L && L.type === "decal") { L.rot = v; scheduleComposite(App.activeSlot); } },
  "decal rotation", () => { const L = activeLayerObj(); if (L) $("decRotVal").value = Math.round(L.rot * 10) / 10; });
// ROADMAP 4.35(3): the angle can be TYPED. The readout beside each Rotate slider is a number
// field; a value typed there is one undo step, like a slider's whole drag. 4.35(4): "Square" —
// for a 2-D decal that is the nearest right angle, since its rotation IS in sheet space; for a
// projection it is measured against the shell under the frame (alignProj).
$("projRotVal").onchange = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const v = Math.max(-180, Math.min(180, parseFloat(e.target.value) || 0));
  beginProjEdit(L.proj); L.proj.rot = Math.round(v * 10) / 10; syncProjUI(); projLiveRender(L.proj); commitProjEdit();
};
$("decRotVal").onchange = e => {
  const L = activeLayerObj(); if (!L || L.type !== "decal") return;
  const v = Math.max(-180, Math.min(180, parseFloat(e.target.value) || 0)), f = L.rot, s = App.activeSlot;
  if (v === f) return;
  const apply = r => { L.rot = r; scheduleComposite(s); syncDecalUI(); refreshLayerList(); };
  pushAction("decal rotation", () => apply(f), () => apply(v));
  apply(v);
};
$("btnDecSquare").onclick = () => {
  const L = activeLayerObj(); if (!L || L.type !== "decal") return;
  const to = Math.round(L.rot / 90) * 90, f = L.rot, s = App.activeSlot;
  if (to === f) { setStatus("Already square to the texel grid", "ok"); return; }
  const apply = r => { L.rot = ((r + 180) % 360 + 360) % 360 - 180; scheduleComposite(s); syncDecalUI(); refreshLayerList(); };
  pushAction("square decal", () => apply(f), () => apply(to));
  apply(to);
  setStatus("Squared to the texel grid — turned " + (Math.round((to - f) * 10) / 10) + "°", "ok");
};
$("btnProjSquare").onclick = () => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const turned = alignProj(L.proj);
  if (turned == null) { setStatus("Nothing under the frame's centre to square to — move the decal onto the model first", "err"); return; }
  if (!turned) { setStatus("Already square to the texture under it", "ok"); return; }
  commitProjEdit();
  setStatus("Squared to the texture under the decal's centre — turned " + turned + "°", "ok");
};
$("btnDecFlip").onclick = () => {
  const L = decalOfSelection(); if (!L || L.type !== "decal") return;
  const s = App.activeSlot;
  const apply = v => { L.flip = v; scheduleComposite(s); };
  pushAction("flip decal", () => apply(!L.flip), () => apply(L.flip));
  apply(!L.flip);
};
$("btnDecFlipY").onclick = () => {
  const L = decalOfSelection(); if (!L || L.type !== "decal") return;
  const s = App.activeSlot;
  const was = { flip: !!L.flip, rot: L.rot }, now = { flip: !L.flip, rot: flipDecalV(L.rot) };
  const apply = v => { L.flip = v.flip; L.rot = v.rot; syncDecalUI(); scheduleComposite(s); draw2D(); };
  pushAction("flip decal vertically", () => apply(was), () => apply(now));
  apply(now);
  setStatus("Flipped top to bottom — a vertical mirror is the horizontal one plus a half turn, so that is what this did, in one step", "ok");
};
$("btnPlace3d").onclick = () => setPlacing(App.placing === "uv" ? false : "uv");
$("btnProject3d").onclick = () => setPlacing(App.placing === "proj" ? false : "proj");
$("btnDecSymClear").onclick = () => {
  const L = activeLayerObj(); if (!L || L.type !== "decal" || !L.sym) return;
  const s = App.activeSlot, old = L.sym;
  pushAction("clear decal mirror", () => { L.sym = old; scheduleComposite(s); draw2D(); }, () => { L.sym = null; scheduleComposite(s); draw2D(); });
  L.sym = null; scheduleComposite(s); draw2D();
};
function ensureDecalCanvas(L){
  if (L.bmp instanceof HTMLCanvasElement) { if (!L.orig) L.orig = snapCanvas(L.bmp); return; }
  const c = mkCanvas(L.bmp.width, L.bmp.height);
  c.getContext("2d").drawImage(L.bmp, 0, 0);
  L.orig = L.bmp; L.bmp = c;
}
$("bgTol").oninput = e => $("bgTolVal").textContent = e.target.value;
$("btnBgApply").onclick = () => {
  const L = decalOfSelection(); if (!L || L.type !== "decal") return;
  ensureDecalCanvas(L);
  const s = App.activeSlot;
  bakeAction("remove decal background", [L.bmp], () => {
    const g = ctx2d(L.bmp);
    const img = g.getImageData(0, 0, L.bmp.width, L.bmp.height);
    const d = img.data, mode = $("bgMode").value;
    let kr, kg, kb;
    if (mode === "white") kr = kg = kb = 255;
    else if (mode === "black") kr = kg = kb = 0;
    else { kr = d[0]; kg = d[1]; kb = d[2]; }
    const tol = +$("bgTol").value * 2.2, soft = 45;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.hypot(d[i] - kr, d[i+1] - kg, d[i+2] - kb);
      const a = dist <= tol ? 0 : dist >= tol + soft ? 1 : (dist - tol) / soft;
      d[i+3] = Math.min(d[i+3], Math.round(a * 255));
    }
    g.putImageData(img, 0, 0);
  }, () => scheduleComposite(s));
  setStatus("Background removed — Reset restores the original", "ok");
};
$("btnDecBake").onclick = () => {
  const L = decalOfSelection(); if (!L || L.type !== "decal") return;
  ensureDecalCanvas(L);
  const s = App.activeSlot;
  const f = `brightness(${$("dB").value}%) contrast(${$("dC").value}%) saturate(${$("dS").value}%)`;
  bakeAction("decal adjust", [L.bmp], () => {
    const tmp = snapCanvas(L.bmp);
    const g = ctx2d(L.bmp);
    g.clearRect(0, 0, L.bmp.width, L.bmp.height);
    g.filter = f; g.drawImage(tmp, 0, 0); g.filter = "none";
  }, () => scheduleComposite(s));
  $("dB").value = $("dC").value = $("dS").value = 100;
  for (const id of ["dB", "dC", "dS"]) $(id + "Val").textContent = "100%";
};
// These three do nothing until Apply, so the readout is the only place their values show.
for (const id of ["dB", "dC", "dS"]) $(id).addEventListener("input", () => { $(id + "Val").textContent = $(id).value + "%"; });
$("btnDecReset").onclick = () => {
  const L = activeLayerObj(); if (!L || L.type !== "decal" || !L.orig) return;
  ensureDecalCanvas(L);
  const s = App.activeSlot;
  bakeAction("reset decal", [L.bmp], () => {
    const g = ctx2d(L.bmp);
    g.clearRect(0, 0, L.bmp.width, L.bmp.height);
    g.drawImage(L.orig, 0, 0);
  }, () => scheduleComposite(s));
};
// The Looks, in ONE table. There were two — this one and `DECAL_SURF`, 140 lines below, which is
// the one the decal editor read — and they had already drifted apart in both halves: only the
// second knew about `none`, so a decal saved with no surface response came back into the sidebar as
// "Custom" with three zero sliders, and the four labels were written twice with four different
// wordings ("Matte stencil" here, "Matte stencil (rough)" there). Both selects are filled from here
// now, so there is nowhere left for them to drift.
//
// A Look is a set of deltas for the bake below and nothing else. Choosing one writes no pixel by
// itself — the editor now says so where it is chosen. ROADMAP 4.8.
const SURF_PRESETS = {
  painted: { sm: 20, mt: 0, em: 0, wr: 0, label: "Painted on (subtle gloss)" },
  vinyl: { sm: 55, mt: 0, em: 6, wr: 0, label: "Vinyl sticker (gloss + raised edge)" },
  stencil: { sm: -45, mt: -10, em: 0, wr: 0, label: "Matte stencil (rough)" },
  none: { sm: 0, mt: 0, em: 0, wr: 0, label: "None (leave the surface alone)" },
};
// `extra` is the sidebar's "Custom", which is not a preset — it is what the select reads once the
// sliders no longer match one. The editor has no such state, so it passes nothing.
function fillSurfPresets(sel, extra){
  sel.textContent = "";
  for (const k of Object.keys(SURF_PRESETS)) {
    const o = document.createElement("option"); o.value = k; o.textContent = SURF_PRESETS[k].label; sel.appendChild(o);
  }
  if (extra) { const o = document.createElement("option"); o.value = "custom"; o.textContent = extra; sel.appendChild(o); }
  return sel;
}
fillSurfPresets($("surfPreset"), "Custom");
// The same four Looks for a decal already on the model (ROADMAP 4.8b). One control, applied on the
// spot rather than behind an Apply button, because a projection's layers are derived: there is
// nothing destructive to confirm, and the change goes through updateProjGroup like every other
// projection parameter, so Ctrl+Z reaches it.
// "Custom" here REPORTS a state rather than offering one: a saved decal can carry deltas that match
// no preset, and a select left on nothing is the 1.5 trap (a value outside the options leaves
// selectedIndex at -1). The sidebar's copy reveals three sliders when it is picked; this one has no
// sliders behind it, so the option is display-only and disabled — a control that cannot do the thing
// it appears to offer is the failure mode §4 names.
fillSurfPresets($("projSurf"), "Custom").lastChild.disabled = true;
$("projSurf").onchange = e => {
  const L = decalOfSelection(); if (!L || !L.proj) return;
  const p = SURF_PRESETS[e.target.value];
  if (!p) return;                                          // "Custom" is a report, not a choice
  const from = projParamsClone(L.proj);
  L.proj.surf = Object.assign(surfDeltas(p), { preset: e.target.value }, DecalStyle.carry(L.proj.surf));
  const res = updateProjGroup(L.proj, "projected decal look", from);
  setStatus(surfHasResponse(p)
    ? "Look applied to the decal on " + res.sheets + " texture" + (res.sheets === 1 ? "" : "s") +
      " — it is rebuilt whenever the decal moves, and the slot's own _n sheets are never written"
    : "Look removed — the surface under this decal is left exactly as it is", "ok");
};
$("surfPreset").onchange = e => {
  const v = e.target.value;
  $("surfCustom").style.display = v === "custom" ? "" : "none";
  if (SURF_PRESETS[v]) applyDecalSurfUI({ surf: Object.assign(surfDeltas(SURF_PRESETS[v]), { preset: v }) });
};
for (const k in SURF_DELTA_CHAN) {
  const id = "sc" + k[0].toUpperCase() + k[1];
  $(id).oninput = e => $(id + "Val").textContent = e.target.value;
}
// ---------- Relief: the shape the emboss follows (ROADMAP 4.19) ----------
// Kept ON the Look — `surf.relief`, `surf.bevel`, `surf.heightInv` — rather than in a control's
// value, so it travels everywhere the Look already does: a projection's shared parameters,
// `projParamsClone` (and therefore Ctrl+Z), and the `.wtproj`. The depth IMAGE cannot live there,
// being a canvas, so it sits beside the bitmap it belongs to: on the decal, or on the projection.
// One binding, matching `Relief` on the editor side and `DecalUI` beside it (§4).
const ReliefUI = {
  LABEL: { edge: "From the edge (sticker rim)", bevel: "Bevelled body (no file needed)", map: "Depth or normal map…" },
  // The depth IMAGE lives with the bitmap it belongs to: on the decal for a floating one, on the
  // shared parameters for a projection, so every sheet of one projected decal reads the same map.
  target(L){ return L && L.proj ? L.proj : L; },
// Filled on first use, NOT at load: `Relief.MODES` is a `const` in editor/decal-surface.js, which
// loads after this file, so a top-level loop over it is a ReferenceError (CLAUDE.md §2 — hoisting is
// per script, and adding a top-level CALL is a load-order decision where adding a handler is not).
// t31_boot caught it, which is the whole reason that gate exists.
  fillModes(){
    const sel = $("projRelief");
    if (!sel || sel.options.length) return;
    for (const k of Relief.MODES) {
      const o = document.createElement("option"); o.value = k; o.textContent = ReliefUI.LABEL[k];
      sel.appendChild(o);
    }
  },
// Two panels show the same state — a floating decal's and a projected one's — so one function puts
// both right, along with the rows that only exist for one mode.
  sync(){
    ReliefUI.fillModes();
    const L = decalOfSelection();
    const surf = L ? surfOf(L) : null;
    const mode = Relief.mode(surf), tgt = ReliefUI.target(L);
    for (const id of ["reliefMode", "projRelief"]) { const e = $(id); if (e) e.value = mode; }
    for (const id of ["reliefGloss", "projGloss"]) { const e = $(id); if (e) e.value = Relief.gloss(surf); }
    $("rowBevel").style.display = mode === "bevel" ? "" : "none";
    $("rowDepth").style.display = mode === "map" ? "" : "none";
    $("reliefBevel").value = Relief.bevel(surf);
    $("reliefBevelVal").textContent = Relief.bevel(surf);
    $("reliefInvert").checked = !!(surf && surf.heightInv);
    $("depthKind").value = Relief.heightFrom(surf);
    $("reliefCavity").value = $("reliefCavityVal").textContent = Relief.cavity(surf);
    const hm = tgt && tgt.heightMap;
    $("depthInfo").textContent = hm ? (tgt.heightName || "loaded") + " · " + hm.width + "×" + hm.height : "none loaded";
    $("btnDepthClear").disabled = !hm;
  },
// A relief change is a change to the decal's surface, so it goes back through whichever apply path
// that decal has: a projection re-renders from its parameters — which is where its undo comes from
// — and a floating decal rebuilds its derived layers where it stands.
  change(mutate, desc){
    const L = decalOfSelection(), s = App.activeSlot;
    if (!L) { setStatus("Select a decal layer first", "err"); return false; }
    if (L.proj) {
      const from = projParamsClone(L.proj);
      L.proj.surf = { ...(L.proj.surf || { sm: 0, mt: 0, em: 6 }) };
      mutate(L.proj.surf, L.proj);
      updateProjGroup(L.proj, desc, from);
    } else {
      L.surf = { ...(L.surf || { sm: 0, mt: 0, em: 6 }) };
      mutate(L.surf, L);
      if (hasDerived(L)) { refreshDecalSurface(s, L); flushComposites(); }
      else if (surfHasResponse(L.surf)) applyDecalSurface(s, L);
      else setStatus("Relief set — it appears once the Look has an Emboss value to apply it at", "ok");
    }
    ReliefUI.sync();
    refreshLayerList();
    return true;
  },
};
for (const id of ["reliefMode", "projRelief"]) $(id).onchange = e => {
  const v = e.target.value, L = decalOfSelection(), tgt = ReliefUI.target(L);
  // "Depth map" with no map loaded is a promise rather than a mode, so it asks for the file and
  // only commits once there is one (§4: a control that cannot do what it offers).
  if (v === "map" && !(tgt && tgt.heightMap)) { ReliefUI.sync(); $("rowDepth").style.display = ""; $("depthPick").click(); return; }
  if (!ReliefUI.change(surf => surf.relief = v, "decal relief")) return;
  setStatus(v === "bevel" ? "Bevelled body — the marking gets a rounded edge " + Relief.bevel(surfOf(L)) + " px wide"
    : v === "map" ? "Relief follows the depth map" : "Relief is the outline again", "ok");
};
// Where the gloss goes (4.19(3)). A change with no Gloss on the Look would do nothing visible, so it
// says so rather than leaving the control looking broken.
for (const id of ["reliefGloss", "projGloss"]) $(id).onchange = e => {
  const v = e.target.value, L = decalOfSelection();
  if (!ReliefUI.change(surf => surf.glossSrc = v, "gloss spread")) return;
  const sm = surfDeltas(surfOf(L)).sm;
  setStatus(!sm ? "Gloss spread set — it shows once the Look has a Gloss value"
    : v === "cover" ? "Gloss is even over the marking again"
    : "Gloss follows the " + v + " parts of the image — " + (v === "light" ? "white" : "black") + " ink gets the full " + (sm > 0 ? "+" : "") + sm, "ok");
};
$("reliefBevel").oninput = e => $("reliefBevelVal").textContent = e.target.value;
$("reliefBevel").onchange = e => ReliefUI.change(surf => surf.bevel = +e.target.value, "bevel width");
$("reliefInvert").onchange = e => ReliefUI.change(surf => surf.heightInv = e.target.checked, "depth map direction");
// What the loaded file is (4.19(5)) — the loader works it out, and this is where a wrong guess is put
// right. Rides on the Look like Invert, so it is one undo step and the .wtproj keeps it.
$("depthKind").onchange = e => {
  const v = e.target.value;
  if (!ReliefUI.change(surf => surf.heightFrom = v, "depth map type")) return;
  setStatus(v === "depth" ? "The map is read as a depth map — light is high"
    : "The map is read as a normal map with green pointing " + (v === "normal-gl" ? "up (OpenGL)" : "down (DirectX)") + " and turned into a height map", "ok");
};
// Cavity (4.19(4)) is shading of the decal's own colour, so unlike the rest of the relief it needs no
// Emboss to show — but a floating decal with no derived response has no rebuild to ride on, so its
// sheet is asked for directly. A projection re-renders through `updateProjGroup` either way.
$("reliefCavity").oninput = e => $("reliefCavityVal").textContent = e.target.value;
$("reliefCavity").onchange = e => {
  const v = +e.target.value;
  if (!ReliefUI.change(surf => surf.cavity = v, "cavity")) return;
  if (!decalOfSelection().proj) { scheduleComposite(App.activeSlot); flushComposites(); }
  setStatus(v ? "Cavity " + v + " — the depth map's hollows darken the decal's colour; the game gets the same pixels"
              : "Cavity off — the decal's colour is its own again", "ok");
};
$("btnDepthLoad").onclick = () => $("depthPick").click();
$("btnDepthClear").onclick = () => ReliefUI.change((surf, tgt) => { tgt.heightMap = null; tgt.heightName = null; surf.relief = "edge"; }, "remove depth map");
$("depthPick").onchange = async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) { ReliefUI.sync(); return; }
  try {
    const img = toCanvas(await createImageBitmap(f));
    // A normal map is recognised by its colours and which way its green points by which reading is a
    // consistent surface (Relief.detect); the height is derived from it wherever it is read.
    const kind = Relief.detect(img);
    let gave = false;
    ReliefUI.change((surf, tgt) => {
      tgt.heightMap = img; tgt.heightName = f.name; surf.relief = "map"; surf.heightFrom = kind.from;
      // A depth map loaded onto a Look with no Emboss at all would change nothing and look broken.
      // Give it one, and say so — the alternative is a file picker that appears to do nothing.
      if (!surfDeltas(surf).em) { surf.em = 8; gave = true; }
    }, "decal depth map");
    const emb = gave ? ", and Emboss set to 8 so it has something to apply at" : "";
    const nv = kind.down + kind.up;
    setStatus(kind.from === "depth"
      ? "Depth map “" + f.name + "” (" + img.width + "×" + img.height + ") — light is read as high" + emb + ". If the relief comes out inside out, tick Invert."
      : "Normal map “" + f.name + "” (" + img.width + "×" + img.height + ") turned into a height map" + emb + ". " + (kind.sure
        ? "Its green channel points " + (kind.from === "normal-gl" ? "up (OpenGL)" : "down (DirectX)") + " — " +
          Math.round(100 * Math.max(kind.down, kind.up) / nv) + " % of the " + nv + " places that can tell agree."
        : "The image does not say which way its green channel points, so it is read as DirectX, the game's own — if the relief looks wrong along one direction, change File is."), "ok");
  } catch (err) {
    reportFailure("Loading the depth map “" + f.name + "”", err, "depthmap");
    ReliefUI.sync();
  }
};
$("btnSurfApply").onclick = () => {
  const L = activeLayerObj(), s = App.activeSlot;
  if (!L || L.type !== "decal") { setStatus("Select a decal layer first — a surface response belongs to a decal", "err"); return; }
  const read = {};
  for (const k in SURF_DELTA_CHAN) read[k] = +$("sc" + k[0].toUpperCase() + k[1]).value;
  L.surf = Object.assign(read, { preset: $("surfPreset").value }, DecalStyle.carry(L.surf));
  applyDecalSurface(s, L);
};
$("btnSurfBake").onclick = () => {
  const L = decalOfSelection(); if (!L || L.type !== "decal") { setStatus("Select a decal layer first", "err"); return; }
  const s = App.activeSlot;
  if (!s.smooth) { setStatus("This slot has no _n texture loaded", "err"); return; }
  const smD = +$("scSm").value, mtD = +$("scMt").value, emD = +$("scEm").value;
  // All three zero is the "None" look, and the loop below would then walk the whole footprint,
  // change nothing, push an undo step and report "baked" — a no-op wearing a success message,
  // which is the exact failure mode §4 names and the reason 4.8 was reported at all.
  if (!smD && !mtD && !emD) {
    // Wear is deliberately not in this path. The bake writes the three sheets the _n packs, and the
    // paint mask is the albedo's alpha — a different texture with a different undo shape. It is
    // reachable through "Apply to the decal" (named "Apply as layers" until 2026-09-26, which
    // promised layers 4.28(f) had stopped making), the non-destructive path everything else has
    // moved to, so say that rather than let a Paint-only look read as a look that does nothing.
    setStatus(surfDeltas({ wr: +$("scWr").value }).wr
      ? "The bake writes the _n map only, and Paint Δ is the albedo's alpha — use “Apply to the decal” for it"
      : "This look changes nothing — Smooth Δ, Metal Δ and Emboss are all 0, so there is nothing to bake into the _n map", "err");
    return;
  }
  const nw = s.normal.width, nh = s.normal.height;
  const cw = s.composite.width, chh = s.composite.height;
  const fx = nw / cw, fy = nh / chh;
  const foot = mkCanvas(nw, nh);
  const fg = ctx2d(foot);
  fg.translate(L.x * nw, L.y * nh); fg.rotate(L.rot * Math.PI / 180); fg.scale(L.scale * fx * (L.flip ? -1 : 1), L.scale * fy);
  fg.drawImage(L.bmp, -L.bmp.width / 2, -L.bmp.height / 2);
  const rad = Math.hypot(L.bmp.width, L.bmp.height) / 2 * L.scale * Math.max(fx, fy) + 4;
  const bx0 = Math.max(0, Math.floor(L.x * nw - rad)), by0 = Math.max(0, Math.floor(L.y * nh - rad));
  const bx1 = Math.min(nw - 1, Math.ceil(L.x * nw + rad)), by1 = Math.min(nh - 1, Math.ceil(L.y * nh + rad));
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  if (bw <= 2 || bh <= 2) return;
  bakeRegionAction("surface effect under decal", [s.smooth, s.metal, s.normal], { x: bx0, y: by0, w: bw, h: bh }, () => {
    const fa = ctx2d(foot).getImageData(bx0, by0, bw, bh).data;
    const smG = ctx2d(s.smooth), mtG = ctx2d(s.metal), nrG = ctx2d(s.normal);
    const smI = smG.getImageData(bx0, by0, bw, bh), mtI = mtG.getImageData(bx0, by0, bw, bh), nrI = nrG.getImageData(bx0, by0, bw, bh);
    const cl = v => Math.max(0, Math.min(255, v));
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4;
      const a = fa[i + 3] / 255;
      if (a > 0.003) {
        if (smD) { const v = cl(smI.data[i] + smD * a); smI.data[i] = smI.data[i+1] = smI.data[i+2] = v; }
        if (mtD) { const v = cl(mtI.data[i] + mtD * a); mtI.data[i] = mtI.data[i+1] = mtI.data[i+2] = v; }
      }
      if (emD && x > 0 && x < bw - 1 && y > 0 && y < bh - 1) {
        const gx = (fa[i + 7] - fa[i - 1]) / 255;          // d(alpha)/dx via right-left alpha
        const gy = (fa[i + bw * 4 + 3] - fa[i - bw * 4 + 3]) / 255;
        if (gx || gy) {
          nrI.data[i]   = cl(nrI.data[i]   - gx * emD * 14);
          nrI.data[i+1] = cl(nrI.data[i+1] - gy * emD * 14);
        }
      }
    }
    smG.putImageData(smI, bx0, by0); mtG.putImageData(mtI, bx0, by0); nrG.putImageData(nrI, bx0, by0);
  }, () => { s.nEdited = true;
    const br = { x: bx0, y: by0, w: bw, h: bh };
    refreshSurfaceTextures(s, br);
    draw2D(); });
  setStatus("Surface effect baked into the _n map", "ok");
};

// ---------- Decal editor & library ----------
// An image dropped on a vehicle is never ready as-is: it has a white box around it, it is the
// wrong brightness, and War Thunder wants a surface response for it. The editor does all of
// that in one window, shows the result before it touches the skin, and can keep the finished
// decal — its cut-out image and its chosen surface look — for the next project.
function modalDialog(title, opts){
  const ov = document.createElement("div");
  ov.className = "modal";
  const box = document.createElement("div");
  box.className = "box";
  if (opts && opts.width) box.style.width = opts.width;
  const head = document.createElement("div");
  head.className = "head";
  const h = document.createElement("h2"); h.textContent = title;
  const x = document.createElement("span"); x.className = "x"; x.textContent = "✕";
  head.append(h, x);
  const body = document.createElement("div"); body.className = "body";
  const foot = document.createElement("div"); foot.className = "foot";
  box.append(head, body, foot);
  ov.appendChild(box);
  $("modalHost").appendChild(ov);
  // `opts.onClose` fires however the dialog goes away — the ✕, Escape, a click on the backdrop, or
  // a button calling close() — which is what lets a caller hold "my dialog is up" as state without
  // having to hook four separate exits.
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey, true); if (opts && opts.onClose) opts.onClose(); };
  // Escape closes the dialog on TOP, not the one that happened to register its listener first.
  // These are capture-phase listeners, so the oldest dialog ran first and stopped the key — with
  // the decal editor now opening over the library, that closed the library out from under it.
  const onKey = e => {
    if (e.key !== "Escape") return;
    const open = $("modalHost").querySelectorAll(".modal");
    if (open.length && open[open.length - 1] !== ov) return;
    e.stopPropagation(); close();
  };
  document.addEventListener("keydown", onKey, true);
  x.onclick = close;
  ov.addEventListener("pointerdown", e => { if (e.target === ov) close(); });
  return { ov, box, head, body, foot, close };
}
// `at`, when given, receives the rectangle that was KEPT ({x, y, w, h} in `c`'s pixels) — only when
// something was actually cut. A crop is not only a smaller image: whatever else is laid over the
// image (a projected decal's frame, a relief's depth map) has to follow the same cut, and an
// uneven margin moves the image's centre by half the difference (ROADMAP 4.2b's review, 2026-09-26).
function trimTransparent(c, alphaMin, at){
  const g = ctx2d(c), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > (alphaMin || 6)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return c;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w === c.width && h === c.height) return c;
  if (at) Object.assign(at, { x: x0, y: y0, w, h });
  const out = mkCanvas(w, h);
  out.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return out;
}
// Key colour → alpha, with a soft ramp so the edge doesn't turn into a jagged cut-out.
function keyOutBackground(src, key, tol, soft){
  const out = mkCanvas(src.width, src.height);
  const g = ctx2d(out);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - key[0], d[i+1] - key[1], d[i+2] - key[2]);
    const a = dist <= tol ? 0 : dist >= tol + soft ? 1 : (dist - tol) / soft;
    d[i+3] = Math.min(d[i+3], Math.round(a * 255));
  }
  g.putImageData(img, 0, 0);
  return out;
}
// The decal's own surface sub-texture: a tangent-space normal map derived from the alpha edge
// (so a sticker has a raised rim) plus the smoothness / metal deltas the bake uses.
function decalNormalCanvas(src, emboss){
  const w = src.width, h = src.height;
  const out = mkCanvas(w, h), g = ctx2d(out);
  const a = ctx2d(src).getImageData(0, 0, w, h).data;
  const img = new ImageData(w, h);
  const at = (x, y) => a[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4 + 3] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * emboss * .35;
    const gy = (at(x, y + 1) - at(x, y - 1)) * emboss * .35;
    const i = (y * w + x) * 4;
    img.data[i] = Math.max(0, Math.min(255, 128 - gx * 127));
    img.data[i+1] = Math.max(0, Math.min(255, 128 - gy * 127));
    img.data[i+2] = 255;
    img.data[i+3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
// (`DECAL_SURF` used to live here — a second copy of SURF_PRESETS. See that table.)
