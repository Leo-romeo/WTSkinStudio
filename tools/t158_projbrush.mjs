// The projected 3-D brush (ROADMAP 1.19 + 1.20 + 4.51; docs/BRUSH_PROJECTION.md).
//
// WHY THIS EXISTS. A 3-D stroke laid a disc of brush-size TEXELS round each raycast hit, so paint went
// where the UV island went: round a wing's leading edge onto its underside (1.20), wider or narrower
// than the ring on an island whose UVs are stretched (1.20), and cut at every part line, because the
// half of a dab past a seam belongs to another island the centre never reached (1.19, 4.51). The
// projected brush places the dabs on the screen and lets every texel ask how much of each covers its
// own point on the model. What makes that right is checkable on synthetic scenes, driven through the
// real viewport with pointer events, each check reading the layer's pixels:
//
//   1. a thin wing whose top and underside are ONE island wrapped round a rounded leading edge: a dab
//      on the edge from above paints no texel that faces away from the camera;
//   2. a plate whose UVs are stretched 3:1: the painted area on the model is the ring's, ±10 %;
//   3. a plate hidden right behind the one being painted, facing the camera inside the brush: untouched
//      (the depth pre-pass);
//   4. a stroke at a shallow angle across a seam between two islands of different density, at 19 %
//      with Build up: the paint along the stroke's middle stays within ±5 % across the seam (1.19's
//      pale band and straight cut);
//   5. the zoom does not change the paint (the owner's answer (5)): the same stroke in world units,
//      laid from two camera distances 4× apart, paints the same texels within ±2 levels;
//   6. the 2-D brush is the oracle: on a plate facing the camera at one texel per screen pixel, the
//      projected stroke is the 2-D stroke of the same dabs within ±2 levels, at Flow 1 and at Flow 0.3
//      with Build up.
//
// 1, 2 and 4 are also run with the switch OFF, on the UV-space brush this replaces, and must fail there
// — that is what shows they test the defect. 3, 5 and 6 guard the new path (3's hidden plate is on
// another island, which the old brush could never reach either). Slice (b) runs every coverage tool
// across 4's seam; slice (c) holds the reach (a box past a wing's edge untouched, a 60° plate whole)
// and the bleed (two gutter texels, not three; no false wall on a Panel line), each also run with its
// constant turned off, where it must fail. Slice (d): with Symmetry on, a stroke on one of two mirrored
// plates lays its mirror image on the other texel for texel, a stroke along the plane is unchanged by
// it, and Radial lays even turns, with and without the mirror. After the lane's review: a part posed by
// its mesh's matrix takes the dab where it is, a 320 000-triangle part's grid is made once for the
// stroke and for 16 copies, the coverage is drawn again after Parts ▸ bind…, and a Shift+click line from
// far off the view is walked from where it comes into it. And with the switch on, a stroke the
// projected brush does not do (the Clone) still paints, the old way, and says so.
//
// Usage: node tools/t158_projbrush.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var N = 256;
  var el = document.getElementById("view3d");
  // ---- a scene: meshes from triangle soups, one sheet, the camera on +z looking at the origin ----
  var mesh = function(name, tris){            // tris: [[p, n, uv] × 3, …]
    var n = tris.length * 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), k = 0;
    tris.forEach(function(t){ t.forEach(function(v){ pos.set(v[0], k * 3); nrm.set(v[1], k * 3); uv.set(v[2], k * 2); k++; }); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = name; m.userData = { mat: "m148" };
    return { gd: { name: name, mat: "m148", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  // A quad in the plane z = z facing +z, (x0, y0)–(x1, y1), its UVs (u0, v0)–(u1, v1). The first
  // triangle is a, b, d — its two edges at a run along x and along y, so faceTexelDensity at a hit in
  // it is the mean of the two axes' densities.
  var quad = function(x0, y0, x1, y1, z, u0, v0, u1, v1){
    var P = function(x, y, u, v){ return [[x, y, z], [0, 0, 1], [u, v]]; };
    var a = P(x0, y0, u0, v0), b = P(x1, y0, u1, v0), c = P(x1, y1, u1, v1), d = P(x0, y1, u0, v1);
    return [[a, b, d], [b, c, d]];
  };
  var group = null, s = null, L = null;
  var setup = function(parts, opts){
    opts = opts || {};
    if (group) scene.remove(group);
    group = new THREE.Group(); parts.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
    var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
    s = { id: "t158", cStem: "t158", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
          baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
    App.slots = new Map([["t158", s]]); App.activeSlot = s;
    App.geomData = parts.map(function(q){ return q.gd; });
    App.meshes = new Map(parts.map(function(q){ return [q.mesh.name, q.mesh]; }));
    App.matSlot = new Map([["m148", "t158"]]);
    App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 2, y: 2, z: 1 };
    modelGroup = group;
    document.getElementById("symOn").checked = !!opts.sym;
    document.getElementById("optFlipV").checked = false;
    setPlacing(false);
    if (!App.paint3d) setPaint3d(true);
    cam.fly = false; cam.glide = null; cam.target.set(opts.tx || 0, opts.ty || 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = opts.dist || 3;
    resize3D(); syncCamera();
    setBrushMode("color");
    var b = App.brush;
    b.color = opts.color || "#c86432"; b.opacity = opts.opacity == null ? 1 : opts.opacity; b.flow = opts.flow == null ? 1 : opts.flow;
    b.build = !!opts.build; b.size = opts.size || 32; b.hardness = opts.hard == null ? .7 : opts.hard; b.spacing = .15;
    b.tip = "round"; b.sizeJit = b.flowJit = b.scatter = b.angle = b.angleJit = 0; b.follow = false; b.lazy = 0;
    b.proj3d = !!opts.proj;
    brushStamp._key = null;
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.undoStack.length = 0; App.redoStack.length = 0;
  };
  var pressure = null;                          // set to drive the stroke as a pen at that pressure
  var pe = function(type, x, y){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: pressure == null ? "mouse" : "pen",
      pressure: pressure == null ? 0 : pressure }); };
  // A stroke through the viewport along world points (client px from the camera as it is).
  var strokeW = function(pts){
    var sc = pts.map(function(w){ return worldToScreen(w); });
    el.dispatchEvent(pe("pointermove", sc[0].x, sc[0].y));
    el.dispatchEvent(pe("pointerdown", sc[0].x, sc[0].y));
    var proj = !!(stroke && stroke.pj);
    for (var i = 1; i < sc.length; i++) el.dispatchEvent(pe("pointermove", sc[i].x, sc[i].y));
    el.dispatchEvent(pe("pointerup", sc[sc.length - 1].x, sc[sc.length - 1].y));
    return proj;
  };
  var line = function(a, b, n){ var o = []; for (var i = 0; i <= n; i++) o.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, a[2] + (b[2] - a[2]) * i / n)); return o; };
  var px = function(){ return ctx2d(L.canvas).getImageData(0, 0, N, N).data; };
  out.mode = projGL() ? "gl" : "canvas";

  // ---- 1. the wing's leading edge ----
  // Top at z = +h for y in [−0.8, 0], a half cylinder of radius h round the edge, the underside at
  // z = −h back to y = −0.8. One island: u = (x + 1) / 2, v = half the arc length from the top's back
  // edge (128 texels a metre both ways). A texel faces away from a camera above it from v = VDOWN on.
  var h = .05, Ls = .8, wingTris = [], cols = 8;
  var sec = [];                                   // the cross-section: [y, z, ny, nz, s]
  for (var i = 0; i <= 8; i++) sec.push([-Ls + Ls * i / 8, h, 0, 1, Ls * i / 8]);
  for (var i = 1; i <= 16; i++) { var th = Math.PI * i / 16; sec.push([h * Math.sin(th), h * Math.cos(th), Math.sin(th), Math.cos(th), Ls + h * th]); }
  for (var i = 1; i <= 8; i++) sec.push([-Ls * i / 8, -h, 0, -1, Ls + Math.PI * h + Ls * i / 8]);
  for (var c = 0; c < cols; c++) for (var j = 0; j + 1 < sec.length; j++) {
    var x0 = -1 + 2 * c / cols, x1 = -1 + 2 * (c + 1) / cols;
    var V = function(x, q){ return [[x, q[0], q[1]], [0, q[2], q[3]], [(x + 1) / 2, q[4] / 2]]; };
    var A = V(x0, sec[j]), B = V(x1, sec[j]), C = V(x1, sec[j + 1]), D = V(x0, sec[j + 1]);
    wingTris.push([A, B, C], [A, C, D]);
  }
  var VDOWN = (Ls + h * Math.PI / 2) / 2;          // the edge's most forward line: past it the arc faces down
  var wing = function(proj){
    setup([mesh("wing", wingTris)], { proj: proj, size: 64, hard: 1, ty: -.2 });
    // a single dab, from above, on the top of the edge's curve
    var used = strokeW([new THREE.Vector3(0, .01, h * .98)]);
    var d = px(), away = 0, top = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var a = d[(y * N + x) * 4 + 3], v = 1 - (y + .5) / N;
      if (!a) continue;
      if (v > VDOWN + 1 / N) away++; else top++;
    }
    return { used: used, away: away, top: top };
  };
  out.wing = { on: wing(true), off: wing(false) };

  // ---- 2. UVs stretched 3:1 ----
  // x in [−1/3, 1/3] over the whole width (384 texels a metre), y in [−1, 1] over the whole height
  // (128). The ring's radius is size / 2 over the hit triangle's density: its two edges at the corner
  // run 256 texels over 2/3 m and 256 over 2 m, so 512 / (8/3) = 192 texels a metre.
  var stretch = function(proj){
    setup([mesh("plate", quad(-1/3, -1, 1/3, 1, 0, 0, 0, 1, 1))], { proj: proj, size: 48, hard: 1 });
    var used = strokeW([new THREE.Vector3(-.1, -.3, 0)]);
    var d = px(), n = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
    var R = 24 / 192;
    return { used: used, area: n / (384 * 128), ring: Math.PI * R * R };
  };
  out.stretch = { on: stretch(true), off: stretch(false) };

  // ---- 3. a plate hidden right behind the one painted ----
  // front: the left half of the sheet; behind (30 cm back, the same size, facing the camera): the right.
  var depth = function(){
    setup([mesh("front", quad(-1, -1, 1, 1, 0, 0, 0, .5, 1)), mesh("behind", quad(-1, -1, 1, 1, -.3, .5, 0, 1, 1))], { proj: true, size: 40 });
    var used = strokeW(line([-.4, 0, 0], [.4, 0, 0], 12));
    var d = px(), fr = 0, bh = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3]) { if (x < N / 2) fr++; else bh++; }
    return { used: used, front: fr, behind: bh };
  };
  out.depth = depth();
  // …and after a vehicle switch frees the projector's buffers with a decal pass's attributes still on —
  // the pre-pass used to fail whole, and the hidden plate took paint (review, 2026-10-23).
  var stale = function(){
    setup([mesh("front", quad(-1, -1, 1, 1, 0, 0, 0, .5, 1)), mesh("behind", quad(-1, -1, 1, 1, -.3, .5, 0, 1, 1))], { proj: true, size: 40 });
    var G = projGL(), gl = G.gl, b = projBuffers(G, App.geomData[0]);
    for (var k of ["uv", "pos", "nrm"]) { gl.bindBuffer(gl.ARRAY_BUFFER, b[k]); gl.enableVertexAttribArray(G.a[k]); gl.vertexAttribPointer(G.a[k], k === "uv" ? 2 : 3, gl.FLOAT, false, 0, 0); }
    projGLFree();
    gl.getError();
    var used = strokeW(line([-.4, 0, 0], [.4, 0, 0], 12)), err = gl.getError();
    var d = px(), bh = 0;
    for (var y = 0; y < N; y++) for (var x = N / 2; x < N; x++) if (d[(y * N + x) * 4 + 3]) bh++;
    return { used: used, behind: bh, err: err };
  };
  out.stale = stale();
  // a floor running past the camera, seen 30° from above: triangles with a corner behind the camera
  var floor = function(){
    var P = function(x, z){ return [[x, 0, z], [0, 1, 0], [(x + 3) / 6, (z + 5) / 15]]; };
    var a = P(-3, -5), b = P(3, -5), c = P(3, 10), d = P(-3, 10);
    setup([mesh("floor", [[a, b, d], [b, c, d]])], { proj: true, size: 24 });
    cam.phi = Math.PI / 3; syncCamera();
    var used = strokeW([new THREE.Vector3(0, 0, 0)]), dd = px(), n = 0;
    for (var i = 3; i < dd.length; i += 4) if (dd[i]) n++;
    return { used: used, painted: n };
  };
  out.floor = floor();
  // a part whose far face, facing away, sits on the opposite corner of a 2048² sheet: the stroke keeps
  // its few tiles, where it used to snapshot all 64 (32 MB of undo for 335 texels)
  var slab = function(){
    var keepN = N; N = 2048;
    var P = function(x, y, u, v){ return [[x, y, -.05], [0, 0, -1], [u, v]]; };
    var a = P(-1, -1, .9, .9), b = P(1, -1, 1, .9), c = P(1, 1, 1, 1), d = P(-1, 1, .9, 1);
    setup([mesh("slab", quad(-1, -1, 1, 1, 0, 0, 0, .1, .1).concat([[a, d, b], [b, d, c]]))], { proj: true, size: 6 });
    var used = strokeW(line([-.2, 0, 0], [.2, 0, 0], 6)), top = App.undoStack[App.undoStack.length - 1];
    var dd = px(), n = 0;
    for (var i = 3; i < dd.length; i += 4) if (dd[i]) n++;
    N = keepN;
    return { used: used, painted: n, bytes: top ? top.bytes : -1 };
  };
  out.slab = slab();

  // ---- 4. a shallow stroke across a seam, 19 %, Build up ----
  // left: x in [−1, 0] at 128 texels a metre (u 0–0.5, v 0–1); right: x in [0, 1] at 64 (u 0.625–0.875,
  // v 0–0.5) — two islands apart on the sheet, two densities, one surface.
  var seam = function(proj){
    setup([mesh("left", quad(-1, -1, 0, 1, 0, 0, 0, .5, 1)), mesh("right", quad(0, -1, 1, 1, 0, .625, 0, .875, .5))],
          { proj: proj, size: 32, opacity: .19, build: true });
    var a = [-.12, -.6, 0], b = [.12, .6, 0];
    var used = strokeW(line(a, b, 40));
    var d = px(), vals = [];
    for (var t = .2; t <= .8001; t += .02) {
      var x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, tx, ty;
      if (x < 0) { tx = (x + 1) * 128; ty = (1 - y) * 128; } else { tx = 160 + x * 64; ty = N - (y + 1) * 64; }
      vals.push(d[(Math.floor(ty) * N + Math.floor(tx)) * 4 + 3]);
    }
    var sorted = vals.slice().sort(function(p, q){ return p - q; }), med = sorted[sorted.length >> 1];
    return { used: used, vals: vals, med: med, lo: sorted[0], hi: sorted[sorted.length - 1] };
  };
  out.seam = { on: seam(true), off: seam(false) };
  // …and the same stroke as ONE undo step that puts back exactly what was there, and redoes exactly
  // what it laid; then with the layer limited to the left part, which is the stroke's fixed stencil.
  var seamDone = px().slice(), steps = App.undoStack.length;
  doUndo(true); var undone = px(), clean = true; for (var i = 3; i < undone.length; i += 4) if (undone[i]) { clean = false; break; }
  doRedo(true); var redone = px(), same = true; for (var i = 0; i < redone.length; i++) if (redone[i] !== seamDone[i]) { same = false; break; }
  out.undo = { steps: steps, clean: clean, same: same };
  setup([mesh("left", quad(-1, -1, 0, 1, 0, 0, 0, .5, 1)), mesh("right", quad(0, -1, 1, 1, 0, .625, 0, .875, .5))],
        { proj: true, size: 32, opacity: .19, build: true });
  L.scope = Scope.make(["left"]);
  var usedLim = strokeW(line([-.12, -.6, 0], [.12, .6, 0], 40));
  var d = px(), lf = 0, rt = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3]) { if (x < 144) lf++; else rt++; }
  out.limit = { used: usedLim, left: lf, right: rt };

  // ---- 5. the zoom does not change the paint ----
  var zoom = function(dist){
    setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24, dist: dist, flow: .5 });
    var used = strokeW(line([-.5, -.2, 0], [.4, .3, 0], 16));
    return { used: used, d: px() };
  };
  // Premultiplied, as in 6: a texel at alpha 3 reads its colour back from two premultiplied levels.
  var pre = function(d, i, k){ return k === 3 ? d[i + 3] : d[i + k] * d[i + 3] / 255; };
  var z3 = zoom(3), z12 = zoom(12), worst = 0, painted = 0;
  for (var i = 0; i < z3.d.length; i += 4) {
    for (var k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(pre(z3.d, i, k) - pre(z12.d, i, k)));
    if (z3.d[i + 3]) painted++;
  }
  out.zoom = { used: z3.used && z12.used, worst: Math.round(worst * 10) / 10, painted: painted };

  // ---- 6. the 2-D brush is the oracle ----
  // A plate facing the camera at one texel per pixel of the view's own whole-pixel space (the space
  // the brush works in): texel (i, j) is view pixel (X0 + i, Y0 + j).
  var oracle = function(flow, build){
    setup([], { proj: true, size: 32, flow: flow, build: build });
    var r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
    var P = camera.projectionMatrix.elements, fx = P[0] * W / 2, fy = P[5] * H / 2, D = cam.dist;
    var X0 = Math.floor(W / 2) - 128, Y0 = Math.floor(H / 2) - 128;
    var wx = function(x){ return (x - W / 2) * D / fx; }, wy = function(y){ return (H / 2 - y) * D / fy; };
    var q = mesh("plate", quad(wx(X0), wy(Y0 + N), wx(X0 + N), wy(Y0), 0, 0, 0, 1, 1));
    setup([q], { proj: true, size: 32, flow: flow, build: build });
    var path = [];
    for (var i = 0; i <= 20; i++) { var t = i / 20; path.push([40.3 + 170.4 * t, 60.2 + 120 * t + 30 * Math.sin(t * 3)]); }
    var client = function(p){ return { x: r.left + (X0 + p[0]) * r.width / W, y: r.top + (Y0 + p[1]) * r.height / H }; };
    var c0 = client(path[0]);
    el.dispatchEvent(pe("pointermove", c0.x, c0.y));
    el.dispatchEvent(pe("pointerdown", c0.x, c0.y));
    var used = !!(stroke && stroke.pj);
    for (var i = 1; i < path.length; i++) { var c = client(path[i]); el.dispatchEvent(pe("pointermove", c.x, c.y)); }
    el.dispatchEvent(pe("pointerup", c.x, c.y));
    var proj = px();
    // the same dabs through the 2-D brush, on a fresh layer
    L = LayerNode.of({ type: "paint", name: "p2", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    beginStroke(false, false);
    stroke.p = 1;
    path.forEach(function(p){ stampAt(p[0], p[1], 0); });
    endStroke();
    // Compared PREMULTIPLIED — what a canvas holds and what the layer composites — because a texel
    // at alpha 3 reads its colour back from two premultiplied levels, and one level there is 85 of the
    // straight colour.
    var flat = px(), worst = 0, at = null, n = 0, sum = 0, ap = 0, af = 0;
    for (var i = 0; i < flat.length; i += 4) {
      for (var k = 0; k < 4; k++) {
        var pa = k === 3 ? proj[i + 3] : proj[i + k] * proj[i + 3] / 255, fa = k === 3 ? flat[i + 3] : flat[i + k] * flat[i + 3] / 255;
        var e = Math.abs(pa - fa);
        if (k === 3 && (proj[i + 3] || flat[i + 3])) { sum += e; ap += proj[i + 3]; af += flat[i + 3]; }
        if (e > worst) { worst = e; at = [(i >> 2) % N, Math.floor((i >> 2) / N), k, proj[i + k], flat[i + k]]; }
      }
      if (flat[i + 3]) n++;
    }
    worst = Math.round(worst * 10) / 10;
    return { used: used, worst: worst, at: at, painted: n, mean: Math.round(sum / Math.max(1, n) * 1000) / 1000,
             total: Math.round((ap - af) / Math.max(1, af) * 10000) / 100 };
  };
  // …and one dab at a whole-pixel position, where neither rasteriser has a sub-pixel offset to differ on.
  var dab1 = function(){
    var r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
    var P = camera.projectionMatrix.elements, fx = P[0] * W / 2, fy = P[5] * H / 2, D = cam.dist;
    var X0 = Math.floor(W / 2) - 128, Y0 = Math.floor(H / 2) - 128;
    var wx = function(x){ return (x - W / 2) * D / fx; }, wy = function(y){ return (H / 2 - y) * D / fy; };
    setup([mesh("plate", quad(wx(X0), wy(Y0 + N), wx(X0 + N), wy(Y0), 0, 0, 0, 1, 1))], { proj: true, size: 32 });
    var cx = r.left + (X0 + 100) * r.width / W, cy = r.top + (Y0 + 120) * r.height / H;
    el.dispatchEvent(pe("pointermove", cx, cy)); el.dispatchEvent(pe("pointerdown", cx, cy)); el.dispatchEvent(pe("pointerup", cx, cy));
    var a = px();
    L = LayerNode.of({ type: "paint", name: "p2", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    beginStroke(false, false); stroke.p = 1; stampAt(100, 120, 0); endStroke();
    var b = px(), diff = 0, worst = 0, n = 0;
    for (var i = 0; i < a.length; i += 4) {
      if (a[i + 3] !== b[i + 3]) diff++;
      for (var k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[i + k] * a[i + 3] - b[i + k] * b[i + 3]) / 255);
      if (a[i + 3]) n++;
    }
    return { diff: diff, worst: Math.round(worst * 10) / 10, painted: n };
  };
  out.oracle = { full: oracle(1, false), build: oracle(.3, true), dab: dab1() };

  // ---- slice (b): every coverage tool, on every channel and on a mask, across the same seam ----
  // Each tool's stroke must reach BOTH islands along its middle — the half past the seam is what the
  // UV-space brush lost — and do there what that tool does.
  var seamPx = function(c, a, b){
    var d = ctx2d(c).getImageData(0, 0, N, N).data, L1 = [], R1 = [];
    for (var t = .2; t <= .8001; t += .05) {
      var x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, tx, ty;
      if (x < 0) { tx = (x + 1) * 128; ty = (1 - y) * 128; } else { tx = 160 + x * 64; ty = N - (y + 1) * 64; }
      var i = (Math.floor(ty) * N + Math.floor(tx)) * 4;
      (x < -.02 ? L1 : x > .02 ? R1 : []).push([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    }
    return { left: L1, right: R1 };
  };
  var tool = function(mode, value, pre){
    setup([mesh("left", quad(-1, -1, 0, 1, 0, 0, 0, .5, 1)), mesh("right", quad(0, -1, 1, 1, 0, .625, 0, .875, .5))], { proj: true, size: 24, hard: .9 });
    if (pre) pre();
    setBrushMode(mode); App.brush.proj3d = true; App.brush.value = value; App.brush.opacity = 1; App.brush.flow = 1; App.brush.size = 24;
    if (mode === "height") App.brush.spacing = .35;
    brushStamp._key = null;
    var a = [-.12, -.6, 0], b = [.12, .6, 0], used = strokeW(line(a, b, 40));
    return { used: used, a: a, b: b };
  };
  var eras = tool("erase", 128, function(){ var g = ctx2d(L.canvas); g.fillStyle = "#3060c0"; g.fillRect(0, 0, N, N); });
  out.erase = Object.assign({ used: eras.used }, seamPx(L.canvas, eras.a, eras.b));
  var sm = tool("smooth", 200);
  var smC = LayerNode.contentOn(L, "smooth");
  out.smooth = Object.assign({ used: sm.used, has: !!(smC && smC.canvas) }, smC && smC.canvas ? seamPx(smC.canvas, sm.a, sm.b) : {});
  var mk = tool("mask", 0);
  out.mask = Object.assign({ used: mk.used, has: !!L.mask }, L.mask ? seamPx(L.mask, mk.a, mk.b) : {});
  var hg = tool("height", 40);
  var hC = LayerNode.contentOn(L, "normal");
  // a groove's walls: the normal's X off 128 a little to either side of the stroke's middle
  var wall = function(c, side){
    var d = ctx2d(c).getImageData(0, 0, N, N).data, out2 = [];
    [-1, 1].forEach(function(sg){
      var x = side < 0 ? -.07 : .07, y = (x - hg.a[0]) / (hg.b[0] - hg.a[0]) * (hg.b[1] - hg.a[1]) + hg.a[1], off = .045 * sg;
      var X = x + off, tx = X < 0 ? (X + 1) * 128 : 160 + X * 64, ty = X < 0 ? (1 - y) * 128 : N - (y + 1) * 64;
      var i = (Math.floor(ty) * N + Math.floor(tx)) * 4;
      out2.push(d[i] - 128);
    });
    return out2;
  };
  out.height = { used: hg.used, has: !!(hC && hC.canvas), left: hC && hC.canvas ? wall(hC.canvas, -1) : null, right: hC && hC.canvas ? wall(hC.canvas, 1) : null };
  // a turned Square tip against the 2-D brush: the turn's direction and the tip's box are the 2-D one's
  var keepTip = function(){ App.brush.tip = "square"; App.brush.angle = 30; brushStamp._key = null; };
  var setupKeep = setup;
  setup = function(parts, opts){ setupKeep(parts, opts); keepTip(); };
  out.oracle.square = oracle(1, false);
  setup = setupKeep;
  // a pen at half pressure: half the size, a quarter of the area
  var dabArea = function(p){
    setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 40, hard: 1 });
    App.brush.pSize = true; App.brush.curve = 1;
    pressure = p; var used = strokeW([new THREE.Vector3(0, 0, 0)]); pressure = null;
    var d = px(), n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
    return { used: used, n: n };
  };
  var full = dabArea(1), half = dabArea(.5);
  out.pen = { used: full.used && half.used, full: full.n, half: half.n };

  // ---- slice (c): reach ----
  // A wing's edge with a box a metre under it, both facing the camera: a dab on the edge whose ring runs
  // past it onto the box paints the wing and leaves the box alone. With the reach off (REACH = ∞), as
  // (a) and (b) had it, the box takes the part of the dab past the edge — so this tests the defect.
  var reach = function(on){
    var keep = ProjBrush.REACH; if (!on) ProjBrush.REACH = Infinity;
    setup([mesh("edge", quad(-1, -1, 0, 1, 0, 0, 0, .5, 1)), mesh("box", quad(-1, -1, 1, 1, -1, .625, 0, 1, 1))], { proj: true, size: 40, hard: 1 });
    var used = strokeW([new THREE.Vector3(-.03, 0, 0)]);
    ProjBrush.REACH = keep;
    var d = px(), w = 0, bx = 0;                          // split in the gutter: the wing's rim bleeds into it
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3]) { if (x < 144) w++; else bx++; }
    return { used: used, wing: w, box: bx };
  };
  out.reach = { on: reach(true), off: reach(false) };
  // A plate turned 60° from the camera: its depth runs ±1.7 R across one dab, past a flat slab of 1.5 R,
  // and the reach — the plane fitted at the dab's centre — keeps every texel of it, byte for byte. With the
  // slope taken as flat, it would cut the dab's two ends.
  var tilt = function(mode){
    var keepR = ProjBrush.REACH, keepS = ProjBrush.slope;
    if (mode === "off") ProjBrush.REACH = Infinity;
    if (mode === "flat") ProjBrush.slope = function(){ return [0, 0]; };
    var th = Math.PI / 3, cs = Math.cos(th), sn = Math.sin(th);
    var P = function(x, t, u, v){ return [[x, t * cs, -t * sn], [0, sn, cs], [u, v]]; };
    var a = P(-1, -1, 0, 0), b = P(1, -1, 1, 0), c = P(1, 1, 1, 1), dd = P(-1, 1, 0, 1);
    setup([mesh("tilt", [[a, b, dd], [b, c, dd]])], { proj: true, size: 48, hard: 1 });
    var used = strokeW([new THREE.Vector3(0, 0, 0)]);
    ProjBrush.REACH = keepR; ProjBrush.slope = keepS;
    return { used: used, d: px() };
  };
  var tOn = tilt("on"), tOff = tilt("off"), tFlat = tilt("flat"), cnt = function(d){ var n = 0; for (var i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
  var tDiff = 0; for (var i = 0; i < tOn.d.length; i++) if (tOn.d[i] !== tOff.d[i]) tDiff++;
  out.tilt = { used: tOn.used && tOff.used && tFlat.used, on: cnt(tOn.d), off: cnt(tOff.d), flat: cnt(tFlat.d), diff: tDiff };

  // ---- slice (c): bleed ----
  // Island A: x in [−1, 0] on sheet columns 64–127 (64 texels a metre), the whole height; island B, another
  // surface off to the side, from column 131 — three gutter columns between them. Across A's right rim
  // a hard dab paints the rim, the two gutter columns next to it (BLEED), not the third, and nothing of
  // B. With BLEED 0 the gutter stays empty: the line of old colour the preview's mips pull in.
  var row = Math.floor((1 - (.3 + 1) / 2) * N);      // the sheet row at y = 0.3
  var bleedScene = function(opts){
    setup([mesh("A", quad(-1, -1, 0, 1, 0, 64 / N, 0, 128 / N, 1)), mesh("B", quad(2, -1, 3, 1, 0, 131 / N, 0, 200 / N, 1))], opts);
  };
  var bleed = function(g){
    var BB = ProjBrushGL.get(projGL()), keep = ProjBrushGL.BLEED;
    BB.fill = null; ProjBrushGL.BLEED = g;                   // the fill is compiled with its reach
    bleedScene({ proj: true, size: 32, hard: 1 });
    var used = strokeW([new THREE.Vector3(-.05, .3, 0)]);
    BB.fill = null; ProjBrushGL.BLEED = keep;
    var d = px(), cols = {};
    for (var x = 124; x <= 132; x++) cols[x] = d[(row * N + x) * 4 + 3];
    return { used: used, cols: cols };
  };
  out.bleed = { on: bleed(2), off: bleed(0) };
  // Panel line: a groove run along y = 0.3 out past A's rim. Its field's gutter takes the rim's depth, so
  // the rim's normal does not lean as if the groove climbed a wall there; with BLEED 0 it does.
  var wallAt = function(g){
    var keep = ProjBrushGL.BLEED; ProjBrushGL.BLEED = g;
    bleedScene({ proj: true, size: 24, hard: .9 });
    setBrushMode("height"); App.brush.proj3d = true; App.brush.value = 40; App.brush.opacity = 1; App.brush.flow = 1; App.brush.size = 24; App.brush.spacing = .35;
    brushStamp._key = null;
    var used = strokeW(line([-.6, .3, 0], [.3, .3, 0], 30));
    ProjBrushGL.BLEED = keep;
    var hc = LayerNode.contentOn(L, "normal"), d = hc && hc.canvas ? ctx2d(hc.canvas).getImageData(0, 0, N, N).data : null;
    var lean = function(x){ return d ? d[(row * N + x) * 4] - 128 : null; };
    return { used: used, inside: lean(110), rim: lean(127), deep: d ? Math.abs(d[((row - 4) * N + 110) * 4 + 1] - 128) : null };
  };
  out.wall = { on: wallAt(2), off: wallAt(0) };

  // ---- slice (d): the mirror and radial copies ----
  var symAt = function(on){
    document.getElementById("symOn").checked = !!on; document.getElementById("symAxis").value = "x";
    App.mirrorCenters = { x: 0, y: 0, z: 0 }; App.symOffset = 0;
  };
  // Two plates mirrored in x = 0, each its own island, their UVs mirrored too (u = (x + 1) / 2 on both),
  // so sheet column i of the left is column N − 1 − i of the right. A stroke on the left with Symmetry
  // on lays its mirror image on the right, texel for texel.
  setup([mesh("L", quad(-1, -1, -.1, 1, 0, 0, 0, .45, 1)), mesh("R", quad(.1, -1, 1, 1, 0, .55, 0, 1, 1))], { proj: true, size: 24, flow: .6 });
  symAt(true);
  var usedM = strokeW(line([-.7, -.4, 0], [-.3, .5, 0], 20));
  var d = px(), nl = 0, worstM = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N * .45; x++) {
    var i = (y * N + x) * 4, j = (y * N + N - 1 - x) * 4;
    if (d[i + 3]) nl++;
    for (var k = 0; k < 4; k++) worstM = Math.max(worstM, Math.abs(d[i + k] * (k < 3 ? d[i + 3] / 255 : 1) - d[j + k] * (k < 3 ? d[j + 3] / 255 : 1)));
  }
  out.mirror = { used: usedM, left: nl, worst: Math.round(worstM * 10) / 10 };
  // A stroke along the mirror plane is its own mirror: with Symmetry on it lays what it lays with it
  // off — the copy lands on the texels the stroke paints that frame and takes MAX, it does not add.
  var plane = function(on){
    setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24, opacity: .19, build: true });
    symAt(on);
    var used = strokeW(line([0, -.6, 0], [0, .6, 0], 30));
    return { used: used, d: px() };
  };
  var pOn = plane(true), pOff = plane(false), worstP = 0, sumOn = 0, sumOff = 0;
  for (var i = 3; i < pOn.d.length; i += 4) { worstP = Math.max(worstP, Math.abs(pOn.d[i] - pOff.d[i])); sumOn += pOn.d[i]; sumOff += pOff.d[i]; }
  out.plane = { used: pOn.used && pOff.used, worst: worstP, total: Math.round((sumOn - sumOff) / Math.max(1, sumOff) * 10000) / 100, mid: pOn.d[(128 * N + 128) * 4 + 3], midOff: pOff.d[(128 * N + 128) * 4 + 3] };
  // Radial, four copies about z through the origin, on a plate whose UVs are the whole sheet: one dab at
  // (0.5, 0.2) and its three turns, each the same size; then with Symmetry on as well, eight.
  var radial = function(sym){
    setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24, hard: 1 });
    symAt(sym);
    App.radial = { n: 4, axis: "z", c: [0, 0, 0], dir: [0, 0, 1], geom: Bake.vehicleGeom().first };
    var used = strokeW([new THREE.Vector3(.5, .2, 0)]);
    App.radial = null;
    var d = px(), at = [[.5, .2], [-.2, .5], [-.5, -.2], [.2, -.5]];
    if (sym) at = at.concat(at.map(function(q){ return [-q[0], q[1]]; }));
    var n = at.map(function(){ return 0; }), stray = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      if (d[(y * N + x) * 4 + 3] < 128) continue;
      var wx = (x + .5) / 128 - 1, wy = 1 - (y + .5) / 128, near = -1;
      for (var q = 0; q < at.length; q++) if (Math.hypot(wx - at[q][0], wy - at[q][1]) < .2) near = q;
      if (near < 0) stray++; else n[near]++;
    }
    return { used: used, n: n, stray: stray };
  };
  out.radial = { four: radial(false), eight: radial(true) };
  symAt(false);

  // ---- a posed part: moved and turned by its mesh's matrix, as PoseApply moves a flap or a gear leg ----
  // Its arrays stay at rest; the brush paints where it is (the review of 2026-10-23 measured 0 texels).
  var posed = function(proj){
    var q = mesh("posed", quad(-.3, -.3, .3, .3, 0, 0, 0, 1, 1));
    setup([q], { proj: proj, size: 32, hard: 1, tx: .9 });
    q.mesh.matrixAutoUpdate = false;
    q.mesh.matrix.makeRotationZ(.6).setPosition(.9, 0, 0);
    group.updateMatrixWorld(true);
    var used = strokeW([new THREE.Vector3(.9, 0, 0)]);
    var d = px(), n = 0, sx = 0, sy = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] >= 128) { n++; sx += x + .5; sy += y + .5; }
    return { used: used, n: n, cx: n ? sx / n : -1, cy: n ? sy / n : -1 };
  };
  out.posed = { on: posed(true), off: posed(false) };
  // ---- the copies' cost: a 320 000-triangle part, Radial 8 with the mirror — 16 copies — two strokes ----
  // Each part's triangles are looked up in one grid made once, whatever the copies and the camera.
  var big = function(){
    var G = 400, nt = G * G * 2, pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), uv = new Float32Array(nt * 6), t = 0;
    var put = function(x, y){ pos[t * 3] = x * 2 - 1; pos[t * 3 + 1] = y * 2 - 1; nrm[t * 3 + 2] = 1; uv[t * 2] = x; uv[t * 2 + 1] = y; t++; };
    for (var j = 0; j < G; j++) for (var i = 0; i < G; i++) {
      var x0 = i / G, x1 = (i + 1) / G, y0 = j / G, y1 = (j + 1) / G;
      put(x0, y0); put(x1, y0); put(x0, y1); put(x1, y0); put(x1, y1); put(x0, y1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = "big"; m.userData = { mat: "m148" };
    return { gd: { name: "big", mat: "m148", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  var B1 = big();
  var cost = function(copies){
    setup([B1], { proj: true, size: 24, sym: copies > 8 });
    document.getElementById("symAxis").value = "x"; App.mirrorCenters = { x: 0, y: 0, z: 0 }; App.symOffset = 0;
    App.radial = copies > 1 ? { n: 8, axis: "z", c: [0, 0, 0], dir: [0, 0, 1], geom: Bake.vehicleGeom().first } : null;
    var made = ProjBrush.gridsMade, t0 = performance.now();
    var used = strokeW(line([.3, .1, 0], [.4, .2, 0], 4));
    var ms = performance.now() - t0;
    App.radial = null;
    return { used: used, ms: Math.round(ms), grids: ProjBrush.gridsMade - made };
  };
  out.cost = { one: cost(1), sixteen: cost(16), again: cost(16) };
  document.getElementById("symOn").checked = false;

  // ---- the coverage after Parts ▸ bind…, and a Shift+click line started far off the view ----
  setup([mesh("A", quad(-1, -1, 0, 1, 0, 0, 0, .5, 1))], { proj: true });
  var gB = mesh("Bnew", quad(0, -1, 1, 1, 0, .5, 0, 1, 1)).gd;
  gB.mat = "mB"; App.geomData.push(gB);
  var cv1 = ProjBrush.cover(N, N); App.matSlot.set("mB", "t158"); var cv2 = ProjBrush.cover(N, N);
  out.bind = { fresh: cv1 !== cv2, again: ProjBrush.cover(N, N) === cv2 };
  var cl = ProjBrush.into({ x: -51367, y: 300, p: .5 }, { x: 600, y: 400, p: 1 }, -20, -20, 1300, 980);
  var inside = ProjBrush.into({ x: 100, y: 100, p: .5 }, { x: 600, y: 400, p: 1 }, -20, -20, 1300, 980);
  out.into = { x: cl.x, p: cl.p, same: inside.x === 100 && inside.y === 100 };

  // ---- Colour along (4.56) on the projected brush (fix plan 2026-10-23, step 3) ----
  // A Hue cycle two sizes long on a 1.6 m stroke across a plate of 128 texels a metre: about four turns of
  // the wheel, read along the stroke's own sheet row. Off is the stroke's one ink, as before.
  var along = function(cycle){
    setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24, color: "#ff0000" });
    App.brush.cycle = cycle; App.brush.cycleLen = 2;
    var used = strokeW(line([-.8, 0, 0], [.8, 0, 0], 16)), d = px(), seen = {}, y = N >> 1, h = 2166136261;
    for (var x = 0; x < N; x += 4) { var k = (y * N + x) * 4; if (d[k + 3] > 200) seen[(d[k] >> 5) + "," + (d[k + 1] >> 5) + "," + (d[k + 2] >> 5)] = 1; }
    for (var i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
    App.brush.cycle = "off";
    return { used: used, hues: Object.keys(seen).length, hash: h };
  };
  out.along = { hue: along("hue"), off: along("off") };

  // ---- 6.5: two islands of ONE part side by side on the sheet and 1.2 m apart on the model ----
  // The first outside tester's report (2026-10-24): a dab on one wing rail turned the other rail red,
  // because the UV-space brush's disc confines paint to the PART, and the part's other island is packed
  // right beside it. Rail A: x −1 … −0.6, u 0 … 0.2; rail B: x 0.6 … 1, u 0.22 … 0.42 — both
  // y −0.2 … 0.2, v 0 … 0.2, 128 texels a metre. A dab of 24 texels' radius at A's right end reaches
  // B's island on the sheet (5 texels away) and nothing of it on the model.
  var islands = function(proj){
    setup([mesh("rails", quad(-1, -.2, -.6, .2, 0, 0, 0, .2, .2).concat(quad(.6, -.2, 1, .2, 0, .22, 0, .42, .2)))], { proj: proj, size: 48, hard: 1, tx: -.5 });
    var used = strokeW([new THREE.Vector3(-.63, 0, 0)]), d = px(), a = 0, b = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      if (!d[(y * N + x) * 4 + 3]) continue;
      if (x < .21 * N) a++; else b++;
    }
    return { used: used, a: a, b: b };
  };
  out.islands = { on: islands(true), off: islands(false) };
  // ---- a stroke the projected brush does not do still paints, the old way, and says so ----
  setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24 });
  setBrushMode("clone"); App.brush.proj3d = true; brushStamp._key = null;
  Clone.pick(s, 20, 20);
  var usedCl = strokeW(line([-.3, 0, 0], [.3, 0, 0], 6));
  var d = px(), n = 0;
  for (var i = 3; i < d.length; i += 4) if (d[i]) n++;
  out.clone = { used: usedCl, painted: n, said: [...ProjBrush.said] };
  // Retouch reads the sheet the Clone's way, and is refused under its own name (fix plan 2026-10-23, step 4)
  setup([mesh("plate", quad(-1, -1, 1, 1, 0, 0, 0, 1, 1))], { proj: true, size: 24 });
  setBrushMode("retouch"); App.brush.proj3d = true; brushStamp._key = null;
  out.retouch = { would: ProjBrush.would(), used: strokeW(line([-.3, 0, 0], [.3, 0, 0], 6)), said: [...ProjBrush.said].filter(function(w){ return !/Clone copies/.test(w); }) };
  setBrushMode("color");
  out.stack = App.undoStack.length;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep"),
  chromeArgs: ["--window-size=1280,960"] });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
