// Layer groups composite as a group and not as an indent (ROADMAP 4.9, slice 1).
//
// WHY THIS EXISTS, and why it is the only thing exercising groups right now. Nothing in the UI can
// create one yet — that is slice 2 — so the container, the tree walkers and the recursive composite
// have no other user. Without this test the whole of slice 1 would be unexecuted code that happens
// to parse, and the first thing to touch it would be the feature built on top of it.
//
// The properties asserted are the ones that make a group a GROUP:
//
//   * **A pass-through group changes nothing.** Opacity 1, blend normal, no mask: the same layers
//     inside a group must give byte-for-byte the same sheet as the same layers loose. This is the
//     regression gate for every existing project — the tree is what `slot.layers` is now, and a
//     flat list is just a tree with no groups in it.
//   * **The group's opacity applies to the FLATTENED children, not to each one.** Two overlapping
//     opaque children at group opacity 0.5 must show the top child at half strength over the base,
//     NOT the two of them half-blended into each other. That difference is the entire reason the
//     scratch canvas exists, and blitting children straight onto the target gets it wrong in
//     exactly the overlap.
//   * **A hidden group hides its children**, however visible the children are. `visibleLeaves`
//     prunes at the group; a flat array had no way to be wrong about this and a tree does.
//   * **A group's mask multiplies its children's**, rather than replacing them.
//   * **Groups are not channel-tagged.** One group holding a colour child and a smoothness child —
//     the case the owner actually asked for, a decal whose maps move together — must land each in
//     its own sheet.
//   * **And the dirty-rectangle path still agrees with the whole-sheet one**, through a group. This
//     is t52's property (region == whole, restricted to the region) re-run over the recursion,
//     because a group's scratch is region-sized and an origin mistake there shows up as a decal
//     stamped at the wrong offset inside the group only.
//
// Slice 2 adds the half a user can reach: the active layer is a NODE rather than an index (an
// index cannot address a layer inside a group, and was already losing the selection whenever
// anything below it was removed), group / ungroup and their undo, dragging into and out of a
// group, deleting a group with its children, and solo reaching inside one.
//
// Case 20 reads a STORED version 5 project, tools/fixtures/project-v5.wtproj, which is never
// regenerated. `--capture-v5` writes it, and refuses to while it exists — a stored file that can be
// re-captured whenever it disagrees with the reader is a round trip with extra steps.
//
// Usage: node tools/t57_groups.mjs [--keep] [--chrome <path>] [--capture-v5]
import fs from "node:fs";
import path from "node:path";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const FIXTURE_V5 = path.join(ROOT, "tools", "fixtures", "project-v5.wtproj");
const CAPTURE_V5 = argv.includes("--capture-v5");
const FIXTURE_V5_B64 = fs.existsSync(FIXTURE_V5) ? fs.readFileSync(FIXTURE_V5).toString("base64") : "";
if (CAPTURE_V5 && FIXTURE_V5_B64) {
  console.log(`refusing to capture: ${path.relative(ROOT, FIXTURE_V5)} exists, and a stored project is never rewritten — capture a new version's file beside it`);
  process.exit(1);
}

