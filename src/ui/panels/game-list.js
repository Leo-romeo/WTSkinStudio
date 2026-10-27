// ---------- The vehicle list: one of the two lists under the search (ROADMAP 3.5) ----------
// The box, the chips and the sort are `Finder`'s (ui/panels/finder.js); what is here is what a
// vehicle row IS to that control — `VehicleList` — and how a row is drawn.
$("gameQuality").onchange = () => renderGameSearch();
// The tree a vehicle is researched in ("Britain" for an Australian Abrams), with the actual
// operator shown after it when they differ — that is what the in-game list looks like.
function nationName(u){
  if (!u) return "";
  const tree = u.tree ? (UNIT_COUNTRY[u.tree] || u.tree.replace("country_", "")) : "";
  if (tree && u.country && u.country !== tree) return tree + " (" + u.country + ")";
  return tree || u.country || "";
}
function tierLabel(en){ return en.w + "×" + en.h + (en.tier === "base" ? "" : " " + en.tier); }
// One row per vehicle. The whole row is the button — the old version showed a grey label
// whose only obvious control was the (rarely wanted) OBJ download, which read as "not clickable".
function vehicleRow(rec){
  const model = rec.model, u = rec.unit;
  const row = document.createElement("div");
  row.className = "rowitem" + (VehicleList.picked(rec) ? " sel" : "");
  row._rec = rec;                                    // VehicleList.mark re-reads it when the ticks change
  const ico = document.createElement("span");
  ico.className = "ico";
  ico.appendChild(classIcon(u ? u.cls : "other"));
  const txt = document.createElement("div");
  txt.className = "txt";
  const t1 = document.createElement("div");
  t1.className = "t1";
  t1.textContent = u ? u.name : model;
  const t2 = document.createElement("div");
  t2.className = "t2";
  // A twin — a row that shows the same name, class, rank and nation as another (game/registry.js) —
  // leads with its `tell`, the part of its model the others do not share, because that is the one
  // thing that tells them apart in a subtitle cut short; the whole model is in the row's hover label.
  const rank = u && u.rank ? "Rank " + (RANK_ROMAN[u.rank] || u.rank) : "";
  t2.textContent = !u ? "model" : (rec.tell ? [rec.tell, rank, nationName(u)] : [rank, nationName(u), model]).filter(Boolean).join(" · ");
  txt.append(t1, t2);
  // The name has the row's width to itself (review of 2026-10-10). Every name was cut to 4-7
  // characters — "F-4E Ph…", "Kurnass…" — because it got 53 px of a 191 px row (47 once the column
  // scrolls) and names need 73-114: a "Load ▸" label that showed only on hover still took 36 px and
  // a gap, and a flag repeated the nation the second line already names. Both are gone; the name has
  // 125 px, 119 while the column scrolls. What they said is in the hover label: it starts "Load", and its second line is the rank
  // and the nation in full, which a subtitle cut short no longer has to carry.
  // The download icon is drawn (CLAUDE.md §4) rather than the "⤓" glyph, and its colour is set in the
  // stylesheet: the muted colour at opacity .55 measured 2.4:1 and read as a disabled control.
  const more = document.createElement("button");
  more.className = "more";
  const dl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  dl.setAttribute("viewBox", "0 0 16 16");
  dl.setAttribute("class", "vico");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("d", "M8 2.4 V10 M4.7 6.8 L8 10.1 L11.3 6.8 M2.8 11.2 V13.4 H13.2 V11.2");
  dl.appendChild(arrow);
  more.appendChild(dl);
  more.title = "Download this model as OBJ + MTL + textures (.zip) without loading it into the editor";
  more.setAttribute("aria-label", "Download as OBJ (.zip)");
  more.onclick = ev => { ev.stopPropagation(); exportVehicleOBJ(model); };
  row.append(ico, txt, more);
  const facts = u ? [rank, nationName(u)].filter(Boolean).join(" · ") : "";
  row.title = "Load " + (u ? u.name + " (" + model + ")" : model) + " — model geometry and its correct textures" + (facts ? "\n" + facts : "");
  row.onclick = () => loadVehicleModelPrompt(model);
  return row;
}
// One row for an individual texture: add (bind by name), →slot (apply to active slot) or save.
function textureRow(rec, quality){
  const en = pickVariant(rec, quality);
  if (!en) return null;
  const usable = en.supported && en.size;
  const row = document.createElement("div");
  row.className = "rowitem partrow";
  const nm = document.createElement("span");
  nm.textContent = rec.stem;
  // A texture nothing of which opens is described by the tier that HOLDS it — the rule its slot and a
  // vehicle's load use (GameDB.unreadOf). pickVariant hands back the first tier listed, and for 2 924
  // of the 2 948 such textures on the live install that is a 0×0 $hq stub ahead of the base sheet,
  // so their rows said "no data ✕" under a summary saying they decompress fine (review of 2026-10-10).
  const shown = usable ? en : (GameDB.unreadOf(rec) || en);
  // The format by its name — "L8", not "2", which is what its Direct3D number printed as (2026-10-10).
  const fmt = GameDB.fmtName(shown);
  nm.title = tierLabel(shown) + " " + fmt + " · " + shown.compName + (usable ? "" : " — " + Oodle.entryBlockReason(shown));
  nm.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" + (usable ? "" : ";opacity:.4");
  row.appendChild(nm);
  const tag = document.createElement("span");
  tag.style.cssText = "font-size:11px;color:var(--muted);flex:0 0 auto";
  tag.textContent = usable ? en.w + (en.tier !== "base" ? "·" + en.tier : "") : (shown.size ? fmt || shown.compName : "no data") + " ✕";
  row.appendChild(tag);
  if (usable) {
    const bAdd = document.createElement("button");
    bAdd.textContent = "add"; bAdd.title = "Decode and add under its own name — auto-binds to matching materials";
    bAdd.style.cssText = "padding:0 6px;font-size:11px;flex:0 0 auto";
    bAdd.onclick = () => loadGameEntry(en, false);
    const bSlot = document.createElement("button");
    bSlot.textContent = "→slot"; bSlot.title = "Replace the ACTIVE slot's base with this texture (how you apply any stock camo)";
    bSlot.style.cssText = "padding:0 6px;font-size:11px;flex:0 0 auto";
    bSlot.onclick = () => loadGameEntry(en, true);
    // The texture as a file of its own (ROADMAP 4.59): the game's .dds, or level 0 as PNG / TGA.
    const bSave = document.createElement("button");
    bSave.textContent = "save"; bSave.title = "Save this texture as a file — the game's own .dds, or as an image (PNG / TGA)";
    bSave.style.cssText = "padding:0 6px;font-size:11px;flex:0 0 auto";
    bSave.onclick = () => OneTex.fromSearch(en);
    row.append(bAdd, bSlot, bSave);
  }
  return row;
}
// What a vehicle row is to the search control: `Finder.rank` asks every list the same three things.
const VehicleList = {
  // With no unit registry (aces could not be read) the rows are bare model ids — up to 66 000 of
  // them — built once per model table rather than on every keystroke, so their cached keys survive.
  rows(){
    if (GameDB.vehicleRows && GameDB.vehicleRows.length) return GameDB.vehicleRows;
    const c = VehicleList._bare;
    if (c && c.src === GameDB.models) return c.rows;
    const rows = GameDB.models.map(m => ({ unit: null, model: m }));
    VehicleList._bare = { src: GameDB.models, rows };
    return rows;
  },
  // A vehicle is found by its display names, its unit id and its model; the operator and the
  // research tree count as words, so "usa" lists the US vehicles and "britain" finds the Australian
  // Abrams, which sits in that tree. A bare model is its key and nothing else.
  // A row that stands for several units (f-4e, f_4e_event and nt_f_4e are one F-4E row — the join
  // merges what the list cannot tell apart) is found by every one of their ids and names: a merged
  // copy is often known by its full name alone — "Lanovski" found Lanovski's P-47M-1-RE as a row of
  // its own, and nothing once it was merged into Bostwick's (review of 2026-10-10).
  score(q, r){
    const u = r.unit;
    if (!u) return Match.keyScore(q, Match.of(r, x => Match.key(x.model)));
    return Match.score(q, Match.of(r, x => Match.record([u.name, u.fullName, u.id, x.model,
      ...(x.units || []).filter(v => v !== u).flatMap(v => [v.name, v.fullName, v.id])], [u.country, nationName(u)])));
  },
  // A row is highlighted when the skin is for one of its units — the ones ticked under Export ▸
  // Vehicles — and not because it shares the loaded model: loading the F-4E lit the F-4E, its event
  // copy and the Kurnass 2000 (then on f_4e by name), which read as three vehicles picked at once
  // (review of 2026-10-10). A list with no unit registry has only models, so there it is the model.
  picked(rec){
    if (!App.vehicleKey) return false;
    if (!rec.unit) return rec.model === App.vehicleKey;
    const on = (App.skinUnits || []).filter(s => s.on && s.unit);
    return (rec.units || [rec.unit]).some(u => on.some(s => s.unit.id === u.id));
  },
  // Ticking or unticking a vehicle changes which rows are the skin's; the rows already drawn are
  // re-marked in place rather than redrawn, so the list keeps its scroll and its loaded chunks.
  mark(){
    for (const row of $("gameList").children) if (row._rec) row.classList.toggle("sel", VehicleList.picked(row._rec));
  },
  passes(r){ return !Finder.filtered() || Finder.unitPasses(r.unit); },
  // Best match with nothing typed is the in-game trees' order — nation, then rank, then name —
  // because sorting by name alone put a rank I biplane between two rank VII jets. Typed, a tie in
  // score is broken by name, which is what the old exact/prefix float did.
  order(sort, typed){
    const nm = r => r.unit ? r.unit.name : r.model;
    const byName = (a, b) => nm(a).localeCompare(nm(b));
    if (sort === "name" || (sort === "best" && typed)) return byName;
    const tree = Finder.treeCmp();
    if (sort === "rank") {
      // Highest rank first. Rank I first was the tree's own start (USA rank I, then the next nation's),
      // so on the real install Rank, Tree order and Best match showed the same first screen and the
      // sort read as touching only the skins (reported 2026-10-10). A unit with no rank — a radar, a
      // SAM, an AI gun, the C-47 — is not rank 0: it goes after every ranked vehicle (it led every
      // nation, review of 2026-10-10), and a bare model after that.
      const rk = r => r.unit ? r.unit.rank || -1 : -2;
      return (a, b) => rk(b) - rk(a) || tree(a.unit, b.unit) || byName(a, b);
    }
    return (a, b) => tree(a.unit, b.unit) || byName(a, b);
  },
  // Raw texture hits, by key: exact, prefix, then contains, then by name. Separators do not count
  // here either, so "f-4e" finds f_4e_body_c. The keys are kept beside the stem table and rebuilt
  // when it is replaced, rather than one WeakMap entry per record: the table is replaced whole on
  // every scan, and 70 000 entries cost more than one array. "Replaced" is load-bearing — a table
  // cleared and refilled in place with the same count would keep these keys and the last scan's
  // records, which is why GameScan.reset makes a new Map (the review of 2026-09-27; t96 holds it).
  stems(q){
    const t = GameDB.stems;
    let c = VehicleList._stems;
    if (!c || c.src !== t || c.n !== t.size) {
      const recs = [...t.values()];
      c = VehicleList._stems = { src: t, n: t.size, recs, keys: recs.map(r => Match.key(r.stem)) };
    }
    const hits = [];
    for (let i = 0; i < c.recs.length; i++) { const s = Match.keyScore(q, c.keys[i]); if (s) hits.push([c.recs[i], s]); }
    hits.sort((a, b) => b[1] - a[1] || a[0].stem.localeCompare(b[0].stem));
    return hits.map(h => h[0]);
  },
  none(el, q){
    el.className = "emptyhint";
    el.innerHTML = q
      ? "No matches for <b>" + escHtml($("gameSearch").value.trim()) + "</b>.<br>Try part of the in-game name, or the model's id."
      : "Nothing in this nation / rank / class combination.<br>Widen the filters or type a name.";
  },
};
// The unit list (export/units.js) says when the ticks change, rather than calling in here: it loads
// before ui/ (CLAUDE.md §2), and there is no event surface yet (ROADMAP 2.5) — so the event rides
// on its own element.
$("unitList").addEventListener("skinunits", () => VehicleList.mark());
// The vehicles first, then — only when something is typed — the vehicles the chips leave out, then
// raw textures. A pane that is a hint rather than a list is `.empty`, which takes it out of the
// flexing share (ROADMAP 3.6): a pane the height of the tab around one line of text is worse than
// no pane — the rule 3.27 made for a fixed box, kept for a flexing one.
//
// History this function carries: 3.28(3) had made a filter with nothing typed show a hint instead
// of opening the list; that was reversed on 2026-09-25 (3.38) — the vehicle search should list
// vehicles even with nothing typed — because a box that stays empty until you
// already know a name gives no way to browse. So nothing typed lists every vehicle the chips let
// through, and a chip visibly narrows the list, which is its own answer to "what did that click do".
function renderGameSearch(){
  const el = $("gameList"), wrap = $("gameListWrap");
  el.className = ""; el.innerHTML = "";
  Finder.stop(el);
  wrap.classList.add("empty");
  if (!GameDB.stems.size && !GameDB.models.length) { el.className = "emptyhint"; el.textContent = "No game data indexed yet"; return; }
  refreshGameDiagnostics();
  const q = Finder.query(), quality = $("gameQuality").value;
  // The texture mode still wants text (3.38): listing 70 000 sheets is not browsing.
  if (GameFilter.tex && !q) { el.className = "emptyhint"; el.textContent = "Type part of a texture's name."; return; }
  const { inside, outside } = GameFilter.tex ? { inside: [], outside: [] } : Finder.rank(VehicleList.rows(), VehicleList);
  // Raw textures come after every vehicle, chips or not. They used to be hidden whenever a type chip
  // was lit — the same silent absence as the vehicles — and no chip can judge them: a texture has no
  // type, nation or rank.
  const texs = q ? VehicleList.stems(q) : [];
  if (!inside.length && !outside.length && !texs.length) return VehicleList.none(el, q);
  wrap.classList.remove("empty");
  Finder.fill(el, wrap, [
    { head: "Vehicles", rows: inside, row: vehicleRow },
    { head: "Outside your filters", rows: outside, row: vehicleRow },
    { head: "Raw textures", rows: texs, row: rec => textureRow(rec, quality) },
  ]);
}
