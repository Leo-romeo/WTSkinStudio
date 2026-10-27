// Every runtime error reaches the user, and says which src/ file it came from.
//
// WHY THIS EXISTS. The study of debugging the app through chrome-devtools-mcp (docs/AGENT_ACCESS.md
// §11, 2026-10-17) found two gaps:
//   * nothing in src/ listened for the page's `error` or `unhandledrejection` events, so an exception
//     thrown in a click handler after boot went to the console and nowhere else. The button did
//     nothing and the user was told nothing, against CLAUDE.md §4 ("errors are never silent");
//   * the build inlined every source as an anonymous script, so every stack trace pointed at a line
//     of wt_skin_studio.html instead of at the module.
// The fixes: a trap in core/errors.js that routes both events through reportFailure; a
// `//# sourceURL=src/<file>` after every inlined script (tools/build.mjs, which says why the script
// must start on the file's first line); and one naming the pool on every worker a pool builds
// (workers/pool.js).
//
// What is held, in the real page, with real mouse clicks over CDP:
//   * a module that throws while the page loads (one is planted before the boot script) is on the
//     status line once the page has booted, and in Messages: the boot's greeting does not bury it;
//   * a click whose handler throws inside a src module, at a line this test reads out of the file,
//     puts "Unexpected error at src/<file>:<line>:<col> — <message>" on the status line, as an error,
//     and in Messages (StatusLog);
//   * that location is the module's own line everywhere it is reported: in the status line, in the
//     ErrorEvent's filename and lineno, in error.stack, in the console's own "Uncaught" entry (CDP
//     Runtime.exceptionThrown), and in reportFailure's console.error;
//   * the trap does not cancel the event: a listener registered after it sees defaultPrevented
//     false, the harness's own trap (the one t31_boot fails on) records it, and the console has it;
//   * the same error again is said once, though the console has it twice;
//   * a click handler whose promise rejects is said the same way;
//   * a worker that dies under a job rejects that job with the pool's name, `pool/<name>.js` and a
//     line, and the page's trap does not say it a second time.
//
// THE CONTROL. The same clicks run on the same page with both halves taken out: every
// `//# sourceURL` line stripped, and the page kept from registering an error or rejection listener
// (the trap is the only one it has). On that page the reporting and the naming must both fail:
// nothing reaches the status line or Messages, and nothing names a src/ file. That is how those
// checks are shown, on every run, to be able to fail. Run with `--page` against the page as committed
// before the change (71bb8ac), 13 of the 22 checks fail on the real thing: every claim above but the
// guards. What passes there is the control and the three guards (the event is not cancelled; the
// harness's trap saw the throw and the rejection). A page built with the trap but without main.js's guard fails the
// greeting check alone: measured 2026-10-17, the error was in Messages and the line read the greeting.
//
// Usage: node tools/t142_uncaught.mjs [--keep] [--chrome <path>] [--page <built.html>]
import fs from "fs";
import path from "path";
import { findBrowser, evalInPage, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const html = fs.readFileSync(argv.includes("--page") ? path.resolve(argv[argv.indexOf("--page") + 1])
  : path.join(ROOT, "wt_skin_studio.html"), "utf8");

// The throw, found in the file rather than written down here. sectionSource throws for a section the
// page does not have (t32 holds that it does), and the error is made at `new Error(` on this line.
const POOL = "src/workers/pool.js";
const poolLines = fs.readFileSync(path.join(ROOT, POOL), "utf8").split("\n");
const at = poolLines.findIndex(l => /is not in the page/.test(l) && /new Error\(/.test(l));
if (at < 0) { console.log(`FAIL: ${POOL} no longer throws "... is not in the page" from sectionSource — pick another throw`); process.exit(1); }
const WHERE = `${POOL}:${at + 1}:${poolLines[at].indexOf("new Error(") + 1}`;
console.log(`the throw: ${WHERE}`);

// Registered after the page's own listeners, so it sees what they left: whether anything cancelled
// the event. It calls the prototype's addEventListener because the control replaces the window's.
// The two buttons are the test's; their handlers call the page's own sectionSource.
const SETUP = `(function(){
  var on = function(type, fn){ EventTarget.prototype.addEventListener.call(window, type, fn); };
  window.__late = [];
  on("error", function(e){ __late.push({ kind: "error", prevented: e.defaultPrevented, file: e.filename,
    line: e.lineno, col: e.colno, msg: String(e.message), stack: String((e.error && e.error.stack) || "") }); });
  on("unhandledrejection", function(e){ __late.push({ kind: "rejection", prevented: e.defaultPrevented,
    msg: String(e.reason && e.reason.message), stack: String((e.reason && e.reason.stack) || "") }); });
  var mk = function(id, left, fn){
    var b = document.createElement("button");
    b.id = id; b.textContent = id;
    b.style.cssText = "position:fixed;top:140px;left:" + left + "px;width:140px;height:40px;z-index:2147483647";
    b.addEventListener("click", fn);
    document.body.append(b);
  };
  mk("t142throw", 60, function(){ sectionSource(["T142_CLICK"]); });
  mk("t142reject", 240, async function(){ sectionSource(["T142_PROMISE"]); });
  return true;
})()`;

const READ = `JSON.stringify({
  line: document.getElementById("status").textContent, cls: document.getElementById("status").className,
  log: StatusLog.entries.map(function(e){ return { msg: e.msg, cls: e.cls, n: e.n }; }),
  late: window.__late || [], errs: window.__boot.errs, rejs: window.__boot.rejs })`;

// A pool whose worker throws from a timer while its job waits: the one way a pool's worker dies
// rather than answers, since an op that throws is caught and sent back as a failure.
const WORKER = `(async function(){
  var pool = makeWorkerPool({ name: "t142", size: 1, ops: "var WT_OPS = { die: function(){ " +
    "setTimeout(function(){ throw new Error('t142 worker died'); }, 0); return new Promise(function(){}); } };" });
  var said;
  try { await pool.call("die", {}); said = "the job resolved"; } catch (e) { said = e.message; }
  pool.dispose();
  // This waits for an ABSENCE — a second report that must not come — so there is no event to poll
  // for (the 2026-10-22 scan's (20)). Drain the task queue first, where any echo of the worker's
  // error would already sit behind the rejection, and keep 300 ms as a floor: on a loaded machine a
  // longer wait than needed only makes the check stricter, never flaky.
  for (var i = 0; i < 5; i++) await new Promise(function(r){ var c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
  await new Promise(function(r){ setTimeout(r, 300); });
  return said;
})()`;

// A module that throws while the page loads, planted just before the boot script: after the trap is
// registered, and before the boot's greeting, which must not bury what the trap said. Found by the
// boot's own opening rather than by main.js's whole text, so --page can plant it in an older build.
const plant = page => {
  const s = page.lastIndexOf("<script>", page.indexOf("(function boot(){"));
  if (s < 0) throw new Error("the boot script is not in the page, so there is nowhere to plant the load-time throw");
  return page.slice(0, s) + `<script>throw new Error("T142_LOAD");\n//# sourceURL=src/t142-planted.js\n</script>` + page.slice(s);
};
const LOADED = "Unexpected error at src/t142-planted.js:1:7 — T142_LOAD";

// The control: no listener for either event may be registered by the page. Injected after the
// harness's own trap, which keeps the window's real addEventListener.
const CONTROL = `<script>
(function(){
  var add = window.addEventListener;
  window.addEventListener = function(type){
    if (type === "error" || type === "unhandledrejection") return;
    return add.apply(this, arguments);
  };
})();
</script>
`;

async function session(page, inject, withWorker) {
  return evalInPage({ browser, html: page, inject, timeoutMs: 60000, keep: argv.includes("--keep"),
    drive: async ({ cdp, evaluate }) => {
      const con = [];
      cdp.on((method, p, sessionId) => {
        if (sessionId) return;
        if (method === "Runtime.exceptionThrown") {
          const d = p.exceptionDetails;
          con.push({ kind: "uncaught", text: d.text, url: d.url || "", line: d.lineNumber,
            desc: (d.exception && d.exception.description) || "" });
        } else if (method === "Runtime.consoleAPICalled" && p.type === "error") {
          con.push({ kind: "console.error", text: p.args.map(a => a.description || String(a.value)).join(" ") });
        }
      });
      await evaluate(`new Promise(function(r){ var go = function(){ setTimeout(r, 800); };
        document.readyState === "complete" ? go() : addEventListener("load", go); })`);
      await evaluate(SETUP);
      // A real click, through the input pipeline: the handler runs in a task of its own, as a user's does.
      const click = async id => {
        const c = await evaluate(`(function(){ var b = document.getElementById(${JSON.stringify(id)}), r = b.getBoundingClientRect();
          var x = r.left + r.width / 2, y = r.top + r.height / 2;
          return { x: x, y: y, top: document.elementFromPoint(x, y) === b }; })()`);
        if (!c.top) throw new Error(`#${id} is covered at its centre, so a click there would land on something else`);
        for (const type of ["mousePressed", "mouseReleased"])
          await cdp.send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 });
        // a rejection is announced after the task that made it, and the log redraws on a frame
        await evaluate("new Promise(function(r){ requestAnimationFrame(function(){ setTimeout(r, 200); }); })");
      };
      const out = { boot: JSON.parse(await evaluate(READ)) };
      await click("t142throw");
      out.thrown = JSON.parse(await evaluate(READ));
      await click("t142throw");
      out.again = JSON.parse(await evaluate(READ));
      await click("t142reject");
      out.rejected = JSON.parse(await evaluate(READ));
      if (withWorker) out.worker = await evaluate(WORKER);
      out.after = JSON.parse(await evaluate(READ));
      out.console = con;
      return out;
    } });
}

