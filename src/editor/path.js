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
const Path = {
  // Subdivisions of one curve. 256 rather than a smaller number because the tolerance is in
  // TEXELS and a sheet is up to 8192 of them: a camo blotch whose segment runs a thousand texels
  // would be a visible polygon at 64, and the cap — not the tolerance — would be what decided it.
  MAX_SEG: 256,
  make(){ return { pts: [], closed: false }; },
  clone(p){
    return { pts: (p.pts || []).map(n => { const c = { x: n.x, y: n.y, hx: n.hx || 0, hy: n.hy || 0 }; if (n.d != null) c.d = n.d; return c; }),
             closed: !!p.closed };
  },
  add(p, x, y){ p.pts.push({ x, y, hx: 0, hy: 0 }); return p.pts[p.pts.length - 1]; },
  // How many segments a path has: one per gap between nodes, plus the closing one.
  segCount(p){ const n = p.pts.length; return n < 2 ? 0 : (p.closed ? n : n - 1); },
  seg(p, i){
    const n = p.pts.length, a = p.pts[i], b = p.pts[(i + 1) % n];
    return [a, { x: a.x + (a.hx || 0), y: a.y + (a.hy || 0) },
            { x: b.x - (b.hx || 0), y: b.y - (b.hy || 0) }, b];
  },
  at(s, t){
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x,
            a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y];
  },
  // The path as a polyline, in the same texels. A closed path does NOT repeat its first point —
  // the callers that need it closed say so themselves, which keeps `walk` from counting one
  // zero-length step.
  //
  // Subdivision is by the control polygon's own length rather than adaptive: a curve is cut into
  // `len / tol` pieces, capped. Deterministic, which is what lets a test state an exact answer, and
  // a straight segment (no handles) comes out as its two ends with nothing in between.
  flatten(p, tol){
    const out = [];
    const T = Math.max(.5, tol || 3);
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
      const straight = !(s[0].hx || s[0].hy || s[3].hx || s[3].hy);
      if (straight) continue;                    // a line needs no interior points
      let len = 0;
      for (let k = 0; k < 3; k++) len += Math.hypot(s[k+1].x - s[k].x, s[k+1].y - s[k].y);
      const n = Math.max(1, Math.min(Path.MAX_SEG, Math.ceil(len / T)));
      const da = s[0].d, db = s[3].d == null ? da : s[3].d;
      for (let k = 1; k < n; k++) { const q = Path.at(s, k / n); if (dep) q.push(da + (db - da) * k / n); out.push(q); }
    }
    if (!p.closed) out.push(pt(p.pts[p.pts.length - 1]));
    return out;
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
      for (const [kind, hx, hy] of [["handle", n.hx || 0, n.hy || 0], ["handle2", -(n.hx || 0), -(n.hy || 0)]]) {
        if (!hx && !hy) continue;
        const d = (n.x + hx - x) * (n.x + hx - x) + (n.y + hy - y) * (n.y + hy - y);
        if (d <= bd) { bd = d; best = { kind, i }; }
      }
    }
    return best;
  },
  // A node's handle, set from a dragged point — the mirror side follows, which is what makes the
  // node smooth. Dragging the mirror handle sets the opposite offset.
  setHandle(p, i, kind, x, y){
    const n = p.pts[i];
    const dx = x - n.x, dy = y - n.y;
    if (kind === "handle2") { n.hx = -dx; n.hy = -dy; } else { n.hx = dx; n.hy = dy; }
  },
};
/*==ENDPATHS==*/
