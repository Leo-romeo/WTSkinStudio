// The undo history as a list: every step, going back to any of them, and named checkpoints
// (ROADMAP 4.50 (15)).
//
// WHY THIS EXISTS. The stacks always knew each step's label and what it cost, and nothing let the
// user see either, go further than one Ctrl+Z at a time, or name a state to come back to. What can go
// wrong with the list is invisible until it is used in anger:
//
//   * **A click must land on the state it names.** The document here is one number — the count of
//     steps applied — so "which state is the image in" is an integer and every walk is checked by
//     value, not by the stacks' own bookkeeping agreeing with itself.
//   * **A checkpoint names a STATE, and eviction must keep it exact.** When the oldest step is
//     dropped the state after it is still reachable — it becomes Start — so its name must move there;
//     the state before it is gone, and its name must go and be SAID to go. A name stored on the step
//     and dropped with it would lose a checkpoint whose state is still there; this test is the one
//     that tells the two apart.
//   * **A name on an undone step goes when an edit discards the step,** and that is said too.
//   * **A row drawn before the history was cleared must not walk anywhere** — the list remembers
//     each row's step, not its index, and a click on a stale row says so.
//   * **A long walk is not one long block of the UI thread** (CLAUDE.md §3.5): it yields behind the
//     progress bar, it can be cancelled, it stops at a real state when an edit arrives while it has
//     yielded — and a walk of N steps says ONE thing in the status bar, not N.
//   * **Anything STARTED while it has yielded stops it where it is** — not only an edit that has
//     already reached the stacks. A gesture takes what it will put back when it begins and pushes when
//     it ends, so a walk that went on under a held stroke left the layer in no state of the history
//     (review, 2026-09-27). A paint layer filled flat per state is the oracle: a stroke begun by code, a
//     press and a key each stop it; a press on the window, its button or the progress strip, and a
//     modifier on its own, do not. **And a key does wherever the focus is:** a walk begins with a click
//     on a row, which leaves the focus on that row, so every key of a real walk is aimed at the window —
//     exempting those let an arrow nudge a decal from a state the walk went on past (second review,
//     2026-09-27). Section 10 clicks and presses through the protocol, as a user does, and reads where
//     the focus is before it trusts the answer.
//   * **A closed window holds no step.** A row's handler closes over its step and a step over what it
//     puts back, so hidden rows kept a whole history alive through a clear and through eviction. Read
//     with WeakRefs after forced collections (the page runs with --expose-gc), against a control that
//     must read as held — without one, an instrument that sees nothing reads as a clean app. A window
//     closed while a walk runs must not be filled again by the redraw the walk ends with.
//   * **Every clear goes through one funnel,** so no list on screen outlives the history it drew.
//
// Usage: node tools/t97_history.mjs [--keep] [--chrome <path>]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, MB = 1048576;
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 0); }); };
  // The document is one number: how many steps have been applied. State k of the history is v = k.
  var doc = { v: 0 };
  var step = function(name, bytes){
    var from = doc.v, to = from + 1; doc.v = to;
    pushAction(name, function(){ doc.v = from; }, function(){ doc.v = to; }, bytes || 0);
  };
  var names = function(){ return UndoHistory.marks().map(function(m){ return m.state + ":" + m.name; }); };
  var status = function(){ return $("status").textContent; };
  UndoHistory.clear(); setUndoBudget(384);

  // ---- 1. going to a state, back and forward ----
  for (var i = 1; i <= 5; i++) step("s" + i, i * MB / 2);
  out.five = { v: doc.v, at: UndoHistory.at(), n: UndoHistory.steps().length };
  StatusLog.entries.length = 0;
  var r1 = await UndoHistory.goTo(2);
  out.back = { v: doc.v, at: UndoHistory.at(), redo: App.redoStack.length, r: r1, status: status(), said: StatusLog.entries.length };
  var r2 = await UndoHistory.goTo(4);
  out.fwd = { v: doc.v, at: UndoHistory.at(), redo: App.redoStack.length, r: r2, status: status() };
  await UndoHistory.goTo(0);
  out.start = { v: doc.v, status: status() };
  await UndoHistory.goTo(99);                                  // clamped to the last state there is
  out.clamped = { v: doc.v };

  // ---- 2. the window draws the same timeline, and a click walks it ----
  await UndoHistory.goTo(3);
  TopWin.show("winHistory");
  var rowsOf = function(){ return [].slice.call(document.querySelectorAll("#histList .histrow")); };
  out.rows = rowsOf().map(function(b){ return { cls: b.className, name: b.querySelector(".hn").textContent,
    cost: b.querySelector(".hb").textContent }; });
  out.hint = $("histHint").textContent;
  rowsOf()[1].click(); await wait(0);                          // s1's row: the state after s1
  out.clickBack = { v: doc.v };
  rowsOf()[4].click(); await wait(0);                          // s4's row, greyed: redo up to it
  out.clickFwd = { v: doc.v };
  rowsOf()[0].click(); await wait(0);                          // Start
  out.clickStart = { v: doc.v };
  await UndoHistory.goTo(5);
  // the list follows the stacks by itself, a frame later, while it is open
  step("s6", 3 * MB);
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  out.followed = { rows: rowsOf().length, last: rowsOf().slice(-1)[0].querySelector(".hn").textContent,
    cur: rowsOf().slice(-1)[0].classList.contains("cur") };

  // ---- 3. checkpoints ----
  await UndoHistory.goTo(3);
  $("histMarkName").value = "  before   weathering ";
  $("btnHistMark").click();
  out.marked = { marks: names(), status: status() };
  await UndoHistory.goTo(6);
  HistoryUI.render();
  var mrow = document.querySelector("#histMarks .histrow");
  out.markBlock = { rows: document.querySelectorAll("#histMarks .histmark").length, name: mrow && mrow.querySelector(".hn").textContent,
    flagged: document.querySelectorAll("#histList .histrow.marked").length };
  mrow.click(); await wait(0);
  out.toMark = { v: doc.v, status: status() };
  // no name → a numbered one; Enter in the field works like the button; naming a state again renames it
  await UndoHistory.goTo(5);
  $("histMarkName").value = "";
  $("histMarkName").dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", bubbles: true, cancelable: true }));
  out.numbered = names();
  UndoHistory.mark("renamed");
  out.renamed = names();
  await UndoHistory.goTo(0);
  UndoHistory.mark("as loaded");                                // Start can carry a name too
  out.base = { marks: names(), label: UndoHistory.label(0) };
  // the ✕ takes a checkpoint away and leaves its step
  await UndoHistory.goTo(6); HistoryUI.render();
  var xs = document.querySelectorAll("#histMarks .histmark .twx");
  xs[xs.length - 1].click();
  out.unmarked = { marks: names(), steps: UndoHistory.steps().length };

  // ---- 4. eviction keeps a checkpoint's state exact ----
  UndoHistory.clear(); doc.v = 0; setUndoBudget(128);
  step("a", 40 * MB); step("b", 40 * MB); UndoHistory.mark("after b"); step("c", 40 * MB);
  step("d", 40 * MB);                                           // 160 MB: "a" goes, the state after it is Start
  out.ev1 = { marks: names(), first: UndoHistory.steps()[0].desc };
  StatusLog.entries.length = 0;
  step("e", 40 * MB);                                           // "b" goes: its state is the new Start
  out.ev2 = { marks: names(), label: UndoHistory.label(0), said: StatusLog.entries.filter(function(x){ return /after b/.test(x.msg); }).length };
  await UndoHistory.goTo(0);
  out.ev2.startV = doc.v;                                       // after b, in absolute terms: 2
  await UndoHistory.goTo(UndoHistory.steps().length);
  step("f", 40 * MB);                                           // "c" goes: the named state is out of reach
  out.ev3 = { marks: names(), base: UndoHistory.baseMark, status: status() };

  // ---- 5. an edit that discards undone steps discards a name on them, and says so ----
  UndoHistory.clear(); doc.v = 0; setUndoBudget(384);
  step("x1"); step("x2"); UndoHistory.mark("x2 state"); step("x3");
  await UndoHistory.goTo(1);
  step("y");
  out.redoDrop = { marks: names(), status: status(), v: doc.v, at: UndoHistory.at() };

  // ---- 6. a row drawn before a clear walks nowhere ----
  step("z1"); step("z2");
  HistoryUI.render();
  var stale = rowsOf()[1];
  var vWas = doc.v;
  UndoHistory.clear();
  stale.click(); await wait(0);
  out.stale = { v: doc.v, vWas: vWas, status: status(), usage: $("undoUsage").textContent, title: $("btnUndo").title };

  // ---- 7. a long walk yields, shows progress, can be cancelled, and stops when an edit arrives ----
  UndoHistory.clear(); doc.v = 0;
  var busy = function(ms){ var t = performance.now(); while (performance.now() - t < ms) {} };
  var slow = function(name){
    var from = doc.v, to = from + 1; doc.v = to;
    pushAction(name, function(){ busy(25); doc.v = from; }, function(){ busy(25); doc.v = to; }, 0);
  };
  for (var j = 0; j < 20; j++) slow("slow" + j);
  var beats = 0, maxGap = 0, last = performance.now(), sawBar = false;
  var hb = setInterval(function(){ var n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; beats++; if (Prog.active) sawBar = true; }, 4);
  var t0 = performance.now();
  StatusLog.entries.length = 0;
  var rl = await UndoHistory.goTo(0);
  var ms = performance.now() - t0;
  clearInterval(hb);
  out.long = { v: doc.v, ms: Math.round(ms), beats: beats, maxGap: Math.round(maxGap), sawBar: sawBar, r: rl,
    barAfter: Prog.active, said: StatusLog.entries.length };
  var cancelT = setInterval(function(){ if (Prog.active) { Prog.cancelled = true; clearInterval(cancelT); } }, 4);
  var rc = await UndoHistory.goTo(20);
  clearInterval(cancelT);
  out.cancel = { r: rc, v: doc.v, at: UndoHistory.at(), status: status(), barAfter: Prog.active };
  await UndoHistory.goTo(0);
  var pushT = setInterval(function(){ if (Prog.active) { clearInterval(pushT); step("intruder"); } }, 4);
  var rm = await UndoHistory.goTo(20);
  clearInterval(pushT);
  out.moved = { r: rm, v: doc.v, at: UndoHistory.at(), top: UndoHistory.steps().slice(-1)[0].desc, status: status() };
  // a second walk asked for while one is running is refused, not interleaved
  UndoHistory.clear(); doc.v = 0;
  for (var q = 0; q < 12; q++) slow("q" + q);
  var first = UndoHistory.goTo(0);
  await wait(0);
  var second = await UndoHistory.goTo(12);
  await first;
  out.overlap = { second: second, v: doc.v };

  // ---- 8. anything STARTED while a walk has yielded stops it where it is ----
  // A gesture reaches the stacks when it ends, but it takes what it will put back when it begins —
  // so a walk that stopped only when the stacks moved went on undoing under a stroke held down in one
  // of its yields (review of 4.50 (15), 2026-09-27). Here the paint layer is filled flat with
  // red = 10·k in state k, so any texel says which state it is in; the stroke touches tile (0,0) of a
  // 512² sheet, (200,200) is in that tile outside the dab and (400,400) in a tile it never reaches.
  UndoHistory.clear(); TopWin.close();
  var ps = { id: "h97", cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null, metal: null,
    normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
  App.slots.set("h97", ps); initPlaceholderAlbedo(ps, 512, 512);
  App.activeSlot = ps; App.activeLayer = null; App.paint3d = false;
  App.brush.mode = "color"; App.brush.size = 40; App.brush.opacity = 1; App.brush.hardness = 1;
  App.brush.spacing = .35; App.brush.color = "#ffffff";
  beginStroke(false, false); stampAt(20, 20, 0, null); endStroke();          // makes the paint layer
  var pc = App.activeLayer.canvas;
  var fillState = function(k){ var g = ctx2d(pc); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.clearRect(0, 0, pc.width, pc.height); g.fillStyle = "rgb(" + (10 * k) + ",0,0)"; g.fillRect(0, 0, pc.width, pc.height); compositeSlot(ps); };
  var red = function(x, y){ return ctx2d(pc).getImageData(x, y, 1, 1).data[0]; };
  UndoHistory.clear(); fillState(0);
  for (var sk = 1; sk <= 20; sk++) (function(k){ fillState(k);
    pushAction("state " + k, function(){ busy(25); fillState(k - 1); }, function(){ busy(25); fillState(k); }, 0); })(sk);
  // goTo runs straight through its first 150 ms, so when it hands back its promise it has yielded
  var walkS = UndoHistory.goTo(0);
  var sBegin = UndoHistory.at(), sBar = Prog.active;
  beginStroke(false, false); stampAt(128, 128, 0, null); refreshStrokeView();  // begun by code, no press at all
  await wait(200);                                                            // held down
  var sHeld = UndoHistory.at(), sStatus = status();
  stampAt(170, 128, 0, null); refreshStrokeView();
  var sFramed = { touched: red(200, 200), untouched: red(400, 400) };
  endStroke();
  var rs = await walkS;
  var sTop = UndoHistory.steps().slice(-1)[0].desc;
  doUndo();                                                                   // take the stroke back
  out.underStroke = { r: rs, bar: sBar, begin: sBegin, held: sHeld, framed: sFramed, top: sTop, status: sStatus,
    undone: { at: UndoHistory.at(), touched: red(200, 200), untouched: red(400, 400) } };
  UndoHistory.clear(); App.slots.delete("h97"); App.activeSlot = null; App.activeLayer = null;
  // a press or a key anywhere else ends it too — any gesture begins with one, a marquee, a decal, a guide
  var press = function(el, type, o){
    var E = type === "keydown" ? KeyboardEvent : PointerEvent;
    el.dispatchEvent(new E(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }, o || {})));
    if (type === "pointerdown") el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true }));
  };
  var slowHistory = function(){ UndoHistory.clear(); doc.v = 0; for (var j2 = 0; j2 < 20; j2++) slow("w" + j2); };
  slowHistory();
  var walkP = UndoHistory.goTo(0), pAt = UndoHistory.at();
  press(document.body, "pointerdown");
  var rp = await walkP;
  out.pressed = { r: rp, at: pAt, after: UndoHistory.at(), v: doc.v, status: status() };
  slowHistory();
  var walkK = UndoHistory.goTo(0), kAt = UndoHistory.at();
  press(document.body, "keydown", { code: "KeyJ", key: "j" });
  var rk = await walkK;
  out.keyed = { r: rk, at: kAt, after: UndoHistory.at(), v: doc.v };
  // …but not a press on the History window itself or its button, on the progress strip (its Cancel is
  // the other way to stop it), or a modifier held on its own
  slowHistory(); TopWin.show("winHistory");
  var walkI = UndoHistory.goTo(0);
  press($("histList"), "pointerdown");
  press($("btnHistoryWin"), "pointerdown");
  press($("progWrap"), "pointerdown");
  press(document.body, "keydown", { code: "ShiftLeft", key: "Shift" });
  var ri = await walkI;
  out.inside = { r: ri, at: UndoHistory.at(), v: doc.v };
  TopWin.close();

  // ---- 9. a closed window holds no step ----
  // A row's click handler closes over its step, and a step over whatever it puts back — a bake's two
  // whole-sheet snapshots, a stroke's tiles. Closing the window used to only hide the rows, so they
  // kept the last render's steps alive through a clear and through eviction (review, 2026-09-27).
  // Oracle: a WeakRef on what each step holds, read after forced collections (CLAUDE.md §3.8).
  var gcOk = typeof gc === "function";
  var collect = async function(){ for (var c = 0; c < 3; c++) { await wait(0); if (gcOk) gc(); } await wait(0); };
  var heavy = function(tag, claimMB){
    var payload = new Uint8Array(MB); payload[0] = 1;
    pushAction(tag, function(){ payload[1]++; }, function(){ payload[2]++; }, (claimMB || 1) * MB);
    return new WeakRef(payload);
  };
  var freed = function(refs){ return refs.filter(function(w){ return w.deref() === undefined; }).length; };
  UndoHistory.clear(); setUndoBudget(384); await collect();
  var ga = [heavy("a1"), heavy("a2"), heavy("a3")];                  // never drawn: a clear lets them go
  UndoHistory.clear(); await collect();
  var aFreed = freed(ga);
  // the control that must NOT be freed: a hidden button whose handler closes over a step, which is
  // what every closed window's rows used to be
  var hide = document.createElement("div"); hide.style.display = "none"; document.body.appendChild(hide);
  var gh = heavy("h1");
  (function(st){ var hb = document.createElement("button"); hb.onclick = function(){ return st; }; hide.appendChild(hb); })(App.undoStack[App.undoStack.length - 1]);
  UndoHistory.clear(); await collect();
  var ghHeld = gh.deref() !== undefined;
  hide.remove();
  var gb = [heavy("b1"), heavy("b2"), heavy("b3")];                  // drawn once, closed, cleared
  UndoHistory.mark("before weathering");
  TopWin.show("winHistory");
  var rowsOpen = document.querySelectorAll("#histList .histrow, #histMarks .histrow").length;
  TopWin.close();
  var rowsClosed = document.querySelectorAll("#histList .histrow, #histMarks .histrow").length;
  UndoHistory.clear(); await collect();
  var bFreed = freed(gb);                                            // read now: the next show redraws the rows
  var gc3 = [heavy("c1", 40), heavy("c2", 40), heavy("c3", 40)];     // drawn once, closed, evicted
  TopWin.show("winHistory"); TopWin.close();
  setUndoBudget(128);
  for (var d = 0; d < 4; d++) heavy("d" + d, 40);                    // 160 MB through 128: c1..c3 go
  var cHeld = App.undoStack.filter(function(x){ return /^c/.test(x.desc); }).length;
  await collect();
  var cFreed = freed(gc3);
  // and a window hidden some other way than its ✕ is emptied by the next change the stacks report
  UndoHistory.clear(); setUndoBudget(384);
  heavy("e1"); TopWin.show("winHistory");
  $("winHistory").style.display = "none";
  heavy("e2");
  var rowsHidden = document.querySelectorAll("#histList .histrow").length;
  TopWin.close();
  // …and a window closed WHILE a walk runs is not filled again when the walk ends. Its ✕ begins
  // nothing, so the walk goes on to its end, and HistoryUI.go redraws the list as it finishes —
  // that redraw has to find the window hidden and draw nothing, or the rows it draws hold every step
  // until the next change the history reports (review of the fix, 2026-09-27: no check read it).
  UndoHistory.clear(); doc.v = 0;
  for (var w9 = 0; w9 < 20; w9++) slow("m" + w9);
  TopWin.show("winHistory"); HistoryUI.render();
  var goP = HistoryUI.go(null);                                     // what a click on Start runs
  var busyMid = UndoHistory.busy;                                   // it has yielded: its first 150 ms are behind it
  var closeX = document.querySelector("#secHistory h3 .twx");
  press(closeX, "pointerdown"); closeX.click();
  var shownMid = HistoryUI.shown();
  await goP;
  var midWalk = { busy: busyMid, shown: shownMid, at: UndoHistory.at(), v: doc.v,
    rows: document.querySelectorAll("#histList .histrow, #histMarks .histrow").length };
  out.held = { gc: gcOk, never: aFreed, control: ghHeld, rowsOpen: rowsOpen, rowsClosed: rowsClosed, cleared: bFreed,
    evictedHeld: cHeld, evicted: cFreed, rowsHidden: rowsHidden, midWalk: midWalk };

  UndoHistory.clear(); setUndoBudget(384);
  TopWin.close();
  return out;
}`;

// ---- 10. with real input: every key of a real walk is aimed at the History window ----
// A walk begins with a CLICK on a row, and a real click leaves the focus ON that row, so every key
// pressed during a real walk has its target inside the window. Section 8 dispatches its key on the
// body, which no real walk has — and it passed while the window exempted every key aimed at it, so
// an arrow pressed during a walk nudged a decal from a state the walk then went on past (review of
// the fix, 2026-09-27). Here the click and the keys go through the protocol as a user's do. The
// document is a flat decal whose x says which state it is in: step k puts it at 60 + 5k texels.
// Sixty steps of 30 ms: about two seconds of walk after the click, room for all of the control's
// input to arrive while it is still going, however loaded the machine is.
const REAL_STEPS = 60;
const REAL_SETUP = `(function(){
  var N = 256, X = function(k){ return (60 + 5 * k) / N; };
  var busy = function(ms){ var t = performance.now(); while (performance.now() - t < ms) {} };
  var s = App.slots.get("h97r");
  if (!s) { s = { id: "h97r", cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null, metal: null,
      normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
    App.slots.set("h97r", s); initPlaceholderAlbedo(s, N, N); }
  App.activeSlot = s; App.paint3d = false;
  var bmp = mkCanvas(20, 10), g = ctx2d(bmp); g.fillStyle = "#fff"; g.fillRect(0, 0, 20, 10);
  var dec = LayerNode.of({ type: "decal", name: "d", bmp: bmp, x: X(0), y: 128 / N, scale: 1, rot: 0, flip: false,
    visible: true, opacity: 1, blend: "normal" });
  s.layers = [dec]; App.activeLayer = dec; window.__t97dec = dec;
  UndoHistory.clear(); setUndoBudget(384);
  for (var k = 1; k <= ${REAL_STEPS}; k++) (function(k){ dec.x = X(k);
    pushAction("place " + k, function(){ busy(30); dec.x = X(k - 1); }, function(){ busy(30); dec.x = X(k); }); })(k);
  // what the walk a click starts resolves to — HistoryUI.go drops it
  if (!window.__t97goTo) {
    window.__t97goTo = UndoHistory.goTo;
    UndoHistory.goTo = function(k){ window.__t97walk = null;
      var p = window.__t97goTo.call(UndoHistory, k); p.then(function(r){ window.__t97walk = r; }); return p; };
  }
  window.__t97walk = null;
  $("histMarkName").value = "";
  TopWin.close(); TopWin.show("winHistory");
  return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(UndoHistory.at()); }); }); });
})()`;
// Scrolled into view first, as a user scrolls to a row before clicking it: the list keeps the current
// row in view, so with sixty steps Start sits above the top of its scroll box.
const CENTRE = sel => `(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  el.scrollIntoView({ block: "nearest" });
  var b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, at = document.elementFromPoint(x, y);
  return { x: x, y: y, text: el.textContent.trim(), hit: !!(at && (at === el || el.contains(at))) }; })()`;
const READ = `({ at: UndoHistory.at(), busy: UndoHistory.busy, bar: !!Prog.active, walk: window.__t97walk,
  x: Math.round(__t97dec.x * 256 * 100) / 100, name: $("histMarkName").value,
  focus: document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? "#" + document.activeElement.id : "") +
    (document.activeElement.className ? "." + document.activeElement.className.split(" ").join(".") : "") : "",
  inWin: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#winHistory")) })`;
const KEYS = {
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  ShiftLeft: { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, location: 1 },
  KeyK: { key: "k", code: "KeyK", windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, text: "k", unmodifiedText: "k" },
};
const sleep = ms => new Promise(res => setTimeout(res, ms));
async function realInput(cdp, evaluate){
  const click = async pt => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await cdp.send("Input.dispatchMouseEvent", Object.assign({ type, x: pt.x, y: pt.y }, type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }));
  };
  const key = async (k, holdMs) => {
    await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: KEYS[k].text ? "keyDown" : "rawKeyDown" }, KEYS[k]));
    const down = await evaluate(READ);
    if (holdMs) await sleep(holdMs);
    const up = Object.assign({ type: "keyUp" }, KEYS[k]); delete up.text; delete up.unmodifiedText;
    await cdp.send("Input.dispatchKeyEvent", up);
    return down;
  };
  const until = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr)) return true; await sleep(5); } return false; };
  const walk = async () => {
    await evaluate(REAL_SETUP);
    const row = await evaluate(CENTRE("#histList .histrow"));        // Start
    await click(row);
    await until(`!!(Prog.active || window.__t97walk)`, 5000);          // it has yielded behind the bar
    return row;
  };
  const out = {};
  // A: an arrow, with the focus where the click left it
  out.A = { row: await walk() };
  out.A.before = await evaluate(READ);
  out.A.down = await key("ArrowRight", 120);
  await until(`!!window.__t97walk && !UndoHistory.busy`, 10000);
  out.A.end = await evaluate(`({ r: window.__t97walk, at: UndoHistory.at(), top: (UndoHistory.steps()[UndoHistory.at() - 1] || {}).desc })`);
  out.A.undone = await evaluate(`(doUndo(), { at: UndoHistory.at(), x: Math.round(__t97dec.x * 256 * 100) / 100, want: 60 + 5 * UndoHistory.at() })`);
  // B: what does not stop it, with real input too — Shift on its own with the focus on the row, a
  // click into the checkpoint's name and a letter typed there
  out.B = { row: await walk() };
  out.B.before = await evaluate(READ);
  await key("ShiftLeft");
  await click(await evaluate(CENTRE("#histMarkName")));
  out.B.typed = await key("KeyK");
  out.B.after = await evaluate(READ);
  await until(`!!window.__t97walk && !UndoHistory.busy`, 10000);
  out.B.end = await evaluate(READ);
  await evaluate(`(UndoHistory.goTo = window.__t97goTo, delete window.__t97goTo, UndoHistory.clear(), App.slots.delete("h97r"),
    App.activeSlot = null, App.activeLayer = null, $("histMarkName").value = "", TopWin.close(), true)`);
  return out;
}

