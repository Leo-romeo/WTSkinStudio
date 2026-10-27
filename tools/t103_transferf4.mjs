// The cockpit carried out, on a real aircraft (ROADMAP 4.45) — needs the install.
//
// WHY THIS EXISTS. `t104` holds the transfer bake to shapes whose answer is exact. This holds it to
// what the item is FOR: the owner's bar for 4.14(3) was continuity — the exterior's low-detail
// cockpit "reads as the same cockpit from outside" — and the place to judge it is the Pilot's seat on
// the exterior body. So the seat view is rendered three times by one ray caster over the page's own
// geometry and sheets: the first-person cockpit as it ships (the reference), the exterior as it
// ships, and the exterior with the carried paint laid over its interior sheet at the dialog's
// default reach. The number is mean |ΔRGB| against the reference, per pixel and over 8×8 blocks —
// the block figure is what "reads as the same cockpit at a glance" means. A second camera looks
// down into the cockpit from above the canopy, the way a hangar view does.
//
// The bake is the page's own pure section (`/*==TRANSFER==*/`, with UVTRI and ENCODE as the pool
// lists them), and which cockpit parts lend their paint is the page's own rule (`Transfer.lends`),
// so what is measured is what the app does. Measured 2026-09-27 on the F-4E at 1024², 5 cm: the
// numbers are in ROADMAP 4.45's write-up (docs/ROADMAP_DONE.md) and in the comments they decided.
//
// Usage: node --max-old-space-size=6144 tools/t103_transferf4.mjs [--model f_4e] [--target f_4c_interior_c]
//          [--side 1024] [--out <dir>]      the gate: the F-4E's seat view, carried against stock
//        ... --sweep [--reaches .02,.05] [--facings 0,.5,.85]   the reach and facing sweeps (report only)
//        ... --shared                        how many units' cockpit bodies paint the exterior's own
//                                             *_interior sheet themselves (report only)
import fs from "fs";
import path from "path";
import zlib from "node:zlib";
import { A, grp, WT } from "./arms.mjs";
import { installOodle } from "./oodle_lift.mjs";
import { makeReport } from "./headless.mjs";
import { fileURLToPath } from "url";
import { isDirEntry } from "./wtdir.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " not in the page");
  return src.slice(a + 1, b);
};
const R = makeReport();
const ms = t0 => Number(process.hrtime.bigint() - t0) / 1e6;

globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
const MOD = new Function(section("MODEL") + "\nreturn { loadDynModelBytes, loadSkeletonBytes, buildDynModelGeometry };")();
const BLK = new Function(section("ZSTD") + "\n" + section("BLK") + "\n" + section("VROMFS") +
  "\nreturn { loadGameResDesc, descGetModel, buildDescBind, descMatName, zstdDec: Zstd.zstdDec, zstdDict: Zstd.zstdDict };")();
globalThis.Zstd = { zstdDec: BLK.zstdDec, zstdDict: BLK.zstdDict };   // the sections reach it as Zstd.* (ROADMAP 2.3)
installOodle(src);
const GEO = new Function("descMatName", section("OBJ") + "\n" + section("GEOMDATA") + "\nreturn { geomDataFromExtracted };")(BLK.descMatName);
const { Transfer, padSeams } = new Function(section("UVTRI") + "\n" + section("ENCODE") + "\n" + section("TRANSFER") + "\nreturn { Transfer, padSeams };")();
const DDS = new Function(section("DDS") + "\n" + section("BCNDEC") + "\nreturn { decodeBCn: BCnDec.decodeBCn, decodeBC7: BCnDec.decodeBC7, decodeBC4Tex: BCnDec.decodeBC4Tex };")();
// The app's effect rule (core/state.js), read out of the page so this cannot drift from it.
const EFFECT_RE = (() => {
  const m = /const EFFECT_RE = \/([^\n]+)\/;/.exec(src);
  if (!m) throw new Error("EFFECT_RE is not in the page any more — core/state.js moved it");
  return new RegExp(m[1]);
})();
const MAT_QUAL = "::";
const matBase = m => { const i = m.indexOf(MAT_QUAL); return i < 0 ? m : m.slice(i + MAT_QUAL.length); };
const isEffect = g => EFFECT_RE.test((g.name + " " + matBase(g.mat)).toLowerCase());

