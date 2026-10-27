"use strict";
/*==BLK==*/
// ---------- Binary BLK (Dagor DataBlock v3) + GameResDesc ----------
// Ported from Dagor Asset Explorer (datablock.py / gameres.py / material.py).
// This is the authoritative model→material→texture map (dynModelDesc.bin / riDesc.bin),
// which replaces the old name-guessing heuristic and fixes cases like the F-4E airframe
// (material "f_4e_aircraft_normal_detail" → textures f_4e_c / f_4e_n) and the Su-30
// (materials exported only as "unknown_N", where N is the material index).
class BlkReader {
  constructor(u8){ this.b = u8; this.o = 0; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  // A read past the end THROWS. It used to return `undefined`, which `& 0x7f` makes 0, so a count
  // from a crafted header ran its loop for billions of records out of a few bytes (ROADMAP 1.21 (2),
  // t144). In a file that parses, every read is in range, so this costs nothing that worked.
  byte(){ if (this.o >= this.b.length) throw new Error("DataBlock is truncated or corrupt — a read past the end"); return this.b[this.o++]; }
  u32(){ const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  read(n){ const s = this.o; if (!(n >= 0) || s + n > this.b.length) throw new Error("DataBlock is truncated or corrupt — " + n + " bytes past the end"); this.o += n; return this.b.subarray(s, s + n); }
  // A count out of a header: a fifth VLQ byte shifted by 28 can set bit 31 and make it negative, which
  // used to parse into a DataBlock with no root and throw later, elsewhere, as a TypeError (1.21 (2)).
  static count(n, what){ if (n < 0) throw new Error("DataBlock is corrupt — " + what + " out of range (" + n + ")"); return n; }
  // Each block's children are the `bCount` blocks from `firstBlockId`, and only the ones that exist:
  // the loop reads no bytes, so a crafted bCount of 2^21 per block was bounded by nothing (1.21 (2)).
  static link(blocks){
    for (const blk of blocks) {
      if (blk.children.length === blk.bCount || blk.firstBlockId < 0) continue;
      const end = Math.min(blk.bCount, blocks.length - blk.firstBlockId);
      for (let i = 0; i < end; i++) blk.children.push(blocks[blk.firstBlockId + i]);
    }
  }
}
// LEB128-style variable-length int: 7 payload bits per byte, high bit = continue.
function blkVLQ(r, step, end, shift = 1){
  let result = 0;
  for (let i = 0; i < end; i += step) {
    const val = r.byte();
    result |= (val & 0x7f) << (i * shift);
    if ((val & 0x80) === 0) break;
    if (r.o >= r.b.length) break;
  }
  return result;
}
function loadDataBlock(u8){
  const r = new BlkReader(u8);
  r.byte();                                     // magic
  blkVLQ(r, 1, 5, 7);                            // baseNamesNum (unused)
  const baseNamesSize = blkVLQ(r, 1, 5, 7);
  const namesRaw = r.read(baseNamesSize);
  const td = new TextDecoder();
  const sharedNames = td.decode(namesRaw.subarray(2)).split("\0").slice(0, -1);

  const blocksCount = BlkReader.count(blkVLQ(r, 7, 0x23), "block count");
  const paramsCount = BlkReader.count(blkVLQ(r, 7, 0x23), "param count");
  const dataSize    = BlkReader.count(blkVLQ(r, 7, 0x23), "data size");
  const paramsData  = r.read(dataSize);
  const paramsBuf   = r.read(paramsCount * 8);
  const pv = new DataView(paramsBuf.buffer, paramsBuf.byteOffset, paramsBuf.byteLength);

  const blocks = [];
  let offset = 0, firstBlockId = 0;
  for (let i = 0; i < blocksCount; i++) {
    const nameId = blkVLQ(r, 7, 0x23) - 1;
    const pCount = blkVLQ(r, 7, 0x15);
    const bCount = blkVLQ(r, 7, 0x15);
    if (bCount !== 0) firstBlockId = blkVLQ(r, 7, 0x23);
    blocks.push({ nameId, pCount, bCount, firstBlockId, ofs: offset, children: [] });
    offset += 8 * pCount;
  }
  BlkReader.link(blocks);
  const nameOf = b => (b.nameId >= 1 ? sharedNames[b.nameId - 1] : "(root)");   // DAE decrements twice net
  return {
    root: blocks[0], blocks, sharedNames, slim: false,
    name: nameOf, nameOf,
    child(blk, name){ return blk.children.find(c => nameOf(c) === name); },
    param: blkParamReader(paramsData, pv, sharedNames, 1),
  };
}
// magic(2) + 3-byte size + zstd stream → DataBlock
function loadGameResDesc(u8){
  if (u8[0] !== 2) throw new Error("GameResDesc magic != 2");
  const size = u8[1] | (u8[2] << 8) | (u8[3] << 16);
  const comp = u8.subarray(4, 4 + size);
  return loadDataBlock(Zstd.zstdDec(comp));
}
// model name → { tex:[names], mats:[{ block, slots:{tN:texName}, cls, props }] }
function descGetModel(db, modelName){
  const blk = db.child(db.root, modelName);
  if (!blk) return null;
  const texBlk = db.child(blk, "tex");
  const tex = [];
  if (texBlk) for (let i = 0; i < texBlk.pCount; i++) tex.push(db.param(texBlk, i).val);
  const mats = [];
  for (const bn of ["matR", "mat", "matS"]) {
    const mb = db.child(blk, bn);
    if (!mb) continue;
    for (const mBlk of mb.children) {
      const slots = {}, props = {};
      for (let i = 0; i < mBlk.pCount; i++) {
        const p = db.param(mBlk, i);
        if (p.type === 0x2000000) slots[p.name] = tex[p.val];
        else props[p.name] = p.val;
      }
      mats.push({ block: bn, slots, cls: props.cls || "", props });
    }
  }
  return { tex, mats };
}
// strip a texture name down to a material-name component (DAE material.py ftm)
function descFtm(tex){
  tex = tex.split("*")[0];
  const s = tex.split("_");
  let noTex = true;
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] === "tex") {
      if (i + 1 < s.length && s[i + 1].length <= 2) s.splice(i + 1, 1);
      s.splice(i, 1); noTex = false; break;
    }
  }
  if (noTex && s[s.length - 1].length < 2) s.pop();
  return s.join("_");
}
// reconstruct the exported material name from its texture slots (DAE __generateName__)
function descMatName(mat){
  const slots = []; for (const [k, v] of Object.entries(mat.slots)) slots[+k.slice(1)] = v;
  if (!slots.filter(Boolean).length) return mat.cls || "";
  const layered = (mat.cls || "").includes("layered"), dynamic = (mat.cls || "").includes("dynamic");
  const comps = []; const add = t => { if (t != null) comps.push(descFtm(t)); };
  if (!layered) { add(slots[0]); add(slots[1]); }
  const detailStart = (!dynamic || layered) ? 3 : 4;
  for (let i = detailStart; i < slots.length; i += 2) {
    const detail = slots[i]; add(detail);
    if (detail == null && i + 1 < slots.length) add(slots[i + 1]);
  }
  return comps.join("_");
}
// Build a lookup for one vehicle: material-name / unknown_N / index → { c, n, cls, all }.
// c = albedo (t0), n = normal (t2). Returns null if the model isn't in the desc.
function buildDescBind(db, modelName){
  const m = descGetModel(db, modelName);
  if (!m) return null;
  const map = new Map();
  m.mats.forEach((mat, i) => {
    const slots = []; for (const [k, v] of Object.entries(mat.slots)) slots[+k.slice(1)] = v;
    const c = slots[0] ? slots[0].split("*")[0] : null;
    const n = slots[2] ? slots[2].split("*")[0] : null;
    const entry = { c, n, cls: mat.cls, index: i,
      all: Object.fromEntries(Object.entries(mat.slots).map(([k, v]) => [k, v.split("*")[0]])) };
    const nm = descMatName(mat).toLowerCase();
    if (nm && !map.has(nm)) map.set(nm, entry);
    map.set("unknown_" + i, entry);      // DAE/WTRTI OBJ export names for untitled materials
    map.set("material_" + i, entry);
    map.set("#" + i, entry);             // by raw index
  });
  return { model: modelName, map, materials: m.mats };
}
/*==ENDBLK==*/
