// What loading a skin actually PUTS WHERE (ROADMAP 2.4's oracle for applySkinEntries).
//
// WHY THIS EXISTS. `applySkinEntries` is 131 lines and the worst left on 2.4's list, and nothing in
// the suite had ever driven it. `t25_skinroundtrip` is a report-only tool a human runs against two
// folders; `t49` reads the `.blk` a family gets on the way OUT. Nothing looked at the way in — and
// the way in is where the decisions are: which vehicle a skin is for, whether the `.blk` or the file
// name decides what a texture replaces, which files are camouflage pins rather than slot textures,
// and what has to be put back to stock before the new skin lands. Every one of those is a branch
// that a rename-only refactor would keep and a wrong one would silently change.
//
// **The probe is colour, not a count.** Each stock sheet and each incoming file is a different flat
// colour, so "it applied the wrong file to the wrong slot" reads as a wrong colour rather than as a
// number that happens to match. The stock sheets are hand-built TGAs so `resetSkinTextures` has real
// bytes to re-decode, which is the only way the "second skin does not inherit the first" assertion
// can mean anything.
//
// The cases are the branches, one each:
//
//   blk          the `.blk` mapping beats the file's own name — the file is called turret_c and the
//                mapping says hull_c, so the two answers land in different places
//   fallback     a texture with no mapping falls back to its own stem, and one with no slot at all
//                is kept for the rebuild to bind
//   surface      `_n` is detected and unpacked into smooth/metal/normal, not pasted as colour
//   camo         a `from` naming a stock camouflage stem is a PIN, not a slot texture (§1)
//   badblk       one unreadable `.blk` out of two still loads what the other describes, and says so
//   notex        a skin with no textures at all is refused before anything is touched
//   cancel       the wrong-vehicle dialog's Cancel applies nothing
//   force        and "Apply to current model" applies everything
//   reset        a second skin puts the first one's slots back to STOCK, not to the first skin
//   family       a skin with a .blk per vehicle offers EVERY one, and a loaded member that is not the
//                first .blk is the skin's vehicle rather than the wrong one
//   plan         only the on-screen vehicle's .blk is applied, each file decoded once however many
//                stems it lands on, an unbound sheet kept under the stem it REPLACES, and a skin load
//                records no undo history (2026-09-21)
//
// Usage: node tools/t63_skinload.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const NL = "\\n";
const BODY = `async function(){
  var out = {};

  // ---- a flat 8x8 uncompressed 32-bit TGA, top-left origin (desc bit 5) ----
  var tga = function(r, g, b, a){
    var W = 8, H = 8, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W; u[14] = H; u[16] = 32; u[17] = 0x20;
    for (var i = 0; i < W * H; i++) { var p = 18 + i * 4; u[p] = b; u[p+1] = g; u[p+2] = r; u[p+3] = a === undefined ? 255 : a; }
    return u;
  };
  var png = function(r, g, b){
    var c = mkCanvas(8, 8), x = ctx2d(c);
    x.fillStyle = "rgb(" + r + "," + g + "," + b + ")"; x.fillRect(0, 0, 8, 8);
    return new Promise(function(res){ c.toBlob(function(bl){ bl.arrayBuffer().then(function(ab){ res(new Uint8Array(ab)); }); }, "image/png"); });
  };
  var entry = function(name, bytes){ return { name: name, bytes: async function(){ return bytes.slice(); } }; };
  var blk = function(name, text){ return entry(name, new TextEncoder().encode(text)); };
  var decodedFrom = function(bytes, name){
    var d = parseTGA(bytes.buffer.slice(0));
    d.raw = bytes.buffer.slice(0); d.rawName = name; d.fileName = name;
    return d;
  };
  // Read one texel back out of a canvas.
  var px = function(cv){ if (!cv) return null; var d = ctx2d(cv).getImageData(1, 1, 1, 1).data; return [d[0], d[1], d[2]]; };

  // ---- the vehicle, as the app itself builds one ----
  // STOCK colours: hull blue, turret green, so "it applied the wrong file" is a wrong colour.
  var setup = function(){
    App.decoded = new Map();
    App.decoded.set("hull_c", decodedFrom(tga(0, 0, 255), "hull_c.tga"));
    App.decoded.set("hull_n", decodedFrom(tga(30, 40, 50), "hull_n.tga"));
    App.decoded.set("turret_c", decodedFrom(tga(0, 255, 0), "turret_c.tga"));
    App.slots = new Map();
    ensureSlot({ stem: "hull", c: "hull_c", n: "hull_n" });
    ensureSlot({ stem: "turret", c: "turret_c" });
    App.skinApplied = null; App.skinDecoded = new Set(); App.loadedSkin = null;
    App.skinCamo = new Map(); App.paintTex = new Map(); App.paintColor = new Map();
    App.matPaint = new Map([["hull_mat", "us_camo_olive"]]);   // what stockCamoStems() reads
    App.undoStack.length = 0; App.redoStack.length = 0;
    $("skinInfo").textContent = ""; $("skinName").value = "";
  };
  var slotState = function(){
    var h = App.slots.get("hull"), t = App.slots.get("turret");
    return { hull: px(h && h.baseC), turret: px(t && t.baseC),
             smooth: px(h && h.smooth), metal: px(h && h.metal), normal: px(h && h.normal),
             slots: [].concat.apply([], [[...App.slots.keys()]]).sort() };
  };

  var geomWas = App.geomData, keyWas = App.vehicleKey, modelsWas = GameDB.models, dlgWas = window.choiceDialog;
  App.geomData = null; App.vehicleKey = null; GameDB.models = [];   // no model => no dialog

  // ---- the .blk parser on its own: the trailing * and both verbs ----
  out.parse = parseSkinBlk(
    'replace_tex{ from:t="hull_c*"; to:t="my_hull" }${NL}' +
    'set_tex{ from:t="us_camo_olive*"; to:t="green.tga"; param:t="camo_skin_tex" }${NL}' +
    'replace_tex{ from:t="broken" }${NL}');

  // ================= 1-4. the ordinary load: blk, fallback, surface, camo =================
  setup();
  var camoPng = await png(10, 120, 40);
  var BLKTEXT = 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}' +
                'set_tex{ from:t="us_camo_olive*"; to:t="us_camo_modern_green"; param:t="camo_skin_tex" }${NL}';
  await applySkinEntries([
    blk("leopard_2a4.blk", BLKTEXT),
    entry("turret_c.tga", tga(255, 0, 0)),          // the .blk says this replaces HULL_C
    entry("hull_n.tga", tga(90, 10, 200, 77)),      // no mapping; its own name ends _n
    entry("extra_c.tga", tga(255, 0, 255)),         // no mapping and no slot
    entry("us_camo_modern_green.png", camoPng)      // a camouflage PIN, not a slot texture
  ], "TestSkin");
  out.main = slotState();
  out.main.info = $("skinInfo").textContent;
  out.main.name = $("skinName").value;
  out.main.applied = App.skinApplied;
  out.main.units = (App.loadedSkin || {}).units || [];
  out.main.skinDecoded = [...App.skinDecoded].sort();
  out.main.camoKeys = [...App.skinCamo.keys()];
  out.main.camoColor = ((App.paintColor.get("us_camo_olive") || []).map(function(v){ return Math.round(v); }));
  out.main.camoTex = !!App.paintTex.get("us_camo_olive");

  // ================= 9. a second skin resets the first one's slots to STOCK =================
  await applySkinEntries([
    blk("leopard_2a4.blk", 'replace_tex{ from:t="turret_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(255, 255, 0))
  ], "SecondSkin");
  out.second = slotState();
  out.second.applied = App.skinApplied;
  out.second.status = $("status").textContent;

  // ================= 9b. a third skin does not re-decode what it is about to overwrite =================
  // The hull is already stock (the second skin put it back) and the turret is what the third skin
  // replaces: nothing needs restoring first, and the load must not say it did.
  await applySkinEntries([
    blk("leopard_2a4.blk", 'replace_tex{ from:t="turret_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(0, 200, 200))
  ], "ThirdSkin");
  out.third = slotState();
  out.third.status = $("status").textContent;

  // ================= 6. a skin with no textures at all =================
  setup();
  await applySkinEntries([blk("only.blk", BLKTEXT)], "NoTex");
  out.notex = slotState();
  out.notex.status = $("status").textContent;
  out.notex.applied = App.skinApplied;

  // ================= 5. one unreadable .blk out of two =================
  setup();
  var boom = { name: "broken.blk", bytes: async function(){ throw new Error("nope"); } };
  await applySkinEntries([
    boom,
    blk("leopard_2a4.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(255, 0, 0))
  ], "HalfSkin");
  out.badblk = slotState();
  out.badblk.applied = App.skinApplied;

  // ================= 10-12. the four branches of applyReplaceTexture a skin can reach =========
  // A skin file does not always land on a slot that is already the same shape, and the three cases
  // where it does not are three different code paths: a slot with no albedo yet, a slot with no
  // surface map yet, and a sheet authored at a different resolution. Reported as user stories
  // rather than as unit scaffolding because that is how each one arrives.

  // 10. a sheet authored bigger than the stock one keeps ITS size, and the history goes with it.
  setup();
  var big = function(r, g, b){                       // a 16x16 TGA against the stock 8x8
    var W = 16, H = 16, u = new Uint8Array(18 + W * H * 4);
    u[2] = 2; u[12] = W; u[14] = H; u[16] = 32; u[17] = 0x20;
    for (var i = 0; i < W * H; i++) { var p = 18 + i * 4; u[p] = b; u[p+1] = g; u[p+2] = r; u[p+3] = 255; }
    return u;
  };
  // First a same-size load, then a step of history for the resize to have to throw away. (Since
  // 2026-09-21 a skin load itself records no history — every base sheet under the stack changes,
  // so the whole stack is cleared, not added to — which is why the step is pushed by hand.)
  await applySkinEntries([entry("turret_c.tga", tga(0, 0, 128))], "SameSize");
  out.resize = { undoAfterLoad: App.undoStack.length };
  pushAction("a stroke", function(){}, function(){}, 0);
  out.resize.undoBefore = App.undoStack.length;
  await applySkinEntries([entry("turret_c.tga", big(255, 128, 0))], "BigSkin");
  var tt = App.slots.get("turret");
  out.resize.size = tt.size;
  out.resize.baseW = tt.baseC.width;
  out.resize.px = px(tt.baseC);
  out.resize.undoAfter = App.undoStack.length;
  out.resize.status = $("status").textContent;

  // 11. a slot the game gave no albedo for adopts the incoming sheet wholesale.
  setup();
  ensureSlot({ stem: "skirt", c: "skirt_c" });        // no decoded entry => a placeholder
  out.adoptC = { missingBefore: App.slots.get("skirt").missing };
  await applySkinEntries([entry("skirt_c.tga", tga(255, 0, 128))], "AdoptC");
  var sk = App.slots.get("skirt");
  out.adoptC.missingAfter = sk.missing;
  out.adoptC.edited = !!sk.cEdited;
  out.adoptC.px = px(sk.baseC);
  out.adoptC.decoded = !!App.decoded.get("skirt_c");

  // 12. and a slot with an albedo but no _n yet grows one, naming it after itself.
  setup();
  out.adoptN = { smoothBefore: !!App.slots.get("turret").smooth,
                 stemBefore: App.slots.get("turret").nStem };
  await applySkinEntries([entry("turret_n.tga", tga(140, 20, 220, 60))], "AdoptN");
  var tn = App.slots.get("turret");
  out.adoptN.stem = tn.nStem;
  out.adoptN.smooth = px(tn.smooth);
  out.adoptN.metal = px(tn.metal);
  out.adoptN.normal = px(tn.normal);
  out.adoptN.edited = !!tn.nEdited;
  out.adoptN.albedo = px(tn.baseC);                  // must NOT have been touched

  // ================= 7-8. the wrong-vehicle dialog =================
  GameDB.models = ["leopard_2a4"];
  // geomData stays null: the branch under test is the vehicleKey MISMATCH, which does not read it,
  // and giving the page a fake one sends rebuildAll into buildScene with no real geometry.
  App.vehicleKey = "t_34_85";
  var asked = [];
  window.choiceDialog = function(msg, choices){
    asked.push({ msg: msg, values: choices.map(function(c){ return c.value; }),
                 rows: choices.filter(function(c){ return c.list; }).map(function(c){ return c.label; }) });
    return Promise.resolve(window.__answer);
  };

  setup();
  window.__answer = "cancel";
  await applySkinEntries([
    blk("leopard_2a4.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(255, 0, 0))
  ], "WrongVehicle");
  out.cancel = slotState();
  out.cancel.applied = App.skinApplied;
  out.cancel.asked = asked.length;
  out.cancel.choices = asked.length ? asked[0].values : [];
  out.cancel.msg = asked.length ? asked[0].msg : "";

  setup();
  asked = [];
  window.__answer = "force";
  await applySkinEntries([
    blk("leopard_2a4.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(255, 0, 0))
  ], "WrongVehicle");
  out.force = slotState();
  out.force.applied = App.skinApplied;
  out.force.asked = asked.length;

  // ================= 9. a skin that fits a whole family =================
  // Three .blks, one per vehicle. Until 2026-09-19 findModel stopped at the first the registry
  // knew, so the dialog offered only the 2A4 and a loaded 2A6 was "the wrong vehicle".
  GameDB.models = ["leopard_2a4", "leopard_2a5", "leopard_2a6", "t_34_85"];
  var family = function(){ return [
    blk("leopard_2a4.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    blk("leopard_2a5.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    blk("leopard_2a6.blk", 'replace_tex{ from:t="hull_c*"; to:t="turret_c" }${NL}'),
    entry("turret_c.tga", tga(255, 0, 0))
  ]; };
  out.family = {};
  // (a) the wrong vehicle is loaded: every member is offered, and the question names them all
  setup(); asked = []; App.vehicleKey = "t_34_85";
  window.__answer = "cancel";
  await applySkinEntries(family(), "Family");
  out.family.offered = asked.length ? asked[0].values : [];
  out.family.msg = asked.length ? asked[0].msg : "";
  out.family.rows = asked.length ? asked[0].rows : [];
  // (b) a member that is NOT the first .blk is on screen: it is the skin's vehicle, not the wrong one
  setup(); asked = []; App.vehicleKey = "leopard_2a6";
  window.__answer = "force";
  await applySkinEntries(family(), "Family");
  out.family.onScreenMsg = asked.length ? asked[0].msg : "";
  out.family.onScreenModel = App.loadedSkin && App.loadedSkin.model;
  out.family.onScreenApplied = App.skinApplied;
  // (c) picking a member other than the first loads THAT one and starts the load over on it
  var lvmWas = window.loadVehicleModel, loaded = [];
  window.loadVehicleModel = async function(name){ loaded.push(name); App.vehicleKey = name; window.__answer = "force"; };
  setup(); asked = []; App.vehicleKey = "t_34_85";
  window.__answer = "load:leopard_2a5";
  await applySkinEntries(family(), "Family");
  window.loadVehicleModel = lvmWas;
  out.family.picked = loaded;
  out.family.pickedAsked = asked.length;
  out.family.pickedModel = App.loadedSkin && App.loadedSkin.model;
  out.family.pickedApplied = App.skinApplied;

  // ================= 13. a family skin applies THIS vehicle's .blk, and each file once =================
  // The 2A6 is on screen. Its .blk maps one file onto two stems — the turret, and a pod no slot
  // exists for yet — and the 2A4's .blk maps the same file onto the hull. Until 2026-09-21 every
  // .blk's lines were applied (the hull would go red, the file be read three times), and the
  // unbound sheet was filed under the FILE's name, where no store hung later could find it.
  setup(); asked = []; App.vehicleKey = "leopard_2a6"; window.__answer = "force";
  var reads = 0;
  var counted = function(name, bytes){ return { name: name, bytes: async function(){ reads++; return bytes.slice(); } }; };
  await applySkinEntries([
    blk("leopard_2a4.blk", 'replace_tex{ from:t="hull_c*"; to:t="art_c" }${NL}'),
    blk("leopard_2a6.blk", 'replace_tex{ from:t="turret_c*"; to:t="art_c" }${NL}replace_tex{ from:t="pod_c*"; to:t="art_c" }${NL}'),
    counted("art_c.tga", tga(200, 40, 40))
  ], "Family2");
  out.plan = slotState();
  out.plan.reads = reads;
  out.plan.info = $("skinInfo").textContent;
  out.plan.skinDecoded = [...App.skinDecoded].sort();
  out.plan.artKept = !!App.decoded.get("art_c");
  out.plan.undo = App.undoStack.length;
  // gcDecoded past its 64-entry floor must keep the pod's sheet for the rebuild that will bind it
  for (var i = 0; i < 70; i++) App.decoded.set("filler_" + i, { width: 1, height: 1, mips: [] });
  gcDecoded();
  out.plan.podSurvivesGc = !!App.decoded.get("pod_c");
  out.plan.fillerGone = !App.decoded.has("filler_1");
  // ...and when the store IS hung, its slot takes the sheet and counts as edited, so it exports
  ensureSlot({ stem: "pod", c: "pod_c" });
  out.plan.pod = px(App.slots.get("pod").baseC);
  out.plan.podEdited = !!App.slots.get("pod").cEdited;

  window.choiceDialog = dlgWas;
  App.geomData = geomWas; App.vehicleKey = keyWas; GameDB.models = modelsWas;
  App.slots = new Map(); App.decoded = new Map();
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep"), timeoutMs: 90000 });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const rgb = a => a ? `rgb(${a[0]},${a[1]},${a[2]})` : "none";
const near = (a, b, tol) => !!a && a.every((v, i) => Math.abs(v - b[i]) <= tol);

console.log("=== the .blk parser ===");
console.log("   " + JSON.stringify(o.parse));
R.is(o.parse.length === 2, `two well-formed blocks parsed out of three (${o.parse.length}) — the one missing a "to" is skipped rather than half-read`);
R.is(!!o.parse[0] && o.parse[0].from === "hull_c" && o.parse[0].kind === "replace_tex",
  `the trailing "*" is stripped off "hull_c*" (${o.parse[0] && o.parse[0].from}) — the game writes it, the slot stem does not have it`);
R.is(!!o.parse[1] && o.parse[1].kind === "set_tex" && o.parse[1].to === "green.tga",
  `set_tex is read as well as replace_tex — a ground vehicle's camouflage line is a set_tex (CLAUDE.md §1)`);

