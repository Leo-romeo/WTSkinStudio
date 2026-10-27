// ---------- Load an existing skin (UserSkins folder or a WT Live .zip) ----------
// A skin is a set of .dds/.tga files plus one .blk per in-game vehicle. The .blk tells us
// both which vehicle it targets (its filename) and which stock texture each file replaces
// (its from/to pairs), which is exactly what is needed to put it back on the right model.
function parseSkinBlk(text){
  const out = [];
  const re = /(replace_tex|set_tex)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2];
    const from = /from\s*:\s*t\s*=\s*"([^"]*)"/i.exec(body);
    const to = /to\s*:\s*t\s*=\s*"([^"]*)"/i.exec(body);
    if (from && to) out.push({ kind: m[1].toLowerCase(), from: from[1].replace(/\*+$/, ""), to: to[1] });
  }
  return out;
}
function skinStemOf(name){ return name.replace(/^.*[\\/]/, "").replace(/\.(dds|tga|png|jpe?g|webp)$/i, "").toLowerCase(); }
// Loading a second skin must not leave the first one's textures on the parts the new skin
// doesn't touch. Every slot a skin overwrote kept the game's original bytes (rememberStock),
// so putting the vehicle back to stock is a re-decode of those, not another trip to disk.
// `keep` names the sheets the NEXT skin is about to overwrite anyway ("<slot>/c", "<slot>/n"):
// restoring those first is a synchronous re-decode of a stock sheet — seconds for an 8192² BC7 —
// whose result is thrown away a moment later. Their stock bytes stay on the record regardless
// (rememberStock only writes stockRaw once), so skipping the restore loses nothing.
function resetSkinTextures(keep){
  if (!App.skinApplied) return 0;
  let n = 0;
  for (const stem of (App.skinDecoded || [])) App.decoded.delete(stem);
  App.skinDecoded = new Set();
  for (const slot of App.slots.values()) {
    for (const isN of [false, true]) {
      if (keep && keep.has(slot.id + (isN ? "/n" : "/c"))) continue;
      if (!(isN ? slot.nEdited : slot.cEdited)) continue;     // already stock — restoreStockSheet clears the flag
      const stem = ((isN ? slot.nStem : slot.cStem) || "").toLowerCase();
      const d = stem && App.decoded.get(stem);
      if (!d || !d.stockRaw) continue;
      try { if (restoreStockSheet(slot, isN)) n++; }
      catch (e) { reportFailure("putting " + stem + " back to stock", e, "stock-restore"); }
    }
  }
  App.skinApplied = null;
  if (n && !ReplaceTex.deferred) { rebuildMaterials(); refreshSlotList(); draw2D(); }
  return n;
}
// Loading a skin is six decisions, not one, and until 2026-09-02 they shared fourteen locals in a
// single 131-line body: which files are which, which vehicle the `.blk` names, whether that is the
// vehicle on screen, what each texture replaces, what each one turns into, and what to say
// afterwards. Same move as `Composite` (ROADMAP 4.28(c)) and `DecalEd` — the shared state travels on
// a context object rather than being captured, which is what makes each step liftable, and the steps
// go on one object rather than into eight new top-level names (CLAUDE.md §4).
//
// `tools/t63_skinload.mjs` is the oracle: nothing in the suite had ever driven this path, and every
// decision below is a branch a rename-only refactor would keep and a wrong one would silently
// change. It was proved able to fail before the split, by inverting the `plan` ordering.
const SkinLoad = {
  // 1) sort the archive. A skin with no textures at all is not a skin, and saying so here is what
  // keeps a refusal from half-resetting the slots — `applyAll` is where anything is destroyed.
  sort(sk){
    sk.blks = sk.entries.filter(e => /\.blk$/i.test(e.name));
    sk.texs = sk.entries.filter(e => /\.(dds|tga|png|jpe?g|webp)$/i.test(e.name));
    if (!sk.texs.length) { setStatus("No textures found in " + sk.sourceName, "err"); return false; }
    sk.unitIds = sk.blks.map(b => b.name.replace(/^.*[\\/]/, "").replace(/\.blk$/i, ""));
    return true;
  },
  // 2) what does each .blk say the files replace? Carrying on past an unreadable one is right — one
  // bad file out of several still leaves a loadable skin — but silence meant a skin could come in
  // with half its textures unmapped and nothing said which file was to blame.
  //
  // Kept PER .blk (`blkMaps`), because a family skin says different things about the same file:
  // the Su-30SM2's .blk maps su_r_77_missile_c.dds onto su_r_77_1_missile_c, the Su-30SM's onto
  // su_r_77_missile_c, and the MKK's onto neither. `plan` picks the vehicle's own.
  async readMaps(sk){
    sk.maps = []; sk.blkMaps = [];
    const bad = [];
    for (const b of sk.blks) {
      try {
        const maps = parseSkinBlk(new TextDecoder().decode(await b.bytes()));
        sk.blkMaps.push({ unit: b.name.replace(/^.*[\\/]/, "").replace(/\.blk$/i, ""), maps });
        sk.maps = sk.maps.concat(maps);
      } catch (e) { bad.push(b.name); console.error("skin .blk " + b.name + ":", e); }
    }
    if (bad.length) setStatus(bad.length + " of " + sk.blks.length + " .blk file(s) in " + sk.sourceName +
      " could not be read (" + bad.join(", ") + ") — loading what the rest describe", "err");
  },
  // 3) which models do those vehicles use? The unit registry answers first; the texture names
  // themselves are the fallback (leopard_2a4_body_c → leopard_2a4), for a skin whose .blk is named
  // for a unit the registry has never heard of.
  //
  // A skin carries one .blk per vehicle it fits, and until 2026-09-19 this stopped at the FIRST
  // one the registry knew: a Sherman skin shipping m4a1/m4a2/m4a3 .blks offered only the M4A1, and
  // with the M4A3 on screen the next step called it the wrong vehicle. So every known unit goes
  // into `wantList` (one entry per model — two unit ids can share one), and `wantModel`, which is
  // what the rest of the load compares against and reports, is the vehicle already loaded when it
  // is among them, else the first.
  findModel(sk){
    sk.wantModel = null; sk.wantUnit = null; sk.wantList = []; sk.unitModel = new Map();
    if (!(GameDB.models && GameDB.models.length)) return;
    for (const uid of sk.unitIds) {
      const cands = modelsForUnit(uid, GameDB.models);
      if (!cands.length) continue;
      sk.unitModel.set(uid, cands[0].model);          // every known unit, for `plan` — two can share a model
      if (!sk.wantList.some(w => w.model === cands[0].model)) sk.wantList.push({ unit: uid, model: cands[0].model });
    }
    if (!sk.wantList.length) {
      const stems = sk.texs.map(t => skinStemOf(t.name));
      let best = null;
      for (const m of GameDB.models) {
        const mk = unitKey(m);
        if (mk.length < 4) continue;
        const hits = stems.filter(s => unitKey(s).startsWith(mk)).length;
        if (hits && (!best || hits > best.hits || (hits === best.hits && m.length > best.model.length))) best = { model: m, hits };
      }
      if (best) sk.wantList.push({ unit: null, model: best.model });
    }
    if (!sk.wantList.length) return;
    const here = App.vehicleKey && sk.wantList.find(w => unitKey(w.model) === unitKey(App.vehicleKey));
    const pick = here || sk.wantList[0];
    sk.wantModel = pick.model; sk.wantUnit = pick.unit;
  },
  // 4) does it match what's on screen? Two different questions — the wrong vehicle is loaded, or
  // none is — with the same answers, so this returns a verdict instead of falling through: a
  // "load:<model>" answer fetches that model and the whole load starts over on it, which is also
  // why nothing here has to remember the skin — the retry finds the new vehicle in `wantList`.
  async confirmVehicle(sk){
    if (!sk.wantModel) return "go";
    const wrong = !!App.vehicleKey && unitKey(sk.wantModel) !== unitKey(App.vehicleKey);
    if (!wrong && App.geomData) return "go";
    // One vehicle is a "Load X" button; several are a list of rows, the way the sidebar shows the
    // same skin — a four-vehicle skin as four "Load" buttons was six buttons over three ragged lines.
    const many = sk.wantList.length > 1;
    const rowOf = w => {
      const u = w.unit && GameUnits.byId.get(w.unit);
      return { list: true, icon: classIcon(u ? u.cls : "other"), label: u ? u.name : w.model, sub: u ? w.model : "", go: "Load", value: "load:" + w.model };
    };
    const msg = many
      ? "“" + sk.sourceName + "” fits " + sk.wantList.length + " vehicles" +
        (wrong ? ", and " + App.vehicleKey + " — the one loaded — is not among them.\n\nLoading one of them gives you the correct mesh and UV layout:"
               : ".\n\nLoad one of them so you can see the skin on it:")
      : wrong
      ? "“" + sk.sourceName + "” is a skin for " + skinUnitLabel(sk.wantUnit, sk.wantModel) + ", but " + App.vehicleKey +
        " is loaded.\n\nLoading the right vehicle gives you the correct mesh and UV layout."
      : "“" + sk.sourceName + "” is a skin for " + skinUnitLabel(sk.wantUnit, sk.wantModel) +
        ".\n\nLoad that vehicle's model so you can see the skin on it?";
    const a = await choiceDialog(msg, [
      ...(many ? sk.wantList.map(rowOf) : [{ label: "Load " + sk.wantModel, value: "load:" + sk.wantModel, primary: true }]),
      { label: wrong ? "Apply to current model" : "Just load the textures", value: "force" },
      { label: "Cancel", value: "cancel" }]);
    if (a === "cancel" || a == null) { setStatus("Skin load cancelled"); return "stop"; }
    if (typeof a !== "string" || !a.startsWith("load:")) return "go";
    await loadVehicleModel(a.slice(5));
    return "retry";
  },
  // 5) what is each texture going to replace? The .blk's mappings are authoritative and go first;
  // a file's own name is only the fallback, and the two routinely disagree.
  //
  // Only the .blk(s) written for the vehicle on screen, when the skin has one. Until 2026-09-21
  // every .blk's lines were applied, so a four-vehicle Su-30 skin decoded apu_27_c.dds four times
  // and its 67 MB _n twice — the load "did it twice over", and took the time to match — and the
  // other vehicles' stems went into App.decoded as sheets nothing on screen would ever bind. A skin
  // with no .blk for this vehicle (forced onto it, or one the registry cannot place) keeps every
  // line, deduplicated. One (file, stem) pair is one target either way.
  plan(sk){
    const byStem = new Map();
    for (const t of sk.texs) byStem.set(skinStemOf(t.name), t);
    const mine = sk.wantModel ? (sk.blkMaps || []).filter(b => sk.unitModel.get(b.unit) === sk.wantModel) : [];
    const maps = mine.length ? mine.flatMap(b => b.maps) : sk.maps;
    sk.targets = [];
    const seen = new Set();
    const add = (entry, replaces) => {
      const key = entry.name + "\u0000" + replaces;
      if (seen.has(key)) return;
      seen.add(key);
      sk.targets.push({ entry, replaces });
    };
    for (const mp of maps) {
      const t = byStem.get(skinStemOf(mp.to));
      if (t) add(t, mp.from.toLowerCase());
    }
    for (const t of sk.texs) if (!sk.targets.some(x => x.entry === t)) add(t, skinStemOf(t.name));
  },
  // Decode one incoming file. parseDDSAsync transfers `buf` to the decode worker and returns it
  // attached to the result, so everything downstream reads the bytes through `src` and never
  // through `buf` again.
  async decode(entry){
    const buf = (await entry.bytes()).buffer;
    const nm = entry.name.toLowerCase();
    let dec, src = buf;
    // held at most the largest sheet the editor holds (ROADMAP 1.26: a 12 800² canopy sheet in a
    // UserSkin held the UI thread 28 s and kept gigabytes alive for the rest of the session)
    if (nm.endsWith(".dds")) { dec = await parseDDSAsync(buf, SLOT_SIZES[SLOT_SIZES.length - 1]); src = dec.raw; }
    else if (nm.endsWith(".tga")) dec = TGA.parseTGA(buf);
    else {
      const bmp = await createImageBitmap(new Blob([buf]));
      const cv = mkCanvas(bmp.width, bmp.height);
      cv.getContext("2d").drawImage(bmp, 0, 0);
      dec = { width: bmp.width, height: bmp.height, mips: [{ w: bmp.width, h: bmp.height, rgba: ctx2d(cv).getImageData(0, 0, bmp.width, bmp.height).data }] };
    }
    dec.raw = src; dec.rawName = entry.name.replace(/^.*[\\/]/, "");
    dec.fileName = dec.rawName;
    return dec;
  },
  // A ground skin's first line pins the scalable camouflage (the M1A2 template ships
  // `us_camo_olive → us_camo_modern_green.tga`). That file is not a slot texture — it is what the
  // vehicle looks like *under* the skin — so it is kept as the pin for this camo stem and fed to
  // the preview, and re-emitted on export instead of being silently replaced.
  pinCamo(stem, entry, dec){
    App.skinCamo.set(stem, { fileName: entry.name.replace(/^.*[\\/]/, ""), data: new Uint8Array(dec.raw) });
    const cap = capCamoSheet(dec.width, dec.height, dec.mips[0].rgba);
    App.paintTex.set(stem, cap);
    let r = 0, g = 0, b = 0, k = 0;
    for (let i = 0; i < cap.width * cap.height; i++) { r += cap.rgba[i*4]; g += cap.rgba[i*4+1]; b += cap.rgba[i*4+2]; k++; }
    if (k) App.paintColor.set(stem, [r / k, g / k, b / k]);
  },
  // Where the pixels go: a camouflage pin, the slot holding the stem this file replaces, or — for a
  // sheet belonging to a part that is not loaded — kept for `rebuildAll` to bind.
  //
  // The unbound case is keyed by what the .blk says the file REPLACES, not by the file's own name:
  // a store hung later binds its slot to the stock stem (su_30sm_pylon1_c), and a sheet filed under
  // su_30mk2v_venezuela_pylon1_c is a sheet the rebuild can never find. That, with gcDecoded
  // releasing anything not yet on a slot, is why a skin's weapon textures showed the game's until
  // the skin was loaded a second time (reported 2026-09-20).
  bind(sk, entry, replaces, dec){
    if (sk.camoStems.has(replaces)) { SkinLoad.pinCamo(replaces, entry, dec); return; }
    const isN = /_n$/.test(replaces) || /_n$/.test(skinStemOf(entry.name));
    const slot = SkinLoad.slotFor(entry, replaces);
    if (slot) { applyReplaceTexture(slot, dec, isN, entry.name); return; }
    App.decoded.set(replaces, dec); App.skinDecoded.add(replaces);
  },
  slotFor(entry, replaces){ return findSlotForStem(replaces) || findSlotForStem(skinStemOf(entry.name)); },
  // 6) decode and bind every file. This is the first step that destroys anything, which is why
  // every refusal above it returns before this runs.
  //
  // One decode per FILE: a .blk routinely maps one file onto two stems (su_r_77_missile_c.dds onto
  // both R-77 variants), and the second target gets a shallow copy of the first's record — its own
  // fields, the same pixels — so two slots never share one record's stock bookkeeping. Nothing
  // here refreshes the scene per texture either: `ReplaceTex.deferred` holds the four calls every
  // replacement ends with, and the undo snapshots a bake would take, until `report`'s one rebuild.
  async applyAll(sk){
    progBegin("Loading skin “" + sk.sourceName + "”…", true);
    ReplaceTex.deferred++;
    try {
      const keep = new Set();
      for (const t of sk.targets) {
        const s = SkinLoad.slotFor(t.entry, t.replaces);
        if (s) keep.add(s.id + (/_n$/.test(t.replaces) || /_n$/.test(skinStemOf(t.entry.name)) ? "/n" : "/c"));
      }
      sk.cleared = resetSkinTextures(keep);      // drop whatever the previous skin left behind
      App.skinDecoded = new Set();
      sk.camoStems = new Set(stockCamoStems().map(s => s.toLowerCase()));
      const decoded = new Map();
      for (let i = 0; i < sk.targets.length; i++) {
        if (progCancelled()) break;
        const { entry, replaces } = sk.targets[i];
        progress("Applying " + entry.name + "…", i / sk.targets.length);
        await progTick(true);
        try {
          let dec = decoded.get(entry);
          if (dec) dec = Object.assign({}, dec);
          else {
            dec = await SkinLoad.decode(entry); decoded.set(entry, dec);
            if (dec.fitFrom) (sk.fitted || (sk.fitted = [])).push(dec.rawName + " " + dec.fitFrom.w + "×" + dec.fitFrom.h);
          }
          SkinLoad.bind(sk, entry, replaces, dec); sk.applied++;
        } catch (e) { console.warn("skin tex " + entry.name, e); sk.failed++; }
      }
    } finally { ReplaceTex.deferred--; progEnd(); }
    // The base sheets under every earlier snapshot just changed, so the history is the wrong
    // picture now — the same call the resize path makes, and the way back from a skin is the next
    // skin or "reset to original", never Ctrl+Z texture by texture.
    sk.undone = App.undoStack.length + App.redoStack.length;
    UndoHistory.clear();
  },
  // 7) say what happened, in both places that report it — the Skin panel keeps the standing fact,
  // the status line the one-off.
  report(sk){
    App.skinApplied = sk.sourceName;
    rebuildAll();
    draw2D();                                   // the per-texture refresh was held back (applyAll)
    App.loadedSkin = { name: sk.sourceName, units: sk.unitIds, model: sk.wantModel };
    $("skinInfo").textContent = sk.sourceName + " — " + sk.applied + " texture(s) applied" +
      (sk.unitIds.length ? " · targets " + sk.unitIds.slice(0, 3).join(", ") + (sk.unitIds.length > 3 ? " +" + (sk.unitIds.length - 3) : "") : "");
    if (!$("skinName").value.trim()) $("skinName").value = sk.sourceName.replace(/[^a-z0-9_\-]/gi, "_");
    const sizes = [...new Set(App.slots ? [...App.slots.values()].filter(s => s.cEdited && !s.missing).map(s => s.size) : [])];
    setStatus("Skin “" + sk.sourceName + "” loaded — " + sk.applied + " texture(s)" + (sk.failed ? ", " + sk.failed + " failed" : "") +
      (sk.cleared ? " · " + sk.cleared + " reset to stock first" : "") +
      (sizes.length ? " · " + sizes.sort((a, b) => b - a)[0] + "px" : "") +
      (sk.wantModel ? " · model " + sk.wantModel : "") +
      (sk.undone ? " (undo history cleared)" : "") +
      // said, because an export with that sheet ticked writes it at the size held (ROADMAP 1.26)
      (sk.fitted ? " · held at " + SLOT_SIZES[SLOT_SIZES.length - 1] + ", the largest sheet the editor holds: " + sk.fitted.join(", ") +
        " (the game still reads the file as it is)" : ""), sk.applied ? "ok" : "err");
    updateExportList();
  },
};
// entries: [{ name, bytes() }]
async function applySkinEntries(entries, sourceName){
  const sk = { entries, sourceName, applied: 0, failed: 0, cleared: 0 };
  if (!SkinLoad.sort(sk)) return;
  await SkinLoad.readMaps(sk);
  SkinLoad.findModel(sk);
  const go = await SkinLoad.confirmVehicle(sk);
  if (go === "stop") return;
  if (go === "retry") return applySkinEntries(entries, sourceName);
  SkinLoad.plan(sk);
  await SkinLoad.applyAll(sk);
  SkinLoad.report(sk);
}
function skinUnitLabel(unitId, model){
  const u = unitId && GameUnits.byId.get(unitId);
  return u ? u.name + " (" + model + ")" : (model || unitId || "an unknown vehicle");
}
// Match a stock texture name to the slot that currently holds it.
function findSlotForStem(stem){
  if (!stem) return null;
  const s = stem.toLowerCase();
  for (const slot of App.slots.values()) {
    if ((slot.cStem || "").toLowerCase() === s || (slot.nStem || "").toLowerCase() === s) return slot;
  }
  const base = s.replace(/_[cn]$/, "");
  for (const slot of App.slots.values()) if (slot.id.toLowerCase() === base) return slot;
  return null;
}
async function loadSkinFolder(){
  if (!window.showDirectoryPicker) { $("skinZipPick").click(); return; }
  // The install's own UserSkins folder is already listed below this button whenever the game
  // folder is open, so asking "where is the skin?" and then opening a folder picker at a location
  // we already have is pure friction. Only ask when there is nothing to point at.
  const haveList = (App.userSkins || []).length > 0;
  const choices = [];
  if (haveList) choices.push({ label: "One of my " + App.userSkins.length + " installed skins", value: "list", primary: true });
  choices.push({ label: "A folder (UserSkins/…)", value: "dir", primary: !haveList });
  choices.push({ label: "A .zip file", value: "zip" });
  choices.push({ label: "Cancel", value: "cancel" });
  const c = await choiceDialog(haveList
    ? "Your install's UserSkins folder is already open — the list under this button has every skin in it. Pick from there, or point somewhere else."
    // Not "drag the skin folder onto this window": a page opened by double-click cannot read a dropped
    // folder at all (ui/drop.js, measured 2026-08-05), and that is how this app is opened. What does
    // reach a Program Files install is the file chooser, and it lists UserSkins with the rest.
    : "Where is the skin?\n\nInstall under Program Files? Chrome's folder picker refuses those, and a folder dragged onto this window cannot be read when the page was opened by double-click. Open the War Thunder folder with “Open it another way…” — every skin in its UserSkins is then listed under this button — or load the skin's .zip.",
    choices);
  if (c === "zip") { $("skinZipPick").click(); return; }
  // The list has no box of its own since ROADMAP 3.5 — the vehicle search above it searches both.
  if (c === "list") { $("gameSearch").focus(); setStatus("Pick a skin from the list below “Load a skin…”, or type its name in the search", "ok"); return; }
  if (c !== "dir") return;
  try {
    // It opens in UserSkins, or in the game folder, when either is known (2026-10-10) — this
    // session's, or the install remembered from the last, which needs no permission to be a starting
    // point. An IndexedDB read is milliseconds and the dialog's click has just renewed the activation.
    // An install with a linked folder laid over it (GameScan.merge) starts in the install itself.
    const real = h => h && !h._legacy && h.kind === "directory" ? (h._primary || h) : null;
    const home = real(App.userSkinsDir) || real(App.gameDir) || real(await idbGet("gameDir"));
    const dir = await showDirectoryPicker({ mode: "read", id: "wtskins", ...(home ? { startIn: home } : {}) });
    const entries = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== "file") continue;
      entries.push({ name, bytes: async () => new Uint8Array(await (await h.getFile()).arrayBuffer()) });
    }
    if (!entries.length) { setStatus("That folder is empty", "err"); return; }
    await applySkinEntries(entries, dir.name);
  } catch (e) {
    if (e.name !== "AbortError") { setStatus("Skin load failed: " + e.message, "err"); console.error(e); }
    else setStatus("No folder opened. If Chrome said it “contains system files”, open the War Thunder folder with “Open it another way…” — its UserSkins skins are then listed under Load a skin… — or load the skin's .zip.", "err");
  }
}
$("btnLoadSkin").onclick = loadSkinFolder;

