/*==GUIDES==*/
"use strict";
// ---------- Guides, rulers and snapping in the 2-D view: the arithmetic (ROADMAP 4.50 (15)) ----------
// Paint Builder ships guides and grids, and so does every 2-D editor a skinner comes from: a stripe
// that has to start on a panel line, a serial box lined up with the one on the other wing, a
// marquee that must end exactly where the camo pattern repeats. The app had a whole-texel marquee
// and no way to line two things up except by typing numbers.
//
// A slot's guides are WHOLE-TEXEL positions in the sheet's own pixels, `v` for vertical lines (an x)
// and `h` for horizontal ones (a y), together with the size of the sheet they were placed on. That
// size is what keeps them on the texture when the slot is resized under them (Textures ▸ Resize, a
// project restoring a painted resolution): positions are scaled from it on the way out, never
// rewritten, so a guide at texel 512 of a 2048² sheet is at 1024 once the sheet is 4096².
//
// This section is the pure half — numbers in, numbers out, no canvas, no DOM and no App — so
// `tools/t98_guides.mjs` holds it under Node against answers that are arithmetic. `edit` is the one
// method that is not: it records an undo step, and it is never called from there.
// `GuidesUI` (ui/panels/guides.js) is the half that draws and takes the pointer.
const Guides = {
  SNAP_PX: 6,        // how near, in CSS pixels on screen, a gesture comes to a guide before it snaps
  GRID_PX: 6,        // the pixel grid is drawn once a texel is this many CSS pixels across (600 %)
  LABEL_PX: 56,      // the least room, in CSS pixels, between two numbers on a ruler
  MINOR_PX: 6,       // …and between two unlabelled ticks

  make(W, H){ return { W, H, v: [], h: [] }; },
  // Where each guide is on the sheet as it is now, W × H.
  lines(g, axis, W, H){
    if (!g || !g[axis]) return [];
    const k = axis === "v" ? W / g.W : H / g.H;
    return g[axis].map(t => t * k);
  },
  // A position on the sheet as it is now, in the units the guides were placed in — the inverse of
  // `lines`, and the identity on a sheet that was never resized.
  toRef(g, axis, t, W, H){ return axis === "v" ? t * g.W / W : t * g.H / H; },

  // ---- snapping ----
  // Of the candidate positions a gesture offers (a point's x; a box's two edges and its centre), the
  // one nearest ANY line, if it is within `tol`: { d, line, i } — how far that candidate has to move
  // to sit on the line. Ties go to the earlier candidate, so the order of `cands` is a priority.
  pick(cands, lines, tol){
    let best = null;
    for (let i = 0; i < cands.length; i++)
      for (const l of lines) {
        const d = l - cands[i];
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l, i };
      }
    return best;
  },
  // Both axes at once. The shift is applied to the WHOLE gesture — a box that snaps by an edge moves
  // by the same amount at its other edge, which is what keeps its size.
  snap(xs, ys, vLines, hLines, tol){
    const px = Guides.pick(xs, vLines, tol), py = Guides.pick(ys, hLines, tol);
    return { dx: px ? px.d : 0, dy: py ? py.d : 0, v: px ? px.line : null, h: py ? py.line : null };
  },
  // Half the size of a w × h box turned `rot` degrees, on each axis — the rectangle a rotated decal
  // occupies, whose edges are what line up with a guide.
  boxOf(w, h, rot){
    const a = (rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return { hw: (c * w + s * h) / 2, hh: (s * w + c * h) / 2 };
  },

  // ---- rulers ----
  // The labelled spacing: the smallest 1-2-5 × 10ⁿ texels that is at least `minPx` screen pixels
  // apart at `sc` screen pixels per texel. The 1-2-5 series is what every ruler uses, because each
  // step is a round number and none is more than 2.5 × the one before.
  step(sc, minPx){
    for (let p = 1; p <= 1e6; p *= 10)
      for (const m of [1, 2, 5]) if (m * p * sc >= minPx) return m * p;
    return 1e7;
  },
  // The unlabelled ticks between two labels: tenths, fifths or halves of a step, whichever is the
  // finest that stays `minPx` apart, and never finer than one texel.
  minor(step, sc, minPx){
    for (const div of [10, 5, 2]) {
      const m = step / div;
      if (m >= 1 && Number.isInteger(m) && m * sc >= minPx) return m;
    }
    return step;
  },
  // Every multiple of `step` in [a, b]. Integers throughout — steps are whole texels — so no tick
  // drifts by accumulated float error across an 8192-texel ruler.
  ticks(a, b, step){
    const out = [];
    for (let n = Math.ceil(a / step); n * step <= b; n++) out.push(n * step);
    return out;
  },

  // ---- the one impure method: a change, as one undo step ----
  // Every change to a slot's guides is one step — the History list shows it and Ctrl+Z takes it back
  // like anything else the user did. Each step holds its own copies of the two arrays. Returns
  // whether anything changed; nothing is recorded for a gesture that put a guide back where it was.
  edit(s, desc, fn, after){
    const g = s.guides || (s.guides = Guides.make(s.composite.width, s.composite.height));
    const was = { v: g.v.slice(), h: g.h.slice() };
    fn(g);
    const now = { v: g.v.slice(), h: g.h.slice() };
    if (was.v.join() === now.v.join() && was.h.join() === now.h.join()) return false;
    const put = st => { g.v = st.v.slice(); g.h = st.h.slice(); if (after) after(); };
    pushAction(desc, () => put(was), () => put(now));
    if (after) after();
    return true;
  },
};
/*==ENDGUIDES==*/
