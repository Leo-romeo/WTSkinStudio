// A projected decal, handled directly — ROADMAP 4.2's three parts that needed no new panel controls.
//
//   (a) HANDLES IN 3-D. Corners that resize, a knob off the top edge that turns, the frame and the
//       aim, drawn in the viewport over the footprint 4.35(1) draws. Checked here: every corner is
//       where the projector's own frame puts it (p ± halfW·t1 ± halfH·t2, from nothing but the frame),
//       the aim runs along n for the Depth's reach, the handles disappear with painting on and from
//       a promo shot — and, driven through REAL pointer events on the viewport, a corner dragged
//       to 1.5× its distance gives 1.5× the size and the knob swept 40° gives 40°, one undo step each.
//   (b) DRAG IT IN 2-D. A press on the decal's pixels on the sheet moves it to the surface under the
//       texel the pointer is over, holding the point it was grabbed at; and the same handles are on
//       the sheet. The plate's UVs are deliberately MIRRORED, turned 30° and stretched unevenly (0.10
//       and 0.14 of the sheet per metre), so a handle placed or read in sheet space instead of through
//       the plane→sheet map comes out in the wrong place, and a turn read as a sheet angle comes out
//       with the wrong sign. The expected texels are computed here from that map, not asked of the page.
//   (c) THE SLIDER GATE. One live render over budget used to switch slider preview off for good — the
//       next was never measured. Now it takes two in a row to close; closed, it leaves the thread
//       idle between one render's END and the next for 250 ms or twice the render, whichever is
//       longer; and one fast render reopens it. Driven with renders made slow on purpose — one set
//       SLOWER than 250 ms, which a gate timed from a render's start let run back to back.
//
// And one fault that sat under all three: a live render queued before a drop ran AFTER the drop's
// real render and hid the decal's Look again (SurfDrag.hold) with nothing left to release it. A
// synthetic move-then-release does that every time; the Look must still be showing after the drop.
//
// The review of 2026-09-27 added what the first version could not see: the sheet's handles and cursor
// follow the same rule as the model's (painting, another placing mode); a press on bare sheet reads no
// layer back; one UV island on two surfaces — the second a whole tile over, and FIRST in the geometry —
// keeps a drag on the side it started on; and a decal deleted while held stays deleted at the drop,
// in all three drags, with one undo bringing back exactly one layer and its Look showing.
//
// Usage: node tools/t100_handles.mjs [--keep] [--chrome <path>] [--page <built.html>]
//   --page runs against another build of the app — how this test is shown to fail on the code it
//   replaced (`git show <rev>:wt_skin_studio.html > old.html`).
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const html = argv.includes("--page") ? fs.readFileSync(argv[argv.indexOf("--page") + 1], "utf8") : undefined;