// ---- the install's indexes: desc binds, models, texture packs ----
function walk(dir, re, out = [], depth = 0) {
  if (depth > 7) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }                                // an unreadable folder is "nothing here", as the scan treats it
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) { if (/^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i.test(e.name)) continue; walk(p, re, out, depth + 1); }
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const descDbs = walk(WT, /Desc\.bin$/i).map(p => BLK.loadGameResDesc(new Uint8Array(fs.readFileSync(p))));
const bindOf = m => { for (const db of descDbs) if (BLK.descGetModel(db, m)) return BLK.buildDescBind(db, m); return null; };
const dxps = walk(WT, /\.dxp\.bin$/i);
function parseTexName(raw) {
  const s = raw.split("?")[0], di = s.indexOf("$");
  if (di < 0) return { stem: s, tier: "base" };
  const tag = s.slice(di + 1).toLowerCase();
  return { stem: s.slice(0, di), tier: tag.startsWith("uhq") ? "uhq" : tag.startsWith("hq") ? "hq" : tag.startsWith("tq") ? "tq" : "base" };
}
// Every wanted stem's best tier, with its header and where its bytes are (t16's reader).
function locate(want) {
  const need = new Map();
  for (const p of dxps) {
    const fd = fs.openSync(p, "r");
    try {
      const head = Buffer.alloc(0x48); fs.readSync(fd, head, 0, 0x48, 0);
      if (head.readUInt32LE(0) !== 0x32507844) continue;
      const total = head.readUInt16LE(8); if (!total) continue;
      const ddsxOff = head.readUInt32LE(0x20) + 0x10, b3Off = head.readUInt32LE(0x30) + 0x10;
      const size = fs.fstatSync(fd).size;
      const frontEnd = Math.min(size, Math.max(ddsxOff + total * 0x20, b3Off + total * 0x18) + 16);
      const front = Buffer.alloc(frontEnd); fs.readSync(fd, front, 0, frontEnd, 0);
      const names = []; let cp = 0x48;
      for (let i = 0; i < total && cp < front.length; i++) {
        let e = cp; while (e < front.length && front[e]) e++;
        names.push(front.toString("latin1", cp, e).replace(/\*$/, "")); cp = e + 1;
      }
      for (let i = 0; i < total; i++) {
        const { stem, tier } = parseTexName(names[i] || "");
        if (!want.has(stem)) continue;
        const ho = ddsxOff + i * 0x20;
        if (ho + 0x20 > front.length || front.readUInt32LE(ho) !== 0x78534444) continue;
        const off = front.readUInt32LE(b3Off + i * 0x18 + 0xc), sz = front.readUInt32LE(b3Off + i * 0x18 + 0x10);
        const rank = { uhq: 3, hq: 2, base: 1, tq: 0 }[tier] || 0, cur = need.get(stem);
        if (sz && (!cur || rank > cur.rank)) need.set(stem, { p, off, sz, rank, header: Uint8Array.from(front.subarray(ho, ho + 0x20)) });
      }
    } finally { fs.closeSync(fd); }
  }
  return need;
}
async function decode(rec) {
  const hd = new DataView(rec.header.buffer, rec.header.byteOffset, 0x20);
  const w = hd.getUint16(12, true), h = hd.getUint16(14, true), memSz = hd.getUint32(0x18, true), flags = hd.getUint32(8, true);
  const comp = (flags >>> 24) & 0xE0;
  const fmt = String.fromCharCode(rec.header[4], rec.header[5], rec.header[6], rec.header[7]).replace(/\0+$/, "");
  const fd = fs.openSync(rec.p, "r"); const body = Buffer.alloc(rec.sz); fs.readSync(fd, body, 0, rec.sz, rec.off); fs.closeSync(fd);
  let raw;
  if (comp === 0) raw = new Uint8Array(body);
  else if (comp === 0x20) raw = BLK.zstdDec(new Uint8Array(body));
  else if (comp === 0x60) raw = Oodle.oodleDecompress(await Oodle.ensureOodle(), new Uint8Array(body), memSz);
  else if (comp === 0x80) raw = new Uint8Array(zlib.inflateSync(body));
  else throw new Error("comp " + comp);
  const bb = (fmt === "DXT1" || fmt === "ATI1") ? 8 : 16;
  const top = Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * bb;
  let off0 = 0; const levels = rec.header[0x10] || 1;
  if ((flags & 0x40000) && levels > 1) for (let l = levels - 1; l >= 1; l--) off0 += Math.max(1, (Math.max(1, w >> l) + 3) >> 2) * Math.max(1, (Math.max(1, h >> l) + 3) >> 2) * bb;
  if (off0 + top > raw.length) off0 = 0;
  const blocks = raw.subarray(off0, off0 + top);
  const rgba = fmt === "BC7" ? DDS.decodeBC7(blocks, w, h) : fmt === "ATI1" ? DDS.decodeBC4Tex(blocks, w, h)
    : (fmt === "ATI2" || fmt === "BC5U") ? DDS.decodeBCn(blocks, w, h, "BC5") : DDS.decodeBCn(blocks, w, h, fmt);
  return { rgba, w, h };
}
// A model's geometry the way the app builds App.geomData, each group with the albedo stem its
// material binds (the desc's `c`) and its shader class — the sheet is null where there is no
// albedo, which is where the app makes no slot either.
async function body(model) {
  const ref = grp.dyn.get(model);
  if (!ref) return null;
  const bytes = new Uint8Array(fs.readFileSync(ref.p)).subarray(ref.e.offset, ref.e.offset + ref.e.size);
  const dm = await MOD.loadDynModelBytes(bytes, model);
  const sk = grp.skelRefs.get(model + "_skeleton");
  if (sk) dm.skeleton = MOD.loadSkeletonBytes(new Uint8Array(fs.readFileSync(sk.p)).subarray(sk.e.offset, sk.e.offset + sk.e.size));
  const geo = MOD.buildDynModelGeometry(dm, 0);
  const bind = bindOf(model);
  const list = GEO.geomDataFromExtracted(geo, bind);
  for (const g of list) { const d = bind && bind.map.get(g.mat.toLowerCase()); g.sheet = d && d.c ? d.c : null; g.cls = d ? d.cls || "" : null; }
  return { model, list, bind };
}
const cache = new Map();
async function bodyOnce(m) { if (!cache.has(m)) cache.set(m, await body(m)); return cache.get(m); }
const cat = (groups, key) => { let n = 0; for (const g of groups) n += g[key].length; const out = new Float32Array(n); let at = 0; for (const g of groups) { out.set(g[key], at); at += g[key].length; } return out; };
// The cockpit parts that lend their paint — `Transfer.cockpit.gather`'s rule, through the page's own
// `Transfer.lends`: not unposed, not an effect, a sheet to paint, not see-through.
const lendsOf = ck => ck.list.filter(g => !g.skinned && !isEffect(g) && g.sheet && Transfer.lends(g.cls, g.sheet + " " + g.mat));

