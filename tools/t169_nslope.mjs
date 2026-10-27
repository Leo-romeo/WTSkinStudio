// The `_n` slope channels as the game reads them (ROADMAP 1.24 (b)), against the real page.
//
// WHY THIS EXISTS. The app read and wrote a packed `_n` as G = normal X, A = normal Y from its first
// day. Measured on 2026-10-24 over the 50 usable `_n` sheets in the install's UserSkins, the X slope
// was in A on 48 and high G leaned toward the bottom row on 49 — and the owner's look in the game the
// same day at `dist/plan/1.24/n_slope_test/` settled it: "num 2 seem to look good on the whole plane",
// plate 2 being A = normal X, G = normal Y toward the bottom row, mirrored strip included. Stock
// content round-tripped unchanged through the old mapping, because import and export swapped it
// alike, so nothing that only re-exports a vehicle could see the fault: what the app GENERATES into
// the slopes — decal relief, painting on the normal channel — went to the game across the diagonal,
// and the 3-D view lit the editor's own Y the other way up. So the checks here are the ones that see
// it: a bump drawn by the app's own relief and exported has its left/right slope in A and its
// up/down one in G, in the sense the measurement found (a symmetric raised plate's left rim and top
// rim lean the same way from 128 only in that sense); the editor's normal sheet is X in red and Y in
// green whatever the file; the 3-D view, lit from below, brightens a texel leaning toward the
// bottom row; and an old project's stored surface sheet — written in the old order — comes back in
// the new one.
//
// Usage: node tools/t169_nslope.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {}, N = 64;
  var flat = function(r, g, b, a){
    var c = mkCanvas(N, N), x = ctx2d(c), d = x.createImageData(N, N);
    for (var q = 0; q < N * N; q++) { d.data[q*4] = r; d.data[q*4+1] = g; d.data[q*4+2] = b; d.data[q*4+3] = a === undefined ? 255 : a; }
    x.putImageData(d, 0, 0); return c;
  };
  var pix = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var mkSlot = function(id){
    return { id: id, cStem: id + "_c", nStem: id + "_n", cFileName: id + "_c.dds", nFileName: id + "_n.dds",
      layers: [], composite: flat(200, 200, 200), baseC: flat(200, 200, 200), covBase: new Uint8Array(N * N).fill(255),
      size: N, sizeH: N, nSize: N, missing: false, exp: {}, cEdited: false, nEdited: true };
  };
  // Before the fix there is no NSheet; the old entry point lets this file show what it measures there.
  var init = typeof NSheet !== "undefined" ? function(s, d){ NSheet.init(s, d); } : function(s, d){ initSlotSurface(s, d); };
  // A packed _n whose four channels are unrelated everywhere, so a swap is a wrong value, not a plausible one.
  var px = new Uint8ClampedArray(N * N * 4);
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    var i = y * N + x;
    px[i*4] = (x * 5 + 11) & 255; px[i*4+1] = (x * 7 + y * 13) & 255; px[i*4+2] = (y * 3 + 200) & 255; px[i*4+3] = (x * 29 + y * 3 + 50) & 255;
  }
  var dn = { width: N, height: N, fileName: "t169_n.dds", mips: [{ w: N, h: N, rgba: px }] };
  var invBox = document.getElementById("optInvRough"), invWas = invBox.checked;
  invBox.checked = true;                                       // the game's own form: R passes through

  // ---- 1. import: the editor's normal sheet is X in red, Y in green ----
  var s = mkSlot("t169");
  App.slots = new Map([[s.id, s]]);
  init(s, dn);
  var nr = pix(s.normal), badX = 0, badY = 0, badB = 0;
  for (var i = 0; i < N * N; i++) { if (nr[i*4] !== px[i*4+3]) badX++; if (nr[i*4+1] !== px[i*4+1]) badY++; if (nr[i*4+2] !== 128) badB++; }
  out.imp = { badX: badX, badY: badY, badB: badB };
  // the raw channel views read the bytes the file holds, and say what they mean
  var ra = rawChanBytes(s, "n:a"), rg = rawChanBytes(s, "n:g"), rbad = 0;
  for (var i = 0; i < N * N; i++) { if (ra.data[i] !== px[i*4+3]) rbad++; if (rg.data[i] !== px[i*4+1]) rbad++; }
  out.raw = { bad: rbad, a: RAW_CHANS["n:a"].meaning, g: RAW_CHANS["n:g"].meaning };
  // ...and the file comes back out byte for byte: stock content is untouched by any of this
  var pickN = function(){ return collectExports(false).filter(function(it){ return it.kind === "n"; })[0]; };
  var e0 = pickN(), rt = 0;
  for (var i = 0; i < N * N * 4; i++) if (e0.rgba[i] !== px[i]) rt++;
  out.roundTrip = rt;

  // ---- 2. replace the surface from a file: the same mapping ----
  var s2 = mkSlot("t169r"); init(s2, { width: N, height: N, fileName: "flat_n.dds", mips: [{ w: N, h: N, rgba: new Uint8ClampedArray(N * N * 4).fill(128) }] });
  App.slots.set(s2.id, s2);
  try {
    ReplaceTex.bakeSurface(s2, dn, "t169_src.dds");
    var b2 = pix(s2.normal), bb = 0;
    for (var i = 0; i < N * N; i++) { if (b2[i*4] !== px[i*4+3]) bb++; if (b2[i*4+1] !== px[i*4+1]) bb++; }
    out.bake = bb;
  } catch (e) { out.bake = "threw: " + e.message; }
  App.slots.delete(s2.id);

  // ---- 3. a loose _n pasted onto the normal channel is its slopes, not its packed bytes ----
  try {
    var lc = PasteTex.canvasOf({ dec: dn, ch: "normal", loose: true, stem: "loose_n" }), ld = pix(lc), lb = 0;
    for (var i = 0; i < N * N; i++) { if (ld[i*4] !== px[i*4+3]) lb++; if (ld[i*4+1] !== px[i*4+1]) lb++; if (ld[i*4+2] !== 128) lb++; }
    out.loose = lb;
  } catch (e) { out.loose = "threw: " + e.message; }

  // ---- 4. a bump the app draws itself, exported: X slope in A, Y slope in G, Y toward the bottom ----
  var foot = mkCanvas(N, N), fg = ctx2d(foot); fg.fillStyle = "#fff"; fg.fillRect(16, 16, 32, 32);
  var under = flat(128, 128, 128), em = mkCanvas(N, N);
  out.drew = renderSurfLayer(em, under, { x: 0, y: 0, w: N, h: N, canvas: foot }, "em", 8, { mode: "edge", bevel: 4 });
  var g = ctx2d(s.normal); g.clearRect(0, 0, N, N); g.drawImage(under, 0, 0); g.drawImage(em, 0, 0);
  var inn = pix(s.normal), e1 = pickN().rgba;
  var at = function(a, x, y, c){ return a[(y * N + x) * 4 + c]; };
  var dev = function(a, c, fixed, alongX){ var m = 0, sAt = 0; for (var k = 0; k < N; k++) { var v = alongX ? at(a, k, fixed, c) : at(a, fixed, k, c); if (Math.abs(v - 128) > Math.abs(m)) { m = v - 128; } } return m; };
  // the middle row crosses the two vertical rims, the middle column the two horizontal ones
  out.bump = {
    rowA: dev(e1, 3, 32, true), rowG: dev(e1, 1, 32, true), colA: dev(e1, 3, 32, false), colG: dev(e1, 1, 32, false),
    // the first rim met from the left on the middle row, and from the top on the middle column
    leftA: (function(){ for (var x = 0; x < N; x++) { var v = at(e1, x, 32, 3); if (v !== 128) return v - 128; } return 0; })(),
    topG:  (function(){ for (var y = 0; y < N; y++) { var v = at(e1, 32, y, 1); if (v !== 128) return v - 128; } return 0; })(),
    leftR: (function(){ for (var x = 0; x < N; x++) { var v = at(inn, x, 32, 0); if (v !== 128) return v - 128; } return 0; })(),
  };
  var same = 0;
  for (var i = 0; i < N * N; i++) if (e1[i*4+3] === inn[i*4] && e1[i*4+1] === inn[i*4+1]) same++;
  out.bump.packed = same === N * N;

  // ---- 5. the 3-D view: lit from below, a texel leaning toward the bottom row is the brighter ----
  var sp = mkSlot("t169p");
  init(sp, { width: N, height: N, fileName: "p_n.dds", mips: [{ w: N, h: N, rgba: new Uint8ClampedArray(N * N * 4).fill(128) }] });
  // albedo: top half red, bottom half blue, so the shot can say which way up the sheet is
  var ab = ctx2d(sp.composite); ab.fillStyle = "#ff0000"; ab.fillRect(0, 0, N, N / 2); ab.fillStyle = "#0000ff"; ab.fillRect(0, N / 2, N, N / 2);
  ctx2d(sp.metal).fillStyle = "#000"; ctx2d(sp.metal).fillRect(0, 0, N, N);
  App.slots.set(sp.id, sp);
  App.matSlot = new Map([["m169", sp.id]]);
  sp.tex = new THREE.CanvasTexture(sp.composite);
  refreshSurfaceTextures(sp);
  var viewWas = App.chanView, onWas = App.chanOn, lvWas = LevelView.on;
  App.chanView = "shaded"; App.chanOn = { color: true, smooth: true, metal: true, normal: true };
  if (LevelView.on) LevelView.set({ on: false });
  var geo = new THREE.PlaneGeometry(2, 2), mesh = new THREE.Mesh(geo, makeMaterial("m169", "p169", geo)), sc = new THREE.Scene();
  var light = new THREE.DirectionalLight(0xffffff, 1.5); sc.add(mesh); sc.add(light);
  var H = 64, tgt = new THREE.WebGLRenderTarget(H, H), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  var setNormal = function(r, gg){ var c = ctx2d(sp.normal); c.fillStyle = "rgb(" + r + "," + gg + ",128)"; c.fillRect(0, 0, N, N); refreshSurfaceTextures(sp); if (sp.texCh && sp.texCh.normal) sp.texCh.normal.needsUpdate = true; };
  var shoot = function(lx, ly){
    mesh.material.dispose(); mesh.material = makeMaterial("m169", "p169", geo);
    light.position.set(lx, ly, 1); light.updateMatrixWorld();
    var prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(tgt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sc, cam);
    var p = new Uint8Array(H * H * 4); renderer.readRenderTargetPixels(tgt, 0, 0, H, H, p);
    renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca);
    // GL rows run bottom-up: row H-8 is near the top of the plane, row 8 near its bottom
    var px2 = function(xx, yy){ var o = (yy * H + xx) * 4; return [p[o], p[o+1], p[o+2]]; };
    var lum = function(c){ return c[0] + c[1] + c[2]; };
    return { top: px2(32, H - 8), bottom: px2(32, 8), lum: lum(px2(16, H - 8)) + lum(px2(48, H - 8)) + lum(px2(16, 8)) + lum(px2(48, 8)) };
  };
  setNormal(128, 200);                                         // leaning toward the bottom row
  out.view = { up: shoot(0, 0), yBelow: shoot(0, -1), yAbove: shoot(0, 1) };
  setNormal(200, 128);                                         // leaning toward the right
  out.view.xRight = shoot(1, 0); out.view.xLeft = shoot(-1, 0);
  out.view.sky = shoot(0, 0);
  App.chanView = viewWas; App.chanOn = onWas; if (lvWas) LevelView.set({ on: true });
  App.slots.delete(sp.id);

  // ---- 6. a project: an old file's stored surface sheet is in the old order and is turned ----
  var png = function(c){ return new Promise(function(r){ c.toBlob(r, "image/png"); }); };
  var proj = async function(version){
    var sm = mkSlot("t169m"); init(sm, dn);
    App.slots = new Map([[sm.id, sm]]);
    var zip = new JSZip();
    zip.file("s.png", await png(flat(90, 90, 90))); zip.file("m.png", await png(flat(10, 10, 10))); zip.file("n.png", await png(flat(30, 180, 128)));
    App.pendingProject = { meta: { version: version, slots: [{ id: sm.id, nEdited: true, smoothFile: "s.png", metalFile: "m.png", normalFile: "n.png", layers: [], size: N, sizeH: N }] }, zip: zip };
    try { await tryApplyProject(); } catch (e) { return "threw: " + e.message; }
    var d = pix(sm.normal); return [d[0], d[1], d[2]];
  };
  out.proj = { v5: await proj(5), v7: await proj(7) };
  // the weapon merge reads the same file a second way (game/weapon-skin.js) and turns it the same
  var merge = async function(version){
    var sm = mkSlot("t169m"); init(sm, dn);
    App.slots = new Map([[sm.id, sm]]);
    var zip = new JSZip();
    zip.file("project.json", JSON.stringify({ version: version, slots: [{ id: sm.id, nEdited: true, smoothFile: "s.png", metalFile: "m.png", normalFile: "n.png", layers: [] }] }));
    zip.file("s.png", await png(flat(90, 90, 90))); zip.file("m.png", await png(flat(10, 10, 10))); zip.file("n.png", await png(flat(30, 180, 128)));
    try { await mergeProjectLayers(await zip.generateAsync({ type: "blob" })); } catch (e) { return "threw: " + e.message; }
    var d = pix(sm.normal); return [d[0], d[1], d[2]];
  };
  out.proj.merge5 = await merge(5); out.proj.merge8 = await merge(8);
  if (ProjectFile.tooNew({ version: 8 }) === null) out.proj.v8 = await proj(8);
  // ...and this build marks what it writes, so the turn happens once
  try {
    var sw = mkSlot("t169w"); init(sw, dn); App.slots = new Map([[sw.id, sw]]);
    var parts = await ProjectFile.parts(); out.proj.writes = parts.meta.version;
    sw.nEdited = false; sw.layers = []; sw.cEdited = true;
    parts = await ProjectFile.parts(); out.proj.writesPlain = parts.meta.version;
  } catch (e) { out.proj.writes = "threw: " + e.message; }
  out.proj.gate = ProjectFile.tooNew({ version: 9 });

  invBox.checked = invWas;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = JSON.stringify;

