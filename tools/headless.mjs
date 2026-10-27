// Shared harness for the tests that need a real browser but should still run in `npm test`.
//
// It drives headless Chrome over the DevTools Protocol: load a copy of the page from a file:// URL,
// evaluate an async expression in it, await the promise, get the value back. Node 22 has both
// `fetch` and `WebSocket` built in, so this needs no dependencies.
//
// The obvious cheaper approach — `--virtual-time-budget` plus `--dump-dom` — does NOT work for
// anything involving a Worker, and the way it fails is quiet. Chrome's virtual clock races ahead
// whenever the page is idle, and a page awaiting a worker reply is idle: the budget is exhausted
// and the DOM dumped before the reply crosses the thread boundary, so every worker test reports a
// timeout that never happened. (Measured 2026-08-04: a 4 s virtual timer beat every worker round
// trip, while a 4x4 encode that took the same path succeeded — the inconsistency is what gave it
// away.) A synchronous busy-wait on `performance.now()` under virtual time never terminates at
// all. Real time, driven over CDP, has neither problem.
//
// The older browser test (t28) still prints a page for a human to open; it compares rendered
// pixels, where a person looking at the output is worth something. These are assertions.
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { killTree } from "./lanes.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function findBrowser(explicit) {
  const cands = [explicit, process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return cands.find(p => { try { return p && fs.existsSync(p); } catch { return false; } }) || null;
}

