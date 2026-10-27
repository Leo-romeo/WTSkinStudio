// ---- Where a layer applies (ROADMAP 4.28(g): a recipe, not a parts list) ----
function setLayerScope(L, sc){
  const was = Scope.clone(Scope.of(L));
  const apply = v => {
    for (const s of App.slots.values()) invalidateScopeMasks(s);
    // a projected decal is one object: its scope applies to every sheet it spans
    familyApply(L, x => { x.scope = Scope.clone(v); x._thumb = null; });
    refreshLayerList();
  };
  pushAction(sc ? "limit layer" : "remove layer limit", () => apply(was), () => apply(sc));
  apply(sc);
  setStatus(sc ? "“" + L.name + "” now only shows on " + Scope.label(L) + " — everything outside it is untouched"
               : "“" + L.name + "” applies to the whole texture again", "ok");
}
function selectScopeParts(L){
  const parts = Scope.parts(L);
  if (!parts) return;
  partAction("select layer's parts", () => { App.selParts = new Set(parts.filter(p => App.meshes.has(p))); });
  showTab("parts");
}
// The decal the selection is about: the selected layer if it is one, otherwise the single decal
// inside the selected group. A decal's group is folded by default, so "the group is selected" is
// the ordinary case rather than an edge one — and every decal control, and G, has to keep working
// from there (reported 2026-08-26).
function decalOfSelection(){
  const L = activeLayerObj();
  if (!L) return null;
  if (!isGroup(L)) return L.type === "decal" || L.proj ? L : null;
  const kids = layerLeaves(L.children).filter(x => x.type === "decal" || x.proj);
  return kids.length === 1 ? kids[0] : null;      // ambiguous with two — say nothing rather than guess
}
// ---------- The selected layer's properties, as named steps on one object ----------
// ROADMAP 2.4. `refreshLayerProps` was 147 lines and the second-worst in the app: seven unrelated
// rows plus the "every other panel follows the selection" sync, sharing five locals. The five become
// one context, `P`, and each row a method — the same move `PartsPanel`, `WeaponsPanel`, `Composite`
// and `DecalEd` made, on ONE object rather than a dozen new globals (§4, and 2.3 is why).
//
// `P` carries the two things every row below needs and neither can re-derive cheaply:
//
//   ch / C    WHICH channel these rows are about, and what the layer holds there. A layer can carry
//             content on several channels since 4.28(e), so "the fill's colour" and "the effect's
//             four numbers" have to name one. The answer is the channel you are working in — the
//             brush's — whenever this layer carries it, and the primary slot otherwise, which is
//             what every one of these rows meant back when a layer held exactly one thing.
//   onChan    reaches that same slot on every LINKED sibling, so a layer spread over three textures
//             still edits as one object. `familyApply` alone writes the sibling's PRIMARY content,
//             which is the right slot only while every one of them carries a single channel.
const LayerProps = {
  // Everything outside this panel that follows the selection. It runs before the early return,
  // because "no layer selected" is a state those panels have to show too.
  follow(){
    applyAutoChanView();                    // 3.16: the 3-D view follows the layer, when asked to
    syncGroupBtn();                         // 4.9: the header button says Group or Ungroup
    // A decal's controls follow the DECAL, wherever it is in the tree — including when a group
    // holding it is what is selected, folded: a roundel grouped with its serial, say. Until 4.28(f)
    // applying a Look MADE that group, which is how selecting the folder and losing every decal
    // control came to be reported (2026-08-26); since (f) the Look is in the decal's own layer and
    // the group is only ever the user's, but a folded folder is still a normal place to be.
    const D = decalOfSelection();
    const isProj = !!(D && D.proj);
    $("decalSection").style.display = D && D.type === "decal" ? "" : "none";
    $("projSection").style.display = isProj ? "" : "none";
    if (isProj) syncProjUI();
    if (D && D.type === "decal") { syncDecalUI(); if (D.surf) applyDecalSurfUI(D); }
    ReliefUI.sync();                        // 4.19: one call for both panels, and for neither
    StyleUI.sync();                         // 4.44(6): the outline and shadow rows, for either kind of decal
    // The Selection panel's two bridge buttons are enabled by the LAYER (4.28(g)) — one needs
    // somewhere to put a mask, the other needs a mask to read — so the panel that owns them has to
    // hear about a layer change as well as a selection change.
    SelectUI.sync();
  },
  opacity(P){
    const L = P.L;
    const r = P.mk(`<label>Opacity</label><input type="range" min="0" max="100" value="${Math.round(L.opacity*100)}"><span class="val">${Math.round(L.opacity*100)}</span>`);
    // getV/setV must both speak slider units (0–100) or undo divides the value by 100 again
    bindUndoRange(r.querySelector("input"), () => L.opacity * 100, v => { familyApply(L, x => x.opacity = v / 100); }, "layer opacity",
      () => r.querySelector(".val").textContent = Math.round(L.opacity * 100));
  },
  blend(P){
    const L = P.L;
    const blends = layerBlends(L);
    if (!blends.includes(L.blend)) blends.unshift(L.blend);       // a layer saved before the list narrowed
    const r = P.mk(`<label>Blend</label><select>${blends.map(b => `<option${b === L.blend ? " selected" : ""}>${b}</option>`).join("")}</select>`);
    r.querySelector("select").onchange = e => {
      const from = L.blend, to = e.target.value;
      const apply = v => { familyApply(L, x => x.blend = v); refreshLayerList(); };
      pushAction("blend mode", () => apply(from), () => apply(to));
      apply(to);
    };
  },
  // Which mip levels it shows at (ROADMAP 4.58, docs/MIP_LEVELS.md §3.1) — shown once a range is set
  // (the layer menu's Near only / Far only set one), so every other layer's panel is as it was. The
  // numbers are levels, not pixels: each a half-size copy, and so about twice as far away.
  levels(P){
    const { L, s, mk, el } = P, r = L.levels;
    const opt = (v, sel, txt) => `<option value="${v}"${v === sel ? " selected" : ""}>${txt}</option>`;
    let from = "", to = "", soft = "";
    for (let v = 0; v <= Levels.TOP; v++) { from += opt(v, r.from, v); to += opt(v, r.to, v === Levels.TOP ? "end" : v); }
    for (let v = 0; v <= Math.max(3, r.soft); v++) soft += opt(v, r.soft, v ? "soft " + v : "hard");
    const row = mk(`<label title="Which mip levels this shows at. Level 0 is the full-size sheet the game shows up close; each next level is half the size, and the game picks it about twice as far away — and, on a UserSkin, at a steeper angle.">Shows at</label>` +
      `<select title="The first level it shows at">${from}</select><select title="The last level it shows at — end is every level past the first">${to}</select>` +
      `<select title="How many levels it fades over at each end. The game's trilinear filtering already fades a hard edge over about one level.">${soft}</select>`);
    const [a, b, c] = row.querySelectorAll("select");
    for (const sel of [a, b, c]) { sel.style.cssText = "flex:1;min-width:0"; sel.onchange = () => Levels.set(s, L, Levels.make(+a.value, +b.value, +c.value), "mip levels"); }
    const clr = document.createElement("button");
    clr.textContent = "✕";
    clr.title = "Show it at every level again";
    clr.style.cssText = "padding:0 5px;font-size:11px";
    clr.onclick = () => Levels.set(s, L, null);
    row.appendChild(clr);
    const far = Levels.reach(s, L);
    const note = (far ? far[0].toUpperCase() + far.slice(1) + "." : "") +
      (r.from > 0 ? (far ? " " : "") + "Not in level 0 — the 3-D view shows it from far enough away, the 2-D view at its Level " + r.from + "." : "");
    if (!note) return;
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = note;
    el.appendChild(hint);
  },
  // ---- By distance: a number that varies by mip level (ROADMAP 4.58 (c), docs/MIP_LEVELS.md §3.2) ----
  // One bar per level of the sheet — a swatch for a colour, a column for a number — with the keyed
  // ones marked; pick a bar and set its value, which keys that level (anchored at level 0 on the
  // number it had, the first time). The panel's state, not the record's, like FxUI's channel. The
  // row is there on a content with keys, or once the layer menu's Vary with distance… asked for it
  // (`uid`), so every other layer's panel is as it was.
  keySel: { uid: null, param: null, level: 0 },
  keys(P){
    const { C, s, L, ch, mk, el } = P;
    const ps = Levels.params(C);
    if (!ps.length || !s || !s.composite || (!Levels.keyed(C) && LayerProps.keySel.uid !== L.uid)) return;
    let K = Levels.keysOf(C) || {};
    const last = Levels.last(s.composite.width, s.composite.height);
    const sel = LayerProps.keySel, has = q => Array.isArray(K[q.id]) && K[q.id].length > 0;
    // the panel's choice is this layer's only when it was made on this layer (review of (c))
    const mine = sel.uid === L.uid, p = (mine && ps.find(q => q.id === sel.param)) || ps.find(has) || (mine && sel.param ? ps[0] : null);
    const grey = p && p.colour && ch !== "color";
    const opt = (v, txt, on) => `<option value="${v}"${on ? " selected" : ""}>${txt}</option>`;
    const r = mk(`<label title="Give a number its own value at each mip level: the game shows level 0 up close and each next level about twice as far away — and, on a UserSkin, at a steeper angle. The holo foil and colour flip presets are built on this.">By distance</label>` +
      `<select style="flex:1">${ps.some(has) ? "" : opt("", "same at every level", !p)}${ps.map(q => opt(q.id, (grey ? CHAN_LABEL[ch] || "value" : q.word) + (has(q) ? " — varies" : ""), q === p)).join("")}</select>`);
    r.querySelector("select").onchange = e => { sel.uid = L.uid; sel.param = e.target.value || null; sel.level = Math.min(sel.level, last); refreshLayerProps(); };
    if (!p) return;
    // the plain control of a keyed number is read-only: the keys say what it is at every level
    // (Levels' own rows edit a channel of their own while the Channel select names one, and keys are all channels')
    if (has(p) && !(Effect.typeOf(C) === "levels" && ch === "color" && FxUI.sub !== "rgb")) for (const row of el.querySelectorAll(".row")) {
      const lb = row.querySelector("label");
      if (lb && lb.textContent === (grey ? CHAN_LABEL[ch] : p.row) && row !== r)
        for (const inp of row.querySelectorAll("input")) { inp.disabled = true; inp.title = "Varies with distance — set it level by level under By distance"; }
    }
    const k = mine ? Math.min(Math.max(0, sel.level | 0), last) : 0, at = j => Levels.value(K[p.id] || [[0, p.get(C)]], j);
    const keyedAt = j => has(p) && K[p.id].some(e => e[0] === j);
    const bars = document.createElement("div");
    bars.className = "row";
    bars.style.cssText = "gap:2px;align-items:flex-end;height:30px";
    const draw = () => {
      bars.innerHTML = "";
      for (let j = 0; j <= last; j++) {
        const v = at(j), b = document.createElement("div");
        b.dataset.level = j;
        b.className = "lvbar" + (j === k ? " on" : "") + (keyedAt(j) ? " key" : "");
        const h = p.colour ? 100 : Math.max(6, Math.round(100 * (v - p.min) / (p.max - p.min)));
        b.style.cssText = `flex:1;min-width:0;height:${h}%;cursor:pointer;border-radius:2px;background:${p.colour ? v : "var(--accent)"};` +
          `opacity:${keyedAt(j) || !has(p) ? 1 : .55};outline:${j === k ? "2px solid var(--text)" : keyedAt(j) ? "1px solid var(--accent)" : "none"};outline-offset:-1px`;
        b.title = "Level " + j + ": " + (p.colour ? (grey ? greyOfHex(v) : v) : +(+v).toFixed(2)) + (keyedAt(j) ? " (keyed)" : has(p) ? " (between keys)" : "");
        b.onclick = () => { sel.uid = L.uid; sel.param = p.id; sel.level = j; refreshLayerProps(); };
        bars.appendChild(b);
      }
    };
    draw();
    el.appendChild(bars);
    // the value at the level in hand: live while it moves, one undo step when it settles
    const v0 = at(k);
    const ctl = p.colour && !grey ? `<input type="color" data-key value="${v0}">`
      : `<input type="range" data-key min="${grey ? 0 : p.min}" max="${grey ? 255 : p.max}" step="${grey ? 1 : p.step}" value="${grey ? greyOfHex(v0) : v0}"><span class="val"></span>`;
    const vr = mk(`<label title="The value at level ${k}">Level ${k}</label>${ctl}`);
    const inp = vr.querySelector("input"), val = vr.querySelector(".val");
    const show = () => { if (val) val.textContent = grey ? greyOfHex(at(k)) : +(+at(k)).toFixed(2); };
    show();
    let before = null;
    inp.addEventListener("input", () => {
      if (!before) before = Levels.snap(C);
      const v = grey ? hexOfGrey(+inp.value) : p.colour ? inp.value : +inp.value;
      const cur = Levels.keysOf(C) || {}, list = (has(p) ? cur[p.id] : k ? [[0, p.get(C)]] : []).filter(e => e[0] !== k);
      list.push([k, v]); list.sort((a, b) => a[0] - b[0]);
      Levels.applyKeys(L, ch, { keys: Object.assign({}, cur, { [p.id]: list }) }, false, true);
      K = Levels.keysOf(C) || {};
      draw(); show();
    });
    inp.addEventListener("change", () => {
      const was = before; before = null;
      if (!was) return;
      const now = Levels.snap(C);
      pushAction("vary " + p.word + " with distance", () => Levels.applyKeys(L, ch, was, true), () => Levels.applyKeys(L, ch, now, true));
      refreshLayerProps();
    });
    if (!has(p)) return;
    const btn = (label, title, fn) => { const b = document.createElement("button"); b.textContent = label; b.title = title; b.style.cssText = "padding:0 5px;font-size:11px"; b.onclick = fn; vr.appendChild(b); };
    if (keyedAt(k) && K[p.id].length > 1) btn("✕", "Take level " + k + "'s key off — it is interpolated from its neighbours again",
      () => { Levels.setKeys(s, L, ch, Object.assign({}, K, { [p.id]: K[p.id].filter(e => e[0] !== k) }), "unkey level " + k); refreshLayerProps(); });
    btn("✕ all", "The same at every level again — level 0's value", () => {
      const n = Object.assign({}, K); delete n[p.id];
      Levels.setKeys(s, L, ch, n, "same at every level"); refreshLayerProps();
    });
  },
  // The level effect presets (4.58 (c), `Levels.PRESETS`): pick one, set its few numbers, Add. What
  // it builds is ordinary layers, which the status line and the dialog both say.
  presetId: null,
  presetDialog(slot){
    if (!slot || !slot.composite) { setStatus("Select a texture slot first", "err"); return null; }
    const last = Levels.last(slot.composite.width, slot.composite.height), groups = layerNodes(slot.layers).filter(isGroup);
    const D = modalDialog("Level effects", { width: "400px" });
    const row = (label, ctl, tip) => {
      const r = document.createElement("div"); r.className = "row";
      const l = document.createElement("label"); l.textContent = label; if (tip) l.title = tip;
      ctl.style.flex = "1"; r.append(l, ctl); return r;
    };
    const select = (opts, sel) => { const s = document.createElement("select"); for (const [v, t] of opts) s.appendChild(new Option(t, v, false, v === sel)); return s; };
    const hint = text => { const h = document.createElement("div"); h.className = "hint"; h.textContent = text; return h; };
    const pick = select(Levels.PRESETS.map(p => [p.id, p.word]), LayerProps.presetId || "holo");
    pick.dataset.preset = "";
    const what = hint(""), form = document.createElement("div"), note = hint("");
    D.body.append(row("Effect", pick), what, form, note, hint(Levels.CAVEAT));
    const add = document.createElement("button"), cancel = document.createElement("button");
    add.textContent = "Add"; add.className = "primary"; cancel.textContent = "Cancel";
    D.foot.append(cancel, add);
    const draw = () => {
      const P = Levels.PRESETS.find(p => p.id === pick.value);
      LayerProps.presetId = P.id;
      what.textContent = P.what;
      form.innerHTML = ""; note.textContent = ""; add.disabled = false;
      for (const f of P.fields) {
        let ctl;
        if (f.kind === "palette") ctl = select(Gradient.HOLO.map(h => [h.id, h.name]), f.def);
        else if (f.kind === "level") { const o = []; for (let k = f.min || 0; k <= last; k++) o.push([String(k), "level " + k]); ctl = select(o, String(Math.min(last, f.def))); }
        else if (f.kind === "blend") ctl = select(COLOR_BLENDS.map(b => [b, b]), f.def);
        else if (f.kind === "group") {
          // the far look defaults to the first group beside the near one, never one inside it
          const g = f.def ? groups.find(x => x !== groups[0] && !nodeContains(groups[0], x) && !nodeContains(x, groups[0])) : groups[0];
          ctl = select(groups.map(x => [x.uid, x.name]), g ? g.uid : "");
        }
        else if (f.kind === "colour") { ctl = document.createElement("input"); ctl.type = "color"; ctl.value = f.def; }
        else { ctl = document.createElement("input"); ctl.type = "number"; ctl.min = f.min; ctl.max = f.max; ctl.value = f.def; }
        ctl.dataset.field = f.id;
        form.appendChild(row(f.word, ctl));
      }
      if (P.fields.some(f => f.kind === "group") && groups.length < 2) { note.textContent = "Put the near look and the far look in two groups on this texture first."; add.disabled = true; }
    };
    pick.onchange = draw;
    draw();
    cancel.onclick = D.close;
    add.onclick = () => {
      const v = {};
      for (const c of form.querySelectorAll("[data-field]")) v[c.dataset.field] = c.type === "number" ? +c.value : c.value;
      if (Levels.preset(slot, pick.value, v)) D.close();
    };
    return D;
  },
  // Where this layer applies — Substance's "polygon fill" idea, widened to a recipe by 4.28(g).
  limit(P){
    const L = P.L, sc = Scope.of(L), n = Scope.empty(sc) ? 0 : 1;
    const row = P.mk(`<label title="Restrict this layer to some model parts, a rectangle on the sheet, or both. It stays exact through a texture resize, and you can clear it any time.">Limit</label>` +
      `<span class="val" style="margin-left:0;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${n ? "var(--accent)" : "var(--muted)"}"></span>`);
    row.querySelector(".val").textContent = n ? Scope.label(L) : "whole texture";
    if (Scope.parts(L)) row.querySelector(".val").title = Scope.parts(L).map(partLabel).join(", ");
    // Whatever is selected, in either grain: the parts, the rectangle, or both intersected. The
    // island half is baked with the mask row's own button instead — see editor/scope.js.
    const set = document.createElement("button");
    const live = Scope.ofSelection() || null;
    set.textContent = "← selection";
    set.style.cssText = "padding:0 6px;font-size:11px";
    set.title = live ? "Limit this layer to " + Scope.label({ scope: live }) +
        " — the parts you have selected, the rectangle you have drawn, or both"
      : "Select parts on the model, or drag a rectangle in the 2-D view, first";
    set.disabled = !live;
    set.onclick = () => setLayerScope(L, live);
    row.appendChild(set);
    if (!n) return;
    const show = document.createElement("button");
    show.textContent = "show";
    show.title = "Select this layer's parts in 3D";
    show.style.cssText = "padding:0 6px;font-size:11px";
    show.onclick = () => selectScopeParts(L);
    const clr = document.createElement("button");
    clr.textContent = "✕";
    clr.title = "Remove the part limit";
    clr.style.cssText = "padding:0 5px;font-size:11px";
    clr.onclick = () => setLayerScope(L, null);
    row.append(show, clr);
  },
  fill(P){
    const { C, ch, mk, onChan, el } = P;
    // Flat or a gradient (4.44's fifth candidate), a noise or a pattern (4.50 (7), (8)): the Fill
    // select, and the evaluated fill's own rows — its stops or its tile carry the colours, so the
    // flat colour row below is the flat fill's alone.
    GradUI.build(P);
    if (C.grad || C.pat) return;
    if (ch === "color") {
      const r = mk(`<label>Color</label><input type="color" value="${C.color}">`);
      const inp = r.querySelector("input");
      let colFrom = null;
      const setCol = v => onChan((c, x) => { c.color = v; x._thumb = null; });
      inp.addEventListener("input", () => { if (colFrom === null) colFrom = C.color; setCol(inp.value); });
      inp.addEventListener("change", () => {
        const f = colFrom; colFrom = null;
        if (f === null || f === C.color) return;
        const to = C.color;
        pushAction("fill color", () => { setCol(f); refreshLayerList(); }, () => { setCol(to); refreshLayerList(); });
      });
      return;
    }
    // Smoothness, metalness, normal and the wear mask are single-value maps. A colour picker on one
    // of them is nonsense — and the old panel showed one, so a "Metalness fill" invited you to
    // choose a green it could never store.
    const v0 = greyOfHex(C.color);
    const r = mk(`<label title="${CHAN_TIP[ch] || ""}">${CHAN_LABEL[ch] || ch}</label>` +
      `<input type="range" min="0" max="255" value="${v0}"><span class="val">${v0}</span>`);
    bindUndoRange(r.querySelector("input"), () => greyOfHex(C.color),
      v => onChan((c, x) => { c.color = hexOfGrey(v); x._thumb = null; }), "fill value",
      () => r.querySelector(".val").textContent = greyOfHex(C.color));
    const h = document.createElement("div");
    h.className = "hint";
    h.style.margin = "0 0 4px";
    h.textContent = ch === "smooth" ? "0 = fully rough, 255 = mirror gloss."
      : ch === "metal" ? "0 = dielectric (paint, rubber), 255 = bare metal."
      : ch === "wear" ? "Light = your paint covers the camouflage; dark = the camouflage shows through."
      : "128 is flat; away from it tilts the surface.";
    el.appendChild(h);
  },
  // ---- the effects row (4.28(e)) ----
  // An effect is content like any other now, so it is shown where it lives — on the channel that
  // holds it — and it can be added to any of them. It used to be a layer TYPE that only the albedo
  // accepted; since (c) one walk builds every channel, so contrast on a roughness map composites
  // exactly like contrast on the albedo and there is nothing left to refuse. What KIND of effect it
  // is — the four numbers, Levels, Curves and the rest (4.50 (5)) — is chosen in its own rows.
  effect(P){
    const { C, mk, L } = P;
    if (C && C.kind === "effect") { FxUI.build(P); return; }
    if (isGroup(L)) return;
    const r = mk(`<label title="An adjustment over everything below, on this layer's channel: hue and saturation, Levels, Curves, colour balance, a gradient map and more. It stays live — change your mind any time.">Effect</label>`);
    const b = document.createElement("button");
    b.textContent = "+ Add effect layer";
    b.style.cssText = "flex:1;font-size:11px";
    b.title = "Adds an adjustment above this layer, on the " + Tool.chanWord(newLayerChan()) +
      " channel — the channel the brush is in.";
    b.onclick = () => addEffectLayer();
    r.appendChild(b);
  },
  // ---- blend-if: show this layer by what lies beneath it (ROADMAP 4.44, third candidate) ----
  // One row when it is off, three when it is on. Photoshop's "Blend If: underlying layer" and
  // Substance's "mask by colour", as a property of the layer beside its mask rather than a mask
  // kind: it multiplies with the mask, so a painted mask and a tone band can both be on. Live while
  // a slider moves, one undo step per slider (`bindUndoRange`), and the row is rebuilt only on the
  // switches — a slider in the middle of a drag must not have its panel rebuilt under it.
  tone(P){
    const { L, s, mk } = P;
    const T = L.tone;
    const redraw = () => { scheduleComposite(s); scheduleChannels(s); };
    const set = (v, desc) => {
      const before = L.tone ? { ...L.tone } : null, after = v ? { ...v } : null;
      const apply = x => { L.tone = x ? { ...x } : null; redraw(); refreshLayerProps(); };
      pushAction(desc, () => apply(before), () => apply(after));
      apply(after);
    };
    const r = mk(`<label title="Show this layer only where the sheet beneath it is dark, light, in between — or near a colour. Weathering that follows the panel lines already in the game's albedo starts here. It combines with the mask: both have to let a texel through.">Blend if</label>`);
    const sel = document.createElement("select");
    sel.style.flex = "1";
    for (const [v, label] of [["off", "always (off)"], ["lum", "the tone beneath is in a range"], ["color", "the colour beneath is near…"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o);
    }
    sel.value = T ? (T.src === "color" ? "color" : "lum") : "off";
    sel.onchange = () => {
      const v = sel.value;
      if (v === "off") { set(null, "blend-if off"); return; }
      const keep = L.tone || {};
      set(v === "color" ? { src: "color", color: keep.color || "#404040", lo: keep.src === "color" ? keep.lo : .8, hi: 1, soft: keep.soft == null ? .1 : keep.soft, invert: !!keep.invert }
                        : { src: "lum", lo: keep.src === "lum" ? keep.lo : 0, hi: keep.src === "lum" ? keep.hi : .4, soft: keep.soft == null ? .1 : keep.soft, invert: !!keep.invert },
          "blend-if by " + (v === "color" ? "colour" : "tone"));
    };
    r.appendChild(sel);
    if (!T) return;
    const inv = document.createElement("label");
    inv.style.cssText = "font-size:11px;display:flex;gap:4px;align-items:center;margin:0";
    inv.title = "Swap it: show where the band does NOT match";
    const invIn = document.createElement("input"); invIn.type = "checkbox"; invIn.checked = !!T.invert;
    invIn.onchange = () => set({ ...L.tone, invert: invIn.checked }, invIn.checked ? "blend-if inverted" : "blend-if not inverted");
    inv.append(invIn, document.createTextNode("invert"));
    r.appendChild(inv);
    const pct = v => Math.round(v * 100) + "%";
    const slider = (label, title, k, min, max, fmt) => {
      const row = mk(`<label title="${title}">${label}</label><input type="range" min="${min}" max="${max}" step="1"><span class="val"></span>`);
      const i = row.querySelector("input"), val = row.querySelector(".val");
      i.value = Math.round(L.tone[k] * 100); val.textContent = fmt(L.tone[k]);
      bindUndoRange(i, () => L.tone[k], v => { L.tone[k] = v / 100; redraw(); }, "blend-if " + label.toLowerCase(),
        () => { val.textContent = fmt(L.tone[k]); });
      return row;
    };
    if (T.src === "color") {
      const rc = mk(`<label title="The colour the sheet beneath has to be near for this layer to show. Pick it off the texture: the base grey of a panel line, the rubber of a tyre.">Colour</label>`);
      const c = document.createElement("input"); c.type = "color"; c.value = T.color || "#404040";
      c.style.cssText = "width:34px;padding:0";
      c.oninput = () => { L.tone.color = c.value; redraw(); };
      c.onchange = () => { const v = c.value; set({ ...L.tone, color: v }, "blend-if colour"); };
      rc.appendChild(c);
      slider("Match", "How closely a texel beneath has to match the colour for this layer to show — 100% is that colour exactly, 80% lets its neighbours through", "lo", 0, 100, pct);
      slider("Soften", "The width of the ramp at the band's edges — 0 is a hard cut", "soft", 0, 50, pct);
    } else {
      slider("From", "The darkest tone that still shows this layer: 0% is black", "lo", 0, 100, pct);
      slider("To", "The lightest tone that still shows it: 100% is white", "hi", 0, 100, pct);
      slider("Soften", "The width of the ramp at each end of the band — 0 is a hard cut", "soft", 0, 50, pct);
    }
  },
  verbs(P){
    const { L, s, mk } = P;
    const r = mk(`<button title="Move up the stack">▲</button><button title="Move down the stack">▼</button><button title="Duplicate">⧉</button><button style="margin-left:auto;color:var(--danger)">Delete</button>`);
    const [up, dn, dup, del] = r.querySelectorAll("button");
    up.onclick = () => moveLayer(1); dn.onclick = () => moveLayer(-1);
    dup.onclick = () => duplicateLayer(s, L);
    if (L.proj) del.title = "Removes this projected decal from every texture it landed on";
    else if (L.link) del.title = "Removes this layer from every texture your selection covered";
    del.onclick = () => deleteLayerObject(s, L);
  },
  // A mask that is another layer (ROADMAP 4.36): the row names the source, offers the way back
  // to pixels of its own, and none of the painting verbs — those belong on the source.
  maskRef(el, mk, btn, s, L){
    const clip = L.maskRef === LayerNode.BELOW;
    const src = clip ? LayerNode.below(s, L) : LayerNode.byUid(s.layers, L.maskRef);
    const r = mk(`<label title="This layer is masked by another layer's painted pixels — live: paint on that layer and this one follows. Its own mask, opacity and blend are not part of the shape it lends.">Mask</label>`);
    const th = layerMaskThumb(L, "_maskThumbProps", s);
    th.style.cssText = "border-radius:3px;outline:1px dashed " + (src ? "var(--accent)" : "var(--danger)");
    const who = document.createElement("span");
    who.className = "hint"; who.style.cssText = "flex:1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    who.textContent = clip ? (src ? "= the layer below: “" + src.name + "”" : "= the layer below (none)")
                          : (src ? "= layer “" + src.name + "”" : "= a layer that is gone");
    who.title = clip ? "Clipped to whatever sits directly under it in the stack — move either layer and the clip follows"
      : src ? "Masked by “" + src.name + "”" : "The source layer was deleted — nothing masks this layer until you pick another or remove the reference";
    r.append(th, who);
    const r2 = mk("");
    r2.append(
      btn("→ painted copy", "Freeze what the source lends right now into a mask of this layer's own, and drop the link — then it can be painted, softened or inverted", () => maskRefToPainted(s, L)),
      btn("→ selection", "Select what this mask shows", () => Marquee.fromMask()),
      btn("layer…", "Point the mask at a different layer", () => pickMaskLayer(s, L)),
      Object.assign(btn("✕ mask", "Remove the reference — the layer shows in full again", () => setLayerMaskRef(s, L, null, "unlink mask")), { style: "padding:1px 6px;font-size:11px;color:var(--danger)" }));
  },
};
function refreshLayerProps(){
  const el = $("layerProps");
  const L = activeLayerObj(), s = App.activeSlot;
  LayerProps.follow();
  if (!L) { el.innerHTML = ""; return; }
  el.innerHTML = "";
  const ch = LayerNode.workingChan(L);
  const P = {
    el, L, s, ch,
    C: LayerNode.contentOn(L, ch),
    mk: html => { const d = document.createElement("div"); d.className = "row"; d.innerHTML = html; el.appendChild(d); return d; },
    onChan: fn => familyApply(L, x => { const c = LayerNode.contentOn(x, ch); if (c) fn(c, x); }),
  };
  ChanStrip.build(el, s, L);
  LayerProps.opacity(P);
  LayerProps.blend(P);
  if (L.levels) LayerProps.levels(P);
  if (["paint", "decal", "fill", "adjust"].includes(L.type)) LayerProps.limit(P);
  if (P.C && P.C.kind === "fill") LayerProps.fill(P);
  LayerProps.effect(P);
  LayerProps.keys(P);
  if (["paint", "decal", "fill"].includes(L.type)) maskRows(el, P.mk, s, L);
  if (["paint", "decal", "fill"].includes(L.type) || isGroup(L)) LayerProps.tone(P);
  LayerProps.verbs(P);
}
// The mask half of the layer panel: what it looks like, and everything you can do to it without
// touching the layer's own pixels.
function maskRows(el, mkRow, s, L){
  // Every row here is a run of up to six buttons in a 203–209 px column, so they wrap BETWEEN
  // buttons (`.row.wrap`). In one line, measured at the default sidebar width on 2026-10-10, "model…"
  // (which holds From the cockpit) and "clip ↓" were wholly past the column's edge, "layer…" was cut
  // and "+ white" / "+ black" broke inside their buttons; a mask's own row cut "✕ mask" by 67 px.
  const mk = html => { const d = mkRow(html); d.classList.add("wrap"); return d; };
  const btn = (label, title, fn) => {
    const b = document.createElement("button");
    b.textContent = label; b.title = title;
    b.style.cssText = "padding:1px 6px;font-size:11px";
    b.onclick = fn;
    return b;
  };
  if (L.maskRef) { LayerProps.maskRef(el, mk, btn, s, L); return; }
  if (!L.mask) {
    const r = mk(`<label title="A mask hides part of this layer without deleting anything. White shows, black hides, grey partly shows — and it can be painted, imported, taken from the parts you have selected, or be another layer's pixels.">Mask</label>`);
    r.append(
      btn("+ white", "Add a mask that shows everything, then hide the layer where you paint (Mask brush)", () => addMaskTo(s, L, "white")),
      btn("+ black", "Add a mask that hides the whole layer, then reveal it where you paint (Alt-paint, or push the mask value above 128)", () => addMaskTo(s, L, "black")),
      btn("texture…", "Use one of the model's own textures — or an image file — as the mask, with an invert option", () => openMaskSourceDialog(s, L)),
      btn("layer…", "Use another layer's painted pixels as the mask — live, the way an anchor point works in Substance: paint on that layer and this one follows", () => pickMaskLayer(s, L)),
      btn("model…", "Bake a mask from the model itself — its curvature (edges, cavities) or its occlusion (what sits under or inside something) — with a levels control. Edge wear and dirt in the seams start here. On an aircraft with a cockpit model it also carries the cockpit's paint onto this sheet as a new layer (From the cockpit).", () => MaskBake.open(s, L)),
      btn("clip ↓", "Show this layer only where the layer directly below it has paint — a clipping mask. It follows the stack: move either layer and it clips to whatever is below then.", () => {
        if (!LayerNode.below(s, L)) { setStatus("Nothing to clip to — this layer is at the bottom of its list, or the layer below is a group", "err"); return; }
        setLayerMaskRef(s, L, LayerNode.BELOW, "clip to the layer below");
        setStatus("“" + L.name + "” is clipped to the layer below it — it shows only where that layer has paint", "ok");
      }));
    const r2 = mk("");
    // 4.28(g): the whole selection, not the part half of it. This button read `App.selParts` and
    // nothing else, so the rectangle you had just dragged and the UV island you had just clicked
    // were the two shapes it could not see — which is the same gap 4.27 closed between parts and
    // islands, one layer down.
    // "bake selection" and not "← selection": the Limit row above now takes the whole selection too,
    // non-destructively and exactly, and two buttons on one panel reading the same while one of them
    // resamples on a resize is worse than either name being a word longer. The label names the cost.
    const sel = btn("bake selection",
      Marquee.any()
        ? "Bake the whole selection — rectangle, UV islands and selected parts, composed the way they confine a brush stroke — into the mask, so you can then soften or paint its edge. For a limit that stays exact through a resize, use the Parts row above instead."
        : "Select something first: drag a rectangle in the 2-D view (M), click a UV island (K), or pick parts on the model",
      () => Marquee.toMask());
    sel.disabled = !Marquee.any();
    r2.append(sel, btn("noise…", "Mask this layer by procedural noise — grime, mottling, chips or rain marks, worked out along the model so it runs across the UV seams. A hidden noise layer goes in under this one; select it to change its scale, seed and levels.", () => GradUI.noiseMask(s, L)));
    return;
  }
  const r = mk(`<label title="White shows this layer, black hides it, grey partly shows it. Nothing is deleted — remove the mask and the layer is whole again.">Mask</label>`);
  const th = layerMaskThumb(L, "_maskThumbProps");
  th.style.cssText = "cursor:pointer;border-radius:3px";
  th.title = "Click to paint on this mask";
  th.onclick = editMaskWithBrush;
  const paint = btn(App.brush.target === "mask" && App.paint3d ? "painting it" : "paint it",
    "Switch to the Mask brush: paint hides, Alt-paint reveals", editMaskWithBrush);
  if (App.brush.target === "mask" && App.paint3d) paint.classList.add("active");
  r.append(th, paint);
  const r2 = mk("");
  r2.append(
    btn("invert", "Swap what is shown for what is hidden", () => maskInvert(s, L)),
    btn("soften", "Blur the mask a few pixels, for a fade instead of a hard edge", () => maskBlur(s, L, Math.max(2, Math.round(s.composite.width / 512)))),
    btn("show all", "Fill the mask white — the whole layer shows again", () => maskFill(s, L, true)),
    btn("hide all", "Fill the mask black — the layer is hidden everywhere until you reveal some of it", () => maskFill(s, L, false)));
  const r3 = mk("");
  const sel = btn("bake selection",
    Marquee.any() ? "Replace the mask with the whole selection — rectangle, UV islands and selected parts"
                  : "Select something first: a rectangle (M), a UV island (K), or parts on the model",
    () => Marquee.toMask());
  sel.disabled = !Marquee.any();
  // ...and the direction that did not exist (4.28(g)). A mask you painted, imported, softened or
  // inverted was a shape every selection verb was blind to; now it is one they can all work with.
  const out = btn("→ selection", "Select what this mask shows — its light areas become the selection, so Fill, Crop and Copy can follow a shape you painted",
    () => Marquee.fromMask());
  const del = btn("✕ mask", "Remove the mask — the layer shows in full again", () => setLayerMask(s, L, null, "delete mask"));
  del.style.color = "var(--danger)";
  r3.append(sel, out, btn("texture…", "Replace the mask with one of the model's textures, or an image file, with an invert option", () => openMaskSourceDialog(s, L)),
    btn("model…", "Replace the mask with one baked from the model — its curvature or its occlusion, through a levels control. On an aircraft with a cockpit model it also carries the cockpit's paint onto this sheet as a new layer (From the cockpit), leaving this mask as it is.", () => MaskBake.open(s, L)), del);
}
// Up / down move the layer within the list it lives in — a layer inside a group walks its group,
// and does not fall out of the bottom of it. Getting out is what dragging is for.
function moveLayer(dir){
  const s = App.activeSlot, L = activeLayerObj();
  if (!s || !L) return;
  const own = nodeOwner(s.layers, L);
  if (!own) return;
  const j = own.i + dir;
  if (j < 0 || j >= own.list.length) return;
  const other = own.list[j];
  const swap = () => {
    const o = nodeOwner(s.layers, L);
    const k = o.list.indexOf(other);
    if (!o || k < 0) return;
    o.list[o.i] = other; o.list[k] = L;
    App.activeLayer = L;
    scheduleComposite(s); scheduleChannels(s); refreshLayerList();
  };
  pushAction("reorder layer", swap, swap);                 // a swap is its own inverse
  swap();
}
// `opts.empty` — this layer is a blank canvas with nothing drawn on it yet, so adding it changes
// no pixel and the whole-sheet composite below is 49 ms of compositing nothing (measured at 4096²,
// 2026-08-23). It matters because the one caller that passes it is `createPaintLayerFor`, which
// runs *inside* `beginStroke` — so that 49 ms landed in the middle of the user's first stroke,
// which is exactly where it was met. The stroke composites what it paints, as usual.
// Anything that arrives with content — a decal, a fill, a duplicate — must still composite.
function addLayerTo(s, L, opts){
  if (!s || !s.composite) { setStatus("Select a texture slot first", "err"); return; }
  // Every layer that reaches a stack is a container, enforced at the one funnel rather than
  // remembered at ten call sites — since 4.28(c) the composite is addressed through the channel
  // slots, so a record that skipped `LayerNode.of` would sit in the list and draw nothing.
  // Idempotent, in place, and it leaves a group alone, so this costs a call and nothing else.
  LayerNode.of(L);
  const idx = s.layers.length;
  const sel = s === App.activeSlot;
  const add = () => { s.layers.splice(idx, 0, L); if (sel) App.activeLayer = L;
    if (!(opts && opts.empty)) scheduleComposite(s);
    refreshLayerList(); refreshSlotList(); };
  pushAction("add layer", () => {
    const o = nodeOwner(s.layers, L);
    if (o) o.list.splice(o.i, 1);
    if (sel) App.activeLayer = s.layers[s.layers.length - 1] || null;
    scheduleComposite(s); refreshLayerList();
  }, add);
  add();
}
function addLayer(L){ addLayerTo(App.activeSlot, L); }
// Add one layer per texture the current part selection touches, linked as one object. `make`
// builds a fresh layer for a given slot (paint layers need a canvas of that slot's size).
// Group / ungroup from the header, on whatever is selected. One button rather than two: with a
// group selected the only thing anyone wants from it is to take the group apart again, and a second
// button that is disabled most of the time is a control that mostly says nothing (§4).
function toggleGroupSelected(){
  const s = App.activeSlot, L = activeLayerObj();
  if (!s) { setStatus("Select a texture slot first", "err"); return; }
  if (!L) { setStatus("Select a layer first — Group puts the selected layer into a group of its own, and you drag the others in", "err"); return; }
  isGroup(L) ? ungroupNode(s, L) : groupNodes(s, [L]);
}
function syncGroupBtn(){
  const b = $("btnGroupLayer");
  if (!b) return;
  const L = activeLayerObj();
  b.textContent = L && isGroup(L) ? "Ungroup" : "Group";
}
// 4.28's D4, as (d) settled it: which channel a new layer lands on is not a separate control any
// more, it is the channel the brush is already in. The "New layer on" select is gone — it asked the
// question twice and the two answers could disagree, which is how you ended up with a Metalness
// layer selected and the colour brush in your hand.
function newLayerChan(){ return (App.brush && App.brush.chan) || "color"; }
function addLinkedLayers(make, what){
  const s0 = App.activeSlot;
  if (!s0 || !s0.composite) { setStatus("Select a texture slot first", "err"); return null; }
  const chan = newLayerChan();
  const scope = Scope.ofSelection();
  let slots = scope ? [...slotsForParts(scope)] : [];
  if (!slots.length) slots = [s0];
  else if (!slots.includes(s0)) slots.unshift(s0);            // keep the active slot in the family
  const link = slots.length > 1 ? newLinkId() : null;
  const made = [];
  withUndoBatch("add " + what.toLowerCase(), () => {
    for (const s of slots) {
      const L = make(s);
      L.scope = Scope.clone(scope);
      if (chan !== "color") L.chan = chan;
      if (link) L.link = link;
      addLayerTo(s, L);
      made.push({ slot: s, L });
    }
  });
  if (App.activeSlot !== s0) selectSlot(s0.id);
  else { App.activeLayer = s0.layers[s0.layers.length - 1] || null; refreshLayerList(); }
  // A smoothness / metalness / normal layer composites over the maps unpacked from the slot's
  // _n. With no _n loaded there is nothing to composite onto, so the layer would sit there doing
  // nothing — say so rather than let it look broken.
  if (SURF_CHANS.includes(chan) && !chanBase(s0, chan))
    setStatus(what + " added on the " + (CHAN_LABEL[chan] || chan) + " channel, but “" + s0.id +
      "” has no _n surface map loaded — it will do nothing until one is (Textures ▸ Replace…, or Find in game files)", "err");
  else if (slots.length > 1)
    setStatus(what + " added to " + slots.length + " textures your selection covers (" +
      slots.map(s => s.id).join(", ") + ") — they move as one", "ok");
  return made.find(m => m.slot === s0) || made[0];
}
function announceScope(L){
  if (!L || Scope.empty(Scope.of(L))) return;
  setStatus("“" + L.name + "” is limited to " + Scope.label(L) +
    " — clear it under the layer's Limit row", "ok");
}
// The three "add a layer of this type" buttons are one button now (4.28(e)). What kind of content
// a layer holds is a property of its channel slots, so it is chosen — and changed — in the channel
// strip, where it can still be answered after you have seen the thing on the model. What is left
// here is the one thing that genuinely has to happen before anything else: a layer to put it in.
$("btnNewLayer").onclick = () => {
  const made = addLinkedLayers(s => {
    const ch = newLayerChan();
    const base = chanBase(s, ch) || s.composite;
    return LayerNode.of({ type: "paint", chan: ch === "color" ? undefined : ch,
      name: LayerNode.autoName(s.layers),
      canvas: mkCanvas(base.width, base.height), visible: true, opacity: 1, blend: "normal" });
  }, "Layer");
  if (made && !made.L.link) announceScope(activeLayerObj());
};
// The effects row (4.28(e)). An adjustment is still a node carrying an effect — (b) kept it that
// way deliberately, because D2's "every adjustment becomes a group" migration is not lossless — so
// this adds one above the layer you are on. What HAS changed is that it is no longer refused off
// the albedo: since (c) one walk builds every channel, so hue/contrast on a roughness or metalness
// map composites exactly like anything else, and the old "that only works on colour" message was
// describing a limit that had stopped existing.
function addEffectLayer(){
  const made = addLinkedLayers(() => LayerNode.of({ type: "adjust", name: "Effect", visible: true, opacity: 1, blend: "normal",
    hue: 0, sat: 100, bright: 100, contrast: 100 }), "Effect");
  if (made && !made.L.link) announceScope(activeLayerObj());
}
// consume the stashed drop once, otherwise the button can never reach the file picker again
$("btnAddDecal").onclick = () => {
  const p = pendingDecal; pendingDecal = null;
  // one already in hand goes down here rather than back through the editor it just came out of
  if (p && p.edited) { DecalCarry.clear(); DecalCarry.place(p.bmp, { name: p.name, surf: p.surf, height: p.height, heightName: p.heightName, text: p.text }); return; }
  if (p) { DecalCarry.clear(); addDecalFromImage(p.bmp, p.name); return; }
  DecalLib.index().then(idx => {
    if (!idx.length) { $("decalPick").click(); return; }
    openDecalLibrary();
  }).catch(() => $("decalPick").click());
};
$("decalPick").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    let bmp;
    if (/\.dds$/i.test(f.name)) {
      const dec = await parseDDSAsync(await f.arrayBuffer());
      const c = mkCanvas(dec.width, dec.height);
      ctx2d(c).putImageData(new ImageData(dec.mips[0].rgba.slice(), dec.width, dec.height), 0, 0);
      bmp = c;
    } else bmp = await createImageBitmap(f);
    addDecalFromImage(bmp, f.name);
  } catch (err) { setStatus(err.message, "err"); }
  e.target.value = "";
};
// Every image goes through the editor first — that is where the background comes off and the
// surface response is chosen, before anything is written onto the skin.
//
// It used to refuse to open at all without a texture slot. That put the cart in front of the horse:
// cleaning up a marking and filing it in the library is work you do to PREPARE for a skin, and
// demanding a loaded vehicle first meant the library could only ever be filled mid-edit. Only
// *placing* the result needs a slot, so only placing checks for one (DecalCarry.place).
function addDecalFromImage(bmp, name){
  openDecalEditor(bmp, name, (canvas, meta) => DecalCarry.place(canvas, meta, name));
}
// ROADMAP 4.2: a PROJECTED decal's image opens in the decal editor too, and "Use this decal"
// re-projects the result where the decal already is (`ProjSource.edit`). The floating decal's
// button answers `type === "decal"` only, which is why a projection's image used to be fixed.
$("btnProjEdit").onclick = () => ProjSource.edit(decalOfSelection());