console.log("\n=== the .blk mapping beats the file's own name ===");
console.log(`   hull ${rgb(o.main.hull)}, turret ${rgb(o.main.turret)}   (stock: hull blue, turret green; the incoming file is red and is CALLED turret_c)`);
R.is(near(o.main.hull, [255, 0, 0], 8),
  `the file named turret_c.tga landed on HULL (${rgb(o.main.hull)}), because the .blk says it replaces hull_c — the two answers are different slots, so a fallback firing anyway would be visible`);
R.is(near(o.main.turret, [0, 255, 0], 8),
  `and the turret still holds its stock sheet (${rgb(o.main.turret)}) — nothing was applied twice`);

console.log("\n=== a texture with no mapping and no slot is kept for the rebuild ===");
console.log(`   skinDecoded ${JSON.stringify(o.main.skinDecoded)}, slots ${JSON.stringify(o.main.slots)}`);
R.is(o.main.skinDecoded.indexOf("extra_c") >= 0, `extra_c.tga has no .blk line and matches no slot, so it is decoded and kept (${JSON.stringify(o.main.skinDecoded)})`);
R.is(o.main.slots.indexOf("extra") >= 0, `and rebuildAll binds it to a slot of its own (${JSON.stringify(o.main.slots)})`);

console.log("\n=== _n is unpacked, not pasted as colour ===");
console.log(`   smooth ${rgb(o.main.smooth)}, metal ${rgb(o.main.metal)}, normal ${rgb(o.main.normal)}   (the file is rgba 90,10,200,77)`);
R.is(near(o.main.smooth, [90, 90, 90], 4), `R becomes smoothness (${rgb(o.main.smooth)}) — the file's red channel, greyscale`);
R.is(near(o.main.metal, [200, 200, 200], 4), `B becomes metallicity (${rgb(o.main.metal)}) — CLAUDE.md §1's packing; read as colour all three would be ${rgb([90, 10, 200])}`);
R.is(!!o.main.normal && Math.abs(o.main.normal[0] - 10) <= 4 && Math.abs(o.main.normal[1] - 77) <= 4,
  `G and A become the normal's X and Y (${rgb(o.main.normal)}) — the alpha is a channel here, not transparency`);

