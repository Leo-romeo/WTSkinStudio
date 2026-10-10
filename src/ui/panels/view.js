// ---------- View options ----------
$("optFlipV").onchange = () => {
  // both caches are baked with the current V orientation — stale ones misplace seam padding
  for (const s of App.slots.values()) { s.uvOverlay = null; s._uvMasks = null; s._partMaskCache = null; s._uvIslands = null; }
  if (App.geomData) buildScene();
  // An island selection holds a stencil that was rasterised the other way up. The IDS survive (the
  // decomposition is the same topology whichever way V runs) so it is re-baked rather than dropped —
  // losing a selection because a checkbox moved would be a worse answer than rebuilding it.
  if (Marquee.islands && Marquee.rect()) Marquee.setIslands(Marquee.islands);
  draw2D();
};
$("chanViewSel").onchange = e => {
  if (e.target.value !== "auto") { setChannelView(e.target.value); return; }
  // Auto is an entry in this select rather than a button of its own, deliberately: a fourth control
  // setting the same thing as the three that already do is how a mode becomes ambiguous (3.16).
  App.chanAuto = true;
  applyAutoChanView();
  setStatus("Auto view — the preview now follows the channel of the layer you are on", "ok");
};
for (const cb of $("chanToggles").querySelectorAll("input[data-chan]")) {
  cb.onchange = () => {
    if (!App.chanOn) App.chanOn = { color: true, smooth: true, metal: true, normal: true };
    App.chanOn[cb.dataset.chan] = cb.checked;
    rebuildMaterials();
    const off = Object.keys(App.chanOn).filter(k => !App.chanOn[k]).map(k => CHAN_LABEL[k]);
    setStatus(off.length ? "Hidden in the shaded view: " + off.join(", ") : "All channels shown", "ok");
  };
}
$("btnGroupLayer").onclick = toggleGroupSelected;
$("optPaintTint").onchange = e => { App.paintTint = e.target.checked; rebuildMaterials(); };
$("optCoverage").onchange = e => {
  App.coverageOn = e.target.checked;
  for (const s of App.slots.values()) { s._covRev = (s._covRev || 0) + 1; refreshCoverageTexture(s); }
  rebuildMaterials(); draw2D();
  setStatus(App.coverageOn
    ? "Coverage on — the albedo's alpha decides how much of the game's camouflage shows through, the way it does in game"
    : "Coverage off — the sheet is previewed as if fully opaque", "ok");
};
// The camo strength is baked into the shader, so moving the slider recompiles — coalesce it to
// one rebuild per idle moment instead of one per input event.
let paintMixTimer = 0;
$("optPaintStrength").oninput = e => {
  App.paintStrength = +e.target.value / 100;
  $("optPaintStrengthVal").textContent = e.target.value;
  clearTimeout(paintMixTimer);
  paintMixTimer = setTimeout(rebuildMaterials, 90);
};
$("optShowUnposed").onchange = e => {
  App.showUnposed = e.target.checked;
  applySceneVisibility(); refreshPartList();
};
// Jet flames, muzzle flashes and flare billboards are the model's own effect quads. They are not
// paintable on the model, and a skin is not about them, so they are off by default and switched on
// here. Since 2026-09-25 they are drawn from the game's own sheet (EffectMat, view3d/meshes.js) —
// with the stock one that is the ring inside the nozzle; the in-flight plume is the game's
// volumetric effect and is not drawn.
$("optShowEffects").onchange = e => {
  App.showEffects = e.target.checked;
  applySceneVisibility(); refreshPartList();
};
// What is DRAWN on the model is one family of switches and it lives here — jet flames, unposed
// cloth, the vehicle's own pylons, and the loadout's stores. The last two used to be offered twice,
// once here and once in the Weapons tab (ROADMAP 4.39): two controls for one fact, each having to call
// `syncSceneToggles` to stop the other one lying. Loading a loadout still turns both ON, because
// that is a consequence of an action and not a second switch for it.
$("optShowWeapons").onchange = e => {
  App.showWeapons = e.target.checked;
  setWeaponVisibility(); refreshPartList(); refreshWeaponPanel();
};
$("optShowPylons").onchange = e => {
  App.showPylons = e.target.checked;
  setWeaponVisibility(); refreshPartList(); refreshWeaponPanel();
};
function syncSceneToggles(){
  const w = $("optShowWeapons"), p = $("optShowPylons"), f = $("optShowEffects");
  if (w) w.checked = !!App.showWeapons;
  if (p) p.checked = App.showPylons !== false;
  if (f) f.checked = !!App.showEffects;
}
$("optTrackTiling").oninput = e => {
  App.trackTiling = +e.target.value / 100;
  $("optTrackTilingVal").textContent = App.trackTiling.toFixed(2) + "×";
  retileTracks();
};
$("optLight").oninput = e => { renderer.toneMappingExposure = e.target.value / 100; $("optLightVal").textContent = (e.target.value / 100).toFixed(1); needsRender(); };
function setExposure(v){
  v = Math.max(20, Math.min(250, Math.round(v)));
  $("optLight").value = v;
  renderer.toneMappingExposure = v / 100;
  $("optLightVal").textContent = (v / 100).toFixed(1);
  needsRender();
}
$("btnResetExposure").onclick = () => setExposure(100);
// Meter the frame that is on screen and push the model's own pixels to a neutral mid-grey.
// Background pixels are ignored by rendering the model against black and skipping the dark tail,
// otherwise a white backdrop would meter the backdrop and leave the vehicle in silhouette.
$("btnAutoExposure").onclick = () => {
  if (!modelGroup) { setStatus("Load a model first", "err"); return; }
  const wasBg = scene.background;
  scene.background = new THREE.Color(0x000000);
  const prev = renderer.toneMappingExposure;
  renderer.toneMappingExposure = 1;
  renderer.render(scene, camera);
  const w = Math.min(256, renderer.domElement.width), h = Math.min(256, renderer.domElement.height);
  const buf = new Uint8Array(w * h * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  scene.background = wasBg;
  renderer.toneMappingExposure = prev;
  const lit = [];
  for (let i = 0; i < w * h; i++) {
    const l = (buf[i*4] * .2126 + buf[i*4+1] * .7152 + buf[i*4+2] * .0722) / 255;
    if (l > 0.012) lit.push(l);                       // anything above the black backdrop
  }
  if (lit.length < 64) { setStatus("Nothing lit on screen to meter — frame the model first", "err"); return; }
  lit.sort((a, b) => a - b);
  const mid = lit[Math.floor(lit.length * 0.6)];      // slightly above median: highlights matter more
  setExposure(prev * 100 * (0.46 / Math.max(mid, 0.01)));
  setStatus("Exposure set to " + ($("optLight").value / 100).toFixed(2) + " from what is on screen", "ok");
};
$("optMaskGrow").oninput = e => {
  MASK_GROW = +e.target.value;
  $("optMaskGrowVal").textContent = MASK_GROW + " px";
  for (const s of App.slots.values()) { s._partMaskCache = null; scheduleComposite(s); }
};
$("btnShot").onclick = () => Shot.take();                     // ROADMAP 4.37
$("optBg").onchange = e => { setBackground(e.target.value); if (e.target.value === "#custom") $("optBgCustom").click(); };
$("optBgCustom").oninput = () => { $("optBg").value = "#custom"; setBackground("#custom"); };
$("lightAz").oninput = () => { $("lightFollow").checked = false; App.lightFollow = false; $("lightAzVal").textContent = $("lightAz").value + "°"; applyLightDir(); };
$("lightEl").oninput = () => { $("lightFollow").checked = false; App.lightFollow = false; $("lightElVal").textContent = $("lightEl").value + "°"; applyLightDir(); };
$("lightFollow").onchange = e => { App.lightFollow = e.target.checked; if (!e.target.checked) applyLightDir(); };


// ---- Session recording (core/recorder.js) ----
// The button is the only DOM the recorder touches; everything else it does is counters and a rAF
// loop, so this file owns the label, the file it writes, and nothing else.
function recSyncUI(){
  const b = $("btnRecord");
  if (!b) return;
  b.textContent = Rec.on ? "Stop recording" : "Record a session";
  b.classList.toggle("primary", Rec.on);
}
$("btnRecord").onclick = () => {
  if (!Rec.on) { recStart(); return; }
  const rep = recStop();
  if (!rep) return;
  // Straight to a file. `howItFelt` is left empty in the JSON on purpose — the point of the
  // exercise is the part the instrument cannot see, so there is somewhere obvious to write it.
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 1)], { type: "application/json" }));
  a.download = "wtss-session-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus("Session saved — " + rep.durationS + " s, " + rep.strokes.length + " strokes, " +
    rep.droppedFrames + " dropped frames (worst " + rep.worstFrameMs + " ms), " + rep.marks.length +
    " marked moments. Write what it felt like into \u201chowItFelt\u201d before sending it.", "ok");
};
