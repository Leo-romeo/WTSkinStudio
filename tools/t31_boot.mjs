// Does the page actually BOOT — with no network? check.mjs proves every inline script parses;
// nothing proved the app runs. A typo'd identifier, a `const` read before its block evaluated, a
// missing DOM id — all of those parse fine and then throw on load, and until now the only way to
// find out was to open the file by hand.
//
// It loads a copy of the page in headless Chrome with an error trap injected ahead of everything
// else, then asserts the app reached a usable state: no uncaught error, the functions the export
// path needs are defined, the panels exist, and initialisation finished.
//
// This is also the check for CLAUDE.md §5 definition-of-done #3 — the app opens from a file:// URL
// with no network — and since 2026-09-26 (ROADMAP 4.50 (1)) that is meant literally. The page is
// booted with the network switched off from before its first request; three.js and JSZip must come
// up anyway, at the versions `src/index.html` names; and neither the page nor any worker it starts
// may have asked the network for anything at all. Until then both libraries came from cdnjs, and
// this test forgave every error it could pin on them whenever they failed to arrive — so it could
// not tell an offline page from a broken one, and the one promise it existed to hold, "opens with no
// network", was never true.
//
// THE CONTROL. "Network off" is a switch in the harness, and a switch that silently stopped working
// would let the page pass for the wrong reason: it would still boot, because it would have been
// online. So the same switch first boots the page `npm run build:cdn` writes, which fetches the two
// libraries, and requires that page to FAIL — both cdnjs requests refused as
// ERR_INTERNET_DISCONNECTED, no THREE, and the boot guard telling the user to check the connection.
// Measured 2026-09-26 on a machine that reaches cdnjs (the old online run loaded both from it):
// the control's two requests failed exactly so, and the page fell back to the boot guard.
//
// The control also carries a probe the log has to see: a worker, and a worker that worker starts,
// each fetching at boot. A worker is its own target, and until the review of 4.50 (1) the log only
// listened to the page's — a worker's request went unrecorded, so "asked the network for nothing"
// could pass over one (tools/headless.mjs, goOffline, has the measurement). The probe's two fetches
// must now be in the log, from workers, refused by the same switch. They go to this machine
// (127.0.0.1), so even a switch that failed would keep them on it, and to a port Chrome does not
// block: the first probe used port 9, the discard port, and one of its two fetches came back
// ERR_UNSAFE_PORT — refused by Chrome's port blocklist before the switch was consulted, which would
// have let a switch that had stopped working in workers pass. On 65535 the only thing that refuses
// them is the switch; without it they would fail as ERR_CONNECTION_REFUSED, which fails this check.
// The probe also opens a WebSocket from the page, because a WebSocket never arrives as a request:
// the log has to catch it on its own event, and does.
//
// THE DAMAGED COPY. With the libraries inside the page they cannot fail to arrive, so the boot
// guard's other sentence — "this copy of the page is damaged" — is what a user sees if three.js's
// script is corrupted. The third boot corrupts it and reads that sentence back, so the branch nothing
// else reaches is not left to be discovered by the first person it happens to.
//
// Usage: node tools/t31_boot.mjs [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";
import { build, inlineScript } from "./build.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// The pins, as the page names them. The file names carry the versions (src/index.html says why),
// so what runs is held to what the tag list claims.
const indexHtml = fs.readFileSync(path.join(ROOT, "src", "index.html"), "utf8");
const threePin = (/"\.\/vendor\/three-r(\d+)\.min\.js"/.exec(indexHtml) || [])[1];
const zipPin = (/"\.\/vendor\/jszip-(\d+\.\d+\.\d+)\.min\.js"/.exec(indexHtml) || [])[1];
R.is(threePin && zipPin, `src/index.html names the vendored copies: three.js r${threePin}, JSZip ${zipPin}`);

// A request that left the machine. `file:`, `blob:` and `data:` are the page talking to itself.
const toNetwork = q => /^(https?|wss?|ftp):/i.test(q.url);
const offlineErr = q => /ERR_INTERNET_DISCONNECTED/.test(q.failed || "");
const workersOf = run => `${run.watched.length} worker(s) watched` + (run.notes.length ? `; ${run.notes.join("; ")}` : "");

