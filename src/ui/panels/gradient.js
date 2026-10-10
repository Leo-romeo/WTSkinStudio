// ---------- The gradient rows of a fill (ROADMAP 4.44, fifth candidate) ----------
// A fill is one colour or a gradient, and the rows below the Fill select are what a gradient has:
// its shape and space, where its axis runs, and its stops. One binding over `Gradient` /
// `GradFill` (editor/gradient.js), on the pattern §4 asks for, and built by `LayerProps.fill`
// beside the flat fill's own row.
//
// Every edit REPLACES the record on the content rather than writing into it (`Gradient.clone`,
// then `put`), and every edit is one undo step: the selects and the stop buttons through
// `pushAction` with the record before and after, the sliders through `bindUndoRange` the way the
// opacity row does it — live on input, one step on release — so dragging a stop never rebuilds the
// panel under the pointer.
//
// Since 4.50 (7) and (8) the select also offers a NOISE (a gradient record whose t is a noise
// field along the model — its stops and levels are the rows below it, unchanged) and a PATTERN (a
// tile image, on the sheet or tri-planar along the model — editor/procedural.js). Switching between
// kinds goes through `stepFill`, one undo step over the whole fill (record, tile and colour),
// because undoing "gradient → pattern" has to bring the tile back as well as the stops.
const GradUI = {
  KINDS: [["flat", "flat colour"], ["linear", "gradient, on the sheet"], ["radial", "radial, on the sheet"], ["model", "gradient, along the model"],
          ["noise", "noise, along the model"], ["patuv", "pattern, on the sheet…"], ["patmodel", "pattern, along the model…"]],
  // What the Fill select says for a content.
  kindOf(c){
    if (c.pat) return c.pat.space === "model" ? "patmodel" : "patuv";
    if (!c.grad) return "flat";
    if (c.grad.shape === "noise") return "noise";
    if (c.grad.space === "model") return "model";
    return c.grad.shape === "radial" ? "radial" : "linear";
  },
  // A new noise: the colour showing where the noise is light, fading out where it is dark — so
  // on the colour channel it reads as grime of that colour, and as a mask it shows the light half.
  noiseRecord(col){
    const g = Gradient.make("model", col);
    g.shape = "noise";
    g.stops = [{ t: 0, color: col, alpha: 0 }, { t: 1, color: col, alpha: 1 }];
    g.noise = Procedural.noiseMake();
    return g;
  },
  // ---- the whole fill, for a change of kind ----
  fillState(c){
    return { grad: Gradient.clone(c.grad), pat: c.pat ? Procedural.patClone(c.pat) : null,
             patImg: c.pat ? c.patImg || null : null, patName: c.pat ? c.patName || null : null, color: c.color };
  },
  putFill(P, st){
    P.onChan((c, x) => {
      c.grad = st.grad ? Gradient.clone(st.grad) : null;
      if (st.pat && st.patImg) { c.pat = Procedural.patClone(st.pat); c.patImg = st.patImg; c.patName = st.patName || null; }
      else { c.pat = null; delete c.patImg; delete c.patName; }
      if (st.color) c.color = st.color;
      if (!c.grad && !c.pat) { delete c._gradSheet; delete c._gradKey; }   // a flat fill keeps no sheet behind it
      if (x._thumb) x._thumbRev = -1; else x._thumb = null;
    });
    GradFill.retry(layerFamily(P.L).map(e => e.slot));
  },
  stepFill(P, desc, next){
    const was = GradUI.fillState(P.C);
    const apply = v => { GradUI.putFill(P, v); refreshLayerList(); };
    // a step that swaps the tile keeps both images alive — up to 16 MB each at 2048² — and §3.7
    // budgets the history in bytes, so it says so
    const px = im => im ? im.width * im.height * 4 : 0;
    pushAction(desc, () => apply(was), () => apply(next), was.patImg !== next.patImg ? px(was.patImg) + px(next.patImg) : 0);
    apply(next);
  },
  // The one write. `next` is a whole record (or null for a flat fill); `color` follows the first
  // stop so the layer list's colour, and a project read by an older build, show where the fade
  // starts.
  put(P, next){
    P.onChan((c, x) => {
      c.grad = next ? Gradient.clone(next) : null;
      if (next && next.stops.length) c.color = Gradient.sorted(next.stops)[0].color;
      else { delete c._gradSheet; delete c._gradKey; }        // a flat fill keeps no 16 MB sheet behind it
      // repainted in place by the list's own tick — nulling it would leave the canvas already in
      // the DOM showing the old ramp until the next rebuild
      if (x._thumb) x._thumbRev = -1; else x._thumb = null;
    });
    GradFill.retry(layerFamily(P.L).map(e => e.slot));       // a declined bake may be asked for again
  },
  // A change that is one undo step and rebuilds the rows (a select, a stop added or removed).
  step(P, desc, next){
    const was = Gradient.clone(P.C.grad);
    const apply = v => { GradUI.put(P, v); refreshLayerList(); };
    pushAction(desc, () => apply(was), () => apply(next));
    apply(next);
  },
  // A slider over one number of the record: live on input, one undo step on release, the panel
  // left alone. `get` reads the number off the record, `set` writes it into a clone.
  slider(P, row, get, set, desc, show){
    const inp = row.querySelector("input[type=range]");
    bindUndoRange(inp, () => get(P.C.grad), v => {
      const g = Gradient.clone(P.C.grad);
      set(g, v);
      GradUI.put(P, g);
    }, desc, () => { if (show) show(row, P.C.grad); });
    return inp;
  },
  pct(row, v){ const s = row.querySelector(".val"); if (s) s.textContent = Math.round(v * 100) + "%"; },

  // ---- the rows ----
  build(P){
    const { C, mk } = P;
    const kind = GradUI.kindOf(C);
    const r = mk(`<label title="A flat colour; a gradient across the sheet (a Limit rectangle centres it) or along the model — nose to tail, top to bottom; a noise along the model, for grime, chips and rain marks; or a pattern — an image of your own, repeated across the sheet or wrapped round the model from three sides.">Fill</label>` +
      `<select style="flex:1">${GradUI.KINDS.map(([k, w]) => `<option value="${k}"${k === kind ? " selected" : ""}>${w}</option>`).join("")}</select>`);
    r.querySelector("select").onchange = e => GradUI.setKind(P, e.target.value);
    if (C.pat) { GradUI.patRows(P); return; }
    if (!C.grad) return;
    if (C.grad.shape === "noise") GradUI.noiseRows(P);
    else if (C.grad.space === "model") GradUI.modelRows(P);
    else GradUI.uvRows(P);
    GradUI.rangeRows(P);
    GradUI.stopRows(P);
  },
  setKind(P, k){
    const C = P.C, col = C.grad && C.grad.stops.length ? Gradient.sorted(C.grad.stops)[0].color : C.color;
    if (k === "flat") { GradUI.stepFill(P, "flat fill", { grad: null, pat: null, color: col }); return; }
    if (k === "patuv" || k === "patmodel") {
      const space = k === "patmodel" ? "model" : "uv";
      // nothing to repeat yet: choose it first — with the rows rebuilt under the picker, so that
      // closing it without a file leaves the select saying what the fill still is
      if (!C.patImg) { refreshLayerList(); GradUI.pickTile(P, space); return; }
      const p = Procedural.patClone(C.pat || Procedural.patMake(space));
      p.space = space;
      if (space === "model" && !App.geomData) setStatus("No vehicle is loaded — a pattern along the model will show once one is", "err");
      GradUI.stepFill(P, "pattern " + (space === "model" ? "along the model" : "on the sheet"), { grad: null, pat: p, patImg: C.patImg, patName: C.patName, color: C.color });
      return;
    }
    let g;
    if (k === "noise") {
      g = C.grad ? Gradient.clone(C.grad) : GradUI.noiseRecord(col);
      g.shape = "noise"; g.space = "model";
      g.noise = Procedural.noiseClone(g.noise || Procedural.noiseMake());
    } else {
      g = C.grad ? Gradient.clone(C.grad) : Gradient.make("uv", col);
      delete g.noise;
      g.space = k === "model" ? "model" : "uv";
      g.shape = k === "radial" ? "radial" : "linear";
    }
    if ((k === "model" || k === "noise") && !App.geomData) setStatus("No vehicle is loaded — " + (k === "noise" ? "a noise" : "a gradient") + " along the model will show once one is", "err");
    GradUI.stepFill(P, k === "noise" ? "noise fill" : "gradient " + k, { grad: g, pat: null, color: g.stops.length ? Gradient.sorted(g.stops)[0].color : col });
  },
  noPartsHint(P){
    if (App.geomData && !Bake.groups(P.s).length)
      P.el.appendChild(Object.assign(document.createElement("div"), { className: "hint", textContent: "No part of the model uses this texture, so there is nowhere on the vehicle to read a position from — the fill will not show here." }));
  },
  metres(m){ return m < 1 ? +(m * 100).toPrecision(3) + " cm" : +m.toPrecision(3) + " m"; },
  // A length on the vehicle: a LOG slider, because 1 cm chips and 5 m blotches are both ordinary
  // and a linear slider gives one of them a few pixels of travel — and so a box in metres rather
  // than the usual readout, whose typed value the page reads as value × k (ui/dom.js
  // `sliderTyping`), which no k can make true of a logarithm. The Rotate rows do the same.
  metreRow(P, label, tip, m, lo, hi){
    return P.mk(`<label title="${tip}">${label}</label><input type="range" min="${lo}" max="${hi}" step="1" value="${Math.round(Math.log10(m) * 100)}">` +
      `<input type="number" class="val" step="any" min="0.001" value="${m}" title="In metres — type one">`);
  },

  // ---- a noise (4.50 (8)) ----
  // Its kind, its scale in metres (a log slider: 1 cm to 10 m), its detail and roughness, a
  // streak's stretch, and its seed. Then the gradient's own From / To — levels on the noise — and
  // stops, below.
  NOISE_WORDS: [["perlin", "Perlin — soft grime"], ["value", "value — blotchy mottling"], ["cells", "cells — spots and chips"], ["streaks", "streaks — rain marks, down the vehicle"]],
  noiseRows(P){
    const n = Procedural.noiseClone(P.C.grad.noise);
    const nz = x => Procedural.noiseClone(x.noise);
    const put = (x, k, v) => { x.noise = Object.assign(nz(x), { [k]: v }); };
    const r = P.mk(`<label title="What the noise looks like. Every kind is worked out from where each texel sits on the vehicle, so it runs across the UV seams without a break and agrees on every texture the vehicle uses.">Noise</label>` +
      `<select style="flex:1">${GradUI.NOISE_WORDS.map(([k, w]) => `<option value="${k}"${k === n.type ? " selected" : ""}>${w}</option>`).join("")}</select>`);
    r.querySelector("select").onchange = e => { const g = Gradient.clone(P.C.grad); put(g, "type", e.target.value); GradUI.step(P, "noise kind", g); };
    const rs = GradUI.metreRow(P, "Scale", "The size of the largest features, on the vehicle itself — the same on every texture it uses. Drag for 1 cm to 10 m, or type metres in the box.", n.scale, -200, 100);
    GradUI.slider(P, rs, x => Math.log10(nz(x).scale) * 100, (x, v) => put(x, "scale", +Math.pow(10, v / 100).toPrecision(3)), "noise scale",
      (row, x) => { row.querySelector("input.val").value = nz(x).scale; });
    rs.querySelector("input.val").onchange = e => {
      const v = +e.target.value;
      if (!(v > 0)) { e.target.value = nz(P.C.grad).scale; return; }
      const g = Gradient.clone(P.C.grad); put(g, "scale", v); GradUI.step(P, "noise scale", g);
    };
    const rd = P.mk(`<label title="How many layers of finer detail are added, each at half the size of the last. More is grittier, and slower to work out.">Detail</label><input type="range" min="1" max="8" step="1" value="${n.octaves}"><span class="val">${n.octaves}</span>`);
    GradUI.slider(P, rd, x => nz(x).octaves, (x, v) => put(x, "octaves", v), "noise detail", (row, x) => row.querySelector(".val").textContent = nz(x).octaves);
    const rr = P.mk(`<label title="How strongly each finer layer shows: low is soft and cloudy, high is rough and grainy.">Roughness</label><input type="range" min="0" max="100" step="1" value="${Math.round(n.rough * 100)}"><span class="val">${Math.round(n.rough * 100)}%</span>`);
    GradUI.slider(P, rr, x => nz(x).rough * 100, (x, v) => put(x, "rough", v / 100), "noise roughness", (row, x) => GradUI.pct(row, nz(x).rough));
    if (n.type === "streaks") {
      const rt = P.mk(`<label title="How many times longer than wide the streaks are, running along the vehicle's up axis — rain marks and run-off.">Stretch</label><input type="range" min="1" max="40" step="1" value="${Math.round(n.stretch)}"><span class="val">${Math.round(n.stretch)}×</span>`);
      GradUI.slider(P, rt, x => nz(x).stretch, (x, v) => put(x, "stretch", v), "streak stretch", (row, x) => row.querySelector(".val").textContent = Math.round(nz(x).stretch) + "×");
    }
    const rseed = P.mk(`<label title="Which noise of this kind: the same seed is the same noise every time, on every machine.">Seed</label><input type="number" step="1" value="${n.seed}" style="flex:1;min-width:0">`);
    rseed.querySelector("input").onchange = e => { const g = Gradient.clone(P.C.grad); put(g, "seed", Math.round(+e.target.value || 0)); GradUI.step(P, "noise seed", g); };
    const b = document.createElement("button");
    b.textContent = "new"; b.title = "A different noise of the same kind and scale";
    b.style.cssText = "padding:1px 6px;font-size:11px";
    b.onclick = () => { const g = Gradient.clone(P.C.grad); put(g, "seed", (Math.random() * 1e6) | 0); GradUI.step(P, "noise seed", g); };
    rseed.appendChild(b);
    GradUI.noPartsHint(P);
  },

  // ---- a pattern (4.50 (7)) ----
  // Its tile, then how it repeats: across the sheet by a whole number of repeats, or along the
  // model by a tile size in metres with the three projections' blend. Angle and offset for both.
  patRows(P){
    const C = P.C, p = Procedural.patClone(C.pat), model = p.space === "model";
    const r = P.mk(`<label title="The image that repeats — any picture, or a DDS. One that tiles seamlessly hides its own edges; the app does not make it seamless for you.">Tile</label>`);
    const th = mkCanvas(20, 20);
    th.style.cssText = "border-radius:3px;flex:0 0 auto";
    if (C.patImg) { const g = ctx2d(th); g.imageSmoothingQuality = "high"; g.drawImage(C.patImg, 0, 0, 20, 20); }
    const nm = document.createElement("span");
    nm.className = "hint"; nm.style.cssText = "flex:1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    nm.textContent = C.patName || "image";
    const b = document.createElement("button");
    b.textContent = "Image…"; b.title = "Choose a different tile — the size, angle and offset stay as they are";
    b.style.cssText = "padding:1px 6px;font-size:11px";
    b.onclick = () => GradUI.pickTile(P, p.space);
    r.append(th, nm, b);
    if (model) {
      const rs = GradUI.metreRow(P, "Size", "How wide one tile is on the vehicle — the same on every texture the vehicle uses. Drag for 2 cm to 50 m, or type metres in the box.", p.size, -170, 170);
      GradUI.patSlider(P, rs, x => Math.log10(x.size) * 100, (x, v) => { x.size = +Math.pow(10, v / 100).toPrecision(3); }, "pattern size", (row, x) => { row.querySelector("input.val").value = x.size; });
      rs.querySelector("input.val").onchange = e => {
        const v = +e.target.value, q = Procedural.patClone(P.C.pat);
        if (!(v > 0)) { e.target.value = q.size; return; }
        q.size = v;
        GradUI.stepFill(P, "pattern size", Object.assign(GradUI.fillState(P.C), { pat: q }));
      };
    } else {
      const rn = P.mk(`<label title="How many times the tile repeats across the sheet's width. A whole number, so at 0° the pattern meets itself across the sheet's left and right edges — and across top and bottom as well when the tile and the sheet are both square.">Repeats</label><input type="range" min="1" max="64" step="1" value="${p.repeat}"><span class="val">${p.repeat}×</span>`);
      GradUI.patSlider(P, rn, x => x.repeat, (x, v) => { x.repeat = v; }, "pattern repeats", (row, x) => row.querySelector(".val").textContent = x.repeat + "×");
    }
    const ra = P.mk(`<label title="Turn the pattern clockwise — the same way on the sheet and along the model, so it keeps its turn when you switch between them.">Angle</label><input type="range" min="0" max="360" step="1" value="${Math.round((p.angle + 360) % 360)}"><span class="val">${Math.round((p.angle + 360) % 360)}°</span>`);
    GradUI.patSlider(P, ra, x => (x.angle + 360) % 360, (x, v) => { x.angle = v; }, "pattern angle", (row, x) => row.querySelector(".val").textContent = Math.round((x.angle + 360) % 360) + "°");
    for (const [k, lab, dir] of [["x", "Offset X", "across"], ["y", "Offset Y", "down"]]) {
      const ro = P.mk(`<label title="Slide the pattern ${dir} the tile, by a fraction of it.">${lab}</label><input type="range" min="0" max="100" step="1" value="${Math.round(((p[k] % 1) + 1) % 1 * 100)}"><span class="val">${Math.round(((p[k] % 1) + 1) % 1 * 100)}%</span>`);
      GradUI.patSlider(P, ro, x => (((x[k] % 1) + 1) % 1) * 100, (x, v) => { x[k] = v / 100; }, "pattern offset", (row, x) => GradUI.pct(row, ((x[k] % 1) + 1) % 1));
    }
    if (!model) return;
    const rb = P.mk(`<label title="Where the surface turns between facing along one axis and another, how quickly the tile hands over from one projection to the next: low is a long soft blend, high a short one.">Blend</label><input type="range" min="1" max="16" step="1" value="${Math.round(p.sharp)}"><span class="val">${Math.round(p.sharp)}</span>`);
    GradUI.patSlider(P, rb, x => x.sharp, (x, v) => { x.sharp = v; }, "pattern blend", (row, x) => row.querySelector(".val").textContent = Math.round(x.sharp));
    // A tile of a NORMAL map projected from three sides keeps each projection's own idea of which
    // way is up, not the surface's — the sheet's tangents run along its UVs, which no projection
    // knows — so its bumps lean the wrong way wherever the two disagree. On the sheet they agree.
    if (P.ch === "normal")
      P.el.appendChild(Object.assign(document.createElement("div"), { className: "hint", textContent: "A normal-map tile wrapped along the model keeps each projection's own sense of up, not the surface's, so its bumps can lean the wrong way. For rivets and panel lines, repeat it on the sheet instead." }));
    GradUI.noPartsHint(P);
  },
  // A slider over one number of the pattern record — `slider`'s contract, on `c.pat`.
  patSlider(P, row, get, set, desc, show){
    const inp = row.querySelector("input[type=range]");
    bindUndoRange(inp, () => get(Procedural.patClone(P.C.pat)), v => {
      const p = Procedural.patClone(P.C.pat);
      set(p, v);
      P.onChan((c, x) => { c.pat = Procedural.patClone(p); if (x._thumb) x._thumbRev = -1; else x._thumb = null; });
      if (p.space === "model") GradFill.retry(layerFamily(P.L).map(e => e.slot));
    }, desc, () => { if (show) show(row, Procedural.patClone(P.C.pat)); });
    return inp;
  },
  // The tile, from a file — any image the browser opens, or a DDS — kept at most 2048 on its long
  // side: the mips a pattern along the model reads top out at 1024, and a pattern on the sheet
  // samples it through the GPU either way.
  pickTile(P, space){
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*,.dds";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const cv = await GradUI.readTile(f);
        const p = Procedural.patClone(P.C.pat || Procedural.patMake(space));
        p.space = space;
        GradUI.stepFill(P, "pattern tile", { grad: null, pat: p, patImg: cv, patName: f.name, color: GradUI.meanOf(cv) });
        setStatus("“" + P.L.name + "” repeats “" + f.name + "” " + (space === "model" ? "along the model, " + GradUI.metres(p.size) + " a tile" : p.repeat + " times across the sheet"), "ok");
      } catch (err) { reportFailure("Reading “" + f.name + "” as a pattern tile", err, "pat-tile"); }
    };
    inp.click();
  },
  async readTile(f){
    let src;
    if (/\.dds$/i.test(f.name)) {
      const dec = await parseDDSAsync(await f.arrayBuffer());
      src = mkCanvas(dec.width, dec.height);
      ctx2d(src).putImageData(new ImageData(dec.mips[0].rgba.slice(), dec.width, dec.height), 0, 0);
    } else src = await createImageBitmap(f);
    const k = Math.min(1, 2048 / Math.max(src.width, src.height));
    const cv = mkCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k))), g = ctx2d(cv);
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, cv.width, cv.height);
    if (src.close) src.close();                                    // an ImageBitmap's pixels go now, not at the next GC
    return cv;
  },
  // The tile's average colour — the flat `color` beside the pattern, which is what a project read by
  // a build that has never heard of patterns draws, and what the layer list's swatch falls back to.
  meanOf(cv){
    const t = mkCanvas(1, 1), g = ctx2d(t);
    g.imageSmoothingQuality = "high";
    g.drawImage(cv, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join("");
  },
  // "noise…" in a layer's Mask row (4.50 (8)): a noise fill goes in directly under the layer,
  // hidden, and the layer is masked by it — live, through 4.36's reference, so the noise's scale,
  // seed and levels stay editable on that layer. One undo step for both halves.
  noiseMask(s, L){
    if (!s || !L || !nodeOwner(s.layers, L)) return;
    const N = LayerNode.of({ type: "fill", name: "Noise mask", color: "#ffffff", visible: false, opacity: 1, blend: "normal", grad: GradUI.noiseRecord("#ffffff") });
    const at = () => { const o = nodeOwner(s.layers, L); if (o) o.list.splice(o.i, 0, N); scheduleComposite(s); refreshLayerList(); };
    withUndoBatch("mask by noise", () => {
      pushAction("add noise layer", () => { const o = nodeOwner(s.layers, N); if (o) o.list.splice(o.i, 1); scheduleComposite(s); refreshLayerList(); }, at);
      at();
      setLayerMaskRef(s, L, N.uid, "mask by noise");
    });
    if (!App.geomData) setStatus("“" + L.name + "” is masked by a noise, which shows once a vehicle is loaded — it is worked out along the model", "err");
    else setStatus("“" + L.name + "” is masked by a new noise layer under it, “Noise mask” (hidden) — select that layer to change its scale, seed and levels", "ok");
  },
  uvRows(P){
    const g = P.C.grad;
    if (g.shape === "radial") return;
    const r = P.mk(`<label title="Which way the gradient runs on the sheet: 0° left to right, 90° top to bottom.">Angle</label>` +
      `<input type="range" min="0" max="360" step="1" value="${Math.round(g.angle || 0)}"><span class="val">${Math.round(g.angle || 0)}°</span>`);
    GradUI.slider(P, r, x => x.angle || 0, (x, v) => { x.angle = v; }, "gradient angle",
      (row, x) => row.querySelector(".val").textContent = Math.round(x.angle || 0) + "°");
  },
  modelRows(P){
    const g = P.C.grad;
    const presets = Gradient.presets(App.autoAxis || "z");
    const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    const cur = presets.findIndex(p => same(Gradient.unit(g.dir), p.dir));
    const r = P.mk(`<label title="The direction the gradient runs in, on the vehicle itself — the same on every texture the vehicle uses, so a fade meets itself where two sheets do.">Along</label>` +
      `<select style="flex:1">${presets.map((p, i) => `<option value="${i}"${i === cur ? " selected" : ""}>${p.label}</option>`).join("")}<option value="-1"${cur < 0 ? " selected" : ""}>custom (yaw / pitch below)</option></select>`);
    r.querySelector("select").onchange = e => {
      const i = +e.target.value;
      if (i < 0) return;
      const n = Gradient.clone(P.C.grad); n.dir = presets[i].dir.slice();   // the LIVE record: a slider may have replaced `g` since the rows were built
      GradUI.step(P, "gradient direction", n);
    };
    const a = Gradient.anglesOf(g.dir);
    const ry = P.mk(`<label title="Turn the direction round the vertical.">Yaw</label><input type="range" min="-180" max="180" step="1" value="${a.yaw}"><span class="val">${a.yaw}°</span>`);
    const rp = P.mk(`<label title="Tilt the direction up or down.">Pitch</label><input type="range" min="-90" max="90" step="1" value="${a.pitch}"><span class="val">${a.pitch}°</span>`);
    const sel = r.querySelector("select");
    const custom = () => { sel.value = "-1"; };
    GradUI.slider(P, ry, x => Gradient.anglesOf(x.dir).yaw, (x, v) => { x.dir = Gradient.dirOf(v, Gradient.anglesOf(x.dir).pitch); }, "gradient yaw",
      (row, x) => { row.querySelector(".val").textContent = Gradient.anglesOf(x.dir).yaw + "°"; custom(); });
    GradUI.slider(P, rp, x => Gradient.anglesOf(x.dir).pitch, (x, v) => { x.dir = Gradient.dirOf(Gradient.anglesOf(x.dir).yaw, v); }, "gradient pitch",
      (row, x) => { row.querySelector(".val").textContent = Gradient.anglesOf(x.dir).pitch + "°"; custom(); });
    GradUI.noPartsHint(P);
  },
  // Where t = 0 and t = 1 sit, as fractions of the reach: of the rectangle (or sheet) along the
  // angle, or of the vehicle along the direction. Beyond them the end stops hold. On a noise they
  // are LEVELS: where on the noise's own 0…1 the first and last stops sit — close together is a
  // hard-edged cut, which is how spots and chips are made out of a soft field.
  rangeRows(P){
    const g = P.C.grad, model = g.space === "model";
    const tip = g.shape === "noise" ? "of the noise's own range — 0 % is its darkest value, 100 % its lightest; set From and To close together for a hard-edged cut"
      : model ? "of the vehicle's length along the direction — 0 % is one end, 100 % the other" : "of the rectangle's (or sheet's) reach along the angle";
    const rf = P.mk(`<label title="Where the gradient starts, ${tip}. Before it the first stop holds.">From</label><input type="range" min="0" max="100" step="1" value="${Math.round(g.from * 100)}"><span class="val">${Math.round(g.from * 100)}%</span>`);
    const rt = P.mk(`<label title="Where the gradient ends, ${tip}. Past it the last stop holds. Below From runs it backwards; equal to From is a hard edge.">To</label><input type="range" min="0" max="100" step="1" value="${Math.round(g.to * 100)}"><span class="val">${Math.round(g.to * 100)}%</span>`);
    GradUI.slider(P, rf, x => x.from * 100, (x, v) => { x.from = v / 100; }, "gradient from", (row, x) => GradUI.pct(row, x.from));
    GradUI.slider(P, rt, x => x.to * 100, (x, v) => { x.to = v / 100; }, "gradient to", (row, x) => GradUI.pct(row, x.to));
    const words = [["clamp", "hold the end stops"], ["repeat", "repeat (stripes)"], ["reflect", "reflect (out from a centre line)"]];
    const rr = P.mk(`<label title="What happens past From and To. Hold: the end stops continue. Repeat: the gradient starts over — stripes. Reflect: it runs back the other way — set From to 50 % and a fade runs out from the centre line to both sides.">Past ends</label>` +
      `<select style="flex:1">${words.map(([k, w]) => `<option value="${k}"${(g.repeat || "clamp") === k ? " selected" : ""}>${w}</option>`).join("")}</select>`);
    rr.querySelector("select").onchange = e => { const n = Gradient.clone(P.C.grad); n.repeat = e.target.value; GradUI.step(P, "gradient past ends", n); };
  },
  // One row per stop, in the order they arrived (sorting them on every edit would make a stop jump
  // rows as its slider crossed a neighbour): its place along the gradient, its colour — a value on a
  // single-value channel, the way the flat fill's row does it — its alpha, and a remove button.
  //
  // `io` is the record these rows edit, how an edit is written back, and the three sentences that
  // say what a stop means: the fill's own gradient by default, and a gradient map's stops when an
  // effect hands them its own (4.50 (5)) — the one reason this takes it as an argument rather than
  // reading `P.C.grad` itself.
  fillIO(P){
    return { get: () => P.C.grad, put: n => GradUI.put(P, n), step: (desc, n) => GradUI.step(P, desc, n),
      one: "A gradient needs at least one stop — make the fill flat instead, above",
      posTip: "Where along the gradient this stop sits, 0 % at From, 100 % at To.",
      hint: P.ch !== "color" ? "Each stop is a value on this channel and how strongly it applies; between stops the value blends."
        : "Each stop is a colour and how strongly it applies; a stop at 0 % opacity fades the gradient out to what is beneath." };
  },
  stopRows(P, io){
    io = io || GradUI.fillIO(P);
    const { ch, mk } = P, g = io.get(), grey = ch !== "color";
    g.stops.forEach((s, i) => {
      const r = mk(`<label title="${io.posTip}">Stop</label>` +
        `<input type="range" min="0" max="100" step="1" value="${Math.round(s.t * 100)}" title="position" style="flex:1 1 40px;min-width:0">` +
        (grey ? `<input type="range" min="0" max="255" step="1" value="${greyOfHex(s.color)}" title="${CHAN_LABEL[ch] || ch} value" style="flex:1 1 40px;min-width:0">`
              : `<input type="color" value="${s.color}" title="colour" style="flex:0 0 auto;width:28px;height:20px;padding:0">`) +
        `<input type="range" min="0" max="100" step="1" value="${Math.round(s.alpha * 100)}" title="opacity of this stop" style="flex:1 1 40px;min-width:0">` +
        `<button title="Remove this stop" style="padding:0 5px;font-size:11px">✕</button>`);
      const [pos, mid, alpha] = r.querySelectorAll("input");
      const stop = (x, k) => x.stops[k];
      bindUndoRange(pos, () => stop(io.get(), i).t * 100, v => { const n = Gradient.clone(io.get()); stop(n, i).t = v / 100; io.put(n); }, "stop position");
      bindUndoRange(alpha, () => stop(io.get(), i).alpha * 100, v => { const n = Gradient.clone(io.get()); stop(n, i).alpha = v / 100; io.put(n); }, "stop opacity");
      if (grey) bindUndoRange(mid, () => greyOfHex(stop(io.get(), i).color), v => { const n = Gradient.clone(io.get()); stop(n, i).color = hexOfGrey(v); io.put(n); }, "stop value");
      else {
        let from = null;
        mid.addEventListener("input", () => { if (from === null) from = stop(io.get(), i).color; const n = Gradient.clone(io.get()); stop(n, i).color = mid.value; io.put(n); });
        mid.addEventListener("change", () => {
          const f = from; from = null;
          if (f === null || f === stop(io.get(), i).color) return;
          const to = stop(io.get(), i).color;
          const set = v => { const n = Gradient.clone(io.get()); stop(n, i).color = v; io.put(n); refreshLayerList(); };
          pushAction("stop colour", () => set(f), () => set(to));
        });
      }
      r.querySelector("button").onclick = () => {
        if (g.stops.length <= 1) { setStatus(io.one, "err"); return; }
        const n = Gradient.clone(io.get()); n.stops.splice(i, 1);
        io.step("remove stop", n);
      };
    });
    const r = mk("");
    const btn = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      b.style.cssText = "padding:1px 6px;font-size:11px";
      b.onclick = fn;
      return b;
    };
    r.append(
      btn("+ stop", "Add a stop halfway between the last two (or at the middle), with the colour the gradient has there", () => {
        const n = Gradient.clone(io.get()), S = Gradient.sorted(n.stops);
        let t = .5;
        if (S.length >= 2) t = (S[S.length - 2].t + S[S.length - 1].t) / 2;
        const lut = Gradient.lut(n.stops), k = Math.round(t * (Gradient.N - 1));
        const hex = "#" + [lut[k*4], lut[k*4+1], lut[k*4+2]].map(v => v.toString(16).padStart(2, "0")).join("");
        n.stops.push({ t, color: hex, alpha: lut[k*4+3] / 255 });
        io.step("add stop", n);
      }),
      btn("reverse", "Swap the ends: every stop at 1 − its position", () => {
        const n = Gradient.clone(io.get());
        for (const s of n.stops) s.t = 1 - s.t;
        io.step("reverse gradient", n);
      }));
    const h = document.createElement("div");
    h.className = "hint";
    h.style.margin = "0 0 4px";
    h.textContent = io.hint;
    P.el.appendChild(h);
  },
};
