// ---------- Placeholder art for slots with no texture yet ----------
const PLACEHOLDER_SIZE = 1024;
function makePlaceholderCanvas(w, h){
  const c = mkCanvas(w, h), g = ctx2d(c);
  const cell = Math.max(16, w >> 5);
  g.fillStyle = "#6d727b"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#5b616a";
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell)
    if (((x / cell) + (y / cell)) & 1) g.fillRect(x, y, cell, cell);
  return c;
}

async function addFiles(files){
  let gotTex = false, gotObj = false;
  const errs = [];
  for (const f of files) {
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith(".obj")) {
        setStatus("Reading " + f.name + "…");
        const text = await f.text();
        setStatus("Parsing OBJ (" + (text.length/1048576).toFixed(0) + " MB)…");
        await new Promise(r => setTimeout(r, 30));
        const parsed = parseOBJ(text);
        setStatus("Building geometry…");
        await new Promise(r => setTimeout(r, 10));
        Cockpit.reset();                     // a dropped model is the EXTERIOR body (4.14)
        App.geomData = buildGeometryData(parsed);
        App.objRaw = { name: f.name, text }; // kept for self-contained project files
        App.objName = f.name.replace(/\.obj$/i, "").replace(/_\d+$/, "");
        if (!$("vehicleId").value) { $("vehicleId").value = App.objName; refreshVehicleIdLock(); }
        gotObj = true;
      } else if (name.endsWith(".dds") || name.endsWith(".tga")) {
        const buf = await f.arrayBuffer();
        // The raw bytes are kept for self-contained project files. parseDDSAsync transfers the
        // buffer to the decode worker and hands it back as .raw, so `buf` is detached after it.
        let dec;
        if (name.endsWith(".dds")) dec = await parseDDSAsync(buf);
        else { dec = TGA.parseTGA(buf); dec.raw = buf; }
        dec.fileName = f.name;
        dec.rawName = f.name;
        App.decoded.set(texStemOf(f.name), dec);
        gotTex = true;
      } else if (/\.(png|jpe?g|webp)$/.test(name)) {
        const bmp = await createImageBitmap(f);
        await useDroppedImage(bmp, f.name);
      } else if (name.endsWith(".wtproj")) {
        await loadProject(f);
      } else if (name.endsWith(Stack.EXT)) {
        await Stack.load(f);                        // a saved group, onto the active texture (4.44's seventh)
      } else if (Interchange.EXTS.some(e => name.endsWith(e))) {
        await Interchange.importFile(f);            // another editor's layers, onto the active texture (4.50 (16))
      }
    } catch (e) { errs.push(f.name + ": " + e.message); console.error(e); }   // one bad file must not lose the rest
  }
  if (gotObj || gotTex) rebuildAll();
  if (errs.length) setStatus(errs.length + " file(s) failed — " + errs.slice(0, 2).join(" · ") + (errs.length > 2 ? "…" : ""), "err");
}
let pendingDecal = null;

