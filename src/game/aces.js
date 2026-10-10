"use strict";
/*==ACES==*/
// ---------- aces.vromfs.bin: the game's own gamedata tree ----------
// This is the big one: 25 366 files holding every unit's flight model, damage model, weapon
// slots and every weapon/rack/bomb definition in the game. 23 489 of them are BLKs compressed
// against a shared zstd dictionary that ships inside the archive as <sha256>.dict, which is why
// this used to be unreadable here and armament had to be inferred from names.
// Cost on a stock install: 17 MB read, ~24 MB resident, ~75 ms to unpack the file table; blks
// are then decoded lazily (~40 000/s) and cached.
const AcesDB = {
  files: null,        // [{ name, data }] — data is a view into the unpacked archive
  byName: null,       // lowercase path → entry
  names: null,        // shared name map from ?nm
  ddict: 0,           // wasm ZSTD_DDict* for the archive's dictionary
  cache: new Map(),   // lowercase path → DataBlock | null
  ready: false, error: null,
};
// BLK fields spell paths as the artists typed them ("gameData/Weapons/rocketGuns/x.blk") while
// the archive's own table is lowercase, so every lookup normalises. Doubled separators are
// normalised too, because the game's data contains them — the F-4's BLU-1 racks are referenced
// as "gameData/Weapons/containers//mer_us_blu_1_x2_left.blk" and the game loads them anyway.
function acesKey(path){
  return String(path || "").toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.?\//, "");
}
async function ensureAces(dir){
  if (AcesDB.ready || AcesDB.error) return AcesDB.ready;
  const root = dir || App.gameDir;
  if (!root) return false;
  try {
    const h = await root.getFileHandle("aces.vromfs.bin", { create: false });
    const files = readVromfs(new Uint8Array(await (await h.getFile()).arrayBuffer()));
    const dictFile = files.find(f => /\.dict$/i.test(f.name));
    const nmFile = files.find(f => /(^|\/)\??nm$/.test(f.name));
    if (!dictFile) throw new Error("no zstd dictionary in aces.vromfs.bin");
    if (!nmFile) throw new Error("no shared name map in aces.vromfs.bin");
    AcesDB.ddict = zstdDict(dictFile.data, dictFile.name);
    AcesDB.names = vromfsNameMap(nmFile.data);
    AcesDB.files = files;
    AcesDB.byName = new Map(files.map(f => [acesKey(f.name), f]));
    AcesDB.ready = true;
  } catch (e) {
    AcesDB.error = e;
    console.warn("aces.vromfs.bin", e);
  }
  return AcesDB.ready;
}
// One gamedata path → its DataBlock, or null when the file isn't there. Cached both ways.
function acesBlk(path){
  if (!AcesDB.ready) return null;
  const key = acesKey(path);
  if (AcesDB.cache.has(key)) return AcesDB.cache.get(key);
  let db = null;
  const f = AcesDB.byName.get(key);
  if (f) {
    try { db = loadVromfsBlk(f.data, AcesDB.names, AcesDB.ddict); }
    catch (e) { console.warn("aces blk " + path, e); }
  }
  AcesDB.cache.set(key, db);
  return db;
}
function acesHas(path){ return !!(AcesDB.ready && AcesDB.byName.has(acesKey(path))); }
// Params of one block as a plain object, with repeated keys collected into an array.
function blkParams(db, blk){
  const o = {};
  if (!blk) return o;
  for (let i = 0; i < blk.pCount; i++) {
    const p = db.param(blk, i);
    if (o[p.name] === undefined) o[p.name] = p.val;
    else if (Array.isArray(o[p.name]) && o[p.name].blkMulti) o[p.name].push(p.val);
    else { const a = [o[p.name], p.val]; a.blkMulti = true; o[p.name] = a; }
  }
  return o;
}
// Every value a possibly-repeated param holds, as an array.
function blkList(v){ return v === undefined ? [] : (Array.isArray(v) && v.blkMulti ? [...v] : [v]); }
function blkChildren(db, blk, name){
  if (!blk) return [];
  return blk.children.filter(c => db.nameOf(c) === name);
}
/*==ENDACES==*/
