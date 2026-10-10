"use strict";
/*==A2D==*/
// ---------- Baked animation: `<model>_anim` (a2d) ----------
// The game ships a baked clip beside every vehicle model — 5 310 of them in the install, resource
// class 0x40C586F9, named `<model>_anim`. It is what turns "the app guesses a hinge axis from the
// shape of the part" into "the app moves the part exactly the way the game does": an F-4E's clip
// carries 756 tracks, including all seventeen sub-nodes of each main gear leg, both nozzles'
// 34 petals, eight slat segments a side and the swing-wing nodes — none of which is inferable.
//
// The convention, read off the note track of all 5 310 and identical in every vehicle clip:
// **frame 0 = retracted/closed, frame 100 = extended/open**, labelled `start` and `finish`.
// `finish` is at tick 51 200, and AnimV20::TIME_TicksPerSec is 60<<8 = 15 360 (dag_animChannels.h),
// so 51 200 ticks is 3⅓ s — exactly 100 frames at the 30 fps the exporter bakes at. The ACL header
// agrees independently: 101 samples at a 30 Hz sample rate.
//
// Two layers, both verified against the public Dagor engine source rather than reverse-engineered:
//
//   the a2d container   prog/dagorInclude/anim/dag_animChannels.h — an `ANIM` header, a pointer-
//                       patched dump, then a DumpData of four PatchableTabs: point3 channels
//                       (position, scale), quat channels (rotation), real channels, note track.
//   the samples         an ACL (Animation Compression Library) `compressed_tracks` blob, tag
//                       0xAC11AC11. Dagor vendors ACL and typedefs AnimChan straight to it.
//
// Every one of the 4 469 clips that decode uses the same ACL configuration, which is why the
// decoder below covers that one configuration exactly and refuses anything else rather than
// half-reading it: v10 (ACL 2.1), track type qvvf, rotations `quatf_drop_w_variable`, translations
// and scales `vector3f_variable`, no streaming database, no stripped key frames, no wrap
// optimisation, trivial default values. Segment counts run 1…81 and sample counts to 1 301.
const A2D_TICKS_PER_SEC = 60 << 8;                  // AnimV20::TIME_TicksPerSec
const A2D_FPS = 30;                                 // what dag2anim bakes at
const A2D_TICKS_PER_FRAME = A2D_TICKS_PER_SEC / A2D_FPS;   // 512
// AnimV20's channel ids. Note ROTATION is 5, not 3 — the enum has the two origin-velocity
// channels in between, and assuming otherwise silently reads scale as rotation.
const A2D_CHTYPE = { POSITION: 1, SCALE: 2, ORIGIN_LINVEL: 3, ORIGIN_ANGVEL: 4, ROTATION: 5 };