const BODY = `async function(){
  var out = {}, N = 64;
  var flat = function(hex){ var c = mkCanvas(N, N); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var mkSlot = function(){
    var s = { id: "g57", size: N, nSize: N, layers: [], missing: false };
    s.baseC = flat("#202020");
    s.composite = mkCanvas(N, N);
    s.smooth = flat("#000000"); s.metal = flat("#000000"); s.normal = flat("#808080");
    return s;
  };
  // Both factories hand their record to LayerNode.of, the way every construction site in the app
  // does since 4.28(b) — after (c) the composite is addressed through the container and a flat
  // record is not a layer at all. Case 18 is what proves that, so it builds its own by hand.
  var fill = function(hex, chan, opts){
    var L = { type: "fill", name: hex, color: hex, opacity: 1, blend: "normal", visible: true };
    if (chan) L.chan = chan;
    for (var k in (opts || {})) L[k] = opts[k];
    return LayerNode.of(L);
  };
  // Half-covering paint layers, so "flattened then faded" and "each faded" differ in the overlap.
  var bandC = function(hex, x0, w){
    var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = hex; g.fillRect(x0, 0, w, N);
    return c;
  };
  var band = function(hex, x0, w){
    return LayerNode.of({ type: "paint", name: hex, canvas: bandC(hex, x0, w), opacity: 1, blend: "normal", visible: true });
  };
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var sheet = function(c){ return [].slice.call(ctx2d(c).getImageData(0, 0, N, N).data).join(","); };

  // ---- 1. a pass-through group is invisible ----
  var a = mkSlot();
  a.layers = [band("#ff0000", 0, 40), band("#0000ff", 24, 40)];
  compositeSlot(a);
  var loose = sheet(a.composite);
  var b = mkSlot();
  b.layers = [{ type: "group", name: "G", visible: true, opacity: 1, blend: "normal",
                children: [band("#ff0000", 0, 40), band("#0000ff", 24, 40)] }];
  compositeSlot(b);
  out.passThrough = { same: sheet(b.composite) === loose, mid: px(b.composite, 32, 32) };

  // ---- 2. group opacity applies to the FLATTENED children ----
  var c1 = mkSlot();
  c1.layers = [{ type: "group", name: "G", visible: true, opacity: .5, blend: "normal",
                 children: [band("#ff0000", 0, 40), band("#0000ff", 24, 40)] }];
  compositeSlot(c1);
  // ...against the wrong implementation: each child drawn straight onto the target at .5
  var c2 = mkSlot();
  var k1 = band("#ff0000", 0, 40), k2 = band("#0000ff", 24, 40);
  k1.opacity = .5; k2.opacity = .5;
  c2.layers = [k1, k2];
  compositeSlot(c2);
  out.opacity = { group: px(c1.composite, 32, 32), perChild: px(c2.composite, 32, 32),
                  outsideOverlap: px(c1.composite, 8, 32) };

  // ---- 3. a hidden group hides visible children ----
  var d = mkSlot();
  d.layers = [{ type: "group", name: "G", visible: false, opacity: 1, blend: "normal",
                children: [fill("#00ff00")] }];
  compositeSlot(d);
  out.hidden = { px: px(d.composite, 32, 32),
                 leaves: layerLeaves(d.layers).length, visible: visibleLeaves(d.layers).length };

  // ---- 4. the group's mask multiplies the child's ----
  var maskL = mkCanvas(N, N), mg = ctx2d(maskL);
  mg.fillStyle = "#ffffff"; mg.fillRect(0, 0, 32, N);          // child shows in the left half
  var maskG = mkCanvas(N, N), gg = ctx2d(maskG);
  gg.fillStyle = "#ffffff"; gg.fillRect(0, 0, N, 32);          // group shows in the top half
  var e = mkSlot();
  e.layers = [{ type: "group", name: "G", visible: true, opacity: 1, blend: "normal", mask: maskG,
                children: [fill("#00ff00", null, { mask: maskL })] }];
  compositeSlot(e);
  out.masks = { both: px(e.composite, 16, 16), childOnly: px(e.composite, 16, 48),
                groupOnly: px(e.composite, 48, 16), neither: px(e.composite, 48, 48) };

  // ---- 5. one group, two channels ----
  var f = mkSlot();
  f.layers = [{ type: "group", name: "decal", visible: true, opacity: 1, blend: "normal",
                children: [fill("#00ff00"), fill("#c0c0c0", "smooth")] }];
  compositeSlot(f);
  Composite.sheet(f, "smooth", null);
  out.channels = { colour: px(f.composite, 32, 32),
                   smooth: f.chanC && f.chanC.smooth ? px(f.chanC.smooth, 32, 32) : null,
                   metal: f.chanC && f.chanC.metal ? "built" : "none" };

  // ---- 6. region == whole, through a group ----
  var h = mkSlot();
  h.layers = [band("#808000", 0, N),
              { type: "group", name: "G", visible: true, opacity: .6, blend: "normal", mask: maskG,
                children: [band("#ff0000", 0, 40), band("#0000ff", 24, 40)] }];
  compositeSlot(h);
  var whole = ctx2d(h.composite).getImageData(20, 10, 24, 30).data;
  // dirty the same rectangle again and let the region path redo it
  compositeSlot(h, { x: 20, y: 10, w: 24, h: 30 });
  var region = ctx2d(h.composite).getImageData(20, 10, 24, 30).data;
  var worst = 0, off = 0;
  for (var i = 0; i < whole.length; i++) { var dd = Math.abs(whole[i] - region[i]); if (dd) off++; if (dd > worst) worst = dd; }
  out.region = { worst: worst, off: off, of: whole.length };

  // ---- 7. the walkers themselves ----
  var deep = [fill("#111111"),
              { type: "group", name: "outer", visible: true, opacity: 1, blend: "normal",
                children: [fill("#222222"),
                           { type: "group", name: "inner", visible: true, opacity: 1, blend: "normal",
                             children: [fill("#333333")] }] }];
  var innerG = deep[1].children[1], innerL = innerG.children[0];
  var own = nodeOwner(deep, innerL);
  out.walk = { leaves: layerLeaves(deep).map(function(x){ return x.name; }),
               nodes: layerNodes(deep).map(function(x){ return x.name; }),
               ownerIs: own && own.list === innerG.children && own.i === 0,
               depth: nodeDepth(deep, innerL),
               containsDown: nodeContains(deep[1], innerL),
               containsUp: nodeContains(innerG, deep[1]) };

  // ---- 8. the active layer is a NODE, and survives edits below it ----
  // The bug this replaces, measured 2026-08-26 before the change: App.activeLayer was an integer
  // index into the top level, so removing any layer BELOW the selected one moved the selection to
  // its neighbour without a word. Select "c" of a,b,c,d and delete "a" and you were on "d".
  var sel = mkSlot();
  var mkn = function(n){ return fill("#404040", null, { name: n }); };
  sel.layers = [mkn("a"), mkn("b"), mkn("c"), mkn("d")];
  App.slots.set("g57", sel); App.activeSlot = sel;
  App.activeLayer = sel.layers[2];                       // "c"
  out.sel = { before: activeLayerObj().name };
  sel.layers.splice(0, 1);                               // remove "a", below the selection
  out.sel.afterRemovingBelow = activeLayerObj() ? activeLayerObj().name : "(deselected)";
  // ...and a node that is no longer in the slot is no selection at all, rather than a stale object
  var gone = sel.layers[0];
  sel.layers.splice(0, 1);
  App.activeLayer = gone;
  out.sel.deletedNode = activeLayerObj() ? activeLayerObj().name : "(deselected)";

  // ---- 9. group / ungroup, and their undo ----
  var g = mkSlot();
  g.layers = [mkn("p"), mkn("q"), mkn("r")];
  App.slots.set("g57", g); App.activeSlot = g;
  var q = g.layers[1];
  var names = function(nodes){ return nodes.map(function(n){ return isGroup(n) ? n.name + "[" + names(n.children).join(" ") + "]" : n.name; }); };
  App.undoStack.length = 0; App.redoStack.length = 0;
  groupNodes(g, [q]);
  out.group = { after: names(g.layers).join(" "), active: activeLayerObj() ? activeLayerObj().name : null,
                isGroup: isGroup(g.layers[1]) };
  doUndo();
  out.group.undone = names(g.layers).join(" ");
  doRedo();
  out.group.redone = names(g.layers).join(" ");
  // ungroup puts them back where the group was
  var G = g.layers[1];
  ungroupNode(g, G);
  out.group.ungrouped = names(g.layers).join(" ");
  doUndo();
  out.group.ungroupUndone = names(g.layers).join(" ");

  // ---- 10. a group cannot be dropped inside itself ----
  var n1 = mkn("x"), inner = { type: "group", name: "IN", visible: true, opacity: 1, blend: "normal", children: [n1] };
  var outer = { type: "group", name: "OUT", visible: true, opacity: 1, blend: "normal", children: [inner] };
  var d10 = mkSlot();
  d10.layers = [outer, mkn("z")];
  App.slots.set("g57", d10); App.activeSlot = d10;
  reorderLayer(d10, outer, inner, null);                 // OUT into its own grandchild's parent
  out.cycle = { still: names(d10.layers).join(" "), outerStillTop: d10.layers[0] === outer };

  // ---- 11. reorder into and out of a group ----
  var r11 = mkSlot();
  var g11 = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [mkn("in1")] };
  r11.layers = [mkn("bot"), g11, mkn("top")];
  App.slots.set("g57", r11); App.activeSlot = r11;
  App.undoStack.length = 0;
  reorderLayer(r11, r11.layers[0], g11, null);           // "bot" into the group
  out.move = { intoGroup: names(r11.layers).join(" ") };
  doUndo();
  out.move.undone = names(r11.layers).join(" ");
  doRedo();
  reorderLayer(r11, g11.children[g11.children.length - 1], null, null);   // and back out, to the top
  out.move.outAgain = names(r11.layers).join(" ");

  // ---- 11b. the two drops the LIST could not express (ROADMAP 4.16(b)), through its own handlers ----
  // Every drop on a row meant "above that row", so the bottom of a list was unreachable and under
  // an open group at the bottom every drop landed inside it; and a drop INTO an ordinary layer did
  // nothing. Driven with synthetic DragEvents carrying the list's own payload, so what is asserted
  // is the handler, not a re-statement of reorderLayer.
  var rb = mkSlot();
  var gb = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [mkn("in1")], collapsed: false };
  rb.layers = [gb, mkn("mid"), mkn("top")];                 // the group is the BOTTOM of the stack
  App.slots.set("g57", rb); App.activeSlot = rb; App.activeLayer = null;
  App.undoStack.length = 0;
  refreshLayerList();
  var listEl = document.getElementById("layerList");
  var rowNamed = function(nm){ return [].filter.call(listEl.querySelectorAll(".layer"), function(r){ return r.querySelector(".nm").textContent === nm; })[0]; };
  var payload = function(row){ var d = new DataTransfer(); d.setData("application/x-wtss-layer", row.dataset.row); return d; };
  var dropOn = function(target, src, atMiddle){
    var ev = new DragEvent("drop", { bubbles: true, dataTransfer: payload(src) });
    if (atMiddle != null) Object.defineProperty(ev, "offsetY", { value: atMiddle ? (target.clientHeight || 22) / 2 : 1 });
    target.dispatchEvent(ev);
  };
  var strips = function(){ return [].slice.call(listEl.querySelectorAll(".ldrop")); };
  out.drop = { strips: strips().length, stripDepths: strips().map(function(t){ return t.dataset.depth; }).join("") };
  // "top" onto the slot's own strip (the last one in the DOM): below the group, at index 0
  dropOn(strips()[strips().length - 1], rowNamed("top"));
  out.drop.belowGroup = names(rb.layers).join(" ");
  // "mid" onto the GROUP's strip (the indented one): at the bottom of the group's children
  refreshLayerList();
  dropOn(strips()[0], rowNamed("mid"));
  out.drop.bottomOfGroup = names(rb.layers).join(" ");
  // undo both
  doUndo(); doUndo();
  out.drop.undone = names(rb.layers).join(" ");
  // "top" dropped INTO "mid" (an ordinary layer, middle third): a new group of the two, "top" on top
  refreshLayerList();
  dropOn(rowNamed("mid"), rowNamed("top"), true);
  out.drop.grouped = names(rb.layers).join(" ");
  doUndo();
  out.drop.groupUndone = names(rb.layers).join(" ");
  // and a drop at a row's EDGE is the old "above" reorder, not a group: "mid" above "top"
  refreshLayerList();
  dropOn(rowNamed("top"), rowNamed("mid"), false);
  out.drop.edge = names(rb.layers).join(" ");
  doUndo();
  // a group row shows what it composites to (4.16(a)): its thumbnail is a canvas, like a leaf's
  refreshLayerList();
  var grow = rowNamed("G");
  out.drop.groupThumb = !!(grow && grow.querySelector("canvas"));
  out.drop.groupMark = !!(grow && grow.querySelector("svg.fold"));
  out.drop.childGuide = !!(rowNamed("in1") && rowNamed("in1").querySelector(".lguide"));

  // ---- 11c. a layer, a group or a decal as its own image (ROADMAP 4.21) ----
  // Two named forms. "Own pixels" is the canvas as made; "on the sheet" is the same thing placed
  // through opacity, mask and blend, exactly as the compositor places it. The probe is colour and
  // size, and the download is intercepted at the anchor so the NAMES are read rather than trusted.
  var rx = mkSlot();
  var half = band("#ff0000", 0, N); half.name = "Half"; half.opacity = 0.5;   // red paint, at half strength
  var solid = band("#0000ff", 0, N); solid.name = "Solid";                     // blue paint, full strength
  var gx = { type: "group", name: "Pair", visible: true, opacity: 0.5, blend: "normal", children: [solid], collapsed: false };
  var fillL = LayerNode.of({ type: "fill", name: "Wash", color: "#00ff00", opacity: 1, blend: "normal", visible: true });
  var fx = LayerNode.of({ type: "adjust", name: "Warm", hue: 0, sat: 100, bright: 100, contrast: 100, opacity: 1, blend: "normal", visible: true });
  var bmp = mkCanvas(4, 4); ctx2d(bmp).fillStyle = "#ffff00"; ctx2d(bmp).fillRect(0, 0, 4, 4);   // a 4 px yellow decal source
  var dec = LayerNode.of({ type: "decal", name: "Badge", bmp: bmp, x: 0.5, y: 0.5, scale: 0.5, rot: 0, opacity: 1, blend: "normal", visible: true });
  rx.layers = [half, gx, fillL, fx, dec];
  App.slots.set("g57", rx); App.activeSlot = rx;
  var px4 = function(cv, x, y){ var d = ctx2d(cv).getImageData(x == null ? 1 : x, y == null ? 1 : y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var o21 = { chan: { half: LayerExport.chanOf(half), group: LayerExport.chanOf(gx), effect: LayerExport.chanOf(fx) } };
  var ownH = LayerExport.own(rx, half, "color"), sheetH = LayerExport.sheet(rx, half, "color");
  o21.half = { own: px4(ownH), sheet: px4(sheetH), ownSize: ownH.width, sheetSize: sheetH.width };
  var ownG = LayerExport.own(rx, gx, "color"), sheetG = LayerExport.sheet(rx, gx, "color");
  o21.group = { own: px4(ownG), sheet: px4(sheetG) };
  o21.fillOwn = LayerExport.own(rx, fillL, "color");
  o21.fillSheet = px4(LayerExport.sheet(rx, fillL, "color"));
  var ownD = LayerExport.own(rx, dec, "color"), sheetD = LayerExport.sheet(rx, dec, "color");
  o21.decal = { ownSize: [ownD.width, ownD.height], own: px4(ownD, 0, 0), sheetSize: sheetD.width,
                centre: px4(sheetD, N / 2, N / 2), corner: px4(sheetD, 0, 0) };
  // the whole command, with the dialogs answered and the download caught at the anchor
  var dlgWas = window.choiceDialog, clickWas = HTMLAnchorElement.prototype.click, written = [], asked = [];
  window.choiceDialog = function(msg, choices){ asked.push(choices.map(function(c){ return c.value; }).join(",")); return Promise.resolve(window.__a21.shift()); };
  HTMLAnchorElement.prototype.click = function(){ written.push(this.download); };
  document.getElementById("skinName").value = "my skin";
  window.__a21 = ["sheet", "png"];   await LayerExport.run(rx, half);        // two forms differ → asked, then format
  window.__a21 = ["png"];            await LayerExport.run(rx, fillL);       // a fill has only the sheet form → format only
  window.__a21 = ["own", "tga"];     await LayerExport.run(rx, dec);
  await LayerExport.run(rx, fx);                                              // refused before any dialog
  o21.run = { written: written.slice(), asked: asked.slice(), status: document.getElementById("status").textContent };
  window.choiceDialog = dlgWas; HTMLAnchorElement.prototype.click = clickWas;
  document.getElementById("skinName").value = "";
  out.exp = o21;

  // ---- 12. deleting a group takes its children, and undo brings the subtree back ----
  var d12 = mkSlot();
  var g12 = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [mkn("k1"), mkn("k2")] };
  d12.layers = [mkn("under"), g12];
  App.slots.set("g57", d12); App.activeSlot = d12;
  App.undoStack.length = 0;
  deleteLayerAt(d12, g12);
  out.del = { after: names(d12.layers).join(" "), leaves: layerLeaves(d12.layers).length };
  doUndo();
  out.del.undone = names(d12.layers).join(" ");
  out.del.kidsBack = layerLeaves(d12.layers).length;

  // ---- 13. solo reaches into groups, and keeps the group itself visible ----
  var s13 = mkSlot();
  var g13 = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [mkn("i1"), mkn("i2")] };
  s13.layers = [mkn("out1"), g13];
  App.slots.set("g57", s13); App.activeSlot = s13;
  var target = g13.children[0];
  var all13 = layerNodes(s13.layers);
  var only = all13.filter(function(x){ return x !== target; }).every(function(x){ return !x.visible; }) && target.visible;
  all13.forEach(function(x, i){ x.visible = only ? true : x === target || (isGroup(x) && nodeContains(x, target)); });
  out.solo = { group: g13.visible, target: target.visible, sibling: g13.children[1].visible, outside: s13.layers[0].visible,
               showing: visibleLeaves(s13.layers).map(function(x){ return x.name; }).join(",") };


  // ---- 14. a group survives a .wtproj round trip, and the version gate refuses a newer file ----
  // Additive, per §0: version 4 stores the stack as a tree, a version 3 file is the same records
  // with no group among them, and the reader takes both without a branch. What is asserted is that
  // the group's OWN properties come back — a reader that silently flattened would still restore
  // every layer and lose only the container, which is the failure that looks like success.
  var savedSlots = App.slots, savedUnits = App.skinUnits;
  var pr = mkSlot();
  pr.id = "t57rt";
  var prG = { type: "group", name: "Roundels", visible: true, opacity: .42, blend: "multiply",
              collapsed: true, scope: Scope.make(["wing_l"], null), mask: flat("#ffffff"), children: [] };
  prG.children = [fill("#00ff00", null, { name: "colour" }),
                  fill("#909090", "smooth", { name: "gloss" }),
                  { type: "group", name: "Inner", visible: false, opacity: 1, blend: "normal",
                    children: [fill("#ff0000", null, { name: "deep" })] }];
  pr.layers = [fill("#111111", null, { name: "under" }), prG];
  App.slots = new Map([["t57rt", pr]]);
  App.skinUnits = savedUnits;
  App.activeSlot = pr; App.activeLayer = null;
  var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };     // capture instead of download
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  pr.layers = [];                                                        // wipe, so a pass means it was read back
  await loadProject(blob);
  var back = pr.layers[1];
  out.proj = {
    shape: names(pr.layers).join(" "),
    isGroup: isGroup(back),
    opacity: back && back.opacity, blend: back && back.blend,
    collapsed: !!(back && back.collapsed), parts: back && Scope.parts(back) ? Scope.parts(back).join(",") : null,
    hasMask: !!(back && back.mask),
    chan: back && back.children[1] ? layerChan(back.children[1]) : null,
    nested: back && isGroup(back.children[2]) ? back.children[2].children.length : -1,
    nestedHidden: back && back.children[2] ? back.children[2].visible === false : null,
  };
  // a file from a newer build is refused rather than half-applied
  App.pendingProject = { meta: { version: 99, slots: [] }, zip: null };
  document.getElementById("status").textContent = "";
  await tryApplyProject();
  out.gate = { said: document.getElementById("status").textContent, cleared: App.pendingProject === null };

  // ---- 15. every kind of leaf survives the round trip, and the SHEET is the oracle ----
  // 14 proves the CONTAINER comes back. What it cannot see is CONTENT: every leaf in it is a fill,
  // which is a colour string, so a reader that rebuilt the tree and dropped every pixel would pass
  // it unchanged. This carries one of each leaf kind — a paint layer with its own canvas, mask and
  // part scope, an adjustment, a channel-tagged layer, a derived surface layer, and a
  // decal with a placement — and compares the COMPOSITED SHEETS across the round trip, on the
  // albedo and on the smoothness channel.
  //
  // Why the sheet and not a field list: ROADMAP 4.28(b) migrates this format one way into a
  // channel-slot container, and a field list only catches what someone thought to compare. A sheet
  // catches everything that reaches a pixel, which is the whole of what a project is for. The
  // fields are asserted too, for the ones a sheet cannot see — a part scope with no model loaded
  // stencils nothing, and a surfKey is a link rather than a colour.
  var rt = mkSlot();
  rt.id = "t57rt2";
  // A function, because case 20 builds this same stack a second time: it is the oracle a STORED
  // version 5 file is read against, and a stack that exists once cannot be compared with itself.
  var richStack = function(){
    var sticker = mkCanvas(16, 16);
    (function(){ var g = ctx2d(sticker); g.fillStyle = "#ff00ff"; g.fillRect(0, 0, 16, 16);
                 g.fillStyle = "#00ffff"; g.fillRect(0, 0, 8, 8); })();
    // A mask stencils through ALPHA (the compositor applies it with destination-in), so it is white
    // where the layer shows and untouched — transparent — everywhere else. An opaque black half
    // would hide nothing, and the sheet comparison below would pass without the mask existing.
    var half = (function(){ var c = mkCanvas(N, N), g = ctx2d(c);
      g.fillStyle = "#ffffff"; g.fillRect(N / 2, 0, N / 2, N); return c; })();
    var brush = band("#ffa000", 8, 40);
    brush.name = "brushwork"; brush.opacity = .7; brush.blend = "multiply";   // Parts AND a rectangle: the recipe 4.28(g) made a scope into, so the round trip has to carry
    // both halves and not just the one every file before it stored.
    brush.mask = half; brush.scope = Scope.make(["wing_l"], { x: 8, y: 4, w: 24, h: 16 });
    var metalness = band("#3050ff", 4, 20);
    metalness.name = "metalness"; metalness.chan = "metal";
    // ---- the thing version 5 exists for (4.28(e)) ----
    // ONE layer carrying three channels at once: painted colour, a smoothness fill and a metalness
    // effect. There is no flat record that can say this, which is why the format had to move — so
    // this is the case that would have failed silently if the writer had kept emitting a type and a chan tag
    // and dropped everything but the primary slot. It rides in the same round trip as everything
    // else, so the two sheet comparisons below cover it as well as the field-by-field checks.
    // The sticker carries a DERIVED smoothness content — a decal's surface response since 4.28(f),
    // where it used to be a sibling layer tagged surfKey in a folder made for it.
    var stickerL = LayerNode.of({ type: "decal", name: "sticker", bmp: sticker, x: .3, y: .6, scale: 1, rot: 17, flip: true,
      sym: null, surf: null, opacity: .9, blend: "normal", visible: true });
    LayerNode.addContent(stickerL, "smooth", LayerNode.content("paint", { derived: "sm", canvas: bandC("#e0e0e0", 8, 24) }));
    var multi = band("#20c080", 30, 20);
    multi.name = "three channels";
    LayerNode.addContent(multi, "smooth", LayerNode.content("fill", { color: "#b4b4b4" }));
    LayerNode.addContent(multi, "metal", LayerNode.content("effect", { hue: 0, sat: 100, bright: 120, contrast: 90 }));
    return [
      fill("#111111", null, { name: "under" }),
      brush,
      fill("#909090", "smooth", { name: "gloss" }),
      LayerNode.of({ type: "adjust", name: "warm", hue: 8, sat: 110, bright: 100, contrast: 105, opacity: 1, blend: "normal", visible: true }),
      { type: "group", name: "badge", visible: true, opacity: 1, blend: "normal", children: [metalness, stickerL] },
      multi,
    ];
  };
  rt.layers = richStack();
  App.slots = new Map([["t57rt2", rt]]);
  App.activeSlot = rt; App.activeLayer = null;
  compositeSlot(rt); Composite.sheet(rt, "smooth", null);
  var beforeC = sheet(rt.composite), beforeS = sheet(rt.chanC.smooth);
  var blob2 = null;
  URL.createObjectURL = function(b){ blob2 = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  rt.layers = []; rt.chanC = null;
  await loadProject(blob2);
  compositeSlot(rt); Composite.sheet(rt, "smooth", null);
  var bk = rt.layers[1], bkG = rt.layers[4];
  out.rt = {
    shape: names(rt.layers).join(" "),
    colourSame: sheet(rt.composite) === beforeC,
    smoothSame: !!(rt.chanC && rt.chanC.smooth) && sheet(rt.chanC.smooth) === beforeS,
    paint: bk ? { type: bk.type, opacity: bk.opacity, blend: bk.blend, parts: Scope.parts(bk) ? Scope.parts(bk).join(",") : null,
                  rect: Scope.rect(bk) ? [Scope.rect(bk).x, Scope.rect(bk).y, Scope.rect(bk).w, Scope.rect(bk).h].join(",") : null,
                  label: Scope.label(bk),
                  hasMask: !!bk.mask, maskLit: bk.mask ? px(toCanvas(bk.mask), 48, 32)[3] : null,
                  maskDark: bk.mask ? px(toCanvas(bk.mask), 16, 32)[3] : null,
                  painted: bk.canvas ? px(toCanvas(bk.canvas), 24, 32) : null } : null,
    adjust: rt.layers[3] ? [rt.layers[3].hue, rt.layers[3].sat, rt.layers[3].bright, rt.layers[3].contrast].join(",") : null,
    // A DERIVED content, which is what a decal's surface response is since 4.28(f). It is marked
    // rather than merely present, because the marker is the permission a rebuild needs — a file
    // that lost it would come back with a gloss nothing ever refreshes and nothing can explain.
    derived: (function(){ var d = bkG && bkG.children[1]; var c = d && LayerNode.contentOn(d, "smooth"); return c ? c.derived : null; })(),
    chan: bkG && bkG.children[0] ? layerChan(bkG.children[0]) : null,
    decal: (function(){ var d = bkG && bkG.children[1]; return d ? { type: d.type, x: d.x, y: d.y, scale: d.scale,
      rot: d.rot, flip: !!d.flip, bmp: d.bmp ? px(toCanvas(d.bmp), 4, 4) : null } : null; })(),
    multi: (function(){
      var m = rt.layers[5];
      if (!m) return null;
      var cc = LayerNode.contentOn(m, "color"), cs = LayerNode.contentOn(m, "smooth"), cm = LayerNode.contentOn(m, "metal");
      return { name: m.name, chans: LayerNode.channelsOf(m).join(","),
               kinds: [cc && cc.kind, cs && cs.kind, cm && cm.kind].join(","),
               smoothColor: cs ? cs.color : null, metalBright: cm ? cm.bright : null,
               painted: cc && cc.canvas ? px(toCanvas(cc.canvas), 34, 32) : null,
               primary: LayerNode.onlyChan(m), legacyType: m.type };
    })(),
  };

  // ---- 16. a version 3 project — the same records with no group among them — still loads ----
  // The reader claims to take v3 and v4 "without a branch" and nothing had ever run a v3 file
  // through it. This makes a real one out of the file just written: same assets, same leaf records,
  // groups flattened into their children and the version put back to 3. That is exactly what a
  // project saved before ROADMAP 4.9 looks like. It matters twice over — §0's promise that an old
  // file keeps loading, and the precedent for 4.28(b), which has to migrate this shape forward one
  // way after its own version bump.

  // ---- 17. a layer is a bundle of per-channel content (ROADMAP 4.28(b)) ----
  // The node stopped being a TYPE with a channel tag on it and became a container: name, visibility,
  // opacity, blend, mask and part scope stay own properties of the node, and what it draws lives in
  // a slot addressed by channel. What is asserted here is both halves of that — that the storage
  // really moved, and that every field the other ninety-two modules read still answers, because
  // "interface untouched" is the whole claim of this slice.
  var n17 = LayerNode.of({ type: "paint", chan: "smooth", name: "gloss", canvas: flat("#c0c0c0"),
                           visible: true, opacity: .5, blend: "multiply", scope: Scope.make(["wing_l"], null) });
  out.node = {
    own: Object.keys(n17).sort().join(","),
    chans: LayerNode.channelsOf(n17).join(","),
    kind: LayerNode.contentOn(n17, "smooth") ? LayerNode.contentOn(n17, "smooth").kind : null,
    noContentElsewhere: LayerNode.contentOn(n17, "color") === null,
    legacy: [n17.type, n17.chan, layerChan(n17), !!n17.canvas, n17.opacity, n17.blend,
             Scope.parts(n17).join(","), n17.color === undefined].join("|"),
    idempotent: LayerNode.of(n17) === n17 && LayerNode.channelsOf(n17).length === 1,
  };
  // Changing the channel MOVES the content between slots rather than relabelling the node — which
  // is what changing a layer's channel has always meant and never had a way to say (subsumes 4.20).
  n17.chan = "metal";
  out.node.moved = { chans: LayerNode.channelsOf(n17).join(","), oldEmpty: LayerNode.contentOn(n17, "smooth") === null,
                     keptPixels: !!n17.canvas };
  // A clone shares no RECORD with its original. It does share the pixels until somebody snapshots
  // them, which is what makes duplicating a fill free and what duplicateLayer relies on.
  var c17 = LayerNode.clone(n17);
  c17.name = "copy"; c17.opacity = 1; c17.color = "#ff0000";
  out.node.clone = { origName: n17.name, origOpacity: n17.opacity, origColour: n17.color === undefined,
                     sharedPixels: c17.canvas === n17.canvas };
  // A group is a node and not a layer: it holds no content of its own, its children do.
  var g17 = { type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [] };
  out.node.group = { untouched: LayerNode.of(g17) === g17 && g17.type === "group" && !g17.chans,
                     isLayer: LayerNode.isLayer(g17), layerIs: LayerNode.isLayer(n17) };

  // ---- 18. the composite is addressed through the container (ROADMAP 4.28(c)) ----
  // This case used to assert the opposite: that the compositor could not tell a container from the
  // flat record it replaced. That was (b)'s claim and it was true then — the walk still read
  // "L.type" and "L.chan", which are accessors, so both shapes drew the same pixels and the
  // migration was provably lossless. (c) made the channel an ADDRESS: one walk builds every sheet
  // and it asks "LayerNode.contentOn", so the container is not a compatible shape any more, it is
  // the shape. What that costs is asserted here rather than left to be found: a record that never
  // went through "LayerNode.of" draws NOTHING, on any channel. What pays for it is that no such
  // record exists — the reader migrates every layer of every project on load (case 16 is a real
  // version-3 file), and every construction site in the app wraps.
  //
  // The stack is deliberately the awkward one: two channels, a group, a mask, a blend and an
  // opacity, so "draws nothing" cannot pass by accident on a stack that had nothing to draw.
  var mk18 = function(adopt){
    var node = function(rec){ return adopt ? LayerNode.of(rec) : rec; };
    return [node({ type: "paint", name: "b18", canvas: bandC("#ff0000", 0, 40), opacity: 1, blend: "normal", visible: true }),
            node({ type: "fill", name: "f18", color: "#00ff00", opacity: .5, blend: "multiply", visible: true }),
            { type: "group", name: "G", visible: true, opacity: .7, blend: "normal", mask: maskG,
              children: [node({ type: "paint", name: "b18b", canvas: bandC("#0000ff", 24, 40), opacity: 1, blend: "normal", visible: true }),
                         node({ type: "fill", name: "f18b", chan: "smooth", color: "#c0c0c0", opacity: 1, blend: "normal", visible: true })] }];
  };
  var p18 = mkSlot(), q18 = mkSlot(), e18 = mkSlot();      // flat, adopted, and nothing at all
  p18.layers = mk18(false);
  q18.layers = mk18(true);
  compositeSlot(p18); Composite.sheet(p18, "smooth", null);
  compositeSlot(q18); Composite.sheet(q18, "smooth", null);
  compositeSlot(e18); Composite.sheet(e18, "smooth", null);
  out.same = { adoptedDraws: sheet(q18.composite) !== sheet(e18.composite),
               adoptedChannel: !!(q18.chanC && q18.chanC.smooth),
               flatDrawsNothing: sheet(p18.composite) === sheet(e18.composite),
               flatHasNoChannel: !(p18.chanC && p18.chanC.smooth),
               adopted: LayerNode.isLayer(q18.layers[0]) && !LayerNode.isLayer(p18.layers[0]) };
  // The PANEL is the other half. Until 4.28(e) it could not tell the two shapes apart — every field
  // it read was an accessor that answered either way — and that was recorded here as the thing
  // keeping t44's flat fixtures honest. (e) ended it: a row draws one dot per channel the layer
  // CARRIES, and a flat record carries none, so the two now render differently on purpose and t44's
  // fixtures were rebuilt through LayerNode.of. What still has to hold is that the renderer does
  // not fall over on a shape it cannot read: same number of rows, same names, no dots.
  var keep18 = App.slots;
  // Objects and not "name/count" strings: this whole BODY is a template literal, and a backslash in
  // it is consumed before JavaScript ever sees it — so a regex like /\/0$/ arrives as // and turns
  // the rest of the line into a comment. Cost twenty minutes once; worth the sentence.
  var rows = function(){ return [].slice.call(document.querySelectorAll("#layerList .layer")).map(function(r){
    return { name: (r.querySelector(".nm") || {}).textContent, dots: r.querySelectorAll(".cdot").length }; }); };
  App.slots = new Map([["g57", p18]]); App.activeSlot = p18; App.activeLayer = null;
  refreshLayerList();
  var plainHTML = document.getElementById("layerList").innerHTML, plainRows = rows();
  App.slots = new Map([["g57", q18]]); App.activeSlot = q18; App.activeLayer = null;
  refreshLayerList();
  var richRows = rows();
  out.same.rowCount = plainRows.length === richRows.length && plainRows.length > 3;
  out.same.plainNoDots = plainRows.every(function(r){ return r.dots === 0; });
  out.same.richHasDots = richRows.some(function(r){ return r.dots > 0; });
  out.same.names = plainRows.map(function(r){ return r.name; }).join(",") ===
                   richRows.map(function(r){ return r.name; }).join(",");
  out.same.panelDrew = plainHTML.length > 400;
  App.slots = keep18; App.activeSlot = null; App.activeLayer = null;

  // ---- 19. "pass through": an effect inside a group reaches what is BELOW it (4.9's last piece) ----
  // A group flattens its children onto a scratch and treats the result as one layer's content —
  // which is what makes a group a group, and which also means an effect inside one adjusts its
  // siblings rather than the layers beneath. Slice 1 recorded that as "still open, and deliberately:
  // it is a feature (pass-through blend), not a bug". This is the feature, and the two cases below
  // are the same stack with one word changed, so the difference IS the blend.
  var effOf = function(blend, extra){
    var sl = mkSlot();
    sl.layers = [fill("#ff0000", null, { name: "under" }),
      Object.assign({ type: "group", name: "G", visible: true, opacity: 1, blend: blend, mask: null, parts: null,
        children: [LayerNode.of({ type: "adjust", name: "dim", hue: 0, sat: 100, bright: 40, contrast: 100,
                                  opacity: 1, blend: "normal", visible: true })] }, extra || {})];
    compositeSlot(sl);
    return px(sl.composite, 32, 32);
  };
  out.pass = { normal: effOf("normal"), through: effOf("pass through") };
  // ...and the group's own mask still reaches the children, because there is no flattened result to
  // put it on: it is handed down and lands on each of them instead.
  var maskedPass = mkSlot();
  maskedPass.layers = [fill("#ff0000", null, { name: "under" }),
    { type: "group", name: "G", visible: true, opacity: 1, blend: "pass through", mask: maskG, parts: null,
      children: [LayerNode.of({ type: "adjust", name: "dim", hue: 0, sat: 100, bright: 40, contrast: 100,
                                opacity: 1, blend: "normal", visible: true })] }];
  compositeSlot(maskedPass);
  out.pass.maskIn = px(maskedPass.composite, 32, 16);      // top half — the group's mask shows here
  out.pass.maskOut = px(maskedPass.composite, 32, 48);     // bottom half — masked away
  // Half opacity on a pass-through group multiplies into each child.
  out.pass.half = effOf("pass through", { opacity: .5 });
  // A NORMAL group inside a pass-through one still flattens first — the ambient lands on its result.
  var nested = mkSlot();
  nested.layers = [fill("#ff0000", null, { name: "under" }),
    { type: "group", name: "outer", visible: true, opacity: 1, blend: "pass through", mask: null, parts: null,
      children: [{ type: "group", name: "inner", visible: true, opacity: 1, blend: "normal", mask: null, parts: null,
        children: [LayerNode.of({ type: "adjust", name: "dim", hue: 0, sat: 100, bright: 40, contrast: 100,
                                  opacity: 1, blend: "normal", visible: true })] }] }];
  compositeSlot(nested);
  out.pass.nested = px(nested.composite, 32, 32);
  out.pass.offered = { group: layerBlends({ type: "group", children: [] }).indexOf("pass through") >= 0,
                       layer: layerBlends(fill("#111111")).indexOf("pass through") >= 0 };

  // ---- 16 continues below ----
  var z3 = await JSZip.loadAsync(blob2);
  var m3 = JSON.parse(await z3.file("project.json").async("string"));
  // Version 5 stores a leaf as its channel SLOTS (4.28(e)); a version 3 leaf is one flat record with
  // a "type" and a "chan" tag. Stamping the version back to 3 is therefore no longer enough — the
  // records have to be turned back into the old shape as well, or this case would be reading a v5
  // file through a v5 reader and calling it a migration test. That is exactly the hole a version
  // bump opens quietly, and §0's promise ("an old .wtproj still loads") is what it would have hidden.
  var KIND_TYPE = { fill: "fill", paint: "paint", image: "decal", effect: "adjust" };
  var toV3 = function(lm){
    if (!lm.chans) return lm;
    var ch = Object.keys(lm.chans)[0], c = lm.chans[ch];
    var o = { type: KIND_TYPE[c.kind], name: lm.name, visible: lm.visible, opacity: lm.opacity, blend: lm.blend };
    for (var k in c) if (k !== "kind") o[k] = c[k];
    if (ch !== "color") o.chan = ch;
    if (lm.scope) o.scope = lm.scope; else if (lm.parts) o.parts = lm.parts;
    if (lm.link) o.link = lm.link;
    if (lm.surfKey) o.surfKey = lm.surfKey;
    if (lm.maskFile) o.maskFile = lm.maskFile;
    return o;
  };
  var flatten = function(list){
    var o = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === "group") o = o.concat(flatten(list[i].children || []));
      else o.push(toV3(list[i]));
    }
    return o;
  };
  m3.version = 3;
  for (var si = 0; si < m3.slots.length; si++) m3.slots[si].layers = flatten(m3.slots[si].layers);
  z3.file("project.json", JSON.stringify(m3));
  var blob3 = await z3.generateAsync({ type: "blob" });
  rt.layers = []; rt.chanC = null;
  await loadProject(blob3);
  out.v3 = { shape: names(rt.layers).join(" "), leaves: layerLeaves(rt.layers).length,
             reallyFlat: m3.slots.every(function(sm){ return sm.layers.every(function(l){ return !l.chans && !!l.type; }); }),
             adopted: rt.layers.every(function(x){ return isGroup(x) || LayerNode.isLayer(x); }),
             anyGroup: rt.layers.some(function(x){ return isGroup(x); }),
             kinds: rt.layers.map(function(x){ return x.type; }).join(","),
             painted: rt.layers[1] && rt.layers[1].canvas ? px(toCanvas(rt.layers[1].canvas), 24, 32) : null };
  // ---- ROADMAP 4.36: a layer as the mask of another — the REFERENCE model ----
  // "Shape" paints the left half; "Red" covers the sheet and is masked BY Shape. Where Shape has
  // paint, Red shows; where it has none, the base. Then Shape is painted further — and Red follows
  // with no snapshot to refresh, because the mask IS Shape's canvas, read at composite time.
  var m36 = mkSlot(); m36.id = "t57m36";
  var shape = band("#ffffff", 0, 32);  shape.name = "Shape";
  var red = band("#ff0000", 0, N);     red.name = "Red";
  m36.layers = [shape, red];
  App.slots = new Map([["t57m36", m36]]); App.activeSlot = m36; App.activeLayer = red;
  var o36 = { uids: !!shape.uid && !!red.uid && shape.uid !== red.uid };
  setLayerMaskRef(m36, red, shape.uid, "mask by layer");
  compositeSlot(m36);
  o36.left = px(m36.composite, 8, 32); o36.right = px(m36.composite, 56, 32);
  o36.thumbIsRef = !red.mask && red.maskRef === shape.uid && LayerNode.maskCanvas(m36, red) === shape.canvas;
  // paint on the source: the mask moves with it, live
  ctx2d(shape.canvas).fillStyle = "#ffffff"; ctx2d(shape.canvas).fillRect(32, 0, 32, N);
  compositeSlot(m36);
  o36.rightAfter = px(m36.composite, 56, 32);
  // the row's candidates: Red cannot be Shape's mask while Shape is Red's (no cycles), and a fill lends nothing
  m36.layers.push(fill("#00ff00", null, { name: "Fill" }));
  o36.sources = { forRed: LayerNode.maskSources(m36, red).map(function(l){ return l.name; }).join(","),
                  forShape: LayerNode.maskSources(m36, shape).map(function(l){ return l.name; }).join(",") };
  m36.layers.pop();
  // painting on the mask of a referenced layer is refused, with a sentence
  var bWas36 = { tool: App.brush.tool, chan: App.brush.chan, target: App.brush.target };
  App.brush.tool = "brush"; App.brush.chan = "color"; App.brush.target = "mask";
  document.getElementById("status").textContent = "";
  var pt36 = paintTarget();
  o36.paintRefused = { target: pt36, said: document.getElementById("status").textContent.slice(0, 40) };
  App.brush.tool = bWas36.tool; App.brush.chan = bWas36.chan; App.brush.target = bWas36.target;
  // a project round trip keeps the uid and the reference, and composites the same
  App.skinUnits = savedUnits;
  var blob36 = null; realCOU = URL.createObjectURL; realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob36 = b; return "blob:stub"; }; HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  var before36 = sheet(m36.composite);
  m36.layers = [];
  await loadProject(blob36);
  var rShape = m36.layers[0], rRed = m36.layers[1];
  compositeSlot(m36);
  o36.roundTrip = { uidKept: rShape && rShape.uid === shape.uid, refKept: rRed && rRed.maskRef === shape.uid && !rRed.mask,
                    same: sheet(m36.composite) === before36, resolved: rRed && LayerNode.maskCanvas(m36, rRed) === (rShape && rShape.canvas) };
  // → painted copy freezes the shape and drops the link; undo brings the link back
  var undoN36 = App.undoStack.length;
  maskRefToPainted(m36, rRed);
  o36.frozen = { ref: rRed.maskRef, hasMask: !!rRed.mask, alphaLeft: rRed.mask ? px(rRed.mask, 8, 32)[3] : -1, undoSteps: App.undoStack.length - undoN36 };
  doUndo();
  o36.frozenUndone = { ref: rRed.maskRef === shape.uid, hasMask: !!rRed.mask };
  // the source deleted: nothing masks Red any more, and it says so in the row's title
  m36.layers.splice(0, 1);
  compositeSlot(m36);
  o36.orphan = { masks: LayerNode.maskCanvas(m36, rRed), left: px(m36.composite, 8, 32) };
  // a CLIPPING mask (4.44's second candidate): "below" resolves to whatever sits under the layer,
  // and follows a reorder — clip Blue to Shape, then move Shape away and Green in under it
  var shape2 = band("#ffffff", 0, 32), blue = band("#0000ff", 0, N), green = band("#00ff00", 32, 32);
  shape2.name = "Shape2"; blue.name = "Blue"; green.name = "Green";
  m36.layers = [shape2, blue];
  setLayerMaskRef(m36, blue, LayerNode.BELOW, "clip");
  compositeSlot(m36);
  o36.clip = { srcName: (LayerNode.below(m36, blue) || {}).name, left: px(m36.composite, 8, 32), right: px(m36.composite, 56, 32) };
  m36.layers = [green, blue, shape2];                             // Green is under Blue now, Shape2 above
  compositeSlot(m36);
  o36.clipMoved = { srcName: (LayerNode.below(m36, blue) || {}).name, left: px(m36.composite, 8, 32), right: px(m36.composite, 56, 32) };
  m36.layers = [blue, green];                                     // nothing under Blue: nothing masks it
  compositeSlot(m36);
  o36.clipBottom = { src: LayerNode.below(m36, blue), left: px(m36.composite, 8, 32) };
  out.mask36 = o36;

  // ---- 20. a version 5 file captured once and NEVER rewritten: 5.3's promise, held by bytes ----
  // Every other project case here writes its file with this build's saveProject and reads it back
  // with this build's loadProject, so writer and reader move together — and a change to both at
  // once (a field renamed, a record reshaped) passes every one of them while breaking every file a
  // user already has. This one reads bytes captured from the build of 2026-09-24 and never
  // regenerated, tools/fixtures/project-v5.wtproj. The oracle is the stack it was written from,
  // built again by today's code and composited on three sheets.
  //
  // It carries every leaf kind case 15 does, plus what version 5 gained additively since — a group
  // with a mask, a rectangle scope and a collapsed flag, a gradient, a layer masked by another's
  // uid, a clip and blend-if — because each is a field a future writer could rename. It carries no
  // "assets/" folder: nothing in it came from the game, which is the only reason a .wtproj may be
  // tracked at all (docs/DISCORD.md §1). When the writer moves to version 6, capture
  // project-v6.wtproj BESIDE this file; this one stays as it is for as long as version 5 is read.
  var v5Stack = function(){
    var fade = fill("#ffe000", null, { name: "v5 gradient", grad: Gradient.make("uv", "#ffe000") });
    var shapeL = band("#ffffff", 0, 32);  shapeL.name = "v5 shape";
    var clipped = fill("#4000ff", null, { name: "v5 clipped" });   clipped.maskRef = LayerNode.BELOW;
    var byRef = fill("#ff4000", null, { name: "v5 masked" });      byRef.maskRef = shapeL.uid;
    var toned = fill("#00ffff", null, { name: "v5 blend-if", opacity: .8, blend: "screen" });
    toned.tone = { src: "lum", lo: .5, hi: 1, soft: .1, invert: false };
    var mask = mkCanvas(N, N); (function(){ var g = ctx2d(mask); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 48, N); })();
    var grp = { type: "group", name: "v5 group", visible: true, opacity: .8, blend: "normal", collapsed: true,
                scope: Scope.make(null, { x: 4, y: 4, w: 56, h: 40 }), mask: mask,
                children: [fade, shapeL, clipped, byRef] };
    return richStack().concat([grp, toned]);
  };
  var fx = mkSlot(); fx.id = "t57v5";
  App.slots = new Map([["t57v5", fx]]); App.activeSlot = fx; App.activeLayer = null;
  var sheets = function(){
    compositeSlot(fx); Composite.sheet(fx, "smooth", null); Composite.sheet(fx, "metal", null);
    return [sheet(fx.composite), fx.chanC && fx.chanC.smooth ? sheet(fx.chanC.smooth) : "none",
            fx.chanC && fx.chanC.metal ? sheet(fx.chanC.metal) : "none"];
  };
  fx.layers = v5Stack();
  var want = sheets(), o20 = { capture: ${CAPTURE_V5} };
  if (o20.capture) {
    var cap = null;
    URL.createObjectURL = function(b){ cap = b; return "blob:stub"; };
    HTMLAnchorElement.prototype.click = function(){};
    try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
    var cu = new Uint8Array(await cap.arrayBuffer()), cs = "";
    for (var ci = 0; ci < cu.length; ci++) cs += String.fromCharCode(cu[ci]);
    o20.captured = btoa(cs);
  }
  var FX = "${FIXTURE_V5_B64}";
  if (FX) {
    var fraw = atob(FX), fb = new Uint8Array(fraw.length);
    for (var fi = 0; fi < fraw.length; fi++) fb[fi] = fraw.charCodeAt(fi);
    var fz = await JSZip.loadAsync(fb);
    var fm = JSON.parse(await fz.file("project.json").async("string"));
    o20.version = fm.version;
    o20.assets = Object.keys(fz.files).filter(function(k){ return /^assets\\//.test(k) && !fz.files[k].dir; }).length;
    o20.slotIds = fm.slots.map(function(sm){ return sm.id; }).join(",");
    fx.layers = []; fx.chanC = null;
    document.getElementById("status").textContent = "";
    await loadProject(new Blob([fb]));
    o20.said = document.getElementById("status").textContent;
    var got = sheets();
    o20.same = [got[0] === want[0], got[1] === want[1], got[2] === want[2]];
    o20.drew = want.map(function(s){ return s !== "none"; });
    o20.shape = names(fx.layers).join(" ");
    var fg = fx.layers[6], fT = fx.layers[7], fB = fx.layers[1], fM = fx.layers[5];
    var fK = fg && fg.children || [];
    var fGrad = fK[0] && LayerNode.contentOn(fK[0], "color");
    o20.group = fg ? { isGroup: isGroup(fg), collapsed: !!fg.collapsed, opacity: fg.opacity,
      rect: Scope.rect(fg) ? [Scope.rect(fg).x, Scope.rect(fg).y, Scope.rect(fg).w, Scope.rect(fg).h].join(",") : null,
      maskIn: fg.mask ? px(toCanvas(fg.mask), 8, 32)[3] : null, maskOut: fg.mask ? px(toCanvas(fg.mask), 56, 32)[3] : null } : null;
    o20.grad = fGrad && fGrad.grad ? { stops: fGrad.grad.stops.length, from: fGrad.grad.stops[0].color, fadeTo: fGrad.grad.stops[1].alpha } : null;
    o20.clip = fK[2] ? fK[2].maskRef : null;
    o20.ref = fK[3] && fK[3].maskRef ? (LayerNode.byUid(fx.layers, fK[3].maskRef) || {}).name || "unresolved" : null;
    o20.tone = fT && fT.tone ? [fT.tone.src, fT.tone.lo, fT.tone.hi, fT.tone.soft, fT.opacity, fT.blend].join(",") : null;
    o20.scope = fB ? [Scope.parts(fB) ? Scope.parts(fB).join(",") : "", Scope.rect(fB) ? Scope.rect(fB).w : ""].join("|") : null;
    o20.multi = fM ? LayerNode.channelsOf(fM).join(",") : null;
  }
  out.v5 = o20;

  App.slots = savedSlots; App.skinUnits = savedUnits;
  App.activeSlot = null; App.activeLayer = null;
  App.slots.delete("g57"); App.activeSlot = null; App.activeLayer = null;
  App.undoStack.length = 0; App.redoStack.length = 0;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const rgb = a => a ? `rgb(${a[0]},${a[1]},${a[2]})` : "—";

console.log("=== a pass-through group changes nothing ===");
R.is(o.passThrough.same,
  "the same layers inside a group give byte-for-byte the same sheet as loose — every existing project depends on this");
R.is(o.passThrough.mid[2] === 255 && o.passThrough.mid[0] === 0, `and the top child still wins the overlap (${rgb(o.passThrough.mid)})`);

console.log("\n=== group opacity applies to the flattened children ===");
console.log(`   overlap: group .5 → ${rgb(o.opacity.group)}   each child .5 → ${rgb(o.opacity.perChild)}`);
// The arithmetic, so the numbers are checkable rather than recorded: the group flattens to pure
// blue in the overlap, so half of it over the rgb(32,32,32) base is (16,16,143) — and a red channel
// of ~16 is the BASE at half strength, not red. Drawing the children separately instead leaves the
// red band's contribution in, which is what lifts the red channel to 71.
R.is(o.opacity.group[0] < 25 && o.opacity.group[2] > 100,
  `in the overlap only the top child shows, at half strength (${rgb(o.opacity.group)}) — the red channel is the base showing through, not red`);
R.is(o.opacity.perChild[0] > 50,
  `the wrong implementation is visibly different there (${rgb(o.opacity.perChild)}) — red survives, so this is a real discriminator`);
R.is(o.opacity.outsideOverlap[0] > 100 && o.opacity.outsideOverlap[2] < 60,
  `and outside the overlap the group still fades its child (${rgb(o.opacity.outsideOverlap)})`);

console.log("\n=== a hidden group hides its visible children ===");
R.is(o.hidden.px[1] < 60, `nothing of the child reaches the sheet (${rgb(o.hidden.px)}, base is rgb(32,32,32))`);
R.is(o.hidden.leaves === 1 && o.hidden.visible === 0,
  `and the walkers agree: ${o.hidden.leaves} leaf, ${o.hidden.visible} of them showing`);

console.log("\n=== a group's mask multiplies its child's ===");
console.log(`   both ${rgb(o.masks.both)}   child only ${rgb(o.masks.childOnly)}   group only ${rgb(o.masks.groupOnly)}   neither ${rgb(o.masks.neither)}`);
R.is(o.masks.both[1] > 200, "where both masks allow it, the child shows");
R.is(o.masks.childOnly[1] < 60 && o.masks.groupOnly[1] < 60 && o.masks.neither[1] < 60,
  "and nowhere else — either mask alone is enough to hide it, which is what multiplying means");

console.log("\n=== one group, two channels ===");
R.is(o.channels.colour[1] > 200, `the colour child lands in the albedo (${rgb(o.channels.colour)})`);
R.is(o.channels.smooth && o.channels.smooth[0] > 180,
  `the smoothness child lands in the smoothness sheet (${o.channels.smooth ? o.channels.smooth[0] : "no sheet"}) — a group is not channel-tagged`);

console.log("\n=== region == whole, through a masked, faded group ===");
R.is(o.region.worst === 0, `redoing the rectangle through the region path reproduces it exactly (${o.region.off} of ${o.region.of} bytes differ, worst ${o.region.worst})`);

console.log("\n=== the walkers ===");
console.log(`   leaves ${o.walk.leaves.join(", ")}   nodes ${o.walk.nodes.join(", ")}`);
R.is(o.walk.leaves.join(",") === "#111111,#222222,#333333", "layerLeaves reaches every depth, in stack order");
R.is(o.walk.nodes.join(",") === "#111111,outer,#222222,inner,#333333", "layerNodes lists a group before its children");
R.is(o.walk.ownerIs, "nodeOwner returns the array a node really lives in, and its index — the tree's answer to indexOf");
R.is(o.walk.depth === 2, `nodeDepth counts nesting (${o.walk.depth})`);
R.is(o.walk.containsDown && !o.walk.containsUp,
  "nodeContains only looks downward — that is the guard that stops a group being dropped into its own child");

console.log("\n=== the active layer is a node, not an index ===");
console.log(`   selected "${o.sel.before}", removed the layer under it → "${o.sel.afterRemovingBelow}"`);
R.is(o.sel.afterRemovingBelow === "c",
  "the selection stays on the layer you chose — as an index it silently became “d”, and the next stroke painted there");
R.is(o.sel.deletedNode === "(deselected)",
  "and a node that is no longer in the slot is no selection at all, rather than a stale object still taking paint");

console.log("\n=== group, ungroup, and their undo ===");
console.log(`   ${o.group.after}   undo → ${o.group.undone}   redo → ${o.group.redone}`);
R.is(o.group.isGroup && o.group.after === "p Group 1[q] r", `grouping wraps in place, leaving the stack order alone (${o.group.after})`);
R.is(o.group.active === "Group 1", "and selects the group, which is the thing you now want to name and set");
R.is(o.group.undone === "p q r", `undo puts the layer back exactly where it was (${o.group.undone})`);
R.is(o.group.redone === "p Group 1[q] r", `and redo re-wraps it (${o.group.redone})`);
R.is(o.group.ungrouped === "p q r", `ungroup leaves the children where the group was (${o.group.ungrouped})`);
R.is(o.group.ungroupUndone === "p Group 1[q] r", `and undoing that rebuilds the group around them (${o.group.ungroupUndone})`);

console.log("\n=== a group cannot be dropped inside itself ===");
R.is(o.cycle.outerStillTop && o.cycle.still === "OUT[IN[x]] z",
  `dropping a group into its own descendant is refused (${o.cycle.still}) — it would detach the subtree from the slot`);

console.log("\n=== dragging into a group and back out ===");
console.log(`   ${o.move.intoGroup}   undo → ${o.move.undone}   out again → ${o.move.outAgain}`);
R.is(o.move.intoGroup === "G[in1 bot] top", `a layer dropped on a group goes inside it, on top (${o.move.intoGroup})`);
R.is(o.move.undone === "bot G[in1] top", `undo takes it out and back to its own place in the stack (${o.move.undone})`);
R.is(o.move.outAgain === "G[in1] top bot", `and it can be dragged out again (${o.move.outAgain})`);

console.log("\n=== the two drops the list could not express (4.16) ===");
const D = o.drop;
console.log(`   strips ${D.strips} (depths ${D.stripDepths}) · below group → ${D.belowGroup} · bottom of group → ${D.bottomOfGroup} · onto a layer → ${D.grouped}`);
R.is(D.strips === 2 && D.stripDepths === "10", `an open group at the bottom gives two strips, the group's indented one first (${D.strips}, depths ${D.stripDepths})`);
R.is(D.belowGroup === "top G[in1] mid", `a drop on the slot's strip lands BELOW the group, at index 0 (${D.belowGroup}) — unreachable by drag until 2026-09-20`);
R.is(D.bottomOfGroup === "top G[mid in1]", `a drop on the group's strip lands at the bottom of its children (${D.bottomOfGroup})`);
R.is(D.undone === "G[in1] mid top", `undo puts both back (${D.undone})`);
R.is(D.grouped === "G[in1] Group 1[mid top]", `a drop INTO an ordinary layer makes a group of the two, the dragged one on top (${D.grouped})`);
R.is(D.groupUndone === "G[in1] mid top", `and undo dissolves it (${D.groupUndone})`);
R.is(D.edge === "G[in1] top mid", `the same drop at the row's edge is the old "above" reorder (${D.edge})`);
R.is(D.groupThumb && D.groupMark && D.childGuide, `a group row carries a thumbnail, a folder mark and its children a guide line (${D.groupThumb}, ${D.groupMark}, ${D.childGuide})`);

