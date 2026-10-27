/*==PROCEDURAL==*/
"use strict";
// ---------- Procedural noise and pattern tiles (ROADMAP 4.50 (7) and (8)) ----------
// Two fills a gradient could not be: NOISE for weathering (grime, mottling, chips, rain marks) and
// a PATTERN — an image of the user's own, repeated. They share the machinery a gradient along the
// model already has (editor/gradient.js): the slot's position bake says where every texel sits on
// the vehicle in metres, so anything evaluated from a POSITION rather than from a UV is seamless
// across UV islands by construction — two texels on either side of a seam are one point of the
// vehicle, and one point has one value. That is the whole reason noise lives in model space: the
// app can ship no one's grunge maps (§0.5), and a noise painted in UV space would show every seam.
//
// NOISE is a gradient whose t comes from a noise field instead of an axis: the record is a
// gradient record with `shape: "noise"` and a `noise` sub-record, so its stops, its From / To
// (here: levels on the noise's own 0…1) and its repeat all mean what they mean on a gradient, and
// a stop is written by the same `Gradient.writer` — dithered the same way. `repeat` on a noise is
// contour bands, which is a camouflage in its own right.
//
//   noise: { type: "perlin" | "value" | "cells" | "streaks",
//            seed,       any integer — the same seed is the same noise, on every machine
//            scale,      metres: the size of the coarsest feature
//            octaves,    1…8 layers of finer detail, each at twice the frequency
//            rough,      0…1: how much each finer layer adds (the fBm gain)
//            stretch }   streaks only: how many times longer than wide, along the vehicle's up axis
//
// A PATTERN is a tile image and one of two mappings:
//
//   pat: { space: "uv" | "model",
//          repeat,       uv: how many times the tile repeats across the sheet's width
//          size,         model: the tile's width on the vehicle, in metres
//          angle,        degrees
//          x, y,         the offset, in fractions of a tile
//          sharp }       model: how hard the three projections hand over (1 soft … 16 hard)
//
// "model" is TRI-PLANAR: the tile is projected along each of the vehicle's three axes and the
// three are blended by how squarely the surface faces each one — the blend weights come from the
// NORMAL plane the position bake carries since this item. Substance's own documentation calls
// tri-planar "very useful to project noises and patterns without creating any visible seams".
//
// This section is the pure half — no DOM, no GL, no App — so `tools/t94_pattern.mjs` holds it under
// Node, and it is what the fill pool's workers run (`GradFill.pool`, sections GRADIENT +
// PROCEDURAL). Every evaluator takes a REGION of a W × H sheet and absolute texel coordinates,
// the way `Gradient.evalModel` does, so a band evaluated in a worker is the same bytes as the same
// rows of the whole sheet.
const Procedural = {
  NOISE: ["perlin", "value", "cells", "streaks"],
  // Single-octave statistics of each basis, measured 2026-09-26 over 400 000 random points in a
  // 1000-unit cube: Perlin mean 0 and sd .2703 (p0.5 / p99.5 at ±.632, i.e. ±2.34 sd), value
  // mean .4993 sd .2002, cells (F1) mean .5208 sd .1723. The fBm of o octaves at gain r spreads
  // as sd · √Σr²ᵏ / Σrᵏ — measured .1657 at four octaves against .166 predicted, and .1231 / .123
  // for value noise — so the field below maps ±SPREAD of ITS OWN spread onto 0…1, and one octave
  // and eight read with the same contrast. A fixed divisor gave eight octaves half the contrast of
  // one, which is the wrong way round for a slider labelled "detail".
  STATS: { perlin: [0, .2703], value: [.4993, .2002], cells: [.5208, .1723] },
  SPREAD: 2.4,
  // A new noise: Perlin grime at half a metre with four octaves — what the Fill select makes.
  noiseMake(){ return { type: "perlin", seed: 1, scale: .5, octaves: 4, rough: .5, stretch: 8 }; },
  noiseClone(n){
    n = n || {};
    const num = (v, d, lo, hi) => { v = +v; return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d)); };
    return { type: Procedural.NOISE.includes(n.type) ? n.type : "perlin", seed: (+n.seed || 0) | 0,
             scale: num(n.scale, .5, .001, 1000), octaves: Math.round(num(n.octaves, 4, 1, 8)),
             rough: num(n.rough, .5, 0, 1), stretch: num(n.stretch, 8, 1, 100) };
  },

  // ---- the lattice hash ----
  // A 32-bit integer hash of a lattice point and a seed: the three coordinates through odd
  // multipliers, then murmur3's finaliser. No permutation table, so no period: a 256-entry table
  // repeats every 256 cells, which at 5 cm chips is 12.8 m — eight repeats down a battleship's
  // side. Math.imul keeps it exact integer arithmetic, so the same seed is the same noise on every
  // machine and in every worker, which a float hash on the GPU could not promise.
  HX: 0x8da6b343 | 0, HY: 0xd8163841 | 0, HZ: 0xcb1ab31f | 0,
  fin(h){
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return h ^ (h >>> 16);
  },
  // Ken Perlin's twelve cube-edge gradients (improved noise, 2002), padded to sixteen with the four
  // corners of a tetrahedron at the same length (√2) instead of his four repeated edges. His
  // padding — (1,1,0), (−1,1,0), (0,−1,1), (0,−1,−1) — puts y in twelve of the sixteen against ten
  // for x and z, and measured 2026-09-26 that makes the noise vary 20 % faster along y: neighbours
  // 60 cm apart correlated .188 along y against .267 along x. That matters here because y is the
  // vehicle's UP axis, the one streaks are stretched along. A tetrahedron's corners weigh every axis
  // alike, so each axis now carries the same share of the sixteen.
  GX: [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, .8165, -.8165, .8165, -.8165],
  GY: [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, .8165, -.8165, -.8165, .8165],
  GZ: [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, .8165, .8165, -.8165, -.8165],
  // Gradient noise, ≈ −1…1. Written out rather than looped: measured 2026-09-26, this shape is
  // 38 ns an evaluation under Node against 290 ns for the same arithmetic through a closure per
  // corner — 3.4 s against 0.48 s for five octaves over a 2048² sheet.
  perlin(x, y, z, s){
    const P = Procedural, fin = P.fin, GX = P.GX, GY = P.GY, GZ = P.GZ;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z, gx = fx - 1, gy = fy - 1, gz = fz - 1;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const hx = Math.imul(X, P.HX), x0 = hx ^ s, x1 = (hx + P.HX) ^ s;
    const y0 = Math.imul(Y, P.HY), y1 = (y0 + P.HY) | 0, z0 = Math.imul(Z, P.HZ), z1 = (z0 + P.HZ) | 0;
    let h;
    h = fin(x0 ^ y0 ^ z0) & 15; const n000 = GX[h] * fx + GY[h] * fy + GZ[h] * fz;
    h = fin(x1 ^ y0 ^ z0) & 15; const n100 = GX[h] * gx + GY[h] * fy + GZ[h] * fz;
    h = fin(x0 ^ y1 ^ z0) & 15; const n010 = GX[h] * fx + GY[h] * gy + GZ[h] * fz;
    h = fin(x1 ^ y1 ^ z0) & 15; const n110 = GX[h] * gx + GY[h] * gy + GZ[h] * fz;
    h = fin(x0 ^ y0 ^ z1) & 15; const n001 = GX[h] * fx + GY[h] * fy + GZ[h] * gz;
    h = fin(x1 ^ y0 ^ z1) & 15; const n101 = GX[h] * gx + GY[h] * fy + GZ[h] * gz;
    h = fin(x0 ^ y1 ^ z1) & 15; const n011 = GX[h] * fx + GY[h] * gy + GZ[h] * gz;
    h = fin(x1 ^ y1 ^ z1) & 15; const n111 = GX[h] * gx + GY[h] * gy + GZ[h] * gz;
    const a = n000 + (n100 - n000) * u, b = n010 + (n110 - n010) * u, c = n001 + (n101 - n001) * u, d = n011 + (n111 - n011) * u;
    const e = a + (b - a) * v, f = c + (d - c) * v;
    return e + (f - e) * w;
  },
  // Value noise, 0…1: a random value at each lattice point, blended with the same quintic.
  // Blotchier than Perlin — its features sit on the lattice — which is what mottled paint wants.
  value(x, y, z, s){
    const P = Procedural, fin = P.fin, K = 1 / 4294967296;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const hx = Math.imul(X, P.HX), x0 = hx ^ s, x1 = (hx + P.HX) ^ s;
    const y0 = Math.imul(Y, P.HY), y1 = (y0 + P.HY) | 0, z0 = Math.imul(Z, P.HZ), z1 = (z0 + P.HZ) | 0;
    const n000 = (fin(x0 ^ y0 ^ z0) >>> 0) * K, n100 = (fin(x1 ^ y0 ^ z0) >>> 0) * K;
    const n010 = (fin(x0 ^ y1 ^ z0) >>> 0) * K, n110 = (fin(x1 ^ y1 ^ z0) >>> 0) * K;
    const n001 = (fin(x0 ^ y0 ^ z1) >>> 0) * K, n101 = (fin(x1 ^ y0 ^ z1) >>> 0) * K;
    const n011 = (fin(x0 ^ y1 ^ z1) >>> 0) * K, n111 = (fin(x1 ^ y1 ^ z1) >>> 0) * K;
    const a = n000 + (n100 - n000) * u, b = n010 + (n110 - n010) * u, c = n001 + (n101 - n001) * u, d = n011 + (n111 - n011) * u;
    const e = a + (b - a) * v, f = c + (d - c) * v;
    return e + (f - e) * w;
  },
  // Cellular (Worley) noise: the distance to the nearest of one jittered feature point per cell,
  // over the 27 cells around. 0 at a feature point, rising to the cell walls — spots and chips
  // once levels cut it. Five times the cost of Perlin (27 hashes against 8), measured 494 ms for
  // one octave over a 2048² sheet against 96 for Perlin's.
  cells(x, y, z, s){
    const P = Procedural, K = 1 / 1024;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    let d = 9;
    for (let k = -1; k <= 1; k++) {
      const hz = Math.imul(Z + k, P.HZ), cz = Z + k - z;
      for (let j = -1; j <= 1; j++) {
        const hy = Math.imul(Y + j, P.HY) ^ hz, cy = Y + j - y;
        for (let i = -1; i <= 1; i++) {
          const h = P.fin((Math.imul(X + i, P.HX) ^ s) ^ hy);
          const dx = X + i - x + (h & 1023) * K, dy = cy + ((h >>> 10) & 1023) * K, dz = cz + ((h >>> 20) & 1023) * K;
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < d) d = dd;
        }
      }
    }
    return Math.sqrt(d);
  },
  // Everything about a record that does not change per texel, worked out once: which basis, the
  // two frequencies (streaks are stretched along y, the vehicle's up axis — a game model's +y, and
  // an OBJ's too, see Gradient.presets), each octave's amplitude and seed, and the normalisation.
  prep(nz){
    const n = Procedural.noiseClone(nz);
    const basis = n.type === "value" ? 1 : n.type === "cells" ? 2 : 0;
    const st = Procedural.STATS[basis === 1 ? "value" : basis === 2 ? "cells" : "perlin"];
    const amps = [], seeds = [];
    let a = 1, sa = 0, sa2 = 0;
    for (let o = 0; o < n.octaves && a > 1e-6; o++) {
      amps.push(a); sa += a; sa2 += a * a;
      seeds.push((n.seed ^ Math.imul(o + 1, 0x9e3779b9)) | 0);       // each octave its own lattice values
      a *= n.rough;
    }
    const spread = st[1] * Math.sqrt(sa2) / sa;
    return { basis, f: 1 / n.scale, fy: n.type === "streaks" ? 1 / (n.scale * n.stretch) : 1 / n.scale,
             amps, seeds, mu: st[0], k: 1 / (sa * 2 * Procedural.SPREAD * spread) };
  },
  // The field at a point in metres, 0…1 (clamped past ±SPREAD). Each octave is offset by a
  // fraction of a cell as well as reseeded: Perlin noise is zero ON its lattice, and with every
  // octave's lattice through the same points the sum would be zero there too — a faint grid.
  at(k, x, y, z){
    const P = Procedural, n = k.amps.length;
    let sum = 0, f = 1;
    for (let o = 0; o < n; o++) {
      const px = x * k.f * f + o * .37, py = y * k.fy * f + o * .61, pz = z * k.f * f + o * .19;
      const v = k.basis === 0 ? P.perlin(px, py, pz, k.seeds[o]) : k.basis === 1 ? P.value(px, py, pz, k.seeds[o]) : P.cells(px, py, pz, k.seeds[o]);
      sum += k.amps[o] * (v - k.mu);
      f *= 2;
    }
    const t = .5 + sum * k.k;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  },
  // One region of a noise fill, from a position bake — `Gradient.evalModel`'s contract, with the
  // noise in place of the axis: t = (field − from) / (to − from), then the stops. `P.row0` is the
  // first bake row `P.pos` holds (a worker is handed only the rows of its band); 0 when absent.
  evalNoise(P, g, W, H, sx, sy, tw, th, out){
    const k = Procedural.prep(g.noise);
    const from = g.from == null ? 0 : +g.from;
    let to = g.to == null ? 1 : +g.to;
    if (to === from) to += 1e-6;                                   // a hard edge, not a division by zero
    const scale = 1 / (to - from);
    const kx = P.w / W, ky = P.h / H, r0 = P.row0 || 0;
    const bb = P.bb, ax = (bb.x1 - bb.x0) / 65535, ay = (bb.y1 - bb.y0) / 65535, az = (bb.z1 - bb.z0) / 65535;
    const pos = P.pos, has = P.has, w = Gradient.writer(g, out);
    for (let y = 0; y < th; y++) {
      const by = (Math.min(P.h - 1, ((sy + y) * ky) | 0) - r0) * P.w;
      for (let x = 0; x < tw; x++) {
        const i = by + Math.min(P.w - 1, ((sx + x) * kx) | 0);
        if (!has[i]) { w.skip(); continue; }
        const v = Procedural.at(k, bb.x0 + pos[i*3] * ax, bb.y0 + pos[i*3+1] * ay, bb.z0 + pos[i*3+2] * az);
        w.put((v - from) * scale, sx + x, sy + y);
      }
    }
    return out;
  },

  // ---- pattern tiles ----
  patMake(space){ return { space: space === "model" ? "model" : "uv", repeat: 8, size: 1, angle: 0, x: 0, y: 0, sharp: 4 }; },
  patClone(p){
    p = p || {};
    const num = (v, d, lo, hi) => { v = +v; return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d)); };
    return { space: p.space === "model" ? "model" : "uv", repeat: Math.round(num(p.repeat, 8, 1, 256)), size: num(p.size, 1, .001, 1000),
             angle: num(p.angle, 0, -360, 360), x: num(p.x, 0, -1, 1), y: num(p.y, 0, -1, 1), sharp: num(p.sharp, 4, 1, 32) };
  },
  // ---- lattices (ROADMAP 4.55, the lattice as a fill first) ----
  // A honeycomb and its kin as a TILE for the pattern fill, so it repeats on the sheet or wraps round
  // the model exactly as an image tile does, and its cells line up across the whole of it. The record
  // is what the tile is drawn from (`GradFill.latticeTile`): the cell shape, the fill and the border,
  // each with its colour and whether it is drawn, and the border's width as a fraction of the cell.
  LATTICE: ["hex", "square", "diamond", "triangle", "scale"],
  latticeMake(){ return { kind: "hex", fill: "#262a30", border: "#d8dde4", width: .08, fillOn: true, borderOn: true }; },
  latticeClone(l){
    l = l || {};
    const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : d, w = +l.width;
    return { kind: Procedural.LATTICE.includes(l.kind) ? l.kind : "hex", fill: hex(l.fill, "#262a30"), border: hex(l.border, "#d8dde4"),
             width: Math.max(0, Math.min(.5, Number.isFinite(w) ? w : .08)), fillOn: l.fillOn !== false, borderOn: l.borderOn !== false };
  },
  // One period of a lattice, in its cell units: the tile's size (w × h — the aspect it keeps) and its
  // cells, as polygons [x0, y0, x1, y1, …] or, for scales, circles [cx, cy, r] in the order they
  // overlap. Every cell that reaches into the period is listed, its neighbours' copies included, so a
  // tile drawn from them meets itself at every edge. A unit is a hexagon's or a triangle's side, a
  // square's side, a diamond's diagonal, a scale's diameter.
  latticeCells(kind){
    const out = { w: 1, h: 1, cells: [], circles: null }, S3 = Math.sqrt(3);
    const at = (pts, dx, dy) => pts.map((v, i) => v + (i & 1 ? dy : dx));
    if (kind === "hex") {                                   // pointy-top, side 1: a period of √3 × 3, two cells
      out.w = S3; out.h = 3;
      const hx = [];
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; hx.push(Math.cos(a), Math.sin(a)); }
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.cells.push(at(hx, i * S3, j * 3), at(hx, S3 / 2 + i * S3, 1.5 + j * 3));
    } else if (kind === "square") {
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.cells.push(at([0, 0, 1, 0, 1, 1, 0, 1], i, j));
    } else if (kind === "diamond") {                        // squares turned 45°: two a period
      const d = [.5, 0, 1, .5, .5, 1, 0, .5];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.cells.push(at(d, i, j), at(d, i - .5, j - .5));
    } else if (kind === "triangle") {                       // side 1: a period of 1 × √3, four cells
      const h = S3 / 2;
      out.h = S3;
      for (let k = -2; k <= 2; k++) for (let i = -2; i <= 1; i++) {      // an odd row is half a cell over: its copy at −2 reaches 0
        const x = i + (k & 1 ? .5 : 0), y = k * h;
        out.cells.push([x, y + h, x + 1, y + h, x + .5, y], [x + .5, y, x + 1.5, y, x + 1, y + h]);
      }
    } else {                                                // scales: rows of discs half a diameter apart,
      out.circles = [];                                     // each row over the one above it
      for (let k = -2; k <= 3; k++) for (let i = -1; i <= 1; i++) out.circles.push([i + (k & 1 ? .5 : 0), k * .5, .5]);
    }
    return out;
  },
  // ---- the pattern brush (4.55, the brush that reveals whole cells) ----
  // The brush's own record: the lattice's look (`latticeClone`) with `kind` "off" for no pattern, and
  // where it lies on the model — the tile's width in metres and its angle, the "lattice, along the
  // model" fill's Size and Angle, so a brush and a fill set alike lay the same cells.
  brushPatMake(){ return Object.assign(Procedural.latticeMake(), { kind: "off", size: .3, angle: 0 }); },
  brushPatClone(p){
    p = p || {};
    const num = (v, d, lo, hi) => { v = +v; return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d)); };
    return Object.assign(Procedural.latticeClone(p), { kind: Procedural.LATTICE.includes(p.kind) ? p.kind : "off",
      size: num(p.size, .3, .01, 100), angle: num(p.angle, 0, -360, 360) });
  },
  // Which cells own each pixel of a W × H tile of lattice `kind` with a border `width` wide (cell
  // units, as `latticeTile` strokes it): RGBA, up to four cell indices into `centres` (255 for none),
  // nearest first. A cell owns what it encloses and its border — every pixel within half the border
  // of its outline — so a border two cells share belongs to both, and a cell revealed alone keeps its
  // whole border; four, because that is how many squares or diamonds meet at a corner (three hexagons
  // do; six triangles meet at theirs, and the nearest four keep all of a corner but its tip — at three
  // the review of 2026-10-25 saw a notch at a square's corner under a 0.3 border). Scales overlap, each over the one above it, so a pixel is the topmost scale's that
  // reaches it, border included, and only that one's. `centres` is each cell's centre in cell units
  // in the period's frame, sixteen bits a coordinate over −8 … 8, four bytes a cell (`cellAt` in
  // ProjBrushGL's lattice pass reads them back); `reach` is the farthest any pixel a cell owns lies
  // from its centre, in cell units. Pure, so t173 holds it under Node.
  latticeOwners(kind, width, W, H){
    const C = Procedural.latticeCells(kind), hw = Math.max(0, +width || 0) / 2, own = new Uint8Array(W * H * 4).fill(255);
    const tol = .5 * Math.max(C.w / W, C.h / H);           // half a pixel: a texel the tile shows as border is owned
    const shapes = C.circles ? C.circles.map(([x, y, r]) => ({ x, y, R: r, r })) : C.cells.map(p => {
      let x = 0, y = 0;
      for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
      x /= p.length / 2; y /= p.length / 2;
      let R = 0;
      for (let i = 0; i < p.length; i += 2) R = Math.max(R, Math.hypot(p[i] - x, p[i + 1] - y));
      return { x, y, R, p };
    });
    if (shapes.length > 64) throw new Error("lattice " + kind + ": more than 64 cells in a period");
    // signed distance from (x, y) to polygon p: negative inside (the polygons are convex)
    const dist = (p, x, y) => {
      let best = Infinity, inside = true, sgn = 0;
      for (let i = 0, n = p.length; i < n; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[(i + 2) % n], by = p[(i + 3) % n], ex = bx - ax, ey = by - ay;
        const cr = ex * (y - ay) - ey * (x - ax);
        if (cr !== 0) { const s = Math.sign(cr); if (sgn && s !== sgn) inside = false; sgn = sgn || s; }
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
        best = Math.min(best, Math.hypot(x - ax - t * ex, y - ay - t * ey));
      }
      return inside ? -best : best;
    };
    // Each row looks only at the cells whose reach crosses it, and the nearest three are kept in place —
    // a triangle tile at 256 × 512 is 131 072 pixels over 40 cells, and the first version, every cell
    // at every pixel with an array per hit, took 610 ms at 512 × 1024 on the owner's machine.
    const lim = hw + tol, bd = new Float64Array(4), bk = new Int32Array(4), bc = new Float64Array(4);
    let reach = 0;
    for (let py = 0; py < H; py++) {
      const y = (py + .5) / H * C.h, row = [];
      for (let k = 0; k < shapes.length; k++) if (Math.abs(y - shapes[k].y) <= shapes[k].R + lim) row.push(k);
      for (let px = 0; px < W; px++) {
        const x = (px + .5) / W * C.w, o = (py * W + px) * 4;
        let n = 0;
        for (const k of row) {
          const s = shapes[k], dc = Math.hypot(x - s.x, y - s.y);
          if (dc > s.R + lim) continue;
          if (!s.p) { bd[0] = 0; bk[0] = k; bc[0] = dc; n = 1; continue; }   // circles in order: the last that reaches is on top
          const d = dist(s.p, x, y);
          if (d > lim) continue;
          let j = Math.min(n, 3);                                       // insert by distance, keeping four
          if (n === 4 && d >= bd[3]) continue;
          while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; bk[j] = bk[j - 1]; bc[j] = bc[j - 1]; j--; }
          bd[j] = d; bk[j] = k; bc[j] = dc;
          if (n < 4) n++;
        }
        for (let j = 0; j < n; j++) { own[o + j] = bk[j]; if (bc[j] > reach) reach = bc[j]; }
      }
    }
    const centres = new Uint8Array(64 * 4), q = v => Math.max(0, Math.min(65535, Math.round((v + 8) / 16 * 65535)));
    shapes.forEach((s, k) => { const a = q(s.x), b = q(s.y); centres.set([a >> 8, a & 255, b >> 8, b & 255], 4 * k); });
    return { W, H, own, centres, reach, n: shapes.length };
  },
  // Where the tile goes on a UV sheet, as a canvas transform from the image's pixels to the sheet's
  // texels: scaled so `repeat` tiles span the sheet's width (the tile keeps its own aspect), slid
  // (x, y) of a tile along its own axes, turned by `angle` about the sheet's corner — clockwise as
  // the sheet is shown, y running down; `evalTri` turns and slides the same way on every face. The
  // corner anchor makes a whole number of repeats meet itself across the sheet's LEFT and RIGHT
  // edges at 0° and 180°, and across the top and bottom only when the tile's height goes into the
  // sheet's a whole number of times (a square tile on a square sheet); at 90° and 270° the two
  // conditions trade edges. At a whole-degree angle that is not a right angle neither pair can
  // meet (its sine and cosine are never both rational), and the review measured it: at 15° the
  // colours either side of both edges differed by up to 360 (R + G). A part whose UVs run past 1
  // (4.23(a)) seams there. The height is not snapped to make it meet: that would stretch the user's
  // tile by up to half a tile over the sheet, and say nothing. t94 holds the claim.
  uvMatrix(pat, W, H, iw, ih){
    const p = Procedural.patClone(pat);
    const tw = W / p.repeat, k = tw / Math.max(1, iw), th = Math.max(1, ih) * k;
    const a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const ox = p.x * tw, oy = p.y * th;
    return [c * k, s * k, -s * k, c * k, c * ox - s * oy, s * ox + c * oy];
  },
  // The power of two a side is resampled to: the next one up, at most 1024 — a tile shown larger
  // than 1024 texels on a 2048² bake would be most of a sheet, and a 4096² tile's mips would be
  // 90 MB copied into every worker of the pool on every evaluation.
  pot(n){ let p = 1; while (p < n && p < 1024) p *= 2; return p; },
  // A mip chain of the tile, PREMULTIPLIED, so a minified pattern is filtered rather than aliased
  // and a transparent texel's colour cannot bleed into its neighbours. Level 0 is the image
  // resampled (bilinear, wrapped) to a power of two each way; every level after it is a 2×2 box of
  // the one before, which tiles exactly because the one before did. `aspect` is the ORIGINAL
  // image's height over width, which the tile keeps on the model whatever level 0 was stretched to.
  mips(rgba, w, h){
    const W0 = Procedural.pot(w), H0 = Procedural.pot(h);
    const d0 = new Uint8ClampedArray(W0 * H0 * 4), acc = [0, 0, 0, 0];
    // premultiplied BEFORE the resample, or a transparent texel's colour is interpolated into its
    // opaque neighbour — the dark fringe round every keyed-out edge
    const pre = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const al = rgba[i*4+3] / 255; pre[i*4] = rgba[i*4] * al; pre[i*4+1] = rgba[i*4+1] * al; pre[i*4+2] = rgba[i*4+2] * al; pre[i*4+3] = rgba[i*4+3]; }
    const src = { w, h, d: pre };
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      Procedural.tapAny(src, (x + .5) / W0, (y + .5) / H0, acc);
      const o = (y * W0 + x) * 4;
      d0[o] = acc[0]; d0[o+1] = acc[1]; d0[o+2] = acc[2]; d0[o+3] = acc[3];
    }
    const levels = [{ w: W0, h: H0, d: d0 }];
    for (let L = levels[0]; L.w > 1 || L.h > 1; ) {
      const w2 = Math.max(1, L.w >> 1), h2 = Math.max(1, L.h >> 1), sx = L.w / w2, sy = L.h / h2;
      const d = new Uint8ClampedArray(w2 * h2 * 4);
      for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) s += L.d[((y * sy + j) * L.w + x * sx + i) * 4 + c];
        d[(y * w2 + x) * 4 + c] = s / (sx * sy);
      }
      levels.push(L = { w: w2, h: h2, d });
    }
    return { levels, aspect: h / Math.max(1, w) };
  },
  // A mip chain as ONE buffer and a table of where each level starts — the shape that crosses to
  // a worker. The chain as eleven arrays, structured-cloned into each band of an evaluation, held
  // the main thread 46 ms at a 1024² tile (2026-09-26, eight bands posted in one task); one buffer
  // copied with `slice` and transferred is a single memcpy a band.
  pack(M){
    let n = 0;
    for (const l of M.levels) n += l.d.length;
    const buf = new Uint8ClampedArray(n), levels = [];
    let off = 0;
    for (const l of M.levels) { buf.set(l.d, off); levels.push({ w: l.w, h: l.h, off }); off += l.d.length; }
    return { buf: buf.buffer, levels, aspect: M.aspect };
  },
  unpack(p){ return { levels: p.levels.map(l => ({ w: l.w, h: l.h, d: new Uint8ClampedArray(p.buf, l.off, l.w * l.h * 4) })), aspect: p.aspect }; },
  // Bilinear and wrapped, of an image of any size, into `acc` — only for building level 0 above.
  // (u, v) are in tiles; texel centres at half-texels.
  tapAny(m, u, v, acc){
    const fx = u * m.w - .5, fy = v * m.h - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const X0 = ((x0 % m.w) + m.w) % m.w, Y0 = ((y0 % m.h) + m.h) % m.h, X1 = (X0 + 1) % m.w, Y1 = (Y0 + 1) % m.h;
    const d = m.d, i00 = (Y0 * m.w + X0) * 4, i10 = (Y0 * m.w + X1) * 4, i01 = (Y1 * m.w + X0) * 4, i11 = (Y1 * m.w + X1) * 4;
    const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
    for (let c = 0; c < 4; c++) acc[c] += d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11;
  },
  // Bilinear and wrapped, of one power-of-two level, weighted, into `acc` (premultiplied). The
  // `& (w − 1)` wrap is exact for any int32 — negative too — which is why levels are powers of two.
  tap(m, u, v, wt, acc){
    const fx = u * m.w - .5, fy = v * m.h - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const mw = m.w - 1, mh = m.h - 1, X0 = x0 & mw, X1 = (x0 + 1) & mw, Y0 = y0 & mh, Y1 = (y0 + 1) & mh;
    const d = m.d, i00 = (Y0 * m.w + X0) * 4, i10 = (Y0 * m.w + X1) * 4, i01 = (Y1 * m.w + X0) * 4, i11 = (Y1 * m.w + X1) * 4;
    const w00 = (1 - ax) * (1 - ay) * wt, w10 = ax * (1 - ay) * wt, w01 = (1 - ax) * ay * wt, w11 = ax * ay * wt;
    acc[0] += d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
    acc[1] += d[i00+1] * w00 + d[i10+1] * w10 + d[i01+1] * w01 + d[i11+1] * w11;
    acc[2] += d[i00+2] * w00 + d[i10+2] * w10 + d[i01+2] * w01 + d[i11+2] * w11;
    acc[3] += d[i00+3] * w00 + d[i10+3] * w10 + d[i01+3] * w01 + d[i11+3] * w11;
  },
  // Trilinear: the two levels round `lod` (log2 of level-0 pixels per sheet texel), blended.
  tapLod(M, u, v, lod, wt, acc){
    const L = M.levels, top = L.length - 1;
    if (!(lod > 0)) { Procedural.tap(L[0], u, v, wt, acc); return; }
    if (lod >= top) { Procedural.tap(L[top], u, v, wt, acc); return; }
    const l0 = Math.floor(lod), f = lod - l0;
    Procedural.tap(L[l0], u, v, wt * (1 - f), acc);
    if (f > 0) Procedural.tap(L[l0 + 1], u, v, wt * f, acc);
  },
  // The size of one bake texel on the vehicle, in metres: along each axis the SMALLER of its two
  // one-sided steps (right and left, down and up), then the larger of the two axes. The smaller,
  // because a neighbour across a UV seam can be another surface: two islands whose UVs touch but
  // which sit metres apart on the vehicle made the rim's outward step metres long, and the rim took
  // the tile's 1×1 mean — a line of the average colour down the island's edge, the very seam
  // tri-planar is there to hide (review of 4.50 (7), 2026-09-26: a red / blue stripe tile read its
  // purple mean on 196 of 196 rim texels). The inward step is the island's own surface. A step of
  // zero is a padded gutter texel — a copy of the rim — and says nothing, so it is passed over; a
  // texel with no step at all says 0, which reads as "sharpest level". Both sides are read, so a
  // band is handed the row ABOVE its first as well as the row below its last (`GradFill.band`).
  footprint(P, i, bx, by, ax, ay, az){
    const w = P.w, r0 = P.row0 || 0, rows = P.rows || (P.h - r0), S = Procedural.step, N = Procedural.nearer;
    const x = N(bx + 1 < w ? S(P, i, i + 1, ax, ay, az) : 0, bx > 0 ? S(P, i, i - 1, ax, ay, az) : 0);
    const y = N(by + 1 < r0 + rows ? S(P, i, i + w, ax, ay, az) : 0, by > r0 ? S(P, i, i - w, ax, ay, az) : 0);
    return Math.sqrt(x > y ? x : y);
  },
  // The squared distance in metres from bake texel i to texel j; 0 when j holds no position.
  step(P, i, j, ax, ay, az){
    if (!P.has[j]) return 0;
    const pos = P.pos, dx = (pos[j*3] - pos[i*3]) * ax, dy = (pos[j*3+1] - pos[i*3+1]) * ay, dz = (pos[j*3+2] - pos[i*3+2]) * az;
    return dx * dx + dy * dy + dz * dz;
  },
  // The smaller of two steps, a zero being no step at all.
  nearer(a, b){ return a && b ? (a < b ? a : b) : a || b; },
  // One region of a tri-planar pattern, from a position bake with its normal plane (`P.nrm`, three
  // bytes a texel, 128 = 0). Straight RGBA out, transparent where the bake has no position. Each
  // plane's (u, v) is flipped by the sign of the normal so the tile reads the same way round from
  // either side of the vehicle; the flip happens where that plane's weight is zero, so it cannot
  // show. The level of detail is picked per texel from its footprint, because a UV layout packs
  // parts at very different densities and one level for the whole sheet would alias on the small
  // ones or blur the big ones.
  // Every face's (u, v) runs right and DOWN as the face is seen from outside — (x, −y) on +z,
  // (−z, −y) on +x, (z, −x) on +y and their mirrors — which is the sheet's own frame, so the tile is
  // turned and slid exactly as `uvMatrix` turns and slides it: the tile coordinate is the point
  // turned back by `angle`, over the tile's size, less the offset. The first version turned the
  // other way and slid the other way — a positive Angle clockwise on the sheet and anticlockwise on
  // the model, and the Fill select carries Angle and Offset across when the kind changes (review of
  // 4.50 (7), 2026-09-26). t94 now holds a +z face to the sheet's mapping, texel by texel.
  evalTri(P, pat, M, W, H, sx, sy, tw, th, out){
    const p = Procedural.patClone(pat), L0 = M.levels[0];
    const kx = P.w / W, ky = P.h / H, r0 = P.row0 || 0;
    const bb = P.bb, ax = (bb.x1 - bb.x0) / 65535, ay = (bb.y1 - bb.y0) / 65535, az = (bb.z1 - bb.z0) / 65535;
    const tileW = p.size, tileH = p.size * M.aspect, a = p.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    // level-0 pixels per metre of the vehicle (the finer of the tile's two directions), and bake
    // texels per sheet texel (the coarser of the two): a footprint in metres times both is the
    // number of level-0 pixels one sheet texel covers
    const pxPerM = Math.max(L0.w / tileW, L0.h / tileH), bakePerSheet = Math.max(kx, ky);
    const pos = P.pos, has = P.has, nrm = P.nrm, acc = [0, 0, 0, 0];
    const plane = (u, v, lod, wt) => {
      const ru = u * ca + v * sa, rv = v * ca - u * sa;
      Procedural.tapLod(M, ru / tileW - p.x, rv / tileH - p.y, lod, wt, acc);
    };
    let o = 0;
    for (let y = 0; y < th; y++) {
      const by = Math.min(P.h - 1, ((sy + y) * ky) | 0);
      for (let x = 0; x < tw; x++, o += 4) {
        const bx = Math.min(P.w - 1, ((sx + x) * kx) | 0), i = (by - r0) * P.w + bx;
        if (!has[i]) { out[o+3] = 0; continue; }
        const px = bb.x0 + pos[i*3] * ax, py = bb.y0 + pos[i*3+1] * ay, pz = bb.z0 + pos[i*3+2] * az;
        const nx = nrm[i*3] / 127.5 - 1, ny = nrm[i*3+1] / 127.5 - 1, nz = nrm[i*3+2] / 127.5 - 1;
        // |n|^sharp, with the planes that would add under a thousandth dropped BEFORE normalising,
        // so the three still sum to one and a flat face is exactly one projection
        let wx = Math.pow(Math.abs(nx), p.sharp), wy = Math.pow(Math.abs(ny), p.sharp), wz = Math.pow(Math.abs(nz), p.sharp);
        let ws = wx + wy + wz;
        if (!(ws > 1e-12)) { wx = 0; wy = 1; wz = 0; ws = 1; }
        if (wx < ws * 1e-3) wx = 0;
        if (wy < ws * 1e-3) wy = 0;
        if (wz < ws * 1e-3) wz = 0;
        ws = wx + wy + wz; wx /= ws; wy /= ws; wz /= ws;
        const lod = Math.log2(Math.max(1e-9, Procedural.footprint(P, i, bx, by, ax, ay, az) * bakePerSheet * pxPerM));
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        if (wx) plane(nx < 0 ? pz : -pz, -py, lod, wx);
        if (wy) plane(ny < 0 ? -pz : pz, -px, lod, wy);
        if (wz) plane(nz < 0 ? -px : px, -py, lod, wz);
        const al = acc[3];
        if (al < .5) { out[o+3] = 0; continue; }
        const inv = 255 / al;
        out[o] = acc[0] * inv; out[o+1] = acc[1] * inv; out[o+2] = acc[2] * inv; out[o+3] = al;
      }
    }
    return out;
  },
};
/*==ENDPROCEDURAL==*/
