// ---------- A mask from the model: curvature and occlusion (ROADMAP 4.44, first candidate) ----------
// The dialog over `Bake`. Two sources — curvature and occlusion — a sign for each (edges or
// cavities; occluded or open), and a levels pair that says what reads as fully hidden and fully
// shown, with a soften. The preview is the mask over the sheet's own colour, dimmed, so the user
// can see WHERE the edges are on the texture rather than judging a field of grey on black.
//
// One binding, on the pattern §4 asks for. The bake is cached on the slot by `Bake.run`, so
// reopening the dialog, or making a second mask from the same source, costs the grading only.
//
// The third entry is not a mask (ROADMAP 4.45). **From the cockpit** carries the first-person
// cockpit's paint onto the exterior's own low-detail cockpit (`Transfer.cockpit`, editor/transfer.js).
// It lives here because it is the same act — bake something out of the model onto this sheet, see it
// over the sheet, use it — and because the exterior's `*_interior` sheet is where someone making a
// mask from the model already is. It writes a LAYER on top of the sheet's stack and leaves the mask
// it was opened from alone; the title and the button say so. It bakes onto the EXTERIOR's parts
// whichever body is on screen, so a sheet no part of this body uses still opens the dialog when a
// cockpit can be carried onto it, with the two mask sources switched off.
const MaskBake = {
  PREVIEW: 360,
  KINDS: {
    curv: { label: "Curvature", modes: [["edges", "edges (convex)"], ["cavities", "cavities (concave)"]],
            tip: "Where the surface bends. Edges are where paint chips and metal shows; cavities — fillets, panel joints, the foot of a fairing — are where grime collects. Read off the model's mesh, with the normal map's own panel lines and rivets added when the texture has one." },
    ao:   { label: "Occlusion", modes: [["occluded", "occluded (enclosed)"], ["open", "open (exposed)"]],
            tip: "How enclosed each point is: under the wings, inside wheel wells, between hull and fenders, under stowage. Dirt sits where light does not reach; wear and fading sit where it does. Whatever is hidden on the model casts no shadow, so hide a gear door to bake the bay open." },
    ck:   { label: "From the cockpit", layer: true, title: "The cockpit, carried out",
            tip: "The first-person cockpit's paint, carried onto the exterior's low-detail cockpit: each texel takes the colour the cockpit body has at the nearest point of its surface. Paint the cockpit body first, then judge it from the Pilot's seat on the Exterior body." },
  },
  // Defaults per source. Curvature is mostly flat with sparse strong edges, so its ramp starts
  // low; occlusion is a smooth field, so its ramp sits in the middle. The cockpit's reach is the
  // transfer's own default — a getter, so it is read when a dialog opens, not when the page loads.
  DEFAULTS: { curv: { mode: "edges", lo: .1, hi: .7, soften: 1 }, ao: { mode: "occluded", lo: .25, hi: .85, soften: 2 },
              get ck(){ return { reach: Transfer.DEFAULT_REACH }; } },

  open(slot, L){
    if (!App.geomData) { setStatus("Load a vehicle first — a mask from the model needs the model", "err"); return; }
    // `KINDS.ck` is read here and not assumed, so deleting that one entry hides 4.45 whole: without
    // it this state (a sheet the body on screen does not use) says so and opens nothing, as before.
    const own = Bake.groups(slot).length > 0, ck = !!MaskBake.KINDS.ck && Cockpit.has();
    if (!own && !ck) { setStatus("No part of the model uses “" + slot.id + "”, so there is nothing to bake for it", "err"); return; }
    const st = { slot, L, own, kind: own ? "curv" : "ck", detail: true, bake: null, small: null, busy: false,
                 carried: null, carriedSmall: null, job: null, ...MaskBake.DEFAULTS.curv, ...MaskBake.DEFAULTS.ck };
    // Closing the dialog, however it closes, stops a carry still running: its result has nowhere to
    // go, and the transfer's worker holds one bake at a time (Transfer.cockpit.stop). A mask bake is
    // left to finish — `Bake.run` caches it on the slot for the next open.
    const m = modalDialog("Mask from the model", { width: "min(720px,94vw)", onClose: () => { if (st.job) st.job.stop(); } });
    st.m = m;
    st.title = m.head.querySelector("h2");
    m.body.style.cssText = "flex-direction:row;gap:12px;align-items:flex-start";
    m.body.append(MaskBake.left(st), MaskBake.right(st, ck));
    MaskBake.foot(st);
    MaskBake.setKind(st, st.kind);
  },
  // ---- left: the preview, and the line under it that says what was baked ----
  left(st){
    const left = document.createElement("div");
    left.style.cssText = "flex:0 0 auto;display:flex;flex-direction:column;gap:4px";
    const pv = mkCanvas(MaskBake.PREVIEW, MaskBake.PREVIEW);
    pv.style.cssText = "border-radius:4px;background:#15171c;border:1px solid var(--border)";
    const note = document.createElement("div");
    note.className = "hint";
    note.style.cssText = "margin:0;white-space:normal;max-width:" + MaskBake.PREVIEW + "px";
    left.append(pv, note);
    st.pv = pv; st.note = note;
    return left;
  },
  // ---- right: the sources, and each one's controls ----
  right(st, ck){
    const right = document.createElement("div");
    right.style.cssText = "flex:1 1 auto;display:flex;flex-direction:column;gap:6px;min-width:220px";
    const kinds = document.createElement("div");
    kinds.className = "row";
    st.kindBtns = {};
    for (const k of Object.keys(MaskBake.KINDS)) {
      const K = MaskBake.KINDS[k];
      if (K.layer && !ck) continue;                     // no cockpit model, nothing to carry
      const b = document.createElement("button");
      b.textContent = K.label;
      b.title = K.tip;
      if (!K.layer && !st.own) {                        // no part of THIS body on the sheet: no mask to bake
        b.disabled = true;
        b.title = "No part of the body on screen uses “" + st.slot.id + "” — switch to the body that does to bake a mask from it";
      }
      b.onclick = () => MaskBake.setKind(st, k);
      st.kindBtns[k] = b;
      kinds.appendChild(b);
    }
    const tip = document.createElement("div");
    tip.className = "hint";
    tip.style.cssText = "margin:0;white-space:normal";
    st.tip = tip;
    const modes = document.createElement("div");
    modes.className = "row";
    st.modes = modes;
    const pct = x => Math.round(x * 100) + "%";
    st.rLo = MaskBake.range(st, "From", "Below this the layer is hidden entirely", 0, 1, .01, () => st.lo, x => { st.lo = Math.min(x, st.hi - .01); }, pct, "100");
    st.rHi = MaskBake.range(st, "To", "Above this the layer shows in full; between the two it ramps", 0, 1, .01, () => st.hi, x => { st.hi = Math.max(x, st.lo + .01); }, pct, "100");
    st.rSoft = MaskBake.range(st, "Soften", "Blur the mask, for a fade instead of a hard edge — applied before the mask is cut to the UV islands, so it cannot fade their rims", 0, 8, 1, () => st.soften, x => { st.soften = x; }, x => x + " px");
    st.rReach = MaskBake.range(st, "Reach", "How far from this sheet's surface the cockpit's paint is taken. It fades over the last third, so where the two models drift apart the paint thins out instead of stopping at a line. Free after the bake.",
      .01, Transfer.REACH, .01, () => st.reach, x => { st.reach = x; }, x => Math.round(x * 100) + " cm", "100");
    st.det = MaskBake.detail(st);
    right.append(kinds, tip, modes, st.rLo, st.rHi, st.rSoft, st.rReach, st.det);
    return right;
  },
  // A labelled slider row. `fmt` writes its readout and `k` is the readout's factor over the value
  // (`data-k`, which the slider's type-in box reads — ui/dom.js).
  range(st, label, title, min, max, step, get, set, fmt, k){
    const r = document.createElement("div");
    r.className = "row";
    const l = document.createElement("label"); l.textContent = label; l.title = title;
    const i = document.createElement("input");
    i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = get();
    i.style.flex = "1";
    if (k) i.dataset.k = k;
    const v = document.createElement("span");
    v.className = "val"; v.style.minWidth = "34px";
    const show = () => { v.textContent = fmt(+i.value); };
    i.oninput = () => { set(+i.value); show(); MaskBake.changed(st); };
    show();
    r.append(l, i, v);
    r._sync = () => { i.value = get(); show(); };
    return r;
  },
  // The normal map's detail, curvature only.
  detail(st){
    const det = document.createElement("label");
    det.style.cssText = "font-size:12px;display:flex;gap:6px;align-items:center";
    det.title = "The game's normal map carries the panel lines and rivets the mesh does not model. With this on, their edges are part of the curvature.";
    const detIn = document.createElement("input");
    detIn.type = "checkbox"; detIn.checked = st.detail;
    detIn.onchange = () => { st.detail = detIn.checked; MaskBake.recombine(st); };
    det.append(detIn, document.createTextNode(" Add the normal map's panel lines and rivets"));
    return det;
  },
  // ---- foot: use it, what using it does, cancel ----
  foot(st){
    const use = document.createElement("button");
    use.onclick = () => MaskBake.apply(st);
    const grow = document.createElement("span");
    grow.className = "grow";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = st.m.close;
    st.m.foot.append(use, grow, cancel);
    st.use = use; st.grow = grow;
  },
  // Switch the source: restore that source's own settings, show its controls, and bake if needed.
  setKind(st, kind){
    if (st.busy) return;
    const K = MaskBake.KINDS[kind], layer = !!K.layer;
    st.kind = kind;
    Object.assign(st, MaskBake.DEFAULTS[kind]);
    for (const k in st.kindBtns) st.kindBtns[k].classList.toggle("active", k === kind);
    st.title.textContent = K.title || "Mask from the model";
    st.tip.textContent = K.tip;
    for (const r of [st.modes, st.rLo, st.rHi, st.rSoft]) r.style.display = layer ? "none" : "";
    st.rReach.style.display = layer ? "" : "none";
    st.det.style.display = kind === "curv" && st.slot.normal ? "" : "none";
    st.use.textContent = layer ? "Add as layer" : "Use as mask";
    st.use.title = layer ? "Put the carried cockpit in a new layer on top of this sheet — this layer's mask is left as it is"
                         : "Replace this layer's mask with the graded bake";
    st.grow.textContent = layer ? "A new layer on top of this sheet; deleting it takes it back. Baked once; the reach is free."
                                : "White shows the layer, black hides it. Baked once per texture; the levels are free.";
    if (!layer) MaskBake.modeRow(st);
    st.rLo._sync(); st.rHi._sync(); st.rSoft._sync(); st.rReach._sync();
    MaskBake.preview(st);
    MaskBake.bake(st);
  },
  modeRow(st){
    st.modes.innerHTML = "";
    const l = document.createElement("label");
    l.textContent = "Shows";
    st.modes.appendChild(l);
    for (const [id, label] of MaskBake.KINDS[st.kind].modes) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "padding:1px 8px;font-size:11px";
      b.classList.toggle("active", st.mode === id);
      b.onclick = () => { st.mode = id; MaskBake.modeRow(st); MaskBake.preview(st); };
      st.modes.appendChild(b);
    }
  },
  async bake(st){
    st.busy = true; st.use.disabled = true;
    st.note.textContent = st.kind === "ck" ? "Carrying the cockpit out…" : "Baking…";
    try {
      if (st.kind === "ck") { await MaskBake.carry(st); return; }
      const b = await Bake.run(st.slot, st.kind);
      if (!st.m.ov.isConnected) return;                // closed while it ran
      st.bake = b;
      if (b.kind === "curv" && b.withDetail !== (st.detail && !!b.detail)) Bake.combine(b, st.detail);
      st.small = MaskBake.shrink(b);
      st.note.textContent = "Baked at " + b.w + "×" + b.h + (b.kind === "curv" && b.detail ? " · mesh + normal map" : b.kind === "curv" ? " · mesh only (no normal map on this texture)" : " · " + BakeMesh.N_DIRS + " directions");
      MaskBake.preview(st);
      st.use.disabled = false;
    } catch (err) {
      if (err instanceof Cancelled) { st.note.textContent = "Cancelled — pick a source to bake again"; return; }
      st.note.textContent = "Could not bake: " + (err && err.message || err);
      reportFailure(st.kind === "ck" ? "Carrying the cockpit onto “" + st.slot.id + "”" : "Baking the " + MaskBake.KINDS[st.kind].label.toLowerCase() + " mask", err, "bake");
    } finally { st.busy = false; }
  },
  // The cockpit's paint carried onto this sheet — once per dialog, so a second look at it or any
  // reach costs nothing. A `why` from the transfer is a state of the vehicle (the cockpit body not
  // opened yet, no part of the exterior on this sheet), so it is said in the note, not reported.
  async carry(st){
    if (!st.carried) {
      const g = Transfer.cockpit.gather(st.slot);
      if (g.why) { st.note.textContent = g.why; return; }
      st.job = { stop(){} };
      const res = await Transfer.cockpit.bake(st.slot, g, st.job);
      if (!st.m.ov.isConnected) return;                // closed while it ran
      st.carried = res;
      st.carriedSmall = MaskBake.shrinkRGBA(res);
    }
    MaskBake.carriedNote(st);
    MaskBake.preview(st);
  },
  // What the reach shows, and where it came from — and, when it shows nothing, which of three reasons
  // it is: the cockpit renders the whole of this very sheet (51 of the 336 models whose cockpit binds
  // it, t103 --shared, 2026-09-27), no painted surface is within even the longest reach, or only the
  // chosen reach is too short.
  carriedNote(st){
    const r = st.carried, s = Transfer.cockpit.summary(r, st.reach), cm = Math.round(st.reach * 100) + " cm";
    const pct = n => Math.round(100 * n / Math.max(1, s.covered)) + " %";
    if (!s.shown) st.note.textContent = !s.lent && s.own
      ? "The cockpit body paints “" + st.slot.id + "” itself, so what you paint there already shows from outside — there is nothing to carry"
      : !s.lent ? "Nothing the cockpit paints is within " + Math.round(Transfer.REACH * 100) + " cm of this sheet"
      : "Nothing of the cockpit is within " + cm + " of this sheet — widen the reach";
    else st.note.textContent = "Baked at " + r.w + "×" + r.h + " · " + pct(s.shown) + " of the sheet within " + cm
      + (s.top.length ? " · from " + s.top.join(", ") : "") + (s.own ? " · " + pct(s.own) + " the cockpit paints on this sheet itself, left as it is" : "");
    st.use.disabled = !s.shown;
  },
  // A control moved: redraw, and for the carried cockpit say again what the reach now shows.
  changed(st){
    if (st.kind === "ck" && st.carried) MaskBake.carriedNote(st);
    MaskBake.preview(st);
  },
  recombine(st){
    const b = st.bake;
    if (!b || b.kind !== "curv") return;
    Bake.combine(b, st.detail);
    st.small = MaskBake.shrink(b);
    MaskBake.preview(st);
  },
  // The bake box-averaged down to the preview's size once, so a slider move grades ~100k texels
  // rather than 16 million. Coverage is "any texel covered".
  shrink(b){
    const k = Math.max(1, Math.ceil(Math.max(b.w, b.h) / MaskBake.PREVIEW));
    const w = Math.ceil(b.w / k), h = Math.ceil(b.h / k);
    const data = new Uint8Array(w * h), cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0, c = 0;
      for (let yy = y * k; yy < Math.min(b.h, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(b.w, (x + 1) * k); xx++) {
        const i = yy * b.w + xx;
        sum += b.data[i]; n++; if (b.cov[i]) c = 1;
      }
      data[y * w + x] = n ? Math.round(sum / n) : 0; cov[y * w + x] = c;
    }
    return { kind: b.kind, w, h, data, cov };
  },
  // The carried colour box-averaged the same way: colour and closeness byte averaged over the texels
  // that have any, and `frac` the share of the block that does, which scales the preview's alpha.
  shrinkRGBA(r){
    const k = Math.max(1, Math.ceil(Math.max(r.w, r.h) / MaskBake.PREVIEW));
    const w = Math.ceil(r.w / k), h = Math.ceil(r.h / k), rgba = new Uint8ClampedArray(w * h * 4), frac = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let n = 0, c = 0, s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let yy = y * k; yy < Math.min(r.h, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(r.w, (x + 1) * k); xx++) {
        const i = (yy * r.w + xx) * 4;
        n++;
        if (!r.rgba[i+3]) continue;
        c++; s0 += r.rgba[i]; s1 += r.rgba[i+1]; s2 += r.rgba[i+2]; s3 += r.rgba[i+3];
      }
      const o = (y * w + x) * 4;
      if (c) { rgba[o] = s0 / c; rgba[o+1] = s1 / c; rgba[o+2] = s2 / c; rgba[o+3] = Math.round(s3 / c); }
      frac[y * w + x] = n ? c / n : 0;
    }
    return { w, h, rgba, frac };
  },
  preview(st){
    const pv = st.pv, g = ctx2d(pv), sheet = st.slot.composite;
    g.clearRect(0, 0, pv.width, pv.height);
    g.fillStyle = "#15171c"; g.fillRect(0, 0, pv.width, pv.height);
    const s = st.kind === "ck" ? st.carriedSmall : st.small;
    const sw = s ? s.w : sheet ? sheet.width : 0, sh = s ? s.h : sheet ? sheet.height : 0;
    if (!sw || !sh) return;
    // fit the sheet's aspect
    const scale = Math.min(pv.width / sw, pv.height / sh);
    const dw = Math.round(sw * scale), dh = Math.round(sh * scale), dx = (pv.width - dw) >> 1, dy = (pv.height - dh) >> 1;
    // the sheet's colour, dimmed, so what was baked is read against what it will land on
    if (sheet) {
      g.globalAlpha = .35;
      g.drawImage(sheet, dx, dy, dw, dh);
      g.globalAlpha = 1;
    }
    if (!s) return;
    const c = st.kind === "ck" ? MaskBake.carriedImage(st, s) : MaskBake.maskImage(st, s);
    if (st.kind !== "ck" && st.soften > 0) g.filter = "blur(" + (st.soften * dw / (st.bake ? st.bake.w : dw)).toFixed(2) + "px)";
    g.drawImage(c, dx, dy, dw, dh);
    g.filter = "none";
  },
  // The graded mask as white at its alpha, cut to the islands.
  maskImage(st, s){
    const a = Bake.grade(s, st.mode, st.lo, st.hi);
    const c = mkCanvas(s.w, s.h), cg = ctx2d(c);
    const img = cg.createImageData(s.w, s.h);
    for (let i = 0; i < s.w * s.h; i++) { img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = 255; img.data[i*4+3] = s.cov[i] ? a[i] : 0; }
    cg.putImageData(img, 0, 0);
    return c;
  },
  // The carried colour at the layer's own alpha for the reach, over the dimmed sheet — what the new
  // layer will add, where it will add it.
  carriedImage(st, s){
    const lut = Transfer.cockpit.lut(st.reach);
    const c = mkCanvas(s.w, s.h), cg = ctx2d(c);
    const img = cg.createImageData(s.w, s.h), d = img.data;
    for (let i = 0; i < s.w * s.h; i++) {
      d[i*4] = s.rgba[i*4]; d[i*4+1] = s.rgba[i*4+1]; d[i*4+2] = s.rgba[i*4+2];
      d[i*4+3] = Math.round(lut[s.rgba[i*4+3]] * s.frac[i]);
    }
    cg.putImageData(img, 0, 0);
    return c;
  },
  apply(st){
    if (st.kind === "ck") { MaskBake.applyCarried(st); return; }
    if (!st.bake) return;
    const label = MaskBake.KINDS[st.kind].label.toLowerCase() + " (" + st.mode + ")";
    let mask;
    try { mask = Bake.toMask(st.slot, st.bake, st.mode, st.lo, st.hi, st.soften); }
    catch (err) { reportFailure("Making the mask from the " + label, err, "bake"); return; }
    setLayerMask(st.slot, st.L, mask, "mask from " + label);
    st.m.close();
    setStatus("“" + st.L.name + "” is masked by the model's " + label + " — soften it, invert it, or paint on it with the Mask brush", "ok");
  },
  // The carried cockpit as a new layer on top of the sheet, one undo step (Transfer.cockpit.place).
  applyCarried(st){
    if (!st.carried) return;
    let L;
    try { L = Transfer.cockpit.place(st.slot, st.carried, st.reach); }
    catch (err) { reportFailure("Adding the cockpit's paint to “" + st.slot.id + "” as a layer", err, "bake"); return; }
    st.m.close();
    setStatus("“" + L.name + "” is on top of “" + st.slot.id + "” — judge it from the Pilot's seat on the Exterior body; deleting the layer takes it back", "ok");
  },
};
