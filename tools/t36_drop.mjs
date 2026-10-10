// What the drop handler does with the items a real drag hands it.
//
// The bug this exists for: a loose file used to be read back through `webkitGetAsEntry()`, which is
// a handle into the drag's isolated filesystem. Reading one needs a well-formed filesystem URL, and
// a page opened from disk — the way this app is MEANT to be opened (CLAUDE.md §0.1) — does not have
// one. MEASURED 2026-08-05 with real CDP-dispatched drags (Input.dispatchDragEvent) into headless
// Chrome, the same page on both origins:
//
//     page      dropped        getAsFile()     entry.file() / readEntries()
//     file://   roundel.png    ok  8 bytes     REJECTED EncodingError: A URI supplied to the API
//                                              was malformed, or the resulting Data URL has
//                                              exceeded the URL length limitations for Data URLs
//     http://   roundel.png    ok  8 bytes     ok  8 bytes
//     file://   a folder       0-byte stub     REJECTED — same EncodingError
//     http://   a folder       0-byte stub     ok  2 entries
//
// So the walk threw on the FIRST file, nothing at all was collected, and the drop then reported
// "Nothing usable in that drop" — while the real cause went to console.error and nowhere else.
// (The folder row is why a dropped War Thunder install cannot work from disk either; that is now
// documented in docs/EXTRACTOR_DESIGN.md rather than promised in the quick start.)
//
// This test runs the page's own drop handler against a synthetic dataTransfer that RECORDS every
// entry-API call, so "loose files never touch it" is measured rather than asserted, and the
// EncodingError case can be forced on demand. (The harness already loads the page from file://, so
// this runs on the origin the bug belongs to.)
//
// Usage: node tools/t36_drop.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};

  // A stand-in for the DataTransfer a real drag delivers. Every entry-API touch is recorded, and
  // webkitGetAsEntry can be made to hand back an entry whose file() throws the way file:// does.
  function mkTransfer(specs){
    var log = { asFile: [], asEntry: [], entryFile: [], readDir: [] };
    var items = specs.map(function(s){
      var entry = s.dir
        ? { isFile: false, isDirectory: true, name: s.name,
            createReader: function(){ return { readEntries: function(res, rej){
              log.readDir.push(s.name);
              if (s.entryThrows) return rej(new DOMException("A URI supplied to the API was malformed", "EncodingError"));
              res([]);
            } }; } }
        : { isFile: true, isDirectory: false, name: s.name,
            file: function(res, rej){
              log.entryFile.push(s.name);
              if (s.entryThrows) return rej(new DOMException("A URI supplied to the API was malformed", "EncodingError"));
              res(new File([new Uint8Array(4)], s.name));
            } };
      return {
        kind: "file",
        getAsFile: function(){ log.asFile.push(s.name); return s.dir ? null : new File([new Uint8Array(4)], s.name); },
        webkitGetAsEntry: function(){ log.asEntry.push(s.name); return entry; },
      };
    });
    return { log, dt: { types: ["Files"], items: items, files: [], getData: function(){ return ""; } } };
  }

  // Dispatch a drop the window handler will actually see. DragEvent will not take a fake
  // dataTransfer, so the property is defined on a plain Event instead.
  async function drop(dt){
    var ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    window.dispatchEvent(ev);
    await new Promise(function(r){ setTimeout(r, 250); });
  }

  // addFiles is what a successful drop of loose files ends in — stub it out and record the names.
  var realAdd = addFiles, seen = null;
  addFiles = function(fs){ seen = fs.map(function(f){ return f.name; }); };
  var status = function(){ var el = document.getElementById("status"); return el ? el.textContent : ""; };

  try {
    // ---- 1. loose files: getAsFile only, entries never read ----
    var a = mkTransfer([{ name: "hull_c.dds" }, { name: "hull_n.dds" }]);
    seen = null;
    await drop(a.dt);
    out.looseSeen = seen;
    out.looseAsFile = a.log.asFile;
    out.looseEntryFileCalls = a.log.entryFile;          // must stay empty — this is the whole fix

    // ---- 2. the exact failure from the report: entries throw, plain files still arrive ----
    var b = mkTransfer([{ name: "roundel.png", entryThrows: true }]);
    seen = null;
    await drop(b.dt);
    out.throwingSeen = seen;
    out.throwingEntryFileCalls = b.log.entryFile;

    // ---- 3. a directory still uses the entries API (getAsFile gives a useless stub for one) ----
    var c = mkTransfer([{ name: "UserSkins", dir: true }]);
    seen = null;
    await drop(c.dt);
    out.dirReadAsEntry = c.log.asEntry;
    out.dirWasWalked = c.log.readDir.length > 0;

    // ---- 4. a directory whose walk fails must SAY so, not claim the drop was empty ----
    var d = mkTransfer([{ name: "War Thunder", dir: true, entryThrows: true }]);
    seen = null;
    await drop(d.dt);
    out.failedWalkStatus = status();
    out.failedWalkSeen = seen;
  } finally {
    addFiles = realAdd;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 700), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const eq = (got, want, m) => R.is(JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) === JSON.stringify(want) ? `${m}  →  ${JSON.stringify(got)}`
    : `${m}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);

console.log("=== loose files never go through the entries API ===");
eq(r.looseSeen, ["hull_c.dds", "hull_n.dds"], "both dropped files reach addFiles");
eq(r.looseAsFile, ["hull_c.dds", "hull_n.dds"], "each was taken with getAsFile()");
eq(r.looseEntryFileCalls, [], "and entry.file() was never called — the call that fails on a file:// page");

console.log("\n=== the reported failure ===");
eq(r.throwingSeen, ["roundel.png"], "a file whose entry would throw EncodingError still arrives");
eq(r.throwingEntryFileCalls, [], "because nothing asks its entry for it any more");

console.log("\n=== folders still need entries ===");
eq(r.dirReadAsEntry, ["UserSkins"], "a dropped folder is taken as an entry");
R.is(r.dirWasWalked, "and it is walked");

console.log("\n=== a failed walk is reported, not swallowed ===");
R.is(/Could not read that dropped folder/.test(r.failedWalkStatus || ""),
  `the status says the folder could not be read → ${JSON.stringify(r.failedWalkStatus)}`);
R.is(/Open it another way/.test(r.failedWalkStatus || ""),
  "…and names the way that works from disk — the file chooser (ROADMAP 4.48), since a double-clicked page is what this test loads");
R.is(!/Nothing usable in that drop/.test(r.failedWalkStatus || ""),
  "and does NOT claim the drop was empty, which is how the real error stayed invisible");
eq(r.failedWalkSeen, null, "nothing was loaded from it");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