console.log("\n=== a camouflage stem is a pin, not a slot texture ===");
console.log(`   skinCamo ${JSON.stringify(o.main.camoKeys)}, colour ${rgb(o.main.camoColor)}`);
R.is(o.main.camoKeys.length === 1 && o.main.camoKeys[0] === "us_camo_olive",
  `the set_tex whose "from" is a stock camo stem is pinned under that stem (${JSON.stringify(o.main.camoKeys)}), so export can re-emit it`);
R.is(o.main.camoTex, `its sheet goes to App.paintTex for the preview`);
R.is(near(o.main.camoColor, [10, 120, 40], 6), `and its average colour is measured off the real pixels (${rgb(o.main.camoColor)}) — this is the .png branch, so the image decode is covered too`);
R.is(!near(o.main.hull, [10, 120, 40], 20) && !near(o.main.turret, [10, 120, 40], 20),
  `and it went to NO slot — a camo pin is what the vehicle looks like under the skin, not one of its sheets`);

console.log("\n=== what the load reports ===");
console.log(`   "${o.main.info}"  ·  skinName "${o.main.name}"`);
R.is(/4 texture\(s\) applied/.test(o.main.info), `all four files are accounted for (${o.main.info})`);
R.is(/leopard_2a4/.test(o.main.info) && o.main.units[0] === "leopard_2a4",
  `the vehicle the .blk is named for is recorded and shown`);
