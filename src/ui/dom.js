const $ = id => document.getElementById(id);
// Every value interpolated into an innerHTML string goes through this. Most of them are texture
// stems, file names and unit ids read straight out of the game's own packs — they are data, not
// markup, and nothing upstream guarantees what characters they contain.
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const statusEl = $("status");
// `detail` is what a user MAY want and should not have to read: it goes into Messages under the line,
// and the line is marked as having more (ROADMAP 3.36).
function setStatus(msg, cls, detail){
  const text = String(msg) + (detail ? "\n" + detail : "");
  // An error the rest of its task must not bury is on the line (StatusLog.hold): an ordinary message
  // set after it goes into Messages as always, and the line keeps the error.
  if (StatusLog.held && cls !== "err") { StatusLog.note(text, cls || ""); return; }
  statusEl.textContent = msg; statusEl.className = cls || "";
  StatusLog.more = !!detail;
  StatusLog.note(text, cls || "");
}

// ---------- The status line's full text, and what it said before ----------
// The line is one row of the top bar, so it cuts what does not fit — and it cut a lot: it was capped
// at 420 px (about 70 characters) and `errText` cut an error at 160 before it got there. Reported
// 2026-09-24 as "Clone source set — paint where the copy should go. Alt-click again to move t…", and
// error messages that could not be read at all. The part that falls off the end is the part that
// says what to do, and a message that is replaced a second later is gone either way.
//
// So the line stays one line (a bar that grows with its message moves every button under the
// pointer) but it is never the only copy:
//   * it takes the top bar's free width rather than a fixed 420 px — most messages simply fit now;
//   * one that does not is marked (`data-clip`) and opens in full on hover;
//   * a click opens the recent messages, selectable and copyable — "what did it say a moment ago"
//     and "send me the error" both have an answer;
//   * an ERROR that does not fit opens by itself: nobody should need to know to hover to read why
//     something failed. It closes on the next click anywhere else, or Esc.
// The line's own text and class are untouched — the whole message is still `#status`'s text, which
// is where every test reads it. `tools/t87_status.mjs` holds all of the above.
//
// Since 2026-09-25 the line is a STATUS BAR along the bottom of the window, not the tail of the top
// bar (ROADMAP 3.36) — where Blender, VS Code, Photoshop and Krita all keep theirs, and where it
// stops competing with the buttons for width and attention. The log opens upward from it. A message
// may also carry a `detail` (setStatus's third argument) that only the log shows.
const StatusLog = {
  KEEP: 40,                  // rows kept; hints are dropped before errors when it is full
  entries: [],               // newest first: { msg, cls, t, n }
  el: null, mode: "",        // "" closed · "hover" · "pin" (clicked) · "auto" (an error opened it)
  queued: false, freshErr: false, hoverT: 0, leaveT: 0,
  more: false,               // the line's message has a detail only the log shows
  held: false, holdT: 0,     // see hold

  // Keep the line on the error just set until this task is over; an ordinary message set after it in
  // the same task goes into Messages only. It is for a notice raised from INSIDE an edit — a checkpoint
  // lost to the step just pushed (core/undo.js) — which the edit's own line, set straight after, used
  // to replace before it was ever painted: measured in review (2026-09-27) with a guide pulled out of
  // a ruler, the line read "Guide at x 40 …" and the lost checkpoint was only in Messages.
  hold(){
    this.held = true;
    clearTimeout(this.holdT);
    this.holdT = setTimeout(() => { this.held = false; }, 0);
  },

  note(msg, cls){
    const last = this.entries[0];
    if (last && last.msg === msg && last.cls === cls) { last.n++; last.t = Date.now(); }
    else { this.entries.unshift({ msg, cls, t: Date.now(), n: 1 }); this.trim(); }
    if (cls === "err") this.freshErr = true;
    this.queue();
  },
  // A flood of hints (a slider dragged, a key held) must not push out the error before them: the
  // error is the row somebody comes back for. Drop the oldest non-error first.
  trim(){
    while (this.entries.length > this.KEEP) {
      let i = this.entries.length - 1;
      while (i > 0 && this.entries[i].cls === "err") i--;
      this.entries.splice(i > 0 ? i : this.entries.length - 1, 1);
    }
  },
  // Whether the text fits is a layout question, so it is asked once per frame rather than per call —
  // a status set from a drag must not force a layout on every event.
  queue(){
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      const clip = statusEl.scrollWidth > statusEl.clientWidth + 1 || this.more;
      statusEl.toggleAttribute("data-clip", clip);
      if (this.freshErr && clip && statusEl.className === "err" && !this.mode) this.open("auto");
      this.freshErr = false;
      if (this.mode) this.render();
    });
  },

  panel(){
    if (this.el) return this.el;
    const p = document.createElement("div");
    p.id = "statusLog"; p.hidden = true; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Messages");
    const head = document.createElement("div"); head.className = "slog-head";
    const title = document.createElement("span"); title.className = "grow"; title.textContent = "Messages";
    const copy = document.createElement("button");
    copy.title = "Copy every message below, with its time";
    copy.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">' +
      '<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg> Copy';
    copy.onclick = () => this.copy(copy);
    const shut = document.createElement("button");
    shut.title = "Close (Esc)"; shut.setAttribute("aria-label", "Close");
    shut.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.6"><path d="M1 1l8 8M9 1L1 9"/></svg>';
    shut.onclick = () => this.close();
    head.append(title, copy, shut);
    const list = document.createElement("div"); list.className = "slog-list";
    p.append(head, list);
    p.addEventListener("pointerenter", () => clearTimeout(this.leaveT));
    p.addEventListener("pointerleave", () => { if (this.mode === "hover") this.leaveT = setTimeout(() => this.close(), 250); });
    p.addEventListener("pointerdown", () => { this.mode = "pin"; });    // reaching in to select or copy keeps it
    document.body.append(p);
    return (this.el = p);
  },
  render(){
    const list = this.panel().lastChild;
    list.replaceChildren(...this.entries.map(e => {
      const row = document.createElement("div"); row.className = "slog-row" + (e.cls ? " " + e.cls : "");
      const t = document.createElement("span"); t.className = "slog-t";
      t.textContent = new Date(e.t).toTimeString().slice(0, 8) + (e.n > 1 ? " ×" + e.n : "");
      const m = document.createElement("div"); m.className = "slog-msg"; m.textContent = e.msg;
      row.append(t, m);
      return row;
    }));
  },
  open(mode){
    const p = this.panel();
    this.mode = mode;
    this.render();
    p.hidden = false;
    // Above the line (it is the bottom bar), left edges together, kept on screen; `position:fixed`
    // so no panel scroll moves it.
    const r = statusEl.getBoundingClientRect();
    p.style.bottom = Math.max(8, Math.round(window.innerHeight - r.top + 4)) + "px";
    p.style.left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - p.offsetWidth - 8)) + "px";
    p.lastChild.scrollTop = 0;
    statusEl.setAttribute("aria-expanded", "true");
  },
  close(){
    clearTimeout(this.hoverT); clearTimeout(this.leaveT);
    if (!this.mode) return;
    this.mode = "";
    this.el.hidden = true;
    statusEl.setAttribute("aria-expanded", "false");
  },
  copy(btn){
    const text = this.entries.slice().reverse()
      .map(e => new Date(e.t).toTimeString().slice(0, 8) + (e.cls === "err" ? "  ERROR  " : "  ") + e.msg + (e.n > 1 ? "  (×" + e.n + ")" : ""))
      .join("\n");
    navigator.clipboard.writeText(text).then(
      () => { btn.lastChild.textContent = " Copied"; setTimeout(() => { btn.lastChild.textContent = " Copy"; }, 1200); },
      e => reportFailure("Copying the messages", e));
  },
};
statusEl.tabIndex = 0;
statusEl.setAttribute("role", "button");
statusEl.setAttribute("aria-haspopup", "dialog");
statusEl.setAttribute("aria-expanded", "false");
statusEl.addEventListener("click", () => { StatusLog.mode === "pin" ? StatusLog.close() : StatusLog.open("pin"); });
statusEl.addEventListener("keydown", e => {
  if (e.code !== "Enter" && e.code !== "NumpadEnter" && e.code !== "Space") return;
  e.preventDefault(); statusEl.click();
});
statusEl.addEventListener("pointerenter", () => {
  clearTimeout(StatusLog.leaveT);
  if (!statusEl.hasAttribute("data-clip") || StatusLog.mode) return;
  StatusLog.hoverT = setTimeout(() => StatusLog.open("hover"), 120);
});
statusEl.addEventListener("pointerleave", () => {
  clearTimeout(StatusLog.hoverT);
  if (StatusLog.mode === "hover") StatusLog.leaveT = setTimeout(() => StatusLog.close(), 250);
});
// Capture phase: a canvas handler that stops propagation must not keep the log open over the model.
document.addEventListener("pointerdown", e => {
  if (StatusLog.mode && !statusEl.contains(e.target) && !(StatusLog.el && StatusLog.el.contains(e.target))) StatusLog.close();
}, true);
document.addEventListener("keydown", e => { if (e.code === "Escape" && StatusLog.mode) StatusLog.close(); }, true);
window.addEventListener("resize", () => StatusLog.queue());