// What the cockpit body renders on the exterior's `target` sheet — `gather`'s `keep`: every part of it
// on that sheet, lending or not (glass, cloth and hidden parts draw their texels all the same).
const keepOf = (ck, target) => ck.list.filter(g => g.sheet === target && g.uv);

// ---- one bake: the exterior's `target` sheet from the cockpit body ----
function bake(tgt, srcG, side, facing, keepG) {
  const sheets = [...new Set(srcG.map(g => g.sheet))];
  const srcSheet = new Int16Array(srcG.reduce((n, g) => n + g.tris, 0));
  { let t = 0; for (const g of srcG) { const k = sheets.indexOf(g.sheet); for (let i = 0; i < g.tris; i++) srcSheet[t++] = k; } }
  const srcPos = cat(srcG, "position"), srcUV = cat(srcG, "uv");
  let t0 = process.hrtime.bigint();
  const S = Transfer.prepare({ tgtPos: cat(tgt, "position"), tgtUV: cat(tgt, "uv"), srcPos, w: side, h: side, flipV: false, reach: Transfer.REACH, facing,
                               keepUV: keepG && keepG.length ? cat(keepG, "uv") : null });
  const tPrep = ms(t0); t0 = process.hrtime.bigint();
  Transfer.query(S, 0, S.T.order.length);
  const tQuery = ms(t0);
  return { S, sheets, srcSheet, src: { uv: srcUV, sheet: srcSheet, scale: Transfer.uvPerMetre(srcPos, srcUV) }, tPrep, tQuery,
           st: Transfer.stats(S.look, srcSheet, sheets.length), srcTris: srcPos.length / 9 };
}
const texCache = new Map();
async function textures(stems) {
  const want = new Set([...stems].filter(s => s && !texCache.has(s)));
  if (want.size) { const need = locate(want); for (const s of want) texCache.set(s, need.has(s) ? await decode(need.get(s)) : null); }
  return texCache;
}
const mipCache = new Map();
const mipsOf = s => { if (!texCache.get(s)) return null; if (!mipCache.has(s)) mipCache.set(s, Transfer.mips(texCache.get(s))); return mipCache.get(s); };
// The carried pixels, as the worker's `sample` op makes them: the target's own sheet passed through,
// the gutters padded over the sheet's whole coverage (`Transfer.pad`).
function carried(b, target, side) {
  const rgba = Transfer.sample(b.S.look, b.src, b.sheets.map(s => s === target ? null : mipsOf(s)), side, side, false, b.S.reach);
  Transfer.pad(b.S.look, rgba, side, side, 16);
  return rgba;
}
const lum = (p, i) => .2126 * p[i*4] + .7152 * p[i*4+1] + .0722 * p[i*4+2];
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 3) return NaN;
  let mx = 0, my = 0; for (let k = 0; k < n; k++) { mx += xs[k]; my += ys[k]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { const a = xs[k] - mx, c = ys[k] - my; sxy += a * c; sxx += a * a; syy += c * c; }
  return sxy / Math.sqrt(sxx * syy);
};
// How alike the carried colour and the stock interior sheet are, texel by texel: Pearson r of
// luminance over the texels the reach shows. Both are paintings of one cockpit, so a carry that
// lands on the right surfaces correlates; a shuffle of the same colours — the same palette, placed
// nowhere in particular — is the floor.
function likeness(b, rgba, stock, side, reach) {
  const xs = [], ys = [];
  for (let k = 0; k < b.S.T.order.length; k++) {
    const i = b.S.T.order[k];
    if (!Transfer.alpha(rgba[i*4+3], Transfer.REACH, reach)) continue;
    const x = i % side, y = (i - x) / side;
    xs.push(lum(rgba, i)); ys.push(lum(stock.rgba, Math.floor((y + .5) * stock.h / side) * stock.w + Math.floor((x + .5) * stock.w / side)));
  }
  let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  return { n: xs.length, r: pearson(xs, ys), shuffled: pearson(xs.map(() => xs[Math.floor(rnd() * xs.length)]), ys) };
}

