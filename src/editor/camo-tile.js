"use strict";
// ---------- A scalable camouflage of your own (ROADMAP 4.50 (6)) ----------
// The CDK names two kinds of camouflage. The fixed one is the skin sheet (`set_tex … camo_skin_tex`),
// and the app has always made it. The SCALABLE one is a tileable pattern the game lays over the whole
// vehicle through t1, shipped with a `replace_tex` of the camouflage stem, and it is the one the
// player scales and turns in the hangar. This is that tile: a square slot with no geometry of its
// own, painted in the 2-D view like any other sheet, repeating at its edges, previewed on the model
// through the model's own camouflage UV and exported with one `replace_tex` pin per camouflage stem.
//
// What the game does with t1 was MEASURED on 2026-09-26 against the install, not read from a shader
// (the compiled dumps are not readable here) — `tools/camo_sweep.mjs` is the record:
//   * the UV is tc1, the four bytes in front of the position in vertex format 4 / stride 20, which is
//     every camouflaged dynamic_masked_tank material in the sample (formats/model.js carries the
//     numbers). One repeat spans about 12 m of vehicle at the default scale.
//   * the player's scale runs 0.2–2 with 1 at the slider's centre (`config/gameparams.blk`
//     camoSettings camoScaleMin / camoScaleMax, and the customisation window's own script), and the
//     rotation ±180° about 0 (a slider of ±200 at 0.9° a step).
//   * which stem IS the scalable camouflage: the unit's own `skin` blocks say — see `unitStems`.
const CamoTile = {
  ID: "wtss_camo_tile",            // the slot's id and the exported file's name: ASCII, as §1 requires
  SIZE: 1024,                       // the game's own high tier ships its camouflages at 1024² (gm-hq.dxp.bin)
  SIZES: [128, 256, 512, 1024, 2048, 4096],   // what a ground vehicle's texture may be: square, a power of two (wt-formats)
  SCALE_MIN: .2, SCALE_MAX: 2,      // config/gameparams.blk, camoSettings
  // The player's two hangar sliders, previewed. NOT exported: the player owns them, per vehicle.
  view: { scale: 1, rot: 0 },
  _stems: null,                     // { key, list } — stems() is asked once per material build
  on(){ return camoBaseMode() === "tile"; },
  slot(){ return App.slots.get(CamoTile.ID) || null; },
  is(s){ return !!(s && s.camoTile); },

  // ---- which camouflage the tile replaces ----
  // The unit's blk says which of a model's t1 stems is THE scalable camouflage: every `skin` and
  // `default_skin` the game ships for the vehicle swaps it with `replace_tex { from:t="<stem>*" }`.
  // Measured over 2 086 ground and naval units (`camo_sweep.mjs --skinstems`): 1 107 have all their
  // camouflage stems replaced that way, 768 only some — and the rest are never a camouflage: deck
  // planking (`camo_dark_wood`), boot topping, black paint, interiors (`ger_camo_inside_elfebein`, the
  // M1A2's crew compartment), even `_white_ao` and a cubemap that App.matPaint's rule collects from
  // dynamic_masked_chrome_bump. Pinning the tile on those repaints a deck or a turret basket with a
  // woodland pattern. Null when the blk cannot be read (no game folder, an .obj import).
  unitStems(unitId){
    const path = AcesDB.ready ? acesUnitPath(unitId) : null;
    const db = path ? acesBlk(path) : null;
    if (!db || !db.root) return null;
    const out = new Set();
    for (const c of db.root.children) {
      const cn = db.nameOf(c);
      if (cn !== "skin" && cn !== "default_skin") continue;
      for (const r of blkChildren(db, c, "replace_tex")) {
        const p = blkParams(db, r);
        if (typeof p.from === "string") out.add(p.from.replace(/\*$/, "").toLowerCase());
      }
    }
    return out;
  },
  // The model's camouflage stems the tile pins: the ones the ticked units' own skins replace. With no
  // unit to ask — or units that ship no skin at all, 177 of the 2 086 — every stem the model uses,
  // which is what the pin panel then lists, so nothing is replaced unseen. The same when the skins
  // replace none of THIS model's stems (a unit whose skins were written for another model of it):
  // an empty list would ship the tile pinned on nothing, which is no tile at all.
  stems(){
    const model = stockCamoStems();
    const units = selectedUnits();
    // AcesDB in the key: asked before the game's blks were read, the answer is "every stem", and it
    // must not outlive the moment they can be read.
    const key = (AcesDB.ready ? "aces|" : "|") + units.join(",") + "|" + model.join(",");
    if (CamoTile._stems && CamoTile._stems.key === key) return CamoTile._stems.list;
    const known = new Set();
    for (const u of units) for (const s of CamoTile.unitStems(u) || []) known.add(s);
    const hit = model.filter(s => known.has(s.toLowerCase())), list = hit.length ? hit : model;
    CamoTile._stems = { key, list };
    return list;
  },
  pins(stem){ return CamoTile.on() && !!CamoTile.slot() && CamoTile.stems().includes(stem); },
  // The exported file: the albedo's format decides the extension, exactly as `encodeAllTextures` will.
  fileName(){
    const s = CamoTile.slot(), o = s ? expOpt(s, "c") : null;
    const fmt = (o && o.fmt) || exportFormats().c;
    return CamoTile.ID + (fmt === "tga" ? ".tga" : ".dds");
  },

  // ---- the slot ----
  // Made on first use and kept for the session; `noGeom` is what already keeps a track sheet out of
  // 3-D painting and out of the placeholder sweep, and the tile is the same kind of sheet.
  ensure(size){
    let s = CamoTile.slot();
    if (s) return s;
    const N = size || CamoTile.SIZE;
    s = { id: CamoTile.ID, camoTile: true, noGeom: true, cStem: null, nStem: null, size: N, sizeH: N,
      layers: [], baseC: CamoTile.startSheet(N), smooth: null, metal: null, normal: null,
      composite: null, tex: null, texCh: null, thumb: null, missing: false };
    ensureComposite(s, N, N);
    App.slots.set(s.id, s);
    compositeSlot(s);
    return s;
  },
  // ---- the project file ----
  // Stored beside `meta.slots`, not in it: a reader from before the tile would wait for a slot the
  // vehicle never makes and refuse the whole file ("Project waiting for textures"). Under its own
  // key an older reader restores everything else and ignores it — additive, so the version stays 5.
  // The base sheet goes in too, so the tile comes back exactly, with or without the game folder —
  // and so does its alpha, which a restore has no camouflage sheet to measure again (`alphaOf`).
  async save(ctx){
    const s = CamoTile.slot();
    if (!s || !s.composite) return null;
    const rec = { on: CamoTile.on(), size: s.composite.width, base: await ctx.put(s.baseC), layers: [],
      view: { scale: CamoTile.view.scale, rot: CamoTile.view.rot } };
    const al = CamoTile.alphaOf();
    if (al.from !== "none") rec.alpha = al.a;
    for (const L of s.layers) rec.layers.push(await ProjNode.save(L, ctx));
    const o = s.exp && s.exp.c;
    if (o && (o.size || o.fmt || o.off)) rec.exp = { size: o.size || 0, fmt: o.fmt || "", off: !!o.off };
    return rec;
  },
  async load(rec, ctx){
    const old = CamoTile.slot();
    if (old) { disposeSlotTextures(old); App.slots.delete(CamoTile.ID); }
    // Square at a size the tile may have: nothing else is ever written, and a size that is not one
    // is not read back as one.
    const N = CamoTile.SIZES.includes(+rec.size) ? +rec.size : CamoTile.SIZE, s = CamoTile.ensure(N);
    if (rec.base) ctx2d(s.baseC).drawImage(await ctx.img(rec.base), 0, 0, N, N);
    const a = Math.round(+rec.alpha);
    if (a >= 0 && a <= 255) s.camoAlpha = a;
    s.layers = [];
    for (const lm of rec.layers || []) s.layers.push(await ProjNode.load(lm, ctx));
    if (rec.exp) Object.assign(expOpt(s, "c"), { size: +rec.exp.size || 0, fmt: rec.exp.fmt || "", off: !!rec.exp.off });
    const v = rec.view || {};
    CamoTile.view.scale = Math.min(CamoTile.SCALE_MAX, Math.max(CamoTile.SCALE_MIN, +v.scale || 1));
    CamoTile.view.rot = Math.max(-180, Math.min(180, +v.rot || 0));
    compositeSlot(s);
    CamoTile.applyView();
    return s;
  },
  // What the tile starts as: the vehicle's own camouflage stretched over it, so the first stroke
  // lands on the colour the vehicle already wears — stretched as a tile (`fit`), so the start has
  // no seam where it meets itself. Opaque, like every composite.
  startSheet(N){
    const stem = CamoTile.stems()[0], src = stem ? App.paintTex.get(stem) : null;
    if (src) return CamoTile.fit(CamoTile.canvasOf(src.rgba, src.width, src.height), N);
    const c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "#808080"; g.fillRect(0, 0, N, N);
    return c;
  },
  // Pixels as an opaque canvas: the tile's colour is RGB, and its alpha is the camouflage's own
  // (`alphaOf`) whatever a picture carried — kept at 255 here so the canvas's premultiplication
  // cannot eat the colour of a texel whose alpha was 0.
  canvasOf(rgba, w, h){
    const px = new Uint8ClampedArray(rgba);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    const c = mkCanvas(w, h);
    ctx2d(c).putImageData(new ImageData(px, w, h), 0, 0);
    return c;
  },
  // A picture resampled to N×N AS A TILE. Canvas scaling clamps at the picture's edge, so the tile
  // met itself in a cliff: a 4 × 4 camouflage (column 0 black, 1–3 white) stretched to 256² ramped
  // 95 → 164 where columns 0 and 1 meet inside, and read 255 | 0 where the repeat puts column 3
  // against column 0 (review of 4.50 (6), 2026-09-26). So the picture is framed first in a margin of
  // its own opposite edges, and the filter reads across each edge what the repeat puts there. The
  // margin is the filter's reach: a couple of texels, times the step when shrinking.
  fit(src, N){
    const w = src.width, h = src.height;
    const mx = Math.min(w, 4 * Math.ceil(w / N)), my = Math.min(h, 4 * Math.ceil(h / N));
    const p = mkCanvas(w + 2 * mx, h + 2 * my), pg = ctx2d(p);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) pg.drawImage(src, mx + i * w, my + j * h);
    const c = mkCanvas(N, N), g = ctx2d(c), kx = N / w, ky = N / h;
    g.imageSmoothingQuality = "high";
    g.drawImage(p, -mx * kx, -my * ky, (w + 2 * mx) * kx, (h + 2 * my) * ky);
    return c;
  },
  // A picture put in as the tile's base (⋮ ▸ load a pattern…, or a game texture sent to the slot):
  // taken as it is when it is already a square War Thunder size, and otherwise stretched to the
  // tile's own size as a tile — a seamless pattern stretched stays seamless, where a crop would cut
  // its repeat. Adopting a 512×256 picture as it was made the tile 512×256: the export refused it as
  // "not a legal size", ⋮ ▸ resolution… kept the aspect, and a save and reload stretched it to 512²
  // (review of 4.50 (6), 2026-09-26). `stretched` is the size it came in at, for the status line.
  squared(dec, s){
    const w = dec.width, h = dec.height;
    if (w === h && CamoTile.SIZES.includes(w)) return dec;
    const N = s && s.baseC ? s.baseC.width : CamoTile.SIZE;
    const c = CamoTile.fit(CamoTile.canvasOf(dec.mips[0].rgba, w, h), N);
    return { width: N, height: N, mips: [{ w: N, h: N, rgba: ctx2d(c).getImageData(0, 0, N, N).data }],
      fileName: dec.fileName, stretched: [w, h] };
  },
  // The alpha the exported tile carries. Every camouflage in the install has a narrow band well
  // short of opaque — us_camo_olive 165–182, ger_camo_bronzegruen 149–206, ussr_camo_deform 151–177,
  // the 1024² pattern ger_camo_dunkelgelb_green_braun_blots 152–177 — and so does a published
  // community pin (SEP 2 -B2's us_camo_modern_green.tga, 127–176). What the shader does with it is not
  // in the data; the desc's per-material `camo_smoothness_influence` suggests a surface property
  // rather than coverage. So the tile carries the MEAN alpha of the camouflage it replaces, which is
  // right whichever it turns out to be. `from` says where the number came from: `sheet`, measured
  // off the camouflage sheets now; `project`, as the .wtproj recorded it — a restore reads no
  // camouflage sheet (App.paintTex is filled by a game-folder vehicle load and by a loaded skin, by
  // nothing else), and the same project exported 170 before a reload and 255 after one until the
  // file kept it (review, 2026-09-26); `none`, 255, when no sheet was ever read (an .obj import).
  alphaOf(){
    let sum = 0, n = 0;
    for (const stem of CamoTile.stems()) {
      const t = App.paintTex.get(stem);
      if (t) for (let i = 3; i < t.rgba.length; i += 4) { sum += t.rgba[i]; n++; }
    }
    if (n) return { a: Math.round(sum / n), from: "sheet" };
    const s = CamoTile.slot();
    if (s && s.camoAlpha >= 0) return { a: s.camoAlpha, from: "project" };
    return { a: 255, from: "none" };
  },

  // ---- a tile has no edges ----
  // Every copy of a disc of radius r at (x, y) that touches a W×H sheet which repeats — the dab
  // itself when it is well inside, and its twins across each edge it crosses, so a stroke over the
  // right edge lands on the left. That is Photoshop's Offset filter done by the tools instead of by
  // hand. (x, y) may be outside the sheet: the 2-D view draws the tile 3 × 3.
  wrap(x, y, W, H){ return [((x % W) + W) % W, ((y % H) + H) % H]; },
  copies(x, y, r, W, H){
    const [bx, by] = CamoTile.wrap(x, y, W, H), out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = bx + i * W, cy = by + j * H;
      if (cx + r > 0 && cx - r < W && cy + r > 0 && cy - r < H) out.push([cx, cy]);
    }
    return out;
  },
  // The same for a placement in the sheet's 0–1 space (a flat decal): offsets of -1, 0 and 1.
  shifts(on){ return on ? [-1, 0, 1] : [0]; },
  // Which whole-sheet shifts bring an extent [lo, hi] onto a W-wide sheet that repeats: [0] for an
  // ordinary sheet, every copy the extent overlaps for a tile. The path tool's fill asks this, since a
  // shape can be drawn over a neighbouring copy in the 3 × 3 view.
  span(lo, hi, W, on){
    if (!on) return [0];
    const out = [];
    for (let i = Math.floor(-hi / W); i <= Math.ceil((W - lo) / W); i++) if (lo + i * W < W && hi + i * W > 0) out.push(i);
    return out;
  },

  // ---- the preview's scale and rotation ----
  // tc1 → what the viewport samples. Scale is the size of the PATTERN, as the game's slider reads it
  // (20 %–200 %), so the coordinates shrink as it grows; rotation turns about the tile's centre. The
  // viewport has the transform only in tile mode — the stock camouflage is shown at the game's own
  // default, scale 1, no rotation.
  // `out` is the attribute's own array on a slider move, so dragging allocates nothing: a tank's
  // camouflaged surface is a third of a million triangles, two floats a corner.
  xform(src, out){
    const on = CamoTile.on();
    const k = on ? 1 / Math.max(.01, CamoTile.view.scale) : 1, a = on ? CamoTile.view.rot * Math.PI / 180 : 0;
    const c = Math.cos(a) * k, s = Math.sin(a) * k;
    out = out || new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 2) {
      const u = src[i] - .5, v = src[i + 1] - .5;
      out[i] = c * u - s * v + .5; out[i + 1] = s * u + c * v + .5;
    }
    return out;
  },
  // Re-derive every mesh's camouflage UV from its stored tc1. A buffer upload per mesh — the shader
  // program does not change, which is the point: a value inlined into it would compile a program per
  // slider step, and a uniform set in onBeforeCompile is shared between materials in r128 (wt-canvas).
  applyView(){
    for (const mesh of App.meshes.values()) {
      const a = mesh.geometry && mesh.geometry.attributes.camoUv, base = mesh.userData.camoUv0;
      if (!a || !base) continue;
      CamoTile.xform(base, a.array);
      a.needsUpdate = true;
    }
    needsRender();
  },
  // A vehicle's sheets go when the vehicle does (clearVehicleState), the tile with them — and with it
  // the preview's scale and rotation, which describe how THIS tile was being looked at.
  reset(){
    CamoTile.view.scale = 1; CamoTile.view.rot = 0;
    CamoTile._stems = null;
  },
};
