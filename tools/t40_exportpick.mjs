// Choosing which textures an export includes (ROADMAP 4.5), against the real page.
//
// The reason this is a test and not just a checkbox: CLAUDE.md §1 requires the archive and the
// `.blk` to describe each other in BOTH directions — the archive holds only textures the `.blk`
// names, and the `.blk` names only textures the archive holds. So leaving a texture out has to drop
// its `set_tex` / `replace_tex` line with it. Dropping only the file produces a skin War Thunder
// rejects, and the app's own validator would (correctly) refuse it — which is exactly the bug this
// guards against, since the file list and the `.blk` are built by two different functions.
//
// The other claim measured here is that an unticked texture costs nothing: `collectExports` must
// drop it BEFORE reading its pixels, or "leave the 4K sheet out while I iterate on the small one"
// still pays for the 4K sheet. That is measured by handing the excluded slot a composite that
// records every getContext() call rather than by reasoning about the code.
//
// Since 2026-10-10 it also drives "To War Thunder" (section 8b): a game folder opened another way
// gets the .zip offered with no picker up front, and the folder can still be chosen from that dialog
// (an install off Program Files is writable); what the picker hands back is asked what it is — the
// install root or a folder above it gives its own UserSkins, anything else is refused and can be chosen
// again; a cancelled or missing picker offers the zip too; and stand-in real folders that log every
// create and write show the export touches UserSkins/<name>/ only.
//
// Usage: node tools/t40_exportpick.mjs [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var W = 512;                                    // a legal side (CLAUDE.md §1: 128…4096, po2)

  // A slot the export pipeline accepts: an edited albedo and an edited surface map, so each one
  // contributes exactly one item and the two can be ticked independently.
  var reads = [];
  function mkSlot(id){
    var mk = function(){ var c = document.createElement("canvas"); c.width = c.height = W; return c; };
    // A real canvas with a recording getContext, so everything downstream still works on it and a
    // read is measured rather than reasoned about. Recording, not throwing: a miss has to be
    // reported as a failed assertion, not as a crashed test.
    var comp = mk(), real = comp.getContext.bind(comp);
    comp.getContext = function(k){ reads.push(id + ":c"); return real(k); };
    return { id: id, cStem: id + "_c", cFileName: id + "_c.dds", nStem: id + "_n", nFileName: id + "_n.dds",
      layers: [], composite: comp, baseC: mk(), cEdited: true, nEdited: true,
      smooth: mk(), metal: mk(), normal: mk(),
      size: W, sizeH: W, nSize: W, missing: false };
  }
  var slots = ["hull", "turret", "gun"].map(mkSlot);
  var savedSlots = App.slots, savedUnits = App.skinUnits;
  App.slots = new Map(slots.map(function(s){ return [s.id, s]; }));
  App.skinUnits = [{ unit: { id: "test_unit", name: "Test", cls: "air", country: "" }, score: 100, on: true }];
  var opt = function(id, kind){ return expOpt(App.slots.get(id), kind); };
  var names = function(items){ return items.map(function(i){ return i.fileNameBase + "." + i.kind; }); };
  var blkTo = function(items){
    var t = buildExportPlan(items, { estimate: true }).blkText, o = [], m;
    var re = /\\bto:t\\s*=\\s*"([^"]*)"/g;
    while ((m = re.exec(t))) o.push(m[1]);
    return o;
  };
  var errIds = function(items){
    return validateExport(buildExportPlan(items, { estimate: true }))
      .filter(function(r){ return r.level === "error"; }).map(function(r){ return r.id; });
  };
  var bytes = function(items){
    return buildExportPlan(items, { estimate: true }).items
      .reduce(function(n, i){ return n + (i.bytes || 0); }, 0);
  };
  var listState = function(){
    updateExportList();
    var rows = [].slice.call(document.querySelectorAll("#expList .exprow"));
    return {
      rows: rows.length,
      ticked: rows.filter(function(r){ return r.querySelector("input[type=checkbox]").checked; }).length,
      disabled: rows.filter(function(r){ return r.querySelector("select").disabled; }).length,
      count: document.getElementById("expCount").textContent,
      btn: document.getElementById("expAllNone").textContent,
      summary: (document.querySelector("#expList .hint") || {}).textContent || "",
    };
  };

  try {
    // ---- 1. baseline: six textures, everything in ----
    out.allPreview = names(collectExports(true));
    out.allReal = names(collectExports(false));
    out.allBlk = blkTo(collectExports(false));
    out.allErrs = errIds(collectExports(false));
    out.bytesAll = bytes(collectExports(false));
    out.baseState = listState();

    // ---- 2. a normal-map-only skin: drop hull's albedo, keep its _n ----
    // Legal and sometimes wanted, and the reason this is per texture and not per slot.
    reads.length = 0;
    opt("hull", "c").off = true;
    out.nOnlyReal = names(collectExports(false));
    out.nOnlyBlk = blkTo(collectExports(false));
    out.nOnlyErrs = errIds(collectExports(false));
    out.nOnlyReads = reads.slice();                 // must NOT contain hull:c
    out.nOnlyPreviewOff = collectExports(true).filter(function(i){ return i.off; })
      .map(function(i){ return i.fileNameBase + "." + i.kind; });

    // ---- 3. and the other way round: drop a surface map, keep its albedo ----
    opt("turret", "n").off = true;
    out.twoOutReal = names(collectExports(false));
    out.twoOutBlk = blkTo(collectExports(false));
    out.twoOutErrs = errIds(collectExports(false));
    out.bytesTwoOut = bytes(collectExports(false));
    out.twoOutState = listState();

    // ---- 5. all / none ----
    document.getElementById("expAllNone").onclick();
    out.noneState = listState();
    out.noneReal = names(collectExports(false));
    document.getElementById("expAllNone").onclick();
    out.allBackState = listState();

    // ---- 6. exporting with nothing ticked must say WHY, not "paint something" ----
    for (var i = 0; i < slots.length; i++) { opt(slots[i].id, "c").off = true; opt(slots[i].id, "n").off = true; }
    await doExport(false);
    out.emptyStatus = document.getElementById("status").textContent;

    // ---- 7. the per-texture choices survive a save/load round trip ----
    // They were lost on every save before this, resolution and format included.
    for (var i = 0; i < slots.length; i++) { opt(slots[i].id, "c").off = false; opt(slots[i].id, "n").off = false; }
    opt("hull", "c").off = true;
    opt("turret", "n").size = 256;
    opt("gun", "c").fmt = "tga";
    var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };   // capture instead of download
    HTMLAnchorElement.prototype.click = function(){};
    try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
    out.saved = !!blob;
    for (var i = 0; i < slots.length; i++) slots[i].exp = {};             // wipe, so a pass means it was read back
    await loadProject(blob);
    out.rtHullOff = opt("hull", "c").off;
    out.rtHullNOff = opt("hull", "n").off;
    out.rtTurretSize = opt("turret", "n").size;
    out.rtGunFmt = opt("gun", "c").fmt;
    out.rtReal = names(collectExports(false));

    // ---- 8. what a real export actually WRITES (ROADMAP 2.4's oracle for doExport) ----
    // Nothing in the suite had ever run the export pipeline end to end. t29 checks the encoders
    // against golden bytes, t30 the validator, t49 which .blk a family gets and t33 that the worker
    // and the main thread agree — but the function that ties all of those together, doExport, was
    // covered only by a source-TEXT check that greps its body for the order of two calls. That is
    // exactly the shape of coverage §4 warns about before a split: it would survive the refactor
    // being wrong and would fail on the refactor being right.
    //
    // So this drives the whole thing down the .zip path, which needs no directory handle, and reads
    // the archive back. What it asserts is the archive's CONTRACT: one folder named for the skin,
    // one file per ticked texture, one .blk per selected vehicle, and the .blk naming exactly the
    // textures that are in the zip — CLAUDE.md §1's archive/.blk symmetry, checked against the real
    // bytes rather than against a plan.
    // Back to the plain state first — section 7 left a .tga format and a 256 resize behind, and this
    // case is about WHAT is written rather than in which format.
    for (var i = 0; i < slots.length; i++) { slots[i].exp = {}; }
    opt("gun", "n").off = true;                       // one out, so "exactly what is ticked" can fail
    document.getElementById("skinName").value = "zip probe";
    var zipBlob = null, realCOU2 = URL.createObjectURL, realClick2 = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function(b){ zipBlob = b; return "blob:stub"; };
    HTMLAnchorElement.prototype.click = function(){};
    try { await doExport(false); } finally { URL.createObjectURL = realCOU2; HTMLAnchorElement.prototype.click = realClick2; }
    out.zip = { made: !!zipBlob, said: document.getElementById("status").textContent };
    if (zipBlob) {
      var z = await JSZip.loadAsync(zipBlob);
      var paths = [];
      z.forEach(function(rel, f){ if (!f.dir) paths.push(rel); });
      paths.sort();
      out.zip.paths = paths;
      var blkPath = paths.find(function(p){ return /\.blk$/.test(p); });
      out.zip.blk = blkPath ? await z.file(blkPath).async("string") : "";
      var named = [], m2, re2 = /"([A-Za-z0-9_\-]+\.(?:dds|tga))"/g;
      while ((m2 = re2.exec(out.zip.blk))) if (named.indexOf(m2[1]) < 0) named.push(m2[1]);
      out.zip.named = named.sort();
      out.zip.textures = paths.filter(function(p){ return /\.(dds|tga)$/.test(p); })
        .map(function(p){ return p.split("/").pop(); }).sort();
    }

    // ---- 8b. "To War Thunder", with and without a folder it may write to (2026-10-10) ----
    // Same skin as 8, now down the folder path. The dialog, the picker, IndexedDB and the download
    // are stand-ins that record what they were asked; the encode, the .blk and the write loop are
    // the real ones. A REAL handle is stood in for by a tree that logs every folder it creates and
    // every file it writes, by path — which is what lets CLAUDE.md §0.4 be read off the log.
    var keep8 = { cd: choiceDialog, pick: window.showDirectoryPicker, get: idbGet, set: idbSet, game: App.gameDir,
                  ush: App.userSkinsHandle, usd: App.userSkinsDir, dh: App.dirHandle,
                  cou: URL.createObjectURL, click: HTMLAnchorElement.prototype.click };
    // "answer" is what every dialog answers, or a list answered in turn; "grant" is the folder a
    // picker hands over, and with none it aborts — which is what Chrome does under Program Files.
    var asked = [], offered = [], picks = [], stored = {}, zipped = null, answer = "zip", wlog = [], grant = null;
    var fakeDir = function(name, path){
      var dirs = {}, files = {}, at = function(n){ return (path ? path + "/" : "") + n; };
      return { kind: "directory", name: name,
        _put: function(n, h){ dirs[n] = h; },          // a child built elsewhere, so its log paths start where the test wants
        queryPermission: async function(){ return "granted"; }, requestPermission: async function(){ return "granted"; },
        getDirectoryHandle: async function(n, o){
          if (!dirs[n]) {
            if (!(o && o.create)) throw new DOMException("no " + n, "NotFoundError");
            wlog.push("mkdir " + at(n)); dirs[n] = fakeDir(n, at(n));
          }
          return dirs[n];
        },
        getFileHandle: async function(n, o){
          if (!files[n]) {
            if (!(o && o.create)) throw new DOMException("no " + n, "NotFoundError");
            wlog.push("touch " + at(n));
            files[n] = { kind: "file", name: n, createWritable: async function(){
              return { write: async function(d){ wlog.push("write " + at(n) + " " + (d.byteLength || 0)); }, close: async function(){} }; } };
          }
          return files[n];
        } };
    };
    var exp = async function(){
      asked = []; offered = []; picks = []; zipped = null; wlog = []; App.dirHandle = null; App.userSkinsHandle = null; App.userSkinsDir = null;
      document.getElementById("status").textContent = "";
      await doExport(true);
      return { asked: asked.slice(), offered: offered.slice(), picks: picks.slice(), zip: !!zipped,
               said: document.getElementById("status").textContent, log: wlog.slice() };
    };
    window.choiceDialog = async function(msg, choices){
      asked.push(msg); offered.push((choices || []).map(function(c){ return c.label; }));
      return Array.isArray(answer) ? answer.shift() : answer;
    };
    // A list of grants is handed over in turn; an item that is not a folder is thrown, as Chrome throws.
    var picker = async function(o){
      picks.push(o || {});
      var g = Array.isArray(grant) ? grant.shift() : grant;
      if (g && g.kind !== "directory") throw g;
      if (g) return g;
      throw new DOMException("The user aborted a request.", "AbortError");
    };
    window.showDirectoryPicker = picker;
    window.idbGet = async function(k){ return stored[k]; };
    window.idbSet = async function(k, v){ stored[k] = v; };
    URL.createObjectURL = function(b){ zipped = b; return "blob:stub"; };
    HTMLAnchorElement.prototype.click = function(){};
    try {
      // (1) the install was opened another way — Program Files, so most testers. No picker, the zip at once.
      App.gameDir = ListedDir.handle(ListedDir.node("War Thunder"));
      answer = "zip";  out.legacyZip = await exp();
      answer = "cancel"; out.legacyNo = await exp();
      // (1b) …but opened another way is not always Program Files: an install elsewhere (a Steam library on D:)
      // can be written, so the same dialog lets the UserSkins folder be chosen — and when the picker
      // hands it over, the skin goes straight in. When it is refused, the zip is offered again.
      grant = fakeDir("UserSkins", "UserSkins");
      answer = ["choose"]; out.legacyChoose = await exp();
      out.legacyChoose.remembered = stored.userSkinsDir === grant;
      grant = null; stored = {};
      answer = ["choose", "zip"]; out.legacyChooseNo = await exp();
      // (1c) …and that picker opens IN the install (startIn), so pressing its button at once hands over
      // the install root, not UserSkins. The root is the install: the skin goes into ITS UserSkins —
      // never War Thunder/<name>/, where the game never looks — and UserSkins is what is remembered,
      // or every later export would write there too (review of the second round, 2026-10-10).
      var root = fakeDir("War Thunder", "");
      await root.getFileHandle("aces.vromfs.bin", { create: true });
      stored = { gameDir: root }; grant = root;
      answer = ["choose"]; out.rootPick = await exp();
      out.rootPick.start = !!out.rootPick.picks[0] && out.rootPick.picks[0].startIn === root;
      out.rootPick.remembered = !!stored.userSkinsDir && stored.userSkinsDir === await root.getDirectoryHandle("UserSkins").catch(function(){ return null; });
      // (1d) a folder ABOVE the install — common — finds it by name, as the game-folder picker does
      var common = fakeDir("common", "common"), wt2 = fakeDir("War Thunder", "");
      await wt2.getFileHandle("aces.vromfs.bin", { create: true });
      common._put("War Thunder", wt2);
      App.gameDir = null; stored = {}; grant = common;
      answer = "replace"; out.abovePick = await exp();
      out.abovePick.remembered = !!stored.userSkinsDir && stored.userSkinsDir === await wt2.getDirectoryHandle("UserSkins").catch(function(){ return null; });
      // (1e) a folder that is neither — inside the install, or anywhere else — is not written into or
      // remembered; the dialog says what it is, and the folder can be chosen again from it
      var us3 = fakeDir("UserSkins", "UserSkins");
      stored = {}; grant = [fakeDir("content", "content"), us3];
      answer = ["choose"]; out.wrongPick = await exp();
      out.wrongPick.remembered = stored.userSkinsDir === us3;
      stored = {}; grant = fakeDir("Documents", "Documents");
      answer = "cancel"; out.wrongNo = await exp();
      out.wrongNo.remembered = "userSkinsDir" in stored;
      // (1f) a picker that throws because the click's activation ran out (3.21's "Must be handling a
      // user gesture") can be put up again from the dialog's own, fresh click
      stored = {}; grant = [new DOMException("Must be handling a user gesture to show a file picker.", "SecurityError"), fakeDir("UserSkins", "UserSkins")];
      answer = ["choose"]; out.lateRetry = await exp();
      grant = null; stored = {};
      // (2) no game folder this session, one remembered from the last, and the picker cancelled
      App.gameDir = null; stored.gameDir = fakeDir("War Thunder", "");
      answer = "zip"; out.cancelZip = await exp();
      out.cancelZip.start = out.cancelZip.picks[0] && out.cancelZip.picks[0].startIn === stored.gameDir;
      answer = "cancel"; out.cancelNo = await exp();
      // (3) no folder picker in this browser at all
      window.showDirectoryPicker = undefined; stored = {};
      answer = "zip"; out.noPicker = await exp();
      // (3b) …which is where every game folder was opened another way: there is no picker to blame
      // Program Files for, so it is the browser's answer that is given, and its status on cancel
      App.gameDir = ListedDir.handle(ListedDir.node("War Thunder"));
      answer = "zip"; out.noPickerLegacy = await exp();
      answer = "cancel"; out.noPickerLegacyNo = await exp();
      App.gameDir = null;
      window.showDirectoryPicker = picker;
      // (4) a real game folder: UserSkins is found (made, if it is not there) and written, nothing else
      var game = fakeDir("War Thunder", "");
      App.gameDir = game; stored = {};
      answer = "replace"; out.real = await exp();
      out.real.remembered = !!stored.userSkinsDir && stored.userSkinsDir === await game.getDirectoryHandle("UserSkins");
      // (5) a later visit: no game folder open, the UserSkins folder remembered — no picker, same place
      App.gameDir = null;
      out.later = await exp();
    } finally {
      window.choiceDialog = keep8.cd; window.showDirectoryPicker = keep8.pick; window.idbGet = keep8.get; window.idbSet = keep8.set;
      App.gameDir = keep8.game; App.userSkinsHandle = keep8.ush; App.userSkinsDir = keep8.usd; App.dirHandle = keep8.dh;
      URL.createObjectURL = keep8.cou; HTMLAnchorElement.prototype.click = keep8.click;
    }
    for (var i = 0; i < slots.length; i++) { slots[i].exp = {}; }
    // ---- 9. what a sheet nothing on the model uses is CALLED (ROADMAP 4.13/4.14) ----
    // slotRole decides whether a texture is a cockpit or an engine-flame sheet, which is the one
    // publishing rule the CDK states as a flat prohibition. It asked the GEOMETRY, and returned
    // "exterior" when the geometry classified nothing — "do not cry wolf", which was right while
    // every slot came from a material on the model. It is not right for a sheet loaded BY NAME:
    // Vehicle > search > ->slot and Paste as layer both reach one, and 4.13's sweep made that
    // concrete by finding jet_flame_diamonds in a pack the app already indexes. So a slot no
    // triangle uses now falls back to the name, and only then.
    var roleWas = { geo: App.geomData, mat: App.matSlot };
    var roleOf = function(id, cStem){
      var sl = { id: id, cStem: cStem, nStem: null };
      App.slots.set(id, sl);
      var r = slotRole(sl);
      App.slots.delete(id);
      return r;
    };
    // A model whose one material is bound to "hull" — so "hull" has geometry and nothing else does.
    App.geomData = [{ name: "body", mat: "hull_mat", position: new Float32Array(9), weapon: false, skinned: false }];
    App.matSlot = new Map([["hull_mat", "hull"]]);
    out.role = {
      onModel: roleOf("hull", "hull_c"),
      flameByName: roleOf("jet_flame_diamonds", "jet_flame_diamonds"),
      atlasByName: roleOf("afterburneratlastex", "afterburneratlastex"),
      cockpitByName: roleOf("f_4e_cockpit", "f_4e_cockpit_c"),
      ordinaryByName: roleOf("some_camo", "some_camo_c"),
      exhaustNotFlagged: roleOf("ju_87d_3_italy_exhaust", "ju_87d_3_italy_exhaust_c"),
    };
    App.geomData = roleWas.geo; App.matSlot = roleWas.mat;

    // ---- 10. what collectExports puts IN the pixels (ROADMAP 2.4's oracle for it) ----
    // Sections 1-9 are all about WHICH textures come out and what the .blk says about them. Not one
    // of them reads a single byte collectExports writes, and the decisions it makes there are the
    // ones CLAUDE.md §1 is strictest about: what the albedo's ALPHA means (the "why is my Abrams
    // flatly repainted" trap), the _n's channel packing, and the post-2022 inverted-roughness curve.
    // Every channel below carries a DIFFERENT value, so a swapped one reads as a wrong number rather
    // than as a plausible one.
    var P = 8;
    var flat = function(r, g, b, a){
      var c = document.createElement("canvas"); c.width = c.height = P;
      var x = c.getContext("2d"), d = x.createImageData(P, P);
      for (var q = 0; q < P * P; q++) { d.data[q*4] = r; d.data[q*4+1] = g; d.data[q*4+2] = b; d.data[q*4+3] = a === undefined ? 255 : a; }
      x.putImageData(d, 0, 0);
      return c;
    };
    var cov = new Uint8Array(P * P);
    for (var q = 0; q < P * P; q++) cov[q] = q < P * P / 2 ? 255 : 64;   // top half covered, bottom half not
    var pxSlot = { id: "px", cStem: "px_c", cFileName: "px_c.dds", nStem: "px_n", nFileName: "px_n.dds",
      layers: [], composite: flat(200, 60, 20), baseC: flat(200, 60, 20), covBase: cov,
      cEdited: true, nEdited: true,
      smooth: flat(100, 100, 100), metal: flat(210, 210, 210), normal: flat(30, 180, 128),
      size: P, sizeH: P, nSize: P, missing: false, exp: {} };
    App.slots = new Map([["px", pxSlot]]);
    var alphaSel = document.getElementById("expAlpha"), modeSel = document.getElementById("expMode");
    var invBox = document.getElementById("optInvRough");
    var alphaWas = alphaSel.value, modeWas = modeSel.value, invWas = invBox.checked;
    var pick = function(kind, preview){
      var got = collectExports(!!preview).filter(function(i){ return i.kind === kind; });
      return got[0];
    };
    var shot = function(alpha, mode){
      alphaSel.value = alpha; modeSel.value = mode;
      var it = pick("c");
      return { note: it.covNote, top: it.rgba[3], bottom: it.rgba[(P * P - 1) * 4 + 3],
               rgb: [it.rgba[0], it.rgba[1], it.rgba[2]] };
    };
    out.alpha = {
      groundAuto: shot("auto", "set_tex"),       // set_tex ADDS a paint sheet — its alpha is not a mask
      airAuto:    shot("auto", "replace_tex"),   // replace_tex REPLACES the sheet — the mask must survive
      groundKeep: shot("keep", "set_tex"),       // the user overriding "auto" the other way
      airOpaque:  shot("opaque", "replace_tex"),
    };
    // A hand-painted wear mask is an explicit instruction and outranks both switches.
    var wearC = flat(11, 11, 11);
    pxSlot.chanC = { wear: flat(11, 11, 11) };
    pxSlot.layers = [LayerNode.of({ type: "paint", chan: "wear", name: "wear", canvas: wearC,
      visible: true, opacity: 1, blend: "normal" })];
    out.alpha.painted = shot("opaque", "set_tex");
    pxSlot.layers = []; pxSlot.chanC = null;
    alphaSel.value = alphaWas; modeSel.value = modeWas;

    // The _n is four channels of three sheets, and CLAUDE.md §1 is the only reason the order is what
    // it is. R = inverted roughness (from smooth), G = normal X, B = metallicity, A = normal Y.
    invBox.checked = true;                                    // the game's own form: pass through
    var nPass = pick("n");
    invBox.checked = false;                                   // "I authored plain smoothness"
    var nConv = pick("n");
    invBox.checked = invWas;
    out.surf = {
      pass: [nPass.rgba[0], nPass.rgba[1], nPass.rgba[2], nPass.rgba[3]],
      conv: [nConv.rgba[0], nConv.rgba[1], nConv.rgba[2], nConv.rgba[3]],
      w: nPass.w, h: nPass.h,
    };

    // The per-texture resolution and format overrides, which are applied last and only on the real
    // path — the preview must still report the sheet's own size, or the list lies about what is
    // being edited.
    pxSlot.exp = {};
    expOpt(pxSlot, "c").size = 4;
    expOpt(pxSlot, "c").fmt = "tga";
    var small = pick("c"), prev = pick("c", true);
    out.override = { w: small.w, h: small.h, bytes: small.rgba.length, resized: !!small.resized,
                     fmt: small.fmtOverride, previewW: prev.w, previewResized: !!prev.resized };
    pxSlot.exp = {};

  } finally {
    App.slots = savedSlots; App.skinUnits = savedUnits;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 700), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = v => JSON.stringify(v);
