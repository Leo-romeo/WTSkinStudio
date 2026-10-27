// Which aircraft does the app resolve a control surface on, and which does it not — ROADMAP 4.42.
//
// The report was "animations for moving parts are still not 100% working for most of the vehicles
// like rudder/ailerons and similar for many of the top tier jets". This measures the roster before
// anything is designed, which is this repo's standing method, and it is built to separate the three
// causes the item names:
//
//   * a NAMING MISMATCH — the model has a rudder node and `A2D_GROUPS` does not match its name;
//   * a MISSING READ    — the model has no skeleton, no clip, or no control-surface node at all;
//   * a handful of SPECIAL CASES.
//
// It works off SKELETON NODE NAMES only, which is what makes it cheap enough to run over every
// model in the install: `A2D_GROUPS` is a table of regexes over exactly those names, so a name the
// probe below calls a control surface and the table claims nothing for is a mismatch, whatever the
// clip turns out to hold. `tools/t22_pose.mjs` is the deeper instrument for the cases this turns
// up — it loads the geometry and the baked clip and checks the rig actually poses.
//
//   node --max-old-space-size=6144 tools/ctrl_sweep.mjs [--all] [--csv <path>]
//
// --all lists every model rather than the summary plus the failures.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { installOrExit, isDirEntry } from "./wtdir.mjs";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const WT = installOrExit();   // tools/wtdir.mjs: WT_DIR, else Steam's library list, else the usual folders
const argv = process.argv.slice(2);
const src = fs.readFileSync(HTML, "utf8");
const section = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + n + " missing");
  return src.slice(a + 1, b);
};
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: (await import("node:crypto")).webcrypto });
globalThis.ZSTD_WASM_B64 = /const ZSTD_WASM_B64 = "([^"]*)";/.exec(src)[1];
const Z = new Function(section("ZSTD") + "\nreturn { zstdDec: Zstd.zstdDec };")();
globalThis.Zstd = { zstdDec: Z.zstdDec };   // the sections reach it as Zstd.zstdDec (ROADMAP 2.3)
const MOD = new Function(section("MODEL") + "\nreturn { grpParseFront, GRP_CLS, loadSkeletonBytes };")();

// The app's own table, lifted out of the built page rather than copied — a sweep that measures a
// copy of the rule measures nothing.
const A2D_GROUPS = new Function("return " + /const A2D_GROUPS = (\(\(\) => \{[\s\S]*?\n\}\)\(\));/.exec(src)[1])();

// What a control surface is CALLED, as broadly as is still honest. Deliberately wider than
// A2D_GROUPS: the whole point is to find the names the table misses, so this must not be the table.
// START-ANCHORED, which is what keeps a grain elevator out — `nvrsk_elevator_conveyor_back_destr32`
// is a building, and an unanchored probe put 193 of its parts on the list.
const PROBE = /^(rudder|aileron|elevon|elevator|stabilator|ruddervator|flaperon|flap|slat|spoiler|airbrake|air_brake|speedbrake|canard|taileron)/i;
// ...minus the things that carry a control-surface word without being one. Two families: the
// damage/physics/collision nodes, and — much the larger — the COCKPIT's own control column, levers,
// trim wheels and gauges. `stick_elevator` and `flaps_indicator` are on a thousand models each and
// are not surfaces; the cockpit models they live in are excluded outright below as well.
const NOT = /(_dm$|_dmg|_damage|_phx$|_fx$|xray|_destr|_collision|_cls|traction|_holder|_axis$|_pivot$|_hinge$|_root$|bone_|stick_|_indicator|_lever|_handle|_grip|trimmer|_trim(\d|$)|gauge|^vr_|_position_|_rod\d|_pedal|_switch|_button|_lamp|_light)/i;
// A control surface belongs to a flight model. Cockpits are separate models (ROADMAP 4.14) and
// carry a copy of every control's NAME on a lever or a dial, so including them measures the wrong
// thing twice over.
const NOT_MODEL = /(_cockpit|_dm$|_destr|_collision|_xray|_wreck)/i;
const WANT = ["ailerons", "elevator", "rudder", "flaps", "slats", "airbrake"];
// Which control a candidate node BELONGS to, independently of whether the app claims it. Without
// this the coverage line divides by every airframe, and "slats claimed on 24%" reads as a failure
// when the truth is that three aircraft in four have no slats to claim.
const OWNER = [
  ["airbrake", /^(airbrake|air_brake|speedbrake|flap_airbrake)/i],   // before flaps: flap_airbrake
  ["ailerons", /^(aileron|elevon|taileron)/i],
  ["elevator", /^(elevator|stabilator|ruddervator)/i],
  ["rudder",   /^rudder/i],
  ["flaps",    /^(flap|flaperon)/i],
  ["slats",    /^slat/i],
];
const ownerOf = n => (OWNER.find(o => o[1].test(n)) || [null])[0];

