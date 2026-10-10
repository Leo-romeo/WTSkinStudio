// Layered interchange: a texture's stack out as OpenRaster and another editor's layers back in
// (ROADMAP 4.50 (16)).
//
// WHY THIS EXISTS. The point of an .ora is that Krita, GIMP or MyPaint open it and see the texture
// the app shows — one layer per layer, with what the format can say (opacity, visibility, blend,
// groups) left live and what it cannot (masks, part limits, blend-if, clips, effects) applied to the
// pixels. Nothing here can run Krita, so the file is held to three things that are not the code
// under test:
//   * the browser's own DOMParser reads `stack.xml` — it is well-formed, the reader in
//     `formats/ora.js` builds the same tree from it (and from a hand-written file with comments,
//     CDATA, a DOCTYPE, entities and single quotes), and the zip starts with the stored `mimetype`
//     entry the format requires, byte for byte;
//   * a REFERENCE OpenRaster renderer written here from the spec — the first child is the top, a
//     stack is isolated unless it is `auto`, source-over and opaque — composites the file's own PNGs
//     to the app's own composite of the same stack, texel for texel within a stated tolerance.
//     That stack has one of everything: a multiply layer, a hidden one, a fill under a soft mask, a
//     rotated decal, a normal group with an effect inside it, a masked multiply group (written as
//     one layer), a pass-through group with a part-limit rectangle and less than full opacity, a
//     blend-if layer, a clipped layer, a layer carrying two channels, a smoothness-only group and an
//     effect on top;
//   * the app's importer reads the same file back onto a fresh texture and composites it to the same
//     picture — and a file written the way other editors write them (cropped layers placed by x/y,
//     nested offsets, a pass-through stack, Porter-Duff and Krita-only modes, an SVG layer, a
//     missing image, an unknown element, a smaller canvas) lands with each of those said, not
//     guessed.
//
// PSD is the other half: Photoshop and Paint.NET do not open .ora. The same stack goes out as a PSD
// and is held to a reader, a writer and a renderer written HERE from Adobe's public specification —
// deliberately not `formats/psd.js`: other code, another PackBits coder (it makes repeat runs of two,
// the app's of three), JS arrays rather than typed ones. The spec reader walks every length in the
// file and must land exactly on its last byte; each layer's pixels must equal the PNG the .ora carries
// for the same layer (the two formats share one walk, so a crop or a plane written wrong shows); the
// merged image must be the app's sheet; the spec renderer must draw the app's composite from the
// file alone; and the worker and the inline fallback must write the same bytes. The spec writer then
// builds what Photoshop writes and the app has no equal for — clipping over a plain and a multiply
// base, masks with defaults, a disabled mask, a vector mask's "real" rectangle, mask parameters,
// closed and pass-through folders, Unicode names, fill opacity, an adjustment layer, a layer style,
// Linear Burn, a zip-compressed channel, an odd-length block; and (4c) what its review found — Hide
// All's mask of no area, a clipping base at Fill 0, a group's style, a faded Linear Dodge, a clip to
// an emptied group — with the brush's channel and a lone pass-through group; and 16-bit, PSB,
// greyscale and layerless files, and the refusals.
//
// With --install it reads the PSDs community skins ship in the install's UserSkins, IN PLACE (other
// people's work — nothing is copied), and composites their layers in the app against the flattened
// picture Photoshop itself saved in each file: an oracle for the reader that is not this project's.
//
// Usage: node tools/t101_layered.mjs [--install] [--keep] [--dump] [--chrome <path>]
import fs from "fs";
import path from "path";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";
import { installOrExit } from "./wtdir.mjs";

