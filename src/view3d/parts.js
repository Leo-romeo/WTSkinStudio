// ---- Part grouping ----
// The node names come straight from the game's model files, and the conventions differ per
// vehicle type and per era. Rules derived from a survey of 27 models across five classes
// (WW2 and modern aircraft, WW2 and modern tanks, helicopters, ships) — the old single
// aircraft-shaped rule set left 596 of 872 modern-tank parts and 367 of 603 ship parts sitting
// in one "Airframe" bucket, with a tank's road wheels filed under "Landing gear".
//
// Naming facts the rules lean on:
//   ex_*            "external" attachments — ex_armor_*, ex_era_* (ERA blocks), ex_decor_*
//                   (stowage, tarps, logs), ex_lantern_* (lights). Dominant on modern tanks.
//   bone_*          a node driven by the skeleton (bone_turret, bone_gun, bone_mg_aa_h)
//   wheel_l_NN / wheel_l_drive / wheel_l_front / wheel_l_top_NN / roll_NN / suspension_*
//   turret_NN, gun_barrel_NN, aa_turret_NN, main_caliber_*, auxiliary_caliber_* (ships)
//   nozzle1_1…      jet exhaust nozzles (583 of them across five jets)
//   prop01_1        propeller blades — also used for helicopter ROTOR blades
//   fire1_1         gun muzzle-flash billboards; flare1… countermeasure dispensers
//   fuse, tail, wing_l/r, aileron, flap, slat, elevator, rudder, airbrake
//   tt_NN torpedo tubes · depth_charge_* · fire_director_* · rangefinder_* · mast_* ·
//   superstructure_* · framing · propeller_NN (ships)
const GROUP_SETS = {
  air: {
    order: ["Airframe", "Wings & control surfaces", "Engines & nozzles", "Propellers", "Landing gear",
      "Cockpit & interior", "Pylons & racks", "Weapons & pods", "Countermeasures", "Glass & canopy", "Effects"],
    rules: [
      ["Effects", /gunfire|jet_flame|flame|muzzle|smoke|\bfire\d/],
      ["Glass & canopy", /glass|canopy|chrome|windshield/],
      ["Cockpit & interior", /inside|interior|interrior|cockpit|pilot|gauge|dashboard|\bseat|stick|throttle/],
      ["Countermeasures", /flare|chaff|\bcm_|dispenser/],
      ["Propellers", /\bprop(\d|_)|propeller|spinner|\bblade/],
      ["Engines & nozzles", /nozzle|afterburner|exhaust|radiator|\bengine|intake|inlet/],
      ["Wings & control surfaces", /elevator|aileron|flap(?!_gear)|rudder|slat|airbrake|speedbrake|spoiler|stabilizer|swing_wing|wing|fin\d|canard|pgo_/],
      ["Landing gear", /gear|wheel|strut|susp|tailhook|hook\d|\bhook\b|chute|door|hatch/],
      ["Pylons & racks", /pylon|rack|btb|holder|adapter|apu_|aku|bd\d|bdz|mount|launcher|(^|_)lau[_\d]|connector|spring/],
      ["Weapons & pods", /pod|gun|m61|missile|bomb|rocket|gpu|suu|fab|cannon|blister|turret|barrel|ammo|belt|shell|tank_/],
    ],
  },
  helicopter: {
    order: ["Fuselage", "Rotor & blades", "Tail & control surfaces", "Engines", "Landing gear",
      "Cockpit & interior", "Pylons & racks", "Weapons & pods", "Countermeasures", "Glass & canopy", "Effects"],
    rules: [
      ["Effects", /gunfire|jet_flame|flame|muzzle|smoke|\bfire\d/],
      ["Glass & canopy", /glass|canopy|chrome|windshield|blister/],
      ["Cockpit & interior", /inside|interior|interrior|cockpit|pilot|gauge|dashboard|\bseat|stick/],
      ["Countermeasures", /flare|chaff|dispenser|lipa/],
      ["Rotor & blades", /rotor|\bprop(\d|_)|\bblade|swashplate|hub/],
      ["Engines", /nozzle|exhaust|\bengine|intake|inlet|radiator/],
      ["Tail & control surfaces", /elevator|rudder|stabilizer|\btail|\bfin\d|wing/],
      ["Landing gear", /gear|wheel|strut|susp|skid|door/],
      ["Pylons & racks", /pylon|rack|holder|adapter|apu|mount|launcher|tpk|arm_/],
      ["Weapons & pods", /pod|gun|mgun|missile|bomb|rocket|turret|barrel|cannon|guv|upk|vyihr|ub_|s24|(^|_)xm[_\d]|avr\d|aero_\d|ammo/],
    ],
  },
  tank: {
    order: ["Hull", "Turret", "Gun & mantlet", "Running gear", "Applique armour & ERA", "Stowage & fittings",
      "Optics & MGs", "Hatches & doors", "Interior", "Glass & lights", "Camo nets", "Effects"],
    rules: [
      ["Effects", /gunfire|flame|muzzle|smoke|\bfire\d/],
      ["Camo nets", /(^|_)net(_|\d|$)|tarp|camo_net/],
      ["Glass & lights", /glass|lantern|headlight|light\b|lamp|periscope_glass/],
      ["Interior", /inside|interior|interrior|\bcrew|\bseat|(driver|gunner|commander|loader)_(seat|body|dummy|figure)/],
      ["Applique armour & ERA", /(^|_)era(_|\d|$)|armor|armour|skirt|shield|zimmerit|cage/],
      ["Stowage & fittings", /decor|(^|_)log(s|_|\d|$)|tool|box|crate|barrel_fuel|fuel_tank|tank_ex|jerry|antenna|(^|_)tow(_|\d|$)|cable|hook|bucket|spare|track_link|attch/],
      ["Optics & MGs", /optic|sight|periscope|rangefinder|mg_|mgun|nsvt|dshk|browning|coax/],
      ["Hatches & doors", /hatch|door|lid|cover/],
      ["Gun & mantlet", /gun|barrel|mask|mantlet|muzzle_brake|recoil|cannon/],
      ["Running gear", /wheel|roll\d|roll_|suspension|susp|track|sprocket|idler|caterp|torsion|\barm_\d/],
      ["Turret", /turret|cupola|basket/],
      ["Hull", /hull|body|framing|engine|deck|fender|glacis/],
    ],
  },
  ship: {
    order: ["Hull & superstructure", "Main battery", "Secondary & AA battery", "Torpedoes & depth charges",
      "Directors, radar & optics", "Masts & rigging", "Boats & aircraft", "Deck fittings & decor",
      "Propulsion & steering", "Camo nets", "Glass & lights", "Effects"],
    rules: [
      ["Effects", /gunfire|flame|muzzle|smoke|\bfire\d(?!rector)/],
      ["Camo nets", /(^|_)net(_|\d|$)|tarp/],
      ["Glass & lights", /glass|porthole|lantern|searchlight|light\b|lamp/],
      ["Directors, radar & optics", /director|rangefinder|radar|optic|sight|antenna|periscope|target_location/],
      ["Masts & rigging", /mast|rigg|(^|_)rope|funnel|stack|flag|halyard|ladder|stairs/],
      ["Boats & aircraft", /lifeboat|\bboat|raft|aircraft|airplane|catapult|crane|davit|hangar/],
      ["Torpedoes & depth charges", /torpedo|\btt_|\btt\d|depth_charge|mine_|launcher/],
      ["Main battery", /main_caliber|main_gun/],
      ["Secondary & AA battery", /aa_|auxiliary|secondary|turret|gun|barrel|mg_|cannon|ammo|shell/],
      ["Propulsion & steering", /propeller|screw|shaft|rudder|anchor|chain|keel/],
      ["Deck fittings & decor", /decor|armor|bollard|winch|vent|hatch|door|railing|fitting|equipment|bodypart|holder/],
      ["Hull & superstructure", /hull|body|superstructure|framing|deck|bow|stern|casemate/],
    ],
  },
};
GROUP_SETS.boat = GROUP_SETS.ship;
GROUP_SETS.other = GROUP_SETS.air;
const GROUP_FALLBACK = { air: "Airframe", helicopter: "Fuselage", tank: "Hull", ship: "Hull & superstructure", boat: "Hull & superstructure", other: "Airframe" };
// The unit registry knows the class, but a raw .obj or an unmatched model does not — in that
// case read it off the part names themselves (road wheels + suspension = tank, gun turrets
// numbered past four = ship, a rotor = helicopter).
function guessModelKind(){
  const cls = typeof vehicleClass === "function" ? vehicleClass() : "other";
  if (cls === "tank" || cls === "ship" || cls === "helicopter" || cls === "boat") return cls;
  const names = App.geomData ? App.geomData.map(g => g.name.toLowerCase()) : [];
  if (!names.length) return cls === "air" ? "air" : "other";
  const has = re => names.some(n => re.test(n));
  const count = re => names.filter(n => re.test(n)).length;
  if (has(/rotor|swashplate/)) return "helicopter";
  if (count(/^wheel_[lr]_\d/) >= 4 && has(/suspension|roll_|turret/)) return "tank";
  if (has(/superstructure|depth_charge|fire_director|main_caliber|auxiliary_caliber/) || count(/^aa_turret_\d/) >= 3) return "ship";
  if (has(/^wing_[lr]|aileron|nozzle|elevator/)) return "air";
  return cls === "other" ? "air" : cls;
}
function groupSet(){ return GROUP_SETS[App.modelKind || "other"] || GROUP_SETS.other; }
const DEFAULT_GROUP_ORDER = GROUP_SETS.air.order;
// The part name decides first and the material is only a fallback hint — testing them as one
// string broke the end-anchored rules ("turret_net" stopped looking like a net once a material
// name was appended after it).
function ruleGroup(name, mat){
  const set = groupSet();
  const n = (name || "").toLowerCase();
  for (const [g, re] of set.rules) if (re.test(n)) return g;
  if (mat) { const m = mat.toLowerCase(); for (const [g, re] of set.rules) if (re.test(m)) return g; }
  return GROUP_FALLBACK[App.modelKind] || "Airframe";
}
// ---- Part groups: user-editable, project-persisted, undoable ----
// App.partGroups: ordered [{name, custom}] · App.partAssign: Map part→group ·
// App.groupCollapsed: Set (view state) — all saved in the project file.
function initPartGroups(){
  const kind = App.modelKind = guessModelKind();
  // A new vehicle class needs its own group list — a ship has no landing gear and a tank's
  // road wheels are not one either. Custom groups the user made are always kept.
  if (App.partGroups && App.partGroupsKind !== kind) {
    const custom = App.partGroups.filter(g => g.custom);
    App.partGroups = groupSet().order.map(name => ({ name, custom: false })).concat(custom);
    for (const [name, g] of [...(App.partAssign || new Map())])
      if (!custom.some(c => c.name === g)) App.partAssign.delete(name);       // re-file with the new rules
  }
  if (!App.partGroups) App.partGroups = groupSet().order.map(name => ({ name, custom: false }));
  if (App.weaponsLoaded && App.weaponsLoaded.size && !App.partGroups.some(g => g.name === "Suspended armament"))
    App.partGroups.unshift({ name: "Suspended armament", custom: false });
  App.partGroupsKind = kind;
  if (!App.partAssign) App.partAssign = new Map();
  if (!App.groupCollapsed) App.groupCollapsed = new Set();
  if (!App.groupOpen) App.groupOpen = new Set();
  if (App.partUnfold == null) App.partUnfold = 0;
  const known = new Set(App.partGroups.map(g => g.name));
  for (const [name, mesh] of App.meshes) {
    const cur = App.partAssign.get(name);
    if (cur && known.has(cur)) continue;
    App.partAssign.set(name, mesh.userData.weapon ? "Suspended armament" : ruleGroup(name, matBaseName(mesh.userData.mat)));
  }
  for (const name of [...App.partAssign.keys()]) if (!App.meshes.has(name)) App.partAssign.delete(name);
}
// "@root" is what the model files call the unnamed main mesh — every WT model has one and it is
// always the hull / fuselage. Show that instead of the raw token.
function partLabel(name){
  if (name === "@root" || name === "root") return "main body";
  return name.replace(/^@root /, "main body ");
}
function partGroupOf(name){ return (App.partAssign && App.partAssign.get(name)) || GROUP_FALLBACK[App.modelKind] || "Airframe"; }
function snapshotPartState(){
  return {
    groups: App.partGroups ? App.partGroups.map(g => ({ ...g })) : null,
    assign: App.partAssign ? new Map(App.partAssign) : null,
    sel: new Set(App.selParts),
    prot: new Set(App.protectedParts),
  };
}
function restorePartState(st){
  if (st.groups) App.partGroups = st.groups.map(g => ({ ...g }));
  if (st.assign) App.partAssign = new Map(st.assign);
  App.selParts = new Set(st.sel);
  App.protectedParts = new Set(st.prot || []);
  refreshPartList(); updateSelectionVisuals(); SelectUI.sync();
}
// Wraps a mutation of groups/assignments/selection into one undoable step. Every click gets its
// own entry — undo after picking five parts takes the fifth one back off, not the whole
// selection. (These entries are a couple of Sets; the history budget is spent on bitmaps.)
function partAction(desc, mutate){
  const before = snapshotPartState();
  mutate();
  const after = snapshotPartState();
  const cost = (after.sel.size + after.prot.size + 8) * 64;
  pushAction(desc, () => restorePartState(before), () => restorePartState(after), cost);
  // SelectUI too: the Selection panel shows the part count and offers "islands of the selected
  // parts", so a Ctrl+click on the model that this panel never heard about is a stale offer.
  refreshPartList(); updateSelectionVisuals(); SelectUI.sync();
}
// One mesh node can be several "parts" (one per material it uses), and they usually sit on
// different textures. Selecting one of them and painting is what left unpainted patches, so a
// selection always takes the whole node.
function togglePartSel(name){
  const node = partNode(name);
  const pieces = piecesOfNode(node);
  const on = !pieces.every(p => App.selParts.has(p));
  setSelAnchor(node);                     // Ctrl+Alt and Ctrl+wheel work from the last part clicked
  partAction((on ? "select " : "deselect ") + node, () => {
    for (const p of pieces) on ? App.selParts.add(p) : App.selParts.delete(p);
  });
  // Returned rather than set here, so the caller decides whether this click deserves the status
  // line — same shape as togglePartExclude, which is the other half of the same gesture.
  return (on ? "Selected “" : "Deselected “") + partLabel(node) + "” — " + App.selParts.size + " part(s) selected";
}
function togglePartProtect(name){
  const node = partNode(name);
  const pieces = piecesOfNode(node);
  const on = !pieces.every(p => App.protectedParts.has(p));
  partAction((on ? "exclude " : "include ") + node, () => {
    for (const p of pieces) on ? App.protectedParts.add(p) : App.protectedParts.delete(p);
  });
}
function movePartsToGroup(parts, groupName){
  partAction("move " + parts.length + " part(s) to " + groupName, () => {
    for (const p of parts) App.partAssign.set(p, groupName);
  });
}
function createPartGroup(name, parts){
  partAction("create group " + name, () => {
    if (!App.partGroups.some(g => g.name === name)) App.partGroups.push({ name, custom: true });
    for (const p of parts || []) App.partAssign.set(p, name);
  });
}
function deletePartGroup(name){
  partAction("delete group " + name, () => {
    App.partGroups = App.partGroups.filter(g => g.name !== name);
    for (const [p, g] of App.partAssign) if (g === name) {
      const mesh = App.meshes.get(p);
      let def = ruleGroup(p, mesh ? matBaseName(mesh.userData.mat) : "");
      if (def === name) def = "Airframe";
      App.partAssign.set(p, def);
    }
  });
}
function renamePartGroup(oldName, newName){
  partAction("rename group", () => {
    const g = App.partGroups.find(x => x.name === oldName);
    if (!g) return;
    g.name = newName;
    for (const [p, gr] of App.partAssign) if (gr === oldName) App.partAssign.set(p, newName);
    if (App.groupCollapsed.delete(oldName)) App.groupCollapsed.add(newName);

  });
}
// ---- Logical parts and auto sub-groups ----
// One mesh node routinely reaches the app as several "parts", because a node that uses three
// materials is split one group per material (wing_r (f_4e_add), wing_r (f_4c_inside), ...).
// Selecting one of those and painting left the others untouched, and since they usually live on
// a DIFFERENT texture the result was an unpainted patch in the middle of a painted part - the
// green sliver inside the F-4E's radiator fin. The Parts tab therefore lists the node, and the
// material pieces hang under it; selecting the node takes all of them.
function partNode(name){ return String(name).replace(/\s*\([^()]*\)\s*$/, ""); }
// "nozzle2_24" must sort after "nozzle2_3", not before it: compare digit runs as numbers.
function natCmp(a, b){
  const A = String(a).toLowerCase(), B = String(b).toLowerCase();
  const re = /(\d+)|(\D+)/g;
  let ma, mb;
  re.lastIndex = 0;
  const ta = A.match(re) || [], tb = B.match(re) || [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    ma = ta[i]; mb = tb[i];
    const na = /^\d/.test(ma), nb = /^\d/.test(mb);
    if (na && nb) { const d = (+ma) - (+mb); if (d) return d; }
    else if (ma !== mb) return ma < mb ? -1 : 1;
  }
  return ta.length - tb.length;
}
// Node names in a WT model are systematic: a base word, an optional series number, an optional
// side and a run index — nozzle2_15, gear_l14, slat1_r, us_m61_gun_barrel_002, flaperon_l.
// Split one into the levels it should be filed under, plus the side and the run index, which are
// never levels of their own:
//   nozzle2_24   → levels [nozzle, nozzle2]   index 24     (so nozzle1_* and nozzle2_* separate,
//                                                           and both still live under "nozzle")
//   flaperon_l   → levels [flaperon]  side l               (so _l and _r share one parent)
//   gear_l14     → levels [gear]      side l  index 14
//   us_m61_gun_barrel_002 → levels [us, m61, gun, barrel]  index 002
// A trailing digit run only becomes a series marker when the word in front of it is a real word
// (three letters or more), so "m61" stays "m61" instead of turning into an "m" series, and
// digits FOLLOWED by letters are part of the name, so aim_9e and aim_9l stay apart.
const SIDE_TOK = { l: "l", r: "r", lt: "l", rt: "r", left: "l", right: "r", c: "c", ctr: "c", center: "c", centre: "c" };
const SIDE_LABEL = { l: "left", r: "right", c: "centre" };
const partSegCache = new Map();                 // node name → segments (pure function of the name)
function partSegments(node){
  const hit = partSegCache.get(node);
  if (hit) return hit;
  const out = partSegmentsOf(node);
  if (partSegCache.size > 20000) partSegCache.clear();
  partSegCache.set(node, out);
  return out;
}
function partSegmentsOf(node){
  const raw = String(node).toLowerCase().split(/[\s_.\-]+/).filter(Boolean);
  const levels = [];
  const sides = [];
  let index = null;
  for (const t of raw) {
    if (/^[0-9]+$/.test(t)) { index = index == null ? t : index + "_" + t; continue; }
    const sm = /^(lt|rt|left|right|ctr|center|centre|l|r|c)([0-9]*)$/.exec(t);
    if (sm && levels.length) {                                  // a side marker only after a name
      sides.push(SIDE_TOK[sm[1]]);
      if (sm[2]) index = index == null ? sm[2] : index + "_" + sm[2];
      continue;
    }
    const dm = /^(.*?)([0-9]+)$/.exec(t);
    if (dm && /^[a-z]{3,}$/.test(dm[1])) { levels.push(dm[1]); levels.push(dm[1] + dm[2]); }
    else levels.push(t);
  }
  if (!levels.length) levels.push(raw[0] || String(node).toLowerCase());
  return { levels, side: sides[0] || null, index };
}
// The levels are what the tree is keyed on; they are not always the best NAME for a branch.
// "m61" is one level, so four M61 barrels would read as "m61" alone — the longest common prefix
// of the real node names says "us_m61_gun_barrel" instead. Take whichever reads longer.
function commonPartLabel(key, nodes){
  let p = nodes[0] || "";
  for (const n of nodes) { let i = 0; while (i < p.length && i < n.length && p[i].toLowerCase() === n[i].toLowerCase()) i++; p = p.slice(0, i); }
  p = p.replace(/[\s_.\-]*[0-9]*$/, "");
  if (p.length <= key.length) return key;
  // The prefix alone is not always the whole story: an F/A-18's launcher rails all start
  // "lau_116_", so the cap, lift and adapter branches would every one of them read "lau_116".
  // Where the prefix does not already contain the word the branch is keyed on, say both.
  return p.toLowerCase().includes(key) ? p : p + " · " + key;
}
const SUB_MIN = 2;            // a branch needs this many nodes to be worth its own header
const SUB_DEPTH = 3;          // never nest sub-groups deeper than this
const SIDE_SPLIT = 8;         // above this many nodes, left / right / centre becomes a sub-level
// Build the sub-group tree for one category. Returns { groups:[{key,label,nodes,sides,children,
// depth,path}], loose:[node] } where `children` is the same shape one level down.
function subTreeOf(nodes, parentPath, depth){
  depth = depth || 0;
  const buckets = new Map();
  const loose = [];
  for (const n of nodes) {
    const seg = partSegments(n);
    const lv = seg.levels[depth];
    if (lv == null) { loose.push(n); continue; }              // the prefix itself is a whole name
    if (!buckets.has(lv)) buckets.set(lv, []);
    buckets.get(lv).push(n);
  }
  const groups = [];
  for (const [lv, list] of buckets) {
    if (list.length < SUB_MIN) { loose.push(...list); continue; }
    const path = parentPath + "▸" + lv;
    const g = { key: lv, nodes: list, depth, path, children: [], loose: list };
    if (depth + 1 < SUB_DEPTH) {
      const sub = subTreeOf(list, path, depth + 1);
      // Splitting is only an improvement when it yields more than one real branch; one branch
      // holding everything is the same list with an extra click in front of it.
      if (sub.groups.length > 1) { g.children = sub.groups; g.loose = sub.loose; }
    }
    g.label = commonPartLabel(lv, list);
    g.sides = [...new Set(list.map(n => partSegments(n).side).filter(Boolean))].sort();
    // A landing gear's 82 nodes are all just "gear" with a side and a run number — no deeper
    // name to split on. Once a group is that big the side IS the useful division, so it becomes
    // the sub-level. Small pairs (flaperon_l / flaperon_r) stay together, which is the point.
    if (!g.children.length && g.sides.length > 1 && list.length > SIDE_SPLIT) {
      const bySide = new Map();
      for (const n of list) {
        const s = partSegments(n).side || "-";
        if (!bySide.has(s)) bySide.set(s, []);
        bySide.get(s).push(n);
      }
      const kids = [];
      for (const [s, sub] of bySide) {
        if (sub.length < SUB_MIN) continue;
        kids.push({ key: s, label: g.label, sides: [s === "-" ? null : s].filter(Boolean), nodes: sub,
          depth: depth + 1, path: path + "▸" + s, children: [], loose: sub });
      }
      if (kids.length > 1 && kids.reduce((a, k) => a + k.nodes.length, 0) === list.length) {
        kids.sort((a, b) => natCmp(a.key, b.key));
        g.children = kids; g.loose = [];
      }
    }
    groups.push(g);
  }
  groups.sort((a, b) => natCmp(a.label, b.label));
  loose.sort(natCmp);
  return { groups, loose };
}
// "flaperon" carrying an _l and an _r reads as "flaperon (left, right)" — the pair is one thing
// with two hands, and that is how it wants to be painted.
const SIDE_ORDER = { l: 0, r: 1, c: 2 };
function subGroupTitle(g){
  if (!g.sides || !g.sides.length || g.sides.length > 3) return g.label;
  const s = g.sides.slice().sort((a, b) => (SIDE_ORDER[a] ?? 9) - (SIDE_ORDER[b] ?? 9));
  return g.label + " (" + s.map(x => SIDE_LABEL[x] || x).join(", ") + ")";
}
// ---- Shape signatures: which nodes are the same piece of geometry ----
// Names alone cannot tell an F/A-18's inner nozzle ring from the outer one — both are
// "nozzle2_NN" — and those two want different paint. A node's shape is described by its triangle
// count, the sorted extents of its bounding box and its radius of gyration: all three survive
// being moved, rotated or mirrored to another station, so every instance of the same part gets
// the same signature and two different parts sharing a name do not.
function buildGeomSigs(){
  const acc = new Map();
  for (const g of App.geomData || []) {
    const node = partNode(g.name);
    let a = acc.get(node);
    if (!a) acc.set(node, a = { tris: 0, n: 0, sx: 0, sy: 0, sz: 0, q: 0,
      x0: 1e30, y0: 1e30, z0: 1e30, x1: -1e30, y1: -1e30, z1: -1e30 });
    const p = g.position;
    a.tris += g.tris || p.length / 9;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i+1], z = p[i+2];
      if (x < a.x0) a.x0 = x; if (x > a.x1) a.x1 = x;
      if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y;
      if (z < a.z0) a.z0 = z; if (z > a.z1) a.z1 = z;
      a.sx += x; a.sy += y; a.sz += z; a.n++;
    }
  }
  const out = new Map();
  for (const [node, a] of acc) {
    if (!a.n) continue;
    const ext = [a.x1 - a.x0, a.y1 - a.y0, a.z1 - a.z0].sort((u, v) => v - u);
    const cx = a.sx / a.n, cy = a.sy / a.n, cz = a.sz / a.n;
    const q = v => Math.round(v * 1000);                        // 1 mm buckets
    out.set(node, { sig: a.tris + "/" + ext.map(q).join("x"), tris: a.tris, ext,
      size: ext[0], c: [cx, cy, cz] });
  }
  App.geomSigs = out;
  App.geomSigSrc = App.geomData;        // every path that changes the geometry replaces the array
  return out;
}
function geomSigs(){
  if (!App.geomSigs || App.geomSigSrc !== App.geomData) buildGeomSigs();
  return App.geomSigs;
}
function nodeShape(node){ return geomSigs().get(node) || null; }
function nodeSig(node){ const s = nodeShape(node); return s ? s.sig : ""; }
// Every node in the model whose geometry is the same piece as this one's.
function nodesLikeShape(node){
  const sig = nodeSig(node);
  if (!sig) return [node];
  const out = [];
  for (const [n, s] of geomSigs()) if (s.sig === sig) out.push(n);
  return out.length ? out : [node];
}
// Split one leaf group into shape classes, largest first. Only worth doing when there really are
// several distinct shapes, each with more than one instance — otherwise it is noise.
function shapeSplit(nodes){
  if (nodes.length < 4) return null;
  const by = new Map();
  for (const n of nodes) {
    const s = nodeShape(n);
    if (!s) return null;
    if (!by.has(s.sig)) by.set(s.sig, { sig: s.sig, shape: s, nodes: [] });
    by.get(s.sig).nodes.push(n);
  }
  const cls = [...by.values()];
  if (cls.length < 2 || cls.length > 6 || cls.some(c => c.nodes.length < 2)) return null;
  cls.sort((a, b) => b.shape.size - a.shape.size || b.nodes.length - a.nodes.length);
  for (const c of cls) c.nodes.sort(natCmp);
  return cls;
}
function shapeTip(s){
  if (!s) return "";
  const m = v => (v * 1000).toFixed(0);
  return s.tris.toLocaleString() + " triangles · " + m(s.ext[0]) + " × " + m(s.ext[1]) + " × " + m(s.ext[2]) + " mm";
}
// Every "part" (node + material) that belongs to a node.
function piecesOfNode(node){
  const out = [];
  for (const name of App.meshes.keys()) if (partNode(name) === node) out.push(name);
  return out;
}
// ---- Solo (show only these) ----
// Module-level so the keyboard (Ctrl+H) can reach it, not just the rows in the Parts list.
function soloKeyOf(names){ return [...new Set(names)].sort().join("\u0001"); }
function isSoloSet(names){ return !!App.soloKey && App.soloKey === soloKeyOf(names); }
function unsoloParts(){
  App.solo = App.soloKey = App.soloSet = null;
  applySceneVisibility();
}
function soloParts(names){
  names = [...names].filter(n => App.meshes.has(n));
  if (!names.length) { setStatus("Nothing selected to solo", "err"); return; }
  if (isSoloSet(names)) unsoloParts();
  else {
    App.solo = true; App.soloKey = soloKeyOf(names); App.soloSet = new Set(names);
    applySceneVisibility();
  }
  refreshPartList(); needsRender();
}
// The Parts tree's own show / hide checkboxes. Remembered by name, so switching pylons or effects
// on and off does not bring back something the user deliberately hid.
function setPartsHidden(names, hidden){
  for (const n of names) hidden ? App.hiddenParts.add(n) : App.hiddenParts.delete(n);
  App.solo = App.soloKey = App.soloSet = null;
  // Ticking a part that a global switch is also hiding has to do what it says, or the checkbox
  // just springs back: turn that switch on rather than leave the part invisible.
  if (!hidden) {
    const meshes = names.map(n => App.meshes.get(n)).filter(Boolean);
    if (meshes.some(m => m.userData.effect) && !App.showEffects) App.showEffects = true;
    if (meshes.some(m => m.userData.unposed) && !App.showUnposed) { App.showUnposed = true; $("optShowUnposed").checked = true; }
    if (names.some(n => mountParts().has(n)) && App.showPylons === false) App.showPylons = true;
    if (names.some(n => /^(.+?) · /.test(n)) && !App.showWeapons) App.showWeapons = true;
    syncSceneToggles();
    App.mountParts = null;
  }
  applySceneVisibility();
}
// ---- Folding ----
// The tree opens to a fixed depth by default and remembers only what the user has toggled by
// hand: partUnfold 0 = every sub-group folded (categories still show), 1 = the first subdivision
// is open, 2 = the second as well.
function groupIsOpen(key, depth){
  if (App.groupOpen && App.groupOpen.has(key)) return true;
  if (App.groupCollapsed && App.groupCollapsed.has(key)) return false;
  return depth === 0 || depth <= (App.partUnfold || 0);
}
function toggleGroupOpen(key, depth){
  if (!App.groupOpen) App.groupOpen = new Set();
  if (!App.groupCollapsed) App.groupCollapsed = new Set();
  if (groupIsOpen(key, depth)) { App.groupOpen.delete(key); App.groupCollapsed.add(key); }
  else { App.groupCollapsed.delete(key); App.groupOpen.add(key); }
}
function setPartUnfold(n){
  App.partUnfold = n;
  if (App.groupOpen) App.groupOpen.clear();
  if (App.groupCollapsed) App.groupCollapsed.clear();
  refreshPartList();
}
// node → its parts, built once per model instead of scanning every mesh per node.
function nodeParts(){
  if (App._nodeParts && App._nodePartsSrc === App.geomData && App._nodePartsN === App.meshes.size) return App._nodeParts;
  const m = new Map();
  for (const name of App.meshes.keys()) {
    const n = partNode(name);
    if (!m.has(n)) m.set(n, []);
    m.get(n).push(name);
  }
  App._nodeParts = m; App._nodePartsSrc = App.geomData; App._nodePartsN = App.meshes.size;
  return m;
}
// Every collapsible key currently in the tree, for "fold all".
function allGroupKeys(){
  const keys = [];
  const byCat = new Map();
  for (const name of App.meshes.keys()) {
    const c = partGroupOf(name);
    if (!byCat.has(c)) byCat.set(c, new Set());
    byCat.get(c).add(partNode(name));
  }
  const walk = gs => { for (const g of gs) { keys.push(g.path); walk(g.children); } };
  for (const [cat, set] of byCat) {
    keys.push(cat);
    if (set.size > 3) walk(subTreeOf([...set], cat, 0).groups);
  }
  return keys;
}
// ---- Widening / narrowing a selection one level at a time (Ctrl + wheel) ----
// The anchor is the last part you clicked. From it the hierarchy reads outwards: the part
// itself, the other parts of its exact shape, its innermost sub-group, the one above that, its
// whole category, then the model. Whatever was selected before the anchor click is kept
// throughout, so widening ADDS rather than replaces.
function setSelAnchor(node){
  const own = new Set(nodeParts().get(node) || []);
  const base = new Set();
  for (const n of App.selParts) if (!own.has(n)) base.add(n);
  App.selAnchor = { node, base, levels: null, step: 0 };
}
function selectionLevelsFor(node){
  const cat = partGroupOf((nodeParts().get(node) || [node])[0]);
  const inCat = new Set();
  for (const name of App.meshes.keys()) if (partGroupOf(name) === cat) inCat.add(partNode(name));
  const levels = [{ label: partLabel(node), nodes: [node] }];
  const chain = [];
  const nodes = [...inCat];
  const walk = gs => {
    for (const g of gs) {
      if (!g.nodes.includes(node)) continue;
      chain.push({ label: subGroupTitle(g), nodes: g.nodes });
      if (g.children.length) walk(g.children);
      else {
        const sh = shapeSplit(g.nodes);
        const c = sh && sh.find(x => x.nodes.includes(node));
        if (c) chain.push({ label: "same shape", nodes: c.nodes });
      }
      return;
    }
  };
  if (nodes.length > 3) walk(subTreeOf(nodes, cat, 0).groups);
  for (let i = chain.length - 1; i >= 0; i--) levels.push(chain[i]);
  levels.push({ label: cat, nodes });
  const like = nodesLikeShape(node);
  if (like.length > 1) levels.push({ label: cat + " + every part of the same shape", nodes: like });
  levels.push({ label: "the whole model", nodes: [...nodeParts().keys()] });
  // Each level is the union of everything up to it, so widening only ever adds and narrowing
  // only ever removes — and a level that adds nothing is not a step at all.
  const out = [];
  const acc = new Set();
  for (const lv of levels) {
    for (const n of lv.nodes) acc.add(n);
    if (out.length && acc.size === out[out.length - 1].nodes.length) continue;
    out.push({ label: lv.label, nodes: [...acc] });
  }
  return out;
}
function growSelection(dir){
  const a = App.selAnchor;
  if (!a || !nodeParts().has(a.node)) {
    setStatus("Click a part first — Ctrl+wheel then widens or narrows the selection one level at a time", "err");
    return;
  }
  if (!a.levels) a.levels = selectionLevelsFor(a.node);
  const next = Math.max(0, Math.min(a.levels.length - 1, a.step + (dir > 0 ? 1 : -1)));
  if (next === a.step) {
    setStatus(dir > 0 ? "Already at the widest level (" + a.levels[next].label + ")" : "Already down to “" + partLabel(a.node) + "”", "");
    return;
  }
  a.step = next;
  const lv = a.levels[next];
  const np = nodeParts();
  partAction("select " + lv.label, () => {
    App.selParts = new Set(a.base);
    for (const n of lv.nodes) for (const p of (np.get(n) || [])) App.selParts.add(p);
  });
  setStatus("Level " + next + "/" + (a.levels.length - 1) + ": " + lv.label + " — " + lv.nodes.length + " node(s), " +
    App.selParts.size + " part(s) selected", "ok");
}
// "Everything shaped exactly like the one I just clicked" — the pairs and rings a name cannot
// separate (an F/A-18's inner nozzle ring against its outer one).
function selectSameShape(){
  const node = App.selAnchor && nodeParts().has(App.selAnchor.node) ? App.selAnchor.node
    : (App.selParts.size ? partNode([...App.selParts][0]) : null);
  if (!node) { setStatus("Click a part first, then Ctrl+Alt takes every part shaped like it", "err"); return; }
  const like = nodesLikeShape(node);
  if (like.length < 2) { setStatus("Nothing else in this model has the same geometry as “" + partLabel(node) + "”", ""); return; }
  const np = nodeParts();
  partAction("select " + like.length + " part(s) of the same shape", () => {
    for (const n of like) for (const p of (np.get(n) || [])) App.selParts.add(p);
  });
  setStatus(like.length + " node(s) share “" + partLabel(node) + "”'s exact geometry — all selected (" + shapeTip(nodeShape(node)) + ")", "ok");
}
// Which texture slot a part's pixels live on - shown per row, because "this piece is on another
// texture" is the usual reason a fill looks like it has a hole in it.
function slotOfPart(name){
  const m = App.meshes.get(name);
  return m ? App.slots.get(App.matSlot.get(m.userData.mat)) : null;
}
function selectionSet(names, on){
  partAction((on ? "select " : "deselect ") + names.length + " part(s)", () => {
    for (const n of names) on ? App.selParts.add(n) : App.selParts.delete(n);
  });
}
function selectAllParts(){ partAction("select all parts", () => { for (const n of App.meshes.keys()) App.selParts.add(n); }); }
function invertPartSelection(){
  partAction("invert selection", () => {
    const was = App.selParts;
    App.selParts = new Set();
    for (const n of App.meshes.keys()) if (!was.has(n)) App.selParts.add(n);
  });
}
// "Deselect this one part" while nothing is selected means "everything except this one". Rather
// than materialising a 300-entry selection to express it, that is what the exclude list is for -
// so the click that used to do nothing excludes instead, which is what people actually meant.
function togglePartExclude(name){
  const node = partNode(name);
  const pieces = piecesOfNode(node);
  if (App.selParts.size) {
    const hit = pieces.filter(p => App.selParts.has(p));
    if (hit.length) { selectionSet(hit, false); return "Deselected " + partLabel(node) + " (" + App.selParts.size + " still selected)"; }
  }
  const on = !pieces.some(p => App.protectedParts.has(p));
  partAction((on ? "exclude " : "include ") + node, () => {
    for (const p of pieces) on ? App.protectedParts.add(p) : App.protectedParts.delete(p);
  });
  return on ? "Shut “" + partLabel(node) + "” out of painting" : "Painting allowed on “" + partLabel(node) + "” again";
}

