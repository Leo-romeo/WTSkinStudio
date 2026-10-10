// Autosave and crash recovery (ROADMAP 4.50(2)): edit, reload without saving, recover, and get the
// same nodes back through ProjNode — the gate the item names — plus what makes that true.
//
// It drives a REAL reload over CDP rather than simulating one, because the thing under test is what
// survives the page going away: the IndexedDB copy, the question the browser asks on the way out,
// and the offer on the welcome card of the page that comes back. Three page loads in one browser:
//
//   A  a small real vehicle (an .obj and three .tga, through `addFiles`, the way files come in),
//      edited through the app's own commands and real brush strokes. Checks the dirty signal (one
//      stroke undone, and undo all the way back, are clean again), the keep rule as a pure function,
//      the idle and the tab-hidden triggers, the third copy evicting the first — the hull's _c
//      replaced by a file of the same name in between — a copy the document moved under being
//      thrown away, and a pointer going down stopping a background copy. Then the page is reloaded
//      dirty — and the browser must ask.
//   C  the offer says which vehicle, when and how big; "Save it as a file" writes a .wtproj; Recover
//      brings back the SAME nodes (every ProjNode record, with each image replaced by a hash of its
//      pixels) and the same composite, and the first copy the recovered page takes holds the
//      sources it has now. Then Save cleans the project and marks its copies saved, a discarded
//      session's records are deleted, a copy from a newer build is refused by the loader's own
//      version gate, and an index from a newer build is neither read nor overwritten.
//   D  reloaded clean: the browser does not ask, and nothing saved or discarded is offered. Then a
//      remembered install reopening behind a card held up for an offer (a stand-in folder).
//
// And two fresh pages of their own:
//   B  edits with no history step (an over-budget bake and region bake, a _n adopted by a slot that
//      had none, Reset surface at its own size) next to ones that have one: undoing or redoing a
//      neighbour must never land on "saved" while such an edit is still applied — and a replacement
//      that IS a step, undone back to the save, is clean, as is a refused stroke's neighbour: the
//      refusal takes back the layer the tool made for it.
//   P  a heavier project: the copy must not hold the UI thread (CLAUDE.md §3) — with a control that
//      deliberately blocks, so a blind instrument cannot pass.
//
// Usage: node tools/t93_autosave.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// Shared by every page load. `describe` is the oracle: for each slot, every node exactly as
// ProjNode.save writes it — with each image the writer would store replaced by a hash of its pixels —
// plus the composited sheet and the three surface sheets.
const HELPERS = `
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var until = async function(fn, ms, what){
    var t = Date.now();
    for (;;) { var v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timed out waiting for " + what); await sleep(50); }
  };
  var fnv = function(d){ var h = 0x811c9dc5; for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  var hashCanvas = function(c){ c = toCanvas(c); return c.width + "x" + c.height + ":" + fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); };
  var describe = async function(){
    var out = [];
    var ids = [...App.slots.keys()].sort();
    for (var i = 0; i < ids.length; i++) {
      var s = App.slots.get(ids[i]);
      var ctx = { put: async function(c){ return hashCanvas(c); }, heights: new Map() };
      var nodes = [];
      for (var k = 0; k < s.layers.length; k++) nodes.push(await ProjNode.save(s.layers[k], ctx));
      compositeSlot(s);
      out.push({ id: s.id, nodes: nodes, composite: hashCanvas(s.composite), nEdited: !!s.nEdited,
        surface: s.smooth ? [hashCanvas(s.smooth), hashCanvas(s.metal), hashCanvas(s.normal)] : null });
    }
    return JSON.stringify(out);
  };
  var idbRaw = async function(key){ return (await Autosave.get([key]))[0]; };
  var index = async function(){ return Autosave.norm(await idbRaw("autosave.index")); };
  var status = function(){ return document.getElementById("status").textContent; };
  var asks = function(){ var e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
  var dot = function(){ Recovery.mark(); return $("btnSaveProj").classList.contains("unsaved"); };
  // Would a copy be taken now, were the unsaved work old enough? Never, for the state that was saved.
  var dueIfOld = function(){ var e = Autosave.EVERY_MS; Autosave.EVERY_MS = 0; try { return Autosave.due(Date.now() + 1); } finally { Autosave.EVERY_MS = e; } };
  // A source's bytes, whichever form it is in: a model's text, a texture's ArrayBuffer, a stored Blob.
  var digest = async function(d){
    var u = typeof d === "string" ? new TextEncoder().encode(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new Uint8Array(d);
    return u.length + ":" + fnv(u);
  };
  // Save proj, the download stubbed.
  var save = async function(){
    var realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function(){ return "blob:stub"; }; HTMLAnchorElement.prototype.click = function(){};
    try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  };
  var NL = String.fromCharCode(10);
  var tga = function(r, g, b, a){
    var W = 16, H = 16, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W; u[14] = H; u[16] = 32; u[17] = 0x20;
    for (var i = 0; i < W * H; i++) { var p = 18 + i * 4; u[p] = b; u[p+1] = g; u[p+2] = r; u[p+3] = a; }
    return u;
  };
  // A small real vehicle, through the way files come in: an .obj of two parts, the hull with a _c
  // and a _n, the wing with a _c only.
  var loadVehicle = async function(){
    var obj = "mtllib t93.mtl" + NL, vi = 0;
    [{ name: "hull", mat: "t93_hull" }, { name: "wing", mat: "t93_wing" }].forEach(function(g, k){
      var o = k * 10, b = vi;
      obj += "o " + g.name + NL + "usemtl " + g.mat + NL;
      obj += "v " + o + " 0 0" + NL + "v " + (o + 1) + " 0 0" + NL + "v " + o + " 1 0" + NL + "v " + (o + 1) + " 1 0" + NL;
      obj += "vt 0 0" + NL + "vt 1 0" + NL + "vt 0 1" + NL + "vt 1 1" + NL;
      obj += "f " + (b+1) + "/" + (b+1) + " " + (b+2) + "/" + (b+2) + " " + (b+3) + "/" + (b+3) + NL;
      obj += "f " + (b+2) + "/" + (b+2) + " " + (b+4) + "/" + (b+4) + " " + (b+3) + "/" + (b+3) + NL;
      vi += 4;
    });
    await addFiles([new File([obj], "t93_0.obj"), new File([tga(120, 130, 90, 255)], "t93_hull_c.tga"),
                    new File([tga(255, 128, 0, 128)], "t93_hull_n.tga"), new File([tga(90, 100, 140, 255)], "t93_wing_c.tga")]);
    await until(function(){ var h = App.slots.get("t93_hull"), w = App.slots.get("t93_wing"); return h && w && h.composite && w.composite && h.smooth; }, 10000, "the two slots");
  };
  var fill = function(name, col){ return LayerNode.of({ type: "fill", name: name, color: col, opacity: 1, blend: "normal", visible: true }); };
  // A real stroke with no layer selected, so the tool makes its own (strokes.js) and folds that step
  // into the stroke's.
  var strokeOnNewLayer = function(slot){
    App.activeSlot = slot; App.activeLayer = null;
    App.brush.mode = "color"; App.brush.size = 6; App.brush.opacity = 1; App.brush.hardness = 1; App.brush.spacing = .35;
    App.brush.color = "#ff0000";   // 0 and 255 channels survive a PNG round trip exactly at any edge alpha
    var began = beginStroke(false, false);
    stampAt(3, 8, 0, null); stampAt(12, 8, 0, null); endStroke();
    return began !== false;
  };
  // Replace… with a file, through the picker's own handler.
  var replaceWith = function(slot, file){ App.activeSlot = slot; App.replaceTarget = null; return $("replacePick").onchange({ target: { files: [file], value: "" } }); };
`;

