// The vehicle's second body: the first-person cockpit (ROADMAP 4.14).
//
// WHY THIS EXISTS. The cockpit is a second DynModel of the SAME vehicle, and the item's one hard
// requirement is that it never becomes a second vehicle: one .blk, one set of slots, and the
// exterior's own layers, selection and hidden parts untouched by a switch. So this test builds two
// small bodies in the real page — an exterior (fuse, wing, an unnamed material) and a cockpit (pit,
// the SAME wing sheet, its own unnamed material) — and holds:
//   * the switch: the scene is rebuilt from the cockpit's geometry, the exterior's selection and
//     hidden parts are stashed and come back untouched, and the wing is the same slot on both;
//   * the collision: `unknown_0` on each body is two keys in App.matSlot, not one — the same fix
//     as two bombs sharing a material name (4.30);
//   * the seat: headPos in the game's frame becomes app space with z negated, looking down the
//     nose (+x), and without the game folder the seat says why it cannot be found;
//   * stores refuse to hang on the cockpit body, in words;
//   * the project: saved on the cockpit body it carries both OBJs, each body's parts layout and
//     which one was on screen, and loads back onto the cockpit with the cockpit's layer intact.
//
// Usage: node tools/t71_cockpit.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var status = function(){ return document.getElementById("status").textContent; };
  // ---- a flat 8x8 uncompressed 32-bit TGA, top-left origin ----
  var tga = function(r, g, b){
    var W = 8, H = 8, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W; u[14] = H; u[16] = 32; u[17] = 0x20;
    for (var i = 0; i < W * H; i++) { var p = 18 + i * 4; u[p] = b; u[p+1] = g; u[p+2] = r; u[p+3] = 255; }
    return u;
  };
  var decodedFrom = function(bytes, name){
    var d = TGA.parseTGA(bytes.buffer.slice(0));
    d.raw = bytes.buffer.slice(0); d.rawName = name; d.fileName = name;
    return d;
  };
  // ---- a tiny OBJ: one quad per group, each with its own material ----
  var obj = function(groups){
    var s = "mtllib x.mtl" + String.fromCharCode(10), vi = 0;
    groups.forEach(function(g, k){
      var o = k * 10, b = vi, L = String.fromCharCode(10);
      s += "o " + g.name + L + "usemtl " + g.mat + L;
      s += "v " + o + " 0 0" + L + "v " + (o + 1) + " 0 0" + L + "v " + o + " 1 0" + L + "v " + (o + 1) + " 1 0" + L;
      s += "vt 0 0" + L + "vt 1 0" + L + "vt 0 1" + L + "vt 1 1" + L;
      s += "f " + (b+1) + "/" + (b+1) + " " + (b+2) + "/" + (b+2) + " " + (b+3) + "/" + (b+3) + L;
      s += "f " + (b+2) + "/" + (b+2) + " " + (b+4) + "/" + (b+4) + " " + (b+3) + "/" + (b+3) + L;
      vi += 4;
    });
    return s;
  };
  var names = function(){ return [...App.meshes.keys()].sort().join(","); };

  clearVehicleState();
  App.decoded = new Map();
  App.decoded.set("t71_fuse_c", decodedFrom(tga(200, 60, 60), "t71_fuse_c.tga"));
  App.decoded.set("t71_pit_c",  decodedFrom(tga(60, 60, 200), "t71_pit_c.tga"));
  App.decoded.set("t71_wing_c", decodedFrom(tga(60, 200, 60), "t71_wing_c.tga"));
  // the exterior: fuse + wing on their own sheets, plus an UNNAMED material
  var extText = obj([{ name: "fuse", mat: "t71_fuse" }, { name: "wing_l", mat: "t71_wing" }, { name: "seat", mat: "unknown_0" }]);
  App.geomData = buildGeometryData(parseOBJ(extText));
  App.objRaw = { name: "t71_0.obj", text: extText }; App.objName = "t71";
  rebuildAll();
  out.before = { has: Cockpit.has(), disabled: $("bodySel").disabled, meshes: names(), current: Cockpit.current() };
  // the cockpit body: the pit on its own sheet, the SAME wing sheet, and an unknown_0 of its own
  var ckText = obj([{ name: "pit", mat: "t71_pit" }, { name: "wing_l", mat: "t71_wing" }, { name: "stick", mat: "unknown_0" }]);
  Cockpit.install({ geomData: buildGeometryData(parseOBJ(ckText)), objRaw: { name: "t71_cockpit_0.obj", text: ckText }, objName: "t71_cockpit" });
  out.installed = { has: Cockpit.has(), disabled: $("bodySel").disabled, current: Cockpit.current(),
                    mats: App.bodies.cockpit.geomData.map(function(g){ return g.mat; }).sort().join(",") };

  // ---- exterior-side state that must survive a switch ----
  App.hiddenParts.add("fuse"); App.selParts.add("wing_l");
  var extGeom = App.geomData;
  var ok1 = await Cockpit.show("cockpit");
  out.cockpit = { ok: ok1, current: Cockpit.current(), sel: $("bodySel").value, meshes: names(),
    hidden: [...App.hiddenParts].join(","), selected: [...App.selParts].join(","), swapped: App.geomData !== extGeom,
    pit: App.matSlot.get("t71_cockpit::t71_pit"), wing: App.matSlot.get("t71_cockpit::t71_wing"), extWing: App.matSlot.get("t71_wing"),
    unk: App.matSlot.get("t71_cockpit::unknown_0"), extUnk: App.matSlot.get("unknown_0"),
    slots: [...App.slots.keys()].sort().join(",") };
  // paint the cockpit's sheet and select one of its parts, so the file below has cockpit state to carry
  var pit = App.slots.get("t71_pit");
  pit.layers.push(LayerNode.of({ type: "fill", name: "pit paint", color: "#ff00ff", visible: true, opacity: 1, blend: "normal" }));
  App.selParts.add("stick");
  var ok2 = await Cockpit.show("exterior");
  out.exterior = { ok: ok2, current: Cockpit.current(), sel: $("bodySel").value, meshes: names(),
    hidden: [...App.hiddenParts].join(","), selected: [...App.selParts].join(","), back: App.geomData === extGeom,
    pitSlotKept: App.slots.has("t71_pit") && App.slots.get("t71_pit").layers.length === 1 };

  // ---- the seat ----
  out.seat = { from: Cockpit.seatFrom([5.4, .434, .7]), heads: await Cockpit.heads(), why: Cockpit.why };
  cam.yaw = 0; cam.pitch = 0; var d = flyDir(); out.dir = [d.x, d.y, d.z];
  document.getElementById("status").textContent = "";
  var seated = await Cockpit.seat();
  out.seatSaid = { ret: seated, said: status() };

  // ---- stores on the cockpit body ----
  await Cockpit.show("cockpit");
  document.getElementById("status").textContent = "";
  await loadWeaponLoadout(null, { name: "t71" });
  out.storesSaid = status();

  // ---- the project, saved on the cockpit body ----
  var blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  var z = await JSZip.loadAsync(blob), m = JSON.parse(await z.file("project.json").async("string"));
  out.saved = { version: m.version, body: m.body, objs: Object.keys(z.files).filter(function(f){ return /obj$/.test(f); }).sort().join(","),
    extSel: m.parts && m.parts.selected ? m.parts.selected.join(",") : null,
    ckSel: m.cockpit && m.cockpit.parts && m.cockpit.parts.selected ? m.cockpit.parts.selected.join(",") : null,
    slots: m.slots.map(function(s){ return s.id; }).join(",") };
  clearVehicleState();
  await loadProject(blob);
  out.loaded = { current: Cockpit.current(), sel: $("bodySel").value, meshes: names(), selected: [...App.selParts].join(","),
    pitLayers: App.slots.get("t71_pit") ? App.slots.get("t71_pit").layers.map(function(l){ return l.name + ":" + l.color; }).join(",") : null,
    hasExt: !!App.bodies.exterior, said: status() };
  await Cockpit.show("exterior");
  out.loadedExt = { current: Cockpit.current(), meshes: names(), selected: [...App.selParts].join(",") };
  clearVehicleState();
  out.cleared = { current: Cockpit.current(), has: Cockpit.has(), disabled: $("bodySel").disabled };
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

