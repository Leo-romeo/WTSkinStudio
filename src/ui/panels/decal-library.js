// ---- Decal library widgets ----
// Gathered on one object rather than spread across a dozen top-level names: the library dialog is
// the shell, and every piece of it that builds an element lives here. `ctx` is the dialog's own
// state — { path, render, goTo, moveInto, close } — passed in rather than closed over, so each of
// these is short enough to read on its own.
const DecalUI = {
  // Inline SVG, never emoji — an emoji folder renders differently on every platform (CLAUDE.md §4).
  folderIcon(open){
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", open
      ? "M3 8V6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v1M3 8h17l-2 10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Z"
      : "M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z");
    svg.appendChild(p);
    return svg;
  },
  hint(text){ const d = document.createElement("div"); d.className = "hint"; d.textContent = text; return d; },
  // Accept a dragged decal. `dragover` MUST be cancelled or the browser refuses the drop outright.
  acceptDrop(el, onIds, onHover){
    el.addEventListener("dragover", e => { e.preventDefault(); onHover ? onHover(true) : el.classList.add("drop"); });
    el.addEventListener("dragleave", () => { onHover ? onHover(false) : el.classList.remove("drop"); });
    el.addEventListener("drop", e => {
      e.preventDefault();
      onHover ? onHover(false) : el.classList.remove("drop");
      const id = e.dataTransfer.getData("text/wtss-decal");
      if (id) onIds([id]);
    });
    return el;
  },
  folderCard(label, count, opts){
    const card = document.createElement("div");
    card.className = "card folder" + (opts.up ? " up" : "");
    card.appendChild(this.folderIcon(!!opts.up));
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = label;
    card.appendChild(nm);
    if (count != null) {
      const c = document.createElement("div"); c.className = "cnt";
      c.textContent = count === 1 ? "1 decal" : count + " decals";
      card.appendChild(c);
    }
    card.onclick = opts.onOpen;
    if (opts.onDropIds) this.acceptDrop(card, opts.onDropIds);
    return card;
  },
  // The thumbnail is drawn asynchronously out of IndexedDB. A failure has to show, not leave a
  // blank square that reads as "this decal is empty" (CLAUDE.md §4: errors are never silent).
  thumb(meta, c){
    DecalLib.get(meta.id)
      .then(rec => rec ? blobToCanvas(rec.png) : Promise.reject(new Error("missing from storage")))
      .then(img => {
        const g = c.getContext("2d");
        const k = Math.min(c.width / img.width, c.height / img.height);
        g.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
      })
      .catch(e => {
        const g = c.getContext("2d");
        g.fillStyle = "#3a2020"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#e05555"; g.font = "9px system-ui"; g.textAlign = "center";
        g.fillText("no preview", c.width / 2, c.height / 2 + 3);
        c.title = "Could not draw this decal: " + e.message;
        console.warn("decal thumbnail", meta.id, e);
      });
  },
  decalCard(meta, ctx, showPath){
    const card = document.createElement("div"); card.className = "card";
    card.draggable = true;
    card.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/wtss-decal", meta.id);
      e.dataTransfer.effectAllowed = "move";
    });
    const c = document.createElement("canvas"); c.width = 96; c.height = 76;
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = meta.name;
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.title = "Delete from library";
    del.onclick = async ev => { ev.stopPropagation(); await DecalLib.remove(meta.id); ctx.render(); };
    card.append(del, c, nm);
    if (showPath) {
      const p = document.createElement("div"); p.className = "path";
      p.textContent = DecalTree.norm(meta.folder) || "top level";
      card.appendChild(p);
    }
    // A variant that looks exactly like a separate decal is not a variant of anything as far as the
    // user can tell, so the family is stated on the card itself.
    const tag = this.variantTag(meta, ctx.idx);
    if (tag) { const t = document.createElement("div"); t.className = "vtag"; t.textContent = tag; card.appendChild(t); }
    card.title = meta.name + " · " + meta.w + "×" + meta.h +
      (meta.surf && meta.surf.preset ? " · " + meta.surf.preset : "") + (tag ? " · " + tag : "") +
      "\nClick to select · double-click to use · drag onto a folder to move it";
    // Click SELECTS; Use and Edit are then offered in the footer. It used to place the decal on the
    // model outright, which left the library with exactly one thing it could do with a decal: the
    // one that needs a vehicle loaded. Looking at one, tidying one or editing one had no click.
    card.onclick = () => ctx.select(meta, card);
    card.ondblclick = () => { ctx.select(meta, card); ctx.use(meta); };
    if (ctx.selected && ctx.selected.id === meta.id) card.classList.add("sel");
    this.thumb(meta, c);
    return card;
  },
  // "3 variants" on the original, "variant of X" on the branches.
  variantTag(meta, idx){
    if (meta.base) {
      const base = (idx || []).find(d => d.id === meta.base);
      return "variant of " + (base ? base.name : "a deleted decal");
    }
    const n = DecalTree.variantsOf(idx || [], meta.id).length;
    return n ? (n === 1 ? "1 variant" : n + " variants") : "";
  },
  // Breadcrumbs double as drop targets: dragging a decal onto an ancestor moves it up the tree,
  // which is the gesture people try first and the only way back out of a deep folder by drag.
  crumbs(el, ctx){
    el.textContent = "";
    const segs = DecalTree.segs(ctx.path);
    const step = (label, to, last) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = last;
      if (!last) {
        b.onclick = () => ctx.goTo(to);
        this.acceptDrop(b, ids => ctx.moveInto(ids, to), on => { b.style.color = on ? "var(--ok)" : ""; });
      }
      el.appendChild(b);
    };
    step("Library", "", segs.length === 0);
    segs.forEach((s, i) => {
      const sep = document.createElement("span"); sep.className = "sepc"; sep.textContent = "›";
      el.appendChild(sep);
      step(s, segs.slice(0, i + 1).join("/"), i === segs.length - 1);
    });
  },
  // Rename / delete, offered on right-click. Deleting asks what to do with the contents rather
  // than picking for you — "keep them" and "take them with it" are both things people mean.
  async folderMenu(sub, ctx){
    const inside = DecalTree.count(await DecalLib.index(), sub);
    const what = await choiceDialog("Folder “" + sub + "” — " + inside + " decal(s) inside.",
      [{ label: "Rename…", value: "rename", primary: true },
       { label: "Delete, keep contents", value: "up" },
       { label: "Delete with contents", value: "all" },
       { label: "Cancel", value: null }]);
    if (!what) return;
    if (what === "rename") return this.renameFolder(sub, ctx);
    if (what === "all" && inside) {
      const sure = await choiceDialog("Delete “" + sub + "” and the " + inside + " decal(s) in it? This cannot be undone.",
        [{ label: "Delete everything", value: "yes" }, { label: "Cancel", value: null, primary: true }]);
      if (sure !== "yes") return;
    }
    const gone = await DecalLib.removeFolder(sub, what);
    if (DecalTree.isUnder(ctx.path, sub)) ctx.goTo(DecalTree.parent(sub));
    setStatus(what === "all" ? "Deleted “" + sub + "” and " + gone + " decal(s)" : "Deleted “" + sub + "”, kept its contents", "ok");
    ctx.render();
  },
  async renameFolder(sub, ctx){
    const n = await promptValue("New name for “" + DecalTree.name(sub) + "”", DecalTree.name(sub));
    if (n == null) return;
    const to = await DecalLib.renameFolder(sub, n);
    if (!to) { setStatus("That name is empty, or already used by a folder beside it", "err"); return; }
    if (DecalTree.isUnder(ctx.path, sub)) ctx.goTo(to + ctx.path.slice(sub.length));
    else ctx.render();
  },
  // The grid itself: breadcrumbs, an up card when nested, subfolders, then the decals in this
  // folder. A search replaces the whole view with flat results from every folder — a library you
  // have to navigate in order to find anything is worse than a flat one.
  async renderGrid(grid, crumbs, ctx){
    let idx, folders;
    try { idx = await DecalLib.index(); folders = await DecalLib.folders(); }
    catch (e) { grid.textContent = ""; grid.appendChild(DecalUI.hint("Could not read the decal library: " + e.message)); return; }
    ctx.idx = idx;                                       // the cards need it to name families
    // A selection that has been deleted (here or in another tab) must not keep the footer buttons
    // live — they would act on a decal that is no longer in the library.
    if (ctx.selected) ctx.selected = idx.find(d => d.id === ctx.selected.id) || null;
    DecalUI.crumbs(crumbs, ctx);
    grid.textContent = "";
    const hits = DecalTree.search(idx, ctx.query);
    if (hits) {                                          // searching: flat results from everywhere
      if (!hits.length) grid.appendChild(DecalUI.hint("Nothing matches “" + ctx.query + "”."));
      for (const meta of hits) grid.appendChild(DecalUI.decalCard(meta, ctx, true));
      return;
    }
    if (ctx.path) grid.appendChild(DecalUI.folderCard("..", null, {
      up: true,
      onOpen: () => ctx.goTo(DecalTree.parent(ctx.path)),
      onDropIds: ids => ctx.moveInto(ids, DecalTree.parent(ctx.path)),
    }));
    const subs = DecalTree.children(folders, idx, ctx.path);
    for (const sub of subs) {
      const card = DecalUI.folderCard(DecalTree.name(sub), DecalTree.count(idx, sub), {
        onOpen: () => ctx.goTo(sub),
        onDropIds: ids => ctx.moveInto(ids, sub),
      });
      card.oncontextmenu = e => { e.preventDefault(); DecalUI.folderMenu(sub, ctx); };
      card.title = sub + "\nRight-click to rename or delete · drag decals onto it to move them";
      grid.appendChild(card);
    }
    const here = DecalTree.decalsIn(idx, ctx.path);
    for (const meta of here) grid.appendChild(DecalUI.decalCard(meta, ctx, false));
    // the ".." card is not content — a folder holding only it still reads as empty
    if (!here.length && !subs.length) grid.appendChild(DecalUI.hint(idx.length
      ? "This folder is empty — drag decals onto a folder card to move them in, or use New folder."
      : "Nothing saved yet — open an image with “Img”, clean it up in the decal editor and press Save to library."));
  },
  // The decal editor's "Surface response" rows: the Look select, the generated-_n preview toggle,
  // and the note saying what choosing a Look actually does. Here for the same reason folderSelect
  // is — `openDecalEditor` is the longest function in the app (ROADMAP 2.4) and this section is the
  // one that has to keep explaining itself, so it should not be the one growing that function.
  //
  // `st` is the editor's own state object: this reads and writes `st.surf` and `st.nPrev` on it,
  // and calls `redraw()` when the preview has to be rebuilt. Returns the three elements to place.
  surfaceSection(st, redraw){
    const note = DecalUI.hint("");
    // What the Look does, said where it is chosen. It APPLIES (ROADMAP 4.8 in full) and it now
    // survives a projection too (4.8b), so the exception this paragraph used to name is gone. The
    // wording stays explicit about the numbers, because the interim fix's lesson holds: this control
    // was reported precisely because it implied an effect nobody could find.
    // "own" is a decal's Look that no preset has the numbers of (`st.own`, its deltas) — offered as
    // an option so the select never names a preset the decal does not carry (4.2b's review).
    const say = () => {
      const own = st.surf === "own", p = own ? st.own : SURF_PRESETS[st.surf];
      note.textContent = (p.sm || p.mt || p.em || p.wr)
        ? (own ? "This decal keeps its own Look: a Gloss " : "Placing this decal also gives it a Gloss ") + (p.sm >= 0 ? "+" : "") + p.sm + ", Metal " + (p.mt >= 0 ? "+" : "") + p.mt +
          ", Emboss " + p.em + (p.wr ? ", Paint " + (p.wr > 0 ? "+" : "") + p.wr : "") + " surface response, inside the decal's own layer beside its colour — it moves, hides, fades" +
          " and deletes with the decal, and the slot's own _n sheets are never written." +
          " Projecting it onto the model carries the look with it, onto every texture it lands on."
        : "No surface change: the _n map is left exactly as it is.";
    };
    const sel = fillSurfPresets(document.createElement("select"));
    if (st.own) {
      const o = document.createElement("option"); o.value = "own"; o.textContent = "Custom (this decal's own)";
      sel.appendChild(o);
    }
    sel.style.flex = "1";
    sel.title = "How the surface under this decal responds — gloss, metal and a raised edge. It changes this image not at all; the response arrives as its own layers when the decal is placed.";
    sel.value = st.surf;                       // re-opening a saved decal starts from ITS look, not the default
    sel.onchange = () => { st.surf = sel.value; say(); if (st.nPrev) redraw(); };
    const preview = document.createElement("label");
    preview.style.cssText = "font-size:11.5px;display:flex;gap:5px;align-items:center";
    preview.title = "Shows the normal map an emboss of this size makes from the image's alpha. A preview only — the emboss layer derives its own from wherever the decal ends up.";
    const cb = document.createElement("input"); cb.type = "checkbox";
    cb.onchange = () => { st.nPrev = cb.checked; redraw(); };
    preview.append(cb, document.createTextNode("Preview generated _n"));
    say();
    return { sel, preview, note };
  },
  // The "save into which folder" control in the decal editor. Kept here so the editor's footer is
  // one line and this can grow (a new-folder option, remembering the last choice) on its own.
  folderSelect(){
    const NEW = "\u0000new";
    const sel = document.createElement("select");
    sel.title = "Folder in your decal library to save this into";
    sel.style.maxWidth = "160px";
    sel.fill = async () => {
      let all = [];
      try { all = DecalTree.all(await DecalLib.folders(), await DecalLib.index()); }
      catch (e) { setStatus("Could not read the decal library's folders: " + e.message, "err"); }
      const want = DecalTree.norm(App.decalFolder || "");
      sel.textContent = "";
      for (const [v, label] of [["", "Top level"], ...all.map(f => [f, f]), [NEW, "New folder…"]]) {
        const o = document.createElement("option");
        o.value = v; o.textContent = label;
        sel.appendChild(o);
      }
      sel.value = all.includes(want) ? want : "";
    };
    sel.chosen = () => (sel.value === NEW ? "" : sel.value);
    sel.onchange = async () => {
      if (sel.value !== NEW) { App.decalFolder = sel.value; return; }
      const n = await promptValue("Name for the new folder", "");
      const target = DecalTree.join("", n == null ? "" : n);
      if (target) { await DecalLib.addFolder(target); App.decalFolder = target; }
      await sel.fill();
    };
    sel.fill();
    return sel;
  },
};
// ---------- The decal library dialog, as named steps on one object (ROADMAP 2.4) ----------
// `openDecalLibrary` was 90 lines: a bar, a grid, seven verbs closed over one `ctx`, and a footer
// whose two buttons each needed the selection. The verbs are methods on `DecalLibUI` now — one
// binding rather than seven more in the shared scope (§5.6) — and the `ctx` that was the closure's
// captured state is an explicit argument, the same shape `Composite` and `PoseApply` use.
//
// `tools/t35_decallib.mjs` drives the real dialog against real IndexedDB — folders, crumbs, search
// from inside a folder, a decal named `<img onerror=…>` staying text — so this split is gated by
// behaviour rather than by markup, which is why it needed no new fixture.
const DecalLibUI = {
  // The top bar: where you are, what you are looking for, and a way to make a folder here.
  bar(ctx){
    const bar = document.createElement("div"); bar.className = "decbar";
    const crumbs = document.createElement("div"); crumbs.className = "crumbs";
    const search = document.createElement("input");
    search.type = "search"; search.placeholder = "Search all folders…";
    search.oninput = () => { ctx.query = search.value; ctx.render(); };
    const bNew = document.createElement("button");
    bNew.textContent = "New folder";
    bNew.onclick = () => DecalLibUI.newFolder(ctx);
    bar.append(crumbs, search, bNew);
    ctx.search = search;
    return { bar, crumbs };
  },
  async newFolder(ctx){
    const n = await promptValue("Name for the new folder inside " +
      (ctx.path ? "“" + DecalTree.name(ctx.path) + "”" : "the library"), "");
    if (n == null) return;
    const target = DecalTree.join(ctx.path, n);
    if (!target) { setStatus("A folder needs a name", "err"); return; }
    await DecalLib.addFolder(target);
    ctx.goTo(target);
  },
  // The verbs the grid and the footer call. They are hung on `ctx` because that is what
  // `DecalUI.renderGrid` is given and what every card's handler closes over.
  verbs(ctx, dlg, grid){
    ctx.goTo = p => {
      ctx.path = DecalTree.norm(p);
      App.decalFolder = ctx.path;
      ctx.query = ""; ctx.search.value = "";
      ctx.render();
    };
    ctx.moveInto = async (ids, target) => {
      await DecalLib.moveTo(ids, target);
      setStatus("Moved to " + (target ? "“" + target + "”" : "the top level"), "ok");
      ctx.render();
    };
    // Selecting is not rendering: a full re-render would rebuild every card and redraw every
    // thumbnail out of IndexedDB, so a click would flash the whole grid. Move the class instead.
    ctx.select = (meta, el) => {
      ctx.selected = meta;
      grid.querySelectorAll(".card.sel").forEach(c => c.classList.remove("sel"));
      if (el) el.classList.add("sel");
      ctx.syncActions();
    };
    ctx.use = async meta => {
      const rec = await DecalLib.get(meta.id);
      if (!rec) { setStatus("That decal is missing from storage", "err"); return; }
      dlg.close();
      DecalCarry.place(await blobToCanvas(rec.png), { name: rec.name, surf: rec.surf,
        height: rec.depth ? await blobToCanvas(rec.depth) : null, heightName: rec.depthName || null, text: rec.text || null });
    };
    // Editing opens the editor OVER the library, on the stored record, knowing which row it came
    // from — that is what turns its Save button into overwrite / variant / new.
    ctx.edit = async meta => {
      const rec = await DecalLib.get(meta.id);
      if (!rec) { setStatus("That decal is missing from storage", "err"); return; }
      App.decalFolder = DecalTree.norm(meta.folder);
      // Saved text opens as text (4.50 (3)), in its own font once that is back from storage.
      if (rec.text) await TextDecal.ensureFont(rec.text.fontId);
      openDecalEditor(await blobToCanvas(rec.png), rec.name,
        (canvas, m) => { dlg.close(); DecalCarry.place(canvas, m, rec.name); },
        { from: { ...meta, name: rec.name, surf: rec.surf }, onSaved: () => ctx.render(),
          look: rec.surf, height: rec.depth ? await blobToCanvas(rec.depth) : null, heightName: rec.depthName || null,
          text: rec.text || null });
    };
  },
  // The footer: what the selection can be done with, and a sentence saying where these live.
  foot(ctx, dlg){
    const bFile = document.createElement("button");
    bFile.textContent = "Add from file…";
    bFile.title = "Imported decals are saved into the folder you are in";
    bFile.onclick = () => { dlg.close(); $("decalPick").click(); };
    // Lettering made here is filed like any decal (4.50 (3)): the text editor opens over the library,
    // Save puts it in the folder you are in, and Use closes the library and places it.
    const bText = document.createElement("button");
    bText.textContent = "New text…";
    bText.title = "Letter a serial, a code or a name, in any installed font or one you load — it stays editable as text";
    bText.onclick = () => TextUI.open({ onSaved: () => ctx.render(), onUse: () => dlg.close() });
    const grow = document.createElement("span"); grow.className = "grow";
    grow.textContent = "Saved decals live in this browser, so they survive reloads and other projects.";
    const bEdit = document.createElement("button"); bEdit.textContent = "Edit…";
    const bUse = document.createElement("button"); bUse.className = "primary"; bUse.textContent = "Use";
    // Long names would stretch the footer off the dialog; the card and its tooltip carry the full one.
    const short = n => (n.length > 22 ? n.slice(0, 21) + "…" : n);
    ctx.syncActions = () => {
      const m = ctx.selected;
      bUse.disabled = bEdit.disabled = !m;
      bUse.textContent = m ? "Use “" + short(m.name) + "”" : "Use";
      bUse.title = m ? "Put it on the cursor, then click the model to place it" : "Select a decal first";
      bEdit.title = m ? "Open “" + m.name + "” in the decal editor first — no vehicle needs to be loaded"
        : "Select a decal first";
    };
    bEdit.onclick = () => { if (ctx.selected) ctx.edit(ctx.selected); };
    bUse.onclick = () => { if (ctx.selected) ctx.use(ctx.selected); };
    const bClose = document.createElement("button"); bClose.textContent = "Close"; bClose.onclick = dlg.close;
    dlg.foot.append(bFile, bText, grow, bClose, bEdit, bUse);
  },
};
async function openDecalLibrary(){
  const dlg = modalDialog("Decal library", { width: "760px" });
  // The folder you were last in is remembered, because saving a run of roundels one at a time and
  // being dropped back at the top level every time is the whole reason folders were wanted.
  const ctx = { path: DecalTree.norm(App.decalFolder || ""), query: "" };
  const { bar, crumbs } = DecalLibUI.bar(ctx);
  const grid = document.createElement("div"); grid.className = "declib";
  dlg.body.append(bar, grid);
  DecalLibUI.verbs(ctx, dlg, grid);
  ctx.render = async () => { await DecalUI.renderGrid(grid, crumbs, ctx); ctx.syncActions(); };
  DecalLibUI.foot(ctx, dlg);
  ctx.syncActions();
  ctx.render();
  return dlg;
}

