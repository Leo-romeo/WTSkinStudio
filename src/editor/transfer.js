/*==TRANSFER==*/
"use strict";
// ---------- Carrying the cockpit out: a surface-to-surface transfer bake (ROADMAP 4.45) ----------
// The exterior model of an aircraft carries its own low-detail cockpit — the tub, the seats, the
// canopy frames you see through the glass from outside — painted by its `*_interior` sheet. On 294 of
// the 703 units with such a sheet the first-person cockpit body (4.14) paints only sheets of its own
// (tools/t103_transferf4.mjs --shared, 2026-09-27) — the F-4E among them, `f_4c_interior_c` against
// `f4_c_phantom_2_cockpit_c` — so the two are different meshes at the same place in space with
// unrelated UV layouts, and an edit made in the seat never reaches the exterior's copy. On the other
// 409 the cockpit's desc binds the exterior's sheet too, but how much of it the cockpit renders
// varies from none to all: baked the way the dialog bakes, the median model's cockpit renders 47 % of
// the exterior's texels there, and on only 51 of those 336 models (62 units — the B-17s among them)
// is nothing left to carry. This carries the rest: for every texel of the exterior's sheet the
// cockpit does not render itself, the point of the model it paints, the nearest surface of the
// cockpit body to that point, and the colour the cockpit's own composite has there.
//
// The bar is continuity, not parity (the scoping of 4.14(3)): the exterior's interior is far
// coarser, so "reads as the same cockpit from outside" is the test — the Pilot's seat view on the
// exterior body is where to look.
//
// This section is the pure half: no DOM, no App, no GL, so a worker lifts it (a nearest-surface
// query per texel over half a million triangles is seconds of work, CLAUDE.md §3.1) and
// `tools/t104_transfer.mjs` runs it under Node against shapes whose answer is exact. It needs
// `rasterUVTriangles` and `uvTileRange` (the UVTRI section) and, in the worker, `padSeams`
// (ENCODE). The main-thread half, `Transfer.cockpit`, is below the marker.
const Transfer = {
  // Triangles per BVH leaf. Four keeps the tree shallow (19 levels over 400 k triangles) without
  // making every leaf visit test many triangles the box test could have skipped.
  LEAF: 4,
  // How far the bake looks, in metres. The alpha byte spans it (1.2 mm a step), so any reach up to
  // this one is free after the bake — the dialog's slider costs no second bake.
  REACH: .3,
  // The reach the dialog opens at, from a sweep on the F-4E (tools/t103_transferf4.mjs --sweep,
  // 2026-09-27): the seat view rendered from the first-person cockpit and from the exterior, mean
  // |ΔRGB| over 8×8 blocks — 29.2 with the stock sheet, then 17.8 at 2 cm, 15.6 at 3, **15.3 at 5**,
  // 15.7 at 8, 16.0 at 12, 16.3 at 30. Too short and the exterior's coarser surfaces never meet the
  // cockpit's; too long and a texel with no counterpart nearby takes a far surface's colour.
  DEFAULT_REACH: .05,
  // See-through materials lend no colour of their own — what shows through a canopy or a gauge's
  // glass is the surface behind it. By shader class where the desc says (`dynamic_masked_glass_
  // chrome` on the F-4E's `x_gauge_glass_c` and `empty_glass`, `dynamic_alpha_blend` on its
  // `glass_dirt`, `glass_crack` on the bullet-hole overlays), by name when it does not.
  GLASS: /glass|alpha_blend/,
  // Whether a cockpit part with this shader class lends its paint — `cls` null where the desc has no
  // entry for the material, and then `name` (its sheet and material) is what says glass. One rule,
  // for `Transfer.cockpit.gather` and for tools/t103_transferf4.mjs, so what that measures is this.
  lends(cls, name){ return cls != null ? !Transfer.GLASS.test(cls) : !/glass/i.test(name); },
  // ---- the target: which point of the model each texel of the sheet is ----
  // `uv` and `pos` are the target's triangles as App.geomData holds them, concatenated: 6 and 9
  // floats per triangle, three corners each. Which texels are covered is `rasterUVTriangles`' own
  // answer (the per-triangle value form, 4.24), so a transfer writes exactly the texels the exporter
  // pads from and the island picker answers clicks from — no second rasteriser to disagree with them
  // at an island's rim.
  //
  // WHICH triangle a texel belongs to is then corrected, because that rasteriser hands a texel to the
  // LAST triangle that touches it (conservative, 4.23(b)): a texel whose centre is inside one triangle
  // can come out as its neighbour's. Across an edge inside an island that moves the texel's point by
  // up to ~0.7 of a texel; across a seam where two islands touch in UV it moves it onto the OTHER
  // island — another surface, perhaps metres away, and the wrong colour along the seam. Measured on a
  // flat quad split along its diagonal (t104): 49 of 2 500 interior texels were off their centre's
  // point before this pass, 0 after. So a texel whose centre is outside its triangle takes the
  // triangle of a neighbouring texel that contains the centre, if one does; a rim texel that no
  // triangle contains keeps its own, and `texelPoint` pulls it back onto it. Overlapping triangles (a
  // mirrored shell) both contain the centre, and the last one stays, as the GPU projector's draw
  // order would have it.
  raster(uv, pos, w, h, flipV){
    const nt = (uv.length / 6) | 0;
    const ids = new Int32Array(nt);
    for (let t = 0; t < nt; t++) ids[t] = t + 1;
    const map = new Int32Array(w * h);
    rasterUVTriangles(map, uv, w, h, flipV, ids);
    const T = { w, h, flipV, map, uv, pos, fn: Transfer.faceNormals(pos), last: -1, tri: new Float64Array(8), l1: 0, l2: 0 };
    Transfer.own(T);
    let n = 0;
    for (let i = 0; i < map.length; i++) if (map[i]) n++;
    // The covered texels in sheet order: the order the queries run in, so neighbouring texels follow
    // one another and each one's answer is a tight first guess for the next.
    const order = new Int32Array(n);
    for (let i = 0, k = 0; i < map.length; i++) if (map[i]) order[k++] = i;
    T.order = order;
    return T;
  },
  // The correction above: each covered texel whose centre is outside its triangle, re-owned by the
  // first of its eight neighbours' triangles (as the rasteriser left them) that contains it.
  own(T){
    const map = T.map, w = T.w, h = T.h, was = map.slice(), IN = -1e-9;
    for (let i = 0; i < map.length; i++) {
      const t = was[i] - 1;
      if (t < 0) continue;
      const x = i % w, y = (i - x) / w;
      if (Transfer.solve(T, t, x, y) >= IN) continue;
      search: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const u = was[yy * w + xx] - 1;
        if (u < 0 || u === t) continue;
        if (Transfer.solve(T, u, x, y) >= IN) { map[i] = u + 1; break search; }
      }
    }
    T.last = -1;
  },
  // One unit normal per triangle, from its winding: cross(b − a, c − a), the same product
  // buildGeometryData accumulates into the vertex normals — so it points the way the surface faces
  // (wt-geometry: winding agrees with the normals). Zero for a triangle with no area.
  faceNormals(pos){
    const nt = (pos.length / 9) | 0, fn = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ux = pos[o+3] - pos[o], uy = pos[o+4] - pos[o+1], uz = pos[o+5] - pos[o+2];
      const vx = pos[o+6] - pos[o], vy = pos[o+7] - pos[o+1], vz = pos[o+8] - pos[o+2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l > 0) { nx /= l; ny /= l; nz /= l; }
      fn[t*3] = nx; fn[t*3+1] = ny; fn[t*3+2] = nz;
    }
    return fn;
  },
  // The weights of triangle t's corners 1 and 2 at texel (x, y)'s centre, into T.l1 and T.l2, and
  // how far inside the triangle that centre is — the smallest of the three weights, so ≥ 0 inside.
  // A triangle drawn once per UV tile it crosses (4.23(a)) is solved in the copy the centre is most
  // inside. One with no area in UV has no inside: its centroid, and −∞. The triangle's sheet
  // coordinates are kept between calls, because consecutive texels are nearly always the same one.
  solve(T, t, x, y){
    const w = T.w, h = T.h, c = T.tri;
    if (t !== T.last) {
      const uv = T.uv, o = t * 6;
      let v0 = uv[o+1], v1 = uv[o+3], v2 = uv[o+5];
      if (T.flipV) { v0 = 1 - v0; v1 = 1 - v1; v2 = 1 - v2; }
      c[0] = uv[o] * w; c[1] = (1 - v0) * h; c[2] = uv[o+2] * w; c[3] = (1 - v1) * h; c[4] = uv[o+4] * w; c[5] = (1 - v2) * h;
      c[6] = (c[2] - c[0]) * (c[5] - c[1]) - (c[4] - c[0]) * (c[3] - c[1]);
      const kx = uvTileRange(Math.min(c[0], c[2], c[4]) / w, Math.max(c[0], c[2], c[4]) / w);
      const ky = uvTileRange(Math.min(c[1], c[3], c[5]) / h, Math.max(c[1], c[3], c[5]) / h);
      T.kx0 = kx[0]; T.kx1 = kx[1]; T.ky0 = ky[0]; T.ky1 = ky[1];
      T.last = t;
    }
    const d = c[6];
    T.l1 = T.l2 = 1 / 3;
    if (d === 0) return -Infinity;
    let best = -Infinity;
    for (let ky = T.ky0; ky <= T.ky1; ky++) for (let kx = T.kx0; kx <= T.kx1; kx++) {
      const px = x + .5 + kx * w - c[0], py = y + .5 + ky * h - c[1];
      const m1 = (px * (c[5] - c[1]) - (c[4] - c[0]) * py) / d;
      const m2 = ((c[2] - c[0]) * py - px * (c[3] - c[1])) / d;
      const inside = Math.min(1 - m1 - m2, m1, m2);
      if (inside > best) { best = inside; T.l1 = m1; T.l2 = m2; }
    }
    return best;
  },
  // Where texel i's centre is on the model: its 3-D point in `p`, its triangle as the return value.
  // A rim texel's centre can sit just outside every triangle (the rasteriser covers what a triangle
  // merely grazes), so its weights are pulled back into its triangle — clamped at 0 and renormalised,
  // a point on the part within a texel of where the rim is.
  texelPoint(T, i, p){
    const t = T.map[i] - 1, x = i % T.w, y = (i - x) / T.w;
    Transfer.solve(T, t, x, y);
    let l1 = T.l1, l2 = T.l2, l0 = 1 - l1 - l2;
    if (l0 < 0 || l1 < 0 || l2 < 0) {
      l0 = l0 > 0 ? l0 : 0; l1 = l1 > 0 ? l1 : 0; l2 = l2 > 0 ? l2 : 0;
      const s = l0 + l1 + l2;
      if (s > 0) { l0 /= s; l1 /= s; l2 /= s; } else { l0 = l1 = l2 = 1 / 3; }
    }
    const P = T.pos, q = t * 9;
    p[0] = l0 * P[q]   + l1 * P[q+3] + l2 * P[q+6];
    p[1] = l0 * P[q+1] + l1 * P[q+4] + l2 * P[q+7];
    p[2] = l0 * P[q+2] + l1 * P[q+5] + l2 * P[q+8];
    return t;
  },
  // ---- the source: a bounding-volume hierarchy over its triangles ----
  // Median split on the longest axis of the centroids' box, so the tree is balanced by construction
  // (depth ⌈log2 n⌉ whatever the model) and a fixed stack serves every query. The triangles are
  // copied into leaf order (`tv`, `fn`), with `tid` back to the caller's index — a leaf's corners
  // are then one contiguous run of memory.
  bvh(pos){
    const nt = (pos.length / 9) | 0, LEAF = Transfer.LEAF;
    const cen = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      cen[t*3]   = (pos[o]   + pos[o+3] + pos[o+6]) / 3;
      cen[t*3+1] = (pos[o+1] + pos[o+4] + pos[o+7]) / 3;
      cen[t*3+2] = (pos[o+2] + pos[o+5] + pos[o+8]) / 3;
    }
    const order = new Int32Array(nt);
    for (let t = 0; t < nt; t++) order[t] = t;
    const cap = Math.max(1, 2 * nt);
    const box = new Float32Array(cap * 6), start = new Int32Array(cap), cnt = new Int32Array(cap);
    let nn = 1;
    const work = [0, 0, nt];                            // node, lo, hi — triples
    while (work.length) {
      const hi = work.pop(), lo = work.pop(), node = work.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let k = lo; k < hi; k++) {
        const t = order[k], o = t * 9;
        for (let j = 0; j < 9; j += 3) {
          const a = pos[o+j], b = pos[o+j+1], c = pos[o+j+2];
          if (a < x0) x0 = a; if (a > x1) x1 = a;
          if (b < y0) y0 = b; if (b > y1) y1 = b;
          if (c < z0) z0 = c; if (c > z1) z1 = c;
        }
        const a = cen[t*3], b = cen[t*3+1], c = cen[t*3+2];
        if (a < cx0) cx0 = a; if (a > cx1) cx1 = a;
        if (b < cy0) cy0 = b; if (b > cy1) cy1 = b;
        if (c < cz0) cz0 = c; if (c > cz1) cz1 = c;
      }
      const b6 = node * 6;
      box[b6] = x0; box[b6+1] = y0; box[b6+2] = z0; box[b6+3] = x1; box[b6+4] = y1; box[b6+5] = z1;
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      // a leaf when small — or when every centroid is the same point, which no split can separate
      if (hi - lo <= LEAF || !(ex > 0 || ey > 0 || ez > 0)) { start[node] = lo; cnt[node] = hi - lo; continue; }
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (lo + hi) >> 1;
      Transfer.select(order, cen, axis, lo, hi - 1, mid);
      const l = nn; nn += 2;
      start[node] = l; cnt[node] = 0;
      work.push(l, lo, mid, l + 1, mid, hi);
    }
    const tv = new Float32Array(nt * 9), fn0 = Transfer.faceNormals(pos), fn = new Float32Array(nt * 3);
    for (let k = 0; k < nt; k++) {
      const t = order[k];
      for (let j = 0; j < 9; j++) tv[k*9+j] = pos[t*9+j];
      fn[k*3] = fn0[t*3]; fn[k*3+1] = fn0[t*3+1]; fn[k*3+2] = fn0[t*3+2];
    }
    return { nt, nn, box: box.slice(0, nn * 6), start: start.slice(0, nn), cnt: cnt.slice(0, nn), tv, fn, tid: order,
             stack: new Int32Array(256), sd: new Float64Array(256) };
  },
  // Put the k-th smallest centroid (on `axis`) of order[lo..hi] at k, smaller ones before it and
  // larger after — Hoare's selection, so a split costs a linear pass and not a sort.
  select(order, cen, axis, lo, hi, k){
    while (hi > lo) {
      const pv = cen[order[(lo + hi) >> 1] * 3 + axis];
      let i = lo, j = hi;
      while (i <= j) {
        while (cen[order[i] * 3 + axis] < pv) i++;
        while (cen[order[j] * 3 + axis] > pv) j--;
        if (i <= j) { const s = order[i]; order[i] = order[j]; order[j] = s; i++; j--; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else return;
    }
  },
  // Squared distance from p to node n's box (0 inside it).
  boxD2(box, n, px, py, pz){
    const o = n * 6;
    const dx = px < box[o] ? box[o] - px : px > box[o+3] ? px - box[o+3] : 0;
    const dy = py < box[o+1] ? box[o+1] - py : py > box[o+4] ? py - box[o+4] : 0;
    const dz = pz < box[o+2] ? box[o+2] - pz : pz > box[o+5] ? pz - box[o+5] : 0;
    return dx * dx + dy * dy + dz * dz;
  },
  // The squared distance from p to triangle t (leaf order), with the weights of its corners 1 and 2
  // at the closest point in out[1], out[2]. Ericson, Real-Time Collision Detection §5.1.5: the three
  // corner regions, the three edge regions, then the face. A triangle with no area never reaches the
  // face case with a usable denominator, so that case falls back to its first corner.
  closest(tv, t, px, py, pz, out){
    const o = t * 9;
    const ax = tv[o], ay = tv[o+1], az = tv[o+2];
    const abx = tv[o+3] - ax, aby = tv[o+4] - ay, abz = tv[o+5] - az;
    const acx = tv[o+6] - ax, acy = tv[o+7] - ay, acz = tv[o+8] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let v = 0, w = 0;
    if (d1 > 0 || d2 > 0) {
      const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) v = 1;
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3);
        else {
          const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) w = 1;
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6);
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
              else { const s = va + vb + vc; if (s > 0) { v = vb / s; w = vc / s; } }
            }
          }
        }
      }
    }
    const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py, qz = az + abz * v + acz * w - pz;
    out[1] = v; out[2] = w;
    return qx * qx + qy * qy + qz * qz;
  },
  // The nearest point of any source triangle to p — among those whose face turns less than 90° from
  // n when `facing` is set — closer than √best2. `hint` (leaf order) is tried first: it is the
  // previous texel's answer, and its distance as the starting bound prunes most of the tree at the
  // root. Writes [d², v, w] into out and returns the triangle (leaf order), or −1.
  nearest(B, px, py, pz, nx, ny, nz, best2, facing, hint, out){
    const tv = B.tv, fn = B.fn, box = B.box, start = B.start, cnt = B.cnt, stack = B.stack, sd = B.sd;
    let bestT = -1, bv = 0, bw = 0;
    if (hint >= 0 && (facing === false || fn[hint*3] * nx + fn[hint*3+1] * ny + fn[hint*3+2] * nz > facing)) {
      const d2 = Transfer.closest(tv, hint, px, py, pz, out);
      if (d2 < best2) { best2 = d2; bestT = hint; bv = out[1]; bw = out[2]; }
    }
    let sp = 0;
    stack[0] = 0; sd[0] = Transfer.boxD2(box, 0, px, py, pz); sp = 1;
    while (sp) {
      sp--;
      if (sd[sp] >= best2) continue;
      const node = stack[sp], c = cnt[node];
      if (c) {
        for (let t = start[node], e = t + c; t < e; t++) {
          if (facing !== false && fn[t*3] * nx + fn[t*3+1] * ny + fn[t*3+2] * nz <= facing) continue;
          const d2 = Transfer.closest(tv, t, px, py, pz, out);
          if (d2 < best2) { best2 = d2; bestT = t; bv = out[1]; bw = out[2]; }
        }
        continue;
      }
      const a = start[node], b = a + 1;
      const da = Transfer.boxD2(box, a, px, py, pz), db = Transfer.boxD2(box, b, px, py, pz);
      // the far child goes on the stack first, so the near one is searched first and shrinks the bound
      if (da <= db) {
        if (db < best2) { stack[sp] = b; sd[sp++] = db; }
        if (da < best2) { stack[sp] = a; sd[sp++] = da; }
      } else {
        if (da < best2) { stack[sp] = a; sd[sp++] = da; }
        if (db < best2) { stack[sp] = b; sd[sp++] = db; }
      }
    }
    out[0] = best2; out[1] = bv; out[2] = bw;
    return bestT;
  },
  // ---- the bake ----
  // Everything a query needs, built once: the target's texel map, the source's tree, and the lookup
  // the queries fill — per texel, the source triangle (the caller's index, −1 for none), the weights
  // of its corners 1 and 2 at the nearest point, and the distance. `cov` is the target's coverage
  // as padSeams reads it (1 = an island's texel).
  //
  // `keepUV` (optional) is the COCKPIT body's own triangles on this sheet, and `keep` the texels they
  // cover: those texels are what the first-person cockpit renders, so they are never queried and
  // never written — an exterior texel inside them keeps what is painted there, which already shows
  // from both bodies. The review of 4.45 (2026-09-27) measured what happened without it, on units
  // whose cockpit body paints the exterior's `*_interior` sheet too: the layer repainted 29 168 of
  // the AH-64A's 386 716 cockpit texels on `ah_64a_interior_c` with other surfaces' colours at 1024²,
  // 18 680 of the Scimitar's, and all 116 of the texels it painted on the C-47's — and on the F-4E's
  // airframe sheet, which every cockpit body carries a copy of, 807. No `keepUV` — a sheet the
  // cockpit body does not use, the F-4E's `f_4c_interior_c` — is every texel asked about.
  prepare(a){
    const T = Transfer.raster(a.tgtUV, a.tgtPos, a.w, a.h, a.flipV);
    T.foot = Transfer.texelSize(a.tgtPos, a.tgtUV, a.w, a.h);
    const n = a.w * a.h, cov = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (T.map[i]) cov[i] = 1;
    let keep = null;
    if (a.keepUV && a.keepUV.length) {
      keep = new Uint8Array(n);
      rasterUVTriangles(keep, a.keepUV, a.w, a.h, a.flipV, 1);
      T.order = T.order.filter(i => !keep[i]);
    }
    // No texel left to ask about (the cockpit renders the whole of the exterior's layout — the C-47's
    // interior sheet): no tree either, so "nothing to carry" costs no index of half a million triangles.
    const B = Transfer.bvh(T.order.length ? a.srcPos : new Float32Array(0));
    const look = { tri: new Int32Array(n).fill(-1), bv: new Float32Array(n), bw: new Float32Array(n), dist: new Float32Array(n),
                   foot: new Float32Array(n), cov, keep };
    return { T, B, look, reach: a.reach, facing: a.facing === false ? false : +(a.facing === true || a.facing == null ? 0 : a.facing), hint: -1, out: new Float64Array(3), p: new Float64Array(3) };
  },
  // The gutters, padded the way the exporter pads the sheet (`padSeams`, ENCODE) — but over the
  // sheet's WHOLE coverage: the exterior's islands pad their carried colour outward, and the cockpit's
  // own islands (`keep`) are islands too, of nothing (alpha 0, never answered). So each gutter texel
  // takes its nearer island's value, and the gutter beside a texel the cockpit renders keeps the
  // stock paint its own padding gave it, which is what the first-person view's filtering reads at
  // that island's rim. Padded from the exterior's coverage alone, the carried colour ran 16 texels
  // into — and across — the cockpit's islands.
  pad(look, rgba, w, h, dist){
    let m = look.cov;
    if (look.keep) { m = m.slice(); for (let i = 0; i < m.length; i++) if (look.keep[i]) m[i] = 1; }
    padSeams(rgba, w, h, m, dist);
  },
  // How much of the model one texel of the sheet covers, per triangle, in metres: √(world area /
  // area in texels). The sampling below reads the source at the level of detail that matches it.
  texelSize(pos, uv, w, h){
    const nt = (pos.length / 9) | 0, out = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const aw = Transfer.area3(pos, t * 9), at = Transfer.area2(uv, t * 6) * w * h;
      out[t] = at > 0 ? Math.sqrt(aw / at) : 0;
    }
    return out;
  },
  // UV units per metre on each source triangle, √(UV area / world area): times the sheet's size, how
  // many of its texels a metre of that surface spans.
  uvPerMetre(pos, uv){
    const nt = (pos.length / 9) | 0, out = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const aw = Transfer.area3(pos, t * 9);
      out[t] = aw > 0 ? Math.sqrt(Transfer.area2(uv, t * 6) / aw) : 0;
    }
    return out;
  },
  area3(p, o){
    const ux = p[o+3] - p[o], uy = p[o+4] - p[o+1], uz = p[o+5] - p[o+2];
    const vx = p[o+6] - p[o], vy = p[o+7] - p[o+1], vz = p[o+8] - p[o+2];
    return .5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  },
  area2(uv, o){ return .5 * Math.abs((uv[o+2] - uv[o]) * (uv[o+5] - uv[o+1]) - (uv[o+4] - uv[o]) * (uv[o+3] - uv[o+1])); },
  // Covered texels `from` … `to` (indices into T.order), each answered by the nearest source point
  // within reach whose face turns less than 90° from the texel's own. A texel with nothing facing it
  // inside the reach falls back to the nearest point of any facing: a thin part modelled as one sheet
  // of triangles faces one way only, and the texel on its other side still wants the colour that is
  // there rather than none.
  //
  // Nearest, and "facing" at 90°, are what the F-4E measured best (tools/t103_transferf4.mjs --sweep,
  // 2026-09-27: the seat view at 1024², mean |ΔRGB| against the first-person cockpit's own render,
  // 8×8 blocks in brackets — the stock sheet scores 35.4 (29.2)). At 90° and 5 cm, **22.0 (15.3)**. At
  // 60° or 32° the best reach is 8 cm, 22.1 (15.7) and 22.0 (15.7), and at 2 cm both fall to 32.6
  // (26.6): a stricter rule leaves more texels with nothing near enough. A ray cast along the texel's
  // normal both ways, the nearest point only where it missed, scored 26.0 (19.7) at 90° and 26.8
  // (20.8) at 60° against the nearest point's 22.4 (15.8) in the same run (before the ownership pass
  // in `raster`), and took 5.6 s of queries to 2.3 — so it was taken out (ROADMAP 4.45).
  query(S, from, to){
    const T = S.T, B = S.B, L = S.look, out = S.out, p = S.p, r2 = S.reach * S.reach, order = T.order, fn = T.fn;
    let hint = S.hint;
    for (let k = from; k < to; k++) {
      const i = order[k];
      const t = Transfer.texelPoint(T, i, p);
      const nx = fn[t*3], ny = fn[t*3+1], nz = fn[t*3+2];
      let best = Transfer.nearest(B, p[0], p[1], p[2], nx, ny, nz, r2, S.facing, hint, out);
      if (best < 0 && S.facing !== false) best = Transfer.nearest(B, p[0], p[1], p[2], nx, ny, nz, r2, false, hint, out);
      if (best < 0) continue;
      L.tri[i] = B.tid[best]; L.bv[i] = out[1]; L.bw[i] = out[2]; L.dist[i] = Math.sqrt(out[0]); L.foot[i] = T.foot[t];
      hint = best;
    }
    S.hint = hint;
  },
  // The whole query in one call — for a caller with no progress bar to feed (the tests, a tool).
  run(a){
    const S = Transfer.prepare(a);
    Transfer.query(S, 0, S.T.order.length);
    return S;
  },
  // Each texel's colour, read off the sheet its nearest point is on. `src` is the source's triangles:
  // `uv` (6 per triangle), `sheet` (which of `sheets`) and `scale` (uvPerMetre). `sheets[k]` is a
  // mip chain (`mips`), or null for a sheet passed through — the target itself (what is painted there
  // already shows) or one with no pixels.
  //
  // Read at the texel's FOOTPRINT, not at a point. One texel of the exterior's coarse sheet covers
  // many of the cockpit's — on the F-4E's canopy arch, dozens — and a point sample of each lands on a
  // rivet in one texel and the panel beside it in the next: the carried arch came out as blotches of
  // light and dark that are in neither mesh's paint. So each texel reads the level of the source's mip
  // chain whose texels are its own size (trilinear between the two nearest), and the arch comes out
  // the arch's average colour, as the game's own low-detail paint has it. Bilinear and wrapped within
  // a level: a tiled part's UVs run past 1, and the sheet IS the unit square.
  //
  // The alpha byte carries the distance — 0 is "nothing here", 1…255 closeness, 255 at 0 and 1 at
  // `reach` — so the layer's alpha is a function of the byte alone (`alpha`) and a reach chosen after
  // the bake costs nothing. padSeams then carries the byte into the gutters with the colour, which
  // keeps a padded texel's distance its rim's.
  sample(look, src, sheets, w, h, flipV, reach){
    const n = w * h, out = new Uint8ClampedArray(n * 4), acc = new Float64Array(3);
    const srcUV = src.uv, srcSheet = src.sheet, scale = src.scale;
    for (let i = 0; i < n; i++) {
      const t = look.tri[i];
      if (t < 0) continue;
      const lv = sheets[srcSheet[t]];
      if (!lv) continue;
      const b1 = look.bv[i], b2 = look.bw[i], b0 = 1 - b1 - b2, o = t * 6;
      const u = b0 * srcUV[o] + b1 * srcUV[o+2] + b2 * srcUV[o+4];
      let v = b0 * srcUV[o+1] + b1 * srcUV[o+3] + b2 * srcUV[o+5];
      if (flipV) v = 1 - v;
      // how many of the source's texels one of ours spans, and the level where that is one
      const f = look.foot[i] * scale[t] * Math.sqrt(lv[0].w * lv[0].h);
      const lod = f > 1 ? Math.min(lv.length - 1, Math.log2(f)) : 0;
      const l0 = Math.floor(lod), fr = lod - l0;
      acc[0] = acc[1] = acc[2] = 0;
      Transfer.tap(lv[l0], u, v, 1 - fr, acc);
      if (fr > 0) Transfer.tap(lv[Math.min(lv.length - 1, l0 + 1)], u, v, fr, acc);
      out[i*4] = acc[0] + .5; out[i*4+1] = acc[1] + .5; out[i*4+2] = acc[2] + .5;
      out[i*4+3] = 1 + Math.round(254 * Math.max(0, 1 - look.dist[i] / reach));
    }
    return out;
  },
  // One level, bilinear and wrapped: adds k × its colour at (u, v) into acc. v is the sheet's own —
  // flipped already where the model's UVs say so — and rows run top-down, as everywhere in the app.
  tap(L, u, v, k, acc){
    const SW = L.w, SH = L.h, px = L.rgba;
    const sx = u * SW - .5, sy = (1 - v) * SH - .5;
    const fx = Math.floor(sx), fy = Math.floor(sy), ax = sx - fx, ay = sy - fy;
    const x0 = ((fx % SW) + SW) % SW, y0 = ((fy % SH) + SH) % SH;
    const x1 = x0 + 1 < SW ? x0 + 1 : 0, y1 = y0 + 1 < SH ? y0 + 1 : 0;
    const p00 = (y0 * SW + x0) * 4, p10 = (y0 * SW + x1) * 4, p01 = (y1 * SW + x0) * 4, p11 = (y1 * SW + x1) * 4;
    const w00 = (1 - ax) * (1 - ay) * k, w10 = ax * (1 - ay) * k, w01 = (1 - ax) * ay * k, w11 = ax * ay * k;
    for (let c = 0; c < 3; c++) acc[c] += px[p00+c] * w00 + px[p10+c] * w10 + px[p01+c] * w01 + px[p11+c] * w11;
  },
  // A sheet's mip chain, each level the 2×2 mean of the one above, down to a single texel.
  mips(img){
    const out = [img];
    for (let cur = img; cur.w > 1 || cur.h > 1;) {
      const w = Math.max(1, cur.w >> 1), h = Math.max(1, cur.h >> 1), s = cur.rgba, px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const r0 = Math.min(cur.h - 1, y * 2) * cur.w, r1 = Math.min(cur.h - 1, y * 2 + 1) * cur.w;
        for (let x = 0; x < w; x++) {
          const c0 = Math.min(cur.w - 1, x * 2), c1 = Math.min(cur.w - 1, x * 2 + 1), o = (y * w + x) * 4;
          const a = (r0 + c0) * 4, b = (r0 + c1) * 4, c = (r1 + c0) * 4, d = (r1 + c1) * 4;
          for (let k = 0; k < 4; k++) px[o+k] = (s[a+k] + s[b+k] + s[c+k] + s[d+k] + 2) >> 2;
        }
      }
      out.push(cur = { rgba: px, w, h });
    }
    return out;
  },
  // The layer's alpha for closeness byte `a` at a reach of `r` (the bake's own was `reach`): full to
  // 70 % of r, then a ramp to nothing at r — where the two meshes drift apart the carried paint
  // fades out rather than stopping at a line.
  alpha(a, reach, r){
    if (!a) return 0;
    const d = reach * (1 - (a - 1) / 254);
    const f = (r - d) / (.3 * r);
    return f >= 1 ? 255 : f <= 0 ? 0 : Math.round(255 * f);
  },
  // What the bake found, for the dialog to say and the tools to measure: how many of the target's
  // texels were answered, by which sheet, and how far away — `dist` as percentiles of the answered.
  // With the sampled pixels, `hist` counts the island texels at each closeness byte, so the dialog
  // can say what share of the sheet a reach shows without the coverage crossing back (the padded
  // gutters carry bytes too, and are not the sheet). `kept` counts the island texels the cockpit
  // renders itself (`look.keep`), which are never asked about and so are not among the answered.
  stats(look, srcSheet, nSheets, rgba){
    const bySheet = new Array(nSheets).fill(0), hist = new Array(256).fill(0);
    let covered = 0, answered = 0, kept = 0;
    const d = [];
    for (let i = 0; i < look.tri.length; i++) {
      if (!look.cov[i]) continue;
      covered++;
      if (rgba) hist[rgba[i*4+3]]++;
      if (look.keep && look.keep[i]) kept++;
      const t = look.tri[i];
      if (t < 0) continue;
      answered++;
      bySheet[srcSheet[t]]++;
      if ((i & 15) === 0) d.push(look.dist[i]);          // every 16th: a percentile needs no more
    }
    d.sort((a, b) => a - b);
    const q = f => d.length ? d[Math.min(d.length - 1, Math.floor(f * d.length))] : 0;
    return { covered, answered, kept, bySheet, hist, p50: q(.5), p90: q(.9), p99: q(.99) };
  },
};
/*==ENDTRANSFER==*/
// ---------- The main-thread half: the two bodies, the worker, the layer ----------
// Hung off `Transfer` rather than bound on its own, so the module is one name in the shared scope
// (§2) — and below the marker, so the worker lifts the pure half and never sees this one.
Transfer.cockpit = {
  // The largest side a transfer is baked at. The F-4E's interior sheet is 1024²: 696 461 covered
  // texels, 0.75–1.4 s to index the 584 543 cockpit triangles that lend paint and 2.3–3.0 s of queries
  // on one thread (Node, 2026-09-27, beside other suites). A 2048² sheet is four times the queries;
  // anything larger gains nothing a low-detail cockpit can show from outside.
  SIDE: 2048,
  // Texels per worker call: each call is a progress step and a place to stop (§3.5), ~0.1 s apiece.
  CHUNK: 32768,
  // The largest side a source sheet is handed to the worker at. Its mip chain is read at the
  // exterior texel's footprint, so detail finer than the target can hold never reaches it anyway.
  SOURCE_SIDE: 2048,
  pool: null,
  key: 0,
  workers(){
    if (this.pool) return this.pool;
    // A size-1 pool: the state (the texel map, the tree, the lookup) lives in the worker between the
    // calls of one bake, so every call must reach the same one. A bake that is cancelled terminates
    // it (`pool.cancel`), which is also what gives its memory back.
    // `held` rides on the first line with `TR`: the worker's names are the worker's, and a declaration
    // at the start of a line in here would read as one more name in the page's scope (t51 counts them).
    return this.pool = makeWorkerPool({ name: "transfer", size: 1, sections: ["UVTRI", "ENCODE", "TRANSFER"], ops: `var TR = null, held = function(key){
  if (!TR || TR.key !== key) throw new Error("the transfer's index was lost — bake again");
  return TR;
};
var WT_OPS = {
  build: function(a){
    TR = Transfer.prepare({ tgtPos: new Float32Array(a.tgtPos), tgtUV: new Float32Array(a.tgtUV), srcPos: new Float32Array(a.srcPos),
                            keepUV: new Float32Array(a.keepUV), w: a.w, h: a.h, flipV: a.flipV, reach: a.reach, facing: 0 });
    TR.key = a.key; TR.srcUV = new Float32Array(a.srcUV); TR.srcSheet = new Int16Array(a.srcSheet); TR.nSheets = a.nSheets;
    TR.scale = Transfer.uvPerMetre(new Float32Array(a.srcPos), TR.srcUV);
    return { texels: TR.T.order.length };
  },
  query: function(a){ Transfer.query(held(a.key), a.from, a.to); return a.to; },
  hits: function(a){
    var S = held(a.key), out = new Uint8Array(S.nSheets), tri = S.look.tri;
    for (var i = 0; i < tri.length; i++) if (tri[i] >= 0) out[S.srcSheet[tri[i]]] = 1;
    return out;
  },
  sample: function(a){
    var S = held(a.key);
    var sheets = a.sheets.map(function(bm){
      if (!bm) return null;
      var c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext("2d");
      g.drawImage(bm, 0, 0);
      bm.close();
      return Transfer.mips({ rgba: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
    });
    var rgba = Transfer.sample(S.look, { uv: S.srcUV, sheet: S.srcSheet, scale: S.scale }, sheets, S.T.w, S.T.h, S.T.flipV, S.reach);
    Transfer.pad(S.look, rgba, S.T.w, S.T.h, a.pad);
    var stats = Transfer.stats(S.look, S.srcSheet, S.nSheets, rgba);
    TR = null;
    return { __t: 1, result: { rgba: rgba.buffer, stats: stats }, transfer: [rgba.buffer] };
  }
};` });
  },
  // What a transfer onto `slot` would read and write, or `why` it cannot run. The target is every
  // part of the EXTERIOR body on this sheet, hidden or not (a bake is a property of the model, the
  // way the mask bakes are); the source is every part of the COCKPIT body that is painted — not
  // glass, not an effect, not unposed cloth, not hidden (hiding a part on the cockpit body is how to
  // keep it out, the way hiding a gear door keeps it out of the occlusion bake). The cockpit's
  // triangles on THIS sheet do two things. They stay in as sources but lend nothing: an exterior
  // texel whose nearest cockpit surface this very sheet paints is left as it is. And `keep` — every
  // part of the cockpit body on this sheet, whatever it is, since hidden, glass and cloth draw their
  // texels in the first-person view all the same — marks the texels the first-person cockpit
  // renders, which the layer never touches (`Transfer.prepare`, `Transfer.pad`).
  gather(slot){
    const ext = Cockpit.fields("exterior"), ck = Cockpit.fields("cockpit");
    const who = App.vehicleKey || App.objName || "This vehicle";
    if (!ext || !ext.geomData) return { why: "Load a vehicle first — the cockpit is carried from one body of it to the other" };
    if (!Cockpit.has()) return { why: who + " has no cockpit model, so there is nothing to carry onto this sheet" };
    if (!ck || !ck.geomData) return { why: "Open the cockpit body once first (Exterior / Cockpit in the 3-D view's bar) — what is painted there is what this carries out" };
    const tgt = ext.geomData.filter(gd => !gd.weapon && gd.position && gd.uv && App.matSlot.get(gd.mat) === slot.id);
    if (!tgt.length) return { why: "No part of the exterior uses “" + slot.id + "” — the cockpit is carried onto the exterior's own sheets, such as its *_interior" };
    const bind = Cockpit.bind(), hidden = ck.hiddenParts || new Set();
    const sheets = [], at = new Map(), src = [];
    for (const gd of ck.geomData) {
      if (gd.weapon || gd.skinned || !gd.position || !gd.uv || hidden.has(gd.name) || isEffectMat(gd.name, gd.mat)) continue;
      const s = App.slots.get(App.matSlot.get(gd.mat));
      if (!s) continue;                                 // no paintable sheet at all: chrome, mirrors, glass
      const d = bind && bind.map.get(String(gd.mat).toLowerCase());
      if (!Transfer.lends(d ? d.cls || "" : null, s.id + " " + gd.mat)) continue;
      if (!at.has(s.id)) { at.set(s.id, sheets.length); sheets.push(s); }
      src.push({ gd, k: at.get(s.id) });
    }
    if (!src.length) return { why: "The cockpit body has no painted surface to carry from — show it once so its sheets load, or unhide its parts" };
    const keep = ck.geomData.filter(gd => !gd.weapon && gd.uv && App.matSlot.get(gd.mat) === slot.id);
    return { tgt, src, sheets, keep };
  },
  // Which bake owns the worker, by key (0: none). The worker holds ONE bake's index between calls, so
  // a bake owns it from its first call to its last. A newer bake takes it over by taking the key: the
  // older one sees that within a step's poll and ends as a cancel, its job left to finish unread and
  // queued ahead of the newer bake's (the worker runs one at a time); and only the owner may cancel
  // the pool or take the progress bar down. `stop` ends a bake at once, worker and all — the dialog
  // stops its bake when it is closed. Measured by the review of 4.45 (2026-09-27): with neither, a dialog closed mid-bake
  // and opened again started a second bake over the first; the first's next query found its index
  // replaced, its clean-up cancelled the pool under the second, and the reopened dialog said "Could
  // not bake: cancelled" with two failures reported.
  live: 0,
  stop(key){
    if (!key || this.live !== key) return;
    this.live = 0;
    if (this.pool) this.pool.cancel();   // the worker and its index go; the pool respawns on the next call
  },
  // The bake, under the progress bar: `{ w, h, rgba, stats, sheets, pass, own }` — `rgba` with the
  // closeness byte in its alpha (Transfer.sample), `pass[k]` true for a sheet that lent nothing
  // (this one, or one with no pixels), `own` this sheet's place among the sources or −1. `g` is
  // `gather`'s answer when the caller already has it (the dialog asks first, to say a `why` as a
  // state rather than report it as a failure). `job`, when given, is handed `stop()` for this bake.
  // A bake stopped, taken over or cancelled from the progress bar rejects with `Cancelled`.
  async bake(slot, g, job){
    g = g || this.gather(slot);
    if (g.why) throw new Error(g.why);
    const k = Math.min(1, this.SIDE / Math.max(slot.composite.width, slot.composite.height));
    const w = Math.max(1, Math.round(slot.composite.width * k)), h = Math.max(1, Math.round(slot.composite.height * k));
    const src = g.src.map(x => x.gd), nTri = src.reduce((n, gd) => n + gd.position.length / 9, 0);
    const srcSheet = new Int16Array(nTri);
    for (let t = 0, j = 0; j < g.src.length; j++) { const n = g.src[j].gd.position.length / 9; srcSheet.fill(g.src[j].k, t, t + n); t += n; }
    const bufs = { tgtPos: this.pack(g.tgt, "position").buffer, tgtUV: this.pack(g.tgt, "uv").buffer, keepUV: this.pack(g.keep || [], "uv").buffer,
                   srcPos: this.pack(src, "position").buffer, srcUV: this.pack(src, "uv").buffer, srcSheet: srcSheet.buffer };
    const key = ++this.key, P = this.workers();
    this.live = key;
    if (job) job.stop = () => this.stop(key);
    progBegin("Carrying the cockpit out", true);
    const gen = Prog.gen;
    const alive = () => { if (this.live !== key || Prog.cancelled) throw new Cancelled(); };
    // One call to the worker, raced against Cancel and against a newer bake, so a bake ends at once
    // rather than when its step does — and a Cancel then stops the worker where it is (the catch).
    // The last step (reading back and mip-mapping every lending sheet, sampling, padding) is where the
    // bar sits longest: 0.47 + 0.04 + 0.04 s at 2048² plus ~30 ms a sheet (review of 4.45,
    // 2026-09-27), and a Cancel pressed in it used to be ignored and the result used.
    const step = (op, args, xfer) => new Promise((resolve, reject) => {
      const poll = setInterval(() => { try { alive(); } catch (e) { clearInterval(poll); reject(e); } }, 50);
      P.call(op, args, xfer).then(r => { clearInterval(poll); resolve(r); }, e => { clearInterval(poll); reject(e); });
    });
    try {
      progress("Indexing the cockpit's " + nTri.toLocaleString() + " triangles…", -1);
      const b = await step("build", Object.assign({ key, w, h, flipV: $("optFlipV").checked, reach: Transfer.REACH, nSheets: g.sheets.length }, bufs),
                           Object.values(bufs));
      for (let from = 0; from < b.texels; from += this.CHUNK) {
        alive();
        progress("Finding the cockpit behind " + b.texels.toLocaleString() + " texels…", .05 + .85 * from / b.texels);
        await step("query", { key, from, to: Math.min(b.texels, from + this.CHUNK) });
      }
      alive();
      progress("Reading the cockpit's paint…", .92);
      const hit = await step("hits", { key });
      const lend = g.sheets.map((s, j) => !!hit[j] && s !== slot && !!s.composite && !s.missing);
      const bitmaps = await Promise.all(g.sheets.map((s, j) => lend[j] ? this.bitmap(s.composite) : null));
      try { alive(); } catch (e) { for (const bm of bitmaps) if (bm) bm.close(); throw e; }
      const r = await step("sample", { key, sheets: bitmaps, pad: Bake.PAD }, bitmaps.filter(Boolean));
      alive();
      return { w, h, rgba: new Uint8ClampedArray(r.rgba), stats: r.stats, sheets: g.sheets.map(s => s.id),
               pass: lend.map(x => !x), own: g.sheets.indexOf(slot) };
    } catch (err) {
      const mine = this.live === key;
      if (mine) { this.live = 0; P.cancel(); }   // whatever the worker still holds goes with it; the pool respawns
      throw mine ? err : new Cancelled();         // stopped or taken over: a cancel, whatever the pool rejected with
    } finally {
      if (this.live === key) this.live = 0;
      if (Prog.gen === gen) progEnd();           // a newer bake's bar is its own
    }
  },
  // A list of part groups' `f` arrays as one, for the worker.
  pack(list, f){
    let n = 0;
    for (const gd of list) n += gd[f].length;
    const out = new Float32Array(n);
    let o = 0;
    for (const gd of list) { out.set(gd[f], o); o += gd[f].length; }
    return out;
  },
  bitmap(c){
    const k = Math.min(1, this.SOURCE_SIDE / Math.max(c.width, c.height));
    return k < 1 ? createImageBitmap(c, { resizeWidth: Math.max(1, Math.round(c.width * k)), resizeHeight: Math.max(1, Math.round(c.height * k)), resizeQuality: "high" })
                 : createImageBitmap(c);
  },
  // The layer's alpha for each closeness byte at `reach` (Transfer.alpha — the byte is its whole
  // input, so one table of 256 serves a whole sheet, and the dialog's slider costs no bake).
  lut(reach){
    const lut = new Uint8Array(256);
    for (let a = 0; a < 256; a++) lut[a] = Transfer.alpha(a, Transfer.REACH, reach);
    return lut;
  },
  // The bake's pixels with the layer's alpha for `reach`.
  pixels(res, reach){
    const lut = this.lut(reach), out = new Uint8ClampedArray(res.rgba);
    for (let i = 3; i < out.length; i += 4) out[i] = lut[out[i]];
    return out;
  },
  // A new paint layer on `slot` holding the carried cockpit, at the sheet's own size, on top of the
  // stack — one undo step (addLayerTo). Nothing else in the stack is touched, and deleting the layer
  // is the whole way back.
  place(slot, res, reach){
    const px = this.pixels(res, reach), c = mkCanvas(res.w, res.h);
    ctx2d(c).putImageData(new ImageData(px, res.w, res.h), 0, 0);
    const W = slot.composite.width, H = slot.composite.height;
    let canvas = c;
    if (W !== res.w || H !== res.h) {
      canvas = mkCanvas(W, H);
      const g = ctx2d(canvas);
      g.imageSmoothingQuality = "high";
      g.drawImage(c, 0, 0, W, H);
      // Scaled up smoothly, the layer's edge leans past the bake's own — onto texels it leaves alone,
      // the cockpit's among them: a keep region that starts in the half of its bake texel nearer a lit
      // neighbour gets a quarter of that neighbour at bilinear (t104). So the alpha is cut back to the
      // bake's, texel for texel: a sheet texel whose bake texel is empty stays empty. At the whole
      // scales power-of-two sheets give (the 16 `*_interior` sheets at 4096², review of 4.45), a bake
      // texel's coverage holds its sheet texels' — the rasteriser is conservative — so no texel the
      // cockpit renders is painted.
      const cut = new Uint8ClampedArray(px.length);
      for (let i = 3; i < px.length; i += 4) if (px[i]) cut[i] = 255;
      const s = mkCanvas(res.w, res.h);
      ctx2d(s).putImageData(new ImageData(cut, res.w, res.h), 0, 0);
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = "destination-in";
      g.drawImage(s, 0, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }
    const L = LayerNode.of({ type: "paint", name: "From the cockpit", canvas, visible: true, opacity: 1, blend: "normal" });
    addLayerTo(slot, L);
    return L;
  },
  // What the dialog says after a bake: how many of the sheet's texels the reach shows, how many the
  // cockpit already paints itself — the texels it renders (`kept`) and those whose nearest cockpit
  // surface this sheet paints — how many a painted sheet answered at any reach (`lent`), and the
  // sheets most of the paint came from.
  summary(res, reach){
    const st = res.stats, lut = this.lut(reach);
    let shown = 0;
    for (let a = 1; a < 256; a++) if (lut[a]) shown += st.hist[a];
    const own = (st.kept || 0) + (res.own >= 0 ? st.bySheet[res.own] : 0);
    const lent = st.bySheet.reduce((n, c, k) => res.pass[k] ? n : n + c, 0);
    const top = st.bySheet.map((n, k) => [n, k]).filter(x => x[0] && !res.pass[x[1]]).sort((a, b) => b[0] - a[0]).slice(0, 3)
      .map(x => res.sheets[x[1]] + " " + Math.round(100 * x[0] / Math.max(1, st.answered)) + " %");
    return { shown, covered: st.covered, own, lent, ownPct: Math.round(100 * own / Math.max(1, st.covered)), top };
  },
};
