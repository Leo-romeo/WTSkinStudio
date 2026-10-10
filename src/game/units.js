// ---------- Vehicle (unit) registry from the install's vromfs containers ----------
// lang.vromfs.bin gives every unit's localized name, char.vromfs.bin its class and nation.
// Together they turn "f_4e" into "F-4E Phantom II · USA · aircraft" and, crucially, into the
// f-4e.blk filename the game actually looks for.
async function loadUnitRegistry(rootDir){
  if (!rootDir) return 0;
  const readVrom = async fname => {
    const h = await rootDir.getFileHandle(fname, { create: false });
    return new Uint8Array(await (await h.getFile()).arrayBuffer());
  };
  let csvMap = null, tagsDb = null;
  const extra = {};
  try {
    progress("Reading vehicle names (lang.vromfs.bin)…", .02);
    await progTick(true);
    const files = readVromfs(await readVrom("lang.vromfs.bin"));
    const csv = files.find(f => /(^|\/)units\.csv$/i.test(f.name));
    if (csv) csvMap = parseUnitsCsv(new TextDecoder().decode(csv.data));
    // The stores' names for the Weapons tab, from the same pack: units_weaponry.csv keys them
    // "weapons/<blk>" and the second column is English, as units.csv does for vehicles.
    const wcsv = files.find(f => /(^|\/)units_weaponry\.csv$/i.test(f.name));
    if (wcsv) GameUnits.weaponNames = parseWeaponryCsv(new TextDecoder().decode(wcsv.data));
  } catch (e) { console.warn("lang.vromfs", e); }
  if (!csvMap) return 0;
  try {
    progress("Reading vehicle classes, nations and ranks (char.vromfs.bin)…", .05);
    await progTick(true);
    const files = readVromfs(await readVrom("char.vromfs.bin"));
    const nmFile = files.find(f => /(^|\/)\??nm$/.test(f.name));
    const names = nmFile ? vromfsNameMap(nmFile.data) : null;
    const load = re => {
      const f = files.find(x => re.test(x.name));
      return f && names ? loadSlimDataBlock(vromfsBlkBody(f.data), names) : null;
    };
    const tagsFile = files.find(f => /unittags\.blk$/i.test(f.name));
    if (tagsFile && names) tagsDb = loadSlimDataBlock(vromfsBlkBody(tagsFile.data), names);
    try {
      const wp = load(/wpcost\.blk$/i);
      if (wp) {
        extra.ranks = parseUnitRanks(wp);
        try { WeaponDB.presets = parseUnitWeapons(wp); } catch (e) { console.warn("weapon presets", e); }
      }
    } catch (e) { console.warn("wpcost", e); }
    try { const sh = load(/(^|\/)shop\.blk$/i); if (sh) extra.shop = parseShopTree(sh); } catch (e) { console.warn("shop", e); }
  } catch (e) { console.warn("char.vromfs", e); }
  const n = buildUnitIndex(csvMap, tagsDb, extra);
  GameUnits.source = tagsDb ? "lang+char" : "lang";
  renderNationRankFilters();
  return n;
}