const has = (s, re) => re.test(String(s || ""));
const firstFrame = stack => String(stack || "").split("\n")[1] || "";

// ---------- the page ----------
console.log("=== the page: a module that throws as it loads, a throw and a rejection in click handlers, a worker that dies ===");
const run = await session(plant(html), "", true);
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;

// That the real page boots with nothing for the trap to say is t31_boot's: no uncaught error at load.
R.is(r.boot.line === LOADED && r.boot.cls === "err" && r.boot.log.some(e => e.msg === LOADED && e.cls === "err"),
  `a module that throws as the page loads is on the status line once it has booted, and in Messages — the greeting does not bury it: "${r.boot.line.slice(0, 100)}"`);

const t = r.thrown;
const said = `Unexpected error at ${WHERE} — section T142_CLICK is not in the page`;
R.is(t.line.startsWith(said) && t.cls === "err",
  `a throw in a click handler is on the status line, as an error: "${t.line.slice(0, 140)}" (class "${t.cls}")`);
const rows = t.log.filter(e => has(e.msg, /T142_CLICK/));
R.is(rows.length === 1 && rows[0].msg === t.line && rows[0].cls === "err", "and in Messages (StatusLog), as an error");

const ev = t.late.find(e => e.kind === "error" && has(e.msg, /T142_CLICK/));
R.is(ev && `${ev.file}:${ev.line}:${ev.col}` === WHERE,
  `the error event names the module and its line: ${ev ? `${ev.file}:${ev.line}:${ev.col}` : "(no event)"}, the throw is at ${WHERE}`);
