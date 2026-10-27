// Hand-made mip levels, slice (a) (ROADMAP 4.58, docs/MIP_LEVELS.md §3.1, §4, §6.1), against the real page.
//
// WHY THIS EXISTS. A layer or a group can be limited to a range of mip levels ("Shows at"), and the
// export restarts the chain wherever what is visible changes — the walk builds the sheet with that
// level's set of layers, it is padded and box-filtered down, and that is the level; the levels below
// it are generated from it as the chain always was. Every effect 4.58 promises rides on two facts
// this file holds (the live sheet is level 0; slice (b) below shows the rest on screen):
//   * WHAT A LEVEL HOLDS. The exported file is decoded here, level by level, and each level's colour
//     is read back: a far-only layer is absent below its first level and there from it on, a
//     near-only one the other way round — with the Mipmaps tick OFF, because a texture with level
//     content carries its chain whatever the tick says, and with TGA asked for, which has no levels.
//   * WHAT DID NOT CHANGE. A texture with no level content is written byte for byte as the code
//     before this wrote it (the reference below is that code's formula), and a restart whose sheet
//     is what the chain would have generated anyway gives the same bytes as no restart at all —
//     which is what proves the restart's padding, box filter and renormalisation are the chain's own.
// Plus the level ruler (§6.1) — the owner's measurement in the game — read back level by level, and
// the pieces a user reaches: Near only / Far only from the layer's menu, one undo step, the distance
// it gives from the layer's own parts, the export row's note, the TGA stop, and ORA/PSD written as
// level 0 shows the stack, said in its report.
//
// Usage: node tools/t164_levels.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var seed = 11; var rnd = function(){ seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 8 & 255; };
  var same = function(a, b){ if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  var S = 64;
  var sheet = function(fill, n){ n = n || S; var c = mkCanvas(n, n); var g = ctx2d(c); var d = g.createImageData(n, n);
    for (var i = 0; i < n * n; i++) { var v = fill(i); d.data[i*4] = v[0]; d.data[i*4+1] = v[1]; d.data[i*4+2] = v[2]; d.data[i*4+3] = 255; }
    g.putImageData(d, 0, 0); return c; };
  var flat = function(hex, n){ var c = mkCanvas(n || S, n || S); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, n || S, n || S); return c; };
  var mkSlot = function(id, n, base){
    n = n || S;
    var s = { id: id, cStem: id, cFileName: id + ".dds", nStem: id.replace(/_c$/, "_n"), nFileName: id.replace(/_c$/, "_n") + ".dds",
      layers: [], size: n, sizeH: n, nSize: n, missing: false, cEdited: true };
    s.baseC = base || flat("#404040", n); s.composite = mkCanvas(n, n);
    return s;
  };
  var fill = function(hex, o){ return LayerNode.of(Object.assign({ type: "fill", name: hex, color: hex, opacity: 1, blend: "normal", visible: true }, o || {})); };
  var px = function(c, x, y){ return [].slice.call(ctx2d(c).getImageData(x, y, 1, 1).data); };
  var keep = { slots: App.slots, active: App.activeSlot, layer: App.activeLayer, preset: $("expPreset").value,
               mips: $("optMips").checked, pad: $("optPad").checked, inv: $("optInvRough").checked, geom: App.geomData, matSlot: App.matSlot };
  // The slot in hand, its sheets due — the export settles what is pending before it reads a pixel,
  // exactly as after an edit in the app (a sheet never composited is transparent black).
  var use = function(s){ App.slots = new Map([[s.id, s]]); App.activeSlot = s; App.activeLayer = null; scheduleComposite(s); };
  // Every level of an exported file, decoded: [{ w, h, rgba }]
  var levelsOf = function(data){ var d = DDS.parseDDS(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); return d.mips.map(function(m){ return { w: m.w, h: m.h, rgba: m.rgba }; }); };
  var mean = function(m){ var r = 0, g = 0, b = 0, n = m.w * m.h; for (var i = 0; i < n; i++) { r += m.rgba[i*4]; g += m.rgba[i*4+1]; b += m.rgba[i*4+2]; } return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]; };
  var hex = function(v){ return "#" + v.map(function(x){ return (x < 16 ? "0" : "") + x.toString(16); }).join(""); };
  var exportOne = async function(s, kind){
    var items = collectExports(false).filter(function(it){ return it.kind === (kind || "c"); });
    var done = await encodeAllTextures(items);
    return { items: items, files: done.files, file: done.files[0] };
  };
  try {
    // ---- 1. the model: §3.1's weight, and where a stack's levels change ----
    var T = [];
    for (var k = 0; k <= 8; k++) T.push(Levels.weight({ levels: Levels.make(3, 5, 0) }, k));
    var Ts = [];
    for (var k = 0; k <= 8; k++) Ts.push(Levels.weight({ levels: Levels.make(3, 5, 1) }, k));
    out.weight = { hard: T.join(","), soft: Ts.join(","), none: Levels.weight({}, 4), noLevel: Levels.weight({ levels: Levels.make(3, 5, 0) }, null),
      every: Levels.make(0, 15, 2), swapped: JSON.stringify(Levels.make(6, 2, 0)), clamp: JSON.stringify(Levels.make(-4, 9, 40)), top: JSON.stringify(Levels.make(4, 99, 0)) };
    var s1 = mkSlot("lv1_c");
    var far = fill("#0000ff", { name: "far", levels: Levels.far(3) });
    var surf = fill("#ffffff", { name: "far gloss", chan: "smooth", levels: Levels.make(5, 15, 0) });
    s1.layers = [fill("#ff0000", { name: "all" }), far, surf];
    var hid = fill("#00ff00", { name: "hidden far", levels: Levels.far(2), visible: false });
    var g1 = { type: "group", name: "g", visible: true, opacity: 1, blend: "normal", children: [fill("#123456", { name: "in group" })], levels: Levels.make(1, 1, 0) };
    out.restarts = { plain: Levels.restarts(mkSlot("lv0_c"), ["color"], 6).join(","),
      far: Levels.restarts(s1, ["color"], 6).join(","), surf: Levels.restarts(s1, ["smooth", "metal", "normal"], 6).join(","),
      beyond: Levels.restarts(s1, ["smooth"], 4).join(",") };
    s1.layers.push(hid);
    out.restarts.hidden = Levels.restarts(s1, ["color"], 6).join(",");
    s1.layers.push(g1);
    out.restarts.group = Levels.restarts(s1, ["color"], 6).join(",");
    out.pad = [0, 3, 5, 6, 9].map(function(r){ return Levels.pad(r); }).join(",");

    // ---- 2. the walk's gate: the views show level 0 ----
    var s2 = mkSlot("lv2_c");
    s2.layers = [fill("#00ff00", { name: "near", levels: Levels.near(3) }), fill("#ff0000", { name: "far", levels: Levels.far(3) })];
    use(s2); compositeSlot(s2);
    out.live = { at0: px(s2.composite, 5, 5).join(","), at2: px(Composite.at(s2, "color", 2), 5, 5).join(","),
                 at3: px(Composite.at(s2, "color", 3), 5, 5).join(","), liveStill: px(s2.composite, 5, 5).join(",") };

    // ---- 3. what each exported level holds ----
    $("optPad").checked = false; $("optInvRough").checked = true;
    var s3 = mkSlot("lv3_c");
    s3.layers = [fill("#ff0000", { name: "near", levels: Levels.make(0, 1, 0) }), fill("#0000ff", { name: "far", levels: Levels.far(3) })];
    use(s3);
    $("expPreset").value = "lossless"; $("optMips").checked = false;
    var e3 = await exportOne(s3);
    var L3 = levelsOf(e3.file.data);
    out.exact = { name: e3.file.name, n: L3.length, sizes: L3.map(function(m){ return m.w; }).join(","), means: L3.map(function(m){ return hex(mean(m)); }).join(",") };
    var row3 = collectExports(true).find(function(it){ return it.kind === "c"; });
    out.row = { levels: row3 && row3.levelNote, text: row3 ? expListRow(row3).textContent : "" };
    $("expPreset").value = "game";
    var e3b = await exportOne(s3);
    var L3b = levelsOf(e3b.file.data);
    out.bc3 = { n: L3b.length, means: L3b.map(function(m){ return mean(m); }) };
    // TGA has no levels: the preset falls back to DDS for this one texture, chain and all; a texture
    // the user set to TGA by hand is stopped by the rule check instead.
    $("expPreset").value = "tga";
    var e3c = await exportOne(s3);
    out.tga = { name: e3c.file.name, n: levelsOf(e3c.file.data).length };
    var plan = buildExportPlan(collectExports(true), { estimate: true });
    out.tgaRule = validateExport(plan).filter(function(r){ return r.level === "error"; }).map(function(r){ return r.id; }).join(",");
    expOpt(s3, "c").fmt = "tga";
    out.tgaHand = validateExport(buildExportPlan(collectExports(true), { estimate: true })).filter(function(r){ return r.level === "error"; }).map(function(r){ return r.id + ": " + r.title; }).join(" | ");
    expOpt(s3, "c").fmt = "";
    out.levelsInfo = validateExport(buildExportPlan(collectExports(true), { estimate: true })).filter(function(r){ return r.id === "levels"; }).map(function(r){ return r.level + ": " + r.title; }).join(" | ");
    out.poolMode = exportPool().mode;

    // ---- 4. nothing else moved: no level content is today's bytes ----
    // The reference is the formula the export used before restarts existed, written out here: the
    // collected sheet, a chain from BCnEnc.buildMips when the tick asks for one, BCnEnc.writeDDS.
    var noise = sheet(function(){ return [rnd(), rnd(), rnd()]; });
    var ref = function(it, fmt, mips){ var c = new Uint8ClampedArray(it.rgba);
      return BCnEnc.writeDDS(mips ? BCnEnc.buildMips(c, it.w, it.h, it.kind === "n") : [{ w: it.w, h: it.h, rgba: c }], { bc3: fmt === "bc3" }); };
    var s4 = mkSlot("lv4_c", S, noise);
    // Slopes leaning the same way and steeply (192–255 on both), so a box filter keeps them longer than
    // unit and every generated level of the _n really is renormalised — random slopes average to short
    // vectors that renormalising leaves alone, and a restart that skipped it would pass unseen.
    s4.smooth = sheet(function(){ var v = rnd(); return [v, v, v]; }); s4.metal = flat("#000000"); s4.normal = sheet(function(){ return [rnd() | 192, rnd() | 192, 128]; });
    s4.nEdited = true;
    s4.layers = [fill("#80ff00", { name: "half", opacity: .5 })];
    use(s4);
    out.plain = [];
    for (var cfg of [["game", true], ["game", false], ["lossless", true], ["live", true]]) {
      $("expPreset").value = cfg[0]; $("optMips").checked = cfg[1];
      var items = collectExports(false), refs = items.map(function(it){ return ref(it, it.kind === "c" ? exportFormats().c : exportFormats().n, cfg[1]); });
      var done = await encodeAllTextures(items);
      out.plain.push(cfg.join("/") + " " + done.files.map(function(f, i){ return f.name + "=" + same(f.data, refs[i]); }).join(" "));
    }
    // The same slot with a far-only layer that is hidden, and with one that draws nothing (opacity 0):
    // the first is no level content at all, the second restarts at level 2 with exactly the sheet the
    // chain would have generated — on the albedo and on a renormalised _n.
    $("expPreset").value = "lossless"; $("optMips").checked = true;
    var want = await encodeAllTextures(collectExports(false));
    s4.layers.push(fill("#ff00ff", { name: "hidden far", visible: false, levels: Levels.far(2) }));
    scheduleComposite(s4);
    var hidd = await encodeAllTextures(collectExports(false));
    s4.layers.push(fill("#ff00ff", { name: "nothing far", opacity: 0, levels: Levels.far(2) }));
    s4.layers.push(fill("#ffffff", { name: "nothing far gloss", chan: "smooth", opacity: 0, levels: Levels.far(2) }));
    scheduleComposite(s4);
    var noop = collectExports(false), noopLv = noop.map(function(it){ return it.levels ? it.levels.at.join(",") : "-"; }).join(" ");
    var noopF = await encodeAllTextures(noop);
    out.noop = { hidden: hidd.files.map(function(f, i){ return same(f.data, want.files[i].data); }).join(","),
                 restarts: noopLv, same: noopF.files.map(function(f, i){ return same(f.data, want.files[i].data); }).join(",") };

    // ---- 5. a restart on the _n: packed from its three sheets at that level ----
    var s5 = mkSlot("lv5_c");
    s5.smooth = flat("#202020"); s5.metal = flat("#000000"); s5.normal = flat("#808080"); s5.nEdited = true;
    s5.layers = [fill("#e0e0e0", { name: "far gloss", chan: "smooth", levels: Levels.far(2) })];
    use(s5);
    var e5 = await exportOne(s5, "n");
    out.surf = levelsOf(e5.file.data).map(function(m){ return m.rgba[0]; }).join(",");

    // ---- 6. a restart is padded for its own level: max(32, 2^r) texels ----
    var P = 256, mask = new Uint8Array(P * P), img = new Uint8ClampedArray(P * P * 4);
    for (var y = 120; y < 136; y++) for (var x = 120; x < 136; x++) mask[y * P + x] = 1;
    for (var i = 0; i < P * P; i++) { img[i*4] = mask[i] ? 250 : 0; img[i*4+3] = 255; }
    var refPad = function(d){ var c = img.slice(); padSeams(c, P, P, mask, d); return BCnEnc.reduce(c, P, P, false, 6).rgba; };
    var got6 = await exportPool().call("levelOf", { rgba: img.slice().buffer, mask: mask.slice().buffer, w: P, h: P, level: 6, renorm: false, padDist: Levels.pad(6) });
    out.padOp = { pad64: same(new Uint8ClampedArray(got6.rgba), refPad(64)), pad32: same(new Uint8ClampedArray(got6.rgba), refPad(32)), w: got6.w };

    // ---- 7. Near only / Far only from the layer's menu, one undo step ----
    var s7 = mkSlot("lv7_c");
    var L7 = fill("#336699", { name: "kill marks" });
    s7.layers = [L7];
    use(s7); App.activeLayer = L7;
    layerMenu({ clientX: 10, clientY: 10, preventDefault: function(){} }, s7, L7);
    var item = [].slice.call(document.querySelectorAll("body > div > div")).find(function(d){ return /^Far only/.test(d.textContent); });
    out.menu = { far: item ? item.textContent : null };
    if (item) item.click();
    out.menu.after = JSON.stringify(L7.levels);
    doUndo(true);
    out.menu.undone = JSON.stringify(L7.levels || null);
    doRedo(true);
    out.menu.redone = JSON.stringify(L7.levels);
    layerMenu({ clientX: 10, clientY: 10, preventDefault: function(){} }, s7, L7);
    var every = [].slice.call(document.querySelectorAll("body > div > div")).find(function(d){ return /^Every level/.test(d.textContent); });
    out.menu.every = !!every;
    if (every) every.click();
    out.menu.cleared = JSON.stringify(L7.levels || null);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    // ---- 8. how far that is, from the layer's own parts ----
    // One 1 m × 1 m quad mapped onto half of a 256² sheet: 128 texels a metre. At 1440p and a 50°
    // vertical view level 0 is one texel a pixel at 1440 / (128 · 2 tan 25°) = 12.06 m.
    var s8 = mkSlot("lv8_c", 256);
    App.geomData = [{ name: "plate", mat: "m8", position: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0]),
                      uv: new Float32Array([0,0, .5,0, .5,.5, 0,0, .5,.5, 0,.5]) }];
    App.matSlot = new Map([["m8", "lv8_c"]]);
    var L8 = fill("#000000", { name: "far", levels: Levels.far(3) });
    s8.layers = [L8];
    out.dist = Levels.distance(s8, L8, 3);

    // ---- 9. the level ruler, read back level by level ----
    var s9 = mkSlot("lv9_c", 256);
    use(s9);
    var ruler = Levels.ruler(s9);
    out.ruler = { name: ruler && ruler.name, top: s9.layers.length, kids: ruler ? ruler.children.length : 0, collapsed: !!(ruler && ruler.collapsed) };
    var strip = Levels.strip(256, 256);
    $("expPreset").value = "lossless"; $("optMips").checked = false;
    var e9 = await exportOne(s9);
    var L9 = levelsOf(e9.file.data);
    out.ruler.n = L9.length;
    out.ruler.restarts = e9.items[0].levels ? e9.items[0].levels.at.join(",") : "-";
    // The colour that covers most of each level, away from the strip.
    out.ruler.mode = L9.map(function(m){
      var f = 256 / m.w, cnt = new Map();
      for (var y = 0; y < m.h; y++) {
        var yy = y * f; if (f <= 2 && strip.ys.some(function(b){ return yy + f > b && yy < b + strip.h; })) continue;
        for (var x = 0; x < m.w; x++) { var i = (y * m.w + x) * 4, key = hex([m.rgba[i], m.rgba[i+1], m.rgba[i+2]]); cnt.set(key, (cnt.get(key) || 0) + 1); }
      }
      var best = null, bn = -1; cnt.forEach(function(n, key){ if (n > bn) { bn = n; best = key; } });
      return best;
    }).join(",");
    out.ruler.colors = Levels.COLORS.slice(0, L9.length).join(",");
    // Numbers: some texels of each numbered level are none of the colours.
    out.ruler.inked = L9.map(function(m, k){ var c = Levels.COLORS[k], n = 0;
      for (var i = 0; i < m.w * m.h; i++) if (hex([m.rgba[i*4], m.rgba[i*4+1], m.rgba[i*4+2]]) !== c) n++; return n; }).join(",");
    // The filter strip: a one-texel checker at level 0; at level 1 the auto half reads the sRGB mean
    // of black and white (128) and the other the linear-light mean (188).
    var y0 = strip.ys[0], m0 = L9[0], m1 = L9[1], chk = 0, nchk = 0;
    for (var y = y0; y < y0 + strip.h; y++) for (var x = 0; x < 256; x++) { nchk++; var v = m0.rgba[(y * 256 + x) * 4]; if (v === (((x + y) & 1) ? 255 : 0)) chk++; }
    var halves = { a: [], b: [] };
    for (var y = y0 / 2 + 1; y < (y0 + strip.h) / 2 - 1; y++) for (var x = 0; x < 128; x++) {
      var seg = Math.floor(x * 2 / strip.seg); (seg % 2 ? halves.b : halves.a).push(m1.rgba[(y * 128 + x) * 4]);
    }
    var mid = function(a){ a = a.slice().sort(function(p, q){ return p - q; }); return a[a.length >> 1]; };
    out.strip = { checker: chk + "/" + nchk, a: mid(halves.a), b: mid(halves.b), ys: strip.ys.join(","), h: strip.h, seg: strip.seg };

    // ---- 10. ORA / PSD write the stack as level 0 shows it, and say so ----
    var s10 = mkSlot("lv10_c");
    s10.layers = [fill("#00ff00", { name: "always" }), fill("#ff0000", { name: "only far", levels: Levels.far(3) })];
    use(s10);
    var sunk = [];
    var ras = await Interchange.rasters(s10, "color", async function(c){ sunk.push(c); return "r" + sunk.length; });
    var far10 = ras.children.find(function(n){ return n.name === "only far"; });
    out.ora = { visible: far10 && far10.visible, notes: (ras.notes.levels || []).join(","), merged: px(ras.merged, 3, 3).join(",") };

    // ---- 11. what the review of (a) found ----
    // A camouflage tile with level content under the TGA preset is written as a .dds, so the pins and
    // the .blk must name the .dds (CamoTile.fileName goes through the same formatFor).
    var tile = { id: CamoTile.ID, camoTile: true, noGeom: true, layers: [], size: S, sizeH: S, missing: false };
    tile.baseC = flat("#336633"); tile.composite = flat("#336633");
    App.slots = new Map([[tile.id, tile]]);
    $("expPreset").value = "tga";
    var plainName = CamoTile.fileName();
    tile.layers = [fill("#ffffff", { name: "far tile", levels: Levels.far(3) })];
    out.tile = { plain: plainName, levels: CamoTile.fileName() };
    // Ungrouping a group with a range says the range has nowhere to go, as it says of its opacity.
    var s11 = mkSlot("lv11_c"), G11 = { type: "group", name: "near look", visible: true, opacity: 1, blend: "normal", levels: Levels.near(3), children: [fill("#123456")] };
    s11.layers = [G11];
    use(s11);
    document.getElementById("status").textContent = "";
    ungroupNode(s11, G11);
    out.ungroup = document.getElementById("status").textContent;
  } finally {
    App.slots = keep.slots; App.activeSlot = keep.active; App.activeLayer = keep.layer; App.geomData = keep.geom; App.matSlot = keep.matSlot;
    $("expPreset").value = keep.preset; $("optMips").checked = keep.mips; $("optPad").checked = keep.pad; $("optInvRough").checked = keep.inv;
  }
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
const CAMO_ID = "wtss_camo_tile";                     // CamoTile.ID
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== the model ===");
R.is(r.weight.hard === "0,0,0,1,1,1,0,0,0", `a hard range 3–5 weighs 1 inside it and 0 outside (${r.weight.hard})`);
R.is(r.weight.soft === "0,0,0.5,1,1,1,0.5,0,0", `soft 1 fades over one level at each end — max(0, 1 − d / (soft + 1)) (${r.weight.soft})`);
R.is(r.weight.none === 1 && r.weight.noLevel === 1, "a node with no range, and any node when no level is asked, weighs 1");
R.is(r.weight.every === null && r.weight.swapped === '{"from":2,"to":6,"soft":0}' && r.weight.clamp === '{"from":0,"to":9,"soft":15}' &&
  r.weight.top === '{"from":4,"to":15,"soft":0}',
  `every level is no range at all; a range is ordered and held to 0–15 (${r.weight.swapped} ${r.weight.clamp} ${r.weight.top})`);