console.log("  " + JSON.stringify({ wing: o.wing, stretch: o.stretch, depth: o.depth, seamOn: { med: o.seam.on.med, lo: o.seam.on.lo, hi: o.seam.on.hi },
  seamOff: { med: o.seam.off.med, lo: o.seam.off.lo, hi: o.seam.off.hi }, zoom: o.zoom, oracle: o.oracle, mirror: o.mirror, plane: o.plane, radial: o.radial, posed: o.posed, cost: o.cost, clone: o.clone }));
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
R.is(o.mode === "gl", `the projector has a WebGL context here (${o.mode})`);
const W = o.wing;
R.is(W.on.used && W.on.top > 100 && W.on.away === 0,
  `1. a dab on a wing's leading edge from above paints the top (${W.on.top} texels) and no texel facing away (${W.on.away})`);
R.is(!W.off.used && W.off.away > 0, `   …where the UV-space brush runs round the edge onto it (${W.off.away} texels facing away)`);
const S = o.stretch, sOn = S.on.area / S.on.ring, sOff = S.off.area / S.off.ring;
R.is(S.on.used && Math.abs(sOn - 1) <= .1, `2. on UVs stretched 3:1 the painted area is the ring's: ${(sOn * 100).toFixed(1)} % of it (±10 %)`);
R.is(!S.off.used && Math.abs(sOff - 1) > .1, `   …where the UV-space brush paints ${(sOff * 100).toFixed(1)} % of it`);
R.is(o.depth.used && o.depth.front > 500 && o.depth.behind === 0,
  `3. a plate hidden 30 cm behind the one painted is untouched (${o.depth.behind} texels; ${o.depth.front} on the front)`);