R.is(!r.before.has && r.before.disabled && r.before.current === "exterior" && r.before.meshes === "fuse,seat,wing_l",
  `a vehicle with no cockpit body: the select is disabled, the exterior is on screen (${r.before.meshes})`);
R.is(r.installed.has && !r.installed.disabled && r.installed.current === "exterior" && r.installed.mats === "t71_cockpit::t71_pit,t71_cockpit::t71_wing,t71_cockpit::unknown_0",
  `installing the cockpit body enables the select and qualifies its materials with the model: ${r.installed.mats}`);
R.is(r.cockpit.ok && r.cockpit.current === "cockpit" && r.cockpit.sel === "cockpit" && r.cockpit.swapped && r.cockpit.meshes === "pit,stick,wing_l",
  `switching to the cockpit rebuilds the scene from its geometry (${r.cockpit.meshes}) and the select follows`);
R.is(r.cockpit.hidden === "" && r.cockpit.selected === "",
  "the cockpit body starts with nothing hidden and nothing selected — the exterior's fuse and wing_l are stashed, not carried");
R.is(r.cockpit.wing === "t71_wing" && r.cockpit.extWing === "t71_wing",
  `the wing is the SAME slot on both bodies (${r.cockpit.wing}) — a stroke from the seat lands on the exterior's sheet`);
