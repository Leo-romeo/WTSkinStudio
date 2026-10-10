// End-to-end verification of the app's armament code against the live install.
import { A, grp, skeletonOf } from "./arms.mjs";

let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg + (extra ? "  " + extra : "")); if (!cond) fails++; };

console.log("aces.vromfs.bin:", A.AcesDB.files.length, "entries,", A.AcesDB.names.length, "shared names");
console.log("unit files indexed:", A.acesUnitPaths().size);

// ---------- 1. the F-4E, in full ----------
console.log("\n=== F-4E ===");
const arm = A.unitArmament("f-4e");
ok(!!arm, "f-4e armament found", arm && arm.path);
ok(arm.model === "f_4e", "unit blk names its own model", "model=" + arm.model);
ok(arm.maxload === 7257, "max load mass read", "maxload=" + arm.maxload);
// This one counts CONTENT, not behaviour, so it moves when Gaijin ships loadouts: 24 when it was
// written, 26 as of the 2026-08-22 install. Update it and move on — what it is really guarding is
// that the list parses at all and is not silently empty. Every other number in this file describes
// the airframe (stations, HideNodes, max load) and should not drift.
ok(arm.loadouts.length === 26, "26 purchasable loadouts (tracks the installed game data)", "got " + arm.loadouts.length);
ok(arm.slots.length === 12, "12 stations", "got " + arm.slots.length);
ok(arm.hideNodes.length === 35, "35 HideNodes", "got " + arm.hideNodes.length);

// Stations come out in the game's own display order (WeaponSlot.order), which alternates wings —
// tier 11 outer-left, tier 1 outer-right, tier 10, tier 2 … — with the internal armament first.
const order = arm.slots.map(s => s.order);
ok(order[0] === null, "internal armament first", JSON.stringify(arm.slots.map(s => s.tier)));
ok(order.slice(1).every((v, i, a) => i === 0 || a[i - 1] < v), "stations sorted by WeaponSlot.order",
  "order=" + JSON.stringify(order.slice(1)) + " tiers=" + JSON.stringify(arm.slots.slice(1).map(s => s.tier)));

// the aim_9e loadout: exactly two Sidewinders, one per wing, on tier 9 and tier 3
const lo = arm.loadouts.find(l => l.name === "f_4e_aim9e");
ok(!!lo, "loadout f_4e_aim9e present");
const st = A.loadoutStations(arm, lo);
const carried = st.filter(s => !s.internal);
ok(carried.length === 2, "it fills two stations", carried.map(s => "tier " + s.tier + "/" + s.preset.name).join(", "));
const models = A.loadoutModels(arm, lo).filter(m => !m.internal);
const flat = models.flatMap(m => m.models.map(x => x.kind + ":" + x.model + "@" + m.node));
ok(String(flat) === String([
  "rack:aero_3b_2@aero_3b_001", "rocket:us_aim_9e_sidewinder@aero_3b_001",
  "rack:aero_3b_2@aero_3b_002", "rocket:us_aim_9e_sidewinder@aero_3b_002",
]), "exact racks, missiles and nodes", "\n          " + flat.join("\n          "));

// a nested rack: MER + three LAU-3A pods + rockets
const mer = A.resolveStore("gameData/Weapons/containers/mer_lau_3a_ffar_mighty_mouse.blk");
const chain = [];
for (let s = mer; s; s = s.child) chain.push(s.kind + ":" + (A.storeMesh(s) || "-") + "×" + (s.nodes.length || 1));
ok(chain.length === 3, "MER resolves three levels deep", chain.join(" → "));
// three LAU-3A pods on a MER, nineteen FFARs in each
ok(A.storeCount(mer) === 57, "MER/LAU-3A carries 57 rockets (3 pods × 19)", "count=" + A.storeCount(mer));

// ---------- 2. placement: the two Sidewinders must land mirrored on the wings ----------
console.log("\n=== placement ===");
const skel = skeletonOf("f_4e");
ok(!!skel, "f_4e skeleton loaded", skel && skel.size + " nodes");
const posOf = (m) => [m[0][3], m[1][3], m[2][3]];
const placements = [];
for (const st2 of models) {
  const wtm = skel.get(st2.node);
  if (!wtm) continue;
  const at = A.matFlipZ(wtm);
  placements.push({ node: st2.node, model: st2.models[0].model, pos: posOf(at) });
  // the missile hangs off a node in the rack's own skeleton
  const rackSk = skeletonOf(st2.models[0].model);
  const store = st2.weapon.store;
  for (const n of store.nodes) {
    const local = rackSk && rackSk.get(n);
    if (!local) continue;
    placements.push({ node: st2.node + "/" + n, model: st2.models[1].model, pos: posOf(A.matMul(at, A.matFlipZ(local))) });
  }
}
for (const p of placements) console.log("        " + p.model.padEnd(24) + p.node.padEnd(24) + p.pos.map(v => v.toFixed(3).padStart(8)).join(" "));
const left = placements.filter(p => p.pos[2] > 0), right = placements.filter(p => p.pos[2] < 0);
ok(left.length === right.length && left.length > 0, "same number of stores each side", left.length + " vs " + right.length);
// The game's own numbers are a couple of millimetres asymmetric, so 5 mm is the tolerance.
const mirrored = left.every(l => right.some(r =>
  Math.abs(l.pos[0] - r.pos[0]) < 5e-3 && Math.abs(l.pos[1] - r.pos[1]) < 5e-3 && Math.abs(l.pos[2] + r.pos[2]) < 5e-3));