const eq = (got, want, m) => R.is(J(got) === J(want),
  J(got) === J(want) ? `${m}  →  ${J(got)}`
    : `${m}\n         got  ${J(got)}\n         want ${J(want)}`);

console.log("=== everything ticked ===");
eq(r.allPreview, ["hull_c.c", "hull_n.n", "turret_c.c", "turret_n.n", "gun_c.c", "gun_n.n"],
  "six edited textures, albedo and surface map for each");
eq(r.allReal, r.allPreview, "the real path lists the same six");
eq(r.allBlk.slice().sort(), ["gun_c.dds", "gun_n.dds", "hull_c.dds", "hull_n.dds", "turret_c.dds", "turret_n.dds"],
  "and the .blk names all six");
eq(r.allErrs, [], "no publishing rule is broken");
eq([r.baseState.rows, r.baseState.ticked, r.baseState.count], [6, 6, "6"], "the panel shows six rows, all ticked");

console.log("\n=== a normal-map-only skin: hull albedo out, hull _n in ===");
eq(r.nOnlyReal, ["hull_n.n", "turret_c.c", "turret_n.n", "gun_c.c", "gun_n.n"], "the albedo is gone from the file list");
R.is(!r.nOnlyBlk.includes("hull_c.dds"), "and its set_tex/replace_tex line went with it — the .blk does not name it");
R.is(r.nOnlyBlk.includes("hull_n.dds"), "while the surface map it belongs to is still named, which is the point of per-texture");
eq(r.nOnlyErrs, [], "the .blk and the archive still describe each other exactly (no blkrefs error)");
R.is(!r.nOnlyReads.includes("hull:c"),
  "and nothing read the excluded sheet's pixels — the whole reason to untick a 4K texture");
