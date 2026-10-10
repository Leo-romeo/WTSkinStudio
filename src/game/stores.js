async function extractWeaponGeom(modelName, instance){
  const geo = await extractVehicleGeometry(modelName, { anim: false });
  const bind = descBindFor(modelName);
  const list = geomDataFromExtracted(geo, bind);
  const tag = modelName + (instance ? " " + instance : "");
  // Qualify this model's material names with the model (see matQualify). Several weapon models
  // name a material the same way — an unnamed one always becomes "unknown_<index>" — and both
  // App.matSlot and the merged desc lookup are global, so without this a store took whichever
  // model happened to be loaded last, which is what made some of them render wrong.
  const key = modelName.toLowerCase();
  for (const g of list) { g.name = tag + " · " + g.name; g.mat = matQualify(key, g.mat); g.weapon = modelName; g.weaponTag = tag; }
  if (bind) {
    const map = new Map();
    for (const [k, v] of bind.map) map.set(matQualify(key, k), v);
    App.extraBinds.set(key, { map, materials: bind.materials });
  }
  return { list, bind, lost: geo.dropped };
}
/*==PLACESTORE==*/
// Walk one station's store tree, loading and placing every model it carries.
// `at` is the placement of the thing this store hangs from, already in app space.
async function placeStore(store, at, ctx){
  const model = storeMesh(store);
  if (!model) {                                   // no model of its own (an internal gun)
    if (store && store.child) await placeStore(store.child, at, ctx);
    return;
  }
  const tag = model + " #" + (ctx.seq[model] = (ctx.seq[model] || 0) + 1);
  // A mirroring placement needs the winding swapped, and the swap touches the UVs — which are
  // otherwise shared with every other instance of this model, so this one gets its own copy.
  const mirror = !!at && matDet3(at) < 0;
  let list = null, partial = false;
  try {
    const cached = ctx.geom.get(model);
    const got = cached || await extractWeaponGeom(model, "");
    if (!cached) ctx.geom.set(model, got);
    partial = !!(got.lost && got.lost.length);
    // Each instance needs its own vertex arrays — they get moved to different stations.
    list = got.list.map(g => ({ ...g, position: Float32Array.from(g.position),
      normal: g.normal ? Float32Array.from(g.normal) : g.normal,
      uv: (mirror && g.uv) ? Float32Array.from(g.uv) : g.uv,
      name: tag + " · " + g.name.replace(/^[^·]* · /, ""), weapon: model, weaponTag: tag, station: ctx.station }));
  } catch (e) { console.warn("weapon " + model, e); ctx.failed.push(model); (ctx.why || (ctx.why = new Map())).set(model, String((e && e.message) || e)); return; }
  if (!list.length) { ctx.failed.push(model); return; }
  // A store model with a piece it could not read still hangs, minus that piece; the report says which (4.4).
  if (partial) (ctx.partial || (ctx.partial = new Set())).add(model);
  if (at) placeGeom(list, at);
  ctx.added.push(...list);
  // `station` is the WeaponSlot index this hangs on (null for a store added by hand), and it is
  // what lets one station be taken down without touching the rest (LoadoutHang.takeDown).
  ctx.placed.push({ model, tag, kind: store.kind, path: store.path,
    parts: list.map(g => g.name), placed: !!at, station: ctx.station });
  if (!store.child) return;
  // The nodes this rack offers, in its own space, moved into the space it now occupies.
  // A pod names none, so its tubes are recovered from its own skeleton — see podTubeNodes.
  const sk = await modelSkeleton(model);
  const nodes = store.nodes.length ? store.nodes
    : (podTubeNodes(sk, model, store.perTier || 0, storeMesh(store.child) || store.child.path) || [null]);
  for (const n of nodes) {
    const local = n && sk && sk.get(n);
    const childAt = local ? (at ? matMul(at, matFlipZ(local)) : matFlipZ(local)) : at;
    if (n && !local) ctx.looseNodes.push(model + "/" + n);
    await placeStore(store.child, childAt, ctx);
  }
}
/*==ENDPLACESTORE==*/
// Hang a loadout: every station it fills, every store on it, placed and textured — and, since
// 2026-09-21, only the stations that CHANGED. The panel applies a build the moment a hardpoint is
// picked (there is no Apply button any more, as there is none in the game's loadout screen), so a
// click on one pylon must cost one pylon: `ArmBuild.stationDiff` says which stations to take down
// and which to hang, the rest stay exactly where they are, and the scene is rebuilt ONCE at the
// end with every new store's sheets already decoded. Until then a loadout was cleared whole,
// re-hung whole, and rebuilt once per store model on top (loadVehicleTextures) — a Su-30SM2's
// twelve stations took seven full scene rebuilds to change one missile.
//
// Same move as `SkinLoad` and `Composite`: the steps are methods and the state travels in `cx`.
const LoadoutHang = {
  // 1) what changes. `wanted` is one entry per weapon of every station the loadout fills; the
  // diff is by station, so a preset with two weapons is one station either way.
  diff(cx){
    cx.wanted = loadoutModels(cx.arm, cx.lo);
    const cur = App.weaponLoadout && App.weaponLoadout.arm === cx.arm.unit ? App.weaponLoadout.stations : [];
    cx.d = ArmBuild.stationDiff(cur.map(s => ({ slot: s.slot, preset: s.preset })),
                                cx.wanted.map(s => ({ slot: s.slot, preset: s.preset.name })));
    // A loadout for another unit, or stores hung with no station at all, cannot be kept by station.
    cx.dropAll = !!App.weaponsLoaded.size && (!App.weaponLoadout || App.weaponLoadout.arm !== cx.arm.unit);
    cx.hang = cx.wanted.filter(s => cx.d.add.has(s.slot));
    cx.kept = cx.dropAll ? [] : cur.filter(s => cx.d.keep.has(s.slot));
    return cx.dropAll || cx.d.drop.size || cx.d.add.size;
  },
  // 2) take down the stations that change. Geometry and the loaded-store records both carry the
  // station they hang on, so this is a filter, not a rebuild.
  takeDown(cx){
    const gone = g => cx.dropAll || (g.station != null && cx.d.drop.has(g.station));
    App.geomData = (App.geomData || []).filter(g => !(g.weapon && gone(g)));
    for (const [tag, rec] of [...App.weaponsLoaded]) if (gone(rec)) App.weaponsLoaded.delete(tag);
    const still = new Set([...App.weaponsLoaded.values()].flatMap(r => r.parts));
    for (const n of [...App.selParts]) {
      const m = App.meshes.get(n);
      if (m && (m.userData || {}).weapon && !still.has(n)) App.selParts.delete(n);
    }
    // Instance numbers continue from what stays, so a kept "su_r_77_1_missile #2" is not hung twice.
    cx.ctx = { geom: new Map(), added: [], placed: [], failed: [], looseNodes: [], seq: {}, station: null };
    for (const rec of App.weaponsLoaded.values()) {
      const m = /^(.*) #(\d+)$/.exec(rec.tag || "");
      if (m) cx.ctx.seq[m[1]] = Math.max(cx.ctx.seq[m[1]] || 0, +m[2]);
    }
  },
  // 3) hang the new ones, each on its own node.
  async hang(cx){
    const skel = vehicleSkeleton();
    cx.noNode = 0;
    for (let i = 0; i < cx.hang.length; i++) {
      const st = cx.hang[i];
      progress("Station " + (st.tier != null ? st.tier : st.slot) + ": " + blkBaseName(st.weapon.blk) + "…", i / Math.max(1, cx.hang.length));
      await progTick(true);
      const wtm = st.node && skel && skel.get(st.node);
      if (st.node && !wtm) cx.noNode++;
      cx.ctx.station = st.slot;
      await placeStore(st.weapon.store, wtm ? matFlipZ(wtm) : null, cx.ctx);
    }
    // Anything that had no node to hang from is laid out under the aircraft rather than dropped
    // at the origin inside it — after whatever is already lying there.
    const unplaced = [...new Set(cx.ctx.placed.filter(p => !p.placed).map(p => p.tag))];
    if (unplaced.length) {
      const base = geomBounds(App.geomData.filter(g => !g.weapon));
      let k = [...App.weaponsLoaded.values()].filter(p => !p.placed).length;
      for (const tag of unplaced) {
        const list = cx.ctx.added.filter(g => g.weaponTag === tag);
        const b = geomBounds(list);
        translateGeom(list, base.x0 + (k + .5) * Math.max(b.w, 1.2) - base.w / 2, base.y0 - b.h * 1.4, base.cz - b.cz);
        k++;
      }
    }
  },
  // 4) the new state of the aircraft: what hangs where, and which of its own pylons the game
  // shows for this loadout. Written before the rebuild, which reads all of it.
  settle(cx){
    App.geomData = App.geomData.concat(cx.ctx.added);
    for (const p of cx.ctx.placed) App.weaponsLoaded.set(p.tag, p);
    const stationOf = s => ({ slot: s.slot, tier: s.tier, node: s.node, preset: s.preset.name,
      store: blkBaseName(storePayload(s.weapon.store) ? storePayload(s.weapon.store).path : s.weapon.blk) });
    App.weaponPreset = cx.lo.name;
    App.weaponLoadout = { arm: cx.arm.unit, name: cx.lo.name, stations: cx.kept.concat(cx.hang.map(stationOf)) };
    App.weaponShowNodes = new Set(cx.wanted.flatMap(s => s.preset.showNodes));
    App.weaponHideNodes = new Set(cx.arm.hideNodes.filter(n => !App.weaponShowNodes.has(n)));
    // A model no longer on the aircraft takes its material map with it.
    const live = new Set([...App.weaponsLoaded.values()].map(p => p.model.toLowerCase()));
    for (const k of [...App.extraBinds.keys()]) if (!live.has(k)) App.extraBinds.delete(k);
  },
  // 5) one decode pass for every new model's sheets, then the one rebuild.
  async show(cx){
    const models = [...new Set(cx.ctx.placed.map(p => p.model))];
    try { await loadStoreTextures(models); } catch (e) { console.warn("weapon tex", e); }
    rebuildAll();
    // Both switches start off (a vehicle arrives bare), so hanging something turns on exactly what
    // it brings: the stores, and the airframe's own pylons only when the loadout leaves some of
    // them on show. After rebuildAll, so the mount-part scan sees this loadout's meshes.
    if (App.weaponsLoaded.size) App.showWeapons = true;
    if (loadoutShowsPylons()) App.showPylons = true;
    setWeaponVisibility();
    syncSceneToggles();                       // the two switches this just wrote are in the Scene tab
  },
  report(cx){
    const placed = cx.ctx.placed.length, dropped = cx.dropAll ? "the previous loadout" : cx.d.drop.size + " station(s)";
    const what = cx.hang.length ? placed + " store(s) hung on " + new Set(cx.hang.map(s => s.slot)).size + " station(s)" : "nothing hung";
    setStatus("“" + cx.lo.name + "”: " + what + (cx.d.drop.size || cx.dropAll ? ", " + dropped + " taken down" : "") +
      (cx.noNode ? " · " + cx.noNode + " had no node in the model" : "") +
      LoadoutHang.losses(cx.ctx), cx.ctx.failed.length || (cx.ctx.partial && cx.ctx.partial.size) ? "warn" : "ok");
  },
  // Which store models could not be read, by name and reason, and which hung with a piece missing.
  // It used to be a bare count ("2 model(s) unreadable") with the names in the console only (4.4).
  // No pointer at the manual route here: Add files… cannot hang a store, so it would be advice
  // that does not apply.
  losses(ctx){
    const failed = [...new Set(ctx.failed)], partial = [...(ctx.partial || [])];
    if (!failed.length && !partial.length) return "";
    const why = m => (ctx.why && ctx.why.get(m)) ? " (" + ctx.why.get(m) + ")" : "";
    return (failed.length ? " · could not read " + failed.slice(0, 3).map(m => m + why(m)).join(", ") + (failed.length > 3 ? " and " + (failed.length - 3) + " more" : "") : "") +
      (partial.length ? " · hung with a piece missing: " + partial.slice(0, 3).join(", ") + (partial.length > 3 ? ", …" : "") : "");
  },
};
async function loadWeaponLoadout(arm, lo){
  if (!App.geomData) { setStatus("Load a vehicle model first", "err"); return; }
  // Stores are placed on the exterior's skeleton and live in the exterior's geometry. The cockpit
  // body carries its own pylon and pod nodes — hanging a loadout on it would put two of each in
  // the scene (ROADMAP 4.14).
  if (Cockpit.current() === "cockpit") { setStatus("Stores hang on the exterior body — switch the 3-D view's body to Exterior first", "err"); return; }
  const cx = { arm, lo };
  progBegin("Loading " + lo.name + "…", true);
  try {
    await buildWeaponPool();
    if (!LoadoutHang.diff(cx)) {                 // the same stores are already on the aircraft
      progEnd();
      App.weaponPreset = lo.name; if (App.weaponLoadout) App.weaponLoadout.name = lo.name;
      refreshWeaponPanel();
      if (!cx.wanted.length && !App.weaponsLoaded.size) setStatus("“" + lo.name + "” carries nothing with a model", "err");
      return;
    }
    LoadoutHang.takeDown(cx);
    await LoadoutHang.hang(cx);
    LoadoutHang.settle(cx);
    await LoadoutHang.show(cx);
    progEnd();
    refreshWeaponPanel(); refreshPartList();
    LoadoutHang.report(cx);
  } catch (e) {
    progEnd();
    // Whatever was taken down is gone; whatever was hung before the failure is placed but not yet
    // in the scene. The screen must match App.weaponsLoaded, so settle what there is and rebuild.
    if (cx.ctx) { LoadoutHang.settle(cx); rebuildAll(); }
    refreshWeaponPanel(); refreshPartList();
    if (e instanceof Cancelled) setStatus("Cancelled");
    else { setStatus("Weapon load failed: " + e.message, "err"); console.error(e); }
  }
}
// Add a single model by name, for the search box and for hand-built loadouts.
async function loadWeaponModel(modelName){
  if (!App.geomData) { setStatus("Load a vehicle model first, or use “Edit alone”", "err"); return; }
  progBegin("Loading " + modelName + "…", true);
  try {
    const ctx = { geom: new Map(), added: [], placed: [], failed: [], looseNodes: [], seq: {}, station: null };
    for (const rec of App.weaponsLoaded.values()) {           // instance numbers continue from what is there
      const m = /^(.*) #(\d+)$/.exec(rec.tag || "");
      if (m) ctx.seq[m[1]] = Math.max(ctx.seq[m[1]] || 0, +m[2]);
    }
    await placeStore({ kind: "gun", mesh: [modelName], nodes: [], child: null, path: modelName }, null, ctx);
    if (!ctx.added.length) { progEnd(); setStatus("No usable model named " + modelName, "err"); return; }
    const base = geomBounds(App.geomData.filter(g => !g.weapon));
    const b = geomBounds(ctx.added);
    translateGeom(ctx.added, base.cx - b.cx, base.y0 - b.h * 1.4, base.cz - b.cz);
    App.geomData = App.geomData.concat(ctx.added);
    for (const p of ctx.placed) App.weaponsLoaded.set(p.tag, p);
    App.showWeapons = true;
    syncSceneToggles();                       // ...and so does the switch that shows it
    try { await loadStoreTextures([modelName]); } catch (e) { console.warn("weapon tex", e); }
    rebuildAll();                             // once, with the sheets already decoded
    setWeaponVisibility();
    progEnd();
    refreshWeaponPanel(); refreshPartList();
    setStatus(modelName + " added under the aircraft — drag it into place is not needed for painting", "ok");
  } catch (e) {
    progEnd();
    if (e instanceof Cancelled) setStatus("Cancelled");
    else { setStatus("Could not add " + modelName + ": " + e.message, "err"); console.error(e); }
  }
}
