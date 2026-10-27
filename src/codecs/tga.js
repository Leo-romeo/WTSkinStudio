"use strict";
/*==TGA==*/
// One scope per module (ROADMAP 2.3): the body below is private, `TGA` — returned at the end — is
// the only name this module puts into the shared scope. Not re-indented; see `codecs/dds.js`.
const TGA = (() => {
function parseTGA(buf){
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const idLen = u8[0], type = u8[2];
  const w = dv.getUint16(12, true), h = dv.getUint16(14, true);
  const bpp = u8[16], desc = u8[17];
  if (type !== 2 && type !== 10) throw new Error("Unsupported TGA type " + type);
  if (bpp !== 24 && bpp !== 32) throw new Error("Unsupported TGA bpp " + bpp);
  const bytes = bpp >> 3;
  const out = new Uint8ClampedArray(w * h * 4);
  let p = 18 + idLen;
  const put = (i, b, g, r, a) => { out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = a; };
  let i = 0;
  if (type === 2) {
    for (; i < w * h; i++, p += bytes) put(i, u8[p], u8[p+1], u8[p+2], bytes === 4 ? u8[p+3] : 255);
  } else {
    while (i < w * h) {
      const hdr = u8[p++], cnt = (hdr & 127) + 1;
      if (hdr & 128) { const b = u8[p], g = u8[p+1], r = u8[p+2], a = bytes === 4 ? u8[p+3] : 255; p += bytes;
        for (let k = 0; k < cnt; k++, i++) put(i, b, g, r, a);
      } else for (let k = 0; k < cnt; k++, i++, p += bytes) put(i, u8[p], u8[p+1], u8[p+2], bytes === 4 ? u8[p+3] : 255);
    }
  }
  if (!(desc & 32)) { // bottom-up: flip rows
    const flipped = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) flipped.set(out.subarray(y*w*4, (y+1)*w*4), (h-1-y)*w*4);
    return { width: w, height: h, mips: [{ w, h, rgba: flipped }] };
  }
  return { width: w, height: h, mips: [{ w, h, rgba: out }] };
}
return { parseTGA };
})();
/*==ENDTGA==*/