console.log("\n=== a layer, a group or a decal as its own image (4.21) ===");
const X = o.exp;
console.log(`   half: own ${rgb(X.half.own)} sheet ${rgb(X.half.sheet)} · group: own ${rgb(X.group.own)} sheet ${rgb(X.group.sheet)} · decal own ${X.decal.ownSize.join("x")} sheet ${X.decal.sheetSize}px`);
console.log(`   written ${JSON.stringify(X.run.written)} · asked ${JSON.stringify(X.run.asked)}`);
R.is(X.chan.half === "color" && X.chan.group === "color" && X.chan.effect === "color", `the channel is colour for all three (${X.chan.half}, ${X.chan.group}, ${X.chan.effect})`);
R.is(X.half.own[0] === 255 && X.half.own[3] === 255 && X.half.ownSize === 64, `"own pixels" of a half-opacity layer is its canvas as made — opaque red (${rgb(X.half.own)}, alpha ${X.half.own[3]})`);
R.is(X.half.sheet[0] === 255 && Math.abs(X.half.sheet[3] - 128) <= 2 && X.half.sheetSize === 64, `"on the sheet" is the same layer PLACED — red at half alpha (${rgb(X.half.sheet)}, alpha ${X.half.sheet[3]})`);
R.is(X.group.own[2] === 255 && X.group.own[3] === 255, `a group's own pixels are its children flattened WITHOUT the group's opacity (alpha ${X.group.own[3]})`);
R.is(X.group.sheet[2] === 255 && Math.abs(X.group.sheet[3] - 128) <= 2, `and on the sheet the group's opacity applies (alpha ${X.group.sheet[3]})`);
R.is(X.fillOwn === null && X.fillSheet[1] === 255, `a fill has no pixels of its own, and its sheet form is the colour (${rgb(X.fillSheet)})`);
R.is(X.decal.ownSize.join("x") === "4x4" && X.decal.own[0] === 255 && X.decal.own[1] === 255,
  `a decal's own pixels are its SOURCE image at its own size (${X.decal.ownSize.join("x")}, ${rgb(X.decal.own)})`);
