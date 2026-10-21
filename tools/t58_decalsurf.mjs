// A decal's Look lands as derived channels of the decal's own layer (a group of sibling layers until
// 4.28(f)), and they are the pixels the destructive bake wrote (ROADMAP 4.8).
//
// WHY THIS EXISTS. The editor's **Look** — painted / vinyl / stencil / none — described a decal that
// writes smoothness, metalness and normal, and wrote none of them: it pre-filled three sidebar
// sliders whose only consumer was a separate, differently-named, destructive button. That is the
// bug 4.8 was reported for, and the interim fix could only make the control stop promising.
//
// It works now, and the load-bearing assertion is the **equality**: the derived layers must
// composite to the same channel sheets the old destructive bake produced. "Non-destructive" is only
// an improvement if it still looks the same, and the maths was copied deliberately rather than
// rewritten so that this comparison means something. Both paths are run over the same decal on the
// same slot and the resulting smoothness / metalness / normal sheets are compared byte for byte.
//
// The rest is what makes them part of the decal rather than a bake:
//   * they are CONTENT of the decal's own node, one derived slot per channel the Look writes (until
//     4.28(f) they were sibling layers in a group made for them) — hide the decal and the gloss
//     goes with the sticker, because there is nothing else to hide;
//   * they FOLLOW the decal, because they are derived from where it sits: moving it and leaving the
//     gloss behind on the fuselage is the obvious way for this feature to be wrong;
//   * ALL FOUR channels do — the paint mask (a Custom look's Paint Δ) included. Two loops in the
//     page named only the first three for three weeks after wear joined the table, and every helper
//     here did too, which is why nothing saw it (9d-2, 2026-09-26);
//   * a second decal over the first ACCUMULATES, the way the bake did. That one is a trap: the
//     derived layer is built from what the channel already shows, so reading the cached composite
//     without first rebuilding it with the layer hidden reads the layer's own last result back in
//     and compounds it on every move.
//
// Usage: node tools/t58_decalsurf.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 128;
  var flat = function(hex, w, h){ var c = mkCanvas(w || N, h || N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height); return c; };
  // A decal with a soft edge, so the alpha ramp the maths leans on is really there.
  var stamp = function(){
    var c = mkCanvas(40, 40), g = ctx2d(c);
    var rg = g.createRadialGradient(20, 20, 2, 20, 20, 19);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 40, 40);
    return c;
  };
  var mkSlot = function(id){
    var s = { id: id, size: N, nSize: N, layers: [], missing: false };
    s.baseC = flat("#404040"); s.composite = flat("#404040");
    s.smooth = flat("#505050"); s.metal = flat("#303030"); s.normal = flat("#8080ff");
    return s;
  };
  var mkDecal = function(name, x, y, surf){
    return LayerNode.of({ type: "decal", name: name, bmp: stamp(), x: x, y: y, scale: 1, rot: 0, flip: false,
             visible: true, opacity: 1, blend: "normal", surf: surf });
  };
  var sheet = function(c){ return [].slice.call(ctx2d(c).getImageData(0, 0, c.width, c.height).data); };
  var diff = function(a, b){ var w = 0, n = 0; for (var i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d) n++; if (d > w) w = d; } return { worst: w, off: n, of: a.length }; };
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var VINYL = { sm: 55, mt: 0, em: 6, preset: "vinyl" };
  // ROADMAP 4.28(f): a decal's response is channel SLOTS of its own node, not sibling layers in a
  // folder. These two are what every structural assertion below asks now — "which of sm/mt/em/wr
  // does this layer derive", and "which contents in this slot are ours to rebuild".
  // The four channels are WRITTEN OUT rather than read from the page's SURF_DELTA_CHAN, on purpose:
  // this is the oracle for code that is supposed to read that table, and until 2026-09-26 both these
  // helpers and two loops in the page listed three — so a Paint Δ left behind was invisible to both.
  var DERIVED_CH = ["smooth", "metal", "normal", "wear"];
  var derivedKeys = function(L){
    if (!L || !L.chans) return "";
    return DERIVED_CH.map(function(ch){
      var c = LayerNode.contentOn(L, ch); return c && c.derived ? c.derived : null;
    }).filter(Boolean).sort().join(",");
  };
  var derivedIn = function(list){
    var out2 = [];
    layerLeaves(list).forEach(function(L){
      DERIVED_CH.forEach(function(ch){
        var c = LayerNode.contentOn(L, ch); if (c && c.derived) out2.push({ L: L, ch: ch, c: c });
      });
    });
    return out2;
  };
  var slotWas = App.activeSlot, layerWas = App.activeLayer;

  // ---- 1. the destructive bake, kept as the reference ----
  var A = mkSlot("t58a");
  var da = mkDecal("roundel", .5, .5, VINYL);
  A.layers = [da];
  App.slots.set("t58a", A); App.activeSlot = A; App.activeLayer = da;
  $("scSm").value = VINYL.sm; $("scMt").value = VINYL.mt; $("scEm").value = VINYL.em;
  $("btnSurfBake").click();
  var ref = { smooth: sheet(A.smooth), metal: sheet(A.metal), normal: sheet(A.normal) };
  out.bakeChanged = diff(ref.smooth, sheet(flat("#505050"))).off > 0;

  // ---- 2. the same look, in the decal's own layer ----
  var B = mkSlot("t58b");
  var db = mkDecal("roundel", .5, .5, VINYL);
  B.layers = [db];
  App.slots.set("t58b", B); App.activeSlot = B; App.activeLayer = db;
  var ok = applyDecalSurface(B, db);
  compositeChannels(B);
  out.applied = ok;
  out.shape = B.layers.map(function(n){ return isGroup(n) ? n.name + "[" + n.children.map(function(c){ return c.name; }).join(" | ") + "]" : n.name; }).join(" ");
  out.groupMade = isGroup(B.layers[0]);
  out.nodes = B.layers.length;
  out.chans = derivedIn(B.layers).map(function(e){ return e.c.derived + ":" + e.ch; }).sort().join(" ");
  out.untouched = { smooth: diff(sheet(B.smooth), sheet(flat("#505050"))).off,
                    normal: diff(sheet(B.normal), sheet(flat("#8080ff"))).off };

  // ---- 3. and they are the SAME pixels ----
  // Three here, not DERIVED_CH's four, and correctly: the reference is the bake, and the bake writes
  // the three sheets the _n packs. The paint mask is the albedo's alpha and has no bake to match.
  out.same = {};
  ["smooth", "metal", "normal"].forEach(function(ch){
    var got = chanOut(B, ch === "smooth" ? "smooth" : ch === "metal" ? "metal" : "normal");
    out.same[ch] = got ? diff(ref[ch], sheet(got)) : null;
  });

  // ---- 4. hiding the DECAL takes the surface response with it ----
  // It used to be "hiding the group", and the group was the only thing that could do it: the decal
  // and its response were siblings, so hiding one left the other. One node, one eye (4.28(f)).
  B.layers[0].visible = false;
  compositeChannels(B);
  out.hidden = diff(sheet(chanOut(B, "smooth")), sheet(flat("#505050")));
  B.layers[0].visible = true;
  compositeChannels(B);

  // ---- 5. moving the decal moves the response ----
  var beforeMove = px(chanOut(B, "smooth"), N / 2, N / 2);
  db.x = .25; db.y = .25;
  refreshDecalSurface(B, db);
  compositeChannels(B);
  out.move = { oldSpot: px(chanOut(B, "smooth"), N / 2, N / 2), newSpot: px(chanOut(B, "smooth"), N / 4, N / 4),
               wasAtOldSpot: beforeMove };

  // ---- 6. a second decal over the first accumulates, and re-applying does not compound ----
  db.x = .5; db.y = .5; refreshDecalSurface(B, db); compositeChannels(B);
  var oneSticker = px(chanOut(B, "smooth"), N / 2, N / 2)[0];
  refreshDecalSurface(B, db); refreshDecalSurface(B, db); compositeChannels(B);
  out.stable = px(chanOut(B, "smooth"), N / 2, N / 2)[0];
  var dc = mkDecal("second", .5, .5, { sm: 30, mt: 0, em: 0, preset: "custom" });
  B.layers.push(dc);
  App.activeLayer = dc;
  applyDecalSurface(B, dc);
  compositeChannels(B);
  out.stack = { one: oneSticker, two: px(chanOut(B, "smooth"), N / 2, N / 2)[0] };

  // ---- 7. a look with nothing in it is refused, and so is a slot with no _n ----
  var C = mkSlot("t58c");
  var dz = mkDecal("nothing", .5, .5, { sm: 0, mt: 0, em: 0, preset: "none" });
  C.layers = [dz];
  App.slots.set("t58c", C); App.activeSlot = C; App.activeLayer = dz;
  $("status").textContent = "";
  out.noneRefused = { ok: applyDecalSurface(C, dz), said: $("status").textContent, shape: C.layers.length };
  var D = mkSlot("t58d");
  D.smooth = D.metal = D.normal = null;
  var dd = mkDecal("nosurf", .5, .5, VINYL);
  D.layers = [dd];
  App.slots.set("t58d", D); App.activeSlot = D; App.activeLayer = dd;
  $("status").textContent = "";
  out.noNRefused = { ok: applyDecalSurface(D, dd), said: $("status").textContent };

  // ---- 7b. wear is the fourth delta, and it needs no _n at all (2026-09-02) ----
  // The last of 4.28(f)'s editing half. It is the case every gate used to get wrong: the paint mask
  // is the albedo's alpha, so "is there an _n" was the wrong question and a Paint-only look was
  // refused on a slot that had everything it needed. "D" is exactly that slot — its three _n sheets
  // are null — so an apply here proves both halves at once, the gate and the channel.
  // Negative on purpose: the base mask is 255 everywhere, so a positive delta clamps and proves
  // only the plumbing. A scorch that strips paint back to the bare material moves a real number.
  var dw = mkDecal("paint", .5, .5, { sm: 0, mt: 0, em: 0, wr: -80, preset: "custom" });
  D.layers = [dw];
  App.activeLayer = dw;
  $("status").textContent = "";
  var wearOk = applyDecalSurface(D, dw);
  compositeChannels(D);
  var wc = LayerNode.contentOn(dw, "wear");
  out.wear = { ok: wearOk, said: $("status").textContent, derived: wc && wc.derived,
               under: px(chanOut(D, "wear"), 2, 2), at: px(chanOut(D, "wear"), N / 2, N / 2),
               chans: Object.keys(dw.chans).sort().join(",") };
  // ...and a 2-D drag hides it with the rest (4.8c). SurfDrag.hold is what view2d's pointerdown
  // calls on a floating decal; until 2026-09-26 it hid smooth, metal and normal only, so the paint
  // half of a Look stayed on the sheet where the decal used to be for the whole of the gesture.
  SurfDrag.hold(dw, function(x){ return x === dw; });
  compositeChannels(D);
  out.wear.dragHidden = !!wc && wc.visible === false;
  out.wear.dragAt = px(chanOut(D, "wear"), N / 2, N / 2);
  SurfDrag.release();
  compositeChannels(D);
  out.wear.releasedAt = px(chanOut(D, "wear"), N / 2, N / 2);


  // ---- 8. the response survives a .wtproj round trip, and an OLD file is folded on load ----
  // Two halves, and the second is the one 4.28(f) put here. A file written now stores the derived
  // contents in the decal's own slots and comes back as one layer. A file written before 2026-09-02
  // stores a folder with surfGroup and three surfKey siblings, and the loader has to migrate it
  // — so this builds one, by rewriting the file just saved into the old shape, the way t57 builds a
  // version-3 file. Without that the migration would be code nothing ever runs until a user opens a
  // project from last week.
  var savedSlots = App.slots, savedUnits = App.skinUnits;
  var E = mkSlot("t58e");
  var de = mkDecal("roundel", .5, .5, VINYL);
  E.layers = [de];
  App.slots = new Map([["t58e", E]]);
  App.activeSlot = E; App.activeLayer = de;
  applyDecalSurface(E, de);
  compositeChannels(E);
  var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  E.layers = [];
  await loadProject(blob);
  var dec2 = E.layers[0];
  out.rt = {
    nodes: E.layers.length,
    isGroup: isGroup(dec2),
    keys: derivedKeys(dec2),
    kind: dec2 && LayerNode.contentOn(dec2, "color") ? LayerNode.contentOn(dec2, "color").kind : null,
  };
  // and it still follows the decal after the reload
  if (dec2 && !isGroup(dec2)) {
    compositeChannels(E);
    dec2.x = .25; dec2.y = .25;
    refreshDecalSurface(E, dec2);
    compositeChannels(E);
    out.rt.movedAfterLoad = px(chanOut(E, "smooth"), N / 4, N / 4)[0];
    out.rt.oldSpotAfterLoad = px(chanOut(E, "smooth"), N / 2, N / 2)[0];
  }
  // ---- 8b. the same file, rewritten into the pre-4.28(f) shape ----
  var z8 = await JSZip.loadAsync(blob);
  var m8 = JSON.parse(await z8.file("project.json").async("string"));
  var SURFKEY_CH = { smooth: "sm", metal: "mt", normal: "em" };
  var toFolder = function(lm){
    if (!lm.chans) return lm;
    var kids = [], col = null;
    Object.keys(lm.chans).forEach(function(ch){
      var c = lm.chans[ch];
      if (ch === "color") { col = c; return; }
      if (!c.derived) return;
      kids.push({ type: "paint", name: "Derived " + c.derived, visible: true, opacity: 1, blend: "normal",
                  chan: ch, surfKey: c.derived, canvasFile: c.canvasFile });
    });
    if (!col || !kids.length) return lm;
    var decal = { type: "decal", name: lm.name, visible: lm.visible, opacity: lm.opacity, blend: lm.blend };
    Object.keys(col).forEach(function(k){ if (k !== "kind") decal[k] = col[k]; });
    return { type: "group", name: lm.name, visible: true, opacity: 1, blend: "normal", collapsed: true,
             surfGroup: true, children: kids.concat([decal]) };
  };
  m8.version = 4;
  m8.slots.forEach(function(sm){ sm.layers = sm.layers.map(toFolder); });
  z8.file("project.json", JSON.stringify(m8));
  var blob8 = await z8.generateAsync({ type: "blob" });
  E.layers = []; E.chanC = null;
  await loadProject(blob8);
  out.old = {
    wasFolder: m8.slots.some(function(sm){ return sm.layers.some(function(l){ return l.surfGroup; }); }),
    nodes: E.layers.length,
    isGroup: isGroup(E.layers[0]),
    keys: derivedKeys(E.layers[0]),
    stillDerived: derivedIn(E.layers).length,
  };
  App.slots = savedSlots; App.skinUnits = savedUnits;

  // ---- 9. the look waits until the decal is PUT DOWN, and never steals the selection ----
  // All of this is one regression, reported 2026-08-26 the day 4.8 landed. "place()" applied the
  // response the instant the decal was created — before it had been put anywhere — and
  // "applyDecalSurface" then selected the GROUP. Every path that puts a decal down asks
  // "activeLayerObj().type === "decal"", so selecting the group silently killed clicking the model
  // to place or project it, pasting into 3-D, and G.
  var F = mkSlot("t58f");
  App.slots.set("t58f", F); App.activeSlot = F; App.activeLayer = null;
  DecalCarry.place(stamp(), { name: "Pasted image", surf: VINYL }, "Pasted image");
  var justPlaced = activeLayerObj();
  out.place = {
    selectedType: justPlaced ? (isGroup(justPlaced) ? "group" : justPlaced.type) : "none",
    grouped: F.layers.some(function(n){ return isGroup(n); }),
    keptLook: !!(justPlaced && justPlaced.surf && justPlaced.surf.sm === VINYL.sm),
    placing: App.placing,
  };
  // ...and putting it down is what makes the response
  var dF = justPlaced;
  if (dF && dF.type === "decal") {
    dF.x = .4; dF.y = .6;
    ensureDecalSurface(F, dF);
    compositeChannels(F);
  }
  out.settled = {
    grouped: F.layers.some(function(n){ return isGroup(n); }),
    nodes: F.layers.length,
    keys: derivedKeys(dF),
    stillOnDecal: activeLayerObj() === dF,
  };
  // Sections 10-12 are about a group the USER made — that is the only kind there is now — so this
  // one is built by hand where the app used to build it. What they test has not changed: a decal's
  // controls have to keep working from a folded folder, a tool has to find the layer it writes to
  // inside one, and everything in it moves with the decal.
  var GF = groupNodes(F, [dF], "Roundel");
  if (GF) GF.collapsed = true;

  // ---- 9b. a PROJECTED decal carries the same Look (ROADMAP 4.8b) ----
  // The half 4.8 could not deliver: a projection's alpha is drawn by the GPU straight into the
  // layer's sheet, so the footprint is the layer itself — but its bounding BOX was missing, and
  // finding one by reading the sheet back is the full-surface getImageData 1.11 removed. The
  // projector reports it now, and everything below rests on that box being both present and tight.
  var geoWas = App.geomData, meshWas = App.meshes, matWas = App.matSlot, sizeWas = App.modelSize;
  var quad = function(name, mat){
    var idx = [0, 1, 2, 0, 2, 3];
    var corners = [[-2,-2,0], [2,-2,0], [2,2,0], [-2,2,0]];
    var uvc = [[0,0], [1,0], [1,1], [0,1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2];
      nor[k*3] = 0; nor[k*3+1] = 0; nor[k*3+2] = 1;
      uv[k*2] = t[0]; uv[k*2+1] = t[1];
    }
    return { name: name, mat: mat, position: pos, normal: nor, uv: uv };
  };
  var Pslot = mkSlot("t58p");
  App.slots.set("t58p", Pslot); App.activeSlot = Pslot; App.activeLayer = null;
  App.geomData = [quad("plate", "pmat")];
  // userData.mat, because compositeChannels -> refreshSurfaceTextures -> rebuildMaterials reads it
  App.meshes = new Map([["plate", { visible: true, userData: { mat: "pmat" }, material: null }]]);
  App.matSlot = new Map([["pmat", "t58p"]]);
  App.modelSize = { x: 10, y: 10, z: 10 };
  App.selParts = new Set(); App.protectedParts = new Set();
  App._projGL = null;
  var P = { id: "p58", frame: { p: [0, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
            bmp: stamp(), scale: .5, rot: 0, flip: false, sym2: false, name: "roundel",
            surf: VINYL, depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF, parts: null };
  var pres = renderProjGroup(P);
  var pTop = Pslot.layers[0];
  var pLayer = layerLeaves(Pslot.layers).find(function(l){ return l.proj === P; });
  compositeChannels(Pslot);
  out.proj = {
    mode: projGL() ? "gl" : "canvas",
    drawn: pres.drawn,
    grouped: isGroup(pTop),
    nodes: Pslot.layers.length,
    keys: derivedKeys(pLayer),
    box: pLayer && pLayer.projBox ? [pLayer.projBox.x, pLayer.projBox.y, pLayer.projBox.w, pLayer.projBox.h] : null,
    sheet: N,
  };
  // The box has to CONTAIN the alpha the projector drew, or the response comes out clipped along an
  // edge — and it has to be much smaller than the sheet, or it is not doing its job.
  if (pLayer && pLayer.projBox) {
    var ad = ctx2d(pLayer.canvas).getImageData(0, 0, N, N).data;
    var ax0 = N, ay0 = N, ax1 = -1, ay1 = -1, lit = 0;
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      if (!ad[(yy * N + xx) * 4 + 3]) continue;
      lit++;
      if (xx < ax0) ax0 = xx; if (xx > ax1) ax1 = xx;
      if (yy < ay0) ay0 = yy; if (yy > ay1) ay1 = yy;
    }
    var b = pLayer.projBox;
    out.proj.trueBox = lit ? [ax0, ay0, ax1 - ax0 + 1, ay1 - ay0 + 1] : null;
    out.proj.contains = lit ? (b.x <= ax0 && b.y <= ay0 && b.x + b.w >= ax1 + 1 && b.y + b.h >= ay1 + 1) : false;
    out.proj.area = (b.w * b.h) / (N * N);
  }
  // the response really is in the smoothness sheet, and only where the decal is
  var smAt = function(x, y){ return px(chanOut(Pslot, "smooth"), x, y)[0]; };
  out.proj.centre = smAt(N / 2, N / 2);
  out.proj.corner = smAt(3, 3);
  out.proj.base = 0x50;

  // ---- 9c. not rebuilt on a live drag frame, and not SHOWN stale either (ROADMAP 4.8c) ----
  // The deferral is deliberate — a per-pixel walk per channel the Look writes and a channel
  // composite per sheet is not a per-frame cost — but until 4.8c the whole drag showed the response built from where the decal
  // used to be, which is the reported "imprint of its impact to the normal channel". So the
  // derived layers are hidden for the length of the gesture: nothing recomputed, nothing stale.
  var surfLayers = function(){ return derivedIn(Pslot.layers); };
  var wasLayers = surfLayers();
  P.frame = { p: [1.2, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] };
  renderProjGroup(P, true);                            // the live path: colour only, no surfaces
  compositeChannels(Pslot);
  out.proj.live = {
    oldSpotIsBase: smAt(N / 2, N / 2) === out.proj.base,
    newSpotNotBuilt: smAt(Math.round(N * .8), N / 2) === out.proj.base,
    hiddenNotDeleted: surfLayers().length === wasLayers.length,
    allHidden: surfLayers().every(function(e){ return e.c.visible === false; }),
  };
  // An interrupted gesture puts them back — the hidden set lives on the drag, so a release with no
  // commit render behind it is the pointercancel case.
  SurfDrag.release();
  out.proj.live.releaseRestores = surfLayers().every(function(e){ return e.c.visible !== false; });
  renderProjGroup(P, true);                            // hidden again, for the commit below to undo
  renderProjGroup(P);                                  // drag over: now it catches up
  compositeChannels(Pslot);
  out.proj.afterCommitOld = smAt(N / 2, N / 2);
  // Where the response ended up is read off the sheet rather than predicted: the quad maps world
  // x [-2,2] onto u [0,1], so guessing a texel is one arithmetic slip away from a test that fails
  // for the wrong reason.
  var rowMax = 0, rowAt = -1;
  for (var rx = 0; rx < N; rx++) { var v = smAt(rx, N / 2); if (v > rowMax) { rowMax = v; rowAt = rx; } }
  out.proj.afterCommitNew = rowMax;
  out.proj.afterCommitAt = rowAt;
  out.proj.live.commitRestores = surfLayers().every(function(e){ return e.c.visible !== false; });

  // ---- 9c-2. the 2-D drag commits its response, which it never used to (ROADMAP 4.8c) ----
  // "endAll" in view2d pushed its own "move decal" step and called scheduleComposite, and never
  // called ensureDecalSurface — the keyboard path has since 4.8. So dragging a UV decal with the
  // mouse left the gloss and the raised edge where the sticker used to be PERMANENTLY, until some
  // other edit happened to refresh them. Driven through the real listener: the gesture state is set
  // the way pointerdown sets it, and the release is a real event on the real canvas.
  var U = mkSlot("t58u");
  var du = mkDecal("roundel", .25, .5, VINYL);
  U.layers = [du];
  App.slots.set("t58u", U); App.activeSlot = U; App.activeLayer = du;
  applyDecalSurface(U, du);
  compositeChannels(U);
  var uAt = function(x, y){ return px(chanOut(U, "smooth"), x, y)[0]; };
  var uBase = uAt(3, 3);
  out.drag2d = { from: uAt(Math.round(N * .25), Math.round(N * .5)) };
  v2.draggingDecal = true;
  v2.decalStart = { L: du, x: du.x, y: du.y, gx: 0, gy: 0 };
  SurfDrag.hold(du, function(x){ return x === du; });
  du.x = .7;                                           // what pointermove does
  cnv2.dispatchEvent(new PointerEvent("pointerup"));   // ...and this is endAll, for real
  compositeChannels(U);
  out.drag2d.oldSpot = uAt(Math.round(N * .25), Math.round(N * .5));
  out.drag2d.newSpot = uAt(Math.round(N * .7), Math.round(N * .5));
  out.drag2d.base = uBase;
  out.drag2d.visible = derivedIn(U.layers).every(function(e){ return e.c.visible !== false; });
  // and undo takes the response back with the decal, rather than leaving it where it was dropped
  doUndo();
  compositeChannels(U);
  out.drag2d.undoOld = uAt(Math.round(N * .25), Math.round(N * .5));
  out.drag2d.undoNew = uAt(Math.round(N * .7), Math.round(N * .5));
  App.slots.delete("t58u");
  App.activeSlot = Pslot; App.activeLayer = null;

  // ---- 9d. turning the Look off takes the layers and the folder with it ----
  P.surf = { sm: 0, mt: 0, em: 0, preset: "none" };
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.proj.offKeys = derivedIn(Pslot.layers).length;
  out.proj.offGrouped = Pslot.layers.some(function(n){ return isGroup(n); });
  out.proj.offFlat = smAt(Math.round(N * .65), N / 2);
  // ...and back on again
  P.surf = VINYL;
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.proj.onAgainKeys = derivedIn(Pslot.layers).length;

  // ---- 9d-2. a Custom look's Paint Δ goes with the rest of the Look (2026-09-26) ----
  // Wear joined SURF_DELTA_CHAN as its fourth channel on 2026-09-02, and two loops in
  // decal-surface.js went on naming the first three: refreshProjSurfaces, which drops the response
  // when the Look is set to None or the decal leaves a sheet, and SurfDrag.hold, which hides it for
  // a drag. Measured on the unfixed page with this Look: the paint mask read 175 under the decal
  // before AND after the Look was set to None (255 where the decal never was), and the old footprint
  // stayed on the mask through a live drag while the gloss beside it was hidden. Found reading the
  // code for ROADMAP 4.50 (17), reproduced in that branch's review. Every number below is read off
  // the WEAR sheet, the one those loops never touched.
  var CUSTOM = { sm: 30, mt: 0, em: 0, wr: -80, preset: "custom" };
  var wearAt = function(x){ return px(chanOut(Pslot, "wear"), x, N / 2)[0]; };
  var wearLow = function(){
    var m = 256, at = -1;
    for (var x = 0; x < N; x++) { var v = wearAt(x); if (v < m) { m = v; at = x; } }
    return { v: m, at: at };
  };
  var frameAt = function(x){ return { p: [x, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }; };
  var frameWas = P.frame;
  var pdL = layerLeaves(Pslot.layers).find(function(l){ return l.proj === P; });
  var wearOf = function(){ return pdL ? LayerNode.contentOn(pdL, "wear") : null; };
  P.surf = CUSTOM; P.frame = frameAt(0);
  renderProjGroup(P);
  compositeChannels(Pslot);
  var placed = wearLow();
  out.paintD = { keys: derivedKeys(pdL), placed: placed.v, at: placed.at };
  // a live drag frame: the paint half is hidden with the gloss, not left at the old spot
  P.frame = frameAt(1.2);
  renderProjGroup(P, true);
  compositeChannels(Pslot);
  out.paintD.drag = { hidden: !!wearOf() && wearOf().visible === false, oldSpot: wearAt(placed.at),
                      smHidden: !!LayerNode.contentOn(pdL, "smooth") && LayerNode.contentOn(pdL, "smooth").visible === false };
  // the drop rebuilds it where the decal now is, and nowhere else
  renderProjGroup(P);
  compositeChannels(Pslot);
  var dropped = wearLow();
  out.paintD.drop = { v: dropped.v, at: dropped.at, oldSpot: wearAt(placed.at), shown: !!wearOf() && wearOf().visible !== false };
  // moved off the sheet: the layer stays (empty), and nothing it derived stays with it
  P.frame = frameAt(9);
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.paintD.off = { empty: !!pdL.projEmpty, keys: derivedKeys(pdL), low: wearLow().v };
  // back on, then the Look set to None — the value the Projected image panel's select writes
  P.frame = frameAt(1.2);
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.paintD.backOn = derivedKeys(pdL);
  P.surf = { sm: 0, mt: 0, em: 0, wr: 0, preset: "none" };
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.paintD.none = { keys: derivedKeys(pdL), low: wearLow().v };
  // and the state the sections below were written against
  P.surf = VINYL; P.frame = frameWas;
  renderProjGroup(P);
  compositeChannels(Pslot);
  out.paintD.restored = derivedKeys(pdL);

  // ---- 9f. a tiled part is projected onto every repeat (ROADMAP 4.23(a)) ----
  // The t55e1 gun barrel runs u to 6.353 — one strip repeated six times — and both projectors mapped
  // aUV straight into the sheet, so five of those repeats were off the edge and a decal aimed at one
  // of them landed nowhere. The plate below has u running 0..2, and the decal is aimed at the far
  // half: before the fix, the drawn count for it was 0.
  var geoWas2 = App.geomData, meshWas2 = App.meshes, matWas2 = App.matSlot, slotWas2 = App.activeSlot;
  var Tslot = mkSlot("t58t");
  App.slots.set("t58t", Tslot);
  var tq = quad("tile", "tmat");
  for (var ti = 0; ti < tq.uv.length; ti += 2) tq.uv[ti] *= 2;      // one strip, twice
  App.geomData = [tq];
  App.meshes = new Map([["tile", { visible: true, userData: { mat: "tmat" }, material: null }]]);
  App.matSlot = new Map([["tmat", "t58t"]]);
  App.activeSlot = Tslot; App.activeLayer = null;
  App._projGL = null;
  var TP = { id: "p58t", frame: { p: [1, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
             bmp: stamp(), scale: .5, rot: 0, flip: false, sym2: false, name: "on the far repeat",
             surf: { sm: 0, mt: 0, em: 0, preset: "none" }, depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF, parts: null };
  var tres = renderProjGroup(TP);
  var tl = layerLeaves(Tslot.layers).find(function(l){ return l.proj === TP; });
  out.tiled = { drawn: tres.drawn, made: !!tl };
  if (tl && tl.canvas) {
    // World x = +1 is u = 1.5, which wraps to the middle of the sheet.
    var td = ctx2d(tl.canvas).getImageData(0, 0, N, N).data;
    var lit = 0, cx = 0;
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      var a2 = td[(yy * N + xx) * 4 + 3];
      if (a2 > 8) { lit++; cx += xx; }
    }
    out.tiled.lit = lit;
    out.tiled.at = lit ? Math.round(cx / lit) : -1;
    out.tiled.want = Math.round(N * .5);
  }
  App.slots.delete("t58t");
  App.geomData = geoWas2; App.meshes = meshWas2; App.matSlot = matWas2; App.activeSlot = slotWas2;
  App._projGL = null;

  // ---- 9h. the vertical mirror is not a third transform (ROADMAP 4.2) ----
  // The item asked for a flipY beside flip. There does not need to be one: a vertical mirror IS the
  // horizontal mirror plus a half turn, and both already exist on every decal, on every path, in the
  // project format and in the projector. What was missing is the button — by hand it is two controls
  // in the right order, and the wrong order leaves a marking rotated rather than flipped.
  var Vslot = mkSlot("t58v");
  App.slots.set("t58v", Vslot);
  var dv = mkDecal("serial", .5, .5, null);
  dv.rot = 30; dv.flip = false;
  Vslot.layers = [dv];
  var slotWasV = App.activeSlot, layerWasV = App.activeLayer;
  App.activeSlot = Vslot; App.activeLayer = dv;
  App.undoStack.length = 0; App.redoStack.length = 0;
  $("btnDecFlipY").click();
  out.flipY = { flip: !!dv.flip, rot: dv.rot, steps: App.undoStack.length };
  doUndo();
  out.flipY.undoFlip = !!dv.flip; out.flipY.undoRot = dv.rot;
  doRedo();
  $("btnDecFlipY").click();                              // twice is the identity
  out.flipY.twiceFlip = !!dv.flip; out.flipY.twiceRot = dv.rot;
  App.slots.delete("t58v");
  App.activeSlot = slotWasV; App.activeLayer = layerWasV;
  App.undoStack.length = 0; App.redoStack.length = 0;

  // ---- 9g. the mirrored copy can keep its lettering readable (ROADMAP 4.2) ----
  // A mirrored copy is a true REFLECTION, so its image comes out mirrored — right for a shape that
  // should point forward on both sides, wrong for a number or a name, which is "the one thing real
  // markings never do". The stamp below is deliberately asymmetric (ink in its left half only), so
  // WHERE the ink lands on the far copy is what says which of the two happened.
  var geoWas3 = App.geomData, meshWas3 = App.meshes, matWas3 = App.matSlot, slotWas3 = App.activeSlot;
  var axWas = $("symAxis").value, autoWas = App.autoAxis;
  $("symAxis").value = "x"; App.autoAxis = "x";
  var Mslot = mkSlot("t58m");
  App.slots.set("t58m", Mslot);
  App.geomData = [quad("plate", "mmat")];
  App.meshes = new Map([["plate", { visible: true, userData: { mat: "mmat" }, material: null }]]);
  App.matSlot = new Map([["mmat", "t58m"]]);
  App.activeSlot = Mslot; App.activeLayer = null;
  App._projGL = null;
  var half = mkCanvas(40, 40);
  (function(){ var g = ctx2d(half); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 14, 40); })();   // ink on the LEFT
  var inkAt = function(L){
    if (!L || !L.canvas) return null;
    var d = ctx2d(L.canvas).getImageData(0, 0, N, N).data, n = 0, sx = 0;
    for (var yy = 0; yy < N; yy++) for (var xx = N / 2; xx < N; xx++) {     // the FAR copy's half only
      var a3 = d[(yy * N + xx) * 4 + 3];
      if (a3 > 8) { n++; sx += xx; }
    }
    return n ? Math.round(sx / n) : -1;
  };
  var MP = { id: "p58m", frame: { p: [-1, 0, 0.05], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
             bmp: half, scale: .5, rot: 0, flip: false, sym2: true, name: "serial",
             surf: { sm: 0, mt: 0, em: 0, preset: "none" }, depth: PROJ_DEPTH_DEF, wrap: PROJ_WRAP_DEF, parts: null };
  renderProjGroup(MP);
  var ML = layerLeaves(Mslot.layers).find(function(l){ return l.proj === MP; });
  out.symRead = { reflected: inkAt(ML) };
  MP.sym2Read = true;
  renderProjGroup(MP);
  out.symRead.readable = inkAt(ML);
  out.symRead.mid = N * .75;
  App.slots.delete("t58m");
  App.geomData = geoWas3; App.meshes = meshWas3; App.matSlot = matWas3; App.activeSlot = slotWas3;
  $("symAxis").value = axWas; App.autoAxis = autoWas;
  App._projGL = null;

  // ---- 9e. deleting the projection takes its response with it ----
  deleteProjGroup(P);
  out.proj.afterDelete = Pslot.layers.length;
  doUndo();
  out.proj.afterUndo = derivedIn(Pslot.layers).length;
  App.slots.delete("t58p");
  App.geomData = geoWas; App.meshes = meshWas; App.matSlot = matWas; App.modelSize = sizeWas;
  App.activeSlot = F; App.activeLayer = dF;     // back to section 9's slot for what follows

  // ---- 10. the decal's controls, and G, work from the folded group ----
  App.activeLayer = GF;
  out.fromGroup = { resolves: decalOfSelection() === dF };
  $("status").textContent = "";
  var toModel = document.querySelector('#decalSection .placeSw[data-place="model"]');
  if (toModel) toModel.click();
  out.fromGroup.gSaid = $("status").textContent;
  refreshLayerProps();
  out.fromGroup.decalSectionShown = $("decalSection").style.display !== "none";

  // ---- 11. picking a tool inside a group finds the layer it writes to ----
  App.activeLayer = GF;
  App.brush.mode = "color";
  // A smoothness layer of the user's own, beside the decal. Since 4.28(f) the decal ITSELF carries
  // a smoothness content — its derived gloss — so "find the layer this tool writes to" has a wrong
  // answer available for the first time, and landing on it means painting pixels the decal's next
  // move overwrites. This is the case that says the finder skips it.
  var glossOwn = LayerNode.of({ type: "paint", chan: "smooth", name: "My gloss", canvas: flat("#606060"),
                                visible: true, opacity: 1, blend: "normal" });
  GF.children.push(glossOwn);
  var confirmWas = window.confirm;
  window.confirm = function(){ return false; };                 // "no" — nothing may be created
  applyBrushMode("smooth");
  out.tool = { landedOn: activeLayerObj() ? activeLayerObj().name : null,
               chan: activeLayerObj() ? layerChan(activeLayerObj()) : null,
               decalHasDerivedSmooth: !!(LayerNode.contentOn(dF, "smooth") || {}).derived };
  // ...and if you get there anyway, the stroke is refused rather than being quietly overwritten by
  // the next move of the decal.
  App.activeLayer = dF;
  App.brush.tool = "brush"; App.brush.chan = "smooth"; App.brush.target = "content";
  var tgt = paintTarget();
  out.tool.derivedRefused = !!(tgt && tgt.err);
  out.tool.derivedSaid = (tgt && tgt.err) || "";
  // and a channel the group has nothing for asks, and obeys "no"
  var kidsBefore = layerLeaves(GF.children).length;
  App.activeLayer = GF;
  applyBrushMode("metal");
  out.tool.refusedKids = layerLeaves(GF.children).length - kidsBefore;
  out.tool.refusedStaysGroup = activeLayerObj() === GF;
  window.confirm = function(){ return true; };                  // "yes" — one layer, in the group
  App.activeLayer = GF;
  applyBrushMode("metal");
  out.tool.madeKids = layerLeaves(GF.children).length - kidsBefore;
  out.tool.madeChan = activeLayerObj() ? layerChan(activeLayerObj()) : null;
  out.tool.madeInGroup = !!(activeLayerObj() && groupOwning(F.layers, activeLayerObj()) === GF);
  window.confirm = confirmWas;

  // ---- 12. everything in the group moves with the decal ----
  var sib = mkDecal("serial", .6, .8, null);
  GF.children.push(sib);
  var sibWas = { x: sib.x, y: sib.y };
  App.activeLayer = dF;
  App.brush.mode = "color";
  nudgeDecal(.05, -.02);
  out.together = { decal: [Math.round(dF.x * 1000) / 1000, Math.round(dF.y * 1000) / 1000],
                   sibDx: Math.round((sib.x - sibWas.x) * 1000) / 1000,
                   sibDy: Math.round((sib.y - sibWas.y) * 1000) / 1000 };
  // ---- 15. relief: one height field, three ways of filling it (ROADMAP 4.19) ----
  // The load-bearing assertion is the FIRST one: "edge" has to reproduce the old output byte for
  // byte, because the change was a reframing — differentiating alpha IS "height = alpha" — and if
  // that is not exactly true then every existing project's decals moved.
  var R = mkSlot("t58r");
  App.slots.set("t58r", R); App.activeSlot = R;
  var mkR = function(surf){
    var d = mkDecal("relief", .5, .5, surf);
    // A HARD-edged square: flat alpha inside, so "edge" can only produce a rim and "bevel" has a
    // body to work on. A soft radial stamp would blur the difference the test is looking for.
    var c = mkCanvas(48, 48), g = ctx2d(c);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 48, 48);
    d.bmp = c;
    return d;
  };
  var reliefRun = function(surf, height){
    R.layers = []; R.smooth = flat("#505050"); R.metal = flat("#303030"); R.normal = flat("#8080ff");
    var d = mkR(surf);
    if (height) { d.heightMap = height; d.heightName = "test.png"; }
    R.layers = [d]; App.activeLayer = d;
    applyDecalSurface(R, d);
    compositeChannels(R);
    return { normal: sheet(chanOut(R, "normal")), decal: d };
  };
  var EM = { sm: 0, mt: 0, em: 8, preset: "custom" };
  // (a) the default is unchanged, and its normal is not flat — or the comparison means nothing
  var edgeRun = reliefRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "edge" });
  var noneRun = reliefRun(EM);                              // no "relief" key at all: an old project
  out.relief = { defaultSame: edgeRun.normal.join(",") === noneRun.normal.join(","),
                 edgeMoved: diff(edgeRun.normal, sheet(flat("#8080ff"))).off };
  // (b) the interior of a solid marking: edge does nothing there, bevel does
  var mid = function(sh){ var i = ((N/2) * N + (N/2)) * 4; return [sh[i], sh[i+1]]; };
  // 6 texels in from the marking's left edge: inside a 10-wide bevel band rather than past it,
  // and on the outer slope of the test depth map's dome. Sampling 14 in diagonally read flat for
  // bevel and looked like a bug in the bevel rather than in the probe.
  var inner = function(sh){ var i = ((N/2) * N + (N/2 - 18)) * 4; return [sh[i], sh[i+1]]; };
  var bevelRun = reliefRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "bevel", bevel: 10 });
  out.relief.edgeInner = inner(edgeRun.normal);
  out.relief.bevelInner = inner(bevelRun.normal);
  out.relief.edgeCentre = mid(edgeRun.normal);
  out.relief.bevelCentre = mid(bevelRun.normal);
  // (c) a depth map drives the interior, where neither of the others reaches
  var hm = mkCanvas(48, 48), hg = ctx2d(hm);
  hg.fillStyle = "#000"; hg.fillRect(0, 0, 48, 48);
  var rgh = hg.createRadialGradient(24, 24, 1, 24, 24, 20);
  rgh.addColorStop(0, "#ffffff"); rgh.addColorStop(1, "#000000");
  hg.fillStyle = rgh; hg.fillRect(0, 0, 48, 48);           // a dome in the middle, black around it
  var mapRun = reliefRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map" }, hm);
  out.relief.mapCentre = mid(mapRun.normal);
  out.relief.mapOffCentre = inner(mapRun.normal);
  // (d) invert really inverts: the same map upside down mirrors the perturbation about 128
  var invRun = reliefRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", heightInv: true }, hm);
  out.relief.invOffCentre = inner(invRun.normal);
  // (e) "map" with no map is not a mode — it must fall back rather than render flat/garbage
  var noMapRun = reliefRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map" });
  out.relief.noMapFallsBack = noMapRun.normal.join(",") === edgeRun.normal.join(",");
  // (f) it survives a .wtproj round trip, image and mode together
  var savedSlots2 = App.slots;
  var PR = mkSlot("t58rt2"); PR.id = "t58rt2";
  var pd = mkR({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", heightInv: true, heightFrom: "normal-gl" });
  pd.heightMap = hm; pd.heightName = "dome.png";
  PR.layers = [pd];
  App.slots = new Map([["t58rt2", PR]]); App.activeSlot = PR; App.activeLayer = pd;
  applyDecalSurface(PR, pd);
  var blob2 = null, cou2 = URL.createObjectURL, clk2 = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob2 = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = cou2; HTMLAnchorElement.prototype.click = clk2; }
  PR.layers = [];
  await loadProject(blob2);
  var back = layerLeaves(PR.layers).find(function(l){ return l.type === "decal"; });
  out.relief.rt = { hasMap: !!(back && back.heightMap), name: back && back.heightName,
                    mode: back ? Relief.mode(back.surf) : null, inv: !!(back && back.surf && back.surf.heightInv),
                    from: back ? Relief.heightFrom(back.surf) : null };
  App.slots = savedSlots2;
  App.slots.delete("t58r"); App.slots.delete("t58rt2");

  // ---- 10. the separation 4.18 had to refuse cannot happen (ROADMAP 4.28(f)) ----
  // 4.18 was a REFUSAL. A decal and the layers derived from it found each other by POSITION, so
  // dragging either half out of the folder built a second set on the next move — two Gloss rows,
  // both compositing into the smoothness sheet — and the fix was a rule that said no. What replaces
  // it is not a better refusal: the response is channel slots of the decal's own node, so
  // there is no node to drag out and nothing left to refuse. What is asserted here is that the
  // doubling the rule existed to prevent is unreachable, and that the one thing the rule made
  // awkward — "keep this gloss and paint on it" — still works.
  var S = mkSlot("t58s");
  var ds = mkDecal("roundel", .5, .5, VINYL);
  S.layers = [ds];
  App.slots.set("t58s", S); App.activeSlot = S; App.activeLayer = ds;
  applyDecalSurface(S, ds);
  out.sep = { start: derivedIn(S.layers).length, nodes: S.layers.length, keys: derivedKeys(ds) };
  // Reordering the decal is an ordinary reorder now. Nothing refuses it, and nothing is orphaned by
  // it — the gesture that used to be the bug is the gesture that used to be forbidden.
  S.layers.push(mkDecal("other", .1, .1, null));
  reorderLayer(S, ds, null, S.layers[0]);
  ds.x = .35; ds.y = .62;
  refreshDecalSurface(S, ds);
  out.sep.afterMove = derivedIn(S.layers).length;
  out.sep.stillOne = derivedKeys(ds);
  // Group with the decal selected: no folder to take instead, and the response comes along because
  // it is inside the node being wrapped.
  var GG = groupNodes(S, [ds]);
  out.sep.grouped = !!(GG && GG.children.indexOf(ds) >= 0);
  out.sep.afterGroup = derivedIn(S.layers).length;
  ungroupNode(S, GG);
  // Duplicating is still how to keep a copy you can paint on, and the copy is DETACHED: its
  // contents lose the derived marker, which is the permission a rebuild needs, so the original's
  // next refresh cannot reach them.
  App.activeLayer = ds;
  duplicateLayer(S, ds);
  var dupe = layerLeaves(S.layers).find(function(l){ return l.name === ds.name + " copy"; });
  out.sep.dupe = { made: !!dupe, cut: dupe ? derivedKeys(dupe) : null,
                   keptPixels: !!(dupe && LayerNode.contentOn(dupe, "smooth") &&
                     LayerNode.contentOn(dupe, "smooth").canvas !== LayerNode.contentOn(ds, "smooth").canvas) };
  ds.x = .45;
  refreshDecalSurface(S, ds);
  out.sep.afterDupMove = derivedIn(S.layers).length;
  App.slots.delete("t58s");

  // ---- 11. a rebuild owns what it derived, and nothing else in the layer (ROADMAP 4.28(f)) ----
  // This replaces the folder GC. That one deleted a group whose decal had left, and had to be taught
  // (4.18) to keep any layer the user had dragged into it. There is no folder and nothing to collect;
  // what is left is one rule, and it is the same rule one level down — the derived marker is the
  // permission, so a smoothness paint the user made in the SAME node has to survive the look being
  // turned off, exactly as the dragged-in layer had to survive the folder being deleted.
  var Q = mkSlot("t58q");
  App.slots.set("t58q", Q);
  var Pq = { id: "p58q", surf: VINYL, name: "roundel" };
  var qDecal = LayerNode.of({ type: "paint", name: "roundel", canvas: flat("#808080"),
                              visible: true, opacity: 1, blend: "normal", proj: Pq });
  LayerNode.addContent(qDecal, "smooth", LayerNode.content("paint", { derived: "sm", canvas: flat("#c0c0c0") }));
  LayerNode.addContent(qDecal, "metal", LayerNode.content("paint", { canvas: flat("#404040") }));   // the user's own
  Q.layers = [qDecal];
  Pq.surf = { sm: 0, mt: 0, em: 0, preset: "none" };
  refreshProjSurfaces(Pq);
  out.gc = { derivedGone: !LayerNode.contentOn(qDecal, "smooth"),
             keptMine: !!LayerNode.contentOn(qDecal, "metal"),
             layerStays: Q.layers.indexOf(qDecal) >= 0 };
  App.slots.delete("t58q");

  App.slots.delete("t58f");

  // ---- ROADMAP 4.19(3): the gloss can follow the image's own brightness ----
  // A decal half white and half black with a hard edge, Gloss +100 over a smoothness of 80. Evenly,
  // both halves get it; following the light parts, only the white half; the dark parts, only black.
  var halves = function(){ var c = mkCanvas(40, 40), g = ctx2d(c); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 20, 40);
                           g.fillStyle = "#000000"; g.fillRect(20, 0, 20, 40); return c; };
  var GS = mkSlot("t58g"); App.slots.set("t58g", GS); App.activeSlot = GS;
  out.gloss = {};
  ["cover", "light", "dark"].forEach(function(m){
    var dg = LayerNode.of({ type: "decal", name: "ink " + m, bmp: halves(), x: .5, y: .5, scale: 1, rot: 0, flip: false,
                            visible: true, opacity: 1, blend: "normal", surf: { sm: 100, mt: 0, em: 0, preset: "custom", glossSrc: m } });
    GS.layers = [dg]; GS.chanC = null;
    applyDecalSurface(GS, dg); compositeChannels(GS);
    var smc = chanOut(GS, "smooth") || GS.smooth;
    out.gloss[m] = { white: px(smc, 54, 64)[0], black: px(smc, 74, 64)[0], outside: px(smc, 8, 8)[0] };
  });
  out.gloss.carried = DecalStyle.carry({ sm: 5, glossSrc: "dark" }).glossSrc;
  App.slots.delete("t58g");

  // ---- ROADMAP 4.19(4): cavity — the depth map's hollows darken the decal's own colour ----
  // A flat mid-grey 48-px marking over a flat height map with one 2-px groove down the middle
  // (image x 23-24, sheet x 63-64 at scale 1 on a 128 sheet). With Cavity 100 the groove goes dark
  // and the flat top — including 6 px in from the silhouette, where the outside's zero height is
  // within no blur's reach — keeps its colour. Cavity 0, and the same map under "edge", leave it all.
  var grey = function(){ var c = mkCanvas(48, 48), g = ctx2d(c); g.fillStyle = "#a0a0a0"; g.fillRect(0, 0, 48, 48); return c; };
  var groove = mkCanvas(48, 48), gg = ctx2d(groove);
  gg.fillStyle = "#ffffff"; gg.fillRect(0, 0, 48, 48); gg.fillStyle = "#000000"; gg.fillRect(23, 0, 2, 48);
  var CS = mkSlot("t58c4"); App.slots.set("t58c4", CS); App.activeSlot = CS;
  var cavRun = function(surf){
    var dc = LayerNode.of({ type: "decal", name: "plate", bmp: grey(), x: .5, y: .5, scale: 1, rot: 0, flip: false,
                            visible: true, opacity: 1, blend: "normal", surf: surf });
    dc.heightMap = groove; dc.heightName = "groove.png";
    CS.layers = [dc]; CS.composite = flat("#404040");
    Composite.sheet(CS, "color", null);
    return { groove: px(CS.composite, 63, 64)[0], top: px(CS.composite, 50, 64)[0], rim: px(CS.composite, 46, 64)[0],
             foot: px(CS.composite, 61, 64)[0],
             outside: px(CS.composite, 20, 64)[0] };
  };
  out.cavity = {
    off:  cavRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map" }),
    on:   cavRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", cavity: 100 }),
    half: cavRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", cavity: 50 }),
    edge: cavRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "edge", cavity: 100 }),
    inv:  cavRun({ sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", heightInv: true, cavity: 100 }),
    carried: DecalStyle.carry({ sm: 5, cavity: 40 }).cavity,
    // the footprint the gloss and the relief are built from is the marking's, not its shading
    footprintClean: (function(){
      var d = LayerNode.of({ type: "decal", name: "fp", bmp: grey(), x: .5, y: .5, scale: 1, rot: 0, flip: false, visible: true,
                             opacity: 1, blend: "normal", surf: { sm: 0, mt: 0, em: 8, preset: "custom", relief: "map", cavity: 100 } });
      d.heightMap = groove;
      var f = decalFootprint(d, N, N);
      return px(f.canvas, 63, 64)[0] === px(f.canvas, 50, 64)[0];
    })()
  };
  App.slots.delete("t58c4");

  // ---- ROADMAP 4.19(5): a NORMAL map as the relief source, turned into a height ----
  // One synthetic surface — three rivets and a raised block with 3-px ramps — written out three ways:
  // a greyscale depth map, and a normal map with green down (DirectX) and up (OpenGL). The test is
  // whether the loader tells them apart, whether the height it integrates is the surface it came
  // from, and whether a decal given the normal map draws the relief the depth map draws.
  var NS = 64, HT = new Float32Array(NS * NS), hmax = 0;
  for (var yy = 0; yy < NS; yy++) for (var xx = 0; xx < NS; xx++) {
    var v = 0;
    [[16, 16], [48, 16], [16, 48]].forEach(function(c){ v += 6 * Math.exp(-((xx - c[0]) * (xx - c[0]) + (yy - c[1]) * (yy - c[1])) / 32); });
    v += 5 * Math.max(0, Math.min(1, Math.min(xx - 34, 58 - xx, yy - 34, 58 - yy) / 3));
    HT[yy * NS + xx] = v; hmax = Math.max(hmax, v);
  }
  var hAt = function(A, x, y){ return A[Math.max(0, Math.min(NS - 1, y)) * NS + Math.max(0, Math.min(NS - 1, x))]; };
  // "bias" shifts every channel's rounding, the way a tool that writes flat as 127 does.
  var encN = function(A, greenUp, bias){
    var c = mkCanvas(NS, NS), g = ctx2d(c), im = g.createImageData(NS, NS);
    for (var y = 0; y < NS; y++) for (var x = 0; x < NS; x++) {
      var dx = (hAt(A, x + 1, y) - hAt(A, x - 1, y)) / 2, dy = (hAt(A, x, y + 1) - hAt(A, x, y - 1)) / 2;
      var l = Math.sqrt(dx * dx + dy * dy + 1), k = (y * NS + x) * 4;
      im.data[k] = Math.round((1 - dx / l) * 127.5 + (bias || 0));
      im.data[k + 1] = Math.round((1 - dy / l * (greenUp ? -1 : 1)) * 127.5 + (bias || 0));
      im.data[k + 2] = Math.round((1 + 1 / l) * 127.5); im.data[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  };
  var depthC = mkCanvas(NS, NS), dimg = ctx2d(depthC).createImageData(NS, NS);
  for (var q = 0; q < NS * NS; q++) { dimg.data[q*4] = dimg.data[q*4+1] = dimg.data[q*4+2] = Math.round(HT[q] / hmax * 255); dimg.data[q*4+3] = 255; }
  ctx2d(depthC).putImageData(dimg, 0, 0);
  var dxMap = encN(HT, false), glMap = encN(HT, true), biasMap = encN(HT, false, -.5);
  var LN = new Float32Array(NS * NS);                       // one direction only: horizontal ridges
  for (var q2 = 0; q2 < NS * NS; q2++) LN[q2] = Math.abs((Math.floor(q2 / NS) % 16) - 8) < 3 ? 4 : 0;
  var corr = function(A, B){
    var n = A.length, ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { ma += A[i]; mb += B[i]; }
    ma /= n; mb /= n;
    for (var j = 0; j < n; j++) { var a = A[j] - ma, b = B[j] - mb; sab += a * b; saa += a * a; sbb += b * b; }
    return sab / Math.sqrt(saa * sbb);
  };
  var greyOf = function(c){ var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, o = []; for (var i = 0; i < d.length; i += 4) o.push(d[i]); return o; };
  var white = mkCanvas(48, 48); ctx2d(white).fillStyle = "#fff"; ctx2d(white).fillRect(0, 0, 48, 48);
  var det = function(c){ var r = Relief.detect(c); return { from: r.from, sure: !!r.sure, down: r.down || 0, up: r.up || 0 }; };
  out.nmap = {
    detDX: det(dxMap), detGL: det(glMap), detDepth: det(depthC), detWhite: det(white), detLines: det(encN(LN, false)),
    corrDX: corr(greyOf(Relief.fromNormal(dxMap, false)), HT),
    corrGL: corr(greyOf(Relief.fromNormal(glMap, true)), HT),
    corrWrong: corr(greyOf(Relief.fromNormal(dxMap, true)), HT),
    corrBias: corr(greyOf(Relief.fromNormal(biasMap, false)), HT),
    // A FLAT map written as 127, 127, 255: every texel tilted by the same half step. Integrated as
    // it stands that is a ramp across the whole decal, stretched to the full 8 bits.
    flat127: (function(){
      var c = mkCanvas(NS, NS), g = ctx2d(c); g.fillStyle = "rgb(127,127,255)"; g.fillRect(0, 0, NS, NS);
      var gr = greyOf(Relief.fromNormal(c, false)); return Math.max.apply(null, gr) - Math.min.apply(null, gr);
    })(),
    carried: DecalStyle.carry({ sm: 5, heightFrom: "normal-gl" }).heightFrom,
    absent: Relief.heightFrom({ relief: "map" }), junk: Relief.heightFrom({ heightFrom: "rgb" })
  };
  var holder = { heightMap: dxMap };
  var h1 = Relief.heightImage(holder, { heightFrom: "normal-dx" }), h2 = Relief.heightImage(holder, { heightFrom: "normal-dx" });
  out.nmap.cached = h1 === h2 && h1 !== dxMap;
  out.nmap.depthIsItself = Relief.heightImage(holder, {}) === dxMap;
  // and a cavity reads the derived height, not the normal map's colours (before the re-read below
  // replaces the cached one)
  out.nmap.cavityHm = (function(){ var c = Relief.cavityOf({ relief: "map", heightFrom: "normal-dx", cavity: 100 }, holder); return !!c && c.hm === h1; })();
  out.nmap.reread = Relief.heightImage(holder, { heightFrom: "normal-gl" }) !== h1;
  // End to end, through the real emboss: the decal's normal channel from the DirectX map against the
  // same decal given the depth map, over the decal's own box. And the normal map read as if it were a
  // depth map, which is what every decal did with one before this — the thing the reading prevents.
  var NR = mkSlot("t58n"); App.slots.set("t58n", NR); App.activeSlot = NR;
  var nRun = function(surf, height){
    NR.layers = []; NR.smooth = flat("#505050"); NR.metal = flat("#303030"); NR.normal = flat("#8080ff");
    var d = mkDecal("nmap", .5, .5, surf);
    d.bmp = white; d.heightMap = height; d.heightName = "n.png";
    NR.layers = [d]; App.activeLayer = d;
    applyDecalSurface(NR, d); compositeChannels(NR);
    var sh = sheet(chanOut(NR, "normal")), o = [];
    for (var y = 42; y < 86; y++) for (var x = 42; x < 86; x++) { var k = (y * N + x) * 4; o.push(sh[k] - 128, sh[k + 1] - 128); }
    return o;
  };
  var EMN = { sm: 0, mt: 0, em: 8, preset: "custom", relief: "map" };
  var fromDepth = nRun(EMN, depthC);
  out.nmap.e2eDX = corr(nRun(Object.assign({ heightFrom: "normal-dx" }, EMN), dxMap), fromDepth);
  out.nmap.e2eGL = corr(nRun(Object.assign({ heightFrom: "normal-gl" }, EMN), glMap), fromDepth);
  out.nmap.e2eAsDepth = corr(nRun(EMN, dxMap), fromDepth);
  App.slots.delete("t58n");
  // A projection's undo re-renders from its cloned parameters, so the image has to be in the clone
  // beside the reading, or undoing a swap restores one without the other.
  out.nmap.projUndo = (function(){
    var P = { frame: { p: [0, 0, 0], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, scale: 1, rot: 0,
              surf: { relief: "map" }, heightMap: depthC, heightName: "d.png" };
    var before = projParamsClone(P);
    P.heightMap = dxMap; P.heightName = "n.png"; P.surf = { relief: "map", heightFrom: "normal-dx" };
    projParamsAssign(P, before);
    return P.heightMap === depthC && P.heightName === "d.png" && Relief.heightFrom(P.surf) === "depth";
  })();
  ["t58a", "t58b", "t58c", "t58d", "t58e", "t58f"].forEach(function(k){ App.slots.delete(k); });
  App.activeSlot = slotWas; App.activeLayer = layerWas;
  App.undoStack.length = 0; App.redoStack.length = 0;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 500), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== the look lands in the decal's own channel slots (4.28(f)) ===");
console.log(`   ${o.shape}`);
R.is(o.applied && !o.groupMade && o.nodes === 1,
  `applying a look adds nothing to the stack (${o.nodes} node) — it used to wrap the decal in a group and put three sibling layers in it`);
R.is(o.chans === "em:normal mt:metal sm:smooth" || o.chans === "em:normal sm:smooth",
  `one derived CONTENT per channel the look writes to (${o.chans}) — vinyl is gloss and emboss, and metal Δ 0 gets none`);
R.is(o.untouched.smooth === 0 && o.untouched.normal === 0,
  "and the slot's own _n sheets are untouched — that is the whole difference from the bake");

console.log("\n=== and they are the pixels the destructive bake wrote ===");
R.is(o.bakeChanged, "the reference bake really changed the sheet — otherwise this compares two no-ops");
for (const ch of ["smooth", "metal", "normal"])
  console.log(`   ${ch.padEnd(7)} ${o.same[ch] ? `${o.same[ch].off} of ${o.same[ch].of} bytes differ, worst ${o.same[ch].worst}` : "no sheet"}`);
R.is(o.same.smooth && o.same.smooth.worst === 0, `smoothness matches exactly (${o.same.smooth && o.same.smooth.off} bytes differ)`);
R.is(o.same.metal && o.same.metal.worst === 0, `metalness matches exactly (${o.same.metal && o.same.metal.off} bytes differ)`);
R.is(o.same.normal && o.same.normal.worst === 0, `and the embossed normal matches exactly (${o.same.normal && o.same.normal.off} bytes differ)`);

console.log("\n=== the response belongs to the decal ===");
R.is(o.hidden.off === 0, "hiding the DECAL takes the gloss with the sticker — the channel goes back to its imported sheet. It used to need the group, because the two were siblings");
console.log(`   moved: old spot ${o.move.oldSpot[0]} (was ${o.move.wasAtOldSpot[0]}), new spot ${o.move.newSpot[0]}`);
R.is(o.move.oldSpot[0] === 80, `moving the decal leaves the old spot at the base value (${o.move.oldSpot[0]})`);
R.is(o.move.newSpot[0] > 90, `and puts the gloss where the decal now is (${o.move.newSpot[0]})`);

console.log("\n=== stacking, and not compounding ===");
R.is(o.stable === o.stack.one,
  `refreshing twice more changes nothing (${o.stable} vs ${o.stack.one}) — a derived layer built from the cached composite would read its own result back in`);
R.is(o.stack.two > o.stack.one,
  `a second decal over the first accumulates (${o.stack.one} → ${o.stack.two}), the way the bake did`);

console.log("\n=== and it refuses what it cannot do ===");
console.log(`   none: ${o.noneRefused.said}`);
R.is(!o.noneRefused.ok && /changes nothing/.test(o.noneRefused.said) && o.noneRefused.shape === 1,
  "a look with three zero deltas is refused and derives nothing — the no-op the interim fix caught, in the new path too");
console.log(`   no _n: ${o.noNRefused.said}`);
R.is(!o.noNRefused.ok && /no _n surface map/.test(o.noNRefused.said),
  "and a slot with no _n map says so rather than making empty layers");

console.log("\n=== wear is the fourth delta (2026-09-02) ===");
console.log(`   wear: ${o.wear.said}`);
R.is(o.wear.ok, "a Paint-only look applies on a slot with NO _n — the gate asks per channel now, not \"is there an _n\"");
R.is(o.wear.derived === "wr", `and it lands as derived content in the decal's own wear slot (${o.wear.chans})`);
R.is(o.wear.under[0] === 255, `off the sticker the paint mask is untouched (${o.wear.under[0]})`);
R.is(o.wear.at[0] === 175, `and under it the paint is stripped back by exactly the delta (255 → ${o.wear.at[0]}) — the same coverage-times-delta the gloss and metal channels use, on the albedo's alpha`);
R.is(o.wear.dragHidden && o.wear.dragAt[0] === 255 && o.wear.releasedAt[0] === 175,
  `a 2-D drag hides the paint half too (${o.wear.dragAt[0]} under the decal mid-drag, ${o.wear.releasedAt[0]} once released) — SurfDrag.hold hid smooth, metal and normal only until 2026-09-26, so a scorch mark's stripped paint sat where the decal used to be for the whole gesture`);
console.log("\n=== the response survives a .wtproj round trip, in the decal ===");
R.is(!o.rt.isGroup && o.rt.nodes === 1 && o.rt.kind === "image",
  `it comes back as ONE layer whose colour slot is the image (${o.rt.nodes} node, ${o.rt.kind}) — no folder to rebuild, so nothing to re-link by object identity`);
R.is(o.rt.keys === "em,sm", `carrying its derived contents and what each is for (${o.rt.keys})`);
R.is(o.rt.movedAfterLoad > 90 && o.rt.oldSpotAfterLoad === 80,
  `so the response still follows the decal after a reload (${o.rt.oldSpotAfterLoad} where it was, ${o.rt.movedAfterLoad} where it is)`);

console.log("\n=== ...and a project written BEFORE 4.28(f) is folded on load ===");
console.log(`   old shape in the file: ${o.old.wasFolder} -> ${o.old.nodes} node(s), group=${o.old.isGroup}, derived=${o.old.keys}`);
R.is(o.old.wasFolder, "the file really was the old shape — a surfGroup folder with surfKey siblings — or this reads a new file through a new reader");
R.is(!o.old.isGroup && o.old.nodes === 1,
  `and it comes back as one layer (${o.old.nodes}), the folder dissolved because holding the response was all it was for`);
R.is(o.old.keys === "em,sm" && o.old.stillDerived === 2,
  `with the siblings folded into its channel slots and still marked derived (${o.old.keys}) — so the next move rebuilds them instead of leaving two sets`);

console.log("\n=== the look waits until the decal is put down, and never steals the selection ===");
R.is(o.place.selectedType === "decal",
  `placing from the editor leaves the DECAL selected (${o.place.selectedType}) — selecting the group killed clicking the model, pasting into 3-D and G`);
R.is(!o.place.grouped, "and makes no group yet: the decal is floating at the sheet centre, so there is nowhere to derive a response from");
R.is(o.place.keptLook, "the Look is remembered on the layer, ready for when it lands");
R.is(!o.place.placing, `and no mode is left waiting for a click — with no model it lands flat, where it stays (${o.place.placing})`);
console.log(`   once put down: ${o.settled.nodes} node(s), grouped=${o.settled.grouped}, derived=${o.settled.keys}`);
R.is(!o.settled.grouped && o.settled.nodes === 1,
  `putting it down derives the response INTO the decal (${o.settled.nodes} node) — the folder, its name and its fold state go with the mechanism that needed them`);
R.is(o.settled.keys === "em,sm", `on the channels the Look writes (${o.settled.keys})`);
R.is(o.settled.stillOnDecal, "and the selection is still on the decal afterwards");

console.log("\n=== relief: one height field, three ways of filling it (ROADMAP 4.19) ===");
R.is(o.relief.defaultSame,
  "a Look with no `relief` at all renders identically to `edge` — every project written before this keeps its decals exactly where they were");
R.is(o.relief.edgeMoved > 0, `and "edge" really does something (${o.relief.edgeMoved} bytes off flat), or the line above would pass on two blanks`);
console.log(`   inside a solid marking:  edge ${o.relief.edgeInner.join(",")}   bevel ${o.relief.bevelInner.join(",")}   map ${o.relief.mapOffCentre.join(",")}   (128,128 is flat)`);
R.is(o.relief.edgeInner[0] === 128 && o.relief.edgeInner[1] === 128,
  "edge leaves the INTERIOR of a solid marking perfectly flat — which is the limitation 4.19 exists for, not a bug");
R.is(o.relief.bevelInner[0] !== 128 || o.relief.bevelInner[1] !== 128,
  "bevel gives that same interior a slope, worked out from the outline and needing no file at all");
R.is(o.relief.bevelCentre[0] === 128 && o.relief.bevelCentre[1] === 128,
  "and the middle of the bevel is flat again — a rounded rim, not a dome, so a big marking does not read as a bubble");
R.is(o.relief.mapOffCentre[0] !== 128 || o.relief.mapOffCentre[1] !== 128,
  "a depth map drives the interior too, from its own content rather than from the outline");
console.log(`   invert: ${o.relief.mapOffCentre.join(",")} becomes ${o.relief.invOffCentre.join(",")}`);
R.is((o.relief.mapOffCentre[0] - 128) * (o.relief.invOffCentre[0] - 128) < 0 ||
     (o.relief.mapOffCentre[1] - 128) * (o.relief.invOffCentre[1] - 128) < 0,
  "and Invert flips the slope rather than merely changing it — a depth tool that emits the other polarity turns every ridge into a groove, and this is the control that fixes it");
R.is(o.relief.noMapFallsBack,
  "“Depth map” with no map loaded falls back to the outline instead of rendering nothing — a mode that cannot do what it says is what §4 forbids");
console.log(`   round trip: ${JSON.stringify(o.relief.rt)}`);
R.is(o.relief.rt.hasMap && o.relief.rt.name === "dome.png",
  "the depth image survives a .wtproj round trip — it is a canvas, so it is stored like the bitmap it belongs to");
R.is(o.relief.rt.mode === "map" && o.relief.rt.inv,
  "and so do the mode and the invert flag, which ride inside `surf` and therefore needed no format work at all");

console.log("\n=== a PROJECTED decal carries the same Look (ROADMAP 4.8b) ===");
console.log(`   projector path: ${o.proj.mode}; ${o.proj.drawn} texels drawn`);
if (o.proj.mode !== "gl") {
  console.log("   NOTE: no WebGL here, so this ran on the canvas fallback — the box is the union of");
  console.log("         the triangles it rasterised rather than a probe of the GPU's result.");
}
R.is(o.proj.drawn > 0, `the projection landed on the sheet at all (${o.proj.drawn} texels)`);
R.is(!o.proj.grouped && o.proj.nodes === 1,
  `the response is in the projected layer itself (${o.proj.nodes} node) — one per texture it lands on, and no folder created or garbage-collected around any of them`);
R.is(o.proj.keys === "em,sm", `holding the contents this Look writes (${o.proj.keys}) — vinyl is gloss and a raised edge, no metal`);
console.log(`   box ${o.proj.box ? o.proj.box.join(",") : "none"} against the alpha's true extent ${o.proj.trueBox ? o.proj.trueBox.join(",") : "none"} on a ${o.proj.sheet}² sheet`);
R.is(!!o.proj.box, "the projector reports where it landed — without that box the per-pixel walk is the whole sheet, which is what 4.8 could not pay for");
R.is(o.proj.contains,
  "and the box CONTAINS every texel the projection drew: short by one row and the gloss comes out clipped along that edge, invisible on screen and permanent in the export");
R.is(o.proj.area < .5, `while still being a fraction of the sheet (${Math.round(o.proj.area * 100)}%) — a box that bounds nothing is not worth reporting`);
R.is(o.proj.centre > o.proj.base + 10 && o.proj.corner === o.proj.base,
  `the smoothness sheet has the response under the decal (${o.proj.centre}) and its base everywhere else (${o.proj.corner})`);

console.log("\n=== rebuilt when the drag ends, not on every frame of it ===");
R.is(o.proj.live.newSpotNotBuilt && o.proj.live.hiddenNotDeleted,
  "a live drag frame re-renders the colour and does not rebuild the response — three per-pixel walks and a channel composite per sheet is not a per-frame cost, and the contents are still there");
R.is(o.proj.live.oldSpotIsBase && o.proj.live.allHidden,
  "and it does not SHOW the old one either: the derived CONTENTS are hidden for the length of the gesture — the decal itself must not go with them, which is why 4.28(f) gave a content its own `visible` — so the sheet is at its base where the decal used to be rather than carrying a gloss highlight and a raised edge the decal has left (ROADMAP 4.8c)");
R.is(o.proj.live.releaseRestores && o.proj.live.commitRestores,
  "they come back on the commit — and on a bare release with no commit behind it, which is the pointercancel case: the hidden set lives on the gesture, and a flag left set would outlive it as a channel no control can turn on again");
R.is(o.proj.afterCommitNew > o.proj.base + 10 && o.proj.afterCommitOld === o.proj.base && o.proj.afterCommitAt > o.proj.sheet * .6,
  `and the non-live render catches up: response now at x=${o.proj.afterCommitAt} (${o.proj.afterCommitNew}), base back at the old spot (${o.proj.afterCommitOld})`);

console.log("\n=== dragging a UV decal in 2-D commits its response (4.8c) ===");
const D2 = o.drag2d;
console.log(`   before ${D2.from} at the old spot; after the drop, old ${D2.oldSpot} new ${D2.newSpot}, base ${D2.base}`);
R.is(D2.newSpot > D2.base + 10 && D2.oldSpot === D2.base,
  `the response follows the decal across the sheet (${D2.oldSpot} where it was, ${D2.newSpot} where it went) — endAll pushed a "move decal" step and called scheduleComposite, and never called ensureDecalSurface, so the mouse drag left the gloss behind permanently while the keyboard path did not`);
R.is(D2.visible, "and the contents hidden for the gesture are visible again");
R.is(D2.undoOld > D2.base + 10 && D2.undoNew === D2.base,
  `undo takes the response back with the decal (${D2.undoOld} where it was, ${D2.undoNew} where it went) — both closures rebuild, or Ctrl+Z moves the sticker and leaves its gloss at the far end`);

console.log("\n=== the Look can be turned off, back on, and deleted with the decal ===");
R.is(o.proj.offKeys === 0 && !o.proj.offGrouped,
  "setting it to None removes the derived contents — and there was never a folder to dissolve afterwards, which is three blocks of bookkeeping that stopped existing");
R.is(o.proj.offFlat === o.proj.base, `and the sheet is back to its base (${o.proj.offFlat})`);
R.is(o.proj.onAgainKeys === 2, `choosing a Look again rebuilds them (${o.proj.onAgainKeys} contents)`);

console.log("\n=== ...and a Custom look's Paint Δ goes with the rest of it (2026-09-26) ===");
const PD = o.paintD;
console.log(`   placed ${PD.placed} at x=${PD.at}; mid-drag the old spot reads ${PD.drag.oldSpot}; dropped ${PD.drop.v} at x=${PD.drop.at}, old spot ${PD.drop.oldSpot}; off the sheet ${PD.off.low}; Look None ${PD.none.low}`);
R.is(PD.keys === "sm,wr" && PD.placed <= 180,
  `a projected decal carries the paint mask as derived content like the gloss (${PD.keys}) and strips the paint under it (255 → ${PD.placed})`);
R.is(PD.drag.smHidden && PD.drag.hidden && PD.drag.oldSpot === 255,
  `a live drag hides the paint half WITH the gloss (old spot ${PD.drag.oldSpot}) — the drag loop named three channels, so the stripped paint stayed where the decal had been for the whole gesture`);
R.is(PD.drop.shown && PD.drop.v <= 180 && PD.drop.oldSpot === 255 && PD.drop.at > PD.at + 20,
  `the drop rebuilds it where the decal went (x=${PD.drop.at}, ${PD.drop.v}) and nowhere else (old spot ${PD.drop.oldSpot})`);
R.is(PD.off.empty && PD.off.keys === "" && PD.off.low === 255,
  `moving the decal off the sheet leaves nothing it derived there (${PD.off.keys || "none"}; lowest paint ${PD.off.low})`);
R.is(PD.backOn === "sm,wr", `coming back onto the sheet brings both back (${PD.backOn})`);
R.is(PD.none.keys === "" && PD.none.low === 255,
  `and setting the Look to None removes the paint half too (${PD.none.keys || "none"} left; lowest paint ${PD.none.low}) — it used to keep stripping paint under a decal whose Look said None`);
R.is(PD.restored === "em,sm", `(the Look the sections below expect is back: ${PD.restored})`);
R.is(o.proj.afterDelete === 0, "deleting the projected decal takes its response with it — one node, so there is no way for it not to");
R.is(o.proj.afterUndo === 2, `and undo brings the response back with it (${o.proj.afterUndo} derived contents)`);

console.log("\n=== the decal's controls work from the folded group ===");
R.is(o.fromGroup.resolves, "selecting the group resolves to the one decal inside it");
R.is(o.fromGroup.decalSectionShown, "so the decal controls are shown — selecting the folder used to lose every one of them");
console.log(`   On the model said: ${o.fromGroup.gSaid}`);
R.is(/model first/.test(o.fromGroup.gSaid),
  "and On the model, reached from the folded group with no model loaded, says what it needs rather than doing nothing");

console.log("\n=== picking a tool inside a group finds the layer it writes to ===");
R.is(o.tool.landedOn === "My gloss" && o.tool.chan === "smooth",
  `the Smoothness brush selects the group's own gloss layer (${o.tool.landedOn}) instead of leaving you on a container no brush can paint`);
R.is(o.tool.decalHasDerivedSmooth && o.tool.derivedRefused && /rebuilt/.test(o.tool.derivedSaid),
  `and it skips the DECAL, which since 4.28(f) also holds smoothness — derived from its Look, so a stroke there is overwritten by the decal's next move. Reaching it by hand is refused in words: "${o.tool.derivedSaid.slice(0, 70)}…"`);
R.is(o.tool.refusedKids === 0 && o.tool.refusedStaysGroup,
  "a channel the group has nothing for ASKS, and answering no creates nothing");
R.is(o.tool.madeKids === 1 && o.tool.madeChan === "metal" && o.tool.madeInGroup,
  `answering yes puts one layer of that channel in the group and selects it (${o.tool.madeChan})`);

console.log("\n=== and the group moves together ===");
console.log(`   decal → ${o.together.decal.join(", ")}, sibling moved ${o.together.sibDx}, ${o.together.sibDy}`);
R.is(o.together.sibDx === .05 && o.together.sibDy === -.02,
  "another decal in the same group moves by the same delta, so the arrangement survives");


console.log("\n=== the separation 4.18 had to refuse cannot happen (4.28(f)) ===");
console.log(`   ${o.sep.start} derived contents at rest (${o.sep.keys}), ${o.sep.afterMove} after a reorder and a move`);
R.is(o.sep.start === 2 && o.sep.keys === "em,sm",
  `the decal carries its response in its own slots (${o.sep.keys})`);
R.is(o.sep.afterMove === o.sep.start && o.sep.stillOne === o.sep.keys,
  `reordering the decal and then moving it leaves ${o.sep.afterMove} derived contents, not ${o.sep.start * 2} — 4.18 had to REFUSE that drag, because a derived layer dragged out of the folder was invisible to the next refresh and a second was built silently. There is no node to drag out now, so the refusal, its message and its rule are deleted rather than ported`);
R.is(o.sep.grouped && o.sep.afterGroup === o.sep.start,
  "pressing Group on the decal wraps the decal — it used to have to wrap the FOLDER instead, or it pulled the decal out of its own response");
R.is(o.sep.dupe.made && o.sep.dupe.cut === "" && o.sep.dupe.keptPixels,
  `duplicating gives a copy whose contents keep the pixels and lose the derived marker (${JSON.stringify(o.sep.dupe.cut)}) — that marker is the permission a rebuild needs, so dropping it IS "detach this copy"`);
R.is(o.sep.afterDupMove === o.sep.start,
  `and the copy is not mistaken for the original on the next move (${o.sep.afterDupMove} derived, still)`);
R.is(o.gc.derivedGone && o.gc.keptMine && o.gc.layerStays,
  "turning the look off drops what was derived and leaves the user's own smoothness paint in the same node alone — the rule the folder GC had to be taught (4.18), one level down and with nothing to garbage collect");

console.log("\n=== a tiled part is projected onto every repeat (4.23(a)) ===");
const TL = o.tiled;
console.log(`   drawn ${TL.drawn} · ${TL.lit} texels, centred at x=${TL.at} (want ~${TL.want})`);
R.is(TL.drawn > 0 && TL.made, `a decal aimed at the SECOND repeat of a tiled part lands on the sheet at all (${TL.drawn} texels) — both projectors mapped aUV straight into the sheet, so u = 1.5 was off the edge and this was 0`);
R.is(TL.lit > 0 && Math.abs(TL.at - TL.want) < 24,
  `and it lands where u = 1.5 wraps to, the middle of the sheet (x=${TL.at}, want ~${TL.want}) — a fold per vertex would tear the triangles that straddle u = 1 and smear it, so where it went is the assertion and not that it went somewhere`);

console.log("\n=== the mirrored copy can keep its lettering readable (4.2) ===");
const SR = o.symRead;
console.log(`   ink on the far copy: reflected at x=${SR.reflected}, readable at x=${SR.readable} (the copy's centre is ${SR.mid})`);
R.is(SR.reflected > SR.mid,
  `a true reflection puts the image's left-hand ink on the far side of the copy's centre (x=${SR.reflected} > ${SR.mid}) — that is the copy reading backwards, and it is what a number or a name looks like on the other side of the vehicle`);
R.is(SR.readable > 0 && SR.readable < SR.mid,
  `ticking "keep the copy's lettering readable" puts it back on the near side (x=${SR.readable} < ${SR.mid}) — the copy stays exactly where the reflection put it and only the way the image reads changes, which is one negation of the image's right axis rather than a second placement`);

console.log("\n=== the vertical mirror is the horizontal one plus a half turn (4.2) ===");
const FY = o.flipY;
console.log(`   30° unflipped -> flip=${FY.flip} rot=${FY.rot} in ${FY.steps} step · undo ${FY.undoFlip}/${FY.undoRot} · twice ${FY.twiceFlip}/${FY.twiceRot}`);
R.is(FY.flip === true && FY.rot === -150,
  `one press mirrors and half-turns together (flip ${FY.flip}, rot ${FY.rot} from 30°) — a third stored field would be a fourth thing fourteen sites have to agree about, for a transform the two existing ones already express`);
R.is(FY.steps === 1 && FY.undoFlip === false && FY.undoRot === 30,
  `and it is ONE undo step over both fields (${FY.steps}), back to ${FY.undoRot}° — by hand it is two controls in the right order, and the wrong order leaves a marking rotated rather than flipped`);
R.is(FY.twiceFlip === false && FY.twiceRot === 30, `pressing it twice is the identity (${FY.twiceFlip}, ${FY.twiceRot}°)`);

console.log("\n=== the gloss can follow the image (4.19(3)) ===");
const GL = o.gloss || {};
const near = (v, t) => Math.abs(v - t) <= 2;
for (const m of ["cover", "light", "dark"]) if (GL[m]) console.log(`   ${m.padEnd(6)} white half ${GL[m].white} · black half ${GL[m].black} · outside ${GL[m].outside}`);
R.is(GL.cover && near(GL.cover.white, 180) && near(GL.cover.black, 180) && GL.cover.outside === 80,
  "evenly, the whole marking gets the Gloss — the behaviour every decal had before, and still the default");
R.is(GL.light && near(GL.light.white, 180) && near(GL.light.black, 80),
  `following the light parts, white ink is fully glossy and black ink not at all (${GL.light && GL.light.white} / ${GL.light && GL.light.black})`);
R.is(GL.dark && near(GL.dark.white, 80) && near(GL.dark.black, 180),
  `following the dark parts, the reverse (${GL.dark && GL.dark.white} / ${GL.dark && GL.dark.black})`);
R.is(GL.carried === "dark", "and the choice rides on the Look through the decal editor and the library, as the relief does");

console.log("\n=== cavity: the depth map's hollows darken the colour (4.19(4)) ===");
const CV = o.cavity || {};
for (const k of ["off", "half", "on", "edge", "inv"]) if (CV[k]) console.log(`   ${k.padEnd(5)} groove ${CV[k].groove} · flat top ${CV[k].top} · 6 px in ${CV[k].rim} · outside ${CV[k].outside}`);
R.is(CV.off && CV.off.groove === CV.off.top && CV.off.top === 160,
  `with Cavity 0 the groove is the marking's own colour (${CV.off && CV.off.groove}) — nothing changes for a Look that does not ask`);
R.is(CV.on && CV.on.groove < CV.on.top - 60,
  `with Cavity 100 the groove goes dark (${CV.on && CV.on.groove} against ${CV.on && CV.on.top} on the flat top)`);
R.is(CV.on && CV.on.top === 160 && CV.on.rim === 160 && CV.on.outside === 64,
  "and the flat top keeps its colour — 6 px in from the silhouette too, where a blur that counted the outside would have darkened a rim — and the surface around it is untouched");
R.is(CV.half && CV.half.groove > CV.on.groove && CV.half.groove < CV.off.groove,
  `the strength scales it (50 gives ${CV.half && CV.half.groove}, between ${CV.on && CV.on.groove} and ${CV.off && CV.off.groove})`);
R.is(CV.edge && CV.edge.groove === 160,
  "under \"From the edge\" the map drives nothing, so neither does the cavity — it belongs to the depth map");
R.is(CV.inv && CV.inv.groove === 160 && CV.inv.top === 160 && CV.inv.foot < 140,
  `inverted, the groove is a ridge: its crest and the flat stay lit (${CV.inv && CV.inv.groove} / ${CV.inv && CV.inv.top}) and the crease at its foot goes dark (${CV.inv && CV.inv.foot})`);
R.is(CV.footprintClean, "the footprint the gloss and relief are built from is the marking's own, not its shading");
R.is(CV.carried === 40, "and the strength rides on the Look through the decal editor and the library");

console.log("\n=== a normal map as the relief source, turned into a height (4.19(5)) ===");
const NM = o.nmap || {};
const f3 = v => (typeof v === "number" ? v.toFixed(3) : String(v));
for (const k of ["detDX", "detGL", "detDepth", "detWhite", "detLines"]) if (NM[k]) console.log(`   ${k.padEnd(8)} ${NM[k].from}${NM[k].sure ? " (sure)" : ""} · votes down ${NM[k].down} / up ${NM[k].up}`);
console.log(`   height vs the surface: DX ${f3(NM.corrDX)} · GL ${f3(NM.corrGL)} · DX read as GL ${f3(NM.corrWrong)} · flat written as 127 ${f3(NM.corrBias)}`);
console.log(`   emboss vs the depth map's: DX ${f3(NM.e2eDX)} · GL ${f3(NM.e2eGL)} · the normal map read as a depth map ${f3(NM.e2eAsDepth)}`);
R.is(NM.detDX && NM.detDX.from === "normal-dx" && NM.detDX.sure && NM.detGL && NM.detGL.from === "normal-gl" && NM.detGL.sure,
  "a normal map is recognised, and which way its green points is read off the image — a surface closes round every loop only under the right reading");
R.is(NM.detDepth && NM.detDepth.from === "depth" && NM.detWhite && NM.detWhite.from === "depth",
  "a greyscale depth map and a plain white image are not normal maps");
R.is(NM.detLines && NM.detLines.from === "normal-dx" && !NM.detLines.sure,
  `a map of straight lines along one axis cannot say which way green points, and says so (votes ${NM.detLines && NM.detLines.down}/${NM.detLines && NM.detLines.up}) — read the game's way, and the status tells the user to check`);
R.is(NM.corrDX > .97 && NM.corrGL > .97,
  `the integrated height is the surface the map was made from (${f3(NM.corrDX)} DirectX, ${f3(NM.corrGL)} OpenGL)`);
R.is(NM.corrWrong < .8,
  `and read with green the wrong way it is not (${f3(NM.corrWrong)}) — the reading is the difference between a rivet and a dent`);
R.is(NM.flat127 === 0 && NM.corrBias > .97,
  `a map that writes flat as 127 is not integrated into a ramp across the decal (a flat one spans ${NM.flat127} grey levels, the surface still ${f3(NM.corrBias)}) — the mean slope is removed`);
R.is(NM.e2eDX > .9 && NM.e2eGL > .9,
  `through the real emboss, a decal given the normal map draws the relief the depth map draws (${f3(NM.e2eDX)}, ${f3(NM.e2eGL)})`);
R.is(NM.e2eAsDepth < NM.e2eDX - .2,
  `where the same file read as a depth map — what the loader did with one before — does not (${f3(NM.e2eAsDepth)})`);
R.is(NM.cached && NM.reread && NM.depthIsItself,
  "the height is derived once per image and reading, a new reading derives it again, and a depth map is used as it is");
R.is(NM.cavityHm, "the cavity darkens by the derived height, not by the normal map's colours");
R.is(NM.carried === "normal-gl" && NM.absent === "depth" && NM.junk === "depth",
  "the reading rides on the Look through the editor and the library, and a Look without one — every project before this — reads a depth map");
R.is(o.relief && o.relief.rt && o.relief.rt.from === "normal-gl", "and the .wtproj keeps it");
R.is(NM.projUndo, "undoing a projected decal's map swap puts back the image with its reading — not the old reading over the new file");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