// --expose-gc: section 9 reads what a closed window still holds after forced collections. A window
// big enough that the History window's rows are where a click can reach them, for section 10.
const r = await evalInPage({ browser, timeoutMs: 120000, keep: argv.includes("--keep"),
  chromeArgs: ["--js-flags=--expose-gc", "--window-size=1280,960"],
  drive: async ({ cdp, evaluate }) => {
    const res = await evaluate(pageExpr(BODY, 400));
    if (!res || res.__threw) return res;
    res.real = await realInput(cdp, evaluate);
    const b = await evaluate(`({ errs: (window.__boot || {}).errs || [], rejs: (window.__boot || {}).rejs || [] })`);
    res.__errs = b.errs; res.__rejs = b.rejs;
    return res;
  } });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== going to a state ===");
R.is(o.five.v === 5 && o.five.at === 5 && o.five.n === 5, `five steps, the image in state ${o.five.v}`);
R.is(o.back.v === 2 && o.back.at === 2 && o.back.redo === 3 && o.back.r.done === 3,
  `goTo(2) puts the image in state 2 (v = ${o.back.v}), three steps undone and still redoable (${o.back.redo})`);
R.is(o.back.said === 1 && /^Back 3 steps, to “s2”/.test(o.back.status),
  `and a three-step walk says one thing, not three (${o.back.said}): "${o.back.status}"`);