function walk(dir, out = [], depth = 0) {
  if (depth > 7) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) {
      if (/^(win32|win64|linux64|mac|sound|video|movies|easyanticheat|launcher|userskins|\.)/i.test(e.name)) continue;
      walk(p, out, depth + 1);
    } else if (/\.grp$/i.test(e.name)) out.push(p);
  }
  return out;
}
const skelRefs = new Map(), animNames = new Set(), dynNames = new Set();
for (const p of walk(WT)) {
  try {
    const fd = fs.openSync(p, "r");
    const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
    const front = Buffer.alloc(0xC + h.readUInt32LE(8) + 4);
    fs.readSync(fd, front, 0, front.length, 0); fs.closeSync(fd);
    for (const e of MOD.grpParseFront(new Uint8Array(front)).entries) {
      if (e.classId === MOD.GRP_CLS.GeomNodeTree) { if (!skelRefs.has(e.name)) skelRefs.set(e.name, { p, e }); }
      else if (e.classId === MOD.GRP_CLS.Anim2Data) animNames.add(e.name);
      else if (e.classId === MOD.GRP_CLS.DynModel) dynNames.add(e.name);
    }
  } catch { /* not a readable pack */ }
}
console.log(skelRefs.size + " skeletons, " + animNames.size + " baked clips, " + dynNames.size + " models in " + WT + "\n");

// One open file descriptor per pack, and only the skeleton's own byte range off it. Reading the
// whole .grp per skeleton is the obvious way and it is ~1 500 reads of packs up to 2 GB — the first
// cut of this sweep did that and had not finished in ten minutes.
const byPack = new Map();
for (const [sname, ref] of skelRefs) {
  const model = sname.replace(/_skeleton$/, "");
  if (!dynNames.has(model) || NOT_MODEL.test(model)) continue;
  let l = byPack.get(ref.p); if (!l) byPack.set(ref.p, l = []);
  l.push([sname, ref]);
}
const rows = [];
for (const [pack, list] of byPack) {
  let fd; try { fd = fs.openSync(pack, "r"); } catch { continue; }
  try { for (const [sname, ref] of list) sweep(sname, ref, fd); } finally { fs.closeSync(fd); }
}
function sweep(sname, ref, fd){
  const model = sname.replace(/_skeleton$/, "");
  let sk;
  try {
    const buf = Buffer.alloc(ref.e.size);
    fs.readSync(fd, buf, 0, ref.e.size, ref.e.offset);
    sk = MOD.loadSkeletonBytes(new Uint8Array(buf));
  } catch { return; }
  if (!sk || !sk.nodes) return;
  const names = sk.nodes.map(n => n.name).filter(Boolean);
  const cand = names.filter(n => PROBE.test(n) && !NOT.test(n));
  if (!cand.length) return;                                // not an aircraft, or nothing that moves
  const hit = new Map(), miss = [], has = new Set();
  for (const n of cand) {
    const own = ownerOf(n);
    if (own) has.add(own);
    // Trimmed, because the app trims — two models ship a node whose name ends in a space, and an
    // instrument that does not do what the code does reports a failure the code does not have.
    const g = A2D_GROUPS.find(gr => gr[1].test(n.trim()));
    if (g) hit.set(g[0], (hit.get(g[0]) || 0) + 1);
    else miss.push(n);
  }
  // Aircraft or boat, structurally rather than by a name list. A ship has a rudder and nothing
  // else on this list; anything with an aileron, elevon, flap, slat or elevator flies. Without the
  // split the headline is nonsense: `rudder_01..04` is the shape a HULL uses, it is on 599 models,
  // and it swamps every aircraft finding in the histogram.
  const air = cand.some(n => /^(aileron|elevon|flap|slat|elevator|stabilator|taileron|canard|airbrake|air_brake|speedbrake)/i.test(n));
  rows.push({ model, air, anim: animNames.has(model + "_anim"), nodes: names.length,
              cand: cand.length, hit, miss, has });
}
rows.sort((a, b) => b.miss.length - a.miss.length || a.model.localeCompare(b.model));
if (!argv.includes("--boats")) {
  const boats = rows.filter(r => !r.air).length;
  for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].air) rows.splice(i, 1);
  console.log(boats + " models whose only candidate is a rudder are hulls, not airframes — " +
    "pass --boats to include them\n");
}

