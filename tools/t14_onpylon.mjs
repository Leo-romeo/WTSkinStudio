// The decisive placement test: extract the F-4E's real geometry and check that each store lands
// on the pylon part it is supposed to hang from.
import fs from "fs";
import { A, grp, skeletonOf, WT } from "./arms.mjs";
import { installOodle } from "./oodle_lift.mjs";

const src = fs.readFileSync(new URL("../wt_skin_studio.html", import.meta.url), "utf8");
const section = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  return src.slice(a + 1, b);
};
// Oodle, for model packs compressed with it.
// The page's own decoder, whichever this build carries (tools/oodle_lift.mjs) — not a RAD-only
// shim, which is what stood here until 2026-09-20 and had been broken since the page stopped
// carrying RAD's blob.
installOodle(src);
globalThis.zstdDec = A.zstdDec;
const M = new Function(section("MODEL") +
  "\nreturn { grpParseFront, GRP_CLS, loadSkeletonBytes, loadDynModelBytes, buildDynModelGeometry, MReader };")();

const ref = grp.dyn.get("f_4e");
const pack = new Uint8Array(fs.readFileSync(ref.p));
const dm = await M.loadDynModelBytes(pack.subarray(ref.e.offset, ref.e.offset + ref.e.size), "f_4e");
dm.skeleton = skeletonOf("f_4e");
const geo = M.buildDynModelGeometry(dm, 0);
console.log("f_4e LOD0:", geo.verts.length.toLocaleString(), "vertices,", geo.objects.length, "objects");

// centroid + bounds of each named object in the extracted (Z-negated) geometry
const objInfo = new Map();
for (const o of geo.objects) {
  let n = 0, sx = 0, sy = 0, sz = 0;
  const seen = new Set();
  for (const g of o.groups) for (const f of g.faces) for (const vi of f) {
    if (seen.has(vi)) continue;
    seen.add(vi);
    const v = geo.verts[vi];
    if (!v) continue;
    sx += v[0]; sy += v[1]; sz += v[2]; n++;
  }
  if (n) objInfo.set(o.name, { c: [sx/n, sy/n, sz/n], n, vi: [...seen] });
}

let fails = 0;
const ok = (c, m, e) => { console.log((c ? "  PASS  " : "  FAIL  ") + m + (e ? "  " + e : "")); if (!c) fails++; };
const arm = A.unitArmament("f-4e");
const skel = skeletonOf("f_4e");
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

console.log("\nnode-named objects in the model:", [...objInfo.keys()].filter(n => /aero_3b|pylon|lau|mer|suu/i.test(n)).join(", "));

// For every station whose emitter node is also a part in the model, the placement we compute must
// sit on that part.
console.log("\nstation node → distance from the placement to that part's own geometry");
let checked = 0, near = 0;
for (const slot of arm.slots) {
  for (const p of slot.presets) {
    for (const w of p.weapons) {
      if (!w.node) continue;
      const wtm = skel.get(w.node);
      const info = objInfo.get(w.node);
      if (!wtm || !info) continue;
      const at = A.matFlipZ(wtm);
      const pos = [at[0][3], at[1][3], at[2][3]];
      const d = dist(pos, info.c);
      checked++;
      if (d < 0.75) near++;
      if (checked <= 12) console.log(`        ${w.node.padEnd(22)} placement ${pos.map(v => v.toFixed(3).padStart(7)).join(" ")}  part centroid ${info.c.map(v => v.toFixed(3).padStart(7)).join(" ")}  Δ ${d.toFixed(3)} m`);
    }
  }
}
ok(checked > 0, "stations whose emitter node is a model part", checked + " checked");
ok(near === checked, "every placement sits on its own node's geometry (< 0.75 m)", near + "/" + checked);

// And the naive alternative — no Z conjugation — must be measurably worse, which is the proof
// that the flip is needed rather than cosmetic.
let naive = 0;
for (const slot of arm.slots) for (const p of slot.presets) for (const w of p.weapons) {
  if (!w.node) continue;
  const wtm = skel.get(w.node), info = objInfo.get(w.node);
  if (!wtm || !info) continue;
  if (dist([wtm[0][3], wtm[1][3], wtm[2][3]], info.c) < 0.75) naive++;
}
ok(naive < near, "skipping the Z conjugation misplaces stores", "unflipped: " + naive + "/" + checked + " vs flipped " + near + "/" + checked);

