// What `applyPose` does to the scene (ROADMAP 2.4, the oracle before the split).
//
// WHY THIS EXISTS. `applyPose` is 97 lines and on 2.4's list, and between them `t22_pose.mjs`
// (which builds rigs from real models but never applies one) and `t76_tankrig.mjs` (which applies
// the inferred path to a tank) nothing held the other half: the BAKED path, where a clip's deltas
// become mesh matrices, and the rule that anything no longer posed is put back. Both are exact:
//
//   * a baked delta is applied **conjugated by diag(1, 1, −1)** — skeleton space has +Z where the
//     extracted geometry has −Z, and a conjugation is not a single multiply: reflecting on one
//     side only lands the part mirrored. Held here against a delta whose answer is arithmetic;
//   * every mesh of a baked node takes it, and a node the clip does not key is left alone;
//   * a mesh that was posed and is not any more goes back to the identity **and back to
//     matrixAutoUpdate**, or it stays frozen at the last pose for the rest of the session;
//   * the inferred path rotates about the pivot, not about the origin — a rotation that forgot the
//     translate-out/translate-back would swing the part around the model's centre instead;
//   * a control's slider at rest changes nothing at all.
//
// The clip itself is stubbed: `a2dDeltas` is the decoder's own function and is held byte-exact by
// `t27_a2d.mjs` over real vehicles. What is untested is what applyPose DOES with what it returns,
// which is what this asks.
//
// Usage: node tools/t77_pose.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  // ---- a two-node model: a hull and a flap hinged 1 m out along x, 2 m up ----
  function node(name, o){ return { name: name, wtm: [[1,0,0,o[0]],[0,1,0,o[1]],[0,0,1,o[2]]], children: [], parent: -1 }; }
  var nodes = [node("hull", [0, 0, 0]), node("flap_l", [1, 2, 0])];
  nodes[0].children = [1]; nodes[1].parent = 0;
  var byName = new Map(); nodes.forEach(function(n){ byName.set(n.name, n); });
  nodes.forEach(function(n, i){ n.i = i; });
  // a triangle whose centroid is exactly \`at\` (app space: the extracted geometry has Z negated)
  function tri(name, at){
    var S = .25, pts = [[at[0]+S,at[1],at[2]],[at[0]-S/2,at[1]+S,at[2]+S],[at[0]-S/2,at[1]-S,at[2]-S]];
    var pos = []; pts.forEach(function(p){ pos.push(p[0], p[1], -p[2]); });
    return { name: name, mat: "m", position: new Float32Array(pos), normal: new Float32Array([0,1,0,0,1,0,0,1,0]), uv: new Float32Array(6) };
  }
  var keep = { geom: App.geomData, ex: App.extracted, meshes: App.meshes, pose: App.pose, rig: App._poseRig, rigFor: App._poseRigFor, kind: App.modelKind };
  App.geomData = [tri("hull", [0, 0, 0]), tri("flap_l", [1.4, 2, 0])];
  App.extracted = { geo: { skeleton: { nodes: nodes, byName: byName }, a2d: null } };
  App.modelKind = "air";
  App.meshes = new Map();
  modelGroup = modelGroup || new THREE.Group();
  App.geomData.forEach(function(g){
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.position, 3));
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    m.name = g.name; m.userData = { mat: "m" };
    App.meshes.set(g.name, m);
    modelGroup.add(m);
  });
  App.matSlot = new Map([["m", "t77"]]);
  App.pose = {}; App._poseRig = null; App._poseRigFor = null;
  function centre(name){
    var m = App.meshes.get(name);
    m.updateMatrixWorld(true);
    var a = m.geometry.attributes.position.array, c = [0, 0, 0];
    for (var i = 0; i < a.length; i += 3) { c[0] += a[i]; c[1] += a[i+1]; c[2] += a[i+2]; }
    var v = new THREE.Vector3(c[0] / 3, c[1] / 3, c[2] / 3).applyMatrix4(m.matrixWorld);
    return [v.x, v.y, v.z];
  }
  var rest = { hull: centre("hull"), flap: centre("flap_l") };
  out.rest = rest;

  // ---- 1. the inferred path turns about the pivot ----
  var rig = poseRig();
  out.inferred = rig && rig.get("flaps") ? rig.get("flaps").list.map(function(a){ return { node: a.node, pivot: a.pivot, axis: a.axis, sign: a.sign }; }) : null;
  App.pose = { flaps: 100 };
  applyPose();
  out.flapped = centre("flap_l");
  out.hullStill = centre("hull");
  // the part swings about its own hinge, so it stays within its own reach of it
  out.reach = Math.hypot(out.flapped[0] - 1, out.flapped[1] - 2, out.flapped[2]);
  out.restReach = Math.hypot(rest.flap[0] - 1, rest.flap[1] - 2, rest.flap[2]);

  // ---- 2. put back ----
  App.pose = {};
  applyPose();
  out.putBack = { at: centre("flap_l"), auto: App.meshes.get("flap_l").matrixAutoUpdate, id: App.meshes.get("flap_l").matrix.elements[0] };

  // ---- 2b. a control is offered only if it MOVES (ROADMAP 4.1's aircraft half) ----
  // \`buildA2DRig\` keeps a group when the clip keys a drawn node AND that node actually travels over
  // the slider's range. Both halves are stubbed here: \`a2dWorld\` answers with a skeleton that moves
  // or one that does not, and the rig is asked what it offers.
  var realWorld = a2dWorld, realNames = a2dNodeNames, realIndex = a2dIndexNodes, realRef = a2dRefFrame, realAnim2 = vehicleAnim;
  App.extracted.geo.a2d = { fake: true };
  vehicleAnim = function(){ return App.extracted.geo.a2d; };
  a2dIndexNodes = function(){};
  a2dNodeNames = function(){ return new Set(["flap_l"]); };
  a2dRefFrame = function(){ return 0; };
  var travel = 0;
  a2dWorld = function(a2d, skel, frameOf){
    var f = frameOf("flap_l");
    var w = [];
    for (var i = 0; i < skel.nodes.length; i++) w[i] = [[1,0,0,0],[0,1,0,f ? travel : 0],[0,0,1,0]];
    return w;
  };
  App._poseRig = null; App._poseRigFor = null;
  travel = 0;
  out.deadControl = !!(buildA2DRig() || new Map()).get("flaps");
  travel = .25;
  out.liveControl = !!(buildA2DRig() || new Map()).get("flaps");
  a2dWorld = realWorld; a2dNodeNames = realNames; a2dIndexNodes = realIndex; a2dRefFrame = realRef; vehicleAnim = realAnim2;
  App.extracted.geo.a2d = null;
  App._poseRig = null; App._poseRigFor = null;

  // ---- 3. the baked path: a stubbed clip, and the conjugation held exactly ----
  var realDeltas = a2dDeltas, realAnim = vehicleAnim;
  // a delta that translates +1 on z and turns 90° about y, in SKELETON space
  var D = [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 1]];
  a2dDeltas = function(){ return new Map([["flap_l", D]]); };
  App.extracted.geo.a2d = { fake: true };
  vehicleAnim = function(){ return App.extracted.geo.a2d; };
  // a rig whose flaps entry is baked, built by hand — buildA2DRig needs a real clip to index
  App._poseRig = new Map([["flaps", { src: "a2d", nodes: ["flap_l"], ref: 0 }]]);
  App._poseRigFor = App.geomData;
  App.pose = { flaps: 50 };
  applyPose();
  var m = App.meshes.get("flap_l").matrix.elements;      // column-major
  out.baked = [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
  out.bakedHull = centre("hull");
  // a node the clip does not key is untouched
  out.bakedOther = App.meshes.get("hull").matrixAutoUpdate;
  // …and clearing it puts the mesh back
  a2dDeltas = function(){ return new Map(); };
  App._poseRig = new Map();
  App.pose = {};
  applyPose();
  out.bakedPutBack = { auto: App.meshes.get("flap_l").matrixAutoUpdate, id: App.meshes.get("flap_l").matrix.elements[0] === 1 && App.meshes.get("flap_l").matrix.elements[12] === 0 };
  a2dDeltas = realDeltas; vehicleAnim = realAnim;

  App.geomData = keep.geom; App.extracted = keep.ex; App.meshes = keep.meshes;
  App.pose = keep.pose; App._poseRig = keep.rig; App._poseRigFor = keep.rigFor; App.modelKind = keep.kind;
  App.slots.delete("t77");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(r.inferred && r.inferred.length === 1 && r.inferred[0].node === "flap_l",
  `the flap is one inferred assembly (${r.inferred && r.inferred.map(a => a.node)})`);
R.is(Math.abs(r.reach - r.restReach) < 1e-3,
  `it turns about its own hinge: its distance from the pivot is unchanged (${r.restReach.toFixed(3)} → ${r.reach.toFixed(3)} m)`);
R.is(Math.hypot(r.flapped[0] - r.rest.flap[0], r.flapped[1] - r.rest.flap[1], r.flapped[2] - r.rest.flap[2]) > .15,
  "…and it actually moves");
R.is(Math.hypot(r.hullStill[0] - r.rest.hull[0], r.hullStill[1] - r.rest.hull[1], r.hullStill[2] - r.rest.hull[2]) < 1e-9,
  "the hull, which no control claims, does not move");
R.is(Math.hypot(r.putBack.at[0] - r.rest.flap[0], r.putBack.at[1] - r.rest.flap[1], r.putBack.at[2] - r.rest.flap[2]) < 1e-9 && r.putBack.id === 1,
  `a control put back to rest leaves the part where the model has it, at the identity (at ${r.putBack.at.map(v => v.toFixed(3))}, m00 ${r.putBack.id})`);
// …and its mesh stays under the pose's control while the control exists — the flag only goes back
// when nothing claims the mesh at all, which is the baked case below.
{
  // F · D · F with F = diag(1,1,-1): the sign flips on every element with exactly one z index
  const D = [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 1]];
  const F = [1, 1, -1];
  const want = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) want.push(D[i][j] * F[i] * (j === 3 ? 1 : F[j]));
  const got = r.baked;
  let worst = 0;
  for (let k = 0; k < 12; k++) worst = Math.max(worst, Math.abs(got[k] - want[k]));
  R.is(worst < 1e-6, `a baked delta reaches the mesh conjugated by diag(1,1,−1), exactly (worst element off by ${worst.toExponential(1)})`);
  R.is(Math.abs(got[11] - (-1)) < 1e-6, `…so a clip's +1 on z becomes −1 in the app's own space (${got[11]})`);
}
R.is(r.deadControl === false, "a baked control whose nodes do not move over the slider's range is not offered at all — the phantom wing sweep, and every dead elevator (ROADMAP 4.1)");
R.is(r.liveControl === true, "…and one whose nodes do move is");
R.is(r.bakedOther === true, "a node the clip does not key keeps updating its own matrix");
R.is(r.bakedPutBack.auto === true && r.bakedPutBack.id === true, "and a baked part put back is the identity again, not a frozen last frame");
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