R.is(X.decal.sheetSize === 64 && X.decal.centre[3] === 255 && X.decal.corner[3] === 0,
  `and its sheet form is the placed footprint — opaque at the centre, empty at the corner (${X.decal.sheetSize}px)`);
R.is(X.run.written.join(",") === "my_skin_Half_on_sheet.png,my_skin_Wash_on_sheet.png,my_skin_Badge.tga",
  `the files are named for the skin, the layer and the form (${X.run.written.join(", ")})`);
R.is(X.run.asked.length === 5 && X.run.asked[0] === "own,sheet,cancel" && X.run.asked[2] === "png,tga,cancel",
  `the form is asked only where the two differ, the format always, and both name their choices (${X.run.asked.join(" | ")})`);
R.is(/effect/.test(X.run.status) && /no pixels of its own/.test(X.run.status), `an effect layer is refused with the reason ("${X.run.status}")`);

console.log("\n=== deleting a group takes its children with it ===");
R.is(o.del.after === "under" && o.del.leaves === 1, `the group and both its layers go (${o.del.after})`);
R.is(o.del.undone === "under G[k1 k2]" && o.del.kidsBack === 3,
  `and undo brings the whole subtree back, not an empty group (${o.del.undone})`);

console.log("\n=== solo reaches inside a group ===");
R.is(o.solo.target && o.solo.group,
  "soloing a layer inside a group keeps the GROUP visible too — otherwise the one thing asked for is the one thing hidden");
