"use strict";
// ---------- Autosave and crash recovery: the parts the user sees (ROADMAP 4.50(2)) ----------
// `Autosave` (core/autosave.js) keeps the copies. This decides when one is taken, and shows what
// there is to recover:
//   * the browser's own "leave the page?" question, whenever there is work in no file — until
//     2026-09-25 the only `beforeunload` handler saved preferences, and one Ctrl+W lost the day;
//   * a copy once unsaved work is EVERY_MS old, at the first quiet moment — no button held, no key
//     or click for IDLE_MS, nothing on the progress bar — so a copy never lands mid-stroke; and at
//     once when the tab is hidden: switched away from or minimised, which is also how a tab the
//     browser later discards or restarts for an update usually got there. NOT when the page closes.
//     A copy is PNG encodes and an IndexedDB transaction, and a page being unloaded never finishes
//     them. Measured 2026-09-26 with a `pagehide` listener in place, reloading after the browser's
//     question was answered: unsaved work with no copy yet left nothing in the store; after a tab
//     switch had taken a copy and one more layer was added, the page that came back offered that
//     copy — one layer, not the two on screen. So a close keeps the last copy taken BEFORE it, and
//     the question the browser asks is the real protection; there is no `pagehide` listener, because
//     it could only ever pretend;
//   * the offer on the welcome card — "Recover the session from 14:32", which vehicle, when, how big;
//   * the unsaved mark on Save proj and in the window title.
const Recovery = {
  IDLE_MS: 3000,
  lastInput: 0, held: false,
  offered: [],            // the sessions on the welcome card right now
  heldCard: false,        // the remembered-folder restore left the card up for an offer
  marked: null,           // what the unsaved mark last showed, so the DOM is touched on a change only
  unsaved(){ return Autosave.dirty() && App.slots.size > 0; },
  input(down){
    this.lastInput = performance.now();
    if (down) { this.held = true; Autosave.interrupt(); }
  },
  tick(){
    this.mark();
    if (!Autosave.due(Date.now())) return;
    if (this.held || Prog.active || performance.now() - this.lastInput < this.IDLE_MS) return;
    Autosave.write("idle");
  },
  // Hidden is not idle-gated: nobody is working in a hidden tab. A button still held means a stroke
  // may be half-drawn, and that is the one state not worth keeping.
  hidden(){
    if (!this.unsaved() || Autosave.rev === Autosave.copiedRev || this.held || Prog.active) return;
    Autosave.write("hidden");
  },
  mark(){
    const d = this.unsaved(), L = Autosave.last;
    const key = d + "|" + (L ? L.at : "");
    if (key === this.marked) return;
    this.marked = key;
    const b = $("btnSaveProj");
    b.classList.toggle("unsaved", d);
    b.title = "Save project (.wtproj) — reload it later via Add files" +
      (d ? ". There are changes that are in no file yet" : "") +
      (L ? " · a recovery copy was kept at " + this.clock(L.at) : "");
    document.title = (d ? "• " : "") + "WT Skin Studio";
  },
  // "14:32", "yesterday, 14:32" or "24 Sep, 14:32", in the browser's own clock format.
  clock(at){
    const d = new Date(at), now = new Date();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (at >= today) return hm;
    if (at >= today - 86400000) return "yesterday, " + hm;
    return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + hm;
  },
  size(n){
    if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + " KB";
    const m = n / 1048576;
    return (m < 10 ? m.toFixed(1) : Math.round(m)) + " MB";
  },
  // Which vehicle, when, how big — the three things the spec asked the offer to say.
  detail(o){
    const what = o.vehicle || o.unit || "An untitled project";
    return what + (o.skin ? " — skin “" + o.skin + "”" : "") + ". Kept " + this.clock(o.at) + ", " +
      this.size(o.total) + ": " + o.layers + " layer" + (o.layers === 1 ? "" : "s") + " on " + o.slots +
      " texture" + (o.slots === 1 ? "" : "s") + ". Not saved to a file since.";
  },

  // ---- the offer ----
  // At boot. Resolves once the card is drawn, so the remembered-folder restore (ui/welcome.js) can
  // leave the card up rather than take the offer away before it has been seen.
  async check(){
    let r;
    try { r = await Autosave.offers(); }
    catch (e) { reportFailure("Looking for a session to recover", e, "autosave"); return false; }
    if (r.foreign) setStatus("Recovery copies from a newer build of the app are kept in this browser — this build cannot read them, and will not overwrite them", "warn");
    this.offered = r.list;
    this.render();
    return this.offered.length > 0;
  },
  render(){
    const box = $("welcomeRecover");
    box.textContent = "";
    box.style.display = this.offered.length ? "" : "none";
    for (const o of this.offered) box.appendChild(this.row(o));
  },
  row(o){
    const wrap = document.createElement("div");
    wrap.className = "recover";
    const b = document.createElement("button");
    b.className = "big primary wopt";
    b.textContent = "Recover the session from " + this.clock(o.at);
    const sm = document.createElement("small");
    sm.textContent = this.detail(o);
    b.appendChild(sm);
    b.onclick = () => this.recover(o);
    const acts = document.createElement("div");
    acts.className = "recoverActs";
    const f = document.createElement("button");
    f.textContent = "Save it as a file…";
    f.title = "Download this copy as a .wtproj without opening it — the same file Save proj writes";
    f.onclick = () => this.saveAs(o);
    const d = document.createElement("button");
    d.textContent = "Discard";
    d.title = "Delete this session's recovery copies from the browser";
    d.onclick = () => this.discard(o);
    acts.append(f, d);
    wrap.append(b, acts);
    return wrap;
  },
  drop(o){
    this.offered = this.offered.filter(x => x.session !== o.session);
    this.render();
    if (!this.offered.length && this.heldCard) $("welcome").style.display = "none";
  },
  // The remembered install is reopening behind the card (ui/welcome.js), which stays up for the
  // offer. Its way into the game must not then ask for the folder again: "Open War Thunder folder"
  // opened a second picker and started a second scan over the one already running (review,
  // 2026-09-26), and "Start empty" said the folder could be opened any time. It goes to the list.
  holdCard(){
    this.heldCard = true;
    const b = $("btnWelcomeGame"), sm = b.querySelector("small");
    b.textContent = "Go to the vehicle list";
    sm.textContent = "Your War Thunder folder is reopening behind this card, as on every visit — no need to pick it again.";
    b.appendChild(sm);
    b.onclick = () => { $("welcome").style.display = "none"; };
    $("btnWelcomeClose").querySelector("small").textContent = "Begin blank, or drag in an .obj / .dds / .wtproj.";
  },
  // Newest copy first, and the older one if the newest cannot be read: that is what keeping two is for.
  async recover(o){
    if (App.geomData || App.slots.size) {
      const c = await choiceDialog("Recover the session from " + this.clock(o.at) + "? This replaces the current model, textures and edits.",
        [{ label: "Recover", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }]);
      if (c !== "ok") return;
      clearProject();
    }
    const why = [];
    for (const c of o.copies) {
      setStatus("Recovering the session from " + this.clock(c.at) + "…");
      try {
        await loadProject(ProjectFile.zip(await Autosave.read(c)), c);
      } catch (e) {
        why.push(this.clock(c.at) + ": " + errText(e));
        if (App.geomData || App.slots.size) clearProject();
        continue;
      }
      // The loader says in its own words when it refuses a file (a newer build's), and then the
      // session has not moved; an older copy of the same work would be refused the same way.
      if (Autosave.session !== o.session) return;
      this.drop(o);
      setStatus("Recovered the session from " + this.clock(c.at) + (why.length ? " (the newer copy could not be read — " + why[0] + ")" : "") +
        ". It is not in a file yet — Save proj (Ctrl+S) keeps it.", why.length ? "warn" : "ok");
      return;
    }
    setStatus("The session from " + this.clock(o.at) + " could not be recovered — " + why.join(" · "), "err");
  },
  async saveAs(o){
    try {
      setStatus("Packing the session from " + this.clock(o.at) + "…");
      const name = (o.skin || o.unit || "session") + "_recovered";
      const blob = await ProjectFile.download(ProjectFile.zip(await Autosave.read(o)), name);
      // It is in a file now, so a later visit need not offer it again; this one still does.
      await Autosave.markSaved(o.session);
      setStatus("The session from " + this.clock(o.at) + " is saved as " + name + ".wtproj (" + this.size(blob.size) +
        ") — open it with Add files, or recover it here", "ok");
    } catch (e) { reportFailure("Saving the session from " + this.clock(o.at) + " as a file", e, "autosave-file"); }
  },
  async discard(o){
    const c = await choiceDialog("Discard the session from " + this.clock(o.at) + "? Its recovery copies (" + this.size(o.total) +
      ") are deleted from this browser, and that cannot be undone.",
      [{ label: "Discard", value: "ok", primary: true }, { label: "Keep it", value: "cancel" }]);
    if (c !== "ok") return;
    try { await Autosave.discard(o.session); }
    catch (e) { reportFailure("Discarding the session from " + this.clock(o.at), e, "autosave"); return; }
    this.drop(o);
    setStatus("The session from " + this.clock(o.at) + " was discarded", "ok");
  },
};
// The browser asks its own question and shows its own words; setting them has not worked for years.
window.addEventListener("beforeunload", e => {
  if (!Recovery.unsaved()) return;
  e.preventDefault();
  e.returnValue = "unsaved";                 // what older Chromium needed on top of preventDefault
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") Recovery.hidden(); });
window.addEventListener("pointerdown", () => Recovery.input(true), true);
window.addEventListener("pointerup", () => { Recovery.held = false; }, true);
window.addEventListener("pointercancel", () => { Recovery.held = false; }, true);
window.addEventListener("keydown", () => Recovery.input(false), true);
window.addEventListener("wheel", () => Recovery.input(false), { capture: true, passive: true });
setInterval(() => Recovery.tick(), 1000);