const PHASE_A = `async function(){
  ${HELPERS}
  var out = window.__t93out = {};         // kept on the page so a throw can still report how far it got
  await loadVehicle();
  $("skinName").value = "t93_skin";
  var hull = App.slots.get("t93_hull"), wing = App.slots.get("t93_wing");
  out.fresh = { dirty: Autosave.dirty(), asks: asks(), dot: dot(), title: document.title, slots: [...App.slots.keys()].sort().join(",") };

  // ---- one stroke on the vehicle just loaded, then Ctrl+Z: back where it began ----
  // Usually the first thing anyone does. The stroke's step folds in the layer it had to make, and
  // until the review of 2026-09-26 that step started BETWEEN the two, so undoing it left the page
  // asking before it closed and a copy of an unchanged document due three minutes later.
  var loneFrom = App.undoStack.length, lone = strokeOnNewLayer(hull), loneSteps = App.undoStack.length - loneFrom, loneDirty = Autosave.dirty();
  doUndo();
  out.lone = { began: lone, steps: loneSteps, dirtyAfter: loneDirty, dirty: Autosave.dirty(), asks: asks(), dot: dot(), due: dueIfOld(), layers: hull.layers.length };

  // ---- edits, each through the command a click runs ----
  var rev0 = Autosave.rev, before = App.undoStack.length;
  App.activeSlot = hull; App.activeLayer = null;
  var mask = mkCanvas(16, 16); (function(){ var g = ctx2d(mask); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 10, 16); })();
  var base = LayerNode.of({ type: "fill", name: "t93 base", color: "#556b2f", opacity: .8, blend: "multiply", visible: true });
  base.mask = mask; base.scope = Scope.make(["hull"], { x: 2, y: 2, w: 10, h: 10 });
  addLayerTo(hull, base);
  var gloss = LayerNode.of({ type: "fill", name: "t93 gloss", chan: "smooth", color: "#b0b0b0", opacity: 1, blend: "normal", visible: true });
  addLayerTo(hull, gloss);
  var sticker = mkCanvas(8, 8); (function(){ var g = ctx2d(sticker); g.fillStyle = "#ff00ff"; g.fillRect(0, 0, 8, 8); g.fillStyle = "#00ffff"; g.fillRect(0, 0, 4, 4); })();
  var decal = LayerNode.of({ type: "decal", name: "t93 decal", bmp: sticker, x: .4, y: .6, scale: 1, rot: 30, flip: true, sym: null, surf: null, opacity: 1, blend: "normal", visible: true });
  var sm = mkCanvas(16, 16); (function(){ var g = ctx2d(sm); g.fillStyle = "#e0e0e0"; g.fillRect(2, 2, 8, 8); })();
  LayerNode.addContent(decal, "smooth", LayerNode.content("paint", { derived: "sm", canvas: sm }));
  addLayerTo(hull, decal);
  addLayerTo(wing, LayerNode.of({ type: "fill", name: "t93 fade", color: "#ffe000", grad: Gradient.make("uv", "#ffe000"), opacity: 1, blend: "normal", visible: true }));
  addLayerTo(wing, LayerNode.of({ type: "adjust", name: "t93 warm", hue: 8, sat: 110, bright: 100, contrast: 105, opacity: 1, blend: "normal", visible: true }));
  groupNodes(hull, [gloss, decal], "t93 group");
  // a real stroke on a layer it has to make: the two undo entries it folds into one (strokes.js)
  var began = strokeOnNewLayer(hull);
  // and a bake on the surface sheet, the other kind of history entry
  hull.nEdited = true;
  bakeAction("t93 smoothness", [hull.smooth], function(){ var g = ctx2d(hull.smooth); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 8, 8); }, function(){});
  out.edited = { began: began, dirty: Autosave.dirty(), asks: asks(), dot: dot(), title: document.title,
                 steps: App.undoStack.length, layers: layerNodes(hull.layers).length + layerNodes(wing.layers).length };

  // ---- the revision is the document's STATE: undo to where it began is clean, redo is not ----
  var n = App.undoStack.length - before;
  for (var i = 0; i < n; i++) doUndo();
  out.undone = { dirty: Autosave.dirty(), atStart: Autosave.rev === rev0, asks: asks(), layers: hull.layers.length + wing.layers.length };
  for (var j = 0; j < n; j++) doRedo();
  out.redone = { dirty: Autosave.dirty(), asks: asks(), layers: layerNodes(hull.layers).length + layerNodes(wing.layers).length };

  // ---- the keep rule, as the pure function it is ----
  var C = function(key, session, at, bytes, assets, saved){ return { key: key, session: session, at: at, bytes: bytes, assets: assets || null, saved: !!saved }; };
  var keep = function(copies, assets, cur, bound){
    var r = Autosave.retain({ v: 1, copies: copies, assets: assets || {} }, cur, bound);
    return r.copies.map(function(c){ return c.key; }).join(",") + " | drop " + r.drop.slice().sort().join(",") + " | src " + Object.keys(r.assets).sort().join(",");
  };
  var both = function(){ return [C("a2", "A", 10, 100, "sa"), C("a1", "A", 9, 100, "sa"), C("b2", "B", 8, 100, "sb"), C("b1", "B", 7, 100, "sb")]; };
  var srcs = function(){ return { sa: { bytes: 300 }, sb: { bytes: 300 } }; };
  out.retain = {
    lastTwo: keep([C("a3", "A", 3, 1), C("a2", "A", 2, 1), C("a1", "A", 1, 1)], {}, "A"),
    savedGoes: keep([C("a1", "A", 5, 1), C("b2", "B", 4, 1, null, true), C("b1", "B", 3, 1), C("c1", "C", 2, 1)], {}, "A"),
    threeSessions: keep([C("a1", "A", 9, 1), C("b1", "B", 8, 1), C("c1", "C", 7, 1), C("d1", "D", 6, 1), C("e1", "E", 5, 1)], {}, "A"),
    bound900: keep(both(), srcs(), "A", 900),
    bound700: keep(both(), srcs(), "A", 700),
    oneBeatsNone: keep(both(), srcs(), "A", 100),
    orphan: keep([C("a1", "A", 1, 1, "sa")], { sa: { bytes: 1 }, sx: { bytes: 1 } }, "A"),
    otherTab: keep([C("b2", "B", 2, 1), C("b1", "B", 1, 1)], {}, "A"),
  };

  // ---- copy 1: once the work is old enough, at the first quiet moment ----
  Autosave.EVERY_MS = 0; Recovery.IDLE_MS = 0; Recovery.held = false;
  await until(function(){ return Autosave.last; }, 20000, "the idle copy");
  var ix1 = await index();
  out.idle = { reason: Autosave.last.reason, copies: ix1.copies.length, mine: ix1.copies[0].session === Autosave.session,
    copied: Autosave.copiedRev === Autosave.rev, stillDirty: Autosave.dirty(), persistAsked: Autosave.persistAsked,
    entry: [ix1.copies[0].vehicle, ix1.copies[0].skin, ix1.copies[0].slots, ix1.copies[0].layers, ix1.copies[0].version, ix1.copies[0].app].join("|"),
    dotTitle: (dot(), $("btnSaveProj").title) };

  // ---- copy 2: the tab is hidden — not gated on the interval ----
  Autosave.EVERY_MS = 1e12;
  addLayerTo(wing, LayerNode.of({ type: "fill", name: "t93 second", color: "#123456", opacity: .5, blend: "screen", visible: true }));
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  await until(function(){ return Autosave.last && Autosave.last.reason === "hidden"; }, 20000, "the copy on hide");
  delete document.visibilityState;
  var ix2 = await index();
  out.hidden = { copies: ix2.copies.length, shared: ix2.copies[0].assets === ix2.copies[1].assets, srcRecords: Object.keys(ix2.assets).length };

  // ---- the hull's _c replaced by a file of the SAME name, between the second copy and the third ----
  // So the two copies kept when this page goes point at sources that differ under one path. C holds
  // the first copy of the page that recovers this one to the bytes that page has, however its
  // sources happen to be numbered there (review, 2026-09-26).
  var rawWas = await digest(App.decoded.get("t93_hull_c").raw);
  await replaceWith(hull, new File([tga(10, 200, 30, 255)], "t93_hull_c.tga"));
  var dHull = App.decoded.get("t93_hull_c");
  out.replaced = { name: dHull.rawName, digest: await digest(dHull.raw) };
  out.replaced.changed = out.replaced.digest !== rawWas;

  // ---- copy 3: the first one is evicted — "keep the last two copies" ----
  addLayerTo(wing, LayerNode.of({ type: "fill", name: "t93 third", color: "#654321", opacity: 1, blend: "normal", visible: true }));
  var w3 = await Autosave.write("test");
  var ix3 = await index();
  out.third = { ok: w3.ok, copies: ix3.copies.length, firstGone: !(await idbRaw(ix1.copies[0].key)),
    secondKept: !!(await idbRaw(ix2.copies[0].key)), srcRecords: Object.keys(ix3.assets).length,
    ownSources: ix3.copies[0].assets !== ix3.copies[1].assets };

  // ---- a copy the document moved under is thrown away, not stored ----
  var p = Autosave.write("test");
  pushAction("t93 mid-copy", function(){}, function(){});
  var torn = await p;
  doUndo();
  var ix4 = await index();
  out.torn = { why: torn.why, copies: ix4.copies.length, newestSame: ix4.copies[0].key === ix3.copies[0].key, backToCopied: Autosave.rev === Autosave.copiedRev };
  // ---- and a pointer going down stops a background one ----
  var p2 = Autosave.write("idle");
  window.dispatchEvent(new PointerEvent("pointerdown"));
  var intr = await p2;
  window.dispatchEvent(new PointerEvent("pointerup"));
  out.interrupt = { why: intr.why, released: !Recovery.held, copies: (await index()).copies.length };

  out.expect = await describe();
  var newest = ix4.copies[0];
  out.newest = { key: newest.key, at: newest.at, session: newest.session, total: newest.bytes + newest.assetBytes, layers: newest.layers, slots: newest.slots };
  out.leaving = { dirty: Autosave.dirty(), asks: asks() };
  return out;
}`;

