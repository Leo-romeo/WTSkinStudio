"use strict";
// ---------- The 3-D view as in game, and the 2-D view's mip level (ROADMAP 4.58 (b)) ----------
// The controls over `LevelView` (view3d/levelview.js), which owns what they set: the In game switch
// with its texture quality, screen and distance, and the 2-D view's Level control. The page lends
// LevelView the two things only the UI layer may touch — the export's Mipmaps tick, which decides
// whether the game gets a chain at all, and the distance readout. In a block, so it adds no global.
{
  const LevelUI = {
    sync(){
      $("btnInGame").classList.toggle("active", LevelView.on);
      $("gameBar").style.display = LevelView.on ? "" : "none";
      $("gameQual").value = String(LevelView.quality);
      $("gameScreen").value = String(LevelView.screen);
    },
    // The Level control lists the active sheet's levels, filled when it is opened — the sheet can have
    // changed size, or another slot become active, since it was last.
    fill2d(){
      const sel = $("lvl2dSel"), s = App.activeSlot, c = s && s.composite;
      const W = c ? c.width : 1, H = c ? c.height : 1, last = Levels.last(W, H);
      sel.textContent = "";
      for (let k = 0; k <= last; k++) {
        const o = document.createElement("option");
        o.value = String(k);
        o.textContent = "Level " + k + (k ? " — " + Math.max(1, W >> k) + "×" + Math.max(1, H >> k) : " — full size");
        sel.appendChild(o);
      }
      sel.value = String(Math.min(LevelView.at2d, last));
    },
    said(){
      const q = LevelView.QUALITIES[LevelView.quality], scr = LevelView.screen === 2160 ? "4K" : LevelView.screen + "p";
      return "In game — x1 filtering (the game's anisotropy setting does not reach UserSkins), only the mip levels the export writes" +
        ($("optMips").checked ? "" : " (none: Mipmaps is off, so the game shows level 0 at every distance)") +
        ", texture quality " + q + (LevelView.quality ? " (the top " + (LevelView.quality > 1 ? "two levels" : "level") + " dropped — whether the game does this to a UserSkin is still to be measured)" : "") +
        ", " + scr + " at an assumed " + Levels.VIEW.fov + "° view";
    },
  };
  LevelView.mipsTick = () => $("optMips").checked;
  LevelView.onReadout = t => { $("gameReadout").textContent = t; };
  $("btnInGame").onclick = () => {
    LevelView.set({ on: !LevelView.on });
    LevelUI.sync();
    setStatus(LevelView.on ? LevelUI.said() : "In game off — the 3-D view samples the skin as before (x8, the GPU's own mip levels)", "ok");
  };
  $("gameQual").onchange = e => { LevelView.set({ quality: +e.target.value }); LevelUI.sync(); setStatus(LevelUI.said(), "ok"); };
  $("gameScreen").onchange = e => { LevelView.set({ screen: +e.target.value }); LevelUI.sync(); setStatus(LevelUI.said(), "ok"); };
  $("gameDist").onchange = e => {
    const d = +e.target.value;
    e.target.selectedIndex = 0;
    if (d) LevelView.dolly(d);
  };
  $("optMips").addEventListener("change", () => LevelView.mipsChanged());
  $("lvl2dSel").addEventListener("pointerdown", LevelUI.fill2d);
  $("lvl2dSel").addEventListener("focus", LevelUI.fill2d);
  $("lvl2dSel").onchange = e => {
    const k = +e.target.value;
    LevelView.set({ at2d: k });
    setStatus(k ? "The 2-D view shows mip level " + k + " of the sheet, texel for texel — what the game draws from far enough away. Strokes still land on the layer at full size"
                : "The 2-D view shows the sheet at full size again", "ok");
  };
}