function rebuildAll(){
  const stems = new Set(App.decoded.keys());
  if (App.geomData) {
    rebindMaterials(stems);
    completeSlots(stems);
    buildScene();
  } else {
    // textures without model: still allow 2D editing
    for (const stem of stems) {
      if (stem.endsWith("_n")) continue;
      const base = stem.replace(/_c$/, "");
      if (!App.slots.has(base)) ensureSlot({ stem: base, c: stem, n: stems.has(base + "_n") ? base + "_n" : null });
    }
    completeSlots(stems);
  }
  refreshSlotList();
  updateTabCounts();
  Cockpit.refreshControl();                      // Exterior / Cockpit: enabled once there is a model to switch (4.14)
  if (!App.activeSlot && App.slots.size) { const d = defaultSlotId(); if (d) selectSlot(d); }
  const wl = $("welcome");
  if (App.slots.size || App.geomData) wl.style.display = "none";
  // Land on Textures once there is something to paint (ROADMAP 3.23). This is the one funnel every
  // load runs through — a vehicle from the game files, a dropped .obj, a .wtproj, a skin — so the
  // four used to differ only by accident, and the first thing after every load was the same click.
  //
  // Only from the tab the app OPENS on, never from Parts or Weapons. Somebody replacing a model while
  // they are in Parts is somewhere on purpose, and moving them is a mode change nobody asked for.
  // Vehicle is not an exception to that: it is where you go to *load* something, so a load
  // finishing is the moment its job is done.
  if (App.slots.size && (!App.leftTab || App.leftTab === "vehicle")) showTab("paint");
  // Which tools can write is a question about the slot in front of you, and this is the one funnel
  // every load runs through — so it is refreshed here, not only where a slot is SELECTED. The
  // difference is ROADMAP 4.40: a slot exists from the material rebind before its textures have
  // decoded, so the first pass through here correctly disables every surface tool, and the second
  // pass (the one where completeSlots binds the _n on) took the `!App.activeSlot` branch above and
  // refreshed nothing. The tools stayed dead until setPaint3d happened to call this, which is why
  // the report was "the type only becomes selectable once the brush is switched on".
  updateBrushAvailability();
  const nSlots = App.slots.size, nMats = App.geomData ? App.geomData.length : 0;
  setStatus((App.geomData ? "Model: " + nMats + " materials · " : "") + nSlots + " texture slot" + (nSlots === 1 ? "" : "s") + " ready", "ok");
  tryApplyProject();
}
function slotSize(id){ const s = App.slots.get(id); return s ? s.size : 0; }
// ---- which slot to open first ----
// Ranking by texture size put the cockpit sheet in front of the airframe on nearly every
// aircraft — both are 4096², so it came down to sort order — and the 2D view opened on instrument
// panels. Rank by how much of the *exterior* a slot actually covers instead: triangles of parts
// that are not interior, not an effect billboard, not unposed cloth and not a loaded store.
// Texture size is only the tie-break, and the whole answer when no model is loaded.
const INTERIOR_GROUPS = new Set(["Cockpit & interior", "Interior"]);
const INTERIOR_NAME_RE = /inside|interior|interrior|cockpit|pilot|dashboard|gauge/i;
function slotExteriorArea(){
  const area = new Map();
  if (!App.geomData) return area;
  for (const g of App.geomData) {
    if (g.weapon || g.skinned || isEffectMat(g.name, g.mat)) continue;
    if (INTERIOR_GROUPS.has(partGroupOf(g.name)) || INTERIOR_NAME_RE.test(g.name)) continue;
    const id = App.matSlot.get(g.mat);
    if (!id) continue;
    area.set(id, (area.get(id) || 0) + g.position.length / 9);
  }
  return area;
}
function defaultSlotId(){
  const ids = [...App.slots.keys()];
  if (!ids.length) return null;
  const area = slotExteriorArea();
  return ids.sort((a, b) => (area.get(b) || 0) - (area.get(a) || 0) || slotSize(b) - slotSize(a))[0];
}

