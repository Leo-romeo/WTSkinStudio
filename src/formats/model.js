"use strict";
/*==MODEL==*/
// ---------- Direct model extraction: GRP → DynModel → geometry ----------
// CLAUDE.md §2 wants grp.js / dynmodel.js / geomnodetree.js here. They are not three files yet
// because they are not three ranges: the skeleton reader sits between MatVData and the DynModel
// loader, so separating them is a reorder rather than a cut, and a reorder is not provable by
// concatenation the way the rest of this split was. Do it when the layer moves to real modules.
// Ported from Dagor Asset Explorer (realres.py / mesh.py). Verified against the game:
// f_4e and su_30sm2 extract to byte-identical vertex/face counts vs reference OBJ exports.
const GRP_CLS = { GeomNodeTree: 0x56f81b6d, RendInst: 0x77f8232f, DynModel: 0xb4b7d9c4, Anim2Data: 0x40c586f9 };
class MReader {
  constructor(u8, o = 0){ this.b = u8; this.o = o; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  get size(){ return this.b.length; }
  u8(){ return this.b[this.o++]; }
  i16(){ const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u16(){ const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i32(){ const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  u32(){ const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  u24(){ const v = this.b[this.o] | (this.b[this.o+1]<<8) | (this.b[this.o+2]<<16); this.o += 3; return v; }
  u64(){ const lo = this.u32(), hi = this.u32(); return hi * 0x100000000 + lo; }
  f32(){ const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  f16(){ return mF16(this.u16()); }
  skip(n){ this.o += n; }
  read(n){ const s = this.o; this.o += n; return this.b.subarray(s, s + n); }
  block(n){ const r = new MReader(this.b.subarray(this.o, this.o + n), 0); this.o += n; return r; }
}
function mF16(h){
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s?-1:1) * Math.pow(2,-14) * (f/1024);
  if (e === 0x1f) return f ? NaN : (s?-1:Infinity);
  return (s?-1:1) * Math.pow(2, e-15) * (1 + f/1024);
}
// GRP front: header + name map + real-res entries (name, classId, offset, size).
function grpParseFront(u8){
  const r0 = new MReader(u8, 0);
  r0.skip(8);
  const frontLen = r0.u32() + 4;
  const file = new MReader(u8.subarray(0xC, 0xC + frontLen), 0);
  const OFS = 0xC;
  const dataSize = file.u32() + 0x10;
  const nameMapOffset = file.u32() - OFS;
  const nameMapNum = file.u32();
  file.skip(8);
  const realResEntriesOffset = file.u32() - OFS;
  const realResNum = file.u32();
  file.skip(8);
  file.u32(); file.u32(); file.skip(8);                       // resData2 ptr/num (unused)
  // name map (0x40-based indices)
  const td = new TextDecoder();
  const nameMapData = file.read(nameMapOffset - file.o);
  const names = [];
  let prev = file.u32() - 0x40;
  for (let i = 0; i < nameMapNum; i++) {
    const next = (nameMapNum === i + 1) ? -1 : file.u32() - 0x40;
    names.push(td.decode(nameMapData.subarray(prev, next < 0 ? undefined : next)).replace(/\0+$/, ""));
    prev = next;
  }
  const entries = [];
  for (let i = 0; i < realResNum; i++) {
    const classId = file.u32();
    const offset = file.u32();
    const realResId = file.u16();
    file.u16();
    entries.push({ idx: i, name: names[i], classId, offset, realResId });
  }
  for (const e of entries) {
    const next = e.realResId + 1 >= entries.length ? dataSize : entries[e.realResId + 1].offset;
    e.size = next - e.offset;
  }
  return { dataSize, entries };
}
// CompressedData: 3-byte size + 1-byte method + payload
// (stored 0x00 / zstd 0x40 / zlib 0x60 / oodle 0x80).
// 0x00 is genuinely uncompressed and was missing until the animation work: 841 of the install's
// 5 310 a2d resources use it, and every one of them has the plain `ANIM` magic at byte 4.
async function grpDecompress(r){
  const cSz = r.u24(), method = r.u8();
  const data = r.read(cSz);
  if (method === 0x00) return data;
  if (method === 0x40) return zstdDec(data);
  if (method === 0x60) return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  if (method === 0x80) { const dv = new DataView(data.buffer, data.byteOffset, data.byteLength); const rawSize = dv.getUint32(0, true); const ex = await ensureOodle(); return oodleDecompress(ex, data.subarray(4), rawSize); }
  throw new Error("model uses compression 0x" + method.toString(16));
}
// vertex-format table (mesh.py FORMATS): format → stride → field layout
// `C` is the SECOND texture coordinate — the one the game maps the player's scalable camouflage
// (t1) through. mesh.py skipped it as padding. Measured 2026-09-26 (`tools/camo_sweep.mjs`), not
// read from a shader: every camouflaged dynamic_masked_tank material in a 589-model sample draws from
// format 4 / stride 20, whose first four bytes are two int16/4096 — tc0's own packing. Read that way
// they are a hand-laid box unwrap of the whole vehicle, seen from above with the sides folded out
// (M1A2 SEP3, Leopard 2A4, T-34 1941 rendered by `--uvsets`), all of them inside [0,1]² on the
// median of 605 models (99.4 % at p10), at 0.079 UV per metre (p10 0.059, p90 0.105) however big the
// object is — the shortest third of the roster (2.6 m) and the longest (7.6 m) read 0.076 and 0.077 —
// so one repeat of t1 spans roughly 12 m of vehicle. Read as halves they collapse (p50 0.000 UV/m);
// the other slots of the vertex are the normal and tc0.
const MV_FMT = (() => {
  const SV=["V","s"],FV=["V","f"],NU=["U","0"],SU=["U","s"],FU=["U","f"],CU=["C","s"],P=n=>["P",n];
  return {
    1:{12:[FV,NU]}, 2:{12:[SV,P(2),SU],16:[FV,SU]},
    3:{16:[SV,P(6),SU],20:[FV,P(4),SU],24:[FV,P(4),FU]},
    4:{20:[CU,SV,P(6),SU],28:[FV,P(4),FU,P(4)]},
    5:{24:[SU,SV,P(14)],28:[FV,P(12),SU],36:[FV,P(4),FU,P(12)]},
    6:{32:[FV,P(4),SU,P(12)]}, 13:{16:[SV,P(6),SU]},
    15:{24:[P(8),SV,P(6),SU],28:[FV,P(8),SU,P(4)],32:[FV,P(20),NU]},
    16:{28:[P(12),SV,P(6),SU],32:[P(4),FV,P(4),SU,P(8)],36:[FV,P(14),SU,P(6)]},
    17:{32:[NU,P(8),SV,P(18)],36:[FV,P(8),SU,P(12)]},
    25:{24:[SV,P(6),SU,P(8)],28:[FV,P(4),SU,P(8)],32:[FV,P(4),FU,P(8)]},
    26:{32:[P(4),FV,P(4),SU,P(8)]}, 27:{36:[FV,P(4),SU,P(16)]},
  };
})();
function mvReadVertex(r, k){ return k === "s" ? [r.i16()/32768, r.i16()/32768, r.i16()/32768] : [r.f32(), r.f32(), r.f32()]; }
function mvReadUV(r, k){
  if (k === "0") return [0, 0];
  if (k === "s") return [r.i16()/4096, 1 + (-r.i16()/4096)];
  return [r.f32(), -r.f32()];
}
// meshopt-style packed index decoder (mesh.py __decodeIndexSequence__)
function mvDecodeIndices(data){
  let off = 0; const buf = [0, 0]; const out = [];
  const leb = () => { let v = data[off++], d = v; if (v >= 0x80) { d = v & 0x7f; let sh = 7; for (let k = 0; k < 4; k++){ const b = data[off++]; d |= (b & 0x7f) << sh; sh += 7; if (b < 0x80) break; } } return d >>> 0; };
  const idx = () => { const dec = leb(); const cur = dec & 1; const dd = (dec >>> 2) ^ (-((dec & 2) !== 0)); const v = (buf[cur] + dd) | 0; buf[cur] = v; return v >>> 0; };
  while (off < data.length) { const a = idx(); if (off > data.length) break; const b = idx(); const c = idx(); out.push([a, c, b]); }
  return out;
}
class MatVData {
  constructor(u8, flag = 0){ this.r = new MReader(u8, 0); this.flag = flag; this.computed = false; }
  compute(){
    if (this.computed) return; const r = this.r; r.o = 0;
    r.u32(); r.u32(); r.skip(8);                              // matOfs, matCnt (unused: names via desc)
    const gvdOfs = r.u32(), gvdCnt = r.u32();
    r.o = gvdOfs; this.gvd = [];
    for (let i = 0; i < gvdCnt; i++) {
      const g = {};
      g.vCnt = r.u32(); g.vStride = r.u8(); g.iPackedSz = r.u24(); g.iSz = r.u32();
      g.flags = r.u16(); g.bf_14 = r.u16(); g.iCnt = r.u32(); g.storageFormat = r.u32() + this.flag * 10; r.skip(8);
      g.vertexBlockSz = g.vCnt * g.vStride;
      g.fullSz = g.vertexBlockSz + (g.iPackedSz === 0 ? g.iSz : g.iPackedSz);
      this.gvd.push(g);
    }
    this.vdStartOfs = gvdOfs + gvdCnt * 0x20; this.computed = true;
  }
  get vdCount(){ this.compute(); return this.gvd.length; }
  getVertexData(idx){
    this.compute();
    let ofs = this.vdStartOfs;
    for (let i = 0; i < idx; i++) ofs += this.gvd[i].fullSz;
    const g = this.gvd[idx];
    const file = new MReader(this.r.b.subarray(ofs, ofs + g.fullSz), 0);
    const layout = (MV_FMT[g.storageFormat] || {})[g.vStride];
    if (!layout) throw new Error("unsupported vertex format " + g.storageFormat + "-" + g.vStride);
    const vBlock = file.block(g.vertexBlockSz);
    const verts = new Array(g.vCnt), uvs = new Array(g.vCnt);
    const cuvs = layout.some(f => f[0] === "C") ? new Array(g.vCnt) : null;   // the camouflage's UV, where the format has one
    for (let i = 0; i < g.vCnt; i++) for (const fld of layout) {
      if (fld[0] === "P") vBlock.skip(fld[1]);
      else if (fld[0] === "V") verts[i] = mvReadVertex(vBlock, fld[1]);
      else if (fld[0] === "C") cuvs[i] = mvReadUV(vBlock, fld[1]);
      else uvs[i] = mvReadUV(vBlock, fld[1]);
    }
    let faces;
    if (g.iPackedSz === 0) {
      const count = Math.floor(g.iSz / 6) - (g.iSz % 6);
      faces = new Array(count);
      for (let i = 0; i < count; i++) faces[i] = [file.u16(), file.u16(), file.u16()];
    } else { file.skip(1); faces = mvDecodeIndices(file.read(g.iPackedSz - 0x5)); }
    return { verts, uvs, cuvs, faces };
  }
}
function mvReadShaderMesh(r){
  r.u32(); const cnt0 = r.u32(); r.skip(8);
  const stageEnd = []; for (let i = 0; i < 8; i++) stageEnd.push(r.u16());
  let maxMatPass = r.i32(); r.u32();
  let cnt = cnt0;
  if (maxMatPass < 0) maxMatPass &= 0x7fffffff;
  else if (stageEnd[2] !== 0) cnt += stageEnd[2];
  const elems = [];
  for (let i = 0; i < cnt; i++) {
    const e = {};
    e.shaderElemPtr = r.u64(); e.mat = r.u64(); e.vData = r.u64();
    e.vdOrderIndex = r.u32(); e.startV = r.u32(); e.numV = r.u32();
    e.startI = r.u32(); e.numFace = r.u32(); e.baseVertex = r.u32();
    elems.push(e);
  }
  return { elems };
}
// GeomNodeTree: node name → world transform matrix (row-major, translation in col 3)
// GeomNodeTree. Returns the name → world-transform Map every caller has always used, with the
// node array and the parent/child links hung off it: a node record carries `refOfs`/`refCnt`
// (byte offset into the node array ÷ 160, and a count), which is the model's real skeleton
// hierarchy. That is what lets a moving part take its whole subtree with it — a main gear leg is
// `gear_l` plus seventeen numbered sub-nodes plus `wheel_l`, and a tank's turret is every node
// under `bone_turret` — instead of a name-prefix guess.
function loadSkeletonBytes(u8){
  const bfile = new MReader(u8, 0);
  bfile.u32();
  const file = new MReader(bfile.b.subarray(bfile.o), 0);
  const nodeCnt = file.u32();
  const nodesStart = file.o;
  const map = new Map();
  const nodes = [];
  const readMat = r => { const flat = []; for (let i = 0; i < 16; i++) flat.push(r.f32());
    const m = []; for (let i = 0; i < 4; i++) m.push([flat[i], flat[i+4], flat[i+8], flat[i+12]]); return m; };
  for (let i = 0; i < nodeCnt; i++) {
    const bs = nodesStart + i * 160;
    const nb = new MReader(file.b.subarray(bs, bs + 160), 0);
    // tm is the node's transform relative to its parent; wtm is the same thing composed down from
    // the root. Geometry is baked with wtm, but an a2d's keys are per-node LOCAL PRS, so posing
    // needs tm as well — it is what an unanimated node contributes when the chain is recomposed.
    const tm = readMat(nb);
    const wtm = readMat(nb);
    const refOfs = nb.u32(), refCnt = nb.u32();
    nb.skip(8); nb.u32(); nb.skip(4);
    const nameOfs = nb.u32();
    let p = nameOfs + 4, s = "";
    while (p < file.b.length && file.b[p] !== 0) s += String.fromCharCode(file.b[p++]);
    map.set(s, wtm);
    nodes.push({ name: s, tm, wtm, i, kids: Math.floor(refOfs / 160), nKids: refCnt, parent: -1, children: [] });
  }
  // Link, defensively: a malformed or unexpected refOfs must not build a cycle or a bogus tree,
  // because everything downstream walks it.
  let bad = 0;
  for (const n of nodes) {
    for (let k = 0; k < n.nKids; k++) {
      const c = nodes[n.kids + k];
      if (!c || c === n || c.parent >= 0) { bad++; continue; }
      c.parent = n.i;
      n.children.push(c.i);
    }
  }
  map.nodes = bad ? null : nodes;                              // null = "no usable hierarchy"
  map.byName = new Map(nodes.map(n => [n.name, n]));
  return map;
}
// Every node at or below `name`, by name. Falls back to the node itself when the file gave no
// usable hierarchy.
function skelSubtree(skel, name){
  const out = [];
  const root = skel && skel.byName && skel.byName.get(name);
  if (!root) return out;
  if (!skel.nodes) return [name];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    out.push(n.name);
    for (const ci of n.children) stack.push(skel.nodes[ci]);
  }
  return out;
}
function mvApplyMat(m, v){
  return [ m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2] + m[0][3],
           m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2] + m[1][3],
           m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2] + m[2][3] ];
}
async function loadDynModelBytes(u8, name){
  const file = new MReader(u8, 0);
  file.u32();                                                 // lodHdrInfo
  const texCnt = file.u32(), matCnt = file.u32();
  const vdataNum = file.u32();
  const num = file.u32();
  const mvdHdrSz = num & 0x3fffffff, mvdHdrFlag = num !== mvdHdrSz;
  if (!(texCnt === 0xffffffff && matCnt === 0xffffffff)) {
    const texMapSz = file.u32(), texIndicesOfs = file.u32(), tc = file.u32(); file.skip(8);
    file.skip(texIndicesOfs + 0x18 - file.o);
  }
  let mvd = null;
  if (vdataNum === 0) file.skip(0x20);
  else if (!mvdHdrFlag) file.skip(0x10);
  else { const bin = await grpDecompress(file); mvd = new MatVData(new Uint8Array(bin), 0); }

  const blockSz = file.u32();
  const data = file.block(blockSz - 4);
  const lodCount = data.u32();
  data.skip(8); data.skip(0xC); data.skip(0xC);
  let bpC254 = [0,0,0,0], bpC255 = [1,1,1,1];
  if (blockSz > 0x28) { bpC254 = [data.f32(),data.f32(),data.f32(),data.f32()]; bpC255 = [data.f32(),data.f32(),data.f32(),data.f32()]; }
  const occ = [];
  for (let i = 0; i < lodCount; i++) { const q = file.u64(); const f = file.f32(); file.skip(4); occ.push([q, f]); }

  const sceneBlk = file.block(file.u32());
  const indicesOfs = sceneBlk.u32(), nameCnt = sceneBlk.u32(); sceneBlk.skip(8);
  const skinNodesOfs = sceneBlk.u32(), skinNodeCnt = sceneBlk.u32(); sceneBlk.skip(8);
  const nameMapData = sceneBlk.read(indicesOfs - 0x20);
  const td = new TextDecoder();
  const nodeNames = [];
  let prev = sceneBlk.u64() - 0x20;
  for (let i = 0; i < nameCnt; i++) {
    const next = (nameCnt === i + 1) ? -1 : sceneBlk.u64() - 0x20;
    nodeNames.push(td.decode(nameMapData.subarray(prev, next < 0 ? undefined : next)).replace(/\0+$/, ""));
    prev = next;
  }
  const skinNodes = new Map();
  for (let i = 0; i < skinNodeCnt; i++) skinNodes.set(sceneBlk.u16(), i);
  sceneBlk.skip((((4 - (skinNodeCnt % 4)) * 2) % 8));

  const lods = [];
  for (let li = 0; li < lodCount; li++) {
    const ofs = file.o;
    file.u32(); const rigidCnt = file.u32(); file.skip(8);
    file.u32(); file.u32(); file.skip(8);
    const rigids = [];
    for (let i = 0; i < rigidCnt; i++) { const rb = file.block(0x20);
      rigids.push({ shaderMeshPtr: rb.u64(), sph_c: [rb.f32(),rb.f32(),rb.f32()], sph_r: rb.f32(), nodeId: rb.u32(), resv: rb.u32() }); }
    file.skip(occ[li][0] - (file.o - ofs));
    const shaderMesh = [];
    for (let i = 0; i < rigidCnt; i++) shaderMesh.push(mvReadShaderMesh(file));
    lods.push({ rigids, shaderMesh });
  }
  return { name, mvd, lodCount, bpC254, bpC255, occ, nodeNames, skinNodes, lods };
}
// One LOD → { verts:[[x,y,z]], uvs:[[u,v]], objects:[{name, groups:[{matIndex, faces:[[a,b,c]]}]}] }
// A single vData vertex buffer is shared by many nodes (on modern jets the gear, rudders and
// weapon pylons all live in one buffer at different baseVertex slices). Each vertex must be
// transformed by the node that FIRST references it — not by whichever node happened to load the
// buffer — or every part after the first collapses toward the origin.
function buildDynModelGeometry(dm, lodId){
  const mvd = dm.mvd;
  // No MatVData in the resource at all (loadDynModelBytes leaves `mvd` null). Measured 2026-09-24 over
  // every 8th DynModel in the install: 64 of 3 273, all infantry kit and props, and they used to fail
  // as "Cannot read properties of null (reading 'compute')" — true, and useless to the person reading it.
  if (!mvd) throw new Error("this model keeps no vertex data of its own (no MatVData in its resource)");
  mvd.compute();
  const lod = dm.lods[lodId];
  const skel = dm.skeleton;
  const raw = [], uvs = [], cuvs = [];                        // raw = bpC-scaled, no wtm yet; cuvs sparse (tc1)
  const vertexDatas = new Array(mvd.vdCount).fill(null);
  const scale = dm.bpC255, off = dm.bpC254;
  const objects = [];
  // One buffer this reader cannot read costs the parts drawn from it, not the model (ROADMAP 4.4).
  // A Gaijin patch that adds a vertex format is exactly when this happens, and the rest of the
  // vehicle is still worth painting — so the failure is kept, the part keeps its name and no faces,
  // and the caller says what was left out. Before this, one unknown format threw the vehicle away.
  const ensureVData = vi => {
    if (vertexDatas[vi] != null) return vertexDatas[vi];
    let vd;
    try { vd = mvd.getVertexData(vi); }
    catch (e) { return vertexDatas[vi] = { failed: String((e && e.message) || e) }; }
    const base = raw.length;
    for (const v of vd.verts) raw.push([v[0]*scale[0]+off[0], v[1]*scale[1]+off[1], v[2]*scale[2]+off[2]]);
    for (const t of vd.uvs) uvs.push(t); if (vd.cuvs) vd.cuvs.forEach((t, k) => { cuvs[base + k] = t; });
    return vertexDatas[vi] = { vd, vOfs: base };
  };
  for (let smi = 0; smi < lod.shaderMesh.length; smi++) {
    const sm = lod.shaderMesh[smi];
    const rigid = lod.rigids[smi];
    const nodeIdx = dm.skinNodes.get(rigid.nodeId);
    const name = (nodeIdx != null ? dm.nodeNames[nodeIdx] : null) || ("node_" + smi);
    const wtm = skel ? skel.get(name) : null;
    const obj = { name, wtm, groups: [] };
    const vertexOrder = new Map();
    for (const elem of sm.elems) {
      const vdE = ensureVData(elem.vData);
      if (vdE.failed) { obj.lost = obj.lost || vdE.failed; continue; }
      if (!vertexOrder.has(elem.vdOrderIndex)) vertexOrder.set(elem.vdOrderIndex, []);
      // Format 5 was read as "skinned" (camo nets, tarpaulins, cables — a flat stretched slab when
      // extracted rigid), and the scene hides what this flags. That holds only where format 5 is a
      // small share of the model; see the majority rule after the loop, which un-flags it where it
      // is the model's ordinary vertex format (every ship).
      if ((mvd.gvd[elem.vData] || {}).storageFormat === 5) obj.skinned = true;
      vertexOrder.get(elem.vdOrderIndex).push(elem);
    }
    for (const group of vertexOrder.values()) for (const elem of group) {
      const vdEntry = vertexDatas[elem.vData];
      const indiceOffset = vdEntry.vOfs + elem.baseVertex;
      const faces = vdEntry.vd.faces;
      const curFace = Math.floor(elem.startI / 3);
      const g = { matIndex: Number(elem.mat), faces: [] };
      for (let i = curFace; i < curFace + elem.numFace; i++) { const f = faces[i]; if (!f) continue;
        g.faces.push([f[0]+indiceOffset, f[1]+indiceOffset, f[2]+indiceOffset]); }
      obj.groups.push(g);
    }
    objects.push(obj);
  }
  // per-vertex first-touch transform, then negate Z (DAE OBJ convention)
  const verts = new Array(raw.length);
  const done = new Uint8Array(raw.length);
  for (const obj of objects) for (const g of obj.groups) for (const f of g.faces) for (const vi of f) {
    if (done[vi]) continue; done[vi] = 1;
    const v = obj.wtm ? mvApplyMat(obj.wtm, raw[vi]) : raw[vi];
    verts[vi] = [v[0], v[1], -v[2]];
  }
  for (let i = 0; i < raw.length; i++) if (!done[i]) { const v = raw[i]; verts[i] = [v[0], v[1], -v[2]]; }
  // Format 5 is NOT "skinned" as a rule, and the flag above hides what it marks. Measured 2026-09-24
  // over every unit's own model: 596 of 644 SHIPS draw at least 90 % of their triangles from format-5
  // buffers, hull included and correctly placed — USS Fletcher loaded as an empty scene, all 318 of its
  // parts hidden — and so do the zeppelin and the J-11 (71.7 %). Where format 5 is a SMALL share it is
  // what the flag was written for: a tank's net (Leopard 2A4, 7.9 %) or an aircraft's propeller discs
  // (1–10 % on 609 aircraft; the Bf 109 F-4's sits 55 m off the wing). The distribution has almost
  // nothing between, so the rule is the majority: format 5 marks parts only where it is the minority
  // of the model. (Every part here is a RIGID object — the per-LOD skins table is skipped above — so
  // what format 5 really carries is 4.3's question; this only stops it hiding whole vehicles.)
  let triAll = 0, triF5 = 0;
  for (const o of objects) { let t = 0; for (const g of o.groups) t += g.faces.length; triAll += t; if (o.skinned) triF5 += t; }
  if (triF5 && triF5 >= triAll * .5) for (const o of objects) o.skinned = false;
  const dropped = objects.filter(o => o.lost).map(o => ({ piece: o.name, why: o.lost }));
  // Nothing readable at all is not a model with pieces missing; it is a model this build cannot read.
  if (dropped.length && !raw.length) throw new Error(dropped[0].why);
  return { verts, uvs, cuvs: cuvs.length ? cuvs : null, objects, dropped };
}
/*==ENDMODEL==*/
