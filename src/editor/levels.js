"use strict";
// ---------- Which mip levels a layer shows at (ROADMAP 4.58, docs/MIP_LEVELS.md) ----------
// A mip chain is the sheet at full size (level 0) followed by the same sheet halved again and again;
// the GPU picks a level per screen pixel — further away, and for a UserSkin at a grazing angle too
// (the game's anisotropy setting does not reach UserSkins, the owner, 2026-10-24) — so whatever is in
// a level shows only where the GPU picks it. Any layer or group may carry
//
//     levels: { from, to, soft }        inclusive level indices, 0–15, and a fade `soft` levels wide
//
// and it is limited to that stretch of the chain the way a part scope limits it to some of the model
// (`editor/scope.js`): the compositor multiplies its opacity by its weight at the level being built
// and skips it at 0 (`Composite.stack`). That is the whole model, on purpose — because a node is
// limited rather than a level's document copied, every tool the app has works per level: a near look
// and a far look are two groups, a message that appears from far is a text layer with `from: 5`.
// Absent means every level, which is every node of every file before format 7 (`ProjNode`).
//
// The live sheet is level 0 — what the game shows up close. The views draw the rest from a chain of
// their own (`LevelView`, 4.58 (b)): the 3-D view samples it by distance, the 2-D view shows one level
// at its Level control. The export builds the rest: `restarts` lists where what is visible changes, the walk builds each of
// those levels at full size with its own layers (`Composite.at`), the pool pads it and takes it down
// to its level, and the chain carries on from there (`ExportRun.levels`, `BCnEnc.buildMips`).
//
// A recipe is never edited in place: `set` assigns a new one, so a copy that shares the object with
// its original (`LayerNode.clone` copies fields, not records) can never be changed through it.
const Levels = {
  TOP: 15,                     // "to the end": an 8192² chain is levels 0–13, so 15 covers every sheet
  SOFT: 15,
  CROSS: 3,                    // Near only / Far only split here unless told otherwise — ~32 m on a 2048² jet sheet (§1)
  of(n){ return (n && n.levels) || null; },
  // A clean recipe from any numbers — the panel's or a file's — ordered and held to 0–15, or null
  // where it limits nothing (every level, whatever its soft edge: there is no end to fade).
  make(from, to, soft){
    const lv = (v, d) => { v = v == null ? NaN : Math.round(+v); return isFinite(v) ? Math.max(0, Math.min(Levels.TOP, v)) : d; };
    let a = lv(from, 0), b = lv(to, Levels.TOP);
    if (a > b) { const t = a; a = b; b = t; }
    if (a === 0 && b === Levels.TOP) return null;
    const s = Math.round(+soft);
    return { from: a, to: b, soft: isFinite(s) ? Math.max(0, Math.min(Levels.SOFT, s)) : 0 };
  },
  // What a project file says, forced to that shape (`ProjNode` reads through here — a crafted file
  // cannot put an array or a string into the walk, t140).
  read(v){
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return Levels.make(v.from, v.to, v.soft);
  },
  clone(r){ return r ? { from: r.from, to: r.to, soft: r.soft } : null; },
  near(k){ return Levels.make(0, (k == null ? Levels.CROSS : k) - 1, 0); },
  far(k){ return Levels.make(k == null ? Levels.CROSS : k, Levels.TOP, 0); },
  // Its weight at level k — 1 inside the range, max(0, 1 − distance / (soft + 1)) outside it
  // (docs/MIP_LEVELS.md §3.1). No level asked (one layer's own image, `LayerExport`) weighs 1.
  weight(n, k){
    const r = n && n.levels;
    if (!r || k == null) return 1;
    const d = k < r.from ? r.from - k : k > r.to ? k - r.to : 0;
    return d ? Math.max(0, 1 - d / (r.soft + 1)) : 1;
  },
  // The deepest level of a w × h chain, as `buildMips` counts it (to 1 × 1).
  last(w, h){ return Math.floor(Math.log2(Math.max(1, w, h))); },
  // A restart at level r is padded max(32, 2^r) texels before it is taken down: 32 protects every
  // level to 5, and 2^r is one texel of level r (docs/MIP_LEVELS.md §4).
  pad(r){ return Math.max(32, Math.pow(2, r)); },
  // Any level content: a range on a node, or a number keyed by level on a content (4.58 (c)).
  any(nodes){ return layerNodes(nodes || []).some(n => n.levels || (!isGroup(n) && LayerNode.channelsOf(n).some(ch => Levels.keyed(n.chans[ch])))); },
  // Does this leaf draw anything on one of these channels.
  on(L, chs){ return chs.some(ch => { const c = LayerNode.contentOn(L, ch); return !!(c && c.visible !== false); }); },

  // ---- a number that varies by level (4.58 (c), docs/MIP_LEVELS.md §3.2) ----
  // A flat fill's colour (or value, on a single-value map) and an effect's numbers may carry
  //
  //     keys: { <param>: [[level, value], …] }     levels 0–15 ascending, one key a level
  //
  // and the walk takes the value at the level it builds: linear between two keys, held before the
  // first and past the last. That is the holo — a fill whose colour runs along a palette as the GPU
  // walks down the chain — and, on the surface sheet, gloss and metalness that ramp with it. Like a
  // range it is a recipe, never edited in place (`setKeys` assigns a new one), and it is the whole
  // mechanism: the compositor asks `content` for the content at its level and draws what comes back
  // exactly as it draws any other, so every kind of fill and effect that has a number keys the same
  // way. The plain number beside the keys is kept at level 0's value — what the views show, and what
  // a build that has never heard of keys draws.
  //
  // What can be keyed, per content: `get` reads the plain number, `put` writes one into a copy. The
  // ids are unique across kinds, so keys made for one kind of effect never key another's number of the
  // same name after the kind is changed (sharpen's amount runs to 500, noise's to 128: review of (c)). A
  // colour is "#rrggbb" on every channel (a single-value map stores grey there, `hexOfGrey`); `row`
  // is the label of the panel's own control for it, made read-only while it is keyed.
  PARAMS: {
    fill:    [{ id: "color", word: "colour", colour: true, row: "Color", get: c => c.color, put: (c, v) => { c.color = v; } }],
    hsbc:    [["hue", -180, 180], ["sat", 0, 300], ["bright", 20, 250], ["contrast", 20, 250]].map(([id, min, max]) =>
               ({ id, word: id, min, max, step: 1, row: id, get: c => +c[id], put: (c, v) => { c[id] = v; } })),
    levels:  [["inLo", "black", 0, 255, 1, "In black"], ["inHi", "white", 0, 255, 1, "In white"], ["gamma", "gamma", .1, 5, .01, "Gamma"]].map(([id, word, min, max, step, row]) =>
               ({ id, word, min, max, step, row, fx: true, get: c => +(c.fx.rgb || Effect.lv())[id], put: (c, v) => { c.fx.rgb = Object.assign({}, c.fx.rgb || Effect.lv(), { [id]: v }); } })),
    blur:    [{ id: "radius", word: "radius", min: 1, max: 32, step: 1, row: "Radius", fx: true, get: c => +c.fx.radius, put: (c, v) => { c.fx.radius = Math.round(v); } }],
    sharpen: [{ id: "sharpenAmount", word: "amount", min: 0, max: 500, step: 1, row: "Amount", fx: true, get: c => +c.fx.amount, put: (c, v) => { c.fx.amount = Math.round(v); } }],
    noise:   [{ id: "noiseAmount", word: "amount", min: 0, max: 128, step: 1, row: "Amount", fx: true, get: c => +c.fx.amount, put: (c, v) => { c.fx.amount = Math.round(v); } }],
  },
  // What this content can vary by level — nothing for a gradient, a noise or a pattern fill (their
  // stops carry the colours), Curves or the per-texel kinds without one number to key.
  params(c){
    if (!c) return [];
    if (c.kind === "fill") return c.grad || c.pat ? [] : Levels.PARAMS.fill;
    if (c.kind !== "effect") return [];
    return Levels.PARAMS[Effect.typeOf(c)] || [];
  },
  param(c, id){ return Levels.params(c).find(p => p.id === id) || null; },
  keysOf(c){ return c && c.keys && typeof c.keys === "object" && !Array.isArray(c.keys) ? c.keys : null; },
  // Keyed: keys on a param this content has — keys left behind by an effect whose kind changed since
  // (a blur's radius on what is a sharpen now) key nothing, and move no restart.
  keyed(c){ const K = Levels.keysOf(c); return !!K && Levels.params(c).some(p => Array.isArray(K[p.id]) && K[p.id].length); },
  lerp(a, b, f){
    if (typeof a !== "string") return a + (b - a) * f;
    const A = Composite.rgb(a), B = Composite.rgb(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, "0")).join("");
  },
  // One param's value at level k, from its keys [[level, value], …] in ascending order.
  value(K, k){
    k = k == null ? 0 : k;
    if (k <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++)
      if (k <= K[i][0]) return Levels.lerp(K[i - 1][1], K[i][1], (k - K[i - 1][0]) / (K[i][0] - K[i - 1][0]));
    return K[K.length - 1][1];
  },
  // The content as level k sees it: itself when nothing on it is keyed (every content of every file
  // before 4.58 (c), so the walk costs a property read), else a copy carrying the keyed values. The
  // copy is the walk's alone — an effect's tables compile on it and go with it. No level asked (one
  // layer's own image) is level 0, what the views show.
  // The copies are kept per content until its keys, its record or a plain number changes — keys and
  // records are replaced, never edited, so identity says it — and a dab of a stroke reuses level 0's
  // with its compiled tables rather than copying and compiling again (CLAUDE.md §3.3, §3.6; review of (c)).
  _at: new WeakMap(),
  content(c, k){
    if (!Levels.keyed(c)) return c;
    k = k == null ? 0 : k;
    const base = [c.color, c.hue, c.sat, c.bright, c.contrast, c.visible, c.opacity].join("|");
    let m = Levels._at.get(c);
    if (!m || m.keys !== c.keys || m.fx !== c.fx || m.base !== base) Levels._at.set(c, m = { keys: c.keys, fx: c.fx, base, at: new Map() });
    if (!m.at.has(k)) m.at.set(k, Levels.evaluate(c, k));
    return m.at.get(k);
  },
  evaluate(c, k){
    const o = Object.assign({}, c), K = c.keys;
    delete o.keys;
    if (c.fx) o.fx = Effect.clone(c.fx);
    for (const p of Levels.params(c)) if (Array.isArray(K[p.id]) && K[p.id].length) p.put(o, Levels.value(K[p.id], k));
    return o;
  },
  // The keyed values at level k, as text: what `restarts` compares level to level.
  sig(c, k){
    if (!Levels.keyed(c)) return "";
    return Levels.params(c).filter(p => Array.isArray(c.keys[p.id]) && c.keys[p.id].length).map(p => p.id + "=" + Levels.value(c.keys[p.id], k)).join(";");
  },
  // A file's keys, forced to the shape: params this content has, each a list of [level, value] with
  // the level rounded and held to 0–15 (one key a level, the last written wins), a number held to its
  // range and a colour to #rrggbb, anything else dropped — a crafted file cannot put an array or a
  // string into the walk (t171). Null when nothing is left.
  readKeys(v, c){
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out = {};
    for (const p of Levels.params(c)) {
      const raw = v[p.id];
      if (!Array.isArray(raw)) continue;
      const by = new Map();
      for (const e of raw) {
        if (!Array.isArray(e)) continue;
        if (typeof e[0] !== "number" || !isFinite(e[0])) continue;
        let k = Math.round(e[0]);
        k = Math.max(0, Math.min(Levels.TOP, k));
        let val = e[1];
        if (p.colour) { if (typeof val !== "string" || !/^#[0-9a-f]{6}$/i.test(val)) continue; val = val.toLowerCase(); }
        else { if (typeof val !== "number" || !isFinite(val)) continue; val = Math.max(p.min, Math.min(p.max, val)); }
        by.set(k, val);
      }
      if (by.size) out[p.id] = [...by.keys()].sort((a, b) => a - b).map(k => [k, by.get(k)]);
    }
    return Object.keys(out).length ? out : null;
  },
  keysClone(K){ return K ? JSON.parse(JSON.stringify(K)) : null; },
  // A content's keys and plain numbers, as one record an undo step can put back.
  snap(c){
    const base = {};
    for (const p of Levels.params(c)) base[p.id] = p.get(c);
    return { keys: Levels.keysClone(Levels.keysOf(c)), base, fx: c.fx ? Effect.clone(c.fx) : null };
  },
  // Put keys on a content, a new record every time, with each keyed param's plain number set to its
  // level-0 value; `snap` (from `undo`) puts back the plain numbers it held as well.
  assign(c, K, snap){
    if (c.fx) c.fx = Effect.clone(snap && snap.fx ? snap.fx : c.fx);       // a new record, never the old one changed
    if (snap) for (const p of Levels.params(c)) if (p.id in snap.base) p.put(c, snap.base[p.id]);
    K = Levels.keysClone(K);
    for (const p of Levels.params(c)) if (K && K[p.id] && K[p.id].length) p.put(c, Levels.value(K[p.id], 0));
    if (K && Object.keys(K).length) c.keys = K; else delete c.keys;
  },
  // ---- one undo step, on every texture a linked layer spans ----
  setKeys(slot, L, ch, K, what){
    const c0 = LayerNode.contentOn(L, ch);
    if (!c0) return;
    const was = Levels.snap(c0), to = { keys: Levels.keysClone(K) };
    Levels.applyKeys(L, ch, to);
    const now = Levels.snap(c0);
    pushAction(what || "vary with distance", () => Levels.applyKeys(L, ch, was, true), () => Levels.applyKeys(L, ch, now, true));
  },
  // `live`: a slider in the middle of a drag — the sheets recomposite (familyApply schedules them) but
  // the list is not refreshed, because that rebuilds the panel, and the slider with it, under the pointer.
  applyKeys(L, ch, rec, whole, live){
    familyApply(L, x => { const c = LayerNode.contentOn(x, ch); if (c) { Levels.assign(c, rec.keys, whole ? rec : null); if (x._thumb) x._thumbRev = -1; else x._thumb = null; } });   // repainted in place by the list's tick (GradUI.put says why)
    if (!live) refreshLayerList();
  },
  // The levels of a chain at which what is visible changes on these channels: 0, and every level
  // whose set of weights differs from the level above it. A stack without level content is [0] —
  // and then the export is exactly what it always was.
  restarts(slot, chs, last){
    if (!slot || !Levels.any(slot.layers)) return [0];
    const sig = k => {
      const w = [];
      const walk = (nodes, up) => {
        for (const n of nodes) {
          if (!n.visible) continue;
          if (isGroup(n)) { if (visibleLeaves(n.children).some(x => Levels.on(x, chs))) walk(n.children, up * Levels.weight(n, k)); }
          else if (Levels.on(n, chs)) { const wt = up * Levels.weight(n, k); w.push(wt + (wt ? chs.map(ch => Levels.sig(LayerNode.contentOn(n, ch), k)).join("|") : "")); }
        }
      };
      walk(slot.layers, 1);
      return w.join(",");
    };
    const at = [0];
    for (let k = 1, prev = sig(0); k <= last; k++) { const s = sig(k); if (s !== prev) at.push(k); prev = s; }
    return at;
  },
  // What the export row says: from the first level the author made to the chain's last.
  note(at, last){ return at[1] === last ? "own level " + last : "own levels " + at[1] + "–" + last; },
  // The range in words, for the layer panel; short, for the layer list's tag.
  label(r){
    if (!r) return "every level";
    const s = r.soft ? " · soft " + r.soft : "";
    if (r.from === r.to) return "level " + r.from + s;
    return (r.to === Levels.TOP ? "from level " + r.from : "levels " + r.from + "–" + r.to) + s;
  },
  short(r){ return "mip " + (r.from === r.to ? r.from : r.to === Levels.TOP ? r.from + "+" : r.from + "–" + r.to); },

  // The layer menu's entries: Near only, Far only, and the way back.
  menu(slot, L){
    const k = Levels.CROSS, d = Levels.distance(slot, L, k), m = d ? ", ~" + Math.round(d.from) + " m at 1440p" : "";
    return [
      { label: "Near only — levels 0–" + (k - 1) + (d ? ", up to" + m.slice(1) : ""), run: () => Levels.set(slot, L, Levels.near(k), "near only") },
      { label: "Far only — level " + k + " on" + (d ? ", from" + m.slice(1) : ""), run: () => Levels.set(slot, L, Levels.far(k), "far only") },
      L.levels ? { label: "Every level (it shows at " + Levels.label(L.levels) + ")", run: () => Levels.set(slot, L, null) } : null,
    ];
  },
  // ---- one undo step, on every texture a linked layer spans ----
  set(slot, L, rec, what){
    if (!L) return;
    const was = Levels.clone(Levels.of(L)), to = Levels.clone(rec);
    const apply = v => { familyApply(L, x => { x.levels = Levels.clone(v); x._thumb = null; }); refreshLayerList(); };
    pushAction(what || (to ? "limit to mip levels" : "show at every level"), () => apply(was), () => apply(to));
    apply(to);
    const far = to ? Levels.reach(slot, L) : "";
    setStatus(to ? "“" + L.name + "” shows at " + Levels.label(to) + (far ? " — " + far : "") +
        (to.from > 0 ? ". It is not in level 0: the 3-D view shows it from far enough away (In game for the game's distances), the 2-D view at its Level " + to.from : "")
      : "“" + L.name + "” shows at every level again", "ok");
  },

  // ---- how far that is (docs/MIP_LEVELS.md §1) ----
  // Face-on, level k is fully in use at d_k = 2^k · H / (ρ · 2 tan(fov / 2)) and starts to blend in
  // half that far (trilinear): H the screen's height, ρ the texels per metre the parts' UVs give
  // them. Measured density, ASSUMED view — 1440p and a 50° vertical field of view, until the owner's
  // ruler check calibrates it (§2).
  VIEW: { height: 1440, fov: 50 },
  _rho: new WeakMap(),         // geometry → (sheet size + parts → texels per metre)
  // The median texels per metre, by area, over the triangles this layer applies to on its sheet —
  // its part limit, or every part on the sheet. 0 without a model.
  density(slot, L){
    if (!App.geomData || !App.matSlot || !slot || !slot.composite) return 0;
    const W = slot.composite.width, H = slot.composite.height, parts = Scope.parts(L);
    const key = slot.id + "|" + W + "x" + H + "|" + (parts ? parts.slice().sort().join("\u0000") : "");
    let memo = Levels._rho.get(App.geomData);
    if (!memo) Levels._rho.set(App.geomData, memo = new Map());
    if (memo.has(key)) return memo.get(key);
    const want = parts ? new Set(parts) : null, tris = [];
    let total = 0;
    for (const g of App.geomData) {
      if (App.matSlot.get(g.mat) !== slot.id || (want && !want.has(g.name)) || !g.uv || !g.position) continue;
      const P = g.position, U = g.uv;
      for (let t = 0, n = Math.floor(P.length / 9); t < n; t++) {
        const o = t * 9, q = t * 6;
        const ax = P[o+3] - P[o], ay = P[o+4] - P[o+1], az = P[o+5] - P[o+2];
        const bx = P[o+6] - P[o], by = P[o+7] - P[o+1], bz = P[o+8] - P[o+2];
        const area = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
        const uv = Math.abs((U[q+2] - U[q]) * (U[q+5] - U[q+1]) - (U[q+4] - U[q]) * (U[q+3] - U[q+1])) * W * H / 2;
        if (area > 1e-12 && uv > 0) { tris.push([Math.sqrt(uv / area), area]); total += area; }
      }
    }
    let rho = 0;
    if (tris.length) {
      tris.sort((a, b) => a[0] - b[0]);
      let acc = 0;
      for (const [d, a] of tris) { acc += a; if (acc >= total / 2) { rho = d; break; } }
    }
    memo.set(key, rho);
    return rho;
  },
  // Where level k starts to show on this layer's parts, and where it has fully taken over, in metres
  // at the assumed view — or null without a model. The export size scales the sheet's density.
  distance(slot, L, k){
    let rho = Levels.density(slot, L);
    if (!rho) return null;
    const o = slot.exp && slot.exp.c, W = slot.composite.width;
    if (o && o.size && o.size < W) rho *= o.size / W;
    const d0 = Levels.VIEW.height / (rho * 2 * Math.tan(Levels.VIEW.fov * Math.PI / 360));
    return { rho: Math.round(rho), from: d0 * Math.pow(2, k - 1), full: d0 * Math.pow(2, k) };
  },
  // The same in words, for a range: "" without a model.
  reach(slot, L){
    const r = Levels.of(L);
    if (!r) return "";
    const m = v => v < 1 ? "<1 m" : "~" + (v < 10 ? v.toFixed(1) : Math.round(v)) + " m";
    const a = r.from > 0 ? Levels.distance(slot, L, r.from) : null, b = r.to < Levels.TOP ? Levels.distance(slot, L, r.to + 1) : null;
    if ((r.from > 0 && !a) || (r.to < Levels.TOP && !b)) return "";
    const view = " at " + Levels.VIEW.height + "p (an assumed " + Levels.VIEW.fov + "° view)";
    if (a && b) return "shows from " + m(a.from) + " to " + m(b.full) + view;
    if (a) return "shows from " + m(a.from) + ", fully by " + m(a.full) + view;
    return "shows up to " + m(b.from) + ", gone by " + m(b.full) + view;
  },

  // ---- the effect presets (docs/MIP_LEVELS.md §6.3–6.6) ----
  // Each builds ordinary layers — fills, effects and groups with a range or keys — that the user can
  // open and change; no hidden machinery, like the ruler and the path presets. A layer one of them
  // adds is limited to what is selected (parts, a rectangle) when something is. One undo step each.
  CAVEAT: "A level effect changes with distance and, on a UserSkin, with the viewing angle too (the game samples a UserSkin's levels the x1 way). Gaijin's tool regenerates a Market skin's levels, so it is a UserSkin effect.",
  PRESETS: [
    { id: "holo", word: "Holo foil",
      what: "A colour that runs along a palette as the game walks down the levels, over the paint, with gloss and metalness that rise with it — iridescent foil that shifts with distance and angle.",
      fields: [{ id: "palette", word: "Palette", kind: "palette", def: "foil" }, { id: "first", word: "First level", kind: "level", def: 2 },
               { id: "cycle", word: "Levels per cycle", kind: "int", min: 1, max: 12, def: 4 }, { id: "strength", word: "Strength %", kind: "int", min: 5, max: 100, def: 60 }] },
    { id: "flip", word: "Colour flip",
      what: "One colour near and another from a crossover on: automotive colour-shift paint.",
      fields: [{ id: "near", word: "Near colour", kind: "colour", def: "#5a1e78" }, { id: "far", word: "Far colour", kind: "colour", def: "#2f9e5a" },
               { id: "cross", word: "Far from level", kind: "level", def: 3, min: 1 }, { id: "soft", word: "Soft", kind: "int", min: 0, max: 3, def: 0 },
               { id: "blend", word: "Over the paint", kind: "blend", def: "color" }] },
    { id: "camo", word: "Distance camouflage",
      what: "A near-look group and a far-look group, each shown on its side of a crossover — dual-scale camouflage whose far pattern is designed, not whatever the near one averages into.",
      fields: [{ id: "near", word: "Near look", kind: "group", def: 0 }, { id: "far", word: "Far look", kind: "group", def: 1 },
               { id: "cross", word: "Far from level", kind: "level", def: 3, min: 1 }, { id: "soft", word: "Soft", kind: "int", min: 0, max: 3, def: 1 }] },
    { id: "flake", word: "Metal flake",
      what: "Fine flakes in gloss and metalness up close, and a sheen of your choosing from a crossover on instead of the grey they would average into.",
      fields: [{ id: "amount", word: "Flake strength", kind: "int", min: 0, max: 128, def: 48 }, { id: "gloss", word: "Sheen smoothness", kind: "int", min: 0, max: 255, def: 200 },
               { id: "metal", word: "Sheen metalness", kind: "int", min: 0, max: 255, def: 200 }, { id: "cross", word: "Sheen from level", kind: "level", def: 2, min: 1 }] },
  ],
  // Run one on a slot with the dialog's values; the node it made (or the group it changed), or null
  // with the reason on the status line.
  preset(slot, id, v){
    const P = Levels.PRESETS.find(p => p.id === id);
    if (!P) return null;
    if (!slot || !slot.composite) { setStatus("Select a texture slot first", "err"); return null; }
    const last = Levels.last(slot.composite.width, slot.composite.height);
    const lv = (x, lo) => Math.max(lo || 0, Math.min(last, Math.round(+x) || 0));
    const sc = Scope.ofSelection();
    const leaf = rec => { const L = LayerNode.of(Object.assign({ opacity: 1, blend: "normal", visible: true }, rec)); if (sc) L.scope = Scope.clone(sc); return L; };
    const grey = (name, chan, v, o) => leaf(Object.assign({ type: "fill", name, chan, color: hexOfGrey(v) }, o || {}));
    const group = (name, kids, levels) => { const G = newGroupNode(name); G.children = kids; G.collapsed = true; if (levels) G.levels = levels; return G; };
    let made = null, said = "";
    if ((id === "flake") && !slot.smooth) { setStatus("Metal flake is gloss and metalness, which live on the _n — this texture has none loaded (⋮ ▸ load _n…)", "err"); return null; }
    if (id === "holo") {
      const f = lv(v.first), n = Math.max(1, Math.round(+v.cycle) || 4), a = Math.max(0, Math.min(1, (+v.strength || 0) / 100)), end = Math.min(last, f + n);
      const st = Gradient.holo(v.palette) || Gradient.holo("foil"), col = [];
      const along = t => {
        for (let i = 0; i < st.length; i++) if (t <= st[i].t) return i ? Levels.lerp(st[i - 1].color, st[i].color, (t - st[i - 1].t) / (st[i].t - st[i - 1].t)) : st[0].color;
        return st[st.length - 1].color;
      };
      for (let k = f; k <= last; k++) col.push([k, along(((k - f) / n) % 1)]);
      // gloss and metalness only where there is an _n to carry them
      made = group("Holo foil", [leaf({ type: "fill", name: "Foil colour", color: col[0][1], keys: { color: col }, blend: "color", opacity: a })].concat(slot.smooth ? [
        grey("Foil gloss", "smooth", 200, { keys: { color: [[f, hexOfGrey(200)], [end, hexOfGrey(245)]] }, opacity: a }),
        grey("Foil metal", "metal", 160, { keys: { color: [[f, hexOfGrey(160)], [end, hexOfGrey(255)]] }, opacity: a }),
      ] : []), Levels.make(f, Levels.TOP, 0));
      said = "Holo foil from level " + f + ", a cycle every " + n + " level" + (n > 1 ? "s" : "") + (slot.smooth ? "" : " — colour only: this texture has no _n loaded for its gloss and metalness");
    } else if (id === "flip") {
      const k = lv(v.cross, 1), s = Math.max(0, Math.round(+v.soft) || 0);
      const near = /^#[0-9a-f]{6}$/i.test(v.near) ? v.near.toLowerCase() : "#5a1e78", far = /^#[0-9a-f]{6}$/i.test(v.far) ? v.far.toLowerCase() : "#2f9e5a";
      made = leaf({ type: "fill", name: "Colour flip", color: near, keys: { color: [[Math.max(0, k - 1 - s), near], [k, far]] },   // far in full from k, as the camouflage's far group is
                    blend: COLOR_BLENDS.includes(v.blend) ? v.blend : "color" });
      said = "Colour flip: " + near + " near, " + far + " from level " + k;
    } else if (id === "camo") {
      const groups = layerNodes(slot.layers).filter(isGroup);
      const N = groups.find(g => g.uid === v.near), F = groups.find(g => g.uid === v.far);
      if (!N || !F || N === F) { setStatus("Distance camouflage needs two different groups on this texture — the near look and the far look", "err"); return null; }
      // one inside the other would weigh 0 at every level: the far look under a near-only parent never shows
      if (nodeContains(N, F) || nodeContains(F, N)) { setStatus("“" + N.name + "” and “" + F.name + "” are one inside the other — pick two groups side by side", "err"); return null; }
      const k = lv(v.cross, 1), s = Math.max(0, Math.min(Levels.SOFT, Math.round(+v.soft) || 0));
      const was = [Levels.clone(N.levels), Levels.clone(F.levels)], to = [Levels.make(0, k - 1, s), Levels.make(k, Levels.TOP, s)];
      const apply = w => { N.levels = Levels.clone(w[0]); F.levels = Levels.clone(w[1]); N._thumb = F._thumb = null; scheduleComposite(slot); refreshLayerList(); };
      pushAction("distance camouflage", () => apply(was), () => apply(to));
      apply(to);
      setStatus("“" + N.name + "” shows near, to level " + (k - 1) + "; “" + F.name + "” from level " + k + (s ? ", fading over " + s : "") +
        (was[0] || was[1] ? " — the range either had before is replaced" : ""), "ok");
      return N;
    } else if (id === "flake") {
      const k = lv(v.cross, 1), amt = Math.max(0, Math.min(128, Math.round(+v.amount) || 0));
      const noise = (name, chan) => leaf({ type: "adjust", name, chan, ...Effect.HSBC_REST, fx: { type: "noise", amount: amt, mono: true, seed: 1 + Math.floor(Math.random() * 1e9) } });
      const nearL = noise("Flake gloss", "smooth"), nearM = noise("Flake metal", "metal");
      const farL = grey("Sheen gloss", "smooth", +v.gloss), farM = grey("Sheen metal", "metal", +v.metal);
      nearL.levels = nearM.levels = Levels.near(k); farL.levels = Levels.far(k); farM.levels = Levels.far(k);
      made = group("Metal flake", [nearL, nearM, farL, farM]);
      said = "Metal flake: flakes to level " + (k - 1) + ", the sheen from level " + k;
    }
    addLayerTo(slot, made);
    setStatus(said + (sc ? ", on " + Scope.label({ scope: sc }) : "") + " — ordinary layers you can open and change. The 3-D view's In game and Mip levels view show where each level lands", "ok");
    return made;
  },

  // ---- the level ruler (docs/MIP_LEVELS.md §6.1) ----
  // One group per level, each a flat colour and that level's number at a size it stays legible at,
  // plus a filter strip — the measurement §2 waits on: put on a vehicle in the game, it shows which
  // level lands where on that machine. Ordinary layers, which the user can open and change.
  COLORS: ["#e6194b", "#f58231", "#ffe119", "#3cb44b", "#42d4f4", "#4363d8", "#911eb4", "#f032e6",
           "#ffffff", "#a9a9a9", "#800000", "#9a6324", "#808000", "#000075", "#469990", "#000000"],
  // The number tiled over a level's sheet, drawn at half that level's resolution — a 2048² sheet's
  // level-0 numbers cost 4 MB, not 16 — and scaled up as a decal covering the sheet, so the box filter
  // down to the level reads it back. Only where the level is 64 texels or more: smaller, a part's
  // island is a few texels and the colour is the reading.
  numbers(k, W, H){
    if ((Math.min(W, H) >> k) < 64) return null;
    const f = Math.max(2 << k, Math.max(W, H) / 2048);            // sheet texels per bitmap pixel
    const bw = Math.max(1, Math.round(W / f)), bh = Math.max(1, Math.round(H / f)), cell = 24;
    const c = mkCanvas(bw, bh), g = ctx2d(c);
    g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = "#ffffff"; g.fillStyle = "#000000";
    for (let y = cell / 2; y < bh; y += cell) for (let x = cell / 2; x < bw; x += cell) { g.strokeText(String(k), x, y); g.fillText(String(k), x, y); }
    return { bmp: c, scale: W / bw };
  },
  // Two bands across the sheet, at a third and two thirds of its height (rows on whole bands, even).
  strip(W, H){
    const h = Math.max(8, Math.min(128, H >> 4)), seg = Math.max(8, Math.min(128, W >> 4));
    return { h, seg, ys: [Math.floor(H / 3 / h) * h, Math.floor(2 * H / 3 / h) * h] };
  },
  // The filter strip: a one-texel black-and-white checker at level 0. Taken down to level 1 by the
  // export's box filter it is the sRGB mean, 128; over every other segment a second layer puts the
  // LINEAR-LIGHT mean instead, 188 (0.5 in linear light, back in sRGB). In the game, the half that
  // keeps its brightness as level 0 gives way to level 1 is the one averaged the way the game filters
  // — which decides how auto levels should be averaged (§2, question 5). Both are limited to levels
  // 0–1, so the deeper levels are the ruler's colours alone. Each layer draws its band twice — the
  // second is its mirrored copy (`sym`), so there the halves swap sides, which changes nothing.
  stripGroup(W, H){
    const S = Levels.strip(W, H);
    const chk = mkCanvas(W, S.h), cg = ctx2d(chk), ci = cg.createImageData(W, S.h);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < W; x++) {
      const v = (x + y) & 1 ? 255 : 0, i = (y * W + x) * 4;
      ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = v; ci.data[i + 3] = 255;
    }
    cg.putImageData(ci, 0, 0);
    const lin = mkCanvas(W, S.h), lg = ctx2d(lin);
    lg.fillStyle = "#bcbcbc";
    for (let x = S.seg; x < W; x += 2 * S.seg) lg.fillRect(x, 0, S.seg, S.h);
    const at = { x: .5, y: (S.ys[0] + S.h / 2) / H, sym: { x: .5, y: (S.ys[1] + S.h / 2) / H } };
    const band = (name, bmp, lv) => {
      const L = LayerNode.of(Object.assign({ type: "decal", name, bmp, scale: 1, rot: 0, flip: false, opacity: 1, blend: "normal", visible: true }, at));
      L.levels = lv;
      return L;
    };
    const G = newGroupNode("Filter strip");
    G.children = [band("Checker — every other segment auto-averaged (sRGB)", chk, Levels.make(0, 1, 0)),
                  band("Linear-light mean over the other segments", lin, Levels.make(1, 1, 0))];
    G.collapsed = true;
    return G;
  },
  ruler(slot){
    if (!slot || !slot.composite) { setStatus("Select a texture slot first", "err"); return null; }
    const W = slot.composite.width, H = slot.composite.height, last = Levels.last(W, H), kids = [];
    for (let k = 0; k <= last; k++) {
      const parts = [LayerNode.of({ type: "fill", name: "Level " + k + " colour", color: Levels.COLORS[k] || "#808080", opacity: 1, blend: "normal", visible: true })];
      const num = Levels.numbers(k, W, H);
      if (num) parts.push(LayerNode.of({ type: "decal", name: "Level " + k + " number", bmp: num.bmp, x: .5, y: .5, scale: num.scale,
                                         rot: 0, flip: false, opacity: 1, blend: "normal", visible: true }));
      const G = newGroupNode("Level " + k);
      G.children = parts; G.collapsed = true;
      G.levels = Levels.make(k, k === last ? Levels.TOP : k, 0);
      kids.push(G);
    }
    kids.push(Levels.stripGroup(W, H));
    const R = newGroupNode("Level ruler");
    R.children = kids; R.collapsed = true;
    addLayerTo(slot, R);
    setStatus("Level ruler on " + slot.id + ": levels 0–" + last + ", one colour and number each, and a filter strip. " +
      "The 3-D view's Mip levels view and In game show where each one takes over here; export with it and walk away from the vehicle in the game to see where it does there", "ok");
    return R;
  },
};
