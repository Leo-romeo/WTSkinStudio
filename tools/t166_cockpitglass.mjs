// The cockpit body's own sheets and its see-through glass (ROADMAP 1.26, reported 2026-10-24).
//
// WHY THIS EXISTS. The owner: "loading cockpit view does not load its respected textures and also
// from cockpits view it seems like 2 cockpits glasses are rendered and on is not transperent. also
// trying to load a skin like Yae Sakura F 16 … lags a lot when loading cockipit glass and whe trying
// to do anything in the app after loading it". Measured on the F-16A's cockpit body against the
// install, three causes, each held here on synthetic bodies so the suite needs no install:
//
//   1. THE SHEETS. `Cockpit.extract` decodes the cockpit's sheets and then rebuilds while the EXTERIOR
//      is still on screen, so no slot names them yet, and `gcDecoded` (which only runs at 64 decoded
//      sheets or more — the F-16A's two bodies bind 27 + 85) released every one of them. The switch
//      then bound slots to sheets no longer decoded: 33 of the 46 sheets the cockpit's slots name came
//      up as empty placeholders (the 13 that did not are the ones the exterior shares). Here: a
//      cockpit bind, 70 filler sheets, the exterior's rebuild, the switch.
//   2. THE GLASS. The cockpit's canopy `blister1` is drawn twice in the game's own model — once
//      `dynamic_glass_tone` (no texture: tinted glass) and once `dynamic_masked_glass_chrome` with
//      `t0 = empty_glass`, a sheet whose alpha is the glass's opacity (the stock one is 64² at alpha 0
//      everywhere: the game draws nothing there until a skin paints it). A material with a t0 got an
//      ordinary opaque material, so the second canopy hid the cockpit — and that skin's sheet, a
//      picture on 0.7 % of an otherwise alpha-0 sheet, came up as an opaque canopy. Gauge glass
//      (`x_gauge_glass_c`, 512², mean alpha 23) is the same class and covered the instrument faces
//      the same way. Here: both glasses, and the textured one drawn through its own alpha.
//   3. THE SIZE. That skin replaces `empty_glass*` with a 12 800² DXT5 (163 MB on disk, 655 MB as
//      pixels) — past the largest sheet the editor holds (8192) — and every step after the decode
//      scaled with it: profiled in the suite's headless Chrome, the skin's load held the UI thread
//      28.5 s in one task (fillSlotAlbedo 23.6 s, then the upload) and left a 2.8 GB heap. Held at
//      8192 — fitted in the decode worker — the longest task is 8.3 s, the heap 2.3 GB. Here: a
//      16384-wide sheet held at 8192 by area, one that ships a fitting level held at that level, and
//      the status line saying so.
//
// Usage: node tools/t166_cockpitglass.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  // ---- an 8x8 uncompressed 32-bit TGA, top-left origin; alpha per texel from aOf(i) ----
  var tga = function(r, g, b, aOf){
    var W = 8, H = 8, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W; u[14] = H; u[16] = 32; u[17] = 0x28;
    for (var i = 0; i < W * H; i++) { var p = 18 + i * 4; u[p] = b; u[p+1] = g; u[p+2] = r; u[p+3] = aOf ? aOf(i) : 255; }
    return u;
  };
  var decodedFrom = function(bytes, name){
    var d = TGA.parseTGA(bytes.buffer.slice(0));
    d.raw = bytes.buffer.slice(0); d.rawName = name; d.fileName = name;
    return d;
  };
  var obj = function(groups){
    var s = "mtllib x.mtl" + String.fromCharCode(10), vi = 0;
    groups.forEach(function(g, k){
      var o = k * 10, b = vi, L = String.fromCharCode(10);
      s += "o " + g.name + L + "usemtl " + g.mat + L;
      s += "v " + o + " 0 0" + L + "v " + (o + 1) + " 0 0" + L + "v " + o + " 1 0" + L + "v " + (o + 1) + " 1 0" + L;
      s += "vt 0 0" + L + "vt 1 0" + L + "vt 0 1" + L + "vt 1 1" + L;
      s += "f " + (b+1) + "/" + (b+1) + " " + (b+2) + "/" + (b+2) + " " + (b+3) + "/" + (b+3) + L;
      s += "f " + (b+2) + "/" + (b+2) + " " + (b+4) + "/" + (b+4) + " " + (b+3) + "/" + (b+3) + L;
      vi += 4;
    });
    return s;
  };
  var mat = function(name){ var m = App.meshes.get(name); return m ? m.material : null; };
  var desc = function(m){ return m ? { type: m.type, transparent: !!m.transparent, depthWrite: !!m.depthWrite, map: !!m.map, alphaMap: !!m.alphaMap } : null; };

  clearVehicleState();
  App.decoded = new Map();
  App.decoded.set("t166_fuse_c", decodedFrom(tga(200, 60, 60), "t166_fuse_c.tga"));
  // the exterior on screen: one fuselage
  var extText = obj([{ name: "fuse", mat: "t166_fuse" }]);
  App.geomData = buildGeometryData(parseOBJ(extText));
  App.objRaw = { name: "t166_0.obj", text: extText }; App.objName = "t166";
  rebuildAll();
  // ---- the cockpit body as Cockpit.extract makes it: geometry, a desc bind, then its sheets decoded ----
  // pit: an ordinary painted sheet. canopy_tone: dynamic_glass_tone, no texture. canopy_tex: the
  // SAME canopy again, dynamic_masked_glass_chrome with t0 = t166_glass, opaque in its top two rows
  // only. gauge: the instrument face, with its glass over it.
  var ckText = obj([{ name: "pit", mat: "t166_pit" }, { name: "canopy_tone", mat: "unknown_2" },
    { name: "canopy_tex", mat: "unknown_0" }, { name: "gauge_face", mat: "t166_gauge" }]);
  var e = function(c, cls){ return { c: c, n: null, cls: cls, all: c ? { t0: c } : {} }; };
  var bind = { materials: [], map: new Map([
    ["t166_pit", { c: "t166_pit_c", n: "t166_pit_n", cls: "dynamic_masked_chrome_bump", all: { t0: "t166_pit_c", t2: "t166_pit_n" } }],
    ["unknown_2", e(null, "dynamic_glass_tone")],
    ["unknown_0", e("t166_glass", "dynamic_masked_glass_chrome")],
    ["t166_gauge", e("t166_gauge_c", "dynamic_masked_chrome_bump")]]) };
  Cockpit.install({ geomData: buildGeometryData(parseOBJ(ckText)), objRaw: { name: "t166_cockpit_0.obj", text: ckText }, objName: "t166_cockpit", bind: bind });
  App.decoded.set("t166_pit_c", decodedFrom(tga(60, 60, 200), "t166_pit_c.tga"));
  App.decoded.set("t166_pit_n", decodedFrom(tga(128, 128, 255), "t166_pit_n.tga"));
  App.decoded.set("t166_gauge_c", decodedFrom(tga(250, 250, 250), "t166_gauge_c.tga"));
  App.decoded.set("t166_glass", decodedFrom(tga(255, 0, 255, function(i){ return i < 16 ? 255 : 0; }), "t166_glass.tga"));
  // A real cockpit brings dozens of sheets (the F-16A's binds 85, its exterior 27): enough that
  // gcDecoded, which leaves a vehicle under 64 decoded sheets alone, runs at the next rebuild.
  for (var i = 0; i < 70; i++) App.decoded.set("t166_gauge_" + i + "_c", decodedFrom(tga(i, i, i), "t166_gauge_" + i + "_c.tga"));
  // ...and the rebuild loadVehicleTextures ends with — with the exterior still on screen.
  rebuildAll();
  out.kept = ["t166_pit_c", "t166_gauge_c", "t166_glass"].filter(function(s){ return App.decoded.has(s); });
  var keptN = App.decoded.has("t166_pit_n");
  await Cockpit.show("cockpit");
  var slot = function(id){ var s = App.slots.get(id); return s ? { missing: !!s.missing, size: s.size, w: s.baseC && s.baseC.width } : null; };
  out.slots = { pit: slot("t166_pit"), gauge: slot("t166_gauge"), glass: slot("t166_glass") };
  out.px = (function(){ var s = App.slots.get("t166_pit"); if (!s || !s.composite) return null;
    var d = s.composite.getContext("2d").getImageData(4, 4, 1, 1).data; return [d[0], d[1], d[2]]; })();
  // ---- the glass ----
  out.tone = desc(mat("canopy_tone"));
  out.tex = desc(mat("canopy_tex"));
  var gs = App.slots.get("t166_glass"), gm = mat("canopy_tex");
  out.texBinds = !!(gs && gm && gm.map === gs.tex && gs.texCov && gm.alphaMap === gs.texCov);
  out.pitMat = desc(mat("pit"));
  // the glass stays see-through after a material rebuild (a stroke, a channel toggle)
  rebuildMaterials();
  out.texAfter = desc(mat("canopy_tex"));
  // and back on the exterior, the exterior is as it was
  await Cockpit.show("exterior");
  out.fuse = desc(mat("fuse"));

  // ---- 1b. a cockpit body with NO desc bind: a project opened without the game folder ----
  // Which embedded sheets are the cockpit's is then unknown, so nothing may be released before it is shown.
  clearVehicleState();
  App.decoded = new Map();
  App.decoded.set("t166x_fuse_c", decodedFrom(tga(200, 60, 60), "t166x_fuse_c.tga"));
  var xText = obj([{ name: "fuse", mat: "t166x_fuse" }]);
  App.geomData = buildGeometryData(parseOBJ(xText)); App.objRaw = { name: "t166x_0.obj", text: xText }; App.objName = "t166x";
  rebuildAll();
  var xck = obj([{ name: "pit", mat: "t166x_pit" }]);
  Cockpit.install({ geomData: buildGeometryData(parseOBJ(xck)), objRaw: { name: "t166x_cockpit_0.obj", text: xck }, objName: "t166x_cockpit" });
  App.decoded.set("t166x_pit_c", decodedFrom(tga(10, 220, 10), "t166x_pit_c.tga"));
  for (var k = 0; k < 70; k++) App.decoded.set("t166x_f" + k + "_c", decodedFrom(tga(k, k, k), "t166x_f" + k + "_c.tga"));
  rebuildAll();
  out.noBind = { bind: !!Cockpit.bind(), kept: App.decoded.has("t166x_pit_c") };
  await Cockpit.show("cockpit");
  out.noBind.slot = slot("t166x_pit");
  // the pit's _n is kept as well as its _c (the bind's n half)
  out.nKept = keptN;
  // ---- 3a. DDS.fitRGBA at a fractional ratio, against a brute-force area mean ----
  out.fit = (function(){
    var W = 50, H = 37, src = new Uint8ClampedArray(W * H * 4), worst = 0;
    for (var i = 0; i < src.length; i++) src[i] = (i * 7919 + (i >> 3) * 104729) % 256;
    var f = DDS.fitRGBA(src, W, H, 32), fx = W / f.w, fy = H / f.h;
    for (var y = 0; y < f.h; y++) for (var x = 0; x < f.w; x++) for (var c = 0; c < 4; c++) {
      var s = 0;
      for (var j = Math.floor(y * fy); j < (y + 1) * fy; j++) for (var q = Math.floor(x * fx); q < (x + 1) * fx; q++)
        s += src[(j * W + q) * 4 + c] * (Math.min(j + 1, (y + 1) * fy) - Math.max(j, y * fy)) * (Math.min(q + 1, (x + 1) * fx) - Math.max(q, x * fx));
      worst = Math.max(worst, Math.abs(f.rgba[(y * f.w + x) * 4 + c] - s / (fx * fy)));
    }
    return { w: f.w, h: f.h, worst: worst };
  })();

  // ---- 3. a skin sheet past the largest the editor holds ----
  // An uncompressed 32-bit DDS, 16384 x 8, columns alternately black and white (alpha alternately
  // 255 and 0): fitted to 8192 x 4, every texel is the mean of a black and a white one, 128 — a
  // nearest-texel shrink would leave 0 or 255. The second file ships its own 8192 x 4 level (green),
  // and that level is what is held.
  var dds = function(W, H, levels){
    var size = 0; levels.forEach(function(L){ size += L.w * L.h * 4; });
    var u = new Uint8Array(128 + size), dv = new DataView(u.buffer);
    dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true); dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000, true);
    dv.setUint32(12, H, true); dv.setUint32(16, W, true); dv.setUint32(20, W * 4, true); dv.setUint32(28, levels.length, true);
    dv.setUint32(76, 32, true); dv.setUint32(80, 0x41, true); dv.setUint32(88, 32, true);
    dv.setUint32(92, 0xff0000, true); dv.setUint32(96, 0xff00, true); dv.setUint32(100, 0xff, true); dv.setUint32(104, 0xff000000, true);
    var off = 128;
    levels.forEach(function(L){ for (var y = 0; y < L.h; y++) for (var x = 0; x < L.w; x++, off += 4) {
      var c = L.px(x, y); u[off] = c[2]; u[off+1] = c[1]; u[off+2] = c[0]; u[off+3] = c[3]; } });
    return u;
  };
  var stripes = function(x){ return x % 2 ? [255, 255, 255, 0] : [0, 0, 0, 255]; };
  clearVehicleState();
  App.decoded = new Map();
  App.decoded.set("t166_big_c", decodedFrom(tga(90, 90, 90), "t166_big_c.tga"));
  App.decoded.set("t166_mip_c", decodedFrom(tga(90, 90, 90), "t166_mip_c.tga"));
  var bigText = obj([{ name: "big", mat: "t166_big" }, { name: "mip", mat: "t166_mip" }]);
  App.geomData = buildGeometryData(parseOBJ(bigText));
  App.objRaw = { name: "t166b_0.obj", text: bigText }; App.objName = "t166b";
  rebuildAll();
  var big = dds(16384, 8, [{ w: 16384, h: 8, px: stripes }]);
  var mip = dds(16384, 8, [{ w: 16384, h: 8, px: function(){ return [255, 0, 0, 255]; } }, { w: 8192, h: 4, px: function(){ return [0, 255, 0, 255]; } }]);
  await applySkinEntries([{ name: "t166_big_c.dds", bytes: async function(){ return big; } },
                          { name: "t166_mip_c.dds", bytes: async function(){ return mip; } }], "t166 skin");
  var at = function(id){ var s = App.slots.get(id); if (!s || !s.baseC) return null;
    var d = s.baseC.getContext("2d").getImageData(100, 1, 1, 1).data;
    return { w: s.baseC.width, h: s.baseC.height, rgb: [d[0], d[1], d[2]], cov: s.covBase ? s.covBase[1 * s.baseC.width + 100] : null }; };
  out.big = at("t166_big"); out.mip = at("t166_mip");
  out.bigDec = (function(){ var d = App.decoded.get("t166_big_c"); return d ? [d.width, d.height, d.raw && d.raw.byteLength] : null; })();
  out.said = document.getElementById("status").textContent;
  clearVehicleState();
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

