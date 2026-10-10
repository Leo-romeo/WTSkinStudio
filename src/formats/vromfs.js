"use strict";
/*==VROMFS==*/
// ---------- vromfs.bin container ----------
// What it feeds is in game/: registry.js turns the names below into vehicles, aces.js reads the
// gamedata tree out of aces.vromfs.bin. Nothing here may reach back up into either.
// Ported from klensy/wt-tools (formats/vromfs_parser.py, vromfs_unpacker.py).
// This is what turns raw resource names ("f_4e", "m1a2_sep3") into real vehicles with
// localized names, nation and class — and, critically, into the *unit ids* that a
// UserSkins .blk must be named after (f_4e → f-4e.blk, m1a2_sep3 → us_m1a2_sep3_abrams.blk).
//
// Only dictionary-free containers are read: lang.vromfs.bin (plain CSV) and
// char.vromfs.bin (BLK without a zstd dictionary). aces.vromfs.bin is deliberately skipped —
// its unit files are zstd-dictionary compressed, which no browser zstd can decode.
const VROMFS_OBFS_A = [0xAA55AA55, 0xF00FF00F, 0xAA55AA55, 0x12481248];
const VROMFS_OBFS_B = [0x12481248, 0xAA55AA55, 0xF00FF00F, 0xAA55AA55];
function readVromfs(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== "VRFs" && magic !== "VRFx") throw new Error("not a vromfs (" + magic + ")");
  const originalSize = dv.getUint32(8, true);
  const packedWord = dv.getUint32(12, true);
  const packedSize = packedWord & 0x3ffffff;
  const type = (packedWord >>> 26) & 0x3f;
  const bodyStart = 16 + (magic === "VRFx" ? 8 : 0);
  let plain;
  if (packedSize === 0) {
    plain = u8.subarray(bodyStart, bodyStart + originalSize);
  } else if (type === 0x10 || type === 0x30) {
    // the first and last 16 bytes of the zstd stream are XOR-obfuscated
    const parts = [];
    let mid = bodyStart, secondOfs = -1;
    if (packedSize >= 16) {
      const p = new Uint8Array(16), pd = new DataView(p.buffer);
      for (let i = 0; i < 4; i++) pd.setUint32(i * 4, (dv.getUint32(bodyStart + i * 4, true) ^ VROMFS_OBFS_A[i]) >>> 0, true);
      parts.push(p); mid = bodyStart + 16;
    }
    if (packedSize >= 32) secondOfs = mid + Math.floor((packedSize - 32) / 4) * 4;
    const need = Math.floor((packedSize - (packedSize >= 16 ? 16 : 0) - (packedSize >= 32 ? 16 : 0)) / 4) * 4;
    parts.push(u8.subarray(mid, mid + need));
    if (secondOfs >= 0) {
      const p = new Uint8Array(16), pd = new DataView(p.buffer);
      for (let i = 0; i < 4; i++) pd.setUint32(i * 4, (dv.getUint32(secondOfs + i * 4, true) ^ VROMFS_OBFS_B[i]) >>> 0, true);
      parts.push(p);
      const tail = packedSize % 4;
      if (tail) parts.push(u8.subarray(secondOfs + 16, secondOfs + 16 + tail));
    }
    let total = 0; for (const p of parts) total += p.length;
    const joined = new Uint8Array(total);
    let o = 0; for (const p of parts) { joined.set(p, o); o += p.length; }
    plain = zstdDec(joined);
  } else throw new Error("vromfs compression 0x" + type.toString(16) + " not supported");
  return vromfsFileTable(plain);
}
function vromfsFileTable(b){
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nameTableOfs = dv.getUint32(0, true), filesCount = dv.getUint32(4, true), dataTableOfs = dv.getUint32(16, true);
  const td = new TextDecoder();
  const names = [];
  let p = dv.getUint32(nameTableOfs, true);
  for (let i = 0; i < filesCount; i++) {
    let e = p; while (e < b.length && b[e] !== 0) e++;
    names.push(td.decode(b.subarray(b[p] === 0xff ? p + 1 : p, e)));
    p = e + 1;
  }
  const out = [];
  for (let i = 0; i < filesCount; i++) {
    const rec = dataTableOfs + i * 16;
    const ofs = dv.getUint32(rec, true), size = dv.getUint32(rec + 4, true);
    out.push({ name: names[i], data: b.subarray(ofs, ofs + size) });
  }
  return out;
}
// A vromfs entry holding a BLK, by leading payload byte: 1/3 = stored, 2/4 = zstd,
// 5 = zstd against the archive's own dictionary (pass its handle from zstdDict()).
// The byte says how the payload is *packed*, not how it is laid out: aces.vromfs.bin's 1 858
// type-3 entries are stored SLIM, so the layout must come from the decoded bytes instead —
// see vromfsBlkIsSlim.
function vromfsBlkBody(data, ddict){
  if (!data.length) return null;
  const t = data[0];
  if (t === 1 || t === 3) return data.subarray(1);
  if (t === 2) { const sz = data[1] | (data[2] << 8) | (data[3] << 16); return zstdDec(data.subarray(4, 4 + sz)).subarray(1); }
  if (t === 4) return zstdDec(data.subarray(1));
  if (t === 5) {
    if (!ddict) throw new Error("BLK needs the archive's zstd dictionary");
    return zstdDec(data.subarray(1), ddict);
  }
  return data;
}
// Decoded byte 0 is 0 when the names live in the shared `nm` map (SLIM) and non-zero when the
// block carries its own inline name section (FAT).
function vromfsBlkIsSlim(u8){ return !!u8 && u8.length > 0 && u8[0] === 0; }
// One vromfs BLK entry → a DataBlock, whichever layout it uses. `rootOnly` reads the root block's
// own params and none of its sub-blocks (SLIM only; a FAT block is read whole). Reading every
// unit's `model` for the vehicle list (GameUnits.ownModels) took 1 018 ms parsed whole and 427 ms
// root only, of which the zstd decode is 233 ms — under Node over 3 474 unit blks, 2026-10-10.
function loadVromfsBlk(data, sharedNames, ddict, rootOnly){
  const body = vromfsBlkBody(data, ddict);
  if (!body || !body.length) return null;
  return vromfsBlkIsSlim(body) ? loadSlimDataBlock(body, sharedNames, rootOnly) : loadDataBlock(body);
}
// `nm`: 40-byte header, then zstd → VLQ(count) VLQ(size) then NUL-separated names.
function vromfsNameMap(data){
  const plain = zstdDec(data.subarray(40));
  const r = new BlkReader(plain);
  blkVLQ(r, 1, 5, 7);
  const size = blkVLQ(r, 1, 5, 7);
  const raw = r.read(size);
  const td = new TextDecoder();
  const out = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === 0) { out.push(td.decode(raw.subarray(s, i))); s = i + 1; }
  return out;
}
// Param value decoding, shared by both layouts. The type nibble sits in bits 24-27 and the
// name index in the low 24; anything wider than 4 bytes stores an offset into paramsData.
// The one non-obvious case is strings: a value with bit 31 set is an index into the *name* map
// rather than an offset into paramsData. That is how every SLIM file in aces.vromfs.bin stores
// its strings — they have no paramsData at all (dataSize is 0), so decoding them as offsets
// silently yields "" for every mesh, emitter and blk path in the game's weapon data.
const BLK_STR = 0x1000000, BLK_INT = 0x2000000;
function blkParamReader(paramsData, pv, sharedNames, bias){
  const td = new TextDecoder();
  const pd = new DataView(paramsData.buffer, paramsData.byteOffset, paramsData.byteLength);
  const f32 = o => pd.getFloat32(o, true);
  const i32 = o => pd.getInt32(o, true);
  return (blk, pId) => {
    const o = blk.ofs + pId * 8;
    const flags = pv.getUint32(o, true);
    const raw = pv.getUint32(o + 4, true);
    const type = flags & 0xf000000;
    let val = raw;
    try {
      switch (type >>> 24) {
        case 1:                                       // string
          if (raw & 0x80000000) val = sharedNames[(raw & 0x7fffffff) - bias];
          else { let e = raw; while (e < paramsData.length && paramsData[e] !== 0) e++; val = td.decode(paramsData.subarray(raw, e)); }
          break;
        case 2: val = raw | 0; break;                 // int
        case 3: { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, raw, true); val = b.getFloat32(0, true); break; }
        case 4: val = [f32(raw), f32(raw + 4)]; break;
        case 5: val = [f32(raw), f32(raw + 4), f32(raw + 8)]; break;
        case 6: val = [f32(raw), f32(raw + 4), f32(raw + 8), f32(raw + 12)]; break;
        case 7: val = [i32(raw), i32(raw + 4)]; break;
        case 8: val = [i32(raw), i32(raw + 4), i32(raw + 8)]; break;
        case 9: val = !!raw; break;                   // bool
        case 10: val = raw >>> 0; break;              // E3DCOLOR, packed
        case 11: val = Array.from({ length: 12 }, (_, k) => f32(raw + k * 4)); break;
        case 12: val = Number(pd.getBigInt64(raw, true)); break;
      }
    } catch { val = raw; }                            // truncated paramsData: keep the raw word
    return { flags, type, val, raw, name: sharedNames[(flags & 0x0ffffff) - bias] };
  };
}
// SLIM DataBlock: identical to the FAT layout minus the inline name section. The root block is the
// first one listed and its params come first, so `rootOnly` can stop after it: the root then has
// no children, and nothing else is read.
function loadSlimDataBlock(u8, sharedNames, rootOnly){
  const r = new BlkReader(u8);
  r.byte();                                           // 0x00 = names live in the shared map
  const blocksCount = blkVLQ(r, 7, 0x23), paramsCount = blkVLQ(r, 7, 0x23), dataSize = blkVLQ(r, 7, 0x23);
  const paramsData = r.read(dataSize);
  const paramsBuf = r.read(paramsCount * 8);
  const pv = new DataView(paramsBuf.buffer, paramsBuf.byteOffset, paramsBuf.byteLength);
  const blocks = [];
  let offset = 0, firstBlockId = 0;
  for (let i = 0; i < (rootOnly ? Math.min(1, blocksCount) : blocksCount); i++) {
    const nameId = blkVLQ(r, 7, 0x23) - 1;
    const pCount = blkVLQ(r, 7, 0x15), bCount = blkVLQ(r, 7, 0x15);
    if (bCount !== 0) firstBlockId = blkVLQ(r, 7, 0x23);
    blocks.push({ nameId, pCount, bCount, firstBlockId, ofs: offset, children: [] });
    offset += 8 * pCount;
  }
  for (const blk of blocks) for (let i = 0; i < blk.bCount; i++) if (blocks[blk.firstBlockId + i]) blk.children.push(blocks[blk.firstBlockId + i]);
  const nameOf = b => (b.nameId >= 0 ? sharedNames[b.nameId] : "(root)");
  return { root: blocks[0], blocks, sharedNames, nameOf, slim: true,
    param: blkParamReader(paramsData, pv, sharedNames, 0),
    child(blk, name){ return blk.children.find(c => nameOf(c) === name); } };
}
/*==ENDVROMFS==*/
