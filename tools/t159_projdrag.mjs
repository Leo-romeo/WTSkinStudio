// A dragged projected decal follows without a ghost, and settles exactly where it is put (ROADMAP 1.18).
//
// WHY THIS EXISTS. Every live frame of a drag re-projected the WHOLE sheet — the layer cleared whole,
// every window cleared, drawn and blitted — and composited and uploaded it with no rectangle. Measured
// 2026-10-23 in software GL, one 512 × 256 decal: 109 ms a frame at 2048², 338 at 4096², the composite
// 13 and 55 on top. At 8192² the projection trailed the handles by frames: the ghost the owner reported.
// A live frame now costs what the decal covers (`ProjDrag`): a scout finds where it lands, only the old
// box and the new one are cleared, re-projected — reduced while it moves on a sheet longer than 2048 —
// and composited, and 150 ms after the last live frame the sheet is projected as a placement projects it.
//
// In the real page, on a plate filling a 4096 × 2048 sheet (so a moving frame is drawn at half scale):
//   * while it moves, every frame is drawn reduced and composites a rectangle, never the whole sheet;
//   * after a run of moves no texel outside the decal's own place holds paint — no trail;
//   * 150 ms after the last move the settled frame is byte-identical to a placement at that point;
//   * a slow move is drawn at full resolution, and one that changes nothing after settling draws nothing;
//   * the drop is byte-identical to a decal placed there directly, without a drag;
//   * a drop before the settle timer fires is not followed by a late live render;
//   * the outline slider moved after a settle re-projects every step and settles to a placement's bytes;
//   * with the sliders' gate closed, no settle comes between the steps it lets through, and the
//     settle's full render is not counted as a step's cost;
//   * a 1-px column on the decal's edge is not left behind by the first move, at four phases.
//
// Usage: node tools/t159_projdrag.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  // Until the settled frame after \`base\` has been drawn (ProjDrag.stats.settled passes it), then two
  // frames — not a fixed 260 ms, which is the 150 ms settle plus a guess at a frame and stops being
  // long enough on a loaded machine (ROADMAP 0.6 (b)). A settle that never comes gives up at 5 s and
  // the check that reads the count fails, as it did with the sleep.
  var settles = function(base){
    var t0 = Date.now();
    return new Promise(function(res){
      (function poll(){ if (ProjDrag.stats.settled > base || Date.now() - t0 > 5000) return res(); requestAnimationFrame(poll); })();
    }).then(frame).then(frame);
  };
  var V3= function(x, y, z){ return new THREE.Vector3(x, y, z); };
  var W = 4096, H = 2048;
  // the plate: x in [−2, 2], y in [−1, 1], its UVs the whole sheet — 1024 texels a metre both ways
  var cs = [[-2, -1], [2, -1], [2, 1], [-2, 1]], idx = [0, 1, 2, 0, 2, 3];
  var pos = new Float32Array(18), nrm = new Float32Array(18), uv = new Float32Array(12);
  idx.forEach(function(ci, k){ var c = cs[ci]; pos[k*3] = c[0]; pos[k*3+1] = c[1]; nrm[k*3+2] = 1; uv[k*2] = (c[0] + 2) / 4; uv[k*2+1] = (c[1] + 1) / 2; });
  var gd = { name: "plate", mat: "m149", position: pos, normal: nrm, uv: uv };
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x808080 })); mesh.name = "plate"; mesh.userData = { mat: "m149" };
  var group = new THREE.Group(); group.add(mesh); scene.add(group); group.updateMatrixWorld(true);
  var flat = function(hex){ var c = mkCanvas(W, H), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, W, H); return c; };
  var s = { id: "t159", cStem: "t159", layers: [], size: W, sizeH: H, missing: false, cEdited: true,
            baseC: flat("#808080"), composite: flat("#808080"), smooth: flat("#505050"), metal: flat("#303030"), normal: flat("#8080ff") };
  App.slots = new Map([["t159", s]]); App.activeSlot = s; App.geomData = [gd];
  App.meshes = new Map([["plate", mesh]]); App.matSlot = new Map([["m149", "t159"]]);
  App.selParts = new Set(); App.protectedParts = new Set(); App.modelSize = { x: 4, y: 2, z: 1 };
  App._projGL = null;
  modelGroup = group;
  document.getElementById("symOn").checked = false;
  document.getElementById("optFlipV").checked = false;
  if (App.paint3d) setPaint3d(false);
  setPlacing(false);
  cam.fly = false; cam.target.set(0, 0, 0); cam.theta = Math.PI / 2; cam.phi = Math.PI / 2; cam.dist = 6;
  resize3D(); syncCamera();
  var decal = function(name){
    var bmp = mkCanvas(128, 64); ctx2d(bmp).fillStyle = "#e02020"; ctx2d(bmp).fillRect(0, 0, 128, 64);
    return LayerNode.of({ type: "decal", name: name, bmp: bmp, x: .5, y: .5, scale: .25, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal" });
  };
  var D = decal("d149");
  s.layers = [D]; App.activeLayer = D;
  bakeProjection(D, { point: V3(0, 0, 0) });
  var PL = App.activeLayer, P = PL && PL.proj;
  if (!P) { out.err = "no projection"; return out; }
  App.undoStack.length = 0; App.redoStack.length = 0;
  var data = function(c){ return ctx2d(c || PL.canvas).getImageData(0, 0, W, H).data; };
  var same = function(a, b){ if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  var diff = function(a, b){ var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  // a placement's render of P as it stands, on a fresh canvas
  var placed = function(){ var c = mkCanvas(W, H); renderProjection(c, P, frameFromArrays(P.frame), s, false); return data(c); };
  // where the decal is on the sheet: its centre (x, y) m ± half a decal, as texels
  var outside = function(x, y){
    var d = data(), hw = projHalfSize(P).halfW, hh = projHalfSize(P).halfH, n = 0, m = 8;
    var x0 = (x - hw + 2) * 1024 - m, x1 = (x + hw + 2) * 1024 + m, y0 = (1 - (y + hh)) * 1024 - m, y1 = (1 - (y - hh)) * 1024 + m;
    for (var py = 0; py < H; py++) for (var px = 0; px < W; px++) {
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) continue;
      if (d[(py * W + px) * 4 + 3]) n++;
    }
    return n;
  };
  var calls = [], keep = scheduleComposite;
  scheduleComposite = function(slot, rect){ if (slot === s) calls.push(rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null); return keep(slot, rect); };
  var from = projParamsClone(P), st0 = Object.assign({}, ProjDrag.stats);

  // ---- a run of moves ----
  // One move a frame, as a hand drags — and ProjDrag's settle timer held until the run is over
  // (ROADMAP 0.6 (b)). On a loaded machine a frame here took longer than SETTLE_MS: measured
  // 2026-10-24 at 3 lanes, the settle fired between two moves and its full render's whole-sheet
  // composite failed "never the sheet" — the page doing right by a hand that had stopped, not the bug
  // the check is for. Released, the timer is re-armed at its full delay, so it settles after the last.
  var holdSettle = function(){
    var q = [], id = 0, st = window.setTimeout, ct = window.clearTimeout;
    window.setTimeout = function(fn, ms){
      if (typeof fn === "function" && fn.name === "settle") { q.push({ id: --id, fn: fn, ms: ms }); return id; }
      return st.apply(window, arguments);
    };
    window.clearTimeout = function(i){ if (i < 0) q = q.filter(function(t){ return t.id !== i; }); else ct.call(window, i); };
    return function(){ window.setTimeout = st; window.clearTimeout = ct; q.forEach(function(t){ ProjDrag.timer = st(t.fn, t.ms); }); };
  };
  var path = [[.3, .1], [.6, .2], [.9, .25], [1.2, .3], [1.4, .35]];
  var releaseSettle = holdSettle();
  try { for (var i = 0; i < path.length; i++) { moveProjTo(P, V3(path[i][0], path[i][1], 0), true); await frame(); } }
  finally { releaseSettle(); }
  var st1 = Object.assign({}, ProjDrag.stats);
  out.moving = { scaled: st1.scaled - st0.scaled, region: st1.region - st0.region, calls: calls.slice(), whole: calls.filter(function(c){ return !c; }).length,
                 big: calls.filter(function(c){ return c && c.w * c.h > W * H / 4; }).length, outside: outside(1.4, .35) };

  // ---- held still: the settled frame ----
  calls.length = 0;
  await settles(st1.settled);
  var st2 = Object.assign({}, ProjDrag.stats);
  out.settled = { n: st2.settled - st1.settled, same: same(data(), placed()), diff: diff(data(), placed()) };

  // ---- a slow move, then one that changes nothing ----
  moveProjTo(P, V3(1.4 + .0005, .35, 0), true); await frame();
  var st3 = Object.assign({}, ProjDrag.stats);
  await settles(st3.settled);
  var st4 = Object.assign({}, ProjDrag.stats);
  projLiveRender(P); await frame();
  var st5 = Object.assign({}, ProjDrag.stats);
  out.slow = { region: st3.region - st2.region, scaled: st3.scaled - st2.scaled, settled: st4.settled - st3.settled, same: st5.same - st4.same };

  // ---- the outline slider after a settle: each step re-projects, and settles to a placement's bytes ----
  var before = data();
  P.surf = Object.assign({}, P.surf || surfDeltas(SURF_PRESETS.none), { ol: 40 });
  projLiveRender(P); await frame();
  var st6s = Object.assign({}, ProjDrag.stats), stepped = data();
  await settles(st6s.settled);
  out.style = { same: st6s.same - st5.same, changed: !same(before, stepped), settled: same(data(), placed()) };
  P.surf = Object.assign({}, P.surf, { ol: 0 });
  projLiveRender(P); await frame(); await settles(st6s.settled + 1);

  // ---- the drop, against a decal placed there directly ----
  var res = updateProjGroup(P, "move projected decal", from);
  var dropped = data(), steps = App.undoStack.length;
  var D2 = decal("d149b");
  s.layers.push(D2); App.activeLayer = D2;
  var here = P.frame.p;
  bakeProjection(D2, { point: V3(here[0], here[1], here[2]) });
  var P2L = App.activeLayer;
  out.drop = { drawn: res.drawn, same: same(dropped, data(P2L.canvas)), diff: diff(dropped, data(P2L.canvas)), steps: steps };
  // take the direct one away again
  s.layers = s.layers.filter(function(L){ return L !== P2L; });

  // ---- a drop before the settle timer ----
  App.activeLayer = PL;
  var from2 = projParamsClone(P);
  moveProjTo(P, V3(.2, -.2, 0), true); await frame();
  var st6 = Object.assign({}, ProjDrag.stats);
  updateProjGroup(P, "move projected decal", from2);
  var atDrop = data();
  await wait(320); await frame(); await frame();
  var st7 = Object.assign({}, ProjDrag.stats);
  out.early = { scaled: st6.scaled - st5.scaled, settledAfter: st7.settled - st6.settled, unchanged: same(atDrop, data()), outside: outside(.2, -.2) };

  // ---- a slider on a machine slow enough to close the gate (decals.js's ProjLive) ----
  // Steps every 30 ms for 1.2 s, most held back by the gate: no settle between the ones it lets
  // through, one after the last, and the settle's full render is not counted as a step's cost.
  // On a clock the test drives (ROADMAP 0.5): performance.now() reads \`vt\`, each live render costs
  // 100 ms of it — the slow machine ProjLive.ms = [100, 100] says this is — ProjDrag's settle timer
  // (its callback is named \`settle\`) is queued on it, and a step comes every 30 ms of it. On real time
  // this failed three times at 6 lanes on 2026-10-23 with no code changed: a loaded machine stretched
  // a 30 ms step past SETTLE_MS (150 ms), so the page was right to settle between two steps.
  var realNow = performance.now, realST = window.setTimeout, realCT = window.clearTimeout, realRender = renderProjGroup;
  var vt = realNow.call(performance), vq = [], vid = 0;
  var advance = function(ms){
    var end = vt + ms;
    for (;;) {
      vq.sort(function(x, y){ return x.at - y.at; });
      if (!vq.length || vq[0].at > end) break;
      var t = vq.shift(); vt = Math.max(vt, t.at); t.fn();
    }
    vt = end;
  };
  performance.now = function(){ return vt; };
  window.setTimeout = function(fn, ms){
    if (typeof fn === "function" && fn.name === "settle") { vq.push({ id: --vid, at: vt + (+ms || 0), fn: fn }); return vid; }
    return realST.apply(window, arguments);
  };
  window.clearTimeout = function(id){ if (id < 0) vq = vq.filter(function(t){ return t.id !== id; }); else realCT.call(window, id); };
  renderProjGroup = function(P, live){ var r = realRender(P, live); vt += 100; return r; };
  try {
    ProjLive.ms = [100, 100]; ProjLive.end = performance.now();
    var st8 = Object.assign({}, ProjDrag.stats), rot0 = P.rot, let8 = 0;
    for (var i = 0; i < 40; i++) { advance(30); P.rot = rot0 + i + 1; if (ProjLive.ok()) { projLiveRender(P); let8++; } await frame(); }
    await frame(); await frame();
    var st9 = Object.assign({}, ProjDrag.stats), ms9 = ProjLive.ms.join();
    advance(400); await frame(); await frame();
  } finally {
    performance.now = realNow; window.setTimeout = realST; window.clearTimeout = realCT; renderProjGroup = realRender;
    vq.length = 0;
  }
  var st10 = Object.assign({}, ProjDrag.stats);
  out.gate = { let: let8, during: st9.settled - st8.settled, after: st10.settled - st9.settled, ms: ms9 === ProjLive.ms.join() };
  P.rot = rot0; ProjLive.ms = [0, 0];
  updateProjGroup(P, "turn projected decal", projParamsClone(P));

  // ---- a 1-px column on the decal's edge, at four phases of the sheet's texels ----
  // The probe that boxes a placement sampled a 2 × 2 patch of each 16-texel cell, so it saw a column
  // that thin at 2 phases in 16 and the first move left it behind (review of 1.18).
  var thin = [];
  for (var ph = 0; ph < 4; ph++) {
    var bmp = mkCanvas(128, 64), tg = ctx2d(bmp);
    tg.fillStyle = "#e02020"; tg.fillRect(0, 0, 96, 64); tg.fillRect(127, 0, 1, 64);
    var D3 = LayerNode.of({ type: "decal", name: "thin" + ph, bmp: bmp, x: .5, y: .5, scale: .25, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal" });
    s.layers = [D3]; App.activeLayer = D3;
    bakeProjection(D3, { point: V3(-1 + ph * 3 / 1024, .2, 0) });
    PL = App.activeLayer; P = PL.proj;
    var f3 = projParamsClone(P);
    // away from the column's side: the clear is the box round the old place and the new, so a move
    // toward the column would sweep it up whatever the probe had seen
    moveProjTo(P, V3(-1.6, -.3, 0), true); await frame();
    thin.push(outside(-1.6, -.3));
    updateProjGroup(P, "move projected decal", f3);
  }
  out.thin = thin;
  scheduleComposite = keep;
  scene.remove(group);
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep"), chromeArgs: ["--window-size=1280,960"] });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw || o.err) { R.bad("threw: " + (o.__threw || o.err)); R.finish(); }
console.log("  " + JSON.stringify({ moving: { ...o.moving, calls: o.moving.calls.length }, settled: o.settled, slow: o.slow, drop: o.drop, early: o.early }));
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
const M = o.moving;
R.is(M.scaled >= 4 && M.region === 0, `while it moves on a 4096 × 2048 sheet every frame is drawn reduced (${M.scaled} reduced, ${M.region} at full size)`);
R.is(M.calls.length >= 4 && M.whole === 0 && M.big === 0,
  `…and composites a rectangle round the decal, never the sheet (${M.calls.length} composites, ${M.whole} whole, ${M.big} over a quarter of it)`);
R.is(M.outside === 0, `after five moves no texel outside the decal's own place holds paint — no trail (${M.outside})`);
R.is(o.settled.n === 1 && o.settled.same, `held still, it settles once, byte-identical to a placement there (${o.settled.n} settled frame, ${o.settled.diff} bytes differ)`);
R.is(o.slow.region === 1 && o.slow.scaled === 0 && o.slow.settled === 1 && o.slow.same === 1,
  `a slow move is drawn at full size (${o.slow.region}, ${o.slow.scaled} reduced) and settles (${o.slow.settled}); a frame that changes nothing after that draws nothing (${o.slow.same})`);
R.is(o.drop.drawn > 0 && o.drop.same && o.drop.steps === 1,
  `the drop is byte-identical to a decal placed there without a drag (${o.drop.diff} bytes differ), one undo step (${o.drop.steps})`);
R.is(o.style.same === 0 && o.style.changed && o.style.settled,
  `the outline slider after a settle re-projects each step (${o.style.same} called "same", changed ${o.style.changed}) and settles to a placement's bytes (${o.style.settled})`);
R.is(o.gate.let >= 2 && o.gate.during === 0 && o.gate.after === 1 && o.gate.ms,
  `with the sliders' gate closed, the steps it lets through (${o.gate.let}) settle only after the last (${o.gate.during} between, ${o.gate.after} after), and the settle is not counted as a step's cost (${o.gate.ms})`);
R.is(o.thin.every(n => n === 0), `a 1-px column on the decal's edge is not left behind by the first move, at any of four phases (${o.thin.join(", ")} texels)`);
R.is(o.early.scaled === 1 && o.early.settledAfter === 0 && o.early.unchanged && o.early.outside === 0,
  `a drop before the settle timer is not followed by a late live render (${o.early.settledAfter} settled after, unchanged ${o.early.unchanged}, ${o.early.outside} texels left behind)`);
R.finish();
