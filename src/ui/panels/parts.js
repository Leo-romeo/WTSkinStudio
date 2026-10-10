// ---- The parts panel ----
// Gathered on one object rather than spread across a dozen top-level names, the same way DecalUI
// is: `refreshPartList` was 297 lines — the worst in the app (ROADMAP 2.4) — and splitting it into
// twelve globals would have traded a length problem for the scope problem 2.3 exists to fix. Every
// piece below builds one part of the panel and appends it to `el`; nothing here holds state.
const PartsPanel = {
  // Small square button used by every row in this panel.
  btn(label, title, fn, css){
    const b = document.createElement("button");
    b.textContent = label; b.title = title;
    b.style.cssText = "padding:0 6px;font-size:11px;flex:0 0 auto" + (css || "");
    b.onclick = ev => { ev.stopPropagation(); fn(ev); };
    return b;
  },

  // A part layout that arrived with a loaded project: groups, assignment, selection, fold state.
  // Consumed once — the project's own layout must survive the class-change rebuild below.
  applyPending(){
    if (!App.pendingParts) return;
    const P = App.pendingParts; App.pendingParts = null;
    App.partGroups = (P.groups || []).map(g => ({ name: g.name, custom: !!g.custom }));
    if (!App.partGroups.length) App.partGroups = null;
    App.partAssign = new Map(Object.entries(P.assign || {}).filter(([p]) => App.meshes.has(p)));
    App.groupCollapsed = new Set(P.collapsed || []);
    App.groupOpen = new Set(P.opened || []);
    if (typeof P.unfold === "number") App.partUnfold = P.unfold;
    App.selParts = new Set((P.selected || []).filter(p => App.meshes.has(p)));
    App.protectedParts = new Set((P.excluded || []).filter(p => App.meshes.has(p)));
    // a project carries its own group layout - don't let the class-change rebuild discard it
    App.partGroupsKind = guessModelKind();
    setTimeout(updateSelectionVisuals, 0);
  },

  toolbar(el){
    const tools = document.createElement("div");
    tools.className = "row";
    tools.style.flexWrap = "wrap";
    const lab = document.createElement("span");
    lab.style.cssText = "font-size:11px;color:var(--muted);flex:0 0 auto";
    lab.textContent = "Select";
    tools.append(lab,
      this.btn("all", "Select every part", () => selectAllParts()),
      this.btn("none", "Clear the selection - painting applies to the whole model again", () => partAction("clear selection", () => { App.selParts.clear(); App.selAnchor = null; })),
      this.btn("invert", "Swap selected and unselected", () => invertPartSelection()),
      this.btn("same shape", "Add every part whose geometry is identical to the last one you clicked (Ctrl+Alt)", () => selectSameShape()),
      this.btn("solo", "Show only the selected parts in 3D (Ctrl+H)", () => soloParts([...App.selParts])),
      this.btn("+ group", "Create an empty custom group, then move parts into it", () => {
        const name = (prompt("Name for the new group:", "My group") || "").trim();
        if (!name || App.partGroups.some(g => g.name === name)) return;
        createPartGroup(name, []);
      }, ";margin-left:auto"));
    el.appendChild(tools);
  },

  // ---- how deep the tree opens ----
  foldRow(el){
    const fold = document.createElement("div");
    fold.className = "row";
    const fl = document.createElement("span");
    fl.style.cssText = "font-size:11px;color:var(--muted);flex:0 0 auto";
    fl.textContent = "Unfold";
    const fs = document.createElement("select");
    fs.style.cssText = "flex:1;font-size:11px;padding:0 2px";
    fs.title = "How far the parts tree opens by default. Folding a group by hand always wins over this.";
    for (const [v, t] of [[0, "categories only"], [1, "first subdivision"], [2, "second subdivision"]]) {
      const o = document.createElement("option");
      o.value = String(v); o.textContent = t;
      if ((App.partUnfold || 0) === v) o.selected = true;
      fs.appendChild(o);
    }
    fs.onchange = () => setPartUnfold(+fs.value);
    fold.append(fl, fs);
    fold.append(this.btn("fold all", "Close every group", () => {
      App.groupOpen = new Set();
      App.groupCollapsed = new Set(allGroupKeys());
      refreshPartList();
    }));
    el.appendChild(fold);
  },

  // What is selected, what that means for painting, and the two bars that only exist when
  // something is selected or shut out.
  stateRows(el){
    const state = document.createElement("div");
    state.className = "hint";
    state.style.marginTop = "2px";
    if (App.selParts.size) {
      const nodes = new Set([...App.selParts].map(partNode)).size;
      const sl = [...slotsForParts([...App.selParts])].map(s => s.id);
      state.style.color = "var(--accent)";
      state.textContent = App.selParts.size + " part(s) in " + nodes + " node(s) selected - painting, fills and projection stay inside them" +
        (sl.length > 1 ? " - spans " + sl.length + " textures (" + sl.join(", ") + ")" : "");
    } else {
      state.textContent = "Nothing selected: paint reaches the whole model. Click a part to select it. " +
        "Alt+click a part (here or in 3D) shuts that one out without selecting the other 200.";
    }
    el.appendChild(state);
    if (App.selParts.size) this.moveToGroupRow(el);
    if (App.protectedParts.size) this.protectedRow(el);
  },

  moveToGroupRow(el){
    const bar = document.createElement("div");
    bar.className = "row";
    const mv = document.createElement("select");
    mv.title = "Move the selected parts into a group";
    mv.style.cssText = "font-size:11px;padding:0 2px;flex:1";
    const mkOpt = (value, label, extra) => { const o = document.createElement("option"); o.value = value; o.textContent = label; if (extra) Object.assign(o, extra); mv.appendChild(o); };
    mkOpt("", "-> group...", { selected: true, disabled: true });
    for (const g of App.partGroups) mkOpt(g.name, g.name);
    mkOpt("__new", "+ new group...");
    mv.onchange = () => {
      const v = mv.value; mv.selectedIndex = 0;
      const parts = [...App.selParts];
      if (v === "__new") {
        const name = (prompt("Name for the new group:", "My group") || "").trim();
        if (!name) return;
        if (App.partGroups.some(g => g.name === name)) { movePartsToGroup(parts, name); return; }
        createPartGroup(name, parts);
      } else if (v) movePartsToGroup(parts, v);
    };
    bar.appendChild(mv);
    el.appendChild(bar);
  },

  protectedRow(el){
    const bar = document.createElement("div");
    bar.className = "row";
    const t = document.createElement("span");
    t.style.cssText = "flex:1;font-size:11px;color:#e2a35a";
    t.textContent = "\u{1F6E1} " + App.protectedParts.size + " part(s) shut out of painting";
    bar.append(t, this.btn("include all", "Allow painting on every part again",
      () => partAction("include all parts", () => App.protectedParts.clear())));
    el.appendChild(bar);
  },

  // ---- category -> sub-group -> node -> material pieces ----
  byGroup(){
    const groups = new Map();
    for (const [name, mesh] of App.meshes) {
      const g = partGroupOf(name);
      if (!groups.has(g)) groups.set(g, new Map());
      const byNode = groups.get(g), n = partNode(name);
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push([name, mesh]);
    }
    return groups;
  },

  // Parts of a node list, flattened.
  partsOf(byNode, nodes){
    const out = [];
    for (const n of nodes) for (const pair of byNode.get(n) || []) out.push(pair[0]);
    return out;
  },

  // one row builder for categories and sub-groups alike. Returns whether it is collapsed, so the
  // caller can skip building what is not shown.
  headerRow(el, label, parts, key, depth, extra){
    const collapsed = !groupIsOpen(key, depth);
    const head = document.createElement("div");
    head.className = "rowitem partrow";
    head.style.cssText = "color:var(--text);margin-top:5px;cursor:pointer;padding-left:" + (depth * 11) + "px" +
      (depth ? ";font-size:11.5px" : ";font-weight:600");
    const arrow = document.createElement("span");
    arrow.textContent = collapsed ? "▸" : "▾";
    arrow.style.cssText = "width:12px;flex:0 0 auto;font-size:11px;opacity:.7";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = parts.some(n => { const m = App.meshes.get(n); return m && m.visible; });
    cb.title = "Show / hide in 3D";
    cb.onclick = ev => ev.stopPropagation();
    cb.onchange = ev => {
      ev.stopPropagation();
      setPartsHidden(parts, !cb.checked);
      refreshPartList();
    };
    const nSel = parts.filter(n => App.selParts.has(n)).length;
    const gt = document.createElement("span");
    gt.textContent = label + " (" + new Set(parts.map(partNode)).size + ")";
    gt.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" +
      (nSel && nSel === parts.length ? ";color:var(--accent)" : nSel ? ";color:#89a7d8" : "");
    gt.title = "Click: select / deselect all of it. The arrow folds it.";
    gt.onclick = ev => { ev.stopPropagation(); selectionSet(parts, nSel !== parts.length); };
    head.onclick = ev => {
      if (ev.target !== head && ev.target !== arrow) return;
      toggleGroupOpen(key, depth);
      refreshPartList();
    };
    head.append(arrow, cb, gt);
    head.append(this.btn("solo", "Show only this in 3D", () => soloParts(parts), isSoloSet(parts) ? ";border-color:var(--accent)" : ""));
    if (extra) extra(head);
    el.appendChild(head);
    return collapsed;
  },

  nodeRow(el, node, pieces, depth){
    const names = pieces.map(p => p[0]);
    const row = document.createElement("div");
    row.className = "rowitem partrow";
    row.style.paddingLeft = (depth * 11 + 12) + "px";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = pieces.some(p => p[1].visible);
    cb.title = "Show / hide in 3D";
    cb.onchange = () => setPartsHidden(names, !cb.checked);
    const prot = names.every(n => App.protectedParts.has(n));
    const someProt = !prot && names.some(n => App.protectedParts.has(n));
    const sel = names.every(n => App.selParts.has(n));
    const unposed = pieces.some(p => p[1].userData.unposed);
    const slots = [...new Set(names.map(n => { const s = slotOfPart(n); return s ? s.id : null; }).filter(Boolean))];
    const nm = document.createElement("span");
    nm.textContent = (prot ? "\u{1F6E1} " : someProt ? "◐ " : "") + partLabel(node) +
      (pieces.length > 1 ? "  ×" + pieces.length : "") + (unposed ? " ·" : "");
    nm.title = (unposed ? "Bone-driven cloth (camo net / tarpaulin). The model file has no pose for it, so it is hidden in 3D - " +
        "turn it on under View & scene / Advanced. Its texture is editable in 2D either way.\n" : "") +
      (pieces.length > 1 ? "This node is split across " + pieces.length + " materials" +
        (slots.length > 1 ? " on " + slots.length + " textures (" + slots.join(", ") + ")" : "") +
        " - selecting it takes all of them.\n" : (slots.length ? "Texture: " + slots[0] + "\n" : "")) +
      "Click selects it (again to drop it). Shift+click adds, Alt+click removes. The shield shuts it out of painting.";
    nm.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" +
      (prot ? ";color:#e2a35a" : sel ? ";color:var(--accent)" : "");
    // Shift adds, Alt subtracts — the same two keys the marquee uses (ROADMAP 3.30). Exclusion
    // is the shield and Ctrl+right-click on the model, and no longer a modifier here.
    nm.onclick = ev => {
      setSelAnchor(node);
      selectionSet(names, ev.shiftKey ? true : ev.altKey ? false : !sel);
    };
    row.append(cb, nm);
    if (slots.length > 1) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = slots.length + " tex";
      tag.title = "Pixels on: " + slots.join(", ");
      row.appendChild(tag);
    }
    row.append(this.btn("\u{1F6E1}", prot ? "Shut out of painting - click to allow it again" : "Never paint on this part",
      () => {
        const on = !prot;
        partAction((on ? "exclude " : "include ") + node, () => { for (const n of names) on ? App.protectedParts.add(n) : App.protectedParts.delete(n); });
      }, ";opacity:" + (prot ? "1" : someProt ? ".6" : ".3")));
    row.append(this.btn("solo", "Show only this in 3D", () => soloParts(names), isSoloSet(names) ? ";border-color:var(--accent)" : ""));
    el.appendChild(row);
    this.bindRows(el, pieces, depth);
  },

  // an unbound material still needs its slot picker - put it on the piece it belongs to
  bindRows(el, pieces, depth){
    for (const p of pieces) {
      const mesh = p[1];
      const bound = App.slots.get(App.matSlot.get(mesh.userData.mat));
      if (mesh.userData.effect || (bound && !bound.missing)) continue;
      const textured = [...App.slots.values()].filter(s => !s.missing).sort((a, b) => b.size - a.size);
      if (!textured.length) continue;
      const sub = document.createElement("div");
      sub.className = "rowitem partrow";
      sub.style.cssText = "padding-left:" + (depth * 11 + 26) + "px;font-size:11px";
      const t = document.createElement("span");
      t.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)";
      t.textContent = matBaseName(mesh.userData.mat);
      const selx = document.createElement("select");
      selx.style.cssText = "padding:0 2px;font-size:11px;flex:0 0 auto;max-width:96px";
      selx.title = "Bind this material to an existing texture slot";
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "bind...";
      selx.appendChild(o0);
      for (const s of textured) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.id; selx.appendChild(o); }
      selx.onchange = ev => {
        ev.stopPropagation();
        if (!selx.value) return;
        App.matSlot.set(mesh.userData.mat, selx.value);
        App.manualBind.add(mesh.userData.mat);
        gcPlaceholders(); rebuildMaterials(); refreshSlotList(); refreshPartList();
        setStatus(matBaseName(mesh.userData.mat) + " -> " + selx.value, "ok");
      };
      sub.append(t, selx);
      el.appendChild(sub);
    }
  },

  // Render a branch of the sub-group tree, then whatever sits directly under it. A leaf branch
  // whose nodes come in several distinct shapes (an F/A-18's inner vs outer nozzle rings, both
  // called nozzle2_NN) is split once more by shape, since that is the line paint follows.
  renderBranch(el, byNode, g, depth){
    if (this.headerRow(el, subGroupTitle(g), this.partsOf(byNode, g.nodes), g.path, depth,
        head => { if (g.sides && g.sides.length > 1) head.title = "Both sides of the same part — " + g.nodes.length + " nodes"; })) return;
    for (const c of g.children) this.renderBranch(el, byNode, c, depth + 1);
    const rest = g.children.length ? g.loose : g.nodes;
    const shapes = g.children.length ? null : shapeSplit(rest);
    if (shapes) {
      shapes.forEach((c, i) => {
        const key = g.path + "◇" + i;
        if (this.headerRow(el, "shape " + (i + 1) + " · " + shapeTip(c.shape), this.partsOf(byNode, c.nodes), key, depth + 1,
            head => head.title = "Every node here is the same piece of geometry (" + shapeTip(c.shape) + ")")) return;
        for (const n of c.nodes) this.nodeRow(el, n, byNode.get(n), depth + 2);
      });
      return;
    }
    for (const n of rest.slice().sort(natCmp)) this.nodeRow(el, n, byNode.get(n), depth + 1);
  },

  // One top-level category: its header, then its sub-tree.
  groupSection(el, gdef, groups){
    const gname = gdef.name;
    const byNode = groups.get(gname);
    if (!byNode && !gdef.custom) return;
    const nodes = byNode ? [...byNode.keys()] : [];
    const allParts = [];
    if (byNode) for (const list of byNode.values()) for (const pair of list) allParts.push(pair[0]);
    const collapsed = this.headerRow(el, gname, allParts, gname, 0, head => {
      if (!gdef.custom) return;
      head.append(this.btn("✎", "Rename this group", () => {
        const nn = (prompt("Rename group:", gname) || "").trim();
        if (nn && nn !== gname && !App.partGroups.some(g => g.name === nn)) renamePartGroup(gname, nn);
      }));
      head.append(this.btn("✕", "Delete this group - its parts return to their automatic group", () => deletePartGroup(gname), ";color:#e2857a"));
    });
    if (collapsed || !nodes.length) return;
    const split = nodes.length > 3 ? subTreeOf(nodes, gname, 0) : { groups: [], loose: nodes.slice().sort(natCmp) };
    for (const sub of split.groups) this.renderBranch(el, byNode, sub, 1);
    for (const n of split.loose) this.nodeRow(el, n, byNode.get(n), 1);
  },
};

function refreshPartList(){
  const el = $("partList");
  el.className = ""; el.innerHTML = "";
  const modeRow = $("rowSelMode");
  if (modeRow) modeRow.style.display = "none";
  if (!App.meshes.size) { el.className = "hint"; el.textContent = "Load a model"; return; }
  PartsPanel.applyPending();
  initPartGroups();
  PartsPanel.toolbar(el);
  PartsPanel.foldRow(el);
  PartsPanel.stateRows(el);
  const groups = PartsPanel.byGroup();
  for (const gdef of App.partGroups) PartsPanel.groupSection(el, gdef, groups);
}

