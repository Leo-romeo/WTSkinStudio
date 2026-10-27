/*==DDS==*/
"use strict";
// The directive sits INSIDE the marker, and that is deliberate: DDS leads the section list of
// every worker pool, so a lifted body that starts here is what makes the worker strict too. Every
// other module puts `"use strict"` above its marker, where it governs the script and nothing else.
// ---- One scope per module (ROADMAP 2.3, decided A 2026-10-21) ----
// Everything below is this module's own: the IIFE gives it a scope of its own, and the object it
// returns at the end — `DDS` — is the one name it puts into the page's shared scope. A caller says
// `DDS.parseDDS(buf)`. The body is deliberately NOT re-indented, so a line's history still reads as
// it did, and the names inside are the names they always had, so a grep for `parseDDS` still finds
// every use. The pools lift this section by its marker exactly as before: in a worker it defines
// `DDS` the same way, and the pools' ops call through it. `codecs/` was the first layer converted
// because it is pure, DOM-free and what the pools lift (2.3's order); `codecs/wtlz.js` was already
// one namespace, `WTLZ`, and is never edited here (CLAUDE.md §0.2).
const DDS = (() => {
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
  if (fmt === "BC7") return BCnDec.decodeBC7(src, L.w, L.h);
  if (fmt === "BC4") return BCnDec.decodeBC4Tex(src, L.w, L.h);
  return BCnDec.decodeBCn(src, L.w, L.h, fmt);
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
// `s + b < 32` is the bound: a shift wraps at 32, so for a crafted 0xFFFFFFFF mask `m >>> 32` is `m`
// again and the count never ended — on the main thread and in the decode pool (ROADMAP 1.21 (1), t23).
function maskShift(m){ let s = 0; if (!m) return {s:0, bits:0}; while (!((m >>> s) & 1)) s++; let b = 0; while (s + b < 32 && (m >>> (s + b)) & 1) b++; return {s, bits:b}; }
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
// Fit RGBA pixels inside `max` on their longer side, aspect kept, each output texel the area-weighted
// mean of the source texels its footprint covers (a box filter that handles a fractional ratio, so
// 12 800 → 8192 weighs each source texel by how much of it falls in the footprint). Pixels that
// already fit come back untouched. Built for ROADMAP 1.26: a UserSkin shipped `empty_glass` as a
// 12 800² DXT5 — 655 MB as pixels, past the largest sheet the editor holds (8192) — and every step
// after the decode (the slot's canvases, its composite, its upload) scaled with that area. Streams one
// output row at a time, so its scratch is one source row of sums, not a second copy of the sheet.
function fitRGBA(rgba, w, h, max){
  if (w <= max && h <= max) return { w, h, rgba };
  const s = Math.max(w, h) / max;
  const dw = Math.max(1, Math.min(max, Math.round(w / s))), dh = Math.max(1, Math.min(max, Math.round(h / s)));
  const fx = w / dw, fy = h / dh, norm = 1 / (fx * fy);
  const out = new Uint8ClampedArray(dw * dh * 4), row = new Float64Array(w * 4);
  for (let y = 0; y < dh; y++) {
    const a = y * fy, b = Math.min(h, (y + 1) * fy);
    row.fill(0);
    for (let j = Math.floor(a); j < b; j++) {
      const wy = Math.min(j + 1, b) - Math.max(j, a), o = j * w * 4;
      for (let i = 0; i < w * 4; i++) row[i] += rgba[o + i] * wy;
    }
    for (let x = 0; x < dw; x++) {
      const c = x * fx, d = Math.min(w, (x + 1) * fx);
      let r = 0, g = 0, bl = 0, al = 0;
      for (let i = Math.floor(c); i < d; i++) {
        const wx = Math.min(i + 1, d) - Math.max(i, c), q = i * 4;
        r += row[q] * wx; g += row[q + 1] * wx; bl += row[q + 2] * wx; al += row[q + 3] * wx;
      }
      const p = (y * dw + x) * 4;
      out[p] = r * norm; out[p + 1] = g * norm; out[p + 2] = bl * norm; out[p + 3] = al * norm;   // a clamped array rounds
    }
  }
  return { w: dw, h: dh, rgba: out };
}
return { DDS_MAGIC, ddsInfo, ddsDecodeLevel, ddsMips, parseDDS, writeBCnDDS, maskShift, decodeMasked, fitRGBA };
})();
/*==ENDDDS==*/