const BODY = `async function(){
  var out = { has: { grip: typeof ProjGrip !== "undefined", handles: typeof ProjHandles !== "undefined", live: typeof ProjLive !== "undefined" } };
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };
  var frames = async function(n){ for (var i = 0; i < n; i++) await frame(); };
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var V3 = function(x, y, z){ return new THREE.Vector3(x, y, z); };
  var keep = { slots: App.slots, slot: App.activeSlot, layer: App.activeLayer, geom: App.geomData, meshes: App.meshes,
               mat: App.matSlot, sel: App.selParts, prot: App.protectedParts, size: App.modelSize, mg: modelGroup,
               paint: App.paint3d, theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone(),
               sym: document.getElementById("symOn").checked, v2: { sc: v2.sc, ox: v2.ox, oy: v2.oy, fit: v2.fit } };

  // ---- the plate: 4 × 4 m at z = 0 facing +z, its UVs mirrored, turned 30° and stretched unevenly ----
  var N = 256, TH = 30 * Math.PI / 180, C = Math.cos(TH), S = Math.sin(TH), A = .1, B = .14;
  var uvOf = function(x, y){ var a = x * C - y * S, b = x * S + y * C; return [.5 - A * a, .5 + B * b]; };
  var tex = function(x, y){ var u = uvOf(x, y); return { x: u[0] * N, y: (1 - u[1]) * N }; };   // world → sheet texel
  var world = function(X, Y){ var a = (.5 - X / N) / A, b = ((1 - Y / N) - .5) / B; return V3(a * C + b * S, -a * S + b * C, 0); };
  var cs = [[-2, -2], [2, -2], [2, 2], [-2, 2]], idx = [0, 1, 2, 0, 2, 3];
  var pos = new Float32Array(18), nrm = new Float32Array(18), uv = new Float32Array(12);
  idx.forEach(function(ci, k){ var c = cs[ci], t = uvOf(c[0], c[1]);
    pos[k * 3] = c[0]; pos[k * 3 + 1] = c[1]; pos[k * 3 + 2] = 0; nrm[k * 3 + 2] = 1; uv[k * 2] = t[0]; uv[k * 2 + 1] = t[1]; });
  var gd = { name: "plate", mat: "m98", position: pos, normal: nrm, uv: uv };
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080 }));
  mesh.name = "plate"; mesh.userData = { mat: "m98" };
  var group = new THREE.Group(); group.add(mesh); scene.add(group); group.updateMatrixWorld(true);
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t98", cStem: "t98", layers: [], size: N, sizeH: N, missing: false, cEdited: true,
            baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
  App.slots = new Map([["t98", s]]); App.activeSlot = s; App.geomData = [gd];
  App.meshes = new Map([["plate", mesh]]); App.matSlot = new Map([["m98", "t98"]]);
  App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 10, y: 10, z: 10 };
  modelGroup = group;
  document.getElementById("symOn").checked = false;
  if (App.paint3d) setPaint3d(false);
  setPlacing(false);
  // straight down −z at the plate, so the frame is n = +z, r = +x, u = +y
  cam.fly = false; cam.target.set(0, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 5;
  resize3D(); syncCamera();

  // ---- the decal: 64 × 32, projected at the origin; at scale 1/3 that is half 0.4 × 0.2 m ----
  var bmp = mkCanvas(64, 32); ctx2d(bmp).fillStyle = "#e02020"; ctx2d(bmp).fillRect(0, 0, 64, 32);
  var D = LayerNode.of({ type: "decal", name: "d98", bmp: bmp, x: .5, y: .5, scale: 1 / 3, rot: 0, flip: false,
                         visible: true, opacity: 1, blend: "normal", surf: { sm: 55, mt: 0, em: 6, preset: "vinyl" } });
  s.layers = [D]; App.activeLayer = D;
  bakeProjection(D, { point: V3(0, 0, 0) });
  var PL = App.activeLayer, P = PL && PL.proj;
  out.baked = { proj: !!P, n: P && P.frame.n.map(function(v){ return Math.round(v * 1000) / 1000; }), placing: App.placing };
  if (!P) return out;
  App.undoStack.length = 0; App.redoStack.length = 0;
  var reset = function(){ P.scale = 1 / 3; P.rot = 0; P.frame.p = [0, 0, 0]; renderProjGroup(P); App.undoStack.length = 0; App.redoStack.length = 0; };

  var pe = function(type, x, y, shift){
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, shiftKey: !!shift,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true });
  };
  var gesture = function(el, from, to, shift){
    el.dispatchEvent(pe("pointermove", from.x, from.y));
    el.dispatchEvent(pe("pointerdown", from.x, from.y, shift));
    el.dispatchEvent(pe("pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2, shift));
    el.dispatchEvent(pe("pointermove", to.x, to.y, shift));
    el.dispatchEvent(pe("pointerup", to.x, to.y, shift));
  };
  var steps = function(){ return App.undoStack.map(function(a){ return a.desc || a.label || a.name || ""; }); };
  var arr = function(a){ var p = a.geometry.attributes.position, o = []; for (var i = 0; i < p.count; i++) o.push([p.getX(i), p.getY(i), p.getZ(i)]); return o; };
  var r3 = function(v){ return Math.round(v * 1000) / 1000; };

  // =============== (a) the handles in 3-D ===============
  needsRender(); await frames(3);
  var H3 = out.h3 = { shown: !!(out.has.handles && ProjHandles.shown), visible: !!(out.has.handles && ProjHandles.group && ProjHandles.group.visible) };
  if (H3.shown) {
    H3.corners = arr(ProjHandles.corners).map(function(c){ return c.map(r3); });
    H3.aim = arr(ProjHandles.aim).slice(0, 2).map(function(c){ return c.map(r3); });
    H3.knob = arr(ProjHandles.knob)[0].map(r3);
    H3.reach = r3(projDepthLim(P, .4, .2));
    // the same points on screen as the page's own worldToScreen puts them
    H3.scrErr = Math.max.apply(null, ProjHandles.shown.corners.map(function(c, i){
      var w = worldToScreen(V3(H3.corners[i][0], H3.corners[i][1], H3.corners[i][2])); return Math.hypot(w.x - c.x, w.y - c.y); }));
  }
  // a corner, dragged to 1.5× its distance along its own diagonal (the top-right: +x, +y)
  var cnv3el = document.getElementById("view3d");
  var tr = worldToScreen(V3(.4, .2, 0)), tr15 = worldToScreen(V3(.6, .3, 0));
  gesture(cnv3el, tr, tr15);
  await frames(2);
  out.scale3 = { scale: P.scale, steps: steps(), dragging: App.projDragging, g: out.has.grip ? ProjGrip.g : "none" };
  if (App.undoStack.length) { doUndo(); out.scale3.undone = P.scale; doRedo(); out.scale3.redone = P.scale; }
  reset(); needsRender(); await frames(3);
  // the knob, swept 40° counter-clockwise about the centre (seen from the projector), then 22° more with Shift
  var kn = out.has.handles && ProjHandles.shown ? ProjHandles.shown.knob : worldToScreen(V3(0, .55, 0));
  var ray = function(sx, sy){ var r = cnv3el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height * 2 - 1)), camera);
    var o = raycaster.ray.origin, d = raycaster.ray.direction, t = -o.z / d.z; return V3(o.x + d.x * t, o.y + d.y * t, 0); };
  var k0 = ray(kn.x, kn.y);
  var turn = function(v, deg){ var a = deg * Math.PI / 180; return V3(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a), 0); };
  gesture(cnv3el, kn, worldToScreen(turn(k0, 40)));
  await frames(2);
  out.rot3 = { rot: P.rot, steps: steps().slice() };
  needsRender(); await frames(3);
  var kn2 = out.has.handles && ProjHandles.shown ? ProjHandles.shown.knob : kn;
  gesture(cnv3el, kn2, worldToScreen(turn(ray(kn2.x, kn2.y), 22)), true);
  await frames(2);
  out.rot3.snapped = P.rot;
  // with painting on the handles are gone, and a press where a corner was does not resize
  reset(); needsRender(); await frames(3);
  setPaint3d(true); needsRender(); await frames(3);
  out.paintOn = { visible: !!(out.has.handles && ProjHandles.group && ProjHandles.group.visible), shown: !!(out.has.handles && ProjHandles.shown) };
  gesture(cnv3el, worldToScreen(V3(.4, .2, 0)), worldToScreen(V3(.6, .3, 0)));
  out.paintOn.scale = P.scale;
  setPaint3d(false); App.activeLayer = PL; needsRender(); await frames(3);
  // …and from a promo shot: no accent-blue pixel in it, and the handles back on screen afterwards
  var accent = function(c){ var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = 0;
    for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 2] > 200 && d[i] < 150 && d[i + 1] > 110 && d[i + 1] < 210) n++; return n; };
  var shot = Shot.render(132, 200);
  out.shot = { accent: shot ? accent(shot) : -1, after: !!(out.has.handles && ProjHandles.group && ProjHandles.group.visible) };

  // =============== (b) the 2-D view ===============
  reset();
  // pinned: 3 device px per texel, the decal's centre texel (128, 128) in the middle of the canvas
  var cnv2el = document.getElementById("view2d"), dpr = devicePixelRatio;
  v2.fit = false; v2.sc = 3; v2.ox = cnv2el.width / 2 - 128 * 3; v2.oy = cnv2el.height / 2 - 128 * 3;
  var cl = function(t){ var r = cnv2el.getBoundingClientRect(); return { x: r.left + (t.x * v2.sc + v2.ox) / dpr, y: r.top + (t.y * v2.sc + v2.oy) / dpr }; };
  draw2DNow();
  var TX = { c: tex(0, 0), tr: tex(.4, .2), bl: tex(-.4, -.2) };
  out.geom2 = null;
  if (out.has.grip) {
    var G2 = Draw2D.projGeom ? Draw2D.projGeom(s) : null;
    if (G2) {
      var dev = function(t){ return { x: t.x * v2.sc + v2.ox, y: t.y * v2.sc + v2.oy }; };
      out.geom2 = { handles: G2.handles, c: Math.hypot(G2.c.x - dev(TX.c).x, G2.c.y - dev(TX.c).y),
                    tr: Math.hypot(G2.corners[1].x - dev(TX.tr).x, G2.corners[1].y - dev(TX.tr).y),
                    bl: Math.hypot(G2.corners[3].x - dev(TX.bl).x, G2.corners[3].y - dev(TX.bl).y), knob: G2.knob };
    }
  }
  // the body: grabbed off-centre at (0.1, 0.05) m, moved 15 texels right and 10 down on the sheet
  var alphaC = function(c){ var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, sx = 0, sy = 0, n = 0;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) { var a = d[(y * c.width + x) * 4 + 3]; if (a > 128) { sx += x + .5; sy += y + .5; n++; } }
    return n ? { x: sx / n, y: sy / n, n: n } : null; };
  var before = alphaC(PL.canvas), grab = tex(.1, .05);
  var ox0 = v2.ox, oy0 = v2.oy;
  gesture(cnv2el, cl(grab), cl({ x: grab.x + 15, y: grab.y + 10 }));
  var want = world(TX.c.x + 15, TX.c.y + 10);
  out.move2 = { p: P.frame.p.slice(), want: [want.x, want.y, want.z], steps: steps(), panned: v2.ox !== ox0 || v2.oy !== oy0,
                dragging: v2.draggingDecal, g: out.has.grip ? ProjGrip.g : "none" };
  await frames(3);
  var after = alphaC(PL.canvas);
  out.move2.shift = before && after ? [after.x - before.x, after.y - before.y] : null;
  // the Look is showing again once the drop has settled — a queued live render must not hide it
  var sm = derivedOn(PL, "smooth");
  out.move2.look = { has: !!sm, visible: !!(sm && sm.visible !== false), held: !!SurfDrag.held };
  if (App.undoStack.length) { doUndo(); out.move2.undone = P.frame.p.slice(); }
  // a corner on the sheet, dragged to 1.5× along its diagonal, and the knob turned 30° in the plane
  reset(); draw2DNow();
  gesture(cnv2el, cl(TX.tr), cl(tex(.6, .3)));
  await frames(2);
  out.scale2 = { scale: P.scale, steps: steps() };
  reset(); draw2DNow();
  var K2 = out.has.grip && Draw2D.projGeom ? Draw2D.projGeom(s) : null;
  out.rot2 = { knob: !!K2 };
  if (K2) {
    var kt = { x: (K2.knob.x - v2.ox) / v2.sc, y: (K2.knob.y - v2.oy) / v2.sc };      // the knob's texel
    var kw = world(kt.x, kt.y);                                                         // …and where that is on the plate
    out.rot2.knobUp = Math.round(Math.atan2(kw.y, kw.x) * 180 / Math.PI * 10) / 10;       // straight up the image: 90°
    gesture(cnv2el, cl(kt), cl(tex(turn(kw, 30).x, turn(kw, 30).y)));
    await frames(2);
    out.rot2.rot = P.rot; out.rot2.steps = steps();
  }
  // an OBLIQUE aim — the projector turned 35° about x — so every plane step has to slide along the
  // beam onto the plate before it is read in the UVs; square-on, that slide is a no-op
  reset();
  var TAU = 35 * Math.PI / 180, cT = Math.cos(TAU), sT = Math.sin(TAU);
  P.frame.u = [0, cT, sT]; P.frame.n = [0, -sT, cT];
  renderProjGroup(P); draw2DNow();
  var OB = out.has.grip && Draw2D.projGeom ? Draw2D.projGeom(s) : null;
  out.oblique = null;
  if (OB) {
    var dv = function(t){ return { x: t.x * v2.sc + v2.ox, y: t.y * v2.sc + v2.oy }; };
    out.oblique = ProjGrip.CORNERS.map(function(k, i){
      // the projector's corner (t1 = r, t2 = −u at rot 0), carried down −n onto the plate z = 0
      var pc = V3(k[0] * .4, -k[1] * .2 * cT, -k[1] * .2 * sT), lam = pc.z / cT;   // pc − lam·n has z = 0
      var onPlate = V3(pc.x, pc.y + sT * lam, 0), want = dv(tex(onPlate.x, onPlate.y));
      return Math.round(Math.hypot(OB.corners[i].x - want.x, OB.corners[i].y - want.y) * 1000) / 1000;
    });
  }
  P.frame.u = [0, 1, 0]; P.frame.n = [0, 0, 1];
  // painting on: no handles on the sheet, and a press on the decal is not a drag
  reset(); setPaint3d(true); draw2DNow();
  out.paint2 = { geom: out.has.grip && Draw2D.projGeom ? !!Draw2D.projGeom(s) : false };
  gesture(cnv2el, cl(grab), cl({ x: grab.x + 15, y: grab.y + 10 }));
  out.paint2.p = P.frame.p.slice();
  setPaint3d(false); App.activeLayer = PL;
  var devCl = function(d){ var r = cnv2el.getBoundingClientRect(); return { x: r.left + d.x / dpr, y: r.top + d.y / dpr }; };

  // the sheet's handle cursor goes with its handles: the resize arrow over a corner, gone the moment
  // painting is switched on (it is an inline style, and it used to stay for a whole painting session)
  reset(); draw2DNow();
  var HC = out.has.grip && Draw2D.projGeom ? Draw2D.projGeom(s) : null;
  out.cursor2 = null;
  if (HC) {
    var overC = devCl(HC.corners[1]), awayC = cl(tex(-1.5, -1.5));
    cnv2el.dispatchEvent(pe("pointermove", overC.x, overC.y));
    out.cursor2 = { over: cnv2el.style.cursor };
    setPaint3d(true);
    out.cursor2.paintOn = cnv2el.style.cursor;
    cnv2el.dispatchEvent(pe("pointermove", overC.x + 1, overC.y + 1));
    out.cursor2.paintMove = cnv2el.style.cursor;
    setPaint3d(false); App.activeLayer = PL;
    cnv2el.dispatchEvent(pe("pointermove", overC.x, overC.y));
    out.cursor2.back = cnv2el.style.cursor;
    cnv2el.dispatchEvent(pe("pointermove", awayC.x, awayC.y));
    out.cursor2.away = cnv2el.style.cursor;
  }
  // another placing mode armed: the model hides its handles and so must the sheet, and a press on
  // the sheet takes neither a corner nor the decal — that mode owns the click
  reset(); draw2DNow();
  var ox1 = v2.ox, oy1 = v2.oy;
  setPlacing("radial"); needsRender(); await frames(3); draw2DNow();
  out.placing2 = { placing: App.placing, h3: !!(out.has.handles && ProjHandles.shown),
                   geom: !!(out.has.grip && Draw2D.projGeom && Draw2D.projGeom(s)) };
  gesture(cnv2el, cl(TX.tr), cl(tex(.6, .3)));
  out.placing2.scale = P.scale;
  gesture(cnv2el, cl(grab), cl({ x: grab.x + 15, y: grab.y + 10 }));
  out.placing2.p = P.frame.p.slice(); out.placing2.steps = steps();
  setPlacing(false); v2.ox = ox1; v2.oy = oy1; App.activeLayer = PL;
  // …and no handle is drawn on the sheet where a press there cannot take one — Select or the shape
  // tool owns the sheet's pointer, or the brush is on the layer's mask — though the frame still shows
  reset(); draw2DNow();
  var own = function(){ var H = out.has.grip && Draw2D.projGeom ? Draw2D.projGeom(s) : null; return H ? (H.handles ? "handles" : "frame") : "none"; };
  out.owns = { free: own() };
  SelectUI.setOn(true); out.owns.select = own(); SelectUI.setOn(false);
  PathUI.set(true); out.owns.path = own(); PathUI.set(false);
  var bt0 = App.brush.target; App.brush.target = "mask"; out.owns.mask = own(); App.brush.target = bt0;
  out.owns.back = own();
  // what a press costs in readbacks: on bare sheet, well away from the decal, it pans and reads no
  // layer; on the decal it reads its one layer, once (a pan's press used to read every projected layer)
  reset(); draw2DNow();
  var gid = CanvasRenderingContext2D.prototype.getImageData, nread = 0;
  CanvasRenderingContext2D.prototype.getImageData = function(){ nread++; return gid.apply(this, arguments); };
  try {
    var bareP = cl(tex(-1.5, -1.5)), onP = cl(grab);
    nread = 0; cnv2el.dispatchEvent(pe("pointerdown", bareP.x, bareP.y));
    out.reads = { bare: nread, panning: !!v2.panning };
    cnv2el.dispatchEvent(pe("pointerup", bareP.x, bareP.y));
    nread = 0; cnv2el.dispatchEvent(pe("pointerdown", onP.x, onP.y));
    out.reads.on = nread; out.reads.grabbed = !!(out.has.grip && ProjGrip.g);
    cnv2el.dispatchEvent(pe("pointerup", onP.x, onP.y));
    // a decal moved off this sheet keeps an empty layer on it (renderProjGroup): no press reads that
    P.frame.p = [20, 0, 0]; renderProjGroup(P); draw2DNow();
    nread = 0; cnv2el.dispatchEvent(pe("pointerdown", onP.x, onP.y));
    out.reads.off = nread; out.reads.empty = !!PL.projEmpty;
    cnv2el.dispatchEvent(pe("pointerup", onP.x, onP.y));
    // mid-edit a LIVE render has moved the pixels and measured nothing, so the box from before is not
    // trusted: a press on where the decal is now still finds it
    reset(); draw2DNow();
    P.frame.p = [1.2, 0, 0]; projLiveRender(P); await frames(2);
    var nowP = cl(tex(1.2, 0));
    nread = 0; cnv2el.dispatchEvent(pe("pointerdown", nowP.x, nowP.y));
    out.reads.live = { reads: nread, grabbed: !!(out.has.grip && ProjGrip.g) };
    cnv2el.dispatchEvent(pe("pointerup", nowP.x, nowP.y));
  } finally { CanvasRenderingContext2D.prototype.getImageData = gid; }
  v2.ox = ox1; v2.oy = oy1;
  // one UV island on two surfaces: a twin of the plate 6 m along x, on the SAME texels one whole tile
  // over (its u runs 1 … 2). A mirrored pair shares an island like this (12 % of the F-4E's sheet), and
  // a tiled part is found on its repeats only if each triangle is filed once per tile it crosses. The
  // twin comes FIRST, so a lookup that took the first surface under a texel would carry a drag on the
  // plate over to the twin — and a drag on the twin needs the twin filed at all.
  reset();
  var tpos = new Float32Array(18), tuv = new Float32Array(12);
  for (var tq = 0; tq < 18; tq++) tpos[tq] = pos[tq] + (tq % 3 === 0 ? 6 : 0);
  for (var tq2 = 0; tq2 < 12; tq2++) tuv[tq2] = uv[tq2] + (tq2 % 2 === 0 ? 1 : 0);
  var tgd = { name: "twin", mat: "m98", position: tpos, normal: nrm, uv: tuv };
  var tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3));
  tgeo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  tgeo.setAttribute("uv", new THREE.BufferAttribute(tuv, 2));
  var tmesh = new THREE.Mesh(tgeo, mesh.material); tmesh.name = "twin"; tmesh.userData = { mat: "m98" };
  group.add(tmesh); group.updateMatrixWorld(true);
  App.geomData = [tgd, gd]; App.meshes.set("twin", tmesh);
  var drag2 = function(){ draw2DNow(); gesture(cnv2el, cl(grab), cl({ x: grab.x + 15, y: grab.y + 10 })); return P.frame.p.slice(); };
  out.twin = { a: drag2(), wantA: [want.x, want.y, want.z] };
  P.frame.p = [6, 0, 0]; renderProjGroup(P); App.undoStack.length = 0; App.redoStack.length = 0;
  out.twin.b = drag2(); out.twin.wantB = [want.x + 6, want.y, want.z];
  group.remove(tmesh); tgeo.dispose(); App.geomData = [gd]; App.meshes.delete("twin");

  // =============== (d) the decal deleted while it is held ===============
  // Delete pressed mid-drag — on a corner in 3-D, on the body in 3-D (Moving), on the body on the
  // sheet: the drop must not put the decal back as new layers that no undo step knows about (undo then
  // left two layers of one projection, the decal composited twice), and whatever the gesture hid —
  // its Look — must be showing once the delete is undone.
  var nProj = function(){ return layerLeaves(s.layers).filter(function(L){ return !!L.proj; }).length; };
  var midDelete = async function(kind){
    reset(); App.activeLayer = PL; draw2DNow(); needsRender(); await frames(3);
    var el = kind === "body2" ? cnv2el : cnv3el, a, b;
    if (kind === "body2") { a = cl(grab); b = cl({ x: grab.x + 15, y: grab.y + 10 }); }
    else if (kind === "body3") { setPlacing("movproj"); a = worldToScreen(V3(0, 0, 0)); b = worldToScreen(V3(.5, .3, 0)); }
    else { a = worldToScreen(V3(.4, .2, 0)); b = worldToScreen(V3(.6, .3, 0)); }
    var r = { before: nProj() };
    el.dispatchEvent(pe("pointermove", a.x, a.y));
    el.dispatchEvent(pe("pointerdown", a.x, a.y));
    el.dispatchEvent(pe("pointermove", (a.x + b.x) / 2, (a.y + b.y) / 2));
    await frame();                                     // a live render has run: the Look is held hidden
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", key: "Delete", bubbles: true }));
    r.deleted = nProj();
    el.dispatchEvent(pe("pointermove", b.x, b.y));
    await frame();
    el.dispatchEvent(pe("pointerup", b.x, b.y));
    await frames(2);
    r.dropped = nProj(); r.steps = steps();
    doUndo(); r.undone = nProj();
    var sm2 = derivedOn(PL, "smooth"); r.look = !!(sm2 && sm2.visible !== false); r.held = !!SurfDrag.held;
    doUndo(); r.undone2 = nProj();
    setPlacing(false); App.activeLayer = PL;
    return r;
  };
  out.gone = { corner3: await midDelete("corner3"), body3: await midDelete("body3"), body2: await midDelete("body2") };
  // …and UNDONE away: a second decal whose own projection is the step on top, with Ctrl+Z pressed while
  // one of its corners is held — the drop must leave the undo where it was, the redo still there
  reset();
  var bmp3 = mkCanvas(64, 32); ctx2d(bmp3).fillStyle = "#2020e0"; ctx2d(bmp3).fillRect(0, 0, 64, 32);
  var D3 = LayerNode.of({ type: "decal", name: "d100b", bmp: bmp3, x: .5, y: .5, scale: 1 / 3, rot: 0, flip: false,
                          visible: true, opacity: 1, blend: "normal" });
  s.layers.push(D3); App.activeLayer = D3;
  bakeProjection(D3, { point: V3(1.2, 1, 0) });
  var P3 = App.activeLayer && App.activeLayer.proj, nP3 = function(){ return P3 ? projSiblings(P3.id).length : -1; };
  out.undone = { before: nP3(), steps0: steps() };
  if (P3) {
    needsRender(); await frames(3);
    var ua = worldToScreen(V3(1.6, 1.2, 0)), ub = worldToScreen(V3(1.8, 1.3, 0));
    cnv3el.dispatchEvent(pe("pointermove", ua.x, ua.y));
    cnv3el.dispatchEvent(pe("pointerdown", ua.x, ua.y));
    cnv3el.dispatchEvent(pe("pointermove", (ua.x + ub.x) / 2, (ua.y + ub.y) / 2));
    await frame();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", key: "z", ctrlKey: true, bubbles: true }));
    out.undone.undone = nP3();
    cnv3el.dispatchEvent(pe("pointermove", ub.x, ub.y));
    await frame();
    cnv3el.dispatchEvent(pe("pointerup", ub.x, ub.y));
    await frames(2);
    out.undone.dropped = nP3(); out.undone.steps = steps(); out.undone.redo = App.redoStack.length;
    doRedo(); out.undone.redone = nP3();
    deleteProjGroup(P3);
  }
  App.undoStack.length = 0; App.redoStack.length = 0; App.activeLayer = PL; setPlacing(false);

  // =============== (c) the slider gate ===============
  reset();
  var realRender = window.renderProjGroup, calls = [], ends = [], slow = 0;
  window.renderProjGroup = function(Q, live){ var t = performance.now(); if (live) calls.push(t); while (performance.now() - t < slow) {}
    if (live) ends.push(performance.now()); return { added: [], drawn: 1, sheets: 1 }; };
  var slider = document.getElementById("projScale");
  var input = function(){ slider.value = String(20 + (calls.length % 50)); slider.oninput({ target: slider }); };
  // "end" is the field since the review (2026-09-27); "at" — the gate timed from a render's start —
  // is reset as well, so that --page can run this against the build it replaced
  var fresh = function(){ if (out.has.live) { ProjLive.ms = [0, 0]; ProjLive.end = -Infinity; ProjLive.at = -Infinity; ProjLive.pending = false; }
    else { window.projLiveMs = 0; } calls.length = 0; ends.length = 0; };
  // the thread's idle time between one live render's end and the next one's start
  var idles = function(){ var o = []; for (var i = 1; i < calls.length; i++) o.push(Math.round(calls[i] - ends[i - 1])); return o; };
  try {
    // 1. one slow render does not switch live preview off
    fresh(); slow = 60; input(); await frames(2);
    slow = 1; input(); await frames(2); input(); await frames(2);
    out.gate1 = calls.length;
    // 2. always slow: it closes after two, and then still renders — with 250 ms idle between, not every frame
    fresh(); slow = 60;
    var t0 = performance.now();
    while (performance.now() - t0 < 1100) { input(); await frame(); }
    out.gate2 = { n: calls.length, idle: idles() };
    // 3. fast again: the next throttled render measures it, and every frame renders after that. How
    //    long the first waits is counted from the last slow render's END, which is what it waits on
    var lastEnd = ends.length ? ends[ends.length - 1] : performance.now();
    slow = 0; calls.length = 0; ends.length = 0;
    var t1 = performance.now();
    while (performance.now() - t1 < 700) { input(); await frame(); }
    out.gate3 = { n: calls.length, first: calls.length ? Math.round(calls[0] - lastEnd) : null };
    // 4. SLOWER than EVERY (software WebGL, the canvas fallback on a big vehicle): closed, the thread
    //    still has to be left idle between renders — timed from a render's start, it was not
    fresh(); slow = 300;
    var t2 = performance.now();
    while (calls.length < 4 && performance.now() - t2 < 8000) { input(); await frame(); }
    var busy = 0; for (var bi = 2; bi < ends.length; bi++) busy += ends[bi] - calls[bi];
    out.gate4 = { n: calls.length, R: slow, idle: idles(),
                  busy: ends.length > 2 ? Math.round(busy / (ends[ends.length - 1] - ends[1]) * 100) + "%" : "—" };
  } finally { window.renderProjGroup = realRender; }
  slider.onchange && slider.onchange();

  // ---- put the page back ----
  App.activeLayer = null; needsRender(); await frames(2);
  scene.remove(group); geo.dispose();
  App.slots = keep.slots; App.activeSlot = keep.slot; App.activeLayer = keep.layer; App.geomData = keep.geom; App.meshes = keep.meshes;
  App.matSlot = keep.mat; App.selParts = keep.sel; App.protectedParts = keep.prot; App.modelSize = keep.size; modelGroup = keep.mg;
  cam.theta = keep.theta; cam.phi = keep.phi; cam.dist = keep.dist; cam.target.copy(keep.target); syncCamera();
  document.getElementById("symOn").checked = keep.sym;
  v2.sc = keep.v2.sc; v2.ox = keep.v2.ox; v2.oy = keep.v2.oy; v2.fit = keep.v2.fit;
  setPlacing(false);
  App.undoStack.length = 0; App.redoStack.length = 0;
  return out;
}`;

