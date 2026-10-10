// "▸model": extract a vehicle straight into the editor (geometry + correct textures).
async function loadVehicleModel(name){
  // Loading a different vehicle must not leave the previous one's textures in the project. The
  // "Load & replace" prompt clears them, but a skin drop that says "load the right vehicle first"
  // comes straight here, and so did every re-load of the same install — the old slots stayed in
  // App.slots, their decoded sheets stayed in App.decoded (gcDecoded only runs past 64 entries),
  // and the export list offered textures belonging to a vehicle that was no longer on screen.
  if (App.vehicleKey && App.vehicleKey !== name) clearVehicleState();
  Cockpit.reset();                      // a re-load writes the EXTERIOR; a cockpit built earlier is rebuilt on demand (4.14)
  progBegin("Loading " + name + "…", true);
  try {
    const geo = await extractVehicleGeometry(name);
    const bind = descBindFor(name);
    App.vehicleKey = name; App.objName = name;
    progress("Building mesh…", .5);
    await progTick(true);
    App.geomData = geomDataFromExtracted(geo, bind);
    try {
      const tracks = buildTrackGeometry(geo, bind, name);
      if (tracks.length) App.geomData = App.geomData.concat(tracks);
    } catch (e) { geo.dropped.push({ piece: "the track preview", why: errText(e) }); }   // said below (4.4)
    App.extracted = { geo, bind };
    App.pose = {}; App._poseRig = null;                        // a new vehicle starts in its own pose
    App.objRaw = { name: name + "_0.obj", text: buildOBJText(geo, bind, name + ".mtl") };
    // The .blk must be named after the in-game *unit*, not the model resource.
    refreshSkinUnits(name);
    const best = (App.skinUnits || []).find(u => u.on);
    $("vehicleId").value = best ? best.unit.id : name;
    refreshVehicleIdLock();               // the span shows the value; it is written here, not by assignment
    if (!$("skinName").value.trim()) $("skinName").value = "my_" + (best ? best.unit.id : name);
    let nf = 0; for (const o of geo.objects) for (const g of o.groups) nf += g.faces.length;
    rebuildAll();                         // show the mesh immediately (placeholder textures)
    await progTick(true);
    await loadVehicleTextures(name);      // decode this vehicle's textures, rebind, rebuild
    progEnd();
    const label = best ? best.unit.name : name;
    setStatus(label + " loaded — " + geo.verts.length.toLocaleString() + " verts, " + nf.toLocaleString() +
      " tris · skin will install as " + selectedUnits().slice(0, 2).join(", ") + ".blk" + ModelLoss.note(geo.dropped),
      geo.dropped.length ? "warn" : "ok");
  } catch (e) {
    progEnd();
    if (e instanceof Cancelled) setStatus("Load cancelled");
    else { setStatus("Model load failed: " + ModelLoss.fatal(e), "err"); console.error(e); }
  }
}
// A vehicle row's download icon: OBJ + MTL + the referenced textures as a .zip, no editing needed.
async function exportVehicleOBJ(name){
  try {
    progBegin("Extracting " + name + "…", true);
    const geo = await extractVehicleGeometry(name);
    const bind = descBindFor(name);
    const { mtl, textures } = buildMTLText(geo, bind);
    const obj = buildOBJText(geo, bind, name + ".mtl");
    const zip = new JSZip();
    zip.file(name + ".obj", obj);
    zip.file(name + ".mtl", mtl);
    const tf = zip.folder("textures");
    const quality = $("gameQuality").value;
    const lower = new Map(); for (const [s, rec] of GameDB.stems) lower.set(s.toLowerCase(), rec);
    let got = 0;
    const unread = [];
    for (let i = 0; i < textures.length; i++) {
      const stem = textures[i]; const rec = lower.get(stem.toLowerCase());
      if (!rec) continue;
      const en = pickVariant(rec, quality);
      if (!en || !en.supported || !en.size) continue;
      try {
        setStatus("Exporting " + name + " — texture " + (i+1) + "/" + textures.length + " (" + stem + ")…");
        progress("Decoding textures… " + (i + 1) + "/" + textures.length + " (" + stem + ")", (i + 1) / textures.length);
        await progTick(true);
        const dec = await decodeGameEntry(en);       // dec.raw holds the original BCn .dds bytes
        if (dec.raw) { tf.file(stem + ".dds", dec.raw); got++; }
      } catch (e) { unread.push(stem + " (" + errText(e) + ")"); }
    }
    setStatus("Zipping " + name + "…");
    progBegin("Zipping " + name + "…", false);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } },
      st => { progress("Zipping " + name + "…", st.percent / 100); setStatus("Zipping " + name + "… " + st.percent.toFixed(0) + "%"); });
    progEnd();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name + "_obj.zip"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    const lost = geo.dropped.length || unread.length;
    setStatus("Exported " + name + ".obj + .mtl + " + got + " textures (" + (blob.size/1048576).toFixed(1) + " MB)" +
      (unread.length ? " · " + unread.length + " texture(s) could not be read: " + unread.slice(0, 3).join(", ") + (unread.length > 3 ? ", …" : "") : "") +
      ModelLoss.note(geo.dropped), lost ? "warn" : "ok");
  } catch (e) { progEnd(); setStatus("OBJ export failed: " + ModelLoss.fatal(e), "err"); console.error(e); }
}
// What the install holds that the editor does not open, and how many vehicles it lists. Both are
// facts about the INSTALL rather than about a search, so since ROADMAP 3.28(2) they are written once,
// to their own places — the count into the section header, the unopened textures into the section's
// Advanced block — instead of being appended under the search box on every keystroke that produced
// no query. Called from wherever the index changes; safe to call with no index at all.
// Both come from GameScan, which the closing message reads too, so the header, the status line and
// Advanced cannot disagree (2026-10-10: the line said 3 883 vehicles over a header of 3 295, and a
// restored index printed "3024 of 215574 entries not decodable — " with nothing after the dash).
function refreshGameDiagnostics(){
  const cnt = $("gameCount");
  if (cnt) {
    const { n, noun } = GameScan.listCount();
    cnt.textContent = n ? n.toLocaleString() : "";
    cnt.title = n ? n.toLocaleString() + " " + noun + " indexed from your install" : "";
  }
  const el = $("gameDiag");
  if (!el) return;
  el.textContent = "";
  for (const line of GameScan.unreadLines(true)) {
    const d = document.createElement("div");
    d.className = "hint";
    d.textContent = line;
    el.appendChild(d);
  }
}
async function loadGameEntry(en, toSlot){
  try {
    setStatus("Decoding " + en.stem + " (" + tierLabel(en) + " " + en.fmt + ", " + en.compName + ")…");
    await new Promise(r => setTimeout(r, 20));
    const dec = await decodeGameEntry(en);
    if (toSlot) {
      const s = App.activeSlot;
      if (!s) { setStatus("Select a texture slot first", "err"); return; }
      ReplaceTex.byUser(s, dec, /_n$/.test(en.stem), en.stem);     // an edit, as a file would be (4.50(2))
    } else {
      App.decoded.set(en.stem.toLowerCase(), dec);
      rebuildAll();
      setStatus("Added " + en.stem + " (" + tierLabel(en) + ") — bound to any matching material/slot", "ok");
    }
  } catch (e) { setStatus(en.stem + ": " + e.message, "err"); console.error(e); }
}
// One-click completion: for every slot missing its albedo or _n, find the stem in the
// game index and load the best available tier.
async function fillMissingFromGame(){
  if (!GameDB.stems.size) { setStatus("Open the War Thunder folder first", "err"); return; }
  const quality = $("gameQuality").value;
  const lower = new Map();
  for (const [stem, rec] of GameDB.stems) lower.set(stem.toLowerCase(), rec);
  let loaded = 0;
  // Why each slot stayed empty, by sheet: a sheet the install HAS in a pixel format the editor has no
  // reader for is a utility sheet, not "not found" — the slot and the vehicle's load already say so,
  // and this said "not found: 3_blade_slow_propmask, prop_nm_spec, 3_blade_fast_propmask,
  // prop_nm_spec…" on the Bf 109 F-4 (review of 2026-10-10). Sets, because two propeller slots share
  // one normal sheet and it was named twice. The cause is GameDB.blockKind's, as in the load.
  const misses = new Set(), utility = new Set(), utilityFmts = new Set(), noOodle = new Set();
  for (const slot of [...App.slots.values()]) {
    const base = (slot.cStem || slot.id).replace(/_c$/, "");
    // Albedo candidates: exact name from GameResDesc first, then the base heuristic.
    const cWants = []; if (slot.cStem) cWants.push(slot.cStem); cWants.push(base + "_c", base);
    // Normal candidates: exact cross-referenced name from GameResDesc first (e.g. the Su-30
    // ecm-pod uses su_33_ecm_pod_n, which base+"_n" would never find), then the heuristic.
    const nWants = []; if (slot.nStem) nWants.push(slot.nStem); nWants.push(base + "_n");
    const tasks = [];
    if (slot.missing) tasks.push([cWants, false]);
    if (!slot.smooth) tasks.push([nWants, true]);
    for (const [names, isN] of tasks) {
      let got = false, held = null;
      for (const name of names) {
        const rec = lower.get(name.toLowerCase());
        if (!rec) continue;
        const en = pickVariant(rec, quality);
        if (!en || !en.supported || !en.size) { held = held || GameDB.unreadOf(rec) || en; continue; }
        try {
          setStatus("Loading " + en.stem + " (" + tierLabel(en) + ")…");
          await new Promise(r => setTimeout(r, 10));
          const dec = await decodeGameEntry(en);
          App.decoded.set(en.stem.toLowerCase(), dec);
          loaded++; got = true; break;                     // first usable candidate wins
        } catch (e) { console.warn("fill " + name, e); }
      }
      if (got) continue;
      const kind = held ? GameDB.blockKind(held) : "";
      if (kind === "format") { utility.add(held.stem.toLowerCase()); utilityFmts.add(GameDB.fmtName(held) || "unnamed"); }
      else if (kind === "decoder") noOodle.add(names[0]);
      else misses.add(names[0]);
    }
  }
  if (loaded) rebuildAll();
  const miss = [...misses], u = utility.size, o = noOodle.size;
  setStatus("Filled " + loaded + " texture(s) from game files" +
    (u ? " · " + u + " utility sheet" + (u === 1 ? "" : "s") + " not opened" : "") +
    (o ? " · " + o + " Oodle-compressed — this build has no Oodle decoder; import those .dds files by hand" : "") +
    (miss.length ? " — not found: " + miss.slice(0, 4).join(", ") + (miss.length > 4 ? "…" : "") : ""),
    loaded || !(miss.length || o) ? "ok" : "err", u ? GameScan.utilityNote([...utilityFmts]) : "");
}
$("btnFillFromGame").onclick = fillMissingFromGame;