// ---- the a2d container ----
function parseA2D(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x4d494e41) throw new Error("not an a2d: no ANIM label");
  const ver = dv.getUint32(4, true);
  if (ver !== 0x300 && ver !== 0x301) throw new Error("unsupported a2d version 0x" + ver.toString(16));
  const base = dv.getUint32(8, true);               // = sizeof(AnimDataHeader); the dump starts here
  const dumpSize = dv.getUint32(12, true);          // and every offset below is relative to it
  const dd = base + dumpSize;                       // DumpData is written after the dump
  const str = o => { let s = ""; while (u8[o]) s += String.fromCharCode(u8[o++]); return s; };
  // PatchableTab does NOT store an 8-byte pointer followed by a count. On a 64-bit dump it packs
  // the count into the HIGH 32 bits of the pointer field — dag_patchTab.h patches it as
  // `dcnt = intptr_t(dptr) >> 32; dptr = (dptr & 0xFFFFFFFF) + base`. Reading it as ptr+count
  // yields a garbage pointer and a zero count, i.e. an a2d that looks empty rather than one that
  // fails, which is exactly the kind of bug that gets shipped.
  const tab = i => ({ ptr: dv.getUint32(dd + i * 16, true), n: dv.getUint32(dd + i * 16 + 4, true) });
  const chans = t => {
    const out = [];
    for (let i = 0; i < t.n; i++) {
      const o = base + t.ptr + i * 40;              // sizeof(AnimDataChan)
      const trackP = dv.getUint32(o + 8, true), wtP = dv.getUint32(o + 24, true), nameP = dv.getUint32(o + 32, true);
      const c = { acl: dv.getUint32(o, true), channelType: dv.getUint32(o + 20, true),
                  nodeNum: dv.getUint32(o + 16, true), nodes: [] };
      for (let j = 0; j < c.nodeNum; j++)
        c.nodes.push({ name: str(base + dv.getUint32(base + nameP + j * 8, true)),
                       track: dv.getUint16(base + trackP + j * 2, true),   // dag::Index16, 0xFFFF = none
                       wt: dv.getFloat32(base + wtP + j * 4, true) });
      out.push(c);
    }
    return out;
  };
  const nt = tab(3), labels = [];
  for (let i = 0; i < nt.n; i++) {
    const o = base + nt.ptr + i * 16;               // sizeof(AnimKeyLabel)
    labels.push({ name: str(base + dv.getUint32(o, true)), time: dv.getInt32(o + 8, true) });
  }
  const a2d = { ver, base, u8, dv, additive: ver === 0x301, labels,
                point3: chans(tab(0)), quat: chans(tab(1)), real: chans(tab(2)), acl: new Map() };
  // Each channel names the ACL blob it samples. Position, scale and rotation always share one
  // (the engine refuses the file otherwise); the origin-velocity channels carry their own.
  const chan = t => a2d.point3.find(c => c.channelType === t) || a2d.quat.find(c => c.channelType === t) || null;
  a2d.pos = chan(A2D_CHTYPE.POSITION);
  a2d.scl = chan(A2D_CHTYPE.SCALE);
  a2d.rot = chan(A2D_CHTYPE.ROTATION);
  for (const c of [a2d.pos, a2d.scl, a2d.rot])
    if (c && !a2d.acl.has(c.acl)) a2d.acl.set(c.acl, aclOpen(u8, base + c.acl));
  return a2d;
}
// Note-track time, in ticks. -1 when the clip has no such label.
function a2dLabelTime(a2d, name){
  const l = a2d.labels.find(x => x.name.toLowerCase() === String(name).toLowerCase());
  return l ? l.time : -1;
}
// Every node the clip animates at all, whichever channel names it.
function a2dNodeNames(a2d){
  const s = new Set();
  for (const c of [a2d.pos, a2d.scl, a2d.rot]) if (c) for (const n of c.nodes) s.add(n.name);
  return s;
}