const PHASE_C = (A) => `async function(){
  ${HELPERS}
  var out = window.__t93out = {}, EXPECT = ${JSON.stringify(A.expect)}, NEWEST = ${JSON.stringify(A.newest)}, REPLACED = ${JSON.stringify(A.replaced.digest)};
  await until(function(){ return Recovery.offered.length; }, 15000, "the offer on the welcome card");
  var box = document.getElementById("welcomeRecover"), btn = box.querySelector("button.wopt");
  out.offer = { shown: box.style.display !== "none" && getComputedStyle(document.getElementById("welcome")).display !== "none",
    n: Recovery.offered.length, head: btn.firstChild.textContent, detail: btn.querySelector("small").textContent,
    clock: Recovery.clock(NEWEST.at), mb: Recovery.size(NEWEST.total), session: Recovery.offered[0].session === NEWEST.session,
    notMine: Recovery.offered[0].session !== Autosave.session, dirty: Autosave.dirty(), copies: Recovery.offered[0].copies.length };

  // ---- "Save it as a file…": the same .wtproj Save proj writes, and the session is then saved ----
  var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try {
    box.querySelector(".recoverActs button").click();
    await until(function(){ return blob; }, 20000, "the copy saved as a file");
  } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  var z = await JSZip.loadAsync(blob), pj = JSON.parse(await z.file("project.json").async("string"));
  await until(async function(){ var ix = await index(); return ix.copies.filter(function(c){ return c.session === NEWEST.session; }).every(function(c){ return c.saved; }); }, 10000, "the session marked saved");
  out.file = { version: pj.version, skin: pj.skinName, slots: pj.slots.length,
    objs: Object.keys(z.files).filter(function(f){ return f.slice(-4) === ".obj"; }).join(","),
    tgas: Object.keys(z.files).filter(function(f){ return f.slice(-4) === ".tga"; }).length, said: status() };

  // ---- Recover: the same nodes, through ProjNode ----
  btn.click();
  await until(function(){ return Autosave.session === NEWEST.session && App.slots.size >= 2 && !App.pendingProject; }, 30000, "the recovery");
  await sleep(400);
  var got = await describe();
  out.recovered = { same: got === EXPECT, got: got === EXPECT ? "" : got, dirty: Autosave.dirty(), asks: asks(),
    noCopyDue: Autosave.rev === Autosave.copiedRev, card: getComputedStyle(document.getElementById("welcome")).display,
    offers: Recovery.offered.length, said: status(), skin: $("skinName").value, dot: dot() };

  // ---- Save cleans the project and marks this session's copies saved ----
  addLayerTo(App.slots.get("t93_wing"), LayerNode.of({ type: "fill", name: "t93 after", color: "#0000ff", opacity: 1, blend: "normal", visible: true }));
  var w4 = await Autosave.write("test");
  // ---- that copy — the first this page takes — holds the sources the page has NOW ----
  // Read back the way Recover reads it. This page numbers its sources from 1 again, as page A did,
  // and carries on in A's session: matched to a record by those numbers alone, the copy pointed at
  // the one A's second copy made, with the hull's _c from BEFORE the replacement (review, 2026-09-26).
  out.sources = { ok: !!w4.ok };
  if (w4.ok) {
    var back = await Autosave.read(w4.entry), live = (await ProjectFile.parts()).assets, want = {}, got = {};
    for (var i = 0; i < live.length; i++) want[live[i][0]] = await digest(live[i][1]);
    for (var j = 0; j < back.assets.length; j++) got[back.assets[j][0]] = await digest(back.assets[j][1]);
    var paths = Object.keys(want).sort();
    out.sources = { ok: true, paths: paths.length, extra: Object.keys(got).length - paths.length,
      stale: paths.filter(function(p){ return want[p] !== got[p]; }).join(","), hullIsNew: want["assets/t93_hull_c.tga"] === REPLACED };
  }
  var before = (await index()).copies.filter(function(c){ return c.session === NEWEST.session; });
  URL.createObjectURL = function(b){ return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  await until(async function(){ var ix = await index(); return ix.copies.filter(function(c){ return c.session === NEWEST.session; }).every(function(c){ return c.saved; }); }, 10000, "Save marking the copies");
  out.saved = { copyOk: w4.ok, unsavedBefore: before.filter(function(c){ return !c.saved; }).length, kept: before.length,
    dirty: Autosave.dirty(), asks: asks(), dot: dot() };

  // ---- the file saved from the offer is the same project too ----
  clearProject();
  await loadProject(blob);
  await until(function(){ return App.slots.size >= 2 && !App.pendingProject && App.slots.get("t93_hull").layers.length; }, 30000, "the saved copy loading");
  await sleep(300);
  out.fileSame = (await describe()) === EXPECT;

  // ---- Discard deletes a session's records ----
  // Its first copy is also the moment the SAVED session above has nothing left to recover: the keep
  // rule clears a session whose newest copy is in a file.
  addLayerTo(App.slots.get("t93_hull"), LayerNode.of({ type: "fill", name: "t93 doomed", color: "#ff8800", opacity: 1, blend: "normal", visible: true }));
  var doomed = Autosave.session, wd = await Autosave.write("test");
  var dIx = await index(), dCopy = dIx.copies.find(function(c){ return c.session === doomed; });
  var dRec = await idbRaw(dCopy.key), dSrc = await idbRaw(dCopy.assets);
  Autosave.opened();
  await Recovery.check();
  var offered = Recovery.offered.map(function(o){ return o.session; });
  var drow = [...document.querySelectorAll("#welcomeRecover .recover")].find(function(r, i){ return Recovery.offered[i] && Recovery.offered[i].session === doomed; });
  drow.querySelectorAll(".recoverActs button")[1].click();
  var sure = await until(function(){ return [...document.querySelectorAll("button")].find(function(b){ return b.textContent === "Discard" && !b.closest("#welcomeRecover"); }); }, 5000, "the discard question");
  sure.click();
  await until(async function(){ return !(await index()).copies.some(function(c){ return c.session === doomed; }); }, 10000, "the discard");
  var aIx = await index();
  out.discard = { wrote: wd.ok, offered: offered.length === 1 && offered[0] === doomed, recordGone: !(await idbRaw(dCopy.key)),
    srcGone: !aIx.assets[dCopy.assets] && !(await idbRaw(dCopy.assets)), savedLeft: aIx.copies.filter(function(c){ return c.session === NEWEST.session; }).length,
    savedRecordGone: !(await idbRaw(NEWEST.key)),
    rowGone: !Recovery.offered.some(function(o){ return o.session === doomed; }), said: status() };

  // ---- a copy from a newer build meets the loader's version gate ----
  // The discarded copy, put back under a session of its own with its project version raised.
  var fut = Object.assign({}, dCopy, { key: "autosave.copy.t93future.1", assets: "autosave.assets.t93future.1", session: "t93future", at: Date.now(), saved: false });
  await Autosave.tx(function(st, idx){
    st.put({ v: 1, meta: Object.assign({}, dRec.meta, { version: 99 }), files: dRec.files }, fut.key);
    st.put(dSrc, fut.assets); idx.assets[fut.assets] = { session: "t93future", sig: "", bytes: dCopy.assetBytes };
    idx.copies.unshift(fut); return true;
  });
  await Recovery.check();
  var offerF = Recovery.offered.find(function(o){ return o.session === "t93future"; });
  clearProject();
  await Recovery.recover(offerF);
  out.newer = { offered: !!offerF, said: status(), notAdopted: Autosave.session !== "t93future", layers: App.slots.size ? [...App.slots.values()].reduce(function(n, s){ return n + s.layers.length; }, 0) : 0 };
  await Autosave.discard("t93future");

  // ---- an index from a newer build is neither read nor overwritten ----
  var raw = await idbRaw("autosave.index");
  var putRaw = function(v){ return idb().then(function(db){ return new Promise(function(res){ var t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, "autosave.index"); t.oncomplete = function(){ db.close(); res(); }; }); }); };
  await putRaw(Object.assign({}, raw, { v: 2 }));
  var off = await Autosave.offers();
  if (!App.slots.size) { await loadProject(blob); await until(function(){ return App.slots.size && !App.pendingProject; }, 30000, "a project to copy"); }
  var wf = await Autosave.write("test");
  var still = await idbRaw("autosave.index");
  out.foreign = { flagged: !!off.foreign, none: off.list.length === 0, write: wf.why, untouched: still.v === 2 && still.copies.length === raw.copies.length, said: status() };
  await putRaw(raw); Autosave.foreign = false;

  // leave it clean, so the next load must NOT ask
  clearProject();
  out.leaving = { dirty: Autosave.dirty(), asks: asks() };
  return out;
}`;

