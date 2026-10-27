// The cockpit body over the whole roster (ROADMAP 4.14) — needs the install.
//
// `Cockpit` finds the first-person model by NAME, `<model>_cockpit`, and puts the seat at the unit
// blk's `cockpit/headPos`. Both are lookups, not searches, and this is what says they still hold:
//   1. COVERAGE. Of every flying unit whose blk names a model the packs carry, the great majority
//      (1 581 of 1 616 when written) have `<model>_cockpit`, and the ones without are drones,
//      catapult floatplanes and the zeppelin — units the game gives no first-person view either.
//      If Gaijin renames the sibling, this is the line that drops.
//   2. THE SEAT. Nearly every unit with a `cockpit{}` block carries `headPos` (1 621 of 1 630), and on
//      the F-4E it is where a pilot sits: inside the model's box, well forward of its centre, on
//      the centreline, above the fuselage axis — in app space after `Cockpit.seatFrom`.
//   3. ONE VEHICLE, TWO BODIES. The F-4E's cockpit model binds the exterior's own airframe sheet
//      (`f_4e_c`) beside sheets of its own named for the cockpit, and spans the same box as the
//      exterior — so the wing seen from the seat is the wing the skin paints.
//
// Usage: node --max-old-space-size=4096 tools/t72_cockpitroster.mjs   (WT_DIR overrides the path)
import fs from "fs";
import path from "path";
import { A, grp, WT } from "./arms.mjs";
import { installOodle } from "./oodle_lift.mjs";
import { makeReport } from "./headless.mjs";
import { fileURLToPath } from "url";
import { isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " not in the page");
  return src.slice(a + 1, b);
};
const R = makeReport();

// ---- 1. coverage: every flying unit's model, by the blk's own `model` param ----
let units = 0, withCockpit = 0; const missing = [];
for (const [base, p] of A.acesUnitPaths()) {
  if (!/flightmodels/.test(p)) continue;
  const db = A.acesBlk(p); if (!db) continue;
  const m = A.blkParams(db, db.root).model;
  if (!m || !grp.dyn.has(m)) continue;
  units++;
  if (grp.dyn.has(m + "_cockpit")) withCockpit++; else missing.push(base + "→" + m);
}
R.is(units > 1500 && withCockpit / units > .97,
  `${withCockpit} of ${units} flying units with a model have <model>_cockpit (${(100 * withCockpit / units).toFixed(1)} %)`);
const NOSEAT = /uav|ucav|drone|zeppelin|walrus|e7k|e8n|kor_|ro_43|sc_1|fau|gl_832|li_2|loire|o3u|osprey|po_2|fairey|mq_1|orion|wing_loong|scout|quadcopter/i;
const odd = missing.filter(x => !NOSEAT.test(x));
R.is(odd.length === 0, odd.length ? "units without a cockpit model that are not drones or floatplanes: " + odd.join(", ")
  : `the ${missing.length} without one are drones, catapult floatplanes and the zeppelin`);

// ---- 2. the seat, over the roster and on the F-4E ----
let blocks = 0, heads = 0;
for (const [base, p] of A.acesUnitPaths()) {
  if (!/flightmodels/.test(p)) continue;
  const db = A.acesBlk(p); if (!db) continue;
  const ck = A.blkChildren(db, db.root, "cockpit")[0]; if (!ck) continue;
  blocks++;
  if (A.blkList(A.blkParams(db, ck).headPos).length) heads++;
}
R.is(blocks > 1500 && heads / blocks > .99, `${heads} of ${blocks} units with a cockpit block carry headPos`);

// the shipped conversion, not a copy of it: COCKPIT binds one select at load, so $ is stubbed
globalThis.$ = () => ({});
const Cockpit = new Function(section("COCKPIT") + "\nreturn Cockpit;")();
const f4 = A.acesBlk(A.acesUnitPath("f_4e"));
const f4head = A.blkList(A.blkParams(f4, A.blkChildren(f4, f4.root, "cockpit")[0]).headPos)[0];
const seat = Cockpit.seatFrom(f4head);

