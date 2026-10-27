// The projected 3-D brush, click by click (ROADMAP 1.19 (e): the owner's feel check of 2026-10-24).
//
// WHY THIS EXISTS. The owner's first paint with the projected brush, on the f_111f (his recording
// `Issues examples/wtss-session-2026-10-24T16-07-10.json`, six single clicks, size 400, spacing 5 %),
// found two things t158 never could, because every case there paints ONE stroke on geometry made for it:
//   (1) "black color is painted on a very small portion of the flap not painting the wing itself even
//       tho the click itself was on a wing" — a click on part A painted a sliver of part B beside it;
//   (2) "spacing makes it not apply the first stroke sometimes" — stroke 5 of the recording had a
//       pre-pass and a triangle search and no draw at all: a click that painted nothing.
// Both were one bug. A part's triangle grid (`ProjBrush.grid`) is made once and KEPT, with a `seen`
// mark per triangle so a dab's query visits each triangle once; the mark was the stroke's own counter,
// which starts again at 1 on every stroke. So the first part a new stroke queries is queried under the
// same mark the last stroke left on it, and every triangle the last stroke had looked at is skipped as
// already seen. A click near the last one painted only what the last one had not reached (the flap's
// sliver); a click on the same spot painted nothing.
//
// This drives the real viewport with pointer events over two parts that keep their geometry from
// stroke to stroke, as a loaded vehicle does: a wing (A) and a flap (B) hinged beside it, each its own
// island. Each click is a new colour, and each check reads the layer's pixels:
//   1. a click on the wing whose ring does not reach the flap paints the wing under the ring and
//      nothing on the flap;
//   2. a click on the wing beside the hinge, after it, paints EVERY texel under the ring on both
//      parts, and nothing outside it (the bug: the flap's part only);
//   3. the same click again paints the same disc in its own colour, as one undo step (the bug: nothing);
//   4. six clicks in a row round the hinge at Spacing 5 %, the owner's sequence, each paint their own
//      disc whole;
// and slice (e)'s own: the brush is on by default, its facing limit is a slider under More brush
// options at 85°, and the limit decides how steep a surface takes paint; a click on a panel of two
// triangles snapshots the dab's tile and not the panel's 64 (the window is clipped to the dabs,
// `ProjBrush.clipUV`), and that clip's UV box holds under strong perspective (the review's ask: a
// screen-linear UV misses every sampled point by 0.36); a stored "off" from before settings version 5
// comes back on, a later one stays off.
//
// Usage: node tools/t165_projclick.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var el = document.getElementById("view3d");
  // before anything here sets it: what a fresh page starts with
  out.boot = { on: !!App.brush.proj3d, box: document.getElementById("brushProj").checked,
    face: App.brush.face, slider: (function(){ var s = document.getElementById("brushFace"); return s ? { v: +s.value, min: +s.min, max: +s.max,
      inAdv: !!s.closest("details.adv") } : null; })() };
  var mesh = function(name, tris){            // tris: [[p, n, uv] × 3, …]
    var n = tris.length * 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), k = 0;
    tris.forEach(function(t){ t.forEach(function(v){ pos.set(v[0], k * 3); nrm.set(v[1], k * 3); uv.set(v[2], k * 2); k++; }); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = name; m.userData = { mat: "m165" };
    return { gd: { name: name, mat: "m165", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  // A quad facing n, corners a b c d (counter-clockwise from outside), UVs ua … ud.
  var quad = function(a, b, c, d, n, ua, ub, uc, ud){
    var P = function(p, u){ return [p, n, u]; };
    return [[P(a, ua), P(b, ub), P(d, ud)], [P(b, ub), P(c, uc), P(d, ud)]];
  };
  var group = null, s = null, L = null;
  // The wing: x −1 … 0, y −0.5 … 0.5, u 0 … 0.5, v 0 … 0.5 (128 texels a metre). The flap beside it,
  // hinged on x = 0: x 0 … 0.5, u 0.5 … 0.75. Both in z = 0 facing the camera on +z, 3 m away.
  var parts = null;
  var scene1 = function(){
    var Z = [0, 0, 1];
    parts = [mesh("wing", quad([-1, -.5, 0], [0, -.5, 0], [0, .5, 0], [-1, .5, 0], Z, [0, 0], [.5, 0], [.5, .5], [0, .5])),
             mesh("flap", quad([0, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [0, .5, 0], Z, [.5, 0], [.75, 0], [.75, .5], [.5, .5]))];
    if (group) scene.remove(group);
    group = new THREE.Group(); parts.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
    var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
    s = { id: "t165", cStem: "t165", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
          baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
    App.slots = new Map([["t165", s]]); App.activeSlot = s;
    App.geomData = parts.map(function(q){ return q.gd; });
    App.meshes = new Map(parts.map(function(q){ return [q.mesh.name, q.mesh]; }));
    App.matSlot = new Map([["m165", "t165"]]);
    App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 2, y: 2, z: 1 };
    modelGroup = group;
    document.getElementById("symOn").checked = false;
    document.getElementById("optFlipV").checked = false;
    setPlacing(false);
    if (!App.paint3d) setPaint3d(true);
    cam.fly = false; cam.glide = null; cam.target.set(-.25, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 3;
    resize3D(); syncCamera();
    setBrushMode("color");
    var b = App.brush;
    b.opacity = 1; b.flow = 1; b.build = false; b.size = 32; b.hardness = 1; b.spacing = .05;
    b.tip = "round"; b.sizeJit = b.flowJit = b.scatter = b.angle = b.angleJit = 0; b.follow = false; b.lazy = 0;
    b.proj3d = true;
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.undoStack.length = 0; App.redoStack.length = 0;
  };
  var pe = function(type, x, y){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse", pressure: 0 }); };
  // One click at world point w, in colour hex: true when the projected brush took it.
  var click = function(w, hex){
    App.brush.color = hex; brushStamp._key = null;
    var sc = worldToScreen(new THREE.Vector3(w[0], w[1], w[2]));
    el.dispatchEvent(pe("pointermove", sc.x, sc.y));
    el.dispatchEvent(pe("pointerdown", sc.x, sc.y));
    var proj = !!(stroke && stroke.pj);
    el.dispatchEvent(pe("pointerup", sc.x, sc.y));
    return proj;
  };
  var RAD = 16 / 128, TX = 1 / 128;              // the ring's radius in metres (size 32 at 128 texels a metre), a texel
  // Every texel of the two islands against the disc of radius RAD about c: inside (by more than 2.5
  // texels — the tip is sampled from its mips, which soften a hard edge by a texel or two at this size,
  // measured 248–252 at 14.4 texels of 16) it must be exactly rgb, outside (by 1.5) it must not be.
  // Texel → model: the wing's u = (x + 1) / 2, the flap's u = 0.5 + x / 2,
  // both v = (y + 0.5) / 2, and the sheet's row 0 is v = 1.
  var disc = function(c, rgb){
    var d = ctx2d(L.canvas).getImageData(0, 0, N, N).data, r = { wingIn: 0, wingOk: 0, flapIn: 0, flapOk: 0, outside: 0, stray: 0 };
    for (var ty = 0; ty < N; ty++) for (var tx = 0; tx < N; tx++) {
      var u = (tx + .5) / N, v = 1 - (ty + .5) / N;
      if (v > .5 || u > .75) continue;
      var x = u < .5 ? 2 * u - 1 : 2 * (u - .5), y = 2 * v - .5, part = u < .5 ? "wing" : "flap";
      var i = (ty * N + tx) * 4, is = d[i + 3] === 255 && d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2];
      var dist = Math.hypot(x - c[0], y - c[1]);
      if (dist < RAD - 2.5 * TX) { r[part + "In"]++; if (is) r[part + "Ok"]++; }
      else if (dist > RAD + 1.5 * TX) { r.outside++; if (is) r.stray++; }
    }
    return r;
  };
  scene1();
  // ---- 1. a click on the wing, the ring well clear of the flap ----
  var c1 = [-.5, 0, 0];
  out.one = { used: click(c1, "#ff0000"), r: disc(c1, [255, 0, 0]) };
  // ---- 2. a click on the wing beside the hinge: the ring over both parts ----
  var c2 = [-.06, .02, 0];
  out.two = { used: click(c2, "#000000"), r: disc(c2, [0, 0, 0]) };
  // ---- 3. the same click again ----
  var steps = App.undoStack.length;
  out.three = { used: click(c2, "#0000ff"), r: disc(c2, [0, 0, 255]), steps: App.undoStack.length - steps };
  // ---- 4. the owner's sequence: six clicks round the hinge, each its own colour ----
  var seq = [[-.1, .1, 0], [-.05, .12, 0], [.02, .1, 0], [-.08, -.2, 0], [-.08, -.2, 0], [.05, -.18, 0]];
  var cols = [[255, 255, 0], [0, 255, 0], [0, 255, 255], [255, 0, 255], [128, 64, 0], [255, 255, 255]];
  out.seq = seq.map(function(c, k){
    var h = "#" + cols[k].map(function(v){ return (v < 16 ? "0" : "") + v.toString(16); }).join("");
    return { used: click(c, h), r: disc(c, cols[k]) };
  });
  // ---- 6. a click on a big panel of two triangles keeps the dab's tiles ----
  // A 2 m plate over the whole of a 2048² sheet (1 024 texels a metre), as a wing panel is two
  // triangles: a 64-texel click must snapshot the 256² tile under the dab, not the panel's 64. The dab
  // lands round texel (1331, 819): its edge is 19 texels inside tile (5, 3).
  var big = function(){
    var NB = 2048, Z = [0, 0, 1], flat = function(hex){ var c = mkCanvas(NB, NB), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, NB, NB); return c; };
    parts = [mesh("panel", quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], Z, [0, 0], [1, 0], [1, 1], [0, 1]))];
    if (group) scene.remove(group);
    group = new THREE.Group(); group.add(parts[0].mesh); scene.add(group); group.updateMatrixWorld(true);
    s = { id: "t165", cStem: "t165", layers: [], size: NB, sizeH: NB, missing: false, cEdited: true,
          baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
    App.slots = new Map([["t165", s]]); App.activeSlot = s;
    App.geomData = [parts[0].gd]; App.meshes = new Map([["panel", parts[0].mesh]]); modelGroup = group;
    cam.target.set(.3, .2, 0); syncCamera();
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(NB, NB), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.brush.size = 64;
    App.brush.color = "#ff0000"; brushStamp._key = null;
    var sc = worldToScreen(new THREE.Vector3(.3, .2, 0));
    el.dispatchEvent(pe("pointermove", sc.x, sc.y));
    el.dispatchEvent(pe("pointerdown", sc.x, sc.y));
    var used = !!(stroke && stroke.pj), tiles = stroke ? stroke.undo.touched.size : -1;
    el.dispatchEvent(pe("pointerup", sc.x, sc.y));
    // the dab: 32 texels round (1331, 819) on the sheet; count what it painted
    var d = ctx2d(L.canvas).getImageData(1331 - 48, 819 - 48, 96, 96).data, n = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] === 255) n++;
    App.brush.size = 32;
    return { used: used, tiles: tiles, painted: n };
  };
  // ---- 5. the facing limit decides how steep a surface takes paint ----
  // A plate turned 78° away from the camera about the y axis: inside a 60° limit it takes nothing,
  // at the default 85° (fading from 70°) some, at 89° (fading from 74°) more.
  var steep = function(deg){
    var a = 78 * Math.PI / 180, cx = Math.cos(a), sz = Math.sin(a), Z = [Math.sin(a), 0, Math.cos(a)];
    var P = function(x, y){ return [x * cx, y, -x * sz]; };
    parts = [mesh("steep", quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), Z, [0, 0], [1, 0], [1, 1], [0, 1]))];
    if (group) scene.remove(group);
    group = new THREE.Group(); group.add(parts[0].mesh); scene.add(group); group.updateMatrixWorld(true);
    App.geomData = [parts[0].gd]; App.meshes = new Map([["steep", parts[0].mesh]]); modelGroup = group;
    cam.target.set(0, 0, 0); syncCamera();
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.brush.face = deg; App.brush.size = 24;
    var used = click([0, 0, 0], "#ff0000"), d = ctx2d(L.canvas).getImageData(0, 0, N, N).data, sum = 0;
    for (var i = 3; i < d.length; i += 4) sum += d[i];
    return { used: used, sum: sum };
  };
  out.face = { lo: steep(60), mid: steep(85), hi: steep(89) };
  App.brush.face = 85;
  out.big = big();
  // ---- 7. the clip's UV box is right under perspective (review of 1.19e) ----
  // One big triangle of floor running away from a camera 1.6 m above it, seen nearly edge-on, where
  // the UV across the screen is far from linear. Points sampled on the triangle whose projection falls
  // inside a 40-px box must all have their UV inside the box clipUV gives, and the box must hug them.
  var persp = function(){
    var P = new Float32Array([-3, 0, -1, 3, 0, -1, 0, 0, -20]), U = new Float32Array([0, 0, 1, 0, .5, 1]);
    cam.target.set(0, 0, -6); cam.theta = Math.PI / 2; cam.phi = 1.3; cam.dist = 6; syncCamera();
    var pj = { cam: ProjBrush.camera(cnv3.getBoundingClientRect()) }, c = { gd: { position: P, uv: U }, xf: null };
    var scr = function(x, y, z){ var q = ProjBrush.clip(pj.cam, x, y, z); return [(q[0] / q[3] * .5 + .5) * pj.cam.W, (.5 - q[1] / q[3] * .5) * pj.cam.H]; };
    var at = scr(.4, 0, -9), s = { x0: at[0] - 20, y0: at[1] - 20, x1: at[0] + 20, y1: at[1] + 20 };
    var box = ProjBrush.clipUV(pj, c, 0, s), seen = { u0: 9, v0: 9, u1: -9, v1: -9 }, n = 0, outside = 0, k = 7;
    for (var i = 0; i < 40000; i++) {
      k = (k * 16807) % 2147483647; var a = k / 2147483647; k = (k * 16807) % 2147483647; var b = k / 2147483647;
      if (a + b > 1) { a = 1 - a; b = 1 - b; }
      var x = P[0] + a * (P[3] - P[0]) + b * (P[6] - P[0]), z = P[2] + a * (P[5] - P[2]) + b * (P[8] - P[2]);
      var p = scr(x, 0, z);
      if (p[0] < s.x0 || p[0] > s.x1 || p[1] < s.y0 || p[1] > s.y1) continue;
      var u = a * U[2] + b * U[4], v = a * U[3] + b * U[5];
      n++;
      if (u < box.u0 - 1e-6 || u > box.u1 + 1e-6 || v < box.v0 - 1e-6 || v > box.v1 + 1e-6) outside++;
      seen.u0 = Math.min(seen.u0, u); seen.u1 = Math.max(seen.u1, u); seen.v0 = Math.min(seen.v0, v); seen.v1 = Math.max(seen.v1, v);
    }
    var slack = Math.max(seen.u0 - box.u0, box.u1 - seen.u1, seen.v0 - box.v0, box.v1 - seen.v1);
    return { n: n, outside: outside, slack: +slack.toFixed(4), span: +(seen.v1 - seen.v0).toFixed(4) };
  };
  out.persp = persp();
  // ---- 8. the settings: a stored "off" from before the default changed is the old default ----
  var keepOn = App.brush.proj3d;
  resetPrefs(); applyPrefs({ v: 4, brush: { proj3d: false } }); var old = App.brush.proj3d;
  resetPrefs(); applyPrefs({ v: 5, brush: { proj3d: false } }); var chosen = App.brush.proj3d;
  resetPrefs(); applyPrefs({ v: 5, brush: { face: 60 } }); var face = App.brush.face;
  out.prefs = { old: old, chosen: chosen, face: face, blank: ProjBrush.faceOf(""), nul: ProjBrush.faceOf(null), str: ProjBrush.faceOf("70"), big: ProjBrush.faceOf(120) };
  resetPrefs(); App.brush.proj3d = keepOn;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAIL: " + r.reason); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("FAIL: page threw\n" + o.__threw); process.exit(1); }