const PHASE_D = `async function(){
  ${HELPERS}
  await sleep(500);
  var off = await Autosave.offers();
  var out = { offers: off.list.length, shown: Recovery.offered.length, box: document.getElementById("welcomeRecover").style.display };

  // ---- a remembered install reopening behind a card held up for an offer (ui/welcome.js) ----
  // Nothing is left to offer here, so a session is listed by hand, and the install is a stand-in
  // whose scan is counted rather than run. The card must stay up for the offer, and its way into the
  // game must not ask for the folder again: it opened a second picker and a second scan (review,
  // 2026-09-26).
  var held = { key: "autosave.copy.t93held.1", session: "t93held", at: Date.now(), bytes: 1024, assetBytes: 0, assets: null,
    vehicle: "t93", unit: "", skin: "", slots: 1, layers: 1, saved: false, version: 5, app: APP_VERSION };
  await Autosave.tx(function(st, idx){ idx.copies.unshift(held); return true; });
  await Recovery.check();
  var scans = 0, picks = 0, dir = { name: "War Thunder", queryPermission: async function(){ return "granted"; } };
  var realGet = idbGet, realIndex = indexGameFolder, realPick = window.showDirectoryPicker;
  window.idbGet = async function(k){ return k === "gameDir" ? dir : realGet(k); };
  window.indexGameFolder = async function(d){ scans++; App.gameDir = d; return 1; };     // what GameScan.reset sets first
  window.showDirectoryPicker = async function(){ picks++; throw new DOMException("the stand-in picker", "AbortError"); };
  try {
    var restored = await tryRestoreGameFolder(), wg = document.getElementById("btnWelcomeGame");
    var up = function(){ return getComputedStyle(document.getElementById("welcome")).display !== "none"; };
    out.held = { restored: restored, up: up(), heldCard: Recovery.heldCard, label: wg.firstChild.textContent.trim(), small: wg.querySelector("small").textContent };
    wg.click();
    await sleep(150);
    out.held.upAfter = up(); out.held.scans = scans; out.held.picks = picks;
    document.getElementById("btnWelcomeClose").click();
    out.held.empty = status();
  } finally { window.idbGet = realGet; window.indexGameFolder = realIndex; window.showDirectoryPicker = realPick; }
  await Autosave.discard("t93held");
  return out;
}`;

