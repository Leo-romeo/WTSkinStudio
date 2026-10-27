// ---------- Channels: one layer stack for every map, not just the albedo ----------
// Substance's model. A layer declares which channel it writes: "color" is the albedo and stays
// the default, the rest drive the maps War Thunder packs into _n plus the wear mask that lives
// in the albedo's alpha. All of them composite through the same rules - blend mode, opacity,
// hand-painted mask, part scope, cross-texture link - so a smoothness layer is exactly as
// non-destructive as a paint layer, instead of the brush writing straight into the imported map.
const CHANNELS = [
  { id: "color",  label: "Colour",     tip: "The albedo, i.e. what the vehicle looks like." },
  { id: "smooth", label: "Smoothness", tip: "Gloss. War Thunder packs it into the _n red channel." },
  { id: "metal",  label: "Metalness",  tip: "Packed into the _n blue channel." },
  { id: "normal", label: "Normal",     tip: "Surface bumps: panel lines, rivets. Packed into _n green + alpha." },
  { id: "wear",   label: "Paint mask", tip: "The albedo's alpha: where paint covers the vehicle. White = painted, black = the bare material underneath (rubber, tool handles, tracks, primer). The game's condition slider scales it — that is what wear is." },
];
const CHAN_LABEL = {}, CHAN_TIP = {};
for (const c of CHANNELS) { CHAN_LABEL[c.id] = c.label; CHAN_TIP[c.id] = c.tip; }
const SURF_CHANS = ["smooth", "metal", "normal"];
function layerChan(L){ return (L && L.chan) || "color"; }
// ---- a layer offers its own channel's settings, and nothing else ----
// Every layer writes exactly one channel. The albedo has colour; smoothness, metalness, normal and
// the wear mask are single-value maps, so on those a fill takes a value and the blend modes that
// operate on hue and chroma are not offered at all — "color" or "luminosity" over a greyscale map
// is either a no-op or nonsense.
const COLOR_BLENDS = ["normal", "multiply", "overlay", "screen", "soft-light", "color", "luminosity"];
const GREY_BLENDS = ["normal", "multiply", "screen", "overlay", "soft-light"];
// "Pass through" is a GROUP's blend and nothing else's: it means "do not flatten these children",
// which is not a thing a layer can do. Offered last, because it is the one entry that changes what
// the group IS rather than how its result is mixed in (ROADMAP 4.9).
function layerBlends(L){
  const out = (layerChan(L) === "color" ? COLOR_BLENDS : GREY_BLENDS).slice();
  if (isGroup(L)) out.push("pass through");
  return out;
}
function hexOfGrey(v){
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h + h + h;
}
function greyOfHex(hex){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return 128;
  return Math.round(parseInt(m[1], 16) * .2126 + parseInt(m[2], 16) * .7152 + parseInt(m[3], 16) * .0722);
}
function chanBase(slot, ch){
  if (!slot) return null;
  if (ch === "color") return slot.baseC;
  if (ch === "wear") return slot.baseC ? ensureWearCanvas(slot) : null;
  return slot[ch] || null;                                    // smooth / metal / normal, from the _n
}
// Both of these are questions about LEAVES, wherever they sit in the tree (ROADMAP 4.9): a layer
// inside a group is still a layer of that channel, and one inside a HIDDEN group is not showing
// however visible it is itself — which is the distinction a flat array could not get wrong.
//
// They ask `LayerNode.contentOn` rather than `layerChan`, i.e. "does this node hold anything HERE"
// rather than "is this node's one tag this channel". The two answer the same today, because a
// layer carries exactly one content; they stop answering the same at 4.28(e), and this is the
// reading that stays right — a layer holding colour AND normal is on both channels, which a tag
// cannot say.
function chanLayers(slot, ch){ return layerLeaves(slot.layers).filter(L => LayerNode.contentOn(L, ch)); }
function chanHasLayers(slot, ch){ return visibleLeaves(slot.layers).some(L => LayerNode.contentOn(L, ch)); }
// What the channel actually looks like now: its own composite when layers touch it, the
// untouched base otherwise (so a slot nobody has layered costs nothing).
function chanOut(slot, ch){
  if (ch === "color") return slot.composite;
  const base = chanBase(slot, ch);
  if (!base) return null;
  return (chanHasLayers(slot, ch) && slot.chanC && slot.chanC[ch]) || base;
}
function chanEdited(slot, ch){
  const leaves = layerLeaves(slot.layers);
  const layered = leaves.some(L => LayerNode.contentOn(L, ch));
  if (ch === "color") return !!slot.cEdited || layered;
  if (ch === "wear") return !!slot.wearEdited || layered;
  return !!slot.nEdited || layered;
}
// Rebuild every channel a slot has layers on, then push the result at the 3D preview. `rect` is
// the area a stroke touched and every one of these passes honours it (ROADMAP 1.10) — the sheets
// are the same composite the albedo gets, addressed by channel (4.28(c)).
function compositeChannels(slot, rect){
  if (!slot) return;
  let surf = false;
  for (const ch of SURF_CHANS) if (Composite.sheet(slot, ch, rect).live) surf = true;
  Composite.sheet(slot, "wear", rect);
  coverageBytes(slot, rect);                                  // what export writes into the alpha
  refreshCoverageTexture(slot);                               // what the viewport blends with
  slot._covRev = (slot._covRev || 0) + 1;                     // invalidates the 2-D view's stencil
  slot._chanRev = (slot._chanRev || 0) + 1;
  // Compare needs no snapshot any more: the textures point straight at the sheets, so showing the
  // original is re-pointing them at chanBase instead of chanOut (ROADMAP 3.17, simplified by the
  // repack going away). `_hadSurfLayers` still matters — losing the last surface layer swaps the
  // texture's source back to the base sheet, which is a re-point rather than a region upload.
  if (surf || slot._hadSurfLayers) refreshSurfaceTextures(slot, surf ? rect : null);
  slot._hadSurfLayers = surf;
  if (App.chanView && App.chanView !== "shaded") refreshChannelTextures(slot);
  if (slot === App.activeSlot) draw2D();
}
// ---- flat channel view in 3D ----
// A texture is only judgeable when you can see it on its own, so the viewport can show any one
// channel unlit across the whole model, and in the shaded view each channel can be switched off
// like a layer to see what it is actually contributing.
function chanViewCanvas(slot, ch){
  if (RAW_CHANS[ch]) return rawChanCanvas(slot, ch);
  // Holding Compare shows this channel as it was imported, the same as the shaded view does
  // (ROADMAP 3.17). It has to be part of the cache key or the press would show a stale sheet.
  const src = App.compare ? chanBase(slot, ch) : chanOut(slot, ch);
  if (!src) return null;
  if (ch === "color") return src;
  const W = src.width, H = src.height;
  if (!slot.chanView) slot.chanView = {};
  let c = slot.chanView[ch];
  const rev = (slot._chanRev || 0) + "|" + (slot.thumbRev || 0) + "|" + (App.compare ? "o" : "e");
  if (c && c.width === W && c.height === H && c._rev === rev) return c;
  if (!c || c.width !== W || c.height !== H) c = slot.chanView[ch] = mkCanvas(W, H);
  c._rev = rev;
  const g = ctx2d(c);
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none";
  g.clearRect(0, 0, W, H);
  if (ch === "normal") {
    // rebuild Z so the map reads the way a normal map is meant to look
    const d = ctx2d(src).getImageData(0, 0, W, H);
    const o = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const nx = d.data[i*4] / 127.5 - 1, ny = d.data[i*4+1] / 127.5 - 1;
      o.data[i*4] = d.data[i*4]; o.data[i*4+1] = d.data[i*4+1];
      o.data[i*4+2] = Math.round((Math.sqrt(Math.max(0, 1 - nx*nx - ny*ny)) + 1) * 127.5);
      o.data[i*4+3] = 255;
    }
    g.putImageData(o, 0, 0);
  } else {
    g.drawImage(src, 0, 0);                                   // already greyscale
  }
  return c;
}
function refreshChannelTextures(slot){
  if (!slot.chanTex) slot.chanTex = {};
  const ch = App.chanView;
  if (!ch || ch === "shaded") return;
  // The colour channel IS the composite the shaded view already has on the GPU — reuse that
  // texture rather than uploading a second copy of the sheet on every stroke frame.
  if (ch === "color") { slot.chanTex.color = slot.tex; needsRender(); return; }
  const c = chanViewCanvas(slot, ch);
  if (!c) return;
  let t = slot.chanTex[ch];
  if (!t || t.image !== c) { if (t) t.dispose(); t = slot.chanTex[ch] = new THREE.CanvasTexture(c); t.anisotropy = 4; }
  t.encoding = THREE.LinearEncoding;
  t.needsUpdate = true;
  needsRender();
}
function disposeChannelTextures(slot){
  if (!slot.chanTex) return;
  for (const k of Object.keys(slot.chanTex)) { const t = slot.chanTex[k]; if (t && t !== slot.tex) t.dispose(); }
  slot.chanTex = {};
}
// `auto` says the switch came from applyAutoChanView rather than from the user. Any other caller is
// a manual pick — the select, a channel cell, the context menu, the Shaded button — and turns Auto
// back off, which is the rule that makes "smart" acceptable instead of a mode that fights you.
function setChannelView(ch, auto){
  if (!auto) App.chanAuto = false;
  App.chanView = ch;
  for (const s of App.slots.values()) refreshChannelTextures(s);
  if (ch !== "levels") LevelView.dropLevelsTex();            // a sheet-sized chain each: only while shown (4.58 (b))
  rebuildMaterials();
  const b = $("chanViewSel"), want = App.chanAuto ? "auto" : ch;
  if (b && b.value !== want) b.value = want;
  $("chanToggles").style.display = ch === "shaded" ? "" : "none";
  setStatus((auto ? "Auto view — " : "") +
    (ch === "shaded" ? "Shaded" + (auto ? "" : " view")
                     : (chanViewLabel(ch) || ch) + " — flat, unlit, exactly what is in the texture"), "ok");
  refreshChannelPanel();
  draw2D();
}
// ROADMAP 3.16 — the 3-D view follows the layer you are on. A metalness or smoothness edit is
// nearly invisible in the shaded preview, so selecting one of those layers used to mean switching
// the view by hand and switching it back on the next layer. Colour and wear read correctly shaded;
// the three surface maps do not, so those are the ones that switch.
//
// Called from refreshLayerProps, which is where the active layer actually changes.
function applyAutoChanView(){
  if (!App.chanAuto) return;
  const L = activeLayerObj();
  // `workingChan` and not `layerChan` since ROADMAP 4.34(a). A layer can carry several channels,
  // so "what is this layer" and "what am I looking at in it" stopped being the same question at
  // 4.28(e) — asking the first one put the view on a multi-channel layer's PRIMARY slot while the
  // brush was writing another, which is a view that follows something the user is not doing.
  const ch = L ? LayerNode.workingChan(L) : "color";
  const want = ch === "color" || ch === "wear" ? "shaded" : ch;
  if (App.chanView !== want) setChannelView(want, true);
}
function chanViewLabel(ch){
  if (ch === "levels") return "Mip levels — each level one colour, so the colour is the level the GPU samples there";
  if (RAW_CHANS[ch]) return RAW_CHANS[ch].label;
  return CHAN_LABEL[ch] ? CHAN_LABEL[ch] + " channel" : null;
}