// Wider sample of the same transform: every skeleton node that is also a part of the model.
// This is what the placement relies on, so it should agree everywhere, not just on the pylons.
// A node's origin is its pivot, not the middle of the part it drives (an aircraft's `tail` node
// sits at the fuselage join, metres from the tail's centroid), so the honest measure is the
// distance from the node origin to the nearest vertex of its own geometry.
console.log("\nall nodes that are also parts:");
const nearestVert = (p, info) => {
  let best = Infinity;
  for (const vi of info.vi) { const v = geo.verts[vi]; if (v) { const d = dist(p, v); if (d < best) best = d; } }
  return best;
};
let both = 0, hit = 0, hitNaive = 0, worst = 0, worstName = "";
const offCentre = [];
for (const [node, wtm] of skel) {
  const info = objInfo.get(node);
  if (!info || info.n < 8) continue;
  both++;
  const at = A.matFlipZ(wtm);
  const d = nearestVert([at[0][3], at[1][3], at[2][3]], info);
  const dn = nearestVert([wtm[0][3], wtm[1][3], wtm[2][3]], info);
  if (d < 0.35) hit++; else if (d > worst) { worst = d; worstName = node; }
  if (dn < 0.35) hitNaive++;
  if (Math.abs(info.c[2]) > 0.3) offCentre.push({ node, d, dn });
}
console.log(`  ${both} nodes are also parts; ${offCentre.length} of them sit off the centreline (|z| > 0.3 m)`);
// Nodes whose transform is the identity say nothing about placement: their geometry is authored
// where it belongs and the node sits at the model origin (pylon_l_out is exactly this — origin
// 0,0,0 with geometry 3.4 m out on the wing). Only nodes that actually carry a transform test it.
const isIdentity = m => Math.abs(m[0][3]) < 1e-6 && Math.abs(m[1][3]) < 1e-6 && Math.abs(m[2][3]) < 1e-6;
let moved = 0, movedHit = 0;
for (const [node, wtm] of skel) {
  const info = objInfo.get(node);
  if (!info || info.n < 8 || isIdentity(wtm)) continue;
  moved++;
  const at = A.matFlipZ(wtm);
  if (nearestVert([at[0][3], at[1][3], at[2][3]], info) < 0.35) movedHit++;
}
console.log("  " + (both - moved) + " of the " + both + " have identity transforms (geometry authored in place)");
const stray = [];
for (const [node, wtm] of skel) {
  const info = objInfo.get(node);
  if (!info || info.n < 8 || isIdentity(wtm)) continue;
  const at = A.matFlipZ(wtm);
  const d = nearestVert([at[0][3], at[1][3], at[2][3]], info);
  if (d >= 0.35) stray.push(node + " Δ" + d.toFixed(2));
}
console.log("  " + movedHit + "/" + moved + " land on their own geometry; the rest: " + stray.join(", "));
// Reported, not gated. A node's origin is a pivot, so a distance to its own geometry measures how
// the model was authored, not whether the placement transform is right: a gun-barrel node sits at
// the breech, a flare node at the point the flare leaves the dispenser. None of the strays is a
// node a store with a model hangs from — the two pylon_* ones are used for visibility only. What
// gates this file is the discriminating check below and the two station checks at the end.
const ocHit = offCentre.filter(o => o.d < 0.35).length, ocNaive = offCentre.filter(o => o.dn < 0.35).length;
ok(ocHit > ocNaive * 2, "off-centreline parts prove the Z conjugation",
  "flipped " + ocHit + "/" + offCentre.length + " vs unflipped " + ocNaive + "/" + offCentre.length);

// The clincher. The F-4E ships pre-modelled racks on its wing stations (us_lau_117a_001/002),
// which the game hides when a different store is fitted there. A Sidewinder rack placed at that
// station's emitter node must land on top of that geometry — same station, same place.
console.log("\nplaced store vs the rack the model already has on that station:");
for (const [node, part] of [["aero_3b_001", "us_lau_117a_001"], ["aero_3b_002", "us_lau_117a_002"]]) {
  const wtm = skel.get(node), info = objInfo.get(part);
  if (!wtm || !info) { ok(false, node + " / " + part + " both present"); continue; }
  const at = A.matFlipZ(wtm);
  const pos = [at[0][3], at[1][3], at[2][3]];
  const d = nearestVert(pos, info);
  console.log(`        ${node} at ${pos.map(v => v.toFixed(3).padStart(7)).join(" ")}  →  nearest ${part} vertex Δ ${d.toFixed(3)} m`);
  ok(d < 0.35, node + " lands on the " + part + " rack already modelled there", "Δ " + d.toFixed(3) + " m");
  // and without the flip it would be on the opposite wing
  const dn = nearestVert([wtm[0][3], wtm[1][3], wtm[2][3]], info);
  ok(dn > 1.5, "  unflipped, it would be " + dn.toFixed(2) + " m away (the other wing)");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
