"use strict";
/*==REGISTRY==*/
// ---------- the vehicle (unit) registry ----------
// ---- unit id ↔ model name ----
// WT unit ids and 3-D resource names disagree in three ways: '-' vs '_' (f-4e / f_4e),
// a nation prefix (us_/germ_/ussr_… on ground vehicles), and descriptive suffixes
// (m1a2_sep3 → us_m1a2_sep3_abrams). Normalising all three makes the join reliable, and
// where several real vehicles share one model (every F-16A, both Leopard 2A4s) they are
// all returned — which is exactly what a skin needs, one .blk per variant.
const NATION_PREFIX = /^(us|ussr|germ|uk|jp|cn|it|fr|sw|il)_/;
// Naval unit ids additionally carry their class ("us_destroyer_fletcher") while the model is
// just "fletcher", so that token comes off too.
const SHIP_CLASS_PREFIX = /^(destroyer|cruiser|heavy_cruiser|light_cruiser|battleship|battlecruiser|frigate|corvette|submarine|boat|torpedo_boat|gun_boat|minelayer|barge|transport)_/;
function unitNormalize(s){
  return (s || "").toLowerCase().replace(/-/g, "_").replace(NATION_PREFIX, "").replace(SHIP_CLASS_PREFIX, "");
}
function unitKey(s){ return unitNormalize(s).replace(/_/g, ""); }
// Every country_* tag War Thunder actually uses, including the sub-nations that sit inside a
// major tree (an Australian M1A2 is uk_…, a Hungarian Leopard is it_…).
const UNIT_COUNTRY = { country_usa: "USA", country_germany: "Germany", country_ussr: "USSR", country_britain: "Britain",
  country_japan: "Japan", country_china: "China", country_italy: "Italy", country_france: "France",
  country_sweden: "Sweden", country_israel: "Israel", country_australia: "Australia", country_belgium: "Belgium",
  country_finland: "Finland", country_hungary: "Hungary", country_indonesia: "Indonesia", country_malaysia: "Malaysia",
  country_netherlands: "Netherlands", country_south_africa: "South Africa", country_switzerland: "Switzerland",
  country_thailand: "Thailand" };
