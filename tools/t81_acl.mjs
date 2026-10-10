// One ACL key frame, decoded (ROADMAP 2.4's oracle for `aclKeyframe`).
//
// WHY THIS EXISTS, AND WHY IT IS NOT A GOLDEN. `aclKeyframe` is 117 lines and the last thing on
// 2.4's list, and the item recorded it as blocked: it needs an install-free oracle, and §0.5 rules
// out storing a slice of a game clip to compare against. That framing was too narrow. The function
// does not take a file — it takes a DESCRIPTOR (`a`, with every offset and count on it) and a byte
// buffer, both of which a test can lay out itself. So this builds ACL buffers by hand, one per
// branch, with the answer worked out in arithmetic:
//
//   * a CONSTANT rotation, read from the SOA constant pool in groups of four (xxxx, yyyy, zzzz);
//   * an ANIMATED rotation packed at n bits per component, expanded through the segment range and
//     then the clip range, with **w rebuilt from the other three** (quatf_drop_w) and taken
//     positive, and the whole quaternion renormalised — the sqrt near identity is inexact;
//   * a SEGMENT-CONSTANT rotation (n = 0), whose sample is packed into the range bytes themselves,
//     16 bits per component split across the min and extent halves;
//   * a RAW rotation (n = 31), three float32s straight out of the stream, with neither range
//     applied;
//   * the same four for translations and scales, whose range data is AOS rather than SOA;
//   * a track with no scale at all takes the clip's default scale;
//   * the bit walk is shared: rotations, then translations, then scales, each starting where the
//     segment header says, so a mis-sized rotation block would move the translation's bits too.
//
// The layouts are the engine's own (`transform_tracks_header::get_segment_data`) and are documented
// in the decoder; nothing here comes out of a game file.
//
// Usage: node tools/t81_acl.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const A2D = new Function(sectionOf("A2D").replace(/^"use strict";$/m, "") +
  "\nreturn { aclKeyframe, aclBitsBE, aclSubType, ACL_RAW_BITS };")();

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };
const is = (c, m) => c ? ok(m) : bad(m);
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-4 : eps);

