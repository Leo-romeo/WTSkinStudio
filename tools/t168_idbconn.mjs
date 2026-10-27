// One IndexedDB connection, reused (ROADMAP 1.25, found 2026-10-24).
//
// `idb()` used to open a new connection on every call and nobody closed it, so every read and write
// of brush tips, presets, the decal library and the remembered folder left one more connection open
// for the life of the page. Measured 2026-10-24: in a page with only the boot's calls behind it,
// `indexedDB.deleteDatabase("wtss")` waited 29 s for them. A version upgrade (a second object
// store) would be blocked the same way, by the page's own connections.
//
// What this reads, in the booted page:
//   * N calls of idbGet/idbSet open at most one connection between them (indexedDB.open counted);
//   * deleteDatabase then answers at once and is never `blocked` — the cached connection closes
//     itself on `versionchange`;
//   * the next idbSet/idbGet reopens and round-trips a value through a fresh database;
//   * CONTROL: the same N opens done the old way (open, use, never close) must make deleteDatabase
//     report `blocked`. If the control does not block, the instrument is blind and the test says so.
//
// Usage: node tools/t168_idbconn.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const N = 20;
const R = makeReport();

const BODY = `async function(){
  var N = ${N};
  function del(){
    return new Promise(function(res){
      var t0 = performance.now(), blocked = false;
      var rq = indexedDB.deleteDatabase("wtss");
      rq.onblocked = function(){ blocked = true; };
      rq.onsuccess = function(){ res({ ms: performance.now() - t0, blocked: blocked, ok: true }); };
      rq.onerror = function(){ res({ ms: performance.now() - t0, blocked: blocked, ok: false }); };
      // Never wait the 29 s the bug did: an answer this late is a failure either way.
      setTimeout(function(){ res({ ms: performance.now() - t0, blocked: blocked, ok: false, late: true }); }, 4000);
    });
  }
  var realOpen = indexedDB.open.bind(indexedDB), opens = 0;
  indexedDB.open = function(){ opens++; return realOpen.apply(null, arguments); };
  try {
    var out = {};
    for (var i = 0; i < N; i++) { await idbSet("t168_" + i, i); await idbGet("t168_" + i); }
    out.opens = opens;
    out.del = await del();
    opens = 0;
    await idbSet("t168_after", "back");
    out.after = await idbGet("t168_after");
    out.reopens = opens;
    await idbDel("t168_after");

    // CONTROL: the old idb(), N times over, connections dropped without close().
    var leaked = [];
    for (var j = 0; j < N; j++) {
      leaked.push(await new Promise(function(res, rej){
        var rq = realOpen("wtss", 1);
        rq.onupgradeneeded = function(){ rq.result.createObjectStore("kv"); };
        rq.onsuccess = function(){ res(rq.result); };
        rq.onerror = function(){ rej(rq.error); };
      }));
    }
    var pending = del();
    await new Promise(function(r){ setTimeout(r, 300); });
    leaked.forEach(function(db){ db.close(); });
    out.control = await pending;
    return out;
  } finally { indexedDB.open = realOpen; }
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 60000, keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log(`=== ${N} reads and ${N} writes ===`);
R.is(r.opens <= 1, `they opened ${r.opens} connection(s) between them (at most 1)`);
R.is(r.del.ok && !r.del.blocked, `deleteDatabase then went through at once: ${r.del.ok ? "done" : "no answer"} in ${r.del.ms.toFixed(0)} ms, ${r.del.blocked ? "BLOCKED" : "never blocked"}`);
R.is(r.after === "back" && r.reopens === 1, `the next write and read reopen once (${r.reopens}) and round-trip through the fresh database (${JSON.stringify(r.after)})`);
console.log("=== control: the same opens, never closed ===");
R.is(r.control.blocked, `deleteDatabase reports blocked behind ${N} unclosed connections (${r.control.blocked ? "blocked" : "NOT blocked — the instrument is blind"})`);
R.finish();
