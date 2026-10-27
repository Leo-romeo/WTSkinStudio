// ---- Linked layers: one edit, every texture it lands on ----
// A part selection routinely straddles several textures — an F-4E's radiator fin has faces on
// the airframe sheet AND on f_4e_add, and a fill made in one slot left the others untouched, so
// the model came back with unpainted patches that looked like the fill had holes. A fill /
// adjustment / paint layer created from a selection is therefore created once per texture the
// selection touches and the copies share a `link` id, exactly the way a projected decal already
// shares `proj.id`: layerFamily() then routes every stack-level edit to all of them.
let linkSeq = 1;
function newLinkId(){ return "lnk" + (linkSeq++) + "_" + Date.now().toString(36); }
function linkSiblings(id){
  const out = [];
  if (!id) return out;
  for (const slot of App.slots.values())
    for (const L of layerLeaves(slot.layers)) if (L.link === id) out.push({ slot, L });
  return out;
}
// Which slots a set of part names actually has triangles on.
function slotsForParts(names){
  const out = new Set();
  if (!App.geomData || !names || !names.length) return out;
  const want = new Set(names);
  for (const gd of App.geomData) {
    if (!want.has(gd.name)) continue;
    const s = App.slots.get(App.matSlot.get(gd.mat));
    if (s && s.composite) out.add(s);
  }
  return out;
}
function familyApply(L, fn){
  for (const e of layerFamily(L)) { fn(e.L, e.slot); scheduleComposite(e.slot); }
}
// 26 px preview of what a layer actually contributes. Rebuilt lazily (see the thumb interval) —
// scaling a 4096² sheet down on every list refresh would cost more than the refresh.
function layerThumb(L, slot){
  const c = L._thumb && L._thumb.width === 26 ? L._thumb : (L._thumb = mkCanvas(26, 26));
  const g = c.getContext("2d");
  c.title = "";                              // a cached tile that failed last time and draws now
  g.clearRect(0, 0, 26, 26);
  g.fillStyle = "#2b2f36"; g.fillRect(0, 0, 26, 26);
  g.fillStyle = "#22252b";
  for (let y = 0; y < 26; y += 7) for (let x = 0; x < 26; x += 7) if (((x / 7) + (y / 7)) & 1) g.fillRect(x, y, 7, 7);
  try {
    // A group shows what it composites to — the cheap version: its visible leaves' content stacked
    // at thumbnail size, each at its own opacity, bottom first (ROADMAP 4.16(a)). Blend modes are
    // not honoured at 26 px; what the row has to answer is "which folder is this", not "what colour
    // exactly". Never cached: it costs a handful of 26 px draws, and caching it would mean
    // invalidating it on every edit, move and fold of anything inside.
    if (isGroup(L)) {
      for (const leaf of visibleLeaves(L.children)) { g.globalAlpha = leaf.opacity == null ? 1 : leaf.opacity; LayerList.paintThumb(g, leaf, slot); }
      g.globalAlpha = 1;
    } else LayerList.paintThumb(g, L, slot);
  } catch (e) {
    // Blank is what an empty layer looks like, so a thumbnail that threw used to render as the one
    // thing it definitely was not. The hatch says "could not draw", which is actionable.
    brokenThumb(c, e, "The thumbnail for “" + (L.name || "this layer") + "”");
  }
  L._thumbRev = (slot && slot.thumbRev) || 0;
  return c;
}
// ---------- The layer stack, as a tree ----------
// One object rather than a dozen new globals (§4): `refreshLayerList` was 91 lines and over the
// ceiling before groups, and drawing a tree needs recursion, a fold, and two drop zones per row.
// The entry point keeps its name because ten callers use it.
const LayerList = {
  rows: [],                       // render order, so a drag payload can name a node by number
  // One layer's content, at thumbnail size, over whatever is already on `g` — the part of a
  // thumbnail that is the layer rather than the checkerboard, so a group can stack its leaves.
  paintThumb(g, L, slot){
    if (L.type === "fill") {
      if (L.grad || L.pat) GradFill.thumbOf(g, LayerNode.only(L), 26);
      else { g.fillStyle = L.color; g.fillRect(0, 0, 26, 26); }
    } else if (L.type === "adjust" && L.fx) {
      // Levels, Curves… (4.50 (5)): the base through the kind's own tables, on the CPU — 676 texels
      if (!slot || !slot.baseC) return;
      const t = Composite.scratch("_fxThumb", 26, 26), tg = ctx2d(t);
      tg.clearRect(0, 0, 26, 26);
      tg.drawImage(slot.baseC, 0, 0, 26, 26);
      const T = Effect.table(LayerNode.only(L)), img = tg.getImageData(0, 0, 26, 26);
      if (T) { Effect.apply(T, img.data); tg.putImageData(img, 0, 0); }
      g.drawImage(t, 0, 0);
    } else if (L.type === "adjust") {
      g.filter = `hue-rotate(${L.hue}deg) saturate(${L.sat}%) brightness(${L.bright}%) contrast(${L.contrast}%)`;
      if (slot && slot.baseC) g.drawImage(slot.baseC, 0, 0, 26, 26);
      g.filter = "none";
    } else if (L.type === "paint" && L.canvas) g.drawImage(L.canvas, 0, 0, 26, 26);
    else if (L.type === "decal" && L.bmp) {
      const k = Math.min(26 / L.bmp.width, 26 / L.bmp.height);
      g.drawImage(L.bmp, (26 - L.bmp.width * k) / 2, (26 - L.bmp.height * k) / 2, L.bmp.width * k, L.bmp.height * k);
    }
  },
  // A group's fold state lives ON the group (`collapsed`), not in a Set beside it: a node that
  // moves takes its fold with it, and there is nothing to keep in sync when the tree changes shape.
  refresh(){
    const el = $("layerList");
    el.innerHTML = "";
    LayerList.rows = [];
    const s = App.activeSlot;
    if (!s) { el.innerHTML = '<div class="hint">Select a slot</div>'; refreshLayerProps(); return; }
    if (!s.layers.length) el.innerHTML = '<div class="hint">No layers — base texture only</div>';
    else if (!activeLayerObj()) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = "No layer selected — brushes write straight into the base texture. Click a layer to work inside it.";
      el.appendChild(h);
    }
    LayerList.stack(el, s, s.layers, 0);
    refreshLayerProps();
    updateBrushAvailability();
  },
  // Top of the stack first, which is how a layer list reads — so the array is walked backwards and
  // a group's children are drawn under it, indented.
  stack(el, s, nodes, depth, group){
    for (let i = nodes.length - 1; i >= 0; i--) {
      const L = nodes[i];
      el.appendChild(LayerList.row(s, L, depth));
      if (isGroup(L) && !L.collapsed) LayerList.stack(el, s, L.children, depth + 1, L);
    }
    el.appendChild(LayerList.tail(s, nodes, depth, group || null));
  },
  // ROADMAP 4.16(b). Every drop on a row means "above that row", and the array runs bottom-up, so
  // index 0 — the bottom of a list — had no row to be above and could not be reached by drag at
  // all; under an expanded group at the bottom every row belonged to the group, so "below the
  // group" did not exist either. Each list ends in its own strip: the slot's top level and each
  // open group's children, indented like the children, so the two bottoms are two targets.
  tail(s, nodes, depth, group){
    const t = document.createElement("div");
    t.className = "ldrop";
    if (depth) t.style.marginLeft = (depth * 13) + "px";
    t.dataset.depth = String(depth);
    t.title = group ? "Drop here to put a layer at the bottom of “" + group.name + "”" : "Drop here to put a layer at the bottom of the stack";
    t.addEventListener("dragover", ev => {
      if (!ev.dataTransfer.types.includes("application/x-wtss-layer")) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
      t.classList.add("over");
    });
    t.addEventListener("dragleave", () => t.classList.remove("over"));
    t.addEventListener("drop", ev => {
      const raw = ev.dataTransfer.getData("application/x-wtss-layer");
      if (raw === "") return;
      ev.preventDefault(); ev.stopPropagation();
      t.classList.remove("over");
      const node = LayerList.rows[+raw];
      if (!node) return;
      const bottom = nodes.find(n => n !== node) || null;      // the current bottom, which the drop goes UNDER
      reorderLayer(s, node, group, bottom);
    });
    return t;
  },
  row(s, L, depth){
    const d = document.createElement("div");
    d.className = "rowitem layer" + (L === App.activeLayer ? " sel" : "") + (isGroup(L) ? " grp" : "");
    d.draggable = true;
    d.dataset.row = String(LayerList.rows.push(L) - 1);
    if (depth) {
      d.style.paddingLeft = (6 + depth * 13) + "px";
      // One guide line per ancestor, at that ancestor's caret column, so the extent of a folder can
      // be seen without counting pixels of padding (4.16(c)).
      for (let k = 0; k < depth; k++) {
        const gl = document.createElement("span");
        gl.className = "lguide"; gl.style.left = (6 + k * 13 + 4) + "px";
        d.appendChild(gl);
      }
    }
    if (isGroup(L)) {
      const car = document.createElement("span");
      car.className = "lcaret" + (L.collapsed ? " closed" : "");
      car.title = L.collapsed ? "Show what is inside" : "Fold this group";
      car.onclick = ev => { ev.stopPropagation(); L.collapsed = !L.collapsed; LayerList.refresh(); };
      d.appendChild(car);
    } else {
      // The same box, drawing nothing. Without it a layer's eye sits where a group's caret would be
      // and the column zig-zags — a child ended up looking LESS indented than its own parent
      // (ROADMAP 4.9a). Reserving the slot is what makes the depth indent the only thing that moves.
      const sp = document.createElement("span");
      sp.className = "lcaret ghost";
      d.appendChild(sp);
    }
    d.appendChild(LayerList.eye(s, L));
    d.appendChild(LayerList.thumbs(s, L));
    const nm = document.createElement("span"); nm.className = "nm";
    if (isGroup(L)) nm.appendChild(LayerList.folderMark());
    nm.appendChild(document.createTextNode(L.name));
    nm.title = "Double-click to rename · right-click for more";
    d.appendChild(nm);
    d.appendChild(LayerList.dots(L));
    d.appendChild(LayerList.tag(L));
    d.onclick = () => { App.activeLayer = App.activeLayer === L ? null : L; LayerList.refresh(); draw2D(); };
    nm.ondblclick = ev => { ev.stopPropagation(); renameLayerPrompt(s, L); };
    d.oncontextmenu = ev => { ev.preventDefault(); App.activeLayer = L; LayerList.refresh(); layerMenu(ev, s, L); };
    LayerList.drag(d, s, L);
    return d;
  },
  eye(s, L){
    const eye = document.createElement("span");
    eye.className = "eye" + (L.visible ? "" : " off"); eye.textContent = "👁";
    eye.title = "Show / hide this layer · Alt+click to show only this one";
    eye.onclick = ev => {
      ev.stopPropagation();
      if (ev.altKey) {                                        // solo, like Substance's Alt-click
        // Solo is a statement about the whole slot, so it reaches every node at every depth — hiding
        // only the top-level siblings would leave a layer inside a group as invisible as before.
        const all = layerNodes(s.layers);
        const only = all.filter(x => x !== L).every(x => !x.visible) && L.visible;
        const before = all.map(x => x.visible);
        const apply = arr => { all.forEach((x, i) => x.visible = arr[i]); scheduleComposite(s); scheduleChannels(s); LayerList.refresh(); };
        // Soloing a layer inside a group has to keep the group itself visible, or the one thing
        // asked for is the one thing hidden.
        const after = all.map(x => only ? true : x === L || (isGroup(x) && nodeContains(x, L)));
        pushAction(only ? "unsolo layer" : "solo layer", () => apply(before), () => apply(after));
        apply(after);
        return;
      }
      const to = !L.visible;
      const apply = v => { familyApply(L, x => x.visible = v); LayerList.refresh(); };
      pushAction("toggle layer", () => apply(!to), () => apply(to));
      apply(to);
    };
    return eye;
  },
  // The folder glyph on a group row — inline SVG, never emoji (§4). Same 12 px box on every platform.
  folderMark(){
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("class", "fold"); svg.setAttribute("aria-label", "group");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M1.5 3.5h4.5l1.5 2h7v7.5h-13z");
    svg.appendChild(p);
    return svg;
  },
  thumbs(s, L){
    const th = document.createElement("span");
    th.style.cssText = "flex:0 0 auto;display:flex;line-height:0";
    // a group's preview is rebuilt on every refresh (see layerThumb); a leaf's is cached and the
    // stale ones are refreshed on the idle timer
    th.appendChild(isGroup(L) ? layerThumb(L, s) : (L._thumb || layerThumb(L, s)));
    // A masked layer shows its mask next to its content, the way a layer stack should: it is the
    // fastest way to see that something is masked and the shortest way to go and edit it.
    if (L.mask || L.maskRef) {
      const mth = layerMaskThumb(L, null, s);
      mth.style.cssText = "cursor:pointer;border-radius:3px;margin-left:2px";
      if (L.maskRef) {                                             // another layer's pixels (4.36)
        const src = LayerNode.byUid(s.layers, L.maskRef);
        mth.title = src ? "Masked by the layer “" + src.name + "” — its painted pixels are this mask, live"
                        : "Masked by a layer that is gone — nothing masks it now";
        mth.style.outline = "1px dashed " + (src ? "var(--accent)" : "var(--danger)");
        mth.onclick = ev => { ev.stopPropagation(); App.activeLayer = L; LayerList.refresh(); };
      } else {
        mth.title = "Layer mask — click to paint on it";
        mth.onclick = ev => { ev.stopPropagation(); App.activeLayer = L; LayerList.refresh(); editMaskWithBrush(); };
      }
      th.appendChild(mth);
    }
    return th;
  },
  // ROADMAP 4.28(e). The row used to end in a type tag — "paint", "fill", "Smoothness·fill" —
  // because a layer WAS a type and a channel. It is a bundle of per-channel content now, and a word
  // per channel would not fit five of them, so the row says which channels it carries as dots and
  // the tag keeps only what is still one fact about the whole layer. Every dot carries its channel
  // and its content kind in a title, and a channel the layer does not carry draws nothing at all —
  // an empty placeholder would make "carries three of five" unreadable at a glance, which is the
  // one thing this control exists to say.
  dots(L){
    const w = document.createElement("span");
    w.className = "cdots";
    if (isGroup(L)) return w;
    for (const ch of CHANNELS) {
      const c = LayerNode.contentOn(L, ch.id);
      if (!c) continue;
      const d = document.createElement("span");
      d.className = "cdot " + ch.id;
      d.title = ch.label + " — " + LayerNode.wordFor(c);
      w.appendChild(d);
    }
    return w;
  },
  tag(L){
    const bits = [];
    if (isGroup(L)) {
      const n = layerLeaves(L.children).length;
      bits.push("group", n + " layer" + (n === 1 ? "" : "s"));
    } else if (L.proj) bits.push("projected");
    if (L.blend !== "normal") bits.push(L.blend);
    if (!Scope.empty(Scope.of(L))) bits.push("▤ " + Scope.label(L));
    if (L.levels) bits.push(Levels.short(L.levels));             // limited to some mip levels (4.58)
    if (!isGroup(L) && LayerNode.channelsOf(L).some(ch => Levels.keyed(L.chans[ch]))) bits.push("by distance");   // a number keyed by level (4.58 (c))
    if (L.mask) bits.push("mask");
    const sibs = L.proj ? projSiblings(L.proj.id) : L.link ? linkSiblings(L.link) : [];
    if (sibs.length > 1) bits.push("×" + sibs.length + " tex");
    const tag = document.createElement("span");
    // No pill at all when there is nothing to put in it — an empty bordered oval on every ordinary
    // layer is the sort of thing that reads as a control you have failed to notice.
    if (bits.length) { tag.className = "tag"; tag.textContent = bits.join("·"); }
    if (L.projEmpty) { tag.textContent += "·empty here"; tag.style.opacity = ".55"; }
    // the row cuts a long tag short rather than the layer's name (index.html, `.layer .tag`)
    if (tag.textContent) tag.title = tag.textContent;
    return tag;
  },
  // Drag to reorder, and drag INTO a row. Every row has two drop zones: the middle third drops
  // INTO it — inside a group, or, on an ordinary layer, into a new group made of the two (ROADMAP
  // 4.16(b): the folder gets made without hunting for the Group button) — and the rest drops
  // above it. Shift is the way to say "above" over a row you meant to pass. The two are two
  // different things to look at: a line over the row for "above", the whole row lit for "into".
  drag(d, s, L){
    d.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("application/x-wtss-layer", d.dataset.row);
      ev.dataTransfer.effectAllowed = "move";
      d.style.opacity = ".5";
      $("layerList").classList.add("dragging");
    });
    d.addEventListener("dragend", () => {
      d.style.opacity = "";
      $("layerList").classList.remove("dragging");
      $("layerList").querySelectorAll(".layer").forEach(x => x.classList.remove("dropin", "dropabove"));
    });
    // clientHeight, not a constant, so the zone follows the row; the fallback is for a row that is
    // not laid out (a hidden tab), where the gesture cannot happen but the handler is still called.
    const inside = ev => { const h = d.clientHeight || 22; return !ev.shiftKey && ev.offsetY > h / 3 && ev.offsetY < h * 2 / 3; };
    d.addEventListener("dragover", ev => {
      if (!ev.dataTransfer.types.includes("application/x-wtss-layer")) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
      const into = inside(ev);
      d.classList.toggle("dropin", into);
      d.classList.toggle("dropabove", !into);
    });
    d.addEventListener("dragleave", () => d.classList.remove("dropin", "dropabove"));
    d.addEventListener("drop", ev => {
      const raw = ev.dataTransfer.getData("application/x-wtss-layer");
      if (raw === "") return;
      ev.preventDefault(); ev.stopPropagation();
      d.classList.remove("dropin", "dropabove");
      const node = LayerList.rows[+raw];
      if (!node || node === L) return;
      if (inside(ev)) {
        if (isGroup(L)) reorderLayer(s, node, L, null);       // into the group, on top of it
        else if (!nodeContains(node, L)) groupNodes(s, [L, node]);   // a new group of the two, the dragged one on top
      } else {
        // The list is drawn top-down and the array runs bottom-up, so "dropped on this row" means
        // "goes directly above it", which is the position AFTER it in the array.
        const own = nodeOwner(s.layers, L);
        reorderLayer(s, node, groupOwning(s.layers, L), own ? own.list[own.i + 1] || null : null);
      }
    });
  },
};
function refreshLayerList(){ LayerList.refresh(); }
// ---------- Making and unmaking groups ----------
// A group carries what a layer carries, and nothing else — no channel, because its children have
// their own and the case that matters is a marking whose colour, normal and smoothness move
// together (ROADMAP 4.9).
function newGroupNode(name){
  return { type: "group", name: name || "Group", children: [], visible: true, opacity: 1,
           blend: "normal", mask: null, parts: null, collapsed: false, uid: LayerNode.newUid() };
}
// Wrap `nodes` in a new group, in place: the group lands where the TOPMOST of them was, and they go
// in keeping their order. Undo is structural — it puts each node back in the list it came from, at
// the index it came from — so it has to be recorded before anything moves.
// `name` is for callers that know what the group is FOR — a decal's colour/normal/smoothness
// siblings want to be called after the decal. Left out, it is "Group N", numbered so two groups in
// a slot are told apart. Naming a one-layer group after its own child was tried and is worse: the
// list then shows two rows with the same name, one tagged "group" and one tagged "fill".
function groupNodes(s, nodes, name){
  if (!s || !nodes || !nodes.length) return null;
  // Only nodes that are really in this slot, and never a node already inside another of them: a
  // group and its own child cannot both be wrapped, or the child ends up in the group twice.
  // The "pressing Group on a decal wraps its surface FOLDER, not the decal" special case is gone
  // with the folder (ROADMAP 4.28(f)): a decal's response lives inside the decal now, so grouping
  // one cannot separate it from anything.
  const picked = nodes.filter(n => nodeOwner(s.layers, n) && !nodes.some(o => o !== n && nodeContains(o, n)));
  if (!picked.length) return null;
  const was = picked.map(n => { const o = nodeOwner(s.layers, n); return { n, list: o.list, i: o.i }; });
  const top = was.reduce((a, b) => (b.list === a.list && b.i > a.i) ? b : a, was[0]);
  const taken = new Set(layerNodes(s.layers).filter(isGroup).map(g => g.name));
  let n = 1;
  while (taken.has("Group " + n)) n++;
  const G = newGroupNode(name || ("Group " + n));
  const apply = () => {
    for (const w of was) { const o = nodeOwner(s.layers, w.n); if (o) o.list.splice(o.i, 1); }
    G.children = picked.slice();
    const at = Math.min(top.i, top.list.length);
    top.list.splice(at, 0, G);
    App.activeLayer = G;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  const undo = () => {
    const o = nodeOwner(s.layers, G);
    if (o) o.list.splice(o.i, 1);
    G.children = [];
    // Ascending index order, so each splice lands where it was measured rather than being pushed
    // along by the one before it.
    for (const w of was.slice().sort((a, b) => a.i - b.i))
      w.list.splice(Math.min(w.i, w.list.length), 0, w.n);
    App.activeLayer = picked[picked.length - 1];
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  pushAction("group layers", undo, apply);
  apply();
  setStatus(picked.length === 1 ? "“" + picked[0].name + "” is now in a group"
    : picked.length + " layers grouped — the group's opacity, blend and mask apply to all of them", "ok");
  return G;
}
// Dissolve a group, leaving its children where it was. The group node itself is kept by the undo
// closure, so redoing this and undoing it again puts the same object back rather than a copy.
function ungroupNode(s, G){
  if (!s || !isGroup(G)) return;
  const own = nodeOwner(s.layers, G);
  if (!own) return;
  const kids = G.children.slice(), list = own.list, at = own.i;
  // A group's own opacity, mask and blend have nowhere to go once it is gone. Say so rather than
  // drop them silently — that is the difference between ungrouping and losing work.
  const lost = [];
  if (G.opacity != null && G.opacity < 1) lost.push("opacity " + Math.round(G.opacity * 100) + "%");
  if (G.blend && G.blend !== "normal") lost.push("blend “" + G.blend + "”");
  if (G.mask || G.maskRef) lost.push("its mask");
  if (!Scope.empty(Scope.of(G))) lost.push("its part limit");
  if (G.levels) lost.push("mip levels (" + Levels.label(G.levels) + ")");      // 4.58
  const apply = () => {
    const o = nodeOwner(s.layers, G);
    if (o) o.list.splice(o.i, 1);
    const k = Math.min(o ? o.i : at, list.length);
    list.splice(k, 0, ...kids);
    G.children = [];
    App.activeLayer = kids[kids.length - 1] || null;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  const undo = () => {
    for (const n of kids) { const o = nodeOwner(s.layers, n); if (o) o.list.splice(o.i, 1); }
    G.children = kids.slice();
    list.splice(Math.min(at, list.length), 0, G);
    App.activeLayer = G;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  pushAction("ungroup", undo, apply);
  apply();
  setStatus(lost.length
    ? "Ungrouped — the group's " + lost.join(", ") + " could not be kept, because there is no group left to hold " + (lost.length === 1 ? "it" : "them")
    : "Ungrouped — " + kids.length + " layer" + (kids.length === 1 ? "" : "s") + " left where the group was",
    lost.length ? "err" : "ok");
}
// Move a node to another position in the stack (drag & drop in the list). `into` is the group to
// drop it inside, or null for the slot's top level; `before` is the node to land under, or null for
// the top of that list. Nodes rather than indices because the tree has no single index space, and
// because the undo has to put it back where it was even if the list has changed shape since
// (ROADMAP 4.9).
function reorderLayer(s, node, into, before){
  if (!node || node === before) return;
  if (into && (into === node || nodeContains(node, into))) return;   // a group cannot go inside itself
  // ROADMAP 4.18's refusal — "this layer is rebuilt from its decal, so it stays in the folder beside
  // it" — is DELETED rather than ported (4.28(f)). It existed because a decal and the layers derived
  // from it found each other by POSITION, so dragging either half out silently built a second set on
  // the next move. They are one node now: there is no gesture that can separate them, so there is
  // nothing to refuse and no rule for the user to learn.
  const was = nodeOwner(s.layers, node);
  if (!was) return;
  const wasBefore = was.list[was.i + 1] || null;
  const place = (target, mark) => {
    const own = nodeOwner(s.layers, node);
    if (own) own.list.splice(own.i, 1);
    const list = target ? target.children : s.layers;
    const at = mark ? list.indexOf(mark) : list.length;
    list.splice(at < 0 ? list.length : at, 0, node);
    App.activeLayer = node;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  const fromGroup = was.list === s.layers ? null : groupOwning(s.layers, node);
  pushAction("reorder layer", () => place(fromGroup, wasBefore), () => place(into, before));
  place(into, before);
}
// The group a node sits directly inside, or null if it is at the slot's top level.
function groupOwning(nodes, node){
  for (const g of layerNodes(nodes)) if (isGroup(g) && g.children.includes(node)) return g;
  return null;
}
function renameLayerPrompt(s, L){
  const was = L.name;
  const nn = (prompt("Layer name:", was) || "").trim();
  if (!nn || nn === was) return;
  const apply = v => { familyApply(L, x => x.name = v); refreshLayerList(); };
  pushAction("rename layer", () => apply(was), () => apply(nn));
  apply(nn);
}
// Small popup menu anchored at the pointer — used for the layer context menu.
function popupMenu(ev, items){
  const m = document.createElement("div");
  m.style.cssText = "position:fixed;z-index:200;background:var(--panel);border:1px solid var(--border);border-radius:6px;" +
    "padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:170px;font-size:12px";
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { const h = document.createElement("div"); h.style.cssText = "height:1px;background:var(--border);margin:4px 2px"; m.appendChild(h); continue; }
    const b = document.createElement("div");
    b.textContent = it.label;
    b.style.cssText = "padding:5px 8px;border-radius:4px;cursor:pointer;white-space:nowrap" + (it.danger ? ";color:var(--danger)" : "");
    b.onmouseenter = () => b.style.background = "var(--hover, #2a2e36)";
    b.onmouseleave = () => b.style.background = "";
    b.onclick = () => { close(); it.run(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(ev.clientX, innerWidth - r.width - 6) + "px";
  m.style.top = Math.min(ev.clientY, innerHeight - r.height - 6) + "px";
  const close = () => { m.remove(); document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc, true); };
  const out = e => { if (!m.contains(e.target)) close(); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", esc, true); }, 0);
}
function layerMenu(ev, s, L){
  const scoped = !Scope.empty(Scope.of(L));
  const grouped = isGroup(L);
  popupMenu(ev, [
    { label: "Rename…", run: () => renameLayerPrompt(s, L) },
    grouped ? null : { label: "Duplicate", run: () => duplicateLayer(s, L) },
    { label: "Export as image…", run: () => LayerExport.run(s, L) },
    // A saved stack (4.44's seventh candidate): this group or layer as a file, and a file back in
    // above the stack — through the same picker Add files uses, so a .wtstack lands the same way
    // dropped or picked.
    { label: grouped ? "Save group as stack…" : "Save layer as stack…", run: () => Stack.save(s, L) },
    { label: "Load a stack here…", run: () => pickFiles(Stack.EXT) },
    // Every layer of the texture, for another editor, and another editor's layers back in (4.50 (16)).
    // Whole-texture verbs in a layer's menu, beside the stack pair, because this is where someone
    // looking for "take my layers to Krita" is already standing; the slot's ⋮ menu has them too.
    { label: "Export all layers for another editor (.ora / .psd)…", run: () => Interchange.exportFile(s) },
    { label: "Import layers from an .ora or .psd…", run: () => pickFiles(Interchange.ACCEPT) },
    L.type === "paint" && !L.proj ? { label: "Clear pixels", run: () => clearPaintLayer(s, L) } : null,
    grouped ? null : { label: "Group this layer", run: () => groupNodes(s, [L]) },
    grouped ? { label: "Ungroup — keep its layers", run: () => ungroupNode(s, L) } : null,
    { sep: true },
    App.selParts.size ? { label: "Limit to " + App.selParts.size + " selected part(s)", run: () => setLayerScope(L, [...App.selParts]) } : null,
    scoped ? { label: "Select its parts in 3D", run: () => selectScopeParts(L) } : null,
    scoped ? { label: "Remove part limit", run: () => setLayerScope(L, null) } : null,
    { sep: true },
    // Which mip levels it shows at (ROADMAP 4.58): one click, split at Levels.CROSS, with how far that
    // is on this layer's own parts when a model is loaded. The Shows at row moves the split.
    ...Levels.menu(s, L),
    // ...and a number that varies from level to level (4.58 (c)): the panel's By distance row, opened
    !grouped && Levels.params(LayerNode.contentOn(L, LayerNode.workingChan(L))).length
      ? { label: "Vary with distance…", run: () => {
          LayerProps.keySel = { uid: L.uid, param: Levels.params(LayerNode.contentOn(L, LayerNode.workingChan(L)))[0].id, level: Levels.CROSS };
          App.activeLayer = L; refreshLayerList(); refreshLayerProps();
        } } : null,
    { sep: true },
    L.mask ? { label: "Paint on the mask", run: () => editMaskWithBrush() } : null,
    L.mask ? { label: "Invert mask", run: () => maskInvert(s, L) } : null,
    L.maskRef ? { label: "Mask → painted copy", run: () => maskRefToPainted(s, L) } : null,
    { label: (L.mask || L.maskRef) ? "Mask from a texture…" : "Add mask from a texture…", run: () => openMaskSourceDialog(s, L) },
    L.mask ? { label: "Delete mask", run: () => setLayerMask(s, L, null, "delete mask") }
           : { label: "Add mask (white)", run: () => addMaskTo(s, L, "white") },
    { sep: true },
    { label: grouped ? "Delete group and its layers" : L.proj ? "Delete decal (all textures)" :
        L.link ? "Delete layer (all linked textures)" : "Delete layer", danger: true,
      run: () => deleteLayerObject(s, L) },
  ]);
}
// ---------- Export a layer, a group or a decal as its own image (ROADMAP 4.21) ----------
// Two forms, and they are NAMED, because a decal's source image and its placed footprint are
// different sizes and different things — "export" that could mean either is a control that means
// two things. *Own pixels* is what you made: a paint layer's canvas, a decal's source image (with
// its height map beside it, 4.19), a group's children flattened without the group's own opacity,
// mask and blend. *On the sheet* is the same thing placed, at sheet size and in sheet coordinates,
// through the layer's opacity, mask, scope and blend — what you take into another editor and paint
// over, and for a projected decal the only form that carries the wrap. A fill and an effect have no
// pixels of their own, so they offer the sheet form alone. Both come out of machinery that exists:
// the pixels are canvases, and `Composite.stack` flattens a subtree exactly as it does for a group.
// PNG by default — lossless, alpha, opens anywhere; the skin's export presets are for the SKIN.
const LayerExport = {
  // The channel a node is exported on: colour if anything in it carries colour, else the first
  // channel it carries — a smoothness-only layer exports its smoothness, and says so in the name.
  chanOf(L){
    const leaves = isGroup(L) ? layerLeaves(L.children) : [L];
    if (leaves.some(x => LayerNode.carries(x, "color"))) return "color";
    for (const ch of CHANNELS) if (leaves.some(x => LayerNode.carries(x, ch.id))) return ch.id;
    return null;
  },
  // The node's own pixels, or null when it has none of its own.
  own(s, L, ch){
    if (isGroup(L)) return LayerExport.flatten(s, L.children, ch, 1);
    const c = LayerNode.contentOn(L, ch);
    if (!c) return null;
    if (c.kind === "paint" && c.canvas) { const o = mkCanvas(c.canvas.width, c.canvas.height); ctx2d(o).drawImage(c.canvas, 0, 0); return o; }
    if (c.kind === "image" && c.bmp) { const o = mkCanvas(c.bmp.width, c.bmp.height); ctx2d(o).drawImage(c.bmp, 0, 0); return o; }
    return null;                                                  // a fill or an effect: nothing that is ITS pixels
  },
  // The node placed on a transparent sheet, exactly as the compositor would place it in the stack.
  sheet(s, L, ch){ return LayerExport.flatten(s, [L], ch, 0); },
  flatten(s, nodes, ch, depth){
    const base = chanBase(s, ch);
    if (!base) return null;
    const W = base.width, H = base.height;
    const out = mkCanvas(W, H);
    const cx = { slot: s, ch, W, H, sx: 0, sy: 0, tw: W, th: H };
    const into = { g: ctx2d(out), canvas: out };
    Composite.reset(into.g);
    Composite.stack(cx, into, nodes, depth);
    Composite.reset(into.g);
    return out;
  },
  fileName(s, L, ch, form, ext){
    const stem = ($("skinName").value.trim() || s.id).replace(/[^a-z0-9_\-]/gi, "_");
    const nm = String(L.name || "layer").replace(/[^a-z0-9_\-]/gi, "_");
    return stem + "_" + nm + (ch === "color" ? "" : "_" + ch) + (form === "sheet" ? "_on_sheet" : "") + "." + ext;
  },
  // Hand one canvas to the user as a file. A download, like the project and the settings — nothing
  // leaves the machine (§0.1).
  async write(canvas, name, fmt){
    let blob;
    if (fmt === "tga") {
      const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
      blob = new Blob([writeTGA(d, canvas.width, canvas.height)], { type: "image/x-tga" });
    } else blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("the browser could not encode " + name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  },
  async run(s, L){
    if (!s || !L) return;
    const ch = LayerExport.chanOf(L);
    if (!ch) { setStatus("“" + L.name + "” holds nothing on any channel — there is no image to write", "err"); return; }
    const leafKind = !isGroup(L) && LayerNode.contentOn(L, ch) ? LayerNode.contentOn(L, ch).kind : null;
    if (leafKind === "effect") { setStatus("“" + L.name + "” is an effect — it adjusts what is below it and has no pixels of its own", "err"); return; }
    const own = LayerExport.own(s, L, ch);
    const sheetBase = chanBase(s, ch);
    if (!own && !sheetBase) { setStatus("No " + ch + " sheet is loaded for " + s.id + " to place “" + L.name + "” on", "err"); return; }
    // Which form. Only asked when the two would differ: a paint layer at full opacity with no mask,
    // scope or blend places as exactly its own pixels, so the question would be a choice of nothing.
    const plain = !isGroup(L) && leafKind === "paint" && L.opacity === 1 && !L.mask && L.blend === "normal" && Scope.empty(Scope.of(L))
      && own && sheetBase && own.width === sheetBase.width && own.height === sheetBase.height;
    let form = own && !plain && sheetBase ? null : own ? "own" : "sheet";
    if (!form) {
      const whatOwn = isGroup(L) ? "its layers flattened, without the group's own opacity, mask or blend"
        : leafKind === "image" ? "the source image, as it was dropped in" : "the layer's canvas, before opacity, mask or blend";
      form = await choiceDialog("Export “" + L.name + "” as which image?", [
        { list: true, label: "Own pixels — " + own.width + " × " + own.height, sub: whatOwn, go: "Write", value: "own" },
        { list: true, label: "On the sheet — " + sheetBase.width + " × " + sheetBase.height, sub: "placed in sheet coordinates, through opacity, mask, part limit and blend" + (L.proj ? " — the only form that carries the projection" : ""), go: "Write", value: "sheet" },
        { label: "Cancel", value: "cancel" }]);
      if (form !== "own" && form !== "sheet") return;
    }
    const fmt = await choiceDialog("Format for “" + L.name + "”?\n\nPNG is lossless with alpha and opens anywhere. TGA is the same pixels in the file the game's own tools read, four times the size.",
      [{ label: "PNG", value: "png", primary: true }, { label: "TGA", value: "tga" }, { label: "Cancel", value: "cancel" }]);
    if (fmt !== "png" && fmt !== "tga") return;
    try {
      const img = form === "own" ? own : LayerExport.sheet(s, L, ch);
      if (!img) throw new Error("nothing to write");
      const names = [await LayerExport.write(img, LayerExport.fileName(s, L, ch, form, fmt), fmt)];
      // A decal's height map goes out beside its own image, or the pair comes apart (4.19).
      if (form === "own" && !isGroup(L) && L.heightMap) {
        const hm = L.heightMap, hc = mkCanvas(hm.width, hm.height); ctx2d(hc).drawImage(hm, 0, 0);
        names.push(await LayerExport.write(hc, LayerExport.fileName(s, L, ch, form, fmt).replace(/\.(png|tga)$/, "_height.$1"), fmt));
      }
      setStatus("Written " + names.join(" and ") + " (" + img.width + " × " + img.height + ", " + (form === "own" ? "own pixels" : "on the sheet") + ")", "ok");
    } catch (e) { reportFailure("exporting “" + L.name + "” as an image", e, "layer-export"); }
  },
};
function duplicateLayer(s, L){
  if (!L || !s) return;
  const own = nodeOwner(s.layers, L);
  if (!own) return;
  // A layer is a container over its channel contents, so a spread would copy the bundle and share
  // every content with the original — the copy's first stroke would land in both. `LayerNode.clone`
  // gives the copy records of its own; the pixels inside them are still shared until snapshotted
  // below, which is what makes duplicating a fill free.
  const copy = LayerNode.clone(L);
  Object.assign(copy, { name: L.name + " copy", _thumb: null, _thumbRev: -1, _maskThumb: null, _maskThumbProps: null, link: null });
  // A duplicate is its own layer: it keeps the pixels but leaves the cross-texture link behind,
  // so editing the copy never reaches back into the original's other sheets.
  // A duplicate of a projected layer becomes an ordinary paint layer — that is the way to keep a
  // projection's pixels and then paint on them without a re-projection wiping the work.
  // So does a path layer's (4.52 (3)): the copy keeps the pixels and lets go of the recipe.
  if (L.type === "paint") { copy.canvas = snapCanvas(L.canvas); copy.proj = null; copy.projEmpty = false; copy.shape = null; }
  // A duplicate stops being rebuilt from its decal: the derived contents keep the gloss and the
  // emboss exactly as they stand and become ordinary paint (4.28(f) — the `derived` marker is what
  // a refresh is allowed to replace, so dropping it IS "detach this copy"). That is the answer to
  // "I want to keep this one and paint on it", and it costs the user nothing now that dragging the
  // original apart is not a thing that can happen.
  for (const ch of Object.keys(copy.chans || {})) {
    const c = copy.chans[ch];
    if (c && c.shape) { c.shape = null; c.canvas = snapCanvas(c.canvas); }   // a path content off the primary slot too
    if (c && c.derived) copy.chans[ch] = LayerNode.content("paint", { canvas: snapCanvas(c.canvas) });
  }
  if (L.type === "decal" && L.bmp) { copy.bmp = snapCanvas(toCanvas(L.bmp)); copy.orig = L.orig || null; }
  if (L.mask) copy.mask = snapCanvas(L.mask);
  if (L.maskRef) copy.maskRef = L.maskRef;                       // the copy is masked by the same layer
  if (L.tone) copy.tone = { ...L.tone };
  if (L.scope) copy.scope = Scope.clone(L.scope);
  const bytes = (copy.canvas ? copy.canvas.width * copy.canvas.height * 4 : 0) + (copy.mask ? copy.mask.width * copy.mask.height * 4 : 0);
  // The copy lands directly above its original, in whatever list the original lives in — so
  // duplicating a layer inside a group keeps the duplicate in that group.
  const add = () => {
    const o = nodeOwner(s.layers, L) || own;
    o.list.splice(o.i + 1, 0, copy);
    App.activeLayer = copy;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  pushAction("duplicate layer", () => {
    const o = nodeOwner(s.layers, copy);
    if (o) o.list.splice(o.i, 1);
    App.activeLayer = L;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  }, add, bytes);
  add();
}
function clearPaintLayer(s, L){
  bakeAction("clear layer", [L.canvas], () => {
    const g = ctx2d(L.canvas);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.clearRect(0, 0, L.canvas.width, L.canvas.height);
  }, () => { L._thumbRev = -1; scheduleComposite(s); refreshLayerList(); });
}
// Deleting a GROUP takes its children with it — they are inside it, and the undo puts the whole
// subtree back because the node it re-inserts still holds them.
function deleteLayerAt(s, node){
  if (!s || !node) return;
  const own = nodeOwner(s.layers, node);
  if (!own) return;
  const list = own.list, at = own.i, below = list[at - 1] || null;
  const rm = () => {
    const o = nodeOwner(s.layers, node);
    if (o) o.list.splice(o.i, 1);
    App.activeLayer = below;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList(); refreshSlotList();
  };
  pushAction("delete " + (isGroup(node) ? "group" : "layer"), () => {
    const at2 = below ? list.indexOf(below) + 1 : 0;
    list.splice(Math.max(0, Math.min(at2, list.length)), 0, node);
    App.activeLayer = node;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList(); refreshSlotList();
  }, rm);
  rm();
}
