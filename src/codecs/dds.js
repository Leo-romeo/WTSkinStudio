/*==DDS==*/
"use strict";
// The directive sits INSIDE the marker, and that is deliberate: DDS leads the section list of
// every worker pool, so a lifted body that starts here is what makes the worker strict too. Every
// other module puts `"use strict"` above its marker, where it governs the script and nothing else.
const DDS_MAGIC = 0x20534444;
// ---- A DDS in two halves: the header arithmetic, and the pixels ----
// These used to be one closure, which meant the only way to decode a level was to parse the whole
// file — and that is exactly what a worker cannot hand back, because structured clone INVOKES
// getters and would force the entire lazy mip chain eagerly (ROADMAP 1.2). Split, the header is
// pure integer work costing nothing, and `ddsDecodeLevel` — the part that touches every texel —
// can run wherever the buffer is. `parseDDS` still behaves exactly as it did.
function ddsInfo(buf){
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== DDS_MAGIC) throw new Error("Not a DDS file");
  const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
  const mipCount = Math.max(1, dv.getUint32(28, true));
  const pfFlags = dv.getUint32(80, true);
  const fourCCn = dv.getUint32(84, true);
  const fourCC = String.fromCharCode(dv.getUint8(84), dv.getUint8(85), dv.getUint8(86), dv.getUint8(87));
  const bitCount = dv.getUint32(88, true);
  const masks = [dv.getUint32(92, true), dv.getUint32(96, true), dv.getUint32(100, true), dv.getUint32(104, true)];
  let off = 128, fmt = null;
  if (pfFlags & 0x4) {
    if (fourCC === "DX10") {
      const dxgi = dv.getUint32(128, true);
      off = 148;
      const map = {71:"DXT1", 72:"DXT1", 74:"DXT3", 75:"DXT3", 77:"DXT5", 78:"DXT5",
        80:"BC4", 83:"BC5", 98:"BC7", 99:"BC7", 87:"BGRA8", 28:"RGBA8"};
      fmt = map[dxgi];
      if (!fmt) throw new Error("Unsupported DXGI format " + dxgi);
    } else if (fourCC === "DXT1" || fourCC === "DXT3" || fourCC === "DXT5") fmt = fourCC;
    else if (fourCC === "ATI2" || fourCC === "BC5U") fmt = "BC5";
    else if (fourCC === "ATI1" || fourCC === "BC4U") fmt = "BC4";
    else throw new Error("Unsupported DDS FourCC: " + fourCC + " (" + fourCCn + ")");
  } else if (bitCount === 32 || bitCount === 24) {
    fmt = "MASKED";
  } else throw new Error("Unsupported uncompressed DDS bit count: " + bitCount);
  const levels = [];
  let w = width, h = height;
  for (let m = 0; m < mipCount && off < buf.byteLength; m++) {
    // size the level first: a truncated file must stop cleanly, not throw a RangeError
    const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
    const bytes = (fmt === "MASKED") ? w * h * (bitCount >> 3)
      : (fmt === "BGRA8" || fmt === "RGBA8") ? w * h * 4
      : bw * bh * ((fmt === "DXT1" || fmt === "BC4") ? 8 : 16);
    if (off + bytes > buf.byteLength) break;
    levels.push({ off, w, h, bytes });
    off += bytes;
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  if (!levels.length) throw new Error("DDS is truncated — no complete mip level (" + width + "×" + height + " " + fmt + ")");
  return { width, height, format: fmt === "MASKED" ? "BGRA8" : fmt, fmt, bitCount, masks, levels };
}
function ddsDecodeLevel(buf, info, i){
  const L = info.levels[i], fmt = info.fmt;
  if (fmt === "MASKED") return decodeMasked(new Uint8Array(buf, L.off, L.bytes), L.w, L.h, info.bitCount, info.masks);
  if (fmt === "BGRA8" || fmt === "RGBA8")
    return decodeMasked(new Uint8Array(buf, L.off, L.bytes), L.w, L.h, 32,
      fmt === "BGRA8" ? [0xff0000, 0xff00, 0xff, 0xff000000] : [0xff, 0xff00, 0xff0000, 0xff000000]);
  const src = new Uint8Array(buf, L.off, L.bytes);
  if (fmt === "BC7") return decodeBC7(src, L.w, L.h);
  if (fmt === "BC4") return decodeBC4Tex(src, L.w, L.h);
  return decodeBCn(src, L.w, L.h, fmt);
}
// Only level 0 is decoded up front. Every reader in the app takes mips[0] and throws the rest
// away, but a full chain is another third of the pixels — 1.4 s of the 4.4 s a skin's BC7 sheets
// used to cost. The smaller levels stay available behind a getter that decodes on first touch and
// caches, so a future reader still works and pays only for what it asks for. `level0` lets a
// caller supply pixels somebody else already decoded (the worker) without changing the shape.
function ddsMips(buf, info, level0){
  return info.levels.map((L, m) => {
    const lvl = { w: L.w, h: L.h };
    if (m === 0) lvl.rgba = level0 || ddsDecodeLevel(buf, info, 0);
    else Object.defineProperty(lvl, "rgba", { configurable: true, enumerable: true, get(){
      const v = ddsDecodeLevel(buf, info, m);
      Object.defineProperty(this, "rgba", { value: v, writable: true, enumerable: true, configurable: true });
      return v;
    } });
    return lvl;
  });
}
function parseDDS(buf){
  const info = ddsInfo(buf);
  return { width: info.width, height: info.height, format: info.format, mips: ddsMips(buf, info, null) };
}
// Wrap already-compressed BCn data in a plain DDS container parseDDS can read back. It lives here,
// beside the reader it is the inverse of, because the decode worker lifts this section by marker
// and builds one of these for every game texture it decodes (ROADMAP 1.2).
function writeBCnDDS(fmt, w, h, data){
  const isDX10 = fmt === "BC7";
  const headLen = 128 + (isDX10 ? 20 : 0);
  const out = new Uint8Array(headLen + data.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, DDS_MAGIC, true);
  dv.setUint32(4, 124, true);
  dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, true); // caps|h|w|pf|linearsize
  dv.setUint32(12, h, true); dv.setUint32(16, w, true);
  dv.setUint32(20, data.byteLength, true);
  dv.setUint32(76, 32, true);
  dv.setUint32(80, 0x4, true); // fourCC
  const cc = isDX10 ? "DX10" : (fmt === "BC5U" ? "ATI2" : fmt);
  for (let i = 0; i < 4; i++) out[84 + i] = cc.charCodeAt(i) || 32;
  dv.setUint32(108, 0x1000, true);
  if (isDX10) {
    dv.setUint32(128, 98, true); // DXGI_FORMAT_BC7_UNORM
    dv.setUint32(132, 3, true);  // TEXTURE2D
    dv.setUint32(140, 1, true);  // arraySize
  }
  out.set(data, headLen);
  return out;
}
function maskShift(m){ let s = 0; if (!m) return {s:0, bits:0}; while (!((m >>> s) & 1)) s++; let b = 0; while ((m >>> (s + b)) & 1) b++; return {s, bits:b}; }
function decodeMasked(src, w, h, bitCount, masks){
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const bpp = bitCount >> 3;
  const ch = masks.map(maskShift);
  // Every channel mask a WT DDS actually uses is a whole byte (B8G8R8A8, R8G8B8A8, B8G8R8), and
  // for those the pixel is a swizzle — no word to rebuild, no shift, no divide, no rounding.
  // The general loop below did all four of those per channel per pixel; on a 4096² sheet that is
  // 67 million iterations of it.
  let swizzle = bpp === 3 || bpp === 4;
  const bi = [0, 0, 0, 0];
  for (let c = 0; c < 4 && swizzle; c++) {
    const { s, bits } = ch[c];
    if (!bits) { bi[c] = -1; continue; }                      // channel absent — 0, or 255 for alpha
    if (bits !== 8 || (s & 7) || (s >> 3) >= bpp) swizzle = false;
    else bi[c] = s >> 3;
  }
  if (swizzle) {
    const b0 = bi[0], b1 = bi[1], b2 = bi[2], b3 = bi[3];
    for (let i = 0, p = 0, q = 0; i < n; i++, p += bpp, q += 4) {
      out[q]     = b0 < 0 ? 0 : src[p + b0];
      out[q + 1] = b1 < 0 ? 0 : src[p + b1];
      out[q + 2] = b2 < 0 ? 0 : src[p + b2];
      out[q + 3] = b3 < 0 ? 255 : src[p + b3];
    }
    return out;
  }
  // Odd packing (565, 5551, 4444…): hoist the per-channel constants out of the pixel loop.
  const sh = new Int32Array(4), mk = new Int32Array(4), sc = new Float64Array(4);
  for (let c = 0; c < 4; c++) {
    const { s, bits } = ch[c];
    sh[c] = s; mk[c] = bits ? (1 << bits) - 1 : 0;
    sc[c] = !bits ? 0 : bits >= 8 ? 1 : 255 / ((1 << bits) - 1);
  }
  for (let i = 0, p = 0, q = 0; i < n; i++, p += bpp, q += 4) {
    let px = 0;
    for (let b = 0; b < bpp; b++) px |= src[p + b] << (8 * b);
    for (let c = 0; c < 4; c++) {
      if (!mk[c]) { out[q + c] = c === 3 ? 255 : 0; continue; }
      const v = (px >>> sh[c]) & mk[c];
      out[q + c] = sc[c] === 1 ? v : Math.round(v * sc[c]);
    }
  }
  return out;
}
/*==ENDDDS==*/