// An error trap that must evaluate before anything else on the page.
//
// A RESOURCE that fails to load also fires "error" in the capture phase, and that event carries no
// `message`, no `filename` and no `lineno` — so it used to be recorded as the literal string
// `error @ ?:0`, which names nothing and matches no filter. Every test here filters CDN failures by
// looking for `three|jszip|cdnjs` in the text, so a three.js tag that failed produced an
// unattributable, unfilterable error and a test that failed on a network hiccup rather than on the
// code. (Seen 2026-08-06 in t42, which passes on its own and failed once inside a full-suite run
// with several Chrome instances up.) `e.target` is the element for exactly these events, so say
// which resource it was and the filters work again.
export const TRAP = `<script>
window.__boot = { errs: [], rejs: [] };
window.addEventListener("error", function(e){
  var t = e.target;
  if (t && t !== window && t.tagName) {
    window.__boot.errs.push("resource <" + t.tagName.toLowerCase() + "> failed to load: " + (t.src || t.href || "?"));
    return;
  }
  window.__boot.errs.push((e.message || "error") + " @ " + (e.filename || "?") + ":" + (e.lineno || 0));
}, true);
window.addEventListener("unhandledrejection", function(e){ window.__boot.rejs.push(String((e.reason && e.reason.message) || e.reason)); });
</script>
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// `fn` throwing means "not ready yet" — a port file that does not exist, a CDP endpoint that is not
// listening. `fatal` is the separate question "is there any point still waiting": it returns a
// message when the thing being waited on can never arrive, and that is reported instead of a
// timeout. Without it, a browser that died at launch cost the full budget and was then blamed on
// being slow.
async function waitFor(fn, ms, what, everyMs = 100, fatal) {
  const until = Date.now() + ms;
  for (;;) {
    const stop = fatal && fatal();
    if (stop) throw new Error("gave up waiting for " + what + ": " + stop);
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error("timed out waiting for " + what);
    await sleep(everyMs);
  }
}

// A minimal CDP client: send(method, params) -> Promise<result>, plus `on` for events.
// Exported alongside `pageContext` so `tools/t43_harness.mjs` can test the attach rule directly
// against a browser it has parked on the empty document — the state that cannot be forced from
// outside `evalInPage`, because that always launches with the page's URL already on the command line.
//
// `sessionId` addresses a target attached in flat mode (`Target.setAutoAttach` with `flatten`) —
// a worker the page started — over this same socket; listeners get it as a third argument, and
// events from the connected target itself arrive without one. Only `goOffline` attaches anything.
export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params, sessionId) {
        return new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej });
          ws.send(JSON.stringify(sessionId ? { id: n, method, params: params || {}, sessionId }
            : { id: n, method, params: params || {} }));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch { /* already gone */ } },
    });
    ws.onerror = e => reject(new Error("CDP websocket failed: " + (e.message || "connection refused")));
    // A browser that dies closes the socket, and every command still waiting on it must say so.
    // Without this a send pending at that moment never settled, and the test hung with nothing
    // left to wait for — seen 2026-10-22 under the suite's lanes (ROADMAP 0.4): a Chrome whose
    // main process was gone, and a Node that sat on `Runtime.enable` for 15 minutes.
    ws.onclose = () => {
      reject(new Error("CDP websocket closed before it opened"));
      for (const { rej } of pending.values()) rej(new Error("CDP websocket closed (the browser went away)"));
      pending.clear();
    };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
        return;
      }
      if (m.method) for (const fn of listeners) fn(m.method, m.params || {}, m.sessionId);
    };
  });
}

// Switch a target's network off, then send it to `url` — see `offline` in evalInPage. Returns a
// live log that keeps filling for as long as the page runs, so the caller reads it after its
// evaluate rather than now: `net`, one entry per request — { url, from, failed } with `from` "page"
// or the starting target's type ("worker") and `failed` the error text when it failed — plus
// `watched`, every target the page started, and `notes`, anything that could not be armed.
//
// WORKERS ARE THEIR OWN TARGETS, and a page-only log cannot see them. Measured 2026-09-26 on Chrome
// 154 (the review of 4.50 (1)): with the page's network off and a blob: worker fetching at boot, the
// page's session reported the page's own request and the worker's script, and never the worker's
// fetch — which still ran, so "asked the network for nothing" could pass over a worker that asked.
// So every target the page starts is auto-attached in flat mode, paused before its first line
// (`waitForDebuggerOnStart`), given `Network.enable`, the switch, and the same auto-attach for the
// workers IT starts, and only then let go. Measured the same day: the worker's and a nested worker's
// fetches are then logged on their own sessions.
//
// The switch on a worker's session is ANSWERED "Not supported" and must be sent anyway. A worker the
// page starts is offline under the page's switch alone, but a worker that worker starts is not:
// without the call its fetch went out and met this machine's closed port (ERR_CONNECTION_REFUSED);
// with it, refused as ERR_INTERNET_DISCONNECTED like the rest (Chrome 154, 2026-09-26: four runs
// without the call, all four went out; five with it, all five refused). So the call is sent, its
// "Not supported" is expected and not a note, and t31's control checks on every run that both kinds
// of worker are refused by the switch.
const OFF = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
async function goOffline(cdp, url) {
  const net = new Map(), watched = [], notes = [];
  const log = (method, p, from) => {
    const key = from + "/" + p.requestId;              // request ids are per target, not per browser
    if (method === "Network.requestWillBeSent") net.set(key, { url: p.request.url, from: from === "page" ? "page" : from.split("/")[0] });
    // A WebSocket is not a request to this domain: it arrives as webSocketCreated and never as
    // requestWillBeSent, so a log of requests alone would not see one opened (t31's probe opens one).
    else if (method === "Network.webSocketCreated") net.set(key, { url: p.url, from: from === "page" ? "page" : from.split("/")[0], ws: true });
    else if (method === "Network.loadingFailed" && net.has(key)) net.get(key).failed = p.errorText;
  };
  const sessions = new Map();                          // sessionId -> "worker/<id>", for `from`
  const AUTO = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
  cdp.on((method, p, sessionId) => {
    if (method.startsWith("Network.")) return log(method, p, sessionId ? sessions.get(sessionId) || "unknown/" + sessionId : "page");
    if (method !== "Target.attachedToTarget") return;
    const s = p.sessionId, what = p.targetInfo.type + " " + p.targetInfo.url;
    sessions.set(s, p.targetInfo.type + "/" + s);
    watched.push(what);
    (async () => {
      try {
        await cdp.send("Network.enable", {}, s);
        await cdp.send("Network.emulateNetworkConditions", OFF, s).catch(e => {
          if (!/Not supported/i.test(e.message)) throw e;  // the expected answer — see above
        });
        await cdp.send("Target.setAutoAttach", AUTO, s);
      } catch (e) { notes.push(what + " could not be watched: " + e.message); }
      // Always let it run: a worker left paused is a pool that never answers, and the test would
      // time out blaming the page.
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, s).catch(e => notes.push(what + " could not be resumed: " + e.message));
    })();
  });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", OFF);
  await cdp.send("Target.setAutoAttach", AUTO);
  const nav = await cdp.send("Page.navigate", { url });
  if (nav.errorText) throw new Error("the page would not open with the network off: " + nav.errorText);
  return { net, watched, notes };
}

/**
 * The execution context of the page's OWN document — the one every evaluate must be pinned to.
 *
 * THE BUG THIS EXISTS FOR. Chrome writes `DevToolsActivePort` and exposes the page target *before*
 * the command-line navigation commits, and `/json/list` reports the target's final URL while that
 * is still pending. So an attach that wins the race binds to the **initial empty document**
 * (origin `://`). `document.readyState` there is already `"complete"`, so `pageExpr`'s wait-for-load
 * resolves at once and the settle timer starts; the real document then replaces the context under
 * the pending promise and CDP answers **"Execution context was destroyed."** — with nothing at all
 * in Chrome's stderr to say why.
 *
 * Measured 2026-08-05 with a deliberately tight attach loop: 1 run in 6. In `npm test` it hit
 * `decode`, `nooodle` and `decallib` in a single run — three different tests, each failing in
 * 0.7–0.8 s, i.e. at attach and nowhere near their own code. That is why it read as "a flaky
 * decal-library test": it is load-dependent, and the full suite is the only thing that loads the
 * machine.
 *
 * Waiting for `Page.loadEventFired` is NOT sufficient, because the empty document fires one of its
 * own. Identity is settled by asking the candidate context for its `location.href`: the empty
 * document answers `about:blank`, so it can never be mistaken for the page.
 */