// ---- 0. one model in full, when asked for by name ----
const only = argv.filter(a => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--csv");
if (only.length) {
  for (const m of only) {
    const r = rows.find(x => x.model === m);
    if (!r) { console.log(m + ": not in the sweep (no skeleton, no model, or no candidate node)"); continue; }
    console.log("=== " + m + " — " + r.cand + " candidate node(s), " + (r.anim ? "baked clip" : "no clip") + " ===");
    for (const [id] of A2D_GROUPS) if (r.hit.has(id)) console.log("   " + id.padEnd(10) + " claims " + r.hit.get(id));
    console.log("   unclaimed: " + (r.miss.join(", ") || "none"));
  }
  process.exit(0);
}

// ---- 1. how many aircraft get each control at all ----
console.log("=== " + rows.length + " models carry something the probe calls a control surface ===");
const withClip = rows.filter(r => r.anim);
console.log("   " + withClip.length + " of them have a baked clip; " + (rows.length - withClip.length) + " do not\n");
for (const w of WANT) {
  const own = rows.filter(r => r.has.has(w));
  const got = own.filter(r => r.hit.has(w)).length;
  console.log("   " + w.padEnd(10) + String(own.length).padStart(5) + " models have one · " +
    String(got).padStart(4) + " the app claims (" + (own.length ? (got / own.length * 100).toFixed(1) : "0") + "%) · " +
    String(own.length - got).padStart(3) + " it does not");
}

// ---- 2. the names nothing claims, by shape ----
const shape = n => n.toLowerCase().replace(/\d+/g, "#");
const hist = new Map();
for (const r of rows) for (const n of r.miss) {
  const k = shape(n);
  const e = hist.get(k) || { n: 0, models: new Set(), eg: n };
  e.n++; e.models.add(r.model); hist.set(k, e);
}
const top = [...hist].sort((a, b) => b[1].models.size - a[1].models.size);
const missTotal = rows.reduce((n, r) => n + r.miss.length, 0);
console.log("\n=== " + missTotal + " control-surface nodes on " + rows.filter(r => r.miss.length).length +
  " models that A2D_GROUPS claims NOTHING for ===");
console.log("   " + hist.size + " distinct name shapes; the 40 on the most models:\n");
for (const [k, e] of top.slice(0, 40))
  console.log("   " + String(e.models.size).padStart(4) + " models  " + k.padEnd(34) + " e.g. " + e.eg + "  (" + [...e.models][0] + ")");

// ---- 3. the models where nothing at all is claimed ----
const none = rows.filter(r => !WANT.some(w => r.hit.has(w)));
console.log("\n=== " + none.length + " models where NOT ONE of the six controls is claimed ===");
for (const r of none.slice(0, 30))
  console.log("   " + r.model.padEnd(24) + " " + (r.anim ? "clip" : "----") + "  " + r.cand +
    " candidate node(s): " + r.miss.slice(0, 6).join(", "));

if (argv.includes("--all")) {
  console.log("\n=== every model ===");
  for (const r of rows)
    console.log("   " + r.model.padEnd(26) + " " + (r.anim ? "clip" : "----") + " " +
      WANT.map(w => (r.hit.has(w) ? w[0].toUpperCase() : "\u00b7")).join("") +
      "  miss " + String(r.miss.length).padStart(2) + "  " + r.miss.slice(0, 8).join(", "));
}
const csv = argv.indexOf("--csv");
if (csv >= 0 && argv[csv + 1]) {
  const out = ["model,clip,candidates,unclaimed," + WANT.join(",") + ",unclaimed_names"];
  for (const r of rows) out.push([r.model, r.anim ? 1 : 0, r.cand, r.miss.length,
    ...WANT.map(w => r.hit.get(w) || 0), '"' + r.miss.join(" ") + '"'].join(","));
  fs.writeFileSync(argv[csv + 1], out.join("\n"));
  console.log("\nwrote " + argv[csv + 1]);
}
