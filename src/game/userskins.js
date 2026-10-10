// ---------- The install's own UserSkins folder ----------
// Every skin already sitting in War Thunder/UserSkins is listed as soon as the game folder is
// opened, so loading one back into the editor is a click instead of a folder picker. Only the
// directory listing is read here — texture bytes are fetched when a skin is actually opened.
async function collectSkinEntries(dirHandle, depth){
  const out = [];
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind === "file") out.push({ name, handle: h, bytes: async () => new Uint8Array(await (await h.getFile()).arrayBuffer()) });
    else if (h.kind === "directory" && depth < 2) out.push(...await collectSkinEntries(h, depth + 1));
  }
  return out;
}
// When each skin was last written. A folder handle has no timestamp of its own, so a folder is
// dated by the newest FILE in it — which is what "when did I last touch this skin" means anyway.
// Every failure is a 0 rather than a throw: this is an ordering hint, and a skin that cannot be
// stat'd must still appear in the list.
async function stampSkinTimes(list){
  for (const rec of list) {
    let t = 0;
    try {
      if (rec.handle && rec.kind === "zip") t = (await rec.handle.getFile()).lastModified || 0;
      else if (rec.handle && rec.entries) {
        for (const e of rec.entries) {
          if (!e.handle || !e.handle.getFile) continue;
          const f = await e.handle.getFile();
          if (f.lastModified > t) t = f.lastModified;
        }
      }
    } catch { t = 0; }                       // unreadable is not an error here, it is "no date"
    rec.mtime = t;
  }
}
async function scanUserSkins(dir){
  App.userSkins = [];
  App.userSkinsDir = null;
  if (!dir) { renderUserSkins(); return 0; }
  let us;
  try { us = await dir.getDirectoryHandle("UserSkins", { create: false }); }
  catch { renderUserSkins(); return 0; }
  App.userSkinsDir = us;
  // This runs unawaited after the folder scan, so the user may start a model load on top of it.
  // Only touch the progress bar while it is still the one this scan opened.
  const owned = Prog.active;
  let myGen = -1;
  if (!owned) { progBegin("Reading your UserSkins folder…", true); myGen = Prog.gen; }
  const mine = () => myGen >= 0 && Prog.gen === myGen;
  const found = [];
  try {
    const dirs = [];
    for await (const [name, h] of us.entries()) {
      if (h.kind === "directory") dirs.push([name, h]);
      else if (/\.zip$/i.test(name)) found.push({ kind: "zip", name: name.replace(/\.zip$/i, ""), fileName: name, handle: h, units: [], texCount: 0 });
      else if (/\.(7z|rar|tar|gz)$/i.test(name)) found.push({ kind: "archive", name, fileName: name, units: [], texCount: 0, unsupported: true });
    }
    for (let i = 0; i < dirs.length; i++) {
      if (progCancelled()) break;
      const [name, h] = dirs[i];
      // never talk over another operation's bar — this runs unawaited after a folder scan
      if (mine()) progress("Reading UserSkins… " + (i + 1) + "/" + dirs.length + " (" + name + ")", (i + 1) / dirs.length);
      await progTick();
      try {
        const entries = await collectSkinEntries(h, 0);
        const texCount = entries.filter(e => /\.(dds|tga|png|jpe?g|webp)$/i.test(e.name)).length;
        if (!texCount) continue;
        const units = entries.filter(e => /\.blk$/i.test(e.name)).map(e => e.name.replace(/^.*[\\/]/, "").replace(/\.blk$/i, ""));
        found.push({ kind: "dir", name, handle: h, entries, units, texCount });
      } catch (e) { console.warn("userskin " + name, e); }
    }
  } catch (e) { console.warn("UserSkins scan", e); }
  if (mine()) progEnd();
  // ROADMAP 3.28(4): newest first. The list was in whatever order the directory walk produced,
  // which is neither alphabetical nor chronological and reads as no order at all — and the skin you
  // want is nearly always the one you just made. `mtime` is 0 for anything the walk could not
  // stat, so those fall to the bottom in name order rather than to the top by accident.
  await stampSkinTimes(found);
  found.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name));
  App.userSkins = found;
  renderUserSkins();
  return found.length;
}
// The list itself — its rows, its search and its order — is ui/panels/skin-list.js (ROADMAP 3.5).
async function loadUserSkin(rec){
  try {
    if (rec.kind === "zip") {
      const zip = await JSZip.loadAsync(await rec.handle.getFile());
      const entries = [];
      zip.forEach((rel, zf) => { if (!zf.dir) entries.push({ name: rel, bytes: async () => new Uint8Array(await zf.async("arraybuffer")) }); });
      await applySkinEntries(entries, rec.name);
    } else {
      await applySkinEntries(rec.entries, rec.name);
    }
  } catch (e) { progEnd(); setStatus("Could not load “" + rec.name + "”: " + e.message, "err"); console.error(e); }
}
$("btnMergeProj").onclick = () => {
  if (!App.slots.size) { setStatus("Load a vehicle (and its weapons) first", "err"); return; }
  $("mergeProjPick").click();
};
$("mergeProjPick").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { await mergeProjectLayers(f); }
  catch (err) { setStatus("Merge failed: " + err.message, "err"); console.error(err); }
};
$("weaponSearch").oninput = () => { clearTimeout($("weaponSearch")._t); $("weaponSearch")._t = setTimeout(renderWeaponSearch, 180); };
$("btnRescanSkins").onclick = () => scanUserSkins(App.gameDir);
$("skinZipPick").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const zip = await JSZip.loadAsync(f);
    const entries = [];
    zip.forEach((rel, zf) => { if (!zf.dir) entries.push({ name: rel, bytes: async () => new Uint8Array(await zf.async("arraybuffer")) }); });
    await applySkinEntries(entries, f.name.replace(/\.zip$/i, ""));
  } catch (err) { setStatus("Could not read that zip: " + err.message, "err"); console.error(err); }
};