R.is(r.restarts.plain === "0", `a slot without level content restarts at 0 alone (${r.restarts.plain})`);
R.is(r.restarts.far === "0,3", `a far-only layer from 3 restarts the albedo at 3 (${r.restarts.far})`);
R.is(r.restarts.surf === "0,5", `a gloss layer from 5 restarts the _n there, and not the albedo (${r.restarts.surf})`);
R.is(r.restarts.beyond === "0", `a level past the chain's last is no restart (${r.restarts.beyond})`);
R.is(r.restarts.hidden === "0,3", `a hidden layer's range changes nothing (${r.restarts.hidden})`);
R.is(r.restarts.group === "0,1,2,3", `a group's range applies to what is inside it (${r.restarts.group})`);
R.is(r.pad === "32,32,32,64,512", `a restart at r is padded max(32, 2^r) texels (${r.pad})`);

console.log("\n=== the walk's gate ===");
R.is(r.live.at0 === "0,255,0,255" && r.live.liveStill === r.live.at0, `the views show level 0: the near layer, not the far one (${r.live.at0})`);
R.is(r.live.at2 === "0,255,0,255" && r.live.at3 === "255,0,0,255", `the walk at a level draws that level's layers (2: ${r.live.at2}, 3: ${r.live.at3}) and leaves the live sheet alone`);