const argv = process.argv.slice(2);
// --install needs the game: no install is a failure here, before a browser is looked for — not a
// SKIP that exits 0 (tools/wtdir.mjs).
const WT = argv.includes("--install") ? installOrExit() : null;
// And what it reads there is looked for before the browser too, so a SKIP for want of PSDs says that
// and not "no Chrome": on a machine with no browser, t133 found this reported as the missing browser
// (review of 2026-10-10). An install with no UserSkins folder, or none of its skins shipping a PSD,
// leaves nothing to hold the reader to: said as SKIP, which tools/all.mjs counts as a failure of
// `layeredpsd` — it did not run.
const US = WT && path.join(WT, "UserSkins");
if (US && !fs.existsSync(US)) { console.log("SKIP: no UserSkins folder at " + US); process.exit(0); }
const psds = US ? fs.readdirSync(US, { recursive: true }).filter(f => /\.psd$/i.test(f)).map(f => path.join(US, f)) : [];
if (US && !psds.length) { console.log("SKIP: no PSD under " + US + " to compare against"); process.exit(0); }
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// What both page bodies share: a 64² sheet with a 32² surface, layers and groups made the way the app
// makes them, and the byte comparisons.
const HELPERS = `
  var N = 64, S = 32;
  var flat = function(hex, w, h){ var c = mkCanvas(w, h); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, w, h); return c; };
  var pat = function(w, h){
    var c = mkCanvas(w, h), g = ctx2d(c);
    var gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#203040"); gr.addColorStop(1, "#d0b070");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#806020"; g.fillRect(0, 0, w / 2, h / 2);
    g.fillStyle = "#e0e0e0"; g.fillRect(w / 2, h / 2, w / 4, h / 4);
    return c;
  };
  var mkSlot = function(id){
    var s = { id: id, size: N, nSize: S, layers: [], missing: false };
    s.baseC = pat(N, N); s.composite = mkCanvas(N, N);
    s.smooth = flat("#505050", S, S); s.metal = flat("#303030", S, S); s.normal = flat("#8080ff", S, S);
    App.slots.set(id, s);
    return s;
  };
  var paint = function(name, blend, opacity, draw, chan, w){
    var c = mkCanvas(w || N, w || N); draw(ctx2d(c), w || N);
    return LayerNode.of({ type: "paint", chan: chan, name: name, canvas: c, visible: true, opacity: opacity, blend: blend });
  };
  var grp = function(name, blend, opacity, kids){ return Object.assign(newGroupNode(name), { blend: blend, opacity: opacity, children: kids }); };
  var bytes = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var diff = function(a, b){
    var max = 0, n = 0;
    for (var i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d > max) max = d; if (d > 1) n++; }
    return { max: max, over1: n };
  };
  var decode = async function(blob){
    var bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    var c = mkCanvas(bmp.width, bmp.height); ctx2d(c).drawImage(bmp, 0, 0); bmp.close(); return c;
  };
  var fxLayer = function(name, fx, opacity){
    return LayerNode.of({ type: "adjust", name: name, visible: true, opacity: opacity, blend: "normal", hue: 0, sat: 100, bright: 100, contrast: 100, fx: fx });
  };
`;
// The stack with one of everything, on slot "t101a" — the one both formats are written from.
const STACK = `
  var A = mkSlot("t101a");
  var mul = paint("mul", "multiply", .6, function(g){ g.fillStyle = "#ff3030"; g.beginPath(); g.arc(20, 22, 13, 0, 7); g.fill(); });
  var hid = paint("hidden", "normal", 1, function(g){ g.fillStyle = "#00ff00"; g.fillRect(40, 4, 16, 10); });
  hid.visible = false;
  var tint = LayerNode.of({ type: "fill", name: "tint", color: "#3060ff", visible: true, opacity: .5, blend: "screen" });
  tint.mask = mkCanvas(N, N);
  (function(g){ var gr = g.createLinearGradient(0, 0, N, 0); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, N, N); })(ctx2d(tint.mask));
  var dbmp = mkCanvas(20, 12); ctx2d(dbmp).fillStyle = "#2040ff"; ctx2d(dbmp).fillRect(0, 0, 20, 12); ctx2d(dbmp).fillStyle = "#ffe000"; ctx2d(dbmp).fillRect(4, 3, 12, 6);
  var decalName = 'decal & "q" <a> \\u00e9\\ttab';
  var decal = LayerNode.of({ type: "decal", name: decalName, bmp: dbmp, x: .7, y: .3, scale: 1, rot: 25, flip: false, visible: true, opacity: 1, blend: "normal" });
  var g1paint = paint("g1paint", "overlay", 1, function(g){ for (var y = 0; y < N; y += 8) { g.fillStyle = y % 16 ? "#ffffff" : "#101010"; g.fillRect(0, y, N, 4); } });
  var g1fx = LayerNode.of({ type: "adjust", name: "g1fx", visible: true, opacity: 1, blend: "normal", hue: 90, sat: 150, bright: 100, contrast: 100 });
  var G1 = grp("G1", "normal", .9, [g1paint, g1fx]);
  var G2 = grp("G2", "multiply", 1, [LayerNode.of({ type: "fill", name: "g2a", color: "#ff8000", visible: true, opacity: 1, blend: "normal" })]);
  G2.mask = mkCanvas(N, N);
  (function(g){ var gr = g.createRadialGradient(N / 2, N / 2, 4, N / 2, N / 2, 30); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, N, N); })(ctx2d(G2.mask));
  var pa = paint("pa", "soft-light", 1, function(g){ g.fillStyle = "#f0f0f0"; g.fillRect(0, 20, N, 16); });
  var pb = LayerNode.of({ type: "fill", name: "pb", color: "#00ffff", visible: true, opacity: .7, blend: "color" });
  var P = grp("P", "pass through", .8, [pa, pb]);
  P.scope = { rect: { x: 8, y: 8, w: 40, h: 30 } };
  var grime = paint("grime", "normal", 1, function(g){ g.fillStyle = "#402010"; g.fillRect(0, 0, N, N); });
  grime.tone = { src: "lum", lo: 0, hi: .45, soft: .1, invert: false };
  var clip = LayerNode.of({ type: "fill", name: "clip", color: "#ffffff", visible: true, opacity: .4, blend: "normal" });
  clip.maskRef = LayerNode.BELOW;
  var both = paint("both", "normal", 1, function(g){ g.fillStyle = "rgba(200,40,160,0.5)"; g.fillRect(10, 44, 30, 12); });
  LayerNode.addContent(both, "smooth", LayerNode.content("fill", { color: "#c0c0c0" }));
  var gloss = paint("gloss", "normal", .8, function(g, w){ g.fillStyle = "#ffffff"; g.fillRect(0, 0, w / 2, w); }, "smooth", S);
  var surface = grp("Surface", "normal", 1, [gloss]);
  var fxTop = LayerNode.of({ type: "adjust", name: "fxTop", visible: true, opacity: .75, blend: "normal", hue: 0, sat: 60, bright: 110, contrast: 120 });
  A.layers = [mul, hid, tint, decal, G1, G2, P, grime, clip, both, surface, fxTop];
  App.activeSlot = A;
  Composite.sheet(A, "color", null);
  Composite.sheet(A, "smooth", null);
`;
// ---- PSD from the specification, written here and not in formats/psd.js (see the header) ----
// Big-endian throughout. A file: the 26-byte header ('8BPS', version 1 PSD or 2 PSB, six zero bytes,
// channels, height, width, depth, colour mode); colour-mode data and image resources, each a u32
// length; the layer and mask section (u32, u64 in a PSB), holding the layer info (u32 / u64 length,
// rounded to even: an i16 count, the records bottom first, then every record's channel data in
// order), the global mask info (u32 length) and tagged blocks (a 16-bit file's layers are an 'Lr16'
// block); then the merged image — a compression word and its planes, a PackBits image listing every
// row count of every plane before any row. A record: bounds (top, left, bottom, right), channel
// count, per channel an i16 id (-1 alpha, 0-2 RGB, -2 mask, -3 the "real" mask) and a u32 / u64
// length, '8BIM', a blend key, opacity, clipping, flags (bit 1 hidden), a filler, then the extra data
// (u32 length): mask data and blending ranges (each a u32 length), a Pascal name padded to 4, and
// tagged blocks ('8BIM', key, u32 length rounded to even) — 'luni' the UTF-16 name, 'lsct' a group
// marker (3 the divider below a group's children, 1 an open and 2 a closed folder above them, which
// carries the group's name, opacity and blend). A channel: a compression word (0 raw, 1 PackBits with
// a row count per row — u16, u32 in a PSB — 2 and 3 zip), then its samples; a 16-bit sample is two
// bytes, high first.
const SPEC = `
  var be = function(u, o, n){ var v = 0; for (var i = 0; i < n; i++) v = v * 256 + u[o + i]; return v; };
  var sbe = function(u, o, n){ var v = be(u, o, n), m = Math.pow(2, 8 * n); return v >= m / 2 ? v - m : v; };
  var asc = function(u, o, n){ var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(u[o + i]); return s; };
  // PackBits: a header h (signed) copies h+1 bytes when h >= 0, repeats the next byte 1-h times when
  // h is -1 … -127, and is nothing at -128. Returns the row and where the decoder stopped.
  var unpackBits = function(u, o, end, n){
    var out = new Uint8Array(n), d = 0;
    while (o < end && d < n) {
      var h = u[o++]; if (h > 127) h -= 256;
      if (h >= 0) { for (var i = 0; i <= h; i++) out[d++] = u[o++]; }
      else if (h !== -128) { var v = u[o++]; for (var j = 0; j < 1 - h; j++) out[d++] = v; }
    }
    return { row: out, at: o, full: d === n };
  };
  // One channel as 8-bit samples; "fits" says every row count and the channel length agreed.
  var specChannel = function(u, o, len, w, h, bps, psb){
    var comp = be(u, o, 2), s = o + 2, n = w * h * bps, raw = new Uint8Array(n), fits = true;
    if (comp === 0) { raw.set(u.subarray(s, s + n)); fits = 2 + n === len; }
    else if (comp === 1) {
      var cw = psb ? 4 : 2, p = s + h * cw;
      for (var y = 0; y < h; y++) {
        var cnt = be(u, s + y * cw, cw), r = unpackBits(u, p, p + cnt, w * bps);
        fits = fits && r.full && r.at === p + cnt;
        raw.set(r.row, y * w * bps); p += cnt;
      }
      fits = fits && p === o + len;
    } else return { comp: comp, plane: null, fits: true };
    var plane = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) plane[i] = raw[i * bps];
    return { comp: comp, plane: plane, fits: fits };
  };
  var specRead = function(u){
    var d = { sig: asc(u, 0, 4), version: be(u, 4, 2), zero6: be(u, 6, 6), channels: be(u, 12, 2), h: be(u, 14, 4), w: be(u, 18, 4), depth: be(u, 22, 2), mode: be(u, 24, 2) };
    var psb = d.version === 2, L = psb ? 8 : 4, bps = d.depth === 16 ? 2 : 1, o = 26;
    d.cmLen = be(u, o, 4); o += 4 + d.cmLen;
    d.irLen = be(u, o, 4); o += 4 + d.irLen;
    d.lmLen = be(u, o, L); o += L;
    var lmEnd = o + d.lmLen;
    d.liLen = be(u, o, L); o += L;
    var liEnd = o + d.liLen;
    d.count = sbe(u, o, 2); o += 2;
    var recs = [];
    for (var i = 0; i < Math.abs(d.count); i++) {
      var r = { top: sbe(u, o, 4), left: sbe(u, o + 4, 4), bottom: sbe(u, o + 8, 4), right: sbe(u, o + 12, 4), chans: [] }; o += 16;
      var nc = be(u, o, 2); o += 2;
      for (var k = 0; k < nc; k++) { r.chans.push({ id: sbe(u, o, 2), len: be(u, o + 2, L) }); o += 2 + L; }
      r.sig = asc(u, o, 4); r.key = asc(u, o + 4, 4); r.opacity = u[o + 8]; r.clipping = u[o + 9]; r.flags = u[o + 10]; r.filler = u[o + 11]; o += 12;
      var xEnd = o + 4 + be(u, o, 4); o += 4;
      r.maskLen = be(u, o, 4); o += 4 + r.maskLen;
      r.rangesLen = be(u, o, 4); o += 4 + r.rangesLen;
      var nl = u[o]; r.pascal = asc(u, o + 1, nl); o += Math.ceil((nl + 1) / 4) * 4;
      r.blocks = [];
      while (o < xEnd) {
        var bl = be(u, o + 8, 4);
        r.blocks.push({ sig: asc(u, o, 4), key: asc(u, o + 4, 4), data: u.subarray(o + 12, o + 12 + bl) });
        o += 12 + bl;
      }
      r.extraOver = o - xEnd;
      r.blocks.forEach(function(b){
        if (b.key === "luni") { var n = be(b.data, 0, 4), s = ""; for (var q = 0; q < n; q++) s += String.fromCharCode(be(b.data, 4 + 2 * q, 2)); r.luni = s; }
        if (b.key === "lsct") { r.lsct = be(b.data, 0, 4); if (b.data.length >= 12) r.lsctKey = asc(b.data, 8, 4); }
      });
      recs.push(r);
    }
    recs.forEach(function(r){
      r.chans.forEach(function(c){
        var m = c.id < -1, w = m ? 0 : r.right - r.left, h = m ? 0 : r.bottom - r.top;
        if (!m) { var x = specChannel(u, o, c.len, w, h, bps, psb); c.comp = x.comp; c.plane = x.plane; c.fits = x.fits; }
        o += c.len;
      });
    });
    d.liRest = liEnd - o;
    o = liEnd;
    d.gmLen = be(u, o, 4); o += 4 + d.gmLen;
    d.lmRest = lmEnd - o;
    o = lmEnd;
    d.mergedComp = be(u, o, 2);
    var W = d.w, H = d.h, n = W * H, cw = psb ? 4 : 2, s = o + 2, p = s + d.channels * H * cw, rgba = new Uint8ClampedArray(n * 4);
    for (var ch = 0; ch < 3; ch++) {
      for (var y = 0; y < H; y++) {
        var cnt = be(u, s + (ch * H + y) * cw, cw), r2 = unpackBits(u, p, p + cnt, W * bps);
        for (var x = 0; x < W; x++) rgba[(y * W + x) * 4 + ch] = r2.row[x * bps];
        p += cnt;
      }
    }
    for (var a = 3; a < rgba.length; a += 4) rgba[a] = 255;
    d.merged = rgba; d.end = p; d.fileLen = u.length; d.layers = recs;
    return d;
  };
  // A record's pixels on a sheet of the file's size, placed at its bounds.
  var specLayer = function(r, W, H){
    var c = mkCanvas(W, H), w = r.right - r.left, h = r.bottom - r.top;
    if (w > 0 && h > 0) {
      var img = new ImageData(w, h), by = function(id){ return r.chans.filter(function(x){ return x.id === id; })[0]; };
      [[0, 0], [1, 1], [2, 2], [-1, 3]].forEach(function(e){ var ch = by(e[0]); for (var i = 0; i < w * h; i++) img.data[i * 4 + e[1]] = ch ? ch.plane[i] : 255; });
      ctx2d(c).putImageData(img, r.left, r.top);
    }
    return c;
  };
  // The file as Photoshop composites it: bottom first, a group isolated unless it passes through at
  // full opacity. Photoshop's keys for the W3C formulas (soft light aside, Photoshop's own curve).
  var PS_BLEND = { "norm": "source-over", "mul ": "multiply", "scrn": "screen", "over": "overlay", "sLit": "soft-light", "hLit": "hard-light",
    "dark": "darken", "lite": "lighten", "div ": "color-dodge", "idiv": "color-burn", "diff": "difference", "smud": "exclusion",
    "hue ": "hue", "sat ": "saturation", "colr": "color", "lum ": "luminosity", "lddg": "lighter" };
  var specTree = function(recs){
    var root = [], open = [root];
    recs.forEach(function(r){
      if (r.lsct === 3) { open.push([]); return; }
      if ((r.lsct === 1 || r.lsct === 2) && open.length > 1) { var kids = open.pop(); open[open.length - 1].push({ rec: r, kids: kids }); return; }
      open[open.length - 1].push({ rec: r });
    });
    return root;
  };
  var specRender = function(d){
    var draw = function(list, g){
      list.forEach(function(n){
        var r = n.rec, key = r.lsctKey || r.key, a = r.opacity / 255;
        if (r.flags & 2) return;
        if (!n.kids) { g.globalAlpha = a; g.globalCompositeOperation = PS_BLEND[key] || "source-over"; g.drawImage(specLayer(r, d.w, d.h), 0, 0); }
        else if (key === "pass" && a >= 1) draw(n.kids, g);
        else { var k = mkCanvas(d.w, d.h); draw(n.kids, ctx2d(k)); g.globalAlpha = a; g.globalCompositeOperation = PS_BLEND[key] || "source-over"; g.drawImage(k, 0, 0); }
        g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      });
    };
    var outC = mkCanvas(d.w, d.h);
    draw(specTree(d.layers), ctx2d(outC));
    return outC;
  };
  // ---- the writer: bytes into a plain array ----
  var Bytes = function(){
    var a = [];
    var o = {
      u8: function(v){ a.push(v & 255); },
      u16: function(v){ a.push((v >> 8) & 255, v & 255); },
      u32: function(v){ for (var i = 3; i >= 0; i--) a.push(Math.floor(v / Math.pow(2, 8 * i)) & 255); },
      u64: function(v){ o.u32(Math.floor(v / 4294967296)); o.u32(v % 4294967296); },
      i16: function(v){ o.u16(v < 0 ? v + 65536 : v); },
      i32: function(v){ o.u32(v < 0 ? v + 4294967296 : v); },
      str: function(s){ for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 255); },
      put: function(b){ for (var i = 0; i < b.length; i++) a.push(b[i]); },
      len: function(){ return a.length; }, arr: a };
    return o;
  };
  // A different PackBits coder from the app's: any run of two or more repeats, the rest literal.
  var packRow = function(row){
    var out = [], i = 0;
    while (i < row.length) {
      var r = 1;
      while (i + r < row.length && r < 128 && row[i + r] === row[i]) r++;
      if (r >= 2) { out.push(257 - r, row[i]); i += r; continue; }
      var s = i;
      while (i < row.length && i - s < 128 && !(i + 1 < row.length && row[i + 1] === row[i])) i++;
      out.push(i - s - 1);
      for (var k = s; k < i; k++) out.push(row[k]);
    }
    return out;
  };
  // A plane of 8-bit values as a channel. At 16 bits each value is written high byte first with 0x5A
  // below it, which a reader must drop.
  var chanBytes = function(plane, w, h, comp, depth, psb){
    var rows = [];
    for (var y = 0; y < h; y++) { var row = []; for (var x = 0; x < w; x++) { row.push(plane[y * w + x]); if (depth === 16) row.push(0x5a); } rows.push(row); }
    var o = Bytes(); o.u16(comp);
    if (comp === 0) rows.forEach(function(r){ o.put(r); });
    else if (comp === 1) { var pk = rows.map(packRow); pk.forEach(function(p){ psb ? o.u32(p.length) : o.u16(p.length); }); pk.forEach(function(p){ o.put(p); }); }
    else o.put([0x78, 0x9c, 0x63, 0x60, 0x00]);                   // zip: bytes a reader must refuse, not read
    return o.arr;
  };
  var plane = function(w, h, f){ var p = new Uint8Array(Math.max(0, w * h)); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) p[y * w + x] = typeof f === "function" ? f(x, y) : f; return p; };
  // Solid colour over a rectangle, as the four channels.
  var rgbaCh = function(w, h, rgba, comp){ return [[-1, 3], [0, 0], [1, 1], [2, 2]].map(function(e){ return { id: e[0], plane: plane(w, h, rgba[e[1]]), comp: comp }; }); };
  var maskBytes = function(m){
    var o = Bytes(); o.i32(m.top); o.i32(m.left); o.i32(m.bottom); o.i32(m.right); o.u8(m.def); o.u8(m.flags || 0);
    if (m.params) o.put(m.params);
    if (m.real) { o.u8(m.real.flags || 0); o.u8(m.real.def); o.i32(m.real.top); o.i32(m.real.left); o.i32(m.real.bottom); o.i32(m.real.right); }
    else o.u16(0);                                                  // the 20-byte form's padding
    return o.arr;
  };
  var utf16 = function(s){ var o = Bytes(); o.u32(s.length); for (var i = 0; i < s.length; i++) o.u16(s.charCodeAt(i)); return o.arr; };
  var u32b = function(v){ var o = Bytes(); o.u32(v); return o.arr; };
  var lsctB = function(type, key){ var o = Bytes(); o.u32(type); if (key) { o.str("8BIM"); o.str(key); } return o.arr; };
  // L = { top, left, bottom, right, chans: [{ id, plane, comp, w, h }], key, opacity, clipping, flags, name, mask, blocks: [[key, bytes, noPad]] }
  var specRecord = function(L, depth, psb){
    var w = L.right - L.left, h = L.bottom - L.top;
    var datas = L.chans.map(function(c){ return chanBytes(c.plane, c.id < -1 ? c.w : w, c.id < -1 ? c.h : h, c.comp == null ? 1 : c.comp, depth, psb); });
    var o = Bytes();
    o.i32(L.top); o.i32(L.left); o.i32(L.bottom); o.i32(L.right);
    o.u16(L.chans.length);
    L.chans.forEach(function(c, i){ o.i16(c.id); psb ? o.u64(datas[i].length) : o.u32(datas[i].length); });
    o.str("8BIM"); o.str(L.key || "norm"); o.u8(L.opacity == null ? 255 : L.opacity); o.u8(L.clipping || 0); o.u8(L.flags || 0); o.u8(0);
    var x = Bytes(), m = L.mask ? maskBytes(L.mask) : [], nm = L.name || "", rg = L.ranges || [];
    x.u32(m.length); x.put(m);
    x.u32(rg.length); x.put(rg);                                   // blending ranges: Photoshop's Blend If
    var ps = x.len();
    x.u8(nm.length); x.str(nm); while ((x.len() - ps) % 4) x.u8(0);
    (L.blocks || []).forEach(function(b){
      var pad = b[1].length & 1;
      x.str("8BIM"); x.str(b[0]); x.u32(b[1].length + (b[2] ? 0 : pad)); x.put(b[1]); if (pad) x.u8(0);   // b[2]: a writer that does not count its pad
    });
    o.u32(x.len()); o.put(x.arr);
    return { rec: o.arr, data: datas };
  };
  // F = { version, w, h, depth, mode, channels, layers, count, lr16, merged: [planes], mergedComp }
  var specWrite = function(F){
    var psb = F.version === 2, depth = F.depth || 8, recs = F.layers.map(function(L){ return specRecord(L, depth, psb); });
    var li = Bytes();
    li.i16(F.count != null ? F.count : F.layers.length);
    recs.forEach(function(r){ li.put(r.rec); });
    recs.forEach(function(r){ r.data.forEach(function(d){ li.put(d); }); });
    if (li.len() & 1) li.u8(0);
    var lm = Bytes(), L = function(o, v){ psb ? o.u64(v) : o.u32(v); };
    // F.pre: a global block ahead of the layers. Those are padded to a multiple of four with the pad
    // not counted (psd-tools reads Photoshop's so), where a record's blocks are padded to two.
    if (F.lr16) {
      L(lm, 0); lm.u32(0);
      if (F.pre) { lm.str("8BIM"); lm.str("Txt2"); lm.u32(F.pre.length); lm.put(F.pre); for (var q = F.pre.length; q % 4; q++) lm.u8(0); }
      lm.str("8BIM"); lm.str("Lr16"); L(lm, li.len()); lm.put(li.arr);
    }
    else if (F.layers.length || F.count) { L(lm, li.len()); lm.put(li.arr); lm.u32(0); }
    var f = Bytes();
    f.str("8BPS"); f.u16(F.version || 1); f.u16(0); f.u16(0); f.u16(0); f.u16(F.channels || 3); f.u32(F.h); f.u32(F.w); f.u16(depth); f.u16(F.mode == null ? 3 : F.mode);
    f.u32(0); f.u32(0);
    L(f, lm.len()); f.put(lm.arr);
    var planes = F.merged || [plane(F.w, F.h, 0), plane(F.w, F.h, 0), plane(F.w, F.h, 0)];
    f.u16(1);
    var rows = [];
    planes.forEach(function(p){ for (var y = 0; y < F.h; y++) { var row = []; for (var x = 0; x < F.w; x++) { row.push(p[y * F.w + x]); if (depth === 16) row.push(0x5a); } rows.push(packRow(row)); } });
    rows.forEach(function(r){ psb ? f.u32(r.length) : f.u16(r.length); });
    rows.forEach(function(r){ f.put(r); });
    return new Uint8Array(f.arr);
  };
`;
const BODY = `async function(){
  var out = {};
  ${HELPERS}
  // A DOM element as the plain tree Ora.xml returns, so the two readings can be compared as JSON.
  var domTree = function(el){
    var attrs = {}; for (var i = 0; i < el.attributes.length; i++) attrs[el.attributes[i].name] = el.attributes[i].value;
    return { tag: el.tagName, attrs: attrs, kids: Array.prototype.map.call(el.children, domTree) };
  };
  var sameAsDom = function(xml){
    var dom = new DOMParser().parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length) return "DOMParser: not well-formed";
    return JSON.stringify(domTree(dom.documentElement)) === JSON.stringify(Ora.xml(xml)[0]) ? "same" : "differ";
  };
  // ---- the reference renderer: the file as the spec says to draw it, from the file alone ----
  var renderOra = async function(z, xml, W, H){
    var dom = new DOMParser().parseFromString(xml, "application/xml");
    var opName = function(op){ op = op || "svg:src-over"; return op === "svg:src-over" ? "source-over" : op === "svg:plus" ? "lighter" : op.replace(/^svg:/, ""); };
    var draw = async function(el, g){
      var kids = Array.prototype.filter.call(el.children, function(e){ return e.tagName === "layer" || e.tagName === "stack"; }).reverse();
      for (var i = 0; i < kids.length; i++) {
        var e = kids[i];
        if (e.getAttribute("visibility") === "hidden") continue;
        var op = opName(e.getAttribute("composite-op")), a = e.hasAttribute("opacity") ? parseFloat(e.getAttribute("opacity")) : 1;
        if (e.tagName === "layer") {
          var img = await decode(await z.file(e.getAttribute("src")).async("blob"));
          g.globalAlpha = a; g.globalCompositeOperation = op;
          g.drawImage(img, +(e.getAttribute("x") || 0), +(e.getAttribute("y") || 0));
        } else if (e.getAttribute("isolation") === "auto" && op === "source-over" && a >= 1) {
          await draw(e, g);                                    // not isolated: blends with what is beneath
        } else {
          var k = mkCanvas(W, H); await draw(e, ctx2d(k));
          g.globalAlpha = a; g.globalCompositeOperation = op; g.drawImage(k, 0, 0);
        }
        g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      }
    };
    var outC = mkCanvas(W, H);
    await draw(dom.querySelector("image > stack"), ctx2d(outC));
    return outC;
  };
  var wasActive = App.activeSlot;

  // ---- 1. the stack: one of everything ----
  ${STACK}
  out.chans = Interchange.chans(A);

  // ---- 2. out, and the file itself ----
  var res = await Interchange.packOra(A, "color");
  out.count = res.count; out.notes = res.notes;
  out.said = Interchange.saidOut("t101a.ora", "color", res);
  var u8 = new Uint8Array(await res.blob.arrayBuffer());
  var str = function(a, b){ return String.fromCharCode.apply(null, u8.slice(a, b)); };
  out.head = { sig: u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4, method: u8[8] | (u8[9] << 8), nameLen: u8[26] | (u8[27] << 8),
               extra: u8[28] | (u8[29] << 8), name: str(30, 38), body: str(38, 54), type: res.blob.type };
  var z = await JSZip.loadAsync(res.blob);
  var xml = await z.file("stack.xml").async("string");
  out.xml = xml;
  out.files = Object.keys(z.files).filter(function(k){ return !z.files[k].dir; });
  out.xmlSame = sameAsDom(xml);
  var dom = new DOMParser().parseFromString(xml, "application/xml");
  var img = dom.documentElement;
  out.image = { tag: img.tagName, w: img.getAttribute("w"), h: img.getAttribute("h") };
  var desc = function(el){
    return Array.prototype.map.call(el.children, function(e){
      var d = { tag: e.tagName, name: e.getAttribute("name"), op: e.getAttribute("composite-op"), opacity: +e.getAttribute("opacity"),
                vis: e.getAttribute("visibility") };
      if (e.tagName === "stack") { d.iso = e.getAttribute("isolation"); d.kids = desc(e); } else d.src = e.getAttribute("src");
      return d;
    });
  };
  out.tree = desc(dom.querySelector("image > stack"));
  // every raster is a whole sheet, and the ones the stencils went into carry them
  var sizes = [];
  for (var f of out.files) if (/^data\\//.test(f)) { var c = await decode(await z.file(f).async("blob")); sizes.push(c.width + "x" + c.height); }
  out.sizes = [...new Set(sizes)];
  var srcOf = function(name, list){ list = list || out.tree; for (var d of list) { if (d.name === name && d.src) return d.src; if (d.kids) { var s = srcOf(name, d.kids); if (s) return s; } } return null; };
  var hidPng = await decode(await z.file(srcOf("hidden")).async("blob"));
  out.hiddenPx = Array.from(ctx2d(hidPng).getImageData(48, 8, 1, 1).data);
  var tintPng = await decode(await z.file(srcOf("tint")).async("blob"));
  out.tintAlpha = [ctx2d(tintPng).getImageData(0, 30, 1, 1).data[3], ctx2d(tintPng).getImageData(32, 30, 1, 1).data[3], ctx2d(tintPng).getImageData(63, 30, 1, 1).data[3]];
  var g2Png = await decode(await z.file(srcOf("G2")).async("blob"));
  out.g2Alpha = [ctx2d(g2Png).getImageData(32, 32, 1, 1).data[3], ctx2d(g2Png).getImageData(2, 2, 1, 1).data[3]];
  var paPng = await decode(await z.file(srcOf("pa")).async("blob"));
  out.paAlpha = [ctx2d(paPng).getImageData(20, 25, 1, 1).data[3], ctx2d(paPng).getImageData(56, 25, 1, 1).data[3]];   // in P's rectangle, and outside it
  var merged = await decode(await z.file("mergedimage.png").async("blob"));
  var thumb = await decode(await z.file("Thumbnails/thumbnail.png").async("blob"));
  out.thumb = [thumb.width, thumb.height];
  out.mergedVsApp = diff(bytes(merged), bytes(A.composite));
  var ref = await renderOra(z, xml, N, N);
  out.refVsApp = diff(bytes(ref), bytes(A.composite));

  // ---- 2b. with no effect, decal or blend-if in it, the file is the app's picture exactly ----
  var E = mkSlot("t101e");
  var disc = function(g){ g.fillStyle = "#ff3030"; g.beginPath(); g.arc(20, 22, 13, 0, 7); g.fill(); };
  var stripes = function(g){ for (var y = 0; y < N; y += 8) { g.fillStyle = y % 16 ? "#ffffff" : "#101010"; g.fillRect(0, y, N, 4); } };
  var eTint = LayerNode.of({ type: "fill", name: "etint", color: "#3060ff", visible: true, opacity: .5, blend: "screen" });
  eTint.mask = tint.mask;
  var eUnder = paint("eunder", "normal", 1, function(g){ g.fillStyle = "#a05030"; g.beginPath(); g.arc(40, 40, 18, 0, 7); g.fill(); });
  var eClip = LayerNode.of({ type: "fill", name: "eclip", color: "#ffffff", visible: true, opacity: .4, blend: "normal" });
  eClip.maskRef = LayerNode.BELOW;
  var eG = grp("eG", "normal", .9, [paint("eov", "overlay", 1, stripes), paint("emul", "multiply", .6, disc)]);
  var eG2 = grp("eG2", "multiply", 1, [LayerNode.of({ type: "fill", name: "eg2a", color: "#ff8000", visible: true, opacity: 1, blend: "normal" })]);
  eG2.mask = G2.mask;
  var eP = grp("eP", "pass through", .8, [paint("epa", "soft-light", 1, function(g){ g.fillStyle = "#f0f0f0"; g.fillRect(0, 20, N, 16); }),
    LayerNode.of({ type: "fill", name: "epb", color: "#00ffff", visible: true, opacity: .7, blend: "color" })]);
  eP.scope = { rect: { x: 8, y: 8, w: 40, h: 30 } };
  E.layers = [paint("emul0", "multiply", .6, disc), eTint, eUnder, eClip, eG, eG2, eP];
  Composite.sheet(E, "color", null);
  var eres = await Interchange.packOra(E, "color");
  var ez = await JSZip.loadAsync(eres.blob);
  out.exactVsApp = diff(bytes(await renderOra(ez, await ez.file("stack.xml").async("string"), N, N)), bytes(E.composite));

  // ---- 2c. the effect kinds that land source-atop (4.50 (5)) ----
  // A Levels at rest and a Curves over a 70 % layer inside a normal group, an Invert in a
  // pass-through group and a Posterize on top. The group must be one layer — as a layer of its own
  // the Levels would cover the group's transparent 30 % — and the two at the top are exact.
  var F = mkSlot("t101f");
  var fUnder = paint("under70", "normal", .7, function(g){ g.fillStyle = "#c83c28"; g.fillRect(8, 8, 40, 30); });
  var G3 = grp("G3", "normal", 1, [fUnder, fxLayer("levels", Effect.make("levels"), 1),
    fxLayer("curves", { type: "curves", rgb: [[0, 0], [70, 40], [180, 215], [255, 255]] }, .8)]);
  F.layers = [G3, grp("fPass", "pass through", 1, [fxLayer("inv", { type: "invert" }, .5)]), fxLayer("post", { type: "posterize", levels: 4 }, .6)];
  Composite.sheet(F, "color", null);
  var fres = await Interchange.packOra(F, "color");
  var tz = await JSZip.loadAsync(fres.blob), txml = await tz.file("stack.xml").async("string");
  out.kinds = { tree: desc(new DOMParser().parseFromString(txml, "application/xml").querySelector("image > stack")), flatFx: fres.notes.flatFx,
                effects: fres.notes.effects, said: Interchange.saidOut("t101f.ora", "color", fres),
                refVsApp: diff(bytes(await renderOra(tz, txml, N, N)), bytes(F.composite)) };

  // ---- 3. back in, onto a fresh texture: the same picture ----
  var B = mkSlot("t101b");
  var back = await Interchange.readOra(res.blob);
  var ad = await Interchange.adoptOra(back.zip, back.doc, B, "color", "roundtrip");
  var node = ad.node;
  var shape = function(n){ return isGroup(n) ? { g: n.name, blend: n.blend, op: n.opacity, vis: n.visible, kids: n.children.map(shape) }
                                             : { l: n.name, blend: n.blend, op: +n.opacity.toFixed(4), vis: n.visible, chan: LayerNode.channelsOf(n).join() }; };
  out.back = shape(node);
  addLayerTo(B, node);
  Composite.sheet(B, "color", null);
  out.backVsApp = diff(bytes(B.composite), bytes(A.composite));
  out.backVsRef = diff(bytes(B.composite), bytes(ref));
  out.saidIn = Interchange.saidIn(ad, B, "color");

  // ---- 4. the smoothness channel: its own size, its own layers ----
  var sres = await Interchange.packOra(A, "smooth");
  var sz = await JSZip.loadAsync(sres.blob);
  var sxml = await sz.file("stack.xml").async("string");
  var sdom = new DOMParser().parseFromString(sxml, "application/xml");
  out.smooth = { w: sdom.documentElement.getAttribute("w"), h: sdom.documentElement.getAttribute("h"), tree: desc(sdom.querySelector("image > stack")) };
  var smerged = await decode(await sz.file("mergedimage.png").async("blob"));
  out.smoothVsApp = diff(bytes(smerged), bytes(A.chanC.smooth));
  var sref = await renderOra(sz, sxml, S, S);
  out.smoothRefVsApp = diff(bytes(sref), bytes(A.chanC.smooth));

  // ---- 5. a file written the way other editors write them ----
  var png = async function(w, h, fill){ return await canvasBlob(flat(fill, w, h)); };
  var fz = new JSZip();
  fz.file("mimetype", "image/openraster", { compression: "STORE" });
  var fxml = "<?xml version='1.0' encoding='UTF-8'?>\\n<!DOCTYPE image>\\n<!-- written by hand, in Krita's and GIMP's shape -->\\n" +
    "<image version='0.0.5' w='32' h='32'>\\n <stack>\\n" +
    "  <layer name='erase' src='data/e.png' composite-op='svg:dst-out'/>\\n" +
    "  <layer name='burn' src='data/b.png' composite-op='krita:linear_burn' opacity='0.7'/>\\n" +
    "  <stack name='Folder' isolation='auto' composite-op='svg:src-over'>\\n" +
    "   <layer name='add' src='data/a.png' composite-op='svg:plus' opacity='0.25'/>\\n" +
    "   <layer name='hard' src='data/h.png' composite-op='svg:hard-light' visibility='hidden'/>\\n" +
    "  </stack>\\n" +
    "  <stack name='Iso' x='4' y='2'>\\n   <layer name='off' src='data/o.png' x='3' y='5'/>\\n  </stack>\\n" +
    "  <layer name='vector' src='data/v.svg'/>\\n" +
    "  <layer name='ghost' src='data/missing.png'/>\\n" +
    "  <text x='1' y='1'><![CDATA[a <note> in CDATA]]></text>\\n" +
    "  <layer name='Rust &amp; grime &#x41;&#66;' src='./data/r.png' opacity='0.5'/>\\n" +
    "  <layer name='bg' src='data/bg.png'/>\\n" +
    " </stack>\\n</image>\\n";
  fz.file("stack.xml", fxml);
  fz.file("data/e.png", await png(32, 32, "#000000")); fz.file("data/b.png", await png(32, 32, "#553311"));
  fz.file("data/a.png", await png(32, 32, "#404040")); fz.file("data/h.png", await png(32, 32, "#808080"));
  fz.file("data/o.png", await png(6, 4, "#ff0000")); fz.file("data/r.png", await png(32, 32, "#8a4a20"));
  fz.file("data/bg.png", await png(32, 32, "#304050"));
  fz.file("data/v.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>');
  out.foreignXmlSame = sameAsDom(fxml);
  var C = mkSlot("t101c");
  var fb = await Interchange.readOra(await fz.generateAsync({ type: "blob" }));
  var fad = await Interchange.adoptOra(fb.zip, fb.doc, C, "color", "foreign");
  out.foreign = shape(fad.node);
  out.foreignNotes = { lost: fad.notes.lost, missing: fad.notes.missing, unread: fad.notes.unread.map(function(x){ return x.split(" (")[0]; }), skipped: fad.skipped, from: fad.from, to: fad.to };
  var off = fad.node.children.filter(function(n){ return n.name === "Iso"; })[0].children[0];
  out.offPx = { inside: ctx2d(off.canvas).getImageData(20, 18, 1, 1).data[0], edge: ctx2d(off.canvas).getImageData(15, 15, 1, 1).data[3],
                outside: ctx2d(off.canvas).getImageData(10, 10, 1, 1).data[3], size: [off.canvas.width, off.canvas.height] };
  out.foreignSaid = Interchange.saidIn(fad, C, "color");

  // ---- 6. the funnel a dropped file goes through, and one undo ----
  var D = mkSlot("t101d");
  App.activeSlot = D;
  await addFiles([new File([res.blob], "dropped.ora")]);
  out.funnel = { landed: D.layers.length === 1 && isGroup(D.layers[0]) && D.layers[0].name === "dropped", status: document.getElementById("status").textContent };
  doUndo();
  out.undone = D.layers.length === 0;

  // ---- 7. refusals, and the reader against DOMParser on the awkward parts of XML ----
  var nz = new JSZip(); nz.file("project.json", "{}");
  try { await Interchange.readOra(await nz.generateAsync({ type: "blob" })); out.noStack = "accepted"; } catch (e) { out.noStack = e.message; }
  try { Ora.parse('<image w="4" h="4"><stack><layer src="x.png"></stack></image>'); out.bad = "accepted"; } catch (e) { out.bad = e.message; }
  try { Ora.parse('<image><stack/></image>'); out.noSize = "accepted"; } catch (e) { out.noSize = e.message; }
  out.awkward = sameAsDom("<?xml version=\\"1.0\\"?>\\n<!DOCTYPE image>\\n<image a='1' b = \\"2\\"\\n  c='&lt;&gt;&amp;&quot;&apos;&#x41;&#66;'>" +
    "<!-- <stack> inside a comment --><stack><![CDATA[ <layer/> ]]><layer name=\\"x&#9;y\\" src='s.png'/></stack>text</image>");

  App.activeSlot = wasActive;
  ["t101a", "t101b", "t101c", "t101d", "t101e", "t101f"].forEach(function(k){ App.slots.delete(k); });
  out.decalName = decalName;
  return out;
}`;

