/*==LAYERNODE==*/
"use strict";
// ---------- A layer is a bundle of per-channel content ----------
// ROADMAP 4.28(b). A layer used to be a TYPE you picked before it existed — `paint`, `fill`,
// `decal`, `adjust` — each carrying its own fields and each tagged with the one channel it wrote.
// It is a CONTAINER now: name, visibility, opacity, blend, mask and part scope over a set of
// channel slots, one content per channel, and the kind is a property of the CONTENT rather than of
// the node. Two things fall out of that, and they are the whole reason for the change:
//
//   * **A channel becomes an address instead of a tag.** `compositeSlot` and `compositeChannel` are
//     two copies of one function only because "which sheet does this layer belong to" is answered
//     by a label on the node, so the walk has to be written once per sheet. Ask a node what it
//     holds ON a channel — `LayerNode.contentOn(node, ch)` — and they are one function taking a
//     channel argument. That is slice (c); this is what it stands on.
//   * **A decal's folder stops being a special case.** Today a decal with a Look silently makes a
//     group and fills it with sibling layers tagged `surfKey`, and a rule had to be invented to
//     stop the user dragging one out (4.18). Those siblings are one thing's several channels, which
//     is what a container expresses directly.
//
// **Nothing outside this file had to change to read a layer.** Every field the other ninety-two
// modules touch — `L.type`, `L.canvas`, `L.color`, `L.bmp`, `L.chan`, a decal's placement, an
// adjustment's four numbers — is an accessor on the container's prototype, forwarding to the one
// content it holds. Until (e) lets a layer carry a second channel there is exactly one, so "the
// content" is unambiguous and the forwarding is exact rather than a guess.
//
// **Why a prototype and not own properties.** An own accessor is copied by `{...L}` as a VALUE, so
// a spread would hand back a plain object holding a `type` string and no `chans` — broken in a way
// that looks fine until something writes to it. On a prototype, a spread copies the bundle and
// nothing else, which is wrong in an obvious way rather than a subtle one; `LayerNode.clone` is the
// supported answer and `duplicateLayer` is its one caller. It also keeps `Object.keys(node)` the
// list of what the node itself owns, which is what the project writer walks.
//
// **What is deliberately NOT here.** `derived` is one of the four content kinds the model names —
// a recipe plus its cached canvas — and it is not built yet: today's derived surface layers are
// paint contents wearing a `surfKey`, and giving them a kind of their own belongs with (f), which
// deletes `surfKey` rather than porting it. And the project format stays at version 4: a version 5
// that is only these same records in a different arrangement would break every existing project
// while nothing can yet produce a layer with two channels in it. The bump belongs with (e), which
// has something new to store. Old files migrate forward on load — `loadNode` builds the flat record
// it always did and hands it to `LayerNode.of`.
const LayerNode = {
  // What a channel slot can hold. `fill` allocates nothing, `paint` owns a canvas, `image` is a
  // bitmap with a placement, `effect` is numbers and no pixels at all — the four it always had, or
  // a kind's record in `fx` (Levels, Curves… — 4.50 (5), editor/effects.js).
  KINDS: ["fill", "paint", "image", "effect"],
  // What a kind is called in a sentence, and on a channel chip. One table, because the panel, two
  // brush errors and the layer row had each started to invent their own words for the same four.
  KIND_WORD: { fill: "a flat fill", paint: "painted pixels", image: "an image", effect: "an effect" },
  KIND_SHORT: { fill: "fill", paint: "paint", image: "image", effect: "effect" },
  KIND_OF_TYPE: { fill: "fill", paint: "paint", decal: "image", adjust: "effect" },
  // What THIS content is called: a fill carrying a gradient (4.44's fifth) is "a gradient", not
  // "a flat fill" — the one place the word is chosen, for the six sentences that say it. A noise
  // is a gradient record underneath and a pattern a tile image (4.50 (7), (8)); each says so.
  wordFor(c){
    if (c && c.kind === "fill" && c.pat) return "a pattern";
    if (c && c.kind === "fill" && c.grad) return c.grad.shape === "noise" ? "a noise" : "a gradient";
    return LayerNode.KIND_WORD[c && c.kind] || "content";
  },
  TYPE_OF_KIND: { fill: "fill", paint: "paint", image: "decal", effect: "adjust" },
  // The fields that belong to the CONTENT rather than to the layer around it. Listed explicitly,
  // and everything else stays where it was on purpose: a field this list has never heard of is left
  // on the bundle, which is harmless, whereas moving an unknown field into a content that exposes
  // no accessor for it would make it silently disappear.
  CONTENT: ["color", "grad", "pat", "patImg", "patName", "canvas", "proj", "projEmpty",
            "bmp", "orig", "x", "y", "scale", "rot", "flip", "sym", "surf", "heightMap", "heightName", "text",
            "hue", "sat", "bright", "contrast", "fx",
            "_mip", "_mipKey", "_mipSrc", "_gradSheet", "_gradKey"],

  // ---- the questions (c) is written against ----
  // What this node holds on `ch`, or null. A group holds nothing itself — its children do.
  contentOn(n, ch){ return (n && n.chans && n.chans[ch]) || null; },
  // Which channels it carries anything on, in insertion order.
  channelsOf(n){ return n && n.chans ? Object.keys(n.chans) : []; },
  // Is this node a container at all? A group is a node and not a layer, and a record that has not
  // been through `of()` is neither.
  isLayer(n){ return !!(n && n.chans); },

  // The single content, while there is only ever one. Every legacy accessor reads through here, so
  // when (e) allows a second channel this is the one place that has to answer "which one is the
  // legacy view of", rather than twenty-three accessors each deciding for themselves.
  only(n){ const c = n && n.chans; if (!c) return null; for (const k in c) return c[k]; return null; },
  onlyChan(n){ const c = n && n.chans; if (!c) return "color"; for (const k in c) return k; return "color"; },

  // ---- what a new layer is called ----
  // One rule, because there were two and they disagreed: the New layer button said "Layer 3" and a
  // brush that had to make its own layer said "Paint 3" — or "Smoothness 3", "Metalness 3", after
  // whichever tool was in hand. Naming a layer after a channel stopped being true at (e): a layer
  // carries as many channels as you add contents to, so "Smoothness 3" is a lie the moment anything
  // else lands on it, and the channel strip already says which channels a layer holds. So the name
  // says what the thing is, the strip says what it carries, and neither repeats the other.
  autoName(layers){
    return "Layer " + (layerLeaves(layers).filter(l => l.type === "paint").length + 1);
  },

  // ---- making one ----
  // Takes the record the app has always written and turns it into a container IN PLACE, so a call
  // site stays the object literal it was and gains one wrapper. Idempotent, and it leaves a group
  // alone: a group is a node, not a layer, and keeps the shape it has.
  of(rec){
    if (!rec || isGroup(rec)) return rec;
    if (!rec.uid) rec.uid = LayerNode.newUid();
    // Already a bundle — from a version 5 project file, which stores the slots directly. It still
    // has to be adopted, because a record parsed out of JSON has `chans` and Object.prototype, and
    // every accessor above lives on ours.
    if (rec.chans) {
      if (Object.getPrototypeOf(rec) !== LayerNode.proto) Object.setPrototypeOf(rec, LayerNode.proto);
      return rec;
    }
    const kind = LayerNode.KIND_OF_TYPE[rec.type] || "paint";
    const ch = rec.chan || "color";
    const content = { kind };
    for (const k of LayerNode.CONTENT) if (k in rec) { content[k] = rec[k]; delete rec[k]; }
    delete rec.type; delete rec.chan;
    rec.chans = {};
    rec.chans[ch] = content;
    Object.setPrototypeOf(rec, LayerNode.proto);
    return rec;
  },
  // A copy that shares no record with the original. Canvases and bitmaps are shared — whoever wants
  // its own pixels snapshots them, which is what `duplicateLayer` does and what makes duplicating
  // a fill free.
  clone(n){
    if (isGroup(n)) return Object.assign({}, n, { children: n.children.slice(), uid: LayerNode.newUid() });
    const out = Object.create(LayerNode.proto);
    for (const k of Object.keys(n)) out[k] = n[k];
    out.uid = LayerNode.newUid();                    // a copy is its own layer — nothing points at it yet
    out.chans = {};
    for (const ch of Object.keys(n.chans || {})) {
      const c = out.chans[ch] = Object.assign({}, n.chans[ch]);
      if (c.grad) c.grad = Gradient.clone(c.grad);         // a record, not pixels: the copy gets its own (4.44's fifth)
      if (c.pat) c.pat = Procedural.patClone(c.pat);        // ...and a pattern's (4.50 (7)); the tile image is shared, like a bitmap
      if (c.fx) c.fx = Effect.clone(c.fx);                 // ...and so does an effect's (4.50 (5))
      if (c.text) c.text = { ...c.text };                  // ...and a text decal's (4.50 (3)): a flat record
      delete c._proc;                                       // the original's evaluation in flight is not the copy's
      delete c._maskC;                                      // ...nor the mask its pattern lends (GradFill.maskContent)
    }
    return out;
  },

  // ---- a name that survives a reload, so one node can point at another (ROADMAP 4.36) ----
  // A layer never had an identity beyond its place in the tree; a mask that is ANOTHER layer needs
  // one. Time plus a counter, in base 36: unique within an install and short enough to read in a
  // project file. Written by ProjNode and read back; a node from an older file gets one on load.
  _uidN: 0,
  newUid(){ return "n" + Date.now().toString(36) + "-" + (LayerNode._uidN++).toString(36); },
  byUid(layers, uid){ return uid ? (layerNodes(layers).find(n => n.uid === uid) || null) : null; },
  // ---- a mask that is another layer (ROADMAP 4.36) ----
  // The reference model, not the copy: `maskRef` names a layer of the same slot, and the mask is
  // that layer's own painted pixels — its colour content's canvas, whose alpha is exactly "where
  // it has paint" — read LIVE at composite time. Nothing is snapshotted and nothing has to be
  // invalidated by hand: a stroke on the source dirties a region, the one walk that rebuilds that
  // region (4.28(c)) reads the source's canvas as it is now, and the layer that masks by it is in
  // the same walk. Order in the stack does not matter, because what is read is the source's RAW
  // pixels, never its composited result — which is also the honest limit: a source's own mask,
  // opacity, blend or effects are not part of the shape it lends. A source with no canvas (a fill,
  // an adjustment, an image not yet baked) cannot lend one; a source that is deleted lends nothing
  // and the row says so. Painting on such a mask is refused — paint on the source instead.
  // `maskRef === "below"` is a CLIPPING mask (4.44's second candidate, Photoshop's clip-to-layer):
  // the source is whatever leaf sits directly under this node in its own list, re-resolved on
  // every read, so it follows a reorder the way a clip does and needs no uid at all.
  BELOW: "below",
  maskSource(slot, n){
    const src = LayerNode.maskFrom(slot, n);
    if (!src) return null;
    const c = LayerNode.contentOn(src, "color") || LayerNode.only(src);
    // a gradient's fade is a mask (4.44's fifth), and so are a noise's and a pattern's (4.50 (7), (8))
    if (c && c.kind === "fill" && (c.grad || c.pat)) return GradFill.maskSheet(slot, src, c);
    return c && c.canvas ? c.canvas : null;
  },
  // The LAYER whose pixels `n`'s mask reads, or null — the reference resolved, before anything is
  // read off it. `GradFill.ensure` asks it too: a pattern lent as a mask is evaluated as a mask.
  maskFrom(slot, n){
    if (!n || !n.maskRef || !slot) return null;
    const src = n.maskRef === LayerNode.BELOW ? LayerNode.below(slot, n) : LayerNode.byUid(slot.layers, n.maskRef);
    return !src || src === n || isGroup(src) ? null : src;
  },
  // The leaf directly under `n` in the list it lives in (index 0 is the bottom of the stack), or
  // null at the bottom — and null for a group, which has no pixels of its own to clip to.
  below(slot, n){
    const own = nodeOwner(slot.layers, n);
    const b = own && own.i > 0 ? own.list[own.i - 1] : null;
    return b && !isGroup(b) ? b : null;
  },
  // What actually stencils this node: the referenced layer's pixels, or its own painted mask.
  maskCanvas(slot, n){ return n && n.maskRef ? LayerNode.maskSource(slot, n) : (n && n.mask) || null; },
  // Which layers of the slot could lend a shape to `n`: leaves with a canvas, other than itself and
  // other than anything already masked BY `n` (no cycles — a cycle would read a canvas being written).
  maskSources(slot, n){
    if (!slot) return [];
    return layerLeaves(slot.layers).filter(l => l !== n && l.maskRef !== n.uid &&
      (c => c && (c.canvas || (c.kind === "fill" && (c.grad || c.pat))))(LayerNode.contentOn(l, "color") || LayerNode.only(l)));
  },

  // ---- (e): a layer that carries more than one channel ----
  // The PRIMARY channel is the first slot, and every legacy accessor below describes it. Adding a
  // content APPENDS, so a colour layer that gains a smoothness slot is still a colour layer to
  // `L.type`, `L.canvas`, the thumbnail and the blend list — which is the question (b) left open
  // ("which one is the legacy view of") answered in the way that changes nothing already written.
  // Where a stroke lands is a DIFFERENT question, asked with `contentOn` and the brush's own
  // channel; the two coincide only while a layer carries one thing, which is what (d) made true.
  carries(n, ch){ return !!(n && n.chans && n.chans[ch]); },
  // WHICH CHANNEL OF THIS LAYER AM I WORKING IN — the brush's, whenever the layer carries it, and
  // the primary slot otherwise (which is what everything meant back when a layer held one thing).
  // It was written out by hand in the layer-props panel and NOT asked at all in the two places
  // ROADMAP 4.34 found: `applyAutoChanView`, which asked `layerChan` and so followed the primary
  // slot rather than the channel on screen, and `Marquee.copy`, which asked nothing and built a
  // colour layer out of whatever canvas the primary slot happened to hold. One copy, three callers.
  workingChan(n, brushChan){
    const ch = brushChan === undefined ? (App.brush && App.brush.chan) : brushChan;
    return LayerNode.carries(n, ch) ? ch : layerChan(n);
  },
  // Blank content of a kind. A `paint` needs a canvas and only the caller knows how big, so it is
  // passed in — this file allocates nothing and has no idea what a slot's size is.
  content(kind, init){ return Object.assign({ kind }, init || {}); },
  addContent(n, ch, c){
    if (!n || !n.chans || !ch || !c || n.chans[ch]) return null;
    n.chans[ch] = c;
    return c;
  },
  removeContent(n, ch){
    if (!n || !n.chans || !n.chans[ch]) return null;
    const c = n.chans[ch];
    delete n.chans[ch];
    return c;
  },
  // 4.20's "move content between slots". Rewritten in place rather than delete-then-set, because
  // deleting a key and adding it back puts it LAST in insertion order — so moving the primary
  // content would silently demote it and change what every legacy accessor describes.
  moveContent(n, from, to){
    if (!n || !n.chans || !n.chans[from] || from === to || n.chans[to]) return false;
    const next = {};
    for (const k of Object.keys(n.chans)) next[k === from ? to : k] = n.chans[k];
    n.chans = next;
    return true;
  },
  proto: {},
};
// ---- the legacy view ----
// `type` is the content's kind read back out, and setting it re-kinds the content rather than
// re-typing the node — which is 4.20 ("change a layer's type") arriving as a side effect of the
// model rather than as a feature.
Object.defineProperty(LayerNode.proto, "type", {
  get(){ const c = LayerNode.only(this); return c ? LayerNode.TYPE_OF_KIND[c.kind] || "paint" : "paint"; },
  set(v){ const c = LayerNode.only(this); if (c && LayerNode.KIND_OF_TYPE[v]) c.kind = LayerNode.KIND_OF_TYPE[v]; },
  enumerable: false, configurable: true,
});
// `chan` is the slot's KEY, so setting it moves the content from one slot to another — which is
// what changing a layer's channel has always meant and never had a way to say.
Object.defineProperty(LayerNode.proto, "chan", {
  get(){ return LayerNode.onlyChan(this); },
  set(v){
    if (!v || !this.chans) return;
    LayerNode.moveContent(this, LayerNode.onlyChan(this), v);
  },
  enumerable: false, configurable: true,
});
for (const k of LayerNode.CONTENT) Object.defineProperty(LayerNode.proto, k, {
  get(){ const c = LayerNode.only(this); return c ? c[k] : undefined; },
  set(v){ const c = LayerNode.only(this); if (c) c[k] = v; },
  enumerable: false, configurable: true,
});
/*==ENDLAYERNODE==*/