R.is(o.fwd.v === 4 && o.fwd.redo === 1 && /^Forward 2 steps, to “s4”/.test(o.fwd.status),
  `goTo(4) redoes forward to state 4 (v = ${o.fwd.v}): "${o.fwd.status}"`);
R.is(o.start.v === 0 && /start of the history/.test(o.start.status), `goTo(0) is Start — every step undone (v = ${o.start.v})`);
R.is(o.clamped.v === 5, `a state past the end is the last one there is (v = ${o.clamped.v})`);

console.log("\n=== the window ===");
const rows = o.rows;
console.log("   " + rows.map(x => x.name + (x.cost ? " " + x.cost : "") + (/cur/.test(x.cls) ? " [cur]" : "") + (/undone/.test(x.cls) ? " [undone]" : "")).join(" · "));
R.is(rows.length === 6 && rows[0].name === "Start" && rows[5].name === "s5",
  `one row per state — Start and the five steps, oldest first (${rows.length} rows)`);
R.is(/cur/.test(rows[3].cls) && rows.filter(x => /cur/.test(x.cls)).length === 1,
  "exactly one row is the current state, and it is the one the image is in (s3)");
R.is(/undone/.test(rows[4].cls) && /undone/.test(rows[5].cls) && !/undone/.test(rows[2].cls),
  "the steps after it are greyed as undone, and none before it");