R.is(!o.solo.sibling && !o.solo.outside, "and hides its siblings, inside the group and outside it");
R.is(o.solo.showing === "i1", `so exactly one layer is showing (${o.solo.showing})`);

console.log("\n=== a group survives a .wtproj round trip ===");
console.log(`   ${o.proj.shape}`);
R.is(o.proj.isGroup, "the group comes back as a group, not flattened into its children");
R.is(o.proj.opacity === .42 && o.proj.blend === "multiply",
  `with its own opacity and blend (${o.proj.opacity}, ${o.proj.blend}) — those live on the group and nowhere else`);
R.is(o.proj.hasMask && o.proj.parts === "wing_l", "and its own mask and part limit");
R.is(o.proj.collapsed, "the fold comes back too — it is stored on the node, so it travels with it");
R.is(o.proj.chan === "smooth", `a child keeps its channel (${o.proj.chan}) — a group is not channel-tagged, its children are`);
R.is(o.proj.nested === 1 && o.proj.nestedHidden === true, "and a group inside a group comes back, hidden as it was saved");

console.log("\n=== and a project from a newer build is refused, not half-applied ===");
console.log(`   ${o.gate.said}`);
R.is(/newer build/.test(o.gate.said) && /99/.test(o.gate.said),
  "the version gate says so plainly — it was written into every project since v1 and never once read");