// ---- 1. the cockpit's own sheets ----
R.is(r.kept.length === 3, `the cockpit's sheets survive the exterior's rebuild that follows their decode (${r.kept.join(", ") || "none kept"})`);
R.is(r.slots.pit && !r.slots.pit.missing && r.slots.gauge && !r.slots.gauge.missing,
  `switching to the cockpit binds its own sheets, not placeholders: pit ${JSON.stringify(r.slots.pit)}, gauge ${JSON.stringify(r.slots.gauge)}`);
R.is(r.px && r.px[0] === 60 && r.px[1] === 60 && r.px[2] === 200, `…and the pit's slot holds the pit's own colour (${r.px})`);
// ---- 2. the glass ----
R.is(r.tone && r.tone.transparent && !r.tone.depthWrite, `the untextured canopy (dynamic_glass_tone) is tinted glass, as before: ${JSON.stringify(r.tone)}`);
R.is(r.slots.glass && !r.slots.glass.missing, "the textured canopy's sheet is a slot of its own, paintable as before");
R.is(r.tex && r.tex.transparent && !r.tex.depthWrite && r.tex.map && r.tex.alphaMap,
  `the textured canopy (dynamic_masked_glass_chrome, t0) is drawn through its sheet's alpha and writes no depth: ${JSON.stringify(r.tex)}`);
