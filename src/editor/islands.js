"use strict";
// ---------- UV islands: the shells a sheet's layout is actually made of ----------
// ROADMAP 4.24, requested as "ability to click select UV islands to edit, similar to part select".
//
// **An island is finer than a part in both directions, and that is the point.** One part is usually
// several shells (a hull's deck, its sides, its skirts) and one shell is routinely shared by several
// parts — 4.22 was precisely a shell shared by the left and right of a hull. So "the region under
// the cursor" was a thing the app could not name, and every tool that already takes a stencil takes
// this one.
//
// **The adjacency was already being computed, once per slot, and thrown away.** `buildUVOverlay`
// quantises every UV to a 4096 grid and counts how many triangles share each edge, so it can stroke
// the ones with a count of 1 — that is the island BOUNDARY. Union the triangles behind every shared
// edge and the connected components ARE the islands: the same pass, the same quantisation, a
// union-find on top. So this builds both and the overlay draws from `boundary` rather than walking
// the mesh a second time.
//
// **Q is the correctness knob, and it is inherited rather than chosen.** Too coarse and two islands
// passing within 1/Q of each other merge; too fine and a shell whose vertices differ in the last bit
// splits in half. It has to stay the *overlay's* Q whatever it is: the outline drawn on screen and
// the set a click selects have to be the same decomposition, or the app would be showing one answer
// and acting on another.
//
// **A mirrored shell is one island in UV and two sides of the vehicle in 3-D.** Selecting it selects
// both — they are the same texels, so that is correct — and it will still surprise, which is why the
// status line says how many parts an island spans, the way the part scope says how many parts it
// took.
//
// **One binding, not eight.** 2.3 is still open, so every name here would otherwise be another
// entry in the one shared scope CLAUDE.md §2 is measuring down; the file is a namespace object for
// the same reason `Marquee`, `SelectUI` and `PartsPanel` are.
const UVIslands = {
  Q: 4096,

  // Edge keys are strings and not packed integers on purpose. A quantised endpoint is `Math.round(u*Q)`
  // and **u is not bounded to [0,1]** — a tiled UV layout puts triangles at u = 3.5, and 4.23(a) is
  // still open — so there is no integer range to pack into. This is also the key buildUVOverlay used,
  // which keeps the two decompositions provably identical rather than merely intended to be.
  edgeKey(ax, ay, bx, by){
    return (ax < bx || (ax === bx && ay < by))
      ? ax + "," + ay + "," + bx + "," + by
      : bx + "," + by + "," + ax + "," + ay;
  },

  // The decomposition of one slot's UV layout, cached on the slot. Rebuilt when the geometry, the V
  // flip or the stencil resolution changes — the first two change what an island IS, the third only
  // changes the raster, but the raster is most of the cost so there is nothing to save by splitting.
  of(slot){
    if (!slot || !slot.composite || !App.geomData) return null;
    const D = maskDims(slot.composite.width, slot.composite.height);
    const flipV = $("optFlipV").checked;
    const c = slot._uvIslands;
    if (c && c.geo === App.geomData && c.flipV === flipV && c.w === D.w && c.h === D.h) return c;
    return (slot._uvIslands = UVIslands.build(slot, D, flipV));
  },

  build(slot, D, flipV){
    const Q = UVIslands.Q;
    const chunks = [];
    let total = 0;
    for (const gd of App.geomData) {
      // Only the triangles that actually use THIS sheet — 0…1 UVs land somewhere on every texture, so
      // without the slot test a part living on another sheet contributes islands here (the same trap
      // partSetMaskCanvas documents).
      if (App.matSlot.get(gd.mat) !== slot.id) continue;
      const n = gd.uv.length / 6;
      if (!n) continue;
      chunks.push({ gd, off: total, n });
      total += n;
    }
    // Union-find over triangles, with path halving. `parent` is an Int32Array rather than a Map
    // because the index space is dense and known: one entry per triangle of this sheet.
    const parent = new Int32Array(total);
    for (let i = 0; i < total; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edges = new Map();
    const qx = [0, 0, 0], qy = [0, 0, 0];
    for (const ch of chunks) {
      const uv = ch.gd.uv;
      for (let t = 0; t < ch.n; t++) {
        for (let k = 0; k < 3; k++) {
          let u = uv[t * 6 + k * 2], v = uv[t * 6 + k * 2 + 1];
          if (flipV) v = 1 - v;
          qx[k] = Math.round(u * Q); qy[k] = Math.round(v * Q);
        }
        const gi = ch.off + t;
        for (let k = 0; k < 3; k++) {
          const j = (k + 1) % 3;
          const key = UVIslands.edgeKey(qx[k], qy[k], qx[j], qy[j]);
          const cur = edges.get(key);
          if (cur === undefined) { edges.set(key, { n: 1, t: gi, ax: qx[k], ay: qy[k], bx: qx[j], by: qy[j] }); continue; }
          cur.n++;
          // Union with the FIRST triangle recorded on this edge, not with the previous one. Three or
          // more triangles meeting at an edge is not a valid manifold but it does occur in shipped
          // meshes, and unioning every one of them to the same representative keeps the component
          // whole either way.
          const a = find(cur.t), b = find(gi);
          if (a !== b) parent[b] = a;
        }
      }
    }
    // Number the roots in first-seen order, so the ids of a given mesh are stable across rebuilds —
    // that is what lets a selection survive a V flip or a resize if anything ever wants it to.
    const comp = new Int32Array(total);
    const label = new Int32Array(total).fill(-1);
    let count = 0;
    for (let i = 0; i < total; i++) {
      const r = find(i);
      if (label[r] < 0) label[r] = count++;
      comp[i] = label[r];
    }
    // Per-component UV bounds, for the box a selection reports and the verbs operate over.
    const bnds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { bnds[i*4] = bnds[i*4+1] = Infinity; bnds[i*4+2] = bnds[i*4+3] = -Infinity; }
    for (const ch of chunks) {
      const uv = ch.gd.uv;
      for (let t = 0; t < ch.n; t++) {
        const o = comp[ch.off + t] * 4;
        for (let k = 0; k < 3; k++) {
          let u = uv[t * 6 + k * 2], v = uv[t * 6 + k * 2 + 1];
          if (flipV) v = 1 - v;
          if (u < bnds[o]) bnds[o] = u;
          if (u > bnds[o+2]) bnds[o+2] = u;
          if (v < bnds[o+1]) bnds[o+1] = v;
          if (v > bnds[o+3]) bnds[o+3] = v;
        }
      }
    }
    // ---- the hit test ----
    // A click asks "which island is under this texel", from either view, and the honest way to answer
    // it is to rasterise component IDS where a stencil rasterises white: the same rasteriser, the same
    // conservative coverage, one typed array, and the hit test becomes one read instead of a
    // point-in-triangle search over 38 000 triangles.
    //
    // Ids are stored **+1**, so 0 means "no island here" — the gutter between the shells, which is most
    // of a sheet. Where two islands overlap (routine in an atlas) the later triangle wins, so a click
    // takes the one drawn on top; there is no better answer a single click can be given.
    const ids = count < 65535 ? new Uint16Array(D.w * D.h) : new Int32Array(D.w * D.h);
    const val = count < 65535 ? new Uint16Array(total) : new Int32Array(total);
    for (let i = 0; i < total; i++) val[i] = comp[i] + 1;
    for (const ch of chunks)
      rasterUVTriangles(ids, ch.gd.uv, D.w, D.h, flipV, val.subarray(ch.off, ch.off + ch.n));
    // The boundary edges, flat, for the overlay: x0,y0,x1,y1 per edge in quantised UV.
    let nb = 0;
    for (const e of edges.values()) if (e.n === 1) nb++;
    const boundary = new Int32Array(nb * 4);
    let bi = 0;
    for (const e of edges.values()) {
      if (e.n !== 1) continue;
      boundary[bi++] = e.ax; boundary[bi++] = e.ay; boundary[bi++] = e.bx; boundary[bi++] = e.by;
    }
    return { geo: App.geomData, flipV, w: D.w, h: D.h, chunks, comp, count, bnds, ids, boundary, Q };
  },

  // Which island is under this point, in SHEET texels — the same coordinates the 2-D view's pointer
  // gives and the same ones a 3-D hit converts to (`hit.uv.x * W`, `(1 - hit.uv.y) * H`), because the
  // mesh's own UVs already carry the V flip. Returns 0 for gutter.
  at(slot, px, py){
    const I = UVIslands.of(slot);
    if (!I || !I.count) return 0;
    const x = Math.floor(px * I.w / slot.composite.width), y = Math.floor(py * I.h / slot.composite.height);
    if (x < 0 || y < 0 || x >= I.w || y >= I.h) return 0;
    return I.ids[y * I.w + x];
  },

  // White where any of `ids` covers this sheet. Same shape, same cache and same dilation as
  // `partSetMaskCanvas` — an island stencil and a part stencil are the same kind of object, and every
  // consumer already knows how to scale one when it samples.
  stencil(slot, w, h, ids){
    const I = UVIslands.of(slot);
    if (!I || !ids || !ids.size) return null;
    const cache = slot._partMaskCache || (slot._partMaskCache = new Map());
    const flipV = $("optFlipV").checked;
    const list = [...ids].sort((a, b) => a - b);
    const key = "isl|" + w + "x" + h + "|" + (flipV ? "F" : "N") + "|g" + MASK_GROW + "|" + list.join(" ");
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const D = maskDims(w, h);
    const img = new ImageData(D.w, D.h);
    const px = new Uint32Array(img.data.buffer);
    let any = false;
    for (const ch of I.chunks) {
      // One value per triangle: opaque white for the wanted components and 0 — "skip" — for the rest.
      // That is why rasterUVTriangles treats a per-triangle 0 as "not this one" rather than writing it.
      const val = new Uint32Array(ch.n);
      let hit = false;
      for (let t = 0; t < ch.n; t++) if (ids.has(I.comp[ch.off + t])) { val[t] = 0xFFFFFFFF; hit = true; }
      if (!hit) continue;
      any = true;
      rasterUVTriangles(px, ch.gd.uv, D.w, D.h, flipV, val);
    }
    let result = null;
    if (any) {
      const c = mkCanvas(D.w, D.h);
      ctx2d(c).putImageData(img, 0, 0);
      result = growMask(c);
    }
    cache.set(key, result);
    trimMaskCache(cache);
    return result;
  },

  // The box these islands live in, in whole sheet texels. Taken from the UV bounds rather than by
  // scanning the raster back — a 2048² readback to learn four numbers the build already had.
  //
  // It carries the same pad the stencil's dilation adds, converted from mask texels to sheet texels:
  // a box that cropped the stencil it is supposed to contain would clip the island's own bleed off
  // every verb that works inside it.
  bounds(slot, ids){
    const I = UVIslands.of(slot);
    if (!I || !ids || !ids.size) return null;
    const W = slot.composite.width, H = slot.composite.height;
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const c of ids) {
      const o = c * 4;
      if (!(o >= 0 && o + 3 < I.bnds.length)) continue;
      if (I.bnds[o] < u0) u0 = I.bnds[o];
      if (I.bnds[o+1] < v0) v0 = I.bnds[o+1];
      if (I.bnds[o+2] > u1) u1 = I.bnds[o+2];
      if (I.bnds[o+3] > v1) v1 = I.bnds[o+3];
    }
    if (!(u1 >= u0 && v1 >= v0)) return null;
    const D = maskDims(W, H);
    const pad = Math.ceil(MASK_GROW / (D.k || 1)) + 1;
    // v is measured up the sheet and y down it, so the box's top comes from the island's highest v.
    return Marquee.norm({ x: Math.floor(u0 * W) - pad, y: Math.floor((1 - v1) * H) - pad,
      w: Math.ceil((u1 - u0) * W) + 2 * pad, h: Math.ceil((v1 - v0) * H) + 2 * pad }, W, H);
  },

  // The islands that live on these parts — the other half of the parts/islands bridge, and the one
  // that has to walk the mesh: `parts` reads a component id per triangle, this reads a name per
  // chunk. Requested 2026-09-01 ("fluent transition between parts and islands selection"): the two
  // answer the same question at two grains and there was no way from either one to the other.
  //
  // An island a selected part SHARES with an unselected one comes with it, and that is not a bug to
  // fix: they are the same texels, so there is no stencil that could hold one and not the other.
  // The caller says so in the status line rather than pretending otherwise.
  ofParts(slot, names){
    const I = UVIslands.of(slot), out = new Set();
    if (!I || !names || !names.size) return out;
    for (const ch of I.chunks) {
      if (!names.has(ch.gd.name)) continue;
      for (let t = 0; t < ch.n; t++) out.add(I.comp[ch.off + t]);
    }
    return out;
  },

  // Which model parts these islands touch. Only ever asked once per click, so it walks rather than
  // keeping a set per component — 20 000 Sets to answer a question nobody may ask is the wrong trade.
  parts(slot, ids){
    const I = UVIslands.of(slot), out = new Set();
    if (!I || !ids) return out;
    for (const ch of I.chunks) {
      for (let t = 0; t < ch.n; t++) if (ids.has(I.comp[ch.off + t])) { out.add(ch.gd.name); break; }
    }
    return out;
  },
};