// ---- the PSD half ----
const PSD_BODY = `async function(){
  var out = {};
  ${HELPERS}
  ${SPEC}
  var wasActive = App.activeSlot;
  var shape = function(n){ return isGroup(n) ? { g: n.name, blend: n.blend, op: +(+n.opacity).toFixed(4), vis: n.visible, kids: n.children.map(shape) }
                                             : { l: n.name, blend: n.blend, op: +(+n.opacity).toFixed(4), vis: n.visible, uid: n.uid, ref: n.maskRef || null, mask: !!n.mask }; };
  var readIn = async function(u8, name, slot){
    var rd = await Interchange.readPsd(new File([u8], name + ".psd"));
    return Interchange.adoptPsd(rd.b, rd.doc, slot, "color", name);
  };
  var tryIn = async function(u8, name, slot){ try { var a = await readIn(u8, name, slot); return { ok: true, a: a }; } catch (e) { return { ok: false, why: e.message }; } };

  // ---- 1. out: the stack with one of everything, as a PSD ----
  ${STACK}
  var res = await Interchange.packPsd(A, "color");
  out.type = res.blob.type;
  out.said = Interchange.saidOut("t101a.psd", "color", res, "psd");
  var u8 = new Uint8Array(await res.blob.arrayBuffer());
  var d = specRead(u8);
  out.head = { sig: d.sig, version: d.version, zero6: d.zero6, channels: d.channels, w: d.w, h: d.h, depth: d.depth, mode: d.mode, cm: d.cmLen, ir: d.irLen,
               count: d.count, liRest: d.liRest, gm: d.gmLen, lmRest: d.lmRest, mergedComp: d.mergedComp, end: d.end, fileLen: d.fileLen };
  out.recs = d.layers.map(function(r){ return { name: r.luni, pascal: r.pascal, sig: r.sig, key: r.key, op: r.opacity, clip: r.clipping, flags: r.flags,
    lsct: r.lsct || 0, lsctKey: r.lsctKey || null, box: [r.top, r.left, r.bottom, r.right], chans: r.chans.map(function(c){ return c.id + ":" + c.comp; }).join(" "),
    fits: r.chans.every(function(c){ return c.fits; }), over: r.extraOver, mask: r.maskLen, ranges: r.rangesLen }; });
  out.mergedVsApp = diff(d.merged, bytes(A.composite));
  var ref = specRender(d);
  out.refVsApp = diff(bytes(ref), bytes(A.composite));
  // The same rasters as the OpenRaster file of the same stack: one walk writes both.
  var ores = await Interchange.packOra(A, "color"), oz = await JSZip.loadAsync(ores.blob);
  var odom = new DOMParser().parseFromString(await oz.file("stack.xml").async("string"), "application/xml");
  var srcOf = {};
  Array.prototype.forEach.call(odom.querySelectorAll("layer"), function(e){ srcOf[e.getAttribute("name")] = e.getAttribute("src"); });
  out.vsOra = { n: 0, max: 0, missing: [] };
  for (var r of d.layers) {
    if (r.lsct) continue;
    if (!srcOf[r.luni]) { out.vsOra.missing.push(r.luni); continue; }
    var png = await decode(await oz.file(srcOf[r.luni]).async("blob"));
    var dd = diff(bytes(specLayer(r, d.w, d.h)), bytes(png));
    out.vsOra.n++; out.vsOra.max = Math.max(out.vsOra.max, dd.max);
  }
  out.hiddenBox = out.recs.filter(function(x){ return x.name === "hidden"; })[0].box;

  // ---- 2. back in, onto a fresh texture ----
  var B = mkSlot("t101b");
  var ad = await readIn(u8, "roundtrip", B);
  out.back = shape(ad.node);
  addLayerTo(B, ad.node);
  Composite.sheet(B, "color", null);
  out.backVsApp = diff(bytes(B.composite), bytes(A.composite));
  out.backVsRef = diff(bytes(B.composite), bytes(ref));
  out.saidIn = Interchange.saidIn(ad, B, "color");

  // ---- 3. the worker and the inline fallback write the same bytes ----
  var pool0 = Interchange._pool, W0 = window.Worker;
  out.workerMode = pool0 && pool0.mode;
  Interchange._pool = null;
  window.Worker = function(){ throw new Error("t101: no workers here"); };
  try {
    var ires = await Interchange.packPsd(A, "color");
    out.inlineMode = Interchange._pool.mode;
    var iu = new Uint8Array(await ires.blob.arrayBuffer());
    out.inlineSame = iu.length === u8.length && iu.every(function(v, i){ return v === u8[i]; });
  } finally { window.Worker = W0; if (Interchange._pool) Interchange._pool.dispose(); Interchange._pool = pool0; }

  // ---- 4. what Photoshop writes and this app has no equal for, built from the spec ----
  var red = [200, 30, 30, 255], white = [255, 255, 255, 255], blue = [20, 40, 220, 255], yellow = [240, 220, 20, 255];
  var box = function(t, l, b, r2, rgba, more){ return Object.assign({ top: t, left: l, bottom: b, right: r2, chans: rgbaCh(r2 - l, b - t, rgba) }, more || {}); };
  var div = function(){ return { top: 0, left: 0, bottom: 0, right: 0, chans: rgbaCh(0, 0, white, 0), name: "</Layer group>", flags: 24, blocks: [["lsct", lsctB(3)]] }; };
  var folder = function(name, key, type, op, flags){ return { top: 0, left: 0, bottom: 0, right: 0, chans: rgbaCh(0, 0, white, 0), name: name, key: key, opacity: op, flags: flags || 24,
                                                              blocks: [["luni", utf16(name)], ["lsct", lsctB(type, key)]] }; };
  var named = function(L, uname){ L.blocks = (L.blocks || []).concat([["luni", utf16(uname)]]); return L; };
  var masked = box(8, 8, 40, 40, red, { name: "masked", mask: { top: 16, left: 16, bottom: 32, right: 32, def: 0 } });
  masked.chans.push({ id: -2, w: 16, h: 16, plane: plane(16, 16, function(x){ return x < 8 ? 255 : 128; }) });
  var maskoff = box(8, 40, 24, 56, [30, 200, 30, 255], { name: "maskoff", mask: { top: 8, left: 40, bottom: 24, right: 56, def: 0, flags: 2 } });
  maskoff.chans.push({ id: -2, w: 16, h: 16, plane: plane(16, 16, 0) });
  var vmask = box(0, 0, 8, 8, blue, { name: "vmask", mask: { top: 0, left: 0, bottom: 8, right: 8, def: 0, real: { def: 0, top: 2, left: 2, bottom: 6, right: 6 } } });
  vmask.chans.push({ id: -2, w: 8, h: 8, plane: plane(8, 8, 255) }, { id: -3, w: 4, h: 4, plane: plane(4, 4, 255) });
  var params = box(56, 56, 64, 64, blue, { name: "params", mask: { top: 56, left: 56, bottom: 64, right: 64, def: 0, flags: 16,
    params: [3, 200, 0x40, 0x20, 0, 0, 0, 0, 0, 0], real: { def: 255, top: 58, left: 58, bottom: 62, right: 62 } } });
  params.chans.push({ id: -2, w: 8, h: 8, plane: plane(8, 8, 255) }, { id: -3, w: 4, h: 4, plane: plane(4, 4, 0) });
  var zipped = box(0, 0, 4, 4, red, { name: "zipped" });
  zipped.chans[1].comp = 2;
  var styled = box(44, 24, 60, 40, red, { name: "styled", blocks: [["zzzz", [1, 2, 3], true], ["iOpa", [128, 0, 0, 0]], ["lfx2", u32b(0)]] });
  // Blending ranges as Photoshop writes them (measured on the install's four PSDs: 40 bytes, ten
  // ranges of 0 0 255 255 when untouched) — and "bg"'s with the underlying grey's black point split.
  var untouched = [], blendIf = [];
  for (var q2 = 0; q2 < 10; q2++) { untouched.push(0, 0, 255, 255); blendIf.push.apply(blendIf, q2 === 1 ? [30, 60, 255, 255] : [0, 0, 255, 255]); }
  masked.ranges = untouched;
  var hand = { w: N, h: N, layers: [
    box(0, 0, N, N, [48, 64, 80, 255], { name: "bg", chans: rgbaCh(N, N, [48, 64, 80, 255], 0), ranges: blendIf }),
    div(), named(box(2, 2, 10, 10, [64, 64, 64, 255], { name: "add", key: "lddg", opacity: 128 }), "add"),
           named(box(2, 12, 10, 20, [90, 90, 90, 255], { name: "hard", key: "hLit", flags: 2 }), "hard"), folder("Folder", "pass", 1, 255),
    named(box(0, 20, 4, 24, red, { name: "orphan", clipping: 1 }), "orphan"),
    div(), named(box(24, 0, 32, 8, yellow, { name: "Layer 1" }), "\\u0421\\u043b\\u043e\\u0439 1"), folder("Closed", "norm", 2, 200),
    masked, maskoff,
    box(44, 8, 60, 24, white, { name: "base" }), box(0, 0, N, N, blue, { name: "clipped", clipping: 1 }), box(0, 0, N, N, yellow, { name: "clipped2", clipping: 1, opacity: 100 }),
    box(44, 40, 60, 56, white, { name: "mbase", key: "mul ", opacity: 128, blocks: [["iOpa", [200, 0, 0, 0]]] }), box(0, 0, N, N, yellow, { name: "mclip", clipping: 1 }),
    { top: 0, left: 0, bottom: 0, right: 0, chans: rgbaCh(0, 0, white, 0), name: "adj", blocks: [["levl", [0, 2, 0, 0]]] },
    styled, box(30, 30, 34, 34, red, { name: "burn", key: "lbrn" }), vmask, params, zipped] };
  var hu = specWrite(hand);
  var H = mkSlot("t101h");
  var hi = await tryIn(hu, "handmade", H);
  out.hand = hi.ok ? { tree: shape(hi.a.node), notes: hi.a.notes, said: Interchange.saidIn(hi.a, H, "color"), from: hi.a.from, to: hi.a.to } : { threw: hi.why };
  if (hi.ok) {
    var find = function(n, name){ if (n.name === name && !isGroup(n)) return n; if (isGroup(n)) for (var k of n.children) { var f = find(k, name); if (f) return f; } return null; };
    var F1 = function(name){ return find(hi.a.node, name) || {}; };
    var at = function(c, x, y){ return c ? Array.from(ctx2d(c).getImageData(x, y, 1, 1).data) : [-1, -1, -1, -1]; };
    out.handPx = {
      masked: [at(F1("masked").mask, 20, 20)[3], at(F1("masked").mask, 28, 20)[3], at(F1("masked").mask, 10, 10)[3], at(F1("masked").canvas, 10, 10)],
      maskoff: !!F1("maskoff").mask,
      vmask: [at(F1("vmask").mask, 3, 3)[3], at(F1("vmask").mask, 1, 1)[3]],
      params: [at(F1("params").mask, 60, 60)[3], at(F1("params").mask, 57, 57)[3]],
      inner: at(F1("\\u0421\\u043b\\u043e\\u0439 1").canvas, 4, 28),
      bg: at(F1("bg").canvas, 50, 50) };
  }

  // ---- 4b. a group's own mask, a clipping base's mask, and groups clipped to a layer ----
  // A folder record carries a group's layer mask as a layer's record carries its own; the base of a
  // clipping stack masks what is clipped to it with its mask as well as its pixels; and a group can
  // be clipped to a layer — plain, or holding a mask of its own. Each is read structurally and then
  // composited by the app at points where the rule and its absence differ.
  var withMask = function(L, m, pl){ L.mask = m; L.chans.push({ id: -2, w: m.right - m.left, h: m.bottom - m.top, plane: pl }); return L; };
  var gF = withMask(folder("MaskedG", "norm", 1, 255), { top: 8, left: 8, bottom: 24, right: 24, def: 0 }, plane(16, 16, function(x){ return x < 8 ? 255 : 64; }));
  var cgF = Object.assign(folder("ClipG", "norm", 1, 255), { clipping: 1 });
  var cmF = Object.assign(withMask(folder("ClipMG", "mul ", 1, 255), { top: 40, left: 36, bottom: 48, right: 44, def: 255 }, plane(8, 8, 0)), { clipping: 1 });
  var gFile = { w: N, h: N, layers: [
    box(0, 0, N, N, [48, 64, 80, 255], { name: "bg", chans: rgbaCh(N, N, [48, 64, 80, 255], 0) }),
    div(), box(0, 0, 32, 32, red, { name: "inG" }), gF,
    withMask(box(0, 32, 32, 64, white, { name: "kbase" }), { top: 8, left: 40, bottom: 24, right: 56, def: 255 }, plane(16, 16, 0)),
    box(0, 32, 32, 64, blue, { name: "kclip", clipping: 1 }),
    box(32, 0, 64, 16, white, { name: "gbase" }), div(), box(32, 0, 64, 32, yellow, { name: "inCG" }), cgF,
    box(32, 32, 64, 48, white, { name: "gbase2" }), div(), box(32, 32, 64, 64, blue, { name: "inCMG" }), cmF] };
  var at4 = function(c, x, y){ return c ? Array.from(ctx2d(c).getImageData(x, y, 1, 1).data) : [-1, -1, -1, -1]; };
  var G4 = mkSlot("t101g");
  var gi = await tryIn(specWrite(gFile), "grouped", G4);
  if (!gi.ok) out.grp = { threw: gi.why };
  else {
    var gk = gi.a.node.children, gn = function(name){ return gk.filter(function(k){ return k.name === name; })[0] || {}; };
    var MG = gn("MaskedG"), KB = gn("kbase"), CG = gn("ClipG"), CW = gn("ClipMG"), CM = (CW.children || [])[0] || {};
    var uidOf = function(name){ var n = gk.filter(function(k){ return k.name === name && !isGroup(k); })[0]; return n ? n.uid : "none"; };
    var kbIn = (KB.children || [])[0] || {}, kcl = (KB.children || [])[1] || {};
    out.grp = {
      top: gk.map(function(k){ return k.name + (isGroup(k) ? "/" : ""); }).join(" "),
      gmask: MG.mask ? [at4(MG.mask, 12, 12)[3], at4(MG.mask, 20, 12)[3], at4(MG.mask, 4, 4)[3]] : null,
      kbase: { group: isGroup(KB), mask: KB.mask ? [at4(KB.mask, 48, 16)[3], at4(KB.mask, 36, 4)[3]] : null, kids: (KB.children || []).map(function(k){ return k.name; }).join(),
               innerMask: !!kbIn.mask, clipRef: kcl.maskRef === kbIn.uid },
      clipG: { group: isGroup(CG), ref: CG.maskRef === uidOf("gbase") },
      clipMG: { wrap: isGroup(CW) && CW.blend === "pass through", ref: CW.maskRef === uidOf("gbase2"), inner: isGroup(CM) && CM.blend === "multiply" && !!CM.mask },
      said: Interchange.saidIn(gi.a, G4, "color") };
    addLayerTo(G4, gi.a.node);
    Composite.sheet(G4, "color", null);
    var gp = function(x, y){ return at4(G4.composite, x, y).slice(0, 3); };
    out.grp.px = { g255: gp(12, 12), g64: gp(20, 12), gOut: gp(4, 4), kIn: gp(36, 4), kHole: gp(48, 16), cgIn: gp(8, 40), cgOut: gp(24, 40),
                   cmIn: gp(40, 36), cmHole: gp(40, 44), cmOut: gp(56, 36) };
  }

  // ---- 4c. what the review of 2026-09-27 found the reader getting wrong or not saying ----
  // Each file is landed on a texture of its own and composited by the app at points where the rule
  // and its absence differ; see the checks for what each stands for.
  var BG4 = [48, 64, 80, 255], bgRec = function(rgba){ return box(0, 0, N, N, rgba || BG4, { name: "bg", chans: rgbaCh(N, N, rgba || BG4, 0) }); };
  var emptyMask = function(L, def){ L.mask = { top: 0, left: 0, bottom: 0, right: 0, def: def }; L.chans.push({ id: -2, w: 0, h: 0, plane: plane(0, 0, 0), comp: 0 }); return L; };
  var adjRec = function(){ return { top: 0, left: 0, bottom: 0, right: 0, chans: rgbaCh(0, 0, white, 0), name: "adj", blocks: [["levl", [0, 2, 0, 0]]] }; };
  var land4 = async function(u8, name){
    var S4 = mkSlot("t101r" + name), t4 = await tryIn(u8, name, S4);
    if (!t4.ok) return { threw: t4.why };
    addLayerTo(S4, t4.a.node);
    Composite.sheet(S4, "color", null);
    return { node: t4.a.node, notes: t4.a.notes, said: Interchange.saidIn(t4.a, S4, "color"), px: function(x, y){ return at4(S4.composite, x, y).slice(0, 3); } };
  };
  var rev = {};
  // Hide All: a mask of no area at default 0 — on a layer, on a group's folder, on a clipping base —
  // and a mask of no area at default 255, which is no mask.
  var hideG = emptyMask(folder("HiddenByMask", "norm", 1, 255), 0);
  var E4 = await land4(specWrite({ w: N, h: N, layers: [bgRec(),
    emptyMask(box(8, 8, 24, 24, red, { name: "hideall" }), 0), emptyMask(box(8, 40, 24, 56, blue, { name: "revealall" }), 255),
    div(), box(28, 8, 44, 24, red, { name: "inHidden" }), hideG,
    emptyMask(box(28, 40, 44, 56, white, { name: "hbase" }), 0), box(0, 0, N, N, blue, { name: "hclip", clipping: 1 })] }), "emptymask");
  if (!E4.threw) {
    var fnd = function(n, name){ if (n.name === name && !isGroup(n)) return n; if (isGroup(n)) for (var k of n.children) { var f = fnd(k, name); if (f) return f; } return null; };
    rev.empty = { layer: E4.px(12, 12), reveal: E4.px(44, 12), revealMask: !!(fnd(E4.node, "revealall") || {}).mask, group: E4.px(12, 32), base: E4.px(44, 32),
                  under: E4.px(32, 60), said: E4.said };
  } else rev.empty = E4;
  // A clipping base at opacity 255 but Fill 0 — a shape only — under a Multiply: the stack is blended
  // as one, so the Multiply has nothing under it but the base at its fill.
  var F4 = await land4(specWrite({ w: N, h: N, layers: [bgRec(),
    box(8, 8, 40, 40, white, { name: "shape", blocks: [["iOpa", [0, 0, 0, 0]]] }), box(0, 0, N, N, blue, { name: "mulclip", clipping: 1, key: "mul " })] }), "fill0");
  rev.fill0 = F4.threw ? F4 : { on: F4.px(20, 20), off: F4.px(50, 50), top: F4.node.children.map(function(k){ return k.name + (isGroup(k) ? "/" : ""); }).join(" ") };
  // A layer clipped to a group left with nothing in it (it held a Levels alone): unclipped and named,
  // not clipped to the layer under the group.
  var C4 = await land4(specWrite({ w: N, h: N, layers: [bgRec(), box(8, 8, 24, 24, white, { name: "under" }),
    div(), adjRec(), folder("Grading", "norm", 1, 255), box(0, 0, N, N, blue, { name: "onGrading", clipping: 1 })] }), "emptied");
  rev.emptied = C4.threw ? C4 : { inside: C4.px(12, 12), outside: C4.px(40, 40), clip: C4.notes.clip.join(), adjust: C4.notes.adjust.join(), said: C4.said };
  // A group's layer style, Linear Dodge faded by opacity (a layer and a group), and two that are not
  // faded that way: one at full opacity and one faded by its Fill, which Photoshop applies inside the add.
  var styledG = folder("StyledGroup", "norm", 1, 255);
  styledG.blocks.push(["lfx2", u32b(0)]);
  var S4f = await land4(specWrite({ w: N, h: N, layers: [bgRec([204, 204, 204, 255]),
    div(), box(8, 8, 24, 24, red, { name: "inStyled" }), styledG,
    box(28, 0, 36, N, [128, 128, 128, 255], { name: "addhalf", key: "lddg", opacity: 128 }),
    box(40, 0, 44, N, [128, 128, 128, 255], { name: "addfill", key: "lddg", blocks: [["iOpa", [128, 0, 0, 0]]] }),
    box(48, 0, 52, N, [16, 16, 16, 255], { name: "addfull", key: "lddg" }),
    div(), box(56, 0, 60, N, [128, 128, 128, 255], { name: "inAddGroup" }), folder("AddGroup", "lddg", 1, 128)] }), "said");
  rev.said = S4f.threw ? S4f : { fx: S4f.notes.fx.join(), dodge: S4f.notes.dodge.join(), said: S4f.said };
  // ...and out: a lighter layer below full opacity, one inside a pass-through group at half, one at full.
  var LD = mkSlot("t101l");
  LD.layers = [paint("glow", "lighter", .5, function(g){ g.fillStyle = "#808080"; g.fillRect(0, 0, N, 20); }),
               grp("PT", "pass through", .5, [paint("ptglow", "lighter", 1, function(g){ g.fillStyle = "#808080"; g.fillRect(0, 24, N, 16); })]),
               paint("full", "lighter", 1, function(g){ g.fillStyle = "#101010"; g.fillRect(0, 44, N, 16); })];
  Composite.sheet(LD, "color", null);
  var ldres = await Interchange.packPsd(LD, "color");
  rev.dodgeOut = { notes: ldres.notes.dodge.join(), said: Interchange.saidOut("t101l.psd", "color", ldres, "psd") };
  var ldOra = await Interchange.packOra(LD, "color");
  rev.dodgeOra = Interchange.saidOut("t101l.ora", "color", ldOra, "ora");
  // An import lands on the channel the brush is in (4.28's D4), at that sheet's size.
  var CH = mkSlot("t101c"), chWas = App.brush.chan;
  App.brush.chan = "smooth";
  try {
    var chNode = await Interchange.importFile(new File([specWrite({ w: N, h: N, layers: [box(0, 0, N, N, [200, 200, 200, 255], { name: "gloss" })] })], "gloss.psd"), CH);
    rev.chan = { chan: chNode && layerChan(chNode), onSmooth: !!(chNode && LayerNode.contentOn(chNode, "smooth")), onColour: !!(chNode && LayerNode.contentOn(chNode, "color")),
                 w: chNode && chNode.canvas ? chNode.canvas.width : -1, status: document.getElementById("status").textContent };
  } catch (e) { rev.chan = { threw: e.message }; }
  finally { App.brush.chan = chWas; }
  // A file whose only node is a pass-through group lands wrapped in a normal group named after the
  // file: bare, the Multiply in it would blend with the texture, where the file's own root had nothing.
  var P4 = await land4(specWrite({ w: N, h: N, layers: [div(), box(0, 0, N, N, red, { name: "mulred", key: "mul " }), folder("Solo", "pass", 1, 255)] }), "solo");
  rev.solo = P4.threw ? P4 : { g: P4.node.name, blend: P4.node.blend, kids: isGroup(P4.node) ? P4.node.children.map(function(k){ return k.name + ":" + k.blend; }).join() : "",
                               px: P4.px(50, 10) };
  out.rev = rev;

  // ---- 5. 16-bit, PSB, greyscale and a file with no layers ----
  var deep = specWrite({ w: 16, h: 16, depth: 16, lr16: true, layers: [named(box(0, 0, 16, 16, [0x80, 0x40, 0x20, 0xff], { name: "deep" }), "deep")] });
  // The same behind a 6-byte block — two bytes of pad to four, uncounted. Read as a pad of len & 1,
  // the reader stops on the pad, finds no layers and lands the flattened picture (black here).
  var deep4 = specWrite({ w: 16, h: 16, depth: 16, lr16: true, pre: [1, 2, 3, 4, 5, 6],
    layers: [named(box(0, 0, 16, 16, [0x80, 0x40, 0x20, 0xff], { name: "behind" }), "behind")] });
  var psbF = specWrite({ version: 2, w: 32, h: 32, layers: [named(box(4, 4, 28, 28, [10, 200, 90, 255], { name: "big" }), "big")] });
  var greyF = specWrite({ w: 16, h: 16, mode: 1, channels: 1, merged: [plane(16, 16, 0)],
    layers: [{ top: 0, left: 0, bottom: 16, right: 16, name: "grey", chans: [{ id: -1, plane: plane(16, 16, 255) }, { id: 0, plane: plane(16, 16, 77) }] }] });
  var flatF = specWrite({ w: 16, h: 16, layers: [], merged: [plane(16, 16, 11), plane(16, 16, 22), plane(16, 16, 33)] });
  var V = mkSlot("t101v");
  var px0 = function(n){ var L = isGroup(n) ? n.children[0] : n; return Array.from(ctx2d(L.canvas).getImageData(20, 20, 1, 1).data); };
  var v = {};
  for (var e of [["deep", deep], ["deep4", deep4], ["psb", psbF], ["grey", greyF], ["flat", flatF]]) {
    var t = await tryIn(e[1], e[0], V);
    v[e[0]] = t.ok ? { name: t.a.node.name, px: px0(t.a.node), from: t.a.from, to: t.a.to, said: Interchange.saidIn(t.a, V, "color") } : { threw: t.why };
  }
  out.variants = v;

  // ---- 6. refusals ----
  var edit = function(u, at, bytes2){ var c = new Uint8Array(u); bytes2.forEach(function(b, i){ c[at + i] = b; }); return c; };
  var refuse = {};
  var cases = [["cmyk", edit(flatF, 24, [0, 4])], ["deep32", edit(flatF, 22, [0, 32])], ["v3", edit(flatF, 4, [0, 3])], ["notpsd", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27])],
               ["cut", hu.slice(0, hu.length >> 1)],
               ["allzip", specWrite({ w: 8, h: 8, depth: 16, layers: [box(0, 0, 8, 8, red, { name: "z", chans: rgbaCh(8, 8, red, 2) })] })]];
  for (var cse of cases) { var t2 = await tryIn(cse[1], cse[0], V); refuse[cse[0]] = t2.ok ? "accepted" : t2.why; }
  out.refuse = refuse;

  // ---- 7. the funnel a dropped file goes through, and one undo ----
  var D = mkSlot("t101d");
  App.activeSlot = D;
  await addFiles([new File([res.blob], "dropped.psd")]);
  out.funnel = { landed: D.layers.length === 1 && isGroup(D.layers[0]) && D.layers[0].name === "dropped", status: document.getElementById("status").textContent };
  doUndo();
  out.undone = D.layers.length === 0;
  await addFiles([new File([psbF], "big.psb")]);                   // a PSB comes through the same door
  out.psbFunnel = D.layers.length === 1 && D.layers[0].name === "big";
  doUndo();

  App.activeSlot = wasActive;
  ["t101a", "t101b", "t101d", "t101g", "t101h", "t101v", "t101l", "t101c", "t101remptymask", "t101rfill0", "t101remptied", "t101rsaid", "t101rsolo"].forEach(function(k){ App.slots.delete(k); });
  return out;
}`;