console.log("\n=== import: the editor's normal sheet is X in red, Y in green ===");
R.is(r.imp.badX === 0 && r.imp.badY === 0 && r.imp.badB === 0,
  `a packed _n's A lands in the normal sheet's red (X) and its G in green (Y), blue 128 (${J(r.imp)} texels wrong)`);
R.is(r.raw.bad === 0 && /normal x/i.test(r.raw.a) && /normal y/i.test(r.raw.g),
  `the raw channel views read the file's own bytes and name A normal X, G normal Y (${J(r.raw)})`);
R.is(r.roundTrip === 0, `a stock _n exports byte for byte as it came in (${r.roundTrip} bytes differ)`);
R.is(r.bake === 0, `replacing the surface from a file splits it the same way (${J(r.bake)})`);
R.is(r.loose === 0, `a loose _n pasted onto the normal channel is its slopes, X from A and Y from G, not its packed bytes (${J(r.loose)})`);

console.log("\n=== a bump the app draws, exported ===");
const B = r.bump;
console.log(`   middle row: A ${B.rowA} G ${B.rowG} · middle column: A ${B.colA} G ${B.colG} · left rim A ${B.leftA}, top rim G ${B.topG}, editor red ${B.leftR}`);
R.is(r.drew === true, "the relief drew the bump");
R.is(Math.abs(B.rowA) > 10 && B.rowG === 0, `across the vertical rims only A moves (A ${B.rowA}, G ${B.rowG}): the left/right slope is in A`);
R.is(Math.abs(B.colG) > 10 && B.colA === 0, `across the horizontal rims only G moves (G ${B.colG}, A ${B.colA}): the up/down slope is in G`);
R.is(B.leftA !== 0 && Math.sign(B.leftA) === Math.sign(B.topG),
  `a raised plate's left rim and top rim lean the same way from 128 (A ${B.leftA}, G ${B.topG}) — high G leans toward the bottom row, as the 50 sheets and the game have it`);
