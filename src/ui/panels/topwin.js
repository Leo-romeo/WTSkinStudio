// ---- The top-bar windows: Export, View, Settings (ROADMAP 3.29) ----
// Each opens under its button as a window. The sections they hold are the right sidebar's own
// elements, MOVED at load — not copies, not new markup — so every id, every handler, every PREFS
// row and every test that reaches for `$("expMode")` finds exactly what it always did. What moved
// out of the sidebar is what is not painted with: Skin & export, View & scene, Moving parts and
// Settings. What stays is what is edited — Brush, Selection, Projected image, Decal, Surface tools.
//
// Decisions taken 2026-09-20:
//   (a) The Export window is NON-MODAL, undimmed, and stays open while painting. Two of its
//       settings — camo under skin and alpha — are previewed by the 3-D view itself (the item says
//       so), which a modal's backdrop would cover; and "tweak, look, export" should not need the
//       window reopened each round. Reversal: a backdrop element and one class.
//   (b) The View panel FLOATED by default and could be docked back into the sidebar with the button
//       in its header; the choice was a layout pref (`ui.viewDock`), so Reset layout restored it.
//       Floating is what was asked for ("move to the top"); docking is the option the item named.
//       SUPERSEDED 2026-09-25: dock View and scene settings by default for now and hide
//       the float button, since floating is buggy and not needed yet; fixing it can wait. So View & scene and Moving parts are DOCKED at load, the float button is built but
//       hidden, and the `ui.viewDock` pref row is gone until floating is fixed (ROADMAP 3.37) — a
//       stored `false` would otherwise float it with no way back. `dock(false)` still works; the
//       View button scrolls the sidebar to the section. Reversal: `FLOAT_OFF`, and the row.
// One window at a time: a second one over the first is clutter, and Escape closes whichever is up.
const TopWin = {
  open: null,                       // id of the open window, or null
  docked: false,                    // View & scene + Moving parts live in the sidebar, not the window
  FLOAT_OFF: true,                  // floating View & scene is parked (decision (b)): docked, no button
  // window id → the sections it holds, in order; the host inside the window they go into
  HOLDS: { winExport: { host: "winExportSettings", secs: ["secExport"] },
           winView:   { host: "winView",           secs: ["secView", "posePanel"] },
           winSettings: { host: "winSettings",     secs: ["secSettings"] },
           // Its section is in the window's own markup already, so the move is a no-op; it is listed
           // so the button, the ✕ and Escape work the way they do for the other three (4.50 (15)).
           winHistory: { host: "winHistory",       secs: ["secHistory"] } },

  init(){
    for (const [win, h] of Object.entries(this.HOLDS)) {
      const host = $(h.host);
      for (const id of h.secs) { const s = $(id); if (s && host) host.appendChild(s); }
      $($(win).dataset.for).onclick = () => this.toggle(win);
    }
    this.closeButton("secExport", "winExport");
    this.closeButton("secView", "winView");
    this.closeButton("secSettings", "winSettings");
    this.closeButton("secHistory", "winHistory");
    this.dockButton();
    if (this.FLOAT_OFF) this.dock(true);
    this.foot();
    // Not while the Controls & guide screen covers the window. The guide takes Escape itself when it
    // is on top (ui/keys.js); when a dialog or Messages is drawn over it, it steps aside WITHOUT
    // stopping the key — that thing needs it — and this listener then closed the window hidden under
    // the guide too: one Escape, two closed, the guide left up over nothing (real key events,
    // tools/t50_controls.mjs, 2026-10-10 review). The window's turn comes after the guide's.
    document.addEventListener("keydown", e => {
      if (e.code !== "Escape" || !this.open || document.querySelector(".modal")) return;
      if ($("helpOverlay").style.display !== "none") return;
      this.close();
    });
    window.addEventListener("resize", () => { if (this.open) this.place(this.open); });
  },
  // A ✕ in the section's own header — the header is the window's title bar, so it needs no second one.
  closeButton(sec, win){
    const h3 = $(sec) && $(sec).querySelector("h3");
    if (!h3) return;
    let mini = h3.querySelector(".mini");
    if (!mini) { mini = document.createElement("span"); mini.className = "mini"; h3.appendChild(mini); }
    const x = document.createElement("button");
    x.className = "twx"; x.textContent = "✕"; x.title = "Close (Esc)";
    x.onclick = e => { e.stopPropagation(); this.close(); };
    mini.appendChild(x);
  },
  // dock ⇄ float, in the View header. Docked, the top-bar button scrolls the section into view.
  dockButton(){
    const h3 = $("secView") && $("secView").querySelector("h3");
    if (!h3) return;
    const b = document.createElement("button");
    b.id = "btnViewDock"; b.className = "twx";
    if (this.FLOAT_OFF) b.style.display = "none";
    b.onclick = e => { e.stopPropagation(); this.dock(!this.docked); savePrefs(); };
    h3.querySelector(".mini").insertBefore(b, h3.querySelector(".twx"));
    this.dockLabel();
  },
  dockLabel(){
    const b = $("btnViewDock");
    if (!b) return;
    b.textContent = this.docked ? "float" : "dock";
    b.title = this.docked ? "Take View & scene out of the sidebar, into a window under the View button"
                          : "Put View & scene back into the right sidebar, always in sight";
    const x = $("secView").querySelector("h3 .twx:not(#btnViewDock)");
    if (x) x.style.display = this.docked ? "none" : "";
  },
  dock(on){
    on = !!on;
    // Docked means into the right column's scrolling pane, not the column itself: since ROADMAP 3.6 the
    // column never scrolls, so a section appended to it would sit below the pane, out of its scroll.
    if (on === this.docked && ($("secView").parentElement === (on ? $("rightPane") : $("winView")))) return;
    this.docked = on;
    const host = on ? $("rightPane") : $("winView");
    for (const id of this.HOLDS.winView.secs) { const s = $(id); if (s) host.appendChild(s); }
    if (on && this.open === "winView") this.close();
    this.dockLabel();
  },
  // The three ways out, at the foot of the Export window — the "Export as…" popover they used to
  // be, now under the settings they act on.
  foot(){
    const f = $("winExportFoot");
    if (!f) return;
    const mk = (label, title, fn, primary) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title; b.onclick = fn;
      if (primary) b.className = "primary";
      f.appendChild(b);
      return b;
    };
    mk("To War Thunder", "Writes the skin folder into your game's UserSkins — auto-detected when the game folder is open, otherwise you pick it. Where the browser cannot write there (an install under Program Files), it offers the .zip instead", () => doExport(true), true).id = "btnExportGame";
    mk("Download .zip", "A zip you unzip into UserSkins yourself", () => doExport(false)).id = "btnExportZip";
    mk("Save project", "Editable project (.wtproj) — model, textures and layers embedded", () => saveProject()).id = "btnExportProj";
  },
  toggle(id){ if (this.open === id) this.close(); else this.show(id); },
  show(id){
    if (id === "winView" && this.docked) {                       // docked: there is no window, point at the section
      $("secView").scrollIntoView({ behavior: "smooth", block: "start" });
      $("secView").classList.remove("collapsed");
      return;
    }
    if (this.open && this.open !== id) this.close();
    const w = $(id);
    w.style.display = "";
    this.open = id;
    $(w.dataset.for).classList.add("active");
    if (id === "winExport") ExportPreview.show(true);   // before place(): the column is part of the width
    this.place(id);
    requestAnimationFrame(() => { if (this.open === id) this.place(id); });   // once more after layout: a scrollbar widens it
    if (id === "winExport") ExportPreview.refresh();
    if (id === "winHistory") HistoryUI.render();        // it is only kept current while it is open
  },
  close(){
    if (!this.open) return;
    const w = $(this.open);
    w.style.display = "none";
    $(w.dataset.for).classList.remove("active");
    if (this.open === "winExport") ExportPreview.show(false);
    if (this.open === "winHistory") HistoryUI.forget();   // its rows hold their steps (ui/panels/history.js)
    this.open = null;
  },
  // Under the button, left-aligned to it, clamped to the page; as tall as the page allows.
  place(id){
    const w = $(id), b = $(w.dataset.for);
    const r = b.getBoundingClientRect();
    const top = Math.round(r.bottom + 4);
    w.style.top = top + "px";
    w.style.maxHeight = "calc(100vh - " + (top + 8) + "px)";
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w.offsetWidth - 12));
    w.style.left = Math.round(left) + "px";
  },
};
// One top-level call, and a load-order decision (CLAUDE.md §2): everything init touches — the
// sections, the buttons, the id lookup — is above this script, and loadPrefs (main.js) runs after
// it, which is what lets a stored `ui.viewDock` find the sections already in place to move.
TopWin.init();
