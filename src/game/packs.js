// ---------- Game-file extractor (DXP / DDSx) ----------
// Format per klensy/wt-tools (dxp_unpack.py, formats/ddsx_parser.py):
// DxP2 pack: u16 count @0x8, names @0x48 (nul-terminated, '*'-suffixed),
// DDSx header table ptr @0x20(+0x10, 0x20B each), body table ptr @0x30(+0x10, stride 0x18: off @+0xC, size @+0x10).
// DDSx header: 'DDSx', fourcc, flags u32 (compression in top byte: 0x20 zstd / 0x40 lzma / 0x60 oodle / 0x80 zlib),
// w u16 @0xC, h u16 @0xE, levels u8 @0x10, memSz u32 @0x18, packedSz u32 @0x1C. FLG_REV_MIP_ORDER = 0x40000.
// Textures ship at up to 4 quality tiers as separate complete entries, tagged by a name
// suffix: (none)=base, $tq=tiny, $hq=high, $uhq/$uhq$hq=ultra. Entries are grouped by
// stem and the largest tier that actually has data is decoded.
const GameDB = { entries: [], stems: new Map(), packs: 0,
  desc: null,          // merged DataBlock lookups from dynModelDesc.bin / riDesc.bin
  descDbs: [],         // parsed { name, db } for each *Desc.bin found
  models: [],          // sorted list of model names that carry texture-bearing materials
  packList: [],        // every archive, by path relative to the game folder — see packFile()
  ownModels: null,     // unit id → the model its own blk names (GameScan.join); null until read
  ownUnread: 0,        // how many of those blks the read could not read; a read short of any is not stored
  descBindCache: new Map(),
  // ---- Why a texture is not opened, in words that name it (2026-10-10) ----
  // A DDSx header carries its pixel format in the FOURCC slot. The block-compressed sheets the
  // editor reads put a FOURCC there ("DXT5", "BC7"); uncompressed and floating-point ones put the
  // Direct3D 9 format NUMBER (d3d9types.h, D3DFORMAT), and that printed as text is what the scan
  // used to show: "q" for 113, "2" for 50, a blank for 32, a control character for 21. Measured on
  // the live install: 2 948 textures (3 024 tier entries, 4.2 %) carry one of six such numbers —
  // A16B16G16R16F 1 370, A8B8G8R8 874, A8R8G8B8 587, L8 109, A8 6, R16F 2 — and every one of them
  // decompresses with the shipped decoders (3 017 Oodle, 4 zstd, 3 raw entries, 0 failures). They
  // are 2 740 vegetation wind tables (`_pivot_dir` / `_pivot_pos`), 73 terrain biome masks, 47
  // noise, cloud, water and effect sheets, 24 post-effect LUTs, 17 IES lamp profiles, 16 propeller
  // masks, 15 palettes and 16 others; no vehicle `_c`, body `_n` or t1 camouflage sheet is among
  // them. The colour formats of the enumeration are all here, so the next one Gaijin uses still
  // prints by name; the depth and index formats are not texture data and are left out.
  D3DFMT: { 20: "R8G8B8", 21: "A8R8G8B8", 22: "X8R8G8B8", 23: "R5G6B5", 24: "X1R5G5B5", 25: "A1R5G5B5",
    26: "A4R4G4B4", 27: "R3G3B2", 28: "A8", 29: "A8R3G3B2", 30: "X4R4G4B4", 31: "A2B10G10R10",
    32: "A8B8G8R8", 33: "X8B8G8R8", 34: "G16R16", 35: "A2R10G10B10", 36: "A16B16G16R16", 40: "A8P8",
    41: "P8", 50: "L8", 51: "A8L8", 52: "A4L4", 60: "V8U8", 61: "L6V5U5", 62: "X8L8V8U8", 63: "Q8W8V8U8",
    64: "V16U16", 67: "A2W10V10U10", 81: "L16", 110: "Q16W16V16U16", 111: "R16F", 112: "G16R16F",
    113: "A16B16G16R16F", 114: "R32F", 115: "G32R32F", 116: "A32B32G32R32F", 117: "CxV8U8" },
  // An entry's pixel format as a texture tool would name it: the FOURCC when there is one, the
  // D3DFORMAT name when the slot holds a number. Read from the header, which both a fresh scan and
  // a restored index carry — `en.fmt` cannot tell 32 from 0, since the scan strips blanks out of it.
  // An entry built without a header (a test's) is named from `en.fmt` as far as it can be.
  fmtName(en){
    if (!en) return "";
    const h = en.header;
    let code = -1;
    if (h && h.length >= 8) code = (h[4] | h[5] << 8 | h[6] << 16 | h[7] << 24) >>> 0;
    else if (typeof en.fmt === "string" && en.fmt.length === 1) code = en.fmt.charCodeAt(0);
    if (code === 0) return "";                                     // an empty tier's stub names nothing
    if (code > 0 && code < 256) return GameDB.D3DFMT[code] || "D3DFMT " + code;
    return en.fmt || "";
  },
  // Why one entry does not open, as a key: "" when it does, else empty · decoder · comp · format.
  // The one copy of that order — entryBlockReason (codecs/oodle.js) words it, the scan's summary
  // counts it. Compression is asked before the format, so a "format" entry is always one the build
  // can decompress, which is what lets the summary say they decompress fine.
  blockKind(en){
    if (!en || !en.size) return "empty";
    if (en.supported) return "";
    if (en.compName === "oodle" && !oodleAvailable()) return "decoder";
    if (!/^(raw|zstd|zlib|oodle)$/.test(en.compName)) return "comp";
    return "format";
  },
  // The entry that speaks for a texture no tier of which opens — the first tier with data, best
  // first — or null when one does open, or none has any data (a package not installed: not this).
  unreadOf(rec){
    if (!rec) return null;
    let first = null;
    for (const t of ["uhq", "hq", "base", "tq"]) {
      const en = rec.tiers[t];
      if (!en || !en.size) continue;
      if (en.supported) return null;
      if (!first) first = en;
    }
    return first;
  } };
