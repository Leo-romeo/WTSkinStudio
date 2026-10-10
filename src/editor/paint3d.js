// ---------- Painting in 3D across UV seams ----------
// Two things went wrong when a stroke crossed a UV island border, even inside one part.
//
// The stamp positions are texture pixels, and stampAt joins each one to the previous with a line.
// In 3-D the pointer moves smoothly over the surface, but the moment it steps across a seam the
// UVs jump to wherever the other island happens to sit on the sheet — so that "line" was drawn
// straight across the texture, painting a streak through unrelated islands. The old guard (a gap
// wider than ten brush diameters must be a jump, so stamp a single dot) both mis-fired on
// deliberate long strokes and, when it did fire, left the real gap unpainted: the pale straight
// lines along island borders.
//
// The fix is to stop guessing from the texture and use what the geometry knows.
//   1. faceTexelDensity gives texels per world unit for the triangle that was hit, straight from
//      its own positions and UVs. Multiplied by the distance actually travelled on the surface it
//      says how far the stamp *should* have moved on the sheet; several times that means the
//      island changed, and nothing is interpolated.
//   2. A pointer move is then walked in small screen-space steps, each one raycast for its own
//      surface point. Every sub-step is a real hit with real UVs, so the gap on both sides of the
//      seam is filled properly instead of being bridged or skipped. The step length comes from the
//      measured screen-pixels-per-texel, so a big brush or a distant model costs few raycasts.
function faceTexelDensity(hit, tw, th){
  const f = hit.face, geo = hit.object && hit.object.geometry;
  if (!f || !geo) return 0;
  const P = geo.attributes.position, U = geo.attributes.uv;
  if (!P || !U) return 0;
  const px = P.getX(f.a), py = P.getY(f.a), pz = P.getZ(f.a);
  const au = U.getX(f.a) * tw, av = U.getY(f.a) * th;
  let L = 0, T = 0;
  for (const i of [f.b, f.c]) {
    L += Math.hypot(P.getX(i) - px, P.getY(i) - py, P.getZ(i) - pz);
    T += Math.hypot(U.getX(i) * tw - au, U.getY(i) * th - av);
  }
  return L > 1e-9 ? T / L : 0;
}
// `laid` lists the channels this sub-step has already stamped, and is how a COPY — the mirror, a
// turned copy, a turned copy's mirror — finds out that it is not one. Where a part and its twin paint
// from the same texels, which 242 of 435 mirrored pairs over 14 vehicles do and all 22 of the M4A1's
// (editor/mirror.js), the reflected ray lands on the texel the stroke has just painted; so does every
// turned copy on a wheel whose spokes share one strip. Laid again, that is the same dab twice in one
// stroke buffer: at Flow f a texel gains 1 − (1 − f)² a pass instead of f. Found in review of
// 4.50 (4) on 2026-09-26; through these handlers at Flow 30 % (t95) a stroke's centre read 131 with
// Symmetry off, 194 with it on and 252 with three turned copies and their mirrors, and with Build up
// 71 against 122. A hard dab laid at alpha 1, as before Flow, saturated and hid it — but a soft
// brush's edge showed it since the mirror existed, and a Panel line, whose height field adds at any
// Flow, came out twice as deep.
//
// How close is "the same", measured with `tools/mirror_uv.mjs` over those 242 pairs and with the
// plane the app actually uses (the median of every pair's midpoint, not the pair's own): the
// reflected hit lands p50 0.005, p99 0.78 and at worst 0.90 texels from the stroke's own at 2048²,
// twice that at 4096² (one mis-named pylon on the F-15E is the only pair further out, by metres).
// Sharing is exact or it is not there at all, so `Pen.same` needs only 1/1024 of the sheet. A copy
// inside it is not laid: it takes that channel's last dab as its own, so that where the two part
// company — the stroke runs off the shared pair — the copy walks on from where they last agreed.
//
// `alone`, a world-space direction, lays the dab on its own facing that way on the model — the shape
// tool's Stamp along on the model (6.1b), whose stamps are spaced by the path and must not be joined
// by the line stampAt would otherwise walk from the channel's last dab.
function stamp3d(hit, ch, laid, alone){
  const tc = stroke.t.canvas;
  const px = hit.uv.x * tc.width, py = (1 - hit.uv.y) * tc.height;
  const prev = stroke.hits[ch];
  const dens = faceTexelDensity(hit, tc.width, tc.height);
  const here = { p: hit.point.clone(), px, py, dens: dens || (prev ? prev.dens : 0) };
  const twin = laid ? Pen.same(laid, stroke.hits, px, py, Pen.size(App.brush, stroke.p) / 2, Math.max(tc.width, tc.height)) : -1;
  if (twin >= 0) {
    stroke.lasts[ch] = stroke.lasts[twin];
    stroke.hits[ch] = here;
    recStrokeCount("shared");
    return;
  }
  // The way from `a` to `z` ON THE MODEL, read in the hit island's own UV frame as a sheet angle.
  const headOn = (a0, z0) => {
    const f = hit.face, geo = hit.object.geometry, P = geo.attributes.position, U = geo.attributes.uv;
    if (!f || !P || !U) return null;
    const a = hit.object.worldToLocal(a0.clone()), z = hit.object.worldToLocal(z0.clone());
    const at = i => [P.getX(i), P.getY(i), P.getZ(i)], uv = i => [U.getX(i), U.getY(i)];
    return Pen.faceHeading([z.x - a.x, z.y - a.y, z.z - a.z], at(f.a), at(f.b), at(f.c), uv(f.a), uv(f.b), uv(f.c), tc.width, tc.height);
  };
  let opt = null;
  if (alone) opt = { jump: true, ang: alone.isVector3 ? headOn(hit.point.clone().sub(alone), hit.point) : null };
  else if (stroke.line) opt = { line: true };       // Shift+click: the user asked for the line
  else if (prev) {
    const d3 = prev.p.distanceTo(hit.point);
    const scale = dens || prev.dens;                 // an unmeasurable face keeps the last estimate
    const dtex = Math.hypot(px - prev.px, py - prev.py);
    // 2.5× leaves room for the seam-adjacent triangle being stretched relative to its neighbour;
    // below a couple of brush radii nothing visible can go wrong either way.
    if (scale && dtex > Math.max(2 * App.brush.size, d3 * scale * 2.5 + 4)) {
      // The dab past the seam faces the way the stroke moved ON THE MODEL, read in this island's own
      // UV frame — the way it last ran on the sheet is a way on the island it left (4.50 (10)'s review).
      opt = { jump: true, ang: headOn(prev.p, hit.point) };
    }
  }
  stampAt(px, py, ch, opt);
  stroke.hits[ch] = here;
  if (laid) laid.push(ch);
}
// How far apart to place the raycast sub-steps of one pointer move, in screen pixels: measured
// rather than assumed, and clamped so a fast flick over a small brush cannot ask for hundreds of
// raycasts.
//
// SUB-STEPS ARE NOT STAMPS, and tying them to the brush's stamp spacing was the mistake. A sub-step
// exists to FOLLOW THE SURFACE — to notice a UV seam or a curve between two pointer positions.
// Stamps are laid by stampAt, which interpolates in texture space between hits, so making stamps
// finer costs almost nothing. Making RAYCASTS finer costs everything: each one is an
// intersectObjects over every visible part, and with symmetry on there are two of them per step.
//
// A session of 2026-08-23 (A-10C, 160 parts, brush 128, spacing 5 %, symmetry on) is what
// found this: 16 seconds of painting, 126 dropped frames, worst 354 ms, and three strokes asking
// for 454, 245 and 1500 sub-steps — up to 20.6 per pointer move, pinned against the cap. At about
// 2.3 ms a raycast that is the whole stall. Spacing at 5 % asked for seven times the raycasts of
// the default 35 % while painting exactly the same pixels.
//
// So the factor is fixed at what the DEFAULT spacing used to give. Nothing gets coarser than it
// was, and a fine spacing no longer multiplies the cost of moving the mouse.
const PAINT_SUB_MIN = 3, PAINT_SUB_MAX = 64, PAINT_SUB_STEPS = 24;
const PAINT_SUB_FRAC = .35;                                  // of brush diameter, per raycast step
// `pts` are the brush positions one pointer move adds — client pixels with their pressure, from
// `Pen.follow`: a pen's coalesced samples, after the Smoothing string (ROADMAP 4.50 (4)). The move is
// walked from the last one along that polyline, by arc length, so the ray budget is what the chord's
// was and the sub-steps follow the curve the pen drew. Each sub-step carries its pressure into
// `stroke.p`, which is how the stroke and every mirrored and turned copy of it are laid at the same
// interpolated pressure, and stampAt interpolates again between the hits in texture space.
function paint3dStrokeTo(pts, maxSteps){
  // The string can hold the brush still for a whole move: nothing to walk, and no ray to cast.
  recStrokeCount("moves");
  if (!pts.length) return;
  const cur = pts[pts.length - 1];
  const prev = stroke.screen;
  const path = prev ? [prev].concat(pts) : null;
  const sym = symEnabled();
  // Every copy is a raycast of its own, and a raycast is an intersectObjects over every visible
  // part — 2.3 ms on an A-10C, which is the measurement the sub-step cap exists for. So
  // eight copies do not mean eight times the rays per pointer move: they mean a coarser walk of the
  // same move (ROADMAP 4.44's eighth candidate). A coarser walk costs a seam crossing noticed late,
  // never a stamp missed — stamps are laid in texture space between hits, not per raycast.
  //
  // Both are read HERE, above the budget that divides by them: declared below it, as they were for
  // an hour on 2026-09-22, the budget line throws "Cannot access 'copies' before initialization" on
  // every move of every stroke — so the first stamp of a stroke landed and nothing after it did.
  const copies = radialCount();
  let steps = 1;
  const d = path ? Pen.arc(path) : 0;
  if (prev) {
    const want = stroke.spt > 0
      ? Math.min(PAINT_SUB_MAX, Math.max(PAINT_SUB_MIN, App.brush.size * PAINT_SUB_FRAC * stroke.spt))
      : 8;
    steps = Math.min(maxSteps || PAINT_SUB_STEPS, Math.max(1, Math.ceil(d / want)));
    steps = Radial.budget(steps, copies * (sym ? 2 : 1));
  }
  // The whole reason the recorder exists: every sub-step below is a raycast against the real mesh,
  // and no offline test has ever exercised this path (core/recorder.js).
  recStrokeCount("substeps", steps);
  const at = path ? Pen.substeps(path, steps) : [cur];
  for (let i = 0; i < at.length; i++) {
    const ev = { clientX: at[i].x, clientY: at[i].y };
    stroke.p = at[i].p;
    recStrokeCount("rays");
    const hit = ray3d(ev);
    if (!hit || !hit.uv) continue;
    recStrokeCount("hits");
    const before = stroke.hits[0], laid = [];                 // the channels stamped this sub-step
    ensureStrokePart(hit.object.name);
    stamp3d(hit, 0, laid);
    // Only a step that stayed on the same island is evidence of the screen-to-texel ratio.
    const after = stroke.hits[0];
    if (prev && before && after) {
      const dScreen = d / steps;                              // the path's length, which one segment's hypot is
      const dTex = Math.hypot(after.px - before.px, after.py - before.py);
      if (dTex > 0.5 && dTex < 4 * App.brush.size) stroke.spt = stroke.spt ? stroke.spt * .7 + (dScreen / dTex) * .3 : dScreen / dTex;
    }
    if (sym) { const mh = mirrorHit(); if (mh && mh.uv) { ensureStrokePart(mh.object.name); stamp3d(mh, 1, laid); } }
    // …and one turned copy per k, each with its own mirror: channel 2k / 2k+1, so every copy keeps
    // its own last point and its own seam bookkeeping the way the mirror does. Any of them landing
    // on a dab already laid this sub-step is that dab, and is not laid again (stamp3d).
    for (let k = 1; k < copies; k++) {
      const rh = radialHit(k);
      if (rh && rh.uv) { ensureStrokePart(rh.object.name); stamp3d(rh, 2 * k, laid); }
      if (sym) { const rm = radialMirrorHit(k); if (rm && rm.uv) { ensureStrokePart(rm.object.name); stamp3d(rm, 2 * k + 1, laid); } }
    }
  }
  stroke.screen = { x: cur.x, y: cur.y, p: cur.p };
}
cnv3.addEventListener("pointerdown", e => {
  cnv3.setPointerCapture(e.pointerId);
  // Ctrl + click is the part picker and it goes FIRST, before any mode gets a look at the event:
  // left adds a part to the painted set, right takes it back OUT (and with nothing selected,
  // "everything except this one" is what that means, so it shuts the part out of painting).
  // The left half used to live in pointerUP behind `!App.paint3d && !App.placing`, so it was dead
  // exactly when it is reached for — with painting on the press started a brush stroke instead,
  // and a placing mode left armed swallowed it. Ctrl + right never had either guard, which is the
  // whole reason one button worked and the other did not. Both are handled on press so neither
  // starts a pan or an orbit.
  // The shape tool's node or handle under the pointer is the path's whatever the modifiers — Ctrl+drag
  // pulls a handle out of a node on the model as it does on the sheet (6.1b) — so that one case goes
  // ahead of the part picker. Everything else the tool takes waits its turn below.
  if (e.button === 0 && !cam.fly && PathUI.grab3d(e) && PathUI.down3d(e)) { c3drag = { path: true }; return; }
  if (e.ctrlKey && (e.button === 0 || e.button === 2) && !cam.fly && modelGroup) {
    const hit = ray3d(e, true);
    // With UV island mode up, Ctrl+click means the ISLAND under the cursor rather than the part
    // (ROADMAP 4.24). Same gesture, and which of the two it picks is stated by a labelled toggle in
    // the Selection panel rather than by a modifier nobody can see. Ctrl+RIGHT stays the part
    // excluder either way — there is no "exclude an island", and silently doing nothing would be worse.
    // The wand is the same kind of pick (4.50 (9)): with it on, the texel under the cursor is the
    // colour it takes, so a camouflage patch can be chosen where it is seen, on the vehicle.
    if (SelectUI.picksClick() && e.button === 0 && hit && hit.uv) {
      const stem = App.matSlot.get(hit.object.userData.mat);
      const slot = stem && App.slots.get(stem);
      if (slot && slot.composite) {
        if (slot !== App.activeSlot) selectSlot(slot.id);      // the selection belongs to one sheet
        SelectUI.pickAt(slot, hit.uv.x * slot.composite.width, (1 - hit.uv.y) * slot.composite.height,
          e.shiftKey, e.altKey);
        c3drag = null;
        return;
      }
    }
    // Shift+Ctrl adds rather than toggles (3.30) — the same Shift the marquee and the Parts list
    // use. Alt cannot mean "subtract" here: Ctrl+Alt is already the "every identical part" chord.
    if (hit) setStatus(e.button === 2 ? togglePartExclude(hit.object.name)
      : e.shiftKey && App.selParts.has(hit.object.name) ? "Already selected: " + hit.object.name
      : togglePartSel(hit.object.name), "ok");
    c3drag = null;
    return;
  }
  // A projected decal's handles (ROADMAP 4.2): a corner resizes it, the knob off its top edge turns
  // it. Ahead of the decal's own body and of the orbit — a handle is the smaller, more deliberate
  // target, and it only exists while the decal is selected with painting off (ProjHandles.target).
  if (e.button === 0 && !e.altKey && !e.ctrlKey && ProjGrip.press3d(e)) {
    c3drag = { grip: true };
    refreshViewCursor();
    return;
  }
  // The shape tool on the model (6.1b): a left click that hits it lays a node; a click off it, and
  // every right or middle drag, falls through to orbit and pan so the view stays navigable. Ahead of
  // the placing modes and of painting, which it is exclusive with (PathUI.set).
  if (e.button === 0 && !cam.fly && modelGroup && PathUI.down3d(e)) { c3drag = { path: true }; return; }
  // Dragging a projected decal around the model. Only a drag that starts ON the decal moves it —
  // anywhere else still orbits the camera, so being in move mode doesn't cost you the view.
  if (App.placing === "movproj" && e.button === 0 && !e.altKey && !e.ctrlKey) {
    const L = activeLayerObj();
    if (L && L.proj) {
      const found = projUnderPointer(e);
      const hit = found && found.hit, slot = found && found.slot;
      const grabbed = found ? found.L : null;           // clicking a different projected decal grabs that one
      if (grabbed) {
        if (grabbed.proj !== L.proj) {
          if (slot !== App.activeSlot) selectSlot(slot.id);
          App.activeLayer = grabbed;
          refreshLayerList();
        }
        const P = grabbed.proj;
        App._projEdit = App._projEdit && App._projEdit.P === P ? App._projEdit : { P, from: projParamsClone(P) };
        moveProjTo(P, hit.point, true);
        c3drag = { projDrag: P };
        App.projDragging = true; App.projHover = true; refreshViewCursor();
        return;
      }
    } else {
      // The mode belongs to a layer, so it ends with the layer. It used to outlive it: clicking a
      // projected decal on the model arms "movproj" automatically, and picking any other layer
      // afterwards left the mode on with nothing to move — so every later click on the model
      // answered "Select a projected decal layer first" and then fell through and painted anyway.
      // Shift+click made it loudest, because a shift-drawn line is a click you repeat. Dropping the
      // mode here lets the click carry on as whatever it actually was, silently: the Move button
      // un-highlighting is the feedback, and an error the user cannot act on is not one.
      setPlacing(false);
    }
  }
  // The radial centre is PICKED, not inferred (ROADMAP 4.44's eighth candidate) — an armed click
  // the way a decal's placement is, so the button says what it is waiting for.
  if (App.placing === "radial" && e.button === 0) {
    const hit = ray3d(e, true);
    if (hit && setRadialCentre(hit)) {
      setPlacing(false);
      syncRadialUI();
      updateRadialAxis(true);
      setStatus("Radial centre set — " + radialCount() + " copies about " +
        ($("radialAxis").value === "auto" ? "that surface's normal" : $("radialAxis").value.toUpperCase()), "ok");
    } else if (!hit) setStatus("Click on the model — the point you click is the centre the copies turn about", "err");
    return;
  }
  if ((App.placing === "uv" || App.placing === "proj") && e.button === 0) {
    const L = activeLayerObj();
    if (L && L.type === "decal") {
      const hit = ray3d(e, App.placing === "proj");   // a projection may cross into other slots
      if (hit && hit.uv) {
        const s = App.activeSlot;
        // bakeProjection picks the mode that follows (move-on-model on success, retry on failure)
        if (App.placing === "proj") { bakeProjection(L, hit); return; }
        const from = { x: L.x, y: L.y, sym: L.sym };
        let sym = L.sym;
        if (symEnabled()) { const mh = mirrorHit(); sym = mh && mh.uv ? { x: mh.uv.x, y: 1 - mh.uv.y } : null; }
        const to = { x: hit.uv.x, y: 1 - hit.uv.y, sym };
        // ensureDecalSurface, not refresh: "Move to clicked spot" is the other way a decal is put
        // down, and a Look chosen in the editor becomes real at exactly this moment (ROADMAP 4.8).
        const apply = v => { L.x = v.x; L.y = v.y; L.sym = v.sym; ensureDecalSurface(s, L); scheduleComposite(s); draw2D(); };
        pushAction("place decal", () => apply(from), () => apply(to));
        apply(to);
        setPlacing(false);
        return;
      }
      setStatus(App.placing === "proj" ? "Click on the model where the image should land" : "Click on a part that belongs to the active slot", "err");
      return;
    }
  }
  // S = jump to that part's texture slot, X = protect it — both work while painting,
  // which is when you actually need them.
  if (e.button === 0 && (keyHeld("KeyS") || keyHeld("KeyX"))) {
    const hit = ray3d(e, true);
    if (hit) {
      if (keyHeld("KeyX")) { togglePartProtect(hit.object.name); setStatus((App.protectedParts.has(hit.object.name) ? "Protected " : "Unprotected ") + hit.object.name, "ok"); }
      else {
        const stem = App.matSlot.get(hit.object.userData.mat);
        if (stem && App.slots.has(stem)) { selectSlot(stem); showTab("paint"); setStatus("Editing slot “" + stem + "” (" + hit.object.name + ")", "ok"); }
        else setStatus("“" + hit.object.name + "” has no editable texture slot", "err");
      }
    }
    return;
  }
  if (App.paint3d && e.button === 0 && !e.altKey && App.brush.tool !== "none") {
    const hit = ray3d(e);
    if (hit && hit.uv) {
      if (beginStroke(false, true)) {                          // mask3d: keep paint on the parts touched
        // The pressure the first dab is laid at, and whether a pen is driving this (ROADMAP 4.50 (4)).
        if (Pen.begin(stroke, e)) recStrokeFlag("pen");
        ensureStrokePart(hit.object.name);
        // A straight line in the 3-D view has to be straight ON THE MODEL. Interpolating between
        // the two points in texture space draws something straight on the sheet and arbitrary on
        // the vehicle: it runs through whatever UV islands happen to lie between the two
        // coordinates, so the paint lands on unrelated panels and the line the user asked for is
        // not there at all. The line is therefore walked across the SCREEN — from where the last
        // stroke ended, projected with the camera as it is now — and every step is raycast, so it
        // follows the surface, wraps over curvature, and lands on the right islands.
        const from = e.shiftKey && App.activeSlot && App.activeSlot._last3d;
        if (from) {
          stroke.screen = worldToScreen(from);
          paint3dStrokeTo([{ x: e.clientX, y: e.clientY, p: stroke.p }], PAINT_LINE_STEPS);
        } else {
          // No 3-D anchor (the previous stroke was drawn in the 2D view): fall back to the
          // texture-space line, which is what that stroke was in.
          if (e.shiftKey && App.activeSlot) {
            if (App.activeSlot._lastPt) stroke.lasts[0] = App.activeSlot._lastPt;
            if (App.activeSlot._lastPtSym) stroke.lasts[1] = App.activeSlot._lastPtSym;
            if (stroke.lasts[0] || stroke.lasts[1]) stroke.line = true;
          }
          const laid = [];                                     // a copy on the stroke's own dab is that dab
          stamp3d(hit, 0, laid);
          if (symEnabled()) { const mh = mirrorHit(); if (mh && mh.uv) { ensureStrokePart(mh.object.name); stamp3d(mh, 1, laid); } }
          stroke.line = false;
          stroke.screen = { x: e.clientX, y: e.clientY, p: stroke.p };
        }
        c3drag = { paint: true };
      }
      return;                                                  // paint attempt handled (hint already set on failure)
    }
    // clicked while painting but not on a paintable part of the active slot — explain why
    const any = ray3d(e, true);
    if (any) {
      const stem = App.matSlot.get(any.object.userData.mat);
      if (App.selParts.size && !App.selParts.has(any.object.name))
        setStatus("“" + any.object.name + "” isn't in your selected parts — clear the selection or add it to paint here", "err");
      else if (stem && App.slots.get(stem) !== App.activeSlot)
        setStatus("“" + any.object.name + "” uses slot “" + stem + "” — click it to switch, or pick that slot to paint here", "err");
      else
        setStatus("“" + any.object.name + "” has no paintable texture on the active slot", "err");
      return;
    }
  }
  c3drag = { paint: false, btn: e.button, x: e.clientX, y: e.clientY, moved: 0 };
  if (!cam.fly && e.button === 0 && !e.altKey && modelGroup) {
    const hp = ray3d(e, true);
    if (hp) c3drag.pendingPivot = hp.point; // applied only once a real drag starts — plain clicks don't nudge the camera
  }
});
cnv3.addEventListener("pointerleave", () => { lastPtr3 = null; hideBrushRing(); App.over3d = false; PathUI.over3d = false; refreshViewCursor(); });
cnv3.addEventListener("pointerenter", e => { App.over3d = true; ctrlHeld(e.ctrlKey); });
cnv3.addEventListener("pointermove", e => {
  lastPtr3 = { clientX: e.clientX, clientY: e.clientY };     // replayed by refreshBrushCursor()
  if (!c3drag) {
    // Over a handle, the cursor says which drag it is. Arithmetic on the positions the last frame
    // drew, so it costs nothing — and when it answers, the raycast below has nothing to add.
    const hv = ProjHandles.hit(e.clientX, e.clientY);
    if (ProjHandles.cursor(hv) !== ProjHandles.cursor(ProjHandles.hover)) { ProjHandles.hover = hv; refreshViewCursor(); }
    else ProjHandles.hover = hv;
    // Is the pointer over a decal it could pick up? One raycast per move, and only in this mode —
    // the brush ring already costs the same when painting, so this adds nothing anywhere else.
    if (App.placing === "movproj" && !hv) {
      const L0 = activeLayerObj();
      const over = !!(L0 && L0.proj && projUnderPointer(e).L);
      if (over !== App.projHover) { App.projHover = over; refreshViewCursor(); }
    }
    if (PathUI.on) PathUI.hover3d(e);
    updateBrushRing(e); return;
  }
  if (c3drag.path) { PathUI.move3d(e); return; }
  if (c3drag.paint) {
    // Every sample the move carries, through the Smoothing string (ROADMAP 4.50 (4)). With the string
    // on, the paint is going where the brush end is, not under the pointer — so that is where the
    // ring goes.
    if (stroke) paint3dStrokeTo(Pen.follow(stroke, e, App.brush.lazy));
    updateBrushRing(stroke && App.brush.lazy > 0 && stroke.string ? { clientX: stroke.string.x, clientY: stroke.string.y } : e);
    return;
  }
  if (c3drag.grip) { ProjGrip.drag3d(e); return; }
  if (c3drag.projDrag) {
    const hit = ray3d(e, true);
    if (hit) moveProjTo(c3drag.projDrag, hit.point, true);
    return;
  }
  const dx = e.clientX - c3drag.x, dy = e.clientY - c3drag.y;
  c3drag.x = e.clientX; c3drag.y = e.clientY;
  c3drag.moved += Math.abs(dx) + Math.abs(dy);
  if (cam.fly) {
    if (c3drag.btn === 2 || c3drag.btn === 1) {
      const right = new THREE.Vector3(-Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
      const sc = cam.flySpeed / 400;
      cam.flyPos.addScaledVector(right, -dx * sc);
      cam.flyPos.y += dy * sc;
    } else {
      cam.yaw += dx * .0045;
      cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch - dy * .0045));
    }
    return;
  }
  if (c3drag.btn === 2 || c3drag.btn === 1) {                 // pan — see panCamera in view3d/scene.js
    panCamera(dx, dy);
  } else {
    if (c3drag.pendingPivot && c3drag.moved > 3) { setPivot(c3drag.pendingPivot); c3drag.pendingPivot = null; }
    cam.theta += dx * .008;
    cam.phi = Math.max(.05, Math.min(Math.PI - .05, cam.phi - dy * .008));
  }
});
const end3 = e => {
  if (c3drag && c3drag.path) { PathUI.up(); PathUI.redraw(); c3drag = null; refreshViewCursor(); return; }
  if (c3drag && c3drag.grip) {                       // a handle let go: one undo step, the real render
    ProjGrip.end();
    c3drag = null;
    refreshViewCursor();
    return;
  }
  if (c3drag && c3drag.projDrag) {
    // the live drag only refreshed the sheets that already had a layer; settling adds any new one
    const P = c3drag.projDrag, ed = App._projEdit;
    App._projEdit = null;
    const res = updateProjGroup(P, "move projected decal", ed ? ed.from : null);   // a deleted decal stays deleted (4.2's review)
    setStatus(res.gone ? ProjGrip.GONE
      : res.drawn ? "Moved — " + res.drawn + " triangles across " + res.sheets + " texture" + (res.sheets === 1 ? "" : "s")
      : "Nothing hit here — the decal is off the model or facing away", res.drawn || res.gone ? "ok" : "err");
    c3drag = null;
    App.projDragging = false; refreshViewCursor();
    return;
  }
  if (c3drag && c3drag.paint) { endStroke(); BrushPanel.cloneHint(); }
  else if (c3drag && !App.placing && c3drag.btn === 0 && c3drag.moved < 5 && e && !cam.fly) {
    const hit = ray3d(e, true);
    // ROADMAP 4.35(2): the click that selects a decal has a counterpart now — a click beside it, or
    // on nothing at all, lets go of it. Only a DECAL is let go of: a click on the model is also how
    // a slot is picked, and a paint layer must not lose its selection to that.
    const held = App.activeLayer && (App.activeLayer.proj || App.activeLayer.type === "decal") ? App.activeLayer : null;
    const letGo = () => { App.activeLayer = null; setPlacing(false); refreshLayerList(); setStatus("Decal “" + (held.name || "decal") + "” deselected", "ok"); };
    if (!hit && held && !App.paint3d && !e.altKey) letGo();
    if (hit) {
      if (e.altKey) { // color pick in 3D — or, with the Clone in hand, its source
        const stem = App.matSlot.get(hit.object.userData.mat);
        const slot = stem && App.slots.get(stem);
        if (slot && slot.composite && hit.uv) {
          const px = hit.uv.x * slot.composite.width, py = (1 - hit.uv.y) * slot.composite.height;
          if (App.brush.tool === "clone" && App.brush.target !== "mask") {
            // The source has to be on the sheet the brush will write, or the offset means nothing.
            if (slot !== App.activeSlot) setStatus("“" + hit.object.name + "” is on slot “" + stem + "” — the Clone copies within the slot you are painting, “" + App.activeSlot.id + "”", "err");
            else { Clone.pick(slot, px, py); BrushPanel.cloneHint(); draw2D(); }
          } else pickColorFrom(slot, px, py);
        }
      } else if (!App.paint3d) {
        // Ctrl+click is handled on pointerdown now (part picker), so it never reaches here.
        const stem = App.matSlot.get(hit.object.userData.mat);
        const slot = stem && App.slots.get(stem);
        // click on a decal → select its layer and enter the matching move mode
        let di = null, pi = null;
        if (slot && slot.composite && hit.uv) {
          const px = hit.uv.x * slot.composite.width, py = (1 - hit.uv.y) * slot.composite.height;
          di = decalAtUV(slot, px, py);
          if (!di) pi = projAtUV(slot, px, py);
        }
        if (di) {
          if (slot !== App.activeSlot) selectSlot(stem);
          App.activeLayer = di; refreshLayerList(); syncDecalUI(); setPlacing("uv");
          setStatus("Decal “" + (di.name || "decal") + "” — click model to reposition, drag in 2D, arrow keys nudge, , / . rotate", "ok");
        } else if (pi) {
          if (slot !== App.activeSlot) selectSlot(stem);
          App.activeLayer = pi; refreshLayerList(); setPlacing("movproj");
          setStatus("Projected decal “" + (pi.proj.name || "image") + "” — drag it on the model or the sheet, its corners resize it, " +
            "the knob above it turns it; arrow keys nudge", "ok");
        } else {
          if (stem && App.slots.get(stem) !== App.activeSlot) { selectSlot(stem); setStatus("Selected slot: " + stem + " (" + hit.object.name + ")", "ok"); }
          if (held) letGo();
        }
      }
    }
  }
  c3drag = null;
  App.projDragging = false; refreshViewCursor();
  refreshBrushCursor();      // an orbit / pan moved the surface under a ring that stayed put
};
cnv3.addEventListener("pointerup", end3);
// A cancelled handle drag is settled rather than dropped: what is on screen is where it was left, and
// an undo step is what makes that state reachable again.
cnv3.addEventListener("pointercancel", () => { if (c3drag && c3drag.path) PathUI.up(); if (c3drag && c3drag.paint) endStroke(); if (c3drag && c3drag.grip) ProjGrip.end(); c3drag = null; App.projDragging = false; refreshViewCursor(); });
cnv3.addEventListener("wheel", e => {
  e.preventDefault();
  // Ctrl+wheel widens / narrows the part selection a level at a time (see growSelection);
  // Alt+wheel is the brush size it used to be, and [ / ] still do the same.
  if (e.ctrlKey) { growSelection(e.deltaY < 0 ? 1 : -1); return; }
  if (e.altKey) { adjustBrushSize(e.deltaY < 0 ? 6 : -6); return; }
  if (cam.fly) { cam.flySpeed = Math.max(.2, cam.flySpeed * (e.deltaY > 0 ? 1 / 1.25 : 1.25)); setStatus("Fly speed: " + cam.flySpeed.toFixed(1)); return; }
  cam.dist *= e.deltaY > 0 ? 1.12 : 1 / 1.12;
  refreshBrushCursor();                // the footprint under the cursor changes as the view zooms
}, { passive: false });
cnv3.addEventListener("contextmenu", e => e.preventDefault());
// Which projected decal, if any, is under the pointer. Shared by the drag (which grabs it) and by
// the hover (which only wants to know, so the cursor can say so) — one hit-test, one definition of
// "over the decal", so the cursor can never promise a grab the click will not deliver.
function projUnderPointer(e){
  const hit = ray3d(e, true);
  const stem = hit && App.matSlot.get(hit.object.userData.mat);
  const slot = stem && App.slots.get(stem);
  const L = (hit && hit.uv && slot && slot.composite)
    ? projAtUV(slot, hit.uv.x * slot.composite.width, (1 - hit.uv.y) * slot.composite.height) : null;
  return { hit, slot, L };
}
function setPlacing(mode){
  // Painting and a placing mode are mutually exclusive, and used to be able to be on at once: the
  // pointerdown handler checks `movproj` first, so painting silently stopped working with no sign
  // of why. Each mode now turns the other off, which is also the easy way out that was
  // asked for — pressing B is enough (reported 2026-08-23).
  if (mode && App.paint3d) setPaint3d(false);
  App.placing = mode || false;
  // Carrying ends when the waiting ends. "uv" and "proj" are the two modes that are waiting for a
  // click to put a decal down; everything else — including "movproj", which is only reachable once
  // the decal IS down — means it landed or the user backed out. One choke point, so the ghost
  // cannot be left stuck on the cursor by a path that forgot about it.
  if (mode !== "uv" && mode !== "proj") DecalCarry.clear();
  $("btnPlace3d").classList.toggle("active", mode === "uv");
  $("btnProject3d").classList.toggle("active", mode === "proj");
  // …and they say what they are waiting for, not only what they do. Reported 2026-09-02: "clicking
  // button does not seem to do anything by itself" — which is exactly what happens, because both
  // arm a click on the MODEL and neither changed anything but a background tint. That is the same
  // complaint ROADMAP 3.14 answered for `Moving`, and it gets the same answer here; these two are
  // armed actions rather than sustained modes, so the label states the pending click instead of an
  // on/off state.
  $("btnRadialCentre").classList.toggle("active", mode === "radial");
  $("btnRadialCentre").textContent = mode === "radial" ? "Click the centre…" : (App.radial && App.radial.c ? "Move centre…" : "Set centre…");
  $("btnPlace3d").textContent = mode === "uv" ? "Click where it goes…" : "Move to clicked spot";
  $("btnProject3d").textContent = mode === "proj" ? "Click to project…" : "Project onto model";
  // Move-on-model is the one SUSTAINED mode of the three — the other two are armed actions that
  // end with the click that puts the decal down — so it is the one that can be left on without
  // being noticed, and it says so in its own label the way Painting does (ROADMAP 3.14). This is
  // the only place any of the three is written: `setPlacing` is the only writer of `App.placing`,
  // so a second sync elsewhere could only ever agree with this one or be wrong.
  $("btnProjMove").classList.toggle("active", mode === "movproj");
  $("btnProjMove").textContent = "Moving: " + (mode === "movproj" ? "on" : "off");
  if (mode === "uv") setStatus("Click the model where the decal should go" + ($("symOn").checked ? " (+ mirrored copy)" : ""));
  if (mode === "proj") setStatus("Line the camera up the way you want the image to read, then click the model" +
    ($("symOn").checked ? " (+ mirrored projection)" : "") + " — it projects from this view and wraps across seams and textures");
  if (mode === "movproj") setStatus("Drag the decal itself to slide it over the model — it re-projects onto whatever surface it lands on. " +
    "Dragging anywhere else still orbits. Its corners resize it and the knob above it turns it; arrow keys nudge, , / . rotate. " +
    "Esc or turning painting on leaves this mode.");
  App.projHover = false;
  refreshViewCursor();
}
// The projector is aligned with the camera, not with the triangle that happened to be under the
// cursor: the image lands the way you see it, upright, and keeps working on curved surfaces
// where a single face normal points somewhere unhelpful. Only the depth range and back-facing
// test come from the surface.
function projFrame(hit){
  const n = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).normalize();  // towards camera
  const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();  // screen right
  const u = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();  // screen up
  return { p: hit.point.clone(), n, r, u };
}
function frameToArrays(f){ return { p: f.p.toArray(), n: f.n.toArray(), r: f.r.toArray(), u: f.u.toArray() }; }
function frameFromArrays(a){
  return { p: new THREE.Vector3().fromArray(a.p), n: new THREE.Vector3().fromArray(a.n),
    r: new THREE.Vector3().fromArray(a.r), u: new THREE.Vector3().fromArray(a.u) };
}
function projBasis(frame, rotDeg, flip){
  const r = rotDeg * Math.PI / 180, c = Math.cos(r), si = Math.sin(r);
  const t1 = frame.r.clone().multiplyScalar(c).addScaledVector(frame.u, si);          // image right
  const t2 = frame.u.clone().multiplyScalar(-c).addScaledVector(frame.r, si);         // image down
  if (flip) t1.negate();
  return { p: frame.p.clone(), n: frame.n.clone(), t1, t2 };
}
// The mirrored copy's frame. Reflecting all four vectors makes the copy a TRUE REFLECTION, which is
// right for a shape — a shark mouth or an arrow points forward on both sides of the aircraft only if
// it is reflected — and wrong for anything with lettering in it: a number, a name or a serial comes
// out backwards on the far side, which is the one thing real markings never do (ROADMAP 4.2,
// reported 2026-08-23).
//
// `readable` negates the image's own right axis afterwards, which is exactly what `projBasis` does
// for `flip`. The copy stays where the reflection put it — the projected footprint is unchanged,
// because it is symmetric in u about the decal's centre — and only the way the image reads changes.
// That is the whole of the difference, and it is why this is one negation rather than a second
// placement.
function mirrorBasis(b, readable){
  const { a } = symPlane();
  const m = v => { const q = v.clone(); q[a] = -q[a]; return q; };
  const t1 = m(b.t1);
  if (readable) t1.negate();
  return { p: mirrorPoint(b.p), n: m(b.n), t1, t2: m(b.t2) };
}
function drawTexturedTri(g, img, src, dst){
  const [[u0, v0], [u1, v1], [u2, v2]] = src;
  const [[x0, y0], [x1, y1], [x2, y2]] = dst;
  const den = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(den) < 1e-9) return;
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / den;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / den;
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / den;
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / den;
  const e = x0 - a * u0 - c * v0, f = y0 - b * u0 - d * v0;
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, IN = 1.025; // inflate clip to close seams
  g.save();
  g.beginPath();
  g.moveTo(cx + (x0 - cx) * IN, cy + (y0 - cy) * IN);
  g.lineTo(cx + (x1 - cx) * IN, cy + (y1 - cy) * IN);
  g.lineTo(cx + (x2 - cx) * IN, cy + (y2 - cy) * IN);
  g.closePath(); g.clip();
  g.transform(a, b, c, d, e, f);
  g.drawImage(img, 0, 0);
  g.restore();
}
// canvas === null counts the triangles a projection would cover without drawing anything —
// used to find the affected textures before allocating a full-size canvas for each of them.
// ---------- The canvas projector, as named steps on one object (ROADMAP 2.4) ----------
// `projectInto` was 91 lines doing five different jobs with fourteen locals between them: pick the
// geometry, reject a whole mesh, decide a triangle, draw it on every tile it touches, and grow the
// box. They are methods over one context now, the shape `Composite` and `PoseApply` use.
//
// Every decision here exists because of a reported defect, and `tools/t79_project.mjs` — written
// before this split and shown to fail when the footprint test is narrowed back to "a corner is
// inside" — holds all of them: facing, depth, footprint overlap, the layer's remembered scope
// beating the live selection, hidden and protected parts, the dry run agreeing with the real one,
// the box, and a tiled UV taking paint on every repeat.
const Project = {
  // What the beam may touch on this sheet: the right slot, visible, not shut out, and inside the
  // part scope. The layer's OWN scope wins over the live selection — re-projecting a week later
  // must not change shape because something else happens to be selected.
  targets(cx){
    const sel = Scope.parts(cx.L) !== undefined
      ? (Scope.parts(cx.L) ? new Set(Scope.parts(cx.L)) : null)
      : (App.selParts && App.selParts.size ? App.selParts : null);
    const out = [];
    for (const gd of App.geomData) {
      if (App.matSlot.get(gd.mat) !== cx.slot.id) continue;
      const mesh = App.meshes.get(gd.name);
      if (mesh && !mesh.visible) continue;
      if (sel && !sel.has(gd.name)) continue;
      if (App.protectedParts.has(gd.name)) continue;
      // whole-mesh reject: dragging a decal must not walk 300k triangles per frame
      const bb = gdBounds(gd), p = cx.p, reach = cx.reach;
      if (p.x < bb.x0 - reach || p.x > bb.x1 + reach || p.y < bb.y0 - reach || p.y > bb.y1 + reach ||
          p.z < bb.z0 - reach || p.z > bb.z1 + reach) continue;
      out.push(gd);
    }
    return out;
  },
  // One triangle in the beam's own frame: where its corners land in the image, how deep they are,
  // and how squarely it faces. `cx.sx`/`cx.sy` are filled with the source corners, so the caller
  // draws from what this measured rather than measuring twice.
  tri(cx, pos, nrm, o){
    const { p, n, t1, t2 } = cx;
    let faceDot = 0, dmin = Infinity, dmax = -Infinity;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const vx = pos[o + k*3] - p.x, vy = pos[o + k*3 + 1] - p.y, vz = pos[o + k*3 + 2] - p.z;
      const d = vx * n.x + vy * n.y + vz * n.z;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      const u = (vx * t1.x + vy * t1.y + vz * t1.z) / (2 * cx.halfW) + .5;
      const v = (vx * t2.x + vy * t2.y + vz * t2.z) / (2 * cx.halfH) + .5;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
      cx.sx[k] = u * cx.bw; cx.sy[k] = v * cx.bh;
      faceDot += nrm[o + k*3] * n.x + nrm[o + k*3 + 1] * n.y + nrm[o + k*3 + 2] * n.z;
    }
    // A triangle counts when its footprint OVERLAPS the image, not only when one of its corners
    // lands inside it — a small decal dropped in the middle of one big fuselage triangle used to
    // project nothing at all. Same for depth: only reject geometry that stays clear of the
    // projector plane, instead of any triangle with one distant corner.
    if (u1 < -.15 || u0 > 1.15 || v1 < -.15 || v0 > 1.15) return false;
    const straddles = dmin <= 0 && dmax >= 0;
    if (!straddles && Math.min(Math.abs(dmin), Math.abs(dmax)) > cx.depthLim) return false;
    return faceDot / 3 >= cx.faceMin;                       // facing the projector at all
  },
  // Where that triangle lands on the SHEET, in sheet pixels.
  dest(cx, uv, ouv){
    const dst = [];
    for (let k = 0; k < 3; k++) {
      let uu = uv[ouv + k*2], vv = uv[ouv + k*2 + 1];
      if (cx.flipV) vv = 1 - vv;
      dst.push([uu * cx.w, (1 - vv) * cx.h]);
    }
    return dst;
  },
  // ---- tiled UVs (ROADMAP 4.23(a)) ----
  // A part textured by repeating one strip — the t55e1's rifled gun barrel runs u to 6.353 — has
  // five of its six repeats outside the sheet, so a projection reached only the first. The sheet is
  // the unit square, so the same textured triangle is drawn once per tile it touches, translated by
  // a whole sheet. The same shape as the rasteriser's fix and the same reason it cannot smear: a
  // translation, clipped by the canvas, never a fold.
  draw(cx, dst){
    const [txA, txB] = uvTileRange(Math.min(dst[0][0], dst[1][0], dst[2][0]) / cx.w,
                                   Math.max(dst[0][0], dst[1][0], dst[2][0]) / cx.w);
    const [tyA, tyB] = uvTileRange(Math.min(dst[0][1], dst[1][1], dst[2][1]) / cx.h,
                                   Math.max(dst[0][1], dst[1][1], dst[2][1]) / cx.h);
    const src = [[cx.sx[0], cx.sy[0]], [cx.sx[1], cx.sy[1]], [cx.sx[2], cx.sy[2]]];
    for (let ty = tyA; ty <= tyB; ty++) for (let tx = txA; tx <= txB; tx++) {
      const q = (tx || ty) ? dst.map(([dx, dy]) => [dx - tx * cx.w, dy - ty * cx.h]) : dst;
      if (cx.g) drawTexturedTri(cx.g, cx.L.bmp, src, q);
      for (const [dx, dy] of q) {
        if (dx < cx.bx0) cx.bx0 = dx; if (dx > cx.bx1) cx.bx1 = dx;
        if (dy < cx.by0) cx.by0 = dy; if (dy > cx.by1) cx.by1 = dy;
      }
    }
  },
  // Where it landed, in sheet pixels — the union of the triangles actually rasterised (ROADMAP
  // 4.8b), clamped to the sheet. Free, because the destination corners are computed anyway.
  box(cx){
    if (cx.bx1 < cx.bx0) return null;
    const x = Math.max(0, Math.floor(cx.bx0) - 1), y = Math.max(0, Math.floor(cx.by0) - 1);
    const b = { x, y, w: Math.min(cx.w, Math.ceil(cx.bx1) + 2) - x, h: Math.min(cx.h, Math.ceil(cx.by1) + 2) - y };
    return (b.w > 0 && b.h > 0) ? b : null;
  },
};
function projectInto(canvas, L, basis, halfW, halfH, slot){
  const s = slot || App.activeSlot;
  // Same reach and same facing threshold the shader uses, so the dry run that decides whether a
  // sheet needs a layer at all cannot disagree with what actually gets drawn onto it.
  const depthLim = projDepthLim(L, halfW, halfH);
  const cx = {
    L, slot: s, halfW, halfH, depthLim,
    p: basis.p, n: basis.n, t1: basis.t1, t2: basis.t2,
    w: canvas ? canvas.width : 1, h: canvas ? canvas.height : 1,
    g: canvas ? ctx2d(canvas) : null,
    flipV: $("optFlipV").checked,
    faceMin: projFaceBand(L).lo,
    bw: L.bmp.width, bh: L.bmp.height,
    reach: Math.hypot(halfW, halfH) + depthLim,
    sx: [0, 0, 0], sy: [0, 0, 0],
    bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity,
  };
  let drawn = 0;
  for (const gd of Project.targets(cx)) {
    const pos = gd.position, uv = gd.uv, nrm = gd.normal;
    const triCount = pos.length / 9;
    for (let t = 0; t < triCount; t++) {
      if (!Project.tri(cx, pos, nrm, t * 9)) continue;
      if (cx.g) Project.draw(cx, Project.dest(cx, uv, t * 6));
      drawn++;
    }
  }
  return { drawn, box: Project.box(cx) };
}
// `scale` fixes the world size of one SOURCE pixel; the image actually drawn may be wider than the
// source by a style's padding (an outline, a shadow — DecalStyle), and then the beam widens with it
// so the marking itself keeps its size. `srcW` overrides the reference width for an image that is
// already padded (the height source, projFootprint). `k` is half the world size of one source
// pixel, for anything that has to move the frame by a number of the image's own pixels.
function projHalfSize(L){
  const diag = App.modelSize ? Math.max(App.modelSize.x, App.modelSize.y, App.modelSize.z) : 10;
  const drawn = DecalStyle.bitmap(L.bmp, L.surf, L);
  const k = Math.max(.001, L.scale * diag * .12) / (L.srcW || L.bmp.width);
  const halfW = Math.max(.001, k * drawn.width);
  return { halfW, halfH: k * drawn.height, k };
}
