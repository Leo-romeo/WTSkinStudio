// What every ground vehicle's own data says about its turret, its gun and their travel — the
// measurement ROADMAP 4.1's tank half asked for (CLAUDE.md §6: get the answer from the data).
//
// The app's tank rig guesses: `POSE_ROOTS` matches `^bone_turret$` and `^bone_gun_barrel$` by name
// and infers the elevation axis from the shape of the barrel. The unit's own blk carries all three
// node names and both travel ranges, in `commonWeapons/Weapon`:
//
//     turret { head:"bone_turret"; gun:"bone_gun"; barrel:"bone_gun_barrel" }
//     limits { yaw:[-180,180]; pitch:[-10,20] }
//     limitsTable { lim1:[-180,-133, 2,20]; lim2:[-133,133, -10,20]; lim3:[133,180, 2,20] }
//
// `limitsTable` is a list of [yawFrom, yawTo, pitchMin, pitchMax] — the M1's gun depresses 10°
// forward and only 2° over its own engine deck, which is the owner's report in the file's own data.
//
// Usage: node tools/turret_sweep.mjs [--csv <path>] [--limit N]
import fs from "fs";
import { A } from "./arms.mjs";

const argv = process.argv.slice(2);
const LIMIT = argv.includes("--limit") ? +argv[argv.indexOf("--limit") + 1] : Infinity;
const CSV = argv.includes("--csv") ? argv[argv.indexOf("--csv") + 1] : null;

const paths = A.acesUnitPaths();
const units = [...paths.entries()].filter(([, p]) => /tankmodels/i.test(p));
console.log(units.length + " ground units in gamedata/units/tankmodels/");

const rows = [];
let noWeapon = 0, noTurret = 0, read = 0;
for (const [id, path] of units.slice(0, LIMIT)) {
  let db;
  try { db = A.acesBlk(path); } catch { db = null; }
  if (!db || !db.root) continue;
  read++;
  const cw = (db.root.children || []).filter(c => db.nameOf(c) === "commonWeapons");
  const weapons = [];
  for (const b of cw) for (const w of (b.children || [])) if (db.nameOf(w) === "Weapon") weapons.push(w);
  if (!weapons.length) { noWeapon++; continue; }
  // the main gun: the first Weapon that names a turret with a barrel, else the first with limits
  let main = null, turret = null;
  for (const w of weapons) {
    const t = (w.children || []).find(c => db.nameOf(c) === "turret");
    if (t) { main = w; turret = A.blkParams(db, t) || {}; break; }
  }
  if (!main) { main = weapons[0]; noTurret++; }
  const P = A.blkParams(db, main) || {};
  const rootP = A.blkParams(db, db.root) || {};
  const lim = (main.children || []).find(c => db.nameOf(c) === "limits");
  const tab = (main.children || []).find(c => db.nameOf(c) === "limitsTable");
  const L = lim ? A.blkParams(db, lim) : null;
  const T = tab ? A.blkParams(db, tab) : null;
  const bands = T ? Object.keys(T).map(k => T[k]).filter(v => Array.isArray(v) && v.length >= 4) : [];
  rows.push({
    id, model: rootP.model,
    head: turret && turret.head, gun: turret && turret.gun, barrel: turret && turret.barrel,
    emitter: P.emitter,
    yaw: L && L.yaw, pitch: L && L.pitch,
    bands: bands.length,
    worstDep: bands.length ? Math.max(...bands.map(b => b[2])) : null,
    bestDep: bands.length ? Math.min(...bands.map(b => b[2])) : null,
  });
}
console.log(read + " read, " + rows.length + " with a weapon (" + noWeapon + " with none, " + noTurret + " with no turret block)");