// Edits with no history step of their own, next to ones that have one — on a fresh page, each case
// starting from a save so "clean" has something exact to mean (review, 2026-09-26). Before the fix
// every case but (5) came back CLEAN with the change still applied: the page did not ask before it
// closed, and no copy was due. (7) was found while fixing the review's.
const PHASE_B = `async function(){
  ${HELPERS}
  var out = window.__t93out = {};
  await loadVehicle();
  var hull = App.slots.get("t93_hull"), wing = App.slots.get("t93_wing");
  var st = function(extra){ return Object.assign({ dirty: Autosave.dirty(), asks: asks(), dot: dot(), due: dueIfOld() }, extra || {}); };
  // Three sheets the size of an 8K surface set — over bakeAction's 512 MB guard, so the bake is
  // applied with no step. Never drawn into, so nothing that size is allocated: only the size is read.
  var big = function(){ var c = document.createElement("canvas"); c.width = 8192; c.height = 8192; return c; };
  var bigs = [big(), big(), big()];
  var bake = function(col){ bakeAction("t93 over-budget bake", bigs, function(){ var g = ctx2d(hull.smooth); g.fillStyle = col; g.fillRect(0, 0, 16, 16); }, function(){}); };
  hull.nEdited = true;

  // (1) saved, an edit, a bake with no step, the edit undone: the bake is still on the sheet
  await save();
  var smSaved = hashCanvas(hull.smooth);
  addLayerTo(wing, fill("t93 b1", "#123456"));
  var steps1 = App.undoStack.length;
  bake("#000000");
  var smBaked = hashCanvas(hull.smooth), noStep1 = App.undoStack.length === steps1;
  doUndo();
  out.bakeUndo = st({ noStep: noStep1, baked: smBaked !== smSaved, stays: hashCanvas(hull.smooth) === smBaked, layers: wing.layers.length });
  doRedo();
  out.bakeRedo = st();

  // (2) an edit, saved, a bake with no step, then undo and redo: redo lands on the bake, in no file
  addLayerTo(wing, fill("t93 b2", "#654321"));
  await save();
  bake("#ffffff");
  doUndo(); out.bake2Undo = st();
  doRedo(); out.bake2Redo = st();
  // ...and saved AFTER the bake: undo is unsaved, and redo back to it is exactly what was saved
  await save();
  doUndo(); out.after2Undo = st();
  doRedo(); out.after2Redo = st();

  // (3) a _n into a slot that has none: the adopt path, with no step
  await save();
  addLayerTo(hull, fill("t93 b3", "#abcdef"));
  var steps3 = App.undoStack.length;
  await replaceWith(wing, new File([tga(200, 60, 128, 255)], "t93_wing_n.tga"));
  var adopted = { surface: !!wing.smooth, nEdited: !!wing.nEdited, noStep: App.undoStack.length === steps3, said: status() };
  doUndo();
  out.adopt = st(adopted);

  // (4) Reset surface at its own size: the history is kept and the reset has no step
  await save();
  addLayerTo(wing, fill("t93 b4", "#fedcba"));
  App.activeSlot = hull;
  var size4 = hull.smooth.width, steps4 = App.undoStack.length;
  $("btnResetSurface").onclick();
  var reset = { sameSize: hull.smooth.width === size4, kept: App.undoStack.length === steps4, said: status() };
  doUndo();
  out.reset = st(reset);

  // (5) a replacement that DOES make a step, undone back to what was saved: clean. The change with
  // no step is only ever the one that made none — changed() re-stamps every step in the history,
  // the replacement's own included, so calling it after this one too would leave this unsaved.
  await save();
  var steps5 = App.undoStack.length;
  await replaceWith(hull, new File([tga(10, 200, 30, 255)], "t93_hull_c.tga"));
  var joined = { step: App.undoStack.length === steps5 + 1, dirtyAfter: Autosave.dirty() };
  doUndo();
  out.joined = st(joined);

  // (6) the region bake's own guard (bakeRegionAction): over it, the rectangle is applied with no
  // step either. Only the rectangle's size is read for the guard, so nothing that size is made.
  await save();
  addLayerTo(wing, fill("t93 b6", "#0f0f0f"));
  var steps6 = App.undoStack.length, sm6 = hashCanvas(hull.smooth);
  bakeRegionAction("t93 over-budget region", [hull.smooth, hull.metal, hull.normal], { x: 0, y: 0, w: 8192, h: 8192 },
    function(){ var g = ctx2d(hull.smooth); g.fillStyle = "#808080"; g.fillRect(4, 4, 8, 8); }, function(){});
  var region = { noStep: App.undoStack.length === steps6, baked: hashCanvas(hull.smooth) !== sm6 };
  doUndo();
  out.region = st(Object.assign(region, { stays: hashCanvas(hull.smooth) !== sm6 }));

  // (7) a stroke refused before it drew — a part selection with nothing on this sheet — takes back
  // the layer the tool had made for it. Left behind, that layer was an edit with no step: undoing
  // the one before it landed on "saved" with the stray layer still in the stack.
  await save();
  addLayerTo(wing, fill("t93 b7", "#f0f0f0"));
  var hullNodes = hull.layers.length, onWing = App.geomData.find(function(g){ return App.matSlot.get(g.mat) === wing.id; });
  App.selParts = new Set([onWing.name]);
  App.activeSlot = hull; App.activeLayer = null; App.brush.mode = "color";
  var began7 = beginStroke(false, false);
  endStroke();                                     // the pointer comes up on a stroke that never began
  App.selParts = new Set();
  var refused = { refused: began7 === false, noLayer: hull.layers.length === hullNodes, said: status(), dirtyAfter: Autosave.dirty() };
  doUndo();
  out.refused = st(Object.assign(refused, { stillNone: hull.layers.length === hullNodes }));
  return out;
}`;

