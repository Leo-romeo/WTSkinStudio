// ---------- Undo / redo ----------
App.redoStack = [];
// History is trimmed by memory, not by a flat entry count: a selection toggle costs a few
// hundred bytes and a full-texture snapshot costs hundreds of megabytes, so a single cap either
// threw away paint strokes after 40 clicks in the Parts list or hoarded gigabytes of bitmaps.
//
// The ceiling is a SETTING now (ROADMAP 1.5): 384 MB is conservative on a machine that can hold
// much more, and the user painting 8K sheets is exactly the one who notices. It is read once from
// `#optUndoBudget` and written down nowhere else — the settings table captures a row's default by
// reading the live control, so a second copy here is the drift 3.12 exists to prevent. (`$` in
// core/ is this module's own precedent: it has always bound the two toolbar buttons below.)
const UNDO_MAX_ENTRIES = 250;
App.undoBudget = +$("optUndoBudget").value * 1048576;
function undoBytes(){ return App.undoStack.reduce((n, a) => n + (a.bytes || 0), 0); }
// One copy of the eviction rule — it used to be written out identically in pushAction and in
// withUndoBatch, and lowering the budget needs a third caller. At least one entry always survives:
// a single step too big for the whole budget is still better than no undo at all.
let undoWasFull = false;
function trimUndoStack(){
  let dropped = 0, byCount = false;
  const lost = [];                             // checkpoint names that went with the dropped steps
  while (App.undoStack.length > UNDO_MAX_ENTRIES || (App.undoStack.length > 1 && undoBytes() > App.undoBudget)) {
    if (App.undoStack.length > UNDO_MAX_ENTRIES) byCount = true;
    UndoHistory.dropOldest(lost);
    dropped++;
  }
  // Say it once per fill, not once per stroke. Eviction was completely invisible before — "my undo
  // only goes back four steps" had no explanation anywhere in the UI — and once the history is full
  // it happens on every single stroke, so a message per eviction would be worse than silence.
  //
  // The flag means "already said, and the history has not come back down since" — nothing else.
  // The first version also armed it at 80% of the budget, which read as caution and in fact
  // swallowed the very first eviction: the stack crosses 80% on the push *before* the one that
  // drops anything, so the flag was always already true by the time there was something to say.
  if (dropped) {
    if (!undoWasFull) setStatus("Undo history is full at " + Math.round(App.undoBudget / 1048576) +
      " MB — the oldest steps are being dropped. Raise “Undo memory” in Settings if you need to go back further.", "err");
    undoWasFull = true;
  } else if (undoBytes() < App.undoBudget * .8) {
    undoWasFull = false;                       // back down with room to spare — worth saying again
  }
  // A checkpoint is a name the user typed, so losing one is said every time, and after the
  // once-per-fill line above: it is the more specific of the two. It is said from inside the edit that
  // lost it, and that edit sets its own line straight after — so the line is held for the rest of the
  // task (StatusLog.hold), or the notice would be replaced before it was ever seen. A history full by
  // its step count is not helped by more memory, so that case does not send anyone to Settings.
  if (lost.length) {
    setStatus("Checkpoint " + lost.map(n => "“" + n + "”").join(", ") + " dropped with the oldest steps — " + (byCount
      ? "the history keeps at most " + UNDO_MAX_ENTRIES + " steps."
      : "the undo memory is full. Raise “Undo memory” in Settings to keep more."), "err");
    StatusLog.hold();
  }
  refreshUndoUsage();
  return dropped;
}
function setUndoBudget(mb){
  const el = $("optUndoBudget");
  el.value = String(mb);
  // A value that is not one of the options leaves a <select> on nothing at all, and `+"" * 1048576`
  // is a budget of ZERO — which would throw the whole history away on the next push. Fall back to
  // the option the markup ships as selected, which is also the default the settings table captured.
  if (el.selectedIndex < 0) el.selectedIndex = Math.max(0, [...el.options].findIndex(o => o.defaultSelected));
  App.undoBudget = +el.value * 1048576;
  trimUndoStack();
}
// What the history is costing, where somebody wondering why undo stopped would look: the Settings
// hint, and the tooltip of the button they are already pointing at.
function refreshUndoUsage(){
  const mb = undoBytes() / 1048576, cap = App.undoBudget / 1048576, n = App.undoStack.length;
  const el = $("undoUsage");
  if (el) el.textContent = n
    ? n + " step" + (n === 1 ? "" : "s") + " held, " + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB of " + Math.round(cap) + " MB."
    : "No undo history yet — the limit is " + Math.round(cap) + " MB.";
  const b = $("btnUndo");
  if (b) b.title = "Undo (Ctrl+Z)" + (n ? " — " + n + " step" + (n === 1 ? "" : "s") + ", " +
    (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB of " + Math.round(cap) + " MB" : " — nothing to undo");
  // Every change to the stacks ends here — a push (through the trim), an undo, a redo, a new
  // budget, a clear — so this is where the history list hears about it.
  UndoHistory.notify();
}
// While a batch is open every pushAction is collected instead of stacked, so one user action
// that has to touch several slots (a fill spread over every texture a selection covers) is still
// one Ctrl+Z. Undo runs the collected steps in reverse, redo in order.
let undoBatch = null;
function withUndoBatch(desc, fn){
  if (undoBatch) return fn();                                  // already inside one — don't nest
  const acts = undoBatch = [];
  try { fn(); } finally { undoBatch = null; }
  if (!acts.length) return;
  if (acts.length === 1) { Autosave.stamp(acts[0]); App.undoStack.push(acts[0]); }
  else pushAction(desc,
    () => { for (let i = acts.length - 1; i >= 0; i--) acts[i].undo(); },
    () => { for (const a of acts) a.redo(); },
    acts.reduce((n, a) => n + (a.bytes || 0), 0));
  trimUndoStack();
  UndoHistory.dropRedo();
}
// Every step carries the document revision before and after it (ROADMAP 4.50(2)): the history is
// the one place every edit passes through, so it is where "is there unsaved work?" is answered —
// and undoing back to the state that was saved makes the project clean again. core/autosave.js.
// Returns the step, for the one caller that folds another into it (endStroke).
function pushAction(desc, undo, redo, bytes){
  const a = { desc, undo, redo, bytes: bytes || 0 };
  if (undoBatch) { undoBatch.push(a); return a; }
  Autosave.stamp(a);
  App.undoStack.push(a);
  trimUndoStack();
  UndoHistory.dropRedo();
  return a;
}
// `quiet` is one step of a longer walk — `UndoHistory.goTo`, which says its piece once at the end
// and refreshes once rather than per step. The step itself is this function's in both cases, so
// anything that has to follow every undo (the document's revision, say) is written here once and
// the walk gets it for free. Returns the step, or null when there was none.
function doUndo(quiet){
  const a = App.undoStack.pop();
  if (!a) { if (!quiet) setStatus("Nothing to undo"); return null; }
  a.undo(); App.redoStack.push(a);
  Autosave.moveTo(a.revFrom);
  if (quiet) return a;
  setStatus("Undid: " + a.desc, "ok");
  refreshUndoUsage();
  draw2D();
  return a;
}
function doRedo(quiet){
  const a = App.redoStack.pop();
  if (!a) { if (!quiet) setStatus("Nothing to redo"); return null; }
  a.redo(); App.undoStack.push(a);
  Autosave.moveTo(a.revTo);
  if (quiet) return a;
  setStatus("Redid: " + a.desc, "ok");
  refreshUndoUsage();
  draw2D();
  return a;
}
// ---------- The history as a list: where you are, any step to go back to, named checkpoints ----------
// ROADMAP 4.50 (15). The stacks always knew each step's label and what it costs; this is the rest of
// what Photoshop's History panel does with the same two facts. It owns no pixels and no DOM — going
// to a step is the undo or redo Ctrl+Z runs, once per step — and `HistoryUI`
// (ui/panels/history.js) is what draws it.
//
// **The list is one timeline:** the steps held, oldest first, then the undone ones in the order
// they would be redone. State k is "after the first k steps"; the document is in state
// `App.undoStack.length`; state 0 is Start — the oldest state the history can still reach, which is
// the vehicle as loaded only until the first eviction.
//
// **A checkpoint names a STATE, not a step,** and that is what keeps it exact under eviction. State
// k's name rides on the k-th step (`a.mark`), Start's on `baseMark`. Dropping the oldest step does not
// lose the state AFTER it — that state becomes the new Start, so its name moves to `baseMark` — while
// the state before it is really gone, and so is any name on it. A name on an undone step goes when a
// new edit discards that step. Both losses are said, because a name is something the user typed.
// Nothing here is saved with a project: the history never has been (a load clears it).
const UndoHistory = {
  baseMark: null,              // the name on the Start state, when a checkpoint sits there
  busy: false,                 // a walk is moving the stacks
  interrupted: false,          // something was started while the walk had yielded: no further step
  YIELD_MS: 150,               // a walk runs straight through this long, then yields behind the progress bar
  MAX_NAME: 60,
  watchers: [],
  watch(fn){ UndoHistory.watchers.push(fn); },
  notify(){ for (const f of UndoHistory.watchers) f(); },

  steps(){
    const s = App.undoStack.slice();
    for (let i = App.redoStack.length - 1; i >= 0; i--) s.push(App.redoStack[i]);
    return s;
  },
  at(){ return App.undoStack.length; },
  // The state a step leads to — where a click on its row goes — or -1 once the step is not held any
  // more. A row is drawn from the stacks as they were; asking by identity is what makes a click on a
  // row drawn before a clear say so instead of walking to whatever now sits at that index.
  stateOf(a){ const i = UndoHistory.steps().indexOf(a); return i < 0 ? -1 : i + 1; },
  label(k){
    if (k <= 0) return UndoHistory.baseMark || "Start";
    const a = UndoHistory.steps()[k - 1];
    return a ? (a.mark || a.desc) : "";
  },

  // ---- checkpoints ----
  // Names the state the document is in now. An empty name gets a numbered one, and naming a state
  // that already has a name renames it, which is the whole of "rename".
  mark(name){
    name = String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, UndoHistory.MAX_NAME);
    if (!name) name = "Checkpoint " + (UndoHistory.marks().length + 1);
    const k = UndoHistory.at();
    if (k === 0) UndoHistory.baseMark = name;
    else App.undoStack[k - 1].mark = name;
    UndoHistory.notify();
    return name;
  },
  unmark(k){
    if (k === 0) UndoHistory.baseMark = null;
    else { const a = UndoHistory.steps()[k - 1]; if (a) delete a.mark; }
    UndoHistory.notify();
  },
  marks(){
    const out = UndoHistory.baseMark ? [{ state: 0, name: UndoHistory.baseMark, step: null }] : [];
    UndoHistory.steps().forEach((a, i) => { if (a.mark) out.push({ state: i + 1, name: a.mark, step: a }); });
    return out;
  },

  // ---- the three ways states go ----
  // The oldest step is being evicted (trimUndoStack): the state before it goes out of reach, and the
  // state after it is the new Start.
  dropOldest(lost){
    const a = App.undoStack.shift();
    if (UndoHistory.baseMark) lost.push(UndoHistory.baseMark);
    UndoHistory.baseMark = (a && a.mark) || null;
  },
  // A new edit: every undone step is discarded, and a name on a state they led to with it.
  dropRedo(){
    const lost = App.redoStack.filter(a => a.mark).map(a => a.mark);
    App.redoStack.length = 0;
    if (!lost.length) return;
    setStatus("Checkpoint " + lost.map(n => "“" + n + "”").join(", ") + " was on an undone step, and this edit replaced it", "err");
    StatusLog.hold();                          // over the edit's own line, set straight after (see trimUndoStack)
  },
  // The whole history at once: a project opened, a vehicle cleared, a sheet resized or replaced
  // under its snapshots. It was `App.undoStack.length = 0; App.redoStack.length = 0;` written out at
  // six call sites, and none of them could tell a list on screen that its rows had stopped existing.
  clear(){
    App.undoStack.length = 0; App.redoStack.length = 0;
    UndoHistory.baseMark = null;
    refreshUndoUsage();
  },

  // ---- going to a state ----
  // The walk is the same undo or redo Ctrl+Z runs, once per step, and every step can be a sheet's
  // worth of pixels put back — so a long one yields to the page behind the progress bar and can be
  // cancelled (CLAUDE.md §3.5), and it stops at a real state the moment anything else is started or
  // moves the stacks while it has yielded: a stroke begun between two of its frames, a drag, a key.
  // Resolves { done, total, why } where `why` is "", "cancelled", "interrupted", "moved" or "busy".
  //
  // **Started, not only pushed.** A gesture reaches the stacks when it ENDS — a stroke, a marquee
  // drag, a decal dragged, a guide, a slider — but it records what it will put back when it BEGINS,
  // on the state the walk has reached by then. The walk used to stop only when the stacks moved, so
  // it went on undoing under a stroke held down in one of its yields; the stroke's frames put its
  // tiles back from that earlier state and its undo put them back again. Measured in review
  // (2026-09-27) on a 1024² layer filled flat per state: a stroke begun at state 14 was held while the
  // walk went on to state 5, and once the stroke was undone the history said state 5 while every tile
  // the stroke touched held state 14 — and the stroke's own push had discarded the redo steps, so no
  // step led back to either. So a press or a key while a walk is running ends it where it is
  // (`interrupt`, called by ui/panels/history.js for every one, and by `beginStroke` itself, since
  // code begins strokes as well as pointers do), and what was started begins on a real state.
  interrupt(){ if (UndoHistory.busy) UndoHistory.interrupted = true; },
  async goTo(k){
    if (UndoHistory.busy) return { done: 0, total: 0, why: "busy" };
    const from = UndoHistory.at();
    k = Math.max(0, Math.min(UndoHistory.steps().length, Math.round(+k) || 0));
    const total = Math.abs(k - from), back = k < from;
    if (!total) return { done: 0, total: 0, why: "" };
    UndoHistory.busy = true; UndoHistory.interrupted = false;
    let done = 0, why = "", bar = false;
    const t0 = performance.now();
    try {
      while (done < total) {
        const u = App.undoStack.length, r = App.redoStack.length;
        if (!(back ? doUndo(true) : doRedo(true))) { why = "moved"; break; }
        done++;
        if (done === total || performance.now() - t0 < UndoHistory.YIELD_MS) continue;
        if (!bar) { progBegin(back ? "Going back through the history…" : "Going forward through the history…", true); bar = true; }
        progress(null, done / total);
        await progTick();
        if (progCancelled()) { why = "cancelled"; break; }
        if (UndoHistory.interrupted) { why = "interrupted"; break; }
        const d = back ? -1 : 1;
        if (App.undoStack.length !== u + d || App.redoStack.length !== r - d) { why = "moved"; break; }
      }
    } finally {
      UndoHistory.busy = false; UndoHistory.interrupted = false;
      if (bar) progEnd();
    }
    UndoHistory.say(back, done, total, why);
    refreshUndoUsage();
    draw2D();
    return { done, total, why };
  },
  say(back, done, total, why){
    const k = UndoHistory.at(), where = k === 0 ? "the start of the history" : "“" + UndoHistory.label(k) + "”";
    const n = done + " step" + (done === 1 ? "" : "s");
    if (why === "cancelled") setStatus("Stopped after " + done + " of " + total + " steps — the image is at " + where, "err");
    else if (why === "interrupted") setStatus("Stopped after " + done + " of " + total + " steps, because something else was started while it was going — the image is at " +
      where + ", and that is where what you started begins", "err");
    else if (why === "moved") setStatus("Stopped after " + done + " of " + total + " steps — the history changed while it was being walked; the image is at " + where, "err");
    else if (back) setStatus("Back " + n + ", to " + where + ". The greyed steps redo until your next edit.", "ok");
    else setStatus("Forward " + n + ", to " + where, "ok");
  },
};
$("btnUndo").onclick = () => doUndo();
$("btnRedo").onclick = () => doRedo();
refreshUndoUsage();
// one undoable action per slider gesture: capture on first input, commit on change
function bindUndoRange(input, getV, setV, desc, onInput){
  let from = null;
  input.addEventListener("input", () => { if (from === null) from = getV(); setV(parseFloat(input.value)); if (onInput) onInput(); });
  input.addEventListener("change", () => {
    const f = from; from = null; const to = getV();
    if (f === null || f === to) return;
    pushAction(desc, () => { setV(f); refreshLayerList(); syncDecalUI(); }, () => { setV(to); refreshLayerList(); syncDecalUI(); });
  });
}
const TILE = 256;
// The paint target exactly as it was before the current stroke started. One canvas-to-canvas blit
// (GPU side, ~8 ms even at 8192²) instead of the getImageData-per-tile the tile recorder used to
// do: on an accelerated canvas getImageData pulls the WHOLE surface back off the GPU, not the
// rectangle asked for, so a stroke that wandered across twenty tiles paid twenty full-sheet
// readbacks — 4.3 s of a 58 s profile, all of it inside pointermove. Reused between strokes the
// same way strokeBuffer is, since only one stroke can be live at a time.
// The scratch sheet holding a stroke's pre-stroke pixels. Allocation only — see snapTile below
// for why nothing is copied into it here.
function strokeSnapshot(src){
  let c = strokeSnapshot._c;
  if (!c || c.width !== src.width || c.height !== src.height) c = strokeSnapshot._c = mkCanvas(src.width, src.height);
  return c;
}
// A stroke's undo entry, recorded one tile at a time. Six jobs — which tiles a stamp covers, keeping
// their pre-stroke pixels, putting one back, the rectangle they all fit in, reading them out, and
// pushing the entry — that used to be six closures over eleven shared locals in one 113-line body.
// Same move as `Composite`, `SkinLoad`, `ExportCollect` and `ReplaceTex`: the locals are fields and
// the closures are methods, so each job can be read on its own. The comments below are the record of
// the app's worst measured hitch and are load-bearing documentation; they moved with their code.
//
// `TileUndo` is a plain object used as a prototype: `makeTileUndo` returns an instance, and every
// call site is `stroke.undo.<method>(…)`, so `this` binds the way it reads. Nothing hands one of
// these methods anywhere as a bare callback.
const TileUndo = {
  key(tx, ty){ return tx + "," + ty; },
  tileRect(k){
    const i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
    return { x: tx * TILE, y: ty * TILE,
             w: Math.min(TILE, this.canvas.width - tx * TILE), h: Math.min(TILE, this.canvas.height - ty * TILE) };
  },
  // A stroke needs the pre-stroke pixels of the tiles it touches and no others — but it does not
  // know which those are until the pointer has moved. Copying the whole sheet up front is the
  // obvious way to have them ready, and it was **the single worst hitch in the app**: the copy is
  // queued in 0.1 ms and the bill arrives the moment `restoreTile` first reads it back, which is
  // the first frame of every stroke. Measured at 4096² (2026-08-23, reported as fast strokes
  // and the first stroke after a new layer freezing): frame 1 of a stroke
  // **47 ms**, frames 2-10 **0.2-1.0 ms**. On an 8192² sheet it is four times that.
  //
  // So the copy happens one tile at a time, on the way past in `record()`, which always runs
  // before anything writes to that tile — in the colour path stamps go to `stroke.buf` and only
  // `refreshStrokeView` touches the target, and in the emboss path `record` is the line above the
  // write. A dab is 1-4 tiles of 256², about 1 MB instead of 67.
  //
  // The scratch canvas is shared between strokes and is NOT cleared, so it still holds the last
  // stroke's pixels in tiles this one has not reached. That is safe because every reader —
  // `restoreTile` and `copyTiles` — only ever asks for keys in `touched`, and a key gets into
  // `touched` and snapshotted in the same statement.
  snapTile(k){
    if (this.snapped.has(k)) return;
    this.snapped.add(k);
    const t = this.tileRect(k);
    if (t.w <= 0 || t.h <= 0) return;
    const sg = this.sg;
    sg.globalAlpha = 1; sg.globalCompositeOperation = "source-over"; sg.filter = "none";
    sg.clearRect(t.x, t.y, t.w, t.h);                        // the sheet is reused; no stale alpha
    sg.drawImage(this.canvas, t.x, t.y, t.w, t.h, t.x, t.y, t.w, t.h);
  },
  // The rectangle every recorded tile fits in — lets the composite / surface repack that follows
  // a stroke (or its undo) stay local instead of redoing the whole sheet.
  bbox(){
    let R = null;
    for (const k of this.touched) R = rectUnion(R, this.tileRect(k));
    return rectClamp(R, this.canvas.width, this.canvas.height);
  },
  // The touched tiles copied into one atlas canvas, GPU side — never read back. This was a
  // getImageData per tile row from the snapshot and another from the sheet, and on an accelerated
  // canvas each of those transfers the whole surface whatever rectangle it is given (wt-canvas): the
  // owner's 4096² recordings put `undo` at 80–392 ms on every stroke, a single click included,
  // while the rest of a click cost 7–45 ms (ROADMAP 1.19 (d)); at 8192² it is four times that, the
  // stall after each stroke in 1.17 (3). A drawImage between canvases is queued and stays on the
  // GPU. The atlas is as near square as the tile count allows, so it never grows to a whole sheet
  // for a stroke that crosses one; each tile keeps its own rectangle, partial edge tiles included.
  // `t172_undocommit` holds that commit reads neither the sheet nor the snapshot back.
  copyTiles(src){
    const keys = [...this.touched].filter(k => { const t = this.tileRect(k); return t.w > 0 && t.h > 0; });
    const cols = Math.max(1, Math.ceil(Math.sqrt(keys.length))), rows = Math.max(1, Math.ceil(keys.length / cols));
    const atlas = mkCanvas(cols * TILE, rows * TILE), ag = ctx2d(atlas), at = new Map();
    keys.forEach((k, i) => {
      const t = this.tileRect(k), ax = (i % cols) * TILE, ay = Math.floor(i / cols) * TILE;
      ag.drawImage(src, t.x, t.y, t.w, t.h, ax, ay, t.w, t.h);
      at.set(k, { t, ax, ay });
    });
    // The copies are recorded, not done: Chrome plays them back when the atlas is next used, and if
    // the sheet is written first it must snapshot the WHOLE sheet to keep the copy honest — which
    // landed in the next stroke's first frame (t47 at 4096², 12 ms → 39–58). One texel of the atlas
    // read here plays the copies now; it transfers the atlas, a few tiles, never the sheet.
    if (keys.length) ag.getImageData(0, 0, 1, 1);
    return { atlas, at };
  },
  restoreAll(m){
    const g = this.g;
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    for (const { t, ax, ay } of m.at.values()) {
      g.clearRect(t.x, t.y, t.w, t.h);                       // a tile with alpha must not land on the stroke
      g.drawImage(m.atlas, ax, ay, t.w, t.h, t.x, t.y, t.w, t.h);
    }
    this.after(this.bbox());
  },
  // Put one tile back to its pre-stroke pixels. A blit out of the snapshot, so the live-stroke
  // path never reads the canvas back at all.
  restoreTile(k){
    const t = this.tileRect(k);
    if (t.w <= 0 || t.h <= 0) return null;
    const g = this.g;
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    g.clearRect(t.x, t.y, t.w, t.h);
    g.drawImage(this.snap, t.x, t.y, t.w, t.h, t.x, t.y, t.w, t.h);
    return t;
  },
  record(x, y, r){
    // floor, not ceil: the tile holding the last covered pixel is floor((x+r)/TILE). Rounding
    // up snapshotted an extra row and column of tiles on every single stamp.
    const t0x = Math.max(0, Math.floor((x - r) / TILE)), t1x = Math.min(Math.floor((x + r) / TILE), this.nx - 1);
    const t0y = Math.max(0, Math.floor((y - r) / TILE)), t1y = Math.min(Math.floor((y + r) / TILE), this.ny - 1);
    for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
      const k = this.key(tx, ty);
      this.dirty.add(k); this.touched.add(k); this.snapTile(k);   // before anything writes to it
    }
  },
  commit(){
    if (!this.touched.size) return;
    const b = this.copyTiles(this.snap), a = this.copyTiles(this.canvas);
    let bytes = 0;
    for (const { t } of b.at.values()) bytes += t.w * t.h * 4;
    // These snapshots are the heaviest thing the history holds; without a size the memory
    // budget could not see them and trimmed by entry count alone. `t56_undo` drives this
    // recorder for real and checks the number against the tiles it actually stored.
    pushAction(this.desc, () => this.restoreAll(b), () => this.restoreAll(a), bytes * 2);
  },
};
function makeTileUndo(canvas, desc, after){
  const u = Object.create(TileUndo);
  u.canvas = canvas; u.desc = desc; u.after = after;
  u.g = ctx2d(canvas);
  u.snap = strokeSnapshot(canvas);
  u.sg = ctx2d(u.snap);
  u.nx = Math.ceil(canvas.width / TILE); u.ny = Math.ceil(canvas.height / TILE);
  u.touched = new Set(); u.snapped = new Set();
  u.dirty = new Set();                                       // tiles touched since the view last caught up
  return u;
}
// snapshot-based action for canvas region bakes (decal edits, surface bakes)
function snapCanvas(c){ const s = mkCanvas(c.width, c.height); s.getContext("2d").drawImage(c, 0, 0); return s; }
function bakeAction(desc, canvases, mutate, after){
  // A before+after snapshot of an 8192² texture is ~0.5 GB and will kill the tab. Above the
  // limit, apply the change but drop history rather than pretend an undo step exists.
  const snapBytes = canvases.reduce((n, c) => n + c.width * c.height * 4, 0) * 2;
  // Raising the history budget raises what a single step may cost, but lowering it never tightens
  // this: 512 MB is a "do not kill the tab" guard, not a share of the history, and making it follow
  // a 128 MB budget downwards would refuse undo steps that work today.
  if (snapBytes > Math.max(512 * 1048576, App.undoBudget)) {
    mutate(); after();
    // An edit all the same, with no step of its own — so the steps around it are re-stamped: undoing
    // one now leaves this bake on the sheet, a state no earlier revision names (core/autosave.js).
    Autosave.changed();
    // Earlier entries stay valid (they own their own snapshots) — only this one is skipped.
    setStatus(desc + " applied — texture too large to keep an undo step for this one (" + Math.round(snapBytes / 1048576) + " MB)", "err");
    return;
  }
  const befores = canvases.map(snapCanvas);
  mutate();
  // The sheet's OWN revision. Anything derived from it — the flat channel view, ROADMAP 1.14 — can
  // then cache against the source that actually changed instead of against a global composite
  // counter that ticks on every brush frame. Every destructive write to a base sheet in the app
  // goes through this function or bakeRegionAction, so there is nowhere else to bump it from.
  for (const c of canvases) if (c) c._rev = (c._rev || 0) + 1;
  const afters = canvases.map(snapCanvas);
  const put = snaps => { canvases.forEach((c, i) => { const g = ctx2d(c); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, c.width, c.height); g.drawImage(snaps[i], 0, 0); }); after(); };
  pushAction(desc, () => put(befores), () => put(afters), snapBytes);
  after();
}
// Same idea, but only the rectangle that actually changes is copied. A decal's surface effect
// touches a few hundred pixels of an 8192² _n map — snapshotting the whole thing is what used
// to blow past the memory limit and silently throw the undo step (and the rest of the history)
// away, which is why "apply _n effect to a decal" could not be undone.
//
// `rect` may be a LIST of rectangles, which is what a crop needs (ROADMAP 4.10): the region a crop
// changes is everything OUTSIDE the selection, and that is four bands rather than one rectangle.
// Writing it as the whole sheet would snapshot the selection twice over for nothing — on an 8192²
// layer, half a gigabyte of pixels that did not move.
function bakeRegionAction(desc, canvases, rect, mutate, after){
  const rects = (Array.isArray(rect) ? rect : [rect])
    .map(r => ({ x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), w: Math.ceil(r.w), h: Math.ceil(r.h) }))
    .filter(r => r.w > 0 && r.h > 0);
  const grab = () => canvases.map(c => rects.map(r => {
    const w = Math.min(r.w, c.width - r.x), h = Math.min(r.h, c.height - r.y);
    return (w > 0 && h > 0) ? ctx2d(c).getImageData(r.x, r.y, w, h) : null;
  }));
  // The same "do not kill the tab" guard bakeAction has, and now needed here too: the region was a
  // decal's bounding box when this was written, but a crop's region is everything OUTSIDE the
  // selection — on an 8192² layer that is a before and an after of a quarter-gigabyte each.
  const cost = canvases.length * rects.reduce((n, r) => n + r.w * r.h, 0) * 4 * 2;
  if (cost > Math.max(512 * 1048576, App.undoBudget)) {
    mutate(); after();
    Autosave.changed();                      // no step of its own: see bakeAction
    setStatus(desc + " applied — too large to keep an undo step for this one (" + Math.round(cost / 1048576) + " MB)", "err");
    return;
  }
  const befores = grab();
  mutate();
  for (const c of canvases) if (c) c._rev = (c._rev || 0) + 1;   // see bakeAction — ROADMAP 1.14
  const afters = grab();
  const bytes = befores.reduce((n, per) => n + per.reduce((m, im) => m + (im ? im.data.length : 0), 0), 0) * 2;
  const put = snaps => {
    canvases.forEach((c, i) => rects.forEach((r, j) => { if (snaps[i][j]) ctx2d(c).putImageData(snaps[i][j], r.x, r.y); }));
    after();
  };
  pushAction(desc, () => put(befores), () => put(afters), bytes);
  after();
}

