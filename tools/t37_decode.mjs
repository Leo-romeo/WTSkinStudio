// Decode in a worker must be byte-identical to decode on the UI thread (ROADMAP 1.2).
//
// This is the decode-side twin of t33_export. The claim that matters is the same one: the pixels
// a user paints on, and the .dds bytes a project embeds, must not depend on WHERE they were
// produced. So every fixture is decoded both ways and compared byte for byte — the whole level 0,
// the whole re-wrapped container, and every lazily-decoded mip below it.
//
// Three things here are specific to decode and are the reason this test exists at all:
//
//   * DDS.parseDDS returns a mip chain whose levels >= 1 are GETTERS. Structured clone invokes
//     getters, so returning that object from a worker would force the entire chain eagerly and
//     undo the v0.16 win. The worker returns level 0 plus the header, and the buffer comes back
//     with it so the main thread can rebuild the lazy levels; this asserts level 0 is a plain
//     value, the rest are still getters, and every one of them decodes to the same bytes.
//   * The decompressors run in the worker, so their WASM has to instantiate there. zstd is
//     round-tripped through a frame Node compressed, and Oodle is proved live by the SHAPE of its
//     failure: a decoder that never instantiated says "not embedded in this build".
//   * The ops are async now (Oodle compiles its module, the zlib path goes through
//     DecompressionStream). The inline fallback takes a different code path for that and is
//     checked to produce the same bytes.
//
// Usage: node tools/t37_decode.mjs [--keep] [--chrome <path>]
import zlib from "zlib";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// ---- fixtures ---------------------------------------------------------------------------------
// Random block bytes on purpose, as in t23: a BCn block is not validated by either decoder, so
// random data walks both endpoint orderings, every palette index and every alpha mode.
let seed = 0x51f3c7d;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const bytes = n => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (rnd() * 256) | 0; return b; };
const b64 = b => Buffer.from(b).toString("base64");

const blk = (w, h, bs) => Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * bs;
const chainBC = (w, h, bs) => {
  let t = 0;
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    t += blk(lw, lh, bs);
    if (lw === 1 && lh === 1) break;
  }
  return t;
};
const chainRGBA = (w, h) => {
  let t = 0;
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    t += lw * lh * 4;
    if (lw === 1 && lh === 1) break;
  }
  return t;
};
const mipsFor = (w, h) => 1 + Math.floor(Math.log2(Math.max(w, h)));

const ddsHead = (w, h, mipCount, len) => {
  const head = Buffer.alloc(len);
  head.writeUInt32LE(0x20534444, 0);
  head.writeUInt32LE(124, 4);
  head.writeUInt32LE(h, 12); head.writeUInt32LE(w, 16);
  head.writeUInt32LE(mipCount, 28);
  head.writeUInt32LE(32, 76);
  return head;
};
const ddsBC = (w, h, fourCC, payload) => {
  const head = ddsHead(w, h, mipsFor(w, h), 128);
  head.writeUInt32LE(0x4, 80);                     // DDPF_FOURCC
  head.write(fourCC, 84, 4, "ascii");
  return Buffer.concat([head, payload]);
};
const ddsDX10 = (w, h, dxgi, payload) => {
  const head = ddsHead(w, h, mipsFor(w, h), 148);
  head.writeUInt32LE(0x4, 80);
  head.write("DX10", 84, 4, "ascii");
  head.writeUInt32LE(dxgi, 128); head.writeUInt32LE(3, 132); head.writeUInt32LE(1, 140);
  return Buffer.concat([head, payload]);
};
const ddsMasked = (w, h, payload) => {
  const head = ddsHead(w, h, mipsFor(w, h), 128);
  head.writeUInt32LE(0x41, 80);                    // DDPF_RGB | DDPF_ALPHAPIXELS — no fourCC
  head.writeUInt32LE(32, 88);
  head.writeUInt32LE(0x00ff0000, 92); head.writeUInt32LE(0x0000ff00, 96);
  head.writeUInt32LE(0x000000ff, 100); head.writeUInt32LE(0xff000000, 104);
  return Buffer.concat([head, payload]);
};

