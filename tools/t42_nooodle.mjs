// A build with no Oodle decoder at all (ROADMAP 5.2).
//
// **This is not the release build** — that is the default, which ships the project's own decoder
// and reads the whole game (ROADMAP 5.1, 5.4, tools/t46_wtlz.mjs). `--no-oodle` is kept because
// "no decoder" is still a configuration the app has to handle honestly, and because it is the
// fallback if the decoder ever has to be dropped. Nothing about that honesty is exercised anywhere
// else.
//
// `node tools/build.mjs --no-oodle` drops `codecs/wtlz.js` and puts `src/vendor/oodle-b64.stub.js`
// in the decoder slot. Two things have to hold, and neither is obvious from reading the code: the
// decoder has to be *genuinely gone* from the emitted bytes, and the app has to degrade honestly
// rather than throwing, hanging, or quietly showing a vehicle with half its textures and no
// explanation. CLAUDE.md §0.2 makes the first one a hard constraint, and §0.3 — the manual
// OBJ/DDS path is the permanent escape hatch — is what makes the second one a limitation instead
// of a broken app.
//
// This runs the no-Oodle page in a real browser, because that is the only place `oodleAvailable()`,
// the decode pool's `ops` plumbing and the entry-listing UI all exist at once.
//
// Usage: node tools/t42_nooodle.mjs [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";
import { build } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const full = build().html;
const pub = build(ROOT, { noOodle: true }).html;

