// A hardpoint picked is a hardpoint hung — and only that one (2026-09-21).
//
// WHY THIS EXISTS. The Weapons tab used to hold a build behind an Apply button, and Apply cleared
// every store and re-hung the whole loadout, rebuilding the scene once per store model on top.
// The owner's report of 2026-09-20, with the game's own loadout screen beside it: the button
// should not exist, and a change should not take longer than the game's does. So the panel now
// applies as it goes, and the loader diffs against what is on the aircraft. This test holds the
// two halves of that without a single model from the packs:
//   * the DIFF — `ArmBuild.stationDiff` — says exactly which stations change, so a click on one
//     pylon costs one pylon; and `LoadoutHang.takeDown` / `settle` keep the stores of every other
//     station, their geometry, their instance numbers and their material binds, and drop only the
//     one that changed (the hang step itself, which reads the packs, is stood in for);
//   * the PANEL — no Apply button anywhere; picking a menu line calls the loader with the new
//     assignment; the menu is grouped under the game's own trigger headings with Ammo and Mass on
//     every line and Empty last; a station numbered by tier alone is a chip in the row; two picks
//     in a row queue, they do not overlap.
//   * the TALLY — `PresetInfo.tally` sums a store chain the way the loadout card does: the payload's
//     `rocket{}`/`bomb{}` mass times the count, plus a rack's own root mass.
//
// Usage: node tools/t73_loadout.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  // ---- a unit, the shape readArmament builds one: three hardpoints (one by tier alone) + a gun ----
  var pay = function(path, kind, mesh, mass){ return { path: path, kind: kind, mesh: [mesh], nodes: [], mass: mass, child: null }; };
  var rack = function(path, mesh, n, child, mass){ return { path: path, kind: "rack", mesh: [mesh], nodes: Array.from({ length: n }, function(_, i){ return "n" + i; }), mass: mass == null ? null : mass, child: child }; };
  var W = function(blk, node, trig, store){ return { blk: blk, node: node, trigger: trig, store: store, bullets: null, external: true }; };
  var P = function(slot, name, icon, weapons){ return { slot: slot, name: name, icon: icon, req: "", showNodes: ["py_" + slot], weapons: weapons }; };
  var mk82 = pay("bombs/mk_82.blk", "bomb", "mk_82", 227), aim9 = pay("rockets/aim9l.blk", "rocket", "aim9l", 85.3);
  var tank = pay("tanks/big.blk", "gun", "big_tank", null), gun = { path: "guns/m61.blk", kind: "gun", mesh: [], nodes: [], mass: 112, child: null };
  var slots = [
    { index: 0, tier: 1, order: 1, presets: [
      P(0, "2 x mk_82", "bombs_middle_group_x2", [W("bombs/mk_82.blk", "pylon_l", "bombs", rack("containers/ter.blk", "ter", 2, mk82, 30))]),
      P(0, "aim9l", "missile", [W("rockets/aim9l.blk", "pylon_l", "aam", aim9)]) ] },
    { index: 2, tier: 1, order: 2, presets: [
      P(2, "2 x mk_82", "bombs_middle_group_x2", [W("bombs/mk_82.blk", "pylon_r", "bombs", rack("containers/ter.blk", "ter", 2, mk82, 30))]),
      P(2, "aim9l", "missile", [W("rockets/aim9l.blk", "pylon_r", "aam", aim9)]) ] },
    { index: 3, tier: 2, order: null, presets: [                       // numbered by TIER alone
      P(3, "tank", "ptb", [W("tanks/big.blk", "pylon_c", "fuel tanks", tank)]) ] },
    { index: 1, tier: null, order: null, presets: [
      P(1, "internal gun", "", [W("guns/m61.blk", "", "cannon", gun)]) ] },
  ];
  var arm = { unit: "t73_unit", path: "gamedata/flightmodels/t73_unit.blk", slots: slots, byName: new Map(),
    loadouts: [{ name: "t73_default", blk: "a.blk", assign: [{ slot: 0, preset: "2 x mk_82" }, { slot: 2, preset: "2 x mk_82" }] }],
    hideNodes: ["py_0", "py_2", "py_3", "py_x"], model: "t73", maxload: 1000 };
  slots.forEach(function(s){ s.presets.forEach(function(p){ arm.byName.set(s.index + "/" + p.name, p); }); });

  // ---- the tally, as the loadout card prints it ----
  var t = PresetInfo.tally(arm.byName.get("0/2 x mk_82"));
  out.tally = { count: t[0].count, kg: +t[0].kg.toFixed(1), known: t[0].known, label: PresetInfo.label(arm.byName.get("0/2 x mk_82")),
    tankLabel: PresetInfo.label(arm.byName.get("3/tank")), group: PresetInfo.group(arm.byName.get("0/aim9l")).label,
    groups: slots[0].presets.map(function(p){ return PresetInfo.group(p).rank; }) };

  // ---- the diff on its own ----
  var d = ArmBuild.stationDiff([{ slot: 0, preset: "2 x mk_82" }, { slot: 2, preset: "2 x mk_82" }],
                               [{ slot: 0, preset: "aim9l" }, { slot: 2, preset: "2 x mk_82" }, { slot: 3, preset: "tank" }]);
  out.diff = { drop: [...d.drop], add: [...d.add], keep: [...d.keep] };

  // ---- takeDown / settle over a synthetic aircraft: the hang step is stood in for ----
  var geom = function(name, weapon, tag, station){ return { name: name, mat: "m", position: new Float32Array(9), normal: new Float32Array(9), uv: new Float32Array(6), weapon: weapon, weaponTag: tag, station: station }; };
  var keepGeom = App.geomData, keepLoaded = new Map(App.weaponsLoaded), keepLO = App.weaponLoadout, keepBinds = new Map(App.extraBinds);
  var keepShow = App.weaponShowNodes, keepHide = App.weaponHideNodes;
  try {
    App.geomData = [ geom("fuse", null, null, null),
      geom("ter #1 · body", "ter", "ter #1", 0), geom("mk_82 #1 · body", "mk_82", "mk_82 #1", 0), geom("mk_82 #2 · body", "mk_82", "mk_82 #2", 0),
      geom("ter #2 · body", "ter", "ter #2", 2), geom("mk_82 #3 · body", "mk_82", "mk_82 #3", 2), geom("mk_82 #4 · body", "mk_82", "mk_82 #4", 2) ];
    App.weaponsLoaded = new Map([
      ["ter #1", { model: "ter", tag: "ter #1", kind: "rack", path: "containers/ter.blk", parts: ["ter #1 · body"], placed: true, station: 0 }],
      ["mk_82 #1", { model: "mk_82", tag: "mk_82 #1", kind: "bomb", path: "bombs/mk_82.blk", parts: ["mk_82 #1 · body"], placed: true, station: 0 }],
      ["mk_82 #2", { model: "mk_82", tag: "mk_82 #2", kind: "bomb", path: "bombs/mk_82.blk", parts: ["mk_82 #2 · body"], placed: true, station: 0 }],
      ["ter #2", { model: "ter", tag: "ter #2", kind: "rack", path: "containers/ter.blk", parts: ["ter #2 · body"], placed: true, station: 2 }],
      ["mk_82 #3", { model: "mk_82", tag: "mk_82 #3", kind: "bomb", path: "bombs/mk_82.blk", parts: ["mk_82 #3 · body"], placed: true, station: 2 }],
      ["mk_82 #4", { model: "mk_82", tag: "mk_82 #4", kind: "bomb", path: "bombs/mk_82.blk", parts: ["mk_82 #4 · body"], placed: true, station: 2 }] ]);
    App.extraBinds = new Map([["ter", { map: new Map() }], ["mk_82", { map: new Map() }]]);
    App.weaponLoadout = { arm: "t73_unit", name: "t73_default", stations: [
      { slot: 0, tier: 1, node: "pylon_l", preset: "2 x mk_82", store: "mk_82" }, { slot: 2, tier: 1, node: "pylon_r", preset: "2 x mk_82", store: "mk_82" } ] };
    var lo = { name: "custom", blk: "", assign: [{ slot: 0, preset: "aim9l" }, { slot: 2, preset: "2 x mk_82" }, { slot: 3, preset: "tank" }], custom: true };
    var cx = { arm: arm, lo: lo };
    out.changed = !!LoadoutHang.diff(cx);
    out.hangSlots = cx.hang.map(function(s){ return s.slot; });
    LoadoutHang.takeDown(cx);
    out.afterTakeDown = { geom: App.geomData.map(function(g){ return g.name; }).join(","), loaded: [...App.weaponsLoaded.keys()].join(","),
      seq: cx.ctx.seq };
    // what the hang step would have added for stations 0 and 3, with the instance numbers it takes from ctx.seq
    cx.ctx.station = 0;
    var n1 = "aim9l #" + (cx.ctx.seq.aim9l = (cx.ctx.seq.aim9l || 0) + 1);
    cx.ctx.added.push(geom(n1 + " · body", "aim9l", n1, 0));
    cx.ctx.placed.push({ model: "aim9l", tag: n1, kind: "rocket", path: "rockets/aim9l.blk", parts: [n1 + " · body"], placed: true, station: 0 });
    cx.ctx.station = 3;
    var n2 = "big_tank #" + (cx.ctx.seq.big_tank = (cx.ctx.seq.big_tank || 0) + 1);
    cx.ctx.added.push(geom(n2 + " · body", "big_tank", n2, 3));
    cx.ctx.placed.push({ model: "big_tank", tag: n2, kind: "gun", path: "tanks/big.blk", parts: [n2 + " · body"], placed: true, station: 3 });
    App.extraBinds.set("aim9l", { map: new Map() }); App.extraBinds.set("big_tank", { map: new Map() });
    LoadoutHang.settle(cx);
    out.settled = { geom: App.geomData.map(function(g){ return g.name; }).join(","), loaded: [...App.weaponsLoaded.keys()].join(","),
      stations: App.weaponLoadout.stations.map(function(s){ return s.slot + ":" + s.preset; }).join(","), name: App.weaponLoadout.name,
      show: [...App.weaponShowNodes].sort().join(","), hide: [...App.weaponHideNodes].sort().join(","), binds: [...App.extraBinds.keys()].sort().join(",") };
    // the same build again: nothing to do
    var cx2 = { arm: arm, lo: lo };
    out.same = !!LoadoutHang.diff(cx2);
    // another unit's loadout on the aircraft: everything comes down
    App.weaponLoadout.arm = "other_unit";
    var cx3 = { arm: arm, lo: lo };
    LoadoutHang.diff(cx3); LoadoutHang.takeDown(cx3);
    out.otherUnit = { dropAll: cx3.dropAll, geom: App.geomData.map(function(g){ return g.name; }).join(","), loaded: App.weaponsLoaded.size };
  } finally {
    App.geomData = keepGeom; App.weaponsLoaded = keepLoaded; App.weaponLoadout = keepLO; App.extraBinds = keepBinds;
    App.weaponShowNodes = keepShow; App.weaponHideNodes = keepHide;
  }

  // ---- the panel: no Apply, a pick calls the loader, the menu is the game's ----
  var keepAfc = armamentForCurrentUnit, keepLWL = loadWeaponLoadout, keepUnload = unloadWeapons, keepGd = App.gameDir, keepEx = App.extracted;
  var calls = [];
  try {
    armamentForCurrentUnit = function(){ return { unit: "t73_unit", arm: arm }; };
    loadWeaponLoadout = async function(a, lo){ calls.push({ name: lo.name, assign: lo.assign.map(function(x){ return x.slot + ":" + x.preset; }).join(",") }); await new Promise(function(r){ setTimeout(r, 30); }); };
    unloadWeapons = function(){ calls.push({ name: "(unload)" }); };
    App.gameDir = { name: "fake-t73" };
    var wtm = function(tz){ return [[1,0,0,0],[0,1,0,0],[0,0,1,tz],[0,0,0,1]]; };
    App.extracted = { geo: { skeleton: new Map([["pylon_l", wtm(2)], ["pylon_r", wtm(-2)], ["pylon_c", wtm(0)]]) } };
    ArmBuild.unit = null; ArmBuild.saved = []; ArmBuild.naming = false; ArmBuild.nameDraft = "";
    ArmBuild.ensure("t73_unit"); ArmBuild.clear(); ArmBuild.open.clear();
    WeaponsPanel.want = null; WeaponsPanel.busy = null;
    refreshWeaponPanel();
    var el = document.getElementById("weaponList");
    out.panel = { buttons: [].map.call(el.querySelectorAll("button"), function(b){ return b.textContent; }).join("|"),
      chips: el.querySelectorAll(".hp").length, mass: (el.querySelector(".hpmass") || {}).textContent || "" };
    // open the left-wing chip (rightmost: port is −z) and read its menu
    var chips = el.querySelectorAll(".hp");
    chips[chips.length - 1].click();
    el = document.getElementById("weaponList");
    out.menu = { groups: [].map.call(el.querySelectorAll(".hpgrp"), function(g){ return g.textContent; }).join("|"),
      items: [].map.call(el.querySelectorAll(".hpitem .t"), function(i){ return i.textContent; }).join("|"),
      chosen: [].map.call(el.querySelectorAll(".hpitem.on .t"), function(i){ return i.textContent; }).join("|") };
    // pick the Sidewinder: the loader is called with that one station filled
    var items = el.querySelectorAll(".hpitem");
    items[1].click();
    await new Promise(function(r){ setTimeout(r, 5); });
    out.pick = { calls: calls.slice(), chosen: [].map.call(document.querySelectorAll("#weaponList .hpitem.on .t"), function(i){ return i.textContent; }).join("|"),
      mass: (document.querySelector("#weaponList .hpmass") || {}).textContent || "" };
    // two more picks while the first load is still in flight: they queue into ONE call with the latest build
    var chips2 = document.querySelectorAll("#weaponList .hp");
    chips2[0].click();                                                         // right wing chip
    document.querySelectorAll("#weaponList .hpitem")[0].click();               // its bombs
    chips2 = document.querySelectorAll("#weaponList .hp");
    chips2[1].click();                                                         // the tier-only centreline chip
    document.querySelectorAll("#weaponList .hpitem")[0].click();               // its tank
    await new Promise(function(r){ setTimeout(r, 120); });
    out.queued = { calls: calls.slice(), busy: !!WeaponsPanel.busy, want: !!WeaponsPanel.want };
    // Empty on every station: the loader is not called, the stores are unloaded
    App.weaponsLoaded.set("t73 #1", { parts: [] });                  // something IS on the aircraft
    ArmBuild.clear(); WeaponsPanel.hang(arm, "t73_unit");
    await new Promise(function(r){ setTimeout(r, 10); });
    App.weaponsLoaded.delete("t73 #1");
    out.emptied = calls.slice(-1)[0];
  } finally {
    armamentForCurrentUnit = keepAfc; loadWeaponLoadout = keepLWL; unloadWeapons = keepUnload; App.gameDir = keepGd; App.extracted = keepEx;
    ArmBuild.unit = null; ArmBuild.saved = []; ArmBuild.open.clear(); ArmBuild.sel.clear(); WeaponsPanel.want = null; WeaponsPanel.busy = null;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("=== the tally, as the loadout card prints it ===");
R.is(r.tally.count === 2 && r.tally.kg === 484 && r.tally.known,
  `a TER with two 227 kg bombs is Ammo 2, Mass 484 kg — 2 × 227 for the payload plus the rack's own 30 (${r.tally.count}, ${r.tally.kg})`);
R.is(r.tally.label === "mk_82 (Ammo: 2, Mass: 484 kg)", `printed the game's way: "${r.tally.label}"`);
R.is(r.tally.tankLabel === "big (Ammo: 1)", `a store with no mass prints no mass rather than 0: "${r.tally.tankLabel}"`);
R.is(r.tally.group === "Air to Air Missiles" && r.tally.groups[0] < r.tally.groups[1],
  `the heading is the weapon's trigger — "${r.tally.group}" — and Bombs rank before it, as on the game's screen`);

console.log("\n=== the diff ===");
R.is(r.diff.drop.join() === "0" && r.diff.add.join() === "0,3" && r.diff.keep.join() === "2",
  `changing station 0 and filling station 3 drops [${r.diff.drop}], adds [${r.diff.add}] and keeps [${r.diff.keep}] — one pylon costs one pylon`);

console.log("\n=== take down and settle, station by station ===");
const A = r.afterTakeDown, S = r.settled;
R.is(r.changed && r.hangSlots.join() === "0,3", `the loader sees a change and hangs stations ${r.hangSlots.join(",")}`);
R.is(A.geom === "fuse,ter #2 · body,mk_82 #3 · body,mk_82 #4 · body" && A.loaded === "ter #2,mk_82 #3,mk_82 #4",
  `station 0's rack and bombs come down; station 2's stay with the airframe (${A.loaded})`);
R.is(A.seq.ter === 2 && A.seq.mk_82 === 4,
  `instance numbers continue from what stays (ter #${A.seq.ter}, mk_82 #${A.seq.mk_82}) — a new rack cannot be "ter #1" while "ter #2" is on the wing`);
R.is(S.geom === "fuse,ter #2 · body,mk_82 #3 · body,mk_82 #4 · body,aim9l #1 · body,big_tank #1 · body",
  `settled, the geometry is the kept station plus the two hung ones (${S.geom.split(",").length} parts)`);
R.is(S.stations === "2:2 x mk_82,0:aim9l,3:tank" && S.name === "custom",
  `and the loadout record says what hangs where now: ${S.stations}`);
R.is(S.show === "py_0,py_2,py_3" && S.hide === "py_x",
  `the airframe's own pylons follow the WHOLE build, kept stations included (show ${S.show}; hide ${S.hide})`);
R.is(S.binds === "aim9l,big_tank,mk_82,ter", `material binds: the new models' added, nothing live dropped (${S.binds})`);
R.is(r.same === false, "the same build again is no change at all — nothing comes down, nothing is hung, no rebuild");
R.is(r.otherUnit.dropAll && r.otherUnit.geom === "fuse" && r.otherUnit.loaded === 0,
  "another unit's loadout on the aircraft cannot be kept by station: everything comes down");

console.log("\n=== the panel ===");
const Pn = r.panel;
R.is(!/Apply/i.test(Pn.buttons), `no Apply button anywhere (buttons: ${Pn.buttons})`);
R.is(Pn.chips === 3, `three chips in the row — the tier-only centreline station among them (${Pn.chips})`);
R.is(/^Mass: 0 \/ 1[\s ]000 kg/.test(Pn.mass), `the mass line above the row, as the game prints it: "${Pn.mass}"`);
R.is(r.menu.groups === "- Bombs|- Air to Air Missiles",
  `the open chip's choices are grouped under the game's headings, in its order: ${r.menu.groups}`);
R.is(r.menu.items === "mk_82 (Ammo: 2, Mass: 484 kg)|aim9l (Ammo: 1, Mass: 85.3 kg)|Empty" && r.menu.chosen === "Empty",
  `each line the store with its Ammo and Mass, Empty last and lit while the station is empty: ${r.menu.items}`);
R.is(r.pick.calls.length === 1 && r.pick.calls[0].assign === "0:aim9l" && /custom/.test(r.pick.calls[0].name),
  `picking a line calls the loader at once with that station filled (${JSON.stringify(r.pick.calls[0])}) — no Apply step`);
R.is(r.pick.chosen === "aim9l (Ammo: 1, Mass: 85.3 kg)" && /^Mass: 85 \/ /.test(r.pick.mass),
  `the line is lit and the mass line follows (${r.pick.mass})`);
R.is(r.queued.calls.length === 2 && r.queued.calls[1].assign === "0:aim9l,2:2 x mk_82,3:tank" && !r.queued.busy && !r.queued.want,
  `two picks while a load is in flight become ONE queued call with the latest build (${r.queued.calls.length} calls; last: ${r.queued.calls[1] && r.queued.calls[1].assign})`);
R.is(r.emptied && r.emptied.name === "(unload)", `emptying every station unloads instead of hanging nothing (${r.emptied && r.emptied.name})`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