console.log("\n=== what each exported level holds ===");
R.is(r.exact.name === "lv3_c.dds" && r.exact.n === 7 && r.exact.sizes === "64,32,16,8,4,2,1",
  `with the Mipmaps tick off, a texture with level content still carries its whole chain (${r.exact.n} levels: ${r.exact.sizes})`);
R.is(r.exact.means === "#ff0000,#ff0000,#404040,#0000ff,#0000ff,#0000ff,#0000ff",
  `each level is that level's stack: near-only red at 0–1, the base at 2, far-only blue from 3 on (${r.exact.means})`);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
const bm = r.bc3.means;
R.is(r.bc3.n === 7 && near(bm[0], [255, 0, 0]) && near(bm[1], [255, 0, 0]) && near(bm[2], [64, 64, 64]) && bm.slice(3).every(m => near(m, [0, 0, 255])),
  `the same through BC3 (${JSON.stringify(bm)})`);
R.is(r.row.levels === "own levels 2–6" && /own levels 2–6/.test(r.row.text), `the export row says so — from the first level that differs to the chain's last (${r.row.levels})`);
R.is(r.tga.name === "lv3_c.dds" && r.tga.n === 7 && !/levels/.test(r.tgaRule),
  `the TGA preset writes this texture as a .dds with its chain instead (${r.tga.name}, ${r.tga.n} levels)`);
