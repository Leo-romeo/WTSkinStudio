// Counts read out of a crafted game file must be bounded by the bytes that are there.
//
// WHY THIS EXISTS. The scan of 2026-10-22 (ROADMAP 1.21 (2)) read that a binary BLK's reader returned
// `undefined` — which `& 0x7f` turns into 0 — for a byte past the end of its buffer, so a count taken
// from the header drove a loop that never ran out of input: 2^31 block records out of five bytes, a
// child loop of blocks × 2^21 that touches no bytes at all, a vromfs file table of 2^32 names out of
// 64 bytes, and a model whose `numFace` walked 4 billion faces of a three-face buffer. Each of those is
// a tab that hangs on one bad file, and a pack file is input like any other once a mod or a patch
// rewrites it. A fifth VLQ byte shifted by 28 also made a count NEGATIVE, which parsed "fine" into a
// DataBlock with no root and threw later, somewhere else, as a TypeError.
//
// Each case runs the page's own section (BLK, VROMFS, MODEL — lifted out of the built page by marker)
// in a worker thread with a deadline, so a regression is a FAIL in seconds rather than a hung suite.
// The last case holds the other side: a small well-formed DataBlock still reads exactly as it did.
//
// Usage: node tools/t144_crafted_bytes.mjs
import fs from "fs";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";

const src = fs.readFileSync(fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)), "utf8");
const sec = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " not in the page");
  return src.slice(a + 1, b).replace(/^"use strict";$/m, "");
};
const LIB = sec("BLK") + "\n" + sec("VROMFS") + "\n" + sec("MODEL");

// `body` is a function body run after the sections; it returns a JSON-able value or throws.
const run = (body, ms = 5000) => new Promise(resolve => {
  const code = `const { parentPort } = require("worker_threads");
    let out; try { out = { val: (function(){ ${LIB}\n return (function(){ ${body} })(); })() }; }
    catch (e) { out = { err: String(e && e.message || e) }; }
    parentPort.postMessage(out);`;
  const w = new Worker(code, { eval: true });
  const t = setTimeout(() => { w.terminate(); resolve({ hung: true }); }, ms);
  w.on("message", v => { clearTimeout(t); w.terminate(); resolve(v); });
  w.on("error", e => { clearTimeout(t); resolve({ err: "worker: " + (e && e.message || e) }); });
});

let pass = 0, fail = 0;
const is = (ok, msg) => { if (ok) pass++; else fail++; console.log((ok ? "ok   " : "FAIL ") + msg); };
const said = r => r.hung ? "still running after 5 s" : r.err ? "threw: " + r.err : "returned " + JSON.stringify(r.val).slice(0, 80);
// a throw that names the file as damaged — not a TypeError from somewhere downstream, not a hang
const refused = r => !!r.err && /truncated|corrupt|out of range|past the end/i.test(r.err);

// FAT DataBlock prefix: magic, baseNamesNum 0, baseNamesSize 2, two name-map bytes.
const FAT = "0x01, 0x00, 0x02, 0x00, 0x00";

// 1. A block count of 2^31 - 1 from five bytes, and nothing after it.
let r = await run(`return loadDataBlock(new Uint8Array([${FAT}, 0xff, 0xff, 0xff, 0xff, 0x07])).blocks.length;`);
is(refused(r), `a FAT DataBlock claiming 2^31 blocks in 10 bytes is refused as damaged (${said(r)})`);

// 2. The same count in a SLIM block (vromfs's layout).
r = await run(`return loadSlimDataBlock(new Uint8Array([0x00, 0xff, 0xff, 0xff, 0xff, 0x07]), [], false).blocks.length;`);
is(refused(r), `a SLIM DataBlock claiming 2^31 blocks in 6 bytes is refused as damaged (${said(r)})`);

// 3. A fifth VLQ byte that sets bit 31: the count goes negative.
r = await run(`return String(loadDataBlock(new Uint8Array([${FAT}, 0x80, 0x80, 0x80, 0x80, 0x08, 0x00, 0x00])).root);`);
is(refused(r), `a block count made negative by its fifth VLQ byte is refused, not parsed into a DataBlock with no root (${said(r)})`);

