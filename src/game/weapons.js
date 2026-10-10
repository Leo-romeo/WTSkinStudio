// ---------- Suspended armament: stations, presets, racks and weapon models ----------
// All of this is read out of the game's own gamedata tree in aces.vromfs.bin, which became
// readable once the app got a dictionary-capable zstd decoder (see /*==ZSTD==*/). Until then the
// archive was opaque and a loadout had to be inferred from wpcost.blk item names by scored string
// matching; every part of it is now exact:
//   <unit>.blk › WeaponSlots        the vehicle's real stations. Each WeaponSlot carries its
//     in-game tier and display order and lists every WeaponPreset the station accepts, with the
//     modification that unlocks it, the node the store hangs from, and the pylon nodes to show.
//   weapons/containers/*.blk        a rack: `mesh` is the rack's own model, `emitter` the nodes
//     on that model which carry stores, and `blk` what it carries — recursively another
//     container (a MER holding three LAU-3A pods) or the store itself.
//   weapons/rocketGuns|bombguns/…   the store: `mesh` is its model, by name, exactly.
// So "aero_3b_aim9e_left_wing" is no longer split apart by guesswork: it is the rack aero_3b_2
// hanging at the aircraft's aero_3b_001 node, carrying one us_aim_9e_sidewinder at the rack's own
// aim_9_1 node. Measured over the whole install: 764 vehicles, 5 752 stations, 30 115 presets,
// and all 43 997 model references resolve to a real DynModel.
/*==ARMS==*/
const WeaponDB = {
  presets: new Map(),      // unit id → [{ id, items }] from wpcost.blk (what is purchasable)
  arm: new Map(),          // unit id → armament | null
  stores: new Map(),       // store blk path → resolved store tree
  unitPaths: null,         // unit-file basename → its path inside aces.vromfs.bin
  pool: [],                // every DynModel a weapon blk names (backs the search box)
  keys: new Map(), df: new Map(),
  ready: false,
};
// wpcost.blk: <unit> { weapons { <preset> { sum_weapons { <item>:i=<count> } } } }.
// Still read because it is the authority on which presets a player can actually buy, and it
// covers units whose gamedata file cannot be found.
function parseUnitWeapons(db){
  const out = new Map();
  const nameOf = db.nameOf || db.name;
  for (const unit of db.root.children) {
    const w = unit.children.find(c => nameOf(c) === "weapons");
    if (!w) continue;
    const list = [];
    for (const p of w.children) {
      const sw = p.children.find(c => nameOf(c) === "sum_weapons");
      if (!sw) continue;
      const items = [];
      for (let i = 0; i < sw.pCount; i++) {
        const q = db.param(sw, i);
        items.push({ key: q.name, count: (q.type === BLK_INT || q.type === 0) ? (q.val || 1) : 1 });
      }
      if (items.length) list.push({ id: nameOf(p), items });
    }
    if (list.length) out.set(nameOf(unit), list);
  }
  return out;
}
// Unit files sit exactly one directory down — gamedata/flightmodels/f-4e.blk,
// gamedata/units/tankmodels/us_m1a2_sep3_abrams.blk, gamedata/units/ships/… — while the deeper
// folders (fm, dm, performance, weaponpresets) hold the pieces those files point at.
const ACES_UNIT_PATH = /^gamedata\/(flightmodels|units\/[a-z_]+)\/[^/]+\.blk$/i;
function acesUnitPaths(){
  if (WeaponDB.unitPaths) return WeaponDB.unitPaths;
  const m = new Map();
  if (AcesDB.ready) for (const f of AcesDB.files) {
    if (!ACES_UNIT_PATH.test(f.name)) continue;
    const base = f.name.replace(/^.*\//, "").replace(/\.blk$/i, "").toLowerCase();
    if (!m.has(base)) m.set(base, f.name);
  }
  WeaponDB.unitPaths = m;
  return m;
}
// Unit ids and file names disagree only on '-' vs '_' (f-4e.blk / f_4e), so try both.
function acesUnitPath(unitId){
  const paths = acesUnitPaths();
  const id = String(unitId || "").toLowerCase();
  return paths.get(id) || paths.get(id.replace(/_/g, "-")) || paths.get(id.replace(/-/g, "_")) || null;
}
// A store blk → what it is, what model it uses and what it carries. Containers nest.
function resolveStore(blkPath, seen){
  const key = acesKey(blkPath);
  if (WeaponDB.stores.has(key)) return WeaponDB.stores.get(key);
  const guard = seen || new Set();
  if (guard.has(key) || guard.size > 8) return null;      // insurance: never recurse forever
  const db = acesBlk(key);
  if (!db || !db.root) {
    const miss = { path: blkPath, kind: "missing", mesh: [], nodes: [], missing: true };
    WeaponDB.stores.set(key, miss);
    return miss;
  }
  const p = blkParams(db, db.root);
  const out = {
    path: blkPath,
    kind: p.container ? "rack" : p.rocketGun ? "rocket" : (p.bomb || p.bombGun) ? "bomb"
        : p.torpedo ? "torpedo" : p.depthCharge ? "depthCharge" : "gun",
    // A mesh field may list nation variants: "us_250lb_mk_81_ldgp,fr_130_samp_mk_81".
    mesh: typeof p.mesh === "string" ? p.mesh.split(",").map(s => s.trim()).filter(Boolean) : [],
    nodes: blkList(p.emitter).filter(n => typeof n === "string" && n),
    bullets: typeof p.bullets === "number" ? p.bullets : null,
    perTier: typeof p.amountPerTier === "number" ? p.amountPerTier : null,
    // A container or a gun weighs itself at the root (`b8m_s8ko` 150 kg); a missile or a bomb
    // weighs itself in its `rocket{}` / `bomb{}` block (`su_r_27er` rocket.mass=350, which is the
    // 350 kg the game's loadout screen prints). Root only, until 2026-09-21, weighed no missile.
    mass: typeof p.mass === "number" ? p.mass : PresetInfo.blockMass(db, "rocket") ?? PresetInfo.blockMass(db, "bomb"),
    child: null,
  };
  guard.add(key);
  if (typeof p.blk === "string" && p.blk) out.child = resolveStore(p.blk, guard);
  guard.delete(key);
  WeaponDB.stores.set(key, out);
  return out;
}
// ---- what the game's loadout screen says about a station's options ----
// The screen groups a station's choices under headings and prints each as
// "<name> (Ammo: N, Mass: M kg)". Both come out of the game's own data: the heading is the
// Weapon's `trigger` (menu.csv's `triggerType/<trigger>` strings, in the order the screen uses),
// the name is lang's units_weaponry.csv row for the store's blk, and Ammo and Mass are the count
// and the summed store masses. Nothing here is name-matched. One object, not seven names
// (CLAUDE.md §4).
const PresetInfo = {
  GROUPS: [
    ["bombs", "Bombs"], ["guided bombs", "Guided Bombs"], ["rockets", "Rockets"],
    ["atgm", "Air to Ground Missiles"], ["aam", "Air to Air Missiles"], ["torpedoes", "Torpedoes"],
    ["mines", "Mines"], ["fuel tanks", "Fuel Tanks"], ["additional gun", "Cannons & Machine Guns"],
    ["machine gun", "Cannons & Machine Guns"], ["cannon", "Cannons & Machine Guns"],
    ["targetingPod", "Targeting Pods"], ["countermeasures", "Countermeasures"], ["boosters", "Boosters"],
  ],
  // A store's mass where a missile or a bomb keeps it: in its `rocket{}` / `bomb{}` block.
  blockMass(db, name){
    const b = blkChildren(db, db.root, name)[0];
    const m = b && blkParams(db, b).mass;
    return typeof m === "number" ? m : null;
  },
  // The game's own number for a station, for sorting: `order`, else `tier`, else −1 (fixed armament).
  sortKey(s){ return s.order != null ? s.order : s.tier != null ? s.tier : -1; },
  // A preset's heading, from its first weapon's trigger. Rank orders the headings as the screen does.
  group(preset){
    const trig = preset && preset.weapons.length ? preset.weapons[0].trigger : "";
    const hit = PresetInfo.GROUPS.find(g => g[0] === trig);
    const label = hit ? hit[1] : /^gunner\d/.test(trig) ? "Cannons & Machine Guns" : "Other";
    let rank = PresetInfo.GROUPS.findIndex(g => g[1] === label);
    if (rank < 0) rank = PresetInfo.GROUPS.length;
    return { label, rank, key: label.toLowerCase().replace(/[^a-z]+/g, "-") };
  },
  // The store's localized name — "R-27ER air-to-air missiles" for su_r_27er — or its blk name when
  // the install's lang pack has no row for it (the registry reads units_weaponry.csv on open).
  name(blkPath){
    const base = blkBaseName(blkPath);
    return (GameUnits.weaponNames && GameUnits.weaponNames.get("weapons/" + base.toLowerCase())) || base;
  },
  // What a preset hangs, read the way the loadout card reads it: identical payloads summed, so three
  // racks of two bombs is one line with Ammo 6, and a mixed rail is two lines. `kg` is the summed
  // store masses over the chain — a rack's own root mass and its payload's, times the count.
  tally(preset){
    const t = new Map();
    for (const w of (preset ? preset.weapons : [])) {
      const pay = storePayload(w.store);
      const path = pay ? pay.path : w.blk;
      const n = storeCount(w.store);
      let kg = 0, known = true;
      for (let s = w.store; s; s = s.child) {
        if (typeof s.mass !== "number") { if (s === pay) known = false; continue; }
        kg += s.mass * (s === pay ? n : 1);
      }
      const key = blkBaseName(path);
      const rec = t.get(key) || { blk: path, name: PresetInfo.name(path), count: 0, kg: 0, known: true };
      rec.count += n; rec.kg += kg; rec.known = rec.known && known;
      t.set(key, rec);
    }
    return [...t.values()];
  },
  // One line, as the screen prints it: "R-77-1 air-to-air missiles (Ammo: 2, Mass: 380 kg)".
  label(preset){
    return PresetInfo.tally(preset).map(r => r.name + " (Ammo: " + r.count +
      (r.known && r.kg ? ", Mass: " + Math.round(r.kg * 10) / 10 + " kg" : "") + ")").join(" + ");
  },
};
// Which of a mesh field's alternatives this install actually ships.
// `empty_mesh` is the game's own "this store has no model" placeholder — 55 weapon blks use it for
// conformal and bay tanks and for pods that are modelled into the airframe. It IS a resource in the
// packs, but a 2 KB stub with no geometry, so loading it only produced a spurious "1 model(s)
// unreadable" on every loadout that contains one.
function storeMesh(store){
  if (!store || !store.mesh.length) return null;
  const idx = GameDB.grpIndex;
  const real = store.mesh.filter(m => m && m.toLowerCase() !== "empty_mesh");
  if (!real.length) return null;
  if (idx) for (const m of real) if (idx.dyn.has(m)) return m;
  return real[0];
}
// Every model a store needs, rack first, then what hangs off it.
function storeModels(store, out){
  out = out || [];
  if (!store) return out;
  const m = storeMesh(store);
  if (m) out.push({ model: m, kind: store.kind, path: store.path, store });
  if (store.child) storeModels(store.child, out);
  return out;
}
// The innermost thing — a rack is furniture, the missile is what the station is called after.
function storePayload(store){
  let s = store;
  while (s && s.child && storeMesh(s.child)) s = s.child;
  return s;
}
function blkBaseName(path){ return String(path || "").replace(/^.*\//, "").replace(/\.blk$/i, ""); }
// How many stores one station carries under this preset: containers say so themselves.
function storeCount(store){
  let n = 1;
  for (let s = store; s; s = s.child) if (s.kind === "rack") n *= Math.max(1, s.nodes.length || s.perTier || 1);
  return n;
}
// One vehicle's complete armament, straight out of its own gamedata file.
function unitArmament(unitId){
  const id = String(unitId || "").toLowerCase();
  if (WeaponDB.arm.has(id)) return WeaponDB.arm.get(id);
  let out = null;
  const path = acesUnitPath(id);
  if (path) {
    const db = acesBlk(path);
    if (db && db.root) out = readArmament(db, path, id);
  }
  WeaponDB.arm.set(id, out);
  return out;
}
function readArmament(db, path, unit){
  const rootP = blkParams(db, db.root);
  const arm = { unit, path, slots: [], loadouts: [], hideNodes: [], byName: new Map(),
    model: typeof rootP.model === "string" ? rootP.model : null,   // the DynModel this unit uses
    maxload: null };
  const ws = db.root.children.find(c => db.nameOf(c) === "WeaponSlots");
  if (ws) {
    const wsP = blkParams(db, ws);
    if (typeof wsP.maxloadMass === "number") arm.maxload = wsP.maxloadMass;
    for (const hn of blkChildren(db, ws, "HideNodes"))
      arm.hideNodes.push(...blkList(blkParams(db, hn).node).filter(n => typeof n === "string"));
    for (const s of blkChildren(db, ws, "WeaponSlot")) {
      const sp = blkParams(db, s);
      const slot = { index: sp.index | 0, presets: [],
        tier: typeof sp.tier === "number" ? sp.tier : null,
        order: typeof sp.order === "number" ? sp.order : null };
      for (const wp of blkChildren(db, s, "WeaponPreset")) {
        const pp = blkParams(db, wp);
        const preset = { slot: slot.index, weapons: [], showNodes: [],
          name: typeof pp.name === "string" ? pp.name : "",
          icon: typeof pp.iconType === "string" ? pp.iconType : "",
          req: typeof pp.reqModification === "string" ? pp.reqModification : "" };
        for (const sn of blkChildren(db, wp, "ShowNodes"))
          preset.showNodes.push(...blkList(blkParams(db, sn).node).filter(n => typeof n === "string"));
        for (const w of blkChildren(db, wp, "Weapon")) {
          const q = blkParams(db, w);
          // `dummy` entries are the gunner/optics placeholders — no ordnance, no model.
          if (q.dummy === true || typeof q.blk !== "string" || !q.blk) continue;
          preset.weapons.push({ blk: q.blk, store: resolveStore(q.blk),
            node: typeof q.emitter === "string" ? q.emitter : null,
            trigger: typeof q.trigger === "string" ? q.trigger : "",
            bullets: typeof q.bullets === "number" ? q.bullets : null,
            external: q.external === true });
        }
        if (!preset.weapons.length) continue;
        slot.presets.push(preset);
        arm.byName.set(slot.index + "/" + preset.name, preset);
      }
      if (slot.presets.length) arm.slots.push(slot);
    }
    // `order` is the order the game lists stations in — or `tier`, on the units that number
    // their stations by tier alone (the Su-30SM2; 220 stations over 58 units, 2026-09-21); the
    // stations with neither are the fixed internal armament (cannon, countermeasures), first.
    arm.slots.sort((a, b) => PresetInfo.sortKey(a) - PresetInfo.sortKey(b) || a.index - b.index);
  }
  // weapon_presets → the purchasable loadouts. Each names (station, WeaponPreset) pairs, which
  // is the real answer to "what does this aircraft fly with", pylon by pylon.
  const wpBlk = db.root.children.find(c => db.nameOf(c) === "weapon_presets");
  if (wpBlk) for (const pr of blkChildren(db, wpBlk, "preset")) {
    const pp = blkParams(db, pr);
    if (typeof pp.blk !== "string" || !pp.blk) continue;
    const lo = { name: typeof pp.name === "string" ? pp.name : blkBaseName(pp.blk), blk: pp.blk, assign: [] };
    const pdb = acesBlk(pp.blk);
    if (pdb && pdb.root) for (const w of blkChildren(pdb, pdb.root, "Weapon")) {
      const q = blkParams(pdb, w);
      if (typeof q.preset === "string") lo.assign.push({ slot: q.slot | 0, preset: q.preset });
    }
    arm.loadouts.push(lo);
  }
  return arm;
}
// One purchasable loadout → the stations it fills and with what, in station order.
function loadoutStations(arm, lo){
  const out = [];
  const seen = new Set();
  for (const a of lo.assign) {
    const preset = arm.byName.get(a.slot + "/" + a.preset);
    if (!preset || seen.has(a.slot + "/" + a.preset)) continue;
    seen.add(a.slot + "/" + a.preset);
    const slot = arm.slots.find(s => s.index === a.slot);
    out.push({ slot: a.slot, tier: slot ? slot.tier : null, order: slot ? slot.order : null, preset });
  }
  // Whatever the loadout does not mention stays empty, except the fixed internal armament.
  for (const s of arm.slots) if (s.tier == null && s.order == null && !seen.has(s.index + "/" + s.presets[0].name))
    out.unshift({ slot: s.index, tier: null, order: null, preset: s.presets[0], internal: true });
  out.sort((a, b) => PresetInfo.sortKey(a) - PresetInfo.sortKey(b) || a.slot - b.slot);
  return out;
}
// Everything a loadout puts on the aircraft: one entry per store instance, with the node it
// hangs from, so the scene can place them exactly where the game does.
function loadoutModels(arm, lo){
  const out = [];
  for (const st of loadoutStations(arm, lo)) {
    for (const w of st.preset.weapons) {
      const models = storeModels(w.store);
      if (!models.length) continue;                 // internal guns have no external model
      out.push({ slot: st.slot, tier: st.tier, node: w.node, weapon: w, preset: st.preset,
        internal: !!st.internal, models });
    }
  }
  return out;
}
/*==ENDARMS==*/