// ---------- The texture's OWN channels ----------
// The channel stack above is semantic — "smoothness", "metalness", "wear" — because that is how a
// skin is authored. But a War Thunder texture is a file with four byte channels, and which byte
// means what is fixed by the shader, not by us:
//
//     <name>_c   R,G,B = colour            A = coverage over the scalable camouflage
//     <name>_n   R = inverted roughness    G = normal Y    B = metalness    A = normal X
//                (X left/right, Y up/down with high G toward the bottom row: ROADMAP 1.24, NSheet)
//
// Every one of those is reachable here on its own: viewable flat, measurable, and directly
// fillable / invertible / adjustable. The albedo's ALPHA is the one that matters most and the one
// that was invisible — a sheet whose coverage mask has been flattened to 255 looks identical to a
// correct one in every RGB view, and ships a vehicle that is flatly repainted and permanently
// clean. Now it is a channel you can look at.
const RAW_CHANS = {
  "c:r": { sheet: "c", i: 0, label: "Albedo R",      meaning: "Red" },
  "c:g": { sheet: "c", i: 1, label: "Albedo G",      meaning: "Green" },
  "c:b": { sheet: "c", i: 2, label: "Albedo B",      meaning: "Blue" },
  "c:a": { sheet: "c", i: 3, label: "Albedo A",      meaning: "Paint mask — white is painted, black is the bare material showing through" },
  "n:r": { sheet: "n", i: 0, label: "Surface R",     meaning: "Inverted roughness (gloss)" },
  "n:g": { sheet: "n", i: 1, label: "Surface G",     meaning: "Normal Y — the up/down slope, lighter leaning toward the bottom" },
  "n:b": { sheet: "n", i: 2, label: "Surface B",     meaning: "Metalness" },
  "n:a": { sheet: "n", i: 3, label: "Surface A",     meaning: "Normal X — the left/right slope, lighter leaning right" },
};
// Where each raw channel really lives in this app's per-slot storage, so reading and writing one
// touches the same pixels the exporter will pack.
//   src   -> a canvas whose channel `at` holds it, or "cov" for the coverage bytes
function rawChanStore(slot, key){
  const r = RAW_CHANS[key];
  if (!slot || !r) return null;
  if (r.sheet === "c") {
    if (!slot.baseC) return null;
    if (r.i === 3) return { kind: "cov", w: slot.baseC.width, h: slot.baseC.height };
    return { kind: "canvas", canvas: slot.baseC, at: r.i, w: slot.baseC.width, h: slot.baseC.height };
  }
  if (!slot.smooth) return null;
  const W = slot.smooth.width, H = slot.smooth.height;
  if (r.i === 0) return { kind: "canvas", canvas: slot.smooth, at: 0, grey: true, w: W, h: H };
  if (r.i === 2) return { kind: "canvas", canvas: slot.metal, at: 0, grey: true, w: W, h: H };
  return { kind: "canvas", canvas: slot.normal, at: r.i === NSheet.X ? 0 : 1, w: W, h: H };   // the sheet is X red, Y green
}
function rawChanBytes(slot, key){
  const st = rawChanStore(slot, key);
  if (!st) return null;
  if (st.kind === "cov") {
    const n = st.w * st.h;
    if (slot.covBase && slot.covBase.length === n) return { data: new Uint8Array(slot.covBase), w: st.w, h: st.h };
    return { data: new Uint8Array(n).fill(255), w: st.w, h: st.h };
  }
  const d = ctx2d(st.canvas).getImageData(0, 0, st.w, st.h).data;
  const out = new Uint8Array(st.w * st.h);
  for (let i = 0, n = st.w * st.h; i < n; i++) out[i] = d[i*4 + st.at];
  return { data: out, w: st.w, h: st.h };
}
// One greyscale sheet per raw channel, cached against the slot's revision counters.
function rawChanCanvas(slot, key){
  // ---- keyed on the SHEET, not on the composite counters (ROADMAP 1.14) ----
  // These views read the slot's own `baseC` / `smooth` / `metal` / `normal` — the imported sheets —
  // and the key used to carry `_chanRev` and `thumbRev`, which bump on every channel and every
  // albedo composite. So dragging a decal rebuilt, once per frame, a canvas whose source **cannot
  // have changed**: a whole-sheet getImageData, a per-texel loop and a whole-sheet putImageData,
  // ~67 MB each way at 4096². Now the key is the source canvas's identity and its own `_rev`, which
  // `bakeAction` / `bakeRegionAction` bump — and every destructive write to these sheets goes
  // through one of those, while a texture replace or a resize hands over a different canvas object
  // and is caught by the identity half.
  const st = rawChanStore(slot, key);
  if (!st) return null;
  const rev = st.kind === "cov" ? "cov" + (slot._covRev || 0) : "s" + (st.canvas._rev || 0);
  slot._rawView = slot._rawView || {};
  let c = slot._rawView[key];
  if (c && c.width === st.w && c.height === st.h && c._rev === rev && c._src === (st.canvas || null)) return c;
  const got = rawChanBytes(slot, key);
  if (!got) return null;
  c = slot._rawView[key];
  c && (c._src = st.canvas || null);
  if (!c || c.width !== got.w || c.height !== got.h) c = slot._rawView[key] = mkCanvas(got.w, got.h);
  c._rev = rev; c._src = st.canvas || null;
  const img = new ImageData(got.w, got.h);
  for (let i = 0, n = got.w * got.h; i < n; i++) {
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = got.data[i];
    img.data[i*4+3] = 255;
  }
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}
// ---- the panel's thumbnail + numbers, WITHOUT reading a full sheet ----
// `getImageData` on an accelerated canvas transfers the whole surface whatever rectangle you ask
// for — ~520 ms at 8192² — and this panel refreshes with the slot list, i.e. constantly. So the
// preview is built by letting the GPU downscale (`drawImage` into a 96² scratch) and reading only
// that, and the coverage channel is measured straight off `covBase`, which is already plain bytes.
// The full-resolution path (rawChanBytes) is left for the flat 3-D view and for an actual edit.
const RAWPREV = 96;
function rawChanPreview(slot, key){
  const st = rawChanStore(slot, key);
  if (!st) return null;
  // Same reasoning as rawChanCanvas above: key on the sheet this reads, not on counters that tick
  // whenever anything composites (ROADMAP 1.14).
  const rev = (st.kind === "cov" ? "cov" + (slot._covRev || 0) : "s" + (st.canvas._rev || 0)) + "|" + st.w + "x" + st.h;
  slot._rawPrev = slot._rawPrev || {};
  const hit = slot._rawPrev[key];
  if (hit && hit.rev === rev) return hit;
  let vals, pw, ph;
  if (st.kind === "cov") {
    const n = st.w * st.h;
    const cov = (slot.covBase && slot.covBase.length === n) ? slot.covBase : null;
    pw = Math.min(RAWPREV, st.w); ph = Math.min(RAWPREV, st.h);
    vals = new Uint8Array(pw * ph);
    for (let y = 0; y < ph; y++) {
      const sy = Math.min(st.h - 1, (y * st.h / ph) | 0);
      for (let x = 0; x < pw; x++) vals[y * pw + x] = cov ? cov[sy * st.w + Math.min(st.w - 1, (x * st.w / pw) | 0)] : 255;
    }
  } else {
    pw = Math.min(RAWPREV, st.w); ph = Math.min(RAWPREV, st.h);
    const sc = rawChanPreview._s && rawChanPreview._s.width === pw && rawChanPreview._s.height === ph
      ? rawChanPreview._s : (rawChanPreview._s = mkCanvas(pw, ph));
    const g = ctx2d(sc);
    g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.filter = "none";
    g.drawImage(st.canvas, 0, 0, st.w, st.h, 0, 0, pw, ph);
    g.globalCompositeOperation = "source-over";
    const d = g.getImageData(0, 0, pw, ph).data;
    vals = new Uint8Array(pw * ph);
    for (let i = 0, n = pw * ph; i < n; i++) vals[i] = d[i*4 + st.at];
  }
  // A thumbnail canvas of the sampled values, and the numbers taken from the same sample. The
  // coverage percentages are exact (no interpolation went into covBase); the rest are estimates,
  // which is all the panel shows for them.
  const c = (hit && hit.c && hit.c.width === pw && hit.c.height === ph) ? hit.c : mkCanvas(pw, ph);
  const img = new ImageData(pw, ph);
  let sum = 0, zero = 0, full = 0, mn = 255, mx = 0;
  for (let i = 0, n = pw * ph; i < n; i++) {
    const v = vals[i];
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v;
    img.data[i*4+3] = 255;
    sum += v; if (v === 0) zero++; else if (v === 255) full++;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  ctx2d(c).putImageData(img, 0, 0);
  const n = pw * ph;
  const rec = { rev, c, stats: { min: mn, max: mx, mean: sum / n, zeroPct: 100 * zero / n, fullPct: 100 * full / n, w: st.w, h: st.h } };
  slot._rawPrev[key] = rec;
  return rec;
}
function rawChanStats(slot, key){ const p = rawChanPreview(slot, key); return p ? p.stats : null; }
// Write a raw channel back, as one undoable step. `fn(v, x, y)` returns the new byte.
function editRawChannel(slot, key, label, fn){
  const st = rawChanStore(slot, key);
  const got = rawChanBytes(slot, key);
  if (!st || !got) { setStatus("That channel is not loaded for this slot", "err"); return false; }
  const { w, h } = got;
  const next = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) next[i] = Math.max(0, Math.min(255, Math.round(fn(got.data[i], x, y))));
  if (st.kind === "cov") {
    // covBase is plain bytes, so bakeAction's canvas snapshots do not carry it — push its own
    // undo entry the way "replace base texture" does, and drop the cached wear rendering.
    const before = { cov: slot.covBase, wearC: slot.wearC };
    const after = { cov: next, wearC: null };
    const apply = stt => () => {
      slot.covBase = stt.cov; slot.wearC = stt.wearC;
      slot._covRev = (slot._covRev || 0) + 1;
      slot._rawView = null; slot._rawPrev = null;
      refreshCoverageTexture(slot); scheduleComposite(slot); draw2D(); refreshChannelPanel();
    };
    withUndoBatch(label, () => {
      pushAction(label, apply(before), apply(after), next.length * 2);
      apply(after)();
    });
    slot.cEdited = true;
    updateExportList();
    return true;
  }
  const target = st.canvas;
  bakeAction(label, [target], () => {
    const g = ctx2d(target);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0, n = w * h; i < n; i++) {
      if (st.grey) { img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = next[i]; }
      else img.data[i*4 + st.at] = next[i];
      img.data[i*4+3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, () => {
    slot._rawView = null; slot._rawPrev = null;
    if (RAW_CHANS[key].sheet === "n") { slot.nEdited = true; refreshSurfaceTextures(slot); }
    else { slot.cEdited = true; scheduleComposite(slot); }
    slot._chanRev = (slot._chanRev || 0) + 1;
    draw2D(); refreshChannelPanel(); updateExportList();
  });
  return true;
}


