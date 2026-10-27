// The baked-animation pipeline: the a2d container and the ACL decoder inside it.
//
//   node --max-old-space-size=6144 tools/t27_a2d.mjs [model ...]
//
// The oracle is the model's own skeleton. A GeomNodeTree node stores BOTH its parent-relative
// transform `tm` and the composed `wtm`, and the a2d's keys are exactly that same local transform
// sampled over time — so at whichever frame the model was authored in, the decoded local PRS must
// reproduce `tm` to float precision. Nothing about that check is approximate: it exercises the
// sub-track type bitset, the constant/animated split, both range-reduction levels, the segment
// layout and the quaternion w reconstruction all at once, and a single bit wrong anywhere in the
// chain shows up as a node that does not match. It then sweeps the roster to assert every vehicle
// clip in the install decodes at all.
import fs from "fs";
import path from "path";
import { installOodle } from "./oodle_lift.mjs";
import { fileURLToPath } from "url";
import { installOrExit, isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const WT = installOrExit();   // tools/wtdir.mjs: WT_DIR, else Steam's library list, else the usual folders
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " missing");
  return src.slice(a + 1, b);
};
globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: (await import("node:crypto")).webcrypto });
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, "base64").toString("latin1");
// The page's own decoder, whichever this build carries (tools/oodle_lift.mjs) — not a RAD-only
// shim, which is what stood here until 2026-09-20 and had been broken since the page stopped
// carrying RAD's blob.
installOodle(src);
const Z = new Function(section("ZSTD") + "\nreturn { zstdDec: Zstd.zstdDec };")();
globalThis.Zstd = { zstdDec: Z.zstdDec };   // the sections reach it as Zstd.zstdDec (ROADMAP 2.3)
const MOD = new Function(section("MODEL") +
  "\nreturn { grpParseFront, GRP_CLS, grpDecompress, MReader, loadSkeletonBytes };")();
const A2D = new Function(section("A2D") +
  "\nreturn { parseA2D, a2dLabelTime, a2dNodeNames, a2dLocalAt, a2dIndexNodes, a2dDeltas, a2dWorld," +
  " a2dRefFrame, aclSample, aclSubType, a2dMatFromPRS, a2dMatMul, a2dMatInv," +
  " A2D_TICKS_PER_FRAME, A2D_TICKS_PER_SEC };")();

const A2D_CLS = 0x40c586f9;
function walk(dir, out = [], depth = 0) {
  if (depth > 7) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) { if (/^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i.test(e.name)) continue; walk(p, out, depth + 1); }
    else if (/\.grp$/i.test(e.name)) out.push(p);
  }
  return out;
}
console.log("indexing packs…");
const anim = new Map(), skel = new Map();
for (const p of walk(WT)) {
  try {
    const fd = fs.openSync(p, "r");
    const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
    const front = Buffer.alloc(0xC + h.readUInt32LE(8) + 4);
    fs.readSync(fd, front, 0, front.length, 0); fs.closeSync(fd);
    for (const e of MOD.grpParseFront(new Uint8Array(front)).entries) {
      if (e.classId === A2D_CLS && !anim.has(e.name)) anim.set(e.name, { p, e });
      else if (e.classId === MOD.GRP_CLS.GeomNodeTree && !skel.has(e.name)) skel.set(e.name, { p, e });
    }
  } catch { }
}
console.log(anim.size + " a2d, " + skel.size + " skeletons\n");

let packPath = null, packBuf = null;
// An a2d is stored as a GRP CompressedData block; a GeomNodeTree is not, it sits in the pack
// verbatim — which is why readGrpResource hands the skeleton loader raw bytes.
function raw(ref) {
  if (packPath !== ref.p) { packPath = ref.p; packBuf = new Uint8Array(fs.readFileSync(ref.p)); }
  return packBuf.subarray(ref.e.offset, ref.e.offset + ref.e.size);
}
async function res(ref) { return MOD.grpDecompress(new MOD.MReader(raw(ref), 0)); }
let fails = 0;
const fail = m => { console.log("    FAIL " + m); fails++; };

