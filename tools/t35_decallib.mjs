// The decal library's folders, against real IndexedDB and the real dialog.
//
// tools/t34_decalfolders.mjs covers the tree rules as pure functions. This covers what only a
// browser can: that the folder actually reaches storage, that a LEGACY index entry — one written
// before folders existed, with no `folder` field at all — still lists at the top level, that
// renaming and deleting rewrite what is on disk, and that the dialog draws the folders it should.
//
// Usage: node tools/t35_decallib.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  // a 2x2 png, so add() stores something a thumbnail can actually be drawn from
  function tinyPng(){
    var c = mkCanvas(2, 2), g = ctx2d(c);
    g.fillStyle = "#c33"; g.fillRect(0, 0, 2, 2);
    return canvasToBlob(c);
  }
  var png = await tinyPng();
  var rec = function(n){ return { name: n, w: 2, h: 2, surf: { sm: 20, mt: 0, em: 0, preset: "painted" }, png: png }; };

  // ---- start from a known-empty library ----
  for (var m of await DecalLib.index()) await DecalLib.remove(m.id);
  await idbSet("decalFolders", []);

  // ---- 1. saving into folders ----
  var idRaf  = await DecalLib.add(rec("raf roundel"), "Roundels/RAF");
  var idUsaf = await DecalLib.add(rec("usaf star"), "Roundels/USAF");
  var idTop  = await DecalLib.add(rec("nose art"), "");
  out.stored = (await DecalLib.index()).map(function(m){ return m.name + "@" + (m.folder == null ? "(none)" : m.folder); }).sort();
  out.foldersPersisted = (await DecalLib.folders()).slice().sort();

  // ---- 2. a LEGACY entry: index row with no folder field at all ----
  var legacy = (await DecalLib.index()).slice();
  legacy.push({ id: "legacy1", name: "old sticker", w: 2, h: 2, at: Date.now() });   // no .folder
  await idbSet("decalIndex", legacy);
  await idbSet("decal:legacy1", rec("old sticker"));
  out.legacyAtRoot = DecalTree.decalsIn(await DecalLib.index(), "").map(function(d){ return d.name; }).sort();

  // ---- 3. the folder list can be lost and still rebuild from the decals ----
  await idbSet("decalFolders", []);
  out.rebuilt = DecalTree.all(await DecalLib.folders(), await DecalLib.index());
  await idbSet("decalFolders", ["Roundels", "Roundels/RAF", "Roundels/USAF", "Empty/Shelf"]);
  out.emptyFolderNeedsList = DecalTree.all(await DecalLib.folders(), await DecalLib.index()).indexOf("Empty/Shelf") >= 0;

  // ---- 4. move, and check it is on disk ----
  await DecalLib.moveTo([idTop], "Roundels/RAF");
  var afterMove = await DecalLib.index();
  out.moved = afterMove.find(function(d){ return d.id === idTop; }).folder;
  out.rafNow = DecalTree.decalsIn(afterMove, "Roundels/RAF").map(function(d){ return d.name; }).sort();

  // ---- 5. rename, and check the subtree followed ----
  out.renamedTo = await DecalLib.renameFolder("Roundels", "Insignia");
  var afterRename = await DecalLib.index();
  out.renamedPaths = afterRename.filter(function(d){ return d.folder; }).map(function(d){ return d.folder; }).sort();
  out.renameCollision = await DecalLib.renameFolder("Insignia/RAF", "USAF");    // taken -> null
  out.renameEmpty = await DecalLib.renameFolder("Insignia/RAF", "   ");         // blank -> null

  // ---- 6. delete keeping contents ----
  await DecalLib.removeFolder("Insignia", "up");
  var afterUp = await DecalLib.index();
  out.afterUp = afterUp.filter(function(d){ return d.folder; }).map(function(d){ return d.folder; }).sort();
  out.nothingLost = afterUp.length;

  // ---- 7. delete WITH contents, and check the blobs are erased too ----
  var doomed = DecalTree.decalsIn(await DecalLib.index(), "RAF").map(function(d){ return d.id; });
  out.removedCount = await DecalLib.removeFolder("RAF", "all");
  out.blobGone = (await idbGet("decal:" + doomed[0])) == null;
  out.indexAfterAll = (await DecalLib.index()).map(function(d){ return d.name; }).sort();

  // ---- 8. the dialog renders folders, and search spans them ----
  for (var m2 of await DecalLib.index()) await DecalLib.remove(m2.id);
  await idbSet("decalFolders", []);
  await DecalLib.add(rec("raf roundel"), "Roundels/RAF");
  await DecalLib.add(rec("kill mark"), "Markings");
  await DecalLib.add(rec("nose art"), "");
  App.decalFolder = "";
  var dlg = await openDecalLibrary();
  await new Promise(function(r){ setTimeout(r, 350); });
  var grid = dlg.body.querySelector(".declib");
  out.rootFolders = Array.from(grid.querySelectorAll(".card.folder .nm")).map(function(e){ return e.textContent; });
  out.rootDecals = Array.from(grid.querySelectorAll(".card:not(.folder) .nm")).map(function(e){ return e.textContent; });
  out.crumbsAtRoot = Array.from(dlg.body.querySelectorAll(".crumbs button")).map(function(b){ return b.textContent; });
  // no innerHTML anywhere in the grid means no injection path for a decal called "<img onerror=...>"
  out.gridHasScript = /<script|onerror=/i.test(grid.innerHTML);

  // enter a folder by clicking its card
  var roundels = Array.from(grid.querySelectorAll(".card.folder")).find(function(c){ return c.querySelector(".nm").textContent === "Roundels"; });
  roundels.onclick();
  await new Promise(function(r){ setTimeout(r, 250); });
  out.crumbsInside = Array.from(dlg.body.querySelectorAll(".crumbs button")).map(function(b){ return b.textContent; });
  out.insideCards = Array.from(grid.querySelectorAll(".card .nm")).map(function(e){ return e.textContent; });
  out.remembered = App.decalFolder;

  // search from inside a folder must still find things outside it
  var search = dlg.body.querySelector("input[type=search]");
  search.value = "kill"; search.oninput();
  await new Promise(function(r){ setTimeout(r, 250); });
  out.searchHits = Array.from(grid.querySelectorAll(".card:not(.folder) .nm")).map(function(e){ return e.textContent; });
  out.searchShowsPath = Array.from(grid.querySelectorAll(".card .path")).map(function(e){ return e.textContent; });
  dlg.close();

  // ---- 9. a name with markup in it must never become markup ----
  var evil = "<img src=x onerror=alert(1)>";
  await DecalLib.add(rec(evil), "");
  App.decalFolder = "";
  var dlg2 = await openDecalLibrary();
  await new Promise(function(r){ setTimeout(r, 300); });
  var g2 = dlg2.body.querySelector(".declib");
  out.evilRenderedAsText = Array.from(g2.querySelectorAll(".card .nm")).some(function(e){ return e.textContent === evil; });
  out.evilNoImg = g2.querySelectorAll("img").length === 0;
  dlg2.close();

  // ---- 10. overwrite in place, and variants ----
  for (var m3 of await DecalLib.index()) await DecalLib.remove(m3.id);
  await idbSet("decalFolders", []);
  await DecalLib.add(rec("newest"), "");                       // saved FIRST, so it sits at the front
  var baseId = await DecalLib.add(rec("roundel"), "Roundels");
  await DecalLib.add(rec("roundel v2"), "Roundels", { base: baseId });
  await DecalLib.add(rec("roundel v3"), "Roundels", { base: baseId });
  var famIdx = await DecalLib.index();
  out.familyOrder = famIdx.map(function(d){ return d.name; });
  out.variantBases = famIdx.filter(function(d){ return d.base; }).map(function(d){ return d.base === baseId; });
  out.variantsSeen = DecalTree.variantsOf(famIdx, baseId).map(function(d){ return d.name; });

  out.updated = (await DecalLib.update(baseId, rec("roundel fixed"), "Roundels/Done")) === baseId;
  var afterEdit = await DecalLib.index();
  var baseRow = afterEdit.find(function(d){ return d.id === baseId; });
  out.updatedRow = baseRow ? baseRow.name + "@" + baseRow.folder : null;
  out.updateKeptOrder = afterEdit.map(function(d){ return d.name; });
  out.updatedBlob = (await DecalLib.get(baseId)).name;
  out.updateMissing = await DecalLib.update("nosuchid", rec("ghost"), "");
  out.updateMadeNoRow = (await DecalLib.index()).length === afterEdit.length;

  await DecalLib.remove(baseId);
  var orphans = await DecalLib.index();
  out.orphanNames = orphans.map(function(d){ return d.name; }).sort();
  out.orphanBaseCleared = orphans.every(function(d){ return d.base == null; });

  // ---- 11. clicking a card SELECTS it — it does not place it ----
  for (var m4 of await DecalLib.index()) await DecalLib.remove(m4.id);
  await idbSet("decalFolders", []);
  var starId = await DecalLib.add(rec("star"), "");
  await DecalLib.add(rec("star v2"), "", { base: starId });
  App.decalFolder = "";
  var dlg3 = await openDecalLibrary();
  await new Promise(function(r){ setTimeout(r, 400); });
  var g3 = dlg3.body.querySelector(".declib");
  var cards = Array.from(g3.querySelectorAll(".card:not(.folder)"));
  out.cardNames = cards.map(function(c){ return c.querySelector(".nm").textContent; });
  out.variantTags = cards.map(function(c){ var t = c.querySelector(".vtag"); return t ? t.textContent : ""; });
  var footBtns = function(d){ return Array.from(d.querySelectorAll(".foot button")); };
  var useBtn = footBtns(dlg3.ov).find(function(b){ return /^Use/.test(b.textContent); });
  var editBtn = footBtns(dlg3.ov).find(function(b){ return b.textContent === "Edit…"; });
  out.actionsStartDisabled = !!(useBtn.disabled && editBtn.disabled);
  cards[0].onclick();
  await new Promise(function(r){ setTimeout(r, 80); });
  out.selectedMarked = g3.querySelectorAll(".card.sel").length;
  out.dialogStillOpen = !!dlg3.ov.parentNode;
  out.actionsNowLive = !(useBtn.disabled || editBtn.disabled);
  out.useLabel = useBtn.textContent;

  // ---- 12. the editor opens with NO texture slot loaded, knowing which decal it came from ----
  out.noSlotLoaded = !App.activeSlot;
  editBtn.onclick();
  await new Promise(function(r){ setTimeout(r, 500); });
  var modals = document.querySelectorAll("#modalHost .modal");
  out.editorStacked = modals.length === 2;
  var ed = modals[modals.length - 1];
  out.editorTitle = ed.querySelector(".head h2").textContent;
  out.editorButtons = footBtns(ed).map(function(b){ return b.textContent; });
  out.editorName = ed.querySelector(".foot input[type=text]").value;
  footBtns(ed).find(function(b){ return b.textContent === "Cancel"; }).click();
  await new Promise(function(r){ setTimeout(r, 80); });
  out.editorClosedAloneCount = document.querySelectorAll("#modalHost .modal").length;

  // ---- 13. using a decal with nothing loaded leaves it on the cursor ----
  useBtn.onclick();
  await new Promise(function(r){ setTimeout(r, 500); });
  var ghost = document.getElementById("carryGhost");
  out.libraryClosed = !dlg3.ov.parentNode;
  out.carryingClass = document.body.classList.contains("carrying");
  out.ghostShown = ghost.style.display === "block";
  out.ghostLabel = ghost.querySelector(".cap").textContent;
  out.ghostHasPixels = ghost.querySelector("canvas").width > 0;
  out.heldForLater = !!(pendingDecal && pendingDecal.edited && pendingDecal.name === "star");
  // and putting it down clears every trace of it from the cursor
  DecalCarry.clear();
  out.ghostGone = ghost.style.display === "none" && !document.body.classList.contains("carrying");
  // setPlacing is the single choke point that must end a carry — check it really does
  DecalCarry.set(await blobToCanvas((await DecalLib.get(starId)).png), "star");
  setPlacing("proj");
  out.carryKeptWhileWaiting = document.body.classList.contains("carrying");
  setPlacing(false);
  out.carryEndedWithPlacing = !document.body.classList.contains("carrying");
  pendingDecal = null;

  // ---- 14. a saved decal keeps its RELIEF, image and all (ROADMAP 4.19's last gap) ----
  // "The decal library does not carry a depth map yet, so saving a decal to the library keeps the
  // image and drops the relief. The project file keeps both." Two things were being dropped, and
  // the second was the quieter one: the editor reduced an incoming Look to its PRESET NAME and
  // rebuilt it from the preset table on the way out, so the relief mode, the bevel width and the
  // invert flag went with the image — which also meant that merely OPENING a decal in the editor
  // threw its relief away.
  var depth = mkCanvas(4, 4);
  (function(){ var g = ctx2d(depth); g.fillStyle = "#000"; g.fillRect(0, 0, 4, 4);
               g.fillStyle = "#fff"; g.fillRect(1, 1, 2, 2); })();
  var relRec = { name: "riveted", w: 2, h: 2, png: png,
                 surf: { sm: 40, mt: 10, em: 12, preset: "vinyl", relief: "map", bevel: 9, heightInv: true },
                 depth: await canvasToBlob(depth), depthName: "dome.png" };
  var relId = await DecalLib.add(relRec, "Relief");
  var back = await DecalLib.get(relId);
  out.relief = {
    surf: back && back.surf ? [back.surf.relief, back.surf.bevel, back.surf.heightInv, back.surf.preset].join(",") : null,
    hasDepth: !!(back && back.depth),
    depthName: back && back.depthName,
  };
  // ...and it comes back out onto a decal layer, image and Look together.
  var slotWas14 = App.activeSlot, layerWas14 = App.activeLayer;
  var RS = { id: "t35r", size: 32, nSize: 32, layers: [], missing: false };
  RS.baseC = mkCanvas(32, 32); RS.composite = mkCanvas(32, 32);
  App.slots.set("t35r", RS); App.activeSlot = RS; App.activeLayer = null;
  DecalCarry.place(await blobToCanvas(back.png), { name: back.name, surf: back.surf,
    height: await blobToCanvas(back.depth), heightName: back.depthName });
  var RL = activeLayerObj();
  out.relief.placedMode = RL && RL.surf ? RL.surf.relief : null;
  out.relief.placedInv = !!(RL && RL.surf && RL.surf.heightInv);
  out.relief.placedMap = !!(RL && RL.heightMap);
  out.relief.placedName = RL && RL.heightName;
  // Relief.source is what actually reads it, so ask THAT rather than the field.
  out.relief.reliefResolves = !!(RL && Relief.source(RL, RL.surf));
  App.slots.delete("t35r");
  App.activeSlot = slotWas14; App.activeLayer = layerWas14;
  await DecalLib.remove(relId);

  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 700), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const eq = (got, want, m) => R.is(JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) === JSON.stringify(want) ? `${m}  →  ${JSON.stringify(got)}`
    : `${m}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);

console.log("=== storage ===");
eq(r.stored, ["nose art@", "raf roundel@Roundels/RAF", "usaf star@Roundels/USAF"], "each decal is stored with its folder");
eq(r.foldersPersisted, ["Roundels", "Roundels/RAF", "Roundels/USAF"], "saving into a nested folder persists every level of it");

console.log("\n=== an old library still works ===");
eq(r.legacyAtRoot, ["nose art", "old sticker"], "an index row with NO folder field lists at the top level");
R.is(r.rebuilt.includes("Roundels/RAF") && r.rebuilt.includes("Roundels"),
  `losing the folder list entirely still rebuilds the tree from the decals → ${JSON.stringify(r.rebuilt)}`);
R.is(r.emptyFolderNeedsList, "an EMPTY folder is the only thing that actually needs the stored list");

console.log("\n=== move / rename / delete reach disk ===");
eq(r.moved, "Roundels/RAF", "moving a decal writes its new folder to the index");
eq(r.rafNow, ["nose art", "raf roundel"], "and it lists in the target folder");
eq(r.renamedTo, "Insignia", "renameFolder returns the new path");
eq(r.renamedPaths, ["Insignia/RAF", "Insignia/RAF", "Insignia/USAF"], "the whole subtree was re-pathed on disk");
eq(r.renameCollision, null, "renaming onto a taken sibling name is refused");
eq(r.renameEmpty, null, "renaming to a blank name is refused");
eq(r.afterUp, ["RAF", "RAF", "USAF"], 'delete "keep contents" re-parents the subtree one level up');
eq(r.nothingLost, 4, "and loses no decals");
eq(r.removedCount, 2, 'delete "with contents" reports how many decals went');
R.is(r.blobGone, "and erases their stored blobs, not just the index rows");
eq(r.indexAfterAll, ["old sticker", "usaf star"], "everything outside the deleted folder survives");

console.log("\n=== the dialog ===");
eq(r.rootFolders, ["Markings", "Roundels"], "root shows its subfolders");
eq(r.rootDecals, ["nose art"], "and only the decals actually in it");
eq(r.crumbsAtRoot, ["Library"], "breadcrumbs at the root");
eq(r.crumbsInside, ["Library", "Roundels"], "breadcrumbs after entering a folder");
R.is(r.insideCards.includes("..") && r.insideCards.includes("RAF"),
  `inside a folder there is an up card and the subfolder → ${JSON.stringify(r.insideCards)}`);
eq(r.remembered, "Roundels", "the folder you are in is remembered for next time");
eq(r.searchHits, ["kill mark"], "search from inside a folder still finds a decal outside it");
eq(r.searchShowsPath, ["Markings"], "and says which folder each hit is in");

console.log("\n=== overwrite and variants ===");
eq(r.familyOrder, ["roundel", "roundel v2", "roundel v3", "newest"],
  "a variant lands beside the decal it came from, not at the front of the library");
eq(r.variantBases, [true, true], "and every variant points at the base, never at another variant");
eq(r.variantsSeen, ["roundel v2", "roundel v3"], "the family reads back off the index");
R.is(r.updated, "overwriting an existing decal keeps its id");
eq(r.updatedRow, "roundel fixed@Roundels/Done", "and rewrites its name and folder in the index");
eq(r.updateKeptOrder, ["roundel fixed", "roundel v2", "roundel v3", "newest"], "in place — the family does not reshuffle");
eq(r.updatedBlob, "roundel fixed", "the stored blob is replaced too, not just the index row");
eq(r.updateMissing, null, "overwriting a decal that is gone is refused rather than leaking a blob");
R.is(r.updateMadeNoRow, "and adds nothing to the index");
eq(r.orphanNames, ["newest", "roundel v2", "roundel v3"], "deleting a base keeps its variants");
R.is(r.orphanBaseCleared, "but they stop claiming a parent that no longer exists");

console.log("\n=== a click selects; Use and Edit are the actions ===");
eq(r.cardNames, ["star", "star v2"], "the family lists together");
eq(r.variantTags, ["1 variant", "variant of star"], "and each card says where it sits in it");
R.is(r.actionsStartDisabled, "Use and Edit are dead until something is selected");
eq(r.selectedMarked, 1, "clicking a card marks exactly one card selected");
R.is(r.dialogStillOpen, "and does NOT close the library or place the decal");
R.is(r.actionsNowLive, "Use and Edit come alive once a decal is selected");
eq(r.useLabel, "Use “star”", "and Use names what it will place");

console.log("\n=== the editor no longer needs a texture slot ===");
R.is(r.noSlotLoaded, "nothing is loaded — no model, no textures, no slot");
R.is(r.editorStacked, "Edit opens the decal editor over the library anyway");
eq(r.editorTitle, "Decal editor — star", "on the decal that was selected");
R.is(r.editorButtons.includes("Save…"), `Save is a choice when editing a saved decal → ${JSON.stringify(r.editorButtons)}`);
R.is(r.editorButtons.includes("Use this decal"), "and it can still be used straight from there");
eq(r.editorName, "star", "the name is prefilled from the stored record");
eq(r.editorClosedAloneCount, 1, "closing the editor leaves the library open behind it");

console.log("\n=== a decal picked with nothing loaded waits on the cursor ===");
R.is(r.libraryClosed, "using a decal closes the library");
R.is(r.carryingClass, "and the pointer says it is carrying something");
R.is(r.ghostShown, "the ghost is visible");
eq(r.ghostLabel, "star", "and names the decal in hand");
R.is(r.ghostHasPixels, "with the decal actually drawn in it");
R.is(r.heldForLater, "the decal is held, not thrown away with an error");
R.is(r.ghostGone, "putting it down clears the ghost and the cursor state");
R.is(r.carryKeptWhileWaiting, 'a "proj" placing mode keeps the carry — that is what it is waiting for');
R.is(r.carryEndedWithPlacing, "and leaving placing mode ends it, so nothing can strand the ghost");

console.log("\n=== names are data, never markup ===");
R.is(!r.gridHasScript, "the grid contains no script or inline handler");
R.is(r.evilRenderedAsText, "a decal named with an HTML tag renders as literal text");
R.is(r.evilNoImg, "and creates no element from it");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
console.log("\n=== a saved decal keeps its relief (4.19's last gap) ===");
const RE = r.relief;
console.log(`   stored surf ${RE.surf} · depth ${RE.hasDepth} "${RE.depthName}" · placed ${RE.placedMode}/${RE.placedInv}, map ${RE.placedMap}`);
R.is(RE.surf === "map,9,true,vinyl",
  `the relief mode, bevel width and invert flag survive the round trip through storage (${RE.surf}) — they ride inside surf, which the editor used to reduce to its preset NAME and rebuild from the preset table, so merely opening a decal threw them away`);
R.is(RE.hasDepth && RE.depthName === "dome.png",
  `and so does the depth image itself (${RE.depthName}), which the library carried nowhere at all`);
R.is(RE.placedMode === "map" && RE.placedInv && RE.placedMap && RE.placedName === "dome.png",
  `using it puts both back on the decal layer (${RE.placedMode}, inverted ${RE.placedInv}, map ${RE.placedMap})`);
R.is(RE.reliefResolves,
  "and Relief.source finds it — asked of the thing that actually reads it rather than of the field, because a mode of “map” with no map falls back to the outline and would look like it worked");

R.finish();
