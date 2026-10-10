// The pool the search box works over: every model any weapon blk in the game names. That is an
// exact set now, which is what removed the old "which .grp holds ordnance" heuristic.
async function buildWeaponPool(){
  if (WeaponDB.ready) return true;
  await ensureAces();
  const idx = await ensureGrpIndex();
  const named = new Set();
  if (AcesDB.ready) for (const f of AcesDB.files) {
    if (!/^gamedata\/weapons\/.*\.blk$/i.test(f.name)) continue;
    const db = acesBlk(f.name);
    if (!db || !db.root) continue;
    const p = blkParams(db, db.root);
    if (typeof p.mesh !== "string") continue;
    for (const m of p.mesh.split(",")) { const n = m.trim(); if (n && idx.dyn.has(n)) named.add(n); }
  }
  WeaponDB.pool = named.size ? [...named] : [...idx.dyn.keys()];
  WeaponDB.keys.clear(); WeaponDB.df.clear();
  for (const n of WeaponDB.pool) {
    const k = weapKeys(n);
    WeaponDB.keys.set(n, k);
    for (const t of k) WeaponDB.df.set(t, (WeaponDB.df.get(t) || 0) + 1);
  }
  WeaponDB.ready = true;
  return true;
}
const WEAP_NATION = new Set(["us","ussr","germ","de","uk","br","jp","cn","ch","it","fr","sw","il","in","czech","china","ger","su","usa","rus"]);
const WEAP_NOISE = new Set(["left","right","wing","fuse","fuselage","air","na","dummy","inner","outer",
  "centre","center","central","early","late","new","old","mount","lb","kg","type"]);
function weapWords(s){ return String(s).toLowerCase().replace(/\.blk$/, "").split(/[^a-z0-9]+/).filter(Boolean); }
// Designators are written both ways - aim9e and aim_9e, mk82 and mk_82 - so every adjacent pair
// of words is also offered joined. That is what lets "aim9e" find us_aim_9e_sidewinder while
// keeping it away from us_aim_7e, which a tokeniser that split letters from digits could not do.
function weapKeys(s){
  const w = weapWords(s).filter(t => !WEAP_NATION.has(t) && !WEAP_NOISE.has(t));
  const out = new Set(w);
  for (let i = 0; i < w.length - 1; i++) out.add(w[i] + w[i + 1]);
  return out;
}
function weapIdf(t){ return Math.log(1 + WeaponDB.pool.length / (1 + (WeaponDB.df.get(t) || 0))); }
const WEAP_PENAL = /(_|^)(xray|dmg|dead|destroyed|dstr|collision|fx)(_|$)|_deployed$|_na$/;
// Fuzzy name search, for finding a store by hand ("mk 82", "pylon", "drop tank"). Loadouts do
// not go through this any more — only what the user types does.
function matchWeaponModels(query, limit){
  const q = weapKeys(query);
  if (!q.size || !WeaponDB.pool.length) return [];
  let qW = 0;
  for (const t of q) qW += weapIdf(t);
  const out = [];
  for (const m of WeaponDB.pool) {
    const B = WeaponDB.keys.get(m);
    let inter = 0, mW = 0;
    for (const t of B) { mW += weapIdf(t); if (q.has(t)) inter += weapIdf(t); }
    if (!inter) continue;
    // how much of what was asked for is explained, tempered by how much of the model name is not
    let s = (inter / qW) * (0.62 + 0.38 * (inter / mW));
    if (WEAP_PENAL.test(m)) s *= 0.5;
    out.push({ model: m, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit || 5);
}
// Which unit the armament panel is talking about. The vehicle's own gamedata file is preferred,
// and its `model` field confirms the unit really is the model on screen.
function armamentForCurrentUnit(){
  const ids = [];
  const push = s => { const v = String(s || "").trim().toLowerCase(); if (v && !ids.includes(v)) ids.push(v); };
  push($("vehicleId").value);
  for (const u of (App.skinUnits || [])) if (u.on) push(u.unit.id);
  if (App.vehicleKey) for (const c of unitsForModelStrong(App.vehicleKey)) push(c.unit.id);
  for (const id of ids) {
    const arm = unitArmament(id);
    if (arm && arm.slots.length) return { unit: id, arm };
  }
  return { unit: ids[0] || null, arm: null };
}