export async function pageContext(cdp, ms, everyMs) {
  const seen = new Set();                       // default contexts currently alive, newest last
  cdp.on((method, p, sessionId) => {
    if (sessionId) return;                      // a worker's session (goOffline), never the page's document
    if (method === "Runtime.executionContextCreated" && p.context && p.context.auxData && p.context.auxData.isDefault)
      seen.add(p.context.id);
    else if (method === "Runtime.executionContextDestroyed") seen.delete(p.executionContextId);
    else if (method === "Runtime.executionContextsCleared") seen.clear();
  });
  // `Runtime.enable` replays executionContextCreated for contexts that already exist, so this
  // catches both "we attached early" and "we attached late".
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return waitFor(async () => {
    for (const id of [...seen].reverse()) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "location.href", returnByValue: true, contextId: id,
      }).catch(() => null);                     // this very context may have just gone; try the next
      const href = r && r.result && r.result.value;
      if (typeof href === "string" && /\/page\.html$/.test(href)) return id;
    }
    return null;
  }, ms, "the page's own document (not the initial empty one)", everyMs);
}

/**
 * Load the page (with optional injected HTML) and evaluate `expr` in it.
 * `expr` must be a JS expression evaluating to a Promise of a JSON-serialisable value.
 * Returns { ok, result } or { ok:false, reason }.
 */
//
// ONE RELAUNCH, for a launch that never attaches. Under the suite's six lanes (ROADMAP 0.4,
// 2026-10-22) about one launch in a few hundred never got as far as the page: `groups` and `camera`
// each failed once "timed out waiting for a page target" at the full 60 s, and a stress of 24
// concurrent launches caught a Chrome that never wrote DevToolsActivePort and whose main process
// then went, leaving its crashpad and storage processes behind. Nothing in the page or the test is
// involved — it is the browser failing to come up on a saturated machine — so a launch that fails
// before its page is attached (port, target, socket, the page's own context: ATTACH_MS in all) is
// killed with its whole tree and made once more, from a fresh profile, and the first failure is
// said on stderr. A failure after attaching — the page threw, timed out, lost its context — is the
// test's answer and is never retried.
const ATTACH_MS = 45000;
export async function evalInPage(opts) {
  const first = await evalOnce(opts);
  if (first.ok || !first.launch) { delete first.launch; return first; }
  console.error("headless: the browser never attached (" + first.reason.split("\n")[0] + ") — killed it and launching once more");
  const again = await evalOnce(opts);
  delete again.launch;
  if (!again.ok) again.reason += "\n      (a relaunch was tried: the first launch failed the same way — " + first.reason.split("\n")[0] + ")";
  return again;
}

