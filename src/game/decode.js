// ---------- Decoding textures, off the UI thread (ROADMAP 1.2) ----------
// Clicking anything in the game texture browser used to freeze the window: a 4096² BC7 sheet is a
// million block iterations and an 8192² one is four, with an Oodle or zstd decompression in front
// of it. None of that touches the DOM, so all of it moves — and because it moves, a vehicle's
// sheets can decode at pool width instead of one after another.
//
// What stays on this thread is the File I/O (opening the pack, slicing the entry's bytes out of
// it) and the header arithmetic, so an entry that cannot work — tier not downloaded, format this
// build does not read — still fails here, instantly, with the message it always had.
//
// The WASM blobs ride along in `ops` rather than being lifted by a marker. They are `const`s in
// their own <script> tags at the end of the page (src/vendor/*-b64.js), and passing the VALUE
// rather than the marker is what keeps this working when a build swaps one out — which is exactly
// what `tools/build.mjs` does with `--ooz` and `--rad` (a WASM decoder in the Oodle slot) and
// `--no-oodle` (no decoder at all). The default build's Oodle decoder is not a blob at all: it is
// `codecs/wtlz.js`, a section of the page like the codecs, so it is lifted by its marker — but
// only in the build that has it, which is what the section list below reads OODLE_IMPL for.
// Up to a third of a megabyte of base64 for the blobs, depending on which build this is, in a
// Blob built once and shared by every worker in the pool.
let DecodePool = null;
function decodePool(){
  if (DecodePool) return DecodePool;
  DecodePool = makeWorkerPool({
    name: "decode",
    // No BCNENC: a decode worker has no use for the encoders, and since the codecs became separate
    // modules it no longer has to carry them. Every section named here has all of its callees in
    // one of the others — that is the rule a section list has to satisfy, and it is why WTLZ is
    // here exactly when the build carries it: OODLE's Oodle.ensureOodle calls into it in that build, and
    // in the other three builds there is no such section to lift.
    sections: ["DDS", "BCNDEC", "ZSTD", "OODLE"].concat(Oodle.oodleImpl() === "wtlz" ? ["WTLZ"] : []),
    // An absent blob crosses as "" rather than throwing here, so a build without one degrades
    // exactly as the main thread does: Zstd.zstdAvailable()/Oodle.oodleAvailable() say no and the decoder
    // reports "not embedded in this build" (ROADMAP 5.2).
    ops: "var ZSTD_WASM_B64 = " + JSON.stringify(Zstd.zstdAvailable() ? ZSTD_WASM_B64 : "") + ";\n" +
         "var OODLE_WASM_B64 = " + JSON.stringify(Oodle.oodleAvailable() ? OODLE_WASM_B64 : "") + ";\n" +
         // which decoder, not just which bytes — the failure text differs between them and a
         // worker that could not tell would explain a public build's refusal as a corrupt file
         "var OODLE_IMPL = " + JSON.stringify(Oodle.oodleImpl()) + ";\n" + `
var WT_OPS = {
  // One DDSx entry: decompress it, decode its top level, and re-wrap the still-compressed blocks
  // as a plain .dds. Both results cross back as transferables — 67 MB of pixels at 4096².
  gameTexture: async function(a){
    var raw;
    if (a.comp === 0 || a.packedSz === 0) raw = new Uint8Array(a.body);
    else if (a.comp === 0x20) raw = Zstd.zstdDec(new Uint8Array(a.body));
    else if (a.comp === 0x80) raw = new Uint8Array(await new Response(new Blob([a.body]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    else if (a.comp === 0x60) raw = Oodle.oodleDecompress(await Oodle.ensureOodle(), new Uint8Array(a.body), a.memSz);
    else throw new Error(a.compName + "-compressed — not supported yet");
    var fmt = a.fmt, w = a.w, h = a.h;
    var blockBytes = (fmt === "DXT1" || fmt === "ATI1") ? 8 : 16;
    var bcSize = function(ww, hh){ return Math.max(1, (ww + 3) >> 2) * Math.max(1, (hh + 3) >> 2) * blockBytes; };
    var off0 = 0;
    if (a.revMip && a.levels > 1) {   // FLG_REV_MIP_ORDER: smallest mip first, largest last
      for (var l = a.levels - 1; l >= 1; l--) off0 += bcSize(Math.max(1, w >> l), Math.max(1, h >> l));
    }
    // subarray() silently clamps, which would decode garbage instead of reporting a short payload
    var topSize = bcSize(w, h);
    if (off0 + topSize > raw.length) off0 = 0;                      // mip order wasn't what the flag claimed
    if (topSize > raw.length) throw new Error("decompressed to " + raw.length + " bytes, need " + topSize + " for " + w + "×" + h + " " + fmt);
    var top = raw.subarray(off0, off0 + topSize);
    var rgba;
    if (fmt === "BC7") rgba = BCnDec.decodeBC7(top, w, h);
    else if (fmt === "ATI1") rgba = BCnDec.decodeBC4Tex(top, w, h);
    else if (fmt === "ATI2" || fmt === "BC5U") rgba = BCnDec.decodeBCn(top, w, h, "BC5");
    else rgba = BCnDec.decodeBCn(top, w, h, fmt);
    // keep the ORIGINAL compressed mip0 for project embedding (lossless, ~10× smaller than
    // re-encoding to RGBA — an 8192² uhq texture would otherwise cost 256 MB)
    var dds = DDS.writeBCnDDS(fmt, w, h, top);
    return { __t: 1, result: { rgba: rgba.buffer, dds: dds.buffer }, transfer: [rgba.buffer, dds.buffer] };
  },
  // A user-supplied .dds: its header and level 0. The source buffer goes back WITH the result,
  // because the main thread rebuilds the lazy mip chain over it and because every caller keeps
  // the original bytes to embed in the .wtproj. Returning the chain itself is not an option —
  // structured clone invokes getters, which would force every level eagerly.
  // With a.max (ROADMAP 1.26), a file larger than that on either side is held at most that size:
  // its first own mip level that fits, if it ships one, else level 0 fitted by DDS.fitRGBA — here,
  // so the UI thread never holds the full-size pixels. w and h say what came back.
  ddsLevel0: function(a){
    var info = DDS.ddsInfo(a.buf), lvl = 0;
    if (a.max) while (lvl + 1 < info.levels.length && Math.max(info.levels[lvl].w, info.levels[lvl].h) > a.max) lvl++;
    var L = info.levels[lvl], rgba = DDS.ddsDecodeLevel(a.buf, info, lvl);
    var f = a.max ? DDS.fitRGBA(rgba, L.w, L.h, a.max) : { w: L.w, h: L.h, rgba: rgba };
    return { __t: 1, result: { info: info, level0: f.rgba.buffer, buf: a.buf, w: f.w, h: f.h }, transfer: [f.rgba.buffer, a.buf] };
  }
};`,
  });
  return DecodePool;
}
// Read one entry out of its pack and describe it for the worker. Split out of decodeGameEntry so
// a batch can do the reads a chunk at a time — see decodeGameEntries.
async function gameTextureJob(en){
  if (!en.size) throw new Error("no data in this install (tier not downloaded)");
  if (!KNOWN_FMTS.includes(en.fmt)) throw new Error("pixel format " + (GameDB.fmtName(en) || "(unnamed)") + " has no reader in the editor");
  const hd = texHeaderView(en);
  const flags = hd.getUint32(8, true);
  const file = await packFile(en.pack);
  const body = await file.slice(en.off, en.off + en.size).arrayBuffer();
  return { op: "gameTexture", transfer: [body], args: {
    body, comp: (flags >>> 24) & 0xE0, memSz: hd.getUint32(0x18, true), packedSz: hd.getUint32(0x1c, true),
    compName: en.compName, fmt: en.fmt, w: en.w, h: en.h,
    levels: hd.getUint8(0x10) || 1, revMip: !!(flags & 0x40000) } };
}
function gameTextureResult(en, r){
  return { width: en.w, height: en.h, mips: [{ w: en.w, h: en.h, rgba: new Uint8ClampedArray(r.rgba) }],
    fileName: en.stem + ".dds", raw: r.dds, rawName: en.stem + ".dds" };
}
async function decodeGameEntry(en){
  const job = await gameTextureJob(en);
  return gameTextureResult(en, await decodePool().call(job.op, job.args, job.transfer));
}
// Several entries at pool width. The pack reads stay here and are done a chunk at a time on
// purpose: every compressed body in flight at once is hundreds of megabytes, and saturating the
// pool is the whole point — having the entire list queued is not.
// Per-entry failures are returned, not thrown: a vehicle with one unreadable sheet still loads
// the rest, which is what the sequential loops this replaced already did.
async function decodeGameEntries(entries, onDone, isCancelled){
  const pool = decodePool();
  const width = Math.max(1, pool.size);
  const out = new Array(entries.length);
  let done = 0;
  for (let i = 0; i < entries.length; i += width) {
    if (isCancelled && isCancelled()) break;
    const idx = [];
    for (let k = i; k < Math.min(i + width, entries.length); k++) idx.push(k);
    await Promise.all(idx.map(async k => {
      try {
        const job = await gameTextureJob(entries[k]);
        out[k] = { ok: true, dec: gameTextureResult(entries[k], await pool.call(job.op, job.args, job.transfer)) };
      } catch (e) { out[k] = { ok: false, error: e }; }
      done++;
      if (onDone) onDone(done, entries.length, entries[k]);
    }));
  }
  return out;
}
// A user-supplied .dds, decoded in the pool. `buf` is TRANSFERRED and handed back attached to the
// result as `.raw` — the caller must read it from there, not from the variable it passed in.
// `max` (optional): the largest side to hold. A file past it comes back smaller, as one level, with
// `fitFrom` saying the file's own size — `raw` is still the file, byte for byte (ROADMAP 1.26).
async function parseDDSAsync(buf, max){
  const r = await decodePool().call("ddsLevel0", { buf, max: max || 0 }, [buf]);
  const px = new Uint8ClampedArray(r.level0);
  if (r.w !== r.info.width || r.h !== r.info.height)
    return { width: r.w, height: r.h, format: r.info.format, mips: [{ w: r.w, h: r.h, rgba: px }], raw: r.buf,
      fitFrom: { w: r.info.width, h: r.info.height } };
  return { width: r.info.width, height: r.info.height, format: r.info.format,
    mips: DDS.ddsMips(r.buf, r.info, px), raw: r.buf };
}
