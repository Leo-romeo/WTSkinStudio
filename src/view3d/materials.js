// ---- Stock paint (the game's camo slot) ----
// WT's dynamic_masked_* shaders paint a vehicle from a second texture: t0 is a dark, highly
// detailed base sheet, t1 is a near-flat colour ("camo_hellgrau_50" = light grey 50,
// "camo_brown_wood" = deck planks, "ger_camo_bronzegruen" = the Bundeswehr green). One model
// uses several of them — a ship's hull, deck and boot topping are three different paints over
// the SAME albedo — which is why rendering t0 alone made every ship and tank look rusty brown.
// The preview binds that second sheet for real and does the game's own blend — see applyPaintTint.
function srgbToLinear(c){ return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
// The camouflage colour a slot sits over, as a CSS colour. This is what the *export* will pin, not
// simply the stock t1 — the 2-D view and the viewport have to agree with the .blk, which is exactly
// what they did not do while the exporter silently shipped flat white. Null for aircraft, which
// have no camo slot at all.
function slotCamoColor(slot){
  if (!slot || !App.matPaint) return null;
  for (const [mat, stem] of App.matPaint) {
    if (App.matSlot.get(mat) !== slot.id) continue;
    const mode = camoBaseMode();
    if (mode === "color") { const c = camoBaseColor(); return "rgb(" + c.join(",") + ")"; }
    if (mode === "white") return "rgb(255,255,255)";
    if (mode === "grey") return "rgb(128,128,128)";
    const c = App.paintColor.get(stem);
    if (c) return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
  }
  return null;
}
// The old preview multiplied the material colour by paint/albedo brightness. A multiply cannot
// change hue: a rust-brown detail sheet times a grey-green paint is still rust-brown, which is
// exactly why every tank and ship still looked rusty with the option on. What the game actually
// does is use the detail sheet for LIGHT and the camo texture for COLOUR, so the preview now
// does the same in the shader: keep the sheet's luminance, take the paint's chroma.
// The camouflage is not a "before you started painting" preview — it is the layer the game puts
// *under* a ground or naval skin for ever. `set_tex … camo_skin_tex` writes the sheet into the
// user-skin slot and the shader blends it over the player's scalable camouflage using the sheet's
// own ALPHA: opaque covers the camo, black lets it through, greys are the worn edges and bare
// chassis (the CDK: "By default the alpha channel of the texture is black … If we make the alpha
// channel white … this texture will completely cover our scalable camouflage").
// So the tint stays on after the first stroke and the coverage mask decides where it shows.
// Aircraft reach none of this: their albedo IS the paint, they have no t1, so `col` is null.
function paintTintFor(matName, slot, camoUv){
  if (!App.paintTint || !slot) return null;
  const stem = App.matPaint.get(matName);
  if (!stem) return null;
  const col = App.paintColor.get(stem);
  if (!col) return null;
  return { stem, col, k: App.paintStrength, tex: camoPreviewTexture(stem),
    // The camouflage is sampled through the part's own tc1 where the model has one (4.50 (6)) —
    // the albedo's UV lays a pattern across its islands, which a flat stock colour never showed.
    camoUv: !!camoUv,
    stockTex: stockPreviewTexture(slot), maskTex: paintMaskTexture(slot),
    edited: chanEdited(slot, "color"),
    // Whether the export will SHIP the sheet's alpha (ROADMAP 3.29): the same decision the
    // exporter takes, so what the viewport blends through is what the game will get. A set_tex
    // skin ships opaque unless a wear mask was painted or the user asked; the viewport shows the
    // camouflage through the alpha only then.
    keepAlpha: ExportCollect.wantsMask(ExportCollect.ctx(true), slot) };
}
// The vehicle's own sheet and its own paint mask, as textures. Built once per slot and only for
// ground/naval slots that actually have a camo — they are the two halves `set_tex` leaves in the
// game when a skin is installed.
function stockPreviewTexture(slot){
  if (!slot.stockC) return null;
  if (!slot.texStock) {
    slot.texStock = new THREE.CanvasTexture(slot.stockC);
    slot.texStock.wrapS = slot.texStock.wrapT = THREE.RepeatWrapping;
    slot.texStock.encoding = THREE.sRGBEncoding;
  }
  return slot.texStock;
}
function paintMaskTexture(slot){
  if (!slot.stockA || !slot.stockC) return null;
  if (!slot.texPaintMask) {
    const w = slot.stockC.width, h = slot.stockC.height;
    const c = mkCanvas(w, h), img = new ImageData(w, h);
    for (let i = 0, n = w * h; i < n; i++) {
      img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = slot.stockA[i];
      img.data[i*4+3] = 255;
    }
    ctx2d(c).putImageData(img, 0, 0);
    slot.texPaintMask = new THREE.CanvasTexture(c);
    slot.texPaintMask.wrapS = slot.texPaintMask.wrapT = THREE.RepeatWrapping;
    slot.texPaintMask.encoding = THREE.LinearEncoding;
  }
  return slot.texPaintMask;
}
// ---- What the vehicle actually sits on, as a texture ----
// The camo the *export* pins is what the player will see, so the preview samples that same sheet:
// the vehicle's own camo by default, a flat sheet when the user has chosen a solid base colour,
// the loaded skin's own pin when it carried one. Without this the viewport showed the stock olive
// while the .blk shipped flat white, so the preview was lying about the finished skin.
// Cached per stem + mode; the sheets are ≤256² so rebuilding one is trivial.
function camoPreviewSheet(stem){
  const mode = camoBaseMode();
  if (mode === "tile") {                            // the tile where it pins; the stock camo where it does not
    if (!CamoTile.pins(stem)) { const t = App.paintTex.get(stem); return t ? { key: "stock:" + stem, sheet: t } : null; }
    return null;                                     // camoPreviewTexture binds the tile's live texture instead
  }
  if (mode === "color") return { key: "color:" + $("expCamoColor").value, sheet: flatCamoSheet(camoBaseColor()) };
  if (mode === "white") return { key: "white", sheet: flatCamoSheet([255, 255, 255]) };
  if (mode === "grey") return { key: "grey", sheet: flatCamoSheet([128, 128, 128]) };
  const t = App.paintTex.get(stem);                 // "stock" and "keep" both show the real camo
  return t ? { key: "stock:" + stem, sheet: t } : null;
}
const camoTexCache = new Map();
function camoPreviewTexture(stem){
  // A camouflage tile of your own is its slot's composite — the texture the 2-D view paints into, so
  // every stroke shows on the model the frame it lands, with no copy to keep in step.
  if (CamoTile.pins(stem)) return CamoTile.slot().tex;
  const got = camoPreviewSheet(stem);
  if (!got) return null;
  const hit = camoTexCache.get(stem);
  if (hit && hit.key === got.key) return hit.tex;
  if (hit && hit.tex) hit.tex.dispose();
  const { width: w, height: h, rgba } = got.sheet;
  const c = mkCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;               // same decode the albedo gets, so the mix is honest
  camoTexCache.set(stem, { key: got.key, tex });
  return tex;
}
function clearCamoTexCache(){ for (const v of camoTexCache.values()) if (v.tex) v.tex.dispose(); camoTexCache.clear(); }
// ---- The blend the game does, done here ----
// dynamic_masked_tank / _ship layer TWO textures: the sheet in the user-skin slot (t0 / the skin)
// and the player's scalable camouflage (t1). The CDK states the rule outright: "By default the
// alpha channel of the texture is black, which means that this texture is completely transparent
// and does not affect the camouflage. If we make the alpha channel white … this texture will
// completely cover our scalable camouflage." So:
//
//     final = mix( camo, skin, skinAlpha )
//
// The old preview could not do that: it had only the camo's *average colour*, so it approximated
// with "keep the sheet's luminance, take the paint's chroma", which cannot show a flat camo through
// a transparent area and therefore hid exactly the mistake this app kept shipping — a sheet whose
// alpha had been flattened looked almost the same on screen as one with the mask intact. The real
// sheet is bound now, so an opaque skin looks opaque and a transparent one shows the camo, the same
// way the hangar will.
//
// It rides in on `emissiveMap`, which is a genuine per-material texture uniform in three.js r128
// and which nothing here uses (emissive stays black, so its own contribution is zero). Passing it
// through onBeforeCompile's `shader.uniforms` instead is what the earlier note about materials
// sharing uniform values was about — one model routinely uses several camo sheets at once.
// The scalar mix factor is still inlined, with the program cache key carrying it, for that reason.
function applyPaintTint(m, t){
  const f = v => v.toFixed(5);
  const on = App.coverageOn === false ? 0 : 1;
  // The skin's own alpha counts only when the export keeps it (see paintTintFor). Two flags, not
  // one: `on` is the user's "judge the colours flat" switch and covers the vehicle's paint mask
  // too; `skinA` is what ships.
  const skinA = on && t.keepAlpha ? 1 : 0;
  const hasTex = !!t.tex, hasStock = !!(t.stockTex && t.maskTex);
  // Fallback for a camo with no pixels read (an .obj import): the flat average colour.
  const c = new THREE.Color(t.col[0] / 255, t.col[1] / 255, t.col[2] / 255);
  if (c.convertSRGBToLinear) c.convertSRGBToLinear();
  const cuv = hasTex && t.camoUv;
  const key = (hasTex ? "t" : f(c.r) + "," + f(c.g) + "," + f(c.b)) +
    "," + f(t.k) + "," + on + skinA + "," + (hasStock ? 1 : 0) + "," + (t.edited ? 1 : 0) + (cuv ? ",c1" : "");
  m.userData.painted = true;
  m.customProgramCacheKey = () => "wtcamo:" + key;
  m.onBeforeCompile = shader => {
    // t1 through tc1 (4.50 (6)): a varying of our own, fed from the `camoUv` attribute buildScene
    // sets on a part whose vertex format carries one. Its scale and rotation are baked into the
    // attribute (CamoTile.applyView), so the program never changes while a slider moves.
    if (cuv) {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 camoUv;\nvarying vec2 vWtCamoUv;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vWtCamoUv = camoUv;");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vWtCamoUv;");
    }
    // ---- What a ground vehicle's surface is actually made of ----
    // Three sheets, not two. `set_tex … param:t="camo_skin_tex"` does NOT replace the vehicle's
    // `*_c`; it hangs a paint sheet beside it. So in game the shader has:
    //
    //   stock  *_c   RGB = the bare, unpainted material (primer, rubber, tool handles, tracks)
    //                A   = where paint covers it — scaled by the vehicle's condition slider
    //   camo   t1    the player's scalable camouflage, or your skin in the camo_skin_tex slot
    //
    //   final = mix( stockRGB, paint, stockA )      paint = mix( camo, yourSheet, yourSheetAlpha )
    //
    // The app had this the wrong way round — it blended `mix(camo, sheet, alpha)`, i.e. it showed
    // the bare sheet exactly where the vehicle is *painted*. A stock M1A2 came out as blotchy bare
    // metal on every armour plate: worse than 100 % wear, and nothing you can see in game at 0 %.
    // Compositing the real 2048² sheet both ways settles it — mix(stock, camo, A) is the olive tank
    // with its bolts, welds and tools showing; the other way is rust.
    //
    // The stock sheet rides in on `lightMap` and its mask on `aoMap`, both with their intensities
    // at zero so neither contributes light of its own. Those are the only two spare per-material
    // texture slots three.js r128 has, and both sample vUv2 — which buildScene sets to the same
    // coordinates as vUv.
    const camo = hasTex
      ? "emissiveMapTexelToLinear( texture2D( emissiveMap, " + (cuv ? "vWtCamoUv" : "vUv") + " ) ).rgb"
      : "vec3( " + f(c.r) + ", " + f(c.g) + ", " + f(c.b) + " )";
    // Until you have painted anything, the paint IS the camouflage — showing the stock detail sheet
    // as if it were your paint is what made a freshly loaded tank look unpainted.
    const paint = t.edited ? "diffuseColor.rgb" : "wtCamo";
    // Both branches blend the camouflage through the sheet's alpha — paint = mix(camo, skin, skin.a),
    // the game's own rule (wt-formats) — and the stock branch then lays that paint over the bare
    // material through the vehicle's mask. Until 2026-09-20 the stock branch skipped the first
    // mix and showed the sheet at full cover whatever its alpha, so "Alpha: keep" and "opaque"
    // looked the same on every game-loaded tank (found building 3.29's alpha preview).
    const body = hasStock
      ? "  vec3 wtStock = lightMapTexelToLinear( texture2D( lightMap, vUv2 ) ).rgb;\n" +
        "  float wtCov = mix( 1.0, diffuseColor.a, " + f(skinA) + " );\n" +
        "  vec3 wtPaint = mix( wtCamo, " + paint + ", wtCov );\n" +
        "  float wtPaintMask = mix( 1.0, texture2D( aoMap, vUv2 ).r, " + f(on) + " );\n" +
        "  vec3 wtOut = mix( wtStock, wtPaint, wtPaintMask );\n"
      // No stock sheet (a raw .obj, or a slot that never came from the game): the same
      // camo_skin_tex rule on its own — your sheet's alpha covers the camouflage.
      : "  float wtCov = mix( 1.0, diffuseColor.a, " + f(skinA) + " );\n" +
        "  vec3 wtOut = mix( wtCamo, diffuseColor.rgb, wtCov );\n";
    shader.fragmentShader = shader.fragmentShader.replace("#include <alphamap_fragment>",
      "#include <alphamap_fragment>\n{\n" +
      "  vec3 wtCamo = " + camo + ";\n" + body +
      "  diffuseColor.rgb = mix( diffuseColor.rgb, wtOut, " + f(t.k) + " );\n" +
      "  diffuseColor.a = 1.0;\n}");
  };
}
// ---- reading the game's surface sheets without repacking them ----
// Two one-line edits to stock r128 chunks, and they are arithmetically the same thing the CPU
// repack used to compute — only the place changed, which is why the render is unmoved:
//
//   * `normal_fragment_maps` reads all three bytes of the normal map and expects Z in blue. The
//     game's `_n` has no Z: it packs normal X in alpha and Y in green (`NSheet`), which the importer
//     lands in red and green with blue left at a constant 128. So take .xy and derive Z the way a
//     two-component normal map always is — sqrt(1 - x² - y²), which is exactly the line the repack
//     ran per texel. And Y is turned: the game's high Y leans toward the sheet's BOTTOM row
//     (DirectX's sense, ROADMAP 1.24), while three.js's tangent frame points +Y up the texture, the
//     way the model's UVs run (`perturbNormal2Arb` takes it from dFdy of vUv). Measured in t169: a
//     texel leaning toward the bottom row, lit from below, rendered 276 against 1236 lit from
//     above before the turn — lit as if it leaned up. The frame comes from the screen-space
//     derivatives, so a mirrored UV island turns with it, as the game's does (the owner's check
//     of 2026-10-24 on the F-4E's shared under-wing strip).
//   * `roughnessmap_fragment` multiplies by the green byte. The sheet holds SMOOTHNESS, and
//     roughness is its inverse (CLAUDE.md §1) — the repack used to store `255 - smoothness`.
//
// `metalnessmap_fragment` needs no edit at all: it reads blue, and the metal sheet is greyscale.
//
// Composed onto whatever applyPaintTint already installed rather than replacing it, because a
// ground vehicle's material has both. The cache key carries both too — three.js r128 shares a
// compiled program between materials whose keys match, and these edits change the source.
function applySurfaceMaps(m, hasNormal, hasRough){
  const prevCompile = m.onBeforeCompile;
  // Only a key applyPaintTint set is worth carrying. three.js's DEFAULT customProgramCacheKey
  // returns `onBeforeCompile.toString()`, which after this wrapper is the same long string for
  // every material and says nothing — appending it made the key a page of source.
  const prevKey = m.userData.painted ? m.customProgramCacheKey : null;
  const key = "wtsurf:" + (hasNormal ? "n" : "") + (hasRough ? "r" : "");
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) + "|" : "") + key;
  m.onBeforeCompile = shader => {
    if (prevCompile) prevCompile.call(m, shader);
    // The shader handed to onBeforeCompile still has its `#include <name>` lines UNRESOLVED —
    // three.js expands them afterwards, in WebGLProgram. Replacing the chunk's own source text
    // therefore matches nothing and silently does nothing, which is exactly what happened first
    // time: the normal map was read as .xyz with blue stuck at 128, so every surface normal lay
    // flat in the tangent plane, and roughness came out as smoothness — the model rendered
    // visibly brighter. So swap the INCLUDE for the chunk's text with the edit already in it.
    const patch = (name, from, to) => {
      const chunk = THREE.ShaderChunk[name];
      if (!chunk || chunk.indexOf(from) < 0) return;          // r128 moved: leave the stock chunk
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <" + name + ">", chunk.replace(from, to));
    };
    if (hasNormal) patch("normal_fragment_maps",
      "vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;",
      "vec3 mapN = vec3( texture2D( normalMap, vUv ).xy * 2.0 - 1.0, 0.0 );" +
      " mapN.y = -mapN.y; mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );");
    if (hasRough) patch("roughnessmap_fragment",
      "roughnessFactor *= texelRoughness.g;",
      "roughnessFactor *= 1.0 - texelRoughness.g;");
  };
}
// ---- the rainbow sheen on coated glass (ROADMAP 4.41) ----
// The game's cockpit glass shows a rainbow at grazing angles: thin-film interference, a coating a
// few hundred nanometres thick reflecting each wavelength in or out of phase with itself depending
// on how obliquely the eye looks through it. It is driven by the VIEW ANGLE, not by a texture, so
// it is a shader term and not a slot. three.js r128 has no `iridescence` on MeshPhysicalMaterial
// (that arrived in r139, and the pin stays — CLAUDE.md §4), so the term is written in here:
//   the optical path for a film of index n and thickness d seen at incidence θ is 2·n·d·cosθt
//   (Snell for θt), each of red, green and blue at its own wavelength is 0.5 + 0.5·cos(2π·path/λ + π)
//   (the π is the phase flip at the denser boundary), and the whole thing is weighted by
//   (1 − N·V)^1.5 so it lives at the edges and vanishes face-on, where the coating reads as tint.
// Added as emitted light so it composes over the tint the material already has, at the material's
// own opacity. The numbers — n = 1.38, d = 420 nm — are a magnesium-fluoride-thick film, chosen
// because they cycle magenta → green → blue across a canopy's curvature the way the hangar does;
// they are inlined into the source with the strength, and the cache key carries them, because r128
// shares uniform objects between materials on one program (wt-canvas).
function applyIridescence(m, strength){
  const f = v => v.toFixed(5);
  m.customProgramCacheKey = () => "wtirid:" + f(strength);
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n{\n" +
      "  vec3 wtV = normalize( vViewPosition );\n" +
      "  float wtNdV = clamp( dot( normal, wtV ), 0.0, 1.0 );\n" +
      "  float wtSin2 = ( 1.0 - wtNdV * wtNdV ) / ( 1.38 * 1.38 );\n" +
      "  float wtCosT = sqrt( max( 0.0, 1.0 - wtSin2 ) );\n" +
      "  float wtPath = 2.0 * 1.38 * 420.0 * wtCosT;\n" +
      "  vec3 wtFilm = 0.5 + 0.5 * cos( 6.2831853 * wtPath / vec3( 650.0, 550.0, 450.0 ) + 3.1415927 );\n" +
      "  float wtEdge = pow( 1.0 - wtNdV, 1.5 );\n" +
      "  totalEmissiveRadiance += wtFilm * ( " + f(strength) + " * wtEdge );\n" +
      "}");
  };
}
// Steps of makeMaterial on one object (ROADMAP 2.4): the glazing branch was inlined and took the
// factory over the ceiling once 4.15, 3.29 and 4.41 had each added to it.
const Mats = {
  // A material the game gives no texture at all — see the comment above makeMaterial's call.
  glass(glass, lname, meshName){
    const canopy = /canopy|windshield|cockpit|kabin/.test(lname + " " + String(meshName || "").toLowerCase());
    // The coating LUT's NAME, which is what the game varies between these materials — the shader
    // itself does considerably more and matching it exactly is not the bar (§0.3): the bar is that
    // it reads as the glass it is rather than as white plastic. A rainbow coating is the reported
    // case and it is by far the commonest (168 of the 376, plus 47 rainbow_light and 33
    // rainbow_lens_mirror); gold is 58, black 7.
    const coat = String((glass && glass.coat) || "").toLowerCase();
    const look = /rainbow|optic/.test(coat) ? { color: 0x9fb6d8, metal: .55, rough: .06, op: .38 }
      : /gold/.test(coat) ? { color: 0xc9a15a, metal: .75, rough: .08, op: .45 }
      : /black|smoke/.test(coat) ? { color: 0x23262c, metal: .4, rough: .12, op: .66 }
      : canopy ? { color: 0x8fa8bd, metal: .1, rough: .05, op: .32 }
      : { color: 0x30363f, metal: .35, rough: .14, op: .62 };
    const gm = new THREE.MeshPhysicalMaterial({
      color: look.color, metalness: look.metal, roughness: look.rough,
      transparent: true, opacity: look.op,
      depthWrite: false, side: THREE.DoubleSide });
    // The rainbow coating IS the iridescence (ROADMAP 4.41): the game names the LUT after it.
    if (/rainbow|optic/.test(coat)) applyIridescence(gm, /lens|mirror/.test(coat) ? .55 : .4);
    return gm;
  },
  // A see-through shader WITH a sheet (ROADMAP 1.26) — `empty_glass` on a cockpit canopy,
  // `x_gauge_glass_c` over a gauge, `glass_dirt`: the sheet's colour through its own alpha.
  // `rebindMaterials` marks these in App.matGlass with `tex`, by the transfer bake's rule for what is
  // see-through (Transfer.GLASS), so the two cannot disagree. Measured on the F-16A's cockpit: its
  // canopy is drawn twice by the game's own model — dynamic_glass_tone with no sheet, and
  // dynamic_masked_glass_chrome with t0 = empty_glass, whose stock sheet is 64² at alpha 0
  // everywhere — and drawn opaque, the second copy hid the cockpit; a skin's picture on 0.7 % of an
  // otherwise alpha-0 empty_glass came up as an opaque canopy, and x_gauge_glass_c (512², mean alpha
  // 23, the same class, 1 085 materials in the install) covered the gauge faces. The colour is the
  // slot's live composite and the alpha its coverage sheet (fillSlotAlbedo keeps the albedo's alpha
  // there, not in the canvas), both real texture slots, so a stroke on the glass shows with nothing
  // rebuilt. No depth written, like the untextured glass above.
  seeThrough(slot, on){
    const m = new THREE.MeshStandardMaterial({
      map: on.color ? slot.tex : null, color: on.color ? 0xffffff : 0x9aa0aa,
      alphaMap: slot.texCov || null, transparent: true, depthWrite: false,
      metalness: .1, roughness: .1, side: THREE.DoubleSide });
    m.envMapIntensity = .5;
    return m;
  },
};
function makeMaterial(matName, meshName, geo){
  const lname = matBaseName(matName).toLowerCase();
  if (isEffectMat(meshName, matName)) return EffectMat.make(matName);
  const stem = App.matSlot.get(matName);
  const slot = stem ? App.slots.get(stem) : null;
  // Flat channel view: one map, unlit, across the whole model. Lighting and the camo preview
  // would both lie about what is actually stored in the texture, so neither applies here.
  // The Levels view: which level the GPU samples, as a colour (4.58 (b)).
  if (App.chanView === "levels") {
    const t = slot && LevelView.levelsTex(slot);
    if (!t) return new THREE.MeshBasicMaterial({ color: 0x1b1e24, side: THREE.DoubleSide, toneMapped: false });
    const lm = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false });
    return LevelView.on ? LevelView.lodBias(lm, LevelView.bias()) : lm;
  }
  if (App.chanView && App.chanView !== "shaded") {
    const t = slot && slot.chanTex && slot.chanTex[App.chanView];
    if (t) return new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: App.chanView === "color" });
    return new THREE.MeshBasicMaterial({ color: 0x1b1e24, side: THREE.DoubleSide, toneMapped: false });
  }
  // ---- glazing: a material the game gives no texture at all ----
  // What survives of it is the shader class, which is then also its name — "dynamic_glass_chrome",
  // "dynamic_glass_tone". A cockpit canopy wants the pale blue tint. A missile's or a guided
  // bomb's seeker window does NOT: it is the same class, and at 28 % pale blue it rendered as a
  // washed-out white nose (six of the F-4E's stores use it — Walleye, GBU-8, GBU-15, Maverick and
  // both Sidewinders). Anything that is not aircraft glazing gets dark smoked glass instead, and
  // neither writes depth any more — a 28 %-opaque surface that does hides whatever is behind it.
  // The SHADER CLASS first, and the name only after it (ROADMAP 4.15). A material's name cannot
  // always answer "is this glass" — 3.18 measured 376 materials across 230 models that are
  // `dynamic_glass_chrome` with no albedo, and most of them have no name at all — so a name test
  // missed exactly the ones this branch exists for, and they fell through to the flat "no texture"
  // fallback below: opaque, untinted, and reported as white canopies. `App.matGlass` is filled where
  // the desc entry is already in hand (`rebindMaterials`), which is the only place the class is
  // known without parsing the desc a second time.
  const glass = App.matGlass && App.matGlass.get(matName);
  if ((glass || /glass|canopy|chrome/.test(lname)) && (!slot || slot.missing)) return Mats.glass(glass, lname, meshName);
  if (!slot || !slot.tex) return new THREE.MeshStandardMaterial({ color: 0x777c86, metalness: .2, roughness: .7 });
  const on = App.chanOn || (App.chanOn = { color: true, smooth: true, metal: true, normal: true });
  if (glass && glass.tex && !App.manualBind.has(matName)) return Mats.seeThrough(slot, on);   // a hand bind is the user's sheet
  const p = { map: on.color ? slot.tex : null, metalness: 1, roughness: 1 };
  if (!on.color) p.color = 0x9aa0aa;
  // The game's three surface sheets, bound as they are. There is no repacked pair any more (see
  // refreshSurfaceTextures): the normal sheet holds X in red and Y in green, the smoothness sheet
  // is the inverse of roughness, and the metal sheet is grey — so the two conversions three.js
  // would otherwise need done on the CPU are done in the shader below instead, for free.
  if (slot.texCh && slot.texCh.normal) {
    if (on.normal) p.normalMap = slot.texCh.normal;
    if (on.smooth) p.roughnessMap = slot.texCh.smooth; else p.roughness = .6;
    if (on.metal) p.metalnessMap = slot.texCh.metal; else p.metalness = .12;
  } else { p.metalness = .15; p.roughness = .6; }
  const tint = on.color ? paintTintFor(matName, slot, geo && geo.attributes && geo.attributes.camoUv) : null;
  // The coverage sheet rides in as the alphaMap so the shader can read it without a uniform of
  // its own (three.js r128 shares onBeforeCompile uniform objects between materials on the same
  // program, which one model using several camouflages would trip over). Only bound where it
  // means something — a vehicle with a camo slot, with the preview switched on.
  if (tint && tint.keepAlpha && App.coverageOn !== false && slot.texCov) p.alphaMap = slot.texCov;
  // Three spare per-material texture slots carry the other two sheets the game has: emissiveMap =
  // the camouflage, lightMap = the vehicle's own (stock) albedo, aoMap = its paint mask. All three
  // contribute nothing of their own — emissive black, both intensities zero — they exist only so
  // applyPaintTint can sample them. See the comment there for the blend.
  if (tint && tint.tex) { p.emissiveMap = tint.tex; p.emissive = 0x000000; }
  if (tint && tint.stockTex && tint.maskTex) {
    p.lightMap = tint.stockTex; p.lightMapIntensity = 0;
    p.aoMap = tint.maskTex; p.aoMapIntensity = 0;
  }
  const m = new THREE.MeshStandardMaterial(p);
  if (tint) applyPaintTint(m, tint);
  if (p.normalMap || p.roughnessMap) applySurfaceMaps(m, !!p.normalMap, !!p.roughnessMap);
  if (LevelView.on) LevelView.lodBias(m, LevelView.bias());          // the game's screen (4.58 (b))
  m.side = THREE.DoubleSide;
  m.envMapIntensity = .5;
  return m;
}