const S = 128;
const DDS = [
  { name: "DXT1",   b64: b64(ddsBC(S, S, "DXT1", bytes(chainBC(S, S, 8)))) },
  { name: "DXT5",   b64: b64(ddsBC(S, S, "DXT5", bytes(chainBC(S, S, 16)))) },
  { name: "ATI2",   b64: b64(ddsBC(S, S, "ATI2", bytes(chainBC(S, S, 16)))) },
  { name: "ATI1",   b64: b64(ddsBC(S, S, "ATI1", bytes(chainBC(S, S, 8)))) },
  { name: "BC7",    b64: b64(ddsDX10(S, S, 98, bytes(chainBC(S, S, 16)))) },
  { name: "B8G8R8A8", b64: b64(ddsMasked(64, 64, bytes(chainRGBA(64, 64)))) },
];

// One DDSx-style entry per compression code. `top` is the uncompressed top-level block payload,
// which is the reference the page decodes on its own thread.
const gameCase = (name, fmt, w, h, bs, comp) => {
  const top = bytes(blk(w, h, bs));
  let body = top, packedSz = 0;
  if (comp === 0x80) { body = zlib.deflateSync(top); packedSz = body.length; }
  else if (comp === 0x20) { body = zlib.zstdCompressSync(top); packedSz = body.length; }
  return { name, fmt, w, h, comp, levels: 1, revMip: false, compName: name,
    memSz: top.length, packedSz, body: b64(body), top: b64(top) };
};
const GAME = [
  gameCase("raw DXT5",     "DXT5", 128, 128, 16, 0),
  gameCase("zlib BC7",     "BC7",  256, 256, 16, 0x80),
  gameCase("zstd DXT1",    "DXT1", 128, 128, 8,  0x20),
  gameCase("raw ATI1/BC4", "ATI1", 64,  64,  8,  0),
];
// FLG_REV_MIP_ORDER: the smaller levels come FIRST and the top level is last. Getting this
// backwards decodes a mip as if it were the full sheet, which looks like a corrupt texture.
{
  const w = 128, h = 128, bs = 16, levels = mipsFor(w, h);
  let lead = 0;
  for (let l = levels - 1; l >= 1; l--) lead += blk(Math.max(1, w >> l), Math.max(1, h >> l), bs);
  const top = bytes(blk(w, h, bs));
  GAME.push({ name: "reverse mip order", fmt: "ATI2", w, h, comp: 0, levels, revMip: true,
    compName: "raw", memSz: lead + top.length, packedSz: 0,
    body: b64(Buffer.concat([bytes(lead), top])), top: b64(top) });
}

const T = { dds: DDS, game: GAME,
  short: { fmt: "DXT5", w: 128, h: 128, body: b64(bytes(100)) },
  garbage: { body: b64(bytes(512)) } };

