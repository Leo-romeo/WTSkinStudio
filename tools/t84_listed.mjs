// The second way into a game folder: the file chooser, as a directory handle (ROADMAP 4.48).
//
// WHY THIS EXISTS. A default Steam install sits under C:\Program Files (x86), Chrome's folder picker
// refuses every folder there, and the escape hatch the app used to offer — drag the folder in — is
// the one thing a double-clicked page cannot read (t36's table: readEntries() rejects on file://).
// So every tester with a default install met a dead end on day one. `<input webkitdirectory>` has
// no system-folder rule and works from file:// (measured, see `ListedDir` in src/ui/drop.js); what
// it hands over is a flat list of Files with relative paths, and the scan speaks directory handles.
// `ListedDir` is the adapter between the two, and this is what holds it:
//
//   * the tree it rebuilds answers entries(), getDirectoryHandle() and getFileHandle() the way a
//     real handle does — including a name asked for in the wrong case, which NTFS answers — and
//     refuses to create anything, because nothing in it can be written;
//   * the REAL scan walk and the REAL install fingerprint run over it, and find what they would
//     find in a real folder — the fingerprint is what lets a second visit reuse the stored index;
//   * picking the folder above the install finds the install one level down, and a folder with no
//     game in it says so, with its name and file count;
//   * the buttons open the chooser, a browser with no folder picker goes straight to it, and when
//     the picker is refused the hint that appears offers it — rather than the drag it used to offer.
//   * (2026-10-10) a folder picked ABOVE the install through the folder picker — a Steam library,
//     `common`, a drive — finds it a few known names down without walking anything, and the install
//     is what is remembered; a folder inside it, or one with no install, is not scanned and says
//     why; the remembered install reopens; nothing is created anywhere (CLAUDE.md §0.4); "Load a
//     skin" opens in UserSkins; and the file chooser follows the same names through its listing.
//
// `tools/t85_listed_install.mjs` runs the real chooser over a real install; this one needs neither.
//
// Usage: node tools/t84_listed.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  // A File as the chooser makes one: webkitRelativePath is read-only on a constructed File, so it is
  // put on the instance, which shadows the prototype's getter the same way for every reader.
  var T0 = 1790000000000;
  var mk = function(rel, bytes, t){
    var f = new File([new Uint8Array(bytes || 4)], rel.split("/").pop(), { lastModified: t || T0 });
    Object.defineProperty(f, "webkitRelativePath", { value: rel });
    return f;
  };
  var install = function(top){
    var p = top ? top + "/" : "";
    return [
      mk(p + "War Thunder/aces.vromfs.bin", 40), mk(p + "War Thunder/char.vromfs.bin", 30),
      mk(p + "War Thunder/warthunder.yup", 20),
      mk(p + "War Thunder/content/base/res/a.dxp.bin", 16), mk(p + "War Thunder/content/base/res/b.grp", 12),
      mk(p + "War Thunder/content/base/res/dynModelDesc.bin", 8), mk(p + "War Thunder/content/base.ver", 3, T0 + 5),
      mk(p + "War Thunder/content.hq/uhq_vehicles/res/c.dxp.bin", 16),
      mk(p + "War Thunder/UserSkins/my_skin/f-4e.blk", 5),
    ];
  };
  var list = install("");
  var root = ListedDir.tree(list);
  var h = ListedDir.handle(ListedDir.gameRoot(root));

  // ---- the handle answers like a real one ----
  var names = [];
  for await (var pair of h.entries()) names.push(pair[0] + (pair[1].kind === "directory" ? "/" : ""));
  out.rootNames = names.sort().join(" ");
  var vals = 0; for await (var v of h.values()) vals++;
  out.values = vals;
  var content = await h.getDirectoryHandle("content");
  var ver = await (await content.getFileHandle("base.ver")).getFile();
  out.ver = { same: ver === list[6], size: ver.size, t: ver.lastModified - T0 };
  try { out.caseFold = (await (await h.getFileHandle("ACES.vromfs.bin")).getFile()) === list[0]; } catch (e) { out.caseFold = e.name; }
  var errName = async function(p){ try { await p; return "resolved"; } catch (e) { return e.name; } };
  out.missingDir = await errName(h.getDirectoryHandle("nope"));
  out.missingFile = await errName(h.getFileHandle("nope.bin"));
  out.fileAsDir = await errName(h.getDirectoryHandle("aces.vromfs.bin"));
  out.create = await errName(h.getFileHandle("new.bin", { create: true }));
  out.perm = [await h.queryPermission({ mode: "read" }), await h.queryPermission({ mode: "readwrite" })].join(",");
  out.flags = { legacy: h._legacy === true, via: h._via, name: h.name };

  // ---- the real walk and the real fingerprint run over it ----
  var found = { dxp: [], desc: [], grp: [] };
  GameDB.scanCount = 0;
  await scanGameDir(h, 0, found, "");
  out.walk = { dxp: found.dxp.map(function(f){ return f.path; }).sort().join(","),
               grp: found.grp.map(function(f){ return f.path; }).join(","),
               desc: found.desc.map(function(f){ return f.path; }).join(",") };
  out.fp = await installFingerprint(h);

  // ---- the wrong folder, one level up, and a folder with no game in it ----
  var up = ListedDir.gameRoot(ListedDir.tree(install("common")));
  out.oneUp = up ? up.name : null;
  var loose = [mk("Pictures/a.png"), mk("Pictures/b/c.png")];
  out.looseRoot = ListedDir.gameRoot(ListedDir.tree(loose));
  out.flat = ListedDir.tree([new File([new Uint8Array(1)], "x.bin")]);    // not from a folder chooser

  // ---- open(): what reaches the scan, and what is said when nothing does ----
  var realIndex = indexGameFolder, seenDir = null;
  var say = function(){ return $("status") ? $("status").textContent : ""; };
  try {
    indexGameFolder = async function(d){ seenDir = d; return 5; };
    await ListedDir.open(install("common"));
    out.opened = seenDir ? { name: seenDir.name, via: seenDir._via } : null;
    seenDir = null; $("status").textContent = "";
    await ListedDir.open(loose);
    out.noGame = { reached: !!seenDir, said: say() };
    seenDir = null;
    await ListedDir.open([]);
    out.cancelled = !seenDir;
    // the scan found nothing in what LOOKED like an install: it says to pick, not to drop
    indexGameFolder = async function(d){ seenDir = d; return 0; };
    var mWas = GameDB.models; GameDB.models = [];
    $("status").textContent = "";
    await ListedDir.open(list);
    out.empty = say();
    GameDB.models = mWas;
  } finally { indexGameFolder = realIndex; }
  $("welcome").style.display = "none";

  // ---- the buttons, and the two ways the folder picker sends people here ----
  var clicked = [], realClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(){ clicked.push(this.id); };
  var realPicker = window.showDirectoryPicker;
  try {
    $("btnWelcomeGameAlt").click();
    $("btnGameFolderAlt").click();
    out.buttons = clicked.join(",");
    clicked = [];
    try { delete window.showDirectoryPicker; } catch (e) { /* not deletable: overwritten below */ }
    if (window.showDirectoryPicker) window.showDirectoryPicker = undefined;
    await openGameFolder(false);
    out.noPicker = clicked.join(",");
    clicked = [];
    window.showDirectoryPicker = async function(){ throw new DOMException("The user aborted a request.", "AbortError"); };
    $("dragHint").style.display = "none";
    await openGameFolder(false);
    out.refused = { hint: $("dragHint").style.display, hasButton: !!$("dragHint").querySelector("#btnWelcomeGameAlt"),
                    saysDrag: /drag the/i.test($("dragHint").textContent), said: say(), clicked: clicked.length };
  } finally {
    HTMLInputElement.prototype.click = realClick;
    window.showDirectoryPicker = realPicker;
    $("dragHint").style.display = "none";
  }

  // ---- a folder ABOVE the install, through the folder picker (2026-10-10) ----
  // Stand-ins for REAL handles (no _legacy): a tree with the Steam library's shape, where every
  // lookup, every listing and every attempt to create anything is counted.
  var looks = 0, lists = 0, writes = [];
  var realDir = function(name, kids, files, perm){
    var h = { kind: "directory", name: name,
      queryPermission: async function(o){ return o && o.mode === "readwrite" ? "denied" : (perm || "granted"); },
      requestPermission: async function(o){ return o && o.mode === "readwrite" ? "denied" : "granted"; },
      entries: async function*(){ lists++; for (var k in kids) yield [k, kids[k]]; },
      getDirectoryHandle: async function(n, o){
        looks++;
        if (o && o.create) { writes.push(name + "/" + n); throw new DOMException("read-only stand-in", "NotAllowedError"); }
        var hit = Object.keys(kids).find(function(k){ return k.toLowerCase() === String(n).toLowerCase(); });
        if (!hit) throw new DOMException("no " + n, "NotFoundError");
        return kids[hit];
      },
      getFileHandle: async function(n, o){
        looks++;
        if (o && o.create) { writes.push(name + "/" + n); throw new DOMException("read-only stand-in", "NotAllowedError"); }
        if ((files || []).indexOf(n) < 0) throw new DOMException("no " + n, "NotFoundError");
        return { kind: "file", name: n };
      } };
    return h;
  };
  var warThunder = realDir("War Thunder", { content: realDir("content", {}), UserSkins: realDir("UserSkins", { my_skin: realDir("my_skin", {}, ["f-4e.blk"]) }) },
                   ["aces.vromfs.bin", "char.vromfs.bin"]);
  var common = realDir("common", { "Some Other Game": realDir("Some Other Game", {}, ["game.exe"]), "War Thunder": warThunder });
  var lib = realDir("SteamLibrary", { steamapps: realDir("steamapps", { common: common }) });
  var drive = realDir("D:\\\\", { SteamLibrary: lib, Users: realDir("Users", {}) });     // a drive root's own name ends in a backslash
  var pictures = realDir("Pictures", { holiday: realDir("holiday", {}, ["a.png"]) });
  var reals = { pick: window.showDirectoryPicker, index: indexGameFolder, set: idbSet, get: idbGet };
  var picked = null, scanned = [], stored = {};
  window.showDirectoryPicker = async function(o){ return picked; };
  window.indexGameFolder = async function(d, force, found){ scanned.push({ name: d.name, d: d, found: found || "" }); return 5; };
  window.idbSet = async function(k, v){ stored[k] = v; };
  var via = async function(dir){
    picked = dir; scanned = []; stored = {}; looks = 0; lists = 0; $("status").textContent = "";
    $("welcome").style.display = "none";
    var said = [];
    var realSay = setStatus;
    window.setStatus = function(m, c, d){ said.push(String(m)); return realSay(m, c, d); };
    try { await openGameFolder(true); } finally { window.setStatus = realSay; }
    var s = scanned[0];
    return { scanned: s ? s.name : null, same: s ? s.d === warThunder : false, found: s ? s.found : "", remembered: stored.gameDir ? stored.gameDir.name : null,
             rememberedSame: stored.gameDir === warThunder, said: said.join(" | "), looks: looks, lists: lists,
             card: $("welcome").style.display };
  };
  try {
    out.above = { lib: await via(lib), common: await via(common), drive: await via(drive), install: await via(warThunder),
                  inside: await via(realDir("UserSkins", { my_skin: realDir("my_skin", {}, ["f-4e.blk"]) })),
                  none: await via(pictures) };
    out.above.writes = writes.slice();

    // ---- the remembered install, next visit: the handle that was stored is the one reopened ----
    scanned = [];
    window.idbGet = async function(k){ return k === "gameDir" ? warThunder : undefined; };
    out.restored = { ok: await tryRestoreGameFolder(), scanned: scanned.length === 1 && scanned[0].d === warThunder };
    // …and when the browser wants a click first, that click reopens the same handle, no picker
    var asked = realDir("War Thunder", {}, ["aces.vromfs.bin"], "prompt"), btn = $("btnGameFolder");
    var btnWas = { text: btn.textContent, title: btn.title, click: btn.onclick };
    window.idbGet = async function(k){ return k === "gameDir" ? asked : undefined; };
    scanned = []; picked = null;
    var held = await tryRestoreGameFolder();
    btn.onclick();
    await new Promise(function(r){ setTimeout(r, 50); });
    out.reopen = { held: held, label: btn.textContent, scanned: scanned.length === 1 && scanned[0].d === asked };
    btn.textContent = btnWas.text; btn.title = btnWas.title; btn.onclick = btnWas.click;
    out.restoreWrites = writes.length;

    // ---- "Load a skin" opens its picker where the skins are ----
    var skinOpts = [], realChoice = choiceDialog;
    window.choiceDialog = async function(){ return "dir"; };
    window.showDirectoryPicker = async function(o){ skinOpts.push(o || {}); throw new DOMException("The user aborted a request.", "AbortError"); };
    var keepUS = App.userSkinsDir, keepGD = App.gameDir, wtUS = await warThunder.getDirectoryHandle("UserSkins");
    try {
      App.userSkinsDir = wtUS; App.gameDir = warThunder;
      await loadSkinFolder();
      App.userSkinsDir = null; App.gameDir = null;                      // nothing open: the remembered install
      window.idbGet = async function(k){ return k === "gameDir" ? warThunder : undefined; };
      await loadSkinFolder();
    } finally { window.choiceDialog = realChoice; App.userSkinsDir = keepUS; App.gameDir = keepGD; }
    out.skinPick = skinOpts.map(function(o){ return { id: o.id, mode: o.mode, start: o.startIn ? o.startIn.name : null,
      same: o.startIn === wtUS || o.startIn === warThunder }; });
  } finally {
    window.showDirectoryPicker = reals.pick; window.indexGameFolder = reals.index; window.idbSet = reals.set; window.idbGet = reals.get;
    $("welcome").style.display = "none";
  }

  // ---- the same through the file chooser: a Steam library, and a folder inside the install ----
  var seen2 = [], realIndex2 = indexGameFolder;
  try {
    window.indexGameFolder = async function(d, force, found){ seen2.push({ name: d.name, via: d._via, found: found || "" }); return 5; };
    await ListedDir.open(install("SteamLibrary/steamapps/common"));
    out.listedLib = seen2[0] || null;
    seen2 = []; $("status").textContent = "";
    await ListedDir.open([mk("UserSkins/my_skin/f-4e.blk"), mk("UserSkins/my_skin/hull_c.dds")]);
    out.listedInside = { reached: seen2.length > 0, said: say() };
    // A sibling Gaijin game in "common", listed first: launcher.exe, win64 and content are two of the
    // generic markers, so a "looks like a game" test took it for the install (review, 2026-10-10).
    // Only aces.vromfs.bin decides, the file GameScan.holdsGame asks a real handle for.
    var enlisted = function(top){ var p = top ? top + "/" : "";
      return [mk(p + "Enlisted/launcher.exe"), mk(p + "Enlisted/win64/enlisted.exe"), mk(p + "Enlisted/content/base/res/e.grp")]; };
    seen2 = []; $("status").textContent = "";
    await ListedDir.open(enlisted("common").concat(install("common")));
    out.listedSibling = seen2[0] || null;
    seen2 = []; $("status").textContent = "";
    await ListedDir.open(enlisted(""));
    out.listedOther = { reached: seen2.length > 0, said: say() };
  } finally { window.indexGameFolder = realIndex2; $("welcome").style.display = "none"; }

  out.input = { exists: !!$("gameDirPick"), dir: !!($("gameDirPick") && $("gameDirPick").webkitdirectory),
                hidden: $("gameDirPick") && $("gameDirPick").style.display === "none" };
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = v => JSON.stringify(v);

