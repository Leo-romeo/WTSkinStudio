// ---- Which of the vehicle's OWN parts are mounting hardware rather than airframe ----
// Exact, out of the game's data instead of guessed from names: a station's `emitter` node and the
// ShowNodes / HideNodes its WeaponSlots switch per loadout are precisely the nodes whose geometry
// is a pylon, a rack or a built-in pod. a_4e_early carries aero_3b_001, aero_5a_001 and three
// us_mk4_mod0_pod_* nodes that way; the name rules classified the pods as "Weapons & pods" and
// never hid them, which is why a bare airframe still arrived with gun pods under its belly.
// The store models the vehicle's presets name are a second, equally exact signal: when the
// airframe has a rack baked in, that geometry is named after the rack's own model.
function computeMountParts(){
  const nodes = new Set(), models = new Set();
  try {
    const { arm } = armamentForCurrentUnit();
    if (arm) {
      for (const n of arm.hideNodes) nodes.add(n);
      for (const s of arm.slots) for (const p of s.presets) {
        for (const n of p.showNodes) nodes.add(n);
        for (const w of p.weapons) {
          if (w.node) nodes.add(w.node);
          for (const m of storeModels(w.store)) if (m.model && m.model.length > 3) models.add(m.model);
        }
      }
    }
  } catch (e) { console.warn("mount nodes", e); }
  const mods = [...models];
  const out = new Set();
  for (const [name, mesh] of App.meshes) {
    if (mesh.userData.weapon) continue;                  // a store we loaded, handled separately
    const node = partNode(name);
    if (nodes.has(node) || partGroupOf(name) === "Pylons & racks") { out.add(name); continue; }
    if (mods.some(m => node === m || node.startsWith(m + "_"))) out.add(name);
  }
  App.mountParts = out;
  return out;
}
function mountParts(){ return App.mountParts || computeMountParts(); }
// Does the loadout now live put any of the vehicle's own pylons or racks on show? That is what
// decides whether picking it should turn the pylon switch on — see meshVisible for the same rule
// read the other way round: a mount the loadout's HideNodes name is hidden whatever the switch says.
function loadoutShowsPylons(){
  const hide = App.weaponHideNodes;
  for (const name of computeMountParts()) if (!hide || !hide.has(partNode(name))) return true;
  return false;
}
// ---- One place decides what is visible ----
// Five rules were each writing mesh.visible on their own and undoing one another: bone-driven
// cloth with no pose, the effect billboards, the vehicle's own pylons, the stores of a loaded
// loadout, and Solo — plus the per-part checkboxes in the Parts tree, which any of the others
// silently reverted. They are now one function over one set of state, and the hand-hidden parts
// are remembered by name so a global toggle no longer resurrects them.
function applySceneVisibility(){
  const show = !!App.showWeapons;
  const pylons = App.showPylons !== false;
  const live = !!App.weaponLoadout;
  const mounts = mountParts();
  for (const [name, mesh] of App.meshes) {
    mesh.visible = meshVisible(name, mesh, { show, pylons, live, mounts });
  }
  updateSelectionVisuals(); needsRender();
}
function meshVisible(name, mesh, st){
  if (App.soloSet) return App.soloSet.has(name);          // solo overrides everything
  if (App.hiddenParts.has(name)) return false;            // switched off by hand in the Parts tree
  if (mesh.userData.unposed && !App.showUnposed) return false;
  if (mesh.userData.effect && !App.showEffects) return false;
  const m = /^(.+?) · /.exec(name);
  if (m && App.weaponsLoaded.has(m[1])) return st.show;   // a store from a loaded loadout
  if (m) return true;                                     // some other model's part
  if (!st.mounts.has(name)) return true;                  // airframe
  // Pylon-ish geometry. With a loadout live the game's own ShowNodes / HideNodes for it decide;
  // otherwise the single "pylons" switch does.
  const node = partNode(name);
  if (st.live && st.show) {
    if (App.weaponShowNodes && App.weaponShowNodes.has(node)) return st.pylons;
    if (App.weaponHideNodes && App.weaponHideNodes.has(node)) return false;
  }
  return st.pylons;
}
// kept as the name the weapon panel and the loader already call
function setWeaponVisibility(){ App.mountParts = null; applySceneVisibility(); }
// Drop every loaded store. `quiet` skips the rebuild and the status line, for the case where a
// new loadout is about to be built on top — one rebuild at the end instead of two.
function clearWeapons(quiet){
  if (!App.weaponsLoaded.size) return false;
  App.geomData = (App.geomData || []).filter(g => !g.weapon);
  for (const n of [...App.selParts]) if (!App.meshes.has(n) || (App.meshes.get(n).userData || {}).weapon) App.selParts.delete(n);
  App.weaponsLoaded.clear();
  App.weaponPreset = null;
  App.weaponLoadout = null;
  App.weaponShowNodes = null;
  App.weaponHideNodes = null;
  App.extraBinds.clear();
  if (!quiet) { rebuildAll(); refreshWeaponPanel(); refreshPartList(); }
  return true;
}
function unloadWeapons(){
  if (!clearWeapons(false)) return;
  setStatus("Suspended armament removed", "ok");
}
