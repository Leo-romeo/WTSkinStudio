/*==PSD==*/
"use strict";
// ---------- Photoshop's PSD, as far as a skin's layers need it (ROADMAP 4.50 (16)) ----------
// The half of the layered interchange that Photoshop and Paint.NET users need: neither opens an
// OpenRaster file. Bytes in and bytes out, nothing else — no DOM, no canvas, no app state — because
// the pixel half runs in a worker (the PackBits coding is codec work, CLAUDE.md §3.1), and a section
// a pool lifts has to be pure (CLAUDE.md §2). The layout is Adobe's public "Photoshop File Formats
// Specification"; what this reader was measured against is Photoshop's own files (ROADMAP_DONE
// 4.50p, and `t101 --install`).
//
// The parts a layer stack needs, all big-endian:
//   header       '8BPS', version (1 PSD, 2 PSB), channels, height, width, depth, colour mode
//   two sections this never reads (colour-mode data, image resources) — skipped by their lengths
//   layer and mask information
//     layer info: a signed layer count (negative = the merged image carries an alpha), one RECORD
//     per layer — bottom layer FIRST — then every layer's channel data in the same order. A record
//     is the layer's bounds, its channel table (id -1 alpha, 0-2 R G B, -2 the layer mask), a blend
//     key, opacity 0-255, clipping, flags (bit 1 = hidden), the mask's own bounds and default, a
//     Pascal name and tagged blocks: `luni` the real (UTF-16) name, `lsct` a group marker, `iOpa`
//     the fill opacity. A GROUP is two records around its children: a divider (`lsct` 3) below
//     them and the folder (`lsct` 1 or 2, carrying the group's name, opacity and blend) above.
//     16-bit files keep all of this in an `Lr16` block at the end of the section instead.
//   image data   the merged composite Photoshop flattened the layers to — compression, then planes;
//                where it is transparent its colour is matted on white (`unmatte`)
// A channel is a compression word and its pixels: 0 raw, 1 PackBits with one byte count per row
// (2 bytes each, 4 in a PSB), 2 and 3 zlib — which is what 16-bit files use, and is refused by name.
const Psd = {
  MIME: "image/vnd.adobe.photoshop",
  // The blend keys whose formulas the compositor has, by the W3C name the canvas uses. Photoshop's
  // soft light is a slightly different curve from the W3C one; every other entry is the same
  // formula. `lddg` is Linear Dodge (Add), canvas's `lighter` — the same sum, but not the same FADE:
  // canvas scales the source inside the sum, min(1, b + a·s), where Photoshop lerps the clamped sum by
  // the layer's opacity, b + a·(min(1, b + s) − b). They agree until the sum clips, and past it a
  // layer of 128 at 50 % over 204 is 255 here and 230 there (the review of 4.50 (16), 2026-09-27), so
  // a Linear Dodge below full opacity is named both ways (`Interchange.saidOut`, `.saidIn`).
  BLEND: { norm: "normal", "mul ": "multiply", scrn: "screen", over: "overlay", sLit: "soft-light", hLit: "hard-light",
           dark: "darken", lite: "lighten", "div ": "color-dodge", idiv: "color-burn", diff: "difference", smud: "exclusion",
           "hue ": "hue", "sat ": "saturation", colr: "color", "lum ": "luminosity", lddg: "lighter" },
  // Photoshop's own name for the keys it has and the compositor has not, for the report.
  NAMES: { diss: "Dissolve", lbrn: "Linear Burn", dkCl: "Darker Color", lgCl: "Lighter Color", vLit: "Vivid Light",
           lLit: "Linear Light", pLit: "Pin Light", hMix: "Hard Mix", fsub: "Subtract", fdiv: "Divide" },
  // Tagged blocks that make a layer an adjustment or a generated fill: no pixels of its own.
  ADJUST: ["levl", "curv", "brit", "hue2", "hue ", "blnc", "blwh", "phfl", "mixr", "clrL", "nvrt", "post", "thrs",
           "grdm", "selc", "expA", "vibA", "CgEd", "GdFl", "PtFl", "SoCo"],
  // Blocks whose length is 8 bytes in a PSB rather than 4.
  WIDE: ["LMsk", "Lr16", "Lr32", "Layr", "Mt16", "Mt32", "Mtrn", "Alph", "FMsk", "lnk2", "FEid", "FXid", "PxSD"],
  keyOf(blend){
    if (blend === "pass through") return "pass";
    for (const k in Psd.BLEND) if (Psd.BLEND[k] === blend) return k;
    return null;
  },
  blendOf(key){
    if (Psd.BLEND[key]) return { blend: Psd.BLEND[key] };
    if (key === "pass") return { blend: "pass through" };
    return { blend: "normal", lost: Psd.NAMES[key] || "'" + key + "'" };
  },

  // ---- bytes ----
  u16(b, o){ return (b[o] << 8) | b[o + 1]; },
  i16(b, o){ const v = (b[o] << 8) | b[o + 1]; return v & 0x8000 ? v - 0x10000 : v; },
  u32(b, o){ return b[o] * 16777216 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; },
  i32(b, o){ return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; },
  u64(b, o){ return Psd.u32(b, o) * 4294967296 + Psd.u32(b, o + 4); },
  str(b, o, n){ let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; },
  // Does a tagged block start here? A PSB writes '8B64' for some of them.
  sig(b, o){ const s = Psd.str(b, o, 4); return s === "8BIM" || s === "8B64"; },

  // ---- in: the structure (main thread — header arithmetic, no pixels) ----
  read(b){
    if (b.length < 26 || Psd.str(b, 0, 4) !== "8BPS") throw new Error("not a Photoshop file (it does not start with 8BPS)");
    const version = Psd.u16(b, 4);
    if (version !== 1 && version !== 2) throw new Error("PSD version " + version + " — only 1 (PSD) and 2 (PSB) exist");
    const psb = version === 2;
    const doc = { psb, channels: Psd.u16(b, 12), h: Psd.u32(b, 14), w: Psd.u32(b, 18), depth: Psd.u16(b, 22), mode: Psd.u16(b, 24),
                  layers: [], mergedAlpha: false };
    let o = 26;
    o += 4 + Psd.u32(b, o);                                 // colour-mode data
    o += 4 + Psd.u32(b, o);                                 // image resources
    const len = psb ? Psd.u64(b, o) : Psd.u32(b, o);
    o += psb ? 8 : 4;
    const end = o + len;
    if (end > b.length) throw new Error("the file is cut short (its layer section runs past the end)");
    if (len > 0) {
      const li = psb ? Psd.u64(b, o) : Psd.u32(b, o);
      o += psb ? 8 : 4;
      if (li > 0) Psd.layerInfo(b, o, doc);
      o += li;
      if (o + 4 <= end) o += 4 + Psd.u32(b, o);             // global layer mask info
      if (!doc.layers.length) Psd.globalBlocks(b, o, end, doc);
    }
    doc.merged = end;                                       // the image data section
    return doc;
  },
  layerInfo(b, o, doc){
    let n = Psd.i16(b, o);
    o += 2;
    doc.mergedAlpha = n < 0;
    n = Math.abs(n);
    const recs = [];
    for (let i = 0; i < n; i++) { const r = Psd.record(b, o, doc); recs.push(r); o = r.next; }
    for (const r of recs) for (const c of r.chans) { c.off = o; o += c.len; }   // then the pixels, in record order
    doc.layers = recs;
  },
  // A 16- or 32-bit file's layers, in the tagged blocks at the end of the layer section. Those blocks
  // are padded to a multiple of FOUR, not the two a layer record's are, and the pad is not in the
  // length — which is how psd-tools reads Photoshop's own files; not measured here, because no file on
  // this machine has a block before its layers (2026-09-27). Stepping over whatever pad lies before
  // the next signature, as `record` does, reads a pad of one, two or three, counted or not. Taking the
  // pad to be `len & 1`, as the first version did, lost every layer behind a block of 4k + 2 bytes
  // without a word: the file came in as its flattened picture, one layer (`t101`'s "deep4").
  globalBlocks(b, o, end, doc){
    while (o + 12 <= end) {
      if (!Psd.sig(b, o)) return;
      const key = Psd.str(b, o + 4, 4), wide = doc.psb && Psd.WIDE.includes(key);
      const len = wide ? Psd.u64(b, o + 8) : Psd.u32(b, o + 8), d = o + (wide ? 16 : 12);
      if (key === "Lr16" || key === "Lr32" || key === "Layr") { Psd.layerInfo(b, d, doc); return; }
      o = d + len;
      for (let k = 0; k < 3 && o < end && !Psd.sig(b, o); k++) o++;
    }
  },
  record(b, o, doc){
    const r = { top: Psd.i32(b, o), left: Psd.i32(b, o + 4), bottom: Psd.i32(b, o + 8), right: Psd.i32(b, o + 12), chans: [] };
    o += 16;
    const nc = Psd.u16(b, o);
    o += 2;
    for (let i = 0; i < nc; i++) {
      r.chans.push({ id: Psd.i16(b, o), len: doc.psb ? Psd.u64(b, o + 2) : Psd.u32(b, o + 2) });
      o += doc.psb ? 10 : 6;
    }
    if (Psd.str(b, o, 4) !== "8BIM") throw new Error("a layer record is malformed (no blend signature at byte " + o + ")");
    r.key = Psd.str(b, o + 4, 4); r.opacity = b[o + 8]; r.clipping = b[o + 9]; r.hidden = !!(b[o + 10] & 2);
    o += 12;
    const xEnd = o + 4 + Psd.u32(b, o);
    o += 4;
    const mLen = Psd.u32(b, o);
    if (mLen >= 18) Psd.maskData(b, o + 4, mLen, r);
    o += 4 + mLen;
    const rLen = Psd.u32(b, o);
    r.blendIf = Psd.blendIf(b, o + 4, rLen);
    o += 4 + rLen;
    const nl = b[o];
    r.name = Psd.str(b, o + 1, nl);
    o += (nl + 4) & ~3;                                     // a Pascal string padded to 4, its length byte included
    r.keys = [];
    while (o + 12 <= xEnd) {
      if (!Psd.sig(b, o)) break;
      const key = Psd.str(b, o + 4, 4), wide = doc.psb && Psd.WIDE.includes(key);
      const len = wide ? Psd.u64(b, o + 8) : Psd.u32(b, o + 8), d = o + (wide ? 16 : 12);
      Psd.tag(b, d, len, key, r);
      r.keys.push(key);
      o = d + len;
      // Block data is padded to an even length and some writers do not count the pad: step over it.
      for (let k = 0; k < 3 && o < xEnd && !Psd.sig(b, o); k++) o++;
    }
    r.next = xEnd;
    return r;
  },
  // A layer's mask data: its bounds, the value it has outside them (0 or 255) and its flags — bit 1
  // switches it off — then, when flag bit 4 says so, parameters this reader does not use (a density
  // byte and a feather double for each of the pixel and the vector mask, present by their own flag
  // bits), and then — in the 36-byte form, written when a vector mask is there too — the "real"
  // flags, default and bounds, which are channel -3's.
  maskData(b, m, len, r){
    const flags = b[m + 17];
    r.mask = { top: Psd.i32(b, m), left: Psd.i32(b, m + 4), bottom: Psd.i32(b, m + 8), right: Psd.i32(b, m + 12), def: b[m + 16], off: !!(flags & 2) };
    let p = m + 18;
    if (flags & 16) { const f = b[p++]; p += (f & 1 ? 1 : 0) + (f & 2 ? 8 : 0) + (f & 4 ? 1 : 0) + (f & 8 ? 8 : 0); }
    if (len >= 36 && p + 18 <= m + len)
      r.realMask = { off: !!(b[p] & 2), def: b[p + 1], top: Psd.i32(b, p + 2), left: Psd.i32(b, p + 6), bottom: Psd.i32(b, p + 10), right: Psd.i32(b, p + 14) };
  },
  // The record's PIXEL mask as its mask data describes it — the "real" one when a vector mask has
  // taken channel -2 and the pixel mask is channel -3 — or null when it has none. What decides that a
  // layer or a group is masked is this, not a channel: a mask left all at its default is stored with
  // an EMPTY rectangle, because Photoshop crops a mask to where it differs from its default, so
  // Layer ▸ Layer Mask ▸ Hide All is a rectangle of no area, default 0 and a channel of two bytes —
  // and hides the whole layer (`Interchange.psdMask`).
  userMask(r){ return (r.realMask && r.chans.some(c => c.id === -3) ? r.realMask : r.mask) || null; },
  // Photoshop's Blend If, which is the record's blending ranges: for the composite grey and then each
  // channel, a range for this layer and one for the layer underneath, each four bytes — the black
  // point's two halves and the white point's. Untouched, every one is 0 0 255 255; anything else hides
  // part of the layer by its own colour or the colour under it, which does not come across — the
  // app's blend-if (4.44) reads a band of what lies beneath, with one ramp, by its own luminance.
  blendIf(b, o, len){
    for (let k = 0; k + 4 <= len; k += 4) if (b[o + k] || b[o + k + 1] || b[o + k + 2] !== 255 || b[o + k + 3] !== 255) return true;
    return false;
  },
  tag(b, d, len, key, r){
    if (key === "luni" && len >= 4) {
      const n = Math.min(Psd.u32(b, d), (len - 4) >> 1);
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCharCode(Psd.u16(b, d + 4 + 2 * i));
      r.uname = s.replace(/\0+$/, "");
    } else if ((key === "lsct" || key === "lsdk") && len >= 4) {
      r.section = Psd.u32(b, d);
      if (len >= 12 && Psd.str(b, d + 4, 4) === "8BIM") r.sectionKey = Psd.str(b, d + 8, 4);
    } else if (key === "iOpa" && len >= 1) r.fill = b[d];
    else if (Psd.ADJUST.includes(key)) r.adjust = key;
    else if (key === "lfx2" || key === "lrFX" || key === "lmfx") r.fx = true;
  },

  // ---- in: the pixels (a worker) ----
  // One channel of `w`×`h` as 8-bit bytes, whatever its compression: `b[off]` is its compression
  // word and `len` its whole length. 16-bit samples keep their high byte.
  channel(b, off, len, w, h, depth, psb, out){
    const comp = Psd.u16(b, off), bps = depth === 16 ? 2 : 1;
    if (depth !== 8 && depth !== 16) throw new Error(depth + "-bit channels are not read — save the file as 8 or 16 bits per channel");
    const n = w * h, s = off + 2, end = off + len;
    if (comp === 0) { for (let i = 0; i < n; i++) out[i] = b[s + i * bps]; return out; }
    if (comp !== 1) throw new Error("zip-compressed channel data (compression " + comp + ") is not read — Photoshop writes it for 16- and 32-bit files; save as 8 bits per channel");
    const cw = psb ? 4 : 2, row = bps === 1 ? null : new Uint8Array(w * bps);
    let p = s + h * cw;
    for (let y = 0; y < h; y++) {
      const cnt = psb ? Psd.u32(b, s + y * 4) : Psd.u16(b, s + y * 2), e = Math.min(end, p + cnt);
      if (row) { Psd.unpack(b, p, e, row, 0, w * bps); for (let x = 0; x < w; x++) out[y * w + x] = row[x * bps]; }
      else Psd.unpack(b, p, e, out, y * w, w);
      p += cnt;
    }
    return out;
  },
  // PackBits: a header byte n < 128 copies the next n+1 bytes, n > 128 repeats the next byte 257-n
  // times, 128 is nothing.
  unpack(src, s, e, dst, d, n){
    const stop = d + n;
    while (s < e && d < stop) {
      const k = src[s++];
      if (k < 128) { for (let i = 0; i <= k && d < stop; i++) dst[d++] = src[s++]; }
      else if (k > 128) { const v = src[s++]; for (let i = 257 - k; i > 0 && d < stop; i--) dst[d++] = v; }
    }
    return s;
  },
  // One layer's pixels: `b` holds its channel data (the record's `off`s index into it), `r` its
  // record. RGBA over the layer's bounds (grey is copied into R, G and B), and the mask's own plane
  // over the mask's bounds when that has any area (an empty one is its default everywhere, which
  // `Interchange.psdMask` reads off the record).
  pixels(b, r, depth, psb, grey){
    const w = r.right - r.left, h = r.bottom - r.top, rgba = new Uint8ClampedArray(Math.max(0, w * h * 4));
    const plane = new Uint8Array(Math.max(0, w * h)), mc = r.chans.some(x => x.id === -3) ? -3 : -2;
    let alpha = false, mask = null;
    for (const c of r.chans) {
      if (c.id === -2 || c.id === -3) {
        const m = Psd.userMask(r);
        if (!m || c.id !== mc) continue;
        const mw = m.right - m.left, mh = m.bottom - m.top;
        if (mw > 0 && mh > 0) mask = { w: mw, h: mh, top: m.top, left: m.left, def: m.def, off: !!m.off, data: Psd.channel(b, c.off, c.len, mw, mh, depth, psb, new Uint8Array(mw * mh)) };
        continue;
      }
      if (!(w > 0 && h > 0)) continue;
      const k = c.id === -1 ? 3 : c.id;
      if (k < 0 || k > 3 || (grey && k > 0 && k < 3)) continue;
      Psd.channel(b, c.off, c.len, w, h, depth, psb, plane);
      if (k === 3) alpha = true;
      for (let i = 0; i < w * h; i++) rgba[i * 4 + k] = plane[i];
      if (grey && k === 0) for (let i = 0; i < w * h; i++) rgba[i * 4 + 1] = rgba[i * 4 + 2] = plane[i];
    }
    if (!alpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;    // no transparency channel: opaque
    return { rgba, w, h, mask };
  },
  // The merged image — Photoshop's own flattening of the layers — as RGBA. The channel after the
  // colour ones is its transparency only when the layer count was negative; otherwise it is a saved
  // selection (measured on a skin's 4096² PSD: four channels, a positive count, an opaque picture).
  // A PackBits image lists the row counts of EVERY channel before any row, used or not.
  merged(b, doc){
    const { w, h, depth, psb } = doc, n = w * h, grey = doc.mode === 1;
    if (depth !== 8 && depth !== 16) throw new Error(depth + "-bit images are not read");
    const colours = grey ? 1 : 3, hasA = doc.mergedAlpha && doc.channels > colours;
    const comp = Psd.u16(b, doc.merged), s = doc.merged + 2;
    const rgba = new Uint8ClampedArray(n * 4), plane = new Uint8Array(n), bps = depth === 16 ? 2 : 1;
    let p = comp === 1 ? s + doc.channels * h * (psb ? 4 : 2) : s;
    for (let c = 0; c < colours + (hasA ? 1 : 0); c++) {
      if (comp === 0) { for (let i = 0; i < n; i++) plane[i] = b[p + i * bps]; p += n * bps; }
      else if (comp === 1) {
        const row = new Uint8Array(w * bps);
        for (let y = 0; y < h; y++) {
          const at = s + (c * h + y) * (psb ? 4 : 2), cnt = psb ? Psd.u32(b, at) : Psd.u16(b, at);
          Psd.unpack(b, p, p + cnt, row, 0, w * bps);
          for (let x = 0; x < w; x++) plane[y * w + x] = row[x * bps];
          p += cnt;
        }
      } else throw new Error("the merged image is zip-compressed (compression " + comp + ")");
      const k = grey ? (c === 0 ? 0 : 3) : c;
      for (let i = 0; i < n; i++) rgba[i * 4 + k] = plane[i];
      if (grey && c === 0) for (let i = 0; i < n; i++) rgba[i * 4 + 1] = rgba[i * 4 + 2] = plane[i];
    }
    if (!hasA) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    else Psd.unmatte(rgba);
    return rgba;
  },
  // Where the merged image is transparent, Photoshop stores its colour MATTED ON WHITE: s = c·a + 255·(1 − a).
  // Measured 2026-09-27 on a skin's one-layer PSD, texel by texel against the layer's own pixels: a
  // red of 203 at alpha 93 is stored as 236 (203·93/255 + 162), and every texel at alpha 1 as 255.
  // Read as straight colour it was up to 36 levels off Photoshop's own picture wherever the skin had
  // a soft edge; un-matted, the premultiplied colour is exactly what Photoshop composited.
  unmatte(rgba){
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a === 255) continue;
      for (let c = 0; c < 3; c++) rgba[i + c] = a ? Math.round((rgba[i + c] - 255 + a) * 255 / a) : 0;   // the array clamps
    }
  },

  // ---- out ----
  // One layer's RGBA as channel data: cropped to what it covers (alpha > 0), planar, PackBits — the
  // compression Photoshop writes itself. A 4096² layer is 64 MB uncompressed, and most layers of a
  // skin cover a corner of the sheet.
  encode(rgba, W, H){
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      let a = -1, z = -1;
      for (let x = 0; x < W; x++) if (rgba[row + x * 4 + 3]) { if (a < 0) a = x; z = x; }
      if (a < 0) continue;
      if (a < x0) x0 = a;
      if (z > x1) x1 = z;
      if (y < y0) y0 = y;
      y1 = y;
    }
    if (x1 < 0) return { top: 0, left: 0, bottom: 0, right: 0, chans: [-1, 0, 1, 2].map(id => ({ id, data: new Uint8Array(2) })) };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, plane = new Uint8Array(w * h), chans = [];
    for (const [id, k] of [[-1, 3], [0, 0], [1, 1], [2, 2]]) {
      for (let y = 0; y < h; y++) {
        const sr = ((y0 + y) * W + x0) * 4 + k, dr = y * w;
        for (let x = 0; x < w; x++) plane[dr + x] = rgba[sr + x * 4];
      }
      chans.push({ id, data: Psd.rle(plane, w, h) });
    }
    return { top: y0, left: x0, bottom: y1 + 1, right: x1 + 1, chans };
  },
  // A plane as a PackBits channel: compression word 1, a 16-bit byte count per row, the rows.
  rle(plane, w, h){
    const max = w + Math.ceil(w / 128), tmp = new Uint8Array(h * max), counts = new Uint16Array(h);
    let n = 0;
    for (let y = 0; y < h; y++) { const was = n; n = Psd.pack(plane, y * w, w, tmp, n); counts[y] = n - was; }
    const res = new Uint8Array(2 + 2 * h + n);
    res[1] = 1;
    for (let y = 0; y < h; y++) { res[2 + 2 * y] = counts[y] >> 8; res[3 + 2 * y] = counts[y] & 255; }
    res.set(tmp.subarray(0, n), 2 + 2 * h);
    return res;
  },
  pack(src, s, n, out, o){
    let i = 0;
    while (i < n) {
      let r = 1;
      while (i + r < n && r < 128 && src[s + i + r] === src[s + i]) r++;
      if (r >= 3) { out[o++] = 257 - r; out[o++] = src[s + i]; i += r; continue; }
      const start = i;
      while (i < n && i - start < 128 && !(i + 2 < n && src[s + i] === src[s + i + 1] && src[s + i] === src[s + i + 2])) i++;
      out[o++] = i - start - 1;
      for (let k = start; k < i; k++) out[o++] = src[s + k];
    }
    return o;
  },
  // The merged image as the image-data section: compression word 1, every row count of R, G and B,
  // then their rows — the layout differs from a layer's, where each channel carries its own word.
  mergedData(rgba, W, H){
    const plane = new Uint8Array(W * H), parts = [];
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < W * H; i++) plane[i] = rgba[i * 4 + k];
      parts.push(Psd.rle(plane, W, H));
    }
    let size = 2;
    for (const p of parts) size += p.length - 2;
    const out = new Uint8Array(size);
    out[1] = 1;
    let c = 2, d = 2 + 3 * 2 * H;
    for (const p of parts) { out.set(p.subarray(2, 2 + 2 * H), c); c += 2 * H; }
    for (const p of parts) { out.set(p.subarray(2 + 2 * H), d); d += p.length - 2 - 2 * H; }
    return out;
  },
  // The file, as the parts of a Blob. `layers` is flat, bottom first, each
  //   { name, opacity 0…1, hidden, key, section: 0 | 1 | 3, enc: encode()'s result (not for a divider or folder) }.
  write(doc){
    const recs = [], data = [];
    for (const L of doc.layers) {
      const enc = L.enc || { top: 0, left: 0, bottom: 0, right: 0, chans: [-1, 0, 1, 2].map(id => ({ id, data: new Uint8Array(2) })) };
      recs.push(Psd.recordBytes(L, enc));
      for (const c of enc.chans) data.push(c.data);
    }
    let li = 2;
    for (const r of recs) li += r.length;
    for (const d of data) li += d.length;
    const pad = li & 1;
    li += pad;
    const head = new Uint8Array(26 + 4 + 4 + 4 + 4 + 2), v = new DataView(head.buffer);
    head.set([56, 66, 80, 83], 0);                          // 8BPS
    v.setUint16(4, 1); v.setUint16(12, 3); v.setUint32(14, doc.h); v.setUint32(18, doc.w); v.setUint16(22, 8); v.setUint16(24, 3);
    v.setUint32(26, 0); v.setUint32(30, 0);                 // no colour-mode data, no image resources
    v.setUint32(34, 4 + li + 4);                            // the layer section: layer info, then an empty global mask
    v.setUint32(38, li);
    v.setInt16(42, doc.layers.length);
    const tail = new Uint8Array(pad + 4);                   // the pad, and the global mask info's zero length
    const total = head.length + li - 2 + 4 + doc.merged.length;
    if (total > 0x7fffffff) throw new Error("the layers come to " + Math.round(total / 1048576) + " MB, over the 2 GB a PSD can hold — write OpenRaster instead");
    return [head].concat(recs, data, [tail, doc.merged]);
  },
  recordBytes(L, enc){
    const name = String(L.name == null ? "" : L.name);
    const pas = Math.min(255, name.length), pasLen = (pas + 4) & ~3;
    const uni = 4 + 2 * name.length, uniLen = (uni + 3) & ~3;
    const tags = 12 + uniLen + (L.section ? 12 + 12 : 0);
    const extra = 4 + 4 + pasLen + tags;
    const out = new Uint8Array(16 + 2 + 6 * enc.chans.length + 12 + 4 + extra), v = new DataView(out.buffer);
    let o = 0;
    v.setInt32(0, enc.top); v.setInt32(4, enc.left); v.setInt32(8, enc.bottom); v.setInt32(12, enc.right);
    v.setUint16(16, enc.chans.length);
    o = 18;
    for (const c of enc.chans) { v.setInt16(o, c.id); v.setUint32(o + 2, c.data.length); o += 6; }
    const tag = (s, at) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
    tag("8BIM", o); tag(L.key || "norm", o + 4);
    out[o + 8] = Math.round(Math.max(0, Math.min(1, L.opacity == null ? 1 : L.opacity)) * 255);
    out[o + 9] = 0;
    // bit 1 hides; bit 3 says bit 4 means something, and bit 4 — "pixel data irrelevant to the
    // appearance of the document" — is what Photoshop sets on a group's two records.
    out[o + 10] = (L.hidden ? 2 : 0) | 8 | (L.section ? 16 : 0);
    o += 12;
    v.setUint32(o, extra); o += 4;
    v.setUint32(o, 0); v.setUint32(o + 4, 0); o += 8;       // no layer mask, no blending ranges
    out[o] = pas;
    for (let i = 0; i < pas; i++) { const c = name.charCodeAt(i); out[o + 1 + i] = c < 128 ? c : 63; }
    o += pasLen;
    tag("8BIM", o); tag("luni", o + 4); v.setUint32(o + 8, uniLen); v.setUint32(o + 12, name.length);
    for (let i = 0; i < name.length; i++) v.setUint16(o + 16 + 2 * i, name.charCodeAt(i));
    o += 12 + uniLen;
    if (L.section) { tag("8BIM", o); tag("lsct", o + 4); v.setUint32(o + 8, 12); v.setUint32(o + 12, L.section); tag("8BIM", o + 16); tag(L.key || "norm", o + 20); }
    return out;
  },
};
/*==ENDPSD==*/