R.is(/(^| \| )levels-tga: .*lv3_c/.test(r.tgaHand), `a texture set to TGA by hand is stopped by the rule check (${r.tgaHand})`);
R.is(/^info: /.test(r.levelsInfo) && /lv3_c/.test(r.levelsInfo), `the rule check names the texture that carries its own levels (${r.levelsInfo})`);
R.is(r.poolMode === "worker", `the chain is built in the export pool's workers (${r.poolMode})`);

console.log("\n=== nothing else moved ===");
R.is(r.plain.length === 4 && r.plain.every(t => / lv4_c\.dds=true lv4_n\.dds=true$/.test(t)),
  `a texture with no level content is the bytes the export wrote before, for every preset, with and without mips:\n      ${r.plain.join("\n      ")}`);
R.is(r.noop.hidden === "true,true", `a hidden far-only layer changes no byte (${r.noop.hidden})`);
R.is(r.noop.restarts === "0,2 0,2" && r.noop.same === "true,true",
  `a restart whose sheet is what the chain generates gives the same bytes as no restart — the albedo and the renormalised _n (${r.noop.restarts}: ${r.noop.same})`);
R.is(r.surf === "32,32,224,224,224,224,224", `an _n restart packs the gloss of its own level into R (${r.surf})`);
R.is(r.padOp.pad64 && !r.padOp.pad32 && r.padOp.w === 4, `the pool pads a level-6 restart 64 texels before it filters it down (64: ${r.padOp.pad64}, 32: ${r.padOp.pad32})`);