// Resolve (and cache) the authoritative material→texture map for a model from GameResDesc.
function descBindFor(modelName){
  if (!modelName || !GameDB.desc) return null;
  const key = modelName.toLowerCase();
  if (GameDB.descBindCache.has(key)) return GameDB.descBindCache.get(key);
  let bind = null;
  for (const d of GameDB.descDbs) { const b = buildDescBind(d.db, modelName); if (b) { bind = b; break; } }
  GameDB.descBindCache.set(key, bind);
  return bind;
}
// Every non-effect material gets a slot, textured or not. Materials sitting on a
// placeholder are re-matched on each rebuild so textures can arrive in any order.
// GameResDesc (dynModelDesc.bin) is consulted first for the exact texture names —
// this is what lets the F-4E airframe and the Su-30's "unknown_N" materials resolve.
function rebindMaterials(stems){
  const bind0 = descBindFor(App.vehicleKey || App.objName);
  // A loaded weapon brings its own material->texture map; without it the bomb's materials land on
  // the aircraft's albedo by name guessing. The cockpit body's joins the same way, qualified, while it is on screen (4.14).
  const extra = [...App.extraBinds.values()].concat(Cockpit.current() === "cockpit" && Cockpit.bind() ? [Cockpit.bind()] : []);
  const bind = extra.length ? {
    map: new Map([...(bind0 ? bind0.map : new Map()), ...extra.flatMap(b => [...b.map])]),
    materials: bind0 ? bind0.materials : [],     // only the vehicle's own: addTextureOnlySlots() looks them up unqualified
  } : bind0;
  const mats = new Set();
  for (const g of App.geomData) if (!isEffectMat(g.name, g.mat)) mats.add(g.mat);
  for (const mat of mats) {
    if (App.manualBind.has(mat)) continue;
    const cur = App.slots.get(App.matSlot.get(mat));
    if (cur && !cur.missing) continue;
    // A weapon's materials are qualified with their model (see matQualify) — the desc map for
    // them is qualified the same way, so the lookup below stays exact instead of colliding with
    // another model's "unknown_1". The plain name is what the name-reading fallbacks want.
    const base = matBaseName(mat);
    const qualified = base !== mat;
    // 1) authoritative binding straight from the game's model→texture map
    const dref = bind && (bind.map.get(mat.toLowerCase()) || (!qualified && descIndexRef(bind, mat)));
    if (dref) {
      // prefer the albedo (t0); else any non-normal texture the material uses (propeller mask, etc.)
      const others = dref.all ? Object.values(dref.all).filter(Boolean) : [];
      // ...but NOT for a glass shader. Its `t3` is a coating lookup, not an albedo, and promoting
      // one gave a canopy a blank paintable slot instead of glass — reported 2026-08-25 on an
      // ef_2000_aesa, whose two canopy materials are unnamed `dynamic_glass_chrome` carrying only
      // `t3: golden_coating` / `t3: black_coating`. They have no name, so no name-based test could
      // ever have caught them; the shader class is the thing that says a material is not painted.
      // Swept over the whole install: 376 materials on 230 models take this fallback with no t0,
      // and **every one of them is dynamic_glass_chrome** — 168 rainbow_coating, 58 golden_coating,
      // 47 rainbow_light_coating, 33 rainbow_lens_mirror_coating, 13 optic_glass_ao, 7 black_coating.
      // So this gate is exact: it fixes all of them and can reach nothing else. A glass material
      // that really does carry a t0 keeps its slot, because only the fallback is gated. ROADMAP 3.18.
      const cStem = dref.c || (isNonPaintableMat("", dref.cls) ? null : (others.find(t => !/_n$/.test(t)) || others[0])) || null;
      if (cStem) {
        // t1 is the camo slot of the masked shaders — but stowage materials (bags, bedrolls, the
        // spare track links bolted to a hull) point t1 back at their OWN albedo. That is not a
        // camouflage, and treating it as one made the exporter emit a replace_tex that swapped the
        // bag's texture for a flat colour sheet.
        if (dref.all && dref.all.t1 && dref.all.t1 !== dref.all.t0 && /masked/.test(dref.cls || ""))
          App.matPaint.set(mat, dref.all.t1);
        const cBase = cStem.replace(/_c$/, "");
        const m = { stem: cBase, c: stems.has(cStem) ? cStem : null, n: dref.n && stems.has(dref.n) ? dref.n : null };
        const slot = ensureSlot(m);
        slot.cStem = cStem;                                 // remember exact names even before decode
        if (dref.n) slot.nStem = dref.n;
        App.matSlot.set(mat, m.stem);
        if (Transfer.GLASS.test(String(dref.cls || "").toLowerCase())) App.matGlass.set(mat, { cls: dref.cls, coat: (dref.all && dref.all.t3) || "", tex: true });   // glass WITH a sheet: Mats.seeThrough (1.26)
      } else {
        App.matSlot.delete(mat);                            // glass/chrome/null — no paintable texture
        // ...and remember WHY, because the viewport needs it and cannot re-derive it. 3.18 measured
        // that every material taking this branch with no t0 is `dynamic_glass_chrome` — 376 of them
        // across 230 models — and most of them have no name at all, so the viewport's own
        // `/glass|canopy|chrome/` test on the name could never see them. It rendered them with the
        // flat "no texture" fallback: opaque, untinted, and reported as white canopies (4.15).
        // The t3 is the coating lookup that stands in for an albedo on this shader, and its name is
        // what says gold from rainbow from smoke.
        if (/^dynamic_glass/.test(String(dref.cls || "").toLowerCase()))
          App.matGlass.set(mat, { cls: dref.cls, coat: (dref.all && dref.all.t3) || "" });
      }
      continue;
    }
    // 2) fall back to the name heuristic (OBJ imports with no desc match)
    const m = matchTexture(base.toLowerCase(), stems);
    if (m) { ensureSlot(m); App.matSlot.set(mat, m.stem); }
    else if (!cur && !isNonPaintableMat(base)) {
      // A weapon's placeholder slot is named after its model too, so two stores with the same
      // unnamed material do not share one empty slot.
      const id = (qualified ? matModelOf(mat) + "_" + base : base).toLowerCase();
      ensureSlot({ stem: id, c: null, n: null });
      App.matSlot.set(mat, id);
    }
  }
  EffectMat.bindSheets(bind);                         // before gcDecoded: a flame's sheet has no slot to keep it
  addTextureOnlySlots(bind, stems);
  gcPlaceholders();
  gcDecoded();
}
// Tank tracks (and a few similar parts) have a material and textures in the game's model
// description but no mesh in the model file — War Thunder builds the track ribbon at runtime
// along the suspension spline. Without a slot their texture has nowhere to go, so a skin's
// *_track_c.dds silently did nothing. Give those materials a slot of their own: editable in 2D,
// exported normally, and flagged as not being part of the mesh.
function addTextureOnlySlots(bind, stems){
  if (!bind || !bind.materials) return;
  const claimed = new Set();
  for (const s of App.slots.values()) { if (s.cStem) claimed.add(s.cStem.toLowerCase()); }
  for (const mat of bind.materials) {
    const name = descMatName(mat);
    if (!name || /(xray|_dmg|damage|dead|destroyed)/i.test(name)) continue;
    const ref = bind.map.get(name.toLowerCase());
    const cStem = ref && ref.c;
    if (!cStem || claimed.has(cStem.toLowerCase())) continue;
    // only for things the install actually ships a texture for, so this never invents slots
    if (!stems.has(cStem.toLowerCase()) && !(GameDB.stems && GameDB.stems.has(cStem))) continue;
    const base = cStem.replace(/_c$/, "");
    if (App.slots.has(base)) { claimed.add(cStem.toLowerCase()); continue; }
    const slot = ensureSlot({ stem: base, c: stems.has(cStem) ? cStem : null, n: ref.n && stems.has(ref.n) ? ref.n : null });
    slot.cStem = cStem;
    if (ref.n) slot.nStem = ref.n;
    slot.noGeom = true;                       // not on the mesh — painting in 3D can't reach it
    claimed.add(cStem.toLowerCase());
  }
}
// Materials that are never painted (glass, chrome, mirror/rainbow coatings, null placeholders)
// don't get a demanding "wants a texture" slot — they render as glass/default instead.
//
// `cls` is the SHADER CLASS, and it answers the same question in the case the name cannot: the two
// canopy materials on an ef_2000_aesa have no name at all, so only the class can say they are glass
// (ROADMAP 3.18). Deliberately narrow — `dynamic_masked_chrome_bump` is the ordinary aircraft
// shader, and a loose /chrome/ test here would stop every vehicle in the game getting a slot.
function isNonPaintableMat(mat, cls){
  if (cls && /^dynamic_(glass|null)/.test(String(cls).toLowerCase())) return true;
  return /(?:^|_)(glass|canopy|chrome|mirror|coating|rainbow|null|shadow|occ|ao)(?:_|\d|$)/.test((mat || "").toLowerCase());
}
// Only bare "unknown_N" / "material_N" / "#N" style names are resolved positionally,
// so a real material that merely ends in a number (e.g. us_lau_117) is never mis-indexed.
function descIndexRef(bind, mat){
  const m = /^(?:unknown|material|mat)[_#]?(\d+)$|^#?(\d+)$/.exec(mat);
  return m ? bind.map.get("#" + (m[1] ?? m[2])) : null;
}
// Textures may arrive in any order and long after their slot was created, so every
// rebuild re-checks each slot for an albedo / _n it is still missing.
function completeSlots(stems){
  for (const slot of App.slots.values()) {
    const base = (slot.cStem || slot.id).replace(/_c$/, "");
    // `stems` was snapshotted in rebuildAll() before rebindMaterials() ran gcDecoded(), so a
    // name still in the set may already have been released — look the texture up, don't assume.
    if (slot.missing) {
      const c = stems.has(base + "_c") ? base + "_c" : (stems.has(base) ? base : null);
      const dc = c && App.decoded.get(c);
      if (dc) fillSlotAlbedo(slot, dc, c);
    }
    if (!slot.smooth) {
      const n = (slot.nStem && stems.has(slot.nStem)) ? slot.nStem : (stems.has(base + "_n") ? base + "_n" : null);
      const dn = n && App.decoded.get(n);
      if (dn) { slot.nStem = n; NSheet.init(slot, dn); }
    }
  }
}
// Textures decoded but no longer referenced by any slot are dead weight — an 8192² entry is
// tens of MB and a session that browses a few vehicles accumulates dozens.
// A skin's sheets for a store not yet hung (App.skinDecoded) are not dead weight: they are kept
// precisely so the rebuild that follows the loadout can bind them. Releasing them here was one
// half of "the weapons show the game's textures until the skin is loaded again" (2026-09-20).
function gcDecoded(){
  const ck = Cockpit.sheets();                                    // the cockpit body's, off screen (1.26)
  if (App.decoded.size < 64 || !ck) return;
  const live = new Set(App.skinDecoded || []);
  for (const s of App.slots.values()) { if (s.cStem) live.add(s.cStem.toLowerCase()); if (s.nStem) live.add(s.nStem.toLowerCase()); }
  for (const stem of App.matEffect.values()) live.add(stem);     // a flame's sheet is drawn, not painted
  for (const stem of ck) live.add(stem);
  let freed = 0;
  for (const k of [...App.decoded.keys()]) if (!live.has(k)) { App.decoded.delete(k); freed++; }
  if (freed) console.debug("released " + freed + " unused decoded texture(s)");
}
// Drop placeholders nothing points at any more (e.g. their material found a real texture).
function gcPlaceholders(){
  const used = new Set(App.matSlot.values());
  for (const [id, s] of [...App.slots]) {
    if (!s.missing || used.has(id) || s.layers.length || s === App.activeSlot || s.noGeom) continue;
    disposeSlotTextures(s);
    compPending.delete(s);
    App.slots.delete(id);
  }
}

function ensureSlot(m){
  let slot = App.slots.get(m.stem);
  const dc = m.c ? App.decoded.get(m.c) : null, dn = m.n ? App.decoded.get(m.n) : null;
  if (!slot) {
    slot = { id: m.stem, cStem: m.c, nStem: m.n, size: 0, layers: [],
      baseC: null, smooth: null, metal: null, normal: null, composite: null, tex: null,
      texCh: null, thumb: null, missing: true };
    App.slots.set(m.stem, slot);
  }
  if (dc && (!slot.baseC || slot.missing)) fillSlotAlbedo(slot, dc, m.c);
  else if (!slot.baseC) initPlaceholderAlbedo(slot);
  if (!m.n) slot.nStem = slot.nStem || null;
  if (dn && !slot.smooth) { slot.nStem = m.n; NSheet.init(slot, dn); }
  return slot;
}

// Give a slot a neutral checker base so it is selectable and paintable before its texture exists.
function initPlaceholderAlbedo(slot, w, h){
  w = w || PLACEHOLDER_SIZE; h = h || w;
  slot.size = w; slot.sizeH = h;
  slot.baseC = makePlaceholderCanvas(w, h);
  ensureComposite(slot, w, h);
  slot.missing = true;
  compositeSlot(slot);
}
function ensureComposite(slot, w, h){
  if (slot.composite && slot.composite.width === w && slot.composite.height === h) return false;
  if (slot.tex) slot.tex.dispose();                            // the old GPU texture is orphaned here
  slot.composite = mkCanvas(w, h);
  slot.tex = new THREE.CanvasTexture(slot.composite);
  slot.tex.encoding = THREE.sRGBEncoding;
  slot.tex.anisotropy = 8; slot.tex.wrapS = slot.tex.wrapT = THREE.RepeatWrapping;
  return true; // texture object replaced — materials must be rebuilt
}
// Late-bind a decoded albedo onto a slot (fresh, placeholder, or already textured).
function fillSlotAlbedo(slot, dc, cStem){
  const w = dc.width, h = dc.height;
  if (slot.layers.length && slot.baseC && (slot.baseC.width !== w || slot.baseC.height !== h))
    rescaleSlotLayers(slot, w, h);
  if (cStem) slot.cStem = cStem;
  slot.size = w; slot.sizeH = h; slot.cFileName = dc.fileName;
  // The albedo's alpha is the coverage mask, and it is taken here, straight out of the decoded
  // pixels, rather than read back off a canvas later: a `getImageData` of an 8192² sheet costs
  // ~520 ms and pulls the whole surface off the GPU. The canvas itself keeps RGB only, fully
  // opaque, so nothing downstream has to cope with premultiplied colour either.
  const src = dc.mips[0].rgba;
  const rgb = new Uint8ClampedArray(w * h * 4);
  const cov = new Uint8Array(w * h);
  for (let i = 0, n = w * h; i < n; i++) {
    rgb[i*4] = src[i*4]; rgb[i*4+1] = src[i*4+1]; rgb[i*4+2] = src[i*4+2]; rgb[i*4+3] = 255;
    cov[i] = src[i*4+3];
  }
  slot.covBase = cov;
  slot.wearC = null; slot._cov = null;
  slot.baseC = mkCanvas(w, h);
  ctx2d(slot.baseC).putImageData(new ImageData(rgb, w, h), 0, 0);
  // ---- keep the vehicle's OWN sheet, separately from the one being edited ----
  // `set_tex … camo_skin_tex` does not replace this texture; it adds a paint sheet beside it. So
  // the game still has the stock `*_c` for every skin, and it is the stock sheet's RGB that shows
  // as bare, unpainted material and the stock sheet's ALPHA that decides where paint covers it.
  // The preview needs both, unedited, for as long as the slot lives. Only the first fill — the one
  // that comes out of the game files — sets them; loading a skin over the top must not.
  if (!slot.stockC) {
    slot.stockC = mkCanvas(w, h);
    ctx2d(slot.stockC).putImageData(new ImageData(new Uint8ClampedArray(rgb), w, h), 0, 0);
    slot.stockA = new Uint8Array(cov);
    if (slot.texStock) { slot.texStock.dispose(); slot.texStock = null; }
    if (slot.texPaintMask) { slot.texPaintMask.dispose(); slot.texPaintMask = null; }
  }
  const newTex = ensureComposite(slot, w, h);
  slot.missing = false;
  // A sheet that came out of a SKIN rather than the game — kept in App.skinDecoded until the store
  // it paints was hung, and bound here by the rebuild that followed — is an edit as far as the
  // export is concerned, exactly as one replaced in place is. Without this the skin's missile
  // sheets showed on the model and were left out of the archive.
  if (App.skinDecoded && App.skinDecoded.has(String(slot.cStem || "").toLowerCase())) slot.cEdited = true;
  slot._uvMasks = null;
  slot._covRev = (slot._covRev || 0) + 1;
  compositeSlot(slot);
  refreshCoverageTexture(slot);                               // the camo blend needs it bound
  return newTex;
}
function rescaleSlotLayers(slot, w, h){
  const rs = c => {
    if (!c) return c;
    // Already there. Copying it anyway is a whole extra sheet per layer for no change — on the
    // reported 25-node t55e1 slot at 4096 that is 2 GB of transient canvases, which kills the tab.
    if (c.width === w && c.height === h) return c;
    const n = mkCanvas(w, h); n.getContext("2d").drawImage(c, 0, 0, w, h); return n;
  };
  // Groups carry masks too, so this walks every NODE and not only the leaves (ROADMAP 4.9).
  for (const L of layerNodes(slot.layers)) {
    // A path layer's recipe goes with its pixels (4.52 (3)), on whichever channel it is.
    for (const ch of LayerNode.channelsOf(L)) { const c = L.chans[ch]; if (c && c.shape) { PathLayer.fit(c, w, h); c.canvas = rs(c.canvas); } }
    if (L.type === "paint") L.canvas = rs(L.canvas);
    if (L.mask) L.mask = rs(L.mask);
  }
}
// ---- the packed `_n` and the three sheets the editor keeps of it ----
// A `_n` is R = inverted roughness, G = normal Y, B = metalness, A = normal X — X the left/right
// slope, Y the up/down one with high G leaning toward the sheet's BOTTOM row (DirectX's sense). The
// app had X and Y the other way round from its first day; measured on 2026-10-24 over the 50 usable
// `_n` in the install's UserSkins (X in A on 48, high G toward the bottom on 49) and confirmed in the
// game the same day on `dist/plan/1.24/n_slope_test/`, mirrored wing strip included (ROADMAP 1.24).
// Stock sheets round-tripped through the old order unchanged, which is how it went unseen: only what
// the app GENERATED into the slopes reached the game across the diagonal. The editor's own normal
// sheet is X in red, Y in green, whatever the file — every tool, the relief and the preview work in
// that — so this is the one place a file's slope bytes are named, both directions (the packer is
// ExportCollect.pack; t169 holds both).
const NSheet = {
  X: 3, Y: 1,                                   // the bytes of a packed _n holding normal X and Y
  // The three sheets of a packed _n, as ImageData: smoothness and metalness grey, and its slopes.
  split(src, w, h){
    const sm = new ImageData(w, h), mt = new ImageData(w, h);
    for (let o = 0; o < w * h * 4; o += 4) {
      sm.data[o] = sm.data[o+1] = sm.data[o+2] = src[o]; sm.data[o+3] = 255;
      mt.data[o] = mt.data[o+1] = mt.data[o+2] = src[o+2]; mt.data[o+3] = 255;
    }
    return { sm, mt, nr: NSheet.slopes(src, w, h) };
  },
  // The normal sheet alone — X in red, Y in green, blue a constant 128 (the preview derives Z) — for a
  // reader that wants nothing else (a loose _n's paste source), at a third of split's memory.
  slopes(src, w, h){
    const nr = new ImageData(w, h), d = nr.data, X = NSheet.X, Y = NSheet.Y;
    for (let o = 0; o < w * h * 4; o += 4) { d[o] = src[o+X]; d[o+1] = src[o+Y]; d[o+2] = 128; d[o+3] = 255; }
    return nr;
  },
  // A normal sheet written in the OLD order (red = the file's G, green = its A) turned to this one —
  // a project saved before version 8 stores its edited surface sheet that way (core/project.js).
  turn(canvas){
    const g = ctx2d(canvas), im = g.getImageData(0, 0, canvas.width, canvas.height), d = im.data;
    for (let o = 0; o < d.length; o += 4) { const r = d[o]; d[o] = d[o+1]; d[o+1] = r; }
    g.putImageData(im, 0, 0);
  },
  // Build (or rebuild) the smooth/metal/normal stack from a decoded WT _n texture.
  init(slot, dn){
    const { width: w, height: h } = dn, { sm, mt, nr } = NSheet.split(dn.mips[0].rgba, w, h);
    slot.nFileName = dn.fileName; slot.nSize = w;
    slot.smooth = mkCanvas(w, h); ctx2d(slot.smooth).putImageData(sm, 0, 0);
    slot.metal = mkCanvas(w, h); ctx2d(slot.metal).putImageData(mt, 0, 0);
    slot.normal = mkCanvas(w, h); ctx2d(slot.normal).putImageData(nr, 0, 0);
    // A different _n means different sheets, so the textures that point at them are rebuilt.
    slot._hadSurfLayers = false;
    disposeSurfaceTextures(slot);
    refreshSurfaceTextures(slot);
    if (App.skinDecoded && App.skinDecoded.has(String(slot.nStem || "").toLowerCase())) slot.nEdited = true;   // as fillSlotAlbedo
  },
};
// Reassign materials in place — for fills that happen outside a full rebuildAll().
function rebuildMaterials(){
  if (!App.meshes.size) return;
  for (const [name, mesh] of App.meshes) {
    const old = mesh.material;
    mesh.material = makeMaterial(mesh.userData.mat, name, mesh.geometry);
    if (old && old.dispose) old.dispose();
  }
  updateSelectionVisuals();
  needsRender();
}
// Release every GPU resource a slot owns (called on slot delete / project clear).
function disposeSlotTextures(slot){
  disposeSurfaceTextures(slot);
  for (const k of ["tex", "texCov", "texStock", "texPaintMask"]) if (slot[k]) { slot[k].dispose(); slot[k] = null; }
  disposeChannelTextures(slot);
  LevelView.drop(slot);                                       // the views' own chains (4.58 (b))
  slot.chanC = null; slot.chanView = null; slot._cov = null;
}