const count = (f) => rows.reduce((m, r) => { const k = String(f(r)); m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => "  " + v + "  " + k).join("\n");

console.log("\n-- turret.head --\n" + top(count(r => r.head), 8));
console.log("\n-- turret.gun --\n" + top(count(r => r.gun), 8));
console.log("\n-- turret.barrel --\n" + top(count(r => r.barrel), 8));
console.log("\n-- does the barrel match the app's own regex (^bone_gun_barrel$)? --\n" +
  top(count(r => /^bone_gun_barrel$/i.test(String(r.barrel || r.emitter))), 4));

const withLim = rows.filter(r => r.yaw && r.pitch);
console.log("\n" + withLim.length + " carry limits; " + rows.filter(r => r.bands).length + " carry a limitsTable");
const full = withLim.filter(r => Math.abs(r.yaw[0]) >= 179 && Math.abs(r.yaw[1]) >= 179);
console.log("  full traverse (|yaw| ≥ 179 both ways): " + full.length + "   limited: " + (withLim.length - full.length));
const dep = withLim.map(r => r.pitch[0]).sort((a, b) => a - b);
const ele = withLim.map(r => r.pitch[1]).sort((a, b) => a - b);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log("  depression: min " + dep[0] + "  median " + pct(dep, .5) + "  max " + dep[dep.length - 1]);
console.log("  elevation:  min " + ele[0] + "  median " + pct(ele, .5) + "  max " + ele[ele.length - 1]);
const varies = rows.filter(r => r.bands && r.worstDep !== r.bestDep);
console.log("  depression varies with traverse on " + varies.length + " of " + rows.filter(r => r.bands).length + " with a table");
console.log("  e.g. " + varies.slice(0, 6).map(r => r.id + " " + r.bestDep + "…" + r.worstDep + "°").join(", "));
const casemates = withLim.filter(r => Math.abs(r.yaw[0]) < 179 || Math.abs(r.yaw[1]) < 179).slice(0, 8);
console.log("  limited traverse e.g. " + casemates.map(r => r.id + " [" + r.yaw + "]").join(", "));

if (CSV) {
  fs.writeFileSync(CSV, "id,head,gun,barrel,emitter,yaw0,yaw1,pitch0,pitch1,bands\n" +
    rows.map(r => [r.id, r.head, r.gun, r.barrel, r.emitter, r.yaw && r.yaw[0], r.yaw && r.yaw[1],
                   r.pitch && r.pitch[0], r.pitch && r.pitch[1], r.bands].join(",")).join("\n"));
  console.log("\nwrote " + CSV);
}

// ---- do the names the datasheet gives exist in the model the unit loads? ----
// `--nodes [N]` loads N ground models' skeletons and checks. A name in the blk that the skeleton
// does not have would mean no control at all, which is the failure the old regex had by another
// route; the rig falls back to the regex when a name is missing, and this says how often it must.
if (argv.includes("--nodes")) {
  const N = +argv[argv.indexOf("--nodes") + 1] || 40;
  const { grp, skeletonOf } = await import("./arms.mjs");
  let checked = 0, haveHead = 0, haveGun = 0, haveBarrel = 0, noSkel = 0;
  const missing = [];
  for (const r of rows) {
    if (checked >= N) break;
    if (!r.head && !r.gun) continue;
    // the unit id is the model name for a ground vehicle, give or take the nation prefix
    const model = r.model && grp.dyn.has(r.model) ? r.model : null;
    if (!model) continue;
    let sk = null;
    try { sk = skeletonOf(model); } catch { sk = null; }
    if (!sk || !sk.byName) { noSkel++; continue; }
    checked++;
    const has = n => !!(n && sk.byName.has(n));
    if (has(r.head)) haveHead++; else missing.push(r.id + " head=" + r.head);
    if (has(r.gun)) haveGun++; else missing.push(r.id + " gun=" + r.gun);
    if (has(r.barrel)) haveBarrel++; else if (r.barrel) missing.push(r.id + " barrel=" + r.barrel);
  }
  console.log("\n-- the datasheet's names against the models' own skeletons (" + checked + " loaded, " + noSkel + " with no skeleton) --");
  console.log("  head present on " + haveHead + ", gun on " + haveGun + ", barrel on " + haveBarrel);
  if (missing.length) console.log("  missing: " + missing.slice(0, 12).join(", "));
}