// One drawn icon language for every vehicle class — emoji render differently on every machine
// (and the ✈ was a glyph while 🛡 was a colour sprite, which is what made the list look ragged).
const UNIT_CLASS_PATH = {
  air: "M2 9.2 L8.3 8.1 L4.4 3.2 L6.2 3.2 L11.6 7.6 L13.6 7.3 A1.1 1.1 0 0 1 13.6 9.5 L11.6 9.2 L6.2 13.6 L4.4 13.6 L8.3 8.7 Z",
  tank: "M1.6 10.6 h12.8 M1.6 10.6 a1.5 1.5 0 0 0 0 3 h10.8 a1.5 1.5 0 0 0 0 -3 M3.4 10.6 v-2.2 h7.2 v2.2 M6.2 8.4 v-1.6 h2.2 v1.6 M8.4 7 h5.6",
  helicopter: "M2.2 3.4 h11.6 M8 3.4 v2.4 M4.4 7.2 h6.4 a1.4 1.4 0 0 1 1.4 1.4 v1.2 h-9.2 v-1.2 a1.4 1.4 0 0 1 1.4 -1.4 Z M11.4 9.6 h2.8 M13.4 8.6 v2.2 M4.6 11.8 h4.4",
  ship: "M2.6 9.4 h10.8 l-1.6 3.4 a1 1 0 0 1 -0.9 0.6 h-5.8 a1 1 0 0 1 -0.9 -0.6 Z M4.4 9.4 v-3.6 h7.2 v3.6 M8 5.8 v-3.4 M6.4 3 h3.2",
  // A unit with no class of its own — a radar, a SAM site, an AI gun — is drawn as a box seen from a
  // corner, a 3-D object. It was a plain square outline, which next to the skins list's rows read as
  // an unticked checkbox (review of 2026-10-10).
  other: "M8 1.8 L13.6 4.9 V11.1 L8 14.2 L2.4 11.1 V4.9 Z M2.4 4.9 L8 8 L13.6 4.9 M8 8 V14.2",
};
const UNIT_CLASS_ICON = { air: "✈", tank: "▤", ship: "⚓", helicopter: "⌖", boat: "⚓", other: "▪" };
function classIcon(cls){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "vico");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", UNIT_CLASS_PATH[cls] || UNIT_CLASS_PATH.other);
  svg.appendChild(p);
  svg.setAttribute("aria-label", cls || "vehicle");
  return svg;
}
// One drawn flag per country tag, for the nation filter and the vehicle rows. Simplified to what
// reads at 15×10 px — stripes, a cross, a star — and drawn rather than fetched so the page stays
// a single self-contained file with no network at all.
const NATION_FLAG = {
  country_usa: '<rect width="16" height="11" fill="#b22234"/><rect y="1.6" width="16" height="1.55" fill="#fff"/><rect y="4.7" width="16" height="1.55" fill="#fff"/><rect y="7.8" width="16" height="1.55" fill="#fff"/><rect width="6.6" height="6.2" fill="#3c3b6e"/>',
  country_germany: '<rect width="16" height="3.67" fill="#111"/><rect y="3.67" width="16" height="3.67" fill="#dd0000"/><rect y="7.34" width="16" height="3.66" fill="#ffce00"/>',
  // The tree is still called USSR in game, but it is flown as Russia's — the flag is the
  // white-blue-red tricolour, not the hammer and sickle.
  country_ussr: '<rect width="16" height="3.67" fill="#fff"/><rect y="3.67" width="16" height="3.67" fill="#0039a6"/><rect y="7.34" width="16" height="3.66" fill="#d52b1e"/>',
  country_russia: '<rect width="16" height="3.67" fill="#fff"/><rect y="3.67" width="16" height="3.67" fill="#0039a6"/><rect y="7.34" width="16" height="3.66" fill="#d52b1e"/>',
  country_britain: '<rect width="16" height="11" fill="#012169"/><path d="M0 0 16 11M16 0 0 11" stroke="#fff" stroke-width="2.6"/><path d="M0 0 16 11M16 0 0 11" stroke="#c8102e" stroke-width="1.2"/><path d="M8 0V11M0 5.5H16" stroke="#fff" stroke-width="3.6"/><path d="M8 0V11M0 5.5H16" stroke="#c8102e" stroke-width="2"/>',
  country_japan: '<rect width="16" height="11" fill="#fff"/><circle cx="8" cy="5.5" r="3.2" fill="#bc002d"/>',
  country_china: '<rect width="16" height="11" fill="#de2910"/><path d="M3.4 1.6 4.05 3.4 5.9 3.4 4.4 4.5 5 6.3 3.4 5.2 1.8 6.3 2.4 4.5 .9 3.4 2.75 3.4Z" fill="#ffde00"/>',
  country_italy: '<rect width="5.34" height="11" fill="#009246"/><rect x="5.34" width="5.33" height="11" fill="#fff"/><rect x="10.67" width="5.33" height="11" fill="#ce2b37"/>',
  country_france: '<rect width="5.34" height="11" fill="#002395"/><rect x="5.34" width="5.33" height="11" fill="#fff"/><rect x="10.67" width="5.33" height="11" fill="#ed2939"/>',
  country_sweden: '<rect width="16" height="11" fill="#006aa7"/><rect x="4.6" width="2.2" height="11" fill="#fecc00"/><rect y="4.4" width="16" height="2.2" fill="#fecc00"/>',
  country_israel: '<rect width="16" height="11" fill="#fff"/><rect y="1.2" width="16" height="1.7" fill="#0038b8"/><rect y="8.1" width="16" height="1.7" fill="#0038b8"/><path d="M8 3.3 9.7 6.3 6.3 6.3ZM8 7.7 6.3 4.7 9.7 4.7Z" fill="none" stroke="#0038b8" stroke-width=".9"/>',
  country_australia: '<rect width="16" height="11" fill="#012169"/><rect width="7" height="5.5" fill="#012169"/><path d="M0 0 7 5.5M7 0 0 5.5" stroke="#fff" stroke-width="1.4"/><path d="M3.5 0V5.5M0 2.75H7" stroke="#fff" stroke-width="2"/><path d="M3.5 0V5.5M0 2.75H7" stroke="#c8102e" stroke-width="1"/><circle cx="11.5" cy="7.5" r="1.5" fill="#fff"/>',
  country_belgium: '<rect width="5.34" height="11" fill="#111"/><rect x="5.34" width="5.33" height="11" fill="#fae042"/><rect x="10.67" width="5.33" height="11" fill="#ed2939"/>',
  country_finland: '<rect width="16" height="11" fill="#fff"/><rect x="4.6" width="2.2" height="11" fill="#003580"/><rect y="4.4" width="16" height="2.2" fill="#003580"/>',
  country_hungary: '<rect width="16" height="3.67" fill="#cd2a3e"/><rect y="3.67" width="16" height="3.67" fill="#fff"/><rect y="7.34" width="16" height="3.66" fill="#436f4d"/>',
  country_indonesia: '<rect width="16" height="5.5" fill="#ce1126"/><rect y="5.5" width="16" height="5.5" fill="#fff"/>',
  country_malaysia: '<rect width="16" height="11" fill="#cc0001"/><rect y="1.6" width="16" height="1.55" fill="#fff"/><rect y="4.7" width="16" height="1.55" fill="#fff"/><rect y="7.8" width="16" height="1.55" fill="#fff"/><rect width="8" height="6.2" fill="#010066"/><circle cx="3.6" cy="3.1" r="1.7" fill="#ffcc00"/><circle cx="4.4" cy="3.1" r="1.4" fill="#010066"/>',
  country_netherlands: '<rect width="16" height="3.67" fill="#ae1c28"/><rect y="3.67" width="16" height="3.67" fill="#fff"/><rect y="7.34" width="16" height="3.66" fill="#21468b"/>',
  country_south_africa: '<rect width="16" height="5.5" fill="#e03c31"/><rect y="5.5" width="16" height="5.5" fill="#001489"/><path d="M0 5.5H16" stroke="#fff" stroke-width="1.6"/><path d="M0 5.5H16" stroke="#007749" stroke-width=".9"/><path d="M0 0 5 5.5 0 11Z" fill="#001489"/><path d="M0 0 5 5.5 0 11" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M0 0 5 5.5 0 11" fill="none" stroke="#007749" stroke-width=".8"/>',
  country_switzerland: '<rect width="16" height="11" fill="#d52b1e"/><rect x="7" y="2.6" width="2" height="5.8" fill="#fff"/><rect x="5.1" y="4.5" width="5.8" height="2" fill="#fff"/>',
  country_thailand: '<rect width="16" height="11" fill="#a51931"/><rect y="1.9" width="16" height="7.2" fill="#f4f5f8"/><rect y="3.7" width="16" height="3.6" fill="#2d2a4a"/>',
};
function nationFlag(tag){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 11");
  svg.setAttribute("class", "flag");
  svg.setAttribute("aria-label", UNIT_COUNTRY[tag] || tag || "");
  svg.innerHTML = NATION_FLAG[tag] ||
    '<rect width="16" height="11" fill="#3a4050"/><rect x="1" y="1" width="14" height="9" fill="none" stroke="#6a7285" stroke-width="1"/>';
  return svg;
}
const RANK_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const GameUnits = { byId: new Map(), list: [], loaded: false, source: "", nations: [], maxRank: 0,
  weaponNames: new Map(),     // "weapons/<blk>" → the store's English name, from units_weaponry.csv (the Weapons tab's menu)
  // Each unit's own blk names the model it flies — `model:t=` at its root — which is the answer the
  // name join only guesses at (CLAUDE.md §1: the data beats name heuristics). unit id → model, for
  // every unit aces.vromfs.bin has a blk for: 3 474 of 3 883 on 2026-10-10, the rest being AI guns,
  // radars and event copies. Empty when the archive could not be read, which leaves the whole list
  // to the name join, as before (§0.3).
  //
  // Only the root block is parsed (rootParams, below); the cost is the zstd decode, which is codec
  // work and belongs off the UI thread (CLAUDE.md §3.1). So this only packs each unit's entry into
  // `lanes` jobs, one buffer each, and `read(jobs)` decodes them: GameScan.readRoots hands them to a
  // worker pool, tools/t138_join.mjs runs rootParams in-line under Node. Measured 2026-10-10 in
  // Chrome on the real install, the decode held the UI thread 222–254 ms with long tasks of up to
  // 60 ms when it ran here. Returns { models, unread }: `unread` counts the blks that could not be
  // read, and those vehicles fall back to the name join — the caller says so (reportFailure).
  async ownModels(read, lanes){
    const models = new Map();
    if (!AcesDB.ready) return { models, unread: 0 };
    const ids = [], data = [];
    for (const u of GameUnits.list) {
      const path = acesUnitPath(u.id), f = path && AcesDB.byName.get(acesKey(path));
      if (f) { ids.push(u.id); data.push(f.data); }
    }
    if (!ids.length) return { models, unread: 0 };
    // The dictionary (1 MB) and the name map (0.9 MB, 197 576 names) go as their own bytes: an entry's
    // `data` is a view into the 26 MB archive, and a view crosses to a worker with its whole buffer.
    const dict = AcesDB.files.find(f => /\.dict$/i.test(f.name)), nm = AcesDB.files.find(f => /(^|\/)\??nm$/.test(f.name));
    const per = Math.ceil(ids.length / Math.max(1, lanes || 1)), jobs = [];
    for (let s = 0; s < ids.length; s += per) {
      const part = data.slice(s, s + per), offs = new Uint32Array(part.length + 1);
      for (let i = 0; i < part.length; i++) offs[i + 1] = offs[i] + part[i].length;
      const blob = new Uint8Array(offs[part.length]);
      for (let i = 0; i < part.length; i++) blob.set(part[i], offs[i]);
      jobs.push({ blob, offs, dict: dict.data.slice(), dictKey: dict.name, nm: nm.data.slice(), param: "model" });
    }
    let unread = 0, i = 0;
    for (const r of await read(jobs)) {
      unread += r.bad;
      for (const m of r.vals) { const id = ids[i++]; if (typeof m === "string" && m) models.set(id, m); }
    }
    return { models, unread };
  },
  // One lane of ownModels: the root param `a.param` of every BLK entry in `a.blob`, packed end to
  // end (entry i is blob[offs[i], offs[i+1])). It runs in a worker — GameScan.readRoots puts its
  // text in the pool's ops — so it must stay a plain `function` expression that reaches nothing but
  // the ZSTD, BLK and VROMFS sections: no `this`, no closure, no DOM. It is a property here rather
  // than a function of its own because a new top-level name is a new global (CLAUDE.md §5.6). An
  // entry that cannot be read is null and counted in `bad`, never thrown: one unreadable blk costs
  // that one vehicle, not the scan.
  rootParams: function(a){
    const names = vromfsNameMap(a.nm), ddict = Zstd.zstdDict(a.dict, a.dictKey);
    const vals = new Array(Math.max(0, a.offs.length - 1)).fill(null);
    let bad = 0;
    for (let i = 0; i < vals.length; i++) {
      try {
        const db = loadVromfsBlk(a.blob.subarray(a.offs[i], a.offs[i + 1]), names, ddict, true);
        const root = db && db.root;
        if (root) for (let k = 0; k < root.pCount; k++) {
          const p = db.param(root, k);
          if (p.name === a.param) { vals[i] = p.val; break; }
        }
      } catch (e) { bad++; }                  // counted, and said by the scan (GameScan.join)
    }
    return { vals, bad };
  },
  // What each row of a twin group `g` (2 rows or more, buildModelUnitJoin) leads its subtitle with:
  // sets `twin` and `tell` on each. A property here, not a function of its own, for the reason above.
  // Twins: a tank and its skin-pack copy (Leopard 2A4M CAN on leopard_2a4m_can and on
  // leopard_2a4m_can_sm_elsa), the US Radar and SAM rows. Measured in the review of 2026-10-10,
  // with the model last in a subtitle cut to ~10 characters, 13 such groups (29 rows) looked alike.
  // Leading with the whole model is not enough: those two Leopards share their first 16 characters,
  // the Challenger 2 OES pair 21, four cargo ships "cargo_ship_". So each twin leads with its `tell`,
  // its model less the longest start it shares with a sibling that is not merely a longer version of
  // it, backed up to the "_" a word starts at — "…sm_elsa", "…liberty" — and a model that shares no
  // start with a sibling but its own longer versions stays whole ("leopard_2a4m_can").
  // The start the whole GROUP shares was not enough: for the US radars it is "mim_", which left the
  // two Hawks "…23_hawk_radar_cwar" and "…23_hawk_radar_an_mpq46", alike for 15 characters (fix round
  // 2: over the install's rows 2 twin groups led alike in 6 characters; none do now). Should two tells
  // still READ ALIKE, the group falls back to that whole-group start. Two read alike when one's "…"
  // could stand for the other: what it shows is the end of what the other shows, behind a different
  // start. The same text is the plain case ("…cwar" past "fx_radar_" and past "fx_radar_hipir_"); the
  // other cost the pillboxes their nations (pillbox-tell, 2026-10-10): "swe_120mm_coastal_a" and
  // "swe_152mm_coastal_a" share "swe_", so both were cut past it, and "…152mm_coastal_a" read as
  // "us_152mm_coastal_a" beside it — while "…120mm_coastal_a" left "swe_" or "us_" to guess. The four
  // share no start as a group, so they stay whole, as they were before the cut: their first 6
  // characters already differed. Rows that hide the same start do not read alike ("…giftbox_ny" /
  // "…ship_giftbox_ny" both past "flag_ctf_"), so the Radar groups keep their nearest-sibling tells.
  // Over the install's 634 rows whose name repeats (every twin's does), that pillbox was the only row
  // that read alike, and the Pillbox group is the only one whose tells this changed. A group whose start is one row's whole
  // model, shown whole beside "…" and what follows it, backs that start up a word at a time; with no
  // start left every row is whole, and whole models differ. Reversal: fall back on the offending row
  // alone — the 120mm would read "…120mm_coastal_a" again, its nation a guess.
  twinTells(g){
    const shared = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
    const less = (m, cut) => !cut || m.length <= cut ? m : "…" + m.slice(cut).replace(/^_/, "");
    const shows = r => r.tell[0] === "…" ? r.tell.slice(1) : r.tell;      // what the tell shows of its model
    const hides = r => r.model.slice(0, r.model.length - shows(r).length); // the start its "…" stands for
    const alike = () => g.some(r => r.tell[0] === "…" &&
      g.some(o => o !== r && hides(o) !== hides(r) && shows(o).endsWith(shows(r))));
    for (const r of g) {
      const m = r.model, n = Math.max(0, ...g.filter(o => !o.model.startsWith(m)).map(o => shared(m, o.model)));
      r.twin = true; r.tell = less(m, m[n] === "_" || m[n - 1] === "_" ? n : m.lastIndexOf("_", n - 1) + 1);
    }
    if (!alike()) return;
    // the whole-group start: cut after it when every model goes on from it with "_", else at its last "_"
    const p = Math.min(...g.map(r => shared(r.model, g[0].model)));
    let cut = g.every(r => r.model.length === p || r.model[p] === "_") ? p : g[0].model.slice(0, p).lastIndexOf("_") + 1;
    for (;;) {
      for (const r of g) r.tell = less(r.model, cut);
      if (!cut || !alike()) return;
      cut = cut < 2 ? 0 : g[0].model.lastIndexOf("_", cut - 2) + 1;   // a word back; every model shares it
    }
  },
};
// Tag names verified against config/unittags.blk in a live install.
function unitClassOf(tags){
  for (const t of tags) if (/^type_(attack|utility|transport|scout)?_?helicopter$/.test(t)) return "helicopter";
  if (tags.has("tank")) return "tank";
  if (tags.has("ship") || tags.has("boat")) return "ship";
  if (tags.has("air")) return "air";
  return "other";
}
// units.csv rows look like `"<unit>_shop";"F-4E Phantom II";…` — one row per name variant.
function parseUnitsCsv(text){
  const out = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const m = /^"([^"]*)";"([^"]*)"/.exec(lines[i]);
    if (!m) continue;
    const k = /^(.*)_(shop|0|1|2)$/.exec(m[1]);
    if (!k) continue;
    const rec = out.get(k[1]) || { id: k[1] };
    // strip the leading marker glyphs WT uses for premium/squadron/foreign vehicles
    const nm = m[2].replace(/^[^\p{L}\p{N}(]+/u, "").trim();
    if (k[2] === "shop") rec.name = nm || rec.name;
    else if (k[2] === "0") rec.fullName = nm || rec.fullName;
    else if (!rec.name) rec.name = nm;
    out.set(k[1], rec);
  }
  return out;
}
// units_weaponry.csv rows look like `"weapons/su_r_27er";"R-27ER air-to-air missiles";…`, with a
// `/short` sibling ("R-27ER") the loadout screen does not use for the menu. Only the full name is
// kept, keyed lower-case, because a Weapon's `blk` names the file in either case.
function parseWeaponryCsv(text){
  const out = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const m = /^"(weapons\/[^"/]*)";"([^"]*)"/.exec(lines[i]);
    if (m && m[2]) out.set(m[1].toLowerCase(), m[2].trim());
  }
  return out;
}
// config/wpcost.blk carries `rank:i=` for every unit — unittags.blk does not, and aces.vromfs
// (where the per-unit blks live) is dictionary-compressed and unreadable in a browser.
function parseUnitRanks(db){
  const out = new Map();
  for (const c of db.root.children) {
    const id = db.nameOf(c);
    if (!id) continue;
    for (let i = 0; i < c.pCount; i++) {
      const p = db.param(c, i);
      if (p.name === "rank") { out.set(id, p.val | 0); break; }
    }
  }
  return out;
}
// config/shop.blk IS the research tree: country_x { army|aviation|helicopters|ships|boats {
// range { <unit> { rank:i } } } }. That makes it the authority on which nation's tree a vehicle
// actually sits in — a Hungarian Leopard is an Italy-tree vehicle even though its tag is
// country_hungary, and there is no Yugoslavia or Slovakia tree to list.
function parseShopTree(db){
  const unitTree = new Map();
  const trees = [];
  for (const cty of db.root.children) {
    const tag = db.nameOf(cty);
    if (!/^country_/.test(tag)) continue;
    trees.push(tag);
    for (const branch of cty.children) for (const range of branch.children) for (const u of range.children) {
      const id = db.nameOf(u);
      if (id && !unitTree.has(id)) unitTree.set(id, tag);
    }
  }
  return { unitTree, trees };
}
function buildUnitIndex(csvMap, tagsDb, extra){
  extra = extra || {};
  GameUnits.byId.clear();
  for (const [id, rec] of csvMap) {
    if (/_(killstreak|tutorial|dummy)$/.test(id)) continue;
    GameUnits.byId.set(id, { id, name: rec.name || id, fullName: rec.fullName || rec.name || id,
      cls: "other", country: "", countryTag: "", tree: "", rank: 0, key: unitKey(id), norm: unitNormalize(id) });
  }
  if (tagsDb) for (const c of tagsDb.root.children) {
    const id = tagsDb.nameOf(c);
    const u = GameUnits.byId.get(id);
    if (!u) continue;
    const tb = c.children.find(x => tagsDb.nameOf(x) === "tags");
    if (!tb) continue;
    const tags = new Set();
    for (let i = 0; i < tb.pCount; i++) { const p = tagsDb.param(tb, i); if (p.name) tags.add(p.name); }
    u.cls = unitClassOf(tags);
    for (const t of tags) if (UNIT_COUNTRY[t]) { u.country = UNIT_COUNTRY[t]; u.countryTag = t; break; }
    u.tagged = true;
  }
  if (extra.ranks) for (const [id, r] of extra.ranks) { const u = GameUnits.byId.get(id); if (u) u.rank = r; }
  // Tree nation: shop.blk when the unit is listed there, otherwise its country tag mapped to the
  // tree that tag's other vehicles live in (learned from shop.blk itself — no hard-coded table).
  const shop = extra.shop;
  const tagTree = new Map();
  if (shop) {
    const votes = new Map();
    for (const [id, tree] of shop.unitTree) {
      const u = GameUnits.byId.get(id);
      if (!u) continue;
      u.tree = tree;
      if (!u.countryTag) continue;
      const m = votes.get(u.countryTag) || new Map();
      m.set(tree, (m.get(tree) || 0) + 1);
      votes.set(u.countryTag, m);
    }
    for (const [tag, m] of votes) tagTree.set(tag, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  }
  let maxRank = 0;
  for (const u of GameUnits.byId.values()) {
    if (!u.tree) u.tree = tagTree.get(u.countryTag) || (shop && shop.trees.includes(u.countryTag) ? u.countryTag : "");
    if (u.rank > maxRank) maxRank = u.rank;
  }
  GameUnits.maxRank = maxRank;
  GameUnits.nations = (shop ? shop.trees : [...new Set([...GameUnits.byId.values()].map(u => u.tree).filter(Boolean))])
    .map(tag => ({ tag, name: UNIT_COUNTRY[tag] || tag.replace("country_", "") }));
  GameUnits.list = [...GameUnits.byId.values()];
  GameUnits.loaded = GameUnits.list.length > 0;
  return GameUnits.list.length;
}
// model name → candidate units, best first. 100 = same vehicle, 80 = a named variant of it,
// 60/40 = weaker (sub-model or family) matches that need a human decision.
//
// A short name is not a family. `boat_a` loses its class token and reduces to "a", and with no
// floor on the 80 and 60 tiers every unit whose key starts with "a" — 377 of them, the A-20G, the
// Thai A-7E, the A13 Mk I and 61 "air_defence/…" AI guns among them — was joined to a generic boat:
// measured 2026-10-10 on the real install, boat_a carried 126 rows of the vehicle list. The floors
// are the data's: scored against every unit's own blk `model` over the roster (3 454 units whose
// model is installed), 80 needing a key of 2+ characters and 60 one of 4+ (modelsForUnit's floor)
// put 3 025 units on the right model and 121 on a wrong one, where no floor put 3 022 and 185.
// The same floors are in unitsForModelStrong below; the units' own blks settle the 121
// (buildModelUnitJoin), so the name join only speaks for a unit that has none.
function unitsForModel(model){
  if (!GameUnits.loaded || !model) return [];
  const mk = unitKey(model), mn = unitNormalize(model);
  if (!mk) return [];
  const out = [];
  for (const u of GameUnits.list) {
    let score = 0;
    if (u.key === mk) score = 100;
    else if (u.norm.startsWith(mn + "_") && mk.length >= 2) score = 80;
    else if (u.key.startsWith(mk) && mk.length >= 4) score = 60;
    else if (u.key.includes(mk) && mk.length >= 5) score = 40;
    if (score) out.push({ unit: u, score });
  }
  out.sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id));
  return out;
}
// A live install ships ~66 000 model names against ~3 800 units, so joining them by scanning
// every unit for every model is a quarter of a billion string comparisons — eight seconds of
// frozen tab at the end of the folder scan. Every score the join actually keeps (100/80/60) is
// a prefix test, and strings sharing a prefix are contiguous once sorted, so two sorted views
// plus a binary search do the same work in a few hundred milliseconds.
let unitPrefixCache = null;
function unitPrefixIndex(){
  if (unitPrefixCache && unitPrefixCache.src === GameUnits.list) return unitPrefixCache;
  const cmp = f => (a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0);
  return (unitPrefixCache = { src: GameUnits.list,
    byKey: GameUnits.list.slice().sort(cmp("key")),
    byNorm: GameUnits.list.slice().sort(cmp("norm")) });
}
function unitsWithPrefix(arr, field, p){
  const out = [];
  if (!p) return out;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][field] < p) lo = m + 1; else hi = m; }
  for (let i = lo; i < arr.length && arr[i][field].startsWith(p); i++) out.push(arr[i]);
  return out;
}
// The 100 / 80 / 60 half of unitsForModel(), without the per-model scan. The 40 tier is a
// substring test that no index helps with — and the model list join discards it anyway, so
// this returns exactly what `unitsForModel(m).filter(c => c.score >= 60)` returned.
function unitsForModelStrong(model){
  if (!GameUnits.loaded || !model) return [];
  const mk = unitKey(model), mn = unitNormalize(model);
  if (!mk) return [];
  const idx = unitPrefixIndex();
  const best = new Map();
  const bump = (u, s) => { if ((best.get(u) || 0) < s) best.set(u, s); };   // same precedence as the if/else chain
  for (const u of unitsWithPrefix(idx.byKey, "key", mk)) if (u.key === mk || mk.length >= 4) bump(u, u.key === mk ? 100 : 60);
  if (mk.length >= 2) for (const u of unitsWithPrefix(idx.byNorm, "norm", mn + "_")) bump(u, 80);   // floors: see unitsForModel
  const out = [...best].map(([unit, score]) => ({ unit, score }));
  out.sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id));
  return out;
}
// The reverse join, for "this skin is for unit X — which model do I load?"
function modelsForUnit(unitId, modelNames){
  const uk = unitKey(unitId), un = unitNormalize(unitId);
  const out = [];
  for (const m of modelNames) {
    const mk = unitKey(m);
    if (!mk) continue;
    let score = 0;
    if (mk === uk) score = 100;
    else if (un.startsWith(unitNormalize(m) + "_")) score = 80;
    else if (uk.startsWith(mk) && mk.length >= 4) score = 60;
    else if (uk.includes(mk) && mk.length >= 5) score = 40;
    if (score) out.push({ model: m, score });
  }
  out.sort((a, b) => b.score - a.score || a.model.length - b.model.length);
  return out;
}
// Join every extractable model to the real vehicles that use it, so the list can be shown by
// vehicle name and the export can write correctly-named .blk files. `own` is GameDB.ownModels (unit
// id → the model its own blk names, null if unread): such a unit goes on that model and no other, and
// on none at all when that model is not in this install's list (the 20 h_75a_*, lagg_3_* and
// friends on 2026-10-10 — the name join would put them on another aircraft's model, which is the
// bug this replaced). Only a unit with no blk is placed by name.
//
// Until 2026-10-10 the name join decided every row, and measured on the real install it put 185 of
// the 3 454 units whose own model is installed on the wrong one — the Leopard I on frigate_leopard,
// the Centurion Mk 1 on battleship_centurion, the Kurnass 2000 on f_4e although kurnass_2000 is
// installed — and 126 rows on boat_a. Moved here from game/scan.js so the page's own join can be
// run under Node against the install (tools/t138_join.mjs).
function buildModelUnitJoin(own){
  GameDB.modelUnits = new Map();
  GameDB.unitModel = new Map();
  GameDB.vehicleRows = [];
  if (!GameUnits.loaded) return;
  const modelSet = new Set(GameDB.models);
  if (own) for (const [id, m] of own)
    if (GameUnits.byId.has(id)) GameDB.unitModel.set(id, { model: modelSet.has(m) ? m : null, score: 100, own: true });
  for (const m of GameDB.models) {
    const cands = unitsForModelStrong(m);              // score >= 60, without the O(units) scan
    if (!cands.length) continue;
    GameDB.modelUnits.set(m, cands);
    for (const c of cands) {
      // a unit belongs to the most specific model that claims it — unless its own blk has spoken
      const prev = GameDB.unitModel.get(c.unit.id);
      if (prev && prev.own) continue;
      if (!prev || c.score > prev.score || (c.score === prev.score && m.length > prev.model.length))
        GameDB.unitModel.set(c.unit.id, { model: m, score: c.score });
    }
  }
  // One row per vehicle the list can tell apart. Units that share their name, model, research tree,
  // operator, rank and class draw the same row and load the same thing, so they are ONE row that
  // carries every unit id (`units`, the shortest id first as `unit`): f-4e, f_4e_event and nt_f_4e
  // were three "F-4E Phantom II · Rank VII · USA · f_4e" rows. Any two rows left differ in
  // something the row shows — the model at the end of its subtitle, most often. Decided 2026-10-10;
  // the measurement is in tools/t138_join.mjs. Reversal: push one row per unit again.
  const rows = new Map();
  for (const [unitId, ref] of GameDB.unitModel) {
    const u = GameUnits.byId.get(unitId);
    if (!u || !ref.model || !modelSet.has(ref.model)) continue;
    const k = [u.name, ref.model, u.tree, u.countryTag, u.rank, u.cls].join("\n");
    const row = rows.get(k);
    if (row) row.units.push(u);
    else rows.set(k, { unit: u, units: [u], model: ref.model, score: ref.score });
  }
  // Rows that share everything the row shows before its model — name, class, rank, research tree and
  // operator — are `twin`s, and each leads its subtitle with a `tell` (GameUnits.twinTells).
  const look = new Map();
  for (const row of rows.values()) {
    row.units.sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
    row.unit = row.units[0];
    GameDB.vehicleRows.push(row);
    const u = row.unit, k = [u.name, u.cls, u.rank, u.tree, u.countryTag].join("\n");
    if (look.has(k)) look.get(k).push(row); else look.set(k, [row]);
  }
  for (const g of look.values()) if (g.length > 1) GameUnits.twinTells(g);
  GameDB.vehicleRows.sort((a, b) => a.unit.name.localeCompare(b.unit.name));
}

/*==ENDREGISTRY==*/