// ---- ACL compressed_tracks ----
const ACL_TAG = 0xac11ac11;
// The per-track metadata byte holds the NUMBER OF BITS per component, not a bit-rate index.
// 0 means "constant within this segment" (the value lives in the segment range data) and 31 means
// "raw" — three float32s, which occupy 32 bits each even though the byte says 31. That last
// asymmetry is version-dependent (ACL ≥ v02_01_99_1) and is worth exactly one off-by-one bug.
const ACL_RAW_BITS = 31;
function aclOpen(u8, off){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const th = off + 8;                               // tracks_header, after raw_buffer_header{size,hash}
  if (dv.getUint32(th, true) !== ACL_TAG) throw new Error("not an ACL compressed_tracks buffer");
  const version = dv.getUint16(th + 4, true), trackType = u8[th + 7];
  if (version !== 10) throw new Error("ACL version " + version + " — the game ships v10 (ACL 2.1)");
  if (trackType !== 12) throw new Error("ACL track type " + trackType + " is not qvvf");
  const misc = dv.getUint32(th + 20, true);
  const a = { dv, u8, version,
    numTracks: dv.getUint32(th + 8, true), numSamples: dv.getUint32(th + 12, true),
    sampleRate: dv.getFloat32(th + 16, true),
    hasScale: !!(misc & 1), defaultScale: (misc >> 1) & 1,
    sclFmt: (misc >> 2) & 1, trnFmt: (misc >> 3) & 1, rotFmt: (misc >> 4) & 15 };
  if (misc & (1 << 8)) throw new Error("ACL clip needs a streaming database");
  if (misc & (1 << 10)) throw new Error("ACL clip has stripped key frames");
  if (!(misc & (1 << 9))) throw new Error("ACL clip has non-trivial default values");
  if (a.rotFmt !== 3 || a.trnFmt !== 1 || (a.hasScale && a.sclFmt !== 1))
    throw new Error("ACL formats rot=" + a.rotFmt + " trn=" + a.trnFmt + " scl=" + a.sclFmt + " are not the shipped ones");
  const tt = th + 24;                               // transform_tracks_header
  a.tt = tt;
  a.numSegments  = dv.getUint32(tt, true);
  a.numAnimVar   = dv.getUint32(tt + 4, true);
  a.nAnimRot     = dv.getUint32(tt + 8, true);
  a.nAnimTrn     = dv.getUint32(tt + 12, true);
  a.nAnimScl     = dv.getUint32(tt + 16, true);
  a.nConstRot    = dv.getUint32(tt + 20, true);
  a.nConstTrn    = dv.getUint32(tt + 24, true);
  a.nConstScl    = dv.getUint32(tt + 28, true);
  a.segHdrs      = tt + dv.getUint32(tt + 36, true);
  a.subTypes     = tt + dv.getUint32(tt + 40, true);
  a.constData    = tt + dv.getUint32(tt + 44, true);
  a.clipRange    = tt + dv.getUint32(tt + 48, true);
  a.segStarts    = tt + 52;                         // align_to(sizeof(transform_tracks_header), 4)
  a.multiSeg     = a.numSegments > 1;
  a.entries      = (a.numTracks + 15) >> 4;         // sub-track types, 16 per uint32
  a.duration     = a.numSamples > 1 ? (a.numSamples - 1) / a.sampleRate : 0;
  return a;
}
// Sub-track kind: 0 = default (identity/zero/one), 1 = constant, 2 = animated. Two bits per
// sub-track, most-significant pair first, 16 to a uint32; rotations then translations then scales,
// each a full array of `entries` words.
function aclSubType(a, kind, track){
  const w = a.dv.getUint32(a.subTypes + (kind * a.entries + (track >> 4)) * 4, true);
  return (w >>> (30 - 2 * (track & 15))) & 3;
}
// ACL packs animated samples big-endian and unaligned, so a value straddles bytes. Reads the 32
// bits starting at `bit` and returns the top `n` of them. Out-of-range byte reads coerce to 0,
// which is what lets the last sample in a buffer be read without a bounds branch in the hot loop.
function aclBitsBE(u8, bit, n){
  const i = bit >> 3, s = bit & 7;
  let v = ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
  if (s) v = (((v << s) >>> 0) | (u8[i + 4] >>> (8 - s))) >>> 0;
  return n === 32 ? v : (v >>> (32 - n));
}
const aclF32 = (() => {
  const b = new DataView(new ArrayBuffer(4));
  return u => { b.setUint32(0, u >>> 0, true); return b.getFloat32(0, true); };
})();
// Scratch is allocated once per clip, not per sample: a 756-track pose is decoded on every slider
// move and per-call allocation would churn megabytes (see the allocation rule in CLAUDE.md §3).
function aclScratch(a){
  if (a._s) return a._s;
  const n = a.numTracks;
  const mk = () => ({ rot: new Float32Array(n * 4), pos: new Float32Array(n * 3), scl: new Float32Array(n * 3) });
  return (a._s = { k: [mk(), mk()], out: mk() });
}
function aclSegmentOf(a, key){
  if (!a.multiSeg) return 0;
  let seg = 0;
  for (let i = 1; i < a.numSegments; i++) {
    if (a.dv.getUint32(a.segStarts + i * 4, true) > key) break;
    seg = i;
  }
  return seg;
}
// One key frame of one segment → local rotation/translation/scale for every track.
// ---------- One key frame, as the format's own parts (ROADMAP 2.4) ----------
// `aclKeyframe` was 117 lines and the longest function in the app: the segment's own geometry, a
// rotation loop, and a vector loop that repeated the rotation loop's four cases against a different
// memory layout. They are methods on `Acl` now, over one `cx` describing where everything in the
// segment lives — which is the thing the 117 lines were really computing.
//
// **It was recorded as blocked**, on the grounds that it needed an install-free oracle and that
// §0.5 rules out storing a slice of a game clip to compare against. That was too narrow a reading:
// the function takes a DESCRIPTOR and a buffer, not a file, so `tools/t81_acl.mjs` lays out ACL
// buffers by hand — one per branch, with the answer in arithmetic — and nothing from the install is
// involved. It was shown to fail with the segment range's min and extent swapped.
const Acl = {
  // Where this segment's data lives, exactly as transform_tracks_header::get_segment_data lays it
  // out. Rotations are padded to a multiple of four in the per-track and segment-range arrays
  // because they are consumed in groups of four; the clip range array is not padded.
  segment(a, key){
    const dv = a.dv;
    const seg = aclSegmentOf(a, key);
    const keyInSeg = key - (a.multiSeg ? dv.getUint32(a.segStarts + seg * 4, true) : 0);
    const sh = a.segHdrs + seg * 16;
    const poseBits = dv.getUint32(sh, true), rotBits = dv.getUint32(sh + 4, true), trnBits = dv.getUint32(sh + 8, true);
    const segData = a.tt + dv.getUint32(sh + 12, true);
    const fmt0 = segData;
    const rng0 = (fmt0 + a.numAnimVar + 1) & ~1;
    const anim0 = (rng0 + (a.multiSeg ? 6 * a.numAnimVar : 0) + 3) & ~3;
    const rotPad = (a.nAnimRot + 3) & ~3;
    const fmtRot = fmt0, fmtTrn = fmtRot + rotPad, fmtScl = fmtTrn + a.nAnimTrn;
    const rngRot = rng0, rngTrn = rngRot + (a.multiSeg ? rotPad * 6 : 0),
          rngScl = rngTrn + (a.multiSeg ? a.nAnimTrn * 6 : 0);
    const clipRot = a.clipRange, clipTrn = clipRot + a.nAnimRot * 24, clipScl = clipTrn + a.nAnimTrn * 24;
    const constTrn = a.constData + a.nConstRot * 12, constScl = constTrn + a.nConstTrn * 12;
    return { a, dv, u8: a.u8, keyInSeg, poseBits, rotBits, trnBits,
             fmtRot, fmtTrn, fmtScl, rngRot, rngTrn, rngScl, clipRot, clipTrn, clipScl, constTrn, constScl,
             bit0: anim0 * 8 + keyInSeg * poseBits };
  },
  // Every track's rotation. quatf_drop_w: w is rebuilt from the other three and always taken
  // positive, then the quaternion renormalised — the sqrt is inexact near identity.
  rotations(cx, rot){
    const { a, dv, u8 } = cx;
    let bit = cx.bit0;
    for (let t = 0, ai = 0, ci = 0; t < a.numTracks; t++) {
      const ty = aclSubType(a, 0, t);
      let x = 0, y = 0, z = 0;
      if (ty === 1) {
        // Constant rotations are stored SOA in groups of four: xxxx, yyyy, zzzz.
        const g = ci >> 2, lane = ci & 3, gs = Math.min(4, a.nConstRot - g * 4);
        const f = a.constData + g * 48 + lane * 4;
        x = dv.getFloat32(f, true); y = dv.getFloat32(f + gs * 4, true); z = dv.getFloat32(f + gs * 8, true);
        ci++;
      } else if (ty === 2) {
        const g = ai >> 2, lane = ai & 3, gs = Math.min(4, a.nAnimRot - g * 4);
        const nb = u8[cx.fmtRot + ai];
        let doSeg = a.multiSeg, doClip = true;
        if (nb === 0) {
          // Constant within the segment: the sample itself is packed into the segment range bytes,
          // 16 bits per component split across the min and extent halves of the SOA group.
          const s = cx.rngRot + g * 24 + lane;
          x = ((u8[s] << 8) | u8[s + 4]) / 65535;
          y = ((u8[s + 8] << 8) | u8[s + 12]) / 65535;
          z = ((u8[s + 16] << 8) | u8[s + 20]) / 65535;
          doSeg = false;
        } else if (nb === ACL_RAW_BITS) {
          x = aclF32(aclBitsBE(u8, bit, 32)); y = aclF32(aclBitsBE(u8, bit + 32, 32)); z = aclF32(aclBitsBE(u8, bit + 64, 32));
          bit += 96; doSeg = false; doClip = false;
        } else {
          const d = (1 << nb) - 1;
          x = aclBitsBE(u8, bit, nb) / d; y = aclBitsBE(u8, bit + nb, nb) / d; z = aclBitsBE(u8, bit + nb * 2, nb) / d;
          bit += nb * 3;
        }
        if (doSeg) {
          const s = cx.rngRot + g * 24 + lane;
          x = x * (u8[s + 12] / 255) + u8[s] / 255;
          y = y * (u8[s + 16] / 255) + u8[s + 4] / 255;
          z = z * (u8[s + 20] / 255) + u8[s + 8] / 255;
        }
        if (doClip) {
          const c = cx.clipRot + g * 96 + lane * 4;   // SOA again, group_size floats per component
          x = x * dv.getFloat32(c + gs * 12, true) + dv.getFloat32(c, true);
          y = y * dv.getFloat32(c + gs * 16, true) + dv.getFloat32(c + gs * 4, true);
          z = z * dv.getFloat32(c + gs * 20, true) + dv.getFloat32(c + gs * 8, true);
        }
        ai++;
      }
      const w2 = 1 - (x * x + y * y + z * z);
      const w = w2 > 0 ? Math.sqrt(w2) : 0;
      const l = Math.hypot(x, y, z, w) || 1;          // the sqrt is inexact near identity; renormalise
      rot[t * 4] = x / l; rot[t * 4 + 1] = y / l; rot[t * 4 + 2] = z / l; rot[t * 4 + 3] = w / l;
    }
  },
  // Translations and scales: the same four cases, but their range data is AOS rather than SOA.
  vectors(cx, kind, out, def, constBase, fmtBase, rngBase, clipBase, bit0){
    const { a, dv, u8 } = cx;
    let bit = bit0;
    for (let t = 0, ai = 0, ci = 0; t < a.numTracks; t++) {
      const ty = kind === 2 && !a.hasScale ? 0 : aclSubType(a, kind, t);
      let x = def, y = def, z = def;
      if (ty === 1) {
        const f = constBase + ci * 12;
        x = dv.getFloat32(f, true); y = dv.getFloat32(f + 4, true); z = dv.getFloat32(f + 8, true);
        ci++;
      } else if (ty === 2) {
        const nb = u8[fmtBase + ai], s = rngBase + ai * 6, c = clipBase + ai * 24;
        let doSeg = a.multiSeg, doClip = true;
        if (nb === 0) {
          x = dv.getUint16(s, true) / 65535; y = dv.getUint16(s + 2, true) / 65535; z = dv.getUint16(s + 4, true) / 65535;
          doSeg = false;
        } else if (nb === ACL_RAW_BITS) {
          x = aclF32(aclBitsBE(u8, bit, 32)); y = aclF32(aclBitsBE(u8, bit + 32, 32)); z = aclF32(aclBitsBE(u8, bit + 64, 32));
          bit += 96; doSeg = false; doClip = false;
        } else {
          const d = (1 << nb) - 1;
          x = aclBitsBE(u8, bit, nb) / d; y = aclBitsBE(u8, bit + nb, nb) / d; z = aclBitsBE(u8, bit + nb * 2, nb) / d;
          bit += nb * 3;
        }
        if (doSeg) {
          x = x * (u8[s + 3] / 255) + u8[s] / 255;
          y = y * (u8[s + 4] / 255) + u8[s + 1] / 255;
          z = z * (u8[s + 5] / 255) + u8[s + 2] / 255;
        }
        if (doClip) {
          x = x * dv.getFloat32(c + 12, true) + dv.getFloat32(c, true);
          y = y * dv.getFloat32(c + 16, true) + dv.getFloat32(c + 4, true);
          z = z * dv.getFloat32(c + 20, true) + dv.getFloat32(c + 8, true);
        }
        ai++;
      }
      out[t * 3] = x; out[t * 3 + 1] = y; out[t * 3 + 2] = z;
    }
  },
};
function aclKeyframe(a, key, dst){
  const cx = Acl.segment(a, key);
  Acl.rotations(cx, dst.rot);
  Acl.vectors(cx, 1, dst.pos, 0, cx.constTrn, cx.fmtTrn, cx.rngTrn, cx.clipTrn, cx.bit0 + cx.rotBits);
  Acl.vectors(cx, 2, dst.scl, a.defaultScale ? 1 : 0, cx.constScl, cx.fmtScl, cx.rngScl, cx.clipScl,
              cx.bit0 + cx.rotBits + cx.trnBits);
  return dst;
}
// The pose at `seconds`, linearly interpolated between the two nearest key frames — which is what
// the engine does too (quat_lerp_stable, not slerp).
function aclSample(a, seconds){
  const s = aclScratch(a);
  const n = a.numSamples;
  const t = Math.max(0, Math.min(a.duration, seconds));
  const idx = t * a.sampleRate;
  let k0 = Math.floor(idx);
  if (!(k0 >= 0)) k0 = 0;
  if (k0 > n - 1) k0 = n - 1;
  const k1 = Math.min(k0 + 1, n - 1);
  const alpha = Math.min(1, Math.max(0, idx - k0));
  if (k0 === k1 || alpha === 0) return aclKeyframe(a, k0, s.out);
  aclKeyframe(a, k0, s.k[0]);
  aclKeyframe(a, k1, s.k[1]);
  const A = s.k[0], B = s.k[1], o = s.out;
  for (let i = 0; i < a.numTracks; i++) {
    const r = i * 4;
    let bx = B.rot[r], by = B.rot[r+1], bz = B.rot[r+2], bw = B.rot[r+3];
    // shortest arc — without the flip a 180°-apart pair interpolates the long way round
    if (A.rot[r]*bx + A.rot[r+1]*by + A.rot[r+2]*bz + A.rot[r+3]*bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    const x = A.rot[r] + (bx - A.rot[r]) * alpha, y = A.rot[r+1] + (by - A.rot[r+1]) * alpha;
    const z = A.rot[r+2] + (bz - A.rot[r+2]) * alpha, w = A.rot[r+3] + (bw - A.rot[r+3]) * alpha;
    const l = Math.hypot(x, y, z, w) || 1;
    o.rot[r] = x / l; o.rot[r+1] = y / l; o.rot[r+2] = z / l; o.rot[r+3] = w / l;
    const v = i * 3;
    for (let k = 0; k < 3; k++) {
      o.pos[v+k] = A.pos[v+k] + (B.pos[v+k] - A.pos[v+k]) * alpha;
      o.scl[v+k] = A.scl[v+k] + (B.scl[v+k] - A.scl[v+k]) * alpha;
    }
  }
  return o;
}

// ---- affine matrices, in the GeomNodeTree's own row-major m[row][col] form ----
function a2dMatFromPRS(p, q, s){
  const [x, y, z, w] = q;
  const xx = x*x, yy = y*y, zz = z*z, xy = x*y, xz = x*z, yz = y*z, wx = w*x, wy = w*y, wz = w*z;
  return [
    [(1 - 2*(yy + zz)) * s[0], (2*(xy - wz)) * s[1], (2*(xz + wy)) * s[2], p[0]],
    [(2*(xy + wz)) * s[0], (1 - 2*(xx + zz)) * s[1], (2*(yz - wx)) * s[2], p[1]],
    [(2*(xz - wy)) * s[0], (2*(yz + wx)) * s[1], (1 - 2*(xx + yy)) * s[2], p[2]],
    [0, 0, 0, 1]];
}
function a2dMatMul(a, b){
  const m = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,1]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[r][c] = a[r][0]*b[0][c] + a[r][1]*b[1][c] + a[r][2]*b[2][c];
    m[r][3] = a[r][0]*b[0][3] + a[r][1]*b[1][3] + a[r][2]*b[2][3] + a[r][3];
  }
  return m;
}
// Affine inverse. Full 3×3 inverse rather than a transpose: a handful of nodes carry a scale in
// their transform (fa_18a's flap3_l comes out 1.089 long), and transposing those shears the part.
function a2dMatInv(m){
  const a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2],
        g = m[2][0], h = m[2][1], i = m[2][2];
  const A = e*i - f*h, B = f*g - d*i, C = d*h - e*g;
  const det = a*A + b*B + c*C;
  if (!det) return null;
  const id = 1 / det;
  const r = [[A*id, (c*h - b*i)*id, (b*f - c*e)*id, 0],
             [B*id, (a*i - c*g)*id, (c*d - a*f)*id, 0],
             [C*id, (b*g - a*h)*id, (a*e - b*d)*id, 0],
             [0, 0, 0, 1]];
  for (let k = 0; k < 3; k++) r[k][3] = -(r[k][0]*m[0][3] + r[k][1]*m[1][3] + r[k][2]*m[2][3]);
  return r;
}