async function evalOnce({ browser, inject = "", append = "", expr, timeoutMs = 60000, keep = false, html,
  // How often to poll while attaching. Only `tools/t43_harness.mjs` sets it: polling as fast as
  // Chrome will answer is what makes the attach race above reproducible on demand.
  attachPollMs = 100,
  // Extra command-line switches for this run. `tools/t45_memory.mjs` and `tools/t97_history.mjs` set
  // `--js-flags=--expose-gc`: a heap reading taken without a forced collection measures when the
  // collector last happened to run, not what the page is actually holding on to (t97 reads WeakRefs
  // instead of the heap, for the same reason). `tools/t98_guides.mjs` and `t97_history.mjs` set a
  // window size.
  chromeArgs = [],
  // Drive the page through the protocol instead of handing over one expression — for what only the
  // protocol can do, like giving a file chooser a real folder (DOM.setFileInputFiles,
  // `tools/t85_listed_install.mjs`) or a real click and key — a dispatched event does not move the
  // focus as a real click does (Input.dispatch*, `tools/t97_history.mjs`). Called as
  // drive({ cdp, contextId, evaluate }), where `evaluate(expr, ms)` is pinned to the page's own
  // context and throws on a page exception; what it returns is the result. `timeoutMs` bounds the
  // whole drive.
  drive = null,
  // Load the page with the network switched off (CDP `Network.emulateNetworkConditions`), from
  // before its first request. Only `tools/t31_boot.mjs` sets it: it is how the suite proves the page
  // opens with no connection (ROADMAP 4.50 (1)). The browser starts on about:blank and is sent to
  // the page only once the switch is on — with the page's URL on the command line, as every other
  // run has it, the page's first requests would race the attach. The result then also carries
  // `requests`: every URL the page or any worker it started asked for or opened a WebSocket to, each
  // as { url, from, failed } (see goOffline), with `watched` (the workers seen) and `notes` (any
  // that could not be watched).
  offline = false }) {
  const src = html != null ? html : fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
  const at = src.search(/<script/i);
  if (at < 0) throw new Error("no <script> in the page");
  const patched = src.slice(0, at) + TRAP + inject + src.slice(at) + append;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wthl-"));
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, patched);
  const profile = path.join(dir, "profile");
  fs.mkdirSync(profile, { recursive: true });
  const pageUrl = "file:///" + page.replace(/\\/g, "/");

  const child = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-timer-throttling", "--mute-audio",
    // Nothing here should ever wait on the network. A cold profile otherwise tries to reach
    // Google's services during startup, and its own stderr says so — "Failed to log in to GCM,
    // resetting connection" was sitting in the output of a `nooodle` run that then timed out
    // waiting for a page target at exactly the 20 s wall (2026-08-06, several Chromes up at once).
    // The page is a local file and the tests are offline by design, so none of this is wanted.
    "--disable-background-networking", "--disable-sync", "--disable-component-update",
    "--disable-domain-reliability", "--no-pings", "--disable-client-side-phishing-detection",
    "--user-data-dir=" + profile, "--remote-debugging-port=0",
    ...chromeArgs,
    offline ? "about:blank" : pageUrl,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", d => { stderr += d; });
  // A browser that has already exited is not a slow browser. Without this, a Chrome that died on
  // launch (locked profile, missing library) still cost 20 s and then reported "timed out waiting
  // for a page target", which points at the wrong thing entirely.
  let exited = null;
  child.on("exit", (code, sig) => { exited = "chrome exited before it was ready (code " + code + (sig ? ", " + sig : "") + ")"; });

  // `child.kill()` only ASKS Chrome to go; it still holds every file in the profile when it
  // returns. The `fs.rmSync` a line later therefore threw EBUSY and the directory survived — and
  // the comment that swallowed it ("the OS will reap it") is simply false on Windows, where
  // nothing ever empties %TEMP%. Measured 2026-08-11: 989 leaked `wthl-*` profiles holding 75 798
  // directories, 61 % of every directory in the user profile. They are not free to leave lying
  // around, because the User Profile Service walks the whole profile at each interactive logon —
  // that walk went from 0.32 s (20 Jul) to 60.3 s, i.e. the leak from a heavy test day is paid
  // back a minute at a time on every single boot. Wait for the exit, then retry past the lock.
  const gone = new Promise(res => child.once("exit", res));
  // The whole tree, not `child.kill()`: on Windows that ends the main process only, and Chrome's
  // crashpad handler and storage service outlive it holding the profile — found 2026-10-22 still
  // running from launches an hour old, with their `wthl-*` folders (ROADMAP 0.4).
  const done = async () => {
    killTree(child.pid);
    if (keep) { console.log("kept: " + page); return; }
    await Promise.race([gone, sleep(5000)]);
    for (let i = 0; ; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); return; }
      catch (e) {
        // 2 s of retry covers the handle release; past that, say so rather than leak in silence.
        if (i >= 19) return void console.error(`headless: could not remove ${dir} (${e.code || e.message})`);
        await sleep(100);
      }
    }
  };

  let attached = false;
  try {
    // Everything up to the page's own context, under one deadline (see ATTACH_MS above): each step
    // has a wait of its own, but a socket or a fetch the browser never answers has none.
    let attachTimer;
    const { cdp, off, contextId } = await Promise.race([(async () => {
    // Chrome writes the port it actually chose into the profile directory.
    const portFile = path.join(profile, "DevToolsActivePort");
    const dead = () => exited && (exited + "\n" + stderr.slice(-800));
    const port = await waitFor(() => {
      const t = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
      return t && /^\d+$/.test(t) ? t : null;
    }, ATTACH_MS, "Chrome's DevToolsActivePort", 100, dead);

    // Not 20 s: this is a COLD BROWSER LAUNCH, not a page load, and the suite runs several of them.
    // A `nooodle` run hit the old 20 s wall exactly (2026-08-06) and passed on its own moments later
    // — the code was never in question, only how long Chrome took to come up. Under six lanes a
    // healthy launch reached its target in 7.5 s at the median and 16 s at worst (24 at once,
    // 2026-10-22); one that has not by ATTACH_MS is not coming, and is relaunched instead.
    let lastList = "(no answer yet)";
    const target = await waitFor(async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
        lastList = JSON.stringify(list.map(t => ({ type: t.type, url: String(t.url).slice(0, 60), ws: !!t.webSocketDebuggerUrl })));
        return list.find(t => t.type === "page" && t.webSocketDebuggerUrl) || null;
      } catch (e) { lastList = "fetch: " + (e.cause && e.cause.code || e.message); throw e; }
    }, ATTACH_MS, "a page target", attachPollMs, dead).catch(e => { throw new Error(e.message + " (last /json/list: " + lastList + ")"); });

    const cdp = await connect(target.webSocketDebuggerUrl);
    const off = offline ? await goOffline(cdp, pageUrl) : null;
    // Pin every evaluate to the page's own document. Without this the attach can land on the
    // initial empty document and the real navigation destroys the context mid-await — see
    // pageContext() for the measurement.
    const contextId = await pageContext(cdp, 20000, attachPollMs);
    return { cdp, off, contextId };
    })(), new Promise((_, rej) => { attachTimer = setTimeout(() => rej(new Error(`the browser did not attach within ${ATTACH_MS / 1000} s`)), ATTACH_MS + 1000); })])
      .finally(() => clearTimeout(attachTimer));
    attached = true;
    const withNet = o => (off ? { ...o, requests: [...off.net.values()], watched: [...off.watched], notes: [...off.notes] } : o);
    if (drive) {
      const evaluate = async (expression, ms = timeoutMs) => {
        const e = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: ms, contextId });
        if (e.exceptionDetails) {
          const x = e.exceptionDetails;
          throw new Error("the page threw: " + (x.exception && (x.exception.description || x.exception.value) || x.text));
        }
        return e.result.value;
      };
      const v = await Promise.race([drive({ cdp, contextId, evaluate }), sleep(timeoutMs).then(() => ({ __hardTimeout: true }))]);
      cdp.close();
      await done();
      return v && v.__hardTimeout ? { ok: false, reason: `the drive did not finish within ${timeoutMs} ms` } : withNet({ ok: true, result: v });
    }
    // The page may still be loading; the expression is responsible for waiting on `load` itself.
    const r = await Promise.race([
      cdp.send("Runtime.evaluate", {
        expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs, contextId,
      }),
      sleep(timeoutMs).then(() => ({ __hardTimeout: true })),
    ]);
    cdp.close();
    if (r.__hardTimeout) { await done(); return { ok: false, reason: `the page did not answer within ${timeoutMs} ms` }; }
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      await done();
      return { ok: false, reason: "the page threw: " + (e.exception && (e.exception.description || e.exception.value) || e.text) };
    }
    await done();
    return withNet({ ok: true, result: r.result.value });
  } catch (e) {
    await done();
    let reason = String(e.message || e);
    // This one used to arrive bare, and it points at the harness rather than at the test — say so,
    // because chasing it into the test's own code costs hours (it did).
    if (/[Ee]xecution context|Cannot find context/.test(reason))
      reason += "\n      (the page's context went away mid-evaluate — that is the attach race pageContext() exists to prevent, not a fault in the test)";
    return { ok: false, launch: !attached, reason: reason + (stderr ? "\n      chrome: " + stderr.trim().split("\n").slice(-3).join("\n      ") : "") };
  }
}