R.is(rows[1].cost === "512 KB" && rows[2].cost === "1.0 MB" && rows[5].cost === "2.5 MB" && rows[0].cost === "",
  `each step shows what it costs (${rows.slice(1).map(x => x.cost).join(", ")}) — the number the budget spends`);
R.is(/3 steps held/.test(o.hint) && /2 undone/.test(o.hint) && /384 MB/.test(o.hint), `the hint states steps, undone and limit: "${o.hint}"`);
R.is(o.clickBack.v === 1 && o.clickFwd.v === 4 && o.clickStart.v === 0,
  `clicking a row goes to its state — back to s1 (${o.clickBack.v}), forward through the greyed ones to s4 (${o.clickFwd.v}), and Start (${o.clickStart.v})`);
R.is(o.followed.rows === 7 && o.followed.last === "s6" && o.followed.cur,
  `an open list follows the stacks by itself — a new edit is a new current row (${o.followed.rows} rows, last "${o.followed.last}")`);

console.log("\n=== checkpoints ===");
R.is(o.marked.marks.join() === "3:before weathering" && /Checkpoint “before weathering”/.test(o.marked.status),
  `the typed name lands on the state the image is in, whitespace tidied (${o.marked.marks.join()})`);
R.is(o.markBlock.rows === 1 && o.markBlock.name === "before weathering" && o.markBlock.flagged === 1,
  "it is listed in its own block and flagged on its row in the list");
