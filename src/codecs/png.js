"use strict";
/*==PNG==*/
// A PNG writer over the bytes (ROADMAP 4.59). One scope per module (ROADMAP 2.3): `PNG` is the only
// name this module puts into the shared scope.
//
// Why not `canvas.toBlob`: a canvas premultiplies alpha, and a packed `_n` keeps normal X in alpha
// (wt-formats), so wherever Y is low its R, G and B round away — measured in t161, where the same
// 64 × 32 texels lose colour through a canvas and come back exact through this. 8-bit RGBA,
// non-interlaced, one IDAT; deflate is the browser's own `CompressionStream("deflate")`, which emits
// the zlib stream PNG wants, offline and in a worker. Each row takes the filter whose residuals sum
// smallest — the usual heuristic, and on a decoded game sheet worth roughly a third of the file.
const PNG = (() => {
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(b, s, e){
  let c = 0xffffffff;
  for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Filtered scanlines: a filter-type byte, then the row's residuals. Types 0 None, 1 Sub, 2 Up,
// 4 Paeth; Average (3) rarely wins and is left out.
function filterRows(px, w, h){
  const st = w * 4, out = new Uint8Array((st + 1) * h);
  const zero = new Uint8Array(st);
  for (let y = 0; y < h; y++) {
    const r = y * st, u = y ? r - st : -1;
    let s0 = 0, s1 = 0, s2 = 0, s4 = 0;
    for (let x = 0; x < st; x++) {
      const v = px[r + x], a = x >= 4 ? px[r + x - 4] : 0, b = u >= 0 ? px[u + x] : 0, c = x >= 4 && u >= 0 ? px[u + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const d0 = v, d1 = (v - a) & 255, d2 = (v - b) & 255, d4 = (v - pr) & 255;
      s0 += d0 < 128 ? d0 : 256 - d0; s1 += d1 < 128 ? d1 : 256 - d1; s2 += d2 < 128 ? d2 : 256 - d2; s4 += d4 < 128 ? d4 : 256 - d4;
    }
    let t = 0, best = s0;
    if (s1 < best) { t = 1; best = s1; }
    if (s2 < best) { t = 2; best = s2; }
    if (s4 < best) { t = 4; }
    const o = y * (st + 1);
    out[o] = t;
    const prev = u >= 0 ? px.subarray(u, u + st) : zero;
    for (let x = 0; x < st; x++) {
      const v = px[r + x], a = x >= 4 ? px[r + x - 4] : 0, b = prev[x];
      let pr = 0;
      if (t === 1) pr = a;
      else if (t === 2) pr = b;
      else if (t === 4) { const c = x >= 4 ? prev[x - 4] : 0, p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + 1 + x] = (v - pr) & 255;
    }
  }
  return out;
}
async function deflate(bytes){
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function chunk(type, data){
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
// rgba: w × h × 4 bytes, straight (unpremultiplied) alpha, top row first. Resolves to the file.
async function encode(rgba, w, h){
  const px = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  if (px.length !== w * h * 4) throw new Error("PNG: " + px.length + " bytes is not " + w + " × " + h + " RGBA");
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;                                        // 8 bits per channel, RGBA
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(filterRows(px, w, h))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
return { encode, crc32 };
})();
/*==ENDPNG==*/
