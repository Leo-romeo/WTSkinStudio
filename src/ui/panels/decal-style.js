// ---------- The outline and shadow rows (ROADMAP 4.44, sixth candidate) ----------
// One binding over the six controls, the way `ReliefUI` sits over the relief rows. The numbers live
// on the decal's Look (`DecalStyle.KEYS` on `surf`), so they go wherever the Look goes; this only
// reads them into the sliders and writes a slider back — live while it moves, one undo step when it
// is let go. A floating decal re-composites; a projected one re-projects through the same live /
// commit pair its size and angle sliders use, so Ctrl+Z reaches it the same way.
const StyleUI = {
  ROWS: [["ol", "stOl", v => v > 0 ? v + "%" : "off"], ["sh", "stSh", v => v > 0 ? v + "%" : "off"],
         ["shx", "stShx", v => String(v)], ["shy", "stShy", v => String(v)], ["shb", "stShb", v => String(v)]],
  COLORS: [["olc", "stOlC"], ["shc", "stShC"]],
  // The decal these rows are about, and where its Look is kept.
  target(){
    const L = decalOfSelection();
    if (!L) return null;
    return { L, P: L.proj || null, slot: L.proj ? slotOfLayer(L) : App.activeSlot };
  },
  look(t){
    const holder = t.P || t.L;
    if (!holder.surf) holder.surf = Object.assign(surfDeltas(SURF_PRESETS.none), { preset: "none" });
    return holder.surf;
  },
  sync(){
    const t = StyleUI.target();
    $("styleSection").style.display = t ? "" : "none";
    if (!t) return;
    const S = DecalStyle.read(surfOf(t.L));
    for (const [k, id, fmt] of StyleUI.ROWS) { $(id).value = S[k]; $(id + "Val").textContent = fmt(S[k]); }
    for (const [k, id] of StyleUI.COLORS) $(id).value = S[k];
    $("rowShadow").style.display = $("rowShadowBlur").style.display = S.sh > 0 ? "" : "none";
  },
  // A slider moved: write it, show it, redraw. `from` is the Look before the first move of a drag,
  // for the undo step `commit` pushes.
  from: null,
  input(k, v){
    const t = StyleUI.target();
    if (!t) return;
    const surf = StyleUI.look(t);
    if (!StyleUI.from) StyleUI.from = { ...surf };
    surf[k] = v;
    if (t.P) { if (!projEditFrom) projEditFrom = projParamsClone(t.P); if (ProjLive.ok()) projLiveRender(t.P); }   // the slider gate (4.2)
    else scheduleComposite(t.slot);
    StyleUI.sync();
  },
  commit(desc){
    const t = StyleUI.target();
    const before = StyleUI.from; StyleUI.from = null;
    if (!t || !before) return;
    if (t.P) { projSliderCommit(t.P, desc); return; }
    const L = t.L, slot = t.slot, after = { ...StyleUI.look(t) };
    const apply = v => {
      L.surf = { ...v };
      scheduleComposite(slot);
      if (hasDerived(L)) refreshDecalSurface(slot, L);       // the gloss and the raised edge follow the outline
      StyleUI.sync(); refreshLayerList();
    };
    pushAction(desc, () => apply(before), () => apply(after));
    apply(after);
  },
  bind(){
    for (const [k, id] of StyleUI.ROWS) {
      $(id).oninput = e => StyleUI.input(k, +e.target.value);
      $(id).onchange = () => StyleUI.commit(k === "ol" ? "decal outline" : "decal shadow");
    }
    for (const [k, id] of StyleUI.COLORS) {
      $(id).oninput = e => StyleUI.input(k, e.target.value);
      $(id).onchange = () => StyleUI.commit(k === "olc" ? "outline colour" : "shadow colour");
    }
  },
};
StyleUI.bind();
