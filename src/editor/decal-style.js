// ---------- Layer styles for a decal: an outline and a drop shadow (ROADMAP 4.44, sixth candidate) ----------
// A serial with a contrasting outline is the standard aircraft marking, and until now it was two
// decals or a trip to an image editor. Both styles are part of the decal's **Look** (`surf`, beside
// gloss, emboss and the relief), so they travel where the Look already does — a projection's shared
// parameters, `projParamsClone` and therefore Ctrl+Z, and the `.wtproj`.
//
// **They are rendered in the decal's own image space, not on the sheet.** The styled bitmap — shadow
// under outline under the image, padded so nothing is cut off, with the SAME centre as the source —
// is what every path draws: the compositor's stamp, the GPU projector and the footprint the Look's
// derived channels are built from. That is what makes an outline the same width all the way round
// a marking wrapped over a fuselage, and a shadow fall the same way on both halves of a mirrored
// pair: the projector already knows how to put an image on the model, so the outline only has to be
// part of the image. Widths are a percentage of the decal's shorter side rather than pixels, so the
// same Look reads the same on a 200-px roundel and a 2000-px one.
//
// The outline is a true disc dilation, not eight offset copies: the chamfer distance outside the
// shape (`Relief.chamfer`, seeded the other way round) gives every texel its distance to the marking
// in one linear pass, and the ring is `r − distance`, clamped — antialiased at its outer edge for
// free. Cached on the content it belongs to, keyed on the source bitmap and the numbers, so a drag
// that does not touch the Look costs nothing.
const DecalStyle = {
  KEYS: ["ol", "olc", "sh", "shx", "shy", "shb", "shc"],
  DEFAULTS: { ol: 0, olc: "#ffffff", sh: 0, shx: 4, shy: 4, shb: 3, shc: "#000000" },
  // The Look's style numbers, normalised: a Look written before these existed has none.
  read(surf){
    const S = { ...DecalStyle.DEFAULTS };
    if (!surf) return S;
    for (const k of DecalStyle.KEYS) {
      if (surf[k] == null) continue;
      S[k] = k === "olc" || k === "shc" ? String(surf[k]) : +surf[k] || 0;
    }
    return S;
  },
  any(surf){ const S = DecalStyle.read(surf); return S.ol > 0 || S.sh > 0; },
  // The keys a Look keeps when its DELTAS are replaced by a preset: the styles, and the relief
  // fields 4.19 added — a preset is a statement about gloss and emboss, not about the outline.
  carry(surf){
    const out = {};
    if (!surf) return out;
    for (const k of DecalStyle.KEYS.concat(["relief", "bevel", "heightInv", "heightFrom", "heightGen", "glossSrc", "cavity"])) if (surf[k] != null) out[k] = surf[k];
    return out;
  },
  // The same outline and shadow, in pixels, on an image whose shorter side is `m1` where it was `m0`.
  // The widths are a percentage of that side, so a crop to content — which shortens it while the
  // marking keeps its size on the model — thinned the outline (ROADMAP 4.2b's review, 2026-09-26:
  // 10 % of an 80×40 image is 4 px, of the 40×20 bar cropped out of it 2). Only the keys the Look
  // actually holds are rescaled, to a hundredth of a percent. Returns the Look itself when nothing
  // needs to move.
  refit(surf, m0, m1){
    if (!surf || !m0 || !m1 || m0 === m1) return surf;
    let out = surf;
    for (const k of ["ol", "shx", "shy", "shb"]) {
      const v = +surf[k];
      if (surf[k] == null || !v) continue;
      if (out === surf) out = { ...surf };
      out[k] = Math.round(v * m0 / m1 * 100) / 100;
    }
    return out;
  },
  key(S, bmp, shadow){
    return [bmp.width, bmp.height, S.ol, S.olc, shadow ? S.sh : 0, S.shx, S.shy, S.shb, S.shc].join("|");
  },
  // Padding, in bitmap pixels, that keeps the outline and the shadow inside the styled canvas — up
  // to a limit: never further from the decal than twice its own size, and never past MAX a side,
  // the largest sheet a decal lands on. A width is a share of the bitmap's side and `refit` takes it
  // past the sliders on purpose, so a bound on the number could not bound the pixels; this does.
  // Measured 2026-10-17 on an 8-px decal out of a crafted .wtproj: an outline of 1e5 % made a 20012²
  // canvas and 8.3 s of one composite, and 1e6 % threw "Out of memory at ImageData creation" out of
  // the compositor. Past the limit the outline and the shadow are cut off at the canvas edge.
  MAX: 8192,
  pad(bmp, S, shadow){
    const m = Math.min(bmp.width, bmp.height), M = Math.max(bmp.width, bmp.height);
    let p = S.ol / 100 * m;
    if (shadow && S.sh > 0) p += Math.max(Math.abs(S.shx), Math.abs(S.shy)) / 100 * m + S.shb / 100 * m * 3;
    const most = Math.max(0, Math.min(2 * M, Math.floor((DecalStyle.MAX - M) / 2) - 1));
    return Math.min(Math.max(0, Math.ceil(p)), most) + 1;
  },
  // The bitmap to draw for `holder` — the source itself when the Look asks for no style, else the
  // styled copy, built once per (bitmap, numbers) and kept on the holder. `holder` is whatever owns
  // the bitmap and the Look: an image content, or a projection's shared parameters. `noShadow` is
  // for the footprint: gloss and a raised edge follow the outline, which is part of the marking, and
  // not the shadow, which is paint on the surface beside it.
  //
  // The Look's cavity (ROADMAP 4.19(4), `Relief.cavityImage`) is shading of the image itself, so it is
  // applied first and the outline and shadow go round the shaded marking. It is the drawn bitmap's
  // only: the footprint answers "where is the marking", and gloss that follows the ink's brightness
  // must read the ink, not the ink's shading.
  bitmap(bmp, surf, holder, noShadow){
    if (!bmp) return bmp;
    const S = DecalStyle.read(surf);
    const withShadow = !noShadow && S.sh > 0;
    const cav = noShadow ? null : Relief.cavityOf(surf, holder);
    if (!(S.ol > 0) && !withShadow && !cav) return bmp;
    const slot = noShadow ? "_styledNS" : "_styled";
    const key = DecalStyle.key(S, bmp, withShadow) + (cav ? "|cav" + cav.k + (cav.inv ? "i" : "") : "");
    const hm = cav ? cav.hm : null;
    if (holder && holder[slot] && holder[slot + "Src"] === bmp && holder[slot + "Key"] === key && (holder[slot + "Hm"] || null) === hm)
      return holder[slot];
    const img = cav ? Relief.cavityImage(bmp, cav) : bmp;
    const out = (S.ol > 0 || withShadow) ? DecalStyle.render(img, S, withShadow) : img;
    if (holder) { holder[slot] = out; holder[slot + "Src"] = bmp; holder[slot + "Key"] = key; holder[slot + "Hm"] = hm; }
    return out;
  },
  render(bmp, S, withShadow){
    const m = Math.min(bmp.width, bmp.height);
    const pad = DecalStyle.pad(bmp, S, withShadow);
    const W = bmp.width + 2 * pad, H = bmp.height + 2 * pad;
    const out = mkCanvas(W, H), g = ctx2d(out);
    if (withShadow) {
      // the marking's silhouette in the shadow colour, offset and blurred
      const s = mkCanvas(W, H), sg = ctx2d(s);
      sg.drawImage(bmp, pad, pad);
      sg.globalCompositeOperation = "source-in";
      sg.fillStyle = S.shc; sg.fillRect(0, 0, W, H);
      g.globalAlpha = Math.max(0, Math.min(1, S.sh / 100));
      const b = S.shb / 100 * m;
      if (b > 0) g.filter = "blur(" + b.toFixed(2) + "px)";
      g.drawImage(s, S.shx / 100 * m, S.shy / 100 * m);
      g.filter = "none"; g.globalAlpha = 1;
    }
    if (S.ol > 0) g.drawImage(DecalStyle.ring(bmp, pad, W, H, S.ol / 100 * m, S.olc), 0, 0);
    g.drawImage(bmp, pad, pad);
    return out;
  },
  // The outline as its own image: solid colour, alpha 1 inside the marking and out to `r` texels
  // beyond its edge, fading over the last texel.
  ring(bmp, pad, W, H, r, color){
    const sc = mkCanvas(W, H), scg = ctx2d(sc);
    scg.drawImage(bmp, pad, pad);
    const fa = scg.getImageData(0, 0, W, H).data;
    const D = Relief.chamfer(fa, W, H, true);              // thirds of a texel, OUTSIDE the marking
    const [cr, cg, cb] = DecalStyle.rgb(color);
    const img = scg.createImageData(W, H);
    const lim = r * 3 + 1.5;
    for (let i = 0; i < W * H; i++) {
      const a = fa[i*4 + 3] > 8 ? 1 : Math.max(0, Math.min(1, (lim - D[i]) / 3));
      if (a <= 0) continue;
      img.data[i*4] = cr; img.data[i*4+1] = cg; img.data[i*4+2] = cb; img.data[i*4+3] = Math.round(a * 255);
    }
    scg.clearRect(0, 0, W, H);
    scg.putImageData(img, 0, 0);
    return sc;
  },
  rgb(hex){
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
  },
};
