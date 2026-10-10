// ---------- The shape tool, in the 2-D view (ROADMAP 6.1) ----------
// `Path` (editor/path.js) is the model; this is the surface. It claims the 2-D pointer the way
// `SelectUI` does — `down`/`move`/`up` returning true when it owns the event — so the precedence
// chain in `ui/view2d.js` stays one list of modes rather than becoming a tangle.
//
// The gestures are the ones every vector tool has, and no others:
//
//   click            add a node at the end of the path
//   click the first  close it (and a closed path is what Fill needs)
//   drag a node      move it; drag its handle to curve the segments either side of it
//   drag ON creation pull a handle straight out of the node you just placed, the way a pen tool does
//   Alt+click a node take it out again
//   Esc              start over  ·  Backspace  drop the last node
//
// The two verbs are the item's two halves and they are deliberately the same object:
//   **Fill**   one `fill()` of the whole path into the layer, never a union of per-shape fills —
//              two antialiased edges never sum to full coverage, which is the bug that produced
//              pale panel lines (§3, the canvas facts).
//   **Stamp**  the current brush walked along it at the brush's own spacing, through the same
//              stroke machinery every other stroke uses, so it works on every channel and every
//              tool (rivets on the normal map, a panel line that follows a curve, 4.17's kernel).
const PathUI = {
  on: false,
  path: null,
  drag: null,
  TOL: 1.5,                                  // flattening tolerance, in sheet texels
  GRAB: 7,                                   // how near the cursor has to be, in screen pixels
  cur(){ return PathUI.path || (PathUI.path = Path.make()); },
  tpp(){ return 1 / Math.max(.0001, v2.sc); },     // texels per screen pixel, for hit radii
  set(on){
    PathUI.on = !!on;
    if (!PathUI.on) PathUI.drag = null;
    // Painting and the shape tool are mutually exclusive: both want a drag on the sheet, and a mode
    // some drags escape is what 3.9 was reported for.
    // `setOn` — SelectUI has no `set`, so this line threw a TypeError whenever the shape tool was
    // turned on with Select already on, and left both claiming the pointer.
    if (PathUI.on) { if (App.paint3d) setPaint3d(false); if (SelectUI.on) SelectUI.setOn(false); }
    PathUI.sync();
    PathUI.redraw();
  },
  // A path lives in the view it was started in, so clearing it also lets go of its plane (6.1b).
  clear(){ PathUI.path = null; PathUI.drag = null; PathUI.frame = null; PathUI.sync(); PathUI.redraw(); },
  // Backspace: the last node out, and with none left the path belongs to neither view again.
  pop(){
    const path = PathUI.path;
    if (!path || !path.pts.length) return;
    path.pts.pop();
    if (path.pts.length < 3) path.closed = false;
    if (!path.pts.length) PathUI.frame = null;
    PathUI.sync(); PathUI.redraw();
  },
  // Both views: the sheet draws a sheet path, the model's overlay a path on the model (view3d/path-overlay.js).
  redraw(){ draw2D(); if (PathUI.frame || PathOverlay.shown) needsRender(); },

  // ---- the pointer ----
  down(e, p){
    if (!PathUI.on) return false;
    const s = App.activeSlot;
    if (!s || !s.composite) { setStatus("Select a texture slot first, then click to lay down points", "err"); return true; }
    const path = PathUI.cur(), r = PathUI.GRAB * PathUI.tpp();
    // A path drawn on the model is in metres on a plane, not in texels — the two cannot be one shape.
    if (PathUI.frame && path.pts.length) { setStatus("This path is on the model — finish it in the 3-D view, or Esc clears it", "err"); return true; }
    const hit = Path.hit(path, p.x, p.y, r);
    if (hit) return PathUI.onNode(e, hit, path);
    if (path.closed) { setStatus("This path is closed — Esc starts a new one", "err"); return true; }
    const q = GuidesUI.snapPt(e, p.x, p.y);          // a node near a guide lands on it (4.50 (15))
    Path.add(path, q.x, q.y);
    // A drag straight out of the click pulls the new node's handle, which is how a pen tool draws a
    // curve without a second gesture.
    PathUI.drag = { kind: "handle", i: path.pts.length - 1, moved: false, fresh: true };
    PathUI.sync(); draw2D();
    return true;
  },
  // A press on a node or a handle, in either view: the same four gestures whichever space the path is in.
  onNode(e, hit, path){
    // Closing comes BEFORE the drag, and that ordering is the whole of it: the first node is under
    // the cursor when you click it, so a hit that started a drag first would take that node and the
    // path could never be closed at all (caught by t82 before this shipped).
    if (!path.closed && path.pts.length > 2 && !e.altKey && hit && hit.kind === "point" && hit.i === 0) {
      path.closed = true;
      setStatus("Path closed — Fill paints it, Stamp walks the brush round it", "ok");
      PathUI.sync(); PathUI.redraw();
      return true;
    }
    if (hit && e.altKey && hit.kind === "point") {
      path.pts.splice(hit.i, 1);
      if (path.pts.length < 3) path.closed = false;
      PathUI.sync(); PathUI.redraw();
      return true;
    }
    // Ctrl+drag a node pulls a handle OUT of it. Without this a node placed by a plain click is a
    // corner for ever: it has no handle to grab, so there is nothing to aim at (found by driving the
    // real tool with real pointer events, 2026-09-22).
    if (hit && hit.kind === "point" && e.ctrlKey) { PathUI.drag = { kind: "handle", i: hit.i, moved: false }; return true; }
    PathUI.drag = { kind: hit.kind, i: hit.i, moved: false };
    return true;
  },
  move(e, p){
    if (!PathUI.on) return false;
    const d = PathUI.drag;
    if (!d) return true;
    const path = PathUI.cur();
    if (!path.pts[d.i]) { PathUI.drag = null; return true; }
    d.moved = true;
    // A node snaps to a guide; a handle is a direction, and does not (4.50 (15)).
    if (d.kind === "point") { const q = GuidesUI.snapPt(e, p.x, p.y); path.pts[d.i].x = q.x; path.pts[d.i].y = q.y; }
    else Path.setHandle(path, d.i, d.kind, p.x, p.y);
    draw2D();
    return true;
  },
  up(){
    if (!PathUI.on) return false;
    const d = PathUI.drag;
    PathUI.drag = null;
    // A click that never moved leaves the node a corner rather than a curve with a zero handle —
    // which is the same thing numerically, and this way the row count says what the user did.
    if (d && d.fresh && !d.moved) { const n = PathUI.cur().pts[d.i]; if (n) { n.hx = 0; n.hy = 0; } }
    PathUI.sync();
    return true;
  },

  // ---- what it looks like ----
  // Drawn in sheet space, with the line widths divided by the zoom so they stay one pixel wherever
  // the view is — the same trick `SelectUI.draw` uses.
  draw(g){
    if (!PathUI.on || !PathUI.path || !PathUI.path.pts.length || PathUI.frame) return;   // a path on the model is drawn there
    const path = PathUI.path, k = PathUI.tpp();
    const poly = Path.flatten(path, PathUI.TOL * k);
    g.save();
    if (poly.length > 1) {
      g.beginPath();
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      if (path.closed) g.closePath();
      g.lineWidth = 1.5 * k;
      g.strokeStyle = "#000";
      g.globalAlpha = .5;
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = .75 * k;
      g.strokeStyle = Marquee.ACCENT;
      g.stroke();
    }
    for (let i = 0; i < path.pts.length; i++) {
      const n = path.pts[i];
      if (n.hx || n.hy) {
        g.beginPath();
        g.moveTo(n.x - n.hx, n.y - n.hy); g.lineTo(n.x + n.hx, n.y + n.hy);
        g.lineWidth = .75 * k; g.strokeStyle = Marquee.ACCENT; g.globalAlpha = .55; g.stroke(); g.globalAlpha = 1;
        for (const [hx, hy] of [[n.hx, n.hy], [-n.hx, -n.hy]]) {
          g.beginPath(); g.arc(n.x + hx, n.y + hy, 2.5 * k, 0, 7); g.fillStyle = Marquee.ACCENT; g.fill();
        }
      }
      g.beginPath();
      g.arc(n.x, n.y, 3.5 * k, 0, 7);
      g.fillStyle = i === 0 && !path.closed ? "#fff" : Marquee.ACCENT;
      g.fill();
      g.lineWidth = k; g.strokeStyle = "#000"; g.stroke();
    }
    g.restore();
  },

  // ---- the verbs ----
  // Both are strokes, so the shape lands wherever the brush would have painted — the selected
  // layer's content on the brush's own channel, or its mask — and nothing here knows which.
  //
  // Fill is a stroke whose one dab is the whole path. `beginStroke` finds or makes what it paints
  // on (a layer, or the channel slot on the selected one) and builds the shield — selected parts,
  // protected parts, the layer's own scope, the marquee — and `endStroke` lays it on at the brush's
  // opacity, erases with the Eraser, hides or reveals on a mask, and folds a layer it had to make
  // into the same undo step. Fill used to go round all of that with its own `paintTarget()` call:
  // it painted straight over protected parts and outside the selection, threw on a selected layer
  // with nothing on the brush's channel (`needSlot` was never handled), filled with colour under
  // the Eraser, and left a layer it had made as a second, separate undo step.
  fill(){
    if (PathUI.frame) return PathUI.fillModel();       // a path on the model is projected (ui/panels/path3d.js)
    const path = PathUI.path, s = App.activeSlot;
    if (!path || path.pts.length < 3 || !path.closed) { setStatus("Close the path first — click its first point again", "err"); return; }
    if (!s || !s.composite) return;
    // Refused before `beginStroke`, which may make a layer for the tool that is about to be refused.
    if (App.brush.tool === "height") { setStatus("Panel line carves along a stroke — it has no fill. Pick another tool.", "err"); return; }
    if (!beginStroke(false, false)) return;            // says why itself
    stroke.undo.desc = "fill path";                    // the history says what was done, not "color stroke"
    const c = stroke.t.canvas;
    const kx = c.width / s.composite.width, ky = c.height / s.composite.height;
    const poly = Path.flatten(path, PathUI.TOL), bb = Path.bounds(poly);
    // A camouflage tile repeats (ROADMAP 4.50 (6)): the shape is filled once per copy of the sheet it
    // overlaps, so a blotch drawn across an edge comes back in on the other side. Each copy is still
    // one fill of the whole path — the seam rule below holds per copy.
    const W = s.composite.width, H = s.composite.height;
    for (const dy of CamoTile.span(bb.y0, bb.y1, H, CamoTile.is(s)))
      for (const dx of CamoTile.span(bb.x0, bb.x1, W, CamoTile.is(s))) PathUI.fillAt(poly, bb, dx * W, dy * H, c, kx, ky);
    endStroke();
    draw2D();
    const L = activeLayerObj();
    setStatus("Filled the path on “" + (L ? L.name : s.id) + "”", "ok");
  },
  // One fill of the path, moved by (ox, oy) sheet texels, into the stroke's buffer.
  fillAt(poly, bb, ox, oy, c, kx, ky){
    const x0 = Math.max(0, Math.floor((bb.x0 + ox) * kx) - 1), y0 = Math.max(0, Math.floor((bb.y0 + oy) * ky) - 1);
    const x1 = Math.min(c.width, Math.ceil((bb.x1 + ox) * kx) + 1), y1 = Math.min(c.height, Math.ceil((bb.y1 + oy) * ky) + 1);
    if (!(x1 > x0 && y1 > y0)) return;
    // One path, one fill. A shape built as a union of per-shape fills gets a pale seam wherever
    // two of them meet, because two antialiased edges never sum to full coverage.
    const g = ctx2d(stroke.buf);
    g.save();
    g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    // One dab with nothing to overlap, so Flow — how overlapping dabs build — has nothing to do,
    // and the fill lands at Opacity in a wash and with Build up alike (`Pen.deposit`, 6.4).
    g.globalAlpha = stroke.dep.fill; g.globalCompositeOperation = "source-over";
    g.beginPath();
    g.moveTo((poly[0][0] + ox) * kx, (poly[0][1] + oy) * ky);
    for (let i = 1; i < poly.length; i++) g.lineTo((poly[i][0] + ox) * kx, (poly[i][1] + oy) * ky);
    g.closePath();
    g.fillStyle = PathUI.inkFor(stroke.t);
    g.fill();
    PathUI.laid(g, x0, y0, x1, y1);
  },
  // The end of a fill in either view, over the box it drew into in the stroke's buffer: the shield —
  // the stencil every dab is clipped to — and then the undo tiles and the buffer's dirty rectangle.
  laid(g, x0, y0, x1, y1){
    if (stroke.maskCanvas) {
      const mk = strokeMaskScale();
      // At 1: a destination-in at the fill's own alpha would take Opacity off the fill twice.
      g.globalAlpha = 1; g.globalCompositeOperation = "destination-in";
      g.drawImage(stroke.maskCanvas, x0 * mk.x, y0 * mk.y, (x1 - x0) * mk.x, (y1 - y0) * mk.y, x0, y0, x1 - x0, y1 - y0);
    }
    g.restore();
    // `record` takes a centre and a half-size, so the box's own half-extent covers every tile.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) / 2;
    stroke.undo.record(cx, cy, r);
    strokeBufferDirty(cx, cy, r);                      // so the next stroke clears only this much
  },
  // What a fill writes: the brush's colour on the albedo, its value everywhere else — the same
  // answer the brush itself gives, so a shape and a stroke never disagree about what the tool means.
  inkFor(t){
    if (t.mask) return "#fff";
    const ch = App.brush.chan;
    return ch === "color" ? App.brush.color : hexOfGrey(App.brush.value);
  },
  // The other half: the brush walked along the path. This is the whole of "a run of rivets at a
  // spacing, or a panel joint that follows a curve" — it is the stroke machinery, driven by the
  // path instead of by the pointer, so every tool and every channel comes along for free.
  stamp(){
    if (PathUI.frame) return PathUI.stampModel();      // walked on the model, raycast to its surface
    const path = PathUI.path, s = App.activeSlot;
    if (!path || path.pts.length < 2) { setStatus("Lay down at least two points first", "err"); return; }
    if (!s) return;
    const poly = Path.flatten(path, PathUI.TOL);
    const step = Math.max(1, App.brush.size * (App.brush.spacing || .35));
    const pts = Path.walk(poly, step, path.closed);
    if (!pts.length) { setStatus("That path is too short to stamp along", "err"); return; }
    if (!beginStroke(false, false)) return;            // says why itself
    Mirror.begin();
    // Each stamp on its own, not interpolated — and carrying the path's heading at that point, which
    // is all a dab laid alone has to turn a tip that follows the stroke by (ROADMAP 4.50 (10)): a row
    // of square rivets round a curve stays square to the curve, and so does its mirror.
    for (const q of pts) { const o = { jump: true, ang: q.a }; stampAt(q.x, q.y, 0, o); Mirror.stamp(q, o); }
    endStroke();
    draw2D();
    setStatus(pts.length + " stamps along the path, " + Math.round(step) + " texels apart — Spacing sets the gap", "ok");
    Mirror.end();                                    // …and what of it had no mirror, if symmetry is on
  },

  // The third verb (ROADMAP 4.50 (9)): the path as a SELECTION rather than as paint. A closed path
  // already says exactly where a camouflage patch is, and filling it is only one thing to do there
  // — confining the brush to it, cropping to it, copying it out are the others. `SelShape.poly`
  // fills by the same nonzero rule a canvas `fill()` does, so the selection covers what Fill paints.
  toSelection(e){
    const path = PathUI.path;
    if (!path || path.pts.length < 3 || !path.closed) { setStatus("Close the path first — click its first point again", "err"); return false; }
    if (PathUI.frame) return PathUI.selModel(e);       // projected, as Fill is
    const op = SelectUI.opOf(e), had = !!Marquee.rect();
    const ok = Marquee.fromPoly(Path.flatten(path, PathUI.TOL), op,
      op === "sub" ? "take the path out of the selection" : op === "add" ? "add the path to the selection" : "path → selection");
    SelectUI.said("path", op, had, ok);
    SelectUI.sync();
    draw2D();
    return ok === true;                              // not "same": a Shift or Alt that changed nothing
  },

  // ---- the panel ----
  sync(){
    const b = $("btnPathTool");
    if (!b) return;
    b.classList.toggle("active", PathUI.on);
    b.textContent = "Shape: " + (PathUI.on ? "on" : "off");
    const row = $("pathRow2");
    if (row) row.style.display = PathUI.on ? "" : "none";
    const n = PathUI.path ? PathUI.path.pts.length : 0;
    const info = $("pathInfo");
    if (info) info.textContent = !n ? "no points yet"
      : n + (n === 1 ? " point" : " points") + (PathUI.path.closed ? " · closed" : "") + (PathUI.frame ? " · on the model" : "");
    for (const id of ["btnPathFill", "btnPathStamp", "btnPathSel", "btnPathClear"]) {
      const x = $(id);
      if (x) x.disabled = !n || ((id === "btnPathFill" || id === "btnPathSel") && (n < 3 || !PathUI.path.closed));
    }
  },
};
$("btnPathTool").onclick = () => PathUI.set(!PathUI.on);
$("btnPathFill").onclick = () => PathUI.fill();
$("btnPathStamp").onclick = () => PathUI.stamp();
$("btnPathSel").onclick = e => PathUI.toSelection(e);
$("btnPathClear").onclick = () => PathUI.clear();
