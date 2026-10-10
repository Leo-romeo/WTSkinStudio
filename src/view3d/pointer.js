// ---------- 3D painting & camera ----------
const cnv3 = $("view3d");
let c3drag = null;
// ---- One painting switch ----
// There were two: a "Paint: off" button over the 3D view and an "Off" entry among the brush modes.
// They meant different things (one gated the 3D view, the other set the tool to nothing) but the
// user could only ever want one of them, and reaching the second one lost which tool had been
// chosen. Now there is a single on/off that covers both views; the tool row is only ever tools.
// Turning it on re-checks which tools can write to the layer you have selected and moves to one
// of those, so switching on always leaves a brush that does something.
function setPaint3d(on){
  App.paint3d = !!on;
  const label = "Paint: " + (on ? "on" : "off");
  for (const id of ["btnPaint3d", "btnPaint2d"]) {
    const b = $(id);
    if (b) { b.textContent = label; b.classList.toggle("active", App.paint3d); }
  }
  const big = $("btnPaintOn");
  if (big) { big.textContent = "Painting: " + (on ? "on" : "off"); big.classList.toggle("active", App.paint3d); }
  // Unconditional since ROADMAP 4.40. It used to run only when switching ON, which made this the
  // de-facto refresher for the whole tool row — turning painting on was the only thing that
  // re-asked the question after a load, and turning it off left the answer frozen. What a tool can
  // write does not depend on whether you are painting with it.
  updateBrushAvailability();
  if (!App.paint3d) hideBrushRing();
  // Turning painting on leaves any placing mode — the two are mutually exclusive and used to be
  // able to be on together, with painting silently losing (setPlacing has the other half).
  if (on && App.placing) setPlacing(false);
  refreshViewCursor();
  needsRender();
}
// ONE place decides what the 3-D view's cursor is, because "which mode am I in" was otherwise
// invisible: move-on-model announced itself with a tinted button at the far side of the screen and
// nothing else, so it was easy to be in it without knowing (reported 2026-08-23).
//
//   crosshair  painting, or waiting for a click to place a decal — you are about to mark a spot
//   grab       over a projected decal you can pick up;  grabbing while you are dragging it
//   all-scroll move-on-model, but not over the decal — dragging here orbits, which is what that
//              cursor means everywhere else, and it is visibly not the plain arrow, so the mode
//              being ON is obvious without hunting for the button
function refreshViewCursor(){
  if (typeof cnv3 === "undefined" || !cnv3) return;
  let c = "";
  // A projected decal's handle, held or under the pointer (ROADMAP 4.2): the arrow for that drag.
  const grip = c3drag && c3drag.grip && ProjGrip.g ? ProjGrip.g.handle : ProjHandles.target() ? ProjHandles.hover : null;
  if (grip) c = ProjHandles.cursor(grip);
  else if (App.placing === "movproj") c = App.projDragging ? "grabbing" : App.projHover ? "grab" : "all-scroll";
  else if (App.placing) c = "crosshair";                     // "uv" / "proj": click to put it down
  // Ctrl held over the model is the pick (ROADMAP 3.30): a hand for a part, a cell for an island
  // — the gesture that used to be invisible is on the cursor before the click.
  else if (App.ctrlHeld && App.over3d && modelGroup && !cam.fly) c = SelectUI.picksClick() ? "cell" : "pointer";
  // The shape tool over the model or one of its nodes (6.1b): a click there lays or takes a node.
  // Off the model the plain cursor says a drag orbits, which it does.
  else if (PathUI.on && PathUI.over3d && App.over3d && !cam.fly) c = "crosshair";
  else if (App.paint3d) c = "crosshair";
  cnv3.style.cursor = c;
  // The sheet's handle cursor answers to the same two things — painting and the placing mode — and
  // every change of either ends here, so it goes with them rather than at the sheet's next move.
  Draw2D.projPointer();
}
// Ctrl is a mode while it is down (3.30): the cursor says so, and the status line names the three
// things a click can then do — once per hold, and only with the pointer over the model, so Ctrl+Z
// at the keyboard does not narrate. Fed by keydown/keyup (ui/keys.js) and by the pointer's own
// ctrlKey on the way in, for a Ctrl pressed before the pointer arrived.
function ctrlHeld(on){
  on = !!on;
  if (on === !!App.ctrlHeld) return;
  App.ctrlHeld = on;
  refreshViewCursor();
  if (on && App.over3d && modelGroup && !cam.fly)
    setStatus("Ctrl+click: select the part under the cursor (Shift adds) · Ctrl+right-click: shut it out of painting · " +
      (SelectUI.island ? "Islands is on, so a click takes the UV island"
        : SelectUI.kind === "wand" ? "the Wand is on, so a click takes the colour under it" : "K: islands instead"), "");
}
function togglePaint(){ setPaint3d(!App.paint3d); }
for (const id of ["btnPaint3d", "btnPaint2d", "btnPaintOn"]) { const b = $(id); if (b) b.onclick = togglePaint; }
function paintTargets(){
  const targets = [];
  for (const [name, mesh] of App.meshes) {
    if (!mesh.visible || mesh.userData.effect) continue;
    if (App.matSlot.get(mesh.userData.mat) !== (App.activeSlot && App.activeSlot.id)) continue;
    if (App.selParts.size && !App.selParts.has(name)) continue;
    if (App.protectedParts.has(name)) continue;              // shielded parts never take paint
    targets.push(mesh);
  }
  return targets;
}
// Protection is the inverse of selection: shield the two parts that must stay clean instead
// of selecting the other two hundred that may be painted.
function isPartPaintable(name){
  if (App.protectedParts.has(name)) return false;
  return !App.selParts.size || App.selParts.has(name);
}
function updateSelectionVisuals(){
  const selActive = App.selParts.size > 0;
  for (const [name, mesh] of App.meshes) {
    const m = mesh.material;
    if (m.userData.baseOpacity === undefined) {
      m.userData.baseOpacity = m.opacity; m.userData.baseTransparent = m.transparent;
      m.userData.baseDepthWrite = m.depthWrite;
    }
    const prot = App.protectedParts.has(name);
    const dim = (selActive && !App.selParts.has(name)) || prot;
    m.opacity = dim ? Math.min(prot ? .3 : .13, m.userData.baseOpacity) : m.userData.baseOpacity;
    m.transparent = dim ? true : m.userData.baseTransparent;
    m.depthWrite = dim ? false : m.userData.baseDepthWrite;
  }
}
// The inverse of ray3d's screen→ray mapping: where a point on the model is on screen right now.
// A Shift+click line starts from the previous stroke's end point, and that has to be re-projected
// through the current camera — the view has almost certainly moved since.
function worldToScreen(p){
  const r = cnv3.getBoundingClientRect();
  const v = p.clone().project(camera);
  return { x: r.left + (v.x * .5 + .5) * r.width, y: r.top + (-v.y * .5 + .5) * r.height };
}
// A deliberate line may span the whole viewport, so it gets a far higher sub-step budget than a
// single frame of a drag — it is one click, not sixty a second.
const PAINT_LINE_STEPS = 400;
function ray3d(e, allParts){
  const r = cnv3.getBoundingClientRect();
  const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const targets = allParts ? [...App.meshes.values()].filter(x => x.visible && !x.userData.effect) : paintTargets();
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0] : null;
}
// ---------- Brush ring ----------
// Brush size is set in texture pixels, which says nothing about how big the footprint is on the
// model: the same 48-texel brush covers half a drop tank and a hand's width of fuselage. So the
// ring is not a fixed screen circle — it is the real footprint, laid on the surface under the
// cursor and sized through the hit triangle's own texels-per-metre (the same measurement the seam
// detection uses). A second, inner ring shows where a soft brush stops being opaque.
let brushRing = null;
function ensureBrushRing(){
  if (brushRing) return brushRing;
  brushRing = new THREE.Group();
  const mk = (inner, opacity) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(inner, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 999;
    return m;
  };
  brushRing.add(mk(0.94, 0.95));       // the edge
  brushRing.add(mk(0.965, 0.4));       // the hardness falloff, scaled below
  brushRing.visible = false;
  scene.add(brushRing);
  return brushRing;
}
function hideBrushRing(){ if (brushRing && brushRing.visible) { brushRing.visible = false; needsRender(); } }
const RING_Z = new THREE.Vector3(0, 0, 1);
function updateBrushRing(e){
  if (!App.paint3d || !modelGroup || cam.fly || App.placing) { hideBrushRing(); return; }
  const s = App.activeSlot;
  if (!s || !s.composite) { hideBrushRing(); return; }
  const hit = ray3d(e);                       // paintable targets only: it shows where paint lands
  if (!hit || !hit.uv || !hit.face) { hideBrushRing(); return; }
  const dens = faceTexelDensity(hit, s.composite.width, s.composite.height);
  if (!dens) { hideBrushRing(); return; }
  const r = (App.brush.size / 2) / dens;      // texels → world units
  const ring = ensureBrushRing();
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  ring.position.copy(hit.point).addScaledVector(n, Math.max(r * .02, cam.dist * 4e-4));
  ring.quaternion.setFromUnitVectors(RING_Z, n);
  ring.children[0].scale.set(r, r, 1);
  const hard = Math.max(0, Math.min(1, App.brush.hardness));
  ring.children[1].scale.set(r * hard, r * hard, 1);
  // Only for a tip Hardness shapes: a rivet, a chip or a loaded image carries its own edge (4.50 (10)).
  ring.children[1].visible = hard > .02 && hard < .98 && Tips.of(App.brush).hard;
  ring.visible = true;
  brushStamp.warm();                            // a stroke may be about to start: have its stamp ready
  needsRender();
}
// Both brush indicators — the ring laid on the model and the circle on the sheet — are drawn
// where the pointer last was, and both were only ever recomputed by a pointermove. Anything else
// that changes the mapping from pointer to surface left them stale: resizing the viewport (window,
// sidebar drag, hiding the side panels, switching 2D/3D) moved the model under a ring that stayed
// put, `fit` re-framed the sheet under a circle that did not follow, and changing the brush size
// with [ / ] or Alt+wheel resized the brush without resizing either indicator. So the last pointer
// position is kept and replayed whenever any of that happens.
let lastPtr3 = null;
function refreshBrushCursor(){
  if (lastPtr3) { syncCamera(); updateBrushRing(lastPtr3); }
  // v2.cursor is a point on the TEXTURE, so it has to be re-derived from the pointer through the
  // current zoom/pan — after a re-fit the same screen position is a different texel.
  if (v2.cursorClient) {
    const p = view2px(v2.cursorClient);
    v2.cursor = { x: p.x, y: p.y };
    draw2D();
  }
}
// Every user-driven layout change goes through here so the indicators cannot be forgotten again.
function resizeViews(refit){
  resize3D();
  resize2D();
  if (refit) fit2DNow();
  refreshBrushCursor();
  needsRender();
}
function symEnabled(){ return $("symOn").checked && modelGroup; }
function symPlane(){
  const sel = $("symAxis").value;
  const a = sel === "auto" ? (App.autoAxis || "z") : sel;
  const base = App.mirrorCenters ? App.mirrorCenters[a] : 0;
  const size = App.modelSize ? App.modelSize[a] : 1;
  return { a, c: base + (App.symOffset || 0) * size * .5 };
}
function mirrorPoint(p){
  const { a, c } = symPlane();
  const q = p.clone(); q[a] = 2 * c - q[a];
  return q;
}
// Translucent plane showing where the mirror axis sits, so symmetry is legible in 3D.
//
// PlaneGeometry lies in its own local XY, so which two WORLD axes it spans depends on the rotation
// applied below: mirroring on z leaves it in x/y, on x it turns about y (local X becomes world z),
// and on y it turns about x (local Y becomes world z). Sizing it to the model's extent on exactly
// those two — rather than to `max(size) * 1.5` on both — is what makes it read as the vehicle's
// centreline instead of as a wall standing well past the nose and tail (ROADMAP 3.13).
const SYM_PLANE_SPAN = { x: ["z", "y"], y: ["x", "z"], z: ["x", "y"] };
let symPlaneMesh = null, symPlaneTimer = null;
function showSymPlane(persist){
  if (!modelGroup || !App.modelSize || !App.mirrorCenters) return;
  const { a, c } = symPlane();
  if (!symPlaneMesh) {
    symPlaneMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false }));
    symPlaneMesh.renderOrder = 998;
    scene.add(symPlaneMesh);
  }
  const s = App.modelSize, [u, v] = SYM_PLANE_SPAN[a];
  symPlaneMesh.scale.set(s[u] * 1.06, s[v] * 1.06, 1);
  // Centred on the MODEL on the two axes it spans, not on `mirrorCenters` — those are medians of
  // mirrored part midpoints (or a voxel scan), which are only meaningful on the mirror axis itself
  // and can sit well off the model's middle on the other two. That did not show while the quad was
  // 1.5× the longest side; sized to fit, it would hang off one end.
  const ctr = App.modelCenter || App.mirrorCenters;
  symPlaneMesh.position.set(ctr.x, ctr.y, ctr.z);
  symPlaneMesh.position[a] = c;
  symPlaneMesh.rotation.set(0, 0, 0);
  if (a === "x") symPlaneMesh.rotation.y = Math.PI / 2;
  else if (a === "y") symPlaneMesh.rotation.x = Math.PI / 2;
  symPlaneMesh.visible = true;
  clearTimeout(symPlaneTimer);
  if (!persist) symPlaneTimer = setTimeout(hideSymPlane, 1400);
}
function hideSymPlane(){ if (symPlaneMesh) symPlaneMesh.visible = false; }
// The plane has a switch of its own (ROADMAP 3.13). It used to be `symOn ? show : hide`, so keeping
// mirrored painting meant keeping a translucent quad drawn through the middle of the vehicle — in
// the same view you are painting in, tinting everything behind it. The three states are "off",
// "always", and the default "adjust", which is the 1400 ms auto-hide `showSymPlane(false)` already
// implemented: it appears while you are changing symmetry and then gets out of the way.
//
// `preview` is what says "the user is adjusting symmetry right now" — hovering a symmetry row,
// changing the axis, dragging the offset. Note the callers bind `() => updateSymPlane()` rather
// than passing the function itself: an Event object is truthy, and every one of these fires with
// one.
function updateSymPlane(preview){
  const m = $("symPlaneVis").value;
  if (m === "off" || (m === "adjust" && !preview)) { hideSymPlane(); return; }
  showSymPlane(m === "always");
}
// One cast of an arbitrary ray at the paintable parts — what the mirror and every radial copy
// (ROADMAP 4.44's eighth candidate) each do to the camera's own ray before casting it again.
function hitFromRay(o, d){
  const rc = new THREE.Raycaster(o, d.clone().normalize());
  const hits = rc.intersectObjects(paintTargets(), false);
  return hits.length ? hits[0] : null;
}
// The camera's ray, reflected in the mirror plane.
function mirrorRay(o, d){
  const { a, c } = symPlane();
  const o2 = o.clone(), d2 = d.clone();
  o2[a] = 2 * c - o2[a]; d2[a] = -d2[a];
  return { o: o2, d: d2 };
}
function mirrorHit(){
  const m = mirrorRay(raycaster.ray.origin, raycaster.ray.direction);
  return hitFromRay(m.o, m.d);
}
// ---- radial symmetry (ROADMAP 4.44, eighth candidate) ----
// The same trick as the mirror, with a turn instead of a reflection: the camera's ray is rotated
// about the picked axis and cast again, so copy k is a real hit on the real surface. Where the
// shape is not in fact symmetric — a wheel with a valve stem on one side — the copy simply misses
// and nothing is stamped, which is the honest answer and costs one raycast.
//
// The centre has to be PICKED. Measured 2026-09-22 over real DynModels: a part's own bounding box
// does not give the axle (an a6m2's `wheel_l` is modelled with its strut, so its box is thin on y
// while the axle runs on z), so there is nothing to infer it from. The armed button below waits for
// a click, and takes the axis from that hit's own surface normal unless one is named.
function radialCount(){
  const R = App.radial;
  if (!R || !(R.n > 1) || !R.c || !R.dir || !modelGroup) return 1;
  // A centre picked on another vehicle is a centre in the wrong place. The identity is the one the
  // position bake uses (editor/bake.js) — the first non-weapon group — because `App.geomData` is a
  // new array every time a store is hung and that is not a new vehicle.
  if (R.geom !== Bake.vehicleGeom().first) return 1;
  return Math.min(Radial.MAX, R.n | 0);
}
// Copy k's hit, and its mirror. `raycaster.ray` is where the pointer is now — set by the ray3d()
// that found the stroke's own hit, the same thing mirrorHit() reads.
function radialRay(k){
  const R = App.radial;
  const r = Radial.ray(raycaster.ray.origin.toArray(), raycaster.ray.direction.toArray(), R.c, R.dir, Radial.step(radialCount(), k));
  return { o: new THREE.Vector3(r.o[0], r.o[1], r.o[2]), d: new THREE.Vector3(r.d[0], r.d[1], r.d[2]) };
}
function radialHit(k){
  if (radialCount() < 2) return null;
  const r = radialRay(k);
  return hitFromRay(r.o, r.d);
}
function radialMirrorHit(k){
  if (radialCount() < 2) return null;
  const r = radialRay(k), m = mirrorRay(r.o, r.d);
  return hitFromRay(m.o, m.d);
}
// A hit's surface normal in world space. `face.normal` is in the object's own space, which is the
// same thing only while the object's matrix is the identity — it is not, for a store hung on a
// pylon (ROADMAP 4.46).
function hitNormal(hit){
  if (!hit || !hit.face) return null;
  const n = hit.face.normal.clone();
  if (hit.object) n.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
  return n.normalize().toArray();
}
// The armed click: this point is the centre, and — on "auto" — this surface's normal is the axis.
function setRadialCentre(hit){
  if (!hit || !hit.point) return false;
  const R = App.radial = App.radial || { n: 1, axis: "auto", c: null, dir: null };
  const dir = Radial.dirOf(R.axis, hitNormal(hit));
  if (!dir) { setStatus("That face has no normal to take an axis from — name one (X / Y / Z) beside the count", "err"); return false; }
  R.c = hit.point.toArray();
  R.dir = dir;
  R.geom = Bake.vehicleGeom().first;
  return true;
}
// The gizmo, with the mirror plane's own three-state visibility (§3.13's rule, not a second
// setting): a thin rod along the axis through the centre, as long as the model is wide.
let radialAxisMesh = null, radialAxisTimer = null;
function showRadialAxis(persist){
  const R = App.radial;
  if (!R || !R.c || !R.dir || !modelGroup) return;
  if (!radialAxisMesh) {
    radialAxisMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: .55, depthWrite: false }));
    radialAxisMesh.renderOrder = 998;
    scene.add(radialAxisMesh);
  }
  const s = App.modelSize, span = s ? Math.max(s.x, s.y, s.z) : 1;
  radialAxisMesh.scale.set(span * .004, span * 1.1, span * .004);
  radialAxisMesh.position.set(R.c[0], R.c[1], R.c[2]);
  // CylinderGeometry stands on its local +y, so the rod is turned from that onto the axis
  radialAxisMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(R.dir[0], R.dir[1], R.dir[2]).normalize());
  radialAxisMesh.visible = true;
  clearTimeout(radialAxisTimer);
  if (!persist) radialAxisTimer = setTimeout(hideRadialAxis, 1400);
  needsRender();
}
function hideRadialAxis(){ if (radialAxisMesh) { radialAxisMesh.visible = false; needsRender(); } }
// Both gizmos follow the one setting, so "While adjusting" means the same thing for each.
function updateRadialAxis(persist){
  const mode = $("symPlaneVis").value;
  if (mode === "off" || radialCount() < 2) { hideRadialAxis(); return; }
  showRadialAxis(persist || mode === "always");
}