R.is(o.main.name === "TestSkin", `an empty export name is seeded from the skin's own (${o.main.name})`);

console.log("\n=== a second skin resets to STOCK, not to the first skin ===");
console.log(`   hull ${rgb(o.second.hull)} (stock blue), turret ${rgb(o.second.turret)} (the new file, yellow)`);
R.is(near(o.second.hull, [0, 0, 255], 8),
  `the hull is back to its stock sheet (${rgb(o.second.hull)}) — the second skin does not touch it, and leaving the first skin's red there is the bug this branch exists for`);
R.is(near(o.second.turret, [255, 255, 0], 8), `and the turret holds the second skin's file (${rgb(o.second.turret)})`);
R.is(o.second.applied === "SecondSkin", `App.skinApplied names the skin now on the model`);
R.is(/2 reset to stock first/.test(o.second.status), `and the load says what it put back — the hull's albedo and its _n, both from the first skin ("${o.second.status}")`);
console.log("\n=== a third skin restores nothing it is about to overwrite ===");
console.log(`   hull ${rgb(o.third.hull)}, turret ${rgb(o.third.turret)}   "${o.third.status}"`);
R.is(near(o.third.turret, [0, 200, 200], 8) && near(o.third.hull, [0, 0, 255], 8),
  `the turret holds the third skin's file and the hull is still stock (turret ${rgb(o.third.turret)}, hull ${rgb(o.third.hull)})`);