R.is(r.nOnlyReads.includes("turret:c") && r.nOnlyReads.includes("gun:c"),
  `while the ticked albedos were read, which is what says the instrument is live → ${J(r.nOnlyReads)}`);
eq(r.nOnlyPreviewOff, ["hull_c.c"], "the preview list still carries the row, tagged off, so it can be ticked back on");

console.log("\n=== and the reverse: turret surface map out, its albedo in ===");
eq(r.twoOutReal, ["hull_n.n", "turret_c.c", "gun_c.c", "gun_n.n"], "four textures left");
eq(r.twoOutBlk.slice().sort(), ["gun_c.dds", "gun_n.dds", "hull_n.dds", "turret_c.dds"], "the .blk names exactly those four");
eq(r.twoOutErrs, [], "still no rule broken");
eq([r.twoOutState.rows, r.twoOutState.ticked, r.twoOutState.disabled, r.twoOutState.count],
  [6, 4, 2, "4 of 6"], "six rows, four ticked, the two excluded have their size/format controls disabled");
R.is(/2 left out/.test(r.twoOutState.summary), `the footer says how many are out → ${J(r.twoOutState.summary)}`);

console.log("\n=== the size estimate follows the ticks ===");
R.is(r.bytesTwoOut > 0 && r.bytesTwoOut < r.bytesAll,
  `unticking two textures lowers the archive estimate (${(r.bytesAll / 1048576).toFixed(2)} MB → ${(r.bytesTwoOut / 1048576).toFixed(2)} MB)`);

