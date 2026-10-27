"use strict";
// ---------- Which mip level the views show — the preview as in game (ROADMAP 4.58 (b), docs/MIP_LEVELS.md §5) ----------
// The GPU picks a mip level per screen pixel, so what a skin looks like at a distance — and, for a
// UserSkin, at a grazing angle — is whatever its chain holds there. Three things decide which level
// the view samples, and this object owns all three:
//
//  * THE CHAIN ON THE GPU. A sheet without level content lets the GPU generate its chain from level 0,
//    which is what the export's box filter writes (`BCnEnc.buildMips`), so nothing changes for it. A
//    sheet WITH level content (`Levels.restarts` finds more than level 0) is uploaded with its own
//    levels: level 0 is the live sheet, so a stroke still updates level 0's rectangle at once
//    (`uploadTexRegion`, the 16 ms budget unchanged); each restart is the walk at that level
//    (`Composite.at`) halved down to its size and the levels between are halvings — brought up to
//    date at idle once the edits stop, over the rectangle the edits touched, one restart per task,
//    never inside a stroke frame (CLAUDE.md §3.3, §3.4), and sent to the GPU level by level as
//    rectangles. A halving at exactly 2:1 is the 2 x 2 box mean, the export's filter.
//  * AS IN GAME (`on`). x1, because the game's anisotropy setting does not reach UserSkins (the
//    owner, 2026-10-24); no chain at all where the export writes none (the Mipmaps tick off and no
//    level content: the game shows level 0 at every distance, §2); texture quality as the chain
//    uploaded from level q; and the screen as a LOD bias inlined into the material
//    (`lodBias`), log2 of how many more pixels this view's height spans per unit of tan(fov/2)
//    than the game's: the viewport's own height and field of view against `screen` and
//    `Levels.VIEW`'s assumed 50° — so a distance in this view is that distance in the game.
//  * THE 2-D VIEW'S LEVEL (`at2d`): level k of the sheet the 2-D view shows, scaled up texel for
//    texel, from the same chain. Strokes still land on the layer at full size.
//
// The Levels view (`levelsTex`) is a chain of the sheet's own size whose level k is one flat colour
// with its number — so which colour shows is the GPU's own choice under the settings above, exact
// rather than a formula (t164 renders it at known distances and reads the level back).
const LevelView = {
  // Decided without the owner (2026-10-24): texture quality High — no top level dropped. The
  // engine's DDS reader uploads a plain .dds's levels as they are (§2), and a UserSkin has no DDSx
  // header to say what to skip. To be set from his ruler answer to question 2 — the one number.
  QUALITY: 0,
  QUALITIES: ["High", "Medium", "Low"],
  SCREENS: [1080, 1440, 2160],
  DISTANCES: [8, 50, 200, 1000],          // 3rd person, then §5's presets
  CHANS: ["color", "smooth", "metal", "normal"],
  DEBOUNCE: 250,                          // ms after the last edit before the levels follow
  on: false,
  quality: 0,
  screen: 1440,
  at2d: 0,
  view: null,                             // a fixed { h, fov } for a test; null is the viewport's own
  stats: { builds: 0 },
  // What the page lends: the export's Mipmaps tick and the readout (ui/panels/ingame.js — the DOM is
  // the UI layer's).
  mipsTick(){ return false; },
  onReadout(){},
  _dirty: new Map(),                      // slot → Set of channels whose levels are stale
  _timer: 0,
  _run: null,
  _s: [],                                 // halving scratch, one per depth, released after each run
  _ltex: new Map(),                       // the Levels view's textures, by size and settings
  _raf: 0,
  _bias: 0,
  _bt: 0,
  _text: "",

  // ---- what is sampled ----
  group(ch){ return ch === "color" ? ["color", "wear"] : ["smooth", "metal", "normal"]; },
  tex(slot, ch){ return ch === "color" ? slot.tex || null : (slot.texCh && slot.texCh[ch]) || null; },
  // The live sheet a channel's chain is built from — never the original Compare shows.
  sheet(slot, ch){ return ch === "color" ? slot.composite || null : chanOut(slot, ch) || slot[ch] || null; },
  // The level-0 sheet the 3-D view shows right now: the original while Compare is held.
  shown(slot, ch){
    if (!App.compare) return LevelView.sheet(slot, ch);
    return ch === "color" ? slot.baseC || null : chanBase(slot, ch) || slot[ch] || null;
  },
  // How this channel's texture is drawn:
  //   gpu    the GPU generates the chain from level 0, as before
  //   none   level 0 alone — as in game, where the export writes no chain
  //   chain  the chain built here: the sheet's own level content, or texture quality dropping levels
  mode(slot, ch){
    const src = slot && LevelView.shown(slot, ch);
    if (!src || !src.width) return null;
    const last = Levels.last(src.width, src.height);
    const own = !App.compare && Levels.restarts(slot, [ch], last).length > 1;
    const ships = own || LevelView.mipsTick() || Levels.restarts(slot, LevelView.group(ch), last).length > 1;
    if (LevelView.on && !ships) return { kind: "none", src, last, q: 0, own };
    const q = LevelView.on && !App.compare ? Math.min(LevelView.quality, last) : 0;
    return { kind: own || q ? "chain" : "gpu", src, last, q, own };
  },
  // The channel the 2-D view shows, if it is one a chain is built for.
  ch2d(){
    const v = App.chanView;
    if (LevelView.CHANS.includes(v)) return v;
    if (v && v !== "shaded" && v !== "levels") return null;          // a raw byte or the wear view
    const c = Tool.chanOf(App.brush.mode) || "color";
    return LevelView.CHANS.includes(c) ? c : null;
  },
  needs(slot, ch, m){
    m = m || LevelView.mode(slot, ch);
    return !!m && (m.kind === "chain" || (LevelView.at2d > 0 && slot === App.activeSlot && ch === LevelView.ch2d()));
  },

  // ---- after every composite of a channel ----
  // Cheap on purpose — it runs on every stroke frame: it asks the mode, marks the rectangle of the
  // chain that went stale, and re-points the texture only when what it should be drawn from has
  // changed. `rect` is what the composite wrote, in composite space: null the whole sheet, and
  // undefined no change to the content at all (a setting moved, `refreshAll`).
  touched(slot, ch, rect){
    const m = LevelView.mode(slot, ch);
    if (!m) return;
    if (LevelView.needs(slot, ch, m)) LevelView.want(slot, ch, rect);
    // Nothing shows it: give it back — but not for Compare, which lets go a moment later.
    else if (!App.compare && slot._lvc && slot._lvc[ch]) LevelView.drop(slot, ch);
    LevelView.apply(slot, ch, m);
  },
  refreshAll(){
    for (const s of App.slots.values()) for (const ch of LevelView.CHANS) if (LevelView.tex(s, ch)) LevelView.touched(s, ch);
  },
  // Point the texture at what it should be drawn from. A full upload only when that changed — the
  // chain's own content follows rectangle by rectangle (`upload`).
  apply(slot, ch, m){
    const tex = LevelView.tex(slot, ch);
    if (!tex) return;
    m = m || LevelView.mode(slot, ch);
    if (!m) return;
    const aniso = LevelView.on ? 1 : ch === "color" ? 8 : 1;
    let kind = m.kind, levels = null;
    if (kind === "chain") {
      const c = LevelView.chainOf(slot, ch);
      // Until its levels are built a chain is drawn the old way, from the live sheet.
      if (c && c.w === m.src.width && c.h === m.src.height && c.levels.length === m.last + 1) levels = [m.src].concat(c.levels.slice(1)).slice(m.q);
      else kind = "gpu";
    }
    const img = levels ? levels[0] : m.src, key = kind + "|" + m.q + "|" + aniso;
    const was = tex._lv;
    if (was && was.key === key && tex.image === img && (levels ? tex.mipmaps.length === levels.length && tex.mipmaps.every((c, i) => c === levels[i]) : !tex.mipmaps.length)) return;
    tex.image = img;
    tex.mipmaps = levels || [];
    tex.generateMipmaps = kind === "gpu";
    tex.minFilter = kind === "none" ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    tex.anisotropy = aniso;
    // Level 0 on the GPU is not the live sheet (texture quality dropped it), so a stroke frame has
    // nothing to upload — `uploadTexRegion` leaves it, and the chain's rectangles land at idle.
    tex._lv = { key, q: m.q, chained: !!levels, detached: !!(levels && m.q) };
    tex.needsUpdate = true;
    needsRender();
  },

  // ---- the chain, kept up to date at idle ----
  chainOf(slot, ch){ const c = slot._lvc && slot._lvc[ch]; return c && c.ready ? c : null; },
  // Mark what went stale — c.dirty: undefined clean, null the whole sheet, else a rectangle in the
  // sheet's own texels — and ask for a run once the edits stop.
  want(slot, ch, rect){
    const c = slot._lvc && slot._lvc[ch];
    if (c && rect !== undefined) {
      if (rect === null || c.dirty === null) c.dirty = null;
      else {
        const R = rectClamp(rectFromSlot(slot, rect, c.w, c.h), c.w, c.h);
        if (R) c.dirty = c.dirty ? rectUnion(c.dirty, R) : R;
      }
    }
    if (c && c.ready && c.dirty === undefined) return;                // built and nothing stale
    let set = LevelView._dirty.get(slot);
    if (!set) LevelView._dirty.set(slot, set = new Set());
    set.add(ch);
    clearTimeout(LevelView._timer);
    LevelView._timer = setTimeout(() => LevelView.run(), LevelView.DEBOUNCE);
  },
  drop(slot, ch){
    if (!slot._lvc) return;
    for (const k of ch ? [ch] : Object.keys(slot._lvc)) {
      const c = slot._lvc[k];
      if (c) for (let i = 1; i < c.levels.length; i++) if (c.levels[i]) c.levels[i].width = c.levels[i].height = 0;
      delete slot._lvc[k];
    }
  },
  alive(slot){ return App.slots.get(slot.id) === slot; },
  pause(){ return new Promise(r => setTimeout(r, 0)); },
  run(){
    clearTimeout(LevelView._timer); LevelView._timer = 0;
    if (LevelView._run) return LevelView._run.then(() => (LevelView._dirty.size ? LevelView.run() : undefined));
    const p = (async () => {
      while (LevelView._dirty.size) {
        const [slot, set] = LevelView._dirty.entries().next().value;
        LevelView._dirty.delete(slot);
        for (const ch of set) {
          if (!LevelView.alive(slot) || !LevelView.needs(slot, ch)) continue;
          let done = null;
          try { done = await LevelView.build(slot, ch); }
          catch (e) { reportFailure("building the mip levels the view shows", e, "levelview"); continue; }
          if (LevelView.alive(slot)) LevelView.upload(slot, ch, done);
        }
        if (slot === App.activeSlot && LevelView.at2d) draw2D();
      }
      for (const c of LevelView._s) if (c) c.width = c.height = 0;
      LevelView._s = [];
      if (LevelView._up) LevelView._up.width = LevelView._up.height = 1;   // the staging canvas, back to nothing
    })().finally(() => { if (LevelView._run === p) LevelView._run = null; });
    LevelView._run = p;
    return p;
  },
  // The stale rectangle of every level below the top, into canvases kept between runs (allocated
  // once per size, §3.6). Level k's rectangle is the sheet's divided by 2^k, rounded outwards. A
  // level the stack restarts at is the walk at that level over the same rectangle at full size,
  // widened to whole 2^k blocks, and halved k times; any other level is its level above halved.
  // So a stroke costs the restarts a region walk each, the way it costs the live sheet one, and the
  // GPU a texSubImage2D per level. Measured 2026-10-24 (t47, 4096², one restart, software raster):
  // the pause after a stroke 6–8 ms; walking the whole sheet instead 151–195 ms, and re-uploading
  // the texture whole after each run 94–131 ms — the second also made the next stroke's endStroke
  // pay ~150 ms, writing into a sheet the upload had just read. Each restart is its own task.
  // Returns the rectangles written, level by level, or null.
  async build(slot, ch){
    const src = LevelView.sheet(slot, ch);
    if (!src || !src.width) return null;
    const W = src.width, H = src.height, last = Levels.last(W, H);
    const lvc = slot._lvc || (slot._lvc = {});
    let c = lvc[ch];
    if (c && c.ready && c.w === W && c.h === H && c.dirty === undefined) return null;
    if (!c || c.w !== W || c.h !== H || !c.ready) { LevelView.drop(slot, ch); c = lvc[ch] = { w: W, h: H, levels: [src], gen: 0, ready: false, dirty: null }; }
    let R = c.dirty;
    c.dirty = undefined;                                 // what changes from here on is the next run's
    // A blur reads round each texel and a camouflage tile wraps: a rectangle is not enough there.
    if (!R || Composite.reach(slot, ch) || CamoTile.is(slot)) R = { x: 0, y: 0, w: W, h: H };
    const at = new Set(Levels.restarts(slot, [ch], last)), out = [];
    c.levels[0] = src;                                   // the sheet can be a new canvas of the same size
    let full = null, ok = false;
    try {
      for (let k = 1; k <= last; k++) {
        const w = Math.max(1, W >> k), h = Math.max(1, H >> k), s = Math.pow(2, k);
        let dst = c.levels[k];
        if (!dst || dst.width !== w || dst.height !== h) dst = c.levels[k] = mkCanvas(w, h);
        const x = Math.min(w - 1, Math.floor(R.x / s)), y = Math.min(h - 1, Math.floor(R.y / s));   // a sheet that is no power of two
        const Rk = { x, y, w: Math.max(1, Math.min(w, Math.ceil((R.x + R.w) / s)) - x), h: Math.max(1, Math.min(h, Math.ceil((R.y + R.h) / s)) - y) };
        if (at.has(k)) {
          await LevelView.pause();
          if (!LevelView.alive(slot) || lvc[ch] !== c) return null;
          if (LevelView.sheet(slot, ch) !== src) return null;           // resized or re-pointed meanwhile: the next run starts over
          const A = { x: Rk.x * s, y: Rk.y * s, w: Math.min(W, (Rk.x + Rk.w) * s) - Rk.x * s, h: Math.min(H, (Rk.y + Rk.h) * s) - Rk.y * s };
          const prev = full;
          full = Composite.at(slot, ch, k, full, A);
          if (prev && prev !== full) prev.width = prev.height = 0;      // a region of another size: give the old one back
          if (full) LevelView.reduce(full, k, dst, Rk);
          else LevelView.halfRect(c.levels[k - 1], dst, Rk);
        } else LevelView.halfRect(c.levels[k - 1], dst, Rk);
        out.push([k, Rk]);
      }
      ok = true;
    } finally {
      if (full) full.width = full.height = 0;
      if (!ok) { c.dirty = null; if (lvc[ch] === c) LevelView.want(slot, ch); }   // unfinished: all of it is stale again
    }
    c.levels.length = last + 1;
    c.gen++;
    c.ready = true;
    LevelView.stats.builds++;
    return out;
  },
  // Level k's rectangle from the one above it: its rectangle doubled, clipped where a side of the
  // level above has run down to one texel.
  halfRect(src, dst, Rk){
    const sx = Math.min(src.width - 1, Rk.x * 2), sy = Math.min(src.height - 1, Rk.y * 2);
    LevelView.half(src, sx, sy, Math.max(1, Math.min(Rk.w * 2, src.width - sx)), Math.max(1, Math.min(Rk.h * 2, src.height - sy)), dst, Rk);
  },
  // A walk of 2^k blocks down to level k, one exact halving at a time, landing on Rk.
  reduce(full, k, dst, Rk){
    let cur = full;
    for (let j = 1; j < k; j++) {
      const w = Math.max(1, full.width >> j), h = Math.max(1, full.height >> j);
      let t = LevelView._s[j];
      if (!t || t.width !== w || t.height !== h) t = LevelView._s[j] = mkCanvas(w, h);
      LevelView.half(cur, 0, 0, cur.width, cur.height, t, { x: 0, y: 0, w, h });
      cur = t;
    }
    LevelView.half(cur, 0, 0, cur.width, cur.height, dst, Rk);
  },
  // At exactly 2:1 the default bilinear samples halfway between each pair of texels, so it IS the
  // 2 × 2 box mean, and reads nothing outside its source rectangle (wt-canvas: anything smaller than
  // 2:1 samples and loses texels; this never is). Cleared first, so the rectangle is replaced.
  half(src, sx, sy, sw, sh, dst, D){
    const g = ctx2d(dst);
    g.save();
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none";
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "low";
    g.clearRect(D.x, D.y, D.w, D.h);
    g.drawImage(src, sx, sy, sw, sh, D.x, D.y, D.w, D.h);
    g.restore();
  },
  // What a run wrote, onto the GPU: each level's rectangle into that level of the texture
  // (texSubImage2D at level k − q), never a re-upload of level 0. A texture not yet drawn from this
  // chain is re-pointed instead, which uploads it whole once.
  upload(slot, ch, done){
    const tex = LevelView.tex(slot, ch), m = tex && LevelView.mode(slot, ch);
    if (!m) return;
    const c = LevelView.chainOf(slot, ch), was = tex._lv;
    if (!done || !c || m.kind !== "chain" || !was || !was.chained || was.q !== m.q || tex.mipmaps[1] !== c.levels[m.q + 1]) { LevelView.apply(slot, ch, m); return; }
    for (const [k, Rk] of done) if (k >= m.q) LevelView.copyLevel(tex, k - m.q, c.levels[k], Rk);
    needsRender();
  },
  copyLevel(tex, level, src, R){
    if (!renderer || !texRegionOk) { tex.needsUpdate = true; return; }
    try {
      const c = LevelView._up || (LevelView._up = mkCanvas(1, 1));
      if (c.width !== R.w || c.height !== R.h) { c.width = R.w; c.height = R.h; }
      const g = ctx2d(c);
      g.clearRect(0, 0, R.w, R.h);
      g.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
      const st = LevelView._upT || (LevelView._upT = new THREE.CanvasTexture(c));
      st.image = c;
      const y = tex.flipY ? src.height - (R.y + R.h) : R.y;          // GL's rows run bottom-up
      renderer.copyTextureToTexture(new THREE.Vector2(R.x, y), st, tex, level);
    } catch (e) {
      reportFailure("updating a mip level of the 3-D view", e, "levelview-up");
      tex.needsUpdate = true;
    }
  },
  // Everything pending, now — for a test, and for anything that must read the levels this frame.
  async settle(){
    for (let i = 0; i < 4; i++) {
      flushComposites();
      await LevelView.run();
      if (!LevelView._dirty.size && !compPending.size && !chanPending.size) return;
    }
  },

  // ---- the settings ----
  set(o){
    const was = LevelView.on + "|" + LevelView.quality + "|" + LevelView.screen;
    if ("on" in o) LevelView.on = !!o.on;
    if ("quality" in o) LevelView.quality = Math.max(0, Math.min(LevelView.QUALITIES.length - 1, Math.round(+o.quality) || 0));
    if ("screen" in o) LevelView.screen = +o.screen > 0 ? +o.screen : Levels.VIEW.height;
    if ("at2d" in o) LevelView.at2d = Math.max(0, Math.min(Levels.TOP, Math.round(+o.at2d) || 0));
    LevelView.refreshAll();
    if (was !== LevelView.on + "|" + LevelView.quality + "|" + LevelView.screen) { LevelView.dropLevelsTex(); rebuildMaterials(); }
    if (LevelView.on && !LevelView._raf) { LevelView._bias = LevelView.bias(); LevelView._raf = requestAnimationFrame(LevelView.tick); }
    LevelView.readout();
    draw2D();
  },
  mipsChanged(){
    LevelView.refreshAll();
    if (App.chanView === "levels") { LevelView.dropLevelsTex(); rebuildMaterials(); }
  },
  // While in game: the readout, and the materials rebuilt once the view's bias has moved (a resize).
  tick(){
    if (!LevelView.on) { LevelView._raf = 0; return; }
    LevelView._raf = requestAnimationFrame(LevelView.tick);
    LevelView.readout();
    const b = LevelView.bias();
    if (b !== LevelView._bias) {
      LevelView._bias = b;
      clearTimeout(LevelView._bt);
      LevelView._bt = setTimeout(rebuildMaterials, 150);
    }
  },

  // ---- the screen, as a LOD bias ----
  setView(h, fov){ LevelView.view = h ? { h, fov } : null; },
  viewNow(){
    if (LevelView.view) return LevelView.view;
    if (!renderer || !camera) return null;
    return { h: renderer.getDrawingBufferSize(new THREE.Vector2()).y, fov: camera.fov };
  },
  // log2 of (this view's pixels per unit of tan(fov/2)) over (the game's). A texel spanning n of
  // the game's pixels spans n·2^bias of this view's at the same distance, so adding the bias to the
  // view's level gives the game's. In 1/16ths, so a resize by a pixel does not recompile a program.
  bias(){
    const v = LevelView.viewNow();
    if (!v || !v.h || !v.fov) return 0;
    const t = d => Math.tan(d * Math.PI / 360);
    return Math.round(16 * Math.log2((v.h / t(v.fov)) / (LevelView.screen / t(Levels.VIEW.fov)))) / 16;
  },

  // ---- the bias, inlined into a material (docs/MIP_LEVELS.md §5) ----
  // The level the GPU samples depends on how many screen pixels a texel spans, so the same camera
  // distance picks a coarser level in an 800-pixel viewport than on a 1440p screen. `LevelView.bias()`
  // is the difference in levels, and adding it to every texture read of the sheets (texture2D's bias
  // argument) makes a distance here the same distance in the game. Inlined, with the cache key carrying
  // it, because r128 shares uniform objects between materials on one program (wt-canvas); composed onto
  // whatever the material already patched, and the chunks it reads through are expanded first, because
  // the includes are still unresolved when onBeforeCompile runs (see `applySurfaceMaps`).
  lodBias(m, b){
    const prevCompile = m.onBeforeCompile;
    const prevKey = Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey") ? m.customProgramCacheKey : null;
    const v = b.toFixed(4);
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) + "|" : "") + "wtlod:" + v;
    m.onBeforeCompile = (shader, r) => {
      if (prevCompile) prevCompile.call(m, shader, r);
      for (const name of ["map_fragment", "normal_fragment_maps", "roughnessmap_fragment", "metalnessmap_fragment"]) {
        const inc = "#include <" + name + ">";
        if (THREE.ShaderChunk[name] && shader.fragmentShader.indexOf(inc) >= 0) shader.fragmentShader = shader.fragmentShader.replace(inc, THREE.ShaderChunk[name]);
      }
      shader.fragmentShader = shader.fragmentShader.replace(/texture2D\( (map|normalMap|roughnessMap|metalnessMap), vUv \)/g, "texture2D( $1, vUv, " + v + " )");
    };
    return m;
  },

  // ---- the camera's distance ----
  dolly(d){
    if (cam.fly) { setStatus("Leave the fly camera (F) to put it a distance away", "err"); return; }
    cam.glide = null;
    cam.dist = d;
    if (camera.far < d * 4) { camera.far = d * 4; camera.updateProjectionMatrix(); }
    needsRender();
    LevelView.readout();
  },
  readout(){
    let t = "";
    if (LevelView.on && cam && cam.target) {
      const d = cam.fly && cam.flyPos ? cam.flyPos.distanceTo(cam.target) : cam.dist;
      t = (d < 10 ? d.toFixed(1) : String(Math.round(d))) + " m";
    }
    if (t !== LevelView._text) { LevelView._text = t; LevelView.onReadout(t); }
  },

  // ---- the Levels view ----
  levelsTex(slot){
    const m = LevelView.mode(slot, "color");
    if (!m) return null;
    const W = m.src.width, H = m.src.height, top = m.kind === "none" ? 0 : m.last, aniso = LevelView.on ? 1 : 8;
    const key = W + "x" + H + "|" + m.kind + "|" + m.q + "|" + aniso;
    let t = LevelView._ltex.get(key);
    if (t) return t;
    const levels = [];
    for (let k = m.q; k <= Math.max(m.q, top); k++) levels.push(LevelView.swatch(k, Math.max(1, W >> k), Math.max(1, H >> k)));
    t = new THREE.CanvasTexture(levels[0]);
    if (m.kind !== "none") t.mipmaps = levels;
    t.generateMipmaps = false;
    t.minFilter = m.kind === "none" ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;               // on screen the ruler's own colours, as the exported ruler shows them
    t.anisotropy = aniso;
    LevelView._ltex.set(key, t);
    return t;
  },
  // Level k as its ruler colour, with its number at the middle of every 64-texel cell — never at a
  // cell's corner, so the sheet's corner, where a repeating plane's middle lands, is the colour alone.
  swatch(k, w, h){
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.fillStyle = Levels.COLORS[k] || "#808080";
    g.fillRect(0, 0, w, h);
    if (Math.min(w, h) >= 64) {
      g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 4; g.lineJoin = "round"; g.strokeStyle = "#ffffff"; g.fillStyle = "#000000";
      for (let y = 32; y < h; y += 64) for (let x = 32; x < w; x += 64) { g.strokeText(String(k), x, y); g.fillText(String(k), x, y); }
    }
    return c;
  },
  dropLevelsTex(){
    for (const t of LevelView._ltex.values()) {
      for (const c of t.mipmaps.length ? t.mipmaps : [t.image]) if (c) c.width = c.height = 0;
      t.dispose();
    }
    LevelView._ltex.clear();
  },

  // ---- the 2-D view ----
  // Level k of the sheet the 2-D view shows, or `src` where there is none (level 0, Compare held,
  // a raw byte view, or levels not built yet — then they are asked for).
  in2d(s, src){
    const k = LevelView.at2d;
    if (!k || App.compare || !s) return src;
    const ch = LevelView.ch2d(), live = ch && LevelView.sheet(s, ch);
    if (!live) return src;
    const c = LevelView.chainOf(s, ch);
    if (!c || c.w !== live.width || c.h !== live.height) { LevelView.want(s, ch); return src; }
    const i = Math.min(k, c.levels.length - 1);
    return i > 0 ? c.levels[i] : src;
  },
};
LevelView.quality = LevelView.QUALITY;
LevelView.screen = Levels.VIEW.height;