R.is(o.toMark.v === 3, `clicking the checkpoint goes back to it (v = ${o.toMark.v})`);
R.is(o.numbered.join() === "3:before weathering,5:Checkpoint 2", `no name gets a numbered one, and Enter works like the button (${o.numbered.join()})`);
R.is(o.renamed.join() === "3:before weathering,5:renamed", `naming a state again renames it rather than stacking a second (${o.renamed.join()})`);
R.is(o.base.marks[0] === "0:as loaded" && o.base.label === "as loaded", `Start can be named too (${o.base.marks.join()})`);
R.is(o.unmarked.marks.join() === "0:as loaded,3:before weathering" && o.unmarked.steps === 6,
  `the ✕ takes the checkpoint away and leaves its step (${o.unmarked.marks.join()}; ${o.unmarked.steps} steps)`);

console.log("\n=== eviction keeps a checkpoint's state exact ===");
R.is(o.ev1.marks.join() === "1:after b" && o.ev1.first === "b",
  `dropping the oldest step renumbers the states and keeps the name on its own (${o.ev1.marks.join()})`);
R.is(o.ev2.marks.join() === "0:after b" && o.ev2.label === "after b" && o.ev2.said === 0,
  `when its OWN step is dropped the state is still reachable — it is Start now, and it keeps its name (${o.ev2.marks.join()}), with nothing said about a loss that did not happen`);
