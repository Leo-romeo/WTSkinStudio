// The vehicle's jet-flame sheet as a slot of its own, drawn on the flame from that slot, and
// exported the way community skins carry it (ROADMAP 4.13, queue item 18).
//
// WHY THIS EXISTS. The owner answered 4.13's open question on 2026-10-22: a UserSkin that ships its
// own `jet_flame_diamonds` IS shown by the game. Read off his UserSkins (2026-10-24, read-only): 83
// `.blk`s across 15 skins carry the override, 77 of them exactly this block (the rest rename the file) —
//
//     replace_tex{
//       from:t="jet_flame_diamonds*"
//       to:t="jet_flame_diamonds.dds"
//     }
//
// with the sheet beside it as 2048² RGBA8 or 4096² DXT5, 30–35 % of the flame strip's texels under
// non-zero alpha. Before this the sheet already landed in the flame material's texture-only slot,
// but the 3-D view drew the flame from the STOCK sheet in App.decoded, so neither a loaded skin's
// flame nor a stroke on it ever showed; and the slot said "2D only", with a tooltip about tank
// tracks. So this holds three things, on synthetic sheets and the real page:
//
//   * the desc's flame material gives the vehicle a slot for its sheet, and the row names it;
//   * the flame is drawn from THAT slot — its colour sheet, weighted by its coverage (the sheet's
//     alpha) — so a skin's sheet replaces the stock one, and an edit shows with no rebuild and no
//     readback; a sheet with no alpha at all (gunfire) is drawn by colour, as EffectMat's own rule;
//   * the export writes the sheet and the community skins' exact `.blk` block, and the validator
//     says what is true of it: the game shows it from UserSkins, WT Live refuses it.
//
// Usage: node tools/t163_flameslot.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var o = {};
  var N = 8;
  // A decoded sheet the way decodeEntry leaves one. fill(x, y) -> [r, g, b, a]
  var sheet = function(name, fill){
    var px = new Uint8ClampedArray(N * N * 4);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) px.set(fill(x, y), (y * N + x) * 4);
    return { width: N, height: N, fileName: name + ".dds", mips: [{ w: N, h: N, rgba: px }] };
  };
  var was = { slots: App.slots, geom: App.geomData, decoded: new Map(App.decoded), eff: new Map(App.matEffect),
              meshes: new Map(App.meshes), gate: new Set(App.gateOpen), active: App.activeSlot, stems: GameDB.stems,
              matSlot: new Map(App.matSlot) };
  App.slots = new Map(); App.matSlot.clear(); App.activeSlot = null;
  App.meshes.clear();
  var tri = function(){ return new Float32Array(9); };
  App.geomData = [{ name: "jet_flame", mat: "jet_flame_mat", position: tri() },
                  { name: "flame_gun", mat: "gun_mat", position: tri() }];
  // The stock flame: orange under alpha 0 on the left half, a white ring (alpha 255) on the right.
  App.decoded.set("jet_flame_diamonds", sheet("jet_flame_diamonds", function(x){ return x < N / 2 ? [200, 90, 10, 0] : [255, 255, 255, 255]; }));
  // gunfire: flashes on black and alpha 0 across the whole sheet
  App.decoded.set("gunfire", sheet("gunfire", function(){ return [180, 120, 60, 0]; }));
  GameDB.stems = new Map([["jet_flame_diamonds", {}], ["gunfire", {}]]);
  var fm = { cls: "aces_weapon_fire", slots: { t0: "jet_flame_diamonds" } }, gm = { cls: "aces_weapon_fire", slots: { t0: "gunfire" } };
  var bind = { materials: [fm, gm], map: new Map() };
  bind.map.set(descMatName(fm).toLowerCase(), { c: "jet_flame_diamonds" });
  bind.map.set(descMatName(gm).toLowerCase(), { c: "gunfire" });
  bind.map.set("jet_flame_mat", { c: "jet_flame_diamonds" });
  bind.map.set("gun_mat", { c: "gunfire" });
  var stems = new Set(["jet_flame_diamonds", "gunfire"]);

  // (1) the slot, from the desc, through the real path
  EffectMat.bindSheets(bind);
  addTextureOnlySlots(bind, stems);
  var fs = App.slots.get("jet_flame_diamonds"), gs = App.slots.get("gunfire");
  o.slot = { has: !!fs, missing: fs && fs.missing, noGeom: fs && fs.noGeom, role: fs && slotRole(fs), gun: !!gs };
  // (2) the row names it
  refreshSlotList();
  var rows = [].slice.call(document.querySelectorAll("#slotList .rowitem.slot"));
  var rowOf = function(id){ return rows.find(function(r){ var n = r.querySelector(".nm"); return n && n.textContent === id; }); };
  var fr = rowOf("jet_flame_diamonds"), gr = rowOf("gunfire");
  o.row = { sz: fr ? fr.querySelector(".sz").textContent : null, title: fr ? fr.title : null,
            gun: gr ? gr.querySelector(".sz").textContent : null };

  // (3) the flame's material wears the slot's own textures
  var geo = new THREE.PlaneGeometry(2, 2);
  var mesh = new THREE.Mesh(geo, makeMaterial("jet_flame_mat", "jet_flame", geo));
  mesh.name = "jet_flame"; mesh.userData.mat = "jet_flame_mat"; mesh.userData.effect = true;
  var gmesh = new THREE.Mesh(geo, makeMaterial("gun_mat", "flame_gun", geo));
  gmesh.name = "flame_gun"; gmesh.userData.mat = "gun_mat"; gmesh.userData.effect = true;
  var m = mesh.material;
  o.mat = { map: m.map === fs.tex, alpha: !!fs.texCov && m.alphaMap === fs.texCov,
            add: m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.SrcAlphaFactor && m.blendDst === THREE.OneFactor,
            alphaKept: m.blendSrcAlpha === THREE.ZeroFactor && m.blendDstAlpha === THREE.OneFactor, dw: m.depthWrite,
            gunMap: gmesh.material.map === (gs && gs.tex), gunNoAlpha: !gmesh.material.alphaMap };

  // (4) what it draws, rendered by the page's own renderer: left column and right column of the quad
  var scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 1;
  var rt = new THREE.WebGLRenderTarget(16, 16);
  var shoot = function(msh){
    scene.children.slice().forEach(function(c){ scene.remove(c); });
    scene.add(msh);
    var prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
    var px = new Uint8Array(16 * 16 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 16, 16, px);
    renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca);
    var at = function(x, y){ var i = (y * 16 + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    return { left: at(3, 8), right: at(12, 8) };
  };
  App.meshes.set("jet_flame", mesh); App.meshes.set("flame_gun", gmesh);
  o.stock = shoot(mesh);
  // A skin's sheet over the stock one, the way SkinLoad puts it in: green, opaque, on the LEFT half,
  // alpha 0 on the right. rebuildMaterials is what the app runs when a sheet changes.
  App.skinDecoded = new Set(["jet_flame_diamonds"]);
  fillSlotAlbedo(fs, sheet("jet_flame_diamonds", function(x){ return x < N / 2 ? [0, 220, 0, 255] : [255, 255, 255, 0]; }), "jet_flame_diamonds");
  rebuildMaterials();
  o.skin = shoot(App.meshes.get("jet_flame"));
  o.skinMat = App.meshes.get("jet_flame").material.map === fs.tex;
  // An edit to the colour sheet: blue over the left half of the base, recomposited. No material is
  // rebuilt and nothing is read back — the material samples the sheet the 2-D view paints into.
  var before = App.meshes.get("jet_flame").material;
  var g2 = fs.baseC.getContext("2d"); g2.fillStyle = "#0000ff"; g2.fillRect(0, 0, N / 2, N);
  compositeSlot(fs);
  o.edit = shoot(App.meshes.get("jet_flame"));
  o.sameMat = App.meshes.get("jet_flame").material === before;
  o.gunShot = shoot(App.meshes.get("flame_gun"));

  // (5) the export: behind the gate, the community skins' exact block
  App.gateOpen.add("protected");
  expOpt(fs, "c").off = false;                    // and ticked, as the user does once the gate is open
  var items = collectExports(true).filter(function(i){ return i.slot === fs; });
  var plan = buildExportPlan(items, { estimate: true });
  o.exp = { n: items.length, kind: items[0] && items[0].kind, blk: plan.blkText,
            rule: validateExport(plan).filter(function(r){ return r.id === "protected"; }).map(function(r){ return r.level + "|" + r.title + "|" + r.detail; }).join("\\n") };
  // (6) DXT5 whatever the format setting (owner, 2026-10-24): the owner's usual preset is lossless,
  // and the texture's own format box can say RGBA8 or TGA too
  var presetWas = $("expPreset").value;
  $("expPreset").value = "lossless";
  o.dxt = {};
  ["", "rgba8", "tga"].forEach(function(f){
    expOpt(fs, "c").fmt = f;
    var its = collectExports(true).filter(function(i){ return i.slot === fs; });
    var pl = buildExportPlan(its, { estimate: true });
    var real = collectExports(true).filter(function(i){ return i.slot === fs; });
    ExportCollect.override(real);
    o.dxt[f || "preset"] = (pl.items[0] && pl.items[0].fileName) + "|" + (pl.items[0] && pl.items[0].fmt) + "|" + (real[0] && real[0].fmtOverride);
  });
  expOpt(fs, "c").fmt = "";
  $("expPreset").value = presetWas;
  // the validator, handed a flame sheet that would go out as RGBA8
  o.dxtRule = validateExport({ cls: "air", mode: "replace_tex", rank: 7, units: ["f-4e"], formats: { c: "rgba8", n: "rgba8" },
    camoStems: [], estimated: true, pins: [], blkText: 'name:t="user"\\n',
    items: [{ fileName: "jet_flame_diamonds.dds", fromStem: "jet_flame_diamonds", kind: "c", w: 2048, h: 2048, role: "effect", fmt: "rgba8", bytes: 16777344 }] })
    .filter(function(r){ return r.id === "flamefmt"; }).map(function(r){ return r.level + "|" + r.title; }).join(",");
  App.gateOpen.delete("protected");
  o.locked = collectExports(true).filter(function(i){ return i.slot === fs && !i.off; }).length;

  rt.dispose();
  App.meshes.clear(); was.meshes.forEach(function(v, k){ App.meshes.set(k, v); });
  App.slots = was.slots; App.geomData = was.geom; App.activeSlot = was.active; GameDB.stems = was.stems;
  App.skinDecoded = new Set();
  App.matSlot.clear(); was.matSlot.forEach(function(v, k){ App.matSlot.set(k, v); });
  App.matEffect.clear(); was.eff.forEach(function(v, k){ App.matEffect.set(k, v); });
  App.gateOpen.clear(); was.gate.forEach(function(v){ App.gateOpen.add(v); });
  App.decoded.clear(); was.decoded.forEach(function(v, k){ App.decoded.set(k, v); });
  return o;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAIL: " + r.reason); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }
const dark = c => c[0] < 8 && c[1] < 8 && c[2] < 8;
const s = c => c.join(",");

console.log("\n=== the vehicle's flame slot ===");
R.is(o.slot.has && !o.slot.missing && o.slot.noGeom && o.slot.role === "effect" && o.slot.gun,
  `the desc's flame material gives the vehicle a slot for jet_flame_diamonds, filled from the game, off the mesh, an effect sheet (${JSON.stringify(o.slot)})`);
R.is(/jet flame/.test(o.row.sz || "") && !/2D only/.test(o.row.sz || ""),
  `its row says it is the jet flame, not "2D only" (${o.row.sz})`);
R.is(/jet flame|jet-flame/i.test(o.row.title || "") && !/tank tracks/.test(o.row.title || ""),
  `its tooltip says what it is and where it shows, not that it belongs to tank tracks (${o.row.title})`);
R.is(/gun flash/.test(o.row.gun || ""), `the gunfire sheet's row says it is the gun flash (${o.row.gun})`);

console.log("\n=== the flame is drawn from that slot ===");
R.is(o.mat.map && o.mat.alpha, "the flame's material samples the slot's own colour sheet, weighted by the slot's coverage (the sheet's alpha)");
R.is(o.mat.add && o.mat.alphaKept && o.mat.dw === false,
  "added as rgb·a, alpha left alone (Shot's transparent target), no depth written");
R.is(o.mat.gunMap && o.mat.gunNoAlpha, "the gunfire sheet, alpha 0 everywhere, is its slot's colour with no coverage — drawn by colour, as before");
R.is(dark(o.stock.left) && o.stock.right[0] > 200 && o.stock.right[1] > 200,
  `stock: the orange under alpha 0 adds nothing (${s(o.stock.left)}), the ring shows (${s(o.stock.right)})`);
R.is(o.skin.left[1] > 150 && o.skin.left[0] < 8 && o.skin.left[2] < 8 && dark(o.skin.right) && o.skinMat,
  `a skin's sheet replaces the stock one on the flame: its green shows (${s(o.skin.left)}), the stock ring under its alpha 0 is gone (${s(o.skin.right)})`);
R.is(o.edit.left[2] > 150 && o.edit.left[1] < 8 && o.sameMat,
  `an edit to the sheet shows on the flame as it is composited, with no material rebuilt (${s(o.edit.left)})`);
R.is(o.gunShot.left[0] > 100 && o.gunShot.left[1] > 30, `the gun flash shows by colour (${s(o.gunShot.left)})`);

console.log("\n=== the export ===");
R.is(o.exp.n === 1 && o.exp.kind === "c", "with the gate open, the edited flame sheet is one texture out");
R.is(o.exp.blk.includes('replace_tex{\n  from:t="jet_flame_diamonds*"\n  to:t="jet_flame_diamonds.dds"\n}'),
  "the .blk carries the community skins' exact block: replace_tex from jet_flame_diamonds* to jet_flame_diamonds.dds");
R.is(/^error\|/.test(o.exp.rule) && /UserSkins/.test(o.exp.rule) && /WT Live/.test(o.exp.rule),
  `the validator keeps it from a published skin and says the game shows it from UserSkins:\n        ${o.exp.rule.replace(/\n/g, "\n        ")}`);
R.is(Object.values(o.dxt).every(v => v === "jet_flame_diamonds.dds|bc3|bc3"),
  `the flame sheet is written DXT5 whatever the preset (lossless) or its own format box says — preset, RGBA8, TGA: ${JSON.stringify(o.dxt)}`);
R.is(/^error\|/.test(o.dxtRule), `the validator refuses a flame sheet that would go out as anything but DXT5 (${o.dxtRule})`);
R.is(o.locked === 0, "with the gate locked again the flame sheet stays out of the archive");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
