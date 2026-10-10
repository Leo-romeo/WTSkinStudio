/*==SCOPE==*/
"use strict";
// ---------- Where a layer applies: a selection recipe, not a list of parts ----------
// ROADMAP 4.28(g). A layer could be limited to a set of model PARTS and to nothing else, which was
// Substance's "polygon fill" idea and a good one — the scope is stored as part names, so it survives
// a texture resize, a project reload and a re-projection exactly, where a baked mask only survives
// by resampling. What it could not express is the other thing the app lets you select: a rectangle.
// Draw a marquee, add a layer, and the marquee was silently not carried; the only way to keep it was
// to bake it into a mask and give up the exactness that made a scope worth having.
//
// So a scope is a RECIPE now — the same shape a selection has — and the stencil is the intersection
// of whatever it names, which is how a part selection and a marquee already compose when they
// confine a brush stroke (`t59` compares those two stencils texel for texel).
//
//     { parts: ["turret", "hull"], rect: { x, y, w, h } }     either half may be absent
//
// **UV islands are deliberately NOT in it**, and this is the one place that decision is written
// down. 4.24(b) parked persisting an island pick with a reason that still holds: an island's
// identity is derived from the geometry, so a stored id is a promise about a model the user can
// replace under it, and the failure would be a layer that silently applies somewhere else. The
// island half of a selection is baked instead, in one click, by `Marquee.toMask` — a mask is a
// picture of where you meant and cannot be wrong about a model it no longer matches. When 4.24(b)
// is taken, `islands` is a third key here and `stencil` gains one more intersection.
//
// One binding, and it takes three with it: `layerScopeKey`, `scopeLabel` and `layerScopeMask` are
// methods now (CLAUDE.md §5.6 — this is a net −2 on the global count).
const Scope = {
  // The recipe, or null. `undefined` is kept distinct from null by `parts` below, because the
  // projector reads it as "this layer predates per-layer scope at all".
  of(L){ return (L && L.scope) || null; },
  empty(sc){ return !sc || (!(sc.parts && sc.parts.length) && !sc.rect); },
  // The parts half, in the tri-state every existing reader expects: an array, null for "no parts",
  // and `undefined` for a layer that has no scope field at all.
  parts(L){
    if (!L || L.scope === undefined) return undefined;
    return (L.scope && L.scope.parts && L.scope.parts.length) ? L.scope.parts : null;
  },
  rect(L){ return (L && L.scope && L.scope.rect) || null; },
  // A recipe built from a list of parts, a rectangle, or both. Returns null for "no scope", so a
  // caller can assign the result straight onto a layer.
  make(parts, rect){
    const p = parts && parts.length ? parts.slice() : null;
    const r = rect && rect.w > 0 && rect.h > 0
      ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } : null;
    if (!p && !r) return null;
    const sc = {};
    if (p) sc.parts = p;
    if (r) sc.rect = r;
    return sc;
  },
  clone(sc){ return sc ? Scope.make(sc.parts, sc.rect) : null; },
  // What a new layer inherits, the way Substance's polygon fill does: select the turret, add a
  // fill, and the fill is the turret's — with no masking step. The rectangle rides along for the
  // same reason, and the ISLAND half is what the note above says it is.
  ofSelection(){
    const r = Marquee.rect();
    return Scope.make(App.selParts.size ? [...App.selParts] : null, r) || undefined;
  },

  // ---- the stencil, and its cache key ----
  key(L){
    const sc = Scope.of(L);
    if (Scope.empty(sc)) return "";
    const p = sc.parts && sc.parts.length ? sc.parts.slice().sort().join("\u0000") : "";
    const r = sc.rect ? "|r" + sc.rect.x + "," + sc.rect.y + "," + sc.rect.w + "," + sc.rect.h : "";
    return p + r;
  },
  // Name it the way the Parts tab does: when it is exactly one part group, use that group's name,
  // so the layer stack and the model hierarchy read as the same thing.
  label(L){
    const sc = Scope.of(L);
    if (Scope.empty(sc)) return "";
    const bits = [];
    const parts = sc.parts && sc.parts.length ? sc.parts : null;
    if (parts) {
      let named = "";
      if (App.partGroups && App.meshes.size) {
        const set = new Set(parts);
        for (const g of App.partGroups) {
          let n = 0, all = true;
          for (const name of App.meshes.keys()) if (partGroupOf(name) === g.name) { n++; if (!set.has(name)) { all = false; break; } }
          if (all && n && n === set.size) { named = g.name; break; }
        }
      }
      bits.push(named || (parts.length === 1 ? partLabel(parts[0]) : parts.length + " parts"));
    }
    if (sc.rect) bits.push(sc.rect.w + "×" + sc.rect.h + " box");
    return bits.join(" ∩ ");
  },
  // The intersection of whatever the recipe names, at mask resolution and cached per
  // (slot, size, flip, recipe) alongside the single-part masks.
  stencil(slot, L){
    const key = Scope.key(L);
    if (!key || !slot || !slot.composite) return null;
    const sc = Scope.of(L);
    const parts = sc.parts && sc.parts.length ? sc.parts : null;
    // A parts-only scope needs the model; a rectangle does not, and refusing one because no vehicle
    // is loaded would be a limit that is true for the wrong reason.
    if (parts && !App.geomData && !sc.rect) return null;
    const w = slot.composite.width, h = slot.composite.height;
    const cache = slot._partMaskCache || (slot._partMaskCache = new Map());
    const ck = "scope|" + w + "x" + h + "|" + ($("optFlipV").checked ? "F" : "N") + "|" + key;
    if (cache.has(ck)) { const v = cache.get(ck); cache.delete(ck); cache.set(ck, v); return v; }   // LRU touch
    const D = maskDims(w, h);
    let out = null;
    if (sc.rect) {
      out = mkCanvas(D.w, D.h);
      const g = ctx2d(out);
      g.fillStyle = "#fff";
      g.fillRect(Math.floor(sc.rect.x * D.k), Math.floor(sc.rect.y * D.k),
                 Math.max(1, Math.round(sc.rect.w * D.k)), Math.max(1, Math.round(sc.rect.h * D.k)));
    }
    if (parts && App.geomData) {
      const pm = partSetMaskCanvas(slot, w, h, parts);          // one path for the whole set — no inter-part seams
      if (!out) {
        // Scope naming a model that is not loaded: show the layer rather than silently blanking it.
        // Parts that exist but live on other sheets: an empty stencil, i.e. nothing here.
        out = pm || (parts.some(p => App.meshes.has(p)) ? mkCanvas(D.w, D.h) : null);
      } else {
        const g = ctx2d(out);
        g.globalCompositeOperation = "destination-in";
        if (pm) g.drawImage(pm, 0, 0, D.w, D.h); else g.clearRect(0, 0, D.w, D.h);
        g.globalCompositeOperation = "source-over";
      }
    }
    cache.set(ck, out);
    trimMaskCache(cache);
    return out;
  },
};
/*==ENDSCOPE==*/