R.is(o.ev2.startV === 2, `and going to Start really is the state after b (v = ${o.ev2.startV})`);
R.is(o.ev3.marks.length === 0 && o.ev3.base === null && /Checkpoint “after b” dropped with the oldest steps — the undo memory is full. Raise “Undo memory”/.test(o.ev3.status),
  `when the step AFTER it goes, the state is out of reach — the name goes and that is said: "${o.ev3.status}"`);

console.log("\n=== an edit over undone steps ===");
R.is(o.redoDrop.marks.length === 0 && /“x2 state” was on an undone step/.test(o.redoDrop.status),
  `a name on an undone step goes with it when an edit replaces it, and is said: "${o.redoDrop.status}"`);
R.is(o.redoDrop.v === 2 && o.redoDrop.at === 2, "the edit itself is an ordinary step");

console.log("\n=== a stale row ===");
R.is(o.stale.v === o.stale.vWas && /not in the history any more/.test(o.stale.status),
  `a row drawn before the history was cleared walks nowhere (v stays ${o.stale.v}) and says so`);
R.is(/No undo history yet/.test(o.stale.usage) && /nothing to undo/.test(o.stale.title),
  "and the clear refreshed the Settings hint and the undo button's tooltip, which the six direct clears never did");

console.log("\n=== a long walk ===");
const L = o.long;
console.log(`   20 steps of 25 ms: ${L.ms} ms, the page had the thread ${L.beats} times, longest gap ${L.maxGap} ms, bar ${L.sawBar ? "shown" : "not shown"}`);
R.is(L.v === 0 && L.r.done === 20 && L.r.why === "", `it arrives (v = ${L.v}, ${L.r.done} steps)`);
R.is(L.beats >= 3 && L.maxGap < L.ms * .7,
  `it yields — the page ran ${L.beats} times during it and the longest block was ${L.maxGap} of ${L.ms} ms (one block would be all of it)`);
