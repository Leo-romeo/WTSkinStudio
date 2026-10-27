// ---------- Which real vehicles this skin installs onto ----------
// A .blk is picked up by *unit* name, which is rarely the model's name (model f_4e →
// f-4e.blk; model m1a2_sep3 → us_m1a2_sep3_abrams.blk). Several vehicles routinely share one
// model, so the user gets the full list with the confident matches pre-ticked.
function refreshSkinUnits(model){
  App.skinUnits = [];
  const cands = model ? unitsForModel(model) : [];
  // Every unit whose own blk names this model belongs here whatever its name says: against
  // kurnass_2000, f-4e_kurnass_2000 scores 40 by name and nt_f_4e nothing at all against f_4e. The
  // scan read those blks for the vehicle list (GameDB.unitModel, game/registry.js), so they are
  // looked up there rather than guessed; such a unit enters with a name score of 0.
  if (model && GameDB.unitModel) for (const [id, ref] of GameDB.unitModel)
    if (ref.own && ref.model === model && GameUnits.byId.has(id) && !cands.some(c => c.unit.id === id))
      cands.push({ unit: GameUnits.byId.get(id), score: 0 });
  for (const c of cands) {
    // Score 80 means "the NAME starts with this model's name", which is a guess. The unit's own blk
    // names its model, and that is not a guess — so a unit flying a *different* model is listed but
    // not pre-ticked: its textures are its own, and a skin painted here cannot cover it. Loading
    // `f_4e` used to arrive with f-4ej, f-4ej_kai, f-4e_iaf and f-4e_kurnass_2000 already ticked,
    // and every .blk written for them named a texture their aircraft does not have.
    // `null` means the lookup could not run at all — no scan, no unit blk — and then the old
    // behaviour stands, because a check that could not run must not narrow anything (§0.3).
    const own = modelForUnit(c.unit.id);
    const sameModel = own === null ? null : own === model;
    // A unit whose blk names this model IS this model's vehicle — "exact" and ticked, whatever its
    // name scored (the Kurnass 2000 loaded on its own model used to arrive unticked, as "related").
    if (!sameModel && c.score < 40) continue;
    App.skinUnits.push({ unit: c.unit, score: sameModel ? 100 : c.score, nameScore: c.score, model: own, sameModel,
      on: sameModel === true || (c.score >= 80 && sameModel === null) });
  }
  // The first ticked unit names the .blk, the Vehicle field, the rank and the class, so the unit the
  // model is named for leads its event and hidden copies: f-4e, then f_4e_event, then nt_f_4e. When
  // the names cannot tell — units only their blks place score 0 by name — a ranked vehicle leads an
  // unranked copy and a real class leads "other": loading m4a2_sherman_1944 led with us_m4a2_1944
  // (no rank, class other) by id order, ahead of the Rank II us_m4a2_sherman (review of 2026-10-10).
  const ranked = s => s.unit.rank ? 1 : 0, real = s => s.unit.cls !== "other" ? 1 : 0;
  App.skinUnits.sort((a, b) => b.score - a.score || b.nameScore - a.nameScore || ranked(b) - ranked(a) ||
    real(b) - real(a) || a.unit.id.localeCompare(b.unit.id));
  if (!App.skinUnits.length && model) App.skinUnits.push({ unit: { id: model, name: model, cls: "other", country: "" }, score: 0, on: true, fallback: true });
  renderUnitList();
  refreshVehicleIdLock();
  updateBrushAvailability();
}
// Which kind of vehicle this is — it decides the export mode (`set_tex`+camo_skin_tex for
// ground/naval vs `replace_tex` for aircraft), whether the wear/coverage brush is offered, and
// the part-grouping rules. The unit registry answers it when a unit is ticked; when nothing is
// (a raw .obj, a model the name join could not place, a vehicle the user unticked) it used to
// fall through to "air" as soon as any geometry was loaded — so a tank with no matched unit was
// silently treated as an aircraft: no wear mask, and the wrong half of the .blk on export. The
// shape of the model itself is the better answer, and `guessModelKind` already reads it off the
// part names. It calls back into here, hence the guard.
let inVehicleClass = false;
function vehicleClass(){
  const on = (App.skinUnits || []).filter(u => u.on);
  const cls = on.length ? on[0].unit.cls : "other";
  if (cls !== "other") return cls;
  if (!App.geomData) return cls;
  if (App.modelKind) return App.modelKind;
  if (inVehicleClass) return "air";
  inVehicleClass = true;
  try { return guessModelKind(); } finally { inVehicleClass = false; }
}
function renderUnitList(){
  const el = $("unitList");
  // The vehicle list lights exactly the ticked units; it listens for this (ui/panels/game-list.js),
  // because ui/ loads after export/ and a call from here would reach up a layer (CLAUDE.md §2).
  el.dispatchEvent(new Event("skinunits"));
  el.innerHTML = "";
  const list = App.skinUnits || [];
  if (!list.length) { el.className = "hint"; el.textContent = "Load a vehicle to see which in-game vehicles this skin covers."; $("unitCount").textContent = "—"; updateExportWarnings(); return; }
  el.className = "";
  el.style.cssText = "max-height:168px;overflow-y:auto";
  const anyWeak = list.some(u => u.score < 80);
  const anyOther = list.some(u => u.sameModel === false);
  for (const rec of list) {
    const row = document.createElement("label");
    row.className = "rowitem partrow";
    row.style.cssText = "gap:6px;cursor:pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = rec.on;
    cb.onchange = () => { rec.on = cb.checked; renderUnitList(); };
    const nm = document.createElement("span");
    nm.style.cssText = "flex:1;display:flex;align-items:center;gap:5px;overflow:hidden;white-space:nowrap" + (rec.on ? ";color:var(--text)" : "");
    const nmTxt = document.createElement("span");
    nmTxt.style.cssText = "overflow:hidden;text-overflow:ellipsis";
    nmTxt.textContent = rec.unit.name + (rec.unit.rank ? " · " + (RANK_ROMAN[rec.unit.rank] || rec.unit.rank) : "");
    nm.append(classIcon(rec.unit.cls), nmTxt);
    nm.title = rec.unit.id + ".blk" + (nationName(rec.unit) ? " · " + nationName(rec.unit) : "") +
      (rec.sameModel === false
        ? " — flies “" + rec.model + "”, not this model. Its textures are its own, so a skin painted " +
          "here cannot cover it; it needs its own skin, painted on that aircraft."
        : rec.score >= 100 ? " — same vehicle" : rec.score >= 80 ? " — variant of the same model"
        : rec.score ? " — related, check before enabling" : " — no unit data, using the model name");
    const tag = document.createElement("span");
    tag.style.cssText = "font-size:11px;color:var(--muted);flex:0 0 auto";
    tag.textContent = rec.sameModel === false ? "other model"
      : rec.score >= 100 ? "exact" : rec.score >= 80 ? "variant" : rec.score ? "related" : "raw";
    row.append(cb, nm, tag);
    el.appendChild(row);
  }
  const n = list.filter(u => u.on).length;
  $("unitCount").textContent = n + " of " + list.length;
  refreshVehicleIdLock();
  // One line each, the whole note in its tooltip (ROADMAP 3.44).
  if (anyOther)
    el.appendChild(Tip.make("div", "hint", "“other model”: its own textures, so it is left off.",
      "“other model” entries share the name but fly a different aircraft with its own textures — " +
      "a skin painted here cannot cover them, so they are left off. Tick one only if you know the two share a sheet."));
  if (anyWeak)
    el.appendChild(Tip.make("div", "hint", "“related”: tick only the ones you mean.",
      "“related” entries share part of the name but may be a different vehicle — tick only the ones you mean."));
  updateExportWarnings();
}
function selectedUnits(){
  const on = (App.skinUnits || []).filter(u => u.on).map(u => u.unit.id);
  return on.length ? on : [($("vehicleId").value.trim() || App.objName || "vehicle")];
}
// ---------- Which textures does THIS unit's vehicle actually have? ----------
// A model routinely serves several units, so one skin covers a family — but "family" is a guess
// made from the unit's NAME, and the game does not care about names. Loading `f_4e` pre-ticks
// f-4ej, f-4ej_kai, f-4e_iaf and f-4e_kurnass_2000, and every one of those flies a *different*
// model with a *different* albedo: f_4ej_c, f_4ej_kai_c, f_4e_iaf_c, kurnass_2000_c. Five of the
// seven .blk files written for that family said `from:"f_4e_c*"`, which matches nothing on those
// aircraft, so the skin silently did nothing. Reported 2026-08-23.
//
// The unit's own blk names its model, and dynModelDesc names that model's textures — both
// authoritative, both already loaded (CLAUDE.md §1: the desc beats name heuristics). So the answer
// is looked up rather than guessed.
//
// Remapping the stem instead — writing `from:"f_4ej_c*"` and shipping the same pixels — was
// measured and rejected: matching a parent material to its counterpart on a variant works for only
// 6.2 % of sheets across the roster, because material naming is not consistent between variants.
// A wrong remap would put a skin on the wrong sheet, which is worse than not writing the line.
const unitModelCache = new Map();
function modelForUnit(unitId){
  if (unitModelCache.has(unitId)) return unitModelCache.get(unitId);
  let model = null;
  try { const arm = unitArmament(unitId); if (arm && arm.model) model = arm.model; }
  catch (e) { model = null; }                      // no unit blk (imported .obj, unmatched name)
  unitModelCache.set(unitId, model);
  return model;
}
// Every texture stem the unit's vehicle uses, or null when it cannot be established — an imported
// .obj, a game folder that was never scanned, a model missing from the desc. Null means "no
// opinion", and every caller must then leave the export exactly as it was: the manual path is the
// permanent escape hatch (CLAUDE.md §0.3) and must never be narrowed by a check that could not run.
function stemsForUnit(unitId){
  const model = modelForUnit(unitId);
  if (!model || !GameDB.desc) return null;
  const bind = descBindFor(model);
  if (!bind) return null;
  const out = new Set();
  for (const [, v] of bind.map) { if (v.c) out.add(v.c); if (v.n) out.add(v.n); }
  return out.size ? out : null;
}
// Split the exported items into the ones this unit's vehicle can use and the ones it cannot.
function itemsForUnit(unitId, items){
  const stems = stemsForUnit(unitId);
  if (!stems) return { keep: items, drop: [], known: false };
  const keep = [], drop = [];
  // A camouflage tile replaces no sheet of its own — its pins do the naming — so it goes with every unit.
  for (const it of items) (it.camoTile || stems.has(it.fromStem) ? keep : drop).push(it);
  return { keep, drop, known: true };
}
function exportMode(){
  const m = $("expMode").value;
  if (m !== "auto") return m;
  const cls = vehicleClass();
  // Per the CDK: ground vehicles must use set_tex + camo_skin_tex so in-game decals and the
  // condition wear keep working; aircraft can only take a fixed skin via replace_tex.
  return (cls === "tank" || cls === "ship") ? "set_tex" : "replace_tex";
}

