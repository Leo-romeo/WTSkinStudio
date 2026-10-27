// The brush cursor is the outline of the dab it lays (ROADMAP 3.41 (2)).
//
// WHY THIS EXISTS. The cursor was a circle for every tip but the Square (on the sheet) and a circle for
// every tip on the model, so a Chip, a Rivet or a loaded image showed nothing of its shape or its Angle
// before the stroke. It is now each tip's coverage traced at half (`Tips.outline`), at its size and
// angle, in both views, and on the model in the frame the dab is drawn in: on the surface along the
// sheet's own axes for the UV-space brush, facing the camera for the projected one, whose dab is a
// footprint on the screen (item 12). Each check holds the cursor to the dab the brush then lays, by
// the Hausdorff distance between the cursor's line and the dab's own edge at half its peak:
//
//   1. on the sheet — a hard Round, a Square turned 30°, a Chip, and an L-shaped image tip turned 30°;
//   2. on the model with the UV-space brush, on a plate whose UVs run at right angles to the world, the
//      L tip turned 30° — its outline laid along the sheet's axes, not just facing the surface;
//   3. on the model with the projected brush, on a plate turned 60° from the camera, the Round and the L
//      — the ring faces the camera, so it is the screen circle the projected dab paints, not a circle
//      laid on the surface (half the size along the tilt);
//   4. mid-stroke with Follow on, the projected ring turns with the stroke, and is placed from the
//      stroke's pre-pass: the stroke's moves raycast nothing.
//
// 1 for the Chip and the L, 2 and 3 fail on the cursor this replaced.
//
// Usage: node tools/t160_tipcursor.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var N = 256, el = document.getElementById("view3d");
  var mesh = function(name, tris){
    var n = tris.length * 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), k = 0;
    tris.forEach(function(t){ t.forEach(function(v){ pos.set(v[0], k * 3); nrm.set(v[1], k * 3); uv.set(v[2], k * 2); k++; }); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = name; m.userData = { mat: "m150" };
    return { gd: { name: name, mat: "m150", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  // a plate from a point function P(a, b) → [position, normal, uv] over a, b in [−1, 1]
  var plate = function(P){ var a = P(-1, -1), b = P(1, -1), c = P(1, 1), d = P(-1, 1); return [[a, b, d], [b, c, d]]; };
  var group = null, s = null, L = null;
  var setup = function(parts, opts){
    if (group) scene.remove(group);
    group = new THREE.Group(); parts.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
    var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
    s = { id: "t160", cStem: "t160", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
          baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
    App.slots = new Map([["t160", s]]); App.activeSlot = s;
    App.geomData = parts.map(function(q){ return q.gd; });
    App.meshes = new Map(parts.map(function(q){ return [q.mesh.name, q.mesh]; }));
    App.matSlot = new Map([["m150", "t160"]]);
    App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 2, y: 2, z: 1 };
    modelGroup = group;
    document.getElementById("symOn").checked = false;
    document.getElementById("optFlipV").checked = false;
    setPlacing(false);
    if (!App.paint3d) setPaint3d(true);
    cam.fly = false; cam.glide = null; cam.target.set(0, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 3;
    resize3D(); syncCamera();
    setBrushMode("color");
    var b = App.brush;
    b.color = "#c86432"; b.opacity = 1; b.flow = 1; b.build = false; b.size = opts.size || 48; b.hardness = 1; b.spacing = .15;
    b.tip = opts.tip || "round"; b.angle = opts.angle || 0; b.sizeJit = b.flowJit = b.scatter = b.angleJit = 0; b.follow = !!opts.follow; b.lazy = 0;
    b.proj3d = !!opts.proj;
    brushStamp._key = null;
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.undoStack.length = 0; App.redoStack.length = 0;
  };
  var pe = function(type, x, y){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse" }); };
  var px = function(c){ return ctx2d(c || L.canvas).getImageData(0, 0, N, N).data; };
  // The dab's edge: texel centres at or over half its peak alpha with a 4-neighbour under it.
  var edge = function(d, W, H){
    var peak = 0, out = [];
    for (var i = 3; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
    var t = peak / 2, a = function(x, y){ return x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]; };
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++)
      if (a(x, y) >= t && (a(x - 1, y) < t || a(x + 1, y) < t || a(x, y - 1) < t || a(x, y + 1) < t)) out.push([x + .5, y + .5]);
    return out;
  };
  var far = function(A, B){
    var w = 0;
    for (var i = 0; i < A.length; i++) {
      var m = Infinity;
      for (var j = 0; j < B.length; j++) { var dx = A[i][0] - B[j][0], dy = A[i][1] - B[j][1], q = dx * dx + dy * dy; if (q < m) m = q; }
      if (m > w) w = m;
    }
    return Math.sqrt(w);
  };
  var haus = function(A, B){ return A.length && B.length ? Math.round(Math.max(far(A, B), far(B, A)) * 100) / 100 : -1; };
  // an L, as an image tip: black on white, 60 × 40, its long bar along the top and its foot down the left
  var Lc = mkCanvas(60, 40), lg = ctx2d(Lc);
  lg.fillStyle = "#fff"; lg.fillRect(0, 0, 60, 40); lg.fillStyle = "#000"; lg.fillRect(4, 4, 52, 10); lg.fillRect(4, 4, 12, 32);
  var Lid = await Tips.add(Tips.fromImage(lg.getImageData(0, 0, 60, 40).data, 60, 40), "t160 L");

  // ---- 1. on the sheet ----
  setup([], {});
  var was = { cursor: v2.cursor, lazy: v2.lazy, sc: v2.sc };
  var sheet = function(tip, angle){
    var b = App.brush; b.tip = tip; b.angle = angle; b.hardness = 1; b.size = 48; brushStamp._key = null;
    v2.cursor = { x: 100, y: 120 }; v2.lazy = null; v2.sc = 1;
    var c = mkCanvas(N, N); Draw2D.ring(ctx2d(c));
    var cd = px(c), line = [];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (cd[(y * N + x) * 4 + 3] > 100) line.push([x + .5, y + .5]);
    L = LayerNode.of({ type: "paint", name: "p" + tip, canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    beginStroke(false, false); stroke.p = 1; stampAt(100, 120, 0); endStroke();
    return { far: haus(line, edge(px(), N, N)), line: line.length };
  };
  out.sheet = { round: sheet("round", 0), square: sheet("square", 30), chip: sheet("chip", 0), L: sheet(Lid, 30) };
  v2.cursor = was.cursor; v2.lazy = was.lazy; v2.sc = was.sc;

  // The ring's outline (or, for the Round, its outer edge) as world points.
  var ringPts = function(){
    var r = brushRing, pts = [];
    r.updateMatrixWorld(true);
    var src = r.children[2] && r.children[2].visible ? r.children[2] : r.children[0];     // (the cursor before 3.41 (2) had only rings)
    var P = src.geometry.attributes.position;
    for (var i = 0; i < P.count; i++) {
      var v = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
      if (src === r.children[0] && Math.hypot(v.x, v.y) < .99) continue;     // the ring's inner rim
      pts.push(src.localToWorld(v));
    }
    return pts;
  };
  var at = function(w){ var q = worldToScreen(w); return { clientX: q.x, clientY: q.y }; };
  var dab = function(w){
    var q = worldToScreen(w);
    el.dispatchEvent(pe("pointermove", q.x, q.y)); el.dispatchEvent(pe("pointerdown", q.x, q.y));
    var used = !!(stroke && stroke.pj);
    el.dispatchEvent(pe("pointerup", q.x, q.y));
    return used;
  };

  // ---- 2. the UV-space brush on a plate whose UVs run at right angles to the world ----
  // u = (y + 1) / 2, v = (x + 1) / 2: sheet (tx, ty) = ((y + 1) / 2, (1 − x) / 2) × 256, 128 texels a metre.
  setup([mesh("rot", plate(function(x, y){ return [[x, y, 0], [0, 0, 1], [(y + 1) / 2, (x + 1) / 2]]; }))], { tip: Lid, angle: 30 });
  var p2 = new THREE.Vector3(.1, .05, 0);
  updateBrushRing(at(p2));
  var r2 = ringPts().map(function(w){ return [(w.y + 1) / 2 * N, (1 - w.x) / 2 * N]; });
  var used2 = dab(p2);
  out.uv = { used: used2, far: haus(r2, edge(px(), N, N)), pts: r2.length };

  // ---- 3. the projected brush on a plate turned 60° from the camera ----
  var th = Math.PI / 3, cs = Math.cos(th), sn = Math.sin(th);
  var tilt = function(x, t){ return [[x, t * cs, -t * sn], [0, sn, cs], [(x + 1) / 2, (t + 1) / 2]]; };
  // a ring point → the plate along the camera's ray through it → the sheet
  var onPlate = function(w){
    var E = camera.position.clone(), D = w.clone().sub(E), n = new THREE.Vector3(0, sn, cs);
    var X = E.clone().addScaledVector(D, -n.dot(E) / n.dot(D)), t = X.y / cs;
    return [(X.x + 1) / 2 * N, (1 - (t + 1) / 2) * N];
  };
  var proj = function(tip, angle){
    setup([mesh("tilt", plate(tilt))], { tip: tip, angle: angle, proj: true });
    var p3 = new THREE.Vector3(.05, 0, 0);
    updateBrushRing(at(p3));
    var r3 = ringPts().map(onPlate);
    var used = dab(p3);
    return { used: used, far: haus(r3, edge(px(), N, N)), pts: r3.length };
  };
  out.proj = { round: proj("round", 0), L: proj(Lid, 30) };
  // …and with the switch on but a Clone in hand, which the projected brush refuses, the ring lies on
  // the surface as the Clone paints, not facing the camera
  setup([mesh("tilt", plate(tilt))], { tip: Lid, angle: 30, proj: true });
  setBrushMode("clone"); App.brush.proj3d = true;
  updateBrushRing(at(new THREE.Vector3(.05, 0, 0)));
  var zr = new THREE.Vector3(0, 0, 1).applyQuaternion(brushRing.quaternion);
  out.cloneRing = Math.abs(zr.dot(new THREE.Vector3(0, sn, cs)));
  // …and so does Retouch's, which reads the sheet the Clone's way (fix plan 2026-10-23, step 4)
  setBrushMode("retouch"); App.brush.proj3d = true;
  updateBrushRing(at(new THREE.Vector3(.05, 0, 0)));
  zr = new THREE.Vector3(0, 0, 1).applyQuaternion(brushRing.quaternion);
  out.retouchRing = Math.abs(zr.dot(new THREE.Vector3(0, sn, cs)));
  setBrushMode("color");

  // ---- 4. mid-stroke, Follow on: the projected ring turns with the stroke and is not raycast ----
  setup([mesh("plate", plate(function(x, y){ return [[x, y, 0], [0, 0, 1], [(x + 1) / 2, (y + 1) / 2]]; }))], { tip: Lid, angle: 30, proj: true, follow: true, size: 24 });
  var a4 = worldToScreen(new THREE.Vector3(-.4, -.1, 0)), b4 = worldToScreen(new THREE.Vector3(.4, .3, 0));
  el.dispatchEvent(pe("pointermove", a4.x, a4.y)); el.dispatchEvent(pe("pointerdown", a4.x, a4.y));
  var keepRay = window.ray3d, rays = 0;
  window.ray3d = function(){ rays++; return keepRay.apply(this, arguments); };
  for (var i = 1; i <= 8; i++) el.dispatchEvent(pe("pointermove", a4.x + (b4.x - a4.x) * i / 8, a4.y + (b4.y - a4.y) * i / 8));
  window.ray3d = keepRay;
  var head = stroke && stroke.pj ? stroke.pj.head : null, rot = brushRing.children[2] ? brushRing.children[2].rotation.z : null;
  el.dispatchEvent(pe("pointerup", b4.x, b4.y));
  out.follow = { head: head, rot: rot, want: head == null ? null : head + Math.PI / 6, rays: rays,
                 heading: Math.atan2(b4.y - a4.y, b4.x - a4.x) };
  scene.remove(group); hideBrushRing();
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep"),
  chromeArgs: ["--window-size=1280,960"] });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
console.log("  " + JSON.stringify({ sheet: o.sheet, uv: o.uv, proj: o.proj, follow: o.follow }));
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
for (const [k, label] of [["round", "a hard Round"], ["square", "a Square turned 30°"], ["chip", "a Chip"], ["L", "an L-shaped image tip turned 30°"]]) {
  const x = o.sheet[k];
  R.is(x.line > 50 && x.far >= 0 && x.far <= 2.5, `1. on the sheet, ${label}: the cursor is the dab's edge within ${x.far} texels (2.5)`);
}
R.is(!o.uv.used && o.uv.far >= 0 && o.uv.far <= 2.5,
  `2. the UV-space brush on UVs at right angles to the world: the L's outline on the model is the dab it lays on the sheet within ${o.uv.far} texels (2.5)`);
for (const [k, label] of [["round", "the Round"], ["L", "the L turned 30°"]]) {
  const x = o.proj[k];
  R.is(x.used && x.far >= 0 && x.far <= 3,
    `3. the projected brush on a plate turned 60°, ${label}: the ring, facing the camera, is the dab it lays within ${x.far} texels (3; a ring laid on the surface is half the dab along the tilt)`);
}
R.is(o.retouchRing > .999, `   …and with Retouch in hand, which paints the old way too (|n · z| ${o.retouchRing.toFixed(4)})`);
R.is(o.cloneRing > .999, `   …but with a Clone in hand, which paints the old way, the ring lies on the surface (|n · z| ${o.cloneRing.toFixed(4)})`);
const F = o.follow, dAng = F.want == null ? Infinity : Math.abs(Math.atan2(Math.sin(F.rot - F.want), Math.cos(F.rot - F.want)));
R.is(F.head != null && dAng < 1e-6 && Math.abs(Math.atan2(Math.sin(F.head - F.heading), Math.cos(F.head - F.heading))) < .05,
  `4. mid-stroke with Follow on, the projected ring turns with the stroke: its Angle plus the stroke's heading (${F.rot && F.rot.toFixed(3)} against ${F.want && F.want.toFixed(3)})`);
R.is(F.rays === 0, `   …and is placed from the stroke's pre-pass: the stroke's moves raycast nothing (${F.rays})`);
R.finish();