R.is(o.gate.cleared, "and the pending project is dropped rather than left to be retried into a half-restore");

console.log("\n=== and so does every kind of leaf, judged on the sheet ===");
console.log(`   ${o.rt.shape}`);
R.is(o.rt.colourSame,
  "the albedo composites to the same bytes after the round trip — a reader that dropped a layer's pixels cannot pass this, and a field list would not have looked");
R.is(o.rt.smoothSame, "and so does the smoothness channel, which is a second sheet built from the same stack");
R.is(o.rt.paint && o.rt.paint.type === "paint" && o.rt.paint.opacity === .7 && o.rt.paint.blend === "multiply",
  `a paint layer comes back as itself (${o.rt.paint && o.rt.paint.opacity}, ${o.rt.paint && o.rt.paint.blend})`);
R.is(o.rt.paint && o.rt.paint.painted && o.rt.paint.painted[3] > 200 && o.rt.paint.painted[0] > 200,
  `with the pixels someone painted (${rgb(o.rt.paint && o.rt.paint.painted)})`);
R.is(o.rt.paint && o.rt.paint.hasMask && o.rt.paint.maskLit > 200 && o.rt.paint.maskDark < 60,
  `and its own mask, still light on one half and dark on the other (${o.rt.paint && o.rt.paint.maskLit} / ${o.rt.paint && o.rt.paint.maskDark})`);
