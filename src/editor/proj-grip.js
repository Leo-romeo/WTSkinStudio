"use strict";
// ---------- A projected decal, handled directly — the maths both views share (ROADMAP 4.2) ----------
// Two requests of 2026-08-04/05 that stayed open behind the panel work: **handles in 3-D** — "corner
// handles and an aim indicator drawn in the viewport, so size and rotation are direct manipulation
// rather than sliders" — and **drag a projected decal in the 2-D view too**, where a projection could
// only be nudged from the keyboard because `movproj` exists in the viewport alone. They are one
// module because they turned out to be the same three facts:
//
//   * **The frame is exact.** `projBasis` gives the projector's own axes and `projHalfSize` its
//     half-extent, so the image's four corners, its top edge and its aim are vector sums of what the
//     projector itself renders from. Nothing here measures the model to find them, which is why a
//     handle cannot disagree with the pixels: it is an overlay, not new maths.
//   * **Size and angle are measured in the projector's own plane.** A pointer is a ray in 3-D and a
//     texel in 2-D; both become a point on the plane through the frame's centre, square to its beam.
//     From there a resize is a ratio along the grabbed corner's diagonal, and a turn is the angle swept
//     about the centre in the frame's r/u axes — the axes `P.rot` is defined against (`projBasis`). So
//     the knob stays under the pointer at any camera angle and on any UV layout, mirrored or not, and
//     a handle in 2-D and one in 3-D are literally the same drag.
//   * **"The surface under this texel" is a lookup, not a raycast.** A texel lies in one or more UV
//     triangles of its sheet, and the triangle that holds it, with its barycentric weights, gives the
//     exact point on the vehicle — the point a 3-D pointer over that texel would have hit. The index
//     is a grid over the sheet built once per sheet (`index`), so a drag pays a cell's worth of
//     point-in-triangle tests per move. Measured 2026-09-26 on 304 200 triangles over one 2048²
//     sheet (a curved panel cut into 12 parts, headless Chrome; pure JS, so the GPU flag does not
//     matter): the index takes **51 ms, once**, a lookup **1.6 µs**, and finding the triangle under
//     the frame's centre (`triAt`) **0.3 ms** median — against ~2.3 ms for ONE three.js raycast on
//     an A-10C (paint3d.js), which is what a per-move raycast from the sheet would have cost.
//
// A gesture is ONE undo step however many frames it spans, and re-projects live while it runs
// (`projLiveRender`, one render a frame); the drop re-renders for real, which is also what adds a
// layer on any sheet the decal has moved onto and rebuilds its Look — `updateProjGroup`, exactly
// what the 3-D drag has always ended with.
const ProjGrip = {
  KNOB: 26,               // the rotation knob stands this many screen pixels off the top edge (both views)
  MIN: 14,                // under this many screen pixels from centre to corner a decal carries no handles
  SNAP: 15,               // Shift turns in 15° steps — the grid Shift already snaps the , . keys to
  IN: 1e-6,               // barycentric slack: a texel on a shared edge belongs to either triangle
  G: 128,                 // the sheet index's cells per side
  CORNERS: [[-1, -1], [1, -1], [1, 1], [-1, 1]],   // image order: TL, TR, BR, BL — t2 runs DOWN the image
  g: null,                // the gesture in flight, or null
  _tri: null,             // the last centre-triangle answer, keyed on where the centre is
  // What a drop says when the decal went while it was held — deleted, or undone away (`updateProjGroup`
  // then puts nothing down). The 3-D body drag (paint3d.js `end3`) says the same.
  GONE: "The decal was removed while it was held (deleted or undone), so there is nothing to put down",

  // ---- which decal is in hand ----
  // The active layer when it is a projection, with painting off (the brush owns the pointer then) and
  // no click armed (that mode owns the click). ONE copy for both views: the viewport adds
  // only what is its own (`ProjHandles.target`: a model, the fly camera) and the sheet only what owns
  // ITS pointer (`Draw2D.projGeom`). The sheet had its own copy without the placing mode, and with
  // "Set centre…" armed it drew and took the handles the model had hidden (4.2's review, 2026-09-27).
  target(){
    if (App.paint3d || App.placing) return null;
    const L = activeLayerObj();
    return L && L.proj && L.proj.frame && L.proj.bmp ? L : null;
  },

  // ---- the frame, exactly as the projector uses it ----
  frame(P){
    const f = frameFromArrays(P.frame);
    const b = projBasis(f, P.rot, P.flip);
    const h = projHalfSize(P);
    return { p: b.p, n: b.n, r: f.r, u: f.u, t1: b.t1, t2: b.t2, halfW: h.halfW, halfH: h.halfH };
  },
  // A point of the projector's plane, `a` along the image's right axis and `b` down it, in metres.
  at(F, a, b){ return F.p.clone().addScaledVector(F.t1, a).addScaledVector(F.t2, b); },
  corners(F){ return ProjGrip.CORNERS.map(([x, y]) => ProjGrip.at(F, x * F.halfW, y * F.halfH)); },
  top(F){ return ProjGrip.at(F, 0, -F.halfH); },
  // Where a ray meets that plane. A plane seen edge-on has no point under the pointer worth having
  // — the answer runs off towards infinity — so such a move is ignored rather than turned into a
  // resize to the horizon.
  onPlane(F, o, d){
    const den = d.dot(F.n);
    if (!(Math.abs(den) >= .02 * d.length())) return null;
    return o.clone().addScaledVector(d, F.p.clone().sub(o).dot(F.n) / den);
  },
  // A plane point's angle about the centre, in degrees, in the r/u axes `P.rot` turns t1 away from.
  angle(F, q){ const v = q.clone().sub(F.p); return Math.atan2(v.dot(F.u), v.dot(F.r)) * 180 / Math.PI; },
  // Whether surface point `q` is inside the beam: within the image's rectangle across the plane and
  // the Depth's reach along it — for the decal, or for its mirrored copy when that is on. This is what
  // "on the decal" means for a press in 3-D. Its texels alone are not: a sheet shares texels between
  // places on the model (a UV island used twice), so the projector's pixels also show far from where
  // it points, and a press there used to grab the decal and throw its centre across the vehicle
  // (reported 2026-10-17 on the A-10C). And inside the frame they are not needed: a press on a part
  // the image did not paint — a sheet not loaded, a gap in the image — is still a press on the decal.
  reaches(P, q){
    if (!P || !P.frame || !P.bmp || !q) return false;
    const F = ProjGrip.frame(P), lim = projDepthLim(P, F.halfW, F.halfH), m = 1.02;
    const inside = b => {
      const v = q.clone().sub(b.p);
      return Math.abs(v.dot(b.t1)) <= F.halfW * m && Math.abs(v.dot(b.t2)) <= F.halfH * m && Math.abs(v.dot(b.n)) <= lim;
    };
    const b = { p: F.p, n: F.n, t1: F.t1, t2: F.t2 };
    return inside(b) || (!!P.sym2 && inside(mirrorBasis(b, false)));
  },

  // ---- the gesture: begin, drag, end ----
  // `kind` is "scale" (a corner — `opt.corner` says which), "rot" (the knob) or "move" (the body, 2-D).
  // `q` is where the press met the plane; a move starts from a texel instead (`grabSheet`).
  begin(P, kind, q, opt){
    opt = opt || {};
    commitProjEdit();                                   // a keyboard edit still open is its own step
    const F = ProjGrip.frame(P);
    const g = { P, kind, F, q0: q, from: projParamsClone(P), s0: P.scale, r0: P.rot,
                view: opt.view || "3d", sf: opt.sf || null, handle: opt.handle || null, moved: false };
    if (kind === "scale") {
      const c = ProjGrip.corners(F)[opt.corner || 0];
      g.dir = c.clone().sub(F.p).normalize();
      // Measured from where the press landed rather than from the corner itself, so the size does
      // not jump by the few pixels between the two on the first move.
      g.d0 = q ? q.clone().sub(F.p).dot(g.dir) : 0;
      if (!(g.d0 > 1e-9)) g.d0 = c.distanceTo(F.p);
    }
    if (kind === "rot") g.a0 = q ? ProjGrip.angle(F, q) : 0;
    ProjGrip.g = g;
    App.projDragging = true;                            // the footprint ring waits for the drop (SelOverlay)
    return g;
  },
  // A resize or a turn, to plane point `q`. Shift snaps a turn to the 15° grid.
  drag(q, snap){
    const g = ProjGrip.g;
    if (!g || !q || (g.kind !== "scale" && g.kind !== "rot")) return false;
    const P = g.P;
    if (g.kind === "scale") {
      // Along the grabbed corner's own diagonal: a pointer wandering sideways does not resize, and
      // past the centre the decal bottoms out at the Size slider's own minimum — the range the
      // keyboard resize clamps to as well (ProjSource).
      const d = q.clone().sub(g.F.p).dot(g.dir);
      P.scale = Math.max(ProjSource.SCALE_MIN, Math.min(ProjSource.SCALE_MAX, g.s0 * d / g.d0));
    } else {
      let r = g.r0 + ProjGrip.angle(g.F, q) - g.a0;
      if (snap) r = Math.round(r / ProjGrip.SNAP) * ProjGrip.SNAP;
      r = ((r + 180) % 360 + 360) % 360 - 180;
      P.rot = Math.round(r * 10) / 10;                  // a tenth of a degree, the finest the panel shows
    }
    g.moved = true;
    syncProjUI();
    projLiveRender(P);
    return true;
  },
  // The drop: one undo step for the whole gesture, and the real render. Returns what was done, or
  // null when there was no gesture.
  end(){
    const g = ProjGrip.g;
    ProjGrip.g = null;
    App.projDragging = false;
    if (!g) return null;
    // A press that never moved changed nothing and re-rendered nothing, so there is nothing to settle.
    if (!g.moved) return { g, res: null };
    const what = g.kind === "scale" ? "resize projected decal" : g.kind === "rot" ? "rotate projected decal" : "move projected decal";
    const res = updateProjGroup(g.P, what, g.from);
    const P = g.P;
    setStatus(res.gone ? ProjGrip.GONE
      : !res.drawn ? "Nothing hit here — the decal is off the model or facing away; Re-aim from this view points it at the camera"
      : g.kind === "scale" ? "Resized to " + P.scale.toFixed(2) + " — Ctrl+Z puts it back"
      : g.kind === "rot" ? "Turned to " + P.rot + "° — Ctrl+Z puts it back"
      : "Moved — it lands on " + res.sheets + " texture" + (res.sheets === 1 ? "" : "s"), res.drawn || res.gone ? "ok" : "err");
    return { g, res };
  },

  // ---- the 3-D view: a press on a handle, and its drag ----
  // ProjHandles draws the handles and knows where they are on screen; this turns the press into a
  // point on the projector's plane and starts the gesture.
  press3d(e){
    const h = ProjHandles.hit(e.clientX, e.clientY);
    if (!h) return false;
    const P = ProjHandles.shown.P, r = ProjHandles.ray(e);
    const q = ProjGrip.onPlane(ProjGrip.frame(P), r.o, r.d);
    if (!q) return false;
    ProjGrip.begin(P, h.kind, q, { corner: h.i, view: "3d", handle: h });
    return true;
  },
  drag3d(e){
    const g = ProjGrip.g;
    if (!g) return false;
    const r = ProjHandles.ray(e);
    return ProjGrip.drag(ProjGrip.onPlane(g.F, r.o, r.d), e.shiftKey);
  },

  // ---- the 2-D view: the body's drag ----
  // The centre follows the pointer with the offset it was grabbed at, in SHEET texels — the same
  // "hold the point you grabbed" the flat decal's drag keeps — and lands on the surface under that
  // texel. It keeps its aim: the frame's point moves and its axes do not, exactly as a drag on the
  // model does, so a decal dragged onto a panel facing elsewhere projects onto nothing until it is
  // re-aimed, and the drop says so.
  grabSheet(P, slot, x, y){
    const SF = ProjGrip.sheetFrame(P, slot);
    const g = ProjGrip.begin(P, "move", null, { view: "2d", sf: SF });
    g.slot = slot;
    g.off = SF ? { x: SF.c.x - x, y: SF.c.y - y } : { x: 0, y: 0 };   // a centre on another sheet: follow the pointer
    return g;
  },
  dragSheet(x, y){
    const g = ProjGrip.g;
    if (!g || g.kind !== "move") return false;
    const hit = ProjGrip.surfaceAt(g.slot, x + g.off.x, y + g.off.y, frameFromArrays(g.P.frame).p);
    if (!hit) return false;                // over the gutter between islands: it waits where it was
    g.hit = hit;                           // the centre's triangle, known — `centreTri` needs no scan
    g.moved = true;
    moveProjTo(g.P, hit.point, true);
    return true;
  },

  // ---- the sheet: which surface is under a texel ----
  // This sheet's parts that have UVs to find — the same material→slot rule the projector draws by.
  groups(slot){
    const out = [];
    for (const gd of App.geomData || []) {
      if (App.matSlot.get(gd.mat) !== slot.id || !gd.uv || !gd.position) continue;
      const m = App.meshes.get(gd.name);
      if (m && m.userData && m.userData.effect) continue;
      out.push(gd);
    }
    return out;
  },
  // Every triangle filed under each G×G cell of the sheet its UVs touch — once per whole-sheet tile
  // it crosses, so a tiled part is found on every repeat (ROADMAP 4.23(a)'s rule, `uvTileRange`).
  // Built once per sheet and geometry, in two passes over typed arrays (count, then fill), and kept
  // on the slot beside the other per-sheet caches. Visibility is read at lookup time, not here,
  // because hiding a part is not a reason to rebuild.
  index(slot){
    const flipV = $("optFlipV").checked;
    const c = slot._projFind;
    if (c && c.geo === App.geomData && c.flipV === flipV) return c;
    const groups = ProjGrip.groups(slot), G = ProjGrip.G;
    const walk = put => {
      for (let gi = 0; gi < groups.length; gi++) {
        const uv = groups[gi].uv, n = (uv.length / 6) | 0;
        for (let t = 0; t < n; t++) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let k = 0; k < 3; k++) {
            const x = uv[t * 6 + k * 2], v = uv[t * 6 + k * 2 + 1], y = flipV ? v : 1 - v;   // sheet rows run down
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          if (!(x1 >= x0 && y1 >= y0)) continue;                                            // NaN UVs
          const [ax, bx] = uvTileRange(x0, x1), [ay, by] = uvTileRange(y0, y1);
          for (let ty = ay; ty <= by; ty++) for (let tx = ax; tx <= bx; tx++) {
            const cx0 = Math.max(0, Math.floor((x0 - tx) * G)), cx1 = Math.min(G - 1, Math.floor((x1 - tx) * G));
            const cy0 = Math.max(0, Math.floor((y0 - ty) * G)), cy1 = Math.min(G - 1, Math.floor((y1 - ty) * G));
            for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) put(cy * G + cx, gi, t, tx, ty);
          }
        }
      }
    };
    const head = new Int32Array(G * G + 1);
    walk(cell => { head[cell + 1]++; });
    for (let i = 1; i <= G * G; i++) head[i] += head[i - 1];
    const total = head[G * G], fill = head.slice(0, G * G);
    const grp = new Int32Array(total), tri = new Int32Array(total), TX = new Int16Array(total), TY = new Int16Array(total);
    walk((cell, gi, t, tx, ty) => { const k = fill[cell]++; grp[k] = gi; tri[k] = t; TX[k] = tx; TY[k] = ty; });
    return (slot._projFind = { geo: App.geomData, flipV, G, head, grp, tri, TX, TY, groups });
  },
  // The point on the vehicle under sheet texel (x, y), or null over the gutter. Where several
  // surfaces share the texel — a UV island used twice — the one nearest `near` wins, so a drag stays
  // on the side it started on. Returns the triangle and its weights too, for `mapAt`.
  surfaceAt(slot, x, y, near){
    if (!slot || !slot.composite || !App.geomData) return null;
    const W = slot.composite.width, H = slot.composite.height, X = x / W, Y = y / H;
    if (!(X >= 0 && X < 1 && Y >= 0 && Y < 1)) return null;
    const I = ProjGrip.index(slot), G = I.G, flipV = I.flipV, IN = ProjGrip.IN;
    const cell = Math.min(G - 1, (Y * G) | 0) * G + Math.min(G - 1, (X * G) | 0);
    let best = null, bd = Infinity;
    for (let k = I.head[cell]; k < I.head[cell + 1]; k++) {
      const gd = I.groups[I.grp[k]], mesh = App.meshes.get(gd.name);
      if (mesh && !mesh.visible) continue;                       // not on screen, and not projected onto
      const t = I.tri[k], uv = gd.uv, o = t * 6, tx = I.TX[k], ty = I.TY[k];
      const X0 = uv[o] - tx, X1 = uv[o + 2] - tx, X2 = uv[o + 4] - tx;
      const Y0 = (flipV ? uv[o + 1] : 1 - uv[o + 1]) - ty, Y1 = (flipV ? uv[o + 3] : 1 - uv[o + 3]) - ty,
            Y2 = (flipV ? uv[o + 5] : 1 - uv[o + 5]) - ty;
      const d = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
      if (!d) continue;
      const w1 = ((X - X0) * (Y2 - Y0) - (X2 - X0) * (Y - Y0)) / d, w2 = ((X1 - X0) * (Y - Y0) - (X - X0) * (Y1 - Y0)) / d;
      const w0 = 1 - w1 - w2;
      if (w0 < -IN || w1 < -IN || w2 < -IN) continue;
      const pos = gd.position, q = t * 9;
      const px = w0 * pos[q] + w1 * pos[q + 3] + w2 * pos[q + 6];
      const py = w0 * pos[q + 1] + w1 * pos[q + 4] + w2 * pos[q + 7];
      const pz = w0 * pos[q + 2] + w1 * pos[q + 5] + w2 * pos[q + 8];
      const dd = near ? (px - near.x) ** 2 + (py - near.y) ** 2 + (pz - near.z) ** 2 : 0;
      if (dd < bd) { bd = dd; best = { point: new THREE.Vector3(px, py, pz), gd, t, w: [w0, w1, w2] }; if (!near) break; }
    }
    return best;
  },

  // ---- the sheet: where the frame is on it ----
  // The triangle the frame's centre sits ON — exactly, because the centre is always a surface point
  // (a hit, a clicked spot, or `surfaceAt`'s own answer). A scan with each part's box as the first
  // reject; `centreTri` keeps the answer until the centre moves, so it runs once per move of the
  // decal and never per frame. Where the centre is on an edge two triangles share, the one facing the
  // beam wins, since that is the one the projector paints.
  triAt(slot, p, n){
    const dm = App.modelSize ? Math.max(App.modelSize.x, App.modelSize.y, App.modelSize.z) : 10;
    const eps = Math.max(1e-6, dm * 1e-5);
    let best = null, bestF = -Infinity;
    for (const gd of ProjGrip.groups(slot)) {
      const mesh = App.meshes.get(gd.name);
      if (mesh && !mesh.visible) continue;
      const bb = gdBounds(gd);
      if (p.x < bb.x0 - eps || p.x > bb.x1 + eps || p.y < bb.y0 - eps || p.y > bb.y1 + eps || p.z < bb.z0 - eps || p.z > bb.z1 + eps) continue;
      const pos = gd.position, nt = (pos.length / 9) | 0;
      for (let t = 0; t < nt; t++) {
        const o = t * 9, ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
        const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5], cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
        if (p.x < Math.min(ax, bx, cx) - eps || p.x > Math.max(ax, bx, cx) + eps ||
            p.y < Math.min(ay, by, cy) - eps || p.y > Math.max(ay, by, cy) + eps ||
            p.z < Math.min(az, bz, cz) - eps || p.z > Math.max(az, bz, cz) + eps) continue;
        const w = ProjGrip.bary(ax, ay, az, bx, by, bz, cx, cy, cz, p, eps);
        if (!w) continue;
        const face = n ? w.m.dot(n) : 0;
        if (face > bestF) { bestF = face; best = { gd, t, w: w.w }; }
      }
    }
    return best;
  },
  // Barycentric weights of `p` in a triangle, or null when it is off the triangle's plane (by more
  // than `eps`) or outside it. `m` is the unit normal, in the winding's own sense.
  bary(ax, ay, az, bx, by, bz, cx, cy, cz, p, eps){
    const e1 = new THREE.Vector3(bx - ax, by - ay, bz - az), e2 = new THREE.Vector3(cx - ax, cy - ay, cz - az);
    const m = e1.clone().cross(e2), ml = m.length();
    if (!(ml > 1e-12)) return null;
    m.divideScalar(ml);
    const q = new THREE.Vector3(p.x - ax, p.y - ay, p.z - az);
    if (Math.abs(q.dot(m)) > eps) return null;
    const e11 = e1.dot(e1), e12 = e1.dot(e2), e22 = e2.dot(e2), det = e11 * e22 - e12 * e12;
    const q1 = q.dot(e1), q2 = q.dot(e2);
    const w1 = (q1 * e22 - q2 * e12) / det, w2 = (e11 * q2 - e12 * q1) / det, w0 = 1 - w1 - w2;
    const T = 1e-4;
    return (w0 < -T || w1 < -T || w2 < -T) ? null : { w: [w0, w1, w2], m };
  },
  centreTri(slot, F){
    const g = ProjGrip.g;
    if (g && g.hit && g.slot === slot && g.hit.point.equals(F.p)) return g.hit;
    const key = slot.id + "|" + F.p.x + "," + F.p.y + "," + F.p.z + "|" + F.n.x + "," + F.n.y + "," + F.n.z + "|" + ($("optFlipV").checked ? "F" : "N");
    const C = ProjGrip._tri;
    if (C && C.key === key && C.geo === App.geomData) return C.val;
    const val = ProjGrip.triAt(slot, F.p, F.n);
    ProjGrip._tri = { key, geo: App.geomData, val };
    return val;
  },
  // The frame on this sheet: the centre's texel `c`, and the linear map `J` from the projector's plane
  // (metres along t1, t2) to sheet texels around it — so a corner is c + J·(±halfW, ±halfH). A plane
  // step slides along the beam onto the triangle under the centre and is read in that triangle's UVs.
  // That is exact on the triangle, and so across any flat panel; where the surface curves away it is
  // the tangent-plane estimate, which is right for a handle — the pixels are the projector's, not
  // this. Null when the centre is not on this sheet, or the beam grazes the surface under it.
  sheetFrame(P, slot){
    if (!P || !P.frame || !P.bmp || !slot || !slot.composite) return null;
    const F = ProjGrip.frame(P);
    const h = ProjGrip.centreTri(slot, F);
    return h ? ProjGrip.mapAt(F, slot, h) : null;
  },
  mapAt(F, slot, h){
    const W = slot.composite.width, H = slot.composite.height, flipV = $("optFlipV").checked;
    const pos = h.gd.position, uv = h.gd.uv, o = h.t * 9, u = h.t * 6;
    const V = [0, 1, 2].map(k => new THREE.Vector3(pos[o + k * 3], pos[o + k * 3 + 1], pos[o + k * 3 + 2]));
    const S = [0, 1, 2].map(k => [uv[u + k * 2] * W, (flipV ? uv[u + k * 2 + 1] : 1 - uv[u + k * 2 + 1]) * H]);
    const e1 = V[1].clone().sub(V[0]), e2 = V[2].clone().sub(V[0]);
    const m = e1.clone().cross(e2).normalize();
    const nm = F.n.dot(m);
    if (!(Math.abs(nm) >= .05)) return null;
    const e11 = e1.dot(e1), e12 = e1.dot(e2), e22 = e2.dot(e2), det = e11 * e22 - e12 * e12;
    if (!(Math.abs(det) > 1e-18)) return null;
    const d1 = [S[1][0] - S[0][0], S[1][1] - S[0][1]], d2 = [S[2][0] - S[0][0], S[2][1] - S[0][1]];
    const inTri = w => {
      const al = (w.dot(e1) * e22 - w.dot(e2) * e12) / det, be = (e11 * w.dot(e2) - e12 * w.dot(e1)) / det;
      return [al * d1[0] + be * d2[0], al * d1[1] + be * d2[1]];
    };
    // one plane step, slid along the beam onto the triangle's plane: w = a − n (a·m)/(n·m)
    const col = a => inTri(a.clone().addScaledVector(F.n, -a.dot(m) / nm));
    const j1 = col(F.t1), j2 = col(F.t2);
    const J = [j1[0], j2[0], j1[1], j2[1]], dJ = J[0] * J[3] - J[1] * J[2];
    if (!(Math.abs(dJ) > 1e-12)) return null;
    const c0 = inTri(F.p.clone().sub(V[0]));
    let cx = S[0][0] + c0[0], cy = S[0][1] + c0[1];
    // A tiled part puts the centre on a repeat past the sheet's edge; every repeat shows these texels.
    cx -= Math.floor(cx / W) * W; cy -= Math.floor(cy / H) * H;
    return { F, c: { x: cx, y: cy }, J, Ji: [J[3] / dJ, -J[1] / dJ, -J[2] / dJ, J[0] / dJ] };
  },
  // ---- one decal, two placements (2026-10-17) ----
  // "Decal and projected image should not be two completely separate things": a decal switches
  // between On the model and On the texture in place, keeping where it is, its size and its turn.
  // Both directions are the plane↔sheet map at the centre, so they are exact on a flat panel and
  // the tangent-plane estimate on a curved one — the same answer the sheet's handles already give.
  //
  // The turn (and mirror) nearest a 2×2 map [[a, b], [c, d]] whose columns are where an image's right
  // and down axes go, y running down. Where the sheet stretches the surface unevenly the two axes
  // disagree about the angle, and a flat decal can only turn and scale, so the closest such map is
  // the answer — read from one axis alone it was 22° on a 30° plate (t100, 2026-10-17). A negative
  // determinant is a mirror image: the fit is a reflection, and that is a flip.
  similar(a, b, c, d){
    const det = a * d - b * c, mirror = det < 0;
    // turn: [[cos, −sin], [sin, cos]]; flipped (x negated): [[−cos, −sin], [−sin, cos]]
    const rot = mirror ? Math.atan2(-(c + b) / 2, -(a - d) / 2) : Math.atan2((c - b) / 2, (a + d) / 2);
    return { rot: rot * 180 / Math.PI, mirror, det };
  },
  // A projected decal as a flat one on `slot`. The flat decal draws image pixel (i, j) at
  // R(rot)·(±s·i, s·j) on the sheet (the compositor's stamp; `decalAtUV` inverts it); the projector
  // puts it at J·(m·i, m·j), m metres per pixel — 2k, `projHalfSize`'s k being per HALF pixel
  // (halfW = k·width; a test measured the flat copy at a quarter of the area before that was read
  // right, 2026-10-17). So J's columns, times m, ARE the flat decal's axes:
  // the down axis gives the turn whatever the handedness, and a negative determinant is a flip.
  flatOf(P, slot){
    const SF = ProjGrip.sheetFrame(P, slot);
    if (!SF) return null;
    const { k } = projHalfSize(P), J = SF.J, det = J[0] * J[3] - J[1] * J[2];
    const fit = ProjGrip.similar(J[0], J[1], J[2], J[3]);
    return { x: SF.c.x / slot.composite.width, y: SF.c.y / slot.composite.height,
             rot: Math.round(fit.rot * 10) / 10, flip: fit.mirror, scale: 2 * k * Math.sqrt(Math.abs(det)) };
  },
  // …and back: the projector that puts a flat decal on `slot` exactly where it is drawn — aimed
  // straight down the surface normal under its centre, its axes the image's own axes carried from
  // the sheet onto that triangle. The frame's r/u are the plane's "up" (world Y, or Z on a surface
  // facing up or down), so the Rotate slider reads an angle against something stable rather than 0.
  // Null when the centre is over the gutter between islands.
  frameOfFlat(L, slot){
    if (!L || !L.bmp || !slot || !slot.composite) return null;
    const W = slot.composite.width, H = slot.composite.height;
    const hit = ProjGrip.surfaceAt(slot, L.x * W, L.y * H, camera ? camera.position : null);
    if (!hit) return null;
    const flipV = $("optFlipV").checked, gd = hit.gd, o = hit.t * 9, u6 = hit.t * 6;
    const V = [0, 1, 2].map(i => new THREE.Vector3(gd.position[o + i * 3], gd.position[o + i * 3 + 1], gd.position[o + i * 3 + 2]));
    const S = [0, 1, 2].map(i => [gd.uv[u6 + i * 2] * W, (flipV ? gd.uv[u6 + i * 2 + 1] : 1 - gd.uv[u6 + i * 2 + 1]) * H]);
    const e1 = V[1].clone().sub(V[0]), e2 = V[2].clone().sub(V[0]);
    const d1 = [S[1][0] - S[0][0], S[1][1] - S[0][1]], d2 = [S[2][0] - S[0][0], S[2][1] - S[0][1]];
    const dd = d1[0] * d2[1] - d2[0] * d1[1];
    if (!(Math.abs(dd) > 1e-12)) return null;
    const world = (x, y) => e1.clone().multiplyScalar((x * d2[1] - d2[0] * y) / dd).addScaledVector(e2, (d1[0] * y - x * d1[1]) / dd);
    const n = e1.clone().cross(e2).normalize();
    // outward: the side the vertex normals face, or failing those the camera's
    let side = null;
    if (gd.normal) side = [0, 1, 2].reduce((a, i) => a.addScaledVector(new THREE.Vector3(gd.normal[o + i * 3], gd.normal[o + i * 3 + 1], gd.normal[o + i * 3 + 2]), hit.w[i]), new THREE.Vector3());
    if (!side || side.lengthSq() < 1e-12) side = camera.position.clone().sub(hit.point);
    if (n.dot(side) < 0) n.negate();
    const a = L.rot * Math.PI / 180, s = L.scale, fs = L.flip ? -1 : 1;
    const WR = world(fs * s * Math.cos(a), fs * s * Math.sin(a)), WD = world(-s * Math.sin(a), s * Math.cos(a));
    const flat = v => v.clone().addScaledVector(n, -v.dot(n));
    if (!(flat(WR).lengthSq() > 1e-18 && flat(WD).lengthSq() > 1e-18)) return null;
    let up = flat(new THREE.Vector3(0, 1, 0));
    if (up.lengthSq() < .01) up = flat(new THREE.Vector3(0, 0, 1));
    up.normalize();
    const r = up.clone().cross(n);                               // r × u = n, as the camera's are
    // The image's two axes in the plane's (r, −u) — "down" is −u — fitted to the projector's
    // t1 = ±(r cos + u sin), t2 = r sin − u cos, which in (r, −u) is the rotation by −rot, mirrored
    // across r when flipped. A sheet that mirrors the surface makes the fit a reflection: the flip.
    const fit = ProjGrip.similar(WR.dot(r), WD.dot(r), -WR.dot(up), -WD.dot(up));
    const flip = fit.mirror, rot = Math.round(-fit.rot * 10) / 10;
    const k = Math.sqrt(Math.abs(fit.det));                       // metres per image pixel, area-true
    const diag = App.modelSize ? Math.max(App.modelSize.x, App.modelSize.y, App.modelSize.z) : 10;
    const scale = k / 2 * (L.srcW || L.bmp.width) / (diag * .12);        // projHalfSize's k is per half pixel
    return { frame: { p: hit.point.toArray(), n: n.toArray(), r: r.toArray(), u: up.toArray() }, rot, flip, scale };
  },
  // The flat decal's spot on `slot` for a world point and the surface's facing there — how a
  // mirrored projected copy becomes the flat decal's own mirrored copy (`L.sym`).
  uvAt(slot, p, n){
    const h = ProjGrip.triAt(slot, p, n);
    if (!h) return null;
    const flipV = $("optFlipV").checked, uv = h.gd.uv, u6 = h.t * 6;
    let x = 0, y = 0;
    for (let i = 0; i < 3; i++) { x += h.w[i] * uv[u6 + i * 2]; y += h.w[i] * (flipV ? uv[u6 + i * 2 + 1] : 1 - uv[u6 + i * 2 + 1]); }
    return { x: x - Math.floor(x), y: y - Math.floor(y) };
  },

  // plane offset (a, b) → sheet texel, and back
  toSheet(SF, a, b){ return { x: SF.c.x + SF.J[0] * a + SF.J[1] * b, y: SF.c.y + SF.J[2] * a + SF.J[3] * b }; },
  fromSheet(SF, x, y){
    const dx = x - SF.c.x, dy = y - SF.c.y;
    return ProjGrip.at(SF.F, SF.Ji[0] * dx + SF.Ji[1] * dy, SF.Ji[2] * dx + SF.Ji[3] * dy);
  },
};