// ---- --install: Photoshop's own files, against the composite Photoshop saved in each ----
// Every PSD a community skin ships in the install's UserSkins is handed to the page as the File the
// user would pick (CDP's DOM.setFileInputFiles, as t85 hands over the install): read, its layers
// adopted at the file's own size onto a TRANSPARENT sheet — Photoshop's composite is over nothing —
// composited by the app, and compared with the merged image in the file, premultiplied (a colour
// under alpha 0 is not a colour). A heartbeat every 5 ms records the longest the page went without
// one during the import: this runs with --disable-gpu, so it is a software figure, reported, not held.
const INSTALL_BODY = `async function(){
  var files = Array.prototype.slice.call(document.getElementById("t101psd").files), out = [];
  var beat = { max: 0, last: performance.now() };
  var hb = setInterval(function(){ var t = performance.now(); beat.max = Math.max(beat.max, t - beat.last); beat.last = t; }, 5);
  for (var f of files) {
    var o = { name: f.name, bytes: f.size };
    try {
      var t0 = performance.now(), rd = await Interchange.readPsd(f), doc = rd.doc, W = doc.w, H = doc.h;
      o.doc = { w: W, h: H, depth: doc.depth, mode: doc.mode, records: doc.layers.length, mergedAlpha: doc.mergedAlpha, channels: doc.channels };
      var s = { id: "t101i", size: W, nSize: W, layers: [], missing: false, baseC: mkCanvas(W, H), composite: mkCanvas(W, H) };
      App.slots.set(s.id, s);
      beat.max = 0; beat.last = performance.now();
      var ad = await Interchange.adoptPsd(rd.b, doc, s, "color", f.name.replace(/[.]psd$/i, ""));
      o.ms = Math.round(performance.now() - t0); o.gap = Math.round(beat.max);
      o.count = ad.count; o.notes = ad.notes;
      s.layers = [ad.node];
      Composite.sheet(s, "color", null);
      var got = ctx2d(s.composite).getImageData(0, 0, W, H).data, want = Psd.merged(rd.b, doc);
      var maxA = 0, maxC = 0, overA = 0, overC = 0, worst = [];
      for (var i = 0; i < W * H; i++) {
        var k = i * 4, ga = got[k + 3], wa = want[k + 3], da = Math.abs(ga - wa);
        if (da > maxA) maxA = da;
        if (da > 2) overA++;
        for (var c = 0; c < 3; c++) {
          var dc = Math.abs(got[k + c] * ga - want[k + c] * wa) / 255;
          if (dc > maxC) maxC = dc;
          if (dc > 2) { overC++; if (worst.length < 8) worst.push({ x: i % W, y: Math.floor(i / W), c: c, got: Array.from(got.slice(k, k + 4)), want: Array.from(want.slice(k, k + 4)) }); }
        }
      }
      o.cmp = { maxA: maxA, overA: overA, maxC: Math.round(maxC * 10) / 10, overC: overC, texels: W * H, worst: worst };
      App.slots.delete(s.id);
    } catch (e) { o.threw = e.message; }
    out.push(o);
  }
  clearInterval(hb);
  return out;
}`;
if (argv.includes("--install")) {
  // US and psds were found above, before the browser was looked for.
  const ir = await evalInPage({ browser, keep: argv.includes("--keep"), timeoutMs: 600000,
    drive: async ({ cdp, contextId, evaluate }) => {
      await evaluate(`new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", () => r()))`);
      await evaluate(`new Promise(r => setTimeout(r, 400))`);
      await evaluate(`(function(){ var i = document.createElement("input"); i.type = "file"; i.multiple = true; i.id = "t101psd"; i.style.display = "none"; document.body.appendChild(i); return true; })()`);
      const input = await cdp.send("Runtime.evaluate", { expression: `document.getElementById("t101psd")`, contextId });
      await cdp.send("DOM.setFileInputFiles", { files: psds, objectId: input.result.objectId });
      const res = await evaluate(`(${INSTALL_BODY})()`, 590000);
      const errs = await evaluate(`((window.__boot || {}).errs || [])`);
      return { res, errs };
    } });
  if (!ir.ok) { console.log("FAIL: " + ir.reason); process.exit(1); }
  if (argv.includes("--dump")) console.log(JSON.stringify(ir.result, null, 1));
  console.log(`\n=== ${psds.length} PSD${psds.length === 1 ? "" : "s"} under ${US}, read in place ===`);
  for (const o of ir.result.res) {
    if (o.threw) { R.bad(`${o.name}: ${o.threw}`); continue; }
    const c = o.cmp;
    // Tolerance, measured 2026-09-27 on the four files in this install: the one-layer file and the
    // 4096² two-layer one agree with Photoshop within 1 everywhere; the two masked two-layer files
    // within 1 in alpha and 2.9 in premultiplied colour, on 55 of 3 145 728 values — at alpha 235 or
    // 236, where the canvas has rounded two soft layers to 8 bits and one level of Photoshop's matted
    // byte is itself 1.08 levels of colour. Left as straight colour (not un-matted), the same files
    // were 35.7 levels off on 25 583 values; with a mask ignored or its default misread, thousands of
    // texels are off by tens of levels. The bound is 3, on at most 1 value in 10 000.
    R.is(c.maxA <= 2 && c.maxC <= 3 && c.overC <= c.texels * 3 / 10000,
      `${o.name} (${o.doc.w}×${o.doc.h}, ${o.count.layers} layer${o.count.layers === 1 ? "" : "s"}${o.notes.adjust.length ? ", " + o.notes.adjust.length + " adjustment" : ""}): the app's composite of its layers is the picture Photoshop saved — alpha within ${c.maxA}, premultiplied colour within ${c.maxC} (${c.overC} of ${c.texels * 3} over 2); read and adopted in ${o.ms} ms, longest gap ${o.gap} ms`);
  }
  const ie = (ir.result.errs || []).filter(e => !/net::|Failed to load/i.test(e));
  R.is(ie.length === 0, ie.length ? "uncaught errors during the run:\n        " + ie.join("\n        ") : "no uncaught errors during the run");
  R.finish();
}

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
if (argv.includes("--dump")) console.log(JSON.stringify(r, null, 1));

