// ---------- The UserSkins list: the other list under the search (ROADMAP 3.5) ----------
// It had a filter box of its own (#skinSearch) — no chips, no order you could choose, and a
// String.includes that a hyphen defeated. Now it is searched, filtered and sorted by the same
// control as the vehicles, so typing "leopard" finds the Leopards and your Leopard skins together.
// Moved out of game/userskins.js in the same change because it builds DOM, which is ui/'s
// (CLAUDE.md §2); reading the folder and dating each skin stay in game/.
const SkinList = {
  // The unit records a skin names through its .blk files. A zip's are not known until it is opened.
  units(rec){
    const out = [];
    for (const uid of rec.units || []) {
      const u = GameUnits.byId.get(uid) || GameUnits.byId.get(uid.replace(/-/g, "_"));
      if (u) out.push(u);
    }
    return out;
  },
  // unit ids in a skin → the vehicle names a human recognises
  label(rec){
    const names = [];
    for (const uid of rec.units) {
      const u = GameUnits.byId.get(uid) || GameUnits.byId.get(uid.replace(/-/g, "_"));
      names.push(u ? u.name : uid);
      if (names.length >= 3) break;
    }
    if (!names.length) return rec.texCount + " texture" + (rec.texCount === 1 ? "" : "s");
    return names.join(", ") + (rec.units.length > names.length ? " +" + (rec.units.length - names.length) : "") +
      " · " + rec.texCount + " tex";
  },
  // Found by its own name, the vehicles it is for and their unit ids; the vehicles' nations count as
  // words, the way they do for the vehicle list. Built per search rather than cached: a UserSkins
  // folder is tens of skins, not thousands, and its unit names come from a registry that may load
  // after the folder was read.
  score(q, rec){
    const us = SkinList.units(rec);
    return Match.score(q, Match.record([rec.name, ...us.map(u => u.name), ...(rec.units || [])], us.map(nationName)));
  },
  // A skin gets through the chips when one of the vehicles it is for does — a family skin passes
  // "rank VIII" if one of its variants is rank VIII. One that names no vehicle the registry knows (a
  // zip, until it is opened) cannot be judged, so a chip leaves it out; it is still found under
  // "Outside your filters" the moment its name is typed.
  passes(rec){ return !Finder.filtered() || SkinList.units(rec).some(Finder.unitPasses); },
  // Newest first is the default the list already had (3.28(4)): the skin you want is nearly always
  // the one you just made. Every other sort falls back on it to break a tie.
  order(sort){
    const newest = (a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name);
    if (sort === "name") return (a, b) => a.name.localeCompare(b.name) || newest(a, b);
    if (sort === "tree") {
      const tree = Finder.treeCmp();
      return (a, b) => tree(SkinList.units(a)[0], SkinList.units(b)[0]) || newest(a, b);
    }
    if (sort === "rank") {
      // Highest rank first, as the vehicle list (one sort means one thing over both lists); a skin
      // for a rankless unit, then one for no unit the registry knows, after every ranked one.
      const rk = r => { const u = SkinList.units(r)[0]; return u ? u.rank || -1 : -2; };
      return (a, b) => rk(b) - rk(a) || newest(a, b);
    }
    return newest;
  },
  row(rec){
    const row = document.createElement("div");
    row.className = "rowitem skinrow" + (rec.unsupported ? " bad" : "");
    const u0 = SkinList.units(rec)[0];
    const ic = document.createElement("span");
    ic.style.cssText = "flex:0 0 auto;display:flex;color:var(--muted)";
    ic.appendChild(classIcon(u0 ? u0.cls : "other"));
    const txt = document.createElement("div");
    txt.style.cssText = "flex:1 1 auto;min-width:0";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = rec.name;
    const t2 = document.createElement("div"); t2.className = "t2";
    t2.textContent = rec.unsupported ? "7z / rar archive — unpack it first" : rec.kind === "zip" ? "zip archive" : SkinList.label(rec);
    txt.append(t1, t2);
    row.append(ic, txt);
    if (!rec.unsupported) {
      row.title = "Load “" + rec.name + "” onto the model" + (rec.units.length ? " (" + rec.units.slice(0, 4).join(", ") + ")" : "");
      row.onclick = () => loadUserSkin(rec);
    } else row.title = "Only folders and .zip files can be read — unpack this archive into UserSkins first";
    return row;
  },
};
function renderUserSkins(){
  const el = $("userSkinList"), wrap = $("userSkinWrap");
  if (!el) return;
  const list = App.userSkins || [];
  $("btnRescanSkins").style.display = App.userSkinsDir ? "" : "none";
  el.innerHTML = ""; el.className = "";
  Finder.stop(el);
  wrap.classList.add("empty");
  if (!list.length) return;
  const { inside, outside } = Finder.rank(list, SkinList);
  if (!inside.length && !outside.length) {
    el.className = "emptyhint";
    el.textContent = Finder.query() ? "None of your " + list.length + " skins match that."
      : "None of your " + list.length + " skins is for a vehicle in this nation / rank / class combination.";
    return;
  }
  wrap.classList.remove("empty");
  Finder.fill(el, wrap, [
    { head: "In your UserSkins folder", rows: inside, row: SkinList.row },
    { head: "Outside your filters", rows: outside, row: SkinList.row },
  ]);
}