R.is(o.rt.paint && o.rt.paint.parts === "wing_l",
  "the per-layer scope's PART half survives — it stencils nothing with no model loaded, so the sheet cannot see it and only this can");
R.is(o.rt.paint && o.rt.paint.rect === "8,4,24,16",
  `and its rectangle half with it (${o.rt.paint && o.rt.paint.rect}) — 4.28(g) made a scope a recipe, and a reader that kept only the parts would drop the other half of where the layer applies`);
R.is(/wing_l/.test(o.rt.paint.label || "") && /24×16/.test(o.rt.paint.label || ""),
  `and the panel names both (${o.rt.paint.label}) — they intersect, so a label naming one of them would describe somewhere the layer is not`);
R.is(o.rt.adjust === "8,110,100,105", `an adjustment keeps all four parameters (${o.rt.adjust})`);
R.is(o.rt.chan === "metal", `a layer on a surface channel keeps it (${o.rt.chan})`);
R.is(o.rt.derived === "sm",
  `and a decal's DERIVED content comes back marked as derived (${o.rt.derived}) — 4.28(f) put the surface response in the decal's own channel slots, and the marker is what a rebuild is allowed to replace`);
R.is(o.rt.decal && o.rt.decal.type === "decal" && o.rt.decal.x === .3 && o.rt.decal.rot === 17 && o.rt.decal.flip,
  `a decal keeps its placement (${o.rt.decal && o.rt.decal.x}, ${o.rt.decal && o.rt.decal.y}, rot ${o.rt.decal && o.rt.decal.rot}, flipped)`);
R.is(o.rt.decal && o.rt.decal.bmp && o.rt.decal.bmp[1] > 200 && o.rt.decal.bmp[2] > 200,
  `and its image (${rgb(o.rt.decal && o.rt.decal.bmp)}, the cyan corner)`);
// The case version 5 exists for. Before (e) there was no file shape that could hold it, and no
// reader that could have been wrong about it — which is why this is the only assertion in the
// round trip that the OLD format would have failed rather than merely not exercised.
const MU = o.rt.multi;
console.log(`   multi-channel layer: ${MU && MU.chans} · kinds ${MU && MU.kinds}`);
R.is(MU && MU.chans === "color,smooth,metal",
  `one layer comes back carrying all three of its channels (${MU && MU.chans}) — a version 4 writer stored a type and one chan tag, so two of them had nowhere to go`);
R.is(MU && MU.kinds === "paint,fill,effect",
  `each slot keeps its own content KIND (${MU && MU.kinds}) — painted colour, a smoothness fill and a metalness effect in one layer`);
R.is(MU && MU.smoothColor === "#b4b4b4" && MU.metalBright === 120,
  `and each keeps its own values (${MU && MU.smoothColor}, bright ${MU && MU.metalBright}) — the effect is on METALNESS, which the old panel refused to make at all`);
R.is(MU && MU.painted && MU.painted[3] > 200,
  `with the pixels on the colour slot (${rgb(MU && MU.painted)})`);
R.is(MU && MU.primary === "color" && MU.legacyType === "paint",
  `and the primary slot is still the first one (${MU && MU.primary}), so every legacy accessor describes what it always did (L.type = ${MU && MU.legacyType})`);

console.log("\n=== a version 3 project still loads ===");
R.is(o.v3.reallyFlat, "the file it reads really is the old shape — flat records with a type, no channel slots — or this case would be a v5 reader reading a v5 file");
R.is(o.v3.adopted, "and every record comes back as a container: the flat shape migrates forward on load, one way, which is what the version 5 bump rests on (4.28(e), D5)");
console.log(`   ${o.v3.shape}`);
R.is(!o.v3.anyGroup && o.v3.leaves === 7,
  `a file with no group in it comes back as ${o.v3.leaves} loose layers and no container — which is what every project written before 4.9 is`);
// The multi-channel layer is a `paint` here and nothing else: `toV3` keeps its first slot and drops
// the rest, because that is exactly what a version 3 file could hold. Losing two channels on the
// way DOWN is the point — the direction that has to be lossless is forward.
R.is(o.v3.kinds === "fill,paint,fill,adjust,paint,paint" || o.v3.kinds === "fill,paint,fill,adjust,paint,decal,paint",
  `every record keeps its kind (${o.v3.kinds})`);