R.is(L.sawBar && !L.barAfter, "behind the progress bar, which is gone when it ends");
R.is(L.said === 1, `and it says one thing (${L.said} messages for 20 steps)`);
R.is(o.cancel.r.why === "cancelled" && o.cancel.r.done > 0 && o.cancel.r.done < 20 && o.cancel.v === o.cancel.at && !o.cancel.barAfter,
  `Cancel stops it at a real state — ${o.cancel.r.done} of 20 steps, v = ${o.cancel.v} = state ${o.cancel.at}: "${o.cancel.status}"`);
R.is(o.moved.r.why === "moved" && o.moved.r.done < 20 && o.moved.top === "intruder" && o.moved.v === o.moved.at,
  `an edit made while it had yielded stops it, and the edit is the newest step (${o.moved.r.done} of 20, v = ${o.moved.v} = state ${o.moved.at})`);
R.is(o.overlap.second.why === "busy" && o.overlap.v === 0,
  `a second walk asked for during the first is refused, not interleaved (${o.overlap.second.why}; v = ${o.overlap.v})`);

console.log("\n=== something started while it has yielded ===");
const S = o.underStroke;
console.log(`   a stroke begun at state ${S.begin} and held 200 ms: the walk was at state ${S.held} when it let go; ${JSON.stringify(S.r)}`);
R.is(S.bar && S.r.why === "interrupted" && S.held === S.begin && S.r.done < S.r.total,
  `a stroke begun by code in one of its yields stops it there — no step is taken under it (began at ${S.begin}, still ${S.held} while held; ${S.r.done} of ${S.r.total} steps)`);
R.is(S.framed.touched === 10 * S.begin && S.framed.untouched === 10 * S.begin,
  `so the stroke's frames put back tiles of the state the rest of the layer is in (red ${S.framed.touched} in its tile, ${S.framed.untouched} elsewhere; state ${S.begin} is ${10 * S.begin})`);
R.is(S.top === "color stroke" && S.undone.at === S.begin && S.undone.touched === 10 * S.begin && S.undone.untouched === 10 * S.begin,
  `and undoing the stroke leaves the layer in one state of the history, the one it began on (state ${S.undone.at}: red ${S.undone.touched} and ${S.undone.untouched}, want ${10 * S.begin})`);
