/*==ARMBUILD==*/
"use strict";
// ---------- Building a loadout by hand ----------
// The game's own presets are all-or-nothing: a `weapon_presets` entry names one WeaponPreset per
// station and you take it whole. That is the wrong grain for painting, because what a skin has to
// look right against is *this* aircraft with *these* stores — a tank on the centreline, two
// Sidewinders outboard and nothing else — which no purchasable loadout happens to be.
//
// So the panel builds one. A build is nothing more than a station→preset map, and the shape it
// produces is exactly the `{ name, blk, assign }` that loadWeaponLoadout already takes for a game
// loadout, so nothing downstream knows the difference. Everything here is pure data: no DOM, no
// scene, so the same object serialises straight into a .wtproj and into prefs.
const ArmBuild = {
  unit: null,            // which unit the current build belongs to
  sel: new Map(),        // slot index → preset name. Absent = that station carries nothing.
  base: null,            // the game loadout (or saved build) it was filled from, for the "edited" mark
  open: new Set(),       // slot indices whose preset list is expanded in the panel
  saved: [],             // [{ name, unit, assign }] — the user's own, persisted through prefs
  naming: false,         // the "save as…" row is open
  nameDraft: "",         // what has been typed into it, kept across the panel's rebuilds

  // A build belongs to one unit. Switching vehicle must not leave the previous aircraft's station
  // numbers behind, so every read goes through this.
  ensure(unit){
    if (this.unit !== unit) { this.unit = unit || null; this.sel.clear(); this.open.clear(); this.base = null; }
    return this;
  },
  clear(){ this.sel.clear(); this.base = null; },
  presetOn(arm, slotIndex){
    const name = this.sel.get(slotIndex);
    if (!name) return null;
    const slot = arm && arm.slots.find(s => s.index === slotIndex);
    return (slot && slot.presets.find(p => p.name === name)) || null;
  },
  set(slotIndex, presetName){
    if (presetName) this.sel.set(slotIndex, presetName); else this.sel.delete(slotIndex);
  },
  toggleOpen(slotIndex){
    if (this.open.has(slotIndex)) this.open.delete(slotIndex); else this.open.add(slotIndex);
  },
  // The hardpoint row (ROADMAP 4.38) shows ONE station's choices under the row, so opening a
  // hardpoint closes the others — two open lists under one row would not say which chip each
  // belongs to. Clicking the open one folds it. The fixed armament keeps toggleOpen: its rows
  // expand in place, where several open at once is unambiguous.
  openOnly(slotIndex){
    const was = this.open.has(slotIndex);
    this.open.clear();
    if (!was) this.open.add(slotIndex);
  },
  // ---- where each hardpoint IS, for a row laid out the way the in-game loadout screen is ----
  // The game's own loadout screen shows the hardpoints in a row as the aircraft is seen from the
  // FRONT, so the right wing is on the viewer's LEFT. Measured over the whole roster (2026-09-20,
  // 817 units with stations and a skeleton, 5 077 ordered stations): every `_l`-named skeleton
  // node sits at negative scene z and every `_r` at positive (810 of 810 units), and the nose is
  // +x — so port is −z, starboard is +z, and a camera at +x looking back sees +z on its left.
  // The row is therefore SORTED BY SCENE Z, DESCENDING, off the emitter node each station's
  // presets hang from (the median over them, because a rack and a rail on one pylon differ by
  // centimetres). Scene z is −wtm.tz: the skeleton stores diag(1,1,−1)·(honest) and the geometry
  // builder negates z again — wt-geometry. `WeaponSlot.order` was measured too and is NOT the
  // rule: it alternates port/starboard from the outer pylon inwards (odd → port on 2 223 of
  // 2 332 off-centre stations, even → starboard on 2 246 of 2 287), but 142 units break the
  // alternation and the centreline can be either parity — so parity is only the fallback for a
  // model with no skeleton (an imported .obj with a game unit typed in), and the row says so.
  //   `skel` is the vehicle skeleton (name → wtm), `span` the model's lateral size for the
  //   centreline tolerance. Returns the hardpoints left-to-right as the viewer sees them, each
  //   with its side, its rank from the wingtip and a label; fixed armament (no `order`) is not a
  //   hardpoint and is left out.
  //
  // A hardpoint is a station with an `order` OR a `tier`. 18 units (the Su-30SM2, the Su-24M, the
  // J-11B, the Halifax, the Ju 87s…) number every station by `tier` alone, and 42 more number a
  // few that way — 220 stations on the 58 of those units with a skeleton, every one with an
  // emitter node on it (measured 2026-09-21, `tools/t65_hardpoints.mjs`). Until then
  // `order == null` meant "fixed armament",
  // so the Su-30SM2's twelve pylons were listed as internal guns and its row was empty.
  hardpoints(arm, skel, span){
    const tol = Math.max(0.05, (span || 0) * 0.02);
    const pts = [];
    for (const slot of (arm ? arm.slots : [])) {
      const num = ArmBuild.stationNo(slot);
      if (num == null) continue;
      const zs = [];
      if (skel) for (const p of slot.presets) for (const w of p.weapons) {
        const wtm = w.node ? skel.get(w.node) : null;
        if (wtm) zs.push(-wtm[2][3]);
      }
      let z;
      const measured = zs.length > 0;
      if (measured) { zs.sort((a, b) => a - b); z = zs[zs.length >> 1]; }
      else z = (num % 2 ? -1 : 1) * (1000 - num);       // parity: odd → port, outer first
      const side = measured && Math.abs(z) < tol ? "centre" : z < 0 ? "port" : "starboard";
      pts.push({ slot, z, side, measured, rank: 0, label: "" });
    }
    // Viewer's left is +z (the right wing). Same z — two slots on one pylon — keeps the game's order.
    pts.sort((a, b) => (b.z - a.z) || (ArmBuild.stationNo(a.slot) - ArmBuild.stationNo(b.slot)));
    // Rank from the wingtip inwards, per side; slots sharing a pylon share the rank.
    for (const side of ["port", "starboard"]) {
      const on = pts.filter(p => p.side === side).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      let r = 0, last = null;
      for (const p of on) {
        if (last == null || Math.abs(Math.abs(p.z) - last) > 1e-6) { r++; last = Math.abs(p.z); }
        p.rank = r;
      }
    }
    const ord = n => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
    for (const p of pts) {
      p.label = p.side === "centre" ? "Centreline"
        : (p.side === "port" ? "Left wing" : "Right wing") + ", " + ord(p.rank) + " from the tip";
      if (!p.measured) p.label += " (by the game's order — no skeleton to measure)";
    }
    return pts;
  },
  // The game's own number for a station: `order` where the unit gives one, else `tier`. Null is
  // the fixed armament — cannon, countermeasures — which hangs nowhere.
  stationNo(slot){ return slot.order != null ? slot.order : slot.tier != null ? slot.tier : null; },
  isHardpoint(slot){ return ArmBuild.stationNo(slot) != null; },
  // What changes between the loadout on the aircraft and the one wanted: which stations to take
  // down, which to hang, which to leave alone. Both sides are `[{ slot, preset }]`, the game's own
  // vocabulary. A station whose preset changed is in both `drop` and `add`. This is what makes a
  // click on one hardpoint cost one hardpoint (2026-09-21) rather than the whole loadout.
  stationDiff(current, wanted){
    const cur = new Map(), want = new Map();
    for (const s of (current || [])) cur.set(s.slot | 0, s.preset);
    for (const s of (wanted || [])) want.set(s.slot | 0, s.preset);
    const drop = new Set(), add = new Set(), keep = new Set();
    for (const [slot, p] of cur) { if (want.get(slot) === p) keep.add(slot); else drop.add(slot); }
    for (const [slot, p] of want) if (cur.get(slot) !== p) add.add(slot);
    return { drop, add, keep };
  },
  // `assign` is the game's own vocabulary — the same list a weapon_presets file spells out — which
  // is why it is what gets stored rather than the Map.
  assign(){
    const out = [];
    for (const [slot, preset] of this.sel) if (preset) out.push({ slot, preset });
    return out.sort((a, b) => a.slot - b.slot);
  },
  fromAssign(arm, unit, assign){
    this.ensure(unit);
    this.sel.clear();
    for (const a of (assign || [])) {
      // Only what this aircraft actually has. A build restored from a project saved against an
      // older game patch must not resurrect a station that no longer exists.
      const slot = arm && arm.slots.find(s => s.index === (a.slot | 0));
      if (slot && slot.presets.some(p => p.name === a.preset)) this.sel.set(slot.index, a.preset);
    }
    return this;
  },
  fromLoadout(arm, unit, lo){
    this.fromAssign(arm, unit, lo && lo.assign);
    this.base = lo ? lo.name : null;
    return this;
  },
  // The loadout object the loader takes. `blk` is empty because this one came from nobody's file.
  toLoadout(name){ return { name: name || this.label(), blk: "", assign: this.assign(), custom: true }; },
  label(){ return this.base ? this.base + " (edited)" : "custom loadout"; },
  isEmpty(){ return !this.assign().length; },
  // Has the build moved away from the thing it was filled from? That is the whole difference
  // between "you are looking at a game preset" and "you have made one of your own".
  dirty(arm){
    if (!this.base) return !this.isEmpty();
    // By unit as well as by name: two aircraft may each have a saved loadout called "strike".
    const from = (arm && arm.loadouts.find(l => l.name === this.base)) ||
                 this.forUnit(this.unit).find(s => s.name === this.base);
    if (!from) return true;
    const a = JSON.stringify(this.assign());
    const b = JSON.stringify(ArmBuild.normalise(arm, from.assign));
    return a !== b;
  },
  // The same filtering fromAssign does, without disturbing the live build — so `dirty` compares
  // like with like rather than calling a station the game dropped a difference.
  normalise(arm, assign){
    const out = [];
    const seen = new Set();
    for (const a of (assign || [])) {
      const slot = arm && arm.slots.find(s => s.index === (a.slot | 0));
      if (!slot || seen.has(slot.index)) continue;
      if (!slot.presets.some(p => p.name === a.preset)) continue;
      seen.add(slot.index);
      out.push({ slot: slot.index, preset: a.preset });
    }
    return out.sort((x, y) => x.slot - y.slot);
  },
  // What the build weighs, out of the store blks themselves, against the WeaponSlots maxloadMass.
  // PresetInfo.tally sums a store chain the way the loadout screen does — the rack's root mass where
  // it has one, the payload's `rocket{}`/`bomb{}` mass times the count.
  mass(arm){
    let kg = 0, known = 0, stores = 0;
    for (const { slot } of this.assign()) {
      const p = this.presetOn(arm, slot);
      if (!p) continue;
      for (const r of PresetInfo.tally(p)) { stores += r.count; kg += r.kg; if (r.known) known += r.count; }
    }
    return { kg, stores, known, complete: known === stores, max: (arm && arm.maxload) || 0 };
  },
  // ---- the user's own, saved by name ----
  forUnit(unit){ const u = String(unit || "").toLowerCase(); return this.saved.filter(s => s.unit === u); },
  save(unit, name){
    const u = String(unit || "").toLowerCase(), n = String(name || "").trim();
    if (!u || !n) return null;
    const rec = { name: n, unit: u, assign: this.assign() };
    const i = this.saved.findIndex(s => s.unit === u && s.name === n);
    if (i >= 0) this.saved[i] = rec; else this.saved.push(rec);
    return rec;
  },
  remove(unit, name){
    const u = String(unit || "").toLowerCase();
    const i = this.saved.findIndex(s => s.unit === u && s.name === name);
    if (i >= 0) this.saved.splice(i, 1);
    return i >= 0;
  },
  // Persisted through the PREFS table, so it survives a reload and travels with a settings export.
  // Kept small and defensive: a settings file is user-editable and a bad row must not break boot.
  serialise(){ return this.saved.map(s => ({ name: s.name, unit: s.unit, assign: s.assign })); },
  adopt(list){
    if (!Array.isArray(list)) return;
    this.saved = list.filter(s => s && typeof s.name === "string" && typeof s.unit === "string" && Array.isArray(s.assign))
      .map(s => ({ name: s.name, unit: s.unit,
        assign: s.assign.filter(a => a && typeof a.preset === "string").map(a => ({ slot: a.slot | 0, preset: a.preset })) }));
  },
};
/*==ENDARMBUILD==*/