console.log("\n=== the chosen folder answers like a directory handle ===");
console.log(`   root: ${r.rootNames}`);
R.is(r.rootNames === "UserSkins/ aces.vromfs.bin char.vromfs.bin content.hq/ content/ warthunder.yup" && r.values === 6,
  `entries() and values() list the install's own root, folders and files alike (${r.values})`);
R.is(r.ver.same && r.ver.size === 3 && r.ver.t === 5,
  "getDirectoryHandle → getFileHandle → getFile hands back the chooser's own File, size and date intact");
R.is(r.caseFold === true, "a name asked for in the wrong case is found, as NTFS and a dropped folder both find it");
R.is(r.missingDir === "NotFoundError" && r.missingFile === "NotFoundError" && r.fileAsDir === "TypeMismatchError",
  `what is not there throws NotFoundError and a file asked for as a folder TypeMismatchError, as a real handle does (${r.missingDir}, ${r.missingFile}, ${r.fileAsDir})`);
R.is(r.create === "NotAllowedError" && r.perm === "granted,denied",
  `nothing can be created in it and it says read-only when asked (${r.create}; ${r.perm})`);
R.is(r.flags.legacy && r.flags.via === "list" && r.flags.name === "War Thunder",
  "it is marked as no real handle — so it is never stored, never written to, and the scan's sentence can tell it from a drop");