console.log("\n=== all / none ===");
eq([r.noneState.ticked, r.noneState.count, r.noneState.btn], [0, "0 of 6", "All"],
  "None unticks every row and the button flips to All");
eq(r.noneReal, [], "and the export would contain no textures");
R.is(/Nothing ticked/.test(r.noneState.summary), `the footer says so rather than showing 0.0 MB → ${J(r.noneState.summary)}`);
eq([r.allBackState.ticked, r.allBackState.count, r.allBackState.btn], [6, "6", "None"], "All puts every row back");

console.log("\n=== exporting with nothing ticked ===");
R.is(/unticked/.test(r.emptyStatus || ""),
  `says the textures are unticked rather than "paint something" → ${J(r.emptyStatus)}`);

console.log("\n=== the choices survive a .wtproj round trip ===");
R.is(r.saved, "the project was written");
R.is(r.rtHullOff === true, "the unticked albedo comes back unticked");
R.is(r.rtHullNOff === false, "and its surface map, which was left ticked, comes back ticked");
R.is(r.rtTurretSize === 256, `a per-texture resolution override survives too → ${r.rtTurretSize}`);
R.is(r.rtGunFmt === "tga", `and a per-texture format → ${J(r.rtGunFmt)}`);
eq(r.rtReal, ["hull_n.n", "turret_c.c", "turret_n.n", "gun_c.c", "gun_n.n"],
  "so the restored project exports exactly what it exported before it was saved");

