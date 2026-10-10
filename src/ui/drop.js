// ---------- Dropped and chosen folders as read-only directory handles ----------
// Chrome refuses to hand a directory handle to any folder under Program Files, Windows or AppData
// ("…can't open this folder because it contains system files"), which is precisely where a default
// Steam install of War Thunder sits. The blocklist is enforced by the folder *picker*; the older
// drag & drop Entries API deliberately has no such check, so a dropped folder is wrapped in a
// read-only stand-in that speaks the same interface indexGameFolder()/scanUserSkins() already use
// (entries(), getFileHandle(), getDirectoryHandle(), handle.getFile()).
function legacyFilePerm(o){ return (o && o.mode === "readwrite") ? "denied" : "granted"; }
function legacyFileHandle(entry){
  return {
    kind: "file", name: entry.name, _legacy: true,
    getFile: () => new Promise((res, rej) => entry.file(res, rej)),
    queryPermission: async o => legacyFilePerm(o),
    requestPermission: async o => legacyFilePerm(o),
  };
}
// readEntries() returns at most 100 children per call and signals the end with an empty batch.
function legacyReadAll(dirEntry){
  return new Promise((res, rej) => {
    const rd = dirEntry.createReader(), out = [];
    const step = () => rd.readEntries(batch => { if (!batch.length) { res(out); return; } out.push(...batch); step(); }, rej);
    step();
  });
}
function legacyEntryHandle(e){ return e.isDirectory ? legacyDirHandle(e) : legacyFileHandle(e); }
function legacyDirHandle(entry){
  return {
    kind: "directory", name: entry.name, _legacy: true, _entry: entry,
    async *entries(){ for (const e of await legacyReadAll(entry)) yield [e.name, legacyEntryHandle(e)]; },
    async *values(){ for (const e of await legacyReadAll(entry)) yield legacyEntryHandle(e); },
    getDirectoryHandle(name, opts){
      if (opts && opts.create) return Promise.reject(new Error("a dropped folder is read-only"));
      return new Promise((res, rej) => entry.getDirectory(name, {}, e => res(legacyDirHandle(e)), rej));
    },
    getFileHandle(name, opts){
      if (opts && opts.create) return Promise.reject(new Error("a dropped folder is read-only"));
      return new Promise((res, rej) => entry.getFile(name, {}, e => res(legacyFileHandle(e)), rej));
    },
    queryPermission: async o => legacyFilePerm(o),
    requestPermission: async o => legacyFilePerm(o),
  };
}
// Two markers are enough to be sure, and cheap: only the root listing is read.
const GAME_DIR_MARKERS = /^(aces\.vromfs\.bin|char\.vromfs\.bin|lang\.vromfs\.bin|game\.vromfs\.bin|content|aces\.exe|launcher\.exe|win32|win64|usersk[i]ns)$/i;
async function looksLikeGameDir(dirEntry){
  let hits = 0;
  try { for (const e of await legacyReadAll(dirEntry)) if (GAME_DIR_MARKERS.test(e.name) && ++hits >= 2) return true; }
  catch (e) { console.warn("probe " + dirEntry.name, e); }
  return false;
}
// ---------- The second way in: the ordinary file chooser, as a read-only directory handle ----------
// A dropped folder is no way into a Program Files install from a DOUBLE-CLICKED page: readEntries()
// rejects on file:// (the table below the drop handler). `<input type=file webkitdirectory>` is the
// browser's plain file chooser, which has no system-folder rule, and hands over File objects rather
// than entries. MEASURED 2026-09-24, headless Chrome, a file:// page, CDP DOM.setFileInputFiles
// with a default Steam install:
//
//     15 634 files listed in 4.2 s · lang.vromfs.bin read back, 10 001 320 bytes, "VRFx" ·
//     every File carries size and lastModified, the two things installFingerprint reads
//
// (A dropped folder's getAsFileSystemHandle() is the other candidate. For a CDP-dispatched drag it
// never settled at all — 15 s, no answer — so that route is unmeasured, not refuted.)
//
// The price is that the chooser is EAGER: the browser lists the whole tree before the page sees any
// of it, which is why what it is given should be the install and not a Steam library. And it cannot
// be remembered — a FileList is 15 000 Files, and IndexedDB would copy their bytes — so it is picked
// again each visit. The stored index is keyed by the same fingerprint a real handle yields, so that
// visit still skips the walk. `tools/t84_listed.mjs` holds the adapter; `tools/t85_listed_install.mjs`
// runs the real chooser over a real install.
const ListedDir = {
  node(name){ return { name, dirs: new Map(), files: new Map(), lower: { dirs: new Map(), files: new Map() } }; },
  put(n, kind, name, v){ n[kind].set(name, v); n.lower[kind].set(name.toLowerCase(), v); return v; },
  // Rebuilt from each File's webkitRelativePath ("War Thunder/content/base/res/x.dxp.bin").
  tree(files){
    let root = null;
    for (const f of files) {
      const parts = String(f.webkitRelativePath || "").split("/");
      if (parts.length < 2) continue;                     // not from a folder chooser
      if (!root) root = ListedDir.node(parts[0]);
      let n = root;
      for (let i = 1; i < parts.length - 1; i++) n = n.dirs.get(parts[i]) || ListedDir.put(n, "dirs", parts[i], ListedDir.node(parts[i]));
      ListedDir.put(n, "files", parts[parts.length - 1], f);
    }
    return root;
  },
  // The install itself, or the install one level down — picking `common` instead of `War Thunder`
  // is an easy slip and the listing already paid for it — or the install at one of the places a
  // real handle's pick is looked in (GameScan.BELOW: `steamapps/common/War Thunder` under a Steam
  // library, and so on). The listing is already in memory, so following those names costs nothing;
  // the browser has paid for the whole tree by the time the page sees it.
  gameRoot(n){ const at = ListedDir.locate(n); return at ? at.node : null; },
  // → { node, below } with `below` the path under the picked folder ("" for the pick itself), or null.
  //
  // An install is the folder holding aces.vromfs.bin — the one question `GameScan.holdsGame` asks a
  // real handle — not one with two of `GAME_DIR_MARKERS`: launcher.exe, win64 and content are what a
  // Gaijin-launcher game has at its root (assumed for Enlisted, not measured), so `common` holding
  // one listed before War Thunder had it said to be "Found War Thunder at common/Enlisted" while the
  // folder picker, given the same tree, found War Thunder (review, 2026-10-10). The known names go
  // first, as they do there, so where both routes look they give one answer; any other child holding
  // the file comes after, because the listing is already paid for and the picker's walk is not.
  locate(n){
    if (!n) return null;
    const holds = d => !!d && d.lower.files.has("aces.vromfs.bin");
    if (holds(n)) return { node: n, below: "" };
    for (const path of GameScan.BELOW) {
      let d = n;
      for (const name of path.split("/")) d = d && d.lower.dirs.get(name.toLowerCase());
      if (holds(d)) return { node: d, below: path };
    }
    for (const [k, d] of n.dirs) if (holds(d)) return { node: d, below: k };
    return null;
  },
  // Case-insensitive by fallback, because the handle it stands in for is: NTFS answers
  // getFileHandle("Lang.vromfs.bin") with lang.vromfs.bin, and so does a dropped folder's entry.
  find(n, kind, name, opts){
    if (opts && opts.create) return Promise.reject(new DOMException("a folder opened this way is read-only", "NotAllowedError"));
    const lo = String(name).toLowerCase(), hit = n[kind].get(name) || n.lower[kind].get(lo);
    if (hit) return Promise.resolve(hit);
    // A file asked for as a folder (or the reverse) is TypeMismatchError on a real handle, not "missing".
    const other = n.lower[kind === "dirs" ? "files" : "dirs"].has(lo);
    return Promise.reject(new DOMException("“" + name + "” " + (other ? "is not a " + (kind === "dirs" ? "folder" : "file") : "is not") +
      " in “" + n.name + "”", other ? "TypeMismatchError" : "NotFoundError"));
  },
  file(f){
    return { kind: "file", name: f.name, _legacy: true, getFile: async () => f,
             queryPermission: async o => legacyFilePerm(o), requestPermission: async o => legacyFilePerm(o) };
  },
  handle(n){
    return {
      kind: "directory", name: n.name, _legacy: true, _via: "list",
      async *entries(){
        for (const [k, d] of n.dirs) yield [k, ListedDir.handle(d)];
        for (const [k, f] of n.files) yield [k, ListedDir.file(f)];
      },
      async *values(){ for await (const [, h] of this.entries()) yield h; },
      getDirectoryHandle: (name, opts) => ListedDir.find(n, "dirs", name, opts).then(ListedDir.handle),
      getFileHandle: (name, opts) => ListedDir.find(n, "files", name, opts).then(ListedDir.file),
      queryPermission: async o => legacyFilePerm(o),
      requestPermission: async o => legacyFilePerm(o),
    };
  },
  // Synchronous on purpose: the chooser only opens inside the click that asked for it.
  pick(){ const p = $("gameDirPick"); p.value = ""; p.click(); },
  async open(files){
    if (!files.length) return;                            // cancelled: nothing was chosen
    const root = ListedDir.tree(files), at = ListedDir.locate(root);
    if (!at) {
      setStatus(root && GameScan.INSIDE.test(root.name)
        ? "“" + root.name + "” is a folder inside the War Thunder install — pick the War Thunder folder that holds it, one level up"
        : "No game data found in “" + (root ? root.name : "that folder") + "” (" + files.length.toLocaleString() +
          " files) — pick the War Thunder install folder itself", "err");
      return;
    }
    await openReadOnlyGameFolder(ListedDir.handle(at.node), at.below ? root.name + "/" + at.below : "");
  },
};
$("gameDirPick").onchange = e => { const files = [...e.target.files]; e.target.value = ""; ListedDir.open(files); };
// Same entry point as the picker, minus the picker — for a dropped folder and a chosen one alike.
// `found` is where the install sat below the folder that was chosen, said in the scan's detail.
async function openReadOnlyGameFolder(dir, found){
  try {
    $("welcome").style.display = "none";
    if (found) setStatus("Found War Thunder at " + found + " — opening it", "ok");
    const n = await indexGameFolder(dir, false, found || "");
    if (!n && !GameDB.models.length) {
      $("welcome").style.display = "";      // nothing was loaded — leave them where they started
      setStatus("No game data found in “" + dir.name + "” — " + (dir._via === "list" ? "pick" : "drop") +
        " the War Thunder install folder itself, not a subfolder", "err");
    }
  } catch (e) {
    progEnd();
    setStatus("Scan failed: " + e.message, "err"); console.error(e);
  }
}
// Guard against a mis-drop (the parent of the install, or a whole Steam library) turning into a
// multi-gigabyte file walk that looks like a hang.
const MAX_DROP_FILES = 4000;
class DropTooBig extends Error {
  constructor(){
    super("That folder holds over " + MAX_DROP_FILES.toLocaleString() + " files. Drop the “War Thunder” folder itself — it is recognised on sight — or just the files you need");
    this.name = "DropTooBig";
  }
}
let dragDepth = 0;
// Only react to drags that carry something we can open. Without this the overlay also lit up for
// in-app drags (reordering layers), and the drop handler swallowed them.
function dragCarriesFiles(e){
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  const list = [...t];
  return list.includes("Files") || list.includes("text/uri-list");
}
window.addEventListener("dragenter", e => { if (!dragCarriesFiles(e)) return; e.preventDefault(); dragDepth++; $("drop").style.display = "flex"; });
window.addEventListener("dragleave", e => { if (!dragCarriesFiles(e)) return; e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("drop").style.display = "none"; } });
window.addEventListener("dragover", e => { if (dragCarriesFiles(e)) e.preventDefault(); });
window.addEventListener("drop", async e => {
  if (!dragCarriesFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $("drop").style.display = "none";
  // dataTransfer is invalidated by the first await — collect everything synchronously first
  const entries = [], plainFiles = [];
  const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").trim().split(/[\r\n]+/)[0];
  // A loose file must NEVER go through webkitGetAsEntry. That entry is a handle into the drag's
  // isolated filesystem, and reading one back needs a well-formed filesystem URL — which a page
  // opened from disk does not have.
  //
  // MEASURED 2026-08-05, real CDP-dispatched drags into headless Chrome, file:// vs http://:
  //
  //     page      dropped        getAsFile()        entry.file() / readEntries()
  //     file://   roundel.png    ok  8 bytes        REJECTED EncodingError: A URI supplied to
  //                                                 the API was malformed, or the resulting Data
  //                                                 URL has exceeded the URL length limitations
  //     http://   roundel.png    ok  8 bytes        ok  8 bytes
  //     file://   a folder       (0-byte stub)      REJECTED — same EncodingError
  //     http://   a folder       (0-byte stub)      ok  2 entries
  //
  // So on the double-clicked build — the way this app is meant to be opened (§0.1) — the walk below
  // threw on the FIRST file, nothing was collected at all, and the drop answered "nothing usable"
  // while the real error went to console.error and nowhere else. getAsFile() is unaffected on both
  // origins, so that is what plain files use now.
  //
  // Entries are still the only way to read a DIRECTORY (getAsFile returns a 0-byte stub for one),
  // and per the table above that half genuinely does not work from disk. It is kept, and it now
  // reports the wall it hits instead of pretending the drop was empty.
  if (e.dataTransfer.items && e.dataTransfer.items.length) {
    for (const item of e.dataTransfer.items) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();                    // synchronous, and must happen before any await
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry && entry.isDirectory) entries.push(entry);
      else if (f) plainFiles.push(f);
      else if (entry) entries.push(entry);           // no File and not a directory — the entry is all there is
    }
  }
  if (!entries.length && !plainFiles.length) plainFiles.push(...e.dataTransfer.files);
  // A dropped folder is the only way into an install the folder picker refuses to open, so look
  // for one before walking it as a pile of loose files — a WT install is ~40 GB of them.
  for (const en of entries) {
    if (en.isDirectory && await looksLikeGameDir(en)) { await openReadOnlyGameFolder(legacyDirHandle(en)); return; }
  }
  const files = [...plainFiles];
  const walk = async entry => {
    if (files.length >= MAX_DROP_FILES) throw new DropTooBig();
    if (entry.isFile) files.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
      const rd = entry.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const en of batch) await walk(en); } while (batch.length);
    }
  };
  // A failed walk is not "nothing was dropped" — saying so is how the EncodingError above stayed
  // invisible for as long as it did (§4: errors are never silent). Keep it and report it below,
  // but only if nothing else in the drop turned out to be usable.
  let walkErr = null;
  try { for (const en of entries) await walk(en); }
  catch (err) { console.error(err); if (err instanceof DropTooBig) { setStatus(err.message, "err"); return; } walkErr = err; }
  // A dropped folder holding .blk + textures is a skin — bind it to the model the same way the
  // “Open a skin I already have” picker does, instead of dumping the textures in as loose files.
  const dropDir = entries.find(en => en.isDirectory);
  if (dropDir && files.some(f => /\.blk$/i.test(f.name)) && files.some(f => /\.(dds|tga|png|jpe?g|webp)$/i.test(f.name))) {
    $("welcome").style.display = "none";
    await applySkinEntries(files.map(f => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) })), dropDir.name);
    return;
  }
  if (files.length) { addFiles(files); return; }
  // An image dragged straight out of a web page arrives as a URL, not a file. That used to do
  // nothing at all and looked like drag & drop being broken.
  if (/^https?:\/\//i.test(uri) || /^data:image\//i.test(uri)) { addImageFromURL(uri); return; }
  if (walkErr) {
    setStatus("Could not read that dropped folder (" + (walkErr.message || walkErr) + ")." +
      (location.protocol === "file:"
        ? " Chrome cannot read a dropped folder on a page opened straight from disk. For the War Thunder folder use “Open War Thunder folder…” — or “Open it another way”, which reaches Program Files too; for anything else, drag the files themselves in rather than the folder."
        : " Use “Open game folder” or “Add files…”, or drop the files themselves rather than the folder."), "err");
    return;
  }
  setStatus("Nothing usable in that drop — drop .obj / .dds / .tga / .png / .wtproj / .wtstack / .ora / .psd files, or copy an image and press Ctrl+V", "err");
});
async function useDroppedImage(bmp, name){
  // No slot check any more: the editor opens on anything, and DecalCarry.place is what decides
  // whether the result lands as a layer or waits on the cursor for a slot to exist.
  addDecalFromImage(bmp, name);
}
async function addImageFromURL(url){
  setStatus("Fetching the dropped image…");
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const blob = await r.blob();
    if (!/^image\//.test(blob.type)) throw new Error("that link isn't an image");
    await useDroppedImage(await createImageBitmap(blob), (url.split("?")[0].split("/").pop() || "image") + "");
  } catch (err) {
    setStatus("Could not read that image from the web (" + err.message + ") — save it to disk and drop the file, " +
      "or right-click ▸ Copy image and press Ctrl+V here", "err");
  }
}
// Paste an image straight in (Ctrl+V) — the reliable way to get something off a web page.
window.addEventListener("paste", async e => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === "file" && /^image\//.test(it.type)) {
      const f = it.getAsFile();
      if (!f) continue;
      e.preventDefault();
      // Named for what it will be CALLED, not for how it arrived: the name becomes the layer's — and
      // until 4.28(f), once it had a surface response, its group's too — and a layer or a folder
      // called "pasted" says nothing about what is in it (reported 2026-08-26).
      try { await useDroppedImage(await createImageBitmap(f), "Pasted image." + (it.type.split("/")[1] || "png")); }
      catch (err) { setStatus("Could not read the pasted image: " + err.message, "err"); }
      return;
    }
  }
});

