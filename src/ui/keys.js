const flyKeys = new Set();
// ---------- Held-key tracking + the "what does this key do" bubble ----------
const heldKeys = new Set();
function keyHeld(code){ return heldKeys.has(code); }
// Holding a modifier for a moment explains what it will do, so the shortcuts are
// discoverable without opening the keymap.
const KEY_HINTS = {
  ShiftLeft: "<span class='k'>Shift</span> + click = straight line · + drag decal keys = 10× step · + fly = faster",
  ShiftRight: "<span class='k'>Shift</span> + click = straight line · + drag decal keys = 10× step · + fly = faster",
  ControlLeft: "<span class='k'>Ctrl</span> + click a part = select / deselect it · + wheel = widen / narrow the selection a level at a time · + <span class='k'>Alt</span> = every part of the same shape · + <span class='k'>H</span> = solo",
  ControlRight: "<span class='k'>Ctrl</span> + click a part = select / deselect it · + wheel = widen / narrow the selection a level at a time · + <span class='k'>Alt</span> = every part of the same shape · + <span class='k'>H</span> = solo",
  AltLeft: "<span class='k'>Alt</span> + click = pick the colour under the cursor · with the mask brush = reveal instead of hide · + wheel = brush size",
  AltRight: "<span class='k'>Alt</span> + click = pick the colour under the cursor · with the mask brush = reveal instead of hide · + wheel = brush size",
  KeyS: "<span class='k'>S</span> + click a part = switch to that part's texture slot",
  KeyX: "<span class='k'>X</span> + click a part = protect it from painting (click again to unprotect)",
  Backquote: "Hold <span class='k'>`</span> to compare against the original texture",
};
let keyHintTimer = null;
function showKeyHint(code){
  const html = KEY_HINTS[code];
  if (!html) return;
  clearTimeout(keyHintTimer);
  keyHintTimer = setTimeout(() => { $("keyHint").innerHTML = html; $("keyHint").style.display = "block"; }, 420);
}
function hideKeyHint(){ clearTimeout(keyHintTimer); $("keyHint").style.display = "none"; }
window.addEventListener("keydown", e => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range") return;
  // A dialog owns the keyboard while it is up. A click on one of its buttons or a drag of one of its
  // sliders leaves the focus outside any text box, and every key typed next used to reach the page
  // UNDER the dialog: F flew, B and M switched tools, and Delete deleted the active layer — in a
  // re-edit, the very decal the dialog was editing, which "Use" then reported as re-drawn (4.50 (3)'s
  // review, 2026-09-26, measured with real key events). The dialog's own keys (Escape) are its
  // capture-phase listener's and never get here. Ctrl+S still saves: keeping the work is never wrong
  // under a dialog, and the browser's own Ctrl+S — a "save this page" — would otherwise answer it.
  if ($("modalHost").querySelector(".modal")) {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); saveProject(); }
    return;
  }
  // a focused slider owns the arrow keys — don't also nudge the decal with them
  if (e.target && e.target.type === "range" && /^(Arrow|Home|End|Page)/.test(e.code)) return;
  if (!e.repeat) { heldKeys.add(e.code); showKeyHint(e.code); }
  // Through the top bar's own button, so the key and the click open the guide under the same rule.
  if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { e.preventDefault(); $("btnHelp").click(); return; }
  // physical key codes — layout independent (works on non-Latin keyboards)
  if (cam.fly && ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(e.code)) { flyKeys.add(e.code); e.preventDefault(); return; }
  if (e.code === "Space") v2.space = true;
  if (e.code === "KeyB" && !e.ctrlKey && !e.metaKey) setPaint3d(!App.paint3d);
  if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) setFly(!cam.fly);
  // G armed the Moving mode until 2026-10-17; a decal is dragged directly now, so G is free again.
  // T for text, as in every image editor; `KeyT` was free (4.50 (3)). Through the Layers panel's own
  // button, so the key and the click cannot come to do different things. The click opens the dialog
  // and puts the cursor in its text box before this handler returns, so the key's own character
  // would land there next: without preventDefault every text begun with T began "t".
  if (e.code === "KeyT" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); $("btnAddText").click(); }
  // Mark this instant in a session recording. Deliberately a key nothing else uses and one you can
  // hit without looking, because it is pressed WHILE something feels wrong — see core/recorder.js.
  if (e.code === "F9") { e.preventDefault(); recMark(); }
  // Getting OUT of a placing mode should not need the mouse to travel to the button it came from.
  if (e.code === "Escape" && App.placing) { e.preventDefault(); setPlacing(false); }
  // ---- the marquee (ROADMAP 4.10) ----
  // M for the tool, Ctrl+A for the whole sheet — taken from the browser deliberately, because on a
  // canvas app "select all" means the sheet and a page-wide text selection over the chrome is never
  // what was wanted. Deselect is Esc and ONLY Esc: Ctrl+D is already "duplicate layer" here, and a
  // shortcut that means one thing with a layer selected and another without it is worse than none.
  if (e.code === "ControlLeft" || e.code === "ControlRight") ctrlHeld(true);
  if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.repeat) SelectUI.setOn(!SelectUI.on);
  if (e.code === "KeyK" && !e.ctrlKey && !e.metaKey && !e.repeat) SelectUI.setIslandMode(!SelectUI.island);
  // L and W are the lasso and the wand in every editor a skinner comes from (ROADMAP 4.50 (9)). W is
  // also fly mode's forward — the fly branch above returns first, so while flying it stays forward.
  if (e.code === "KeyL" && !e.ctrlKey && !e.metaKey && !e.repeat) SelectUI.toggleKind("lasso");
  if (e.code === "KeyW" && !e.ctrlKey && !e.metaKey && !e.repeat) SelectUI.toggleKind("wand");
  // A lasso being drawn owns Enter (close), Esc (drop it — not the selection under it) and Backspace
  // (take back a corner), and answers them before anything else that listens for the same keys.
  if (SelectUI.lasso && !/input|textarea/i.test((e.target && e.target.tagName) || "")) {
    const done = e.code === "Enter" || e.code === "NumpadEnter" ? (SelectUI.closeLasso(), true)
      : e.code === "Escape" ? SelectUI.cancelLasso()
      : e.code === "Backspace" ? SelectUI.dropLassoCorner() : false;
    if (done) { e.preventDefault(); return; }
  }
  // V draws the UV island outlines over the sheet — the shells K selects, made visible. Suggested
  // 2026-09-01 (V as the key for interacting with the UV map): picking an
  // island is a click on a shape you cannot see until the outlines are up, and that button was the
  // one control in this workflow with no key of its own.
  if (e.code === "KeyV" && !e.ctrlKey && !e.metaKey && !e.repeat) $("btnUv").click();
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") { e.preventDefault(); if (!SelectUI.on) SelectUI.setOn(true); Marquee.act("select all", () => Marquee.all()); }
  // ---- the 2-D view's grid and guides (ROADMAP 4.50 (15)) ----
  // Photoshop's two keys, by position: Ctrl+' the grid, Ctrl+; the guides. Its third, Ctrl+R for the
  // rulers, is the browser's reload, so the rulers come and go with the guides instead of alone.
  if ((e.ctrlKey || e.metaKey) && e.code === "Quote" && !e.repeat) { e.preventDefault(); GuidesUI.setGrid(!GuidesUI.grid); }
  if ((e.ctrlKey || e.metaKey) && e.code === "Semicolon" && !e.repeat) { e.preventDefault(); GuidesUI.setOn(!GuidesUI.on); }
  // ---- the shape tool (ROADMAP 6.1) ----
  // Esc throws the path away and is checked BEFORE the marquee's Esc, so one key does not mean two
  // things at once; Backspace drops the last point, which is the other half of drawing one.
  if (e.code === "Escape" && PathUI.on && PathUI.path && PathUI.path.pts.length) {
    e.preventDefault(); PathUI.clear(); setStatus("Path cleared", "ok"); return;
  }
  if (e.code === "Backspace" && PathUI.on && PathUI.path && PathUI.path.pts.length && !/input|textarea/i.test((e.target && e.target.tagName) || "")) {
    e.preventDefault();
    PathUI.pop();
    return;
  }
  if (e.code === "Escape" && !App.placing && Marquee.rect()) { e.preventDefault(); Marquee.act("clear selection", () => { Marquee.none(); setStatus("Selection cleared", "ok"); }); }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); doRedo(); }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); saveProject(); }
  // ---- part-selection shortcuts ----
  // Ctrl held, then Alt: take every part shaped exactly like the last one clicked.
  if ((e.ctrlKey || e.metaKey) && (e.code === "AltLeft" || e.code === "AltRight") && !e.repeat && App.meshes.size) {
    e.preventDefault(); selectSameShape(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyH") {
    e.preventDefault();
    if (App.selParts.size) soloParts([...App.selParts]);
    else if (App.soloKey) { unsoloParts(); refreshPartList(); needsRender(); setStatus("Solo off — everything visible again", "ok"); }
    else setStatus("Select some parts first — Ctrl+H then shows only those", "err");
    return;
  }
  if (e.code === "Backquote") setCompare(true);
  // Decal move/rotate (only when a decal layer is active) — Shift = larger step / 90° snap.
  const dl = activeLayerObj();
  // Shift = coarse, Alt = fine. Minus/Equal resize, matching the [ ] the brush already uses.
  const placeKey = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Comma","Period","Minus","Equal"].includes(e.code);
  const stepMod = e.shiftKey ? "big" : e.altKey ? "fine" : null;
  if (dl && dl.proj && placeKey) {           // projected decals nudge in the projector's own axes
    e.preventDefault();
    const P = dl.proj;
    if (e.code === "ArrowLeft") nudgeProj(P, -1, 0, stepMod);
    else if (e.code === "ArrowRight") nudgeProj(P, 1, 0, stepMod);
    else if (e.code === "ArrowUp") nudgeProj(P, 0, -1, stepMod);
    else if (e.code === "ArrowDown") nudgeProj(P, 0, 1, stepMod);
    else if (e.code === "Comma") rotateProj(P, -5, stepMod);
    else if (e.code === "Period") rotateProj(P, 5, stepMod);
    else if (e.code === "Minus") scaleProj(P, -1, stepMod);
    else if (e.code === "Equal") scaleProj(P, 1, stepMod);
    return;
  }
  if (dl && dl.type === "decal" && placeKey) {
    e.preventDefault();
    const s = App.activeSlot;
    const px = projStepMul(stepMod) * 2 / (s ? s.composite.width : 1024);
    if (e.code === "ArrowLeft") nudgeDecal(-px, 0);
    else if (e.code === "ArrowRight") nudgeDecal(px, 0);
    else if (e.code === "ArrowUp") nudgeDecal(0, -px);
    else if (e.code === "ArrowDown") nudgeDecal(0, px);
    else if (e.code === "Comma") rotateDecal(-5, stepMod);
    else if (e.code === "Period") rotateDecal(5, stepMod);
    else if (e.code === "Minus") scaleDecal(-1, stepMod);
    else if (e.code === "Equal") scaleDecal(1, stepMod);
    return;
  }
  if (e.code === "BracketLeft") adjustBrushSize(-6);
  if (e.code === "BracketRight") adjustBrushSize(6);
  // layer stack shortcuts
  if (dl && (e.ctrlKey || e.metaKey) && e.code === "KeyD") { e.preventDefault(); duplicateLayer(App.activeSlot, dl); }
  if (dl && e.code === "Delete" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    dl.proj ? deleteProjGroup(dl.proj) : deleteLayerAt(App.activeSlot, dl);
  }
});
window.addEventListener("keyup", e => {
  flyKeys.delete(e.code);
  heldKeys.delete(e.code);
  hideKeyHint();
  if (e.code === "Space") v2.space = false;
  if (e.code === "ControlLeft" || e.code === "ControlRight") ctrlHeld(e.ctrlKey);
  if (e.code === "Backquote") setCompare(false);
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Comma","Period","Minus","Equal"].includes(e.code)) { commitDecalEdit(); commitProjEdit(); }
});
// losing focus mid-hold must not leave Space-pan or Compare stuck on
window.addEventListener("blur", () => { flyKeys.clear(); heldKeys.clear(); hideKeyHint(); v2.space = false; setCompare(false); ctrlHeld(false); });
// Hold to see the slot AS IT WAS IMPORTED. Every map, not just the albedo: this used to swap
// `s.tex` alone, so the "original" it showed still carried every normal, smoothness and metalness
// edit that had been made, and in a flat channel view it did nothing whatever. ROADMAP 3.17.
//
// Each swap is an image pointer plus `needsUpdate` — no repack, no readback, no second copy of
// anything. The surface textures point straight at the sheets, so "the original" is simply
// `chanBase` where the live view is `chanOut`; when a channel has no layers the two are the same
// canvas and the swap is a no-op, which is correct. (This used to need a snapshot of a repacked
// pair — 67 MB a slot at 4096² — and that went away with the repack itself.)
function setCompare(on){
  if (App.compare === !!on) return;
  App.compare = !!on;
  const swap = (tex, orig, live) => {
    if (!tex || !orig || !live) return;
    tex.image = on ? orig : live;
    tex.needsUpdate = true;
  };
  for (const s of App.slots.values()) {
    swap(s.tex, s.baseC, s.composite);
    if (s.texCh) for (const ch of SURF_CHANS) swap(s.texCh[ch], chanBase(s, ch), chanOut(s, ch));
    // The coverage sheet is the albedo's alpha — the paint mask. Its "original" is the imported
    // coverage, which is what chanBase hands back for the wear channel.
    if (s.texCov && chanHasLayers(s, "wear")) swap(s.texCov, chanBase(s, "wear"), (s.chanC && s.chanC.wear) || null);
    // A flat channel view is built on the CPU from chanOut / chanBase, so it is rebuilt rather
    // than swapped; chanViewCanvas keys its cache on App.compare so this costs one rebuild a press.
    if (App.chanView && App.chanView !== "shaded") refreshChannelTextures(s);
  }
  $("btnCompare").classList.toggle("active", !!on);
  needsRender();
  draw2D();
}
$("btnCompare").addEventListener("pointerdown", () => setCompare(true));
$("btnCompare").addEventListener("pointerup", () => setCompare(false));
$("btnCompare").addEventListener("pointerleave", () => setCompare(false));
function pushPalette(col){
  const p = App.palette = App.palette || [];
  const i = p.indexOf(col);
  if (i === 0) return;
  if (i > 0) p.splice(i, 1);
  p.unshift(col);
  if (p.length > 10) p.pop();
  renderPalette();
}
function renderPalette(){
  const el = $("palette");
  el.innerHTML = "";
  for (const c of App.palette || []) {
    const b = document.createElement("div");
    b.title = c;
    b.style.cssText = "width:18px;height:18px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:" + c;
    b.onclick = () => { App.brush.color = c; $("brushColor").value = c; brushStamp._key = null; };
    el.appendChild(b);
  }
}
document.querySelectorAll("[data-vm]").forEach(b => b.onclick = () => Layout.setViewMode(b.dataset.vm));
$("btnSides").onclick = () => {
  const hide = $("leftbar").style.display !== "none";
  $("leftbar").style.display = hide ? "none" : "";
  $("rightbar").style.display = hide ? "none" : "";
  // `[data-side]` and not every `.resizer`: the 3D/2D divider is one too, and it belongs to the
  // views, not to the sidebars. Hiding it here would take the split bar away with the panels.
  document.querySelectorAll(".resizer[data-side]").forEach(r => r.style.display = hide ? "none" : "");
  resizeViews();
};
// ---- The bits of layout the user drags, and the app used to forget ----
// ROADMAP 3.11(c). Both sidebar widths and the share between the Vehicle tab's two lists are
// remembered, and they go through the settings table (3.12) rather than keys of their own — so they
// reset, export and import with everything else, and their defaults are captured off the page at
// boot like every other row. That is why 230 / 250 / 3:2 are written down nowhere but the stylesheet.
//
// The widths are TRACKED here rather than read off `offsetWidth` when the save timer asks, because
// `Hide sidebars` sets `display:none` and a hidden element measures **0 px** (measured 2026-08-26).
// The four-second save would have stored a sidebar 0 px wide, and the next launch would have opened
// with one — with the resizer that fixes it 0 px away.
const Layout = {
  w: { left: 0, right: 0 },
  listR: 0,
  bar: side => side === "left" ? $("leftbar") : $("rightbar"),
  width(side){
    const live = parseFloat(Layout.bar(side).style.width) || Layout.bar(side).offsetWidth;
    if (live > 0) Layout.w[side] = Math.round(live);
    return Layout.w[side];
  },
  setWidth(side, w){
    if (!(+w > 0)) return;                       // a bar of no width, from a corrupt or empty value
    w = Math.max(160, Math.min(600, Math.round(+w)));
    Layout.w[side] = w;
    Layout.bar(side).style.width = w + "px";
    resizeViews();
  },
  // The Vehicle tab's two result lists share the height the tab has left (ROADMAP 3.6), and the bar
  // between them moves the share. It replaces the vehicle list's dragged pixel height (3.11(c)),
  // which described a fixed box that no longer exists. A RATIO, for the reason the 3D | 2D split is
  // one: the column it divides changes size with the window, so a height would mean a different
  // split on the next launch. Written as each pane's `--grow`, which only the flexing rule reads — so
  // a pane that is a one-line hint (`.empty`) still drops out of the share, as an inline flex-grow
  // would not let it.
  pane: id => $(id === "b" ? "userSkinWrap" : "gameListWrap"),
  listSplit(){
    // Read off the stylesheet ONCE, like the view split: the default lives there and nowhere else.
    if (!Layout.listR) {
      const g = id => parseFloat(getComputedStyle(Layout.pane(id)).getPropertyValue("--grow")) || 0;
      const a = g("a"), b = g("b");
      Layout.listR = a + b > 0 ? Math.round(a / (a + b) * 1000) / 1000 : .6;
    }
    return Layout.listR;
  },
  setListSplit(r){
    r = +r;
    if (!(r > 0 && r < 1)) return;                 // a corrupt or empty stored value
    Layout.listR = Math.max(.15, Math.min(.85, Math.round(r * 1000) / 1000));   // neither list draggable to nothing
    // Times ten, so neither factor is ever below one. The trap `applyGrow` above records, met again:
    // when the flex factors still flexing sum to less than one, flexbox hands out only that fraction
    // of the free space (Flexbox §9.7). Here the skins list stops flexing whenever it reaches its own
    // rows, and is gone when its section is folded — and measured 2026-09-26 at 1904 x 929, a vehicle
    // list left flexing alone on 0.6 took 60 % of what the skins list gave back and left the rest as
    // empty column: folding "Existing skin" grew it by 67 px of the 159 the skins list had held.
    Layout.pane("a").style.setProperty("--grow", Math.round(Layout.listR * 10000) / 1000);
    Layout.pane("b").style.setProperty("--grow", Math.round((1 - Layout.listR) * 10000) / 1000);
  },
  // The part of a pane's height the share decides: its padding and border are the pane's own at any
  // share, because its flex basis is zero and a box cannot be smaller than its padding and border.
  // A drag that ignored them moved the boundary 55 px for a 60 px drag (measured, same window).
  shareOf(el){
    const cs = getComputedStyle(el), px = k => parseFloat(cs[k]) || 0;
    return el.getBoundingClientRect().height - px("paddingTop") - px("paddingBottom") - px("borderTopWidth") - px("borderBottomWidth");
  },
  // The part of that height the bar does NOT divide: the pane's flex basis, less the same padding and
  // border (the page is border-box). Zero, except on a short page, where each list starts from its
  // floor (the stylesheet's "A SHORT PAGE") — and a drag that ignored it would move the boundary by
  // about a sixth of the cursor at 1366 x 768, where 50 px of the 304 the two lists hold is shared.
  baseOf(el){
    const cs = getComputedStyle(el), px = k => parseFloat(cs[k]) || 0;
    const b = px("flexBasis");
    return b ? Math.max(0, b - px("paddingTop") - px("paddingBottom") - px("borderTopWidth") - px("borderBottomWidth")) : 0;
  },
  resetListSplit(){
    const r = PREFS.find(x => x.id === "ui.listSplit");
    if (r && r.def) Layout.setListSplit(r.def);
  },
  // The bar only means something while both lists are lists and both sections are open — a hint or
  // a folded section has no share to give. The CSS that shows it as draggable asks the same question.
  listSplitLive(){
    const a = Layout.pane("a"), b = Layout.pane("b");
    return !!(a.offsetParent && b.offsetParent && !a.classList.contains("empty") && !b.classList.contains("empty"));
  },
  // A double-click on a resizer is the per-control reset 3.12 asks for, so it reads the captured
  // default rather than a number written here as well as in the stylesheet.
  reset(side){
    const r = PREFS.find(x => x.id === "ui." + side + "W");
    if (r && r.def) Layout.setWidth(side, r.def);
  },
  // Which of the two view panes are up. The single writer, so `applyGrow` below can never disagree
  // with what is on screen.
  vm: "split",
  setViewMode(m){
    Layout.vm = m;
    document.querySelectorAll("[data-vm]").forEach(x => x.classList.toggle("active", x.dataset.vm === m));
    $("view3dwrap").style.display = m === "2d" ? "none" : "";
    $("view2dwrap").style.display = m === "3d" ? "none" : "";
    $("viewSep").style.display = m === "split" ? "" : "none";   // nothing to divide with one pane up
    Layout.applyGrow();
    resizeViews(true);
  },
  // The 3D | 2D divider, which was a 1 px border with nothing behind it until now — it looks like
  // the sidebar bars, so it was reported as one that had stopped working.
  //
  // A RATIO and not a pixel width, because this pane is the one that changes size on its own: it
  // takes whatever the window leaves after both sidebars, so a stored width would mean a different
  // split at the next launch, on a different window, or after one sidebar drag.
  //
  // The ratio is held HERE and the two flex-grow values are written from it, which is the opposite
  // of how this started — they used to BE the storage, read back with getComputedStyle. That was
  // wrong for a reason CSS states outright: when the flex-grow factors of a line sum to less than
  // one, flexbox hands out only that fraction of the free space (Flexbox §9.7). `r` and `1 - r`
  // sum to exactly 1, so a split pane row is fine — but hide one pane and the survivor is holding
  // `r` on its own. Measured 2026-09-02 on a 272 px `#views`, split dragged to 0.6: "3D" left the
  // 3-D pane 163 px wide with 109 px of `#views` background beside it, which is the report "it does
  // not switch completely and the screen stays split". A solo pane therefore gets grow 1, and
  // because that no longer describes the split, the computed value stops being the storage.
  ratio: 0,
  applyGrow(){
    const solo = Layout.vm !== "split", r = Layout.split();
    $("view3dwrap").style.flexGrow = solo ? 1 : r;
    $("view2dwrap").style.flexGrow = solo ? 1 : 1 - r;
  },
  split(){
    // Read off the stylesheet ONCE, so the default still lives there with the sidebar widths and is
    // not written down here as well. Boot is `split`, so both panes are up and the computed grows
    // are still the honest answer at the moment this runs.
    if (!Layout.ratio) {
      const grow = id => parseFloat(getComputedStyle($(id)).flexGrow) || 0;
      const a = grow("view3dwrap"), b = grow("view2dwrap");
      Layout.ratio = a + b > 0 ? Math.round(a / (a + b) * 1000) / 1000 : .5;
    }
    return Layout.ratio;
  },
  setSplit(r){
    r = +r;
    if (!(r > 0 && r < 1)) return;                 // a corrupt or empty stored value
    Layout.ratio = Math.max(.12, Math.min(.88, Math.round(r * 1000) / 1000));   // neither pane draggable to nothing
    Layout.applyGrow();
    resizeViews();
  },
  resetSplit(){
    const r = PREFS.find(x => x.id === "ui.viewSplit");
    if (r && r.def) Layout.setSplit(r.def);
  },
  // The pointer half of a drag bar, shared by the sidebars, the view divider and the bar between the
  // two lists because they differ only in what a delta means — and, for that last one, in which way
  // it runs (`axis`). `begin` is read once at pointerdown — a resizer that re-measured on every move
  // would feed its own result back in and accelerate — and a `begin` that answers null means the bar
  // has nothing to divide just now.
  drag(rz, begin, onDrag, onReset, axis){
    const at = e => axis === "y" ? e.clientY : e.clientX;
    rz.addEventListener("pointerdown", e => {
      const ctx = begin();
      if (ctx == null) return;
      e.preventDefault(); rz.setPointerCapture(e.pointerId); rz.classList.add("active");
      const start = at(e);
      const move = ev => onDrag(ctx, at(ev) - start);
      const up = () => { rz.classList.remove("active"); rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); };
      rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up);
    });
    rz.addEventListener("dblclick", onReset);
  },
};
// Draggable sidebar resizers (double-click puts the bar back to the width this build ships).
document.querySelectorAll(".resizer[data-side]").forEach(rz => {
  const side = rz.dataset.side;
  Layout.drag(rz, () => Layout.bar(side).offsetWidth,
    (startW, dx) => Layout.setWidth(side, side === "left" ? startW + dx : startW - dx),
    () => Layout.reset(side));
});
// The 3D | 2D divider. The denominator is the FREE space — the pane row minus the bar itself — which
// is exactly what the grow factors divide, so the split tracks the cursor rather than trailing it.
Layout.drag($("viewSep"),
  () => ({ free: $("views").clientWidth - $("viewSep").offsetWidth, r: Layout.split() }),
  (c, dx) => { if (c.free > 0) Layout.setSplit(c.r + dx / c.free); },
  () => Layout.resetSplit());