// ---- 1-2: the file ----
R.is(r.chans.join() === "color,smooth", `the texture offers the two channels it has layers on: ${r.chans.join(", ")}`);
R.is(r.head.sig && r.head.name === "mimetype" && r.head.method === 0 && r.head.nameLen === 8 && r.head.extra === 0 && r.head.body === "image/openraster",
  `the zip opens with the stored mimetype entry the format requires: “${r.head.name}”, method ${r.head.method}, extra ${r.head.extra}, “${r.head.body}” at byte 38`);
R.is(r.head.type === "image/openraster", `the blob says what it is (${r.head.type})`);
R.is(["stack.xml", "mergedimage.png", "Thumbnails/thumbnail.png"].every(f => r.files.includes(f)) && r.files.filter(f => /^data\/layer\d{3}\.png$/.test(f)).length === r.count.layers,
  `stack.xml, mergedimage.png, a thumbnail and one PNG per layer (${r.count.layers} layers in ${r.count.groups} groups): ${r.files.length} files`);
R.is(r.xmlSame === "same", `stack.xml is well-formed, and the reader in formats/ora.js builds DOMParser's tree from it (${r.xmlSame})`);
R.is(r.image.tag === "image" && r.image.w === "64" && r.image.h === "64", `<image w="${r.image.w}" h="${r.image.h}">, the sheet's own size`);
const names = l => l.map(d => d.name);
R.is(names(r.tree).join("|") === ["fxTop", "both", "clip", "grime", "P", "G2", "G1", r.decalName, "tint", "hidden", "mul", "Base colour — t101a"].join("|"),
  "the topmost layer is listed first and the base sheet is the bottom one; the smoothness-only group is not in the colour file:\n        " + names(r.tree).join(" / "));