R.is(!/reset to stock/.test(o.third.status),
  `and nothing was put back first — the hull already was stock and the turret was about to be replaced, so re-decoding either would have been thrown away ("${o.third.status}")`);

console.log("\n=== a skin with no textures is refused before anything is touched ===");
console.log(`   "${o.notex.status}"`);
R.is(/No textures found/.test(o.notex.status), `it says so, naming the source`);
R.is(o.notex.applied === null && near(o.notex.hull, [0, 0, 255], 8),
  `and nothing was reset or applied (hull ${rgb(o.notex.hull)}) — the refusal comes before resetSkinTextures`);

console.log("\n=== one unreadable .blk out of two ===");
R.is(near(o.badblk.hull, [255, 0, 0], 8),
  `what the readable .blk describes still loads (hull ${rgb(o.badblk.hull)}) — carrying on is right, silence was not`);
R.is(o.badblk.applied === "HalfSkin", `and the skin counts as applied`);

console.log("\n=== the wrong-vehicle dialog ===");
console.log(`   asked ${o.cancel.asked}x, choices ${JSON.stringify(o.cancel.choices)}`);
R.is(o.cancel.asked === 1 && o.cancel.choices.join(",") === "load:leopard_2a4,force,cancel",
  `a skin for another vehicle asks once, with all three ways out (${o.cancel.choices.join(",")})`);