R.is(ev && firstFrame(ev.stack).includes(WHERE) && (ev.stack.match(/src\/workers\/pool\.js:\d+:\d+/g) || []).length >= 2,
  `error.stack names it in its first frame, and the caller's frame by the same file: ${ev ? JSON.stringify(ev.stack.split("\n").slice(1, 4).map(s => s.trim())) : "(no stack)"}`);
const unc = r.console.filter(c => c.kind === "uncaught" && has(c.desc, /T142_CLICK/));
// CDP counts lines from 0, so the throw's line in the file is `at` + 1 and here it is `at`.
R.is(unc.length === 2 && unc.every(c => c.url === POOL && c.line === at && c.desc.includes(WHERE)),
  `the console's own "Uncaught" entry names it: ${unc.map(c => `${c.url}:${c.line + 1}`).join(", ") || "(none)"}, one per click`);
const logged = r.console.filter(c => c.kind === "console.error" && c.text.startsWith(`Unexpected error at ${WHERE}:`));
R.is(logged.length >= 1 && /section T142_CLICK/.test(logged[0].text) && firstFrame(logged[0].text).includes(WHERE),
  `and so does reportFailure's console.error: "${logged.length ? logged[0].text.split("\n")[0].slice(0, 120) : "(none)"}"`);

R.is(ev && ev.prevented === false, "the trap does not cancel the event: a listener after it sees defaultPrevented false");
R.is(t.errs.some(s => has(s, /T142_CLICK/)), "and the harness's own trap, the one t31_boot fails on, recorded it");

