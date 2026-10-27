// A jet flame is drawn from the game's own sheet, added the way the game adds it (2026-09-25).
//
// WHY THIS EXISTS. Every effect quad used to wear one made-up gradient, faded to black across the
// whole texture — but a flame only uses a strip of its atlas (u 0–0.99, v 0.76–0.99 of
// `jet_flame_diamonds` on the F-14A, F-16A and F/A-18A), so the fade never reached a quad's edge and
// the plume cards ended on hard white borders. The fix draws the sheet the model's desc names, and
// how to add it was read off the install's own sheets (see EffectMat in view3d/meshes.js):
//
//   * the stock `jet_flame_diamonds` is flat orange under alpha 0 with alpha masking the rings in —
//     drawn by colour alone the cards would be solid orange slabs, so colour is weighted by alpha;
//   * `gunfire` has alpha 0 across the whole sheet — weighted by alpha no muzzle flash would ever
//     show, so a sheet with no alpha at all is drawn by colour;
//   * the texture is a DataTexture, which is not flipped on upload, while the model's UVs were
//     flipped for a flipped canvas — so its rows go in bottom-up, or the atlas is read upside down;
//   * a flame has no slot, so gcDecoded would release its sheet before the scene is built.
//
// Each of those is one check below. Synthetic sheets, so it needs no install.
//
// Usage: node tools/t89_effects.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var o = {};
  var sheetOf = function(w, h, fill){
    var px = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) px.set(fill, i * 4);
    return { width: w, height: h, mips: [{ w: w, h: h, rgba: px }] };
  };
  var put = function(dec, x, y, v){ dec.mips[0].rgba.set(v, (y * dec.width + x) * 4); };
  // texel (x, y) of the IMAGE, read back out of the bottom-up upload buffer
  var at = function(tex, x, y){ var W = tex.image.width, H = tex.image.height, i = ((H - 1 - y) * W + x) * 4;
    return [].slice.call(tex.image.data, i, i + 4).join(","); };
  var decodedWas = new Map(App.decoded), geomWas = App.geomData;

  // (1) shaped like the stock jet_flame_diamonds: orange under alpha 0, the rings masked in by alpha
  var fl = sheetOf(8, 4, [200, 90, 10, 0]);
  put(fl, 6, 0, [250, 220, 180, 255]);            // a ring texel in the image's TOP row
  put(fl, 5, 3, [200, 100, 0, 128]);              // a half-covered one in its bottom row
  App.decoded.set("t89_flame", fl);
  var t = EffectMat.sheet("t89_flame");
  o.flame = { size: t.image.width + "x" + t.image.height, ring: at(t, 6, 0), half: at(t, 5, 3), under: at(t, 0, 0),
              orangeLeft: 0, alpha255: true, cached: EffectMat.sheet("t89_flame") === t, srgb: t.encoding === THREE.sRGBEncoding };
  for (var y = 0; y < 4; y++) for (var x = 0; x < 8; x++) {
    var v = at(t, x, y).split(",").map(Number);
    if (v[3] !== 255) o.flame.alpha255 = false;
    if (!((x === 6 && y === 0) || (x === 5 && y === 3)) && (v[0] || v[1] || v[2])) o.flame.orangeLeft++;
  }
  // (2) shaped like gunfire: flashes on black and alpha 0 across the entire sheet
  var gf = sheetOf(4, 4, [0, 0, 0, 0]);
  put(gf, 1, 2, [180, 120, 60, 0]);
  App.decoded.set("t89_gunfire", gf);
  o.gun = at(EffectMat.sheet("t89_gunfire"), 1, 2);
  // (3) a 2048-wide sheet comes down to 1024, each texel the mean of its 2x2 of rgb·a
  var big = sheetOf(2048, 4, [0, 0, 0, 0]);
  put(big, 0, 0, [200, 200, 200, 255]); put(big, 1, 0, [255, 255, 255, 0]);
  App.decoded.set("t89_big", big);
  var bt = EffectMat.sheet("t89_big");
  o.big = { size: bt.image.width + "x" + bt.image.height, first: at(bt, 0, 0) };

  // (4) the desc says which sheet each effect material draws — by name, and by index for "unknown_N"
  App.geomData = [{ name: "jet_flame", mat: "jet_flame_mat" }, { name: "fuselage", mat: "body" }, { name: "flame_gun", mat: "unknown_3" }];
  EffectMat.bindSheets({ map: new Map([["jet_flame_mat", { c: "Jet_Flame_Diamonds" }], ["body", { c: "f_16a_c" }], ["#3", { c: "gunfire" }]]) });
  o.bound = [...App.matEffect].map(function(e){ return e[0] + "=" + e[1]; }).join(",");
  // (5) gcDecoded keeps a flame's sheet — it has no slot — and still drops what nothing uses
  App.decoded.set("jet_flame_diamonds", fl);
  for (var k = 0; k < 70; k++) App.decoded.set("t89_junk_" + k, gf);
  gcDecoded();
  o.gc = { kept: App.decoded.has("jet_flame_diamonds"), dropped: !App.decoded.has("t89_junk_0") };
  // (6) the material: the sheet, added, at full strength; the stand-in only when there is no sheet
  var m = EffectMat.make("jet_flame_mat");
  o.mat = { sheet: m.map === EffectMat.sheet("jet_flame_diamonds"),
            add: m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor,
            alphaKept: m.blendSrcAlpha === THREE.ZeroFactor && m.blendDstAlpha === THREE.OneFactor,
            op: m.opacity, dw: m.depthWrite, effect: !!m.userData.effect };
  o.fallback = EffectMat.make("no_such_material").map === EffectMat.gradient();
  m.dispose();

  App.geomData = geomWas; App.matEffect.clear();
  App.decoded.clear(); decodedWas.forEach(function(v, k){ App.decoded.set(k, v); });
  return o;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAIL: " + r.reason); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }

console.log("\n=== the game's flame sheet, weighted by its own alpha ===");
const F = o.flame;
R.is(F.ring === "250,220,180,255" && F.half === "100,50,0,255",
  `a ring texel is drawn at full colour (${F.ring}) and a half-covered one at half (${F.half}) — colour times alpha, which is what the material adds`);
R.is(F.orangeLeft === 0 && F.under === "0,0,0,255",
  `the orange bled under alpha 0 adds nothing (${F.orangeLeft} texels left of it) — drawn by colour alone the plume cards were solid slabs`);
R.is(F.alpha255 && F.size === "8x4" && F.srgb, `every texel's alpha is 255, the size is kept below 1024 (${F.size}), and it is decoded as sRGB`);
R.is(F.cached, "a second ask for the same decoded sheet returns the same texture, not a rebuild");
R.is(o.gun === "180,120,60,255", `a sheet with no alpha anywhere is drawn by colour (${o.gun}) — or gunfire, alpha 0 across the whole sheet, would never show`);
R.is(o.big.size === "1024x2" && o.big.first === "50,50,50,255",
  `a 2048-wide sheet comes down to ${o.big.size}, each texel the mean of rgb·a over its 2x2 (${o.big.first}) — the white under alpha 0 beside it does not leak in`);

console.log("\n=== which sheet, and keeping it ===");
R.is(o.bound === "jet_flame_mat=jet_flame_diamonds,unknown_3=gunfire",
  `the desc's t0 names each effect material's sheet, by name and by index, lower-cased as App.decoded is — and the airframe is not an effect (${o.bound})`);
R.is(o.gc.kept && o.gc.dropped, "gcDecoded keeps a flame's sheet although no slot holds it, and still releases what nothing uses");
R.is(o.mat.sheet && o.mat.add && o.mat.op === 1 && o.mat.dw === false && o.mat.effect,
  "the material wears that sheet, added one-to-one (the alpha is already in it), writing no depth");
R.is(o.mat.alphaKept,
  "and it leaves alpha as it was — Shot renders into a transparent target, where an additive alpha would put every card in the PNG as an opaque black slab");
R.is(o.fallback, "a material the desc names no sheet for (an imported .obj) keeps the stand-in gradient");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
