// ---------- Scanning the game folder, as named steps on one object (ROADMAP 2.4) ----------
// `indexGameFolder` was 95 lines doing five jobs in one body: clear the index, read the registry
// and the data tree, take the stored index or walk the packs, then swap the panel's rows and say
// what came out. The steps are methods on `GameScan` — one binding rather than five more in the
// shared scope (§5.6) — and the entry point keeps its name and its contract (a texture count).
//
// `tools/t80_scan.mjs` holds the last step, which is the one with user-visible text and five
// independent branches and which nothing had ever looked at; the scan itself is exercised every
// time the app opens a folder, and its stored index by `tools/t21_cache.mjs`.
const GameScan = {
  // Nothing of the last folder may survive into this one: a stale stem map is a texture that
  // cannot be found and a stale desc bind is a model bound to another vehicle's sheets.
  // The stem table is REPLACED rather than cleared: the vehicle list keeps its search keys beside the
  // table and rebuilds them when the table is a different one (VehicleList.stems), which a cleared
  // and refilled Map is not — measured in the review of 2026-09-27, a rescan that kept the stem
  // count listed the old scan's records, pointing at the old pack offsets. The stored index's
  // restore has always replaced it (restoreGameIndex); now a fresh scan does too.
  reset(dir){
    App.gameDir = dir;
    GameDB.entries = []; GameDB.packs = 0; GameDB.stems = new Map();
    GameDB.desc = null; GameDB.descDbs = []; GameDB.models = []; GameDB.descBindCache.clear();
    GameDB.descPaths = []; GameDB.grpIndex = null; GameDB.packList = [];
    // The rows too: buildModelUnitJoin rebuilds them only when the unit registry loaded, so a second
    // folder whose registry could not be read listed the first folder's vehicles.
    GameDB.modelUnits = new Map(); GameDB.vehicleRows = [];
    GameDB.ownModels = null; GameDB.ownUnread = 0;
  },
  // The unit registry and the game's own data tree. aces.vromfs.bin holds every vehicle's stations
  // and every weapon definition — one unpack (~75 ms) that stays resident; individual blks decode
  // on demand.
  async tree(dir){
    await loadUnitRegistry(dir);                                       // 0 → 8 %
    progress("Reading the game's own data tree (aces.vromfs.bin)…", .085);
    await progTick(true);
    Object.assign(AcesDB, { files: null, byName: null, names: null, ddict: 0, ready: false, error: null });
    AcesDB.cache.clear();
    WeaponDB.arm.clear(); WeaponDB.stores.clear(); WeaponDB.unitPaths = null; WeaponDB.ready = false;
    await ensureAces(dir);
  },
  // The whole index, read back from the last visit. Nothing below the fingerprint changes until the
  // game is patched, so this is the difference between a cold start and an instant one.
  async cached(fp){
    progress("Reusing the index from your last visit…", .12);
    await progTick(true);
    if (!await restoreGameIndex(fp)) return false;
    progress("Reading model→texture maps…", .5);
    await progTick(true);
    await loadDescFiles(true);                                         // paths are cached; parse them
    return true;
  },
  // …or the real thing. Two passes: walk the tree first (directory metadata only, quick) so the
  // second pass — the one that actually reads packs — can report a real percentage instead of a
  // barber pole.
  async fresh(dir){
    GameDB.scanCount = 0;
    const found = { dxp: [], desc: [], grp: [] };
    await scanGameDir(dir, 0, found, "");
    throwIfCancelled();
    GameDB.descPaths = found.desc.map(f => f.path);
    GameDB.descHandles = new Map(found.desc.map(f => [f.path, f.h]));
    // Packs are opened concurrently. Each one costs two round-trips to the browser process
    // (getFile, then a read) and almost no CPU, so doing them one at a time left the machine idle
    // for most of the scan — this is where the bulk of the cold-start time went.
    let done = 0;
    await forEachConcurrent(found.dxp, PACK_CONCURRENCY, async f => {
      try { await indexDxp(f.h, f.path); } catch (e) { console.warn("dxp " + f.path, e); }
      if ((++done & 31) === 0) {
        progress("Reading texture packs… " + done + "/" + found.dxp.length + " · " + GameDB.entries.length.toLocaleString() + " textures",
          .12 + .48 * done / Math.max(1, found.dxp.length));
        await progTick();
      }
    }, progCancelled);
    // Only texture packs are on the list yet, but the count is the one restoreGameIndex makes of the
    // whole list, so a fresh scan and a restored one cannot disagree about it.
    GameDB.packs = GameDB.packList.filter(p => /\.dxp\.bin$/i.test(p.path)).length;
    throwIfCancelled();
    GameDB.entries.sort((a, b) => a.name.localeCompare(b.name));
    // The model packs are indexed here too rather than on the first vehicle click: it is the same
    // kind of work, it parallelises with the same helper, and it is what the cache needs in order
    // to make the *next* visit skip the directory walk entirely.
    await indexGrpPacks(found.grp);                                    // 60 → 82 %
    throwIfCancelled();
    await loadDescFiles();                                             // 82 → 97 %
    throwIfCancelled();
  },
  // ---- Where the install is, given the folder that was picked (2026-10-10) ----
  // A pick ABOVE the install — the Steam library, its `steamapps` or `common`, a drive — used to be
  // scanned as it was handed over, and answered "No game data found — pick the War Thunder install
  // folder itself", which is the user's mistake read back to them rather than fixed. The install is
  // always one of a handful of names below such a pick, so those are LOOKED UP, by name, one
  // `getDirectoryHandle` each: never a walk, which on a drive is the hang that `MAX_DROP_FILES`
  // exists to stop. The Steam names are measured on a real install (a Steam library on
  // another drive); `WarThunder` is the Gaijin launcher's own folder name. The Program Files
  // entries only answer if Chrome lets a drive root be picked at all — unverified, and costs two
  // refused lookups when it does not. `ListedDir.gameRoot` follows the same list through a listing.
  BELOW: ["War Thunder", "WarThunder", "common/War Thunder", "steamapps/common/War Thunder",
          "SteamLibrary/steamapps/common/War Thunder", "Steam/steamapps/common/War Thunder",
          "Games/War Thunder", "Games/WarThunder",
          "Program Files (x86)/Steam/steamapps/common/War Thunder", "Program Files/Steam/steamapps/common/War Thunder"],
  // Folders that sit INSIDE an install (an install's root, listed 2026-10-10). No handle has a
  // parent, so a pick of one of these can only be answered with "pick the folder above it".
  INSIDE: /^(UserSkins|UserMissions|UserSights|Screenshots|Replays|ReplayHits|content|content\.hq|compiledShaders|levels|win32|win64|launcher_plug|BattlEye|WTbackup)$/i,
  // aces.vromfs.bin is the one file every install's root holds and nothing else does.
  async holdsGame(dir){
    try { await dir.getFileHandle("aces.vromfs.bin"); return true; }
    catch { return false; }                       // the throw IS the answer: not an install
  },
  // → { dir, below } where `below` is "" for the pick itself, or { dir: null, inside } when nothing
  // was found and `inside` says whether the pick is a folder of an install.
  async locate(picked){
    if (await GameScan.holdsGame(picked)) return { dir: picked, below: "" };
    for (const path of GameScan.BELOW) {
      let d = picked;
      try { for (const name of path.split("/")) d = await d.getDirectoryHandle(name); }
      catch { continue; }                         // the throw IS the answer: no such folder here
      if (await GameScan.holdsGame(d)) return { dir: d, below: path };
    }
    return { dir: null, inside: GameScan.INSIDE.test(picked.name || "") };
  },
  // ---- An install split across drives by folder links (2026-10-24) ----
  // Players move the big packs to an SSD and leave a junction (or a folder symlink) where they were;
  // the game and Steam follow it. Chrome does not, on purpose: a page is never shown what a link
  // points at. MEASURED on the owner's install with content/base, content.hq/hq_tex,
  // content.hq/uhq_aircraft and levels junctioned to C:\WT — the folder picker and the file chooser
  // alike saw 5 369 of its 12 538 files, and the scan said "16 vehicles ready" with no model to load.
  // So the folder the links point at is picked as well and laid over the install, by relative path:
  // `merge` answers like one directory handle and nothing downstream knows there are two.
  // Every install has these; one that will not open from the install's own handle is a link.
  LINKED: ["content/base"],
  // Whether `path` under `dir` is a folder that opens and holds something.
  async opens(dir, path){
    try {
      let d = dir;
      for (const name of path.split("/")) d = await d.getDirectoryHandle(name);
      for await (const _ of d.entries()) return true;
      return false;
    } catch { return false; }                     // the throw IS the answer: Chrome will not open it
  },
  // A gap is a folder whose parent opens and it does not: an install with no `content` at all is not
  // linked, it is not an install (and the scan says so in its own words).
  async linkGaps(dir){
    const gaps = [];
    for (const p of GameScan.LINKED) {
      let up = dir;
      for (const name of p.split("/").slice(0, -1)) if (up) up = await GameScan.child(up, name);
      if (up && !await GameScan.opens(dir, p)) gaps.push(p);    // one listing, stopped at its first entry
    }
    return gaps;
  },
  async child(dir, name){
    try { return await dir.getDirectoryHandle(name); }
    catch { return null; }                        // the throw IS the answer: the other folder has none
  },
  // `a` is the install (it is what is remembered, written to and opened in a picker: `_primary`), `b`
  // the folder its links point at. Names are matched case-blind, as NTFS matches them. A folder both
  // hold is merged again one level down; a file both hold is the install's. A folder of `a` that
  // will not list — the link itself, where Chrome shows it at all — is listed from `b`, which holds
  // what it points at. Anything created goes to `a` only: UserSkins is the install's.
  merge(a, b){
    const M = {
      kind: "directory", name: a.name, _primary: a._primary || a, _linked: b,
      _legacy: !!a._legacy, _via: a._via,
      async *entries(){
        let own = [];
        try { for await (const e of a.entries()) own.push(e); }
        catch { own = []; }                       // the throw IS the answer: a link Chrome will not follow; `b` lists it
        const seen = new Set();
        for (const [k, h] of own) {
          seen.add(k.toLowerCase());
          const o = h.kind === "directory" ? await GameScan.child(b, k) : null;
          yield [k, o ? GameScan.merge(h, o) : h];
        }
        for await (const [k, h] of b.entries()) if (!seen.has(k.toLowerCase())) yield [k, h];
      },
      async *values(){ for await (const [, h] of M.entries()) yield h; },
      async getDirectoryHandle(name, opts){
        if (opts && opts.create) return a.getDirectoryHandle(name, opts);
        const o = await GameScan.child(b, name);
        let own;
        try { own = await a.getDirectoryHandle(name); }
        catch (e) { if (o) return o; throw e; }
        return o ? GameScan.merge(own, o) : own;
      },
      async getFileHandle(name, opts){
        if (opts && opts.create) return a.getFileHandle(name, opts);
        try { return await a.getFileHandle(name); }
        catch (e) {
          try { return await b.getFileHandle(name); }
          catch { throw e; }                      // neither holds it: the install's own answer stands
        }
      },
      queryPermission: o => a.queryPermission(o),
      requestPermission: o => a.requestPermission(o),
    };
    return M;
  },
  // Every vehicle onto the model it flies (game/registry.js). Each unit's own blk names its `model`,
  // and those 3 474 blks are zstd frames against the archive's dictionary, so they are read in a
  // worker pool (readRoots, CLAUDE.md §3.1) — once per install: the stored index keeps the answer
  // (GameDB.ownModels, game/packs.js) beside the models, under the same fingerprint, which holds
  // aces.vromfs.bin's size and date. A blk that cannot be read, or a read that fails outright, is
  // said on the status line and those vehicles are placed by name (§0.3); neither a failed read nor
  // one that left a blk unread (`ownUnread`) is stored, so the next open reads again and says it again.
  async join(){
    progress("Matching models to in-game vehicles…", .97);
    await progTick(true);
    if (!GameDB.ownModels && AcesDB.ready) {
      try {
        const r = await GameUnits.ownModels(GameScan.readRoots, Math.min(4, poolSize()));
        GameDB.ownModels = r.models;
        GameDB.ownUnread = r.unread;
        if (r.unread) reportFailure("matching vehicles to their models", new Error(r.unread + " vehicle file" +
          (r.unread === 1 ? "" : "s") + " in aces.vromfs.bin could not be read; those vehicles are matched to a model by name"), "ownModels");
      } catch (e) {
        reportFailure("matching vehicles to their models", e, "ownModels");
      }
    }
    buildModelUnitJoin(GameDB.ownModels);
  },
  // A pool for this one read, let go when it is done (§3.8): each lane takes a slice of the unit
  // blks with the dictionary and the name map, and answers with each blk's root `model`. The op is
  // GameUnits.rootParams' own text, so the worker runs exactly what tools/t138_join.mjs runs in-line.
  async readRoots(jobs){
    const P = makeWorkerPool({ name: "unitblk", size: jobs.length, sections: ["ZSTD", "BLK", "VROMFS"],
      ops: "var ZSTD_WASM_B64 = " + JSON.stringify(Zstd.zstdAvailable() ? ZSTD_WASM_B64 : "") + ";\n" +
           "var WT_OPS = { rootParams: " + String(GameUnits.rootParams) + " };" });
    // Every buffer a job carries is its own (GameUnits.ownModels copies them out of the archive), so
    // all four move rather than copy (§3.2): the dictionary and the name map are ~1 MB a lane.
    try { return await P.map(jobs.map(a => ({ op: "rootParams", args: a, transfer: [a.blob.buffer, a.offs.buffer, a.dict.buffer, a.nm.buffer] }))); }
    finally { P.dispose(); }
  },
  // What the user is left looking at. Held by `tools/t80_scan.mjs`, because every branch of it is
  // something that went wrong once. `found` is where the install was found below the folder that
  // was picked ("SteamLibrary/steamapps/common/War Thunder"), when it was not the pick itself.
  finish(cached, dir, found){
    // Folder is in — swap the "open" button for the search box. Only when something actually came
    // out of it, or a wrong folder (easy to hand over by drag & drop) hides the way to try again.
    const gotAnything = GameDB.entries.length || GameDB.models.length;
    if (gotAnything) {
      $("rowGameOpen").style.display = "none";
      if ($("hintGameOpen")) $("hintGameOpen").style.display = "none";
      $("rowGameSearch").style.display = "";
      $("advGame").style.display = "";
      $("gameSearch").disabled = false;
      $("btnFillFromGame").disabled = false;
    }
    // The LINE says what a user needs from it: it worked, and how much there is to pick from. It was
    // one 200-character sentence of inventory — "3 882 vehicles · 66 524 models · 70 581 textures from
    // 8769 packs · from the stored index (…) · 3024 not decodable · opened another way: …" — reported
    // 2026-09-25 as too much, and mostly useless, for a regular user (ROADMAP 3.36). Every part of it
    // is still there, as the detail under the line in Messages; the line is marked so it can be found.
    const list = this.listCount();
    const detail = [
      found ? "Found the install inside the folder you picked: " + found + (dir && dir._legacy ? "." : " — that is the folder remembered.") : "",
      GameDB.models.length.toLocaleString() + " models · " + GameDB.stems.size.toLocaleString() + " textures from " + GameDB.packs.toLocaleString() + " packs",
      cached ? "From the stored index — Advanced ▸ Rescan install after a game update." : "",
      ...this.unreadLines(false),
      this.unlisted(),
      // a dropped or chosen folder is not a real handle: it cannot be stored, and it cannot be written to
      dir && dir._legacy ? (dir._via === "list" ? "Opened another way: pick it again next visit, and export with Download .zip."
                                                : "Dropped folder: drag it in again next visit, and export with Download .zip.") : "",
    ].filter(Boolean).join("\n");
    setStatus(GameDB.entries.length ? list.n.toLocaleString() + " " + list.noun + " ready — pick one in the Vehicle tab" : "No War Thunder data found in that folder",
      GameDB.entries.length ? "ok" : "err", detail);
    renderGameSearch();
    if (gotAnything) drawAttentionToSearch();
  },
  // ---- What the list holds, what it leaves out, and what was not opened (2026-10-10) ----
  // The line counts what the vehicle list LISTS — the rule VehicleList.rows applies: the vehicles
  // matched to a model, or the bare models when there are none. It used to count every unit in the
  // registry, and said "3 883 vehicles ready" over a list of 3 295.
  listCount(){
    const rows = GameDB.vehicleRows || [];
    const n = rows.length || GameDB.models.length;
    return { n, noun: rows.length ? (n === 1 ? "vehicle" : "vehicles") : (n === 1 ? "model" : "models") };
  },
  // The registry's units the list leaves out, said once and said what they are. Measured 2026-10-10:
  // 588 of 3 883 — 354 the game does not tag as a vehicle at all (targets, AI carriers and ships,
  // arcade and airfield dummies, and some vehicle-like ids with no unittags entry: mig-3, f-82g,
  // us_m4a2_1944) and 234 tagged vehicles no model NAME matched. The 234 are the editor's miss, not
  // the install's: none has a model of its own name, yet the Maus is there as pzkpfw_VIII_maus, the
  // Ostwind as flpz_IV_Ostwind, the Grant as mk_I_grant, and the MiG-15's and Eurofighter's uhq packs
  // are installed. "No model matched in this install" told a user their install lacked the MiG-15
  // (review of 2026-10-10); the join itself (unitsForModelStrong, buildModelUnitJoin) is its own item.
  unlisted(){
    const rows = GameDB.vehicleRows || [];
    if (!GameUnits.loaded || !rows.length) return "";
    // A merged row (buildModelUnitJoin) lists every unit it carries, not only the one it shows.
    const listed = new Set(rows.flatMap(r => (r.units || [r.unit]).map(u => u && u.id)));
    let untagged = 0, unmatched = 0;
    for (const u of GameUnits.list) if (!listed.has(u.id)) { if (u.tagged) unmatched++; else untagged++; }
    if (!untagged && !unmatched) return "";
    return (untagged + unmatched).toLocaleString() + " more units in the game's list are not listed: " + [
      untagged ? untagged.toLocaleString() + " not tagged as a vehicle (targets, AI ships and scenery among them)" : "",
      unmatched ? unmatched.toLocaleString() + (unmatched === 1 ? " vehicle" : " vehicles") + " the editor could not match to a model by name" : ""
    ].filter(Boolean).join(", ") + ".";
  },
  // The textures no tier of which opens, counted per TEXTURE (3 024 tier entries are 2 948 textures)
  // and grouped by why (GameDB.blockKind). Counted from the index itself, so a scan restored from the
  // stored index says what a fresh one said: the old tally was kept only while packs were walked,
  // was never stored, and every visit after the first ended Advanced on a bare "… — ". Cached on the
  // index it was counted from, because Advanced is refreshed on every keystroke in the search.
  _unread: null,
  unread(){
    const c = this._unread;
    if (c && c.stems === GameDB.stems && c.n === GameDB.entries.length) return c.val;
    const val = { textures: 0, decoder: 0, comp: 0, format: 0, fmts: new Map(), wind: 0, sheets: 0 };
    for (const rec of GameDB.stems.values()) {
      const en = GameDB.unreadOf(rec);
      if (!en) continue;
      const kind = GameDB.blockKind(en);
      val.textures++; val[kind]++;
      if (kind !== "format") continue;
      const name = GameDB.fmtName(en) || "unnamed";
      val.fmts.set(name, (val.fmts.get(name) || 0) + 1);
      if (/_pivot_(dir|pos)$/i.test(rec.stem)) val.wind++;
      if (/_c$/i.test(rec.stem)) val.sheets++;          // named like a colour sheet: 0 on the live install
    }
    this._unread = { stems: GameDB.stems, n: GameDB.entries.length, val };
    return val;
  },
  // One sentence per cause: short for the closing message (`full` false), every format named for
  // Advanced. "No body or camouflage sheet" is measured, not inferred — tools/t85_listed_install.mjs
  // checks it against every listed vehicle's materials on a real install; the colour-sheet half is
  // also counted here, and the sentence changes if a `_c` sheet ever turns up among them.
  unreadLines(full){
    const u = this.unread(), N = k => k.toLocaleString(), out = [];
    if (!u.textures) return out;
    const lead = k => full ? N(k) + (k === 1 ? " is" : " are") : N(k) + (k === 1 ? " texture is" : " textures are") + " not opened:";
    const clean = u.sheets ? N(u.sheets) + " of them are named like colour sheets (_c)." : "No vehicle body or camouflage sheet is among them.";
    if (full) out.push(N(u.textures) + " of " + N(GameDB.stems.size) + " textures are not opened.");
    if (u.decoder) out.push(lead(u.decoder) + " Oodle-compressed, and this build has no Oodle decoder — import the .dds by hand to work on one.");
    if (u.comp) out.push(lead(u.comp) + " compressed in a way the editor has no reader for.");
    if (u.format && !full) out.push(lead(u.format) + " data in pixel formats the editor has no reader for, such as vegetation wind tables and propeller masks. They decompress fine. " + clean);
    if (u.format && full) {
      // ties by name: a fresh scan meets the stems in pack order, a restored one in name order
      const fmts = [...u.fmts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f, k]) => f + " ×" + N(k)).join(", ");
      const rest = u.format - u.wind, others = "terrain masks, lookup tables, noise and propeller sheets";
      out.push(lead(u.format) + " in pixel formats the editor has no reader for: " + fmts + ".");
      out.push("They decompress fine and are data rather than paint — " +
        (u.wind ? N(u.wind) + " vegetation wind table" + (u.wind === 1 ? "" : "s") + (rest ? "; the rest " + others : "") : others) + ". " + clean);
    }
    return out;
  },
  // What a vehicle's sheets that did not open ARE, for the Messages detail of whatever counted them —
  // a vehicle's load and Advanced ▸ Fill missing slots say it in the same words, so the two cannot
  // disagree about a propeller mask (review of 2026-10-10: the fill called them "not found").
  utilityNote(fmts){
    return "The utility sheets — propeller masks and the like — are in a pixel format the editor has no reader for (" +
      fmts.join(", ") + "). They are not part of the paint scheme; a slot that wants one stays greyed out under “slots without textures”.";
  },
};
async function indexGameFolder(dir, forceRescan, found){
  GameScan.reset(dir);
  progBegin("Scanning your War Thunder folder…", true);
  let cached = false;
  try {
    await GameScan.tree(dir);
    const fp = await installFingerprint(dir);
    if (!forceRescan) cached = await GameScan.cached(fp);
    if (!cached) await GameScan.fresh(dir);
    progress("Matching models to in-game vehicles…", .99);
    await progTick(true);
    if (!cached && !progCancelled()) saveGameIndex(fp);
  } catch (e) {
    progEnd();
    if (e instanceof Cancelled) { setStatus("Scan cancelled — partial index kept", "err"); }
    else { setStatus("Scan failed: " + e.message, "err"); console.error(e); }
    if (!GameDB.entries.length) return 0;
  }
  progEnd();
  GameScan.finish(cached, dir, found);
  scanUserSkins(dir).catch(e => console.warn("UserSkins", e));   // list what's already installed
  return GameDB.stems.size;
}
// Once the index is ready the search box is the only thing the user needs to touch next,
// so point at it instead of leaving them to find a disabled-looking field.
function drawAttentionToSearch(){
  showTab("vehicle");
  const box = $("gameSearch");
  box.classList.remove("attn");
  void box.offsetWidth;                       // restart the animation
  box.classList.add("attn");
  box.focus();
  setTimeout(() => box.classList.remove("attn"), 5000);
}
// Run `fn` over `list` with at most `limit` in flight. Every one of these jobs is a browser
// round-trip with no CPU behind it, so the limit is about not queueing thousands of file opens
// at once rather than about parallel compute.
const PACK_CONCURRENCY = 24;
async function forEachConcurrent(list, limit, fn, cancelled){
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      if (cancelled && cancelled()) return;
      const i = next++;
      await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}