R.is(/because something else was started/.test(S.status), `it says why it stopped: "${S.status}"`);
R.is(o.pressed.r.why === "interrupted" && o.pressed.after === o.pressed.at && o.pressed.v === o.pressed.at && o.pressed.r.done < 20,
  `a press anywhere else stops it where it is — any gesture begins with one (${o.pressed.r.done} of 20, state ${o.pressed.after} = v ${o.pressed.v})`);
R.is(o.keyed.r.why === "interrupted" && o.keyed.after === o.keyed.at && o.keyed.v === o.keyed.at,
  `and so does a key (${o.keyed.r.done} of 20, state ${o.keyed.after})`);
R.is(o.inside.r.why === "" && o.inside.r.done === 20 && o.inside.v === 0 && o.inside.at === 0,
  `a press on the History window, on its button or on the progress strip, and Shift on its own, do not (${JSON.stringify(o.inside.r)}, v = ${o.inside.v})`);

console.log("\n=== with real input: a walk is begun by a click, and the click keeps the focus ===");
const A = o.real.A, B = o.real.B;
console.log(`   A: clicked "${A.row.text}"${A.row.hit ? "" : " (the point is NOT on it)"}; the arrow went down at state ${A.down.at} with the focus on ${A.before.focus}; ` +
  `${JSON.stringify(A.end.r)}; after the nudge is undone the history is at ${A.undone.at} and the decal at x ${A.undone.x}`);
R.is(A.row.text === "Start" && A.row.hit && A.before.busy && A.before.bar && A.before.inWin && /histrow/.test(A.before.focus),
  `a real click on a row starts the walk and leaves the focus on that row, inside the window (${A.before.focus}) — where every key of a real walk is aimed`);
R.is(A.end.r && A.end.r.why === "interrupted" && A.end.r.done < A.end.r.total && A.end.at === A.down.at + 1 && A.end.top === "move decal",
  `a real arrow key there stops it where it is (${A.end.r && A.end.r.done} of ${A.end.r && A.end.r.total} steps), and the nudge it begins is the newest step (state ${A.end.at}, "${A.end.top}")`);
R.is(A.undone.at === A.down.at && A.undone.x === A.undone.want,
  `so undoing the nudge leaves the decal in the state the history says (state ${A.undone.at}: x ${A.undone.x}, want ${A.undone.want})`);
console.log(`   B: clicked "${B.row.text}"${B.row.hit ? "" : " (the point is NOT on it)"}; Shift with the focus on ${B.before.focus}, then a click into the name and "k" typed there at state ${B.typed.at}; ${JSON.stringify(B.end.walk)}`);
R.is(B.row.hit && B.before.inWin && B.after.busy && B.typed.focus === "input#histMarkName",
  `the control ran under the same walk: Shift went down with the focus on the row, and the walk was still going after the letter was typed into the name (${B.typed.focus})`);
R.is(B.end.walk && B.end.walk.why === "" && B.end.walk.done === REAL_STEPS && B.end.at === 0 && B.end.x === 60 && B.end.name === "k",
  `and none of it stops the walk — it reaches Start (${B.end.walk && B.end.walk.done} steps, x ${B.end.x}), and the letter is in the name ("${B.end.name}")`);

console.log("\n=== a closed window holds no step ===");
const H = o.held;
R.is(H.gc, "gc() is exposed, so every reading below follows forced collections");
R.is(H.never === 3 && H.control,
  `the instrument sees both answers: steps nothing drew are freed by a clear (${H.never}/3), and one a hidden button's handler closes over is not (${H.control ? "held" : "freed"})`);
R.is(H.rowsOpen > 0 && H.rowsClosed === 0, `closing the window takes its rows with it (${H.rowsOpen} rows open, ${H.rowsClosed} closed)`);
R.is(H.cleared === 3, `so a clear after one look at History frees what the steps held (${H.cleared}/3 freed)`);
R.is(H.evictedHeld === 0 && H.evicted === 3, `and so does eviction through the budget (${H.evicted}/3 freed, ${H.evictedHeld} still in the history)`);
R.is(H.rowsHidden === 0, `a window hidden any other way is emptied by the next change the history reports (${H.rowsHidden} rows)`);
const MW = H.midWalk;
R.is(MW.busy && !MW.shown && MW.at === 0 && MW.v === 0 && MW.rows === 0,
  `a window closed by its ✕ while a walk runs is not filled again when the walk ends (${MW.rows} rows; ` +
  `the walk ${MW.busy ? "was running" : "had NOT started"} at the ✕ and went on to state ${MW.at}, v = ${MW.v})`);

console.log("\n=== every clear goes through one funnel ===");
// Read from src/, not the page: a direct clear anywhere but UndoHistory.clear is a list on screen
// that can outlive the history it drew, and a Settings hint that goes stale.
const offenders = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "vendor") walk(p); continue; }
    if (!/\.js$/.test(f)) continue;
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/(undoStack|redoStack)\.length\s*=\s*0/.test(line) && !/^\s*\/\//.test(line) && rel !== "src/core/undo.js")
        offenders.push(rel + ":" + (i + 1));
    });
  }
})(path.join(ROOT, "src"));
R.is(offenders.length === 0, offenders.length ? "direct clears outside UndoHistory.clear: " + offenders.join(", ")
  : "no module clears the stacks itself — every clear is UndoHistory.clear()");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