// 4. 3 000 well-formed block records, each claiming 2^21 - 1 children from block 0: the child loop
//    reads no bytes, so it is bounded by the blocks that exist or by nothing (6 billion iterations).
{
  const N = 3000, rec = [0x01, 0x00, 0xff, 0xff, 0x7f, 0x00];
  const bytes = [0x01, 0x00, 0x02, 0x00, 0x00, ...[N & 0x7f | 0x80, N >> 7], 0x00, 0x00];
  for (let i = 0; i < N; i++) bytes.push(...rec);
  r = await run(`const db = loadDataBlock(new Uint8Array([${bytes.join(",")}]));
    return { blocks: db.blocks.length, kids: db.root.children.length };`);
  is(!r.hung && !r.err && r.val.blocks === N && r.val.kids <= N,
    `${N} blocks each claiming 2 097 151 children read in bounded time, children only from blocks that exist (${said(r)})`);
  r = await run(`const db = loadSlimDataBlock(new Uint8Array([0x00, ${bytes.slice(5).join(",")}]), [], false);
    return { blocks: db.blocks.length, kids: db.root.children.length };`);
  is(!r.hung && !r.err && r.val.blocks === N && r.val.kids <= N, `…and the same in the SLIM layout (${said(r)})`);
}

// 5. A vromfs file table claiming 2^32 - 1 files in 64 bytes.
r = await run(`const b = new Uint8Array(64), dv = new DataView(b.buffer);
  dv.setUint32(0, 32, true); dv.setUint32(4, 0xffffffff, true); dv.setUint32(16, 32, true);
  return vromfsFileTable(b).length;`);
is(refused(r), `a vromfs file table claiming 4 294 967 295 files in 64 bytes is refused as damaged (${said(r)})`);

// 6. A model element whose numFace is 4 billion over a buffer of one face.
r = await run(`const mvd = { compute(){}, vdCount: 1, gvd: [{ storageFormat: 0 }],
    getVertexData(){ return { verts: [[0,0,0],[1,0,0],[0,1,0]], uvs: [[0,0],[1,0],[0,1]], cuvs: null, faces: [[0,1,2]] }; } };
  const dm = { mvd, skeleton: null, skinNodes: new Map(), nodeNames: [], bpC255: [1,1,1], bpC254: [0,0,0],
    lods: [{ rigids: [{ nodeId: 0 }], shaderMesh: [{ elems: [{ vData: 0, vdOrderIndex: 0, baseVertex: 0, startI: 0, numFace: 4e9, mat: 0 }] }] }] };
  const g = buildDynModelGeometry(dm, 0);
  return g.objects[0].groups[0].faces.length;`);
is(!r.hung && !r.err && r.val === 1, `a model element claiming 4 billion faces over a buffer of one reads the one (${said(r)})`);

// 7. The other side: a well-formed DataBlock reads as before — root, one child named from the map,
//    one integer param on the child.
{
  // names "\0\0" + "tex\0"; root (nameId 0 → VLQ 1) with 1 child at block 1; child "tex" (VLQ 2) with
  // 1 param; the param: name index 0 (type 2 = int in bits 24-27), value 42.
  const names = [0x00, 0x00, 0x74, 0x65, 0x78, 0x00];
  const bytes = [0x01, 0x01, names.length, ...names, 0x02, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x02, 42, 0, 0, 0,   // the params table comes before the block records
    0x01, 0x00, 0x01, 0x01,      // root: nameId+1 = 1, 0 params, 1 child from block 1
    0x02, 0x01, 0x00];           // "tex": 1 param, no children
  r = await run(`const db = loadDataBlock(new Uint8Array([${bytes.join(",")}]));
    const t = db.child(db.root, "tex");
    return { n: db.blocks.length, kids: db.root.children.length, tex: !!t, p: t ? t.pCount : -1 };`);
  is(!r.err && !r.hung && r.val.n === 2 && r.val.kids === 1 && r.val.tex && r.val.p === 1,
    `a well-formed DataBlock still reads: two blocks, the root's child found by name, its param counted (${said(r)})`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
