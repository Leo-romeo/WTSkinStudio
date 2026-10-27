// Which materials earn a paintable texture slot (ROADMAP 3.18).
//
// WHY THIS EXISTS. `rebindMaterials` reads the game's own model→texture map and gives each material
// a slot. When a material has no `t0` it falls back to "any non-normal texture the material uses",
// which was written for a propeller mask — and it over-reached. A **glass** shader's `t3` is a
// coating lookup, not an albedo, so a canopy got a blank paintable slot demanding a texture no skin
// can ever supply, and the mesh rendered as that empty slot instead of as glass.
//
// Reported 2026-08-25 on an `ef_2000_aesa`: three "slots without textures", two of them
// `golden_coating` and `black_coating`. Its two canopy materials are **unnamed**
// `dynamic_glass_chrome` carrying only `t3`, which is why no name-based test could ever have caught
// them — `isNonPaintableMat` matches "coating" but never sees the string, because the material has
// no name. The shader class is the thing that knows.
//
// The rule is exact rather than a guess, and that is the point of the numbers below: swept over
// every `*Desc.bin` in the install, **376 materials on 230 models** take that fallback with no t0,
// and **every single one is `dynamic_glass_chrome`** — 168 `rainbow_coating`, 58 `golden_coating`,
// 47 `rainbow_light_coating`, 33 `rainbow_lens_mirror_coating`, 13 `optic_glass_ao`, 8
// `default_no_coating`, 8 `golden_coating_mirror`, 7 `black_coating`. So gating the fallback on the
// class fixes all of them and can reach nothing else.
//
// The materials below are the real ones off `ef_2000_aesa`, transcribed from its dynModelDesc.
//
// Usage: node tools/t53_slots.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  // The real materials, in the real shape buildDescBind produces: { c, n, cls, index, all }.
  var MATS = [
    { key: "ef_2000_aesa_aircraft_normal_detail_lo", cls: "dynamic_masked_chrome_bump",
      all: { t0: "ef_2000_aesa_c", t2: "ef_2000_aesa_n", t4: "aircraft_normal_detail_lo_n" } },
    { key: "canopy_gold", cls: "dynamic_glass_chrome", all: { t3: "golden_coating" } },
    { key: "canopy_black", cls: "dynamic_glass_chrome", all: { t3: "black_coating" } },
    // a glass material that really does carry an albedo must KEEP its slot — only the fallback
    // is gated, so "we stopped making slots for glass" would fail here
    { key: "glass_with_albedo", cls: "dynamic_glass_chrome", all: { t0: "some_glass_c", t2: "some_glass_n" } },
    // the propeller mask the fallback was written for: it has a t0, so it is untouched by the gate
    { key: "propmask", cls: "propeller_front",
      all: { t0: "4_blade_slow_propmask", t2: "prop_nm_spec", t4: "black_yellow_sb2c_1c_rottex" } },
    { key: "nulled", cls: "dynamic_null", all: {} },
  ];
  var map = new Map();
  MATS.forEach(function(m, i){
    map.set(m.key, { c: m.all.t0 || null, n: m.all.t2 || null, cls: m.cls, index: i, all: m.all });
  });
  var bind = { model: "ef_2000_aesa", map: map, materials: [] };

  // Stand in for the game's desc, and give every material a scrap of geometry to sit on.
  var descWas = descBindFor, geomWas = App.geomData, keyWas = App.vehicleKey;
  var slotsWas = new Map(App.slots), matSlotWas = new Map(App.matSlot);
  App.slots.clear(); App.matSlot.clear();
  descBindFor = function(){ return bind; };
  App.vehicleKey = "ef_2000_aesa";
  App.geomData = MATS.map(function(m, i){
    return { name: "part_" + i, mat: m.key, position: new Float32Array(9) };
  });
  // Pretend every texture the descriptions name has been decoded, so a slot that IS created gets
  // its albedo — otherwise "no slot" and "an empty slot" would be indistinguishable.
  var stems = new Set(["ef_2000_aesa_c", "ef_2000_aesa_n", "golden_coating", "black_coating",
    "some_glass_c", "some_glass_n", "4_blade_slow_propmask", "prop_nm_spec"]);
  rebindMaterials(stems);
  out.slots = Array.from(App.slots.keys()).sort();   // Map.keys() is an iterator: [].slice.call gives []
  out.bound = {};
  MATS.forEach(function(m){ out.bound[m.key] = App.matSlot.get(m.key) || null; });
  // the class half of isNonPaintableMat — the name half is unchanged and already had no test
  out.classGate = { glass: isNonPaintableMat("", "dynamic_glass_chrome"),
    glassTone: isNonPaintableMat("", "dynamic_glass_tone"),
    nul: isNonPaintableMat("", "dynamic_null"),
    // the ordinary aircraft shader has "chrome" in its name and must NOT be caught
    aircraft: isNonPaintableMat("", "dynamic_masked_chrome_bump"),
    prop: isNonPaintableMat("", "propeller_front"),
    blank: isNonPaintableMat("", ""),
    // and the name half still works on its own, with no class at all
    byName: isNonPaintableMat("black_coating"), notByName: isNonPaintableMat("ef_2000_aesa") };


  // ---- glazing renders as glass, not as white plastic (ROADMAP 4.15) ----
  // Reported as "cockpits with rainbow or other colour effects ... simply look white and not
  // transparent". 3.18 had already measured the cause without naming it: every material that takes
  // the no-albedo branch above is dynamic_glass_chrome, 376 of them across 230 models, and MOST OF
  // THEM HAVE NO NAME — so the viewport's own /glass|canopy|chrome/ test on the material name could
  // never see them and they fell through to the flat "no texture" fallback. The class is what says
  // they are glass, and it is now recorded where the desc entry is already in hand.
  out.glass = {
    // a glass shader WITH a t0 is recorded too since ROADMAP 1.26, marked "tex" — it keeps its slot and is drawn
    // through its sheet's alpha — so the no-sheet entries are the ones without the mark
    recorded: [...App.matGlass].filter(function(e){ return !e[1].tex; }).map(function(e){ return e[0]; }).sort().join(","),
    withSheet: [...App.matGlass].filter(function(e){ return e[1].tex; }).map(function(e){ return e[0]; }).sort().join(","),
    coat: (App.matGlass.get("canopy_gold") || {}).coat + "|" + (App.matGlass.get("canopy_black") || {}).coat,
    notPaintable: !App.matGlass.has("ef_2000_aesa_aircraft_normal_detail_lo"),
  };
  var mkMat = function(n){ var m = makeMaterial(n, ""); return { t: !!m.transparent, o: +m.opacity.toFixed(2),
    c: "#" + m.color.getHexString(), phys: !!m.isMeshPhysicalMaterial, dw: !!m.depthWrite }; };
  out.glass.gold = mkMat("canopy_gold");
  out.glass.black = mkMat("canopy_black");
  // A NAMELESS material of the same class — the case the name test could never reach.
  App.matGlass.set("unknown_7", { cls: "dynamic_glass_chrome", coat: "rainbow_coating" });
  out.glass.rainbow = mkMat("unknown_7");
  // ...and an ordinary aircraft material is still opaque, or a loose test would have eaten the fleet
  out.glass.airframe = mkMat("ef_2000_aesa_aircraft_normal_detail_lo");
  App.matGlass.delete("unknown_7");

  // ---- paste a texture in as a LAYER, not over the base sheet (ROADMAP 4.25) ----
  // The only way in before this was Replace, which overwrites the sheet every layer composites over.
  // Three things have to hold, and the third is the one the feature invites getting wrong: the
  // source lands on the CHANNEL it came from, so a packed _n arrives as smoothness / metalness /
  // normal rather than as a picture of nothing on the albedo.
  var PN = 64;
  var pflat = function(hex){ var c = mkCanvas(PN, PN), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, PN, PN); return c; };
  var pslot = function(id){
    var s = { id: id, size: PN, nSize: PN, layers: [], missing: false };
    s.baseC = pflat("#404040"); s.composite = mkCanvas(PN, PN);
    s.smooth = pflat("#202020"); s.metal = pflat("#101010"); s.normal = pflat("#8080ff");
    return s;
  };
  App.slots.clear();
  var A = pslot("pa_c"), B = pslot("pb_c");
  App.slots.set("pa_c", A); App.slots.set("pb_c", B);
  App.activeSlot = A; App.activeLayer = null;
  App.selParts = new Set(); App.geomData = null;
  App.undoStack.length = 0; App.redoStack.length = 0;
  // A decoded sheet with no slot of its own — what Vehicle > search > add leaves behind when no
  // material matches it. Without the third tier the search half of the request ends in a texture the
  // paste dialog cannot see.
  var decWas = App.decoded;
  App.decoded = new Map([["some_camo_c", { width: 8, height: 8, mips: [{ rgba: new Uint8ClampedArray(8 * 8 * 4).fill(200) }] }],
                         ["some_detail_n", { width: 8, height: 8, mips: [{ rgba: new Uint8ClampedArray(8 * 8 * 4).fill(128) }] }],
                         ["pa_c", { width: 8, height: 8, mips: [{ rgba: new Uint8ClampedArray(8 * 8 * 4) }] }]]);
  A.cStem = "pa_c";
  var src = PasteTex.sources(A);
  out.paste = {
    labels: src.map(function(x){ return x.label + (x.same ? "" : "!"); }).join(" "),
    firstIsOwn: !!(src[0] && src[0].same),
    anyWear: src.some(function(x){ return x.ch === "wear"; }),
    loose: src.filter(function(x){ return x.loose; }).map(function(x){ return x.label + ":" + x.ch; }).join(" "),
  };
  App.decoded = decWas;
  // A SMALLER source, so "scaled to the destination" is visible rather than assumed.
  var small = mkCanvas(16, 16); ctx2d(small).fillStyle = "#00c000"; ctx2d(small).fillRect(0, 0, 16, 16);
  var before = ctx2d(A.baseC).getImageData(0, 0, 1, 1).data[0];
  PasteTex.place(A, small, "color", "pasted colour");
  var L = A.layers[0];
  out.paste.made = !!L;
  out.paste.chan = L ? layerChan(L) : null;
  out.paste.size = L && L.canvas ? [L.canvas.width, L.canvas.height].join("x") : null;
  out.paste.corner = L && L.canvas ? [].slice.call(ctx2d(L.canvas).getImageData(PN - 2, PN - 2, 1, 1).data) : null;
  out.paste.baseUntouched = ctx2d(A.baseC).getImageData(0, 0, 1, 1).data[0] === before;
  out.paste.steps = App.undoStack.length;
  doUndo();
  out.paste.afterUndo = A.layers.length;
  doRedo();
  // ...and the _n half: a smoothness source becomes a SMOOTHNESS layer, never a colour one. A
  // DIFFERENT value from A's own smoothness, or "it reached the sheet" would pass on two greys that
  // happen to match.
  B.smooth = pflat("#e0e0e0");
  PasteTex.place(A, B.smooth, "smooth", "pb_c · smoothness");
  var L2 = A.layers[A.layers.length - 1];
  out.paste.nChan = L2 ? layerChan(L2) : null;
  out.paste.nColourLayers = layerLeaves(A.layers).filter(function(x){ return layerChan(x) === "color"; }).length;
  compositeSlot(A); Composite.sheet(A, "smooth", null);
  out.paste.smoothMoved = !!(A.chanC && A.chanC.smooth) &&
    ctx2d(A.chanC.smooth).getImageData(PN / 2, PN / 2, 1, 1).data[0] !== 0x20;
  // a .tga from disk (found in the review of 2.3a: it was handed to parseTGA as a Uint8Array, which
  // a DataView refuses, so every .tga paste failed): an 18-byte header and 2 × 2 BGRA texels
  var tga = new Uint8Array(18 + 16); tga[2] = 2; tga[12] = 2; tga[14] = 2; tga[16] = 32; tga[17] = 8;
  for (var ti = 0; ti < 4; ti++) { tga[18 + ti * 4] = 0x10; tga[19 + ti * 4] = 0x80; tga[20 + ti * 4] = 0xf0; tga[21 + ti * 4] = 255; }
  var nTga = A.layers.length, actWas = App.activeSlot; App.activeSlot = A;
  await PasteTex.fromFile(new File([tga], "paste.tga"));
  var LT = A.layers[A.layers.length - 1];
  out.paste.tga = { added: A.layers.length - nTga, px: LT && LT.canvas ? [].slice.call(ctx2d(LT.canvas).getImageData(0, 0, 1, 1).data) : null };
  App.activeSlot = actWas;
  App.slots.delete("pa_c"); App.slots.delete("pb_c");
  App.activeSlot = null; App.activeLayer = null;
  App.undoStack.length = 0; App.redoStack.length = 0;

  descBindFor = descWas; App.geomData = geomWas; App.vehicleKey = keyWas;
  App.slots.clear(); for (var e of slotsWas) App.slots.set(e[0], e[1]);
  App.matSlot.clear(); for (var f of matSlotWas) App.matSlot.set(f[0], f[1]);
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== a glass shader's t3 coating is not an albedo ===");
console.log("   slots made: " + o.slots.join(", "));
for (const [mat, slot] of Object.entries(o.bound)) console.log("   " + mat.padEnd(38) + " -> " + (slot || "(no slot)"));

