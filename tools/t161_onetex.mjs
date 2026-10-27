// One texture out of the app on its own (ROADMAP 4.59), against the real page.
//
// WHY THIS EXISTS. A texture used to leave only inside the skin export, the OBJ zip or as a layer.
// 4.59 adds two doors — *save* on a texture-search row and *export texture…* in a slot's ⋮ menu —
// and each promises a file that is exactly something: the game's own `.dds` is the entry's raw
// bytes, *as the skin export writes it* is that texture's file from a full export byte for byte, and
// an image is the texture's pixels, all four channels. The last is the one that is easy to break:
// a canvas premultiplies alpha, and a packed `_n` keeps normal Y in alpha (wt-formats), so a PNG
// written through `toBlob` rounds R, G and B away wherever Y is low. So the PNG here is decoded by
// THIS file — its own chunk walk, its own CRC, Node's zlib and the five PNG filters written from the
// spec — not by the page that wrote it, and the canvas route is run through the same oracle to show
// it would be caught.
//
// Usage: node tools/t161_onetex.mjs [--keep] [--chrome <path>]
import zlib from "zlib";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var b64 = function(u8){ var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
  var seed = 7; var rnd = function(){ seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 8 & 255; };
  var same = function(a, b){ if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  var wait = async function(fn, ms){ var t0 = performance.now(); while (performance.now() - t0 < (ms || 5000)) { var v = fn(); if (v) return v; await new Promise(function(r){ setTimeout(r, 20); }); } return null; };

  // ---- the PNG writer: a packed _n's four channels, alpha low or zero under arbitrary colour ----
  var W = 64, H = 32, px = new Uint8Array(W * H * 4);
  for (var i = 0; i < W * H; i++) { px[i*4] = rnd(); px[i*4+1] = rnd(); px[i*4+2] = rnd(); px[i*4+3] = i % 5 === 0 ? 0 : rnd() & 31; }
  for (var x = 0; x < W; x++) { px[(5 * W + x) * 4] = x * 4; px[(5 * W + x) * 4 + 1] = 200; }  // a smooth row, for the filters
  out.px = b64(px);
  out.png = b64(await PNG.encode(px, W, H));
  out.pngPool = b64(await OneTex.image(px.slice(), W, H, "png"));
  out.poolMode = OneTex.pool().mode;
  out.tgaPool = same(await OneTex.image(px.slice(), W, H, "tga"), writeTGA(px, W, H));
  // A browser opens it, and its alpha comes back exactly (alpha survives a canvas; colour does not).
  var bmp = await createImageBitmap(new Blob([await PNG.encode(px, W, H)], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d"); g.drawImage(bmp, 0, 0);
  var back = g.getImageData(0, 0, W, H).data, aOk = bmp.width === W && bmp.height === H;
  for (var i = 0; i < W * H; i++) if (back[i*4+3] !== px[i*4+3]) aOk = false;
  out.browserOpens = aOk;
  // The route the entry forbids, through the same oracle: putImageData, then toBlob.
  var cv2 = document.createElement("canvas"); cv2.width = W; cv2.height = H;
  cv2.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
  out.canvasPng = b64(new Uint8Array(await (await new Promise(function(r){ cv2.toBlob(r, "image/png"); })).arrayBuffer()));

  // ---- capture downloads instead of making them ----
  var got = [];
  var keepDl = OneTex.download;
  OneTex.download = function(name, data){ got.push({ name: name, data: new Uint8Array(data) }); };
  var keepDec = decodeGameEntry, keepStems = GameDB.stems;
  try {
    // ---- the texture search: a stand-in entry whose decode is known ----
    var raw = new Uint8Array(300); for (var i = 0; i < raw.length; i++) raw[i] = rnd();
    var lv = new Uint8ClampedArray(16 * 16 * 4); for (var i = 0; i < lv.length; i++) lv[i] = rnd();
    var en = { stem: "hull_c", tier: "base", w: 16, h: 16, size: 300, supported: true, compName: "zstd", fmt: "DXT5" };
    decodeGameEntry = async function(e){ return { width: 16, height: 16, mips: [{ w: 16, h: 16, rgba: new Uint8ClampedArray(lv) }], raw: raw.slice().buffer, rawName: e.stem + ".dds" }; };
    GameDB.stems = new Map([["hull_c", { stem: "hull_c", tiers: { base: en } }], ["hull_n", { stem: "hull_n", tiers: { base: Object.assign({}, en, { stem: "hull_n" }) } }]]);
    var row = textureRow(GameDB.stems.get("hull_c"), "auto");
    var save = [].slice.call(row.querySelectorAll("button")).find(function(b){ return b.textContent === "save"; });
    out.saveButton = !!save;
    var pick = async function(btn, re){
      btn.click();
      var r = await wait(function(){ return [].slice.call(document.querySelectorAll(".rowitem[role=button]")).find(function(e){ return re.test(e.textContent); }); }, 2000);
      if (!r) return "no row " + re;
      var n = got.length; r.click();
      return (await wait(function(){ return got.length > n && got[got.length - 1]; }, 5000)) || "nothing written";
    };
    var dds = await pick(save, /game's own file/i);
    out.searchDds = { name: dds.name, same: same(dds.data, raw) };
    var png = await pick(save, /PNG/);
    out.searchPng = { name: png.name, data: png.data ? b64(png.data) : "", lv: b64(new Uint8Array(lv)) };
    var tga = await pick(save, /TGA/);
    out.searchTga = { name: tga.name, same: same(tga.data, writeTGA(lv, 16, 16)) };

    // ---- a slot: an edited albedo and an edited _n whose normal Y (packed into A) is low ----
    var S = 64;
    var mk = function(fill){ var c = document.createElement("canvas"); c.width = c.height = S; var d = new ImageData(S, S);
      for (var i = 0; i < S * S; i++) { var v = fill(i); d.data[i*4] = v[0]; d.data[i*4+1] = v[1]; d.data[i*4+2] = v[2]; d.data[i*4+3] = 255; }
      c.getContext("2d").putImageData(d, 0, 0); return c; };
    var slot = { id: "hull_c", cStem: "hull_c", cFileName: "hull_c.dds", nStem: "hull_n", nFileName: "hull_n.dds",
      layers: [], composite: mk(function(){ return [rnd(), rnd(), rnd()]; }), baseC: mk(function(){ return [0, 0, 0]; }),
      cEdited: true, nEdited: true, size: S, sizeH: S, nSize: S, missing: false,
      smooth: mk(function(){ var v = rnd(); return [v, v, v]; }), metal: mk(function(){ var v = rnd(); return [v, v, v]; }),
      normal: mk(function(){ return [rnd(), rnd() & 15, 128]; }) };
    var keepSlots = App.slots, keepActive = App.activeSlot;
    App.slots = new Map([["hull_c", slot]]); App.activeSlot = slot;
    try {
      var items = collectExports(false);
      var full = await encodeAllTextures(items);
      var fileOf = function(n){ var f = full.files.find(function(f){ return f.name === n; }); return f && f.data; };
      var exC = await OneTex.slotFile(slot, "c", "export"), exN = await OneTex.slotFile(slot, "n", "export");
      out.exportSame = { c: exC.name + " " + same(exC.data, fileOf("hull_c.dds")), n: exN.name + " " + same(exN.data, fileOf("hull_n.dds")), files: full.files.map(function(f){ return f.name; }).join(",") };
      var nPng = await OneTex.slotFile(slot, "n", "png");
      out.slotPng = { name: nPng.name, data: b64(nPng.data), want: b64(new Uint8Array(ExportCollect.surfPixels(ExportCollect.ctx(false), slot).rgba)) };
      var cDds = await OneTex.slotFile(slot, "c", "dds");
      out.slotDds = cDds.name + " " + same(cDds.data, raw);
      // The ⋮ menu: the entry is there, and its dialog offers every form for both sheets.
      var menu = buildSlotMenu(slot);
      var ex = [].slice.call(menu.querySelectorAll("button")).find(function(b){ return /export texture/.test(b.textContent); });
      out.menuButton = !!ex;
      if (ex) {
        ex.click();
        var rows = await wait(function(){ var r = [].slice.call(document.querySelectorAll(".rowitem[role=button]")); return r.length ? r : null; }, 2000) || [];
        out.menuRows = rows.map(function(r){ return r.textContent; });
        var n0 = got.length;
        var r = rows.find(function(r){ return /hull_n/.test(r.textContent) && /skin export/i.test(r.textContent); });
        if (r) r.click();
        var last = await wait(function(){ return got.length > n0 && got[got.length - 1]; }, 8000);
        out.menuWrote = last ? last.name + " " + same(last.data, fileOf("hull_n.dds")) : "nothing";
      }
      // Without a game folder the original is not offered (there is nothing to read it from).
      GameDB.stems = new Map();
      out.noOriginal = (await OneTex.slotChoices(slot)).some(function(c){ return /original/.test(c.label); });
    } finally { App.slots = keepSlots; App.activeSlot = keepActive; }
  } finally { OneTex.download = keepDl; decodeGameEntry = keepDec; GameDB.stems = keepStems; }
  return out;
}`;

// ---- an independent PNG reader, from the spec ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function readPNG(buf) {
  const b = Buffer.from(buf);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("no PNG signature");
  let p = 8, w = 0, h = 0, bad = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("latin1", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (crc(b.subarray(p + 4, p + 8 + len)) !== b.readUInt32BE(p + 8 + len)) bad++;
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("not 8-bit RGBA non-interlaced"); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
    if (type === "IEND") break;
  }
  if (bad) throw new Error(bad + " chunk CRC(s) wrong");
  const f = zlib.inflateSync(Buffer.concat(idat)), st = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = f[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const v = f[y * (st + 1) + 1 + x], a = x >= 4 ? out[y * st + x - 4] : 0, u = y ? out[(y - 1) * st + x] : 0, c = x >= 4 && y ? out[(y - 1) * st + x - 4] : 0;
      let pr = 0;
      if (ft === 1) pr = a; else if (ft === 2) pr = u; else if (ft === 3) pr = (a + u) >> 1;
      else if (ft === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      else if (ft !== 0) throw new Error("filter type " + ft);
      out[y * st + x] = (v + pr) & 255;
    }
  }
  return { w, h, rgba: out };
}
const b = s => new Uint8Array(Buffer.from(s, "base64"));
const diff = (a, c) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; return n; };

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== the PNG writer ===");
const px = b(r.px);
let dec = null;
try { dec = readPNG(b(r.png)); } catch (e) { R.bad("the PNG reads by the spec: " + e.message); }
if (dec) R.is(dec.w === 64 && dec.h === 32 && diff(dec.rgba, px) === 0,
  `a packed _n's four channels come back exactly through PNG, alpha 0 and alpha under 32 included (${dec ? diff(dec.rgba, px) : "-"} bytes differ)`);
R.is(r.pngPool === r.png && r.poolMode === "worker", `a worker writes the same PNG bytes as the codec on this thread (pool: ${r.poolMode})`);
R.is(r.tgaPool === true, "a TGA from the pool is writeTGA's bytes");
R.is(r.browserOpens === true, "the browser opens the file at its size, with its alpha exact");
let cdec = null; try { cdec = readPNG(b(r.canvasPng)); } catch (e) { R.bad("the canvas PNG reads: " + e.message); }
if (cdec) R.is(diff(cdec.rgba, px) > 0, `the oracle catches the forbidden route: a PNG through a canvas loses ${diff(cdec.rgba, px)} bytes of the same texels`);

console.log("\n=== save on a texture-search row ===");
R.is(r.saveButton, "a readable texture row has a save button");
R.is(r.searchDds && r.searchDds.name === "hull_c.dds" && r.searchDds.same, `the game's own file is the entry's raw .dds bytes (${JSON.stringify(r.searchDds)})`);
let sp = null; try { sp = r.searchPng.data && readPNG(b(r.searchPng.data)); } catch (e) { R.bad("the row's PNG reads: " + e.message); }
R.is(sp && r.searchPng.name === "hull_c.png" && diff(sp.rgba, b(r.searchPng.lv)) === 0, `as an image (PNG) is level 0 decoded, exactly (${r.searchPng.name})`);
R.is(r.searchTga && r.searchTga.name === "hull_c.tga" && r.searchTga.same, "as an image (TGA) is level 0 through writeTGA");

console.log("\n=== export texture… from a slot ===");
R.is(/^hull_c\.dds true/.test(r.exportSame.c) && /^hull_n\.dds true/.test(r.exportSame.n),
  `as the skin export writes it equals that texture's file from a full export, byte for byte (${JSON.stringify(r.exportSame)})`);
let np = null; try { np = readPNG(b(r.slotPng.data)); } catch (e) { R.bad("the slot's _n PNG reads: " + e.message); }
R.is(np && r.slotPng.name === "hull_n.png" && diff(np.rgba, b(r.slotPng.want)) === 0,
  `the _n as an image is the packed sheet the export collects, all four channels (${np ? diff(np.rgba, b(r.slotPng.want)) : "-"} bytes differ)`);
R.is(r.slotDds === "hull_c.dds true", `the game's original is the entry's raw bytes (${r.slotDds})`);
R.is(r.menuButton, "the slot's ⋮ menu has export texture…");
const rows = r.menuRows || [];
R.is(rows.length === 8 && ["hull_c", "hull_n"].every(s => [/skin export/i, /PNG/, /TGA/, /original/].every(re => rows.some(t => t.includes(s) && re.test(t)))),
  `its dialog offers both sheets as the export writes them, as PNG, as TGA and as the game's original (${rows.length} rows)`);
R.is(r.menuWrote === "hull_n.dds true", `picking a row writes that file (${r.menuWrote})`);
R.is(r.noOriginal === false, "with no game entry for the sheet, the original is not offered");

const errs = (r.__errs || []).concat(r.__rejs || []);
R.is(!errs.length, "no uncaught error on the page" + (errs.length ? ": " + errs.join(" | ") : ""));
R.finish();