// every one of these is load-bearing for export
const WANT_FN = ["validateExport", "buildExportPlan", "updateExportValidation", "slotRole", "escHtml",
  "BCnEnc.encodeBC3", "BCnEnc.writeDDS", "writeTGA", "padSeams", "BCnEnc.buildMips", "collectExports", "buildBlk",
  "estimateBytes", "makeWorkerPool", "pageSections", "sectionSource", "exportPool", "encodeJob"];
const WANT_EL = ["expValidate", "expValidateSum", "expValidateList", "expWarn", "expList", "btnExport", "status"];

const BODY = `async function(){
  var want = ${JSON.stringify(WANT_FN)}, els = ${JSON.stringify(WANT_EL)};
  return {
    missingFn: want.filter(function(n){ try { return typeof eval(n) !== "function"; } catch (e) { return true; } }),
    missingEl: els.filter(function(n){ return !document.getElementById(n); }),
    three: typeof window.THREE,
    threeRev: window.THREE ? String(THREE.REVISION) : null,
    jszip: typeof window.JSZip,
    zipVer: window.JSZip ? String(JSZip.version) : null,
    status: (document.getElementById("status") || {}).textContent || "",
    cores: navigator.hardwareConcurrency,
    poolSize: poolSize(),
    offscreen: typeof OffscreenCanvas,
    worker: (function(){
      try {
        var u = URL.createObjectURL(new Blob(["self.onmessage=function(){self.postMessage(1)}"], { type: "text/javascript" }));
        var w = new Worker(u); w.terminate(); URL.revokeObjectURL(u);
        return "constructed";
      } catch (e) { return "FAILED: " + e.name + ": " + e.message; }
    })()
  };
}`;

// ---------- the control: a page that NEEDS the network, with the network off ----------
console.log("=== control: the page `npm run build:cdn` writes, booted with the network off, must fail ===");
const PROBE_URL = "https://127.0.0.1:65535/t31-worker-probe", NESTED_URL = "https://127.0.0.1:65535/t31-nested-worker-probe";
const nestedSrc = `fetch(${JSON.stringify(NESTED_URL)}).then(function(){postMessage("nested worker: loaded")},` +
  `function(e){postMessage("nested worker: "+e.message)})`;
const workerSrc = `fetch(${JSON.stringify(PROBE_URL)}).then(function(){postMessage("worker: loaded")},` +
  `function(e){postMessage("worker: "+e.message)});` +
  `var n=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(nestedSrc)}],{type:"text/javascript"})));` +
  `n.onmessage=function(e){postMessage(e.data)};`;
const WS_URL = "ws://127.0.0.1:65535/t31-websocket-probe";
const PROBE = `<script>
window.__probe = Promise.all([
  new Promise(function(done){
    var got = [], w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSrc)}], { type: "text/javascript" })));
    w.onmessage = function(e){ got.push(e.data); if (got.length === 2) done(got.sort()); };
  }),
  new Promise(function(done){
    var s = new WebSocket(${JSON.stringify(WS_URL)});
    s.onopen = function(){ done("websocket: opened"); s.close(); };
    s.onclose = function(e){ done("websocket: closed " + e.code); };
  })
]).then(function(r){ return r[0].concat([r[1]]); });
</script>
`;
const CONTROL = `async function(){
  var probe = await Promise.race([window.__probe,
    new Promise(function(r){ setTimeout(function(){ r(["(the probe's workers did not answer in 10 s)"]); }, 10000); })]);
  return { three: typeof window.THREE, jszip: typeof window.JSZip, probe: probe,
           status: (document.getElementById("status") || {}).textContent || "" };
}`;
const ctl = await evalInPage({ browser, html: build(undefined, { cdn: true }).html, inject: PROBE,
  expr: pageExpr(CONTROL, 600), timeoutMs: 60000, offline: true });
