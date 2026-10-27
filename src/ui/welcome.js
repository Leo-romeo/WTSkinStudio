// ---------- Files in ----------
const FILEPICK_DEFAULT_ACCEPT = $("filePick").accept;
function pickFiles(accept){ const fp = $("filePick"); fp.accept = accept || FILEPICK_DEFAULT_ACCEPT; fp.click(); }
$("btnAddFiles").onclick = () => pickFiles();
$("filePick").onchange = e => {
  if (e.target.files.length) addFiles([...e.target.files]);
  e.target.value = ""; e.target.accept = FILEPICK_DEFAULT_ACCEPT;
};
// ---------- Welcome flows ----------
$("btnWelcomeGame").onclick = () => openGameFolder(true);
// The second way in, for the install the folder picker refuses (ROADMAP 4.48) — see ListedDir.
$("btnWelcomeGameAlt").onclick = () => ListedDir.pick();
$("btnGameFolderAlt").onclick = () => ListedDir.pick();
$("btnWelcomeSkin").onclick = async () => {
  if (!GameDB.models.length) {
    const c = await choiceDialog("A skin looks best on the real model. Open your War Thunder folder first so the matching vehicle can be loaded with it?",
      [{ label: "Open game folder", value: "game", primary: true }, { label: "Just open the skin", value: "skin" }, { label: "Cancel", value: "cancel" }]);
    if (c === "cancel" || c == null) return;
    if (c === "game") { await openGameFolder(true); return; }
  }
  $("welcome").style.display = "none";
  loadSkinFolder();
};
$("btnWelcomeClose").onclick = () => {
  $("welcome").style.display = "none";
  // A remembered install may already be open behind the card (Recovery.holdCard)
  setStatus(App.gameDir ? "Empty project — pick a vehicle from the list, or drag in an .obj / .dds / .wtproj"
                        : "Empty project — open the game folder any time, or drag in an .obj / .dds / .wtproj", "ok");
};
// Shared game-folder opener (welcome button + sidebar button both call this).
async function openGameFolder(fromWelcome){
  try {
    // No folder picker at all (not a Chromium browser): the file chooser is the only way in, and it
    // has to open inside this click, before anything awaits.
    if (!window.showDirectoryPicker) { ListedDir.pick(); return; }
    const picked = await showDirectoryPicker({ mode: "read", id: "wtgame" });
    // The picker has returned, so the choice succeeded — get the welcome card out of the way
    // and let the progress bar carry the (long) scan.
    $("welcome").style.display = "none";
    // A pick above the install finds it below, by name; a pick inside it is told so (GameScan.locate).
    const at = await GameScan.locate(picked);
    if (!at.dir) {
      if (fromWelcome) $("welcome").style.display = "";
      setStatus(at.inside
        ? "“" + picked.name + "” is a folder inside the War Thunder install — pick the War Thunder folder that holds it, one level up"
        : "No War Thunder install in “" + picked.name + "” or the usual places under it — pick the War Thunder folder itself, the one that holds aces.vromfs.bin", "err");
      return;
    }
    const found = at.below ? String(picked.name).replace(/[\\/]+$/, "") + "/" + at.below : "";    // a drive root may be named "D:\"
    if (found) setStatus("Found War Thunder at " + found + " — opening it", "ok");
    const n = await indexGameFolder(await ListedDir.withLinks(at.dir), false, found);
    if (!n && !GameDB.models.length) { setStatus("No game data found — pick the War Thunder install folder itself, not a subfolder", "err"); return; }
    idbSet("gameDir", at.dir);                   // the INSTALL is remembered, not the folder above it, so next visit skips the picker
  } catch (e) {
    progEnd();
    // Chrome puts up its own “contains system files” dialog for anything under Program Files,
    // Windows or AppData and then reports a plain abort — there is nothing here to test for, so
    // surface the way around it whenever the picker comes back empty-handed.
    showDragHint();
    if (e.name !== "AbortError") { setStatus("Scan failed: " + e.message, "err"); console.error(e); }
    else {
      if (fromWelcome) $("welcome").style.display = "";
      setStatus("No folder opened. If Chrome said the folder “contains system files” — every install under Program Files does — use “Open it another way…”: the ordinary file chooser has no such rule.", "err");
    }
  }
}
// The one thing that gets a user with a C:\Program Files install unstuck. It used to say "drag the
// folder in", which is the one thing a double-clicked page cannot read (ui/drop.js); it offers the
// file chooser now.
function showDragHint(){ const h = $("dragHint"); if (h) h.style.display = ""; }
// On boot, silently re-open the remembered folder if the browser still grants permission.
async function tryRestoreGameFolder(){
  const dir = await idbGet("gameDir");
  if (!dir || !dir.queryPermission) return false;
  let perm = "denied";
  try { perm = await dir.queryPermission({ mode: "read" }); } catch { return false; }
  if (perm !== "granted") {
    // Chrome needs a user gesture to re-grant; offer it rather than nagging a picker.
    $("btnGameFolder").textContent = "Reopen War Thunder folder";
    $("btnGameFolder").title = "Your install was remembered — one click re-grants access, no folder picking";
    $("btnGameFolder").onclick = async () => {
      try {
        if (await dir.requestPermission({ mode: "read" }) !== "granted") { openGameFolder(false); return; }
        $("welcome").style.display = "none";
        await indexGameFolder(await ListedDir.withLinks(dir));
      } catch { openGameFolder(false); }
    };
    const wg = $("btnWelcomeGame");
    if (wg) wg.querySelector("small").textContent = "Your install is remembered — one click and it reloads.";
    return false;
  }
  // A session to recover keeps the card up (ROADMAP 4.50(2)): the scan runs behind it either way, but
  // the offer is the one thing on the card that cannot wait until later — and the card's way into
  // the game then goes to the list rather than asking for this folder a second time.
  if (Recovery.offered.length) Recovery.holdCard();
  else $("welcome").style.display = "none";
  await indexGameFolder(await ListedDir.withLinks(dir));
  return true;
}
$("btnForgetFolder").onclick = async () => {
  await idbDel("gameDir");
  await idbDel("gameDirLinked");
  await idbDel("userSkinsDir");
  App.userSkinsHandle = null; App.dirHandle = null;
  await idbDel(GAME_INDEX_KEY);
  setStatus("Remembered game folder and stored index cleared — reload the page to pick a different install", "ok");
};
$("btnRescan").onclick = async () => {
  if (!App.gameDir) { setStatus("Open your War Thunder folder first", "err"); return; }
  await idbDel(GAME_INDEX_KEY);
  await indexGameFolder(App.gameDir, true);       // a linked folder stays laid over it (GameScan.merge)
};
// Lightweight promise-based modal for replace/cancel style choices.
function choiceDialog(msg, choices){
  return new Promise(res => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--panel,#20242c);color:var(--text);border:1px solid var(--border,#3a3f4a);border-radius:10px;padding:18px 20px;max-width:440px;box-shadow:0 12px 48px rgba(0,0,0,.55)";
    // pre-line so the "\n\n• …" lists these dialogs are written with actually break
    const p = document.createElement("div"); p.style.cssText = "margin-bottom:14px;line-height:1.45;white-space:pre-line"; p.textContent = msg; box.appendChild(p);
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap";
    // every exit path must unhook Escape, or dismissed dialogs pile up listeners on window
    const esc = ev => { if (ev.key === "Escape") close(null); };
    let done = false;
    const close = v => {
      if (done) return; done = true;
      window.removeEventListener("keydown", esc);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      res(v);
    };
    // A choice with `list: true` is a ROW above the buttons, not a button among them — the shape for
    // "pick one of these N", where N buttons in a wrapping row read as noise: 3.33's four-vehicle
    // skin put six buttons across three ragged lines with the escape hatch in the middle of them.
    // The same `.rowitem` as the sidebar's lists (3.26), in the same `.scrollbox` (3.27), so the
    // row a skin was picked from and the row its vehicle is picked from are one component.
    const rowOf = c => {
      const r = document.createElement("div");
      r.className = "rowitem"; r.tabIndex = 0; r.setAttribute("role", "button");
      if (c.icon) { const ic = document.createElement("span"); ic.className = "ico"; ic.style.cssText = "display:flex;color:var(--muted)"; ic.appendChild(c.icon); r.appendChild(ic); }
      const txt = document.createElement("div"); txt.className = "txt";
      const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = c.label; txt.appendChild(t1);
      if (c.sub) { const t2 = document.createElement("div"); t2.className = "t2"; t2.textContent = c.sub; txt.appendChild(t2); }
      r.appendChild(txt);
      if (c.go) { const g = document.createElement("span"); g.className = "go"; g.textContent = c.go; r.appendChild(g); }
      r.onclick = () => close(c.value);
      r.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); close(c.value); } };
      return r;
    };
    if (choices.some(c => c.list)) {
      const list = document.createElement("div");
      list.className = "scrollbox";
      list.style.cssText = "--box-h:auto;max-height:40vh;min-height:0;resize:none;margin-bottom:14px";
      for (const c of choices) if (c.list) list.appendChild(rowOf(c));
      box.appendChild(list);
      Scrollbox.watch(list);
    }
    for (const c of choices) if (!c.list) { const b = document.createElement("button"); b.textContent = c.label; if (c.primary) b.className = "primary"; b.onclick = () => close(c.value); row.appendChild(b); }
    box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener("pointerdown", e => { if (e.target === ov) close(null); });
    window.addEventListener("keydown", esc);
  });
}
// Everything that belongs to ONE vehicle: geometry, its texture slots, its decoded sheets, its
// camo, its parts and its loadout. Shared with loadVehicleModel() so switching vehicles cannot
// leave the previous one's textures behind.
function clearVehicleState(){
  stroke = null;
  App.texGen++;      // any texture decode still in flight belongs to the vehicle being replaced
  for (const s of App.slots.values()) disposeSlotTextures(s);     // otherwise every vehicle load leaks its textures
  projGLFree();                                                   // and the projector's own vertex buffers with them
  compPending.clear();
  App.geomData = null; App._framedGeom = null; App._symGeom = null; App.objRaw = null; App.objName = null; App.vehicleKey = null; App.extracted = null;
  App.meshes.clear(); App.slots.clear(); App.matSlot.clear(); App.decoded.clear();
  App.manualBind.clear(); App.selParts.clear();
  App.matPaint.clear(); App.paintColor.clear(); App.paintTex.clear(); App.skinCamo.clear();   // camo is per-vehicle, not global
  App.matGlass.clear();                                    // which materials are glass is per-MODEL (4.15)
  App.matEffect.clear();                                   // and which sheet a flame draws
  App.skinApplied = null; App.skinDecoded = new Set();
  App.activeSlot = null; App.activeLayer = null; App.slotMenu = null; App.solo = App.soloKey = App.soloSet = null;
  App.hiddenParts.clear(); App.mountParts = null;
  UndoHistory.clear();
  App.partGroups = null; App.partAssign = null; App.groupCollapsed = null; App.groupOpen = null;
  App.selAnchor = null; App.geomSigs = null; App.geomSigSrc = null; App._nodeParts = null;
  App.skinUnits = null; App.protectedParts = new Set(); App.loadedSkin = null;
  App.weaponsLoaded.clear(); App.extraBinds.clear(); App.weaponPreset = null; App.standaloneWeapon = null;
  App.weaponLoadout = null; App.weaponShowNodes = null; App.weaponHideNodes = null;
  App.pose = {}; App._poseRig = null;
  Cockpit.reset();                                         // both bodies go with the vehicle (4.14)
  clearCamoTexCache();
  // A camouflage tile is one of this vehicle's sheets and has just gone with App.slots, so the menu
  // naming it goes back to the vehicle's own camouflage: left on "My own pattern", the next vehicle's
  // .blk would pin no camouflage at all. The preference never remembers a tile either (4.50 (6)).
  if ($("expCamoBase").value === "tile") $("expCamoBase").value = "stock";
  CamoTile.reset();
  pendingDecal = null;
  // A placing mode outliving the layer it was armed for is the same bug as the sticky "movproj"
  // that answered every click with "Select a projected decal layer first" — and here it would also
  // leave a decal ghost stuck on the cursor for a vehicle that is no longer loaded. setPlacing(false)
  // ends both.
  setPlacing(false);
  // Same reasoning for the marquee: it names texels on a sheet that has just gone, so it goes with
  // it — and its panel with it, or four live verbs are left pointing at nothing (ROADMAP 4.10).
  Marquee.none();
  // The ✎ unlock is a decision about ONE vehicle's .blk name, and this is where a vehicle ends —
  // `loadVehicleModel` calls this when the model changes, and so does Clear. Without it the flag
  // outlives what it was granted for: unlock on the F-4E, load the M1A2, and the Vehicle field is
  // still an editable box with the ✎ lit, which is the exact state ROADMAP 3.10 removed. It
  // mattered less before 3.10, when the flag only dropped `readOnly`; now it picks the widget.
  vehicleIdUnlocked = false;
  disposeModelGroup();
  hideSymPlane();
  renderUnitList(); updateTabCounts();
  refreshSlotList(); refreshLayerList(); refreshPartList();
  updateExportList(); updateBrushAvailability();
  draw2D();
  // Whatever comes next is a new piece of work. Unsaved work in the one that ended keeps its
  // recovery copies, as a session the next visit offers back (ROADMAP 4.50(2)).
  Autosave.opened();
}
// Reset the whole project (keeps the indexed game folder so you can pick another vehicle).
function clearProject(){
  clearVehicleState();
  App.pendingProject = null; App.pendingParts = null;
  $("skinName").value = ""; $("vehicleId").value = ""; refreshVehicleIdLock();
  $("skinInfo").textContent = "";
  setStatus("Project cleared — pick another vehicle or add files", "ok");
}
async function clearProjectPrompt(){
  if (!App.geomData && !App.slots.size) { clearProject(); return; }
  const c = await choiceDialog("Clear the current model, textures and all edits?", [
    { label: "Clear", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }]);
  if (c === "ok") clearProject();
}
$("btnNewProject").onclick = clearProjectPrompt;
// Load a vehicle model, confirming first only if a project is already open.
// There used to be a second question — "airframe only, or airframe plus pylons and weapons?" —
// which was a false choice: both answers loaded exactly the same geometry and differed only in
// what was made visible afterwards. It is a display option, so it lives with the other display
// options (View & scene) and the load is one path. A vehicle arrives on
// the clean loadout — nothing hung on the stations, no drop tanks — but showing its own pylons and
// racks, which are part of the airframe and get painted with it.
async function loadVehicleModelPrompt(name){
  if (App.geomData || App.slots.size) {
    const c = await choiceDialog("Load “" + name + "”? This replaces the current model, textures and edits.", [
      { label: "Load & replace", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }]);
    if (c !== "ok") return;
    clearProject();
  }
  // A vehicle arrives bare: nothing hung on the stations, and the airframe's own pylons hidden.
  // A skin is painted on the airframe, so that is what should be in front of the user first;
  // picking a loadout turns back on whichever of the two that loadout actually brings.
  App.showPylons = false;
  App.showWeapons = false;
  syncSceneToggles();
  await loadVehicleModel(name);
  setWeaponVisibility();
  // Reading the armament costs one blk decode and tells the user what this vehicle can carry
  // without them having to ask for it. Nothing is hung on the stations until a loadout is picked.
  try {
    await ensureAces();
    const info = armamentForCurrentUnit();
    refreshWeaponPanel();
    if (info.arm && info.arm.loadouts.length)
      setStatus(info.arm.loadouts.length + " loadout(s) available for " + info.unit +
        " — clean airframe for now; the Weapons tab hangs one on it", "ok");
  } catch (e) { console.warn("weapon presets", e); refreshWeaponPanel(); }
}