const sOnB = o.seam.on, sOffB = o.seam.off, band = x => (x.hi - x.lo) / x.med;
R.is(sOnB.used && sOnB.med > 0 && sOnB.lo >= sOnB.med * .95 && sOnB.hi <= sOnB.med * 1.05,
  `4. across a seam at a shallow angle, 19 % with Build up, the stroke's middle stays within ±5 % (${sOnB.lo}–${sOnB.hi} about ${sOnB.med})`);
R.is(!sOffB.used && !(sOffB.lo >= sOffB.med * .95 && sOffB.hi <= sOffB.med * 1.05),
  `   …where the UV-space brush's runs ${sOffB.lo}–${sOffB.hi} about ${sOffB.med} (a band of ${(band(sOffB) * 100).toFixed(0)} %)`);
R.is(o.stale.used && o.stale.behind === 0 && o.stale.err === 0,
  `   …and still after a vehicle switch freed the projector's buffers under a decal pass's attributes (${o.stale.behind} texels, GL error ${o.stale.err})`);
R.is(o.floor.used && o.floor.painted > 300, `a floor running past the camera, its triangles' far corners behind it, takes the dab (${o.floor.painted} texels)`);
R.is(o.slab.used && o.slab.painted > 100 && o.slab.bytes > 0 && o.slab.bytes <= 4 * 256 * 256 * 4 * 2,
  `a stroke on a part whose far face lies across a 2048² sheet keeps its own few tiles: ${(o.slab.bytes / 1048576).toFixed(2)} MB of undo for ${o.slab.painted} texels (at most four tiles)`);
