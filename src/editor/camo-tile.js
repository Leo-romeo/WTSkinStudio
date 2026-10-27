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
  _scale: null,                     // { parts, info } — scaleInfo()'s last measurement
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
  // The exported file: the albedo's format decides the extension, exactly as `encodeAllTextures` will
  // — through the same `ExportCollect.formatFor`, so a tile with level content under the TGA preset
  // is the .dds it is written as, and the pins name that (ROADMAP 4.58; review of (a)).
  fileName(){
    const s = CamoTile.slot();
    const lv = s && s.composite ? ExportCollect.levels(null, s, "tile", s.composite.width, s.composite.height) : null;
    const fmt = s ? ExportCollect.formatFor({ slot: s, kind: "c", levelNote: lv && lv.note }, exportFormats()) : exportFormats().c;
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
    const base = rec.base ? await ctx.img(rec.base) : null;      // null when the file lost it (1.21 (4))
    if (base) ctx2d(s.baseC).drawImage(base, 0, 0, N, N);
    const a = Math.round(+rec.alpha);
    if (a >= 0 && a <= 255) s.camoAlpha = a;
    s.layers = [];
    ctx.blank = () => mkCanvas(N, N);                             // a painted layer whose sheet the file lost
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

  // ---- the calibration grid, and the repeat length it is held to (ROADMAP 4.50 (6)) ----
  // The preview's one number that came from the model's data and not from a shader is "one repeat per
  // unit of tc1". A tile that says which cell is which turns the hangar into the measuring stick: the
  // same hull, the same grid, and the owner reads off which cells land on the nose, the rear and the
  // turret in the game and in the app.
  //   * a mid-grey ground, a 4 × 4 grid of cells numbered 1–16 from the top left, each digit a
  //     quarter of a cell high (a whole-pixel 5 × 7 font, drawn with fillRect: canvas TEXT is never
  //     the same pixels twice across machines — wt-canvas — and this has to be hashable);
  //   * a red frame two texels wide on the tile's own edge, so one repeat is one red square;
  //   * a yellow arrow in cell 1 pointing to +v. The game's v runs down a DDS's rows (the extractor
  //     flips it for the viewport, `mvReadUV`), so +v is DOWN the picture here.
  // No antialiasing anywhere: every edge is a whole texel, and the bytes are a function of N alone.
  GLYPHS: ["01110 10001 10011 10101 11001 10001 01110", "00100 01100 00100 00100 00100 00100 01110",
    "01110 10001 00001 00010 00100 01000 11111", "11110 00001 00001 01110 00001 00001 11110",
    "00010 00110 01010 10010 11111 00010 00010", "11111 10000 11110 00001 00001 10001 01110",
    "00110 01000 10000 11110 10001 10001 01110", "11111 00001 00010 00100 01000 01000 01000",
    "01110 10001 10001 01110 10001 10001 01110", "01110 10001 10001 01111 00001 00010 01100"],
  calibration(N){
    const c = mkCanvas(N, N), g = ctx2d(c), cell = N / 4, line = Math.max(1, Math.round(N / 512));
    g.fillStyle = "#808080"; g.fillRect(0, 0, N, N);
    g.fillStyle = "#666666";                                    // the cell borders, so a cell reads as a cell
    for (let i = 1; i < 4; i++) { const p = i * cell - (line >> 1); g.fillRect(p, 0, line, N); g.fillRect(0, p, N, line); }
    // The digits: a whole number of texels per font pixel, as large as a quarter of a cell allows.
    const s = Math.max(1, Math.floor(cell / 4 / 7)), pad = Math.max(4, Math.round(cell / 12));
    g.fillStyle = "#ffffff";
    for (let k = 0; k < 16; k++) {
      let x = (k % 4) * cell + pad;
      const y = Math.floor(k / 4) * cell + pad;
      for (const ch of String(k + 1)) {
        CamoTile.GLYPHS[+ch].split(" ").forEach((row, r) => {
          for (let col = 0; col < 5; col++) if (row[col] === "1") g.fillRect(x + col * s, y + r * s, s, s);
        });
        x += 6 * s;
      }
    }
    // The arrow in cell 1: a shaft, then a head that narrows a row at a time to its tip, which is the
    // lowest row — toward +v.
    const cx = Math.round(cell / 2), top = Math.round(cell * .4), tip = Math.round(cell * .9), headH = Math.round(cell * .22);
    const hw = Math.max(1, Math.round(cell / 24)), hh = 3 * hw;
    g.fillStyle = "#ffd400";
    g.fillRect(cx - hw, top, 2 * hw + 1, tip - headH - top + 1);
    for (let r = 0; r < headH; r++) { const w = Math.round(hh * (headH - r) / headH); g.fillRect(cx - w, tip - headH + 1 + r, 2 * w + 1, 1); }
    g.fillStyle = "#ff0000";                                   // the frame last: two texels, on the tile's own edge
    g.fillRect(0, 0, N, 2); g.fillRect(0, N - 2, N, 2); g.fillRect(0, 2, 2, N - 4); g.fillRect(N - 2, 2, 2, N - 4);
    return c;
  },
  // ---- the grid as a toggle (ROADMAP 3.45) ----
  // "There is no way to turn it off": the button only ever added the grid, one Undo was the only way
  // back, and a few edits later the pattern underneath was out of reach. So the base the tile had is
  // kept when the grid goes in, and the same button puts it back — as an edit of its own, at any
  // later point. Kept in memory only, not in the .wtproj (that is a format change, §0, for a
  // tool used for a minute); after a reload the button still sees the grid and puts the tile's own
  // start back instead (`startSheet`), and says so. `slot` ties the copy to the tile it came from,
  // so a project loaded or a tile made anew cannot be handed another tile's pattern.
  calBase: null,                    // { slot, canvas }
  // Whether the tile's base IS the grid, read off its pixels — the one answer that holds through
  // undo, redo and a reload alike, with no flag to keep in step. Six lines of texels, not the sheet:
  // the frame's first row and column and its last, a row through the top cells' numbers and a
  // column through cell 1's arrow, compared byte for byte with the same lines of `calibration(N)`
  // (kept per N). The whole sheet was the first version, and its review measured what that costs: two
  // 64 MB reads and a 67-million-step loop at 4096², on every list refresh while the grid was in.
  // Six lines are 6·N texels, and paint put on the base over the grid between them still reads as
  // the grid — which Remove grid then takes away with it, as it would have to anyway.
  calRef: null,                     // { N, lines }: the grid's own six lines at that size
  calLines(c){
    const N = c.width, g = ctx2d(c), cell = N / 4;
    const pad = Math.max(4, Math.round(cell / 12)), s = Math.max(1, Math.floor(cell / 4 / 7));
    const at = [[0, 0, N, 1], [0, N - 1, N, 1], [0, 0, 1, N], [N - 1, 0, 1, N],
      [0, Math.min(N - 1, pad + 2 * s), N, 1], [Math.min(N - 1, Math.round(cell / 2)), 0, 1, N]];
    return at.map(r => g.getImageData(r[0], r[1], r[2], r[3]).data);
  },
  calIn(){
    const s = CamoTile.slot(), c = s && s.baseC;
    if (!c || c.width !== c.height || c.width < 8) return false;
    const N = c.width;
    if (!CamoTile.calRef || CamoTile.calRef.N !== N) CamoTile.calRef = { N, lines: CamoTile.calLines(CamoTile.calibration(N)) };
    const want = CamoTile.calRef.lines, got = CamoTile.calLines(c);
    for (let k = 0; k < want.length; k++) for (let i = 0; i < want[k].length; i++) if (want[k][i] !== got[k][i]) return false;
    return true;
  },
  // The button's two halves. Both go through ReplaceTex.byUser, as any picture put into the base
  // does, so each is one undo step and neither touches the paint layers over the base.
  calPut(){
    const s = CamoTile.ensure(), N = s.baseC.width;
    const keep = mkCanvas(N, N);
    ctx2d(keep).drawImage(s.baseC, 0, 0);
    // Not over a copy already kept for this tile while its base still wears the frame's red: that is
    // a grid this check no longer recognises (painted on, say), and the copy is the only way back.
    const red = ctx2d(s.baseC).getImageData(0, 0, 1, 1).data;
    if (!(CamoTile.calBase && CamoTile.calBase.slot === s && red[0] === 255 && red[1] === 0 && red[2] === 0))
      CamoTile.calBase = { slot: s, canvas: keep };
    CamoTile.calApply(s, CamoTile.calibration(N), "the calibration grid");
    return s;
  },
  // Says what it put back: "kept", or for a base not kept (a reload) the tile's start — "camo" when
  // there is a camouflage sheet to start from, "grey" when there is none (an .obj import), which the
  // status line has to tell apart from the grid's own grey.
  calTake(){
    const s = CamoTile.slot(), N = s.baseC.width, kept = CamoTile.calBase && CamoTile.calBase.slot === s;
    // A tile resized since the grid went in takes the kept base at its new size, as a resize does.
    const k = kept && CamoTile.calBase.canvas;
    const back = !kept ? CamoTile.startSheet(N) : k.width === N ? k : CamoTile.fit(k, N);
    CamoTile.calApply(s, back, kept ? "the base from before the grid" : "the tile's start (the base from before the grid was not kept across a reload)");
    const stem = CamoTile.stems()[0];
    return kept ? "kept" : stem && App.paintTex.get(stem) ? "camo" : "grey";
  },
  calApply(s, canvas, name){
    const N = s.baseC.width;
    ReplaceTex.byUser(s, { width: N, height: N, mips: [{ w: N, h: N, rgba: ctx2d(canvas).getImageData(0, 0, N, N).data }] }, false, name);
  },
  // How long one repeat of the camouflage is on a model, at scale 1, from its own tc1 against its own
  // positions: per triangle, the square root of (UV area ÷ surface area) is UV per metre, and one
  // repeat is its reciprocal. The figure is the AREA-weighted median — a planar or box projection puts
  // every face squarely to its axis at exactly one density, so the median is that density and the
  // oblique faces and the odd small part cannot move it (`tools/camo_sweep.mjs --tc1`, which measured
  // it over the roster and is this function's oracle). A histogram on a log scale rather than a sort:
  // a tank's camouflaged surface is a third of a million triangles, and this runs on the UI thread;
  // 4096 bins over 1e-3–1e3 UV/m is 0.17 % a bin. `parts` is [{pos, uv}], three floats and two a
  // vertex, three vertices a triangle. `length` is the longer horizontal extent (Y is up); `fit` is
  // how many repeats that is. Null when there is no triangle to measure.
  measure(parts){
    const NB = 4096, LO = Math.log(1e-3), K = NB / (Math.log(1e3) - LO), hist = new Float64Array(NB);
    let area = 0, tris = 0, xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity;
    for (const { pos, uv } of parts) {
      for (let v = 0; v + 2 < pos.length / 3; v += 3) {
        const p = v * 3, t = v * 2;
        const e1x = pos[p+3] - pos[p], e1y = pos[p+4] - pos[p+1], e1z = pos[p+5] - pos[p+2];
        const e2x = pos[p+6] - pos[p], e2y = pos[p+7] - pos[p+1], e2z = pos[p+8] - pos[p+2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        const aw = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
        const au = Math.abs((uv[t+2] - uv[t]) * (uv[t+5] - uv[t+1]) - (uv[t+3] - uv[t+1]) * (uv[t+4] - uv[t])) / 2;
        if (!(aw >= 1e-6) || au !== au) continue;               // a collapsed triangle has no surface; NaN is no tc1
        const d = Math.sqrt(au / aw);
        hist[d > 1e-3 ? Math.min(NB - 1, Math.floor((Math.log(d) - LO) * K)) : 0] += aw;
        area += aw; tris++;
        for (let k = 0; k < 9; k += 3) {
          xlo = Math.min(xlo, pos[p+k]); xhi = Math.max(xhi, pos[p+k]);
          zlo = Math.min(zlo, pos[p+k+2]); zhi = Math.max(zhi, pos[p+k+2]);
        }
      }
    }
    if (!tris) return null;
    let acc = 0, bin = 0;
    for (; bin < NB - 1; bin++) { acc += hist[bin]; if (acc >= area / 2) break; }
    const dens = Math.exp(LO + (bin + .5) / K), repeat = 1 / dens, length = Math.max(xhi - xlo, zhi - zlo);
    return { dens, repeat, length, fit: length / repeat, area, tris };
  },
  // The tile panel's scale line: how long one repeat is on THIS model at scale 1, and how many fit along
  // the hull — the number the Calibration grid's cells are held to in the hangar. Text only; the panel
  // puts it on the page. At another preview scale the repeat is that much longer, said after it.
  // The same, as the one line the tile panel shows; `readout` is its tooltip (ROADMAP 3.44).
  readoutLine(){
    const i = CamoTile.scaleInfo(), m = x => x.toFixed(1) + " m", sc = CamoTile.view.scale;
    if (!i) return "This model has no camouflaged part with a camouflage UV (tc1).";
    return "One repeat " + m(i.repeat) + " · hull " + m(i.length) + " · " + i.fit.toFixed(1) + " repeats fit" +
      (Math.abs(sc - 1) > .005 ? " · " + m(i.repeat * sc) + " at " + Math.round(sc * 100) + " %" : "");
  },
  readout(){
    const i = CamoTile.scaleInfo(), m = x => x.toFixed(1) + " m", sc = CamoTile.view.scale;
    if (!i) return "The loaded model has no camouflaged part with a camouflage UV (tc1), so there is no repeat length to give — an .obj from outside this app has none, and the preview then wraps the tile through the ordinary UV.";
    return "At scale 1 one repeat is " + m(i.repeat) + " long, measured from this model's own camouflage UV; the hull is " + m(i.length) +
      " long, so " + i.fit.toFixed(1) + " repeats fit along it." +
      (Math.abs(sc - 1) > .005 ? " At the preview's " + Math.round(sc * 100) + " % one repeat is " + m(i.repeat * sc) + "." : "");
  },
  // The model's camouflaged parts as `measure` takes them: what the viewport lays the camouflage on
  // through a tc1 — a material with a camouflage stem, as materials.js's `paintTintFor` asks — less an
  // effect card and bone-driven cloth (neither is hull, and a flame sits metres behind it). Measured on
  // 2026-10-22 without the stem rule, the T-34-1941 carried 11 000 more triangles than its camouflaged
  // materials hold, which is the tracks and fittings drawn from the same vertex format.
  hullParts(){
    const out = [];
    for (const mesh of App.meshes.values()) {
      const u = mesh.userData || {}, pa = mesh.geometry && mesh.geometry.attributes.position;
      if (!u.camoUv0 || !pa || u.effect || u.unposed || mesh.visible === false || !App.matPaint.get(u.mat)) continue;
      out.push({ pos: pa.array, uv: u.camoUv0 });
    }
    return out;
  },
  // Asked on every panel redraw, so it answers from the last measurement while the same arrays are
  // there: 330 000 triangles is tens of milliseconds, and a slider move is not allowed that.
  scaleInfo(){
    const parts = CamoTile.hullParts(), was = CamoTile._scale;
    if (was && was.parts.length === parts.length && parts.every((p, i) => p.pos === was.parts[i].pos && p.uv === was.parts[i].uv)) return was.info;
    const info = CamoTile.measure(parts);
    CamoTile._scale = { parts, info };
    return info;
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
    CamoTile._stems = null; CamoTile._scale = null;
  },
};
