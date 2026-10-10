"use strict";
/*==BCNENC==*/
// Level 0 is the sheet the user authored and is passed through untouched — `mips[0].rgba` IS the
// caller's array, not a copy. Only the levels generated here are renormalised, because box-filtering
// two opposing normals shortens the result and that is the error being corrected; the authored
// pixels are not ours to rewrite. That split is the standard practice (renormalise per generated
// level, leave the source alone) and is asserted both ways in tools/t29_encode.mjs. The CDK wiki
// says nothing about mip chains at all — checked 2026-08-04 — and War Thunder accepts a skin with
// no mip chain, which is what the game's own extracted textures ship.
function buildMips(rgba, w, h, renorm){
  const mips = [{ w, h, rgba }];
  let cw = w, ch = h, cur = rgba;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const nxt = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const x0 = Math.min(x*2, cw-1), x1 = Math.min(x*2+1, cw-1);
      const y0 = Math.min(y*2, ch-1), y1 = Math.min(y*2+1, ch-1);
      for (let c = 0; c < 4; c++) {
        nxt[(y*nw+x)*4+c] = (cur[(y0*cw+x0)*4+c] + cur[(y0*cw+x1)*4+c] + cur[(y1*cw+x0)*4+c] + cur[(y1*cw+x1)*4+c] + 2) >> 2;
      }
    }
    if (renorm) renormalizeWTNormal(nxt);
    mips.push({ w:nw, h:nh, rgba:nxt });
    cw = nw; ch = nh; cur = nxt;
  }
  return mips;
}
function renormalizeWTNormal(rgba){
  for (let i = 0; i < rgba.length; i += 4) {
    let x = rgba[i+1] / 127.5 - 1, y = rgba[i+3] / 127.5 - 1;
    const d2 = x*x + y*y;
    if (d2 > 1) { const d = Math.sqrt(d2); x /= d; y /= d; }
    rgba[i+1] = Math.round((x + 1) * 127.5);
    rgba[i+3] = Math.round((y + 1) * 127.5);
  }
}
function writeDDS(mips, opts){
  const fmt = opts && opts.bc3 ? "DXT5" : "BGRA8";
  const w = mips[0].w, h = mips[0].h;
  const chunks = [];
  let total = 0;
  for (const m of mips) {
    let data;
    if (fmt === "DXT5") data = encodeBC3(m.rgba, m.w, m.h);
    else {
      data = new Uint8Array(m.w * m.h * 4);
      for (let i = 0; i < m.w * m.h; i++) {
        data[i*4] = m.rgba[i*4+2]; data[i*4+1] = m.rgba[i*4+1];
        data[i*4+2] = m.rgba[i*4]; data[i*4+3] = m.rgba[i*4+3];
      }
    }
    chunks.push(data); total += data.byteLength;
  }
  const head = new ArrayBuffer(128);
  const dv = new DataView(head);
  dv.setUint32(0, DDS_MAGIC, true);
  dv.setUint32(4, 124, true);
  let flags = 0x1 | 0x2 | 0x4 | 0x1000;
  if (mips.length > 1) flags |= 0x20000;
  flags |= fmt === "DXT5" ? 0x80000 : 0x8;
  dv.setUint32(8, flags, true);
  dv.setUint32(12, h, true); dv.setUint32(16, w, true);
  dv.setUint32(20, fmt === "DXT5" ? Math.max(1,(w+3)>>2) * Math.max(1,(h+3)>>2) * 16 : w * 4, true);
  dv.setUint32(28, mips.length > 1 ? mips.length : 0, true);
  dv.setUint32(76, 32, true);
  if (fmt === "DXT5") {
    dv.setUint32(80, 0x4, true);
    dv.setUint8(84, 68); dv.setUint8(85, 88); dv.setUint8(86, 84); dv.setUint8(87, 53);
  } else {
    dv.setUint32(80, 0x41, true);
    dv.setUint32(88, 32, true);
    dv.setUint32(92, 0xff0000, true); dv.setUint32(96, 0xff00, true);
    dv.setUint32(100, 0xff, true); dv.setUint32(104, 0xff000000, true);
  }
  let caps = 0x1000;
  if (mips.length > 1) caps |= 0x8 | 0x400000;
  dv.setUint32(108, caps, true);
  const out = new Uint8Array(128 + total);
  out.set(new Uint8Array(head), 0);
  let p = 128;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}