// Pass 1: find the packs. No file is opened here, so this is cheap enough to run first and
// give the expensive pass an exact denominator. Sub-directories are walked concurrently — the
// install is wide (hundreds of leaf directories) and each `entries()` step is an async round
// trip, so depth-first one directory at a time spent the whole walk waiting.
const SKIP_DIRS = /^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i;
async function scanGameDir(dir, depth, found, prefix){
  if (depth > 7 || progCancelled()) return;
  const subs = [];
  try {
    for await (const [name, h] of dir.entries()) {
      if (progCancelled()) return;
      const path = prefix ? prefix + "/" + name : name;
      if (h.kind === "directory") {
        if (SKIP_DIRS.test(name)) continue;
        subs.push({ h, path });
      } else if (/\.dxp\.bin$/i.test(name)) found.dxp.push({ h, path });
      else if (/Desc\.bin$/i.test(name)) found.desc.push({ h, path });    // dynModelDesc.bin / riDesc.bin
      else if (/\.grp$/i.test(name)) found.grp.push({ h, path });         // model resource packs (for geometry)
      if (++GameDB.scanCount % 800 === 0) {
        progress("Looking through the install… " + GameDB.scanCount.toLocaleString() + " files seen, " +
          found.dxp.length + " texture packs", .09);
        await progTick();
      }
    }
  } catch (e) { console.warn("scan " + prefix, e); }
  await forEachConcurrent(subs, 8, s => scanGameDir(s.h, depth + 1, found, s.path), progCancelled);
}
// Index the model packs' front matter (DynModel + GeomNodeTree names and where they live).
async function indexGrpPacks(list){
  const dyn = new Map(), skel = new Map(), anim = new Map();
  let done = 0;
  await forEachConcurrent(list, PACK_CONCURRENCY, async f => {
    try {
      const file = await f.h.getFile();
      const head = new DataView(await file.slice(0, 12).arrayBuffer());
      const frontLen = head.getUint32(8, true) + 4;
      const front = new Uint8Array(await file.slice(0, 0xC + frontLen).arrayBuffer());
      const { entries } = grpParseFront(front);
      if (!entries.length) return;
      const pack = packAdd(f.path, f.h, file);
      for (const e of entries) {
        if (e.classId === GRP_CLS.DynModel) { if (!dyn.has(e.name)) dyn.set(e.name, { pack, e }); }
        else if (e.classId === GRP_CLS.GeomNodeTree) { if (!skel.has(e.name)) skel.set(e.name, { pack, e }); }
        else if (e.classId === GRP_CLS.Anim2Data) { if (!anim.has(e.name)) anim.set(e.name, { pack, e }); }
      }
    } catch (err) { /* unreadable/foreign .grp — skip */ }
    if ((++done & 31) === 0) {
      progress("Indexing model packs… " + done + "/" + list.length, .60 + .22 * done / Math.max(1, list.length));
      await progTick();
    }
  }, progCancelled);
  GameDB.grpIndex = { dyn, skel, anim };
  return GameDB.grpIndex;
}
// Parse every *Desc.bin (model→material→texture map) and build the model list.
async function loadDescFiles(keepModels){
  const names = new Set();
  const list = GameDB.descPaths || [];
  for (let di = 0; di < list.length; di++) {
    const path = list[di];
    const short = path.replace(/^.*\//, "");
    try {
      setStatus("Reading " + short + " (model→texture map)…");
      progress("Reading model→texture maps… " + (di + 1) + "/" + list.length + " (" + short + ")", .82 + .15 * di / Math.max(1, list.length));
      await progTick();
      const h = (GameDB.descHandles && GameDB.descHandles.get(path)) || await resolveGamePath(App.gameDir, path);
      const u8 = new Uint8Array(await (await h.getFile()).arrayBuffer());
      const db = loadGameResDesc(u8);
      GameDB.descDbs.push({ name: short, db });
      if (!keepModels) for (const c of db.root.children) {
        const nm = db.name(c);
        if (nm && nm !== "(root)") names.add(nm);
      }
    } catch (e) { console.warn("desc " + path, e); }
  }
  if (keepModels) {
    GameDB.desc = GameDB.descDbs.length ? {
      getModel(name){ for (const d of GameDB.descDbs) { const m = descGetModel(d.db, name); if (m) return { m, db: d.db }; } return null; },
      has(name){ return GameDB.descDbs.some(d => !!d.db.child(d.db.root, name)); },
    } : null;
    await GameScan.join();
    return;
  }
  // first db that resolves a given model wins; expose a combined resolver
  GameDB.desc = GameDB.descDbs.length ? {
    getModel(name){ for (const d of GameDB.descDbs) { const m = descGetModel(d.db, name); if (m) return { m, db: d.db }; } return null; },
    has(name){ return GameDB.descDbs.some(d => !!d.db.child(d.db.root, name)); },
  } : null;
  // model list: prefer real renderable vehicles (skip xray/collision/dead/destroyed helpers)
  GameDB.models = [...names].filter(n => !/_(xray|collision|dm|dead|destroyed|dstr|gun|fx)$/.test(n)).sort();
  await GameScan.join();
}
/*==DXP==*/
// Everything from here down reads a .dxp.bin and describes what is in it — no DOM, no File System
// Access beyond the handle it is given. Marked so the offline tools can lift it and run the real
// parser against a real install instead of a paraphrase of it (tools/ooz_sweep.mjs).
//
// It needs `packAdd` from PACKS and `Oodle.oodleAvailable` from OODLE, both inside their markers — but
// also `GameDB` and `KNOWN_FMTS`, which sit just OUTSIDE the PACKS markers in game/packs.js. A
// tool lifting this has to declare those two itself; t21_cache.mjs and ooz_sweep.mjs both do.

// name → { stem, tier }: strips the '*' terminator (done by caller), '?…' hints, and $tier suffix
function parseTexName(raw){
  const noHints = raw.split("?")[0];
  const di = noHints.indexOf("$");
  if (di < 0) return { stem: noHints, tier: "base" };
  const stem = noHints.slice(0, di);
  const tag = noHints.slice(di + 1).toLowerCase();
  const tier = tag.startsWith("uhq") ? "uhq" : tag.startsWith("hq") ? "hq" : tag.startsWith("tq") ? "tq" : "base";
  return { stem, tier };
}
// The front matter averages ~3 KB per pack, so one speculative read of DXP_PREFIX covers almost
// every pack in a single round trip; only the rare large one needs a second read. Reading the
// 0x48 header and then the front separately doubled the number of round trips for no gain.
const DXP_PREFIX = 48 * 1024;
async function indexDxp(handle, path){
  const file = await handle.getFile();
  let front = new Uint8Array(await file.slice(0, Math.min(file.size, DXP_PREFIX)).arrayBuffer());
  if (front.length < 0x48) return;
  let dv = new DataView(front.buffer, front.byteOffset, front.byteLength);
  if (dv.getUint32(0, true) !== 0x32507844) return; // 'DxP2' little-endian bytes D x P 2
  const total = dv.getUint16(8, true);
  if (!total) return;
  const ddsxOff = dv.getUint32(0x20, true) + 0x10;
  const b3Off = dv.getUint32(0x30, true) + 0x10;
  const frontEnd = Math.min(file.size, Math.max(ddsxOff + total * 0x20, b3Off + total * 0x18) + 16);
  if (frontEnd > front.length) {
    front = new Uint8Array(await file.slice(0, frontEnd).arrayBuffer());
    dv = new DataView(front.buffer, front.byteOffset, front.byteLength);
  }
  const pack = packAdd(path, handle, file);
  const names = [];
  let cp = 0x48;
  const td = new TextDecoder();
  for (let i = 0; i < total && cp < front.length; i++) {
    const s0 = cp;
    while (cp < front.length && front[cp] !== 0) cp++;
    names.push(td.decode(front.subarray(s0, cp)).split("*")[0]);
    cp++;
  }
  for (let i = 0; i < total; i++) {
    const ho = ddsxOff + i * 0x20;
    if (ho + 0x20 > front.length) break;
    if (dv.getUint32(ho, true) !== 0x78534444) continue; // 'DDSx'
    const header = front.slice(ho, ho + 0x20);
    const hd = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const off = dv.getUint32(b3Off + i * 0x18 + 0xc, true);
    const size = dv.getUint32(b3Off + i * 0x18 + 0x10, true);
    const fmt = String.fromCharCode(header[4], header[5], header[6], header[7]).replace(/[\0 ]/g, "");
    const comp = (hd.getUint32(8, true) >>> 24) & 0xE0;
    const { stem, tier } = parseTexName(names[i] || ("tex_" + i));
    const knownFmt = KNOWN_FMTS.includes(fmt);
    const knownComp = comp === 0 || comp === 0x20 || comp === 0x80 || (comp === 0x60 && Oodle.oodleAvailable());
    // No tally of the formats this cannot read is kept here any more: GameScan.unread counts them
    // from the entries, which a restored index has too and a walk-time tally did not (2026-10-10).
    const en = {
      name: names[i] || ("tex_" + i), stem, tier, pack, header, off, size,
      fmt, w: hd.getUint16(12, true), h: hd.getUint16(14, true),
      supported: knownFmt && knownComp,
      compName: { 0: "raw", 0x20: "zstd", 0x40: "lzma", 0x60: "oodle", 0x80: "zlib" }[comp] || ("0x" + comp.toString(16)),
    };
    GameDB.entries.push(en);
    let rec = GameDB.stems.get(stem);
    if (!rec) GameDB.stems.set(stem, rec = { stem, tiers: {} });
    // keep the biggest entry per tier (rare duplicates across packs)
    const prev = rec.tiers[tier];
    if (!prev || (en.size && en.w > prev.w) || (!prev.size && en.size)) rec.tiers[tier] = en;
  }
}
// Pick the best decodable variant of a stem for the requested quality ("auto"|"base"|"hq").
function pickVariant(rec, quality){
  const order = quality === "base" ? ["base", "tq"]
    : quality === "hq" ? ["hq", "base", "tq"]
    : ["uhq", "hq", "base", "tq"];
  let listed = null;
  for (const t of order) {
    const en = rec.tiers[t];
    if (!en) continue;
    if (!listed) listed = en;
    if (en.size && en.supported) return en;
  }
  return listed; // may be a stub / unsupported — caller shows why
}
// A texture's 32-byte DDSx header. en.header is a standalone slice() after a fresh scan but a
// subarray() into one packed array when the index came back from the cache, so the view's
// byteOffset has to be carried across — dropping it reads entry 0's header for every texture.
function texHeaderView(en){
  return new DataView(en.header.buffer, en.header.byteOffset, en.header.byteLength);
}
/*==ENDDXP==*/
