// ---------- The Select tool: the marquee's gesture, its drawing and its panel ----------
// ROADMAP 4.10. `Marquee` (editor/marquee.js) is the rectangle and the verbs; this is the half that
// touches the DOM — the pointer gesture over the 2-D canvas, the outline and handles, and the panel
// with the typed numbers.
//
// Select is a MODE of the 2-D pointer, not a brush: while it is on a drag makes a rectangle instead
// of painting, and turning it off leaves the selection in place, confining the brush. That is the
// shape 3.7 wants for every mode, and it is the reason this is a labelled toggle with its own
// cursor rather than a held modifier — an invisible mode is the thing 3.9 was reported for.
const SelectUI = {
  on: false,
  // WHICH shape a gesture makes while Select is on: "box" (a drag makes a rectangle), "island",
  // "lasso" or "wand". One field rather than a flag per kind (ROADMAP 4.50 (9)), so two of them can
  // never be on at once — the question the island flag used to answer on its own, "does a click
  // take an island?", has one answer now, and `island` is still the name every caller asks it by.
  //
  // ROADMAP 4.24. Islands are a second *shape* the same tool makes, not a second tool: with them on
  // a CLICK takes the UV island under it and a DRAG still makes a rectangle, so the two coexist in
  // one mode and neither is hidden behind a modifier. It is a labelled toggle for the reason stated
  // above — an invisible mode is what 3.9 was reported for — and it is also what tells Ctrl+click in
  // the 3-D view to mean "this island" instead of "this part". The wand is the same shape of kind: a
  // click takes a colour, a drag a rectangle, and Ctrl+click on the model takes the texel under it.
  kind: "box",
  get island(){ return SelectUI.kind === "island"; },
  d: null,                       // the live drag: {id, from, ox, oy, vx, vy, moved, p, add, sub, op, band}
  lasso: null,                   // the outline being drawn: {pts, op, first, free, down, vx, vy, hover, slot}
  GRAB: 7,                       // how near the first corner a click closes a lasso, in screen pixels
  CURSORS: { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
             n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", in: "move" },
  VERBS: ["btnSelFill", "btnSelClear", "btnSelCrop", "btnSelCopy"],           // None follows the live grain (3.30)
  KINDS: [["btnSelIsland", "island", "Islands"], ["btnSelLasso", "lasso", "Lasso"], ["btnSelWand", "wand", "Wand"]],

  // Switching kinds drops an outline in progress and nothing else. In particular it does NOT release
  // an island pick the way turning Islands off does (below): going from Islands to the lasso is how
  // a lasso gets Shift-added to the islands you just picked.
  setKind(k){
    SelectUI.kind = k;
    SelectUI.lasso = null;
    if (k !== "box" && !SelectUI.on) { SelectUI.setOn(true); return; }     // sync() runs in there
    SelectUI.sync();
    SelectUI.cursor(null);
    draw2D();
  },
  // L and W, and the two buttons: the kind if it is not the live one, back to the box if it is.
  toggleKind(k){ SelectUI.setKind(SelectUI.on && SelectUI.kind === k ? "box" : k); },
  setIslandMode(on){
    if (on) { SelectUI.setKind("island"); return; }
    if (SelectUI.island) SelectUI.kind = "box";
    // Turning Islands off RELEASES an island pick (reported 2026-08-31: "only turns the mode off but
    // still keeps the current uv selection selected and restricts editing to it"). This is not the
    // same call `setOn(false)` makes, and the difference is not a preference: a rectangle left in
    // force can still be moved, resized, retyped and cleared with the tool off, while an island
    // selection can be none of those — `down` refuses its handles by design and the four number
    // fields do not describe it. So leaving one behind is a restriction on every tool with nothing
    // left in the UI that lifts it except the toggle the user just used to try.
    //
    // Only an island PICK since 4.50 (9). A lasso's or a wand's shape was made with a tool whose own
    // toggle says "Lasso" or "Wand", and switching a tool off keeps what it made — the selection is
    // the product, the way a stroke outlives the brush. None and Esc clear any of them.
    if (Marquee.shape() && Marquee.islands)
      Marquee.act("clear UV island selection", () => {
        Marquee.none();
        setStatus("UV island selection cleared — the brush and the verbs are free again", "ok");
      });
    SelectUI.sync();
    SelectUI.cursor(null);
  },
  // One click, in either view. `add` keeps what was already selected, `sub` takes this island back
  // out — the same two modifiers the part picker uses, so there is one rule to remember.
  //
  // It records its own history step, because it is reached from BOTH views — `up()` below and the
  // Ctrl+click in `paint3d` — and a step pushed at each call site is a step that would be pushed
  // twice or not at all depending on which view you clicked in.
  pickIsland(s, px, py, add, sub){
    if (!App.geomData) { setStatus("UV islands need the model loaded — open a vehicle, or drop in an .obj", "err"); return; }
    Marquee.act("select UV island", () => {
      const id = UVIslands.at(s, px, py);
      if (!id) {
        if (!add && !sub) { Marquee.none(); setStatus("No UV island there — that is gutter between the shells", "ok"); }
        return;
      }
      // Shift or Alt onto a selection that is NOT an island pick — a rectangle, a lasso, a wand's
      // patch — combines texel by texel, the way every source does since 4.50 (9). Before, the island
      // simply replaced it, which is what Shift means nowhere else in the app.
      if ((add || sub) && Marquee.rect() && !Marquee.islands) {
        const op = sub ? "sub" : "add", one = new Set([id - 1]);
        SelectUI.said("UV island", op, true, Marquee.applyCanvas(
          UVIslands.stencil(s, s.composite.width, s.composite.height, one), UVIslands.bounds(s, one), op));
        return;
      }
      const ids = new Set((add || sub) && Marquee.islands ? Marquee.islands : []);
      if (sub) ids.delete(id - 1); else ids.add(id - 1);
      if (!ids.size) { Marquee.none(); setStatus("Selection cleared", "ok"); return; }
      if (!Marquee.setIslands(ids)) return;
      // A mirrored shell is ONE island in UV and two sides of the vehicle in 3-D. Saying how many
      // parts it spans is what makes that legible before the first stroke rather than after it.
      const parts = UVIslands.parts(s, ids), n = ids.size;
      setStatus(n + " UV island" + (n === 1 ? "" : "s") + " selected, across " + parts.size + " part" +
        (parts.size === 1 ? "" : "s") + " — shift+click adds, alt+click removes. A mirrored shell is one island " +
        "and both sides of the vehicle.", "ok");
    });
  },

  // ---- the magic wand and colour range (ROADMAP 4.50 (9)) ----
  // It reads the sheet the 2-D view SHOWS (`Draw2D.shownRows`): the composited colour, the channel
  // the brush in hand writes, or the channel view picked — so a patch of gloss is selected by its
  // gloss — and on a ground or naval slot the camouflage blend the view draws over it, which is the
  // colour on screen. That is 4.26's rule for the colour picker one level up: what you see under the
  // cursor is what gets matched, not a sheet you are not looking at. Tolerance and Contiguous are
  // read at the click.
  //
  // A click runs a band of the sheet at a time (`Marquee.fromColourAsync`), so it resolves later: the
  // clicks are QUEUED, one after the other, because a Shift+click made while the last one is still
  // reading has to combine with what that one selected. `wand` is the queue's tail — what a caller
  // waits on to see the result.
  wand: null,
  tol(){ const e = $("selTol"); return e ? Math.max(0, Math.min(255, +e.value || 0)) : 32; },
  contig(){ const e = $("selContig"); return !e || e.checked; },
  edge(){ const e = $("selEdge"); return !e || e.checked; },
  pickWand(s, px, py, add, sub){
    const op = sub ? "sub" : add ? "add" : "replace", tol = SelectUI.tol(), contig = SelectUI.contig(), edge = SelectUI.edge();
    const run = () => SelectUI.runWand(s, px, py, op, tol, contig, edge);
    return (SelectUI.wand = (SelectUI.wand || Promise.resolve()).then(run)
      .catch(err => reportFailure("Selecting with the magic wand", err, "wand")));
  },
  async runWand(s, px, py, op, tol, contig, edge){
    if (App.activeSlot !== s || !s.composite) {              // its texture was switched away while it waited
      setStatus("That wand click was on another texture — nothing was selected; click again on this one", "err");
      return;
    }
    const bar = SelectUI.wandBar();
    try {
      // what is on screen: a Fill or a stroke just made is still waiting for its frame (the clone
      // tool reads the sheet the same way, for the same reason)
      flushComposites();
      const S = Marquee.dims(s.composite.width, s.composite.height);
      const res = await Marquee.fromColourAsync(Draw2D.shownRows(s, S), px, py, tol, contig, op, bar, edge);
      if (!res) {
        setStatus(bar.cancelled() ? "Stopped the wand — the selection is as it was"
          : "The texture changed while the wand was reading it — nothing was selected; click again", "err");
        return;
      }
      const hex = "#" + res.rgb.map(v => v.toString(16).padStart(2, "0")).join("");
      SelectUI.said((contig ? "patch of " : "every texel of ") + hex + " ± " + tol + " (" + res.texels + " texels)", op, res.had, res.ok);
    } finally { bar.end(); }
  },
  // The bar a wand click shows if it is still reading at 200 ms (§3.5): determinate, by the share of
  // the sheet read, and cancellable. Most clicks are done long before and never open it; a whole
  // 4096² sheet can be past it. Only ever ends a bar it opened itself.
  wandBar(){
    let gen = -1, open = setTimeout(() => { open = 0; if (!Prog.active) { progBegin("Selecting with the wand…", true); gen = Prog.gen; } }, 200);
    const mine = () => Prog.active && Prog.gen === gen;
    return {
      tick: f => { if (mine()) progress(null, f); },
      cancelled: () => gen >= 0 && Prog.gen === gen && Prog.cancelled,
      end: () => { clearTimeout(open); if (mine()) progEnd(); },
    };
  },
  // A click that picks AT a texel — Islands' shell or the wand's colour — reached from either view:
  // `up` below in 2-D, and Ctrl+click on the model in 3-D (editor/paint3d.js), which is why neither
  // knows which of the two it is asking for.
  picksClick(){ return SelectUI.kind === "island" || SelectUI.kind === "wand"; },
  pickAt(s, px, py, add, sub){
    if (SelectUI.kind === "wand") SelectUI.pickWand(s, px, py, add, sub);
    else SelectUI.pickIsland(s, px, py, add, sub);
  },
  // One sentence for what a lasso, a path, a wand click or a Shift/Alt rectangle left selected.
  // `ok` is what `Marquee.applyShape` answered: true, false (nothing left), or "same".
  said(what, op, had, ok){
    const r = Marquee.rect();
    if (ok === "same") {
      setStatus(op === "sub" ? "That " + what + " takes nothing away — none of it is selected, so the selection is as it was"
                             : "That " + what + " adds nothing — it covers no texel that is not selected already, so the selection is as it was", "err");
      return;
    }
    if (!ok || !r) {
      if (op === "sub") setStatus(had ? "That took away all of the selection — nothing is selected now"
                                      : "Nothing is selected to take away from — Alt removes from a selection", had ? "ok" : "err");
      else setStatus("That " + what + " covers no whole texel — nothing is selected", "err");
      return;
    }
    setStatus((op === "add" ? "Added the " + what + " to the selection" : op === "sub" ? "Took the " + what + " out of the selection"
      : "Selected the " + what) + ", inside a " + r.w + " × " + r.h + " box — Shift adds, Alt takes away. " +
      "The brush, Fill, Clear, Crop and Copy follow the shape, not the box.", "ok");
  },

  // ---- the lasso (ROADMAP 4.50 (9)) ----
  // One tool for both lassos, the way GIMP's Free Select is one: a DRAG draws freehand and a CLICK
  // puts down a corner — the shape tool's gesture without its handles. An outline that STARTED with
  // a drag closes when the button comes up, which is Photoshop's lasso and what a hand that has just
  // drawn a loop expects. One that started with a click is a polygon and stays open until it is
  // closed: on its first corner, by a double-click, or with Enter. Esc drops it, Backspace takes back
  // the last corner, and Shift or Alt at the first press decides whether it adds or takes away.
  opOf(e){ return e && e.altKey ? "sub" : e && e.shiftKey ? "add" : "replace"; },
  lassoDown(e, p){
    const L = SelectUI.lasso;
    if (!L) {
      SelectUI.lasso = { pts: [[p.x, p.y]], op: SelectUI.opOf(e), first: true, free: false,
                         down: true, vx: p.vx, vy: p.vy, hover: null, slot: App.activeSlot };
      SelectUI.sync(); draw2D();
      return true;
    }
    const f = L.pts[0];
    if (L.pts.length > 2 && Math.hypot(p.x - f[0], p.y - f[1]) <= SelectUI.GRAB * SelectUI.tpp()) { SelectUI.closeLasso(); return true; }
    L.pts.push([p.x, p.y]);
    L.down = true; L.vx = p.vx; L.vy = p.vy;
    SelectUI.sync(); draw2D();
    return true;
  },
  lassoMove(p){
    const L = SelectUI.lasso;
    L.hover = [p.x, p.y];
    if (L.down) {
      // Freehand once the press has travelled a couple of screen pixels — below that it is a click
      // with an unsteady hand, measured on the pointer so it means the same at every zoom. Then a
      // corner every two screen pixels: finer is invisible, and a lasso drawn slowly would be
      // thousands of corners of nothing.
      if (L.first && !L.free && Math.max(Math.abs(p.vx - L.vx), Math.abs(p.vy - L.vy)) > 2) L.free = true;
      const last = L.pts[L.pts.length - 1];
      if ((L.free || !L.first) && Math.hypot(p.x - last[0], p.y - last[1]) >= 2 * SelectUI.tpp()) L.pts.push([p.x, p.y]);
    }
    draw2D();
    return true;
  },
  lassoUp(){
    const L = SelectUI.lasso;
    L.down = false;
    if (L.free) { SelectUI.closeLasso(); return; }
    L.first = false;
  },
  closeLasso(){
    const L = SelectUI.lasso;
    SelectUI.lasso = null;
    if (!L) return false;
    // Its corners are texels of the sheet it was drawn on, and a selection belongs to one sheet (see
    // `Marquee.rect`), so an outline carried across a slot switch is dropped, not closed elsewhere.
    if (L.slot !== App.activeSlot) {
      setStatus("That outline was drawn on another texture — draw it again on this one", "err");
      SelectUI.sync(); draw2D();
      return false;
    }
    if (L.pts.length < 3) {
      setStatus("A lasso needs three corners at least — drag round the area, or click corner by corner", "err");
      SelectUI.sync(); draw2D();
      return false;
    }
    const had = !!Marquee.rect();
    const ok = Marquee.fromPoly(L.pts, L.op, L.op === "sub" ? "take a lasso out of the selection"
      : L.op === "add" ? "add a lasso to the selection" : "lasso selection");
    SelectUI.said("lasso", L.op, had, ok);
    SelectUI.sync(); draw2D();
    return ok;
  },
  // A polygon closes on a double-click too. Its two presses have already put down two corners on the
  // spot by then, and a zero-length edge covers no texel, so they cost nothing — unless the FIRST
  // press landed on the first corner. That closed the outline there and then, and the second press
  // has started a new one-corner outline since, which is dropped here rather than refused as "a lasso
  // needs three corners" over a selection that was just made.
  dblLasso(){
    const L = SelectUI.lasso;
    if (!SelectUI.on || !L) return false;
    if (L.pts.length > 1) return SelectUI.closeLasso();
    SelectUI.lasso = null;
    SelectUI.sync(); draw2D();
    return false;
  },
  // Esc and Backspace, answered only while an outline is being drawn — true when they were.
  cancelLasso(){
    if (!SelectUI.lasso) return false;
    SelectUI.lasso = null;
    setStatus("Lasso dropped — the selection is as it was", "ok");
    SelectUI.sync(); draw2D();
    return true;
  },
  dropLassoCorner(){
    const L = SelectUI.lasso;
    if (!L || L.down) return false;
    if (L.pts.length > 1) L.pts.pop(); else SelectUI.lasso = null;
    SelectUI.sync(); draw2D();
    return true;
  },

  // ---- parts <-> islands ----
  // Requested 2026-09-01: "I want to have fluent transition between parts and islands selection."
  // They are one question — where does this apply — asked at two grains, and there was no way from
  // either answer to the other: you re-picked by hand in the other vocabulary and hoped the two
  // agreed. They already COMPOSE (a stroke is confined by both, and t59 compares the two stencils
  // texel for texel), so the only missing piece was the conversion.
  fromParts(){
    const sh = Marquee.sheet();
    if (!sh) { setStatus("Open a texture slot first", "err"); return; }
    if (!App.geomData) { setStatus("UV islands need the model loaded — open a vehicle, or drop in an .obj", "err"); return; }
    if (!App.selParts.size) { setStatus("No parts are selected — Ctrl+click a part on the model, then come back", "err"); return; }
    const ids = UVIslands.ofParts(sh.s, App.selParts);
    if (!ids.size) { setStatus("None of the selected parts has geometry on “" + sh.s.id + "” — they are on another texture", "err"); return; }
    Marquee.act("islands of the selected parts", () => {
      if (!Marquee.setIslands(ids)) return;
      // An island a selected part SHARES with an unselected one comes with it, and there is no
      // stencil that could hold one and not the other — they are the same texels. Saying how many
      // extra parts arrived is what makes that legible before the first stroke rather than after.
      const back = UVIslands.parts(sh.s, ids), extra = back.size - App.selParts.size;
      setStatus(ids.size + " UV island" + (ids.size === 1 ? "" : "s") + " from " + App.selParts.size +
        " selected part" + (App.selParts.size === 1 ? "" : "s") +
        (extra > 0 ? " — " + extra + " more part(s) share those shells, so they came with them" : ""), "ok");
    });
  },
  toParts(){
    const sh = Marquee.sheet();
    const ids = Marquee.shape() ? Marquee.islands : null;
    if (!sh || !ids || !ids.size) { setStatus("Select some UV islands first — turn UV island on (K) and click a shell", "err"); return; }
    const names = [...UVIslands.parts(sh.s, ids)];
    if (!names.length) { setStatus("Those islands sit on no part of this model", "err"); return; }
    // REPLACES the part selection rather than adding to it: the button says "the parts these
    // islands cover", and adding would answer a question nobody asked.
    partAction("select the parts under " + ids.size + " island(s)", () => { App.selParts = new Set(names); });
    setStatus(names.length + " part" + (names.length === 1 ? "" : "s") + " selected — everything the " +
      ids.size + " island(s) touch. The islands stay selected as well; clear whichever of the two you " +
      "wanted to widen.", "ok");
  },

  aspect(){ const c = $("selAspect"); return !!(c && c.checked); },
  // Texels per screen pixel, so a grab radius and a handle can be a constant size on screen.
  tpp(){ return 1 / Math.max(1e-6, v2.sc); },

  setOn(on){
    SelectUI.on = !!on;
    if (!SelectUI.on) SelectUI.d = SelectUI.lasso = null;
    // The shape tool claims the 2-D pointer ahead of this one, so Select turned on beside it would
    // be a mode that no drag ever reaches. `PathUI.set` does the same the other way round.
    if (SelectUI.on && PathUI.on) PathUI.set(false);
    SelectUI.sync();
    SelectUI.cursor(null);
    draw2D();
  },

  // ---- the gesture ----
  // Each of these answers "did I consume this pointer event", so view2d stays a list of one-line
  // branches instead of growing a second set of drag state.
  down(e, p){
    if (!SelectUI.on) return false;
    const sh = Marquee.sheet();
    if (!sh) { setStatus("Select a texture slot first, then drag a rectangle", "err"); return true; }
    if (SelectUI.kind === "lasso") return SelectUI.lassoDown(e, p);
    // No handles while a shape is in force: dragging one would silently turn the island back into
    // its bounding rectangle, which is a thing nobody asked for and cannot be undone by letting go.
    // None with Shift or Alt held either (4.50 (9)): those start a rectangle to ADD or TAKE AWAY,
    // which is the whole of what the two keys mean everywhere else in the app.
    const op = SelectUI.opOf(e);
    // Nor while it is hidden (3.39 (3)): a grab of something not drawn would move it unseen.
    const id = (Marquee.shape() || op !== "replace" || !Marquee.shown) ? null : Marquee.hit(Marquee.rect(), p.x, p.y, SelectUI.tpp());
    // A new rectangle starts ON a guide when the press is near one (4.50 (15)); a move or a resize
    // keeps the raw press, which is only ever a grab offset.
    const o = id ? p : GuidesUI.snapPt(e, p.x, p.y);
    SelectUI.d = { id: id || "new", from: id ? Marquee.rect() : null,
                   ox: o.x, oy: o.y, vx: p.vx, vy: p.vy, moved: false,
                   p, add: e.shiftKey, sub: e.altKey, op, band: null,
                   // Where the selection stood when the gesture began. `Marquee.set` runs on every
                   // frame of the drag, so by the time `up` records a step the live state is the
                   // END of it and this is the only copy of the start.
                   snap: Marquee.snapshot() };
    return true;
  },
  move(e, p){
    if (!SelectUI.on) return false;
    if (SelectUI.lasso) return SelectUI.lassoMove(p);
    const d = SelectUI.d;
    if (!d) { SelectUI.cursor(p); return true; }
    const sh = Marquee.sheet();
    if (!sh) return true;
    // A drag is a drag once it has travelled a couple of screen pixels. Below that it is a click,
    // and a click on nothing means "deselect" — measured on the pointer, not on texels, or the
    // threshold would mean something different at every zoom level.
    if (!d.moved && Math.max(Math.abs(p.vx - d.vx), Math.abs(p.vy - d.vy)) > 2) d.moved = true;
    if (!d.moved) return true;
    if (d.id === "new") {
      const c = GuidesUI.snapPt(e, p.x, p.y);                 // the corner under the pointer, on a guide if near one
      let w = c.x - d.ox, h = c.y - d.oy;
      // Locked, a NEW rectangle is square: there is no earlier shape to keep, and guessing one from
      // whatever was selected before is a rule nobody could predict. Resizing keeps the real shape.
      if (SelectUI.aspect()) {
        const k = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * k; h = Math.sign(h || 1) * k;
      }
      // A Shift / Alt rectangle is only an outline until the button comes up: combining it with the
      // selection means a mask-resolution pass, and one per pointer move is the rAF §3 keeps empty.
      if (d.op !== "replace") { d.band = Marquee.norm({ x: d.ox, y: d.oy, w, h }, sh.W, sh.H); draw2D(); }
      else Marquee.set({ x: d.ox, y: d.oy, w, h });
    } else {
      // Only the edges this gesture moves may snap — all four for a move, one or two for a handle —
      // and the shift is applied to the drag itself, so a move keeps its size (4.50 (15)).
      const f = d.from, dx = p.x - d.ox, dy = p.y - d.oy, xs = [], ys = [];
      if (d.id === "in" || /w/.test(d.id)) xs.push(f.x + dx);
      if (d.id === "in" || /e/.test(d.id)) xs.push(f.x + f.w + dx);
      if (d.id === "in" || /^n/.test(d.id)) ys.push(f.y + dy);
      if (d.id === "in" || /^s/.test(d.id)) ys.push(f.y + f.h + dy);
      const sn = GuidesUI.snap(e, xs, ys);
      Marquee.set(Marquee.drag(f, d.id, dx + sn.dx, dy + sn.dy,
        { aspect: SelectUI.aspect(), W: sh.W, H: sh.H }));
    }
    SelectUI.cursor(p);
    return true;
  },
  up(){
    if (SelectUI.lasso && SelectUI.lasso.down) { SelectUI.lassoUp(); return; }
    const d = SelectUI.d;
    SelectUI.d = null;
    if (!d) return;
    if (!d.moved) {
      // A click, not a drag. With Islands or the wand that is the whole gesture; otherwise a plain
      // click on the sheet clears the selection, as it always has — and a Shift or Alt one does
      // nothing, since it was the start of adding or taking away that never became a rectangle.
      const sh = Marquee.sheet();
      // pickAt records its own step, because the 3-D view reaches it without a gesture here.
      if (SelectUI.picksClick() && sh) {
        // On a camouflage tile's repeats the texel under the pointer is the sheet's own, one period
        // over — the eyedropper's rule (view2d.js, 4.50 (6)). Clamped to the sheet instead, a wand
        // click on a repeat took the colour at the sheet's edge: found landing (9) beside (6),
        // 2026-09-26, and held by t99.
        const q = CamoTile.is(sh.s) ? CamoTile.wrap(d.p.x, d.p.y, sh.W, sh.H) : [d.p.x, d.p.y];
        SelectUI.pickAt(sh.s, q[0], q[1], d.add, d.sub); SelectUI.sync(); return;
      }
      if (d.id === "new" && d.op === "replace") Marquee.none();
    } else if (d.band) {
      const had = !!Marquee.rect();
      SelectUI.said("rectangle", d.op, had, Marquee.fromRect(d.band, d.op));   // its own step
      SelectUI.sync(); draw2D();
      return;
    }
    // One entry per gesture, and none at all when the rectangle came back the same.
    const after = Marquee.snapshot();
    if (!Marquee.sameSnap(d.snap, after))
      pushAction(d.moved ? (d.id === "new" ? "select" : "resize selection") : "clear selection",
        () => Marquee.applySnapshot(d.snap), () => Marquee.applySnapshot(after));
    SelectUI.sync();
  },
  cursor(p){
    if (!cnv2) return;
    if (!SelectUI.on) { cnv2.style.cursor = ""; return; }
    const id = (p && Marquee.shown && !Marquee.shape() && SelectUI.kind !== "lasso") ? Marquee.hit(Marquee.rect(), p.x, p.y, SelectUI.tpp()) : null;
    cnv2.style.cursor = (SelectUI.d && !SelectUI.d.band && SelectUI.CURSORS[SelectUI.d.id]) || SelectUI.CURSORS[id] ||
      (SelectUI.picksClick() ? "cell" : "crosshair");
  },

  // ---- drawing ----
  // Everything is drawn in DEVICE space with the transform reset, so the outline, the handles and
  // the label are the same size at every zoom — a 1-texel-wide outline is invisible zoomed out and
  // a wall zoomed in. The caller's transform is restored on the way out.
  draw(g, view){
    SelectUI.drawSel(g, view);
    SelectUI.drawOutline(g, view);
  },
  // What is being drawn and is not a selection yet: the lasso, or a Shift / Alt rectangle before it
  // lands. Dashed in the accent to add, in red to take away, in white to replace — the three things
  // the button coming up is about to do, readable before it does them.
  drawOutline(g, view){
    const L = SelectUI.lasso, band = !L && SelectUI.d && SelectUI.d.band;
    if (!L && !band) return;
    const X = x => x * view.sc + view.ox, Y = y => y * view.sc + view.oy;
    const op = L ? L.op : SelectUI.d.op;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.beginPath();
    if (L) {
      g.moveTo(X(L.pts[0][0]), Y(L.pts[0][1]));
      for (let i = 1; i < L.pts.length; i++) g.lineTo(X(L.pts[i][0]), Y(L.pts[i][1]));
      // the rubber band to the pointer while corners are being clicked, the closing edge while a
      // freehand loop is being drawn — either way, the outline the release would select
      if (L.free) g.closePath(); else if (L.hover) g.lineTo(X(L.hover[0]), Y(L.hover[1]));
    } else g.rect(X(band.x) + .5, Y(band.y) + .5, band.w * view.sc, band.h * view.sc);
    g.lineWidth = 3; g.strokeStyle = "rgba(8,10,14,.75)"; g.setLineDash([]); g.stroke();
    g.lineWidth = 1; g.strokeStyle = op === "sub" ? "#ff8a80" : op === "add" ? Marquee.ACCENT : "#e8ecf2";
    g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    // The first corner of a polygon, filled once the pointer is near enough for a click to close it.
    if (L && !L.free) {
      const f = L.pts[0], k = 7, near = L.pts.length > 2 && L.hover &&
        Math.hypot(L.hover[0] - f[0], L.hover[1] - f[1]) <= SelectUI.GRAB * SelectUI.tpp();
      g.fillStyle = near ? Marquee.ACCENT : "#e8ecf2"; g.strokeStyle = "rgba(8,10,14,.85)";
      g.fillRect(Math.round(X(f[0]) - k / 2), Math.round(Y(f[1]) - k / 2), k, k);
      g.strokeRect(Math.round(X(f[0]) - k / 2) + .5, Math.round(Y(f[1]) - k / 2) + .5, k - 1, k - 1);
    }
    g.restore();
  },
  drawSel(g, view){
    const r = Marquee.rect();
    // Hidden with H (ROADMAP 3.39 (3)): nothing of it is drawn, and the panel says so.
    if (!r || !Marquee.shown) return;
    const W = g.canvas.width, H = g.canvas.height;
    const x = r.x * view.sc + view.ox, y = r.y * view.sc + view.oy;
    const w = r.w * view.sc, h = r.h * view.sc;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // The dim belongs to the TOOL, not to the selection. While you are placing a rectangle it is
    // what makes the rectangle readable; once the tool is off you are painting beside it, and this
    // app exists to let someone judge a colour (§0.3) — 45 % of black over most of the sheet is the
    // last thing that should be between them and it. Off, the dashed outline alone says a selection
    // is still in force, and the two modes look different, which is what 3.9 and 3.14 are about.
    //
    // Four bands rather than one clipped fill: `ctx.clip()` is antialiased and would lay a
    // half-dark seam along the exact edge being judged (the wt-canvas facts).
    if (SelectUI.on) {
      const cx0 = Math.max(0, Math.min(W, x)), cx1 = Math.max(0, Math.min(W, x + w));
      const cy0 = Math.max(0, Math.min(H, y)), cy1 = Math.max(0, Math.min(H, y + h));
      g.fillStyle = "rgba(8,10,14,.45)";
      for (const b of Marquee.outside({ x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 }, W, H))
        if (b.w > 0 && b.h > 0) g.fillRect(b.x, b.y, b.w, b.h);
    }
    // An island selection is a shape inside that box, so the box alone would not say what is
    // selected. The tint is the STENCIL every verb is about to use, blitted — not an outline
    // re-derived from the boundary edges, which could show a shape the tools do not honour. It is
    // pre-drawn as a rim and a faint wash (`Marquee.outline`, 3.39 (1)) with its alphas in it, so
    // this is one drawImage per frame and no scratch.
    const tint = Marquee.rect() && Marquee.tint;
    if (tint) {
      const sh = Marquee.sheet();
      g.drawImage(tint, view.ox, view.oy, sh.W * view.sc, sh.H * view.sc);
    }
    // Two passes so the outline reads on both a white sheet and a black one.
    g.lineWidth = 3; g.strokeStyle = "rgba(8,10,14,.75)"; g.setLineDash([]);
    g.strokeRect(x + .5, y + .5, w, h);
    g.lineWidth = 1; g.strokeStyle = "#e8ecf2"; g.setLineDash([5, 4]);
    g.strokeRect(x + .5, y + .5, w, h);
    g.setLineDash([]);
    // Handles only on a rectangle, and not while the lasso is the kind. `down` refuses them for a
    // shape and the lasso never looks for one, so drawing them would be an offer the tool does not keep.
    if (SelectUI.on && !tint && SelectUI.kind !== "lasso") {
      const k = 7;
      for (const [, kx, ky] of Marquee.HANDLES) {
        const hx = x + w * kx, hy = y + h * ky;
        g.fillStyle = "#e8ecf2"; g.strokeStyle = "rgba(8,10,14,.85)"; g.lineWidth = 1;
        g.fillRect(Math.round(hx - k / 2), Math.round(hy - k / 2), k, k);
        g.strokeRect(Math.round(hx - k / 2) + .5, Math.round(hy - k / 2) + .5, k - 1, k - 1);
      }
    }
    // The size, on the rectangle itself — the panel carries the same four numbers, but the place you
    // are looking while you drag is the rectangle. It goes with the tool for the same reason the dim
    // does: with the tool off it is a label on something you are no longer adjusting.
    if (SelectUI.on) {
      const label = r.w + " × " + r.h;
      g.font = "600 11px system-ui, sans-serif";
      const tw = g.measureText(label).width + 10;
      const ly = y > 20 ? y - 17 : y + 3;
      g.fillStyle = "rgba(8,10,14,.8)";
      g.fillRect(x, ly, tw, 15);
      g.fillStyle = "#e8ecf2"; g.textBaseline = "top";
      g.fillText(label, x + 5, ly + 2);
    }
    g.restore();
  },

  // ---- the panel ----
  sync(){
    const r = Marquee.rect();
    // An outline half drawn goes with its sheet, the way the selection does: `selectSlot` syncs this
    // panel on the switch, so the outline is not left drawn over a texture it does not belong to.
    if (SelectUI.lasso && SelectUI.lasso.slot !== App.activeSlot) SelectUI.lasso = null;
    // The panel STAYS. It used to appear when the tool came on and vanish when it went off, so
    // every press of M or K moved a whole section of the sidebar under the cursor and jumped the
    // panels below it — reported 2026-09-01 as "popping in and out … does not seem to be user
    // friendly". It is a place now, the way the Brush panel above it is: with nothing selected the
    // verbs disable themselves, which says "no selection" without taking the controls away.
    const sec = $("selSection");
    if (sec) sec.style.display = "";
    // A selection is shown on the MODEL too (view3d/sel-overlay.js), and the viewport only draws a
    // frame when something asks for one.
    needsRender();
    for (const id of ["btnSel2d", "btnSelMode"]) {
      const b = $(id);
      if (b) { b.textContent = "Select: " + (SelectUI.on ? "on" : "off"); b.classList.toggle("active", SelectUI.on); }
    }
    for (const [id, k, word] of SelectUI.KINDS) {
      const b = $(id);
      if (!b) continue;
      b.textContent = word + ": " + (SelectUI.kind === k ? "on" : "off");
      b.classList.toggle("active", SelectUI.kind === k);
      // NOT disabled when there is no model. `sync` runs when the tool is switched on, not when a
      // vehicle finishes loading, so a disabled state set before the load would sit there afterwards
      // — a button that is off for a reason that has gone away. `pickIsland` says what is missing
      // instead, which is §4's rule and is also true whenever it is read.
    }
    // The wand's two settings are a row of their own that is there only while the wand is — the way
    // the Brush panel shows Clone's row only for Clone — so the panel stays four rows otherwise.
    const wr = $("selWandRow");
    if (wr) wr.style.display = SelectUI.kind === "wand" ? "" : "none";
    const tv = $("selTolVal");
    if (tv) tv.textContent = String(SelectUI.tol());
    // Never fight the field the user is typing in — sync runs on every drag frame.
    const num = (id, v) => {
      const e = $(id);
      if (!e || document.activeElement === e) return;
      e.value = r ? String(v) : "";
      e.disabled = !r;
    };
    num("selX", r && r.x); num("selY", r && r.y); num("selW", r && r.w); num("selH", r && r.h);
    for (const id of SelectUI.VERBS) { const b = $(id); if (b) b.disabled = !r; }
    // The two bridges (4.28(g)). They are not in VERBS because they are enabled by different
    // questions: one needs a selection of ANY grain — a rectangle, an island or a set of parts —
    // and the other needs a mask on the selected layer and no selection at all.
    const tm = $("btnSelToMask"), fm = $("btnSelFromMask");
    const AL = activeLayerObj();
    if (tm) tm.disabled = !Marquee.any() || !AL || isGroup(AL);
    if (fm) fm.disabled = !AL || isGroup(AL) || !AL.mask;
    const n = Marquee.shape() && Marquee.islands ? Marquee.islands.size : 0;
    // The parts half of the same question, in the same panel. It was two panels in two tabs, and
    // that is most of what made moving between the two grains feel like changing tools.
    const np = App.selParts ? App.selParts.size : 0;
    const pi = $("selPartInfo");
    if (pi) pi.textContent = np ? np + " part" + (np === 1 ? "" : "s") + " selected"
                                : "None — the brush paints everywhere";
    const bfp = $("btnSelFromParts"); if (bfp) bfp.disabled = !np;
    const btp = $("btnSelToParts"); if (btp) btp.disabled = !n;
    // ROADMAP 3.30 (B): All / None / Invert act on the grain that is live — the area while the
    // Select tool is on, the parts otherwise — and the row says which, so nothing is a hidden mode.
    const gl = $("selGrainLabel");
    if (gl) gl.textContent = SelectUI.on ? "area:" : "parts:";
    const inv = $("btnSelInvert"); if (inv) inv.disabled = SelectUI.on;
    const none = $("btnSelNone"); if (none) none.disabled = SelectUI.on ? !r : !np;   // the live grain's own emptiness
    const all = $("btnSelAll"); if (all) all.disabled = false;
    // 3.39 (3): the overlay can be put away, and a hidden one is said here for as long as it is —
    // the status line's word on the toggle is gone at the next message.
    const sb = $("btnSelShow");
    if (sb) { sb.textContent = Marquee.shown ? "Hide" : "Show"; sb.classList.toggle("active", !Marquee.shown); }
    const info = $("selInfo");
    if (info) info.textContent = SelectUI.infoText(r, n) +
      (r && !Marquee.shown ? " Hidden — H shows it; the brush still keeps inside it." : "");
  },
  // H and the panel's Hide / Show button.
  toggleShown(){
    Marquee.setShown(!Marquee.shown);
    setStatus(Marquee.shown ? "Selection outline shown again"
      : Marquee.rect() ? "Selection hidden — it still limits the brush and the Fill / Clear / Crop / Copy buttons. H shows it again"
      : "Selection and decal outlines hidden — H shows them again", "ok");
  },
  // What to do next with the kind in hand, when nothing is selected yet.
  HINTS: {
    box: "Drag a rectangle over the sheet in the 2-D view.",
    island: "Click a UV island in either view — or drag here for a rectangle.",
    lasso: "Drag round an area for a freehand outline, or click corner by corner and close on the first corner, with a double-click or Enter.",
    wand: "Click a colour on the sheet, or Ctrl+click it on the model — everything within Tolerance of it is selected. A drag still makes a rectangle.",
  },
  infoText(r, n){
    const L = SelectUI.lasso;
    if (L && !L.free) return L.pts.length + " corner" + (L.pts.length === 1 ? "" : "s") +
      " — click the first corner, double-click or press Enter to close; Backspace takes one back, Esc drops it.";
    if (n) return n + " UV island" + (n === 1 ? "" : "s") + " selected, inside a " + r.w + " × " + r.h +
      " box. The brush, Fill, Clear, Crop and Copy all follow the island itself, not the box.";
    // Any other shape — a lasso's, a wand's, a path's, a mask's. It used to be described as its box,
    // "W × H texels selected", which is exactly the misreading the island line above exists to stop.
    if (r && Marquee.shape()) return "A shape is selected, inside a " + r.w + " × " + r.h +
      " box. The brush, Fill, Clear, Crop and Copy all follow the shape itself, not the box.";
    if (r) return r.w + " × " + r.h + " texels selected. The brush is confined to it until you clear it.";
    return SelectUI.on ? SelectUI.HINTS[SelectUI.kind] || "" : "";
  },
  // The four boxes are the same rectangle from the other side: typing is how you get an exact size
  // out of a gesture that is only ever as exact as a mouse.
  fromFields(){
    const sh = Marquee.sheet();
    if (!sh) return;
    const v = id => { const e = $(id); return e ? parseFloat(e.value) : NaN; };
    const x = v("selX"), y = v("selY"), w = v("selW"), h = v("selH");
    if (![x, y, w, h].every(n => isFinite(n))) { SelectUI.sync(); return; }
    Marquee.act("set selection", () => Marquee.set({ x, y, w, h }));
    if (!Marquee.rect()) setStatus("A selection has to be at least one texel across", "err");
  },
};
// Both buttons are the same switch, exactly like Paint's pair over the two views.
$("btnSel2d").onclick = () => SelectUI.setOn(!SelectUI.on);
$("btnSelMode").onclick = () => SelectUI.setOn(!SelectUI.on);
$("btnSelIsland").onclick = () => SelectUI.setIslandMode(!SelectUI.island);
$("btnSelLasso").onclick = () => SelectUI.toggleKind("lasso");
$("btnSelWand").onclick = () => SelectUI.toggleKind("wand");
$("selTol").addEventListener("input", () => { $("selTolVal").textContent = String(SelectUI.tol()); });
cnv2.addEventListener("dblclick", () => SelectUI.dblLasso());
$("btnSelFromParts").onclick = () => SelectUI.fromParts();
$("btnSelToParts").onclick = () => SelectUI.toParts();
$("btnSelToMask").onclick = () => Marquee.toMask();
$("btnSelFromMask").onclick = () => Marquee.fromMask();
// The three verbs of the live grain (3.30): Ctrl+A and Esc stay the AREA's keys, so those two
// still reach for the tool; the buttons follow the panel's own label.
$("btnSelAll").onclick = () => { if (SelectUI.on) Marquee.act("select all", () => Marquee.all()); else selectAllParts(); };
$("btnSelShow").onclick = () => SelectUI.toggleShown();
$("btnSelNone").onclick = () => { if (SelectUI.on) Marquee.act("clear selection", () => Marquee.none()); else partAction("clear selection", () => { App.selParts.clear(); App.selAnchor = null; }); };
$("btnSelInvert").onclick = () => { if (!SelectUI.on) invertPartSelection(); };
$("btnSelFill").onclick = () => Marquee.fill();
$("btnSelClear").onclick = () => Marquee.erase();
$("btnSelCrop").onclick = () => Marquee.crop();
$("btnSelCopy").onclick = () => Marquee.copy();
for (const id of ["selX", "selY", "selW", "selH"]) {
  const e = $(id);
  e.addEventListener("change", () => SelectUI.fromFields());
  e.addEventListener("blur", () => SelectUI.sync());
}
SelectUI.sync();