R.is(o.v3.painted && o.v3.painted[3] > 200,
  "with its pixels — the reader really does take both versions without a branch, which until now was a comment rather than a fact");

console.log("\n=== a stored version 5 file still loads (5.3) ===");
const V5 = o.v5 || {};
if (CAPTURE_V5) {
  fs.writeFileSync(FIXTURE_V5, Buffer.from(V5.captured || "", "base64"));
  console.log(`   captured ${path.relative(ROOT, FIXTURE_V5)} (${fs.statSync(FIXTURE_V5).size} bytes) — run again without --capture-v5 to read it back`);
}
R.is(!!FIXTURE_V5_B64 || CAPTURE_V5, `the stored file is there (${path.relative(ROOT, FIXTURE_V5)}) — a missing fixture fails rather than skipping, or deleting it would be the way to make this pass`);
if (FIXTURE_V5_B64) {
  console.log(`   ${V5.shape}`);
  console.log(`   sheets same: ${V5.same} · "${V5.said}"`);
  R.is(V5.version === 5 && V5.slotIds === "t57v5",
    `the file really is version 5 (${V5.version}), or this would be today's reader reading today's writer`);
  R.is(V5.assets === 0, `and it carries nothing from the game (${V5.assets} files under assets/, which is an empty folder) — the only reason a .wtproj may be tracked`);
  R.is(/^Project restored/.test(V5.said || ""), `the loader says it restored it (“${V5.said}”)`);
  R.is(V5.drew && V5.drew.every(Boolean), `the stack draws on all three sheets — colour, smoothness, metalness (${V5.drew}) — or comparing them proves nothing`);
  R.is(V5.same && V5.same.every(Boolean),
    `and each composites to the same bytes as the stack it was written from, built again by today's code (${V5.same})`);
  R.is(V5.shape === "under brushwork gloss warm badge[metalness sticker] three channels v5 group[v5 gradient v5 shape v5 clipped v5 masked] v5 blend-if",
    `every node comes back where it was (${V5.shape})`);
  const G5 = V5.group || {};
  R.is(G5.isGroup && G5.collapsed && G5.opacity === .8 && G5.rect === "4,4,56,40" && G5.maskIn === 255 && G5.maskOut === 0,
    `the group keeps its opacity, collapsed flag, rectangle scope and mask (${JSON.stringify(G5)})`);
  R.is(V5.grad && V5.grad.stops === 2 && V5.grad.from === "#ffe000" && V5.grad.fadeTo === 0,
    `a gradient keeps its stops (${JSON.stringify(V5.grad)})`);
  R.is(V5.clip === "below" && V5.ref === "v5 shape",
    `a clip keeps its “below” and a layer mask resolves its uid to the layer it named (${V5.clip}, ${V5.ref})`);
  R.is(V5.tone === "lum,0.5,1,0.1,0.8,screen", `blend-if keeps its band, beside the layer's opacity and blend (${V5.tone})`);
  R.is(V5.scope === "wing_l|24" && V5.multi === "color,smooth,metal",
    `a part-and-rectangle scope (${V5.scope}) and a three-channel layer (${V5.multi}) come back whole`);
}

console.log("\n=== a layer is a bundle of per-channel content ===");
console.log(`   own: ${o.node.own}   chans: ${o.node.chans}`);
R.is(o.node.own === "blend,chans,name,opacity,scope,uid,visible",
  `the bundle is what the node still owns — name, visibility, opacity, blend, scope, and since 4.36 a uid another layer can point at — plus the channel slots (${o.node.own})`);
R.is(o.node.chans === "smooth" && o.node.kind === "paint" && o.node.noContentElsewhere,
  "and the content sits in the slot for its channel, with nothing in any other");
R.is(o.node.legacy === "paint|smooth|smooth|true|0.5|multiply|wing_l|true",
  `every field the rest of the app reads still answers (${o.node.legacy}) — that is the whole claim of this slice`);
R.is(o.node.idempotent, "adopting a node twice is adopting it once — the call sites can be careless and the loader is one of them");
R.is(o.node.moved.chans === "metal" && o.node.moved.oldEmpty && o.node.moved.keptPixels,
  "setting a layer's channel MOVES its content between slots and keeps the pixels — which is what changing a channel always meant and had no way to say");
R.is(o.node.clone.origName === "gloss" && o.node.clone.origOpacity === .5 && o.node.clone.origColour,
  "a clone shares no record with its original: writing to the copy's bundle or its content leaves the original alone");
R.is(o.node.clone.sharedPixels,
  "and it does share the pixels until somebody snapshots them, which is what makes duplicating a fill free");
R.is(o.node.group.untouched && !o.node.group.isLayer && o.node.group.layerIs,
  "a group is left exactly as it is — it holds no content of its own, its children do");

console.log("\n=== the composite is addressed through the container (4.28(c)) ===");
R.is(o.same.adopted, "the two stacks really are the two shapes, or this would compare a thing with itself");
R.is(o.same.adoptedDraws && o.same.adoptedChannel,
  "the adopted stack draws — on the albedo and on its own smoothness sheet, through a group, a mask and a blend");
R.is(o.same.flatDrawsNothing && o.same.flatHasNoChannel,
  "and the flat record draws NOTHING: a layer is what LayerNode.of made, which is why the reader migrates every project on load");
R.is(o.same.panelDrew && o.same.rowCount && o.same.names,
  "the layer list draws the same rows, with the same names, from either shape — a record it cannot read must not take the panel down with it");
R.is(o.same.plainNoDots && o.same.richHasDots,
  "but only the adopted one shows channel dots (4.28(e)) — the dots ARE the container, so a flat record has nothing to draw and t44's fixtures were rebuilt through LayerNode.of to match what a user can actually reach");

console.log("\n=== pass through: an effect inside a group reaches what is below it (4.9) ===");
const PS = o.pass;
console.log(`   normal ${rgb(PS.normal)} · pass through ${rgb(PS.through)} · half ${rgb(PS.half)} · nested ${rgb(PS.nested)}`);
R.is(PS.normal[0] > 200,
  `inside a NORMAL group the effect adjusts its siblings, and it has none — so the red base below is untouched (${rgb(PS.normal)}), which is correct and is also the thing people find surprising`);
R.is(PS.through[0] < 150 && PS.through[0] > 0,
  `with the blend set to "pass through" the same effect dims the base beneath it (${rgb(PS.through)}) — nothing is flattened, so the effect reads the target and not the group's own scratch`);
R.is(PS.maskIn[0] < 150 && PS.maskOut[0] > 200,
  `the group's own mask still applies (${rgb(PS.maskIn)} where it shows, ${rgb(PS.maskOut)} where it hides) — there is no flattened result to put it on, so it is handed down and lands on each child`);
R.is(PS.half[0] > PS.through[0] && PS.half[0] < PS.normal[0],
  `and so does its opacity, multiplied into each child (${rgb(PS.half)}, between the two above)`);
R.is(PS.nested[0] > 200,
  `a NORMAL group inside a pass-through one still flattens first (${rgb(PS.nested)} — untouched, like the normal case) — the ambient is cleared for the recursion and applied to its result, or a group would stop being a group as soon as its parent was one`);
R.is(PS.offered.group && !PS.offered.layer,
  "it is offered on a group and on nothing else: “do not flatten these children” is not something a layer can do");

console.log("\n=== a layer as the mask of another, by reference (4.36) ===");
const M6 = o.mask36 || {};
console.log(`   left ${rgb(M6.left || [])} · right ${rgb(M6.right || [])} · right after painting the source ${rgb(M6.rightAfter || [])}`);
R.is(M6.uids, "every layer has a uid of its own, which is what a reference points at");
R.is(M6.left && M6.left[0] > 200 && M6.left[1] < 40 && M6.right && M6.right[0] < 60 && M6.thumbIsRef,
  "Red masked by Shape: red where Shape has paint, the base where it has none — and the mask IS Shape's canvas, no copy");
R.is(M6.rightAfter && M6.rightAfter[0] > 200, "paint on Shape and Red follows, live — the reference is read at composite time, nothing is refreshed by hand");
R.is(M6.sources && M6.sources.forRed === "Shape" && M6.sources.forShape === "",
  `the candidates exclude the layer itself, a fill (no pixels to lend) and a cycle — for Red: “${M6.sources && M6.sources.forRed}”, for Shape: “${M6.sources && M6.sources.forShape}”`);
R.is(M6.paintRefused && M6.paintRefused.target === null && /masked by another layer/.test(M6.paintRefused.said),
  `painting on the mask of a referenced layer is refused in words — “${M6.paintRefused && M6.paintRefused.said}…”`);
R.is(M6.roundTrip && M6.roundTrip.uidKept && M6.roundTrip.refKept && M6.roundTrip.same && M6.roundTrip.resolved,
  "a project round trip keeps the uid and the reference (additive, still version 5), resolves it, and composites the same bytes");
R.is(M6.frozen && M6.frozen.ref === null && M6.frozen.hasMask && M6.frozen.alphaLeft === 255 && M6.frozen.undoSteps === 1,
  `→ painted copy freezes the shape into a mask of its own (alpha ${M6.frozen && M6.frozen.alphaLeft} where Shape painted) and drops the link, in one undo step`);
R.is(M6.frozenUndone && M6.frozenUndone.ref && !M6.frozenUndone.hasMask, "and undo puts the reference back");
R.is(M6.orphan && M6.orphan.masks === null && M6.orphan.left && M6.orphan.left[0] > 200,
  "with the source deleted nothing masks the layer — it shows whole, and the row says the source is gone");
const CL = M6.clip || {}, CM = M6.clipMoved || {}, CB = M6.clipBottom || {};
R.is(CL.srcName === "Shape2" && CL.left && CL.left[2] > 200 && CL.right && CL.right[2] < 60,
  `a clipping mask shows the layer only where the one below has paint — clipped to “${CL.srcName}”: blue left, base right`);
R.is(CM.srcName === "Green" && CM.left && CM.left[0] > 200 && CM.left[2] > 200 && CM.right && CM.right[2] > 200 && CM.right[0] < 60,
  `and it FOLLOWS the stack: with Green moved in underneath and Shape2 on top, the clip is to “${CM.srcName}” — Shape2's white left, blue right`);
R.is(CB.src === null && CB.left && CB.left[2] > 200, "at the bottom of its list nothing masks it, so it shows whole");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
