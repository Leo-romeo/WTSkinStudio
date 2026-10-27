"use strict";
/*==BCNDEC==*/
// One scope per module (ROADMAP 2.3): the body below is private, `BCnDec` — returned at the end — is
// the only name this module puts into the shared scope. Not re-indented; see `codecs/dds.js`.
const BCnDec = (() => {
function c565(v){ return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]; }
// The block decoders below run once per 4×4 texels — a 4096² sheet is a million iterations. They
// used to allocate four short arrays per block (two endpoint triples, two interpolated ones, plus
// a BC4 palette and its 16-entry output), which is where most of this app's garbage-collector time
// came from. Everything is now written into scratch buffers owned by the caller.
const BCN_COLS = new Float64Array(12);                        // 4 palette entries × RGB
function decodeBCn(src, w, h, fmt){
  const out = new Uint8ClampedArray(w * h * 4);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const bs = fmt === "DXT1" ? 8 : 16;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const isDXT1 = fmt === "DXT1", isDXT3 = fmt === "DXT3", isBC5 = fmt === "BC5";
  const hasA = fmt === "DXT5" || isBC5;
  const cols = BCN_COLS;
  const alpha = new Float64Array(16), green = new Float64Array(16), pal = new Float64Array(8);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * bs;
    if (hasA) decodeBC4Into(src, o, alpha, pal);
    if (isBC5) {
      decodeBC4Into(src, o + 8, green, pal);
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx * 4 + px, y = by * 4 + py;
        if (x >= w || y >= h) continue;
        const q = (y * w + x) * 4, t = py * 4 + px;
        out[q] = alpha[t]; out[q+1] = green[t]; out[q+2] = 255; out[q+3] = 255;
      }
      continue;
    }
    const co = isDXT1 ? o : o + 8;
    const c0 = dv.getUint16(co, true), c1 = dv.getUint16(co + 2, true);
    const r0 = ((c0 >> 11) & 31) * 255 / 31, g0 = ((c0 >> 5) & 63) * 255 / 63, b0 = (c0 & 31) * 255 / 31;
    const r1 = ((c1 >> 11) & 31) * 255 / 31, g1 = ((c1 >> 5) & 63) * 255 / 63, b1 = (c1 & 31) * 255 / 31;
    cols[0] = r0; cols[1] = g0; cols[2] = b0;
    cols[3] = r1; cols[4] = g1; cols[5] = b1;
    const opaque = !isDXT1 || c0 > c1;
    if (opaque) {
      cols[6] = (2*r0 + r1) / 3; cols[7]  = (2*g0 + g1) / 3; cols[8]  = (2*b0 + b1) / 3;
      cols[9] = (r0 + 2*r1) / 3; cols[10] = (g0 + 2*g1) / 3; cols[11] = (b0 + 2*b1) / 3;
    } else {
      cols[6] = (r0 + r1) / 2; cols[7] = (g0 + g1) / 2; cols[8] = (b0 + b1) / 2;
      cols[9] = 0; cols[10] = 0; cols[11] = 0;
    }
    const idxBits = dv.getUint32(co + 4, true);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py;
      if (x >= w || y >= h) continue;
      const t = py * 4 + px, ci = ((idxBits >>> (t * 2)) & 3) * 3;
      const q = (y * w + x) * 4;
      out[q] = cols[ci]; out[q+1] = cols[ci+1]; out[q+2] = cols[ci+2];
      if (isDXT1) out[q+3] = (!opaque && ci === 9) ? 0 : 255;
      else if (isDXT3) { const a4 = (dv.getUint16(o + py*2, true) >> (px*4)) & 15; out[q+3] = a4 * 17; }
      else out[q+3] = alpha[t];
    }
  }
  return out;
}
// Writes the block's 16 values into `out` and uses `pal` as scratch — neither is allocated here.
function decodeBC4Into(src, o, out, pal){
  const a0 = src[o], a1 = src[o+1];
  pal[0] = a0; pal[1] = a1;
  if (a0 > a1) for (let i = 1; i <= 6; i++) pal[i + 1] = ((7-i)*a0 + i*a1) / 7;
  else { for (let i = 1; i <= 4; i++) pal[i + 1] = ((5-i)*a0 + i*a1) / 5; pal[6] = 0; pal[7] = 255; }
  for (let half = 0; half < 2; half++) {
    const bits = src[o+2+half*3] | (src[o+3+half*3] << 8) | (src[o+4+half*3] << 16);
    for (let t = 0; t < 8; t++) out[half*8 + t] = pal[(bits >>> (t*3)) & 7];
  }
  return out;
}
function decodeBC4Block(src, o){ return decodeBC4Into(src, o, new Float64Array(16), new Float64Array(8)); }
/* ---- BC7 / BC4 decoders (ported from bcdec.h, MIT, Sergii Kudlai) ---- */
const BC7_PARTITION2 = [
  [[128,0,1,1],[0,0,1,1],[0,0,1,1],[0,0,1,129]],[[128,0,0,1],[0,0,0,1],[0,0,0,1],[0,0,0,129]],[[128,1,1,1],[0,1,1,1],[0,1,1,1],[0,1,1,129]],[[128,0,0,1],[0,0,1,1],[0,0,1,1],[0,1,1,129]],
  [[128,0,0,0],[0,0,0,1],[0,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,1],[0,0,1,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,1],[0,0,1,1],[0,1,1,129]],
  [[128,0,0,0],[0,0,0,0],[0,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[0,0,0,1],[0,1,1,129]],
  [[128,0,0,1],[0,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[1,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[0,0,0,0],[1,1,1,129]],
  [[128,0,0,0],[1,0,0,0],[1,1,1,0],[1,1,1,129]],[[128,1,129,1],[0,0,0,1],[0,0,0,0],[0,0,0,0]],[[128,0,0,0],[0,0,0,0],[129,0,0,0],[1,1,1,0]],[[128,1,129,1],[0,0,1,1],[0,0,0,1],[0,0,0,0]],
  [[128,0,129,1],[0,0,0,1],[0,0,0,0],[0,0,0,0]],[[128,0,0,0],[1,0,0,0],[129,1,0,0],[1,1,1,0]],[[128,0,0,0],[0,0,0,0],[129,0,0,0],[1,1,0,0]],[[128,1,1,1],[0,0,1,1],[0,0,1,1],[0,0,0,129]],
  [[128,0,129,1],[0,0,0,1],[0,0,0,1],[0,0,0,0]],[[128,0,0,0],[1,0,0,0],[129,0,0,0],[1,1,0,0]],[[128,1,129,0],[0,1,1,0],[0,1,1,0],[0,1,1,0]],[[128,0,129,1],[0,1,1,0],[0,1,1,0],[1,1,0,0]],
  [[128,0,0,1],[0,1,1,1],[129,1,1,0],[1,0,0,0]],[[128,0,0,0],[1,1,1,1],[129,1,1,1],[0,0,0,0]],[[128,1,129,1],[0,0,0,1],[1,0,0,0],[1,1,1,0]],[[128,0,129,1],[1,0,0,1],[1,0,0,1],[1,1,0,0]],
  [[128,1,0,1],[0,1,0,1],[0,1,0,1],[0,1,0,129]],[[128,0,0,0],[1,1,1,1],[0,0,0,0],[1,1,1,129]],[[128,1,0,1],[1,0,129,0],[0,1,0,1],[1,0,1,0]],[[128,0,1,1],[0,0,1,1],[129,1,0,0],[1,1,0,0]],
  [[128,0,129,1],[1,1,0,0],[0,0,1,1],[1,1,0,0]],[[128,1,0,1],[0,1,0,1],[129,0,1,0],[1,0,1,0]],[[128,1,1,0],[1,0,0,1],[0,1,1,0],[1,0,0,129]],[[128,1,0,1],[1,0,1,0],[1,0,1,0],[0,1,0,129]],
  [[128,1,129,1],[0,0,1,1],[1,1,0,0],[1,1,1,0]],[[128,0,0,1],[0,0,1,1],[129,1,0,0],[1,0,0,0]],[[128,0,129,1],[0,0,1,0],[0,1,0,0],[1,1,0,0]],[[128,0,129,1],[1,0,1,1],[1,1,0,1],[1,1,0,0]],
  [[128,1,129,0],[1,0,0,1],[1,0,0,1],[0,1,1,0]],[[128,0,1,1],[1,1,0,0],[1,1,0,0],[0,0,1,129]],[[128,1,1,0],[0,1,1,0],[1,0,0,1],[1,0,0,129]],[[128,0,0,0],[0,1,129,0],[0,1,1,0],[0,0,0,0]],
  [[128,1,0,0],[1,1,129,0],[0,1,0,0],[0,0,0,0]],[[128,0,129,0],[0,1,1,1],[0,0,1,0],[0,0,0,0]],[[128,0,0,0],[0,0,129,0],[0,1,1,1],[0,0,1,0]],[[128,0,0,0],[0,1,0,0],[129,1,1,0],[0,1,0,0]],
  [[128,1,1,0],[1,1,0,0],[1,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,0],[1,1,0,0],[1,0,0,129]],[[128,1,129,0],[0,0,1,1],[1,0,0,1],[1,1,0,0]],[[128,0,129,1],[1,0,0,1],[1,1,0,0],[0,1,1,0]],
  [[128,1,1,0],[1,1,0,0],[1,1,0,0],[1,0,0,129]],[[128,1,1,0],[0,0,1,1],[0,0,1,1],[1,0,0,129]],[[128,1,1,1],[1,1,1,0],[1,0,0,0],[0,0,0,129]],[[128,0,0,1],[1,0,0,0],[1,1,1,0],[0,1,1,129]],
  [[128,0,0,0],[1,1,1,1],[0,0,1,1],[0,0,1,129]],[[128,0,129,1],[0,0,1,1],[1,1,1,1],[0,0,0,0]],[[128,0,129,0],[0,0,1,0],[1,1,1,0],[1,1,1,0]],[[128,1,0,0],[0,1,0,0],[0,1,1,1],[0,1,1,129]]];
const BC7_PARTITION3 = [
  [[128,0,1,129],[0,0,1,1],[0,2,2,1],[2,2,2,130]],[[128,0,0,129],[0,0,1,1],[130,2,1,1],[2,2,2,1]],[[128,0,0,0],[2,0,0,1],[130,2,1,1],[2,2,1,129]],[[128,2,2,130],[0,0,2,2],[0,0,1,1],[0,1,1,129]],
  [[128,0,0,0],[0,0,0,0],[129,1,2,2],[1,1,2,130]],[[128,0,1,129],[0,0,1,1],[0,0,2,2],[0,0,2,130]],[[128,0,2,130],[0,0,2,2],[1,1,1,1],[1,1,1,129]],[[128,0,1,1],[0,0,1,1],[130,2,1,1],[2,2,1,129]],
  [[128,0,0,0],[0,0,0,0],[129,1,1,1],[2,2,2,130]],[[128,0,0,0],[1,1,1,1],[129,1,1,1],[2,2,2,130]],[[128,0,0,0],[1,1,129,1],[2,2,2,2],[2,2,2,130]],[[128,0,1,2],[0,0,129,2],[0,0,1,2],[0,0,1,130]],
  [[128,1,1,2],[0,1,129,2],[0,1,1,2],[0,1,1,130]],[[128,1,2,2],[0,129,2,2],[0,1,2,2],[0,1,2,130]],[[128,0,1,129],[0,1,1,2],[1,1,2,2],[1,2,2,130]],[[128,0,1,129],[2,0,0,1],[130,2,0,0],[2,2,2,0]],
  [[128,0,0,129],[0,0,1,1],[0,1,1,2],[1,1,2,130]],[[128,1,1,129],[0,0,1,1],[130,0,0,1],[2,2,0,0]],[[128,0,0,0],[1,1,2,2],[129,1,2,2],[1,1,2,130]],[[128,0,2,130],[0,0,2,2],[0,0,2,2],[1,1,1,129]],
  [[128,1,1,129],[0,1,1,1],[0,2,2,2],[0,2,2,130]],[[128,0,0,129],[0,0,0,1],[130,2,2,1],[2,2,2,1]],[[128,0,0,0],[0,0,129,1],[0,1,2,2],[0,1,2,130]],[[128,0,0,0],[1,1,0,0],[130,2,129,0],[2,2,1,0]],
  [[128,1,2,130],[0,129,2,2],[0,0,1,1],[0,0,0,0]],[[128,0,1,2],[0,0,1,2],[129,1,2,2],[2,2,2,130]],[[128,1,1,0],[1,2,130,1],[129,2,2,1],[0,1,1,0]],[[128,0,0,0],[0,1,129,0],[1,2,130,1],[1,2,2,1]],
  [[128,0,2,2],[1,1,0,2],[129,1,0,2],[0,0,2,130]],[[128,1,1,0],[0,129,1,0],[2,0,0,2],[2,2,2,130]],[[128,0,1,1],[0,1,2,2],[0,1,130,2],[0,0,1,129]],[[128,0,0,0],[2,0,0,0],[130,2,1,1],[2,2,2,129]],
  [[128,0,0,0],[0,0,0,2],[129,1,2,2],[1,2,2,130]],[[128,2,2,130],[0,0,2,2],[0,0,1,2],[0,0,1,129]],[[128,0,1,129],[0,0,1,2],[0,0,2,2],[0,2,2,130]],[[128,1,2,0],[0,129,2,0],[0,1,130,0],[0,1,2,0]],
  [[128,0,0,0],[1,1,129,1],[2,2,130,2],[0,0,0,0]],[[128,1,2,0],[1,2,0,1],[130,0,129,2],[0,1,2,0]],[[128,1,2,0],[2,0,1,2],[129,130,0,1],[0,1,2,0]],[[128,0,1,1],[2,2,0,0],[1,1,130,2],[0,0,1,129]],
  [[128,0,1,1],[1,1,130,2],[2,2,0,0],[0,0,1,129]],[[128,1,0,129],[0,1,0,1],[2,2,2,2],[2,2,2,130]],[[128,0,0,0],[0,0,0,0],[130,1,2,1],[2,1,2,129]],[[128,0,2,2],[1,129,2,2],[0,0,2,2],[1,1,2,130]],
  [[128,0,2,130],[0,0,1,1],[0,0,2,2],[0,0,1,129]],[[128,2,2,0],[1,2,130,1],[0,2,2,0],[1,2,2,129]],[[128,1,0,1],[2,2,130,2],[2,2,2,2],[0,1,0,129]],[[128,0,0,0],[2,1,2,1],[130,1,2,1],[2,1,2,129]],
  [[128,1,0,129],[0,1,0,1],[0,1,0,1],[2,2,2,130]],[[128,2,2,130],[0,1,1,1],[0,2,2,2],[0,1,1,129]],[[128,0,0,2],[1,129,1,2],[0,0,0,2],[1,1,1,130]],[[128,0,0,0],[2,129,1,2],[2,1,1,2],[2,1,1,130]],
  [[128,2,2,2],[0,129,1,1],[0,1,1,1],[0,2,2,130]],[[128,0,0,2],[1,1,1,2],[129,1,1,2],[0,0,0,130]],[[128,1,1,0],[0,129,1,0],[0,1,1,0],[2,2,2,130]],[[128,0,0,0],[0,0,0,0],[2,1,129,2],[2,1,1,130]],
  [[128,1,1,0],[0,129,1,0],[2,2,2,2],[2,2,2,130]],[[128,0,2,2],[0,0,1,1],[0,0,129,1],[0,0,2,130]],[[128,0,2,2],[1,1,2,2],[129,1,2,2],[0,0,2,130]],[[128,0,0,0],[0,0,0,0],[0,0,0,0],[2,129,1,130]],
  [[128,0,0,130],[0,0,0,1],[0,0,0,2],[0,0,0,129]],[[128,2,2,2],[1,2,2,2],[0,2,2,2],[129,2,2,130]],[[128,1,0,129],[2,2,2,2],[2,2,2,2],[2,2,2,130]],[[128,1,1,129],[2,0,1,1],[130,2,0,1],[2,2,2,0]]];
const BC7_W2 = [0,21,43,64], BC7_W3 = [0,9,18,27,37,46,55,64], BC7_W4 = [0,4,9,13,17,21,26,30,34,38,43,47,51,55,60,64];
function bc7Interp(e0, e1, w, i){ return (e0 * (64 - w[i]) + e1 * w[i] + 32) >> 6; }
// ---------- One BC7 block, as the spec's own five steps (ROADMAP 2.4) ----------
// `decodeBC7Block` was 85 lines and read as one: eight modes' worth of field widths, p-bit rules,
// two index sets and a channel rotation, sharing a bit position and six endpoint arrays. The steps
// are the format's own — mode, header, endpoints, indices, texels — and they are methods over one
// context, the same shape `Composite` uses for a region.
//
// **The context is allocated once and reset per block**, not built per call (§3.6): a 4096² sheet
// is a million block iterations, and the version this replaced allocated six endpoint arrays and a
// 16-entry index array on every one of them. The decode pool lifts this section into a worker, so
// each worker has its own instance and nothing is shared across threads.
//
// Byte-identical to what it replaced, which is not a claim but a measurement: `tools/t23_dds.mjs`
// runs the previous revision's section and this one over the same random blocks — random bytes
// walk every mode, both endpoint orderings and every index — and compares byte for byte.
const BC7 = {
  RGBA_BITS: [4, 6, 5, 7, 5, 7, 7, 5],
  ALPHA_BITS: [0, 0, 0, 0, 6, 8, 7, 5],
  HAS_PBITS: 0b11001011,
  cx: {
    src: null, o: 0, bitPos: 0,
    mode: 0, partition: 0, numPartitions: 1, numEndpoints: 2, rotation: 0, indexSelectionBit: 0,
    ib: 0, ib2: 0, weights: null, weights2: null, partTable: null,
    ep: [[0,0,0,0], [0,0,0,0], [0,0,0,0], [0,0,0,0], [0,0,0,0], [0,0,0,0]],
    indices: new Array(16),
  },
  // sequential LSB-first bit reader over the 16-byte block
  rb(cx, n){
    let v = 0;
    for (let i = 0; i < n; i++) {
      v |= ((cx.src[cx.o + (cx.bitPos >> 3)] >> (cx.bitPos & 7)) & 1) << i;
      cx.bitPos++;
    }
    return v;
  },
  // The mode is a unary prefix: the number of zero bits before the first one. Eight zeroes is a
  // block with no mode at all, which the caller fills with transparent black.
  begin(src, o){
    const cx = BC7.cx;
    cx.src = src; cx.o = o; cx.bitPos = 0;
    cx.partition = 0; cx.numPartitions = 1; cx.rotation = 0; cx.indexSelectionBit = 0;
    for (let i = 0; i < 6; i++) { const e = cx.ep[i]; e[0] = e[1] = e[2] = e[3] = 0; }
    let mode = 0;
    while (mode < 8 && BC7.rb(cx, 1) === 0) mode++;
    cx.mode = mode;
    return mode < 8 ? cx : null;
  },
  // Partition, and — for the two modes that have it — the channel rotation and which index set
  // drives alpha.
  header(cx){
    const mode = cx.mode;
    if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) {
      cx.numPartitions = (mode === 0 || mode === 2) ? 3 : 2;
      cx.partition = BC7.rb(cx, mode === 0 ? 4 : 6);
    }
    cx.numEndpoints = cx.numPartitions * 2;
    if (mode === 4 || mode === 5) {
      cx.rotation = BC7.rb(cx, 2);
      if (mode === 4) cx.indexSelectionBit = BC7.rb(cx, 1);
    }
  },
  // The endpoints: colour, then alpha, then the shared or per-endpoint p-bit, then expanded to
  // eight bits by replicating the high bits into the low ones.
  endpoints(cx){
    const mode = cx.mode, ep = cx.ep, n = cx.numEndpoints;
    for (let i = 0; i < 3; i++) for (let j = 0; j < n; j++) ep[j][i] = BC7.rb(cx, BC7.RGBA_BITS[mode]);
    if (BC7.ALPHA_BITS[mode]) for (let j = 0; j < n; j++) ep[j][3] = BC7.rb(cx, BC7.ALPHA_BITS[mode]);
    if (mode === 0 || mode === 1 || mode === 3 || mode === 6 || mode === 7) {
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) ep[i][j] <<= 1;
      if (mode === 1) {
        // mode 1 is the one with a p-bit per PAIR of endpoints rather than per endpoint
        const p0 = BC7.rb(cx, 1), p1 = BC7.rb(cx, 1);
        for (let k = 0; k < 3; k++) { ep[0][k] |= p0; ep[1][k] |= p0; ep[2][k] |= p1; ep[3][k] |= p1; }
      } else if (BC7.HAS_PBITS & (1 << mode)) {
        for (let i = 0; i < n; i++) { const p = BC7.rb(cx, 1); for (let k = 0; k < 4; k++) ep[i][k] |= p; }
      }
    }
    for (let i = 0; i < n; i++) {
      let j = BC7.RGBA_BITS[mode] + ((BC7.HAS_PBITS >> mode) & 1);
      for (let k = 0; k < 3; k++) { ep[i][k] = (ep[i][k] << (8 - j)) & 0xff; ep[i][k] |= ep[i][k] >> j; }
      j = BC7.ALPHA_BITS[mode] + ((BC7.HAS_PBITS >> mode) & 1);
      ep[i][3] = (ep[i][3] << (8 - j)) & 0xff; ep[i][3] |= ep[i][3] >> j;
    }
    if (!BC7.ALPHA_BITS[mode]) for (let j = 0; j < n; j++) ep[j][3] = 0xff;
  },
  // The primary index set. The first texel of each partition carries one bit fewer — the index is
  // known to be in the lower half — which is what the 0x80 flag in the partition tables marks.
  indices(cx){
    const mode = cx.mode;
    cx.ib = (mode === 0 || mode === 1) ? 3 : (mode === 6 ? 4 : 2);
    cx.ib2 = mode === 4 ? 3 : (mode === 5 ? 2 : 0);
    cx.weights = cx.ib === 2 ? BC7_W2 : cx.ib === 3 ? BC7_W3 : BC7_W4;
    cx.weights2 = cx.ib2 === 2 ? BC7_W2 : BC7_W3;
    cx.partTable = cx.numPartitions === 3 ? BC7_PARTITION3 : BC7_PARTITION2;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const ps = cx.numPartitions === 1 ? ((i | j) ? 0 : 128) : cx.partTable[cx.partition][i][j];
      cx.indices[i * 4 + j] = BC7.rb(cx, ps & 0x80 ? cx.ib - 1 : cx.ib);
    }
  },
  // …and the texels. The second index set (modes 4 and 5) is read HERE, texel by texel, because
  // that is where it sits in the bit stream — after all sixteen primary indices.
  texels(cx, out16){
    const ep = cx.ep;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const psRaw = cx.numPartitions === 1 ? ((i | j) ? 0 : 128) : cx.partTable[cx.partition][i][j];
      const ps = psRaw & 0x03;
      const idx = cx.indices[i * 4 + j];
      const a0 = ep[ps*2], a1 = ep[ps*2+1];
      let r, g, b, a;
      if (!cx.ib2) {
        r = bc7Interp(a0[0], a1[0], cx.weights, idx);
        g = bc7Interp(a0[1], a1[1], cx.weights, idx);
        b = bc7Interp(a0[2], a1[2], cx.weights, idx);
        a = bc7Interp(a0[3], a1[3], cx.weights, idx);
      } else {
        const idx2 = BC7.rb(cx, (i | j) ? cx.ib2 : cx.ib2 - 1);
        if (!cx.indexSelectionBit) {
          r = bc7Interp(a0[0], a1[0], cx.weights, idx);
          g = bc7Interp(a0[1], a1[1], cx.weights, idx);
          b = bc7Interp(a0[2], a1[2], cx.weights, idx);
          a = bc7Interp(a0[3], a1[3], cx.weights2, idx2);
        } else {
          r = bc7Interp(a0[0], a1[0], cx.weights2, idx2);
          g = bc7Interp(a0[1], a1[1], cx.weights2, idx2);
          b = bc7Interp(a0[2], a1[2], cx.weights2, idx2);
          a = bc7Interp(a0[3], a1[3], cx.weights, idx);
        }
      }
      if (cx.rotation === 1) { const t = a; a = r; r = t; }
      else if (cx.rotation === 2) { const t = a; a = g; g = t; }
      else if (cx.rotation === 3) { const t = a; a = b; b = t; }
      const q = (i * 4 + j) * 4;
      out16[q] = r; out16[q+1] = g; out16[q+2] = b; out16[q+3] = a;
    }
  },
};
function decodeBC7Block(src, o, out16){
  const cx = BC7.begin(src, o);
  if (!cx) { out16.fill(0); return; }       // a block with no mode at all
  BC7.header(cx);
  BC7.endpoints(cx);
  BC7.indices(cx);
  BC7.texels(cx, out16);
}
function decodeBC7(src, w, h){
  const out = new Uint8ClampedArray(w * h * 4);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const block = new Uint8ClampedArray(64);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    decodeBC7Block(src, (by * bw + bx) * 16, block);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py;
      if (x >= w || y >= h) continue;
      const q = (y * w + x) * 4, t = (py * 4 + px) * 4;
      out[q] = block[t]; out[q+1] = block[t+1]; out[q+2] = block[t+2]; out[q+3] = block[t+3];
    }
  }
  return out;
}
// ATI1/BC4: single channel, replicated to RGB
function decodeBC4Tex(src, w, h){
  const out = new Uint8ClampedArray(w * h * 4);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const vals = new Float64Array(16), pal = new Float64Array(8);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    decodeBC4Into(src, (by * bw + bx) * 8, vals, pal);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py;
      if (x >= w || y >= h) continue;
      const q = (y * w + x) * 4, v = vals[py * 4 + px];
      out[q] = out[q+1] = out[q+2] = v; out[q+3] = 255;
    }
  }
  return out;
}
/* ---- end BC7/BC4 ---- */
return { c565, decodeBCn, decodeBC4Block, decodeBC7Block, decodeBC7, decodeBC4Tex };
})();
/*==ENDBCNDEC==*/
