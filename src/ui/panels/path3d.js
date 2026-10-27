"use strict";
// ---------- The shape tool on the model, in the 3-D view (ROADMAP 6.1b) ----------
// 6.1 drew its paths on the sheet only, "since a path drawn in 3-D is the projector's problem". This
// is that problem, answered with the projector: the sheet cannot hold a shape that crosses a UV seam
// — the two sides of the seam are two islands that may lie anywhere on it — while the model can.
//
// **One path, two spaces.** `Path` stays the model it was. A path started on the model lives in the
// plane of a projection frame fixed at its FIRST click (`projFrame`: origin the surface point, n
// towards the camera, r / u the screen's right and up), with x / y in metres along r / u and each node
// carrying `d`, its depth along n from the surface it was put on. The frame is the aim of every verb,
// so orbiting afterwards changes how the path is SEEN and not what it paints — the same promise a
// projected decal makes, and for the same reason.
//
// **A path belongs to the view it was started in**: a click in the other one says so and does
// nothing, rather than mixing texels with metres into one shape.
//
// The three verbs are the sheet's three, carried over:
//   Fill        the path, rasterised as ONE fill into an image of its bounding box at the sheet's own
//               texel density, projected back along n through the projector projected decals use —
//               its depth pre-pass, its facing, its tiled UVs, its canvas fallback — then hardened to a
//               binary stencil and laid through the stroke machinery like the sheet's Fill.
//   Stamp along the brush walked along the path at its own Spacing, each stamp found on the surface by
//               a ray back along n and laid by `stamp3d`, the hand-drawn 3-D stroke's own dab —
//               symmetry, radial copies, tips and "angle follows the stroke" with it.
//   → selection the same projected stencil as Fill, put in force as a selection.
//
// Methods on `PathUI` rather than a second object, so there is one shape tool with one state.
Object.assign(PathUI, {
  frame: null,           // null: a sheet path. Otherwise { p, n, r, u } fixed at the first click, and `dens`
  over3d: false,         // the pointer is over the model or a node — the cursor says crosshair
  // How far past the nodes' own depth range the beam reaches, as a fraction of the path's larger
  // half-size. A path's interior can stand off the plane its nodes span: a 1 m blotch with its nodes
  // round the rim of a 0.6 m-radius fuselage bulges 0.27 m towards the camera in the middle, so half
  // of 0.5 m (0.25) plus the few texels below is what reaches it. The far side of a wing is not what
  // this guards — it faces away and is behind the near side, which facing and the depth pre-pass
  // settle; this is for a parallel surface off the near one's edge, a stabiliser under a wing.
  DEPTH_MARGIN: .5,

  // ---- the plane ----
  toPlane(v){ const F = PathUI.frame, q = v.clone().sub(F.p); return { x: q.dot(F.r), y: q.dot(F.u), d: q.dot(F.n) }; },
  lift(x, y, d){ const F = PathUI.frame; return F.p.clone().addScaledVector(F.r, x).addScaledVector(F.u, y).addScaledVector(F.n, d || 0); },
  // The pointer's ray met with the plane at depth `d` — where a handle, or a node dragged off the
  // model, goes. Null when the ray runs along the plane.
  rayPlane(e, d){
    const R = ProjHandles.ray(e), F = PathUI.frame, k = R.d.dot(F.n);
    if (Math.abs(k) < 1e-6) return null;
    const t = (d - R.o.clone().sub(F.p).dot(F.n)) / k;
    return PathUI.toPlane(R.o.addScaledVector(R.d, t));
  },
  // Sheet texels per metre where the path starts, on the sheet the verbs write: what sizes the fill's
  // image and turns the brush's Spacing into metres. The plate in t132 is 64 / m exactly.
  densAt(hit){
    const s = App.activeSlot, W = s && s.composite ? s.composite.width : 1024, H = s && s.composite ? s.composite.height : 1024;
    const d = faceTexelDensity(hit, W, H);
    if (d > 0) return d;
    const m = App.modelSize ? Math.max(App.modelSize.x, App.modelSize.y, App.modelSize.z) : 10;
    return W / m;
  },

  // ---- the pointer ----
  // The path as screen pixels, so `Path.hit` answers "which node" in the units a hand aims in.
  screenPath(){
    const path = PathUI.path, out = { pts: [], closed: path.closed };
    for (const n of path.pts) {
      const c = worldToScreen(PathUI.lift(n.x, n.y, n.d));
      const h = n.hx || n.hy ? worldToScreen(PathUI.lift(n.x + n.hx, n.y + n.hy, n.d)) : c;
      const q = { x: c.x, y: c.y, hx: h.x - c.x, hy: h.y - c.y };
      // An incoming handle of its own (an inserted node, 4.52 (2)) is projected as itself: under
      // perspective the mirror of a projected handle is not the projection of the mirror.
      if (n.ix != null) { const k = worldToScreen(PathUI.lift(n.x + n.ix, n.y + n.iy, n.d)); q.ix = k.x - c.x; q.iy = k.y - c.y; }
      out.pts.push(q);
    }
    return out;
  },
  grab3d(e){
    const path = PathUI.path;
    if (!PathUI.on || !PathUI.frame || !path || !path.pts.length) return null;
    return Path.hit(PathUI.screenPath(), e.clientX, e.clientY, PathUI.GRAB);
  },
  // True when the press is the shape tool's. A node or a handle under the pointer always is; the
  // model under it is when no modifier asks for something else; anything else — a click off the
  // model, Ctrl's part pick, Alt's colour pick — is left to the view, so it stays navigable.
  down3d(e){
    if (!PathUI.on || e.button !== 0) return false;
    const path = PathUI.cur();
    // A path layer is a sheet object even with no points left (review, 2026-10-23: a model click
    // wrote plane metres into its recipe), so the model is refused while one is held.
    if ((path.pts.length || PathUI.layer) && !PathUI.frame) {
      if (e.ctrlKey || e.altKey || !ray3d(e, true)) return false;
      setStatus("This path is on the 2-D sheet — finish it there, or Esc clears it to start one on the model", "err");
      return true;
    }
    const hit = PathUI.grab3d(e);
    if (hit) return PathUI.onNode(e, hit, path);
    // S and X held are "jump to this part's slot" and "protect it", which work in every mode.
    if (e.ctrlKey || e.altKey || keyHeld("KeyS") || keyHeld("KeyX")) return false;
    // A click on the line puts a node there (4.52 (2)), measured on the screen as a node is grabbed.
    const seg = PathUI.frame && Path.nearest(path, e.clientX, e.clientY, q => {
      const w = worldToScreen(PathUI.lift(q[0], q[1], q[2])); return [w.x, w.y]; });
    if (PathUI.onLine(seg, PathUI.GRAB)) return PathUI.insert(seg);
    const at = ray3d(e, true);
    if (!at) return false;
    if (path.closed) { setStatus("This path is closed — Esc starts a new one", "err"); return true; }
    if (!path.pts.length) PathUI.frame = Object.assign(projFrame(at), { dens: PathUI.densAt(at) });
    const q = PathUI.toPlane(at.point);
    Path.add(path, q.x, q.y).d = q.d;
    PathUI.sel = path.pts.length - 1;
    PathUI.drag = { kind: "handle", i: path.pts.length - 1, moved: false, fresh: true };
    PathUI.sync(); PathUI.redraw();
    return true;
  },
  // A node follows the surface under the pointer (and its plane, off the model); a handle is a
  // direction in the plane, so it takes the plane at its node's depth.
  move3d(e){
    const d = PathUI.drag, path = PathUI.path, n = d && path && path.pts[d.i];
    if (!n) { PathUI.drag = null; return; }
    d.moved = true;
    if (d.kind === "point") {
      const at = ray3d(e, true), q = at ? PathUI.toPlane(at.point) : PathUI.rayPlane(e, n.d);
      if (q) { n.x = q.x; n.y = q.y; n.d = q.d; }
    } else {
      const q = PathUI.rayPlane(e, n.d);
      if (q) Path.setHandle(path, d.i, d.kind, q.x, q.y);
    }
    PathUI.redraw();
  },
  // One raycast per move, only while the tool is on — the cost `movproj`'s hover already pays.
  hover3d(e){
    const over = !!(PathUI.grab3d(e) || ray3d(e, true));
    if (over !== PathUI.over3d) { PathUI.over3d = over; refreshViewCursor(); }
  },

  // ---- the projection ----
  // The beam that carries the path back onto the model: its bounding box in the plane, centred
  // between its nodes' depths, aimed back along n. `lim` is the projector's depth limit, set so the
  // whole reach is at full strength (the shader fades from 0.82 of it).
  beam(poly){
    const F = PathUI.frame, bb = Path.bounds(poly);
    let d0 = Infinity, d1 = -Infinity;
    for (const q of poly) { if (q[2] < d0) d0 = q[2]; if (q[2] > d1) d1 = q[2]; }
    const pad = 2 / F.dens;                          // two texels, so the image's edge cuts no rim
    const halfW = (bb.x1 - bb.x0) / 2 + pad, halfH = (bb.y1 - bb.y0) / 2 + pad;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, dc = (d0 + d1) / 2;
    const reach = (d1 - d0) / 2 + PathUI.DEPTH_MARGIN * Math.max(halfW, halfH) + 4 / F.dens;
    return { basis: { p: PathUI.lift(cx, cy, dc), n: F.n.clone(), t1: F.r.clone(), t2: F.u.clone().negate() },
             halfW, halfH, x0: cx - halfW, y1: cy + halfH, dc, lim: reach / .82 };
  },
  // The path as one fill — never a union of per-shape fills (§3, the canvas facts) — in an image of
  // the beam, one pixel per sheet texel it spans, capped at 4096 a side.
  image(poly, B){
    const F = PathUI.frame, k = Math.min(F.dens, 4096 / (2 * Math.max(B.halfW, B.halfH)));
    const w = Math.max(8, Math.ceil(2 * B.halfW * k)), h = Math.max(8, Math.ceil(2 * B.halfH * k));
    const c = mkCanvas(w, h), g = ctx2d(c), sx = w / (2 * B.halfW), sy = h / (2 * B.halfH);
    g.beginPath();
    poly.forEach((q, i) => { const x = (q[0] - B.x0) * sx, y = (B.y1 - q[1]) * sy; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.fillStyle = "#fff";
    g.fill();
    return c;
  },
  // Where the path lands on the active sheet, at w × h: a BINARY stencil (white, opaque or clear) and
  // the box it fills, or null when it lands nowhere. Hardened because the projector's coverage is
  // soft by design — a decal fades over a surface turning away and towards its depth limit, and the
  // canvas fallback's per-triangle clips seam at every shared edge — and a camouflage patch is a yes
  // or a no. At half: the same line `Marquee.canvasBits` and `fromMask` draw.
  cover3d(w, h){
    const s = App.activeSlot, path = PathUI.path;
    if (!s || !App.geomData) return null;
    const poly = Path.flatten(path, PathUI.TOL / PathUI.frame.dens), B = PathUI.beam(poly);
    // A decal-shaped source with no Look and no mirror: the projector reads exactly these fields.
    const src = { bmp: PathUI.image(poly, B), rot: 0, flip: false, sym2: false, surf: null,
                  depth: B.lim / Math.max(B.halfW, B.halfH), wrap: PROJ_WRAP_DEF };
    const c = mkCanvas(w, h);
    const res = renderProjection(c, src, null, s, false, B);
    const b = res.box;
    if (!res.drawn || !b) return null;
    const g = ctx2d(c), img = g.getImageData(b.x, b.y, b.w, b.h), d = img.data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const on = d[i + 3] >= 128 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = on;
      if (on) n++;
    }
    g.putImageData(img, b.x, b.y);
    return n ? { canvas: c, box: b, texels: n } : null;
  },

  // ---- the verbs ----
  // The sheet's Fill, with the projected stencil where its one `fill()` was: the same stroke, so the
  // same shield (selection, protected parts, the layer's Limit, the marquee), the Eraser, a mask
  // target, a layer made for it, and one undo step. The active sheet only, as every 3-D brush stroke.
  fillModel(){
    const path = PathUI.path, s = App.activeSlot;
    if (!path || path.pts.length < 3 || !path.closed) { setStatus("Close the path first — click its first point again", "err"); return; }
    if (!s || !s.composite) return;
    if (App.brush.tool === "height") { setStatus("Panel line carves along a stroke — it has no fill. Pick another tool.", "err"); return; }
    if (App.brush.tool === "retouch") { setStatus(PathUI.RETOUCH_FILL, "err"); return; }
    let cov = PathUI.cover3d(s.composite.width, s.composite.height);
    if (!cov) { setStatus(PathUI.MISSED, "err"); return; }
    if (!beginStroke(false, false)) return;            // says why itself
    stroke.undo.desc = "fill path";
    const c = stroke.t.canvas;
    // A layer's canvas need not be its sheet's size (a 4096 mask over a 2048 sheet): project again at
    // its own, rather than scale a binary stencil and soften it.
    if (c.width !== s.composite.width || c.height !== s.composite.height) cov = PathUI.cover3d(c.width, c.height);
    if (cov) {
      const b = cov.box, cg = ctx2d(cov.canvas);
      cg.globalCompositeOperation = "source-in"; cg.fillStyle = PathUI.inkFor(stroke.t); cg.fillRect(b.x, b.y, b.w, b.h);
      cg.globalCompositeOperation = "source-over";
      const g = ctx2d(stroke.buf);
      g.save();
      // One dab with nothing to overlap, so it lands at Opacity in a wash and with Build up alike.
      g.globalAlpha = stroke.dep.fill; g.globalCompositeOperation = "source-over";
      g.drawImage(cov.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
      PathUI.laid(g, b.x, b.y, b.x + b.w, b.y + b.h);
    }
    endStroke();
    draw2D();
    const L = activeLayerObj();
    setStatus(cov ? "Filled the path on “" + (L ? L.name : s.id) + "” — " + cov.texels + " texels, projected the way the view faced at its first point"
      : PathUI.MISSED, cov ? "ok" : "err");
  },
  MISSED: "The path lands on nothing here — it is over parts with no texture on the active slot, protected ones, or surfaces that face away from the view it was drawn in",
  // The brush along the path, each stamp found on the surface by a ray back along n from in front of
  // the path — inside the same depth window Fill projects through, so a stamp cannot land on a
  // surface Fill would not have reached. A sample whose ray meets nothing paintable is skipped.
  stampModel(){
    const path = PathUI.path, s = App.activeSlot, F = PathUI.frame;
    if (!path || path.pts.length < 2) { setStatus("Lay down at least two points first", "err"); return 0; }
    if (!s || !s.composite || !modelGroup) return 0;
    const poly = Path.flatten(path, PathUI.TOL / F.dens), B = PathUI.beam(poly);
    if (!beginStroke(false, true)) return 0;           // mask3d: the paint stays on the parts it lands on
    // Spacing is in the layer's texels; the frame's density is in the sheet's.
    const dens = F.dens * stroke.t.canvas.width / s.composite.width;
    const step = Math.max(1, App.brush.size * (App.brush.spacing || .35)) / dens;
    const pts = Path.walk(poly, step, path.closed);
    const back = F.n.clone().negate(), sym = symEnabled(), copies = radialCount();
    let laid = 0;
    for (const [i, q] of pts.entries()) {
      // Which way the path heads here, on the model — what a tip that follows the stroke turns by.
      const dir = F.r.clone().multiplyScalar(Math.cos(q.a)).addScaledVector(F.u, Math.sin(q.a));
      const o = PathUI.lift(q.x, q.y, B.dc + B.lim);
      const hs = new THREE.Raycaster(o, back, 0, 2 * B.lim).intersectObjects(paintTargets(), false);
      const hit = hs[0];
      if (!hit || !hit.uv) continue;
      laid++;
      // The copies read the global ray, as they do for a hand-drawn stroke (mirrorHit, radialHit).
      raycaster.ray.set(o, back);
      // How far along the path, in the layer's texels, for Colour along: the walk is a step a point.
      PathUI.stampCopies(hit, o, dir, sym, copies, i * step * dens);
    }
    endStroke();
    draw2D();
    setStatus(laid ? laid + " stamps along the path on the model" + (laid < pts.length ? " (" + (pts.length - laid) + " off it, skipped)" : "") +
      " — Spacing sets the gap" : PathUI.MISSED, laid ? "ok" : "err");
    return laid;
  },
  // One sample's dab and its mirrored and turned copies, each facing the way the path heads there —
  // reflected or turned with it — and each laid alone (`stamp3d`'s `alone`).
  stampCopies(hit, o, dir, sym, copies, run){
    const lay = [];
    const put = (h, ch, d) => { if (h && h.uv) { ensureStrokePart(h.object.name); stamp3d(h, ch, lay, d, run); } };
    put(hit, 0, dir);
    if (sym) put(mirrorHit(), 1, mirrorRay(o, dir).d);
    for (let k = 1; k < copies; k++) {
      const a = Radial.step(copies, k), rd = new THREE.Vector3().fromArray(Radial.rotateDir(dir.toArray(), App.radial.dir, a));
      put(radialHit(k), 2 * k, rd);
      if (sym) put(radialMirrorHit(k), 2 * k + 1, mirrorRay(o, rd).d);
    }
  },
  // The projected stencil as a selection — the lasso's own path into `Marquee`, from a canvas
  // instead of a polygon, with Shift adding and Alt taking away.
  selModel(e){
    const sh = Marquee.sheet();
    if (!sh) { setStatus("Open a texture slot first", "err"); return false; }
    const S = Marquee.dims(sh.W, sh.H), cov = PathUI.cover3d(S.w, S.h);
    if (!cov) { setStatus(PathUI.MISSED, "err"); return false; }
    const op = SelectUI.opOf(e), had = !!Marquee.rect(), b = cov.box;
    const bits = Marquee.canvasBits(cov.canvas, S, b.x, b.y, b.x + b.w, b.y + b.h);
    let ok = false;
    Marquee.act(op === "sub" ? "take the path out of the selection" : op === "add" ? "add the path to the selection" : "path → selection",
      () => { ok = Marquee.applyShape(bits, S, op); });
    SelectUI.said("path", op, had, ok);
    SelectUI.sync();
    draw2D();
    return ok === true;
  },
});