function encodeBC3(rgba, w, h){
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const out = new Uint8Array(bw * bh * 16);
  const px = new Uint8Array(64);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let py = 0; py < 4; py++) for (let pxi = 0; pxi < 4; pxi++) {
      const sx = Math.min(bx*4 + pxi, w - 1), sy = Math.min(by*4 + py, h - 1);
      const s = (sy * w + sx) * 4, d = (py * 4 + pxi) * 4;
      px[d] = rgba[s]; px[d+1] = rgba[s+1]; px[d+2] = rgba[s+2]; px[d+3] = rgba[s+3];
    }
    const o = (by * bw + bx) * 16;
    encodeBC4AlphaBlock(px, out, o);
    encodeBC1ColorBlock(px, out, o + 8);
  }
  return out;
}
function encodeBC4AlphaBlock(px, out, o){
  let mn = 255, mx = 0;
  for (let i = 0; i < 16; i++) { const a = px[i*4+3]; if (a < mn) mn = a; if (a > mx) mx = a; }
  if (mn === mx) { out[o] = mx; out[o+1] = mx; for (let i = 2; i < 8; i++) out[o+i] = 0; return; }
  out[o] = mx; out[o+1] = mn;
  const pal = [mx, mn];
  for (let i = 1; i <= 6; i++) pal.push(((7-i)*mx + i*mn) / 7);
  let bits = 0n;
  for (let i = 0; i < 16; i++) {
    const a = px[i*4+3];
    let best = 0, bd = 1e9;
    for (let j = 0; j < 8; j++) { const d = Math.abs(pal[j] - a); if (d < bd) { bd = d; best = j; } }
    bits |= BigInt(best) << BigInt(i * 3);
  }
  for (let i = 0; i < 6; i++) out[o+2+i] = Number((bits >> BigInt(i*8)) & 0xffn);
}
function to565(r, g, b){ return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); }
function from565(v){ return c565(v); }
// Endpoints along the block's PRINCIPAL COLOUR AXIS, not its luminance extremes.
//
// Luminance extremes are the two texels that happen to be darkest and brightest, which only span
// the colour cloud when the block holds one hue ramp. A decal edge keyed out of a background holds
// THREE — the base texture, the marking, and the leftover halo of the removed background — and then
// the darkest and brightest texels can sit anywhere in it. Measured on a red marking with a black
// halo over olive camo: worst channel error 106 with luminance endpoints, 66 along the principal
// axis. Covariance is accumulated once and the axis found by power iteration on the 3x3, so the
// extra cost is per block, not per texel.
//
// This narrows the error; it does not remove it. BC1 has four colours on ONE line per 4x4 block and
// a three-hue block is not on a line, so the base beside a marking still pulls toward the marking's
// colour (olive 110,120,82 decoding as 195,90,80 in the worst case here). That is a property of the
// format, which is why hard-edged markings want the lossless export preset — see docs/GUIDE.md.
function encodeBC1ColorBlock(px, out, o){
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 16; i++) { mr += px[i*4]; mg += px[i*4+1]; mb += px[i*4+2]; }
  mr /= 16; mg /= 16; mb /= 16;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < 16; i++) {
    const dr = px[i*4] - mr, dg = px[i*4+1] - mg, db = px[i*4+2] - mb;
    xx += dr*dr; xy += dr*dg; xz += dr*db; yy += dg*dg; yz += dg*db; zz += db*db;
  }
  let ax = 1, ay = 1, az = 1;
  for (let it = 0; it < 6; it++) {
    const nx = xx*ax + xy*ay + xz*az, ny = xy*ax + yy*ay + yz*az, nz = xz*ax + yz*ay + zz*az;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) break;                                   // flat block: any axis will do
    ax = nx/L; ay = ny/L; az = nz/L;
  }
  let lo = 1e30, hi = -1e30, mnI = 0, mxI = 0;
  for (let i = 0; i < 16; i++) {
    const d = (px[i*4]-mr)*ax + (px[i*4+1]-mg)*ay + (px[i*4+2]-mb)*az;
    if (d < lo) { lo = d; mnI = i; }
    if (d > hi) { hi = d; mxI = i; }
  }
  let c0 = to565(px[mxI*4], px[mxI*4+1], px[mxI*4+2]);
  let c1 = to565(px[mnI*4], px[mnI*4+1], px[mnI*4+2]);
  if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
  if (c0 === c1 && c0 < 0xffff) c0++;
  out[o] = c0 & 255; out[o+1] = c0 >> 8; out[o+2] = c1 & 255; out[o+3] = c1 >> 8;
  const p0 = from565(c0), p1 = from565(c1);
  const cols = [p0, p1, [(2*p0[0]+p1[0])/3, (2*p0[1]+p1[1])/3, (2*p0[2]+p1[2])/3], [(p0[0]+2*p1[0])/3, (p0[1]+2*p1[1])/3, (p0[2]+2*p1[2])/3]];
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0, bd = 1e9;
    for (let j = 0; j < 4; j++) {
      const dr = cols[j][0]-px[i*4], dg = cols[j][1]-px[i*4+1], db = cols[j][2]-px[i*4+2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bd) { bd = d; best = j; }
    }
    bits |= best << (i * 2);
  }
  out[o+4] = bits & 255; out[o+5] = (bits >>> 8) & 255; out[o+6] = (bits >>> 16) & 255; out[o+7] = (bits >>> 24) & 255;
}
/*==ENDBCNENC==*/