R.is(!o.bound.canopy_gold, `the gold-coated canopy gets no paintable slot (was "golden_coating")`);
R.is(!o.bound.canopy_black, `nor the black-coated one (was "black_coating")`);
R.is(o.slots.indexOf("golden_coating") < 0 && o.slots.indexOf("black_coating") < 0,
  "and neither coating appears in the slot list at all — that is the reported “slots without textures”");
R.is(o.bound.ef_2000_aesa_aircraft_normal_detail_lo === "ef_2000_aesa",
  `the airframe still resolves to its own sheet (${o.bound.ef_2000_aesa_aircraft_normal_detail_lo})`);
R.is(o.bound.glass_with_albedo === "some_glass",
  `a glass material that really has a t0 keeps its slot (${o.bound.glass_with_albedo}) — only the fallback is gated`);
R.is(o.bound.propmask === "4_blade_slow_propmask",
  `and the propeller mask the fallback exists for is untouched, because it has a t0 (${o.bound.propmask})`);
R.is(!o.bound.nulled, "a dynamic_null material still gets nothing");

console.log("\n=== the class test is narrow on purpose ===");
R.is(o.classGate.glass && o.classGate.glassTone, "dynamic_glass_chrome and dynamic_glass_tone are non-paintable");
R.is(o.classGate.nul, "dynamic_null too");
R.is(!o.classGate.aircraft,
  "dynamic_masked_chrome_bump is NOT — it is the ordinary aircraft shader, and a loose /chrome/ test would eat every vehicle");