// ---- a buffer builder ----
// One track, one segment, no scale unless asked. Everything is laid out where the decoder looks for
// it, which is what makes this a test of the decoder rather than of a fixture.
function build({ rotType = 2, trnType = 0, sclType = 0, rotBitsN = 8, trnBitsN = 8,
                 rotRaw = null, trnRaw = null, constRot = null, constTrn = null,
                 rotSample = [0, 0, 0], trnSample = [0, 0, 0],
                 segRot = null, segTrn = null,
                 clipRot = [0, 0, 0, 1, 1, 1], clipTrn = [0, 0, 0, 1, 1, 1],
                 multiSeg = false, hasScale = false, defaultScale = 1 } = {}) {
  const buf = new ArrayBuffer(4096);
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // --- sub-type words: 2 bits per track per kind, packed from the top of a u32
  const subTypes = 16;
  const setType = (kind, track, ty) => {
    const off = subTypes + (kind * 1 + (track >> 4)) * 4;       // entries = 1
    const w = dv.getUint32(off, true);
    dv.setUint32(off, (w | (ty << (30 - 2 * (track & 15)))) >>> 0, true);
  };
  setType(0, 0, rotType); setType(1, 0, trnType); setType(2, 0, sclType);
  const nAnimRot = rotType === 2 ? 1 : 0, nConstRot = rotType === 1 ? 1 : 0;
  const nAnimTrn = trnType === 2 ? 1 : 0, nConstTrn = trnType === 1 ? 1 : 0;
  const nAnimScl = sclType === 2 ? 1 : 0, nConstScl = sclType === 1 ? 1 : 0;
  // --- constant pool: rotations SOA in groups of four, then translations and scales AOS
  const constData = 64;
  if (constRot) {                                              // group of one: gs = 1
    dv.setFloat32(constData, constRot[0], true);
    dv.setFloat32(constData + 4, constRot[1], true);
    dv.setFloat32(constData + 8, constRot[2], true);
  }
  const constTrnBase = constData + nConstRot * 12;
  if (constTrn) {
    dv.setFloat32(constTrnBase, constTrn[0], true);
    dv.setFloat32(constTrnBase + 4, constTrn[1], true);
    dv.setFloat32(constTrnBase + 8, constTrn[2], true);
  }
  // --- clip ranges: rotations SOA (min xyz then extent xyz, gs floats each), vectors AOS
  const clipRange = 256;
  if (nAnimRot) {
    const gs = 1;
    dv.setFloat32(clipRange, clipRot[0], true);
    dv.setFloat32(clipRange + gs * 4, clipRot[1], true);
    dv.setFloat32(clipRange + gs * 8, clipRot[2], true);
    dv.setFloat32(clipRange + gs * 12, clipRot[3], true);
    dv.setFloat32(clipRange + gs * 16, clipRot[4], true);
    dv.setFloat32(clipRange + gs * 20, clipRot[5], true);
  }
  const clipTrnBase = clipRange + nAnimRot * 24;
  if (nAnimTrn) for (let i = 0; i < 6; i++) dv.setFloat32(clipTrnBase + i * 4, clipTrn[i], true);
  // --- the segment: header at segHdrs, data at tt + offset
  const segHdrs = 512, tt = 1024, segStarts = 900;
  const rotBits = nAnimRot ? (rotRaw ? 96 : (rotBitsN === 0 ? 0 : rotBitsN * 3)) : 0;
  const trnBits = nAnimTrn ? (trnRaw ? 96 : (trnBitsN === 0 ? 0 : trnBitsN * 3)) : 0;
  dv.setUint32(segHdrs, rotBits + trnBits, true);              // poseBits
  dv.setUint32(segHdrs + 4, rotBits, true);
  dv.setUint32(segHdrs + 8, trnBits, true);
  dv.setUint32(segHdrs + 12, 0, true);                          // segData = tt + 0
  dv.setUint32(segStarts, 0, true);
  // --- segment data: format bytes, then ranges, then the animated bit stream
  const numAnimVar = nAnimRot + nAnimTrn + nAnimScl;
  const segData = tt;
  const fmt0 = segData;
  const rng0 = (fmt0 + numAnimVar + 1) & ~1;
  const anim0 = (rng0 + (multiSeg ? 6 * numAnimVar : 0) + 3) & ~3;
  const rotPad = (nAnimRot + 3) & ~3;
  const fmtRot = fmt0, fmtTrn = fmtRot + rotPad;
  if (nAnimRot) u8[fmtRot] = rotRaw ? 31 : rotBitsN;
  if (nAnimTrn) u8[fmtTrn] = trnRaw ? 31 : trnBitsN;
  const rngRot = rng0, rngTrn = rngRot + (multiSeg ? rotPad * 6 : 0);
  if (segRot) for (let k = 0; k < 6; k++) u8[rngRot + k * 4] = segRot[k];   // SOA, lane 0 of a group of four
  if (segTrn) for (let k = 0; k < 6; k++) u8[rngTrn + k] = segTrn[k];       // AOS
  // …and the packed samples
  let bit = anim0 * 8;
  const putBE = (v, n) => {                                     // n bits, MSB first
    for (let k = n - 1; k >= 0; k--) {
      const b = (v >>> k) & 1;
      if (b) u8[bit >> 3] |= 0x80 >> (bit & 7);
      bit++;
    }
  };
  const putF32 = f => { const t = new DataView(new ArrayBuffer(4)); t.setFloat32(0, f, true); putBE(t.getUint32(0, true), 32); };
  if (nAnimRot) {
    if (rotRaw) rotRaw.forEach(putF32);
    else if (rotBitsN > 0) { const d = (1 << rotBitsN) - 1; rotSample.forEach(v => putBE(Math.round(v * d), rotBitsN)); }
  }
  if (nAnimTrn) {
    if (trnRaw) trnRaw.forEach(putF32);
    else if (trnBitsN > 0) { const d = (1 << trnBitsN) - 1; trnSample.forEach(v => putBE(Math.round(v * d), trnBitsN)); }
  }
  const a = { dv, u8, tt, segHdrs, segStarts, subTypes, entries: 1, multiSeg, numSegments: 1,
              numTracks: 1, numAnimVar, nAnimRot, nAnimTrn, nAnimScl, nConstRot, nConstTrn, nConstScl,
              clipRange, constData, hasScale, defaultScale };
  const dst = { rot: new Float32Array(4), pos: new Float32Array(3), scl: new Float32Array(3) };
  return { a, dst };
}
const decode = opts => { const { a, dst } = build(opts); return A2D.aclKeyframe(a, 0, dst); };

