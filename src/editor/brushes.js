// ---------- Painting ----------
function brushStamp(){
  const b = App.brush;
  // Keyed on the three axes rather than on the mode name: two different tools on the same channel
  // want two different stamps, and a mode string could not say which. And on the TIP (ROADMAP
  // 4.50 (10)) — its id, and for a loaded image its bytes' sum, so a tip replaced under the same id
  // is redrawn. Never on anything per dab: size, angle and jitter are applied when a dab is drawn.
  const T = Tips.get(b.tip);
  const key = brushStamp.key(b, T);
  if (brushStamp._key === key) return brushStamp._c;
  brushStamp._key = key; brushStamp._c = brushStamp.make(T, Math.max(2, b.size), b.hardness, brushStamp.ink(b));
  return brushStamp._c;
}
// What a dab lays, as a CSS colour — the one statement of it, read by the stamp and by the projected
// 3-D brush, whose dabs take their colour from here and only their coverage from the stamp. Every
// channel but colour is one value.
brushStamp.ink = b => {
  if (b.target === "mask") return "#ffffff";                     // a mask is coverage, not a colour
  if (b.tool === "clone" || b.tool === "retouch") return "#ffffff";   // only its alpha is used: the pixels come from the sheet
  if (b.tool === "flatten") return "rgb(128,128,128)";           // the normal map's "no bump" value
  if (b.chan === "color") return b.color;
  return `rgb(${b.value},${b.value},${b.value})`;
};
// A stamp `d` texels across: every tip but Round is coverage in this ink (editor/tips.js), and Round
// is the gradient it always was. Apart from `brushStamp` so the panel's sample stroke (ROADMAP 3.41
// (3)) makes its small stamp with the code a stroke's comes from, and does not throw away the
// stroke's own cached one by asking for a size of its own.
brushStamp.make = (T, d, hard, col) => {
  if (T.id !== "round") return Tips.stamp(T, d, hard, col);
  const c = mkCanvas(d, d), g = ctx2d(c);
  const grad = g.createRadialGradient(d/2, d/2, d/2 * hard * .95, d/2, d/2, d/2);
  grad.addColorStop(0, col);
  grad.addColorStop(1, col.startsWith("#") ? col + "00" : col.replace("rgb", "rgba").replace(")", ",0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);
  return c;
};
brushStamp.key = (b, T) => [b.tool, b.chan, b.target, b.color, b.size, b.hardness, b.value, T.key].join("|");
// The stamp made BEFORE the first dab needs it (4.50 (10)'s review, 2026-09-26). A Chip at Size 400
// is 5–8 ms of arithmetic once V8 has compiled its loop and ~24 the first time in a session (Node and
// the page), and made inside the first `stampAt` after a change of tip, size or hardness it was that
// stroke's first frame — over §3.3's bar (the review measured 20–26 ms). The brush outline is drawn over either view
// before any stroke starts, so that is where this is asked for (`Draw2D.ring`, `updateBrushRing`):
// once the brush has been left alone for WARM_MS, on a timer, and never inside a stroke. The timer is
// set again only when the brush changes, so a pointer moving over the view does not keep putting it off.
brushStamp.WARM_MS = 120;
brushStamp.warm = () => {
  const b = App.brush;
  if (stroke || !b || b.tool === "height") return;          // Panel line lays a bump, not a stamp
  const key = brushStamp.key(b, Tips.get(b.tip));
  if (key === brushStamp._key || key === brushStamp._wKey) return;
  clearTimeout(brushStamp._wT);
  brushStamp._wKey = key;
  brushStamp._wT = setTimeout(() => { brushStamp._wKey = null; if (!stroke) brushStamp(); }, brushStamp.WARM_MS);
};
let stroke = null;
// ---------- Wear / camouflage-condition mask ----------
// The albedo's alpha channel is what War Thunder uses to decide where a vehicle picks up dirt
// and scratches as the condition slider moves. It is invisible in a normal RGB view, so it is
// held here as an editable greyscale layer and written back into alpha on export.
function ensureWearCanvas(slot){
  if (!slot.baseC) return null;
  const w = slot.baseC.width, h = slot.baseC.height;
  if (slot.wearC && slot.wearC.width === w && slot.wearC.height === h) return slot.wearC;
  const img = new ImageData(w, h);
  // covBase was taken from the decoded texture (see fillSlotAlbedo). Only a hand-imported or
  // placeholder sheet has none, and "no mask" means fully covering.
  const cov = slot.covBase && slot.covBase.length === w * h ? slot.covBase : null;
  for (let i = 0, n = w * h; i < n; i++) {
    const a = cov ? cov[i] : 255;
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = a;
    img.data[i*4+3] = 255;
  }
  slot.wearC = mkCanvas(w, h);
  ctx2d(slot.wearC).putImageData(img, 0, 0);
  return slot.wearC;
}
// Nothing paints onto an imported game texture. Every brush writes to a layer of its own
// channel; when the stack has none, `need` names the channel and beginStroke creates it inside
// the stroke's undo batch, so one Ctrl+Z removes the layer and the stroke together. Before this,
// every tool except colour and the eraser fell through to the decoded maps themselves
// (slot.smooth / .metal / .normal / .wearC) whenever no matching layer was selected — a stroke on
// an empty layer stack edited the game's own texture destructively, could not be hidden, reordered
// or masked, and left "Compare" with nothing to compare against.
//
// **One walk since ROADMAP 4.28(d).** It used to be three branches keyed on the mode enum — colour
// and the eraser, the mask brush, everything else — and the three asked the same four questions in
// three different orders, with three different wordings for "that is the wrong layer" and one of
// them missing the channel check entirely (the colour brush would happily paint into a Metalness
// layer and then re-composite the albedo). Addressed by the three axes it is: refuse the pair, find
// the channel's base, then find or make the layer that holds that channel.
function paintTarget(){
  const s = App.activeSlot, b = App.brush;
  if (!s) return null;
  // The pair itself, first and in words. Everything below can then assume the tool is one that
  // writes this channel, instead of each branch re-deciding it in its own wording.
  const r = Tool.resolve(b.tool, b.chan, b.target);
  if (r.err) return { err: r.err };
  if (r.mode === "none") return { err: "No tool is selected — pick one in the Brush panel" };
  const T = Tool.TOOLS[b.tool];
  // ---- target: the layer's mask ----
  // A mask belongs to its layer, so editing it changes whatever channel that layer writes. Without
  // this the stroke only ever asked for an albedo re-composite, and masking a Metalness or Wear
  // layer changed nothing on screen — the composite reads a layer on its own channel by design.
  if (b.target === "mask") {
    const L = activeLayerObj();
    if (!L || !["paint", "decal", "fill"].includes(L.type)) return { err: "Select a paint / decal / fill layer to mask" };
    if (L.maskRef) { setStatus("This layer is masked by another layer — paint on that one, or make the mask a painted copy first (layer menu)", "err"); return null; }
    if (!L.mask) addMaskTo(s, L, "white");
    const mch = layerChan(L);
    return { canvas: L.mask, mask: true, chan: mch === "color" ? null : mch };
  }
  // ---- target: the layer's own pixels ----
  // The channel needs a base for the layer to composite over. Colour is the exception and always
  // has one: a slot has a composite from the moment it exists, placeholder sheet included.
  const ch = b.chan;
  if (s.camoTile && ch === "wear") return { err: "A camouflage tile has no wear mask — it carries the alpha of the camouflage it replaces" };
  const base = chanBase(s, ch);
  if (!base && ch !== "color")
    return { err: ch === "wear" ? "This slot has no albedo yet"
      : "This slot has no _n surface map loaded — the " + Tool.chanWord(ch) +
        " channel has no base to paint over (Textures ▸ Replace…, or Find in game files)" };
  // A copy needs somewhere to copy from. Refused here, with the tool's own sentence, so the first
  // stroke after picking the Clone up says what Alt+click is for instead of painting nothing.
  if (T.needsSource && !Clone.source(s)) return { err: T.sourceErr };
  const L = activeLayerObj();
  // ---- (e): the brush's channel is an ADDRESS into the selected layer ----
  // It used to be a claim about the layer as a whole — `layerChan(L) !== ch` refused the stroke,
  // because a layer wrote one channel and that was its identity. A layer is a bundle of per-channel
  // content now, so the question is what it holds ON this channel: a layer carrying colour and
  // smoothness takes a colour stroke in one slot and a smoothness stroke in the other, and a layer
  // carrying neither gets the slot made for it. That is 4.28's "the tool in your hand decides which
  // channel a stroke lands in and makes the slot if it is missing", and it is why the availability
  // rule in `updateBrushAvailability` stopped disabling a tool over a channel mismatch.
  // `layerChan` still answers — about the PRIMARY slot, which is the right question for the
  // thumbnail and the blend list and the wrong one here.
  const grp = L && isGroup(L);
  const c = L && !grp ? LayerNode.contentOn(L, ch) : null;
  // A tool that rubs pixels out needs pixels to rub out, so it refuses rather than making an empty
  // slot that could only produce a no-op stroke. Every other tool creates what it needs.
  if (T.needsPixels && (!c || c.kind !== "paint")) return { err: T.emptyErr };
  if (!L) return { need: ch };
  if (grp) return { err: "“" + L.name + "” is a group — select a layer inside it, or add one" };
  if (!c) return { needSlot: ch, on: L };
  if (c.kind !== "paint")
    return { err: "“" + L.name + "” holds " + LayerNode.wordFor(c) + " on the " + Tool.chanWord(ch) +
      " channel, and a brush stroke needs pixels — add a paint layer, or convert that content with " +
      "the channel strip's ▾ menu" };
  // A projected layer's pixels are regenerated from its source image every time it moves or
  // resizes, so brush work on it would silently disappear. Duplicating it frees the pixels.
  if (c.proj) return { err: "This is a projected decal — its pixels are rebuilt when it moves. Duplicate it (⧉) to paint on the copy." };
  // A path layer's are rebuilt from its path (4.52 (3)), for the same reason.
  if (c.shape) return { err: "“" + L.name + "” is a path layer — its pixels are redrawn from its path. Edit it with the shape tool, or duplicate it (⧉) to paint on the copy." };
  // Same rule, one level down and new with 4.28(f): a decal's surface response is content in the
  // decal's own node now, so the brush can reach it in a way it never could when it was a sibling
  // layer behind the 4.18 rule. It is rebuilt from the Look every time the decal moves, so a stroke
  // here is work that disappears without a message — which is the failure §4 exists to prevent.
  if (c.derived) return { err: "“" + L.name + "”'s " + Tool.chanWord(ch) + " is derived from its Look and is rebuilt every time " +
    "the decal moves, so a stroke here would not survive. Duplicate the layer (⧉) to paint on a copy that stays put." };
  // Only off the albedo. A colour layer is deliberately allowed to be a different size from the
  // sheet it composites onto — rectToSlot exists for exactly that — and resizing one here would
  // resample the user's pixels for no reason.
  if (ch !== "color" && base && c.canvas && (c.canvas.width !== base.width || c.canvas.height !== base.height)) {
    const n = mkCanvas(base.width, base.height);
    ctx2d(n).drawImage(c.canvas, 0, 0, base.width, base.height);
    c.canvas = n;
  }
  return { canvas: c.canvas, chan: ch === "color" ? null : ch, surface: false, comp: "source-over",
           erase: b.tool === "eraser", height: b.tool === "height" };
}
// The layer a stroke needs but the stack does not have yet. Created with the current part
// selection as its scope, exactly like the New layer buttons, and announced so it is never a
// surprise that a layer appeared.
function createPaintLayerFor(ch){
  const s = App.activeSlot;
  if (!s || !s.composite) return null;
  // Captured before anything below can refresh the sidebar: adding a layer re-runs
  // updateBrushAvailability, which moves off any tool it thinks cannot write here — and it must
  // not do that to the tool that asked for this layer in the first place.
  const mode = App.brush.mode;
  const base = chanBase(s, ch) || s.composite;
  // Through LayerNode.of, like every other construction site — a bare record has no channel slot,
  // and since 4.28(c) the composite is addressed through the slots, so an unwrapped layer takes the
  // stroke and then draws nothing. This one was the site (b) missed, and `t47` is what found it.
  const L = LayerNode.of({ type: "paint", chan: ch === "color" ? undefined : ch,
    name: LayerNode.autoName(s.layers),
    canvas: mkCanvas(base.width, base.height), visible: true, opacity: 1, blend: "normal",
    scope: Scope.ofSelection() });
  addLayerTo(s, L, { empty: true });                          // nothing on it yet — see addLayerTo
  App.activeLayer = L;
  refreshLayerList();
  if (App.brush.mode !== mode) applyBrushMode(mode, true);
  return L;
}
// (e): the same thing one level down — the selected layer carries nothing on the channel the brush
// is in, so the SLOT is made rather than a whole new layer. It pushes its own undo entry in the
// shape `beginStroke` expects (one action it can pop and re-push with the stroke), because the
// alternative is a history where undoing a stroke leaves an empty channel behind it.
function createPaintSlotIn(s, L, ch){
  if (!s || !s.composite || !L || isGroup(L) || LayerNode.carries(L, ch)) return null;
  const base = chanBase(s, ch) || s.composite;
  const c = LayerNode.content("paint", { canvas: mkCanvas(base.width, base.height) });
  const add = () => { LayerNode.addContent(L, ch, c); L._thumb = null; refreshLayerList(); };
  pushAction("add " + (CHAN_LABEL[ch] || ch) + " to layer",
    () => { LayerNode.removeContent(L, ch); L._thumb = null; scheduleComposite(s); refreshLayerList(); }, add);
  add();
  return c;
}
// The per-stroke accumulation sheet. Stamps land here at full opacity and the whole thing is
// composited onto the layer once per frame at the stroke's opacity — which is what stops a
// slow drag from darkening where its stamps overlap.
//
// It is cleared by REGION, not whole-sheet, for the same reason makeTileUndo snapshots by tile:
// a `clearRect` over 4096² is queued instantly and then stalls the first frame that reads the
// canvas back, which is the first frame of the stroke. Whole-sheet clear here plus whole-sheet
// snapshot there was 47 ms on frame 1 and 0.2-1.0 ms on every frame after (measured 2026-08-23).
// `strokeBuffer._dirty` is the region written since the last clear, or null for "already clean";
// it is tracked in stampAt rather than derived at endStroke so that a stroke abandoned without
// endStroke — an error path, a lost pointer capture — cannot leak its pixels into the next one.
function strokeBuffer(w, h){
  let b = strokeBuffer._c;
  if (!b || b.width !== w || b.height !== h) { b = strokeBuffer._c = mkCanvas(w, h); strokeBuffer._dirty = null; return b; }
  const d = strokeBuffer._dirty;
  if (d) ctx2d(b).clearRect(d.x, d.y, d.w, d.h);
  strokeBuffer._dirty = null;
  return b;
}
function strokeBufferDirty(x, y, r){
  strokeBuffer._dirty = rectUnion(strokeBuffer._dirty, { x: x - r, y: y - r, w: 2 * r, h: 2 * r });
}
// The height brush's stroke field: one float per texel, pooled between strokes and cleared only
// over the rectangle the last stroke touched — the same bargain `strokeBuffer` makes just above,
// for the same reason. Zeroing a 4096² field outright is 16.7 M writes at every mousedown.
// ROADMAP 4.17.
// What a stroke wrote outside `embossInto`, so the next stroke clears it: the projected brush's Panel
// line adds its field a window at a time (editor/paint-proj.js).
heightBuffer.mark = r => { heightBuffer._dirty = rectUnion(heightBuffer._dirty, r); };
function heightBuffer(w, h){
  let a = heightBuffer._a;
  if (!a || heightBuffer._w !== w || heightBuffer._h !== h) {
    a = heightBuffer._a = new Float32Array(w * h);
    heightBuffer._w = w; heightBuffer._h = h; heightBuffer._dirty = null;
    return a;
  }
  const d = rectClamp(heightBuffer._dirty, w, h);
  if (d) for (let y = d.y; y < d.y + d.h; y++) a.fill(0, y * w + d.x, y * w + d.x + d.w);
  heightBuffer._dirty = null;
  return a;
}
// The UV stencils are full-sheet canvases — at 4096² one is 67 MB, so the LRU is capped by
// bytes, not by entry count (24 entries used to be able to hold 1.6 GB).
const MASK_CACHE_BYTES = 160 * 1048576;
function trimMaskCache(cache){
  let bytes = 0;
  for (const v of cache.values()) if (v) bytes += v.width * v.height * 4;
  while (bytes > MASK_CACHE_BYTES && cache.size > 1) {
    const k = cache.keys().next().value, v = cache.get(k);
    cache.delete(k);
    if (v) bytes -= v.width * v.height * 4;
  }
}
// Part stencils are rasterised at most this big. At 4096² a full-sheet stencil is a 67 MB canvas,
// and building one the first time a stroke crossed onto a new part stalled for ~100 ms — which is
// exactly the "3D painting is slow above 2K" symptom. 2048 keeps a part boundary within a texel or
// two of the truth, and every consumer scales when it samples.
const MASK_MAX = 2048;
function maskDims(w, h){
  const k = Math.min(1, MASK_MAX / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}
// ---- Stencil growing ----
// The stencil stops exactly at the island edge, but a texture's islands are drawn with a few texels
// of bleed around them and the renderer samples into that bleed. Not painting it leaves a dark rim
// on every island in 3D, so the stencil is dilated by MASK_GROW texels into the gutter — the same
// thing the exporter's seam padding does.
//
// **There used to be a hardening step in front of this** and it is gone (ROADMAP 4.23(b)): three
// whole-canvas self-composites that drove partially-covered pixels to opaque ((1-a)^8), because a
// path fill antialiases and a half-alpha stencil is a hole — the base texture showed through along
// every island border and read as a grid of pale "panel lines". `rasterUVTriangles` writes flat
// coverage, so no texel is ever partial and there is nothing to harden. Its other job, rescuing
// sliver triangles thinner than a texel, moved into the rasteriser's edge walk, which is a better
// home for it: a sliver now marks the texels it crosses instead of being recovered from whatever
// fraction of alpha the antialiaser happened to leave.
let MASK_GROW = 2;                         // texels, at mask resolution; 0 disables
const GROW_OFFSETS = new Map();
function growOffsets(r){
  let o = GROW_OFFSETS.get(r);
  if (o) return o;
  o = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (dx * dx + dy * dy <= r * r && (dx || dy)) o.push([dx, dy]);
  GROW_OFFSETS.set(r, o);
  return o;
}
function growMask(c, grow){
  const r = grow == null ? MASK_GROW : grow;
  if (r <= 0) return c;
  const out = mkCanvas(c.width, c.height), og = ctx2d(out);
  og.globalCompositeOperation = "source-over"; og.globalAlpha = 1; og.filter = "none";
  og.drawImage(c, 0, 0);
  for (const [dx, dy] of growOffsets(r)) og.drawImage(c, dx, dy);
  return out;
}
// White where the triangles of ANY of `names` cover this slot's texture.
// Cached per (slot, size, flip, grow, part set) under a byte-capped LRU.
//
// The stencil is rasterised straight into the ImageData it becomes: `rasterUVTriangles` writes
// `value` at each covered index of a flat array, so handing it a Uint32Array over the pixel buffer
// and 0xFFFFFFFF (opaque white, and the same four bytes in either endianness) means nothing has to
// convert a byte array into an image afterwards. Uncovered texels stay 0, i.e. transparent, which
// is what the old path fill left them as too.
function partSetMaskCanvas(slot, w, h, names, grow){
  const cache = slot._partMaskCache || (slot._partMaskCache = new Map());
  const flipV = $("optFlipV").checked;
  const list = [...new Set(names)].sort();
  const gr = grow == null ? MASK_GROW : grow;
  const key = w + "x" + h + "|" + (flipV ? "F" : "N") + "|g" + gr + "|" + list.join("\u0000");
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  if (!App.geomData || !list.length) { cache.set(key, null); return null; }
  const want = new Set(list);
  const D = maskDims(w, h);
  w = D.w; h = D.h;
  const img = new ImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  let any = false;
  for (const gd of App.geomData) {
    if (!want.has(gd.name)) continue;
    // Only the triangles that actually use THIS sheet. Without the slot test a part living on
    // another texture rasterised its UVs here, and a stencil built from it covered the wrong sheet
    // (0…1 UVs land somewhere on every texture) instead of being empty.
    if (App.matSlot.get(gd.mat) !== slot.id) continue;
    any = true;
    rasterUVTriangles(px, gd.uv, w, h, flipV, 0xFFFFFFFF);
  }
  let result = null;
  if (any) {
    const c = mkCanvas(w, h);
    ctx2d(c).putImageData(img, 0, 0);
    result = growMask(c, gr);
  }
  cache.set(key, result);
  trimMaskCache(cache);
  return result;
}
function partMaskCanvas(slot, w, h, partName){ return partSetMaskCanvas(slot, w, h, [partName]); }
// Every scope stencil for this slot is stale (parts regrouped, V flipped, sheet resized).
function invalidateScopeMasks(slot){
  if (!slot || !slot._partMaskCache) return;
  for (const k of [...slot._partMaskCache.keys()]) if (k.startsWith("scope|")) slot._partMaskCache.delete(k);
}