// A jet-sized project on a fresh page: the copy must leave the UI thread alone. Four 2048² slots with
// three painted layers each, twelve 16 MB source textures (a 4096² BC7 sheet's mip 0) and a 24 MB
// model, 222 MB in all. The size is what makes the bar below able to fail. Measured 2026-09-25 at
// this size: the copy as built 31 ms, and the two regressions the bar exists for — the source Blobs
// made in one go (the model as ONE Blob, no yield between sources) 189 ms, the copy built as a STORE
// zip first 171 ms. At 134 MB the first of those read 88 ms: under the bar, so a smaller project
// here would pass the very thing it is meant to catch.
const PHASE_P = `async function(){
  ${HELPERS}
  var S = 2048, seed = 91;
  var rnd = function(){ seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  var painted = function(){
    var c = mkCanvas(S, S), g = ctx2d(c);
    for (var i = 0; i < 120; i++) { g.fillStyle = "rgba(" + (rnd() * 255 | 0) + "," + (rnd() * 255 | 0) + ",60,0.9)"; g.beginPath(); g.arc(rnd() * S, rnd() * S, 20 + rnd() * 150, 0, 7); g.fill(); }
    return c;
  };
  App.slots.clear(); App.decoded.clear();
  for (var k = 0; k < 4; k++) {
    var s = { id: "p92_" + k, size: S, nSize: S, layers: [], missing: false };
    s.baseC = mkCanvas(S, S); s.composite = mkCanvas(S, S);
    for (var j = 0; j < 3; j++) s.layers.push(LayerNode.of({ type: "paint", name: "p" + j, canvas: painted(), opacity: 1, blend: "normal", visible: true }));
    App.slots.set(s.id, s);
  }
  for (var t = 0; t < 12; t++) {
    var u = new Uint32Array(4 * 1048576);
    for (var q = 0; q < u.length; q++) u[q] = (rnd() * 4294967296) >>> 0;
    App.decoded.set("p92_tex" + t, { raw: u.buffer, rawName: "p92_tex" + t + ".dds", fileName: "p92_tex" + t + ".dds", width: 4096, height: 4096 });
  }
  var lines = []; for (var v = 0; v < 840000; v++) lines.push("v " + rnd().toFixed(6) + " " + rnd().toFixed(6) + " " + rnd().toFixed(6));
  App.objRaw = { name: "p92_0.obj", text: lines.join(String.fromCharCode(10)) }; App.objName = "p92"; lines = null;
  App.geomData = [];            // a body on screen, or Cockpit.fields leaves the model out of the file
  pushAction("p92", function(){}, function(){});
  // The garbage building this project made (840 000 strings) is collected now, not in the middle of
  // the copy: measured 2026-09-25 without this, the first copy read two 180 ms gaps that the Long
  // Tasks API did not see at all and that vanished with a collection beforehand — the setup's bill,
  // not the copy's. What the copy itself allocates is still collected inside the measurement.
  await sleep(300);
  if (window.gc) { gc(); await sleep(100); }
  // The instrument: a timer chain. The longest gap between two ticks is the longest the UI thread was
  // held — what a user sees as a frozen brush.
  var beat = function(){
    var st = { max: 0, last: performance.now(), on: true };
    var tick = function(){ var n = performance.now(); if (n - st.last > st.max) st.max = n - st.last; st.last = n; if (st.on) setTimeout(tick, 0); };
    setTimeout(tick, 0);
    return function(){ st.on = false; return Math.round(st.max); };
  };
  // The control: a 250 ms block the instrument must see, or its silence below proves nothing.
  var hb = beat(); await sleep(100); var t0 = performance.now(); while (performance.now() - t0 < 250) {} await sleep(100);
  var control = hb();
  // The copy from cold (no source Blob made yet). Once more from cold if the first was slow: other
  // test pages share this machine, and one unlucky collection is not the code's doing.
  var runs = [];
  for (var a = 0; a < 2; a++) {
    Autosave.bufs = new WeakMap(); Autosave.texts = new Map();
    if (a && window.gc) { gc(); await sleep(100); }
    var h2 = beat(); var r = await Autosave.write("test"); await sleep(60);
    runs.push({ gap: h2(), ok: r.ok, ms: r.ms, why: r.why || "", mb: r.entry ? Math.round((r.entry.bytes + r.entry.assetBytes) / 1048576) : 0 });
    if (runs[a].gap < 100) break;
  }
  return { control: control, runs: runs };
}`;

const r = await evalInPage({ browser, timeoutMs: 300000, keep: argv.includes("--keep"), drive: async ({ cdp, contextId, evaluate }) => {
  const dialogs = [];
  cdp.on((m, p) => {
    if (m !== "Page.javascriptDialogOpening") return;
    dialogs.push(p.type);
    cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => { /* the page is already going */ });
  });
  // Contexts created from here on, so the one a reload makes cannot be missed.
  const created = [];
  cdp.on((m, p) => { if (m === "Runtime.executionContextCreated" && p.context && p.context.auxData && p.context.auxData.isDefault) created.push(p.context.id); });
  const inCtx = async (id, expr) => {
    const e = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 240000, contextId: id });
    if (e.exceptionDetails) throw new Error("the page threw: " + (e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text));
    return e.result.value;
  };
  const reload = async (from) => {
    // A user gesture first: without one the browser skips the leave-the-page question altogether.
    await cdp.send("Runtime.evaluate", { expression: "1", userGesture: true, contextId: from });
    const seen = created.length;
    await cdp.send("Page.reload", {});
    const until = Date.now() + 30000;
    for (;;) {
      for (const id of created.slice(seen).reverse()) {
        const h = await cdp.send("Runtime.evaluate", { expression: "location.href", returnByValue: true, contextId: id }).catch(() => null);
        if (h && h.result && /\/page\.html$/.test(h.result.value || "")) return id;
      }
      if (Date.now() > until) throw new Error("the reloaded page never came back");
      await new Promise(res => setTimeout(res, 100));
    }
  };
  const A = await evaluate(pageExpr(PHASE_A, 400), 240000);
  if (!A || A.__threw) { A.partial = await evaluate("JSON.stringify(window.__t93out)"); return { A }; }
  const askedA = dialogs.length;
  const c2 = await reload(contextId);
  const C = await inCtx(c2, pageExpr(PHASE_C(A), 600));
  const askedC = dialogs.slice();
  if (!C || C.__threw) { C.partial = await inCtx(c2, "JSON.stringify(window.__t93out)"); return { A, C, askedA, askedC }; }
  const c3 = await reload(c2);
  const D = await inCtx(c3, pageExpr(PHASE_D, 400));
  return { A, C, D, askedA, askedC, askedD: dialogs.slice() };
}});
if (!r.ok) { console.log("FAILED to drive the page: " + String(r.reason).slice(0, 600)); process.exit(1); }
const { A, C, D, askedC, askedD } = r.result;
for (const [name, ph] of [["A", A], ["C", C], ["D", D]]) {
  if (ph && ph.__threw) { console.log("phase " + name + " threw in page:\n" + ph.__threw + "\n  so far: " + String(ph.partial).slice(0, 3000)); process.exit(1); }
  if (ph && ph.__errs && ph.__errs.length) console.log("phase " + name + " page errors: " + ph.__errs.join(" | "));
}

