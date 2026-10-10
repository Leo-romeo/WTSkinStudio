// ---------- 3D ----------
let renderer, scene, camera, raycaster = null, modelGroup = null, envRT = null;
const cam = { theta: .8, phi: 1.15, dist: 20, target: null, fly: false, yaw: 0, pitch: 0, flyPos: null, flySpeed: 8,
  glide: null };                                    // an in-flight Framing.glide, stepped by syncCamera
function init3D(){
  const cnv = $("view3d");
  renderer = new THREE.WebGLRenderer({ canvas: cnv, antialias: true });
  // three.js asks the driver for LINK_STATUS and the info log the moment a program is built, and
  // that query blocks until the (asynchronous) link has finished — 754 ms of one 58 s profile,
  // taken as a stall in the middle of a frame. Every material here also carries an
  // onBeforeCompile, so programs are built as the model and its stores stream in, which is the
  // worst moment for it. Append ?shadererrors to the URL to put the checking back while editing
  // a shader; a broken program is otherwise reported by the driver on the console anyway.
  renderer.debug.checkShaderErrors = /[?&]shadererrors\b/.test(location.search);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene();
  // Through the select, never a second literal beside it. The default used to be written twice —
  // here and in the markup's first <option> — and only the markup is what 3.12's PREFS table
  // captures as `def`, so the scene and the control it is named by could disagree on a fresh
  // install and the Reset button would put back the one this line did not use. ROADMAP 3.24.
  setBackground($("optBg").value);
  camera = new THREE.PerspectiveCamera(45, 1, .05, 500);
  cam.target = new THREE.Vector3(0, 0, 0);
  // the user's hand on the view ends any glide the app started (Framing.glide)
  for (const ev of ["pointerdown", "wheel"]) cnv.addEventListener(ev, () => { cam.glide = null; }, { passive: true, capture: true });
  raycaster = new THREE.Raycaster();
  const hemi = new THREE.HemisphereLight(0xcfd8e8, 0x2a2d33, .5);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, .65); dir.position.set(5, 8, 4); scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0x9db4d6, .22); dir2.position.set(-6, -3, -5); scene.add(dir2);
  App.lights = [hemi, dir, dir2];
  App.keyLight = dir;
  applyLightDir();
  // simple procedural environment for metals
  const envScene = new THREE.Scene();
  const grad = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 12),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x8797ad }));
  envScene.add(grad);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  top.position.y = 20; top.rotation.x = Math.PI / 2; envScene.add(top);
  const pmrem = new THREE.PMREMGenerator(renderer);
  envRT = pmrem.fromScene(envScene, .04);
  scene.environment = envRT.texture;
  resize3D();
  animate();
}
function resize3D(){
  const wrap = $("view3dwrap");
  // a hidden pane reports 0×0 — that would make camera.aspect NaN and poison the projection matrix
  const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
let lastFrameT = performance.now();
function flyDir(){
  return new THREE.Vector3(Math.cos(cam.pitch) * Math.cos(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.sin(cam.yaw));
}
// Render on demand: the previous loop drew 60 fps forever even on a motionless view.
// needsRender() keeps drawing for a short window afterwards so transitions and late texture
// uploads land; any user input also opens that window, which makes this safe to get wrong.
let renderUntil = 0;
function needsRender(ms){ renderUntil = Math.max(renderUntil, performance.now() + (ms || 260)); }
for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup"])
  window.addEventListener(ev, () => needsRender(), { passive: true, capture: true });
// Put the camera where cam{} says it should be. Split out of animate() because a raycast taken
// straight after a zoom or an orbit — the brush ring is one — has to see this frame's camera, not
// the one the last render left behind.
function syncCamera(){
  if (cam.glide) Framing.step();
  if (cam.fly && cam.flyPos) {
    const dir = flyDir();
    camera.position.copy(cam.flyPos);
    camera.lookAt(cam.flyPos.clone().add(dir));
  } else {
    const t = cam.target;
    camera.position.set(
      t.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta),
      t.y + cam.dist * Math.cos(cam.phi),
      t.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.lookAt(t);
  }
  camera.updateMatrixWorld();
}
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now(), dt = Math.min(.1, (now - lastFrameT) / 1000);
  lastFrameT = now;
  if (now > renderUntil && !(cam.fly && flyKeys.size)) return;
  if (cam.fly && cam.flyPos) {
    const dir = flyDir();
    const right = new THREE.Vector3(-Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
    const v = new THREE.Vector3();
    if (flyKeys.has("KeyW")) v.add(dir);
    if (flyKeys.has("KeyS")) v.sub(dir);
    if (flyKeys.has("KeyD")) v.add(right);
    if (flyKeys.has("KeyA")) v.sub(right);
    if (flyKeys.has("KeyE")) v.y += 1;
    if (flyKeys.has("KeyQ")) v.y -= 1;
    if (v.lengthSq()) {
      const fast = flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight") ? 4 : 1;
      cam.flyPos.addScaledVector(v.normalize(), cam.flySpeed * fast * dt);
    }
  }
  syncCamera();
  if (App.lightFollow && App.keyLight) {                       // headlight: key light rides the camera
    App.keyLight.position.copy(camera.position);
    if (cam.target) App.keyLight.target.position.copy(cam.target), App.keyLight.target.updateMatrixWorld();
  }
  SelOverlay.sync();                                           // the selection, on the model
  ProjHandles.sync();                                          // a projected decal's handles (ROADMAP 4.2)
  PathOverlay.sync();                                          // the shape tool's path on the model (6.1b)
  renderer.render(scene, camera);
}
// Position the key light from the azimuth/elevation sliders (when not following the camera).
function applyLightDir(){
  if (!App.keyLight) return;
  const az = (+$("lightAz").value) * Math.PI / 180, el = (+$("lightEl").value) * Math.PI / 180, r = 12;
  App.keyLight.position.set(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
}
// Background: solid colour, custom colour, or a soft studio gradient.
let bgGradTex = null;
function studioGradientTexture(){
  if (bgGradTex) return bgGradTex;
  const c = mkCanvas(4, 256), g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#3a4653"); grd.addColorStop(.5, "#20262e"); grd.addColorStop(1, "#0c0e12");
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  bgGradTex = new THREE.CanvasTexture(c);
  return bgGradTex;
}
function setBackground(val){
  if (!scene) return;
  if (val === "grad") scene.background = studioGradientTexture();
  else if (val === "#custom") scene.background = new THREE.Color($("optBgCustom").value);
  else scene.background = new THREE.Color(val);
  needsRender();
}
// Slide the camera sideways across the view. `dx`/`dy` are pointer pixels.
//
// The basis is the CAMERA'S OWN right and up (columns 0 and 1 of its world matrix), never a vector
// rebuilt from cam.theta. It was rebuilt from theta once, with three.js's spherical convention —
// (sinφ·sinθ, cosφ, sinφ·cosθ) — while syncCamera() above places the camera with
// (sinφ·cosθ, cosφ, sinφ·sinθ). The axes are swapped between the two, so "right" came out 90° from
// screen-right and the error rotated with theta: a pan pushed the target along the VIEW axis and
// the model shot off into the distance as soon as you had orbited. Reported 2026-08-23.
//
// Taking the basis from the matrix cannot drift from syncCamera again, and it also fixes panning
// while looking straight down, where world-up is not screen-up at all. Gated by tools/t48_camera.mjs.
function panCamera(dx, dy){
  const sc = cam.dist / 700;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  cam.target.addScaledVector(right, -dx * sc);
  cam.target.addScaledVector(up, dy * sc);
  syncCamera();                     // the pan is done; keep the camera and its matrix in step
}
function setPivotFromPosition(pos){
  const d = pos.clone().sub(cam.target);
  cam.dist = Math.max(.01, d.length());
  cam.phi = Math.acos(Math.max(-1, Math.min(1, d.y / cam.dist)));
  cam.theta = Math.atan2(d.z, d.x);
}
function setPivot(p){
  const cp = camera.position.clone();
  cam.target.copy(p);
  setPivotFromPosition(cp);
}
function setFly(on){
  if (!!cam.fly === !!on) return;
  if (on) {
    cam.flyPos = camera.position.clone();
    const d = cam.target.clone().sub(camera.position).normalize();
    cam.yaw = Math.atan2(d.z, d.x);
    cam.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    cam.flySpeed = modelGroup ? Math.max(1, cam.dist * .6) : 8;
    if (App.paint3d) setPaint3d(false);
  } else {
    cam.target.copy(cam.flyPos.clone().add(flyDir().multiplyScalar(cam.dist)));
    setPivotFromPosition(cam.flyPos);
  }
  cam.fly = on;
  $("btnFly").classList.toggle("active", on);
  $("btnFly").textContent = on ? "Fly: WASD" : "Fly";
  setStatus(on ? "Fly mode — WASD move, Q/E down/up, Shift fast, left-drag look, wheel speed, F exits" : "Orbit mode", "ok");
}
function frameModel(view){
  if (view === "seat") { Cockpit.seat(); return; }     // the pilot's eye, from the unit's own blk (ROADMAP 4.14)
  if (!modelGroup) return;
  if (cam.fly) setFly(false);
  const box = new THREE.Box3().setFromObject(modelGroup);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  cam.target.copy(c);
  cam.dist = Math.max(s.x, s.y, s.z) * 1.25;
  const mA = App.autoAxis || "z";           // left-right axis
  const fTheta = mA === "z" ? 0 : Math.PI / 2;   // forward = the other horizontal axis
  const sTheta = mA === "z" ? Math.PI / 2 : 0;
  const V = {
    reset: [.8, 1.15], iso: [.8, 1.15],
    front: [fTheta, Math.PI / 2.15], back: [fTheta + Math.PI, Math.PI / 2.15],
    left: [sTheta, Math.PI / 2.15], right: [sTheta + Math.PI, Math.PI / 2.15],
    top: [.0001 + fTheta, .04], bottom: [.0001 + fTheta, Math.PI - .04],
  }[view] || [.8, 1.15];
  cam.theta = V[0]; cam.phi = V[1];
}
// ---- framings the app chooses rather than the user (ROADMAP 4.38) ----
// One object, not three globals (CLAUDE.md §5). A gentle move: the ORBIT STATE is interpolated, not the camera's position: a straight line between two points
// on an orbit is the chord, which goes through the model. Ease-out, so it arrives rather than
// stops; θ takes the shorter way round. syncCamera steps it, so a raycast taken mid-glide sees the
// camera the frame was drawn with, and any pointer or wheel on the canvas cancels it (init3D) —
// a glide that fights a drag is worse than no glide.
const Framing = {
  glide(goal, ms){
    cam.glide = null;
    if (!(ms > 0)) { cam.theta = goal.theta; cam.phi = goal.phi; cam.dist = goal.dist; cam.target.copy(goal.target); return; }
    const dTheta = Math.atan2(Math.sin(goal.theta - cam.theta), Math.cos(goal.theta - cam.theta));
    cam.glide = { t0: performance.now(), ms,
      from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone() },
      to: { theta: cam.theta + dTheta, phi: goal.phi, dist: goal.dist, target: goal.target.clone() } };
    needsRender(ms + 120);
  },
  step(){
    const g = cam.glide;
    const u = Math.min(1, (performance.now() - g.t0) / g.ms);
    const e = 1 - Math.pow(1 - u, 3);
    cam.theta = g.from.theta + (g.to.theta - g.from.theta) * e;
    cam.phi = g.from.phi + (g.to.phi - g.from.phi) * e;
    cam.dist = g.from.dist + (g.to.dist - g.from.dist) * e;
    cam.target.copy(g.from.target).lerp(g.to.target, e);
    if (u >= 1) cam.glide = null;
  },
  // ---- the view for the loadout job ----
  // The in-game loadout screen looks at the aircraft from the front and a little below, where every
  // pylon and what hangs from it is in sight. The distance is FITTED rather than a multiple of the
  // longest side: the eight corners of the model's box are projected on the camera's own right and
  // up and the camera backs off until the wider of the two fits its field of view — so a Pe-8 and a
  // Bf 109 both fill the frame, which `max(size) × 1.25` does for neither (a wingspan seen end-on is
  // the model's long side; from the front it is its width, and the two differ by 2× on a bomber).
  // The nose is +x — measured over the roster, see ArmBuild.hardpoints — which is where the Front
  // preset already looks from. Returns the goal it glides to, or null when there is nothing to frame.
  weapons(ms){
    if (!modelGroup) return null;
    if (cam.fly) setFly(false);
    const box = new THREE.Box3().setFromObject(modelGroup);
    const c = box.getCenter(new THREE.Vector3());
    const theta = (App.autoAxis || "z") === "z" ? 0 : Math.PI / 2;
    const phi = Math.PI / 2 + .32;                              // ~18° below the horizon, looking up
    // the camera's own basis for that direction, the way lookAt builds it: z toward the eye
    const zc = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const xc = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zc).normalize();
    const yc = new THREE.Vector3().crossVectors(zc, xc);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tanH = tanV * camera.aspect;
    let dist = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      // a corner at lateral offset w, depth d toward the eye, fits when dist ≥ d + w / tan(half-fov)
      dist = Math.max(dist, p.dot(zc) + Math.max(Math.abs(p.dot(xc)) / tanH, Math.abs(p.dot(yc)) / tanV));
    }
    const goal = { theta, phi, dist: dist * 1.06, target: c };
    this.glide(goal, ms);
    return goal;
  },
};
$("camPreset").onchange = e => { frameModel(e.target.value); e.target.selectedIndex = 0; };
$("btnFly").onclick = () => setFly(!cam.fly);
function disposeModelGroup(){
  hideBrushRing();
  // The selection overlay SHARES its geometry with the part it sits on, so it has to come off
  // before the traverse below — which would otherwise hand the same BufferGeometry to dispose()
  // twice, once through the part and once through the overlay riding on it.
  SelOverlay.reset();
  if (!modelGroup) return;
  scene.remove(modelGroup);
  modelGroup.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material.dispose) o.material.dispose();   // materials leaked on every rebuild
  });
  modelGroup = null;
}
