/*==POSE==*/
// ---------- Moving parts ----------
// A vehicle is extracted in the pose the model was authored in: gear down, control surfaces
// neutral, hatches shut. That hides exactly the surfaces a skin most often needs work on — the
// inside of a gear door, the top of a flap, the well behind a wheel — so the preview can move
// them. Everything it needs comes out of the game's own files:
//
//   the node names           the GeomNodeTree that ships beside every DynModel
//   which parts move together its parent/child links (see loadSkeletonBytes): a main gear leg is
//                            `gear_l_dm` and everything under it, a tank turret is `bone_turret`
//                            and its 118 descendants on an Abrams — never a name-prefix guess
//   the pivot                the node's own world transform: its origin IS the hinge point
//   the axis                 the node's own local frame, read off the geometry it owns
//
// What is *not* in any readable file is how far the game swings each one, so the angles are the
// user's to choose and the ranges below are conventional rather than authoritative.
//
// The hinge axis, derived and then checked against real models. For a control surface the node's
// geometry is a thin plate in the node's local frame, and the hinge is the in-plane axis that is
// not the chord: local Y, unless local Y is itself the plate's thin axis (dorsal airbrakes), in
// which case it is local X. Verified on f_4e, p_51d_5, fa_18a, su_30sm2 and mi_24p — flaps,
// ailerons, slats, elevators, rudders and both airbrake styles all come out right. A gear leg is
// an arm rather than a plate: the strut runs along the local axis it is longest on, and the hinge
// is whichever of the other two is more horizontal (a main leg folds inboard about a longitudinal
// axis, a nose leg fore/aft about a lateral one).
const POSE_CONTROLS = [
  { id: "gear",     label: "Landing gear",   cls: "air helicopter", max: 100, unit: "%", deg: 95,
    tip: "Swing the legs up. The whole leg moves — strut, doors and wheel — because the skeleton says which nodes belong to it." },
  { id: "flaps",    label: "Flaps",          cls: "air", max: 100, unit: "%", deg: 40 },
  { id: "slats",    label: "Slats",          cls: "air", max: 100, unit: "%", deg: 25 },
  { id: "airbrake", label: "Airbrake",       cls: "air", max: 100, unit: "%", deg: 55 },
  { id: "ailerons", label: "Ailerons",       cls: "air", max: 100, unit: "%", deg: 25, signed: true,
    tip: "Left and right deflect opposite ways, the way a roll input moves them." },
  { id: "elevator", label: "Elevator",       cls: "air helicopter", max: 100, unit: "%", deg: 25, signed: true },
  { id: "rudder",   label: "Rudder",         cls: "air helicopter", max: 100, unit: "%", deg: 25, signed: true },
  { id: "canopy",   label: "Canopy",         cls: "air helicopter", max: 100, unit: "%", deg: 45 },
  { id: "turret",   label: "Turret",         cls: "tank ship boat", max: 180, unit: "°", deg: 1, signed: true,
    tip: "Traverse, about the hull's vertical axis through the turret ring." },
  { id: "gun",      label: "Gun elevation",  cls: "tank ship boat", max: 20, unit: "°", deg: 1, signed: true },
  // Hatches are baked-only since 2026-09-22 (ROADMAP 4.1, the tank half). A player cannot open a
  // tank hatch in game, so offering one was a mode the vehicle does not have; where a vehicle's own
  // clip keys a hatch — an aircraft's bomb bay, say — the control still appears, because that is
  // the game's own animation rather than a guess about the shape of a lid.
  { id: "hatches",  label: "Hatches",        max: 100, unit: "%", a2dOnly: true },
  // Only ever driven by a baked clip — there is no sensible way to infer a nozzle petal's hinge
  // from its shape, which is why these did not exist before the a2d reader.
  { id: "nozzles",  label: "Engine nozzles", cls: "air", max: 100, unit: "%", a2dOnly: true,
    tip: "The exhaust petals. An F-4E's two nozzles are 34 individually keyed leaves each." },
  { id: "hook",     label: "Arrestor hook",  cls: "air", max: 100, unit: "%", a2dOnly: true },
  { id: "sweep",    label: "Wing sweep",     cls: "air", max: 100, unit: "%", a2dOnly: true,
    tip: "Variable-geometry wings, and the wing fold on carrier aircraft." },
  { id: "radiator", label: "Radiators",      cls: "air", max: 100, unit: "%", a2dOnly: true },
];
// name → which control owns it. Matched against the skeleton, and a leg / turret then takes its
// whole subtree with it.
const POSE_ROOTS = [
  ["gear",     /^gear\d*_(l|r|c)(_dm)?$/i],
  ["flaps",    /^flap\d*_(l|r)$/i],
  ["slats",    /^slat\d*_(l|r)$/i],
  ["airbrake", /^airbrake(_?\d+)?(_(l|r))?\d*$/i],
  ["ailerons", /^aileron(_interceptor)?_(l|r)$/i],
  ["elevator", /^elevator\d*(_(l|r))?$/i],
  ["rudder",   /^rudder\d*$/i],
  ["canopy",   /^(canopy|fonar|cockpit_glass)\d*(_(l|r))?$/i],
  ["turret",   /^bone_turret$/i],
  ["gun",      /^bone_gun_barrel$/i],
];
// Which control owns a node when the vehicle has a baked clip. Wider than POSE_ROOTS above,
// because it does not have to stop at nodes whose hinge can be guessed: these are the node groups
// the game's own `<model>_animtree` uses (its `nodeRE` fields — `^gear_l\d*$`, `^flap_[lr]$`,
// `^nozzle1_\d*$`, `^slat\d*_l$` and the rest), so a numbered run of nozzle petals or gear
// sub-nodes is claimed whole rather than only at its root.
// The five control-surface groups share one suffix grammar, and it is MEASURED rather than guessed
// — `tools/ctrl_sweep.mjs` over every airframe in the install, 2026-09-04, ROADMAP 4.42:
//
//     <base> <n?> ( _l | _r | _c )? <n?> ( _<n> | _traction_<n> )? _?
//
// A digit may follow the BASE, or the SIDE, or both: `aileron1_l`, `aileron_l1` and `flap1_l3` are
// all in the install. The side can be CENTRE (`flap_c`, the J21's centre-section flap). A few names
// carry a trailing `_` (`rudder1_` on the Mirage III) or a trailing space (`flap3_l ` on the
// Swift), which is why the match site trims.
//
// The old table allowed a digit only after the base, and that is the whole of what was reported as
// "animations still not 100% working for rudder / ailerons on many top-tier jets". It was never a
// missing animtree read and never an aircraft with no rig at all: the sweep found **every one** of
// the 1 212 airframes resolving a control. What it found instead was surfaces moving in PART — 547
// nodes on 154 aircraft claimed by nothing — so the A-7E deflected its two ailerons and left all
// fourteen spoiler panels behind, the A-4N moved two flap segments of twelve, and the F-14 moved
// two rudder sections of six. A surface that moves halfway is exactly what "not 100%" looks like.
//
// An IIFE so the grammar is written once without two more names in the shared scope (CLAUDE.md
// §5.6). `gear` and `airbrake` keep their own literals: both were already at 100% in the sweep, and
// changing a rule nothing measured is how a fix acquires a regression.
const A2D_GROUPS = (() => {
  const S = "\\d*(?:_[lrc])?\\d*(?:_traction_\\d+|_\\d+)?_?";
  const ctl = base => new RegExp("^(?:" + base + ")" + S + "$", "i");
  return [
  ["gear",     /^(gear|wheel)\d*(_[lrc])?(_dm)?\d*$/i],
  ["flaps",    ctl("flap|flaperon")],
  ["slats",    ctl("slat")],
  ["airbrake", /^(airbrake|flap_airbrake)\d*_?[lrc]?\d*$/i],
  ["ailerons", ctl("(?:aileron|elevon|taileron)(?:_interceptor)?")],
  ["elevator", ctl("elevator|stabilator|ruddervator")],
  ["rudder",   ctl("rudder(?:_interceptor)?")],
  ["canopy",   /^(canopy|fonar|cockpit_glass|cockpit_blister)\d*(_[lr])?$/i],
  ["hatches",  /^hatch\d*$/i],
  ["nozzles",  /^nozzle\d*_\d+$/i],
  ["hook",     /^hook\d*(_catch|_arm)?$/i],
  ["sweep",    /^wing\d*_[lr]$/i],
  ["radiator", /^radiator(_oil)?\d*_?\d*$/i],
  ];
})();
// The loaded vehicle's own turret datasheet, or null — an imported .obj, an aircraft, or a unit
// the game folder is not open for. `TankData` caches per unit (game/turret.js).
function poseTank(){
  if (!App.geomData) return null;
  const cls = App.modelKind || (typeof vehicleClass === "function" ? vehicleClass() : null);
  if (cls && cls !== "tank" && cls !== "ship" && cls !== "boat") return null;
  return TankData.current();
}
// What a tank control's slider runs between: the vehicle's own travel where it has one, and the
// conventional range otherwise. A casemate's traverse is its own few degrees — offering ±180° swung
// an ISU-152's gun through its own fighting compartment.
function poseRange(c, entry){
  const baked = entry && entry.src === "a2d";
  if (!baked) {
    const t = poseTank();
    if (t && c.id === "turret" && t.yaw) return { min: t.yaw[0], max: t.yaw[1] };
    if (t && c.id === "gun" && t.pitch) return { min: t.pitch[0], max: t.pitch[1] };
  }
  return baked ? { min: 0, max: 100 } : { min: c.signed ? -c.max : 0, max: c.max };
}
// The gun's angle after the hull has had its say: a tank's depression is not the same all the way
// round (the M1 gives −10° forward and +2° over its own engine deck — `limitsTable`, measured over
// 682 of the 734 units that carry one), so the slider's value is clamped by the band the turret is
// actually traversed into rather than by one flat pair.
function poseGunAngle(){
  const t = poseTank();
  const v = +(App.pose && App.pose.gun) || 0;
  if (!t || !t.bands || !t.bands.length) return v;
  return TankRig.clampPitch(t, +(App.pose && App.pose.turret) || 0, v);
}
function vec(a){ return { x: a[0], y: a[1], z: a[2] }; }
// The node's local basis, normalised — a few nodes carry a scale in their world transform
// (fa_18a's flap3_l comes out 1.089 long), and a rotation axis has to be a unit vector.
function nodeAxes(wtm){
  return [0, 1, 2].map(k => {
    const v = [wtm[0][k], wtm[1][k], wtm[2][k]];
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  });
}
function nodeOrigin(wtm){ return [wtm[0][3], wtm[1][3], wtm[2][3]]; }
// The inferred rig: one entry per moving assembly, with its pivot, axis and the mesh names it
// carries. Used when the vehicle has no baked clip — an imported .obj, or a model whose `_anim`
// resource is missing — and for the tank controls, whose clips carry only track roll.
// ---------- The inferred rig, as named steps on one object (ROADMAP 2.4) ----------
// `buildHingeRig` was 88 lines of five passes over one Map, each with its own comment explaining
// which of the previous four it was undoing. They are methods now — one binding rather than five
// new globals (§5.6), the same move `Composite`, `PartsPanel` and `SkinLoad` made — and the entry
// point keeps its name because `buildPoseRig` and `tools/t22_pose.mjs` both call it.
const PoseRig = {
  // Geometry per skeleton node, in skeleton space (extracted vertices have Z negated — matFlipZ).
  geomByNode(){
    const geomOf = new Map();
    for (const g of App.geomData) {
      const node = partNode(g.name);
      let e = geomOf.get(node);
      if (!e) geomOf.set(node, e = []);
      e.push(g);
    }
    return geomOf;
  },
  // The tank's three nodes are NAMED by the unit's own blk — `turret { head; gun; barrel }` — so
  // they are taken from there rather than matched. Measured over 1 359 ground units
  // (tools/turret_sweep.mjs): the app's `^bone_gun_barrel$` missed 248 of the 1 305 that carry the
  // data, every one of them an `_01` variant, and the trunnion the gun really turns about is the
  // `gun` node one level above the barrel.
  namedNodes(skel){
    const tank = poseTank();
    const named = new Map();
    if (!tank) return named;
    if (tank.head && skel.byName.has(tank.head)) named.set("turret", tank.head);
    const trunnion = (tank.gun && skel.byName.has(tank.gun)) ? tank.gun
      : (tank.barrel && skel.byName.has(tank.barrel) ? tank.barrel : null);
    if (trunnion) named.set("gun", trunnion);
    return named;
  },
  // One assembly per root the model actually draws something under.
  collect(skel, geomOf){
    const rig = new Map();
    const named = PoseRig.namedNodes(skel);
    for (const [id, re] of POSE_ROOTS) {
      for (const n of skel.byName.keys()) {
        if (named.has(id) ? n !== named.get(id) : !re.test(n)) continue;
        const wtm = skel.byName.get(n).wtm;
        const members = skelSubtree(skel, n).filter(m => App.meshes.has(m) || geomOf.has(m));
        // A `_dm` node is the damage-model parent of a whole assembly; it carries no geometry of
        // its own but everything under it is the leg. Skip roots that move nothing.
        if (!members.length) continue;
        const axis = poseAxis(id, n, wtm, geomOf, members);
        if (!axis) continue;
        if (!rig.has(id)) rig.set(id, []);
        rig.get(id).push({ node: n, pivot: nodeOrigin(wtm), axis: axis.dir, sign: axis.sign, members });
      }
    }
    return rig;
  },
  // Within one control, an assembly nested inside another is the same thing named twice: a nose
  // leg matches both `gear_c_dm` and the `gear_c` under it, and splitting it in two would rotate
  // the strut about one axis and the wheel about another, tearing the leg apart. Keep the outer.
  dropNested(rig, skel){
    for (const [id, list] of rig) {
      const inner = new Set();
      for (const a of list) for (const n of skelSubtree(skel, a.node)) if (n !== a.node) inner.add(n);
      const kept = list.filter(a => !inner.has(a.node));
      if (kept.length) rig.set(id, kept); else rig.delete(id);
    }
  },
  // A node claimed by a nested assembly belongs to the innermost one — the gun barrel is under the
  // turret and must not be rotated twice by two matrices that each ignore the other.
  assignMembers(rig){
    const owned = new Map();
    for (const [id, list] of rig) for (const a of list) for (const m of a.members) {
      const prev = owned.get(m);
      if (!prev || a.members.length < prev.n) owned.set(m, { id, node: a.node, n: a.members.length });
    }
    for (const [id, list] of rig) for (const a of list)
      a.members = a.members.filter(m => { const o = owned.get(m); return o && o.id === id && o.node === a.node; });
  },
  // …and then the inner assembly is told which one encloses it, which is the half that was missing
  // until 2026-09-22: stripping the barrel out of the turret's members and leaving it at that is
  // exactly "moving the turret leaves the barrel behind" (reported 2026-08-25). `applyPose`
  // composes the chain, so the barrel takes the turret's traverse AND its own elevation.
  nest(rig, skel){
    const all = [];
    for (const [, list] of rig) for (const a of list) all.push(a);
    const isAssembly = new Set(all.map(a => a.node));
    for (const a of all) {
      a.parent = null;
      a.depth = 0;
      let n = skel.byName.get(a.node);
      while (n && n.parent >= 0 && skel.nodes) {
        n = skel.nodes[n.parent];
        if (!n) break;
        if (isAssembly.has(n.name)) { a.parent = n.name; break; }
      }
    }
    for (const a of all) {
      let d = 0, p = a.parent;
      const seen = new Set([a.node]);
      while (p && !seen.has(p)) { seen.add(p); d++; p = (all.find(x => x.node === p) || {}).parent; }
      a.depth = d;
    }
    return all;
  },
  // An assembly that carries nothing of its own still has to be kept when something nests inside it:
  // a turret whose every mesh belongs to the gun is still the thing the gun turns with.
  prune(rig, all){
    const encloses = new Set(all.map(a => a.parent).filter(Boolean));
    for (const [id, list] of [...rig]) {
      const kept = list.filter(a => a.members.length || encloses.has(a.node));
      if (kept.length) rig.set(id, kept); else rig.delete(id);
    }
  },
};
function buildHingeRig(){
  const skel = vehicleSkeleton();
  if (!skel || !skel.byName || !App.geomData) return null;
  const rig = PoseRig.collect(skel, PoseRig.geomByNode());
  PoseRig.dropNested(rig, skel);
  PoseRig.assignMembers(rig);
  PoseRig.prune(rig, PoseRig.nest(rig, skel));
  return rig;
}
// Where the geometry a node owns sits, in that node's local frame: extent along each local axis
// and how far off the pivot it hangs. This is what tells a plate from an arm.
function nodeLocalSpread(node, wtm, geomOf){
  const list = geomOf.get(node);
  if (!list || !list.length) return null;
  const o = nodeOrigin(wtm), ax = nodeAxes(wtm);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  let count = 0;
  for (const g of list) {
    const p = g.position;
    const step = Math.max(3, ((p.length / 3 / 400) | 0) * 3);   // a few hundred samples is plenty
    for (let i = 0; i < p.length; i += step) {
      const dx = p[i] - o[0], dy = p[i+1] - o[1], dz = -p[i+2] - o[2];   // un-negate Z
      for (let k = 0; k < 3; k++) {
        const t = dx * ax[k][0] + dy * ax[k][1] + dz * ax[k][2];
        if (t < lo[k]) lo[k] = t;
        if (t > hi[k]) hi[k] = t;
      }
      count++;
    }
  }
  if (!count) return null;
  return { ext: [hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]], mid: [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2], ax };
}
// The mean of every vertex the assembly's members own, in app space (the extracted geometry has Z
// negated — see matFlipZ). What a rotation about the pivot actually swings.
function assemblyCentroid(members, geomOf){
  let x = 0, y = 0, z = 0, n = 0;
  for (const m of members) for (const g of (geomOf.get(m) || [])) {
    const p = g.position;
    const step = Math.max(3, ((p.length / 3 / 300) | 0) * 3);
    for (let i = 0; i < p.length; i += step) { x += p[i]; y += p[i+1]; z += -p[i+2]; n++; }
  }
  return n ? [x / n, y / n, z / n] : null;
}
function poseAxis(id, node, wtm, geomOf, members){
  const ax = nodeAxes(wtm);
  // A turret traverses about the hull's vertical axis and a gun elevates about the lateral one;
  // both are fixed by what the vehicle is, not by the shape of the part.
  if (id === "turret") return { dir: [0, 1, 0], sign: 1 };
  const sp = nodeLocalSpread(node, wtm, geomOf);
  if (id === "gun") {
    // The trunnion's own lateral axis — its local Z, which on every ground model measured is the
    // hull's lateral axis. It used to be inferred from the barrel's longest side, which is the
    // right answer only while the node owning the geometry IS the barrel; since the datasheet names
    // the trunnion one level up (a node that often owns no geometry at all), the frame is read from
    // the node and the SIGN from what hangs off it: + must raise the muzzle.
    const dir = ax[2];
    const c = assemblyCentroid(members || [], geomOf);
    if (!c) return { dir, sign: 1 };
    const o = nodeOrigin(wtm);
    // app space: the axis and the pivot are conjugated by diag(1,1,-1) on the way in (applyPose)
    const a = [dir[0], dir[1], -dir[2]], p = [o[0], o[1], -o[2]];
    const v = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
    const m = [a[1]*v[2] - a[2]*v[1], a[2]*v[0] - a[0]*v[2], a[0]*v[1] - a[1]*v[0]];
    return { dir, sign: m[1] >= 0 ? 1 : -1 };
  }
  if (!sp) return { dir: ax[1], sign: 1 };
  const thin = sp.ext.indexOf(Math.min(...sp.ext));
  const long = sp.ext.indexOf(Math.max(...sp.ext));
  const plate = sp.ext[thin] < sp.ext[long] * 0.5;
  let k;
  if (id === "gear") {
    // an arm: the strut lies along `long`, and it folds about whichever of the other two axes is
    // closer to horizontal
    k = [0, 1, 2].filter(i => i !== long).sort((a, b) => Math.abs(ax[a][1]) - Math.abs(ax[b][1]))[0];
  } else if (plate) {
    k = thin === 1 ? 0 : 1;                                    // local Y unless Y is the thickness
  } else {
    k = 1;
  }
  return { dir: ax[k], sign: poseSign(id, ax[k], sp, wtm) };
}
// Which way a positive slider should move the part. Chosen from the geometry rather than assumed,
// because the left and right frames of a pair are not mirror images of each other in these files.
function poseSign(id, axis, sp, wtm){
  const o = nodeOrigin(wtm), ax = sp.ax;
  // the part's centre, in world space, relative to the pivot
  const c = [0, 1, 2].reduce((v, k) => [v[0] + ax[k][0] * sp.mid[k], v[1] + ax[k][1] * sp.mid[k], v[2] + ax[k][2] * sp.mid[k]], [0, 0, 0]);
  // rotating by +θ moves it along axis × c
  const m = [axis[1]*c[2] - axis[2]*c[1], axis[2]*c[0] - axis[0]*c[2], axis[0]*c[1] - axis[1]*c[0]];
  if (id === "ailerons") {
    // a roll input: the left surface goes one way and the right the other. Side is the pivot's
    // own lateral position, which is what the model file actually distinguishes them by.
    const side = o[2] >= 0 ? 1 : -1;
    return (m[1] * side) >= 0 ? 1 : -1;
  }
  if (id === "gear" || id === "canopy" || id === "hatches") return m[1] >= 0 ? 1 : -1;   // up / open
  if (id === "airbrake") { const away = o[1] >= 0 ? 1 : -1; return (m[1] * away) >= 0 ? 1 : -1; }
  if (id === "flaps" || id === "slats") return m[1] <= 0 ? 1 : -1;                       // trailing edge down
  return m[1] >= 0 ? 1 : -1;
}
// How far this group's drawn nodes actually travel over the slider's whole range, and whether that
// is more than nothing. A millimetre (or the matrix equivalent for a surface that turns about its
// own hinge without its origin moving) — anything below that is a constant track.
//
// Two poses of the skeleton per group at model-load time. `a2dWorld` walks the tree once each, so a
// twelve-control airframe costs 24 walks of a few hundred nodes, once, against a control the user
// would otherwise find by dragging it and watching nothing happen.
const POSE_MOVE_MIN = 1e-3;
function poseTravels(a2d, skel, nodes, drawn){
  if (!skel || !skel.nodes) return true;                 // no tree to measure with: keep the old behaviour
  const mine = new Set(nodes);
  const at = f => a2dWorld(a2d, skel, n => (mine.has(n) ? f : null));
  const w0 = at(0), w1 = at(100);
  if (!w0 || !w1) return true;
  for (const n of nodes) {
    if (!drawn.has(n)) continue;
    const nd = skel.byName.get(n);
    if (!nd || !w0[nd.i] || !w1[nd.i]) continue;
    const d = Math.hypot(w0[nd.i][0][3] - w1[nd.i][0][3], w0[nd.i][1][3] - w1[nd.i][1][3], w0[nd.i][2][3] - w1[nd.i][2][3]);
    if (d > POSE_MOVE_MIN) return true;
    // …and the orientation, because an aileron turns about its own hinge and its origin does not move
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++)
      if (Math.abs(w0[nd.i][r][k] - w1[nd.i][r][k]) * .5 > POSE_MOVE_MIN) return true;
  }
  return false;
}
// The rig built from the vehicle's own baked clip. Each control gets the animated nodes that
// A2D_GROUPS assigns to it, plus their skeleton subtrees — the clip keys those sub-nodes too, and
// composing down the tree is what carries a wheel with its strut.
//
// `ref` is the frame the geometry was extracted in, measured per control rather than assumed: an
// aircraft's gear is modelled retracted (frame 0) while a control surface may be modelled at
// neutral in the middle of its travel. The slider starts there, so touching it moves nothing until
// it is dragged, and every part reaches its true end stops rather than a conventional guess.
function buildA2DRig(){
  const a2d = vehicleAnim(), skel = vehicleSkeleton();
  if (!a2d || !skel || !skel.byName || !skel.nodes || !App.geomData) return null;
  a2dIndexNodes(a2d);
  const animated = a2dNodeNames(a2d);
  // only nodes this model actually draws are worth a control
  const drawn = new Set();
  for (const g of App.geomData) drawn.add(partNode(g.name));
  const rig = new Map();
  const claimed = new Set();
  for (const [id, re] of A2D_GROUPS) {
    const nodes = new Set();
    for (const n of skel.byName.keys()) {
      // Trimmed: two models in the install ship a node whose name ends in a space (`flap3_l ` on
      // the Swift F1), and an untrimmed test leaves that aileron behind for one invisible byte.
      if (!re.test(n.trim()) || claimed.has(n)) continue;
      for (const s of skelSubtree(skel, n)) if (!claimed.has(s)) nodes.add(s);
    }
    // A group is only useful if the clip MOVES something in it that the model draws — and "the clip
    // keys it" is not the same claim, which is the whole of ROADMAP 4.1's aircraft half. Measured
    // over the roster with `tools/ctl_moves.mjs` (2026-09-22): of 87 controls the app offered on 13
    // aircraft, **32 moved nothing at all** — wing sweep on 9 of the 10 that were offered it (the
    // F-14A is the one real swing wing), elevator on 8 of 10, rudder on 9 of 12. Those surfaces are
    // computed from a flight-model parameter at run time (the animtree carries `p_elevator`,
    // `p_rudder` and `kMul2`/`fifo3` controllers beside them), so their tracks exist and are
    // constant: a slider for them was a control that could never do anything, and that is exactly
    // what "F-15E elevator, rudder, ailerons not working" and "shows wing sweep on an aircraft that
    // does not have it" were reports of.
    let keyed = false;
    for (const n of nodes) if (animated.has(n) && drawn.has(n)) { keyed = true; break; }
    if (!keyed || !poseTravels(a2d, skel, nodes, drawn)) continue;
    for (const n of nodes) claimed.add(n);
    rig.set(id, { src: "a2d", nodes: [...nodes], ref: a2dRefFrame(a2d, skel, nodes) });
  }
  return rig.size ? rig : null;
}
// One rig per model: the baked clip wherever it covers a control, the inferred hinges everywhere
// else. Tanks fall through to the hinges for turret and gun because their clips carry only track
// roll and applique armour, and an imported .obj has no clip at all.
function buildPoseRig(){
  const hinge = buildHingeRig();
  const rig = buildA2DRig() || new Map();
  if (hinge) for (const [id, list] of hinge) if (!rig.has(id)) rig.set(id, { src: "hinge", list });
  return rig.size ? rig : null;
}
function poseRig(){
  if (App._poseRig && App._poseRigFor === App.geomData) return App._poseRig;
  App._poseRigFor = App.geomData;
  return (App._poseRig = buildPoseRig());
}
// What a control's slider sits at when the model is untouched.
function poseRest(entry){ return entry && entry.src === "a2d" ? entry.ref : 0; }
function poseValue(id, entry){
  const v = App.pose && App.pose[id];
  return v == null ? poseRest(entry) : +v;
}
// Apply every control to the scene. A baked control is one matrix per node, straight out of the
// clip; an inferred one is a rotation about a guessed pivot. Nothing nests in either case — a node
// claimed by an inner assembly was removed from the outer one's members, and the baked path
// composes the hierarchy itself before taking the delta.
// ---------- Applying a pose, as named steps on one object (ROADMAP 2.4) ----------
// `applyPose` was 97 lines carrying two unrelated pipelines and six scratch matrices shared between
// them. The steps are methods and the scratch travels in a `cx` the way `Composite`'s region does,
// which is what made the two halves separable at all: the baked path writes a matrix per NODE
// straight out of the clip, the inferred one composes a chain of assemblies.
const PoseApply = {
  // skeleton node → its meshes, built once. A baked pose touches a few hundred nodes and the model
  // has a few hundred meshes, so the obvious nested scan is ~10⁵ string comparisons on every frame
  // of a slider drag.
  meshesByNode(){
    const byNode = new Map();
    for (const [mn, mesh] of App.meshes) {
      const n = partNode(mn);
      let l = byNode.get(n);
      if (!l) byNode.set(n, l = []);
      l.push([mn, mesh]);
    }
    return byNode;
  },
  // One matrix onto every mesh of a node, and the mesh remembered as posed.
  put(cx, node, m){
    for (const [mn, mesh] of cx.byNode.get(node) || []) {
      cx.moved.add(mn);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      mesh.matrixWorldNeedsUpdate = true;                      // three.js recomputes matrixWorld from it
    }
  },
  // ---- the baked clip, all its controls in one pass ----
  // One walk of the skeleton covers every control, because each node's frame is looked up per
  // node; doing it per control would recompose the whole tree once per slider.
  baked(cx, rig){
    const frames = new Map(), refs = new Map();
    for (const [id, e] of rig) {
      if (e.src !== "a2d") continue;
      const v = poseValue(id, e);
      for (const n of e.nodes) { frames.set(n, v); refs.set(n, e.ref); }
    }
    if (!frames.size) return;
    const deltas = a2dDeltas(vehicleAnim(), vehicleSkeleton(), n => frames.has(n) ? frames.get(n) : null,
                             n => refs.has(n) ? refs.get(n) : null);
    if (!deltas) return;
    // Skeleton space has +Z where the extracted geometry has -Z, so the delta is conjugated by
    // diag(1,1,-1) — the same flip the armament placement needs. Conjugation, not a single
    // multiply: the transform has to be reflected on both sides or it lands mirrored.
    const F = new THREE.Matrix4().makeScale(1, 1, -1);
    for (const [node, d] of deltas) {
      cx.m.set(d[0][0], d[0][1], d[0][2], d[0][3],
               d[1][0], d[1][1], d[1][2], d[1][3],
               d[2][0], d[2][1], d[2][2], d[2][3],
               0, 0, 0, 1);
      cx.m.premultiply(F).multiply(F);
      PoseApply.put(cx, node, cx.m);
    }
  },
  // ---- the inferred hinges ----
  // Outermost first, and each assembly's matrix is its parent's times its own: the barrel is a
  // child of the gun, which is a child of the turret, so it takes all three turns.
  hinges(cx, rig){
    const chain = [];
    for (const [id, e] of rig) {
      if (e.src === "a2d") continue;
      for (const a of e.list) chain.push({ id, a });
    }
    chain.sort((p, q) => (p.a.depth || 0) - (q.a.depth || 0));
    const mats = new Map();                                    // assembly node → its composed matrix
    for (const { id, a } of chain) {
      const ctl = POSE_CONTROLS.find(c => c.id === id);
      // The gun's angle is the hull's to limit, not the slider's alone (poseGunAngle).
      const v = id === "gun" ? poseGunAngle() : poseValue(id, null);
      PoseApply.hinge(cx, a, ctl.unit === "°" ? v : v / 100 * ctl.deg, mats);
    }
  },
  // One assembly: turn about its own pivot, then take whatever encloses it.
  hinge(cx, a, deg, mats){
    // Skeleton space has +Z where the extracted geometry has -Z, so the axis and the pivot are
    // conjugated by diag(1,1,-1) on the way in — the same flip the armament placement needs.
    cx.axv.set(a.axis[0], a.axis[1], -a.axis[2]).normalize();
    cx.piv.set(a.pivot[0], a.pivot[1], -a.pivot[2]);
    cx.q.setFromAxisAngle(cx.axv, a.sign * deg * Math.PI / 180);
    cx.m.makeRotationFromQuaternion(cx.q);
    cx.t1.makeTranslation(cx.piv.x, cx.piv.y, cx.piv.z);
    cx.t2.makeTranslation(-cx.piv.x, -cx.piv.y, -cx.piv.z);
    cx.m.premultiply(cx.t1).multiply(cx.t2);
    const up = a.parent && mats.get(a.parent);
    if (up) cx.m.premultiply(up);
    mats.set(a.node, cx.m.clone());
    for (const name of a.members) PoseApply.put(cx, name, cx.m);
  },
  // Anything that was posed and is not any more goes back, matrix and flag both — a mesh left with
  // `matrixAutoUpdate` off is frozen at its last pose for the rest of the session.
  putBack(cx){
    for (const [mn, mesh] of App.meshes) {
      if (cx.moved.has(mn) || mesh.matrixAutoUpdate) continue;
      mesh.matrix.identity();
      mesh.matrixWorldNeedsUpdate = true;
      mesh.matrixAutoUpdate = true;
    }
  },
};
function applyPose(){
  const rig = poseRig();
  if (!rig || !modelGroup) return;
  const cx = { byNode: PoseApply.meshesByNode(), moved: new Set(),
               q: new THREE.Quaternion(), axv: new THREE.Vector3(), piv: new THREE.Vector3(),
               m: new THREE.Matrix4(), t1: new THREE.Matrix4(), t2: new THREE.Matrix4() };
  PoseApply.baked(cx, rig);
  PoseApply.hinges(cx, rig);
  PoseApply.putBack(cx);
  needsRender();
}
// "Neutral" is not "every slider at zero" once a clip is driving them: a baked control rests at
// the frame the geometry was authored in, which for a control surface is often mid-travel.
function poseIsNeutral(){
  const p = window.App && App.pose;
  if (!p) return true;
  const rig = App._poseRig;
  return !Object.keys(p).some(k => +p[k] !== poseRest(rig && rig.get(k)));
}
function resetPose(){ App.pose = {}; applyPose(); refreshPosePanel(); }
// The gun row, after a traverse: its band, and the value the hull actually allows.
function posePitchRow(){
  const t = poseTank();
  const inp = document.querySelector('#poseList input[data-pose="gun"]');
  if (!t || !inp || !t.bands || !t.bands.length) return;
  const band = TankRig.pitchAt(t, +(App.pose && App.pose.turret) || 0);
  if (!band) return;
  inp.min = band[0];
  inp.max = band[1];
  const v = poseGunAngle();
  if (+inp.value !== v) {
    inp.value = v;
    App.pose.gun = v;
    const val = inp.parentElement && inp.parentElement.querySelector(".val");
    if (val) val.textContent = v + "°";
  }
}
// ---------- The moving-parts panel, as named steps on one object (ROADMAP 2.4) ----------
// `refreshPosePanel` was 90 lines building four different rows and three different sentences, and
// nothing had ever looked at what it drew — `tools/t44_panels.mjs` has its two fixtures now
// (`pose-tank`, `pose-bare`), captured before this split, which is §4's rule. One binding, methods
// per piece, and the entry point keeps its name because nine callers use it.
const PosePanel = {
  // Nothing to move, and why not. An imported .obj carries no node tree, so this is the honest
  // answer rather than an empty panel.
  empty(el, wrap){
    if (wrap) wrap.style.display = App.geomData ? "" : "none";
    el.className = "hint";
    el.textContent = App.geomData
      ? "This model has no skeleton, so nothing can move. Only vehicles loaded from the game folder can be posed — an imported .obj has none."
      : "";
  },
  // What a control's label says it is driving: the clip's own nodes, or the assemblies the hinge
  // rig inferred — and, for a tank, the travel out of its datasheet (ROADMAP 4.1).
  title(c, e, baked){
    const tip = c.tip ? c.tip + "\n" : "";
    if (baked) {
      const n = e.nodes.length;
      return tip + n + " node" + (n === 1 ? "" : "s") +
        " from the vehicle's own baked animation: " + e.nodes.slice(0, 12).join(", ") + (n > 12 ? ", …" : "") +
        "\nFrame 0 is retracted/closed and frame 100 extended/open, exactly as the game defines it." +
        "\nThe model is drawn at frame " + e.ref + ", so that is where this slider rests.";
    }
    const n = e.list.reduce((k, a) => k + a.members.length, 0);
    const tank = (c.id === "turret" || c.id === "gun") ? poseTank() : null;
    return tip + e.list.length + " assembl" + (e.list.length === 1 ? "y" : "ies") +
      ", " + n + " part" + (n === 1 ? "" : "s") + ": " + e.list.map(a => a.node).join(", ") +
      (tank
        ? "\nThe travel is this vehicle's own, from its datasheet: " + TankRig.label(tank) + "." +
          (c.id === "gun" && tank.bands && tank.bands.length
            ? " The depression is not the same all the way round — traverse the turret and this slider follows the hull."
            : "")
        : "\nNo baked animation covers this part, so the hinge is inferred from its shape and the" +
          " range here is conventional rather than the game's own.");
  },
  row(el, c, e, pose){
    const baked = e.src === "a2d";
    const row = document.createElement("div");
    row.className = "row";
    const lab = document.createElement("label");
    lab.textContent = c.label;
    lab.title = PosePanel.title(c, e, baked);
    if (!baked) lab.style.opacity = ".75";                     // inferred, not from the game's keys
    const inp = document.createElement("input");
    inp.type = "range";
    const range = poseRange(c, e);
    inp.min = range.min;
    inp.max = range.max;
    inp.step = 1;
    inp.value = poseValue(c.id, e);
    inp.dataset.pose = c.id;
    const val = document.createElement("span");
    val.className = "val";
    const show = () => val.textContent = (+inp.value) + (!baked && c.unit === "°" ? "°" : "%");
    show();
    inp.oninput = () => {
      pose[c.id] = +inp.value;
      show();
      applyPose();
      // Traversing changes what the gun may do, so its own row follows rather than lying about it.
      if (c.id === "turret") posePitchRow();
    };
    row.append(lab, inp, val);
    el.appendChild(row);
  },
  // One sentence about the panel as a whole. A tank's travel is its own even where the hinge is
  // inferred (ROADMAP 4.1), so the old "conventional" line would tell the user the opposite of
  // what the sliders are doing.
  note(el, anyBaked){
    const note = document.createElement("div");
    note.className = "hint";
    const sheet = poseTank();
    note.textContent = anyBaked
      ? "0 = retracted / closed, 100 = extended / open, from this vehicle's own animation. Dimmed rows have none: their hinge is estimated from the part's shape."
      : sheet
        ? "Turret and gun ranges come from this vehicle's datasheet; the hinges are estimated from the model (dimmed rows). It ships no baked animation."
        : "This vehicle ships no baked animation, so every hinge below is inferred from the shape of the part and the travel is conventional.";
    el.appendChild(note);
    const btn = document.createElement("button");
    btn.textContent = "Reset to the model's own pose";
    btn.style.width = "100%";
    btn.onclick = resetPose;
    el.appendChild(btn);
  },
};
function refreshPosePanel(){
  const el = $("poseList");
  if (!el) return;
  el.innerHTML = "";
  const rig = poseRig();
  const wrap = $("posePanel");
  if (!rig || !rig.size) { PosePanel.empty(el, wrap); return; }
  if (wrap) wrap.style.display = "";
  el.className = "";
  const cls = vehicleClass();
  const pose = App.pose || (App.pose = {});
  let anyBaked = false;
  for (const c of POSE_CONTROLS) {
    const e = rig.get(c.id);
    if (!e) continue;
    const baked = e.src === "a2d";
    if (baked) anyBaked = true;
    if (c.cls && !c.cls.split(" ").includes(cls) && !baked) continue;
    PosePanel.row(el, c, e, pose);
  }
  PosePanel.note(el, anyBaked);
}
/*==ENDPOSE==*/