console.log("=== the dirty signal comes from the undo stack ===");
R.is(A.fresh.slots === "t93_hull,t93_wing", `the vehicle came in through addFiles: ${A.fresh.slots}`);
R.is(!A.fresh.dirty && !A.fresh.asks && !A.fresh.dot && A.fresh.title === "WT Skin Studio",
  `a vehicle just loaded is clean — the browser is not asked to question leaving, no dot, title "${A.fresh.title}"`);
R.is(A.edited.began && A.edited.dirty && A.edited.asks && A.edited.dot && A.edited.title.startsWith("•"),
  `after ${A.edited.steps} steps (five layers, a group, a real stroke, a bake) it is unsaved: the page asks before it closes, Save proj carries the dot, the title "${A.edited.title}"`);
R.is(!A.undone.dirty && A.undone.atStart && !A.undone.asks && A.undone.layers === 0,
  "undo all the way back is CLEAN again — the revision names the state, not the number of edits");
R.is(A.redone.dirty && A.redone.asks && A.redone.layers === A.edited.layers, `and redo is unsaved again (${A.redone.layers} nodes back)`);
R.is(A.lone.began && A.lone.steps === 1 && A.lone.dirtyAfter && !A.lone.dirty && !A.lone.asks && !A.lone.dot && !A.lone.due && A.lone.layers === 0,
  "one stroke on a vehicle just loaded — one step, holding the layer it had to make — then Ctrl+Z: clean again, nothing to ask, no copy due");

console.log("\n=== which copies are kept (the rule as a pure function) ===");
const K = A.retain;
R.is(K.lastTwo === "a3,a2 | drop a1 | src ", `a session keeps its last two copies: ${K.lastTwo}`);
R.is(K.savedGoes === "a1,c1 | drop b1,b2 | src ", `another session whose newest copy was saved goes, an unsaved one stays: ${K.savedGoes}`);
R.is(K.threeSessions === "a1,b1,c1 | drop d1,e1 | src ", `at most three sessions — this one and the two newest others: ${K.threeSessions}`);
R.is(K.bound900 === "a2,a1,b2 | drop b1 | src sa,sb", `over the byte bound, the other session's older copy goes first: ${K.bound900}`);
R.is(K.bound700 === "a2 | drop a1,b1,b2,sb | src sa", `then this session's older copy, then other sessions whole, with their sources: ${K.bound700}`);
R.is(K.oneBeatsNone === "a2 | drop a1,b1,b2,sb | src sa", `a newest copy bigger than the bound is kept alone — one copy beats none: ${K.oneBeatsNone}`);
R.is(K.orphan === "a1 | drop sx | src sa", `sources no kept copy points at are dropped: ${K.orphan}`);
R.is(K.otherTab === "b2,b1 | drop  | src ", `another session's copies are not this one's to thin out below two: ${K.otherTab}`);

console.log("\n=== when a copy is taken ===");
R.is(A.idle.reason === "idle" && A.idle.copies === 1 && A.idle.mine && A.idle.copied,
  "once the unsaved work is old enough, the next quiet moment takes a copy of this session");
R.is(A.idle.stillDirty, "a copy is not a save: the page still asks before it closes");
R.is(A.idle.persistAsked, "the browser is asked once to keep the copy from eviction (navigator.storage.persist)");
// A pre-release tag is part of a version since the line restarted at 1.0.0-beta.1 (ROADMAP 5.5(5)).
R.is(A.idle.entry === "t93|t93_skin|2|" + A.edited.layers + "|5|" + A.idle.entry.split("|")[5] &&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(A.idle.entry.split("|")[5]),
  `the index says what the welcome card needs: vehicle, skin, slots, layers, project version, build — ${A.idle.entry}`);
R.is(/recovery copy was kept at/.test(A.idle.dotTitle), `Save proj's tooltip says when: "${A.idle.dotTitle}"`);
R.is(A.hidden.copies === 2 && A.hidden.shared && A.hidden.srcRecords === 1,
  "hiding the tab takes a copy at once, and both copies point at ONE stored record of the model and textures");
R.is(A.replaced.name === "t93_hull_c.tga" && A.replaced.changed, `the hull's _c is replaced between two copies by a file of the same name (${A.replaced.name}), with other bytes`);
R.is(A.third.ok && A.third.copies === 2 && A.third.firstGone && A.third.secondKept && A.third.srcRecords === 2 && A.third.ownSources,
  "the third copy evicts the first from IndexedDB itself, not only from the index — the last two are kept — and, its _c new, points at a sources record of its own");
R.is(A.torn.why === "changed" && A.torn.copies === 2 && A.torn.newestSame && A.torn.backToCopied,
  `a copy the document moved under is thrown away (${A.torn.why}), not stored as a state the user never had`);
R.is(A.interrupt.why === "changed" && A.interrupt.released && A.interrupt.copies === 2,
  "a pointer going down stops a background copy — whatever it starts may change a sheet before it changes the history");
R.is(A.leaving.dirty && A.leaving.asks, "leaving with work in no file");
R.is(r.result.askedA === 0 && askedC.includes("beforeunload"), `the reload is questioned by the browser itself (dialogs: ${askedC.join(",") || "none"})`);

console.log("\n=== the offer on the welcome card ===");
const O = C.offer;
R.is(O.shown && O.n === 1 && O.session && O.notMine && !O.dirty, "the reloaded page offers the previous session — not its own, and it starts clean");
R.is(O.head === "Recover the session from " + O.clock, `it says when: "${O.head}"`);
R.is(O.detail.includes("t93") && O.detail.includes("t93_skin") && O.detail.includes(O.mb) && O.detail.includes(A.newest.layers + " layers") && O.detail.includes("2 textures"),
  `and which vehicle and how big: "${O.detail}"`);
R.is(O.copies === 2, "with both copies behind it, so an unreadable newest one has an older one to fall back on");
R.is(C.file.version === 5 && C.file.skin === "t93_skin" && C.file.objs === "assets/t93_0.obj" && C.file.tgas === 3 && C.file.slots === 2,
  `"Save it as a file…" writes the .wtproj Save proj would: version ${C.file.version}, ${C.file.objs}, ${C.file.tgas} textures, ${C.file.slots} slots`);

console.log("\n=== recovered: the same nodes through ProjNode ===");
const V = C.recovered;
R.is(V.same, "every node of every slot comes back exactly as ProjNode wrote it — each image the same pixels — and the composites and surface sheets match");
R.is(C.sources.ok && C.sources.paths === 4 && C.sources.extra === 0 && C.sources.stale === "" && C.sources.hullIsNew,
  `the first copy the recovered page takes holds the sources it has now — the replaced _c, not the one before it (stale: ${C.sources.stale || "none"})`);
