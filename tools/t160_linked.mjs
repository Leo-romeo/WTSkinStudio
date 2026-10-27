// An install split across drives by folder links, read as one (GameScan.merge, ListedDir.withLinks).
//
// WHY THIS EXISTS. Players move War Thunder's big packs to an SSD and leave a junction where each
// one was; the game and Steam follow it, Chrome never does — a page is not shown what a link points
// at. Measured 2026-10-24 on the owner's install, with content/base, content.hq/hq_tex,
// content.hq/uhq_aircraft and levels junctioned to C:\WT: the folder picker and the file chooser both
// saw 5 369 of 12 538 files and the scan said "16 vehicles ready", with no model to load. The fix is
// to pick the folder the links point at as well and lay it over the install by relative path. This
// holds the overlay — what it lists, finds, writes and remembers — and every branch of the question
// the app asks, on stand-in trees in a real page. t85 runs the chooser over a real install.
//
// Usage: node tools/t160_linked.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var T0 = 1790000000000;
  var mk = function(rel, bytes){
    var f = new File([new Uint8Array(bytes || 4)], rel.split("/").pop(), { lastModified: T0 });
    Object.defineProperty(f, "webkitRelativePath", { value: rel });
    return f;
  };
  // The install as Chrome shows it with content/base linked away, and the folder the links point at.
  var gameFiles = [mk("War Thunder/aces.vromfs.bin", 40), mk("War Thunder/char.vromfs.bin", 30),
    mk("War Thunder/content/base.ver", 3), mk("War Thunder/content/pkg_local/res/l.dxp.bin", 8),
    mk("War Thunder/content.hq/pkg_cockpits/res/k.dxp.bin", 8), mk("War Thunder/UserSkins/my_skin/f-4e.blk", 5)];
  var linkFiles = [mk("WT/aces.vromfs.bin", 99), mk("WT/content/base/res/a.dxp.bin", 16), mk("WT/content/base/res/b.grp", 12),
    mk("WT/content/base/res/dynModelDesc.bin", 8), mk("WT/content.hq/hq_tex/res/h.dxp.bin", 16), mk("WT/levels/m.bin", 4)];
  var game = function(){ return ListedDir.handle(ListedDir.tree(gameFiles)); };
  var link = function(){ return ListedDir.handle(ListedDir.tree(linkFiles)); };
  var names = async function(h){ var a = []; for await (var e of h.entries()) a.push(e[0] + (e[1].kind === "directory" ? "/" : "")); return a.sort().join(" "); };
  var walk = async function(h){
    var found = { dxp: [], desc: [], grp: [] };
    await scanGameDir(h, 0, found, "");
    var p = function(l){ return l.map(function(f){ return f.path; }).sort().join(","); };
    return { dxp: p(found.dxp), grp: p(found.grp), desc: p(found.desc) };
  };

  // ---- the overlay ----
  var g = game(), l = link(), m = GameScan.merge(g, l);
  out.gaps = { game: (await GameScan.linkGaps(g)).join(","), merged: (await GameScan.linkGaps(m)).join(",") };
  out.root = await names(m);
  out.content = await names(await m.getDirectoryHandle("content"));
  out.walk = await walk(m);
  out.walkGame = await walk(g);
  var a = await (await resolveGamePath(m, "content/base/res/a.dxp.bin")).getFile();
  out.resolved = a === linkFiles[1];
  out.ownFirst = (await (await m.getFileHandle("aces.vromfs.bin")).getFile()).size;
  out.fp = await installFingerprint(m);
  out.flags = { primary: m._primary === g, name: m.name, via: m._via, legacy: m._legacy, nested: (await m.getDirectoryHandle("content"))._primary !== g };
  out.missing = await (m.getDirectoryHandle("nope").then(function(){ return "found"; }, function(e){ return e.name; }));

  // A folder the install lists but will not open (a link, where Chrome shows it at all) is listed
  // from the linked folder instead.
  var refusing = { kind: "directory", name: "base",
    entries: async function*(){ throw new DOMException("a link", "NotAllowedError"); },
    getDirectoryHandle: async function(){ throw new DOMException("a link", "NotAllowedError"); },
    getFileHandle: async function(){ throw new DOMException("a link", "NotAllowedError"); } };
  var plain = function(name, kids){ return { kind: "directory", name: name,
    entries: async function*(){ for (var k in kids) yield [k, kids[k]]; },
    getDirectoryHandle: async function(n){ if (kids[n]) return kids[n]; throw new DOMException("no " + n, "NotFoundError"); },
    getFileHandle: async function(n){ throw new DOMException("no " + n, "NotFoundError"); } }; };
  var shown = plain("War Thunder", { content: plain("content", { base: refusing }) });
  out.refused = { gaps: (await GameScan.linkGaps(shown)).join(","), walk: (await walk(GameScan.merge(shown, link()))).dxp };

  // Anything created goes to the install, never to the linked folder.
  var made = [];
  var writable = function(name){ return { kind: "directory", name: name, queryPermission: async function(){ return "granted"; },
    entries: async function*(){},
    getDirectoryHandle: async function(n, o){ if (o && o.create) { made.push(name + "/" + n); return writable(n); } throw new DOMException("no " + n, "NotFoundError"); },
    getFileHandle: async function(n, o){ if (o && o.create) { made.push(name + "/" + n); return { kind: "file", name: n }; } throw new DOMException("no " + n, "NotFoundError"); } }; };
  var linkWrites = [];
  var lw = link(), realGet = lw.getDirectoryHandle;
  lw.getDirectoryHandle = function(n, o){ if (o && o.create) linkWrites.push(n); return realGet(n, o); };
  var mw = GameScan.merge(writable("War Thunder"), lw);
  await mw.getDirectoryHandle("UserSkins", { create: true });
  out.writes = { install: made.join(","), linked: linkWrites.join(",") };

  // ---- the question the app asks (ListedDir.withLinks) ----
  var reals = { choice: choiceDialog, pick: window.showDirectoryPicker, get: idbGet, set: idbSet, say: setStatus };
  var asked, picked, stored, said, kept, answer, pickWith;
  var run = async function(dir, opts){
    asked = []; picked = 0; stored = {}; said = []; kept = opts.kept || null; answer = opts.answer || "pick"; pickWith = opts.pick;
    var r = await ListedDir.withLinks(dir);
    return { merged: r !== dir && r._primary === dir, same: r === dir, asked: asked.length ? asked[0] : null, picked: picked,
             stored: stored.gameDirLinked ? stored.gameDirLinked.name : null, said: said.join(" | ") };
  };
  try {
    window.choiceDialog = async function(msg, choices){ asked.push({ msg: msg, labels: choices.map(function(c){ return c.label; }).join(" / ") }); return answer; };
    window.showDirectoryPicker = async function(){ picked++; if (pickWith === "abort") throw new DOMException("cancelled", "AbortError"); return pickWith(); };
    window.idbGet = async function(k){ return k === "gameDirLinked" ? kept : null; };
    window.idbSet = async function(k, v){ stored[k] = v; };
    window.setStatus = function(m){ said.push(String(m)); };
    var whole = ListedDir.handle(ListedDir.tree(gameFiles.concat([mk("War Thunder/content/base/res/a.dxp.bin", 16)])));
    out.ask = {
      whole: await run(whole, {}),
      pick: await run(game(), { pick: link }),
      skip: await run(game(), { answer: "skip", pick: link }),
      wrong: await run(game(), { pick: function(){ return ListedDir.handle(ListedDir.tree([mk("Pictures/a.png")])); } }),
      abort: await run(game(), { pick: "abort" }),
    };
    var granted = link(); granted.queryPermission = async function(){ return "granted"; };
    out.ask.kept = await run(game(), { kept: granted, pick: link });
    var regrant = link(); regrant.queryPermission = async function(){ return "prompt"; }; regrant.requestPermission = async function(){ return "granted"; };
    out.ask.regrant = await run(game(), { kept: regrant, pick: link });
  } finally {
    window.choiceDialog = reals.choice; window.showDirectoryPicker = reals.pick; window.idbGet = reals.get; window.idbSet = reals.set; window.setStatus = reals.say;
  }

  // Forgetting the game folder forgets the linked one with it; Advanced has the way to add one by hand.
  var deleted = [], realDel = idbDel;
  try { window.idbDel = async function(k){ deleted.push(k); }; await $("btnForgetFolder").onclick(); }
  finally { window.idbDel = realDel; }
  out.forgot = deleted.join(",");
  out.button = !!$("btnLinkedFolder") && /Add linked folder/.test($("btnLinkedFolder").textContent);
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== the linked folder laid over the install ===");
console.log(`   root: ${r.root}\n   content: ${r.content}\n   walk: ${JSON.stringify(r.walk)}`);
R.is(r.gaps.game === "content/base" && r.gaps.merged === "",
  `an install whose content/base will not open is seen as linked, and is whole once the linked folder is laid over it (${r.gaps.game})`);