R.is(o.undo.steps === 1 && o.undo.clean && o.undo.same,
  `   …it is one undo step (${o.undo.steps}): undo leaves the layer empty (${o.undo.clean}), redo puts back exactly the stroke (${o.undo.same})`);
R.is(o.limit.used && o.limit.left > 500 && o.limit.right === 0,
  `   …and with the layer limited to the left part, the right one gets nothing (${o.limit.right} texels; ${o.limit.left} on the left)`);
R.is(o.zoom.used && o.zoom.painted > 500 && o.zoom.worst <= 2,
  `5. the same stroke from 3 m and from 12 m paints the same texels: ${o.zoom.painted} painted, worst difference ${o.zoom.worst} levels (±2)`);
// The two rasterisers agree EXACTLY on a dab at a whole-pixel position (its alpha; the colour within
// the premultiplied rounding). Elsewhere they differ at the tip's box border, where drawImage keeps a
// hard edge rule — a texel centred ON the left edge is left out and one on the right kept — and drops
// the column its bilinear spreads into, while the GPU antialiases the box over one sheet texel (so a
// turned hard tip has no staircase). Measured 2026-10-23: one round dab at x + 0.0625 … 0.75 differed by
// 1–12 levels along its border row and nowhere else, the canvas's sum short by ~230 levels at every
// fractional position — under one texel's worth. A stroke stacks those borders, and with Flow 0.3 and
// Build up ~50 dabs reach a texel, each rounded to 8 bits on the canvas and not within a GPU batch. So
// the stated tolerance is a worst texel of 14 levels, a mean under 0.8 (Flow 1) and 1.5 (Build up), and
// the stroke's total paint within 1 %. A dab half a texel out reads 25 and more along its whole edge.
R.is(o.oracle.dab.painted > 500 && o.oracle.dab.diff === 0 && o.oracle.dab.worst <= 2,
  `6. one texel a pixel: a dab at a whole-pixel position is the 2-D brush's dab — alpha byte for byte (${o.oracle.dab.diff} texels differ of ${o.oracle.dab.painted}), colour within ${o.oracle.dab.worst} premultiplied`);