if (!V.same) console.log("   got: " + V.got.slice(0, 1200) + "\n   want: " + A.expect.slice(0, 1200));
R.is(V.dirty && V.asks && V.dot && V.noCopyDue, "recovered work is in no file, so it stays unsaved — but it IS the copy, so no new copy is due");
R.is(V.card === "none" && V.offers === 0 && V.skin === "t93_skin", "the card and the offer are gone, and the skin name came back");
R.is(/^Recovered the session from .*Save proj \(Ctrl\+S\) keeps it/.test(V.said), `it says what to do next: "${V.said}"`);
R.is(C.saved.copyOk && C.saved.unsavedBefore === 1 && C.saved.kept === 2 && !C.saved.dirty && !C.saved.asks && !C.saved.dot,
  "Save cleans the project and marks this session's copies saved — the recovered session carries on in the copy's own session");
R.is(C.fileSame, "the file saved from the offer loads to the same nodes as well");

console.log("\n=== discard, and the version gates ===");
R.is(C.discard.savedLeft === 0 && C.discard.savedRecordGone,
  "a session saved to a file is never offered, and the next copy of any other session clears its records out");
R.is(C.discard.wrote && C.discard.offered && C.discard.recordGone && C.discard.srcGone && C.discard.rowGone,
  `Discard asks, then deletes that session's copy and its sources from IndexedDB: "${C.discard.said}"`);
R.is(C.newer.offered && /newer build of the app/.test(C.newer.said) && C.newer.notAdopted && C.newer.layers === 0,
  `a copy written by a newer build meets the loader's own version gate: "${C.newer.said.slice(0, 110)}…"`);
R.is(C.foreign.flagged && C.foreign.none && C.foreign.write === "failed" && C.foreign.untouched,
  `an index from a newer build is neither offered from nor overwritten: "${C.foreign.said.slice(0, 120)}…"`);
R.is(!C.leaving.dirty && !C.leaving.asks, "a cleared project is clean");
R.is(askedD.length === askedC.length, `and a clean page is not questioned on reload (dialogs: ${askedD.join(",")})`);
R.is(D.offers === 0 && D.shown === 0 && D.box === "none", "nothing saved or discarded is offered back");
const H = D.held;
R.is(H.restored && H.up && H.heldCard && H.label === "Go to the vehicle list" && /no need to pick it again/.test(H.small),
  `a remembered install reopening behind a card held for an offer: the card stays up, and its way in reads "${H.label}"`);
R.is(!H.upAfter && H.picks === 0 && H.scans === 1,
  `which goes to the list — no second folder picker, no second scan (pickers ${H.picks}, scans ${H.scans})`);
R.is(!/open the game folder any time/.test(H.empty), `and "Start empty" does not say the folder is still to be opened: "${H.empty}"`);

// ---- B: edits with no step of their own ----
const Bp = await evalInPage({ browser, expr: pageExpr(PHASE_B, 400), timeoutMs: 120000 });
if (!Bp.ok) { console.log("FAILED to evaluate the no-step page: " + String(Bp.reason).slice(0, 400)); process.exit(1); }
if (Bp.result.__threw) { console.log("the no-step page threw:\n" + Bp.result.__threw); process.exit(1); }
const B = Bp.result;
if (B.__errs && B.__errs.length) console.log("phase B page errors: " + B.__errs.join(" | "));
console.log("\n=== edits with no step of their own, next to ones with one ===");
R.is(B.bakeUndo.noStep && B.bakeUndo.baked && B.bakeUndo.stays && B.bakeUndo.layers === 0 && B.bakeUndo.dirty && B.bakeUndo.asks && B.bakeUndo.dot && B.bakeUndo.due,
  "saved, an edit, a bake too big to keep a step for, the edit undone: the bake is still on the sheet, so it is unsaved — the page asks, the dot shows, a copy is due");
R.is(B.bakeRedo.dirty && B.bakeRedo.asks && B.bakeRedo.due, "and redoing the edit is not the saved state either");
R.is(B.bake2Undo.dirty && B.bake2Redo.dirty && B.bake2Redo.asks && B.bake2Redo.due,
  "an edit, saved, then a bake with no step: undo and redo both stay unsaved — redo lands on the bake, which no file holds");
R.is(B.after2Undo.dirty && !B.after2Redo.dirty && !B.after2Redo.asks && !B.after2Redo.due,
  "saved after the bake: undoing is unsaved, and redoing back to it is exactly what was saved — clean");
R.is(B.adopt.surface && B.adopt.nEdited && B.adopt.noStep && B.adopt.dirty && B.adopt.asks && B.adopt.due,
  `a _n loaded into a slot that had none takes no step, and undoing the edit before it stays unsaved ("${B.adopt.said}")`);
R.is(B.reset.sameSize && B.reset.kept && B.reset.dirty && B.reset.asks && B.reset.due,
  `Reset surface at its own size keeps the history with no step of its own, and undoing the edit before it stays unsaved ("${B.reset.said.slice(0, 60)}…")`);
R.is(B.joined.step && B.joined.dirtyAfter && !B.joined.dirty && !B.joined.asks && !B.joined.due,
  "a replacement at the same size is one step, and undoing it back to what was saved is clean — only a change that made no step is treated as one");
R.is(B.region.noStep && B.region.baked && B.region.stays && B.region.dirty && B.region.asks && B.region.due,
  "a region bake over its own guard (bakeRegionAction) takes no step either, and undoing the edit before it stays unsaved");
R.is(B.refused.refused && /nothing paintable/.test(B.refused.said) && B.refused.noLayer && B.refused.dirtyAfter && B.refused.stillNone && !B.refused.dirty && !B.refused.asks && !B.refused.due,
  `a stroke refused before it drew takes back the layer made for it ("${B.refused.said.slice(0, 60)}…"), so undoing the edit before it is the saved state, clean`);

// ---- P: the UI thread ----
const P = await evalInPage({ browser, expr: pageExpr(PHASE_P, 400), timeoutMs: 240000, chromeArgs: ["--js-flags=--expose-gc"] });
if (!P.ok) { console.log("FAILED to evaluate the timing page: " + String(P.reason).slice(0, 400)); process.exit(1); }
if (P.result.__threw) { console.log("the timing page threw:\n" + P.result.__threw); process.exit(1); }
const T = P.result, last = T.runs[T.runs.length - 1];
console.log("\n=== the copy leaves the UI thread alone (CLAUDE.md §3) ===");
console.log(`   control: a 250 ms block reads as ${T.control} ms · the copy: ${T.runs.map(x => x.gap + " ms longest gap over " + x.ms + " ms, " + x.mb + " MB").join(" · then ")}`);
R.is(T.control >= 240, `the instrument sees a deliberate block (${T.control} ms) — its silence below is evidence`);
R.is(T.runs.every(x => x.ok), "the heavy project's copy was stored");
R.is(last.gap < 100, `a ${last.mb} MB copy never holds the UI thread for 100 ms (longest ${last.gap} ms)`);

R.finish();
