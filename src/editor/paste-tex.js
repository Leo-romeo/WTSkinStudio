/*==PASTETEX==*/
"use strict";
// ---------- Paste a texture in as a LAYER, not over the base sheet ----------
// ROADMAP 4.25, requested 2026-08-28: "ability to paste a texture as a layer. a small search-select
// window showing the ones (likely just the one) suitable for currently selected texture and vehicle
// on top before searching."
//
// The only way in before this was `Textures ▸ Replace…`, which overwrites the sheet every layer
// composites over — destructive, outside the stack, and not what "paste" means anywhere else. The
// non-destructive verb puts the sheet in the stack, where it can be masked, blended, limited,
// reordered and undone like anything else.
//
// **"Suitable" means the same UV layout, not a similar name**, and that is the one piece with real
// content in it. A sheet lines up with the active slot only when it is *that slot's own* — 0…1 UVs
// land somewhere on every sheet, so a texture from elsewhere on the same vehicle produces a
// plausible-looking layer that is wrong everywhere. `openMaskSourceDialog` already draws exactly
// this distinction and already has wording for it, so the wording is shared rather than written a
// second time in different words — `openMaskSourceDialog` reads the two strings below.
//
// **A `_n` is never pasted as an albedo.** The failure this feature invites is dropping a packed
// surface map onto the colour channel, where R is inverted roughness and G/A are the normal axes
// (§1) — a picture of nothing, offered as if it were a texture. It cannot happen here, because the
// sources ARE channels: a slot contributes its colour, smoothness, metalness and normal separately,
// already unpacked by `NSheet.init`, and each pastes onto the channel it came from.
const PasteTex = {
  SAME_TIP: "This is the texture the layer lives on — its UVs line up exactly.",
  OTHER_TIP: "A different texture of this model. Its UV layout is unrelated to this slot's, so it will not line up — useful only for a shared or tiling sheet.",
  // Every decoded sheet in the project, as (slot, channel) pairs, with the active slot's own first.
  // `chanBase` and not the composite: pasting the sheet you are painting would fold the stack you
  // are working in back into itself, which moves under you as you work and cannot be undone to
  // anything meaningful.
  sources(target){
    const out = [];
    const slots = [...App.slots.values()].sort((a, b) => (b === target) - (a === target));
    for (const s of slots) {
      if (!s.composite) continue;
      for (const c of CHANNELS) {
        if (c.id === "wear") continue;                    // the albedo's alpha, not a sheet of its own
        const src = chanBase(s, c.id);
        if (src) out.push({ slot: s, ch: c.id, src, label: s.id + " · " + c.label.toLowerCase(), same: s === target });
      }
    }
    // ...and every sheet the project has DECODED but not bound to a slot. Adding a texture by name
    // from the game search (`Vehicle ▸ search ▸ add`) lands one here and binds it only if a material
    // matches, so without this tier the search half of the request ends in a texture the paste
    // dialog cannot see. A `_n` in this tier is offered as normal-map content and nothing else: it
    // has not been through `NSheet.init`, so its three maps are still packed and there is no
    // honest colour reading of it (§1).
    const bound = new Set();
    for (const s of App.slots.values()) { if (s.cStem) bound.add(String(s.cStem).toLowerCase()); if (s.nStem) bound.add(String(s.nStem).toLowerCase()); }
    for (const [stem, dec] of App.decoded) {
      if (bound.has(String(stem).toLowerCase()) || !dec || !dec.mips || !dec.mips[0]) continue;
      out.push({ stem, dec, ch: /_n$/i.test(stem) ? "normal" : "color", label: stem, same: false, loose: true });
    }
    return out;
  },
  // A decoded entry rasterised, once, and cached on the entry — the dialog draws a 96 px thumbnail
  // of it and then the paste reads it again at full size.
  canvasOf(it){
    if (it.src) return it.src;
    if (it._c) return it._c;
    const c = mkCanvas(it.dec.width, it.dec.height), w = it.dec.width, h = it.dec.height;
    // A loose `_n` is still packed, so its normal-channel reading is its slopes, unpacked the way a
    // slot's are — its raw bytes put roughness in X and lost Y to the canvas's alpha (ED-PROJ-05,
    // closed with ROADMAP 1.24 (b)).
    const px = it.loose && it.ch === "normal" ? NSheet.slopes(it.dec.mips[0].rgba, w, h)
      : new ImageData(it.dec.mips[0].rgba.slice(), w, h);
    ctx2d(c).putImageData(px, 0, 0);
    it._c = c;
    return c;
  },
  // Scaled to the destination channel's own size on the way in. A 1024² source dropped into a 2048²
  // slot would otherwise arrive as a quarter sheet in the corner, which reads as a broken paste.
  scaled(src, w, h){
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, w, h);
    return c;
  },
  place(slot, src, ch, label){
    const base = chanBase(slot, ch) || slot.composite;
    if (!base) { setStatus("This slot has no sheet for the " + Tool.chanWord(ch) + " channel yet", "err"); return false; }
    const L = LayerNode.of({ type: "paint", chan: ch === "color" ? undefined : ch, name: label,
      canvas: PasteTex.scaled(src, base.width, base.height),
      visible: true, opacity: 1, blend: "normal", scope: Scope.ofSelection() });
    addLayerTo(slot, L);
    App.activeLayer = L;
    refreshLayerList();
    setStatus("“" + label + "” pasted as a layer on the " + Tool.chanWord(ch) + " channel — mask it, fade it, limit it " +
      "to some parts, or reorder it. Nothing was written over.", "ok");
    return true;
  },
  open(slot){
    if (!slot || !slot.composite) { setStatus("Select a texture slot first", "err"); return; }
    const m = modalDialog("Paste a texture as a layer", { width: "min(760px,94vw)" });
    m.body.style.flexDirection = "column";
    const top = document.createElement("div");
    top.className = "row";
    top.style.marginBottom = "4px";
    const note = document.createElement("span");
    note.className = "hint";
    note.style.margin = "0";
    note.textContent = "Each sheet pastes onto the channel it came from, scaled to " +
      slot.composite.width + "×" + slot.composite.height + " — nothing is written over the slot's own texture.";
    top.appendChild(note);
    m.body.appendChild(top);

    const list = PasteTex.sources(slot);
    const grid = document.createElement("div");
    grid.className = "declib";
    grid.style.maxHeight = "58vh";
    if (!list.length) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = "This project has no decoded textures yet — load a vehicle, or paste from an image file.";
      m.body.appendChild(h);
    }
    for (const it of list) {
      const card = document.createElement("div");
      card.className = "card";
      const c = mkCanvas(96, 96), g = ctx2d(c);
      g.fillStyle = "#15171c"; g.fillRect(0, 0, 96, 96);
      // A source that will not draw used to come back as the flat fill above and read as "this
      // texture is empty" — the opposite of true (the same trap `maskSourceList` records).
      try { g.drawImage(PasteTex.canvasOf(it), 0, 0, 96, 96); } catch (e) { brokenThumb(c, e, "Texture “" + it.label + "”"); }
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = it.label + (it.same ? "" : " ⚠");
      card.title = it.same ? PasteTex.SAME_TIP
        : it.loose ? "A texture this project has decoded but not bound to any slot — added by name from the game search. " + PasteTex.OTHER_TIP
        : PasteTex.OTHER_TIP;
      card.append(c, nm);
      card.onclick = () => { m.close(); PasteTex.place(slot, PasteTex.canvasOf(it), it.ch, it.label); };
      grid.appendChild(card);
    }
    m.body.appendChild(grid);
    const bFile = document.createElement("button");
    bFile.textContent = "From an image file…";
    bFile.title = "Any PNG / JPEG / DDS / TGA, pasted onto the channel the brush is set to";
    bFile.onclick = () => { m.close(); $("pasteTexPick").click(); };
    const grow = document.createElement("span");
    grow.className = "grow";
    grow.textContent = "⚠ = the UVs do not line up with this slot's · anything else: Vehicle ▸ search ▸ add, then come back here.";
    const bCancel = document.createElement("button");
    bCancel.textContent = "Cancel";
    bCancel.onclick = m.close;
    m.foot.append(bFile, grow, bCancel);
  },
  // An image from disk. It goes onto the channel the BRUSH is in, which is 4.28(d)'s answer to
  // "which channel am I working in" — a file carries no channel of its own, and asking a second
  // time in a second control is the duplication (e) removed from the Layers panel.
  async fromFile(f){
    const slot = App.activeSlot;
    if (!slot || !f) return;
    try {
      let src;
      if (/\.dds$/i.test(f.name)) {
        const dec = await parseDDSAsync(await f.arrayBuffer());
        src = mkCanvas(dec.width, dec.height);
        ctx2d(src).putImageData(new ImageData(dec.mips[0].rgba.slice(), dec.width, dec.height), 0, 0);
      } else if (/\.tga$/i.test(f.name)) {
        // the ArrayBuffer itself: parseTGA reads it through a DataView, which a Uint8Array is not —
        // pasting a .tga as a layer threw every time (found in the review of 2.3a, 2026-10-23)
        const dec = TGA.parseTGA(await f.arrayBuffer());
        src = mkCanvas(dec.width, dec.height);
        ctx2d(src).putImageData(new ImageData(dec.mips[0].rgba.slice(), dec.width, dec.height), 0, 0);
      } else src = toCanvas(await createImageBitmap(f));
      PasteTex.place(slot, src, (App.brush && App.brush.chan) || "color", f.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      reportFailure("Pasting “" + f.name + "” as a layer", err, "pastetex");
    }
  },
};
$("btnPasteTex").onclick = () => PasteTex.open(App.activeSlot);
$("pasteTexPick").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (f) await PasteTex.fromFile(f); };
/*==ENDPASTETEX==*/
