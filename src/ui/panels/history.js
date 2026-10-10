// ---------- The History window: every step held, where you are, and named checkpoints ----------
// ROADMAP 4.50 (15). `UndoHistory` (core/undo.js) is the timeline and the walk; this is the window
// under the top bar's History button that draws it — Photoshop's History panel, on the same two
// facts the stack always carried for each step: its label and what it costs.
//
// Rows are drawn from the stacks as they are, and each remembers the STEP it stands for rather than
// its index: a click asks `UndoHistory.stateOf(step)` at that moment, so a list drawn before the
// history was cleared (a project opened, a sheet resized) says so instead of walking somewhere else.
// It is redrawn on every change the stacks report, once per frame, and only while it is open.
//
// **And the rows exist only while it is open.** A row holds its step, and a step holds whatever it
// restores — a bake's two whole-sheet snapshots, a stroke's tiles, the slot and its layers. Closing
// the window used to only hide it, so its rows kept every step of the last render alive after the
// history had let them go: measured in review (2026-09-27, a WeakRef on each step's 32 MB), opened
// once, closed and cleared, 0 of 3 were freed; evicted through a 128 MB budget, the heap stood at
// 230 MB. A vehicle switched after one look at History kept the old vehicle's history. So a hidden
// window is emptied (`forget`) — on close, and by any render or notice that finds it hidden.
const HistoryUI = {
  queued: false,
  // A flag on a pole — the checkpoint's mark in the list and in its own block.
  FLAG: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" ' +
        'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2.5 11V1.5"/>' +
        '<path d="M2.5 2h7l-1.8 2.5L9.5 7h-7" fill="currentColor" fill-opacity=".35"/></svg>',
  // Where the image is now (filled) and every other state (hollow).
  DOT: on => '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.2" ' +
        (on ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.2"') + '/></svg>',

  shown(){ const w = $("winHistory"); return !!w && w.style.display !== "none"; },
  schedule(){
    if (!HistoryUI.shown()) { HistoryUI.forget(); return; }
    if (HistoryUI.queued) return;
    HistoryUI.queued = true;
    requestAnimationFrame(() => { HistoryUI.queued = false; HistoryUI.render(); });
  },
  // Drop every row, and with them the steps they hold — see the header.
  forget(){
    for (const id of ["histList", "histMarks"]) { const el = $(id); if (el && el.firstChild) el.textContent = ""; }
  },
  // Anything started while a walk has yielded stops it where it is (UndoHistory.interrupt): a press
  // anywhere but on this window, its top-bar button or the progress strip (whose Cancel is the other
  // way to stop it), and any key but a modifier held on its own or one typed into the checkpoint's
  // name. A press on a row here while a walk runs is refused by `go` instead, and closing the window —
  // by its ✕ or by its button — begins nothing. Capture phase on the window, so it runs before
  // whatever the press or the key goes on to begin.
  //
  // **A key is judged by what it is, never by where the focus is.** A walk begins with a click on a
  // row, and the click leaves the focus ON that row; ui/keys.js acts on a key wherever the focus is,
  // short of a text box. So a key aimed at this window was every key of every real walk, and exempting
  // those let an arrow nudge a decal from a state the walk then went on past: measured in review of
  // the fix (2026-09-27, real mouse and key input) on 20 steps that each move a decal, the arrow went
  // down at state 10, the walk ran on to Start, and once the nudge was undone the history said Start
  // while the decal stood where state 10 had put it. The press test by target stays, because a press
  // names what it lands on. The one text box here is exempt because ui/keys.js passes over a text box
  // and the box's own Enter only names the state the image is in — a name, which nothing a walk puts
  // back touches.
  watchInput(e){
    if (!UndoHistory.busy) return;
    if (e.type === "keydown") {
      if (/^(Shift|Control|Alt|Meta)(Left|Right)$|^CapsLock$/.test(e.code)) return;
      if (e.target === $("histMarkName")) return;
    } else {
      const t = e.target && e.target.closest ? e.target : null;
      if (t && t.closest("#winHistory, #btnHistoryWin, #progWrap")) return;
    }
    UndoHistory.interrupt();
  },
  // What a step costs, in the unit that makes it readable. Most steps report nothing — a selection
  // or a slider is a closure over a few numbers — and those show nothing rather than "0 KB".
  size(b){
    if (!(b > 0)) return "";
    if (b < 1024) return "<1 KB";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    const mb = b / 1048576;
    return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + " MB";
  },

  render(){
    const list = $("histList"), marks = $("histMarks");
    if (!list || !marks) return;
    if (!HistoryUI.shown()) { HistoryUI.forget(); return; }     // rows only while it is open — see the header
    const steps = UndoHistory.steps(), at = UndoHistory.at();
    HistoryUI.hint(steps.length, at);
    list.textContent = "";
    list.appendChild(HistoryUI.row(0, null, at));
    steps.forEach((a, i) => list.appendChild(HistoryUI.row(i + 1, a, at)));
    HistoryUI.marksBlock(marks, at);
    const cur = list.querySelector(".cur");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  },
  hint(n, at){
    const h = $("histHint");
    if (!h) return;
    const held = at, undone = n - at, mb = undoBytes();
    h.textContent = !n ? "Nothing to undo yet. Each edit appears here as a step you can click to go back to."
      : held + " step" + (held === 1 ? "" : "s") + " held (" + (HistoryUI.size(mb) || "0 MB") + " of " +
        Math.round(App.undoBudget / 1048576) + " MB)" + (undone ? ", " + undone + " undone" : "") +
        ". Click a step to go back to it.";
  },
  // One state. `k` is the state it goes to, `step` the step that produced it (null for Start).
  row(k, step, at){
    const b = document.createElement("button");
    const mark = k === 0 ? UndoHistory.baseMark : step.mark;
    b.className = "histrow" + (k === at ? " cur" : "") + (k > at ? " undone" : "") + (mark ? " marked" : "");
    b.title = k === at ? "The image is here now"
      : k > at ? "Undone — click to redo up to this step"
      : k === 0 ? "The oldest state the history still holds — click to undo every step below"
      : "Go back to here — the image as it was after this step";
    const dot = document.createElement("span");
    dot.className = "hi"; dot.innerHTML = HistoryUI.DOT(k === at);
    const nm = document.createElement("span");
    nm.className = "hn"; nm.textContent = k === 0 ? "Start" : step.desc;
    b.append(dot, nm);
    if (mark) {
      const m = document.createElement("span");
      m.className = "hm"; m.innerHTML = HistoryUI.FLAG;
      m.appendChild(document.createTextNode(" " + mark));
      b.appendChild(m);
    }
    const cost = document.createElement("span");
    cost.className = "hb"; cost.textContent = k === 0 ? "" : HistoryUI.size(step.bytes);
    b.appendChild(cost);
    b.onclick = () => HistoryUI.go(step);
    return b;
  },
  marksBlock(el, at){
    el.textContent = "";
    const ms = UndoHistory.marks();
    if (!ms.length) return;
    const h = document.createElement("div");
    h.className = "histhead"; h.textContent = "Checkpoints";
    el.appendChild(h);
    for (const m of ms) {
      const r = document.createElement("div");
      r.className = "histmark";
      const go = document.createElement("button");
      go.className = "histrow marked" + (m.state === at ? " cur" : "") + (m.state > at ? " undone" : "");
      go.title = m.state === at ? "The image is at this checkpoint now" : "Go to this checkpoint";
      const f = document.createElement("span");
      f.className = "hi"; f.innerHTML = HistoryUI.FLAG;
      const nm = document.createElement("span");
      nm.className = "hn"; nm.textContent = m.name;
      const after = document.createElement("span");
      after.className = "hb"; after.textContent = m.state === 0 ? "start" : "step " + m.state;
      go.append(f, nm, after);
      go.onclick = () => HistoryUI.go(m.step);
      const x = document.createElement("button");
      x.className = "twx"; x.textContent = "✕"; x.title = "Remove this checkpoint — the step stays";
      x.onclick = () => HistoryUI.unmark(m.step);
      r.append(go, x);
      el.appendChild(r);
    }
  },

  // ---- the three things a click does ----
  async go(step){
    const k = step ? UndoHistory.stateOf(step) : 0;
    if (k < 0) { setStatus("That step is not in the history any more — the list has been redrawn", "err"); HistoryUI.render(); return; }
    if (UndoHistory.busy) { setStatus("Still walking the history — wait for it, or press Cancel", "err"); return; }
    await UndoHistory.goTo(k);
    HistoryUI.render();
  },
  unmark(step){
    const k = step ? UndoHistory.stateOf(step) : 0;
    if (k < 0) { HistoryUI.render(); return; }
    const name = UndoHistory.label(k);
    UndoHistory.unmark(k);
    setStatus("Checkpoint “" + name + "” removed — the step is still in the history", "ok");
  },
  markHere(){
    const inp = $("histMarkName");
    const name = UndoHistory.mark(inp ? inp.value : "");
    if (inp) inp.value = "";
    const k = UndoHistory.at();
    setStatus("Checkpoint “" + name + "” — " + (k === 0 ? "the start of the history" : "after “" + UndoHistory.steps()[k - 1].desc + "”") +
      ". Click it in History to come back here.", "ok");
  },
};
// The list hears about every change the stacks make (core/undo.js calls this from refreshUndoUsage,
// which every push, undo, redo, trim and clear ends in). One top-level call, and the object it
// registers with is declared in a script above this one.
UndoHistory.watch(() => HistoryUI.schedule());
window.addEventListener("pointerdown", e => HistoryUI.watchInput(e), true);
window.addEventListener("keydown", e => HistoryUI.watchInput(e), true);
$("btnHistMark").onclick = () => HistoryUI.markHere();
$("histMarkName").addEventListener("keydown", e => {
  if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); HistoryUI.markHere(); }
});