R.is(r.root === "UserSkins/ aces.vromfs.bin char.vromfs.bin content.hq/ content/ levels/" && r.content === "base.ver base/ pkg_local/",
  "the listing is both folders' together, each name once, the install's own folders first");
R.is(r.walk.dxp === "content.hq/hq_tex/res/h.dxp.bin,content.hq/pkg_cockpits/res/k.dxp.bin,content/base/res/a.dxp.bin,content/pkg_local/res/l.dxp.bin" &&
     r.walk.grp === "content/base/res/b.grp" && r.walk.desc === "content/base/res/dynModelDesc.bin",
  "the real scan walk finds every pack from both, by the install's own relative paths");
R.is(r.walkGame.grp === "" && r.walkGame.desc === "", "…where the install alone has no model pack and no model→texture map at all");
R.is(r.resolved, "a pack the index names by path is opened from the linked folder");
R.is(r.ownFirst === 40, `a file both hold is the install's (${r.ownFirst} bytes, not the linked copy's 99)`);
R.is(/content\[.*base\//.test(r.fp), "the fingerprint's package inventory counts the linked package, so the stored index keys on the whole install");
R.is(r.flags.primary && r.flags.name === "War Thunder" && r.flags.via === "list" && r.flags.legacy && r.flags.nested,
  "it is named, remembered and opened in a picker as the install (_primary), and keeps the install's read-only flags");
R.is(r.missing === "NotFoundError", "a folder neither holds is NotFoundError, as on a real handle");
R.is(r.refused.gaps === "content/base" && r.refused.walk === "content.hq/hq_tex/res/h.dxp.bin,content/base/res/a.dxp.bin",
  "a folder the install lists but will not open — a link, where Chrome shows one — is seen as a gap and listed from the linked folder");
R.is(r.writes.install === "War Thunder/UserSkins" && r.writes.linked === "",
  `a folder created through it is created in the install, never the linked folder (${r.writes.install})`);

console.log("\n=== what the app asks ===");
for (const [k, v] of Object.entries(r.ask)) console.log(`   ${k.padEnd(8)} merged ${v.merged} · asked ${v.asked ? "“" + v.asked.labels + "”" : "no"} · picker ${v.picked} · kept ${v.stored} · ${v.said}`);
const A = r.ask;
R.is(A.whole.same && !A.whole.asked && !A.whole.picked, "a whole install is opened as it is, with no question");
R.is(A.pick.merged && A.pick.picked === 1 && A.pick.stored === "WT" && /content\\base/.test(A.pick.asked.msg) && /link/.test(A.pick.asked.msg),
  "a linked one asks, names the folder that will not open and why, and the folder picked is laid over it and remembered");
R.is(A.skip.same && !A.skip.picked && !A.skip.stored && /Opened without content\\base/.test(A.skip.said) && /Add linked folder/.test(A.skip.said),
  "“Open without it” opens the install as it is, remembers nothing and says what is missing and where to add it");
R.is(A.wrong.same && !A.wrong.stored && /has no content\\base either/.test(A.wrong.said),
  `a picked folder that does not fill the gap is refused with what it lacks, and not remembered (${A.wrong.said.split(" | ")[0]})`);
R.is(A.abort.same && !A.abort.stored && !/picking the linked folder/.test(A.abort.said),
  "a cancelled picker opens the install as it is, and is not reported as a failure");
R.is(A.kept.merged && !A.kept.asked && !A.kept.picked, "a linked folder remembered and still granted is laid over the install with no question");
R.is(A.regrant.merged && A.regrant.asked && /Reopen “WT”/.test(A.regrant.asked.labels) && !A.regrant.picked,
  "one remembered but no longer granted is offered back by name and re-granted in the click, with no picker");
R.is(/gameDirLinked/.test(r.forgot) && /gameDir(,|$)/.test(r.forgot), "Forget folder & cache forgets the linked folder with the install");
R.is(r.button, "Advanced has Add linked folder… for links the automatic check cannot see");

const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