const run = await evalInPage({ browser, html, expr: pageExpr(BODY, 400), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const o = run.result;
if (o.__threw) { console.log("FAIL: the page threw\n" + o.__threw); process.exit(1); }
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const ptNear = (a, b, eps) => a && b && a.length === b.length && a.every((v, i) => near(v, b[i], eps));

console.log(`=== setup: ProjGrip ${o.has.grip}, ProjHandles ${o.has.handles}, ProjLive ${o.has.live} ===`);
R.is(o.baked && o.baked.proj && ptNear(o.baked.n, [0, 0, 1], 1e-3) && o.baked.placing === "movproj",
  `the decal is projected straight down −z onto the plate (n ${JSON.stringify(o.baked && o.baked.n)}), with Moving on`);

console.log("\n=== (a) handles in 3-D ===");
const H = o.h3;
R.is(H.shown && H.visible, `a selected projected decal carries handles in the viewport (shown ${H.shown}, visible ${H.visible})`);
const wantC = [[-.4, .2, 0], [.4, .2, 0], [.4, -.2, 0], [-.4, -.2, 0]];
R.is(H.corners && H.corners.every((c, i) => ptNear(c, wantC[i], 1e-3)),
  `the four corners are the projector's own: p ± halfW·t1 ± halfH·t2 = ±0.4, ±0.2 (${JSON.stringify(H.corners)})`);
R.is(H.aim && ptNear(H.aim[0], [0, 0, 0], 1e-3) && ptNear(H.aim[1], [0, 0, H.reach], 1e-3),
  `the aim runs from the centre along n as far as the Depth reaches (${JSON.stringify(H.aim)}, reach ${H.reach} m)`);
R.is(H.knob && near(H.knob[0], 0, 1e-3) && H.knob[1] > .25 && near(H.knob[2], 0, 1e-3),
  `the knob stands off the image's top edge, above y = 0.2 (${JSON.stringify(H.knob)})`);
R.is(H.scrErr != null && H.scrErr < .6, `and the hit test reads the same screen points worldToScreen gives (worst ${H.scrErr != null ? H.scrErr.toFixed(2) : "—"} px)`);
const S3 = o.scale3;
console.log(`   corner: scale ${S3.scale} · steps ${JSON.stringify(S3.steps)} · undone ${S3.undone} · redone ${S3.redone}`);
R.is(near(S3.scale, .5, .005), `a corner dragged to 1.5× its distance gives 1.5× the size (1/3 → ${S3.scale.toFixed(4)})`);
R.is(S3.steps.length === 1 && /resize projected decal/.test(S3.steps[0]) && near(S3.undone, 1 / 3, 1e-9) && near(S3.redone, S3.scale, 1e-9),
  `…as ONE undo step, "resize projected decal", that undoes and redoes (${JSON.stringify(S3.steps)})`);
R.is(S3.dragging === false && S3.g === null, `and nothing is left mid-gesture (projDragging ${S3.dragging}, gesture ${S3.g})`);
const T3 = o.rot3;
console.log(`   knob: ${T3.rot}° · Shift +22° → ${T3.snapped}° · steps ${JSON.stringify(T3.steps)}`);
R.is(near(T3.rot, 40, .3) && T3.steps.length === 1 && /rotate projected decal/.test(T3.steps[0]),
  `the knob swept 40° counter-clockwise turns the decal +40° (${T3.rot}°), one step "rotate projected decal"`);
R.is(T3.snapped === 60, `with Shift a turn lands on the 15° grid: 40° + 22° → ${T3.snapped}°`);
R.is(!o.paintOn.visible && !o.paintOn.shown && near(o.paintOn.scale, 1 / 3, 1e-9),
  `with painting on the handles are gone, and a press where a corner was does not resize (${o.paintOn.scale})`);
R.is(o.shot.accent === 0 && o.shot.after, `a promo shot leaves them out (${o.shot.accent} accent pixels) and puts them back after (${o.shot.after})`);

console.log("\n=== (b) the 2-D view ===");
const G2 = o.geom2;
console.log(`   frame on the sheet vs the map computed here: centre ${G2 ? G2.c.toFixed(3) : "—"} px, TR ${G2 ? G2.tr.toFixed(3) : "—"} px, BL ${G2 ? G2.bl.toFixed(3) : "—"} px`);
R.is(G2 && G2.handles && G2.c < .05 && G2.tr < .05 && G2.bl < .05,
  `the frame on the sheet is where the plate's mirrored, turned, uneven UVs put the projector's corners (within ${G2 ? Math.max(G2.c, G2.tr, G2.bl).toFixed(3) : "—"} px)`);
const M2 = o.move2;
console.log(`   body: p ${JSON.stringify(M2.p.map(v => +v.toFixed(4)))} want ${JSON.stringify(M2.want.map(v => +v.toFixed(4)))} · pixels moved ${JSON.stringify(M2.shift && M2.shift.map(v => +v.toFixed(2)))} · steps ${JSON.stringify(M2.steps)}`);
R.is(ptNear(M2.p, M2.want, 2e-3), `dragging the decal's pixels 15 right and 10 down on the sheet moves its centre to the surface under that texel`);
R.is(M2.shift && near(M2.shift[0], 15, 1.5) && near(M2.shift[1], 10, 1.5),
  `…and its projected pixels follow, holding the point it was grabbed at (+${M2.shift && M2.shift.map(v => v.toFixed(1)).join(", +")} texels)`);
R.is(!M2.panned && M2.dragging === false && M2.g === null, `the press was the decal's, not a pan of the sheet, and nothing is left mid-gesture`);
R.is(M2.steps.length === 1 && /move projected decal/.test(M2.steps[0]) && ptNear(M2.undone, [0, 0, 0], 1e-9),
  `one undo step, "move projected decal", puts it back (${JSON.stringify(M2.undone)})`);
R.is(M2.look.has && M2.look.visible && !M2.look.held,
  `the decal's Look is showing once the drop settles — a live render queued before the drop does not hide it again (visible ${M2.look.visible}, held ${M2.look.held})`);
console.log(`   corner: ${o.scale2.scale} · knob: straight up at ${o.rot2.knobUp}°, turned to ${o.rot2.rot}°`);
R.is(near(o.scale2.scale, .5, .005) && o.scale2.steps.length === 1 && /resize projected decal/.test(o.scale2.steps[0]),
  `a corner on the sheet dragged to 1.5× along its diagonal gives 1.5× the size (${o.scale2.scale}), one step`);
R.is(o.rot2.knob && near(o.rot2.knobUp, 90, .5), `the sheet's knob is straight up the IMAGE on the plate (${o.rot2.knobUp}°), whatever the UVs do to it on the sheet`);
R.is(near(o.rot2.rot, 30, .3) && o.rot2.steps && o.rot2.steps.length === 1,
  `turning it 30° on the plate turns the decal +30° (${o.rot2.rot}°) — read in the plane, not as a sheet angle, so the mirrored UVs do not flip its sign`);
console.log(`   aimed 35° off the plate's normal, each corner vs the plate point under it: ${JSON.stringify(o.oblique)} px`);
R.is(o.oblique && o.oblique.every(d => d < .05),
  `aimed obliquely, the frame's corners are where the BEAM carries them down onto the plate — each plane step slides along −n before it is read in UVs (worst ${o.oblique ? Math.max(...o.oblique) : "—"} px)`);
R.is(!o.paint2.geom && ptNear(o.paint2.p, [0, 0, 0], 1e-9), `with painting on the sheet shows no handles and a press on the decal does not drag it`);
const C2 = o.cursor2;
R.is(C2 && /resize$/.test(C2.over) && C2.paintOn === "" && C2.paintMove === "" && C2.back === C2.over && C2.away === "",
  `the sheet's handle cursor goes with its handles: ${C2 && C2.over} over a corner, gone the moment painting is switched on (${JSON.stringify(C2 && C2.paintOn)}, ${JSON.stringify(C2 && C2.paintMove)} after a move), back with painting off, plain off the handle (${JSON.stringify(C2 && C2.away)})`);
const PM = o.placing2;
R.is(PM && PM.placing === "radial" && !PM.h3 && !PM.geom && near(PM.scale, 1 / 3, 1e-9) && ptNear(PM.p, [0, 0, 0], 1e-9) && PM.steps.length === 0,
  `with another placing mode armed (${PM && PM.placing}) neither view has handles (model ${PM && PM.h3}, sheet ${PM && PM.geom}), and a press on the sheet takes neither a corner (${PM && PM.scale}) nor the decal (${JSON.stringify(PM && PM.p)})`);
const OW = o.owns;
R.is(OW && OW.free === "handles" && OW.select === "frame" && OW.path === "frame" && OW.mask === "frame" && OW.back === "handles",
  `the sheet draws its handles only where a press can take one — frame only while Select (${OW && OW.select}) or the shape tool (${OW && OW.path}) owns its pointer or the brush is on the mask (${OW && OW.mask})`);
const RB = o.reads;
R.is(RB && RB.bare === 0 && RB.panning && RB.on === 1 && RB.grabbed,
  `a press on bare sheet pans and reads no layer back (${RB && RB.bare} readbacks); one on the decal reads its one layer once (${RB && RB.on}) and takes hold of it`);
R.is(RB && RB.empty && RB.off === 0, `…and with the decal moved off the sheet, its empty layer there is not read either (${RB && RB.off} readbacks, empty ${RB && RB.empty})`);
R.is(RB && RB.live && RB.live.grabbed && RB.live.reads === 1,
  `…but a box a live render has made stale is not trusted: mid-edit, a press where the decal is NOW takes it (${RB && RB.live && RB.live.reads} readback, grabbed ${RB && RB.live && RB.live.grabbed})`);
const TW = o.twin, f3 = a => JSON.stringify(a && a.map(v => +v.toFixed(3)));
console.log(`   one island, two surfaces: on the plate ${f3(TW.a)} want ${f3(TW.wantA)} · on the twin ${f3(TW.b)} want ${f3(TW.wantB)}`);
R.is(ptNear(TW.a, TW.wantA, 2e-3),
  `one UV island on two surfaces: a drag on the plate stays on the plate, though the twin 6 m away comes first under every texel`);
R.is(ptNear(TW.b, TW.wantB, 2e-3),
  `…and a drag on the twin, the same island one whole tile over, stays on the twin — found only because each triangle is filed once per tile it crosses`);

console.log("\n=== (d) the decal deleted while it is held ===");
const GONE = { corner3: "a corner in 3-D", body3: "the body in 3-D (Moving)", body2: "the body on the sheet" };
for (const [k, what] of Object.entries(GONE)) {
  const g = o.gone[k];
  console.log(`   ${what}: ${g.before} → Delete ${g.deleted} → drop ${g.dropped} · steps ${JSON.stringify(g.steps)} · undo ${g.undone}, again ${g.undone2} · Look ${g.look}, held ${g.held}`);
  R.is(g.before === 1 && g.deleted === 0 && g.dropped === 0 && g.steps.length === 1 && /delete projected decal/.test(g.steps[0]) &&
       g.undone === 1 && g.undone2 === 1 && g.look && !g.held,
    `Delete while holding ${what}: the drop leaves it deleted (${g.dropped} layers, steps ${JSON.stringify(g.steps)}), one undo brings back exactly one layer (${g.undone}, then ${g.undone2}) with its Look showing`);
}
const UN = o.undone;
console.log(`   undone away: ${UN.before} (steps ${JSON.stringify(UN.steps0)}) → Ctrl+Z ${UN.undone} → drop ${UN.dropped} · steps ${JSON.stringify(UN.steps)}, redo ${UN.redo} · redone ${UN.redone}`);
R.is(UN.before === 1 && UN.undone === 0 && UN.dropped === 0 && UN.steps && UN.steps.length === 0 && UN.redo === 1 && UN.redone === 1,
  `Ctrl+Z while holding a corner of a decal whose projection is the last step: the drop leaves it undone (${UN.dropped} layers, steps ${JSON.stringify(UN.steps)}) with the redo kept (${UN.redo}), and the redo brings back exactly one layer (${UN.redone})`);

console.log("\n=== (c) the slider gate ===");
console.log(`   one slow render: ${o.gate1} renders from 3 inputs · always slow: ${o.gate2.n} renders, idle ${JSON.stringify(o.gate2.idle)} ms · fast again: ${o.gate3.n} renders, the first ${o.gate3.first} ms after the last slow one ended`);
console.log(`   slower than 250 ms: ${o.gate4.n} renders of ${o.gate4.R} ms, idle ${JSON.stringify(o.gate4.idle)} ms, busy ${o.gate4.busy} once closed`);
R.is(o.gate1 === 3, `one render over budget does not switch slider preview off (${o.gate1} of 3 inputs rendered) — it did until 2026-09-26`);
const g2 = o.gate2.idle;
R.is(g2.length >= 3 && g2[0] < 240 && g2.slice(1).every(d => d >= 245),
  `always slow, it closes on the SECOND slow render and then leaves the thread 250 ms between one render's end and the next, instead of rendering every frame (idle ${JSON.stringify(g2)} ms)`);
R.is(o.gate2.n >= 4, `…and it keeps rendering while closed rather than latching off (${o.gate2.n} renders in 1.1 s)`);
R.is(o.gate3.n >= 8 && o.gate3.first != null && o.gate3.first <= 400,
  `one fast render reopens it: ${o.gate3.n} renders in 0.7 s, the first ${o.gate3.first} ms after the last slow one ended (250 and a frame or two)`);
const g4 = o.gate4;
R.is(g4.idle.length >= 3 && g4.idle[0] < 240 && g4.idle.slice(1).every(d => d >= 2 * g4.R - 5),
  `renders SLOWER than 250 ms (${g4.R} ms): closed, the thread is left twice the render between one render's end and the next — a third of it at most (busy ${g4.busy}) — where a gate timed from a render's start ran them back to back (idle ${JSON.stringify(g4.idle)} ms)`);

R.is(!(o.__errs && o.__errs.length) && !(o.__rejs && o.__rejs.length),
  `no uncaught error or rejection in the page (${JSON.stringify((o.__errs || []).concat(o.__rejs || [])).slice(0, 200)})`);
R.finish();