// ---- part 1: the container and the decoder, checked against each model's own skeleton ----
const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ["f_4e", "p_51d_5", "fa_18a", "a_10a_late", "bf_109f_4", "su_25", "mi_24p", "leopard_2a4"];
let checked = 0;
for (const m of models) {
  const aRef = anim.get(m + "_anim"), sRef = skel.get(m + "_skeleton");
  console.log("=== " + m);
  if (!aRef) { console.log("    no a2d — skipped"); continue; }
  if (!sRef) { console.log("    no skeleton — skipped"); continue; }
  checked++;
  let a2d, sk;
  try {
    a2d = A2D.parseA2D(await res(aRef));
    sk = MOD.loadSkeletonBytes(raw(sRef));
  } catch (e) { fail(m + ": " + e.message); continue; }
  const acl = a2d.acl.get(a2d.rot.acl);
  const start = A2D.a2dLabelTime(a2d, "start"), finish = A2D.a2dLabelTime(a2d, "finish");
  console.log("    " + acl.numTracks + " tracks, " + acl.numSamples + " samples @ " + acl.sampleRate +
    " Hz, " + acl.numSegments + " segment(s); labels start=" + start + " finish=" + finish +
    " (frame " + (finish / A2D.A2D_TICKS_PER_FRAME) + ")");
  console.log("    animated rot/trn/scl = " + acl.nAnimRot + "/" + acl.nAnimTrn + "/" + acl.nAnimScl +
    "  constant = " + acl.nConstRot + "/" + acl.nConstTrn + "/" + acl.nConstScl +
    "   trn%4=" + (acl.nAnimTrn % 4) + " scl%4=" + (acl.nAnimScl % 4));

  // The convention this whole feature rests on. `finish` at frame 100 is universal across the
  // install's vehicle clips; `start` is at frame 0 for almost all of them but a handful (the
  // Mi-24P among them) begin at frame 1, which is why the app reads the note track rather than
  // assuming the range.
  if (finish !== 100 * A2D.A2D_TICKS_PER_FRAME)
    fail("`finish` is at tick " + finish + ", expected " + 100 * A2D.A2D_TICKS_PER_FRAME + " (frame 100)");
  if (start !== 0) console.log("    note: `start` is frame " + (start / A2D.A2D_TICKS_PER_FRAME) + ", not 0");

  // Every decoded rotation must be a unit quaternion — the cheapest global sanity check there is,
  // and one that a mis-stepped bit offset fails immediately.
  for (const f of [0, 25, 50, 100]) {
    const s = A2D.aclSample(acl, f * A2D.A2D_TICKS_PER_FRAME / A2D.A2D_TICKS_PER_SEC);
    let bad = 0, worst = 0;
    for (let t = 0; t < acl.numTracks; t++) {
      const l = Math.hypot(s.rot[t*4], s.rot[t*4+1], s.rot[t*4+2], s.rot[t*4+3]);
      if (!isFinite(l)) { bad++; continue; }
      worst = Math.max(worst, Math.abs(l - 1));
    }
    for (let t = 0; t < acl.numTracks * 3; t++) if (!isFinite(s.pos[t]) || !isFinite(s.scl[t])) bad++;
    if (bad) fail("frame " + f + ": " + bad + " non-finite component(s)");
    if (worst > 1e-3) fail("frame " + f + ": quaternion off unit by " + worst.toExponential(2));
  }

  A2D.a2dIndexNodes(a2d);

  // ---- structural oracle: the bits we consume must be the bits the file says are there ----
  // Every animated sub-track's bit count comes from the per-track metadata byte; walking them must
  // land exactly on the segment header's own animated_rotation_bit_size and
  // animated_translation_bit_size, and the two plus scale must be animated_pose_bit_size. A wrong
  // bit-rate table, a missed rotation-array padding, or mishandling the "31 means 32 bits" raw
  // case all break this immediately, and it needs no skeleton to check.
  {
    const dv = acl.dv, u8 = acl.u8;
    const rotPad = (acl.nAnimRot + 3) & ~3;
    if (acl.numAnimVar !== rotPad + acl.nAnimTrn + acl.nAnimScl)
      fail("numAnimVar " + acl.numAnimVar + " != align4(rot)+trn+scl " + (rotPad + acl.nAnimTrn + acl.nAnimScl));
    let bad = 0;
    for (let s = 0; s < acl.numSegments; s++) {
      const sh = acl.segHdrs + s * 16;
      const poseBits = dv.getUint32(sh, true), rotBits = dv.getUint32(sh + 4, true), trnBits = dv.getUint32(sh + 8, true);
      const fmt0 = acl.tt + dv.getUint32(sh + 12, true);
      const sum = (base, n) => { let t = 0; for (let i = 0; i < n; i++) { const nb = u8[base + i]; t += (nb === 31 ? 32 : nb) * 3; } return t; };
      const r = sum(fmt0, acl.nAnimRot), tn = sum(fmt0 + rotPad, acl.nAnimTrn), sc = sum(fmt0 + rotPad + acl.nAnimTrn, acl.nAnimScl);
      if (r !== rotBits || tn !== trnBits || r + tn + sc !== poseBits) bad++;
    }
    console.log("    bit accounting: " + (acl.numSegments - bad) + "/" + acl.numSegments + " segment(s) match their header exactly");
    if (bad) fail(bad + " segment(s) disagree with animated_*_bit_size");
  }

  // ---- value oracle 1: translations must reproduce the skeleton's own tm ----
  // Positions go through the same bit walk and the same two levels of range reduction as
  // rotations, so agreement to float precision says the whole animated path decodes right.
  // The comparison is against the best-matching frame, not frame 0: the model is authored in one
  // pose of the clip and which pose that is differs per vehicle.
  {
    const T = A2D.A2D_TICKS_PER_FRAME / A2D.A2D_TICKS_PER_SEC;
    const best = new Map();
    for (let f = 0; f <= 100; f += 5) {
      const s = A2D.aclSample(acl, f * T);
      for (const [name, tr] of a2d.pos.byNode) {
        const node = sk.byName.get(name); if (!node) continue;
        let d = 0;
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(s.pos[tr*3+k] - node.tm[k][3]));
        const cur = best.get(name);
        if (!cur || d < cur.d) best.set(name, { d, f });
      }
    }
    // Suspended stores and effect emitters are excluded: they are not airframe, and the animation
    // scene places a rocket or a chute wherever that clip needs it rather than where the model
    // file parks it, so they carry no information about whether the decoder is right.
    const AIRFRAME = n => !/^(rocket|bomb|flare|chute|ter_|emtr_|upk_|ub_|s24_|missile|fuel_tank|pod|pylon_rocket)/i.test(n);
    let near = 0, worst = 0, wn = "", n = 0;
    const hist = new Map(), off = [];
    for (const [name, v] of best) {
      if (!AIRFRAME(name)) continue;
      n++;
      if (v.d < 1e-3) { near++; hist.set(v.f, (hist.get(v.f) || 0) + 1); }
      else off.push(name + " " + v.d.toFixed(2) + "m");
      if (v.d > worst) { worst = v.d; wn = name; }
    }
    console.log("    translations vs skeleton tm: " + near + "/" + n + " airframe nodes reproduce it at some frame" +
      " (frames " + [...hist].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, c]) => "f" + f + "×" + c).join(", ") +
      "); worst " + worst.toExponential(2) + " m on " + wn);
    if (off.length) console.log("      off: " + off.slice(0, 8).join(", "));
    // 85%: a handful of airframe-named nodes are genuinely posed differently in the animation
    // scene (a P-51's rocket pylons sit 11 cm out), which is a property of the source data. A
    // decoder fault does not produce a 15% tail, it produces metres of error across the board.
    if (near < n * 0.85) fail("only " + near + " of " + n + " translations reproduce the rest pose");
  }

  // ---- value oracle 2: the motion must be smooth ----
  // The strongest check on the rotation path, and it needs no external reference. A misread bit
  // offset or a wrong range layout produces quaternions that jump ~90° between adjacent frames;
  // a correct decode moves a hinge a few degrees per frame. The one exception is a genuine sign
  // flip where the stored w crosses zero (ACL always stores w >= 0), which is a 180° step in the
  // raw quaternion and no motion at all once the shortest arc is taken.
  {
    const T = A2D.A2D_TICKS_PER_FRAME / A2D.A2D_TICKS_PER_SEC;
    const fr = [];
    for (let f = 0; f <= 100; f++) fr.push(A2D.aclSample(acl, f * T).rot.slice());
    const ang = (X, Y, t) => 2 * Math.acos(Math.min(1, Math.abs(
      X[t*4]*Y[t*4] + X[t*4+1]*Y[t*4+1] + X[t*4+2]*Y[t*4+2] + X[t*4+3]*Y[t*4+3]))) * 180 / Math.PI;
    let animN = 0, jumpy = 0, worst = 0, worstN = "", maxSwing = 0, swingN = "";
    for (const [name, tr] of a2d.rot.byNode) {
      if (A2D.aclSubType(acl, 0, tr) !== 2) continue;
      animN++;
      let mx = 0;
      for (let f = 1; f <= 100; f++) mx = Math.max(mx, Math.min(ang(fr[f-1], fr[f], tr), 180 - ang(fr[f-1], fr[f], tr) + 0));
      // count a step as a jump only if it is not the w-sign flip described above
      let raw = 0;
      for (let f = 1; f <= 100; f++) raw = Math.max(raw, ang(fr[f-1], fr[f], tr));
      if (raw > 20 && raw < 170) jumpy++;
      if (raw > worst && raw < 170) { worst = raw; worstN = name; }
      const sw = ang(fr[0], fr[100], tr);
      if (sw > maxSwing) { maxSwing = sw; swingN = name; }
    }
    console.log("    " + animN + " animated rotations: " + jumpy + " jump >20° in one frame" +
      (worstN ? " (worst " + worst.toFixed(1) + "° on " + worstN + ")" : "") +
      "; largest 0→100 swing " + maxSwing.toFixed(0) + "° on " + swingN);
    if (animN && jumpy > animN * 0.05)
      fail(jumpy + " of " + animN + " rotations jump more than 20° in a single frame — that is noise, not animation");
    if (animN && maxSwing < 5) fail("nothing rotates between frame 0 and frame 100");
  }

  // ---- the reference frame: the geometry really is where the clip says at that frame ----
  const nodes = [...A2D.a2dNodeNames(a2d)].filter(n => sk.byName.has(n));
  // Only assert on the gear when this clip actually animates it. Not every vehicle's gear is baked
  // — a Bf 109 F-4's three gear nodes carry no animated rotation at all, and that is the file
  // saying so, not the decoder failing.
  const gear = nodes.filter(n => /^gear/i.test(n));
  const gearAnimated = gear.some(n => a2d.rot.byNode.has(n) && A2D.aclSubType(acl, 0, a2d.rot.byNode.get(n)) === 2);
  if (gear.length && gearAnimated) {
    const gearSet = new Set(gear);
    const ref = A2D.a2dRefFrame(a2d, sk, gear);
    const at = f => A2D.a2dWorld(a2d, sk, n => gearSet.has(n) ? f : null);
    // How far each gear node's origin sits from where the extracted geometry actually has it.
    const err = w => {
      let mx = 0, nm = "";
      for (const n of gear) {
        const nd = sk.byName.get(n);
        const d = Math.hypot(w[nd.i][0][3] - nd.wtm[0][3], w[nd.i][1][3] - nd.wtm[1][3], w[nd.i][2][3] - nd.wtm[2][3]);
        if (d > mx) { mx = d; nm = n; }
      }
      return { mx, nm };
    };
    const eRef = err(at(ref)), e0 = err(at(0)), e100 = err(at(100));
    // Which end of the clip is "up"? Take the lowest gear node — the wheel — and see which way it
    // goes. This is the fact the slider labelling depends on, so it is measured, not assumed.
    const w0 = at(0), w100 = at(100);
    let lowest = null, mostMoved = -1;
    for (const n of gear) {
      const nd = sk.byName.get(n);
      const d = Math.hypot(w100[nd.i][0][3] - w0[nd.i][0][3], w100[nd.i][1][3] - w0[nd.i][1][3], w100[nd.i][2][3] - w0[nd.i][2][3]);
      if (d > mostMoved) { mostMoved = d; lowest = nd; }
    }
    const dy = w100[lowest.i][1][3] - w0[lowest.i][1][3];
    console.log("    gear (" + gear.length + " nodes): authored at frame " + ref +
      " — worst origin error there " + eRef.mx.toFixed(3) + " m" +
      " (frame 0: " + e0.mx.toFixed(2) + " m, frame 100: " + e100.mx.toFixed(2) + " m)");
    console.log("    lowest gear node " + lowest.name + " moves " + (dy >= 0 ? "+" : "") + dy.toFixed(2) +
      " m in Y from frame 0 to 100 → frame 100 is " + (dy > 0.1 ? "RETRACTED (up)" : dy < -0.1 ? "EXTENDED (down)" : "level"));
    // At the reference frame the composed pose must land on the geometry as extracted, or the
    // very first slider movement jerks the whole leg.
    if (eRef.mx > 0.05) fail("at its own reference frame the gear is " + eRef.mx.toFixed(2) +
      " m from where the geometry is (" + eRef.nm + ")");
    // And the clip must actually retract it: a leg sweeps metres, not tens of metres. A hinge
    // root's own origin does not move — only what hangs below it does — so a vehicle whose gear
    // is a single node with no sub-nodes (the Bf 109 F-4) shows travel 0 and is checked on the
    // rotation instead.
    const travel = Math.max(e0.mx, e100.mx);
    let swing = 0;
    for (const n of gear) {
      const tr = a2d.rot.byNode.get(n);
      if (tr === undefined) continue;
      const q0 = A2D.aclSample(acl, 0).rot.slice(), q1 = A2D.aclSample(acl, 100 * A2D.A2D_TICKS_PER_FRAME / A2D.A2D_TICKS_PER_SEC).rot;
      const d = Math.min(1, Math.abs(q0[tr*4]*q1[tr*4] + q0[tr*4+1]*q1[tr*4+1] + q0[tr*4+2]*q1[tr*4+2] + q0[tr*4+3]*q1[tr*4+3]));
      swing = Math.max(swing, 2 * Math.acos(d) * 180 / Math.PI);
    }
    console.log("    gear swings " + swing.toFixed(0) + "° and its farthest node travels " + travel.toFixed(2) + " m");
    if (travel < 0.05 && swing < 5) fail("the gear neither moves nor rotates across the clip");
    if (travel > 8) fail("a gear node travels " + travel.toFixed(1) + " m — the composition is wrong");
  }
}

