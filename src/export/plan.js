// ---------- What a slot is FOR, asked of the geometry rather than of the file name ----------
// "Cockpit and engine-flame textures must not be modified" needs to know which sheet is which.
// The model already answers it exactly: a slot whose triangles are all interior or effect
// geometry is a cockpit or effect sheet, and one with any exterior area is not. slotExteriorArea()
// uses the same two tests to decide which slot the 2-D view opens on. Only a bare .obj with no
// usable part names falls back to matching the texture name.
function slotRole(slot){
  if (!App.geomData || !App.matSlot) {
    const n = String(slot.cStem || slot.nStem || slot.id || "").toLowerCase();
    return EFFECT_RE.test(n) ? "effect" : INTERIOR_NAME_RE.test(n) ? "cockpit" : "exterior";
  }
  let ext = 0, interior = 0, effect = 0;
  for (const g of App.geomData) {
    if (App.matSlot.get(g.mat) !== slot.id) continue;
    const tris = g.position.length / 9;
    if (isEffectMat(g.name, g.mat)) effect += tris;
    else if (INTERIOR_GROUPS.has(partGroupOf(g.name)) || INTERIOR_NAME_RE.test(g.name)) interior += tris;
    else if (!g.weapon && !g.skinned) ext += tris;
  }
  if (ext > 0) return "exterior";                  // anything on the outside makes it paintable
  if (effect > interior) return "effect";
  if (interior > 0) return "cockpit";
  // Nothing classified: no triangle on this model uses this sheet at all. That is not "exterior",
  // it is "the geometry has no opinion" — and it is exactly the state a texture loaded by name
  // reaches (`Vehicle ▸ search ▸ →slot`, or `Paste as layer`), which is how a cockpit sheet or a
  // jet flame gets into a project without a single triangle referencing it. ROADMAP 4.13's sweep is
  // what made that concrete: `jet_flame_diamonds` is in `aircrafts.dxp.bin` and reachable today.
  // So ask the NAME here, and only here — with geometry that says "exterior" the name is not
  // consulted, which is what keeps this from crying wolf on an ordinary skin.
  const n = String(slot.cStem || slot.nStem || slot.id || "").toLowerCase();
  return EFFECT_RE.test(n) ? "effect" : INTERIOR_NAME_RE.test(n) ? "cockpit" : "exterior";
}
// The size a texture will actually be written at, before anything is encoded. Mip chains sum to
// 4/3 of the base level, which is close enough to decide whether the archive cap is in danger;
// the panel says "≈" and the export-time check uses the real bytes.
function estimateBytes(w, h, fmt, mips){
  const base = fmt === "bc3" ? Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 16
    : fmt === "tga" ? w * h * 4 + 18 : w * h * 4;
  return mips && fmt !== "tga" ? Math.round(base * 4 / 3) : base;
}
// Turn app state into the plain object validateExport() wants. `estimate` means "the textures have
// not been encoded yet", which is the pre-export panel; doExport passes the real files instead.
function buildExportPlan(items, opts){
  opts = opts || {};
  const fmts = exportFormats();
  const mode = exportMode();
  const cls = vehicleClass();
  const mips = $("optMips") ? $("optMips").checked : true;
  const on = (App.skinUnits || []).filter(u => u.on);
  const byName = new Map((opts.files || []).map(f => [f.name, f.data ? f.data.byteLength : 0]));
  const plan = {
    cls, mode, rank: on.length ? on[0].unit.rank || 0 : 0,
    units: selectedUnits().map(u => u.replace(/[^a-z0-9_\-]/gi, "_")),
    formats: fmts,
    camoStems: mode === "set_tex" ? stockCamoStems() : [],
    estimated: !!opts.estimate,
    items: [], pins: [],
  };
  for (const it of items) {
    // The real path never hands over an unticked texture; the panel's preview list does, so that
    // the row stays visible. Either way the plan is what buildBlk reads, so dropping it here drops
    // both the file and its set_tex/replace_tex entry together.
    if (it.off) continue;
    const o = it.slot ? expOpt(it.slot, it.kind) : null;
    const fmt = it.fmtOverride || (o && o.fmt) || (it.kind === "c" ? fmts.c : fmts.n);
    // the resolution override is applied by collectExports() only on the real path, so the panel
    // has to apply it here or it would validate a size that will never be written
    const w = o && o.size && o.size < it.w ? o.size : it.w;
    const h = w === it.w ? it.h : Math.max(1, Math.round(it.h * w / it.w));
    const fileName = it.fileName || (it.fileNameBase + (fmt === "tga" ? ".tga" : ".dds"));
    plan.items.push({ fileName, fromStem: it.fromStem, kind: it.kind, w, h, camoTile: !!it.camoTile,
      role: it.slot ? slotRole(it.slot) : "exterior",
      bytes: byName.has(fileName) ? byName.get(fileName) : estimateBytes(w, h, fmt, mips) });
  }
  // A tile's pins name a file that is already one of the items, so its bytes are counted there once.
  for (const p of (opts.pins || (mode === "set_tex" ? camoPinPlan() : [])))
    plan.pins.push({ stem: p.stem, fileName: p.fileName, source: p.source,
      bytes: p.source === "tile" ? 0 : byName.has(p.fileName) ? byName.get(p.fileName)
        : (p.data ? p.data.byteLength : estimateBytes(CAMO_MAX, CAMO_MAX, "rgba8", false)) });
  plan.blkText = buildBlk(plan.items, mode, plan.pins);
  return plan;
}
