/*==UVTRI==*/
"use strict";
// ---------- Rasterising a part's UV triangles ----------
// Marked since ROADMAP 4.45: the cockpit transfer bake's worker lifts this section, so the texels a
// transfer writes are exactly the ones this rasteriser says an island covers — the same set the
// export pads from (getUVMask) and the island decomposition answers clicks from. Pure: no DOM, no
// App, and the "use strict" sits inside the marker so a pool that lists UVTRI first is strict too.
// One byte per texel, set where any of `uv`'s triangles covers it. `mask` is any flat indexable
// array — the caller picks what a covered texel holds, which is the whole of why there is one
// rasteriser and not two:
//
//   getUVMask          a Uint8Array and the value 1, because padSeams tests `filled[i] === 1`
//   partSetMaskCanvas  a Uint32Array over an ImageData's buffer and 0xFFFFFFFF, i.e. opaque white
//
// The second writes the stencil straight into the pixels it will become, so nothing converts a
// byte array into an image afterwards. Both constants are palindromic in their bytes, so neither
// depends on the machine's endianness.
//
// ---- why this is not a canvas path any more (ROADMAP 4.23(b)) ----
// It was, until 2026-08-28: every triangle of a part went into one `Path2D` and `fill()` rasterised
// them together. Measured on the reported t55e1 hull — 38 222 triangles into a 2048² stencil, each
// phase behind a `getImageData` barrier so none was billed the previous one's backlog:
//
//     the walk over the triangles, into a counting sink        6.4 ms
//     the same walk plus g.fill()                           1199.3 ms
//     hardenMask afterwards, at the default bleed of 2         65.2 ms
//     ---- and what replaced all three ----
//     THIS function, straight into bytes (the export path)     200.0 ms
//     the same, into an ImageData and onto a canvas            215.2 ms
//
// The walk was never the cost and the dilation was never the cost: **the fill was**, and it is
// gone. Two things to keep straight before quoting any of it.
//
// **The old path was measured twice and disagreed with itself** — 1199.3 + 65.2 in one run, 2388.4
// in another, same triangles, same size. Software canvas under a varying number of parallel test
// browsers. So the win here is somewhere between ~6x and ~12x and there is no point pretending to
// a third digit; what is solid is that one side moved by an order of magnitude and the other did
// not. The 200 ms is pure JS and repeated within 8% across every run.
//
// **On real hardware the gap is narrower**, because a GPU accelerates the blits and not the path
// tessellation, which Skia does on the CPU either way. It narrows; it does not invert. The 906 ms
// this item originally recorded for a 1024 stencil on the real hull is the same order.
//
// An earlier draft of this function used a plain barycentric centre test and measured 189.6 ms.
// The conservative test below costs about 10 ms more on this workload and is not optional — see
// "what covered means".
// ---- the two hazards that went away with it ----
// **Winding.** Canvas fills with the NONZERO rule, so two overlapping triangles wound opposite ways
// summed to zero and left a hole. Mirrored UV shells are the normal way to texture a symmetric
// vehicle — the left and right of a hull share one island and the mirrored side comes out wound the
// other way — so every texel the two halves shared was erased from the stencil. Measured on that
// same hull, 11 811 of the 38 222 triangles mirrored: the stencil covered **60.24%** of the sheet
// and should have covered **73.83%**. What the user met was a brush that did nothing on half the
// hull and a Fill that left it bare (ROADMAP 4.22, reported 2026-08-27).
//
// 4.22 fixed that by reversing two vertices of every clockwise triangle so one accumulated path
// carried one winding. **Here there is nothing to fix**: coverage is written per triangle, so a
// triangle cannot cancel another one. `evenodd` was measured too and is worse (46.38%) — overlap is
// the norm in a UV atlas, not the exception — and that whole question is now moot.
//
// **Antialiasing.** A path fill antialiased its edges, so every texel an island only partly covered
// came out at partial alpha; used as a stencil that is a hole, and `hardenMask` existed to drive
// those back to opaque with three whole-canvas self-composites. Flat coverage has no partial texels,
// so there is nothing to harden and those three composites are gone with it. The *grow* is not —
// see `growMask`, which is a separate idea about island padding and still wanted.
//
// ---- what "covered" means, exactly ----
// A texel is covered when the triangle TOUCHES IT AT ALL, not when its centre happens to be inside.
// That is conservative rasterisation, and it is chosen to match what it replaced: an antialiased
// fill tints every texel it partly covers and hardenMask then drove those to opaque, so "touched"
// is precisely the set the old path produced. It is done by evaluating each edge at the texel
// centre and slackening the test by the most that edge function can gain anywhere in that texel
// square — 0.5·(|ex| + |ey|) — which costs one add per edge and no extra sampling.
//
// Two things fall out of it, and both were separate mechanisms before:
//
//   * **slivers survive.** A triangle thinner than a texel contains no centre at all, so a centre
//     test drops it outright — measured, 0 texels for a horizontal or vertical sliver. That is what
//     the old hardenMask was rescuing in its second job ("which is also what rescues sliver
//     triangles thinner than a texel"), and it needs nothing of its own here.
//   * **nothing comes out tighter than the old path.** Measured against it on three shapes: 0 texels
//     missing anywhere, 4 extra on an axis-aligned island and 159 on an all-diagonal one, none more
//     than 1 texel from a boundary. Tighter is the direction that damages a file — padSeams
//     OVERWRITES any texel the mask calls outside with a neighbour colour, so a stencil one texel
//     tight along a diagonal smears the island edge into itself, invisibly and permanently.
//
// Gated by tools/t60_uvmask.mjs, which keeps the old canvas path in the test as the reference and
// asserts both. Dropping the slack term fails three of its checks, two of them at 0 texels.
//
// ---- one value, or one per triangle (ROADMAP 4.24) ----
// `value` is normally a single number every covered texel gets. It may instead be an array-like of
// one entry PER TRIANGLE, which is how the island decomposition rasterises component ids into the
// array a click is answered from — the same pass over the same triangles, so the ids and the
// stencils can never disagree about where an island is.
//
// A per-triangle **0 means skip this triangle**, not "write 0". That is the id raster's own
// convention (0 is "no island here") and it is what lets one island's stencil be rasterised by
// zeroing every triangle outside it: a rasteriser that wrote 0 where it did not cover would be a
// different function, and would erase whatever the caller had already put in the array.
// ---- tiled UVs (ROADMAP 4.23(a)) ----
// `gun_barrel` on the t55e1 runs u from -0.001 to **6.353** — a rifled barrel textured by repeating
// one strip six times, which is an ordinary thing for a model to do. Every clamp below is against
// the sheet, so five of those six repeats fell outside it and were invisible to every tool: a brush
// stroke on them landed nowhere and a part selection that included them under-covered.
//
// The sheet IS the unit square — that is what the game renders — so a tiled part paints through
// `u mod 1`: every repeat shows the same texels. The item warned that a triangle straddling u = 1
// has to be split rather than folded or it smears across the sheet, and the way out of that is not
// to split it at all. **Each triangle is rasterised once per integer tile it touches, translated by
// a whole sheet**, and the existing bounding-box clamp does the clipping. The union of those rigid
// translations, each clipped, IS the triangle mod 1 — the half that falls off the sheet in one copy
// falls onto it in the next — and a translation cannot smear anything.
//
// The ordinary case is untouched and measurably so: a triangle inside 0..1 spans exactly one tile,
// so the loop runs once and every number below is what it was. `MAX` is a runaway guard, not a
// limit on tiling — 64 repeats is a texture atlas doing something reasonable, 10 000 is a broken
// UV, and rasterising a million copies of one triangle is how a page stops responding.
const UV_TILE_MAX = 64;
// The tile range a UV span crosses, as an inclusive [lo, hi] of whole-sheet indices, shared by the
// rasteriser below and by both projectors (ROADMAP 4.23(a)). In UNIT UV, not texels: the projectors
// work in 0…1 the whole way and only the rasteriser has a sheet size to multiply by.
// The `- eps` keeps a span ending exactly on a boundary — which is every untiled island — in one
// tile, so nothing about the ordinary case changes.
function uvTileRange(lo, hi){
  const a = Math.floor(lo), b = Math.floor(hi - 1e-6);
  return b - a > UV_TILE_MAX ? [a, a + UV_TILE_MAX] : [a, Math.max(a, b)];
}
function rasterUVTriangles(mask, uv, w, h, flipV, value){
  const per = value && typeof value !== "number" && typeof value.length === "number" ? value : null;
  const one = per ? 0 : (value == null ? 255 : value);
  // How many whole sheets this span crosses, as an inclusive [lo, hi] of tile indices. The `- eps`
  // keeps a span ending exactly on a boundary — which is every untiled island — inside one tile.
  const tiles = (lo, hi, size) => uvTileRange(lo / size, hi / size);
  // A zero-area triangle has no inside to test against, so it is the one case the half-plane test
  // below cannot answer. Walk it instead — one texel of total movement per step, so a steep edge
  // cannot skip texels on its short axis.
  const edge = (ax, ay, bx, by, v) => {
    const dx = bx - ax, dy = by - ay;
    const steps = Math.max(1, Math.ceil(Math.abs(dx) + Math.abs(dy)));
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor(ax + dx * i / steps), y = Math.floor(ay + dy * i / steps);
      if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = v;
    }
  };
  const n = uv.length / 6;
  for (let t = 0; t < n; t++) {
    const val = per ? per[t] : one;
    if (per && !val) continue;                      // a per-triangle 0 is "not this one" — see above
    const o = t * 6;
    let v0 = uv[o+1], v1 = uv[o+3], v2 = uv[o+5];
    if (flipV) { v0 = 1 - v0; v1 = 1 - v1; v2 = 1 - v2; }
    const bx0 = uv[o] * w,   by0 = (1 - v0) * h;
    const bx1 = uv[o+2] * w, by1 = (1 - v1) * h;
    const bx2 = uv[o+4] * w, by2 = (1 - v2) * h;
    const [kxA, kxB] = tiles(Math.min(bx0, bx1, bx2), Math.max(bx0, bx1, bx2), w);
    const [kyA, kyB] = tiles(Math.min(by0, by1, by2), Math.max(by0, by1, by2), h);
    for (let ky = kyA; ky <= kyB; ky++) for (let kx = kxA; kx <= kxB; kx++) {
    const ox = kx * w, oy = ky * h;
    const x0 = bx0 - ox, y0 = by0 - oy;
    const x1 = bx1 - ox, y1 = by1 - oy;
    const x2 = bx2 - ox, y2 = by2 - oy;
    const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (d === 0) {                                  // no interior to test — walk what there is
      edge(x0, y0, x1, y1, val); edge(x1, y1, x2, y2, val); edge(x2, y2, x0, y0, val);
      continue;
    }
    // `s` makes "inside" positive whichever way this triangle is wound, so a clockwise one needs no
    // special case. That is the same fact 4.22 had to work around by reversing two vertices — there
    // it mattered because one accumulated path held every triangle at once and their windings had to
    // agree; here each triangle is its own decision and nothing can cancel anything.
    const s = d < 0 ? -1 : 1;
    const ex = [x1 - x0, x2 - x1, x0 - x2], ey = [y1 - y0, y2 - y1, y0 - y2];
    const px0 = [x0, x1, x2], py0 = [y0, y1, y2];
    // One texel OUTSIDE the bounding box, because a texel the triangle merely grazes is covered.
    const yA = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1));
    const yB = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
    const xA = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1));
    const xB = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
    // The half-plane test, evaluated at each texel's CENTRE but slackened by the largest amount the
    // edge function can gain anywhere in that texel's square — 0.5·(|ex| + |ey|). That turns "is the
    // centre inside" into "does the triangle touch this texel at all", which is the set an
    // antialiased fill tinted and `hardenMask` then drove to opaque. It matters in the direction
    // nobody sees: `padSeams` OVERWRITES any texel the mask calls outside with a neighbour's colour,
    // so a stencil one texel tight along a diagonal smears the island's own edge — invisible on
    // screen and permanent in the file, which is the failure this family of bugs keeps taking.
    const slack = [.5 * (Math.abs(ex[0]) + Math.abs(ey[0])),
                   .5 * (Math.abs(ex[1]) + Math.abs(ey[1])),
                   .5 * (Math.abs(ex[2]) + Math.abs(ey[2]))];
    for (let y = yA; y <= yB; y++) {
      const cy = y + .5, row = y * w;
      for (let x = xA; x <= xB; x++) {
        const cx = x + .5;
        let hit = true;
        for (let e = 0; e < 3; e++) {
          if (s * (ex[e] * (cy - py0[e]) - ey[e] * (cx - px0[e])) + slack[e] < 0) { hit = false; break; }
        }
        if (hit) mask[row + x] = val;
      }
    }
    }
  }
}
/*==ENDUVTRI==*/