R.is(!o.classGate.prop, "propeller_front is not");
R.is(!o.classGate.blank, "and a missing class is not, so an unknown material still gets its slot");
R.is(o.classGate.byName && !o.classGate.notByName,
  "the name half still answers on its own — black_coating yes, ef_2000_aesa no");

console.log("\n=== a texture can be pasted as a LAYER, on the channel it came from (4.25) ===");
const PT = o.paste;
console.log(`   sources: ${PT.labels}`);
R.is(PT.firstIsOwn && /!/.test(PT.labels),
  "the active slot's own sheets come first and the rest are marked — 0…1 UVs land somewhere on every sheet, so a texture from elsewhere on the same vehicle produces a plausible-looking layer that is wrong everywhere");
R.is(!PT.anyWear, "and the wear channel is not offered: it is the albedo's alpha, not a sheet of its own");
console.log(`   loose: ${PT.loose}`);
R.is(PT.loose === "some_camo_c:color some_detail_n:normal",
  `a sheet decoded but bound to no slot is offered too (${PT.loose}) — that is what "search ▸ add" leaves behind when no material matches, and without it the search half of the request ends in a texture this dialog cannot see. A loose _n is offered as NORMAL and nothing else: it has not been unpacked, so there is no honest colour reading of it`);
R.is(!/pa_c:/.test(PT.loose), "and a decoded sheet that IS a slot's own is not listed twice");
R.is(PT.made && PT.chan === "color" && PT.size === "64x64",
  `pasting makes a paint layer on the source's channel, scaled to the slot (${PT.chan}, ${PT.size}) — a 16² source would otherwise arrive as a corner of a 64² sheet, which reads as a broken paste`);