// ---- ROADMAP 3.21: the folder is asked for BEFORE the encode ----
// `showDirectoryPicker` needs transient user activation, which expires a few seconds after the
// click. It used to be called after `encodeAllTextures` — a BC3 encode of every edited sheet across
// the worker pool — so the first export raced the encode against the click expiring and lost often
// enough to be reported. The second attempt succeeded because the pool was warm.
//
// This is a SOURCE-order check rather than a behavioural one, and it is worth being clear about what
// that does and does not cover: it catches the exact regression (the picker drifting back below the
// encode) and it does NOT catch someone introducing a different slow await above it. The fake
// directory handle deep enough to satisfy the whole write path exists since 2026-10-10 (section 8b,
// for the zip offer and §0.4); the ordering is still read here, because activation is the one thing
// a stand-in picker cannot expire.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pipeline = fs.readFileSync(path.join(ROOT, "src/export/pipeline.js"), "utf8");
const fn = pipeline.slice(pipeline.indexOf("async function doExport("));
// The picker itself lives in getUserSkinsHandle now — one function that finds-or-asks, which is a
// great deal harder to call too late than two that have to be called in the right order. So what
// doExport has to get right is that it settles the folder before it starts encoding.
//
// Read off `doExport` itself, which since ROADMAP 2.4 split it is a list of nine phase calls: the
// ordering IS two adjacent lines there. It used to be two call sites 60 lines apart inside a
// 158-line function, and this check had to grep the whole body for them — which is a check that
// would survive the split being wrong and fail on it being right, and did.
const atPick = fn.indexOf("ExportRun.folder(");
const atEncode = fn.indexOf("ExportRun.encode(");
const runSrc = pipeline.slice(pipeline.indexOf("const ExportRun = {"), pipeline.indexOf("async function doExport("));
const asksInFinder = /showDirectoryPicker\(\{[\s\S]{0,400}?wtuserskins/.test(
  pipeline.slice(pipeline.indexOf("async function getUserSkinsHandle("), pipeline.indexOf("async function doExport(")));
console.log("\n=== the export folder is asked for while the click is still fresh (3.21) ===");
R.is(atPick >= 0 && atEncode >= 0, "doExport still settles the folder and still encodes");
R.is(/await getUserSkinsHandle\(/.test(runSrc) && /await encodeAllTextures\(/.test(runSrc),
  "and the two phases really do those two things — the names could otherwise drift away from the calls they stand for");
R.is(asksInFinder, "and the picker lives in getUserSkinsHandle, beside every other way of finding that folder");
R.is(atPick < atEncode,
  `the folder is settled BEFORE the encode (char ${atPick} against ${atEncode}) — after it, the click's transient activation has expired and the first export of a session fails with "Must be handling a user gesture"`);
R.is(/Export cancelled — no folder chosen/.test(runSrc),
  "and declining the picker is reported as a cancellation rather than as a failure — now that it comes first, changing your mind costs nothing");

console.log("\n=== what a real export actually writes (the oracle doExport had none of) ===");
const Z = r.zip;
console.log(`   ${Z.said}`);
console.log(`   ${J(Z.paths)}`);
R.is(Z.made, "the .zip path runs end to end and produces an archive — nothing in the suite had ever run doExport past its first refusal");
R.is(Z.paths.every(p => p.startsWith("zip_probe/")),
  "everything is inside one folder named for the skin, with the name sanitised — the game reads UserSkins/<name>/, so a file at the root of the zip installs nowhere");
eq(Z.textures, ["gun_c.dds", "hull_c.dds", "hull_n.dds", "turret_c.dds", "turret_n.dds"],
  "one file per TICKED texture and no others — gun_n was unticked, and unticking is what stops a 4K sheet being encoded at all");
R.is(Z.paths.filter(p => /\.blk$/.test(p)).length === 1,
  "one .blk, for the one selected vehicle — the count is per unit, which is what an F-4E skin doing nothing on an F-4EJ was");
eq(Z.named, Z.textures,
  "and the .blk names exactly the textures the archive contains — CLAUDE.md §1's archive/.blk symmetry, checked against the real bytes rather than against the plan the validator saw");

console.log("\n=== \"To War Thunder\" never dead-ends (2026-10-10) ===");
const show = (k, o) => console.log(`   ${k.padEnd(10)} picks ${o.picks.length} · zip ${o.zip} · asked ${J(o.asked.map(a => a.split("\n")[0].slice(0, 60)))} · "${o.said}"`);
for (const k of ["legacyZip", "legacyNo", "legacyChoose", "legacyChooseNo", "rootPick", "abovePick", "wrongPick", "wrongNo", "lateRetry", "cancelZip", "cancelNo", "noPicker", "noPickerLegacy", "noPickerLegacyNo", "real", "later"])
  show(k, r[k]);
const writes = o => o.log.filter(l => /^write /.test(l)).map(l => l.split(" ")[1]).sort();
const want = Z.paths.map(p => "UserSkins/" + p).sort();
const strays = o => o.log.filter(l => !/^(mkdir UserSkins(\/zip_probe)?|touch UserSkins\/zip_probe\/[^/ ]+|write UserSkins\/zip_probe\/[^/ ]+ \d+)$/.test(l));
R.is(r.legacyZip.picks.length === 0 && r.legacyZip.asked.length === 1 && /opened another way/.test(r.legacyZip.asked[0])
  && /Program Files/.test(r.legacyZip.asked[0]) && /Download it as a \.zip instead\?/.test(r.legacyZip.asked[0]),
  "a game folder opened another way (every Program Files install) puts up NO picker Chrome would refuse — it says why at once and offers the zip");
R.is(r.legacyZip.zip && /^Zip ready/.test(r.legacyZip.said),
  `…and taking the offer downloads the skin as a .zip, from the same click (${r.legacyZip.said}) — it used to end at "Export cancelled — no folder chosen"`);
R.is(!r.legacyNo.zip && r.legacyNo.picks.length === 0 && r.legacyNo.said === "Export cancelled",
  `declining it writes nothing and says so (${r.legacyNo.said})`);
// Opened another way is how a Program Files install gets in, but not proof of one: an install on
// another drive can be opened that way too, and Chrome WILL give write access there. So the dialog
// says when Chrome refuses rather than that it does, and lets the folder be chosen — review of the
// first round, 2026-10-10, where this case had lost the one way it used to write straight in.
R.is(J(r.legacyZip.offered[0] || []) === J(["Download .zip", "Choose UserSkins folder…", "Cancel"])
  && /If the install is under Program Files, Windows or AppData/.test(r.legacyZip.asked[0]),
  `…without claiming every such folder is under Program Files: it says when Chrome refuses, and offers to choose UserSkins for an install that is elsewhere (${J(r.legacyZip.offered[0])})`);
R.is(r.legacyChoose.picks.length === 1 && r.legacyChoose.picks[0].id === "wtuserskins" && r.legacyChoose.picks[0].mode === "readwrite"
  && r.legacyChoose.asked.length === 1 && !r.legacyChoose.zip && J(writes(r.legacyChoose)) === J(want)
  && /^Exported to UserSkins\/zip_probe/.test(r.legacyChoose.said) && r.legacyChoose.remembered && !strays(r.legacyChoose).length,
  `choosing it puts the picker up from that click, and when it hands the folder over the skin is written straight in, UserSkins/<name>/ only, and the folder remembered (${r.legacyChoose.said.slice(0, 40)}…)`);
R.is(r.legacyChooseNo.picks.length === 1 && r.legacyChooseNo.asked.length === 2 && /No folder was chosen/.test(r.legacyChooseNo.asked[1] || "")
  && J(r.legacyChooseNo.offered[1] || []) === J(["Download .zip", "Cancel"]) && r.legacyChooseNo.zip,
  "…and when that picker is refused — Program Files after all — the zip is offered again rather than the export ending");
// The picker opens in the install, so its own button hands back the install root unless the user
// goes one folder further. What a picker returns is asked what it is before anything is written:
// CLAUDE.md §0.4 held only while every stand-in grant above was NAMED UserSkins.
R.is(r.rootPick.picks.length === 1 && r.rootPick.start && J(writes(r.rootPick)) === J(want) && !strays(r.rootPick).length
  && r.rootPick.remembered && /^Exported to UserSkins\/zip_probe/.test(r.rootPick.said),
  `the picker opens in the install, and handing back the install root itself writes into ITS UserSkins — never War Thunder/<name>/ — and remembers UserSkins, not the root (${strays(r.rootPick).length ? "ALSO: " + J(strays(r.rootPick).slice(0, 3)) : r.rootPick.said.slice(0, 40)})`);
R.is(r.abovePick.picks.length === 1 && r.abovePick.asked.length === 0 && J(writes(r.abovePick)) === J(want)
  && !strays(r.abovePick).length && r.abovePick.remembered,
  `a folder above the install (common) finds it by name and writes into its UserSkins (${strays(r.abovePick).length ? "ALSO: " + J(strays(r.abovePick).slice(0, 3)) : "UserSkins/<name>/ only"})`);
R.is(r.wrongPick.picks.length === 2 && r.wrongPick.asked.length === 1 && /“content” is a folder inside the War Thunder install/.test(r.wrongPick.asked[0] || "")
  && J(r.wrongPick.offered[0] || []) === J(["Download .zip", "Choose UserSkins folder…", "Cancel"])
  && J(writes(r.wrongPick)) === J(want) && !strays(r.wrongPick).length && r.wrongPick.remembered,
  `a folder inside the install is not written into: the dialog says so, and choosing again from it writes into the UserSkins picked then (${(r.wrongPick.asked[0] || "").split("\n")[0].slice(0, 70)})`);
R.is(r.wrongNo.picks.length === 1 && r.wrongNo.log.length === 0 && !r.wrongNo.remembered && !r.wrongNo.zip
  && /“Documents” is not a UserSkins folder/.test(r.wrongNo.asked[0] || "") && r.wrongNo.said === "Export cancelled",
  `any other folder is neither written into nor remembered (${r.wrongNo.log.length} calls; "${r.wrongNo.said}")`);
R.is(r.lateRetry.picks.length === 2 && /could not be opened for writing/.test(r.lateRetry.asked[0] || "")
  && J(r.lateRetry.offered[0] || []) === J(["Download .zip", "Choose UserSkins folder…", "Cancel"]) && J(writes(r.lateRetry)) === J(want),
  "a picker that threw because the click's activation ran out (3.21) can be put up again from the dialog, with a fresh click");
R.is(r.cancelZip.picks.length === 1 && r.cancelZip.picks[0].id === "wtuserskins" && r.cancelZip.picks[0].mode === "readwrite" && r.cancelZip.start,
  "with no folder open the picker comes up, under its own id, opening in the game folder remembered from the last visit");
R.is(/No folder was chosen/.test(r.cancelZip.asked[0] || "") && /contains system files/.test(r.cancelZip.asked[0] || "") && r.cancelZip.zip,
  "a cancelled (or refused) picker offers the zip too, saying what a refusal looks like, and the zip is made");
R.is(!r.cancelNo.zip && r.cancelNo.said === "Export cancelled — no folder chosen",
  `…and declining that is still a plain cancellation (${r.cancelNo.said})`);
R.is(r.noPicker.picks.length === 0 && /needs Chrome or Edge/.test(r.noPicker.asked[0] || "") && r.noPicker.zip,
  "a browser with no folder picker offers the zip rather than only saying it cannot");
R.is(/needs Chrome or Edge/.test(r.noPickerLegacy.asked[0] || "") && !/Program Files|opened another way/.test(r.noPickerLegacy.asked[0] || "")
  && J(r.noPickerLegacy.offered[0] || []) === J(["Download .zip", "Cancel"]) && r.noPickerLegacy.zip,
  "in that browser every game folder is opened another way — and the dialog says it is the browser, not Program Files, with no folder to choose");
R.is(r.noPickerLegacyNo.said === "Folder access needs Chrome/Edge — use Download .zip instead",
  `…and declining it says the same as before (${r.noPickerLegacyNo.said})`);
R.is(r.real.picks.length === 0 && r.real.asked.length === 0 && J(writes(r.real)) === J(want),
  `a real game folder: UserSkins is found by itself and the skin written into it — exactly the files the zip holds (${writes(r.real).length})`);
const stray = strays(r.real);
R.is(r.real.log.length > 0 && !stray.length,
  `CLAUDE.md §0.4: the only things created or written are UserSkins/ and UserSkins/<name>/ — read off every call the export made (${stray.length ? "ALSO: " + J(stray) : J(r.real.log.filter(l => /^mkdir/.test(l)))})`);
R.is(r.real.remembered && /^Exported to UserSkins\/zip_probe/.test(r.real.said),
  `…and the UserSkins folder is remembered for next time (${r.real.said.slice(0, 40)}…)`);
R.is(r.later.picks.length === 0 && J(writes(r.later)) === J(want) && r.later.asked.length === 1 && /already exists/.test(r.later.asked[0]),
  "a later visit with no game folder open writes to the remembered UserSkins with no picker — and asks before replacing the skin already there");

console.log("\n=== what a sheet nothing on the model uses is called (4.13/4.14) ===");
const RO = r.role;
console.log(`   ${J(RO)}`);
R.is(RO.onModel === "exterior", `a sheet the model's own geometry uses is exterior (${RO.onModel}) — the geometry is asked first and its answer stands`);
R.is(RO.flameByName === "effect" && RO.atlasByName === "effect",
  `a flame sheet loaded BY NAME is an effect (${RO.flameByName}, ${RO.atlasByName}) — it used to be "exterior", because no triangle uses it and that branch said "do not cry wolf". 4.13's sweep found jet_flame_diamonds in a pack the app already indexes, so this is reachable rather than hypothetical, and the CDK states it as a flat prohibition`);
R.is(RO.cockpitByName === "cockpit", `and a cockpit sheet loaded by name is a cockpit (${RO.cockpitByName})`);
R.is(RO.ordinaryByName === "exterior" && RO.exhaustNotFlagged === "exterior",
  `while an ordinary sheet nothing uses stays exterior (${RO.ordinaryByName}) — and so does a vehicle's own exhaust texture (${RO.exhaustNotFlagged}), which is why "exhaust" is deliberately not in EFFECT_RE: the sweep measured 131 stems matching it and most are exterior sheets or cockpit gauges`);

console.log("\n=== what collectExports puts in the pixels (the oracle IT had none of) ===");
const A = r.alpha;
for (const k of ["groundAuto", "airAuto", "groundKeep", "airOpaque", "painted"])
  console.log(`   ${k.padEnd(11)} ${A[k].note.padEnd(20)} alpha top ${A[k].top}, bottom ${A[k].bottom}`);
R.is(A.groundAuto.note === "opaque" && A.groundAuto.top === 255 && A.groundAuto.bottom === 255,
  `a ground skin's albedo ships fully opaque (${A.groundAuto.note}) — set_tex ADDS a paint sheet beside the vehicle's own, so its alpha means "my paint instead of the scalable camouflage", and every published ground skin checked ships it 255`);
R.is(A.airAuto.note === "kept from texture" && A.airAuto.top === 255 && A.airAuto.bottom === 64,
  `replace_tex keeps the imported texture's mask instead (${A.airAuto.top}/${A.airAuto.bottom} against covBase's 255/64) — it REPLACES the sheet, so flooding that alpha to opaque is what flattens the vehicle`);
R.is(A.groundKeep.bottom === 64 && A.airOpaque.bottom === 255,
  `and each switch overrides "auto" in its own direction (keep on ground ${A.groundKeep.bottom}, opaque on air ${A.airOpaque.bottom}) — two settings that both did nothing would look exactly like this test passing without them`);
R.is(A.painted.note === "painted mask" && A.painted.top === 11 && A.painted.bottom === 11,
  `a hand-painted wear mask outranks both switches (${A.painted.note} at ${A.painted.top}, asked for "opaque" on a ground skin) — it is the one alpha the user stated explicitly`);
R.is(A.groundAuto.rgb.join() === "200,60,20" && A.airAuto.rgb.join() === "200,60,20",
  `and the colour is untouched by any of it (rgb ${A.groundAuto.rgb.join()}) — only the alpha is a decision`);

const S = r.surf;
console.log(`   _n pass-through ${J(S.pass)}, converted ${J(S.conv)}   (smooth 100, metal 210, normal 30/180)`);
R.is(J(S.pass) === J([100, 30, 210, 180]),
  `the _n packs R=smoothness, G=normal X, B=metallicity, A=normal Y (${J(S.pass)}) — CLAUDE.md §1's order, and every channel here holds a different number so a swap is a wrong value rather than a plausible one`);
R.is(S.conv[0] === 158,
  `unticking "already inverted roughness" runs the post-2022 curve, 1-(1-0.7s)³ (100 → ${S.conv[0]}, the formula gives 157.6)`);
R.is(J(S.conv.slice(1)) === J(S.pass.slice(1)),
  `and it touches R only (${J(S.conv.slice(1))}) — the conversion is a roughness curve, not a colour transform`);

const O = r.override;
console.log(`   override ${J(O)}`);
R.is(O.w === 4 && O.h === 4 && O.bytes === 64 && O.resized,
  `a per-texture resolution override resamples the pixels as well as the numbers (${O.w}×${O.h}, ${O.bytes} bytes) — a w that moved without the buffer would hand the encoder a size it cannot read`);
R.is(O.fmt === "tga", `and the format override rides along (${O.fmt})`);
R.is(O.previewW === 8 && !O.previewResized,
  `while the PREVIEW still reports the sheet's own size (${O.previewW}) — the override is applied last and only on the real path, so the list says what you are editing rather than what will be written`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
