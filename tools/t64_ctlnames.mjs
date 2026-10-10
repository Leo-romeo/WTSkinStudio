// A control surface's node name resolves to its control — ROADMAP 4.42.
//
// WHY THIS EXISTS, and why it is install-free. `A2D_GROUPS` is a table of regexes over skeleton
// node names, and the only oracle for it used to be `tools/t22_pose.mjs`, which needs the game
// install and is therefore outside the gate. So the table could drift and `npm test` would say
// nothing — which is how it came to be wrong on 154 aircraft without anyone noticing.
//
// What was wrong is worth stating, because it is the shape of the bug rather than a typo: the old
// regexes allowed a digit only after the BASE (`aileron1_l`), and War Thunder puts it after the
// SIDE as often as not (`aileron_l1`), or in both places (`flap1_l3`). The consequence is not "the
// aircraft has no rig" — every one of the 1 212 airframes in the install resolved *a* control. It
// is that a surface moved in PART: the A-7E deflected two ailerons and left all fourteen spoiler
// panels behind, the A-4N moved two flap segments of twelve, the F-14 two rudder sections of six.
// That is exactly what "animations are still not 100% working" describes.
//
// The names below are the ones `tools/ctrl_sweep.mjs` measured off the live install — every shape
// that was unclaimed, plus the shapes that already worked so the fix cannot be a regression, plus
// the ones that must STAY unclaimed. They are node names, not game data: the same identifiers
// `A2D_GROUPS` and `CLAUDE.md` already spell out. Run the sweep to re-measure them.
//
// Usage: node tools/t64_ctlnames.mjs
import fs from "fs";
import { makeReport } from "./headless.mjs";
import { fileURLToPath } from "url";

const HTML = fileURLToPath(new URL("../wt_skin_studio.html", import.meta.url)).replace(/\\/g, "/");
const src = fs.readFileSync(HTML, "utf8");
// Either shape: the plain array it was until 4.42, or the IIFE that shares one grammar between the
// five surface groups. Accepting both is deliberate — a test that bails when the DECLARATION moves
// reports "cannot lift" for a change that is really about the names, and the names are the subject.
const m = /const A2D_GROUPS = (\(\(\) => \{[\s\S]*?\n\}\)\(\)|\[[\s\S]*?\n\]);/.exec(src);
if (!m) { console.log("FAIL: A2D_GROUPS is not in the built page in a shape this test can lift"); process.exit(1); }
const A2D_GROUPS = new Function("return " + m[1])();
const R = makeReport();

// The app trims before matching, so the oracle does too — that is the behaviour under test, not a
// convenience of the harness (`flap3_l ` on the Swift F1 really does end in a space).
const groupOf = n => (A2D_GROUPS.find(g => g[1].test(String(n).trim())) || [null])[0];