R.is(PT.corner && PT.corner[1] > 150 && PT.corner[3] === 255,
  `with the sheet really filled to its far corner (${PT.corner && PT.corner.join(",")})`);
R.is(PT.baseUntouched, "and the slot's own base texture is untouched — that is the whole difference from Replace…");
R.is(PT.steps === 1 && PT.afterUndo === 0, `one undo step, and it takes the layer back (${PT.steps} step)`);
R.is(PT.nChan === "smooth" && PT.nColourLayers === 1,
  `a smoothness source lands on the SMOOTHNESS channel (${PT.nChan}) and adds no colour layer (${PT.nColourLayers}, the one pasted above) — dropping a packed _n onto the albedo is the failure this feature invites, and it cannot happen because the sources are channels`);
R.is(PT.smoothMoved, "and it really reaches the smoothness sheet, rather than sitting in the stack doing nothing");
R.is(PT.tga && PT.tga.added === 1 && PT.tga.px && PT.tga.px[0] === 0xf0 && PT.tga.px[1] === 0x80 && PT.tga.px[2] === 0x10,
  `a .tga from disk becomes a layer of its own colour (${JSON.stringify(PT.tga)}) — it used to throw before it was read`);

console.log("\n=== glazing renders as glass, not as white plastic (4.15) ===");
const GL = o.glass;
console.log(`   recorded ${GL.recorded} · coatings ${GL.coat}`);
console.log(`   gold ${JSON.stringify(GL.gold)}`);
console.log(`   rainbow ${JSON.stringify(GL.rainbow)}   airframe ${JSON.stringify(GL.airframe)}`);
R.is(GL.recorded === "canopy_black,canopy_gold" && GL.coat === "golden_coating|black_coating",
  `the glass materials are recorded WITH their coating lookup (${GL.recorded}; ${GL.coat}) — the t3 is what stands in for an albedo on this shader, and its name is what says gold from rainbow from smoke`);
