// The hardpoint row is the right way round, over the whole roster (ROADMAP 4.38).
//
// The Weapons tab lays the hardpoints out in a row as the game's loadout screen does — the
// aircraft seen from the FRONT, so the right wing is on the viewer's left. `ArmBuild.hardpoints`
// decides the order from where each station's emitter node IS on the skeleton, and this test runs
// the shipped function over every aircraft in the install with its real skeleton, because the
// mistake it guards against — a mirrored row — is invisible on a symmetric loadout and obvious on
// a one-sided one, and it is the same class of mistake as the −1 determinant in wt-geometry.
//
// Three things are held:
//   1. THE SIGN CONVENTION the row rests on. Every `_l`-named skeleton node sits at negative scene
//      z and every `_r` at positive — measured 810 of 810 units on 2026-09-20. If a Dagor update
//      ever flips it, the row flips silently, and this is the line that would say so.
//   2. Named aircraft, by hand: the F-4E, the Harrier GR.7, the P-47D and the Spitfire IX all put
//      their order-2 station (starboard outer) at the LEFT end of the row and order-1 (port outer)
//      at the right, with the centreline in the middle.
//   4. Stations numbered by TIER alone — no `order` — are hardpoints and in the row (the Su-30SM2's
//      twelve; 220 stations over 58 units), each placed off its own node.
//   3. The parity FALLBACK is honest. A model with no skeleton gets its sides from
//      WeaponSlot.order's parity; measured against the skeleton answer over every off-centre
//      station, that has to agree on the great majority (96.8 % when written) or the fallback is a
//      guess dressed as a rule.
//
// Usage: node tools/t65_hardpoints.mjs          (needs the install; WT_DIR overrides the path)
import fs from "fs";
import { A, skeletonOf } from "./arms.mjs";
import { makeReport } from "./headless.mjs";
import { fileURLToPath } from "url";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " not in the page");
  return src.slice(a + 1, b);
};
// The shipped ArmBuild, not a copy of its rule. It reaches storeCount / storePayload only from
// mass(), which nothing here calls.
const ArmBuild = new Function(section("ARMBUILD") + "\nreturn ArmBuild;")();
const R = makeReport();

const SIDE = /_(l|r)(\d*|_.*)$/i;
const med = a => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };

let units = 0, lNeg = 0, lPos = 0, stations = 0, measured = 0;
let offCentre = 0, parityAgrees = 0, sortedWrong = 0, tierOnlyUnits = 0, tierOnlyStations = 0;
const unmeasured = [], byId = new Map();
for (const id of A.acesUnitPaths().keys()) {
  const arm = A.unitArmament(id);
  if (!arm || !arm.slots.length || !arm.model) continue;
  const sk = skeletonOf(arm.model);
  if (!sk) continue;
  units++;
  // 1. the convention: _l nodes at −z, _r at +z (scene z = −stored tz)
  const lz = [], rz = [];
  for (const [name, wtm] of sk) { const m = SIDE.exec(name); if (m) (m[1].toLowerCase() === "l" ? lz : rz).push(-wtm[2][3]); }
  const lm = med(lz), rm = med(rz);
  if (lm != null && rm != null && lm !== rm) (lm < rm ? lNeg++ : lPos++);
  // the row itself
  const span = Math.max(...[...sk.values()].map(w => Math.abs(w[2][3]))) * 2 || 0;
  const pts = ArmBuild.hardpoints(arm, sk, span);
  byId.set(id, pts);
  // 4. stations numbered by tier alone (no order) are hardpoints too — the Su-30SM2 has twelve
  const tierOnly = pts.filter(p => p.slot.order == null).length;
  if (tierOnly) { tierOnlyUnits++; tierOnlyStations += tierOnly; }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    stations++;
    if (p.measured) measured++; else unmeasured.push(id + " station " + p.slot.order);
    if (i && pts[i - 1].z < p.z - 1e-9) sortedWrong++;
    if (p.measured && p.side !== "centre") {
      offCentre++;
      if ((ArmBuild.stationNo(p.slot) % 2 ? "port" : "starboard") === p.side) parityAgrees++;
    }
  }
}

