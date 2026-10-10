/*==OODLE==*/
// ---- Oodle-format (Kraken/Leviathan) decompressor seam ----
// **Nothing here names a decoder, deliberately.** Which one is behind these four functions is a
// build-time choice, and this file ships in every build. Since 2026-09-14 the default — the one
// build you may give away — carries the project's own decoder, `codecs/wtlz.js` (docs/WTLZ.md):
// plain JavaScript in the page, so there is no module to instantiate and no memory to own, and
// the two branches that route to it are the whole adapter ABI.md asked for. The two decoders it
// replaced survive as diagnostics behind the WASM path below — ooz (GPL-3, `--ooz`) and RAD's
// (`--rad`, never redistributed) — each exporting the same four WASM entry points. The vendored
// slot at the very end of the page says which; `oodleImpl()` reads its answer.
//
// In its own section because the decode worker lifts it by marker (ROADMAP 1.2), so everything in
// here must stay pure and DOM-free. Each worker instantiates its own copy of a WASM module; the
// Blob holding the worker source is built once and shared by the pool.
let OodleExports = null, oodlePromise = null;
// The slot declares both names, so the one guard covers both: a blob means a WASM decoder, and
// "wtlz" means the decoder is a section of the page — either way the build has one.
function oodleAvailable(){ return typeof OODLE_WASM_B64 !== "undefined" && (!!OODLE_WASM_B64 || OODLE_IMPL === "wtlz"); }
// Which decoder this build carries, from the slot's own file: "wtlz" in the build that ships,
// "ooz" or "rad" in the two diagnostics, "" where there is none (CLAUDE.md §0.2). Worth naming in
// a failure, because all three agreed on every payload in the install when last measured
// (docs/WTLZ.md, docs/OODLE.md) — so a refusal from any of them is either damaged data or news.
// Every slot file declares OODLE_IMPL, so this needs no load-order guard (CLAUDE.md §5) — a build
// that reached here without one would be a build assembled wrongly.
function oodleImpl(){ return OODLE_IMPL; }
// Why one entry cannot be decoded, in words a user can act on. A build with no Oodle decoder at
// all is still a deliberate, supported configuration (CLAUDE.md §0.2), and there this accounts for
// most of the game's textures. "Not decodable" would
// make that look like a fault; naming it makes it a limitation, and one with an escape hatch: the
// manual .dds import path reads whatever the user can extract themselves.
// Which cause applies is GameDB.blockKind's call (game/packs.js), so this sentence and the scan's
// counts cannot disagree. A format is named by GameDB.fmtName: "2 is not a texture format" was L8,
// a Direct3D format number printed as text (2026-10-10). Main thread only — the decode worker lifts
// this section but never asks why.
function entryBlockReason(en){
  switch (GameDB.blockKind(en)) {
    case "": return "";
    case "empty": return "no data for this tier";
    case "decoder": return "Oodle-compressed — this build has no Oodle decoder";
    case "comp": return en.compName + " compression is not supported";
    default: return "pixel format " + (GameDB.fmtName(en) || "(unnamed)") + " has no reader in the editor";
  }
}
async function ensureOodle(){
  if (OodleExports) return OodleExports;
  if (!oodleAvailable()) throw new Error("Oodle decoder not embedded in this build");
  // The project's own decoder is already in scope — on this thread as a section of the page, in a
  // worker because the pool lifts WTLZ alongside this section (game/decode.js). Nothing to
  // compile, nothing to allocate: the object with the one method is the "exports".
  if (oodleImpl() === "wtlz") return (OodleExports = WTLZ);
  if (!oodlePromise) oodlePromise = (async () => {
    const b64 = OODLE_WASM_B64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const module = await WebAssembly.compile(bytes);
    const stub = () => 52; // WASI ENOSYS — the decode path never calls these
    const inst = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: new Proxy({}, { get: () => stub }),
    });
    const ex = inst.exports;
    if (ex.oodle_init && ex.oodle_init() !== 0) throw new Error("Oodle WASM failed to initialise");
    OodleExports = ex;
    return ex;
  })();
  return oodlePromise;
}
// A WASM decoder in this family may write a little past the end of the output while copying its
// last match — ooz says so explicitly (SAFE_SPACE = 64) and its own tool over-allocates for it.
// Sixty-four bytes on a buffer that is routinely 85 MB, versus a second padded buffer and a copy
// back, which would double peak WASM memory *per worker* and never give it back (CLAUDE.md §3.8).
// The project's own decoder writes into a Uint8Array of exactly rawSize and returns that array —
// no slack, no copy out of a heap, and JavaScript's bounds checks are its memory safety.
const OODLE_DST_SLACK = 64;
function oodleDecompress(ex, data, rawSize){
  // What a refusal means, in the words a bug report needs. The decoder in the shipped build matched
  // the reference on every compressed payload in a full install when last measured (141 898 of
  // 141 898 textures and 24 622 of 24 622 model streams, docs/WTLZ.md), so a refusal is either a
  // damaged file or news — and there is no way to tell them apart here. Say so, and say which
  // decoder it was: that plus the vehicle's name is the whole report.
  function oodleRefusal(detail){
    const impl = oodleImpl();
    return "Oodle decompress failed (" + detail + ")" +
      (impl === "wtlz"
        ? " — this build uses the project's own decoder, which matched the reference on every payload"
          + " in a full install when last measured. So this is either a damaged file or worth"
          + " reporting, with the vehicle's name."
        : impl === "ooz"
        ? " — this build uses the open-source ooz decoder, which matched RAD's on every payload in a"
          + " full install when last measured. So this is either a damaged file or worth reporting,"
          + " with the vehicle's name."
        : "");
  }
  if (oodleImpl() === "wtlz") {
    // It throws on anything it cannot decode completely and correctly, and never returns short,
    // padded or guessed output (docs/WTLZ.md) — so the only thing to add is what the failure means.
    try { return ex.decompress(data, rawSize); }
    catch (e) { throw new Error(oodleRefusal(e && e.message)); }
  }
  const src = ex.oodle_malloc(data.byteLength);
  const dst = ex.oodle_malloc(rawSize + OODLE_DST_SLACK);
  if (!src || !dst) throw new Error("Oodle WASM out of memory");
  try {
    new Uint8Array(ex.memory.buffer, src, data.byteLength).set(data);
    const written = ex.oodle_decompress(src, data.byteLength, dst, rawSize);
    // -1 only means "refused"; from here the cause could be damaged data or a stream this
    // decoder cannot read.
    if (written !== rawSize) throw new Error(oodleRefusal(written + "/" + rawSize));
    return new Uint8Array(ex.memory.buffer, dst, rawSize).slice();
  } finally { ex.oodle_free(src); ex.oodle_free(dst); }
}
/*==ENDOODLE==*/