R.is(GL.notPaintable && GL.withSheet === "glass_with_albedo",
  `and only those two as sheetless glass: the ordinary aircraft shader is not in it at all, or a loose test would have eaten the fleet, and the glass material that really has a t0 is in it only as glass WITH a sheet (${GL.withSheet}) — drawn through its alpha, ROADMAP 1.26`);
R.is(GL.gold.t && GL.gold.phys && !GL.gold.dw && GL.gold.o < .7,
  `a gold-coated canopy comes out transparent (opacity ${GL.gold.o}, depthWrite ${GL.gold.dw}) — it used to be an opaque MeshStandardMaterial with no map, which is the reported "white and not transparent"`);
R.is(GL.gold.c !== GL.black.c && GL.gold.c !== GL.rainbow.c,
  `and the three coatings are three different tints (${GL.gold.c} / ${GL.black.c} / ${GL.rainbow.c}) rather than one pale blue for everything`);
R.is(GL.rainbow.t && GL.rainbow.o < .7,
  `a NAMELESS rainbow-coated material is glass too (${GL.rainbow.o}) — that is the case the name test could never reach, and rainbow is 168 of the 376 in the install`);
R.is(!GL.airframe.t && !GL.airframe.phys,
  "while the ordinary aircraft material stays opaque and standard — this is preview-only either way, but it must not turn a fuselage into a window");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
