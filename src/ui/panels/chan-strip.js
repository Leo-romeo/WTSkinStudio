/*==CHANSTRIP==*/
"use strict";
// ---------- The channel strip: what this layer carries, and everything you can do to it ----------
// ROADMAP 4.28(e). Until now the Layers panel asked you to choose a layer's TYPE and its CHANNEL
// before it existed — four "add" buttons and a "New layer on" select — and then never let you
// change either. Both questions were premature and one of them was unanswerable: you cannot know
// whether a marking wants a smoothness map until you have looked at it on the model.
//
// (b) made a layer a bundle of per-channel content, (c) made one walk composite every channel and
// (d) made the tool in your hand decide which channel a stroke lands in. This is the half you can
// see: one "New layer" button, and a strip on the selected layer showing the five channels, which
// of them it carries, and what kind of content is in each. It is also where 4.20 ("change a layer's
// type", open since 2026-08-26) is finally answered, as two commands rather than one ambiguous one:
// changing a slot's CONTENT KIND, and MOVING content between slots — each named so the lossy
// direction is visible before you take it.
//
// One binding, the way `Marquee`, `SelectUI`, `LayerList` and `DecalUI` do it (CLAUDE.md §5.6).
const ChanStrip = {
  // A chip is drawn for every channel, carried or not, because the strip has to answer "what else
  // could this layer be" as well as "what is it". An empty chip is a `+`.
  build(el, s, L){
    if (!L || isGroup(L) || !LayerNode.isLayer(L)) return;
    const wrap = document.createElement("div");
    wrap.className = "chanstrip";
    wrap.title = "The channels this layer carries. Click one to work in it; the arrow converts, moves or removes it.";
    for (const c of CHANNELS) wrap.appendChild(ChanStrip.chip(s, L, c));
    el.appendChild(wrap);
  },
  chip(s, L, ch){
    const content = LayerNode.contentOn(L, ch.id);
    const d = document.createElement("span");
    d.className = "chanchip" + (content ? " has" : "") + (App.brush.chan === ch.id ? " cur" : "");
    const dot = document.createElement("span");
    dot.className = "cdot " + ch.id;
    if (!content) dot.style.background = "transparent";
    d.appendChild(dot);
    const t = document.createElement("span");
    t.textContent = content ? ch.label + " · " + LayerNode.KIND_SHORT[content.kind] : "+ " + ch.label;
    d.appendChild(t);
    d.title = content
      ? ch.label + " — this layer holds " + LayerNode.wordFor(content) + " here. " + ch.tip
      : "Add " + ch.label.toLowerCase() + " content to this layer. " + ch.tip;
    // A carried chip is the "which channel am I working in" control 4.28's D4 asks for; an empty
    // one adds the slot. Both are one click, and the arrow carries everything that is not one click.
    d.onclick = ev => {
      ev.stopPropagation();
      if (content) ChanStrip.useChannel(ch.id);
      else ChanStrip.add(s, L, ch.id, "paint");
    };
    d.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); ChanStrip.menu(ev, s, L, ch.id); };
    const more = document.createElement("button");
    more.textContent = "▾";
    more.title = content ? "Convert, move or remove this channel" : "Add this channel as a fill or an effect instead";
    more.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); ChanStrip.menu(ev, s, L, ch.id); };
    d.appendChild(more);
    return d;
  },
  // Move the BRUSH to this channel, keeping the tool if it can write there and swapping to one that
  // can if it cannot — the normal map is reached by Panel line and Flatten, never by the Brush, so
  // clicking "Normal" with the Brush in hand has to mean something rather than refuse.
  useChannel(ch){
    const b = App.brush;
    let r = Tool.resolve(b.tool, ch, "content");
    if (r.err) {
      const alt = Object.keys(Tool.TOOLS).find(t => Tool.takes(t, ch));
      if (alt) r = Tool.resolve(alt, ch, "content");
    }
    if (r.err) { setStatus(r.err, "err"); return; }
    setBrushMode(r.mode);
    setStatus("Working in " + Tool.chanWord(ch) + " — strokes land in this layer's " + Tool.chanWord(ch) + " channel", "ok");
  },

  // ---- the commands ----
  menu(ev, s, L, ch){
    const c = LayerNode.contentOn(L, ch);
    const free = CHANNELS.filter(x => !LayerNode.carries(L, x.id));
    const items = [];
    if (!c) {
      items.push({ label: "Add " + CHAN_LABEL[ch] + " — paint", run: () => ChanStrip.add(s, L, ch, "paint") });
      items.push({ label: "Add " + CHAN_LABEL[ch] + " — flat fill", run: () => ChanStrip.add(s, L, ch, "fill") });
      items.push({ label: "Add " + CHAN_LABEL[ch] + " — gradient", run: () => ChanStrip.add(s, L, ch, "gradient") });
      items.push({ label: "Add " + CHAN_LABEL[ch] + " — noise", run: () => ChanStrip.add(s, L, ch, "noise") });
      items.push({ label: "Add " + CHAN_LABEL[ch] + " — effect", run: () => ChanStrip.add(s, L, ch, "effect") });
    } else {
      items.push({ label: "Work in " + Tool.chanWord(ch), run: () => ChanStrip.useChannel(ch) });
      items.push({ sep: true });
      // 4.20, first half: change the CONTENT KIND. Both directions are offered and the lossy one
      // says what it costs in its own label, which is the whole of what 4.20 was waiting on.
      if (c.kind === "fill")
        items.push({ label: c.pat ? "Bake the pattern into pixels — it stops repeating from its tile"
          : c.grad && c.grad.shape === "noise" ? "Bake the noise into pixels — it stops following the model or its settings"
          : c.grad ? "Bake the gradient into pixels — it stops following the model or its stops" : "Convert to painted pixels", run: () => ChanStrip.convert(s, L, ch, "paint") });
      if (c.kind === "paint" && !c.proj)
        items.push({ label: "Replace with a flat fill — discards the pixels", danger: true,
          run: () => ChanStrip.convert(s, L, ch, "fill") });
      if (c.kind === "image")
        items.push({ label: "Bake the image into pixels — loses its placement", danger: true,
          run: () => ChanStrip.convert(s, L, ch, "paint") });
      // 4.20, second half: MOVE content between slots. Lossless, and refused rather than merged
      // when the destination already holds something.
      if (free.length) {
        items.push({ sep: true });
        for (const x of free)
          items.push({ label: "Move to " + Tool.chanWord(x.id), run: () => ChanStrip.move(s, L, ch, x.id) });
      }
      items.push({ sep: true });
      items.push({ label: "Remove " + Tool.chanWord(ch) + " from this layer", danger: true,
        run: () => ChanStrip.remove(s, L, ch) });
    }
    popupMenu(ev, items);
  },
  // Every command below is one undo step that repaints, refreshes and drops the stale thumbnail —
  // written once here rather than five times, because "it worked but the panel still showed the old
  // thing" is the failure mode this panel is most exposed to.
  act(s, L, desc, before, after){
    const run = fn => { fn(); L._thumb = null; scheduleComposite(s); scheduleChannels(s); refreshLayerList(); };
    pushAction(desc, () => run(before), () => run(after));
    run(after);
  },
  blank(s, ch, kind){
    if (kind === "fill") return LayerNode.content("fill", { color: ch === "color" ? App.brush.color : "#808080" });
    // a gradient is a fill carrying a record (4.44's fifth): the brush colour fading out, in UV space
    if (kind === "gradient") { const col = ch === "color" ? App.brush.color : "#808080"; return LayerNode.content("fill", { color: col, grad: Gradient.make("uv", col) }); }
    // ...and a noise is one whose t is a noise field along the model (4.50 (8)): the brush colour,
    // showing where the noise is light
    if (kind === "noise") { const col = ch === "color" ? App.brush.color : "#808080"; return LayerNode.content("fill", { color: col, grad: GradUI.noiseRecord(col) }); }
    if (kind === "effect") return LayerNode.content("effect", { hue: 0, sat: 100, bright: 100, contrast: 100 });
    const base = chanBase(s, ch) || s.composite;
    return LayerNode.content("paint", { canvas: mkCanvas(base.width, base.height) });
  },
  add(s, L, ch, kind){
    if (!s || !s.composite) { setStatus("Select a texture slot first", "err"); return; }
    if (LayerNode.carries(L, ch)) return;
    // A surface channel composites over the map unpacked from the slot's _n. With no _n there is
    // nothing under it, so the slot would sit there doing nothing — say so instead. The same
    // refusal the old "add layer" path made, kept because it is still true.
    if (SURF_CHANS.includes(ch) && !chanBase(s, ch)) {
      setStatus("“" + s.id + "” has no _n surface map loaded, so a " + Tool.chanWord(ch) +
        " channel would have nothing to composite over — load one under Textures ▸ Replace…, or Find in game files", "err");
      return;
    }
    const c = ChanStrip.blank(s, ch, kind);
    ChanStrip.act(s, L, "add " + Tool.chanWord(ch) + " to layer",
      () => LayerNode.removeContent(L, ch), () => LayerNode.addContent(L, ch, c));
    setStatus("“" + L.name + "” now carries " + Tool.chanWord(ch) + " as " + LayerNode.wordFor(c) +
      " — one layer, every channel it needs", "ok");
  },
  remove(s, L, ch){
    const c = LayerNode.contentOn(L, ch);
    if (!c) return;
    // The last channel IS the layer. Removing it would leave a container holding nothing, which
    // composites as nothing and reads in the list as a layer that has stopped working — so the
    // command actually meant here is Delete, and it says so rather than doing half of it.
    if (LayerNode.channelsOf(L).length === 1) {
      setStatus("“" + L.name + "” carries only " + Tool.chanWord(ch) +
        ", so removing it would leave an empty layer — delete the layer instead (Delete, below)", "err");
      return;
    }
    ChanStrip.act(s, L, "remove " + Tool.chanWord(ch) + " from layer",
      () => LayerNode.addContent(L, ch, c), () => LayerNode.removeContent(L, ch));
    setStatus("Removed the " + Tool.chanWord(ch) + " channel from “" + L.name + "” — Ctrl+Z brings it back", "ok");
  },
  move(s, L, from, to){
    if (LayerNode.carries(L, to)) {
      setStatus("“" + L.name + "” already holds " + LayerNode.wordFor(LayerNode.contentOn(L, to)) +
        " on " + Tool.chanWord(to) + " — remove that first, or move this one somewhere else", "err");
      return;
    }
    // A path layer's recipe was laid with a brush on `from` (4.52 (3)): on another map its next
    // redraw would put colour into roughness. The move keeps the pixels and lets go of the recipe,
    // as a duplicate does, and the undo gives it back (found in review, 2026-10-23).
    const c = LayerNode.contentOn(L, from), sh = c && c.shape;
    ChanStrip.act(s, L, "move layer content to " + Tool.chanWord(to),
      () => { LayerNode.moveContent(L, to, from); if (sh) c.shape = sh; },
      () => { LayerNode.moveContent(L, from, to); if (sh) c.shape = null; });
    setStatus("Moved this layer's " + Tool.chanWord(from) + " content onto " + Tool.chanWord(to) +
      " — the same pixels, on a different map" + (sh ? "; it is no longer redrawn from its path" : ""), "ok");
  },
  // 4.20's first command. `fill -> paint` rasterises the colour and loses nothing; the other two
  // directions are lossy and are labelled as such in the menu above, because the honest answer to
  // "change this layer's type" is that one direction throws work away.
  convert(s, L, ch, kind){
    const c = LayerNode.contentOn(L, ch);
    if (!c || c.kind === kind) return;
    const base = chanBase(s, ch) || s.composite;
    let next;
    if (kind === "paint" && c.kind === "fill") {
      // A gradient along the model needs the sheet's position bake, which may not exist yet and is
      // a GPU pass under the progress bar — so that case goes round through the bake and comes
      // back here with the pixels in hand (4.44's fifth candidate). So does a noise or a pattern
      // along the model whose evaluation has not landed yet (4.50 (7), (8)).
      if ((c.grad || c.pat) && !GradFill.ready(s, c, L)) {
        const what = LayerNode.wordFor(c).replace(/^an? /, "");
        GradFill.render(s, ch, c, L).then(cv => {
          if (LayerNode.contentOn(L, ch) !== c) return;              // the layer moved on meanwhile
          const paint = LayerNode.content("paint", { canvas: cv });
          const put = v => { LayerNode.removeContent(L, ch); LayerNode.addContent(L, ch, v); };
          ChanStrip.act(s, L, "change layer content to paint", () => put(c), () => put(paint));
          setStatus("“" + L.name + "” now holds painted pixels on " + Tool.chanWord(ch), "ok");
        }).catch(err => {
          if (err instanceof Cancelled) { setStatus("Conversion cancelled — the " + what + " is unchanged", "ok"); return; }
          reportFailure("Converting the " + what + " to pixels", err, "grad-convert");
        });
        return;
      }
      const cv = mkCanvas(base.width, base.height), g = ctx2d(cv);
      if (c.grad || c.pat) GradFill.draw({ slot: s, ch, W: cv.width, H: cv.height, sx: 0, sy: 0, tw: cv.width, th: cv.height }, g, c, L);
      else { g.fillStyle = c.color; g.fillRect(0, 0, cv.width, cv.height); }
      next = LayerNode.content("paint", { canvas: cv });
    } else if (kind === "paint" && c.kind === "image") {
      next = LayerNode.content("paint", { canvas: ChanStrip.bake(s, ch, c) });
    } else if (kind === "fill") {
      next = LayerNode.content("fill", { color: ch === "color" ? App.brush.color : "#808080" });
    } else return;
    const put = v => { LayerNode.removeContent(L, ch); LayerNode.addContent(L, ch, v); };
    ChanStrip.act(s, L, "change layer content to " + LayerNode.KIND_SHORT[kind], () => put(c), () => put(next));
    setStatus("“" + L.name + "” now holds " + LayerNode.KIND_WORD[kind] + " on " + Tool.chanWord(ch) +
      (kind === "paint" && c.kind === "image" ? " — the image is baked where it stood, so it no longer moves as a decal"
        : kind === "fill" ? " — the pixels are gone; Ctrl+Z brings them back" : ""), "ok");
  },
  // The image, stamped where it stands: `Composite.content` itself, over the whole sheet instead of
  // a region — so the mirrored copy comes too (it is part of the decal and would otherwise vanish
  // the moment it stopped being one), and on a camouflage tile the copies across its edges. This
  // was a copy of that arithmetic until the tile's wrap went into the original only, and a decal
  // over a tile's edge lost its wrapped half the moment it was converted (review of 4.50 (6)).
  bake(s, ch, c){
    const base = chanBase(s, ch) || s.composite;
    const W = base.width, H = base.height, out = mkCanvas(W, H);
    Composite.content({ slot: s, ch, W, H, sx: 0, sy: 0, tw: W, th: H }, ctx2d(out), c, null);
    return out;
  },
};
/*==ENDCHANSTRIP==*/