const T = Object.fromEntries(r.tree.map(d => [d.name, d]));
R.is(T.mul.op === "svg:multiply" && T.mul.opacity === .6 && T.tint.op === "svg:screen" && T.tint.opacity === .5 && T.hidden.vis === "hidden" && T.mul.vis === "visible",
  `opacity, blend and visibility stay live: mul ${T.mul.op} ${T.mul.opacity}, tint ${T.tint.op} ${T.tint.opacity}, hidden ${T.hidden.vis}`);
R.is(T.G1.tag === "stack" && T.G1.iso === "isolate" && T.G1.opacity === .9 && names(T.G1.kids).join() === "g1fx,g1paint" && T.G1.kids[1].op === "svg:overlay" && T.G1.kids[0].op === "svg:src-over",
  `a plain group is an isolated stack with its opacity (${T.G1.opacity}); inside it the overlay stays overlay and the effect is written as its result, source-over`);
R.is(T.G2.tag === "layer" && T.G2.op === "svg:multiply" && r.notes.flat.join() === "G2",
  `a masked group is ONE layer in the file, still multiply (${T.G2.tag}, ${T.G2.op}) — a soft mask on a group is not the same mask on each child`);
R.is(T.P.tag === "stack" && T.P.iso === "auto" && T.P.opacity === 1 && T.P.op === "svg:src-over" && T.P.kids[0].name === "pb" && T.P.kids[0].opacity === .56 && T.P.kids[1].opacity === .8 && T.P.kids[0].op === "svg:color" && T.P.kids[1].op === "svg:soft-light",
  `a pass-through group is isolation="auto" at full opacity, and each child carries the group's 0.8: pb ${T.P.kids[0].opacity}, pa ${T.P.kids[1].opacity}`);
R.is(r.notes.baked.join() === "tint,pa,pb,grime,clip" && r.notes.effects.join() === "g1fx,fxTop",
  `the stencils applied to pixels are the mask, the group's rectangle, the blend-if and the clip (${r.notes.baked.join(", ")}); effects written as results: ${r.notes.effects.join(", ")}`);
R.is(/carry their mask/.test(r.said) && /“G2” written as one layer/.test(r.said) && /2 effects written/.test(r.said), `the status line says all three:\n        ${r.said}`);
R.is(r.sizes.length === 1 && r.sizes[0] === "64x64", `every layer PNG is a whole sheet (${r.sizes.join(", ")})`);
R.is(r.hiddenPx[1] === 255 && r.hiddenPx[3] === 255, `a hidden layer is written with its pixels (${r.hiddenPx.join(",")}) and hidden`);
R.is(r.tintAlpha[0] > 245 && r.tintAlpha[1] > 100 && r.tintAlpha[1] < 150 && r.tintAlpha[2] < 10,
  `a fill under a soft mask carries the mask in its alpha: ${r.tintAlpha.join(" → ")} across the sheet`);
R.is(r.g2Alpha[0] > 200 && r.g2Alpha[1] === 0, `the flattened group carries its own mask: centre ${r.g2Alpha[0]}, corner ${r.g2Alpha[1]}`);
R.is(r.paAlpha[0] === 255 && r.paAlpha[1] === 0, `a child of the pass-through group carries the group's rectangle: inside ${r.paAlpha[0]}, outside ${r.paAlpha[1]}`);
R.is(r.thumb[0] === 64 && r.thumb[1] === 64, `the thumbnail is at most 256 px (${r.thumb.join("×")})`);
// Tolerance, measured 2026-09-26 layer by layer: a plain layer, a mask, a masked group, a
// pass-through group and a clip come out of the file EXACTLY as the app draws them (0, or 1 on a
// clip's edge), and the stack in 2b holds that at max 1. What is not exact is inherent to writing an
// 8-bit layer where the app draws straight onto the sheet: the rotated decal is resampled into its
// own raster first (±1), and an effect's result is rounded before its opacity is applied rather
// than after (±2 over most of the sheet at 75 %) — and blend-if, which reads the sheet beneath it,
// turns a ±1 there into a few levels at the edge of its band. All of it measured: max 4, 146 of
// 16 384 values over 1. Anything structural — an order, a missing stencil, an opacity in the wrong
// place — is tens of levels over thousands of values, which the bound below still catches.
const close = (d, max, over) => d.max <= max && d.over1 <= over;
R.is(close(r.mergedVsApp, 0, 0), `mergedimage.png is the app's own composite (max ${r.mergedVsApp.max}, ${r.mergedVsApp.over1} values over 1)`);
R.is(close(r.refVsApp, 6, 400), `a reference renderer reading only the file draws the app's composite (max ${r.refVsApp.max}, ${r.refVsApp.over1} of ${64 * 64 * 4} values over 1 — an effect and a decal are one 8-bit rounding away)`);
R.is(close(r.exactVsApp, 1, 0), `with no effect, decal or blend-if in the stack it draws it exactly (max ${r.exactVsApp.max}, ${r.exactVsApp.over1} values over 1)`);
// 2c. Levels, Curves, Invert, Posterize (4.50 (5)) land source-atop in the app.
const KT = r.kinds, kn = names(KT.tree);
R.is(kn.join("|") === "post|fPass|G3|Base colour — t101f" && KT.tree[2].tag === "layer" && KT.flatFx.join() === "G3" &&
     KT.tree[1].tag === "stack" && KT.tree[1].iso === "auto" && names(KT.tree[1].kids).join() === "inv" && KT.effects.join() === "inv,post",
  `a normal group holding a Levels or a Curves is ONE layer (${KT.tree[2].tag}); one in a pass-through group and one on top are layers of their own: ${kn.join(" / ")}`);
