// The tank posing rig, from the vehicle's own datasheet (ROADMAP 4.1, the tank half).
//
// WHY THIS EXISTS. Four things were guessed and all four are written down in the unit's blk, so
// each has an exact answer to hold against (`tools/turret_sweep.mjs` measured them over 1 359
// ground units):
//
//   Node, on the pure `/*==TANKRIG==*/` section:
//   * the main gun is picked from the unit's weapons — the one that names a turret AND elevates,
//     never a hull machine gun whose limits are the dead [0,0] every one of them carries;
//   * `limitsTable` becomes bands of [yawFrom, yawTo, pitchMin, pitchMax], sorted, and `pitchAt`
//     answers with the band covering a bearing — the M1 depresses 10° forward and 2° over its own
//     engine deck — falling back to the flat limits where no band covers it;
//   * a casemate does not traverse (the ISU-152's [−3, +7]) and a turret does;
//   * the travel reads back as a sentence, including "only +2° over part of its own hull".
//
//   Headless Chrome, on the real page, against a synthetic tank whose answer is known:
//   * **the turret carries the gun and the barrel** — the regression the owner reported, where
//     moving the turret left the barrel behind, because the inner assembly's members were removed
//     from the outer one and nothing composed them;
//   * the gun elevates about the TRUNNION (the `gun` node the datasheet names) and not about the
//     barrel's own origin, and a positive slider raises the muzzle;
//   * the sliders' ranges come from the datasheet — a casemate's traverse is its own few degrees,
//     not ±180 — and the gun is clamped by the band the turret is traversed into;
//   * hatches are not offered on a tank at all (a player cannot open one in game), while a baked
//     clip that keys one still gets its control.
//
// Usage: node tools/t76_tankrig.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { TankRig } = new Function(sectionOf("TANKRIG").replace(/^"use strict";$/m, "") + "\nreturn { TankRig };")();