// ---- the seat view, rendered ----
function rayScene(groups, sheetOf) {
  const tris = groups.reduce((n, g) => n + g.tris, 0);
  const pos = new Float32Array(tris * 9), uv = new Float32Array(tris * 6), sh = new Int16Array(tris);
  let t = 0;
  for (const g of groups) { pos.set(g.position, t * 9); uv.set(g.uv, t * 6); sh.fill(sheetOf(g), t, t + g.tris); t += g.tris; }
  return { B: Transfer.bvh(pos), uv, sh };
}
// The first triangle a ray meets, both faces counting (the app's materials are two-sided).
function rayHit(B, ox, oy, oz, dx, dy, dz) {
  const tv = B.tv, box = B.box, start = B.start, cnt = B.cnt, stack = B.stack;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best = Infinity, bt = -1, bu = 0, bv = 0, sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const n = stack[--sp], o = n * 6;
    let t0 = ((ix >= 0 ? box[o] : box[o+3]) - ox) * ix, t1 = ((ix >= 0 ? box[o+3] : box[o]) - ox) * ix;
    const ty0 = ((iy >= 0 ? box[o+1] : box[o+4]) - oy) * iy, ty1 = ((iy >= 0 ? box[o+4] : box[o+1]) - oy) * iy;
    if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? box[o+2] : box[o+5]) - oz) * iz, tz1 = ((iz >= 0 ? box[o+5] : box[o+2]) - oz) * iz;
    if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
    if (t0 > t1 || t1 < 0 || t0 > best) continue;
    const c = cnt[n];
    if (!c) { stack[sp++] = start[n]; stack[sp++] = start[n] + 1; continue; }
    for (let t = start[n], e = t + c; t < e; t++) {
      const q = t * 9;
      const e1x = tv[q+3] - tv[q], e1y = tv[q+4] - tv[q+1], e1z = tv[q+5] - tv[q+2];
      const e2x = tv[q+6] - tv[q], e2y = tv[q+7] - tv[q+1], e2z = tv[q+8] - tv[q+2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, sx = ox - tv[q], sy = oy - tv[q+1], sz = oz - tv[q+2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) { best = tt; bt = t; bu = u; bv = v; }
    }
  }
  return bt < 0 ? null : { t: best, tri: B.tid[bt], u: bu, v: bv };
}
function texel(img, u, v) {
  const x = ((Math.floor(u * img.w) % img.w) + img.w) % img.w, y = ((Math.floor((1 - v) * img.h) % img.h) + img.h) % img.h;
  const i = (y * img.w + x) * 4;
  return [img.rgba[i], img.rgba[i+1], img.rgba[i+2]];
}
function render(scene, imgs, cam, W, H) {
  const out = new Uint8ClampedArray(W * H * 4), hit = new Uint8Array(W * H);
  const f = (W / 2) / Math.tan(cam.fov / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = (x + .5 - W / 2) / f, b = (H / 2 - y - .5) / f;
    let dx = cam.fwd[0] + a * cam.right[0] + b * cam.up[0], dy = cam.fwd[1] + a * cam.right[1] + b * cam.up[1], dz = cam.fwd[2] + a * cam.right[2] + b * cam.up[2];
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const h = rayHit(scene.B, cam.pos[0], cam.pos[1], cam.pos[2], dx, dy, dz);
    const i = y * W + x;
    out[i*4+3] = 255;
    if (!h) { out[i*4] = 40; out[i*4+1] = 60; out[i*4+2] = 90; continue; }
    const img = imgs[scene.sh[h.tri]];
    if (!img) { out[i*4] = 255; out[i*4+1] = 0; out[i*4+2] = 255; continue; }
    const o = h.tri * 6, w0 = 1 - h.u - h.v;
    const c = texel(img, w0 * scene.uv[o] + h.u * scene.uv[o+2] + h.v * scene.uv[o+4], w0 * scene.uv[o+1] + h.u * scene.uv[o+3] + h.v * scene.uv[o+5]);
    out[i*4] = c[0]; out[i*4+1] = c[1]; out[i*4+2] = c[2]; hit[i] = 1;
  }
  return { out, hit };
}
// Mean |ΔRGB| between two renders over the pixels both hit — per pixel, and over 8×8 blocks.
function compare(a, b, W, H) {
  let d = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (a.hit[i] && b.hit[i]) { d += (Math.abs(a.out[i*4] - b.out[i*4]) + Math.abs(a.out[i*4+1] - b.out[i*4+1]) + Math.abs(a.out[i*4+2] - b.out[i*4+2])) / 3; n++; }
  let bd = 0, bn = 0;
  for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
    const sa = [0, 0, 0], sb = [0, 0, 0]; let k = 0;
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const i = y * W + x; if (!a.hit[i] || !b.hit[i]) continue; k++; for (let c = 0; c < 3; c++) { sa[c] += a.out[i*4+c]; sb[c] += b.out[i*4+c]; } }
    if (k < 48) continue;
    bd += (Math.abs(sa[0] - sb[0]) + Math.abs(sa[1] - sb[1]) + Math.abs(sa[2] - sb[2])) / 3 / k; bn++;
  }
  return { px: d / n, block: bd / bn, n };
}
function png(file, rgba, w, h) {
  const crcT = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c; }
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
// What the viewport draws: every part with a sheet, not an effect, not unposed, not see-through.
const visibleGroups = b => b.list.filter(g => g.sheet && !g.skinned && !isEffect(g) && Transfer.lends(g.cls, g.sheet + " " + g.mat));
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function camera(pos, fwd, fovDeg) {
  fwd = norm(fwd);
  const right = norm(cross([0, 1, 0], fwd)), up = cross(fwd, right);
  return { pos, fwd, right, up, fov: fovDeg * Math.PI / 180 };
}
// The seat and the view down into the cockpit, rendered from the first-person model (the reference),
// the exterior as it ships, and the exterior with `rgba` laid over `target` at `reach`.
async function seatViews(model, target, side, b, rgba, reach, tag) {
  const ext = await bodyOnce(model), ck = await bodyOnce(model + "_cockpit");
  const extVis = visibleGroups(ext), ckVis = visibleGroups(ck);
  await textures(new Set([target, ...extVis.map(g => g.sheet), ...ckVis.map(g => g.sheet)]));
  const stock = texCache.get(target);
  const baked = { w: stock.w, h: stock.h, rgba: new Uint8ClampedArray(stock.rgba) };
  for (let y = 0; y < stock.h; y++) for (let x = 0; x < stock.w; x++) {
    const i = (y * stock.w + x) * 4, j = (Math.floor(y * side / stock.h) * side + Math.floor(x * side / stock.w)) * 4;
    const a = Transfer.alpha(rgba[j+3], b.S.reach, reach) / 255;
    for (let c = 0; c < 3; c++) baked.rgba[i+c] = stock.rgba[i+c] * (1 - a) + rgba[j+c] * a;
  }
  const sheetsOf = list => [...new Set(list.map(g => g.sheet))];
  const hdSheets = sheetsOf(ckVis), exSheets = sheetsOf(extVis);
  const hd = rayScene(ckVis, g => hdSheets.indexOf(g.sheet)), ex = rayScene(extVis, g => exSheets.indexOf(g.sheet));
  const hdImgs = hdSheets.map(s => texCache.get(s)), exStock = exSheets.map(s => texCache.get(s)), exBaked = exSheets.map(s => s === target ? baked : texCache.get(s));
  const unit = A.acesBlk(A.acesUnitPath(model));
  const head = A.blkList(A.blkParams(unit, A.blkChildren(unit, unit.root, "cockpit")[0]).headPos)[0];
  const seat = [+head[0], +head[1], -head[2]];                 // the game's z negated into app space (wt-geometry)
  const cams = {
    seat: camera(seat, [1, -.22, 0], 100),
    // above and ahead of the canopy, looking down into the cockpit the way a hangar view does
    outside: camera([seat[0] + 2.2, seat[1] + 1.6, seat[2] - .9], [-2.8, -1.9, .9], 55),
  };
  const Wd = 480, Ht = 300, res = {};
  for (const [name, cam] of Object.entries(cams)) {
    const rh = render(hd, hdImgs, cam, Wd, Ht), rs = render(ex, exStock, cam, Wd, Ht), rb = render(ex, exBaked, cam, Wd, Ht);
    res[name] = { stock: compare(rh, rs, Wd, Ht), baked: compare(rh, rb, Wd, Ht) };
    const out = arg("--out", null);
    if (out) {
      const strip = new Uint8ClampedArray(Wd * 3 * Ht * 4);
      [rh, rs, rb].forEach((r, k) => { for (let y = 0; y < Ht; y++) strip.set(r.out.subarray(y * Wd * 4, (y + 1) * Wd * 4), (y * Wd * 3 + k * Wd) * 4); });
      png(path.join(out, "seat_" + model + "_" + name + "_" + tag + ".png"), strip, Wd * 3, Ht);
    }
  }
  return { res, seat, stock };
}
const fmt = r => `${r.stock.px.toFixed(1)} → ${r.baked.px.toFixed(1)} (8×8 blocks ${r.stock.block.toFixed(1)} → ${r.baked.block.toFixed(1)})`;

