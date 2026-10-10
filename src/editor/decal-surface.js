/*==DECALSURF==*/
"use strict";
// ---------- A decal's surface response, as derived channels of its own layer ----------
// ROADMAP 4.8, in full. The editor's **Look** (painted / vinyl / stencil / none) describes a decal
// that writes smoothness, metalness and normal, and until now it wrote none of them: it pre-filled
// three sidebar sliders whose only consumer was a separate, destructive `Bake surface effect into
// _n` button. Choosing "Vinyl sticker (gloss + raised edge)" and placing the decal produced a
// colour layer and nothing else.
//
// What it does now is what was asked for: the gloss and the raised edge move, fade, hide and
// delete with the sticker. 4.8 built that as **one layer per channel inside a group**; since
// 4.28(f) it is **derived channels of the decal's own layer** and there is no group — the account
// is in the comment over `derivedOn`, below. (The guide and two tooltips went on describing the
// group until ROADMAP 4.50 (17), 2026-09-25, and so did this header.)
//
// **The pixels are the same pixels the destructive bake wrote.** The maths below is the bake's,
// deliberately unchanged — `base + delta * alpha` for smoothness and metalness, and the alpha
// gradient times `emboss * 14` into the normal's X and Y. What changed is where they live. That
// equality is asserted rather than assumed (`tools/t58_decalsurf.mjs`), because "non-destructive"
// is only an improvement if it still looks the same.
//
// A derived layer is **opaque** over the footprint rather than carrying the decal's alpha, and that
// is not a detail: composited `source-over` at alpha `a` the result would be
// `mix(base, base + delta*a, a)`, which is not `base + delta*a`. The softness at a decal's edge is
// already in the value, because the delta is scaled by `a` before it is added.
// The look's four deltas and the channel each one writes. **Wear is the fourth, added 2026-09-02**
// as the last of 4.28(f)'s editing half — and it is one entry in this table rather than a mechanism,
// which is the whole claim that item made. A decal covers the surface it sits on, so "how much paint
// is there here" is a thing it has an opinion about: a vinyl sticker over bare metal is painted, a
// worn stencil is not. Before (b) it could not be reached at all, because a decal's response was a
// folder of sibling layers built for the three channels the _n packs and wear does not live there.
//
// Nothing else in this file knows there are four rather than three: every loop and every gate below
// reads this table, so a fifth would be one more line here. That was not true of the three-channel
// version and is the reason this went in as a table read rather than as a `wr` branch.
// **It was not true of two loops either, until 2026-09-26** — `refreshProjSurfaces`'s removal and
// `SurfDrag.hold` still listed three, and a projected decal's Paint Δ outlived its Look (ROADMAP
// 4.50a). `t58` now lists all four itself, because its helpers had listed three as well.
const SURF_DELTA_CHAN = { sm: "smooth", mt: "metal", em: "normal", wr: "wear" };
// `wr` is keyed for the channel and LABELLED for what the number means. The wear channel is
// coverage — white is painted, black is the bare material the game's condition slider wears back to
// — so a positive delta says "this decal is paint" and a negative one says "the paint is gone here",
// which is what a burnt-on stencil or a scorch mark wants. Calling the slider "Wear" would have it
// read backwards from the value it holds.
const SURF_LABEL = { sm: "Gloss", mt: "Metal", em: "Emboss", wr: "Paint" };
function surfDeltas(surf){
  const d = {};
  for (const k in SURF_DELTA_CHAN) d[k] = Math.round(+(surf && surf[k]) || 0);
  return d;
}
// Does this look ask for anything? With a `slot`, the stronger question the three gates below want:
// does it ask for anything this slot can actually take. They are two readings of one condition and
// they were drifting — every gate tested `chanBase(slot, "smooth")`, i.e. "is there an _n", which
// was right while all three channels came out of the _n and is wrong the moment one of them is the
// albedo's alpha: a wear-only look was refused on a slot that had everything it needed.
function surfHasResponse(surf, slot){
  const d = surfDeltas(surf);
  return Object.keys(SURF_DELTA_CHAN).some(k => d[k] && (!slot || chanBase(slot, SURF_DELTA_CHAN[k])));
}
// The decal drawn alone into a sheet of its own, so its alpha is its coverage. Sized to the CHANNEL
// sheet, which need not be the albedo's size, and returned with the bounding box the pixel loops
// are allowed to touch — a 4096² per-pixel walk for a 200 px sticker is the whole-sheet cost §3.4
// exists to avoid, and the box is analytic here rather than found by reading the sheet back.
// `src` is the image to stamp, defaulting to the decal itself. A height source is stamped through
// exactly this transform instead, which is what makes rotate / scale / mirror correct for free
// (ROADMAP 4.19) — and it carries the decal's own alpha, so coverage is unchanged either way.
function decalFootprint(L, w, h, src){
  // The marking as drawn — with its outline, without its shadow (DecalStyle) — or the height
  // source, which is already at that size. Either is centred on the decal's own centre.
  const bmp = src || DecalStyle.bitmap(L.bmp, surfOf(L), LayerNode.contentOn(L, "color") || L, true);
  const c = mkCanvas(w, h), g = ctx2d(c);
  // The same transform the compositor stamps a decal with, against this sheet's size.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.translate(L.x * w, L.y * h);
  g.rotate(L.rot * Math.PI / 180);
  g.scale(L.scale * (L.flip ? -1 : 1), L.scale);
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rad = Math.hypot(bmp.width, bmp.height) / 2 * L.scale + 4;
  const x0 = Math.max(0, Math.floor(L.x * w - rad)), y0 = Math.max(0, Math.floor(L.y * h - rad));
  const x1 = Math.min(w - 1, Math.ceil(L.x * w + rad)), y1 = Math.min(h - 1, Math.ceil(L.y * h + rad));
  return { canvas: c, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// A PROJECTED decal's footprint is not analytic, and it does not need to be: the alpha was drawn by
// the GPU straight into the projected layer's own sheet, so **the layer IS the footprint** (ROADMAP
// 4.8b). What is not free is its bounding box — finding it by reading the sheet back is the
// full-surface `getImageData` 1.11 measured at 29.9 ms and removed — so the projector reports it
// instead (`L.projBox`, in albedo texels) and all that is left here is scaling it into the channel's
// own sheet, which need not be the same size.
// `hsrc`, when given, is the decal's height source: it has to be sent through the SAME projector
// the colour went through, or the relief would sit in the decal's own frame while the decal sits
// wrapped around a fuselage. Rendered once here, on the non-live path only — `renderProjGroup`
// defers the whole surface rebuild to the end of a drag, so this rides along with that.
function projFootprint(L, w, h, hsrc){
  if (!L || !L.canvas || !L.projBox) return null;
  if (hsrc && L.proj) {
    const p = mkCanvas(L.canvas.width, L.canvas.height);
    // `hsrc` is already at the styled, shadowless size, so it goes through the projector with the
    // Look's styles OFF and the source's width as the scale reference — the same world size per
    // source pixel the colour pass used, which is what lands it exactly under the marking.
    const asHeight = { ...L.proj, bmp: hsrc, surf: null, srcW: L.proj.bmp.width };
    renderProjection(p, asHeight, frameFromArrays(L.proj.frame), slotOfLayer(L), false);
    const t = mkCanvas(w, h);
    ctx2d(t).drawImage(p, 0, 0, w, h);
    const b = L.projBox, kx0 = w / L.canvas.width, ky0 = h / L.canvas.height;
    const x0 = Math.max(0, Math.floor(b.x * kx0)), y0 = Math.max(0, Math.floor(b.y * ky0));
    const x1 = Math.min(w - 1, Math.ceil((b.x + b.w) * kx0)), y1 = Math.min(h - 1, Math.ceil((b.y + b.h) * ky0));
    return { canvas: t, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const kx = w / L.canvas.width, ky = h / L.canvas.height;
  const c = (kx === 1 && ky === 1) ? L.canvas : (() => { const t = mkCanvas(w, h); ctx2d(t).drawImage(L.canvas, 0, 0, w, h); return t; })();
  const x0 = Math.max(0, Math.floor(L.projBox.x * kx)), y0 = Math.max(0, Math.floor(L.projBox.y * ky));
  const x1 = Math.min(w - 1, Math.ceil((L.projBox.x + L.projBox.w) * kx));
  const y1 = Math.min(h - 1, Math.ceil((L.projBox.y + L.projBox.h) * ky));
  return { canvas: c, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// A decal's Look, wherever it is kept: on the decal itself for a UV one, on the shared projection
// parameters for a projected one — every sheet of one projected decal reads the same object, which
// is what makes "change the Look" one change rather than four.
function surfOf(L){ return L && L.proj ? L.proj.surf : (L && L.surf); }
// ---------- Relief: one height field, three ways of getting one (ROADMAP 4.19) ----------
// The emboss pass has always differentiated the decal's ALPHA, which is why it only ever produced a
// raised rim: alpha is flat across the body of a solid marking, so its gradient is zero everywhere
// except the silhouette. Rivets, a raised weld, a bevelled stencil — none of that exists in alpha.
//
// So the source is now a **height field** and the alpha case is one of three. That reframing is the
// whole change and it costs nothing: differentiating alpha IS "height = alpha", so `edge` reproduces
// the old output byte for byte (asserted in t58), and the other two modes are different ways to fill
// the same array before the same two subtractions run over it.
//
//   edge   height = alpha.           What it always did. Still the default, so no project changes.
//   bevel  height = a ramp inward from the silhouette, from a chamfer distance transform. Gives a
//          solid marking a THICK body rather than a hard rim, and needs no asset from the user —
//          which is why it is worth more than the import for most decals.
//   map    height = an imported depth map, masked by the decal's own alpha.
//
// **Height, not a normal map, and that is not a preference.** A normal map stores vectors, so every
// transform the decal has would have to be applied to them too — rotate it 90° and X/Y must rotate,
// mirror it and X must negate — and a PROJECTED decal has a different tangent basis per triangle,
// which the projector does not compute because it writes colour. Height is a scalar: rotate, scale,
// mirror and project it like any image, and only then differentiate in sheet space. Every transform
// comes out right for nothing.
// One binding rather than seven, on the pattern §4 asks for and `LayerList` / `DecalUI` / `PartsPanel`
// already follow. Everything here is a pure function of pixels and numbers — no DOM, no App — so it
// is the half that could be lifted into a worker if the walk ever needs to leave the UI thread.
const Relief = {
  MODES: ["edge", "bevel", "map"],
  mode(surf){ const m = surf && surf.relief; return Relief.MODES.includes(m) ? m : "edge"; },
  // Where the GLOSS goes (ROADMAP 4.19(3)): evenly over the marking, which is what every decal did
  // before, or weighted by the image's own brightness — so printed ink, bare metal and a matte
  // stencil in one decal stop sharing one specular. Kept on the Look for the same reasons the
  // relief is (travels with a projection, Ctrl+Z, the .wtproj and the library).
  GLOSS: ["cover", "light", "dark"],
  gloss(surf){ const m = surf && surf.glossSrc; return Relief.GLOSS.includes(m) ? m : "cover"; },
  bevel(surf){ const v = Math.round(+(surf && surf.bevel)); return isFinite(v) && v > 0 ? Math.min(128, v) : 6; },

  // How much stronger a depth map's gradient is made before it drives the normal. **Measured, not
  // picked**: a soft-edged decal's alpha rim — which is what the Emboss numbers were tuned on — has
  // a p95 per-texel gradient of 0.061 at 256 px against 0.033 for a smooth full-range depth map at
  // the same size, i.e. 1.8x. Both halve as the decal doubles in size, so one constant holds at
  // every scale. (The first guess here was 10-50x, from assuming the rim was a one-texel step. It is
  // not, unless the decal was keyed out with a hard edge — which is its own inconsistency, and one
  // that predates this.)
  MAP_GAIN: 2,

  // The decal's height source as one image: RGB = height, A = the decal's own coverage. Built at the
  // bitmap's size so it goes through exactly the transforms the bitmap does — including the
  // projector, which needs the alpha to know where the decal is at all.
  source(L, surf){
    const hm = L ? Relief.heightImage(L.proj || L, surf) : null;
    const src = L && (L.proj ? L.proj.bmp : L.bmp);
    if (!hm || !src) return null;
    // At the size the decal is DRAWN at — padded for an outline, never for the shadow (4.44's
    // sixth candidate): the map sits at the source's own place inside that, and the coverage is
    // the styled marking's, so a raised edge runs round the outline the way it runs round the ink.
    const holder = L.proj ? L.proj : (LayerNode.contentOn(L, "color") || L);
    const bmp = DecalStyle.bitmap(src, surf, holder, true);
    const w = bmp.width, h = bmp.height, pad = (w - src.width) / 2;
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.clearRect(0, 0, w, h);
    g.drawImage(hm, pad, pad, src.width, src.height);        // whatever size it arrived at
    const d = g.getImageData(0, 0, w, h);
    const a = ctx2d(toCanvas(bmp)).getImageData(0, 0, w, h).data;
    const inv = !!(surf && surf.heightInv);
    for (let i = 0; i < w * h; i++) {
      d.data[i*4] = d.data[i*4+1] = d.data[i*4+2] = Relief.heightAt(d.data, i, inv);
      d.data[i*4+3] = a[i*4+3];                               // coverage is the DECAL's, never the map's
    }
    g.putImageData(d, 0, 0);
    return c;
  },
  // One texel of a depth map as a height: luminance, times the map's own alpha so a cut-out PNG
  // reads as no height rather than black, turned over when the Look says dark is high.
  heightAt(d, i, inv){
    let v = (d[i*4] * .2126 + d[i*4+1] * .7152 + d[i*4+2] * .0722) * (d[i*4+3] / 255);
    if (inv) v = 255 - v;
    return Math.max(0, Math.min(255, Math.round(v)));
  },

  // ---- A NORMAL map as the relief source (ROADMAP 4.19(5)) ----
  // People have normal maps already, so the loader takes one — and turns it into a HEIGHT map, for
  // the reason the block above this object gives: height is a scalar, so rotation, mirroring, the
  // projector and the cavity all come out right with nothing new to learn, where vectors would have
  // to be rotated with the decal and re-expressed per triangle under a projection. The file is kept
  // as it came, so its reading can be changed at any time, and the height is derived from it once
  // per image and reading, and cached.
  //
  // What the file is lives on the Look beside the rest of the relief, so it rides through undo, the
  // `.wtproj` and the library (DecalStyle.carry) with nothing new to save: "depth" — also what an
  // absent key means, i.e. every project written before this — "normal-dx", green pointing DOWN the
  // image (DirectX, and the app's own `_n`: the emboss writes G = −dh/dy with y running down), or
  // "normal-gl", green UP (OpenGL).
  FROM: ["depth", "normal-dx", "normal-gl"],
  heightFrom(surf){ const m = surf && surf.heightFrom; return Relief.FROM.includes(m) ? m : "depth"; },
  // The image the height is read from: the map itself, or the height derived from a normal map.
  // `holder` is whatever carries `heightMap` — a decal, its image content, or a projection.
  heightImage(holder, surf){
    const hm = holder && holder.heightMap, from = Relief.heightFrom(surf);
    if (!hm || from === "depth") return hm || null;
    let c = Relief._nm.get(hm);
    if (!c || c.from !== from) { c = { from, canvas: Relief.fromNormal(hm, from === "normal-gl") }; Relief._nm.set(hm, c); }
    return c.canvas;
  },
  _nm: new WeakMap(),
  // Integrated at no more than this on the longer side. Measured under Node on a synthetic map
  // (2026-09-24): 87 ms at 1024², 358 ms at 2048² — and §3.5 draws the line at 200. The height is
  // stretched onto the decal's own bitmap anyway, which is rarely drawn wider than this on a sheet.
  NM_MAX: 1024,
  nmPixels(img){
    const k = Math.min(1, Relief.NM_MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    return { d: g.getImageData(0, 0, w, h).data, w, h };
  },
  // Does this look like a tangent-space normal map? Blue-dominant, and nearly every texel a unit
  // vector facing out of the surface. A greyscale depth map fails the first by construction (b = r =
  // g), and a photograph fails the second almost everywhere.
  looksNormal(d, w, h){
    let n = 0, unit = 0, out = 0, blue = 0;
    const step = Math.max(1, Math.floor(w * h / 65536));
    for (let i = 0; i < w * h; i += step) {
      if (d[i*4 + 3] <= 8) continue;
      const x = d[i*4] / 127.5 - 1, y = d[i*4 + 1] / 127.5 - 1, z = d[i*4 + 2] / 127.5 - 1;
      n++;
      if (Math.abs(Math.hypot(x, y, z) - 1) < .2) unit++;
      if (z > .3) out++;
      blue += d[i*4 + 2] - (d[i*4] + d[i*4 + 1]) / 2;
    }
    return n > 0 && unit >= .85 * n && out >= .9 * n && blue / n > 40;
  },
  // The slopes a normal map describes, per texel: dh/dx, and dh/dy with y running DOWN the image.
  // Z is rebuilt from X and Y the way the game reads its own `_n` and the preview shader does, so a
  // map whose blue was never normalised reads the same as one whose was. Clamped at z = 0.2, a slope
  // of 5: past that an 8-bit normal says "steep" and nothing more.
  // The MEAN slope is removed. A tool that writes flat as 127 rather than 127.5 has tilted every
  // texel by 0.4 %, which is nothing per texel and a ramp across the whole height once integrated.
  slopes(d, w, h, greenUp){
    const P = new Float32Array(w * h), Q = new Float32Array(w * h);
    let mp = 0, mq = 0, n = 0;
    for (let i = 0; i < w * h; i++) {
      if (d[i*4 + 3] <= 8) continue;                        // cut away: flat
      const x = d[i*4] / 127.5 - 1, y = (d[i*4 + 1] / 127.5 - 1) * (greenUp ? -1 : 1);
      const z = Math.sqrt(Math.max(.04, 1 - x * x - y * y));
      P[i] = -x / z; Q[i] = -y / z; mp += P[i]; mq += Q[i]; n++;
    }
    if (n) { mp /= n; mq /= n; for (let i = 0; i < w * h; i++) if (d[i*4 + 3] > 8) { P[i] -= mp; Q[i] -= mq; } }
    return { P, Q, w, h };
  },
  // Coarser copies of a slope field, each half the size, down to 16 texels. The mean of a 2×2
  // block's slopes is the slope of the averaged surface, so each level is the same surface seen from
  // further away, and the solve runs coarse to fine over them.
  pyramid(F){
    const lv = [F];
    for (let a = F; Math.max(a.w, a.h) > 16; ) {
      const W = (a.w + 1) >> 1, H = (a.h + 1) >> 1, P = new Float32Array(W * H), Q = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sp = 0, sq = 0, n = 0;
        for (let Y = 2 * y; Y < Math.min(a.h, 2 * y + 2); Y++)
          for (let X = 2 * x; X < Math.min(a.w, 2 * x + 2); X++) { sp += a.P[Y * a.w + X]; sq += a.Q[Y * a.w + X]; n++; }
        P[y * W + x] = sp / n; Q[y * W + x] = sq / n;
      }
      lv.push(a = { P, Q, w: W, h: H });
    }
    return lv;
  },
  // Which way the green channel points — asked of the image, not guessed, which is the trap the item
  // named. A real slope field has no CURL: round any 2×2 loop of texels the rises and falls sum to
  // zero. Read with the wrong green sign it has one wherever the surface varies both ways at once —
  // a rivet, the corner of a letter — so each loop votes for the reading it closes better under.
  // Only loops where both terms carry signal vote, which leaves out 8-bit noise and UV seams, and
  // every level of the pyramid votes, because a broad feature's slope changes too slowly per texel
  // at full size to clear the noise. Straight lines along the axes cannot decide it and do not vote:
  // a surface that varies one way only reads as a surface either way.
  // Measured 2026-09-24: 99.7-100 % of the votes go the right way on a synthetic map of rivets, a
  // groove and a raised block, encoded either way. On 20 `_n` sheets from installed skins — baked,
  // seamed and BC-compressed, the hardest case there is — 11 lean down, 3 up and 6 are too close to
  // call, which is why `detect` asks for a clear majority and otherwise reads the app's own way.
  votes(lv){
    let down = 0, up = 0;
    for (const { P, Q, w, h } of lv) for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const A = (P[i] + P[i + 1]) - (P[i + w] + P[i + w + 1]), B = (Q[i + 1] + Q[i + w + 1]) - (Q[i] + Q[i + w]);
      const lo = Math.min(Math.abs(A), Math.abs(B)), hi = Math.max(Math.abs(A), Math.abs(B));
      if (lo < .06 || hi > 1.2) continue;
      if (Math.abs(A + B) < Math.abs(A - B)) down++; else up++;
    }
    return { down, up };
  },
  // What a freshly loaded file is: a depth map, or a normal map and which way its green points.
  // For a normal map it also leaves the height it decided on in the cache, so a load decodes and
  // integrates once rather than twice: the other reading is the same pyramid with every Q negated,
  // because the mean, the 2×2 average and the sign all commute.
  detect(img){
    const { d, w, h } = Relief.nmPixels(img);
    if (!Relief.looksNormal(d, w, h)) return { from: "depth" };
    const lv = Relief.pyramid(Relief.slopes(d, w, h, false));
    const v = Relief.votes(lv), n = v.down + v.up;
    const sure = n >= 40 && Math.max(v.down, v.up) >= .7 * n;
    const from = sure && v.up > v.down ? "normal-gl" : "normal-dx";
    if (from === "normal-gl") for (const F of lv) for (let i = 0; i < F.Q.length; i++) F.Q[i] = -F.Q[i];
    Relief._nm.set(img, { from, canvas: Relief.heightOf(lv, d, w, h) });
    return { from, sure, down: v.down, up: v.up };
  },
  // The height whose slopes best match the field, in the least-squares sense: each texel becomes
  // (its neighbours + the rises along the edges to them) / how many it has, repeated. Solved to
  // convergence on the coarsest level and carried up, where a few sweeps put in what the finer texels
  // add. The image's edges are free — nothing outside pulls on them — which is what a decal wants.
  // Measured on the synthetic map at 1024²: 0.996 correlation with the true height from exact
  // normals, and 8 sweeps land within 0.998 of 300. From an 8-BIT normal map it is 0.955 overall and
  // 0.995 in the detail — the loss is the file's, not the solve's: a slope smaller than one 8-bit
  // step is not in the file, so the broadest curvature of a large map cannot come back.
  integrate(lv){
    let Z = null;
    for (let L = lv.length - 1; L >= 0; L--) {
      const { w, h } = lv[L];
      const z = Z ? Relief.upsample(Z, lv[L + 1], w, h) : new Float32Array(w * h);
      Relief.relax(z, lv[L], 1 << L, L === lv.length - 1 ? 400 : 8);
      Z = z;
    }
    return Z;
  },
  upsample(Z, c, w, h){
    const z = new Float32Array(w * h), cw = c.w, ch = c.h;
    for (let y = 0; y < h; y++) {
      const fy = Math.min(ch - 1, Math.max(0, (y - .5) / 2)), y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(cw - 1, Math.max(0, (x - .5) / 2)), x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0;
        z[y * w + x] = (Z[y0 * cw + x0] * (1 - tx) + Z[y0 * cw + x1] * tx) * (1 - ty) + (Z[y1 * cw + x0] * (1 - tx) + Z[y1 * cw + x1] * tx) * ty;
      }
    }
    return z;
  },
  // `n` red-black sweeps over one level, over-relaxed. `s` is how many full-size texels one of this
  // level's spans, which is what turns its slopes into rises between neighbours. The interior —
  // four neighbours, no bounds to test — runs as its own loop, and the border goes through `relaxAt`;
  // the sums are added in the same order either way, so the two agree to the bit.
  relax(z, F, s, n){
    const { P, Q, w, h } = F, b = new Float32Array(w * h), deg = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) { const g = (P[i] + P[i + 1]) / 2 * s; b[i] -= g; b[i + 1] += g; deg[i]++; deg[i + 1]++; }
      if (y < h - 1) { const g = (Q[i] + Q[i + w]) / 2 * s; b[i] -= g; b[i + w] += g; deg[i]++; deg[i + w]++; }
    }
    for (let it = 0; it < n; it++) for (let par = 0; par < 2; par++) for (let y = 0; y < h; y++) {
      const x0 = (y + par) & 1, row = y * w;
      if (y === 0 || y === h - 1 || w < 3) { for (let x = x0; x < w; x += 2) Relief.relaxAt(z, b, deg, row + x, x, y, w, h); continue; }
      if (!x0) Relief.relaxAt(z, b, deg, row, 0, y, w, h);
      for (let i = row + (x0 || 2), end = row + w - 1; i < end; i += 2)
        z[i] += 1.6 * ((b[i] + z[i - 1] + z[i + 1] + z[i - w] + z[i + w]) / 4 - z[i]);
      if (!((w - 1 - x0) & 1)) Relief.relaxAt(z, b, deg, row + w - 1, w - 1, y, w, h);
    }
  },
  relaxAt(z, b, deg, i, x, y, w, h){
    let t = b[i];
    if (x > 0) t += z[i - 1];
    if (x < w - 1) t += z[i + 1];
    if (y > 0) t += z[i - w];
    if (y < h - 1) t += z[i + w];
    if (deg[i]) z[i] += 1.6 * (t / deg[i] - z[i]);
  },
  // A normal map's height as an image the relief reads like any depth map: grey = height, alpha =
  // the map's own. Stretched to the full 8 bits over its central 99.8 %, so one outlier — a seam,
  // a texel the solve could not reconcile — does not squash the rest into a few grey levels.
  fromNormal(img, greenUp){
    const { d, w, h } = Relief.nmPixels(img);
    return Relief.heightOf(Relief.pyramid(Relief.slopes(d, w, h, greenUp)), d, w, h);
  },
  // A normal map turned or mirrored AS AN IMAGE has every texel in its new place and every vector
  // still pointing the old way: a slope facing right, turned a quarter, must face down. So the
  // vectors get the same turn the pixels had — `c` is already turned, and this is done in place.
  // `rot` is clockwise on screen and the mirror comes first, which is the order the decal editor
  // draws in (`DecalEd.orient`). Worked about 127.5, so a mirror is exactly 255 − R and a quarter
  // turn exactly swaps a channel with the other's complement: no rounding at all. (Why the file is
  // kept as a normal map and not converted to height here: its reading can be changed at any time,
  // 4.19(5).) ROADMAP 4.2b's review (2026-09-26).
  turnNormals(c, rot, flip, greenUp){
    const q = ((Math.round(rot / 90) % 4) + 4) % 4, cs = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
    if (!q && !flip) return c;
    const g = ctx2d(c), img = g.getImageData(0, 0, c.width, c.height), d = img.data, gy = greenUp ? -1 : 1;
    for (let i = 0; i < d.length; i += 4) {
      let x = d[i] - 127.5;
      const y = gy * (d[i+1] - 127.5);                    // image axes, y running down
      if (flip) x = -x;
      d[i] = Math.round(x * cs - y * sn + 127.5);
      d[i+1] = Math.round(gy * (x * sn + y * cs) + 127.5);
    }
    g.putImageData(img, 0, 0);
    return c;
  },
  heightOf(lv, d, w, h){
    const Z = Relief.integrate(lv);
    let lo = Infinity, hi = -Infinity, n = 0;
    for (let i = 0; i < w * h; i++) if (d[i*4 + 3] > 8) { if (Z[i] < lo) lo = Z[i]; if (Z[i] > hi) hi = Z[i]; n++; }
    const hist = new Uint32Array(1024), k = 1023 / ((hi - lo) || 1);
    for (let i = 0; i < w * h; i++) if (d[i*4 + 3] > 8) hist[((Z[i] - lo) * k) | 0]++;
    let a = 0, b = 1023, c = 0;
    while (a < 1023 && c + hist[a] <= n * .001) c += hist[a++];
    for (c = 0; b > a && c + hist[b] <= n * .001; ) c += hist[b--];
    const z0 = lo + a / k, span = Math.max(1e-6, (b + 1 - a) / k);
    const out = mkCanvas(w, h), g = ctx2d(out), im = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      im.data[i*4] = im.data[i*4 + 1] = im.data[i*4 + 2] = Math.max(0, Math.min(255, Math.round((Z[i] - z0) / span * 255)));
      im.data[i*4 + 3] = d[i*4 + 3];
    }
    g.putImageData(im, 0, 0);
    return out;
  },

  // ---- Cavity (ROADMAP 4.19(4)): the depth map's hollows darken the decal's own colour ----
  // Under flat hangar light a normal perturbation barely reads; what makes the eye see a groove is
  // that it is DARKER. That is ambient occlusion, and its cheap, honest form is a blur-and-difference
  // of the height: a texel lower than its neighbourhood is in a hollow, by how much lower it is.
  //
  // **It is baked into the colour, and in the decal's own image space** — the same place the outline
  // and the shadow are (DecalStyle), for the same reason: then the stamp, the projector and the export
  // all carry it with nothing new to learn, and a rotated, mirrored or projected decal is shaded the
  // way it is drawn. Nothing here is preview-only; the game sees exactly these pixels in the albedo.
  //
  // **Only with a depth map.** "From the edge" and "Bevelled body" describe a raised marking with no
  // hollow inside it — a flat top, or a dome — so a cavity there is zero everywhere by construction,
  // and offering the slider would offer a control that does nothing. Blur-and-difference also never
  // darkens a marking's rim from the outside's zero height: that makes the neighbourhood LOWER, not
  // higher, so the marking's own edge stays lit (t58 holds 6 px in).
  cavity(surf){ const v = Math.round(+(surf && surf.cavity)); return isFinite(v) && v > 0 ? Math.min(100, v) : 0; },
  // What the colour has to be shaded by, for `holder` — whatever DecalStyle.bitmap was handed as the
  // owner of the bitmap: an image content, or a projection's shared parameters. Both carry the map.
  cavityOf(surf, holder){
    const k = Relief.cavity(surf);
    if (!k || Relief.mode(surf) !== "map" || !holder || !holder.heightMap) return null;
    return { k, hm: Relief.heightImage(holder, surf), inv: !!(surf && surf.heightInv) };
  },
  // The blur's reach, as a share of the decal's shorter side, like every other width the Look has —
  // so a Look reads the same on a 200-px panel and a 2000-px one. 1.5 % puts a rivet's worth of
  // shading into the corners of a recess without greying the floor of a wide one.
  CAV_REACH: .015,
  // `bmp` with its colour darkened where the height has a hollow. Same size, same alpha.
  cavityImage(bmp, cav){
    const w = bmp.width, h = bmp.height;
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.drawImage(cav.hm, 0, 0, w, h);                          // the map is stretched onto the decal
    const hd = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < w * h; i++) { hd[i*4] = Relief.heightAt(hd, i, cav.inv); hd[i*4+3] = d[i*4+3]; }
    // The height the emboss reads, stretched the same way (Relief.field), so the two agree on where
    // the hollows are. Outside the marking it is 0 — the surface the decal sits on.
    const H = Relief.field(hd, w, h, "map");
    const r = Math.max(2, Math.round(Math.min(w, h) * Relief.CAV_REACH));
    const B = Relief.boxBlur(Relief.boxBlur(H, w, h, r), w, h, r);   // twice: a tent, not a box
    const s = cav.k / 100;
    for (let i = 0; i < w * h; i++) {
      const hollow = (B[i] - H[i]) / 255;
      if (hollow <= 0 || !d[i*4+3]) continue;
      // A hollow half the map's range deep already reads as a crevice; at full strength it is black.
      const f = 1 - s * Math.min(1, hollow * 2);
      d[i*4] = Math.round(d[i*4] * f); d[i*4+1] = Math.round(d[i*4+1] * f); d[i*4+2] = Math.round(d[i*4+2] * f);
    }
    g.putImageData(img, 0, 0);
    return c;
  },
  // A separable box blur of radius `r` with running sums, so its cost is O(n) whatever `r` is.
  // Outside the array counts as 0 — the surface around the decal — and the divisor is the full
  // window, so an edge is pulled down rather than renormalised back up.
  boxBlur(A, w, h, r){
    const n = 2 * r + 1, T = new Float32Array(w * h), O = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      for (let x = 0; x <= Math.min(r, w - 1); x++) s += A[row + x];
      for (let x = 0; x < w; x++) {
        T[row + x] = s / n;
        if (x + r + 1 < w) s += A[row + x + r + 1];
        if (x - r >= 0) s -= A[row + x - r];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = 0; y <= Math.min(r, h - 1); y++) s += T[y * w + x];
      for (let y = 0; y < h; y++) {
        O[y * w + x] = s / n;
        if (y + r + 1 < h) s += T[(y + r + 1) * w + x];
        if (y - r >= 0) s -= T[(y - r) * w + x];
      }
    }
    return O;
  },

  // Distance to the nearest texel outside the decal, by a two-pass chamfer over the footprint box.
  // Exact Euclidean would be Felzenszwalb; a 3-4 chamfer is within a few percent, is O(n) with two
  // linear sweeps, and a bevel ramp cannot show the difference. Distances are in thirds of a texel
  // so both weights stay integral. With `outside`, the other way round — every texel's distance to
  // the nearest one INSIDE the decal — which is what a disc dilation is (`DecalStyle.ring`).
  chamfer(fa, w, h, outside){
    const D = new Int32Array(w * h);
    const BIG = 1 << 28;
    for (let i = 0; i < w * h; i++) D[i] = ((fa[i*4 + 3] > 8) !== !!outside) ? BIG : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!D[i]) continue;
      let m = D[i];
      if (y > 0) { m = Math.min(m, D[i - w] + 3); if (x > 0) m = Math.min(m, D[i - w - 1] + 4); if (x < w - 1) m = Math.min(m, D[i - w + 1] + 4); }
      if (x > 0) m = Math.min(m, D[i - 1] + 3);
      D[i] = m;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!D[i]) continue;
      let m = D[i];
      if (y < h - 1) { m = Math.min(m, D[i + w] + 3); if (x > 0) m = Math.min(m, D[i + w - 1] + 4); if (x < w - 1) m = Math.min(m, D[i + w + 1] + 4); }
      if (x < w - 1) m = Math.min(m, D[i + 1] + 3);
      D[i] = m;
    }
    return D;
  },

  // The height field over the footprint box, 0..255 per texel.
  field(fa, w, h, mode, bevel){
    const H = new Uint8Array(w * h);
    if (mode === "map") {
      // Stretched to the range the decal actually covers. An externally generated depth map is
      // normalised to its own frame, not to the crop that ended up on the sticker, so without this a
      // marking taken from the middle of one arrives almost flat. Texels outside the decal are not
      // counted — they are the masked-away background, and including them would peg the low end at 0
      // and undo the stretch.
      let lo = 255, hi = 0;
      for (let i = 0; i < w * h; i++) {
        if (fa[i*4 + 3] <= 8) continue;
        const v = fa[i*4];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const span = hi - lo;
      // A genuinely flat map has no relief to recover, and stretching it would amplify its noise.
      const k = span >= 8 ? 255 / span : 0;
      for (let i = 0; i < w * h; i++)
        H[i] = k ? Math.max(0, Math.min(255, Math.round((fa[i*4] - lo) * k))) * (fa[i*4 + 3] > 8 ? 1 : 0)
                 : fa[i*4];
      return H;
    }
    if (mode !== "bevel") { for (let i = 0; i < w * h; i++) H[i] = fa[i*4 + 3]; return H; }
    const D = Relief.chamfer(fa, w, h);
    const lim = Math.max(1, bevel) * 3;                       // chamfer units are thirds of a texel
    for (let i = 0; i < w * h; i++) {
      const a = fa[i*4 + 3];
      if (!a) { H[i] = 0; continue; }
      const t = Math.min(1, D[i] / lim);
      // A quarter-circle ramp rather than a straight chamfer: it reads as a rounded, thick sticker,
      // and it is flat in the middle, so the body carries no gradient and therefore no false lighting.
      H[i] = Math.round(Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) * a);
    }
    return H;
  },
};
// One derived layer's pixels: whatever the channel already shows, plus this decal's delta.
// `under` is the channel as it composites WITHOUT this layer, so stacking two stickers accumulates
// the way the destructive bake did rather than the second one erasing the first.
function renderSurfLayer(canvas, under, foot, key, delta, relief){
  const { x, y, w, h } = foot;
  if (w <= 2 || h <= 2) return false;
  const fa = ctx2d(foot.canvas).getImageData(x, y, w, h).data;
  const src = ctx2d(under).getImageData(x, y, w, h);
  const out = ctx2d(canvas).createImageData(w, h);
  const cl = v => Math.max(0, Math.min(255, v));
  // One value per texel, whatever it was derived from (ROADMAP 4.19). Only the emboss reads it;
  // smoothness and metalness are still driven by coverage, which is what they mean.
  const mode = (relief && relief.mode) || "edge";
  const H = key === "em" ? Relief.field(fa, w, h, mode, (relief && relief.bevel) || 6) : null;
  const gain = mode === "map" ? Relief.MAP_GAIN : 1;
  // The gloss weight per texel: 1 over the whole marking, or its luminance (or the inverse) — the
  // integer Rec. 709 weights the blend-if band uses, off the footprint's own unpremultiplied colour.
  const gsrc = key === "sm" && relief ? relief.gloss : "cover";
  let touched = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * w + i) * 4;
    if (key === "em") {
      if (i === 0 || i === w - 1 || j === 0 || j === h - 1) continue;
      const p = j * w + i;
      const gx = (H[p + 1] - H[p - 1]) / 255 * gain;         // d(height)/dx
      const gy = (H[p + w] - H[p - w]) / 255 * gain;
      if (!gx && !gy) continue;
      out.data[k]     = cl(src.data[k]     - gx * delta * 14);
      out.data[k + 1] = cl(src.data[k + 1] - gy * delta * 14);
      out.data[k + 2] = src.data[k + 2];
      out.data[k + 3] = 255;
      touched++;
    } else {
      const a = fa[k + 3] / 255;
      if (a <= 0.003) continue;                              // the bake's own threshold
      const lum = gsrc === "cover" ? 1 : (fa[k] * 2126 + fa[k + 1] * 7152 + fa[k + 2] * 722) / 2550000;
      const v = cl(src.data[k] + delta * a * (gsrc === "dark" ? 1 - lum : lum));
      out.data[k] = out.data[k + 1] = out.data[k + 2] = v;
      out.data[k + 3] = 255;
      touched++;
    }
  }
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.putImageData(out, x, y);
  return touched > 0;
}
// ---------- ROADMAP 4.28(f): the response lives IN the decal, not beside it ----------
// It used to be three sibling LAYERS in a group made for the purpose, each tagged `surfKey` and
// pointing back at its decal through `surfFor`. That folder was the model's own workaround: "one
// thing, several channels, moving together" had no way to be said, so it was faked with a container
// and two back-references, and then a rule had to be invented to stop the user dragging either half
// out of it (4.18) — a refusal that existed only because the halves found each other by *position*.
//
// (b) made a layer a bundle of per-channel content and (e) let it carry more than one. A decal's
// response is now exactly that: the same node whose colour slot holds the image also holds the
// derived smoothness, metalness and normal, marked `derived` so a rebuild knows what it may replace.
// So `surfKey`, `surfFor`, `decalSurfGroup`, `surfHome`, the folder that was created and garbage
// collected around every projected decal, and the whole "do not drag this out" rule are **gone**
// rather than ported. Nothing can be dragged out of a node.
//
// **The pixels are unchanged and t58 still says so.** What did change, deliberately: the decal's own
// opacity now fades its response too, because they are one layer. That is what "the gloss and the
// raised edge move, fade, hide and delete with the sticker" said in the first place; it was only
// ever true of hide and delete, because the group's opacity and the decal's were two numbers.
function derivedOn(L, ch){
  const c = LayerNode.contentOn(L, ch);
  return c && c.derived ? c : null;
}
function hasDerived(L){
  return !!(L && L.chans && Object.values(SURF_DELTA_CHAN).some(ch => derivedOn(L, ch)));
}
// Build or refresh every derived content for `L`. Called when the look is applied and again
// whenever the decal moves — they are derived, so a stale one is a gloss highlight left behind on
// the fuselage where the sticker used to be.
function refreshDecalSurface(slot, L){
  if (!slot || !L || !LayerNode.isLayer(L)) return false;
  const surf = surfOf(L);
  const d = surfDeltas(surf);
  // How the emboss gets its height, and — for an imported map — the image it comes from, stamped
  // through the decal's own transform so it lands exactly where the decal does (ROADMAP 4.19).
  const relief = { mode: Relief.mode(surf), bevel: Relief.bevel(surf), gloss: Relief.gloss(surf) };
  let hsrc = relief.mode === "map" ? Relief.source(L, surf) : null;
  if (relief.mode === "map" && !hsrc) relief.mode = "edge";   // a map that is not there is not a mode
  // A projected decal's own sheet is its footprint — but that sheet carries the shadow too, and
  // gloss and a raised edge belong to the marking, not to the shadow beside it. So with a shadow on
  // the Look, the shadowless styled bitmap is sent through the projector for the footprint instead,
  // the same road a height source takes (and the same one, when there is one).
  const img0 = LayerNode.contentOn(L, "color");
  if (!hsrc && img0 && img0.proj && DecalStyle.read(surf).sh > 0)
    hsrc = DecalStyle.bitmap(L.proj.bmp, surf, L.proj, true);
  let any = false;
  for (const key in SURF_DELTA_CHAN) {
    const ch = SURF_DELTA_CHAN[key];
    const base = chanBase(slot, ch);
    // Only ever a content this function wrote. A user's own smoothness paint in the same layer is
    // not ours to replace or delete, and after (f) it can be sitting in exactly that slot.
    const existing = derivedOn(L, ch);
    if (!d[key] || !base) {                                   // the look no longer writes this one
      if (existing) LayerNode.removeContent(L, ch);
      continue;
    }
    // What this channel shows WITHOUT our own content in the way, so two stickers accumulate the way
    // the destructive bake did rather than the second erasing the first. `chanOut` hands back the
    // cached composite, so the channel has to be rebuilt with the content hidden — hiding it and
    // reading the cache would read our own last result straight back in and compound it every time
    // the decal moved. Content-level `visible` is what (f) added to the compositor for this.
    const wasVisible = existing ? existing.visible !== false : true;
    if (existing) { existing.visible = false; Composite.sheet(slot, ch, null); }
    const under = chanOut(slot, ch) || base;
    const img = LayerNode.contentOn(L, "color");
    // The projected path takes `hsrc` for every key: a height source's alpha is the shadowless
    // coverage too (Relief.source), so it answers "where is the marking" as well as "how high".
    // A gloss that follows the image reads the footprint's COLOUR, and a projected decal with a depth
    // map sends the map through the projector as its footprint — so for that one pairing the colour
    // goes through instead (shadowless, when the Look has a shadow; the layer itself otherwise).
    // With a cavity on the Look the layer is SHADED ink (4.19(4)), and brightness-following gloss must
    // read the ink — so the unshaded image goes through then too.
    const colour = key === "sm" && relief.gloss !== "cover" && relief.mode === "map" && img && img.proj;
    const plain = DecalStyle.read(surf).sh > 0 || Relief.cavity(surf) > 0;
    const psrc = colour ? (plain ? DecalStyle.bitmap(L.proj.bmp, surf, L.proj, true) : null) : hsrc;
    const foot = (img && img.proj) ? projFootprint(L, base.width, base.height, psrc)
                                   : decalFootprint(L, base.width, base.height, key === "em" ? hsrc : null);
    if (!foot) { if (existing) existing.visible = wasVisible; continue; }
    const c = existing || LayerNode.content("paint", { derived: key, canvas: mkCanvas(base.width, base.height) });
    if (!c.canvas || c.canvas.width !== base.width || c.canvas.height !== base.height)
      c.canvas = mkCanvas(base.width, base.height);
    const drew = renderSurfLayer(c.canvas, under, foot, key, d[key], relief);
    c.visible = wasVisible;
    if (!existing && drew) LayerNode.addContent(L, ch, c);
    any = any || drew;
  }
  L._thumb = null; L._thumbRev = -1;
  scheduleComposite(slot); scheduleChannels(slot);
  return any;
}
// ---------- The same thing, for a decal projected onto the model (ROADMAP 4.8b) ----------
// One projected decal is already "one object spread over several sheets", so its Look is rebuilt
// per sheet from the projection's own parameters, exactly the way its colour layers are.
//
// **Nothing here pushes an undo entry, and that is the point.** A projection's history works by
// re-rendering from the old parameters (`updateProjGroup`), so this function runs INSIDE undo and
// redo — a "group layers" step pushed from in there would be a step the user never took, on a stack
// that was mid-traversal. It also leaves the selection alone, which `groupNodes` would not: moving
// it to the folder is the regression 4.8 was reported for on its first day.
function refreshProjSurfaces(P){
  if (!P) return 0;
  let n = 0;
  for (const slot of App.slots.values()) {
    // This projection's layer on this sheet. It used to need "and not one of its derived siblings",
    // because those carried `proj` through the group they sat in; since 4.28(f) there are no
    // siblings and the response is in this same node, so the search is the obvious one again.
    let L = null;
    for (const x of layerLeaves(slot.layers)) if (x.proj === P) { L = x; break; }
    if (!L) continue;
    // `projEmpty` covers the sheet a decal has moved off: the layer stays (an empty layer is cheap,
    // re-adding one later would silently move it to the top of the stack) but there is no footprint
    // on it any more, so there is nothing for a response to sit on either.
    const want = surfHasResponse(P.surf, slot) && !L.projEmpty && L.projBox;
    if (!want) {
      // The look was turned off, or the decal has moved off this sheet. Drop what we derived and
      // leave everything else in the layer alone. No folder to garbage-collect any more, which is
      // the whole of what the three deleted blocks here used to do — and the reason a folder could
      // be left holding layers the user had dragged into it is gone with them.
      // Every channel in the table, not a list of three: this loop named smooth, metal and normal
      // until 2026-09-26, so a Custom look's Paint Δ kept stripping paint (175 against 255 on t58's
      // sheet) after its Look was set to None or the decal left the sheet.
      for (const ch of Object.values(SURF_DELTA_CHAN)) if (derivedOn(L, ch)) LayerNode.removeContent(L, ch);
      scheduleComposite(slot); scheduleChannels(slot);
      continue;
    }
    if (refreshDecalSurface(slot, L)) n++;
  }
  refreshLayerList();
  return n;
}
// ---------- what a decal's surface response does WHILE the decal is moving (ROADMAP 4.8c) ----------
// Reported as "moving a decal leaves behind imprint of its impact to the normal channel until it is
// placed". For the length of a drag the derived layers are **stale** — they were built from where
// the decal used to be — so a gloss highlight and a raised edge sit on the fuselage where the
// sticker was. Rebuilding them per frame is a per-pixel walk per channel the Look writes (up to
// four) and a channel composite per sheet, which is exactly the cost 4.8b deferred on purpose; the
// deferral is right and showing the old answer for the whole gesture is not. So they are hidden for
// the length of the gesture.
//
// **The hidden set lives on the gesture, not on the layers.** A pointercancel, a slot switch or an
// undo mid-drag all have to put visibility back, and a flag on the layer survives every one of
// them — which would be a layer the user cannot turn on again by any control the app has.
const SurfDrag = {
  key: null,                                                  // the decal or projection being moved
  held: null,
  // `match` decides which LAYER belongs to this gesture: one decal, or one projection across every
  // sheet it touches. What is hidden is the derived CONTENT inside it — since 4.28(f) the response
  // is channel slots of the decal's own node, one per `SURF_DELTA_CHAN` entry, so hiding the layer
  // would hide the decal with them, which is the one thing this must not do. Re-holding the same
  // key is a no-op, because this is called per frame. (The loop named three channels until
  // 2026-09-26, so the paint half of a Look stayed on the mask where the decal had been, mid-drag.)
  hold(key, match){
    if (SurfDrag.key === key) return false;
    SurfDrag.release();
    const held = [];
    for (const slot of App.slots.values())
      for (const x of layerLeaves(slot.layers)) {
        if (!match(x)) continue;
        for (const ch of Object.values(SURF_DELTA_CHAN)) {
          const c = derivedOn(x, ch);
          if (c && c.visible !== false) { held.push({ c, slot }); c.visible = false; }
        }
      }
    SurfDrag.key = key;
    SurfDrag.held = held.length ? held : null;
    for (const h of held) { scheduleComposite(h.slot); scheduleChannels(h.slot); }
    return !!held.length;
  },
  // Always safe to call, and it has to be: it runs from the commit, from the cancel and from the
  // start of any other gesture. Only what this hid is touched — a content the user hid themselves
  // mid-drag never entered `held`, because `hold` only takes visible ones.
  release(){
    const held = SurfDrag.held;
    SurfDrag.key = null; SurfDrag.held = null;
    if (!held) return false;
    for (const h of held) { h.c.visible = true; scheduleComposite(h.slot); scheduleChannels(h.slot); }
    return true;
  },
};
// A decal is PUT DOWN by being moved — dragged in 2-D, or dropped with "Move to clicked spot". That
// is the moment a Look chosen in the editor becomes real, because until then the decal floats at the
// sheet centre and there is nothing to derive a surface response from. Called from both places, and
// quiet: it derives the response the first time and refreshes it every time after.
function ensureDecalSurface(slot, L){
  if (!slot || !L || L.type !== "decal") return false;
  if (hasDerived(L)) return refreshDecalSurface(slot, L);
  if (!surfHasResponse(L.surf, slot)) return false;
  return applyDecalSurface(slot, L);
}
// Other decals in the same group move with this one — a roundel and its serial, say — so the
// arrangement survives (requested 2026-08-26). The group is the user's own since 4.28(f); the
// derived response is no longer in it, because it is in the decal. Paint layers are deliberately
// left alone: translating one means resampling its pixels, which is lossy and not something to do
// silently as a side effect of nudging a sticker.
function moveDecalSiblings(slot, L, dx, dy){
  const G = groupOwning(slot.layers, L);
  if (!G || (!dx && !dy)) return 0;
  let n = 0;
  for (const c of layerLeaves(G.children)) {
    if (c === L || c.type !== "decal") continue;
    c.x = Math.max(0, Math.min(1, c.x + dx));
    c.y = Math.max(0, Math.min(1, c.y + dy));
    if (c.sym) { c.sym.x = Math.max(0, Math.min(1, c.sym.x + dx)); c.sym.y = Math.max(0, Math.min(1, c.sym.y + dy)); }
    refreshDecalSurface(slot, c);
    n++;
  }
  return n;
}
// The command behind "Apply" in the sidebar and behind placing a decal that already carries a Look.
// Non-destructive: nothing is written into the slot's own _n sheets, so the surface response can be
// faded, masked, hidden or thrown away like anything else in the stack.
function applyDecalSurface(slot, L){
  if (!slot || !L || L.type !== "decal") { setStatus("Select a decal layer first", "err"); return false; }
  if (!surfHasResponse(L.surf)) {
    setStatus("This look changes nothing — " + Object.keys(SURF_DELTA_CHAN).map(k => SURF_LABEL[k]).join(", ") +
      " are all 0, so there is no surface response to apply", "err");
    return false;
  }
  // Not "is there an _n" any more: wear is the albedo's alpha, so a look can be applicable on a slot
  // with no _n at all. The message names what is missing rather than assuming which half it was.
  if (!surfHasResponse(L.surf, slot)) {
    const d = surfDeltas(L.surf);
    const miss = Object.keys(SURF_DELTA_CHAN).filter(k => d[k] && !chanBase(slot, SURF_DELTA_CHAN[k]));
    setStatus("“" + slot.id + "” has no " + (miss.some(k => k !== "wr") ? "_n surface map" : "albedo") +
      " loaded, so there is nothing for this look's " + miss.map(k => SURF_LABEL[k]).join(" or ") +
      " to write to", "err");
    return false;
  }
  // No folder to make any more (4.28(f)) — the response goes into this layer's own channel slots,
  // so there is nothing to wrap, nothing to fold, and nothing to select by accident. The three
  // paragraphs that used to be here, about not moving the selection to the group and about folding
  // it on creation, describe a problem that cannot occur.
  withUndoBatch("apply surface response", () => {
    // The derived contents are rebuilt rather than snapshotted, so undo restores the structure and
    // the next refresh restores the pixels — a canvas per channel per step would be 200 MB at 4K.
    refreshDecalSurface(slot, L);
  });
  refreshLayerList();
  const d = surfDeltas(L.surf);
  const bits = [];
  for (const k in SURF_DELTA_CHAN) if (d[k]) bits.push(SURF_LABEL[k] + " " + (d[k] > 0 ? "+" : "") + d[k]);
  setStatus("Surface response applied (" + bits.join(", ") + ") — it is part of this layer now, on the channels it writes, " +
    "so it moves, fades, hides and deletes with the decal. Nothing is written into the slot's own _n.", "ok");
  return true;
}
/*==ENDDECALSURF==*/
