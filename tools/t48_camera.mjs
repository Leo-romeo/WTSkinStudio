// Panning must slide the view sideways, never push it away.
//
// Reported by the owner 2026-08-23: "at first everything is fine, but as soon as I rotate, pan
// breaks — the model flies off into the distance". The cause was two spherical conventions in one
// file. `syncCamera()` places the camera at
//     target + dist · (sinφ·cosθ, cosφ, sinφ·sinθ)
// while the pan basis was rebuilt with three.js's `setFromSphericalCoords`, which is
//     (sinφ·sinθ, cosφ, sinφ·cosθ)
// — θ and the axes swapped. The resulting "right" vector sat 90° from screen-right, and because the
// error turned with θ it was invisible at the starting angle and total after an orbit: the pan slid
// the target along the VIEW axis, which is exactly "the model flies away".
//
// THE INVARIANT, and the reason this test is short: a pan is a translation ACROSS the view, so the
// target must never move along the view direction. `|Δtarget · viewDir|` is the whole bug in one
// number. It was ~1.0 (all of the motion was along the view) and is now ~0.
//
// Usage: node tools/t48_camera.mjs [--keep] [--chrome <path>]
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = { cases: [] };
  var V = THREE.Vector3;

  // Every angle a user can actually get to, including looking almost straight down, where the old
  // world-up approximation was wrong even before the convention mismatch.
  var ANGLES = [
    { theta: 0,    phi: 1.15, name: "start" },
    { theta: 0.8,  phi: 1.15, name: "default view" },
    { theta: 1.9,  phi: 1.15, name: "orbited a quarter turn" },
    { theta: 3.3,  phi: 0.9,  name: "orbited past half" },
    { theta: 5.1,  phi: 1.4,  name: "orbited three quarters" },
    { theta: 2.2,  phi: 0.12, name: "looking almost straight down" },
    { theta: 4.4,  phi: 3.0,  name: "looking almost straight up" }
  ];

  for (var i = 0; i < ANGLES.length; i++) {
    var a = ANGLES[i];
    cam.fly = false;
    cam.theta = a.theta; cam.phi = a.phi; cam.dist = 20;
    cam.target.set(0, 0, 0);
    syncCamera();

    var camPos0 = camera.position.clone();
    var viewDir = cam.target.clone().sub(camPos0).normalize();
    var right0 = new V().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    var up0 = new V().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    var t0 = cam.target.clone();

    panCamera(120, 0);                       // drag right
    var dH = cam.target.clone().sub(t0);
    cam.target.copy(t0); syncCamera();
    panCamera(0, 120);                       // drag down
    var dV = cam.target.clone().sub(t0);
    cam.target.copy(t0); syncCamera();

    out.cases.push({
      name: a.name,
      // the bug, as one number: how much of the pan went along the view axis
      alongViewH: Math.abs(dH.dot(viewDir)) / Math.max(1e-9, dH.length()),
      alongViewV: Math.abs(dV.dot(viewDir)) / Math.max(1e-9, dV.length()),
      // and that each drag axis maps to the matching screen axis
      hOnRight: dH.clone().normalize().dot(right0),
      vOnUp: dV.clone().normalize().dot(up0),
      hLen: +dH.length().toFixed(3), vLen: +dV.length().toFixed(3)
    });
  }

  // A pan must not change how far away the model is. dist is the only thing zoom owns.
  cam.theta = 0.8; cam.phi = 1.15; cam.dist = 20; cam.target.set(0, 0, 0); syncCamera();
  var d0 = cam.dist;
  for (var k = 0; k < 12; k++) panCamera(37, -21);
  out.distAfterPanning = cam.dist;
  out.distUnchanged = Math.abs(cam.dist - d0) < 1e-9;

  // and the camera must actually follow the target, not be left behind
  var offset = camera.position.clone().sub(cam.target).length();
  out.offsetKept = Math.abs(offset - cam.dist) < 1e-3;

  // ---- the mode has to be visible on the cursor, not only on a button across the screen
  var cnv = document.getElementById("view3d");
  var cur = function(){ refreshViewCursor(); return cnv.style.cursor || "(none)"; };
  out.cursor = {};
  App.paint3d = false; App.placing = false; App.projHover = false; App.projDragging = false;
  out.cursor.idle = cur();
  App.paint3d = true;                       out.cursor.painting = cur();
  App.paint3d = false; App.placing = "radial"; out.cursor.placing = cur();
  // A decal is dragged directly since 2026-10-17 — no Moving mode: off it the view is the idle one,
  // over it the pointer is a grab, holding it a closed hand.
  App.placing = false;                      out.cursor.moveArmed = cur();
  App.projHover = true;                     out.cursor.moveOverDecal = cur();
  App.projDragging = true;                  out.cursor.moveDragging = cur();
  App.projDragging = false; App.projHover = false;

  // ---- and the two modes must not both be on at once
  App.placing = "radial"; App.paint3d = false;
  setPaint3d(true);
  out.paintClearsPlacing = App.placing === false && App.paint3d === true;
  setPlacing("radial");
  out.placingClearsPaint = App.paint3d === false && App.placing === "radial";
  setPlacing(false);

  // ---- ROADMAP 4.38: the loadout view. From the front and a little below, at a distance FITTED
  // to the model's own box, so a fighter and a heavy bomber both fill the frame. Two synthetic
  // airframes stand in — a box the size of a Bf 109 (x length, y height, z span) and one the
  // size of a Pe-8 — off-centre, so a fit that assumed the origin would show.
  out.frame = [];
  var keepGroup = modelGroup, keepAxis = App.autoAxis;
  try {
    App.autoAxis = "z";
    var SIZES = [{ name: "Bf 109-sized", s: [9, 3, 10] }, { name: "Pe-8-sized", s: [24, 6, 40] }];
    for (var si = 0; si < SIZES.length; si++) {
      var sz = SIZES[si].s;
      modelGroup = new THREE.Group();
      var m = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]));
      m.position.set(3, -1.5, 2);
      modelGroup.add(m);
      modelGroup.updateMatrixWorld(true);
      cam.fly = false; cam.theta = 2.5; cam.phi = 0.6; cam.dist = 300; cam.target.set(50, 50, 50);
      var goal = Framing.weapons(0);
      syncCamera(); camera.updateProjectionMatrix();
      var box = new THREE.Box3().setFromObject(modelGroup);
      var c = box.getCenter(new V());
      var worst = 0, inside = true;
      for (var k = 0; k < 8; k++) {
        var p = new V(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera);
        var e = Math.max(Math.abs(p.x), Math.abs(p.y));
        if (e > 1 || p.z > 1) inside = false;
        worst = Math.max(worst, e);
      }
      out.frame.push({ name: SIZES[si].name, inFront: camera.position.x > box.max.x, below: camera.position.y < c.y,
        fits: inside, fill: +worst.toFixed(3), dist: +cam.dist.toFixed(2), longest: Math.max(sz[0], sz[1], sz[2]),
        targetOnCentre: cam.target.distanceTo(c) < 1e-6, glideNull: cam.glide === null, goalDist: goal && +goal.dist.toFixed(2) });
    }
    // and the gentle version: the state is not there yet on return, and is there once the glide
    // has run its course (stepped by syncCamera, which is what the frame loop calls)
    cam.theta = 2.5; cam.phi = 0.6; cam.dist = 300; cam.target.set(50, 50, 50);
    var g2 = Framing.weapons(300);
    syncCamera();
    var mid = { dist: cam.dist, glide: !!cam.glide };
    await new Promise(function(r){ setTimeout(r, 450); });
    syncCamera();
    out.glide = { started: mid.glide, notYetThere: Math.abs(mid.dist - g2.dist) > 1, arrived: Math.abs(cam.dist - g2.dist) < 1e-6 && cam.glide === null,
      thetaThere: Math.abs(cam.theta - g2.theta) < 1e-6, targetThere: cam.target.distanceTo(g2.target) < 1e-6 };
    // a hand on the view ends it
    cam.theta = 2.5; cam.dist = 300;
    Framing.weapons(300);
    // a wheel rather than a synthetic pointerdown: the paint handler captures the pointer, which a
    // synthetic event has no id for, and that throw is not the thing under test
    document.getElementById("view3d").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 1 }));
    out.glideCancelled = cam.glide === null;
  } finally { modelGroup = keepGroup; App.autoAxis = keepAxis; cam.glide = null; }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 700), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("=== a pan slides across the view, never along it ===");