// The M1's own records, as the blk has them (tools/turret_sweep.mjs).
const M1 = [
  { turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" },
    limits: { yaw: [-180, 180], pitch: [-10, 20] },
    limitsTable: { lim1: [-180, -133, 2, 20], lim2: [-133, 133, -10, 20], lim3: [133, 180, 2, 20] } },
  { turret: null, limits: { yaw: [-180, 180], pitch: [-9, 65] }, limitsTable: null },         // the AA mount
  { turret: null, limits: { yaw: [0, 0], pitch: [0, 0] }, limitsTable: null },                 // a hull MG
];
{
  const rig = TankRig.main(M1);
  R.is(rig.head === "bone_turret" && rig.gun === "bone_gun" && rig.barrel === "bone_gun_barrel",
    "the node names come from the datasheet, all three of them");
  R.is(rig.yaw[0] === -180 && rig.pitch[0] === -10 && rig.pitch[1] === 20, `…and so does the travel (${rig.pitch})`);
  R.is(rig.bands.length === 3 && rig.bands[0][0] === -180 && rig.bands[2][0] === 133, "the table becomes bands, sorted by where they start");
  R.is(JSON.stringify(TankRig.pitchAt(rig, 0)) === "[-10,20]", "forward, the gun has its full depression");
  R.is(JSON.stringify(TankRig.pitchAt(rig, 170)) === "[2,20]" && JSON.stringify(TankRig.pitchAt(rig, -170)) === "[2,20]",
    "over its own engine deck it has 2° — the owner's report, in the file it was measured from");
  R.is(TankRig.clampPitch(rig, 170, -10) === 2 && TankRig.clampPitch(rig, 0, -10) === -10,
    "so a gun at full depression rises as the turret comes round, and is left alone facing forward");
  R.is(TankRig.pitchAt(rig, -133)[0] === -10 && TankRig.pitchAt(rig, -134)[0] === 2,
    "the bands meet without overlapping: the value where two touch belongs to one of them");
  R.is(TankRig.traverses(rig) === true, "an M1 traverses fully");
  R.is(/traverses fully/.test(TankRig.label(rig)) && /only \+2°/.test(TankRig.label(rig)), `the travel reads back as a sentence (${TankRig.label(rig)})`);
}
{
  // a hull machine gun must never be mistaken for the main gun
  const onlyMg = [{ turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_mg_gun_twin" }, limits: { yaw: [0, 0], pitch: [0, 0] } },
                  { turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" }, limits: { yaw: [-180, 180], pitch: [-8, 16] } }];
  R.is(TankRig.main(onlyMg).barrel === "bone_gun_barrel", "the weapon that actually elevates is the main gun, whatever order they come in");
  R.is(TankRig.main([{ turret: null, limits: { yaw: [-1, 1], pitch: [-1, 1] } }]) === null, "a unit with no turret block has no tank rig");
  R.is(TankRig.main([]) === null && TankRig.main(null) === null, "…and neither has one with no weapons at all");
  // the ISU-152: a casemate
  const isu = TankRig.main([{ turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" }, limits: { yaw: [-3, 7], pitch: [-3, 18] } }]);
  R.is(TankRig.traverses(isu) === false && /traverses -3° to \+7°/.test(TankRig.label(isu)), `a casemate does not traverse (${TankRig.label(isu)})`);
  // the _01 variants the app's own regex missed on 248 units
  const alt = TankRig.main([{ turret: { head: "bone_turret_01", gun: "bone_gun_01", barrel: "bone_gun_barrel_01" }, limits: { yaw: [-180, 180], pitch: [-6, 18] } }]);
  R.is(alt.head === "bone_turret_01" && alt.barrel === "bone_gun_barrel_01", "the _01 variants are read like any other name — no regex to miss them");
  // a table that covers nothing falls back to the flat limits
  const odd = TankRig.main([{ turret: { head: "h", gun: "g", barrel: "b" }, limits: { yaw: [-180, 180], pitch: [-5, 10] }, limitsTable: { lim1: [10, 20, 0, 5] } }]);
  R.is(JSON.stringify(TankRig.pitchAt(odd, -90)) === "[-5,10]", "a bearing no band covers falls back to the flat limits");
  R.is(TankRig.bands({ a: "not numbers", b: [1, 2], c: [0, 1, 2, 3] }).length === 1, "a malformed table row is dropped rather than believed");
}

// ---- the real page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP: no Chrome or Edge found for the page half. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {};
  // ---- a synthetic tank: hull, turret at the ring, gun at the trunnion, barrel out in front ----
  // wtm rows are [ax, ay, az, origin] — the identity basis with the origin in the last column, the
  // shape loadSkeletonBytes produces.
  function node(name, origin){
    return { name: name, wtm: [[1, 0, 0, origin[0]], [0, 1, 0, origin[1]], [0, 0, 1, origin[2]]], children: [], parent: -1 };
  }
  var nodes = [node("bone_root", [0, 0, 0]), node("bone_turret", [0, 1, 0]), node("bone_gun", [.6, 1.2, 0]), node("bone_gun_barrel", [1.2, 1.2, 0]), node("hatch_1", [0, 1.6, .4])];
  nodes[0].children = [1]; nodes[1].parent = 0;
  nodes[1].children = [2, 4]; nodes[2].parent = 1; nodes[4].parent = 1;
  nodes[2].children = [3]; nodes[3].parent = 2;
  var byName = new Map(); nodes.forEach(function(n){ byName.set(n.name, n); });
  var skel = { nodes: nodes, byName: byName };
  // one shape per node: a triangle whose centroid is EXACTLY the point given, so every distance
  // measured below is exact (app space — the extracted geometry has Z negated)
  function box(name, at, size){
    var S = size || .2;
    var pts = [[at[0] + S, at[1], at[2]], [at[0] - S / 2, at[1] + S, at[2] + S], [at[0] - S / 2, at[1] - S, at[2] - S]];
    var pos = [], nrm = [], uv = [];
    pts.forEach(function(p){ pos.push(p[0], p[1], -p[2]); nrm.push(0, 1, 0); uv.push(0, 0); });
    return { name: name, mat: "m", position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv) };
  }
  App.geomData = [box("bone_root", [0, 0, 0], .8), box("bone_turret", [0, 1, 0], .5), box("bone_gun", [.6, 1.2, 0]), box("bone_gun_barrel", [1.6, 1.2, 0]), box("hatch_1", [0, 1.6, .4])];
  App.extracted = { geo: { skeleton: skel, a2d: null } };
  App.matSlot = new Map([["m", "t76"]]);
  App.meshes = new Map();
  modelGroup = modelGroup || new THREE.Group();
  App.geomData.forEach(function(g){
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.position, 3));
    var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.name = g.name; mesh.userData = { mat: "m" };
    App.meshes.set(g.name, mesh);
    modelGroup.add(mesh);
  });
  App.skinUnits = [];
  App.vehicleKey = "t76_tank";
  App.modelKind = "tank";
  App._poseRig = null; App._poseRigFor = null; App.pose = {};
  // the datasheet the app would have read out of the unit blk
  TankData.cache.set("t76_tank", TankRig.main([{ turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" },
    limits: { yaw: [-180, 180], pitch: [-10, 20] },
    limitsTable: { lim1: [-180, -133, 2, 20], lim2: [-133, 133, -10, 20], lim3: [133, 180, 2, 20] } }]));

  var rig = poseRig();
  out.controls = rig ? [...rig.keys()] : null;
  out.hatches = !!(rig && rig.get("hatches"));

  // where each mesh's box centre is, after a pose
  function centre(name){
    var m = App.meshes.get(name);
    m.updateMatrixWorld(true);
    var g = m.geometry.attributes.position.array;
    var c = [0, 0, 0], n = g.length / 3;
    for (var i = 0; i < g.length; i += 3) { c[0] += g[i]; c[1] += g[i+1]; c[2] += g[i+2]; }
    var v = new THREE.Vector3(c[0] / n, c[1] / n, c[2] / n).applyMatrix4(m.matrixWorld);
    return [v.x, v.y, v.z];
  }
  var rest = { turret: centre("bone_turret"), gun: centre("bone_gun"), barrel: centre("bone_gun_barrel") };
  out.rest = rest;

  // ---- the turret carries the gun and the barrel ----
  App.pose = { turret: 90 };
  applyPose();
  out.traversed = { turret: centre("bone_turret"), gun: centre("bone_gun"), barrel: centre("bone_gun_barrel") };

  // ---- the gun elevates about the trunnion, and up ----
  App.pose = { turret: 0, gun: 15 };
  applyPose();
  out.elevated = { gun: centre("bone_gun"), barrel: centre("bone_gun_barrel"), turret: centre("bone_turret") };

  // ---- both at once ----
  App.pose = { turret: 90, gun: 15 };
  applyPose();
  out.both = { barrel: centre("bone_gun_barrel") };

  // ---- the ranges come from the datasheet ----
  refreshPosePanel();
  var rows = [...document.querySelectorAll("#poseList .row")].map(function(r){
    var i = r.querySelector("input");
    return { label: r.querySelector("label").textContent, min: +i.min, max: +i.max, title: r.querySelector("label").title };
  });
  out.rows = rows;

  // the gun is clamped by the band the turret is traversed into
  App.pose = { turret: 170, gun: -10 };
  applyPose();
  out.clamped = poseGunAngle ? poseGunAngle() : null;

  // ---- a casemate ----
  TankData.cache.set("t76_tank", TankRig.main([{ turret: { head: "bone_turret", gun: "bone_gun", barrel: "bone_gun_barrel" },
    limits: { yaw: [-3, 7], pitch: [-3, 18] } }]));
  App._poseRig = null; App._poseRigFor = null; App.pose = {};
  refreshPosePanel();
  out.casemate = [...document.querySelectorAll("#poseList .row")].map(function(r){
    var i = r.querySelector("input");
    return { label: r.querySelector("label").textContent, min: +i.min, max: +i.max };
  });

  App.geomData = null; App.extracted = null; App._poseRig = null; App._poseRigFor = null; App.pose = {};
  App.meshes = new Map(); App.modelKind = null; App.vehicleKey = null;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
R.is(r.controls && r.controls.includes("turret") && r.controls.includes("gun"), `the tank gets a turret and a gun control (${r.controls})`);
R.is(r.hatches === false, "…and no hatches control: a player cannot open a tank hatch in game");
// a 90° traverse about the ring at x=0,z=0 takes a part at +x to +z (skeleton +z is the app's −z)
R.is(dist(r.traversed.turret, r.rest.turret) < .05, "traversing moves the turret about its own ring, so its own box stays put");
R.is(dist(r.traversed.gun, r.rest.gun) > .3, `…and carries the gun with it (${dist(r.traversed.gun, r.rest.gun).toFixed(2)} m)`);
R.is(dist(r.traversed.barrel, r.rest.barrel) > .8, `…and the barrel, which is what "moving the turret leaves the barrel behind" was (${dist(r.traversed.barrel, r.rest.barrel).toFixed(2)} m)`);
R.is(Math.abs(r.traversed.barrel[0]) < .3 && Math.abs(r.traversed.barrel[2]) > .8,
  `…a quarter turn puts the barrel abeam (${r.traversed.barrel.map(v => v.toFixed(2))})`);
R.is(dist(r.elevated.turret, r.rest.turret) < 1e-6 && dist(r.elevated.gun, r.rest.gun) < .06,
  `elevating the gun leaves the turret alone and barely moves the trunnion itself (${dist(r.elevated.gun, r.rest.gun).toFixed(3)} m)`);
R.is(r.elevated.barrel[1] > r.rest.barrel[1] + .15, `…and raises the muzzle (${r.rest.barrel[1].toFixed(2)} → ${r.elevated.barrel[1].toFixed(2)})`);
R.is(Math.abs(r.both.barrel[2]) > .8 && r.both.barrel[1] > r.rest.barrel[1] + .15,
  `both at once compose: the barrel is abeam and raised (${r.both.barrel.map(v => v.toFixed(2))})`);
{
  const gun = r.rows.find(x => /Gun/i.test(x.label)), tur = r.rows.find(x => /Turret/i.test(x.label));
  R.is(gun && gun.min === -10 && gun.max === 20, `the gun's slider is the datasheet's own travel (${gun && gun.min}…${gun && gun.max}°)`);
  R.is(tur && tur.min === -180 && tur.max === 180, `…and the turret's (${tur && tur.min}…${tur && tur.max}°)`);
  R.is(gun && /engine deck|own hull|2°/.test(gun.title || ""), "…and the label says the depression is not the same all the way round");
  const cg = r.casemate.find(x => /Turret/i.test(x.label));
  R.is(cg && cg.min === -3 && cg.max === 7, `a casemate's traverse is its own few degrees, not ±180 (${cg && cg.min}…${cg && cg.max}°)`);
}
R.is(r.clamped === 2, `with the turret over the deck the gun is clamped to the band (${r.clamped}°)`);
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