/*==PACKS==*/
// ---------- Archives are referenced by path, opened on demand ----------
// An index entry used to hold the File object of the pack it came from, which meant every pack
// had to be opened during the scan and nothing about the index could outlive the session. It
// holds an index into GameDB.packList instead, and the handle behind it is resolved the first
// time something is actually read out of that pack. That is what lets the whole index be cached
// (a File handle cannot be stored; a path can) and it is why a cached start does no directory
// walk at all.
function packAdd(path, handle, file){
  const i = GameDB.packList.length;
  GameDB.packList.push({ path, handle: handle || null, file: file || null });
  return i;
}
async function resolveGamePath(dir, path){
  const parts = String(path).split("/").filter(Boolean);
  let d = dir;
  for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
  return d.getFileHandle(parts[parts.length - 1]);
}
async function packFile(i){
  const p = GameDB.packList[i];
  if (!p) throw new Error("pack " + i + " is not in the index");
  if (p.file) return p.file;
  if (!p.handle) {
    if (!App.gameDir) throw new Error("the game folder is not open — reopen it to read " + p.path);
    p.handle = await resolveGamePath(App.gameDir, p.path);
  }
  return (p.file = await p.handle.getFile());
}
// ---------- The index, kept between visits ----------
// Measured on a 27 922-file install: 6 285 texture packs and 3 438 model packs, whose front
// matter alone is 33 MB spread over ~9 700 file opens. Re-reading that on every visit is the
// single largest part of "opening the game folder takes too long", and none of it changes until
// the game is patched — so it is written to IndexedDB and restored wholesale, keyed on a
// fingerprint of the three files a patch always rewrites.
// v5 added the Anim2Data (`<model>_anim`) entries; an older cache has none and would leave every
// vehicle un-animated with no sign of why, so the bump discards it.
const GAME_INDEX_KEY = "gameIndex", GAME_INDEX_VER = 5;
// The three files a patch rewrites do NOT move when Steam adds or removes a content pack, and
// that made the cache lie. Measured 2026-08-11 on the live install: `content.hq/uhq_vehicles`
// (944 packs, the ultra-quality ground textures) landed at 23:59 while warthunder.yup,
// aces.vromfs.bin and char.vromfs.bin were all still 13:20 from that afternoon's patch. So the
// fingerprint matched, the whole directory walk was skipped, and every ground vehicle kept
// loading the sheet it had before — m1a1_abrams_body_c at 2048² out of hq_tex, with the 4096²
// `$uhq` entry sitting unread on disk. The aircraft pack escaped it only by luck: it was
// installed on 07-30, before a patch that happened to force a rescan anyway.
// What actually tracks a pack install is the *inventory*: Steam writes one directory per package
// under content/ and content.hq/ and one `content/<pkg>.ver` stamp beside it (`.rq2` is the
// request, `.ver` the installed version), so an add, a remove and an in-place update each move
// one of them. Listing those two directories is ~60 entries against a 7 244-pack install — it
// costs nothing next to the walk it decides.
// patch/ is deliberately not here: a hotfix rewrites warthunder.yup, which is already above.
// No GAME_INDEX_VER bump — the index *shape* is unchanged, and every stored fingerprint is in
// the old format, so it mismatches once and rescans, which is the point.
const FP_PKG_DIRS = ["content", "content.hq"];
async function installFingerprint(dir){
  const parts = [];
  for (const name of ["warthunder.yup", "aces.vromfs.bin", "char.vromfs.bin"]) {
    try {
      const f = await (await dir.getFileHandle(name)).getFile();
      parts.push(name + ":" + f.size + ":" + f.lastModified);
    } catch { parts.push(name + ":-"); }
  }
  for (const sub of FP_PKG_DIRS) parts.push(sub + "[" + (await packageInventory(dir, sub)).join(",") + "]");
  return parts.join("|");
}
// One line per installed package. Sorted, because directory iteration order is not promised and
// an unstable fingerprint would rescan the whole install on every visit. Every failure yields a
// *stable* token rather than a short list, for the same reason: a folder that cannot be read
// must not look like a folder whose contents changed.
async function packageInventory(dir, sub){
  let d = null;
  // Throwing here is the answer, not an error: a slim install has no content.hq at all.
  try { d = await dir.getDirectoryHandle(sub); } catch { return ["-"]; }
  const rows = [];
  try {
    for await (const [name, h] of d.entries()) {
      // A directory handle carries no metadata, so a package folder counts by name alone. That
      // is enough on its own — installing or removing a pack always adds or drops the folder —
      // and the .ver stamp beside it carries the version, which catches an in-place update.
      if (h.kind === "directory") { rows.push(name + "/"); continue; }
      if (!/\.(ver|rq2)$/i.test(name)) continue;
      try {
        const f = await h.getFile();
        rows.push(name + ":" + f.size + ":" + f.lastModified);
      } catch { rows.push(name + ":?"); }        // unreadable stamp — still record that it exists
    }
  } catch (e) {
    // Half a listing is worse than none: it would differ from the last visit and force a full
    // rescan every single time. If content/ is genuinely unreadable the scan below fails anyway
    // and says so there, which is why this does not raise its own message.
    console.warn("package inventory " + sub, e);
    return ["?"];
  }
  return rows.sort();
}
function saveGameIndex(fp){
  try {
    const n = GameDB.entries.length;
    if (!n) return;
    const heads = new Uint8Array(n * 32);
    // Unsigned throughout: pack offsets are u32 in the format itself and a resource class id is a
    // full 32-bit hash (DynModel is 0xB4B7... = 3 031 947 716), which an Int32Array silently
    // wraps to a negative number.
    const nums = new Uint32Array(n * 3);                      // off, size, pack
    const names = new Array(n);
    for (let i = 0; i < n; i++) {
      const e = GameDB.entries[i];
      heads.set(e.header, i * 32);
      nums[i*3] = e.off; nums[i*3+1] = e.size; nums[i*3+2] = e.pack;
      names[i] = e.name;
    }
    const gi = GameDB.grpIndex;
    const gNames = [], gNums = [];
    if (gi) for (const [kind, m] of [[0, gi.dyn], [1, gi.skel], [2, gi.anim || new Map()]])
      for (const [name, r] of m) { gNames.push(name); gNums.push(r.pack, r.e.offset, r.e.size, r.e.classId, kind); }
    idbSet(GAME_INDEX_KEY, {
      ver: GAME_INDEX_VER, fp,
      packs: GameDB.packList.map(p => p.path),
      names: names.join("\n"), heads, nums,
      grpNames: gNames.join("\n"), grpNums: Uint32Array.from(gNums),
      descPaths: GameDB.descPaths || [], models: GameDB.models,
      // Each unit's own model, so a reopen decodes none of the 3 474 unit blks (GameScan.join). One
      // "id\tmodel" line per unit; null when they were not read, which a reopen then reads. Added
      // 2026-10-10 without a GAME_INDEX_VER bump: an index without it restores as "not read", and
      // each open reads the blks in the pool again until the next scan writes the index — a read off
      // this thread, not a rescan. Neither a read that left a blk unread nor an empty one is kept:
      // kept, a reopen would place those vehicles by name and say nothing, where reading again says
      // it again (CLAUDE.md §4); and an empty map is no answer worth keeping.
      own: GameDB.ownModels && GameDB.ownModels.size && !GameDB.ownUnread ? [...GameDB.ownModels].map(([id, m]) => id + "\t" + m).join("\n") : null,
    });
  } catch (e) { console.warn("index cache save", e); }
}
async function restoreGameIndex(fp){
  let c = null;
  try { c = await idbGet(GAME_INDEX_KEY); } catch { return false; }
  if (!c || c.ver !== GAME_INDEX_VER || c.fp !== fp || !c.names) return false;
  try {
    GameDB.packList = c.packs.map(path => ({ path, handle: null, file: null }));
    // The TEXTURE packs, as GameScan.fresh counts them — the same expression over the same list. The
    // list also holds the model packs, added after the texture walk, and counting all of it said
    // "from 9935 packs" on every visit after a first that had said 6 428 (measured 2026-10-10).
    GameDB.packs = GameDB.packList.filter(p => /\.dxp\.bin$/i.test(p.path)).length;
    const names = c.names.length ? c.names.split("\n") : [];
    const heads = c.heads, nums = c.nums;
    const entries = new Array(names.length);
    const stems = new Map();
    const hv = new DataView(heads.buffer, heads.byteOffset, heads.byteLength);
    for (let i = 0; i < names.length; i++) {
      const b = i * 32;
      const header = heads.subarray(b, b + 32);
      const fmt = String.fromCharCode(heads[b+4], heads[b+5], heads[b+6], heads[b+7]).replace(/[\0 ]/g, "");
      const comp = (hv.getUint32(b + 8, true) >>> 24) & 0xE0;
      const { stem, tier } = parseTexName(names[i]);
      const knownComp = comp === 0 || comp === 0x20 || comp === 0x80 || (comp === 0x60 && oodleAvailable());
      const en = { name: names[i], stem, tier, pack: nums[i*3+2], header,
        off: nums[i*3], size: nums[i*3+1], fmt,
        w: hv.getUint16(b + 12, true), h: hv.getUint16(b + 14, true),
        supported: KNOWN_FMTS.includes(fmt) && knownComp,
        compName: { 0: "raw", 0x20: "zstd", 0x40: "lzma", 0x60: "oodle", 0x80: "zlib" }[comp] || ("0x" + comp.toString(16)) };
      entries[i] = en;
      let rec = stems.get(stem);
      if (!rec) stems.set(stem, rec = { stem, tiers: {} });
      const prev = rec.tiers[tier];
      if (!prev || (en.size && en.w > prev.w) || (!prev.size && en.size)) rec.tiers[tier] = en;
    }
    GameDB.entries = entries;
    GameDB.stems = stems;
    const gn = c.grpNames && c.grpNames.length ? c.grpNames.split("\n") : [];
    if (gn.length) {
      const dyn = new Map(), skel = new Map(), anim = new Map(), gv = c.grpNums;
      const byKind = [dyn, skel, anim];
      for (let i = 0; i < gn.length; i++) {
        const ref = { pack: gv[i*5], e: { name: gn[i], offset: gv[i*5+1], size: gv[i*5+2], classId: gv[i*5+3] } };
        (byKind[gv[i*5+4]] || dyn).set(gn[i], ref);
      }
      GameDB.grpIndex = { dyn, skel, anim };
    }
    GameDB.descPaths = c.descPaths || [];
    GameDB.models = c.models || [];
    GameDB.ownModels = typeof c.own === "string" ? new Map(c.own ? c.own.split("\n").map(l => l.split("\t")) : []) : null;
    return true;
  } catch (e) { console.warn("index cache restore", e); return false; }
}
/*==ENDPACKS==*/
const TIER_RANK = { uhq: 3, hq: 2, base: 1, tq: 0 };
const KNOWN_FMTS = ["DXT1", "DXT3", "DXT5", "ATI1", "ATI2", "BC5U", "BC7"];