// ---- the bit reader, which everything else stands on ----
{
  const u8 = new Uint8Array([0b10110011, 0b01010101, 0xff, 0x00, 0xaa]);
  is(A2D.aclBitsBE(u8, 0, 4) === 0b1011, "the bit reader takes the top bits of a byte, MSB first");
  is(A2D.aclBitsBE(u8, 4, 8) === 0b00110101, `…and straddles a byte boundary (${A2D.aclBitsBE(u8, 4, 8).toString(2)})`);
  is(A2D.aclBitsBE(u8, 0, 32) === 0b10110011010101011111111100000000 >>> 0, "…and reads a full 32 bits unsigned");
  is(A2D.aclBitsBE(new Uint8Array([0xff]), 0, 8) === 255 && A2D.aclBitsBE(new Uint8Array([0xff]), 8, 8) === 0,
    "…and reads past the end as zero, which is what lets the last sample skip a bounds check");
}
// ---- a constant rotation ----
{
  const r = decode({ rotType: 1, constRot: [0, 0, .5] });
  is(near(r.rot[2], .5) && near(r.rot[0], 0), `a constant rotation comes out of the constant pool (${[...r.rot].map(v => v.toFixed(3))})`);
  is(near(r.rot[3], Math.sqrt(1 - .25)), `…with w rebuilt from the other three (${r.rot[3].toFixed(4)} = √0.75)`);
  is(near(Math.hypot(...r.rot), 1), "…and the quaternion normalised");
}
// ---- an animated rotation, packed, through both ranges ----
{
  // 8 bits, sample = 1.0 → 255/255 = 1; clip range min 0.1, extent 0.4 → 0.5
  const r = decode({ rotType: 2, rotBitsN: 8, rotSample: [1, 0, 0], clipRot: [.1, 0, 0, .4, 0, 0] });
  is(near(r.rot[0], .5), `a packed rotation is expanded through the clip range (${r.rot[0].toFixed(4)} = 0.1 + 1 × 0.4)`);
  const half = decode({ rotType: 2, rotBitsN: 8, rotSample: [0, 0, 0], clipRot: [.25, 0, 0, .5, 0, 0] });
  is(near(half.rot[0], .25), `…and a zero sample is the range's minimum (${half.rot[0].toFixed(4)})`);
  // with a segment range as well: 0.5 of (min 51/255=0.2, extent 102/255=0.4) = 0.4, then clip
  const seg = decode({ multiSeg: true, rotType: 2, rotBitsN: 8, rotSample: [.5, 0, 0],
                       segRot: [51, 0, 0, 102, 0, 0], clipRot: [0, 0, 0, 1, 1, 1] });
  is(near(seg.rot[0], .2 + .5019 * .4, 3e-3), `…and through the segment range first when there is one (${seg.rot[0].toFixed(4)})`);
}
// ---- a rotation that is constant within its segment (n = 0) ----
{
  // the sample lives in the range bytes: hi at s, lo at s+4 → (0x80 << 8 | 0x00) / 65535
  const r = decode({ multiSeg: true, rotType: 2, rotBitsN: 0, segRot: [0x80, 0, 0, 0, 0, 0],
                     clipRot: [0, 0, 0, 1, 1, 1] });
  is(near(r.rot[0], 0x8000 / 65535, 1e-4), `a segment-constant rotation is packed into the range bytes themselves (${r.rot[0].toFixed(4)})`);
}
// ---- a raw rotation: neither range applied ----
{
  const r = decode({ rotType: 2, rotRaw: [.25, -.5, .125], clipRot: [9, 9, 9, 9, 9, 9] });
  is(near(r.rot[0], .25) && near(r.rot[1], -.5) && near(r.rot[2], .125),
    `a raw rotation is three float32s straight out of the stream, with no range applied (${[...r.rot].slice(0, 3).map(v => v.toFixed(3))})`);
}
// ---- translations ----
{
  const c = decode({ trnType: 1, constTrn: [1, -2, 3.5] });
  is(near(c.pos[0], 1) && near(c.pos[1], -2) && near(c.pos[2], 3.5),
    `a constant translation comes out of the pool, AOS (${[...c.pos].map(v => v.toFixed(2))})`);
  const p = decode({ trnType: 2, trnBitsN: 8, trnSample: [1, 0, .5], clipTrn: [1, 2, 3, 10, 20, 30] });
  is(near(p.pos[0], 11) && near(p.pos[1], 2) && near(p.pos[2], 3 + .5019 * 30, .1),
    `a packed translation is expanded through its own clip range (${[...p.pos].map(v => v.toFixed(2))})`);
  const s = decode({ multiSeg: true, trnType: 2, trnBitsN: 8, trnSample: [1, 0, 0],
                     segTrn: [51, 0, 0, 102, 0, 0], clipTrn: [0, 0, 0, 1, 1, 1] });
  is(near(s.pos[0], .2 + .4, 3e-3), `…and through the segment range when there is one (${s.pos[0].toFixed(4)})`);
  const z = decode({ multiSeg: true, trnType: 2, trnBitsN: 0, segTrn: [0, 0, 0, 0, 0, 0], clipTrn: [0, 0, 0, 1, 1, 1] });
  is(near(z.pos[0], 0), "a segment-constant translation reads its sample from the range bytes, u16 LE");
  const raw = decode({ trnType: 2, trnRaw: [7.5, -8.25, 0.5], clipTrn: [9, 9, 9, 9, 9, 9] });
  is(near(raw.pos[0], 7.5) && near(raw.pos[1], -8.25), `a raw translation ignores both ranges (${[...raw.pos].map(v => v.toFixed(2))})`);
}
// ---- scale, and the default ----
{
  const noScale = decode({ hasScale: false, defaultScale: 1 });
  is(noScale.scl[0] === 1 && noScale.scl[1] === 1 && noScale.scl[2] === 1,
    "a clip with no scale gives every track the default scale of 1");
  const zeroDef = decode({ hasScale: false, defaultScale: 0 });
  is(zeroDef.scl[0] === 0, "…and 0 when the clip says so");
}
// ---- the bit walk: translations start after the rotations, by the segment header's own count ----
{
  // 8-bit rotation (24 bits) then an 8-bit translation: if the translation read from bit 0 it would
  // decode the rotation's bytes instead
  const r = decode({ rotType: 2, rotBitsN: 8, rotSample: [1, 1, 1],
                     trnType: 2, trnBitsN: 8, trnSample: [0, 0, 0],
                     clipRot: [0, 0, 0, 1, 1, 1], clipTrn: [0, 0, 0, 1, 1, 1] });
  is(near(r.rot[0], 1 / Math.sqrt(3), 1e-3), `the rotation reads its own three components (${r.rot[0].toFixed(4)})`);
  is(near(r.pos[0], 0) && near(r.pos[1], 0) && near(r.pos[2], 0),
    `…and the translation starts where the segment header says the rotations end (${[...r.pos].map(v => v.toFixed(3))})`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
