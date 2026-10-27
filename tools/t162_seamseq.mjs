// The seam sequence of ROADMAP 1.17 (2), step by step: does any step remove paint already on a layer?
//
// WHY THIS EXISTS. The owner's Ho 229 skin came back with a holo stroke stopping dead at the wing_l /
// fuse seam, and he was not sure whether the fuselage half had been painted and then lost, or never
// painted. A 3-D stroke never painting past a seam it did not cross is the UV-space brush's per-part
// stencil working as designed (4.51, answered by the projected brush, item 12). The other reading — paint
// that was there and was ERASED in the shape of a part — is a bug, and the entry named the sequence that
// would find it: paint across the seam at 2048 → resize to 8192 → one stroke on the wing only → resize
// back to 2048 → switch the export preset to lossless → save and reload. This runs that sequence through
// the real viewport and the real resize, save and load, and after every step compares the fuselage side
// of the layer, and its mask, to what step 1 left there.
//
// The scene is two plates meeting at x = 0, `fuse` to the left and `wing` to the right, whose islands
// also meet in UV at u = 0.453 — as wing_l and fuse do on the Ho 229 (u ≈ 0.127 there). The seam sits
// 127 texels into a 256-texel undo tile at 8192, so the step-3 stroke, kept on the wing, touches the
// tile that holds fuselage paint: that is where the entry's lead (a pre-stroke tile copy that is wrong at
// 8192, put back by refreshStrokeView) would erase, and the test checks the stroke really reached it.
// The layer carries a mask with graded alpha over the fuselage, as the owner's did.
//
// The sequence is run twice, with the UV-space brush and with the projected one (item 12), each from a
// fresh scene. A second run of the UV-space brush breaks TileUndo.restoreTile — it clears a tile and no
// longer puts the pre-stroke copy back — and must be caught at step 3: that is what shows the check can
// see an erase of exactly the shape the lead describes. A third breaks rescaleSlotLayers' way down and
// must be caught at step 4.
//
// The sheet is 2048 × 256 → 8192 × 1024 by default — the width is what crosses every 8192 threshold
// (the stroke stencil at mask resolution, a quarter of the sheet; the projector's two windows) — and
// --square runs the owner's 2048² → 8192² instead (about 2 GB of canvases; by hand, not in the suite).
//
// Usage: node tools/t162_seamseq.mjs [--square] [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const SQUARE = argv.includes("--square");
const W0 = 2048, H0 = SQUARE ? 2048 : 256;