// ---- report only: the units whose cockpit body paints the exterior's interior sheet too ----
// By their descs first (which sheets each body binds), then — because a desc says only THAT the
// cockpit uses the sheet, not how much of it — each such model baked at `--side` (256) the way the
// dialog bakes it, the cockpit's own texels kept: how much of the exterior's layout the cockpit
// renders itself, and what the dialog then says. The review of 4.45 (2026-09-27) found the desc
// count read as "nothing to carry" when it is not: the Tornado GR4's cockpit uses 10 texels of the
// sheet, the C-47's all of the exterior's.
if (argv.includes("--shared")) {
  const sideS = +arg("--side", 256), limit = +arg("--limit", 0);
  let sep = 0, shared = 0;
  const models = new Map();                            // model → the units using it, the sheets both bodies bind
  for (const [base, pth] of A.acesUnitPaths()) {
    if (!/flightmodels/.test(pth)) continue;
    const db = A.acesBlk(pth); if (!db) continue;
    const m = A.blkParams(db, db.root).model;
    if (!m || !grp.dyn.has(m) || !grp.dyn.has(m + "_cockpit")) continue;
    const be = bindOf(m), bc = bindOf(m + "_cockpit");
    if (!be || !bc) continue;
    const ext = new Set([...be.map.values()].map(e => e.c).filter(c => c && /_interior/.test(c)));
    if (!ext.size) continue;
    const ck = new Set([...bc.map.values()].map(e => e.c).filter(Boolean));
    const both = [...ext].filter(c => ck.has(c));
    if (!both.length) { sep++; continue; }
    shared++;
    const rec = models.get(m) || { units: [], targets: both };
    rec.units.push(base); models.set(m, rec);
  }
  console.log(`units with a cockpit model and an *_interior sheet on the exterior: ${shared + sep}; by the descs the cockpit body binds that sheet too on ${shared} (${models.size} models), only its own sheets on ${sep}`);
  const reach = Transfer.DEFAULT_REACH, rows = [];
  const grey = Transfer.mips({ rgba: new Uint8ClampedArray(64).fill(128), w: 4, h: 4 });   // only WHERE the paint lands matters here
  const t0 = process.hrtime.bigint();
  let k = 0;
  for (const [m, rec] of models) {
    if (limit && k++ >= limit) break;
    const ext = await body(m), ck = await body(m + "_cockpit");
    if (!ext || !ck) continue;
    const srcG = lendsOf(ck);
    for (const target of rec.targets) {
      const tgt = ext.list.filter(g => g.sheet === target && g.position && g.uv);
      if (!tgt.length || !srcG.length) continue;
      const b = bake(tgt, srcG, sideS, 0, keepOf(ck, target));
      const rgba = Transfer.sample(b.S.look, b.src, b.sheets.map(s => s === target ? null : grey), sideS, sideS, false, b.S.reach);
      Transfer.pad(b.S.look, rgba, sideS, sideS, 16);
      const st = Transfer.stats(b.S.look, b.srcSheet, b.sheets.length, rgba), own = b.sheets.indexOf(target);
      let shown = 0;
      for (let a = 1; a < 256; a++) if (Transfer.alpha(a, Transfer.REACH, reach)) shown += st.hist[a];
      // `lent` and `own` as `Transfer.cockpit.summary` counts them, and so what the dialog says
      const lent = st.bySheet.reduce((n, c, j) => j === own ? n : n + c, 0), ownN = st.kept + (own >= 0 ? st.bySheet[own] : 0);
      rows.push({ m, units: rec.units.length, target, covered: st.covered, kept: st.kept, own: ownN, lent, shown });
    }
  }
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  const say = r => !r.shown ? (!r.lent && r.own ? "itself" : "none") : r.shown < .05 * r.covered ? "little" : r.shown < .5 * r.covered ? "part" : "most";
  const LABEL = { itself: "shows nothing: the cockpit paints the sheet itself, and the dialog says there is nothing to carry",
                  none: "shows nothing within the reach", little: "carries under 5 % of the sheet", part: "carries 5–50 %", most: "carries over half" };
  const by = new Map();
  for (const r of rows) { const c = say(r), e = by.get(c) || { models: 0, units: 0, eg: [] }; e.models++; e.units += r.units; if (e.eg.length < 5) e.eg.push(`${r.m} (${(100 * r.shown / r.covered).toFixed(0)} % shown, ${(100 * r.kept / r.covered).toFixed(0)} % its own)`); by.set(c, e); }
  console.log(`baked ${rows.length} (model, sheet) pairs at ${sideS}², the cockpit's own texels kept, reach ${(reach * 100).toFixed(0)} cm, in ${sec.toFixed(0)} s:`);
  for (const c of Object.keys(LABEL)) { const e = by.get(c); if (e) console.log(`  ${e.models} models (${e.units} units) ${LABEL[c]} — e.g. ${e.eg.join(", ")}`); }
  const keptShare = rows.map(r => r.kept / r.covered).sort((a, b) => a - b), q = f => keptShare.length ? keptShare[Math.min(keptShare.length - 1, Math.floor(f * keptShare.length))] : 0;
  console.log(`  the share of the exterior's texels on the sheet the cockpit renders itself: median ${(100 * q(.5)).toFixed(0)} %, p10 ${(100 * q(.1)).toFixed(0)} %, p90 ${(100 * q(.9)).toFixed(0)} %`);
  process.exit(0);
}