console.log("\n=== the projected brush, click by click (ROADMAP 1.19 (e)) ===");
const B = o.boot;
R.is(B.on && B.box, `the projected brush is on in a fresh page (the setting ${B.on}, its box ${B.box})`);
R.is(B.face === 85 && B.slider && B.slider.v === 85 && B.slider.inAdv && B.slider.max <= 90 && B.slider.min >= 30,
  `its facing limit is a slider under More brush options at 85° (${JSON.stringify(B.slider)}, the setting ${B.face})`);
const whole = x => x.wingIn ? x.wingOk / x.wingIn : 1, wholeB = x => x.flapIn ? x.flapOk / x.flapIn : 1;
const one = o.one.r;
R.is(o.one.used && one.wingIn > 500 && one.wingOk === one.wingIn && one.flapIn === 0 && one.stray === 0,
  `1. a click on the wing with the ring clear of the flap paints every wing texel under it (${one.wingOk} of ${one.wingIn}) and nothing outside it (${one.stray})`);
const two = o.two.r;
R.is(o.two.used && two.wingIn > 200 && two.flapIn > 50 && two.wingOk === two.wingIn && two.flapOk === two.flapIn && two.stray === 0,
  `2. the next click, on the wing beside the hinge, paints every texel under the ring on the wing (${two.wingOk} of ${two.wingIn}) and on the flap (${two.flapOk} of ${two.flapIn}), nothing outside it (${two.stray})`);