const BODY = `async function(){
  var W0 = ${W0}, H0 = ${H0}, K = 4, SEAM = .453;
  var el = document.getElementById("view3d");
  var PH = H0 / 1024;                                   // the plates' height in metres: square-ish texels
  var mesh = function(name, tris){
    var n = tris.length * 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), k = 0;
    tris.forEach(function(t){ t.forEach(function(v){ pos.set(v[0], k * 3); nrm.set(v[1], k * 3); uv.set(v[2], k * 2); k++; }); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = name; m.userData = { mat: "m161" };
    return { gd: { name: name, mat: "m161", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  var quad = function(x0, y0, x1, y1, u0, v0, u1, v1){
    var P = function(x, y, u, v){ return [[x, y, 0], [0, 0, 1], [u, v]]; };
    var a = P(x0, y0, u0, v0), b = P(x1, y0, u1, v0), c = P(x1, y1, u1, v1), d = P(x0, y1, u0, v1);
    return [[a, b, d], [b, c, d]];
  };
  var flat = function(w, h, hex){ var c = mkCanvas(w, h), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, w, h); return c; };
  var group = null, s = null, L = null;
  var setup = function(proj){
    if (group) scene.remove(group);
    var parts = [mesh("fuse", quad(-1, -PH / 2, 0, PH / 2, 0, 0, SEAM, 1)), mesh("wing", quad(0, -PH / 2, 1, PH / 2, SEAM, 0, 1, 1))];
    group = new THREE.Group(); parts.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
    s = { id: "t161", cStem: "t161", layers: [], size: W0, sizeH: H0, missing: false, cEdited: true, nSize: W0,
          baseC: flat(W0, H0, "#808080"), composite: flat(W0, H0, "#808080"),
          smooth: flat(W0, H0, "#505050"), metal: flat(W0, H0, "#303030"), normal: flat(W0, H0, "#8080ff") };
    App.slots = new Map([["t161", s]]); App.activeSlot = s;
    App.geomData = parts.map(function(q){ return q.gd; });
    App.meshes = new Map(parts.map(function(q){ return [q.mesh.name, q.mesh]; }));
    App.matSlot = new Map([["m161", "t161"]]);
    App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 2, y: PH, z: .1 };
    modelGroup = group;
    document.getElementById("symOn").checked = false;
    document.getElementById("optFlipV").checked = false;
    document.getElementById("expPreset").value = "game"; document.getElementById("expPreset").onchange();
    setPlacing(false);
    if (!App.paint3d) setPaint3d(true);
    cam.fly = false; cam.glide = null; cam.target.set(0, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 2.4;
    resize3D(); syncCamera();
    setBrushMode("color");
    var b = App.brush;
    b.color = "#c86432"; b.opacity = 1; b.flow = 1; b.build = false; b.size = 32; b.hardness = .8; b.spacing = .15;
    b.tip = "round"; b.sizeJit = b.flowJit = b.scatter = b.angle = b.angleJit = 0; b.follow = false; b.lazy = 0;
    b.proj3d = proj;
    brushStamp._key = null;
    // the owner's layer had a mask (his hexagons): here a graded one over the fuselage — rows of alpha 0,
    // 96 and 255 in bands, so a mask resampled wrong, or lost, shows
    var mk = flat(W0, H0, "#ffffff"), mg = ctx2d(mk);
    for (var y = 0; y < H0; y += 24) { mg.clearRect(0, y, Math.floor(W0 * SEAM), 8); mg.fillStyle = "rgba(255,255,255,.376)"; mg.fillRect(0, y + 8, Math.floor(W0 * SEAM), 8); }
    L = LayerNode.of({ type: "paint", name: "holo", canvas: mkCanvas(W0, H0), mask: mk, visible: true, opacity: .51, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.undoStack.length = 0; App.redoStack.length = 0;
  };
  var pe = function(type, x, y){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse", pressure: 0 }); };
  var strokeW = function(pts){
    var sc = pts.map(function(w){ return worldToScreen(w); });
    el.dispatchEvent(pe("pointermove", sc[0].x, sc[0].y));
    el.dispatchEvent(pe("pointerdown", sc[0].x, sc[0].y));
    var proj = !!(stroke && stroke.pj);
    for (var i = 1; i < sc.length; i++) el.dispatchEvent(pe("pointermove", sc[i].x, sc[i].y));
    el.dispatchEvent(pe("pointerup", sc[sc.length - 1].x, sc[sc.length - 1].y));
    return proj;
  };
  var line = function(x0, x1, y, n){ var o = []; for (var i = 0; i <= n; i++) o.push(new THREE.Vector3(x0 + (x1 - x0) * i / n, y, 0)); return o; };
  var read = function(c){ return { w: c.width, h: c.height, d: ctx2d(c).getImageData(0, 0, c.width, c.height).data }; };
  var FX = Math.floor(W0 * SEAM) - 2;                   // fuselage columns at 2048, two texels clear of the seam
  // The fuselage side of an image, read at the reference size: a texel of a bigger image is the mean
  // alpha of the block over it. Compared with step 1's: texels painted (≥ 128) that now are not (< 64),
  // and the sum of alpha.
  var region = function(c, x0, x1, ch){
    ch = ch == null ? 3 : ch;
    var r = read(c), kx = r.w / W0, ky = r.h / H0, a = new Float32Array((x1 - x0) * H0);
    for (var y = 0; y < H0; y++) for (var x = x0; x < x1; x++) {
      var t = 0, n = 0;
      for (var j = 0; j < ky; j++) for (var i = 0; i < kx; i++) { t += r.d[(((y * ky + j) * r.w) + x * kx + i) * 4 + ch]; n++; }
      a[y * (x1 - x0) + x - x0] = t / n;
    }
    return a;
  };
  var fuse = function(c){ return region(c, 0, FX); };
  var WX = Math.ceil(W0 * SEAM) + 2;                    // wing columns, two texels clear of the seam
  // texels the step-3 stroke turned blue: its colour is #3264c8 against step 1's #c86432
  var gained = function(a, b){ var n = 0; for (var i = 0; i < a.length; i++) if (a[i] < 100 && b[i] >= 150) n++; return n; };
  var compare = function(ref, now){
    var lost = 0, painted = 0, sr = 0, sn = 0, worst = 0;
    for (var i = 0; i < ref.length; i++) {
      sr += ref[i]; sn += now[i];
      if (ref[i] >= 128) { painted++; if (now[i] < 64) lost++; }
      worst = Math.max(worst, Math.abs(ref[i] - now[i]));
    }
    return { painted: painted, lost: lost, sum: sr ? +(sn / sr).toFixed(4) : 0, worst: Math.round(worst) };
  };
  var seq = async function(proj, inject){
    setup(proj);
    var out = { steps: [] };
    // 1. paint across the seam at 2048
    out.proj1 = strokeW(line(-.45, .45, .01, 60));
    var refP = fuse(L.canvas), refM = fuse(L.mask);
    out.painted = compare(refP, refP).painted;
    out.wingPainted = (function(){ var r = read(L.canvas), n = 0; for (var y = 0; y < H0; y++) for (var x = Math.ceil(W0 * SEAM) + 2; x < W0; x++) if (r.d[(y * W0 + x) * 4 + 3] >= 128) n++; return n; })();
    var step = function(name){ out.steps.push({ name: name, w: L.canvas.width, h: L.canvas.height, paint: compare(refP, fuse(L.canvas)), mask: compare(refM, fuse(L.mask)) }); };
    // 2. resize to 8192
    out.resized = resizeSlot(s, W0 * K, H0 * K);
    step("resize to " + W0 * K + "×" + H0 * K);
    // 3. one stroke on the wing only, near enough the seam to touch the undo tile that holds fuselage paint
    var wingBefore = region(L.canvas, WX, W0, 2), fuseBefore = region(L.canvas, 0, FX, 2);
    var realRestore = TileUndo.restoreTile, realCommit = TileUndo.commit, touched = null;
    if (inject === "restore") TileUndo.restoreTile = function(k){ var t = this.tileRect(k); this.g.clearRect(t.x, t.y, t.w, t.h); return t; };
    TileUndo.commit = function(){ touched = [...this.touched]; return realCommit.call(this); };
    App.brush.size = 64; App.brush.color = "#3264c8";
    try { out.proj3 = strokeW(line(.026, .4, .014, 60)); }
    finally { TileUndo.restoreTile = realRestore; TileUndo.commit = realCommit; }
    out.wingGained = gained(wingBefore, region(L.canvas, WX, W0, 2));
    out.fuseGained = gained(fuseBefore, region(L.canvas, 0, FX, 2));
    var seamTile = Math.floor(W0 * K * SEAM / TILE);
    out.seamTile = seamTile;
    // the fuselage texels (step 1's, at the reference size) inside the tiles the stroke touched
    var tk = TILE / K;
    out.fuseInTouched = (touched || []).reduce(function(n, k){
      var tx = +k.split(",")[0], ty = +k.split(",")[1];
      for (var y = ty * tk; y < Math.min(H0, ty * tk + tk); y++) for (var x = tx * tk; x < Math.min(FX, tx * tk + tk); x++) if (refP[y * FX + x] >= 128) n++;
      return n; }, 0);
    out.touchedSeam = !!touched && touched.some(function(k){ return +k.split(",")[0] === seamTile; });
    out.touched = touched ? touched.length : 0;
    step("one stroke on the wing at " + W0 * K);
    // 4. resize back to 2048
    var realRescale = rescaleSlotLayers;
    if (inject === "rescale") rescaleSlotLayers = function(sl, w, h){ layerNodes(sl.layers).forEach(function(n){ if (n.type === "paint") n.canvas = mkCanvas(w, h); }); };
    try { resizeSlot(s, W0, H0); } finally { rescaleSlotLayers = realRescale; }
    step("resize back to " + W0 + "×" + H0);
    // 5. the export preset to lossless
    document.getElementById("expPreset").value = "lossless"; document.getElementById("expPreset").onchange();
    step("export preset: lossless");
    // 6. save and reload
    var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
    HTMLAnchorElement.prototype.click = function(){};
    try { out.saved = !!(await saveProject()); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
    s.layers = []; L = null;                              // wiped, so a pass means it was read back
    await loadProject(blob);
    L = layerLeaves(s.layers)[0] || null;
    out.reloaded = !!(L && L.canvas && L.mask);
    if (out.reloaded) step("save and reload");
    return out;
  };
  var res = { uv: await seq(false), proj: await seq(true) };
  res.injRestore = await seq(false, "restore");
  res.injRescale = await seq(false, "rescale");
  res.mode = projGL() ? "gl" : "canvas";
  return res;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: SQUARE ? 600000 : 180000, keep: argv.includes("--keep") });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
const fmt = c => `${c.lost} of ${c.painted} painted texels lost, alpha sum ×${c.sum}, worst ${c.worst}`;
for (const [key, label] of [["uv", "the UV-space brush"], ["proj", "the projected brush"]]) {
  const x = o[key];
  R.is(x.proj1 === (key === "proj") && x.proj3 === (key === "proj"), `${label}: both strokes ran on it (${x.proj1}, ${x.proj3})`);
  R.is(x.painted > 2000 && x.wingPainted > 2000, `${label}, step 1: a stroke across the seam at ${W0}×${H0} paints the fuselage (${x.painted} texels) and the wing (${x.wingPainted})`);
  R.is(x.resized && x.touchedSeam && x.fuseInTouched > 500, `${label}, step 3: the stroke on the wing reached undo tile column ${x.seamTile}, the seam's: the ${x.touched} tiles it touched hold ${x.fuseInTouched} texels of fuselage paint`);
  R.is(x.wingGained > 1000 && x.fuseGained === 0, `${label}, step 3: at ${W0 * 4} the stroke paints where it is on the wing (${x.wingGained} texels turned to its colour there, read at ${W0}) and nothing on the fuselage (${x.fuseGained})`);
  R.is(x.saved && x.reloaded && x.steps.length === 5, `${label}: all five later steps ran, the last a real save and reload (${x.steps.length})`);
  for (const st of x.steps) {
    R.is(st.paint.lost === 0 && st.paint.sum >= .97 && st.paint.sum <= 1.03,
      `${label}, ${st.name} (${st.w}×${st.h}): the fuselage paint is all there — ${fmt(st.paint)}`);
    R.is(st.mask.lost === 0 && st.mask.sum >= .97 && st.mask.sum <= 1.03, `    …and its mask — ${fmt(st.mask)}`);
  }
}
const lostAt = (x, i) => x.steps[i] ? x.steps[i].paint.lost : -1;
R.is(lostAt(o.injRestore, 1) > 500 && lostAt(o.injRestore, 0) === 0,
  `the check sees an erase: with restoreTile clearing a tile instead of putting its pre-stroke copy back, step 3 loses ${lostAt(o.injRestore, 1)} fuselage texels (step 2 ${lostAt(o.injRestore, 0)})`);
R.is(lostAt(o.injRescale, 2) > 1000 && lostAt(o.injRescale, 1) === 0,
  `    …and with the way back down dropping the layer's pixels, step 4 loses ${lostAt(o.injRescale, 2)} (step 3 ${lostAt(o.injRescale, 1)})`);
R.finish(`projector: ${o.mode}`);