for (const c of r.cases) {
  const worst = Math.max(c.alongViewH, c.alongViewV);
  R.is(worst < 0.001,
    `${c.name.padEnd(28)} ${(worst * 100).toFixed(3)}% of the pan went along the view axis`);
}
console.log("\n=== and each drag axis maps to the matching screen axis ===");
for (const c of r.cases) {
  R.is(c.hOnRight < -0.999 && c.vOnUp > 0.999,
    `${c.name.padEnd(28)} horizontal→right ${c.hOnRight.toFixed(3)}, vertical→up ${c.vOnUp.toFixed(3)}`);
}
console.log("\n=== panning is not zooming ===");
R.is(r.distUnchanged, `twelve pans leave the distance alone — ${r.distAfterPanning}`);
R.is(r.offsetKept, "and the camera stays exactly dist away from the target it is looking at");

console.log("\n=== the cursor says which mode you are in ===");
const c = r.cursor || {};
R.is(c.idle === "(none)", `idle is the plain arrow — ${c.idle}`);
R.is(c.painting === "crosshair", `painting is a crosshair — ${c.painting}`);
R.is(c.placing === "crosshair", `an armed click (the radial centre) is a crosshair — ${c.placing}`);
R.is(c.moveArmed === "(none)", `off a decal the view is the plain arrow, where a drag orbits — ${c.moveArmed}`);
R.is(c.moveOverDecal === "grab", `over the decal it becomes a grab — ${c.moveOverDecal}`);
R.is(c.moveDragging === "grabbing", `and a closed hand while dragging it — ${c.moveDragging}`);
console.log("\n=== painting and a placing mode are mutually exclusive ===");
R.is(r.paintClearsPlacing, "turning painting on drops an armed click");
R.is(r.placingClearsPaint, "and arming a click turns painting off");

console.log("\n=== the loadout view (ROADMAP 4.38): front, a little below, fitted to the model ===");
for (const f of r.frame || []) {
  R.is(f.inFront && f.below, `${f.name.padEnd(13)} the camera is in front of the nose and below the centreline`);
  R.is(f.fits, `${"".padEnd(13)} every corner of its box is inside the frame`);
  // "fills" — the tightest corner is near the edge. 1.06 margin on a fit that is exact at one
  // corner puts that corner at ≈ 1/1.06 = 0.94 of the half-frame.
  R.is(f.fill > 0.85, `${"".padEnd(13)} and it fills it: the tightest corner sits at ${f.fill} of the half-frame (dist ${f.dist} for a ${f.longest} m longest side)`);
  R.is(f.targetOnCentre && f.glideNull && f.goalDist === f.dist, `${"".padEnd(13)} looking at the box's centre, instantly when asked for no glide`);
}
const g = r.glide || {};
R.is(g.started && g.notYetThere, "asked to glide, the camera has not arrived when the call returns");
R.is(g.arrived && g.thetaThere && g.targetThere, "and is exactly at the goal once the glide has run — distance, angle and target");
R.is(r.glideCancelled, "a pointer on the canvas ends a glide, so it never fights a drag");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
