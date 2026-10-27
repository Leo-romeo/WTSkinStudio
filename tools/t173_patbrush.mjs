// The pattern brush: a stroke on the model reveals whole cells of a lattice (ROADMAP 4.55, queue item 27).
//
// WHY THIS EXISTS. The owner's honeycomb on the Ho 229 (`Issues examples/2026-10-21_ho229_holo_*.webp`)
// was masked and painted cell by cell. 4.55a made the lattice a fill; this is the brush that reveals
// it — "hexagon after hexagon in perfectly aligned order, like honeycomb" — where a stroke passes: a
// cell the brush reaches is laid WHOLE, past the ring if it runs past it, and the lattice lies in model
// space, so a cell over a part seam is one cell on both parts. Checked against geometry the test
// computes itself, on t165's wing and flap (two islands hinged at x = 0, facing the camera):
//   1. a click on the wing lays every texel of each hexagon whose centre is under the ring, in the fill
//      colour, and leaves every texel of every other hexagon alone — some of the laid texels lie past
//      the ring (whole cells), none of the untouched ones inside a revealed cell;
//   2. a click by the hinge lays the hexagon that straddles it on both parts, whole;
//   3. with a border, a revealed cell's inside is the fill, its border — shared with its unrevealed
//      neighbours too — is the border colour, and nothing past the border is touched;
//   4. squares at an angle of 0: the same rule on a lattice whose cells sit on whole texels, exactly;
//   5. each click is one undo step; with the projected brush off, or on the sheet, a pattern stroke is
//      refused in words and paints nothing (it is never laid as plain dabs of the brush colour);
//   6. the owner map (`Procedural.latticeOwners`): every texel of every shape's tile owned, a cell's
//      inside by one cell, a shared border by two, and the record clamped.
//
// Usage: node tools/t173_patbrush.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var el = document.getElementById("view3d");
  var mesh = function(name, tris){
    var n = tris.length * 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), k = 0;
    tris.forEach(function(t){ t.forEach(function(v){ pos.set(v[0], k * 3); nrm.set(v[1], k * 3); uv.set(v[2], k * 2); k++; }); });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide }));
    m.name = name; m.userData = { mat: "m173" };
    return { gd: { name: name, mat: "m173", position: pos, normal: nrm, uv: uv }, mesh: m };
  };
  var quad = function(a, b, c, d, n, ua, ub, uc, ud){
    var P = function(p, u){ return [p, n, u]; };
    return [[P(a, ua), P(b, ub), P(d, ud)], [P(b, ub), P(c, uc), P(d, ud)]];
  };
  // t165's scene: the wing x −1 … 0 (u 0 … 0.5), the flap x 0 … 0.5 (u 0.5 … 0.75), y −0.5 … 0.5
  // (v 0 … 0.5), 128 texels a metre, in z = 0 facing the camera on +z, 3 m away.
  var group = null, s = null, L = null, parts = null;
  var scene1 = function(){
    var Z = [0, 0, 1];
    parts = [mesh("wing", quad([-1, -.5, 0], [0, -.5, 0], [0, .5, 0], [-1, .5, 0], Z, [0, 0], [.5, 0], [.5, .5], [0, .5])),
             mesh("flap", quad([0, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [0, .5, 0], Z, [.5, 0], [.75, 0], [.75, .5], [.5, .5]))];
    if (group) scene.remove(group);
    group = new THREE.Group(); parts.forEach(function(q){ group.add(q.mesh); }); scene.add(group); group.updateMatrixWorld(true);
    var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
    s = { id: "t173", cStem: "t173", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
          baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
    App.slots = new Map([["t173", s]]); App.activeSlot = s;
    App.geomData = parts.map(function(q){ return q.gd; });
    App.meshes = new Map(parts.map(function(q){ return [q.mesh.name, q.mesh]; }));
    App.matSlot = new Map([["m173", "t173"]]);
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
    b.opacity = 1; b.flow = 1; b.build = false; b.size = 64; b.hardness = 1; b.spacing = .05; b.color = "#00ff00";
    b.tip = "round"; b.sizeJit = b.flowJit = b.scatter = b.angle = b.angleJit = 0; b.follow = false; b.lazy = 0; b.cycle = "off";
    b.proj3d = true; brushStamp._key = null;
    L = LayerNode.of({ type: "paint", name: "p", canvas: mkCanvas(N, N), visible: true, opacity: 1, blend: "normal" });
    s.layers = [L]; App.activeLayer = L;
    App.undoStack.length = 0; App.redoStack.length = 0;
  };
  var pe = function(type, x, y){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse", pressure: 0 }); };
  var click = function(w){
    var sc = worldToScreen(new THREE.Vector3(w[0], w[1], w[2]));
    el.dispatchEvent(pe("pointermove", sc.x, sc.y));
    el.dispatchEvent(pe("pointerdown", sc.x, sc.y));
    var proj = !!(stroke && stroke.pj);
    el.dispatchEvent(pe("pointerup", sc.x, sc.y));
    return proj;
  };
  var RAD = 32 / 128, TX = 1 / 128, S3 = Math.sqrt(3);
  // Texel → model, t165's: the wing's u = (x + 1) / 2, the flap's u = 0.5 + x / 2, both v = (y + 0.5) / 2,
  // the sheet's row 0 at v = 1. Null off both islands.
  var place = function(tx, ty){
    var u = (tx + .5) / N, v = 1 - (ty + .5) / N;
    if (v > .5 || u > .75) return null;
    return { x: u < .5 ? 2 * u - 1 : 2 * (u - .5), y: 2 * v - .5, part: u < .5 ? "wing" : "flap" };
  };
  // The lattice where the brush lays it on a face looking along +z (Procedural.evalTri): (u, v) = (x, −y),
  // over the tile's size. Hexagons (pointy-top, side 1, a tile √3 wide): in cell units (X, Y) =
  // (x, −y) · √3 / size, centres at (i√3, 3j) and (√3/2 + i√3, 1.5 + 3j), each the Voronoi cell of its
  // centre. Returns the cell's centre in metres (x, y) and how far the point is inside its edge, in cell units.
  var hexOf = function(x, y, size){
    var X = x * S3 / size, Y = -y * S3 / size, best = null;
    var j0 = Math.floor(Y / 3), i0 = Math.floor(X / S3);
    for (var j = j0 - 1; j <= j0 + 1; j++) for (var i = i0 - 1; i <= i0 + 1; i++)
      [[i * S3, 3 * j], [S3 / 2 + i * S3, 1.5 + 3 * j]].forEach(function(c){
        var d = Math.hypot(X - c[0], Y - c[1]);
        if (!best || d < best.d) best = { d: d, c: c };
      });
    var dx = X - best.c[0], dy = Y - best.c[1], m = 0;
    for (var k = 0; k < 3; k++) { var a = k * Math.PI / 3; m = Math.max(m, Math.abs(dx * Math.cos(a) + dy * Math.sin(a))); }
    return { cx: best.c[0] * size / S3, cy: -best.c[1] * size / S3, edge: S3 / 2 - m, key: best.c[0].toFixed(3) + "," + best.c[1].toFixed(3) };
  };
  // Squares (side 1 = the tile): cells on whole multiples of size, the centre half a cell in.
  var sqOf = function(x, y, size){
    var X = x / size, Y = -y / size, cx = (Math.floor(X) + .5) * size, cy = -(Math.floor(Y) + .5) * size;
    return { cx: cx, cy: cy, edge: .5 - Math.max(Math.abs(X - Math.floor(X) - .5), Math.abs(Y - Math.floor(Y) - .5)), key: Math.floor(X) + "," + Math.floor(Y) };
  };
  // ...and turned by ang degrees: (ru, rv) = (u cos + v sin, v cos − u sin), the cell whole multiples
  // of size in that frame, its centre turned back.
  var sqTurned = function(ang){
    var a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    return function(x, y, size){
      var u = x, v = -y, ru = (u * ca + v * sa) / size, rv = (v * ca - u * sa) / size, fu = Math.floor(ru), fv = Math.floor(rv);
      var cu = (fu + .5) * size, cv = (fv + .5) * size, uu = cu * ca - cv * sa, vv = cu * sa + cv * ca;
      return { cx: uu, cy: -vv, edge: .5 - Math.max(Math.abs(ru - fu - .5), Math.abs(rv - fv - .5)), key: fu + "," + fv };
    };
  };
  var pix = function(){ return ctx2d(L.canvas).getImageData(0, 0, N, N).data; };
  var eq = function(d, i, c){ return d[i + 3] === 255 && Math.abs(d[i] - c[0]) <= 2 && Math.abs(d[i + 1] - c[1]) <= 2 && Math.abs(d[i + 2] - c[2]) <= 2; };
  // Every texel against the cells a click at c reveals: those whose centre is under the ring (a cell
  // within 3 % of the ring's edge either way is not judged — the tip's edge is a texel soft).
  // Without a border a revealed cell is all fill and any other untouched. Texels within 1.5 texels of a
  // cell's edge are not judged (the tile's own antialiasing). With a border hw (cell units), a texel
  // of a revealed cell further than hw in is fill, one within hw of the edge border; a texel of another
  // cell is border within hw of a revealed neighbour's edge, else untouched.
  var judge = function(c, cellOf, size, unit, hw, F, B){
    var d = pix(), r = { revealed: {}, cellsIn: 0, fillIn: 0, fillOk: 0, bordIn: 0, bordOk: 0, other: 0, stray: 0, past: 0, wing: 0, flap: 0, wrong: [] };
    var mt = 1.5 * TX / unit;                                  // 1.5 texels in cell units
    for (var ty = 0; ty < N; ty++) for (var tx = 0; tx < N; tx++) {
      var p = place(tx, ty);
      if (!p) continue;
      var q = cellOf(p.x, p.y, size), cd = Math.hypot(q.cx - c[0], q.cy - c[1]), i = (ty * N + tx) * 4;
      if (Math.abs(cd - RAD) < .03 * RAD) continue;
      var rev = cd < RAD;
      // across a shared edge: the neighbour over it, mirrored through the edge (good for the judged band)
      if (rev) {
        r.revealed[q.key] = true;
        if (q.edge > hw + mt) { r.fillIn++; if (eq(d, i, F)) r.fillOk++; else if (r.wrong.length < 4) r.wrong.push([tx, ty, d[i], d[i+1], d[i+2], d[i+3], "fill"]); }
        else if (hw > 0 && q.edge > mt && q.edge < hw - mt) { r.bordIn++; if (eq(d, i, B)) r.bordOk++; else if (r.wrong.length < 4) r.wrong.push([tx, ty, d[i], d[i+1], d[i+2], d[i+3], "border"]); }
        if (d[i + 3] && Math.hypot(p.x - c[0], p.y - c[1]) > RAD + 1.5 * TX) r.past++;
        if (d[i + 3]) r[p.part]++;
      } else if (q.edge > hw + mt) { r.other++; if (d[i + 3]) { r.stray++; if (r.wrong.length < 4) r.wrong.push([tx, ty, d[i], d[i+1], d[i+2], d[i+3], "stray"]); } }
    }
    r.cells = Object.keys(r.revealed).length; delete r.revealed;
    return r;
  };
  var pat = function(o){ BrushPanel.setPattern(Object.assign({ kind: "hex", fill: "#ff0000", border: "#0000ff", width: .08, fillOn: true, borderOn: false, size: .3, angle: 0 }, o)); };
  var clear = function(){ ctx2d(L.canvas).clearRect(0, 0, N, N); App.undoStack.length = 0; };
  scene1();
  // ---- 1. a click on the wing: hexagons, no border ----
  pat({});
  var c1 = [-.55, .05, 0], hexU = .3 / S3;
  var steps = App.undoStack.length, used1 = click(c1);
  out.one = { used: used1, steps: App.undoStack.length - steps, r: judge(c1, hexOf, .3, hexU, 0, [255, 0, 0]) };
  // ---- 2. by the hinge: the hexagon centred on x = 0 straddles both parts ----
  clear();
  var c2 = [-.02, 0, 0];
  out.two = { used: click(c2), r: judge(c2, hexOf, .3, hexU, 0, [255, 0, 0]) };
  // ---- 3. with a border ----
  clear();
  pat({ borderOn: true, width: .3 });
  var c3 = [-.5, -.05, 0];
  out.three = { used: click(c3), r: judge(c3, hexOf, .3, hexU, .15, [255, 0, 0], [0, 0, 255]) };
  // ---- 4. squares on whole texels ----
  clear();
  pat({ kind: "square", size: .125 });
  var c4 = [-.47, .03, 0];
  out.four = { used: click(c4), r: judge(c4, sqOf, .125, .125, 0, [255, 0, 0]) };
  // ---- 4b. the same squares turned 30° (the review's ask: Angle had no case) ----
  clear();
  pat({ kind: "square", size: .125, angle: 30 });
  out.turned = { used: click(c4), r: judge(c4, sqTurned(30), .125, .125, 0, [255, 0, 0]) };
  // ---- 5. refused where it cannot be revealed ----
  clear();
  pat({});
  App.brush.proj3d = false;
  var u5 = click(c1), st5 = document.getElementById("status") ? document.getElementById("status").textContent : "";
  var d5 = pix(), n5 = 0;
  for (var i = 3; i < d5.length; i += 4) if (d5[i]) n5++;
  App.brush.proj3d = true;
  var sheet = beginStroke(false, false), st6 = document.getElementById("status") ? document.getElementById("status").textContent : "";
  out.five = { used: u5, painted: n5, steps: App.undoStack.length, msg: st5, sheet: sheet, open: !!stroke, msg2: st6 };
  pat({ kind: "off" });
  out.off = { used: click(c1), painted: (function(){ var d = pix(), n = 0; for (var i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })() };
  // ---- 6. the owner map ----
  var own = {};
  Procedural.LATTICE.forEach(function(k){
    var M = Procedural.latticeOwners(k, .1, 128, 128), none = 0, one = 0, two = 0;
    for (var i = 0; i < 128 * 128; i++) { var o = M.own, n = (o[i*4] < 255) + (o[i*4+1] < 255) + (o[i*4+2] < 255); if (!n) none++; else if (n === 1) one++; else two++; }
    own[k] = { none: none, one: one, more: two, n: M.n, reach: +M.reach.toFixed(3) };
  });
  var cl = Procedural.brushPatClone({ kind: "star", size: -4, angle: 999, width: 3, fill: "red" });
  out.own = own; out.clamp = cl;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
console.log("  " + JSON.stringify({ one: o.one, two: o.two, three: o.three, four: o.four }));
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
const all = (x, k) => x[k + "In"] > 0 && x[k + "Ok"] === x[k + "In"];
const A = o.one.r;
R.is(o.one.used && A.cells >= 2 && all(A, "fill") && A.stray === 0 && A.past > 50 && o.one.steps === 1,
  `a click on the wing lays each of the ${A.cells} hexagons whose centre is under the ring whole (${A.fillOk} of ${A.fillIn} texels the fill), ${A.past} of them past the ring, and no texel of another cell (${A.stray} of ${A.other}); one undo step (${o.one.steps})` + (A.wrong.length ? " — " + JSON.stringify(A.wrong) : ""));
const B2 = o.two.r;
R.is(o.two.used && all(B2, "fill") && B2.stray === 0 && B2.wing > 0 && B2.flap > 0,
  `by the hinge the hexagon over it is laid on both parts — ${B2.wing} texels on the wing, ${B2.flap} on the flap, ${B2.fillOk} of ${B2.fillIn} whole, ${B2.stray} astray` + (B2.wrong.length ? " — " + JSON.stringify(B2.wrong) : ""));
const C3 = o.three.r;
R.is(o.three.used && all(C3, "fill") && all(C3, "bord") && C3.stray === 0,
  `with a border a revealed cell's inside is the fill (${C3.fillOk} of ${C3.fillIn}) and its border the border colour (${C3.bordOk} of ${C3.bordIn}), and nothing past it is touched (${C3.stray})` + (C3.wrong.length ? " — " + JSON.stringify(C3.wrong) : ""));
const D4 = o.four.r;
R.is(o.four.used && D4.cells >= 3 && all(D4, "fill") && D4.stray === 0 && D4.past > 50,
  `squares on whole texels: ${D4.cells} cells laid whole (${D4.fillOk} of ${D4.fillIn}), ${D4.past} texels past the ring, none astray (${D4.stray})` + (D4.wrong.length ? " — " + JSON.stringify(D4.wrong) : ""));
const T4 = o.turned.r;
R.is(o.turned.used && T4.cells >= 3 && all(T4, "fill") && T4.stray === 0 && T4.past > 50,
  `the same squares turned 30°: ${T4.cells} cells laid whole (${T4.fillOk} of ${T4.fillIn}), ${T4.past} texels past the ring, none astray (${T4.stray})` + (T4.wrong.length ? " — " + JSON.stringify(T4.wrong) : ""));
const F5 = o.five;
R.is(!F5.used && F5.painted === 0 && F5.steps === 0 && /Projected 3-D brush/.test(F5.msg),
  `with the projected brush off a pattern stroke paints nothing (${F5.painted} texels, ${F5.steps} steps) and says why: ${JSON.stringify(F5.msg)}`);
R.is(F5.sheet === false && !F5.open && /3-D view/.test(F5.msg2),
  `a pattern stroke on the sheet is refused before it begins (${F5.sheet}), in words: ${JSON.stringify(F5.msg2)}`);
R.is(o.off.used && o.off.painted > 1000, `with Cells off the brush paints its colour as before (${o.off.painted} texels)`);
for (const [k, x] of Object.entries(o.own))
  R.is(x.none === 0 && x.one > x.more && (k === "scale" ? x.more === 0 : x.more > 0) && x.reach > 0,
    `${k}: every texel of the tile owned (${x.none} not), a cell's inside by one cell (${x.one}), a shared border by more (${x.more}${k === "scale" ? ", none: a scale is the topmost one's" : ""}); ${x.n} cells listed, reach ${x.reach} cell units`);
const cl = o.clamp;
R.is(cl.kind === "off" && cl.size === .01 && cl.angle === 360 && cl.width === .5 && cl.fill === "#262a30",
  `a pattern record is clamped: an unknown shape is off, size ${cl.size}, angle ${cl.angle}, width ${cl.width}, a colour that is not #rrggbb the default (${cl.fill})`);
if ((o.__errs || []).length || (o.__rejs || []).length) R.bad("page errors: " + JSON.stringify([o.__errs, o.__rejs]).slice(0, 400));
R.finish();