ok(mirrored, "every left store mirrors a right store in Z");

// matFlipZ is a ROW NEGATION, not a change of basis (ROADMAP 4.29, wt-geometry): the file stores
// diag(1,1,−1)·(honest) on every node — 308 of the F-4E's 312 have det −1, the root being the
// exception — so recovering the honest transform FLIPS the determinant, and a store placed by it
// is placed by a proper rotation. This check said the opposite ("preserves the determinant")
// until 2026-09-20: it was written for the conjugation 4.29 replaced, and it could not be seen
// failing because the roster sweeps had been skipped since the install moved on 2026-09-07.
const det = m => m[0][0]*(m[1][1]*m[2][2] - m[1][2]*m[2][1])
              - m[0][1]*(m[1][0]*m[2][2] - m[1][2]*m[2][0])
              + m[0][2]*(m[1][0]*m[2][1] - m[1][1]*m[2][0]);
const mats = [...skel.values()];
ok(mats.every(m => Math.abs(det(A.matFlipZ(m)) + det(m)) < 1e-6), "matFlipZ flips the determinant",
  mats.filter(m => det(m) < 0).length + " of " + mats.length + " nodes carry the file's −1, and matFlipZ recovers +1 on each");
ok(mats.filter(m => det(m) < 0).length >= mats.length - 4, "the −1 is the file's convention, not a per-station mirror",
  mats.filter(m => det(m) >= 0).length + " node(s) at +1 (the root)");
ok(mats.every(m => { const r = A.matFlipZ(A.matFlipZ(m)); return r.every((row, i) => row.every((v, j) => Math.abs(v - m[i][j]) < 1e-9)); }),
  "matFlipZ is its own inverse");

// ---------- 3. coverage over the whole install ----------
console.log("\n=== whole install ===");
const t0 = Date.now();
let units = 0, slots = 0, presets = 0, weapons = 0, meshRefs = 0, resolved = 0, missingBlk = 0;
let nodeRefs = 0, nodeFound = 0, loadouts = 0, assigned = 0, assignHit = 0;
const unresolved = new Map();
for (const [base, p] of A.acesUnitPaths()) {
  const a = A.unitArmament(base);
  if (!a || !a.slots.length) continue;
  units++;
  const sk = skeletonOf(a.model || "");
  for (const s of a.slots) {
    slots++;
    for (const pr of s.presets) {
      presets++;
      for (const w of pr.weapons) {
        weapons++;
        if (w.store && w.store.missing) { missingBlk++; continue; }
        if (w.node && sk) { nodeRefs++; if (sk.has(w.node)) nodeFound++; }
        for (const m of A.storeModels(w.store)) {
          meshRefs++;
          if (grp.dyn.has(m.model)) resolved++; else unresolved.set(m.model, (unresolved.get(m.model) || 0) + 1);
        }
      }
    }
  }
  for (const l of a.loadouts) {
    loadouts++;
    for (const as of l.assign) { assigned++; if (a.byName.has(as.slot + "/" + as.preset)) assignHit++; }
  }
}
console.log(`  ${units} vehicles, ${slots} stations, ${presets} presets, ${weapons} weapon entries in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
ok(units > 700, "armament read for the whole roster", units + " vehicles");
ok(missingBlk === 0, "every store blk resolves inside aces.vromfs.bin", missingBlk + " missing");
ok(resolved === meshRefs, "every model reference names a real DynModel",
  resolved + "/" + meshRefs + (unresolved.size ? " · " + [...unresolved].slice(0, 5).map(([m, c]) => m + "×" + c).join(", ") : ""));
ok(nodeFound / nodeRefs > 0.97, "emitter nodes exist in the vehicle skeleton",
  nodeFound + "/" + nodeRefs + " = " + (nodeFound / nodeRefs * 100).toFixed(1) + "%");
ok(assignHit / assigned > 0.99, "loadout (station, preset) pairs all resolve",
  assignHit + "/" + assigned + " = " + (assignHit / assigned * 100).toFixed(1) + "%");
console.log(`  ${loadouts} purchasable loadouts across the roster`);

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