console.log("\n=== the real walk and the real fingerprint ===");
console.log(`   dxp ${r.walk.dxp} · grp ${r.walk.grp} · desc ${r.walk.desc}`);
console.log(`   ${r.fp}`);
R.is(r.walk.dxp === "content.hq/uhq_vehicles/res/c.dxp.bin,content/base/res/a.dxp.bin" && r.walk.grp === "content/base/res/b.grp"
  && r.walk.desc === "content/base/res/dynModelDesc.bin",
  "scanGameDir finds every texture pack (the content.hq DLC's too), model pack and desc file, by the paths the stored index keys on");
R.is(/^warthunder\.yup:20:1790000000000\|aces\.vromfs\.bin:40:1790000000000\|char\.vromfs\.bin:30:1790000000000\|/.test(r.fp)
  && /content\[base\.ver:3:1790000000005,base\/\]/.test(r.fp) && /content\.hq\[uhq_vehicles\/\]/.test(r.fp),
  "installFingerprint reads sizes, dates and the package inventory through it — the same string a real handle gives, which is what lets the next visit reuse the stored index");

console.log("\n=== the wrong folder, and no folder ===");
R.is(r.oneUp === "War Thunder", `picking the folder above the install finds the install inside it (${r.oneUp})`);
R.is(r.looseRoot === null && r.flat === null, "a folder with no game in it is not taken for one, and a loose file makes no tree");
R.is(r.opened && r.opened.name === "War Thunder" && r.opened.via === "list",
  `open() hands the scan the install, not the folder that was picked (${JSON.stringify(r.opened)})`);