for (const [k, label, mean] of [["full", "Flow 1", .8], ["build", "Flow 0.3 with Build up", 1.5]]) {
  const x = o.oracle[k];
  R.is(x.used && x.painted > 1000 && x.worst <= 14 && x.mean <= mean && Math.abs(x.total) <= 1,
    `   ${label}: the projected stroke is the 2-D stroke of the same dabs — worst ${x.worst} levels, mean ${x.mean}, total ${x.total} %, over ${x.painted} texels (14, ${mean}, ±1 %)` + (x.worst > 14 ? " at " + JSON.stringify(x.at) : ""));
}
// slice (b)
const both = (x, f) => x && x.left && x.right && x.left.length >= 3 && x.right.length >= 3 && x.left.every(f) && x.right.every(f);
R.is(o.erase.used && both(o.erase, p => p[3] === 0), `(b) the eraser rubs out along the stroke's middle on both islands of the seam (${o.erase.left && o.erase.left.map(p => p[3])} | ${o.erase.right && o.erase.right.map(p => p[3])})`);
R.is(o.smooth.used && o.smooth.has && both(o.smooth, p => p[3] === 255 && Math.abs(p[0] - 200) <= 1),
  `    Smoothness at 200 lays 200 on both (${o.smooth.left && o.smooth.left.map(p => p[0] + "/" + p[3])} | ${o.smooth.right && o.smooth.right.map(p => p[0] + "/" + p[3])})`);
