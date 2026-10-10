/*==TANKRIG==*/
"use strict";
// ---------- A tank's turret, from the vehicle's own datasheet (ROADMAP 4.1, the tank half) ----------
// The posing rig guessed every part of this: `^bone_turret$` and `^bone_gun_barrel$` matched by
// name, the elevation axis inferred from the shape of the barrel, ±180° of traverse and ±20° of
// elevation offered to every vehicle alike. All four are written down in the unit's own blk, under
// `commonWeapons/Weapon`:
//
//     turret      { head:"bone_turret"; gun:"bone_gun"; barrel:"bone_gun_barrel" }
//     limits      { yaw:[-180,180]; pitch:[-10,20] }
//     limitsTable { lim1:[-180,-133, 2,20]; lim2:[-133,133, -10,20]; lim3:[133,180, 2,20] }
//
// Measured over the whole ground roster (`tools/turret_sweep.mjs`, 2026-09-22, 1 359 units in
// `gamedata/units/tankmodels/`):
//
//   * 1 305 carry a `Weapon` with a `turret` block. `head` is `bone_turret` on 1 228 of them and
//     `bone_turret_01`, `bone_turret_02`, `bone_camera_gunner` or `bone_gun_01` on the rest;
//     `gun` is `bone_gun` on 1 199; `barrel` is `bone_gun_barrel` on 1 054, `bone_gun_barrel_01`
//     on 109, `bone_gun_barrel_02` on 17 and absent on 124.
//   * **The app's own regex misses 248 of the 1 305** — every `_01` variant — so those vehicles
//     got no gun control at all, and it elevates about the BARREL where the datasheet says the
//     trunnion is `gun`, one node up.
//   * Travel: median depression −8°, median elevation +20°, and **205 of 1 305 do not traverse
//     fully** (the ISU-152 is [−3, +7] — a casemate, offered ±180° by the app today).
//   * **682 of the 734 with a `limitsTable` depress less over part of their own hull**: the M1
//     gives −10° forward and +2° over its engine deck, which is the report of 2026-08-25
//     written in the file it was measured from.
//
// This section is the pure half — plain records in, numbers out, no blk reader, no DOM, no App —
// so `tools/t76_tankrig.mjs` holds it under Node. The reader that turns a unit's blk into those
// records is below the marker.
const TankRig = {
  // A limits pair that says nothing: the hull machine guns all carry `yaw:[0,0] pitch:[0,0]`.
  dead(p){ return !p || p.length < 2 || (p[0] === 0 && p[1] === 0); },
  span(p){ return TankRig.dead(p) ? 0 : Math.abs(p[1] - p[0]); },
  // `limitsTable` is an object of `lim1`, `lim2`, … each `[yawFrom, yawTo, pitchMin, pitchMax]`.
  // Sorted by where they start, so a lookup can stop at the first match and a reader can see the
  // shape of the travel at a glance.
  bands(table){
    if (!table) return [];
    return Object.keys(table)
      .map(k => table[k])
      .filter(v => Array.isArray(v) && v.length >= 4 && v.every(x => typeof x === "number"))
      .map(v => v.slice(0, 4))
      .sort((a, b) => a[0] - b[0]);
  },
  // The main gun among a unit's weapons. Each record is `{ turret, limits, limitsTable }` as the
  // blk has them. The first one that both names a turret and actually elevates — a hull MG names
  // no turret and its limits are dead — and, failing that, the first that names one at all, so a
  // vehicle whose data is odd still gets its node names.
  main(weapons){
    const list = (weapons || []).filter(w => w && w.turret && (w.turret.head || w.turret.gun || w.turret.barrel));
    const pick = list.find(w => w.limits && !TankRig.dead(w.limits.pitch)) || list[0];
    if (!pick) return null;
    const t = pick.turret, L = pick.limits || {};
    return {
      head: t.head || null, gun: t.gun || null, barrel: t.barrel || null,
      yaw: TankRig.dead(L.yaw) ? null : L.yaw.slice(0, 2),
      pitch: TankRig.dead(L.pitch) ? null : L.pitch.slice(0, 2),
      bands: TankRig.bands(pick.limitsTable),
    };
  },
  // What the gun may do while the turret is traversed to `yaw`: the band that covers that bearing,
  // or the flat limits when no table says otherwise. Bands are half-open at the top so the value
  // where two meet belongs to one of them and not to both.
  pitchAt(rig, yaw){
    if (!rig) return null;
    const b = rig.bands || [];
    for (let i = 0; i < b.length; i++) {
      const last = i === b.length - 1;
      if (yaw >= b[i][0] && (last ? yaw <= b[i][1] : yaw < b[i][1])) return [b[i][2], b[i][3]];
    }
    return rig.pitch || null;
  },
  clampPitch(rig, yaw, pitch){
    const p = TankRig.pitchAt(rig, yaw);
    return p ? Math.max(p[0], Math.min(p[1], pitch)) : pitch;
  },
  // Does the turret go all the way round? A casemate's does not, and offering it ±180° is what
  // made the ISU-152's gun swing through its own fighting compartment.
  traverses(rig){ return !!(rig && rig.yaw && TankRig.span(rig.yaw) > 350); },
  // The travel in a sentence, for the control's own tooltip.
  label(rig){
    if (!rig) return "";
    const deg = v => (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + "°";
    const parts = [];
    if (rig.yaw) parts.push(TankRig.traverses(rig) ? "traverses fully" : "traverses " + deg(rig.yaw[0]) + " to " + deg(rig.yaw[1]));
    if (rig.pitch) parts.push("elevates " + deg(rig.pitch[0]) + " to " + deg(rig.pitch[1]));
    const b = rig.bands || [];
    const worst = b.length ? Math.max(...b.map(x => x[2])) : null;
    if (b.length && rig.pitch && worst > rig.pitch[0] + .5)
      parts.push("only " + deg(worst) + " over part of its own hull");
    return parts.join(", ");
  },
};
/*==ENDTANKRIG==*/
// ---- the reader ----
// One unit blk → the records `TankRig.main` takes. Cached per unit, because a slider drag asks for
// the rig on every frame and the blk is parsed out of a vromfs.
const TankData = {
  cache: new Map(),
  // The vehicle on screen, as the unit id its blk is filed under. The skin units are what the
  // export writes for, and the first one that is a ground vehicle is the model being posed.
  unitId(){
    const on = (App.skinUnits || []).filter(u => u.on);
    const u = on.find(x => x.unit && /tank|ground/i.test(x.unit.cls || "")) || on[0];
    return (u && u.unit && u.unit.id) || App.vehicleKey || null;
  },
  // `null` while the game folder is not open or the unit has no such data — the caller then keeps
  // the inferred rig, which is what an imported .obj gets and what this must never take away.
  forUnit(id){
    if (!id) return null;
    if (TankData.cache.has(id)) return TankData.cache.get(id);
    let rig = null;
    try {
      const path = typeof acesUnitPath === "function" ? acesUnitPath(id) : null;
      const db = path && acesBlk(path);
      if (db && db.root) {
        const weapons = [];
        for (const cw of blkChildren(db, db.root, "commonWeapons"))
          for (const w of blkChildren(db, cw, "Weapon")) {
            const t = blkChildren(db, w, "turret")[0];
            const l = blkChildren(db, w, "limits")[0];
            const tab = blkChildren(db, w, "limitsTable")[0];
            weapons.push({
              turret: t ? blkParams(db, t) : null,
              limits: l ? blkParams(db, l) : null,
              limitsTable: tab ? blkParams(db, tab) : null,
            });
          }
        rig = TankRig.main(weapons);
      }
    } catch (err) {
      reportFailure("Reading “" + id + "”'s turret data", err, "tankrig|" + id);
    }
    TankData.cache.set(id, rig);
    return rig;
  },
  current(){ return TankData.forUnit(TankData.unitId()); },
};