console.log("\n=== near only / far only ===");
R.is(/^Far only/.test(r.menu.far || ""), `the layer's menu offers Far only (${r.menu.far})`);
R.is(r.menu.after === '{"from":3,"to":15,"soft":0}', `one click limits it from level 3 on (${r.menu.after})`);
R.is(r.menu.undone === "null" && r.menu.redone === r.menu.after, "one undo step takes it back, and redo puts it again");
R.is(r.menu.every && r.menu.cleared === "null", "Every level takes the range off");
const d = r.dist;
R.is(d && Math.abs(d.from - 48.25) < 0.5 && Math.abs(d.full - 96.5) < 1 && d.rho === 128,
  `from the layer's own parts: 128 texels a metre puts level 3 from ~48 m, whole by ~97 m at 1440p (${JSON.stringify(d)})`);

console.log("\n=== the level ruler ===");
R.is(r.ruler.name === "Level ruler" && r.ruler.top === 1 && r.ruler.collapsed, `the ruler is one folded group on top of the stack (${JSON.stringify(r.ruler.name)})`);
R.is(r.ruler.n === 9 && r.ruler.restarts === "0,1,2,3,4,5,6,7,8", `on a 256² sheet it restarts at every level, 0 to 8 (${r.ruler.restarts})`);
R.is(r.ruler.mode === r.ruler.colors, `each level is its own colour:\n      ${r.ruler.mode}\n      ${r.ruler.colors}`);
const ink = r.ruler.inked.split(",").map(Number);
R.is(ink.slice(0, 3).every(n => n > 0), `the numbered levels carry ink (${r.ruler.inked})`);
R.is(r.strip.checker === `${256 * r.strip.h}/${256 * r.strip.h}`, `the filter strip is a one-texel checker at level 0 (${r.strip.checker})`);
R.is(Math.abs(r.strip.a - 128) <= 1 && Math.abs(r.strip.b - 188) <= 1, `at level 1 one half is the sRGB mean (${r.strip.a}) and the other the linear-light mean (${r.strip.b})`);

console.log("\n=== ORA / PSD ===");
R.is(r.ora.visible === false && r.ora.notes === "only far" && r.ora.merged === "0,255,0,255",
  `a layer limited to far levels is written hidden, as level 0 shows the stack, and the report names it (${JSON.stringify(r.ora)})`);

console.log("\n=== found in review ===");
R.is(r.tile.plain === CAMO_ID + ".tga" && r.tile.levels === CAMO_ID + ".dds",
  `a camouflage tile under the TGA preset is named .tga, and .dds once it has level content — the name the pins and the .blk carry is the file written (${r.tile.plain}, ${r.tile.levels})`);
R.is(/mip levels \(levels 0–2\)/.test(r.ungroup), `ungrouping a group with a range says the range could not be kept (${r.ungroup.slice(0, 120)})`);