R.is(o.mask.used && o.mask.has && both(o.mask, p => p[3] === 0), `    a mask stroke at 0 hides on both (${o.mask.left && o.mask.left.map(p => p[3])} | ${o.mask.right && o.mask.right.map(p => p[3])})`);
const H2 = o.height, gv = H2.left && H2.right ? [...H2.left, ...H2.right] : [];
R.is(H2.used && H2.has && gv.length === 4 && gv.every(v => Math.abs(v) >= 6) && Math.sign(H2.left[0]) !== Math.sign(H2.left[1]) &&
     Math.sign(H2.left[0]) === Math.sign(H2.right[0]) && Math.abs(Math.abs(H2.left[0]) - Math.abs(H2.right[0])) <= Math.max(6, .35 * Math.abs(H2.left[0])),
  `    Panel line cuts one groove across the seam: its walls lean ${H2.left} on the left island and ${H2.right} on the right, the same depth either side`);
const sq = o.oracle.square;
R.is(sq.used && sq.painted > 1000 && sq.mean <= 1.5 && Math.abs(sq.total) <= 2,
  `    a Square tip turned 30° at one texel a pixel is the 2-D brush's (mean ${sq.mean}, total ${sq.total} %, worst ${sq.worst} at its antialiased edges)`);
R.is(o.pen.used && o.pen.half > 0 && Math.abs(o.pen.half / o.pen.full - .25) <= .06,
  `    a pen at half pressure lays a dab of half the size: ${o.pen.half} texels against ${o.pen.full}, ${(o.pen.half / o.pen.full).toFixed(3)} of the area (0.25)`);
