// ---- What each export setting does, shown rather than explained (ROADMAP 3.29) ----
// The right-hand column of the Export window. The settings do different KINDS of thing, so each
// gets the preview that is honest for it:
//   * Preset / format changes the TEXTURE. BC3 (DXT5) keeps four colours per 4×4 block on one
//     line, so a hard-edged marking gains a fringe the editor never shows, because nothing is
//     block-compressed until export. The preview is a 1:1 crop of the active slot — where the
//     2-D view is looking — encoded with the chosen format by the export pool (the same worker
//     the export uses, t33) and decoded back by the decode pool, beside the source. RGBA8 and
//     TGA are lossless, so they say so instead of drawing the same picture twice.
//   * Mipmaps and seam padding change the texture AT DISTANCE and AT ISLAND EDGES: the crop's
//     1/4-size mip beside the same crop point-sampled (what the GPU does with no chain), and the
//     crop with the texels padSeams would bleed drawn in — the export's own padSeams, on the crop.
//   * Camo under skin and Alpha change what the MODEL looks like: their preview is the viewport,
//     which reads both (rebuildMaterials), and the sentence under each control says what it shows.
//   * Mode and inverted roughness change SEMANTICS — what the game does with the file — and no
//     picture previews that honestly; the sentence under the control is the preview.
// Nothing here touches a pixel of the export: the crop is a copy, and every heavy step runs in a
// pool (CLAUDE.md §3.1). A refresh that is overtaken by a newer one throws its result away.
const ExportPreview = {
  N: 64,                               // crop side, texels; shown at 2× so a 4×4 block is 8 px
  seq: 0, timer: 0, built: false, on: false,
  cv: {},                              // name → canvas

  build(){
    if (this.built) return;
    this.built = true;
    const root = $("expPreview");
    const el = (tag, cls, text) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };
    root.appendChild(el("h4", null, "Preview"));
    const row = (id, label) => {
      const r = el("div", "pvrow"); r.id = id;
      const lab = el("div", "pvlab"); lab.appendChild(el("span", null, label));
      const tag = el("span", "tag"); tag.id = id + "Tag"; lab.appendChild(tag);
      r.appendChild(lab);
      const pair = el("div", "pvpair"); r.appendChild(pair);
      const note = el("div", "pvnote"); note.id = id + "Note"; r.appendChild(note);
      root.appendChild(r);
      return pair;
    };
    const fig = (pair, name, caption, px) => {
      const f = el("figure"); f.id = "pvFig_" + name;
      const c = document.createElement("canvas"); c.width = c.height = px; this.cv[name] = c;
      f.appendChild(c); const cap = el("figcaption", null, caption); cap.id = "pvCap_" + name; f.appendChild(cap);
      pair.appendChild(f);
    };
    let p = row("pvFmt", "Texture as exported");
    fig(p, "src", "as painted", this.N); fig(p, "out", "as exported", this.N);
    p = row("pvMip", "At distance (¼ size)");
    fig(p, "mip", "with mipmaps", this.N / 4); fig(p, "nomip", "without", this.N / 4);
    p = row("pvPad", "Seam padding");
    fig(p, "pad", "around the UV islands", this.N);
    const where = el("div", "pvnote"); where.id = "pvWhere"; root.appendChild(where);
  },
  show(on){ this.on = !!on; if (on) this.build(); $("expPreview").classList.toggle("on", this.on); },
  // Called from every place the picture can change — a stroke, a slot switch, a setting. Cheap
  // when the window is shut, and coalesced so a stroke of thirty dabs costs one encode.
  schedule(){
    if (!this.on) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 250);
  },
  // The crop: centred where the 2-D view is looking when it shows this slot, else on the sheet.
  crop(slot){
    const W = slot.composite.width, H = slot.composite.height, N = Math.min(this.N, W, H);
    let cx = W / 2, cy = H / 2;
    if (v2.sc && cnv2.width && slot === App.activeSlot) {
      const vx = (cnv2.width / 2 - v2.ox) / v2.sc, vy = (cnv2.height / 2 - v2.oy) / v2.sc;
      if (vx >= 0 && vx <= W && vy >= 0 && vy <= H) { cx = vx; cy = vy; }   // a view off the sheet means the sheet
    }
    const x = Math.max(0, Math.min(W - N, Math.round(cx - N / 2))), y = Math.max(0, Math.min(H - N, Math.round(cy - N / 2)));
    const rgba = ctx2d(slot.composite).getImageData(x, y, N, N).data;
    return { x, y, n: N, w: W, h: H, rgba };
  },
  put(name, rgba, n){
    const c = this.cv[name];
    if (c.width !== n) c.width = c.height = n;
    ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, n * n * 4), n, n), 0, 0);
  },
  async refresh(){
    this.notes();
    if (!this.on) return;
    const slot = App.activeSlot;
    const cap = (name, t) => { const e = $("pvCap_" + name); if (e) e.textContent = t; };
    const tag = (id, t) => { const e = $(id + "Tag"); if (e) e.textContent = t; };
    const note = (id, t) => { const e = $(id + "Note"); if (e) e.textContent = t; };
    if (!slot || !slot.composite) {
      for (const n of Object.keys(this.cv)) ctx2d(this.cv[n]).clearRect(0, 0, this.cv[n].width, this.cv[n].height);
      $("pvWhere").textContent = "Load a vehicle and pick a texture slot to see a crop of it here.";
      tag("pvFmt", ""); tag("pvMip", ""); tag("pvPad", ""); note("pvFmt", ""); note("pvMip", ""); note("pvPad", "");
      return;
    }
    const seq = ++this.seq;
    const c = this.crop(slot), n = c.n;
    this.put("src", c.rgba, n);
    $("pvWhere").textContent = slot.id + " · " + n + "×" + n + " texels at " + c.x + "," + c.y +
      " — pan the 2-D view to move the crop";
    // ---- format: the one preview a user cannot get any other way ----
    const fmt = exportFormats().c;
    const FMT = { bc3: "DXT5 (BC3)", rgba8: "RGBA8", tga: "TGA" };
    tag("pvFmt", FMT[fmt] || fmt);
    let out = null;
    if (fmt === "bc3") {
      try {
        const buf = c.rgba.slice().buffer;
        const dds = await exportPool().call("encodeTexture",
          { rgba: buf, mask: null, w: n, h: n, fmt: "bc3", useMips: false, renorm: false, padDist: 0 }, [buf]);
        const parsed = await parseDDSAsync(dds);
        out = parsed.mips[0].rgba;
      } catch (e) { reportFailure("Previewing the export format", e, "expprev"); }
      if (seq !== this.seq) return;                          // a newer refresh has taken over
    }
    this.put("out", out || c.rgba, n);
    if (out) {
      const d = this.diff(c.rgba, out);
      cap("out", "as exported — " + (d.max ? "up to " + d.max + " levels off" : "identical"));
      note("pvFmt", d.max
        ? d.changed + " % of texels moved by more than 8 levels. DXT5 keeps four colours per 4×4 block on one line — a " +
          "hard edge with three hues in one block bleeds. Lossless (RGBA8) keeps every texel; the file is four times larger."
        : "This crop survives DXT5 unchanged.");
    } else {
      cap("out", "as exported — identical");
      note("pvFmt", (FMT[fmt] || fmt) + " is lossless: every texel ships as painted. The file is larger than DXT5 — watch the archive limit.");
    }
    // ---- at distance: the ¼ mip against a point sample ----
    const mips = $("optMips").checked;
    tag("pvMip", mips ? "on" : "off");
    this.put("mip", this.box4(c.rgba, n), n / 4);
    this.put("nomip", this.point4(c.rgba, n), n / 4);
    $("pvFig_mip").classList.toggle("chosen", mips);
    $("pvFig_nomip").classList.toggle("chosen", !mips);
    note("pvMip", mips
      ? "With a mip chain the game averages texels at range — smoother, and less shimmer. Turn it off if you play with older-video-card support: that mode samples a lower mip and angled surfaces blur."
      : "With no chain the game picks single texels at range, so fine detail sparkles as the view moves. The game accepts it; its own extracted textures ship without one.");
    // ---- seam padding: the export's own padSeams, on the crop ----
    const pad = $("optPad").checked;
    tag("pvPad", pad ? "on" : "off");
    const mask = getUVMask(slot, c.w, c.h);
    if (!mask) {
      this.put("pad", c.rgba, n);
      note("pvPad", "No UV layout to pad against — an imported sheet with no model, or a slot no part uses.");
    } else {
      const mcrop = new Uint8Array(n * n);
      let outside = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = mask[(c.y + y) * c.w + c.x + x]; mcrop[y * n + x] = v; if (!v) outside++; }
      const padded = new Uint8ClampedArray(c.rgba);
      const dist = mips ? 32 : 8;                              // the export's own rule (encodeJob)
      if (pad) padSeams(padded, n, n, mcrop, dist);
      let bled = 0;
      for (let i = 0; i < n * n; i++) {
        if (mcrop[i]) continue;
        const k = i * 4;
        const changed = pad && (padded[k] !== c.rgba[k] || padded[k+1] !== c.rgba[k+1] || padded[k+2] !== c.rgba[k+2] || padded[k+3] !== c.rgba[k+3]);
        if (changed) { bled++; padded[k] = (padded[k] + 79) >> 1; padded[k+1] = (padded[k+1] + 143) >> 1; padded[k+2] = (padded[k+2] + 247) >> 1; padded[k+3] = 255; }
        else { padded[k] >>= 2; padded[k+1] >>= 2; padded[k+2] >>= 2; padded[k+3] = 255; }
      }
      this.put("pad", padded, n);
      note("pvPad", !outside ? "This crop is inside one island — nothing to pad here; pan to an island edge to see it."
        : pad ? bled + " of the " + outside + " texels outside the islands in this crop are filled from the nearest edge (tinted), " + dist + " texels deep, so the renderer's filtering never reads the void and no dark rim shows at a seam."
        : "Off: the " + outside + " texels outside the islands stay as they are, and bilinear filtering at every island edge reads them — a dark rim in game.");
    }
  },
  diff(a, b){
    let max = 0, moved = 0;
    const n = a.length / 4;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]), Math.abs(a[i+3] - b[i+3]));
      if (d > max) max = d;
      if (d > 8) moved++;
    }
    return { max, changed: Math.round(100 * moved / n) };
  },
  box4(rgba, n){
    const m = n / 4, out = new Uint8ClampedArray(m * m * 4);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const acc = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const k = ((y * 4 + j) * n + x * 4 + i) * 4; acc[0] += rgba[k]; acc[1] += rgba[k+1]; acc[2] += rgba[k+2]; acc[3] += rgba[k+3]; }
      const o = (y * m + x) * 4;
      out[o] = acc[0] / 16; out[o+1] = acc[1] / 16; out[o+2] = acc[2] / 16; out[o+3] = acc[3] / 16;
    }
    return out;
  },
  point4(rgba, n){
    const m = n / 4, out = new Uint8ClampedArray(m * m * 4);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const k = ((y * 4) * n + x * 4) * 4, o = (y * m + x) * 4;
      out[o] = rgba[k]; out[o+1] = rgba[k+1]; out[o+2] = rgba[k+2]; out[o+3] = rgba[k+3];
    }
    return out;
  },
  // ---- the settings no picture previews honestly: one sentence each, under the control ----
  notes(){
    const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    const cls = vehicleClass(), mode = exportMode(), auto = $("expMode").value === "auto";
    const CLS = { tank: "a ground vehicle", ship: "a ship", air: "an aircraft", heli: "a helicopter" };
    set("expModeNote", mode === "set_tex"
      ? "set_tex: the game keeps the vehicle's own texture and lays your sheet beside it as camo_skin_tex, so in-game decals and the condition wear still work; your alpha decides where the player's camouflage shows through."
        + (auto ? " Auto picked it because this is " + (CLS[cls] || "a " + cls) + "." : "")
      : "replace_tex: your sheet replaces the game's texture outright — the only form an aircraft can take. In-game decals and wear then come only from what you painted, and the alpha is the real paint mask."
        + (auto ? " Auto picked it because this is " + (CLS[cls] || "a " + cls) + "." : ""));
    const slot = App.activeSlot;
    const alpha = $("expAlpha").value;
    let a;
    if (!slot) a = "";
    else {
      const cx = ExportCollect.ctx(true);
      const keep = ExportCollect.wantsMask(cx, slot);
      const why = chanHasLayers(slot, "wear") ? "you painted a wear mask, and a painted mask always wins"
        : alpha === "keep" ? "you asked for it"
        : alpha === "opaque" ? "you asked for it"
        : cx.groundPaint ? "auto: a set_tex skin ships opaque, the way every published ground skin does — the vehicle's own texture supplies the wear"
        : "auto: with replace_tex the sheet is the albedo and its alpha is the paint mask";
      a = (keep ? "The alpha is kept" : "The alpha ships fully opaque (255)") + " — " + why + ". The 3-D view shows it: " +
        (keep ? "where the sheet is not fully opaque, the camouflage under it shows through." : "the sheet covers the camouflage everywhere.");
    }
    set("expAlphaNote", a);
    set("expRoughNote", $("optInvRough").checked
      ? "The _n red channel is written as it is: inverted roughness, the game's own form since 2022. Textures pulled from the game are already in it."
      : "The red channel is converted from plain smoothness with the post-2022 curve, 1 − (1 − 0.7·s)³. Only for a sheet you authored as smoothness — converting a game texture twice makes everything glossier.");
  },
};
