// A projected decal's image can be edited after it is projected (ROADMAP 4.2, "re-edit an
// already-projected decal", re-requested 2026-08-23).
//
// WHY THIS EXISTS. `btnDecalEditor` answered `type === "decal"` only, and a projection is a `paint`
// layer carrying `proj`, so the moment a decal was projected its image was fixed: background
// removal, crop and adjust were out of reach for good. The fix is small — the image is a projection
// PARAMETER like its frame (`ProjSource` in editor/projection.js) — and every way it can be wrong
// is quiet, so each is asserted on the SHEET, through the real button and the real dialog:
//
//   * "Use this decal" re-PROJECTS: the keyed-out background leaves the model and the Look's derived
//     smoothness leaves with it. 4.2's own bullet records the trap — a recomposite refreshes the
//     thumbnail and neither view, because a projection's pixels live in its layer's own canvas;
//   * the frame is kept, and so is the marking's SIZE: a crop or a quarter turn changes the image's
//     width, and `projHalfSize` spreads the whole width over `scale`, so without the rescale a
//     cropped marking comes back twice as wide;
//   * it is ONE undo step that carries the old image, and undo puts back the very pixels. A canvas
//     serialises as `{}`, so the JSON comparison the step used to be gated on called a same-size
//     edit "a click that didn't move it" and pushed nothing;
//   * the Look survives an edit that did not touch it. The dialog's select can only name a preset,
//     and rebuilding from that name replaced a Look a depth map had given an Emboss — floating
//     decals too;
//   * the 3-D ring follows (its key held no number that a background key-out changes);
//   * the text tool's API (4.50(3)): `ProjSource.set` takes a bitmap directly, refuses a field it
//     cannot undo, and a field added to `ProjSource.FIELDS` gets its undo step for nothing;
//   * a .wtproj round trip keeps the edited image, its size and `sym2Read` — which was never
//     written, so a reload turned a mirrored copy's lettering backwards at the first re-render;
//   * a decal deleted while its dialog is open stays deleted: shortcuts still run under the dialog,
//     and re-rendering a projection with no layers left adds layers.
//
// The review (2026-09-26) found five more that the rig above could not see, because it was the one
// case where each is invisible — a bar exactly centred in its box, no depth map, no outline, a scale
// inside the Size range, a Look named after a preset. Each has a decal of its own at the end:
//
//   * an OFF-centre marking cropped to content stays where it is (the frame's point is the image's
//     centre, and an uneven crop moves the centre) — its true-reflection copy with it, and a
//     readable copy, which the margin had held off the mirror, lands exactly opposite and says so;
//   * the relief's depth map is cropped and turned with the image, and a normal map's vectors turn
//     with its pixels — against a decal projected fresh from a hand-cut image and map, byte for byte;
//   * a same-width edit keeps a scale outside the Size range;
//   * the editor's Look select names what the Look IS ("Custom" when no preset), and picking the
//     preset a Look was only named after applies it;
//   * an outline keeps its width through a crop;
//   * and an undo that reaches the decal while its editor is open makes Use refuse, not misapply.
//
// Usage: node tools/t91_reedit.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  // The source: a red bar in the middle of a white box — the white is what "remove the background"
  // keys out, the red is the marking. Centred, so a crop to content keeps the centre where it was.
  var mkSrc = function(){
    var c = mkCanvas(80, 40), g = ctx2d(c);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 80, 40);
    g.fillStyle = "#ff0000"; g.fillRect(20, 10, 40, 20);
    return c;
  };
  // What the projection put on the sheet. "Red" is t < .5 across the red/white edge both before and
  // after the key: g < 128 at full alpha before, alpha > 128 after — the same texels either way.
  var census = function(L){
    var c = L.canvas, w = c.width, h = c.height, d = ctx2d(c).getImageData(0, 0, w, h).data;
    var red = 0, white = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = (y * w + x) * 4, r = d[k], g = d[k+1], b = d[k+2], a = d[k+3];
      if (a > 128 && r > 160 && g < 128 && b < 128) {
        red++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      } else if (a > 200 && r > 200 && g > 200 && b > 200) white++;
    }
    return { red: red, white: white, w: red ? x1 - x0 + 1 : 0, h: red ? y1 - y0 + 1 : 0,
             cx: red ? Math.round(sx / red * 10) / 10 : -1, cy: red ? Math.round(sy / red * 10) / 10 : -1,
             box: red ? [x0, y0, x1, y1] : null };
  };
  var bytes = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var diff = function(a, b){ var off = 0, worst = 0; for (var i = 0; i < a.length; i++) { var q = Math.abs(a[i] - b[i]); if (q) off++; if (q > worst) worst = q; } return { off: off, worst: worst }; };
  var smAt = function(x, y){ return ctx2d(chanOut(S, "smooth")).getImageData(x, y, 1, 1).data[0]; };
  var status = function(){ return document.getElementById("status").textContent; };
  var dlgEl = function(){ var all = document.querySelectorAll("#modalHost .modal"); return all.length ? all[all.length - 1] : null; };
  var btnIn = function(el, re){ return [].slice.call(el.querySelectorAll("button")).filter(function(b){ return re.test(b.textContent); })[0] || null; };
  // Every edit below goes through the real button and the real dialog.
  var openEd = async function(){ document.getElementById("btnProjEdit").click(); await frame(); return dlgEl(); };
  var use = async function(ov){ btnIn(ov.querySelector(".foot"), /Use this decal/).click(); await frame(); compositeChannels(S); flushComposites(); };
  var steps = function(){ return App.undoStack.length; };

  // ---- a flat plate facing the projector, one sheet (t58's rig) ----
  var quad = function(name, mat){
    var idx = [0, 1, 2, 0, 2, 3], corners = [[-2,-2,0], [2,-2,0], [2,2,0], [-2,2,0]], uvc = [[0,0], [1,0], [1,1], [0,1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2]; nor[k*3+2] = 1; uv[k*2] = t[0]; uv[k*2+1] = t[1];
    }
    return { name: name, mat: mat, position: pos, normal: nor, uv: uv };
  };
  var S = { id: "t91", size: N, nSize: N, layers: [], missing: false };
  S.baseC = flat("#404040"); S.composite = flat("#404040");
  S.smooth = flat("#505050"); S.metal = flat("#303030"); S.normal = flat("#8080ff");
  App.slots.set("t91", S); App.activeSlot = S; App.activeLayer = null;
  App.geomData = [quad("plate", "pmat")];
  App.meshes = new Map([["plate", { visible: true, userData: { mat: "pmat" }, material: null }]]);
  App.matSlot = new Map([["pmat", "t91"]]);
  App.modelSize = { x: 10, y: 10, z: 10 };
  App.selParts = new Set(); App.protectedParts = new Set();
  App._projGL = null;
  out.mode = projGL() ? "gl" : "canvas";
  // A Look no preset names: the Gloss is its own and the Emboss is the 8 a depth map load gives a
  // Look that had none. The dialog shows it as "Painted on", its preset name.
  var LOOK = { sm: 40, mt: 0, em: 8, wr: 0, preset: "painted", relief: "edge" };
  var src0 = mkSrc();
  var P = { id: "p91", frame: { p: [0, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
            bmp: src0, scale: 1, rot: 0, flip: false, sym2: false, sym2Read: false, name: "bar",
            surf: Object.assign({}, LOOK), depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF, parts: null };
  renderProjGroup(P);
  var L = layerLeaves(S.layers).filter(function(l){ return l.proj === P; })[0];
  compositeChannels(S); flushComposites();
  var frame0 = JSON.stringify(P.frame);
  var c0 = census(L), sheet0 = bytes(L.canvas);
  // where to look, read off the sheet rather than predicted: the bar's centre, and a texel of the
  // white box on the same row, 6 texels in from the box's own left edge
  var row = Math.round(c0.cy), rx = Math.round(c0.cx), wx = -1;
  (function(){ var d = bytes(L.canvas); for (var x = 0; x < N; x++) { var k = (row * N + x) * 4; if (d[k+3] > 200 && d[k+1] > 200) { wx = x + 6; break; } } })();
  out.c0 = c0; out.at = { row: row, rx: rx, wx: wx };
  out.sm0 = { box: smAt(wx, row), bar: smAt(rx, row), base: 0x50 };

  // ---- 1. the Projected image panel offers the editor, and it opens on the image as projected ----
  App.activeLayer = L; refreshLayerList();
  var bp = document.getElementById("btnProjEdit");
  out.panel = { proj: document.getElementById("projSection").style.display !== "none",
                floating: document.getElementById("decalSection").style.display !== "none",
                button: !!bp, title: bp ? bp.title : "" };
  var key0 = SelOverlay.decalKey(L), undo0 = steps();
  var ov = await openEd();
  var pv = ov.querySelector(".body canvas"), sels = ov.querySelectorAll(".body select");
  var hints = [].slice.call(ov.querySelectorAll(".body .hint")).map(function(h){ return h.textContent; });
  out.open = { dialog: !!ov, who: openDecalEditor.open, w: pv.width, h: pv.height,
               px: [].slice.call(ctx2d(pv).getImageData(4, 4, 1, 1).data), key: sels[0].value, look: sels[1].value,
               lookText: sels[1].options[sels[1].selectedIndex].textContent,
               note: hints.filter(function(t){ return /Gloss/.test(t); })[0] || "" };

  // ---- 2. key the white out, Use: re-projected where it was, one step, the Look untouched ----
  sels[0].value = "white"; sels[0].onchange();
  await use(ov);
  var c1 = census(L), sheet1 = bytes(L.canvas);
  var top = App.undoStack[App.undoStack.length - 1];
  out.key = { closed: !dlgEl() && !openDecalEditor.open, swapped: P.bmp !== src0, w: P.bmp.width, scale: P.scale,
              frameKept: JSON.stringify(P.frame) === frame0, c: c1, steps: steps() - undo0,
              desc: top && top.desc, bytes: top && top.bytes, want: 2 * 80 * 40 * 4,
              sm: { box: smAt(wx, row), bar: smAt(rx, row) },
              look: [P.surf.sm, P.surf.em, P.surf.preset, P.surf.relief].join(","),
              ring: SelOverlay.decalKey(L) !== key0, said: status() };

  // ---- 3. undo puts the very pixels back; redo the edited ones ----
  doUndo(); compositeChannels(S); flushComposites();
  out.undo = { bmp: P.bmp === src0, scale: P.scale, sheet: diff(bytes(L.canvas), sheet0), sm: smAt(wx, row), ring: SelOverlay.decalKey(L) === key0 };
  doRedo(); compositeChannels(S); flushComposites();
  out.redo = { swapped: P.bmp !== src0 && P.bmp.width === 80, sheet: diff(bytes(L.canvas), sheet1) };

  // ---- 4. crop to content: the image loses its margin and the marking keeps its size ----
  ov = await openEd();
  var crop = ov.querySelector(".body input[type=checkbox]");
  crop.checked = true; crop.onchange();
  out.cropPreview = [ov.querySelector(".body canvas").width, ov.querySelector(".body canvas").height];
  await use(ov);
  out.crop = { w: P.bmp.width, h: P.bmp.height, scale: P.scale, frameKept: JSON.stringify(P.frame) === frame0, c: census(L) };

  // ---- 5. a quarter turn: the marking turns in place, the same size ----
  ov = await openEd();
  btnIn(ov.querySelector(".body"), /⟳ 90°/).click();
  await use(ov);
  out.turn = { w: P.bmp.width, h: P.bmp.height, scale: P.scale, frameKept: JSON.stringify(P.frame) === frame0, c: census(L) };

  // ---- 6. Use with nothing touched changes nothing and costs no step ----
  var bmpNow = P.bmp, n6 = steps();
  ov = await openEd();
  await use(ov);
  out.noop = { same: P.bmp === bmpNow, steps: steps() - n6, said: status() };

  // ---- 7. a Look picked in the dialog does apply — the preset the decal was NAMED after as well ----
  // The Look is Gloss 40 / Emboss 8 under the name "painted". The select used to open on "Painted
  // on", so picking Painted on was picking the value it already had, and Use kept 40 / 8.
  var n7 = steps();
  ov = await openEd();
  var lookSel = ov.querySelectorAll(".body select")[1];
  var shown7 = lookSel.value;
  lookSel.value = "painted"; lookSel.onchange();
  await use(ov);
  out.painted = { shown: shown7, look: [P.surf.preset, P.surf.sm, P.surf.em, P.surf.relief].join(","), steps: steps() - n7, bar: smAt(rx, row) };
  n7 = steps();
  ov = await openEd();
  lookSel = ov.querySelectorAll(".body select")[1];
  // now the numbers ARE a preset's, so the select names it and offers no "Custom"
  out.painted.reopen = { shown: lookSel.value, own: [].slice.call(lookSel.options).some(function(o){ return o.value === "own"; }) };
  lookSel.value = "vinyl"; lookSel.onchange();
  await use(ov);
  out.vinyl = { look: [P.surf.preset, P.surf.sm, P.surf.em, P.surf.relief].join(","), steps: steps() - n7, bar: smAt(rx, row) };

  // ---- 8. the floating decal's editor keeps an untouched Look too, and "no Look" stays none ----
  var F = LayerNode.of({ type: "decal", name: "float", bmp: mkSrc(), x: .5, y: .2, scale: 1, rot: 0, flip: false,
                         visible: true, opacity: 1, blend: "normal", surf: Object.assign({}, LOOK) });
  S.layers.push(F); App.activeLayer = F; refreshLayerList();
  document.getElementById("btnDecalEditor").click(); await frame();
  await use(dlgEl());
  out.floatLook = F.surf ? [F.surf.sm, F.surf.em, F.surf.preset].join(",") : null;
  F.surf = undefined;
  document.getElementById("btnDecalEditor").click(); await frame();
  var fov = dlgEl(), fLook = fov.querySelectorAll(".body select")[1].value;
  await use(fov);
  out.floatNone = { shown: fLook, after: F.surf == null ? "none" : JSON.stringify(F.surf) };
  var fo = nodeOwner(S.layers, F); if (fo) fo.list.splice(fo.i, 1);
  App.activeLayer = L; refreshLayerList();

  // ---- 9. the API the text tool builds on ----
  var gen = mkCanvas(60, 30); (function(){ var g = ctx2d(gen); g.fillStyle = "#ff0000"; g.fillRect(0, 0, 60, 30); })();
  var s9 = P.scale, w9 = P.bmp.width, n9 = steps();
  var r9 = ProjSource.set(P, { bmp: gen }, "edit projected text");
  out.api = { drawn: !!(r9 && r9.drawn), scale: P.scale, want: s9 * 60 / w9, frameKept: JSON.stringify(P.frame) === frame0, steps: steps() - n9 };
  try { ProjSource.set(P, { bogus: 1 }); out.api.refused = false; } catch (e) { out.api.refused = /bogus/.test(e.message); }
  // "text" has been one of the FIELDS since the text tool landed (4.50 (3), t113); a record there
  // still has to undo and redo through set() with nothing else written for it.
  out.api.inFields = ProjSource.FIELDS.text === "copy";
  P.text = { s: "A" };
  ProjSource.set(P, { text: { s: "B" } }, "edit projected text");
  var tB = P.text.s; doUndo(); var tA = P.text.s; doRedo(); var tB2 = P.text.s;
  out.api.text = [tB, tA, tB2].join("");
  P.text = null;
  // a scale outside the Size range is fitted to it, and says so
  var r9b = ProjSource.set(P, { scale: 9 }, "x");
  out.api.clamp = { scale: P.scale, clamped: !!(r9b && r9b.clamped) };
  doUndo();

  // ---- 10. a .wtproj round trip keeps the edited image, its size and sym2Read ----
  // Back to the keyed 80×40 bar at scale 1 — the editor's own key call, at its default tolerance —
  // so the census compared across the file is the one step 2 measured.
  ProjSource.set(P, { bmp: keyOutBackground(mkSrc(), [255, 255, 255], 25 * 2.2, 45), scale: 1 }, "key");
  P.sym2Read = true;
  var pre = { w: P.bmp.width, h: P.bmp.height, scale: P.scale, surf: JSON.stringify(P.surf), c: census(L) };
  var savedSlots = App.slots;
  App.slots = new Map([["t91", S]]);
  var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  S.layers = [];
  await loadProject(blob);
  var L2 = layerLeaves(S.layers).filter(function(l){ return !!l.proj; })[0], P2 = L2 && L2.proj;
  out.rt = { back: !!P2, pre: pre };
  if (P2) {
    out.rt.got = { w: P2.bmp.width, h: P2.bmp.height, scale: P2.scale, surf: JSON.stringify(P2.surf), sym2Read: P2.sym2Read,
                   frameKept: JSON.stringify(P2.frame) === frame0 };
    renderProjGroup(P2);                                   // re-rendered from what the file said
    out.rt.c = census(L2);
    App.activeLayer = L2; refreshLayerList();
    ov = await openEd();
    out.rt.reopen = ov ? [ov.querySelector(".body canvas").width, ov.querySelector(".body canvas").height] : null;
    if (ov) btnIn(ov.querySelector(".foot"), /Cancel/).click();

    // ---- 11. deleted while its editor was open: Use must not bring it back ----
    // Shortcuts still run under the dialog, so Delete or Ctrl+Z can take the decal away mid-edit —
    // and a re-render of a projection with no layers left ADDS layers, resurrecting it.
    ov = await openEd();
    btnIn(ov.querySelector(".body"), /⟳ 90°/).click();
    deleteProjGroup(P2);
    var n11 = steps();
    await use(ov);
    out.gone = { layers: layerLeaves(S.layers).filter(function(l){ return l.proj === P2; }).length,
                 steps: steps() - n11, said: status() };
  }

  // ==== The review's five findings (2026-09-26), each on a decal of its own ====
  // One projection on the plate at a time, so the channel sheets read below hold only it.
  S.layers = []; compositeChannels(S); flushComposites();
  var mkProj = function(id, src, extra){
    var Q = Object.assign({ id: id, frame: { p: [0, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
              bmp: src, scale: 1, rot: 0, flip: false, sym2: false, sym2Read: false, name: id,
              surf: null, depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF, parts: null }, extra || {});
    renderProjGroup(Q); compositeChannels(S); flushComposites();
    return { P: Q, L: layerLeaves(S.layers).filter(function(l){ return l.proj === Q; })[0] };
  };
  var drop = function(Q){ deleteProjGroup(Q); compositeChannels(S); flushComposites(); };
  var editOn = async function(Lq, fn){ App.activeLayer = Lq; refreshLayerList(); var e = await openEd(); fn(e); await use(e); };
  var keyWhite = function(e){ var s = e.querySelectorAll(".body select")[0]; s.value = "white"; s.onchange(); };
  var cropOn = function(e){ var c = e.querySelector(".body input[type=checkbox]"); c.checked = true; c.onchange(); };
  var turnCw = function(e){ btnIn(e.querySelector(".body"), /⟳ 90°/).click(); };
  var keyed = function(){ return keyOutBackground(mkSrc(), [255, 255, 255], 25 * 2.2, 45); };
  var paint = function(w, h, bg, rects){
    var c = mkCanvas(w, h), g = ctx2d(c); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    rects.forEach(function(r){ g.fillStyle = r[4]; g.fillRect(r[0], r[1], r[2], r[3]); });
    return c;
  };
  // texels of one colour on a layer's own sheet, and where they are
  var tally = function(L, want){
    var c = L.canvas, d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = 0, x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) {
      var k = (y * c.width + x) * 4;
      if (d[k+3] > 128 && want(d[k], d[k+1], d[k+2])) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return { n: n, box: n ? [x0, y0, x1, y1] : null };
  };
  // where the relief bent the normal channel: |R-128| or |G-128| over 8 on the flat #8080ff sheet
  var bent = function(d){
    var n = 0, x0 = N, y0 = N, x1 = -1, y1 = -1, sx = 0, sy = 0;
    for (var i = 0; i < N * N; i++) {
      if (Math.abs(d[i*4] - 128) > 8 || Math.abs(d[i*4+1] - 128) > 8) {
        var x = i % N, y = (i / N) | 0; n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { n: n, box: n ? [x0, y0, x1, y1] : null, cx: n ? Math.round(sx / n * 10) / 10 : -1, cy: n ? Math.round(sy / n * 10) / 10 : -1 };
  };
  var nrm = function(){ return bytes(chanOut(S, "normal")); };

  // ---- 12. an OFF-centre marking cropped to content stays where it is ----
  // The frame's point is the image's centre; a bar 24 source pixels left of it lost 4 px of margin on
  // the left and 52 on the right, so the centre moved and the bar slid its own width with it.
  var q12 = mkProj("p91off", paint(80, 40, "#ffffff", [[4, 10, 24, 20, "#ff0000"]]));
  var f12 = JSON.stringify(q12.P.frame), c12a = census(q12.L), n12 = steps();
  await editOn(q12.L, function(e){ keyWhite(e); cropOn(e); });
  out.off = { a: c12a, b: census(q12.L), w: q12.P.bmp.width, h: q12.P.bmp.height, scale: q12.P.scale,
              moved: JSON.stringify(q12.P.frame) !== f12, steps: steps() - n12, said: status() };
  doUndo(); compositeChannels(S); flushComposites();
  out.off.undo = { frame: JSON.stringify(q12.P.frame) === f12, c: census(q12.L) };
  drop(q12.P);

  // ---- 12b. ...and its mirrored copy: a true reflection stays put, a readable one lands opposite ----
  // Mirrored across x = 0, the plate's middle: the decal on the left half, its copy on the right. A
  // readable copy is the reflection flipped about its OWN centre, so the uneven margin held its bar
  // off the mirror of the marking; with the margin gone it is exactly opposite.
  var redIn = function(L, xa, xb){
    var c = L.canvas, d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = 0, sx = 0, x0 = N, x1 = -1;
    for (var y = 0; y < c.height; y++) for (var x = xa; x < xb; x++) {
      var k = (y * c.width + x) * 4;
      if (d[k+3] > 128 && d[k] > 160 && d[k+1] < 128 && d[k+2] < 128) { n++; sx += x; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
    return { n: n, cx: n ? Math.round(sx / n * 10) / 10 : -1, x0: x0, x1: x1 };
  };
  var axEl = document.getElementById("symAxis"), ax0 = axEl.value, mc0 = App.mirrorCenters, so0 = App.symOffset;
  axEl.value = "x"; App.mirrorCenters = { x: 0, y: 0, z: 0 }; App.symOffset = 0;
  out.sym = {};
  for (var sr = 0; sr < 2; sr++) {
    var qs = mkProj("p91sym" + sr, paint(80, 40, "#ffffff", [[4, 10, 24, 20, "#ff0000"]]),
      { scale: .5, frame: { p: [-1, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, sym2: true, sym2Read: !!sr });
    var sa = { l: redIn(qs.L, 0, N / 2), r: redIn(qs.L, N / 2, N) };
    await editOn(qs.L, function(e){ keyWhite(e); cropOn(e); });
    out.sym[sr ? "readable" : "reflection"] = { a: sa, b: { l: redIn(qs.L, 0, N / 2), r: redIn(qs.L, N / 2, N) }, said: status() };
    drop(qs.P);
  }
  axEl.value = ax0; App.mirrorCenters = mc0; App.symOffset = so0;

  // ---- 13. the relief's depth map is cropped and turned WITH the image ----
  // The map raises the LEFT half of the bar. Oracle: the same decal projected fresh from an image and
  // a map cropped / turned by hand here — the normal sheet must be the same bytes.
  var RELIEF = { sm: 0, mt: 0, em: 8, wr: 0, preset: "custom", relief: "map", heightFrom: "depth" };
  var half = function(){ return paint(80, 40, "#000000", [[20, 10, 20, 20, "#ffffff"]]); };
  var q13 = mkProj("p91relief", mkSrc(), { surf: Object.assign({}, RELIEF), heightMap: half(), heightName: "half.png" });
  var r13 = { a: census(q13.L), na: bent(nrm()) };
  await editOn(q13.L, function(e){ keyWhite(e); cropOn(e); });
  var hm = q13.P.heightMap, hg = ctx2d(toCanvas(hm));
  r13.b = census(q13.L); r13.nbBytes = nrm(); r13.nb = bent(r13.nbBytes);
  r13.hmb = { w: hm.width, h: hm.height, left: hg.getImageData(5, 10, 1, 1).data[0], right: hg.getImageData(30, 10, 1, 1).data[0],
              scale: q13.P.scale, surf: JSON.stringify(q13.P.surf) === JSON.stringify(RELIEF) };
  await editOn(q13.L, turnCw);
  hm = q13.P.heightMap; hg = ctx2d(toCanvas(hm));
  r13.c = census(q13.L); r13.ncBytes = nrm(); r13.nc = bent(r13.ncBytes);
  r13.hmc = { w: hm.width, h: hm.height, top: hg.getImageData(10, 5, 1, 1).data[0], bottom: hg.getImageData(10, 30, 1, 1).data[0], scale: q13.P.scale };
  drop(q13.P);
  // the references, made without the editor: the keyed bar cut out by hand, its map cut the same way
  var refB = mkCanvas(40, 20); ctx2d(refB).drawImage(keyed(), 20, 10, 40, 20, 0, 0, 40, 20);
  var q13b = mkProj("p91refB", refB, { scale: .5, surf: Object.assign({}, RELIEF), heightMap: paint(40, 20, "#000000", [[0, 0, 20, 20, "#ffffff"]]) });
  r13.refB = diff(nrm(), r13.nbBytes); r13.refBn = bent(nrm()).n;
  drop(q13b.P);
  // ...and turned a quarter clockwise: the bar stands 20×40 and its raised left half is its top half
  var q13c = mkProj("p91refC", paint(20, 40, "#ff0000", []), { scale: .25, surf: Object.assign({}, RELIEF),
                    heightMap: paint(20, 40, "#000000", [[0, 0, 20, 20, "#ffffff"]]) });
  r13.refC = diff(nrm(), r13.ncBytes); r13.refCn = bent(nrm()).n;
  drop(q13c.P);
  delete r13.nbBytes; delete r13.ncBytes;
  out.relief = r13;

  // ---- 14. a NORMAL map as the relief source: its vectors turn with its pixels ----
  // A slope facing right, (200,128), turned a quarter clockwise faces down: DirectX green points down,
  // so it reads (127,200) — worked about 127.5, a quarter turn swaps a channel with the other's
  // complement exactly. Through the real dialog on a projected decal, then the other readings direct.
  var nmap = function(r, g){ return paint(80, 40, "rgb(" + r + "," + g + ",255)", []); };
  var NLOOK = { sm: 0, mt: 0, em: 8, wr: 0, preset: "custom", relief: "map", heightFrom: "normal-dx" };
  var q14 = mkProj("p91nm", mkSrc(), { surf: Object.assign({}, NLOOK), heightMap: nmap(200, 128), heightName: "n.png" });
  await editOn(q14.L, turnCw);
  var px = function(img){ var c = toCanvas(img), d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, seen = {};
    for (var i = 0; i < d.length; i += 4) seen[d[i] + "," + d[i+1] + "," + d[i+2]] = 1; return Object.keys(seen).join(" "); };
  out.nm = { dialog: { w: q14.P.heightMap.width, h: q14.P.heightMap.height, px: px(q14.P.heightMap) } };
  drop(q14.P);
  var g90 = { w: 80, h: 40, box: null, rot: 90, flip: false }, gFl = { w: 80, h: 40, box: null, rot: 0, flip: true };
  out.nm.gl90 = px(DecalEd.follow(nmap(200, 128), g90, { heightFrom: "normal-gl" }));
  out.nm.dxFlip = px(DecalEd.follow(nmap(200, 128), gFl, { heightFrom: "normal-dx" }));
  out.nm.dx180 = px(DecalEd.follow(nmap(200, 90), { w: 80, h: 40, box: null, rot: 180, flip: false }, { heightFrom: "normal-dx" }));
  out.nm.depth90 = px(DecalEd.follow(nmap(200, 128), g90, { heightFrom: "depth" }));

  // ---- 15. a same-width edit keeps a scale the Size range does not hold ----
  // 0.03 is below Size's 5 % and reachable: a floating decal can be scaled to 1 % and projected.
  var ms = App.modelSize; App.modelSize = { x: 100, y: 100, z: 100 };
  var q15 = mkProj("p91tiny", mkSrc(), { scale: .03 });
  var c15a = census(q15.L);
  await editOn(q15.L, keyWhite);
  out.tiny = { scale: q15.P.scale, a: c15a, b: census(q15.L), said: status() };
  drop(q15.P);
  App.modelSize = ms;

  // ---- 16. an outline keeps its width through a crop ----
  // 10 % of the keyed 80×40 image's shorter side is 4 px; of the 40×20 bar cropped out of it, 2.
  var green = function(r, g, b){ return g > 160 && r < 128 && b < 128; }, red = function(r, g, b){ return r > 160 && g < 128 && b < 128; };
  var q16 = mkProj("p91ol", keyed(), { surf: { sm: 0, mt: 0, em: 0, wr: 0, preset: "none", ol: 10, olc: "#00ff00" } });
  var o16 = { a: tally(q16.L, green), ra: tally(q16.L, red) };
  await editOn(q16.L, cropOn);
  o16.b = tally(q16.L, green); o16.rb = tally(q16.L, red); o16.ol = q16.P.surf.ol; o16.w = q16.P.bmp.width; o16.scale = q16.P.scale;
  doUndo(); compositeChannels(S); flushComposites();
  o16.undo = { ol: q16.P.surf.ol, g: tally(q16.L, green) };
  out.ol = o16;
  drop(q16.P);

  // ---- 17. an undo that reaches the decal while its editor is open: Use refuses, and says so ----
  // The edit was made from the image the dialog opened on — its crop measured in it, its size kept
  // relative to its width — so applying it over whatever the undo put back would land wrong.
  var q17 = mkProj("p91stale", mkSrc());
  await editOn(q17.L, keyWhite);
  App.activeLayer = q17.L; refreshLayerList();
  var ov17 = await openEd();
  turnCw(ov17);
  doUndo();                                                   // Ctrl+Z under the dialog: the white box is back
  var b17 = q17.P.bmp, n17 = steps();
  await use(ov17);
  out.stale = { kept: q17.P.bmp === b17 && b17.width === 80, steps: steps() - n17, said: status() };
  drop(q17.P);

  App.slots = savedSlots;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const o = run.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const N_SHEET = 256;                                        // the rig's sheet, `N` in the page
const fmt = c => `${c.red} red (${c.w}×${c.h} at ${c.cx},${c.cy}), ${c.white} white`;

console.log(`\n=== re-edit a projected decal (4.2) — projector: ${o.mode} ===`);
console.log(`   projected: ${fmt(o.c0)} · probes: bar x=${o.at.rx}, box x=${o.at.wx}, row ${o.at.row}`);
R.is(o.c0.red > 1500 && o.c0.white > 1500 && o.at.wx > 0, "the rig projects a red bar in a white box onto the plate");
R.is(o.panel.proj && !o.panel.floating && o.panel.button && o.panel.title.length > 40,
  "a projected decal's panel has its own Open decal editor… button — the floating decal's answers type \"decal\" only, and a projection is a paint layer");
R.is(o.open.dialog && o.open.who === "bar" && o.open.w === 80 && o.open.h === 40,
  `it opens the decal editor on the projection's own image (${o.open.w}×${o.open.h}, "${o.open.who}")`);
R.is(o.open.px.join() === "255,255,255,255" && o.open.key === "off",
  "as it is projected now, white box and all, keying nothing until asked (\"Keep as-is\")");
R.is(o.open.look === "own" && /Custom/.test(o.open.lookText) && /Gloss \+40/.test(o.open.note) && /Emboss 8/.test(o.open.note),
  `a Look no preset has the numbers of opens on "${o.open.lookText}", and the note quotes its own Gloss +40 / Emboss 8 — it showed "Painted on" and Painted on's +20 / 0`);

console.log("\n=== Use re-projects the edit, where it was ===");
const K = o.key;
console.log(`   after keying white: ${fmt(K.c)} · smoothness box ${o.sm0.box} → ${K.sm.box}, bar ${o.sm0.bar} → ${K.sm.bar}`);
R.is(K.closed && K.swapped && K.w === 80 && K.scale === 1, "the dialog closes and the projection has the edited image, same width, same scale");
R.is(K.frameKept, "the frame is kept exactly — a re-edit does not move the decal");
R.is(o.c0.white > 1500 && K.c.white === 0, `the keyed-out white is gone from the model (${o.c0.white} → ${K.c.white} texels) — a re-projection, not a recomposite of stale layer pixels`);
R.is(near(K.c.red, o.c0.red, o.c0.red * .02) && K.c.box.join() === o.c0.box.join(),
  `and the marking is untouched: ${o.c0.red} → ${K.c.red} red texels, the same box`);
R.is(o.sm0.box === 0x50 + 40 && K.sm.box === 0x50 && K.sm.bar === 0x50 + 40,
  `the Look is rebuilt from the new footprint: the Gloss leaves the keyed-out box (${o.sm0.box} → ${K.sm.box}) and stays on the bar (${K.sm.bar})`);
R.is(K.look === "40,8,painted,edge",
  `a Look the dialog did not touch comes back as it went in (${K.look}) — rebuilt from its preset name it was Gloss 20, Emboss 0, and a depth map's relief was gone`);
R.is(K.steps === 1 && K.desc === "edit projected decal", `it is one undo step (${K.steps}, "${K.desc}")`);
R.is(K.bytes >= K.want, `and the step is budgeted for the two images it holds (${K.bytes} bytes ≥ ${K.want})`);
R.is(K.ring, "the 3-D ring round the selected decal is rebuilt — its key changes with the image, not only with a number");
R.is(/Re-projected/.test(K.said) && /same size/.test(K.said), `the status line says what happened: “${K.said}”`);

console.log("\n=== undo and redo ===");
console.log(`   undo: ${o.undo.sheet.off} bytes off the original (worst ${o.undo.sheet.worst}) · redo: ${o.redo.sheet.off} off the edit (worst ${o.redo.sheet.worst})`);
R.is(o.undo.bmp && o.undo.scale === 1 && o.undo.sheet.off === 0 && o.undo.sm === 0x50 + 40,
  "undo puts the old image back and re-projects it: the sheet is the original byte for byte, Gloss and all");
R.is(o.undo.ring, "and the ring's key is the original one again");
R.is(o.redo.swapped && o.redo.sheet.off === 0, "redo puts the edit back, byte for byte");

console.log("\n=== the marking keeps its size when the image changes width ===");
const C = o.crop, T = o.turn;
console.log(`   crop: ${C.w}×${C.h} at scale ${C.scale} · ${fmt(C.c)}`);
console.log(`   turn: ${T.w}×${T.h} at scale ${T.scale} · ${fmt(T.c)}`);
R.is(o.cropPreview.join() === "40,20" && C.w === 40 && C.h === 20, `crop to content takes the keyed image down to the bar (${C.w}×${C.h})`);
R.is(near(C.scale, .5, 1e-9) && C.frameKept, `and the scale follows the width (1 → ${C.scale}), so one source pixel stays the size it was`);
R.is(near(C.c.w, o.c0.w, 2) && near(C.c.h, o.c0.h, 2) && near(C.c.red, o.c0.red, o.c0.red * .08) && near(C.c.cx, o.c0.cx, 1) && near(C.c.cy, o.c0.cy, 1),
  `the bar is the same size in the same place (${C.c.w}×${C.c.h} vs ${o.c0.w}×${o.c0.h}) — at the old scale it would be twice as wide`);
R.is(T.w === 20 && T.h === 40 && near(T.scale, .25, 1e-9) && T.frameKept, `a quarter turn makes it ${T.w}×${T.h} at scale ${T.scale}`);
R.is(near(T.c.w, o.c0.h, 2) && near(T.c.h, o.c0.w, 2) && near(T.c.red, o.c0.red, o.c0.red * .08) && near(T.c.cx, o.c0.cx, 1) && near(T.c.cy, o.c0.cy, 1),
  `and the bar turns in place at its own size (${T.c.w}×${T.c.h}, was ${o.c0.w}×${o.c0.h})`);

console.log("\n=== what does not change, and what does ===");
R.is(o.noop.same && o.noop.steps === 0 && /Nothing changed/.test(o.noop.said), `Use with nothing touched changes nothing and pushes no step (“${o.noop.said}”)`);
R.is(o.painted.shown === "own" && o.painted.look === "painted,20,0,edge" && o.painted.steps === 1 && o.painted.bar === 0x50 + 20,
  `picking "Painted on" — the preset this Look was only NAMED after — applies it (${o.painted.look}; Gloss on the model ${o.painted.bar}); it used to be the value the select opened on, so it did nothing`);
R.is(o.painted.reopen.shown === "painted" && !o.painted.reopen.own,
  `a Look whose numbers ARE a preset's opens on that preset, with no "Custom" offered (${o.painted.reopen.shown})`);
R.is(o.vinyl.look === "vinyl,55,6,edge" && o.vinyl.steps === 1 && o.vinyl.bar === 0x50 + 55,
  `a Look picked in the dialog applies, keeping the relief fields (${o.vinyl.look}), in one step, and the Gloss on the model follows (${o.vinyl.bar})`);
R.is(o.floatLook === "40,8,painted", `a FLOATING decal's editor keeps an untouched Look as well (${o.floatLook})`);
R.is(o.floatNone.shown === "none" && o.floatNone.after === "none",
  `and one with no Look opens on "None" and keeps none (${o.floatNone.shown} → ${o.floatNone.after}) — it used to be given "Painted on"`);

console.log("\n=== the API the text tool builds on (4.50(3)) ===");
const A = o.api;
R.is(A.drawn && near(A.scale, A.want, 1e-9) && A.frameKept && A.steps === 1,
  `ProjSource.set takes a generated bitmap: re-projected, the frame kept, the letter size kept (scale ${A.scale.toFixed(4)}), one step`);
R.is(A.refused, "it refuses a field it could not undo, rather than setting it silently");
R.is(A.inFields && A.text === "BAB", `a record in ProjSource.FIELDS — the text tool's, since 4.50 (3) — gets its undo step for nothing (${A.text})`);
R.is(A.clamp.clamped && A.clamp.scale === 4, `a size beyond the Size range is fitted to it and says so (scale ${A.clamp.scale})`);

console.log("\n=== a .wtproj round trip ===");
const RT = o.rt;
if (RT.got) console.log(`   saved ${RT.pre.w}×${RT.pre.h} at ${RT.pre.scale} · loaded ${RT.got.w}×${RT.got.h} at ${RT.got.scale} · re-rendered ${fmt(RT.c)}`);
R.is(RT.back && RT.got.w === RT.pre.w && RT.got.h === RT.pre.h && RT.got.scale === RT.pre.scale && RT.got.frameKept && RT.got.surf === RT.pre.surf,
  "the edited image comes back with its scale, its frame and its Look");
R.is(RT.back && RT.c.red === RT.pre.c.red && RT.c.white === 0, `and re-projects to the same marking (${RT.c && RT.c.red} red texels, was ${RT.pre.c.red})`);
R.is(RT.back && RT.got.sym2Read === true, "the mirrored copy's readable-lettering setting survives it — it was never written, so the first re-render after a reload turned the lettering backwards");
R.is(RT.reopen && RT.reopen.join() === RT.pre.w + "," + RT.pre.h, "and the loaded decal opens in the editor on its edited image");

console.log("\n=== deleted while its editor was open ===");
R.is(o.gone && o.gone.layers === 0 && o.gone.steps === 0 && /no longer on the model/.test(o.gone.said),
  `Use does not bring a deleted decal back as new layers (${o.gone && o.gone.layers} layers, ${o.gone && o.gone.steps} steps) and says why: “${o.gone && o.gone.said}”`);

console.log("\n=== an off-centre marking cropped to content stays where it is ===");
const OF = o.off;
console.log(`   before: ${fmt(OF.a)} · after the crop: ${OF.w}×${OF.h} at scale ${OF.scale} · ${fmt(OF.b)}`);
R.is(OF.w === 24 && OF.h === 20 && near(OF.scale, .3, 1e-9) && OF.steps === 1, `the crop keeps the bar alone (${OF.w}×${OF.h}) at the pixel size it had (scale ${OF.scale}), one step`);
R.is(OF.b.box && OF.a.box && OF.b.box.every((v, i) => near(v, OF.a.box[i], 1)) && near(OF.b.cx, OF.a.cx, .5) && near(OF.b.cy, OF.a.cy, .5) && near(OF.b.red, OF.a.red, OF.a.red * .05),
  `and it stays where it was — box ${OF.b.box} vs ${OF.a.box}, centre x ${OF.b.cx} vs ${OF.a.cx}; the frame follows the crop's centre (moved: ${OF.moved}) where it used to slide the bar its own width`);
R.is(/stays where it was/.test(OF.said), `the status line's “stays where it was” is now true of an off-centre marking too`);
R.is(OF.undo.frame && OF.undo.c.box.join() === OF.a.box.join(), "undo puts the frame back with the image");
const SY = o.sym, same = (p, q) => p.n > 50 && near(p.x0, q.x0, 1) && near(p.x1, q.x1, 1) && near(p.cx, q.cx, .5);
const opp = h => Math.abs(h.r.cx - (N_SHEET - 1 - h.l.cx));
console.log(`   mirrored copy, a true reflection: left bar x ${SY.reflection.a.l.x0}–${SY.reflection.a.l.x1} → ${SY.reflection.b.l.x0}–${SY.reflection.b.l.x1}, its copy ${SY.reflection.a.r.x0}–${SY.reflection.a.r.x1} → ${SY.reflection.b.r.x0}–${SY.reflection.b.r.x1}`);
console.log(`   readable: left bar x ${SY.readable.a.l.x0}–${SY.readable.a.l.x1} → ${SY.readable.b.l.x0}–${SY.readable.b.l.x1}, its copy ${SY.readable.a.r.x0}–${SY.readable.a.r.x1} → ${SY.readable.b.r.x0}–${SY.readable.b.r.x1} (off the mirror by ${opp(SY.readable.a)} → ${opp(SY.readable.b)} texels)`);
R.is(same(SY.reflection.b.l, SY.reflection.a.l) && same(SY.reflection.b.r, SY.reflection.a.r) && opp(SY.reflection.b) <= 1,
  "a mirrored copy that is a true reflection stays where it was too, opposite the marking");
R.is(same(SY.readable.b.l, SY.readable.a.l) && opp(SY.readable.a) > 20 && opp(SY.readable.b) <= 1,
  "a readable copy — flipped about its own centre — was held off the mirror by the uneven margin, and with the margin gone sits exactly opposite the marking");
R.is(/readable mirrored copy moved/.test(SY.readable.said) && !/mirrored copy/.test(SY.reflection.said),
  `and the status line says the readable copy moved, and only then: “${SY.readable.said}”`);

console.log("\n=== the relief's depth map follows a crop and a turn ===");
const RF = o.relief;
console.log(`   relief before: ${RF.na.n} texels bent at [${RF.na.box}] · after the crop [${RF.nb.box}] · after the turn [${RF.nc.box}]`);
console.log(`   against a decal projected fresh from a hand-cut image and map: crop ${RF.refB.off} bytes off (worst ${RF.refB.worst}), turn ${RF.refC.off} (worst ${RF.refC.worst})`);
R.is(RF.hmb.w === 40 && RF.hmb.h === 20 && RF.hmb.left === 255 && RF.hmb.right === 0 && RF.hmb.surf,
  `the crop cuts the map with the image — ${RF.hmb.w}×${RF.hmb.h}, raised on the left, flat on the right — where it used to squeeze the whole 80×40 map into the bar`);
R.is(RF.hmc.w === 20 && RF.hmc.h === 40 && RF.hmc.top === 255 && RF.hmc.bottom === 0,
  `the turn turns it: ${RF.hmc.w}×${RF.hmc.h}, the raised left half now the top half — it used to be stretched to the new shape`);
R.is(RF.refBn > 100 && RF.refB.off === 0, `the cropped decal's relief is the relief of the hand-cut decal, byte for byte (${RF.refBn} texels bent)`);
R.is(RF.refCn > 100 && RF.refC.off === 0, `and so is the turned one's (${RF.refCn} texels bent)`);
R.is(RF.b.box.join() === RF.a.box.join() && RF.c.w === RF.a.h && RF.c.h === RF.a.w, "while the bar itself stays put and turns in place, as before");

console.log("\n=== a normal map's vectors turn with its pixels ===");
const NM = o.nm;
console.log(`   dialog ⟳ 90°: ${NM.dialog.w}×${NM.dialog.h} "${NM.dialog.px}" · GL ⟳ 90° "${NM.gl90}" · DX flip "${NM.dxFlip}" · DX 180° "${NM.dx180}" · depth ⟳ 90° "${NM.depth90}"`);
R.is(NM.dialog.w === 40 && NM.dialog.h === 80 && NM.dialog.px === "127,200,255",
  "a DirectX normal map facing right, turned a quarter clockwise in the dialog, faces down: (200,128) → (127,200) in every texel");
R.is(NM.gl90 === "128,55,255" && NM.dxFlip === "55,128,255" && NM.dx180 === "55,165,255",
  "OpenGL green points up, so the same turn reads (128,55); a mirror negates X (255 − 200); a half turn negates both");
R.is(NM.depth90 === "200,128,255", "a depth map is turned as pixels only — its values are heights, not vectors");

console.log("\n=== a scale outside the Size range survives an edit that keeps the width ===");
console.log(`   scale 0.03 → ${o.tiny.scale} · ${fmt(o.tiny.a)} → ${fmt(o.tiny.b)}`);
R.is(o.tiny.scale === .03 && o.tiny.b.box.join() === o.tiny.a.box.join() && /same size/.test(o.tiny.said) && !/fitted/.test(o.tiny.said),
  `keying out a background keeps 0.03 and the bar's size — it used to be fitted to 0.05 and grow by two thirds (“${o.tiny.said}”)`);

console.log("\n=== an outline keeps its width through a crop ===");
const OL = o.ol;
console.log(`   green outline: ${OL.a.n} texels at [${OL.a.box}] → ${OL.b.n} at [${OL.b.box}] · Outline ${10}% → ${OL.ol}% · ${OL.w} px wide at scale ${OL.scale}`);
R.is(OL.a.n > 300 && OL.b.box && OL.b.box.every((v, i) => near(v, OL.a.box[i], 1)) && near(OL.b.n, OL.a.n, OL.a.n * .06) && OL.rb.box.join() === OL.ra.box.join(),
  `the outline round the bar is as wide after the crop as before (${OL.a.n} → ${OL.b.n} texels, the same box) — it used to thin to half`);
R.is(OL.ol === 20 && OL.w === 40 && near(OL.scale, .5, 1e-9), "because the Look's Outline is re-fitted to the shorter side: 10 % of 40 px is 20 % of 20");
R.is(OL.undo.ol === 10 && OL.undo.g.box.join() === OL.a.box.join(), "and undo puts the 10 % back with the image");

console.log("\n=== an undo that reaches the decal under the open editor ===");
R.is(o.stale.kept && o.stale.steps === 0 && /changed while the editor was open/.test(o.stale.said),
  `Use refuses to apply an edit made from an image that is no longer the decal's, and says why: “${o.stale.said}”`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