// slice (c)
const RC = o.reach;
R.is(RC.on.used && RC.on.wing > 300 && RC.on.box === 0,
  `(c) a dab on a wing's edge leaves the box a metre under it alone where it shows past the edge (${RC.on.box} texels; ${RC.on.wing} on the wing)`);
R.is(RC.off.box > 0, `    …which with the reach off takes the part of the dab past the edge (${RC.off.box} texels)`);
const TL = o.tilt;
R.is(TL.used && TL.on > 500 && TL.diff === 0, `    a plate turned 60° keeps its whole dab: byte-identical with the reach on and off (${TL.diff} bytes differ, ${TL.on} texels)`);
R.is(TL.flat < TL.on * .97, `    …where a slab flat to the screen would cut its ends (${TL.flat} texels of ${TL.on})`);
const BL = o.bleed.on.cols, BO = o.bleed.off.cols;
R.is(o.bleed.on.used && BL[127] === 255 && BL[128] === 255 && BL[129] === 255 && BL[130] === 0 && BL[131] === 0,
  `    bleed: across an island's rim the two gutter texels next to it take the paint, the third and the island three texels away do not (${[126, 127, 128, 129, 130, 131, 132].map(x => BL[x]).join(" ")})`);
R.is(BO[127] === 255 && BO[128] === 0, `    …which with BLEED 0 stay empty (${[126, 127, 128, 129, 130, 131].map(x => BO[x]).join(" ")})`);
const WL = o.wall;
R.is(WL.on.used && WL.on.deep >= 6 && Math.abs(WL.on.rim) <= Math.abs(WL.on.inside) + 2 && Math.abs(WL.off.rim) >= 6,
  `    Panel line run out past a rim has no false wall there: its normal leans ${WL.on.rim} at the rim, ${WL.on.inside} inside (the groove's own wall ${WL.on.deep}); with BLEED 0, ${WL.off.rim}`);