R.is(r.texBinds, "…its colour is the slot's live composite and its opacity the slot's coverage, so a stroke on it shows");
R.is(r.texAfter && r.texAfter.transparent && r.texAfter.alphaMap, "…and it stays see-through after the materials are rebuilt");
R.is(r.pitMat && !r.pitMat.transparent && r.pitMat.depthWrite, `an ordinary cockpit sheet is still opaque: ${JSON.stringify(r.pitMat)}`);
R.is(r.fuse && !r.fuse.transparent, "the exterior's own material is untouched by the switch back");
R.is(r.nKept, "…the pit's surface sheet (_n) survives that rebuild as well as its colour sheet");
R.is(r.noBind && !r.noBind.bind && r.noBind.kept && r.noBind.slot && !r.noBind.slot.missing,
  `a cockpit body with no desc bind (a project opened without the game folder) loses none of its sheets either: ${JSON.stringify(r.noBind)}`);
// ---- 3. a sheet past the largest the editor holds ----
R.is(r.fit && r.fit.w === 32 && r.fit.h === 24 && r.fit.worst <= .5 + 1e-9,
  `DDS.fitRGBA at a fractional ratio (50 × 37 → ${r.fit && r.fit.w} × ${r.fit && r.fit.h}) is the area-weighted mean to the rounding (worst ${r.fit && r.fit.worst.toFixed(3)})`);
