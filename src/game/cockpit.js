"use strict";
/*==COCKPIT==*/
// ---------- The vehicle's second body: the first-person cockpit (ROADMAP 4.14) ----------
// Nearly every aircraft in the install has a second DynModel beside its exterior — `<model>_cockpit`,
// the high-definition cockpit the game switches to in first person. It is not a second vehicle: the
// unit, the .blk name, the skin and the export are all the same, and the cockpit model even carries
// a reduced copy of the airframe (170 of the F-4E's 208 exterior nodes, on the exterior's own
// sheets) so that a wing seen from the seat is the wing the skin paints. So the cockpit is a BODY
// of the loaded vehicle, and this object is the switch between the two.
//
// Measured over the roster on 2026-09-20 (the sweep is tools/t71_cockpit.mjs):
//   * 1 581 of 1 616 flying units have `<model>_cockpit`, `model` being the unit blk's own root
//     param — the 35 without are drones, catapult floatplanes and the zeppelin, which have no
//     first-person view in the game either. It is a name lookup, not a search.
//   * 973 of the 974 units with a `cockpit{}` block carry `headPos:p3` — the pilot's eye, in the
//     model's own frame (x nose, y up, z starboard; the app negates z, see wt-geometry). Two carry
//     more than one. That is what the "Pilot's seat" view sits at.
//   * The F-4E's cockpit body is 576 088 vertices over 352 nodes against the exterior's 298 639
//     over 208, and binds 90 sheets against 28 — the cockpit's own three, the gauges (shared across
//     aircraft, `us_gauge_*`), the seat, the gunsight, and the exterior's airframe, pylon and pod
//     sheets. A slot is keyed by its sheet, so the shared ones are the SAME slot on both bodies.
//
// What a body owns is swapped whole on a switch (`FIELDS`): geometry, parts layout, selection,
// hidden parts, pose. What is shared stays put: slots, layers, decoded sheets, the material→slot
// map. The cockpit's materials are qualified with its model the way a store's are (matQualify), so
// an `unknown_0` on each body cannot collide in that map — the same fix ROADMAP 4.30 made for two
// bombs. The cockpit model has no baked clip and stores are never hung on it (it carries its own
// pylon and pod nodes); both are said in the panel rather than silently different.
const Cockpit = {
  // Per-body state. Caches keyed by geometry identity (geomSigs, _nodeParts, _symGeom) need no
  // stash: swapping `geomData` invalidates them.
  FIELDS: ["geomData", "extracted", "objRaw", "objName", "selParts", "hiddenParts", "mountParts",
           "partGroups", "partAssign", "groupCollapsed", "groupOpen", "partUnfold", "partGroupsKind",
           "modelKind", "selAnchor", "protectedParts", "pose", "_poseRig", "_framedGeom"],
  name(model){ return model ? model + "_cockpit" : null; },
  // The cockpit model of the loaded vehicle, by name. The exterior's model name is the vehicle key
  // when it came from the game and the OBJ's name when it came from a project or a drop.
  modelName(){ return this.name(App.vehicleKey || App.objName); },
  current(){ return App.body === "cockpit" ? "cockpit" : "exterior"; },
  // Is there a cockpit body to show: already built, or in the install under the expected name.
  has(){
    if (App.bodies.cockpit) return true;
    const n = this.modelName(), idx = GameDB.grpIndex;
    return !!(n && idx && idx.dyn && idx.dyn.has(n));
  },
  // The cockpit body's own material→texture map, qualified — merged into rebindMaterials' lookup
  // while that body is on screen, the way a store's map is.
  bind(){ const b = App.bodies.cockpit; return (b && b.bind) || null; },
  // Every sheet the cockpit body binds, lower-cased — what `gcDecoded` must keep while the exterior
  // is on screen (ROADMAP 1.26). `extract` decodes them and its load ends in a rebuild with the
  // exterior still current, so no slot names them yet; at 64 decoded sheets or more that rebuild
  // released them all, and the switch then bound the cockpit to empty placeholders — measured on the
  // F-16A, whose two bodies bind 27 and 85 sheets. They are the vehicle's, kept as the exterior's are.
  // Null when a cockpit body exists with no desc bind (a project opened without the game folder):
  // which embedded sheets are its is then unknown, so `gcDecoded` releases nothing until it is shown.
  sheets(){
    const b = this.bind(), out = new Set();
    if (App.bodies.cockpit && !b) return null;
    if (b) for (const e of b.map.values()) { if (e.c) out.add(e.c.toLowerCase()); if (e.n) out.add(e.n.toLowerCase()); }
    return out;
  },
  // The fields of a body: the live App while it is on screen, its stash otherwise. Null for a body
  // that does not exist.
  fields(body){
    if (body === this.current()) return App.geomData ? App : null;
    return App.bodies[body] || null;
  },
  stash(){
    const o = App.bodies[this.current()] || (App.bodies[this.current()] = {});
    for (const f of this.FIELDS) o[f] = App[f];
    return o;
  },
  restore(body){
    const o = App.bodies[body];
    if (!o) return false;
    for (const f of this.FIELDS) App[f] = o[f];
    return true;
  },
  // A body record with every per-body field at its starting value, over `rec`.
  fresh(rec){
    return Object.assign({ extracted: null, selParts: new Set(), hiddenParts: new Set(), mountParts: null,
      partGroups: null, partAssign: null, groupCollapsed: null, groupOpen: null, partUnfold: 0,
      partGroupsKind: null, modelKind: null, selAnchor: null, protectedParts: new Set(), pose: {},
      _poseRig: null, _framedGeom: null, bind: null, pendingParts: null }, rec);
  },
  // Qualify a body's material names with its model, and its map's keys the same way, so they can
  // share App.matSlot with the exterior's. Unlike a store's, these groups carry no `weapon` tag:
  // they are the vehicle, and the parts panel files them by their own names.
  qualify(list, bind, key){
    for (const g of list) g.mat = matQualify(key, g.mat);
    if (!bind) return null;
    const map = new Map();
    for (const [k, v] of bind.map) map.set(matQualify(key, k), v);
    return { map, materials: bind.materials };
  },
  // A cockpit body built elsewhere — the project loader, or a test — from its geometry and OBJ.
  // Materials arrive unqualified and leave qualified; the desc bind is looked up when the game
  // folder is open and is null otherwise, which is the exterior's rule too.
  install(rec){
    const key = String(rec.objName || this.modelName() || "cockpit").toLowerCase();
    const bind = this.qualify(rec.geomData, rec.bind || descBindFor(rec.objName), key);
    App.bodies.cockpit = this.fresh(Object.assign({}, rec, { bind }));
    this.refreshControl();
    return App.bodies.cockpit;
  },
  // Forget both bodies: the vehicle is being replaced. The exterior comes back as the current
  // body the moment a vehicle loads, because `stash` makes it on the first switch.
  reset(){
    App.body = "exterior"; App.bodies = {};
    this.refreshControl();
  },
  // Extract the cockpit model out of the packs, with its textures. Not the exterior's loader:
  // vehicleKey, the .blk name and the skin name are all the exterior's and stay so.
  async extract(){
    const name = this.modelName();
    if (!name) { setStatus("Load a vehicle first", "err"); return null; }
    if (!this.has()) { setStatus(App.vehicleKey + " has no separate cockpit model in this install (drones, catapult floatplanes and the zeppelin have none in the game either)", "err"); return null; }
    progBegin("Loading the cockpit…", true);
    try {
      const geo = await extractVehicleGeometry(name, { anim: false });   // the cockpit has no baked clip
      const bind = descBindFor(name);
      progress("Building the cockpit mesh…", .5);
      await progTick(true);
      const list = geomDataFromExtracted(geo, bind);
      const objRaw = { name: name + "_0.obj", text: buildOBJText(geo, bind, name + ".mtl") };
      // What the extraction left out rides on the body, and is said each time it is shown (4.4).
      const rec = this.install({ geomData: list, extracted: { geo, bind }, objRaw, objName: name, bind, lost: ModelLoss.note(geo.dropped) });
      await loadVehicleTextures(name, true);                              // keepKey: the vehicle is still the exterior
      return rec;
    } catch (e) {
      if (e instanceof Cancelled) setStatus("Load cancelled");
      else reportFailure("loading the cockpit model", e, "cockpit");
      return null;
    } finally { progEnd(); }
  },
  // Put one body on screen. The other keeps everything it owns until it is switched back.
  async show(body){
    body = body === "cockpit" ? "cockpit" : "exterior";
    if (body === this.current()) { this.refreshControl(); return true; }
    if (!App.geomData) { setStatus("Load a vehicle first", "err"); this.refreshControl(); return false; }
    if (body === "cockpit" && !App.bodies.cockpit && !(await this.extract())) { this.refreshControl(); return false; }
    if (!App.bodies[body]) { this.refreshControl(); return false; }
    this.stash();
    this.restore(body);
    App.body = body;
    // a solo is a set of THIS body's part names; the other body's names mean nothing here
    App.solo = App.soloKey = App.soloSet = null;
    // a parts layout that arrived with a project waits in the body until it is first drawn
    const b = App.bodies[body];
    if (b.pendingParts) { App.pendingParts = b.pendingParts; b.pendingParts = null; }
    rebuildAll();                                   // buildScene → parts, pose, visibility
    refreshWeaponPanel();                           // the loadout rows say stores hang on the exterior
    this.refreshControl();
    setStatus(body === "cockpit" ? "Cockpit body — the first-person model. Its own sheets export behind the protected mark; the airframe you see is the exterior's sheet." + (b.lost || "")
                                 : "Exterior body", body === "cockpit" && b.lost ? "warn" : "ok");
    return true;
  },
  // ---- the pilot's seat (part 2 of the item) ----
  // headPos is in the game's frame; the app negates z (wt-geometry). Looking down the nose is +x
  // in app space, which is yaw 0 for flyDir(). One fixed frame conversion, kept as a function so
  // the test can hold it.
  seatFrom(headPos){ return { pos: [+headPos[0], +headPos[1], -headPos[2]], yaw: 0, pitch: 0 }; },
  // The unit whose blk holds the seat: the skin's own unit, the way the .blk name is chosen.
  unitId(){
    const best = (App.skinUnits || []).find(u => u.on);
    return best ? best.unit.id : ($("vehicleId").value || null);
  },
  // Every headPos the unit's cockpit block lists, or null with `why` set.
  async heads(){
    const unit = this.unitId();
    if (!unit) { this.why = "Load a vehicle from the game files first — the seat is in the unit's own data"; return null; }
    if (this._heads && this._heads.unit === unit) return this._heads.list;
    if (!(await ensureAces())) { this.why = "The game folder is not open, so the unit's data (where the seat is) cannot be read"; return null; }
    const path = acesUnitPath(unit);
    const db = path && acesBlk(path);
    const ck = db && blkChildren(db, db.root, "cockpit")[0];
    const list = ck ? blkList(blkParams(db, ck).headPos).filter(p => Array.isArray(p) && p.length >= 3) : [];
    if (!list.length) { this.why = unit + " has no cockpit/headPos in its blk — the game has no first-person seat for it"; return null; }
    this._heads = { unit, list };
    return list;
  },
  // Put the camera at the pilot's eye, looking down the nose, and hand the view to fly mode so a
  // drag looks around from the seat the way the game does. Repeated calls cycle the seats a unit
  // lists. The field of view is left as the viewport has it: the game's is a player setting, not
  // the unit's, so there is nothing in the data to match.
  async seat(){
    if (!App.geomData) { setStatus("Load a vehicle first", "err"); return null; }
    const list = await this.heads();
    if (!list) { setStatus(this.why, "err"); return null; }
    const i = this._heads.unit === this._lastUnit ? ((this._seat | 0) + 1) % list.length : 0;
    this._seat = i; this._lastUnit = this._heads.unit;
    const v = this.seatFrom(list[i]);
    if (!cam.fly) { cam.dist = 1; setFly(true); }          // leaving fly then orbits a metre ahead, not 20 m
    cam.flyPos.set(v.pos[0], v.pos[1], v.pos[2]);
    cam.yaw = v.yaw; cam.pitch = v.pitch;
    cam.flySpeed = .6;                                       // metres per second: a cockpit, not an airfield
    syncCamera(); needsRender();
    setStatus("Pilot's seat" + (list.length > 1 ? " " + (i + 1) + " of " + list.length : "") + " — drag to look around, F to leave" +
      (this.current() === "exterior" && this.has() ? " · switch the body to Cockpit to see the first-person model" : ""), "ok");
    return v;
  },
  // The Exterior / Cockpit select in the 3-D view's own bar.
  refreshControl(){
    const sel = $("bodySel");
    if (!sel) return;
    sel.value = this.current();
    const on = !!App.geomData && this.has();
    sel.disabled = !on;
    sel.title = !App.geomData ? "Load a vehicle first"
      : on ? "Which body of the vehicle is on screen: the exterior, or the first-person cockpit model the game switches to in the seat"
      : (App.vehicleKey || App.objName || "This vehicle") + " has no separate cockpit model in this install";
  },
};
$("bodySel").onchange = e => { Cockpit.show(e.target.value); };
/*==ENDCOCKPIT==*/