R.is(B.packed === true, "the exported A is the editor's red and G its green, texel for texel");

console.log("\n=== the 3-D view ===");
const V = r.view;
console.log(`   lit face-on: top ${J(V.up.top)} bottom ${J(V.up.bottom)} · leaning down: below ${V.yBelow.lum} above ${V.yAbove.lum} · leaning right: right ${V.xRight.lum} left ${V.xLeft.lum}`);
R.is(V.up.top[0] > V.up.top[2] && V.up.bottom[2] > V.up.bottom[0], "the sheet's top row is at the top of the plane (the shot is the right way up)");
R.is(V.xRight.lum > V.xLeft.lum + 8, `a texel leaning right is brighter lit from the right (${V.xRight.lum} against ${V.xLeft.lum})`);
R.is(V.yBelow.lum > V.yAbove.lum + 8, `a texel leaning toward the bottom row is brighter lit from below (${V.yBelow.lum} against ${V.yAbove.lum}) — the game's Y, not three.js's`);

console.log("\n=== a project ===");
const P = r.proj;
console.log(`   ${J(P)}`);
R.is(J(P.v5) === J([180, 30, 128]) && J(P.v7) === J([180, 30, 128]),
  `a stored surface sheet from a file before version 8 is turned to the new order (v5 ${J(P.v5)}, v7 ${J(P.v7)}; stored 30/180)`);
R.is(J(P.v8) === J([30, 180, 128]), `a version 8 file's sheet is read as stored (${J(P.v8)})`);
R.is(J(P.merge5) === J([180, 30, 128]) && J(P.merge8) === J([30, 180, 128]),
  `a weapon project merged in is turned the same way: before 8 ${J(P.merge5)}, at 8 ${J(P.merge8)}`);
R.is(P.writes === 8 && P.writesPlain === 5, `a file holding a surface sheet says 8, one without says 5 (${P.writes}, ${P.writesPlain})`);
R.is(/project version 9, this build reads 8/.test(P.gate || ""), `the gate reads 8 and refuses 9 (${P.gate})`);

const errs = (r.__errs || []).concat(r.__rejs || []);
R.is(!errs.length, "no uncaught error on the page" + (errs.length ? ": " + errs.join(" | ") : ""));
R.finish();