const model = arg("--model", "f_4e"), target = arg("--target", "f_4c_interior_c"), side = +arg("--side", 1024);
const ext = await bodyOnce(model), ck = await bodyOnce(model + "_cockpit");
if (!ext || !ck) { console.log(`SKIP: ${model} or ${model}_cockpit is not in this install`); process.exit(0); }
// The exterior's parts on the sheet, hidden, unposed or not — `gather`'s targets.
const tgt = ext.list.filter(g => g.sheet === target);
const srcG = lendsOf(ck);
R.is(tgt.length > 0 && !ck.list.some(g => g.sheet === target),
  `${model}: ${tgt.length} exterior parts on ${target}, which the cockpit body does not paint — the case the transfer is for`);

// ---- report only: the sweeps behind DEFAULT_REACH and the facing rule ----
if (argv.includes("--sweep")) {
  const reaches = arg("--reaches", ".02,.03,.05,.08,.12,.3").split(",").map(Number);
  const facings = arg("--facings", "0,.5,.85").split(",").map(Number);
  for (const f of facings) {
    const b = bake(tgt, srcG, side, f, keepOf(ck, target));
    await textures(new Set(b.sheets));
    const rgba = carried(b, target, side);
    for (const r of reaches) {
      const v = await seatViews(model, target, side, b, rgba, r, "f" + f + "_r" + r);
      console.log(`  facing ${f}, reach ${(r * 100).toFixed(0)} cm: query ${b.tQuery.toFixed(0)} ms; seat ${fmt(v.res.seat)}; outside ${fmt(v.res.outside)}`);
    }
  }
  process.exit(0);
}