R.is(r.cockpit.pit === "t71_pit", `the cockpit's own sheet is its own slot (${r.cockpit.pit})`);
R.is(r.cockpit.unk && r.cockpit.extUnk && r.cockpit.unk !== r.cockpit.extUnk,
  `an unnamed material on each body is two keys, not one: ${r.cockpit.extUnk} vs ${r.cockpit.unk}`);
R.is(r.exterior.ok && r.exterior.current === "exterior" && r.exterior.sel === "exterior" && r.exterior.back && r.exterior.meshes === "fuse,seat,wing_l",
  `switching back puts the exterior's own geometry object back (${r.exterior.meshes})`);
R.is(r.exterior.hidden === "fuse" && r.exterior.selected === "wing_l",
  `…with its hidden parts (${r.exterior.hidden}) and selection (${r.exterior.selected}) exactly as left`);
R.is(r.exterior.pitSlotKept, "the cockpit's slot and its layer stay in the project while the exterior is on screen");
R.is(r.seat.from.pos.join() === "5.4,0.434,-0.7" && r.seat.from.yaw === 0 && r.seat.from.pitch === 0,
  `headPos (5.4, 0.434, 0.7) in the game's frame is (${r.seat.from.pos.join(", ")}) in app space — z negated — looking down the nose`);
R.is(Math.abs(r.dir[0] - 1) < 1e-9 && Math.abs(r.dir[1]) < 1e-9 && Math.abs(r.dir[2]) < 1e-9,
  `yaw 0, pitch 0 is +x for the fly camera, which is where the nose is (${r.dir.map(x => +x.toFixed(3)).join(", ")})`);
R.is(r.seat.heads === null && /game files|game folder/.test(r.seat.why) && r.seatSaid.ret === null && r.seatSaid.said === r.seat.why,
  `without the game folder the seat says why: “${r.seat.why}”`);
R.is(/exterior body/.test(r.storesSaid) && /Exterior/.test(r.storesSaid), `stores refuse the cockpit body in words: “${r.storesSaid}”`);
R.is(r.saved.version === 5 && r.saved.body === "cockpit" && r.saved.objs === "assets/t71_0.obj,assets/t71_cockpit_0.obj",
  `the project carries both bodies' models and which one was on screen (format ${r.saved.version}, unchanged): ${r.saved.objs}`);
R.is(r.saved.extSel === "wing_l" && r.saved.ckSel === "stick",
  `…and each body's own parts layout: exterior selected [${r.saved.extSel}], cockpit selected [${r.saved.ckSel}]`);
R.is(r.saved.slots === "t71_pit", `…and the cockpit sheet's layer among the slots (${r.saved.slots})`);
R.is(r.loaded.current === "cockpit" && r.loaded.sel === "cockpit" && r.loaded.meshes === "pit,stick,wing_l" && r.loaded.hasExt,
  `loading it back lands on the cockpit body (${r.loaded.meshes}) with the exterior stashed behind it`);
R.is(r.loaded.pitLayers === "pit paint:#ff00ff" && /restored/.test(r.loaded.said),
  `…the cockpit sheet's layer restored (${r.loaded.pitLayers}) — “${r.loaded.said}”`);
R.is(r.loaded.selected === "stick" && r.loadedExt.selected === "wing_l" && r.loadedExt.meshes === "fuse,seat,wing_l",
  `…and each body's selection is its own again: cockpit [${r.loaded.selected}], exterior [${r.loadedExt.selected}]`);
R.is(r.cleared.current === "exterior" && !r.cleared.has && r.cleared.disabled, "clearing the vehicle forgets both bodies and disables the select");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
