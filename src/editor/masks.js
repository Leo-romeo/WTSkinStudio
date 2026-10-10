// ---------- Layer masks ----------
// A mask is a sheet the size of the slot whose ALPHA decides how much of the layer shows: opaque
// reveals, transparent hides, and everything between is a partial reveal. The compositor applies
// it with one `destination-in`, so painting on it, filling it, inverting it or loading an image
// into it are all the same operation on one canvas — which is what makes the whole set below
// possible, and none of it destructive: delete the mask and the layer is whole again.
// This is the Substance model, minus the effect stack: hand-painted mask, a fill from the part
// selection, and an image as a mask, all editable afterwards with the mask brush.
function blankMask(slot, opaque){
  const m = mkCanvas(slot.composite.width, slot.composite.height);
  if (opaque) { const g = ctx2d(m); g.fillStyle = "#fff"; g.fillRect(0, 0, m.width, m.height); }
  return m;
}
// Luminance → alpha. An imported image is read the way every painter reads a mask: white shows,
// black hides. Its own alpha is folded in, so a PNG with a transparent background hides there too.
function imageToMask(img, w, h, invert){
  const c = mkCanvas(w, h), g = ctx2d(c);
  g.clearRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let lum = (p[i] * 0.2126 + p[i+1] * 0.7152 + p[i+2] * 0.0722) * (p[i+3] / 255);
    if (invert) lum = 255 - lum;
    p[i] = p[i+1] = p[i+2] = 255;
    p[i+3] = lum;
  }
  g.putImageData(d, 0, 0);
  return c;
}
function setLayerMask(slot, L, mask, desc){
  const old = L.mask || null;
  const apply = v => { L.mask = v; L._thumb = null; L._maskThumb = L._maskThumbProps = null; scheduleComposite(slot); scheduleChannels(slot); refreshLayerList(); };
  const bytes = ((mask ? mask.width * mask.height : 0) + (old ? old.width * old.height : 0)) * 4;
  pushAction(desc, () => apply(old), () => apply(mask), bytes);
  apply(mask);
}
// ---- a mask that is another layer (ROADMAP 4.36) ----
// The reference model — see LayerNode.maskSource for what is read and why nothing has to be
// invalidated. One undo step sets or clears the reference; a painted mask already on the layer is
// put aside (kept in the step, so undo brings it back) because a node stencils by one or the other.
function setLayerMaskRef(slot, L, uid, desc){
  const oldRef = L.maskRef || null, oldMask = L.mask || null;
  const apply = (ref, mask) => {
    L.maskRef = ref; L.mask = mask; L._thumb = null; L._maskThumb = L._maskThumbProps = null;
    scheduleComposite(slot); scheduleChannels(slot); refreshLayerList();
  };
  pushAction(desc, () => apply(oldRef, oldMask), () => apply(uid, uid ? null : oldMask), oldMask ? oldMask.width * oldMask.height * 4 : 0);
  apply(uid, uid ? null : oldMask);
}
// Freeze the reference into pixels of its own: what the source lends right now becomes a painted
// mask, and the link is dropped — the way to keep a shape and then edit it, or to delete the source.
function maskRefToPainted(slot, L){
  const src = LayerNode.maskSource(slot, L);
  if (!src) { setStatus("The layer this mask points at is gone, or has no pixels to lend", "err"); return false; }
  const m = blankMask(slot, false), g = ctx2d(m);
  g.drawImage(src, 0, 0, m.width, m.height);
  const oldRef = L.maskRef;
  const apply = (ref, mask) => {
    L.maskRef = ref; L.mask = mask; L._thumb = null; L._maskThumb = L._maskThumbProps = null;
    scheduleComposite(slot); scheduleChannels(slot); refreshLayerList();
  };
  pushAction("mask → painted copy", () => apply(oldRef, null), () => apply(null, m), m.width * m.height * 4);
  apply(null, m);
  setStatus("The mask is a painted copy now — it no longer follows “" + ((LayerNode.byUid(slot.layers, oldRef) || {}).name || "the source layer") + "”", "ok");
  return true;
}
// Which layer lends its shape: every leaf of the slot with pixels of its own, other than this one
// and anything already masked by it. A dialog of names, because a mask picked by name is a mask
// the user can find again in the stack.
async function pickMaskLayer(slot, L){
  const srcs = LayerNode.maskSources(slot, L);
  if (!srcs.length) { setStatus("No other layer on this texture has painted pixels to lend as a mask — paint a shape on a layer first", "err"); return false; }
  const v = await choiceDialog("Mask “" + L.name + "” by which layer's pixels?\n\nWhere that layer has paint, this one shows; where it has none, this one is hidden. Live — paint on it and this layer follows.",
    srcs.map(l => ({ label: l.name, value: l.uid })).concat([{ label: "Cancel", value: null }]));
  if (!v) return false;
  const src = LayerNode.byUid(slot.layers, v);
  setLayerMaskRef(slot, L, v, "mask by layer “" + (src ? src.name : "?") + "”");
  setStatus("“" + L.name + "” is masked by “" + (src ? src.name : "?") + "” — paint on that layer to change where this one shows", "ok");
  return true;
}
// `kind` is "white" or "black". It used to take a third, "selection", which built a mask out of the
// PART selection alone — 4.28(g) replaced that with `Marquee.toMask`, which sees the rectangle and
// the UV islands too and composes all three the way a stroke is confined by them.
function addMaskTo(slot, L, kind){
  let m = null, what = "";
  if (kind === "black") { m = blankMask(slot, false); what = "black mask (layer hidden)"; }
  else { m = blankMask(slot, true); what = "white mask (layer shown)"; }
  setLayerMask(slot, L, m, "add " + what);
  setStatus("Added a " + what + " to “" + L.name + "” — the Mask brush paints on it", "ok");
  return true;
}
// Any in-place edit of the mask pixels: fill, invert, soften.
function editMask(slot, L, desc, fn){
  if (!L.mask) return;
  bakeAction(desc, [L.mask], () => fn(L.mask), () => {
    L._thumb = null; L._maskThumb = L._maskThumbProps = null;
    scheduleComposite(slot); scheduleChannels(slot); refreshLayerList(); draw2D();
  });
}
function maskFill(slot, L, opaque){
  editMask(slot, L, opaque ? "reveal all" : "hide all", m => {
    const g = ctx2d(m);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.clearRect(0, 0, m.width, m.height);
    if (opaque) { g.fillStyle = "#fff"; g.fillRect(0, 0, m.width, m.height); }
  });
}
function maskInvert(slot, L){
  editMask(slot, L, "invert mask", m => {
    const g = ctx2d(m);
    const d = g.getImageData(0, 0, m.width, m.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { p[i] = p[i+1] = p[i+2] = 255; p[i+3] = 255 - p[i+3]; }
    g.putImageData(d, 0, 0);
  });
}
function maskBlur(slot, L, px){
  editMask(slot, L, "soften mask", m => {
    const tmp = snapCanvas(m);
    const g = ctx2d(m);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.clearRect(0, 0, m.width, m.height);
    g.filter = "blur(" + Math.max(1, px | 0) + "px)";
    g.drawImage(tmp, 0, 0);
    g.filter = "none";
  });
}
// kept as the name the layer context menu already uses: add a plain white mask, or delete one
function toggleLayerMask(s, L){
  if (L.mask) setLayerMask(s, L, null, "delete mask");
  else addMaskTo(s, L, "white");
}
// The mask brush is how a mask is drawn by hand, so "edit this mask" is exactly "pick that tool".
function editMaskWithBrush(){
  setBrushMode("mask");
  if (!App.paint3d) setPaint3d(true);
  draw2D();
}
let maskImagePick = null;
function pickMaskImage(slot, L, invert){
  if (!maskImagePick) {
    maskImagePick = document.createElement("input");
    maskImagePick.type = "file";
    maskImagePick.accept = "image/*,.dds";
    maskImagePick.style.display = "none";
    document.body.appendChild(maskImagePick);
  }
  maskImagePick.onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      let img;
      if (/\.dds$/i.test(f.name)) {
        const dec = await parseDDSAsync(await f.arrayBuffer());
        img = mkCanvas(dec.width, dec.height);
        ctx2d(img).putImageData(new ImageData(dec.mips[0].rgba.slice(), dec.width, dec.height), 0, 0);
      } else img = await createImageBitmap(f);
      const m = imageToMask(img, slot.composite.width, slot.composite.height, !!invert);
      setLayerMask(slot, L, m, "mask from image");
      setStatus("“" + f.name + "” is now the mask on “" + L.name + "” — white shows, black hides" +
        (invert ? ", inverted" : "") + ". Soften it, or paint on it with the Mask brush.", "ok");
    } catch (err) { setStatus("Could not read that image: " + err.message, "err"); }
  };
  maskImagePick.click();
}
// ---- a texture from the model as the mask ----
// The best mask for a vehicle is usually already on it: the albedo separates panels, hatches,
// stowage and markings, the metalness map is exactly "the bare-metal parts", the smoothness map is
// "the worn parts". So the model's own sheets are offered as mask sources alongside an image file,
// with **invert** up front — half of them are the wrong way round (an albedo used as a mask reveals
// the light areas when it is usually the dark ones you want), and inverting after the fact means
// looking at the wrong result first.
function maskSourceList(target){
  const out = [];
  // The model's texture as it was loaded, not the composite — a mask built from the sheet you are
  // currently painting would include the very layer being masked, which is circular and moves
  // under you as you work.
  const add = (slot, ch, label) => {
    const src = chanBase(slot, ch);
    if (!src) return;
    out.push({ slot, ch, src, label: slot.id + " · " + label, same: slot === target });
  };
  const slots = [...App.slots.values()].sort((a, b) => (b === target) - (a === target));
  for (const s of slots) {
    if (!s.composite) continue;
    add(s, "color", "colour");
    add(s, "smooth", "smoothness");
    add(s, "metal", "metalness");
  }
  return out;
}
function openMaskSourceDialog(slot, L){
  const m = modalDialog("Use a texture as a mask", { width: "min(760px,94vw)" });
  m.body.style.flexDirection = "column";
  const top = document.createElement("div");
  top.className = "row";
  top.style.marginBottom = "4px";
  const inv = document.createElement("input");
  inv.type = "checkbox";
  const invL = document.createElement("label");
  invL.style.cssText = "font-size:12px";
  invL.title = "White shows the layer and black hides it. Invert when the part you want to keep is the dark one.";
  invL.append(inv, document.createTextNode(" Invert (dark shows instead of light)"));
  top.appendChild(invL);
  const note = document.createElement("span");
  note.className = "hint";
  note.style.cssText = "margin:0 0 0 auto";
  note.textContent = "Brightness becomes the mask · stretched to " + slot.composite.width + "×" + slot.composite.height;
  top.appendChild(note);
  m.body.appendChild(top);

  const list = maskSourceList(slot);
  const grid = document.createElement("div");
  grid.className = "declib";
  grid.style.maxHeight = "58vh";
  if (!list.length) {
    const h = document.createElement("div");
    h.className = "hint";
    h.textContent = "This project has no decoded textures yet — load a vehicle, or use an image file.";
    m.body.appendChild(h);
  }
  for (const it of list) {
    const card = document.createElement("div");
    card.className = "card";
    const c = mkCanvas(96, 96);
    const g = ctx2d(c);
    g.fillStyle = "#15171c"; g.fillRect(0, 0, 96, 96);
    // A source that will not draw (a detached bitmap, a texture whose slot went away) used to come
    // back as the flat fill above and read as "this mask source is empty" — the opposite of true.
    try { g.drawImage(it.src, 0, 0, 96, 96); } catch (e) { brokenThumb(c, e, "Mask source “" + it.label + "”"); }
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = it.label + (it.same ? "" : " ⚠");
    // The same two sentences the paste dialog uses (ROADMAP 4.25 asked for the wording to be shared
    // rather than written twice differently): "lines up" is a fact about the SLOT either way.
    card.title = it.same ? PasteTex.SAME_TIP : PasteTex.OTHER_TIP;
    card.append(c, nm);
    card.onclick = () => {
      const mask = imageToMask(it.src, slot.composite.width, slot.composite.height, inv.checked);
      setLayerMask(slot, L, mask, "mask from " + it.label);
      m.close();
      setStatus("“" + it.label + "” is now the mask on “" + L.name + "”" + (inv.checked ? ", inverted" : "") +
        " — soften it, or paint on it with the Mask brush", "ok");
    };
    grid.appendChild(card);
  }
  m.body.appendChild(grid);
  const bFile = document.createElement("button");
  bFile.textContent = "From an image file…";
  bFile.onclick = () => { const i = inv.checked; m.close(); pickMaskImage(slot, L, i); };
  const grow = document.createElement("span");
  grow.className = "grow";
  grow.textContent = "White shows the layer, black hides it.";
  const bCancel = document.createElement("button");
  bCancel.textContent = "Cancel";
  bCancel.onclick = m.close;
  m.foot.append(bFile, grow, bCancel);
}
// 26 px view of the mask itself, dark where the layer is hidden. The layer row and the mask
// section show it at the same time, and appendChild MOVES a node rather than copying it — so each
// place gets its own cached canvas instead of stealing the other's.
const MASK_THUMB_KEYS = ["_maskThumb", "_maskThumbProps"];
function layerMaskThumb(L, key, slot){
  key = key || "_maskThumb";
  const c = L[key] && L[key].width === 26 ? L[key] : (L[key] = mkCanvas(26, 26));
  const g = c.getContext("2d");
  c.title = "";                              // these canvases are cached and reused; see layerThumb
  g.clearRect(0, 0, 26, 26);
  g.fillStyle = "#1b1e24"; g.fillRect(0, 0, 26, 26);
  g.fillStyle = "#e8ecf2";
  // painted, or the pixels of the layer it points at (4.36) — a reference is never cached here,
  // because the source moves under it
  const m = LayerNode.maskCanvas(slot || App.activeSlot, L);
  try { if (m) { g.save(); g.beginPath(); g.rect(0, 0, 26, 26); g.clip(); g.drawImage(m, 0, 0, 26, 26); g.restore(); } }
  catch (e) { return brokenThumb(c, e, "The mask thumbnail for “" + (L.name || "this layer") + "”"); }
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1; g.strokeRect(.5, .5, 25, 25);
  return c;
}