console.log(`=== ${units} aircraft with stations and a skeleton, ${stations} hardpoints ===`);
R.is(units > 700, `a roster, not a sample: ${units} units`);
R.is(lNeg / Math.max(1, lNeg + lPos) >= 0.99,
  `_l nodes sit at negative scene z on ${lNeg} of ${lNeg + lPos} units — port is −z, starboard +z, and the row rests on that`);
R.is(measured / Math.max(1, stations) >= 0.995,
  `${measured} of ${stations} hardpoints placed off their own node (${unmeasured.length} fell back to the game's order` +
  (unmeasured.length ? ": " + unmeasured.slice(0, 6).join(", ") + (unmeasured.length > 6 ? ", …" : "") : "") + ")");
R.is(sortedWrong === 0, `every row runs +z → −z, right wing first (${sortedWrong} out of order)`);

console.log("\n=== named aircraft, by hand ===");
for (const id of ["f-4e", "harrier_gr7", "p-47d", "spitfire_mk9c"]) {
  const pts = byId.get(id);
  if (!pts) { R.bad(`${id}: not in this install`); continue; }
  const first = pts[0].slot.order, last = pts[pts.length - 1].slot.order;
  const centre = pts.findIndex(p => p.side === "centre");
  const mid = Math.floor(pts.length / 2);
  R.is(first === 2 && last === 1,
    `${id.padEnd(14)} station 2 (starboard outer) is at the LEFT end and station 1 (port outer) at the right — ` +
    pts.map(p => p.slot.order).join(" "));
  R.is(centre < 0 || centre === mid, `${"".padEnd(14)} the centreline station sits in the middle` +
    (centre < 0 ? " (none)" : ` (${centre + 1} of ${pts.length})`));
  R.is(pts.every(p => p.measured), `${"".padEnd(14)} every hardpoint measured off its node — no fallback label`);
  const labels = [...new Set(pts.map(p => p.label))];
  R.is(labels[0].startsWith("Right wing, 1st") && labels[labels.length - 1].startsWith("Left wing, 1st"),
    `${"".padEnd(14)} the labels read wingtip-to-wingtip: ${labels[0]} … ${labels[labels.length - 1]}`);
}

console.log("\n=== stations numbered by tier alone are hardpoints too ===");
// Measured 2026-09-21: 18 units number every station by `tier` with no `order` at all, 42 more a
// few of them — 220 such stations on the 58 of those units with a skeleton, every one with an
// emitter node on it. Until then
// `order == null` meant "fixed armament", so the Su-30SM2's twelve pylons were listed as internal
// guns and its hardpoint row was empty (reported 2026-09-20 with the game's own screen beside it).
const su30 = byId.get("su_30sm2");
R.is(tierOnlyUnits >= 50 && tierOnlyStations >= 100,
  `${tierOnlyStations} tier-only stations on ${tierOnlyUnits} units are in the row (220 on 58 when measured)`);
R.is(!!su30 && su30.length === 12 && su30.every(p => p.measured && p.slot.order == null),
  `the Su-30SM2 has ${su30 ? su30.length : "?"} hardpoints, all by tier, all placed off their own node`);
const sides = su30 ? su30.map(p => p.side[0]).join("") : "";
R.is(sides === "sssssccppppp",
  `  five a side and the tandem pair on the centreline in the middle (${sides}) — tiers ${su30 ? su30.map(p => p.slot.tier).join(" ") : "?"}, right wing first, as the game draws its 6 | 6`);

console.log("\n=== the parity fallback is honest ===");
R.is(parityAgrees / Math.max(1, offCentre) >= 0.95,
  `odd → port, even → starboard agrees with the skeleton on ${parityAgrees} of ${offCentre} off-centre hardpoints ` +
  `(${(100 * parityAgrees / Math.max(1, offCentre)).toFixed(1)} %)`);
R.finish();