R.is(!r.noGame.reached && /No game data found in “Pictures” \(2 files\)/.test(r.noGame.said) && /pick the War Thunder/.test(r.noGame.said),
  `a folder with no game in it never reaches the scan, and the status names it (${r.noGame.said})`);
R.is(r.cancelled, "a cancelled chooser does nothing");
R.is(/pick the War Thunder install folder itself/.test(r.empty) && !/drop the/.test(r.empty),
  `a scan that found nothing in it says to PICK the install, not to drop it (${r.empty})`);

console.log("\n=== the ways in ===");
R.is(r.input.exists && r.input.dir && r.input.hidden, "the chooser is a hidden <input webkitdirectory>");
R.is(r.buttons === "gameDirPick,gameDirPick", `both buttons open it — the welcome card's and the sidebar's (${r.buttons})`);
R.is(r.noPicker === "gameDirPick", `a browser with no folder picker goes straight to the chooser instead of refusing (${r.noPicker})`);
R.is(r.refused.hint === "" && r.refused.hasButton && !r.refused.saysDrag && r.refused.clicked === 0,
  "when the folder picker comes back empty — which is what Chrome does for Program Files — the hint that appears offers the chooser, and no longer says to drag the folder in");
R.is(/Open it another way/.test(r.refused.said), `…and so does the status line (${r.refused.said})`);