// ===== slice (b): the preview as in game (docs/MIP_LEVELS.md §5) =====
// A fresh page, because this half renders through the page's own WebGL renderer. What it holds:
//   * THE CHAIN ON THE GPU. A colour sheet with level content is uploaded with its own levels — the
//     far-only layer in level 3 on, the near-only one below it — and a stroke updates level 0 at once
//     while the levels below follow once it stops (no restart is composited inside a stroke frame).
//   * AS IN GAME. x1 whatever the view used before; no chain at all where the export writes none;
//     texture quality uploading the chain from a lower level; the resolution as a LOD bias.
//   * THE LEVELS VIEW, rendered at known distances and read back: the level the GPU picked is
//     decoded from the colour and has to be §1's level for that distance at 1440p and the assumed
//     50° view — face-on, 60° off face-on (one level up: x1), on a 4K screen, at Medium quality (the
//     top level gone, the far levels where they were), and on a sheet the export writes without a
//     chain (level 0 wherever you stand).
//   * THE 2-D LEVEL CONTROL: the view shows level k of the sheet, and the control lists the levels.
const BODY2 = `async function(){
  var out = {};
  var S = 64;
  var flat = function(hex, n){ var c = mkCanvas(n || S, n || S); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, n || S, n || S); return c; };
  var fill = function(hex, o){ return LayerNode.of(Object.assign({ type: "fill", name: hex, color: hex, opacity: 1, blend: "normal", visible: true }, o || {})); };
  var px = function(c, x, y){ return [].slice.call(ctx2d(c).getImageData(x, y, 1, 1).data); };
  var mkSlot = function(id, n){
    n = n || S;
    var s = { id: id, cStem: id, cFileName: id + ".dds", layers: [], size: n, sizeH: n, missing: false, cEdited: true };
    s.baseC = flat("#404040", n);
    ensureComposite(s, n, n);
    return s;
  };
  var mips = function(on){ $("optMips").checked = on; $("optMips").dispatchEvent(new Event("change")); };
  var keep = { slots: App.slots, active: App.activeSlot, layer: App.activeLayer, mips: $("optMips").checked, matSlot: App.matSlot,
               view: App.chanView, lv: { on: LevelView.on, quality: LevelView.quality, screen: LevelView.screen, at2d: LevelView.at2d } };
  var texOf = function(s){
    var t = s.tex, m = t.mipmaps || [];
    return { kind: (LevelView.mode(s, "color") || {}).kind, n: m.length, w0: m.length ? m[0].width : t.image.width, gen: t.generateMipmaps,
      min: t.minFilter === THREE.LinearFilter ? "linear" : t.minFilter === THREE.LinearMipmapLinearFilter ? "trilinear" : String(t.minFilter),
      aniso: t.anisotropy, live: (m.length ? m[0] : t.image) === s.composite, base: t.image === s.baseC,
      colors: m.map(function(c){ return px(c, 0, 0).slice(0, 3).join(" "); }).join(",") };
  };
  try {
    mips(false);
    LevelView.set({ on: false, quality: 0, screen: 1440, at2d: 0 });
    App.chanView = "shaded";

    // ---- 1. the chain on the GPU ----
    var s1 = mkSlot("lb1_c");
    s1.layers = [fill("#ff0000", { name: "near", levels: Levels.near(3) }), fill("#0000ff", { name: "far", levels: Levels.far(3) })];
    var s0 = mkSlot("lb0_c");
    s0.layers = [fill("#00ff00", { name: "plain" })];
    App.slots = new Map([[s1.id, s1], [s0.id, s0]]); App.activeSlot = s1; App.activeLayer = null;
    scheduleComposite(s1); scheduleComposite(s0);
    await LevelView.settle();
    out.chain = texOf(s1); out.plain = texOf(s0);

    // ---- 2. a stroke frame: level 0 at once, the restarts once it stops ----
    var b0 = LevelView.stats.builds, v0 = s1.tex.version;
    compositeSlot(s1, { x: 1, y: 1, w: 4, h: 4 });
    out.stroke = { sameVersion: s1.tex.version === v0, now: LevelView.stats.builds - b0 };
    await LevelView.settle();
    out.stroke.after = LevelView.stats.builds - b0;
    // The _n's sheets too: a far-only gloss layer gives the smoothness texture a chain of its own.
    var s6 = mkSlot("lb6_c");
    s6.smooth = flat("#202020"); s6.metal = flat("#000000"); s6.normal = flat("#8080ff");
    s6.layers = [fill("#ffffff", { name: "far gloss", chan: "smooth", levels: Levels.far(2) })];
    App.slots.set(s6.id, s6); scheduleComposite(s6);
    await LevelView.settle();
    var sm = s6.texCh && s6.texCh.smooth;
    out.surf = { n: sm ? sm.mipmaps.length : -1, l1: sm && sm.mipmaps[1] ? px(sm.mipmaps[1], 0, 0)[0] : -1, l2: sm && sm.mipmaps[2] ? px(sm.mipmaps[2], 0, 0)[0] : -1,
                 metal: s6.texCh && s6.texCh.metal ? s6.texCh.metal.mipmaps.length : -1 };
    App.slots.delete(s6.id);
    // What a run brings up to date is the rectangle the edit touched, level by level: it has to be
    // exactly what building every level whole gives.
    var ink = LayerNode.of({ type: "paint", name: "ink", canvas: mkCanvas(S, S), visible: true, opacity: 1, blend: "normal" });
    s1.layers.push(ink); scheduleComposite(s1); await LevelView.settle();
    var ig = ctx2d(ink.canvas); ig.fillStyle = "#ffffff"; ig.fillRect(13, 21, 6, 5);
    compositeSlot(s1, { x: 13, y: 21, w: 6, h: 5 }); await LevelView.settle();
    var dump = function(){ return s1._lvc.color.levels.slice(1).map(function(v){ return [].slice.call(ctx2d(v).getImageData(0, 0, v.width, v.height).data).join(","); }); };
    var regional = dump(), l3 = px(s1._lvc.color.levels[3], 2, 3).slice(0, 3).join(" ");
    LevelView.drop(s1, "color"); LevelView.touched(s1, "color", null); await LevelView.settle();
    var whole = dump();
    out.region = { n: regional.length, same: regional.map(function(v, i){ return v === whole[i]; }).join(","), l3: l3 };
    s1.layers.pop(); scheduleComposite(s1); await LevelView.settle();

    // ---- 3. as in game: x1, and no chain where the export writes none ----
    LevelView.set({ on: true });
    await LevelView.settle();
    out.game = { plain: texOf(s0), chain: texOf(s1) };
    mips(true);
    await LevelView.settle();
    out.gameMips = texOf(s0);

    // ---- 4. texture quality: Medium uploads the chain from level 1 ----
    LevelView.set({ quality: 1 });
    await LevelView.settle();
    out.q1 = { plain: texOf(s0), chain: texOf(s1) };
    var v1 = s0.tex.version;
    compositeSlot(s0, { x: 0, y: 0, w: 2, h: 2 });
    out.q1.held = s0.tex.version === v1;                 // level 0 is not on the GPU: no upload per stroke frame
    await LevelView.settle();
    setCompare(true); out.compare = texOf(s1); out.compare.kept = !!(s1._lvc && s1._lvc.color && s1._lvc.color.ready);
    setCompare(false); out.compareNow = texOf(s1);       // at once, not after a rebuild (review of (b))
    await LevelView.settle(); out.compareBack = texOf(s1);

    // ---- 5. the Levels view, rendered and read back ----
    LevelView.set({ quality: 0, screen: 1440 });
    var s5 = mkSlot("lb5_c", 256);
    App.slots.set(s5.id, s5); scheduleComposite(s5);
    App.matSlot = new Map([["mLB", s5.id]]);
    // One texel of the sheet per centimetre of a plane 4 km across, the texture repeating over it:
    // 256 texels a metre wherever the camera looks.
    var Q = 4000, geo = new THREE.PlaneGeometry(Q, Q), uv = geo.attributes.uv;
    for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Q, uv.getY(i) * Q);
    App.chanView = "levels";
    await LevelView.settle();
    var mesh = new THREE.Mesh(geo, makeMaterial("mLB", "plateLB", geo)), sc = new THREE.Scene();
    sc.add(mesh);
    out.lvMat = { type: mesh.material.type, key: mesh.material.customProgramCacheKey() };
    var H = 512, rt = new THREE.WebGLRenderTarget(H, H), pc = new THREE.PerspectiveCamera(50, 1, 0.1, 1e5);
    LevelView.setView(H, 50);                            // as if this target were the viewport
    out.bias = LevelView.bias();
    var shoot = function(d, tilt){
      mesh.material.dispose(); mesh.material = makeMaterial("mLB", "plateLB", geo);
      mesh.rotation.set(0, tilt || 0, 0); mesh.updateMatrixWorld();
      pc.position.set(0, 0, d); pc.lookAt(0, 0, 0); pc.updateMatrixWorld();
      var prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sc, pc);
      var p = new Uint8Array(4 * 4 * 4); renderer.readRenderTargetPixels(rt, H / 2 - 2, H / 2 - 2, 4, 4, p);
      renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca);
      var m = [0, 0, 0]; for (var j = 0; j < 16; j++) for (var k = 0; k < 3; k++) m[k] += p[j * 4 + k] / 16;
      return m.map(Math.round);
    };
    // §1: level λ is in use face-on at d = 2^λ · 1440 / (256 · 2 tan 25°)
    var dAt = function(l){ return Math.pow(2, l) * 1440 / (256 * 2 * Math.tan(25 * Math.PI / 180)); };
    out.shots = { l05: shoot(dAt(.5)), l25: shoot(dAt(2.5)), l45: shoot(dAt(4.5)), tilt: shoot(dAt(1.5), Math.PI / 3) };
    LevelView.set({ screen: 2160 }); out.shots.k4 = shoot(dAt(2.5));
    LevelView.set({ screen: 1440, quality: 1 }); await LevelView.settle(); out.shots.q1 = shoot(dAt(.5)); out.shots.q1far = shoot(dAt(2.5));
    LevelView.set({ quality: 0 }); mips(false); await LevelView.settle(); out.shots.none = shoot(dAt(2.5));
    mips(true); LevelView.set({ on: false }); await LevelView.settle(); out.shots.off = shoot(dAt(.5));
    out.colors = Levels.COLORS.slice(0, 9);
    // the shaded material carries the bias only while the view is as in game
    App.chanView = "shaded";
    var shadedOff = makeMaterial("mLB", "plateLB", geo).customProgramCacheKey();
    LevelView.set({ on: true }); var shadedOn = makeMaterial("mLB", "plateLB", geo).customProgramCacheKey();
    out.shadedKey = { off: shadedOff, on: shadedOn };
    rt.dispose(); geo.dispose();

    // ---- 6. the 2-D view's Level control ----
    LevelView.set({ on: false });
    App.slots = new Map([[s1.id, s1]]); App.activeSlot = s1;
    var sel = $("lvl2dSel");
    sel.dispatchEvent(new Event("pointerdown"));
    out.sel = { n: sel.options.length, last: sel.options[sel.options.length - 1].textContent };
    sel.value = "3"; sel.dispatchEvent(new Event("change"));
    await LevelView.settle();
    var src = Draw2D.source(s1);
    out.v2d = { at: LevelView.at2d, w: src.width, c: px(src, 0, 0).slice(0, 3).join(" ") };
    LevelView.set({ at2d: 0 });
    out.v2d.back = Draw2D.source(s1) === s1.composite;

    // ---- 7. the switch, the distance presets and the readout ----
    $("btnInGame").click();
    out.ui = { on: LevelView.on, bar: $("gameBar").style.display !== "none" };
    var ds = $("gameDist"); ds.value = "50"; ds.dispatchEvent(new Event("change"));
    out.ui.dist = cam.dist; out.ui.far = camera.far; out.ui.readout = $("gameReadout").textContent;
    var qs = $("gameQual"); qs.value = "2"; qs.dispatchEvent(new Event("change"));
    out.ui.quality = LevelView.quality;
    $("btnInGame").click();
    out.ui.off = LevelView.on;
  } finally {
    App.slots = keep.slots; App.activeSlot = keep.active; App.activeLayer = keep.layer; App.matSlot = keep.matSlot;
    App.chanView = keep.view; mips(keep.mips); LevelView.setView(null); LevelView.set(keep.lv);
  }
  return out;
}`;