// ---- 3. geometry: the F-4E's two bodies ----
globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
const MOD = new Function(section("MODEL") + "\nreturn { grpParseFront, GRP_CLS, loadDynModelBytes, loadSkeletonBytes, buildDynModelGeometry, grpDecompress };")();
const BLK = new Function(section("ZSTD") + "\n" + section("BLK") + "\n" + section("VROMFS") + "\nreturn { loadGameResDesc, descGetModel, buildDescBind, zstdDec: Zstd.zstdDec, zstdDict: Zstd.zstdDict };")();
globalThis.Zstd = { zstdDec: BLK.zstdDec, zstdDict: BLK.zstdDict };   // the sections reach it as Zstd.* (ROADMAP 2.3)
installOodle(src);
function walkDesc(dir, out = [], depth = 0) {
  if (depth > 7) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) { if (/^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i.test(e.name)) continue; walkDesc(p, out, depth + 1); }
    else if (/Desc\.bin$/i.test(e.name)) out.push(p);
  }
  return out;
}
const descDbs = walkDesc(WT).map(p => BLK.loadGameResDesc(new Uint8Array(fs.readFileSync(p))));
const bindOf = m => { for (const db of descDbs) if (BLK.descGetModel(db, m)) return BLK.buildDescBind(db, m); return null; };
const stemsOf = b => { const s = new Set(); if (b) for (const e of new Set(b.map.values())) { if (e.c) s.add(e.c); } return s; };
async function load(model){
  const ref = grp.dyn.get(model);
  const bytes = new Uint8Array(fs.readFileSync(ref.p)).subarray(ref.e.offset, ref.e.offset + ref.e.size);
  const dm = await MOD.loadDynModelBytes(bytes, model);
  const sk = grp.skelRefs.get(model + "_skeleton");            // node transforms: without them the box is the bind pose's
  if (sk) dm.skeleton = MOD.loadSkeletonBytes(new Uint8Array(fs.readFileSync(sk.p)).subarray(sk.e.offset, sk.e.offset + sk.e.size));
  const geo = MOD.buildDynModelGeometry(dm, 0);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of geo.verts) for (let i = 0; i < 3; i++) { if (v[i] < mn[i]) mn[i] = v[i]; if (v[i] > mx[i]) mx[i] = v[i]; }
  return { geo, mn, mx, stems: stemsOf(bindOf(model)) };
}
const ext = await load("f_4e"), ck = await load("f_4e_cockpit");
const r2 = a => a.map(x => +x.toFixed(2));
const inside = seat.pos.every((x, i) => x > ext.mn[i] && x < ext.mx[i]);
const cx = (ext.mn[0] + ext.mx[0]) / 2;
R.is(inside && seat.pos[0] > cx + 2 && Math.abs(seat.pos[2]) < .05 && seat.pos[1] > 0,
  `the F-4E's seat (${r2(seat.pos).join(", ")}) is inside the model's box, ${(seat.pos[0] - cx).toFixed(1)} m forward of its centre, on the centreline, above the axis`);
R.is(ck.stems.has("f_4e_c") && [...ck.stems].filter(s => /cockpit/.test(s)).length >= 2,
  `the cockpit model binds the exterior's airframe sheet (f_4e_c) beside ${[...ck.stems].filter(s => /cockpit/.test(s)).length} sheets named for the cockpit`);
const same = ext.mn.every((v, i) => Math.abs(v - ck.mn[i]) < .05) && ext.mx.every((v, i) => Math.abs(v - ck.mx[i]) < .05);
R.is(same && ck.geo.verts.length > ext.geo.verts.length,
  `the two bodies span the same box (${r2(ext.mn).join(",")} … ${r2(ext.mx).join(",")}); the cockpit's ${ck.geo.verts.length.toLocaleString()} vertices against the exterior's ${ext.geo.verts.length.toLocaleString()}`);
R.finish();