const three = o.three.r;
R.is(o.three.used && three.wingOk === three.wingIn && three.flapOk === three.flapIn && three.wingIn > 200 && o.three.steps === 1,
  `3. the same click again paints the same disc in its own colour (${three.wingOk}/${three.wingIn} wing, ${three.flapOk}/${three.flapIn} flap), one undo step (${o.three.steps})`);
const bad = o.seq.map((q, k) => ({ k: k + 1, q })).filter(({ q }) => !q.used || whole(q.r) < 1 || wholeB(q.r) < 1 || q.r.stray > 0);
R.is(bad.length === 0,
  `4. six clicks in a row round the hinge at Spacing 5 %, two on one spot, each paint their whole disc: ` +
  o.seq.map(q => `${q.r.wingOk + q.r.flapOk}/${q.r.wingIn + q.r.flapIn}`).join(", "));
const BG = o.big;
R.is(BG.used && BG.painted > 2500 && BG.tiles === 1,
  `6. a 64-texel click on a panel of two triangles over a whole 2048² sheet snapshots ${BG.tiles} of its 64 tiles — the one the dab lies in, its edge 19 texels inside it — painting ${BG.painted} texels`);
const PS = o.persp;
R.is(PS.n > 200 && PS.outside === 0 && PS.slack <= .01,
  `7. on a floor seen nearly edge-on, every one of ${PS.n} points under a 40-px box has its UV inside the box clipUV gives (${PS.outside} outside), which hugs them within ${PS.slack} of UV (≤ 0.01: random points come near the box's corners, not onto them; their v spans ${PS.span}, and screen-linear UV misses every one by 0.36)`);
const PF = o.prefs;
R.is(PF.old === true && PF.chosen === false && PF.face === 60 && PF.blank === 85 && PF.nul === 85 && PF.str === 70 && PF.big === 90,
  `8. a stored "off" from before settings version 5 is the old default and comes back on (${PF.old}); one from version 5 is a choice and stays (${PF.chosen}); the facing limit restores (${PF.face}), blank or null is 85 (${PF.blank}, ${PF.nul}), "70" is 70, 120 is 90`);
const F = o.face;
R.is(F.lo.used && F.mid.used && F.hi.used && F.lo.sum === 0 && F.mid.sum > 0 && F.hi.sum > F.mid.sum * 1.5,
  `5. a plate turned 78° from the camera takes nothing under a 60° facing limit (${F.lo.sum}), some at 85° (${F.mid.sum}) and more at 89° (${F.hi.sum}) — alpha summed`);
if ((o.__errs || []).length || (o.__rejs || []).length) R.bad("page errors: " + JSON.stringify([o.__errs, o.__rejs]).slice(0, 400));
R.finish();
