// The harness itself: an evaluate must land in the page's own document, never in the initial
// empty one (tools/headless.mjs, `pageContext`).
//
// THE BUG. Chrome exposes the page target — and `/json/list` reports its final URL — before the
// command-line navigation commits. An attach that wins that race binds to the **initial empty
// document**, whose `document.readyState` is already "complete", so `pageExpr`'s wait-for-load
// resolves immediately; the real document then replaces the context under the pending promise and
// CDP answers "Execution context was destroyed.", with nothing in Chrome's stderr. Measured
// 2026-08-05: 1 attach in 6 with a tight poll, and in one `npm test` it took out `decode`,
// `nooodle` and `decallib` together — three unrelated tests, each dying in 0.7–0.8 s, i.e. at
// attach. It read as "the decal-library test is flaky" only because the full suite is the thing
// that loads the machine.
//
// Two checks, in that order:
//
//   1. DETERMINISTIC, and the one with the power. `evalInPage` always launches with the page's URL
//      already on the command line, so the losing side of the race cannot be forced from outside
//      it — it depends on machine load. So this parks a browser on about:blank, which IS the losing
//      state, and drives `pageContext` (the repaired function) against it directly: it must REFUSE
//      to return the empty document's context, and must return the real one once it exists.
//   2. REPETITION, a smoke check over the real `evalInPage` with the attach poll as tight as Chrome
//      will answer. Honest about what it is worth: this reproduced the failure ~1 run in 6 while
//      the machine was busy and 0 in 12 while it was idle, so it catches a regression only under
//      load. Check 1 is what holds the line.
//
// Usage: node tools/t43_harness.mjs [--runs N] [--chrome <path>]
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { findBrowser, evalInPage, pageExpr, makeReport, connect, pageContext } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const RUNS = argv.includes("--runs") ? +argv[argv.indexOf("--runs") + 1] : 8;
const R = makeReport();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A page small enough that a launch costs a browser start and nothing else. `evalInPage` inserts
// its error trap before the first `<script>`, so there has to be one.
const PAGE = `<!DOCTYPE html><html><head><title>harness</title></head><body><div id="x">page</div>
<script>window.__isRealPage = true; window.__marker = "the-real-document";</script>
</body></html>`;

const BODY = `async function(){
  return { href: location.href, marker: window.__marker || null, real: !!window.__isRealPage,
           ready: document.readyState, body: (document.getElementById("x")||{}).textContent || null };
}`;

console.log("=== 1. pageContext() refuses the initial empty document ===");
// Chrome is parked on about:blank and navigated to the page only once the assertions below have
// run, so the losing side of the race is the starting state rather than a matter of luck.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wtharn-"));
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, PAGE);
  const profile = path.join(dir, "profile");
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    "--user-data-dir=" + profile, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });

  let err = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null, target = null;
    for (let i = 0; i < 400 && !port; i++) {
      try { const t = fs.readFileSync(portFile, "utf8").split("\n")[0].trim(); if (/^\d+$/.test(t)) port = t; } catch { /* not yet */ }
      if (!port) await sleep(50);
    }
    for (let i = 0; i < 400 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(t => t.type === "page" && t.webSocketDebuggerUrl) || null;
      } catch { /* not yet */ }
      if (!target) await sleep(50);
    }
    R.is(target && target.url === "about:blank", `the target really is the empty document → ${JSON.stringify(target && target.url)}`);

    const cdp = await connect(target.webSocketDebuggerUrl);
    const origins = [];
    cdp.on((method, p) => {
      if (method === "Runtime.executionContextCreated" && p.context.auxData && p.context.auxData.isDefault)
        origins.push(p.context.origin);
    });

    // The whole claim: offered nothing but the empty document, it must WAIT rather than answer.
    // Before the fix, `Runtime.evaluate` would simply have used this context.
    const refused = await pageContext(cdp, 2500, 50).then(id => "returned " + id, e => e.message);
    R.is(/timed out waiting for the page's own document/.test(refused),
      `it waits instead of binding to it → ${JSON.stringify(refused)}`);
    R.is(origins.length === 1 && origins[0] === "://",
      `and the only context on offer was the empty one, origin "://" → ${JSON.stringify(origins)}`);

    // An evaluate in that context is the reported symptom, once the real document replaces it.
    const staleId = 1;
    await cdp.send("Page.navigate", { url: "file:///" + page.replace(/\\/g, "/") });
    const got = await pageContext(cdp, 15000, 50);
    R.is(origins.length === 2 && /^file:/.test(origins[1]),
      `after navigating, a second real context appears → ${JSON.stringify(origins)}`);
    R.is(got !== staleId, `and pageContext picks that one, not the empty one → context ${got} (empty was ${staleId})`);

    const live = await cdp.send("Runtime.evaluate", { expression: "window.__marker", returnByValue: true, contextId: got });
    R.is(live.result.value === "the-real-document", `evaluating in it reaches the page → ${JSON.stringify(live.result.value)}`);
    const stale = await cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true, contextId: staleId })
      .then(() => "(no error)", e => e.message);
    R.is(/context/i.test(stale), `while the empty one is gone, which is the reported symptom → ${JSON.stringify(stale)}`);
    cdp.close();
  } catch (e) { err = e; }
  child.kill();
  // Same leak as tools/headless.mjs had: the kill is asynchronous, so Chrome still owns every file
  // in the profile and `rmSync` throws EBUSY. Nothing empties %TEMP% on Windows, so the directory
  // stayed for good. Wait for the exit, then retry past the lock; say so if it still will not go.
  await new Promise(res => {
    if (child.exitCode !== null) return res();
    child.once("exit", res);
    setTimeout(res, 5000);
  });
  for (let i = 0; ; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); break; }
    catch (e) {
      if (i >= 19) { console.error(`t43: could not remove ${dir} (${e.code || e.message})`); break; }
      await sleep(100);
    }
  }
  if (err) R.bad("the deterministic case could not be set up: " + err.message);
}

console.log("\n=== 2. the real attach path, polled as fast as Chrome will answer ===");
// attachPollMs: 0 is the setting that made the race reproducible — but only on a busy machine
// (~1 run in 6 during a concurrent `npm test`, 0 in 12 on an idle one). Kept as a smoke check over
// the whole path; check 1 above is the one that fails deterministically if the fix is removed.
{
  let ok = 0, bad = [];
  for (let i = 1; i <= RUNS; i++) {
    const run = await evalInPage({ browser, html: PAGE, expr: pageExpr(BODY, 250), timeoutMs: 30000, attachPollMs: 0 });
    if (!run.ok) { bad.push(`run ${i}: ${String(run.reason).split("\n")[0]}`); continue; }
    const r = run.result;
    if (r.real === true && r.marker === "the-real-document" && /\/page\.html$/.test(r.href || "") && r.body === "page") ok++;
    else bad.push(`run ${i}: answered from the wrong document → ${JSON.stringify(r)}`);
  }
  R.is(ok === RUNS, `${ok}/${RUNS} tight attaches landed in the page's own document` +
    (bad.length ? "\n         " + bad.join("\n         ") : ""));
}

R.finish();