R.is(/“G3” written as one layer, because an effect inside changes only what the group has painted/.test(KT.said), `…and the status line says why:\n        ${KT.said}`);
R.is(close(KT.refVsApp, 1, 0), `a reference renderer reading only that file draws the app's composite (max ${KT.refVsApp.max}, ${KT.refVsApp.over1} values over 1) — the Levels at rest adds no coverage to the 70 % layer`);

// ---- 3: back in ----
const B = r.back;
const bk = B.kids || [];
R.is(B.g === "roundtrip" && bk.map(k => k.l || k.g).join("|") === ["Base colour — t101a", "mul", "hidden", "tint", r.decalName, "G1", "G2", "P", "grime", "clip", "both", "fxTop"].join("|"),
  "read back, it is one group named after the file, bottom first, the name with an ampersand, quotes, angles, an é and a tab intact:\n        " + bk.map(k => k.l || k.g).join(" / "));
const K = Object.fromEntries(bk.map(k => [k.l || k.g, k]));
R.is(K.mul.blend === "multiply" && K.mul.op === .6 && K.hidden.vis === false && K.tint.blend === "screen" && K.G2.blend === "multiply" && K.G2.l,
  "blend, opacity and visibility come back where they went out");
R.is(K.P.blend === "pass through" && K.P.op === 1 && K.P.kids.map(k => k.l + ":" + k.op).join() === "pa:0.8,pb:0.56",
  `the auto stack comes back as a pass-through group, its children at ${K.P.kids.map(k => k.op).join(" and ")}`);
R.is(K.G1.blend === "normal" && K.G1.op === .9 && K.G1.kids.map(k => k.blend).join() === "overlay,normal", "the plain group comes back as a group, overlay inside it");
R.is(bk.every(function walk(k){ return k.kids ? k.kids.every(walk) : k.chan === "color"; }), "every layer lands on the brush's channel, colour");
R.is(close(r.backVsApp, 6, 400), `composited by the app, the file is the picture it came from (max ${r.backVsApp.max}, ${r.backVsApp.over1} values over 1)`);
R.is(close(r.backVsRef, 1, 0), `…and exactly what the reference renderer drew from the same file (max ${r.backVsRef.max})`);
R.is(/^Loaded “roundtrip” onto t101b \(Colour\) — 14 layers in 2 groups/.test(r.saidIn), `the status line: ${r.saidIn}`);

// ---- 4: smoothness ----
R.is(r.smooth.w === "32" && r.smooth.h === "32" && names(r.smooth.tree).join("|") === "Surface|both|Base smoothness — t101a" && names(r.smooth.tree[0].kids).join() === "gloss",
  `the smoothness file is the smoothness sheet's size (${r.smooth.w}×${r.smooth.h}) and holds that channel's layers: ${names(r.smooth.tree).join(" / ")}`);
R.is(close(r.smoothVsApp, 0, 0) && close(r.smoothRefVsApp, 1, 0), `…and draws the app's smoothness sheet (merged max ${r.smoothVsApp.max}, reference max ${r.smoothRefVsApp.max})`);

// ---- 5: another editor's file ----
const F = r.foreign, fk = F.kids || [];
R.is(r.foreignXmlSame === "same", "a hand-written stack.xml with a DOCTYPE, a comment, CDATA, entities and single quotes reads as DOMParser reads it");
R.is(F.g === "foreign" && fk.map(k => k.l || k.g).join("|") === "bg|Rust & grime AB|Iso|Folder|burn|erase",
  "its layers land bottom first, as a group named after the file, entities decoded: " + fk.map(k => k.l || k.g).join(" / "));
const FK = Object.fromEntries(fk.map(k => [k.l || k.g, k]));
R.is(FK.Folder.blend === "pass through" && FK.Folder.kids.map(k => k.l + ":" + k.blend + ":" + k.op + ":" + k.vis).join() === "hard:hard-light:1:false,add:lighter:0.25:true",
  "an auto stack is a pass-through group; svg:plus is lighter, svg:hard-light is hard-light, a hidden layer stays hidden");
R.is(FK.Iso.blend === "normal" && FK["Rust & grime AB"].op === .5, "a stack with no isolation attribute is a normal group; opacity is read");
R.is(FK.erase.vis === false && FK.burn.vis === false && FK.erase.blend === "normal" && FK.burn.op === .7,
  "a coverage operator and a Krita-only mode are imported HIDDEN rather than drawn as Normal");
const N5 = r.foreignNotes;
R.is(N5.lost.map(x => x.name + ":" + x.op).join() === "burn:krita:linear_burn,erase:svg:dst-out" && N5.missing.join() === "ghost" && N5.unread.join() === "vector" && N5.skipped.join() === "text",
  `and each is named: lost ${N5.lost.map(x => x.op).join(", ")}; missing ${N5.missing}; not a PNG ${N5.unread}; skipped <${N5.skipped}>`);
R.is(N5.from.join() === "32,32" && N5.to.join() === "64,64" && r.offPx.size.join() === "64,64",
  `a 32×32 file lands on a 64×64 sheet, resampled (${r.offPx.size.join("×")})`);
R.is(r.offPx.inside === 255 && r.offPx.outside === 0,
  `a cropped layer lands where its own x/y plus its stack's put it: red at (20,18) = ${r.offPx.inside}, nothing at (10,10) = ${r.offPx.outside}`);
R.is(/resampled from 32 × 32 to 64 × 64/.test(r.foreignSaid) && /2 hidden/.test(r.foreignSaid) && /“ghost”/.test(r.foreignSaid) && /“vector”/.test(r.foreignSaid) && /1 element this reader does not know skipped \(text\)/.test(r.foreignSaid),
  `the status line says all of it:\n        ${r.foreignSaid}`);

