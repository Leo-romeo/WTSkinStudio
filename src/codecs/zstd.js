"use strict";
/*==ZSTD==*/
// ---------- zstd decoder (decode-only, with dictionary support) ----------
// Zstandard's own single-file decoder (lib/decompress + lib/common, BSD-3/GPL-2 dual-licensed
// and freely redistributable) built to WASM with wasi-sdk: 85 KB, no imports but random_get.
// Why it is here and not a JS library: 23 489 of aces.vromfs.bin's 25 366 files are zstd frames
// compressed against the game's own 1 MB dictionary (shipped inside the archive as
// <sha256>.dict). No JS zstd — fzstd included — implements dictionary decoding, and Node's
// zlib.zstdDecompressSync loads a dictionary as raw content, so it fails the same way. Real
// libzstd is the only thing that reads those files, which is what unlocked the entire armament
// model (racks, payloads, station counts and the true pylon order) instead of guessing at it.
// It also decodes every plain zstd stream, so it replaced the fzstd CDN dependency outright.
let ZstdEx = null, ZstdOut = 0, ZstdCtx = 0;
const ZstdDicts = new Map();                    // digest key → wasm ZSTD_DDict*
function zstdAvailable(){ return typeof ZSTD_WASM_B64 !== "undefined" && !!ZSTD_WASM_B64; }
function zstdInit(){
  if (ZstdEx) return ZstdEx;
  if (!zstdAvailable()) throw new Error("zstd decoder not embedded in this build");
  const bin = atob(ZSTD_WASM_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Synchronous instantiation is fine: the main-thread limit is 8 MB and this is 85 KB.
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    wasi_snapshot_preview1: {
      random_get: (p, n) => { crypto.getRandomValues(new Uint8Array(inst.exports.memory.buffer, p, n)); return 0; },
      proc_exit: () => { throw new Error("zstd wasm aborted"); },
    },
  });
  const ex = inst.exports;
  ZstdCtx = ex.zdec_dctx_new();
  ZstdOut = ex.zdec_malloc(8);                  // scratch for the [ptr, size] result pair
  if (!ZstdCtx || !ZstdOut) throw new Error("zstd decoder failed to initialise");
  ZstdEx = ex;
  return ex;
}
// Digest a dictionary once and keep it: aces.vromfs needs it for 23 489 separate frames.
function zstdDict(bytes, key){
  const ex = zstdInit();
  if (key && ZstdDicts.has(key)) return ZstdDicts.get(key);
  const p = ex.zdec_malloc(bytes.byteLength);
  if (!p) throw new Error("zstd out of memory");
  new Uint8Array(ex.memory.buffer, p, bytes.byteLength).set(bytes);
  const d = ex.zdec_ddict_new(p, bytes.byteLength);
  ex.zdec_free(p);
  if (!d) throw new Error("zstd rejected the dictionary");
  if (key) ZstdDicts.set(key, d);
  return d;
}
// One zstd frame → its bytes. `ddict` is a handle from zstdDict(), or 0/undefined for none.
// Frames whose header omits the content size (the game writes plenty) decode by growing.
function zstdDec(src, ddict){
  const ex = zstdInit();
  const sp = ex.zdec_malloc(src.byteLength);
  if (!sp) throw new Error("zstd out of memory");
  new Uint8Array(ex.memory.buffer, sp, src.byteLength).set(src);
  const rc = ex.zdec_decompress(ZstdCtx, ddict || 0, sp, src.byteLength, ZstdOut);
  ex.zdec_free(sp);
  if (rc !== 0) throw new Error("zstd decode failed (" + rc + ")");
  // Decoding can grow the wasm memory, which detaches every earlier view — read it back now.
  const dv = new DataView(ex.memory.buffer);
  const p = dv.getUint32(ZstdOut, true), n = dv.getUint32(ZstdOut + 4, true);
  const out = new Uint8Array(ex.memory.buffer, p, n).slice();
  ex.zdec_free(p);
  return out;
}
/*==ENDZSTD==*/
