// Load every texture a model references (per GameResDesc) into decoded slots.
async function loadVehicleTextures(name, keepKey){
  const bind = descBindFor(name);
  if (!bind) { if (!keepKey) setStatus("No material data for " + name, "err"); return; }
  if (!keepKey) {
    App.vehicleKey = name;
    if (!$("vehicleId").value) { $("vehicleId").value = name; refreshVehicleIdLock(); }
  }
  const owned = Prog.active;
  if (!owned) progBegin("Loading textures…", true);
  // This load owns App.decoded only until something else claims it. clearVehicleState() bumps the
  // token, so a load that was superseded — the user picked a different vehicle, or cleared — throws
  // its results away instead of repopulating a map that has deliberately been emptied.
  const gen = ++App.texGen;
  const mine = () => App.texGen === gen;
  const got = await decodeBindTextures([bind], mine);
  if (!got) { if (!owned) progEnd(); return; }             // superseded — say nothing, do nothing
  const { loaded, misses, noOodle, utility, utilityFmts, todo, arrived, stopped } = got;
  if (!owned) progEnd();
  rebuildAll();
  renderGameSearch();
  // A cancelled load leaves a real, usable half-state — the mesh is there and some sheets are on
  // it. What was missing was any account of it: a user cancelled and got a bare model with no
  // indication of how much had arrived or that clicking the vehicle again finishes the job (the
  // resolve loop above skips stems already in App.decoded, so it costs only what is left).
  if (stopped) {
    const left = todo - arrived;
    setStatus("Cancelled — " + loaded + " of " + (loaded + left) + " textures loaded for " + name +
      (left ? ". Click the vehicle again to load the remaining " + left + "." : "."), "err");
    return;
  }
  // A utility sheet — a propeller mask, say — is counted apart from what is missing, because it is not
  // missing: it is in the install, decompresses fine, and is in a pixel format the editor has no
  // reader for. "4 unavailable" with no cause on 961 aircraft and helicopters read as a fault (review
  // of 2026-10-10: the Bf 109 F-4's four were two propeller masks, its side blur and their normal).
  const other = misses - utility;
  setStatus("Loaded " + loaded + " textures for " + name +
    (utility ? " · " + utility + " utility sheet" + (utility === 1 ? "" : "s") + " not opened" : "") +
    (other ? " · " + other + " unavailable" +
      (noOodle ? " (" + noOodle + " Oodle-compressed — this build has no Oodle decoder; import those .dds files by hand)" : "") : "") +
    (App.geomData ? "" : " — load this vehicle's model to see them on the mesh"), "ok",
    utility ? GameScan.utilityNote(utilityFmts) : "");
}
// Every sheet a set of material binds references, resolved first and then decoded in ONE pass at
// pool width, into App.decoded. A vehicle's sheets are independent of one another and there was
// never a reason to serialise them beyond decode having been on this thread (ROADMAP 1.2). Shared
// by the vehicle load and the loadout, which hands every store's bind in at once: until 2026-09-21
// each store model took its own pass here AND its own rebuildAll, so a six-model loadout rebuilt
// the whole scene seven times. Returns null when `alive` says the load was superseded.
async function decodeBindTextures(binds, alive){
  const quality = $("gameQuality").value;
  const lower = new Map();
  for (const [stem, rec] of GameDB.stems) lower.set(stem.toLowerCase(), rec);
  const wanted = new Set();
  for (const bind of binds) for (const e of new Set(bind.map.values())) { if (e.c) wanted.add(e.c); if (e.n) wanted.add(e.n); }
  let loaded = 0, misses = 0, noOodle = 0, utility = 0;
  const utilityFmts = new Set();
  const todo = [];
  for (const stem of wanted) {
    const rec = lower.get(stem.toLowerCase());
    if (!rec) { misses++; continue; }
    const en = pickVariant(rec, quality);
    // Count *why*, not just how many. In a build without the Oodle decoder this is most of the
    // vehicle, and "12 unavailable" with no cause reads as a bug rather than as a known limit.
    // The cause is the texture's, when no tier of it opens; otherwise the tier the quality picked.
    if (!en || !en.supported || !en.size) {
      misses++;
      const block = GameDB.unreadOf(rec) || en, kind = GameDB.blockKind(block);
      if (kind === "decoder") noOodle++;
      else if (kind === "format") { utility++; utilityFmts.add(GameDB.fmtName(block) || "unnamed"); }
      continue;
    }
    if (App.decoded.has(stem.toLowerCase())) { loaded++; continue; }
    todo.push({ stem, en });
  }
  const res = await decodeGameEntries(todo.map(t => t.en),
    (done, n) => progress("Decoding textures… " + done + "/" + n, done / n),
    () => progCancelled() || !alive());
  if (!alive()) return null;
  let arrived = 0;
  for (let k = 0; k < todo.length; k++) {
    const r = res[k];
    if (!r) continue;                                     // cancelled before this one ran
    if (r.ok) { App.decoded.set(todo[k].stem.toLowerCase(), r.dec); loaded++; arrived++; }
    else { console.warn("veh tex " + todo[k].stem, r.error); misses++; }
  }
  const stopped = progCancelled();
  if (!stopped) for (const bind of binds) await loadPaintColors(bind, lower, quality, alive);
  if (!alive()) return null;
  return { loaded, misses, noOodle, utility, utilityFmts: [...utilityFmts], todo: todo.length, arrived, stopped };
}
// The sheets of a loadout's store models, all in one pass, with no rebuild of their own — the
// caller owns the progress bar and the one rebuildAll that follows. Models the desc has no
// material data for are skipped: they render with placeholders, as they always did.
async function loadStoreTextures(models){
  const binds = models.map(m => descBindFor(m)).filter(Boolean);
  if (!binds.length) return { loaded: 0, misses: 0 };
  const gen = App.texGen;
  const got = await decodeBindTextures(binds, () => App.texGen === gen);
  return got || { loaded: 0, misses: 0 };
}
// The paint (t1) textures are tiny near-flat colour sheets (32² … 512²), so they are decoded once
// and KEPT. The average alone was enough while the camo was only a preview tint, but the exporter
// now ships a copy of the real sheet — pinning the camouflage to a flat colour is what recoloured
// every texel the skin does not fully cover — and the viewport samples it so the preview and the
// game blend the same two textures.
// `alive` is the caller's load token: these maps are per-vehicle too, so a camo sheet that finishes
// decoding after the vehicle was replaced must not be written into the new one's state.
async function loadPaintColors(bind, lower, quality, alive){
  const paints = new Set();
  for (const e of new Set(bind.map.values())) if (e.all && e.all.t1 && /masked/.test(e.cls || "")) paints.add(e.all.t1);
  if (!paints.size) return;
  let i = 0;
  for (const stem of paints) {
    i++;
    if (alive && !alive()) return;
    if (App.paintColor.has(stem) || progCancelled()) continue;
    const rec = lower.get(stem.toLowerCase());
    const en = rec && pickVariant(rec, quality === "auto" ? "base" : quality);   // base tier is plenty for an average
    if (!en || !en.supported || !en.size) continue;
    try {
      progress("Reading stock paint " + stem + "…", i / paints.size);
      await progTick();
      const dec = await decodeGameEntry(en);
      const d = dec.mips[0].rgba;
      const n = dec.width * dec.height;
      let r = 0, g = 0, b = 0;
      const step = Math.max(1, Math.floor(n / 16384));                            // sample, don't sum 16 M pixels
      let cnt = 0;
      for (let k = 0; k < n; k += step) { r += d[k*4]; g += d[k*4+1]; b += d[k*4+2]; cnt++; }
      App.paintColor.set(stem, [r / cnt, g / cnt, b / cnt]);
      // Keep the sheet itself, capped so a large camo texture cannot bloat the project.
      App.paintTex.set(stem, capCamoSheet(dec.width, dec.height, d));
    } catch (e) { console.warn("paint " + stem, e); }
  }
}