// ---------- The Vehicle field is a lock, not a text box ----------
// It is the fallback name for the .blk when no unit is ticked, and CLAUDE.md §1 is unforgiving
// there: the filename must be the in-game UNIT id, exactly, including case. A typo produces a skin
// that installs, looks fine in the folder, and is never found by the game — the same silent
// failure as ROADMAP 4.7, and just as hard to diagnose. Meanwhile, whenever units ARE ticked the
// field is not used at all, so it looked like it controlled the export and usually did nothing.
//
// So it is not typed into by default and the ✎ button unlocks it, once, after saying what the risk
// is. That exact shape was requested 2026-08-23: keep the escape hatch, make it
// deliberate. (It was `readOnly` when this was written; see the next paragraph for why it is not.)
//
// ROADMAP 3.10 finished the shape. `readOnly` + `opacity:.6` was the wrong *widget*, not the wrong
// rule: a read-only input still takes focus and still shows a caret, so it goes on inviting the
// typing it will not accept, and dimming it reads as "disabled, something is missing" rather than
// "decided". So the settled state is a plain <span> — a statement of fact, with the ✎ beside it —
// and the <input> appears only when it is genuinely the .blk name (nothing ticked, which is also
// the case where it may hold a MODEL name that will not work) or when ✎ has been used.
//
// The <input> is never removed, only hidden: every reader in the app asks it for `.value`, and one
// value with two presentations is what keeps that true. This function is the only thing that
// writes the span, so call it after assigning `$("vehicleId").value`.
let vehicleIdUnlocked = false;
function refreshVehicleIdLock(){
  const inp = $("vehicleId"), txt = $("vehicleIdText"), btn = $("btnVehicleIdEdit");
  if (!inp || !txt || !btn) return;
  const ticked = (App.skinUnits || []).filter(u => u.on).length;
  const settled = !vehicleIdUnlocked && ticked > 0;
  txt.textContent = inp.value || "—";
  txt.style.display = settled ? "" : "none";
  inp.style.display = settled ? "none" : "";
  inp.readOnly = false;                           // it is only ever on screen when it is editable
  inp.style.opacity = "";
  txt.title = "Taken from the vehicle you loaded. While vehicles are ticked in “Installs onto”, the .blk files "
    + "are named after THOSE, and this name is not used — press ✎ if you need to set it yourself.";
  inp.title = ticked
    ? "Unlocked. This is not used while vehicles are ticked below; untick them all to make it the .blk name."
    : "The name the .blk file gets. It must be the in-game unit id exactly — a wrong one installs fine and is "
      + "never found by the game.";
  btn.style.display = ticked ? "" : "none";       // nothing to protect when it IS the only source
  // The button carries its own state instead of swapping to a lock emoji (§4: icons are never
  // emoji), which is exactly what `.active` is for now that ROADMAP 3.14 made it visible.
  btn.classList.toggle("active", vehicleIdUnlocked);
  btn.title = vehicleIdUnlocked ? "Lock the vehicle name again" : "Let me type the vehicle name myself";
}
// Typing has to reach the span, or re-locking would show the value from before the edit.
$("vehicleId").addEventListener("input", refreshVehicleIdLock);
// And once at load, so an empty app agrees with the table above: nothing is ticked, so this IS the
// .blk name, so it is a field — and the ✎ has nothing to protect and should not be on screen. The
// markup cannot state that on its own, and before this the button was simply always there until the
// first vehicle loaded. Safe as a top-level call: `$` and `App` are both declared above this file
// in `src/index.html`'s order, and `App.skinUnits` being undefined is what `|| []` is for.
refreshVehicleIdLock();
$("btnVehicleIdEdit").onclick = async () => {
  if (vehicleIdUnlocked) { vehicleIdUnlocked = false; refreshVehicleIdLock(); setStatus("Vehicle name locked again", "ok"); return; }
  const go = await choiceDialog(
    "The .blk file has to be named after the in-game vehicle, exactly — that is how War Thunder finds a skin.\n\n" +
    "This field is filled in from the vehicle you loaded, and while anything is ticked under “Installs onto” it is " +
    "not used at all: those units name the files instead.\n\n" +
    "A wrong name here produces a skin that copies into UserSkins, looks correct in the folder, and is silently " +
    "never loaded by the game. Only change it if you know the exact unit id you want.",
    [{ label: "Let me edit it", value: "go" }, { label: "Leave it alone", value: "no", primary: true }]);
  if (go !== "go") return;
  vehicleIdUnlocked = true;
  refreshVehicleIdLock();
  $("vehicleId").focus();
  $("vehicleId").select();
  setStatus("Vehicle name unlocked — it must match the in-game unit id exactly, including case", "err");
};