R.is(r.big && r.big.w === 8192 && r.big.h === 4, `a skin's 16384 × 8 sheet is held at 8192 × 4, aspect kept (${r.big && r.big.w} × ${r.big && r.big.h})`);
R.is(r.big && r.big.rgb.every(v => Math.abs(v - 128) <= 1) && Math.abs(r.big.cov - 128) <= 1,
  `…each texel the mean of the two it covers, colour and coverage alike — not a nearest-texel shrink (rgb ${r.big && r.big.rgb}, coverage ${r.big && r.big.cov})`);
R.is(r.mip && r.mip.w === 8192 && r.mip.rgb[0] === 0 && r.mip.rgb[1] === 255,
  `a file that ships a level that fits is held at that level, as the file has it (${r.mip && r.mip.w} wide, rgb ${r.mip && r.mip.rgb})`);
R.is(r.bigDec && r.bigDec[0] === 8192 && r.bigDec[2] === 128 + 16384 * 8 * 4,
  `the decoded record is the held size, and its raw bytes are still the file, whole (${r.bigDec})`);
R.is(/held at 8192/.test(r.said) && /t166_big_c\.dds 16384×8/.test(r.said) && /t166_mip_c\.dds 16384×8/.test(r.said),
  `the status line says which files were held smaller and from what: “${r.said}”`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