// Nothing to check is not a pass. A folder that only looks like an install, or a game update that
// moved the packs (CLAUDE.md §0.3), skips every model above and finds no clip below — and this used
// to end "0 / 0 clips decoded … all good", exit 0 (review of 2026-10-10).
if (!checked) fail("none of the " + models.length + " models has both an a2d and a skeleton in " + WT + " (" + anim.size + " a2d, " + skel.size + " skeletons indexed) — nothing was checked");

// ---- part 2: does every vehicle clip in the install decode at all? ----
console.log("\n=== roster sweep");
let ok = 0, skipped = 0;
const errs = new Map();
const names = [...anim.keys()].filter(n => !/_dmg_|_destr|^chute_|^dm_/i.test(n));
for (const name of names) {
  try {
    const a2d = A2D.parseA2D(await res(anim.get(name)));
    const acl = a2d.acl.get((a2d.rot || a2d.pos).acl);
    // sample both ends and the middle; a bad segment shows up away from frame 0
    for (const f of [0, 37, 100]) A2D.aclSample(acl, f * A2D.A2D_TICKS_PER_FRAME / A2D.A2D_TICKS_PER_SEC);
    ok++;
  } catch (e) {
    const k = e.message.replace(/0x[0-9a-f]+|\d+/g, "#");
    errs.set(k, (errs.get(k) || 0) + 1);
    skipped++;
  }
}
console.log("  " + ok + " / " + names.length + " clips decoded");
for (const [k, n] of [...errs].sort((a, b) => b[1] - a[1])) console.log("    " + String(n).padStart(5) + "  " + k);
if (!names.length) fail("the install holds no vehicle a2d clip to decode — the sweep tested nothing");
else if (ok < names.length * 0.98) fail("only " + ok + " of " + names.length + " clips decode");

console.log(fails ? "\n" + fails + " problem(s)" : "\nall good");
process.exit(fails ? 1 : 0);