// The bar between the Vehicle tab's two lists (ROADMAP 3.6). The two panes flex from a zero basis
// (from their floors on a short page, which `baseOf` takes off both), so between them they hold
// exactly the height they share, and the vehicle list's new share is its own share plus the drag
// over the sum of both — the bar follows the cursor rather than trailing it.
// The skins list never grows past its own content (`max-height: max-content`), so a short one hands
// the rest straight back and dragging it bigger than its rows does nothing, which is honest.
Layout.drag($("listSep"),
  () => {
    if (!Layout.listSplitLive()) return null;
    const A = Layout.pane("a"), B = Layout.pane("b"), ba = Layout.baseOf(A);
    const a = Layout.shareOf(A) - ba, sum = a + Layout.shareOf(B) - Layout.baseOf(B);
    return { a, sum };
  },
  (c, dy) => { if (c.sum > 0) Layout.setListSplit((c.a + dy) / c.sum); },
  () => Layout.resetListSplit(), "y");
// The Controls & guide screen closes the way every other thing over the page does — Escape, its ✕,
// or a click outside its panel. It was three inline onclick= attributes in the markup (CLAUDE.md §4)
// and nothing listened for Escape, so the key went past it: with the Export window open under the
// guide, the first Escape closed the WINDOW and left the guide up (measured with real CDP key
// events, 2026-10-10 docs review; tools/t50_controls.mjs).
// Escape belongs to whatever is drawn on top. Under the guide that is a top-bar window; over it, a
// choice dialog, a prompt, a decal dialog, a layer menu or the Messages popover — an error opens
// Messages by itself and a load can ask a question while the guide is up. So the guide listens
// FIRST — capture phase on the window, ahead of every document listener, while whatever is above it
// is still there to be seen — and either steps aside, when something is drawn above it, or takes the
// key and stops it, so Escape does not also deselect, cancel a placement or close a window beneath.
// Stepping aside cannot stop the key — the thing above needs it — so the window's own Escape
// listener stands down while the guide covers it (ui/panels/topwin.js): with a window under the
// guide and Messages or a choice dialog over it, one Escape closed the overlay AND the hidden
// window, and left the guide up over nothing (t50, the review's second round).
// The first cut listened on the document and asked only about #modalHost: a choice dialog's Escape
// (a window listener) never arrived, so the dialog in plain view needed a second Escape after the
// hidden guide had taken the first, and a menu or Messages closed together with the guide (t50, the
// 2026-10-10 review). "Above" is read off the page rather than kept as a list, so the next overlay
// is covered without anyone remembering this: a top-level layer that is shown, takes the pointer and
// has the higher z-index — the key-hint bubble and the drag ghost are pointer-events:none and never
// count. `whole` asks for one that covers the window, i.e. a dialog's backdrop: `?` does nothing
// under a dialog, which owns the keyboard (the decal dialogs already stop it at the top of this
// file), and still opens the guide under a menu or Messages, which then take the first Escape.
// A block, not a binding: nothing else needs a name.
{
  const help = $("helpOverlay");
  const close = () => { help.style.display = "none"; };
  const above = whole => {
    const z = +getComputedStyle(help).zIndex, de = document.documentElement;
    return [...document.querySelectorAll("body > *, #modalHost > *")].some(el => {
      if (el === help) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.pointerEvents === "none" || !(+cs.zIndex > z)) return false;
      const r = el.getBoundingClientRect();
      return !whole || (r.width >= de.clientWidth && r.height >= de.clientHeight);
    });
  };
  $("btnHelp").onclick = () => { if (!above(true)) help.style.display = "block"; };
  help.addEventListener("click", e => { if (e.target === help) close(); });   // the backdrop, not the panel
  $("btnHelpClose").onclick = close;
  window.addEventListener("keydown", e => {
    if (e.code !== "Escape" || help.style.display === "none" || above(false)) return;
    e.preventDefault(); e.stopPropagation(); close();
  }, true);
}