// ---------- Typing a slider's value ----------
// A slider is the wrong control for "exactly 64 px" or "the same 35 % as last time", and until
// 2026-09-25 only the two Rotate rows had a box to type in. Every other slider's number is now one:
// click it (or press Enter on the focused slider), type, Enter. Esc puts it back; a click away keeps
// what was typed.
//
// One delegated handler for the whole page, so a slider a panel builds later is covered the moment
// it exists — no panel has to opt in, and none can forget to. A readout belongs to the nearest
// range BEFORE it in its row. The value is typed in the units the readout shows: a slider whose
// readout is not its raw value declares the factor as `data-k` (projDepth stores 300 and shows
// "3.0×", so k = 0.01). The value goes in as an ordinary `input` then `change`, exactly what a drag
// ends with — so the readout, the preview and the one undo step all come from the slider's own
// handlers, and the browser clamps it to the slider's range and step. `tools/t88_typein.mjs` holds
// it, and fails if any slider's readout disagrees with its `data-k`.
(function sliderTyping(){
  const rangeBefore = v => {
    for (let e = v.previousElementSibling; e; e = e.previousElementSibling)
      if (e.tagName === "INPUT" && e.type === "range") return e;
    return null;
  };
  const readoutAfter = r => {
    for (let e = r.nextElementSibling; e; e = e.nextElementSibling) {
      if (e.tagName === "INPUT" && e.type === "range") return null;
      if (e.tagName === "SPAN" && e.classList.contains("val")) return e;
    }
    return null;
  };
  // "1,5" is how half the audience writes 1.5; a readout's "3.0×", "85%" or "−4" parses too.
  const num = s => {
    const m = String(s).replace(/−/g, "-").replace(",", ".").match(/-?(\d+\.?\d*|\.\d+)/);
    return m ? parseFloat(m[0]) : NaN;
  };
  const decimals = x => { const s = String(+x.toPrecision(6)); return s.includes(".") ? s.length - s.indexOf(".") - 1 : 0; };
  function open(v){
    const r = rangeBefore(v);
    // Already open (Enter on the slider while its box is up) would hide the readout for good.
    if (!r || r.disabled || v.hidden || v.style.display === "none") return false;
    const k = +(r.dataset.k || 1);
    const ed = document.createElement("input");
    ed.type = "text"; ed.inputMode = "decimal"; ed.className = "valedit"; ed.spellcheck = false;
    ed.setAttribute("aria-label", ((r.closest(".row") || r.parentElement).querySelector("label") || {}).textContent || "value");
    ed.value = String(+(+r.value * k).toFixed(decimals((+r.step || 1) * k)));
    ed.style.width = Math.max(52, v.offsetWidth + 18) + "px";
    const shownBefore = v.style.display;
    v.style.display = "none";
    v.after(ed);
    let done = false;
    const close = () => { done = true; ed.remove(); v.style.display = shownBefore; };
    const commit = () => {
      if (done) return;
      const t = num(ed.value);
      close();
      if (!isFinite(t)) return;
      const before = r.value;
      r.value = String(Math.round(t / k * 1e9) / 1e9);     // the browser clamps and snaps to step
      if (r.value === before) return;
      r.dispatchEvent(new Event("input", { bubbles: true }));
      r.dispatchEvent(new Event("change", { bubbles: true }));
    };
    ed.addEventListener("keydown", e => {
      if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); e.stopPropagation(); commit(); r.focus(); }
      else if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); close(); r.focus(); }
    });
    ed.addEventListener("blur", commit);
    ed.focus(); ed.select();
    return true;
  }
  document.addEventListener("click", e => {
    const v = e.target.closest && e.target.closest("span.val");
    if (v && open(v)) { e.preventDefault(); e.stopPropagation(); }
  });
  document.addEventListener("keydown", e => {
    const r = e.target;
    if ((e.code !== "Enter" && e.code !== "NumpadEnter") || r.tagName !== "INPUT" || r.type !== "range") return;
    const v = readoutAfter(r);
    if (v && open(v)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Said once, on the first hover, rather than written into fifty rows of markup.
  document.addEventListener("pointerover", e => {
    const v = e.target.closest && e.target.closest("span.val");
    if (v && !v.title && rangeBefore(v)) v.title = "Click to type a value";
  });
})();