// ---- the page half ------------------------------------------------------------------------------
const BODY = `async function(){
  var out = {};
  var T = window.__T;
  var un = function(s){ var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  var firstDiff = function(a, b){
    if (a.length !== b.length) return -2;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
  };
  var refDecode = function(fmt, top, w, h){
    if (fmt === "BC7") return BCnDec.decodeBC7(top, w, h);
    if (fmt === "ATI1") return BCnDec.decodeBC4Tex(top, w, h);
    if (fmt === "ATI2" || fmt === "BC5U") return BCnDec.decodeBCn(top, w, h, "BC5");
    return BCnDec.decodeBCn(top, w, h, fmt);
  };

  var pool = decodePool();
  out.mode = await pool.warm();
  out.size = pool.size;
  out.oodleAvail = Oodle.oodleAvailable();
  out.zstdAvail = Zstd.zstdAvailable();

  // ---- 1. parseDDSAsync vs the page's own DDS.parseDDS ----
  var oneDDS = async function(f){
    var src = un(f.b64);
    var ref = DDS.parseDDS(src.slice().buffer);
    var send = src.slice().buffer;
    var got = await parseDDSAsync(send);
    // capture the property shapes BEFORE reading any level — reading a lazy one replaces it
    var d0 = Object.getOwnPropertyDescriptor(got.mips[0], "rgba") || {};
    var d1 = got.mips.length > 1 ? (Object.getOwnPropertyDescriptor(got.mips[1], "rgba") || {}) : { get: function(){} };
    var rec = { name: f.name, transferred: send.byteLength,
      header: [ref.width, ref.height, ref.format, ref.mips.length].join("/") ===
              [got.width, got.height, got.format, got.mips.length].join("/"),
      mipCount: got.mips.length,
      eager0: typeof d0.get !== "function", lazyRest: typeof d1.get === "function",
      diff: -1, level: -1, rawBack: -1 };
    for (var m = 0; m < ref.mips.length && rec.diff < 0; m++) {
      var d = firstDiff(ref.mips[m].rgba, got.mips[m].rgba);
      if (d !== -1) { rec.diff = d; rec.level = m; }
    }
    // the buffer must come back attached to the result, holding exactly the bytes handed over
    rec.rawBack = got.raw ? firstDiff(new Uint8Array(got.raw), src) : -3;
    return rec;
  };
  out.dds = [];
  for (var i = 0; i < T.dds.length; i++) out.dds.push(await oneDDS(T.dds[i]));

  // ---- 2. the gameTexture op vs decoding the same blocks here ----
  var oneGame = async function(g){
    var top = un(g.top);
    var refRgba = refDecode(g.fmt, top, g.w, g.h);
    var refDDS = DDS.writeBCnDDS(g.fmt, g.w, g.h, top);
    var send = un(g.body).slice().buffer;
    var r = await pool.call("gameTexture", { body: send, comp: g.comp, memSz: g.memSz,
      packedSz: g.packedSz, compName: g.compName, fmt: g.fmt, w: g.w, h: g.h,
      levels: g.levels, revMip: g.revMip }, [send]);
    return { name: g.name, transferred: send.byteLength,
      pixels: firstDiff(refRgba, new Uint8ClampedArray(r.rgba)),
      container: firstDiff(refDDS, new Uint8Array(r.dds)),
      bytes: r.rgba.byteLength };
  };
  out.game = [];
  for (var j = 0; j < T.game.length; j++) out.game.push(await oneGame(T.game[j]));

  // ---- 3. failures must arrive as their own message, not as a hang or "worker failed" ----
  var s = T.short, sb = un(s.body).slice().buffer;
  try {
    await pool.call("gameTexture", { body: sb, comp: 0, memSz: 100, packedSz: 0, compName: "raw",
      fmt: s.fmt, w: s.w, h: s.h, levels: 1, revMip: false }, [sb]);
    out.shortErr = "resolved (wrong)";
  } catch (e) { out.shortErr = e.message; }

  // Oodle cannot be round-tripped — there is no encoder — so it is proved live by the SHAPE of
  // the failure: a module that never instantiated inside the worker says "not embedded".
  var gb = un(T.garbage.body).slice().buffer;
  try {
    await pool.call("gameTexture", { body: gb, comp: 0x60, memSz: 65536, packedSz: 512,
      compName: "oodle", fmt: "DXT5", w: 128, h: 128, levels: 1, revMip: false }, [gb]);
    out.oodleErr = "resolved (wrong)";
  } catch (e) { out.oodleErr = e.message; }

  // ---- 4. the inline fallback: same source, same bytes, on this thread ----
  // dispose() puts the pool back to "unstarted" while keeping the source it was built from, so
  // this really is the identical code — not a second copy that could drift.
  pool.dispose();
  var realWorker = window.Worker;
  window.Worker = function(){ throw new Error("simulated: no workers here"); };
  try {
    out.inlineDDS = await oneDDS(T.dds[1]);
    out.inlineGame = await oneGame(T.game[1]);
    out.inlineMode = pool.mode;
  } finally { window.Worker = realWorker; }

  pool.dispose();
  return out;
}`;

