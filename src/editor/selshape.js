/*==SELSHAPE==*/
"use strict";
// ---------- Shaped selections: a lasso, a path and a colour range, each as a mask (ROADMAP 4.50 (9)) ----------
// Photoshop skinners isolate the patches of a camouflage with the magic wand and colour range, and
// cut a panel out with the lasso. Before this the app had a rectangle, UV islands, parts and *mask →
// selection* — and the shape tool could fill and stamp a closed path but never become a selection.
//
// **A shaped selection is already a mask** (`Marquee.fromMask`, 4.28(g)): a rectangle bounding a
// stencil at mask resolution, which every verb and the brush already follow. So each new source only
// has to make a MASK, and this is the pure half of making one — numbers in, numbers out, no canvas
// and no App — so `tools/t99_selshape.mjs` can hold it against answers that are arithmetic:
//
//   * `poly` fills exactly the texels whose CENTRE lies inside a polygon, by the nonzero rule. Not
//     even-odd, because `PathUI.fill` is a canvas `fill()` and that is nonzero: a path turned into a
//     selection has to cover what the same path filled would paint, or "select the patch, then Fill"
//     and "Fill the path" would be two different shapes. Centres rather than coverage because a
//     selection is a yes/no — a canvas fill of the same polygon is antialiased, and a half-alpha rim
//     would fade every verb out over its last texel (the wt-canvas facts: rasterise as one path, then
//     harden; here the hardening IS the sampling rule, so nothing partial ever exists).
//   * `range` takes every texel within a tolerance of the seed's colour — the largest difference in
//     any one of R, G, B and A, 0–255, which is GIMP's "composite" criterion and what Photoshop's
//     wand Tolerance means — either anywhere on the sheet (colour range) or only the patch connected
//     to the seed through its four edge neighbours (the wand's Contiguous, GIMP's default of no
//     diagonal neighbours). Four rather than eight so a patch touching another at one corner is not
//     leaked into: two camouflage blotches meeting at a point are two blotches.
//   * `combine` is the Shift-adds / Alt-removes rule, `changes` says whether it would change anything,
//     `bounds` is the box the selection keeps as its rectangle, and `pack` / `unpack` are the bitset
//     an undo step keeps it as.
//
// Every array here is one byte per SELECTION texel, 0 or 1: `bits[y * w + x]`. A selection texel is
// a texel of the sheet on every sheet up to 4096² (`Marquee.dims`), so a shape is exact to the texel
// wherever a skin can be published at 4096² or less.
const SelShape = {
  // A closed polygon — `pts` is [[x, y], …] in raster pixels, the last point joining the first —
  // into `out` (or a new array). Scanline with an active-edge list: a freehand lasso is thousands of
  // points and a flattened path hundreds per curve, and testing every edge on every row of a 2048²
  // raster would be the cost of the polygon times the height.
  //
  // Half-open on both axes, so a texel centre exactly on a shared edge belongs to one side and never
  // to both: an edge is live for scanlines with y0 ≤ y < y1, and a span covers centres x with
  // left < x ≤ right.
  poly(pts, w, h, out){
    const bits = out || new Uint8Array(w * h);
    const n = pts ? pts.length : 0;
    if (n < 3 || !(w > 0) || !(h > 0)) return bits;
    const E = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ax = +a[0], ay = +a[1], bx = +b[0], by = +b[1];
      // A horizontal edge crosses no scanline, and a non-finite point is a gesture that went wrong
      // somewhere upstream — dropping its edges leaves the rest of the outline standing.
      if (ay === by || !isFinite(ax + ay + bx + by)) continue;
      const up = by > ay;
      const y0 = up ? ay : by, y1 = up ? by : ay, x0 = up ? ax : bx;
      E.push({ y0, y1, x0, k: (up ? bx - ax : ax - bx) / (y1 - y0), d: up ? 1 : -1 });
    }
    E.sort((p, q) => p.y0 - q.y0);
    const act = [], xs = [], ds = [];
    let next = 0;
    for (let y = 0; y < h; y++) {
      const yc = y + .5;
      while (next < E.length && E[next].y0 <= yc) act.push(E[next++]);
      let m = 0, c = 0;
      for (let i = 0; i < act.length; i++) {
        const e = act[i];
        if (e.y1 <= yc) continue;                          // finished: dropped from the list
        act[m++] = e;
        // insertion into the row's crossings, kept sorted — a row crosses a handful of edges
        const x = e.x0 + (yc - e.y0) * e.k;
        let j = c++;
        while (j > 0 && xs[j - 1] > x) { xs[j] = xs[j - 1]; ds[j] = ds[j - 1]; j--; }
        xs[j] = x; ds[j] = e.d;
      }
      act.length = m;
      if (!c) { if (next >= E.length && !m) break; continue; }
      const row = y * w;
      let wind = 0, from = 0;
      for (let i = 0; i < c; i++) {
        const was = wind;
        wind += ds[i];
        if (!was && wind) from = xs[i];
        else if (was && !wind) {
          // centres x + .5 in (from, xs[i]]
          const xa = Math.max(0, Math.floor(from - .5) + 1), xb = Math.min(w - 1, Math.floor(xs[i] - .5));
          for (let x = xa; x <= xb; x++) bits[row + x] = 1;
        }
      }
    }
    return bits;
  },

  // Every texel whose colour is within `tol` of the texel at (sx, sy), in an RGBA byte array of
  // w × h. `contiguous` keeps only the patch connected to the seed; otherwise the whole sheet is
  // searched. The three steps below, in one call — the page runs them a band at a time instead
  // (`Marquee.colourSteps`), and this is the whole-array form the oracle checks hold.
  range(rgba, w, h, sx, sy, tol, contiguous, out){
    const bits = out || new Uint8Array(w * h);
    if (!(w > 0) || !(h > 0) || !rgba || rgba.length < w * h * 4) return bits;
    sx = Math.max(0, Math.min(w - 1, Math.floor(sx)));
    sy = Math.max(0, Math.min(h - 1, Math.floor(sy)));
    const t = Math.max(0, Math.min(255, Math.round(+tol || 0)));
    const s = (sy * w + sx) * 4, c = [rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]];
    if (!contiguous) return SelShape.near(rgba, w * h, c, t, bits, 0);
    const m = SelShape.near(rgba, w * h, c, t, new Uint8Array(w * h), 0);
    return SelShape.walk(SelShape.runs(m, w, h), w, h, sx, sy, bits);
  },
  // 1. The match: every texel of `rgba` — `n` of them — whose largest single-channel difference from
  // the colour `c` ([r, g, b, a]) is at most `t`, marked 1 in `out` from index `at`. A band of a sheet
  // at a time. Each channel is one unsigned range test, (v − (c − t)) >>> 0 ≤ 2t, and that is what
  // made this cheap enough to run on every texel of a 4096² sheet: measured 2026-09-26 in Node, a
  // closure testing a texel's four differences both ways took 157 ms over 4096², this 29 ms.
  near(rgba, n, c, t, out, at){
    const lr = c[0] - t, lg = c[1] - t, lb = c[2] - t, la = c[3] - t, span = 2 * t;
    for (let i = 0, o = 0, j = at || 0; i < n; i++, o += 4, j++)
      if (((rgba[o] - lr) >>> 0) <= span && ((rgba[o + 1] - lg) >>> 0) <= span &&
          ((rgba[o + 2] - lb) >>> 0) <= span && ((rgba[o + 3] - la) >>> 0) <= span) out[j] = 1;
    return out;
  },
  // 2. The runs: rows y0 … y1 − 1 of the 0/1 map `m` (w wide) as runs of 1s, [start, end) in `rs` /
  // `re`, row y's being `first[y]` … `first[y + 1] − 1`, left to right — appended to `R`, so a band's
  // rows can be added as the band is read. Typed arrays that double as they fill: a noisy sheet can
  // be a million runs, and a million small JS arrays is what this exists to avoid.
  runs(m, w, h, R, y0 = 0, y1 = h){
    R = R || { rs: new Int32Array(1024), re: new Int32Array(1024), first: new Int32Array(h + 1), n: 0 };
    let rs = R.rs, re = R.re, n = R.n;
    for (let y = y0; y < y1; y++) {
      R.first[y] = n;
      for (let x = 0, o = y * w; x < w;) {
        while (x < w && !m[o]) { x++; o++; }
        if (x >= w) break;
        const st = x;
        while (x < w && m[o]) { x++; o++; }
        if (n === rs.length) {
          const a = new Int32Array(n * 2), b = new Int32Array(n * 2);
          a.set(rs); b.set(re); rs = a; re = b;
        }
        rs[n] = st; re[n] = x; n++;
      }
    }
    R.first[y1] = n;                                       // the next band's first row overwrites it with the same
    R.rs = rs; R.re = re; R.n = n;
    return R;
  },
  // 3. The flood, which walks RUNS, not texels: from the run holding (sx, sy), every run it touches
  // edge to edge — a run touches the runs of the rows either side that overlap it in x. Measured
  // 2026-09-26 at 2048² in Node against a scanline flood that tested texels as it went: that one took
  // 0–1 ms for a small patch but 72–114 ms for a patch that was the whole sheet — 643 ms on a loaded
  // machine — because every texel of a big patch was tested two or three times (as a span and as the
  // rows either side of one). The runs cost one pass over the sheet whatever the patch is. Bounded
  // beats fast-on-average here: a wand click is a click, and §3.5's bar is 200 ms.
  //
  // `info`, when passed, gets what the flood took — `n` texels inside the inclusive box `box` (null
  // for none) — counted run by run, so the caller need not scan 16 million bytes again for them.
  walk(R, w, h, sx, sy, out, info){
    const bits = out || new Uint8Array(w * h), rs = R.rs, re = R.re, first = R.first;
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    if (info) { info.n = 0; info.box = null; }
    let seed = first[sy];
    while (seed < first[sy + 1] && re[seed] <= sx) seed++;       // the run holding the seed texel
    if (seed >= first[sy + 1] || rs[seed] > sx) return bits;     // the seed itself did not match: nothing
    const seen = new Uint8Array(R.n), stack = [seed, sy];
    seen[seed] = 1;
    while (stack.length) {
      const y = stack.pop(), r = stack.pop(), a = rs[r], b = re[r];
      bits.fill(1, y * w + a, y * w + b);
      n += b - a;
      if (a < x0) x0 = a; if (b - 1 > x1) x1 = b - 1; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let ny = y - 1; ny <= y + 1; ny += 2) {
        if (ny < 0 || ny >= h) continue;
        // A row's runs are sorted and disjoint: skip those that end at or before `a` (binary search),
        // then every run that starts before `b` overlaps — four-connected, edge to edge.
        let lo = first[ny], hi = first[ny + 1];
        while (lo < hi) { const m = (lo + hi) >> 1; if (re[m] <= a) lo = m + 1; else hi = m; }
        for (let q = lo; q < first[ny + 1] && rs[q] < b; q++) if (!seen[q]) { seen[q] = 1; stack.push(q, ny); }
      }
    }
    if (info) { info.n = n; info.box = { x0, y0, x1, y1 }; }
    return bits;
  },
  // What every run in `R` covers — colour range's answer, which is all of them — as `walk`'s `info`.
  tally(R, h){
    let n = 0, x0 = Infinity, x1 = -1, y0 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const a = R.first[y], b = R.first[y + 1];
      if (a === b) continue;
      if (y0 < 0) y0 = y;
      y1 = y;
      if (R.rs[a] < x0) x0 = R.rs[a];
      if (R.re[b - 1] - 1 > x1) x1 = R.re[b - 1] - 1;
      for (let q = a; q < b; q++) n += R.re[q] - R.rs[q];
    }
    return { n, box: y0 < 0 ? null : { x0, y0, x1, y1 } };
  },

  // A rectangle of texels, [x0, x1) × [y0, y1), clipped to the raster.
  rect(x0, y0, x1, y1, w, h, out){
    const bits = out || new Uint8Array(w * h);
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    for (let y = y0; y < y1; y++) bits.fill(1, y * w + x0, y * w + Math.max(x0, x1));
    return bits;
  },

  // The Shift / Alt rule, in place on `base`: "add" is the union, "sub" takes `shape` away, and
  // anything else replaces.
  combine(base, shape, op){
    const n = Math.min(base.length, shape.length);
    if (op === "add") { for (let i = 0; i < n; i++) if (shape[i]) base[i] = 1; }
    else if (op === "sub") { for (let i = 0; i < n; i++) if (shape[i]) base[i] = 0; }
    else base.set(shape.subarray(0, n));
    return base;
  },
  // Would `combine` change anything? "add" does where the shape holds a texel `base` lacks, "sub"
  // where it holds one `base` has — so a Shift+lasso round no texel centre, or an Alt+click on a patch
  // that is not selected, is answered "no" and the caller leaves the selection exactly as it was.
  changes(base, shape, op){
    const n = Math.min(base.length, shape.length), hit = op === "sub" ? 1 : 0;
    for (let i = 0; i < n; i++) if (shape[i] && base[i] === hit) return true;
    return false;
  },
  // A selection as one BIT per texel, for the undo step that holds it: 2 MB for a 4096² sheet where the
  // bytes are 16 MB and the RGBA canvas the step used to hold was 64 MB. `unpack` is the way back.
  // Eight bytes to a bit-byte at a time, and whole empty bytes skipped coming back: 16 million texels
  // either way is a click's worth of work otherwise.
  pack(bits){
    const n = bits.length, p = new Uint8Array((n + 7) >> 3), whole = n >> 3;
    for (let j = 0, i = 0; j < whole; j++, i += 8)
      p[j] = bits[i] | bits[i + 1] << 1 | bits[i + 2] << 2 | bits[i + 3] << 3 |
             bits[i + 4] << 4 | bits[i + 5] << 5 | bits[i + 6] << 6 | bits[i + 7] << 7;
    for (let i = whole << 3; i < n; i++) if (bits[i]) p[i >> 3] |= 1 << (i & 7);
    return p;
  },
  unpack(p, n){
    const bits = new Uint8Array(n);
    for (let j = 0, i = 0; j < p.length; j++, i += 8) {
      const v = p[j];
      if (v) for (let k = 0; k < 8 && i + k < n; k++) bits[i + k] = (v >> k) & 1;
    }
    return bits;
  },

  // The texels a selection covers as an inclusive box, or null when it covers none — which is how
  // "Alt took everything away" becomes "nothing is selected" rather than an empty shape in a box.
  bounds(bits, w, h){
    let x0 = w, y0 = -1, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (bits[row + x]) { a = x; break; }
      if (a < 0) continue;
      for (let x = w - 1; x >= a; x--) if (bits[row + x]) { b = x; break; }
      if (y0 < 0) y0 = y;
      y1 = y;
      if (a < x0) x0 = a;
      if (b > x1) x1 = b;
    }
    return y0 < 0 ? null : { x0, y0, x1, y1 };
  },
  count(bits){ let n = 0; for (let i = 0; i < bits.length; i++) n += bits[i]; return n; },
};
/*==ENDSELSHAPE==*/
