// The slot list, as named steps on one object (ROADMAP 2.4): refreshSlotList was 81 lines with
// the row builder a closure inside it. Gated by t44's slots-list fixture.
const SlotList = {
  // One texture slot: thumbnail, name, size and what it carries, the gate's mark, the ⋮ menu.
  row(el, slot){
    const d = document.createElement("div");
    d.className = "rowitem slot" + (slot === App.activeSlot ? " sel" : "");
    if (slot.composite) {
      const t = document.createElement("canvas");
      t.width = t.height = 34;
      t.getContext("2d").drawImage(slot.composite, 0, 0, 34, 34);
      if (slot.missing) t.style.opacity = ".45";
      slot.thumb = t; d.appendChild(t);
    } else d.innerHTML = '<div class="noimg">?</div>';
    const info = document.createElement("div");
    info.style.cssText = "flex:1;overflow:hidden";
    // slot ids come from game/material names — build the rows as text nodes, never as markup
    const nmEl = document.createElement("div");
    nmEl.className = "nm";
    nmEl.textContent = slot.id;
    if (slot.missing) nmEl.style.color = "var(--muted)";
    const szEl = document.createElement("div");
    szEl.className = "sz";
    // A sheet the install HAS but the editor does not open — a propeller mask in L8 — is not a texture
    // still to be found, and "wants: …" sent the user looking for it (review of 2026-10-10: greyed-out
    // empty slots on 961 aircraft and helicopters). It says what it is instead. Ask the stem as named,
    // then lower-cased — the material names it as the desc does, the index as the pack does.
    const held = slot.missing && slot.cStem
      ? GameDB.unreadOf(GameDB.stems.get(slot.cStem) || GameDB.stems.get(String(slot.cStem).toLowerCase())) : null;
    const utility = held && GameDB.blockKind(held) === "format";
    const effect = slot.camoTile ? null : EffectMat.kindOf(slot);
    szEl.textContent = (held
      ? (utility ? "utility sheet · " + GameDB.fmtName(held) + " · not opened" : "not opened: " + Oodle.entryBlockReason(held)) +
        (slot.layers.length ? " · " + slot.layers.length + "L" : "")
      : slot.missing
      ? "wants: " + guessSlotTexNames(slot) + (slot.layers.length ? " · " + slot.layers.length + "L" : "")
      : slot.size + "px" + (slot.smooth ? " · _n" : "") + (slot.layers.length ? " · " + slot.layers.length + "L" : "")) +
      (slot.camoTile ? " · camouflage tile" : effect ? " · " + effect : slot.noGeom ? " · 2D only" : "");
    // An effect sheet's slot (ROADMAP 4.13): the desc's flame or gun-flash material names it, so it
    // is the vehicle's own and it shows on the model — but on the effect quads, not the airframe.
    if (effect) d.title = "The vehicle's " + (effect === "jet flame" ? "jet-flame" : effect) + " sheet. Paint it in the 2-D view; it shows on the " +
      effect + " in 3-D with View ▸ Jet flames & gun flashes on. A skin of your own can carry it: the game shows a UserSkin's own flame sheet.";
    else if (slot.noGeom) d.title = slot.camoTile
      ? "Your scalable camouflage (Export ▸ Camo under skin ▸ My own pattern). It repeats over the whole vehicle, so the 2-D view shows it 3 × 3 and every stroke wraps at its edges; the model shows it through its own camouflage UV."
      : "This texture belongs to a part the game builds at runtime (tank tracks and the like) — it is not in the model file, so edit it in the 2D view. It still exports with the skin.";
    if (slot.missing) {
      szEl.style.color = "var(--muted)";
      szEl.title = held ? slot.cStem + ": " + Oodle.entryBlockReason(held) + "." +
          (utility ? " It is a utility sheet — a propeller mask or the like — and not part of the paint scheme." : "")
        : "Likely texture names for this slot — find them via ⋮ → from game files";
    }
    info.append(nmEl, szEl);
    d.appendChild(info);
    // ROADMAP 3.31: a cockpit or engine-flame sheet carries the gate's mark here too, so the rule
    // is visible where the painting starts and not only in the export list at the end.
    if (!slot.missing && Gate.bites.protected(slot)) {
      d.appendChild(Gate.mark("protected", () => { refreshSlotList(); }));
      d.title = effect ? d.title + "\nNot for a published skin — " + Gate.WHY.protected + "."
        : "Cockpit or engine-flame sheet — " + Gate.WHY.protected;
    }
    const menuBtn = document.createElement("button");
    menuBtn.textContent = "⋮";
    menuBtn.title = "Load, replace or remove this slot's textures";
    menuBtn.style.cssText = "padding:0 6px;font-size:12px;flex:0 0 auto";
    menuBtn.onclick = ev => {
      ev.stopPropagation();
      App.slotMenu = App.slotMenu === slot.id ? null : slot.id;
      selectSlot(slot.id);
    };
    d.appendChild(menuBtn);
    // Picking a slot is also how a decal held with nothing loaded finally lands — that is the step
    // the "in hand" status asked for, so it happens here and not inside selectSlot, which is called
    // from a dozen places (boot, part clicks, project load) that must not drop anything.
    d.onclick = () => { selectSlot(slot.id); DecalCarry.dropPending(); };
    el.appendChild(d);
    if (App.slotMenu === slot.id) el.appendChild(buildSlotMenu(slot));
  },
  // The slots with no texture yet, behind a fold that opens itself for the active one.
  missingFold(el, missing){
    if (missing.some(s => s === App.activeSlot || App.slotMenu === s.id)) App.missingOpen = true;
    const head = document.createElement("div");
    head.className = "rowitem partrow";
    head.style.cssText = "cursor:pointer;user-select:none;margin-top:4px;color:var(--muted)";
    head.textContent = (App.missingOpen ? "▾ " : "▸ ") + missing.length + " slot" + (missing.length === 1 ? "" : "s") + " without textures";
    head.title = "Materials that have no texture yet. Expand to see which texture names they are probably waiting for.";
    head.onclick = () => { App.missingOpen = !App.missingOpen; refreshSlotList(); };
    el.appendChild(head);
    if (App.missingOpen) for (const slot of missing) this.row(el, slot);
  },
};
function refreshSlotList(){
  const el = $("slotList");
  el.innerHTML = "";
  // The export list and the Channels panel are driven from the same state, so they are refreshed
  // here — and that has to happen BEFORE the "nothing loaded" early return, or clearing a project
  // left the Channels panel showing the thumbnails, statistics and edit buttons of a texture that
  // is no longer open.
  if (typeof updateExportList === "function") updateExportList();
  if (typeof refreshChannelPanel === "function") refreshChannelPanel();
  // ROADMAP 3.27(a): the list is long enough that opening it pushed everything below it far down
  // the sidebar, so it lives in a `.scrollbox` now — and drops out of one while it is a hint, the same
  // rule the vehicle list follows, because a 190 px box around one line of text is worse than no box.
  const wrap = $("slotListWrap");
  if (wrap) wrap.classList.toggle("empty", !App.slots.size);
  if (!App.slots.size) { el.innerHTML = '<div class="hint">Nothing loaded yet</div>'; return; }
  const sorted = [...App.slots.values()].sort((a, b) => (!!a.missing - !!b.missing) || (b.size - a.size));
  const textured = sorted.filter(s => !s.missing), missing = sorted.filter(s => s.missing);
  for (const slot of textured) SlotList.row(el, slot);
  if (missing.length) SlotList.missingFold(el, missing);
}
// ---------- The active slot's real texture bytes ----------
// Everything the exporter will actually write, laid out the way the file is: two sheets, four
// bytes each, each one viewable on its own and editable in place. The alpha row is the one that
// answers "why does my tank look flatly repainted" without the user having to know that the answer
// lives in an invisible channel.
// The Channels panel, as named steps on one object (ROADMAP 2.4): refreshChannelPanel was 81 lines
// with the per-sheet box, the per-channel cell and the alpha line inlined. Gated by t44's
// channels-panel fixture, captured before the split.
const ChanPanel = {
  // One sheet — the albedo or the surface map: its name and size, then its four raw channels.
  sheetBox(s, sh){
    const box = document.createElement("div");
    box.style.cssText = "margin-bottom:8px";
    const head = document.createElement("div");
    head.className = "sz";
    head.style.cssText = "display:flex;gap:6px;align-items:baseline;margin-bottom:3px";
    const nm = document.createElement("b");
    nm.textContent = sh.present ? (sh.name || (sh.k === "c" ? "albedo" : "surface")) : (sh.k === "c" ? "no albedo" : "no _n surface map");
    nm.style.color = sh.present ? "var(--text)" : "var(--muted)";
    const meta = document.createElement("span");
    meta.style.color = "var(--muted)";
    meta.textContent = sh.present ? sh.size + (sh.file ? " · " + sh.file : "") : "";
    head.append(nm, meta);
    head.title = sh.note;
    box.appendChild(head);
    if (!sh.present) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = sh.k === "n" ? "Load one with ⋮ → Replace… to edit gloss, metalness and bumps." : "";
      if (h.textContent) box.appendChild(h);
      return box;
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:5px";
    for (const letter of ["r", "g", "b", "a"]) row.appendChild(this.cell(s, sh.k + ":" + letter, letter));
    box.appendChild(row);
    return box;
  },
  // One raw channel: a 40-px preview, its letter and mean, a click to view it flat, a right-click
  // for the destructive actions.
  cell(s, key, letter){
    const info = RAW_CHANS[key];
    const cell = document.createElement("button");
    const isView = App.chanView === key;
    cell.style.cssText = "flex:1;padding:3px;display:flex;flex-direction:column;align-items:center;gap:2px;" +
      (isView ? "outline:2px solid var(--accent,#5b8cff);" : "");
    cell.title = info.meaning + " — click to view it flat on the model, right-click for actions";
    const prev = rawChanPreview(s, key);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 40;
    cv.style.cssText = "width:100%;height:auto;aspect-ratio:1;image-rendering:pixelated;border-radius:3px";
    if (prev) cv.getContext("2d").drawImage(prev.c, 0, 0, 40, 40);
    const cap = document.createElement("span");
    cap.style.cssText = "font-size:11px;color:var(--muted);line-height:1";
    const st = prev && prev.stats;
    cap.textContent = letter.toUpperCase() + (st ? " " + Math.round(st.mean) : "");
    cell.append(cv, cap);
    cell.onclick = () => setChannelView(isView ? "shaded" : key);
    cell.oncontextmenu = ev => { ev.preventDefault(); openRawChanMenu(s, key, cell); };
    return cell;
  },
  // the one line that explains a wrong-looking export
  alphaLine(s){
    const a = rawChanStats(s, "c:a");
    if (!a) return null;
    const d = document.createElement("div");
    d.className = "hint";
    d.style.marginTop = "2px";
    d.innerHTML = a.fullPct > 99
      ? "Alpha is fully opaque — normal for a hand-made skin; the vehicle's own sheet still supplies the wear in game."
      : "Paint mask: mean " + Math.round(a.mean) + " · " + a.fullPct.toFixed(0) + "% painted · " +
        a.zeroPct.toFixed(0) + "% bare material (rubber, tools, tracks, primer).";
    return d;
  },
};
function refreshChannelPanel(){
  const el = $("chanPanel");
  if (!el) return;
  el.innerHTML = "";
  const s = App.activeSlot;
  const secBase = $("secBaseColor");
  // vehicleClass lives in a later <script>; this runs once during boot before that evaluates.
  if (secBase && typeof vehicleClass === "function") {
    const cls = vehicleClass();
    secBase.style.display = (cls === "tank" || cls === "ship") ? "" : "none";
  }
  if (!s || s.missing) { el.innerHTML = '<div class="hint">' + (s ? "This slot has no texture yet." : "Select a texture slot.") + "</div>"; return; }
  const sheets = [
    { k: "c", name: s.cStem || s.id, present: !!s.baseC, size: s.baseC ? s.baseC.width + "×" + s.baseC.height : "",
      file: s.cFileName || "", note: "albedo — colour in RGB, coverage over the camouflage in alpha" },
    { k: "n", name: s.nStem || "", present: !!s.smooth, size: s.smooth ? s.smooth.width + "×" + s.smooth.height : "",
      file: s.nFileName || "", note: "surface — gloss, normal and metalness packed into one sheet" },
  ];
  for (const sh of sheets) el.appendChild(ChanPanel.sheetBox(s, sh));
  const line = ChanPanel.alphaLine(s);
  if (line) el.appendChild(line);
}
// Per-channel actions. Deliberately the plain destructive ones — a raw channel is the file's own
// bytes, not a layer — and every one of them goes through the undo stack.
function openRawChanMenu(slot, key, anchor){
  const info = RAW_CHANS[key];
  const menu = document.createElement("div");
  menu.style.cssText = "position:fixed;z-index:9998;background:var(--panel,#20242c);border:1px solid var(--border,#3a3f4a);border-radius:8px;padding:5px;box-shadow:0 10px 40px rgba(0,0,0,.5);min-width:230px";
  const close = () => { if (menu.parentNode) menu.remove(); document.removeEventListener("pointerdown", out, true); };
  const out = e => { if (!menu.contains(e.target)) close(); };
  const item = (label, desc, fn) => {
    const b = document.createElement("button");
    b.style.cssText = "display:block;width:100%;text-align:left;padding:5px 8px;background:none;border:none;border-radius:5px;cursor:pointer;color:var(--text)";
    b.onmouseenter = () => b.style.background = "var(--accent-dim,#2a3a4a)";
    b.onmouseleave = () => b.style.background = "none";
    b.innerHTML = "<div style='font-size:12px'>" + label + "</div>" + (desc ? "<div style='font-size:11px;color:var(--muted,#8a8f98)'>" + desc + "</div>" : "");
    b.onclick = () => { close(); fn(); };
    menu.appendChild(b);
  };
  const head = document.createElement("div");
  head.style.cssText = "font-size:11px;color:var(--muted,#8a8f98);padding:3px 8px 5px";
  head.textContent = info.label + " — " + info.meaning;
  menu.appendChild(head);
  item("View flat on the model", "", () => setChannelView(key));
  item("Fill with a value…", "One number across the whole channel", async () => {
    const v = await promptValue("Fill " + info.label + " with (0–255)", "255");
    if (v == null) return;
    const n = Math.max(0, Math.min(255, parseInt(v, 10) || 0));
    editRawChannel(slot, key, "fill " + info.label, () => n);
  });
  item("Invert", "255 − value", () => editRawChannel(slot, key, "invert " + info.label, v => 255 - v));
  item("Brightness / contrast…", "Scale and offset every value", async () => {
    const v = await promptValue("Multiply by, then add (e.g. “1.2, -10”)", "1.0, 0");
    if (v == null) return;
    const m = /(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(v);
    if (!m) { setStatus("Enter two numbers, e.g. 1.2, -10", "err"); return; }
    const k = parseFloat(m[1]), o = parseFloat(m[2]);
    editRawChannel(slot, key, "adjust " + info.label, x => x * k + o);
  });
  if (key === "c:a") {
    item("Restore the stock coverage mask", "Take the alpha back from the game's own texture", () => {
      const d = App.decoded.get(String(slot.cStem || "").toLowerCase());
      if (!d) { setStatus("The original texture for this slot is not loaded", "err"); return; }
      // Once a skin has been loaded over this slot, App.decoded holds the *skin's* pixels;
      // rememberStock() kept the game's own bytes, so decode those when they are there.
      let sw = d.width, sh = d.height, rgba = d.mips && d.mips[0] && d.mips[0].rgba;
      if (d.stockRaw) {
        try {
          const st = /\.tga$/i.test(d.stockName || "") ? TGA.parseTGA(d.stockRaw) : DDS.parseDDS(d.stockRaw);
          sw = st.width; sh = st.height; rgba = st.mips[0].rgba;
        } catch (e) { console.warn("stock coverage", e); }
      }
      if (!rgba) { setStatus("The original texture for this slot is not loaded", "err"); return; }
      const bw = slot.baseC.width, bh = slot.baseC.height;
      editRawChannel(slot, key, "restore coverage mask", (v, x, y) => {
        const sx = Math.min(sw - 1, (x * sw / bw) | 0), sy = Math.min(sh - 1, (y * sh / bh) | 0);
        return rgba[(sy * sw + sx) * 4 + 3];
      });
    });
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", out, true), 0);
}
// A tiny promise-based text prompt, so these actions do not need a dialog each.
function promptValue(msg, dflt){
  return new Promise(res => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--panel,#20242c);color:var(--text);border:1px solid var(--border,#3a3f4a);border-radius:10px;padding:16px 18px;min-width:280px";
    const p = document.createElement("div"); p.style.marginBottom = "10px"; p.textContent = msg;
    const inp = document.createElement("input"); inp.type = "text"; inp.value = dflt || ""; inp.style.width = "100%";
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:12px";
    let done = false;
    const close = v => { if (done) return; done = true; window.removeEventListener("keydown", esc); ov.remove(); res(v); };
    const esc = e => { if (e.key === "Escape") close(null); if (e.key === "Enter") close(inp.value); };
    const ok = document.createElement("button"); ok.className = "primary"; ok.textContent = "OK"; ok.onclick = () => close(inp.value);
    const no = document.createElement("button"); no.textContent = "Cancel"; no.onclick = () => close(null);
    row.append(no, ok);
    box.append(p, inp, row); ov.appendChild(box); document.body.appendChild(ov);
    window.addEventListener("keydown", esc);
    inp.focus(); inp.select();
  });
}
$("btnChanShaded").onclick = () => setChannelView("shaded");
// "Paint the whole vehicle a solid colour" — the one the CDK actually intends. It pins the
// camouflage the skin sits over instead of flooding the albedo, so the stock coverage mask, wear,
// dirt, panel lines and in-game decals all survive. Flooding the sheet with a fill is what makes a
// vehicle look plastic, and it is what people reach for because it is the obvious button.
$("btnPaintBase").onclick = () => {
  const col = $("baseColorPick").value;
  $("expCamoColor").value = col;
  $("expCamoBase").value = "color";
  if ($("expMode").value === "replace_tex") $("expMode").value = "auto";
  updateExportWarnings();
  clearCamoTexCache();
  rebuildMaterials(); needsRender(); draw2D();
  setStatus("Whole vehicle set to " + col + " — the albedo, its wear mask and all its detail are untouched; the .blk pins the camouflage under it", "ok");
};
$("baseColorPick").oninput = () => {
  if (camoBaseMode() !== "color") return;                  // only live-update once it is in use
  $("expCamoColor").value = $("baseColorPick").value;
  clearCamoTexCache(); rebuildMaterials(); needsRender(); draw2D(); updateCamoPinInfo();
};
setInterval(() => {
  const s = App.activeSlot;
  if (!s || !s.composite) return;
  if (stroke || c3drag || v2.draggingDecal) return;   // scaling a 4096² sheet down mid-stroke is not free
  if (s.thumbDirty && s.thumb) {
    s.thumbDirty = false;
    s.thumb.getContext("2d").drawImage(s.composite, 0, 0, 34, 34);
  }
  // layer previews repaint into the canvas already in the DOM — no list rebuild needed
  for (const L of layerLeaves(s.layers)) {
    if (L._thumb && L._thumbRev !== (s.thumbRev || 0)) layerThumb(L, s);
    // a mask stroke changes only the mask, so its own thumbnails are refreshed on the same tick
    if (L.mask) for (const k of MASK_THUMB_KEYS) if (L[k]) layerMaskThumb(L, k);
  }
}, 1200);

function selectSlot(id){
  App.activeSlot = App.slots.get(id) || null;
  const top = App.activeSlot && App.activeSlot.layers.length ? App.activeSlot.layers[App.activeSlot.layers.length - 1] : null;
  App.activeLayer = top;
  // fit2DNow, not fit2D: a new sheet is always framed, but that must not silently turn Fit back
  // on for someone who has zoomed in on purpose.
  refreshSlotList(); refreshLayerList(); refreshChannelPanel(); fit2DNow(); draw2D();
  updateBrushAvailability();
  // A selection belongs to one sheet, so moving to another one leaves it behind — and the panel has
  // to say so on the same tick, or it goes on showing four numbers and four live buttons for a
  // rectangle that is no longer anywhere (ROADMAP 4.10).
  SelectUI.sync();
}
// `App.activeLayer` is the NODE, not an index into `slot.layers` (ROADMAP 4.9). An index cannot
// address a layer inside a group at all — and it was already wrong without one. Measured
// 2026-08-26: select "c" of a, b, c, d and delete "a", and the selection silently becomes **"d"**,
// so the next brush stroke paints on a layer nobody chose; select the last of three and the same
// delete leaves the index past the end and the layer quietly deselected.
//
// The tree walk is what makes it safe rather than merely different: a node that has been deleted is
// still a perfectly good object, so "is it still in this slot" has to be asked rather than assumed.
function activeLayerObj(){
  const s = App.activeSlot;
  if (!s || !App.activeLayer) return null;
  return nodeOwner(s.layers, App.activeLayer) ? App.activeLayer : null;
}
// A projected decal spans several slots as one object — every stack-level operation on one of its
// layers has to reach the others, or the model and the layer list stop agreeing.
function layerFamily(L){
  if (L && L.proj && L.proj.id) { const sibs = projSiblings(L.proj.id); if (sibs.length) return sibs; }
  if (L && L.link) { const sibs = linkSiblings(L.link); if (sibs.length) return sibs; }
  const slot = slotOfLayer(L);
  return slot ? [{ slot, L }] : [];
}
