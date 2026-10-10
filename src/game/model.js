// ---------- Model extraction: GRP index + load / export ----------
// Index every .grp once, mapping DynModel & GeomNodeTree resource names → their pack + entry.
// The model-pack index is built during the scan and restored from the cache, so by the time a
// vehicle is clicked it is already there. This only has to cover the case where it is not — a
// scan the user cancelled part-way, or a cache entry written by an older build.
async function ensureGrpIndex(){
  if (GameDB.grpIndex) return GameDB.grpIndex;
  if (!App.gameDir) throw new Error("open your War Thunder folder first");
  const found = { dxp: [], desc: [], grp: [] };
  GameDB.scanCount = 0;
  progBegin("Finding the model packs…", true);
  try {
    await scanGameDir(App.gameDir, 0, found, "");
    return await indexGrpPacks(found.grp);
  } finally { progEnd(); }
}
async function readGrpResource(ref){
  const file = await packFile(ref.pack);
  return new Uint8Array(await file.slice(ref.e.offset, ref.e.offset + ref.e.size).arrayBuffer());
}
// Extract a vehicle's DynModel (+ skeleton, + baked animation) from the game packs → parsed
// geometry. `opts.anim === false` skips the clip, which is what the weapon loader wants: a
// loadout extracts up to eight store models and none of them is posed.
// What a load had to leave out, said once (ROADMAP 4.4). Game-file parsing breaks when Gaijin ships an
// engine update (CLAUDE.md §0.3); when it does, one unreadable piece — a part in an unknown vertex
// format, the skeleton, the baked clip, the track preview — costs that piece, and the sentence that
// reports the load names each one with its reason and ends on the route that still works. `dropped`
// is `geo.dropped`: `{ piece, why, effect? }`, a mesh part by its node name, anything else by what it
// is ("the skeleton"). Held by `tools/t86_resilience.mjs`.
const ModelLoss = {
  MANUAL: "Add files… with an .obj and its .dds still works",
  // The tail for a model that could not be read at all.
  fatal(err){ return errText(err) + " — if a game update changed the files, " + ModelLoss.MANUAL; },
  note(dropped){
    if (!dropped || !dropped.length) return "";
    const byWhy = new Map(), rest = [];
    for (const d of dropped) {
      if (d.effect || /^the /.test(d.piece)) { rest.push(d.piece + " (" + d.why + ")" + (d.effect ? ", so " + d.effect : "")); continue; }
      if (!byWhy.has(d.why)) byWhy.set(d.why, []);
      byWhy.get(d.why).push(d.piece);
    }
    const parts = [...byWhy].map(([why, names]) => (names.length === 1 ? "part " : names.length + " parts ") +
      names.slice(0, 4).join(", ") + (names.length > 4 ? " and " + (names.length - 4) + " more" : "") + " (" + why + ")");
    return " · left out: " + parts.concat(rest).join("; ") + " — if you need what is missing, " + ModelLoss.MANUAL;
  },
};
async function extractVehicleGeometry(name, opts){
  const idx = await ensureGrpIndex();
  const dmRef = idx.dyn.get(name);
  if (!dmRef) throw new Error("no 3D model named '" + name + "' in any .grp");
  setStatus("Reading " + name + " model…"); await new Promise(r => setTimeout(r, 0));
  // A resource that does not parse at all is the one loss nothing can be salvaged from; it still
  // says what failed in words (the engine's own "Offset is outside the bounds of the DataView" is
  // all the two fishing boats that fail today would otherwise say — 2 of the 3 047 unit models,
  // measured 2026-09-24).
  let dm;
  try { dm = await loadDynModelBytes(await readGrpResource(dmRef), name); }
  catch (e) { if (e instanceof Cancelled) throw e; throw new Error("its model resource could not be read (" + errText(e) + ")"); }
  const skRef = idx.skel.get(name + "_skeleton");
  // An unreadable skeleton costs the parts their placement, not the model: each part is still there
  // to paint, where the file stores it, and the loader says so (4.4).
  let skelLost = null;
  if (skRef) {
    try { dm.skeleton = loadSkeletonBytes(await readGrpResource(skRef)); }
    catch (e) { skelLost = { piece: "the skeleton", why: errText(e), effect: "parts are shown unplaced and stores cannot hang" }; }
  }
  setStatus("Assembling geometry for " + name + "…"); await new Promise(r => setTimeout(r, 0));
  const geo = buildDynModelGeometry(dm, 0);
  if (skelLost) geo.dropped.unshift(skelLost);
  // Kept for armament: node → world transform is how a store finds its pylon.
  geo.skeleton = dm.skeleton || null;
  geo.a2d = (opts && opts.anim === false) ? null : await loadVehicleAnim(name, geo.dropped);
  return geo;
}
// The vehicle's baked animation, when the install ships one. A missing clip is not an error — the
// pose panel falls back to inferred hinges — but an UNREADABLE one is worth saying, because "the
// gear slider is less exact than usual" is otherwise invisible. It used to say so in a status line
// that the loader's own "loaded" sentence overwrote a moment later, so it goes on `dropped` now.
async function loadVehicleAnim(name, dropped){
  const idx = await ensureGrpIndex();
  const ref = idx.anim && idx.anim.get(name + "_anim");
  if (!ref) return null;
  try {
    return parseA2D(await grpDecompress(new MReader(await readGrpResource(ref), 0)));
  } catch (e) {
    dropped.push({ piece: "the baked animation", why: errText(e), effect: "moving parts fall back to inferred hinges" });
    return null;
  }
}
/*==GEOMDATA==*/
// material index → display name (matches the exported .mtl naming)
function matNameForIndex(bind, i){
  if (bind && bind.materials && bind.materials[i]) return descMatName(bind.materials[i]) || ("unknown_" + i);
  return "unknown_" + i;
}
// extracted geometry → App.geomData (reuses the OBJ geometry builder)
function geomDataFromExtracted(geo, bind){
  const pos = new Array(geo.verts.length * 3), uv = new Array(geo.uvs.length * 2);
  for (let i = 0; i < geo.verts.length; i++) { const v = geo.verts[i]; pos[i*3] = v[0]; pos[i*3+1] = v[1]; pos[i*3+2] = v[2]; }
  for (let i = 0; i < geo.uvs.length; i++) { const t = geo.uvs[i]; uv[i*2] = t[0]; uv[i*2+1] = t[1]; }
  // The camouflage's UV (tc1), indexed like `uv`; NaN where the vertex's format has none, which
  // buildGeometryData reads as "this part samples the camouflage through its own UV" (4.50 (6)).
  const uv1 = geo.cuvs ? new Array(geo.uvs.length * 2) : null;
  if (uv1) for (let i = 0; i < geo.uvs.length; i++) { const t = geo.cuvs[i]; uv1[i*2] = t ? t[0] : NaN; uv1[i*2+1] = t ? t[1] : NaN; }
  const groups = new Map();
  for (const obj of geo.objects) {
    const byMat = new Map();
    for (const g of obj.groups) {
      const nm = matNameForIndex(bind, g.matIndex);
      let grp = byMat.get(nm);
      if (!grp) { byMat.set(nm, grp = { gname: obj.name, mat: nm, v: [], t: [], faces: 0, skinned: !!obj.skinned }); groups.set(obj.name + "\u0000" + nm, grp); }
      for (const f of g.faces) { grp.v.push(f[0]+1, f[1]+1, f[2]+1); grp.t.push(f[0]+1, f[1]+1, f[2]+1); grp.faces++; }
    }
  }
  groups.forEach((g, k) => { if (!g.faces) groups.delete(k); });
  return buildGeometryData({ pos, uv, uv1, groups, hasVN: false });
}
/*==ENDGEOMDATA==*/
