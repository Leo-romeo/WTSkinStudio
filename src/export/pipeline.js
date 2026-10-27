// ---------- Encoding a skin, off the UI thread ----------
// A 4K albedo is 67 MB of pixels: seam-pad it, build its mip chain, then BC3-encode every level.
// On the main thread that froze the window for the whole export with no way to stop it. The whole
// chain is pure and per-texture, so it is exactly what a pool is for — the textures encode in
// parallel, the window stays live, and Cancel actually cancels.
//
// getUVMask stays here, but no longer because it has to: it used to rasterise the model's UV
// triangles through a canvas, and that is what kept it off a worker. Since ROADMAP 4.23(b) it
// writes the bytes directly and is pure apart from reading the flip checkbox, so moving it is now
// a question of whether it is worth the geometry transfer rather than of whether it is possible.
// It is cached per slot and size and costs ~190 ms on the largest hull measured, so: not yet.
// The mask it returns is a Uint8Array and rides along as a transferable.
let ExportPool = null;
function exportPool(){
  if (ExportPool) return ExportPool;
  ExportPool = makeWorkerPool({
    name: "export",
    // BCNDEC is here for `BCnEnc.from565`, which the BC1 endpoint search calls — the encoder shares the
    // decoder's 565 unpack rather than keeping a second copy of it.
    sections: ["DDS", "BCNDEC", "BCNENC", "ENCODE"],
    // `restarts` are the levels the author made (ROADMAP 4.58), each already at its level's size —
    // `levelOf` made it: that level's sheet at full size, padded for its level, and taken down to it.
    ops: `var WT_OPS = {
  encodeTexture: function(a){
    var rgba = new Uint8ClampedArray(a.rgba);
    if (a.mask) padSeams(rgba, a.w, a.h, new Uint8Array(a.mask), a.padDist);
    var out;
    if (a.fmt === "tga") out = writeTGA(rgba, a.w, a.h);
    else {
      var own = (a.restarts || []).map(function(r){ return { level: r.level, rgba: new Uint8ClampedArray(r.rgba) }; });
      var mips = a.useMips ? BCnEnc.buildMips(rgba, a.w, a.h, a.renorm, own) : [{ w: a.w, h: a.h, rgba: rgba }];
      out = BCnEnc.writeDDS(mips, { bc3: a.fmt === "bc3" });
    }
    return { __t: 1, result: out.buffer, transfer: [out.buffer] };
  },
  levelOf: function(a){
    var rgba = new Uint8ClampedArray(a.rgba);
    if (a.mask) padSeams(rgba, a.w, a.h, new Uint8Array(a.mask), a.padDist);
    var m = BCnEnc.reduce(rgba, a.w, a.h, a.renorm, a.level);
    return { __t: 1, result: { w: m.w, h: m.h, rgba: m.rgba.buffer }, transfer: [m.rgba.buffer] };
  }
};`,
  });
  return ExportPool;
}
// Everything the encoder needs, gathered on the main thread (the DOM reads and the UV mask) so
// the worker call itself is pure data.
// `own` is the texture's restarts from `ExportRun.levels`, or null. A texture that has them carries
// its chain whatever the Mipmaps tick says — they ARE levels (ROADMAP 4.58).
function encodeJob(it, fmt, own){
  const isPow2 = v => (v & (v - 1)) === 0;
  if (!isPow2(it.w) || !isPow2(it.h)) setStatus("Warning: " + it.fileName + " is not power-of-two (" + it.w + "×" + it.h + ")", "err");
  const useMips = $("optMips").checked || !!(own && own.length);
  const mask = $("optPad").checked ? getUVMask(it.slot, it.w, it.h) : null;
  // `rgba` came fresh out of getImageData in collectExports and nothing reads it again, so it is
  // safe to hand over. The mask is cached on the slot, so that one is copied rather than moved.
  // Hand over the buffer only when the view covers all of it — transferring the buffer behind a
  // subarray would give the worker neighbouring data and silently encode the wrong pixels.
  const buf = ExportRun.handOver(it.rgba);
  const maskCopy = mask ? mask.slice().buffer : null;
  const transfer = maskCopy ? [buf, maskCopy] : [buf];
  const restarts = (own || []).map(r => { const b = ExportRun.handOver(r.rgba); transfer.push(b); return { level: r.level, rgba: b }; });
  return { op: "encodeTexture", transfer,
    args: { rgba: buf, mask: maskCopy, w: it.w, h: it.h, fmt, useMips, restarts,
      renorm: it.kind === "n", padDist: useMips ? 32 : 8 } };
}
// Kept for any caller that still wants one texture synchronously (and as the reference the worker
// path is checked against in tools/t33_export.mjs).
function encodeItem(it, fmt){
  const isPow2 = v => (v & (v - 1)) === 0;
  if (!isPow2(it.w) || !isPow2(it.h)) setStatus("Warning: " + it.fileName + " is not power-of-two (" + it.w + "×" + it.h + ")", "err");
  if ($("optPad").checked) {
    const mask = getUVMask(it.slot, it.w, it.h);
    if (mask) padSeams(it.rgba, it.w, it.h, mask, $("optMips").checked ? 32 : 8);
  }
  if (fmt === "tga") return writeTGA(it.rgba, it.w, it.h);
  const useMips = $("optMips").checked;
  const mips = useMips ? BCnEnc.buildMips(it.rgba, it.w, it.h, it.kind === "n") : [{ w: it.w, h: it.h, rgba: it.rgba }];
  return BCnEnc.writeDDS(mips, { bc3: fmt === "bc3" });
}
// Encode every edited texture in parallel. Returns null when the user cancelled — the caller's
// only job then is to say so. File names are assigned before any encoding starts, because the .blk
// and the validator both need them and neither may depend on the order the encoders finish in.
async function encodeAllTextures(items){
  const fmts = exportFormats();
  const fmtOf = items.map(it => ExportCollect.formatFor(it, fmts));
  items.forEach((it, i) => { it.fileName = it.fileNameBase + (fmtOf[i] === "tga" ? ".tga" : ".dds"); });
  const pool = exportPool();
  progress(items.length === 1 ? "Encoding " + items[0].fileName + "…" : "Encoding " + items.length + " textures…", 0);
  await progTick(true);
  let encoded;
  try {
    // The levels authors made come first, a texture at a time (4.58); a texture without is null here.
    const own = [];
    for (const it of items) own.push(await ExportRun.levels(it, pool, fmtOf[own.length]));
    const jobs = items.map((it, i) => encodeJob(it, fmtOf[i], own[i]));
    encoded = await pool.map(jobs,
      (done, n) => progress("Encoded " + done + "/" + n + " textures…", done / n),
      progCancelled);
  } catch (e) {
    // pool.cancel() rejects with the same message, so both arrive here as one outcome
    if (/cancel/i.test(e.message)) { pool.cancel(); return null; }
    throw e;
  }
  if (progCancelled()) { pool.cancel(); return null; }
  const files = [];
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const data = new Uint8Array(encoded[i]);
    files.push({ name: items[i].fileName, data });
    total += data.byteLength;
  }
  return { files, total };
}
// Try to open <game>/UserSkins with write access so export doesn't need a second picker.
// Never ask for a folder that is already known. In order: the handle this session already got
// write access to, the one remembered from a previous visit, the UserSkins directory the skin
// scanner already opened, and finally the game folder's own UserSkins child. Only if all of those
// come back empty does the user see a picker — which used to happen on every single export because
// nothing was remembered and one failure reset App.dirHandle to null.
//
// `ask: false` finds without asking: the caller knows a picker would be refused (2026-10-10, below).
// `find: false` goes straight to the picker: the caller has just found nothing, and asking again
// would put up a second permission prompt for a remembered folder the user has just declined.
async function getUserSkinsHandle({ ask = true, find = true } = {}){
  const usable = async h => {
    if (!h || !h.queryPermission) return false;
    try {
      if (await h.queryPermission({ mode: "readwrite" }) === "granted") return true;
      return await h.requestPermission({ mode: "readwrite" }) === "granted";   // needs the click we are inside
    } catch { return false; }
  };
  if (find) {
    if (await usable(App.userSkinsHandle)) return App.userSkinsHandle;
    const remembered = await idbGet("userSkinsDir");
    if (await usable(remembered)) return (App.userSkinsHandle = remembered);
    if (App.userSkinsDir && !App.userSkinsDir._legacy && await usable(App.userSkinsDir)) {
      App.userSkinsHandle = App.userSkinsDir;
      idbSet("userSkinsDir", App.userSkinsDir);
      return App.userSkinsHandle;
    }
    if (App.gameDir && !App.gameDir._legacy) {
      try {
        const us = await App.gameDir.getDirectoryHandle("UserSkins", { create: true });
        if (await usable(us)) { App.userSkinsHandle = us; idbSet("userSkinsDir", us); return us; }
      } catch (e) { /* not found / denied — fall back to the picker below */ }
    }
  }
  // Asking is the last resort and it lives HERE, where every other way of finding this folder
  // already does — the line above has said "fall back to picker" since it was written, and the
  // caller had to implement it. That mattered once it became a correctness question: the picker
  // needs transient user activation, so it has to happen while the click is still recent, and one
  // function that finds-or-asks is far harder to call too late than two that must be called in
  // order (ROADMAP 3.21). `usable()` above already relies on being inside the click for its
  // requestPermission, so this is the same contract, not a new one.
  if (!ask || !window.showDirectoryPicker) return null;
  setStatus("Choose your War Thunder/UserSkins folder — asked once, then remembered…");
  // It opens in the game folder when one is known — this session's, or the one remembered from the
  // last (a handle needs no permission to be a starting point) — so UserSkins is one click away
  // instead of wherever the picker was last used. An IndexedDB read is milliseconds; the click's
  // activation lasts seconds (3.21).
  // The install's own handle: a picker's startIn takes a real handle, never GameScan.merge's stand-in.
  const home = App.gameDir && !App.gameDir._legacy ? (App.gameDir._primary || App.gameDir) : await idbGet("gameDir");
  let picked;
  try {
    picked = await showDirectoryPicker({ mode: "readwrite", id: "wtuserskins",
      ...(home && home.kind === "directory" ? { startIn: home } : {}) });
  } catch (e) {
    // Cancelling is an answer, not a failure. Distinguished from a real error so the caller can
    // say "cancelled" rather than "export failed".
    if (e && e.name === "AbortError") return null;
    throw e;
  }
  // **What the picker hands back is asked what it is before anything is written into it or
  // remembered (review, 2026-10-10).** Opening in the install makes its own button the easy slip:
  // pressed at once, it hands over the install ROOT, and the skin went to War Thunder/<name>/ —
  // where the game never looks, outside §0.4's one writable place — and the root was remembered, so
  // every later export went there too (a probe of this exact click: "Exported to War Thunder/
  // zip_probe", 13 writes in the root). A folder named UserSkins is taken as it is; the install, or
  // a folder above it, is given its own UserSkins — the same `GameScan.locate` the game-folder
  // picker uses, so the two pickers agree on what an install is, and the readwrite grant on the
  // pick already covers the folder below it; anything else is refused with what it is, and
  // `ExportRun.folder` lets it be chosen again from that dialog's click.
  if (!/^UserSkins$/i.test(picked.name)) {
    const at = await GameScan.locate(picked);
    if (!at.dir) throw Object.assign(new Error(at.inside
      ? "“" + picked.name + "” is a folder inside the War Thunder install. The game only finds a skin in UserSkins, beside it — choose that folder."
      : "“" + picked.name + "” is not a UserSkins folder and has no War Thunder install in it, so the game would never find a skin written there."),
      { name: "NotUserSkins" });
    picked = await at.dir.getDirectoryHandle("UserSkins", { create: true });
  }
  App.userSkinsHandle = picked;
  idbSet("userSkinsDir", picked);
  return picked;
}
// ---------- One export, as named steps on one object ----------
// ROADMAP 2.4. `doExport` was 158 lines and the worst left in the app after the decal editor and the
// layer panel went: nine phases sharing ten locals and one closure, which is why nothing could be
// lifted out of it. The ten become one run object, `R`, and each phase a method — the same move
// `PartsPanel`, `WeaponsPanel`, `Composite`, `DecalEd` and `LayerProps` made, on ONE object rather
// than a dozen new globals (§4).
//
// **The ordering that matters is now visible in `doExport` itself.** ROADMAP 3.21's whole finding is
// that the folder has to be settled BEFORE the encode — after it, the click's transient activation
// has expired and the first export of a session fails with "Must be handling a user gesture". That
// used to be a fact you had to read 60 lines to see, and `t40` checked it by grepping the function's
// text for two call sites. It is two adjacent lines now.
const ExportRun = {
  // What is being exported, or null after saying why not.
  gather(){
    const items = collectExports();
    // A base-colour change edits no texture at all — it is a camouflage pin plus the .blk, and that
    // is a complete, valid skin on its own. Refusing to export it was why "Paint whole vehicle"
    // appeared to do nothing.
    const camoOnly = !items.length && exportMode() === "set_tex" && camoPinPlan().length &&
      camoBaseMode() !== "stock" && camoBaseMode() !== "keep";
    if (items.length || camoOnly) return { items, files: [], total: 0, pins: [], unitNote: "", sizeNote: "" };
    // "nothing painted" and "everything unticked" are different mistakes and need different advice.
    // The preview list reads no pixels, so asking it here is free.
    const excluded = collectExports(true).length;
    setStatus(excluded ? "Nothing to export — all " + excluded + " edited texture" + (excluded > 1 ? "s are" : " is") +
      " unticked in Textures out" : "Nothing to export — paint something, or set a whole-vehicle base colour", "err");
    return null;
  },
  // Every publishing rule in one pass. The sizes here are estimates because nothing is encoded yet —
  // better to stop the user before a 4K encode than after it — and the archive-size rule is
  // re-checked against the real bytes once the files exist.
  async precheck(R){
    const errs = validateExport(buildExportPlan(R.items, { estimate: true })).filter(r => r.level === "error");
    if (!errs.length) return true;
    const go = await choiceDialog("War Thunder will reject this skin:\n\n• " +
      errs.map(r => r.title + (r.detail ? "\n   " + r.detail : "")).join("\n• "),
      [{ label: "Export anyway", value: "go" }, { label: "Cancel", value: "cancel", primary: true }]);
    if (go === "go") return true;
    setStatus("Export cancelled");
    return false;
  },
  name(R){
    const dflt = App.objName ? "my_" + App.objName : "my_skin";
    R.skin = ($("skinName").value.trim() || dflt).replace(/[^a-z0-9_\-]/gi, "_");
    R.units = selectedUnits();
    R.mode = exportMode();
  },
  // See `getUserSkinsHandle`, which may put a picker up and therefore needs the click to still be
  // recent. It is the better order anyway: pick the folder, then watch the progress bar, rather than
  // watch the progress bar and then be asked for something.
  //
  // **No folder is no longer the end of the export (2026-10-10).** A game folder opened another way
  // (`_legacy`: the file chooser, or a drop) is how every Program Files install gets in — Steam's
  // default, so most testers — and a page cannot write there: Chrome refuses the readwrite picker
  // with the same "contains system files" abort it gave the read one. "To War Thunder" put that
  // picker up anyway, its abort became null, and the user was left with "Export cancelled — no
  // folder chosen"; the dialog that offers the zip was only reachable from `recover`, after a throw
  // this path never makes. So a picker that would be refused is not put up, and a picker that was
  // cancelled, refused or never there offers the zip — still here, before the encode, so 3.21's
  // order holds and choosing costs nothing. `R.toDir` turns false when the zip is taken.
  //
  // **But opened another way is not proof of Program Files.** An install on another drive (a Steam
  // library on another drive) can be opened that way too, and there Chrome GRANTS the readwrite
  // picker — which the base build put up and wrote through, and which the first round of this fix
  // had taken away while telling that user the skin "cannot be saved straight into UserSkins"
  // (review, 2026-10-10: a stand-in picker that grants, `ExportRun.folder` → picks [] and the zip).
  // A page cannot tell where a chooser's listing came from, so the zip is the first answer and the
  // folder a second one: *Choose UserSkins folder…* puts the picker up from the dialog's own click —
  // fresh activation, still before the encode, so 3.21 holds — and a refusal there offers the zip
  // again. A browser with no picker is named as the reason before anything else: there EVERY game
  // folder is opened another way, and Program Files is not why.
  //
  // *Choose UserSkins folder…* is offered wherever a fresh click can change the answer: the folder
  // opened another way (above), a picked folder that is not UserSkins (`getUserSkinsHandle` says
  // what it is), and a picker that threw because the click's activation had run out before it went
  // up — 3.21's "Must be handling a user gesture", reachable after a slow `GradFill.ensure`. Not
  // after a plain cancel or refusal: the user has just answered that one.
  //
  // **A browser with no picker at all (Firefox) is not asked anything (ROADMAP 4.57 (1)).** The zip
  // is its only answer, so the dialog that offered it on every export was a click for nothing; the
  // window and the button's tooltip already said so before the click (`TopWin.browserNote`), and
  // the zip's status line says where to extract it.
  async folder(R){
    if (!window.showDirectoryPicker) { R.toDir = false; return true; }
    const legacy = !!(App.gameDir && App.gameDir._legacy);
    let err = null, chose = false;
    const ask = async o => {
      try { App.dirHandle = await getUserSkinsHandle(o); }
      catch (e) { err = e; if (!(e && e.name === "NotUserSkins")) console.error(e); }
    };
    if (!App.dirHandle) await ask({ ask: !legacy });
    while (!App.dirHandle) {
      const again = legacy && !chose || !!err && /^(NotUserSkins|SecurityError|NotAllowedError)$/.test(err.name);
      const c = await ExportRun.offerZip(ExportRun.noFolder(legacy && !chose, err), again, R.skin);
      if (c === "zip") { R.toDir = false; return true; }
      if (c !== "choose" || !again) {
        setStatus(!err && (chose || !legacy) ? "Export cancelled — no folder chosen" : "Export cancelled");
        return false;
      }
      chose = true; err = null;
      await ask({ find: false });
    }
    return true;
  },
  // Why there is no folder to write into — the first half of the zip question. One or two short
  // sentences each (ROADMAP 3.42 (3)): what happened, and what the user can do about it.
  noFolder(legacy, err){
    if (legacy) return "This game folder was opened another way, so it can only be read. If the install is under Program Files, Windows or AppData, Chrome will not let this page write to it; if it is elsewhere, choose its UserSkins folder.";
    if (err && err.name === "NotUserSkins") return err.message;
    if (err) return "The UserSkins folder could not be opened for writing (" + (err.message || err) + ").";
    return "No folder was chosen. If Chrome said it “contains system files”, as it does for every install under Program Files, this page cannot write there.";
  },
  // Where a zip goes and how, in one sentence — the dialog, the zip's status line, the export
  // window's Firefox note and the button's tooltip all say it in these words (4.57 (1)). The folder
  // is the game folder the user opened, by its name; *Extract here* puts the zip's one `<skin>/`
  // folder straight into UserSkins, where an "extract to <name>" would nest it a level too deep.
  zipHint(skin){
    const game = (App.gameDir && App.gameDir.name) || "War Thunder";
    return skin ? "Put " + skin + ".zip in " + game + "/UserSkins and choose Extract here — its " + skin + " folder lands in place."
                : "Put the .zip in " + game + "/UserSkins and choose Extract here — the skin's folder inside lands in place.";
  },
  // → "zip", "choose" (only offered when `choose`), or anything else for no.
  async offerZip(why, choose, skin){
    return await choiceDialog(why + "\n\nDownload it as a .zip instead? " + ExportRun.zipHint(skin),
      [{ label: "Download .zip", value: "zip", primary: true },
       ...(choose ? [{ label: "Choose UserSkins folder…", value: "choose" }] : []),
       { label: "Cancel", value: "cancel" }]);
  },
  // ---- the levels an author made (ROADMAP 4.58, docs/MIP_LEVELS.md §4) ----
  // Each restart is built on this thread — the walk draws on canvases — at full size, then padded for
  // its level (`Levels.pad`) and taken down to it in the pool, and waits there as a small array for
  // the encode. Two in flight at most, so a level ruler's dozen restarts at 4096² hold two 64 MB
  // sheets at a time and not twelve; each build ends in a whole-sheet readback (wt-canvas), so the bar
  // moves and Cancel is asked between them. A texture set to TGA by hand writes one level: none.
  async levels(it, pool, fmt){
    const L = it.levels;
    if (!L || fmt === "tga") return null;
    const mask = $("optPad").checked ? getUVMask(it.slot, it.w, it.h) : null;
    const at = L.at.filter(r => r > 0), out = [], busy = [];
    for (let i = 0; i < at.length; i++) {
      const r = at[i];
      if (progCancelled()) throw new Error("cancelled");
      progress("Building " + it.fileName + "'s own level " + r + "…", i / at.length);
      await progTick(true);
      const buf = ExportRun.handOver(L.build(r)), m = mask ? mask.slice().buffer : null;
      const job = pool.call("levelOf", { rgba: buf, mask: m, w: it.w, h: it.h, level: r, renorm: it.kind === "n", padDist: Levels.pad(r) },
        m ? [buf, m] : [buf]).then(res => { out.push({ level: r, rgba: new Uint8ClampedArray(res.rgba) }); });
      job.catch(() => {});             // awaited below; a cancel rejects the one still in flight too, and that is not news
      busy.push(job);
      if (busy.length >= 2) await busy.shift();
    }
    await Promise.all(busy);
    return out.sort((a, b) => a.level - b.level);
  },
  // A typed array's buffer to transfer — the whole buffer only when the view covers all of it, or a
  // worker would be handed neighbouring bytes and encode the wrong pixels.
  handOver(a){ return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a.buffer : a.slice().buffer; },
  async encode(R){
    progBegin("Encoding textures…", true);
    const done = await encodeAllTextures(R.items);
    if (!done) { progEnd(); setStatus("Export cancelled"); return false; }
    R.files = done.files;
    R.total = done.total;
    return true;
  },
  // Ground and naval: pin the scalable camouflage the skin sits over, and ship the sheet the .blk
  // points at — one per camo stem, so an interior camo is never given the exterior's colour.
  camo(R){
    R.pins = R.mode === "set_tex" ? camoPins() : [];
    const seen = new Set();
    for (const p of R.pins) {
      if (!p.data || seen.has(p.fileName)) continue;   // a tile's pins name a file the encode already wrote
      seen.add(p.fileName);
      R.files.push({ name: p.fileName, data: p.data });
      R.total += p.data.byteLength;
    }
  },
  // One .blk per in-game vehicle this model serves — that is how the game finds the skin. Each one
  // is built for THAT vehicle: a unit whose model uses different textures gets only the lines it can
  // actually use, because a `from:` naming a texture the aircraft does not have matches nothing and
  // the skin silently does nothing (see itemsForUnit in export/units.js). One blk shared by the
  // whole family is what made an F-4E skin do nothing on the F-4EJ.
  blks(R){
    const skipped = [], partial = [];
    for (const u of R.units) {
      const { keep, drop, known } = itemsForUnit(u, R.items);
      if (known && !keep.length) { skipped.push(u); continue; }   // nothing here belongs to this vehicle
      if (drop.length) partial.push(u + " (" + keep.length + " of " + R.items.length + ")");
      R.files.push({ name: u.replace(/[^a-z0-9_\-]/gi, "_") + ".blk",
                     data: new TextEncoder().encode(buildBlk(keep, R.mode, R.pins)) });
    }
    // Every unit rejected would leave an archive the game cannot find at all. That is a worse
    // outcome than a blk that does nothing, so write the first one anyway and say plainly that it is
    // unlikely to work — the user can still see the file and the reason.
    if (!R.files.some(f => /.blk$/.test(f.name)) && R.units.length) {
      R.files.push({ name: R.units[0].replace(/[^a-z0-9_-]/gi, "_") + ".blk",
                     data: new TextEncoder().encode(buildBlk(R.items, R.mode, R.pins)) });
      skipped.length = 0;
      partial.push(R.units[0] + " — none of these textures belong to any selected vehicle");
    }
    // What the user has to know before they go looking for the skin in the hangar.
    R.unitNote = (skipped.length ? " · no .blk for " + skipped.slice(0, 3).join(", ") +
        (skipped.length > 3 ? " and " + (skipped.length - 3) + " more" : "") +
        " — " + (skipped.length === 1 ? "that vehicle uses" : "those vehicles use") +
        " different textures, so a skin for " + (skipped.length === 1 ? "it" : "them") + " has to be painted on " +
        (skipped.length === 1 ? "its" : "their") + " own model" : "") +
      (partial.length ? " · partial: " + partial.slice(0, 3).join(", ") : "");
    R.blkCount = R.files.filter(f => /.blk$/.test(f.name)).length;
  },
  // Now the bytes are real, so the size rule can be exact rather than estimated. Same validator,
  // same cap table — the pre-check only ever had an approximation to work with.
  sized(R){
    const post = validateExport(buildExportPlan(R.items, { files: R.files, pins: R.pins }));
    const rule = post.find(r => r.id === "size-cap" && r.level === "error");
    R.sizeNote = rule ? " — " + rule.title.replace(/^Archive is /, "over the limit at ") + ", consider the WT Live preset" : "";
  },
  async toDir(R){
    // Acquired in `folder`, before the encode — see ROADMAP 3.21. If it is somehow gone by now the
    // folder was revoked mid-export, which `recover` already knows how to report.
    let targetName = R.skin, exists = false;
    // A probe, not a failure: `getDirectoryHandle` throwing IS the "no such folder" answer, which is
    // the common case and the one being asked about.
    try { await App.dirHandle.getDirectoryHandle(R.skin, { create: false }); exists = true; } catch { /* absent */ }
    if (exists) {
      const choice = await choiceDialog("A skin folder “" + R.skin + "” already exists in " + App.dirHandle.name + "." +
        " Replace writes this export into it and removes the .blk and texture files in it that this export does not write.", [
        { label: "Replace", value: "replace", primary: true }, { label: "Save as new", value: "rename" }, { label: "Cancel", value: "cancel" }]);
      if (choice === "cancel" || choice == null) { setStatus("Export cancelled"); return; }
      if (choice === "rename") { let i = 2; while (true) { const n = R.skin + "_" + i; let taken = false; try { await App.dirHandle.getDirectoryHandle(n, { create: false }); taken = true; } catch { /* free */ } if (!taken) { targetName = n; break; } i++; } }
    }
    const sub = await App.dirHandle.getDirectoryHandle(targetName, { create: true });
    const replacing = exists && targetName === R.skin;
    progBegin("Writing skin files…", false);
    for (let i = 0; i < R.files.length; i++) {
      const f = R.files[i];
      progress("Writing " + f.name + "… (" + (i + 1) + "/" + R.files.length + ")", (i + 1) / R.files.length);
      await progTick(true);
      const fh = await sub.getFileHandle(f.name, { create: true });
      const ws = await fh.createWritable();
      await ws.write(f.data);
      await ws.close();
    }
    const removed = replacing ? await ExportRun.prune(sub, R) : [];
    progEnd();
    setStatus("Exported to " + App.dirHandle.name + "/" + targetName + " — " +
      (R.items.length ? R.items.length + " texture(s)" : "base colour only") + " + " +
      R.blkCount + " .blk, " + (R.total / 1048576).toFixed(1) + " MB" + R.sizeNote + R.unitNote +
      (removed.length ? " · removed " + removed.length + " file(s) the earlier export left: " + removed.slice(0, 3).join(", ") +
        (removed.length > 3 ? " and " + (removed.length - 3) + " more" : "") : "") +
      " — now press “Update custom camouflage list” in the hangar", "ok");
    return true;
  },
  // Replace replaces: after the new files are written, the .blk and texture files in the skin's
  // folder that THIS export did not write are removed — a .blk an earlier export left kept its unit
  // pointing at sheets that were gone or old (ROADMAP 1.21 (7)). Only files, only directly inside
  // UserSkins/<name>/, only the kinds an export writes; anything else there is the user's and stays.
  // Names compare without case, because Windows does: "Hull.dds" IS the "hull.dds" just written.
  // After the writes, so an export that fails part-way leaves the old skin whole. t40 reads every call.
  async prune(sub, R){
    const wrote = new Set(R.files.map(f => f.name.toLowerCase())), stale = [];
    for await (const h of sub.values())
      if (h.kind === "file" && /\.(blk|dds|tga)$/i.test(h.name) && !wrote.has(h.name.toLowerCase())) stale.push(h.name);
    for (const n of stale) await sub.removeEntry(n);
    return stale;
  },
  async toZip(R){
    const zip = new JSZip();
    const folder = zip.folder(R.skin);
    for (const f of R.files) folder.file(f.name, f.data);
    progBegin("Packing " + R.skin + ".zip…", false);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" },
      st => progress("Packing " + R.skin + ".zip… " + (st.currentFile || ""), st.percent / 100));
    progEnd();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = R.skin + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus("Zip ready (" + (blob.size / 1048576).toFixed(1) + " MB)" + R.sizeNote + R.unitNote +
      ". " + ExportRun.zipHint(R.skin), "ok");
    return true;
  },
  // ---- A package for WT Live (ROADMAP 4.50 (13)) ----
  // The Market's rules that a file can show, applied to the archive itself rather than to the skin:
  // exactly one `.blk` per archive, only the textures that `.blk` names, and English letters and
  // digits in the archive's and the folder's names. The UserSkins zip above is none of those on a
  // model several vehicles share — one `.blk` per vehicle is right for UserSkins (`ruleBlkCount`)
  // and wrong for an upload — and its name keeps `_` and `-`, which the game matches but the CDK's
  // "letters and digits" does not list. So this is one archive PER `.blk`, each holding a folder of
  // the same name. The `.blk`'s own name is the unit id and stays as the game needs it.
  liveName(s){ return String(s || "").replace(/[^A-Za-z0-9]/g, "") || "skin"; },
  livePacks(R){
    const blks = R.files.filter(f => /\.blk$/i.test(f.name)), base = ExportRun.liveName(R.skin);
    const dec = new TextDecoder(), used = new Set();
    return blks.map(b => {
      const refd = new Set([...dec.decode(b.data).matchAll(/\bto:t\s*=\s*"([^"]*)"/g)].map(m => m[1]));
      // Two unit ids that differ only in "-", "_" or "." strip to one name: the second gets a number.
      let name = blks.length > 1 ? base + ExportRun.liveName(b.name.replace(/\.blk$/i, "")) : base;
      const n0 = name;
      for (let k = 2; used.has(name.toLowerCase()); k++) name = n0 + k;
      used.add(name.toLowerCase());
      return { name, blk: b, tex: R.files.filter(f => refd.has(f.name)) };
    });
  },
  async toLive(R){
    const packs = ExportRun.livePacks(R), names = [];
    for (let i = 0; i < packs.length; i++) {
      const P = packs[i], zip = new JSZip(), folder = zip.folder(P.name);
      for (const f of P.tex) folder.file(f.name, f.data);
      folder.file(P.blk.name, P.blk.data);
      progBegin("Packing " + P.name + ".zip for WT Live (" + (i + 1) + "/" + packs.length + ")…", false);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" },
        st => progress("Packing " + P.name + ".zip… " + (st.currentFile || ""), st.percent / 100));
      progEnd();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = P.name + ".zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      names.push(P.name + ".zip (" + (blob.size / 1048576).toFixed(1) + " MB)");
    }
    setStatus("For WT Live: " + names.join(", ") + (packs.length > 1 ? " — one archive per vehicle, each with its own .blk" : "") +
      R.sizeNote + R.unitNote + ". Upload " + (packs.length > 1 ? "each" : "it") +
      " with a 16:9 preview (the screenshot button's Market preview)" +
      ($("optInvRough").checked ? " and tick “inverted roughness” — these textures carry it" : "") + ".", "ok");
    return true;
  },
  async recover(R, e, toDir){
    progEnd();
    // Only forget the folder when the folder itself is the problem. Any other failure used to clear
    // it too, so the next export asked for it again.
    if (e.name === "AbortError" || e.name === "NotAllowedError" || e.name === "NotFoundError") App.dirHandle = null;
    if (e.name !== "AbortError") { setStatus("Export failed: " + e.message, "err"); console.error(e); return; }
    if (!toDir) { setStatus("Export cancelled"); return; }
    // Writing is impossible for an install under Program Files — Chrome blocks the picker and a
    // dropped folder is read-only — so offer the zip rather than leaving a dead end. `folder` asks
    // the same question before the encode; this is the one for a folder lost during the write. It
    // says "if": a game folder opened another way may be on another drive, where writing works (`folder`).
    const blocked = !App.gameDir || App.gameDir._legacy;
    if (await ExportRun.offerZip(blocked
      ? "The skin could not be written into that folder. If it is under Program Files, Windows or AppData, Chrome will not let this page write there."
      : "Export cancelled.", false, R.skin) !== "zip") { setStatus("Export cancelled"); return; }
    try { return await ExportRun.toZip(R); } catch (err) { progEnd(); setStatus("Export failed: " + err.message, "err"); console.error(err); }
  },
};
// Answers `true` once the skin is written or the zip handed over, and nothing else on every other
// way out — a refusal, a cancel, a failure — so the Export window knows to close (ROADMAP 3.43).
async function doExport(toDir, live){
  // A gradient along the model reads a bake that lands asynchronously (editor/gradient.js); an
  // export fired before the first one has landed would read the sheet with a hole where the fade
  // is. Ordinarily nothing to wait for — the sheet has been on screen — and refused, not shipped,
  // when a bake fails. A noise or a pattern along the model is worked out in the fill pool after
  // the bake (4.50 (7), (8)), and an export fired mid-drag waits for the value the fill holds now.
  try { await GradFill.ensure(); }
  catch (err) {
    progEnd();
    setStatus(err instanceof Cancelled ? "Export stopped: a fill along the model was cancelled before it was placed — export again to place it"
      : "Export stopped: a fill along the model (a gradient, noise or pattern) could not be placed — " + err.message, "err");
    return;
  }
  const R = ExportRun.gather();
  if (!R) return;                                    // it has already said why
  if (!await ExportRun.precheck(R)) return;
  ExportRun.name(R);
  R.toDir = toDir;                                   // `folder` may turn it into the zip
  // The folder is settled BEFORE the encode, and that ordering is the whole of ROADMAP 3.21. These
  // two lines are the fact; `t40` reads them here rather than grepping 158 lines for two call sites.
  if (toDir && !await ExportRun.folder(R)) return;
  if (!await ExportRun.encode(R)) return;
  ExportRun.camo(R);
  ExportRun.blks(R);
  ExportRun.sized(R);
  try { return await (R.toDir ? ExportRun.toDir(R) : live ? ExportRun.toLive(R) : ExportRun.toZip(R)); }
  catch (e) { return ExportRun.recover(R, e, R.toDir); }
}
// Export runs `doExport(true)` in one click and its gear opens the Export window (ui/panels/topwin.js,
// ROADMAP 3.42 and 3.29); the three ways out that used to be a popover here are the window's foot.