if (!ctl.ok) { console.log("FAIL: the control did not run: " + ctl.reason); process.exit(1); }
const ctlNet = ctl.requests.filter(toNetwork);
const cdn = ctlNet.filter(q => /^https:\/\/cdnjs\.cloudflare\.com\//.test(q.url));
R.is(cdn.length === 2 && cdn.every(q => q.from === "page" && offlineErr(q)),
  cdn.length === 2 && cdn.every(offlineErr)
    ? "the switch works: the CDN page's two cdnjs requests were refused as " + cdn[0].failed
    : "the network switch did not hold — the CDN page's cdnjs requests: " +
      (cdn.map(q => q.url + " → " + (q.failed || "LOADED")).join(", ") || "none"));
R.is(ctl.result.three === "undefined",
  `and so that page has no THREE (typeof THREE: ${ctl.result.three}) — which is what this page used to do offline`);
R.is(/three\.js/.test(ctl.result.status) && /check your connection/.test(ctl.result.status),
  `its boot guard names the library and the cause: "${ctl.result.status.slice(0, 100)}"`);

// The log sees workers, and the switch holds in them.
const probes = [PROBE_URL, NESTED_URL].map(u => ctlNet.find(q => q.url === u));
R.is(probes.every(q => q && q.from === "worker" && offlineErr(q)), probes.every(q => q && q.from === "worker")
  ? `the log sees workers: a worker's and a nested worker's fetch at boot are both in it, from workers, ` +
    `each refused as ${probes.map(q => q.failed).join(" / ")} (${workersOf(ctl)})`
  : "a worker's fetch is missing from the log, or not attributed to a worker: " +
    probes.map((q, i) => (q ? `${q.url} from ${q.from} → ${q.failed || "LOADED"}` : `${[PROBE_URL, NESTED_URL][i]} not logged`)).join(", ") +
    ` (${workersOf(ctl)})`);
const probeSaid = ctl.result.probe || [];
R.is(probeSaid.length === 3 && probeSaid.slice(0, 2).every(s => /: Failed to fetch$/.test(s)) && /^websocket: closed/.test(probeSaid[2]),
  `and the probe's fetches and its WebSocket really ran, and failed where they ran: ${JSON.stringify(probeSaid)}`);
// A WebSocket never arrives as a request (headless.mjs says so), so the log has to have caught it
// on its own event.
const ws = ctlNet.find(q => q.url === WS_URL);
R.is(ws && ws.ws && ws.from === "page", ws ? `the log sees a WebSocket the page opens (${ws.url}, from the ${ws.from})`
  : "a WebSocket the page opened is missing from the log");
R.is(ctlNet.length === 5, ctlNet.length === 5 ? "nothing else in the control asked the network"
  : `the control asked the network for ${ctlNet.length} thing(s), not 5: ` + ctlNet.map(q => q.url).join(", "));

// ---------- the page itself, with the network off ----------
console.log("\n=== the page, booted with the network off ===");
const run = await evalInPage({ browser, expr: pageExpr(BODY, 1200), timeoutMs: 60000, keep: argv.includes("--keep"), offline: true });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the page threw before it could report\n" + r.__threw); process.exit(1); }

const asked = run.requests.filter(toNetwork);
R.is(asked.length === 0, asked.length
  ? `the page asked the network for ${asked.length} thing(s) — ` + asked.map(q => `${q.url} (${q.from})`).join(", ")
  : `the page asked the network for nothing (${run.requests.length} request(s), all file:, blob: or data:; ${workersOf(run)})`);
R.is(r.three === "object" && r.threeRev === threePin,
  `three.js is up with no network, at the pinned revision (THREE.REVISION ${r.threeRev}, page names r${threePin})`);
R.is(r.jszip === "function" && r.zipVer === zipPin,
  `JSZip is up with no network, at the pinned version (JSZip.version ${r.zipVer}, page names ${zipPin})`);

// Nothing is forgiven any more: there is no network failure left to blame. But "no errors" only
// means something if the trap ran: the harness injects it ahead of the first "<script" in the page,
// so a comment above the first real tag that mentions one would swallow it, and every error with
// it. The page's header comments grew in 4.50 (1), which is when this was worth asserting.
R.is(Array.isArray(r.__errs), Array.isArray(r.__errs) ? "the error trap ran ahead of the page's own scripts"
  : "the error trap never ran, so no error could have been seen — does a comment above the first script tag mention one?");
const errs = r.__errs || [];
R.is(errs.length === 0, errs.length ? `${errs.length} uncaught error(s) during boot:\n        ` + errs.join("\n        ")
  : "no uncaught errors during boot");
const rejs = r.__rejs || [];
R.is(rejs.length === 0, rejs.length ? `${rejs.length} unhandled rejection(s):\n        ` + rejs.join("\n        ")
  : "no unhandled promise rejections");

R.is(r.missingFn.length === 0, r.missingFn.length ? "not defined after load: " + r.missingFn.join(", ")
  : `all ${WANT_FN.length} export-path and worker-pool functions are defined`);
R.is(r.missingEl.length === 0, r.missingEl.length ? "missing DOM ids: " + r.missingEl.join(", ")
  : `all ${WANT_EL.length} panel elements are in the DOM`);
R.is(!!r.status, r.status ? `status line reads: "${r.status.slice(0, 80)}"` : "the status line is empty — the app did not finish initialising");

// Capabilities Phase 1 depends on, reported from a real file:// document rather than assumed.
R.is(r.worker === "constructed", r.worker === "constructed"
  ? `Worker from a blob: URL constructs on a file:// page (${r.cores} cores, pool would be ${r.poolSize})`
  : "Worker from a blob URL on file://: " + r.worker);
R.is(r.offscreen === "function", `OffscreenCanvas is ${r.offscreen === "function" ? "available (ROADMAP 1.4)" : "MISSING: " + r.offscreen}`);

// ---------- a damaged copy: three.js's script corrupted, the network still off ----------
console.log("\n=== a damaged copy: three.js's script corrupted, booted with the network off ===");
// The corruption is a body that throws at parse and so defines nothing — the one way this page can
// arrive without three.js. (A copy cut short cannot: the boot guard's own script is third from the
// end of the page, so truncation takes it before it could take three.js.)
const page = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
const threeRel = `vendor/three-r${threePin}.min.js`;
const threeTag = inlineScript(threeRel, fs.readFileSync(path.join(ROOT, "src", threeRel), "utf8").replace(/\r?\n$/, ""));
const threeAt = page.indexOf(threeTag);
R.is(threeAt > 0, `three.js's inline script is found in the page, to be damaged (at byte ${threeAt})`);
const DAMAGED = `async function(){
  return { three: typeof window.THREE, status: (document.getElementById("status") || {}).textContent || "",
           welcome: (document.getElementById("welcome") || {}).textContent || "" };
}`;
const dmg = await evalInPage({ browser, html: page.slice(0, threeAt) + "<script>\n!function(){\n</script>" + page.slice(threeAt + threeTag.length),
  expr: pageExpr(DAMAGED, 600), timeoutMs: 60000, offline: true });
if (!dmg.ok) { console.log("FAIL: the damaged copy did not run: " + dmg.reason); process.exit(1); }
const dmgNet = dmg.requests.filter(toNetwork);
R.is(dmg.result.three === "undefined" && dmgNet.length === 0, dmgNet.length
  ? "the damaged copy asked the network for " + dmgNet.map(q => q.url).join(", ")
  : `the damaged copy has no THREE (typeof THREE: ${dmg.result.three}) and asked the network for nothing`);
R.is(/three\.js/.test(dmg.result.status) && /this copy of the page is damaged; download it again/.test(dmg.result.status),
  `its boot guard says the copy is damaged, not that the connection is: "${dmg.result.status.slice(0, 110)}"`);
R.is(/This copy of the page is damaged/.test(dmg.result.welcome) && !/Offline/.test(dmg.result.welcome),
  `and the welcome card says what to do: "${(/This copy[^.]*\.[^.]*\./.exec(dmg.result.welcome) || [dmg.result.welcome.slice(-120)])[0]}"`);
R.finish();