console.log("\n=== a folder above the install, picked through the folder picker (2026-10-10) ===");
const A = r.above;
for (const k of ["lib", "common", "drive", "install", "inside", "none"])
  console.log(`   ${k.padEnd(8)} scanned ${A[k].scanned} · found "${A[k].found}" · remembered ${A[k].remembered} · ${A[k].looks} lookups, ${A[k].lists} listings · ${A[k].said}`);
R.is(A.lib.same && A.lib.found === "SteamLibrary/steamapps/common/War Thunder" && A.lib.rememberedSame,
  `a Steam library picked instead of the install: the install below it is scanned, and IT is what is remembered (${A.lib.scanned}, ${A.lib.remembered})`);
R.is(/Found War Thunder at SteamLibrary\/steamapps\/common\/War Thunder/.test(A.lib.said),
  "…and the status says where it was found");
R.is(A.common.same && A.common.found === "common/War Thunder" && A.drive.same && A.drive.found === "D:/" + A.lib.found,
  `so is \`common\`, one level up, and the drive the library is on (${A.common.found}; ${A.drive.found})`);
R.is(A.drive.lists === 0 && A.drive.looks <= 12,
  `the drive is not walked — the install is looked up by name, ${A.drive.looks} lookups and ${A.drive.lists} directory listings`);