const a = r.again;
const twice = a.late.filter(e => e.kind === "error" && has(e.msg, /T142_CLICK/)).length;
const again = a.log.filter(e => has(e.msg, /T142_CLICK/));
R.is(twice === 2 && again.length === 1 && again[0].n === 1,
  `the same error twice is said once: ${twice} events, ${again.length} row in Messages, counted ${again.length ? again[0].n : 0} time(s)`);

const j = r.rejected;
const saidJ = `Unexpected error at ${WHERE} — section T142_PROMISE is not in the page`;
R.is(j.line.startsWith(saidJ) && j.cls === "err" && j.log.some(e => e.msg === j.line && e.cls === "err"),
  `a click handler whose promise rejects is said the same way, on the line and in Messages: "${j.line.slice(0, 140)}"`);
const rev = j.late.find(e => e.kind === "rejection" && has(e.msg, /T142_PROMISE/));
const runc = r.console.find(c => c.kind === "uncaught" && has(c.desc, /T142_PROMISE/));
R.is(rev && rev.prevented === false && firstFrame(rev.stack).includes(WHERE) && runc && /in promise/.test(runc.text) && runc.url === POOL,
  `its reason's stack and the console's "${runc ? runc.text : "?"}" entry name the module (${runc ? runc.url : "none"}), and the event is not cancelled`);
R.is(j.rejs.some(s => has(s, /T142_PROMISE/)), "and the harness's trap recorded the rejection");

R.is(/^\[t142\] worker failed: .*t142 worker died \(pool\/t142\.js:\d+\)$/.test(r.worker || ""),
  `a worker that dies under a job rejects it, named by its pool: "${r.worker}"`);
const after = r.after;
const echoed = after.late.some(e => has(e.msg, /t142 worker died/)) || after.log.some(e => has(e.msg, /t142 worker died/))
  || after.errs.some(s => has(s, /t142 worker died/));
R.is(!echoed, "and the page is not told a second time: no window error event, nothing from the trap");

const stray = after.errs.filter(s => !has(s, /T142_/)).concat(after.rejs.filter(s => !has(s, /T142_/)));
R.is(stray.length === 0, stray.length ? "uncaught besides the test's own: " + stray.join(" | ") : "nothing else was uncaught during the run");

// ---------- the control ----------
console.log("\n=== control: the same page without the trap and without the //# sourceURL comments ===");
const planted = plant(html);
const named = (planted.match(/\n\/\/# sourceURL=[^\n]*/g) || []).length;
const ctl = await session(planted.replace(/\n\/\/# sourceURL=[^\n]*/g, ""), CONTROL, false);
if (!ctl.ok) { console.log("FAIL: the control did not run: " + ctl.reason); process.exit(1); }
const c = ctl.result;
console.log(`  note  ${named} //# sourceURL comments stripped`);
R.is(!has(c.boot.line, /T142/) && !c.boot.log.some(e => has(e.msg, /T142/)),
  `without the trap the module that throws as it loads is said nowhere (the line reads "${c.boot.line.slice(0, 80)}")`);
R.is(!has(c.thrown.line, /T142/) && !c.thrown.log.some(e => has(e.msg, /T142/)),
  "nor does the throw in a click handler reach the status line or Messages");
R.is(!has(c.rejected.line, /T142/) && !c.rejected.log.some(e => has(e.msg, /T142/)),
  "nor does the rejection");
const cev = c.thrown.late.find(e => e.kind === "error" && has(e.msg, /T142_CLICK/));
R.is(cev && /page\.html$/.test(cev.file) && !has(cev.stack, /src\//),
  `without the comments the error is placed in the page, ${cev ? `${cev.file.split("/").pop()}:${cev.line}` : "(no event)"}, and its stack names no src/ file`);
const cunc = c.console.find(c2 => c2.kind === "uncaught" && has(c2.desc, /T142_CLICK/));
R.is(cunc && !cunc.url.startsWith("src/") && !has(cunc.desc, /src\//), `and neither does the console (${cunc ? cunc.url.split("/").pop() : "no entry"})`);
R.is(c.thrown.errs.some(s => has(s, /T142_CLICK/)), "while the harness's trap still sees the error, so the clicks did run");

R.finish();
