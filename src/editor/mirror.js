"use strict";
/*==MIRROR==*/
// ---- Symmetry in the 2-D view (ROADMAP 6.2) ----
//
// **Why this exists.** `symEnabled()` was read in `editor/paint3d.js` and nowhere else, so a stroke
// drawn on the SHEET was never mirrored. The checkbox said "(3D)", so that was honest — and it was
// still the reported bug, because the sheet mirrors *by accident* on some parts and not on others,
// which reads exactly like a mirror that half works.
//
// Measured over 14 vehicles with `tools/mirror_uv.mjs`, which reflects a vertex of each side-tagged
// part in the pair's own plane and asks whether it lands on a vertex with the SAME uv: **242 of 435
// mirrored part pairs (55.6 %) paint both sides from the same texels, and the rest do not.** It is
// not a property of the game, it is a property of each model — the M4A1's 22 pairs are 22 out of 22,
// the Pz 38(t)'s are 1 out of 16, the F-4E's wings, flaps and slats are all in the half that is NOT
// shared while 72 % of its other pairs are. So a camouflage painted on the sheet came out mirrored
// on the hull and one-sided on the wings, with nothing saying which was which.
//
// **How.** The sheet cannot answer "where is the other side of this texel" on its own, so it is
// asked of the model: `Bake.position` (ROADMAP 4.44's fifth candidate) already gives every texel its
// place on the vehicle, cached per sheet. Reflect that place in the mirror plane and the question
// becomes "which texel is at THIS place", which is the same bake read backwards — so the only new
// thing here is an index over it.
//
// The index is a grid hash in the bake's own quantised box coordinates: no metres, no conversion,
// and built over every STRIDEth texel, because the answer only has to be good to a texel and the
// refine pass below finds that. 64³ cells and a quarter-resolution sample is ~1 MB for a 2048²
// bake against 34 MB for a full texel-to-texel map, and it is built once per bake rather than per
// stroke.
//
// It works on an imported OBJ as well as a game model, which the name-pair estimator cannot: the
// plane comes from `symPlane()` (measured by shape when there are no side tokens — `SYMMETRY`) and
// everything after that is geometry.
const Mirror = {
  G: 64,                  // index resolution: cells per axis of the vehicle's box
  STRIDE: 4,              // every 4th texel of the bake is indexed; the refine pass covers the rest
  TOL: .02,               // the coarse backstop: further than this (of the box's diagonal) is nowhere
  TEXELS: 3,              // …and the real limit — a reflection more than 3 of THIS sheet's texels out
                          // is the wrong surface, not a rounding error (measured below)
  JUMP: 4,                // the mirror moved this many times further than the pointer → a new island

  // The sheet's position bake, if it is current. Null is the honest answer before one is baked.
  bake(slot){ return slot ? Bake.cached(slot, "pos") : null; },
  ready(slot){ return !!(symEnabled() && Mirror.bake(slot)); },

  // A grid hash over the baked positions, built once per bake and kept on it. `at` holds the bake
  // texel each entry came from; `cells` is the head of a chain and `next` the links, which is one
  // allocation per array instead of a Map of arrays.
  index(b){
    if (b._mirIdx) return b._mirIdx;
    const G = Mirror.G, S = Mirror.STRIDE, w = b.w, h = b.h, has = b.has, pos = b.pos;
    let n = 0;
    for (let y = 0; y < h; y += S) for (let x = 0; x < w; x += S) if (has[y * w + x]) n++;
    const cells = new Int32Array(G * G * G).fill(-1);
    const next = new Int32Array(n), at = new Int32Array(n);
    let k = 0;
    for (let y = 0; y < h; y += S) for (let x = 0; x < w; x += S) {
      const i = y * w + x;
      if (!has[i]) continue;
      at[k] = i;
      const c = ((pos[i * 3] * G >> 16) * G + (pos[i * 3 + 1] * G >> 16)) * G + (pos[i * 3 + 2] * G >> 16);
      next[k] = cells[c]; cells[c] = k; k++;
    }
    return b._mirIdx = { cells, next, at, n };
  },

  // The mirror plane in the bake's own coordinates: 0…65535 along each axis of the vehicle's box.
  // Returns null when the plane is outside the box entirely, which is a plane nothing can reflect
  // across rather than a reflection that lands nowhere.
  planeOf(b){
    const { a, c } = symPlane();
    const lo = b.bb[a + "0"], hi = b.bb[a + "1"], span = hi - lo;
    if (!(span > 0)) return null;
    return { k: "xyz".indexOf(a), c: (c - lo) / span * 65535, span };
  },

  // The texel that is this texel's reflection, in SHEET texels, or null when the reflection is not
  // on this sheet — the far side lives on another texture, or the model is not symmetric there.
  // Both are real answers and the caller stamps nothing rather than guessing. It is a whole texel of
  // the position bake, so on a sheet bigger than the bake (a 4096 sheet over a 2048 bake) it moves in
  // steps of `g` sheet texels, which `heading` has to know.
  texel(slot, x, y){
    const b = Mirror.bake(slot);
    if (!b) return null;
    const P = Mirror.planeOf(b);
    if (!P) return null;
    const W = slot.composite ? slot.composite.width : b.w, H = slot.composite ? slot.composite.height : b.h;
    const kx = b.w / W, ky = b.h / H;
    const bx = Math.max(0, Math.min(b.w - 1, Math.round(x * kx))), by = Math.max(0, Math.min(b.h - 1, Math.round(y * ky)));
    const i0 = by * b.w + bx;
    if (!b.has[i0]) return null;                           // this texel is not on the model at all
    const q = [b.pos[i0 * 3], b.pos[i0 * 3 + 1], b.pos[i0 * 3 + 2]];
    q[P.k] = 2 * P.c - q[P.k];
    const hit = Mirror.nearest(b, q, Mirror.limit(b, i0));
    if (!hit) return null;
    return { x: (hit.i % b.w) / kx, y: ((hit.i / b.w) | 0) / ky, d: hit.d, g: Math.max(1 / kx, 1 / ky) };
  },

  // How big one texel of this sheet is on the vehicle, in metres, from its own neighbours. The
  // answer varies by an order of magnitude between sheets and between islands on one sheet, which
  // is why the match tolerance is expressed in texels rather than in millimetres.
  texelSize(b, i){
    const x = i % b.w, y = (i / b.w) | 0;
    const sx = (b.bb.x1 - b.bb.x0) / 65535, sy = (b.bb.y1 - b.bb.y0) / 65535, sz = (b.bb.z1 - b.bb.z0) / 65535;
    let m = 0, n = 0;
    const a = (x + 1 < b.w && b.has[i + 1]) ? i + 1 : (x > 0 && b.has[i - 1]) ? i - 1 : -1;
    const c = (y + 1 < b.h && b.has[i + b.w]) ? i + b.w : (y > 0 && b.has[i - b.w]) ? i - b.w : -1;
    for (const j of [a, c]) {
      if (j < 0) continue;
      m += Math.hypot((b.pos[j * 3] - b.pos[i * 3]) * sx, (b.pos[j * 3 + 1] - b.pos[i * 3 + 1]) * sy,
                      (b.pos[j * 3 + 2] - b.pos[i * 3 + 2]) * sz);
      n++;
    }
    return n ? m / n : 0;
  },
  // **How close a match has to be, and why it is measured in texels.** A position-only lookup
  // cannot tell the two skins of a thin panel apart — a wing's top and bottom surface are 13 mm
  // apart on the F-4E and half a sheet apart in UV — so the nearest baked position is sometimes the
  // wrong face, and the copy lands somewhere visibly wrong rather than nowhere.
  //
  // Measured on the F-4E (3 667 covered texels, against the round trip through the plane): with a
  // flat 2 %-of-diagonal tolerance, **14 % of reflections were more than 50 mm out**. Refining the
  // index does not touch that — stride 4 → 1 and 64³ → 96³ both leave it at 90 % within 20 mm — so
  // it is the geometry, not the sampling. With the limit at 3 of this sheet's own texels (9 mm each
  // here, so 27 mm) **10 % of texels are refused and 7 of the 3 351 kept are over 50 mm: 0.2 %**.
  // Refusing is the honest half — a stroke that mirrors onto the wrong face of a wing is worse than
  // one that does not mirror, and the stroke says at the end how much of it had no mirror.
  limit(b, i){
    const diag = Math.hypot(b.bb.x1 - b.bb.x0, b.bb.y1 - b.bb.y0, b.bb.z1 - b.bb.z0);
    return Math.min(diag * Mirror.TOL, Math.max(Mirror.TEXELS * Mirror.texelSize(b, i), .003));
  },

  // The indexed texels nearest a point, then the exact one. Distance is compared in METRES, because
  // each axis is normalised by its own span and a distance in box units is not a distance.
  //
  // **Refining the single best strided hit is not enough, and the F-4E's wing is the case that
  // proves it.** The index samples every STRIDEth texel, so a candidate can be up to half a stride
  // — 18 mm there — from the surface it stands for. Where two regions of the sheet cover nearly the
  // same place on the vehicle, that error decides between them: reflecting texel (150, 420) put the
  // far wing's continuation at (1630, 561), **4.6 mm** from the target, and a texel on another
  // island at 12.9 mm — but the strided sample near the wing was the worse of the two, so refining
  // it alone returned the other island and one stamp of a seven-stamp stroke landed elsewhere.
  // So the best KEEP candidates are refined, not the best one; they are kept STRIDE apart so they
  // stand for different regions rather than four neighbours of the same one.
  KEEP: 4,
  _bi: new Int32Array(8), _bd: new Float64Array(8),
  nearest(b, q, lim){
    const idx = Mirror.index(b), G = Mirror.G, K = Mirror.KEEP;
    const sx = (b.bb.x1 - b.bb.x0) / 65535, sy = (b.bb.y1 - b.bb.y0) / 65535, sz = (b.bb.z1 - b.bb.z0) / 65535;
    const cx = Math.max(0, Math.min(G - 1, q[0] * G >> 16)), cy = Math.max(0, Math.min(G - 1, q[1] * G >> 16)),
          cz = Math.max(0, Math.min(G - 1, q[2] * G >> 16));
    const bi = Mirror._bi, bd = Mirror._bd;
    for (let k = 0; k < K; k++) { bi[k] = -1; bd[k] = Infinity; }
    const d2 = i => {
      const dx = (b.pos[i * 3] - q[0]) * sx, dy = (b.pos[i * 3 + 1] - q[1]) * sy, dz = (b.pos[i * 3 + 2] - q[2]) * sz;
      return dx * dx + dy * dy + dz * dz;
    };
    const S = Mirror.STRIDE;
    const offer = (i, v) => {
      const x = i % b.w, y = (i / b.w) | 0;
      for (let k = 0; k < K; k++) {
        if (bi[k] < 0) { bd[k] = v; bi[k] = i; return; }
        // one entry per region: a nearer sample of a region already held replaces it in place
        if (Math.abs(bi[k] % b.w - x) <= 2 * S && Math.abs(((bi[k] / b.w) | 0) - y) <= 2 * S) {
          if (v < bd[k]) { bd[k] = v; bi[k] = i; }
          return;
        }
      }
      let w = 0;
      for (let k = 1; k < K; k++) if (bd[k] > bd[w]) w = k;
      if (v < bd[w]) { bd[w] = v; bi[w] = i; }
    };
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let e = -1; e <= 1; e++) {
      const gx = cx + a, gy = cy + c, gz = cz + e;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= G || gy >= G || gz >= G) continue;
      for (let k = idx.cells[(gx * G + gy) * G + gz]; k >= 0; k = idx.next[k]) offer(idx.at[k], d2(idx.at[k]));
    }
    // A padded texel holds an exact copy of a rim texel's place, so the two tie, and the scan used to
    // keep whichever it met first — the copy, wherever the gutter lies above or left of the rim. The
    // covered texel wins a tie: the copy is not on the model, and a mirrored dab or heading read there
    // sits up to a stride out in the gutter (the review's second round of 4.50 (10), 2026-09-27).
    let best = -1, bv = Infinity;
    for (let k = 0; k < K; k++) {
      if (bi[k] < 0) continue;
      const bx = bi[k] % b.w, by = (bi[k] / b.w) | 0;
      for (let y = Math.max(0, by - S); y <= Math.min(b.h - 1, by + S); y++)
        for (let x = Math.max(0, bx - S); x <= Math.min(b.w - 1, bx + S); x++) {
          const i = y * b.w + x;
          if (!b.has[i]) continue;
          const v = d2(i);
          if (v < bv || (v === bv && b.cov[i] && !b.cov[best])) { bv = v; best = i; }
        }
    }
    return best < 0 || Math.sqrt(bv) > lim ? null : { i: best, d: Math.sqrt(bv) };
  },

  // ---- painting ----
  // The mirrored dab of a 2-D stroke, on stroke channel 1 — the same channel the 3-D mirror uses,
  // so the copy keeps its own last point and its own seam bookkeeping.
  //
  // A straight interpolation to the previous mirrored point is right while the reflection walks the
  // far side beside the pointer, and wrong the moment the stroke crosses onto a part whose twin is
  // somewhere else on the sheet: the copy would draw a line clean across the texture. So a mirrored
  // step that moved much further than the pointer did is taken as a jump, which is the same call
  // the 3-D path makes by re-casting rather than interpolating.
  stamp(p, opt){
    if (!stroke || !symEnabled()) return;
    const s = App.activeSlot;
    if (!Mirror.bake(s)) { Mirror.armed = true; return; }
    const q = Mirror.texel(s, p.x, p.y);
    if (!q) { Mirror.missed++; return; }
    const prev = Mirror._prev;
    // A Shift+click line is continuous because the user asked for it, so its copy runs from where
    // the last stroke's copy ended (`endStroke` keeps it as `_lastPtSym`, and the 2-D pointerdown
    // seeds it) — the jump test below would otherwise see "no previous point" and put one dab at
    // the far end, which is what a mirrored Shift+click drew before.
    const jump = opt && opt.line ? !stroke.lasts[1]
      : !prev || Math.hypot(q.x - prev.q.x, q.y - prev.q.y) >
                 Mirror.JUMP * Math.max(2, Math.hypot(p.x - prev.p.x, p.y - prev.p.y));
    Mirror._prev = { p: { x: p.x, y: p.y }, q: { x: q.x, y: q.y } };
    Mirror.hit++;
    let o = jump ? { jump: true } : opt;
    // Which way the copy heads where no walk of its own says so (ROADMAP 4.50 (10)): a stamp laid on
    // its own (Stamp along, whose caller gives the stroke's heading) and the dab a leap lands on. The
    // stroke's heading is reflected — for a freehand leap the one it has here, since the copy's own
    // last heading is in the island it left (4.50 (10)'s review). With no reflection to read, a stamp
    // laid alone keeps the copy's last heading and a leap has none.
    const dirs = stroke.dirs || [], sd = dirs[0];
    const a = opt && opt.ang != null ? opt.ang : jump && sd != null ? sd : null;
    if (a != null) {
      const hd = Mirror.heading(s, p, q, a);
      o = Object.assign({}, o, { ang: hd != null ? hd : jump ? null : dirs[1] });
    }
    stampAt(q.x, q.y, 1, o);
  },
  // Which way the mirrored copy heads when the stroke heads `a` at p: the chord between the
  // reflections of two points of the stroke's heading, up to HEAD bake texels ahead of p and behind.
  // Null when nothing near p reflects.
  //
  // **Why so far, and why across q** (4.50 (10)'s review, 2026-09-26). `texel` answers in whole
  // texels of the position bake — the sheet's own up to 2048, half of it on a 4096 sheet — and rounds
  // what it is asked to that grid too. Read over a 4-texel step, as this first was, that made the
  // copy's heading off by a mean of 4.7° and up to 18.7° on a sheet up to 2048, and 9.6° / 36° on a
  // 4096 sheet, over 2 400 headings with the exact reflection standing in for the search. Over a
  // chord of 2 × 32 bake texels the same 2 400 read worst 1.0°, mean 0.27°, on both (t131, through the
  // real `texel` over a synthetic plate). Reading the chord ACROSS q, from
  // the point behind to the point ahead, also cancels the mapping's own curve to first order. In bake
  // texels, so a 4096 sheet gets the angle a 2048 one does.
  //
  // **Only as far as p's own surface goes, on both sides of the plane** (the review's second round,
  // 2026-09-27). A 32-texel chord reaches past the rim of any island narrower than it, and what it
  // lands on there does not turn with the stroke: the gutter's PAD texels copy the rim's place, so they
  // reflect to the twin's rim whichever way the stroke heads, and another part's island reflects to
  // that part's twin, wherever that lies on the sheet. So each end `walk`s out from p (from the rim
  // texel p stands for, when p rounds into the gutter — `home`) and stops short of the first texel that
  // is not p's surface, and a reflected end is kept only when a walk from q reaches it, since a seam of
  // the twin's is no more the stroke's way than one of p's; and only when the halfway point reflects
  // near halfway, since a map that folds back — an island across the plane whose two edges are one
  // place, two skins of a thin panel — can put an end past q. Measured on the F-4E, the Su-27 and the
  // Leopard 2A5 (2048 and 4096 sheets; random headings, and headings along the rim) against an exact
  // 3-D truth: within 8 bake texels of a rim, a quarter to a third of every covered texel, copies more
  // than 45° off went from 1 511 of 21 600 to 101 and more than 10° off from 2 867 to 819, the mean from
  // 12° to 2.6°; 8–16 texels in, from 334 to 9 over 45°; island interiors as they were.
  //
  // A reflected end is also not used when it lands more than JUMP times further from q than its end
  // was sent, or less than a JUMP-th. The chord is then read from q to the side that held, and failing
  // both, over half the distance, down to 2 bake texels.
  HEAD: 32,
  heading(s, p, q, a){
    const b = Mirror.bake(s);
    if (!b) return null;
    const W = s.composite ? s.composite.width : b.w, H = s.composite ? s.composite.height : b.h;
    const kx = b.w / W, ky = b.h / H, c = Math.cos(a), sn = Math.sin(a), g = Math.max(1, q.g || 1);
    const o = Mirror.home(b, p, kx, ky), q0 = Mirror.home(b, q, kx, ky);
    if (!o || !q0) return null;
    const own = [Mirror.walk(b, o, c, sn, kx, ky, Mirror.HEAD * g),        // how far p's surface runs each way
                 Mirror.walk(b, o, -c, -sn, kx, ky, Mirror.HEAD * g)];
    const end = (L, k) => {
      const t = Math.min(L, own[k]), m = k ? -t : t;
      if (t < 2 * g) return null;
      const r = Mirror.texel(s, o.x + m * c, o.y + m * sn);
      if (!r) return null;
      const dx = r.x - q0.x, dy = r.y - q0.y, d = Math.hypot(dx, dy);
      if (d > Mirror.JUMP * t || d * Mirror.JUMP < t) return null;
      if (t >= 4 * g) {                              // the halfway point reflects halfway, or the map folds
        const h = Mirror.texel(s, o.x + m / 2 * c, o.y + m / 2 * sn);
        if (!h || Math.hypot(h.x - (q0.x + r.x) / 2, h.y - (q0.y + r.y) / 2) > Math.max(d / 4, 1.5 * g)) return null;
      }
      return Mirror.walk(b, q0, dx / d, dy / d, kx, ky, d) >= d - 1e-6 ? r : null;
    };
    for (let L = Mirror.HEAD * g; L >= 2 * g; L /= 2) {
      const to = end(L, 0) || q0, from = end(L, 1) || q0;
      if (to !== from) return Math.atan2(to.y - from.y, to.x - from.x);
    }
    return null;
  },
  // The bake texel under sheet point (x, y), rounded as `texel` rounds, or −1 off the bake.
  cell(b, x, y, kx, ky){
    const X = Math.round(x * kx), Y = Math.round(y * ky);
    return X < 0 || Y < 0 || X >= b.w || Y >= b.h ? -1 : Y * b.w + X;
  },
  // A sheet point as the point of the island it stands for: itself over a covered texel; over a
  // padded one, the covered texel whose place it copies — padSeams fills the gutter Bake.PAD deep with
  // exact copies of the rim, so that is the nearest covered texel holding the same place. `texel`
  // rounds, so a point a texel inside a rim can read the gutter beside it, and `texel` can answer with
  // a padded texel where no covered one ties with it. Null where the point holds no place.
  home(b, pt, kx, ky){
    const i = Mirror.cell(b, pt.x, pt.y, kx, ky);
    if (i < 0 || !b.has[i]) return null;
    if (b.cov[i]) return pt;
    const x = i % b.w, y = (i / b.w) | 0, P = i * 3;
    const src = (u, v) => {
      if (u < 0 || v < 0 || u >= b.w || v >= b.h) return false;
      const j = v * b.w + u;
      return !!b.cov[j] && b.pos[j * 3] === b.pos[P] && b.pos[j * 3 + 1] === b.pos[P + 1] && b.pos[j * 3 + 2] === b.pos[P + 2];
    };
    for (let r = 1; r <= Bake.PAD; r++) for (let d = -r; d <= r; d++)
      for (const [u, v] of [[x + d, y - r], [x + d, y + r], [x - r, y + d], [x + r, y + d]])
        if (src(u, v)) return { x: u / kx, y: v / ky };
    return null;
  },
  // How far one surface runs from sheet point o along the unit sheet direction (dx, dy), up to L sheet
  // texels, in sheet texels: a bake texel at a time, to the last texel before one that is off the bake,
  // not covered — padding, whose place is a copy of the rim's and does not move with the stroke, or
  // nothing — or whose place does not follow on from the last one's: more than STEP of o's texel
  // lengths away, which is another surface whose UVs touch this one's. o is over a covered texel
  // (`home`), or the walk has nowhere to go.
  STEP: 3,
  walk(b, o, dx, dy, kx, ky, L){
    let prev = Mirror.cell(b, o.x, o.y, kx, ky);
    if (prev < 0 || !b.cov[prev]) return 0;
    const lim = Mirror.STEP * Mirror.pitch(b, prev), st = 1 / Math.max(Math.abs(dx) * kx, Math.abs(dy) * ky);
    let t = 0;
    for (let k = 1, n = Math.ceil(L / st - 1e-9); k <= n; k++) {
      const u = Math.min(L, k * st), j = Mirror.cell(b, o.x + dx * u, o.y + dy * u, kx, ky);
      if (j < 0 || !b.cov[j]) break;
      if (j !== prev) { if (Mirror.gap(b, prev, j) > lim) break; prev = j; }
      t = u;
    }
    return t;
  },
  // Metres between two bake texels' places on the model.
  gap(b, i, j){
    return Math.hypot((b.pos[j * 3] - b.pos[i * 3]) * (b.bb.x1 - b.bb.x0) / 65535,
                      (b.pos[j * 3 + 1] - b.pos[i * 3 + 1]) * (b.bb.y1 - b.bb.y0) / 65535,
                      (b.pos[j * 3 + 2] - b.pos[i * 3 + 2]) * (b.bb.z1 - b.bb.z0) / 65535);
  },
  // How far one step of a walk moves on the model at texel i: along each axis the SHORTER of the
  // two one-sided steps to a neighbour that holds a place, passing over a zero step (a padded
  // gutter copies the rim), because across a UV seam the other neighbour can be another surface
  // metres away (wt-canvas); the two axes summed, since a step moves along both.
  pitch(b, i){
    const x = i % b.w, y = (i / b.w) | 0, axis = (j0, j1) => {
      let m = Infinity;
      for (const j of [j0, j1]) if (j >= 0 && b.has[j]) { const v = Mirror.gap(b, i, j); if (v > 0 && v < m) m = v; }
      return m;
    };
    const tx = axis(x > 0 ? i - 1 : -1, x + 1 < b.w ? i + 1 : -1), ty = axis(y > 0 ? i - b.w : -1, y + 1 < b.h ? i + b.w : -1);
    return tx < Infinity && ty < Infinity ? tx + ty : tx < Infinity ? 2 * tx : ty < Infinity ? 2 * ty : 0;
  },
  hit: 0, missed: 0, armed: false, _prev: null,
  // Called when a 2-D stroke starts and when it ends: the counters are per stroke, and what the
  // stroke could not mirror is said ONCE at the end rather than per dab (§4 — a failure on a timer
  // says its piece once).
  // `end` consumes the counters. The 2-D view calls it on EVERY pointerup — a pan, a marquee, a
  // decal drag — and a stroke's misses used to outlive it, so each later click on the sheet
  // repeated the last stroke's "no mirror" sentence over whatever that click had just said.
  begin(){ Mirror.hit = Mirror.missed = 0; Mirror.armed = false; Mirror._prev = null; },
  end(){
    const armed = Mirror.armed, hit = Mirror.hit, missed = Mirror.missed;
    Mirror.begin();
    if (armed) { Mirror.arm(App.activeSlot); return; }
    if (!missed || !symEnabled()) return;
    const pct = Math.round(100 * missed / Math.max(1, hit + missed));
    setStatus(hit
      ? "Symmetry: " + pct + "% of that stroke had no mirror on this sheet — that part's other side is on another texture"
      : "Symmetry: this part's other side isn't on this sheet, so nothing was mirrored", "err");
  },

  // ---- the bake this needs ----
  // Asked for when Symmetry is ticked with the sheet in front of you, and when a stroke finds it
  // missing, so the wait happens while the user is deciding rather than mid-stroke. It goes through
  // the gradient's queue on purpose: there is ONE position-bake queue, one GL context and one
  // progress bar, and a second queue beside it would race all three.
  arm(slot){
    if (!slot || slot._mirPending || Mirror.bake(slot) || !GradFill.bakeable(slot)) return;
    const key = Bake.key(slot, "pos");
    if (slot._mirFail === key || slot._mirDeclined === key) return;
    slot._mirPending = true;
    (async () => {
      try {
        while (Prog.active) await new Promise(r => setTimeout(r, 120));
        await GradFill.enqueue(slot);
        setStatus("Symmetry is ready on “" + slot.id + "” — strokes on the sheet mirror from here", "ok");
      } catch (err) {
        if (err instanceof Cancelled) {
          slot._mirDeclined = key;
          setStatus("Symmetry on the sheet needs this texture's place on the model — cancelled. Tick Symmetry again to ask", "err");
        } else {
          slot._mirFail = key;
          reportFailure("Preparing symmetry on “" + slot.id + "”", err, "mir-pos|" + slot.id);
        }
      } finally { slot._mirPending = false; }
    })();
  },
  // Ticking Symmetry, or changing the plane, with a sheet in front of you. A declined bake may be
  // asked for again by the same gesture that declined it.
  retry(slot){ if (slot) delete slot._mirDeclined; Mirror.arm(slot); },
};
/*==ENDMIRROR==*/