// Wrap a test body (an async function taking no args and returning the result object) into an
// expression that waits for load first, traps its own throw, and always resolves.
//
// What it waits for after load (ROADMAP 0.6 (b), 2026-10-24): with no `settleMs`, on what the app's
// boot left running — `App.bootSettled` (main.js: the brush tips, the path presets, the recovery
// check and the remembered folder) — and then two frames, for the layout and ResizeObservers that
// boot changes. It replaced a fixed sleep each test guessed for itself, 300 to 1 500 ms. Measured
// 2026-10-24: `App.bootSettled` lands 405–436 ms after load on the fresh profile every round trip
// gets (all four parts together — they wait on the first open of the app's IndexedDB), so the 300
// and 400 ms guesses most tests used were SHORTER than the boot, and its work landed inside the test
// body. No test read it: 82 of 82 pageExpr tests passed with no wait at all, and the 17 that touch
// tips, path presets, recovery or the remembered folder passed with no wait even with all of the
// boot's async work delayed 800 ms (each sets up the state it reads). So this is the wait that keeps
// the boot out of the body, at about the cost of the guesses. A page with no `App.bootSettled` — the
// harness's own pages, a damaged copy whose boot stopped early — has nothing to wait on and keeps a
// fixed 300 ms. A NUMBER still means that fixed sleep instead: left where a test is about the cold
// start itself (`boot`), uses a page of its own (`harness`), or sat in another lane's area while
// (b) was cut (export, exppick, crafted, projload, groups, panels, stroke, pathlayer, memory) — drop
// it there next.
export function pageExpr(bodySrc, settleMs = null) {
  const settle = settleMs == null
    ? `(window.App && App.bootSettled
          ? App.bootSettled.then(function(){}, function(){}).then(function(){
              return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); });
            })
          : new Promise(function(r){ setTimeout(r, 300); }))`
    : `new Promise(function(r){ setTimeout(r, ${Number(settleMs)}); })`;
  return `(function(){
    function afterLoad(){
      return new Promise(function(res){
        if (document.readyState === "complete") return res();
        window.addEventListener("load", function(){ res(); });
      });
    }
    return afterLoad()
      .then(function(){ return ${settle}; })
      .then(function(){ return (${bodySrc})(); })
      .then(function(o){
        o = o || {};
        try { o.__errs = window.__boot.errs; o.__rejs = window.__boot.rejs; } catch (e) {}
        return o;
      })
      .catch(function(e){ return { __threw: (e && e.stack) || String(e), __errs: (window.__boot||{}).errs || [] }; });
  })()`;
}

// Tiny assertion helpers so every browser test reports the same way.
export function makeReport() {
  const s = { checks: 0, fails: 0 };
  return {
    ok: m => { s.checks++; console.log("  ok   " + m); },
    bad: m => { s.checks++; s.fails++; console.log("  FAIL " + m); },
    is(cond, m) { cond ? this.ok(m) : this.bad(m); },
    finish(extra) {
      if (extra) console.log(extra);
      console.log(`\n${s.checks - s.fails}/${s.checks} checks passed`);
      process.exit(s.fails ? 1 : 0);
    },
    state: s,
  };
}
