// ---- Ground and naval vehicles are not painted like aircraft ----
// An aircraft's albedo IS its paint: replace_tex swaps the sheet and that is the whole skin.
// A ground or naval vehicle is painted from TWO textures — the detailed sheet you edit, and the
// player's selected *camouflage* (`ger_camo_bronzegruen`, `us_camo_olive`, `ussr_camo_green`…),
// a near-flat colour the shader tints the vehicle with. `set_tex … param:t="camo_skin_tex"` puts
// your sheet in the user-skin slot, which is what keeps in-game decals and the condition wear
// alive, but it does NOT stop the stock camouflage tinting what you painted: a grey scheme comes
// out bronze-green on a Leopard and olive on an Abrams. Every hand-made ground skin therefore
// opens with a replace_tex that swaps that camouflage for a flat one — verified across three
// independent community skins in this install (Leopard 2A4 → universal_grey, M1A2 SEP2 →
// us_camo_modern_green, WZ-141 → ussr_camo_green). Which camouflages a model uses is known
// exactly: they are the t1 textures of its dynamic_masked_* materials (App.matPaint).
// The flat texture is generated and shipped with the skin rather than named — `universal_grey`,
// which the Leopard skin references, does not exist in the install, so that line does nothing.
// Which camo sheets this model actually uses, and — separately — which of them a slot the user is
// exporting sits on. A model routinely uses several: the M1A2's exterior materials take
// `us_camo_olive` while its crew compartment takes `ger_camo_inside_elfebein`, over the SAME
// albedo. Pinning every stem to one flat colour repainted the interior too, so each stem is
// handled on its own.
function stockCamoStems(){
  const out = new Set();
  for (const stem of App.matPaint.values()) if (stem) out.add(stem);
  return [...out];
}
// Cap a camo sheet so a large one cannot bloat the project or the exported archive. These are
// near-flat by nature, so a box downsample loses nothing that matters.
const CAMO_MAX = 256;
function capCamoSheet(w, h, rgba){
  const f = Math.max(1, Math.ceil(Math.max(w, h) / CAMO_MAX));
  if (f === 1) return { width: w, height: h, rgba: new Uint8Array(rgba) };
  const dw = Math.max(1, Math.floor(w / f)), dh = Math.max(1, Math.floor(h / f));
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g = 0, b = 0, a = 0, k = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const sx = x * f + i, sy = y * f + j;
      if (sx >= w || sy >= h) continue;
      const s = (sy * w + sx) * 4;
      r += rgba[s]; g += rgba[s+1]; b += rgba[s+2]; a += rgba[s+3]; k++;
    }
    const d = (y * dw + x) * 4;
    out[d] = r / k; out[d+1] = g / k; out[d+2] = b / k; out[d+3] = a / k;
  }
  return { width: dw, height: dh, rgba: out };
}
function camoBaseMode(){ return $("expCamoBase") ? $("expCamoBase").value : "stock"; }
function camoBaseColor(){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(($("expCamoColor") && $("expCamoColor").value) || "#808080");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
function flatCamoSheet(rgb){
  const w = 64, rgba = new Uint8Array(w * w * 4);
  for (let i = 0; i < w * w; i++) { rgba[i*4] = rgb[0]; rgba[i*4+1] = rgb[1]; rgba[i*4+2] = rgb[2]; rgba[i*4+3] = 255; }
  return { width: w, height: w, rgba };
}
// ---- What goes under the skin, per camo stem ----
// A ground/naval skin is blended over the player's *scalable camouflage*, so whatever the player
// has selected in the hangar (desert, winter, the stock olive) shows through everywhere the skin's
// alpha is not fully opaque. A skin that does not pin that texture comes out a different colour for
// every player. The pin used to be one flat WHITE 64² sheet shared by every stem, which is the
// single biggest reason an unmodified round-trip changed colour: `us_camo_olive` (82,74,54) became
// (255,255,255) under 63 % of the M1A2's sheet.
//   stock  — ship a copy of the vehicle's own camo texture. The vehicle looks exactly like the
//            default one, which is what "I only imported and exported it" must produce.
//   color  — one flat colour for every stem: paint the whole vehicle a solid base and keep the
//            stock coverage mask, wear and decals on top of it.
//   white/grey — the old behaviour, kept because some hand-made skins are authored against it.
//   keep   — emit nothing; the player's camouflage tints the skin.
// A skin loaded into the editor that already carried its own pin (the M1A2 template ships
// `us_camo_olive → us_camo_modern_green.tga`) keeps it: re-exporting must not silently drop it.
// The plan is cheap — it is read on every slot-list refresh to keep the summary honest — and only
// camoPins() encodes the DDS bytes, at export time.
function camoPinPlan(){
  const mode = camoBaseMode();
  if (mode === "keep") return [];
  // A camouflage tile of your own (ROADMAP 4.50 (6)): one file, pinned on every stem the vehicle's own
  // skins replace (CamoTile.stems) and on nothing else, so an interior or a deck keeps the game's
  // own. The file is an ordinary export item (collectExports) — the pins only name it, which is why
  // they carry no bytes of their own. Unticking the tile in Textures out drops its pins with it.
  if (mode === "tile") {
    const t = CamoTile.slot();
    if (!t || expOpt(t, "c").off) return [];
    return CamoTile.stems().map(stem => ({ stem, fileName: CamoTile.fileName(), source: "tile" }));
  }
  const out = [];
  for (const stem of stockCamoStems()) {
    const carried = App.skinCamo.get(stem);
    if (mode === "stock" && carried) { out.push({ stem, fileName: carried.fileName, source: "skin", carried }); continue; }
    if (mode === "stock" && !App.paintTex.has(stem)) continue;   // no pixels read: emit nothing rather than a guess
    out.push({ stem, fileName: "wtss_camo_" + stem.replace(/[^a-z0-9_\-]/gi, "_") + ".dds", source: mode });
  }
  return out;
}
function camoPins(){
  return camoPinPlan().map(p => {
    if (p.carried) return { stem: p.stem, fileName: p.fileName, data: p.carried.data, source: "skin" };
    if (p.source === "tile") return { stem: p.stem, fileName: p.fileName, data: null, source: "tile" };   // the file is an item
    const sheet = p.source === "stock" ? App.paintTex.get(p.stem)
      : p.source === "color" ? flatCamoSheet(camoBaseColor())
      : p.source === "white" ? flatCamoSheet([255, 255, 255])
      : flatCamoSheet([128, 128, 128]);
    return { stem: p.stem, fileName: p.fileName, source: p.source,
      data: BCnEnc.writeDDS([{ w: sheet.width, h: sheet.height, rgba: sheet.rgba }], { bc3: false }) };
  });
}
// A UserSkins .blk. `set_tex` with param camo_skin_tex is what the CDK requires for ground
// vehicles' diffuse textures — it is what keeps in-game decals and the condition wear alive.
// Aircraft (and every _n surface map) use plain replace_tex.
function buildBlk(items, mode, pins){
  let s = 'name:t="user"\n\n';
  for (const p of (pins || []))
    s += 'replace_tex{\n  from:t="' + p.stem + '*"\n  to:t="' + p.fileName + '"\n}\n\n';
  for (const it of items) {
    if (it.camoTile) continue;                        // named by the camouflage pins above, never set on its own
    const useSet = mode === "set_tex" && it.kind === "c";
    if (useSet) {
      s += 'set_tex{\n  from:t="' + it.fromStem + '*"\n  to:t="' + it.fileName + '"\n  param:t="camo_skin_tex"\n}\n\n';
    } else {
      s += 'replace_tex{\n  from:t="' + it.fromStem + '*"\n  to:t="' + it.fileName + '"\n}\n\n';
    }
  }
  return s;
}
