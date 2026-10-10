// ---------- One search over both lists (ROADMAP 3.5, which is also 3.28(5)) ----------
// The Vehicle tab had two search boxes: the vehicle search, with its type / nation / rank chips, and
// a weaker box over the UserSkins list with no chips and no order you could choose. 3.28(5) asked
// for one search over both lists, either always or as an option, and 3.5 for the box,
// the chips and an explicit sort as one control mounted above both result lists. This is that
// control. It owns what was typed, the sort, and the pipeline every list is ranked through; each
// list owns only what its rows are: their names, whether the chips let them through, and what each
// sort means for them (`spec`, below — `VehicleList` in game-list.js, `SkinList` in skin-list.js).
//
// Decided 2026-09-26: ALWAYS one search, not an option. Typing "leopard" finds
// the Leopards and your Leopard skins together, which is what the request describes, and a switch
// would be a second control to say what the first one does. Reversal: a checkbox in #rowGameSort
// that makes `SkinList.spec` ignore `Finder.query()`.
const Finder = {
  // One sort for both lists. Each list says what an entry means for its own rows: "Tree order" for
  // a skin is the tree order of the vehicle it is for, "Rank" the rank of that vehicle.
  SORTS: { best: "Best match", tree: "Tree order", name: "Name", rank: "Rank" },
  sort: "best",
  timer: null,
  // The rows one chunk adds — 3.38's number, and still what keeps 3 882 vehicles as cheap as 200.
  LIM: 200,
  query(){ return Match.query($("gameSearch").value || ""); },
  filtered(){ return !!(GameFilter.cls || GameFilter.nation || GameFilter.rank); },
  // Whether one unit record gets through the type / nation / rank chips.
  unitPasses(u){
    if (!u) return false;
    if (GameFilter.cls && u.cls !== GameFilter.cls) return false;
    if (GameFilter.nation && u.tree !== GameFilter.nation) return false;
    if (GameFilter.rank && u.rank !== GameFilter.rank) return false;
    return true;
  },
  setSort(v){
    Finder.sort = Finder.SORTS[v] ? v : "best";
    const s = $("gameSort");
    if (s) s.value = Finder.sort;
  },
  // Everything a keystroke, the sort or reset changes: both lists. (A chip goes through `refresh`.)
  changed(){ renderGameSearch(); renderUserSkins(); },
  // What a chip click, Reset all settings or a settings file changes: the chips, and so both lists.
  // Before the review of 2026-09-27 a chip redrew only the vehicle list (filters.js still called
  // renderGameSearch alone), so the skins list kept the old filter until the next keystroke; and a
  // settings reset moved the sort select while both lists kept the old order. With nothing indexed
  // there is nothing to rank — and redrawing then would put "No game data indexed yet" over the
  // first-run hint — so only the chips are drawn.
  refresh(){ renderFilterChips(); if (GameDB.models.length || GameDB.stems.size) Finder.changed(); },
  // The in-game trees' order: nation as the trees list them, then rank. 0 when two units tie, so the
  // caller decides what breaks the tie (a name, or when a skin was made). A unit with no rank sits
  // after the nation's ranked ones: read as rank 0, the 218 rankless rows — radars, SAMs, an AT gun,
  // the C-47 — led every nation's list (measured on the real install, review of 2026-10-10).
  treeCmp(){
    const nat = new Map(GameUnits.nations.map((c, i) => [c.tag, i]));
    const n = u => u ? (nat.has(u.tree) ? nat.get(u.tree) : 99) : 100;
    const r = u => (u && u.rank) || 99;
    return (ua, ub) => n(ua) - n(ub) || r(ua) - r(ub);
  },
  // Score, split and order one list. What comes back is what the list draws: the rows the chips
  // keep, then — only when something is typed — the ones they leave out (3.5's second complaint: a
  // chip used to be a hard `return false`, so a hit the user could plainly see they asked for was
  // silently absent). Nothing typed is browsing (3.38), where the chips ARE the question, so there
  // is no outside group: listing 3 800 vehicles "outside your filters" would undo the filter.
  // Best match orders by tier first; any other sort is the order the user picked, tier second.
  rank(rows, spec){
    const q = Finder.query(), order = spec.order(Finder.sort, !!q);
    if (!q) return { inside: rows.filter(r => spec.passes(r)).sort(order), outside: [] };
    const hits = [];
    for (const r of rows) { const s = spec.score(q, r); if (s) hits.push([r, s]); }
    hits.sort(Finder.sort === "best" ? (a, b) => b[1] - a[1] || order(a[0], b[0])
                                     : (a, b) => order(a[0], b[0]) || b[1] - a[1]);
    const inside = [], outside = [];
    for (const [r] of hits) (spec.passes(r) ? inside : outside).push(r);
    return { inside, outside };
  },
  // A group's label inside a result list. The style is the vehicle list's own, unchanged, so the
  // markup of a search the filters do not touch is byte-for-byte what it was (t44).
  head(text){
    const d = document.createElement("div");
    d.textContent = text;
    d.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:8px 0 3px";
    return d;
  },
  stop(el){ if (el._moreIO) { el._moreIO.disconnect(); el._moreIO = null; } },
  // Groups of rows, each under its label, arriving LIM rows at a time — 3.38's chunking lifted out of
  // the vehicle list so the skins list is built the same way. A "Show more" button ends the list and
  // an IntersectionObserver rooted on the scrolling pane presses it when it comes into sight, so the
  // DOM holds only as much as anyone scrolled to. A label is drawn with the first row of its group,
  // so a chunk that ends at a group's last row does not leave the next label dangling below it.
  fill(el, root, groups){
    Finder.stop(el);
    const flat = [];
    let total = 0;
    for (const g of groups) {
      if (!g.rows.length) continue;
      flat.push({ head: g.head + (g.rows.length > 1 ? " · " + g.rows.length.toLocaleString() : "") });
      for (const r of g.rows) flat.push({ r, make: g.row });
      total += g.rows.length;
    }
    let at = 0, shown = 0, more = null;
    const label = () => {
      const left = total - shown;
      more.textContent = "Show " + Math.min(Finder.LIM, left) + " more · " + left.toLocaleString() + " left";
      more.style.display = left ? "" : "none";
      if (!left) Finder.stop(el);
    };
    const next = () => {
      const frag = document.createDocumentFragment();
      for (let n = 0; at < flat.length; at++) {
        const x = flat[at];
        if (x.head) { if (n >= Finder.LIM) break; frag.appendChild(Finder.head(x.head)); continue; }
        if (n >= Finder.LIM) break;
        const row = x.make(x.r);
        if (row) frag.appendChild(row);
        n++; shown++;
      }
      if (more) more.before(frag); else el.appendChild(frag);
      if (more) label();
    };
    next();
    if (shown < total) {                          // only a list longer than one chunk gets the button
      more = document.createElement("button");
      more.className = "listmore";
      more.onclick = next;
      el.appendChild(more);
      label();
      el._moreIO = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) next(); },
        { root, rootMargin: "0px 0px 120px 0px" });
      el._moreIO.observe(more);
    }
  },
  init(){
    // 120 ms after the last keystroke: both lists re-rank on every search now.
    $("gameSearch").oninput = () => { clearTimeout(Finder.timer); Finder.timer = setTimeout(Finder.changed, 120); };
    wireClearButton("gameSearch", "gameSearchClear", Finder.changed);
    $("gameSort").onchange = () => { Finder.setSort($("gameSort").value); Finder.changed(); };
    $("btnResetFilters").onclick = () => {
      $("gameSearch").value = ""; $("gameSearchClear").hidden = true;
      clearFilters();
      renderFilterChips(); Finder.changed();
      setStatus("Search and filters cleared", "ok");
    };
    renderFilterChips();
  },
};
Finder.init();