console.log("=== the decoder is gone from the bytes ===");
// The decoder's own section markers and its entry point. Searching for the real thing is the only
// check that cannot be satisfied by an empty const sitting next to a leftover copy. (Until
// 2026-09-14 this searched for ooz's blob, which the default build carried; the default build now
// carries no WASM Oodle blob at all, so the thing that has to be gone is the WTLZ section.)
R.is(full.includes("\n/*==WTLZ==*/") && /\nconst WTLZ = \(function\(\)\{/.test(full), "the decoder IS in the normal build, so the search means something");
R.is(!pub.includes("/*==WTLZ==*/") && !/const WTLZ = /.test(pub), "but not in the --no-oodle build");
R.is(/const OODLE_WASM_B64 = "";/.test(pub) && /const OODLE_IMPL = "";/.test(pub), "which declares the slot empty rather than dropping the bindings");
const savedKB = Math.round((full.length - pub.length) / 1024);
// 200 when this was written against RAD's 250 KB blob, 120 against ooz's 129 KB; the decoder is
// 111 KB of JavaScript, so the floor moved with the thing being removed rather than the test being
// loosened. It is still a whole-decoder check: a truncated copy would come in far under this.
R.is(savedKB > 100, `and the build is ${savedKB} KB smaller — the whole decoder, not a truncated copy`);
// zstd is BSD-3/GPLv2 (Meta) and freely redistributable; losing it here would be a silent
// downgrade of a build that is allowed to keep it.
R.is(/const ZSTD_WASM_B64 = "[A-Za-z0-9+/]{64}/.test(pub), "the zstd blob, which IS redistributable, is still there");

const BODY = `async function(){
  var out = {};
  out.oodle = oodleAvailable();
  out.zstd = zstdAvailable();

  // zstd is not merely "available": its module has to instantiate, or the build that is allowed
  // to ship it would still read none of the game's zstd-compressed entries.
  try { out.zstdModule = !!zstdInit(); } catch (e) { out.zstdErr = String(e && e.message); }

  // The decoder must refuse by name, not throw something opaque or hang.
  try { await ensureOodle(); out.oodleThrew = "(did not throw)"; }
  catch (e) { out.oodleThrew = e.message; }

  // The same refusal has to survive the trip into a worker: the pool passes the blob's VALUE
  // through ops, so an absent blob must degrade identically off the main thread (CLAUDE.md §3.1).
  try {
    await decodePool().call("gameTexture",
      { comp: 0x60, compName: "oodle", packedSz: 16, memSz: 32, fmt: "DXT5", w: 4, h: 4, levels: 1,
        body: new Uint8Array(16).buffer }, []);
    out.workerThrew = "(did not throw)";
  } catch (e) { out.workerThrew = e.message; }

  // An Oodle entry is listed and explained, never silently absent. Built here rather than read
  // from an install so the test needs no game files.
  var mk = function(comp, fmt){ return { name: "hull_c*", stem: "hull_c", tier: "base", size: 4096,
    fmt: fmt, w: 512, h: 512, compName: comp,
    supported: (fmt === "DXT5") && (comp === "raw" || comp === "zstd" || comp === "zlib" || (comp === "oodle" && oodleAvailable())) };
  };
  var oo = mk("oodle", "DXT5"), zs = mk("zstd", "DXT5"), odd = mk("zstd", "WEIRD");
  out.oodleSupported = oo.supported;
  out.zstdSupported = zs.supported;
  out.reasonOodle = entryBlockReason(oo);
  out.reasonZstd = entryBlockReason(zs);
  out.reasonFmt = entryBlockReason(odd);
  out.reasonNoData = entryBlockReason(Object.assign({}, oo, { size: 0 }));

  // and the row it produces is dimmed, tagged and has no buttons to press
  var row = textureRow({ stem: "hull_c", tiers: { base: oo } }, "auto");
  out.rowTitle = row ? row.firstChild.title : null;
  out.rowButtons = row ? row.querySelectorAll("button").length : -1;
  out.rowDimmed = row ? /opacity:\\s*0?\\.4/.test(row.firstChild.style.cssText) : null;

  // The scan's own summary in this build. Two Oodle-compressed sheets — most of a modern install is
  // Oodle — and one sheet in a pixel format nothing here reads, compressed with zstd. The Oodle ones
  // must keep THEIR sentence (no decoder; import the .dds by hand) and not be passed off as data in
  // an odd format, which is what the normal build says about the other kind (2026-10-10).
  var keep = { entries: GameDB.entries, stems: GameDB.stems, models: GameDB.models, packs: GameDB.packs,
               rows: GameDB.vehicleRows, loaded: GameUnits.loaded, list: GameUnits.list };
  GameDB.entries = []; GameDB.stems = new Map();
  [["hull_c", "DXT5", "oodle"], ["hull_n", "BC5U", "oodle"], ["oak_pivot_dir", "q", "zstd"]].forEach(function(t){
    var en = mk(t[2], t[1]);
    en.name = en.stem = t[0];
    GameDB.entries.push(en);
    GameDB.stems.set(t[0], { stem: t[0], tiers: { base: en } });
  });
  GameDB.models = ["m1"]; GameDB.packs = 1; GameDB.vehicleRows = []; GameUnits.loaded = false; GameUnits.list = [];
  GameScan.finish(false, { _legacy: false });
  out.scanSay = StatusLog.entries[0] ? StatusLog.entries[0].msg : "";
  out.scanDiag = $("gameDiag").textContent;
  // Advanced ▸ Fill missing slots over the same three, and a sheet the install lacks: each said under
  // its own cause. It called all of them "not found" (review of 2026-10-10).
  var keepSlots = App.slots;
  App.slots = new Map([["hull", { id: "hull", cStem: "hull_c", nStem: null, missing: true, smooth: true, layers: [] }],
    ["oak", { id: "oak", cStem: "oak_pivot_dir", nStem: null, missing: true, smooth: true, layers: [] }],
    ["gone", { id: "gone", cStem: "nowhere_c", nStem: null, missing: true, smooth: true, layers: [] }]]);
  try { await fillMissingFromGame(); } finally { App.slots = keepSlots; }
  out.fillSay = StatusLog.entries[0] ? StatusLog.entries[0].msg : "";
  GameDB.entries = keep.entries; GameDB.stems = keep.stems; GameDB.models = keep.models; GameDB.packs = keep.packs;
  GameDB.vehicleRows = keep.rows; GameUnits.loaded = keep.loaded; GameUnits.list = keep.list;

  // the manual path — the permanent escape hatch — is untouched
  out.manual = typeof parseDDS === "function" && typeof parseOBJ === "function";
  return out;
}`;

const run = await evalInPage({ browser, html: pub, expr: pageExpr(BODY, 700), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = v => JSON.stringify(v);

console.log("\n=== what the page reports about itself ===");
R.is(r.oodle === false, "oodleAvailable() is false");
R.is(r.zstd === true, "zstdAvailable() is still true");
R.is(r.zstdModule === true, `and the zstd WASM module really instantiates${r.zstdErr ? " — " + r.zstdErr : ""}`);

console.log("\n=== it refuses by name, on both threads ===");
R.is(/not embedded in this build/.test(r.oodleThrew || ""), `the decoder says why → ${J(r.oodleThrew)}`);
R.is(/[Oo]odle/.test(r.workerThrew || ""), `and so does the worker, which is passed the empty blob through ops → ${J(r.workerThrew)}`);

console.log("\n=== an Oodle entry is listed and explained, not hidden ===");
R.is(r.oodleSupported === false, "an Oodle entry is marked unsupported");
R.is(r.zstdSupported === true, "a zstd entry beside it is still supported");
R.is(/this build has no Oodle decoder/.test(r.reasonOodle || ""), `and the reason names the cause → ${J(r.reasonOodle)}`);
R.is(r.reasonZstd === "", "a supported entry has no reason to give");
R.is(/^pixel format WEIRD has no reader in the editor$/.test(r.reasonFmt || ""),
  `an unknown format gets its own reason, naming the format, not Oodle's → ${J(r.reasonFmt)}`);
R.is(/no data for this tier/.test(r.reasonNoData || ""), `and an empty tier gets its own → ${J(r.reasonNoData)}`);
R.is(/this build has no Oodle decoder/.test(r.rowTitle || ""), "the texture row's tooltip carries it too");
R.is(r.rowButtons === 0, `and offers no button that would reach the missing decoder → ${r.rowButtons}`);
R.is(r.rowDimmed === true, "the row is dimmed rather than removed, so the texture is still visibly there");

console.log("\n=== the scan's summary keeps the cause ===");
const oodleLine = (r.scanSay || "").split("\n").find(l => /Oodle/.test(l)) || "";
R.is(/2 textures are not opened/.test(oodleLine) && /no Oodle decoder/.test(oodleLine) && /by hand/.test(oodleLine) && !/pixel format|decompress fine/.test(oodleLine),
  `the Oodle-compressed textures are counted under their own cause, with the way round it → ${J(oodleLine)}`);
R.is(/1 texture is not opened/.test(r.scanSay || "") && /pixel format/.test(r.scanSay || ""),
  `…apart from the one in a pixel format nothing here reads → ${J(r.scanSay)}`);
R.is(/Oodle/.test(r.scanDiag || "") && /A16B16G16R16F ×1/.test(r.scanDiag || ""),
  `Advanced says the same, naming the format by its Direct3D name → ${J(r.scanDiag)}`);
R.is(/· 1 utility sheet not opened/.test(r.fillSay || "") && /· 1 Oodle-compressed — this build has no Oodle decoder/.test(r.fillSay || "") &&
     /not found: nowhere_c$/m.test(r.fillSay || ""),
  `Fill missing slots says each cause apart, and "not found" only of what the install lacks → ${J((r.fillSay || "").split("\n")[0])}`);

console.log("\n=== the escape hatch ===");
R.is(r.manual === true, "the manual OBJ/DDS import path is untouched (CLAUDE.md §0.3)");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