// name -> the control it must land on, or null for "nothing may claim this".
const CASES = [
  // ---- what already worked, and must go on working ----
  ["aileron_l",                "ailerons"], ["aileron_r",              "ailerons"],
  ["aileron1_l",               "ailerons"], ["elevon_l",               "ailerons"],
  ["aileron_interceptor_l",    "ailerons"], ["aileron_l_traction_1",   "ailerons"],
  ["elevator",                 "elevator"], ["elevator0",              "elevator"],
  ["elevator_l",               "elevator"], ["rudder",                 "rudder"],
  ["rudder0",                  "rudder"],   ["flap_l",                 "flaps"],
  ["flap3_l",                  "flaps"],    ["slat_l",                 "slats"],
  ["airbrake_l",               "airbrake"], ["airbrake_l10",           "airbrake"],
  ["gear_l",                   "gear"],     ["gear_l3",                "gear"],
  ["nozzle1_19",               "nozzles"],  ["wing_l",                 "sweep"],
  ["hook_catch",               "hook"],     ["canopy",                 "canopy"],

  // ---- the shapes 4.42 measured as unclaimed: a digit after the SIDE ----
  ["aileron_l1",               "ailerons"], ["aileron_r1",             "ailerons"],
  ["flap_l1",                  "flaps"],    ["flap_r5",                "flaps"],
  ["flap1_l1",                 "flaps"],    ["flap1_r3",               "flaps"],
  ["slat_l1",                  "slats"],    ["slat1_l2",               "slats"],
  ["aileron_interceptor3_r",   "ailerons"], ["aileron_interceptor4_l", "ailerons"],

  // ---- ...an underscore before the digit ----
  ["rudder_1",                 "rudder"],   ["rudder1_1",              "rudder"],
  ["elevator_1",               "elevator"], ["elevator1_1",            "elevator"],

  // ---- ...a CENTRE surface, and the two names with trailing junk ----
  ["flap_c",                   "flaps"],    ["flap2_c",                "flaps"],
  ["flap_2",                   "flaps"],
  ["rudder1_",                 "rudder"],   ["flap3_l ",               "flaps"],

  // ---- ...and the flying wing, whose yaw control is named for a rudder ----
  ["rudder_interceptor_l",     "rudder"],   ["rudder_interceptor1_r",  "rudder"],

  // ---- what must STAY unclaimed: linkage, limiters and damage models ----
  // The rods on a Po-2 and the F-14's sweep limiters are not surfaces. They are the 36 nodes the
  // sweep still reports, and reporting them is right — a grammar loose enough to swallow these
  // would also swallow half the airframe.
  ["aileron_l_rod",            null],       ["elevator_rod",           null],
  ["rudder_rod",               null],       ["flap_sweep_lim_l",       null],
  ["flap1_sweep_lim_r",        null],
  // Not a control surface at all, however much it reads like one.
  ["flaps_indicator",          null],       ["stick_elevator",         null],
  ["trimmer_rudder",           null],       ["airbrake_lever",         null],
  ["nvrsk_elevator_conveyor_back_destr32", null],
];

console.log("=== every measured control-surface name lands on its control ===");
const wrong = [];
for (const [name, want] of CASES) {
  const got = groupOf(name);
  if (got !== want) wrong.push({ name, want, got });
}
const byGroup = new Map();
for (const [name, want] of CASES) { if (!want) continue; byGroup.set(want, (byGroup.get(want) || 0) + 1); }
console.log("   " + CASES.length + " names · " + [...byGroup].map(([g, n]) => g + " " + n).join(" · ") +
  " · unclaimed " + CASES.filter(c => !c[1]).length);
for (const w of wrong) console.log("     " + w.name.padEnd(28) + " wanted " + (w.want || "nothing") + ", got " + (w.got || "nothing"));
R.is(wrong.length === 0, wrong.length
  ? wrong.length + " name(s) resolve to the wrong control — the digit-after-the-side shapes are the ones 4.42 fixed"
  : "all " + CASES.length + " resolve exactly as measured: the digit may follow the base, the side, or both, the side may be centre, and a trailing space or underscore does not lose the surface");

// The three properties that hold the fix in place rather than the cases that showed it.
console.log("\n=== the grammar's edges ===");
R.is(groupOf("flap_airbrake") === "airbrake",
  "`flap_airbrake` is an airbrake, not a flap — flaps is scanned FIRST, so a grammar that swallowed it would silently move the airbrake onto the flap slider");
R.is(groupOf("aileron") === "ailerons" && groupOf("flap") === "flaps",
  "a bare base with no side and no digit still resolves — the single-surface aircraft");
R.is(groupOf("aileron_lever") === null && groupOf("flap_holder") === null && groupOf("rudderpost") === null,
  "and a name that merely STARTS with the base is not a surface — the suffix grammar is anchored at both ends");

// Order is load-bearing: `claimed` in buildA2DRig gives a node to the first group that matches, so
// two groups matching one name is a silent behaviour change, not a duplicate.
console.log("\n=== no name is claimed by two groups ===");
const dbl = [];
for (const [name] of CASES) {
  const hits = A2D_GROUPS.filter(g => g[1].test(String(name).trim())).map(g => g[0]);
  if (hits.length > 1) dbl.push(name + " -> " + hits.join(", "));
}
for (const d of dbl) console.log("     " + d);
R.is(dbl.length === 0, dbl.length
  ? dbl.length + " name(s) match more than one group — buildA2DRig gives the node to whichever comes first, so this is a silent change of which slider moves it"
  : "each name matches exactly one group, so the table's ORDER is not quietly deciding behaviour");
R.finish();