// ---- 6-7 ----
R.is(r.funnel.landed && /^Loaded “dropped”/.test(r.funnel.status), `a dropped .ora goes through Add files' funnel and lands as one group: “${r.funnel.status.slice(0, 60)}…”`);
R.is(r.undone, "one undo takes the whole import back out");
R.is(/not an OpenRaster file \(no stack\.xml inside\)/.test(r.noStack), `a zip with no stack.xml is refused by name: “${r.noStack}”`);
R.is(/not readable XML/.test(r.bad), `a stack.xml that is not well-formed is refused: “${r.bad}”`);
R.is(/no image size/.test(r.noSize), `an image with no size is refused: “${r.noSize}”`);
R.is(r.awkward === "same", `the reader agrees with DOMParser on entities, both quotes, a comment holding a tag, CDATA holding one, and text (${r.awkward})`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");

// ==== PSD ====
console.log("\n=== PSD ===");
const prun = await evalInPage({ browser, expr: pageExpr(PSD_BODY, 400), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!prun.ok) { console.log("FAIL: " + prun.reason); process.exit(1); }
const p = prun.result;
if (p.__threw) { console.log("FAIL: the PSD body threw\n" + p.__threw); process.exit(1); }
if (argv.includes("--dump")) console.log(JSON.stringify(p, null, 1));

// ---- 1: the file, read by the spec ----
const h = p.head;
R.is(h.sig === "8BPS" && h.version === 1 && h.zero6 === 0 && h.channels === 3 && h.w === 64 && h.h === 64 && h.depth === 8 && h.mode === 3 && h.cm === 0 && h.ir === 0,
  `the header is an 8-bit RGB PSD of the sheet's size (${h.sig} v${h.version}, ${h.channels} channels, ${h.w}×${h.h}, depth ${h.depth}, mode ${h.mode})`);
R.is(h.liRest >= 0 && h.liRest <= 1 && h.gm === 0 && h.lmRest === 0 && h.mergedComp === 1 && h.end === h.fileLen,
  `every length in it is right: the layer info ends where it says (${h.liRest} byte of pad), the section too (${h.lmRest}), and the PackBits merged image ends on the file's last byte (${h.end} of ${h.fileLen})`);
R.is(p.type === "image/vnd.adobe.photoshop", `the blob says what it is (${p.type})`);
const recs = p.recs, leaf = recs.filter(x => !x.lsct);
R.is(recs.every(x => x.sig === "8BIM" && x.fits && x.over === 0 && x.mask === 0 && x.ranges === 0),
  `all ${recs.length} records parse to their stated ends, and every channel's row counts and length agree with its PackBits`);
// The ORDER of the markers, not their count: a divider and a folder swapped still make two of each,
// and a count passed that mutant (the review of 2026-09-27) — Photoshop's reader nests by the order.
const marks = recs.map(x => x.lsct ? x.lsct + ":" + x.name : null).filter(Boolean).join(" ");
R.is(h.count === recs.length && recs.length === 18 && leaf.length === 14 && marks === "3:</Layer group> 1:G1 3:</Layer group> 1:P",
  `a group is a divider below its children and a folder above them, named: ${h.count} records, ${leaf.length} layers, the markers bottom first ${marks}`);
const topDown = leaf.map(x => x.name);
R.is(topDown.join("|") === ["Base colour — t101a", "mul", "hidden", "tint", r.decalName, "g1paint", "g1fx", "G2", "pa", "pb", "grime", "clip", "both", "fxTop"].join("|"),
  "the layers run bottom first, the base sheet at the bottom and the names in 'luni' exactly (ampersand, quotes, é, a tab):\n        " + topDown.join(" / "));
// A record the checks below look for that is not there fails its check by name, not by a TypeError.
const PR = new Proxy(Object.fromEntries(recs.map(x => [x.name + (x.lsct ? "#" + x.lsct : ""), x])), { get: (t, k) => t[k] || {} });
R.is(PR["Base colour — t101a"].pascal === "Base colour ? t101a" && PR.mul.pascal === "mul", `the Pascal name is the ASCII fallback (“${PR["Base colour — t101a"].pascal}”)`);
R.is(PR.mul.key === "mul " && PR.mul.op === 153 && PR.tint.key === "scrn" && PR.tint.op === 128 && PR.pa.key === "sLit" && PR.pb.key === "colr" && PR.G2.key === "mul ",
  `blend and opacity are Photoshop's keys: mul “${PR.mul.key}” ${PR.mul.op}, tint “${PR.tint.key}” ${PR.tint.op}, pa “${PR.pa.key}”, pb “${PR.pb.key}”, the flattened G2 “${PR.G2.key}”`);
R.is((PR.hidden.flags & 2) === 2 && (PR.mul.flags & 2) === 0, `a hidden layer has flag bit 1 (${PR.hidden.flags}), a shown one does not (${PR.mul.flags})`);
R.is(PR["G1#1"].key === "norm" && PR["G1#1"].lsctKey === "norm" && PR["G1#1"].op === 230 && PR["P#1"].key === "pass" && PR["P#1"].lsctKey === "pass" && PR["P#1"].op === 255 &&
     PR.pb.op === 143 && PR.pa.op === 204,
  `a plain group's folder carries its opacity (${PR["G1#1"].op}); the pass-through one is “pass” at 255 and hands its 0.8 to each child (pa ${PR.pa.op}, pb ${PR.pb.op})`);
R.is(p.hiddenBox.join() === "4,40,14,56", `a layer is cropped to what it covers: the hidden rectangle's bounds are top, left, bottom, right = ${p.hiddenBox.join(", ")}`);
R.is(p.vsOra.n === leaf.length && p.vsOra.max === 0 && !p.vsOra.missing.length,
  `every layer's pixels are exactly the PNG the .ora of the same stack carries (${p.vsOra.n} layers, max ${p.vsOra.max})`);
R.is(close(p.mergedVsApp, 0, 0), `the merged image is the app's own composite (max ${p.mergedVsApp.max})`);
R.is(close(p.refVsApp, 6, 400) && close(p.refVsApp, r.refVsApp.max, r.refVsApp.over1),
  `the spec's renderer, reading only the file, draws the app's composite (max ${p.refVsApp.max}, ${p.refVsApp.over1} values over 1 — the OpenRaster file's own figures, ${r.refVsApp.max} and ${r.refVsApp.over1})`);
R.is(/^Wrote t101a\.psd — 14 layers in 2 groups/.test(p.said) && /opens in Photoshop, Paint\.NET, GIMP, Krita and Photopea/.test(p.said) && /1 soft-light layer will look a little different/.test(p.said),
  `the status line:\n        ${p.said}`);

// ---- 2: back in ----
const PB = p.back, pk = PB.kids;
R.is(PB.g === "roundtrip" && pk.map(k => k.l || k.g).join("|") === ["Base colour — t101a", "mul", "hidden", "tint", r.decalName, "G1", "G2", "P", "grime", "clip", "both", "fxTop"].join("|"),
  "read back, it is one group named after the file with the stack's own shape: " + pk.map(k => k.l || k.g).join(" / "));
const byName = list => new Proxy(Object.fromEntries(list.map(k => [k.l || k.g, k])), { get: (t, k) => t[k] || { kids: [] } });   // a missing node fails its check by name, not by a TypeError
const PK = byName(pk);
R.is(PK.mul.blend === "multiply" && PK.mul.op === .6 && PK.hidden.vis === false && PK.P.blend === "pass through" && (PK.P.kids || []).map(k => k.op).join() === "0.8,0.5608" &&
     PK.G1.blend === "normal" && PK.G1.op === .902 && PK.G2.blend === "multiply",
  `blend, opacity (in 255ths) and visibility come back; the pass-through group is one again, its children at ${(PK.P.kids || []).map(k => k.op).join(" and ")}`);
R.is(close(p.backVsApp, 6, 400) && close(p.backVsRef, 1, 0),
  `composited by the app, the file is the picture it came from (max ${p.backVsApp.max}, ${p.backVsApp.over1} over 1) and exactly what the spec's renderer drew (max ${p.backVsRef.max})`);
R.is(/^Loaded “roundtrip” onto t101b \(Colour\) — 14 layers in 2 groups$/.test(p.saidIn), `the status line: ${p.saidIn}`);

// ---- 3 ----
R.is(p.workerMode === "worker" && p.inlineMode === "inline" && p.inlineSame,
  `the pool ran in workers, and with no Worker at all the inline fallback wrote the same ${h.fileLen} bytes (${p.inlineSame})`);

// ---- 4: what Photoshop writes ----
const HD = p.hand;
if (HD.threw) R.bad("the hand-built file was refused: " + HD.threw);
else {
  const hk = HD.tree.kids, HK = byName(hk);
  R.is(HD.tree.g === "handmade" && hk.map(k => k.l || k.g).join("|") === "bg|Folder|orphan|Closed|masked|maskoff|base|clipped|clipped2|mbase|styled|burn|vmask|params",
    "the layers land bottom first; the adjustment layer and the zip-compressed one are left out: " + hk.map(k => k.l || k.g).join(" / "));
  R.is(HK.Folder.blend === "pass through" && (HK.Folder.kids || []).map(k => k.l + ":" + k.blend + ":" + k.op + ":" + k.vis).join() === "add:lighter:0.502:true,hard:hard-light:1:false",
    "a pass-through folder is a pass-through group; Linear Dodge is lighter, a hidden layer stays hidden, opacity is in 255ths");
  R.is(HK.Closed.blend === "normal" && HK.Closed.op === .7843 && (HK.Closed.kids || [])[0]?.l === "Слой 1" && HD.from.join() === "64,64",
    `a closed folder is a group like an open one (${HK.Closed.op}), and a layer is named by its 'luni' name (“${(HK.Closed.kids || [])[0]?.l}”), not its Pascal one`);
  const px = p.handPx;
  R.is(px.masked[0] === 255 && px.masked[1] === 128 && px.masked[2] === 0 && px.masked[3].join() === "200,30,30,255",
    `a layer mask is the app's mask, in its alpha: ${px.masked[0]} and ${px.masked[1]} inside its bounds, its default ${px.masked[2]} outside — over pixels that are still there (${px.masked[3]})`);
  R.is(px.maskoff === false, "a mask switched off in Photoshop is not applied");
  R.is(px.vmask[0] === 255 && px.vmask[1] === 0 && px.params[0] === 0 && px.params[1] === 255,
    `with a vector mask too, the pixel mask is channel -3 in the "real" rectangle (${px.vmask.join(", ")}), found past the mask parameters (${px.params.join(", ")})`);
  R.is(HK.clipped.ref === HK.base.uid && HK.clipped2.ref === HK.base.uid && HK.clipped2.op === .3922 && HK.base.blend === "normal",
    "a clipped layer is masked by its base, and so is the next one clipped to the same base");
  const MB = HK.mbase, MBk = MB.kids || [];
  R.is(MB.g === "mbase" && MB.blend === "multiply" && MB.op === .502 && MBk.map(k => k.l).join() === "mbase,mclip" && MBk[0]?.blend === "normal" &&
       MBk[0]?.op === .7843 && MBk[0]?.vis === true && MBk[1]?.ref === MBk[0]?.uid,
    `a clipping stack on a multiply base at 50 % is a group with the base's blend and opacity — Photoshop blends the stack as one — the base inside it plain at its fill (${MBk[0]?.op})`);
  R.is(HK.styled.op === .502 && HK.burn.vis === false && HK.burn.blend === "normal" && HK.bg.op === 1 && px.bg.join() === "48,64,80,255" && px.inner[0] === 240,
    "fill opacity multiplies the opacity; Linear Burn comes in HIDDEN rather than drawn as Normal; a raw channel reads, and one after a block whose pad was not counted");
  const hn = HD.notes;
  R.is(hn.adjust.join() === "adj" && hn.fx.join() === "styled" && hn.lost.map(x => x.name + ":" + x.op).join() === "burn:Linear Burn" &&
       hn.unread.length === 1 && /^zipped — zip-compressed/.test(hn.unread[0]) && hn.clip.join() === "orphan",
    `and each loss is named: adjustment ${hn.adjust}; style ${hn.fx}; ${hn.lost.map(x => x.op)}; ${hn.unread[0]}; clipped to a group ${hn.clip}`);
  R.is(hn.blendIf.join() === "bg" && /1 without its Photoshop Blend If, which does not come across — .*: “bg”/.test(HD.said),
    `Blend If is named where it was used (${hn.blendIf}) and nowhere else — the untouched ranges Photoshop writes on every layer are not`);
  R.is(/1 hidden, because this app has no blend that does what theirs does: “burn” \(Linear Burn\)/.test(HD.said) && /1 adjustment or fill layer left out/.test(HD.said) &&
       /1 without its Photoshop layer style .*: “styled”/.test(HD.said) && /1 left out as unreadable: “zipped/.test(HD.said) && /1 left unclipped/.test(HD.said) &&
       /1 in Linear Dodge below full opacity, which looks brighter here .*: “add”/.test(HD.said),
    `the status line says all of it:\n        ${HD.said}`);
}

// ---- 4b: a group's own mask, a clipping base's mask, groups clipped to a layer ----
const GR = p.grp;
if (!GR || GR.threw) R.bad("the grouped file was refused: " + (GR && GR.threw));
else {
  const near = (a, b, t) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);
  const BG = [48, 64, 80], RED = [200, 30, 30], BLUE = [20, 40, 220], YEL = [240, 220, 20], WHITE = [255, 255, 255];
  const X = GR.px, quarter = RED.map((v, i) => v * 64 / 255 + BG[i] * (1 - 64 / 255));
  R.is(GR.gmask && GR.gmask.join() === "255,64,0" && near(X.g255, RED, 1) && near(X.g64, quarter, 2) && near(X.gOut, BG, 1),
    `a folder's layer mask is the group's mask (${GR.gmask}): composited, the group's red is whole, a quarter and gone (${X.g255} / ${X.g64} / ${X.gOut})`);
  R.is(GR.kbase.group && GR.kbase.kids === "kbase,kclip" && !GR.kbase.innerMask && GR.kbase.clipRef && GR.kbase.mask && GR.kbase.mask.join() === "0,255" &&
       near(X.kIn, BLUE, 1) && near(X.kHole, BG, 1),
    `a clipping base's mask masks what is clipped to it too — the stack is a group carrying that mask, the base plain inside: the clipped blue on the base (${X.kIn}), nothing in the mask's hole (${X.kHole})`);
  R.is(GR.clipG.group && GR.clipG.ref && near(X.cgIn, YEL, 1) && near(X.cgOut, BG, 1),
    `a group clipped to a layer is masked by it: yellow on the base (${X.cgIn}), nothing beside it (${X.cgOut})`);
  R.is(GR.clipMG.wrap && GR.clipMG.ref && GR.clipMG.inner && near(X.cmIn, BLUE, 1) && near(X.cmHole, WHITE, 1) && near(X.cmOut, BG, 1),
    `…and one with a mask of its own keeps it, the clip on a pass-through group around it: multiply blue on the base (${X.cmIn}), the base through the group's own hole (${X.cmHole}), nothing beside the base (${X.cmOut})`);
  R.is(GR.top === "bg MaskedG/ kbase/ gbase ClipG/ gbase2 ClipMG/" && /^Loaded “grouped” onto t101g \(Colour\) — 8 layers in 5 groups$/.test(GR.said),
    `nothing in that file is lost, so the status line says only what landed: ${GR.said} (${GR.top})`);
}

// ---- 4c: what the review of 2026-09-27 found ----
{
  const RV = p.rev || {}, near = (a, b, t) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);
  const BG = [48, 64, 80], RED = [200, 30, 30], BLUE = [20, 40, 220];
  const E = RV.empty || {};
  R.is(!E.threw && near(E.layer, BG, 1) && near(E.group, BG, 1) && near(E.base, BG, 1) && near(E.under, BG, 1),
    `Hide All — a mask of no area at default 0, which is how Photoshop stores one left all at its default — hides the whole layer (${E.layer || E.threw}), the whole group (${E.group}) and a clipping base with what is clipped to it (${E.base}); read as no mask, all three were drawn`);
  R.is(!E.threw && near(E.reveal, BLUE, 1) && E.revealMask === false && /^Loaded “emptymask” onto t101remptymask \(Colour\) — 6 layers in 2 groups$/.test(E.said || ""),
    `…and one of no area at default 255 is no mask at all (${E.reveal}, mask ${E.revealMask}); nothing in that file is lost, so nothing more is said: ${E.said}`);
  const F = RV.fill0 || {};
  R.is(!F.threw && near(F.on, BLUE, 1) && near(F.off, BG, 1) && F.top === "bg shape/",
    `a clipping base at opacity 255 but Fill 0 blends its stack as one: the Multiply clipped to it has only the base at its fill beneath, so it is its own blue on the base's shape (${F.on || F.threw}), not multiplied into the layers under it — and nothing beside it (${F.off}); ${F.top}`);
  const C = RV.emptied || {};
  R.is(!C.threw && near(C.inside, BLUE, 1) && near(C.outside, BLUE, 1) && C.clip === "onGrading" && C.adjust === "adj" && /1 left unclipped .*“onGrading”/.test(C.said || ""),
    `a layer clipped to a group left with nothing (it held a Levels alone) stays unclipped and is named — blue on and off the layer under that group (${C.inside} / ${C.outside}): ${C.said || C.threw}`);
  const S = RV.said || {};
  R.is(!S.threw && S.fx === "StyledGroup" && /1 without its Photoshop layer style \(shadow, stroke, glow…\), which is not in the pixels: “StyledGroup”/.test(S.said || ""),
    `a GROUP's layer style is named as a layer's is (${S.fx || S.threw})`);
  R.is(!S.threw && S.dodge === "addhalf,AddGroup" && /2 in Linear Dodge below full opacity, which looks brighter here than in Photoshop wherever the sum passes white .*: “addhalf”, “AddGroup”/.test(S.said || ""),
    `Linear Dodge faded by opacity — a layer's and a group's — is named on the way in; at full opacity, or faded by its Fill, which Photoshop applies inside the add as the canvas does, it is not (${S.dodge})`);
  const D = RV.dodgeOut || {};
  R.is(D.notes === "glow,ptglow" && /2 in Linear Dodge below full opacity will look darker in Photoshop wherever the sum passes white .*: “glow”, “ptglow”$/.test(D.said || "") &&
       !/Linear Dodge/.test(RV.dodgeOra || "x Linear Dodge"),
    `…and on the way out: a lighter layer below full opacity, and one faded by the pass-through group around it, are named (${D.notes}); one at full opacity is not, and an .ora says nothing — its svg:plus takes the layer's opacity into its alpha by the OpenRaster spec, as the canvas does:\n        ${D.said}`);
  const CH = RV.chan || {};
  R.is(!CH.threw && CH.chan === "smooth" && CH.onSmooth && !CH.onColour && CH.w === 32 && /^Loaded “gloss” onto t101c \(Smoothness\)/.test(CH.status || ""),
    `an import lands on the channel the brush is in, at that sheet's size (${CH.chan || CH.threw}, ${CH.w}²): ${(CH.status || "").slice(0, 80)}`);
  const P = RV.solo || {};
  R.is(!P.threw && P.g === "solo" && P.blend === "normal" && P.kids === "Solo:pass through" && near(P.px, RED, 1),
    `a file whose only node is a pass-through group lands inside a group named after the file, so the Multiply in it has nothing beneath, as in the file (${P.px || P.threw}): ${P.g} / ${P.kids}`);
}

// ---- 5-6 ----
const VV = p.variants;
R.is(VV.deep.px && VV.deep.px.join() === "128,64,32,255", `a 16-bit file's layers (in its 'Lr16' block) come in at their high bytes: ${VV.deep.px || VV.deep.threw}`);
R.is(VV.deep4.px && VV.deep4.px.join() === "128,64,32,255" && VV.deep4.name === "behind",
  `…and so do they behind a global block of 4k + 2 bytes whose pad to four is not counted: “${VV.deep4.name || VV.deep4.threw}” ${VV.deep4.px || ""}`);
R.is(VV.psb.px && VV.psb.px.join() === "10,200,90,255" && VV.psb.from.join() === "32,32" && /resampled from 32 × 32 to 64 × 64/.test(VV.psb.said),
  `a PSB — 8-byte lengths, 4-byte row counts — reads, and a 32² file lands resampled: ${VV.psb.px || VV.psb.threw}`);
R.is(VV.grey.px && VV.grey.px.join() === "77,77,77,255", `a greyscale file's grey is copied into red, green and blue: ${VV.grey.px || VV.grey.threw}`);
R.is(VV.flat.px && VV.flat.px.join() === "11,22,33,255" && VV.flat.name === "flat", `a file with no layers is its merged picture, as one layer named after the file: ${VV.flat.px || VV.flat.threw}`);
const RF = p.refuse;
R.is(/CMYK PSD/.test(RF.cmyk) && /32-bit PSD/.test(RF.deep32) && /PSD version 3/.test(RF.v3) && /not a Photoshop file/.test(RF.notpsd) && /cut short/.test(RF.cut) &&
     /holds no layer this app can read — .*zip-compressed/.test(RF.allzip),
  `and what it cannot read is refused in words:\n        ${Object.entries(RF).map(([k, v]) => k + ": " + v).join("\n        ")}`);

// ---- 7 ----
R.is(p.funnel.landed && /^Loaded “dropped”/.test(p.funnel.status), `a dropped .psd goes through Add files' funnel and lands as one group: “${p.funnel.status.slice(0, 60)}…”`);
R.is(p.undone, "one undo takes the whole import back out");
R.is(p.psbFunnel, "a dropped .psb lands the same way");
const perrs = (p.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(perrs.length === 0, perrs.length ? "uncaught errors during the PSD run:\n        " + perrs.join("\n        ") : "no uncaught errors during the PSD run");
R.finish();