R.is(A.install.same && A.install.found === "" && A.install.rememberedSame && !/Found War Thunder/.test(A.install.said),
  "the install itself is still taken as it is, with nothing said about finding it");
R.is(A.inside.scanned === null && A.inside.remembered === null && /“UserSkins” is a folder inside the War Thunder install — pick the War Thunder folder that holds it/.test(A.inside.said)
  && A.inside.card === "",
  `a folder INSIDE the install is not scanned, and the user is told to pick the one above it, with the welcome card back (${A.inside.said})`);
R.is(A.none.scanned === null && /No War Thunder install in “Pictures”/.test(A.none.said),
  `a folder with no install in it or under it is not scanned either — a drive used to be walked to depth 7 to say so (${A.none.said})`);
R.is(A.writes.length === 0 && r.restoreWrites === 0,
  `finding the install, remembering it and reopening it create nothing anywhere — CLAUDE.md §0.4 (${A.writes.join(", ") || "none"})`);
R.is(r.restored.ok && r.restored.scanned, "the remembered install reopens by itself next visit when the browser still grants it");
R.is(r.reopen.held === false && /Reopen War Thunder folder/.test(r.reopen.label) && r.reopen.scanned,
  `…and when the browser wants a click first, that one click reopens the same handle (${r.reopen.label})`);
console.log(`   load a skin: ${J(r.skinPick)}`);
R.is(r.skinPick.length === 2 && r.skinPick.every(o => o.id === "wtskins" && o.mode === "read" && o.same)
  && r.skinPick[0].start === "UserSkins" && r.skinPick[1].start === "War Thunder",
  "\"Load a skin\" opens its picker in UserSkins when it is known, else in the remembered install — and keeps its own id");

console.log("\n=== the same through the file chooser ===");
R.is(r.listedLib && r.listedLib.name === "War Thunder" && r.listedLib.via === "list" && r.listedLib.found === "SteamLibrary/steamapps/common/War Thunder",
  `a Steam library chosen through the file chooser finds the install three levels down, and says where (${J(r.listedLib)})`);
R.is(!r.listedInside.reached && /“UserSkins” is a folder inside the War Thunder install/.test(r.listedInside.said),
  `a folder inside the install is told to pick the one above it (${r.listedInside.said})`);
R.is(r.listedSibling && r.listedSibling.name === "War Thunder" && r.listedSibling.found === "common/War Thunder",
  `\`common\` with another Gaijin game listed before War Thunder finds War Thunder, as the folder picker does — not the game whose launcher and win64 look like one (${J(r.listedSibling)})`);
R.is(!r.listedOther.reached && /No game data found in “Enlisted”/.test(r.listedOther.said),
  `…and that other game chosen on its own is not scanned as War Thunder (${r.listedOther.said})`);

const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