// slice (d)
R.is(o.mirror.used && o.mirror.left > 1000 && o.mirror.worst <= 2,
  `(d) with Symmetry on, a stroke on one plate lays its mirror image on the other, texel for texel: worst ${o.mirror.worst} levels premultiplied over ${o.mirror.left} texels`);
R.is(o.plane.used && o.plane.worst <= 2 && Math.abs(o.plane.total) <= .5,
  `    a stroke along the mirror plane, 19 % with Build up, lays what it lays without Symmetry: worst ${o.plane.worst}, total ${o.plane.total} %, ${o.plane.mid} on the plane against ${o.plane.midOff}`);
const rd4 = o.radial.four, rd8 = o.radial.eight, even = x => x.n.every(v => v > 200 && Math.abs(v / x.n[0] - 1) <= .03) && x.stray === 0;
R.is(rd4.used && even(rd4), `    Radial at 4 lays the dab and its three turns, each the same size: ${rd4.n.join(", ")} texels, ${rd4.stray} anywhere else`);
R.is(rd8.used && even(rd8), `    …and with Symmetry on as well, eight: ${rd8.n.join(", ")} texels, ${rd8.stray} anywhere else`);
const PO = o.posed;
R.is(PO.on.used && PO.on.n > 500 && Math.hypot(PO.on.cx - PO.off.cx, PO.on.cy - PO.off.cy) <= 3,
  `a part posed by its mesh's matrix — moved 0.9 m and turned 0.6 rad — takes the dab where it is: ${PO.on.n} texels about (${PO.on.cx.toFixed(1)}, ${PO.on.cy.toFixed(1)}), where the UV-space brush's are about (${PO.off.cx.toFixed(1)}, ${PO.off.cy.toFixed(1)})`);
const CO = o.cost;
R.is(CO.one.used && CO.sixteen.used && CO.again.used && CO.one.grids === 1 && CO.sixteen.grids === 0 && CO.again.grids === 0,
  `a 320 000-triangle part's grid is made once, for the stroke itself and for Radial 8 with the mirror's 16 copies (${CO.one.grids}, ${CO.sixteen.grids}, ${CO.again.grids} made) — strokes of ${CO.one.ms}, ${CO.sixteen.ms} and ${CO.again.ms} ms here`);
R.is(o.bind.fresh && o.bind.again, `the islands' coverage is drawn again once Parts ▸ bind… adds a part to the sheet (${o.bind.fresh}), and kept while nothing changes (${o.bind.again})`);
R.is(Math.abs(o.into.x + 20) < 1e-6 && o.into.p === .5 && o.into.same,
  `a Shift+click line from 51 367 px off the view is walked from where it comes into it (x ${o.into.x}), its pressure kept; one starting inside is left alone (${o.into.same})`);
const AL = o.along;
R.is(AL.hue.used && AL.hue.hues >= 4, `Colour along: with the switch on, a Hue stroke lays several hues along its length (${AL.hue.hues} distinct along its row)`);
R.is(AL.off.used && AL.off.hues === 1, `    …and with it Off, one ink (${AL.off.hues}; hash ${AL.off.hash}, the same before the change)`);
R.is(!o.retouch.used && !o.retouch.would && o.retouch.said.some(s => /Retouch reads/.test(s)),
  `Retouch paints the old way as well, and says so under its own name, before a stroke too: ${JSON.stringify(o.retouch.said)}`);
const IS = o.islands;
R.is(IS.on.used && IS.on.a > 300 && IS.on.b === 0,
  `6.5: a dab on one island of a part leaves its other island, beside it on the sheet and 1.2 m away on the model, untouched (${IS.on.b} texels; ${IS.on.a} on its own)`);
R.is(!IS.off.used && IS.off.b > 0, `    …where the UV-space brush's disc runs onto it (${IS.off.b} texels)`);
R.is(!o.clone.used && o.clone.painted > 100 && o.clone.said.some(s => /Clone/.test(s)),
  `the Clone paints the old way (${o.clone.painted} texels) and says why: ${JSON.stringify(o.clone.said)}`);
R.finish();
