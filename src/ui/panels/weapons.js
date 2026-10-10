// ---- Weapons panel ----
// One object rather than a dozen globals, the same way PartsPanel and DecalUI are:
// refreshWeaponPanel was 177 lines (ROADMAP 2.4). Each piece appends one section to `el`.
//
// The panel is a LOADOUT BUILDER (requested 2026-09-02). It used to be two flat lists — every
// purchasable loadout, then every station with every preset under it, an F-4E's running to well
// over a hundred rows — and the only thing you could do with a station was load it *alone*,
// because clicking a preset called loadWeaponLoadout, which clears everything first. So the one
// arrangement a skin actually gets painted against ("a tank on the centreline and two Sidewinders
// outboard, nothing else") was the one arrangement the panel could not express.
//
// Now the hardpoint row IS the loadout (one chip per pylon, laid out as the game lays them — 4.38):
// each chip shows what that station is carrying, clicking it opens the presets it accepts under
// the game's own headings, and picking one changes the build AND the aircraft — station by
// station, with no Apply step, the way the game's loadout screen works (2026-09-21; until then
// the scene waited for an Apply button, and the button re-hung the whole loadout).
// A game preset becomes a way to FILL the build rather than a separate list, and what you have
// built can be named and kept (ArmBuild, in game/loadout.js).
const WeaponsPanel = {
  want: null, busy: null,       // the queued hang and the one in flight (WeaponsPanel.hang)
  row(){ const d = document.createElement("div"); d.className = "row"; return d; },
  el(tag, cls, text){ const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; },

  // The line above the list: how many loadouts and stations, and which file they came out of.
  // Says why there are none, rather than just showing nothing. The vehicle goes by the name the game
  // shows (its unit id is the title) and the max load the way the Mass line under it prints it: it
  // read "… for f-4e, read from flightmodels/f-4e.blk · max load 7257 kg" above "Mass: 0 / 7 257 kg",
  // and at the width a loaded vehicle's tab has, "f-4e" broke at its hyphen (review, 2026-10-10).
  // A hyphenated word goes whole onto the next line (`keep`); the number and its unit share a
  // no-break space. Making the name and the path unbreakable spans instead ran a long path —
  // "flightmodels/p-63c-5_kingcobra_animal_version.blk", 272 px in a 209 px line — out of the column,
  // which cuts it off (review of that fix, the same day; tools/t133_fit.mjs).
  info(unit, arm){
    const info = $("weaponInfo");
    if (!info) return;
    const u = unit && (GameUnits.byId.get(unit) || GameUnits.byId.get(unit.replace(/-/g, "_")));
    const name = this.keep((u && u.name) || unit || "this vehicle");
    info.textContent = "";
    info.title = unit ? "Unit " + unit : "";
    if (arm) {
      const n = (k, w) => k + " " + w + (k === 1 ? "" : "s");
      info.append(n(arm.loadouts.length, "loadout") + " and " + n(arm.slots.length, "station") + " for ", name,
        ", read from ", this.keep(arm.path.replace(/^gamedata\//, "")));
      if (arm.maxload) info.append(" · max load " + Math.round(arm.maxload).toLocaleString() + " kg");
    } else if (AcesDB.ready) info.append("No armament found for ", name, " in the game's files.");
    else info.textContent = "Armament needs aces.vromfs.bin — open your War Thunder folder.";
  },
  // Text with each hyphenated word in a `.keep` span — one inline-block, at most the line's width
  // (index.html CSS): it moves to the next line as a unit rather than breaking at its hyphen, and one
  // wider than the line still wraps inside itself. The text itself is untouched, so it copies as-is.
  keep(text){
    const f = document.createDocumentFragment();
    for (const w of String(text).split(/(\s+)/)) if (w) f.append(w.includes("-") ? this.el("span", "keep", w) : w);
    return f;
  },

  // weapons / pylons switches, plus unload
  // ROADMAP 4.39. This row used to carry a "weapons" and a "pylons" checkbox as well, and the
  // Scene tab carried the same two — one fact, two controls, each calling `syncSceneToggles` to
  // stop the other from showing something untrue. Whether a thing is DRAWN is a display question,
  // so it is asked once, with the other display questions, under View & scene. What is left here is
  // the one thing that is genuinely the Weapons tab's: unloading the weapon models from the project,
  // which changes what the project HOLDS rather than what the viewport shows.
  visibilityRow(el){
    const vis = this.row();
    const unld = document.createElement("button");
    unld.textContent = "Unload";
    unld.title = "Remove every loaded weapon model from the project";
    unld.style.cssText = "padding:0 6px;font-size:11px;margin-left:auto";
    vis.append(this.el("span", "hint", "Show weapons and pylons under View & scene"));
    unld.disabled = !App.weaponsLoaded.size;
    unld.onclick = unloadWeapons;
    vis.appendChild(unld);
    el.appendChild(vis);
  },

  // ---- the glyphs the chips and the menu carry ----
  // The game's loadout screen draws an icon per store; those are its own bitmaps, so the panel
  // draws a small inline-SVG glyph per HEADING instead (CLAUDE.md §4: never emoji) — a bomb, a
  // rocket pod, a missile with mid-body fins for air-to-air, a tank — enough to read a row at a
  // glance and to tell "two bombs" from "two Sidewinders" without opening it.
  GLYPHS: {
    "bombs": "M6 1.2 L4.6 2.8 M6 1.2 L7.4 2.8 M6 1.2 V3.6 M6 3.6 C3.6 5.6 3.1 7 3.1 8.2 a2.9 2.9 0 0 0 5.8 0 C8.9 7 8.4 5.6 6 3.6 Z",
    "guided-bombs": "M6 1.2 L4.6 2.8 M6 1.2 L7.4 2.8 M6 1.2 V3.6 M6 3.6 C3.6 5.6 3.1 7 3.1 8.2 a2.9 2.9 0 0 0 5.8 0 C8.9 7 8.4 5.6 6 3.6 Z M1.5 5.8 H10.5",
    "rockets": "M2.5 2.5 h7 a1 1 0 0 1 1 1 v5 a1 1 0 0 1 -1 1 h-7 a1 1 0 0 1 -1 -1 v-5 a1 1 0 0 1 1 -1 Z M4.5 2.5 V9.5 M7.5 2.5 V9.5",
    "air-to-ground-missiles": "M6 1 L7.1 3 V9 L6 11 L4.9 9 V3 Z M4.9 8 L3 10.2 M7.1 8 L9 10.2",
    "air-to-air-missiles": "M6 1 L7.1 3 V9 L6 11 L4.9 9 V3 Z M4.9 8 L3 10.2 M7.1 8 L9 10.2 M4.9 5 L3.2 6.4 M7.1 5 L8.8 6.4",
    "torpedoes": "M2 4.6 h7 a1.4 1.4 0 0 1 0 2.8 h-7 a1.4 1.4 0 0 1 0 -2.8 Z M2 4.6 L1 3.4 M2 7.4 L1 8.6",
    "mines": "M6 3 a3 3 0 1 0 0.001 0 Z M6 1 V3 M6 9 V11 M1 6 H3 M9 6 H11 M2.5 2.5 L3.9 3.9 M8.1 8.1 L9.5 9.5 M9.5 2.5 L8.1 3.9 M3.9 8.1 L2.5 9.5",
    "fuel-tanks": "M6 3.6 C9.5 3.6 11 5 11 6 C11 7 9.5 8.4 6 8.4 C2.5 8.4 1 7 1 6 C1 5 2.5 3.6 6 3.6 Z",
    "cannons-machine-guns": "M1.5 7 H7.5 V5 H10.5 V8.4 H1.5 Z M3 8.4 V10.5",
    "targeting-pods": "M2 4 h8 a1.5 1.5 0 0 1 0 4 h-8 a1.5 1.5 0 0 1 0 -4 Z M8.5 6 m-1.2 0 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0",
    "countermeasures": "M6 6 L6 1.5 M6 6 L9.9 3.8 M6 6 L9.9 8.2 M6 6 L6 10.5 M6 6 L2.1 8.2 M6 6 L2.1 3.8",
    "boosters": "M6 1.5 L8 5 V9 H4 V5 Z M4.5 9 L6 11 L7.5 9",
    "other": "M6 3 a3 3 0 1 0 0.001 0 Z",
    "empty": "M3 3 L9 9 M9 3 L3 9",
  },
  glyph(key){
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("class", "hpg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", this.GLYPHS[key] || this.GLYPHS.other);
    svg.appendChild(path);
    return svg;
  },

  // ---- where the build comes from ----
  // "clean airframe" is the app's own row and always has been: the game has no empty preset —
  // an A-10C's `a_10c_default` is three 600-gallon tanks — and a skin is painted on the airframe.
  // Picking one HANGS it: there is no Apply step, as there is none in the game (2026-09-21).
  sourceRow(el, arm, unit){
    const r = this.row();
    const lab = this.el("span", null, "Loadout");
    lab.style.cssText = "font-size:11px;color:var(--muted)";
    r.appendChild(lab);
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;min-width:0;font-size:11px";
    sel.title = "Fill the stations below from one of the game's own loadouts, or from one you saved, and hang it. " +
      "Changing any station afterwards makes it your own.";
    sel.appendChild(new Option("clean airframe", ""));
    const mkGroup = (label, names) => {
      if (!names.length) return;
      const g = document.createElement("optgroup"); g.label = label;
      for (const n of names) g.appendChild(new Option(n, n));
      sel.appendChild(g);
    };
    mkGroup("From the game", arm.loadouts.map(l => l.name));
    mkGroup("Saved by you", ArmBuild.forUnit(unit).map(s => s.name));
    sel.value = ArmBuild.base || "";
    sel.onchange = () => {
      const n = sel.value;
      const lo = arm.loadouts.find(l => l.name === n) || ArmBuild.forUnit(unit).find(s => s.name === n);
      if (lo) ArmBuild.fromLoadout(arm, unit, lo); else ArmBuild.clear();
      refreshWeaponPanel();
      this.hang(arm, unit);
    };
    r.appendChild(sel);
    if (ArmBuild.dirty(arm)) {
      const t = this.el("span", "tag", "edited");
      t.title = "This build no longer matches “" + (ArmBuild.base || "clean airframe") + "”.";
      r.appendChild(t);
    }
    if (ArmBuild.forUnit(unit).some(s => s.name === ArmBuild.base)) {
      const del = this.el("button", null, "Delete");
      del.style.cssText = "padding:0 6px;font-size:11px";
      del.title = "Forget the saved loadout “" + ArmBuild.base + "”";
      del.onclick = () => { ArmBuild.remove(unit, ArmBuild.base); ArmBuild.base = null; savePrefs(); refreshWeaponPanel(); };
      r.appendChild(del);
    }
    el.appendChild(r);
  },

  // ---- hanging what the build says, the moment it says it ----
  // One request at a time. A second click while a load is in flight is remembered and run when the
  // first finishes — the loader diffs against what is on the aircraft, so it costs only what the
  // two clicks changed between them. Two loads in flight at once would each take down and hang the
  // same stations, which is why this is a queue and not a fire-and-forget.
  hang(arm, unit){
    this.want = { arm, lo: ArmBuild.assign().length
      ? ArmBuild.toLoadout(ArmBuild.dirty(arm) ? ArmBuild.label() : ArmBuild.base) : null };
    if (this.busy) return;
    this.busy = (async () => {
      try {
        while (this.want) {
          const w = this.want; this.want = null;
          if (w.lo) await loadWeaponLoadout(w.arm, w.lo);
          else if (App.weaponsLoaded.size) { unloadWeapons(); refreshWeaponPanel(); }
        }
      } finally { this.busy = null; }
    })();
  },
  // Picking a preset for a station: the build changes and the aircraft follows.
  pick(arm, unit, slot, preset){
    ArmBuild.set(slot.index, preset ? preset.name : null);
    refreshWeaponPanel();
    this.hang(arm, unit);
  },

  // ---- the mass line the game prints above its row ----
  // Out of the store blks themselves against the WeaponSlots' own maxloadMass, so a build the game
  // would refuse says so here rather than in the hangar.
  massRow(el, arm){
    const m = ArmBuild.mass(arm);
    const r = this.el("div", "hpmass");
    r.textContent = "Mass: " + Math.round(m.kg).toLocaleString() + (m.max ? " / " + m.max.toLocaleString() : "") + " kg" +
      (m.complete ? "" : " (of what is weighed)");
    r.title = m.stores + " store(s) on " + ArmBuild.assign().length + " station(s)";
    if (m.max && m.kg > m.max) { r.style.color = "#e2a35a"; r.textContent += " — over the vehicle's maximum load"; }
    el.appendChild(r);
  },

  // ---- the hardpoints in a row, laid out the way the game's own loadout screen lays them ----
  // ROADMAP 4.38. Seen from the FRONT, so the right wing is on the left of the row — that is how
  // the game draws it and how the camera looks at the aircraft once this tab is open
  // (frameForWeapons). Where each chip goes comes from where the station's node IS on the
  // skeleton, not from its name and not from WeaponSlot.order; ArmBuild.hardpoints carries the
  // measurement. Until 2026-09-20 this was one row per station in the game's listing order, which
  // alternates wings — a reader had to know that to see which pylon was which.
  hardpointRow(el, arm, unit){
    const pts = ArmBuild.hardpoints(arm, vehicleSkeleton(), App.modelSize ? App.modelSize.z : 0);
    if (!pts.length) return;
    const h = this.row();
    h.style.marginTop = "8px";
    h.appendChild(this.el("span", "hint", "Hardpoints, seen from the front — click one to change what it carries:"));
    const look = this.el("button", null, "Look");
    look.style.cssText = "padding:0 6px;font-size:11px;margin-left:auto";
    look.title = "Put the camera where the loadout screen does: in front of the aircraft and a little below, every hardpoint in sight";
    look.disabled = !App.geomData;
    look.onclick = () => Framing.weapons(450);
    h.appendChild(look);
    el.appendChild(h);
    this.massRow(el, arm);
    const row = this.el("div", "hprow");
    for (const p of pts) row.appendChild(this.hardpointChip(p, arm));
    el.appendChild(row);
    const ends = this.el("div", "hpends");
    ends.append(this.el("span", null, "◀ right wing"), this.el("span", null, "left wing ▶"));
    el.appendChild(ends);
    const open = pts.find(p => ArmBuild.open.has(p.slot.index));
    if (open) this.openHardpoint(el, arm, unit, open);
  },

  // One chip: the glyph of what it carries and, when more than one, how many — lit when it carries
  // anything, ringed when its choices are open below. The label says which pylon this is in words,
  // because a chip is 20 px wide.
  hardpointChip(p, arm){
    const slot = p.slot;
    const on = ArmBuild.presetOn(arm, slot.index);
    const c = this.el("div", "hp");
    if (on) c.classList.add("on");
    if (ArmBuild.open.has(slot.index)) c.classList.add("open");
    let n = 0;
    if (on) for (const r of PresetInfo.tally(on)) n += r.count;
    c.appendChild(this.glyph(on ? PresetInfo.group(on).key : "empty"));
    if (n > 1) c.appendChild(this.el("span", "n", String(n)));
    c.title = p.label + "\nstation " + ArmBuild.stationNo(slot) + (slot.tier != null && slot.order != null ? " · tier " + slot.tier : "") +
      "\n" + (on ? "Carrying: " + (PresetInfo.label(on) || on.name) : "Empty") +
      "\n" + slot.presets.length + " option" + (slot.presets.length === 1 ? "" : "s") + " — click to choose";
    c.onclick = () => { ArmBuild.openOnly(slot.index); refreshWeaponPanel(); };
    return c;
  },

  // The open hardpoint's choices, under the row, the way the game's screen lists them under the
  // chip: grouped under the same headings (Bombs, Guided Bombs, Air to Air Missiles…), each line
  // the store's own name with its Ammo and Mass, and Empty last.
  openHardpoint(el, arm, unit, p){
    const slot = p.slot, on = ArmBuild.presetOn(arm, slot.index);
    const head = this.el("div", "hpname");
    head.appendChild(this.el("b", null, p.label));
    head.appendChild(this.el("span", "hint", " · station " + ArmBuild.stationNo(slot) + " — " + (on ? (PresetInfo.label(on) || on.name) : "empty")));
    el.appendChild(head);
    this.menu(el, arm, unit, slot, on);
  },
  menu(el, arm, unit, slot, on){
    const box = this.el("div", "hpmenu");
    const groups = new Map();
    for (const q of slot.presets) {
      const g = PresetInfo.group(q);
      if (!groups.has(g.label)) groups.set(g.label, { g, items: [] });
      groups.get(g.label).items.push(q);
    }
    for (const { g, items } of [...groups.values()].sort((a, b) => a.g.rank - b.g.rank)) {
      box.appendChild(this.el("div", "hpgrp", "- " + g.label));
      for (const q of items) box.appendChild(this.menuItem(arm, unit, slot, q, g.key, on === q));
    }
    box.appendChild(this.menuItem(arm, unit, slot, null, "empty", !on));
    el.appendChild(box);
  },
  // One thing the station can carry. Picking it changes the build AND the aircraft.
  menuItem(arm, unit, slot, preset, key, chosen){
    const r = this.el("div", "hpitem" + (chosen ? " on" : ""));
    r.appendChild(this.glyph(key));
    const t = this.el("span", "t", preset ? (PresetInfo.label(preset) || preset.name) : "Empty");
    r.appendChild(t);
    if (preset) {
      const models = preset.weapons.flatMap(w => storeModels(w.store).map(m => m.model));
      r.title = preset.name + "\n" + preset.weapons.map(w => {
        const ms = storeModels(w.store);
        return blkBaseName(w.blk) + (w.node ? " at " + w.node : "") +
          (ms.length ? "\n  " + ms.map(m => m.kind + ": " + m.model).join("\n  ") : "");
      }).join("\n") + (preset.req ? "\nneeds modification: " + preset.req : "") +
      "\n" + models.length + " model(s)";
      if (preset.req) {
        const rq = this.el("span", "tag", "mod");
        rq.title = "Unlocked by the modification " + preset.req;
        r.appendChild(rq);
      }
      if (!models.length) { const tg = this.el("span", "tag", "no model"); tg.title = "Nothing to hang — the game models this into the airframe"; r.appendChild(tg); }
    }
    r.onclick = () => this.pick(arm, unit, slot, preset);
    return r;
  },

  // ---- the fixed armament: guns and countermeasures, which have neither `order` nor `tier` ----
  // Not hardpoints, so not in the row; these keep the expand-in-place rows the whole list had.
  fixedRows(el, arm, unit){
    const fixed = arm.slots.filter(s => !ArmBuild.isHardpoint(s));
    if (!fixed.length) return;
    const h = this.el("div", "hint", "Fixed armament:");
    h.style.marginTop = "8px";
    el.appendChild(h);
    for (const slot of fixed) this.stationRow(el, arm, unit, slot);
  },

  stationRow(el, arm, unit, slot){
    const on = ArmBuild.presetOn(arm, slot.index);
    const open = ArmBuild.open.has(slot.index);
    const r = this.el("div", "rowitem");
    r.style.padding = "4px 7px";
    if (on) r.classList.add("sel");
    const caret = this.el("span", "ico", open ? "▾" : "▸");
    const txt = this.el("div", "txt");
    txt.appendChild(this.el("div", "t1", "internal"));
    const t2 = this.el("div", "t2", on ? (PresetInfo.label(on) || on.name) : "empty");
    if (!on) t2.style.opacity = ".6";
    txt.appendChild(t2);
    const tag = this.el("span", "tag", slot.presets.length + " option" + (slot.presets.length === 1 ? "" : "s"));
    r.title = "WeaponSlot index " + slot.index + (on ? "\nCarrying: " + on.name : "\nEmpty");
    r.append(caret, txt, tag);
    r.onclick = () => { ArmBuild.toggleOpen(slot.index); refreshWeaponPanel(); };
    el.appendChild(r);
    if (open) this.menu(el, arm, unit, slot, on);
  },

  // ---- keep ----
  // "Save as…" and its name row. Applying is not a step any more: the aircraft already carries
  // what the stations say.
  keepRow(el, arm, unit){
    const r = this.row();
    const save = this.el("button", null, ArmBuild.naming ? "Cancel" : "Save as…");
    save.style.cssText = "padding:0 8px;font-size:11px;margin-left:auto";
    save.disabled = !ArmBuild.assign().length;
    save.title = "Keep this arrangement under a name of your own. Saved loadouts are remembered " +
      "between sessions and travel with a settings export.";
    save.onclick = () => { ArmBuild.naming = !ArmBuild.naming; refreshWeaponPanel(); };
    r.appendChild(save);
    el.appendChild(r);
    if (ArmBuild.naming) this.nameRow(el, unit);
  },

  nameRow(el, unit){
    const r = this.row();
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "name this loadout";
    inp.value = ArmBuild.nameDraft || "";
    inp.style.cssText = "flex:1;min-width:0;font-size:11px";
    inp.oninput = () => ArmBuild.nameDraft = inp.value;
    const ok = this.el("button", null, "Save");
    ok.style.cssText = "padding:0 8px;font-size:11px";
    ok.onclick = () => {
      const n = (ArmBuild.nameDraft || "").trim();
      if (!n) { setStatus("Give the loadout a name first", "err"); return; }
      ArmBuild.save(unit, n);
      ArmBuild.base = n; ArmBuild.naming = false; ArmBuild.nameDraft = "";
      savePrefs();
      setStatus("Loadout “" + n + "” saved for " + unit, "ok");
      refreshWeaponPanel();
    };
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); ok.onclick(); } };
    r.append(inp, ok);
    el.appendChild(r);
    inp.focus();
  },

  // ---- what is currently on the aircraft ----
  loadedRows(el){
    if (!App.weaponsLoaded.size) return;
    const h = this.el("div", "hint", "On the aircraft — click one to select its parts:");
    h.style.marginTop = "8px";
    el.appendChild(h);
    for (const [tag, rec] of App.weaponsLoaded) {
      const r = this.el("div", "rowitem partrow");
      const nm = this.el("span", null, (rec.kind === "rack" ? "▤ " : "") + tag);
      nm.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer";
      nm.title = rec.path ? "From " + rec.path + (rec.placed ? "" : " — no model node to hang it from, laid out below the aircraft instead") : tag;
      nm.onclick = () => partAction("select " + tag, () => { for (const p of rec.parts) if (App.meshes.has(p)) App.selParts.add(p); });
      const k = this.el("span", "tag", rec.placed ? rec.kind : "loose");
      if (!rec.placed) k.style.color = "#e2a35a";
      r.append(nm, k);
      el.appendChild(r);
    }
  },
};

