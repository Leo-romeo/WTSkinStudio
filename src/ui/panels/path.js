// ---------- The shape tool, in the 2-D view (ROADMAP 6.1) ----------
// `Path` (editor/path.js) is the model; this is the surface. It claims the 2-D pointer the way
// `SelectUI` does — `down`/`move`/`up` returning true when it owns the event — so the precedence
// chain in `ui/view2d.js` stays one list of modes rather than becoming a tangle.
//
// The gestures are the ones every vector tool has, and no others:
//
//   click            add a node at the end of the path
//   click the line   put a node there, without changing the curve's shape (4.52 (2))
//   click the first  close it (and a closed path is what Fill needs)
//   drag a node      move it; drag its handle to curve the segments either side of it
//   drag ON creation pull a handle straight out of the node you just placed, the way a pen tool does
//   Alt+click a node take it out again — or click it and press Delete, or the panel's Delete point
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
  // A fill is one dab the shape of the path, and the Retouch brush's dabs are made from the sheet
  // under a brush — a fill with it painted the brush colour (review of 4.50 (11), 2026-10-23).
  RETOUCH_FILL: "Retouch works along a stroke — it has no fill. Stamp along the path instead, or pick another tool.",
  on: false,
  path: null,
  drag: null,
  sel: -1,                                   // the node last pressed, put in or added: what Delete takes
  TOL: Path.TOL,                             // the sag a piece may have, in sheet texels (editor/path.js)
  GRAB: 7,                                   // how near the cursor has to be, in screen pixels
  // A new path takes the panel's Angle and Bias (4.52 (1)); after that they are the path's own.
  cur(){ PathUI.follow(); return PathUI.path || (PathUI.path = Object.assign(Path.make(), PathUI.look())); },

  // ---- a path layer (4.52 (3)) ----
  // The path layer whose path this is, or null for a free path. With the tool on, a path layer
  // selected in the stack IS the path being edited — its recipe's own path object, so every gesture
  // below edits the layer — and selecting anything else lets go of it. Asked lazily, from `cur`,
  // `draw` and `sync`, because the layer list says nothing when the selection moves. A free path
  // being drawn is never swapped out from under the hand: a path layer is taken up only when the
  // tool holds no path of its own.
  // `let` is the layer Esc let go of: it stays let go while it is still the one selected, or the
  // next redraw would take it straight back up and Esc could never start a new path over it.
  layer: null, let: null,
  follow(){
    const L = activeLayerObj(), r = L && PathLayer.of(L);
    if (PathUI.let && L !== PathUI.let) PathUI.let = null;
    if (PathUI.layer && L !== PathUI.layer) PathUI.release();
    if (!PathUI.layer && r && L !== PathUI.let && PathUI.on && !PathUI.frame && (!PathUI.path || !PathUI.path.pts.length)) {
      PathUI.layer = L; PathUI.path = r.c.shape.path; PathUI.sel = -1;
    }
  },
  // Let go of the path layer. A gesture still in hand (Esc or the tool turned off mid-drag) is made
  // its step first — left pending, its edit had no step and the next gesture on the layer would
  // undo back across both (found in review, 2026-10-23).
  release(){
    PathLayer.commit("edit path");
    PathUI.layer = null; PathUI.path = null; PathUI.sel = -1; PathUI.drag = null; PathUI.xfG = null;
  },
  // An edit of the path layer is one undo step a gesture: `touch` before the first change, `changed`
  // after each (a redraw a frame while dragging, the step at the end). No-ops on a free path.
  after(){ PathUI.sync(); PathUI.redraw(); },
  touch(){ if (PathUI.layer) PathLayer.begin(App.activeSlot, PathUI.layer, PathUI.after); },
  changed(final, desc){
    if (!PathUI.layer) return;
    if (final) PathLayer.commit(desc); else PathLayer.live(App.activeSlot, PathUI.layer);
  },
  // Fill and Stamp along as a layer: a new path layer — or, on the path layer being edited, its
  // verb and brush replaced by the ones in hand, which is how a stamp is re-laid with another brush
  // or a blotch recoloured. False hands the verb back to the one-shot route: a path on the model,
  // the panel's "as a layer" off, or a tool that cannot make one (`PathLayer.takes`).
  asLayer(verb){
    const s = App.activeSlot, b = App.brush;
    if (PathUI.frame || !$("pathAsLayer").checked || !PathLayer.takes(b)) return false;
    if (b.chan !== "color" && !chanBase(s, b.chan)) return false;          // the one-shot route says why
    const word = verb === "fill" ? "Filled" : "Stamped";
    if (PathUI.layer) {
      const r = PathLayer.of(PathUI.layer);
      if (r.ch !== b.chan) { setStatus("“" + PathUI.layer.name + "” paints " + Tool.chanWord(r.ch) + " — switch the brush to it, or Esc to start a new path", "err"); return true; }
      PathLayer.begin(s, PathUI.layer, PathUI.after);
      r.c.shape.verb = verb; r.c.shape.brush = PathLayer.snap(b);
      PathLayer.commit(verb === "fill" ? "fill path layer" : "stamp path layer");
      setStatus(word + " “" + PathUI.layer.name + "” again with the brush in hand", "ok");
      return true;
    }
    const L = PathLayer.make(s, PathUI.path, verb);
    PathUI.layer = L; PathUI.path = PathLayer.of(L).c.shape.path; PathUI.sel = -1;
    setStatus(word + " the path as “" + L.name + "” — move its points and it follows. Esc starts a new path", "ok");
    PathUI.sync(); PathUI.redraw();
    return true;
  },
  look(){
    const a = +$("pathAngle").value || 0, b = (+$("pathBias").value || 0) / 100, o = {};
    if (a) o.angle = a;
    if (b) o.bias = b;
    return o;
  },
  tpp(){ return 1 / Math.max(.0001, v2.sc); },     // texels per screen pixel, for hit radii
  set(on){
    PathUI.on = !!on;
    if (!PathUI.on) PathUI.drag = null;
    if (!PathUI.on && PathUI.layer) PathUI.release();     // the layer keeps its path
    if (PathUI.on) PathUI.let = null;                    // turning the tool on over a path layer takes it up
    // Painting and the shape tool are mutually exclusive: both want a drag on the sheet, and a mode
    // some drags escape is what 3.9 was reported for.
    // `setOn` — SelectUI has no `set`, so this line threw a TypeError whenever the shape tool was
    // turned on with Select already on, and left both claiming the pointer.
    if (PathUI.on) { if (App.paint3d) setPaint3d(false); if (SelectUI.on) SelectUI.setOn(false); }
    PathUI.sync();
    PathUI.redraw();
  },
  // A path lives in the view it was started in, so clearing it also lets go of its plane (6.1b).
  // On a path layer, Esc lets go of it and the layer keeps its path.
  // Whatever is selected stays let go: Esc on a free path drawn over a selected path layer must not
  // pick that layer up in its place (review, 2026-10-23: a preset laid then took it as its own).
  clear(){ if (PathUI.layer) PathUI.release(); PathUI.let = activeLayerObj(); PathUI.path = null; PathUI.layer = null; PathUI.drag = null; PathUI.xfOn = false; PathUI.xfG = null; PathUI.sel = -1; PathUI.frame = null; PathUI.sync(); PathUI.redraw(); },
  // Backspace: the last node out, and with none left the path belongs to neither view again.
  pop(){
    const path = PathUI.path;
    if (!path || !path.pts.length) return;
    PathUI.touch();
    path.pts.pop();
    PathUI.drag = null;                      // a drag held on the node that went would land on another
    if (PathUI.sel >= path.pts.length) PathUI.sel = -1;
    if (path.pts.length < 3) path.closed = false;
    if (!path.pts.length) PathUI.frame = null;
    PathUI.changed(true, "remove path point");
    PathUI.sync(); PathUI.redraw();
  },
  // A node taken out — Alt+click, Delete, or the panel's button. Deletion existed from 6.1 on as
  // Alt+click alone, which nothing on screen said (4.52 (2)); a selected node and a key to remove it is
  // what a hand looking for "delete this point" tries first.
  remove(i){
    const path = PathUI.path;
    if (!path || !path.pts[i]) return false;
    PathUI.touch();
    path.pts.splice(i, 1);
    PathUI.sel = -1;
    PathUI.drag = null;                      // Delete with the pointer still down: drag.i is another node now
    if (path.pts.length < 3) path.closed = false;
    if (!path.pts.length) PathUI.frame = null;
    PathUI.changed(true, "remove path point");
    PathUI.sync(); PathUI.redraw();
    return true;
  },
  // ---- move, scale and turn the whole path (4.52 (5)) ----
  // With "Move · scale · turn" on, the path wears a box: drag inside it to move the path, a corner
  // to scale it about its centre, the knob above it to turn it (Shift: in 15° steps). Clicks do not
  // lay points while it is on, so a drag meant for the box never adds one. The decal's corners and
  // knob, drawn the same way; on the sheet only — a path on the model is aimed through a camera
  // frame, and moving it is a different question (left open in 4.52 (5)).
  xfOn: false, xfG: null,
  setXf(on){
    PathUI.xfOn = !!on && !!PathUI.path && PathUI.path.pts.length > 1 && !PathUI.frame;
    PathUI.xfG = null;
    PathUI.sync(); PathUI.redraw();
  },
  // The box in sheet texels, padded and with its knob, from what the path draws (its flattened curve).
  xfBox(path){
    const bb = Path.bounds(Path.flatten(path, Path.TOL)), k = PathUI.tpp(), pad = 6 * k;
    const x0 = bb.x0 - pad, y0 = bb.y0 - pad, x1 = bb.x1 + pad, y1 = bb.y1 + pad;
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
             corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], knob: [(x0 + x1) / 2, y0 - 22 * k] };
  },
  xfDown(e, p){
    const path = PathUI.path;
    if (!path || path.pts.length < 2) { PathUI.setXf(false); return false; }
    const B = PathUI.xfBox(path), r = PathUI.GRAB * PathUI.tpp(), near = q => Math.hypot(p.x - q[0], p.y - q[1]) <= r;
    const kind = near(B.knob) ? "turn" : B.corners.some(near) ? "scale" : (p.x >= B.x0 && p.x <= B.x1 && p.y >= B.y0 && p.y <= B.y1) ? "move" : null;
    if (!kind) { setStatus("Drag inside the box to move the path, a corner to scale it, the knob to turn it — or turn Move · scale · turn off to edit its points", ""); return true; }
    PathUI.touch();
    PathUI.xfG = { kind, src: Path.clone(path), cx: B.cx, cy: B.cy, x0: p.x, y0: p.y };
    return true;
  },
  xfMove(e, p){
    const G = PathUI.xfG, path = PathUI.path;
    if (!G || !path || path.pts.length !== G.src.pts.length) { PathUI.xfG = null; return; }
    let k = 1, a = 0, tx = 0, ty = 0;
    if (G.kind === "move") { tx = p.x - G.x0; ty = p.y - G.y0; }
    else if (G.kind === "scale") k = Math.max(.01, Math.hypot(p.x - G.cx, p.y - G.cy) / Math.max(1e-6, Math.hypot(G.x0 - G.cx, G.y0 - G.cy)));
    else {
      a = Math.atan2(p.y - G.cy, p.x - G.cx) - Math.atan2(G.y0 - G.cy, G.x0 - G.cx);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
    }
    Path.xform(G.src, path, G.cx, G.cy, k, a, tx, ty);
    PathUI.changed(false);
    draw2D();
  },
  xfUp(){
    const G = PathUI.xfG;
    PathUI.xfG = null;
    if (G) PathUI.changed(true, G.kind === "move" ? "move path" : G.kind === "scale" ? "scale path" : "turn path");
    PathUI.sync();
  },
  // ---- presets (4.52 (4)) ----
  // The library is `PathLib` (editor/path-lib.js). A preset is saved with the size of the sheet it was
  // drawn on, and laid on another at that sheet's scale, so a blotch drawn on a 2048 sheet is the same
  // blotch on a 4096 one rather than a quarter of it in a corner.
  async presets(keep){
    const sel = $("pathPreset"), idx = await PathLib.index();
    sel.replaceChildren(...(idx.length ? idx : [null]).map(r => {
      const o = document.createElement("option");
      o.value = r ? r.id : "";
      o.textContent = r ? r.name + (r.verb === "fill" ? " · fill" : r.verb === "stamp" ? " · stamp" : " · path") : "no presets yet";
      return o;
    }));
    if (keep && idx.some(r => r.id === keep)) sel.value = keep;
    PathUI.sync();
  },
  async save(){
    const p = PathUI.path, s = App.activeSlot;
    if (!p || p.pts.length < 2 || PathUI.frame) { setStatus("Draw a path on the sheet first — at least two points", "err"); return; }
    const r = PathUI.layer && PathLayer.of(PathUI.layer);
    const name = r ? PathUI.layer.name : "Path " + ((await PathLib.index()).length + 1);
    const shape = r ? Object.assign(PathLayer.clone(r.c.shape), { sheet: s && s.composite ? [s.composite.width, s.composite.height] : null }) : null;
    const id = await PathLib.add(name, Object.assign(Path.clone(p), { sheet: s && s.composite ? [s.composite.width, s.composite.height] : null }), shape);
    await PathUI.presets(id);
    setStatus("Saved “" + name + "” as a preset" + (r ? " — its " + r.c.shape.verb + " and brush with it" : " — the path alone"), "ok");
  },
  async use(){
    const id = $("pathPreset").value, s = App.activeSlot;
    if (!id) return;
    if (!s || !s.composite) { setStatus("Select a texture slot first", "err"); return; }
    const rec = await PathLib.get(id);
    if (!rec) { setStatus("That preset could not be read — Forget it and save it again", "err"); return; }
    // At this sheet's scale, x and y apart, and the brush with it — the same blotch, the same rivets.
    const path = rec.shape ? rec.shape.path : rec.path, from = rec.sheet;
    if (from) {
      const kx = s.composite.width / from[0], ky = s.composite.height / (from[1] || from[0]);
      Path.scale(path, kx, ky);
      if (rec.shape && typeof rec.shape.brush.size === "number") rec.shape.brush.size *= (kx + ky) / 2;
    }
    if (rec.shape) {
      const ch = rec.shape.brush.chan || "color";
      if (ch !== "color" && !chanBase(s, ch)) { setStatus("This preset paints " + Tool.chanWord(ch) + ", and “" + s.id + "” has no _n surface map to paint it over", "err"); return; }
      PathUI.clear();
      const L = PathLayer.make(s, path, rec.shape.verb, rec.shape);
      if (!PathUI.on) PathUI.set(true);
      PathUI.layer = L; PathUI.path = PathLayer.of(L).c.shape.path; PathUI.let = null;
      setStatus("Laid the preset as “" + L.name + "” — reshape it, or Move · scale · turn it into place", "ok");
    } else {
      PathUI.clear();
      if (!PathUI.on) PathUI.set(true);
      PathUI.path = path;
      setStatus("Laid the preset as a path — Fill or Stamp along to paint it", "ok");
    }
    PathUI.sync(); PathUI.redraw();
  },
  async forget(){
    const id = $("pathPreset").value;
    if (!id) return;
    await PathLib.remove(id);
    await PathUI.presets();
    setStatus("Preset forgotten", "ok");
  },
  // A click on the line, in either view: a node there, the curve unchanged, already in hand so the
  // same press can drag it. Not within a hair of a node's own t, where the node itself is what was meant.
  insert(seg){
    const path = PathUI.path, i = Path.split(path, seg.i, seg.t);
    PathUI.sel = i;
    PathUI.drag = { kind: "point", i, moved: false };
    setStatus("Point added on the line — the curve keeps its shape. Drag it to reshape; Delete removes it", "ok");
    PathUI.sync(); PathUI.redraw();
    return true;
  },
  onLine(seg, r){ return !!seg && seg.dist <= r && seg.t > 1e-3 && seg.t < 1 - 1e-3; },
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
    if (PathUI.xfOn) return PathUI.xfDown(e, p) || PathUI.down(e, p);
    PathUI.touch();                                    // a path layer's gesture is one undo step (up commits it)
    const hit = Path.hit(path, p.x, p.y, r);
    if (hit) return PathUI.onNode(e, hit, path);
    const seg = !e.altKey && !e.ctrlKey && Path.nearest(path, p.x, p.y);
    if (PathUI.onLine(seg, r)) return PathUI.insert(seg);
    if (path.closed) { setStatus("This path is closed — click its line to add a point, or Esc starts a new one", "err"); return true; }
    const q = GuidesUI.snapPt(e, p.x, p.y);          // a node near a guide lands on it (4.50 (15))
    Path.add(path, q.x, q.y);
    PathUI.sel = path.pts.length - 1;
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
    if (hit && e.altKey && hit.kind === "point") return PathUI.remove(hit.i) || true;
    PathUI.sel = hit.i;
    // Ctrl+drag a node pulls a handle OUT of it. Without this a node placed by a plain click is a
    // corner for ever: it has no handle to grab, so there is nothing to aim at (found by driving the
    // real tool with real pointer events, 2026-09-22).
    if (hit && hit.kind === "point" && e.ctrlKey) { PathUI.drag = { kind: "handle", i: hit.i, moved: false }; return true; }
    PathUI.drag = { kind: hit.kind, i: hit.i, moved: false };
    return true;
  },
  move(e, p){
    if (!PathUI.on) return false;
    if (PathUI.xfG) { PathUI.xfMove(e, p); return true; }
    const d = PathUI.drag;
    if (!d) return true;
    const path = PathUI.cur();
    if (!path.pts[d.i]) { PathUI.drag = null; return true; }
    d.moved = true;
    // A node snaps to a guide; a handle is a direction, and does not (4.50 (15)).
    if (d.kind === "point") { const q = GuidesUI.snapPt(e, p.x, p.y); path.pts[d.i].x = q.x; path.pts[d.i].y = q.y; }
    else Path.setHandle(path, d.i, d.kind, p.x, p.y);
    PathUI.changed(false);
    draw2D();
    return true;
  },
  up(){
    if (!PathUI.on) return false;
    if (PathUI.xfG) { PathUI.xfUp(); return true; }
    const d = PathUI.drag;
    PathUI.drag = null;
    // A click that never moved leaves the node a corner rather than a curve with a zero handle —
    // which is the same thing numerically, and this way the row count says what the user did.
    if (d && d.fresh && !d.moved) { const n = PathUI.cur().pts[d.i]; if (n) { n.hx = 0; n.hy = 0; } }
    PathUI.changed(true, "edit path");
    PathUI.sync();
    return true;
  },

  // ---- what it looks like ----
  // Drawn in sheet space, with the line widths divided by the zoom so they stay one pixel wherever
  // the view is — the same trick `SelectUI.draw` uses.
  draw(g){
    if (PathUI.on) PathUI.follow();
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
      const n = path.pts[i], [ix, iy] = Path.inH(n);
      if (n.hx || n.hy || ix || iy) {
        g.beginPath();
        g.moveTo(n.x + ix, n.y + iy); g.lineTo(n.x + (n.hx || 0), n.y + (n.hy || 0));
        g.lineWidth = .75 * k; g.strokeStyle = Marquee.ACCENT; g.globalAlpha = .55; g.stroke(); g.globalAlpha = 1;
        for (const [hx, hy] of [[n.hx || 0, n.hy || 0], [ix, iy]]) {
          if (!hx && !hy) continue;
          g.beginPath(); g.arc(n.x + hx, n.y + hy, 2.5 * k, 0, 7); g.fillStyle = Marquee.ACCENT; g.fill();
        }
      }
      // The selected node — what Delete takes — is drawn larger, with a white ring.
      const on = i === PathUI.sel;
      g.beginPath();
      g.arc(n.x, n.y, (on ? 5 : 3.5) * k, 0, 7);
      g.fillStyle = i === 0 && !path.closed ? "#fff" : Marquee.ACCENT;
      g.fill();
      g.lineWidth = k; g.strokeStyle = "#000"; g.stroke();
      if (on) { g.beginPath(); g.arc(n.x, n.y, 6.5 * k, 0, 7); g.strokeStyle = "#fff"; g.stroke(); }
    }
    if (PathUI.xfOn && path.pts.length > 1) {
      const B = PathUI.xfBox(path);
      g.setLineDash([4 * k, 3 * k]); g.lineWidth = k; g.strokeStyle = Marquee.ACCENT;
      g.strokeRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
      g.setLineDash([]);
      g.beginPath(); g.moveTo(B.knob[0], B.y0); g.lineTo(B.knob[0], B.knob[1]); g.stroke();
      for (const [x, y] of B.corners) { g.fillStyle = "#fff"; g.fillRect(x - 3.5 * k, y - 3.5 * k, 7 * k, 7 * k); g.strokeStyle = "#000"; g.strokeRect(x - 3.5 * k, y - 3.5 * k, 7 * k, 7 * k); }
      g.beginPath(); g.arc(B.knob[0], B.knob[1], 4.5 * k, 0, 7); g.fillStyle = "#fff"; g.fill(); g.strokeStyle = "#000"; g.stroke();
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
    if (App.brush.tool === "retouch") { setStatus(PathUI.RETOUCH_FILL, "err"); return; }
    if (PathUI.asLayer("fill")) return;
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
    const step = Math.max(1, App.brush.size * (App.brush.spacing || Pen.SPACING));
    const pts = Path.walk(poly, step, path.closed);
    if (!pts.length) { setStatus("That path is too short to stamp along", "err"); return; }
    if (PathUI.asLayer("stamp")) return;
    if (!beginStroke(false, false)) return;            // says why itself
    Mirror.begin();
    // Each stamp on its own, not interpolated — and carrying the path's heading at that point, which
    // is all a dab laid alone has to turn a tip that follows the stroke by (ROADMAP 4.50 (10)): a row
    // of square rivets round a curve stays square to the curve, and so does its mirror.
    // Each also says how far along the path it is, `step` a point, for Colour along.
    pts.forEach((q, i) => { const o = { jump: true, ang: q.a, run: i * step }; stampAt(q.x, q.y, 0, o); Mirror.stamp(q, o); });
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
    if (PathUI.on) PathUI.follow();
    b.classList.toggle("active", PathUI.on);
    b.textContent = "Shape: " + (PathUI.on ? "on" : "off");
    for (const id of ["pathRow2", "pathRow3", "pathRow4", "pathRow5", "pathRow6"]) { const row = $(id); if (row) row.style.display = PathUI.on ? "" : "none"; }
    // The sliders show the path's own look, so a path keeps what it was drawn with.
    const look = PathUI.path || PathUI.look(), ang = Math.round(+look.angle || 0), bias = Math.round((+look.bias || 0) * 100);
    $("pathAngle").value = String(ang); $("pathBias").value = String(bias);
    $("pathAngleVal").textContent = ang ? ang + "°" : "smooth";
    // Signed, so the readout can be typed into like every other (t88); the word says which end.
    $("pathBiasVal").textContent = !bias ? "even" : bias > 0 ? "+" + bias + " start" : "\u2212" + -bias + " end";
    const n = PathUI.path ? PathUI.path.pts.length : 0;
    const info = $("pathInfo");
    if (info) info.textContent = !n ? "no points yet"
      : n + (n === 1 ? " point" : " points") + (PathUI.path.closed ? " · closed" : "") + (PathUI.frame ? " · on the model" : "") +
        (PathUI.layer ? " · “" + PathUI.layer.name + "”" : "");
    for (const id of ["btnPathFill", "btnPathStamp", "btnPathSel", "btnPathClear"]) {
      const x = $(id);
      if (x) x.disabled = !n || ((id === "btnPathFill" || id === "btnPathSel") && (n < 3 || !PathUI.path.closed));
    }
    const del = $("btnPathDel");
    if (del) del.disabled = !(PathUI.sel >= 0 && PathUI.sel < n);
    if (PathUI.xfOn && (n < 2 || PathUI.frame)) PathUI.xfOn = false;
    $("btnPathSave").disabled = n < 2 || !!PathUI.frame;
    $("btnPathUse").disabled = $("btnPathForget").disabled = !$("pathPreset").value;
    const xf = $("btnPathXf");
    xf.disabled = n < 2 || !!PathUI.frame;
    xf.classList.toggle("active", PathUI.xfOn);
  },
};
$("btnPathTool").onclick = () => PathUI.set(!PathUI.on);
$("btnPathFill").onclick = () => PathUI.fill();
$("btnPathStamp").onclick = () => PathUI.stamp();
$("btnPathSel").onclick = e => PathUI.toSelection(e);
$("btnPathClear").onclick = () => PathUI.clear();
// Angle and Bias change the path being drawn at once, in both views (4.52 (1)).
$("pathAngle").oninput = $("pathBias").oninput = () => {
  const p = PathUI.path, o = PathUI.look();
  PathUI.touch();
  if (p) { delete p.angle; delete p.bias; Object.assign(p, o); }
  PathUI.changed(false);
  PathUI.sync(); PathUI.redraw();
};
// …and a path layer's step is made when the slider is let go.
$("pathAngle").onchange = $("pathBias").onchange = () => PathUI.changed(true, "path look");
$("btnPathXf").onclick = () => PathUI.setXf(!PathUI.xfOn);
// Each says its own failure: a library this browser will not write to is the user's to know about.
$("btnPathSave").onclick = () => PathUI.save().catch(e => reportFailure("Saving the path as a preset", e, "pathlib"));
$("btnPathUse").onclick = () => PathUI.use().catch(e => reportFailure("Laying the path preset", e, "pathlib"));
$("btnPathForget").onclick = () => PathUI.forget().catch(e => reportFailure("Forgetting the path preset", e, "pathlib"));
$("pathPreset").onchange = () => PathUI.sync();
$("btnPathDel").onclick = () => { if (PathUI.remove(PathUI.sel)) setStatus("Point removed", "ok"); };
