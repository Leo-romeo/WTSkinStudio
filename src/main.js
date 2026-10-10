// ---------- Boot ----------
// three.js and JSZip are inside the page since ROADMAP 4.50 (1), so the page everyone gets cannot
// fail to fetch them. Two pages can still lack them: the one `npm run build:cdn` writes, which
// fetches them from cdnjs and can meet an offline or blocked network, and a copy whose library
// script is damaged, which throws as it parses and defines nothing. (A copy cut short cannot get
// here: this script is third from the end of the page, so truncation takes it before three.js.)
// Either way, say which it is and what to do, instead of dying in init3D() and leaving a half-wired
// UI. `tools/t31_boot.mjs` boots both — the CDN page offline, and a copy with three.js's script
// corrupted — and reads each sentence back.
(function boot(){
  const missing = [];
  if (typeof THREE === "undefined") missing.push("three.js (3D view)");
  if (typeof JSZip === "undefined") missing.push("JSZip (export / projects)");
  const fetched = [...document.scripts].some(s => /^https?:/i.test(s.src));
  // ZSTD_WASM_B64 is declared by a <script> AFTER this one, so its binding does not exist yet
  // and zstdAvailable() would report it missing on every single load. Check it once the
  // document has finished parsing instead.
  document.addEventListener("DOMContentLoaded", () => {
    // Which build this is, on the first thing anyone sees. Here for the same reason as the zstd
    // check above: half of the label is oodleImpl(), whose OODLE_IMPL is declared by a later
    // <script> and is still in its temporal dead zone while this function body runs.
    const stamp = $("buildStamp");
    if (stamp) stamp.textContent = appBuildLabel();
    if (zstdAvailable()) return;
    setStatus("Loaded with limits — the embedded zstd decoder is missing, so game files cannot be read", "err");
  });
  if (typeof THREE === "undefined") {
    setStatus("Could not load " + missing.join(", ") + (fetched
      ? " — check your connection and reload" : " — this copy of the page is damaged; download it again"), "err");
    const wl = $("welcome");
    if (wl) wl.insertAdjacentHTML("beforeend", fetched
      ? '<p class="hint" style="color:var(--danger);margin-top:10px">Offline: the 3D libraries did not load. Reload once with a connection — they are then cached by the browser.</p>'
      : '<p class="hint" style="color:var(--danger);margin-top:10px">This copy of the page is damaged: the 3D library inside it did not run. Download the page again.</p>');
    return;
  }
  if (missing.length) setStatus("Loaded with limits — missing: " + missing.join(", "), "err");
  init3D();
  resize2D();
  loadPrefs();
  // The brush tips a user has loaded (ROADMAP 4.50 (10)) are in IndexedDB, which answers after boot.
  // Until it has, a stored tip id is kept as it is and the brush paints Round; `tipsLoaded` then
  // lists the library and settles that id. A failure to read it is said by idbGet itself.
  Tips.load().then(() => BrushPanel.tipsLoaded(), e => reportFailure("Reading your brush tips", e, "tips"));
  showTab("vehicle");
  updateBrushAvailability();
  renderUnitList();
  syncFitBtn();
  Scrollbox.watchAll();                     // 3.27(c): every .scrollbox says when there is more below
  new ResizeObserver(() => resizeViews()).observe($("views"));
  if (!missing.length) setStatus("Open your War Thunder folder to begin — or drop in an .obj / .dds / .wtproj");
  // A session to recover goes on the welcome card first, so reopening a remembered install —
  // without asking, if this browser still grants it — cannot take the card away before the offer
  // on it has been seen (ROADMAP 4.50(2)). Each failure is said, and the first one does not cost the
  // second: the install is reopened whether or not the offer could be drawn.
  Recovery.check()
    .catch(e => reportFailure("Looking for a session to recover", e, "autosave"))
    .then(() => tryRestoreGameFolder())
    .catch(e => reportFailure("Reopening the War Thunder folder this browser remembers", e, "restore-folder"));
})();