R.is(/leopard_2a4/.test(o.cancel.msg) && /t_34_85/.test(o.cancel.msg),
  `and the question names both vehicles rather than saying "wrong vehicle"`);
R.is(o.cancel.applied === null && near(o.cancel.hull, [0, 0, 255], 8),
  `Cancel applies nothing (hull ${rgb(o.cancel.hull)}) — it returns before the progress bar, so a cancelled load cannot half-reset the slots`);
R.is(o.force.applied === "WrongVehicle" && near(o.force.hull, [255, 0, 0], 8),
  `"Apply to current model" applies everything (hull ${rgb(o.force.hull)}) — CLAUDE.md §0.3's escape hatch`);
R.is(o.force.asked === 1, `and it asks exactly once (${o.force.asked})`);

console.log("\n=== a skin that fits a whole family ===");
const F = o.family;
console.log(`   offered ${JSON.stringify(F.offered)}; picked ${JSON.stringify(F.picked)} after ${F.pickedAsked} question(s)`);
R.is(F.offered.join(",") === "load:leopard_2a4,load:leopard_2a5,load:leopard_2a6,force,cancel",
  `three .blks, three "Load" buttons (${F.offered.join(",")}) — not just the first one the registry knew`);
R.is(F.rows.join(",") === "leopard_2a4,leopard_2a5,leopard_2a6" && /3 vehicles/.test(F.msg),
  `as three ROWS (${F.rows.join(",")}) under a question that counts them — not three more buttons in the action row`);
