// ---------- Brush UI ----------
// Only offer modes that can actually do something to the vehicle and slot in front of you:
// surface tools need an _n map, the wear mask is a ground/naval concept, colour needs a paint
// layer. On top of that, a selected layer owns exactly one channel — with a Metalness layer
// active the colour brush is not "a tool that happens to do nothing", it is the wrong tool, so
// it is switched off with a message naming the channel you are in.
// Disabled buttons say why instead of silently failing on the first stroke — and none is hidden, so
// the grid is the same ten cells on every vehicle (tools/t133_fit.mjs).
function updateBrushAvailability(){
  const s = App.activeSlot, L = activeLayerObj();
  const cls = vehicleClass();
  let firstEnabled = null, activeStillOk = false, activeHeld = false;
  for (const b of document.querySelectorAll("#brushModes [data-bm]")) {
    const need = b.dataset.need;
    const forCls = b.dataset.cls;
    const mChan = Tool.chanOf(b.dataset.bm);
    // Ask the one place that owns the answer whether this button is a point in the space at all
    // (ROADMAP 4.28(d) put it there, 4.40 made the panel use it). `data-bm` is markup, so a
    // renamed or mistyped mode used to reach here as a live button whose click did nothing;
    // `Tool.resolve` names every mode there is and refuses the rest in a sentence.
    const pt = Tool.MODES[b.dataset.bm];
    const r = pt ? Tool.resolve(pt.tool, pt.chan, pt.target) : { err: "There is no " + Tool.q(b.dataset.bm) + " tool." };
    let why = "", byLayer = false;
    // What the SELECTED layer holds on the channel THIS tool writes — the question 4.28(e) makes
    // askable. Before it, a layer wrote one channel and any other tool was refused against that one
    // channel ("“Gloss” writes the Smoothness channel — this tool writes Colour"), which is the rule
    // that made "a layer is a type you pick before it exists" true in the UI as well as in the data.
    // A tool now addresses its own slot inside the layer and creates it on the first stroke, so the
    // only things that still disable it are what that slot already holds.
    const mine = L && mChan && !isGroup(L) ? LayerNode.contentOn(L, mChan) : null;
    if (r.err) why = r.err;
    // Off and saying why, not hidden (2026-10-10): hiding the Wear mask on an aircraft moved six tools
    // up a cell of the grid, so every tool below it was somewhere else on a tank. Nothing else hides.
    else if (forCls && App.geomData && !forCls.split(" ").includes(cls))
      why = "Only a ground or naval skin has a wear mask — its alpha is how much of the player's camouflage it covers. " +
        (cls === "air" ? "An aircraft" : "This vehicle") + " has none";
    else if (!s && need) why = "Select a texture slot first";
    // Every surface brush writes to a layer, and that layer composites over the map unpacked from
    // the slot's _n. With no _n there is no base to paint over, so the tool has nowhere to go.
    else if (need === "n" && s && !s.smooth)
      why = "This slot has no _n surface map loaded — load one under Textures ▸ Replace… or Find in game files";
    else if (need === "albedo" && s && s.missing) why = "This slot has no albedo texture yet";
    // A camouflage tile's alpha is not a wear mask — it ships the camouflage's own (4.50 (6)).
    else if (s && s.camoTile && mChan === "wear") why = "A camouflage tile has no wear mask — it carries the alpha of the camouflage it replaces";
    // "paintable" = the slot is created on the first stroke if the layer has none; only content
    // that cannot take a brush stroke disables the tool.
    else if (need === "paintable" && L && isGroup(L) && (byLayer = true))
      why = "“" + L.name + "” is a group — select a layer inside it, or add one";
    else if (need === "paintable" && mine && mine.proj && (byLayer = true))
      why = "Projected decals are rebuilt when they move — duplicate the layer (⧉) to paint on it";
    else if (need === "paintable" && mine && mine.derived && (byLayer = true))
      why = "“" + L.name + "”'s " + Tool.chanWord(mChan) + " is derived from its Look and is rebuilt whenever the decal moves — duplicate the layer (⧉) to paint on a copy";
    else if (need === "paintable" && mine && mine.kind !== "paint" && (byLayer = true))
      why = "“" + L.name + "” holds " + LayerNode.wordFor(mine) + " on the " + Tool.chanWord(mChan) +
        " channel — add a paint layer, or convert that content in the layer's channel strip";
    else if (need === "paint" && (!mine || mine.kind !== "paint" || mine.derived) && (byLayer = true)) why = "Select a paint layer to erase from";
    else if (need === "paint" && mine.proj && (byLayer = true)) why = "Projected decals are rebuilt when they move — duplicate the layer (⧉) to paint on it";
    else if (need === "layer" && (!L || isGroup(L) || !LayerNode.channelsOf(L).length) && (byLayer = true)) why = "Select a paint, image or fill layer";
    const off = !!why;
    b.disabled = off;
    b.dataset.why = off ? why : "";
    if (off) b.title = why;
    else if (b.dataset.tip) b.title = b.dataset.tip;
    if (!off) { if (!firstEnabled) firstEnabled = b; if (b.dataset.bm === App.brush.mode) activeStillOk = true; }
    else if (byLayer && b.dataset.bm === App.brush.mode) activeHeld = true;
  }
  // Never leave the user on a mode that cannot paint — QUIETLY. The second argument skips
  // `selectLayerForBrush`, which can open a native `confirm` ("this group has no smoothness layer,
  // add one?"), and this function runs from every `refreshLayerList`. A modal dialog reached by
  // *drawing a panel* is a dialog nobody asked for; it also deadlocked two headless tests, which is
  // how it was found. Choosing a tool by hand still asks, because there the question is the point.
  // …but only when the SLOT or the vehicle rules the tool out (no _n, no albedo, an aircraft's wear
  // mask). When it is the selected LAYER that cannot take it — an image decal, a projected decal, a
  // group — the tool stays in hand, off and saying why, and is live again the moment a paint layer
  // is selected. Reported 2026-10-17: pasting an image selected its decal layer, Color was off on
  // it, and the brush quietly became Smoothness (the first tool that only needs an _n) — the
  // Smoothness chip lit up on the decal and the panel showed that tool's options, greyed. The jump
  // only ever took away the tool the user had picked.
  if (!activeStillOk && !activeHeld && firstEnabled) applyBrushMode(firstEnabled.dataset.bm, true);
  const cur = document.querySelector('#brushModes [data-bm="' + App.brush.mode + '"]');
  const hint = $("brushHint");
  if (cur && cur.disabled) { hint.style.display = ""; hint.textContent = cur.dataset.why; }
  else if (!firstEnabled) { hint.style.display = ""; hint.textContent = "No tool can write here yet — select a texture slot and a layer."; }
  else hint.style.display = "none";
  syncBrushOptionRows();
}
// Programmatic mode change: no side effect on the painting switch, because this is also how
// updateBrushAvailability moves off a tool that cannot write to the layer you just selected —
// and that must not start painting behind the user's back.
function setBrushMode(m){ applyBrushMode(m); }
// ---------- Picking a tool inside a group ----------
// Requested 2026-08-26, and it is what makes a decal's group usable rather than something to fight:
// with the group selected — or with any layer inside it — choosing the Smoothness brush should put
// you on the group's smoothness layer, not refuse because the group is not a paint layer.
//
// Only ever selects INSIDE the group you are already in. Reaching across the slot to whatever
// layer of that channel happens to exist would be a different, much less predictable behaviour:
// two decals both with gloss, and picking a brush would jump you into one of them at random.
function brushGroupContext(){
  const s = App.activeSlot, L = App.activeLayer;
  if (!s || !L) return null;
  if (isGroup(L) && nodeOwner(s.layers, L)) return { slot: s, group: L };
  const g = groupOwning(s.layers, L);
  return g ? { slot: s, group: g } : null;
}
// Returns true when it has dealt with the tool change itself.
function selectLayerForBrush(mode){
  const ctx = brushGroupContext();
  if (!ctx || mode === "mask" || mode === "none") return false;
  const ch = Tool.chanOf(mode);
  if (!ch) return false;
  const cur = activeLayerObj();
  // "Already right" is now about the SLOT, not the layer: a layer carrying colour and smoothness is
  // already the right home for either brush, and jumping out of it to a sibling would undo the one
  // thing (e) is for.
  const takes = c => c && c.kind === "paint" && !c.proj && !c.derived;
  const mineNow = cur && !isGroup(cur) ? LayerNode.contentOn(cur, ch) : null;
  if (takes(mineNow)) return false;
  const kids = layerLeaves(ctx.group.children);
  // `!c.derived` since 4.28(f): a decal's response is content in the decal's own node, so this
  // finder can now see it — and landing the Smoothness brush on a decal's gloss is landing it on
  // pixels the next move overwrites. `paintTarget` refuses that stroke; this stops walking you
  // into it in the first place.
  const hit = kids.find(x => takes(LayerNode.contentOn(x, ch)));
  if (hit) {
    App.activeLayer = hit;
    refreshLayerList();
    setStatus("Switched to “" + hit.name + "” in “" + ctx.group.name + "” — the layer this tool writes to", "ok");
    return true;
  }
  // Nothing in the group takes this tool. Asking is the point: silently making a layer is how a
  // stack fills up with things nobody chose, and silently refusing is the no-op §4 forbids.
  const label = (CHAN_LABEL[ch] || ch);
  if (!confirm("“" + ctx.group.name + "” has no " + label.toLowerCase() + " layer.\n\nAdd one to the group?")) {
    setStatus("“" + ctx.group.name + "” has no " + label.toLowerCase() + " layer — the tool has nothing in this group to write to", "err");
    return true;
  }
  const base = chanBase(ctx.slot, ch) || ctx.slot.composite;
  if (!base) { setStatus("This slot has no sheet for the " + label.toLowerCase() + " channel yet", "err"); return true; }
  const L = LayerNode.of({ type: "paint", chan: ch === "color" ? undefined : ch, name: label,
    canvas: mkCanvas(base.width, base.height), visible: true, opacity: 1, blend: "normal" });
  const add = () => { ctx.group.children.push(L); App.activeLayer = L; scheduleComposite(ctx.slot); scheduleChannels(ctx.slot); refreshLayerList(); };
  pushAction("add layer to group", () => {
    const o = nodeOwner(ctx.slot.layers, L);
    if (o) o.list.splice(o.i, 1);
    App.activeLayer = ctx.group;
    scheduleComposite(ctx.slot); refreshLayerList();
  }, add);
  add();
  setStatus("Added “" + L.name + "” to “" + ctx.group.name + "”", "ok");
  return true;
}
// ---------- one set of settings per tool (ROADMAP 3.22) ----------
// `App.brush` is a single object and every tool wrote to it, so picking up a second tool destroyed
// the first one's setup — reported as "brushes settings as size opacity etc should be per brush
// settings and remembered". The live object stays exactly what it was, because the stroke path
// reads it on every stamp; what changes is that switching tools saves the outgoing one's row and
// loads the incoming one's.
const BrushTools = {
  // Where a tool STARTS, the first time it is picked up. This table used to be applied on every
  // selection, which is why Panel line's depth went back to 40 each time you reached for it: it was
  // written as a sensible starting point and behaved as a reset. It is a seed now — read once.
  SEED: { mask: 0, height: 40, smooth: 160, metal: 220, wear: 200 },
  // Colour is deliberately NOT per tool: one colour across the tools is what people expect, and
  // only one tool reads it.
  FIELDS: [
    { k: "size",     el: "brushSize",     scale: 1 },
    { k: "opacity",  el: "brushOpacity",  scale: 100 },
    { k: "hardness", el: "brushHardness", scale: 100 },
    { k: "value",    el: "brushValue",    scale: 1 },
    { k: "spacing",  el: "brushSpacing",  scale: 100 },
    // ROADMAP 4.50 (4) + 6.4: a brush's character is its own. A 20 % flow spray for weathering and a
    // 100 % flow marker for camouflage are two tools set up once, not one retuned at every switch —
    // and a pen pressing the eraser bigger need not press the colour brush bigger too.
    { k: "flow",     el: "brushFlow",     scale: 100 },
    { k: "build",    el: "brushBuild",    check: true },
    { k: "pSize",    el: "penSize",       check: true },
    { k: "pFlow",    el: "penFlow",       check: true },
    // ROADMAP 4.50 (10): the tip, and how each dab varies, are the tool's as well — a scattered chip
    // for the silver weathering brush and a plain round one for the camouflage are set up once.
    { k: "tip",      el: "brushTip",      pick: true },
    { k: "sizeJit",  el: "brushSizeJit",  scale: 100 },
    { k: "flowJit",  el: "brushFlowJit",  scale: 100 },
    { k: "scatter",  el: "brushScatter",  scale: 100 },
    { k: "angle",    el: "brushAngle",    scale: 1 },
    { k: "angleJit", el: "brushAngleJit", scale: 100 },
    { k: "follow",   el: "brushFollow",   check: true },
  ],
  field(k){ return BrushTools.FIELDS.find(f => f.k === k) || null; },
  // The build's own defaults, read off the markup rather than written down a second time — the same
  // reasoning as 3.12's captured defaults, and `defaultValue` is the attribute, so it says the same
  // thing whatever the slider currently shows and whenever it is asked. A box's is `defaultChecked`,
  // and a select's is its `defaultSelected` option.
  fresh(m){
    const o = {};
    for (const f of BrushTools.FIELDS) {
      const el = $(f.el);
      o[f.k] = f.check ? !!(el && el.defaultChecked)
        : f.pick ? (el ? ([...el.options].find(x => x.defaultSelected) || el.options[0] || { value: "" }).value : "")
        : el ? +el.defaultValue / f.scale : 0;
    }
    if (m in BrushTools.SEED) o.value = BrushTools.SEED[m];
    return o;
  },
  // A row stored before a field existed — every row saved before Flow, 2026-09-25 — takes the build's
  // default for it, rather than whatever the tool put down last happened to leave in App.brush.
  row(m){
    if (!App.brushTools) App.brushTools = {};
    const r = App.brushTools[m] || (App.brushTools[m] = BrushTools.fresh(m));
    if (BrushTools.FIELDS.some(f => !(f.k in r))) {
      const d = BrushTools.fresh(m);
      for (const f of BrushTools.FIELDS) if (!(f.k in r)) r[f.k] = d[f.k];
    }
    return r;
  },
  // What the tool being put down was set to. Values the live object does not carry yet are left at
  // the seed rather than written as undefined — `spacing` is not in the initial App.brush.
  save(m){
    if (!m) return;
    const o = BrushTools.row(m);
    for (const f of BrushTools.FIELDS) {
      const v = App.brush[f.k];
      if (f.check ? typeof v === "boolean" : f.pick ? typeof v === "string" : typeof v === "number" && isFinite(v)) o[f.k] = v;
    }
  },
  // ...and what the tool being picked up was left at.
  load(m){
    const o = BrushTools.row(m);
    for (const f of BrushTools.FIELDS) BrushTools.put(f, o[f.k]);
    brushStamp._key = null;
    refreshBrushCursor();
  },
  // One setting into its control and the live brush. The slider is written first and the state read
  // back OUT of it, so a stored value outside a slider's range ends up clamped in both rather than in
  // one — which is the shape of bug 3.12 found in the old 200% spacing. A value of the wrong type is
  // left alone. The tip is the one select, and goes through `BrushPanel.setTip`, which checks it
  // against the library. The prefs rows for 4.50 (10) come through here too.
  put(f, v){
    if (!f) return;
    if (f.pick) { if (typeof v === "string") BrushPanel.setTip(v); return; }
    const el = $(f.el);
    if (f.check) {
      if (typeof v !== "boolean") return;
      if (el) el.checked = v;
      App.brush[f.k] = v;
      return;
    }
    if (typeof v !== "number" || !isFinite(v)) return;
    if (!el) { App.brush[f.k] = v; return; }
    el.value = Math.round(v * f.scale);
    App.brush[f.k] = +el.value / f.scale;
    const lab = $(f.el + "Val");
    if (lab) lab.textContent = el.value;
  },
};
function applyBrushMode(m, keepValue){
  if (!m) return;
  document.querySelectorAll("[data-bm]").forEach(x => x.classList.toggle("active", x.dataset.bm === m));
  if (m !== App.brush.mode) BrushTools.save(App.brush.mode);
  // One assignment, three axes: `mode` is an accessor over tool / channel / target (ROADMAP
  // 4.28(d)). An unknown name changes nothing rather than leaving the axes describing a tool that
  // does not exist, so the rest of this function must not assume `m` took.
  App.brush.mode = m;
  if (App.brush.mode !== m) { setStatus("There is no “" + m + "” tool", "err"); return; }
  brushStamp._key = null;
  // With a group selected — or with any layer inside one — pick up the layer this tool actually
  // writes to, rather than leaving the user on a container no brush can paint (requested
  // 2026-08-26). `keepValue` is set by createPaintLayerFor, which is already making the layer.
  if (!keepValue) selectLayerForBrush(m);
  syncBrushOptionRows();
  BrushTools.load(m);
  draw2D();
}
document.querySelectorAll("[data-bm]").forEach(b => b.dataset.tip = b.title);
document.querySelectorAll("[data-bm]").forEach(b => b.onclick = () => {
  if (b.disabled) return;
  applyBrushMode(b.dataset.bm);
  if (!App.paint3d) setPaint3d(true);            // picking up a tool is asking to paint with it
});
// Only the options that mean something for the current tool. A colour has no meaning on a
// greyscale map, and the value slider has none for the colour brush or the eraser; showing both
// at once is what made a "Metalness fill" look as if it wanted a colour.
function syncBrushOptionRows(){
  const m = App.brush.mode;
  $("rowColor").style.display = m === "color" ? "" : "none";
  $("rowValue").style.display = ["smooth", "metal", "height", "mask", "wear"].includes(m) ? "" : "none";
  const lab = $("rowValue").querySelector("label");
  if (lab) lab.textContent = m === "mask" ? "Mask" : m === "height" ? "Depth" : "Value";
  const ph = $("pickHint");
  if (ph) ph.textContent = m === "mask" ? "Alt-paint reveals" : "Alt-click picks";
  $("rowClone").style.display = App.brush.tool === "clone" ? "" : "none";
  // A Panel line stroke is a height field that ADDS, so it always builds up and Opacity is already
  // its per-dab depth: Flow and Build up would be a second knob on the same thing (4.50 (4) + 6.4).
  const field = App.brush.tool === "height";
  $("rowFlow").style.display = field ? "none" : "";
  $("rowBuild").style.display = field ? "none" : "";
  // ROADMAP 4.50 (10), for the same reason: its bump is analytic, added into that field, so it has no
  // tip to choose and takes none of the dynamics — `stampAt`'s height branch never asks for either.
  $("rowTip").style.display = field ? "none" : "";
  $("brushDyn").style.display = field ? "none" : "";
  BrushPanel.syncTip();
  BrushPanel.cloneHint();
}
// The Clone's one line of state, on its row: whether Alt+click has set a source on this slot yet,
// and once a stroke has fixed the offset, that the source is following the brush. Called from the
// pointer paths that change either, so the row never says "set the source" over a source.
const BrushPanel = {
  // The pressure curve's three settings, as gammas (Pen.curve): soft, linear, firm. The select's
  // options carry the same numbers; the prefs row refuses anything else.
  CURVES: [0.5, 1, 2],
  // The Smoothing readout: the string's length in screen pixels, or "off".
  lazyText(n){ return n > 0 ? String(n) : "off"; },
  cloneHint(){
    const el = $("cloneHint");
    if (!el || App.brush.tool !== "clone") return;
    const src = Clone.source(App.activeSlot);
    el.textContent = !src ? "Alt-click sets the source"
      : src.off[0] ? "Source follows the brush — Alt-click to move it"
      : "Source set — paint where the copy should go";
  },

  // ---- the tip (ROADMAP 4.50 (10), editor/tips.js) ----
  // The tip in hand, from the select or a stored setting: a built-in, one in the library — or, before
  // the library has been read at boot, one it may still hold, which `tipsLoaded` checks. Anything else
  // paints Round, and once the library has answered it says so: a brush quietly changing shape is the
  // silent failure §4 exists to prevent.
  setTip(v){
    const ok = Tips.valid(v);
    if (!ok && typeof v === "string" && v && Tips.ready)
      setStatus("The brush tip this tool used is not in this browser's tip library any more — it is on Round", "err");
    App.brush.tip = ok ? v : "round";
    const el = $("brushTip");
    if (el) el.value = App.brush.tip;
    brushStamp._key = null;
    BrushPanel.syncTip();
  },
  // What the tip decides on the panel: Hardness shows for the two tips it shapes (and for Panel line,
  // which has no tip), the angle rows for a tip that looks different turned, Remove for a tip the
  // user loaded; and the preview.
  syncTip(){
    const T = Tips.of(App.brush), show = (id, on) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
    show("rowHard", T.hard || App.brush.tool === "height");
    for (const id of ["rowAngle", "rowAngleJit", "rowFollow"]) show(id, T.turns);
    const del = $("btnTipDel");
    if (del) del.disabled = !Tips.lib.has(App.brush.tip);
    BrushPanel.tipPreview();
  },
  // The tip as it lays paint: coverage as the alpha of the panel's own light grey, on a clear ground,
  // fitted into the little canvas 2 px in from its border with its proportions kept. It was dark on a
  // light square, the way Photoshop's and Krita's pickers draw a tip — but Round filled the 22 px box,
  // so on this dark panel all that showed was four white corners, which read as a glitch (review,
  // 2026-10-10). Every tip now sits on the panel the way the app's icons do.
  tipPreview(){
    const c = $("tipPreview");
    if (!c) return;
    const T = Tips.get(App.brush.tip), n = c.width, m = n - 4;
    let W = m, H = m, cov;
    if (T.cov) {
      if (T.w >= T.h) H = Math.max(1, Math.round(m * T.h / T.w)); else W = Math.max(1, Math.round(m * T.w / T.h));
      cov = Tips.scale(T.cov, T.w, T.h, W, H);
    } else cov = Tips.make(T.id, m, App.brush.hardness);
    const g = ctx2d(c), img = g.createImageData(n, n), p = img.data, ox = (n - W) >> 1, oy = (n - H) >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const j = ((oy + y) * n + ox + x) * 4;
      p[j] = p[j + 1] = p[j + 2] = 226; p[j + 3] = cov[y * W + x];
    }
    g.putImageData(img, 0, 0);
  },
  // The loaded tips, listed after the four built in.
  tipOptions(){
    const sel = $("brushTip");
    if (!sel) return;
    for (const o of [...sel.options]) if (!Tips.isBuilt(o.value)) o.remove();
    for (const t of Tips.lib.values()) {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.name;
      sel.appendChild(o);
    }
    sel.value = App.brush.tip;
  },
  // The library has been read (main.js, once boot is done): list it, and settle a tip id a stored
  // setting named before it could be checked.
  tipsLoaded(){
    BrushPanel.tipOptions();
    BrushPanel.setTip(App.brush.tip);
  },
  // An image file as a new tip. A big image is drawn down to 1024 on its longer side first, by the
  // canvas: `Tips.fromImage` is a loop over every texel, and a 4096² photo read at full size would
  // hold the page for the better part of a second to end up at 256 anyway.
  async loadTip(file){
    if (!file) return;
    let src;
    try { src = await blobToCanvas(file); }
    catch (e) { setStatus("Could not read “" + file.name + "” as an image — " + ((e && e.message) || e), "err"); return; }
    const k = Math.min(1, 1024 / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const c = k < 1 ? mkCanvas(w, h) : src;
    if (k < 1) { const g = ctx2d(c); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, h); }
    const t = Tips.fromImage(ctx2d(c).getImageData(0, 0, w, h).data, w, h);
    const name = String(file.name || "Tip").replace(/\.[a-z0-9]{1,5}$/i, "") || "Tip";
    if (!t) { setStatus("“" + name + "” has nothing on it to use as a tip — it is one flat colour, or wholly transparent", "err"); return; }
    const id = await Tips.add(t, name);
    BrushPanel.tipOptions();
    BrushPanel.setTip(id);
    setStatus("“" + name + "” is a brush tip now (" + t.w + " × " + t.h + ") — kept in this browser beside the decal library", "ok");
  },
  // Take the tip in hand out of the library. Every tool that used it goes back to Round, now rather
  // than the next time it is picked up, so no tool is left holding a tip that is not there.
  async removeTip(){
    const id = App.brush.tip, t = Tips.lib.get(id);
    if (!t) return;
    if (!confirm("Remove the brush tip “" + t.name + "” from this browser's tip library?\n\nEvery tool that uses it goes back to Round.")) return;
    await Tips.remove(id);
    for (const r of Object.values(App.brushTools || {})) if (r && r.tip === id) r.tip = "round";
    BrushPanel.tipOptions();
    BrushPanel.setTip("round");
    setStatus("Removed the brush tip “" + t.name + "” — the tools that used it are on Round", "ok");
  },
  // A settings file's tips (the `brush.tipLib` prefs row): into the library at once, listed, and
  // stored behind it.
  adoptTips(v){
    const r = Tips.adopt(v);
    if (!r.added) return;
    BrushPanel.tipOptions();
    r.done.catch(e => reportFailure("Keeping the brush tips from that settings file", e, "tips"));
  },
};
$("brushHeal").onchange = e => { App.brush.heal = e.target.checked; };
// `cursor` = this slider changes the brush footprint, so the ring and the 2-D outline have to be
// redrawn at the new size without waiting for the pointer to move.
const bindRange = (id, fn, cursor) => { $(id).oninput = e => { fn(+e.target.value); const v = $(id + "Val"); if (v) v.textContent = e.target.value; brushStamp._key = null; if (cursor) refreshBrushCursor(); }; };
bindRange("brushSize", v => App.brush.size = v, true);
bindRange("brushOpacity", v => App.brush.opacity = v / 100);
bindRange("brushHardness", v => { App.brush.hardness = v / 100; BrushPanel.tipPreview(); }, true);
bindRange("brushValue", v => App.brush.value = v);
bindRange("brushSpacing", v => App.brush.spacing = v / 100);
// ROADMAP 4.50 (4) + 6.4 — none of these touches the stamp: Flow is applied as the dab's alpha when
// it is drawn and pressure scales it there, which is why `brushStamp._key` did not grow.
bindRange("brushFlow", v => App.brush.flow = v / 100);
$("brushBuild").onchange = e => { App.brush.build = e.target.checked; };
$("penSize").onchange = e => { App.brush.pSize = e.target.checked; };
$("penFlow").onchange = e => { App.brush.pFlow = e.target.checked; };
$("penCurve").onchange = e => { App.brush.curve = BrushPanel.CURVES.includes(+e.target.value) ? +e.target.value : 1; };
// ROADMAP 4.50 (10). The tip is in the stamp's key; the dynamics are not — they are applied when each
// dab is drawn (`Pen.dab`) — so only the tip and the Angle change what the cursor shows.
$("brushTip").onchange = e => { BrushPanel.setTip(e.target.value); refreshBrushCursor(); };
$("btnTipLoad").onclick = () => $("tipPick").click();
$("tipPick").onchange = async e => {
  const f = e.target.files[0];
  e.target.value = "";                          // so the same file can be picked twice
  await BrushPanel.loadTip(f);
};
$("btnTipDel").onclick = () => BrushPanel.removeTip();
bindRange("brushSizeJit", v => App.brush.sizeJit = v / 100);
bindRange("brushFlowJit", v => App.brush.flowJit = v / 100);
bindRange("brushScatter", v => App.brush.scatter = v / 100);
bindRange("brushAngle", v => App.brush.angle = v, true);
bindRange("brushAngleJit", v => App.brush.angleJit = v / 100);
$("brushFollow").onchange = e => { App.brush.follow = e.target.checked; };
$("brushLazy").oninput = e => { App.brush.lazy = +e.target.value; $("brushLazyVal").textContent = BrushPanel.lazyText(App.brush.lazy); };
// Every one of these is "the user is adjusting symmetry", which is what the mirror plane's own
// switch calls a preview (ROADMAP 3.13) — so none of them consults `symOn` any more: where the
// plane is does not depend on whether mirrored painting is turned on, and "Never" means never.
bindRange("symOff", v => { App.symOffset = v / 100; updateSymPlane(true); });
// ---- radial symmetry (ROADMAP 4.44's eighth candidate) ----
// Three controls over `App.radial`, and one sentence when the count is up but the centre is not
// picked yet — which is the only state that looks broken: copies set to eight and nothing happens.
function syncRadialUI(){
  const R = App.radial || (App.radial = { n: 1, axis: "auto", c: null, dir: null });
  const n = R.n | 0;
  $("radialNVal").textContent = n > 1 ? n + "×" : "off";
  $("radialRow2").style.display = n > 1 ? "" : "none";
  $("btnRadialCentre").textContent = App.placing === "radial" ? "Click the centre…" : (R.c ? "Move centre…" : "Set centre…");
  $("btnRadialCentre").classList.toggle("warn", n > 1 && !R.c);
}
$("radialN").oninput = e => {
  const R = App.radial || (App.radial = { n: 1, axis: "auto", c: null, dir: null });
  const was = R.n | 0;
  R.n = +e.target.value | 0;
  syncRadialUI();
  if (R.n > 1 && was <= 1 && !R.c) setStatus("Radial: now click “Set centre…” and then the hub the copies turn about", "ok");
  updateRadialAxis(true);
};
$("radialAxis").onchange = () => {
  const R = App.radial || (App.radial = { n: 1, axis: "auto", c: null, dir: null });
  R.axis = $("radialAxis").value;
  // A named axis can be applied to the centre already picked; "auto" needs the surface back, so it
  // asks for the click again rather than keeping a direction the name no longer describes.
  if (R.c) {
    const d = Radial.dirOf(R.axis, null);
    if (d) { R.dir = d; updateRadialAxis(true); }
    else setStatus("Auto takes the axis from the surface you click — set the centre again", "ok");
  }
  syncRadialUI();
};
$("btnRadialCentre").onclick = () => setPlacing(App.placing === "radial" ? false : "radial");
// Ticking it, or moving the plane, is when to pay for the sheet mirror's bake — while the user is
// deciding, not in the middle of their first stroke (ROADMAP 6.2).
$("symOn").addEventListener("change", () => { updateSymPlane(true); if ($("symOn").checked) Mirror.retry(App.activeSlot); });
$("symAxis").addEventListener("change", () => { updateSymPlane(true); if ($("symOn").checked) Mirror.retry(App.activeSlot); });
$("symPlaneVis").addEventListener("change", () => updateSymPlane(true));
// Hovering the symmetry controls previews the mirror plane even when symmetry is off.
for (const id of ["symOn", "symAxis", "symOff", "symPlaneVis"]) {
  const el = $(id);
  el.closest(".row").addEventListener("mouseenter", () => updateSymPlane(true));
  el.closest(".row").addEventListener("mouseleave", () => updateSymPlane());
}
$("brushColor").oninput = e => { App.brush.color = e.target.value; brushStamp._key = null; };
// ROADMAP 3.29(4) asked whether this button had become "what deleting the affected layers does".
// Measured 2026-09-20: it had not. Five paths still write the BASE _n sheets and none is a layer —
// a baked look, a raw-channel edit, a replaced _n file, a merged weapon skin, a project restoring
// a baked stack — and after a resized replacement the undo history is cleared, so this is the only
// way back. It just did not work there (see restoreStockSheet). Layers are the layer list's.
$("btnResetSurface").onclick = () => {
  const s = App.activeSlot;
  if (!s || !s.smooth) { setStatus("Select a slot with a surface (_n) map first", "err"); return; }
  const was = s.smooth.width;
  if (!restoreStockSheet(s, true)) { setStatus("No original _n is loaded for " + s.id + " — nothing to go back to", "err"); return; }
  const resized = s.smooth.width !== was;
  if (resized) UndoHistory.clear();                             // every snapshot is the old size
  // No step of its own either way (ROADMAP 4.50(2)): at its own size the history is kept, and what
  // is kept is re-stamped, since undoing a step now leaves the sheets reset — see core/autosave.js.
  Autosave.changed();
  rebuildMaterials();                       // was rebuilding by hand: dropped the mesh name (effect
  refreshSurfaceTextures(s); draw2D();        // materials) and the selection dimming, and leaked materials
  refreshSlotList();
  setStatus("Base _n of " + s.id + " put back to the game's original" + (resized ? " (" + was + " → " + s.smooth.width + "px, undo history cleared)" : "") +
    " — smoothness / metal / normal layers are untouched", "ok");
};