const run = await evalInPage({
  browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep"),
  inject: "<script>window.__T = " + JSON.stringify(T).replace(/</g, "\\u003c") + ";</script>\n",
});
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log(`pool size ${r.size}, mode "${r.mode}"; zstd ${r.zstdAvail ? "embedded" : "absent"}, oodle ${r.oodleAvail ? "embedded" : "absent"}`);
R.is(r.mode === "worker", `the decode pool spawned real workers on a file:// page (mode "${r.mode}")`);

for (const d of r.dds) {
  R.is(d.header, `${d.name}: worker and main thread agree on the header (${d.mipCount} mips)`);
  R.is(d.diff === -1, d.diff === -1
    ? `${d.name}: all ${d.mipCount} levels byte-identical, lazy ones forced`
    : `${d.name}: mip ${d.level} differs at byte ${d.diff}`);
  R.is(d.eager0 && d.lazyRest,
    d.eager0 && d.lazyRest ? `${d.name}: level 0 is an eager value and the rest are still getters`
      : `${d.name}: mip shape wrong — eager0=${d.eager0} lazyRest=${d.lazyRest}`);
  R.is(d.transferred === 0, `${d.name}: the source buffer was transferred, not cloned (byteLength ${d.transferred})`);
  R.is(d.rawBack === -1, d.rawBack === -1
    ? `${d.name}: the source buffer came back on the result, byte for byte`
    : `${d.name}: the returned buffer differs at ${d.rawBack}`);
}

for (const g of r.game) {
  R.is(g.pixels === -1, g.pixels === -1
    ? `${g.name}: decoded pixels identical to the main thread (${g.bytes} bytes)`
    : `${g.name}: pixels differ at byte ${g.pixels}`);
  R.is(g.container === -1, g.container === -1
    ? `${g.name}: the re-wrapped .dds the project embeds is identical`
    : `${g.name}: the re-wrapped .dds differs at byte ${g.container}`);
  R.is(g.transferred === 0, `${g.name}: the compressed body was transferred, not cloned`);
}

R.is(/decompressed to 100 bytes, need 16384/.test(r.shortErr),
  `a short payload rejects with its own message ("${r.shortErr}")`);
if (r.oodleAvail) {
  R.is(!/not embedded/.test(r.oodleErr) && r.oodleErr !== "resolved (wrong)",
    `the Oodle decoder ran inside the worker — the failure is the decoder's ("${r.oodleErr.slice(0, 90)}")`);
} else {
  R.is(/not embedded/.test(r.oodleErr), `no Oodle blob in this build, and it says so ("${r.oodleErr}")`);
}

R.is(r.inlineMode === "inline", `with Worker unavailable the decode pool degrades to inline (mode "${r.inlineMode}")`);
R.is(r.inlineDDS.diff === -1 && r.inlineDDS.header && r.inlineDDS.eager0 && r.inlineDDS.lazyRest,
  r.inlineDDS.diff === -1 ? "the inline fallback parses a DDS to the same bytes, with the same mip shape"
    : `the inline DDS path differs at mip ${r.inlineDDS.level} byte ${r.inlineDDS.diff}`);
R.is(r.inlineGame.pixels === -1 && r.inlineGame.container === -1,
  r.inlineGame.pixels === -1 && r.inlineGame.container === -1
    ? "the inline fallback decodes a zlib game texture to the same pixels and the same container"
    : `the inline game path differs (pixels ${r.inlineGame.pixels}, container ${r.inlineGame.container})`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