R.is(!/is loaded/.test(F.onScreenMsg) && F.onScreenModel === "leopard_2a6" && F.onScreenApplied === "Family",
  `with the 2A6 on screen — the THIRD .blk — it is the skin's vehicle, not the wrong one (model ${F.onScreenModel})`);
R.is(F.picked.join(",") === "leopard_2a5" && F.pickedAsked === 2 && F.pickedModel === "leopard_2a5" && F.pickedApplied === "Family",
  `"Load leopard_2a5" loads the 2A5 (${F.picked.join(",")}), and the load starts over on it and reports it (model ${F.pickedModel})`);

console.log("\n=== a family skin applies this vehicle's .blk, and each file once ===");
const P = o.plan;
console.log(`   hull ${rgb(P.hull)}, turret ${rgb(P.turret)}; ${P.reads} read(s); kept ${JSON.stringify(P.skinDecoded)}; "${P.info}"`);
R.is(near(P.turret, [200, 40, 40], 8) && near(P.hull, [0, 0, 255], 8),
  `the 2A6's .blk is the one applied (turret ${rgb(P.turret)}) and the 2A4's is not (hull ${rgb(P.hull)}, still stock) — the other members' lines describe other vehicles' stems`);
R.is(P.reads === 1 && /2 texture\(s\) applied/.test(P.info),
  `one file mapped onto two stems is read and decoded ONCE (${P.reads}) and applied to both ("${P.info}")`);
R.is(P.skinDecoded.join(",") === "pod_c" && !P.artKept,
  `the stem no slot exists for is kept under what the .blk says it REPLACES (${JSON.stringify(P.skinDecoded)}), not under the file's own name (art_c kept: ${P.artKept})`);
R.is(P.undo === 0, `and a skin load records no undo history (${P.undo}) — the base sheets under every snapshot changed, so the stack is cleared, not added to`);
R.is(P.podSurvivesGc && P.fillerGone,
  `gcDecoded past its 64-entry floor releases the unreferenced sheets (filler gone: ${P.fillerGone}) and KEEPS the skin's pod sheet (${P.podSurvivesGc}) — releasing it was half of "the weapons show the game's textures until the skin is loaded again"`);
