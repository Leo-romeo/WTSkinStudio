// A scalable camouflage of your own (ROADMAP 4.50 (6)): the item's own gate and the pieces under it.
//
// The item's two sentences are the first two blocks: **the .blk pins the tile by its exact name**,
// and **a stroke over the right edge lands on the left**. The rest is what those two stand on, each
// read back from the page's own objects rather than driven and trusted:
//
//   stems      which camouflage the tile replaces — every stem the model uses when there is no unit
//              to ask, and only the ones the unit's own skins replace when there is (the interior
//              keeps the game's own)
//   start      the tile starts as the vehicle's camouflage stretched AS A TILE: no cliff where it
//              meets itself
//   wrap       a stroke, a path fill and a flat decal over an edge all come back in on the other side,
//              and so does the decal converted to paint or exported "on the sheet"
//   view       the 2-D view draws the tile 3 × 3
//   export     pins by exact name, no set_tex line for the tile, the validator passes, the tile's
//              alpha is the camouflage's own — and then the REAL export (doExport, its download
//              caught): the zip's files, the .blk's text and the tile's pixels, as DDS and as TGA
//   project    the REAL .wtproj round trip (saveProject, a new session, loadProject): the tile beside
//              the slots and not among them, its layers, pixels, mode, the preview's scale and
//              rotation, and its alpha — which a restore has no camouflage sheet to measure again;
//              and the recovery copy's parts carry it too
//   bind       the viewport's material samples the tile where it pins and the game's own elsewhere
//   tc1        the camouflage's UV comes out of vertex format 4 / stride 20, through the OBJ a project
//              embeds and back, and a part whose format has none samples through its own UV
//   shader     a part with tc1 samples the camouflage through it, and one without keeps vUv
//   preview    the hangar's scale and rotation move the camouflage UV, and only in tile mode
//   clone      the Clone's SOURCE wraps as well as its destination, and Heal shifts every copy of a
//              dab alike
//   square     a picture loaded as the tile's pattern keeps the tile square, and ⋮ ▸ resolution…
//              keeps it square
//   calibration the Calibration grid read back as pixels (ground, frame, sixteen distinct numbers a
//              quarter of a cell high, the arrow toward +v) and pinned by hash — the bytes are a
//              function of the size alone, so a change to the grid is a change to the golden here;
//              the repeat length against plates of known UV density; the button and its undo
//
// No stored golden: every expectation is a colour the test painted itself or a number it can work
// out by hand. Usage: node tools/t106_camotile.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var flat = function(hex, w, h){ var c = mkCanvas(w, h), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, w, h); return c; };
  var sheet = function(r, g, b, a){ var w = 4, p = new Uint8Array(w * w * 4);
    for (var i = 0; i < w * w; i++) { p[i*4] = r; p[i*4+1] = g; p[i*4+2] = b; p[i*4+3] = a; } return { width: w, height: w, rgba: p }; };

  // ---- a ground vehicle with two camouflage stems: the hull's, and the crew compartment's ----
  App.matPaint = new Map([["hull", "us_camo_olive"], ["crew", "ger_camo_inside_elfebein"]]);
  App.paintTex = new Map([["us_camo_olive", sheet(82, 74, 54, 170)], ["ger_camo_inside_elfebein", sheet(200, 190, 160, 200)]]);
  App.paintColor = new Map([["us_camo_olive", [82, 74, 54]], ["ger_camo_inside_elfebein", [200, 190, 160]]]);
  App.skinUnits = [{ unit: { id: "us_m1a2_sep3_abrams", name: "M1A2", cls: "tank", country: "" }, score: 100, on: true }];
  $("expMode").value = "set_tex";
  $("expCamoBase").value = "tile";

  // ---- stems: with no unit blk to read (no game folder here), every stem the model uses ----
  CamoTile._stems = null;
  out.stemsNoUnit = CamoTile.stems().slice();
  // ...and with one, only what the unit's own skins replace. The blk reader is the one piece this
  // test cannot run without an install, so its answer is given — what is tested is the rule.
  CamoTile.unitStems = function(){ return new Set(["us_camo_olive"]); };
  CamoTile._stems = null;
  out.stemsUnit = CamoTile.stems().slice();

  // ---- the start: the vehicle's camouflage stretched AS A TILE, with no cliff where it meets itself ----
  // A tileable 4 × 4 camouflage, column 0 black and 1–3 white. Repeated, column 3 meets column 0 at
  // the tile's border exactly as column 0 meets column 1 inside it, so the step across the border
  // must be a step like the ones inside — not 255 | 0, which a canvas stretch clamped at its edge gave.
  var pat = new Uint8Array(64);
  for (var q = 0; q < 16; q++) { var pv = (q % 4) === 0 ? 0 : 255; pat[q*4] = pat[q*4+1] = pat[q*4+2] = pv; pat[q*4+3] = 170; }
  var oliveSheet = App.paintTex.get("us_camo_olive");
  App.paintTex.set("us_camo_olive", { width: 4, height: 4, rgba: pat });
  if (CamoTile.slot()) App.slots.delete(CamoTile.ID);
  var st = CamoTile.ensure(N), srow = ctx2d(st.baseC).getImageData(0, 128, N, 1).data, steps = [];
  for (var sx = 0; sx < N; sx++) steps.push(Math.abs(srow[((sx + 1) % N) * 4] - srow[sx * 4]));
  out.start = { inside: Math.max.apply(null, steps.slice(0, N - 1)), border: steps[N - 1], last: srow[(N - 1) * 4], first: srow[0] };
  App.slots.delete(CamoTile.ID);
  App.paintTex.set("us_camo_olive", oliveSheet);

  // ---- the slot ----
  var old = CamoTile.slot(); if (old) App.slots.delete(CamoTile.ID);
  var s = CamoTile.ensure(N);
  out.slot = { tile: !!s.camoTile, noGeom: !!s.noGeom, w: s.composite.width, h: s.composite.height,
    base: px(s.composite, 128, 128), alpha: CamoTile.alphaOf().a, alphaFrom: CamoTile.alphaOf().from, file: CamoTile.fileName() };

  // ---- a stroke over the right edge lands on the left (the item's second sentence) ----
  App.activeSlot = s; App.activeLayer = null; App.paint3d = true;
  App.selParts = new Set(); App.protectedParts = new Set(); Marquee.none();
  App.brush.mode = "color"; App.brush.color = "#ff0000";
  App.brush.size = 20; App.brush.hardness = 1; App.brush.opacity = 1; App.brush.spacing = .35;
  var began = beginStroke(false, false);
  if (began) { stampAt(250, 128); endStroke(); }
  // a dab on the bottom-right corner lands on all four
  if (beginStroke(false, false)) { stampAt(252, 252); endStroke(); }
  flushComposites();
  out.stroke = { began: began, at: px(s.composite, 250, 128), left: px(s.composite, 3, 128), far: px(s.composite, 128, 128),
    c00: px(s.composite, 2, 2), c10: px(s.composite, 252, 2), c01: px(s.composite, 2, 252) };

  // ---- the Clone wraps like the brush, and every copy of a dab takes the sheet's own source ----
  App.brush.color = "#ffff00";
  if (beginStroke(false, false)) { stampAt(128, 40); endStroke(); }
  flushComposites();
  App.brush.mode = "clone";
  Clone.pick(s, 128, 40);
  var cloned = beginStroke(false, false);
  if (cloned) { stampAt(250, 170); endStroke(); }
  flushComposites();
  out.clone = { began: cloned, at: px(s.composite, 250, 170), left: px(s.composite, 3, 170), src: px(s.composite, 128, 40) };
  App.brush.mode = "color";

  // ---- a path fill over the left edge comes back in on the right ----
  App.brush.color = "#00ff00";
  PathUI.path = { closed: true, pts: [{ x: -16, y: 60, hx: 0, hy: 0 }, { x: 16, y: 60, hx: 0, hy: 0 },
    { x: 16, y: 90, hx: 0, hy: 0 }, { x: -16, y: 90, hx: 0, hy: 0 }] };
  PathUI.fill();
  flushComposites();
  out.path = { inside: px(s.composite, 8, 75), wrapped: px(s.composite, 248, 75), away: px(s.composite, 128, 75) };
  PathUI.path = null;

  // ---- a flat decal over the right edge comes back in on the left ----
  var dec = LayerNode.of({ type: "decal", name: "d", bmp: flat("#0000ff", 40, 40), x: 248 / N, y: 205 / N,
    scale: 1, rot: 0, flip: false, sym: null, mask: null, visible: true, opacity: 1, blend: "normal" });
  s.layers.push(dec);
  compositeSlot(s); flushComposites();
  out.decal = { own: px(s.composite, 236, 205), wrapped: px(s.composite, 4, 205), away: px(s.composite, 128, 205) };
  // ...and it keeps both halves off the compositor's own walk: converted to paint in the Channels
  // strip (then undone, so the rest of the test has its decal), and exported "on the sheet".
  ChanStrip.convert(s, dec, "color", "paint");
  compositeSlot(s); flushComposites();
  out.convert = { kind: LayerNode.contentOn(dec, "color").kind, own: px(s.composite, 236, 205), wrapped: px(s.composite, 4, 205) };
  doUndo(); compositeSlot(s); flushComposites();
  out.convert.back = LayerNode.contentOn(dec, "color").kind;
  var onSheet = LayerExport.sheet(s, dec, "color");
  out.onSheet = { own: px(onSheet, 236, 205), wrapped: px(onSheet, 4, 205) };

  // ---- the 2-D view draws the tile 3 x 3 ----
  cnv2.width = 300; cnv2.height = 300;
  v2.sc = .5; v2.ox = 86; v2.oy = 86; v2.fit = false; v2.uvOn = false; v2.cursor = null;
  App.chanView = "shaded"; App.compare = false;
  draw2DNow();
  var view = function(tx, ty){ var d = ctx2d(cnv2).getImageData(Math.round(v2.ox + tx * v2.sc), Math.round(v2.oy + ty * v2.sc), 1, 1).data; return [d[0], d[1], d[2]]; };
  out.view = { sheet: view(128, 128), right: view(256 + 128, 128), below: view(128, 256 + 128), diag: view(-128, -128) };
  var plain = { id: "plain", size: N, layers: [], missing: false, baseC: flat("#556677", N, N), composite: flat("#556677", N, N) };
  App.activeSlot = plain; draw2DNow();
  out.viewPlain = { right: view(256 + 128, 128) };
  App.activeSlot = s;

  // ---- export: pins by exact name (the item's first sentence) ----
  var pins = camoPinPlan();
  var rows = collectExports(true);
  var plan = buildExportPlan(rows, { estimate: true });
  var res = validateExport(plan);
  var items = collectExports();
  var tileItem = items.filter(function(i){ return i.camoTile; })[0];
  var alphas = {}; if (tileItem) for (var i = 3; i < tileItem.rgba.length; i += 4) alphas[tileItem.rgba[i]] = 1;
  var blk = buildBlk(items, "set_tex", camoPins());
  out.export = { pins: pins.map(function(p){ return p.stem + ">" + p.fileName + ">" + p.source; }),
    rows: rows.filter(function(r){ return r.camoTile; }).length,
    blkPlan: plan.blkText, blk: blk,
    errors: res.filter(function(r){ return r.level === "error"; }).map(function(r){ return r.id + ": " + r.title; }),
    blkrefs: (res.filter(function(r){ return r.id === "blkrefs"; })[0] || {}).level,
    alphas: Object.keys(alphas), tileW: tileItem ? tileItem.w : 0 };
  // unticked in Textures out: no file, and no pin naming one
  expOpt(s, "c").off = true;
  out.export.offPins = camoPinPlan().length; out.export.offItems = collectExports().filter(function(i){ return i.camoTile; }).length;
  expOpt(s, "c").off = false;
  // and in any other mode the tile is neither shipped nor pinned
  $("expCamoBase").value = "stock";
  out.export.stockItems = collectExports(true).filter(function(i){ return i.camoTile; }).length;
  out.export.stockPins = camoPinPlan().filter(function(p){ return p.source === "tile"; }).length;
  $("expCamoBase").value = "tile";

  // ---- the REAL export: doExport, its download caught and the zip read back ----
  // What reaches the player is the archive, so the archive is what is read: its file names, the
  // .blk's text, and the tile's own pixels decoded out of it — as DDS, then as TGA.
  // The unit's own sheets are given, as the desc would give them with the game folder open: the tile
  // is none of them, and it must still go into that unit's .blk.
  $("skinName").value = "camotest";
  var clickWas = HTMLAnchorElement.prototype.click, got = null, unitStemsWas = stemsForUnit;
  stemsForUnit = function(){ return new Set(["us_m1a2_sep3_hull_c", "us_m1a2_sep3_hull_n"]); };
  HTMLAnchorElement.prototype.click = function(){ got = this.href; };
  var exportZip = async function(){
    got = null;
    // A throw is an answer here, not the end of the test: it is recorded and the zip checks fail on it.
    try { await doExport(false); } catch (e) { return { none: true, status: "threw: " + String(e && e.message || e) }; }
    for (var w = 0; w < 600 && !got; w++) await new Promise(function(r){ setTimeout(r, 50); });
    if (!got) return { none: true, status: statusEl.textContent };
    var zip = await JSZip.loadAsync(await (await fetch(got)).blob()), names = [];
    zip.forEach(function(rel, f){ if (!f.dir) names.push(rel); });
    var o = { files: names.sort(), status: statusEl.textContent };
    for (var k = 0; k < names.length; k++) {
      var nm = names[k];
      if (/\\.blk$/.test(nm)) o.blk = await zip.file(nm).async("string");
      if (/wtss_camo_tile\\.(dds|tga)$/.test(nm)) {
        var buf = await zip.file(nm).async("arraybuffer"), d = /\\.dds$/.test(nm) ? DDS.parseDDS(buf) : TGA.parseTGA(buf), m = d.mips[0].rgba, seen = {};
        for (var q2 = 3; q2 < m.length; q2 += 4) seen[m[q2]] = 1;
        var at = function(x, y){ var i = (y * d.width + x) * 4; return [m[i], m[i + 1], m[i + 2]]; };
        o.tile = { w: d.width, h: d.height, alphas: Object.keys(seen), at250: at(250, 128), at3: at(3, 128), mid: at(128, 150) };
      }
    }
    return o;
  };
  try {
    out.zipDds = await exportZip();
    expOpt(s, "c").fmt = "tga";
    out.zipTga = await exportZip();
  } finally { expOpt(s, "c").fmt = ""; HTMLAnchorElement.prototype.click = clickWas; stemsForUnit = unitStemsWas; }
  // ...and the preference never remembers "tile": a new session has no tile to be on.
  out.pref = PREFS.filter(function(p){ return p.id === "camoBase"; })[0].get();

  // ---- the REAL project file: saveProject, a new session, loadProject ----
  // A recovery copy is these same parts (core/autosave.js), so they are read first.
  CamoTile.view.scale = 1.5; CamoTile.view.rot = 30;
  var layersBefore = s.layers.length;
  var parts = await ProjectFile.parts();
  out.recovery = { tile: !!parts.meta.camoTile, slots: parts.meta.slots.map(function(x){ return x.id; }) };
  HTMLAnchorElement.prototype.click = function(){ got = this.href; };
  got = null;
  try { await saveProject(); } finally { HTMLAnchorElement.prototype.click = clickWas; }
  var projBlob = got ? await (await fetch(got)).blob() : null;
  var meta = projBlob ? JSON.parse(await (await JSZip.loadAsync(projBlob)).file("project.json").async("string")) : null;
  out.projectFile = meta ? { slots: meta.slots.map(function(x){ return x.id; }), tile: !!meta.camoTile, on: meta.camoTile && meta.camoTile.on,
    size: meta.camoTile && meta.camoTile.size, alpha: meta.camoTile && meta.camoTile.alpha } : null;
  // The new session. A restore reads no camouflage sheet: App.paintTex is filled by a game-folder
  // vehicle load and by a loaded skin, never by a .wtproj. The desc's bind (App.matPaint) is back, as
  // a restore with the game folder indexed has it.
  var sheetsWere = { pt: new Map(App.paintTex), pc: new Map(App.paintColor) };   // copies: clearVehicleState empties the Maps themselves
  clearVehicleState();
  App.matPaint = new Map([["hull", "us_camo_olive"], ["crew", "ger_camo_inside_elfebein"]]);
  App.skinUnits = [{ unit: { id: "us_m1a2_sep3_abrams", name: "M1A2", cls: "tank", country: "" }, score: 100, on: true }];
  $("expMode").value = "set_tex"; CamoTile._stems = null;
  out.projectCleared = { mode: $("expCamoBase").value, slot: !!CamoTile.slot() };
  if (projBlob) await loadProject(projBlob);
  for (var pw = 0; pw < 200 && App.pendingProject; pw++) await new Promise(function(r){ setTimeout(r, 50); });
  flushComposites();
  var back = CamoTile.slot();
  var tileRow = function(prev){ return collectExports(prev).filter(function(i){ return i.camoTile; })[0] || null; };
  var backItem = tileRow(false), backAlphas = {};
  if (backItem) for (var ba = 3; ba < backItem.rgba.length; ba += 4) backAlphas[backItem.rgba[ba]] = 1;
  out.project = { pending: !!App.pendingProject, isSlot: !!back, mode: $("expCamoBase").value,
    size: back ? back.composite.width : 0, sizeH: back ? back.composite.height : 0,
    layers: back ? back.layers.length : 0, layersBefore: layersBefore,
    left: back ? px(back.composite, 3, 128) : null, decal: back ? px(back.composite, 4, 205) : null,
    scale: CamoTile.view.scale, rot: CamoTile.view.rot, alphas: Object.keys(backAlphas),
    note: (tileRow(true) || {}).covNote || "" };
  // the rest of the test goes on in the session the file was saved from
  App.paintTex = sheetsWere.pt; App.paintColor = sheetsWere.pc;
  s = back || CamoTile.ensure(N);
  App.activeSlot = s; App.activeLayer = null;

  // ---- the viewport binds the tile where it pins, the game's own camouflage where it does not ----
  var hull = { id: "hull_c", size: 16, sizeH: 16, layers: [], missing: false, baseC: flat("#556677", 16, 16), composite: null, tex: null };
  ensureComposite(hull, 16, 16); compositeSlot(hull);
  App.slots.set("hull_c", hull); App.matSlot.set("hull", "hull_c"); App.matSlot.set("crew", "hull_c");
  var tintWas = App.paintTint; App.paintTint = true;
  var gT = new THREE.BufferGeometry();
  gT.setAttribute("camoUv", new THREE.BufferAttribute(new Float32Array(6), 2));
  var tileTex = s.tex, mHull = makeMaterial("hull", "hullMesh", gT), mCrew = makeMaterial("crew", "crewMesh", gT);
  $("expCamoBase").value = "stock";
  var mStock = makeMaterial("hull", "hullMesh", gT);
  $("expCamoBase").value = "tile";
  out.bind = { tileTex: !!tileTex, hull: !!tileTex && mHull.emissiveMap === tileTex,
    crew: !!mCrew.emissiveMap && mCrew.emissiveMap !== tileTex, stock: !!mStock.emissiveMap && mStock.emissiveMap !== tileTex };
  App.paintTint = tintWas;
  App.slots.delete("hull_c"); App.matSlot.delete("hull"); App.matSlot.delete("crew");

  // ---- tc1: format 4 / stride 20 carries the camouflage's UV in front of the position ----
  var fmt = MV_FMT[4][20];
  var buf = new ArrayBuffer(24 + 32 + 3 * 20 + 6), dv = new DataView(buf);
  dv.setUint32(16, 24, true); dv.setUint32(20, 1, true);                    // gvdOfs, gvdCnt
  dv.setUint32(24, 3, true); dv.setUint8(28, 20); dv.setUint32(32, 6, true); // vCnt, stride, iSz (iPackedSz 0)
  dv.setUint32(44, 4, true);                                                 // storageFormat
  var tc1 = [[.25, .5], [.75, .125], [.5, .875]];
  for (var k = 0; k < 3; k++) {
    var o = 56 + k * 20;
    dv.setInt16(o, tc1[k][0] * 4096, true); dv.setInt16(o + 2, tc1[k][1] * 4096, true);
    dv.setInt16(o + 4, k * 1000, true); dv.setInt16(o + 16, 2048, true); dv.setInt16(o + 18, 1024, true);
  }
  dv.setUint16(116, 0, true); dv.setUint16(118, 1, true); dv.setUint16(120, 2, true);
  var vd = new MatVData(new Uint8Array(buf)).getVertexData(0);
  out.tc1 = { field: fmt[0][0], cuvs: vd.cuvs, uv0: vd.uvs[0], faces: vd.faces.length };
  // ...through the OBJ a project embeds, and back; a vertex with none makes its part fall back
  var geo = { verts: [[0,0,0],[1,0,0],[0,1,0],[1,1,0]], uvs: [[0,0],[1,0],[0,1],[1,1]],
    cuvs: [[.1, .2], [.3, .4], [.5, .6], undefined],
    objects: [{ name: "hull", groups: [{ matIndex: 0, faces: [[0, 1, 2]] }] }, { name: "hatch", groups: [{ matIndex: 0, faces: [[1, 3, 2]] }] }] };
  var txt = buildOBJText(geo, null, "x.mtl");
  var gd = buildGeometryData(parseOBJ(txt)), gd2 = geomDataFromExtracted(geo, null);
  var cuvOf = function(list, nm){ var g = list.filter(function(e){ return e.name.indexOf(nm) === 0; })[0]; return g && g.camoUv ? Array.from(g.camoUv) : null; };
  out.obj = { lines: (txt.match(/^#vt1 /gm) || []).length, none: (txt.match(/^#vt1 -$/gm) || []).length,
    hull: cuvOf(gd, "hull"), hatch: cuvOf(gd, "hatch"), hull2: cuvOf(gd2, "hull"), hatch2: cuvOf(gd2, "hatch"),
    plainObj: !!buildGeometryData(parseOBJ("v 0 0 0\\nv 1 0 0\\nv 0 1 0\\nvt 0 0\\nvt 1 0\\nvt 0 1\\nf 1/1 2/2 3/3"))[0].camoUv };

  // ---- the shader: tc1 where the part has it, vUv where it does not ----
  var shaderFor = function(camoUv){
    var m = new THREE.MeshStandardMaterial({});
    applyPaintTint(m, { stem: "us_camo_olive", col: [82, 74, 54], k: 1, tex: new THREE.Texture(), camoUv: camoUv,
      stockTex: null, maskTex: null, edited: false, keepAlpha: false });
    var sh = { uniforms: {}, vertexShader: "#include <common>\\nvoid main(){\\n#include <uv_vertex>\\n}",
      fragmentShader: "#include <common>\\nvoid main(){\\n#include <alphamap_fragment>\\n}" };
    m.onBeforeCompile(sh);
    return { key: m.customProgramCacheKey(), attr: sh.vertexShader.indexOf("attribute vec2 camoUv") >= 0,
      pass: sh.vertexShader.indexOf("vWtCamoUv = camoUv") >= 0, viaTc1: sh.fragmentShader.indexOf("texture2D( emissiveMap, vWtCamoUv )") >= 0,
      viaUv: sh.fragmentShader.indexOf("texture2D( emissiveMap, vUv )") >= 0 };
  };
  out.shader = { tc1: shaderFor(true), none: shaderFor(false) };

  // ---- the preview: the hangar's scale and rotation, in tile mode only ----
  var at = function(u, v){ return Array.from(CamoTile.xform(new Float32Array([u, v]))).map(function(x){ return Math.round(x * 1000) / 1000; }); };
  CamoTile.view.scale = 2; CamoTile.view.rot = 0; out.xScale = at(1, .5);
  CamoTile.view.scale = 1; CamoTile.view.rot = 90; out.xRot = at(1, .5);
  $("expCamoBase").value = "stock"; out.xStock = at(1, .5); $("expCamoBase").value = "tile";
  var g3 = new THREE.BufferGeometry();
  g3.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  g3.setAttribute("camoUv", new THREE.BufferAttribute(new Float32Array(6), 2));
  var mesh = new THREE.Mesh(g3, new THREE.MeshBasicMaterial());
  mesh.userData.camoUv0 = new Float32Array([1, .5, 0, .5, .5, .5]);
  var meshesWas = App.meshes; App.meshes = new Map([["m", mesh]]);
  CamoTile.view.scale = 2; CamoTile.view.rot = 0;
  CamoTile.applyView();
  out.applied = Array.from(g3.attributes.camoUv.array).map(function(x){ return Math.round(x * 1000) / 1000; });
  App.meshes = meshesWas;
  CamoTile.view.scale = 1; CamoTile.view.rot = 0;

  // ---- the wear tool is refused on a tile: its alpha is the camouflage's own ----
  App.brush.mode = "wear";
  var pt = paintTarget();
  out.wear = pt && pt.err ? pt.err : "";
  App.brush.mode = "color";

  // ---- the Clone's SOURCE wraps too, not only its destination ----
  // A fresh tile with a yellow band over its whole width, y 100..200. Source (100,128); the first
  // dab at (150,40) fixes the aligned offset at (-50,+88). A tile repeats, so a dab whose home copy
  // is at x reads wrap(x - 50): yellow on rows 40 and 70 at every x. Measured before the fix: a dab
  // with the pointer at (262,40) — home x 6, source x -44 — left x 6 and 3 as they were, and a stroke
  // dragged from 230 to 290 on row 70 copied up to x 2 and then left x 12-30 untouched.
  App.slots.delete(CamoTile.ID);
  var t2 = CamoTile.ensure(N);
  App.activeSlot = t2; App.activeLayer = null;
  var gb = ctx2d(t2.baseC); gb.fillStyle = "#ffff00"; gb.fillRect(0, 100, N, 100);
  compositeSlot(t2); flushComposites();
  App.brush.mode = "clone"; App.brush.size = 12; App.brush.spacing = .2;
  Clone.pick(t2, 100, 128);
  if (beginStroke(false, false)) { stampAt(150, 40); endStroke(); }
  if (beginStroke(false, false)) { stampAt(262, 40); endStroke(); }
  if (beginStroke(false, false)) { stampAt(230, 70); stampAt(290, 70); endStroke(); }
  flushComposites();
  out.cloneSeam = { first: px(t2.composite, 150, 40), home6: px(t2.composite, 6, 40), home3: px(t2.composite, 3, 40),
    row: [240, 252, 2, 12, 20, 30].map(function(x){ return px(t2.composite, x, 70); }) };
  // ...and Heal shifts every copy of a dab by the same tone. Red up to the right edge and blue from
  // the left one on rows 215-255, a flat olive source between them: a healed dab on the right edge
  // is two copies, and each must take the tone of the WHOLE destination under the brush — which on a
  // tile runs over the edge — or the two halves of one dab come out red and blue.
  gb.fillStyle = "#ff0000"; gb.fillRect(200, 215, N - 200, 41);
  gb.fillStyle = "#0000ff"; gb.fillRect(0, 215, 40, 41);
  compositeSlot(t2); flushComposites();
  App.brush.size = 24; App.brush.heal = true;
  Clone.pick(t2, 120, 235);
  if (beginStroke(false, false)) { stampAt(250, 235); endStroke(); }
  flushComposites();
  App.brush.heal = false; App.brush.mode = "color"; App.brush.size = 20; App.brush.spacing = .35;
  out.heal = { right: px(t2.composite, 254, 235), left: px(t2.composite, 1, 235), src: px(t2.composite, 120, 235) };

  // ---- a pattern of another shape keeps the tile square ----
  // ⋮ ▸ load a pattern… with a 512 × 256 picture adopted its size: the export refused the tile, and
  // a save and reload stretched it to 512². Now it is stretched to the tile — and said so.
  var pw2 = 512, ph2 = 256, prgba = new Uint8ClampedArray(pw2 * ph2 * 4);
  for (var pi = 0; pi < pw2 * ph2; pi++) { prgba[pi*4] = 30; prgba[pi*4+1] = 140; prgba[pi*4+2] = 60; prgba[pi*4+3] = 255; }
  applyReplaceTexture(t2, { width: pw2, height: ph2, mips: [{ w: pw2, h: ph2, rgba: prgba }] }, false, "pattern.png");
  flushComposites();
  var prow = collectExports(true), pplan = buildExportPlan(prow, { estimate: true });
  out.pattern = { w: t2.composite.width, h: t2.composite.height, base: px(t2.baseC, 128, 20),
    status: statusEl.textContent,
    errors: validateExport(pplan).filter(function(r){ return r.level === "error"; }).map(function(r){ return r.id + ": " + r.title; }) };
  // ...and ⋮ ▸ resolution… puts a tile that is somehow not square back to square, offering only the
  // sizes a ground vehicle's texture may have.
  resizeSlot(t2, 512, 256);
  var dialogWas = choiceDialog, offered = null;
  choiceDialog = async function(msg, opts){ offered = opts.map(function(o){ return o.value; }).filter(Boolean); return "512"; };
  try { await resizeSlotPrompt(t2); } finally { choiceDialog = dialogWas; }
  out.resized = { w: t2.composite.width, h: t2.composite.height, offered: offered };

  // ---- a unit whose skins name none of THIS model's stems (34 of 2 086): every stem, not none ----
  CamoTile.unitStems = function(){ return new Set(["camo_hazegray"]); };
  CamoTile._stems = null;
  out.stemsNone = CamoTile.stems().slice();
  CamoTile.unitStems = function(){ return new Set(["us_camo_olive"]); };
  CamoTile._stems = null;

  // ---- nothing to pin is said: a deleted tile, then an unticked one; Edit tile makes a new one ----
  App.slots.delete(CamoTile.ID); App.activeSlot = null; App.activeLayer = null;
  updateExportWarnings();
  out.gone = { warn: $("expWarn").textContent, pins: camoPinPlan().length };
  $("btnCamoTileEdit").onclick();
  out.remade = { slot: !!CamoTile.slot(), active: !!CamoTile.slot() && App.activeSlot === CamoTile.slot(), pins: camoPinPlan().length };
  updateExportWarnings();
  out.remade.warn = $("expWarn").textContent;
  expOpt(CamoTile.slot(), "c").off = true;
  updateExportWarnings();
  out.unticked = $("expWarn").textContent;
  expOpt(CamoTile.slot(), "c").off = false;

  // ---- one undo takes both halves of a wrapped stroke back ----
  // On the new tile, 1024² at the default size: the undo snapshots 256² tiles, so on the 256² tile
  // above the whole sheet is one and a half the undo forgot would still come back.
  var big = CamoTile.slot(), B = big.composite.width;
  App.brush.mode = "color"; App.brush.color = "#ff00ff";
  if (beginStroke(false, false)) { stampAt(B - 6, 100); endStroke(); }
  flushComposites();
  var undoBefore = [px(big.composite, B - 6, 100), px(big.composite, 3, 100)];
  doUndo(); flushComposites();
  out.undo = { B: B, before: undoBefore, after: [px(big.composite, B - 6, 100), px(big.composite, 3, 100)] };

  // ---- the calibration grid (4.50 (6)): the camouflage's scale made checkable ----
  // Read back as pixels, never through the function's own geometry: the ground, the frame, what the
  // digits are and how tall, and which way the arrow points.
  var CN = 256, cal = CamoTile.calibration(CN), cdat = ctx2d(cal).getImageData(0, 0, CN, CN).data;
  var cpx = function(x, y){ var i = (y * CN + x) * 4; return [cdat[i], cdat[i+1], cdat[i+2], cdat[i+3]]; };
  var isRed = function(p){ return p[0] > 200 && p[1] < 60 && p[2] < 60; };
  var isWhite = function(p){ return p[0] > 240 && p[1] > 240 && p[2] > 240; };
  var isYel = function(p){ return p[0] > 200 && p[1] > 180 && p[2] < 80; };
  var cellSz = CN / 4, redN = 0, ink = [], arrow = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, rows: {} }, arrowOutside = 0;
  for (var k = 0; k < 16; k++) ink.push({ x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0, bits: [] });
  for (var y = 0; y < CN; y++) for (var x = 0; x < CN; x++) {
    var q = cpx(x, y), cell = Math.floor(y / cellSz) * 4 + Math.floor(x / cellSz);
    if (isRed(q)) redN++;
    if (isWhite(q)) { var b = ink[cell]; b.n++; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.bits.push([x, y]); }
    if (isYel(q)) {
      if (cell !== 0) arrowOutside++;
      arrow.x0 = Math.min(arrow.x0, x); arrow.x1 = Math.max(arrow.x1, x); arrow.y0 = Math.min(arrow.y0, y); arrow.y1 = Math.max(arrow.y1, y);
      arrow.rows[y] = (arrow.rows[y] || 0) + 1;
    }
  }
  // a glyph's shape, relative to the ink's own top-left, as a string — one per cell, and per digit
  var shape = function(b, xa, xb){ return b.bits.filter(function(t){ return t[0] >= xa && t[0] <= xb; })
    .map(function(t){ return (t[0] - xa) + "," + (t[1] - b.y0); }).join(";"); };
  var rowsY = Object.keys(arrow.rows).map(Number).sort(function(a, b){ return a - b; });
  var widest = rowsY.reduce(function(m, y){ return arrow.rows[y] > arrow.rows[m] ? y : m; }, rowsY[0]);
  var fnv = function(a){ var h = 2166136261; for (var i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  var cal2 = ctx2d(CamoTile.calibration(CN)).getImageData(0, 0, CN, CN).data;
  var bigCal = ctx2d(CamoTile.calibration(1024)).getImageData(0, 0, 1024, 1024).data;
  var e11 = ink[10], e11w = e11.x1 - e11.x0 + 1, e11half = (e11w - 1) / 2;
  out.cal = {
    ground: [cpx(150, 180), cpx(60, 200), cpx(200, 100)],
    edges: [cpx(0, 100), cpx(1, 100), cpx(2, 100), cpx(254, 100), cpx(255, 100), cpx(253, 100), cpx(100, 0), cpx(100, 1), cpx(100, 2), cpx(100, 254), cpx(100, 255), cpx(100, 253)],
    redN: redN, alpha: cpx(100, 100)[3],
    ink: ink.map(function(b){ return { n: b.n, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1,
      inCell: b.n > 0 && Math.floor(b.x0 / cellSz) === Math.floor(b.x1 / cellSz) && Math.floor(b.y0 / cellSz) === Math.floor(b.y1 / cellSz) }; }),
    shapes: ink.map(function(b){ return shape(b, b.x0, b.x1); }),
    // "11": its two digits are one glyph twice, and that glyph is the 1 of cell 1 (the cell's arrow is yellow, not ink)
    one: shape(ink[0], ink[0].x0, ink[0].x1), ones: [shape(e11, e11.x0, e11.x0 + (ink[0].x1 - ink[0].x0)), shape(e11, e11.x1 - (ink[0].x1 - ink[0].x0), e11.x1)],
    arrow: { w: arrow.x1 - arrow.x0 + 1, h: arrow.y1 - arrow.y0 + 1, outside: arrowOutside,
      top: arrow.rows[arrow.y0], bottom: arrow.rows[arrow.y1], widestAt: (widest - arrow.y0) / (arrow.y1 - arrow.y0), widest: arrow.rows[widest] },
    same: fnv(cdat) === fnv(cal2), hash: fnv(cdat), hash1024: fnv(bigCal), cell: cellSz,
  };

  // ---- the repeat length, from the model's own tc1 against its positions ----
  // A 10 × 4 m plate at exactly 0.08 UV a metre (12.5 m a repeat), a small nuisance part at 1 UV a
  // metre (the median is by AREA, so it cannot move it), an effect card and a bone-driven net far
  // away (neither is hull, so neither may stretch its length), a part whose material has no camouflage stem (tracks, fittings drawn from the same vertex format), and a part with no tc1 at all.
  var plate = function(x0, z0, w, d, dens, y){ var P = [x0, y, z0, x0 + w, y, z0, x0 + w, y, z0 + d, x0, y, z0, x0 + w, y, z0 + d, x0, y, z0 + d], T = [];
    for (var i = 0; i < 6; i++) T.push(P[i*3] * dens, P[i*3+2] * dens);
    return { pos: new Float32Array(P), uv: new Float32Array(T) }; };
  var fake = function(part, ud){ return { name: "p", geometry: { attributes: { position: { array: part.pos } } },
    userData: Object.assign({ camoUv0: part.uv, mat: "hull" }, ud || {}) }; };
  var hull1 = plate(0, 0, 10, 4, .08, 0), nuis = plate(2, 1, .3, .3, 1, 1);
  out.measure = { plate: CamoTile.measure([hull1, nuis]), none: CamoTile.measure([]) };
  var meshesWas = App.meshes;
  App.meshes = new Map([["hull", fake(hull1)], ["nuis", fake(nuis)],
    ["flame", fake(plate(100, 0, 50, 1, .08, 0), { effect: true })],
    ["net", fake(plate(-90, 0, 50, 1, .08, 0), { unposed: true })],
    ["decor", fake(plate(0, 0, 60, 1, .08, 0), { mat: "tracks" })],
    ["plain", { name: "plain", geometry: { attributes: { position: { array: plate(0, 0, 80, 1, .08, 0).pos } } }, userData: {} }]]);
  out.measure.hull = CamoTile.scaleInfo();
  updateExportWarnings();
  out.measure.row = $("rowCamoCal").style.display;
  out.measure.text = $("camoTileInfo").textContent;
  // the button: the grid goes in as the tile's base, in one undo step
  var tileSl = CamoTile.slot(), TB = tileSl.baseC.width;
  var bpx = function(x, y){ var d = ctx2d(tileSl.baseC).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var calBefore = bpx(0, 500);
  $("btnCamoTileCal").click(); flushComposites();
  out.measure.button = { TB: TB, before: calBefore, edge: bpx(0, 500), edgeR: bpx(TB - 1, 500), ground: bpx(Math.round(TB * .6), Math.round(TB * .55)),
    status: $("status").textContent };
  doUndo(); flushComposites();
  out.measure.button.undone = bpx(0, 500);
  // ---- the same button takes the grid out again (ROADMAP 3.45) ----
  // "Exactly the base the tile had before, even after other edits": read whole, as an FNV hash of
  // its bytes, and the edit between is a redo that brings the grid back with no click at all — the
  // button has to see it from the pixels, not from a flag the click set.
  var baseHash = function(){ var d = ctx2d(tileSl.baseC).getImageData(0, 0, TB, TB).data, h = 2166136261;
    for (var i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; };
  var calLabel = function(){ updateExportWarnings(); return $("btnCamoTileCal").textContent; };
  var tg = out.measure.toggle = { before: baseHash(), outLabel: calLabel() };
  doRedo(); flushComposites();
  tg.redoLabel = calLabel();
  var calRows = function(){ return validateExport(buildExportPlan(collectExports(true).filter(function(it){ return !it.off; }), { estimate: true }))
    .filter(function(r){ return r.id === "calgrid"; }).map(function(r){ return r.level + ": " + r.title; }); };
  tg.rowIn = calRows();
  Autosave.changed();                                            // another edit, with no step of its own
  $("btnCamoTileCal").click(); flushComposites();
  tg.removed = baseHash(); tg.removedStatus = $("status").textContent; tg.removedLabel = calLabel(); tg.rowOut = calRows();
  doUndo(); flushComposites();
  tg.undoneRemove = calLabel();
  // After a reload the kept base is gone (memory only, by decision): the tile goes back to its start.
  CamoTile.calBase = null;
  $("btnCamoTileCal").click(); flushComposites();
  tg.lost = { label: calLabel(), status: $("status").textContent, hash: baseHash(),
    start: (function(){ var d = ctx2d(CamoTile.startSheet(TB)).getImageData(0, 0, TB, TB).data, h = 2166136261;
      for (var i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; })() };
  doUndo(); doUndo(); flushComposites();
  // A tile resized with the grid in still wears the grid (drawn at the new size, not resampled), and
  // Remove grid then puts the kept base back at that size — the review's case: resampled, the grid
  // was no longer recognised and the next click kept the grid as "the base before".
  var keptPx = function(x, y){ var d = ctx2d(tileSl.baseC).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var mid = keptPx(TB >> 1, TB >> 1);
  $("btnCamoTileCal").click(); flushComposites();
  resizeSlot(tileSl, 2 * TB, 2 * TB); flushComposites();
  tg.resized = { label: calLabel(), w: tileSl.baseC.width };
  $("btnCamoTileCal").click(); flushComposites();
  tg.resized.after = calLabel(); tg.resized.mid = keptPx(TB, TB); tg.resized.was = mid; tg.resized.edge = keptPx(0, 3);
  resizeSlot(tileSl, TB, TB); flushComposites();
  App.meshes = new Map();
  updateExportWarnings();
  out.measure.empty = $("camoTileInfo").textContent;
  App.meshes = meshesWas;

  // ---- the tile goes with its vehicle, and the menu back to the vehicle's own camouflage ----
  CamoTile.view.scale = 1.4; CamoTile.view.rot = 12;
  clearVehicleState();
  out.cleared = { mode: $("expCamoBase").value, slot: !!CamoTile.slot(), scale: CamoTile.view.scale, rot: CamoTile.view.rot };

  App.slots.delete(CamoTile.ID); App.activeSlot = null; App.skinUnits = [];
  App.matPaint = new Map(); App.paintTex = new Map(); App.paintColor = new Map();
  $("expCamoBase").value = "stock"; $("expMode").value = "auto";
  return out;
}`;

// Two real exports and a real project round trip go through the worker pools: minutes under load.
const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep"), timeoutMs: 240000 });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 600)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const rgb = a => a ? `rgb(${a[0]},${a[1]},${a[2]})` : "none";
const red = a => a && a[0] > 200 && a[1] < 60 && a[2] < 60;
const green = a => a && a[1] > 200 && a[0] < 60 && a[2] < 60;
const blue = a => a && a[2] > 200 && a[0] < 60 && a[1] < 60;
const olive = a => a && Math.abs(a[0] - 82) < 12 && Math.abs(a[1] - 74) < 12 && Math.abs(a[2] - 54) < 12;
const near = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

console.log("=== which camouflage the tile replaces ===");
R.is(JSON.stringify(o.stemsNoUnit) === JSON.stringify(["us_camo_olive", "ger_camo_inside_elfebein"]),
  `with no unit blk to read, every stem the model uses (${o.stemsNoUnit.join(", ")})`);
R.is(JSON.stringify(o.stemsUnit) === JSON.stringify(["us_camo_olive"]),
  `with one, only what the unit's own skins replace (${o.stemsUnit.join(", ")}) — the crew compartment keeps the game's own`);

console.log("\n=== the tile starts as the vehicle's camouflage, stretched as a tile ===");
R.is(o.start.inside > 0 && o.start.border <= 2 * o.start.inside,
  `where the repeat meets itself the step is one like those inside (${o.start.last} | ${o.start.first}: ${o.start.border} against at most ${o.start.inside} inside) — not a cliff`);

console.log("\n=== the slot ===");
R.is(o.slot.tile && o.slot.noGeom && o.slot.w === 256 && o.slot.h === 256, `a square 2-D-only slot, ${o.slot.w}×${o.slot.h}`);
R.is(olive(o.slot.base), `it starts as the vehicle's own camouflage, stretched (${rgb(o.slot.base)})`);
R.is(o.slot.alpha === 170 && o.slot.alphaFrom === "sheet",
  `its exported alpha is the replaced camouflage's own mean (${o.slot.alpha}, measured off its ${o.slot.alphaFrom}), not 255 — and not the interior's 200`);
R.is(o.slot.file === "wtss_camo_tile.dds", `its file is ${o.slot.file}`);

console.log("\n=== a stroke over the right edge lands on the left ===");
R.is(o.stroke.began, "the stroke began (a paint layer was made for it)");
R.is(red(o.stroke.at), `the dab where it was put (${rgb(o.stroke.at)})`);
R.is(red(o.stroke.left), `and its other half at the LEFT edge (${rgb(o.stroke.left)}) — the item's gate`);
R.is(olive(o.stroke.far), `while the middle of the sheet is untouched (${rgb(o.stroke.far)})`);
R.is(red(o.stroke.c00) && red(o.stroke.c10) && red(o.stroke.c01),
  `a dab on a corner lands on all four (${rgb(o.stroke.c00)}, ${rgb(o.stroke.c10)}, ${rgb(o.stroke.c01)})`);

const yellow = a => a && a[0] > 200 && a[1] > 200 && a[2] < 60;
R.is(o.clone.began && yellow(o.clone.src) && yellow(o.clone.at) && yellow(o.clone.left),
  `a Clone stroke at the right edge copies its source to both sides (${rgb(o.clone.at)}, left ${rgb(o.clone.left)}) — every copy reads the sheet's own pixels`);

console.log("\n=== a path fill and a flat decal wrap too ===");
R.is(green(o.path.inside) && green(o.path.wrapped), `a shape across the left edge fills both sides (${rgb(o.path.inside)}, ${rgb(o.path.wrapped)})`);
R.is(!green(o.path.away), `and nothing between (${rgb(o.path.away)})`);
R.is(blue(o.decal.own) && blue(o.decal.wrapped), `a decal across the right edge shows on both sides (${rgb(o.decal.own)}, ${rgb(o.decal.wrapped)})`);
R.is(!blue(o.decal.away), `and nowhere else (${rgb(o.decal.away)})`);
R.is(o.convert.kind === "paint" && blue(o.convert.own) && blue(o.convert.wrapped) && o.convert.back === "image",
  `converted to paint it keeps both halves (${rgb(o.convert.own)}, ${rgb(o.convert.wrapped)}), and Ctrl+Z makes it a decal again`);
R.is(blue(o.onSheet.own) && blue(o.onSheet.wrapped), `exported "on the sheet" too (${rgb(o.onSheet.own)}, ${rgb(o.onSheet.wrapped)})`);

console.log("\n=== the 2-D view draws it 3 × 3 ===");
const bg = a => a[0] < 30 && a[1] < 30 && a[2] < 35;
R.is(!bg(o.view.sheet) && !bg(o.view.right) && !bg(o.view.below) && !bg(o.view.diag),
  `the sheet and its neighbours are all drawn (${rgb(o.view.sheet)}, right ${rgb(o.view.right)}, below ${rgb(o.view.below)}, diagonal ${rgb(o.view.diag)})`);
R.is(bg(o.viewPlain.right), `an ordinary sheet has no neighbours (${rgb(o.viewPlain.right)} is the view's own background)`);

console.log("\n=== export: the .blk pins the tile by its exact name ===");
const pin = 'replace_tex{\n  from:t="us_camo_olive*"\n  to:t="wtss_camo_tile.dds"\n}';
R.is(JSON.stringify(o.export.pins) === JSON.stringify(["us_camo_olive>wtss_camo_tile.dds>tile"]), `one pin, on the hull's camouflage only: ${o.export.pins.join(" · ")}`);
R.is(o.export.blkPlan.includes(pin) && o.export.blk.includes(pin), "both the planned and the written .blk carry the pin, verbatim");
R.is(!/set_tex\{[^}]*wtss_camo_tile/.test(o.export.blk) && !/ger_camo_inside_elfebein/.test(o.export.blk),
  "and neither a set_tex for the tile nor any line for the interior's camouflage");
R.is(o.export.rows === 1 && o.export.tileW === 256, "the tile is one row in Textures out, written at its own size");
R.is(!o.export.errors.length && o.export.blkrefs === "pass", `the validator passes — .blk and archive name each other (${o.export.errors.join("; ") || "no errors"})`);
R.is(JSON.stringify(o.export.alphas) === JSON.stringify(["170"]), `every texel ships the camouflage's alpha (${o.export.alphas.join(",")})`);
R.is(o.export.offPins === 0 && o.export.offItems === 0, "unticked, it ships no file and no pin naming one");
R.is(o.export.stockItems === 0 && o.export.stockPins === 0, "outside its mode it is neither shipped nor pinned");

console.log("\n=== the real export: what the archive holds ===");
const zipCheck = (z, ext) => {
  const file = "wtss_camo_tile." + ext;
  const pinOf = 'replace_tex{\n  from:t="us_camo_olive*"\n  to:t="' + file + '"\n}';
  R.is(z && !z.none && JSON.stringify(z.files) === JSON.stringify(["camotest/us_m1a2_sep3_abrams.blk", "camotest/" + file]),
    `${ext.toUpperCase()}: the zip holds the tile and the unit's .blk, and nothing else (${z && z.files ? z.files.join(", ") : "no zip — " + (z ? z.status : "")})`);
  R.is(z && z.blk && z.blk.includes(pinOf) && !/set_tex/.test(z.blk) && !/ger_camo_inside_elfebein/.test(z.blk),
    `${ext.toUpperCase()}: its .blk pins the hull's camouflage on ${file}, by that exact name, and writes nothing else for it`);
  R.is(z && z.tile && z.tile.w === 256 && z.tile.h === 256 && JSON.stringify(z.tile.alphas) === JSON.stringify(["170"]),
    `${ext.toUpperCase()}: the file is the 256² tile at the camouflage's alpha (${z && z.tile ? z.tile.alphas.join(",") : "—"})`);
  R.is(z && z.tile && red(z.tile.at250) && red(z.tile.at3) && !red(z.tile.mid),
    `${ext.toUpperCase()}: with the stroke over its right edge on both sides, read out of the file (${z && z.tile ? rgb(z.tile.at250) + ", " + rgb(z.tile.at3) : "—"})`);
  R.is(z && /^Zip ready/.test(z.status) && !/partial|none of these textures|no \.blk for/.test(z.status),
    `${ext.toUpperCase()}: the tile goes with the unit, whose own sheets it is none of — "${z ? z.status.slice(0, 90) : ""}"`);
};
zipCheck(o.zipDds, "dds");
zipCheck(o.zipTga, "tga");
R.is(o.pref === "stock", `the remembered setting is the vehicle's own camouflage, not the tile a new session will not have (${o.pref})`);

console.log("\n=== the real project file ===");
R.is(o.recovery.tile && !o.recovery.slots.includes("wtss_camo_tile"),
  "the parts a recovery copy is made of carry the tile beside the slots, not among them");
R.is(o.projectFile && o.projectFile.tile && o.projectFile.on === true && o.projectFile.size === 256 && !o.projectFile.slots.includes("wtss_camo_tile"),
  `saveProject writes it under meta.camoTile, not in meta.slots (${o.projectFile ? "slots: [" + o.projectFile.slots.join(", ") + "]" : "no file"}) — listed there, the restore waits for a slot the vehicle never makes`);
R.is(o.projectFile && o.projectFile.alpha === 170, `with the alpha it ships (${o.projectFile && o.projectFile.alpha}), which a restore cannot measure again`);
R.is(o.projectCleared.mode === "stock" && !o.projectCleared.slot, "a new session starts with no tile and the menu on the vehicle's own camouflage");
R.is(!o.project.pending && o.project.isSlot && o.project.size === 256 && o.project.sizeH === 256 &&
  o.project.layers === o.project.layersBefore && o.project.layers >= 2,
  `loadProject brings it back, not left waiting: ${o.project.size}×${o.project.sizeH}, ${o.project.layers} of ${o.project.layersBefore} layers`);
R.is(red(o.project.left) && blue(o.project.decal), `with its pixels (${rgb(o.project.left)}, ${rgb(o.project.decal)})`);
R.is(o.project.mode === "tile" && o.project.scale === 1.5 && o.project.rot === 30, `the menu on My own pattern and the preview's ${o.project.scale}× / ${o.project.rot}°`);
R.is(JSON.stringify(o.project.alphas) === JSON.stringify(["170"]) && /as the project recorded it/.test(o.project.note),
  `and it exports the alpha it did before the reload, 170 — not 255 (${o.project.alphas.join(",") || "no tile"}: "${o.project.note}")`);

console.log("\n=== the viewport ===");
R.is(o.bind.tileTex && o.bind.hull, "the hull's material samples the tile's own texture, the one the 2-D view paints into");
R.is(o.bind.crew, "the crew compartment's samples the game's own camouflage, which the tile does not replace");
R.is(o.bind.stock, "and with the menu on the vehicle's own camouflage, the hull's samples that again");

console.log("\n=== tc1 ===");
R.is(o.tc1.field === "C", "format 4 / stride 20 reads its first four bytes as the camouflage's UV");
R.is(o.tc1.cuvs && near(o.tc1.cuvs.flat(), [.25, .5, .75, .875, .5, .125]),
  `int16/4096 like tc0, v flipped like tc0 (${JSON.stringify(o.tc1.cuvs)})`);
R.is(near(o.tc1.uv0, [.5, .75]) && o.tc1.faces === 1, `tc0 still reads where it did (${JSON.stringify(o.tc1.uv0)})`);
R.is(o.obj.lines === 4 && o.obj.none === 1, `the embedded OBJ carries it as ${o.obj.lines} #vt1 lines, one marking a vertex with none`);
R.is(near(o.obj.hull, [.1, .2, .3, .4, .5, .6]) && near(o.obj.hull2, [.1, .2, .3, .4, .5, .6]),
  "the part comes back with it, from the OBJ and straight from the extracted model");
R.is(o.obj.hatch === null && o.obj.hatch2 === null, "a part with a corner that has none samples through its own UV instead");
R.is(!o.obj.plainObj, "and an ordinary OBJ has none");

console.log("\n=== the shader ===");
R.is(o.shader.tc1.attr && o.shader.tc1.pass && o.shader.tc1.viaTc1 && !o.shader.tc1.viaUv && /,c1$/.test(o.shader.tc1.key),
  `a part with tc1 samples the camouflage through it (program key ${o.shader.tc1.key})`);
R.is(!o.shader.none.attr && o.shader.none.viaUv && !o.shader.none.viaTc1 && o.shader.none.key !== o.shader.tc1.key,
  "one without keeps vUv, on a program of its own");

console.log("\n=== the preview's scale and rotation ===");
R.is(near(o.xScale, [.75, .5]), `200 % makes the pattern twice as big — the UV halves about the tile's centre (${o.xScale})`);
R.is(near(o.xRot, [.5, 1]), `90° turns it about the centre (${o.xRot})`);
R.is(near(o.xStock, [1, .5]), `outside tile mode the game's default applies — no transform (${o.xStock})`);
R.is(near(o.applied, [.75, .5, .25, .5, .5, .5]), `a slider move rewrites the mesh's camouflage UV from its stored tc1 (${o.applied})`);

console.log("\n=== the wear tool ===");
R.is(/no wear mask/.test(o.wear), `refused on a tile: "${o.wear}"`);

console.log("\n=== the Clone's source wraps too ===");
R.is(yellow(o.cloneSeam.first), `the first dab copies its source (${rgb(o.cloneSeam.first)})`);
R.is(yellow(o.cloneSeam.home6) && yellow(o.cloneSeam.home3),
  `a dab whose source lies past the left edge reads it from the right one (${rgb(o.cloneSeam.home6)}, ${rgb(o.cloneSeam.home3)})`);
R.is(o.cloneSeam.row.every(yellow), `a stroke dragged over the right edge copies all the way (${o.cloneSeam.row.map(rgb).join(" ")})`);
const close = (a, b, t) => a && b && [0, 1, 2].every(i => Math.abs(a[i] - b[i]) <= t);
R.is(close(o.heal.right, o.heal.left, 6) && !close(o.heal.right, o.heal.src, 20),
  `Heal shifts both halves of a dab split by the edge alike (${rgb(o.heal.right)} | ${rgb(o.heal.left)}, from ${rgb(o.heal.src)})`);

console.log("\n=== the tile stays square ===");
R.is(o.pattern.w === 256 && o.pattern.h === 256 && close(o.pattern.base, [30, 140, 60], 4),
  `a 512 × 256 pattern is stretched to the tile's 256², not adopted (${o.pattern.w}×${o.pattern.h}, ${rgb(o.pattern.base)})`);
R.is(/stretched to the tile's 256×256/.test(o.pattern.status), `and said so: "${o.pattern.status.slice(0, 110)}…"`);
R.is(!o.pattern.errors.length, `the export takes it (${o.pattern.errors.join("; ") || "no errors"})`);
R.is(o.resized.w === 512 && o.resized.h === 512, `⋮ ▸ resolution… makes a tile that is not square square again (${o.resized.w}×${o.resized.h})`);
R.is(JSON.stringify(o.resized.offered) === JSON.stringify(["128", "256", "512", "1024", "2048", "4096"]),
  `offering only a ground vehicle's sizes (${(o.resized.offered || []).join(", ")})`);

console.log("\n=== the calibration grid ===");
const grey = a => a && Math.abs(a[0] - 128) <= 4 && Math.abs(a[1] - 128) <= 4 && Math.abs(a[2] - 128) <= 4 && a[3] === 255;
R.is(o.cal.ground.every(grey), `a mid-grey ground (${o.cal.ground.map(rgb).join(" ")}), opaque`);
const E = o.cal.edges;
R.is([0, 1, 3, 4].every(i => red(E[i])) && [6, 7, 9, 10].every(i => red(E[i])) && !red(E[2]) && !red(E[5]) && !red(E[8]) && !red(E[11]),
  "a red frame two texels wide on every edge of the tile, and not a third");
R.is(o.cal.redN === 256 * 256 - 252 * 252, `and no red anywhere else (${o.cal.redN} red texels of 256²; the frame alone is ${256 * 256 - 252 * 252})`);
const cellH = o.cal.cell / 4;
R.is(o.cal.ink.every(b => b.n > 0 && b.inCell && b.h <= cellH && b.h >= .8 * cellH),
  `sixteen cells, each with its number inside it, a quarter of a cell high (${o.cal.ink.map(b => b.h).join(" ")} texels of ${cellH})`);
R.is(new Set(o.cal.shapes).size === 16, "no two numbers are the same picture, so 1–16 are sixteen different cells");
R.is(o.cal.ink.slice(0, 9).every(b => b.w <= 5 * b.h / 7 + .5) && o.cal.ink.slice(9).every(b => b.w > 5 * b.h / 7 + .5),
  "1–9 are one digit wide and 10–16 are two");
R.is(o.cal.ones[0] === o.cal.one && o.cal.ones[1] === o.cal.one, "11 is the 1 of cell 1 twice");
const A = o.cal.arrow;
R.is(A.w > 0 && A.outside === 0 && A.h >= .3 * o.cal.cell, `an arrow in cell 1 and nowhere else (${A.w}×${A.h} texels)`);
R.is(A.widestAt > .5 && A.bottom < A.widest / 2 && A.top < A.widest, `pointing toward +v, down the picture, the way a DDS's rows run: head at the bottom (widest ${A.widest} at ${Math.round(A.widestAt * 100)} % down, tip ${A.bottom}, tail ${A.top})`);
R.is(o.cal.same && o.cal.hash === 1400297300 && o.cal.hash1024 === 303050066, `deterministic: the same bytes every time (256²: ${o.cal.hash}, 1024²: ${o.cal.hash1024})`);

console.log("\n=== the repeat length ===");
const M = o.measure.plate;
R.is(M && Math.abs(M.repeat - 12.5) < .1 && Math.abs(M.length - 10) < 1e-6 && Math.abs(M.fit - .8) < .01,
  `a 10 m plate at 0.08 UV a metre: one repeat ${M && M.repeat.toFixed(2)} m, ${M && M.fit.toFixed(2)} of it along the plate — and a small part at 1 UV a metre does not move the median`);
R.is(o.measure.none === null, "no triangles, no answer");
R.is(o.measure.hull && Math.abs(o.measure.hull.repeat - 12.5) < .1 && o.measure.hull.length === 10,
  "the model's own camouflaged parts, minus an effect card, a bone-driven net, a part whose material wears no camouflage and a part with no tc1, so none of them stretches the hull");
R.is(o.measure.row !== "none" && /12\.5 m/.test(o.measure.text) && /10\.0 m/.test(o.measure.text) && /0\.8 repeats/.test(o.measure.text),
  `the tile panel says it: "${o.measure.text}"`);
R.is(/no camouflaged part with a camouflage UV/.test(o.measure.empty), `and says so when the model has none: "${o.measure.empty}"`);
const B = o.measure.button;
R.is(!red(B.before) && red(B.edge) && red(B.edgeR) && grey(B.ground) && /[Cc]alibration grid/.test(B.status),
  `the button puts the grid in as the tile's base (${rgb(B.before)} → ${rgb(B.edge)} at the left edge, ${rgb(B.ground)} inside; "${B.status.slice(0, 60)}")`);
R.is(!red(B.undone), "and one undo takes it back");
const T = o.measure.toggle;
R.is(T.outLabel === "Calibration grid" && T.redoLabel === "Remove grid",
  `the button names what it will do: "${T.outLabel}" with the grid out, "${T.redoLabel}" once a redo brought it back with no click (ROADMAP 3.45)`);
R.is(T.rowIn.length === 1 && /^info: /.test(T.rowIn[0]) && !T.rowOut.length,
  `while the grid is in, the pre-export check carries an info row ("${T.rowIn[0] || "none"}"), and it goes with the grid`);
R.is(T.removed === T.before && T.removedLabel === "Calibration grid" && /back as it was/.test(T.removedStatus),
  `Remove grid puts back exactly the base it covered, after another edit in between (${T.before} → ${T.removed}): "${T.removedStatus.slice(0, 70)}"`);
R.is(T.undoneRemove === "Remove grid", "and that is one undo step of its own");
R.is(T.resized.label === "Remove grid" && T.resized.after === "Calibration grid" &&
  T.resized.mid.every((v, i) => Math.abs(v - T.resized.was[i]) <= 2) && !red(T.resized.edge),
  `a tile resized with the grid in is still seen as wearing it ("${T.resized.label}" at ${T.resized.w}²), and Remove grid puts the kept base back at the new size (${rgb(T.resized.was)} → ${rgb(T.resized.mid)} in the middle, no frame left)`);
R.is(T.lost.hash === T.lost.start && T.lost.label === "Calibration grid" && /not kept across the reload/.test(T.lost.status),
  `with the kept base gone (a reload), it puts back the tile's start and says so: "${T.lost.status.slice(0, 90)}…"`);

console.log("\n=== nothing to pin is never quiet ===");
R.is(JSON.stringify(o.stemsNone) === JSON.stringify(["us_camo_olive", "ger_camo_inside_elfebein"]),
  `a unit whose skins name none of this model's stems pins every stem (${o.stemsNone.join(", ")}) — none would ship a tile no line reads`);
R.is(o.gone.pins === 0 && /no tile any more/.test(o.gone.warn), `a deleted tile is said: "${o.gone.warn.slice(0, 90)}…"`);
R.is(o.remade.slot && o.remade.active && o.remade.pins === 1 && !/no tile any more/.test(o.remade.warn),
  "Edit tile makes a new one and opens it, and the warning goes");
R.is(/unticked in Textures out/.test(o.unticked), `so is an unticked one: "${o.unticked.slice(0, 70)}…"`);

console.log("\n=== undo ===");
const magenta = a => a && a[0] > 200 && a[1] < 60 && a[2] > 200;
R.is(o.undo.B === 1024 && magenta(o.undo.before[0]) && magenta(o.undo.before[1]) && olive(o.undo.after[0]) && olive(o.undo.after[1]),
  `one undo takes both halves of a wrapped stroke back on a ${o.undo.B}² tile — four undo tiles apart (${rgb(o.undo.before[1])} → ${rgb(o.undo.after[1])} at the left edge, ${rgb(o.undo.after[0])} at the right)`);

console.log("\n=== the tile goes with its vehicle ===");
R.is(o.cleared.mode === "stock" && !o.cleared.slot && o.cleared.scale === 1 && o.cleared.rot === 0,
  `clearing the vehicle drops the tile, puts the menu back on the vehicle's own camouflage (${o.cleared.mode}) and the preview on 100 % / 0°`);

R.finish();