function refreshWeaponPanel(){
  const el = $("weaponList");
  if (!el) return;
  el.className = ""; el.innerHTML = "";
  if (!App.gameDir) {
    el.className = "hint";
    el.textContent = "Open your War Thunder folder first — loadouts come from the game's own files.";
    return;
  }
  const { unit, arm } = armamentForCurrentUnit();
  WeaponsPanel.info(unit, arm);
  WeaponsPanel.visibilityRow(el);
  if (Cockpit.current() === "cockpit") {            // stores live in the exterior's geometry (4.14)
    const h = document.createElement("div"); h.className = "hint";
    h.textContent = "The cockpit body is on screen — stores hang on the exterior. Switch the 3-D view's body to Exterior to apply a loadout.";
    el.appendChild(h);
  }
  if (!arm) return;
  ArmBuild.ensure(unit);
  WeaponsPanel.sourceRow(el, arm, unit);
  WeaponsPanel.hardpointRow(el, arm, unit);
  WeaponsPanel.fixedRows(el, arm, unit);
  WeaponsPanel.keepRow(el, arm, unit);
  WeaponsPanel.loadedRows(el);
}
// ---- a weapon on its own ----
// "Load just the bomb": the same extraction path, but the weapon becomes the project, so it can
// be painted and exported as its own skin and later dropped onto a vehicle project.
async function loadWeaponAlone(modelName){
  progBegin("Loading " + modelName + "…", true);
  try {
    Cockpit.reset();                                  // the weapon becomes the project; no cockpit body (4.14)
    const geo = await extractVehicleGeometry(modelName);
    const bind = descBindFor(modelName);
    App.vehicleKey = modelName; App.objName = modelName;
    App.geomData = geomDataFromExtracted(geo, bind);
    App.extracted = { geo, bind };
    App.objRaw = { name: modelName + "_0.obj", text: buildOBJText(geo, bind, modelName + ".mtl") };
    App.standaloneWeapon = modelName;
    refreshSkinUnits(modelName);
    $("vehicleId").value = $("vehicleId").value || modelName;
    refreshVehicleIdLock();
    if (!$("skinName").value.trim()) $("skinName").value = "my_" + modelName;
    rebuildAll();
    await progTick(true);
    await loadVehicleTextures(modelName);
    progEnd();
    setStatus(modelName + " loaded on its own — paint it, then Export as… writes a skin whose " +
      "replace_tex entries name this weapon's textures" + ModelLoss.note(geo.dropped), geo.dropped.length ? "warn" : "ok");
  } catch (e) {
    progEnd();
    if (e instanceof Cancelled) setStatus("Cancelled");
    else { setStatus("Could not load " + modelName + ": " + ModelLoss.fatal(e), "err"); console.error(e); }
  }
}
// Search the weapon model pool by name — this is how a bomb, a rocket or a pylon is found when
// it is not on any preset (and how a custom loadout gets assembled by hand).
async function renderWeaponSearch(){
  const el = $("weaponFind");
  if (!el) return;
  const q = ($("weaponSearch").value || "").trim();
  el.innerHTML = "";
  if (!q) { el.className = "hint"; el.textContent = "Type a name — “mk 82”, “aim 9”, “pylon”, “drop tank”."; return; }
  el.className = "";
  if (!WeaponDB.ready) {
    el.className = "hint"; el.textContent = "Indexing weapon models…";
    await buildWeaponPool();
    if (($("weaponSearch").value || "").trim() !== q) return;
    el.className = ""; el.innerHTML = "";
  }
  const hits = matchWeaponModels(q, 30);
  const sub = WeaponDB.pool.filter(n => n.toLowerCase().includes(q.toLowerCase().replace(/\s+/g, "_")));
  const seen = new Set(), rows = [];
  for (const n of sub) if (!seen.has(n)) { seen.add(n); rows.push({ model: n, score: 1 }); }
  for (const h of hits) if (!seen.has(h.model)) { seen.add(h.model); rows.push(h); }
  if (!rows.length) { el.className = "hint"; el.textContent = "Nothing matched."; return; }
  for (const h of rows.slice(0, 40)) {
    const row = document.createElement("div");
    row.className = "rowitem";
    row.style.padding = "4px 7px";
    const txt = document.createElement("div"); txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = h.model;
    txt.appendChild(t1);
    row.appendChild(txt);
    const add = document.createElement("button");
    add.textContent = "＋";
    add.title = "Add this model to the aircraft (hidden until Weapons is ticked)";
    add.style.cssText = "padding:0 6px;font-size:11px";
    add.onclick = async ev => {
      ev.stopPropagation();
      if (!App.geomData) { setStatus("Load a vehicle model first, or use “Edit alone”", "err"); return; }
      await loadWeaponModel(h.model);
    };
    const alone = document.createElement("button");
    alone.textContent = "Edit alone";
    alone.title = "Open just this weapon as the project, to paint and export on its own";
    alone.style.cssText = "padding:0 6px;font-size:11px";
    alone.onclick = async ev => {
      ev.stopPropagation();
      const c = (App.geomData || App.slots.size)
        ? await choiceDialog("Open “" + h.model + "” on its own? This replaces the current model and edits.",
            [{ label: "Open weapon", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }])
        : "ok";
      if (c !== "ok") return;
      clearProject();
      loadWeaponAlone(h.model);
    };
    row.append(add, alone);
    el.appendChild(row);
  }
}