// ---- posing ----
// Local transform of one node at one frame. Falls back to the skeleton's own `tm` for nodes the
// clip says nothing about, which is what keeps an unanimated parent in place while a child moves.
function a2dLocalAt(a2d, node, frame, rest){
  const seconds = frame * A2D_TICKS_PER_FRAME / A2D_TICKS_PER_SEC;
  const pos = a2d.pos && a2d.pos.byNode.get(node), rot = a2d.rot && a2d.rot.byNode.get(node),
        scl = a2d.scl && a2d.scl.byNode.get(node);
  if (pos === undefined && rot === undefined && scl === undefined) return rest;
  const key = a2d.pos ? a2d.pos.acl : a2d.rot.acl;
  const s = aclSampleCached(a2d, key, seconds);
  const p = pos !== undefined ? [s.pos[pos*3], s.pos[pos*3+1], s.pos[pos*3+2]] : [rest[0][3], rest[1][3], rest[2][3]];
  const q = rot !== undefined ? [s.rot[rot*4], s.rot[rot*4+1], s.rot[rot*4+2], s.rot[rot*4+3]] : null;
  const k = scl !== undefined ? [s.scl[scl*3], s.scl[scl*3+1], s.scl[scl*3+2]] : [1, 1, 1];
  if (!q) return rest;                              // position-only tracks are rare and not hinges
  return a2dMatFromPRS(p, q, k);
}
// One decoded pose per (blob, time) for the duration of a repose. Every control samples the same
// clip at its own frame, so without this a ten-slider pose decodes 756 tracks ten times over.
function aclSampleCached(a2d, aclOfs, seconds){
  const c = a2d._cache || (a2d._cache = new Map());
  const key = aclOfs + ":" + seconds.toFixed(6);
  let v = c.get(key);
  if (!v) {
    const s = aclSample(a2d.acl.get(aclOfs), seconds);
    // aclSample reuses its scratch, so a cached pose has to be a copy
    v = { rot: s.rot.slice(), pos: s.pos.slice(), scl: s.scl.slice() };
    if (c.size > 32) c.clear();
    c.set(key, v);
  }
  return v;
}
// node name → track index, per channel. Built once; every lookup during a repose goes through it.
function a2dIndexNodes(a2d){
  for (const c of [a2d.pos, a2d.scl, a2d.rot]) {
    if (!c || c.byNode) continue;
    c.byNode = new Map();
    for (const n of c.nodes) if (n.track !== 0xffff) c.byNode.set(n.name, n.track);
  }
  return a2d;
}
// World transform of every skeleton node with each node sampled at its own frame. The a2d stores
// LOCAL, parent-relative transforms — verified directly against the skeleton, where
// wtm = parentWtm · tm holds for all 311 of an F-4E's child nodes — so the composition down the
// tree is what makes a wheel follow its strut without either being told about the other.
function a2dWorld(a2d, skel, frameOf){
  const world = new Array(skel.nodes.length);
  const stack = [];
  for (const n of skel.nodes) if (n.parent < 0) stack.push(n.i);
  while (stack.length) {
    const n = skel.nodes[stack.pop()];
    const f = frameOf(n.name);
    const local = f == null ? n.tm : a2dLocalAt(a2d, n.name, f, n.tm);
    world[n.i] = n.parent >= 0 ? a2dMatMul(world[n.parent], local) : local;
    for (const ci of n.children) stack.push(ci);
  }
  return world;
}
// The transform that takes each node's baked geometry from where it was extracted to where the
// clip puts it.
//
// The obvious delta — newWorld · restWorld⁻¹ against the skeleton's own rest pose — is wrong, and
// measurably so. The model's authored pose is NOT frame 0 of the clip: of an F-4E's 255 animated
// nodes that the skeleton also has, only 83 reproduce their `tm` at any frame at all, because the
// animation is a separate export whose rig need not share the render skeleton's rest orientations.
// Using it as the reference makes the very first slider movement jerk every part into the anim
// scene's pose — an F-4E's nose gear jumped 12 m.
//
// So the delta is taken against the clip's own reference frame instead: newWorld · refWorld⁻¹,
// both composed from the a2d. At f = ref it is exactly the identity, so the model sits as
// extracted, and away from ref it applies precisely the motion the clip describes. `refOf` says
// which frame each node was authored at — poseRefFrame picks it from the data.
function a2dDeltas(a2d, skel, frameOf, refOf){
  if (!skel || !skel.nodes) return null;
  a2dIndexNodes(a2d);
  const now = a2dWorld(a2d, skel, frameOf);
  const ref = a2dWorld(a2d, skel, refOf);
  const out = new Map();
  for (const n of skel.nodes) {
    const inv = a2dMatInv(ref[n.i]);
    if (!inv) continue;
    const d = a2dMatMul(now[n.i], inv);
    let moved = false;
    for (let r = 0; r < 3 && !moved; r++) for (let c = 0; c < 4; c++)
      if (Math.abs(d[r][c] - (r === c ? 1 : 0)) > 1e-6) { moved = true; break; }
    if (moved) out.set(n.name, d);
  }
  return out;
}
// Which frame of the clip the model's geometry was authored in, for one set of nodes. Measured,
// not assumed: an aircraft is modelled gear-down (frame 100) but with its flaps and airbrake shut
// (frame 0), so this is per control rather than per vehicle. The score is world-space position
// error against the skeleton's rest pose, which is where the geometry actually is.
function a2dRefFrame(a2d, skel, names){
  const set = new Set(names);
  const pick = n => set.has(n) ? cur : null;
  let cur = 0, best = 0, bestErr = Infinity;
  for (let f = 0; f <= 100; f += 5) {
    cur = f;
    const w = a2dWorld(a2d, skel, pick);
    let err = 0, n = 0;
    for (const nd of skel.nodes) {
      if (!set.has(nd.name)) continue;
      err += Math.hypot(w[nd.i][0][3] - nd.wtm[0][3], w[nd.i][1][3] - nd.wtm[1][3], w[nd.i][2][3] - nd.wtm[2][3]);
      n++;
    }
    if (!n) return 0;
    err /= n;
    if (err < bestErr) { bestErr = err; best = f; }
  }
  return best;
}
/*==ENDA2D==*/
