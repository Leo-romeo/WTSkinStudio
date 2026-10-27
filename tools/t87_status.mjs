// Every message the status line shows can be read in full, and so can the ones before it.
//
// WHY THIS EXISTS. The status line is where every outcome, hint and failure in the app is reported
// (core/errors.js says why it is one surface and not two). It was one line, capped at 420 px, with
// an ellipsis — about 70 characters — and `errText` cut an error at 160 before it even got there.
// Reported 2026-09-24: "Clone source set — paint where the copy should go. Alt-click again to move
// t…" and error messages could not be read at all. A message that is cut is worse than none: the
// part that says what to DO is the part that falls off the end.
//
// What is held, in the real page:
//   * the line keeps the whole message as its text (every other test reads it there) and takes the
//     top bar's free width instead of a fixed 420 px;
//   * a message that still does not fit is marked, and hovering the line opens its full text;
//   * clicking the line opens the recent messages, newest first, repeats folded, and a click
//     elsewhere closes it;
//   * an ERROR that does not fit opens in full by itself — nobody should have to know to hover;
//     one that fits does not;
//   * an error is not cut at 160 characters any more, and is not pushed out of the log by the hints
//     that follow it.
//
// Usage: node tools/t87_status.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ setTimeout(r, 0); }); }); };
  var st = document.getElementById("status");
  var log = function(){ return document.getElementById("statusLog"); };
  var shown = function(){ var p = log(); return !!p && !p.hidden && p.getBoundingClientRect().height > 0; };
  var rows = function(){ var p = log(); return p ? Array.from(p.querySelectorAll(".slog-msg")).map(function(e){ return e.textContent; }) : []; };
  var down = function(el){ el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 })); };

  out.hasLog = typeof StatusLog === "object";
  out.width = st.getBoundingClientRect().width;
  out.maxWidth = getComputedStyle(st).maxWidth;

  // (1) a hint too long for the line: the line holds all of it, is marked, and does not pop open
  var hint = "Clone source set — paint where the copy should go. Alt-click again to move the source. " +
             "This sentence is padded out so that no window a test could run in fits it on one line of the top bar.";
  setStatus(hint, "ok"); await frame();
  out.hint = { text: st.textContent, cls: st.className, clip: st.hasAttribute("data-clip"), open: shown() };

  // (2) hovering the marked line opens its full text; leaving closes it
  st.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }));
  await new Promise(function(r){ setTimeout(r, 400); });
  out.hover = { open: shown(), first: rows()[0] };
  st.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1 }));
  await new Promise(function(r){ setTimeout(r, 600); });
  out.hover.closed = !shown();

  // (3) a short message fits and is not marked
  setStatus("Saved", "ok"); await frame();
  out.fits = { clip: st.hasAttribute("data-clip"), open: shown() };

  // (4) a long ERROR opens by itself, in full — past errText's old 160-character cut
  var why = new Error("the vertex buffer at 0x" + "3f".repeat(20) + " declares format 7-40, which this reader does not know; " +
                      "the part it belongs to is left out and everything else on the vehicle is still loaded as it was.");
  reportFailure("Loading the model", why, "t87-long");
  await frame();
  out.err = { text: st.textContent, cls: st.className, open: shown(), first: rows()[0], full: "Loading the model — " + why.message };

  // (5) a click anywhere else closes it
  down(document.body); await frame();
  out.err.closedByClick = !shown();

  // (6) a SHORT error fits, so nothing opens
  reportFailure("Saving", new Error("disk full"), "t87-short"); await frame();
  out.shortErr = { open: shown(), clip: st.hasAttribute("data-clip") };

  // (7) repeats fold into one row, and a flood of hints does not push an error out of the log
  setStatus("Brush size 12", ""); setStatus("Brush size 12", "");
  out.fold = StatusLog.entries[0].n;
  for (var i = 0; i < 120; i++) setStatus("Opacity " + i + "%", "");
  out.flood = { n: StatusLog.entries.length, keep: StatusLog.KEEP,
                errKept: StatusLog.entries.some(function(e){ return e.msg === out.err.full; }),
                newest: StatusLog.entries[0].msg };

  // (8) clicking the line opens the log pinned; the newest is first; a second click closes it
  st.click(); await frame();
  out.pin = { open: shown(), first: rows()[0], rows: rows().length, expanded: st.getAttribute("aria-expanded") };
  down(log()); await frame();
  out.pin.survivesClickInside = shown();
  st.click(); await frame();
  out.pin.closed = !shown();
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 60000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the page threw\n" + r.__threw); process.exit(1); }

R.is(r.hasLog, "the status line has a log behind it (StatusLog)");
R.is(r.maxWidth === "none" && r.width > 420,
  `the line takes the top bar's free width rather than a fixed 420 px (${Math.round(r.width)} px, max-width ${r.maxWidth})`);
R.is(/move the source\. This sentence/.test(r.hint.text) && r.hint.cls === "ok",
  "the line's text is the whole message and its class is untouched — every other test reads both there");
R.is(r.hint.clip, "a message that does not fit is marked as cut");
R.is(!r.hint.open, "a hint that does not fit does not open by itself — only an error does");
R.is(r.hover.open && /move the source\. This sentence .* top bar\.$/.test(r.hover.first || ""),
  `hovering the cut line opens its full text ("…${String(r.hover.first).slice(-40)}")`);
R.is(r.hover.closed, "and moving away closes it");
R.is(!r.fits.clip && !r.fits.open, "a message that fits is not marked and opens nothing");
R.is(r.err.text === r.err.full && r.err.full.length > 160,
  `an error is not cut at 160 characters any more (${r.err.full.length} characters, all on the line)`);
R.is(r.err.cls === "err" && r.err.open && r.err.first === r.err.full,
  "an error that does not fit opens in full by itself");
R.is(r.err.closedByClick, "a click anywhere else closes it");
R.is(!r.shortErr.open && !r.shortErr.clip, "an error that fits opens nothing");
R.is(r.fold === 2, `the same message twice is one row counted twice (n = ${r.fold})`);
R.is(r.flood.n <= r.flood.keep && r.flood.newest === "Opacity 119%",
  `the log is bounded (${r.flood.n} of ${r.flood.keep}) and newest first`);
R.is(r.flood.errKept, "120 hints later the error is still in the log — hints go first when it is full");
R.is(r.pin.open && r.pin.first === "Opacity 119%" && r.pin.rows > 5 && r.pin.expanded === "true",
  `clicking the line opens the recent messages, newest first (${r.pin.rows} rows)`);
R.is(r.pin.survivesClickInside, "a click inside the log (to select or copy) does not close it");
R.is(r.pin.closed, "a second click on the line closes it");

const errs = r.__errs || [];
R.is(errs.length === 0, errs.length ? "uncaught: " + errs.join(" | ") : "no uncaught errors");
R.finish();