const q0 = await evalInPage({ browser, expr: pageExpr(BODY2), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!q0.ok) { R.bad("slice (b)'s page: " + q0.reason); R.finish(); }
const q = q0.result;
if (q.__threw) { R.bad("slice (b)'s body threw\n" + q.__threw); R.finish(); }

console.log("\n=== (b) the chain on the GPU ===");
const RED = "255 0 0", BLUE = "0 0 255", GREEN = "0 255 0";
R.is(q.chain.kind === "chain" && q.chain.n === 7 && q.chain.live && !q.chain.gen && q.chain.min === "trilinear",
  `a sheet with level content is uploaded with its own levels, level 0 the live sheet (${JSON.stringify(q.chain)})`);
R.is(q.chain.colors === [RED, RED, RED, BLUE, BLUE, BLUE, BLUE].join(","), `the near-only layer below level 3, the far-only one from it on (${q.chain.colors})`);
R.is(q.chain.aniso === 8, `outside the in-game view the sampling is as before, x8 (${q.chain.aniso})`);
R.is(q.plain.kind === "gpu" && q.plain.n === 0 && q.plain.gen && q.plain.min === "trilinear" && q.plain.aniso === 8,
  `a sheet without level content is exactly as before: the GPU generates its chain (${JSON.stringify(q.plain)})`);
R.is(q.surf.n === 7 && q.surf.l1 === 32 && q.surf.l2 === 255 && q.surf.metal === 0,
  `the _n's sheets too: a far-only gloss layer from level 2 gives the smoothness texture its own levels (${q.surf.l1} at 1, ${q.surf.l2} at 2) and leaves metalness alone (${JSON.stringify(q.surf)})`);
R.is(q.stroke.sameVersion && q.stroke.now === 0 && q.stroke.after >= 1,
  `a stroke frame updates level 0 alone and builds no level; the levels follow once it stops (${JSON.stringify(q.stroke)})`);

R.is(q.region.n === 6 && q.region.same === "true,true,true,true,true,true" && q.region.l3 !== BLUE,
  `the rectangle a stroke touched, brought up to date level by level, is exactly what building every level whole gives (${q.region.same}; level 3 under the ink ${q.region.l3})`);

console.log("\n=== (b) as in game ===");
R.is(q.game.plain.kind === "none" && q.game.plain.min === "linear" && !q.game.plain.gen && q.game.plain.n === 0 && q.game.plain.aniso === 1,
  `with the Mipmaps tick off the export writes no chain, so the in-game view samples level 0 alone, at x1 (${JSON.stringify(q.game.plain)})`);
R.is(q.game.chain.kind === "chain" && q.game.chain.n === 7 && q.game.chain.aniso === 1,
  `a sheet with level content carries its chain whatever the tick says, at x1 (${JSON.stringify(q.game.chain)})`);
R.is(q.gameMips.kind === "gpu" && q.gameMips.gen && q.gameMips.aniso === 1, `with the tick on, the chain at x1 (${JSON.stringify(q.gameMips)})`);
R.is(q.q1.plain.kind === "chain" && q.q1.plain.n === 6 && q.q1.plain.w0 === 32 && !q.q1.plain.live && q.q1.plain.colors.split(",").every(c => c === GREEN),
  `Medium texture quality uploads the chain from level 1 (${JSON.stringify(q.q1.plain)})`);
R.is(q.q1.chain.n === 6 && q.q1.chain.colors === [RED, RED, BLUE, BLUE, BLUE, BLUE].join(","),
  `and a sheet with level content from its level 1: real levels 1–6, the far layer still from level 3 (${q.q1.chain.colors})`);
R.is(q.q1.held, "with level 0 off the GPU a stroke frame uploads nothing; the chain follows once it stops");
R.is(q.compare.base && q.compare.n === 0 && q.compare.kept && q.compareNow.n === 6 && q.compareNow.colors === q.q1.chain.colors && q.compareBack.colors === q.q1.chain.colors,
  `Compare shows the original sheet and keeps the levels, and letting go puts them back at once (${q.compare.n} → ${q.compareNow.n}, kept ${q.compare.kept})`);

console.log("\n=== (b) the Levels view, rendered ===");
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// The Levels view's swatches are sRGB, as on screen; the target reads them back decoded to linear,
// so the reading goes back to sRGB before it is compared with the ruler's colours.
const toSrgb = v => { const c = v / 255; return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
const CS = q.colors.map(hexRgb);
// Which level the GPU picked: the pair of neighbouring level colours the reading lies between, and how far.
const lam = m0 => {
  const m = m0.map(toSrgb);
  let best = null;
  for (let k = 0; k + 1 < CS.length; k++) {
    const a = CS[k], b = CS[k + 1], ab = b.map((v, i) => v - a[i]), n2 = ab.reduce((s, v) => s + v * v, 0);
    const f = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * (m[i] - a[i]), 0) / n2));
    const err = Math.hypot(...m.map((v, i) => v - (a[i] + f * ab[i])));
    if (!best || err < best.err) best = { k, f, err, l: k + f };
  }
  return best;
};
const at = (m, want, why) => { const L = lam(m); R.is(L.err < 12 && Math.abs(L.l - want) < 0.2, `${why}: level ${L.l.toFixed(2)} read, ${want} expected (${m.join(",")})`); };
R.is(q.lvMat.type === "MeshBasicMaterial" && /wtlod:/.test(q.lvMat.key), `the Levels view is a flat material with the LOD bias inlined (${q.lvMat.key})`);
R.is(Math.abs(q.bias - Math.log2(512 / 1440)) < 0.07, `a 512-pixel view standing in for 1440p at the same field of view is biased log2(512 / 1440) (${q.bias.toFixed(3)})`);
at(q.shots.l05, 0.5, "face-on where §1 puts level 0.5");
at(q.shots.l25, 2.5, "face-on where §1 puts level 2.5");
at(q.shots.l45, 4.5, "face-on where §1 puts level 4.5");
at(q.shots.tilt, 2.5, "60° off face-on where face-on would read 1.5 — one level up, the x1 way a UserSkin is sampled");
at(q.shots.k4, 2.5 - Math.log2(2160 / 1440), "on a 4K screen, where 1440p reads 2.5");
// Dropping the top level halves the texture the GPU measures against, so the far levels land where
// they did and only the levels above q are gone: up close the view holds at level 1.
at(q.shots.q1, 1, "at Medium texture quality, where High reads 0.5 — level 0 is not there, so level 1");
at(q.shots.q1far, 2.5, "at Medium texture quality, where High reads 2.5 — the far levels land where they did");
at(q.shots.none, 0, "on a sheet the export writes without a chain, where a chain would read 2.5 — level 0");
const off = lam(q.shots.off);
R.is(Math.abs(off.l - 0.5) > 0.5, `outside the in-game view the 512-pixel target is not biased to 1440p (level ${off.l.toFixed(2)} where in game reads 0.5)`);
R.is(!/wtlod/.test(q.shadedKey.off) && /wtlod:/.test(q.shadedKey.on), `the shaded material carries the bias in its program key only in game (${q.shadedKey.on})`);

console.log("\n=== (b) the 2-D view's Level control ===");
R.is(q.sel.n === 7 && /^Level 6/.test(q.sel.last), `the control lists every level of the active sheet (${q.sel.n}: … ${q.sel.last})`);
R.is(q.v2d.at === 3 && q.v2d.w === 8 && q.v2d.c === BLUE && q.v2d.back,
  `at level 3 the 2-D view shows the sheet's own level 3 — 8 texels, the far layer — and level 0 again after (${JSON.stringify(q.v2d)})`);

console.log("\n=== (b) the switch ===");
R.is(q.ui.on && q.ui.bar && !q.ui.off, "the In game button turns the view on, shows its settings, and turns it off again");
R.is(q.ui.dist === 50 && q.ui.far >= 100 && /50 m/.test(q.ui.readout), `the 50 m preset puts the camera 50 m out and says so (${q.ui.dist}, far ${q.ui.far}, "${q.ui.readout}")`);
R.is(q.ui.quality === 2, "the quality control sets Low");

const errs = (r.__errs || []).concat(r.__rejs || [], q.__errs || [], q.__rejs || []);
R.is(!errs.length, "no uncaught error on the page" + (errs.length ? ": " + errs.join(" | ") : ""));
R.finish();