R.is(near(P.pod, [200, 40, 40], 8) && P.podEdited,
  `hanging the store binds that sheet to its new slot (${rgb(P.pod)}) and counts it as edited (${P.podEdited}), so the export ships it`);

console.log("\n=== a sheet authored at another resolution keeps its own ===");
const Z = o.resize;
console.log(`   ${Z.baseW}px, ${rgb(Z.px)}, undo ${Z.undoAfterLoad} after the load, ${Z.undoBefore} → ${Z.undoAfter}   "${Z.status}"`);
R.is(Z.undoAfterLoad === 0, `a same-size skin load leaves no history behind (${Z.undoAfterLoad})`);
R.is(Z.size === 16 && Z.baseW === 16,
  `a 16px skin over an 8px stock sheet rebuilds the slot at 16 (${Z.baseW}) — a skin authored at 8192 must stay at 8192, not be squeezed into whatever the stock texture happened to be`);
R.is(near(Z.px, [255, 128, 0], 8), `and it is the incoming pixels that survive the rebuild (${rgb(Z.px)})`);
R.is(Z.undoBefore > 0 && Z.undoAfter === 0,
  `the history is cleared with it (${Z.undoBefore} → ${Z.undoAfter}) — every snapshot in it is the old size, so undoing onto the new sheet would put back a picture that no longer fits`);
// applyReplaceTexture sets its own "slot resized 8→16px (undo history cleared)" line, but a skin
// load reports the whole load afterwards and that is the right thing for it to report — so the
// size reaching the user on THIS path is the one the skin's own summary carries. The per-texture
// message is what the "replace texture…" picker shows, where it is the only thing that happened.
R.is(/\b16px\b/.test(Z.status),
  `and the size change reaches the user rather than happening silently ("${Z.status}")`);

console.log("\n=== a slot the game gave no albedo for adopts the incoming sheet ===");
const AC = o.adoptC;
console.log(`   missing ${AC.missingBefore} → ${AC.missingAfter}, ${rgb(AC.px)}`);
R.is(AC.missingBefore === true && AC.missingAfter === false,
  `a placeholder slot stops being a placeholder (${AC.missingBefore} → ${AC.missingAfter}) — erroring here instead would make a skin unloadable because of a texture the GAME did not ship`);
R.is(near(AC.px, [255, 0, 128], 8) && AC.edited, `it holds the skin's pixels and counts as edited (${rgb(AC.px)})`);
R.is(AC.decoded, `and the decoded sheet is bound under the slot's own stem, so the export names it`);

console.log("\n=== a slot with no _n yet grows one, named after itself ===");
const AN = o.adoptN;
console.log(`   stem ${AN.stemBefore} → ${AN.stem}; smooth ${rgb(AN.smooth)}, metal ${rgb(AN.metal)}, normal ${rgb(AN.normal)}`);
R.is(AN.smoothBefore === false && !!AN.smooth,
  `a slot that had no surface stack gets one (had ${AN.smoothBefore})`);
R.is(AN.stem === "turret_n", `named from the slot rather than from the file (${AN.stem}, was ${AN.stemBefore})`);
R.is(near(AN.smooth, [140, 140, 140], 4) && near(AN.metal, [220, 220, 220], 4)
  && !!AN.normal && Math.abs(AN.normal[0] - 20) <= 4 && Math.abs(AN.normal[1] - 60) <= 4,
  `and it is unpacked on the way in, not adopted as colour (smooth ${rgb(AN.smooth)}, metal ${rgb(AN.metal)}, normal ${rgb(AN.normal)})`);
R.is(near(AN.albedo, [0, 255, 0], 8),
  `while the albedo beside it is untouched (${rgb(AN.albedo)}) — the two halves of a slot are replaced independently`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs/i.test(e));
R.is(errs.length === 0, `no uncaught errors on the page (${errs.length})` + (errs.length ? ": " + errs.join(" | ") : ""));
R.finish();