// ---- the gate: the app's own bake, at the dialog's default reach ----
const reach = Transfer.DEFAULT_REACH;
const b = bake(tgt, srcG, side, 0, keepOf(ck, target));
await textures(new Set([target, ...b.sheets]));
const rgba = carried(b, target, side);
const st = b.st, ckOnly = b.sheets.map((s, k) => ext.list.some(g => g.sheet === s) ? 0 : st.bySheet[k]).reduce((a, c) => a + c, 0);
console.log(`  note  ${b.srcTris.toLocaleString()} cockpit triangles lend paint; ${st.covered.toLocaleString()} covered texels at ${side}²; ` +
  `index ${b.tPrep.toFixed(0)} ms, queries ${b.tQuery.toFixed(0)} ms on one thread; distance p50 ${(st.p50 * 100).toFixed(1)} cm, p90 ${(st.p90 * 100).toFixed(1)} cm`);
console.log("  note  from " + st.bySheet.map((n, k) => [b.sheets[k], n]).filter(x => x[1]).sort((x, y) => y[1] - x[1]).slice(0, 6)
  .map(x => x[0] + " " + (100 * x[1] / st.answered).toFixed(1) + " %").join(", "));
const shown = (() => { let n = 0; for (let k = 0; k < b.S.T.order.length; k++) if (Transfer.alpha(rgba[b.S.T.order[k] * 4 + 3], b.S.reach, reach)) n++; return n; })();
R.is(st.answered > .95 * st.covered, `the cockpit is within ${(Transfer.REACH * 100).toFixed(0)} cm of ${(100 * st.answered / st.covered).toFixed(1)} % of the sheet's texels`);
// 72.5 % on 2026-09-27: the rest are surfaces the two models place more than 5 cm apart (the p90
// of the distance is 12 cm), and they keep the stock sheet's paint.
R.is(shown > .65 * st.covered, `…and within the default ${(reach * 100).toFixed(0)} cm of ${(100 * shown / st.covered).toFixed(1)} % of them`);
R.is(ckOnly > .9 * st.answered, `${(100 * ckOnly / st.answered).toFixed(1)} % of the answers are on the cockpit's own sheets, not on its copy of the exterior's airframe`);
const like = likeness(b, rgba, texCache.get(target), side, reach);
// A note, not a gate: the stock sheet is the artist's own low-detail painting of the cockpit, and it
// agrees with the first-person model's only loosely (r 0.11 on 2026-09-27) — the seat view below is
// the measure the item set. The shuffle is the floor a mapping to nowhere in particular would score.
console.log(`  note  carried against the stock interior, texel by texel: luminance r = ${like.r.toFixed(2)} over ${like.n.toLocaleString()} texels, ${like.shuffled.toFixed(2)} for the same colours shuffled`);
const v = await seatViews(model, target, side, b, rgba, reach, "gate");
console.log(`  note  seat view |ΔRGB| against the first-person cockpit: ${fmt(v.res.seat)}; from above the canopy: ${fmt(v.res.outside)}`);
R.is(v.res.seat.baked.block < .65 * v.res.seat.stock.block && v.res.seat.baked.px < .75 * v.res.seat.stock.px,
  `from the Pilot's seat on the exterior the carried cockpit reads as the first-person one: 8×8 blocks ${v.res.seat.stock.block.toFixed(1)} → ${v.res.seat.baked.block.toFixed(1)}, pixels ${v.res.seat.stock.px.toFixed(1)} → ${v.res.seat.baked.px.toFixed(1)}`);
R.is(v.res.outside.baked.block <= v.res.outside.stock.block,
  `…and from above the canopy it is no further off than the stock sheet (blocks ${v.res.outside.stock.block.toFixed(1)} → ${v.res.outside.baked.block.toFixed(1)})`);
R.finish();
