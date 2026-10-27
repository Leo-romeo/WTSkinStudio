/*==PATHS==*/
"use strict";
// ---------- Paths: the shape tool (ROADMAP 6.1) ----------
// The first thing a real skinner asked for — *"something like the path/shape tool would be nice, I
// use that a lot for camos"* — and the same want raised from the other end: smarter brushes
// and better ways to edit and create these textures and patterns. Both are one thing.
// A hard-edged disruptive camouflage is a closed polygon with draggable points, and a run of rivets
// or a panel joint that follows a curve is **the same polygon with a stamp walked along it**, which
// is why the item refused to be split into "a shape tool" and "a fifth brush mode".
//
// A path here is a list of nodes in SHEET TEXELS, each with one handle: `h` is the outgoing control
// offset and the incoming one is its mirror, so a node is smooth when it has a handle and a corner
// when it does not. That is the smallest model that draws both a camouflage blotch and a straight
// panel line, and it is the one a user already knows from every vector tool.
//
// A path drawn on the MODEL (6.1b) is the same model in another plane: x/y are world units along the
// screen's right and up at its first click (`PathUI.frame`), and each node also carries `d`, its
// depth along the view direction, taken from the surface it was clicked on. Only then does
// `flatten` give each point a third number, the depth interpolated along its segment — so a sheet
// path's points stay exactly the pairs they always were.
//
// This section is the pure half — numbers in, numbers out, no canvas and no App — so
// `tools/t82_path.mjs` holds it against answers that are arithmetic: a segment with no handles is a
// straight line, a symmetric cubic passes through the midpoint its control polygon predicts, a walk
// along a square of side 100 at step 10 is 40 evenly spaced samples whose heading turns a right
// angle at each corner, and a point on the path is found before a handle that is further away.
//
// A node MAY carry `ix / iy`, an incoming handle of its own (ROADMAP 4.52 (2)). Only an insert makes
// one: splitting a cubic at `t` (de Casteljau) gives the new node an incoming and an outgoing handle
// that are opposite but of different lengths unless t is exactly ½, and shortens the outgoing handle
// of the node before it — which, mirrored, would bend the segment before THAT. So the curve keeps its
// shape only if a node can say its incoming handle is not its outgoing one turned round. A node
// without `ix` is the mirror as it always was, so every path made before reads the same.
const Path = {
  // Subdivisions of one curve, at most: a split halves a piece, eight levels deep. 256 rather than a
  // smaller number because a sheet is up to 8192 texels: a camo blotch whose segment runs a thousand
  // of them would be a visible polygon at 64, and the cap — not the tolerance — would decide it.
  MAX_SEG: 256,
  DEPTH: 8,
  // A path's own look (ROADMAP 4.52 (1)): `angle`, the most a curve may turn inside one piece, in
  // degrees — 0 is smooth, held to the tolerance; up to ANGLE_MAX is a deliberately low-poly curve —
  // and `bias`, −1…1, which bunches a faceted curve's pieces towards a segment's start (+) or its
  // end (−). Both
  // ride on the path, so a saved one keeps its look; a path without them is smooth and even.
  ANGLE_MAX: 90,
  // The most a flattened piece may sag from the curve, in sheet texels — what the shape tool and a
  // path layer's redraw both cut to (on the model, divided by the texel density at the first click).
  // A quarter texel since `flatten` became adaptive (4.52 (1)): 1.5 was sized for the even cut it
  // replaced, and as a sag it left 1.3 texels showing on a fill's edge.
  TOL: .25,
  CUSP: 150 * Math.PI / 180,
  make(){ return { pts: [], closed: false }; },
  clone(p){
    const look = {};
    if (p.angle) look.angle = p.angle;
    if (p.bias) look.bias = p.bias;
    return Object.assign(look, { pts: (p.pts || []).map(n => {
      const c = { x: n.x, y: n.y, hx: n.hx || 0, hy: n.hy || 0 };
      if (n.d != null) c.d = n.d;
      if (n.ix != null) { c.ix = n.ix; c.iy = n.iy; }
      return c;
    }),
             closed: !!p.closed });
  },
  add(p, x, y){ p.pts.push({ x, y, hx: 0, hy: 0 }); return p.pts[p.pts.length - 1]; },
  // How many segments a path has: one per gap between nodes, plus the closing one.
  segCount(p){ const n = p.pts.length; return n < 2 ? 0 : (p.closed ? n : n - 1); },
  seg(p, i){
    const n = p.pts.length, a = p.pts[i], b = p.pts[(i + 1) % n], bi = Path.inH(b);
    return [a, { x: a.x + (a.hx || 0), y: a.y + (a.hy || 0) }, { x: b.x + bi[0], y: b.y + bi[1] }, b];
  },
  // A node's incoming handle: its own when it has one, else the outgoing one turned round.
  inH(n){ return n.ix != null ? [n.ix, n.iy] : [-(n.hx || 0), -(n.hy || 0)]; },
  // Set it, and drop it again when it is only the mirror, so a node keeps `ix` only while it needs it.
  // The tolerance is far below a texel and a micrometre, the two units a path is in.
  setIn(n, x, y){
    if (Math.abs(x + (n.hx || 0)) < 1e-7 && Math.abs(y + (n.hy || 0)) < 1e-7) { delete n.ix; delete n.iy; }
    else { n.ix = x; n.iy = y; }
  },
  at(s, t){
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x,
            a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y];
  },
  // The path as a polyline, in the path's own units. A closed path does NOT repeat its first point —
  // the callers that need it closed say so themselves, which keeps `walk` from counting one
  // zero-length step. A straight segment (no handles) comes out as its two ends and nothing between.
  //
  // `tol` is the most a piece may sag from the curve, in the path's units: texels on the sheet,
  // metres on the model. Subdivision ADAPTS to the curve (4.52 (1)): a piece is halved while its
  // curve strays from its chord by more than `tol`, so a tight bend gets more pieces than a gentle
  // one. It replaced a cut into `control-polygon length / tol` even pieces whose tolerance was
  // floored at 0.5 — half a texel on the sheet, but half a METRE on the model, where `tol` is
  // 1.5 / density: a 1 m-radius quarter circle came out as 4 pieces at any density, sagging 20
  // texels at 1024 per metre (measured 2026-10-23), which is the faceting the owner saw on the
  // model and only there. On the sheet the old cut over-did it the other way, 232 pieces for the
  // same arc at 200 texels' radius where 16 hold it within a quarter texel. Still deterministic.
  // Memoised per path object on everything the answer depends on: the 3-D overlay flattens on every
  // rendered frame and the sheet on every draw, and a faceted cut sums its turn over 256 steps a
  // segment — 41 µs each, 20 ms a frame for a 500-segment path (review of 4.52 (1)). The key is the
  // nodes' numbers, so a node moved in place is a new key; callers treat the answer as read-only.
  memo: new WeakMap(),
  flatten(p, tol){
    const key = tol + "|" + (p.closed ? 1 : 0) + "|" + (p.angle || 0) + "|" + (p.bias || 0) + "|" +
      (p.pts || []).map(n => n.x + "," + n.y + "," + (n.hx || 0) + "," + (n.hy || 0) + "," + n.ix + "," + n.iy + "," + n.d).join(";");
    const m = p.pts && Path.memo.get(p);
    if (m && m.key === key) return m.out;
    const out = Path.flatten1(p, tol);
    if (p.pts) Path.memo.set(p, { key, out });
    return out;
  },
  flatten1(p, tol){
    const out = [];
    const sag = tol > 0 ? tol : 3;
    const ang = Math.max(0, Math.min(Path.ANGLE_MAX, +p.angle || 0)) * Math.PI / 180;
    const gam = Math.pow(3, Math.max(-1, Math.min(1, +p.bias || 0)));
    const segs = Path.segCount(p);
    if (!p.pts.length) return out;
    // Depth rides along only when the nodes have one (a path on the model); a sheet path's points
    // stay pairs. It is linear in the curve's parameter, which is all two surface hits can say.
    const dep = p.pts[0].d != null;
    const pt = n => dep ? [n.x, n.y, n.d] : [n.x, n.y];
    if (!segs) return [pt(p.pts[0])];
    for (let i = 0; i < segs; i++) {
      const s = Path.seg(p, i);
      out.push(pt(s[0]));
      const straight = s[1].x === s[0].x && s[1].y === s[0].y && s[2].x === s[3].x && s[2].y === s[3].y;
      if (straight) continue;                    // a line needs no interior points
      const da = s[0].d, db = s[3].d == null ? da : s[3].d;
      for (const t of Path.pieces(s, sag, ang, gam)) { const q = Path.at(s, t); if (dep) q.push(da + (db - da) * t); out.push(q); }
    }
    if (!p.closed) out.push(pt(p.pts[p.pts.length - 1]));
    return out;
  },
  // Where one segment is cut: the t of each interior point, in order.
  //   Smooth (`ang` 0): halve while the curve at a quarter, half or three quarters of a piece is more
  //   than `sag` off its chord — a tight bend gets more pieces than a gentle one.
  //   Faceted: as many pieces as the curve's whole turn ÷ `ang`, each turning an equal share of it,
  //   so a low-poly curve still puts its corners where it bends (curvature, not length, decides) —
  //   the same look at any size and in either view. The turn is summed over 256 steps, so an S-bend
  //   whose ends run parallel counts both of its bends. `gam` (from `bias`) gives the shares as
  //   (k / n)^gam rather than k / n: the same count, bunched towards the start (> 1) or the end.
  //   Bias does nothing to a smooth cut, whose pieces are below a quarter texel and cannot be seen.
  pieces(s, sag, ang, gam){
    const ts = [];
    const dir = t => {
      const u = 1 - t, a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
      let x = a * (s[1].x - s[0].x) + b * (s[2].x - s[1].x) + c * (s[3].x - s[2].x);
      let y = a * (s[1].y - s[0].y) + b * (s[2].y - s[1].y) + c * (s[3].y - s[2].y);
      if (Math.hypot(x, y) < 1e-12) {             // a zero handle at an end: the direction just inside it
        const p0 = Path.at(s, Math.max(0, t - 1e-4)), p1 = Path.at(s, Math.min(1, t + 1e-4));
        x = p1[0] - p0[0]; y = p1[1] - p0[1];
      }
      return [x, y];
    };
    if (ang > 0) {
      // A cusp turns ~180° inside one step. Counted as turn, it would spend pieces of no length on
      // the point itself (review: five of them at t 0.497–0.503, each arm left with one piece that
      // sagged 4.8 texels), so a step that turns more than 150° is a CORNER — a cut there, its turn
      // left out of the share.
      const K = 256, cum = new Float64Array(K + 1), corners = [];
      let prev = dir(0);
      for (let k = 1; k <= K; k++) {
        const d = dir(k / K), a = Math.abs(Math.atan2(prev[0] * d[1] - prev[1] * d[0], prev[0] * d[0] + prev[1] * d[1]));
        if (a > Path.CUSP) corners.push((k - .5) / K);
        cum[k] = cum[k - 1] + (a > Path.CUSP ? 0 : a);
        prev = d;
      }
      const T = cum[K], n = Math.min(Path.MAX_SEG, Math.max(1, Math.ceil(T / ang - 1e-6)));
      for (let j = 1, k = 1; j < n; j++) {
        const want = T * Math.pow(j / n, gam);
        while (k < K && cum[k] < want) k++;
        const span = cum[k] - cum[k - 1];
        ts.push((k - 1 + (span > 0 ? (want - cum[k - 1]) / span : 1)) / K);
      }
      // …in order, and no cut closer than four sags — a texel on the sheet — to the one before it or
      // to the segment's end: the turn piles up in the steps beside a cusp as well as in it, and a
      // piece shorter than that only puts a kink in the corner.
      const all = ts.concat(corners).sort((x, y) => x - y), out = [], end = Path.at(s, 1);
      let last = Path.at(s, 0);
      for (const t of all) {
        const q = Path.at(s, t);
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 4 * sag || Math.hypot(q[0] - end[0], q[1] - end[1]) < 4 * sag) continue;
        out.push(t); last = q;
      }
      return out;
    }
    // Distance to the chord as a SEGMENT, not a line: a curve whose handles run back along its own
    // chord leaves it past one end and is on the line all the way (review of 4.52 (1): a handle of
    // +200 beside a 100-long chord reaches x 165.7, and the line measure kept it as one piece).
    const off = (q, a, b) => {
      const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
      const u = L2 < 1e-24 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / L2));
      return Math.hypot(q[0] - a[0] - u * ex, q[1] - a[1] - u * ey);
    };
    const rec = (t0, t1, depth) => {
      if (depth >= Path.DEPTH) return;
      const a = Path.at(s, t0), b = Path.at(s, t1);
      if (![.25, .5, .75].some(f => off(Path.at(s, t0 + (t1 - t0) * f), a, b) > sag)) return;
      const tm = (t0 + t1) / 2;
      rec(t0, tm, depth + 1); ts.push(tm); rec(tm, t1, depth + 1);
    };
    rec(0, 1, 0);
    return ts;
  },
  // The polyline's own length, and the point at a distance along it. `closed` counts the segment
  // from the last point back to the first.
  length(poly, closed){
    let L = 0;
    for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i][0] - poly[i-1][0], poly[i][1] - poly[i-1][1]);
    if (closed && poly.length > 1) L += Math.hypot(poly[0][0] - poly[poly.length-1][0], poly[0][1] - poly[poly.length-1][1]);
    return L;
  },
  // Evenly spaced points along the polyline, with the local heading — what a stamp walks. The first
  // sample is the path's own start; the last is dropped on a closed path so the loop does not stamp
  // its beginning twice.
  walk(poly, step, closed){
    const out = [];
    if (poly.length < 2 || !(step > 0)) return poly.length ? [{ x: poly[0][0], y: poly[0][1], a: 0, d: poly[0][2] }] : out;
    const pts = closed ? poly.concat([poly[0]]) : poly;
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i-1][0], ay = pts[i-1][1], bx = pts[i][0], by = pts[i][1];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (!(len > 1e-9)) continue;
      const a = Math.atan2(dy, dx);
      // …and a path on the model carries its depth along too (6.1b), for the ray that finds the surface.
      const za = pts[i-1][2], zb = pts[i][2];
      for (let d = carry; d < len; d += step) {
        const q = { x: ax + dx * d / len, y: ay + dy * d / len, a };
        if (za != null) q.d = za + ((zb == null ? za : zb) - za) * d / len;
        out.push(q);
      }
      // …and the remainder carries into the next segment, so the spacing does not restart at a
      // corner: a run of rivets round a hatch would bunch at every node if it did.
      carry = step - ((len - carry) % step);
      if (carry >= step) carry -= step;
    }
    return out;
  },
  bounds(poly){
    if (!poly.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  },
  // A node put on segment i at its parameter t without changing the curve's shape: de Casteljau's
  // split, so the two halves are exactly the two pieces of the one cubic. The node before keeps its
  // incoming handle and has its outgoing one shortened to t of it; the node after has its incoming one
  // shortened to 1 − t; the new node takes the split point's two handles. A path on the model carries
  // its depth to the new node at t, which is where `flatten` already put it. Returns the new index.
  split(p, i, t){
    const n = p.pts.length, s = Path.seg(p, i), a = p.pts[i], b = p.pts[(i + 1) % n];
    const L = (u, v) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
    // A straight segment takes a corner on the line: de Casteljau would give it handles along the
    // line — the same line, but a curve to `flatten`, cut into pieces where two points were enough.
    if (s[1].x === s[0].x && s[1].y === s[0].y && s[2].x === s[3].x && s[2].y === s[3].y) {
      const q = Path.at(s, t), node = { x: q[0], y: q[1], hx: 0, hy: 0 };
      // A line's depth runs with distance along it (`flatten` gives it two ends and nothing between),
      // and Path.at(·, t) of a line is not t of the way along it — so the depth is taken where q is.
      const ex = b.x - a.x, ey = b.y - a.y, u = (ex || ey) ? ((q[0] - a.x) * ex + (q[1] - a.y) * ey) / (ex * ex + ey * ey) : t;
      if (a.d != null) node.d = a.d + ((b.d == null ? a.d : b.d) - a.d) * u;
      p.pts.splice(i + 1, 0, node);
      return i + 1;
    }
    const q0 = L(s[0], s[1]), q1 = L(s[1], s[2]), q2 = L(s[2], s[3]), r0 = L(q0, q1), r1 = L(q1, q2), m = L(r0, r1);
    const aIn = Path.inH(a);
    a.hx = q0.x - a.x; a.hy = q0.y - a.y;
    Path.setIn(a, aIn[0], aIn[1]);
    Path.setIn(b, q2.x - b.x, q2.y - b.y);
    const node = { x: m.x, y: m.y, hx: r1.x - m.x, hy: r1.y - m.y };
    Path.setIn(node, r0.x - m.x, r0.y - m.y);
    if (a.d != null) node.d = a.d + ((b.d == null ? a.d : b.d) - a.d) * t;
    p.pts.splice(i + 1, 0, node);
    return i + 1;
  },
  // The point on the path's curves nearest (x, y): `{ i, t, dist }`, or null with no segment. `map`
  // takes a point of the path ([x, y] or [x, y, d]) to the space (x, y) is in — the screen, for a path
  // on the model — so "near" is measured where the hand aims. 64 samples a segment find the nearest
  // stretch, and a ternary search inside it finds t: a click lands within a pixel of the curve
  // wherever a segment of a few thousand texels bends.
  nearest(p, x, y, map){
    const dep = p.pts.length && p.pts[0].d != null;
    let best = null;
    for (let i = 0; i < Path.segCount(p); i++) {
      const s = Path.seg(p, i), da = s[0].d, db = s[3].d == null ? da : s[3].d;
      const d2 = t => {
        let q = Path.at(s, t);
        if (dep) q.push(da + (db - da) * t);
        if (map) q = map(q);
        return (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y);
      };
      const N = 64;
      let k0 = 0, b0 = Infinity;
      for (let k = 0; k <= N; k++) { const d = d2(k / N); if (d < b0) { b0 = d; k0 = k; } }
      let lo = Math.max(0, (k0 - 1) / N), hi = Math.min(1, (k0 + 1) / N);
      for (let it = 0; it < 40; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d2(m1) < d2(m2)) hi = m2; else lo = m1; }
      // A loop can leave the search in the other of two minima; the best sample then stands.
      let t = (lo + hi) / 2, d = d2(t);
      if (b0 < d) { t = k0 / N; d = b0; }
      if (!best || d < best.d2) best = { i, t, d2: d };
    }
    return best && { i: best.i, t: best.t, dist: Math.sqrt(best.d2) };
  },
  // What is under the cursor: a node, or the handle of one. The node wins a tie, because grabbing
  // the point is the commoner gesture and a handle sits on top of its own node when it is zero.
  hit(p, x, y, r){
    let best = null, bd = r * r;
    for (let i = 0; i < p.pts.length; i++) {
      const n = p.pts[i];
      const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
      if (d <= bd) { bd = d; best = { kind: "point", i }; }
    }
    if (best) return best;
    for (let i = 0; i < p.pts.length; i++) {
      const n = p.pts[i];
      const [ix, iy] = Path.inH(n);
      for (const [kind, hx, hy] of [["handle", n.hx || 0, n.hy || 0], ["handle2", ix, iy]]) {
        if (!hx && !hy) continue;
        const d = (n.x + hx - x) * (n.x + hx - x) + (n.y + hy - y) * (n.y + hy - y);
        if (d <= bd) { bd = d; best = { kind, i }; }
      }
    }
    return best;
  },
  // Every node and handle of `src` written into `dst` (a path of the same nodes) moved by one
  // similarity: scaled by k and turned by a about (cx, cy), then shifted by (tx, ty) — the three grips
  // of 4.52 (5). A cubic under an affine map is the cubic of its mapped control points, so moving the
  // nodes and turning the handles moves the curve EXACTLY, with nothing re-fitted. Applied from the
  // gesture's starting copy each time, so a long drag does not gather rounding.
  xform(src, dst, cx, cy, k, a, tx, ty){
    const co = Math.cos(a) * k, si = Math.sin(a) * k;
    src.pts.forEach((n, i) => {
      const o = dst.pts[i], x = n.x - cx, y = n.y - cy, hx = n.hx || 0, hy = n.hy || 0;
      o.x = cx + co * x - si * y + tx; o.y = cy + si * x + co * y + ty;
      o.hx = co * hx - si * hy; o.hy = si * hx + co * hy;
      if (n.ix != null) { o.ix = co * n.ix - si * n.iy; o.iy = si * n.ix + co * n.iy; }
      else { delete o.ix; delete o.iy; }
    });
  },
  // The same path at another sheet's size: x and y scaled apart, nodes and handles alike — what a
  // path layer's recipe needs when its sheet is resized, and a preset when it lands on another.
  scale(p, kx, ky){
    for (const n of p.pts) {
      n.x *= kx; n.y *= ky; n.hx = (n.hx || 0) * kx; n.hy = (n.hy || 0) * ky;
      if (n.ix != null) { n.ix *= kx; n.iy *= ky; }
    }
  },
  // A node's handle, set from a dragged point — the mirror side follows, which is what makes the
  // node smooth. Dragging the mirror handle sets the opposite offset. A node with an incoming handle
  // of its own (an inserted one) stays smooth the same way, but each side keeps its own length: the
  // side not dragged turns to stay opposite, which is what every vector tool's smooth node does.
  setHandle(p, i, kind, x, y){
    const n = p.pts[i];
    const dx = x - n.x, dy = y - n.y;
    if (n.ix == null) {
      if (kind === "handle2") { n.hx = -dx; n.hy = -dy; } else { n.hx = dx; n.hy = dy; }
      return;
    }
    const D = Math.hypot(dx, dy), L = kind === "handle2" ? Math.hypot(n.hx || 0, n.hy || 0) : Math.hypot(n.ix, n.iy);
    const ox = D > 0 ? -dx / D * L : 0, oy = D > 0 ? -dy / D * L : 0;
    if (kind === "handle2") { n.hx = ox; n.hy = oy; Path.setIn(n, dx, dy); }
    else { n.hx = dx; n.hy = dy; Path.setIn(n, ox, oy); }
  },
};
/*==ENDPATHS==*/
