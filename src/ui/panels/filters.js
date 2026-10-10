// The rank chips can only be built once the install has told us how many ranks it has.
function renderNationRankFilters(){ renderFilterChips(); }
// ---- the filters ----
// Three chip rows, one choice each: type, research tree, rank. A class is a silhouette, a nation
// is a flag and a rank is one or two characters, all of which read faster than a list of words and
// none of which fit in an <option> — but they behave like the radio buttons they look like, so
// picking a chip replaces the previous one and clicking the current chip again clears it back to
// "All". "Textures" is not a vehicle class but a different thing to search, so it clears the class.
const GameFilter = { cls: "", nation: "", rank: 0, tex: false };
const CLASS_CHIPS = [["air", "Aircraft", "air"], ["tank", "Ground", "tank"],
  ["helicopter", "Helis", "helicopter"], ["ship", "Naval", "ship"]];
function clearFilters(){ GameFilter.cls = ""; GameFilter.nation = ""; GameFilter.rank = 0; GameFilter.tex = false; }
function setTexMode(on){ GameFilter.tex = !!on; if (on) GameFilter.cls = ""; }
function filterChip(label, on, icon, title, fn, cls){
  const b = document.createElement("button");
  b.className = "chip" + (on ? " on" : "") + (cls ? " " + cls : "");
  b.title = title;
  if (icon) b.appendChild(icon);
  if (label) b.appendChild(document.createTextNode(label));
  b.onclick = fn;
  return b;
}
// ROADMAP 3.32. A chip row is a column of lines and the split into lines is computed here rather
// than left to flex-wrap, which breaks a line wherever the next chip stops fitting — so the split
// moved with every pixel of a sidebar drag: measured at 220/240/280/340 px the class row went 2+3,
// 3+2, 4+1, 5, the flags 6+4, 6+4, 8+2, 10, and the ranks left one chip alone on a line (7+1). An
// equal-cell grid would fix the order but cost a line at the default width (the widest class chip
// is 67 px, so 230 px holds two columns where wrap holds three chips). So: keep natural widths, take
// the FEWEST lines that hold the chips, and split them as evenly as possible across those lines —
// the split then depends on the line count alone, and the line count changes only when it has to.
// Front-heavy on a tie, so 3+2 is chosen over 2+3 whenever both fit. Gated by t50_controls.mjs.
const ChipRow = {
  GAP: 3,
  balance(d){
    const W = d.clientWidth; if (!W) return;                    // hidden measures 0 — 3.11(c)'s trap
    const chips = [...d.querySelectorAll(".chip")], w = chips.map(c => c.offsetWidth), n = w.length;
    if (!n) return;
    const GAP = ChipRow.GAP;
    // A chip the stylesheet hides (the nation-and-rank fold on a tall page) measures 0 and takes no
    // gap either, since a gap is only laid between boxes that are drawn.
    const fits = (i, j) => { let s = -GAP; for (let k = i; k < j; k++) if (w[k]) s += w[k] + GAP; return s <= W; };
    let L = 1;
    for (let i = 0, s = -GAP; i < n; i++) { if (!w[i]) continue; s += w[i] + GAP; if (s > W && i) { L++; s = w[i]; } }
    let best = null, spread = Infinity;
    const walk = (i, lines) => {
      const left = L - lines.length;
      if (left === 1) {
        if (!fits(i, n)) return;
        const all = [...lines, n - i], sc = Math.max(...all) - Math.min(...all);
        if (sc < spread) { spread = sc; best = all; }
        return;
      }
      for (let j = n - left + 1; j > i; j--) if (fits(i, j)) walk(j, [...lines, j - i]);
    };
    walk(0, []);
    if (!best) best = [n];
    const cur = [...d.children].map(l => l.childElementCount);
    if (cur.length === best.length && cur.every((c, i) => c === best[i])) return;   // unchanged — also what stops the observer re-entering
    // Taking a chip out of the page takes the keyboard focus with it: with the first, wider fold chip
    // (2026-10-10), opening the nation and rank rows with Enter made the column scroll, the type row
    // re-lined, and Space then went nowhere. The chips are the same elements, so the focused one is
    // handed it back.
    const focus = d.contains(document.activeElement) ? document.activeElement : null;
    d.innerHTML = "";
    let k = 0;
    for (const count of best) {
      const line = document.createElement("div"); line.className = "chipline";
      for (let c = 0; c < count; c++) line.appendChild(chips[k++]);
      d.appendChild(line);
    }
    if (focus) focus.focus({ preventScroll: true });
  },
  // Builds the row into `host` and balances it. The host outlives every redraw, so it is observed
  // once; a redraw does not change its width, only a sidebar drag or the row being shown does.
  mount(host, chips){
    host.innerHTML = "";
    const d = document.createElement("div"); d.className = "chips";
    const line = document.createElement("div"); line.className = "chipline";
    for (const c of chips) line.appendChild(c);
    d.appendChild(line); host.appendChild(d);
    ChipRow.balance(d);
    if (!host.dataset.balanced && typeof ResizeObserver !== "undefined") {
      host.dataset.balanced = "1";
      new ResizeObserver(() => { const cur = host.firstElementChild; if (cur) ChipRow.balance(cur); }).observe(host);
    }
  },
};
function renderFilterChips(){
  const cRow = $("gameClassRow"), nRow = $("gameNationRow"), rRow = $("gameRankRow");
  if (!cRow || !nRow || !rRow) return;
  // Both lists, not only the vehicles: the chips are one control over the vehicle list and the
  // UserSkins list (ROADMAP 3.5). `Finder` loads just below this file; only the click reaches it.
  const redraw = () => Finder.refresh();

  const row = ChipRow.mount;

  // ROADMAP 3.28(1): no "All" chip. Each chip toggles, so clicking the lit one is "all" — and the
  // Reset button beside the search box clears the three rows together. Three ways to say the same
  // thing, one of them occupying the first slot of every row.
  const cChips = [];
  for (const [val, label, cls] of CLASS_CHIPS)
    cChips.push(filterChip(label, GameFilter.cls === val, classIcon(cls),
      "Show only " + label.toLowerCase(),
      () => { GameFilter.tex = false; GameFilter.cls = GameFilter.cls === val ? "" : val; redraw(); }));
  cChips.push(filterChip("Textures", GameFilter.tex, null,
    "Search individual textures instead of vehicles", () => { setTexMode(!GameFilter.tex); redraw(); }));
  // The chip the nation and rank rows fold behind on a short page (2026-10-10; the stylesheet's
  // "A SHORT PAGE" says when and why). Built once and moved into each redraw, so whether it is open
  // outlives every chip click. Hidden on a tall page by the stylesheet alone — the balancer counts a
  // hidden chip as no width, so the type row's lines do not change on a tall page.
  // It reads as the two rows it stands for: a flag — the plain grey one until a nation is picked,
  // then that nation's — and "Rank", or the rank that is on; lit like any chip that is on, so a
  // filter folded away is never out of sight. Words ("Nation, rank ▾") were 86 px, which fits the
  // type row's second line in a column that does not scroll (209 px) and not in one that does (203):
  // opening the rows makes the column scroll, so the chip jumped to a third line under the pointer.
  let more = $("gameMoreFilters");
  if (!more) {
    more = document.createElement("button");
    more.id = "gameMoreFilters";
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", "gameNationRow gameRankRow");
    more.onclick = () => more.setAttribute("aria-expanded", more.getAttribute("aria-expanded") === "true" ? "false" : "true");
  }
  const nOn = GameFilter.nation, rOn = GameFilter.rank;
  more.className = "chip" + (nOn || rOn ? " on" : "");
  more.hidden = !GameUnits.nations.length && !GameUnits.maxRank;
  const flag = nationFlag(nOn || "");
  if (!nOn) flag.setAttribute("aria-label", "Nation");
  more.replaceChildren(flag, document.createTextNode(rOn ? RANK_ROMAN[rOn] || String(rOn) : "Rank"));
  more.title = "Nation and rank filters" + (nOn || rOn ? " — on: " + [nOn ? UNIT_COUNTRY[nOn] || nOn : "", rOn ? "rank " + (RANK_ROMAN[rOn] || rOn) : ""].filter(Boolean).join(", ") : "") +
    ". Folded on a short window to give the lists the room; click to show or hide them.";
  cChips.push(more);
  row(cRow, cChips);

  nRow.style.display = GameUnits.nations.length ? "" : "none";
  const nChips = [];
  for (const c of GameUnits.nations)
    nChips.push(filterChip("", GameFilter.nation === c.tag, nationFlag(c.tag), c.name +
      " — the research tree the vehicle sits in, so sub-nation vehicles (a Hungarian Leopard, an Australian Abrams) are under the tree you actually find them in",
      () => { GameFilter.nation = GameFilter.nation === c.tag ? "" : c.tag; redraw(); }));
  row(nRow, nChips);

  const maxRank = GameUnits.maxRank || 0;
  rRow.style.display = maxRank ? "" : "none";
  const rChips = [];
  for (let r = 1; r <= maxRank; r++)
    rChips.push(filterChip(RANK_ROMAN[r] || String(r), GameFilter.rank === r, null,
      "Rank " + (RANK_ROMAN[r] || r) + ", from the game's own wpcost.blk",
      () => { GameFilter.rank = GameFilter.rank === r ? 0 : r; redraw(); }, "rank"));
  row(rRow, rChips);
}
// A text field with nothing in it should not show a clear button; one with something in it
// should always have one.
function wireClearButton(inputId, btnId, after){
  const inp = $(inputId), btn = $(btnId);
  if (!inp || !btn) return;
  const sync = () => { btn.hidden = !inp.value; };
  inp.addEventListener("input", sync);
  btn.onclick = () => { inp.value = ""; sync(); inp.focus(); if (after) after(); };
  sync();
}

